# Contributing to XyoLua GameForge

Thanks for helping! GameForge is a community project — bug reports, docs fixes, new analyzer rules, engine plugins and UI polish are all welcome.

## Ground rules

- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Security issues go through [private reporting](SECURITY.md), not public issues.
- Discuss large changes in an issue first so nobody wastes time.
- No telemetry, no tracking, no mandatory cloud services, no secrets in code. These are hard requirements.

## Development setup

Requirements: **Node.js 22.12+**, **pnpm 10** (`corepack enable`), **Git**. Godot 4.3+ is optional but needed for the engine integration tests.

```bash
git clone https://github.com/xyoluastudios/xyolua-gameforge.git
cd xyolua-gameforge
pnpm install
pnpm build:packages      # compile core, godot, cli, mcp
pnpm dev                 # desktop app with hot reload
```

Use the offline mock provider while developing — no API key needed:

```bash
cp .env.example .env     # then set AI_PROVIDER=mock
```

## Project layout

| Path               | What it is                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/core`    | Engine-agnostic core: AI providers, agents, sandboxed tools, permissions, git, plugins, doctor |
| `packages/godot`   | Built-in Godot plugin: project generator, GDScript templates, analyzer, quick fixes, runner    |
| `packages/cli`     | The `gameforge` command line                                                                   |
| `packages/mcp`     | Optional MCP server (stdio)                                                                    |
| `apps/desktop`     | Electron + React desktop app                                                                   |
| `docs/`            | User and developer documentation                                                               |
| `examples/plugins` | Example third-party plugin                                                                     |

See [docs/architecture.md](docs/architecture.md) for how the pieces fit together.

## Checks

Every pull request must pass the same checks as CI:

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test                # unit + integration tests (Vitest)
pnpm build
pnpm test:e2e            # Playwright against the built Electron app
```

Godot integration tests run when `GODOT_PATH` points to Godot 4.3+ (they are skipped otherwise):

```bash
GODOT_PATH=/path/to/Godot pnpm test
```

## Writing code

- TypeScript strict mode, ES modules, no `any` where a type is known.
- Keep dependencies minimal. Adding one needs a reason in the PR description.
- Errors that can reach users are `GameForgeError`s with a message, a reason and a concrete solution. Stack traces belong in logs only.
- Everything an agent can do goes through the tool registry and the permission manager. Never bypass the workspace sandbox.
- GDScript templates (`packages/godot/templates`) use tabs and Godot 4 syntax and must pass the generated project's tests in a real Godot.
- Add tests with your change. Bug fixes start with a failing test.

## Commits and pull requests

- Small, focused PRs. One topic per PR.
- Write commit messages in the imperative ("Add Unity engine adapter").
- Fill in the PR template, including how you tested the change.
- By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE) (and, for files in `packages/godot/templates`, additionally under MIT-0).

## Good first issues

- New analyzer rules (`packages/godot/src/analyzer.ts`) with tests.
- More quick fixes for Godot 3 → 4 migrations.
- Translations of the docs.
- Additional templates (e.g. a side-view platformer player).
