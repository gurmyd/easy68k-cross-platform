// The shared texts of the safety net, word for word as ARCHITECTURE-PLUS P3.3.4, P3.2.7 and P3.3.7
// give them.

import { describe, expect, it } from 'vitest';
import {
  CLEARING_SITE_DATA,
  DELETE_HISTORY_BUTTON,
  DELETE_HISTORY_QUESTION,
  STORAGE_TIGHT_TOAST,
  cannotKeepQuestion,
  changedWhileReplacing,
  changedWhileRestoring,
  historyUnreadable,
  unreadableEntries,
} from './texts';

describe('cannotKeepQuestion (P3.3.4)', () => {
  it.each([
    [
      'delete',
      'prog.X68',
      false,
      'EASy68K cannot keep a copy of "prog.X68" in the Trash. Delete it anyway? This cannot be undone.',
    ],
    [
      'delete',
      'demo',
      true,
      'EASy68K cannot keep a copy of the folder "demo" in the Trash. Delete it anyway? This cannot be undone.',
    ],
    [
      'replace',
      'prog.X68',
      false,
      'EASy68K cannot keep a copy of the current "prog.X68". Replace it anyway? This cannot be undone.',
    ],
    [
      'restore',
      'prog.X68',
      false,
      'EASy68K cannot keep a copy of the current "prog.X68". Restore the earlier version anyway? This cannot be undone.',
    ],
    // P3.2.7 gives this one in full.
    [
      'undo-copy',
      'prog.X68',
      false,
      'EASy68K cannot keep a copy of "prog.X68" in the Trash. Remove the copy anyway? This cannot be undone.',
    ],
  ] as const)('%s "%s" (folder: %s)', (command, name, isFolder, text) => {
    expect(cannotKeepQuestion(command, name, isFolder)).toBe(text);
  });
});

describe('the other texts', () => {
  it('changed while (P3.3.4 step 4)', () => {
    expect(changedWhileReplacing('prog.X68')).toBe(
      '"prog.X68" changed while it was being replaced. It was not replaced.',
    );
    expect(changedWhileRestoring('prog.X68')).toBe(
      '"prog.X68" changed while it was being restored. It was not restored.',
    );
  });

  it('the storage-tight toast (P3.3.4)', () => {
    expect(STORAGE_TIGHT_TOAST).toBe(
      "The browser's storage for this site is nearly full. To keep room for your files, EASy68K keeps no new earlier versions or Trash items until there is room again, and removes its oldest ones.",
    );
  });

  it('disposable by design (P3.3.7)', () => {
    expect(unreadableEntries(3)).toBe('3 entries could not be read.');
    expect(historyUnreadable('the database did not open')).toBe(
      'The history cannot be read (the database did not open). Your files are not affected.',
    );
    expect(DELETE_HISTORY_BUTTON).toBe('Delete History and Trash');
    expect(DELETE_HISTORY_QUESTION).toBe(
      'Delete all earlier versions and everything in the Trash for good? Your current files are not affected.',
    );
    expect(CLEARING_SITE_DATA).toBe(
      "Clearing this site's data in the browser removes My Programs, earlier versions and the Trash.",
    );
  });
});
