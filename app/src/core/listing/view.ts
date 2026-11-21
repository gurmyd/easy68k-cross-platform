// The listing pane's cached, decoded copy of the engine's listing (ARCHITECTURE.md 3.11.4).
//
// STUB written by W1 (wave 0). U1 replaces the body; the class name, the constructor signature and
// the exported names are contract (section 8, "Stubs"). This stub holds no rows.
//
// Owner: W1 > U1.

import type { ListingViewApi, SimEngine } from '../../contracts';

export class ListingView implements ListingViewApi {
  readonly rows: readonly string[] = [];

  constructor(private readonly engine: () => SimEngine) {}

  refresh(): void {}
  isInstruction(_row: number): boolean {
    return false;
  }
  addressOf(_row: number): number | null {
    return null;
  }
  find(_text: string, _fromRow: number): number {
    return -1;
  }
}
