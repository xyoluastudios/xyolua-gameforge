import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GameForge } from './app.js';
import { toUserError } from './errors.js';
import { findExecutable, runCommand } from './process/command.js';
import { maskKey } from './secrets.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip';

export interface DoctorCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  solution?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  ready: boolean;
}

async function versionOf(program: string, args = ['--version']): Promise<string | null> {
  if (!findExecutable(program)) return null;
  try {
    const result = await runCommand([program, ...args], { cwd: process.cwd(), timeoutMs: 15_000 });
    return result.exitCode === 0 ? (result.stdout || result.stderr).trim().split('\n')[0]! : null;
  } catch {
    return null;
  }
}

/** `gameforge doctor`: checks everything GameForge needs, without changing anything. */
export async function runDoctor(
  app: GameForge,
  options: { online?: boolean; cwd?: string } = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const cwd = options.cwd ?? process.cwd();

  // Node.js
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || (major === 22 && minor >= 12);
  checks.push({
    id: 'node',
    label: 'Node.js',
    status: nodeOk ? 'ok' : 'fail',
    detail: `v${process.versions.node}`,
    ...(nodeOk ? {} : { solution: 'Install Node.js 22.12 or newer from https://nodejs.org' }),
  });

  // pnpm (only needed to develop GameForge itself)
  const pnpm = await versionOf('pnpm');
  checks.push({
    id: 'pnpm',
    label: 'pnpm',
    status: pnpm ? 'ok' : 'warn',
    detail: pnpm ? `v${pnpm}` : 'not found (only needed to build GameForge from source)',
    ...(pnpm ? {} : { solution: 'corepack enable  (or: npm install -g pnpm)' }),
  });

  // Git
  const git = await versionOf('git');
  checks.push({
    id: 'git',
    label: 'Git',
    status: git ? 'ok' : 'warn',
    detail: git ?? 'not found — version control features are disabled',
    ...(git ? {} : { solution: 'Install Git from https://git-scm.com' }),
  });

  // Engines
  for (const engine of app.engines()) {
    try {
      const install = await engine.detectInstallation();
      checks.push(
        install
          ? {
              id: `engine:${engine.id}`,
              label: engine.displayName,
              status: 'ok',
              detail: `${install.version} (${install.executable}, via ${install.source})`,
            }
          : {
              id: `engine:${engine.id}`,
              label: engine.displayName,
              status: 'warn',
              detail: 'not detected — projects can be generated, but not run or tested',
              solution:
                'Install Godot 4 (https://godotengine.org/download) and set GODOT_PATH or Settings → Godot.',
            },
      );
    } catch (error) {
      checks.push({
        id: `engine:${engine.id}`,
        label: engine.displayName,
        status: 'warn',
        detail: toUserError(error).message,
      });
    }
  }

  // AI provider
  const config = app.aiConfig();
  if (!config.provider) {
    checks.push({
      id: 'ai',
      label: 'AI provider',
      status: 'fail',
      detail: 'not configured',
      solution:
        'Set AI_PROVIDER and the matching key in .env (see .env.example), or use AI_PROVIDER=mock to try it offline.',
    });
  } else {
    try {
      const provider = app.createProvider();
      const keyInfo =
        config.provider === 'anthropic'
          ? ` key ${maskKey(config.anthropic.apiKey)}`
          : config.provider === 'openai-compatible' && config.openai.apiKey
            ? ` key ${maskKey(config.openai.apiKey)}`
            : '';
      if (options.online) {
        const health = await provider.healthCheck(AbortSignal.timeout(20_000));
        checks.push({
          id: 'ai',
          label: `${provider.displayName} API`,
          status: health.ok ? 'ok' : 'fail',
          detail: health.ok ? `${health.message}${keyInfo}` : health.message,
        });
      } else {
        checks.push({
          id: 'ai',
          label: `${provider.displayName} API`,
          status: provider.capabilities.generative ? 'ok' : 'warn',
          detail: provider.capabilities.generative
            ? `configured, model ${provider.model}${keyInfo} (use --online to test the connection)`
            : 'mock provider — no AI, offline planner only',
        });
      }
    } catch (error) {
      const e = toUserError(error);
      checks.push({
        id: 'ai',
        label: 'AI provider',
        status: 'fail',
        detail: e.reason ?? e.message,
        ...(e.solution ? { solution: e.solution } : {}),
      });
    }
  }

  // Environment: .env must not be committed
  const envFile = path.join(cwd, '.env');
  if (existsSync(envFile)) {
    let tracked = false;
    if (git && (await app.git.isRepo(cwd))) {
      const result = await runCommand(['git', 'ls-files', '--error-unmatch', '.env'], {
        cwd,
        timeoutMs: 10_000,
      }).catch(() => null);
      tracked = result?.exitCode === 0;
    }
    checks.push({
      id: 'env',
      label: 'Environment',
      status: tracked ? 'fail' : 'ok',
      detail: tracked
        ? '.env is tracked by git — your keys could be published!'
        : '.env found (not tracked by git)',
      ...(tracked
        ? { solution: 'git rm --cached .env  and add .env to .gitignore, then rotate the keys.' }
        : {}),
    });
  } else {
    checks.push({
      id: 'env',
      label: 'Environment',
      status: 'ok',
      detail: 'using process environment (no .env in this folder)',
    });
  }

  // Permissions: config dir writable
  try {
    mkdirSync(app.configDir, { recursive: true });
    const probe = path.join(app.configDir, `.write-test-${process.pid}`);
    writeFileSync(probe, 'ok');
    rmSync(probe, { force: true });
    checks.push({
      id: 'workspace',
      label: 'Workspace',
      status: 'ok',
      detail: `config: ${app.configDir}`,
    });
  } catch (error) {
    checks.push({
      id: 'workspace',
      label: 'Workspace',
      status: 'fail',
      detail: `cannot write to ${app.configDir}: ${toUserError(error).reason ?? ''}`,
      solution: 'Check folder permissions or set GAMEFORGE_CONFIG_DIR.',
    });
  }

  // Plugins
  const failed = app.listPlugins().filter((p) => p.status === 'failed');
  checks.push({
    id: 'plugins',
    label: 'Plugins',
    status: failed.length ? 'warn' : 'ok',
    detail: failed.length
      ? `${failed.length} failed: ${failed.map((p) => `${p.id} (${p.error})`).join(', ')}`
      : `${app.listPlugins().filter((p) => p.status === 'active').length} active`,
  });

  return { checks, ready: !checks.some((c) => c.status === 'fail') };
}
