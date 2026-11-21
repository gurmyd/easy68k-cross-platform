// Push button (ARCHITECTURE.md 2.7, 2.8). Owner: W2.
//
// The caption is written in the original's spelling with '&' before the
// access key ('&Execute', 'C&ancel'). The access key works with Alt (Option)
// inside a Dialog, and without it while the focus is not in a text field, as
// in a Windows dialog. `isDefault` marks the button that Enter presses in a
// Dialog; it is drawn in the accent colour.

import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import '../../styles/components.css';
import './Button.css';
import { Caption } from './Caption';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { parseMnemonic } from './mnemonic';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Caption with an optional '&' access-key marker. */
  caption?: string;
  /** Content instead of a caption (the accessible name then comes from it). */
  children?: ReactNode;
  /** The dialog's default button: Enter presses it (Dialog.tsx). */
  isDefault?: boolean;
  /** 'normal' (default), 'primary' (accent, like the default button) or 'quiet' (no frame). */
  variant?: 'normal' | 'primary' | 'quiet';
  /** An icon before the caption. */
  icon?: IconName;
  /** 'normal' is --h-control high; 'small' is 22 px, for strips inside panels. */
  size?: 'normal' | 'small';
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  caption,
  children,
  isDefault = false,
  variant,
  icon,
  size = 'normal',
  className,
  type = 'button',
  ref,
  ...rest
}: ButtonProps) {
  const look = variant ?? (isDefault ? 'primary' : 'normal');
  const mnemonic = caption ? parseMnemonic(caption).key : null;
  const classes = ['e68-button', `e68-button--${look}`];
  if (size === 'small') classes.push('e68-button--small');
  if (className) classes.push(className);
  return (
    <button
      ref={ref}
      type={type}
      className={classes.join(' ')}
      data-e68-default={isDefault ? 'true' : undefined}
      data-e68-mnemonic={mnemonic ?? undefined}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {caption !== undefined && (
        <span className="e68-button__caption">
          <Caption text={caption} />
        </span>
      )}
      {children}
    </button>
  );
}
