/**
 * Godot 4 text scene (.tscn, format=3) writer and tolerant parser.
 */

/** A property value. Strings/numbers/booleans are encoded automatically; use `gd.*` for engine types. */
export type GdValue = string | number | boolean | { raw: string };

const raw = (value: string): { raw: string } => ({ raw: value });
const num = (n: number): string => (Number.isInteger(n) ? `${n}` : `${Number(n.toFixed(6))}`);

export const gd = {
  raw,
  ext: (id: string) => raw(`ExtResource("${id}")`),
  sub: (id: string) => raw(`SubResource("${id}")`),
  vec2: (x: number, y: number) => raw(`Vector2(${num(x)}, ${num(y)})`),
  vec3: (x: number, y: number, z: number) => raw(`Vector3(${num(x)}, ${num(y)}, ${num(z)})`),
  color: (r: number, g: number, b: number, a = 1) =>
    raw(`Color(${num(r)}, ${num(g)}, ${num(b)}, ${num(a)})`),
  /** Translation-only transform. */
  translate3d: (x: number, y: number, z: number) =>
    raw(`Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${num(x)}, ${num(y)}, ${num(z)})`),
  packedStrings: (values: string[]) =>
    raw(`PackedStringArray(${values.map((v) => encodeString(v)).join(', ')})`),
};

export function encodeString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

export function encodeValue(value: GdValue): string {
  if (typeof value === 'string') return encodeString(value);
  if (typeof value === 'number') return num(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value.raw;
}

export interface ExtResource {
  type: string;
  path: string;
  id: string;
}

export interface SubResource {
  type: string;
  id: string;
  properties: Record<string, GdValue>;
}

export interface SceneNode {
  name: string;
  type?: string;
  /** "." for children of the root, "A/B" for deeper nodes; omitted for the root. */
  parent?: string;
  /** Id of an ExtResource PackedScene to instance. */
  instance?: string;
  groups?: string[];
  properties?: Record<string, GdValue>;
}

export interface SceneConnection {
  signal: string;
  from: string;
  to: string;
  method: string;
}

export interface SceneSpec {
  extResources?: ExtResource[];
  subResources?: SubResource[];
  nodes: SceneNode[];
  connections?: SceneConnection[];
}

function props(properties: Record<string, GdValue> | undefined): string[] {
  return Object.entries(properties ?? {}).map(([key, value]) => `${key} = ${encodeValue(value)}`);
}

/** Serializes a scene in Godot 4's text format. */
export function writeTscn(scene: SceneSpec): string {
  const ext = scene.extResources ?? [];
  const sub = scene.subResources ?? [];
  const out: string[] = [`[gd_scene load_steps=${ext.length + sub.length + 1} format=3]`, ''];
  for (const resource of ext) {
    out.push(`[ext_resource type="${resource.type}" path="${resource.path}" id="${resource.id}"]`);
  }
  if (ext.length) out.push('');
  for (const resource of sub) {
    out.push(
      `[sub_resource type="${resource.type}" id="${resource.id}"]`,
      ...props(resource.properties),
      '',
    );
  }
  scene.nodes.forEach((node, index) => {
    const attrs = [`name="${node.name}"`];
    if (node.type) attrs.push(`type="${node.type}"`);
    if (index > 0) attrs.push(`parent="${node.parent ?? '.'}"`);
    if (node.instance) attrs.push(`instance=ExtResource("${node.instance}")`);
    if (node.groups?.length)
      attrs.push(`groups=[${node.groups.map((g) => encodeString(g)).join(', ')}]`);
    out.push(`[node ${attrs.join(' ')}]`, ...props(node.properties), '');
  });
  for (const c of scene.connections ?? []) {
    out.push(
      `[connection signal="${c.signal}" from="${c.from}" to="${c.to}" method="${c.method}"]`,
    );
  }
  while (out.at(-1) === '') out.pop();
  return `${out.join('\n')}\n`;
}

// ------------------------------------------------------------------ parsing

export interface ParsedSection {
  tag: string;
  attrs: Record<string, string>;
  properties: Record<string, string>;
  line: number;
}

export interface ParsedScene {
  header: ParsedSection | null;
  extResources: { id: string; type: string; path: string; line: number }[];
  subResources: { id: string; type: string; line: number; properties: Record<string, string> }[];
  nodes: {
    name: string;
    type?: string;
    parent?: string;
    instance?: string;
    /** Path relative to the scene root ("." for the root). */
    path: string;
    script?: string;
    uniqueName: boolean;
    properties: Record<string, string>;
    line: number;
  }[];
  connections: { signal: string; from: string; to: string; method: string; line: number }[];
}

/** Parses `[tag a="b" c=Foo("x")]` attribute lists. */
export function parseAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i++;
    const keyMatch = /^[A-Za-z_][\w/]*/.exec(text.slice(i));
    if (!keyMatch) break;
    const key = keyMatch[0];
    i += key.length;
    if (text[i] !== '=') {
      attrs[key] = '';
      continue;
    }
    i++;
    const start = i;
    let depth = 0;
    let inString = false;
    for (; i < text.length; i++) {
      const ch = text[i]!;
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      else if (/\s/.test(ch) && depth === 0) break;
    }
    attrs[key] = text.slice(start, i);
  }
  return attrs;
}

export function unquote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').replace(/\\n/g, '\n');
  }
  return trimmed;
}

/** Splits a Godot resource text file into sections with raw property values. */
export function parseSections(text: string): ParsedSection[] {
  const lines = text.split(/\r?\n/);
  const sections: ParsedSection[] = [];
  let current: ParsedSection | null = null;
  let pendingKey: string | null = null;
  let pendingValue: string[] = [];
  let balance = 0;

  const measure = (s: string) => {
    let delta = 0;
    let inString = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (inString) {
        if (ch === '\\') i++;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '(' || ch === '[' || ch === '{') delta++;
      else if (ch === ')' || ch === ']' || ch === '}') delta--;
    }
    return { delta, inString };
  };

  lines.forEach((line, index) => {
    if (pendingKey && current) {
      pendingValue.push(line);
      balance += measure(line).delta;
      if (balance <= 0) {
        current.properties[pendingKey] = pendingValue.join('\n');
        pendingKey = null;
      }
      return;
    }
    const sectionMatch = /^\[([a-z_][a-z0-9_]*)\s*(.*)\]\s*$/.exec(line);
    if (sectionMatch) {
      current = {
        tag: sectionMatch[1]!,
        attrs: parseAttributes(sectionMatch[2] ?? ''),
        properties: {},
        line: index + 1,
      };
      sections.push(current);
      return;
    }
    if (!current) return;
    const propMatch = /^([A-Za-z_][\w/:.]*)\s*=\s*(.*)$/.exec(line);
    if (!propMatch) return;
    const value = propMatch[2]!;
    const m = measure(value);
    if (m.delta > 0 || m.inString) {
      pendingKey = propMatch[1]!;
      pendingValue = [value];
      balance = m.delta;
    } else {
      current.properties[propMatch[1]!] = value;
    }
  });
  return sections;
}

export function parseTscn(text: string): ParsedScene {
  const sections = parseSections(text);
  const scene: ParsedScene = {
    header: null,
    extResources: [],
    subResources: [],
    nodes: [],
    connections: [],
  };
  const extPaths = new Map<string, string>();
  for (const section of sections) {
    switch (section.tag) {
      case 'gd_scene':
      case 'gd_resource':
        scene.header = section;
        break;
      case 'ext_resource': {
        const id = unquote(section.attrs.id) ?? '';
        const path = unquote(section.attrs.path) ?? '';
        extPaths.set(id, path);
        scene.extResources.push({
          id,
          type: unquote(section.attrs.type) ?? '',
          path,
          line: section.line,
        });
        break;
      }
      case 'sub_resource':
        scene.subResources.push({
          id: unquote(section.attrs.id) ?? '',
          type: unquote(section.attrs.type) ?? '',
          line: section.line,
          properties: section.properties,
        });
        break;
      case 'node': {
        const name = unquote(section.attrs.name) ?? '';
        const parent = unquote(section.attrs.parent);
        const path = parent === undefined ? '.' : parent === '.' ? name : `${parent}/${name}`;
        const scriptRef = /ExtResource\(\s*"([^"]+)"\s*\)/.exec(
          section.properties.script ?? '',
        )?.[1];
        const instanceRef = /ExtResource\(\s*"([^"]+)"\s*\)/.exec(
          section.attrs.instance ?? '',
        )?.[1];
        const type = unquote(section.attrs.type);
        scene.nodes.push({
          name,
          ...(type ? { type } : {}),
          ...(parent !== undefined ? { parent } : {}),
          ...(instanceRef ? { instance: extPaths.get(instanceRef) ?? instanceRef } : {}),
          path,
          ...(scriptRef && extPaths.get(scriptRef) ? { script: extPaths.get(scriptRef)! } : {}),
          uniqueName: section.properties.unique_name_in_owner === 'true',
          properties: section.properties,
          line: section.line,
        });
        break;
      }
      case 'connection':
        scene.connections.push({
          signal: unquote(section.attrs.signal) ?? '',
          from: unquote(section.attrs.from) ?? '',
          to: unquote(section.attrs.to) ?? '',
          method: unquote(section.attrs.method) ?? '',
          line: section.line,
        });
        break;
      default:
        break;
    }
  }
  return scene;
}
