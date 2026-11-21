// Group of radio buttons (ARCHITECTURE.md 2.7). Owner: W2.
//
// Native radio buttons in a labelled `radiogroup`: the group is one tab stop
// (the checked button), the arrow keys move and select, as the browser and
// the original both do.

import { useId } from 'react';
import '../../styles/components.css';
import './Checkbox.css';
import './RadioGroup.css';
import { Caption } from './Caption';
import { parseMnemonic } from './mnemonic';

export interface RadioOption<V extends string> {
  value: V;
  /** Caption with an optional '&'. */
  label: string;
  disabled?: boolean;
  title?: string;
}

export interface RadioGroupProps<V extends string> {
  /** The group's caption ('Tab Type'). */
  label: string;
  options: readonly RadioOption<V>[];
  value: V;
  onChange: (value: V) => void;
  orientation?: 'vertical' | 'horizontal';
  disabled?: boolean;
  /** Show the caption as a group heading; false keeps it for screen readers only. Default true. */
  showLabel?: boolean;
  name?: string;
  className?: string;
}

export function RadioGroup<V extends string>({
  label,
  options,
  value,
  onChange,
  orientation = 'vertical',
  disabled = false,
  showLabel = true,
  name,
  className,
}: RadioGroupProps<V>) {
  const id = useId();
  const groupName = name ?? `${id}-radio`;
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-orientation={orientation}
      className={['e68-radiogroup', `e68-radiogroup--${orientation}`, className ?? ''].filter(Boolean).join(' ')}
    >
      <span id={`${id}-label`} className={showLabel ? 'e68-radiogroup__label' : 'e68-sr'}>
        {label}
      </span>
      <div className="e68-radiogroup__options">
        {options.map((option) => {
          const optionDisabled = disabled || option.disabled === true;
          const optionId = `${id}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={optionId}
              className="e68-checkbox e68-radio"
              data-disabled={optionDisabled ? 'true' : undefined}
              title={option.title}
            >
              <input
                id={optionId}
                type="radio"
                name={groupName}
                value={option.value}
                className="e68-checkbox__input"
                checked={option.value === value}
                disabled={optionDisabled}
                data-e68-mnemonic={parseMnemonic(option.label).key ?? undefined}
                onChange={() => onChange(option.value)}
              />
              <span className="e68-checkbox__box e68-radio__circle" aria-hidden="true">
                <span className="e68-radio__dot" />
              </span>
              <span className="e68-checkbox__label">
                <Caption text={option.label} />
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
