# Profiles

A profile records a work context and its selected skill IDs. It is custom data,
not a native harness configuration or an authorization grant.

Each JSON file contains:

- `schema_version`: Currently `1`.
- `id`: The filename without its extension.
- `description`: The profile's purpose.
- `skills`: Explicit skill IDs, without wildcards or implicit inheritance.
- `pack`: The corresponding dependency pack for a nonempty selection.

Validation checks that a profile's skill IDs exactly match its pack's declarations.

| Profile | Pack | Purpose |
| --- | --- | --- |
| `global` | None | Intentionally empty; does not change existing global installs |
| `cloudflare-worker` | `cloudflare-worker` | Workers development and CLI operations |
| `cloudflare-agent` | `cloudflare-agent` | Stateful agent development on Workers |

Other opt-in packs are listed in `packs/README.md`; not every task-specific pack
needs a separate named profile.

Profiles do not launch harnesses or deploy into other repositories. Restore a
selected pack explicitly, then choose where the session runs. Pack restoration
does not hide pre-existing global skills.

Choose a Sandbox release line after inspecting the project. Do not combine
stable, next, and migration skills in a general development profile.
Product discovery, performance audits, and reverse engineering are task-specific,
not global defaults.

Keep personal choices separate from team rules. Do not add private skills to
shared projects or overwrite their skill directories without authorization.
