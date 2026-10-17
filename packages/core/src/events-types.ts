import type { AgentEvent } from './agents/runner.js';

export type PipelineStepId =
  'level' | 'scaffold' | 'assets' | 'audio' | 'git' | 'code' | 'validate' | 'tests';

export type PipelineStepStatus = 'running' | 'done' | 'skipped' | 'failed';

/** Everything the UI / CLI can observe while GameForge works. */
export type GameForgeEvent =
  | AgentEvent
  | {
      type: 'pipeline:step';
      step: PipelineStepId;
      label: string;
      agent: string;
      status: PipelineStepStatus;
      detail?: string;
    }
  | { type: 'pipeline:file'; path: string }
  | {
      type: 'output';
      source: 'tests' | 'game' | 'command' | 'validate';
      stream: 'stdout' | 'stderr';
      text: string;
    }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string };

export type GameForgeEventListener = (event: GameForgeEvent) => void;
