import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

/** Workspace packages resolve to their TypeScript sources, so tests never depend on a prior build. */
const alias = {
  '@gameforge/core': src('core'),
  '@gameforge/godot': src('godot'),
  '@gameforge/mcp': src('mcp'),
};

const nodeProject = (name: string) => ({
  resolve: { alias },
  test: {
    name,
    root: `./packages/${name}`,
    include: ['test/**/*.test.ts'],
    environment: 'node' as const,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

export default defineConfig({
  test: {
    projects: [
      nodeProject('core'),
      nodeProject('godot'),
      nodeProject('cli'),
      nodeProject('mcp'),
      './apps/desktop',
    ],
  },
});
