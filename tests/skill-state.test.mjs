import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertInstallationsSafe, assertLockMatchesManifest, loadPack, skillHash,
} from "../scripts/skill-state.mjs";

async function temporary(t) {
  const directory = await realpath(await mkdtemp(path.join(
    process.env.HOME_REPO_TEST_TMP ?? os.tmpdir(), "home-repo-test-",
  )));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function json(filename, value) {
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixture(t) {
  const root = await temporary(t);
  const directory = path.join(root, "packs/demo");
  const canonical = path.join(directory, ".agents/skills/demo");
  await mkdir(canonical, { recursive: true });
  await writeFile(path.join(canonical, "SKILL.md"), "---\nname: demo\ndescription: Test fixture.\n---\n");
  const commit = "a".repeat(40);
  await json(path.join(directory, "package.json"), {
    private: true,
    skills: [`https://github.com/example/skills/tree/${commit}/skills/demo`],
  });
  await json(path.join(directory, "skills-lock.json"), {
    version: 2,
    skills: {
      demo: {
        source: "example/skills", sourceType: "github", ref: commit, commit,
        skillPath: "skills/demo/SKILL.md", computedHash: await skillHash(canonical),
      },
    },
  });
  return { root, directory, canonical, pack: await loadPack("demo", { root }) };
}

test("matches the published skills@1.9.0 hash vectors", async (t) => {
  const directory = await temporary(t);
  assert.equal(await skillHash(directory), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  await writeFile(path.join(directory, "SKILL.md"), "# hi\n");
  assert.equal(await skillHash(directory), "93c36952d8843b33e68ae970ebabcc03e1687c9bb0dd1ecaf357060318952f55");
  await writeFile(path.join(directory, "SKILL.md"), "a\n");
  await mkdir(path.join(directory, "docs"));
  await writeFile(path.join(directory, "docs/b.md"), "b\n");
  assert.equal(await skillHash(directory), "b22c4d22aa319d2924312fa18fcbfedc88fa89c74dbd8f298c683e1caf7b7f24");
});

test("normalizes CRLF text but preserves binary bytes", async (t) => {
  const directory = await temporary(t);
  const filename = path.join(directory, "SKILL.md");
  await writeFile(filename, "one\ntwo\n");
  const lf = await skillHash(directory);
  await writeFile(filename, "one\r\ntwo\r\n");
  assert.equal(await skillHash(directory), lf);
  await writeFile(filename, Buffer.from([0, 13, 10]));
  const binary = await skillHash(directory);
  await writeFile(filename, Buffer.from([0, 10]));
  assert.notEqual(await skillHash(directory), binary);
});

test("validates matching manifest pins, native locks, and installed content", async (t) => {
  const { pack } = await fixture(t);
  await assertLockMatchesManifest(pack);
  assert.equal(await assertInstallationsSafe(pack), 1);
});

test("rejects branch pins, path traversal, and mismatched lock commits", async (t) => {
  const { root, directory, pack } = await fixture(t);
  pack.lock.skills.demo.commit = "b".repeat(40);
  await assert.rejects(assertLockMatchesManifest(pack), /Source pin differs/);
  await assert.rejects(loadPack("../demo", { root }), /Invalid pack ID/);
  await json(path.join(directory, "package.json"), {
    skills: ["https://github.com/example/skills/tree/main/skills/demo"],
  });
  await assert.rejects(loadPack("demo", { root }), /full-commit/);
});

test("refuses modified canonical content before calling the installer", async (t) => {
  const { canonical, pack } = await fixture(t);
  await writeFile(path.join(canonical, "SKILL.md"), "Preserve this user's edit.\n");
  await assert.rejects(assertInstallationsSafe(pack), /Local changes detected/);
  assert.match(await readFile(path.join(canonical, "SKILL.md"), "utf8"), /user's edit/);
});

test("refuses modified agent copies even when the canonical copy is unchanged", async (t) => {
  const { directory, pack } = await fixture(t);
  const copy = path.join(directory, ".claude/skills/demo");
  await mkdir(copy, { recursive: true });
  await writeFile(path.join(copy, "SKILL.md"), "An independent local edit.\n");
  await assert.rejects(assertInstallationsSafe(pack), /Local changes detected/);
});

test("refuses untracked installation destinations", async (t) => {
  const { directory, pack } = await fixture(t);
  await mkdir(path.join(directory, ".agents/skills/user-skill"));
  await assert.rejects(assertInstallationsSafe(pack), /Untracked destination/);
});

test("refuses installation links escaping the pack", async (t) => {
  const { root, directory, pack } = await fixture(t);
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await mkdir(path.join(directory, ".claude/skills"), { recursive: true });
  await symlink(outside, path.join(directory, ".claude/skills/demo"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(assertInstallationsSafe(pack), /escapes pack/);
});

test("accepts relative local exceptions and detects vendored-source changes", async (t) => {
  const { root, directory } = await fixture(t);
  const source = path.join(root, "skills/vendor/example/demo");
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "SKILL.md"), "---\nname: demo\ndescription: A local exception.\n---\n");
  await json(path.join(directory, "package.json"), {
    homeRepo: { localSkills: ["../../skills/vendor/example/demo"] },
  });
  await json(path.join(directory, "skills-lock.json"), {
    version: 2,
    skills: {
      demo: {
        source: "../../skills/vendor/example/demo", sourceType: "local",
        computedHash: await skillHash(source), installMode: "copy",
      },
    },
  });
  const pack = await loadPack("demo", { root });
  await assertLockMatchesManifest(pack);
  await writeFile(path.join(source, "SKILL.md"), "Unexpected source change.\n");
  await assert.rejects(assertLockMatchesManifest(pack), /Vendored source changed/);
});
