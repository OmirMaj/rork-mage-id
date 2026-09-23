// validate-w5-coi-subs-evaluator.ts — the Subs sheet tells the truth about a
// sub (audit #115, #27, and reports' #17 carried here).
//
//   #115 'AI Evaluate Sub' was told "Bid history: 0 bids / Assigned projects:
//        0" for every sub (nothing fills those fields) and never the signed
//        commitments the scorecard grades him on; its verdict was cached 24h
//        under the sub id alone and its trackRecord sat beside a green check.
//   #27  1099 fields, verified stamps and the W-9 path vanished at the next
//        read; the W-9 could be uploaded but never opened; a partial TIN would
//        be refused by the new CHECK.
//   #17  deleting a sub he has paid drops his TIN and address from the 1099
//        export with no warning.
//
// The grounding builder is pure and RUN here; the screens are pinned by source.
//
// Run: bun run scripts/validate-w5-coi-subs-evaluator.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SubScorecard } from '../utils/subScorecard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

const { buildSubEvaluationGrounding } = await import('../utils/subCompliance');

const card = (over: Partial<SubScorecard> = {}): SubScorecard => ({
  subId: 's1', companyName: 'Acme Framing', trade: 'Framing', score: 78, grade: 'B', confidence: 'medium',
  factors: [
    { key: 'co_impact', label: 'Change-order impact', score: 0.82, weight: 0.3, applicable: true, detail: 'CO growth 6% across 3 commitments' },
    { key: 'rework_rate', label: 'Punch rework', score: 0.9, weight: 0.2, applicable: true, detail: '1 of 10 punch items bounced' },
    { key: 'schedule_reliability', label: 'Schedule reliability', score: 0.7, weight: 0.2, applicable: true, detail: 'finished 2 days late on average' },
    { key: 'rfi_responsiveness', label: 'RFI turnaround', score: 0.5, weight: 0, applicable: false, detail: 'no RFIs assigned' },
  ] as SubScorecard['factors'],
  topDriver: 'finished 2 days late on average', commitmentCount: 3, closedCommitmentCount: 1,
  totalVolume: 123456.785, noHistory: false, ...over,
});

console.log('\n#115 · grounding:');
{
  const g = buildSubEvaluationGrounding({ card: card(), awardedJobNames: ['Maple St', 'Oak Ave', 'Maple St'], projectsOnFileCount: 4 });
  ok('it carries the grade, score and confidence the sheet shows', /grade B, 78\/100, medium confidence/.test(g.context), g.context);
  ok('…the signed commitment count and the total to the cent', /Signed commitments on record in MAGE ID: 3 \(1 closed\), totalling \$123,456\.79/.test(g.context), g.context);
  ok('…the jobs awarded, deduped', /Jobs awarded to this sub: Maple St, Oak Ave\./.test(g.context));
  ok('…each factor with its value, and the unmeasured ones as unmeasured',
    /Change-order impact: 82\/100/.test(g.context) && /RFI turnaround: not measured/.test(g.context));
  ok('…and says bid history / assigned projects are not tracked (not evidence)', /Not tracked in MAGE ID: bid history and assigned-project lists/.test(g.context));
  ok('the chip says what it read', g.readChip === 'Read: 3 commitments, CO growth, punch, schedule', g.readChip);
  ok('with history → hasHistory', g.hasHistory === true);
  // Review round 1: the count is every project on file (projects.length), so it
  // must never be called "active" to the model.
  ok('the project count is labelled as every project on file, never "active"',
    /Projects on file for this contractor \(every status, closed jobs included\): 4\./.test(g.context) && !/Active projects/i.test(g.context), g.context);

  const n = buildSubEvaluationGrounding({ card: card({ noHistory: true, commitmentCount: 0, closedCommitmentCount: 0, totalVolume: 0 }), awardedJobNames: [], projectsOnFileCount: 4 });
  ok('no history → "no signed commitments on record in MAGE ID"', /No signed commitments on record in MAGE ID/.test(n.context) && !/Signed commitments on record/.test(n.context));
  ok('…chip "no commitments on record, paperwork only", hasHistory false', n.readChip === 'Read: no commitments on record, paperwork only' && n.hasHistory === false);
  ok('the cache hash moves when the inputs move',
    g.inputsHash !== buildSubEvaluationGrounding({ card: card({ commitmentCount: 4 }), awardedJobNames: ['Maple St', 'Oak Ave'], projectsOnFileCount: 4 }).inputsHash);
  ok('…and is stable when they do not', g.inputsHash === buildSubEvaluationGrounding({ card: card(), awardedJobNames: ['Oak Ave', 'Maple St'].reverse(), projectsOnFileCount: 4 }).inputsHash);
}

console.log('\n#115 · the panel:');
{
  const ev = src('components/AISubEvaluator.tsx');
  ok('the cache key carries the sub\'s updatedAt and the inputs hash',
    /const cacheKey = `sub_eval_\$\{sub\.id\}_\$\{sub\.updatedAt \?\? ''\}_\$\{grounding\?\.inputsHash \?\? 'none'\}`;/.test(ev));
  ok('the old id-only key is gone', !/const cacheKey = `sub_eval_\$\{sub\.id\}`;/.test(ev));
  ok('a grounding chip renders under the title', /\{grounding\.readChip\}/.test(ev));
  ok('the green-check track record only renders with history', /result\.trackRecord && grounding\?\.hasHistory \? \(/.test(ev));
  ok('without history a neutral line says there is no track record', /No signed commitments on record in MAGE ID — no track record to summarize yet\./.test(ev));
  const subs = src('app/(tabs)/subs/index.tsx');
  ok('the Subs sheet passes the grounding as projectContext and grounding',
    /projectContext=\{evalGrounding\.context\}/.test(subs) && /grounding=\{evalGrounding\}/.test(subs));
  ok('…built from the open scorecard card and the awarded jobs',
    /buildSubEvaluationGrounding\(\{\s*card: openScorecard,/.test(subs) && /c\.subcontractorId === subId && c\.status !== 'draft'/.test(subs));
  ok('the old ungrounded context ("Trades needed: …") is gone', !/Trades needed:/.test(subs));
}

console.log('\n#27 · the Subs form:');
{
  const subs = src('app/(tabs)/subs/index.tsx');
  const save = subs.slice(subs.indexOf('const handleSave = useCallback'), subs.indexOf('if (editingSub) {', subs.indexOf('const handleSave = useCallback')));
  ok('a TIN that is not exactly 4 digits is refused before saving (so the CHECK never refuses a queued row)',
    /if \(tin && !\/\^\[0-9\]\{4\}\$\/\.test\(tin\)\) \{/.test(save) && /return;/.test(save));
  ok('"View W-9" mints a signed link on demand', /signW9Url\(path\)/.test(subs) && /accessibilityLabel="View W-9"/.test(subs));
  ok('the W-9 upload reads bytes with readFileBytes (not a 0-byte fetch Blob)', /await readFileBytes\(asset\.uri\)/.test(subs) && !/fetch\(asset\.uri\)/.test(subs));
  // w5-join-core folded Subcontractor.w9DocPath into types/index.ts (CONTRACT
  // 27): the screen reads and writes it with no cast and no alias.
  ok('w9DocPath is read and written as a plain Subcontractor field (the W5 alias is folded)',
    /setW9DocPath\(sub\.w9DocPath\)/.test(subs) && /updateSubcontractor\(editingSub\.id, \{ w9OnFile: true, w9DocPath: path \}\)/.test(subs)
      && !/SubcontractorW5/.test(subs) && !/Subcontractor & \{ w9DocPath\?: string \}/.test(subs));
}

console.log('\n#17 (carry) · deleting a paid sub:');
{
  const subs = src('app/(tabs)/subs/index.tsx');
  const del = subs.slice(subs.indexOf('const handleDelete = useCallback'), subs.indexOf('}, [deleteSubcontractor, commitments]);'));
  ok('it looks for commitments with paidToDate > 0', /c\.subcontractorId === sub\.id && \(c\.paidToDate \?\? 0\) > 0/.test(del));
  ok('…and paid sub-portal invoices', /\.from\('sub_submitted_invoices'\)[\s\S]*?\.eq\('subcontractor_id', sub\.id\)[\s\S]*?\.eq\('status', 'paid'\)/.test(del));
  ok('…and warns that the 1099 export loses the TIN and address', /They'll still appear on the 1099 export, but their TIN and address will be gone/.test(del));
  ok('…with keeping them the cancel (easy) choice', /\{ text: 'Keep them', style: 'cancel' \}/.test(del));
  ok('a failed invoice check is said out loud, not read as "none"', /We couldn't check his portal invoices just now/.test(del));
}

console.log(`\nvalidate-w5-coi-subs-evaluator: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
