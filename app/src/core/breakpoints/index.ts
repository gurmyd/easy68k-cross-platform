// Advanced breakpoints: the model of the Break Points panel and its conversion into the engine's
// breakpoint slots (ARCHITECTURE.md 2.6, note 40; sim-ui §12.2; sim-core §7). Owner: U3.
//
//   expression.ts   tokens, their text, the builder's button grammar, infix to postfix
//   tables.ts       the three grids and every user action on them (pure functions)
//   slots.ts        the engine's slots for the grids, and the calls that change them
//
// No DOM, no engine: the feature features/breakpoints draws the panel, shows the messages and
// sends the slots through the run controller.

export * from './expression';
export * from './slots';
export * from './tables';
