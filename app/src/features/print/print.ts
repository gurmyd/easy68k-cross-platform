// Print and Printer Setup of Editor mode (editor-ui §13; ARCHITECTURE.md 1.4 note 2). Owner: E6.
//
// File > Print (mnuPrintSourceClick, mainS.cpp:409-512):
//   1. The original's print dialog offers the range All / Selection. The system print dialog of a
//      browser cannot offer the editor's selection, so while the document has a selection the port
//      asks first, in its own small dialog `print.range` (All is preselected, as in the original's
//      dialog); without a selection there is nothing to choose and the step is skipped.
//   2. The print document is built by core/print (tabs expanded with the document's rule, page
//      break at the marker line, monochrome, the document font) and handed to Platform.print,
//      which shows the system print dialog (copies, printer). Cancel there prints nothing.
//   3. Any failure, including the division by zero of a fixed tab size of 0, shows the original's
//      `Printer error.  Please check printer.`.
//
// File > Printer Setup... (note 2): a web page cannot open a separate printer set-up, so it opens
// the same system print dialog, for the active document's whole text, or for an empty page when
// no document is open (errata/E6.md).

import { TabType, type AppContext, type DocumentState, type MessageBoxRequest } from '../../contracts';
import { buildPrintDocument, type PrintDocument } from '../../core/print';
import { browserFocusEnvironment, keepingFocus, type FocusEnvironment, type FocusKeeper } from './focus';

/** The dialog id of the range question (errata/E6.md: not in the list of 2.7). */
export const PRINT_RANGE_DIALOG_ID = 'print.range';

export type PrintRange = 'all' | 'selection';

/** The error box of a failed print job (mainS.cpp:508). */
export const PRINTER_ERROR: MessageBoxRequest = {
  title: 'Error',
  text: 'Printer error.  Please check printer.',
  icon: 'error',
  buttons: ['OK'],
};

/** The active document, or null. */
export function activeDocument(ctx: Pick<AppContext, 'store'>): DocumentState | null {
  const { items, activeId } = ctx.store.getState().documents;
  return items.find((item) => item.id === activeId) ?? null;
}

/** The print document of `doc` for the text `text` (the selection or the whole document). */
export function printDocumentFor(doc: DocumentState, text: string): PrintDocument {
  return buildPrintDocument({
    text,
    tabType: doc.tabType,
    tabSize: doc.tabSize,
    fontName: doc.fontName,
    fontSize: doc.fontSize,
    file: doc.path ?? doc.name,
  });
}

/** Hands a prepared document to the platform; on any failure shows the original's error box. */
async function submit(ctx: AppContext, keeper: FocusKeeper, make: () => PrintDocument): Promise<boolean> {
  try {
    const doc = make();
    // After the range question: the element its dialog gave the focus back to.
    keeper.remember();
    await ctx.platform.print(doc.html, doc.title);
    return true;
  } catch {
    await ctx.dialogs.messageBox(PRINTER_ERROR);
    return false;
  }
}

/**
 * File > Print. Resolves true when the document went to the system print dialog. Whatever the
 * outcome, the focus is given back to the element that had it (focus.ts).
 */
export function printActiveDocument(
  ctx: AppContext,
  focus: FocusEnvironment | null = browserFocusEnvironment(),
): Promise<boolean> {
  return keepingFocus(focus, (keeper) => printWith(ctx, keeper));
}

async function printWith(ctx: AppContext, keeper: FocusKeeper): Promise<boolean> {
  const doc = activeDocument(ctx);
  if (!doc) return false;
  const selected = ctx.documents.selection?.(doc.id)?.selected ?? '';
  let range: PrintRange = 'all';
  if (selected !== '') {
    const chosen = await ctx.dialogs.open<{ selection: boolean }, PrintRange | null>(
      PRINT_RANGE_DIALOG_ID,
      { selection: true },
      { modal: true },
    );
    if (chosen === null || chosen === undefined) return false;
    range = chosen;
  }
  // Read the text when the choice is made: the document is the same, the dialog was modal.
  return submit(ctx, keeper, () =>
    printDocumentFor(doc, range === 'selection' ? selected : ctx.documents.text(doc.id)),
  );
}

/** File > Printer Setup...: the system print dialog for the active document, or an empty page. */
export function printerSetup(
  ctx: AppContext,
  focus: FocusEnvironment | null = browserFocusEnvironment(),
): Promise<boolean> {
  return keepingFocus(focus, (keeper) => setupWith(ctx, keeper));
}

function setupWith(ctx: AppContext, keeper: FocusKeeper): Promise<boolean> {
  const doc = activeDocument(ctx);
  if (doc) return submit(ctx, keeper, () => printDocumentFor(doc, ctx.documents.text(doc.id)));
  return submit(ctx, keeper, () =>
    buildPrintDocument({
      text: '',
      tabType: TabType.Fixed,
      tabSize: 4,
      fontName: 'Courier New',
      fontSize: 10,
      file: '',
    }),
  );
}
