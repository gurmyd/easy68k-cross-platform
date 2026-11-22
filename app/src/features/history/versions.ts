// The logic of the Earlier Versions dialog (ARCHITECTURE-PLUS P3.3.8, P3.3.4, P3.3.7). Owner: N4.
//
// Plain functions, tested under Node; VersionsDialog.tsx draws what they return.
//
//   describeVersions   what stands in the dialog: the lines above the list (P3.3.7's count of
//                      unreadable entries, the switched-off line, the sentence why the file gets no
//                      new versions), the rows, or the empty state, or P3.3.7's unavailable text;
//   loadVersions       reads the versions and the reason of `untracked` for a path;
//   restoreVersion     Restore, in the order of P3.3.8: the open-document check, the version's
//                      bytes (`read`), then `guard(path, 'restore', write, confirm)`, which keeps
//                      the current bytes as `Before restore` or asks the question of P3.3.4; then
//                      an open, unmodified document is reloaded.

import type {
  AppContext,
  DialogService,
  DocumentService,
  HistoryService,
  HistoryState,
  SeenFile,
  VersionInfo,
  VPath,
  Vfs,
} from '../../contracts';
import { TabType } from '../../contracts';
import { decodeFile, stripTrailer } from '../../core/documents/format';
import {
  cannotKeepQuestion,
  changedWhileRestoring,
  historyUnreadable,
  unreadableEntries,
} from '../../core/history/texts';
import { basename, foldCase, mountOf } from '../../core/paths/winpath';
import { VERSION_NO_LONGER_KEPT, unsavedChanges } from '../../core/trash-restore/texts';
import { HEAD_BYTES } from './recording';
import {
  NOT_KEPT_GENERATED,
  NOT_KEPT_GIT,
  NOT_KEPT_LARGE_OR_BINARY,
  NO_VERSIONS_YET,
  RESTORE_TITLE,
  SWITCHED_OFF_LINE,
  UNKNOWN_DETAIL,
} from './texts';

/** The reasons of `untracked` (P4.4). */
export type UntrackedReason = ReturnType<HistoryService['untracked']>;

/** The two members N3's store has beyond P4.4 (docs/requests/N3-history-contract.md). */
export interface HistoryExtras {
  unreadable?(): number;
  unavailableDetail?(): string | null;
}

/** P3.3.7's count of records that did not parse, and the detail of an unavailable history. */
export function problemsOf(history: HistoryService): { unreadable: number; detail: string } {
  const extras = history as HistoryService & HistoryExtras;
  let unreadable = 0;
  let detail: string | null = null;
  try {
    unreadable = extras.unreadable?.() ?? 0;
    detail = extras.unavailableDetail?.() ?? null;
  } catch {
    // The dialogs show what they can.
  }
  return { unreadable, detail: detail ?? UNKNOWN_DETAIL };
}

/** The sentence of P3.3.8 for the reason a file gets no automatic versions, or null. */
export function notKeptSentence(reason: UntrackedReason): string | null {
  switch (reason) {
    case 'generated':
      return NOT_KEPT_GENERATED;
    case 'too-large':
    case 'not-text':
      return NOT_KEPT_LARGE_OR_BINARY;
    case 'git':
      return NOT_KEPT_GIT;
    default:
      // 'memory' is never shown: ed.file.history is disabled for /memory (P3.6).
      return null;
  }
}

/** What the Earlier Versions dialog shows. */
export type VersionsView =
  | { kind: 'unavailable'; text: string }
  | {
      kind: 'list';
      /** Lines above the list (or standing alone), in order. */
      lines: string[];
      rows: VersionInfo[];
      /** The empty state in place of the list, or null when the list (or the switched-off line alone) is shown. */
      empty: string | null;
    };

/** Pure: the dialog's content for a state, the versions and the reason of `untracked`. */
export function describeVersions(input: {
  state: HistoryState;
  unreadable: number;
  detail: string;
  rows: readonly VersionInfo[];
  reason: UntrackedReason;
}): VersionsView {
  if (input.state === 'unavailable') return { kind: 'unavailable', text: historyUnreadable(input.detail) };
  const lines: string[] = [];
  if (input.unreadable > 0) lines.push(unreadableEntries(input.unreadable));
  const sentence = notKeptSentence(input.reason);
  if (input.state === 'off') {
    // The list is shown whenever versions exist; with none, the line stands alone (P3.3.8).
    lines.push(SWITCHED_OFF_LINE);
    if (input.rows.length > 0 && sentence) lines.push(sentence);
    return { kind: 'list', lines, rows: [...input.rows], empty: null };
  }
  if (input.rows.length === 0) return { kind: 'list', lines, rows: [], empty: sentence ?? NO_VERSIONS_YET };
  if (sentence) lines.push(sentence);
  return { kind: 'list', lines, rows: [...input.rows], empty: null };
}

/** The current bytes of `path`, or null when it is not a file now. */
export async function currentBytes(vfs: Pick<Vfs, 'stat' | 'readFile'>, path: VPath): Promise<Uint8Array | null> {
  try {
    const stat = await vfs.stat(path);
    if (!stat || stat.kind !== 'file') return null;
    return await vfs.readFile(path);
  } catch {
    return null;
  }
}

/** The versions of `path` and why it gets no new ones (P3.3.8). */
export async function loadVersions(
  deps: { history: HistoryService; vfs: Pick<Vfs, 'stat' | 'readFile'> },
  path: VPath,
): Promise<{ rows: VersionInfo[]; reason: UntrackedReason; now: Uint8Array | null }> {
  const now = await currentBytes(deps.vfs, path);
  const bytes = now ?? new Uint8Array(0);
  const reason = untrackedOf(deps.history, path, bytes);
  const rows = await deps.history.versions(path).catch((): VersionInfo[] => []);
  return { rows, reason, now };
}

/** `untracked` of the store; null when it throws (it does not, by its contract). */
function untrackedOf(history: HistoryService, path: VPath, bytes: Uint8Array): UntrackedReason {
  try {
    return history.untracked(path, bytes.length, bytes.subarray(0, HEAD_BYTES));
  } catch {
    return null;
  }
}

/** The text of a version or of the file now, as the comparison shows it (trailer lines included). */
export function comparisonText(bytes: Uint8Array | null): string {
  return bytes ? decodeFile(bytes) : '';
}

/**
 * The text `Open as New Document` puts into the new document: the version's text without its
 * font and tab trailer lines, as opening the file would show it (editor-ui 6.3), so that saving the
 * new document does not write a second trailer (errata N4).
 */
export function newDocumentText(versionText: string): string {
  return stripTrailer(versionText, { fontName: 'Courier New', fontSize: 10, tabType: TabType.Assembly, tabSize: 8 })
    .text;
}

/** A version's time in the system's locale, minutes resolution (P3.3.8). */
export function formatKept(time: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(time));
}

/** True when two paths name one file: the browser store compares letter case folded (P4.3). */
export function samePath(a: VPath, b: VPath): boolean {
  if (a === b) return true;
  try {
    return mountOf(a) === 'browser' && mountOf(b) === 'browser' && foldCase(a) === foldCase(b);
  } catch {
    return false;
  }
}

/** The open document of this window at `path`, or null. */
export function documentAt(documents: Pick<DocumentService, 'list'>, path: VPath) {
  return documents.list().find((doc) => doc.path !== null && samePath(doc.path, path)) ?? null;
}

export type RestoreOutcome = 'restored' | 'unsaved' | 'gone' | 'declined' | 'failed';

/** Earlier Versions' Restore (P3.3.8, P3.3.4). */
export async function restoreVersion(
  deps: {
    history: HistoryService;
    dialogs: Pick<DialogService, 'messageBox'>;
    documents: Pick<DocumentService, 'list' | 'reload'>;
    vfs: Pick<Vfs, 'stat' | 'writeFile'>;
  },
  path: VPath,
  seq: number,
): Promise<RestoreOutcome> {
  const name = basename(path);
  const say = (text: string, icon: 'information' | 'error' = 'information') =>
    deps.dialogs.messageBox({ title: RESTORE_TITLE, text, icon, buttons: ['OK'] });

  // 1. An open, modified document: nothing happens.
  if (documentAt(deps.documents, path)?.modified) {
    await say(unsavedChanges(name));
    return 'unsaved';
  }
  // 2. The version's bytes, before guard (a version pruned since the list was shown is gone).
  let bytes: Uint8Array;
  try {
    bytes = await deps.history.read(path, seq);
  } catch {
    await say(VERSION_NO_LONGER_KEPT);
    return 'gone';
  }
  // 3. guard keeps the current bytes as `Before restore`, or asks the question of P3.3.4.
  const write = async (seen: readonly SeenFile[]) => {
    const stat = await deps.vfs.stat(path);
    const before = seen.find((file) => samePath(file.path, path));
    const unchanged = before
      ? stat !== null && stat.kind === 'file' && stat.mtime === before.mtime && stat.size === before.size
      : stat === null;
    if (!unchanged) throw new Error(changedWhileRestoring(name));
    await deps.vfs.writeFile(path, bytes);
  };
  const confirm = async () =>
    (await deps.dialogs.messageBox({
      title: RESTORE_TITLE,
      text: cannotKeepQuestion('restore', name, false),
      icon: 'warning',
      buttons: ['Yes', 'No'],
    })) === 'Yes';
  try {
    const result = await deps.history.guard(path, 'restore', write, confirm);
    if (result.outcome === 'declined') return 'declined';
  } catch (error) {
    await say(error instanceof Error ? error.message : String(error), 'error');
    return 'failed';
  }
  // 4. What follows the write: an open, unmodified document shows the restored text.
  const doc = documentAt(deps.documents, path);
  if (doc && !doc.modified) await deps.documents.reload(doc.id);
  return 'restored';
}

/** The services the dialogs use, from the application context. */
export type HistoryDialogDeps = Pick<AppContext, 'dialogs' | 'documents' | 'vfs' | 'history'>;
