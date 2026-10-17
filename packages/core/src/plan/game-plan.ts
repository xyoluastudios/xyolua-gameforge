import { z } from 'zod';
import { GameForgeError } from '../errors.js';
import type { JsonSchema } from '../providers/types.js';

/**
 * The Game Plan is the contract between the user, the Game Designer agent and
 * the engine generator. The user reviews and approves it before anything is
 * generated.
 */

export const FEATURE_PRIORITIES = ['must', 'should', 'could'] as const;

export const GameFeatureSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'feature ids are snake_case'),
  name: z.string().min(1).max(60),
  description: z.string().max(400).default(''),
  priority: z.enum(FEATURE_PRIORITIES).default('must'),
});

export const GamePlanSchema = z.object({
  title: z.string().min(1).max(60),
  genre: z.string().min(1).max(40),
  engine: z.literal('godot').default('godot'),
  dimension: z.enum(['2d', '3d']),
  perspective: z.enum(['first-person', 'top-down']),
  summary: z.string().min(1).max(800),
  setting: z.string().max(300).default(''),
  artStyle: z.string().max(200).default('Simple placeholder geometry'),
  coreLoop: z.array(z.string().min(1).max(200)).min(1).max(10),
  features: z.array(GameFeatureSchema).min(1).max(30),
  player: z.object({
    moveSpeed: z.number().min(0.5).max(30),
    sprintSpeed: z.number().min(0.5).max(40),
    maxHealth: z.number().int().min(1).max(1000),
  }),
  enemies: z
    .array(
      z.object({
        name: z.string().min(1).max(40),
        behavior: z.enum(['chase', 'patrol', 'wander']),
        speed: z.number().min(0.1).max(30),
        damage: z.number().int().min(0).max(1000),
        count: z.number().int().min(0).max(20),
      }),
    )
    .max(5)
    .default([]),
  level: z.object({
    name: z.string().min(1).max(60),
    theme: z.string().max(200).default(''),
    rooms: z.number().int().min(3).max(24),
    keys: z.number().int().min(0).max(6),
  }),
  audio: z
    .object({
      ambience: z.string().max(200).default(''),
      music: z.string().max(200).default(''),
      events: z.array(z.string().max(60)).max(20).default([]),
    })
    .default({ ambience: '', music: '', events: [] }),
  multiplayer: z
    .object({ enabled: z.boolean(), maxPlayers: z.number().int().min(1).max(64) })
    .default({ enabled: false, maxPlayers: 1 }),
  notes: z.array(z.string().max(300)).max(20).default([]),
});

export type GamePlan = z.infer<typeof GamePlanSchema>;
export type GameFeature = z.infer<typeof GameFeatureSchema>;

/**
 * Feature ids with a tested engine template. Anything else is implemented by
 * the Programmer agent (requires a generative AI provider).
 */
export const TEMPLATE_FEATURES = {
  player_movement: 'Player movement (walk, sprint, mouse look / 8-way movement)',
  interaction: 'Interaction system (look at / approach + press E)',
  health: 'Health, damage and game over',
  inventory: 'Inventory with item pickups',
  keys_doors: 'Keys and locked doors',
  enemy_ai: 'Enemy AI (grid path-finding chase / patrol / wander)',
  flashlight: 'Flashlight with battery (3D)',
  random_events: 'Random ambient events (flicker, sounds)',
  save_system: 'Save / load (F5 / F9)',
  hud: 'HUD (health, battery, inventory, messages)',
  main_menu: 'Main menu',
  pause_menu: 'Pause menu',
  objective: 'Objective: reach the exit',
  ambient_audio: 'Ambient audio and sound events',
} as const;

export type TemplateFeatureId = keyof typeof TEMPLATE_FEATURES;

export function isTemplateFeature(id: string): id is TemplateFeatureId {
  return Object.hasOwn(TEMPLATE_FEATURES, id);
}

/** Hand-written JSON schema sent to providers (kept simple for broad model support). */
export const GAME_PLAN_JSON_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'genre',
    'engine',
    'dimension',
    'perspective',
    'summary',
    'setting',
    'artStyle',
    'coreLoop',
    'features',
    'player',
    'enemies',
    'level',
    'audio',
    'multiplayer',
    'notes',
  ],
  properties: {
    title: { type: 'string' },
    genre: { type: 'string' },
    engine: { type: 'string', enum: ['godot'] },
    dimension: { type: 'string', enum: ['2d', '3d'] },
    perspective: { type: 'string', enum: ['first-person', 'top-down'] },
    summary: { type: 'string' },
    setting: { type: 'string' },
    artStyle: { type: 'string' },
    coreLoop: { type: 'array', items: { type: 'string' } },
    features: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'name', 'description', 'priority'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'string', enum: ['must', 'should', 'could'] },
        },
      },
    },
    player: {
      type: 'object',
      additionalProperties: false,
      required: ['moveSpeed', 'sprintSpeed', 'maxHealth'],
      properties: {
        moveSpeed: { type: 'number' },
        sprintSpeed: { type: 'number' },
        maxHealth: { type: 'integer' },
      },
    },
    enemies: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'behavior', 'speed', 'damage', 'count'],
        properties: {
          name: { type: 'string' },
          behavior: { type: 'string', enum: ['chase', 'patrol', 'wander'] },
          speed: { type: 'number' },
          damage: { type: 'integer' },
          count: { type: 'integer' },
        },
      },
    },
    level: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'theme', 'rooms', 'keys'],
      properties: {
        name: { type: 'string' },
        theme: { type: 'string' },
        rooms: { type: 'integer' },
        keys: { type: 'integer' },
      },
    },
    audio: {
      type: 'object',
      additionalProperties: false,
      required: ['ambience', 'music', 'events'],
      properties: {
        ambience: { type: 'string' },
        music: { type: 'string' },
        events: { type: 'array', items: { type: 'string' } },
      },
    },
    multiplayer: {
      type: 'object',
      additionalProperties: false,
      required: ['enabled', 'maxPlayers'],
      properties: { enabled: { type: 'boolean' }, maxPlayers: { type: 'integer' } },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

/** Validates (and normalizes) an unknown value as a Game Plan. */
export function parseGamePlan(value: unknown): GamePlan {
  const result = GamePlanSchema.safeParse(value);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new GameForgeError('PLAN_INVALID', 'The game plan is not valid.', {
      reason: issues,
      details: { issues: result.error.issues },
    });
  }
  return normalizePlan(result.data);
}

/** Fixes small inconsistencies so the generator always gets a coherent plan. */
export function normalizePlan(plan: GamePlan): GamePlan {
  const features = dedupeFeatures(plan.features);
  const ids = new Set(features.map((f) => f.id));
  const ensure = (id: TemplateFeatureId, name: string) => {
    if (!ids.has(id)) {
      features.unshift({ id, name, description: '', priority: 'must' });
      ids.add(id);
    }
  };
  ensure('player_movement', 'Player movement');
  if (plan.level.keys > 0) ensure('keys_doors', 'Keys and doors');
  if (plan.enemies.some((e) => e.count > 0)) ensure('enemy_ai', 'Enemy AI');
  // Flashlight is 3D-only.
  const filtered =
    plan.dimension === '2d' ? features.filter((f) => f.id !== 'flashlight') : features;
  const perspective = plan.dimension === '3d' ? 'first-person' : 'top-down';
  const sprintSpeed = Math.max(plan.player.sprintSpeed, plan.player.moveSpeed);
  return {
    ...plan,
    perspective,
    features: filtered,
    player: { ...plan.player, sprintSpeed },
    multiplayer: plan.multiplayer.enabled
      ? { enabled: true, maxPlayers: Math.max(2, plan.multiplayer.maxPlayers) }
      : { enabled: false, maxPlayers: 1 },
  };
}

function dedupeFeatures(features: GameFeature[]): GameFeature[] {
  const seen = new Set<string>();
  return features.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));
}

/** Plain-text rendering used by the CLI and the plan review panel. */
export function renderPlanText(plan: GamePlan): string {
  const lines = [
    'GAME PLAN',
    '',
    'Title:',
    plan.title,
    '',
    'Genre:',
    plan.genre,
    '',
    'Engine:',
    `Godot (${plan.dimension.toUpperCase()}, ${plan.perspective})`,
    '',
    'Summary:',
    plan.summary,
    '',
    'Core loop:',
    ...plan.coreLoop.map((step, i) => `${i + 1}. ${step}`),
    '',
    'Features:',
    ...plan.features.map(
      (f) =>
        `- ${f.name}${isTemplateFeature(f.id) ? '' : '  (custom — written by the Programmer agent)'}`,
    ),
    '',
    'Level:',
    `${plan.level.name} — ${plan.level.rooms} rooms, ${plan.level.keys} keys${plan.level.theme ? ` (${plan.level.theme})` : ''}`,
  ];
  if (plan.enemies.length) {
    lines.push('', 'Enemies:');
    for (const e of plan.enemies)
      lines.push(`- ${e.count}× ${e.name} (${e.behavior}, speed ${e.speed}, damage ${e.damage})`);
  }
  if (plan.multiplayer.enabled)
    lines.push('', 'Multiplayer:', `Up to ${plan.multiplayer.maxPlayers} players`);
  if (plan.notes.length) lines.push('', 'Notes:', ...plan.notes.map((n) => `- ${n}`));
  return lines.join('\n');
}

/** Extracts the first JSON object from model text (handles ```json fences and prose). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf('{');
  if (start === -1)
    throw new GameForgeError('PROVIDER_BAD_RESPONSE', 'The AI did not return JSON.');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(candidate.slice(start, i + 1));
        } catch (error) {
          throw new GameForgeError('PROVIDER_BAD_RESPONSE', 'The AI returned malformed JSON.', {
            cause: error,
          });
        }
      }
    }
  }
  throw new GameForgeError('PROVIDER_BAD_RESPONSE', 'The AI returned incomplete JSON.');
}
