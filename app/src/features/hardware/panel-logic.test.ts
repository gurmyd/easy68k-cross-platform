// The Hardware panel's logic: geometry, texts, field synchronisation and push-button holds.

import { describe, expect, it } from 'vitest';
import { ADDRESS_FIELD, INTERVAL_FIELD } from '../../ui/components';
import { HwDevice, MapKind, type HardwareView } from '../../contracts';
import {
  BITS_LEFT_TO_RIGHT,
  ButtonHolds,
  DEVICE_ROWS,
  DIGIT_ORIGINS,
  LEVELS_LEFT_TO_RIGHT,
  LEVEL_OPTIONS,
  MAP_ROWS,
  SEGMENTS,
  addressText,
  displayDescription,
  intervalText,
  ledDescription,
  ledLeft,
  lit,
  pressesButton,
  syncFieldText,
  viewSignature,
} from './panel-logic';

describe('every control of hardware §5', () => {
  it('eight digits of eight segments a-h, bit 0 = a ... bit 7 = decimal point, 40 px apart', () => {
    expect(SEGMENTS.map((s) => [s.bit, s.name])).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'c'],
      [3, 'd'],
      [4, 'e'],
      [5, 'f'],
      [6, 'g'],
      [7, 'h'],
    ]);
    expect(DIGIT_ORIGINS).toEqual([8, 48, 88, 128, 168, 208, 248, 288]);
    expect(SEGMENTS.find((s) => s.name === 'h')).toEqual({ bit: 7, name: 'h', x: 32, y: 56, w: 5, h: 5 });
  });

  it('$3F shows "0", $06 shows "1", $80 only the decimal point', () => {
    const segmentsOf = (byte: number) =>
      SEGMENTS.filter((s) => lit(byte, s.bit))
        .map((s) => s.name)
        .join('');
    expect(segmentsOf(0x3f)).toBe('abcdef');
    expect(segmentsOf(0x06)).toBe('bc');
    expect(segmentsOf(0x80)).toBe('h');
    expect(segmentsOf(0xff)).toBe('abcdefgh');
  });

  it('LEDs, switches and push buttons run 7..0 left to right; LED n at 16 + 40 (7 - n)', () => {
    expect(BITS_LEFT_TO_RIGHT).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(ledLeft(7)).toBe(16);
    expect(ledLeft(0)).toBe(296);
    expect(LEVELS_LEFT_TO_RIGHT).toEqual([7, 6, 5, 4, 3, 2, 1]);
  });

  it('four address rows and the four memory-map rows with the original captions', () => {
    expect(DEVICE_ROWS.map((r) => r.device)).toEqual([
      HwDevice.Seg7,
      HwDevice.Led,
      HwDevice.Switch,
      HwDevice.PushButton,
    ]);
    expect(DEVICE_ROWS.map((r) => r.commits)).toEqual([false, false, true, true]);
    expect(MAP_ROWS).toEqual([
      { kind: MapKind.Rom, label: 'ROM:', note: 'Writes are ignored' },
      { kind: MapKind.Read, label: 'Read:', note: 'Bus error on write' },
      { kind: MapKind.Protected, label: 'Protected:', note: 'Supervisor access' },
      { kind: MapKind.Invalid, label: 'Invalid:', note: 'Bus error on access' },
    ]);
  });

  it('the level list has items 1..7 and an empty eighth', () => {
    expect(LEVEL_OPTIONS.map((o) => o.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '']);
    expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('describes the display and the LEDs for screen readers', () => {
    expect(displayDescription(Uint8Array.from([0x3f, 6, 0, 0, 0, 0, 0, 0x80]))).toBe(
      '7-segment display: 3F 06 00 00 00 00 00 80',
    );
    expect(ledDescription(0xa5)).toBe('LEDs: 10100101');
  });
});

describe('fields', () => {
  it('addresses show six hex digits, the interval eight decimal digits filled on the left', () => {
    expect(addressText(0xe00000)).toBe('E00000');
    expect(addressText(0x10)).toBe('000010');
    expect(intervalText(250)).toBe('00000250');
    expect(intervalText(1000)).toBe('00001000');
  });

  it('keeps the typed text while the engine catches up, takes the engine value when it moves by itself', () => {
    // The user typed E0 into a cleared field: E00000. The engine has the same number: keep.
    expect(syncFieldText('E00000', 0xe00000, ADDRESS_FIELD)).toBe('E00000');
    // A load or another level selected: the engine's value replaces the text.
    expect(syncFieldText('E00000', 0x100000, ADDRESS_FIELD)).toBe('100000');
    expect(syncFieldText('00001000', 250, INTERVAL_FIELD)).toBe('00000250');
    expect(syncFieldText('', 1000, INTERVAL_FIELD)).toBe('00001000');
  });
});

describe('push buttons', () => {
  function holds() {
    const log: string[] = [];
    const tracker = new ButtonHolds({
      pressButton: (bit) => log.push(`down ${bit}`),
      releaseButton: (bit) => log.push(`up ${bit}`),
    });
    return { log, tracker };
  }

  it('press and release once per hold, whatever the holders', () => {
    const { log, tracker } = holds();
    tracker.press(2, 'pointer:1');
    tracker.press(2, 'key'); // a key on the same button: still one press
    tracker.press(2, 'key'); // auto-repeat
    tracker.release(2, 'pointer:1');
    expect(log).toEqual(['down 2']);
    tracker.release(2, 'key');
    expect(log).toEqual(['down 2', 'up 2']);
    tracker.release(2, 'key'); // no second release
    expect(log).toEqual(['down 2', 'up 2']);
  });

  it('a cancelled pointer releases every button it held', () => {
    const { log, tracker } = holds();
    tracker.press(1, 'pointer:7');
    tracker.press(4, 'pointer:7');
    tracker.press(5, 'key');
    tracker.releaseAll('pointer:7');
    expect(log).toEqual(['down 1', 'down 4', 'down 5', 'up 1', 'up 4']);
    expect(tracker.isHeld(5)).toBe(true);
    tracker.releaseAll(); // the window loses the focus
    expect(log).toEqual(['down 1', 'down 4', 'down 5', 'up 1', 'up 4', 'up 5']);
    expect(tracker.isHeld(5)).toBe(false);
  });

  it('any key presses, except the ones that move the focus or only modify', () => {
    for (const key of [' ', 'Enter', 'a', 'F1', 'ArrowUp']) expect(pressesButton(key)).toBe(true);
    for (const key of ['Tab', 'Shift', 'Control', 'Alt', 'Meta']) expect(pressesButton(key)).toBe(false);
  });
});

describe('viewSignature', () => {
  it('changes with any displayed byte and with the label', () => {
    const view: HardwareView = {
      controls: {
        seg7: 0xe00000,
        led: 0xe00010,
        switches: 0xe00012,
        pushButtons: 0xe00014,
        map: [],
        auto: [null],
        switchOn: [],
        visible: true,
        selectedAutoIrq: 1,
        intervalBox: 1000,
      },
      seg7Bytes: new Uint8Array(8),
      ledByte: 0,
      buttonsEnabled: true,
      autoLabel: 'Automatic',
      addressConflict: { seg7: false, led: false, sw: false, pb: false },
    };
    const base = viewSignature(view);
    expect(viewSignature({ ...view, seg7Bytes: Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]) })).not.toBe(base);
    expect(viewSignature({ ...view, autoLabel: 'Automatic Enabled' })).not.toBe(base);
    expect(viewSignature({ ...view })).toBe(base);
  });
});
