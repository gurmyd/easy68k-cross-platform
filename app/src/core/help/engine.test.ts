// The browser engine rule and the Help frame's sandbox (erratum H1 11). Owner: H1.

import { describe, expect, it } from 'vitest';
import { HELP_FRAME_SANDBOX, HELP_FRAME_SANDBOX_WEBKIT, engineOf, helpFrameSandbox } from './engine';

describe('engineOf', () => {
  it('is WebKit for Apple Computer, Inc. only', () => {
    expect(engineOf('Apple Computer, Inc.')).toBe('webkit');
    for (const vendor of ['Google Inc.', '', undefined, 'apple computer, inc.', 'Apple']) {
      expect(engineOf(vendor), String(vendor)).toBe('other');
    }
  });
});

describe('helpFrameSandbox', () => {
  it('keeps the sandbox without scripts everywhere but in WebKit under a service worker', () => {
    const table: [platform: 'web' | 'desktop', engine: 'webkit' | 'other', controlled: boolean, sandbox: string][] = [
      ['web', 'webkit', true, HELP_FRAME_SANDBOX_WEBKIT],
      ['web', 'webkit', false, HELP_FRAME_SANDBOX],
      ['web', 'other', true, HELP_FRAME_SANDBOX],
      ['web', 'other', false, HELP_FRAME_SANDBOX],
      ['desktop', 'webkit', true, HELP_FRAME_SANDBOX],
      ['desktop', 'webkit', false, HELP_FRAME_SANDBOX],
      ['desktop', 'other', true, HELP_FRAME_SANDBOX],
      ['desktop', 'other', false, HELP_FRAME_SANDBOX],
    ];
    for (const [platform, engine, controlled, sandbox] of table) {
      expect(helpFrameSandbox({ platform, engine, controlled }), `${platform} ${engine} ${controlled}`).toBe(sandbox);
    }
  });

  it('differs from the sandbox of ARCHITECTURE.md 7.6 by allow-scripts alone', () => {
    expect(HELP_FRAME_SANDBOX).toBe('allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    const words = (text: string) => text.split(' ').sort();
    expect(words(HELP_FRAME_SANDBOX_WEBKIT)).toEqual(words(`${HELP_FRAME_SANDBOX} allow-scripts`));
    // Never forms, top navigation or modals: the frame shows pages and opens web links in a new tab.
    for (const sandbox of [HELP_FRAME_SANDBOX, HELP_FRAME_SANDBOX_WEBKIT]) {
      expect(sandbox).not.toMatch(/allow-(forms|top-navigation|modals|downloads|pointer-lock|presentation)/);
    }
  });
});
