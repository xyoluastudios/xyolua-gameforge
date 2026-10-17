# Changelog

All notable changes are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-10-16

First public version.

### Added

- Desktop app (Electron + React): project explorer, workspace tabs, CodeMirror editor with GDScript highlighting, search/replace and AI edit, live game preview, AI agent panel, terminal, logs, tests, git and problems panels, command palette (Ctrl+K), settings.
- Create Game workflow: description → Game Designer plan → approve / edit / regenerate / cancel → Godot 4 project with scenes, scripts, level, placeholder assets and audio, git, validation and tests.
- Fix My Game workflow: static analyzer with scores, prioritized issues, fix plans, deterministic quick fixes, AI fixes, staged diff review, apply, automatic tests.
- Multi-agent system: Project Manager (orchestrator), Game Designer, Programmer, Level Designer, Asset Manager, Audio Designer, QA.
- AI providers: Anthropic, OpenAI-compatible APIs, Ollama, and an offline mock for development.
- Sandboxed tools with schema validation, path protection, command allowlist, confirmations, secret redaction, timeouts and output limits.
- Godot plugin: generator (3D first-person and 2D top-down), solvable level generator, GDScript test runner, headless validation, game runner with live preview bridge.
- `gameforge` CLI: create, analyze, fix, chat, test, run, doctor, config, mcp.
- Optional MCP server (stdio) with read-only and write tool sets.
- Public plugin API (engines, tools, AI providers, agents).
