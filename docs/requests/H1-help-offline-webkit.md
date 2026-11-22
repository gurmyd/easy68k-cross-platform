Status: done (third round before I3). The architect took option 1 with limits a to e; built as erratum H1 11 (and DV1 15, X1 15); one correction note under ARCHITECTURE.md 7.6.

# H1: the Help frame offline in WebKit needs a decision on its sandbox

## What was found

`tests/e2e/app/offline.spec.ts`, "offline, Help > Help shows the introduction page", fails in WebKit
(it carries `test.fail` there; errata X1 entries 5b and 12). The cause is the frame's sandbox, not
the service worker's precache, its scope, a redirect or a path with spaces:

- WebKit does not send the navigation of a frame sandboxed **without** `allow-scripts` to the
  service worker. Probe (`build/FS1/probe-offline-help.mjs`, production build served by
  `tests/e2e/fixtures/serve.mjs`, Playwright 1.65.1, WebKit 27.2 on Windows; Chromium for comparison), page controlled by the worker,
  four frames on `help/main.htm`:

  | frame | WebKit online | WebKit offline | Chromium online and offline |
  |---|---|---|---|
  | no sandbox | from the worker, loads | loads | from the worker, loads |
  | `allow-same-origin allow-popups allow-popups-to-escape-sandbox` (the Help panel's) | **from the network** (`fromServiceWorker` false, then 304) | **fails**: "WebKit encountered an internal error" | from the worker, loads |
  | `allow-same-origin` | from the network | fails | from the worker, loads |
  | `allow-same-origin allow-scripts` | from the worker, loads | loads | from the worker, loads |

- A `fetch()` of the same page from the application page is answered by the worker offline
  (200, 1124 bytes), and the precache holds every one of the 242 help files.
- The rule holds online too, where Playwright's offline switch plays no part, so it is the engine's
  rule and real Safari is expected to show the same. MANUAL-TEST-MAC.md W1 now asks the tester to
  write down whether Help works offline in real Safari.

## What is asked

ARCHITECTURE.md 7.6 (and 2.7, erratum H1 9) fixes the frame as sandboxed without scripts. The
repair that works in every engine needs `allow-scripts` in the frame's sandbox, which is a change of
the security posture, so it is not made without the architect:

1. **Recommended:** `sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"`,
   and `tools/import-help.mjs` (H1) keeps the imported pages free of `<script>` elements and inline
   event attributes (they have none today: H1 errata, gate I2 round 1; checked again in this round,
   none of the shipped pages has `<script`, an `on...=` handler or `javascript:`) and puts `<meta http-equiv="Content-Security-Policy"
   content="script-src 'none'">` as the first element of each page's `<head>`, with a test that no
   imported page has a script or a handler left and that each has the policy first. No script can
   then run in the frame, so `allow-same-origin` with `allow-scripts` gives a page nothing it could
   use; 7.6's sentence would read "sandboxed, scripts forbidden by the pages' own policy".
2. Keep the sandbox and give WebKit no offline Help: record it in DIFFERENCES.md part 5 and keep
   the `test.fail` for WebKit (item 7 of 6.9 then needs that exception written down).

A third way (the panel fetches each page and shows it with `srcdoc` and a `<base>`) was looked at
and not recommended: links inside the page navigate the frame again and fail the same way offline,
and the panel may not attach listeners to a frame without scripts (erratum H1 9).
