// ESLint configuration (flat config). Shared configuration: written in wave 0,
// changed only at an integration gate (ARCHITECTURE.md 8).
//
// The important part is the layer rules of ARCHITECTURE.md 3.1, enforced by the
// local rule `easy68k/layer-imports` defined below:
//
//   contracts/          imports nothing
//   core/               contracts/ and @codemirror/state only; no DOM globals,
//                       no timers, no Date.now() (use the injected Clock/Scheduler)
//   engine/             contracts/ and the two engine modules (engine/dist, engine/asm, engine/sim)
//   fs/                 contracts/, core/paths, core/codec
//   features/<x>/       contracts/, core/, state/, commands/, ui/components/;
//                       never another feature by path; features/files/ and
//                       features/files-fsaccess/ also fs/; features/editor/
//                       also ui/editor/
//   ui/shell/           features only through features/index.ts
//   everywhere in app/src: npm packages only from the closed runtime list of 3.1
//
// The rule resolves every relative specifier against the importing file and
// judges the folder it lands in, so `./../state/x`, `../../core/../features/b`
// and a feature importing its own folder as `../<own>/x` are all judged by
// where they really point. It covers `import`, `import type`, `export ... from`
// and `import('...')` with a literal. A Vite query (`?url`, `?raw`) is ignored.
//
// Unit tests (*.test.ts, *.test.tsx) may import across layers (a core test may
// use the engine's test helpers, 6.4) and may use test libraries and node:*;
// app/src/engine/browser.test.ts alone may also use @playwright/test and vite.
// tests/lint/import-rules.test.ts checks that forbidden imports fail and
// allowed ones pass.

import { dirname, posix, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import globals from 'globals';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const REPO = dirname(fileURLToPath(import.meta.url));
const SRC = 'app/src';
const TEST_FILES = [`${SRC}/**/*.test.{ts,tsx}`];
const DOC = '(ARCHITECTURE.md 3.1)';

/** Runtime dependencies of the web application (3.1); subpaths are allowed too. */
const RUNTIME_PACKAGES = [
  'react',
  'react-dom',
  '@codemirror/state',
  '@codemirror/view',
  '@codemirror/commands',
  '@codemirror/search',
];
const isTestPackage = (name) => name === 'vitest' || name === 'fake-indexeddb' || name.startsWith('node:');
/**
 * Extra npm packages for single test files, by path from the repository. The engine binding's
 * browser suite builds the binding with Vite and drives Chromium and WebKit with Playwright
 * (docs/requests/W4-config.md); no other unit test may import them.
 */
const TEST_FILE_PACKAGES = {
  [`${SRC}/engine/browser.test.ts`]: ['@playwright/test', 'vite'],
};
/** Features that are the user-interface halves of their own fs/ backends and may import fs/ (W3-layer-rule). */
const FS_FEATURES = ['files', 'files-fsaccess'];
/** The feature that registers the editor component of ui/editor/ and alone may import it (E2-layer-rule). */
const EDITOR_FEATURES = ['editor'];

/** `name` is `pkg` or a subpath of it. */
const isPackage = (name, pkg) => name === pkg || name.startsWith(`${pkg}/`);
/** `path` (relative to app/src) is `folder` or inside it. */
const within = (path, folder) => path === folder || path.startsWith(`${folder}/`);
const withinAny = (path, folders) => folders.some((folder) => within(path, folder));

/**
 * The layer of a file, from its path relative to app/src: its root folder,
 * the src-level folders it may import besides its own, and its npm packages.
 * `undefined` for files outside the layers of 3.1 (state/, commands/,
 * ui/components/, platform/, main.tsx, ...): they only keep the runtime list.
 */
function layerOf(file) {
  const [first, second] = file.split('/');
  switch (first) {
    case 'contracts':
      return { name: 'contracts/', root: 'contracts', allowed: [], packages: [] };
    case 'core':
      return { name: 'core/', root: 'core', allowed: ['contracts'], packages: ['@codemirror/state'] };
    case 'engine':
      return { name: 'engine/', root: 'engine', allowed: ['contracts'], packages: [], engineModules: true };
    case 'fs':
      return { name: 'fs/', root: 'fs', allowed: ['contracts', 'core/paths', 'core/codec'], packages: [] };
    case 'features':
      if (second === undefined || !file.includes('/', 'features/'.length)) return undefined; // features/index.ts
      return {
        name: 'features/<x>/',
        root: `features/${second}`,
        allowed: [
          'contracts',
          'core',
          'state',
          'commands',
          'ui/components',
          ...(FS_FEATURES.includes(second) ? ['fs'] : []),
          ...(EDITOR_FEATURES.includes(second) ? ['ui/editor'] : []),
        ],
        packages: RUNTIME_PACKAGES,
        feature: true,
      };
    case 'ui':
      if (second !== 'shell') return undefined;
      return { name: 'ui/shell/', root: 'ui/shell', packages: RUNTIME_PACKAGES, shell: true };
    default:
      return undefined;
  }
}

/** The message for `spec` imported by `file` (relative to the repository), or null. */
function checkImport(fileFromRepo, spec, isTest) {
  const file = fileFromRepo.slice(SRC.length + 1); // relative to app/src
  const layer = isTest ? undefined : layerOf(file);
  const clean = spec.replace(/\?.*$/, '');

  // npm packages
  if (!clean.startsWith('.') && !clean.startsWith('/')) {
    const allowed = layer ? layer.packages : RUNTIME_PACKAGES;
    if (allowed.some((pkg) => isPackage(clean, pkg))) return null;
    if (isTest && isTestPackage(clean)) return null;
    if (isTest && (TEST_FILE_PACKAGES[fileFromRepo] ?? []).some((pkg) => isPackage(clean, pkg))) return null;
    if (isTest) return 'unit tests may import the runtime dependencies, vitest, fake-indexeddb and node:*';
    if (!layer) return `app/src may import only the runtime dependencies of ${DOC}`;
    if (layer.packages.length === 0) {
      return layer.engineModules
        ? `engine/ may import only contracts/ and the two engine modules ${DOC}`
        : `${layer.name} may not import npm packages ${DOC}`;
    }
    return `${layer.name} may import only ${layer.packages.join(', ')} from npm ${DOC}`;
  }
  if (clean.startsWith('/')) return `imports in app/src are relative paths, not absolute ones ${DOC}`;
  if (isTest || !layer) return null;

  // Relative path: resolve it and judge where it lands.
  const target = posix.normalize(posix.join(posix.dirname(fileFromRepo), clean));
  if (!within(target, SRC)) {
    if (layer.engineModules && /^engine\/(?:dist|asm|sim)\/[^/]+$/.test(target)) return null;
    return `${layer.name} may not import from outside app/src${layer.engineModules ? ' except the engine modules' : ''} ${DOC}`;
  }
  const to = target === SRC ? '' : target.slice(SRC.length + 1);
  if (within(to, layer.root)) return null; // its own folder, however the path is spelled

  if (layer.shell) {
    if (within(to, 'features') && to !== 'features' && !/^features\/index(?:\.tsx?)?$/.test(to)) {
      return `ui/shell/ imports features only through features/index.ts ${DOC}`;
    }
    return null;
  }
  if (layer.feature && within(to, 'features')) {
    return `features/<x>/ may not import another feature by path; use the AppContext services (3.12.3) ${DOC}`;
  }
  if (withinAny(to, layer.allowed)) return null;
  return `${layer.name} may import only ${
    layer.allowed.length ? layer.allowed.map((name) => `${name}/`).join(', ') : 'its own files'
  }${layer.engineModules ? ' and the engine modules' : ''} ${DOC}`;
}

/** The local plugin with the layer rule. */
const easy68k = {
  meta: { name: 'easy68k' },
  rules: {
    'layer-imports': {
      meta: {
        type: 'problem',
        docs: { description: 'Enforce the layer rules of ARCHITECTURE.md 3.1' },
        schema: [],
      },
      create(context) {
        const fromRepo = relative(REPO, context.filename).split('\\').join('/');
        if (!fromRepo.startsWith(`${SRC}/`)) return {};
        const isTest = /\.test\.tsx?$/.test(fromRepo);
        const check = (source) => {
          if (!source || source.type !== 'Literal' || typeof source.value !== 'string') return;
          const message = checkImport(fromRepo, source.value, isTest);
          if (message) context.report({ node: source, message: `'${source.value}': ${message}` });
        };
        return {
          ImportDeclaration: (node) => check(node.source),
          ExportNamedDeclaration: (node) => check(node.source),
          ExportAllDeclaration: (node) => check(node.source),
          ImportExpression: (node) => check(node.source),
          // `import('x').T` in a type; typescript-eslint 8 calls the literal `source`.
          TSImportType: (node) => check(node.source),
        };
      },
    },
  },
};

const CORE_GLOBALS = [
  'window',
  'document',
  'navigator',
  'performance',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'XMLHttpRequest',
  'AudioContext',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'requestIdleCallback',
  'process',
  'Buffer',
].map((name) => ({
  name,
  message: `core/ runs under Node and in the browser without DOM or timers: use the injected Clock, Scheduler or service (ARCHITECTURE.md 0 rule 5, 3.1)`,
}));

export default defineConfig(
  {
    name: 'easy68k/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'reference/**',
      '.toolchain/**',
      'build/**',
      'engine/**',
      'app/public/**',
      'app/src/build-info.ts',
      'desktop/release/**',
      // Moved verbatim from build/oracle by W0 (toolchain.md 9); T1 owns it.
      'tests/oracle/asm-cli/run-asy68k.mjs',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'easy68k/base',
    languageOptions: { ecmaVersion: 2023, sourceType: 'module' },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    name: 'easy68k/node-files',
    files: [
      '*.{js,mjs}',
      'tools/**/*.{js,mjs}',
      '**/*.config.{ts,mts,js,mjs}',
      'tests/**/*.{ts,mts,js,mjs}',
      'desktop/**/*.{ts,mts}',
    ],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    name: 'easy68k/browser-files',
    files: [`${SRC}/**/*.{ts,tsx}`],
    languageOptions: { globals: { ...globals.browser } },
  },

  // --- Layer rules of 3.1 ---------------------------------------------------
  {
    name: 'easy68k/layers',
    files: [`${SRC}/**/*.{ts,tsx,mts}`],
    plugins: { easy68k },
    rules: { 'easy68k/layer-imports': 'error' },
  },
  {
    name: 'easy68k/layers/core-globals',
    files: [`${SRC}/core/**/*.{ts,tsx,mts}`],
    ignores: TEST_FILES,
    rules: {
      'no-restricted-globals': ['error', ...CORE_GLOBALS],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'core/ reads time only through the injected Clock (ARCHITECTURE.md 3.11.1)',
        },
      ],
    },
  },
);
