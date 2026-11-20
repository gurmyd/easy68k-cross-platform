// Vite configuration of the web application (ARCHITECTURE.md 7.2, 7.6).
// Shared configuration: written in wave 0, changed only at an integration gate.

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error -- plain JavaScript module without type declarations
import { writeBuildInfo } from '../tools/build-info.mjs';
// @ts-expect-error -- plain JavaScript module without type declarations
import { cspPlugin } from '../tools/vite-csp-plugin.mjs';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const engineDist = fileURLToPath(new URL('../engine/dist/', import.meta.url));

/** Regenerates app/src/build-info.ts at dev-server start and at build start. */
function buildInfoPlugin(): Plugin {
  return {
    name: 'easy68k-build-info',
    buildStart() {
      writeBuildInfo();
    },
    configureServer() {
      if (!process.env.VITEST && !existsSync(engineDist)) {
        console.warn(
          '\n  engine/dist/ is missing: the engines are not built. Run `npm run build:engines`' +
            ' (needs Emscripten) or `npm run fetch:engines`.\n',
        );
      }
    },
  };
}

export default defineConfig({
  root: appDir,
  // Relative asset URLs: the same build works at the site root, under the
  // Pages sub-path and under the desktop app's app:// protocol. EASY68K_BASE
  // overrides it (for example "/easy68k-mac/").
  base: process.env.EASY68K_BASE ?? './',
  publicDir: 'public',
  plugins: [react(), buildInfoPlugin(), cspPlugin() as Plugin],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2023',
    sourcemap: true,
  },
  // 127.0.0.1, not localhost: with localhost Node binds whichever address the
  // resolver lists first (::1 in many containers), and clients that try only
  // IPv4 then cannot connect.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
