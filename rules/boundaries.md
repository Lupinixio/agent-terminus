# Boundaries

Hard limits on what a component may import, call, expose, bind or leak are not written in rules files. They live in `.boundaries/*.toml` manifests and are checked by code (`boundaries check`). Rules files state principles only.

- Read a component's manifest before changing the component. The manifest, not prose, is the source of truth for its limits.
- A limit you find written only as prose (in a rules file, comment, doc or task) is an enforcement gap: report it and propose a manifest entry. Do not copy it into another rules file.
- Do not restate manifest contents (module names, routes, secret names, addresses) in rules files; point to the manifest.
- Prefer enforcement on the receiving side: a scoped token, capability or permission the callee checks beats a promise the caller makes.
- Never weaken a check, a manifest, a generated enforcement file, a provider or a test that enforces a limit to make something pass. If a limit blocks correct work, stop and say so.
- Changing a manifest is a decision: it needs a new decision record linked from the manifest and a human's approval. Propose the diff; do not apply it on your own authority.
- Files under `.boundaries/` and paths a manifest marks as protected may ask for human confirmation before an edit. Do not work around that, for example by writing them through a shell command or a script.
- Before calling work done, run `boundaries check` for every language in the project. A failure is a finding, not something to silence.
