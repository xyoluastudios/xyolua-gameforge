# Plugins

GameForge has a public plugin API (version **1**) from day one. The built-in Godot support is itself a plugin. Plugins can contribute:

| Contribution | API                             | Examples                                                            |
| ------------ | ------------------------------- | ------------------------------------------------------------------- |
| Engines      | `ctx.registerEngine(adapter)`   | GodotPlugin, UnityPlugin, UnrealPlugin, RobloxPlugin, BlenderPlugin |
| Agent tools  | `ctx.registerTool(tool)`        | AssetPlugin (texture search, model import), linters                 |
| AI providers | `ctx.registerProvider(factory)` | AIProviderPlugin for other model APIs                               |
| Agent roles  | `ctx.registerAgent(definition)` | Narrative Designer, Balancing Analyst                               |

## Writing a plugin

A plugin is a Node.js package (ES module) with a `gameforge` field in `package.json`:

```json
{
  "name": "gameforge-plugin-hello",
  "version": "1.0.0",
  "type": "module",
  "gameforge": { "id": "hello-tools", "displayName": "Hello Tools", "entry": "index.js" }
}
```

```js
// index.js
export default {
  id: 'hello-tools',
  name: 'Hello Tools',
  version: '1.0.0',
  apiVersion: 1,
  activate(ctx) {
    ctx.logger.info('Hello from a plugin');
    ctx.registerTool({
      name: 'count_scripts',
      description: 'Count the GDScript files in the project.',
      access: 'read',
      agents: 'all', // which agent roles get the tool: 'all' or ['qa', 'programmer']
      input: { safeParse: (value) => ({ success: true, data: value ?? {} }) },
      async run(_input, toolContext) {
        const files = await toolContext.workspace.files(['.gd']);
        return { output: `${files.length} scripts` };
      },
    });
  },
  deactivate() {},
};
```

With TypeScript, use `definePlugin` and zod schemas from `@gameforge/core` for full typing. `input` must provide `safeParse` (any zod schema does); the registry validates every call before `run`.

A complete example lives in [examples/plugins/hello-tools](../examples/plugins/hello-tools).

## Installing a plugin

1. Copy the plugin folder into the plugin directory: **Settings → Plugins** shows the path (`<config>/plugins/<name>`).
2. Enable it in **Settings → Plugins** (or add its id to `plugins.enabled` with `gameforge config set plugins.enabled hello-tools`).
3. Restart GameForge.

## Rules and guarantees

- **Plugins run with full Node.js privileges.** Only install plugins you trust. They are never loaded unless you enable them.
- A tool is offered to agents listed in its `agents` field (`'all'` or role ids). Without it, only agents that name the tool in their own definition can use it.
- Tools registered by plugins go through the same registry as built-ins: schema validation, logging, secret redaction and output truncation. Use `toolContext.workspace` (sandboxed) for files and `toolContext.permissions` for risky actions — don't touch the file system directly.
- A plugin that throws during `activate` is marked _failed_ and reported in Settings and `gameforge doctor`; GameForge keeps running.
- `apiVersion` must match. Breaking API changes bump the version.

## Engine adapters

An engine implements `EngineAdapter` ([`packages/core/src/engines/types.ts`](../packages/core/src/engines/types.ts)):

```ts
interface EngineAdapter {
  id: string;
  displayName: string;
  agentGuide: string; // appended to agent prompts
  isProject(root): Promise<boolean>;
  detectInstallation(): Promise<EngineInstallation | null>;
  generate(plan, workspace, options): Promise<GenerateResult>;
  analyze(workspace, context): Promise<AnalysisReport>;
  quickFix(workspace, issue): Promise<boolean>;
  validate(root, context): Promise<ValidationResult>;
  runTests(root, context): Promise<TestRunReport>;
  runGame(root, options): Promise<RunningGame>;
}
```

Use [packages/godot/src/plugin.ts](../packages/godot/src/plugin.ts) as the reference implementation.
