import { describe, it, expect } from 'vitest';
import { evalArithmetic } from '../../src/renderer/src/utils/safe-expr';

describe('evalArithmetic — valid arithmetic', () => {
  it('substitutes the value variable', () => {
    expect(evalArithmetic('value', 7)).toBe(7);
    expect(evalArithmetic('value * 2', 5)).toBe(10);
    expect(evalArithmetic('value + 1', 10)).toBe(11);
  });

  it('honors precedence and parentheses', () => {
    expect(evalArithmetic('(value + 1) * 3', 2)).toBe(9);
    expect(evalArithmetic('value + 1 * 3', 2)).toBe(5);
    expect(evalArithmetic('100 / value', 4)).toBe(25);
    expect(evalArithmetic('value % 10', 23)).toBe(3);
  });

  it('handles unary minus, plus, and decimals', () => {
    expect(evalArithmetic('-value', 5)).toBe(-5);
    expect(evalArithmetic('3.5 * 2', 0)).toBe(7);
    expect(evalArithmetic('.5 + .5', 0)).toBe(1);
  });

  it('returns null for division by zero (non-finite)', () => {
    expect(evalArithmetic('1 / 0', 0)).toBeNull();
    expect(evalArithmetic('value / 0', 5)).toBeNull();
  });

  it('returns null for malformed expressions', () => {
    expect(evalArithmetic('', 0)).toBeNull();
    expect(evalArithmetic('()', 0)).toBeNull();
    expect(evalArithmetic('1 +', 0)).toBeNull();
    expect(evalArithmetic('(1 + 2', 0)).toBeNull();
    expect(evalArithmetic('1 2', 0)).toBeNull();
  });
});

describe('evalArithmetic — rejects code injection (RCE guard)', () => {
  // Every one of these previously executed under `new Function`. They MUST
  // all return null now (parser refuses any non-arithmetic token).
  const attacks = [
    'window',
    'globalThis',
    'alert(1)',
    'eval("1")',
    'value.constructor',
    'value.constructor("return process")()',
    'value["constructor"]',
    'this',
    'fetch("http://x")',
    'window.api.settings.set("x", 1)',
    '1;2',
    '1,2',
    '`${value}`',
    'value || alert(1)',
    '[].constructor',
    'Function("return 1")',
  ];
  it.each(attacks)('rejects %s', (expr) => {
    expect(evalArithmetic(expr, 5)).toBeNull();
  });
});
