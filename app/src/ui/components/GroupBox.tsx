// Group box: a framed group of controls with a caption in the frame, the original's TGroupBox
// (Assembler Options' "Assembler" and "List", Editor Options' "Text Attributes" and "&Color",
// the font dialog's "Effects", Log Output's memory range, the Break Points groups). Owner: W2.
// Added at gate I2 (errata W2 entry 22): wave two drew five of these by hand, each a little
// differently.
//
// A `fieldset` with a `legend`, so the caption names the group for assistive technology. The
// caption is verbatim; an '&' marks an access key, which in a Dialog moves the focus to the
// first control of the group, as in Windows. `disabled` disables every control inside.

import type { FieldsetHTMLAttributes, ReactNode, Ref } from 'react';
import '../../styles/components.css';
import './GroupBox.css';
import { Caption } from './Caption';
import { parseMnemonic } from './mnemonic';

export interface GroupBoxProps extends Omit<FieldsetHTMLAttributes<HTMLFieldSetElement>, 'children'> {
  /** The caption in the original's spelling, with an optional '&' access-key marker. */
  caption: string;
  children?: ReactNode;
  /** 'column' (default) stacks the controls; 'row' puts them side by side and wraps. */
  layout?: 'column' | 'row';
  ref?: Ref<HTMLFieldSetElement>;
}

export function GroupBox({ caption, children, layout = 'column', className, ref, ...rest }: GroupBoxProps) {
  const mnemonic = parseMnemonic(caption).key;
  const classes = ['e68-groupbox', `e68-groupbox--${layout}`];
  if (className) classes.push(className);
  return (
    <fieldset ref={ref} className={classes.join(' ')} data-e68-mnemonic={mnemonic ?? undefined} {...rest}>
      <legend className="e68-groupbox__caption">
        <Caption text={caption} />
      </legend>
      {children}
    </fieldset>
  );
}
