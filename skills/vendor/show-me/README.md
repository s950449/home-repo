# show-me modified snapshot

This is a deliberate vendoring exception, not an unmodified upstream checkout.

The local Codex skill matches `plugins/show-me/skills/show-me/SKILL.md` at
`humanlayer/skills` commit `6ab9013a10c28f5046f7f999549cd5328a0b30d7`
(plugin version 1.0.1) after one transformation:

1. Add a `### safety` section requiring untrusted-input handling, HTML
   escaping, no secrets, approved output locations, no silent overwrites,
   no inline scripts or network resources by default, and path confirmation
   before opening generated files.

No other upstream commit matches more closely. The origin of the safety
section is a local customization; it is preserved here rather than discarded
by replacing the skill with a raw upstream pin.

Later upstream versions add an `agents/` directory and change the instructions.
Adopting them is a separate, reviewed update.

`SOURCE.json` records provenance and the upstream bundle digest. The `show-me`
pack uses a relative local source and the native `skills-lock.json` content
hash. `LICENSE` is copied from the pinned upstream commit and applies to this
third-party material.
