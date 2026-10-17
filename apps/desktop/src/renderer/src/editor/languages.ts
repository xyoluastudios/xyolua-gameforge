import { json } from '@codemirror/lang-json';
import { StreamLanguage, type StringStream, type StreamParser } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

const GD_KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'for',
  'while',
  'match',
  'when',
  'break',
  'continue',
  'pass',
  'return',
  'class',
  'class_name',
  'extends',
  'is',
  'in',
  'as',
  'self',
  'signal',
  'func',
  'static',
  'const',
  'enum',
  'var',
  'await',
  'preload',
  'load',
  'and',
  'or',
  'not',
  'super',
  'void',
  'breakpoint',
  'assert',
  'yield',
]);
const GD_ATOMS = new Set(['true', 'false', 'null', 'PI', 'TAU', 'INF', 'NAN']);
const GD_TYPES =
  /^(?:int|float|bool|String|StringName|NodePath|Vector[234]i?|Rect2i?|Transform[23]D|Basis|Quaternion|Plane|AABB|Color|RID|Object|Callable|Signal|Dictionary|Array|Packed\w+Array|Variant|[A-Z][A-Za-z0-9]*(?:2D|3D)?)$/;

interface GdState {
  inString: string | null;
  tripleString: boolean;
}

/** Consumes string content until the closing quote (or end of line for normal strings). */
function readString(stream: StringStream, state: GdState): string {
  const quote = state.inString ?? '"';
  if (state.tripleString) {
    while (!stream.eol()) {
      if (stream.match(quote.repeat(3))) {
        state.inString = null;
        state.tripleString = false;
        return 'string';
      }
      if (stream.next() === '\\') stream.next();
    }
    return 'string';
  }
  while (!stream.eol()) {
    const ch = stream.next();
    if (ch === '\\') stream.next();
    else if (ch === quote) break;
  }
  // Single-line strings never continue on the next line.
  state.inString = null;
  return 'string';
}

const gdscriptParser: StreamParser<GdState> = {
  name: 'gdscript',
  startState: () => ({ inString: null, tripleString: false }),
  token(stream, state) {
    if (state.inString) return readString(stream, state);
    if (stream.eatSpace()) return null;
    if (stream.match('##')) {
      stream.skipToEnd();
      return 'docComment';
    }
    if (stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^@[A-Za-z_]\w*/)) return 'meta';
    if (stream.match(/^(?:"""|''')/)) {
      state.inString = stream.current()[0]!;
      state.tripleString = true;
      return readString(stream, state);
    }
    if (stream.match(/^[&^]?["']/)) {
      state.inString = stream.current().slice(-1);
      return readString(stream, state);
    }
    if (stream.match(/^\$[A-Za-z_%"][\w/%"]*/) || stream.match(/^%[A-Za-z_]\w*/))
      return 'labelName';
    if (stream.match(/^(?:0x[0-9a-fA-F_]+|0b[01_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:e[+-]?\d+)?)/))
      return 'number';
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const word = stream.current();
      if (GD_KEYWORDS.has(word)) return 'keyword';
      if (GD_ATOMS.has(word)) return 'atom';
      if (stream.match(/^\s*\(/, false)) return 'variableName.function';
      if (GD_TYPES.test(word)) return 'typeName';
      return 'variableName';
    }
    if (stream.match(/^(?:->|:=|==|!=|<=|>=|&&|\|\||\*\*|<<|>>|[-+*/%=<>!&|^~])/))
      return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '#' }, indentOnInput: /^\s*(?:elif|else)\b/ },
};

/** Godot text resources (.tscn, .tres, project.godot, .import, .cfg). */
const godotResourceParser: StreamParser<{ value: boolean }> = {
  name: 'godot-resource',
  startState: () => ({ value: false }),
  token(stream, state) {
    if (stream.sol()) state.value = false;
    if (stream.eatSpace()) return null;
    if (stream.peek() === ';') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.sol() && stream.peek() === '[') {
      stream.skipToEnd();
      return 'heading';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/)) return 'number';
    if (stream.match(/^(?:true|false|null)\b/)) return 'atom';
    if (!state.value && stream.match(/^[\w/.:]+(?=\s*=)/)) return 'propertyName';
    if (stream.eat('=')) {
      state.value = true;
      return 'operator';
    }
    if (stream.match(/^[A-Z][A-Za-z0-9]*(?=\()/)) return 'typeName';
    stream.next();
    return null;
  },
};

export function languageFor(path: string): Extension[] {
  const lower = path.toLowerCase();
  if (lower.endsWith('.gd') || lower.endsWith('.gdshader') || lower.endsWith('.gdshaderinc'))
    return [StreamLanguage.define(gdscriptParser)];
  if (lower.endsWith('.json')) return [json()];
  if (/\.(tscn|tres|godot|import|cfg)$/.test(lower))
    return [StreamLanguage.define(godotResourceParser)];
  return [];
}

/** Exposed for tests. */
export const parsers = { gdscript: gdscriptParser };
