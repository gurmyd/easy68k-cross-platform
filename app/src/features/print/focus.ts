// Where the keyboard focus goes after printing. Owner: E6.
//
// The web platform prints from a hidden frame that it focuses for the browser's print dialog and
// removes when the dialog closes (app/src/platform/web.ts). A removed frame takes the focus with
// it: the page is left with the focus on its body, or in no document at all (document.hasFocus()
// false), so the editor or the panel the person was in no longer has it and the next shortcut is
// not heard where they expect it (errata/E6.md). Print and Printer Setup therefore remember the
// element that had the focus and give it back when they are done, whether the print dialog was
// confirmed, cancelled or never shown, and after a failure's message box.
//
// The logic is a plain function over a small environment, so it is tested under Node; the browser
// environment is `browserFocusEnvironment()`.

/** An element that can take the focus again. */
export interface FocusTarget {
  focus(options?: { preventScroll?: boolean }): void;
}

/** What the restoring needs from the page. */
export interface FocusEnvironment {
  /** The element that has the focus in the top document, or null for none (or the body). */
  active(): FocusTarget | null;
  /** Whether `target` can still take the focus (it is in the document; it is not a frame). */
  usable(target: FocusTarget): boolean;
  /** Gives the top window the focus back (a removed frame may have taken it away). */
  focusWindow(): void;
}

/** The page's own environment; null where there is no document (unit tests, a worker). */
export function browserFocusEnvironment(win: Window | undefined = globalThis.window): FocusEnvironment | null {
  if (!win?.document) return null;
  const doc = win.document;
  return {
    active() {
      const element = doc.activeElement;
      if (!element || element === doc.body || element === doc.documentElement) return null;
      return element as unknown as FocusTarget;
    },
    usable(target) {
      const element = target as unknown as Element;
      return element.isConnected && element.ownerDocument === doc && element.tagName !== 'IFRAME';
    },
    focusWindow() {
      win.focus();
    },
  };
}

/**
 * The focus keeper of one print command: `remember()` notes the element that has the focus now (the
 * command calls it when it starts and again just before the print dialog, after its own dialog has
 * closed); `restore()` gives the focus to the most recent of them that is still usable.
 */
export interface FocusKeeper {
  remember(): void;
  restore(): void;
}

export function focusKeeper(env: FocusEnvironment | null): FocusKeeper {
  const remembered: FocusTarget[] = [];
  return {
    remember(): void {
      const target = env?.active();
      if (target && env?.usable(target)) remembered.push(target);
    },
    restore(): void {
      if (!env) return;
      env.focusWindow();
      for (let i = remembered.length - 1; i >= 0; i--) {
        const target = remembered[i]!;
        if (!env.usable(target)) continue;
        target.focus({ preventScroll: true });
        return;
      }
    },
  };
}

/** Runs `job` and gives the focus back afterwards, whatever the job's outcome. */
export async function keepingFocus<T>(
  env: FocusEnvironment | null,
  job: (keeper: FocusKeeper) => Promise<T>,
): Promise<T> {
  const keeper = focusKeeper(env);
  keeper.remember();
  try {
    return await job(keeper);
  } finally {
    keeper.restore();
  }
}
