// Removes build output and caches (keeps node_modules). Usage: pnpm clean
import { rmSync } from 'node:fs';

const targets = [
  'packages/core/dist',
  'packages/godot/dist',
  'packages/cli/dist',
  'packages/mcp/dist',
  'apps/desktop/out',
  'apps/desktop/release',
  'apps/desktop/test-results',
  'coverage',
];
for (const target of targets) rmSync(target, { recursive: true, force: true });
console.log(`Removed ${targets.length} build folders.`);
