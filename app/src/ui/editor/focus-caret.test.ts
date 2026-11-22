// Which focus keeps the caret (focus-caret.ts). The browser part is checked by the end-to-end test
// "after Save As on a slow machine the caret stays where it was" (tests/e2e/editor/editing.spec.ts).

import { describe, expect, it } from 'vitest';
import { focusWithoutPointer, POINTER_FOCUS_MS } from './focus-caret';

describe('focusWithoutPointer', () => {
  it('a focus without any pointer press, or long after one, came from code or the keyboard', () => {
    expect(focusWithoutPointer(undefined, 5000)).toBe(true);
    expect(focusWithoutPointer(1000, 1000 + POINTER_FOCUS_MS + 1)).toBe(true);
  });

  it("a focus right after a pointer press is the pointer's (the click places the caret)", () => {
    expect(focusWithoutPointer(1000, 1000)).toBe(false);
    expect(focusWithoutPointer(1000, 1000 + POINTER_FOCUS_MS)).toBe(false);
  });
});
