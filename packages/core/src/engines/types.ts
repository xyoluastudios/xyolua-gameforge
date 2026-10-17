import type { UserFacingError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { PermissionManager } from '../permissions/permissions.js';
import type { GamePlan } from '../plan/game-plan.js';
import type { Workspace } from '../workspace/workspace.js';

/**
 * Engine adapters connect GameForge to a game engine. V1 ships the Godot
 * adapter (`@gameforge/godot`); Unity, Unreal, Roblox, ... can be added as
 * plugins implementing this interface.
 */

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

export type IssueCategory =
  | 'bug'
  | 'reference'
  | 'compatibility'
  | 'quality'
  | 'performance'
  | 'asset'
  | 'testing'
  | 'documentation'
  | 'architecture';

export interface ProjectIssue {
  /** Stable id: rule + location. */
  id: string;
  ruleId: string;
  severity: IssueSeverity;
  category: IssueCategory;
  title: string;
  message: string;
  file?: string;
  line?: number;
  /** `auto` = deterministic quick fix exists, `ai` = needs the Programmer agent. */
  fix?: { kind: 'auto' | 'ai'; description: string };
}

export interface AnalysisScores {
  architecture: number;
  codeQuality: number;
  testing: number;
  documentation: number;
}

export interface AnalysisReport {
  engine: string;
  projectName: string;
  engineVersion?: string;
  scores: AnalysisScores;
  stats: {
    files: number;
    scripts: number;
    scenes: number;
    assets: number;
    linesOfCode: number;
    tests: number;
  };
  structure: {
    mainScene?: string;
    autoloads: string[];
    scenes: string[];
    scripts: string[];
  };
  issues: ProjectIssue[];
  /** Whether the engine itself was used to validate scripts (e.g. Godot headless). */
  engineValidated: boolean;
  generatedAt: string;
}

export interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  file?: string;
}

export interface TestRunReport {
  runner: string;
  ok: boolean;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  results: TestResult[];
  output: string;
  durationMs: number;
  error?: UserFacingError;
}

export interface EngineInstallation {
  executable: string;
  version: string;
  /** How it was found: settings, env, PATH, well-known location. */
  source: string;
}

export interface RunningGame {
  readonly pid: number | undefined;
  readonly command: string;
  onOutput(listener: (stream: 'stdout' | 'stderr', text: string) => void): () => void;
  onExit(listener: (code: number | null) => void): () => void;
  stop(): void;
}

export interface GenerateOptions {
  /** Level brief from the Level Designer (optional overrides). */
  levelBrief?: LevelBrief;
  logger?: Logger;
  signal?: AbortSignal;
  /** Called after every generated file. */
  onFile?: (path: string) => void;
  /** Called when a generation phase starts / finishes. */
  onPhase?: (
    phase: 'scaffold' | 'assets' | 'audio',
    status: 'running' | 'done',
    files: string[],
  ) => void;
}

/** Optional, engine-agnostic level brief written by the Level Designer agent. */
export interface LevelBrief {
  /** Thematic room names, e.g. ["Reception", "Ward A", "Morgue"]. */
  roomNames?: string[];
  /** Short signs / notes placed in rooms. */
  roomNotes?: string[];
  /** Deterministic layout seed. */
  seed?: number;
}

export interface GenerateResult {
  files: string[];
  /** Features that were not covered by templates and need the Programmer agent. */
  customFeatures: string[];
  mainScene: string;
}

export interface ValidationResult {
  ok: boolean;
  engineAvailable: boolean;
  errors: { file?: string; line?: number; message: string }[];
  output: string;
}

export interface EngineContext {
  logger: Logger;
  permissions?: PermissionManager;
  signal?: AbortSignal;
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void;
}

export interface EngineAdapter {
  readonly id: string;
  readonly displayName: string;
  /** Extra system-prompt guidance for agents working on this engine. */
  readonly agentGuide: string;
  isProject(root: string): Promise<boolean>;
  detectInstallation(): Promise<EngineInstallation | null>;
  generate(
    plan: GamePlan,
    workspace: Workspace,
    options?: GenerateOptions,
  ): Promise<GenerateResult>;
  analyze(workspace: Workspace, context: EngineContext): Promise<AnalysisReport>;
  /** Applies a deterministic fix through the workspace (recorded as a change). */
  quickFix(workspace: Workspace, issue: ProjectIssue): Promise<boolean>;
  validate(root: string, context: EngineContext): Promise<ValidationResult>;
  runTests(root: string, context: EngineContext): Promise<TestRunReport>;
  runGame(root: string, options: { mode: 'play' | 'debug' } & EngineContext): Promise<RunningGame>;
}
