// Tab strip (ARCHITECTURE.md 2.2, 2.3, 2.4, 2.11). Owner: W2.
//
// A `tablist`: document tabs of the editor and the simulator's tool tabs.
// Keyboard (2.11): the strip is one tab stop (the selected tab); Left /
// Right select the previous / next tab (wrapping) and Home / End the first
// and last; selection follows the focus. Delete closes a closable tab, as the
// tab's `x` does for the mouse (the `x` itself is not a separate tab stop, so
// that the tab list holds nothing but tabs); a middle click closes too.
//
// The panels are rendered by the caller with TabPanel and the same ids:
//   <Tabs idBase="tools" items={...} selectedId={id} onSelect={setId} label="Tools" />
//   <TabPanel idBase="tools" tabId={id}>...</TabPanel>

import { useRef, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
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
}

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
}: TabsProps) {
  const refs = useRef(new Map<string, HTMLDivElement | null>());
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

  return (
    <div className={['e68-tabs', `e68-tabs--${variant}`, className ?? ''].filter(Boolean).join(' ')}>
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
              aria-controls={tabPanelId(idBase, item.id)}
              aria-keyshortcuts={item.closable && onClose ? 'Delete' : undefined}
              tabIndex={index === tabStop ? 0 : -1}
              title={item.title}
              className="e68-tabs__tab"
              data-modified={item.modified ? 'true' : undefined}
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
