#!/usr/bin/env node
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { personalSkill, resolveProfile } from "./profile-state.mjs";
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
      const { id: name } = await personalSkill(entry.name);
      assert(!known.has(name), `Personal skill conflicts with external skill: ${name}`);
      known.add(name);
    }
  }
  let profiles = 0;
  for (const filename of await readdir(path.join(ROOT, "profiles"))) {
    if (!filename.endsWith(".json")) continue;
    await resolveProfile(filename.slice(0, -5));
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
