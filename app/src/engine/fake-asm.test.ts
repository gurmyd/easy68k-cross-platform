// Unit tests of fake-asm.ts (owner W1; the other *.test.ts files of app/src/engine are W4's).

import { describe, expect, it } from 'vitest';
import { TabType, type AsmOptions } from '../contracts';
import { FakeAsmEngine, fakeAsmResult, fakeMessage } from './fake-asm';

const options: AsmOptions = {
  generateListing: true,
  generateSRecord: true,
  constantsExpanded: false,
  bitFieldInstructions: true,
  crossReference: true,
  macrosExpanded: false,
  structuredExpanded: false,
  showWarnings: true,
  tabType: TabType.Fixed,
  tabSize: 4,
};
const files = new Map([['demo/prog.X68', Uint8Array.of(0x20)]]);
const when = new Date(2026, 10, 20, 13, 7, 46);

describe('FakeAsmEngine', () => {
  it('answers a clean assembly by default and records the call', async () => {
    const asm = new FakeAsmEngine();
    const result = await asm.assemble('demo/prog.X68', files, options, when);
    expect(result).toEqual({
      listing: new Uint8Array(0),
      listingName: 'demo/prog.L68',
      sRecord: new Uint8Array(0),
      sRecordName: 'demo/prog.S68',
      messages: [],
      errorCount: 0,
      warningCount: 0,
      executeEnabled: true,
      dialogs: [],
      status: 0,
      fatal: null,
    });
    expect(asm.calls).toHaveLength(1);
    expect(asm.calls[0]).toMatchObject({ mainName: 'demo/prog.X68', options, timestamp: when });
    expect(asm.calls[0]?.files.get('demo/prog.X68')).toEqual(Uint8Array.of(0x20));
  });

  it('produces no listing or S-record when the options say so', async () => {
    const asm = new FakeAsmEngine();
    const result = await asm.assemble(
      'p.X68',
      files,
      { ...options, generateListing: false, generateSRecord: false },
      when,
    );
    expect(result.listing).toBeNull();
    expect(result.sRecord).toBeNull();
  });

  it('answers from the queue in order, then from the responder', async () => {
    const asm = new FakeAsmEngine((call) => ({ status: call.mainName.length }));
    asm.enqueue(
      { messages: [fakeMessage(3, 'ERROR: Invalid syntax'), fakeMessage(5, 'WARNING: Long branch')] },
      (call) => ({ dialogs: [{ caption: 'c', text: call.mainName }] }),
    );
    const first = await asm.assemble('a.X68', files, options, when);
    expect(first).toMatchObject({ errorCount: 1, warningCount: 1, executeEnabled: false });
    expect(first.messages[0]).toEqual({
      line: 3,
      severity: 'error',
      code: 0x401,
      text: 'ERROR: Invalid syntax',
      file: null,
      resolvedFile: null,
    });
    expect((await asm.assemble('b.X68', files, options, when)).dialogs).toEqual([{ caption: 'c', text: 'b.X68' }]);
    expect((await asm.assemble('abc.X68', files, options, when)).status).toBe(7);
  });

  it('rejects with an enqueued Error', async () => {
    const asm = new FakeAsmEngine().enqueue(new Error('instance failed'));
    await expect(asm.assemble('a.X68', files, options, when)).rejects.toThrow('instance failed');
  });

  it('fakeAsmResult completes a partial result', () => {
    expect(fakeAsmResult('x.y/prog', { fatal: 'stopped' })).toMatchObject({
      listingName: 'x.y/prog.L68',
      sRecordName: 'x.y/prog.S68',
      fatal: 'stopped',
      errorCount: 0,
    });
  });
});
