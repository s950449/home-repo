import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const AGENTS = new Set(["codex", "opencode", "pi", "claude-code"]);
export const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^[a-f0-9]{64}$/;
const GIT_SOURCE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([a-f0-9]{40})\/(.+)$/;
const OMIT_DIRS = new Set([".git", "__pycache__", "__pypackages__"]);

export const readJson = async (filename) => JSON.parse(await readFile(filename, "utf8"));

export function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

export async function exists(filename) {
  try {
    await lstat(filename);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

// Implements the skills@1.9.0 v2 content-hash specification for regular bundles.
// Reject internal symlinks rather than following unexpected filesystem targets.
export async function skillHash(directory) {
  const files = [];
  async function collect(current, prefix = "") {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Unexpected link inside skill: ${filename}`);
      if (entry.isDirectory()) {
        if (!OMIT_DIRS.has(entry.name)) await collect(filename, `${relative}/`);
      } else if (entry.isFile() && entry.name !== "metadata.json") {
        let content = await readFile(filename);
        if (!content.includes(0)) {
          // Preserve arbitrary non-UTF-8 bytes while normalizing only CRLF.
          content = Buffer.from(content.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
        }
        files.push({ relative, content });
      } else if (!entry.isFile()) {
        throw new Error(`Unexpected non-file inside skill: ${filename}`);
      }
    }
  }
  await collect(directory);
  files.sort((a, b) => Buffer.compare(Buffer.from(a.relative), Buffer.from(b.relative)));
  const hash = createHash("sha256");
  for (const { relative, content } of files) {
    hash.update(`${relative}\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest("hex");
}

export async function loadPack(name, { root = ROOT, allowMissingLock = false } = {}) {
  if (!ID.test(name)) throw new Error(`Invalid pack ID: ${name}`);
  const directory = path.join(root, "packs", name);
  if (await realpath(directory) !== directory) throw new Error(`Pack must not use symlinked paths: ${name}`);
  const manifest = await readJson(path.join(directory, "package.json"));
  const declarations = new Map();
  const skillIds = manifest.homeRepo?.skillIds ?? {};
  if (typeof skillIds !== "object" || Array.isArray(skillIds)) {
    throw new Error(`Expected a Git skill ID map in ${name}`);
  }
  const unusedSkillIdPaths = new Set(Object.keys(skillIds));
  for (const source of manifest.skills ?? []) {
    if (typeof source !== "string") throw new Error(`Invalid source in ${name}`);
    const match = GIT_SOURCE.exec(source);
    if (!match || match[4].split("/").some((part) => !part || part === "." || part === "..")) {
      throw new Error(`Use a full-commit GitHub tree URL in ${name}: ${source}`);
    }
    const folder = match[4];
    const id = Object.hasOwn(skillIds, folder) ? skillIds[folder] : folder.split("/").at(-1);
    if (typeof id !== "string" || !ID.test(id) || declarations.has(id)) {
      throw new Error(`Duplicate or invalid skill in ${name}: ${id}`);
    }
    unusedSkillIdPaths.delete(folder);
    declarations.set(id, {
      type: "github", source, repository: `${match[1]}/${match[2]}`,
      commit: match[3], skillPath: `${folder}/SKILL.md`,
    });
  }
  if (unusedSkillIdPaths.size) throw new Error(`Skill ID map contains undeclared paths in ${name}`);
  for (const source of manifest.homeRepo?.localSkills ?? []) {
    if (typeof source !== "string" || path.isAbsolute(source)) throw new Error(`Local sources must be relative: ${name}`);
    const target = await realpath(path.resolve(directory, source));
    const vendor = path.join(root, "skills", "vendor");
    if (!isWithin(vendor, target)) throw new Error(`Local exception must be inside skills/vendor: ${source}`);
    const text = await readFile(path.join(target, "SKILL.md"), "utf8");
    const id = /^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(text)?.[1];
    if (!id || declarations.has(id)) throw new Error(`Duplicate or invalid local skill in ${name}`);
    declarations.set(id, { type: "local", source, target });
  }
  if (!declarations.size) throw new Error(`Pack has no declared skills: ${name}`);
  const lockPath = path.join(directory, "skills-lock.json");
  const lock = allowMissingLock && !await exists(lockPath)
    ? { version: 2, skills: {} }
    : await readJson(lockPath);
  if (lock.version !== 2 || !lock.skills || Array.isArray(lock.skills)) {
    throw new Error(`Expected a native v2 skills lock in ${name}`);
  }
  return { name, directory, manifest, declarations, lock, lockPath };
}

export async function assertLockMatchesManifest(pack) {
  const keys = Object.keys(pack.lock.skills);
  if (keys.length !== pack.declarations.size) throw new Error(`Manifest/lock skill count differs: ${pack.name}`);
  for (const [id, declared] of pack.declarations) {
    const entry = pack.lock.skills[id];
    if (!entry || !HASH.test(entry.computedHash)) throw new Error(`Missing skill/hash in ${pack.name}: ${id}`);
    if (entry.sourceType !== declared.type) throw new Error(`Source type differs in ${pack.name}: ${id}`);
    if (declared.type === "github") {
      if (entry.source !== declared.repository || entry.commit !== declared.commit
          || entry.ref !== declared.commit || entry.skillPath !== declared.skillPath) {
        throw new Error(`Source pin differs in ${pack.name}: ${id}`);
      }
    } else {
      if (path.isAbsolute(entry.source) || path.resolve(pack.directory, entry.source) !== declared.target) {
        throw new Error(`Local source differs in ${pack.name}: ${id}`);
      }
      if (await skillHash(declared.target) !== entry.computedHash) {
        throw new Error(`Vendored source changed in ${pack.name}: ${id}`);
      }
    }
  }
}

// Native restore can overwrite modified installs. Check every managed location
// before invoking it, including agent copies, and refuse foreign destinations.
export async function assertInstallationsSafe(pack) {
  let installed = 0;
  for (const relative of [".agents/skills", ".claude/skills"]) {
    const base = path.join(pack.directory, relative);
    for (const parent of [path.dirname(base), base]) {
      if (await exists(parent) && await realpath(parent) !== parent) {
        throw new Error(`Installation parent must not be a symlink: ${parent}`);
      }
    }
    if (!await exists(base)) continue;
    for (const entry of await readdir(base, { withFileTypes: true })) {
      const locked = pack.lock.skills[entry.name];
      if (!locked) throw new Error(`Untracked destination; refusing to overwrite: ${relative}/${entry.name}`);
      const destination = path.join(base, entry.name);
      const resolved = await realpath(destination);
      if (!isWithin(pack.directory, resolved)) throw new Error(`Destination escapes pack: ${destination}`);
      if (relative === ".agents/skills" && entry.isSymbolicLink()) {
        throw new Error(`Canonical installation must not be a symlink: ${destination}`);
      }
      if (await skillHash(resolved) !== locked.computedHash) {
        throw new Error(`Local changes detected; preserve them before restoring: ${destination}`);
      }
      installed++;
    }
  }
  return installed;
}
