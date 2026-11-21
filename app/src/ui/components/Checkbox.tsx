// Check box (ARCHITECTURE.md 2.7, 2.8). Owner: W2.
//
// A native checkbox, drawn by the kit. The caption takes the original's '&'
// access key ('&Execute' style); `title` is the original's tool-tip (the
// Assembler Options check boxes have one each).

import { useId, type InputHTMLAttributes, type Ref } from 'react';
import '../../styles/components.css';
import './Checkbox.css';
import { Caption } from './Caption';
import { Icon } from './Icon';
import { parseMnemonic } from './mnemonic';

export interface CheckboxProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'defaultChecked' | 'onChange'
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Caption with an optional '&'. Omit only with aria-label (a check box in a grid cell). */
  label?: string;
  inputRef?: Ref<HTMLInputElement>;
}

export function Checkbox({
  checked,
  onChange,
  label,
  inputRef,
  id,
  className,
  disabled,
  title,
  ...rest
}: CheckboxProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  return (
    <label
      htmlFor={inputId}
      className={['e68-checkbox', className ?? ''].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      title={title}
    >
      <input
        ref={inputRef}
        id={inputId}
        type="checkbox"
        className="e68-checkbox__input"
        checked={checked}
        disabled={disabled}
        data-e68-mnemonic={label ? (parseMnemonic(label).key ?? undefined) : undefined}
        onChange={(event) => onChange(event.target.checked)}
        {...rest}
      />
      <span className="e68-checkbox__box" aria-hidden="true">
        <Icon name="check" size={12} className="e68-checkbox__check" />
      </span>
      {label !== undefined && (
        <span className="e68-checkbox__label">
          <Caption text={label} />
        </span>
      )}
    </label>
  );
}
