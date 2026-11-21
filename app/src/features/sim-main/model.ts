// The state and actions behind the three panels of the original main window: Registers, Listing
// and Messages (ARCHITECTURE.md 2.3, 3.11.3, 3.11.4, 4.6; sim-ui §4-§7).
//
// One SimMainModel per window, created by the feature's init() and found with simMainOf(ctx). It
// holds what the panels draw and does what they ask, without React and without a DOM, so that it
// can be tested under Node against the real engine. The React components (RegistersPanel,
// ListingPanel, MessagesPanel, FindDialog) only render `view` and call the methods below.
//
// Where the data comes from:
//
//   register texts, cycles, highlight   ctx.sim.controller.snapshot (refreshed when the engine
//                                       called host.registersShown; SH8 bumps sim.regsRevision)
//   after an edit                       engine.boxText() of all twenty boxes (3.11.3)
//   listing rows                        ctx.sim.listing (refreshed by the controller after a load,
//                                       a close and a cold start)
//   PC breakpoints (gutter dots)        engine.breakpoints(), re-read when sim.viewRevision moves
//   selected row                        AppState.sim.selectedRow (the "cursor" of Run To Cursor)
//   message lines                       AppState.sim.messageLines (published by SH8)
//
// The engine is always read as ctx.sim.engine at the moment of use: a cold start replaces it.
// Every call that changes the engine goes through the run controller (section 0, rule 8).

import { Box, SimOption, type AppContext, type Store } from '../../contracts';
import { FIRST_BODY_ROW, upperAscii } from '../../core/listing/view';
import { createStore } from '../../state/store';
import { ListingFinder, type FindOutcome } from './find-model';
import { cyclesText } from './selection';

/** Box values in the order of the contract (D0..D7, A0..A7, US, SS, PC, SR). */
export const ALL_BOXES: readonly Box[] = Object.freeze(Array.from({ length: 20 }, (_unused, index) => index as Box));

/** The boxes whose double-click copies the value to the Memory panel (sim-ui §4.4, regDblClick). */
export const ADDRESS_BOXES: ReadonlySet<Box> = new Set<Box>([
  Box.A0,
  Box.A1,
  Box.A2,
  Box.A3,
  Box.A4,
  Box.A5,
  Box.A6,
  Box.A7,
  Box.US,
  Box.SS,
]);

export interface ScrollRequest {
  /** The row to bring on screen with the third-visible-row rule (selection.ts thirdRowScroll). */
  row: number;
  /** Distinguishes two requests for the same row. */
  serial: number;
}

export interface SimMainView {
  /** The twenty register texts, indexed by Box. */
  boxes: readonly string[];
  /** Boxes whose value differs from the previous refresh (section 1.4 note 31). */
  changed: readonly boolean[];
  /** The cycle counter's text. */
  cycles: string;
  /** The listing rows (ctx.sim.listing.rows at the last sync). */
  rows: readonly string[];
  /** Addresses of the PC breakpoints. */
  breakpoints: ReadonlySet<number>;
  /** The latest request to scroll the listing; the Listing panel applies each one once. */
  scroll: ScrollRequest | null;
  /** Bumped when Search > Find... is chosen while the Find dialog is open: it takes the focus. */
  findFocus: number;
}

const NO_CHANGES: readonly boolean[] = Object.freeze(new Array<boolean>(20).fill(false));

export class SimMainModel {
  readonly view: Store<SimMainView>;
  /** The state of Search > Find... (one per window, it survives closing the dialog). */
  readonly finder = new ListingFinder();
  /** The text of the Find dialog's edit box; it is still there when the dialog is shown again. */
  findText = '';

  private serial = 0;
  private seenRevision: number | null = null;
  private seenRows: readonly string[] | null = null;
  private seenViewRevision: number | null = null;
  private previousBoxes: readonly string[] | null = null;
  /** True while a snapshot refresh that is not a scrshow() is taken over (Clear Cycles). */
  private highlightBlocked = false;

  constructor(private readonly ctx: AppContext) {
    const snapshot = ctx.sim.controller.snapshot;
    this.view = createStore<SimMainView>({
      boxes: [...snapshot.boxes],
      changed: NO_CHANGES,
      cycles: cyclesText(snapshot.cycles),
      rows: ctx.sim.listing.rows,
      breakpoints: new Set(),
      scroll: null,
      findFocus: 0,
    });
  }

  /** Follows the controller, the store and cold starts. Returns the function that stops it. */
  start(): () => void {
    const sync = () => this.sync();
    const stops = [
      this.ctx.store.subscribe(sync),
      this.ctx.sim.controller.subscribe(sync),
      this.ctx.sim.onEngineReplaced(() => {
        // A new simulator: nothing "changed since the previous stop".
        this.previousBoxes = null;
        this.seenRevision = null;
        this.seenRows = null;
        this.sync();
      }),
    ];
    this.sync();
    return () => {
      for (const stop of stops) stop();
    };
  }

  /* ---------------------------------------------------------------- following the simulator */

  /**
   * Takes over what changed: a refreshed snapshot (register texts, cycles, the selection rule of
   * highlight()), replaced listing rows, and the breakpoints after a repaint. Cheap when nothing did.
   */
  sync(): void {
    const { controller, listing } = this.ctx.sim;
    const snapshot = controller.snapshot;
    const rows = listing.rows;
    const rowsReplaced = rows !== this.seenRows;
    const refreshed = snapshot.revision !== this.seenRevision;
    const viewRevision = this.ctx.store.getState().sim.viewRevision;
    const repainted = viewRevision !== this.seenViewRevision;
    if (!rowsReplaced && !refreshed && !repainted) return;

    let next = this.view.getState();
    if (refreshed) {
      const previous = this.previousBoxes;
      const changed = previous ? snapshot.boxes.map((text, index) => text !== previous[index]) : NO_CHANGES;
      next = { ...next, boxes: [...snapshot.boxes], changed, cycles: cyclesText(snapshot.cycles) };
      this.previousBoxes = snapshot.boxes;
    }
    if (rowsReplaced) next = { ...next, rows };
    if (rowsReplaced || repainted) next = { ...next, breakpoints: this.readBreakpoints() };

    // Selection: the original's highlight() at the end of every scrshow() (sim-ui §6.4; errata
    // U1.md entry 1). When the PC field matches a row, that row becomes the selection, also when it
    // is the row it was before and the user has clicked another one since; when no row matches,
    // the selection stays. Either way the selection is then scrolled into view if it is off screen.
    // New rows (a load, a close, a cold start) always start from the engine's row.
    let select: number | null = null;
    let reveal = false;
    if (rowsReplaced) {
      select = snapshot.highlight;
      reveal = true;
    } else if (refreshed && !this.highlightBlocked && this.highlightRan()) {
      if (this.highlightMatches(snapshot.highlight, snapshot.boxes[Box.PC] ?? '', snapshot.halted)) {
        select = snapshot.highlight;
      }
      reveal = true;
    }
    const revealRow = select ?? this.selectedRow;
    if (reveal && revealRow >= 0) {
      next = { ...next, scroll: { row: revealRow, serial: ++this.serial } };
    }

    // Mark everything as seen first: the store change below calls sync() again at once.
    this.seenRevision = snapshot.revision;
    this.seenRows = rows;
    this.seenViewRevision = viewRevision;
    if (select !== null) this.setSelected(select);
    if (next !== this.view.getState()) this.view.setState(() => next);
  }

  /**
   * Whether the engine ran highlight() in the scrshow() that refreshed the snapshot. It skips it
   * during an Auto Trace step with `Disable display update` checked (STARTSIM.CPP:170), and then
   * the listing does not follow the PC (sim-ui §4.2, §6.4).
   *
   * The engine's `autoTraceInProgress` is true only inside a tick, so after the call the Auto
   * Trace timer stands for it. One stop differs (errata U1.md entry 1): a step that halts or hits a
   * breakpoint during such an Auto Trace switches the timer off before its scrshow(), so the
   * original skips highlight() there while the port lets the listing follow.
   */
  private highlightRan(): boolean {
    const { controller, engine } = this.ctx.sim;
    if (controller.phase === 'loading') return true; // nothing reads the engine during a load (4.7)
    try {
      const flags = engine.state();
      const autoTracing = flags.autoTraceTimer || flags.autoTraceInProgress;
      return !(autoTracing && engine.getOption(SimOption.DisableDisplay) !== 0);
    } catch {
      return true;
    }
  }

  /**
   * The match test of highlight() (SIM68Ku.cpp:785-807) applied to the row the engine selected:
   * true when that row's first 8 characters, upper-cased, equal the PC field and it is an
   * instruction row or the program has halted. The engine keeps its last row when nothing
   * matched, so this tells whether highlight() found the PC this time.
   */
  private highlightMatches(row: number, pcText: string, halted: boolean): boolean {
    const listing = this.ctx.sim.listing;
    const text = listing.rows[row];
    if (row < FIRST_BODY_ROW || text === undefined) return false;
    return upperAscii(text).slice(0, 8) === pcText && (halted || listing.isInstruction(row));
  }

  private readBreakpoints(): ReadonlySet<number> {
    return new Set(this.ctx.sim.engine.breakpoints().map((address) => address >>> 0));
  }

  private refreshBreakpoints(): void {
    const breakpoints = this.readBreakpoints();
    const current = this.view.getState().breakpoints;
    if (breakpoints.size === current.size && [...breakpoints].every((address) => current.has(address))) return;
    this.view.setState((view) => ({ ...view, breakpoints }));
  }

  /* ---------------------------------------------------------------- selection */

  get selectedRow(): number {
    return this.ctx.store.getState().sim.selectedRow;
  }

  private setSelected(row: number): void {
    this.ctx.store.setState((state) =>
      state.sim.selectedRow === row ? state : { ...state, sim: { ...state.sim, selectedRow: row } },
    );
  }

  private requestScroll(row: number): void {
    if (row < 0) return;
    this.view.setState((view) => ({ ...view, scroll: { row, serial: ++this.serial } }));
  }

  /** A click on a row, or the arrow keys: the list box's own selection. */
  selectRow(row: number): void {
    const count = this.view.getState().rows.length;
    if (count === 0) return;
    this.setSelected(Math.max(0, Math.min(count - 1, Math.trunc(row))));
  }

  /**
   * The original's highlight() as far as the port needs it outside a refresh: Go to PC, a
   * double-click on the PC field, a typed PC. The engine has run highlight() itself (it keeps the
   * row in `listingHighlight`); when that row matches the PC field it becomes the selection. If
   * no row matches, the selection stays where it is. Either way the selection is scrolled into
   * view (sim-ui §6.4: "the same scroll rule runs even when the selection did not change").
   */
  followPC(): void {
    const { engine, controller } = this.ctx.sim;
    const row = engine.listingHighlight;
    if (this.highlightMatches(row, engine.boxText(Box.PC), controller.snapshot.halted)) this.setSelected(row);
    this.requestScroll(this.selectedRow);
  }

  /** Search > Go to PC (Ctrl+G). */
  gotoPC(): void {
    this.followPC();
  }

  /**
   * Double-click on a row (sim-ui §6.6): an instruction row's first 8 characters go into the PC
   * field. No index check here: the first header row passes too and sets the start address.
   */
  doubleClickRow(row: number): void {
    const listing = this.ctx.sim.listing;
    const text = listing.rows[row];
    if (text === undefined || !listing.isInstruction(row)) return;
    this.setSelected(row);
    this.editRegister(Box.PC, text.slice(0, 8));
  }

  /* ---------------------------------------------------------------- breakpoints */

  /**
   * A left click in the gutter (sim-ui §6.5): on an instruction row with index above 2, toggles
   * the PC breakpoint at its address. The engine shows `Breakpoint Limit Reached!` itself when
   * the table of 100 is full (host.alert, served by the run controller).
   */
  toggleBreakpoint(row: number): void {
    const listing = this.ctx.sim.listing;
    if (row < FIRST_BODY_ROW || !listing.isInstruction(row)) return;
    const address = listing.addressOf(row);
    if (address === null) return;
    // Decided when the call runs: a queued call sees the table as it is then.
    this.ctx.sim.controller.invoke((engine) => {
      if (engine.breakpoints().some((set) => set >>> 0 === address)) engine.clearBreakpoint(address);
      else engine.setBreakpoint(address);
    });
    this.refreshBreakpoints();
  }

  /** The gutter's context menu `Clear All PC Breakpoints` (sim-ui §3.3). */
  clearAllBreakpoints(): void {
    this.ctx.sim.controller.invoke((engine) => engine.clearAllBreakpoints());
    this.refreshBreakpoints();
  }

  /* ---------------------------------------------------------------- registers */

  /**
   * The user changed a register field (every keystroke): forwarded to the engine at once, then
   * all twenty texts are re-read, because the engine may have changed others (A7/US/SS mirroring,
   * the SR's S bit swapping A7). A typed PC moves the highlight (regPCChange).
   */
  editRegister(box: Box, text: string): void {
    this.ctx.sim.controller.editBox(box, text);
    const engine = this.ctx.sim.engine;
    const boxes = ALL_BOXES.map((each) => engine.boxText(each));
    this.view.setState((view) => ({ ...view, boxes }));
    if (box === Box.PC) this.followPC();
  }

  /**
   * Double-click on an address register (sim-ui §4.4, regDblClick): its text goes to the Memory
   * panel's Address field and that panel is shown. The Memory feature (U2) does both, and applies
   * its own Address-field rules, for `sim.view.memory` with the field's text as the argument.
   */
  copyToMemory(box: Box): void {
    if (!ADDRESS_BOXES.has(box)) return;
    const text = this.view.getState().boxes[box] ?? '';
    if (!/^[0-9A-Fa-f]{1,8}$/.test(text)) return;
    void this.ctx.commands.run('sim.view.memory', text);
  }

  /** The `Clear Cycles` button (sim-ui §5): works at any time and shows `0`. */
  clearCycles(): void {
    // The controller refreshes its snapshot for the new count, but this is no scrshow(): the
    // original's ClearCyclesClick does not run highlight(), so the selection must not move.
    this.highlightBlocked = true;
    try {
      this.ctx.sim.controller.clearCycles();
      this.sync();
    } finally {
      this.highlightBlocked = false;
    }
    this.view.setState((view) => ({ ...view, cycles: cyclesText(0n) }));
  }

  /* ---------------------------------------------------------------- find */

  /** Applies the outcome of a search: select the hit, scroll the selection into view. */
  private applyFind(outcome: FindOutcome): FindOutcome {
    if (outcome.hit !== null) this.setSelected(outcome.hit);
    if (outcome.searched) this.requestScroll(this.selectedRow);
    return outcome;
  }

  /** The Find dialog's `Find  (F3)` button. */
  findButton(text: string): FindOutcome {
    return this.applyFind(this.finder.pressFind(this.ctx.sim.listing, text));
  }

  /** F3 while the Find dialog has the focus. */
  findF3(text: string): FindOutcome {
    return this.applyFind(this.finder.pressF3(this.ctx.sim.listing, text));
  }

  /** Asks an open Find dialog to take the focus. */
  focusFind(): void {
    this.view.setState((view) => ({ ...view, findFocus: view.findFocus + 1 }));
  }
}

const models = new WeakMap<object, SimMainModel>();

/** Creates the model of a window (the feature's init) and starts it. Returns the stop function. */
export function attachSimMain(ctx: AppContext): () => void {
  const model = new SimMainModel(ctx);
  models.set(ctx, model);
  const stop = model.start();
  // The model stays reachable through the context after a dispose: a panel that renders once more
  // while its window is torn down still finds it (it then simply follows nothing).
  return stop;
}

/** The model of the window that `ctx` belongs to. */
export function simMainOf(ctx: AppContext): SimMainModel {
  const model = models.get(ctx);
  if (!model) throw new Error('The sim-main feature has not been initialised for this window');
  return model;
}
