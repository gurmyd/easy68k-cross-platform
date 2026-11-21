// What the bootstrap hands to the features that provide services (ARCHITECTURE.md 3.12.3).
// Owner: W3.
//
// The declarations moved to app/src/contracts/features.ts at the wave-0 gate
// (docs/requests/W3-layer-rule.md, item 2): `SimEngineFactory`, `SimSessionEnv` and
// `ServiceFactories` are explained there. This file re-exports them so that existing imports keep
// working; new code imports them from the contracts.

export type { ServiceFactories, SimEngineFactory, SimSessionEnv } from '../contracts';
