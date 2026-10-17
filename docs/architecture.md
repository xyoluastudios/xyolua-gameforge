# Architecture

GameForge is a TypeScript monorepo. One engine-agnostic core is shared by three front ends: the desktop app, the CLI and the MCP server.

```
┌──────────────────────┐  ┌──────────────┐  ┌──────────────┐
│ apps/desktop         │  │ packages/cli │  │ packages/mcp │
│ Electron main  ◀─IPC─▶ React renderer │  │ gameforge    │  │ stdio server │
└──────────┬───────────┘  └──────┬───────┘  └──────┬───────┘
           └─────────────────────┼─────────────────┘
                                 ▼
                         packages/core
  GameForge (app) · ProjectSession · agents · tools · workspace · permissions
  providers · plan · git · plugins · doctor · logging · errors
                                 │ plugin API
                                 ▼
                         packages/godot  (built-in engine plugin)
  generator · templates · level generator · analyzer · quick fixes · runner
```

**Why TypeScript everywhere?** The desktop app needs Node.js anyway (Electron). A single language for UI, core, CLI and plugins keeps the project approachable for contributors and avoids a second runtime.

## packages/core

| Module                                 | Responsibility                                                                                                 |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `app.ts`                               | `GameForge`: settings, registries, plugins, plan generation, the creation pipeline                             |
| `project.ts`                           | `ProjectSession`: an open project — chat routing, agents, analysis, fix plans, change review, tests, game runs |
| `providers/`                           | `AIProvider` interface and the Anthropic, OpenAI-compatible, Ollama and mock implementations                   |
| `agents/`                              | Agent definitions (roles, prompts, tool sets) and the provider-neutral tool-use loop                           |
| `tools/`                               | `ToolRegistry` (schema validation, logging, redaction, truncation) and the built-in tools                      |
| `workspace/`                           | Sandboxed file access, path guard, staged/direct change sets, line diff                                        |
| `permissions/`                         | Command policy, confirmations, remembered grants                                                               |
| `process/`                             | Shell-free command execution with timeouts and output limits                                                   |
| `plan/`                                | Game plan schema, validation, normalization, offline planner                                                   |
| `git/`                                 | Git CLI wrapper (status, diff, log, commit, branches; push only as a user action)                              |
| `plugins/`                             | Plugin API, loader and discovery                                                                               |
| `doctor.ts`                            | Environment checks                                                                                             |
| `errors.ts`, `logger.ts`, `secrets.ts` | User-facing errors, structured logs, secret redaction                                                          |

## The tool-use loop

```
task ─▶ provider.chat(system + history + tool specs)
          │
          ├─ text only ──────────────▶ done (summary)
          └─ tool calls ─▶ ToolRegistry.execute()
                              ├─ zod schema validation
                              ├─ workspace sandbox / permission manager
                              ├─ run, log, redact secrets, truncate
                              └─ result ─▶ appended to history ─▶ next turn
```

Provider-specific message formats (Anthropic content blocks, OpenAI `tool_calls`, Ollama `tool_calls`) are converted inside each provider. Assistant turns keep their native content (`providerData`) so conversations stay append-only. A response that hits the token limit never executes its tool calls; refusals stop the run.

## Changes are staged

Agent writes go into a `ChangeSet`:

- **staged** (default): nothing touches the disk. Reads through the workspace see the staged content, so agents and the analyzer work on the proposed state. The user reviews each file's diff and applies or discards.
- **direct**: files are written immediately but originals are kept for review and undo (used while generating a new project, after its initial commit).

## Desktop app

- **Main process** (`src/main`): owns the `GameForge` instance (`Backend`), native dialogs, the OS keychain (`safeStorage`) and the file watcher. Every IPC call is validated with zod and only accepted from the app's own window.
- **Preload** (`src/preload`): exposes exactly two functions, `invoke(channel, …args)` and `on(event, listener)`, with allow-listed channel names.
- **Renderer** (`src/renderer`): React with a small external store, CodeMirror 6 for editing and diffs, lucide icons. Sandboxed, context-isolated, strict Content-Security-Policy, no Node.js access.

Long operations stream `GameForgeEvent`s (agent start/text/tool/end, pipeline steps, process output, notices) to the UI.

## Creation pipeline

1. **Game Designer** — plan from the description (structured JSON, validated, retried with error feedback).
2. **Level Designer** — room names and notes (AI) for the deterministic level generator.
3. **Programmer** — engine generator writes project, scenes, scripts, data and tests from tested templates.
4. **Asset Manager** — placeholder textures and `assets/manifest.json`.
5. **Audio Designer** — synthesized placeholder sounds and `audio/sound_events.json`.
6. **Project Manager** — `git init` and an initial commit.
7. **Programmer** — implements plan features that have no template (needs a generative provider).
8. **QA** — engine validation; on errors the Programmer fixes them (up to two rounds); then the tests run.

## Error handling

Anything that can reach a user is converted to `{ code, message, reason, solution }`. The UI and CLI show these; stack traces only go to the log file (`<config>/logs/gameforge.log`) and the Logs panel.
