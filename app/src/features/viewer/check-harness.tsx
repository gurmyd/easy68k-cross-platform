// For check-viewer.mjs only (development server): shows one viewer of the real model and panel in
// a stand-in for the dock's tab, so that the viewer itself can be checked in a browser whether or
// not the dock (N1) accepts transient panels. Nothing in the application imports this file; the
// check loads it with import('/src/features/viewer/check-harness.tsx'). Owner: N6.
//
// The stand-in is an element with data-e68-panel="viewer:check" and role tabpanel, fixed over the
// application, as the dock's tab element would be (P3.1.2).

import { createRoot, type Root } from 'react-dom/client';
import type { AppContext, Bytes, VPath } from '../../contracts';
import { basename } from '../../core/paths/winpath';
import { browserObjectUrls, browserPdfViewerEnabled, downloadFile } from './download';
import { createViewerModel, type ViewerModel } from './model';
import { ViewerPanel } from './ViewerPanel';

export interface HarnessViewer {
  model: ViewerModel;
  /** Closes the viewer as the dock would (its onClose runs) and removes the stand-in. */
  close(): void;
  /** True while the stand-in shows a viewer. */
  isOpen(): boolean;
}

export function mountViewer(ctx: AppContext, path: VPath, bytes: Bytes): HarnessViewer {
  const host = document.createElement('div');
  host.setAttribute('data-e68-panel', 'viewer:check');
  host.setAttribute('role', 'tabpanel');
  host.setAttribute('aria-label', basename(path));
  host.style.cssText = 'position:fixed;inset:60px 80px;z-index:25;display:flex;flex-direction:column;';
  document.body.append(host);
  const root: Root = createRoot(host);
  let current: { id: string; onClose(): void } | null = null;
  const dock = {
    acceptsTransient: () => true,
    openTransient(spec: { id: `viewer:${number}`; render(): unknown; onClose(): void }) {
      current = spec;
      root.render(spec.render() as never);
      return true;
    },
    selectTransient: (id: string) => current?.id === id,
    closeTransient(id: string) {
      if (current?.id !== id) return;
      const closing = current;
      current = null;
      root.render(null);
      closing.onClose();
    },
  };
  const model = createViewerModel({
    plus: () => ({ viewer: true, history: true }),
    dock: () => dock,
    urls: browserObjectUrls,
    nameOf: (file) => basename(file),
    tooltipOf: () => '',
    render: (handle) => <ViewerPanel handle={handle} />,
    openAsText: (file) => ctx.documents.open(file, { asText: true }),
    download: ctx.platform.kind === 'desktop' ? null : downloadFile,
    desktop: ctx.platform.kind === 'desktop',
    pdfViewerEnabled: browserPdfViewerEnabled,
  });
  model.show(path, bytes);
  let removed = false;
  return {
    model,
    isOpen: () => current !== null,
    close() {
      if (removed) return;
      removed = true;
      if (current) dock.closeTransient(current.id);
      root.unmount();
      host.remove();
    },
  };
}
