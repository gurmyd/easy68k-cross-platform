// The Hardware panel (ARCHITECTURE.md 1.3.7 row "EASy68K Hardware window"; 2.6; hardware §2, §3, §4).
// Owner: X2.

import { expect, test, type App } from '../fixtures';
import { execute, expectReg, expectState, messages, panel, program, reg, tool, typeInto, view } from './sim';

/** The program's interrupt handlers count in D7 and return; level 1 at vector 25 ($64). */
function withHandler(...body: string[]): string[] {
  return [
    '    ORG    $64',
    '    DC.L   IRQ1',
    '    DC.L   IRQ2',
    ...program(...body, 'IRQ1 ADDQ.L  #1,D7', '    RTE', 'IRQ2 ADDQ.L  #1,D6', '    RTE'),
  ];
}

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
  await app.press('sim.run.traceInto');
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
  await hw.getByRole('button', { name: 'IRQ 1' }).click();
  await hw.getByRole('button', { name: 'IRQ 1' }).click();
  await hw.getByRole('button', { name: 'IRQ 2' }).click();
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
    ...program('LOOP BRA     LOOP', 'AFTER MOVE.L  #$77,D3', '    SIMHALT'),
  ]);
  const hw = await hardware(app);
  await app.press('sim.run.traceInto');
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
  await execute(app, program('    MOVE.B  #1,$3000', '    MOVE.B  #2,$5000', '    SIMHALT'));
  const hw = await hardware(app);
  await hw.getByRole('checkbox', { name: 'Invalid:' }).check();
  await typeInto(hw.getByLabel('Invalid start'), '003000');
  await typeInto(hw.getByLabel('Invalid end'), '003FFF');
  await tool(app, 'sim.run.run');
  await expectState(app, 'Halted');
  await expect.poll(() => messages(app)).toContain('Bus Error: Instruction at 1000 accessing address 3000');
  await expect.poll(() => messages(app)).toContain('Execution halted');
  // The Invalid range shows red in the Stack panel too (sim-ui §11.3).
  await expect(panel(app, 'hardware')).toBeVisible();
});

test('the device address fields: a conflicting address is marked', async ({ app }) => {
  await execute(app, program('    SIMHALT'));
  const hw = await hardware(app);
  const led = hw.getByLabel('LEDs address', { exact: true });
  await expect(led).toHaveValue('E00010');
  await typeInto(led, 'E00012');
  await expect(hw.locator('[title="This address overlaps another device"]').first()).toBeVisible();
});
