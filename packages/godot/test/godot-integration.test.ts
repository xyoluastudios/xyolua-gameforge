import { offlinePlan, silentLogger, Workspace } from '@gameforge/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { detectGodot } from '../src/detect.js';
import { createGodotEngine } from '../src/plugin.js';
import { tempDir } from '../../core/test/helpers.js';

/**
 * Runs generated projects in a real Godot. Skipped when Godot is not
 * installed (set GODOT_PATH to enable). CI runs it with a downloaded Godot.
 */
const godot = await detectGodot();

describe.skipIf(!godot)(
  `generated projects in ${godot?.version ?? 'Godot (not installed)'}`,
  () => {
    const engine = createGodotEngine();
    beforeAll(() => {
      expect(godot).not.toBeNull();
    });

    it.each([
      [
        '3D horror',
        'A 3D horror game in an abandoned hospital with keys, doors, a flashlight and a monster.',
      ],
      [
        '2D dungeon',
        'A 2D top-down dungeon game with keys, doors, a slime enemy and a save system.',
      ],
    ])(
      '%s: validates and passes its own tests',
      async (_label, prompt) => {
        const root = tempDir('gf-godot-');
        await engine.generate(offlinePlan(prompt), Workspace.open(root, { policy: 'user' }), {
          logger: silentLogger,
        });

        const validation = await engine.validate(root, { logger: silentLogger });
        expect(validation.engineAvailable).toBe(true);
        expect(validation.errors, validation.output.slice(-4000)).toEqual([]);

        const tests = await engine.runTests(root, { logger: silentLogger });
        expect(tests.error).toBeUndefined();
        expect(tests.failed, tests.output).toBe(0);
        expect(tests.passed).toBe(tests.total);
        expect(tests.total).toBeGreaterThanOrEqual(14);
      },
      600_000,
    );

    it('reports parse errors with file and line', async () => {
      const root = tempDir('gf-godot-');
      await engine.generate(
        offlinePlan('A 2D dungeon with keys'),
        Workspace.open(root, { policy: 'user' }),
        { logger: silentLogger },
      );
      const ws = Workspace.open(root, { policy: 'user' });
      const player = await ws.readText('scripts/player/player.gd');
      await ws.writeText(
        'scripts/player/player.gd',
        player.replace(
          'var move_speed := 5.0',
          'var move_speed := 5.0\nvar broken := undefined_identifier',
        ),
      );
      const validation = await engine.validate(root, { logger: silentLogger });
      expect(validation.ok).toBe(false);
      expect(
        validation.errors.some((e) => e.file === 'scripts/player/player.gd' && e.line === 9),
      ).toBe(true);
    }, 600_000);
  },
);
