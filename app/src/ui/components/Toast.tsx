// Toasts: short notices at the bottom right (ARCHITECTURE.md 2.10, 3.12.4).
// Owner: W2.
//
// DialogService.toast(text, action?) (W3) keeps the list and renders a
// ToastStack once. The stack is a polite live region, present from the start
// so that screen readers announce every toast; a toast disappears after
// `duration` ms unless the pointer or the focus is on it, and has a close
// button. Example: 'The program is waiting for keyboard input' with an
// action that switches to Simulator mode (2.10).

import { useEffect, useRef, useState } from 'react';
import './Toast.css';
import { Button } from './Button';
import { stripMnemonic } from './mnemonic';
import { Icon } from './Icon';
import { IconButton } from './IconButton';

export interface ToastItem {
  id: string | number;
  text: string;
  kind?: 'information' | 'success' | 'warning' | 'error';
  action?: { label: string; run(): void };
  /** ms until it closes by itself; 0 = stays. Default 8000. */
  duration?: number;
}

export interface ToastStackProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: ToastItem['id']) => void;
  /** Render in place instead of fixed at the bottom right (the gallery). */
  inline?: boolean;
}

/**
 * Action captions up to this many characters (without the '&' marker) sit on the toast's line;
 * a longer one ('Open the containing folder...', 3.8.2) goes on a line of its own under the text,
 * so that it never squeezes or covers the text (gate I2, FS2's note; errata W2 entry 19).
 */
export const TOAST_INLINE_ACTION_MAX = 14;

/** 'inline' when the toast's action fits beside its text, 'stacked' when it goes below it. */
export function toastLayout(toast: Pick<ToastItem, 'action'>): 'inline' | 'stacked' {
  if (!toast.action) return 'inline';
  return stripMnemonic(toast.action.label).length > TOAST_INLINE_ACTION_MAX ? 'stacked' : 'inline';
}

export function ToastStack({ toasts, onDismiss, inline = false }: ToastStackProps) {
  return (
    <section aria-label="Notifications" className={inline ? 'e68-toasts e68-toasts--inline' : 'e68-toasts'}>
      <div aria-live="polite" aria-relevant="additions text" className="e68-toasts__list">
        {toasts.map((toast) => (
          <Toast key={toast.id} toast={toast} onDismiss={() => onDismiss(toast.id)} />
        ))}
      </div>
    </section>
  );
}

export function Toast({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { text, kind = 'information', action, duration = 8000 } = toast;
  const [paused, setPaused] = useState(false);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (duration <= 0 || paused) return;
    const timer = window.setTimeout(() => dismiss.current(), duration);
    return () => window.clearTimeout(timer);
  }, [duration, paused]);

  return (
    <div
      className={`e68-toast e68-toast--${kind}`}
      data-layout={toastLayout(toast)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="e68-toast__icon">
        <Icon name={kind} />
      </span>
      <span className="e68-toast__text">{text}</span>
      {action && (
        <Button
          size="small"
          className="e68-toast__action"
          caption={action.label}
          onClick={() => {
            action.run();
            onDismiss();
          }}
        />
      )}
      <IconButton
        icon="close"
        label="Dismiss"
        size="small"
        tooltip={false}
        className="e68-toast__close"
        onClick={onDismiss}
      />
    </div>
  );
}
