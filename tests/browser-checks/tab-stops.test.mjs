// Test of the rule that says how many stops a walk with Tab has on a system (tab-stops.mjs).
//
//   node --test tests/browser-checks/tab-stops.test.mjs
//
// The figures of the Memory panel are those of GitHub's macOS runner (run 45809923850: 5 stops
// forward, 6 back) and of Windows (12 and more).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stopsOfWalk, stopsRequired } from './tab-stops.mjs';

const field = { safari: true };
const button = { safari: false };
// Four fields, three buttons, a group with a tabindex, four more buttons, a check box.
const MEMORY = [field, field, field, field, button, button, button, field, button, button, button, button, button];

test('where Tab stops at every control, the walk has every control from its start on', () => {
  assert.equal(stopsOfWalk(MEMORY, 0, false, true), 13);
  assert.equal(stopsOfWalk(MEMORY, 12, true, true), 13);
  assert.equal(stopsOfWalk(MEMORY, 4, false, true), 9);
  assert.equal(stopsOfWalk(MEMORY, 4, true, true), 5);
});

test("by Safari's rule the walk has its start and the fields after it", () => {
  // Forward from the first field: four fields and the group.
  assert.equal(stopsOfWalk(MEMORY, 0, false, false), 5);
  // Back from the last button, where the check put the focus: the button itself, then five stops.
  assert.equal(stopsOfWalk(MEMORY, 12, true, false), 6);
});

test('a walk that starts outside the region has no stop', () => {
  assert.equal(stopsOfWalk(MEMORY, -1, false, true), 0);
  assert.equal(stopsOfWalk(MEMORY, 13, false, true), 0);
  assert.equal(stopsOfWalk([], 0, false, true), 0);
});

test('the least number: the page and the old floor where buttons stop, the rule alone where not', () => {
  assert.equal(stopsRequired({ everywhere: 13, safari: 5 }, true, 12), 13);
  assert.equal(stopsRequired({ everywhere: 9, safari: 5 }, true, 12), 12);
  assert.equal(stopsRequired({ everywhere: 13, safari: 5 }, false, 12), 5);
});
