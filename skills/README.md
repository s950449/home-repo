# Skill sources

This directory holds maintained source content, not automatic harness activation.

- `personal/<id>/`: Personal skills, when added. Git versions their source.
- `vendor/rea/`: The sole current vendoring exception: the release-pinned
  REA skill, its provenance, and the upstream MIT license.

Unmodified external skills belong in `packs/` as pinned source declarations and
native lockfiles. The 14 original Cloudflare snapshots have been removed only
after clean-room restoration reproduced their original contents exactly.
See `docs/migrations/local-import.md`.

Do not edit installed copies to maintain customizations. Use a personal skill or
an explicitly documented fork with its original source, license, and changes.

Personal skills need `SKILL.md` frontmatter with a lowercase kebab-case `name`
matching the directory and a nonempty single-line `description`. Supporting `references/`,
`scripts/`, and `assets/` directories are optional. Keep skill IDs unique across
the library. Bundles deployed by profiles must contain regular files and
directories, not symlinks.

To reuse personal skills selectively, list their directory names in a version 2
profile's `personal` array. Different profiles can reuse the same source. No
external pack declaration, publication, or personal lockfile is needed.
Explicit profile deployment copies a snapshot into only the chosen project or
worktree; source changes take effect there only after another apply. See
[`profiles/README.md`](../profiles/README.md).

Write skills and supporting documentation in American English (`en-US`).
Translation and localization skills may include other languages where explicitly
required.

Load only relevant skills and read supporting files on demand. A restored skill
does not install its MCP server, external CLI, or operating system dependencies.
