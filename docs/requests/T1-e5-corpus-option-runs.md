# Request T1 to E5: the corpus test of Assemble and the new option runs of the manifest

Status: done (2026-11-22): the change below was applied to `app/src/features/assemble/corpus.test.ts`
by the orchestrator, with one difference: the official set must now have at least 68 runs (not "at
least 20"), since that is what the manifest holds. The test passes: 3 passed, 1 skipped.

## Why

For 6.9 item 1, T1 added to `tests/corpus/manifest.json` the runs of a fixed subset of 30 programs
with each of the eight assembler options switched alone (`tests/corpus/option-subset.json`,
erratum T1 20) and a default run for 14 checklist programs (erratum T1 21). The official set now
has 68 runs, not 20, and three runs have *Generate Listing* off in a program with an undefined
symbol: their S-records can only be compared after masking the statements named by the listing
of the same options with the listing on (`maskingListing` of `Outputs` in
`tests/conformance/asm/compare.ts`).

`app/src/features/assemble/corpus.test.ts` (E5) therefore fails today with three findings:
`expected 68 to be 20`, and `.S68` differences in `github/pacman-mc68000/GAME/SYSTEM.X68
(nolist)`, `checklist/line-13-... (nolist)` and `checklist/stc-04-... (nolist)`, only in the
bytes the original took from uninitialised memory (`004DBD16` against `00000000`).

## What

The change below. A copy of the test with it applied (imports made absolute, in `build/T1/e5`)
passed against the new manifest on 2026-11-22: `Test Files 1 passed`, `Tests 3 passed | 1
skipped` (the skipped one is the engine/dist guard).

```diff
@@ -31,6 +31,7 @@
 import { MemoryBackend } from '../../fs/memory-backend';
 import { createTestApplication } from '../../state/testing';
 import { canonicalHashes, compareOutputs, createdOn, describeVerdict } from '../../../../tests/conformance/asm/compare';
+import { listingOnLabel } from '../../../../tests/oracle/wine/asm/settings';
 import {
   REPO,
   goldenDirectory,
@@ -158,11 +159,17 @@
   const readBack = async (path: string) => ((await ctx.vfs.stat(path)) ? ctx.vfs.readFile(path) : null);
   const ours = { listing: await readBack(outputs.listing), sRecord: await readBack(outputs.sRecord) };
 
+  // A run without a listing (Generate Listing off) masks by the official listing of the same options
+  // with the listing on (T1 erratum 20).
+  const companion = listingOnLabel(run.options);
+  const companionRun = companion === null ? undefined : program.runs[companion];
+  const maskingListing =
+    ours.listing === null && companion !== null && companionRun?.golden ? readGolden(program, companion, companionRun, 'L68') : null;
   if (run.golden) {
     if ((run.l68 !== null && goldenListing === null) || (run.s68 !== null && goldenSRecord === null)) {
       return 'golden files missing';
     }
-    const verdict = compareOutputs({ listing: goldenListing, sRecord: goldenSRecord }, ours);
+    const verdict = compareOutputs({ listing: goldenListing, sRecord: goldenSRecord, maskingListing }, ours);
     if (!verdict.equal) return describeVerdict(verdict);
     const same = (a: Uint8Array | null, b: Uint8Array | null) =>
       a === null || b === null ? a === b : Buffer.compare(a, b) === 0;
@@ -172,7 +179,7 @@
     else tally.masked++;
     return null;
   }
-  const hashes = canonicalHashes(ours);
+  const hashes = canonicalHashes({ ...ours, maskingListing });
   if (hashes.l68 !== run.l68 || hashes.s68 !== run.s68) return 'the canonical hashes differ from the manifest';
   if (hashes.undefinedSymbols) tally.masked++;
   else tally.identical++;
@@ -218,7 +225,7 @@
         }
       }
       expect(failures).toEqual([]);
-      if (set === 'official') expect(runs).toBe(20);
+      if (set === 'official') expect(runs).toBeGreaterThanOrEqual(20);
       if (set === 'github-mit') expect(runs).toBeGreaterThanOrEqual(82);
     }, 600_000);
   }
```
