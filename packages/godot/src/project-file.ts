import { encodeString, parseSections, unquote } from './tscn.js';

/**
 * project.godot reading and minimal, format-preserving editing.
 */

export interface ProjectInfo {
  name: string;
  mainScene?: string;
  configVersion: number;
  features: string[];
  /** Autoload name → res:// path (without the "*" singleton marker). */
  autoloads: Record<string, string>;
  inputActions: string[];
  renderer?: string;
}

export function parseProjectGodot(text: string): ProjectInfo {
  // Keys before the first section (config_version) live in a pseudo section.
  const sections = parseSections(`[__root]\n${text}`);
  const all = (name: string) => {
    const merged: Record<string, string> = {};
    for (const section of sections)
      if (section.tag === name) Object.assign(merged, section.properties);
    return merged;
  };
  const application = all('application');
  const input = all('input');
  const rendering = all('rendering');
  const autoloads: Record<string, string> = {};
  for (const [name, value] of Object.entries(all('autoload'))) {
    autoloads[name] = (unquote(value) ?? '').replace(/^\*/, '');
  }
  const features = /PackedStringArray\(([^)]*)\)/.exec(application['config/features'] ?? '')?.[1];
  const mainScene = unquote(application['run/main_scene']);
  const renderer = unquote(rendering['renderer/rendering_method']);
  return {
    name: unquote(application['config/name']) ?? 'Untitled',
    ...(mainScene ? { mainScene } : {}),
    configVersion: Number(all('__root').config_version ?? 0),
    features: features
      ? features
          .split(',')
          .map((f) => unquote(f.trim()) ?? '')
          .filter(Boolean)
      : [],
    autoloads,
    inputActions: Object.keys(input),
    ...(renderer ? { renderer } : {}),
  };
}

/** Sets `key=value` in a section, creating the section/key if needed. Other content is preserved. */
export function setProjectValue(
  text: string,
  section: string,
  key: string,
  encodedValue: string,
): string {
  const lines = text.split(/\r?\n/);
  const header = lines.findIndex((l) => l.trim() === `[${section}]`);
  if (header === -1) {
    const trimmed = text.replace(/\s+$/, '');
    return `${trimmed}\n\n[${section}]\n\n${key}=${encodedValue}\n`;
  }
  let end = lines.length;
  for (let i = header + 1; i < lines.length; i++) {
    if (/^\[[^\]]+\]\s*$/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  for (let i = header + 1; i < end; i++) {
    if (lines[i]!.startsWith(`${key}=`)) {
      // Replace a (possibly multi-line) value.
      let j = i;
      let depth = 0;
      do {
        for (const ch of lines[j]!) {
          if ('([{'.includes(ch)) depth++;
          else if (')]}'.includes(ch)) depth--;
        }
        j++;
      } while (depth > 0 && j < end);
      lines.splice(i, j - i, `${key}=${encodedValue}`);
      return lines.join('\n');
    }
  }
  let insertAt = end;
  while (insertAt > header + 1 && lines[insertAt - 1]!.trim() === '') insertAt--;
  lines.splice(insertAt, 0, `${key}=${encodedValue}`);
  return lines.join('\n');
}

// ------------------------------------------------------------------ writing

export interface KeyBinding {
  physicalKeycode: number;
}

export interface InputActionSpec {
  name: string;
  keys: number[];
  mouseButtons?: number[];
}

/** Godot 4 key codes for the keys GameForge binds by default. */
export const KEY = {
  W: 87,
  A: 65,
  S: 83,
  D: 68,
  E: 69,
  F: 70,
  Q: 81,
  R: 82,
  SPACE: 32,
  ESCAPE: 4194305,
  SHIFT: 4194325,
  CTRL: 4194326,
  UP: 4194320,
  DOWN: 4194322,
  LEFT: 4194319,
  RIGHT: 4194321,
  F5: 4194336,
  F9: 4194340,
} as const;

function keyEvent(code: number): string {
  return `Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"pressed":false,"keycode":0,"physical_keycode":${code},"key_label":0,"unicode":0,"location":0,"echo":false,"script":null)`;
}

function mouseEvent(button: number): string {
  return `Object(InputEventMouseButton,"resource_local_to_scene":false,"resource_name":"","device":-1,"window_id":0,"alt_pressed":false,"shift_pressed":false,"ctrl_pressed":false,"meta_pressed":false,"button_mask":0,"position":Vector2(0, 0),"global_position":Vector2(0, 0),"factor":1.0,"button_index":${button},"canceled":false,"pressed":false,"double_click":false,"script":null)`;
}

export function encodeInputAction(action: InputActionSpec): string {
  const events = [...action.keys.map(keyEvent), ...(action.mouseButtons ?? []).map(mouseEvent)];
  return `{\n"deadzone": 0.2,\n"events": [${events.join('\n, ')}]\n}`;
}

/** Sensible default bindings for common action names (used by quick fixes). */
export function defaultBindingFor(action: string): InputActionSpec {
  const name = action.toLowerCase();
  const map: [RegExp, number[], number[]?][] = [
    [/(^|_)(forward|up)$/, [KEY.W, KEY.UP]],
    [/(^|_)(back|backward|down)$/, [KEY.S, KEY.DOWN]],
    [/(^|_)left$/, [KEY.A, KEY.LEFT]],
    [/(^|_)right$/, [KEY.D, KEY.RIGHT]],
    [/jump/, [KEY.SPACE]],
    [/sprint|run/, [KEY.SHIFT]],
    [/crouch/, [KEY.CTRL]],
    [/interact|use/, [KEY.E]],
    [/flashlight|torch|light/, [KEY.F]],
    [/pause|menu/, [KEY.ESCAPE]],
    [/reload/, [KEY.R]],
    [/fire|shoot|attack/, [], [1]],
    [/aim/, [], [2]],
    [/save/, [KEY.F5]],
    [/load/, [KEY.F9]],
  ];
  for (const [pattern, keys, mouse] of map) {
    if (pattern.test(name))
      return { name: action, keys, ...(mouse ? { mouseButtons: mouse } : {}) };
  }
  return { name: action, keys: [] };
}

export interface ProjectGodotSpec {
  name: string;
  description: string;
  mainScene: string;
  icon: string;
  autoloads: [string, string][];
  inputs: InputActionSpec[];
  dimension: '2d' | '3d';
  minVersion: string;
}

export function writeProjectGodot(spec: ProjectGodotSpec): string {
  const renderer = spec.dimension === '3d' ? 'Forward Plus' : 'GL Compatibility';
  const lines = [
    '; Engine configuration file.',
    "; It's best edited using the editor UI and not directly,",
    '; since the parameters that go here are not all obvious.',
    ';',
    '; Format:',
    ';   [section] ; section goes between []',
    ';   param=value ; assign values to parameters',
    '',
    'config_version=5',
    '',
    '[application]',
    '',
    `config/name=${encodeString(spec.name)}`,
    `config/description=${encodeString(spec.description)}`,
    `run/main_scene=${encodeString(spec.mainScene)}`,
    `config/features=PackedStringArray(${encodeString(spec.minVersion)}, ${encodeString(renderer)})`,
    `config/icon=${encodeString(spec.icon)}`,
    '',
    '[autoload]',
    '',
    ...spec.autoloads.map(([name, path]) => `${name}=${encodeString(`*${path}`)}`),
    '',
    '[display]',
    '',
    'window/size/viewport_width=1280',
    'window/size/viewport_height=720',
    ...(spec.dimension === '2d' ? ['window/stretch/mode="canvas_items"'] : []),
    '',
    '[input]',
    '',
    ...spec.inputs.map((input) => `${input.name}=${encodeInputAction(input)}`),
    '',
    '[rendering]',
    '',
    spec.dimension === '3d'
      ? 'renderer/rendering_method="forward_plus"'
      : 'renderer/rendering_method="gl_compatibility"',
    ...(spec.dimension === '2d'
      ? [
          'renderer/rendering_method.mobile="gl_compatibility"',
          'textures/canvas_textures/default_texture_filter=0',
        ]
      : []),
    '',
  ];
  return lines.join('\n');
}
