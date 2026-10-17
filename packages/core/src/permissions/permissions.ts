import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GameForgeError } from '../errors.js';
import type { Logger } from '../logger.js';
import { silentLogger } from '../logger.js';
import { formatCommand, programName } from '../process/command.js';

export type ConfirmationDecision = 'once' | 'project' | 'deny';

export interface ConfirmationRequest {
  id: string;
  kind: 'command' | 'delete' | 'run-game' | 'other';
  title: string;
  message: string;
  /** Exact command line, if any. */
  command?: string;
  risk: 'low' | 'medium' | 'high';
  /** Who asked (agent id or "mcp"). */
  requestedBy: string;
  /** Key under which "Allow for project" is remembered. */
  grantKey: string;
}

/** Asks the human. Desktop shows a dialog, CLI prompts, MCP denies. */
export type ConfirmationHandler = (request: ConfirmationRequest) => Promise<ConfirmationDecision>;

export const denyAll: ConfirmationHandler = async () => 'deny';

/**
 * Remembers "Allow for project" decisions.
 *
 * Stored in the user's config directory — never inside the project — so a
 * downloaded project can't pre-approve its own commands.
 */
export class GrantStore {
  private data: Record<string, { root: string; grants: string[] }> = {};

  constructor(private readonly file: string | null) {
    if (file && existsSync(file)) {
      try {
        this.data = JSON.parse(readFileSync(file, 'utf8')) as typeof this.data;
      } catch {
        this.data = {};
      }
    }
  }

  private key(root: string): string {
    return createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 24);
  }

  has(root: string, grant: string): boolean {
    return this.data[this.key(root)]?.grants.includes(grant) ?? false;
  }

  list(root: string): string[] {
    return [...(this.data[this.key(root)]?.grants ?? [])];
  }

  add(root: string, grant: string): void {
    const k = this.key(root);
    const entry = (this.data[k] ??= { root: path.resolve(root), grants: [] });
    if (!entry.grants.includes(grant)) entry.grants.push(grant);
    this.save();
  }

  revokeAll(root: string): void {
    delete this.data[this.key(root)];
    this.save();
  }

  private save(): void {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
}

/** Programs agents may never run, no matter what the user clicks. */
// prettier-ignore
const BLOCKED_PROGRAMS = new Set([
  // shells & interpreters of shell scripts (would bypass all checks)
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'cmd', 'powershell', 'pwsh', 'wsl',
  // destructive / system
  'rm', 'rmdir', 'del', 'erase', 'rd', 'format', 'mkfs', 'dd', 'diskpart', 'fdisk', 'parted',
  'shutdown', 'reboot', 'halt', 'poweroff', 'reg', 'regedit', 'bcdedit', 'sc', 'schtasks',
  'crontab', 'launchctl', 'systemctl', 'service', 'kill', 'pkill', 'killall', 'taskkill',
  'sudo', 'su', 'doas', 'runas', 'chmod', 'chown', 'chgrp', 'takeown', 'icacls', 'cacls',
  'setx', 'netsh', 'mount', 'umount',
  // network transfer / remote access
  'curl', 'wget', 'ssh', 'scp', 'sftp', 'ftp', 'nc', 'ncat', 'netcat', 'telnet', 'rsync',
  // windows LOLBins
  'certutil', 'bitsadmin', 'mshta', 'rundll32', 'regsvr32', 'wscript', 'cscript', 'msiexec',
  // indirection
  'env', 'xargs', 'nohup', 'start', 'open', 'xdg-open', 'eval', 'exec', 'osascript',
]);

/** Git subcommands agents may run without asking (read-only). */
const GIT_READ_ONLY = new Set([
  'status',
  'diff',
  'log',
  'show',
  'branch',
  'rev-parse',
  'ls-files',
  'blame',
]);
/** Git subcommands that are never available to agents. */
const GIT_BLOCKED = new Set([
  'push',
  'remote',
  'config',
  'credential',
  'filter-branch',
  'gc',
  'clean',
  'reset',
]);

export type CommandVerdict =
  | { action: 'allow' }
  | { action: 'confirm'; grantKey: string; risk: ConfirmationRequest['risk']; reason: string }
  | { action: 'block'; reason: string };

export interface CommandPolicyOptions {
  /** Absolute paths of executables that count as "godot". */
  godotExecutables?: string[];
  /** Workspace root — absolute path arguments must stay inside it. */
  root: string;
}

function looksAbsolute(arg: string): boolean {
  return path.isAbsolute(arg) || /^[A-Za-z]:[\\/]/.test(arg);
}

/** Pure policy decision for an argv. */
export function evaluateCommand(argv: string[], options: CommandPolicyOptions): CommandVerdict {
  const [program, ...args] = argv;
  if (!program) return { action: 'block', reason: 'Empty command.' };
  const name = programName(program);
  const isGodot =
    /^godot/.test(name) ||
    (options.godotExecutables ?? []).some(
      (g) => path.resolve(g).toLowerCase() === path.resolve(program).toLowerCase(),
    );

  if (BLOCKED_PROGRAMS.has(name)) {
    return {
      action: 'block',
      reason: `"${name}" is on the blocklist (destructive, shell or network tool).`,
    };
  }

  // Absolute paths must point into the project (the program itself excluded).
  for (const arg of args) {
    const value = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : arg;
    if (looksAbsolute(value)) {
      const rel = path.relative(options.root, path.resolve(value));
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return { action: 'block', reason: `Argument points outside the project: ${value}` };
      }
    }
    if (/(^|[\\/])\.\.([\\/]|$)/.test(value)) {
      return { action: 'block', reason: `Argument escapes the project folder: ${value}` };
    }
  }

  if (name === 'git') {
    const sub = args.find((a) => !a.startsWith('-')) ?? '';
    if (GIT_BLOCKED.has(sub))
      return { action: 'block', reason: `"git ${sub}" is not available to agents.` };
    if (GIT_READ_ONLY.has(sub)) return { action: 'allow' };
    return {
      action: 'confirm',
      grantKey: `git ${sub}`,
      risk: 'medium',
      reason: `Runs "git ${sub}".`,
    };
  }

  if (isGodot) {
    // Running Godot executes project scripts (AI-generated code).
    return {
      action: 'confirm',
      grantKey: 'godot',
      risk: 'medium',
      reason: 'Runs Godot, which executes the project scripts on your machine.',
    };
  }

  const sub = args.find((a) => !a.startsWith('-'));
  return {
    action: 'confirm',
    grantKey: sub ? `${name} ${sub}` : name,
    risk: 'high',
    reason: 'This program is not on the allowlist.',
  };
}

export interface PermissionManagerOptions {
  root: string;
  grants: GrantStore;
  confirm: ConfirmationHandler;
  godotExecutables?: () => string[];
  logger?: Logger;
}

/** Central gate for every risky action an agent wants to perform. */
export class PermissionManager {
  private readonly logger: Logger;

  constructor(private readonly options: PermissionManagerOptions) {
    this.logger = options.logger ?? silentLogger;
  }

  get root(): string {
    return this.options.root;
  }

  async authorizeCommand(argv: string[], requestedBy: string): Promise<void> {
    const command = formatCommand(argv);
    const verdict = evaluateCommand(argv, {
      root: this.options.root,
      godotExecutables: this.options.godotExecutables?.() ?? [],
    });
    if (verdict.action === 'allow') return;
    if (verdict.action === 'block') {
      this.logger.warn(`Blocked command from ${requestedBy}: ${command}`, verdict.reason);
      throw new GameForgeError('COMMAND_BLOCKED', `Command blocked: ${command}`, {
        reason: verdict.reason,
        solution:
          'Agents can only run safe, project-local commands. Run it yourself if you really need it.',
      });
    }
    await this.confirm({
      kind: 'command',
      title: 'Confirmation required',
      message: `${requestedBy} wants to execute:\n\n${command}\n\n${verdict.reason}`,
      command,
      risk: verdict.risk,
      requestedBy,
      grantKey: `cmd:${verdict.grantKey}`,
    });
  }

  async authorizeDelete(relPath: string, requestedBy: string): Promise<void> {
    await this.confirm({
      kind: 'delete',
      title: 'Confirmation required',
      message: `${requestedBy} wants to delete:\n\n${relPath}`,
      risk: 'medium',
      requestedBy,
      grantKey: `delete:${relPath}`,
    });
  }

  /** Generic confirmation with grant memory. Throws `PERMISSION_DENIED` on cancel. */
  async confirm(request: Omit<ConfirmationRequest, 'id'>): Promise<void> {
    if (this.options.grants.has(this.options.root, request.grantKey)) return;
    const decision = await this.options.confirm({ ...request, id: randomUUID() });
    this.logger.info(`Confirmation "${request.grantKey}" → ${decision}`);
    if (decision === 'project') this.options.grants.add(this.options.root, request.grantKey);
    if (decision === 'deny') {
      throw new GameForgeError('PERMISSION_DENIED', 'The action was not allowed.', {
        reason: `You declined: ${request.command ?? request.grantKey}`,
      });
    }
  }
}
