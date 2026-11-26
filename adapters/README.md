# Harness adapters

Share skill bundles while handling discovery paths, invocation, permissions,
MCP, and model settings separately. Pack restoration now delegates installation
to the pinned skills CLI. No global harness settings have been modified.

| Harness | Project skill locations |
| --- | --- |
| Codex | `.agents/skills/<id>/SKILL.md` |
| OpenCode V2 | `.agents/skills/`, `.opencode/skills/`, or explicitly configured sources |
| pi | `.agents/skills/`, `.pi/skills/`, or explicitly configured sources |
| Claude Code | `.claude/skills/<id>/SKILL.md` |

Before implementing an adapter, check the installed version and its documentation.
Do not assume discovery order, name-collision handling, implicit-invocation
controls, dynamic shell expansion, or tool permissions behave identically across
harnesses. Do not install the same skill through multiple sources in one harness.

## Portability

- Use the complete `SKILL.md` directory format and preserve supporting files
  within each bundle.
- Keep skill IDs, directory names, and frontmatter names aligned rather than
  depending on harness-specific exceptions.
- Keep shared instructions in `AGENTS.md`; do not maintain separate
  harness-specific instruction entry files for this Home Repo.
- Avoid hardcoding model and tool names in shared skill content. Keep necessary
  harness-specific behavior in adapters.
- A readable format does not imply available tools. Check MCP servers, execution
  engines, and operating system dependencies separately.
- The `.sh` scripts in `turnstile-spin` are not native PowerShell scripts.
  Do not claim that all existing bundles run on every operating system.
- Manifests and native locks are the authority for external content; installed
  files, links, and copies are generated artifacts.
- The CLI uses shared canonical bundles and agent links, with Windows junctions
  and copy fallback. The REA exception records copy mode explicitly. Only Linux
  restoration has been tested.
- Explicit agent selection controls installation destinations, not access to
  a shared `.agents/skills` directory. Existing global skills remain discoverable.

## Scope of the current wrapper

`scripts/skills.mjs` restores only inside a selected pack. It validates source pins,
uses frozen locks by default, requires explicit agents, and stops on modified or
untracked destinations. Lock-writing sync requires `--write-lock`.

It does not deploy to arbitrary projects, register MCP servers, install analysis
engines, or alter global settings.

## Explicit profile deployment

`scripts/profiles.mjs` is a separate, offline deployment layer. Version 2 profiles
compose restored external packs and selected local personal skills. An explicit
target and agents are required; writes additionally require `--write`.

Preview with `profiles:plan`, deploy with `profiles:apply`, and preview/remove only
owned snapshots with `profiles:remove`. Shared-compatible agents use
`.agents/skills`; Claude Code uses `.claude/skills`. Selecting both groups creates
identical snapshots in both paths; existing global or explicitly configured
sources are unchanged and can still affect discovery or precedence.

Deployments require ignored generated paths and protect tracked files, existing
unmanaged skills, locally modified copies, and unsafe paths. They use independent
copies and a target-local ownership receipt instead of source symlinks. One
activation set belongs to one Git root/worktree; parallel selections need
different worktrees, not a shared profile switch.

No entire harness state directories are copied. No MCP registrations, software
installations, permission changes, or global settings are performed. The command
does not launch sessions or guarantee that a harness sees only the selected
skills. See [`profiles/README.md`](../profiles/README.md) for the full workflow,
crash-recovery limits, and instruction-review requirements.

## Official documentation

- https://developers.openai.com/codex/build-skills
- https://opencode.ai/docs/skills
- https://pi.dev/docs/latest/skills
- https://code.claude.com/docs/en/skills
