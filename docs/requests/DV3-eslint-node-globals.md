# DV3: Node globals for desktop/**/*.{js,mjs}

Status: open (optional; DV3 works without it)

From: DV3 (macOS packaging and release). For: the gate (owner of `eslint.config.js`, W0 > gates).

## What

In `eslint.config.js`, the block that gives `globals.node` to Node-only files lists
`'desktop/**/*.{ts,mts}'`. Change that one entry to:

```js
      'desktop/**/*.{ts,mts,js,mjs}',
```

## Why

`desktop/scripts/*.mjs` (electron-builder's afterPack hook and the release tools) run under Node
only, like `desktop/src`. Without the change, `console` and `process` in them fail `no-undef`. DV3
works around it by importing them (`import console from 'node:console'`, `import process from
'node:process'`) in `after-pack.mjs`, `packaging.mjs` and `release.mjs`; with the change those
imports can go (docs/porting/errata/DV3.md entry 18). The first version of DV3 made this change in
the frozen file itself; it was reverted after review.

## Test

The first version of DV3 also left an untracked self-test at `tests/lint/node-globals.test.ts`
(gate path; it fails `npm run lint` while `eslint.config.js` is unchanged). It is removed from the
working tree; if the gate applies the change above, it can add the test as it was:

```ts
// Self-test of the "easy68k/node-files" block of eslint.config.js: every script that runs under Node
// gets Node's globals (console, process, URL, Buffer), so that it lints without `/* global */`
// comments. Runs as part of `npm run lint` (vitest run --root tests/lint).
//
// The fixtures are linted under virtual file names; nothing is written to those folders.

import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const eslint = new ESLint({ cwd: repo });

async function undefinedNames(file: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: `${repo}/${file}` });
  if (!result) throw new Error('no lint result');
  return result.messages.filter((m) => m.ruleId === 'no-undef' || m.fatal).map((m) => m.message);
}

const NODE_CODE = 'console.log(process.argv, new URL("file:///x"), Buffer.alloc(1));\nexport {};\n';

/**
 * JavaScript files that run under Node, one per folder pattern of the node-files block. (In .ts
 * files typescript-eslint turns no-undef off and the type checker reports unknown names instead.)
 */
const NODE_FILES = [
  'x-root-script.mjs',
  'tools/x-tool.mjs',
  'app/x.config.mjs',
  'tests/x/x-script.mjs',
  // DV3's packaging scripts (electron-builder hooks, release tools; ARCHITECTURE.md 8, DV3).
  'desktop/scripts/x-after-pack.mjs',
  'desktop/scripts/x-release.js',
];

describe('Node globals in Node scripts (eslint.config.js, easy68k/node-files)', () => {
  it.each(NODE_FILES)('%s may use console, process, URL and Buffer', async (file) => {
    expect(await undefinedNames(file, NODE_CODE)).toEqual([]);
  });

  it('a check script in app/src gets no globals: it names those it uses in a /* global */ comment', async () => {
    const errors = await undefinedNames('app/src/features/x/check-x.mjs', NODE_CODE);
    expect(errors.length).toBe(4);
  });
});
```
