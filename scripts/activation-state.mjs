import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolveProfile } from "./profile-state.mjs";
import { AGENTS, ID, ROOT, exists, isWithin, readJson } from "./skill-state.mjs";

const STATE = ".home-repo/skills.json";
const HASH = /^[a-f0-9]{64}$/;
const DESTINATION = /^(\.agents|\.claude)\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;

function git(target, args) {
  const result = spawnSync("git", ["-C", target, ...args], {
    encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error) throw result.error;
  assert(result.status === 0, `Git check failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function safePath(target, relative) {
  assert(!path.isAbsolute(relative), "Destination must be relative");
  const destination = path.resolve(target, relative);
  assert(destination !== target && isWithin(target, destination), "Destination escapes target");
  let current = target;
  const parts = relative.split("/");
  for (const [index, part] of parts.entries()) {
    assert(part && part !== "." && part !== "..", "Unsafe destination path");
    current = path.join(current, part);
    const info = await lstat(current).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) continue;
    assert(!info.isSymbolicLink(), `Destination must not use symlinks: ${current}`);
    if (index < parts.length - 1) assert(info.isDirectory(), `Parent is not a directory: ${current}`);
  }
  return destination;
}

// Unlike native skill hashes, ownership hashes include every file, empty
// directory, exact byte, and executable bit. Even metadata.json edits matter.
export async function snapshotHash(directory) {
  const hash = createHash("sha256");
  async function visit(filename, relative) {
    const info = await lstat(filename);
    assert(!info.isSymbolicLink(), `Snapshot must not contain symlinks: ${filename}`);
    if (info.isDirectory()) {
      hash.update(JSON.stringify(["directory", relative]) + "\n");
      for (const entry of (await readdir(filename)).sort()) {
        await visit(path.join(filename, entry), relative ? `${relative}/${entry}` : entry);
      }
    } else {
      assert(info.isFile(), `Snapshot must contain only regular files: ${filename}`);
      const content = await readFile(filename);
      hash.update(JSON.stringify(["file", relative, info.mode & 0o111, content.length]) + "\n");
      hash.update(content);
    }
  }
  assert((await lstat(directory)).isDirectory(), `Snapshot is not a directory: ${directory}`);
  await visit(directory, "");
  return hash.digest("hex");
}

export async function inspectTarget(target, { root = ROOT } = {}) {
  assert(typeof target === "string" && target, "Select an explicit --target repository or worktree");
  const directory = path.resolve(target);
  assert.equal(await realpath(directory), directory, "Target must not use symlinked paths");
  assert(directory !== path.parse(directory).root && directory !== os.homedir(), "Refusing a global target");
  assert(!isWithin(root, directory) && !isWithin(directory, root),
    "Target must be independent of the Home Repo source tree");
  const top = git(directory, ["rev-parse", "--show-toplevel"]);
  assert.equal(await realpath(top), directory, "Target must be the repository/worktree root");
  const instructions = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    if (await exists(path.join(directory, name))) instructions.push(path.join(directory, name));
  }
  return { directory, status: git(directory, ["status", "--short"]), instructions };
}

function selectedAgents(agents) {
  assert(Array.isArray(agents) && agents.length, "Select explicit --agent IDs");
  assert(agents.every((agent) => AGENTS.has(agent)), "Unsupported agent");
  return [...new Set(agents)].sort();
}

async function loadReceipt(target) {
  const filename = await safePath(target, STATE);
  if (!await exists(filename)) return { version: 1, profile: null, agents: [], entries: [] };
  assert((await lstat(filename)).isFile(), "Activation receipt must be a regular file");
  const receipt = await readJson(filename);
  assert.equal(receipt.version, 1, "Unsupported activation receipt");
  assert(receipt.profile === null || (typeof receipt.profile === "string" && ID.test(receipt.profile)),
    "Invalid receipt profile");
  assert(Array.isArray(receipt.agents) && receipt.agents.every((agent) => AGENTS.has(agent)),
    "Invalid receipt agents");
  assert(Array.isArray(receipt.entries), "Invalid activation entries");
  const seen = new Set();
  for (const entry of receipt.entries) {
    const match = typeof entry.path === "string" && DESTINATION.exec(entry.path);
    assert(match && match[2] === entry.id && HASH.test(entry.digest), "Unsafe activation receipt entry");
    assert(!seen.has(entry.path), "Duplicate activation receipt entry");
    seen.add(entry.path);
  }
  return receipt;
}

function isIgnored(target, relative) {
  const result = spawnSync("git", ["-C", target, "check-ignore", "--quiet", "--no-index", "--", relative],
    { encoding: "utf8" });
  if (result.error) throw result.error;
  assert(result.status === 0 || result.status === 1, `Cannot check Git ignore rules: ${result.stderr}`);
  return result.status === 0;
}

async function checkDestination(target, relative) {
  const filename = await safePath(target, relative);
  assert(!git(target, ["ls-files", "--", relative]), `Refusing Git-tracked destination: ${relative}`);
  return filename;
}

export async function planActivation({
  profile, agents = [], target, root = ROOT, remove = false,
}) {
  const inspected = await inspectTarget(target, { root });
  const directory = inspected.directory;
  const previous = await loadReceipt(directory);
  const chosen = remove ? [] : selectedAgents(agents);
  const resolved = remove ? null : await resolveProfile(profile, { root, requireInstalled: true });
  const desired = [];
  const bases = new Set(chosen.map((agent) => agent === "claude-code" ? ".claude/skills" : ".agents/skills"));
  for (const skill of resolved?.selections.values() ?? []) {
    const digest = await snapshotHash(skill.source);
    for (const base of [...bases].sort()) {
      desired.push({
        id: skill.id, path: `${base}/${skill.id}`, digest, source: skill.source,
        origin: skill.origin, ...(skill.version ? { version: skill.version } : {}),
      });
    }
  }
  desired.sort((a, b) => a.path.localeCompare(b.path));
  const owned = new Map(previous.entries.map((entry) => [entry.path, entry]));
  for (const entry of previous.entries) {
    const filename = await checkDestination(directory, entry.path);
    assert(await exists(filename), `Managed skill is missing; refusing to repair silently: ${entry.path}`);
    assert.equal(await snapshotHash(filename), entry.digest,
      `Local changes detected; preserve them before deploying: ${entry.path}`);
  }
  for (const entry of desired) {
    const filename = await checkDestination(directory, entry.path);
    assert(owned.has(entry.path) || !await exists(filename),
      `Unmanaged destination; refusing to overwrite: ${entry.path}`);
  }
  await checkDestination(directory, ".home-repo");
  const paths = new Set([".home-repo/", ...previous.entries.map((entry) => entry.path),
    ...desired.map((entry) => entry.path)]);
  const unignored = [...paths].filter((relative) => !isIgnored(directory, relative));
  const wanted = new Map(desired.map((entry) => [entry.path, entry]));
  const changes = [];
  for (const entry of previous.entries) {
    if (!wanted.has(entry.path)) {
      changes.push({
        action: "remove", path: entry.path, origin: entry.origin,
        version: entry.version, digest: entry.digest,
      });
    }
  }
  for (const entry of desired) {
    const old = owned.get(entry.path);
    changes.push({
      action: !old ? "add" : old.digest === entry.digest ? "keep" : "update",
      path: entry.path, origin: entry.origin, version: entry.version, source: entry.source, digest: entry.digest,
    });
  }
  return {
    ...inspected, profile: remove ? null : profile, agents: chosen, previous, desired, changes, unignored,
  };
}

export async function applyActivation(options) {
  // Require ignored generated state before creating even a lock or staging area.
  const { directory } = await inspectTarget(options.target, { root: options.root ?? ROOT });
  await checkDestination(directory, ".home-repo");
  assert(isIgnored(directory, ".home-repo/"), "Ignore /.home-repo/ in the target before applying");
  const control = await safePath(directory, ".home-repo");
  if (await exists(control)) assert((await lstat(control)).isDirectory(), "Invalid activation state directory");
  await mkdir(control, { recursive: true });
  const lockPath = await safePath(directory, ".home-repo/skills.lock");
  const lock = await open(lockPath, "wx").catch((error) => {
    if (error.code === "EEXIST") throw new Error("Another activation may be running; refusing to share its lock");
    throw error;
  });
  let stage;
  try {
    const plan = await planActivation(options);
    assert.equal(plan.unignored.length, 0,
      `Generated paths must be Git-ignored before applying: ${plan.unignored.join(", ")}`);
    stage = await mkdtemp(path.join(control, ".skills-stage-"));
    const replacements = plan.changes.filter((change) => ["add", "update"].includes(change.action));
    for (const [index, change] of replacements.entries()) {
      const entry = plan.desired.find((item) => item.path === change.path);
      await cp(entry.source, path.join(stage, `new-${index}`), {
        recursive: true, force: false, errorOnExist: true,
      });
      assert.equal(await snapshotHash(path.join(stage, `new-${index}`)), entry.digest,
        `Source changed while copying: ${entry.origin}`);
    }
    const receipt = {
      version: 1, profile: plan.profile, agents: plan.agents,
      entries: plan.desired.map(({ source, ...entry }) => entry),
    };
    await writeFile(path.join(stage, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    // Recheck ownership and destinations immediately before making changes.
    const rechecked = await planActivation(options);
    assert.deepEqual(rechecked.previous, plan.previous, "Activation receipt changed during preparation");
    assert.deepEqual(rechecked.desired, plan.desired, "Profile sources changed during preparation");
    const backups = [];
    const installed = [];
    try {
      for (const change of plan.changes.filter((item) => ["remove", "update"].includes(item.action))) {
        const filename = await safePath(directory, change.path);
        const backup = path.join(stage, `old-${backups.length}`);
        await rename(filename, backup);
        backups.push({ filename, backup });
      }
      for (const [index, change] of replacements.entries()) {
        const filename = await safePath(directory, change.path);
        await mkdir(path.dirname(filename), { recursive: true });
        assert(!await exists(filename), `Destination appeared during activation: ${change.path}`);
        await rename(path.join(stage, `new-${index}`), filename);
        installed.push(filename);
      }
      await rename(path.join(stage, "receipt.json"), path.join(directory, STATE));
    } catch (error) {
      // Keep backups if rollback itself fails, rather than deleting recovery data.
      try {
        for (const filename of installed.reverse()) await rm(filename, { recursive: true });
        for (const { filename, backup } of backups.reverse()) await rename(backup, filename);
      } catch (rollbackError) {
        const recovery = stage;
        stage = null;
        throw new AggregateError([error, rollbackError], `Rollback failed; recovery files remain at ${recovery}`);
      }
      throw error;
    }
    return plan;
  } finally {
    try {
      if (stage) await rm(stage, { recursive: true, force: true });
    } finally {
      await lock.close();
      await rm(lockPath);
    }
  }
}
