# Contributing — developer guide

The rules, setup and checks are in [CONTRIBUTING.md](../CONTRIBUTING.md). This page collects practical details.

## Useful scripts

| Command                      | What it does                                                    |
| ---------------------------- | --------------------------------------------------------------- |
| `pnpm build:packages`        | Compile `core`, `godot`, `cli`, `mcp` with `tsc -b`             |
| `pnpm build`                 | Packages + desktop app (`apps/desktop/out`)                     |
| `pnpm dev`                   | Desktop app with hot reload                                     |
| `pnpm test`                  | All Vitest projects (core, godot, cli, mcp, desktop renderer)   |
| `pnpm test:e2e`              | Playwright against the built Electron app                       |
| `pnpm lint` / `pnpm format`  | ESLint / Prettier                                               |
| `pnpm typecheck`             | Type-check everything                                           |
| `pnpm package`               | Build installers for the current OS into `apps/desktop/release` |
| `node scripts/make-icon.mjs` | Regenerate the app icon and logo (after `build:packages`)       |

## Tests

- **Unit/integration** (Vitest): tests import TypeScript sources directly through aliases, so no build is needed. Provider tests run against a local HTTP server (Anthropic streaming) or a stubbed `fetch`. Git tests use a real `git` in temp folders.
- **Godot integration**: `packages/godot/test/godot-integration.test.ts` generates 2D and 3D games, validates them and runs their GDScript tests in a real Godot. Set `GODOT_PATH` to enable it locally; CI downloads Godot.
- **End-to-end**: `apps/desktop/e2e/app.spec.ts` drives the real app with the mock provider (create game, editor, analysis, chat, fix-my-game). With `GODOT_PATH` set it also approves the Godot confirmation, checks the generated tests and the live preview. `GAMEFORGE_SCREENSHOTS=docs/assets/screenshots` refreshes the README screenshots.

## Environment variables for development

| Variable                 | Effect                                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `GAMEFORGE_CONFIG_DIR`   | Use a different config folder (settings, grants, logs, plugins)        |
| `GAMEFORGE_PROJECTS_DIR` | Default parent folder for new games (desktop)                          |
| `GAMEFORGE_LOG_LEVEL`    | `debug`, `info`, `warn`, `error`                                       |
| `GAMEFORGE_E2E=1`        | Test mode for Playwright (separate user data, no single-instance lock) |

## Adding a template feature

1. Add the GDScript (tabs!) under `packages/godot/templates/{common,2d,3d}`.
2. Wire it into the scene/script that uses it and read its settings from `data/game_config.json` (`buildGameConfig` in `generator.ts`).
3. Add its id to `TEMPLATE_FEATURES` in `packages/core/src/plan/game-plan.ts` and to the offline planner if keywords should enable it.
4. Add a GDScript test in `templates/common/tests` and make sure the Godot integration test passes.

## Adding an analyzer rule

Add the check in `packages/godot/src/analyzer.ts` using `makeIssue`, give it a severity, a category and — if the fix is unambiguous — a quick fix in `quickfix.ts`. Extend `analyzer.test.ts` with a broken example and assert that the quick fix resolves it.
