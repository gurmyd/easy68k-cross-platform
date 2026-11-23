// What the two dialogs of the history share (ARCHITECTURE-PLUS P3.3.7, P3.3.8). Owner: N4.

import { useEffect, useState } from 'react';
import type { AppContext, HistoryService, VPath } from '../../contracts';
import { DELETE_HISTORY_BUTTON } from '../../core/history/texts';
import { placeShort as placeShortOf } from '../../core/places/display';
import { Button } from '../../ui/components';
import { deleteHistoryAndTrash } from './trash';
import './history.css';

/** Re-renders when the history changes (this window or another) and returns the change count. */
export function useHistoryChanges(history: HistoryService | undefined): number {
  const [count, setCount] = useState(0);
  useEffect(() => (history ? history.subscribe(() => setCount((n) => n + 1)) : undefined), [history]);
  return count;
}

/** The short place text of P4.5 for the mounts of this window. */
export function placeShortFor(ctx: Pick<AppContext, 'vfs'>): (path: VPath) => string {
  return (path) => {
    try {
      const labels = ctx.vfs.backends().map(({ mount, label, kind }) => ({ mount, label, kind }));
      return placeShortOf(labels, path);
    } catch {
      return path;
    }
  };
}

/** Lines above a list (P3.3.7, P3.3.8). */
export function Lines({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="e68-history__lines">
      {lines.map((line) => (
        <p key={line} className="e68-history__line">
          {line}
        </p>
      ))}
    </div>
  );
}

/** P3.3.7: an unavailable history, with `Delete History and Trash`. */
export function HistoryProblem({ ctx, text }: { ctx: Pick<AppContext, 'history' | 'dialogs'>; text: string }) {
  const history = ctx.history;
  return (
    <div className="e68-history__problem">
      <p className="e68-history__line" role="status">
        {text}
      </p>
      {history && (
        <Button
          caption={DELETE_HISTORY_BUTTON}
          onClick={() => void deleteHistoryAndTrash({ history, dialogs: ctx.dialogs })}
        />
      )}
    </div>
  );
}
