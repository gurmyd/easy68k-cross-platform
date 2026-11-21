// Types of packaging.mjs for the TypeScript tests (tests/desktop/packaged). Owner: DV3.

export declare const SHIPPED_FUSES: Readonly<{
  RunAsNode: false;
  EnableNodeCliInspectArguments: false;
  OnlyLoadAppFromAsar: true;
  EnableEmbeddedAsarIntegrityValidation: true;
  EnableNodeOptionsEnvironmentVariable: false;
  GrantFileProtocolExtraPrivileges: false;
}>;
export declare function fuseConfig(
  fuseV1Options: Record<string, number>,
  version: string | number,
): Record<string | number, unknown>;
export declare function builderArchName(arch: number): string;
export declare function machArch(builderArch: string): 'arm64' | 'x86_64';
export declare function parseLipoArchs(stdout: string): string[];
export declare function thinOutputPath(path: string): string;
export declare function parseMacOSVersion(text: string): number[];
export declare function compareMacOSVersions(a: string, b: string): number;
export declare function macOSName(version: string): string;
export declare function isMachO(head: Uint8Array): boolean;
export declare function signsAdHoc(identity: unknown): boolean;
export declare function adHocSigningOrder(files: readonly string[], isCode: (path: string) => boolean): string[];
