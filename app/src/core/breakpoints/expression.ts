// Break expressions of the Break Points panel: tokens, their text, the button grammar of the
// Expression Builder and the conversion to the engine's postfix form (ARCHITECTURE.md 2.6, note 40;
// sim-ui §12.2; sim-core §7.3). Owner: U3.
//
// An expression is a list of at most MAX_TOKENS tokens, coded as in the original
// (`BREAKPOINTSu.cpp`, `def.h:180-198`):
//
//   0-49     a register condition: the condition slot (row number - 1)
//   50-99    a memory condition: ADDR_OFFSET + row number - 1
//   100      AND      101  OR      102  (      103  )
//
// The engine evaluates the postfix form (`BPointExpr::isBreak`). The conversion below is the
// original's shunting-yard loop (`BREAKPOINTSu.cpp:471-509`) with its quirk kept, because it decides
// where a program stops (note 40): a `)` pops the operators of its group but leaves the `(` on the
// stack, so an operator after a parenthesised group cannot pop the operators before the group.
// `R1 AND (A1 OR A2) OR R2` therefore becomes `R1 A1 A2 OR R2 OR AND`, i.e.
// `R1 AND ((A1 OR A2) OR R2)` (sim-core §7.3).
//
// Everything here is plain data and runs under Node.

/** At most this many tokens per expression (`MAX_LB_NODES`). */
export const MAX_TOKENS = 10;
/** Condition slots 0-49 are register conditions, 50-99 memory conditions (`ADDR_ID_OFFSET`). */
export const ADDR_OFFSET = 50;
/** Number of condition slots (`MAX_BPOINTS`). */
export const CONDITION_SLOTS = 100;
/** Number of expression slots (`MAX_BP_EXPR`). */
export const EXPRESSION_SLOTS = 50;

/** Logical and (`MAX_BPOINTS + AND_OP`). */
export const TOKEN_AND = 100;
/** Logical or (`MAX_BPOINTS + OR_OP`). */
export const TOKEN_OR = 101;
/** Left parenthesis (`LPAREN`); infix form only. */
export const TOKEN_LPAREN = 102;
/** Right parenthesis (`RPAREN`); infix form only. */
export const TOKEN_RPAREN = 103;

/** True for a condition token (0-99). */
export function isOperand(token: number | undefined): boolean {
  return token !== undefined && token >= 0 && token < CONDITION_SLOTS;
}

/** True for AND and OR. */
export function isOperator(token: number | undefined): boolean {
  return token === TOKEN_AND || token === TOKEN_OR;
}

/** The token of register condition `row` (1-based) or memory condition `row` (1-based). */
export function conditionToken(kind: 'reg' | 'mem', row: number): number {
  return (kind === 'reg' ? 0 : ADDR_OFFSET) + row - 1;
}

/**
 * The text a token appends to the Expression column (`BREAKPOINTSu.cpp:533-614, 1153-1182`):
 * `" R1  "`, `" R12 "`, `" A1 "`, `" A12 "`, `" AND "`, `" OR  "`, `"  (  "`, `"  )  "`.
 * (The original's `An` text gets no extra blank below 10 because its test compares the slot index,
 * which is at least 50; the text is kept as the original shows it.)
 */
export function tokenText(token: number): string {
  if (token >= 0 && token < ADDR_OFFSET) {
    const n = token + 1;
    return ` R${n}${n < 10 ? ' ' : ''} `;
  }
  if (token >= ADDR_OFFSET && token < CONDITION_SLOTS) return ` A${token - ADDR_OFFSET + 1} `;
  switch (token) {
    case TOKEN_AND:
      return ' AND ';
    case TOKEN_OR:
      return ' OR  ';
    case TOKEN_LPAREN:
      return '  (  ';
    case TOKEN_RPAREN:
      return '  )  ';
    default:
      throw new RangeError(`tokenText: ${token} is not a token`);
  }
}

/**
 * The Expression column's text for a token list. The port always derives the text from the tokens,
 * so Backspace removes exactly the last token's text (note 40 fixes the original's five-character
 * Backspace, which ate a character of the previous token after an `An` token).
 */
export function expressionText(tokens: readonly number[]): string {
  return tokens.map(tokenText).join('');
}

/** Open parentheses at the end of `tokens`. */
export function parenDepth(tokens: readonly number[]): number {
  let depth = 0;
  for (const token of tokens) {
    if (token === TOKEN_LPAREN) depth++;
    else if (token === TOKEN_RPAREN) depth--;
  }
  return depth;
}

/** Which buttons of the Expression Builder row are enabled (`setExprButtons`, `BREAKPOINTSu.cpp:233-296`). */
export interface BuilderButtons {
  /** `PC/Reg` and `Memory`: append a condition. */
  operand: boolean;
  /** `AND` and `OR`. */
  operator: boolean;
  lparen: boolean;
  rparen: boolean;
  backspace: boolean;
}

/**
 * The button grammar of sim-ui §12.2, from the tokens of the expression being edited. With no
 * expression being edited every button is disabled.
 *
 * - an operand: at the start, after an operator or after `(`;
 * - `AND` / `OR`: after an operand or `)`;
 * - `(`: at the start, after an operator or after `(`;
 * - `)`: while a `(` is open and the last token is not an operator or `(`;
 * - `Backspace`: whenever there is at least one token;
 * - at MAX_TOKENS tokens only `Backspace` remains.
 *
 * The original derives this from flags (`mruOperand`, `mruOperator`) that a refused `PC/Reg` or
 * `Memory` append sets although nothing was appended (sim-ui Q21); the port derives it from the
 * tokens, so a refused append changes nothing (an editor defect fixed under note 40).
 */
export function builderButtons(tokens: readonly number[] | null): BuilderButtons {
  if (tokens === null) return { operand: false, operator: false, lparen: false, rparen: false, backspace: false };
  const count = tokens.length;
  if (count >= MAX_TOKENS) return { operand: false, operator: false, lparen: false, rparen: false, backspace: true };
  const last = tokens[count - 1];
  const start = count === 0;
  const afterOperand = isOperand(last) || last === TOKEN_RPAREN;
  return {
    operand: start || isOperator(last) || last === TOKEN_LPAREN,
    operator: !start && afterOperand,
    lparen: start || isOperator(last) || last === TOKEN_LPAREN,
    rparen: parenDepth(tokens) > 0 && !isOperator(last) && last !== TOKEN_LPAREN && !start,
    backspace: count > 0,
  };
}

/**
 * Whether `Set` is enabled for an expression being edited: every parenthesis closed and the last
 * token an operand or `)` (`BREAKPOINTSu.cpp:213-217`).
 */
export function expressionComplete(tokens: readonly number[]): boolean {
  const last = tokens[tokens.length - 1];
  return parenDepth(tokens) === 0 && (isOperand(last) || last === TOKEN_RPAREN);
}

/** `precedence()` of the original: the negated token value, so AND binds tighter than OR. */
function precedence(token: number): number {
  return -token;
}

/**
 * The postfix form the engine evaluates, converted exactly as `ExprSetButtonClick` does
 * (`BREAKPOINTSu.cpp:471-509`), quirk included (see the top of this file). The tokens must form a
 * complete expression (`expressionComplete`).
 */
export function infixToPostfix(tokens: readonly number[]): number[] {
  const postfix: number[] = [];
  const stack: number[] = [];
  const top = () => stack[stack.length - 1];
  for (const token of tokens) {
    switch (token) {
      case TOKEN_AND:
      case TOKEN_OR:
        while (stack.length > 0 && top() !== TOKEN_LPAREN && precedence(token) <= precedence(top() as number)) {
          postfix.push(stack.pop() as number);
        }
        stack.push(token);
        break;
      case TOKEN_LPAREN:
        stack.push(token);
        break;
      case TOKEN_RPAREN:
        // The `(` stays on the stack (the original's quirk).
        while (stack.length > 0 && top() !== TOKEN_LPAREN) postfix.push(stack.pop() as number);
        break;
      default:
        postfix.push(token);
        break;
    }
  }
  while (stack.length > 0) {
    const token = stack.pop() as number;
    if (token !== TOKEN_LPAREN) postfix.push(token);
  }
  return postfix;
}

/**
 * The tokens after condition slot `removed` was deleted and the conditions after it in its table
 * moved up one row; null when the expression refers to the deleted condition (note 40: such an
 * expression is removed, after a confirmation).
 */
export function renumberTokens(tokens: readonly number[], removed: number): number[] | null {
  if (tokens.includes(removed)) return null;
  const tableEnd = removed < ADDR_OFFSET ? ADDR_OFFSET : CONDITION_SLOTS;
  return tokens.map((token) => (token > removed && token < tableEnd ? token - 1 : token));
}

/** True when the expression refers to a condition of the given table. */
export function usesTable(tokens: readonly number[], table: 'reg' | 'mem'): boolean {
  return tokens.some((token) =>
    table === 'reg' ? token >= 0 && token < ADDR_OFFSET : token >= ADDR_OFFSET && token < CONDITION_SLOTS,
  );
}
