// The viewer service of the running application (ARCHITECTURE-PLUS P3.4, P4.4): the model of
// model.ts with the window's settings, dock controller, place texts, blob URLs and download.
// Owner: N6.

import type { AppContext, ViewerService } from '../../contracts';
import { basename } from '../../core/paths/winpath';
import { placeText } from '../../core/places/display';
import { readPlus } from '../../core/plus/settings';
import { dockOf } from '../../state/dock';
import { browserObjectUrls, browserPdfViewerEnabled, downloadFile } from './download';
import { createViewerModel, type ObjectUrls, type ViewerModel } from './model';
import { ViewerPanel } from './ViewerPanel';

/** Replaces the browser's parts in tests under Node. */
export interface ViewerServiceOptions {
  urls?: ObjectUrls;
  download?: ((name: string, bytes: Uint8Array) => void) | null;
  pdfViewerEnabled?: () => boolean;
}

const models = new WeakMap<AppContext, ViewerModel>();

/** The model behind the viewer service of `ctx`, if createViewerService made it. */
export function viewerModelOf(ctx: AppContext): ViewerModel | null {
  return models.get(ctx) ?? null;
}

/**
 * The factory of AppContext.viewer. It keeps `ctx` and reads the settings, the dock, the Vfs's
 * labels and the documents only when a member is called (the documents come later in the
 * bootstrap's order).
 */
export function createViewerService(ctx: AppContext, options: ViewerServiceOptions = {}): ViewerService {
  const desktop = ctx.platform.kind === 'desktop';
  const model = createViewerModel({
    plus: () => readPlus(ctx.settings.get()),
    dock: () => dockOf(ctx),
    urls: options.urls ?? browserObjectUrls,
    nameOf: (path) => basename(path),
    tooltipOf: (path) =>
      placeText(
        ctx.vfs.backends().map(({ mount, label, kind }) => ({ mount, label, kind })),
        path,
        ctx.platform.kind,
      ),
    render: (handle) => <ViewerPanel handle={handle} />,
    openAsText: (path) => ctx.documents.open(path, { asText: true }),
    // Export downloads the file on the web; the desktop app does not show it (P3.4.2).
    download: desktop ? null : options.download !== undefined ? options.download : downloadFile,
    desktop,
    pdfViewerEnabled: options.pdfViewerEnabled ?? browserPdfViewerEnabled,
  });
  models.set(ctx, model);
  return { wants: (path, bytes) => model.wants(path, bytes), show: (path, bytes) => model.show(path, bytes) };
}
