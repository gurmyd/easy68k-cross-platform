// Types of starts-rule.mjs, for starts-rule.test.ts. Owner: N1.

export type Walk = string[];
export interface Step {
  from: string;
  to: string;
}
export interface PlainWalks {
  forward: Walk;
  backward: Walk;
}

export declare const PLAIN_INPUT_TYPES: string[];
export declare function isPlainControl(element: { tag: string; type: string; tabindex: boolean }): boolean;
export declare function skippedStops(recordedWalks: Walk[], observedWalks: Walk[]): string[];
export declare function withoutStops(walks: Walk[], skipped: string[]): Walk[];
export declare function plainOrder(forwardWalk: Walk, backwardWalk: Walk): Walk;
export declare function expectedWalk(recorded: Walk, skipped: string[], order: Walk): Walk | null;
export declare function expectedStep(recorded: Step, skipped: string[], order: Walk): Step | null;
export declare function mainHere(
  kind: 'walks' | 'walk' | 'step',
  recorded: Walk[] | Walk | Step | undefined,
  skipped: string[],
  plain: PlainWalks,
  backward: boolean,
): Walk[] | Walk | Step | null | undefined;
