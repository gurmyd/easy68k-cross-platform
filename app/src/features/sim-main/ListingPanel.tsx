// The Listing panel: the original's list box of .L68 lines with the breakpoint gutter on its left
// (sim-ui §6; ARCHITECTURE.md 2.3, 3.11.4).
//
//   - Rows are the raw listing lines, tabs expanded to 8-column stops, under the constant heading.
//     Only the visible rows are rendered (VirtualList), so 100,000 rows scroll like 100.
//   - The gutter draws a hollow green dot on every instruction row (index above 2) and a filled
//     red dot where a PC breakpoint is set; a left click toggles it, a right click offers
//     `Clear All PC Breakpoints`. The row of the current instruction also carries a PC marker
//     (added, 1.3.5).
//   - One selected row, moved by clicks and arrow keys and by the highlight rule of 3.11.4; a
//     double-click on an instruction row puts its address into the PC field.
//   - Horizontal scrolling is ordinary scrolling; the heading scrolls with the text (1.4 note 33).
//   - Added for the keyboard (docs/differences/U1.md): Enter does what a double-click does, Space
//     toggles the breakpoint of the selected row, Shift+F10 or the Menu key opens the gutter menu.

import {
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { useAppContext, useAppState } from '../../state/context';
import { useStoreValue } from '../../state/store';
import { ContextMenu, VirtualList, useContextMenu, type MenuEntry, type VirtualListHandle } from '../../ui/components';
import { simMainOf } from './model';
import { expandTabs, fullyVisibleRows, listingMetrics, thirdRowScroll } from './selection';

/** The heading label above the pane (SIM68Ku.cpp:33). */
export const LISTING_HEADING = ' Address  --------Code---------   Line -----------Source----------->>';

/** Width of the gutter in px (sim-ui §2: `breakPnl`, 24 px). */
export const GUTTER_WIDTH = 24;

const ROW_ID = (base: string, row: number) => `${base}-row-${row}`;

export function ListingPanel() {
  const ctx = useAppContext();
  const model = simMainOf(ctx);
  const view = useStoreValue(model.view, (state) => state);
  const selected = useAppState((state) => state.sim.selectedRow);
  const font = useAppState((state) => state.settings.sim.listingFont);
  const pcRow = useAppState(() => ctx.sim.controller.snapshot.highlight);
  const list = useRef<VirtualListHandle>(null);
  const heading = useRef<HTMLDivElement>(null);
  const applied = useRef(0);
  const context = useContextMenu();
  const { rows, breakpoints } = view;
  const { fontPx, rowHeight } = listingMetrics(font.size);
  const base = 'e68-listing';

  const isCode = useCallback((row: number) => row > 2 && ctx.sim.listing.isInstruction(row), [ctx, rows]);
  // Every row gets the width of the longest one (in character cells), so that the browser need not
  // measure each row's text and the gutter can stay at the left while the text scrolls sideways.
  const columns = useMemo(() => rows.reduce((widest, text) => Math.max(widest, expandTabs(text).length), 0), [rows]);

  // New rows (a load, a close, a cold start) start at the top, as the original's list box does:
  // `Items->Clear()` sends LB_RESETCONTENT, which sets the top index to 0, and `LoadFromFile` adds
  // the rows below it. A load that selects no row (errata U1.md entry 8) therefore shows the first
  // rows, not the place the previous program was scrolled to. Runs before the scroll request below,
  // which then brings a selected row on screen.
  useLayoutEffect(() => {
    const element = list.current?.element();
    if (element) element.scrollTop = 0;
  }, [rows]);

  // Scroll requests of the model (highlight, Go to PC, Find): the third-visible-row rule.
  useLayoutEffect(() => {
    const request = view.scroll;
    const element = list.current?.element();
    if (!request || request.serial === applied.current || !element) return;
    applied.current = request.serial;
    const { top, shown } = fullyVisibleRows(element.scrollTop, element.clientHeight, rowHeight);
    const next = thirdRowScroll(request.row, top, shown, rows.length);
    if (next !== null) list.current?.scrollToIndex(next, 'start');
  }, [view.scroll, rows.length, rowHeight]);

  // The heading follows the text sideways.
  const onScroll = () => {
    const element = list.current?.element();
    if (element && heading.current) heading.current.scrollLeft = element.scrollLeft;
  };
  useEffect(onScroll, [rows]);

  const select = (row: number, reveal: boolean) => {
    model.selectRow(row);
    if (reveal) list.current?.scrollToIndex(Math.max(0, Math.min(rows.length - 1, row)), 'auto');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    context.triggerProps.onKeyDown(event);
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    const element = list.current?.element();
    const page = element ? Math.max(1, Math.floor(element.clientHeight / rowHeight) - 1) : 10;
    const from = selected < 0 ? -1 : selected;
    let target: number;
    switch (event.key) {
      case 'ArrowDown':
        target = from + 1;
        break;
      case 'ArrowUp':
        target = Math.max(0, from - 1);
        break;
      case 'PageDown':
        target = from + page;
        break;
      case 'PageUp':
        target = Math.max(0, from - page);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = rows.length - 1;
        break;
      case 'Enter':
        if (selected >= 0) model.doubleClickRow(selected);
        event.preventDefault();
        return;
      case ' ':
        if (selected >= 0) model.toggleBreakpoint(selected);
        event.preventDefault();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (rows.length > 0) select(target, true);
  };

  /** A right click anywhere in the gutter strip, also below the last row (sim-ui §3.3). */
  const onContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    const element = list.current?.element();
    if (!element) return;
    const x = event.clientX - element.getBoundingClientRect().left;
    if (x >= 0 && x < GUTTER_WIDTH) context.triggerProps.onContextMenu(event);
  };

  const menu: MenuEntry[] = [
    {
      type: 'item',
      id: 'sim.bp.clearAllPC',
      caption: 'Clear All PC Breakpoints',
      onSelect: () => void ctx.commands.run('sim.bp.clearAllPC'),
    },
  ];

  const renderRow = (row: number) => {
    const text = rows[row] ?? '';
    const code = isCode(row);
    const address = code ? ctx.sim.listing.addressOf(row) : null;
    const on = address !== null && breakpoints.has(address);
    return (
      <>
        <span
          className="e68-listing__gutter"
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation();
            model.toggleBreakpoint(row);
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {code && <span className={on ? 'e68-listing__dot e68-listing__dot--on' : 'e68-listing__dot'} />}
          {row === pcRow && <span className="e68-listing__pc" />}
        </span>
        <span className="e68-listing__text">{expandTabs(text)}</span>
      </>
    );
  };

  const style = {
    '--e68-listing-font': `"${font.name}"`,
    '--e68-listing-size': `${fontPx}px`,
    '--e68-listing-gutter': `${GUTTER_WIDTH}px`,
    '--e68-listing-columns': String(columns),
  } as CSSProperties;

  return (
    <div className="e68-listing" style={style} onContextMenu={onContextMenu}>
      <div className="e68-listing__heading" ref={heading} aria-hidden="true">
        <span className="e68-listing__heading-text">{LISTING_HEADING}</span>
      </div>
      <VirtualList
        ref={list}
        className="e68-listing__list"
        role="listbox"
        aria-label="Listing"
        tabIndex={0}
        data-e68-panel-focus=""
        aria-activedescendant={selected >= 0 && selected < rows.length ? ROW_ID(base, selected) : undefined}
        count={rows.length}
        rowHeight={rowHeight}
        renderRow={renderRow}
        rowProps={(row) => {
          const code = isCode(row);
          const address = code ? ctx.sim.listing.addressOf(row) : null;
          const on = address !== null && breakpoints.has(address);
          return {
            id: ROW_ID(base, row),
            role: 'option',
            'aria-selected': row === selected,
            // An option needs a name; a blank listing line has no text of its own.
            'aria-label': (rows[row] ?? '').trim() === '' ? 'Empty line' : undefined,
            className: row === selected ? 'e68-listing__row e68-listing__row--selected' : 'e68-listing__row',
            'data-row': String(row),
            'data-bp': code ? (on ? 'on' : 'off') : undefined,
            'data-pc': row === pcRow ? 'true' : undefined,
            onClick: () => select(row, false),
            onDoubleClick: () => model.doubleClickRow(row),
          };
        }}
        onScroll={onScroll}
        onKeyDown={onKeyDown}
      />
      <ContextMenu label="Breakpoints" items={menu} {...context.menuProps} />
    </div>
  );
}
