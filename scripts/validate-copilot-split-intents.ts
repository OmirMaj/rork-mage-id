// scripts/validate-copilot-split-intents.ts — pure-fn validator for the
// multi-capability splitter's normalizer.
import { normalizeSplitActions } from '../utils/copilot/intentTable';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

{
  const a = normalizeSplitActions([
    { capabilityId: 'daily_report', text: 'framed the third floor', label: 'Log the day' },
    { capabilityId: 'change_order', text: 'owner wants a heat pump for 4k', label: 'Heat pump CO' },
    { capabilityId: 'safety_incident', text: 'a guy cut his hand', label: 'Cut hand' },
  ]);
  ok('splits 3 valid actions', a.length === 3);
  ok('preserves capability + text', a[0].capabilityId === 'daily_report' && a[0].text.includes('framed'));
  ok('preserves the label', a[1].label === 'Heat pump CO');
}
ok('drops an invalid capability id', normalizeSplitActions([{ capabilityId: 'order_pizza', text: 'x', label: 'y' }]).length === 0);
ok('drops empty/whitespace text', normalizeSplitActions([{ capabilityId: 'rfi', text: '   ', label: 'y' }]).length === 0);
ok('dedups identical actions', normalizeSplitActions([
  { capabilityId: 'rfi', text: 'beam size', label: 'a' },
  { capabilityId: 'rfi', text: 'Beam Size', label: 'b' },
]).length === 1);
ok('non-array → empty', normalizeSplitActions(null).length === 0);
ok('undefined → empty', normalizeSplitActions(undefined).length === 0);
ok('missing label falls back to the text', normalizeSplitActions([
  { capabilityId: 'rfi', text: 'question about the beam sizing at grid C', label: '' },
])[0].label.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
