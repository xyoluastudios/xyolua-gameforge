import { randomUUID } from 'node:crypto';
import { GameForgeError, toUserError, type UserFacingError } from '../errors.js';
import type { AIProvider, ChatMessage, ChatResponse } from '../providers/types.js';
import { ToolRegistry } from '../tools/registry.js';
import type { ToolContext, ToolDefinition, ToolResult } from '../tools/types.js';
import type { AgentDefinition } from './definitions.js';

export type AgentStatus = 'done' | 'failed' | 'cancelled' | 'max_steps' | 'refused';

export type AgentEvent =
  | {
      type: 'agent:start';
      runId: string;
      parentRunId?: string;
      agent: string;
      agentName: string;
      task: string;
    }
  | { type: 'agent:text'; runId: string; agent: string; delta: string }
  | { type: 'agent:message'; runId: string; agent: string; text: string }
  | {
      type: 'tool:start';
      runId: string;
      agent: string;
      callId: string;
      tool: string;
      input: unknown;
    }
  | {
      type: 'tool:end';
      runId: string;
      agent: string;
      callId: string;
      tool: string;
      result: ToolResult;
    }
  | {
      type: 'agent:end';
      runId: string;
      agent: string;
      status: AgentStatus;
      summary: string;
      error?: UserFacingError;
      usage: { inputTokens: number; outputTokens: number };
    };

export interface AgentRunOptions {
  agent: AgentDefinition;
  task: string;
  provider: AIProvider;
  /** Global tool registry; the agent only sees its allowed subset. */
  tools: ToolRegistry;
  /** Additional run-specific tools (e.g. `delegate`). */
  extraTools?: ToolDefinition[];
  toolContext: Omit<ToolContext, 'actor'>;
  /** Appended to the agent's system prompt (engine guide, project facts). */
  extraSystem?: string;
  /** Previous conversation (for chat continuity). */
  history?: ChatMessage[];
  maxSteps?: number;
  parentRunId?: string;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  runId: string;
  status: AgentStatus;
  summary: string;
  messages: ChatMessage[];
  toolCalls: number;
  usage: { inputTokens: number; outputTokens: number };
  error?: UserFacingError;
}

/**
 * Runs one agent on one task: a provider-neutral tool-use loop.
 * The model proposes tool calls, the registry validates and executes them
 * (with permissions), results go back to the model until it is done.
 */
export async function runAgent(options: AgentRunOptions): Promise<AgentRunResult> {
  const runId = randomUUID();
  const { agent, provider } = options;
  const emit = (event: AgentEvent) => {
    try {
      options.onEvent?.(event);
    } catch {
      // UI listeners must not break the loop
    }
  };

  // Per-run registry with only the allowed tools.
  const registry = new ToolRegistry();
  for (const tool of options.tools.list(agent.tools)) registry.register(tool);
  // Tools (usually from plugins) that opt into this role.
  for (const tool of options.tools.list()) {
    const wanted =
      tool.agents === 'all' || (Array.isArray(tool.agents) && tool.agents.includes(agent.id));
    if (wanted && !registry.has(tool.name)) registry.register(tool);
  }
  for (const tool of options.extraTools ?? [])
    if (!registry.has(tool.name)) registry.register(tool);
  const specs = provider.capabilities.tools ? registry.specs() : [];

  const system = [agent.systemPrompt, options.extraSystem].filter(Boolean).join('\n\n');
  const messages: ChatMessage[] = [
    ...(options.history ?? []),
    { role: 'user', content: options.task },
  ];
  const usage = { inputTokens: 0, outputTokens: 0 };
  let toolCalls = 0;
  let lastText = '';

  emit({
    type: 'agent:start',
    runId,
    agent: agent.id,
    agentName: agent.name,
    task: options.task,
    ...(options.parentRunId ? { parentRunId: options.parentRunId } : {}),
  });

  const finish = (
    status: AgentStatus,
    summary: string,
    error?: UserFacingError,
  ): AgentRunResult => {
    emit({
      type: 'agent:end',
      runId,
      agent: agent.id,
      status,
      summary,
      usage,
      ...(error ? { error } : {}),
    });
    return { runId, status, summary, messages, toolCalls, usage, ...(error ? { error } : {}) };
  };

  const maxSteps = options.maxSteps ?? agent.maxSteps;
  try {
    for (let step = 0; step < maxSteps; step++) {
      if (options.signal?.aborted) return finish('cancelled', 'Cancelled by the user.');
      const response: ChatResponse = await provider.chat({
        system,
        messages,
        ...(specs.length ? { tools: specs } : {}),
        purpose: 'agent',
        ...(options.signal ? { signal: options.signal } : {}),
        onText: (delta) => emit({ type: 'agent:text', runId, agent: agent.id, delta }),
      });
      usage.inputTokens += response.usage?.inputTokens ?? 0;
      usage.outputTokens += response.usage?.outputTokens ?? 0;

      if (response.stopReason === 'refusal') {
        // A refused turn may contain a cut-off tool call — never run it.
        return finish('refused', 'The AI model declined this request.', {
          code: 'PROVIDER_REQUEST_FAILED',
          message: 'The AI model declined this request.',
          solution: 'Rephrase the request or try a different model.',
        });
      }

      messages.push({
        role: 'assistant',
        content: response.text,
        ...(response.toolCalls.length ? { toolCalls: response.toolCalls } : {}),
        ...(response.providerData === undefined ? {} : { providerData: response.providerData }),
      });
      if (response.text.trim()) {
        lastText = response.text.trim();
        emit({ type: 'agent:message', runId, agent: agent.id, text: lastText });
      }

      if (response.toolCalls.length === 0) {
        if (response.stopReason === 'max_tokens') {
          messages.push({
            role: 'user',
            content: 'Your answer was cut off. Continue where you stopped.',
          });
          continue;
        }
        return finish('done', lastText || 'Done.');
      }

      const truncated = response.stopReason === 'max_tokens';
      for (const call of response.toolCalls) {
        if (options.signal?.aborted) {
          messages.push({
            role: 'tool',
            toolCallId: call.id,
            name: call.name,
            content: 'Cancelled.',
            isError: true,
          });
          continue;
        }
        toolCalls++;
        emit({
          type: 'tool:start',
          runId,
          agent: agent.id,
          callId: call.id,
          tool: call.name,
          input: call.input,
        });
        let result: ToolResult;
        if (truncated) {
          // Never execute a tool call whose input may have been cut off.
          result = {
            tool: call.name,
            ok: false,
            output:
              'Your output hit the token limit, so this tool call was not executed. Split the work into smaller steps (e.g. smaller files or edit_file).',
            durationMs: 0,
          };
        } else {
          result = await registry.execute(call.name, call.input, {
            ...options.toolContext,
            actor: agent.name,
          });
        }
        emit({
          type: 'tool:end',
          runId,
          agent: agent.id,
          callId: call.id,
          tool: call.name,
          result,
        });
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: result.output || (result.ok ? 'OK' : 'Failed'),
          ...(result.ok ? {} : { isError: true }),
        });
      }
    }
    return finish('max_steps', lastText || `Stopped after ${maxSteps} steps without finishing.`);
  } catch (error) {
    const userError = toUserError(error);
    if (userError.code === 'CANCELLED') return finish('cancelled', 'Cancelled.');
    options.toolContext.logger.error(`Agent ${agent.id} failed`, error);
    return finish('failed', userError.message, userError);
  }
}

/** Throws a GameForgeError when an agent run did not succeed. */
export function assertAgentSucceeded(result: AgentRunResult): void {
  if (result.status === 'done') return;
  if (result.error)
    throw new GameForgeError(result.error.code, result.error.message, {
      ...(result.error.reason ? { reason: result.error.reason } : {}),
      ...(result.error.solution ? { solution: result.error.solution } : {}),
    });
  throw new GameForgeError('INTERNAL', `Agent stopped: ${result.status}`, {
    reason: result.summary,
  });
}
