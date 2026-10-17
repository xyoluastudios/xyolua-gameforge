import { describe, expect, it } from 'vitest';
import {
  defaultBindingFor,
  encodeInputAction,
  parseProjectGodot,
  setProjectValue,
  writeProjectGodot,
} from '../src/project-file.js';
import { parseGodotErrors, parseTestOutput } from '../src/runner.js';
import { gd, parseTscn, writeTscn } from '../src/tscn.js';
import { parseGodotVersion, isSupportedVersion } from '../src/detect.js';

describe('tscn', () => {
  it('writes scenes that parse back to the same structure', () => {
    const text = writeTscn({
      extResources: [{ type: 'Script', path: 'res://scripts/player.gd', id: '1_script' }],
      subResources: [
        { type: 'CapsuleShape3D', id: 'Capsule_1', properties: { radius: 0.35, height: 1.8 } },
      ],
      nodes: [
        { name: 'Player', type: 'CharacterBody3D', properties: { script: gd.ext('1_script') } },
        {
          name: 'Shape',
          type: 'CollisionShape3D',
          parent: '.',
          properties: { shape: gd.sub('Capsule_1'), transform: gd.translate3d(0, 0.9, 0) },
        },
        { name: 'Head', type: 'Node3D', parent: '.' },
        {
          name: 'Camera3D',
          type: 'Camera3D',
          parent: 'Head',
          properties: { current: true, fov: 75 },
        },
      ],
      connections: [{ signal: 'ready', from: '.', to: '.', method: '_on_ready' }],
    });
    expect(text).toContain('[gd_scene load_steps=3 format=3]');
    expect(text).toContain('[node name="Camera3D" type="Camera3D" parent="Head"]');
    const scene = parseTscn(text);
    expect(scene.nodes.map((n) => n.path)).toEqual(['.', 'Shape', 'Head', 'Head/Camera3D']);
    expect(scene.nodes[0]!.script).toBe('res://scripts/player.gd');
    expect(scene.subResources[0]!.properties.radius).toBe('0.35');
    expect(scene.connections[0]).toMatchObject({ signal: 'ready', method: '_on_ready' });
  });

  it('parses multi-line values and unique names from editor-saved scenes', () => {
    const scene = parseTscn(`[gd_scene load_steps=2 format=3 uid="uid://abc"]

[ext_resource type="Script" uid="uid://x" path="res://ui/menu.gd" id="1_a"]

[node name="Menu" type="Control"]
script = ExtResource("1_a")
metadata/_edit = {
"key": [1, 2,
3]
}

[node name="Play" type="Button" parent="."]
unique_name_in_owner = true
text = "Play \\"now\\""

[connection signal="pressed" from="Play" to="." method="_on_play_pressed"]
`);
    expect(scene.nodes[0]!.properties['metadata/_edit']).toContain('3]');
    expect(scene.nodes[1]).toMatchObject({ name: 'Play', uniqueName: true, path: 'Play' });
    expect(scene.connections[0]!.from).toBe('Play');
  });
});

describe('project.godot', () => {
  const text = writeProjectGodot({
    name: 'Abandoned',
    description: 'A horror game',
    mainScene: 'res://ui/main_menu.tscn',
    icon: 'res://icon.svg',
    autoloads: [['GameState', 'res://scripts/autoload/game_state.gd']],
    inputs: [{ name: 'interact', keys: [69] }],
    dimension: '3d',
    minVersion: '4.3',
  });

  it('writes and parses the project file', () => {
    const info = parseProjectGodot(text);
    expect(info).toMatchObject({
      name: 'Abandoned',
      mainScene: 'res://ui/main_menu.tscn',
      configVersion: 5,
      features: ['4.3', 'Forward Plus'],
      autoloads: { GameState: 'res://scripts/autoload/game_state.gd' },
      inputActions: ['interact'],
      renderer: 'forward_plus',
    });
  });

  it('edits values without touching the rest of the file', () => {
    const withJump = setProjectValue(
      text,
      'input',
      'jump',
      encodeInputAction(defaultBindingFor('jump')),
    );
    expect(parseProjectGodot(withJump).inputActions).toEqual(['interact', 'jump']);
    expect(withJump).toContain('"physical_keycode":32');
    const moved = setProjectValue(
      withJump,
      'application',
      'run/main_scene',
      '"res://scenes/main.tscn"',
    );
    expect(parseProjectGodot(moved).mainScene).toBe('res://scenes/main.tscn');
    expect(parseProjectGodot(moved).inputActions).toEqual(['interact', 'jump']);
    const replacedAction = setProjectValue(
      moved,
      'input',
      'interact',
      encodeInputAction({ name: 'interact', keys: [70] }),
    );
    expect(replacedAction.match(/^interact=/gm)).toHaveLength(1);
    expect(parseProjectGodot(replacedAction).inputActions).toEqual(['interact', 'jump']);
    const added = setProjectValue(text, 'physics', 'common/physics_ticks_per_second', '120');
    expect(added).toContain('[physics]\n\ncommon/physics_ticks_per_second=120');
  });

  it('picks sensible default bindings', () => {
    expect(defaultBindingFor('move_left').keys).toContain(65);
    expect(defaultBindingFor('shoot').mouseButtons).toEqual([1]);
    expect(defaultBindingFor('do_the_thing').keys).toEqual([]);
  });
});

describe('Godot output parsing', () => {
  it('extracts script errors with file and line', () => {
    const errors = parseGodotErrors(`Godot Engine v4.7.2.stable.official
SCRIPT ERROR: Parse Error: Identifier "speeed" not declared in the current scope.
          at: GDScript::reload (res://scripts/player/player.gd:42)
ERROR: Failed to load script "res://scripts/player/player.gd" with error "Parse error".
   at: load (modules/gdscript/gdscript.cpp:2936)
WARNING: 2 ObjectDB instances were leaked at exit (run with \`--verbose\` for details).
ERROR: 1 resources still in use at exit (run with --verbose for details).
`);
    expect(errors).toEqual([
      {
        file: 'scripts/player/player.gd',
        line: 42,
        message: 'Parse Error: Identifier "speeed" not declared in the current scope.',
      },
      {
        file: 'scripts/player/player.gd',
        message: 'Failed to load script "res://scripts/player/player.gd" with error "Parse error".',
      },
    ]);
  });

  it('parses the GFTEST protocol', () => {
    const parsed = parseTestOutput(`GFTEST|PASS|test_a.gd|test_one
GFTEST|FAIL|test_a.gd|test_two|expected <1> but got <2>
GFTEST|SKIP|test_b.gd|test_three|no autoloads
GFTEST|SUMMARY|3|1|1|1`);
    expect(parsed).toMatchObject({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
      summaryFound: true,
    });
    expect(parsed.results[1]).toMatchObject({
      name: 'test_a.gd::test_two',
      status: 'failed',
      message: 'expected <1> but got <2>',
    });
  });

  it('parses and checks Godot versions', () => {
    expect(parseGodotVersion('4.7.2.stable.official.ed1daf0bf')).toMatchObject({
      major: 4,
      minor: 7,
      patch: 2,
    });
    expect(isSupportedVersion(parseGodotVersion('4.2.1.stable')!)).toBe(false);
    expect(isSupportedVersion(parseGodotVersion('3.5.3.stable')!)).toBe(false);
    expect(parseGodotVersion('not godot')).toBeNull();
  });
});
