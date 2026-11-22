// Files handed to the installed web app (ARCHITECTURE.md 5.7, "Web, installed app: file handlers
// in the manifest for .x68, .l68, .s68 (Chromium) - as the desktop association"). Owner: DV1.
//
// The manifest (app/public/manifest.webmanifest) declares the file handlers; Chromium then starts
// the app with the files in `window.launchQueue`. Each file arrives as a FileSystemFileHandle. It is
// linked through the file dialogs (FileDialogs.linkFileHandle: FS2's provider makes it a
// `/linked/<id>/<name>` path that a later Save writes back to; docs/requests/DV1-launch-files.md)
// and then opened as the desktop association opens it:
//
//   .X68, .L68 (and any other)   Editor mode, opened as documents, in the order given
//   .S68                         Simulator mode, the simulator started afresh, loaded, not run
//                                (only the first one, as features/run's openAssociatedFiles)
//
// Where the browser has no launch queue (WebKit, Firefox, a tab that is not the installed app) or in
// the desktop app nothing happens. The browser objects are reached through the small interfaces
// below, so that the logic runs under Node (launch.test.ts).

import type { VPath } from '../../contracts';

export interface LaunchParamsLike {
  readonly files?: readonly unknown[];
}

export interface LaunchQueueLike {
  setConsumer(consumer: (params: LaunchParamsLike) => void): void;
}

/** The page's launch queue, or null where there is none. */
export function launchQueueOf(scope: unknown = globalThis): LaunchQueueLike | null {
  const queue = (scope as { launchQueue?: Partial<LaunchQueueLike> } | null)?.launchQueue;
  return queue && typeof queue.setConsumer === 'function' ? (queue as LaunchQueueLike) : null;
}

/** The text shown for a file that could not be linked. */
export const notOpenedText = (name: string): string => `"${name}" could not be opened.`;

export interface LaunchDeps {
  platformKind: 'web' | 'desktop';
  /** FileDialogs.linkFileHandle; null when the dialogs have no such member. */
  link: ((handle: FileSystemFileHandle) => Promise<VPath | null>) | null;
  /** Editor mode, then the documents opened in this order. */
  openInEditor(paths: readonly VPath[]): Promise<void>;
  /** Simulator mode, the simulator started afresh, the program loaded without running. */
  loadInSimulator(path: VPath): Promise<void>;
  toast(text: string): void;
}

function nameOf(handle: unknown): string {
  const name = (handle as { name?: unknown } | null)?.name;
  return typeof name === 'string' ? name : 'The file';
}

function isSRecord(path: string): boolean {
  return /\.s68$/i.test(path);
}

/** Links and opens the launched files (5.7). Resolves when everything has been asked for. */
export async function openLaunchedFiles(deps: LaunchDeps, handles: readonly unknown[]): Promise<void> {
  if (handles.length === 0) return;
  const editor: VPath[] = [];
  let program: VPath | null = null;
  for (const handle of handles) {
    let path: VPath | null;
    try {
      path = deps.link ? await deps.link(handle as FileSystemFileHandle) : null;
    } catch {
      path = null;
    }
    if (path === null) {
      deps.toast(notOpenedText(nameOf(handle)));
      continue;
    }
    if (isSRecord(path)) program ??= path;
    else editor.push(path);
  }
  if (editor.length > 0) await deps.openInEditor(editor);
  if (program !== null) await deps.loadInSimulator(program);
}

/** Takes the files of the launch queue, when this page has one. */
export function startLaunchQueue(
  deps: LaunchDeps,
  queue: LaunchQueueLike | null,
  report: (error: unknown) => void,
): void {
  if (deps.platformKind !== 'web' || !queue) return;
  queue.setConsumer((params) => {
    // After the other features' init(): the file dialogs' providers are registered by then.
    void Promise.resolve()
      .then(() => openLaunchedFiles(deps, params.files ?? []))
      .catch(report);
  });
}
