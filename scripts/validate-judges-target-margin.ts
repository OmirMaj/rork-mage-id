// validate-judges-target-margin.ts — Bid Advisor scores the job at HIS
// markup, lands on the project it was sent, and says where the margin came
// from (audit round 2, #6).
// Run via: bun run scripts/validate-judges-target-margin.ts
//
// THE BUG. app/judges.tsx scored describe mode at a hardcoded
// `targetMargin: 0.2` (25% markup) and pick mode fell back to the same 0.2
// when the estimate had no markup — then wrote `targetMarginPct: 20` into the
// prediction ledger for gradeJudges to grade his real job against. Both
// "Score with Bid Advisor" buttons (bid-leveling, buyout-package) passed
// `projectId`, which judges.tsx never read: he landed on an empty describe
// form. Describe mode also drafted lines with `location: ''`.
import { readFileSync } from 'node:fs';
import { resolveTargetMargin } from '../utils/judges/targetMargin';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

console.log('\nresolveTargetMargin');
{
  const r = resolveTargetMargin({ savedMarkupPct: 15, markupDecided: true });
  ok('describe: his saved 15% markup → 13.04% margin (not 20%)', r.ok && near(r.targetMargin, 0.15 / 1.15), JSON.stringify(r));
  ok('…labelled as his markup', r.ok && r.source === 'settings' && /your 15% markup/.test(r.label));
}
{
  const r = resolveTargetMargin({ savedMarkupPct: 15, markupDecided: false });
  ok('describe: markup never set → BLOCKED with a reason, no default', !r.ok && /Set your markup first/.test(r.reason));
}
{
  const r = resolveTargetMargin({ savedMarkupPct: 15, markupDecided: null });
  ok('describe: markup still loading → blocked, not guessed', !r.ok);
}
{
  const r = resolveTargetMargin({ savedMarkupPct: 0, markupDecided: true });
  ok('0% is a real answer (quotes at cost) → 0 margin, not 20%', r.ok && r.targetMargin === 0);
}
{
  const r = resolveTargetMargin({ estimateMarkupPct: 25, savedMarkupPct: 15, markupDecided: true });
  ok('pick: the estimate\'s own 25% markup wins (20% margin)', r.ok && near(r.targetMargin, 0.2) && r.source === 'estimate');
}
{
  const r = resolveTargetMargin({ estimateMarkupPct: 0, savedMarkupPct: 18, markupDecided: true });
  ok('pick: an estimate with 0 markup falls back to his saved markup', r.ok && r.source === 'settings' && near(r.targetMargin, 0.18 / 1.18));
}
{
  const r = resolveTargetMargin({ estimateMarkupPct: 0, savedMarkupPct: 15, markupDecided: false });
  ok('pick: no markup on the estimate or in settings → BLOCKED (was silently 20%)',
    !r.ok && /No markup on this estimate or in your settings/.test(r.reason));
}
{
  const r = resolveTargetMargin({ estimateMarkupPct: null, savedMarkupPct: 15, markupDecided: false });
  ok('pick: unset estimate markup, unset settings → BLOCKED', !r.ok);
}

console.log('\nwiring (app/judges.tsx, VerdictCard, the two buttons)');
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const judges = read('app/judges.tsx');
ok('no hardcoded 20% margin anywhere in judges.tsx', !/targetMargin:\s*0\.2\b/.test(judges) && !/:\s*0\.2;/.test(judges));
ok('both paths resolve the margin through resolveTargetMargin', (judges.match(/resolveTargetMargin\(/g) ?? []).length >= 2);
ok('the markup comes from MaterialCartContext (globalMarkup + markupDecided)',
  /useMaterialCart\(\)/.test(judges) && /markupDecided/.test(judges));
ok('reads projectId from the route', /useLocalSearchParams<\{ projectId\?: string \}>\(\)/.test(judges));
ok('scores the routed project on arrival (pick mode + handlePickProject)',
  /setMode\('pick'\)[\s\S]{0,600}handlePickProject\(routeProjectId\)/.test(judges));
ok('describe mode passes settings.location, not an empty string',
  /location: typeof settings\?\.location === 'string' \? settings\.location : ''/.test(judges) && !/location: '',/.test(judges));
ok('the ledger records the resolved margin, not a default',
  /const targetMargin = tm\.targetMargin;/.test(judges) && /targetMarginPct: targetMargin \* 100/.test(judges));
ok('the verdict card is told where the margin came from', /<VerdictCard result=\{result\} marginSource=\{marginLabel\} \/>/.test(judges));
ok('VerdictCard prints the margin source', /Margin from \$\{marginSource\}/.test(read('components/judges/VerdictCard.tsx')));
for (const f of ['app/bid-leveling.tsx', 'app/buyout-package.tsx']) {
  ok(`${f} still sends the project to /judges`, /pathname: '\/judges', params: \{ projectId: pkg\.projectId \}/.test(read(f)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
