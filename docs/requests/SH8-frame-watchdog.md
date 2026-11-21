# Request from SH8: the frame watchdog must tick at the pace of a display (gate I1)

Status: done at gate I1 round 2 (W3), as asked. `createFrameScheduler()` in `app/src/state/browser.ts`
still waits `FRAME_WATCHDOG_MS` (250 ms) for a frame after each frame; once the watchdog has fired it
re-arms with `WATCHDOG_FRAME_MS` (1000 / 60 ms) until a frame arrives, which goes back to the 250 ms
wait. Test: `app/src/state/services.test.ts` ("calls from a timer when no frame has arrived for 250 ms");
errata W3.md entry 32. (Before: `check-run.mjs` measured about 175,000 instructions per second without
display frames in Chromium and WebKit on Windows, 142,000 and 200,000 on the macOS runner.)
Round 3 (W3): checked again and kept; the pace is decided in errata W3.md entry 32 (a call every
1000 / 60 ms; gaps over 50 ms lose the excess by `MAX_CATCHUP_MS`, as 4.5.5 has it). Measured
without frames: 1,004,366/s (Chromium) and 999,005/s (WebKit) here; on the macOS runner of run
44919519853, 516,053/s in Chromium with timers 69 ms late, 991,031/s in WebKit.

Addressed to: the shell engineer (`app/src/state/browser.ts`, W3's path), and for information to
DV2 and DV3 (risk R-20: "a program that stops while the window is minimised").

## Why

ARCHITECTURE.md 4.5.5: "A watchdog timer, re-armed by every frame, takes over whenever no frame has
arrived for 250 ms and calls the frame callbacks itself until frames return. ... The desktop app
disables background throttling, so there the watchdog keeps a program at its speed when the window
is hidden or minimised."

`createFrameScheduler()` in `app/src/state/browser.ts`, which the bootstrap puts on the context and
the run controller therefore uses, re-arms the watchdog with the same 250 ms after it has taken
over: a page without frames gets four "frames" per second. The governor of the run controller makes
up at most 50 ms of missed time per tick (`MAX_CATCHUP_MS`, 4.2), so the program then runs at
50 / 250 = one fifth of its speed, and the software timers of 4.5.3 (auto-interrupt, auto trace)
have a resolution of 250 ms. That is so wherever no browser throttles the timers, which is exactly
the desktop app's case.

Measured in the real application with `requestAnimationFrame` withheld, which is what a hidden or
minimised window looks like to the page (`app/src/features/run/check-run.mjs`, pass "no display
frames"): 199,930 instructions per second in Chromium and 167,414 in WebKit, where 1,000,000 are
set. A task 23 delay stayed exact (50 hundredths of a second for 50 units): its end has a timer of
its own.

SH8's own class had the same pace and is repaired (`FrameScheduler` in `app/src/core/run/clock.ts`,
errata SH8.md entry 25, tests in `clock.test.ts`).

## The change

In `createFrameScheduler()`: keep waiting `FRAME_WATCHDOG_MS` (250 ms) for a frame after each
frame, but once the watchdog has fired, re-arm it with about a display frame (1000 / 60 ms) until a
frame arrives again:

```ts
const armWatchdog = (delay = FRAME_WATCHDOG_MS) => {
  if (watchdog !== null) source.clearTimeout(watchdog);
  watchdog = source.setTimeout(() => {
    watchdog = null;
    if (callbacks.size === 0) return;
    run(source.now());
    if (callbacks.size > 0) armWatchdog(1000 / 60); // it stands in for the display now
  }, delay);
};
```

A frame that arrives calls `armWatchdog()` as today and so goes back to the 250 ms wait. In a
hidden browser tab the browser slows the timer down by itself (to about one per second), so nothing
changes there; in the desktop app the program keeps its speed.

## How to see it

`node app/src/features/run/check-run.mjs --browser all` prints, in the pass "no display frames",
`without display frames the program keeps running - N instructions per second (1,000,000 with
frames)`. With the change N is about 1,000,000 (the check only requires N > 0, so that it does not
depend on this request).
