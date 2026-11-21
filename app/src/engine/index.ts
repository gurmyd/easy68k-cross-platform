// The two engines as the application uses them (ARCHITECTURE.md 3.2). The application never imports
// the engine modules (engine/asm, engine/sim) directly; it imports this file, which loads them and
// gives them the types of app/src/contracts/engine.ts.
//
// Test helpers (a recording host, the real engine for unit tests, a fault injector) are in
// ./testing. How the engines are loaded, and where they differ from the contracts, is described in
// docs/ENGINE-BINDING.md.
//
// Owner: W4.

export { createAsmEngine } from './asm';
export { createSimEngine, releaseSimEngine } from './sim';
