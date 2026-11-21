// Multi-line text field with an optional label (ARCHITECTURE.md 2.7, 2.8). Owner: W2.
// Added at gate I2 (errata W2 entry 24): E4's template editor (Assembler Options, Template tab)
// drew its own textarea with its own frame and focus ring.
//
// The frame, the hover, focus, invalid, disabled and read-only states are those of TextField
// (`.e68-field`). The text is never wrapped unless `wrap` says so ('off' by default: the
// original's TMemo with ScrollBars ssBoth), and the box scrolls both ways. `height` is the height
// of the box (number = px, or a CSS length); without it the box is `rows` lines tall. A font of
// the caller's (the editor font) goes on through `style`, which reaches the textarea itself.

import { useId, type Ref, type TextareaHTMLAttributes } from 'react';
import '../../styles/components.css';
import { Caption } from './Caption';
import { parseMnemonic } from './mnemonic';

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'value' | 'defaultValue' | 'onChange'
> {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  /** Default 'top'. */
  labelPosition?: 'left' | 'top';
  /** Monospaced text. */
  monospace?: boolean;
  invalid?: boolean;
  message?: string;
  /** Height of the box (number = px, or a CSS length); default: `rows` lines. */
  height?: number | string;
  textareaRef?: Ref<HTMLTextAreaElement>;
}

export function TextArea({
  value,
  onChange,
  label,
  labelPosition = 'top',
  monospace = false,
  invalid = false,
  message,
  height,
  textareaRef,
  id,
  className,
  disabled,
  readOnly,
  wrap = 'off',
  spellCheck = false,
  ...rest
}: TextAreaProps) {
  const generatedId = useId();
  const areaId = id ?? generatedId;
  const messageId = `${areaId}-message`;
  const field = (
    <span
      className={['e68-field', 'e68-textarea', className ?? ''].filter(Boolean).join(' ')}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      data-readonly={readOnly ? 'true' : undefined}
      style={height !== undefined ? { height: typeof height === 'number' ? `${height}px` : height } : undefined}
    >
      <textarea
        ref={textareaRef}
        id={areaId}
        className={monospace ? 'e68-textarea__input e68-field__input--mono' : 'e68-textarea__input'}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        wrap={wrap}
        spellCheck={spellCheck}
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
  return (
    <span className="e68-textarea__wrap">
      {label ? (
        <label
          htmlFor={areaId}
          className={labelPosition === 'top' ? 'e68-field-label e68-field-label--top' : 'e68-field-label'}
        >
          <span className="e68-field-label__text" data-disabled={disabled ? 'true' : undefined}>
            <Caption text={label} />
          </span>
          {field}
        </label>
      ) : (
        field
      )}
      {messageNode}
    </span>
  );
}
