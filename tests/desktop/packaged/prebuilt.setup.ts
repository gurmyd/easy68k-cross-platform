// Project "prebuilt" of the packaged-app suite: makes the .S68 and .L68 files the checks open, with
// the real assembler engine, before any check runs (prebuilt.ts). Runs on any system.
//
// Owner: DV3.

import { expect, test } from '@playwright/test';
import { enginesAvailable, makePrebuilt, PREBUILT_DIR } from './prebuilt';

test('assemble the prebuilt programs with the real assembler', async () => {
  test.setTimeout(120_000);
  if (!enginesAvailable()) {
    throw new Error('engine/dist is missing: the packaged checks open programs made by the real assembler');
  }
  const manifest = await makePrebuilt();
  console.log(`prebuilt programs in ${PREBUILT_DIR}: ${JSON.stringify(manifest)}`);
  expect(manifest.tutorial1.start).toBe(0x1000);
  expect(manifest.delay300.start).toBe(0x1000);
});
