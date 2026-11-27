# Local-import dependency migration

Completed on November 26, 2026. This migration changed dependency management,
not skill content.

## Cloudflare: external dependencies

All 14 Cloudflare bundles matched the corresponding Git directory trees at:

- Repository: https://github.com/cloudflare/skills
- Commit: `626547c06881a20b3322bdc2ed6e6451b33a4fb6`
- Commit date: September 26, 2026
- Original installation records: September 29, 2026
- Upstream license: [Apache-2.0](https://github.com/cloudflare/skills/blob/626547c06881a20b3322bdc2ed6e6451b33a4fb6/LICENSE)

The existing skills CLI global lock supplied repository paths and Git folder
hashes. Those folder hashes matched the pinned upstream commit, and subsequent
clean-room restores matched every original file's bytes.

The 14 bundles are now declared in opt-in `packs/*/package.json` files and locked
with native v2 `skills-lock.json` files. Installed Cloudflare files are ignored
artifacts, not vendored source. The old `skills/vendor/local-import` directory
has been removed after verification.

## REA: a documented vendoring exception

The eight-file local bundle corresponds to:

- Repository: https://github.com/morluto/rea
- Commit: `160d821ac9a0310afcb8d1fc427862dd6508add5`
- Release tag: `rea-agents-6.8.0`
- Skill version: `49`
- License: MIT

All seven reference files match upstream byte for byte. The local `SKILL.md`
matches after pinning `rea-agents@latest` examples to `rea-agents@6.8.0` and
adding `metadata.tool_count: 229`. Its original installation command is unknown.

The unchanged rendered bundle is retained in
`skills/vendor/rea/reverse-engineer-anything`, with provenance and the upstream
license beside it. Its pack uses a relative local source and the same native
content-hash lock as other packs.

The CLI's native `package.json` `skills` field accepts Git and npm sources, not
local paths. The one `homeRepo.localSkills` declaration is a Home Repo extension
for this exception. Its lock was generated with native `skills add --copy`;
native `skills install --frozen-lockfile` restores it successfully from a
different checkout path.

## Verification

Using Node.js 26.13.1 and the published `skills@1.9.0` on Linux:

- Generated native locks for all 13 packs.
- Restored all 13 packs into a clean temporary checkout layout.
- Matched all 15 unique skills against the original snapshot content, including
  supporting files, using the original byte-sensitive SHA-256 tree algorithm.
- Confirmed frozen restores did not alter any lockfile.
- Confirmed a deliberately incorrect content hash failed without installing
  mismatched content or rewriting the lock.
- Confirmed all 15 original global installations remained unchanged.
- Passed nine unit tests for hash compatibility, CRLF handling, source pins,
  relative local sources, and protection of modified or untracked destinations.

This is dependency/integrity testing, not a skill benchmark. Windows and macOS
execution have not been tested. Upstream availability, tool dependencies, and
skill workflow correctness remain separate concerns.

## Historical evidence

`local-import-baseline.json` is the original snapshot manifest, retained only as
migration evidence. Its paths and initially unknown provenance describe the
pre-migration state; it is not an active installation lock.

Native `skills-lock.json` files are now the installation authority.
`skills/vendor/rea/SOURCE.json` describes the sole vendored exception.

## Global agent skills follow-up

On November 27, 2026, 17 skills from the global agent skill directory were
declared as five opt-in packs. The four upstream commits were selected by
matching every local file to its Git blob. For the 15 skills with a Git folder
hash in the original installation record, the upstream tree also matched.

| Packs | Upstream | Matching commit | License at the pin |
| --- | --- | --- | --- |
| `mattpocock-engineering`, `mattpocock-productivity` | `mattpocock/skills` | `b8be62ffacb0118fa3eaa29a0923c87c8c11985c` | MIT |
| `agent-browser` | `vercel-labs/agent-browser` | `523d7d57f1cd557e5ff8308b2dcaa1a4af1e7204` | Apache-2.0 |
| `find-skills` | `vercel-labs/skills` | `8f1b9c87070b886c8c1c1bebd2dc83c4963cbf45` | MIT in package metadata |
| `remotion-best-practices` | `remotion-dev/skills` | `0fd8c6b1fadcd26718a2919bcac705809f8456a3` | No license declaration found at this pin |

On macOS with Node.js 26.13.1 and `skills@1.9.0`, all five packs restored
with frozen locks in a clean temporary directory for Codex. All 79 restored
files matched the original installations byte for byte. The Rex CLI continues
to manage its generated `rex` entry point. Project profiles can select the new
packs explicitly.
