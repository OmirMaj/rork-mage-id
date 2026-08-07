// validate-construction-calc.ts — pins the deterministic arithmetic evaluator
// used by the Construction Answers agentic loop.
//
// The evaluator must produce exact, auditable results for span/load/quantity
// math — no model guessing. These tests lock that contract.
//
// Run: bun run scripts/validate-construction-calc.ts

import { evaluateExpression } from '@/utils/constructionCalc';

let pass = 0, fail = 0;

function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, `\n      got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
}

// ---------------------------------------------------------------------------
// Passing cases — correct arithmetic values
// ---------------------------------------------------------------------------

console.log('\nconstruction calc — passing expressions:');

{
  const r = evaluateExpression('2+3*4');
  ok('"2+3*4" is ok', r.ok === true);
  if (r.ok) eq('"2+3*4" → 14 (operator precedence)', r.value, 14);
}
{
  const r = evaluateExpression('(1240/16)');
  ok('"(1240/16)" is ok', r.ok === true);
  if (r.ok) eq('"(1240/16)" → 77.5', r.value, 77.5);
}
{
  const r = evaluateExpression('8*50*12');
  ok('"8*50*12" is ok', r.ok === true);
  if (r.ok) eq('"8*50*12" → 4800', r.value, 4800);
}
{
  const r = evaluateExpression('2^3');
  ok('"2^3" is ok', r.ok === true);
  if (r.ok) eq('"2^3" → 8', r.value, 8);
}
{
  const r = evaluateExpression('-3+5');
  ok('"-3+5" is ok', r.ok === true);
  if (r.ok) eq('"-3+5" → 2 (unary minus)', r.value, 2);
}
{
  const r = evaluateExpression('2 * (3 + 4)');
  ok('"2 * (3 + 4)" is ok', r.ok === true);
  if (r.ok) eq('"2 * (3 + 4)" → 14 (parentheses)', r.value, 14);
}
{
  const r = evaluateExpression('10/4');
  ok('"10/4" is ok', r.ok === true);
  if (r.ok) eq('"10/4" → 2.5', r.value, 2.5);
}

// Extra passing cases: right-associative power, decimals, nested parens
{
  const r = evaluateExpression('2^2^3');  // 2^(2^3) = 2^8 = 256
  ok('"2^2^3" is ok (right-assoc ^)', r.ok === true);
  if (r.ok) eq('"2^2^3" → 256', r.value, 256);
}
{
  const r = evaluateExpression('3.14 * 2');
  ok('"3.14 * 2" is ok', r.ok === true);
  if (r.ok) ok('"3.14 * 2" ≈ 6.28', Math.abs((r.value) - 6.28) < 0.0001, String(r.value));
}
{
  const r = evaluateExpression('((4+6)*2)');
  ok('"((4+6)*2)" is ok (nested parens)', r.ok === true);
  if (r.ok) eq('"((4+6)*2)" → 20', r.value, 20);
}
{
  const r = evaluateExpression('100 - 37.5');
  ok('"100 - 37.5" is ok', r.ok === true);
  if (r.ok) eq('"100 - 37.5" → 62.5', r.value, 62.5);
}

// ---------------------------------------------------------------------------
// Rejection cases — must return ok:false
// ---------------------------------------------------------------------------

console.log('\nconstruction calc — invalid expressions (must reject):');

{
  const r = evaluateExpression('1+');
  ok('"1+" is rejected (trailing operator)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('');
  ok('"" is rejected (empty)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('   ');
  ok('"   " is rejected (whitespace-only)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('drop table x');
  ok('"drop table x" is rejected (letters)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('1/0');
  ok('"1/0" is rejected (division by zero → non-finite)', r.ok === false, JSON.stringify(r));
  if (!r.ok) ok('"1/0" error is non-finite-result', r.error === 'non-finite result', r.error);
}
{
  const r = evaluateExpression('()');
  ok('"()" is rejected (empty parens)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('2^');
  ok('"2^" is rejected (trailing ^)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('(1+2');
  ok('"(1+2" is rejected (unbalanced paren)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('1 2');
  ok('"1 2" is rejected (two numbers, no operator)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('* 3');
  ok('"* 3" is rejected (leading operator)', r.ok === false, JSON.stringify(r));
}
{
  const r = evaluateExpression('1 + 2)');
  ok('"1 + 2)" is rejected (unmatched close paren)', r.ok === false, JSON.stringify(r));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
