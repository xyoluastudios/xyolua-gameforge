import { existsSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findExecutable, runCommand, type EngineInstallation } from '@gameforge/core';

export interface GodotVersion {
  major: number;
  minor: number;
  patch: number;
  label: string;
}

export function parseGodotVersion(output: string): GodotVersion | null {
  const match = /(\d+)\.(\d+)(?:\.(\d+))?\.([a-z0-9_]+)/i.exec(output.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    label: match[0],
  };
}

export function isSupportedVersion(version: GodotVersion): boolean {
  return version.major === 4 && version.minor >= 3;
}

/** On Windows the *_console.exe sibling reliably forwards stdout/stderr. */
export function consoleVariant(executable: string): string {
  if (
    process.platform !== 'win32' ||
    !/\.exe$/i.test(executable) ||
    /_console\.exe$/i.test(executable)
  )
    return executable;
  const candidate = executable.replace(/\.exe$/i, '_console.exe');
  return existsSync(candidate) ? candidate : executable;
}

function wellKnownCandidates(): string[] {
  const home = os.homedir();
  const candidates: string[] = [];
  const scan = (dir: string, pattern: RegExp) => {
    try {
      for (const entry of readdirSync(dir)) {
        if (pattern.test(entry)) candidates.push(path.join(dir, entry));
      }
    } catch {
      // folder missing
    }
  };
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    for (const dir of [
      path.join(local, 'Programs', 'Godot'),
      'C:\\Program Files\\Godot',
      'C:\\Godot',
      path.join(home, 'Godot'),
    ]) {
      scan(dir, /^Godot.*\.exe$/i);
    }
    candidates.push(path.join(home, 'scoop', 'apps', 'godot', 'current', 'godot.exe'));
    candidates.push(
      'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Godot Engine\\godot.windows.opt.tools.64.exe',
    );
    const winget = path.join(local, 'Microsoft', 'WinGet', 'Packages');
    try {
      for (const entry of readdirSync(winget)) {
        if (/godot/i.test(entry)) scan(path.join(winget, entry), /^Godot.*\.exe$/i);
      }
    } catch {
      // no winget packages
    }
  } else if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Godot.app/Contents/MacOS/Godot',
      path.join(home, 'Applications/Godot.app/Contents/MacOS/Godot'),
    );
  } else {
    candidates.push(
      '/usr/bin/godot',
      '/usr/local/bin/godot',
      path.join(home, '.local/bin/godot'),
      '/snap/bin/godot-4',
    );
    scan(path.join(home, '.local', 'bin'), /^Godot_v4.*/);
  }
  return candidates;
}

export interface DetectOptions {
  /** Path from settings (highest priority). */
  configured?: string;
  env?: NodeJS.ProcessEnv;
}

/** Finds a Godot 4.3+ executable. Never installs anything. */
export async function detectGodot(options: DetectOptions = {}): Promise<EngineInstallation | null> {
  const env = options.env ?? process.env;
  const ordered: [string, string][] = [];
  if (options.configured) ordered.push([options.configured, 'settings']);
  if (env.GODOT_PATH) ordered.push([env.GODOT_PATH, 'GODOT_PATH']);
  for (const name of ['godot', 'godot4', 'Godot', 'godot-4']) {
    const found = findExecutable(name, env);
    if (found) ordered.push([found, 'PATH']);
  }
  for (const candidate of wellKnownCandidates()) ordered.push([candidate, 'well-known location']);

  const seen = new Set<string>();
  for (const [candidate, source] of ordered) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved.toLowerCase()) || !existsSync(resolved)) continue;
    seen.add(resolved.toLowerCase());
    try {
      const result = await runCommand([consoleVariant(resolved), '--version'], {
        cwd: os.tmpdir(),
        timeoutMs: 20_000,
      });
      const version = parseGodotVersion(`${result.stdout}\n${result.stderr}`);
      if (version && isSupportedVersion(version))
        return { executable: resolved, version: version.label, source };
    } catch {
      // Not runnable — try the next candidate.
    }
  }
  return null;
}
