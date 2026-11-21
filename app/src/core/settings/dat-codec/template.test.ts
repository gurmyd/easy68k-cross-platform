// template.NEW (editor-ui §12.2): the shipped file is the port's default template, byte for byte.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_TEMPLATE } from '../defaults';
import { templateFromBytes, templateToBytes } from './template';

const SHIPPED = new Uint8Array(readFileSync(fileURLToPath(new URL('fixtures/shipped-template.NEW', import.meta.url))));

describe('template.NEW', () => {
  it('the shipped file reads as the default template and writes back to the same 420 bytes', () => {
    expect(SHIPPED.length).toBe(420);
    expect(templateFromBytes(SHIPPED)).toBe(DEFAULT_TEMPLATE);
    const { bytes, unmappable } = templateToBytes(DEFAULT_TEMPLATE);
    expect(unmappable).toBe(0);
    expect(Array.from(bytes)).toEqual(Array.from(SHIPPED));
  });

  it('lone LF and lone CR become line breaks; tabs and Windows-1252 characters are kept', () => {
    const text = templateFromBytes(Uint8Array.of(0x41, 0x0a, 0x09, 0x42, 0x0d, 0xe9, 0x0d, 0x0a));
    expect(text).toBe('A\n\tB\né\n');
    expect(Array.from(templateToBytes(text).bytes)).toEqual([
      0x41, 0x0d, 0x0a, 0x09, 0x42, 0x0d, 0x0a, 0xe9, 0x0d, 0x0a,
    ]);
  });

  it('counts characters that Windows-1252 cannot hold', () => {
    expect(templateToBytes('中\n').unmappable).toBe(1);
  });
});
