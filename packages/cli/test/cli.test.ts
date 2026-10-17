import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from '../src/main.js';
import type { CliIO } from '../src/io.js';
import { tempDir, writeFiles } from '../../core/test/helpers.js';

function fakeIO(answers: string[] = []): CliIO & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    ask: async () => answers.shift() ?? null,
    interactive: answers.length > 0,
    color: false,
  };
}

// Never find a real Godot in unit tests (the integration tests cover it).
const env = (extra: Record<string, string> = {}) => ({ PATH: '', GODOT_PATH: '', ...extra });

describe('gameforge CLI', () => {
  it('prints help and version', async () => {
    const io = fakeIO();
    expect(await main(['--help'], io, { configDir: tempDir(), env: env() })).toBe(0);
    expect(io.stdout.join('\n')).toContain('gameforge create');
    const version = fakeIO();
    expect(await main(['--version'], version, { configDir: tempDir(), env: env() })).toBe(0);
    expect(version.stdout).toEqual(['0.1.0']);
    expect(await main(['nonsense'], fakeIO(), { configDir: tempDir(), env: env() })).toBe(2);
  });

  it('creates a game end-to-end with the offline mock provider', async () => {
    const parent = tempDir('gf-cli-');
    const io = fakeIO();
    const code = await main(
      [
        'create',
        'A 2D top-down dungeon game with keys and a slime enemy',
        '--dir',
        parent,
        '--yes',
        '--no-git',
      ],
      io,
      {
        configDir: tempDir(),
        env: env({ AI_PROVIDER: 'mock' }),
      },
    );
    const out = io.stdout.join('\n');
    expect(code, `${out}\n${io.stderr.join('\n')}`).toBe(0);
    expect(out).toContain('GAME PLAN');
    expect(out).toContain('✓ Programmer Create project, scenes and scripts');
    expect(out).toContain('QA Run tests — Godot not detected');
    const created = out.match(/Created \d+ files in (.+)$/m)?.[1];
    expect(created && existsSync(path.join(created, 'project.godot'))).toBe(true);
  });

  it('lets the user cancel the plan', async () => {
    const parent = tempDir('gf-cli-');
    const io = fakeIO(['c']);
    io.interactive = true;
    const code = await main(['create', 'A horror game'], io, {
      configDir: tempDir(),
      env: env({ AI_PROVIDER: 'mock' }),
    });
    expect(code).toBe(1);
    expect(io.stdout.join('\n')).toContain('Cancelled. Nothing was created.');
    expect(existsSync(path.join(parent, 'abandoned'))).toBe(false);
  });

  it('explains a missing AI provider without a stack trace', async () => {
    const io = fakeIO();
    const code = await main(['create', 'A horror game', '--yes'], io, {
      configDir: tempDir(),
      env: env(),
    });
    expect(code).toBe(1);
    const err = io.stderr.join('\n');
    expect(err).toContain('No AI provider is configured.');
    expect(err).toContain('Solution:');
    expect(err).not.toMatch(/at .*\.(ts|js):\d+/);
  });

  it('analyzes and fixes a project, staging changes until approved', async () => {
    const root = tempDir('gf-cli-fix-');
    writeFiles(root, {
      'project.godot': 'config_version=5\n\n[application]\n\nconfig/name="Legacy"\n',
      'scenes/main.tscn': '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n',
      'scripts/a.gd': 'extends Node\n\nonready var x = 1\n',
    });
    const analyze = fakeIO();
    expect(
      await main(['analyze', root], analyze, {
        configDir: tempDir(),
        env: env({ AI_PROVIDER: 'mock' }),
      }),
    ).toBe(0);
    expect(analyze.stdout.join('\n')).toMatch(/Issues found: \d+/);
    expect(analyze.stdout.join('\n')).toContain('Godot 3 "onready" syntax');

    const declined = fakeIO(['y', 'n']);
    expect(
      await main(['fix', root, '--critical'], declined, {
        configDir: tempDir(),
        env: env({ AI_PROVIDER: 'mock' }),
      }),
    ).toBe(1);
    expect(readFileSync(path.join(root, 'scripts/a.gd'), 'utf8')).toContain('onready var x');

    const accepted = fakeIO();
    expect(
      await main(['fix', root, '--critical', '--yes'], accepted, {
        configDir: tempDir(),
        env: env({ AI_PROVIDER: 'mock' }),
      }),
    ).toBe(0);
    expect(readFileSync(path.join(root, 'scripts/a.gd'), 'utf8')).toContain('@onready var x');
    expect(readFileSync(path.join(root, 'project.godot'), 'utf8')).toContain(
      'run/main_scene="res://scenes/main.tscn"',
    );
  });

  it('manages non-secret settings', async () => {
    const configDir = tempDir();
    expect(
      await main(['config', 'set', 'ai.ollama.model', 'qwen3'], fakeIO(), {
        configDir,
        env: env(),
      }),
    ).toBe(0);
    const get = fakeIO();
    await main(['config', 'get', 'ai.ollama.model'], get, { configDir, env: env() });
    expect(get.stdout).toEqual(['"qwen3"']);
    const bad = fakeIO();
    expect(
      await main(['config', 'set', 'ai.anthropic.apiKey', 'sk-ant-x'], bad, {
        configDir,
        env: env(),
      }),
    ).toBe(1);
    expect(bad.stderr.join('\n')).toContain('API keys belong in environment variables');
  });

  it('refuses to start the MCP server unless enabled', async () => {
    const io = fakeIO();
    expect(await main(['mcp'], io, { configDir: tempDir(), env: env() })).toBe(1);
    expect(io.stderr.join('\n')).toContain('The MCP server is disabled.');
  });

  it('runs doctor', async () => {
    const io = fakeIO();
    await main(['doctor'], io, { configDir: tempDir(), env: env({ AI_PROVIDER: 'mock' }) });
    const out = io.stdout.join('\n');
    expect(out).toContain('XyoLua GameForge Doctor');
    expect(out).toContain('Node.js');
    expect(out).toContain('Godot');
  });
});
