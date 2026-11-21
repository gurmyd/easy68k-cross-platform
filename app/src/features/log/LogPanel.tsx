// The Log panel (ARCHITECTURE.md 2.6, added in 1.5): the two file names, the state (`Logging` /
// `Stopped`) and the last 200 lines of each file, read-only. Configuration stays in
// Options > Log Output....
//
// Owner: U4.

import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { LogServiceApi } from '../../contracts';
import { logWriteError } from '../../core/sim-host/log/log-service';
import { useAppContext } from '../../state/context';
import { LOG_PANEL_LINES, LOG_PANEL_LOGGING, LOG_PANEL_STOPPED } from './model';
import './log.css';

/** A revision counter of the service: moves with every notification, so the tails are read again. */
function useLogRevision(log: LogServiceApi): number {
  const revision = useRef(0);
  const subscribe = useCallback(
    (listener: () => void) =>
      log.subscribe(() => {
        revision.current++;
        listener();
      }),
    [log],
  );
  const read = () => revision.current;
  return useSyncExternalStore(subscribe, read, read);
}

const LINE_END = '\n';

function LogFile({ title, name, lines }: { title: string; name: string; lines: string[] }) {
  const text = lines.join(LINE_END);
  const pre = useRef<HTMLPreElement>(null);
  // The newest lines stay in view, as long as the user has not scrolled up to read older ones.
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const element = pre.current;
    if (element && atEnd.current) element.scrollTop = element.scrollHeight;
  }, [text]);
  return (
    <section className="e68-logpanel__file" aria-label={title}>
      <header className="e68-logpanel__head">
        <span className="e68-logpanel__title">{title}</span>
        <span className="e68-logpanel__name" title={name}>
          {name === '' ? '-' : name}
        </span>
      </header>
      <pre
        ref={pre}
        className="e68-logpanel__text"
        onScroll={(event) => {
          const element = event.currentTarget;
          atEnd.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 4;
        }}
      >
        {text}
      </pre>
    </section>
  );
}

export function LogPanel() {
  const ctx = useAppContext();
  const log = ctx.sim.log;
  useLogRevision(log);
  const state = log.state;
  const error = logWriteError(log);
  return (
    <div className="e68-logpanel" tabIndex={0} data-e68-panel-focus data-testid="log-panel">
      <div className="e68-logpanel__state">
        <span className="e68-logpanel__badge" data-logging={state.logging ? 'true' : undefined}>
          {state.logging ? LOG_PANEL_LOGGING : LOG_PANEL_STOPPED}
        </span>
        {error !== null && (
          <span className="e68-logpanel__error" role="status">
            {error}
          </span>
        )}
      </div>
      <div className="e68-logpanel__files">
        <LogFile title="Execution log" name={state.execFileName} lines={log.tail('exec', LOG_PANEL_LINES)} />
        <LogFile title="Output log" name={state.outputFileName} lines={log.tail('output', LOG_PANEL_LINES)} />
      </div>
    </div>
  );
}
