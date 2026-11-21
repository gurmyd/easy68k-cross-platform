import { describe, expect, it } from 'vitest';
import { NullSerial } from './null';

const name = Uint8Array.from('COM1', (c) => c.charCodeAt(0));

describe('NullSerial (3.3.4, note 37)', () => {
  const serial = new NullSerial();
  it('task 40 returns 2', () => expect(serial.initComm(0, name)).toBe(2));
  it('task 41 returns 3', () => expect(serial.setCommParams(0, 0x1234)).toBe(3));
  it('task 42: the device read reports "not initialised" (-3)', () => expect(serial.commRead(0, 10)).toBe(-3));
  it('task 43 returns 3', () => expect(serial.sendComm(0, name)).toEqual({ result: 3 }));
  it('has a resetToStartup', () => expect(() => serial.resetToStartup()).not.toThrow());
});
