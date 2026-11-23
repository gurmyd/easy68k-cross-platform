// Release candidate (ARCHITECTURE.md 6.9, package I3): the CI runs of the release-candidate check
// and the jobs whose logs the judges read. Used by rc.mjs (npm run check:rc) and fetch-ci.mjs.
// docs/integration/rc.md names the same runs; when the check is made again on a later commit,
// replace these ids with that commit's runs.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

export const REPOSITORY = 'gurmyd/easy68k-cross-platform';
export const COMMIT = '9b2f25b';

/**
 * The runs of commit COMMIT. The push run of ci.yml for this commit (45111564124) was cancelled by
 * GitHub when the manual run below was queued in the same concurrency group; the manual run runs
 * every job of a push run as well (and the stability shards, the performance jobs and the readme
 * jobs besides), so it stands for both. pages.yml run 45111564156 (the push) deployed the web
 * version; no judge reads it.
 */
export const RUNS = {
  manual: {
    workflow: 'ci.yml',
    id: 45111581771,
    what: 'by hand: every job of a push run, e2e stability shards, perf thresholds',
  },
  release: { workflow: 'release.yml', id: 45111584448, what: 'by hand, build and test only, no draft release' },
  oracle: { workflow: 'oracle.yml', id: 45111588256, what: 'by hand: the Wine reference' },
};

/** The push run of ci.yml that GitHub cancelled (see RUNS); named, not judged. */
export const CANCELLED_PUSH = { workflow: 'ci.yml', id: 45111564124 };

/** The jobs whose logs the judges read. */
export const JOBS = {
  // ci.yml run 45111581771 (by hand)
  windowsOracles: 137487305824,
  desktopDev: 137487305808,
  e2e: {
    'ubuntu chromium': 137487305843,
    'ubuntu webkit': 137487305869,
    'windows chromium': 137487305915,
    'windows webkit': 137487305868,
    'macos chromium': 137487305785,
    'macos webkit': 137487305874,
  },
  accessibility: { ubuntu: 137487305948, windows: 137487305977, macos: 137487305991 },
  perfUbuntuChromium: 137487305835,
  // Chromium shards 1 and 2 of 2, then WebKit shards 1 to 4 of 4.
  stability: [137487305897, 137487306055, 137487305864, 137487305870, 137487305976, 137487305924],
  // release.yml run 45111584448
  releaseArm64: 137484985034,
  releaseX64: 137484985016,
};

/** Every job id above, in one list. */
export function allJobIds() {
  return [
    JOBS.windowsOracles,
    JOBS.desktopDev,
    ...Object.values(JOBS.e2e),
    ...Object.values(JOBS.accessibility),
    JOBS.releaseArm64,
    JOBS.releaseX64,
    JOBS.perfUbuntuChromium,
    ...JOBS.stability,
  ];
}
