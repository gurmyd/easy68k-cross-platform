// Feature "pwa": offline use and installation of the web app (ARCHITECTURE.md 1.1, 7.5, 7.6).
// Owner: W3 > DV1.
//
// init() registers the service worker (app/src/sw.ts) on the web platform when the production
// build carries it, and shows `A new version is available.` with `Reload` when a newer version
// waits; see register.ts. The desktop app registers no worker. The manifest and the icons are
// app/public/manifest.webmanifest and app/public/icons/; the build step that adds them to
// index.html and writes sw.js with the precache list is build/pwa-build.mjs.

import type { FeatureModule } from '../../contracts';
import { browserEnvironment, startPwa } from './register';

export const feature: FeatureModule = {
  id: 'pwa',
  init(ctx) {
    const handle = startPwa(
      {
        platformKind: ctx.platform.kind,
        toast: (text, action, options) => ctx.dialogs.toast(text, action, options),
        setTimer: (delay, fn) => ctx.scheduler.setTimer(delay, fn),
      },
      browserEnvironment(),
    );
    return () => handle.dispose();
  },
};
