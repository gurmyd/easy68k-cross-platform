import { describe, expect, it } from 'vitest';
import { NullNet } from './null';

const ip = Uint8Array.from('127.0.0.1', (c) => c.charCodeAt(0));

describe('NullNet (3.3.4, note 37)', () => {
  const net = new NullNet();
  it('task 100 returns $276B0002', () => expect(net.createNetClient(0, ip, 0x2000)).toBe(0x276b0002));
  it('task 101 returns $276B0002', () => expect(net.createNetServer(0)).toBe(0x276b0002));
  it('task 102 returns $276D0001', () => expect(net.sendNet(0, 0x1000, ip)).toEqual({ result: 0x276d0001 }));
  it('task 103 returns 0 with 0 bytes', () =>
    expect(net.receiveNet(0, 0x1000, 0x2000)).toEqual({ result: 0, count: 0 }));
  it('task 104 returns $276D0001', () => expect(net.closeNetConnection(0)).toBe(0x276d0001));
  it('task 105 returns $276D0001', () => expect(net.getLocalIP(0x2000)).toBe(0x276d0001));
  it('task 106 returns $276D0001 in D0', () => expect(net.sendPortNet(0, 0x1000, ip)).toEqual({ d0: 0x276d0001 }));
  it('task 107 returns 0 with 0 bytes', () => expect(net.receivePortNet(0, 0x1000, 0x2000)).toEqual({ d0: 0, d1: 0 }));
  it('the simulator reset closes nothing and returns 0', () => expect(net.netCloseSockets()).toBe(0));
  it('has a resetToStartup', () => expect(() => net.resetToStartup()).not.toThrow());
});
