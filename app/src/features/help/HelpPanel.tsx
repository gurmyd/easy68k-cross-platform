// The Help panel: the right-hand drawer of every mode (ARCHITECTURE.md 2.1, 2.7). Owner: H1.
//
// Top: a toolbar (Back, Forward, Contents, the page's title, Close). Below it, when Contents is
// pressed, the original's contents tree (contents.hhc) with a text filter over the page titles.
// The rest is the page, in a sandboxed frame: no scripts run in it, but it keeps its own origin so
// that the panel can read which page it shows (to keep the title, the contents tree and the history
// in step). Links to other pages navigate the frame; links to the web open in a new tab. In WebKit
// under the service worker the sandbox has allow-scripts, because WebKit sends the frame's
// navigations to no worker otherwise (Help offline); the pages' own policy forbids every script
// there (core/help/engine.ts, erratum H1 11).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import {
  engineOf,
  helpFrameSandbox,
  helpUrl,
  targetOfUrl,
  treeKeyAction,
  visibleRows,
  type HelpFrameEnvironment,
  type NodeKey,
} from '../../core/help';
import { useAppContext } from '../../state/context';
import { hidePanel } from '../../state/panels';
import { IconButton, TextField, Toolbar } from '../../ui/components';
import { helpControllerOf, type HelpController } from './controller';
import './help.css';

function useHelpState(controller: HelpController) {
  return useSyncExternalStore(controller.subscribe, controller.getState);
}

export function HelpPanel() {
  const ctx = useAppContext();
  const controller = helpControllerOf(ctx);
  const state = useHelpState(controller);

  useEffect(() => {
    void controller.ensureContents();
  }, [controller]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      hidePanel(ctx, 'help');
    }
  };

  return (
    <div className="e68-help" onKeyDown={onKeyDown}>
      <Toolbar label="Help" className="e68-help__bar">
        <IconButton
          icon="chevron-left"
          label="Back"
          disabled={!controller.canGoBack}
          onClick={() => controller.back()}
        />
        <IconButton
          icon="chevron-right"
          label="Forward"
          disabled={!controller.canGoForward}
          onClick={() => controller.forward()}
        />
        <IconButton
          icon="menu"
          label="Contents"
          pressed={state.contentsOpen}
          data-e68-panel-focus=""
          onClick={() => controller.toggleContents()}
        />
        <span className="e68-help__title" title={state.title}>
          {state.title}
        </span>
        <IconButton icon="close" label="Close Help" onClick={() => hidePanel(ctx, 'help')} />
      </Toolbar>
      {state.contentsOpen && <HelpContents controller={controller} />}
      <HelpFrame controller={controller} />
    </div>
  );
}

/** The filter field and the contents tree. */
function HelpContents({ controller }: { controller: HelpController }) {
  const state = useHelpState(controller);
  const rows = state.contents === null ? [] : visibleRows(state.contents, state.open, state.filter);
  const [focusKey, setFocusKey] = useState<NodeKey | null>(null);
  const items = useRef(new Map<NodeKey, HTMLElement>());
  const stop = rows.find((row) => row.key === focusKey)?.key ?? rows[0]?.key ?? null;

  const activate = (key: NodeKey) => {
    const row = rows.find((candidate) => candidate.key === key);
    if (!row) return;
    if (row.node.target) controller.show(row.node.target);
    else if (row.isBook) controller.toggleBook(key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>, key: NodeKey) => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const action = treeKeyAction(rows, key, event.key);
    if (!action) return;
    event.preventDefault();
    if (action.kind === 'focus') {
      setFocusKey(action.key);
      items.current.get(action.key)?.focus();
    } else if (action.kind === 'toggle') {
      controller.toggleBook(action.key);
    } else {
      activate(action.key);
    }
  };

  return (
    <div className="e68-help__contents">
      <TextField
        value={state.filter}
        onChange={(value) => controller.setFilter(value)}
        placeholder="Filter by title"
        aria-label="Filter the contents by title"
        type="search"
      />
      {state.contentsError !== null && (
        <p role="alert" className="e68-help__note">
          The contents could not be read: {state.contentsError}
        </p>
      )}
      {state.contents !== null && rows.length === 0 && <p className="e68-help__note">No page has that title.</p>}
      <ul role="tree" aria-label="Contents" className="e68-help__tree">
        {rows.map((row) => {
          const current =
            row.node.target !== null && row.node.target.page.toLowerCase() === state.current.page.toLowerCase();
          return (
            <li key={row.key} role="none">
              <div
                ref={(element) => {
                  if (element) items.current.set(row.key, element);
                  else items.current.delete(row.key);
                }}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.isBook ? row.expanded : undefined}
                aria-selected={current}
                aria-current={current ? 'page' : undefined}
                tabIndex={row.key === stop ? 0 : -1}
                className="e68-help__item"
                data-book={row.isBook ? 'true' : undefined}
                style={{ paddingInlineStart: `calc(var(--sp-2) + ${row.depth} * var(--sp-4))` }}
                onFocus={() => setFocusKey(row.key)}
                onKeyDown={(event) => onKeyDown(event, row.key)}
                onClick={() => {
                  setFocusKey(row.key);
                  if (row.isBook && !row.node.target) controller.toggleBook(row.key);
                  else activate(row.key);
                }}
              >
                <span className="e68-help__twisty" aria-hidden="true">
                  {row.isBook ? (row.expanded ? '▾' : '▸') : ''}
                </span>
                {row.node.name}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** What the frame's sandbox depends on, read from the browser (helpFrameSandbox decides). */
function readFrameEnvironment(platform: 'web' | 'desktop'): HelpFrameEnvironment {
  if (typeof navigator === 'undefined') return { platform, engine: 'other', controlled: false };
  let controlled: boolean;
  try {
    controlled = (navigator.serviceWorker?.controller ?? null) !== null;
  } catch {
    controlled = false;
  }
  return { platform, engine: engineOf(navigator.vendor), controlled };
}

/** The sandboxed frame that shows the page. */
function HelpFrame({ controller }: { controller: HelpController }) {
  const state = useHelpState(controller);
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useRef(helpUrl(controller.base, controller.getState().current));
  const shown = useRef(controller.getState().navigation);

  // A navigation of the controller (a link, a keyword, Back or Forward) loads the page into the
  // frame without adding to the browser's own history.
  useEffect(() => {
    if (state.navigation === shown.current) return;
    shown.current = state.navigation;
    const element = frame.current;
    if (!element) return;
    const url = helpUrl(controller.base, state.current);
    try {
      element.contentWindow!.location.replace(url);
    } catch {
      element.src = url;
    }
  }, [controller, state.navigation, state.current]);

  const onLoad = useCallback(() => {
    const element = frame.current;
    // An error page (a navigation the service worker refused, erratum H1 11; a page that failed to
    // load) is not of this origin: its document and address cannot be read, and nothing is noted.
    let doc: Document | null | undefined;
    let location: string | undefined;
    try {
      doc = element?.contentDocument;
      location = element?.contentWindow?.location.href;
    } catch {
      return;
    }
    if (!doc || location === undefined) return;
    const target = targetOfUrl(controller.base, location);
    if (target) controller.noteLoaded(target, doc.title);

    // Nothing is attached to the frame's document: a browser may refuse to run listeners in a
    // document whose frame has no scripts (WebKit does, and logs an error each time). A link to
    // another page therefore navigates the frame by itself and noteLoaded() records the page; a
    // link to the web or to a file that is not a page has its own target="_blank" (tools/
    // import-help.mjs) and opens in a new tab, which the sandbox allows (allow-popups).
  }, [controller]);

  // Decided once, when the frame is created (a sandbox change would apply to the next navigation
  // only): allow-scripts in WebKit under a service worker only, erratum H1 11.
  const ctx = useAppContext();
  const sandbox = useRef(helpFrameSandbox(readFrameEnvironment(ctx.platform.kind)));

  return (
    <iframe
      ref={frame}
      className="e68-help__frame"
      title={state.title === '' ? 'Help page' : `Help: ${state.title}`}
      src={initial.current}
      sandbox={sandbox.current}
      onLoad={onLoad}
    />
  );
}
