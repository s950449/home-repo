import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { applyActivation, inspectTarget, planActivation, snapshotHash } from "../scripts/activation-state.mjs";
import { personalSkill, resolveProfile } from "../scripts/profile-state.mjs";
import { parseArguments } from "../scripts/profiles.mjs";
import { exists, skillHash } from "../scripts/skill-state.mjs";

function git(target, ...args) {
  const result = spawnSync("git", ["-C", target, ...args], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

async function json(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, JSON.stringify(value, null, 2) + "\n");
}

async function skill(directory, id) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "SKILL.md"),
    `---\nname: ${id}\ndescription: A test skill.\n---\n\n# Instructions\n`);
}

async function fixture(t) {
  const base = await realpath(await mkdtemp(path.join(
    process.env.HOME_REPO_TEST_TMP ?? os.tmpdir(), "home-repo-profiles-",
  )));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, "home repo");
  const target = path.join(base, "target repo");
  await mkdir(target, { recursive: true });
  git(target, "init", "--quiet", "--initial-branch=main");
  await writeFile(path.join(target, ".git/info/exclude"), "/.home-repo/\n/.agents/skills/\n/.claude/skills/\n");
  const source = path.join(root, "skills/personal/review");
  await skill(source, "review");
  const profileFile = path.join(root, "profiles/dev.json");
  const profile = { schema_version: 2, id: "dev", description: "Development.", packs: [], personal: ["review"] };
  await json(profileFile, profile);
  await json(path.join(root, "profiles/empty.json"), { ...profile, id: "empty", personal: [] });
  return {
    base, root, target, source, profile, profileFile,
    options: { root, target, profile: "dev", agents: ["opencode"] },
  };
}

async function pack(root, name, id = "external", commit = "a".repeat(40)) {
  const directory = path.join(root, "packs", name);
  const source = path.join(directory, ".agents/skills", id);
  await skill(source, id);
  await json(path.join(directory, "package.json"), {
    skills: [`https://github.com/example/skills/tree/${commit}/skills/${id}`],
  });
  await json(path.join(directory, "skills-lock.json"), {
    version: 2,
    skills: {
      [id]: {
        sourceType: "github", source: "example/skills", ref: commit, commit,
        skillPath: `skills/${id}/SKILL.md`, computedHash: await skillHash(source),
      },
    },
  });
  return source;
}

test("composes multiple packs and personal skills, deduplicating identical pinned sources", async (t) => {
  const { root, profileFile, profile } = await fixture(t);
  await pack(root, "one");
  await pack(root, "two");
  await pack(root, "three", "other");
  await json(profileFile, { ...profile, packs: ["one", "two", "three"] });
  const result = await resolveProfile("dev", { root, requireInstalled: true });
  assert.deepEqual([...result.selections.keys()], ["external", "other", "review"]);
});

test("rejects conflicting pins, personal/external collisions, and duplicate selections", async (t) => {
  const { root, profileFile, profile } = await fixture(t);
  await pack(root, "one");
  await pack(root, "two", "external", "b".repeat(40));
  await json(profileFile, { ...profile, packs: ["one", "two"] });
  await assert.rejects(resolveProfile("dev", { root }), /Conflicting skill external/);
  await pack(root, "collision", "review");
  await json(profileFile, { ...profile, packs: ["collision"] });
  await assert.rejects(resolveProfile("dev", { root }), /Personal\/external/);
  await json(profileFile, { ...profile, personal: ["review", "review"] });
  await assert.rejects(resolveProfile("dev", { root }), /Duplicate ID/);
});

test("validates missing personal sources, IDs, frontmatter, and symbolic links", async (t) => {
  const { root, source, base } = await fixture(t);
  await assert.rejects(personalSkill("../review", { root }), /Invalid personal/);
  await assert.rejects(personalSkill("missing", { root }), /ENOENT/);
  await writeFile(path.join(source, "SKILL.md"), "---\nname: other\ndescription: Test.\n---\n");
  await assert.rejects(personalSkill("review", { root }), /name differs/);
  await writeFile(path.join(source, "SKILL.md"), "# No frontmatter\nname: review\n");
  await assert.rejects(personalSkill("review", { root }), /Missing frontmatter/);
  await writeFile(path.join(source, "SKILL.md"), '---\nname: review\ndescription: ""\n---\n');
  await assert.rejects(personalSkill("review", { root }), /nonempty single-line description/);
  const linked = path.join(root, "skills/personal/linked");
  await symlink(base, linked, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(personalSkill("linked", { root }), /symlinked paths/);
});

test("reads legacy profiles without accepting mixed schemas or mismatched skill lists", async (t) => {
  const { root, profileFile, profile } = await fixture(t);
  await pack(root, "one");
  await json(profileFile, { schema_version: 1, id: "dev", description: "Legacy.", pack: "one", skills: ["external"] });
  assert.equal((await resolveProfile("dev", { root })).selections.size, 1);
  await json(profileFile, { ...profile, skills: [] });
  await assert.rejects(resolveProfile("dev", { root }), /mix legacy/);
  await json(profileFile, { schema_version: 1, id: "dev", description: "Legacy.", pack: "one", skills: [] });
  await assert.rejects(resolveProfile("dev", { root }), /selection differs/);
});

test("requires restored and unmodified external bundles without downloading anything", async (t) => {
  const { root, profileFile, profile, options } = await fixture(t);
  const source = await pack(root, "one");
  await json(profileFile, { ...profile, packs: ["one"] });
  await rm(source, { recursive: true });
  assert.equal((await resolveProfile("dev", { root })).selections.size, 2);
  await assert.rejects(planActivation(options), /Restore pack one/);
  await skill(source, "external");
  await writeFile(path.join(source, "SKILL.md"), "Modified upstream content.\n");
  await assert.rejects(planActivation(options), /Local changes detected/);
});

test("preview reports changes and instructions without writing to the target", async (t) => {
  const { options, target } = await fixture(t);
  await writeFile(path.join(target, "AGENTS.md"), "# Target rules\n");
  const before = await readdir(target);
  const plan = await planActivation(options);
  assert.deepEqual(plan.changes.map((item) => item.action), ["add"]);
  assert.deepEqual(plan.instructions, [path.join(target, "AGENTS.md")]);
  assert.deepEqual(await readdir(target), before);
  assert(!await exists(path.join(target, ".home-repo")));
});

test("applies independent snapshots, refreshes source edits, and is idempotent", async (t) => {
  const { options, source, target } = await fixture(t);
  await mkdir(path.join(source, "references"));
  await writeFile(path.join(source, "references/rules.md"), "First revision.\n");
  await writeFile(path.join(source, "metadata.json"), '{"example":true}\n');
  await applyActivation(options);
  const installed = path.join(target, ".agents/skills/review");
  assert((await lstat(installed)).isDirectory());
  assert.equal(await snapshotHash(installed), await snapshotHash(source));
  assert.equal((await planActivation(options)).changes[0].action, "keep");
  await writeFile(path.join(source, "references/rules.md"), "Second revision.\n");
  assert.equal(await readFile(path.join(installed, "references/rules.md"), "utf8"), "First revision.\n");
  assert.equal((await planActivation(options)).changes[0].action, "update");
  await applyActivation(options);
  assert.equal(await readFile(path.join(installed, "references/rules.md"), "utf8"), "Second revision.\n");
  const state = JSON.parse(await readFile(path.join(target, ".home-repo/skills.json"), "utf8"));
  assert.equal(state.profile, "dev");
  assert(!JSON.stringify(state).includes(source));
  await applyActivation(options);
  assert.equal(git(target, "status", "--porcelain"), "");
});

test("switches profiles and removes only owned skills, preserving unrelated files", async (t) => {
  const { options, target } = await fixture(t);
  const unmanaged = path.join(target, ".agents/skills/user-skill");
  await skill(unmanaged, "user-skill");
  await applyActivation(options);
  await applyActivation({ ...options, profile: "empty" });
  assert(!await exists(path.join(target, ".agents/skills/review")));
  assert(await exists(path.join(unmanaged, "SKILL.md")));
  await applyActivation(options);
  await applyActivation({ root: options.root, target, remove: true });
  assert(!await exists(path.join(target, ".agents/skills/review")));
  assert(await exists(unmanaged));
});

test("rejects unmanaged destinations without overwriting even identical content", async (t) => {
  const { options, target } = await fixture(t);
  await skill(path.join(target, ".agents/skills/review"), "review");
  await assert.rejects(applyActivation(options), /Unmanaged destination/);
  assert(!await exists(path.join(target, ".home-repo/skills.json")));
});

test("refuses changes to any owned file, including metadata and extra empty directories", async (t) => {
  const { options, target } = await fixture(t);
  await applyActivation(options);
  const installed = path.join(target, ".agents/skills/review");
  await writeFile(path.join(installed, "metadata.json"), '{"local":"edit"}\n');
  await assert.rejects(applyActivation(options), /Local changes detected/);
  await assert.rejects(applyActivation({ ...options, remove: true }), /Local changes detected/);
  await rm(path.join(installed, "metadata.json"));
  await mkdir(path.join(installed, "my-notes"));
  await assert.rejects(planActivation(options), /Local changes detected/);
});

test("rejects symlinked destinations, unsafe receipt paths, and missing owned copies", async (t) => {
  const { options, target, base } = await fixture(t);
  await symlink(base, path.join(target, ".agents"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(planActivation(options), /symlinks/);
  await rm(path.join(target, ".agents"));
  await applyActivation(options);
  const filename = path.join(target, ".home-repo/skills.json");
  const state = JSON.parse(await readFile(filename, "utf8"));
  state.entries[0].path = "../outside";
  await json(filename, state);
  await assert.rejects(planActivation(options), /Unsafe activation/);
  state.entries[0].path = ".agents/skills/review";
  await json(filename, state);
  await rm(path.join(target, state.entries[0].path), { recursive: true });
  await assert.rejects(planActivation(options), /Managed skill is missing/);
});

test("requires Git-ignored generated paths and refuses tracked destinations", async (t) => {
  const { options, target } = await fixture(t);
  await writeFile(path.join(target, ".git/info/exclude"), "");
  assert((await planActivation(options)).unignored.length > 0);
  await assert.rejects(applyActivation(options), /Ignore \/.home-repo/);
  assert(!await exists(path.join(target, ".home-repo")));
  await writeFile(path.join(target, ".git/info/exclude"), "/.home-repo/\n");
  await assert.rejects(applyActivation(options), /must be Git-ignored/);
  await skill(path.join(target, ".agents/skills/review"), "review");
  git(target, "add", ".agents/skills/review");
  await assert.rejects(planActivation(options), /Git-tracked destination/);
});

test("refuses global, source-tree, nested, and non-Git targets", async (t) => {
  const { root, target, base } = await fixture(t);
  await assert.rejects(inspectTarget(root, { root }), /independent/);
  await assert.rejects(inspectTarget(os.homedir(), { root }), /global target/);
  await assert.rejects(inspectTarget(base, { root }), /independent/);
  const notGit = path.join(base, "not-git");
  await mkdir(notGit);
  await assert.rejects(inspectTarget(notGit, { root }), /Git check failed/);
  const nested = path.join(target, "nested");
  await mkdir(nested);
  await assert.rejects(inspectTarget(nested, { root }), /repository\/worktree root/);
});

test("honors activation locks without deleting another invocation's lock", async (t) => {
  const { options, target } = await fixture(t);
  await mkdir(path.join(target, ".home-repo"));
  const filename = path.join(target, ".home-repo/skills.lock");
  await writeFile(filename, "Another invocation.\n");
  await assert.rejects(applyActivation(options), /Another activation/);
  assert.equal(await readFile(filename, "utf8"), "Another invocation.\n");
});

test("uses agent-specific locations and preserves independent worktree activation sets", async (t) => {
  const { options, target, root, base, source } = await fixture(t);
  await applyActivation({ ...options, agents: ["claude-code"] });
  assert(await exists(path.join(target, ".claude/skills/review/SKILL.md")));
  assert(!await exists(path.join(target, ".agents")));
  // Commit only an empty test fixture, with hooks and signing disabled.
  const hooks = path.join(base, "empty-hooks");
  await mkdir(hooks);
  git(target, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${hooks}`,
    "commit", "--quiet", "--allow-empty", "-m", "test fixture");
  const second = path.join(base, "linked worktree");
  git(target, "-c", `core.hooksPath=${hooks}`, "worktree", "add", "--quiet", "--detach", second);
  assert((await lstat(path.join(second, ".git"))).isFile());
  await applyActivation({ root, target: second, profile: "dev", agents: ["codex", "pi"] });
  await writeFile(path.join(source, "SKILL.md"), "---\nname: review\ndescription: Updated.\n---\n");
  await applyActivation({ ...options, agents: ["claude-code"] });
  assert.notEqual(await snapshotHash(path.join(second, ".agents/skills/review")), await snapshotHash(source));
});

test("rolls back earlier writes when a later destination cannot be installed", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async (t) => {
  const { options, target } = await fixture(t);
  const blocked = path.join(target, ".claude/skills");
  await mkdir(blocked, { recursive: true });
  await chmod(blocked, 0o500);
  try {
    await assert.rejects(applyActivation({ ...options, agents: ["opencode", "claude-code"] }), /EACCES/);
    assert(!await exists(path.join(target, ".agents/skills/review")));
    assert(!await exists(path.join(target, ".home-repo/skills.json")));
    assert(!await exists(path.join(target, ".home-repo/skills.lock")));
  } finally {
    await chmod(blocked, 0o700);
  }
});

test("rollback restores an updated snapshot and its original ownership receipt", {
  skip: process.platform === "win32" || process.getuid?.() === 0,
}, async (t) => {
  const { options, target, source } = await fixture(t);
  await applyActivation(options);
  const original = await snapshotHash(path.join(target, ".agents/skills/review"));
  const receiptFile = path.join(target, ".home-repo/skills.json");
  const receipt = await readFile(receiptFile, "utf8");
  await writeFile(path.join(source, "notes.md"), "New source revision.\n");
  const blocked = path.join(target, ".claude/skills");
  await mkdir(blocked, { recursive: true });
  await chmod(blocked, 0o500);
  try {
    await assert.rejects(applyActivation({ ...options, agents: ["opencode", "claude-code"] }), /EACCES/);
    assert.equal(await snapshotHash(path.join(target, ".agents/skills/review")), original);
    assert.equal(await readFile(receiptFile, "utf8"), receipt);
    assert(!await exists(path.join(target, ".home-repo/skills.lock")));
  } finally {
    await chmod(blocked, 0o700);
  }
});

test("rejects bundle symlinks and detects executable-bit changes", async (t) => {
  const { source, options, base, target } = await fixture(t);
  const filename = path.join(source, "helper.sh");
  await writeFile(filename, "#!/bin/sh\nexit 0\n");
  await chmod(filename, 0o755);
  await applyActivation(options);
  const installed = path.join(target, ".agents/skills/review/helper.sh");
  assert.equal((await lstat(installed)).mode & 0o111, (await lstat(filename)).mode & 0o111);
  if (process.platform !== "win32") {
    await chmod(installed, 0o644);
    await assert.rejects(planActivation(options), /Local changes detected/);
    await chmod(installed, 0o755);
  }
  await symlink(base, path.join(source, "external-link"),
    process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(planActivation(options), /must not contain symlinks/);
});

test("CLI parsing requires explicit target, agents, and write authorization", () => {
  assert.throws(() => parseArguments(["apply", "dev", "--target", "/repo", "--agent", "opencode"]), /requires --write/);
  assert.throws(() => parseArguments(["plan", "dev", "--target", "/repo"]), /Usage/);
  assert.throws(() => parseArguments(["plan", "dev", "--target", "/repo", "--agent", "opencode", "--write"]), /never writes/);
  assert.throws(() => parseArguments(["plan", "dev", "--target", "/repo", "--agent", "unknown"]), /Unsupported agent/);
  assert.throws(() => parseArguments(["plan", "dev", "--target", "/repo", "--agent", "opencode", "--global"]), /Unsupported option/);
  assert.equal(parseArguments(["remove", "--target", "/repo"]).write, false);
  assert.equal(parseArguments(["remove", "--target", "/repo", "--write"]).write, true);
});

test("CLI entry point runs and fails closed without arguments", () => {
  const filename = fileURLToPath(new URL("../scripts/profiles.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [filename], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
});

test("CLI previews and applies the empty profile only to an explicit temporary target", async (t) => {
  const { target } = await fixture(t);
  const filename = fileURLToPath(new URL("../scripts/profiles.mjs", import.meta.url));
  function cli(args) {
    const result = spawnSync(process.execPath, [filename, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  const args = ["global", "--target", target, "--agent", "opencode"];
  assert.match(cli(["plan", ...args]), /Preview: global/);
  assert(!await exists(path.join(target, ".home-repo")));
  assert.match(cli(["apply", ...args, "--write"]), /Applied: global/);
  const receipt = JSON.parse(await readFile(path.join(target, ".home-repo/skills.json"), "utf8"));
  assert.equal(receipt.profile, "global");
  assert.deepEqual(receipt.entries, []);
  assert.match(cli(["remove", "--target", target]), /Preview: remove managed skills/);
  assert.match(cli(["remove", "--target", target, "--write"]), /Applied: remove managed skills/);
});
