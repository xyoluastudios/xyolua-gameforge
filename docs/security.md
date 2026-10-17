# Security model

GameForge treats AI output as **untrusted input**. Agents can read and change files and run programs, so every capability goes through layers that limit what a confused or manipulated model (e.g. via prompt injection in a project file) can do.

## Workspace sandbox

All agent file access goes through `Workspace` ([`packages/core/src/workspace`](../packages/core/src/workspace)):

- Paths are resolved against the project root; `..`, absolute paths outside the project and **symlinks/junctions that point outside** are rejected (the real path of the nearest existing ancestor is checked).
- **Protected files** can't be read or written by agents: `.env` and `.env.*` (except `.env.example`), `.ssh/`, `.gnupg/`, `.aws/`, `.azure/`, `.kube/`, `.docker/`, `id_rsa`-style keys, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, `.npmrc`, `.netrc`, `credentials.json`, `secrets.json` and Godot's `export_credentials.cfg`.
- **Read-only for agents**: `.git/`, `.godot/`, `.gameforge/`, `node_modules/`.
- Size limits: 1 MiB per read, 2 MiB per write; binary files are not read.
- Changes are **staged** by default and only written after you review the diff. Deleting a file outside staged mode asks first.

## Commands

- Commands run **without a shell** (no pipes, redirects, `&&`, `;`, backticks or `$(…)`), with a sanitized environment (variables that look like keys, tokens, secrets or passwords are removed), the project as working directory, a timeout (default 2 minutes) and an output limit.
- **Blocked** for agents, no matter what: shells and script hosts (`sh`, `bash`, `cmd`, `powershell`, `wsl` …), destructive and system tools (`rm`, `del`, `format`, `dd`, `shutdown`, `reg`, `chmod`, `sudo`, `kill`, `schtasks` …), network/remote tools (`curl`, `wget`, `ssh`, `scp`, `nc` …), Windows LOLBins (`certutil`, `mshta`, `rundll32` …), and indirection (`env`, `xargs`, `start`, `open`). `git push`, `git remote`, `git config`, `git reset` and `git clean` are blocked as well.
- Arguments that point outside the project are blocked.
- **Allowed without asking**: read-only git (`status`, `diff`, `log`, `show`, `branch`, `ls-files`, `blame`, `rev-parse`).
- **Asks first** — _Allow once / Allow for project / Cancel_: Godot (it executes project scripts) and any other program.
- "Allow for project" is stored in your **user config directory**, keyed by project path — never inside the project, so a downloaded project can't pre-approve its own commands.

## Secrets

- API keys come from environment variables or the desktop key store, which encrypts them with the OS keychain (`safeStorage`: DPAPI, Keychain, libsecret/kwallet). Without a secure keychain (e.g. Linux `basic_text`), storing keys is refused.
- Keys are never written to `settings.json`, logs, or project files.
- Tool output, command output and log messages are scrubbed of well-known secret formats (Anthropic/OpenAI/GitHub/AWS/Google/Slack keys, bearer tokens, private keys, `*_KEY=`/`*_TOKEN=` assignments) before they reach the AI or the screen.
- `gameforge doctor` warns when `.env` is tracked by git.

## Desktop app hardening

- Renderer: `contextIsolation`, `sandbox`, no Node.js integration, strict Content-Security-Policy (no remote scripts, no network connections from the UI), navigation and new windows blocked, webviews disabled, all permission requests denied.
- The preload exposes only `invoke` and `on` with allow-listed channels. The main process validates every IPC call's arguments with zod and accepts calls only from its own window.
- External links open in the system browser and must be `https://`.

## Git

GameForge never pushes. **Push** exists only as an explicit button in the Git panel with a confirmation.

## MCP and plugins

- The MCP server is disabled by default, read-only unless writes are allowed, limited to one project, and exposes no tool that would require an interactive confirmation.
- Third-party plugins run with full Node.js privileges. They are only loaded when you enable them.

## Limits

Be aware of what GameForge **cannot** protect against:

- **Running a game or its tests executes AI-generated code** with your user's permissions. GDScript can read files and start processes (`OS.execute`). GameForge asks before running Godot on behalf of an agent, and you should review changes before running them — but it cannot sandbox the engine.
- Opening a downloaded project in the **Godot editor** runs its `@tool` scripts. GameForge's analysis is static and safe, but _Validate with Godot_ imports the project, which may run editor scripts.
- Prompt injection can still make an agent write bad code into the project. Staged changes and diff review exist for exactly this reason.
- Your AI provider receives the content agents read for a task.

Found a way around any of this? Please report it privately — see [SECURITY.md](../SECURITY.md).
