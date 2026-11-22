// The Hardware panel (ARCHITECTURE.md 1.3.7 row "EASy68K Hardware window"; 2.6; hardware §2, §3, §4).
// Owner: X2.

import { expect, test, type App } from '../fixtures';
import {
  execute,
  expectReg,
  expectState,
  gutter,
  listingRow,
  messages,
  panel,
  program,
  reg,
  tool,
  typeInto,
  view,
  step,
} from './sim';

/**
 * The program's interrupt handlers (autovectors 25 and 26, at $64 and $68) count in D7 and D6 and
 * show that they ran on the LEDs, which the Hardware panel draws while the program runs (the
 * registers are shown only at a stop).
 */
function withHandler(...body: string[]): string[] {
  return [
    '    ORG    $64',
    '    DC.L   IRQ1',
    '    DC.L   IRQ2',
    ...program(
      ...body,
      'IRQ1 ADDQ.L  #1,D7',
      '    MOVE.B  D7,$E00010',
      '    RTE',
      'IRQ2 ADDQ.L  #1,D6',
      '    MOVE.B  #$80,$E00010',
      '    RTE',
    ),
  ];
}

const leds = (app: App) => panel(app, 'hardware').getByRole('img', { name: /^LEDs: / });

const SPIN = withHandler('LOOP BRA     LOOP');

async function hardware(app: App) {
  return view(app, 'Hardware', 'hardware');
}

test('the 7-segment display and the LEDs show the bytes the program writes', async ({ app }) => {
  await execute(
    app,
    program('    MOVE.B  #$A5,$E00010', '    MOVE.B  #$3F,$E00000', '    MOVE.B  #$06,$E0000E', '    SIMHALT'),
  );
  const hw = await hardware(app);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expect(hw.getByRole('img', { name: /^LEDs: / })).toHaveAccessibleName('LEDs: 10100101');
  const lit = await hw
    .locator('[data-led]')
    .evaluateAll((leds) =>
      leds.map((led) => `${led.getAttribute('data-led')}:${led.classList.contains('e68-hw__lamp--on') ? 1 : 0}`),
    );
  expect(lit.sort()).toEqual(['0:1', '1:0', '2:1', '3:0', '4:0', '5:1', '6:0', '7:1']);
  // Digit 1 (leftmost) shows $3F = "0", digit 8 shows $06 = "1"; the others keep $FF.
  await expect(hw.getByRole('img', { name: /^7-segment display: / })).toHaveAccessibleName(
    '7-segment display: 3F FF FF FF FF FF FF 06',
  );
});

test('a switch sets its bit in the switch byte; a held push button clears its bit (active low)', async ({
  app,
  page,
}) => {
  await execute(
    app,
    program(
      '    MOVE.B  $E00012,D1',
      'WAIT MOVE.B  $E00014,D2',
      '    BTST    #3,D2',
      '    BNE     WAIT',
      '    SIMHALT',
    ),
  );
  const hw = await hardware(app);
  await hw.getByRole('switch', { name: 'Switch 0' }).click();
  await hw.getByRole('switch', { name: 'Switch 5' }).click();
  await expect(hw.getByRole('switch', { name: 'Switch 5' })).toBeChecked();
  await step(app);
  await expectReg(app, 'D1', '00000021');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  const button = hw.getByRole('button', { name: 'Push button 3' });
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  try {
    await expectState(app, 'Halted');
  } finally {
    await page.mouse.up();
  }
  expect((await reg(app, 'D2')).slice(6)).toBe('F7');
});

test('IRQ buttons interrupt the running program with exceptions enabled; each level reaches its handler', async ({
  app,
}) => {
  await app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Simulator' }).click();
  await app.chooseMenu('Options', 'Enable Exceptions');
  await execute(app, SPIN);
  const hw = await hardware(app);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Running');
  // One request at a time: each is seen on the LEDs before the next (a request at a level that is
  // still pending is not counted twice by the original either).
  await hw.getByRole('button', { name: 'IRQ 1' }).click();
  await expect(leds(app)).toHaveAccessibleName('LEDs: 00000001');
  await hw.getByRole('button', { name: 'IRQ 1' }).click();
  await expect(leds(app)).toHaveAccessibleName('LEDs: 00000010');
  await hw.getByRole('button', { name: 'IRQ 2' }).click();
  await expect(leds(app)).toHaveAccessibleName('LEDs: 10000000');
  await app.press('sim.run.pause');
  await expectState(app, 'Stopped');
  await expectReg(app, 'D7', '00000002');
  await expectReg(app, 'D6', '00000001');
});

test('auto interval: a checked level interrupts the program every interval while it runs', async ({ app }) => {
  await app.page.getByRole('radiogroup', { name: 'Mode' }).getByRole('radio', { name: 'Simulator' }).click();
  await app.chooseMenu('Options', 'Enable Exceptions');
  await execute(app, SPIN);
  const hw = await hardware(app);
  const label = hw.locator('[data-hw-auto-label]');
  await hw.getByLabel('IRQ level of the auto interval').selectOption('2');
  await typeInto(hw.getByLabel('Auto interval in milliseconds'), '00000050');
  await expect(hw.getByLabel('Auto interval in milliseconds')).toHaveValue('00000050');
  await hw.getByRole('checkbox', { name: 'Automatic IRQ 2' }).check();
  await tool(app, 'sim.run.run');
  await expect(label).toHaveText('Automatic Enabled');
  // Wait for several ticks, by the program's own count: pause and read D6 until it has counted 3.
  await expect
    .poll(
      async () => {
        await app.press('sim.run.pause');
        await expectState(app, 'Stopped');
        const count = parseInt(await reg(app, 'D6'), 16);
        if (count < 3) await tool(app, 'sim.run.run');
        return count;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(3);
  await expect(label).toHaveText('Automatic Disabled');
  expect(await reg(app, 'D7')).toBe('00000000');
});

test('Reset loads SSP and PC from vectors 0 and 1 and sets the interrupt mask to 7', async ({ app }) => {
  await execute(app, [
    '    ORG    0',
    '    DC.L   $00008000',
    '    DC.L   AFTER',
    ...program('    NOP', 'LOOP BRA     LOOP', 'AFTER MOVE.L  #$77,D3', '    SIMHALT'),
  ]);
  const hw = await hardware(app);
  await step(app);
  // Stopped in trace mode, the simulator stays paused at the new PC (hardware §3.8).
  await hw.getByRole('button', { name: 'Reset', exact: true }).click();
  await expectReg(app, 'SS', '00008000');
  await expect.poll(async () => (await reg(app, 'SR')).slice(5, 8)).toBe('111');
  const after = await reg(app, 'PC');
  expect(after).not.toBe('00001000');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expectReg(app, 'D3', '00000077');
});

test('Memory Map: an Invalid range makes an access a bus error that halts the program', async ({ app }) => {
  await execute(app, program('    LEA     $3000,A0', '    MOVE.B  #1,$3000', '    MOVE.B  #2,$5000', '    SIMHALT'));
  const hw = await hardware(app);
  await hw.getByRole('checkbox', { name: 'Invalid:' }).check();
  await typeInto(hw.getByLabel('Invalid start'), '003000');
  await typeInto(hw.getByLabel('Invalid end'), '003FFF');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  const faulting = (await listingRow(app, 'MOVE.B  #1,$3000').textContent())!.trim().slice(0, 8);
  await expect
    .poll(() => messages(app))
    .toContain(`Bus Error: Instruction at ${parseInt(faulting, 16).toString(16)} accessing address 3000`);
  await expect.poll(() => messages(app)).toContain('Execution halted');
  // A bus error with exceptions off disables the hardware: the IRQ and Reset buttons (hardware §3.7).
  for (const level of [1, 2, 3, 4, 5, 6, 7])
    await expect(hw.getByRole('button', { name: `IRQ ${level}` })).toBeDisabled();
  await expect(hw.getByRole('button', { name: 'Reset', exact: true })).toBeDisabled();
  // The bytes of the Invalid range are red in the Stack panel (sim-ui §11.3): A0 points at $3000.
  const stack = await view(app, 'Stack', 'stack');
  await stack.getByLabel('View').selectOption({ label: 'A0' });
  const invalid = (address: string) =>
    stack
      .locator('.e68-stack__row:not(.e68-stack__measure)')
      .filter({ hasText: new RegExp(`^${address}:`) })
      .locator('.e68-stack__byte')
      .evaluateAll((bytes) => bytes.map((b) => b.getAttribute('data-invalid') === 'true'));
  await expect.poll(() => invalid('00003000')).toEqual([true, true, true, true]);
  expect(await invalid('00002FFC')).toEqual([false, false, false, false]);
});

test('Memory Map: ROM ignores writes; Read allows reads and faults on a write; Protected faults in user mode', async ({
  app,
}) => {
  // hardware §4.1 and §4.4 item 1: the Protected check reads the SR the registers show, which a stop
  // refreshes; so the program stops at a breakpoint in user mode before it touches the range.
  await execute(
    app,
    program(
      '    MOVE.B  #1,$3000',
      '    MOVE.B  $3000,D1',
      '    MOVE.B  $4000,D2',
      '    ANDI.W  #$DFFF,SR',
      '    MOVE.B  #3,$5000',
      '    MOVE.B  #4,$4000',
      '    SIMHALT',
    ),
  );
  const hw = await hardware(app);
  for (const [name, start, end] of [
    ['ROM', '003000', '003FFF'],
    ['Read', '004000', '004FFF'],
    ['Protected', '005000', '005FFF'],
  ] as const) {
    await hw.getByRole('checkbox', { name: `${name}:` }).check();
    await typeInto(hw.getByLabel(`${name} start`), start);
    await typeInto(hw.getByLabel(`${name} end`), end);
  }
  const protectedRow = listingRow(app, 'MOVE.B  #3,$5000');
  const at = (await protectedRow.textContent())!.trim().slice(0, 8);
  const address = parseInt(at, 16).toString(16);
  await gutter(protectedRow).click();
  await tool(app, 'sim.run.run');
  await expectReg(app, 'PC', at);
  // The ROM byte kept its $FF; the Read range was read.
  expect(await reg(app, 'D1')).toBe('000000FF');
  expect(await reg(app, 'D2')).toBe('000000FF');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expect.poll(() => messages(app)).toContain(`Bus Error: Instruction at ${address} accessing address 5000`);
  // Without the Protected range the next write, into the Read range, is the bus error.
  await hw.getByRole('checkbox', { name: 'Protected:' }).uncheck();
  await tool(app, 'sim.run.rewind');
  await tool(app, 'sim.run.run');
  await expectReg(app, 'PC', at);
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  const next = parseInt((await listingRow(app, 'MOVE.B  #4,$4000').textContent())!.trim().slice(0, 8), 16).toString(16);
  await expect.poll(() => messages(app)).toContain(`Bus Error: Instruction at ${next} accessing address 4000`);
});

test('the device address fields: a conflicting address is marked', async ({ app }) => {
  await execute(app, program('    SIMHALT'));
  const hw = await hardware(app);
  const led = hw.getByLabel('LEDs address', { exact: true });
  await expect(led).toHaveValue('E00010');
  await typeInto(led, 'E00012');
  await expect(hw.locator('[title="This address overlaps another device"]').first()).toBeVisible();
});
