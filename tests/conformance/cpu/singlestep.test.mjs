// Unit tests of the single-step runner (singlestep.mjs) on hand-made tests; no suite, no engine.
import { describe, expect, it } from 'vitest';
import {
  byteRuns,
  deviationClass,
  differences,
  expectedException,
  finalAddresses,
  parseTranscript,
  scriptFor,
} from './singlestep.mjs';

const zeros = {
  d0: 0,
  d1: 0,
  d2: 0,
  d3: 0,
  d4: 0,
  d5: 0,
  d6: 0,
  d7: 0,
  a0: 0,
  a1: 0,
  a2: 0,
  a3: 0,
  a4: 0,
  a5: 0,
  a6: 0,
};

/** MOVEQ #5,D0 at $C00 on a real 68000: D0 = 5, PC + 2, flags N Z V C cleared. */
const moveq = {
  name: '7005 [MOVE.q Q, D0] 1',
  initial: {
    ...zeros,
    usp: 0x1234,
    ssp: 0x800,
    sr: 0x270f,
    pc: 0xc00,
    prefetch: [0x7005, 0x4e71],
    ram: [
      [0xc05, 0x71],
      [0xc04, 0x4e],
    ],
  },
  final: {
    ...zeros,
    d0: 5,
    usp: 0x1234,
    ssp: 0x800,
    sr: 0x2710,
    pc: 0xc02,
    prefetch: [0x4e71, 0x4e71],
    ram: [
      [0xc04, 0x4e],
      [0xc05, 0x71],
    ],
  },
};

describe('script generation', () => {
  it('groups RAM bytes into runs of consecutive addresses', () => {
    expect(
      byteRuns([
        [5, 1],
        [3, 2],
        [4, 3],
        [10, 4],
      ]),
    ).toEqual([
      [3, [2, 3, 1]],
      [10, [4]],
    ]);
  });

  it('writes the set-up, one Trace Into and the dumps of each test', () => {
    const script = scriptFor([moveq]).split('\n');
    expect(script).toContain('option exceptions 1');
    expect(script).toContain('echo test 0');
    // the neutral NOP that clears the double-fault latch of the previous test
    expect(script).toContain('poke $000400 4E71');
    expect(script).toContain('reg SR $270F');
    expect(script).toContain('reg USP $00001234');
    expect(script).toContain('reg PC $00000C00');
    expect(script).toContain('poke $00000C00 70054E71');
    expect(script).toContain('poke $00000C04 4E71');
    expect(script).toContain('dump regs');
    expect(script).toContain('dump bytes $000C04 $000C05');
    // SR before the stack pointers, so that the A7 box follows the S bit
    expect(script.indexOf('reg SR $270F')).toBeLessThan(script.indexOf('reg USP $00001234'));
    expect(finalAddresses(moveq)).toEqual([0xc04, 0xc05]);
  });
});

const transcriptOf = (regs, bytes, extra = []) =>
  [
    'echo test 0',
    ...extra,
    '@message "PC=00000C00  Code=7005  MOVEQ       "',
    'status 1 steps 1',
    `regs ${regs} cycles=4`,
    `bytes ${bytes}`,
    '',
  ].join('\n');
const REGS_OK =
  'D0=00000005 D1=00000000 D2=00000000 D3=00000000 D4=00000000 D5=00000000 D6=00000000 D7=00000000 ' +
  'A0=00000000 A1=00000000 A2=00000000 A3=00000000 A4=00000000 A5=00000000 A6=00000000 USP=00001234 SSP=00000800 PC=00000C02 SR=2710';

describe('reading a transcript and comparing', () => {
  it('reads registers, bytes, messages and status', () => {
    const [r] = parseTranscript(transcriptOf(REGS_OK, '4E71'));
    expect(r.regs.D0).toBe(5);
    expect(r.regs.SR).toBe(0x2710);
    expect(r.regs.cycles).toBe(4);
    expect(r.bytes).toEqual([0x4e, 0x71]);
    expect(r.status).toBe(1);
    expect(r.messages).toHaveLength(1);
  });

  it('finds no difference for the right result; the trace line is not a difference', () => {
    expect(differences(moveq, parseTranscript(transcriptOf(REGS_OK, '4E71'))[0])).toEqual([]);
  });

  it('names each differing field', () => {
    const wrong = REGS_OK.replace('D0=00000005', 'D0=00000006')
      .replace('SR=2710', 'SR=2712')
      .replace('PC=00000C02', 'PC=00000C04');
    const [r] = parseTranscript(transcriptOf(wrong, '4E72', ['@message "Execution halted"', 'wait alert']));
    expect(differences(moveq, r)).toEqual(['D0', 'PC', 'SR.V', 'RAM', 'message']);
  });

  it('reports bits of SR that a 68000 does not have', () => {
    const [r] = parseTranscript(transcriptOf(REGS_OK.replace('SR=2710', 'SR=3710'), '4E71'));
    expect(differences(moveq, r)).toEqual(['SR.unused']);
  });
});

describe('classes', () => {
  it('groups registers and flags so that random register choices give one class', () => {
    expect(deviationClass('ADD.l.json.gz', ['D3', 'D5', 'SR.V', 'SR.C'])).toBe('ADD.l: CCR Dn');
    expect(deviationClass('LEA.json.gz', ['A2'])).toBe('LEA: An');
    expect(deviationClass('MOVE.w.json.gz', ['RAM'], 'address error')).toBe('MOVE.w [address error]: RAM');
  });

  it('recognises the exception a real 68000 takes from the vector in the initial RAM', () => {
    const trap = {
      ...moveq,
      initial: {
        ...moveq.initial,
        ram: [
          [0x80, 0],
          [0x81, 0],
          [0x82, 0x20],
          [0x83, 0x00],
        ],
      },
      final: { ...moveq.final, pc: 0x2000 },
    };
    expect(expectedException(trap)).toBe('TRAP');
    const address = {
      ...trap,
      initial: {
        ...trap.initial,
        ram: [
          [12, 0],
          [13, 0],
          [14, 0x20],
          [15, 0],
        ],
      },
    };
    expect(expectedException(address)).toBe('address error');
    expect(expectedException(moveq)).toBeNull();
  });
});
