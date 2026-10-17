/**
 * Secret protection helpers.
 *
 * - `redactSecrets` scrubs well-known credential formats from any text before
 *   it is logged or sent to an AI provider (tool output, command output, ...).
 * - `sanitizeEnv` builds the environment for child processes so that API keys
 *   and tokens of the user never leak into AI-triggered commands.
 */

const REDACTED = '[REDACTED]';

const SECRET_PATTERNS: RegExp[] = [
  // Anthropic / OpenAI style keys
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g,
  /\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/g,
  // GitHub tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  // AWS access key ids
  /\bAKIA[0-9A-Z]{16}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  // Slack tokens
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // Bearer tokens in headers
  /\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi,
  // PEM private keys
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

/** `KEY=value` / `"key": "value"` assignments whose name looks sensitive. */
const ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE_KEY)[A-Za-z0-9_]*)(\s*[=:]\s*["']?)([^\s"']{6,})/gi;

export function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, prefix: unknown) =>
      typeof prefix === 'string' && /^Bearer\s+$/i.test(prefix) ? `${prefix}${REDACTED}` : REDACTED,
    );
  }
  result = result.replace(ASSIGNMENT_PATTERN, (_m, name: string, sep: string) => {
    return `${name}${sep}${REDACTED}`;
  });
  return result;
}

/** Name tokens (split at "_") that mark a variable as a credential. */
// prettier-ignore
const SENSITIVE_TOKENS = new Set([
  'KEY', 'APIKEY', 'TOKEN', 'SECRET', 'PASSWORD', 'PASSWD', 'PASS', 'PWD_HASH',
  'CREDENTIAL', 'CREDENTIALS', 'AUTH', 'COOKIE', 'PRIVATE',
]);

/** Environment variables that child processes always need. */
const ALWAYS_KEEP = new Set(
  [
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'SYSTEMDRIVE',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'TMPDIR',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'PROGRAMDATA',
    'PROGRAMFILES',
    'PROGRAMFILES(X86)',
    'LANG',
    'LC_ALL',
    'TERM',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'XDG_RUNTIME_DIR',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'SHELL',
    'USER',
    'USERNAME',
    'LOGNAME',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'OS',
  ].map((k) => k.toUpperCase()),
);

export function isSensitiveEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  if (ALWAYS_KEEP.has(upper)) return false;
  return upper
    .split(/[^A-Z0-9]+/)
    .some((token) => SENSITIVE_TOKENS.has(token) || /(APIKEY|TOKEN|SECRET|PASSWORD)$/.test(token));
}

/**
 * Returns a copy of `env` without credentials. Used for every process spawned
 * on behalf of an agent (and for the game itself).
 */
export function sanitizeEnv(
  env: NodeJS.ProcessEnv,
  extra: Record<string, string> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (isSensitiveEnvKey(key)) continue;
    result[key] = value;
  }
  return { ...result, ...extra };
}

/** Masks a key for display: `sk-ant-…a1b2`. */
export function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
