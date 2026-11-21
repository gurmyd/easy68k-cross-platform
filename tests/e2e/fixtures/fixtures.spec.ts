// Unit tests of the harness's own logic (no browser is started: none of these tests uses a page).
// Owner: X1. They run with the end-to-end suites (npm run test:e2e), in each project.

import { expect, test } from '@playwright/test';
import { COMMAND_IDS } from '../../../app/src/commands/ids';
import { App, bytesOf, crlf, editorMenuOf, escapeRegExp, latin1, nonBlackColours, plainCaption } from './app';
import { chordOf, chordsOf, hostKeyMap, modKey, navigatorPlatformOf, playwrightKey } from './keys';
import { PENDING, landed, pendingReason, type PendingPackage } from './pending';
import { TEMPLATE, TRAILER, trailer } from './texts';

test.describe('keys', () => {
  test('the host system decides the key map; E2E_KEYS overrides it', () => {
    expect(hostKeyMap('darwin', undefined)).toBe('mac');
    expect(hostKeyMap('win32', undefined)).toBe('windows');
    expect(hostKeyMap('linux', undefined)).toBe('windows');
    expect(hostKeyMap('linux', 'mac')).toBe('mac');
    expect(hostKeyMap('darwin', 'windows')).toBe('windows');
    expect(hostKeyMap('darwin', 'bogus')).toBe('mac');
    expect(navigatorPlatformOf('mac')).toBe('MacIntel');
    expect(navigatorPlatformOf('windows')).toBe('Win32');
    expect(modKey('mac')).toBe('Meta');
    expect(modKey('windows')).toBe('Control');
  });

  test('chords of the table become Playwright key names', () => {
    expect(playwrightKey('F9')).toBe('F9');
    expect(playwrightKey('Ctrl+O')).toBe('Control+KeyO');
    expect(playwrightKey('Shift+Cmd+Z')).toBe('Shift+Meta+KeyZ');
    expect(playwrightKey('Ctrl+Alt+C')).toBe('Control+Alt+KeyC');
    expect(playwrightKey('Ctrl+Shift+.')).toBe('Control+Shift+Period');
    expect(playwrightKey('Ctrl+Shift+,')).toBe('Control+Shift+Comma');
    expect(playwrightKey('Cmd+/')).toBe('Meta+Slash');
    expect(playwrightKey('Shift+Insert')).toBe('Shift+Insert');
    expect(playwrightKey('Alt+Enter')).toBe('Alt+Enter');
    expect(playwrightKey('Ctrl+1')).toBe('Control+Digit1');
    expect(() => playwrightKey('Hyper+X')).toThrow(/Unknown modifier/);
  });

  test('every chord of every command converts, on both key maps', () => {
    for (const id of COMMAND_IDS) {
      for (const keys of ['windows', 'mac'] as const) {
        for (const chord of chordsOf(id, keys)) expect(() => playwrightKey(chord), `${id} ${chord}`).not.toThrow();
      }
    }
  });

  test('the chords the suites rely on are those of section 1.3', () => {
    expect(chordsOf('ed.file.open', 'windows')).toEqual(['Ctrl+O']);
    expect(chordsOf('ed.file.open', 'mac')).toEqual(['Cmd+O', 'Ctrl+O']);
    expect(chordOf('ed.edit.redo', 'windows')).toBe('Ctrl+Alt+Z');
    expect(chordOf('ed.edit.redo', 'mac')).toBe('Shift+Cmd+Z');
    expect(chordsOf('ed.file.close', 'mac')).toEqual([]); // Cmd+W only in the desktop app
    expect(() => chordOf('ed.file.close', 'mac')).toThrow(/no chord/);
    expect(chordsOf('ed.edit.replace', 'mac')).toEqual(['Ctrl+R']); // Cmd+R only in the desktop app
  });
});

test.describe('page helpers', () => {
  test('bytes, line ends and captions', () => {
    expect(Array.from(bytesOf('Aÿ'))).toEqual([0x41, 0xff]);
    expect(() => bytesOf('€')).toThrow(/not a byte/);
    const raw = new Uint8Array([1, 2, 3]);
    expect(bytesOf(raw)).toBe(raw);
    expect(latin1(new Uint8Array([0x41, 0xe9]))).toBe('Aé');
    expect(crlf('a', 'b')).toBe('a\r\nb\r\n');
    expect(crlf()).toBe('');
    expect(plainCaption('Save &As...')).toBe('Save As...');
    expect(plainCaption('Find And &Replace...')).toBe('Find And Replace...');
    expect(escapeRegExp('1 a.b (c)*')).toBe('1 a\\.b \\(c\\)\\*');
  });

  test('the monochrome check reads colour declarations, not substrings', () => {
    // The pattern this replaced (`color\s*:\s*(?!#000...)`) let \s* give back a blank, so it
    // flagged `color: #000;` as a colour (verify round 1 of X1).
    expect(nonBlackColours('p { color: #000; background: none; } b{color:black}')).toEqual([]);
    expect(nonBlackColours('i { color :  rgb(0, 0, 0) } u { color: inherit }')).toEqual([]);
    expect(nonBlackColours('<span style="color: #0000FF">x</span>')).toEqual(['#0000ff']);
    expect(nonBlackColours('a { background-color: #fff; border-color: red }')).toEqual([]);
    expect(nonBlackColours('a { color: #000080 !important }')).toEqual(['#000080']);
  });

  test("button() finds a dialog's own Close button, not the title-bar X of the same name", async ({ page }) => {
    // The markup of the kit's Dialog (app/src/ui/components/Dialog.tsx): an X named "Close" in the
    // title bar and, in many dialogs, a footer button with the caption Close.
    await page.setContent(`
      <div role="dialog" aria-label="Assembler Status - a.X68">
        <div class="e68-dialog__titlebar"><span class="e68-dialog__title">Assembler Status - a.X68</span>
          <button class="e68-dialog__close" aria-label="Close">x</button></div>
        <div class="e68-dialog__body"><button>Execute</button></div>
        <div class="e68-dialog__footer"><button id="own">Close</button></div>
      </div>`);
    const app = new App(page, 'windows');
    const dialog = app.dialog('Assembler Status - a.X68');
    await expect(app.button(dialog, 'Close')).toHaveCount(1);
    await expect(app.button(dialog, 'Close')).toHaveAttribute('id', 'own');
    await expect(app.button(dialog, 'Execute')).toHaveCount(1);
    await expect(app.titleBarClose(dialog)).toHaveAttribute('aria-label', 'Close');
  });

  test('editorMenuOf finds the menu of a command in the Editor menu bar', () => {
    expect(editorMenuOf('ed.file.printerSetup')).toBe('File');
    expect(editorMenuOf('ed.edit.replace')).toBe('Edit');
    expect(editorMenuOf('ed.options.editor')).toBe('Options');
    expect(editorMenuOf('sim.run.run')).toBeNull();
  });

  test('the template and trailer texts of the specification', () => {
    expect(TEMPLATE.split('\n')).toHaveLength(17); // 16 lines and the final line break
    expect(TEMPLATE.endsWith('    END    START        ; last line of source\n')).toBe(true);
    expect(TRAILER).toBe('*~Font name~Courier New~\r\n*~Font size~10~\r\n*~Tab type~1~\r\n*~Tab size~4~\r\n');
    expect(trailer('Fixedsys', 9, 0, 8)).toContain('*~Tab type~0~\r\n*~Tab size~8~\r\n');
  });
});

test.describe('pending packages', () => {
  const host = (enabled: string[]) => ({ commandEnabled: async (id: string) => enabled.includes(id) });

  test('a package has landed when all its probe commands are enabled', async () => {
    expect(await landed(host([]), 'E5')).toBe(false);
    expect(await landed(host(['ed.project.assemble']), 'E5')).toBe(true);
    expect(await landed(host(['ed.edit.find']), 'E6')).toBe(false);
    expect(await landed(host(['ed.edit.find', 'ed.edit.replace', 'ed.file.print']), 'E6')).toBe(true);
    expect(await landed(host(['ed.options.editor']), 'E4')).toBe(false);
    expect(await landed(host([]), 'FS2', async () => true)).toBe(true);
  });

  test('the reason names the package, so a report says whom an expected failure waits for', () => {
    for (const pkg of Object.keys(PENDING) as PendingPackage[]) {
      expect(pendingReason(pkg)).toMatch(new RegExp(`^${pkg}: `));
      expect(pendingReason(pkg)).toContain('turns itself on');
    }
  });

  test('every probe command is a known command id', () => {
    for (const probe of Object.values(PENDING))
      for (const id of probe.commands) expect(COMMAND_IDS as readonly string[]).toContain(id);
  });
});
