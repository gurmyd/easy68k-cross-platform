// The tip about arranging the panels (ARCHITECTURE-PLUS P9.3, version 1.1), drawn. Owner: M2.
//
//   +-----------------------------------------------------------------------------------+
//   | You can rearrange this window: double-click a panel's tab to make it float, drag   |
//   | tabs to dock them elsewhere, or pick a ready-made layout in the View menu.         |
//   |                                                    [ Arrange Panels ] [ Got it ]   |
//   +-----------------------------------------------------------------------------------+
//   status bar
//
// The shell has no place for a feature's notice outside a panel, and the tip belongs to no panel,
// so the feature draws it itself (watchArrangeTip, from its init): while the tip is due (tip.ts) an
// element of its own is put at the end of the page's body, a polite live region (role status), and
// the tip is rendered into it a moment later, so that screen readers announce it. It is placed
// above the status bar at the left, below the toolbar's and above the floating windows' layer, and
// below every dialog and menu. Nothing in it takes the focus by itself; when a button of it held
// the focus, the focus goes back to where it was before (or to the Registers panel).

import { createRoot, type Root } from 'react-dom/client';
import type { AppContext } from '../../contracts';
import { withArrangeTipAnswered } from '../../core/plus/settings';
import { dockOf } from '../../state/dock';
import { focusPanel } from '../../state/panels';
import { Button } from '../../ui/components';
import './layout.css';
import { ARRANGE_TIP_TEXTS } from './texts';
import { readTipEnvironment, tipDue, type TipEnvironment } from './tip';

export interface ArrangeTipProps {
  /** `Arrange Panels`: unlocks the layout; the tip closes. */
  onArrange(): void;
  /** `Got it`: the tip closes. */
  onDismiss(): void;
}

export function ArrangeTip({ onArrange, onDismiss }: ArrangeTipProps) {
  return (
    <div className="e68-arrangetip">
      <p className="e68-arrangetip__text">{ARRANGE_TIP_TEXTS.text}</p>
      <div className="e68-arrangetip__buttons">
        <Button size="small" caption={ARRANGE_TIP_TEXTS.arrange} onClick={onArrange} />
        <Button size="small" caption={ARRANGE_TIP_TEXTS.dismiss} onClick={onDismiss} />
      </div>
    </div>
  );
}

/** The attribute of the tip's element (checks and tests find it by it). */
export const ARRANGE_TIP_ATTRIBUTE = 'data-e68-arrange-tip';

/** `Arrange Panels` or `Got it`: remembered for this browser profile (every window hears it). */
export function answerArrangeTip(ctx: AppContext, unlock: boolean): void {
  ctx.settings.update(withArrangeTipAnswered);
  if (unlock) dockOf(ctx).setLocked(false);
}

/**
 * Shows the tip in this window while it is due and removes it when it is not (a program starts, the
 * mode changes, it was answered here or in another window). Returns the function that stops.
 */
export function watchArrangeTip(
  ctx: AppContext,
  environment: TipEnvironment = readTipEnvironment(ctx.platform),
): () => void {
  if (typeof document === 'undefined') return () => {};
  if (environment.automated && !environment.forced) return () => {};
  let host: HTMLElement | null = null;
  let root: Root | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The element that had the focus before it went into the tip. */
  let before: HTMLElement | null = null;

  const giveBackFocus = () => {
    const active = document.activeElement;
    if (!host || !active || !host.contains(active)) return;
    if (before && before.isConnected && !host.contains(before)) before.focus({ preventScroll: true });
    else focusPanel(ctx, 'registers');
  };
  const remove = () => {
    if (!host) return;
    giveBackFocus();
    clearTimeout(timer);
    const element = host;
    const rendered = root;
    host = null;
    root = null;
    before = null;
    // Unmounted after the current render, as React asks of a root unmounted during an event.
    queueMicrotask(() => {
      rendered?.unmount();
      element.remove();
    });
  };
  const answer = (unlock: boolean) => {
    // The element goes first, so that the store's change below finds nothing to remove.
    remove();
    answerArrangeTip(ctx, unlock);
  };
  const show = () => {
    if (host) return;
    const element = document.createElement('div');
    element.className = 'e68-arrangetip-host';
    element.setAttribute(ARRANGE_TIP_ATTRIBUTE, '');
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.addEventListener('focusin', (event) => {
      const from = event.relatedTarget;
      if (from instanceof HTMLElement && !element.contains(from)) before = from;
    });
    document.body.append(element);
    host = element;
    // The live region is in the page before its text, so that the text is announced.
    timer = setTimeout(() => {
      if (host !== element) return;
      root = createRoot(element);
      root.render(<ArrangeTip onArrange={() => answer(true)} onDismiss={() => answer(false)} />);
    }, 100);
  };
  const update = () => {
    if (tipDue(ctx.store.getState(), environment)) show();
    else remove();
  };
  update();
  const unsubscribe = ctx.store.subscribe(update);
  return () => {
    unsubscribe();
    remove();
  };
}
