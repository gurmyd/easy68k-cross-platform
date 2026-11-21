// The texts of the two About boxes, and the update check. Owner: H1.
// ARCHITECTURE.md 1.4 note 11, 9.2 (H1); editor-ui §15.4; sim-ui §16.2.
//
// The original's texts are kept letter for letter, spelling mistakes ("liabilty", "implemenation")
// and double blanks included. The port adds its name, version, repository link and the statement that
// it is unofficial. The B-M-W Easter egg is dropped (note 11).

export interface AboutText {
  /** Title bar of the dialog. */
  windowTitle: string;
  /** The bold title line, as `TITLE` sets it. */
  title: string;
  /** The paragraphs of the original, top to bottom, with the link line marked `link`. */
  lines: readonly AboutLine[];
}

export type AboutLine = { kind: 'text'; text: string } | { kind: 'link'; text: string; url: string };

/** The address of the EASy68K web site (the green link of the original). */
export const EASY68K_URL = 'http://www.easy68k.com';

export const EDITOR_ABOUT: AboutText = {
  windowTitle: 'About EASy68K',
  title: 'EASy68K Editor/Assembler v5.16.01',
  lines: [
    {
      kind: 'text',
      text: 'The author of this software assumes no liabilty of its functionality and is not responsible for misuse by the user.  Use at your own risk.  This application is distributed under the GNU general public use license.',
    },
    { kind: 'text', text: 'GUI design: Tim Larson' },
    { kind: 'text', text: 'Original assembler code: Paul McKee' },
    { kind: 'text', text: 'Modifications and New Features: Charles Kelly' },
    { kind: 'link', text: 'www.easy68k.com', url: EASY68K_URL },
    { kind: 'text', text: 'Post comments and bug reports to the EASy68K forum.' },
  ],
};

export const SIMULATOR_ABOUT: AboutText = {
  windowTitle: 'About EASy68K Simulator',
  title: 'EASy68K Simulator v5.16.1',
  lines: [
    { kind: 'text', text: 'GUI implemenation: Charles Kelly' },
    { kind: 'text', text: 'Original simulator code: Paul McKee' },
    { kind: 'text', text: 'Simulator code modification: Charles Kelly, Eric Nelson' },
    { kind: 'link', text: 'www.easy68k.com', url: EASY68K_URL },
    { kind: 'text', text: 'Use the EASy68K forum to submit bug reports.' },
    {
      kind: 'text',
      text: 'EASy68K is distributed under the GNU general public use license. See Help for more information.',
    },
    {
      kind: 'text',
      text: 'The author of this software assumes no liability for its functionality and is not responsible for damages, losses or liabilities as a result of using this software.  Use at your own risk.',
    },
  ],
};

/** The caption above the Check button of the editor's box. */
export const CHECK_LABEL = 'Check for update?';
export const CHECK_BUTTON = 'Check';
/** The three answers of the update check (aboutS.cpp:85-116). */
export const CHECK_UP_TO_DATE = 'Up to date';
export const CHECK_UPDATE_AVAILABLE = 'Update available';
export const CHECK_NETWORK_ERROR = 'Network error';

/** The port's own notice, added to both boxes. */
export const PORT_NAME = 'EASy68K';
export const PORT_SUBTITLE = 'unofficial web and macOS port';
export const PORT_STATEMENT =
  'This is an unofficial port of EASy68K v5.16.1 to the web and to macOS. It is not made or supported by the authors of the original.';

/**
 * The repository when the build does not say (ARCHITECTURE.md 10.2, O-14 wants it read from the
 * Git remote at build time; the About box has no access to that yet, docs/requests/H1-build-info.md).
 */
export const DEFAULT_REPOSITORY = 'gurmyd/easy68k-mac';

export function repositoryUrl(repository: string = DEFAULT_REPOSITORY): string {
  return `https://github.com/${repository}`;
}

/** The address the update check asks: the port's latest release. */
export function latestReleaseUrl(repository: string = DEFAULT_REPOSITORY): string {
  return `https://api.github.com/repos/${repository}/releases/latest`;
}

/**
 * The port's version from the window title, which the shell builds as "<title> - unofficial port
 * <version>" (bootstrap.ts windowTitle); 'unknown' when the title does not say.
 */
export function portVersionFromTitle(title: string): string {
  return /unofficial port (\S+)\s*$/.exec(title)?.[1] ?? 'unknown';
}

/** A release tag ("v0.3.1", "0.3.1") as its numbers; null when it is not a version. */
export function parseVersion(tag: string): number[] | null {
  const match = /^v?(\d+(?:\.\d+)*)/.exec(tag.trim());
  return match?.[1] ? match[1].split('.').map(Number) : null;
}

/**
 * The answer to the Check button: "Up to date" when the latest release is not newer than the
 * installed version, "Update available" when it is, null when either is not a version.
 */
export function updateAnswer(installed: string, latestTag: string): string | null {
  const have = parseVersion(installed);
  const latest = parseVersion(latestTag);
  if (have === null || latest === null) return null;
  const length = Math.max(have.length, latest.length);
  for (let i = 0; i < length; i++) {
    const a = have[i] ?? 0;
    const b = latest[i] ?? 0;
    if (b !== a) return b > a ? CHECK_UPDATE_AVAILABLE : CHECK_UP_TO_DATE;
  }
  return CHECK_UP_TO_DATE;
}
