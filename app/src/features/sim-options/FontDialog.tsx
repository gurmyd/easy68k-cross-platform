// The three font dialogs of the simulator, `sim.font` (ARCHITECTURE.md 1.3.4, 1.4 note 27; sim-ui
// §14.1; trap15-a §3.2): Source Window Font, Output Window Font and Printer Font. The port's own,
// in the layout of the Windows font dialog. The Output Window Font lists only the fixed-pitch fonts
// of the measured table, sizes 8 to 18, with style, effects and colour; the Source Window Font the
// same fonts and sizes; the Printer Font any font and size.
//
// Owner: U4.

import { useState } from 'react';
import type { DialogProps } from '../../contracts';
import { Button, Checkbox, Dialog, ListBox, Select, SpinField, TextField } from '../../ui/components';
import {
  FONT_COLORS,
  FONT_DIALOG_TITLES,
  FONT_SIZE_RANGE,
  FONT_STYLES,
  fontChoices,
  fontFrom,
  styleNameOf,
  type FontDialogProps,
  type FontDialogResult,
  type FontStyleName,
} from './model';
import './sim-options.css';

export function FontDialog({ props, close }: DialogProps<FontDialogProps, FontDialogResult>) {
  const { target } = props;
  const withEffects = target === 'output';
  const choices = fontChoices(target, props.font.name);
  const [name, setName] = useState(props.font.name);
  const [size, setSize] = useState(props.font.size);
  const [style, setStyle] = useState<FontStyleName>(styleNameOf(props.font));
  const [underline, setUnderline] = useState(props.font.underline);
  const [strikeOut, setStrikeOut] = useState(props.font.strikeOut);
  const [color, setColor] = useState(props.color);
  const range = FONT_SIZE_RANGE[target];
  const nameValid = target === 'printer' ? name.trim() !== '' : choices.includes(name);
  const colorKnown = FONT_COLORS.some((entry) => entry.color === color);

  const ok = () => {
    if (!nameValid) return;
    const font = withEffects
      ? fontFrom(name, size, style, { underline, strikeOut })
      : fontFrom(name.trim(), size, 'Regular', { underline: false, strikeOut: false });
    close({ font, color });
  };

  return (
    <Dialog
      title={FONT_DIALOG_TITLES[target]}
      width={withEffects ? 520 : 400}
      onCancel={() => close(null)}
      footer={
        <>
          <Button caption="OK" isDefault disabled={!nameValid} onClick={ok} />
          <Button caption="Cancel" onClick={() => close(null)} />
        </>
      }
    >
      <div className="e68-fontdlg" data-testid="font-dialog">
        <div className="e68-fontdlg__column e68-fontdlg__column--wide">
          {target === 'printer' ? (
            <TextField label="&Font:" labelPosition="top" value={name} onChange={setName} spellCheck={false} />
          ) : (
            <span className="e68-fontdlg__label">Font:</span>
          )}
          <ListBox
            label={target === 'printer' ? 'Font list' : 'Font'}
            items={choices.map((font) => ({ value: font, label: font }))}
            value={choices.includes(name) ? name : null}
            onChange={setName}
            rows={6}
          />
        </div>
        {withEffects && (
          <div className="e68-fontdlg__column">
            <span className="e68-fontdlg__label">Font style:</span>
            <ListBox
              label="Font style"
              items={FONT_STYLES.map((entry) => ({ value: entry, label: entry }))}
              value={style}
              onChange={setStyle}
              rows={4}
            />
          </div>
        )}
        <div className="e68-fontdlg__column">
          <SpinField
            label="&Size:"
            labelPosition="top"
            value={size}
            min={range.min}
            max={range.max}
            onChange={setSize}
            digits={3}
          />
        </div>
        {withEffects && (
          <fieldset className="e68-fontdlg__effects">
            <legend>Effects</legend>
            <Checkbox label="Stri&keout" checked={strikeOut} onChange={setStrikeOut} />
            <Checkbox label="&Underline" checked={underline} onChange={setUnderline} />
            <Select
              label="&Color:"
              labelPosition="top"
              options={[
                ...(colorKnown ? [] : [{ value: String(color), label: 'Custom' }]),
                ...FONT_COLORS.map((entry) => ({ value: String(entry.color), label: entry.name })),
              ]}
              value={String(color)}
              onChange={(value) => setColor(Number(value))}
            />
          </fieldset>
        )}
        <div
          className="e68-fontdlg__sample"
          aria-hidden="true"
          style={{
            fontFamily: `'${name.replace(/'/g, '')}', var(--font-mono)`,
            fontWeight: withEffects && style.startsWith('Bold') ? 700 : 400,
            fontStyle: withEffects && style.endsWith('Italic') ? 'italic' : 'normal',
            textDecoration:
              [withEffects && underline ? 'underline' : '', withEffects && strikeOut ? 'line-through' : '']
                .filter(Boolean)
                .join(' ') || 'none',
          }}
        >
          AaBbYyZz
        </div>
      </div>
    </Dialog>
  );
}
