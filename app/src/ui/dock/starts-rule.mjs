// What main does from the starting points of check-dock.mjs's pass `starts` on a system where Tab
// does not stop at plain buttons (errata N1 29). Owner: N1.
//
// check-dock.main.json was recorded from main's build in browsers that stop at every button with
// Tab (Playwright's Chromium, and its WebKit on Windows and Linux). WebKit on macOS does not stop
// at a plain button, check box or radio button without the system's keyboard navigation setting
// (Safari's "Press Tab to highlight each item"; the macOS runners of GitHub have it off), so there
// main visits fewer stops than its recording. These functions derive main's figures on such a
// system from the recording and from what the same run observes, by one rule:
//
// 1. The stops this browser never reaches are those of the recording's plain walks (the focused
//    element gone at the end or the start of the page, nothing else perturbed) that the run's own
//    plain walks never visit (`skippedStops`). Each must be a plain control in the page
//    (`isPlainControl`: a native button, or a check box, radio button or file field, without a
//    tabindex attribute of its own); the caller checks that in the page.
// 2. A plain walk is main's when it is the recorded walk with exactly those stops taken out.
// 3. A walk in which the focused element went away beside each stop is main's when it is the
//    recorded walk with those stops taken out and, for each step of the recording that started at
//    one of them (a start this system never has), the stops of main's plain order between that
//    stop and the next one recorded put back (`expectedWalk`): WebKit's step from a removed element
//    before a button skips a stop now and then (main's own figures in EASyBIN), and on this system
//    that step is never taken.
// 4. A single step is main's when its start is the recorded one and its stop the recorded one, or,
//    when that is one of those stops, the first stop after it in main's plain order that is not
//    (`expectedStep`).
// With no stop skipped (every system where Tab stops at buttons) each rule is the recording itself,
// unchanged: the comparison stays exact there.

/** The input types that WebKit on macOS passes over with Tab unless the tabindex is set. */
export const PLAIN_INPUT_TYPES = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'color'];

/**
 * Whether an element is a plain control: focusable only because it is a button, check box, radio
 * button or file field, with no tabindex attribute of its own.
 * @param {{ tag: string, type: string, tabindex: boolean }} element
 */
export function isPlainControl(element) {
  if (element.tabindex) return false;
  const tag = element.tag.toLowerCase();
  if (tag === 'button') return true;
  return tag === 'input' && PLAIN_INPUT_TYPES.includes(element.type.toLowerCase());
}

/** The entries of the recorded plain walks that no observed plain walk visits, in recorded order. */
export function skippedStops(recordedWalks, observedWalks) {
  const seen = new Set(observedWalks.flat());
  const out = [];
  for (const entry of recordedWalks.flat()) if (!seen.has(entry) && !out.includes(entry)) out.push(entry);
  return out;
}

/** The distinct walks of `walks` with the entries of `skipped` taken out. */
export function withoutStops(walks, skipped) {
  const set = new Set(skipped);
  const out = walks.map((walk) => walk.filter((entry) => !set.has(entry)));
  return [...new Set(out.map((walk) => JSON.stringify(walk)))].map((walk) => JSON.parse(walk));
}

const isKeys = (entry) => entry.startsWith('textarea|');

/**
 * Main's plain order of the page from its start, from the recorded plain walks: the walk from the
 * start (up to the body, or up to the Output panel's key field, which keeps Tab), then what the walk
 * from the end reached before that key field, reversed.
 */
export function plainOrder(forwardWalk, backwardWalk) {
  const forward = forwardWalk.filter((entry) => entry !== 'body');
  if (forward.length === 0 || !isKeys(forward[forward.length - 1])) return forward;
  const back = backwardWalk.filter((entry) => entry !== 'body');
  const after = back.length > 0 && isKeys(back[back.length - 1]) ? back.slice(0, -1).reverse() : [];
  return [...forward, ...after];
}

/**
 * Main's walk with the focused element gone beside each stop, on a system that passes over the
 * `skipped` stops (rule 3). `order` is main's plain order in the walk's direction. Null when the
 * recording cannot be read so (a skipped stop that is not once in the order, or a next stop not
 * after it): the caller then fails.
 */
export function expectedWalk(recorded, skipped, order) {
  const set = new Set(skipped);
  const out = [];
  for (let i = 0; i < recorded.length; i++) {
    const entry = recorded[i];
    if (!set.has(entry)) {
      out.push(entry);
      continue;
    }
    const next = recorded[i + 1];
    if (next === undefined) continue;
    const at = order.indexOf(entry);
    if (at < 0 || order.indexOf(entry, at + 1) >= 0) return null;
    const to = next === 'body' ? order.length : order.indexOf(next, at + 1);
    if (to < 0) return null;
    out.push(...order.slice(at + 1, to).filter((stop) => !set.has(stop)));
  }
  return out;
}

/**
 * Main's single step `{ from, to }` on a system that passes over the `skipped` stops (rule 4);
 * `order` is main's plain order in the step's direction. Null when the start is a skipped stop or
 * the stop is not in the order.
 */
export function expectedStep(recorded, skipped, order) {
  const set = new Set(skipped);
  if (set.has(recorded.from)) return null;
  if (!set.has(recorded.to)) return recorded;
  const at = order.indexOf(recorded.to);
  if (at < 0) return null;
  const next = order.slice(at + 1).find((stop) => !set.has(stop));
  return { from: recorded.from, to: next ?? 'body' };
}

/**
 * Main's figure for one key of the pass on this system: the recording itself where nothing is
 * skipped, else by the rule for its kind. `plain` holds main's recorded plain walks (`forward`,
 * `backward`: the first of each key). Null when the rule cannot derive it.
 * @param {'walks' | 'walk' | 'step'} kind  `walks`: the distinct plain walks of a key; `walk`: a
 *   walk with the focused element gone beside each stop; `step`: a single step
 */
export function mainHere(kind, recorded, skipped, plain, backward) {
  if (recorded === undefined) return undefined;
  if (skipped.length === 0) return recorded;
  const forwardOrder = plainOrder(plain.forward, plain.backward);
  const order = backward ? [...forwardOrder].reverse() : forwardOrder;
  if (kind === 'walks') return withoutStops(recorded, skipped);
  if (kind === 'walk') return expectedWalk(recorded, skipped, order);
  return expectedStep(recorded, skipped, order);
}
