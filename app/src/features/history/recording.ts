// Recording of automatic versions (ARCHITECTURE-PLUS P3.3.3, P4.4). Owner: N4.
//
// Versions are taken ONLY from the document service's own write hook, `DocumentService.onWritten`:
// after each successful Save, Save As and Auto Save with the exact bytes written (`saved`), and
// after each open of a file as a document with the bytes read (`opened`). Each event is handed to
// `ctx.history.record` in a queued task of its own that the save or open never awaits; a failure
// is swallowed, so a save never fails, waits or changes because of the history (P3.3.1 property 3).
//
// Never from `ctx.vfs`: a 68000 program's writes through the cached view, and every other write
// that does not pass through Save, are therefore never recorded, even to a file open in the editor.
// Without `onWritten` (a document service that does not have it yet) nothing is recorded.
//
// A file that gets no automatic versions (`untracked`: an .L68 or .S68, above 1 MB, not text, below
// .git, in /memory) is not queued at all, so that it takes no room in the store's queue. `opened`
// is kept by the store only when it differs from the record's newest version.

import type { AppContext, Bytes } from '../../contracts';

/** The first bytes `untracked` looks at for a zero byte (P3.3.3). */
export const HEAD_BYTES = 8192;

/** Runs `task` after the current one, never in the caller's call stack, and swallows its failure. */
function queued(task: () => Promise<void>): void {
  void Promise.resolve()
    .then(task)
    .catch(() => {});
}

/** Starts recording for one window; returns the function that stops it. */
export function startRecording(ctx: Pick<AppContext, 'documents' | 'history'>): () => void {
  const history = ctx.history;
  const onWritten = ctx.documents.onWritten?.bind(ctx.documents);
  if (!history || !onWritten) return () => {};
  return onWritten((event) => {
    queued(async () => {
      const bytes: Bytes = event.bytes;
      if (history.untracked(event.path, bytes.length, bytes.subarray(0, HEAD_BYTES)) !== null) return;
      // A copy: the store hashes and compresses later, and the caller may reuse its buffer.
      await history.record(event.path, bytes.slice(), event.reason, event.time);
    });
  });
}
