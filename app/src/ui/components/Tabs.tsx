// Tab strip (ARCHITECTURE.md 2.2, 2.3, 2.4, 2.11). Owner: W2.
//
// A `tablist`: document tabs of the editor and the simulator's tool tabs.
// Keyboard (2.11): the strip is one tab stop (the selected tab); Left /
// Right select the previous / next tab (wrapping) and Home / End the first
// and last; selection follows the focus. Delete closes a closable tab, as the
// tab's `x` does for the mouse (the `x` itself is not a separate tab stop, so
// that the tab list holds nothing but tabs); a middle click closes too.
//
// The caller renders the panel of the selected tab only, with TabPanel and the same ids; the
// selected tab alone carries aria-controls (the ARIA Authoring Practices tabs pattern allows a
// panel that is not rendered, as long as no tab points at it):
//   <Tabs idBase="tools" items={...} selectedId={id} onSelect={setId} label="Tools" />
//   <TabPanel idBase="tools" tabId={id}>...</TabPanel>
//
// Dragging (optional, ARCHITECTURE-PLUS P5 N2): with `drag` the tabs are `draggable`; a dragged tab
// carries `drag.data(id)` under the type `drag.type`, and, with `onDropAt`, the strip accepts a drop
// of that type and reports it with the tab it was dropped on (null: the strip beside the tabs).
// Without `drag` nothing is draggable and the strip accepts no drop, exactly as before.
// A browser may drop a custom type from the drag data (Playwright's WebKit on Windows keeps only
// text/plain, text/uri-list and text/html); for a tab dragged in this page the strip then reads the
// type and data from the drag the page started (`pageDrag`).

import { useRef, useState, type DragEvent, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import '../../styles/components.css';
import './Tabs.css';
import { Icon } from './Icon';
import { moveIndex } from './roving';

export interface TabItem {
  id: string;
  label: string;
  /** Tool-tip: the full path of a document (2.4). */
  title?: string;
  /** A modified document: a dot before the name (2.4). */
  modified?: boolean;
  closable?: boolean;
}

/** Dragging tabs (ARCHITECTURE-PLUS P5 N2). */
export interface TabsDrag {
  /** The drag data's type, e.g. `application/x-e68-document` (lower case: browsers report types so). */
  type: string;
  /** The data a dragged tab carries. */
  data(id: string): string;
  /** A drop of `type` on the strip: on the tab `id`, or beside the tabs (null). */
  onDropAt?(id: string | null, data: string): void;
}

export interface TabsProps {
  /** Prefix of the element ids, shared with TabPanel. */
  idBase: string;
  items: readonly TabItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose?: (id: string) => void;
  /** Accessible name of the strip. */
  label: string;
  /** 'document' (editor tabs) or 'tool' (panel tabs). */
  variant?: 'document' | 'tool';
  /** Content at the right end of the strip (not part of the tab list). */
  end?: ReactNode;
  className?: string;
  /** Tabs can be dragged (and dropped on the strip); absent: no dragging. */
  drag?: TabsDrag;
}

/** The tab drag this page started, for browsers that drop custom types from the drag data. */
let pageDrag: { type: string; data: string } | null = null;

export const tabId = (idBase: string, id: string) => `${idBase}-tab-${id}`;
export const tabPanelId = (idBase: string, id: string) => `${idBase}-panel-${id}`;

export function Tabs({
  idBase,
  items,
  selectedId,
  onSelect,
  onClose,
  label,
  variant = 'document',
  end,
  className,
  drag,
}: TabsProps) {
  const refs = useRef(new Map<string, HTMLDivElement | null>());
  // The tab a drop would land on while something is dragged over the strip ('' = beside the tabs).
  const [dropAt, setDropAt] = useState<string | null>(null);
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const tabStop = selectedIndex >= 0 ? selectedIndex : 0;

  const focusTab = (index: number) => {
    const item = items[index];
    if (!item) return;
    onSelect(item.id);
    refs.current.get(item.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const item = items[index];
    if (event.key === 'Delete' && item?.closable && onClose) {
      event.preventDefault();
      const neighbour = items[index + 1] ?? items[index - 1];
      onClose(item.id);
      if (neighbour) requestAnimationFrame(() => refs.current.get(neighbour.id)?.focus());
      return;
    }
    const next = moveIndex(items.length, index, event.key, { orientation: 'horizontal' });
    if (next === null) return;
    event.preventDefault();
    focusTab(next);
  };

  const accepts = (event: DragEvent<HTMLElement>) =>
    drag?.onDropAt !== undefined &&
    (Array.from(event.dataTransfer.types).includes(drag.type) || pageDrag?.type === drag.type);
  const dataOf = (event: DragEvent<HTMLElement>, type: string) => {
    const data = event.dataTransfer.getData(type);
    return data === '' && pageDrag?.type === type ? pageDrag.data : data;
  };
  /** The tab under a drag event, or null beside the tabs. */
  const tabUnder = (event: DragEvent<HTMLElement>): string | null => {
    for (const item of items) {
      const element = refs.current.get(item.id);
      if (element && event.target instanceof Node && element.contains(event.target)) return item.id;
    }
    return null;
  };
  const dropProps = drag?.onDropAt
    ? {
        onDragOver: (event: DragEvent<HTMLDivElement>) => {
          if (!accepts(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          const at = tabUnder(event) ?? '';
          if (at !== dropAt) setDropAt(at);
        },
        onDragLeave: (event: DragEvent<HTMLDivElement>) => {
          const next = event.relatedTarget;
          if (!(next instanceof Node) || !event.currentTarget.contains(next)) setDropAt(null);
        },
        onDrop: (event: DragEvent<HTMLDivElement>) => {
          setDropAt(null);
          if (!accepts(event)) return;
          event.preventDefault();
          const data = dataOf(event, drag.type);
          pageDrag = null;
          drag.onDropAt?.(tabUnder(event), data);
        },
      }
    : {};

  return (
    <div
      className={['e68-tabs', `e68-tabs--${variant}`, className ?? ''].filter(Boolean).join(' ')}
      data-e68-drop={dropAt === '' ? 'true' : undefined}
      {...dropProps}
    >
      <div role="tablist" aria-label={label} aria-orientation="horizontal" className="e68-tabs__list">
        {items.map((item, index) => {
          const selected = item.id === selectedId;
          return (
            <div
              key={item.id}
              ref={(element) => {
                refs.current.set(item.id, element);
              }}
              id={tabId(idBase, item.id)}
              role="tab"
              aria-selected={selected}
              // Only the selected tab's panel is rendered (TabPanel), so only that tab names one:
              // aria-controls must not point at an element that is not in the page.
              aria-controls={selected ? tabPanelId(idBase, item.id) : undefined}
              aria-keyshortcuts={item.closable && onClose ? 'Delete' : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              title={item.title}
              className="e68-tabs__tab"
              data-modified={item.modified ? 'true' : undefined}
              data-e68-drop={dropAt === item.id ? 'true' : undefined}
              {...(drag
                ? {
                    draggable: true,
                    onDragStart: (event: DragEvent<HTMLDivElement>) => {
                      const data = drag.data(item.id);
                      pageDrag = { type: drag.type, data };
                      event.dataTransfer.setData(drag.type, data);
                      event.dataTransfer.effectAllowed = 'move';
                    },
                    onDragEnd: () => {
                      pageDrag = null;
                      setDropAt(null);
                    },
                  }
                : {})}
              onClick={() => onSelect(item.id)}
              onAuxClick={(event) => {
                if (event.button === 1 && item.closable && onClose) {
                  event.preventDefault();
                  onClose(item.id);
                }
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {item.modified && <span className="e68-tabs__dot" aria-hidden="true" />}
              <span className="e68-tabs__label">{item.label}</span>
              {item.modified && <span className="e68-sr"> (modified)</span>}
              {item.closable && onClose && (
                <span
                  className="e68-tabs__close"
                  aria-hidden="true"
                  title="Close"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(item.id);
                  }}
                >
                  <Icon name="close" size={14} />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {end && <div className="e68-tabs__end">{end}</div>}
    </div>
  );
}

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  idBase: string;
  tabId: string;
  children: ReactNode;
}

/** The panel of the selected tab (role tabpanel, labelled by its tab). */
export function TabPanel({ idBase, tabId: id, children, className, ...rest }: TabPanelProps) {
  return (
    <div
      id={tabPanelId(idBase, id)}
      role="tabpanel"
      aria-labelledby={tabId(idBase, id)}
      className={className ? `e68-tabpanel ${className}` : 'e68-tabpanel'}
      {...rest}
    >
      {children}
    </div>
  );
}
