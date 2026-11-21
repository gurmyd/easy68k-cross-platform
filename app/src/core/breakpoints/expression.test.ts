import { describe, expect, it } from 'vitest';
import {
  TOKEN_AND as AND,
  TOKEN_LPAREN as L,
  TOKEN_OR as OR,
  TOKEN_RPAREN as R,
  builderButtons,
  conditionToken,
  expressionComplete,
  expressionText,
  infixToPostfix,
  renumberTokens,
  tokenText,
} from './expression';

const r = (n: number) => conditionToken('reg', n);
const a = (n: number) => conditionToken('mem', n);

describe('tokens and their text (sim-ui §12.2)', () => {
  it('codes conditions as the original: register row n is slot n-1, memory row n is slot 50+n-1', () => {
    expect([r(1), r(49), a(1), a(49)]).toEqual([0, 48, 50, 98]);
    expect([AND, OR, L, R]).toEqual([100, 101, 102, 103]);
  });

  it('appends the texts of the original', () => {
    expect(tokenText(r(1))).toBe(' R1  ');
    expect(tokenText(r(12))).toBe(' R12 ');
    expect(tokenText(a(1))).toBe(' A1 ');
    expect(tokenText(a(12))).toBe(' A12 ');
    expect(tokenText(AND)).toBe(' AND ');
    expect(tokenText(OR)).toBe(' OR  ');
    expect(tokenText(L)).toBe('  (  ');
    expect(tokenText(R)).toBe('  )  ');
    expect(() => tokenText(104)).toThrow(RangeError);
  });

  it('derives the expression text from the tokens, so Backspace removes exactly one token (note 40)', () => {
    const tokens = [r(1), AND, L, a(1), OR, a(2), R];
    expect(expressionText(tokens)).toBe(' R1   AND   (   A1  OR   A2   )  ');
    // The original removed five characters after " A1 " (four), eating the blank of " AND ".
    expect(expressionText([r(1), AND, a(1)].slice(0, -1))).toBe(' R1   AND ');
  });
});

describe('the button grammar of the Expression Builder (setExprButtons)', () => {
  const on = (tokens: number[] | null) => {
    const b = builderButtons(tokens);
    return Object.entries(b)
      .filter(([, enabled]) => enabled)
      .map(([name]) => name)
      .sort();
  };

  it('disables every button while no expression is being edited', () => {
    expect(on(null)).toEqual([]);
  });

  it('at the start: an operand or ( only', () => {
    expect(on([])).toEqual(['lparen', 'operand']);
  });

  it('after an operand: AND / OR and Backspace; ) only while a ( is open', () => {
    expect(on([r(1)])).toEqual(['backspace', 'operator']);
    expect(on([L, r(1)])).toEqual(['backspace', 'operator', 'rparen']);
  });

  it('after an operator: an operand or (, never ) or another operator', () => {
    expect(on([r(1), AND])).toEqual(['backspace', 'lparen', 'operand']);
    expect(on([L, r(1), OR])).toEqual(['backspace', 'lparen', 'operand']);
  });

  it('after (: an operand or another (; ) is not allowed right after (', () => {
    expect(on([L])).toEqual(['backspace', 'lparen', 'operand']);
    expect(on([L, L])).toEqual(['backspace', 'lparen', 'operand']);
  });

  it('after ): AND / OR, and ) while another ( is open', () => {
    expect(on([L, r(1), R])).toEqual(['backspace', 'operator']);
    expect(on([L, L, r(1), R])).toEqual(['backspace', 'operator', 'rparen']);
  });

  it('at 10 tokens only Backspace remains', () => {
    const ten = [L, L, L, r(1), AND, r(2), OR, r(3), AND, r(4)];
    expect(ten).toHaveLength(10);
    expect(on(ten)).toEqual(['backspace']);
    expect(on(ten.slice(0, 9))).toEqual(['backspace', 'lparen', 'operand']);
  });

  it('Set needs every parenthesis closed and an operand or ) at the end', () => {
    expect(expressionComplete([])).toBe(false);
    expect(expressionComplete([r(1)])).toBe(true);
    expect(expressionComplete([r(1), AND])).toBe(false);
    expect(expressionComplete([L, r(1)])).toBe(false);
    expect(expressionComplete([L, r(1), R])).toBe(true);
    expect(expressionComplete([r(1), AND, L, a(1), OR, a(2), R])).toBe(true);
  });
});

describe('infix to postfix, as ExprSetButtonClick converts (sim-core §7.3)', () => {
  it('the example of sim-core §7.3: R1 AND (A1 OR A2) OR R2 becomes R1 A1 A2 OR R2 OR AND', () => {
    expect(infixToPostfix([r(1), AND, L, a(1), OR, a(2), R, OR, r(2)])).toEqual([r(1), a(1), a(2), OR, r(2), OR, AND]);
    expect(infixToPostfix([r(1), AND, L, a(1), OR, a(2), R, OR, r(2)])).toEqual([0, 50, 51, 101, 1, 101, 100]);
  });

  it('the example of sim-ui §12.2: R1 AND ( R2 OR R3 ) OR R4 is R1 AND ((R2 OR R3) OR R4)', () => {
    expect(infixToPostfix([r(1), AND, L, r(2), OR, r(3), R, OR, r(4)])).toEqual([r(1), r(2), r(3), OR, r(4), OR, AND]);
  });

  it('AND binds tighter than OR; equal operators group from the left', () => {
    expect(infixToPostfix([r(1), OR, r(2), AND, r(3)])).toEqual([r(1), r(2), r(3), AND, OR]);
    expect(infixToPostfix([r(1), AND, r(2), OR, r(3)])).toEqual([r(1), r(2), AND, r(3), OR]);
    expect(infixToPostfix([r(1), AND, r(2), AND, r(3)])).toEqual([r(1), r(2), AND, r(3), AND]);
    expect(infixToPostfix([r(1), OR, r(2), OR, r(3)])).toEqual([r(1), r(2), OR, r(3), OR]);
  });

  it('groups that come first or last evaluate normally', () => {
    expect(infixToPostfix([L, r(1), OR, r(2), R, AND, r(3)])).toEqual([r(1), r(2), OR, r(3), AND]);
    expect(infixToPostfix([r(1), AND, L, r(2), OR, r(3), R])).toEqual([r(1), r(2), r(3), OR, AND]);
    expect(infixToPostfix([r(1)])).toEqual([r(1)]);
    expect(infixToPostfix([L, L, a(3), R, R])).toEqual([a(3)]);
  });
});

describe('renumbering after a condition is deleted (note 40)', () => {
  it('moves later conditions of the same table up and leaves the other table alone', () => {
    expect(renumberTokens([r(1), AND, r(3), OR, a(3)], r(2))).toEqual([r(1), AND, r(2), OR, a(3)]);
    expect(renumberTokens([r(3), AND, a(1), OR, a(3)], a(2))).toEqual([r(3), AND, a(1), OR, a(2)]);
  });

  it('reports an expression that uses the deleted condition', () => {
    expect(renumberTokens([r(1), AND, r(2)], r(2))).toBeNull();
    expect(renumberTokens([a(1)], a(1))).toBeNull();
  });
});
