# Agents

GameForge works with a team of agents. Each agent is a role with a focused system prompt and a restricted set of tools. Agent definitions live in [`packages/core/src/agents/definitions.ts`](../packages/core/src/agents/definitions.ts).

| Agent                              | Responsibilities                                                                                                      | Tools                                  |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Project Manager** (orchestrator) | Understands requests, decides which agent works on what and in which order, when to run tests and when a task is done | read tools, `delegate`, `run_tests`    |
| **Game Designer**                  | Analyzes the idea, writes the game plan: loop, mechanics, features, level, enemies                                    | read tools                             |
| **Programmer**                     | Writes and changes code, scenes and data, fixes bugs                                                                  | read + write tools, `run_command`      |
| **Level Designer**                 | Level structure, rooms, spawn points, gameplay zones                                                                  | read + write tools                     |
| **Asset Manager**                  | Asset organization, missing/unused assets, placeholders, `assets/manifest.json`                                       | read + write tools                     |
| **Audio Designer**                 | Sound structure, ambience, music, sound events                                                                        | read + write tools                     |
| **QA**                             | Runs tests and analysis, reproduces bugs, identifies root causes, verifies fixes (does not edit)                      | read tools, `run_tests`, `run_command` |

Read tools: `read_file`, `list_files`, `search_code`, `analyze_project`, `git_status`, `git_diff`, `get_pending_changes`. Write tools: `write_file`, `edit_file`, `create_directory`, `delete_file`.

## How a chat request is handled

1. **Built-in intents** run directly without an AI round-trip: _run tests_, _run the game_, _analyze_, _fix (critical) issues_, _git status_, _create a … game_.
2. Everything else goes to the **Project Manager**. It inspects the project as far as needed and calls `delegate(agent, task)` with self-contained tasks. Each delegated agent runs its own tool-use loop and reports back.
3. Changes from all agents land in one staged change set. The UI shows **"AI created changes — N files changed"** with **Review Changes / Apply / Discard**.

## Engine guide

Every agent prompt is extended with the engine's guide. For Godot this enforces Godot 4 syntax (`@onready`, `@export`, `await`, `instantiate()`, `CharacterBody*`), tab indentation, `res://` paths, defined input actions, and knowledge of the generated project structure (autoloads `GameState`, `AudioManager`, `SaveSystem`; tuning in `data/game_config.json`; tests in `tests/`).

## Limits

- `agents.maxSteps` (default 40) caps model turns per task.
- Tool output returned to the model is truncated to 30 000 characters and scrubbed of secrets.
- Refused or truncated responses never execute tool calls.
- Cancel (Stop button / `ai:cancel`) aborts the running request and all running commands.

## Adding agents

Plugins can add roles with `ctx.registerAgent({ id, name, description, tools, systemPrompt, maxSteps })`. The Project Manager can then delegate to them. See [plugins.md](plugins.md).
