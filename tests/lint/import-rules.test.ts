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
  // The allowances below (fs/ for two features, ui/editor/ for one, Playwright and Vite for one
  // test) do not leak.
  ['app/src/features/editor/index.ts', "import { zip } from '../../fs/zip';"],
  ['app/src/features/find/index.ts', "import { editorUi } from '../../ui/editor/index';"],
  ['app/src/features/files/index.ts', "export { editorUi } from '../../ui/editor';"],
  ['app/src/core/documents/x.ts', "import { editorUi } from '../../ui/editor';"],
  ['app/src/features/filesystem/index.ts', "import { zip } from '../../fs/zip';"],
  ['app/src/features/files/index.ts', "import { pick } from '../files-fsaccess/pick';"],
  ['app/src/features/files/index.ts', "import { web } from '../../platform/web';"],
  ['app/src/engine/asm.test.ts', "import { chromium } from '@playwright/test';"],
  ['app/src/core/x.test.ts', "import { build } from 'vite';"],
  ['app/src/engine/browser.test.tsx', "import { build } from 'vite';"],
  ['app/src/engine/browser.ts', "import { build } from 'vite';"],
  ['app/src/engine/browser.test.ts', "import { x } from 'playwright-core';"],
  // The stage of additions (ARCHITECTURE-PLUS P2.4): each allowance below fails outside its place.
  ['app/src/ui/shell/Shell.tsx', "import { Layout } from 'flexlayout-react';"],
  ['app/src/state/dock.ts', "import { Model } from 'flexlayout-react';"],
  ['app/src/features/layout/index.ts', "import 'flexlayout-react/style/light.css';"],
  ['app/src/ui/components/x.test.ts', "import { Model } from 'flexlayout-react';"],
  ['app/src/features/files/index.ts', "import { MergeView } from '@codemirror/merge';"],
  ['app/src/ui/editor/compare.ts', "const m = () => import('@codemirror/merge');"],
  ['app/src/core/history/x.ts', "import { MergeView } from '@codemirror/merge';"],
  ['app/src/engine/sim.ts', "import { prune } from '../core/history/schedule';"],
  ['app/src/fs/vfs.ts', "import { x } from '../core/places/display';"],
  ['app/src/features/files/index.ts', "import { fonts } from '../../ui/editor/fonts';"],
  ['app/src/features/history/index.ts', "import { editorUi } from '../../ui/editor/index';"],
  ['app/src/features/history/index.ts', "import { theme } from '../../ui/editor/theme';"],
  ['app/src/ui/dock/DockWorkspace.tsx', "import { shell } from '../shell/Shell';"],
  ['app/src/ui/dock/DockWorkspace.tsx', "import { feature } from '../../features/files/index';"],
  ['app/src/ui/dock/DockWorkspace.tsx', "import { web } from '../../platform/web';"],
  ['app/src/ui/dock/DockWorkspace.tsx', "import { vfs } from '../../fs/vfs';"],
  ['app/src/ui/dock/DockWorkspace.tsx', "import lodash from 'lodash';"],
  ['app/src/features/layout/index.ts', "import { DockWorkspace } from '../../ui/dock/DockWorkspace';"],
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
  // features/files/ and features/files-fsaccess/ are the user-interface halves of fs/ (W3-layer-rule).
  ['app/src/features/files/export/zip-dialog.ts', "import { zip } from '../../../fs/zip';"],
  ['app/src/features/files-fsaccess/index.ts', "import { FsAccessBackend } from '../../fs/fsaccess-backend';"],
  // features/editor/ registers the editor component of ui/editor/ (E2-layer-rule).
  ['app/src/features/editor/index.ts', "import { editorUi } from '../../ui/editor/index';"],
  ['app/src/features/editor/ui-link.ts', "export { editorUi } from '../../ui/editor';"],
  // The engine binding's browser suite drives Playwright and builds with Vite (W4-config).
  [
    'app/src/engine/browser.test.ts',
    "import { chromium, type Page } from '@playwright/test';\nimport { build, type Plugin } from 'vite';",
  ],
  // The stage of additions (ARCHITECTURE-PLUS P2.4).
  [
    'app/src/ui/dock/DockWorkspace.tsx',
    "import { Layout, Model } from 'flexlayout-react';\nimport 'flexlayout-react/style/light.css';",
  ],
  ['app/src/ui/dock/model.test.ts', "import { Model } from 'flexlayout-react';\nimport { describe } from 'vitest';"],
  ['app/src/features/history/compare.ts', "export const load = () => import('@codemirror/merge');"],
  ['app/src/features/history/compare.test.ts', "import { MergeView } from '@codemirror/merge';"],
  [
    'app/src/fs/history-db.ts',
    "import { prune } from '../core/history/schedule';\nimport { x } from '../core/paths/winpath';",
  ],
  ['app/src/features/history/compare.ts', "import { editorFont } from '../../ui/editor/fonts';"],
  ['app/src/features/history/compare.ts', "import { editorFont } from '../../ui/editor/fonts.ts';"],
  [
    'app/src/ui/dock/DockWorkspace.tsx',
    "import type { AppContext } from '../../contracts';\nimport { readPlus } from '../../core/plus/settings';\nimport { dockOf } from '../../state/dock';\nimport { COMMAND_SPECS } from '../../commands/specs';\nimport { Button } from '../components/Button';\nimport { useState } from 'react';",
  ],
  [
    'app/src/ui/dock/DockWorkspace.tsx',
    "import { PanelRegion } from '../shell/PanelRegion';\nimport { useElementSize } from '../shell/SplitPane';",
  ],
  ['app/src/state/panels.ts', "import { dockOf } from './dock';"],
  ['app/src/features/viewer/index.ts', "import { dockOf } from '../../state/dock';"],
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
