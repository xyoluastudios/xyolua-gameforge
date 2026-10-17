/**
 * Example GameForge plugin (plugin API v1).
 *
 * Install: copy this folder into the plugin directory shown in
 * Settings → Plugins, enable "Hello Tools", restart GameForge.
 */

/** Minimal schema object: the tool registry calls safeParse() before run(). */
const noInput = {
  safeParse: (value) =>
    value === undefined || (typeof value === 'object' && value !== null && !Array.isArray(value))
      ? { success: true, data: value ?? {} }
      : { success: false, error: { issues: [{ path: [], message: 'Expected an object' }] } },
};

export default {
  id: 'hello-tools',
  name: 'Hello Tools',
  version: '1.0.0',
  apiVersion: 1,
  description: 'Adds the script_summary tool.',

  activate(ctx) {
    ctx.logger.info('Hello Tools activated');
    ctx.registerTool({
      name: 'script_summary',
      description:
        'Summarize the GDScript files in the project: count, total lines and the five largest scripts.',
      access: 'read',
      // Offer the tool to every agent role (or list ids, e.g. ['qa', 'programmer']).
      agents: 'all',
      input: noInput,
      async run(_input, toolContext) {
        // Always use the sandboxed workspace — never the file system directly.
        const files = await toolContext.workspace.files(['.gd']);
        const sizes = [];
        for (const file of files) {
          const text = await toolContext.workspace.readText(file);
          sizes.push({ file, lines: text.split('\n').length });
        }
        sizes.sort((a, b) => b.lines - a.lines);
        const total = sizes.reduce((sum, s) => sum + s.lines, 0);
        const top = sizes.slice(0, 5).map((s) => `- ${s.file}: ${s.lines} lines`);
        return {
          output: [`${files.length} scripts, ${total} lines`, ...top].join('\n'),
          data: sizes,
        };
      },
    });
  },

  deactivate() {},
};
