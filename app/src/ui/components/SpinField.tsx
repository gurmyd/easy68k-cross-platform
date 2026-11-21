// Whole-number field with up / down buttons (ARCHITECTURE.md 2.7): the Editor
// Options' tab size, font sizes, the auto-trace interval. Owner: W2.
//
// A `spinbutton`: Up / Down step, Page Up / Page Down step by ten, Home / End
// go to the limits; typed text is accepted on Enter and when the field loses
// the focus (clamped to the range; anything else restores the value). The
// two small buttons are for the pointer only.

import { useEffect, useId, useState, type InputHTMLAttributes, type PointerEvent, type Ref } from 'react';
import '../../styles/components.css';
import './SpinField.css';
import { Caption } from './Caption';
import { Icon } from './Icon';
import { parseMnemonic } from './mnemonic';
import { clampSpin, parseSpinText, spinKeyValue, type SpinRange } from './spin';

export interface SpinFieldProps
  extends
    SpinRange,
    Omit<
      InputHTMLAttributes<HTMLInputElement>,
      'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'size'
    > {
  value: number;
  onChange: (value: number) => void;
  label?: string;
  labelPosition?: 'left' | 'top';
  /** Width in digits. Default 4. */
  digits?: number;
  inputRef?: Ref<HTMLInputElement>;
}

export function SpinField({
  value,
  onChange,
  min,
  max,
  step = 1,
  page,
  label,
  labelPosition = 'left',
  digits = 4,
  inputRef,
  id,
  disabled,
  className,
  ...rest
}: SpinFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const range: SpinRange = page === undefined ? { min, max, step } : { min, max, step, page };
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => setDraft(null), [value]);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseSpinText(draft, range);
    setDraft(null);
    if (parsed !== null && parsed !== value) onChange(parsed);
  };
  const nudge = (direction: 1 | -1) => (event: PointerEvent) => {
    event.preventDefault(); // keep the focus in the field
    if (disabled) return;
    const next = clampSpin(value + direction * step, range);
    if (next !== value) onChange(next);
  };

  const field = (
    <span
      className={['e68-field', 'e68-spin', className ?? ''].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        role="spinbutton"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        autoComplete="off"
        spellCheck={false}
        className="e68-field__input e68-spin__input"
        style={{ width: `calc(${digits}ch + 2 * var(--sp-2))` }}
        value={draft ?? String(value)}
        disabled={disabled}
        data-e68-mnemonic={label ? (parseMnemonic(label).key ?? undefined) : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && draft !== null) {
            // Accept the typed value; a dialog's default button is not pressed by this Enter.
            event.preventDefault();
            commit();
            return;
          }
          if (event.altKey || event.ctrlKey || event.metaKey) return;
          const next = spinKeyValue(event.key, value, range);
          if (next === null) return;
          event.preventDefault();
          setDraft(null);
          if (next !== value) onChange(next);
        }}
        {...rest}
      />
      <span className="e68-spin__buttons" aria-hidden="true">
        <span className="e68-spin__button" onPointerDown={nudge(1)}>
          <Icon name="chevron-up" size={12} />
        </span>
        <span className="e68-spin__button" onPointerDown={nudge(-1)}>
          <Icon name="chevron-down" size={12} />
        </span>
      </span>
    </span>
  );

  if (!label) return field;
  return (
    <label
      htmlFor={inputId}
      className={labelPosition === 'top' ? 'e68-field-label e68-field-label--top' : 'e68-field-label'}
    >
      <span className="e68-field-label__text" data-disabled={disabled ? 'true' : undefined}>
        <Caption text={label} />
      </span>
      {field}
    </label>
  );
}
