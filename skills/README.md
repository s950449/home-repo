# Skill sources

This directory holds maintained source content, not automatic harness activation.

- `personal/<id>/`: Personal skills, when added. Git versions their source.
- `vendor/rea/`: The sole current vendoring exception: the original rendered
  REA 6.8.0 skill, its provenance, and the upstream MIT license.

Unmodified external skills belong in `packs/` as pinned source declarations and
native lockfiles. The 14 original Cloudflare snapshots have been removed only
after clean-room restoration reproduced their original contents exactly.
See `docs/migrations/local-import.md`.

Do not edit installed copies to maintain customizations. Use a personal skill or
an explicitly documented fork with its original source, license, and changes.

Write skills and supporting documentation in American English (`en-US`).
Translation and localization skills may include other languages where explicitly
required.

Load only relevant skills and read supporting files on demand. A restored skill
does not install its MCP server, external CLI, or operating system dependencies.
