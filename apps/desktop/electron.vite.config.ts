import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const pkg = (name: string) => resolve(__dirname, `../../packages/${name}/src/index.ts`);

/** Workspace packages are bundled from source (no separate build step needed). */
const alias = {
  '@gameforge/core': pkg('core'),
  '@gameforge/godot': pkg('godot'),
  '@shared': resolve(__dirname, 'src/shared'),
};

/** Strict Content-Security-Policy for production builds (dev needs Vite's inline HMR preamble). */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'gameforge-csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) return html;
        const csp = [
          "default-src 'self'",
          "script-src 'self'",
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          "connect-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ');
        return html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
        );
      },
    },
  };
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias },
    build: {
      externalizeDeps: true,
      // Sandboxed preload scripts must be CommonJS.
      rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    resolve: { alias },
    plugins: [react(), contentSecurityPolicy()],
  },
});
