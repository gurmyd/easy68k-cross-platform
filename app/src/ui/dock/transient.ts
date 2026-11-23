// Transient tabs: the viewers of files that are not text (ARCHITECTURE-PLUS P3.1.2, P3.4, P4.4).
// Owner: N1.
//
// A transient panel is not a PanelSpec, is not in the PanelRegistry and is never stored. The dock
// keeps its spec (title, tool-tip, content, onClose) while its tab is open; onClose runs once,
// whenever the tab goes away (its x, the Delete key or the tab menu, closeTransient, a mode
// change), so that the viewer can revoke its blob: URL.

import type { TransientSpec } from '../../state/dock';

export class TransientTabs {
  private readonly specs = new Map<string, TransientSpec>();

  has(id: string): boolean {
    return this.specs.has(id);
  }

  get(id: string): TransientSpec | undefined {
    return this.specs.get(id);
  }

  /** The open ones, in the order they were opened. */
  ids(): string[] {
    return [...this.specs.keys()];
  }

  /** Keeps a spec; a second spec for an open id replaces the first (whose onClose does not run). */
  add(spec: TransientSpec): void {
    this.specs.set(spec.id, spec);
  }

  /** Forgets a spec and runs its onClose (an exception of onClose is logged, never thrown). */
  close(id: string): void {
    const spec = this.specs.get(id);
    if (!spec) return;
    this.specs.delete(id);
    try {
      spec.onClose();
    } catch (error) {
      console.error(`The tab "${spec.title}" failed to close:`, error);
    }
  }
}
