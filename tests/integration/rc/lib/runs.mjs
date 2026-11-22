// Release candidate (ARCHITECTURE.md 6.9, package I3): the CI runs of the release-candidate check
// and the jobs whose logs the judges read. Used by rc.mjs (npm run check:rc) and fetch-ci.mjs.
// docs/integration/rc.md names the same runs; when the check is made again on a later commit,
// replace these ids with that commit's runs.
//
// Part of easy68k-cross-platform, an unofficial port of EASy68K. GPL-2.0-or-later.

export const REPOSITORY = 'gurmyd/easy68k-cross-platform';
export const COMMIT = 'b247e17';

/** The runs of commit COMMIT. */
export const RUNS = {
  push: { workflow: 'ci.yml', id: 45034018006, what: 'the push of b247e17' },
  manual: { workflow: 'ci.yml', id: 45034021673, what: 'by hand: e2e stability shards, perf thresholds' },
  release: { workflow: 'release.yml', id: 45034019734, what: 'by hand, no draft release' },
  oracle: { workflow: 'oracle.yml', id: 45034017858, what: 'by hand: the Wine reference' },
};

/** The jobs whose logs the judges read. */
export const JOBS = {
  // ci.yml run 45034018006 (push)
  windowsOracles: 137243681219,
  desktopDev: 137243681239,
  e2e: {
    'ubuntu chromium': 137243681278,
    'ubuntu webkit': 137243681322,
    'windows chromium': 137243681315,
    'windows webkit': 137243681280,
    'macos chromium': 137243681307,
    'macos webkit': 137243681348,
  },
  accessibility: { ubuntu: 137243681427, windows: 137243681494, macos: 137243681484 },
  // release.yml run 45034019734
  releaseArm64: 137243690788,
  releaseX64: 137243690842,
  // ci.yml run 45034021673 (by hand)
  perfUbuntuChromium: 137252708197,
  stability: [137252708204, 137252708203, 137252708212, 137252708164, 137252708168, 137252708162],
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
