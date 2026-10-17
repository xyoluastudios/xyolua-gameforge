import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { offlinePlan } from '@gameforge/core';
import type { AnalysisReport, FixPlan } from '@shared/api';
import { handleEvent } from '../src/actions';
import { commandForShortcut, fuzzyScore, shortcutOf } from '../src/commands';
import { AnalysisView } from '../src/components/AnalysisView';
import { CommandPalette } from '../src/components/CommandPalette';
import { ConfirmDialog } from '../src/components/Dialogs';
import { PlanView } from '../src/components/PlanView';
import { initialState, store } from '../src/store';
import { handlers, invoke } from './setup';

beforeEach(() => {
  store.set(initialState());
});

describe('command palette', () => {
  it('filters commands, navigates with the keyboard and runs the selection', async () => {
    store.set({
      project: { root: '/g', name: 'g', engine: 'Godot', isGit: true },
      dialogs: { ...store.get().dialogs, palette: { open: true, mode: 'commands' } },
    });
    render(<CommandPalette />);
    const input = screen.getByLabelText('Command');
    expect(document.activeElement).toBe(input);
    expect(screen.getByText('Create Game')).toBeTruthy();
    expect(screen.getByText('Open Project')).toBeTruthy();
    expect(screen.getByText('Run Game')).toBeTruthy();
    await userEvent.type(input, 'settings');
    const options = screen.getAllByRole('option');
    expect(options[0]!.textContent).toContain('Settings');
    await userEvent.keyboard('{Enter}');
    expect(store.get().dialogs.palette.open).toBe(false);
    expect(store.get().dialogs.settings.open).toBe(true);
  });

  it('hides project commands without a project and searches files with "/"', async () => {
    store.set({
      dialogs: { ...store.get().dialogs, palette: { open: true, mode: 'commands' } },
      tree: [
        {
          path: 'scripts',
          name: 'scripts',
          type: 'directory',
          children: [
            { path: 'scripts/player.gd', name: 'player.gd', type: 'file' },
            { path: 'scripts/icon.png', name: 'icon.png', type: 'file' },
          ],
        },
      ],
    });
    render(<CommandPalette />);
    expect(screen.queryByText('Run Game')).toBeNull();
    await userEvent.type(screen.getByLabelText('Command'), '/player');
    expect(screen.getByText('scripts/player.gd')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(store.get().dialogs.palette.open).toBe(false);
  });

  it('maps keyboard events to shortcuts', () => {
    expect(shortcutOf(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))).toBe('Ctrl+K');
    expect(shortcutOf(new KeyboardEvent('keydown', { key: 'F5', shiftKey: true }))).toBe(
      'Shift+F5',
    );
    expect(commandForShortcut('Ctrl+N')?.id).toBe('create-game');
    expect(commandForShortcut('F5')).toBeUndefined(); // no project → not available
    expect(fuzzyScore('rg', 'Run Game')).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'Run Game')).toBe(0);
  });
});

describe('plan review', () => {
  it('shows the plan and marks features without templates', () => {
    const plan = offlinePlan('Create a multiplayer horror game inside an abandoned hospital.');
    render(<PlanView plan={plan} />);
    expect(screen.getByText('Abandoned')).toBeTruthy();
    expect(screen.getByText(/Horror · Godot 3D/)).toBeTruthy();
    const multiplayer = screen.getByText('Multiplayer', { selector: 'li' });
    expect(multiplayer.textContent).toContain('AI');
    expect(screen.getByText('Keys and doors')).toBeTruthy();
  });
});

describe('confirmation dialog', () => {
  it('offers Allow once / Allow for project / Cancel and reports the decision', async () => {
    store.set({
      confirms: [
        {
          id: '0b9f8a3e-1111-4222-8333-944455556666',
          kind: 'command',
          title: 'Confirmation required',
          message:
            'Programmer wants to execute:\n\nnpm install\n\nThis program is not on the allowlist.',
          command: 'npm install',
          risk: 'high',
          requestedBy: 'Programmer',
          grantKey: 'cmd:npm install',
        },
      ],
    });
    render(<ConfirmDialog />);
    expect(screen.getByText('Confirmation required')).toBeTruthy();
    expect(screen.getByText('npm install')).toBeTruthy();
    expect(screen.getByText('Allow once')).toBeTruthy();
    expect(screen.getByText('Cancel')).toBeTruthy();
    fireEvent.click(screen.getByText('Allow for project'));
    expect(invoke).toHaveBeenCalledWith(
      'confirm:respond',
      '0b9f8a3e-1111-4222-8333-944455556666',
      'project',
    );
    expect(store.get().confirms).toEqual([]);
  });
});

describe('analysis view', () => {
  const report: AnalysisReport = {
    engine: 'godot',
    projectName: 'Broken Game',
    scores: { architecture: 82, codeQuality: 76, testing: 41, documentation: 35 },
    stats: { files: 10, scripts: 4, scenes: 2, assets: 3, linesOfCode: 300, tests: 1 },
    structure: { autoloads: [], scenes: [], scripts: [] },
    issues: [
      {
        id: 'g3-onready:a.gd:3',
        ruleId: 'g3-onready',
        severity: 'critical',
        category: 'compatibility',
        title: 'Godot 3 "onready" syntax',
        message: 'Use @onready.',
        file: 'a.gd',
        line: 3,
        fix: { kind: 'auto', description: 'x' },
      },
      {
        id: 'unused-asset:x.png:0',
        ruleId: 'unused-asset',
        severity: 'low',
        category: 'asset',
        title: 'Unused asset',
        message: 'x.png is unused',
        file: 'x.png',
      },
    ],
    engineValidated: false,
    generatedAt: new Date().toISOString(),
  };

  it('shows scores, issues and runs the fix workflow', async () => {
    store.set({
      analysis: report,
      project: { root: '/g', name: 'g', engine: 'Godot', isGit: false },
    });
    const plan: FixPlan = {
      items: [{ issue: report.issues[0]!, strategy: 'auto', description: 'Use @onready' }],
      aiAvailable: false,
    };
    handlers['analysis:fix-plan'] = () => plan;
    handlers['analysis:apply-fix-plan'] = () => ({
      autoFixed: ['g3-onready:a.gd:3'],
      resolved: ['g3-onready:a.gd:3'],
      remaining: 0,
      aiSummary: null,
      changes: [{ path: 'a.gd', kind: 'modify', additions: 1, deletions: 1, author: 'QuickFix' }],
    });
    render(<AnalysisView />);
    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('Issues found: 2')).toBeTruthy();
    expect(screen.getByText('Godot 3 "onready" syntax')).toBeTruthy();
    fireEvent.click(screen.getByTestId('fix-critical'));
    await waitFor(() => expect(screen.getByTestId('fix-plan').textContent).toContain('quick fix'));
    expect(invoke).toHaveBeenCalledWith('analysis:fix-plan', { severities: ['critical'] });
    fireEvent.click(screen.getByTestId('apply-fix-plan'));
    await waitFor(() => expect(screen.getByText(/Resolved 1 issue/)).toBeTruthy());
    expect(store.get().tabs.some((t) => t.kind === 'changes')).toBe(true);
  });
});

describe('agent event handling', () => {
  it('builds the conversation from streamed agent events', () => {
    act(() => {
      handleEvent({
        type: 'agent:start',
        runId: 'r1',
        agent: 'programmer',
        agentName: 'Programmer',
        task: 'Make the monster faster',
      });
      handleEvent({
        type: 'agent:text',
        runId: 'r1',
        agent: 'programmer',
        delta: 'Reading the enemy script.',
      });
      handleEvent({
        type: 'tool:start',
        runId: 'r1',
        agent: 'programmer',
        callId: 'c1',
        tool: 'read_file',
        input: { path: 'scripts/enemy.gd' },
      });
      handleEvent({
        type: 'tool:end',
        runId: 'r1',
        agent: 'programmer',
        callId: 'c1',
        tool: 'read_file',
        result: { tool: 'read_file', ok: true, output: '', durationMs: 1 },
      });
      handleEvent({
        type: 'agent:end',
        runId: 'r1',
        agent: 'programmer',
        status: 'done',
        summary: 'Done',
        usage: { inputTokens: 1, outputTokens: 1 },
      });
      handleEvent({
        type: 'pipeline:step',
        step: 'scaffold',
        label: 'Create project',
        agent: 'Programmer',
        status: 'running',
      });
      handleEvent({
        type: 'pipeline:step',
        step: 'scaffold',
        label: 'Create project',
        agent: 'Programmer',
        status: 'done',
        detail: '42 files',
      });
    });
    const chat = store.get().chat;
    const agent = chat.find((c) => c.kind === 'agent');
    expect(agent).toMatchObject({
      agentName: 'Programmer',
      status: 'done',
      tools: [{ tool: 'read_file', ok: true, detail: 'scripts/enemy.gd' }],
    });
    expect(agent && agent.kind === 'agent' ? agent.text : '').toContain(
      'Reading the enemy script.',
    );
    const steps = chat.filter((c) => c.kind === 'step');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toMatchObject({ status: 'done', detail: '42 files' });
    expect(store.get().agents.programmer).toBe('idle');
  });
});
