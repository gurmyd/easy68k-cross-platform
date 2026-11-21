// The sprite and the list of icon names agree, and every symbol is drawn for 16 x 16.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconId } from './icons';

const sprite = readFileSync(new URL('./icons.svg', import.meta.url), 'utf8');
const symbols = [...sprite.matchAll(/<symbol\s+id="([^"]+)"\s+viewBox="([^"]+)"/g)].map((m) => ({
  id: m[1] ?? '',
  viewBox: m[2] ?? '',
}));

describe('icons.svg', () => {
  it('has exactly one symbol per name of icons.ts', () => {
    expect(symbols.map((s) => s.id).sort()).toEqual(ICON_NAMES.map(iconId).sort());
  });

  it('draws every symbol on a 16 x 16 grid in currentColor only', () => {
    for (const symbol of symbols) expect(symbol.viewBox, symbol.id).toBe('0 0 16 16');
    const colours = [...sprite.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(colours)).toEqual(new Set(['none', 'currentColor']));
  });

  it('covers every button of both toolbars', () => {
    const toolbars = [
      ...['file-new', 'file-open', 'file-save', 'print', 'find', 'cut', 'copy', 'paste', 'undo', 'redo'],
      ...['comment', 'uncomment', 'assemble', 'run', 'run-to-cursor', 'auto-trace', 'step-over'],
      ...['trace-into', 'pause', 'rewind', 'reload', 'log-start', 'log-stop'],
    ];
    for (const name of toolbars) expect(ICON_NAMES).toContain(name);
  });
});
