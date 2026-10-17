import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GameForgeError } from '../src/errors.js';
import {
  evaluateCommand,
  GrantStore,
  PermissionManager,
  type ConfirmationRequest,
} from '../src/permissions/permissions.js';
import { parseCommand, runCommand } from '../src/process/command.js';
import { isSensitiveEnvKey, maskKey, redactSecrets, sanitizeEnv } from '../src/secrets.js';
import { protectionFor } from '../src/workspace/path-guard.js';
import { Workspace } from '../src/workspace/workspace.js';
import { tempDir, writeFiles } from './helpers.js';

describe('secret filtering', () => {
  it('redacts well-known key formats', () => {
    const text = [
      'anthropic sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789',
      'github ghp_abcdefghijklmnopqrstuvwxyz0123456789AB',
      'aws AKIAABCDEFGHIJKLMNOP',
      'OPENAI_API_KEY=sk-proj-1234567890abcdefghijklmn',
      'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
      '-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----',
    ].join('\n');
    const redacted = redactSecrets(text);
    expect(redacted).not.toContain('sk-ant-api03');
    expect(redacted).not.toContain('ghp_abc');
    expect(redacted).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(redacted).not.toContain('sk-proj-123');
    expect(redacted).not.toContain('MIIEvQ');
    expect(redacted).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(redacted).toContain('Bearer [REDACTED]');
  });

  it('leaves normal text alone', () => {
    const text = 'var speed = 5.0\nfunc _ready():\n\tpass';
    expect(redactSecrets(text)).toBe(text);
  });

  it('removes credentials from child process environments', () => {
    const env = sanitizeEnv({
      PATH: '/usr/bin',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      GITHUB_TOKEN: 'ghp_x',
      DB_PASSWORD: 'hunter2',
      GIT_AUTHOR_NAME: 'Ada',
      XDG_SESSION_TYPE: 'wayland',
      HOME: '/home/ada',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      GIT_AUTHOR_NAME: 'Ada',
      XDG_SESSION_TYPE: 'wayland',
      HOME: '/home/ada',
    });
    expect(isSensitiveEnvKey('OPENAI_APIKEY')).toBe(true);
    expect(isSensitiveEnvKey('SSH_AUTH_SOCK')).toBe(true);
    expect(isSensitiveEnvKey('PATH')).toBe(false);
  });

  it('masks keys for display', () => {
    expect(maskKey('sk-ant-api03-abcdefghij1234')).toBe('sk-ant…1234');
    expect(maskKey(undefined)).toBe('');
  });
});

describe('path protection', () => {
  it('flags secrets and internal folders', () => {
    expect(protectionFor('.env', false)).toBe('secret');
    expect(protectionFor('config/.env.production', false)).toBe('secret');
    expect(protectionFor('.env.example', false)).toBeNull();
    expect(protectionFor('.ssh/id_ed25519', false)).toBe('secret');
    expect(protectionFor('keys/id_rsa', false)).toBe('secret');
    expect(protectionFor('android/release.keystore', false)).toBe('secret');
    expect(protectionFor('.godot/export_credentials.cfg', false)).toBe('secret');
    expect(protectionFor('.git/config', false)).toBeNull();
    expect(protectionFor('.git/config', true)).toBe('read-only');
    expect(protectionFor('scripts/player.gd', true)).toBeNull();
  });
});

describe('Workspace sandbox', () => {
  it('blocks path traversal and absolute paths outside the project', async () => {
    const root = tempDir();
    const ws = Workspace.open(root);
    for (const bad of [
      '../outside.txt',
      '..\\outside.txt',
      'a/../../outside.txt',
      path.resolve(root, '..', 'x.txt'),
    ]) {
      await expect(ws.readText(bad)).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
      await expect(ws.writeText(bad, 'x')).rejects.toMatchObject({
        code: 'PATH_OUTSIDE_WORKSPACE',
      });
    }
  });

  it('accepts res:// paths and normal relative paths', async () => {
    const root = tempDir();
    writeFiles(root, { 'scripts/player.gd': 'extends Node\n' });
    const ws = Workspace.open(root);
    expect(await ws.readText('res://scripts/player.gd')).toBe('extends Node\n');
    expect(ws.resolve('./scripts/../scripts/player.gd').rel).toBe('scripts/player.gd');
  });

  it('never lets agents read or write .env and key files', async () => {
    const root = tempDir();
    writeFiles(root, {
      '.env': 'ANTHROPIC_API_KEY=sk-ant-secret',
      '.ssh/id_rsa': 'key',
      'a.txt': 'ok',
    });
    const ws = Workspace.open(root);
    await expect(ws.readText('.env')).rejects.toMatchObject({ code: 'PATH_PROTECTED' });
    await expect(ws.writeText('.env', 'x')).rejects.toMatchObject({ code: 'PATH_PROTECTED' });
    await expect(ws.readText('.ssh/id_rsa')).rejects.toMatchObject({ code: 'PATH_PROTECTED' });
    await expect(ws.writeText('.git/hooks/pre-commit', 'x')).rejects.toMatchObject({
      code: 'PATH_PROTECTED',
    });
    const listed = (await ws.list('.', { recursive: true })).map((e) => e.path);
    expect(listed).toContain('a.txt');
    expect(listed).not.toContain('.env');
    // The user policy may edit .env in the editor.
    expect(await ws.withPolicy('user').readText('.env')).toContain('ANTHROPIC_API_KEY');
  });

  it('does not follow symlinks out of the project', async () => {
    const root = tempDir();
    const outside = tempDir();
    writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
    try {
      symlinkSync(outside, path.join(root, 'link'), 'junction');
    } catch {
      return; // symlinks not permitted on this system
    }
    const ws = Workspace.open(root);
    await expect(ws.readText('link/secret.txt')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    await expect(ws.writeText('link/new.txt', 'x')).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
  });

  it('refuses binary reads and oversized writes', async () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'assets'));
    writeFileSync(
      path.join(root, 'assets', 'icon.png'),
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]),
    );
    const ws = Workspace.open(root, { maxWriteBytes: 10 });
    await expect(ws.readText('assets/icon.png')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(ws.writeText('big.txt', 'x'.repeat(11))).rejects.toMatchObject({
      code: 'FILE_TOO_LARGE',
    });
  });
});

describe('command safety', () => {
  it('parses commands without a shell', () => {
    expect(parseCommand('godot --headless --path "my game" -s res://t.gd')).toEqual([
      'godot',
      '--headless',
      '--path',
      'my game',
      '-s',
      'res://t.gd',
    ]);
  });

  it('rejects shell operators', () => {
    for (const bad of [
      'ls | grep x',
      'a && b',
      'a; rm -rf /',
      'echo $(whoami)',
      'cat < x',
      'echo `id`',
      'a > b',
    ]) {
      expect(() => parseCommand(bad), bad).toThrowError(GameForgeError);
    }
  });

  it('applies the allow/confirm/block policy', () => {
    const root = path.resolve('/projects/game');
    expect(evaluateCommand(['git', 'status'], { root }).action).toBe('allow');
    expect(evaluateCommand(['git', 'push'], { root }).action).toBe('block');
    expect(evaluateCommand(['rm', '-rf', '.'], { root }).action).toBe('block');
    expect(evaluateCommand(['powershell', '-c', 'x'], { root }).action).toBe('block');
    expect(evaluateCommand(['curl', 'http://x'], { root }).action).toBe('block');
    expect(evaluateCommand(['godot', '--headless'], { root }).action).toBe('confirm');
    expect(evaluateCommand(['npm', 'install'], { root })).toMatchObject({
      action: 'confirm',
      grantKey: 'npm install',
    });
    expect(evaluateCommand(['godot', '--path', path.resolve('/etc')], { root }).action).toBe(
      'block',
    );
    expect(evaluateCommand(['godot', '--path', '../other'], { root }).action).toBe('block');
  });

  it('runs commands with timeout, output limit and sanitized env', async () => {
    const cwd = tempDir();
    process.env.GF_TEST_SECRET_TOKEN = 'must-not-leak';
    const ok = await runCommand(
      [process.execPath, '-e', 'console.log(process.env.GF_TEST_SECRET_TOKEN ?? "none")'],
      {
        cwd,
        env: {},
      },
    );
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.trim()).toBe('none');

    const slow = await runCommand([process.execPath, '-e', 'setTimeout(() => {}, 10000)'], {
      cwd,
      timeoutMs: 300,
    });
    expect(slow.timedOut).toBe(true);

    const noisy = await runCommand(
      [process.execPath, '-e', 'process.stdout.write("x".repeat(50000))'],
      {
        cwd,
        maxOutputBytes: 1000,
      },
    );
    expect(noisy.stdout.length).toBe(1000);
    expect(noisy.truncated).toBe(true);
  });
});

describe('PermissionManager', () => {
  const setup = (decision: 'once' | 'project' | 'deny') => {
    const root = tempDir();
    const grantsFile = path.join(tempDir(), 'grants.json');
    const requests: ConfirmationRequest[] = [];
    const manager = new PermissionManager({
      root,
      grants: new GrantStore(grantsFile),
      confirm: async (request) => {
        requests.push(request);
        return decision;
      },
    });
    return { root, grantsFile, requests, manager };
  };

  it('asks for confirmation and remembers "Allow for project" outside the project', async () => {
    const { root, grantsFile, requests, manager } = setup('project');
    await manager.authorizeCommand(['npm', 'install'], 'Programmer');
    await manager.authorizeCommand(['npm', 'install'], 'Programmer');
    expect(requests).toHaveLength(1);
    expect(requests[0]!.command).toBe('npm install');
    expect(new GrantStore(grantsFile).has(root, 'cmd:npm install')).toBe(true);
  });

  it('"Allow once" asks every time', async () => {
    const { requests, manager } = setup('once');
    await manager.authorizeCommand(['npm', 'install'], 'Programmer');
    await manager.authorizeCommand(['npm', 'install'], 'Programmer');
    expect(requests).toHaveLength(2);
  });

  it('cancel throws PERMISSION_DENIED, blocked commands never ask', async () => {
    const { requests, manager } = setup('deny');
    await expect(manager.authorizeCommand(['npm', 'install'], 'QA')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED',
    });
    await expect(manager.authorizeCommand(['shutdown', '/s'], 'QA')).rejects.toMatchObject({
      code: 'COMMAND_BLOCKED',
    });
    expect(requests).toHaveLength(1);
  });
});
