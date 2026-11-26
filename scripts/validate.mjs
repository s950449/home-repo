#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  ROOT, assertInstallationsSafe, assertLockMatchesManifest, exists,
  loadPack, readJson,
} from "./skill-state.mjs";

async function main() {
  const packageJson = await readJson(path.join(ROOT, "package.json"));
  const npmLock = await readJson(path.join(ROOT, "package-lock.json"));
  const expectedTool = packageJson.devDependencies.skills;
  assert.match(expectedTool, /^\d+\.\d+\.\d+$/, "Use an exact skills CLI version");
  assert.equal(npmLock.packages["node_modules/skills"].version, expectedTool, "npm tool lock differs");
  assert.match(npmLock.packages["node_modules/skills"].integrity, /^sha512-/);
  const packs = new Map();
  const known = new Set();
  let installedLocations = 0;
  for (const entry of await readdir(path.join(ROOT, "packs"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pack = await loadPack(entry.name);
    await assertLockMatchesManifest(pack);
    installedLocations += await assertInstallationsSafe(pack);
    packs.set(entry.name, pack);
    for (const id of pack.declarations.keys()) known.add(id);
  }
  const personal = path.join(ROOT, "skills/personal");
  if (await exists(personal)) {
    for (const entry of await readdir(personal, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const text = await readFile(path.join(personal, entry.name, "SKILL.md"), "utf8");
      const name = /^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(text)?.[1];
      assert.equal(name, entry.name, `Personal skill name differs: ${entry.name}`);
      assert(!known.has(name), `Personal skill conflicts with external skill: ${name}`);
      known.add(name);
    }
  }
  let profiles = 0;
  for (const filename of await readdir(path.join(ROOT, "profiles"))) {
    if (!filename.endsWith(".json")) continue;
    const profile = await readJson(path.join(ROOT, "profiles", filename));
    assert.equal(profile.schema_version, 1, `Profile schema differs: ${filename}`);
    assert.equal(profile.id, filename.slice(0, -5), `Profile ID differs: ${filename}`);
    assert(Array.isArray(profile.skills), `Expected skill array: ${filename}`);
    assert.equal(new Set(profile.skills).size, profile.skills.length, `Duplicate profile skill: ${filename}`);
    for (const id of profile.skills) assert(known.has(id), `Unknown profile skill: ${id}`);
    if (profile.pack) {
      assert(packs.has(profile.pack), `Unknown profile pack: ${profile.pack}`);
      assert.deepEqual(
        [...profile.skills].sort(), [...packs.get(profile.pack).declarations.keys()].sort(),
        `Profile/pack selection differs: ${filename}`,
      );
    } else {
      assert.equal(profile.skills.length, 0, `Nonempty profile must select a pack: ${filename}`);
    }
    profiles++;
  }
  console.log(`OK: ${packs.size} native skill packs, ${known.size} unique skills, ${profiles} profiles.`);
  console.log(`Checked ${installedLocations} present installation locations; absent installs are allowed.`);
  console.log("Structural and content-integrity validation only; no skill workflows were executed.");
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
