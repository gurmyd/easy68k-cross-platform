// Feature "pwa": offline use and installation of the web app (ARCHITECTURE.md 1.1, 7.5, 7.6).
// Owner: W3 > DV1.
//
// init() registers the service worker (app/src/sw.ts) on the web platform when the production
// build carries it, and shows `A new version is available.` with `Reload` when a newer version
// waits; see register.ts. The desktop app registers no worker. The manifest and the icons are
// app/public/manifest.webmanifest and app/public/icons/; the build step that adds them to
// index.html and writes sw.js with the precache list is build/pwa-build.mjs.

//
// It also takes the files the installed app is started with (manifest `file_handlers`, 5.7) from
// the launch queue; see launch.ts.

import type { AppContext, FeatureModule } from '../../contracts';
import { launchQueueOf, startLaunchQueue, type LaunchDeps } from './launch';
import { browserEnvironment, startPwa } from './register';

/** What the launch queue's files need from the application. */
export function launchDeps(ctx: AppContext): LaunchDeps {
  const dialogs = ctx.fileDialogs;
  return {
    platformKind: ctx.platform.kind,
    link: dialogs.linkFileHandle ? (handle) => dialogs.linkFileHandle?.(handle) ?? Promise.resolve(null) : null,
    async openInEditor(paths) {
      if (ctx.store.getState().mode !== 'editor') await ctx.commands.run('app.mode.set', 'editor');
      for (const path of paths) await ctx.documents.open(path);
    },
    async loadInSimulator(path) {
      await ctx.commands.run('app.mode.set', 'simulator');
      await ctx.sim.controller.open(path, 'association');
    },
    toast: (text) => ctx.dialogs.toast(text),
  };
}

export const feature: FeatureModule = {
  id: 'pwa',
  init(ctx) {
    startLaunchQueue(launchDeps(ctx), launchQueueOf(), (error) =>
      console.warn('EASy68K: a file the app was started with could not be opened.', error),
    );
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
