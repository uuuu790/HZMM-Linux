// Safe arithmetic evaluator for schema-description {eval:} tokens.
//
// SECURITY: schema files (hzmm.config.json) ship INSIDE untrusted mod folders,
// so their `description` strings are attacker-controlled. The previous
// implementation ran them through the JS Function constructor — a remote code
// execution hole, because the renderer CSP allows 'unsafe-eval' and the eval'd
// code had full `window.api` access. This evaluator instead parses a tiny
// math-only grammar by hand and never touches any JS scope, so a malicious
// expression can at worst yield a number or fail — it can never run code.
//
// Grammar (all {eval:} ever needs is to compute a display number from the
// current field value, e.g. "{eval: value * 60} per minute"):
//   expr   = term   (('+' | '-') term)*
//   term   = factor (('*' | '/' | '%') factor)*
//   factor = NUMBER | 'value' | '(' expr ')' | ('+' | '-') factor
//
// Returns a finite number, or null if the expression is malformed/unsupported.
export function evalArithmetic(expr, value) {
  const tokens = expr.match(/\d+\.?\d*|\.\d+|value|[+\-*/%()]/g);
  // Reject if anything other than recognized tokens + whitespace is present —
  // this is what blocks identifiers (window, eval, constructor), strings,
  // brackets, semicolons, etc. from ever reaching the parser.
  if (!tokens || tokens.join('') !== expr.replace(/\s+/g, '')) return null;

  let pos = 0;
  const peek = () => tokens[pos];

  function parseExpr() {
    let v = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[pos++];
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = tokens[pos++];
      const r = parseFactor();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function parseFactor() {
    const t = peek();
    if (t === '+') { pos++; return parseFactor(); }
    if (t === '-') { pos++; return -parseFactor(); }
    if (t === '(') {
      pos++;
      const v = parseExpr();
      if (tokens[pos++] !== ')') throw new Error('unbalanced parentheses');
      return v;
    }
    if (t === 'value') { pos++; return value; }
    const n = parseFloat(t);
    if (Number.isNaN(n)) throw new Error('unexpected token');
    pos++;
    return n;
  }

  try {
    const result = parseExpr();
    if (pos !== tokens.length) return null; // trailing tokens → malformed
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}
