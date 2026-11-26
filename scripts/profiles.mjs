#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { applyActivation, planActivation } from "./activation-state.mjs";
import { AGENTS } from "./skill-state.mjs";

function usage() {
  return "Usage: npm run profiles:<plan|apply> -- <profile> --target <repo> --agent <agents...> [--write]\n"
    + "       npm run profiles:remove -- --target <repo> [--write]";
}

export function parseArguments(argv) {
  const [operation, ...args] = argv;
  if (!["plan", "apply", "remove"].includes(operation)) throw new Error(usage());
  const options = { agents: [], remove: operation === "remove" };
  if (!options.remove) {
    options.profile = args.shift();
    if (!options.profile || options.profile.startsWith("--")) throw new Error(usage());
  }
  let write = false;
  for (let index = 0; index < args.length;) {
    const flag = args[index++];
    if (flag === "--target") {
      if (options.target || !args[index] || args[index].startsWith("--")) throw new Error(usage());
      options.target = args[index++];
    } else if (flag === "--agent" && !options.remove) {
      const start = index;
      while (index < args.length && !args[index].startsWith("--")) {
        if (!AGENTS.has(args[index])) throw new Error(`Unsupported agent: ${args[index]}`);
        options.agents.push(args[index++]);
      }
      if (index === start) throw new Error("--agent requires explicit IDs");
    } else if (flag === "--write" && !write) {
      write = true;
    } else {
      throw new Error(`Unsupported option: ${flag}`);
    }
  }
  if (!options.target || (!options.remove && !options.agents.length)) throw new Error(usage());
  if (operation === "plan" && write) throw new Error("Plan never writes");
  if (operation === "apply" && !write) throw new Error("Apply requires --write after reviewing the target and plan");
  return { options, write };
}

async function main() {
  const { options, write } = parseArguments(process.argv.slice(2));
  const plan = write ? await applyActivation(options) : await planActivation(options);
  console.log(`${write ? "Applied" : "Preview"}: ${plan.profile ?? "remove managed skills"}`);
  console.log(`Target: ${plan.directory}`);
  console.log(`Agents: ${plan.agents.join(", ") || "none"}`);
  console.log(`Target Git status:\n${plan.status || "(clean)"}`);
  console.log(`Read applicable instructions before applying: ${plan.instructions.join(", ") || "(none at root)"}`);
  for (const change of plan.changes) {
    console.log(`${change.action}: ${change.path}${change.origin ? ` <- ${change.origin}` : ""}`);
    if (change.source) console.log(`  Source: ${change.source}${change.version ? `; version: ${change.version}` : ""}`);
    if (change.digest) console.log(`  Snapshot: ${change.digest}`);
  }
  if (!plan.changes.length) console.log("No managed skill changes.");
  if (plan.unignored.length) {
    console.log(`Before applying, ignore generated paths in the target: ${plan.unignored.join(", ")}`);
  }
  console.log("No packs were restored, global settings changed, or permissions granted.");
}

// Keep the parser importable by offline tests without executing the CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
