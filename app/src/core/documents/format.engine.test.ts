// editor-ui §20.2: "A file with bytes 0x80-0xFF inside a DC.B string assembles to the same S-record
// bytes after an open/save round trip", with the real assembler (engine/dist). Skipped when the
// engines are not built; fails instead when EASY68K_REQUIRE_ENGINES=1 (CI).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TabType, type DocumentState } from '../../contracts';
import { createAsmEngine } from '../../engine/index';
import { TEST_ASM_OPTIONS, TEST_ASM_TIME } from '../../engine/testing';
import { decodeFile, encodeFile, encodeForAssembler, stripTrailer } from './format';

const repo = (file: string) => fileURLToPath(new URL(`../../../../${file}`, import.meta.url));
const asmBuilt = existsSync(repo('engine/dist/asm68k.wasm')) && existsSync(repo('engine/dist/asm68k-loader.mjs'));
/** With EASY68K_REQUIRE_ENGINES=1 (CI) a missing engine/dist fails instead of skipping. */
const enginesRequired = process.env.EASY68K_REQUIRE_ENGINES === '1';

const DEFAULTS = { fontName: 'Courier New', fontSize: 10, tabType: TabType.Fixed, tabSize: 4 };
const doc: DocumentState = {
  id: 'd',
  path: '/browser/high.X68',
  name: 'high.X68',
  kind: 'source',
  hasName: true,
  ...DEFAULTS,
  insertMode: true,
  modified: false,
  revision: 0,
};

/** A program with every byte $80-$FF inside DC.B strings (the quote $27 is below $80). */
function highBytesProgram(): Uint8Array {
  const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
  const out: number[] = [...ascii('    ORG    $1000\r\nSTART:\r\n')];
  for (let start = 0x80; start <= 0xff; start += 16) {
    const chunk = Array.from({ length: 16 }, (_, i) => start + i);
    out.push(...ascii("    DC.B   '"), ...chunk, ...ascii("'\r\n"));
  }
  out.push(...ascii('    SIMHALT\r\n    END    START\r\n'));
  return Uint8Array.from(out);
}

describe('round trip through the editor and the real assembler (§20.2)', () => {
  it.runIf(enginesRequired && !asmBuilt)('engine/dist holds the assembler (EASY68K_REQUIRE_ENGINES=1)', () => {
    expect.fail('EASY68K_REQUIRE_ENGINES is 1 but engine/dist/asm68k.wasm or asm68k-loader.mjs is missing');
  });

  it.skipIf(!asmBuilt)(
    'bytes $80-$FF in DC.B strings assemble to the same S-record after open and save (needs engine/dist)',
    async () => {
      const asm = await createAsmEngine();
      const assemble = async (source: Uint8Array) => {
        const result = await asm.assemble('high.X68', new Map([['high.X68', source]]), TEST_ASM_OPTIONS, TEST_ASM_TIME);
        expect(result.fatal).toBeNull();
        expect(result.errorCount).toBe(0);
        return result.sRecord;
      };
      const original = highBytesProgram();
      const before = await assemble(original);

      // Open, save, open again: what the assembler receives each time.
      const first = stripTrailer(decodeFile(original), DEFAULTS);
      const saved = encodeFile(doc, first.text);
      const second = stripTrailer(decodeFile(saved), DEFAULTS);
      const after = await assemble(encodeForAssembler(second.text));

      expect(before).not.toBeNull();
      expect(Array.from(after ?? [])).toEqual(Array.from(before ?? []));
      // The S-record really holds the high bytes.
      const text = String.fromCharCode(...(before ?? []));
      expect(text).toContain('808182838485868788898A8B8C8D8E8F');
      expect(text).toContain('F0F1F2F3F4F5F6F7F8F9FAFBFCFDFEFF');
    },
    60_000,
  );
});
