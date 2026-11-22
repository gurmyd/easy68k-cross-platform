// The serial tasks of TRAP #15 (40-43) in the desktop app (ARCHITECTURE.md 3.3.4, 9.6 DV4;
// trap15-a §6), against a pseudo-terminal pair the test makes with the system's Python 3: a 68000
// program opens `COM4`, which AppSettings.serialPortMap maps to the pair's slave device, sets the
// line, sends, and reads the echo the master side sends back. The port stays open across Open,
// Rewind and Reload and is closed by a cold start (Execute). The Serial Ports dialog edits the map.
//
// Pseudo-terminals exist on macOS and Linux; on Windows the serial part is skipped with its reason
// and the dialog test runs alone.
//
// Owner: DV4 (a spec of its own in DV2's folder; docs/porting/errata/DV4.md).

import { expect, test, type Page } from '@playwright/test';
import {
  enginesAvailable,
  launchDesktop,
  startDevServer,
  warmUpDevPage,
  type Desktop,
  type DevServer,
} from './harness';
import {
  captureWindow,
  coldStart,
  deviceCalls,
  hex,
  programs,
  readMemory,
  startProgram,
  startPty,
  textOf,
  waitDone,
  type Pty,
} from './dv4-helpers';

const HAS_PTY = process.platform === 'darwin' || process.platform === 'linux';
const NO_PTY = 'pseudo-terminals exist on macOS and Linux only; this system has none (docs/porting/errata/DV4.md)';
const BUFFER = 0x4000;

let server: DevServer;
let desktop: Desktop;

test.beforeAll(async () => {
  test.setTimeout(300_000);
  server = await startDevServer();
  desktop = await launchDesktop({ devServer: server });
  await warmUpDevPage(desktop.page);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await desktop?.close();
  await server?.close();
});
test.afterEach(async () => {
  await coldStart(desktop.page).catch(() => {});
  expect(desktop.errors, 'console errors of the app').toEqual([]);
});

async function setPortMap(page: Page, map: Record<string, string>): Promise<void> {
  await page.evaluate((portMap) => {
    const { settings } = window.__easy68k.ctx;
    settings.update((s: { app: object }) => ({ ...s, app: { ...s.app, serialPortMap: portMap } }));
  }, map);
}

test.describe('serial tasks against a pseudo-terminal pair', () => {
  let pty: Pty;
  test.beforeEach(async () => {
    test.skip(!HAS_PTY, NO_PTY);
    test.skip(!enginesAvailable(), 'engine/dist is missing (npm run build:engines or fetch:engines)');
    pty = await startPty();
    console.log(`pseudo-terminal: ${pty.path}`);
    await setPortMap(desktop.page, { COM4: pty.path });
  });
  test.afterEach(async () => {
    if (pty) {
      console.log(`pseudo-terminal log: ${JSON.stringify(pty.log)}`);
      await pty.close();
    }
  });

  test('tasks 40-43: open COM4, set the line, send, read the echo; the result codes of trap15-a §6', async () => {
    test.setTimeout(180_000);
    const P = await programs();
    const program = P.buildProgram({
      strings: { PORT: 'COM4', LOWER: 'com4', NOPORT: 'COM9', DATA: 'PING' },
      steps: [
        { kind: 'call', task: 40, d0High: 0, a1: 'PORT', save: 'open' },
        // 115200, even parity, 7 data bits, 2 stop bits; then back to 9600,N,8,1.
        { kind: 'call', task: 41, d0High: 0, d1: 12 | (2 << 8) | (1 << 10) | (1 << 12), save: 'line' },
        { kind: 'call', task: 41, d0High: 0, d1: 0, save: 'lineDefault' },
        // A baud index without a case keeps the settings: 0.
        { kind: 'call', task: 41, d0High: 0, d1: 99, save: 'lineNoCase' },
        // Mark parity: what this system's serial driver makes of it is printed, not judged.
        { kind: 'call', task: 41, d0High: 0, d1: 3 << 8, save: 'lineMark' },
        { kind: 'call', task: 41, d0High: 0, d1: 0, save: 'lineDefaultAgain' },
        { kind: 'call', task: 43, d0High: 0, d1: 4, a1: 'DATA', save: 'send' },
        { kind: 'readSerial', cid: 0, want: 4, tries: 500, delay: 1, save: 'read' },
        // Task 40 again on the same CID closes the port first and opens it again.
        { kind: 'call', task: 40, d0High: 0, a1: 'LOWER', save: 'reopen' },
        { kind: 'call', task: 40, d0High: 1, a1: 'NOPORT', save: 'unmapped' },
        { kind: 'call', task: 41, d0High: 2, d1: 0, save: 'paramsNotOpen' },
        { kind: 'call', task: 42, d0High: 2, d1: 4, a1: 'BUFFER', save: 'readNotOpen' },
        { kind: 'call', task: 43, d0High: 2, d1: 4, a1: 'DATA', save: 'sendNotOpen' },
        { kind: 'call', task: 43, d0High: 16, d1: 4, a1: 'DATA', save: 'badCid' },
      ],
    });
    const before = await deviceCalls(desktop.app);
    await startProgram(desktop.page, program, 'serial');
    const slots = await waitDone(desktop.page, program, 'the serial program');
    const after = await deviceCalls(desktop.app);
    expect(slots['open']?.d0).toBe(hex(0));
    expect(slots['line']?.d0).toBe(hex(0));
    expect(slots['lineDefault']?.d0).toBe(hex(0));
    expect(slots['lineNoCase']?.d0).toBe(hex(0));
    console.log(`task 41 with mark parity on ${process.platform}: D0 = ${slots['lineMark']?.d0}`);
    expect(slots['lineDefaultAgain']?.d0).toBe(hex(0));
    // D0.W = 0, D1.B = bytes sent.
    expect(slots['send']?.d0).toBe(hex(0));
    expect((parseInt(slots['send']?.d1.slice(1) ?? '0', 16) & 0xff) >>> 0).toBe(4);
    expect(slots['read']).toEqual({ d0: hex(0), d1: hex(4) });
    expect(textOf(await readMemory(desktop.page, BUFFER, 4))).toBe('PING');
    expect(slots['reopen']?.d0).toBe(hex(0));
    expect(slots['unmapped']?.d0).toBe(hex((1 << 16) | 2));
    expect(slots['paramsNotOpen']?.d0).toBe(hex((2 << 16) | 3));
    expect(slots['readNotOpen']?.d0).toBe(hex((2 << 16) | 3));
    expect(slots['sendNotOpen']?.d0).toBe(hex((2 << 16) | 3));
    expect(slots['badCid']?.d0).toBe(hex((16 << 16) | 1));
    expect(pty.log.some((line) => line.includes('PING'))).toBe(true);
    // Reads come from the page's buffer: task 42 made no bridge call.
    const serialCalls = Object.fromEntries(
      Object.keys(after)
        .filter((channel) => channel.startsWith('serial.') && (after[channel] ?? 0) !== (before[channel] ?? 0))
        .map((channel) => [channel, (after[channel] ?? 0) - (before[channel] ?? 0)]),
    );
    console.log(`serial bridge calls: ${JSON.stringify(serialCalls)}`);
    expect(Object.keys(serialCalls).sort()).toEqual([
      'serial.close',
      'serial.configure',
      'serial.open',
      'serial.write',
    ]);
  });

  test('a port stays open across Open, Rewind and Reload, and a cold start (Execute) closes it', async () => {
    test.setTimeout(240_000);
    const P = await programs();
    const opener = P.buildProgram({
      strings: { PORT: 'COM4' },
      steps: [{ kind: 'call', task: 40, d0High: 0, a1: 'PORT', save: 'open' }],
    });
    // Sends on CID 0 without opening it, then reads the echo.
    const sender = P.buildProgram({
      strings: { DATA: 'AB' },
      steps: [
        { kind: 'call', task: 43, d0High: 0, d1: 2, a1: 'DATA', save: 'send' },
        { kind: 'readSerial', cid: 0, want: 2, tries: 300, delay: 1, save: 'read' },
      ],
    });
    await startProgram(desktop.page, opener, 'opener');
    expect((await waitDone(desktop.page, opener, 'the opener'))['open']?.d0).toBe(hex(0));

    const expectOpen = async (what: string, run: number) => {
      const slots = await waitDone(desktop.page, sender, `the sender after ${what}`, run);
      expect(slots['send']?.d0, what).toBe(hex(0));
      expect(slots['read'], what).toEqual({ d0: hex(0), d1: hex(2) });
      expect(textOf(await readMemory(desktop.page, BUFFER, 2)), what).toBe('AB');
    };

    // File > Open of another program.
    await startProgram(desktop.page, sender, 'sender');
    await expectOpen('Open', 1);
    // Rewind (memory stays: this is run 2 since the load).
    await desktop.page.evaluate(() => {
      const { controller } = window.__easy68k.ctx.sim;
      controller.rewind();
      controller.run();
    });
    await expectOpen('Rewind', 2);
    // Reload (memory loaded again: run 1).
    await desktop.page.evaluate(async () => {
      const { controller } = window.__easy68k.ctx.sim;
      await controller.reload();
      controller.run();
    });
    await expectOpen('Reload', 1);

    // Execute: the cold start closes every port.
    const closes = (await deviceCalls(desktop.app))['serial.close'] ?? 0;
    await startProgram(desktop.page, sender, 'sender-execute', 'execute');
    const slots = await waitDone(desktop.page, sender, 'the sender after Execute');
    expect(slots['send']?.d0).toBe(hex(3));
    expect(slots['read']?.d0).toBe(hex(3));
    expect(((await deviceCalls(desktop.app))['serial.close'] ?? 0) - closes).toBe(1);
  });
});

test('the Serial Ports dialog edits AppSettings.serialPortMap', async () => {
  test.setTimeout(180_000);
  const testInfo = test.info();
  const { page } = desktop;
  await setPortMap(page, { COM4: '/dev/ttys004' });
  await page.evaluate(async () => {
    const { ctx } = window.__easy68k;
    await ctx.commands.run('app.mode.set', 'simulator');
    const module = await import(String('/src/features/desktop-devices/index.ts'));
    (window as unknown as Record<string, unknown>)['__dv4Dialog'] = module.openSerialPortsDialog(ctx);
  });
  const dialog = page.getByRole('dialog', { name: 'Serial Ports' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('textbox', { name: 'Name:' })).toHaveValue('COM4');
  await expect(dialog.getByRole('textbox', { name: 'Device:' })).toHaveValue('/dev/ttys004');
  const shot = testInfo.outputPath('serial-ports-dialog.png');
  console.log(`the dialog: ${(await captureWindow(desktop.app, page, shot)) ? shot : 'no capture'}`);
  await dialog.getByRole('button', { name: 'Add Port' }).click();
  const names = dialog.getByRole('textbox', { name: 'Name:' });
  await expect(names).toHaveCount(2);
  await expect(names.nth(1)).toHaveValue('COM1');
  // OK is off while the new row has no device.
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  // A device problem marks the Device field of its row, not the Name field.
  await expect(names.nth(1)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('textbox', { name: 'Device:' }).nth(1)).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByRole('textbox', { name: 'Device:' }).nth(1).fill('/dev/cu.usbserial-TEST');
  // A name used twice (in any letter case) marks the Name field, with its message, not the device.
  await names.nth(1).fill('com4');
  await expect(names.nth(1)).toHaveAttribute('aria-invalid', 'true');
  await expect(names.nth(1)).toHaveAccessibleDescription('com4 is in the list twice.');
  await expect(dialog.getByRole('textbox', { name: 'Device:' }).nth(1)).not.toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('button', { name: 'OK' })).toBeDisabled();
  const twice = testInfo.outputPath('serial-ports-dialog-twice.png');
  console.log(
    `the dialog with a name twice: ${(await captureWindow(desktop.app, page, twice)) ? twice : 'no capture'}`,
  );
  await names.nth(1).fill('COM1');
  await expect(names.nth(1)).not.toHaveAttribute('aria-invalid', 'true');
  const added = testInfo.outputPath('serial-ports-dialog-added.png');
  console.log(`the dialog with a new row: ${(await captureWindow(desktop.app, page, added)) ? added : 'no capture'}`);
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  const saved = await page.evaluate(async () => {
    const ok = await (window as unknown as { __dv4Dialog: Promise<boolean> }).__dv4Dialog;
    return { ok, map: window.__easy68k.ctx.settings.get().app.serialPortMap };
  });
  expect(saved).toEqual({ ok: true, map: { COM4: '/dev/ttys004', COM1: '/dev/cu.usbserial-TEST' } });
  await setPortMap(page, {});
});
