// Check 5 of ARCHITECTURE.md 6.7: minimise the window while a program waits in a task 23 delay of
// 300 units; it finishes within 3.5 s (4.5.5: the desktop app turns background throttling off, and
// the scheduler's watchdog keeps a program going when a minimised window produces no frames).
//
// The program (prebuilt.ts delay300) is given on the command line, so it is loaded without running
// (5.7). F9 runs it; as soon as the status bar says Running, System Events minimises the window;
// the time from F9 to the moment the status bar says Halted (noted by the page itself) is the
// figure, and the program measures the delay itself with task 8 (D7 = elapsed hundredths). A timing check on a shared runner takes the
// best of up to three runs, each in a newly started app, and prints every figure.
//
// Owner: DV3.

import { expect, test } from '@playwright/test';
import { judgeMinimisedRun, registerText } from './facts';
import { IS_MAC, launchPackaged, minimiseWindow, nativeWindows, NOT_MAC, waitFor, type RunningApp } from './harness';
import { prebuiltManifest, programInFreshFolder } from './prebuilt';

const LIMIT_MS = 3500;
const ATTEMPTS = 3;

let running: RunningApp | null = null;

test.afterEach(async () => {
  test.setTimeout(120_000);
  await running?.close();
  running = null;
});

interface Attempt {
  ok: boolean;
  elapsedMs: number | null;
  reason: string;
  minimisedAfterMs: number | null;
  visibility: string | null;
  programHundredths: number | null;
}

async function attempt(index: number): Promise<Attempt> {
  const program = prebuiltManifest().delay300;
  running = await launchPackaged({ name: `minimise-${index}`, file: programInFreshFolder(program) });
  const { page, pid } = running;
  const pc = page.locator('.e68-regs input[data-box="18"]');
  const runState = page.locator('[data-e68-status="run"]');
  try {
    await expect(page.locator('footer.e68-statusbar[data-mode="simulator"]')).toBeVisible({ timeout: 90_000 });
    await expect(pc).toHaveValue(registerText(program.start), { timeout: 60_000 });
    await expect(runState).not.toHaveText(/Running/);
    await running.screenshot('loaded');

    // The page notes the moment the status bar says Halted (a MutationObserver: no timer, no frame,
    // so a minimised window cannot delay it), on the same clock as this process. The System Events
    // calls below block this process for a moment each, which must not count as the program's time.
    await page.evaluate(() => {
      const cell = document.querySelector('[data-e68-status="run"]');
      const record = window as unknown as { __e68HaltedAt: number | null };
      record.__e68HaltedAt = null;
      if (!cell) return;
      new MutationObserver(() => {
        if (record.__e68HaltedAt === null && cell.textContent === 'Halted') record.__e68HaltedAt = Date.now();
      }).observe(cell, { childList: true, characterData: true, subtree: true });
    });

    const runAt = Date.now();
    await page.keyboard.press('F9');
    await waitFor('the status bar to say Running', 2500, async () =>
      (await runState.innerText()) === 'Running' ? true : null,
    );
    const titlePart = 'delay300.S68';
    const minimised = minimiseWindow(pid, titlePart);
    const minimisedAt = minimised ? Date.now() : null;
    // Minimising is animated: wait until macOS reports the window minimised.
    const confirmed = await waitFor('the window to be minimised', 5000, () =>
      nativeWindows(pid).some((window) => window.name.includes(titlePart) && window.minimised) ? true : null,
    ).catch(() => false);
    const visibility = await page.evaluate(() => document.visibilityState).catch(() => null);

    let finishedAt: number | null = null;
    try {
      await waitFor('the status bar to say Halted', 15_000, async () =>
        (await runState.innerText()) === 'Halted' ? true : null,
      );
      finishedAt = await page.evaluate(() => (window as unknown as { __e68HaltedAt: number | null }).__e68HaltedAt);
    } catch {
      finishedAt = null;
    }
    const d7 = await page
      .locator('.e68-regs input[data-box="7"]')
      .inputValue()
      .catch(() => '');
    const verdict = judgeMinimisedRun({
      runAt,
      minimisedAt: confirmed === true ? minimisedAt : null,
      finishedAt,
      limitMs: LIMIT_MS,
    });
    return {
      ...verdict,
      minimisedAfterMs: minimisedAt === null ? null : minimisedAt - runAt,
      visibility,
      programHundredths: /^[0-9A-F]{8}$/.test(d7) ? parseInt(d7, 16) : null,
    };
  } finally {
    await running.close();
    running = null;
  }
}

test('a program in a task 23 delay of 300 units finishes within 3.5 s while the window is minimised', async () => {
  test.skip(!IS_MAC, NOT_MAC);
  test.setTimeout(ATTEMPTS * 240_000);
  const attempts: Attempt[] = [];
  for (let index = 1; index <= ATTEMPTS; index++) {
    const result = await attempt(index);
    attempts.push(result);
    console.log(
      `run ${index}: ${result.reason}; minimised ${result.minimisedAfterMs} ms after F9; visibility ` +
        `${result.visibility}; the program's own clock: ${result.programHundredths} hundredths`,
    );
    if (result.ok) break;
  }
  const best = attempts.find((result) => result.ok) ?? attempts[attempts.length - 1];
  expect(best?.ok, attempts.map((result) => result.reason).join('; ')).toBe(true);
  // The program's own measurement of the delay: 300 units of 10 ms (4.4.2), within the same limit.
  expect(best?.programHundredths).not.toBeNull();
  expect(best?.programHundredths as number).toBeGreaterThanOrEqual(300);
  expect(best?.programHundredths as number).toBeLessThanOrEqual(LIMIT_MS / 10);
});
