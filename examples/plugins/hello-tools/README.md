# Hello Tools — example plugin

A minimal [GameForge plugin](../../../docs/plugins.md) that registers one read-only agent tool, `script_summary`.

1. Copy this folder to the plugin directory (Settings → Plugins shows the path, e.g. `%APPDATA%\xyolua-gameforge\plugins\hello-tools`).
2. Enable **Hello Tools** in Settings → Plugins (or `gameforge config set plugins.enabled hello-tools`).
3. Restart GameForge. Every agent can now call `script_summary` (the tool declares `agents: 'all'`).

Released under MIT-0: copy it freely as a starting point.
