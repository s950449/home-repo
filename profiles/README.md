# Profiles and project activation

Profiles select reusable skills for a work context. They are Home Repo data, not
native harness configuration or permission grants. Saving a profile does not
install or activate anything.

## Compose a profile

Version 2 profiles select zero or more complete external packs and individual
personal skills. For example, after creating `skills/personal/code-review/SKILL.md`,
save this as `profiles/my-backend.json`:

```json
{
  "schema_version": 2,
  "id": "my-backend",
  "description": "Backend development with personal review practices.",
  "packs": ["cloudflare-worker"],
  "personal": ["code-review"]
}
```

- `id` must match the JSON filename without its extension.
- `packs` contains directory names from `packs/`; their manifests and native
  locks remain authoritative. Use small packs to select external capabilities.
- `personal` contains directory names from `skills/personal/`. Each source needs
  `SKILL.md` frontmatter with a matching lowercase kebab-case `name` and a
  nonempty single-line `description`. Maintain source content in American English.
- Use `"packs": []` for a personal-only profile, or `"personal": []` for an
  external-only profile. Empty selections are allowed.
- Multiple profiles may reuse the same personal source without duplicating it.
  No GitHub publication or personal-skill lockfile is required.
- Duplicate array entries and personal/external name conflicts fail validation.
  Overlapping packs deduplicate a skill only when its pinned source, version,
  path, and native content hash are identical. Conflicting versions fail.
- Legacy version 1 profiles remain readable, with their original requirement
  that `skills` exactly match the single declared `pack`. Do not mix v1 and v2
  fields in one file.

The included profiles are:

| Profile | External packs | Personal skills |
| --- | --- | --- |
| `global` | None | None; intentionally empty, not a global install |
| `cloudflare-worker` | `cloudflare-worker` | None |
| `cloudflare-agent` | `cloudflare-agent` | None |

Do not combine incompatible Sandbox release lines in a general profile.
Task-specific workflows do not need to become defaults for every project.

## Restore external sources separately

Profile deployment is offline and never restores, updates, or installs packs
implicitly. Restore each selected external pack explicitly first:

```sh
npm run skills:restore -- cloudflare-worker --agent opencode
```

For a personal-only profile, this step is unnecessary. Run `npm run validate`
and `npm test` after editing profiles or management code.

## Preview a project or worktree

From the Home Repo root, specify an independent Git repository/worktree root and
explicit agent IDs:

```sh
npm run profiles:plan -- my-backend --target /path/to/project --agent opencode
```

Plans write nothing. They show the target, its Git status, root instruction
files, source paths and external versions, and `add`, `keep`, `update`, or
`remove` operations. Missing or modified external installations fail instead of
triggering a download.

Before applying, read the target's applicable `AGENTS.md` and/or `CLAUDE.md`,
including applicable ancestor or nested instructions, review its Git status,
and obtain authorization for that target. Root instruction paths printed by the
plan are a reminder, not an exhaustive instruction-discovery system.

## Keep generated files out of Git

Activation refuses Git-tracked destinations and requires generated paths to be
Git-ignored. Configure the target yourself; the command never edits `.gitignore`
or Git configuration. For example, add these patterns to the target's
`.gitignore`, or to its local Git exclude file:

```gitignore
/.home-repo/
/.agents/skills/
/.claude/skills/
```

You only need the skill locations used by your selected agents. Find the local
exclude file with `git -C /path/to/project rev-parse --git-path info/exclude`.
Linked worktrees normally share that exclude file. Ignore patterns do not
authorize overwriting existing files, and existing tracked team skills remain
protected.

## Explicitly apply

```sh
npm run profiles:apply -- my-backend --target /path/to/project --agent opencode --write
```

Accepted agents are `codex`, `opencode`, `pi`, and `claude-code`. Multiple explicit
IDs are allowed:

- Codex, OpenCode, and pi share `.agents/skills/<id>/`.
- Claude Code uses `.claude/skills/<id>/`.
- Selecting both groups creates matching independent copies in both locations.
  Agent selection chooses paths, not access controls. Other compatible harnesses
  may also discover those paths.

The command copies complete bundles, including references, scripts, and assets.
It never links a project to mutable personal sources or shared pack installs.
Edit personal skills in `skills/personal/`, then preview and apply again to
refresh a project's snapshot. A source edit alone changes no deployed copy.

Applying another profile in the same target replaces its activation set. There
is **one managed activation set per target/worktree**, not per agent or session.
For simultaneous independent profiles, use separate worktrees; never switch a
shared target underneath a running session.

## Safeguards and removal

The ignored `.home-repo/skills.json` receipt records only managed paths, origins,
versions, and snapshot hashes; no absolute source paths are recorded. Deployment:

- preserves unrelated skills and never clears an entire discovery directory;
- refuses an existing unmanaged destination, even if its content is identical;
- refuses modified or missing managed copies instead of overwriting, removing,
  or silently repairing them;
- hashes every file, exact bytes, executable bits, and empty directories,
  including `metadata.json`, when checking ownership;
- rejects source bundle symlinks, symlinked destination paths, unsafe receipt
  paths, and targets inside or containing the Home Repo source tree;
- accepts only explicit independent Git roots, never global destinations;
- uses a target-local exclusive lock, stages copies, rechecks sources and owned
  content, and attempts rollback if a filesystem operation fails.

To remove only managed skills, first preview, then explicitly write:

```sh
npm run profiles:remove -- --target /path/to/project
npm run profiles:remove -- --target /path/to/project --write
```

Removal also refuses local edits. Preserve intentional edits in the appropriate
source first. There is no force/adopt switch. Empty parent directories and the
empty receipt can remain after removal.

Ordinary failures attempt rollback; this is not a crash-proof transaction.
After interruption, inspect `.home-repo/skills.lock`, any `.skills-stage-*`
directory, the receipt, and installed files before recovering. Do not delete a
lock while another invocation may be running. Rollback failures retain staging
backups and report their path. External edits during filesystem operations are
not an isolation boundary.

Deployment does not change global installations, harness configuration, MCP
servers, permissions, dependencies, or implicit-invocation rules. Skills from
other discovery paths can remain visible or override these copies. Only Linux
has been tested; other harness and operating-system behavior needs verification.
