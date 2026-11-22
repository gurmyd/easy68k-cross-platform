// The viewer of files that are not text: PDFs, pictures and a notice (ARCHITECTURE-PLUS P3.4).
// Owner: N0 > N6.
//
//   classify.ts      what opens where (P3.4.1)
//   model.ts         the service without React: wants(), show(), the viewers and their blob: URLs
//   service.tsx      createViewerService: the model with the window's settings, dock and browser
//   ViewerPanel.tsx  the content of a viewer tab (P3.4.2)
//   download.ts      blob: URLs and Export's download
//   texts.ts         every text a person reads
//
// The viewer has no commands and no PanelSpec: its tabs are transient panels of the dock
// (state/dock.ts, openTransient), opened by DocumentService.open through ctx.viewer. The feature's
// init only closes the open viewers when the application is disposed, so that their URLs are
// revoked.

import type { FeatureModule } from '../../contracts';
import { viewerModelOf } from './service';

export { createViewerService } from './service';

export const feature: FeatureModule = {
  id: 'viewer',
  init(ctx) {
    return () => viewerModelOf(ctx)?.closeAll();
  },
};
