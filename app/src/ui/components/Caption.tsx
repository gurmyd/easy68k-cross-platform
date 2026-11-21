// Renders a caption with '&' access-key markers (mnemonic.ts). Owner: W2.

import '../../styles/components.css';
import { parseMnemonic } from './mnemonic';

export interface CaptionProps {
  /** The caption in the original's spelling, for example 'Save &As...'. */
  text: string;
  /** Hide the underline (macOS has no menu access keys, 1.3.2). Default: shown. */
  showMnemonic?: boolean;
}

/** The caption's text with its access key underlined. */
export function Caption({ text, showMnemonic = true }: CaptionProps) {
  const { text: plain, index } = parseMnemonic(text);
  if (index < 0 || !showMnemonic) return <>{plain}</>;
  return (
    <>
      {plain.slice(0, index)}
      <span className="e68-mnemonic">{plain[index]}</span>
      {plain.slice(index + 1)}
    </>
  );
}
