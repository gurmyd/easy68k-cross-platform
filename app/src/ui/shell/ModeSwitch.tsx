// The mode switch: a three-segment control at the right end of the menu bar row
// (ARCHITECTURE.md 2.1). Owner: W3.
//
// Editor | Simulator | EASyBIN, one per original program. It is a radio group: one tab stop, the
// arrow keys move the choice. Choosing a segment runs `app.mode.set`; F4 cycles (`app.mode.next`).

import { useRef, type KeyboardEvent } from 'react';
import type { Mode } from '../../contracts';
import { MODES, MODE_CAPTIONS } from '../../commands/shell-commands';
import { useRunCommand } from './use-commands';

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

export function ModeSwitch({ mode }: { mode: Mode }) {
  const run = useRunCommand();
  const buttons = useRef(new Map<Mode, HTMLButtonElement | null>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Mode) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = STEP[event.key];
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? MODES.length - 1
          : step === undefined
            ? -1
            : (MODES.indexOf(current) + step + MODES.length) % MODES.length;
    const next = MODES[index];
    if (next === undefined) return;
    event.preventDefault();
    run('app.mode.set', next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Mode" className="e68-modeswitch">
      {MODES.map((item) => (
        <button
          key={item}
          ref={(element) => {
            buttons.current.set(item, element);
          }}
          type="button"
          role="radio"
          aria-checked={item === mode}
          tabIndex={item === mode ? 0 : -1}
          className="e68-modeswitch__segment"
          data-mode={item}
          onClick={() => run('app.mode.set', item)}
          onKeyDown={(event) => onKeyDown(event, item)}
        >
          {MODE_CAPTIONS[item]}
        </button>
      ))}
    </div>
  );
}
