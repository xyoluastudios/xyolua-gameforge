import { StringStream } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { parsers } from '../src/editor/languages';

function tokenize(line: string): [string, string | null][] {
  const parser = parsers.gdscript;
  const state = parser.startState!(4);
  const stream = new StringStream(line, 4, 4);
  const tokens: [string, string | null][] = [];
  while (!stream.eol()) {
    const style = parser.token(stream, state);
    tokens.push([stream.current(), style]);
    stream.start = stream.pos;
  }
  return tokens.filter(([text]) => text.trim() !== '');
}

describe('GDScript highlighting', () => {
  it('recognizes keywords, annotations, strings, numbers, node paths and comments', () => {
    const tokens = tokenize('@onready var speed := 4.5 # walk speed');
    expect(tokens).toContainEqual(['@onready', 'meta']);
    expect(tokens).toContainEqual(['var', 'keyword']);
    expect(tokens).toContainEqual(['4.5', 'number']);
    expect(tokens).toContainEqual(['# walk speed', 'comment']);
    expect(tokenize('var head = $Head/Camera3D')).toContainEqual(['$Head/Camera3D', 'labelName']);
    expect(tokenize('print("say \\"hi\\"")')).toContainEqual(['"say \\"hi\\""', 'string']);
    expect(tokenize('func _ready() -> void:')).toContainEqual(['_ready', 'variableName.function']);
    expect(tokenize('extends CharacterBody3D')).toContainEqual(['CharacterBody3D', 'typeName']);
    expect(tokenize('## Doc comment')).toContainEqual(['## Doc comment', 'docComment']);
  });
});
