import type { GamePlan, LevelBrief } from '@gameforge/core';

/**
 * Procedural, seeded grid level generator.
 *
 * Rooms are laid out in a snake order and connected by corridors, so the
 * level has a clear progression. Locked doors sit on corridors between room
 * groups and the key for door N is always placed before it. Every generated
 * level is verified with a flood fill; invalid layouts are regenerated.
 */

export interface LevelRoom {
  name: string;
  note: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LevelDoor {
  id: string;
  x: number;
  y: number;
  key: string;
  key_name: string;
}

export interface LevelKey {
  id: string;
  name: string;
  color: string;
  x: number;
  y: number;
  opens: string;
}

export interface Cell {
  x: number;
  y: number;
}

export interface LevelData {
  name: string;
  seed: number;
  width: number;
  height: number;
  legend: Record<string, string>;
  grid: string[];
  rooms: LevelRoom[];
  doors: LevelDoor[];
  keys: LevelKey[];
  enemies: (Cell & { type: number })[];
  lights: Cell[];
  spawn: Cell;
  exit: Cell;
}

const KEY_STYLES = [
  ['Red Key', '#e0524a'],
  ['Blue Key', '#4a8fe0'],
  ['Green Key', '#4ae07a'],
  ['Yellow Key', '#e0c84a'],
  ['Purple Key', '#a04ae0'],
  ['White Key', '#e8e8e8'],
] as const;

const THEMED_ROOMS: [RegExp, string[]][] = [
  [
    /hospital|clinic|asylum|krankenhaus/i,
    [
      'Reception',
      'Waiting Room',
      'Ward A',
      'Pharmacy',
      'X-Ray',
      'Ward B',
      'Operating Theater',
      'Staff Room',
      'Archive',
      'Isolation Ward',
      'Boiler Room',
      'Morgue',
    ],
  ],
  [
    /school|academy/i,
    [
      'Entrance Hall',
      'Classroom 1',
      'Library',
      'Cafeteria',
      'Gym',
      'Science Lab',
      "Principal's Office",
      'Storage',
      'Music Room',
      'Basement',
    ],
  ],
  [
    /mansion|house|manor|villa/i,
    [
      'Foyer',
      'Dining Room',
      'Kitchen',
      'Library',
      'Study',
      'Parlor',
      'Master Bedroom',
      'Nursery',
      'Attic',
      'Cellar',
    ],
  ],
  [
    /space|station|ship/i,
    [
      'Airlock',
      'Corridor A',
      'Mess Hall',
      'Crew Quarters',
      'Medbay',
      'Engineering',
      'Reactor',
      'Cargo Bay',
      'Bridge',
      'Escape Pods',
    ],
  ],
  [
    /dungeon|castle|temple|crypt/i,
    [
      'Gatehouse',
      'Great Hall',
      'Armory',
      'Barracks',
      'Chapel',
      'Prison Cells',
      'Treasury',
      'Throne Room',
      'Catacombs',
      'Sanctum',
    ],
  ],
  [
    /lab|laboratory|facility|bunker/i,
    [
      'Security Gate',
      'Lobby',
      'Lab 1',
      'Server Room',
      'Lab 2',
      'Containment',
      'Cold Storage',
      'Control Room',
      'Generator',
      'Exit Shaft',
    ],
  ],
];
const GENERIC_ROOMS = [
  'Entrance',
  'Hallway',
  'Storage',
  'Workshop',
  'Archive',
  'Atrium',
  'Gallery',
  'Vault',
  'Tower Room',
  'Cellar',
  'Courtyard',
  'Chamber',
];

/** Small, fast, seedable PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

function roomNames(plan: GamePlan, count: number, brief: LevelBrief): string[] {
  const themed =
    THEMED_ROOMS.find(([pattern]) =>
      pattern.test(`${plan.level.theme} ${plan.setting} ${plan.level.name}`),
    )?.[1] ?? GENERIC_ROOMS;
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const fromBrief = brief.roomNames?.[i]?.trim();
    names.push(
      fromBrief ||
        themed[i % themed.length]! +
          (i >= themed.length ? ` ${Math.floor(i / themed.length) + 1}` : ''),
    );
  }
  if (!brief.roomNames?.[count - 1]) names[count - 1] = 'Exit';
  return names;
}

interface Attempt {
  data: LevelData;
  ok: boolean;
}

function tryGenerate(plan: GamePlan, seed: number, keyCount: number, brief: LevelBrief): Attempt {
  const rng = createRng(seed);
  const rand = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const n = Math.max(3, Math.min(24, plan.level.rooms));
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const CELL = 11;
  const width = cols * CELL + 2;
  const height = rows * CELL + 2;
  const grid: string[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => '#'),
  );
  const names = roomNames(plan, n, brief);

  // Rooms in snake order.
  const rooms: LevelRoom[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = row % 2 === 0 ? i % cols : cols - 1 - (i % cols);
    const w = rand(5, CELL - 3);
    const h = rand(5, CELL - 3);
    const x = 1 + col * CELL + 1 + rand(0, CELL - 2 - w);
    const y = 1 + row * CELL + 1 + rand(0, CELL - 2 - h);
    rooms.push({ name: names[i]!, note: brief.roomNotes?.[i]?.trim() ?? '', x, y, w, h });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy]![xx] = '.';
  }
  const center = (r: LevelRoom): Cell => ({
    x: r.x + Math.floor(r.w / 2),
    y: r.y + Math.floor(r.h / 2),
  });
  const inRoom = (r: LevelRoom, c: Cell) =>
    c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h;

  // Corridors (L-shaped) between consecutive rooms. Remember the paths for door placement.
  const corridors: Cell[][] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = center(rooms[i]!);
    const b = center(rooms[i + 1]!);
    const path: Cell[] = [];
    const horizontalFirst = rng() < 0.5;
    let x = a.x;
    let y = a.y;
    const stepTo = (tx: number, ty: number) => {
      while (x !== tx || y !== ty) {
        if (x !== tx) x += Math.sign(tx - x);
        else y += Math.sign(ty - y);
        path.push({ x, y });
      }
    };
    if (horizontalFirst) {
      stepTo(b.x, a.y);
      stepTo(b.x, b.y);
    } else {
      stepTo(a.x, b.y);
      stepTo(b.x, b.y);
    }
    for (const c of path) grid[c.y]![c.x] = '.';
    corridors.push(path);
  }

  // Progression boundaries: door j sits between room b_j - 1 and room b_j.
  const keys = Math.min(keyCount, n - 1);
  const boundaries: number[] = [];
  for (let j = 1; j <= keys; j++) {
    const b = Math.max(1, Math.min(n - 1, Math.round((j * n) / (keys + 1))));
    if (!boundaries.includes(b)) boundaries.push(b);
  }
  boundaries.sort((p, q) => p - q);

  const doors: LevelDoor[] = [];
  const keyItems: LevelKey[] = [];
  const isFloor = (c: Cell) => grid[c.y]?.[c.x] !== undefined && grid[c.y]![c.x] !== '#';
  const straightPassage = (c: Cell) => {
    const left = isFloor({ x: c.x - 1, y: c.y });
    const right = isFloor({ x: c.x + 1, y: c.y });
    const up = isFloor({ x: c.x, y: c.y - 1 });
    const down = isFloor({ x: c.x, y: c.y + 1 });
    return (left && right && !up && !down) || (up && down && !left && !right);
  };
  let previous = 0;
  boundaries.forEach((b, index) => {
    const path = corridors[b - 1]!;
    const candidates = path.filter((c) => !rooms.some((r) => inRoom(r, c)) && straightPassage(c));
    const doorCell = candidates[Math.floor(candidates.length / 2)];
    if (!doorCell) return;
    const [keyName, color] = KEY_STYLES[index % KEY_STYLES.length]!;
    const doorId = `door_${index + 1}`;
    const keyId = `key_${index + 1}`;
    doors.push({ id: doorId, x: doorCell.x, y: doorCell.y, key: keyId, key_name: keyName });
    // Key in a room of the segment before the door (not on the spawn tile).
    const keyRoomIndex = rand(previous, b - 1);
    const keyRoom = rooms[keyRoomIndex]!;
    let keyCell = center(keyRoom);
    for (let tries = 0; tries < 20; tries++) {
      const c = {
        x: rand(keyRoom.x, keyRoom.x + keyRoom.w - 1),
        y: rand(keyRoom.y, keyRoom.y + keyRoom.h - 1),
      };
      const isSpawn =
        keyRoomIndex === 0 && c.x === center(rooms[0]!).x && c.y === center(rooms[0]!).y;
      if (!isSpawn && !keyItems.some((k) => k.x === c.x && k.y === c.y)) {
        keyCell = c;
        break;
      }
    }
    keyItems.push({ id: keyId, name: keyName, color, x: keyCell.x, y: keyCell.y, opens: doorId });
    previous = b;
  });

  const spawn = center(rooms[0]!);
  const exit = center(rooms[n - 1]!);
  const enemyCount = Math.min(
    6,
    plan.enemies.reduce((sum, e) => sum + e.count, 0),
  );
  const enemies: (Cell & { type: number })[] = [];
  let enemyIndex = 0;
  plan.enemies.forEach((enemy, type) => {
    for (let k = 0; k < enemy.count && enemyIndex < enemyCount; k++, enemyIndex++) {
      const roomIndex = Math.max(
        1,
        Math.min(n - 1, Math.round(((enemyIndex + 1) * (n - 1)) / (enemyCount + 1)) + 1),
      );
      enemies.push({ ...center(rooms[Math.min(roomIndex, n - 1)]!), type });
    }
  });
  const lights = rooms.map(center);

  // Readable markers in the grid (only "#" is a wall for the game).
  for (const d of doors) grid[d.y]![d.x] = 'D';
  for (const k of keyItems) grid[k.y]![k.x] = 'K';
  for (const e of enemies) grid[e.y]![e.x] = 'E';
  grid[spawn.y]![spawn.x] = 'S';
  grid[exit.y]![exit.x] = 'X';

  const data: LevelData = {
    name: plan.level.name,
    seed,
    width,
    height,
    legend: {
      '#': 'wall',
      '.': 'floor',
      S: 'player spawn',
      X: 'exit',
      D: 'locked door',
      K: 'key',
      E: 'enemy spawn',
    },
    grid: grid.map((row) => row.join('')),
    rooms,
    doors,
    keys: keyItems,
    enemies,
    lights,
    spawn,
    exit,
  };
  return { data, ok: doors.length === keys && validateLevel(data).ok };
}

export interface LevelValidation {
  ok: boolean;
  problems: string[];
}

/** Flood-fill check that the level can be solved in order (and not skipped). */
export function validateLevel(level: LevelData): LevelValidation {
  const problems: string[] = [];
  const key = (c: Cell) => `${c.x},${c.y}`;
  const walkable = (c: Cell) =>
    level.grid[c.y]?.[c.x] !== undefined && level.grid[c.y]![c.x] !== '#';
  const reachable = (closed: Set<string>) => {
    const seen = new Set<string>([key(level.spawn)]);
    const queue: Cell[] = [level.spawn];
    while (queue.length) {
      const c = queue.shift()!;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const next = { x: c.x + dx, y: c.y + dy };
        const k = key(next);
        if (!seen.has(k) && walkable(next) && !closed.has(k)) {
          seen.add(k);
          queue.push(next);
        }
      }
    }
    return seen;
  };
  for (let x = 0; x < level.width; x++) {
    if (walkable({ x, y: 0 }) || walkable({ x, y: level.height - 1 }))
      problems.push('border is open');
  }
  if (!walkable(level.spawn)) problems.push('spawn is a wall');
  if (!walkable(level.exit)) problems.push('exit is a wall');
  if (level.keys.length !== level.doors.length) problems.push('keys and doors differ');
  const closed = new Set(level.doors.map(key));
  for (let i = 0; i < level.doors.length; i++) {
    const seen = reachable(closed);
    if (!seen.has(key(level.keys[i]!)))
      problems.push(`key ${i + 1} is not reachable before door ${i + 1}`);
    if (seen.has(key(level.exit))) problems.push(`exit is reachable before door ${i + 1}`);
    closed.delete(key(level.doors[i]!));
  }
  const final = reachable(closed);
  if (!final.has(key(level.exit))) problems.push('exit is not reachable');
  for (const enemy of level.enemies) if (!walkable(enemy)) problems.push('enemy spawn is a wall');
  return { ok: problems.length === 0, problems };
}

/** Generates a solvable level for the plan (deterministic for a given seed). */
export function generateLevel(plan: GamePlan, brief: LevelBrief = {}): LevelData {
  const baseSeed =
    brief.seed ??
    hashSeed(`${plan.title}|${plan.level.name}|${plan.level.rooms}|${plan.level.keys}`);
  for (let keys = plan.level.keys; keys >= 0; keys--) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = tryGenerate(plan, baseSeed + attempt * 7919, keys, brief);
      if (result.ok) return result.data;
    }
  }
  // Without keys a snake layout is always solvable; this is unreachable in practice.
  return tryGenerate(plan, baseSeed, 0, brief).data;
}
