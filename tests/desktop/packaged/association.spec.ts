// Check 3 of ARCHITECTURE.md 6.7, the file-association path: a prebuilt tutorial1.S68 opened with
//
//     open -n -a EASy68K.app tutorial1.S68 --args --remote-debugging-port=<p> --user-data-dir=<tmp>
//
// starts Simulator mode with the program loaded and not running (5.7: an .S68 starts Simulator
// mode afresh and loads without running).
//
// Owner: DV3.

import { basename } from 'node:path';
import { expect, test } from '@playwright/test';
import { registerText } from './facts';
import { IS_MAC, launchPackaged, nativeWindows, NOT_MAC, rootVersion, waitFor, type RunningApp } from './harness';
import { prebuiltManifest, programInFreshFolder } from './prebuilt';

let running: RunningApp | null = null;

test.afterEach(async () => {
  test.setTimeout(120_000);
  await running?.close();
  running = null;
});

test('an .S68 opened through Launch Services starts Simulator mode with the program loaded, not running', async () => {
  test.skip(!IS_MAC, NOT_MAC);
  test.setTimeout(300_000);
  const program = prebuiltManifest().tutorial1;
  const file = programInFreshFolder(program);
  running = await launchPackaged({ name: 'association', via: 'open', file });
  const { page } = running;
  const pc = page.locator('.e68-regs input[data-box="18"]');
  const runState = page.locator('[data-e68-status="run"]');

  // Simulator mode, with the program's start address in the PC.
  await expect(page.locator('footer.e68-statusbar[data-mode="simulator"]')).toBeVisible({ timeout: 90_000 });
  await expect(pc).toHaveValue(registerText(program.start), { timeout: 60_000 });
  // The listing of tutorial1.L68 (found next to the .S68, 4.7) is shown.
  await expect(page.locator('.e68-listing__row').first()).toBeAttached({ timeout: 30_000 });
  await running.screenshot('loaded');

  // Not running: no run state of a running program, and the PC stays where it is.
  await expect(runState).not.toHaveText(/Running|Waiting|Loading/);
  await page.waitForTimeout(2000);
  await expect(pc).toHaveValue(registerText(program.start));
  await expect(runState).not.toHaveText(/Running|Waiting|Loading/);
  console.log(`run state: "${await runState.innerText()}", PC ${await pc.inputValue()}`);

  // Simulator mode's window title is the loaded program's name (1.3.3, sim-ui 8.2).
  const titleEnd = `${basename(file)} - unofficial port ${rootVersion()}`;
  const titles = await waitFor(`a window title ending in "${titleEnd}"`, 30_000, () => {
    const names = nativeWindows(running?.pid ?? -1).map((window) => window.name);
    return names.some((name) => name.endsWith(titleEnd)) ? names : null;
  });
  console.log(`window titles: ${JSON.stringify(titles)}`);
});
