// The tip about arranging the panels (ARCHITECTURE-PLUS P9.3, version 1.1), the pure part. Owner: M2.
//
// The first time a window shows the Simulator, a notice appears above the status bar:
//
//   You can rearrange this window. Press Arrange Panels to show each panel's tab; then double-click
//   a tab to make the panel float, or drag it to dock it elsewhere. Ready-made layouts are in the
//   View menu.  [ Arrange Panels ] [ Got it ]                                    (P9.9 point 3)
//
// `Arrange Panels` unlocks the layout and closes it, `Got it` closes it; after either it never comes
// again in this browser profile (AppSettings.plus.arrangeTipAnswered, core/plus/settings.ts), in no
// window. It is not shown while a program is running or waiting for input (any phase but idle); it
// comes at the next moment the Simulator is shown with no program running. It takes no keyboard
// focus and is announced politely (tip-host.tsx draws it).
//
// In a browser driven by a test (navigator.webdriver) or the desktop app started by its tests
// (testMode) it is not shown unless the page's address carries `arrange-tip=1` (ARRANGE_TIP_PARAM),
// as the Files panel's storage notice does, so that the checks and end-to-end tests of 1.0.0 see the
// window they always saw (errata M2).

import type { AppState } from '../../contracts';
import { arrangeTipAnswered } from '../../core/plus/settings';
import { ARRANGE_TIP_PARAM } from './texts';

export interface TipEnvironment {
  /** navigator.webdriver: the page is driven by a test. */
  automated: boolean;
  /** The page's address carries arrange-tip=1. */
  forced: boolean;
}

/** Whether the tip is on the screen now. */
export function tipDue(state: Pick<AppState, 'mode' | 'sim' | 'settings'>, environment: TipEnvironment): boolean {
  if (environment.automated && !environment.forced) return false;
  if (arrangeTipAnswered(state.settings)) return false;
  return state.mode === 'simulator' && state.sim.phase === 'idle';
}

/** True when the address's query (location.search) asks for the tip: arrange-tip=1. */
export function tipForcedBy(search: string): boolean {
  try {
    return new URLSearchParams(search).get(ARRANGE_TIP_PARAM) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether the platform says that a test started the application: the desktop app started by
 * tests/desktop/dev (DesktopPlatform.testMode, set by the main process from
 * EASY68K_DESKTOP_TEST_WINDOWS). Playwright starts Electron without --enable-automation, so
 * navigator.webdriver cannot be relied on there; the desktop tests are known by this instead.
 */
export function platformUnderTest(platform: unknown): boolean {
  return typeof platform === 'object' && platform !== null && (platform as { testMode?: unknown }).testMode === true;
}

/**
 * What the decision needs from the browser and the platform; without a window (Node) the tip is
 * never shown. A page driven by a test is navigator.webdriver (Playwright's browsers) or a desktop
 * app in test mode (platformUnderTest).
 */
export function readTipEnvironment(platform?: unknown): TipEnvironment {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { automated: true, forced: false };
  return {
    automated: navigator.webdriver === true || platformUnderTest(platform),
    forced: tipForcedBy(window.location?.search ?? ''),
  };
}
