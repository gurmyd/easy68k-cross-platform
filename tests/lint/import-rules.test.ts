// Self-test of the layer rules in eslint.config.js (ARCHITECTURE.md 3.1):
// fixtures with forbidden imports must fail lint, allowed ones must pass.
// Runs as part of `npm run lint` (vitest run --root tests/lint).
//
// The fixtures are linted under virtual file names inside app/src, so the
// path-dependent rules apply exactly as they do to real files; nothing is
// written to app/src.

import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd: repo });

async function importErrors(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repo}/${file}` });
  if (!result) throw new Error('no lint result');
  return result.messages
    .filter(
      (m) =>
        m.ruleId === 'easy68k/layer-imports' ||
        m.ruleId === 'no-restricted-globals' ||
        m.ruleId === 'no-restricted-properties',
    )
    .map((m) => m.message);
}

/** [file, import statement] pairs that must be rejected. */
const FORBIDDEN: [string, string][] = [
  ['app/src/contracts/engine.ts', "import type { X } from '../core/x';"],
  ['app/src/contracts/engine.ts', "import type { Text } from '@codemirror/state';"],
  ['app/src/core/run/controller.ts', "import { useState } from 'react';"],
  ['app/src/core/run/controller.ts', "import { EditorView } from '@codemirror/view';"],
  ['app/src/core/run/controller.ts', "import { store } from '../../state/store';"],
  ['app/src/core/run/controller.ts', "import { asm } from '../../engine/asm';"],
  ['app/src/core/sim-host/surface/index.ts', "import { x } from '../../../ui/components/Button';"],
  ['app/src/core/x.ts', "import { readFile } from 'node:fs';"],
  ['app/src/engine/sim.ts', "import { codec } from '../core/codec/cp1252';"],
  ['app/src/engine/sim.ts', "import x from '../../../tools/build-info.mjs';"],
  ['app/src/fs/vfs.ts', "import { settings } from '../core/settings/defaults';"],
  ['app/src/fs/vfs.ts', "import { store } from '../state/store';"],
  ['app/src/features/editor/index.ts', "import { find } from '../find/index';"],
  ['app/src/features/editor/panel/View.tsx', "import { find } from '../../find';"],
  ['app/src/features/editor/index.ts', "import { shell } from '../../ui/shell/Shell';"],
  ['app/src/features/editor/index.ts', "import { web } from '../../platform/web';"],
  ['app/src/ui/shell/Shell.tsx', "import { editor } from '../../features/editor/index';"],
  ['app/src/ui/components/Button.tsx', "import lodash from 'lodash';"],
  // Paths that are not in normal form are judged by where they point.
  ['app/src/core/x.ts', "import { s } from './../state/store';"],
  ['app/src/core/run/controller.ts', "import { s } from '../run/../../state/store';"],
  ['app/src/features/a/f.ts', "import { z } from '../../core/../features/b/z';"],
  ['app/src/features/a/f.ts', "import { z } from './../b/z';"],
  ['app/src/ui/shell/Shell.tsx', "import { e } from '../../features/./editor/index';"],
  ['app/src/contracts/engine.ts', "import type { X } from './../core/x';"],
  // Other import forms.
  ['app/src/core/x.ts', "export { y } from '../state/store';"],
  ['app/src/core/x.ts', "export * from '../state/store';"],
  ['app/src/core/x.ts', "export const m = () => import('../state/store');"],
  ['app/src/core/x.ts', "export type T = import('../state/store').Store;"],
  ['app/src/engine/sim.ts', "import x from '../../../engine/dist/sub/x.mjs';"],
  ['app/src/main.tsx', "import x from '/src/x';"],
];

/** [file, code] pairs that must pass. */
const ALLOWED: [string, string][] = [
  ['app/src/contracts/index.ts', "export type { Bytes } from './engine';"],
  [
    'app/src/core/run/controller.ts',
    "import type { Bytes } from '../../contracts/engine';\nimport { Text } from '@codemirror/state';\nimport { x } from '../listing/view';\nimport { y } from './clock';",
  ],
  ['app/src/core/x.ts', "import type { Bytes } from '../contracts';"],
  [
    'app/src/engine/sim.ts',
    "import type { Bytes } from '../contracts';\nimport loader from '../../../engine/dist/sim68k-loader.mjs';\nimport { Reg } from '../../../engine/sim/sim68k.mjs';",
  ],
  [
    'app/src/fs/sync/memory.ts',
    "import { toWinPath } from '../../core/paths/winpath';\nimport { decode } from '../../core/codec/cp1252';\nimport type { Bytes } from '../../contracts';",
  ],
  [
    'app/src/features/editor/index.ts',
    "import { x } from '../../core/documents';\nimport { s } from '../../state/store';\nimport { c } from '../../commands/registry';\nimport { Button } from '../../ui/components/Button';\nimport { y } from './panel/View';\nimport { useState } from 'react';",
  ],
  [
    'app/src/ui/shell/Shell.tsx',
    "import { features } from '../../features';\nimport { more } from '../../features/index';\nimport { Button } from '../components/Button';",
  ],
  [
    'app/src/core/run/controller.test.ts',
    "import { describe } from 'vitest';\nimport { readFileSync } from 'node:fs';\nimport { createTestEngine } from '../../engine/testing';",
  ],
];

describe('layer rules of ARCHITECTURE.md 3.1', () => {
  it.each(FORBIDDEN)('%s rejects %s', async (file, code) => {
    expect(await importErrors(file, `${code}\nexport {};\n`)).not.toEqual([]);
  });

  it.each(ALLOWED)('%s accepts %s', async (file, code) => {
    expect(await importErrors(file, `${code}\nexport {};\n`)).toEqual([]);
  });

  it('core/ may not use DOM globals, timers or Date.now()', async () => {
    const errors = await importErrors(
      'app/src/core/run/clock.ts',
      'export const a = () => [window.innerWidth, setTimeout(() => 0, 1), Date.now(), performance.now()];\n',
    );
    expect(errors.length).toBe(4);
  });
});
