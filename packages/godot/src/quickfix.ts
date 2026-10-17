import type { ProjectIssue, Workspace } from '@gameforge/core';
import {
  defaultBindingFor,
  encodeInputAction,
  parseProjectGodot,
  setProjectValue,
} from './project-file.js';
import { encodeString } from './tscn.js';

/**
 * Deterministic fixes for issues where the correct change is unambiguous.
 * All edits go through the workspace, so they are staged for review.
 */

const AUTHOR = 'QuickFix';

async function editLine(
  workspace: Workspace,
  file: string,
  line: number,
  transform: (text: string) => string,
): Promise<boolean> {
  const text = await workspace.readText(file);
  const lines = text.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length) return false;
  const updated = transform(lines[index]!);
  if (updated === lines[index]) return false;
  lines[index] = updated;
  await workspace.writeText(file, lines.join('\n'), AUTHOR);
  return true;
}

export async function applyQuickFix(workspace: Workspace, issue: ProjectIssue): Promise<boolean> {
  const file = issue.file;
  switch (issue.ruleId) {
    case 'g3-onready':
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) =>
          l.replace(/^(\s*)onready\s+var\b/, '$1@onready var'),
        )
      );
    case 'g3-export':
      // export(int) var x → @export var x (Godot 4 infers the type from the value or annotation).
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) =>
          l.replace(/^(\s*)export(\s*\([^)]*\))?\s+var\b/, '$1@export var'),
        )
      );
    case 'g3-tool':
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) => l.replace(/^(\s*)tool\s*$/, '$1@tool'))
      );
    case 'g3-instance':
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) =>
          l.replace(/\.instance\(\s*\)/g, '.instantiate()'),
        )
      );
    case 'g3-kinematic':
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) =>
          l
            .replace(/\bKinematicBody2D\b/g, 'CharacterBody2D')
            .replace(/\bKinematicBody\b/g, 'CharacterBody3D'),
        )
      );
    case 'g3-spatial':
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) =>
          l.replace(/^extends\s+Spatial\b/, 'extends Node3D'),
        )
      );
    case 'g3-yield':
      return (
        !!file &&
        !!issue.line &&
        editLine(workspace, file, issue.line, (l) =>
          l
            .replace(
              /yield\(\s*get_tree\(\)\s*,\s*"idle_frame"\s*\)/g,
              'await get_tree().process_frame',
            )
            .replace(
              /yield\(\s*get_tree\(\)\s*,\s*"physics_frame"\s*\)/g,
              'await get_tree().physics_frame',
            )
            .replace(
              /yield\(\s*get_tree\(\)\.create_timer\(([^)]*)\)\s*,\s*"timeout"\s*\)/g,
              'await get_tree().create_timer($1).timeout',
            )
            .replace(/yield\(\s*([\w.$]+)\s*,\s*"(\w+)"\s*\)/g, 'await $1.$2'),
        )
      );
    case 'mixed-indentation': {
      if (!file) return false;
      const text = await workspace.readText(file);
      const sample = text.split('\n').find((l) => /^ {2,}\S/.test(l));
      const width = sample && /^ {4}/.test(sample) ? 4 : 2;
      const fixed = text
        .split('\n')
        .map((line) => {
          const match = /^([ \t]+)/.exec(line);
          if (!match) return line;
          const columns = [...match[1]!].reduce((sum, ch) => sum + (ch === '\t' ? width : 1), 0);
          return (
            '\t'.repeat(Math.floor(columns / width)) +
            ' '.repeat(columns % width) +
            line.slice(match[1]!.length)
          );
        })
        .join('\n');
      if (fixed === text) return false;
      await workspace.writeText(file, fixed, AUTHOR);
      return true;
    }
    case 'undefined-input-action': {
      const action = /"([^"]+)"/.exec(issue.message)?.[1];
      if (!action) return false;
      const text = await workspace.readText('project.godot');
      if (parseProjectGodot(text).inputActions.includes(action)) return true;
      await workspace.writeText(
        'project.godot',
        setProjectValue(text, 'input', action, encodeInputAction(defaultBindingFor(action))),
        AUTHOR,
      );
      return true;
    }
    case 'main-scene-missing': {
      const scenes = (await workspace.files(['.tscn'])).filter((f) => !f.startsWith('addons/'));
      const preferred =
        scenes.find((f) => /(^|\/)(main_menu|menu|title)\.tscn$/i.test(f)) ??
        scenes.find((f) => /(^|\/)(main|game|world|level)\.tscn$/i.test(f)) ??
        scenes[0];
      if (!preferred) return false;
      const text = await workspace.readText('project.godot');
      await workspace.writeText(
        'project.godot',
        setProjectValue(text, 'application', 'run/main_scene', encodeString(`res://${preferred}`)),
        AUTHOR,
      );
      return true;
    }
    default:
      return false;
  }
}
