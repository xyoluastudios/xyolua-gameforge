import path from 'node:path';
import type {
  AnalysisReport,
  EngineContext,
  IssueSeverity,
  ProjectIssue,
  Workspace,
} from '@gameforge/core';
import { parseProjectGodot, type ProjectInfo } from './project-file.js';
import { parseTscn, type ParsedScene } from './tscn.js';

/**
 * Static analyzer for Godot 4 projects. Pure text analysis — it never runs
 * project code, so it is safe on untrusted projects. Engine validation
 * (actually loading scripts in Godot) is a separate, explicit step.
 */

const ASSET_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.wav',
  '.ogg',
  '.mp3',
  '.glb',
  '.gltf',
  '.obj',
  '.fbx',
  '.ttf',
  '.otf',
  '.tres',
  '.res',
]);
const TEXT_EXTENSIONS = new Set([
  '.gd',
  '.tscn',
  '.tres',
  '.godot',
  '.json',
  '.cfg',
  '.gdshader',
  '.md',
  '.txt',
]);
const BUILTIN_ACTION = /^ui_/;

export interface ScriptInfo {
  path: string;
  text: string;
  lines: string[];
  className?: string;
  extends?: string;
  functions: { name: string; line: number; length: number }[];
  codeLines: number;
  commentLines: number;
  hasDocComment: boolean;
}

export function scanScript(file: string, text: string): ScriptInfo {
  const lines = text.split(/\r?\n/);
  const functions: ScriptInfo['functions'] = [];
  let codeLines = 0;
  let commentLines = 0;
  let current: { name: string; line: number } | null = null;
  let lastCode = 0;
  const close = (end: number) => {
    if (current) functions.push({ ...current, length: end - current.line + 1 });
    current = null;
  };
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '') return;
    if (trimmed.startsWith('#')) {
      commentLines++;
      return;
    }
    codeLines++;
    const fn = /^(?:static\s+)?func\s+([A-Za-z_]\w*)/.exec(line);
    if (fn) {
      close(lastCode);
      current = { name: fn[1]!, line: index + 1 };
    } else if (current && /^\S/.test(line)) {
      close(lastCode);
    }
    lastCode = index + 1;
  });
  close(lastCode);
  const className = /^class_name\s+([A-Za-z_]\w*)/m.exec(text)?.[1];
  const extendsMatch = /^extends\s+(.+)$/m.exec(text)?.[1]?.trim();
  const firstCode = lines.findIndex(
    (l) =>
      l.trim() !== '' && !l.trim().startsWith('#') && !/^(extends|class_name|@tool)/.test(l.trim()),
  );
  const header = lines.slice(0, firstCode === -1 ? lines.length : firstCode);
  return {
    path: file,
    text,
    lines,
    ...(className ? { className } : {}),
    ...(extendsMatch ? { extends: extendsMatch } : {}),
    functions,
    codeLines,
    commentLines,
    hasDocComment: header.some((l) => l.trim().startsWith('##')),
  };
}

interface Godot3Rule {
  id: string;
  pattern: RegExp;
  severity: IssueSeverity;
  title: string;
  message: string;
  autofix: boolean;
}

/** Godot 3 syntax that breaks in Godot 4. */
export const GODOT3_RULES: Godot3Rule[] = [
  {
    id: 'g3-onready',
    pattern: /^\s*onready\s+var\b/,
    severity: 'critical',
    title: 'Godot 3 "onready" syntax',
    message: 'Use the @onready annotation in Godot 4.',
    autofix: true,
  },
  {
    id: 'g3-export',
    pattern: /^\s*export(\s*\([^)]*\))?\s+var\b/,
    severity: 'critical',
    title: 'Godot 3 "export" syntax',
    message: 'Use the @export annotation in Godot 4.',
    autofix: true,
  },
  {
    id: 'g3-tool',
    pattern: /^\s*tool\s*$/,
    severity: 'critical',
    title: 'Godot 3 "tool" keyword',
    message: 'Use the @tool annotation in Godot 4.',
    autofix: true,
  },
  {
    id: 'g3-setget',
    pattern: /\bsetget\b/,
    severity: 'critical',
    title: 'Godot 3 "setget"',
    message: 'Godot 4 uses property syntax: var x: set = _set_x, get = _get_x.',
    autofix: false,
  },
  {
    id: 'g3-yield',
    pattern: /\byield\s*\(/,
    severity: 'critical',
    title: 'Godot 3 "yield"',
    message: 'Godot 4 uses await (e.g. await get_tree().process_frame).',
    autofix: true,
  },
  {
    id: 'g3-instance',
    pattern: /\.instance\(\s*\)/,
    severity: 'high',
    title: 'PackedScene.instance() was renamed',
    message: 'Use instantiate() in Godot 4.',
    autofix: true,
  },
  {
    id: 'g3-kinematic',
    pattern: /\bKinematicBody(2D)?\b/,
    severity: 'critical',
    title: 'KinematicBody no longer exists',
    message: 'Use CharacterBody3D / CharacterBody2D in Godot 4.',
    autofix: true,
  },
  {
    id: 'g3-spatial',
    pattern: /^extends\s+Spatial\b/,
    severity: 'critical',
    title: 'Spatial was renamed',
    message: 'Use Node3D in Godot 4.',
    autofix: true,
  },
  {
    id: 'g3-move-and-slide',
    pattern: /\bmove_and_slide\s*\(\s*[^)\s]/,
    severity: 'critical',
    title: 'Godot 3 move_and_slide() call',
    message:
      'In Godot 4 move_and_slide() takes no arguments; set velocity first. This crashes at runtime.',
    autofix: false,
  },
  {
    id: 'g3-connect',
    pattern: /\bconnect\(\s*"[^"]+"\s*,\s*self\s*,/,
    severity: 'high',
    title: 'Godot 3 connect() signature',
    message: 'Use signal.connect(callable) in Godot 4, e.g. button.pressed.connect(_on_pressed).',
    autofix: false,
  },
];

export function makeIssue(issue: Omit<ProjectIssue, 'id'>): ProjectIssue {
  return { id: `${issue.ruleId}:${issue.file ?? ''}:${issue.line ?? 0}`, ...issue };
}

function resPath(file: string): string {
  return `res://${file}`;
}

function fromRes(p: string): string {
  return p.replace(/^res:\/\//, '');
}

interface Context {
  files: Set<string>;
  scripts: ScriptInfo[];
  scenes: Map<string, ParsedScene>;
  project: ProjectInfo | null;
  texts: Map<string, string>;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function checkScripts(ctx: Context, issues: ProjectIssue[]): void {
  const definedActions = new Set(ctx.project?.inputActions ?? []);
  for (const script of ctx.scripts) {
    for (const match of script.text.matchAll(/InputMap\.add_action\(\s*["']([^"']+)["']/g))
      definedActions.add(match[1]!);
  }
  for (const script of ctx.scripts) {
    const { lines, path: file, text } = script;
    // Indentation
    const tabs = lines.some((l) => /^\t+\S/.test(l));
    const spaces = lines.some((l) => /^ {2,}\S/.test(l) && !/^\s*#/.test(l));
    if (tabs && spaces) {
      issues.push(
        makeIssue({
          ruleId: 'mixed-indentation',
          severity: 'critical',
          category: 'bug',
          title: 'Mixed tabs and spaces',
          message: 'Godot refuses to parse scripts that mix tab and space indentation.',
          file,
          line: lines.findIndex((l) => /^ {2,}\S/.test(l)) + 1,
          fix: { kind: 'auto', description: 'Convert indentation to tabs' },
        }),
      );
    }
    // Godot 3 syntax
    lines.forEach((line, index) => {
      if (line.trim().startsWith('#')) return;
      for (const rule of GODOT3_RULES) {
        if (rule.pattern.test(line)) {
          issues.push(
            makeIssue({
              ruleId: rule.id,
              severity: rule.severity,
              category: 'compatibility',
              title: rule.title,
              message: rule.message,
              file,
              line: index + 1,
              fix: rule.autofix
                ? { kind: 'auto', description: rule.message }
                : { kind: 'ai', description: rule.message },
            }),
          );
        }
      }
    });
    // Missing resources in preload/load
    for (const match of text.matchAll(/\b(preload|load)\(\s*"(res:\/\/[^"]+)"\s*\)/g)) {
      const target = fromRes(match[2]!);
      if (!ctx.files.has(target)) {
        issues.push(
          makeIssue({
            ruleId: 'missing-resource',
            severity: match[1] === 'preload' ? 'critical' : 'high',
            category: 'reference',
            title: 'Missing reference',
            message: `${match[1]}("${match[2]}") points to a file that does not exist.${match[1] === 'preload' ? ' The script will not compile.' : ''}`,
            file,
            line: lineOf(text, match.index ?? 0),
            fix: { kind: 'ai', description: 'Fix the path or restore the missing file' },
          }),
        );
      }
    }
    // Undefined input actions
    for (const match of text.matchAll(
      /\b(?:is_action_pressed|is_action_just_pressed|is_action_just_released|is_action_released|get_action_strength|is_action)\(\s*"([^"]+)"/g,
    )) {
      checkAction(match[1]!, match.index ?? 0);
    }
    for (const match of text.matchAll(/\bget_(?:vector|axis)\(([^)]*)\)/g)) {
      for (const name of match[1]!.matchAll(/"([^"]+)"/g)) checkAction(name[1]!, match.index ?? 0);
    }
    function checkAction(action: string, index: number): void {
      if (BUILTIN_ACTION.test(action) || definedActions.has(action)) return;
      const line = lineOf(text, index);
      if (
        issues.some(
          (i) =>
            i.ruleId === 'undefined-input-action' &&
            i.file === file &&
            i.message.includes(`"${action}"`),
        )
      )
        return;
      issues.push(
        makeIssue({
          ruleId: 'undefined-input-action',
          severity: 'high',
          category: 'bug',
          title: 'Undefined input action',
          message: `The input action "${action}" is not defined in project.godot. Godot reports an error every time it is checked and the control does nothing.`,
          file,
          line,
          fix: {
            kind: 'auto',
            description: `Add "${action}" to the Input Map with a sensible default key`,
          },
        }),
      );
    }
    // Long functions / large scripts
    for (const fn of script.functions) {
      if (fn.length > 80) {
        issues.push(
          makeIssue({
            ruleId: 'long-function',
            severity: 'low',
            category: 'quality',
            title: 'Very long function',
            message: `${fn.name}() has ${fn.length} lines. Split it into smaller functions.`,
            file,
            line: fn.line,
            fix: { kind: 'ai', description: 'Refactor into smaller functions' },
          }),
        );
      }
    }
    if (script.codeLines > 500) {
      issues.push(
        makeIssue({
          ruleId: 'large-script',
          severity: 'low',
          category: 'architecture',
          title: 'Large script',
          message: `${script.codeLines} lines of code. Consider splitting responsibilities.`,
          file,
          line: 1,
        }),
      );
    }
    // get_node in hot paths
    for (const fn of script.functions.filter(
      (f) => f.name === '_process' || f.name === '_physics_process',
    )) {
      const body = lines.slice(fn.line, fn.line - 1 + fn.length).join('\n');
      if (/\bget_node\(|\$[A-Za-z"]/.test(body)) {
        issues.push(
          makeIssue({
            ruleId: 'node-lookup-in-process',
            severity: 'low',
            category: 'performance',
            title: 'Node lookup every frame',
            message: `${fn.name}() looks up nodes every frame. Cache them in @onready variables.`,
            file,
            line: fn.line,
            fix: { kind: 'ai', description: 'Cache node references with @onready' },
          }),
        );
      }
    }
    const todos = lines.filter((l) => /#.*\b(TODO|FIXME|HACK)\b/.test(l)).length;
    if (todos > 0) {
      issues.push(
        makeIssue({
          ruleId: 'todo',
          severity: 'info',
          category: 'quality',
          title: `${todos} TODO/FIXME comment(s)`,
          message: 'Open work is marked in this script.',
          file,
          line: lines.findIndex((l) => /#.*\b(TODO|FIXME|HACK)\b/.test(l)) + 1,
        }),
      );
    }
  }
}

function checkScenes(ctx: Context, issues: ProjectIssue[]): void {
  const scriptByPath = new Map(ctx.scripts.map((s) => [s.path, s]));
  for (const [file, scene] of ctx.scenes) {
    for (const ext of scene.extResources) {
      if (ext.path.startsWith('res://') && !ctx.files.has(fromRes(ext.path))) {
        issues.push(
          makeIssue({
            ruleId: 'scene-missing-resource',
            severity: 'critical',
            category: 'reference',
            title: 'Missing reference',
            message: `The scene references ${ext.path} (${ext.type}), which does not exist. The scene will fail to load.`,
            file,
            line: ext.line,
            fix: { kind: 'ai', description: 'Fix the resource path or restore the file' },
          }),
        );
      }
    }
    const root = scene.nodes[0];
    const rootScript = root?.script ? scriptByPath.get(fromRes(root.script)) : undefined;
    if (!rootScript) continue;
    const nodePaths = new Set(scene.nodes.map((n) => n.path));
    const uniqueNames = new Set(scene.nodes.filter((n) => n.uniqueName).map((n) => n.name));
    const instancedPaths = scene.nodes.filter((n) => n.instance).map((n) => n.path);
    // $Path / get_node("Path") from the root script must exist in the scene.
    for (const match of rootScript.text.matchAll(
      /(?:\$("?)([A-Za-z_%][\w/%]*)\1|get_node\(\s*"([^"]+)"\s*\))/g,
    )) {
      const nodePath = (match[2] ?? match[3] ?? '').trim();
      if (
        !nodePath ||
        nodePath.startsWith('/') ||
        nodePath.startsWith('.') ||
        nodePath.includes('..')
      )
        continue;
      if (nodePath.startsWith('%')) {
        if (!uniqueNames.has(nodePath.slice(1).split('/')[0]!)) {
          issues.push(
            makeIssue({
              ruleId: 'missing-node',
              severity: 'high',
              category: 'reference',
              title: 'Missing node reference',
              message: `${rootScript.path} uses %${nodePath.slice(1)}, but no node in ${file} has that unique name. This crashes at runtime.`,
              file: rootScript.path,
              line: lineOf(rootScript.text, match.index ?? 0),
              fix: { kind: 'ai', description: 'Fix the node reference or add the node' },
            }),
          );
        }
        continue;
      }
      // Nodes inside instanced sub-scenes can't be verified statically.
      if (nodePaths.has(nodePath) || instancedPaths.some((p) => nodePath.startsWith(`${p}/`)))
        continue;
      const created = new RegExp(`\\.name\\s*=\\s*"${nodePath.split('/')[0]}"`).test(
        rootScript.text,
      );
      if (created) continue;
      issues.push(
        makeIssue({
          ruleId: 'missing-node',
          severity: 'high',
          category: 'reference',
          title: 'Missing node reference',
          message: `${rootScript.path} accesses "${nodePath}", but ${file} has no such node. This crashes at runtime.`,
          file: rootScript.path,
          line: lineOf(rootScript.text, match.index ?? 0),
          fix: { kind: 'ai', description: 'Fix the node path or add the node to the scene' },
        }),
      );
    }
    // Signal connections must target existing methods.
    for (const connection of scene.connections) {
      if (connection.to !== '.') continue;
      if (!new RegExp(`^func\\s+${connection.method}\\s*\\(`, 'm').test(rootScript.text)) {
        issues.push(
          makeIssue({
            ruleId: 'missing-signal-method',
            severity: 'high',
            category: 'bug',
            title: 'Signal connected to a missing method',
            message: `"${connection.signal}" from ${connection.from} is connected to ${connection.method}(), which does not exist in ${rootScript.path}.`,
            file,
            line: connection.line,
            fix: { kind: 'ai', description: `Add ${connection.method}() or fix the connection` },
          }),
        );
      }
    }
  }
}

function checkProject(ctx: Context, issues: ProjectIssue[]): void {
  const project = ctx.project;
  if (!project) {
    issues.push(
      makeIssue({
        ruleId: 'no-project-file',
        severity: 'critical',
        category: 'architecture',
        title: 'project.godot missing',
        message: 'This is not a Godot project.',
        file: 'project.godot',
      }),
    );
    return;
  }
  if (project.configVersion && project.configVersion < 5) {
    issues.push(
      makeIssue({
        ruleId: 'godot3-project',
        severity: 'critical',
        category: 'compatibility',
        title: 'Godot 3 project file',
        message: `config_version=${project.configVersion} belongs to Godot 3. Open and convert the project with Godot 4 (Project → Tools → Upgrade).`,
        file: 'project.godot',
        line: 1,
      }),
    );
  }
  if (!project.mainScene) {
    issues.push(
      makeIssue({
        ruleId: 'main-scene-missing',
        severity: 'critical',
        category: 'architecture',
        title: 'No main scene',
        message: 'run/main_scene is not set, so the game cannot start.',
        file: 'project.godot',
        fix: { kind: 'auto', description: 'Set the main scene' },
      }),
    );
  } else if (!ctx.files.has(fromRes(project.mainScene))) {
    issues.push(
      makeIssue({
        ruleId: 'main-scene-missing',
        severity: 'critical',
        category: 'reference',
        title: 'Main scene not found',
        message: `run/main_scene points to ${project.mainScene}, which does not exist.`,
        file: 'project.godot',
        fix: { kind: 'auto', description: 'Point the main scene to an existing scene' },
      }),
    );
  }
  for (const [name, target] of Object.entries(project.autoloads)) {
    if (target.startsWith('res://') && !ctx.files.has(fromRes(target))) {
      issues.push(
        makeIssue({
          ruleId: 'autoload-missing',
          severity: 'critical',
          category: 'reference',
          title: 'Autoload not found',
          message: `Autoload "${name}" points to ${target}, which does not exist.`,
          file: 'project.godot',
          fix: { kind: 'ai', description: 'Restore the autoload script or remove the entry' },
        }),
      );
    }
  }
}

function checkUsage(ctx: Context, issues: ProjectIssue[]): void {
  const corpus = [...ctx.texts.entries()]
    .filter(([file]) => !file.endsWith('.import'))
    .map(([, text]) => text)
    .join('\n');
  for (const file of ctx.files) {
    const ext = path.extname(file).toLowerCase();
    if (file.startsWith('addons/') || file === 'icon.svg' || file.endsWith('.import')) continue;
    if (ASSET_EXTENSIONS.has(ext) && ext !== '.tres' && ext !== '.res') {
      if (!corpus.includes(resPath(file)) && !corpus.includes(path.basename(file))) {
        issues.push(
          makeIssue({
            ruleId: 'unused-asset',
            severity: 'low',
            category: 'asset',
            title: 'Unused asset',
            message: `${file} is not referenced by any scene, script or resource.`,
            file,
          }),
        );
      }
    }
  }
  for (const script of ctx.scripts) {
    if (script.path.startsWith('addons/') || script.path.startsWith('tests/') || script.className)
      continue;
    if (!corpus.includes(resPath(script.path))) {
      issues.push(
        makeIssue({
          ruleId: 'unused-script',
          severity: 'low',
          category: 'quality',
          title: 'Unused script',
          message: `${script.path} is not used by any scene, autoload or other script.`,
          file: script.path,
        }),
      );
    }
  }
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const WEIGHT: Record<IssueSeverity, number> = { critical: 12, high: 6, medium: 3, low: 1, info: 0 };

export function computeScores(ctx: Context, issues: ProjectIssue[], testFiles: number) {
  const scripts = ctx.scripts.filter((s) => !s.path.startsWith('addons/'));
  const scriptCount = Math.max(1, scripts.length);
  // Code quality: weighted issues relative to project size.
  const qualityPenalty = issues
    .filter((i) =>
      ['bug', 'compatibility', 'quality', 'performance', 'reference'].includes(i.category),
    )
    .reduce((sum, i) => sum + WEIGHT[i.severity], 0);
  const codeQuality = 100 * Math.exp(-qualityPenalty / (25 + 3 * scriptCount));
  // Architecture: folder structure, script size, references, coupling.
  const organized = scripts.filter((s) => s.path.includes('/')).length / scriptCount;
  const avgLength = scripts.reduce((sum, s) => sum + s.codeLines, 0) / scriptCount;
  const brokenRefs = issues.filter(
    (i) => i.category === 'reference' || i.ruleId === 'main-scene-missing',
  ).length;
  const coupling = scripts.reduce(
    (sum, s) =>
      sum +
      (s.text.match(
        /get_node\("\.\.\/\.\.|get_tree\(\)\.root\.get_node|get_parent\(\)\.get_parent\(\)/g,
      )?.length ?? 0),
    0,
  );
  const architecture =
    100 -
    (1 - organized) * 25 -
    Math.max(0, avgLength - 150) / 10 -
    brokenRefs * 6 -
    Math.min(20, coupling * 2) -
    (ctx.project?.mainScene ? 0 : 10);
  // Testing: test files relative to scripts, plus a runner.
  const testing = testFiles === 0 ? 0 : 35 + 65 * Math.min(1, (testFiles * 3) / scriptCount);
  // Documentation: README, comment density, documented scripts.
  const hasReadme = [...ctx.files].some((f) => /^readme(\.md)?$/i.test(f));
  const code = scripts.reduce((sum, s) => sum + s.codeLines, 0) || 1;
  const comments = scripts.reduce((sum, s) => sum + s.commentLines, 0);
  const documented = scripts.filter((s) => s.hasDocComment).length / scriptCount;
  const documentation =
    (hasReadme ? 30 : 0) + 40 * Math.min(1, comments / code / 0.12) + 30 * documented;
  return {
    architecture: clamp(architecture),
    codeQuality: clamp(codeQuality),
    testing: clamp(testing),
    documentation: clamp(documentation),
  };
}

export async function analyzeGodotProject(
  workspace: Workspace,
  context: EngineContext,
): Promise<AnalysisReport> {
  const all = await workspace.files();
  const files = new Set(all);
  const texts = new Map<string, string>();
  for (const file of all) {
    if (!TEXT_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    try {
      texts.set(file, await workspace.readText(file));
    } catch {
      // unreadable / too large — skip
    }
  }
  const projectText = texts.get('project.godot');
  const project = projectText ? parseProjectGodot(projectText) : null;
  const scripts = [...texts.entries()]
    .filter(([f]) => f.endsWith('.gd'))
    .map(([f, t]) => scanScript(f, t));
  const scenes = new Map<string, ParsedScene>();
  for (const [file, text] of texts) if (file.endsWith('.tscn')) scenes.set(file, parseTscn(text));
  const ctx: Context = { files, scripts, scenes, project, texts };
  const issues: ProjectIssue[] = [];
  checkProject(ctx, issues);
  checkScripts(ctx, issues);
  checkScenes(ctx, issues);
  checkUsage(ctx, issues);

  // A test file lives in test(s)/ and defines at least one test_ function.
  const testFiles = scripts.filter(
    (s) => /(^|\/)tests?\//.test(s.path) && s.functions.some((f) => f.name.startsWith('test_')),
  ).length;
  if (testFiles === 0) {
    issues.push(
      makeIssue({
        ruleId: 'no-tests',
        severity: 'medium',
        category: 'testing',
        title: 'No automated tests',
        message:
          'Add tests (e.g. tests/test_*.gd with the GameForge runner or GUT) to catch regressions.',
        fix: { kind: 'ai', description: 'Create a test runner and first tests' },
      }),
    );
  }
  if (![...files].some((f) => /^readme(\.md)?$/i.test(f))) {
    issues.push(
      makeIssue({
        ruleId: 'no-readme',
        severity: 'low',
        category: 'documentation',
        title: 'No README',
        message: 'Describe the game, controls and how to run it.',
        fix: { kind: 'ai', description: 'Write a README' },
      }),
    );
  }
  context.logger.info(`Analyzed ${all.length} files: ${issues.length} issues`);
  const assets = all.filter((f) => ASSET_EXTENSIONS.has(path.extname(f).toLowerCase())).length;
  return {
    engine: 'godot',
    projectName: project?.name ?? path.basename(workspace.root),
    ...(project?.features[0] ? { engineVersion: project.features[0] } : {}),
    scores: computeScores(ctx, issues, testFiles),
    stats: {
      files: all.length,
      scripts: scripts.length,
      scenes: scenes.size,
      assets,
      linesOfCode: scripts.reduce((sum, s) => sum + s.codeLines, 0),
      tests: testFiles,
    },
    structure: {
      ...(project?.mainScene ? { mainScene: project.mainScene } : {}),
      autoloads: Object.keys(project?.autoloads ?? {}),
      scenes: [...scenes.keys()],
      scripts: scripts.map((s) => s.path),
    },
    issues,
    engineValidated: false,
    generatedAt: new Date().toISOString(),
  };
}
