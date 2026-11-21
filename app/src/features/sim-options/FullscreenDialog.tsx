// The Fullscreen Options dialog, `sim.fullscreen` (ARCHITECTURE.md 1.4 note 29; sim-ui §14.1;
// `FullscreenOptions.dfm`): kept with its text; a web page and the single-window app have one screen
// for the output, so `&Ok` is enabled for `1` only. OK returns the screen number, Cancel null.
//
// Owner: U4.

import { useState } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Dialog, TextField } from '../../ui/components';
import { FULLSCREEN_TEXT, FULLSCREEN_TITLE, screenNumberOf } from './model';
import './sim-options.css';

export interface FullscreenProps {
  /** `FullScreenMonitor + 1`, as FormShow fills the field. */
  screen: number;
}
export type FullscreenResult = number | null;

export function FullscreenDialog({ props, close }: DialogProps<FullscreenProps, FullscreenResult>) {
  const [text, setText] = useState(String(props.screen));
  const screen = screenNumberOf(text);
  return (
    <Dialog
      title={FULLSCREEN_TITLE}
      width={300}
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption="&Ok" isDefault disabled={screen === null} onClick={() => screen !== null && close(screen)} />
          <Button caption="&Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-fullscreen-opts" data-testid="fullscreen-dialog">
        <p className="e68-fullscreen-opts__text">{FULLSCREEN_TEXT}</p>
        <TextField
          aria-label="Screen number"
          value={text}
          onChange={setText}
          widthCh={6}
          inputMode="numeric"
          data-autofocus
          data-testid="fullscreen-screen"
        />
      </div>
    </Dialog>
  );
}
