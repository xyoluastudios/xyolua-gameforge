# CLI

The `gameforge` command runs the same core as the desktop app.

From a source checkout, run it through pnpm from the repository root (after `pnpm build:packages`):

```bash
pnpm gameforge <command> [options]
# or directly
node packages/cli/dist/bin.js <command> [options]
```

The CLI reads `.env` from the current folder (see [.env.example](../.env.example)); real environment variables take precedence. `NO_COLOR` disables colors.

## Commands

### `gameforge create "<description>"`

Plans a game, shows the plan and asks **[a] Approve / [e] Edit / [r] Regenerate / [c] Cancel**, then generates, validates and tests the project.

| Option               | Meaning                                          |
| -------------------- | ------------------------------------------------ |
| `--dir <folder>`     | Parent folder (default: current folder)          |
| `--name <name>`      | Folder name (default: from the title)            |
| `--plan <plan.json>` | Use an existing plan instead of generating one   |
| `--no-git`           | Don't initialize a repository                    |
| `--yes`, `-y`        | Approve the plan and confirmations automatically |

### `gameforge analyze [project]`

Prints scores, stats and issues. `--json` prints the full report.

```
Project Analysis — Old Port

Architecture:    78/100 ████████░░
Code Quality:     5/100 █░░░░░░░░░
Testing:          0/100 ░░░░░░░░░░
Documentation:    0/100 ░░░░░░░░░░

Issues found: 13
🔴 KinematicBody no longer exists scripts/player.gd:1
🟠 Undefined input action scripts/player.gd:8
…
```

### `gameforge fix [project]`

Analyze → fix plan → confirm → staged fixes → summary (and diff) → confirm → apply → tests.

| Option         | Meaning                                                     |
| -------------- | ----------------------------------------------------------- |
| `--critical`   | Only critical issues (default: critical, high, medium)      |
| `--issue <id>` | Fix specific issues (repeatable; ids from `analyze --json`) |
| `--diff`       | Print the full diff                                         |
| `--yes`        | Don't ask                                                   |

### `gameforge chat "<request>" [--project <path>]`

Sends a request to the agent team (e.g. _"Make the monster faster"_). Changes are staged; you are asked to apply, show the diff or discard.

### `gameforge test [project]`

Runs the project tests headless. Exit code 1 when a test fails.

### `gameforge run [project] [--debug]`

Starts the game and streams its output. Ctrl+C stops it.

### `gameforge doctor [--online]`

Checks Node.js, pnpm, Git, Godot, the AI provider and its configuration, the `.env` file (and that git does not track it), write permissions and plugins. `--online` also contacts the AI provider.

### `gameforge config list | get <key> | set <key> <value> | path`

Settable keys: `ai.provider`, `ai.anthropic.model`, `ai.anthropic.effort`, `ai.anthropic.fallbacks`, `ai.openai.baseUrl`, `ai.openai.model`, `ai.ollama.baseUrl`, `ai.ollama.model`, `godot.executable`, `mcp.enabled`, `mcp.allowWrite`, `agents.changeMode`, `agents.maxSteps`, `plugins.enabled`. API keys can't be set here — use environment variables or `.env`.

### `gameforge mcp --project <path> [--dir <folder>] [--allow-write]`

Starts the MCP server on stdio. See [mcp.md](mcp.md).

## Exit codes

| Code | Meaning                                                    |
| ---- | ---------------------------------------------------------- |
| 0    | Success                                                    |
| 1    | Failure (error message with reason and solution on stderr) |
| 2    | Invalid usage                                              |
| 130  | Cancelled                                                  |

## Confirmations in the terminal

When an agent wants to do something risky the CLI asks:

```
⚠️  Confirmation required

QA wants to execute:

/path/to/godot --headless --path .

[o] Allow once   [p] Allow for project   [c] Cancel  ›
```

Without an interactive terminal the answer is _Cancel_ unless you pass `--yes`.
