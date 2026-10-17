import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  GameForgeError,
  killTree,
  runCommand,
  spawnSafe,
  toUserError,
  type CommandResult,
  type EngineContext,
  type RunningGame,
  type TestResult,
  type TestRunReport,
  type ValidationResult,
} from '@gameforge/core';
import { consoleVariant } from './detect.js';

export interface EngineError {
  file?: string;
  line?: number;
  message: string;
}

/** Errors Godot prints that don't indicate a problem in the project. */
const BENIGN = [
  /Couldn't load file '.*\.godot\/editor/i,
  /No loader found for resource: .*\.import/i,
  /editor_layout|project_metadata\.cfg/i,
  /ObjectDB instances leaked at exit/i,
  /resources still in use at exit/i,
  /BUG: Unreferenced static string/i,
  /Unicode parsing error/i,
  /Pages in use exist at exit/i,
  /Condition "!windows.has\(p_window\)"/i,
];

/** Extracts script / engine errors from Godot's output. */
export function parseGodotErrors(output: string): EngineError[] {
  const lines = output.split(/\r?\n/);
  const errors: EngineError[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    const match = /^(SCRIPT ERROR|USER SCRIPT ERROR|ERROR|USER ERROR|Parse Error):\s*(.*)$/.exec(
      line,
    );
    if (!match) continue;
    const message = match[2]!.trim();
    if (BENIGN.some((pattern) => pattern.test(message))) continue;
    let file: string | undefined;
    let lineNumber: number | undefined;
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const at =
        /at:.*\((res:\/\/[^:)]+):(\d+)\)/.exec(lines[j]!) ??
        /(res:\/\/[^\s:)]+):(\d+)/.exec(lines[j]!);
      if (at) {
        file = at[1]!.replace('res://', '');
        lineNumber = Number(at[2]);
        break;
      }
    }
    const inline = /(res:\/\/[^\s:")]+)(?::(\d+))?/.exec(message);
    if (!file && inline) {
      file = inline[1]!.replace('res://', '');
      if (inline[2]) lineNumber = Number(inline[2]);
    }
    // Engine-internal file references ("at: load (modules/...)") are not project files.
    if (file && /^(core|modules|scene|servers|editor|platform|drivers)\//.test(file))
      file = undefined;
    const key = `${file ?? ''}:${lineNumber ?? ''}:${message}`;
    if (!errors.some((e) => `${e.file ?? ''}:${e.line ?? ''}:${e.message}` === key)) {
      errors.push({
        ...(file ? { file } : {}),
        ...(lineNumber ? { line: lineNumber } : {}),
        message,
      });
    }
  }
  return errors;
}

/** Parses the GFTEST protocol of tests/run_tests.gd. */
export function parseTestOutput(
  output: string,
): Omit<TestRunReport, 'runner' | 'output' | 'durationMs' | 'ok'> & { summaryFound: boolean } {
  const results: TestResult[] = [];
  let summary: number[] | null = null;
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split('|');
    if (parts[0] !== 'GFTEST') continue;
    const [, kind, file, name, ...rest] = parts;
    if (kind === 'PASS')
      results.push({
        name: `${file}::${name}`,
        status: 'passed',
        ...(file ? { file: `tests/${file}` } : {}),
      });
    else if (kind === 'FAIL')
      results.push({
        name: `${file}::${name}`,
        status: 'failed',
        message: rest.join('|'),
        ...(file ? { file: `tests/${file}` } : {}),
      });
    else if (kind === 'SKIP')
      results.push({
        name: `${file}::${name}`,
        status: 'skipped',
        message: rest.join('|'),
        ...(file ? { file: `tests/${file}` } : {}),
      });
    else if (kind === 'SUMMARY') summary = parts.slice(2).map(Number);
  }
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  return {
    total: summary?.[0] ?? results.length,
    passed,
    failed,
    skipped,
    results,
    summaryFound: summary !== null,
  };
}

/** Script that loads every script and scene so parse errors surface in one run. */
const VALIDATE_SCRIPT = `extends SceneTree
# Written by XyoLua GameForge: loads every script and scene of the project
# so that parse errors and broken references are reported in one run.

func _initialize() -> void:
	var failures := 0
	for path in _collect("res://"):
		var resource := load(path)
		if resource == null:
			failures += 1
			print("GFCHECK|FAIL|%s|could not be loaded" % path)
		elif resource is GDScript and not (resource as GDScript).can_instantiate():
			failures += 1
			print("GFCHECK|FAIL|%s|script has errors" % path)
	print("GFCHECK|DONE|%d" % failures)
	quit(1 if failures > 0 else 0)


func _collect(dir: String) -> Array[String]:
	var found: Array[String] = []
	for file in DirAccess.get_files_at(dir):
		if file.ends_with(".gd") or file.ends_with(".tscn"):
			found.append(dir.path_join(file))
	for sub in DirAccess.get_directories_at(dir):
		if not sub.begins_with(".") and sub != "addons":
			found.append_array(_collect(dir.path_join(sub)))
	return found
`;

export class GodotRunner {
  constructor(private readonly resolveExecutable: () => Promise<string | null>) {}

  async executable(): Promise<string> {
    const exe = await this.resolveExecutable();
    if (!exe) {
      throw new GameForgeError('ENGINE_NOT_FOUND', 'Godot not detected.', {
        reason: 'GameForge could not find a Godot 4.3+ executable.',
        solution:
          'Install Godot from https://godotengine.org/download, then select it in Settings → Godot (or set GODOT_PATH).',
      });
    }
    return exe;
  }

  private async run(
    root: string,
    args: string[],
    context: EngineContext,
    timeoutMs: number,
    label: string,
  ): Promise<CommandResult> {
    const exe = consoleVariant(await this.executable());
    const argv = [exe, ...args];
    if (context.permissions) await context.permissions.authorizeCommand(argv, 'QA');
    context.logger.info(`Godot ${label}: ${args.join(' ')}`);
    return runCommand(argv, {
      cwd: root,
      timeoutMs,
      maxOutputBytes: 500_000,
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.onOutput ? { onOutput: context.onOutput } : {}),
    });
  }

  /**
   * Asks once (when called on behalf of an agent) and returns a context that
   * does not ask again for the follow-up Godot runs of the same operation.
   */
  private async authorizeOnce(context: EngineContext, purpose: string): Promise<EngineContext> {
    if (!context.permissions) return context;
    const exe = consoleVariant(await this.executable());
    const command = `${exe} --headless --path .`;
    await context.permissions.confirm({
      kind: 'command',
      title: 'Confirmation required',
      message: `QA wants to execute:

${command}

Purpose: ${purpose}. Godot executes the project scripts on your machine.`,
      command,
      risk: 'medium',
      requestedBy: 'QA',
      // Same key as evaluateCommand() uses for Godot, so "Allow for project" covers all Godot runs.
      grantKey: 'cmd:godot',
    });
    const { permissions: _granted, ...rest } = context;
    return rest;
  }

  /** Imports resources (textures, audio) so the project can run. */
  async importProject(root: string, context: EngineContext): Promise<CommandResult> {
    return this.run(root, ['--headless', '--path', '.', '--import'], context, 300_000, 'import');
  }

  async ensureImported(root: string, context: EngineContext): Promise<void> {
    if (!existsSync(path.join(root, '.godot', 'imported'))) await this.importProject(root, context);
  }

  /** Imports, loads every script/scene and runs the game scene headless for a few hundred frames. */
  async validate(root: string, context: EngineContext): Promise<ValidationResult> {
    let output = '';
    try {
      await this.executable();
    } catch {
      return { ok: false, engineAvailable: false, errors: [], output: 'Godot not detected.' };
    }
    context = await this.authorizeOnce(
      context,
      'validate the project (import, load all scripts, short headless run)',
    );
    const imported = await this.importProject(root, context);
    output += imported.stdout + imported.stderr;
    const toolDir = path.join(root, '.gameforge', 'tools');
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(path.join(toolDir, 'validate.gd'), VALIDATE_SCRIPT, 'utf8');
    const check = await this.run(
      root,
      ['--headless', '--path', '.', '-s', 'res://.gameforge/tools/validate.gd'],
      context,
      180_000,
      'check',
    );
    output += `\n${check.stdout}\n${check.stderr}`;
    const errors = parseGodotErrors(`${check.stdout}\n${check.stderr}`);
    for (const line of check.stdout.split(/\r?\n/)) {
      const failure = /^GFCHECK\|FAIL\|res:\/\/([^|]+)\|(.*)$/.exec(line.trim());
      if (failure && !errors.some((e) => e.file === failure[1]))
        errors.push({ file: failure[1]!, message: failure[2]! });
    }
    // Run the game scene for ~3 seconds of frames to catch runtime errors in _ready / physics.
    const gameScene = existsSync(path.join(root, 'scenes', 'main.tscn'))
      ? 'res://scenes/main.tscn'
      : null;
    if (gameScene) {
      const play = await this.run(
        root,
        ['--headless', '--path', '.', '--quit-after', '200', gameScene],
        context,
        120_000,
        'smoke run',
      );
      output += `\n${play.stdout}\n${play.stderr}`;
      for (const error of parseGodotErrors(`${play.stdout}\n${play.stderr}`)) {
        if (!errors.some((e) => e.message === error.message && e.file === error.file))
          errors.push(error);
      }
      if (play.timedOut)
        errors.push({ message: 'The game scene did not quit (possible infinite loop).' });
    }
    return {
      ok: errors.length === 0,
      engineAvailable: true,
      errors,
      output: output.slice(-50_000),
    };
  }

  async runTests(root: string, context: EngineContext): Promise<TestRunReport> {
    const started = Date.now();
    const base = { runner: 'GameForge test runner', durationMs: 0 };
    const hasRunner = existsSync(path.join(root, 'tests', 'run_tests.gd'));
    const hasGut = existsSync(path.join(root, 'addons', 'gut', 'gut_cmdln.gd'));
    if (!hasRunner && !hasGut) {
      return {
        ...base,
        ok: false,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        results: [],
        output: '',
        error: {
          code: 'PROJECT_INVALID',
          message: 'No tests found.',
          solution: 'Add tests/run_tests.gd (GameForge format) or the GUT addon.',
        },
      };
    }
    try {
      context = await this.authorizeOnce(context, 'run the project tests headless');
      await this.ensureImported(root, context);
      if (hasRunner) {
        const result = await this.run(
          root,
          ['--headless', '--path', '.', '-s', 'res://tests/run_tests.gd'],
          context,
          180_000,
          'tests',
        );
        const output = `${result.stdout}\n${result.stderr}`;
        const parsed = parseTestOutput(output);
        const errors = parseGodotErrors(output);
        const ok = result.exitCode === 0 && parsed.failed === 0 && parsed.summaryFound;
        return {
          runner: base.runner,
          ok,
          total: parsed.total,
          passed: parsed.passed,
          failed: parsed.failed,
          skipped: parsed.skipped,
          results: parsed.results,
          output,
          durationMs: Date.now() - started,
          ...(!parsed.summaryFound
            ? {
                error: {
                  code: 'COMMAND_FAILED',
                  message: 'The test runner did not finish.',
                  reason: errors[0]?.message ?? `exit code ${result.exitCode}`,
                },
              }
            : {}),
        };
      }
      const result = await this.run(
        root,
        [
          '--headless',
          '--path',
          '.',
          '-s',
          'res://addons/gut/gut_cmdln.gd',
          '-gdir=res://tests',
          '-gexit',
        ],
        context,
        300_000,
        'GUT tests',
      );
      const output = `${result.stdout}\n${result.stderr}`;
      const passing = Number(/Passing tests\s+(\d+)/i.exec(output)?.[1] ?? 0);
      const failing = Number(/Failing tests\s+(\d+)/i.exec(output)?.[1] ?? 0);
      return {
        runner: 'GUT',
        ok: result.exitCode === 0 && failing === 0,
        total: passing + failing,
        passed: passing,
        failed: failing,
        skipped: 0,
        results: [],
        output,
        durationMs: Date.now() - started,
      };
    } catch (error) {
      return {
        ...base,
        ok: false,
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        results: [],
        output: '',
        durationMs: Date.now() - started,
        error: toUserError(error),
      };
    }
  }

  /** Starts the game window. With a preview file, the bridge autoload writes live screenshots. */
  async runGame(
    root: string,
    options: { mode: 'play' | 'debug'; previewFile?: string } & EngineContext,
  ): Promise<RunningGame> {
    await this.ensureImported(root, options);
    const exe = consoleVariant(await this.executable());
    const args = ['--path', '.'];
    if (options.mode === 'debug') args.push('--debug-collisions', '--debug-paths', '--verbose');
    if (options.previewFile) args.push('--', `--gameforge-preview=${options.previewFile}`);
    const child = spawnSafe([exe, ...args], { cwd: root });
    const outputListeners = new Set<(stream: 'stdout' | 'stderr', text: string) => void>();
    const exitListeners = new Set<(code: number | null) => void>();
    const forward = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      options.onOutput?.(stream, text);
      for (const listener of outputListeners) listener(stream, text);
    };
    child.stdout?.on('data', forward('stdout'));
    child.stderr?.on('data', forward('stderr'));
    child.on('exit', (code) => {
      for (const listener of exitListeners) listener(code);
    });
    child.on('error', (error) => options.logger.error('Godot process error', error));
    options.logger.info(`Started game (pid ${child.pid}): ${args.join(' ')}`);
    return {
      pid: child.pid,
      command: [exe, ...args].join(' '),
      onOutput: (listener) => {
        outputListeners.add(listener);
        return () => outputListeners.delete(listener);
      },
      onExit: (listener) => {
        exitListeners.add(listener);
        return () => exitListeners.delete(listener);
      },
      stop: () => killTree(child),
    };
  }
}
