// Icon-only button, mainly for toolbars (ARCHITECTURE.md 2.8, 2.11). Owner: W2.
//
// `label` is the button's hint (the original's toolbar hint with the
// platform's shortcut appended, 1.3.2). It is the accessible name and the
// tool-tip text. A toggle passes `pressed` (aria-pressed).

import type { ButtonHTMLAttributes, Ref } from 'react';
import './IconButton.css';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: IconName;
  /** The hint: accessible name and tool-tip. */
  label: string;
  /** Toggle state; undefined for a plain button. */
  pressed?: boolean;
  /** 'normal' is 28 px square (toolbars), 'small' is 20 px (tab strips, field buttons). */
  size?: 'normal' | 'small';
  /** Show the label as a tool-tip on hover and keyboard focus. Default true. */
  tooltip?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  icon,
  label,
  pressed,
  size = 'normal',
  tooltip = true,
  className,
  type = 'button',
  ref,
  ...rest
}: IconButtonProps) {
  const classes = ['e68-iconbutton', `e68-iconbutton--${size}`];
  if (className) classes.push(className);
  const button = (
    <button ref={ref} type={type} className={classes.join(' ')} aria-label={label} aria-pressed={pressed} {...rest}>
      <Icon name={icon} size={16} />
    </button>
  );
  return tooltip ? <Tooltip text={label}>{button}</Tooltip> : button;
}
