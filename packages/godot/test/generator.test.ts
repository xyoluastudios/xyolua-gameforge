import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { offlinePlan, silentLogger, Workspace, type GamePlan } from '@gameforge/core';
import { describe, expect, it } from 'vitest';
import { analyzeGodotProject } from '../src/analyzer.js';
import { generateLevel, validateLevel } from '../src/level-generator.js';
import { createGodotEngine } from '../src/plugin.js';
import { parseProjectGodot } from '../src/project-file.js';
import { parseTscn } from '../src/tscn.js';
import { tempDir } from '../../core/test/helpers.js';

const HORROR =
  'Erstelle ein 3D-Horrorspiel in einem verlassenen Krankenhaus. Der Spieler soll Schlüssel finden, Türen öffnen und von einem Monster verfolgt werden.';

describe('level generator', () => {
  it('always produces solvable levels', () => {
    const base = offlinePlan(HORROR);
    for (let rooms = 3; rooms <= 16; rooms++) {
      for (let keys = 0; keys <= 5; keys++) {
        const plan: GamePlan = { ...base, level: { ...base.level, rooms, keys } };
        for (const seed of [1, 42, 1337]) {
          const level = generateLevel(plan, { seed });
          const result = validateLevel(level);
          expect(result.problems, `rooms=${rooms} keys=${keys} seed=${seed}`).toEqual([]);
          expect(level.rooms).toHaveLength(rooms);
          expect(level.doors.length).toBe(level.keys.length);
        }
      }
    }
  });

  it('is deterministic and uses room names from the level brief', () => {
    const plan = offlinePlan(HORROR);
    const a = generateLevel(plan, {
      roomNames: ['Lobby', 'Ward'],
      roomNotes: ['Visiting hours are over.'],
    });
    const b = generateLevel(plan, {
      roomNames: ['Lobby', 'Ward'],
      roomNotes: ['Visiting hours are over.'],
    });
    expect(a.grid).toEqual(b.grid);
    expect(a.rooms[0]).toMatchObject({ name: 'Lobby', note: 'Visiting hours are over.' });
    expect(a.rooms[1]!.name).toBe('Ward');
    expect(a.rooms.at(-1)!.name).toBe('Exit');
    expect(a.rooms.find((r) => r.name === 'Pharmacy')).toBeDefined();
  });

  it('detects unsolvable layouts', () => {
    const level = generateLevel(offlinePlan(HORROR));
    const broken = { ...level, keys: [...level.keys].reverse() };
    if (level.keys.length > 1) expect(validateLevel(broken).ok).toBe(false);
    const blocked = {
      ...level,
      grid: level.grid.map((row, y) =>
        y === level.exit.y ? row.slice(0, level.exit.x) + '#' + row.slice(level.exit.x + 1) : row,
      ),
    };
    expect(validateLevel(blocked).problems).toContain('exit is a wall');
  });
});

describe.each([
  ['3D horror', HORROR, '3d'],
  [
    '2D dungeon',
    'A 2D top-down dungeon crawler with keys, doors and slimes. Save system please.',
    '2d',
  ],
] as const)('generated project: %s', (_label, prompt, dimension) => {
  it('contains a complete, internally consistent Godot project', async () => {
    const root = tempDir('gf-gen-');
    const plan = offlinePlan(prompt);
    expect(plan.dimension).toBe(dimension);
    const engine = createGodotEngine();
    const phases: string[] = [];
    const result = await engine.generate(plan, Workspace.open(root, { policy: 'user' }), {
      logger: silentLogger,
      onPhase: (phase, status) => phases.push(`${phase}:${status}`),
    });
    expect(phases).toEqual([
      'scaffold:running',
      'scaffold:done',
      'assets:running',
      'assets:done',
      'audio:running',
      'audio:done',
    ]);
    for (const file of [
      'project.godot',
      'scenes/main.tscn',
      'scenes/player.tscn',
      'scenes/enemy.tscn',
      'ui/main_menu.tscn',
      'scripts/autoload/game_state.gd',
      'tests/run_tests.gd',
      'data/game_config.json',
      'data/levels/level_01.json',
      'audio/sound_events.json',
      'assets/manifest.json',
      'audio/ambience/ambience.wav',
      'assets/textures/wall.png',
      'README.md',
      '.gameforge/plan.json',
    ]) {
      expect(existsSync(path.join(root, file)), file).toBe(true);
    }
    expect(result.files.length).toBeGreaterThan(40);

    const project = parseProjectGodot(readFileSync(path.join(root, 'project.godot'), 'utf8'));
    expect(project.mainScene).toBe('res://ui/main_menu.tscn');
    expect(Object.keys(project.autoloads)).toEqual([
      'GameState',
      'AudioManager',
      'SaveSystem',
      'GameForgeBridge',
    ]);
    expect(project.inputActions).toEqual(
      expect.arrayContaining(['move_forward', 'interact', 'pause']),
    );

    const main = parseTscn(readFileSync(path.join(root, 'scenes/main.tscn'), 'utf8'));
    expect(main.nodes[0]!.type).toBe(dimension === '3d' ? 'Node3D' : 'Node2D');
    for (const ext of main.extResources)
      expect(existsSync(path.join(root, ext.path.replace('res://', ''))), ext.path).toBe(true);

    const config = JSON.parse(readFileSync(path.join(root, 'data/game_config.json'), 'utf8')) as {
      features: string[];
      dimension: string;
    };
    expect(config.dimension).toBe(dimension);
    expect(config.features).toEqual(plan.features.map((f) => f.id));

    const wav = readFileSync(path.join(root, 'audio/sfx/pickup.wav'));
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    const png = readFileSync(path.join(root, 'assets/textures/wall.png'));
    expect(png.subarray(1, 4).toString()).toBe('PNG');

    // GDScript must use tabs only (Godot rejects mixed indentation).
    const player = readFileSync(path.join(root, 'scripts/player/player.gd'), 'utf8');
    expect(player.split('\n').some((l) => /^ {2,}\S/.test(l))).toBe(false);

    // Our own analyzer must not find real problems in generated projects.
    const report = await analyzeGodotProject(Workspace.open(root), { logger: silentLogger });
    const serious = report.issues.filter(
      (i) => i.severity === 'critical' || i.severity === 'high' || i.severity === 'medium',
    );
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);
    expect(report.scores.testing).toBeGreaterThan(50);
    expect(report.stats.tests).toBe(4);
  });
});
