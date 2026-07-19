// scripts/validate-copilot-gaps-rfi-punch.ts — pure-fn validator for the RFI +
// Punch gap rules (two thin field-capture adapters).
import { rfiGaps } from '../utils/copilot/rfi/rfiGaps';
import { punchGaps } from '../utils/copilot/punch/punchGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, fields: string[], field: string, want: boolean) {
  const ok = fields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${fields.join(',')})`); }
}
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }
const G: Grounding = { facts: [], data: {} };

// --- RFI ---
{
  const g = rfiGaps({}, G).map((x) => x.field);
  has('rfi asks recipient when unstated', g, 'assignedTo', true);
  has('rfi asks urgency when unstated', g, 'urgent', true);
}
has('rfi recipient not re-asked once set', rfiGaps({ assignedTo: 'Architect' }, G).map((x) => x.field), 'assignedTo', false);
has('rfi urgency not re-asked once set', rfiGaps({ urgent: true }, G).map((x) => x.field), 'urgent', false);
{
  const q = rfiGaps({}, G).find((x) => x.field === 'assignedTo');
  ok('rfi recipient is a choice with 4 disciplines', q?.kind === 'choice' && q?.choices?.length === 4);
}

// --- Punch ---
{
  const g = punchGaps({}, G).map((x) => x.field);
  has('punch asks trade when unstated', g, 'assignedSub', true);
  has('punch surfaces priority', g, 'priority', true);
}
has('punch trade not re-asked once set', punchGaps({ assignedSub: 'Plumber' }, G).map((x) => x.field), 'assignedSub', false);
has('punch priority not re-asked once set', punchGaps({ priority: 'high' }, G).map((x) => x.field), 'priority', false);
{
  const q = punchGaps({}, G).find((x) => x.field === 'assignedSub');
  ok('punch trade is a choice with 5 trades', q?.kind === 'choice' && q?.choices?.length === 5);
  ok('punch priority impact is below the 0.4 ask threshold', (punchGaps({}, G).find((x) => x.field === 'priority')?.impact ?? 1) < 0.4);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
