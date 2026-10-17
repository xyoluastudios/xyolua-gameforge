# Getting started

This guide takes you from zero to a running game in about ten minutes.

## 1. Install

You need:

- **GameForge** — a release build from [GitHub Releases](https://github.com/xyoluastudios/xyolua-gameforge/releases), or from source (below).
- **[Godot 4.3 or newer](https://godotengine.org/download)** — a single executable, no installer needed. GameForge uses it to validate, test and run games.
- **An AI provider** — your own Anthropic or OpenAI-compatible API key, or a local model in [Ollama](https://ollama.com). Optional for a first try: the offline mock works without one.

From source (Node.js 22.12+, pnpm 10, Git):

```bash
git clone https://github.com/xyoluastudios/xyolua-gameforge.git
cd xyolua-gameforge
pnpm install
pnpm build
pnpm --filter @gameforge/desktop start
```

## 2. Configure

Open **Settings** (Ctrl+,).

- **AI Provider** — choose a provider and enter the key. Keys are encrypted with your operating system's keychain. Click **Test connection**.
- **Godot** — GameForge looks on your PATH, in `GODOT_PATH` and in common install folders. Use **Browse** to select the executable if it is somewhere else.

Alternatively, copy [.env.example](../.env.example) to `.env` in the folder you start GameForge or the CLI from:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=your_key_here
GODOT_PATH=/path/to/Godot
```

Run **Settings → Doctor** (or `gameforge doctor`) to check everything.

## 3. Create a game

1. Click **Create Game** (Ctrl+N).
2. Describe the game, e.g. _"A 3D horror game inside an abandoned hospital. The player finds keys, opens doors and is hunted by a monster."_
3. Pick a location and click **Generate plan**. The Game Designer returns a plan: title, genre, engine, core loop, features, level, enemies.
4. **Approve**, **Edit** (describe what to change), **Regenerate** or **Cancel**. Nothing is created before you approve.
5. GameForge builds the project. You see each step: level layout, scenes and scripts, placeholder assets, sound, git, custom features, validation and tests.
6. When QA wants to run Godot you get a confirmation — running the game executes its scripts. **Allow for project** remembers the decision (stored in your user settings, never in the project).

## 4. Play and iterate

- **F5** runs the game in its own window; the Game Preview mirrors it and the Terminal shows Godot's output. **Shift+F5** stops it.
- Ask the agents in the AI panel: _"Make the monster faster"_, _"Add a stamina bar for sprinting"_, _"Explain the enemy script"_.
- Agent changes are **staged**: review them in **Review Changes**, then **Apply** or **Discard**. After applying, tests run automatically.
- Commit in the **Git** panel when you are happy. GameForge never pushes on its own.

## 5. Fix an existing game

1. **Open Project** (Ctrl+O) and select a Godot 4 project folder.
2. **Analyze** (Ctrl+Shift+A): scores and a prioritized list of issues.
3. **Fix Critical Issues** (or select issues and **Fix selected**) → review the fix plan → **Apply fixes**.
4. Review the diff, **Apply all**, tests run.

## Keyboard shortcuts

| Shortcut                     | Action                                          |
| ---------------------------- | ----------------------------------------------- |
| Ctrl+K / Ctrl+Shift+P        | Command palette                                 |
| Ctrl+P                       | Search files                                    |
| Ctrl+N                       | Create game                                     |
| Ctrl+O                       | Open project                                    |
| Ctrl+L                       | Ask AI (focus chat)                             |
| Ctrl+I                       | AI edit (in the editor, works on the selection) |
| Ctrl+S                       | Save file                                       |
| Ctrl+F / Ctrl+H              | Search / replace in the editor                  |
| F5 / F6                      | Run game / debug run                            |
| Shift+F5 / Ctrl+Shift+F5     | Stop / restart game                             |
| Ctrl+Shift+T                 | Run tests                                       |
| Ctrl+Shift+A                 | Analyze project                                 |
| Ctrl+Shift+G                 | Git panel                                       |
| Ctrl+B / Ctrl+Alt+B / Ctrl+J | Toggle explorer / AI panel / bottom panel       |
| Ctrl+W                       | Close tab                                       |
| Ctrl+,                       | Settings                                        |
