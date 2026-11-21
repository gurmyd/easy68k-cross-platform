// Single-line text field with a label (ARCHITECTURE.md 2.7, 2.8). Owner: W2.
//
// The label takes the original's caption with '&' ('Fi&nd what:'); in a
// Dialog the access key focuses the field. `message` is a hint or, with
// `invalid`, an error shown under the field and linked as its description.

import { useId, type InputHTMLAttributes, type Ref } from 'react';
import '../../styles/components.css';
import { Caption } from './Caption';
import { parseMnemonic } from './mnemonic';

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'prefix' | 'size'
> {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  labelPosition?: 'left' | 'top';
  /** Monospaced text (addresses, file names in a listing context). */
  monospace?: boolean;
  invalid?: boolean;
  message?: string;
  /** Width in characters; default: fill the container. */
  widthCh?: number;
  /**
   * Least width of a left label, in characters, so that the boxes of several fields line up
   * (Find what: / Replace with). Added at gate I2 (errata W2 entry 23).
   */
  labelWidthCh?: number;
  inputRef?: Ref<HTMLInputElement>;
}

export function TextField({
  value,
  onChange,
  label,
  labelPosition = 'left',
  monospace = false,
  invalid = false,
  message,
  widthCh,
  labelWidthCh,
  inputRef,
  id,
  className,
  disabled,
  readOnly,
  type = 'text',
  ...rest
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const messageId = `${inputId}-message`;
  const field = (
    <span
      className={['e68-field', 'e68-textfield', className ?? ''].filter(Boolean).join(' ')}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-readonly={readOnly ? 'true' : undefined}
      style={widthCh ? { width: `calc(${widthCh}ch + 2 * var(--sp-2) + 2px)` } : { width: '100%' }}
    >
      <input
        ref={inputRef}
        id={inputId}
        type={type}
        className={monospace ? 'e68-field__input e68-field__input--mono' : 'e68-field__input'}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        aria-invalid={invalid || undefined}
        aria-describedby={message ? messageId : undefined}
        data-e68-mnemonic={label ? (parseMnemonic(label).key ?? undefined) : undefined}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
    </span>
  );
  const messageNode = message ? (
    <span id={messageId} className="e68-field-message" data-invalid={invalid ? 'true' : undefined}>
      {message}
    </span>
  ) : null;
  if (!label) {
    return (
      <span className="e68-textfield__wrap">
        {field}
        {messageNode}
      </span>
    );
  }
  return (
    <span className="e68-textfield__wrap">
      <label
        htmlFor={inputId}
        className={labelPosition === 'top' ? 'e68-field-label e68-field-label--top' : 'e68-field-label'}
      >
        <span
          className="e68-field-label__text"
          data-disabled={disabled ? 'true' : undefined}
          style={labelWidthCh && labelPosition === 'left' ? { minWidth: `${labelWidthCh}ch` } : undefined}
        >
          <Caption text={label} />
        </span>
        {field}
      </label>
      {messageNode}
    </span>
  );
}
