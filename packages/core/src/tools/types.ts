import type { z } from 'zod';
import type { UserFacingError } from '../errors.js';
import type { EngineAdapter } from '../engines/types.js';
import type { GitService } from '../git/git.js';
import type { Logger } from '../logger.js';
import type { PermissionManager } from '../permissions/permissions.js';
import type { Workspace } from '../workspace/workspace.js';

export interface ToolContext {
  /** Sandboxed workspace (agent policy). */
  workspace: Workspace;
  permissions: PermissionManager;
  git: GitService;
  engine: EngineAdapter | null;
  logger: Logger;
  /** Agent or client that called the tool. */
  actor: string;
  signal?: AbortSignal;
  commandTimeoutMs?: number;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}

export type ToolAccess = 'read' | 'write' | 'execute';

export interface ToolOutput {
  /** Text returned to the model. */
  output: string;
  /** Structured data for UIs. */
  data?: unknown;
}

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  access: ToolAccess;
  /**
   * Extra agent roles that get this tool in addition to their own tool list
   * ('all' = every agent). Mainly for plugin tools; built-ins are assigned in
   * the agent definitions.
   */
  agents?: 'all' | string[];
  /**
   * JSON schema shown to the model. Derived from `input` for zod schemas;
   * plugins without zod can provide it here (default: any object).
   */
  inputSchema?: { [key: string]: unknown };
  run(input: z.infer<S>, context: ToolContext): Promise<ToolOutput>;
}

export interface ToolResult {
  tool: string;
  ok: boolean;
  output: string;
  data?: unknown;
  error?: UserFacingError;
  durationMs: number;
}

/** Helper that keeps the input type inference when defining tools. */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): ToolDefinition<S> {
  return definition;
}
