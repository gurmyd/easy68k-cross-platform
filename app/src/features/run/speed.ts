// The logic of the Execution Speed dialog (ARCHITECTURE.md 4.5.6): three choices, and for the
// custom one a number of instructions per second.
//
// Owner: SH8.

import type { SimSettings } from '../../contracts';
import { DEFAULT_IPS } from '../../core/run/governor';

export type Speed = SimSettings['speed'];
export type SpeedMode = Speed['mode'];

/** The custom rate may be anything from one instruction per second to far beyond what the engine reaches. */
export const MIN_CUSTOM_IPS = 1;
export const MAX_CUSTOM_IPS = 1_000_000_000;

/** The captions of the three choices; the first two are the names 4.5.6 gives. */
export const SPEED_CHOICES: readonly { value: SpeedMode; label: string }[] = [
  { value: 'original', label: '&EASy68K-like' },
  { value: 'max', label: '&Maximum' },
  { value: 'custom', label: 'C&ustom' },
];

/** What the dialog says under the choices. */
export function speedNote(mode: SpeedMode): string {
  switch (mode) {
    case 'original':
      return (
        `About ${DEFAULT_IPS.toLocaleString('en-US')} instructions per second, the same on every computer. ` +
        'EASy68K itself is in this range; its speed depends on the PC.'
      );
    case 'max':
      return 'As fast as this computer allows. Delay loops finish almost at once.';
    case 'custom':
      return 'A fixed number of instructions per second.';
  }
}

/** A hint that applies to every choice (4.5.6). */
export const TIMING_HINT = 'Programs that must keep time should use TRAP #15 task 23 or task 8.';

/** The number in the custom field, or null if the text is not a whole number in range. */
export function parseCustomRate(text: string): number | null {
  const digits = text.trim().replaceAll(',', '');
  if (!/^\d{1,10}$/.test(digits)) return null;
  const value = Number(digits);
  return value >= MIN_CUSTOM_IPS && value <= MAX_CUSTOM_IPS ? value : null;
}

/** The setting the dialog returns for OK, or null while the custom field does not hold a valid number. */
export function speedFromDialog(mode: SpeedMode, customText: string, previous: Speed): Speed | null {
  if (mode !== 'custom') return { mode, instructionsPerSecond: previous.instructionsPerSecond };
  const rate = parseCustomRate(customText);
  return rate === null ? null : { mode, instructionsPerSecond: rate };
}
