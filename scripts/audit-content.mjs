#!/usr/bin/env node
// Heuristic review aid for third-party skill content. It flags files and text
// patterns that deserve a human look; it does not prove content is safe.
// Only hidden Unicode controls fail the run, because they have no legitimate
// use in agent instructions and can conceal text from reviewers.
import { appendFile, lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROOT, exists } from "./skill-state.mjs";

const SCRIPT_EXTENSIONS = new Set([
  ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".cmd", ".py", ".rb", ".pl",
  ".js", ".mjs", ".cjs", ".ts", ".mts", ".cts",
]);
const OMIT_DIRS = new Set([".git", "node_modules", "__pycache__"]);
// Bidirectional overrides/isolates and Unicode tag characters.
const HIDDEN = /[\u202A-\u202E\u2066-\u2069]|\uDB40[\uDC00-\uDC7F]/u;
const PATTERNS = [
  ["pipe-to-shell", /\b(?:curl|wget)\b[^\n]*\|\s*(?:sudo\s+)?(?:ba|z|da)?sh\b/],
  ["unpinned-package", /\b(?:npx|bunx|pnpm\s+dlx|uvx|pipx\s+run)\s+(?:-\S+\s+)*\S+@latest\b/],
  ["encoded-payload", /\bbase64\s+(?:-d|--decode)\b|\bfrom(?:_base64|Base64)\b|\batob\(/],
  ["destructive-command", /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(?:\/|~|\$HOME)(?:\s|$)/],
  ["privilege-escalation", /\bsudo\s+\S/],
  ["credential-access", /~\/\.(?:ssh|aws|gnupg|netrc|docker\/config\.json)|\bid_rsa\b/],
  ["safety-override", /\bignore (?:all |any )?(?:previous|prior|above) instructions\b/i],
];

export async function auditRoots(roots) {
  const findings = [];
  const add = (severity, rule, file, detail) => findings.push({ severity, rule, file, detail });
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(ROOT, filename) || filename;
      if (entry.isSymbolicLink()) {
        add("warning", "symlink", relative, "symbolic link");
      } else if (entry.isDirectory()) {
        if (!OMIT_DIRS.has(entry.name)) await walk(filename);
      } else if (entry.isFile()) {
        const info = await lstat(filename);
        if (info.mode & 0o111) add("notice", "executable", relative, "executable bit set");
        if (SCRIPT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          add("notice", "script", relative, "script file");
        }
        const content = await readFile(filename);
        if (content.includes(0)) {
          add("notice", "binary", relative, `${content.length} bytes`);
          continue;
        }
        const lines = content.toString("utf8").split("\n");
        lines.forEach((line, index) => {
          const at = `${relative}:${index + 1}`;
          if (HIDDEN.test(line)) add("error", "hidden-unicode", at, "bidirectional control or tag character");
          for (const [rule, pattern] of PATTERNS) {
            if (pattern.test(line)) add("warning", rule, at, line.trim().slice(0, 160));
          }
        });
      }
    }
  }
  for (const root of roots) if (await exists(root)) await walk(root);
  return findings;
}

export async function defaultRoots(root = ROOT) {
  const roots = [path.join(root, "skills", "vendor")];
  for (const entry of await readdir(path.join(root, "packs"), { withFileTypes: true })) {
    if (entry.isDirectory()) roots.push(path.join(root, "packs", entry.name, ".agents", "skills"));
  }
  return roots;
}

export function formatReport(findings, scanned) {
  const escape = (text) => text.replace(/\|/g, "\\|").replace(/`/g, "'");
  const counts = {};
  for (const finding of findings) counts[finding.rule] = (counts[finding.rule] ?? 0) + 1;
  const lines = [
    "## Skill content audit",
    "",
    `Scanned ${scanned} roots. Heuristic findings are review prompts, not verdicts.`,
    "",
    findings.length ? "| Rule | Count |\n| --- | --- |\n" + Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b)).map(([rule, count]) => `| ${rule} | ${count} |`).join("\n")
      : "No findings.",
  ];
  if (findings.length) {
    lines.push("", "| Severity | Rule | Location | Detail |", "| --- | --- | --- | --- |");
    for (const { severity, rule, file, detail } of findings) {
      lines.push(`| ${severity} | ${rule} | \`${escape(file)}\` | ${escape(detail)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const roots = await defaultRoots();
  const findings = await auditRoots(roots);
  const report = formatReport(findings, roots.length);
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
  const errors = findings.filter((finding) => finding.severity === "error");
  if (errors.length) {
    console.error(`ERROR: ${errors.length} hidden Unicode control(s) found; inspect them before trusting the content.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
