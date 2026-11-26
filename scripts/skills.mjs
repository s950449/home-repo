#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  AGENTS, ROOT, assertInstallationsSafe, assertLockMatchesManifest,
  exists, loadPack, readJson,
} from "./skill-state.mjs";

async function main() {
  const [operation, name, ...args] = process.argv.slice(2);
  if (!["restore", "plan", "sync"].includes(operation) || !name) {
    throw new Error("Usage: npm run skills:<restore|plan|sync> -- <pack> --agent <agents...> [--write-lock]");
  }
  const agents = [];
  let writeLock = false;
  for (let index = 0; index < args.length;) {
    if (args[index] === "--write-lock") {
      writeLock = true;
      index++;
    } else if (args[index] === "--agent") {
      index++;
      const start = index;
      while (index < args.length && !args[index].startsWith("--")) {
        if (!AGENTS.has(args[index])) throw new Error(`Unsupported agent: ${args[index]}`);
        agents.push(args[index++]);
      }
      if (index === start) throw new Error("--agent requires at least one explicit agent");
    } else {
      throw new Error(`Unsupported option: ${args[index]}`);
    }
  }
  if (!agents.length) throw new Error("Select agents explicitly; automatic detection and global installs are disabled");
  if (operation === "sync" && !writeLock) throw new Error("Sync can change locks; add --write-lock after reviewing the manifest");
  if (operation !== "sync" && writeLock) throw new Error("--write-lock is only valid for sync");

  const installedTool = await readJson(path.join(ROOT, "node_modules/skills/package.json"));
  const configured = await readJson(path.join(ROOT, "package.json"));
  if (installedTool.version !== configured.devDependencies.skills) {
    throw new Error("Installed skills CLI does not match package.json; run npm ci --ignore-scripts");
  }
  const pack = await loadPack(name, { allowMissingLock: operation === "sync" });
  await assertInstallationsSafe(pack);
  if (operation !== "sync") await assertLockMatchesManifest(pack);
  const beforeLock = await exists(pack.lockPath) ? await readFile(pack.lockPath) : null;
  const cli = path.join(ROOT, "node_modules/skills", installedTool.bin.skills);
  const targetAgents = [...new Set(agents)];
  const environment = {
    ...process.env, DO_NOT_TRACK: "1", DISABLE_TELEMETRY: "1",
    GIT_TERMINAL_PROMPT: "0", CI: "1",
  };
  const commands = operation === "sync"
    ? [
      ...(pack.manifest.skills?.length
        ? [["experimental_sync", "--yes", "--no-frozen-lockfile"]] : []),
      ...(pack.manifest.homeRepo?.localSkills ?? [])
        .map((source) => ["add", source, "--copy", "--yes"]),
    ]
    : [["install", "--frozen-lockfile", ...(operation === "plan" ? ["--dry-run"] : [])]];
  if (pack.manifest.skills?.length && pack.manifest.homeRepo?.localSkills?.length) {
    throw new Error("Keep Git packs and vendored-exception packs separate");
  }
  console.log(`${operation}: ${name}; agents: ${targetAgents.join(", ")}; scope: ${pack.directory}`);
  for (const command of commands) {
    const result = spawnSync(process.execPath, [cli, ...command, "--agent", ...targetAgents], {
      cwd: pack.directory, env: environment, stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Skills CLI failed (${result.status ?? result.signal})`);
  }
  const afterLock = await readFile(pack.lockPath);
  if (operation !== "sync" && !beforeLock?.equals(afterLock)) {
    throw new Error("Frozen operation unexpectedly changed the lockfile; inspect changes before continuing");
  }
  const refreshed = await loadPack(name);
  await assertLockMatchesManifest(refreshed);
  await assertInstallationsSafe(refreshed);
  if (operation !== "plan") {
    const installed = new Set(await readdir(path.join(pack.directory, ".agents/skills")));
    for (const id of refreshed.declarations.keys()) {
      if (!installed.has(id)) throw new Error(`Skill was not installed: ${id}`);
    }
    if (targetAgents.includes("claude-code")) {
      for (const id of refreshed.declarations.keys()) {
        if (!await exists(path.join(pack.directory, ".claude/skills", id))) {
          throw new Error(`Claude Code installation is missing: ${id}`);
        }
      }
    }
  }
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
