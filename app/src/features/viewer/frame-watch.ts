// The PDF frame shows the viewer's own document and nothing else (decision D-c of the stage's gate,
// 22 November 2026; errata N6 14). Owner: N6. Pure: runs under Node.
//
// The frame has no sandbox (P3.4.2), and before a service worker controls the page (a first visit)
// or in the desktop app (no worker), nothing refuses a navigation of it to the application's own
// address: a link inside a PDF, or a script, could show a second copy of the application in it. The
// panel therefore looks at the frame's address after each of its load events and a few times a
// second, and when the frame is found to show something that is not its document, it puts the
// document back in a fresh frame (ViewerPanel.tsx). What the page can see, measured in Chromium and
// WebKit (Playwright's builds, Windows, production build without a worker):
//   - the application's page, its ?open= address, about:blank: readable, with that address;
//   - another site or a data: document refused by frame-src: not readable (Chromium's error page,
//     a SecurityError) or about:blank (WebKit keeps an empty document);
//   - the viewer's own PDF: Chromium reads the blob: address itself; WebKit reads about:blank (its
//     PDF document is not the blob's as far as the page can tell).
// So: the blob: address (without a fragment, which the PDF viewer may add) is ours; a frame without
// a window yet decides nothing; about:blank decides nothing until ours has been seen there (WebKit's
// own PDF looks so, and it is empty), and after that (Chromium) it is not ours once the frame has
// loaded it or it is read twice in a row (decision D-j of the gate's fourth round; a frame that is
// loading its document again, as a moved frame does, is empty for a moment); an address the page
// cannot read is not ours once ours has been seen there (Chromium), and decides nothing before (a
// browser whose PDF viewer the page cannot read would otherwise loop); any other readable address
// is not ours. In WebKit, which never shows the page the blob's address, a frame sent to about:blank
// therefore stays empty (errata N6 14: the gap that remains). A guard stops putting the document back after RESTORE_LIMIT times in
// RESTORE_WINDOW_MS, so that a browser that reports its own document in a way not foreseen here
// cannot make the panel load it again and again.

/** How often the panel reads the frame's address besides its load events. */
export const FRAME_WATCH_MS = 200;
/** At most this many restores ... */
export const RESTORE_LIMIT = 5;
/** ... within this time. */
export const RESTORE_WINDOW_MS = 10_000;

/** What the page read of the frame's address: a string, `unreadable` (another origin), or `none` (no window). */
export type FrameAddress = string | { readonly unreadable: true } | null;

export type FrameVerdict = 'ours' | 'foreign' | 'undecided';

const withoutFragment = (address: string) => {
  const hash = address.indexOf('#');
  return hash < 0 ? address : address.slice(0, hash);
};

export interface FrameWatch {
  /**
   * The verdict on one reading of the frame's address; `loaded` is true for the reading at the
   * frame's load event (the frame has finished loading what it shows).
   */
  observe(address: FrameAddress, loaded?: boolean): FrameVerdict;
}

/** A watch of one frame whose own document is `expected` (a blob: URL). */
export function createFrameWatch(expected: string): FrameWatch {
  const own = withoutFragment(expected);
  let seenOurs = false;
  let blankBefore = false;
  return {
    observe(address, loaded = false) {
      const blank = address === 'about:blank' || address === '';
      const blankAgain = blank && blankBefore;
      blankBefore = blank;
      if (address === null) return 'undecided';
      if (typeof address !== 'string') return seenOurs ? 'foreign' : 'undecided';
      // Decision D-j: an empty document after the frame's own was seen there (Chromium) is not
      // ours, once it is loaded or read twice in a row: a frame the dock moves loads its document
      // again and is empty for a moment. Before (WebKit shows its own PDF so) it decides nothing.
      if (blank) return seenOurs && (loaded || blankAgain) ? 'foreign' : 'undecided';
      if (withoutFragment(address) === own) {
        seenOurs = true;
        return 'ours';
      }
      return 'foreign';
    },
  };
}

/** Allows a restore unless RESTORE_LIMIT of them happened within the last RESTORE_WINDOW_MS. */
export function createRestoreGuard(limit = RESTORE_LIMIT, windowMs = RESTORE_WINDOW_MS) {
  const times: number[] = [];
  return {
    allow(now: number): boolean {
      while (times.length > 0 && now - times[0]! >= windowMs) times.shift();
      if (times.length >= limit) return false;
      times.push(now);
      return true;
    },
  };
}

/** Reads a frame's address the way the page can (the DOM part of the watch). */
export function readFrameAddress(frame: {
  readonly contentWindow: { readonly location: { readonly href: string } } | null;
}): FrameAddress {
  try {
    const view = frame.contentWindow;
    return view ? view.location.href : null;
  } catch {
    return { unreadable: true };
  }
}
