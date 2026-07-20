// scripts/validate-copilot-ask-decision.ts — pure-fn validator for utils/copilot/askDecision.ts.
// The "ask only when it matters" discipline: never ask a gap below threshold;
// ask the single highest-impact remaining gap; stop at the question cap.
import { decideAsk } from '../utils/copilot/askDecision';
import type { Gap } from '../utils/copilot/types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const g = (field: string, impact: number): Gap => ({ field, impact, question: field + '?', groundedDefault: { value: 1, basis: 'b' }, kind: 'number' });

eq('no gaps → ready', decideAsk([], { asked: [], count: 0, cap: 4, threshold: 0.35 }).kind, 'ready');
eq('all below threshold → ready', decideAsk([g('a', 0.2), g('b', 0.1)], { asked: [], count: 0, cap: 4, threshold: 0.35 }).kind, 'ready');
{
  const d = decideAsk([g('a', 0.4), g('b', 0.9), g('c', 0.5)], { asked: [], count: 0, cap: 4, threshold: 0.35 });
  eq('asks highest-impact', d.kind === 'ask' ? d.gap.field : d.kind, 'b');
}
{
  const d = decideAsk([g('b', 0.9), g('c', 0.5)], { asked: ['b'], count: 1, cap: 4, threshold: 0.35 });
  eq('skips already-asked', d.kind === 'ask' ? d.gap.field : d.kind, 'c');
}
eq('cap reached → capped', decideAsk([g('a', 0.9)], { asked: ['x','y','z','w'], count: 4, cap: 4, threshold: 0.35 }).kind, 'capped');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
