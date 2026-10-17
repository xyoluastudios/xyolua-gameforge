# MCP server

GameForge can act as a [Model Context Protocol](https://modelcontextprotocol.io) server so MCP clients — Claude Desktop, Claude Code and others — can use its sandboxed tools on a game project:

```
Claude ──MCP──▶ GameForge ──▶ game project
```

The server is **optional, off by default and read-only unless you allow writes**.

## Enable

Desktop: **Settings → MCP Server → Enable**. CLI:

```bash
gameforge config set mcp.enabled true
gameforge config set mcp.allowWrite true   # optional
```

## Client configuration

The server speaks newline-delimited JSON-RPC 2.0 over stdio (protocol versions 2025-06-18, 2025-03-26, 2024-11-05).

With the `gameforge` command on your PATH:

```json
{
  "mcpServers": {
    "gameforge": {
      "command": "gameforge",
      "args": ["mcp", "--project", "/path/to/your/game"]
    }
  }
}
```

From a source checkout:

```json
{
  "mcpServers": {
    "gameforge": {
      "command": "node",
      "args": [
        "/path/to/xyolua-gameforge/packages/cli/dist/bin.js",
        "mcp",
        "--project",
        "/path/to/your/game"
      ]
    }
  }
}
```

Options: `--project <path>` (the project tools operate on), `--dir <folder>` (where `create_game_project` may create new games; default: current folder), `--allow-write` (same as `mcp.allowWrite`).

## Tools

| Tool                                          | Access | Description                                              |
| --------------------------------------------- | ------ | -------------------------------------------------------- |
| `project_info`                                | read   | Engine, root, Godot installation, write access           |
| `list_files`, `read_file`, `search_code`      | read   | Sandboxed file access (secrets are never readable)       |
| `analyze_project`                             | read   | Scores and prioritized issues                            |
| `git_status`, `git_diff`                      | read   | Repository state                                         |
| `write_file`, `edit_file`, `create_directory` | write  | File changes inside the project                          |
| `run_tests`, `validate_project`               | write  | Run the engine headless (executes project code)          |
| `create_game_project`                         | write  | Generate a new project from a GameForge game plan (JSON) |

Write tools are not even listed unless writes are allowed. Calls are logged to stderr; stdout carries only protocol messages. File changes made through MCP are written directly — review them with git.

There are no interactive confirmations in MCP mode, so nothing that would need one (arbitrary commands, deletions) is exposed.
