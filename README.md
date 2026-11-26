# Agent Home Repo

A personal agent environment for independent repositories, multiple operating
systems, and Codex, OpenCode, pi, and Claude Code.

## Principles

- **Storage is not activation.** Keep reusable sources and dependency declarations
  here without installing everything globally.
- **Own your workflows, lock external dependencies.** Track personal skills as
  source. Use pinned upstream commits and native skill locks for external content.
- **Separate sources from installations.** Installed pack files are rebuildable,
  ignored artifacts, not independently maintained copies.
- **Vendor only documented exceptions.** Preserve provenance, licenses, and any
  differences from upstream.
- **Restore is not update.** Frozen restoration must not advance upstream commits
  or rewrite locks. Update only through an explicit, reviewed operation.
- **Keep local state out of Git.** Never track credentials, auth state, sessions,
  caches, or machine-specific paths.
- **Keep parallel sessions independent.** Do not switch shared global skill sets
  or update a pack underneath running sessions.

## Language policy

Use American English (`en-US`) for repository content, including skills, agent
instructions, documentation, comments, and templates. Translation and localization
skills may use other languages where explicitly required. This does not change
the user's preferred conversation language.

## Layout

```text
AGENTS.md                   Shared rules and cross-repository navigation
package.json                Exact skills CLI version and management commands
package-lock.json           npm dependency versions and integrity
packs/<pack>/package.json   Selected sources pinned to full commits
packs/<pack>/skills-lock.json
                            Native skill commits and SHA-256 content hashes
profiles/                   Work contexts composing packs and personal skills
skills/personal/            Personal skills, when added
skills/vendor/rea/          Documented rendered-skill exception and license
projects/                   Independent repository registry
adapters/                   Harness compatibility notes
scripts/                    Pack management, profile deployment, integrity checks
tests/                      Management-tool unit tests, not skill benchmarks
docs/migrations/            Historical local-import evidence
machine.local.json          Machine-local paths; excluded from Git
```

This is not a product monorepo or an npm workspace. Each pack is an independent
skill selection, not an application package.

## Setup

Requires Git and Node.js 22.20.0 or later. From the Home Repo root:

```sh
npm ci --ignore-scripts
npm run validate
npm test
```

`npm ci` installs the locked management tool, not skill packs. There are no
automatic `prepare` or post-install skill hooks.

Copy `machine.example.json` to `machine.local.json` and fill in local paths.
Machine mappings are data only; they do not clone repositories or grant access.

## Restore one pack

Preview and restore only the pack you need:

```sh
npm run skills:plan -- cloudflare-worker --agent codex opencode pi claude-code
npm run skills:restore -- cloudflare-worker --agent codex opencode pi claude-code
```

Use only the agent IDs you need. The wrapper requires explicit agent selection,
uses the pinned CLI, disables its telemetry, and invokes native
`skills install --frozen-lockfile` inside `packs/cloudflare-worker`.

Installed files remain under that pack's `.agents/skills/` and, when selected,
`.claude/skills/`. The wrapper refuses modified or untracked installation
destinations instead of letting native restore overwrite them.

**This does not install skills into arbitrary projects or global directories.**
Agent selection controls installation targets, not which harness can read the
shared `.agents/skills` directory.

**Existing global installations are unchanged.** They can still be visible in
sessions regardless of the selected pack. Cleaning them up requires a separate,
explicit decision.

See [available packs and maintenance](packs/README.md).

## Select personal and external skills per project

Keep each personal skill in `skills/personal/<id>/SKILL.md`. A version 2
profile can combine multiple external `packs` and individual `personal` skill
IDs; a personal-only profile needs no pack or GitHub publication.

After creating a profile and explicitly restoring any external packs it uses:

```sh
npm run profiles:plan -- my-backend --target /path/to/project --agent opencode
# Read the target instructions, review its Git status, and ignore generated paths.
npm run profiles:apply -- my-backend --target /path/to/project --agent opencode --write
```

Deployment copies an independent snapshot into the selected Git repository or
worktree. It requires ignored generated paths and refuses tracked, unmanaged,
modified, missing, or unsafe destinations. Switching profiles removes only
unchanged files recorded as owned by this tool. Nothing is installed globally.
Different concurrent profiles require separate worktrees.

See [profile format, safeguards, refresh, and removal](profiles/README.md).

## Working modes

- **Home mode:** Plan and navigate independent repositories from here. Specify
  the target project and profile.
- **Pack mode:** Start a harness in a restored pack directory to discover that
  pack's skills. This does not make another repository's settings active.
- **Project mode:** Implement and test in the target repository or worktree.
  Explicit profile deployment selects that target's skills separately from pack
  restoration; profile files alone never activate anything.

Always read the target repository's instructions and confirm its working
directory, Git status, and permissions before modifying it.

## Version control

Track manifests, native lockfiles, personal content, documented vendor exceptions,
and management scripts. Do not track `node_modules`, installed pack artifacts,
or machine-local state.

The 14 Cloudflare skills remain at their original matching commit
`626547c06881a20b3322bdc2ed6e6451b33a4fb6`, not today's upstream version.
REA retains its original rendered 6.8.0 skill with provenance and the MIT license.
See [migration evidence](docs/migrations/local-import.md).

No benchmark, automated skill improvement, MCP registration, or analysis-engine
installation has been added.
Content reproducibility does not guarantee upstream availability, workflow
correctness, or OS-specific tool compatibility. Only Linux has been tested.

## License

Original repository content is licensed under the GNU General Public License
version 3 only (`GPL-3.0-only`). See [LICENSE](LICENSE) for the full terms.

Third-party skills and dependencies retain their respective licenses. In
particular, the vendored REA skill remains under its
[MIT license](skills/vendor/rea/LICENSE); external skill packs retain their
upstream licenses.

## References

- [Home Repo Pattern](https://www.aihero.dev/the-home-repo-pattern)
- [skills 1.9.0 commands](https://github.com/vercel-labs/skills/blob/v1.9.0/docs/commands.md)
- [skills 1.9.0 lock semantics](https://github.com/vercel-labs/skills/blob/v1.9.0/README.md#lock-file-content-hash)
- [Codex skills](https://developers.openai.com/codex/build-skills)
- [OpenCode skills](https://opencode.ai/docs/skills)
- [pi skills](https://pi.dev/docs/latest/skills)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
