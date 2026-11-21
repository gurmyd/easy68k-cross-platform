// Shortcuts of Editor mode on both platform key maps (ARCHITECTURE.md 1.3 rules K1-K6, 1.3.1,
// 1.3.2, 2.9; 6.6 "shortcuts on both platform key maps"). Owner: X1.
//
// Each describe block gives the page one key map, whatever system the tests run on, and presses
// every chord the application's table gives a command there. Only commands that the application's
// dispatcher runs are pressed here; the browser's own editing keys (cut, copy, paste in a text
// field) follow the real system and are tested in editing.spec.ts on the host's key map.

import { expect, requirePackage, test, type App, type KeyMap } from '../fixtures';

async function closeDialog(app: App, title: string): Promise<void> {
  const dialog = app.dialog(title);
  await expect(dialog).toBeVisible();
  await app.page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
}

for (const keys of ['windows', 'mac'] as const satisfies readonly KeyMap[]) {
  test.describe(`${keys} key map`, () => {
    test.use({ keys });

    test('Open File, Save (Save As for an unnamed document) and Save As', async ({ app }) => {
      for (const chord of app.chords('ed.file.open')) {
        await app.focusEditor();
        await app.pressChord(chord);
        await closeDialog(app, 'Open File');
      }
      for (const chord of app.chords('ed.file.save')) {
        await app.focusEditor();
        await app.pressChord(chord);
        await closeDialog(app, 'Save As');
      }
      // Save As has a chord on macOS only (Shift+Cmd+S, added); none on Windows and Linux.
      expect(app.chords('ed.file.saveAs')).toEqual(keys === 'mac' ? ['Shift+Cmd+S'] : []);
      for (const chord of app.chords('ed.file.saveAs')) {
        await app.focusEditor();
        await app.pressChord(chord);
        await closeDialog(app, 'Save As');
      }
    });

    test('Comment, Uncomment, Indent, Outdent, Redo and Insert/Replace from every chord', async ({ app, page }) => {
      const cases: [id: Parameters<App['chords']>[0], before: string, select: [number, number], after: string][] = [
        ['ed.edit.comment', 'a', [0, 1], '*a'],
        ['ed.edit.uncomment', '*a', [0, 2], 'a'],
        ['ed.edit.indent', 'a', [0, 1], ' a'],
        ['ed.edit.outdent', ' a', [0, 2], 'a'],
      ];
      for (const [id, before, [from, to], after] of cases) {
        const chords = app.chords(id);
        expect(chords.length, id).toBeGreaterThan(0);
        for (const chord of chords) {
          await app.replaceText(before);
          await app.select(from, to);
          await app.pressChord(chord);
          await expect.poll(() => app.text(), `${id} with ${chord}`).toBe(after);
        }
      }
      for (const chord of app.chords('ed.edit.redo')) {
        await app.replaceText('base');
        await app.paste('+');
        await expect.poll(() => app.text()).toBe('base+');
        await page.keyboard.press(`${app.mod}+KeyZ`);
        await expect.poll(() => app.text()).toBe('base');
        await app.focusEditor();
        await app.pressChord(chord);
        await expect.poll(() => app.text(), `Redo with ${chord}`).toBe('base+');
      }
      expect(app.chords('ed.edit.toggleInsert')).toEqual(keys === 'mac' ? ['Ctrl+Shift+I'] : ['Insert']);
      await app.focusEditor();
      await app.press('ed.edit.toggleInsert');
      await expect.poll(async () => (await app.status())[2]).toBe('Replace');
      await app.press('ed.edit.toggleInsert');
      await expect.poll(async () => (await app.status())[2]).toBe('Insert');
    });

    test('F1 opens context help; F4 cycles the modes (K5)', async ({ app, page }) => {
      await app.replaceText('    NOP');
      await app.select(5);
      await page.keyboard.press('F1');
      await expect(page.locator('[data-e68-panel="help"]')).toBeVisible();
      await app.focusEditor();
      for (const mode of ['simulator', 'easybin', 'editor']) {
        await app.press('app.mode.next');
        await expect.poll(() => app.mode()).toBe(mode);
      }
    });

    test('Find (Ctrl+F / Cmd+F), Find Next (F3, Cmd+G) and Find And Replace (Ctrl+R) open and act (E6)', async ({
      app,
    }) => {
      await requirePackage(app, 'E6');
      await app.replaceText('one two one');
      for (const chord of app.chords('ed.edit.find')) {
        await app.focusEditor();
        await app.pressChord(chord);
        await expect(app.dialog('Find')).toBeVisible();
        await app.button(app.dialog('Find'), 'Cancel').click();
        await expect(app.dialog('Find')).toBeHidden();
      }
      for (const chord of app.chords('ed.edit.replace')) {
        await app.focusEditor();
        await app.pressChord(chord);
        await expect(app.dialog('Replace')).toBeVisible();
        await app.button(app.dialog('Replace'), 'Cancel').click();
        await expect(app.dialog('Replace')).toBeHidden();
      }
      expect(app.chords('ed.edit.findNext')).toEqual(keys === 'mac' ? ['F3', 'Cmd+G'] : ['F3']);
    });

    test('Assemble Source (F9, Cmd+B) opens the Assembler Status dialog (E5)', async ({ app }) => {
      await requirePackage(app, 'E5');
      expect(app.chords('ed.project.assemble')).toEqual(keys === 'mac' ? ['F9', 'Cmd+B'] : ['F9']);
      for (const chord of app.chords('ed.project.assemble')) {
        await app.focusEditor();
        await app.pressChord(chord);
        const dialog = app.dialog('Assembler Status - untitled1.x68');
        await expect(dialog).toBeVisible();
        await app.button(dialog, 'Close').click();
        await expect(dialog).toBeHidden();
      }
    });
  });
}
