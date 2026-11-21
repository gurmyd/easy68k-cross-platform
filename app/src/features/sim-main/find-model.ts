// The search state of Search > Find... (sim-ui §6.7; SIM68Ku.cpp:818-851, findDialogS.cpp).
//
// The original keeps one static row index `i` in TForm1::find and a flag `findNext` in the dialog:
//
//   find(text, next):  if (!next) i = 3;  if (i >= count) return;
//                      search rows i.. for the text; on a hit select it and set i = hit + 1;
//                      then, if a row is selected, scroll it into view (also when nothing was
//                      found, as long as the search ran)
//   button:            find(text, findNext); findNext = true
//   text changed, dialog shown:   findNext = false
//   F3 in the dialog (text not empty):   find(text, true)  - continues from i even right after
//                      the text was changed (a quirk, kept: it decides which row is found)
//
// The index survives closing and re-opening the dialog, so it lives here, one per window.

import type { ListingViewApi } from '../../contracts';
import { FIRST_BODY_ROW } from '../../core/listing/view';

export interface FindOutcome {
  /** The row found, or null. */
  hit: number | null;
  /** The search ran (it does not when the previous search ended at the last row). The original
   *  then scrolls the selected row into view, found or not. */
  searched: boolean;
}

export class ListingFinder {
  /** The original's static `i`. */
  private position = FIRST_BODY_ROW;
  /** The dialog's `findNext`. */
  private next = false;

  /** TForm1::find(text, next). */
  find(listing: Pick<ListingViewApi, 'find' | 'rows'>, text: string, next: boolean): FindOutcome {
    if (!next) this.position = FIRST_BODY_ROW;
    if (this.position >= listing.rows.length) return { hit: null, searched: false };
    const hit = listing.find(text, this.position);
    if (hit < 0) {
      this.position = listing.rows.length;
      return { hit: null, searched: true };
    }
    this.position = hit + 1;
    return { hit, searched: true };
  }

  /** The `Find  (F3)` button. */
  pressFind(listing: Pick<ListingViewApi, 'find' | 'rows'>, text: string): FindOutcome {
    const outcome = this.find(listing, text, this.next);
    this.next = true;
    return outcome;
  }

  /** F3 while the dialog has the focus; nothing for an empty text. */
  pressF3(listing: Pick<ListingViewApi, 'find' | 'rows'>, text: string): FindOutcome {
    if (text === '') return { hit: null, searched: false };
    return this.find(listing, text, true);
  }

  /** The text was changed, or the dialog was shown: the next button press searches from the top. */
  restart(): void {
    this.next = false;
  }
}
