import { realpathSync } from 'node:fs';
import path from 'node:path';
import { GameForgeError } from '../errors.js';

/** Normalizes a path to forward slashes for display and matching. */
export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

const ENV_ALLOWED = new Set(['.env.example', '.env.sample', '.env.template', '.env.dist']);
const KEY_FILE = /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/i;
const SECRET_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx', '.keystore', '.jks', '.ppk']);
const SECRET_NAMES = new Set([
  'export_credentials.cfg', // Godot 4 stores export passwords here
  '.npmrc',
  '.pypirc',
  '.netrc',
  'credentials.json',
  'secrets.json',
]);

/** Directories agents may read but never write. */
const READ_ONLY_DIRS = new Set(['.git', '.godot', '.import', '.gameforge', 'node_modules']);
/** Directories that are completely off limits. */
const BLOCKED_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.azure', '.kube', '.docker']);

export type ProtectionReason = 'secret' | 'read-only';

/**
 * Returns why a workspace-relative path is protected, or `null` if agents may
 * access it. `relPath` must already be normalized and inside the workspace.
 */
export function protectionFor(relPath: string, forWrite: boolean): ProtectionReason | null {
  const segments = toPosix(relPath)
    .split('/')
    .filter((s) => s !== '' && s !== '.');
  for (const segment of segments) {
    const lower = segment.toLowerCase();
    if (BLOCKED_DIRS.has(lower)) return 'secret';
    if ((lower === '.env' || lower.startsWith('.env.')) && !ENV_ALLOWED.has(lower)) return 'secret';
  }
  const base = (segments[segments.length - 1] ?? '').toLowerCase();
  if (KEY_FILE.test(base)) return 'secret';
  if (SECRET_NAMES.has(base)) return 'secret';
  if (SECRET_EXTENSIONS.has(path.extname(base))) return 'secret';
  if (forWrite && segments.length > 0 && READ_ONLY_DIRS.has(segments[0]!.toLowerCase())) {
    return 'read-only';
  }
  return null;
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Resolves symlinks of the deepest existing ancestor of `target`. */
function realpathOfExistingAncestor(target: string): string {
  let current = target;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = realpathSync.native(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return target;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/**
 * Resolves `input` (relative to `root`, or absolute) to an absolute path and
 * guarantees it stays inside `root` — also after following symlinks.
 */
export function resolveInside(root: string, input: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new GameForgeError('INVALID_INPUT', 'A file path is required.');
  }
  if (input.includes('\0')) {
    throw new GameForgeError('INVALID_INPUT', 'File paths must not contain NUL bytes.');
  }
  // Godot-style res:// paths map to the project root.
  const cleaned = input.startsWith('res://') ? input.slice('res://'.length) : input;
  const absolute = path.resolve(root, cleaned);
  const outside = () =>
    new GameForgeError('PATH_OUTSIDE_WORKSPACE', `Access outside the project is not allowed.`, {
      reason: `"${input}" resolves to a location outside the open project.`,
      solution:
        'Agents can only work inside the project folder. Use a path relative to the project.',
      details: { input },
    });
  if (!isInside(root, absolute)) throw outside();
  const real = realpathOfExistingAncestor(absolute);
  if (!isInside(root, real)) throw outside();
  return absolute;
}
