// Types of release.mjs for the TypeScript tests (tests/desktop/packaged). Owner: DV3.

export declare function releaseVersion(packageVersion: string, ref: string): string;
export declare function releaseFiles(version: string): string[];
export declare function checksumText(entries: readonly { name: string; sha256: string }[]): string;
export declare function releaseFileProblems(present: readonly string[], version: string): string[];
export declare function verifyProblems(
  present: readonly string[],
  version: string,
  sumsText: string | null,
  hashOf: (name: string) => string,
): string[];
export declare const FIRST_START_BEGIN: string;
export declare const FIRST_START_END: string;
export declare function firstStartSection(markdown: string): string;
export declare function releaseNotes(version: string, firstStart: string, minimumMacOS: string): string;
