# REA rendered snapshot

This is a deliberate vendoring exception, not an unmodified upstream checkout.

The original local skill matches the `reverse-engineer-anything` bundle at
`morluto/rea` commit `160d821ac9a0310afcb8d1fc427862dd6508add5`
(`rea-agents-6.8.0`) after exactly two transformations:

1. Pin `rea-agents@latest` command examples to `rea-agents@6.8.0`.
2. Add `metadata.tool_count: 229` next to skill version `49`.

All seven reference files match that upstream commit byte for byte. The installed
`SKILL.md` matches after the documented transformations. These differences are
consistent with installer rendering, but do not establish which command originally
installed it.

The imported bundle itself remains unchanged. Replacing it with the raw Git
version would remove the pinned runtime package examples and tool metadata, so it
is retained here rather than silently changed during dependency migration.

`SOURCE.json` records provenance and the original snapshot digest. The
`reverse-engineering` pack uses a relative local source and the native
`skills-lock.json` content hash. `LICENSE` is copied from the pinned upstream
commit and applies to this third-party material.

This pack does not install the REA MCP server, register a harness integration,
or install analysis engines.
