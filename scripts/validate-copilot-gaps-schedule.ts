// scripts/validate-copilot-gaps-schedule.ts — pure-fn validator for scheduleGaps.
// Grounding suppresses questions the data resolves; leaves the genuinely-open ones.
import { scheduleGaps, type ScheduleDraft } from '../utils/copilot/schedule/scheduleGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, gapFields: string[], field: string, want: boolean) {
  const ok = gapFields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${gapFields.join(',')})`); }
}
const ground = (data: any): Grounding => ({ facts: [], data });

{
  const gaps = scheduleGaps({ startDate: null }, ground({}));
  has('unset start date is asked', gaps.map(g => g.field), 'startDate', true);
}
{
  const gaps = scheduleGaps({ startDate: '2026-03-21' }, ground({}));
  has('stated start date not asked', gaps.map(g => g.field), 'startDate', false);
}
{
  const gaps = scheduleGaps({ startDate: '2026-03-21' }, ground({ heavyCategories: [{ name: 'Cabinets', total: 28000, hasLeadSignal: false }] }));
  has('unresolved long-lead is asked', gaps.map(g => g.field), 'longLeadMilestones', true);
}
{
  const gaps = scheduleGaps({ startDate: '2026-03-21' }, ground({ heavyCategories: [{ name: 'Cabinets', total: 28000, hasLeadSignal: true }] }));
  has('resolved long-lead not asked', gaps.map(g => g.field), 'longLeadMilestones', false);
}
{
  has('crew cap defaulted from history', scheduleGaps({ startDate: '2026-03-21' }, ground({ crewCapHistory: 3 })).map(g => g.field), 'crewCap', false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
