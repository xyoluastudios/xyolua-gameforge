# Godot support

GameForge V1 focuses on **Godot 4.3+**. The Godot integration is the built-in plugin [`packages/godot`](../packages/godot) — the same plugin API third parties use.

## Detecting Godot

In this order: **Settings → Godot**, `GODOT_PATH`, `godot` / `godot4` on the PATH, and common install locations (Windows: `%LOCALAPPDATA%\Programs\Godot`, `C:\Program Files\Godot`, Scoop, WinGet, Steam; macOS: `/Applications/Godot.app`; Linux: `/usr/bin/godot`, `~/.local/bin`, Snap). Each candidate is checked with `--version`; versions below 4.3 are ignored. On Windows the `*_console.exe` sibling is used when present so output is captured reliably.

GameForge **never installs Godot for you**. If it is missing you get _Godot not detected — Install Guide / Select Godot Executable / Cancel_.

## Generated projects

```
my-game/
├── project.godot              autoloads, input map, renderer, main scene
├── icon.svg
├── README.md                  how to play, controls, structure, tests
├── data/
│   ├── game_config.json       tuning: speeds, health, enemies, lighting, texts
│   └── levels/level_01.json   grid level: rooms, doors, keys, spawns, exit
├── scenes/                    main.tscn, player.tscn, enemy.tscn
├── scripts/
│   ├── autoload/              GameState, AudioManager, SaveSystem, GameForgeBridge
│   ├── core/level_data.gd     level loading + AStarGrid2D path-finding
│   ├── player/ enemy/ world/  gameplay scripts
│   └── main.gd
├── ui/                        HUD, main menu, pause menu, end screen (+ scenes)
├── assets/                    placeholder textures + manifest.json
├── audio/                     synthesized sfx and ambience + sound_events.json
├── shaders/                   vignette.gdshader
├── tests/                     run_tests.gd + test_*.gd
└── .gameforge/plan.json       the approved plan
```

- **3D first-person**: walk, sprint, mouse look, interaction ray, flashlight with battery, fog and room lights.
- **2D top-down**: 8-way movement, sprint, proximity interaction, drawn tiles.
- **Shared**: keys and locked doors, inventory, enemies with grid path-finding (chase / patrol / wander, line of sight, blocked by locked doors), health and game over, exit/win, random events, save/load (F5/F9), main/pause/end menus, HUD, ambient audio.

Features are runtime flags in `data/game_config.json`. Plan features without a template (e.g. multiplayer) are implemented by the Programmer agent.

### Levels are always solvable

The level generator lays out rooms in a snake order, connects them with corridors and places locked doors on chokepoint corridors. Key _N_ is always placed before door _N_. A flood fill verifies that every key is reachable in order and that the exit is only reachable after all doors are open; invalid layouts are regenerated. The generated tests check the same in Godot.

## Validation

`Validate with Godot` (and the QA step) runs, with your confirmation:

1. `godot --headless --path . --import` — imports textures and audio.
2. A small validator script that loads every `.gd` and `.tscn` file and reports scripts that fail to compile.
3. A smoke run of `scenes/main.tscn` for 200 frames to catch runtime errors in `_ready` and physics.

Errors are parsed from Godot's output (`SCRIPT ERROR`, `ERROR`, `Parse Error`) with file and line. Known harmless shutdown messages are ignored.

## Tests

Generated projects ship a dependency-free runner:

```bash
godot --headless --path . -s res://tests/run_tests.gd
```

Every `test_*` method in `tests/test_*.gd` (extending `res://tests/test_case.gd`) is a test. The runner prints a machine-readable protocol that GameForge parses:

```
GFTEST|PASS|test_level_data.gd|test_level_is_solvable_in_order
GFTEST|FAIL|test_game_state.gd|test_damage|expected <20> but got <30>
GFTEST|SKIP|test_save_system.gd|test_round_trip|reason
GFTEST|SUMMARY|<total>|<passed>|<failed>|<skipped>
```

Projects using [GUT](https://github.com/bitwes/Gut) (`addons/gut`) are run with GUT's command-line runner instead (summary only).

## Running and live preview

▶ **Play** runs `godot --path .` (🐛 **Debug** adds `--debug-collisions --debug-paths --verbose`). Output streams to the Terminal panel. Generated projects include the `GameForgeBridge` autoload: when started by GameForge with `-- --gameforge-preview=<file>`, it writes a downscaled screenshot twice per second, which the Game Preview shows. It is inactive in normal runs, headless mode and exported games.

## Analysis

The analyzer is pure text analysis — it never runs project code, so it is safe on downloaded projects.

| Rule                                                                                                                                               | Severity        | Quick fix                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------- |
| Godot 3 syntax: `onready`, `export`, `tool`, `yield`, `setget`, `KinematicBody`, `Spatial`, `move_and_slide(args)`, `.instance()`, old `connect()` | critical / high | most of them                            |
| Mixed tabs and spaces                                                                                                                              | critical        | ✓                                       |
| Missing / broken main scene                                                                                                                        | critical        | ✓                                       |
| Missing autoload script                                                                                                                            | critical        | AI                                      |
| Missing `preload` / `load` target, missing scene resource                                                                                          | critical / high | AI                                      |
| Undefined input action                                                                                                                             | high            | ✓ (adds the action with a sensible key) |
| `$Node` / `get_node()` path not in the scene                                                                                                       | high            | AI                                      |
| Signal connected to a missing method                                                                                                               | high            | AI                                      |
| Node lookups in `_process`                                                                                                                         | low             | AI                                      |
| Very long functions, large scripts, TODOs                                                                                                          | low / info      | AI                                      |
| Unused assets / scripts                                                                                                                            | low             | manual                                  |
| No tests, no README                                                                                                                                | medium / low    | AI                                      |

**Scores** (0–100) are deterministic: _Code Quality_ decays with weighted issues relative to project size; _Architecture_ considers folder structure, script size, broken references, upward node coupling and a main scene; _Testing_ grows with test files per script; _Documentation_ combines a README, comment density and documented scripts.

Exported builds: add `*.json` to _Export → Resources → Filters to export non-resource files_ so data files are included.
