// The dock's polite live region (ARCHITECTURE-PLUS P3.1.8): every move, by drag or command, is
// announced, and so are Reset Layout, Lock Layout and an opened viewer. Owner: N1.
//
// Each dock renders one visually hidden `role=status` element; announce() empties it and writes
// the text in the next frame, so that the same text said twice is read twice.

export class Announcer {
  private element: HTMLElement | null = null;
  private frame = 0;
  /** The last text announced (the browser check reads it; also useful under Node). */
  last = '';

  attach(element: HTMLElement | null): void {
    this.element = element;
  }

  announce(text: string): void {
    this.last = text;
    const element = this.element;
    if (!element) return;
    element.textContent = '';
    const view = element.ownerDocument.defaultView;
    if (!view) {
      element.textContent = text;
      return;
    }
    view.cancelAnimationFrame(this.frame);
    this.frame = view.requestAnimationFrame(() => {
      element.textContent = text;
    });
  }
}
