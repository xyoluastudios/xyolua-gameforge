import { readFileSync } from 'node:fs';
import path from 'node:path';
import { silentLogger, Workspace } from '@gameforge/core';
import { describe, expect, it } from 'vitest';
import { analyzeGodotProject } from '../src/analyzer.js';
import { parseProjectGodot } from '../src/project-file.js';
import { applyQuickFix } from '../src/quickfix.js';
import { tempDir, writeFiles } from '../../core/test/helpers.js';

/** A small Godot project with typical problems. */
function brokenProject(): string {
  const root = tempDir('gf-broken-');
  writeFiles(root, {
    'project.godot': `config_version=5

[application]

config/name="Broken Game"
run/main_scene="res://scenes/missing.tscn"
config/features=PackedStringArray("4.3", "Forward Plus")

[autoload]

Globals="*res://scripts/globals.gd"

[input]

move_left={
"deadzone": 0.2,
"events": []
}
`,
    'scenes/game.tscn': `[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://scripts/player.gd" id="1_p"]
[ext_resource type="Texture2D" path="res://assets/gone.png" id="2_t"]

[node name="Player" type="CharacterBody3D"]
script = ExtResource("1_p")

[node name="Head" type="Node3D" parent="."]

[node name="Button" type="Button" parent="."]

[connection signal="pressed" from="Button" to="." method="_on_button_pressed"]
`,
    'scripts/player.gd': [
      'extends KinematicBody',
      '',
      'onready var head = $Head',
      'onready var camera = $Head/Camera',
      'export(float) var speed = 5.0',
      'const Bullet = preload("res://scenes/bullet.tscn")',
      '',
      'func _physics_process(delta):',
      '\tif Input.is_action_pressed("jump"):',
      '\t\tvelocity.y = 5',
      '\tvar dir = Input.get_vector("move_left", "move_right", "ui_up", "ui_down")',
      '\tmove_and_slide(velocity, Vector3.UP)',
      '',
      'func spawn():',
      '\tvar b = Bullet.instance()',
      '\tyield(get_tree(), "idle_frame")',
      '\tadd_child(b)',
    ].join('\n'),
    'scripts/mixed.gd': 'extends Node\n\nfunc a():\n\tpass\n\nfunc b():\n    pass\n',
    'assets/unused.png': 'PNG',
  });
  return root;
}

describe('Godot analyzer', () => {
  it('finds critical problems, missing references and Godot 3 leftovers', async () => {
    const root = brokenProject();
    const report = await analyzeGodotProject(Workspace.open(root), { logger: silentLogger });
    const rules = report.issues.map((i) => i.ruleId);
    expect(rules).toEqual(
      expect.arrayContaining([
        'main-scene-missing',
        'autoload-missing',
        'scene-missing-resource',
        'missing-resource',
        'g3-kinematic',
        'g3-onready',
        'g3-export',
        'g3-move-and-slide',
        'g3-instance',
        'g3-yield',
        'undefined-input-action',
        'missing-node',
        'missing-signal-method',
        'mixed-indentation',
        'unused-asset',
        'no-tests',
        'no-readme',
      ]),
    );
    const undefinedActions = report.issues
      .filter((i) => i.ruleId === 'undefined-input-action')
      .map((i) => /"([^"]+)"/.exec(i.message)?.[1]);
    expect(undefinedActions.sort()).toEqual(['jump', 'move_right']);
    const missingNodes = report.issues.filter((i) => i.ruleId === 'missing-node');
    expect(missingNodes).toHaveLength(1);
    expect(missingNodes[0]!.message).toContain('Head/Camera');
    expect(report.issues.find((i) => i.ruleId === 'missing-resource')).toMatchObject({
      severity: 'critical',
      file: 'scripts/player.gd',
      line: 6,
    });
    expect(report.scores.codeQuality).toBeLessThan(60);
    expect(report.scores.testing).toBe(0);
    expect(report.stats).toMatchObject({ scripts: 2, scenes: 1, tests: 0 });
  });

  it('applies deterministic quick fixes that the analyzer then accepts', async () => {
    const root = brokenProject();
    const workspace = Workspace.open(root);
    workspace.beginChanges('staged');
    const before = await analyzeGodotProject(workspace, { logger: silentLogger });
    const fixable = before.issues.filter((i) => i.fix?.kind === 'auto');
    expect(fixable.map((i) => i.ruleId)).toEqual(
      expect.arrayContaining([
        'g3-kinematic',
        'g3-onready',
        'g3-export',
        'g3-instance',
        'g3-yield',
        'undefined-input-action',
        'mixed-indentation',
        'main-scene-missing',
      ]),
    );
    for (const issue of fixable) expect(await applyQuickFix(workspace, issue), issue.id).toBe(true);
    const after = await analyzeGodotProject(workspace, { logger: silentLogger });
    expect(after.issues.filter((i) => i.fix?.kind === 'auto')).toEqual([]);

    const player = await workspace.readText('scripts/player.gd');
    expect(player).toContain('extends CharacterBody3D');
    expect(player).toContain('@onready var head = $Head');
    expect(player).toContain('@export var speed = 5.0');
    expect(player).toContain('Bullet.instantiate()');
    expect(player).toContain('await get_tree().process_frame');
    expect(await workspace.readText('scripts/mixed.gd')).toBe(
      'extends Node\n\nfunc a():\n\tpass\n\nfunc b():\n\tpass\n',
    );
    const project = parseProjectGodot(await workspace.readText('project.godot'));
    expect(project.mainScene).toBe('res://scenes/game.tscn');
    expect(project.inputActions).toEqual(
      expect.arrayContaining(['move_left', 'jump', 'move_right']),
    );
    // Staged: the disk is unchanged until the user applies the changes.
    expect(readFileSync(path.join(root, 'scripts/player.gd'), 'utf8')).toContain(
      'extends KinematicBody',
    );
  });
});
