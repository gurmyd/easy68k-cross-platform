// Self-test of the "easy68k/node-files" block of eslint.config.js: every script that runs under Node
// gets Node's globals (console, process, URL, Buffer), so that it lints without `/* global */`
// comments. Runs as part of `npm run lint` (vitest run --root tests/lint).
// (docs/requests/DV3-eslint-node-globals.md; written by the gate's configuration engineer.)
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
  it.each(NODE_FILES)(
    '%s may use console, process, URL and Buffer',
    async (file) => {
      expect(await undefinedNames(file, NODE_CODE)).toEqual([]);
    },
    30_000,
  );

  it('a check script in app/src gets no globals: it names those it uses in a /* global */ comment', async () => {
    const errors = await undefinedNames('app/src/features/x/check-x.mjs', NODE_CODE);
    expect(errors.length).toBe(4);
  }, 30_000);
});
