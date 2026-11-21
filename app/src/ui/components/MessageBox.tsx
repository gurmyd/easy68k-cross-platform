// Message box (ARCHITECTURE.md 2.7, 3.12.4). Owner: W2.
//
// A modal Dialog with the original's title, text, icon class and buttons.
// The text is shown verbatim, double spaces and line breaks included
// (section 0, rule 7). onResult receives the pressed button's caption, as
// DialogService.messageBox resolves to it.
//
// Keys follow a Windows message box: the first button is the default and
// has the focus; Enter presses the focused button; Yes, No, Replace and
// Append have their first letter as access key; Escape (and the close button)
// answers Cancel when there is a Cancel button, OK when OK is the only button,
// and is unavailable otherwise (a Yes / No question must be answered).

import { useId } from 'react';
import './MessageBox.css';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/** The same values as MessageBoxRequest in app/src/contracts (3.12.4). */
export type MessageBoxIcon = 'none' | 'information' | 'confirmation' | 'warning' | 'error';
export type MessageBoxButton = 'OK' | 'Cancel' | 'Yes' | 'No' | 'Replace' | 'Append';

export interface MessageBoxProps {
  title: string;
  text: string;
  icon: MessageBoxIcon;
  buttons: readonly MessageBoxButton[];
  onResult: (button: MessageBoxButton) => void;
  /** Index of the default button. Default 0. */
  defaultButton?: number;
  /** Render in place (the gallery's previews). */
  inline?: boolean;
}

const CAPTIONS: Record<MessageBoxButton, string> = {
  OK: 'OK',
  Cancel: 'Cancel',
  Yes: '&Yes',
  No: '&No',
  Replace: '&Replace',
  Append: '&Append',
};

const ICON_NAMES = {
  information: 'Information',
  confirmation: 'Question',
  warning: 'Warning',
  error: 'Error',
} as const;

/** The answer of Escape and the close button, or null when the box has none. */
export function messageBoxEscapeResult(buttons: readonly MessageBoxButton[]): MessageBoxButton | null {
  if (buttons.includes('Cancel')) return 'Cancel';
  if (buttons.length === 1 && buttons[0] === 'OK') return 'OK';
  return null;
}

export function MessageBox({
  title,
  text,
  icon,
  buttons,
  onResult,
  defaultButton = 0,
  inline = false,
}: MessageBoxProps) {
  const textId = useId();
  const escape = messageBoxEscapeResult(buttons);
  return (
    <Dialog
      title={title}
      role="alertdialog"
      describedBy={textId}
      inline={inline}
      className="e68-messagebox"
      {...(escape ? { onCancel: () => onResult(escape) } : {})}
      footer={buttons.map((button, index) => (
        <Button
          key={button}
          caption={CAPTIONS[button]}
          isDefault={index === defaultButton}
          onClick={() => onResult(button)}
        />
      ))}
    >
      <div className="e68-messagebox__content">
        {icon !== 'none' && (
          <span className={`e68-messagebox__icon e68-messagebox__icon--${icon}`}>
            <Icon name={icon} size={32} label={ICON_NAMES[icon]} />
          </span>
        )}
        <p id={textId} className="e68-messagebox__text">
          {text}
        </p>
      </div>
    </Dialog>
  );
}
