import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@gameforge/core': resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  test: {
    name: 'desktop',
    environment: 'jsdom',
    include: ['src/renderer/test/**/*.test.{ts,tsx}'],
    setupFiles: ['src/renderer/test/setup.ts'],
  },
});
