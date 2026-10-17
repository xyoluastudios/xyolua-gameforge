import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  GameForgeError,
  isTemplateFeature,
  throwIfAborted,
  type GamePlan,
  type GenerateOptions,
  type GenerateResult,
  type Workspace,
} from '@gameforge/core';
import { iconSvg, noiseTexture, synthesizeSounds } from './assets.js';
import { generateLevel, hashSeed, type LevelData } from './level-generator.js';
import { KEY, writeProjectGodot, type InputActionSpec } from './project-file.js';
import { gd, writeTscn, type SceneSpec } from './tscn.js';

export const GENERATOR_VERSION = '1';
export const MIN_GODOT_VERSION = '4.3';

const AUTOLOADS: [string, string][] = [
  ['GameState', 'res://scripts/autoload/game_state.gd'],
  ['AudioManager', 'res://scripts/autoload/audio_manager.gd'],
  ['SaveSystem', 'res://scripts/autoload/save_system.gd'],
  ['GameForgeBridge', 'res://scripts/autoload/gameforge_bridge.gd'],
];

const INPUTS: InputActionSpec[] = [
  { name: 'move_forward', keys: [KEY.W, KEY.UP] },
  { name: 'move_back', keys: [KEY.S, KEY.DOWN] },
  { name: 'move_left', keys: [KEY.A, KEY.LEFT] },
  { name: 'move_right', keys: [KEY.D, KEY.RIGHT] },
  { name: 'sprint', keys: [KEY.SHIFT] },
  { name: 'interact', keys: [KEY.E] },
  { name: 'flashlight', keys: [KEY.F] },
  { name: 'pause', keys: [KEY.ESCAPE] },
  { name: 'save_game', keys: [KEY.F5] },
  { name: 'load_game', keys: [KEY.F9] },
];

/** Lists template files for a dimension: common/** plus 2d/** or 3d/**. */
export function templateFiles(
  templatesDir: string,
  dimension: '2d' | '3d',
): { source: string; target: string }[] {
  const result: { source: string; target: string }[] = [];
  const walk = (base: string, dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(base, full);
      else
        result.push({ source: full, target: path.relative(base, full).split(path.sep).join('/') });
    }
  };
  for (const group of ['common', dimension]) {
    const base = path.join(templatesDir, group);
    try {
      walk(base, base);
    } catch (error) {
      throw new GameForgeError('INTERNAL', 'Godot templates are missing.', {
        reason: `Could not read ${base}`,
        solution: 'Reinstall GameForge or check the templates folder.',
        cause: error,
      });
    }
  }
  return result.sort((a, b) => a.target.localeCompare(b.target));
}

const isHorror = (plan: GamePlan) =>
  /horror|scary|creepy|grusel/i.test(`${plan.genre} ${plan.summary}`);

/** Runtime configuration read by the game (data/game_config.json). */
export function buildGameConfig(plan: GamePlan): Record<string, unknown> {
  const horror = isHorror(plan);
  const is3d = plan.dimension === '3d';
  const hasSave = plan.features.some((f) => f.id === 'save_system');
  const controls = [
    is3d ? 'WASD move · Mouse look' : 'WASD / arrows move',
    'Shift sprint',
    'E interact',
    ...(is3d && plan.features.some((f) => f.id === 'flashlight') ? ['F flashlight'] : []),
    ...(hasSave ? ['F5 save · F9 load'] : []),
    'Esc pause',
  ].join(' · ');
  const tagline = (plan.summary.split(/(?<=[.!?])\s/)[0] ?? plan.summary).slice(0, 90);
  return {
    _units: is3d
      ? '3D: meters and meters per second (1 grid tile = 2 m).'
      : '2D: tiles and tiles per second (1 tile = 32 px).',
    title: plan.title,
    tagline,
    genre: plan.genre,
    dimension: plan.dimension,
    features: plan.features.map((f) => f.id),
    player: {
      move_speed: plan.player.moveSpeed,
      sprint_speed: plan.player.sprintSpeed,
      max_health: plan.player.maxHealth,
      mouse_sensitivity: 0.0025,
    },
    flashlight: { battery_seconds: 180, range: 14 },
    enemies: plan.enemies.map((e) => ({
      name: e.name,
      behavior: e.behavior,
      speed: e.speed,
      damage: e.damage,
      sight_range: is3d ? 12 : 10,
      attack_cooldown: 1.2,
    })),
    random_events: { min_interval: 12, max_interval: 30 },
    world: is3d
      ? horror
        ? {
            ambient_light: 0.18,
            fog_density: 0.03,
            light_energy: 1.1,
            light_color: '#ffd9a8',
            wall_color: '#7d8a83',
            floor_color: '#4a4d52',
            vignette: 0.6,
            ceiling: true,
          }
        : {
            ambient_light: 0.6,
            fog_density: 0,
            light_energy: 1.6,
            light_color: '#fff1dc',
            wall_color: '#b3bcc5',
            floor_color: '#6b717a',
            vignette: 0.2,
            ceiling: true,
          }
      : horror
        ? {
            background_color: '#08090b',
            floor_color: '#2c3036',
            wall_color: '#121417',
            tint: '#b9bdc8',
          }
        : {
            background_color: '#0d0f12',
            floor_color: '#3b4a41',
            wall_color: '#1a1f23',
            tint: '#ffffff',
          },
    texts: {
      intro:
        plan.level.keys > 0
          ? `Find the keys and reach the exit of ${plan.level.name}.`
          : `Reach the exit of ${plan.level.name}.`,
      objective: plan.coreLoop.join(' → ').slice(0, 120),
      win_title: horror ? 'You escaped' : 'Level complete',
      win: `You made it out of ${plan.level.name}.`,
      lose_title: horror ? 'You died' : 'Game over',
      lose: plan.enemies[0] ? `The ${plan.enemies[0].name.toLowerCase()} got you.` : 'Try again.',
      controls,
    },
  };
}

export function buildSoundEvents(): Record<string, unknown> {
  const sfx = (name: string, volume = -4) => ({
    file: `res://audio/sfx/${name}.wav`,
    volume_db: volume,
  });
  return {
    _comment:
      'Sound events used by the AudioManager autoload. Replace the files, keep the event names.',
    events: {
      pickup: sfx('pickup', -6),
      door_open: sfx('door_open'),
      door_locked: sfx('door_locked'),
      hurt: sfx('hurt'),
      enemy_alert: sfx('enemy_alert', -2),
      win: sfx('win', -6),
      flicker: sfx('flicker', -10),
      distant_noise: sfx('distant_noise', -8),
      ambience: { file: 'res://audio/ambience/ambience.wav', volume_db: -14, loop: true },
    },
  };
}

function scenes(plan: GamePlan): Record<string, SceneSpec> {
  const is3d = plan.dimension === '3d';
  const ui = (rootType: string, script: string, name: string): SceneSpec => ({
    extResources: [{ type: 'Script', path: script, id: '1_script' }],
    nodes: [{ name, type: rootType, properties: { script: gd.ext('1_script') } }],
  });
  const result: Record<string, SceneSpec> = {
    'ui/hud.tscn': ui('CanvasLayer', 'res://ui/hud.gd', 'HUD'),
    'ui/pause_menu.tscn': ui('CanvasLayer', 'res://ui/pause_menu.gd', 'PauseMenu'),
    'ui/end_screen.tscn': ui('CanvasLayer', 'res://ui/end_screen.gd', 'EndScreen'),
    'ui/main_menu.tscn': ui('Control', 'res://ui/main_menu.gd', 'MainMenu'),
  };
  result['scenes/main.tscn'] = {
    extResources: [
      { type: 'Script', path: 'res://scripts/main.gd', id: '1_main' },
      { type: 'Script', path: 'res://scripts/world/level_builder.gd', id: '2_level' },
      { type: 'PackedScene', path: 'res://scenes/player.tscn', id: '3_player' },
      { type: 'PackedScene', path: 'res://ui/hud.tscn', id: '4_hud' },
      { type: 'PackedScene', path: 'res://ui/pause_menu.tscn', id: '5_pause' },
      { type: 'PackedScene', path: 'res://ui/end_screen.tscn', id: '6_end' },
    ],
    nodes: [
      { name: 'Main', type: is3d ? 'Node3D' : 'Node2D', properties: { script: gd.ext('1_main') } },
      {
        name: 'Level',
        type: is3d ? 'Node3D' : 'Node2D',
        properties: { script: gd.ext('2_level'), level_path: 'res://data/levels/level_01.json' },
      },
      { name: 'Player', instance: '3_player' },
      { name: 'HUD', instance: '4_hud' },
      { name: 'PauseMenu', instance: '5_pause' },
      { name: 'EndScreen', instance: '6_end' },
    ],
  };
  if (is3d) {
    result['scenes/player.tscn'] = {
      extResources: [{ type: 'Script', path: 'res://scripts/player/player.gd', id: '1_player' }],
      subResources: [
        {
          type: 'CapsuleShape3D',
          id: 'CapsuleShape3D_body',
          properties: { radius: 0.35, height: 1.8 },
        },
      ],
      nodes: [
        { name: 'Player', type: 'CharacterBody3D', properties: { script: gd.ext('1_player') } },
        {
          name: 'CollisionShape3D',
          type: 'CollisionShape3D',
          parent: '.',
          properties: {
            transform: gd.translate3d(0, 0.9, 0),
            shape: gd.sub('CapsuleShape3D_body'),
          },
        },
        {
          name: 'Head',
          type: 'Node3D',
          parent: '.',
          properties: { transform: gd.translate3d(0, 1.6, 0) },
        },
        {
          name: 'Camera3D',
          type: 'Camera3D',
          parent: 'Head',
          properties: { current: true, fov: 75, near: 0.05 },
        },
        {
          name: 'InteractRay',
          type: 'RayCast3D',
          parent: 'Head/Camera3D',
          properties: { target_position: gd.vec3(0, 0, -2.5), collide_with_areas: true },
        },
        {
          name: 'Flashlight',
          type: 'SpotLight3D',
          parent: 'Head/Camera3D',
          properties: {
            light_color: gd.color(1, 0.94, 0.82),
            light_energy: 2.5,
            shadow_enabled: true,
            spot_range: 14,
            spot_angle: 26,
          },
        },
      ],
    };
    result['scenes/enemy.tscn'] = {
      extResources: [{ type: 'Script', path: 'res://scripts/enemy/enemy.gd', id: '1_enemy' }],
      subResources: [
        {
          type: 'CapsuleShape3D',
          id: 'CapsuleShape3D_body',
          properties: { radius: 0.4, height: 1.9 },
        },
        {
          type: 'StandardMaterial3D',
          id: 'StandardMaterial3D_body',
          properties: { albedo_color: gd.color(0.12, 0.1, 0.1) },
        },
        {
          type: 'CapsuleMesh',
          id: 'CapsuleMesh_body',
          properties: { material: gd.sub('StandardMaterial3D_body'), radius: 0.4, height: 1.9 },
        },
        {
          type: 'StandardMaterial3D',
          id: 'StandardMaterial3D_eyes',
          properties: {
            albedo_color: gd.color(1, 0.15, 0.1),
            emission_enabled: true,
            emission: gd.color(1, 0.1, 0.05),
            emission_energy_multiplier: 4,
          },
        },
        {
          type: 'SphereMesh',
          id: 'SphereMesh_eye',
          properties: { material: gd.sub('StandardMaterial3D_eyes'), radius: 0.05, height: 0.1 },
        },
      ],
      nodes: [
        { name: 'Enemy', type: 'CharacterBody3D', properties: { script: gd.ext('1_enemy') } },
        {
          name: 'CollisionShape3D',
          type: 'CollisionShape3D',
          parent: '.',
          properties: {
            transform: gd.translate3d(0, 0.95, 0),
            shape: gd.sub('CapsuleShape3D_body'),
          },
        },
        {
          name: 'Body',
          type: 'MeshInstance3D',
          parent: '.',
          properties: { transform: gd.translate3d(0, 0.95, 0), mesh: gd.sub('CapsuleMesh_body') },
        },
        {
          name: 'EyeLeft',
          type: 'MeshInstance3D',
          parent: '.',
          properties: {
            transform: gd.translate3d(-0.13, 1.6, -0.36),
            mesh: gd.sub('SphereMesh_eye'),
          },
        },
        {
          name: 'EyeRight',
          type: 'MeshInstance3D',
          parent: '.',
          properties: {
            transform: gd.translate3d(0.13, 1.6, -0.36),
            mesh: gd.sub('SphereMesh_eye'),
          },
        },
        {
          name: 'Glow',
          type: 'OmniLight3D',
          parent: '.',
          properties: {
            transform: gd.translate3d(0, 1.6, -0.5),
            light_color: gd.color(1, 0.2, 0.1),
            light_energy: 0.4,
            omni_range: 2.5,
          },
        },
      ],
    };
  } else {
    result['scenes/player.tscn'] = {
      extResources: [{ type: 'Script', path: 'res://scripts/player/player.gd', id: '1_player' }],
      subResources: [
        { type: 'CircleShape2D', id: 'CircleShape2D_body', properties: { radius: 10 } },
      ],
      nodes: [
        {
          name: 'Player',
          type: 'CharacterBody2D',
          properties: { script: gd.ext('1_player'), motion_mode: 1 },
        },
        {
          name: 'CollisionShape2D',
          type: 'CollisionShape2D',
          parent: '.',
          properties: { shape: gd.sub('CircleShape2D_body') },
        },
        {
          name: 'Camera2D',
          type: 'Camera2D',
          parent: '.',
          properties: { zoom: gd.vec2(2, 2), position_smoothing_enabled: true },
        },
      ],
    };
    result['scenes/enemy.tscn'] = {
      extResources: [{ type: 'Script', path: 'res://scripts/enemy/enemy.gd', id: '1_enemy' }],
      subResources: [
        {
          type: 'RectangleShape2D',
          id: 'RectangleShape2D_body',
          properties: { size: gd.vec2(20, 20) },
        },
      ],
      nodes: [
        {
          name: 'Enemy',
          type: 'CharacterBody2D',
          properties: { script: gd.ext('1_enemy'), motion_mode: 1 },
        },
        {
          name: 'CollisionShape2D',
          type: 'CollisionShape2D',
          parent: '.',
          properties: { shape: gd.sub('RectangleShape2D_body') },
        },
      ],
    };
  }
  return result;
}

function readme(plan: GamePlan, level: LevelData, custom: string[]): string {
  const featureLines = plan.features.map(
    (f) =>
      `- **${f.name}**${isTemplateFeature(f.id) ? '' : ' _(custom — implemented by the Programmer agent)_'}${f.description ? ` — ${f.description}` : ''}`,
  );
  return `# ${plan.title}

${plan.summary}

- **Genre:** ${plan.genre}
- **Engine:** Godot ${MIN_GODOT_VERSION}+ (${plan.dimension.toUpperCase()}, ${plan.perspective})
- **Level:** ${level.name} — ${level.rooms.length} rooms, ${level.keys.length} keys

## Play

1. Install [Godot ${MIN_GODOT_VERSION} or newer](https://godotengine.org/download).
2. Open \`project.godot\` in Godot and press **F5** — or click **▶ Play** in XyoLua GameForge.

## Features

${featureLines.join('\n')}
${custom.length ? `\n> Custom features (${custom.join(', ')}) have no tested template. They are implemented by the GameForge Programmer agent when an AI provider is configured.\n` : ''}
## Project structure

| Folder | Content |
| --- | --- |
| \`scenes/\` | Game scene, player and enemy scenes |
| \`scripts/\` | Gameplay scripts (\`autoload/\` = global singletons) |
| \`ui/\` | HUD, menus and their scripts |
| \`data/\` | \`game_config.json\` (tuning: speeds, health, texts) and \`levels/\` |
| \`assets/\` | Textures and \`manifest.json\` (asset metadata) |
| \`audio/\` | Sound effects, ambience and \`sound_events.json\` |
| \`shaders/\` | Shaders (HUD vignette) |
| \`tests/\` | Automated tests |

Most tuning lives in \`data/game_config.json\` — e.g. change \`enemies[0].speed\` to make the enemy faster.
The level layout is \`data/levels/level_01.json\` (\`#\` = wall, \`D\` = door, \`K\` = key, \`S\` = start, \`X\` = exit, \`E\` = enemy).

## Tests

\`\`\`bash
godot --headless --path . -s res://tests/run_tests.gd
\`\`\`

The tests check the game state logic, the save system, the data files and that the level is solvable.

## Exporting

Add \`*.json\` to *Project → Export → Resources → Filters to export non-resource files* so the data files are included in exported builds.

---

Generated by [XyoLua GameForge](https://github.com/xyoluastudios/xyolua-gameforge). The generated code and assets are yours — the
templates are released under [MIT-0](https://opensource.org/license/mit-0), so no attribution is required.
`;
}

/** Generates a complete, runnable Godot 4 project from an approved plan. */
export async function generateGodotProject(
  plan: GamePlan,
  workspace: Workspace,
  templatesDir: string,
  options: GenerateOptions = {},
): Promise<GenerateResult> {
  const files: string[] = [];
  const write = async (target: string, content: string | Buffer) => {
    throwIfAborted(options.signal);
    if (typeof content === 'string') await workspace.writeText(target, content, 'Generator');
    else await writeBinary(workspace, target, content);
    files.push(target);
    options.onFile?.(target);
  };
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const custom = plan.features.filter((f) => !isTemplateFeature(f.id)).map((f) => f.id);

  // --- Scaffold: project, scripts, scenes, data, tests
  options.onPhase?.('scaffold', 'running', []);
  const scaffoldStart = files.length;
  const level = generateLevel(plan, options.levelBrief ?? {});
  const mainScene = plan.features.some((f) => f.id === 'main_menu')
    ? 'res://ui/main_menu.tscn'
    : 'res://scenes/main.tscn';
  await write(
    'project.godot',
    writeProjectGodot({
      name: plan.title,
      description: plan.summary.slice(0, 200),
      mainScene,
      icon: 'res://icon.svg',
      autoloads: AUTOLOADS,
      inputs: INPUTS,
      dimension: plan.dimension,
      minVersion: MIN_GODOT_VERSION,
    }),
  );
  for (const template of templateFiles(templatesDir, plan.dimension)) {
    await write(template.target, readFileSync(template.source, 'utf8'));
  }
  for (const [target, spec] of Object.entries(scenes(plan))) await write(target, writeTscn(spec));
  await write('data/game_config.json', json(buildGameConfig(plan)));
  await write('data/levels/level_01.json', json(level));
  await write('icon.svg', iconSvg(plan.title));
  await write('README.md', readme(plan, level, custom));
  await write(
    '.gitignore',
    '# Godot 4\n.godot/\n/android/\nexport/\n*.tmp\n\n# GameForge (local preview frames)\n.gameforge/preview*\n',
  );
  await write('.gitattributes', '* text=auto eol=lf\n*.png binary\n*.wav binary\n');
  await write(
    '.editorconfig',
    'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\ninsert_final_newline = true\n\n[*.gd]\nindent_style = tab\n',
  );
  await write('.gameforge/plan.json', json(plan));
  await write(
    '.gameforge/project.json',
    json({
      generator: 'xyolua-gameforge',
      generatorVersion: GENERATOR_VERSION,
      engine: 'godot',
      minEngineVersion: MIN_GODOT_VERSION,
      dimension: plan.dimension,
      levelSeed: level.seed,
    }),
  );
  options.onPhase?.('scaffold', 'done', files.slice(scaffoldStart));

  // --- Assets (Asset Manager)
  options.onPhase?.('assets', 'running', []);
  const assetStart = files.length;
  const seed = hashSeed(plan.title);
  const horror = isHorror(plan);
  // Neutral light textures: the material color from game_config.json tints them.
  await write('assets/textures/wall.png', noiseTexture(64, '#ececec', seed));
  await write('assets/textures/floor.png', noiseTexture(64, '#e4e4e4', seed + 1, true));
  options.onPhase?.('assets', 'done', files.slice(assetStart));

  // --- Audio (Audio Designer)
  options.onPhase?.('audio', 'running', []);
  const audioStart = files.length;
  const sounds = synthesizeSounds(horror ? 'dark' : 'calm');
  for (const [name, wav] of Object.entries(sounds)) {
    await write(name === 'ambience' ? 'audio/ambience/ambience.wav' : `audio/sfx/${name}.wav`, wav);
  }
  await write('audio/sound_events.json', json(buildSoundEvents()));
  const manifest = {
    _comment:
      'Asset metadata maintained by the GameForge Asset Manager. Replace placeholders with real assets.',
    assets: [
      {
        name: 'wall',
        type: 'texture',
        path: 'res://assets/textures/wall.png',
        placeholder: true,
        source: 'generated by GameForge',
        license: 'CC0-1.0',
        usedBy: ['scripts/world/level_builder.gd'],
      },
      {
        name: 'floor',
        type: 'texture',
        path: 'res://assets/textures/floor.png',
        placeholder: true,
        source: 'generated by GameForge',
        license: 'CC0-1.0',
        usedBy: ['scripts/world/level_builder.gd'],
      },
      {
        name: 'icon',
        type: 'image',
        path: 'res://icon.svg',
        placeholder: true,
        source: 'generated by GameForge',
        license: 'CC0-1.0',
        usedBy: ['project.godot'],
      },
      ...Object.keys(sounds).map((name) => ({
        name,
        type: 'audio',
        path:
          name === 'ambience' ? 'res://audio/ambience/ambience.wav' : `res://audio/sfx/${name}.wav`,
        placeholder: true,
        source: 'synthesized by GameForge',
        license: 'CC0-1.0',
        usedBy: ['audio/sound_events.json'],
      })),
    ],
  };
  await write('assets/manifest.json', json(manifest));
  options.onPhase?.('audio', 'done', files.slice(audioStart));

  options.logger?.info(`Generated ${files.length} files for "${plan.title}" (${plan.dimension})`);
  return { files, customFeatures: custom, mainScene };
}

async function writeBinary(workspace: Workspace, target: string, data: Buffer): Promise<void> {
  const { abs } = workspace.resolve(target, { forWrite: true });
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
}
