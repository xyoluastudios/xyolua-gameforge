import { z } from 'zod';
import { GameForgeError } from '../errors.js';
import { parseCommand, runCommand } from '../process/command.js';
import { SEVERITY_ORDER } from '../engines/types.js';
import { defineTool, type ToolDefinition } from './types.js';

/** Converts a simple glob (`*.gd`, `scripts/**`, `**\/*.tscn`) to a RegExp. */
export function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slash = glob[i + 2] === '/';
        pattern += slash ? '(?:.*/)?' : '.*';
        i += slash ? 2 : 1;
      } else pattern += '[^/]*';
    } else if (ch === '?') pattern += '[^/]';
    else if ('\\^$+.()|{}[]'.includes(ch)) pattern += `\\${ch}`;
    else pattern += ch;
  }
  // A pattern without a slash matches the file name anywhere.
  return glob.includes('/')
    ? new RegExp(`^${pattern}$`, 'i')
    : new RegExp(`(?:^|/)${pattern}$`, 'i');
}

const pathField = z
  .string()
  .min(1)
  .describe('Path relative to the project root (res:// paths are accepted).');

export const readFileTool = defineTool({
  name: 'read_file',
  description:
    'Read a text file from the project. Optionally pass start_line/end_line (1-based, inclusive) for large files.',
  access: 'read',
  input: z.object({
    path: pathField,
    start_line: z.number().int().min(1).optional(),
    end_line: z.number().int().min(1).optional(),
  }),
  async run(input, ctx) {
    const content = await ctx.workspace.readText(input.path);
    const lines = content.split('\n');
    const start = input.start_line ?? 1;
    const end = Math.min(input.end_line ?? lines.length, lines.length);
    const slice =
      start === 1 && end === lines.length ? content : lines.slice(start - 1, end).join('\n');
    const header = `File: ${ctx.workspace.resolve(input.path).rel} (${lines.length} lines${start !== 1 || end !== lines.length ? `, showing ${start}-${end}` : ''})`;
    return { output: `${header}\n${slice}`, data: { content: slice, totalLines: lines.length } };
  },
});

export const writeFileTool = defineTool({
  name: 'write_file',
  description:
    'Create or overwrite a text file in the project with the complete new content. Parent folders are created automatically. Prefer edit_file for small changes to existing files.',
  access: 'write',
  input: z.object({ path: pathField, content: z.string() }),
  async run(input, ctx) {
    const { created } = await ctx.workspace.writeText(input.path, input.content, ctx.actor);
    const rel = ctx.workspace.resolve(input.path).rel;
    return {
      output: `${created ? 'Created' : 'Updated'} ${rel} (${input.content.split('\n').length} lines).`,
      data: { path: rel, created },
    };
  },
});

export const editFileTool = defineTool({
  name: 'edit_file',
  description:
    'Replace an exact text snippet in a file. old_string must match the file exactly (including indentation/tabs) and be unique unless replace_all is true. Use read_file first.',
  access: 'write',
  input: z.object({
    path: pathField,
    old_string: z.string().min(1),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  async run(input, ctx) {
    const content = await ctx.workspace.readText(input.path);
    const rel = ctx.workspace.resolve(input.path).rel;
    // Tolerate CRLF files: match on normalized line endings.
    const crlf = content.includes('\r\n');
    const normalized = crlf ? content.replace(/\r\n/g, '\n') : content;
    const oldText = input.old_string.replace(/\r\n/g, '\n');
    const newText = input.new_string.replace(/\r\n/g, '\n');
    const count = normalized.split(oldText).length - 1;
    if (count === 0) {
      throw new GameForgeError('EDIT_NO_MATCH', `old_string was not found in ${rel}.`, {
        reason: 'Read the file again and copy the exact text, including whitespace and tabs.',
      });
    }
    if (count > 1 && !input.replace_all) {
      throw new GameForgeError('EDIT_AMBIGUOUS', `old_string occurs ${count} times in ${rel}.`, {
        reason: 'Include more surrounding lines to make it unique, or set replace_all.',
      });
    }
    let updated = input.replace_all
      ? normalized.split(oldText).join(newText)
      : normalized.replace(oldText, () => newText);
    if (crlf) updated = updated.replace(/\n/g, '\r\n');
    await ctx.workspace.writeText(rel, updated, ctx.actor);
    return {
      output: `Edited ${rel} (${input.replace_all ? count : 1} replacement${count > 1 && input.replace_all ? 's' : ''}).`,
      data: { path: rel },
    };
  },
});

export const deleteFileTool = defineTool({
  name: 'delete_file',
  description:
    'Delete a file in the project. Requires user confirmation unless changes are staged for review.',
  access: 'write',
  input: z.object({ path: pathField }),
  async run(input, ctx) {
    const { rel } = ctx.workspace.resolve(input.path, { forWrite: true });
    if (ctx.workspace.changes?.mode !== 'staged')
      await ctx.permissions.authorizeDelete(rel, ctx.actor);
    await ctx.workspace.deleteFile(rel, ctx.actor);
    return { output: `Deleted ${rel}.`, data: { path: rel } };
  },
});

export const createDirectoryTool = defineTool({
  name: 'create_directory',
  description: 'Create a folder (and parents) inside the project.',
  access: 'write',
  input: z.object({ path: pathField }),
  async run(input, ctx) {
    await ctx.workspace.mkdir(input.path);
    return { output: `Created folder ${ctx.workspace.resolve(input.path).rel}.` };
  },
});

export const listFilesTool = defineTool({
  name: 'list_files',
  description:
    'List files and folders. Use recursive=true for the whole tree (internal folders like .godot are hidden).',
  access: 'read',
  input: z.object({
    path: z.string().optional().describe('Folder relative to the project root (default: root).'),
    recursive: z.boolean().optional(),
    pattern: z.string().optional().describe('Optional glob filter, e.g. "*.gd" or "scenes/**".'),
  }),
  async run(input, ctx) {
    const entries = await ctx.workspace.list(input.path ?? '.', {
      recursive: input.recursive ?? false,
      maxEntries: 2000,
    });
    const regex = input.pattern ? globToRegExp(input.pattern) : null;
    const filtered = entries.filter((e) => !regex || (e.type === 'file' && regex.test(e.path)));
    const lines = filtered.map((e) =>
      e.type === 'directory'
        ? `${e.path}/`
        : `${e.path}${e.size !== undefined ? ` (${e.size} B)` : ''}`,
    );
    return { output: lines.length ? lines.join('\n') : '(empty)', data: filtered };
  },
});

export const searchCodeTool = defineTool({
  name: 'search_code',
  description:
    'Search text in project files. Returns "path:line: text" matches. Use regex=true for regular expressions.',
  access: 'read',
  input: z.object({
    query: z.string().min(1),
    regex: z.boolean().optional(),
    case_sensitive: z.boolean().optional(),
    pattern: z.string().optional().describe('Glob to limit files, e.g. "*.gd".'),
    max_results: z.number().int().min(1).max(500).optional(),
  }),
  async run(input, ctx) {
    let matcher: RegExp;
    try {
      const source = input.regex ? input.query : input.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      matcher = new RegExp(source, input.case_sensitive ? '' : 'i');
    } catch (error) {
      throw new GameForgeError('INVALID_INPUT', 'Invalid regular expression.', {
        reason: String(error),
      });
    }
    const glob = input.pattern ? globToRegExp(input.pattern) : null;
    const max = input.max_results ?? 100;
    const matches: { path: string; line: number; text: string }[] = [];
    for (const file of await ctx.workspace.files()) {
      if (glob && !glob.test(file)) continue;
      let content: string;
      try {
        content = await ctx.workspace.readText(file);
      } catch {
        continue; // binary or too large
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && matches.length < max; i++) {
        if (matcher.test(lines[i]!))
          matches.push({ path: file, line: i + 1, text: lines[i]!.trim().slice(0, 240) });
      }
      if (matches.length >= max) break;
    }
    const output = matches.map((m) => `${m.path}:${m.line}: ${m.text}`).join('\n');
    return { output: output || 'No matches.', data: matches };
  },
});

export const runCommandTool = defineTool({
  name: 'run_command',
  description:
    'Run a single program in the project folder (no shell: pipes, redirects and && are not allowed). Read-only git commands run directly; Godot and unknown programs need user confirmation; destructive, network and shell programs are blocked.',
  access: 'execute',
  input: z.object({
    command: z.string().min(1).max(2000),
    timeout_seconds: z.number().int().min(1).max(600).optional(),
  }),
  async run(input, ctx) {
    const argv = parseCommand(input.command);
    await ctx.permissions.authorizeCommand(argv, ctx.actor);
    const result = await runCommand(argv, {
      cwd: ctx.workspace.root,
      timeoutMs:
        (input.timeout_seconds ?? Math.round((ctx.commandTimeoutMs ?? 120_000) / 1000)) * 1000,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      ...(ctx.onOutput ? { onOutput: ctx.onOutput } : {}),
    });
    const parts = [
      `$ ${result.command}`,
      `exit code: ${result.exitCode ?? 'killed'}${result.timedOut ? ' (timed out)' : ''}${result.truncated ? ' (output truncated)' : ''}`,
    ];
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return { output: parts.join('\n'), data: result };
  },
});

export const runTestsTool = defineTool({
  name: 'run_tests',
  description: 'Run the project test suite with the game engine (headless) and return the results.',
  access: 'execute',
  input: z.object({}),
  async run(_input, ctx) {
    if (!ctx.engine)
      throw new GameForgeError('ENGINE_NOT_SUPPORTED', 'No engine adapter for this project.');
    const report = await ctx.engine.runTests(ctx.workspace.root, {
      logger: ctx.logger,
      permissions: ctx.permissions,
      ...(ctx.signal ? { signal: ctx.signal } : {}),
      ...(ctx.onOutput ? { onOutput: ctx.onOutput } : {}),
    });
    const lines = [
      `${report.ok ? 'PASSED' : 'FAILED'} — ${report.passed}/${report.total} passed, ${report.failed} failed, ${report.skipped} skipped (${report.runner})`,
      ...report.results
        .filter((r) => r.status === 'failed')
        .map((r) => `✗ ${r.name}${r.message ? `: ${r.message}` : ''}`),
    ];
    if (report.error) lines.push(`Error: ${report.error.message} ${report.error.reason ?? ''}`);
    if (!report.ok)
      lines.push('', 'Output (tail):', report.output.split('\n').slice(-40).join('\n'));
    return { output: lines.join('\n'), data: report };
  },
});

export const gitStatusTool = defineTool({
  name: 'git_status',
  description: 'Show the git branch and changed files of the project.',
  access: 'read',
  input: z.object({}),
  async run(_input, ctx) {
    const status = await ctx.git.status(ctx.workspace.root);
    if (!status.isRepo) return { output: 'Not a git repository.', data: status };
    const lines = [`On branch ${status.branch ?? '(detached)'}`];
    lines.push(
      ...(status.files.length
        ? status.files.map((f) => `${f.code} ${f.path}`)
        : ['Working tree clean.']),
    );
    return { output: lines.join('\n'), data: status };
  },
});

export const gitDiffTool = defineTool({
  name: 'git_diff',
  description:
    'Show the git diff of the working tree (optionally for one file, or staged changes).',
  access: 'read',
  input: z.object({ path: z.string().optional(), staged: z.boolean().optional() }),
  async run(input, ctx) {
    const rel = input.path ? ctx.workspace.resolve(input.path).rel : undefined;
    const diff = await ctx.git.diff(ctx.workspace.root, {
      ...(rel ? { path: rel } : {}),
      staged: input.staged ?? false,
    });
    return { output: diff || 'No differences.', data: diff };
  },
});

export const analyzeProjectTool = defineTool({
  name: 'analyze_project',
  description:
    'Statically analyze the game project: structure, scores and a prioritized list of issues.',
  access: 'read',
  input: z.object({ max_issues: z.number().int().min(1).max(200).optional() }),
  async run(input, ctx) {
    if (!ctx.engine)
      throw new GameForgeError('ENGINE_NOT_SUPPORTED', 'No engine adapter for this project.');
    const report = await ctx.engine.analyze(ctx.workspace, { logger: ctx.logger });
    const issues = [...report.issues].sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    const lines = [
      `Project: ${report.projectName} (${report.engine}${report.engineVersion ? ` ${report.engineVersion}` : ''})`,
      `Scores — architecture ${report.scores.architecture}, code quality ${report.scores.codeQuality}, testing ${report.scores.testing}, documentation ${report.scores.documentation}`,
      `Files: ${report.stats.files}, scripts: ${report.stats.scripts}, scenes: ${report.stats.scenes}, tests: ${report.stats.tests}`,
      `Main scene: ${report.structure.mainScene ?? '(none)'}; autoloads: ${report.structure.autoloads.join(', ') || '(none)'}`,
      `Issues (${issues.length}):`,
      ...issues
        .slice(0, input.max_issues ?? 50)
        .map(
          (i) =>
            `[${i.severity}] ${i.id}: ${i.title}${i.file ? ` — ${i.file}${i.line ? `:${i.line}` : ''}` : ''}. ${i.message}`,
        ),
    ];
    return { output: lines.join('\n'), data: report };
  },
});

export const pendingChangesTool = defineTool({
  name: 'get_pending_changes',
  description: 'List the file changes made in this session that are waiting for user review.',
  access: 'read',
  input: z.object({}),
  async run(_input, ctx) {
    const summary = ctx.workspace.changes?.summary() ?? [];
    return {
      output: summary.length
        ? summary
            .map((c) => `${c.kind.padEnd(6)} ${c.path} (+${c.additions} -${c.deletions})`)
            .join('\n')
        : 'No pending changes.',
      data: summary,
    };
  },
});

export function builtinTools(): ToolDefinition[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    deleteFileTool,
    createDirectoryTool,
    listFilesTool,
    searchCodeTool,
    runCommandTool,
    runTestsTool,
    gitStatusTool,
    gitDiffTool,
    analyzeProjectTool,
    pendingChangesTool,
  ] as ToolDefinition[];
}
