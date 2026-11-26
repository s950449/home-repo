import assert from "node:assert/strict";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  ID, ROOT, assertInstallationsSafe, assertLockMatchesManifest, loadPack, readJson,
} from "./skill-state.mjs";

function ids(value, label) {
  assert(Array.isArray(value), `${label} must be an array`);
  assert(value.every((id) => typeof id === "string" && ID.test(id)), `Invalid ID in ${label}`);
  assert.equal(new Set(value).size, value.length, `Duplicate ID in ${label}`);
  return value;
}

export async function personalSkill(id, { root = ROOT } = {}) {
  assert(typeof id === "string" && ID.test(id), `Invalid personal skill ID: ${id}`);
  const source = path.join(root, "skills/personal", id);
  assert.equal(await realpath(source), source, `Personal source must not use symlinked paths: ${id}`);
  assert((await lstat(source)).isDirectory(), `Personal source must be a directory: ${id}`);
  const entry = path.join(source, "SKILL.md");
  assert((await lstat(entry)).isFile(), `Personal entry must be a regular file: ${id}`);
  const text = await readFile(entry, "utf8");
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  assert(frontmatter, `Missing frontmatter in personal skill: ${id}`);
  assert.equal(/^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(frontmatter)?.[1],
    id, `Personal skill name differs: ${id}`);
  const description = /^description:[ \t]*(\S[^\r\n]*)$/m.exec(frontmatter)?.[1]?.trim();
  assert(description && !['""', "''", "|", ">"].includes(description),
    `Personal skill needs a nonempty single-line description: ${id}`);
  return { id, kind: "personal", source, origin: `personal:${id}` };
}

// Profiles are Home Repo data, not native harness configuration or permissions.
export async function resolveProfile(name, { root = ROOT, requireInstalled = false } = {}) {
  assert(typeof name === "string" && ID.test(name), `Invalid profile ID: ${name}`);
  const filename = path.join(root, "profiles", `${name}.json`);
  assert.equal(await realpath(filename), filename, `Profile must not use symlinked paths: ${name}`);
  const profile = await readJson(filename);
  assert.equal(profile.id, name, `Profile ID differs: ${name}`);
  assert(typeof profile.description === "string" && profile.description.trim(),
    `Profile description is required: ${name}`);
  let packs;
  let personal;
  if (profile.schema_version === 1) {
    ids(profile.skills, `${name}.skills`);
    packs = profile.pack === undefined ? [] : ids([profile.pack], `${name}.pack`);
    personal = [];
    if (!packs.length) assert.equal(profile.skills.length, 0, `Nonempty legacy profile needs a pack: ${name}`);
  } else {
    assert.equal(profile.schema_version, 2, `Unsupported profile schema: ${name}`);
    assert(!("pack" in profile) && !("skills" in profile), `Do not mix legacy and v2 fields: ${name}`);
    packs = ids(profile.packs, `${name}.packs`);
    personal = ids(profile.personal, `${name}.personal`);
  }
  const selections = new Map();
  for (const packName of packs) {
    const pack = await loadPack(packName, { root });
    await assertLockMatchesManifest(pack);
    if (requireInstalled) await assertInstallationsSafe(pack);
    for (const [id, declaration] of pack.declarations) {
      const lock = pack.lock.skills[id];
      const identity = JSON.stringify({
        type: declaration.type, source: lock.source, commit: lock.commit,
        skillPath: lock.skillPath, hash: lock.computedHash,
      });
      const previous = selections.get(id);
      if (previous) {
        assert.equal(previous.identity, identity, `Conflicting skill ${id}: ${previous.origin} vs pack:${packName}`);
        continue;
      }
      const source = path.join(pack.directory, ".agents/skills", id);
      if (requireInstalled) {
        assert((await lstat(source).catch(() => null))?.isDirectory(),
          `Restore pack ${packName} before deploying (${id} is missing)`);
      }
      selections.set(id, {
        id, kind: "pack", source, identity, pack: packName,
        origin: `pack:${packName}:${id}`,
        version: lock.commit ?? lock.computedHash,
      });
    }
  }
  for (const id of personal) {
    assert(!selections.has(id), `Personal/external skill name conflict: ${id}`);
    selections.set(id, await personalSkill(id, { root }));
  }
  if (profile.schema_version === 1) {
    assert.deepEqual([...selections.keys()].sort(), [...profile.skills].sort(),
      `Legacy profile/pack selection differs: ${name}`);
  }
  return { profile, packs, personal, selections };
}
