import { PassThrough } from 'node:stream';
import { GameForge } from '@gameforge/core';
import { createGodotPlugin } from '@gameforge/godot';
import { describe, expect, it } from 'vitest';
import { McpServer, type JsonRpcResponse } from '../src/server.js';
import { tempDir, writeFiles } from '../../core/test/helpers.js';

async function setup(allowWrite: boolean) {
  const root = tempDir('gf-mcp-');
  writeFiles(root, {
    'project.godot':
      'config_version=5\n\n[application]\n\nconfig/name="MCP Game"\nrun/main_scene="res://main.tscn"\n',
    'main.tscn': '[gd_scene format=3]\n\n[node name="Main" type="Node2D"]\n',
    'player.gd': 'extends Node2D\n\nvar speed := 3.0\n',
    '.env': 'ANTHROPIC_API_KEY=sk-ant-secret',
  });
  const app = await GameForge.create({
    configDir: tempDir(),
    env: { PATH: '', AI_PROVIDER: 'mock' },
    logToFile: false,
    builtinPlugins: [createGodotPlugin({ env: { PATH: '' } })],
  });
  const server = new McpServer({
    app,
    projectRoot: root,
    createRoot: tempDir('gf-mcp-create-'),
    allowWrite,
  });
  let id = 0;
  const call = async (method: string, params?: Record<string, unknown>) =>
    (await server.handle({
      jsonrpc: '2.0',
      id: ++id,
      method,
      ...(params ? { params } : {}),
    })) as JsonRpcResponse;
  await call('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '1' },
  });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return { root, server, call };
}

const text = (response: JsonRpcResponse) =>
  (response.result as { content: { text: string }[] }).content[0]!.text;

describe('MCP server', () => {
  it('negotiates the protocol and lists read-only tools by default', async () => {
    const { call, server } = await setup(false);
    const init = (await server.handle({
      jsonrpc: '2.0',
      id: 99,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' },
    }))!;
    expect(init.result).toMatchObject({
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'xyolua-gameforge' },
      capabilities: { tools: {} },
    });
    const list = await call('tools/list');
    const names = (
      list.result as { tools: { name: string; inputSchema: { type: string } }[] }
    ).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(['read_file', 'list_files', 'analyze_project', 'project_info']),
    );
    expect(names).not.toContain('write_file');
    expect(names).not.toContain('create_game_project');
    expect((await call('ping')).result).toEqual({});
    expect((await call('does/not/exist')).error?.code).toBe(-32601);
  });

  it('reads files through the sandbox and never exposes secrets', async () => {
    const { call } = await setup(false);
    const read = await call('tools/call', { name: 'read_file', arguments: { path: 'player.gd' } });
    expect(text(read)).toContain('var speed := 3.0');
    const secret = await call('tools/call', { name: 'read_file', arguments: { path: '.env' } });
    expect((secret.result as { isError: boolean }).isError).toBe(true);
    expect(text(secret)).not.toContain('sk-ant-secret');
    const escape = await call('tools/call', {
      name: 'read_file',
      arguments: { path: '../../etc/passwd' },
    });
    expect(text(escape)).toContain('outside the project');
    const write = await call('tools/call', {
      name: 'write_file',
      arguments: { path: 'x.gd', content: 'x' },
    });
    expect(write.error?.message).toContain('requires write access');
    const invalid = await call('tools/call', { name: 'read_file', arguments: {} });
    expect(text(invalid)).toContain('Invalid arguments');
  });

  it('analyzes the project', async () => {
    const { call } = await setup(false);
    const analysis = await call('tools/call', { name: 'analyze_project', arguments: {} });
    expect(text(analysis)).toContain('Project: MCP Game');
  });

  it('writes files and scaffolds new projects when write access is enabled', async () => {
    const { call, root } = await setup(true);
    const edit = await call('tools/call', {
      name: 'edit_file',
      arguments: { path: 'player.gd', old_string: '3.0', new_string: '6.0' },
    });
    expect(text(edit)).toContain('Edited player.gd');
    const { offlinePlan } = await import('@gameforge/core');
    const created = await call('tools/call', {
      name: 'create_game_project',
      arguments: { plan: offlinePlan('a 2d dungeon with keys'), folder_name: 'mcp-dungeon' },
    });
    expect(text(created)).toMatch(/Created \d+ files/);
    expect(text(created)).toContain('mcp-dungeon');
    void root;
  });

  it('speaks newline-delimited JSON-RPC over streams', async () => {
    const { server } = await setup(false);
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on('data', (c: Buffer) => chunks.push(c.toString()));
    const done = server.serve(input, output);
    input.write('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
    input.write('not json\n');
    await new Promise((r) => setTimeout(r, 50));
    input.end();
    await done;
    const lines = chunks
      .join('')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as JsonRpcResponse);
    expect(lines).toContainEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(lines.some((l) => l.error?.code === -32700)).toBe(true);
  });
});
