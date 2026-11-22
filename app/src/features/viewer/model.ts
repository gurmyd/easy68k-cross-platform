// The viewer service without React or a browser (ARCHITECTURE-PLUS P3.4.2, P4.4). Owner: N6.
// Pure apart from what its deps do; runs under Node.
//
// wants(path, bytes) is true when the `viewer` switch is on, the table of P3.4.1 names a viewer for
// the file, and the dock accepts transient panels (N0's stub and tests do not: every file then
// opens as text). show(path, bytes) opens a transient tab `viewer:<n>` in the group that holds the
// editor, or selects the tab already open for that path (with the bytes read now, if they changed).
// Each viewer holds its bytes and, for a PDF or a picture, one `blob:` URL made from them with the
// explicit type of P3.4.2; the URL is revoked when the tab goes away (its onClose), whatever closed
// it. A notice needs no URL: Export makes its own blob of type application/octet-stream.

import type { ReactNode } from 'react';
import type { Bytes, PlusSettings, VPath, ViewerService } from '../../contracts';
import type { DockController } from '../../state/dock';
import { blobTypeOf, viewerKindOf, type ViewerKind } from './classify';

/** What one viewer shows; replaced as a whole when the file is opened again with other bytes. */
export interface ViewerSnapshot {
  readonly path: VPath;
  readonly name: string;
  readonly kind: ViewerKind;
  readonly bytes: Bytes;
  /** The type of the blob behind `url`. */
  readonly type: string;
  /** A `blob:` URL of `bytes` with `type`; null for the notice. */
  readonly url: string | null;
}

/** What the panel component may do (P3.4.2's strip). */
export interface ViewerActions {
  /** Opens the file as a document (`open(path, { asText: true })`) and closes the viewer. */
  openAsText(): Promise<void>;
  /** Web: downloads the bytes; absent in the desktop app, where Export is not shown. */
  exportFile?: () => void;
  /** The desktop app (its texts differ, P3.4.2). */
  readonly desktop: boolean;
  /** False when the browser downloads PDFs instead of showing them (`navigator.pdfViewerEnabled`). */
  pdfViewerEnabled(): boolean;
}

/** One open viewer, as the panel component sees it. */
export interface ViewerHandle {
  readonly id: `viewer:${number}`;
  snapshot(): ViewerSnapshot;
  subscribe(listener: () => void): () => void;
  readonly actions: ViewerActions;
}

export interface ObjectUrls {
  create(bytes: Bytes, type: string): string;
  revoke(url: string): void;
}

export interface ViewerModelDeps {
  /** The two switches as they are now (readPlus of the settings). */
  plus(): PlusSettings;
  /** The dock controller of the window, asked only when a member is called. */
  dock(): Pick<DockController, 'acceptsTransient' | 'openTransient' | 'selectTransient' | 'closeTransient'>;
  urls: ObjectUrls;
  /** The file's name for the tab and the strip. */
  nameOf(path: VPath): string;
  /** The tab's tool-tip: the place text (P4.5). */
  tooltipOf(path: VPath): string;
  /** The panel's content for a viewer. */
  render(handle: ViewerHandle): ReactNode;
  /** Open as Text: `ctx.documents.open(path, { asText: true })`. */
  openAsText(path: VPath): Promise<unknown>;
  /** Export on the web; null in the desktop app. */
  download: ((name: string, bytes: Bytes) => void) | null;
  desktop: boolean;
  pdfViewerEnabled(): boolean;
}

export interface ViewerModel extends ViewerService {
  /** The open viewers, in the order they were opened. */
  open(): ViewerHandle[];
  /** Closes every viewer (the feature's dispose). */
  closeAll(): void;
}

function sameBytes(a: Bytes, b: Bytes): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Viewer extends ViewerHandle {
  /** Shows `bytes` from now on; false when they are the bytes shown already. */
  replace(bytes: Bytes): boolean;
  dispose(): void;
}

export function createViewerModel(deps: ViewerModelDeps): ViewerModel {
  const byPath = new Map<VPath, Viewer>();
  let counter = 0;

  const snapshotOf = (path: VPath, bytes: Bytes): ViewerSnapshot => {
    const kind = viewerKindOf(path, bytes) ?? 'notice';
    const type = blobTypeOf(path, kind);
    const url = kind === 'notice' ? null : deps.urls.create(bytes, type);
    return { path, name: deps.nameOf(path), kind, bytes, type, url };
  };

  const createViewer = (id: `viewer:${number}`, path: VPath, bytes: Bytes): Viewer => {
    let current = snapshotOf(path, bytes);
    let disposed = false;
    const listeners = new Set<() => void>();
    const revoke = (snapshot: ViewerSnapshot) => {
      if (snapshot.url !== null) deps.urls.revoke(snapshot.url);
    };
    const download = deps.download;
    const actions: ViewerActions = {
      desktop: deps.desktop,
      pdfViewerEnabled: () => deps.pdfViewerEnabled(),
      openAsText: async () => {
        try {
          await deps.openAsText(path);
        } finally {
          deps.dock().closeTransient(id);
        }
      },
      ...(download ? { exportFile: () => download(current.name, current.bytes) } : {}),
    };
    return {
      id,
      actions,
      snapshot: () => current,
      subscribe(listener) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
      replace(next) {
        if (disposed || sameBytes(current.bytes, next)) return false;
        const old = current;
        current = snapshotOf(path, next);
        revoke(old);
        for (const listener of [...listeners]) listener();
        return true;
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        revoke(current);
        listeners.clear();
      },
    };
  };

  const forget = (path: VPath, viewer: Viewer) => {
    viewer.dispose();
    if (byPath.get(path) === viewer) byPath.delete(path);
  };

  return {
    wants(path, bytes) {
      if (!deps.plus().viewer) return false;
      if (viewerKindOf(path, bytes) === null) return false;
      return deps.dock().acceptsTransient();
    },

    show(path, bytes) {
      const dock = deps.dock();
      const existing = byPath.get(path);
      if (existing) {
        existing.replace(bytes);
        if (dock.selectTransient(existing.id)) return;
        forget(path, existing); // its tab is gone without telling us: open a new one
      }
      const id = `viewer:${++counter}` as const;
      const viewer = createViewer(id, path, bytes);
      byPath.set(path, viewer);
      const opened = dock.openTransient({
        id,
        title: deps.nameOf(path),
        tooltip: deps.tooltipOf(path),
        render: () => deps.render(viewer),
        onClose: () => forget(path, viewer),
      });
      if (!opened) {
        // The dock no longer accepts transient panels: the file opens as text, as with `viewer` off.
        forget(path, viewer);
        void deps.openAsText(path);
      }
    },

    open: () => [...byPath.values()],

    closeAll() {
      for (const [path, viewer] of [...byPath]) {
        deps.dock().closeTransient(viewer.id);
        forget(path, viewer);
      }
    },
  };
}
