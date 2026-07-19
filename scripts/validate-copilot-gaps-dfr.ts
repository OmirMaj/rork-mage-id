// scripts/validate-copilot-gaps-dfr.ts — pure-fn validator for dfrGaps.
// Confirms the daily-report interview asks the critical-path progress + the
// clean-day question only when appropriate.
import { dfrGaps } from '../utils/copilot/dailyReport/dfrGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const ground = (data: any): Grounding => ({ facts: [], data });
const CRIT = { criticalTask: { id: 't1', title: 'Concrete Pour', phase: 'Structure', progress: 60 } };

{
  const g = dfrGaps({ issuesMentioned: false }, ground(CRIT)).map((x) => x.field);
  has('critical-task progress asked when in progress', g, 'criticalTaskPct', true);
  has('clean-day asked when no issue mentioned', g, 'cleanDay', true);
}
{
  has('progress not asked once answered', dfrGaps({ criticalTaskPct: 75, issuesMentioned: false }, ground(CRIT)).map((x) => x.field), 'criticalTaskPct', false);
}
{
  has('no critical task → no progress gap', dfrGaps({ issuesMentioned: false }, ground({})).map((x) => x.field), 'criticalTaskPct', false);
}
{
  // Dictation already flagged an issue → don't ask clean-day.
  has('clean-day skipped when issue mentioned', dfrGaps({ issuesMentioned: true }, ground({})).map((x) => x.field), 'cleanDay', false);
}
{
  // Not yet parsed (issuesMentioned null) → don't ask clean-day prematurely.
  has('clean-day not asked before parse', dfrGaps({}, ground({})).map((x) => x.field), 'cleanDay', false);
}
{
  has('clean-day not re-asked once answered', dfrGaps({ cleanDay: true, issuesMentioned: false }, ground({})).map((x) => x.field), 'cleanDay', false);
}
{
  const q = dfrGaps({ issuesMentioned: false }, ground(CRIT)).find((x) => x.field === 'criticalTaskPct');
  ok('progress gap is a choice with real % options', q?.kind === 'choice' && (q?.choices?.length ?? 0) >= 2);
  ok('progress options are numbers', !!q?.choices?.every((c) => typeof c.value === 'number'));
  ok('progress options include Done=100', !!q?.choices?.some((c) => c.value === 100));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
