#!/usr/bin/env node
// Validates provenance records for vendored skill exceptions.
// Structural checks run offline in `npm run validate`. The `verify-upstream`
// command downloads each pinned upstream commit and recomputes its bundle hash.
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ID, ROOT, exists, isWithin, readJson, skillHash } from "./skill-state.mjs";

const KINDS = new Set(["rendered-vendor-exception", "modified-vendor-exception"]);
const REPOSITORY = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ALLOWED_KEYS = new Set([
  "schema_version", "skill", "kind", "upstream_url", "upstream_commit", "upstream_tag",
  "upstream_path", "upstream_plugin_version", "license", "verified_on", "transformations",
  "verification", "upstream_bundle_sha256", "upstream_bundle_hash_algorithm",
]);

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export function assertSourceRecord(record, label) {
  const fail = (message) => { throw new Error(`${label}: ${message}`); };
  if (!record || typeof record !== "object" || Array.isArray(record)) fail("expected a JSON object");
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.has(key)) fail(`unknown field ${key}`);
  }
  if (record.schema_version !== 1) fail("schema_version must be 1");
  if (typeof record.skill !== "string" || !ID.test(record.skill)) fail("skill must be a skill ID");
  if (!KINDS.has(record.kind)) fail(`kind must be one of ${[...KINDS].join(", ")}`);
  if (!REPOSITORY.test(record.upstream_url ?? "")) fail("upstream_url must be https://github.com/<owner>/<repo>");
  if (!COMMIT.test(record.upstream_commit ?? "")) fail("upstream_commit must be a full commit SHA");
  if (typeof record.upstream_path !== "string" || path.posix.isAbsolute(record.upstream_path)
      || record.upstream_path.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("upstream_path must be a normalized relative path");
  }
  for (const key of ["upstream_tag", "upstream_plugin_version"]) {
    if (key in record && !nonEmptyString(record[key])) fail(`${key} must be a non-empty string`);
  }
  if (!nonEmptyString(record.license)) fail("license is required");
  if (!DATE.test(record.verified_on ?? "") || Number.isNaN(Date.parse(record.verified_on))) {
    fail("verified_on must be a YYYY-MM-DD date");
  }
  if (!Array.isArray(record.transformations) || !record.transformations.length
      || !record.transformations.every(nonEmptyString)) {
    fail("transformations must list every local change");
  }
  if (!nonEmptyString(record.verification)) fail("verification is required");
  if (!SHA256.test(record.upstream_bundle_sha256 ?? "")) fail("upstream_bundle_sha256 must be a SHA-256 hex digest");
  if (record.upstream_bundle_hash_algorithm !== "skills-lock-v2") {
    fail("upstream_bundle_hash_algorithm must be skills-lock-v2");
  }
}

// Returns one entry per directory in skills/vendor after checking its layout.
export async function loadVendorSources(root = ROOT) {
  const vendor = path.join(root, "skills", "vendor");
  if (!await exists(vendor)) return [];
  const sources = [];
  for (const entry of await readdir(vendor, { withFileTypes: true })) {
    if (!entry.isDirectory()) throw new Error(`Unexpected non-directory in skills/vendor: ${entry.name}`);
    const directory = path.join(vendor, entry.name);
    const label = `skills/vendor/${entry.name}`;
    if (!await exists(path.join(directory, "SOURCE.json"))) throw new Error(`${label}: SOURCE.json is missing`);
    const record = await readJson(path.join(directory, "SOURCE.json"));
    assertSourceRecord(record, `${label}/SOURCE.json`);
    const license = path.join(directory, "LICENSE");
    if (!await exists(license) || !(await readFile(license, "utf8")).trim()) {
      throw new Error(`${label}: LICENSE is missing or empty`);
    }
    const skillDirectory = path.join(directory, record.skill);
    if (!await exists(path.join(skillDirectory, "SKILL.md"))) {
      throw new Error(`${label}: ${record.skill}/SKILL.md is missing`);
    }
    if (await realpath(skillDirectory) !== skillDirectory) throw new Error(`${label}: skill path must not be a symlink`);
    const text = await readFile(path.join(skillDirectory, "SKILL.md"), "utf8");
    const name = /^name:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/m.exec(text)?.[1];
    if (name !== record.skill) throw new Error(`${label}: SKILL.md name ${name} differs from SOURCE.json skill`);
    sources.push({ name: entry.name, directory, skillDirectory, record });
  }
  return sources;
}

// Every vendored bundle must be referenced by exactly one pack declaration,
// and every pack-local declaration must point at a documented vendor bundle.
export async function assertVendorProvenance(packs, root = ROOT) {
  const sources = await loadVendorSources(root);
  const bySkillDirectory = new Map(sources.map((source) => [source.skillDirectory, source]));
  const referenced = new Map();
  for (const pack of packs) {
    for (const [id, declared] of pack.declarations) {
      if (declared.type !== "local") continue;
      const source = bySkillDirectory.get(declared.target);
      if (!source) throw new Error(`Local skill lacks a documented vendor exception in ${pack.name}: ${id}`);
      if (source.record.skill !== id) throw new Error(`SOURCE.json skill differs from ${pack.name}: ${id}`);
      if (referenced.has(source.name)) {
        throw new Error(`Vendor exception is declared by multiple packs: ${source.name}`);
      }
      referenced.set(source.name, pack.name);
    }
  }
  for (const source of sources) {
    if (!referenced.has(source.name)) throw new Error(`Vendor exception is not declared by any pack: ${source.name}`);
  }
  return sources.length;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: ["ignore", "inherit", "inherit"], ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status ?? result.signal})`);
}

async function downloadTarball(url, destination) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

// Downloads the pinned commit archive into an empty temporary directory and
// recomputes the skills-lock-v2 hash of the declared upstream path.
export async function upstreamBundleHash(record, { download = downloadTarball, tmp = os.tmpdir() } = {}) {
  const [, owner, repo] = REPOSITORY.exec(record.upstream_url);
  const work = await realpath(await mkdtemp(path.join(tmp, "home-repo-upstream-")));
  try {
    const archive = path.join(work, "source.tar.gz");
    const extracted = path.join(work, "source");
    await download(`https://codeload.github.com/${owner}/${repo}/tar.gz/${record.upstream_commit}`, archive);
    await mkdir(extracted);
    run("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner", "--no-same-permissions"]);
    const [top, ...rest] = await readdir(extracted);
    if (!top || rest.length) throw new Error(`Unexpected archive layout for ${record.upstream_url}`);
    const bundle = path.join(extracted, top, ...record.upstream_path.split("/"));
    if (!isWithin(extracted, bundle) || !await exists(path.join(bundle, "SKILL.md"))) {
      throw new Error(`Upstream path has no SKILL.md: ${record.upstream_path}`);
    }
    return await skillHash(bundle);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export async function verifyUpstream({ root = ROOT, ...options } = {}) {
  const failures = [];
  for (const source of await loadVendorSources(root)) {
    const { record } = source;
    const label = `${source.name} (${record.upstream_url}@${record.upstream_commit.slice(0, 7)})`;
    try {
      const actual = await upstreamBundleHash(record, options);
      if (actual !== record.upstream_bundle_sha256) {
        failures.push(`${label}: upstream bundle hash is ${actual}, SOURCE.json records ${record.upstream_bundle_sha256}`);
      } else {
        console.log(`OK: ${label} matches upstream_bundle_sha256`);
      }
    } catch (error) {
      failures.push(`${label}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`Upstream provenance check failed:\n- ${failures.join("\n- ")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command] = process.argv.slice(2);
  if (command !== "verify-upstream") {
    console.error("Usage: node scripts/provenance.mjs verify-upstream");
    process.exitCode = 1;
  } else {
    verifyUpstream().catch((error) => {
      console.error(`ERROR: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
