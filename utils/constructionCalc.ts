// constructionCalc.ts — deterministic arithmetic evaluator for the
// Construction Answers agentic loop.
//
// Implements a recursive-descent parser for expressions containing:
//   binary operators: + - * / ^   (^ is right-associative, highest precedence)
//   unary minus
//   parentheses
//   integer and decimal literals
//   whitespace (ignored)
//
// NEVER uses eval / Function / new Function.
// ZERO imports — pure module.

export type CalcResult =
  | { ok: true; value: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

/** Characters we accept — anything else is an immediate rejection. */
const ALLOWED = /^[0-9.\s+\-*/^()]+$/;

// ---------------------------------------------------------------------------
// Tokeniser
// ---------------------------------------------------------------------------

type Token =
  | { type: 'number'; value: number }
  | { type: 'op'; value: string }     // + - * / ^ ( )
  | { type: 'lparen' }
  | { type: 'rparen' };

function tokenise(expr: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];

    // Skip whitespace
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }

    // Number literal (integer or decimal)
    if (ch >= '0' && ch <= '9') {
      let start = i;
      let hasDot = false;
      while (i < expr.length && (expr[i] >= '0' && expr[i] <= '9' || expr[i] === '.')) {
        if (expr[i] === '.') {
          if (hasDot) return null; // two dots: malformed
          hasDot = true;
        }
        i++;
      }
      // A trailing dot with nothing after it is malformed
      if (hasDot && (i === start + 1 || expr[i - 1] === '.')) return null;
      const num = parseFloat(expr.slice(start, i));
      if (!isFinite(num)) return null;
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Operators and parens
    if ('+-*/^'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') { tokens.push({ type: 'lparen' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: 'rparen' }); i++; continue; }

    // Should never reach here after ALLOWED check, but be safe
    return null;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------
// Grammar (unambiguous, operator precedence encoded in call depth):
//
//   expr     → term (('+' | '-') term)*
//   term     → power (('*' | '/') power)*
//   power    → unary ('^' power)?          ← right-associative via recursion
//   unary    → '-' unary | primary
//   primary  → NUMBER | '(' expr ')'

class Parser {
  private pos = 0;
  private tokens: Token[];
  public error: string | null = null;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(): Token | null {
    if (this.pos >= this.tokens.length) return null;
    return this.tokens[this.pos++];
  }

  private isOp(t: Token | null, ...ops: string[]): t is { type: 'op'; value: string } {
    return t !== null && t.type === 'op' && ops.includes(t.value);
  }

  /** expr → term (('+' | '-') term)* */
  parseExpr(): number | null {
    let left = this.parseTerm();
    if (left === null) return null;

    while (true) {
      const t = this.peek();
      if (!this.isOp(t, '+', '-')) break;
      this.consume();
      const right = this.parseTerm();
      if (right === null) return null;
      left = t.value === '+' ? left + right : left - right;
    }
    return left;
  }

  /** term → power (('*' | '/') power)* */
  private parseTerm(): number | null {
    let left = this.parsePower();
    if (left === null) return null;

    while (true) {
      const t = this.peek();
      if (!this.isOp(t, '*', '/')) break;
      this.consume();
      const right = this.parsePower();
      if (right === null) return null;
      if (t.value === '/') {
        if (right === 0) { this.error = 'division by zero'; return null; }
        left = left / right;
      } else {
        left = left * right;
      }
    }
    return left;
  }

  /** power → unary ('^' power)?  (right-associative) */
  private parsePower(): number | null {
    const base = this.parseUnary();
    if (base === null) return null;

    const t = this.peek();
    if (!this.isOp(t, '^')) return base;
    this.consume();
    const exp = this.parsePower(); // right-recursive for right-associativity
    if (exp === null) return null;
    return Math.pow(base, exp);
  }

  /** unary → '-' unary | primary */
  private parseUnary(): number | null {
    const t = this.peek();
    if (this.isOp(t, '-')) {
      this.consume();
      const operand = this.parseUnary();
      if (operand === null) return null;
      return -operand;
    }
    // Unary + is allowed syntactically (no-op)
    if (this.isOp(t, '+')) {
      this.consume();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  /** primary → NUMBER | '(' expr ')' */
  private parsePrimary(): number | null {
    const t = this.peek();
    if (t === null) {
      this.error = 'unexpected end of expression';
      return null;
    }

    // Parenthesised sub-expression
    if (t.type === 'lparen') {
      this.consume(); // consume '('
      const inner = this.parseExpr();
      if (inner === null) return null;
      const close = this.peek();
      if (close === null || close.type !== 'rparen') {
        this.error = 'unmatched parentheses';
        return null;
      }
      this.consume(); // consume ')'

      // Reject empty parens: () — inner would have failed but guard anyway
      return inner;
    }

    // Number literal
    if (t.type === 'number') {
      this.consume();
      return t.value;
    }

    // Anything else at this position is a syntax error
    this.error = `unexpected token '${(t as { type: string; value?: string }).value ?? t.type}'`;
    return null;
  }

  /** Returns true if there are unconsumed tokens remaining. */
  hasRemainder(): boolean {
    return this.pos < this.tokens.length;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a mathematical expression string.
 *
 * Supported: +  -  *  /  ^  ( )  unary minus  integer and decimal literals.
 * Never uses eval/Function.  Returns {ok:false} for any invalid or non-finite
 * result.  Value is rounded to ~6 significant figures to suppress float noise.
 */
export function evaluateExpression(expr: string): CalcResult {
  // Reject empty / whitespace-only
  if (expr.trim().length === 0) {
    return { ok: false, error: 'empty expression' };
  }

  // Reject characters outside the allowed set
  if (!ALLOWED.test(expr)) {
    return { ok: false, error: 'invalid characters' };
  }

  // Tokenise
  const tokens = tokenise(expr);
  if (tokens === null) {
    return { ok: false, error: 'malformed number literal' };
  }

  // Reject token stream that is empty (e.g. only whitespace after trim — already
  // caught above, but be safe)
  if (tokens.length === 0) {
    return { ok: false, error: 'empty expression' };
  }

  // Parse
  const parser = new Parser(tokens);
  const result = parser.parseExpr();

  // Parser set an error (e.g. division by zero caught mid-parse)
  if (result === null) {
    const msg = parser.error ?? 'malformed expression';
    if (msg === 'division by zero') return { ok: false, error: 'non-finite result' };
    return { ok: false, error: msg };
  }

  // Unconsumed tokens → the expression had trailing junk (e.g. "1 2", "3 )")
  if (parser.hasRemainder()) {
    return { ok: false, error: 'malformed expression' };
  }

  // Non-finite result (Infinity, NaN)
  if (!isFinite(result)) {
    return { ok: false, error: 'non-finite result' };
  }

  // Round to 6 significant figures to suppress floating-point noise
  const rounded = parseFloat(result.toPrecision(6));
  return { ok: true, value: rounded };
}
