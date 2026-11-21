// Help > About EASyBIN (aboutS.dfm, aboutS.cpp; docs/porting/easybin.md 15.3). Owner: B1.
//
// The original's texts top to bottom, letter for letter (`www.easy68k.com` is plain text there, not
// a link); below them the port's notice, as in the editor's and simulator's About boxes.

import { useRef } from 'react';
import type { DialogProps } from '../../contracts';
import { ABOUT } from '../../core/easybin';
import { PORT_NAME, PORT_STATEMENT, PORT_SUBTITLE, portVersionFromTitle } from '../../core/help';
import { Button, Dialog } from '../../ui/components';
import './easybin.css';

export function EasybinAboutDialog({ close }: DialogProps<Record<string, never>, undefined>) {
  const okButton = useRef<HTMLButtonElement>(null);
  const version = portVersionFromTitle(globalThis.document?.title ?? '');
  return (
    <Dialog
      title={ABOUT.windowTitle}
      width={480}
      onCancel={() => close(undefined)}
      initialFocus={okButton}
      footer={<Button ref={okButton} caption={ABOUT.ok} isDefault onClick={() => close(undefined)} />}
    >
      <div className="e68-easybin-about">
        <p className="e68-easybin-about__title">{ABOUT.title}</p>
        <p>{ABOUT.comments}</p>
        <p>{ABOUT.license}</p>
        <p>{ABOUT.copyright}</p>
        <p className="e68-easybin-about__web">{ABOUT.web}</p>
        <p>{ABOUT.forum}</p>
        <hr className="e68-easybin-about__rule" />
        <p>
          <strong>{PORT_NAME}</strong> <span className="e68-easybin-about__muted">{PORT_SUBTITLE}</span> {version}
        </p>
        <p>{PORT_STATEMENT}</p>
      </div>
    </Dialog>
  );
}
