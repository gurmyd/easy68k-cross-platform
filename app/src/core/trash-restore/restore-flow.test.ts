// N0's stub of restoreWithQuestions and the texts of a restore (ARCHITECTURE-PLUS P3.3.8, P3.2.7).

import { describe, expect, it, vi } from 'vitest';
import type { DialogService, DocumentService, HistoryService, MessageBoxRequest } from '../../contracts';
import { restoreWithQuestions } from './restore-flow';
import {
  existsQuestion,
  folderNotOpen,
  noLongerInTrash,
  partlyRestored,
  placeUnreachable,
  restoredName,
  unsavedChanges,
} from './texts';

function deps(restoreTrash: HistoryService['restoreTrash']) {
  const boxes: MessageBoxRequest[] = [];
  const dialogs = {
    messageBox: async (request: MessageBoxRequest) => (boxes.push(request), 'OK'),
  } as unknown as DialogService;
  return {
    boxes,
    deps: {
      history: { restoreTrash } as unknown as HistoryService,
      dialogs,
      documents: {} as DocumentService,
      placeShort: (path: string) => path.replace('/browser', 'My Programs'),
    },
  };
}

describe('restoreWithQuestions (stub of N0)', () => {
  it('asks restoreTrash with cancel, null and false, and collects the outcome', async () => {
    const restoreTrash = vi.fn<HistoryService['restoreTrash']>(async (_id, options) => {
      expect(await options.ask('/browser/a')).toBe('cancel');
      expect(await options.fallback({} as never)).toBeNull();
      expect(await options.confirm('/browser/a')).toBe(false);
      return { restored: ['/browser/a'], left: ['/browser/b'], lost: [], gone: false };
    });
    const { deps: d, boxes } = deps(restoreTrash);
    expect(await restoreWithQuestions(d, [{ id: '1', path: '/browser/demo' }], 'Restore')).toEqual({
      restored: ['/browser/a'],
      left: ['/browser/b'],
      lost: [],
      gone: [],
    });
    expect(boxes).toEqual([]);
  });

  it('names an item that is gone with the text of P3.2.7, titled as asked', async () => {
    const { deps: d, boxes } = deps(async () => ({ restored: [], left: [], lost: [], gone: true }));
    expect((await restoreWithQuestions(d, [{ id: '7', path: '/browser/prog.X68' }], 'Undo')).gone).toEqual([
      '/browser/prog.X68',
    ]);
    expect(boxes).toEqual([
      {
        title: 'Undo',
        text: '"My Programs/prog.X68" cannot be brought back: it is no longer in the Trash.',
        icon: 'information',
        buttons: ['OK'],
      },
    ]);
  });
});

describe('texts of a restore (P3.3.8, P3.2.7)', () => {
  it('word for word', () => {
    expect(existsQuestion('demo/prog.X68', 'prog (restored).X68', true)).toBe(
      '"demo/prog.X68" exists. Replace it with the one from the Trash? The file there now goes to the Trash. Choose No to keep both: the restored file is named "prog (restored).X68".',
    );
    expect(existsQuestion('demo/prog.X68', 'prog (restored).X68', false)).toBe(
      '"demo/prog.X68" exists. Replace it with the one from the Trash? This cannot be undone. Choose No to keep both: the restored file is named "prog (restored).X68".',
    );
    expect(restoredName('prog.X68', 1)).toBe('prog (restored).X68');
    expect(restoredName('prog.X68', 2)).toBe('prog (restored 2).X68');
    expect(restoredName('README', 3)).toBe('README (restored 3)');
    expect(unsavedChanges('prog.X68')).toBe(
      '"prog.X68" has changes that are not saved. Save it or close it first, then restore.',
    );
    expect(folderNotOpen('prog.X68', 'Lab')).toBe(
      '"prog.X68" was in the folder "Lab", which is not open. Restore it into My Programs/Restored instead? Choose No to leave it in the Trash.',
    );
    expect(placeUnreachable('prog.X68', '/Users/me/Lab')).toBe(
      '"prog.X68" was in "/Users/me/Lab", which EASy68K cannot reach now. Restore it into My Programs/Restored instead? Choose No to leave it in the Trash.',
    );
    expect(noLongerInTrash('prog.X68')).toBe('"prog.X68" cannot be brought back: it is no longer in the Trash.');
  });

  it('a partial restore', () => {
    expect(partlyRestored(2, 5, 0)).toBe('2 of 5 files were restored. The others are still in the Trash.');
    expect(partlyRestored(2, 5, 1)).toBe('2 of 5 files were restored. 1 of the others is no longer in the Trash.');
    expect(partlyRestored(2, 5, 2)).toBe('2 of 5 files were restored. 2 of the others are no longer in the Trash.');
    expect(partlyRestored(2, 5, 3)).toBe('2 of 5 files were restored. The others are no longer in the Trash.');
  });
});
