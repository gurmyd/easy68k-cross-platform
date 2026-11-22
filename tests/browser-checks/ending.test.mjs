// Test of the guarded ending of the browser check scripts (ending.mjs). Owner: W0.
//
//   node --test tests/browser-checks/ending.test.mjs
//
// Fakes stand in for Playwright's browser, context and page and for Vite's server; a close that
// never answers is the case of WebKit for Windows (errata/W0.md).

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { closeAtEnd, closeWithin, doneWith, endChecks, kindOf } from './ending.mjs';

const never = () => new Promise(() => {});
const fakeBrowser = (close) => ({ newContext() {}, browserType: () => ({ name: () => 'webkit' }), close });
const fakeContext = (close) => ({ newPage() {}, addInitScript() {}, close });
const fakePage = (close) => ({ goto() {}, evaluate() {}, close });
const fakeServer = (close) => ({ listen() {}, httpServer: {}, close });

/** Runs `fn` with console.log captured; returns its result and the lines printed. */
async function capture(fn) {
  const lines = [];
  const log = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = log;
  }
}

test('kinds: page, context, browser, server', () => {
  assert.equal(kindOf(fakePage()), 'page');
  assert.equal(kindOf(fakeContext()), 'context');
  assert.equal(kindOf(fakeBrowser()), 'browser');
  assert.equal(kindOf(fakeServer()), 'server');
  assert.equal(kindOf(createServer()), 'server');
  assert.equal(kindOf({ close() {} }), 'other');
});

test('a close that never answers: closeWithin returns within its limit and prints the note', async () => {
  const started = Date.now();
  const { result, lines } = await capture(() => closeWithin(fakeBrowser(never), { seconds: 0.3 }));
  const took = Date.now() - started;
  assert.equal(result, false);
  assert.ok(took >= 250 && took < 2_000, `took ${took} ms`);
  assert.deepEqual(lines, ['note: closing the webkit browser did not answer within 0.3 s']);
});

test('a close that answers: true, no note; one that fails: a note, never a rejection', async () => {
  let closed = 0;
  const ok = await capture(() =>
    closeWithin(
      fakeContext(async () => void closed++),
      { seconds: 1 },
    ),
  );
  assert.equal(ok.result, true);
  assert.deepEqual(ok.lines, []);
  assert.equal(closed, 1);
  const failed = await capture(() =>
    closeWithin(
      fakePage(async () => {
        throw new Error('Target closed\nmore');
      }),
      { seconds: 1 },
    ),
  );
  assert.equal(failed.result, false);
  assert.deepEqual(failed.lines, ['note: closing a page failed: Target closed']);
});

test("a Node server's close() returns no promise: nothing more is waited for", async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { result, lines } = await capture(() => closeWithin(server, { seconds: 1 }));
  assert.equal(result, true);
  assert.deepEqual(lines, []);
  assert.equal(server.listening, false);
});

test('EASY68K_CHECK_HANG_CLOSE makes the closes of the named kinds hang, without calling them', async () => {
  let called = 0;
  process.env.EASY68K_CHECK_HANG_CLOSE = 'context';
  try {
    const hung = await capture(() =>
      closeWithin(
        fakeContext(async () => void called++),
        { seconds: 0.2 },
      ),
    );
    assert.equal(hung.result, false);
    assert.equal(called, 0);
    assert.deepEqual(hung.lines, ['note: closing a browser context did not answer within 0.2 s']);
    const other = await capture(() =>
      closeWithin(
        fakeServer(async () => void called++),
        { seconds: 0.2 },
      ),
    );
    assert.equal(other.result, true);
    assert.equal(called, 1);
  } finally {
    delete process.env.EASY68K_CHECK_HANG_CLOSE;
  }
});

test('doneWith closes an earlier browser now (within the limit) and leaves the last one to endChecks', async () => {
  const closed = [];
  await doneWith(
    fakeBrowser(async () => void closed.push('first')),
    { last: false },
  );
  assert.deepEqual(closed, ['first']);
  await doneWith(
    fakeBrowser(async () => void closed.push('last')),
    { last: true },
  );
  assert.deepEqual(closed, ['first']);
  await endChecks(0, { seconds: 0.3, exit: () => {} });
  assert.deepEqual(closed, ['first', 'last']);
});

test('endChecks closes contexts, browsers, then servers, each within its limit, then exits with the code', async () => {
  const order = [];
  closeAtEnd(fakeServer(async () => void order.push('server')));
  closeAtEnd(
    fakeBrowser(() => {
      order.push('browser (hangs)');
      return never();
    }),
  );
  closeAtEnd(fakeContext(async () => void order.push('context')));
  closeAtEnd(null); // a launch that failed: nothing to close
  let exited = null;
  const started = Date.now();
  const { lines } = await capture(() => endChecks(3, { seconds: 0.3, exit: (code) => (exited = code) }));
  assert.ok(Date.now() - started < 3_000);
  assert.deepEqual(order, ['context', 'browser (hangs)', 'server']);
  assert.deepEqual(lines, ['note: closing the webkit browser did not answer within 0.3 s']);
  assert.equal(exited, 3);
  // Nothing is left for a second call.
  const again = await capture(() => endChecks(0, { seconds: 0.3, exit: (code) => (exited = code) }));
  assert.deepEqual(again.lines, []);
  assert.equal(exited, 0);
});
