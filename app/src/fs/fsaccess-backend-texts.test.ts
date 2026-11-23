// The menu item that a text of the File System Access backend names (fsaccess-backend.ts
// FSACCESS_MESSAGES.notAllowed) is the one the menus show: the Editor's File > Open File..., whose
// dialog has "Open folder..." and "From this computer..." (ARCHITECTURE.md 3.8; erratum N8 of the
// stage). The text once said "File > Open", a caption no menu of the Editor has.

import { describe, expect, it } from 'vitest';
import { menuTables } from '../commands/menus';
import { COMMAND_SPECS } from '../commands/specs';
import { FSACCESS_MESSAGES } from './fsaccess-backend';

describe('the texts of the File System Access backend name what the menus show', () => {
  it('notAllowed names File > Open File..., the Editor menu item that opens a folder or a file again', () => {
    expect(FSACCESS_MESSAGES.notAllowed('work')).toBe(
      'The browser does not allow this page to use "work" at the moment. ' +
        'Open the folder or the file again (File > Open File...), and allow access when the browser asks.',
    );
    const file = menuTables('editor').find((menu) => menu.caption.replace('&', '') === 'File');
    expect(JSON.stringify(file?.items)).toContain('"ed.file.open"');
    const named = /\(File > ([^)]*)\)/.exec(FSACCESS_MESSAGES.notAllowed('work'))?.[1];
    expect(named).toBe(COMMAND_SPECS['ed.file.open'].caption.replace('&', ''));
  });
});
