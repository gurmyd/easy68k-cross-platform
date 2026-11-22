// The browser engine, and the sandbox of the Help panel's frame that depends on it. Owner: H1.
//
// One rule decides which engine the page runs in, for every feature that must know it: the Files
// panel's storage notice (features/files/storage-notice.ts, errata FS1.md entry 28) and the Help
// frame (features/help/HelpPanel.tsx, erratum H1 11). It is here, in core, because both features
// may import core and neither may import the other (ARCHITECTURE.md 3.1). It is a pure function of
// navigator.vendor; reading the navigator is the caller's job (core touches no browser object).

/** The browser engine, as far as the application cares: Safari's (WebKit) or any other. */
export type BrowserEngine = 'webkit' | 'other';

/**
 * The browser engine from navigator.vendor. Every WebKit browser reports `Apple Computer, Inc.`:
 * Safari on macOS, iOS and iPadOS, every other browser on an iPhone or iPad (Chrome, Firefox, Edge
 * there are WebKit too), WebKitGTK, and Playwright's WebKit build on every system. Chromium-based
 * browsers report `Google Inc.`, Gecko reports an empty string. The product name in the user agent
 * is not consulted.
 */
export function engineOf(vendor: string | undefined): BrowserEngine {
  return vendor === 'Apple Computer, Inc.' ? 'webkit' : 'other';
}

/** The Help frame's sandbox everywhere but in the one case below: no scripts (ARCHITECTURE.md 7.6). */
export const HELP_FRAME_SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

/**
 * The Help frame's sandbox in WebKit while a service worker controls the page (erratum H1 11):
 * WebKit hands the navigation of a frame sandboxed without allow-scripts to no service worker, so
 * without allow-scripts Help cannot load offline there. No script runs in the frame all the same:
 * every imported page starts its head with a policy `script-src 'none'` and holds no script, no
 * event handler attribute and no javascript: address (tools/import-help.mjs refuses one that
 * does), and the service worker answers a frame navigation only below help/ (app/src/sw.ts), so the
 * frame can show nothing but those pages.
 */
export const HELP_FRAME_SANDBOX_WEBKIT = 'allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox';

export interface HelpFrameEnvironment {
  /** ctx.platform.kind: the desktop app keeps the frame without scripts. */
  platform: 'web' | 'desktop';
  engine: BrowserEngine;
  /** navigator.serviceWorker.controller is set: the worker answers the frame's navigations. */
  controlled: boolean;
}

/**
 * The sandbox of the Help frame. allow-scripts is added only where it is needed: in the web app,
 * in WebKit, while a service worker controls the page (only then can the frame be offline, and only
 * then does the worker's rule keep every other page of the site out of the frame). Everywhere else
 * the frame keeps the sandbox without scripts.
 */
export function helpFrameSandbox(environment: HelpFrameEnvironment): string {
  return environment.platform === 'web' && environment.engine === 'webkit' && environment.controlled
    ? HELP_FRAME_SANDBOX_WEBKIT
    : HELP_FRAME_SANDBOX;
}
