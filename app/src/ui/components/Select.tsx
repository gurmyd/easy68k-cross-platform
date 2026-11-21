// Drop-down list (ARCHITECTURE.md 2.7): the original's combo boxes (Stack
// panel's View list, the Hardware panel's IRQ level, zoom, fonts). Owner: W2.
//
// A native <select> in the kit's frame: the platform draws the open list and
// provides the keyboard behaviour and accessibility of its own combo boxes,
// in the browser and in the macOS app alike.

import { useId, type Ref, type SelectHTMLAttributes } from 'react';
import '../../styles/components.css';
import './Select.css';
import { Caption } from './Caption';
import { Icon } from './Icon';
import { parseMnemonic } from './mnemonic';

export interface SelectOption<V extends string> {
  value: V;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<V extends string> extends Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  'value' | 'defaultValue' | 'onChange' | 'multiple'
> {
  options: readonly SelectOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label?: string;
  labelPosition?: 'left' | 'top';
  /** Monospaced option text. */
  monospace?: boolean;
  /** Width in characters; default: as wide as the widest option. */
  widthCh?: number;
  selectRef?: Ref<HTMLSelectElement>;
}

export function Select<V extends string>({
  options,
  value,
  onChange,
  label,
  labelPosition = 'left',
  monospace = false,
  widthCh,
  selectRef,
  id,
  className,
  disabled,
  ...rest
}: SelectProps<V>) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  const field = (
    <span
      className={['e68-field', 'e68-select', className ?? ''].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      style={widthCh ? { width: `calc(${widthCh}ch + 40px)` } : undefined}
    >
      <select
        ref={selectRef}
        id={selectId}
        className={monospace ? 'e68-select__control e68-field__input--mono' : 'e68-select__control'}
        value={value}
        disabled={disabled}
        data-e68-mnemonic={label ? (parseMnemonic(label).key ?? undefined) : undefined}
        onChange={(event) => onChange(event.target.value as V)}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-down" size={14} className="e68-select__chevron" />
    </span>
  );
  if (!label) return field;
  return (
    <label
      htmlFor={selectId}
      className={labelPosition === 'top' ? 'e68-field-label e68-field-label--top' : 'e68-field-label'}
    >
      <span className="e68-field-label__text" data-disabled={disabled ? 'true' : undefined}>
        <Caption text={label} />
      </span>
      {field}
    </label>
  );
}
