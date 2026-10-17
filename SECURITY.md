# Security Policy

GameForge lets AI agents read and change files and run programs on your computer. We take that seriously. The full security model is documented in [docs/security.md](docs/security.md).

## Reporting a vulnerability

**Do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting: [Report a vulnerability](https://github.com/xyoluastudios/xyolua-gameforge/security/advisories/new).

Please include:

- what an attacker can do (e.g. read files outside the project, run a blocked command, leak an API key),
- steps to reproduce, ideally with a minimal project or prompt,
- the GameForge version (`gameforge --version`) and your operating system.

We aim to acknowledge reports within 72 hours and to publish a fix and advisory as soon as possible. We credit reporters unless they prefer to stay anonymous.

## Supported versions

| Version        | Supported |
| -------------- | --------- |
| 0.1.x (latest) | ✅        |
| older          | ❌        |

## Especially interesting

- Escaping the workspace sandbox (path traversal, symlinks, `res://` tricks).
- Reading protected files (`.env`, SSH keys, keystores, export credentials).
- Bypassing the command policy (shell syntax, blocked programs, missing confirmations).
- Secrets leaking into AI requests, logs or child process environments.
- Prompt-injection paths that make agents act without the confirmations described in the docs.
- IPC calls from the renderer that skip validation.

## Out of scope

- Code that an AI generates and **you** run (the game, its tests): GameForge treats generated code as untrusted and asks before running it, but it cannot make running arbitrary code safe. See [docs/security.md](docs/security.md#limits).
- Third-party plugins you enabled: plugins run with full Node.js privileges by design.
- Your AI provider's own handling of data.
