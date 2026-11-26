# Agent Home Repo

This repository is the source of truth for personal agent workflows, pinned
external skill packs, profiles, and navigation across independent repositories.
It is not the operating system's home directory and not a product monorepo.

## Working rules

- Read `README.md` for the structure and current implementation boundaries.
- Reply in Traditional Chinese unless the user requests another language.
- Write repository content in American English (`en-US`), including skills,
  agent instructions, documentation, comments, and templates. This content
  policy is separate from the user's preferred conversation language.
- Allow other languages when explicitly required by a translation or
  localization skill. Keep the exception scoped to the relevant instructions,
  examples, assets, and outputs; do not change unrelated content.
- Treat `skills/` as a library, not an automatically activated skill set.
  Only load skills relevant to the requested task and selected profile.
- Manage unmodified external skills with pinned pack manifests and native
  `skills-lock.json` files. Installed pack contents are ignored artifacts.
  Vendor only documented exceptions with provenance and license information.
- Use the exact CLI version in `package.json` and `package-lock.json`.
  Restore packs with frozen locks; do not upgrade dependencies during restore.
- Select one pack and explicit agents when running `scripts/skills.mjs`.
  It writes only inside that pack. Never install every pack or use global scope
  as a side effect of setup. Sync requires explicit `--write-lock`.
- Profiles and machine mappings are custom data, not native harness config.
  Profile files alone do not activate anything. Explicit `profiles:apply`
  deployment requires a target, agents, and `--write`; it does not grant
  permissions or register tools. Preview and read the target instructions first.
  Use separate worktrees for concurrent profiles. Never bypass ownership,
  Git-ignore, or local-edit checks.
- Do not deploy to global skill directories or edit harness settings unless
  the user explicitly requests that work.
- Keep upstream snapshots intact. Review provenance, licenses, scripts, and
  changes before updating or adapting third-party content.
- Never add credentials, auth files, session histories, or raw private traces.
- Do not commit, push, add remotes, clone projects, or install dependencies
  unless requested. A navigation pointer is not authorization.
- Preserve existing files and user changes; stop on conflicting destinations.
- After changing pack manifests, locks, profiles, or vendored skills, run
  `npm run validate`. Run `npm test` after changing management scripts.
  These checks validate structure and integrity, not skill behavior or safety.

## Navigation

- `projects/README.md`: project registry and machine-local path mapping.
- `profiles/README.md`: explicit skill selection by work context.
- `packs/README.md`: pinned dependencies, frozen restores, and explicit updates.
- `adapters/README.md`: harness-specific discovery and portability limits.
- `docs/migrations/local-import.md`: original baseline and migration evidence.
- `skills/vendor/rea/SOURCE.json`: the documented rendered-skill exception.

Before modifying another repository, resolve its local path, read its applicable
`AGENTS.md` and/or `CLAUDE.md`, and check its Git status. Use its working
directory explicitly for commands; do not assume Home Repo context activates
that repository's settings or permissions.

For parallel implementation, use separate worktrees and independent activation
sets. Do not mutate a shared global profile or shared skill checkout underneath
running sessions. Scope tool access to the requested repositories.
