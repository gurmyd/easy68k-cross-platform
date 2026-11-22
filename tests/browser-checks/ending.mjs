// The guarded ending of the browser check scripts (the check-<name>.mjs files of app/src and tests/,
// convention of app/src/ui/shell/check-shell.mjs). Owner: W0 (errata/W0.md).
//
// Playwright's WebKit for Windows at times does not answer a close: in CI run 45034018006 the job
// "browser-checks (windows-latest, integration)" printed every check of check-wave2.mjs as passed
// and then hung until its 15-minute limit. No check may depend on a close being answered, so:
//
//   - while the checks run, a script closes the contexts it no longer needs with
//     `await closeWithin(context)`: at most CLOSE_LIMIT_SECONDS, then it goes on;
//   - where the script used to close a browser after its passes it calls
//     `await doneWith(browser, { last })`: an earlier browser is closed then, within the limit;
//     the last one, and the server, are handed to `closeAtEnd(x)`;
//   - when the checks are done the script prints its "N of M checks passed" line and then calls
//     `await endChecks(exitCode)`, which closes what was handed to closeAtEnd (pages, contexts,
//     browsers, then servers), each within its own limit, and ends the process with the exit
//     code itself once its output is flushed, so a child process that will not die cannot keep it
//     alive.
//
// A close that does not answer in time is reported on one line, "note: closing <what> did not
// answer within N s", and is not a failure of the check; a close that fails is a note as well. A
// failure while the checks run (an exception out of main) still ends the script as before.
//
// For the module's own test and the proof of errata/W0.md only: EASY68K_CHECK_HANG_CLOSE=<kinds>
// (comma-separated: page, context, browser, server, other; or all) makes every close of those
// kinds a close that never answers (the real close is not called).

/** How long one close may take before the script goes on without it. */
export const CLOSE_LIMIT_SECONDS = 10;

const ORDER = ['page', 'context', 'browser', 'server', 'other'];

/** The kind of a Playwright page, context or browser, or of a server; 'other' for anything else. */
export function kindOf(target) {
  if (!target || typeof target !== 'object') return 'other';
  if (typeof target.goto === 'function' && typeof target.evaluate === 'function') return 'page';
  if (typeof target.newContext === 'function' && typeof target.browserType === 'function') return 'browser';
  if (typeof target.newPage === 'function' && typeof target.addInitScript === 'function') return 'context';
  if (typeof target.listen === 'function' || typeof target.httpServer === 'object') return 'server';
  return 'other';
}

/** How a note names the target. */
function describe(target, kind) {
  if (kind === 'browser') {
    const name = typeof target.browserType === 'function' ? target.browserType().name() : '';
    return name ? `the ${name} browser` : 'the browser';
  }
  return { page: 'a page', context: 'a browser context', server: 'the server', other: 'a resource' }[kind];
}

function hangs(kind) {
  const kinds = (process.env.EASY68K_CHECK_HANG_CLOSE ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return kinds.includes('all') || kinds.includes(kind);
}

/**
 * Closes `target` (anything with a close() method) and waits at most `seconds` for it. Resolves
 * true when the close answered, false (after printing the note) when it did not or failed. Never
 * rejects. `what` overrides the name the note uses.
 */
export async function closeWithin(target, { what, seconds = CLOSE_LIMIT_SECONDS } = {}) {
  const kind = kindOf(target);
  const name = what ?? describe(target, kind);
  let timer;
  const closing = (async () => {
    if (hangs(kind)) return new Promise(() => {});
    const result = target.close();
    // A Node http.Server returns itself, not a promise: nothing to wait for (as `await` did).
    if (result && typeof result.then === 'function') await result;
  })();
  const limit = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), seconds * 1000);
  });
  try {
    const outcome = await Promise.race([closing.then(() => 'closed'), limit]);
    if (outcome === 'timeout') {
      console.log(`note: closing ${name} did not answer within ${seconds} s`);
      return false;
    }
    return true;
  } catch (error) {
    console.log(`note: closing ${name} failed: ${String(error?.message ?? error).split('\n')[0]}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const atEnd = [];

/** Leaves `target` open until endChecks closes it; returns it. */
export function closeAtEnd(target, what) {
  if (target) atEnd.push({ target, what });
  return target;
}

/**
 * A browser the script's loop over the browsers is done with: the last one is left to endChecks
 * (so the summary line comes first); an earlier one is closed now, within the limit, so that it
 * does not run beside the next browser (check-perf.mjs measures the memory of the process tree).
 */
export async function doneWith(target, { last }) {
  if (last) closeAtEnd(target);
  else await closeWithin(target);
}

/** Writes nothing to a stream and resolves once everything written before it has gone out. */
function flushed(stream) {
  return new Promise((resolve) => {
    if (!stream?.writable) return resolve();
    stream.write('', () => resolve());
  });
}

/**
 * The end of a check script, after its summary line: closes what closeAtEnd holds, each within
 * `seconds`, then ends the process with `exitCode`. `exit` is replaceable for the module's test.
 */
export async function endChecks(exitCode, { seconds = CLOSE_LIMIT_SECONDS, exit = (code) => process.exit(code) } = {}) {
  const pending = atEnd.splice(0).sort((a, b) => ORDER.indexOf(kindOf(a.target)) - ORDER.indexOf(kindOf(b.target)));
  for (const { target, what } of pending) await closeWithin(target, { what, seconds });
  await Promise.all([flushed(process.stdout), flushed(process.stderr)]);
  exit(exitCode);
}
