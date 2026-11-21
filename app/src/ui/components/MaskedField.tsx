// Fixed-width overwrite field with blank character '0': the register fields,
// the Hardware panel's addresses and interval (ARCHITECTURE.md 9.1 W2;
// hardware §2.1, §3.6; sim-ui §4.1, §4.4). Owner: W2.
//
// The editing rules are in masked.ts. This component applies them to an
// <input>: keys are taken in keydown (as the original's OnKeyPress filter
// sees them), anything else that would change the text (input methods,
// autocorrect, drag and drop, undo) goes through `beforeinput` and is either
// mapped to the same rules or refused, so the text is always exactly `width`
// characters.
//
// Controlled: `value` is the field text, onChange receives every new text at
// once (the original's OnChange fires on every change, and several panels
// act on it immediately: hardware §2.1, §3.6). onReject is called where the
// original beeps.
//
//   <MaskedField label="D0=" {...REGISTER_FIELD} value={d0} onChange={setD0} autoSelect />
//   <MaskedField label="SR=" {...SR_FIELD} value={sr} onChange={setSr} />
//   <MaskedField label="7-Segment" {...ADDRESS_FIELD} prefix="00" value={a} onChange={setA} />

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ClipboardEvent,
  type FocusEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
} from 'react';
import '../../styles/components.css';
import './MaskedField.css';
import { Caption } from './Caption';
import { applyMaskedEdit, normalizeText, type MaskedConfig, type MaskedEdit } from './masked';
import { parseMnemonic } from './mnemonic';

type InputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'type' | 'maxLength' | 'size' | 'prefix' | 'width'
>;

export interface MaskedFieldProps extends MaskedConfig, InputProps {
  /** The field text; shown normalised to `width` characters (masked.ts normalizeText). */
  value: string;
  onChange: (text: string) => void;
  /** Called where the original beeps (a refused key). */
  onReject?: () => void;
  /** Visible label ('D0=', '&Address:'); omit and pass aria-label for a field labelled elsewhere. */
  label?: string;
  labelPosition?: 'left' | 'top';
  /** A read-only decoration before the digits: '00' (the unused address byte), '$'. */
  prefix?: string;
  /** Select the whole text when the field gets the focus (the VCL default; the registers except SR). */
  autoSelect?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}

export function MaskedField({
  kind,
  width,
  invalidKey,
  backspace,
  maxSelection,
  value,
  onChange,
  onReject,
  label,
  labelPosition = 'left',
  prefix,
  autoSelect = false,
  inputRef,
  id,
  className,
  disabled,
  readOnly,
  onKeyDown,
  onFocus,
  ...rest
}: MaskedFieldProps) {
  const config: MaskedConfig = { kind, width, invalidKey, backspace, maxSelection } as MaskedConfig;
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const ref = useRef<HTMLInputElement | null>(null);
  const pending = useRef<{ start: number; end: number } | null>(null);
  const text = value.length === width ? value : normalizeText(value, config);
  // Latest values for the native listener.
  const latest = useRef({ text, config, onChange, onReject, disabled, readOnly });
  latest.current = { text, config, onChange, onReject, disabled, readOnly };

  /** Applies an edit to the current text and selection; returns whether it was handled. */
  const apply = (edit: MaskedEdit): string | undefined => {
    const input = ref.current;
    const now = latest.current;
    if (!input || now.disabled || now.readOnly) return undefined;
    const result = applyMaskedEdit(
      { text: now.text, selStart: input.selectionStart ?? 0, selEnd: input.selectionEnd ?? 0 },
      edit,
      now.config,
    );
    if (result.beep) now.onReject?.();
    const { selStart, selEnd } = result.state;
    if (result.state.text !== now.text) {
      pending.current = { start: selStart, end: selEnd };
      // Keep the DOM in step at once so that a fast second key reads the right text.
      input.value = result.state.text;
      input.setSelectionRange(selStart, selEnd);
      now.onChange(result.state.text);
    } else {
      input.setSelectionRange(selStart, selEnd);
    }
    return result.clipboard;
  };

  // After a render, the input shows `text`; restore the caret the edit left.
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    if (input.value !== text) input.value = text;
    const want = pending.current;
    if (want && document.activeElement === input) input.setSelectionRange(want.start, want.end);
    pending.current = null;
  });

  // Everything that is not a plain key: map what can be mapped, refuse the rest.
  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    const onBeforeInput = (event: InputEvent) => {
      if (!event.cancelable) return; // composition updates: repaired on compositionend
      event.preventDefault();
      switch (event.inputType) {
        case 'insertText':
        case 'insertReplacementText':
          for (const char of event.data ?? event.dataTransfer?.getData('text/plain') ?? '')
            apply({ type: 'char', char });
          break;
        case 'deleteContentBackward':
        case 'deleteWordBackward':
        case 'deleteSoftLineBackward':
        case 'deleteHardLineBackward':
          apply({ type: 'backspace' });
          break;
        case 'deleteContentForward':
        case 'deleteWordForward':
        case 'deleteSoftLineForward':
        case 'deleteHardLineForward':
          apply({ type: 'delete' });
          break;
        default:
          // insertFromDrop, historyUndo, insertLineBreak, ...: refused.
          break;
      }
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      // An input method changed the DOM text; put the field back and type its result.
      const now = latest.current;
      const caretAt = Math.max(0, (input.selectionStart ?? 0) - event.data.length);
      input.value = now.text;
      input.setSelectionRange(caretAt, caretAt);
      for (const char of event.data) apply({ type: 'char', char });
    };
    input.addEventListener('beforeinput', onBeforeInput);
    input.addEventListener('compositionend', onCompositionEnd);
    return () => {
      input.removeEventListener('beforeinput', onBeforeInput);
      input.removeEventListener('compositionend', onCompositionEnd);
    };
    // apply reads everything through `latest`.
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Backspace') {
      event.preventDefault();
      apply({ type: 'backspace' });
    } else if (event.key === 'Delete') {
      event.preventDefault();
      if (event.shiftKey) cutToClipboard();
      else apply({ type: 'delete' });
    } else if (event.key.length === 1 && !event.altKey) {
      event.preventDefault();
      apply({ type: 'char', char: event.key });
    } else if (event.key.length === 1 && event.altKey) {
      // Option / AltGr characters: the field accepts none of them. Alt+letter
      // access keys of a dialog are handled by the Dialog (it sees the key first
      // only if it is not ours, so leave the event alone).
    }
  };

  const cutToClipboard = (clipboard?: DataTransfer) => {
    const cut = apply({ type: 'cut' });
    if (cut === undefined) return;
    if (clipboard) clipboard.setData('text/plain', cut);
    else void navigator.clipboard?.writeText(cut).catch(() => undefined);
  };

  const field = (
    <span
      className={['e68-field', 'e68-masked', className ?? ''].filter(Boolean).join(' ')}
      data-disabled={disabled ? 'true' : undefined}
      data-readonly={readOnly ? 'true' : undefined}
    >
      {prefix !== undefined && (
        <span className="e68-masked__prefix" aria-hidden="true">
          {prefix}
        </span>
      )}
      <input
        ref={(element) => {
          ref.current = element;
          if (typeof inputRef === 'function') inputRef(element);
          else if (inputRef) inputRef.current = element;
        }}
        id={inputId}
        type="text"
        className="e68-field__input e68-field__input--mono e68-masked__input"
        defaultValue={text}
        size={width}
        maxLength={width}
        inputMode={kind === 'hex' ? 'text' : 'numeric'}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={disabled}
        readOnly={readOnly}
        data-e68-mnemonic={label ? (parseMnemonic(label).key ?? undefined) : undefined}
        style={{ width: `calc(${width}ch + 2 * var(--sp-2))` }}
        onKeyDown={handleKeyDown}
        onFocus={(event: FocusEvent<HTMLInputElement>) => {
          onFocus?.(event);
          if (autoSelect) event.currentTarget.select();
        }}
        onPaste={(event: ClipboardEvent<HTMLInputElement>) => {
          event.preventDefault();
          apply({ type: 'paste', text: event.clipboardData.getData('text/plain') });
        }}
        onCut={(event: ClipboardEvent<HTMLInputElement>) => {
          event.preventDefault();
          cutToClipboard(event.clipboardData);
        }}
        onDrop={(event) => event.preventDefault()}
        {...rest}
      />
    </span>
  );

  if (!label) return field;
  return (
    <label
      htmlFor={inputId}
      className={labelPosition === 'top' ? 'e68-field-label e68-field-label--top' : 'e68-field-label'}
    >
      <span className="e68-field-label__text e68-masked__label" data-disabled={disabled ? 'true' : undefined}>
        <Caption text={label} />
      </span>
      {field}
    </label>
  );
}
