// validate-retainage-source.ts — the first invoice on a job must not hold zero
// by omission.
//
// WHY THIS EXISTS.
//
// Every downstream piece of the retainage machinery was already correct:
// utils/retainage plans and records releases, retainageOnWorkValue withholds on
// the value of the work and never on sales tax, the cash-flow forecast excludes
// held money from the runway (validate-cashflow-retention), and the G702 and the
// invoice agree by construction. All of it hangs off ONE input that nothing ever
// captured — the percentage in the contract.
//
// app/invoice.tsx has carried the rate forward from the most recent non-draft
// invoice since the carry-forward shipped, so invoice #2 onward was fine.
// Invoice #1 was not: there is nothing to carry from, and
// app/bill-from-estimate.tsx wrote its Invoice literal with NO retentionPercent
// and called addInvoice before the editor mounted, so the editor's seed fell to
// the string '0'.
//
// THE LIVE COST. On a job where the owner holds 10%, invoice #1 for $80,000 goes
// out asking for $80,000. The owner's AP deducts the 10% regardless and pays
// $72,000. MAGE then shows $8,000 outstanding on an invoice the owner considers
// settled — a phantom receivable that propagates into A/R aging, the weekly
// forecast, payment predictions and the retention screen, which sees nothing
// held and therefore has nothing to plan a release against.
//
// WHAT IS GUARDED. utils/retainageSource.resolveRetainagePercent is the single
// layered answer, and the layering is the whole fix, so each layer is asserted
// individually — including the two that only exist because of this bug (the
// contract term on the Project, and the newest saved G702). The wiring is
// asserted too: a pure resolver that no screen calls is the exact shape of a
// guard that stays green while its subject is gone.
//
// THE HONESTY RULE IS ALSO GUARDED. Nothing may invent a rate. "I don't know"
// stores NOTHING — not a flagged guess — because an invented retainage is a
// number he bills, sends, and then argues about with the owner; and `undefined`
// ("never asked") must stay distinguishable from `0` ("he really holds
// nothing"), which the old '0' seed conflated.
//
// Run via: bun run test:retainage-source

import {
  resolveRetainagePercent, retainageAnswerPatch, isRecordedRetainageRate,
  type RetainagePriorInvoice,
} from '../utils/retainageSource';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

function prior(over: Partial<RetainagePriorInvoice>): RetainagePriorInvoice {
  return {
    id: 'i1', number: 1, status: 'sent', retentionPercent: undefined,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as RetainagePriorInvoice;
}

console.log('\nretainage source (invoice #1 must not hold zero by omission):');

// ── 1. nothing on file: ask, never assert ───────────────────────────────────
{
  const r = resolveRetainagePercent({});
  check('a job with no invoices, no contract term and no pay app needs an ask',
    r.needsAsk && r.source === 'unknown',
    `got source=${r.source} needsAsk=${r.needsAsk}`);
  check('the unknown label says "not on file", not "0% withheld"',
    /not on file/i.test(r.label) && !/^0%/.test(r.label),
    `label was "${r.label}"`);
  check('the unknown percent is 0 so the math still runs',
    r.percent === 0, `got ${r.percent}`);
}

// ── 2. THE FIX: the contract term on the job answers invoice #1 ─────────────
{
  const r = resolveRetainagePercent({ project: { retainagePercent: 10 } });
  check('Project.retainagePercent seeds the FIRST invoice (the bug this guard exists for)',
    r.percent === 10 && r.source === 'contract' && !r.needsAsk,
    `got percent=${r.percent} source=${r.source} needsAsk=${r.needsAsk}`);
  check('a contract term is labelled as coming from the contract',
    /contract/i.test(r.label), `label was "${r.label}"`);

  const assumed = resolveRetainagePercent({ project: { retainagePercent: 10, retainagePercentAssumed: true } });
  check('an INFERRED job rate is not labelled as a contract term',
    assumed.percent === 10 && !/^from your contract$/i.test(assumed.label),
    `label was "${assumed.label}"`);
}

// ── 3. THE FIX: a job already certifying on a G702 is never asked ───────────
{
  const r = resolveRetainagePercent({
    payApps: [
      { applicationNumber: 1, retainagePercent: 10 },
      { applicationNumber: 3, retainagePercent: 5 },
      { applicationNumber: 2, retainagePercent: 10 },
    ],
  });
  check('the NEWEST saved pay application answers the rate (no ask on a G702 job)',
    r.percent === 5 && r.source === 'payApp' && !r.needsAsk,
    `got percent=${r.percent} source=${r.source}`);
  check('the pay-app label names the application it came from',
    /Pay App #3/.test(r.label), `label was "${r.label}"`);
}

// ── 4. the existing carry-forward is unchanged and still outranks the job ───
{
  const invoices = [
    prior({ id: 'a', number: 2, retentionPercent: 5, createdAt: '2026-02-01T00:00:00.000Z' }),
    prior({ id: 'b', number: 3, retentionPercent: 7, createdAt: '2026-03-01T00:00:00.000Z' }),
  ];
  const r = resolveRetainagePercent({ priorInvoices: invoices, project: { retainagePercent: 10 } });
  check('the most recent non-draft invoice wins over the contract term (no regression)',
    r.percent === 7 && r.source === 'carried', `got percent=${r.percent} source=${r.source}`);
  check('the carried label names the invoice it was carried from',
    r.label === 'same as #3', `label was "${r.label}"`);

  const draftsOnly = resolveRetainagePercent({
    priorInvoices: [prior({ id: 'c', number: 4, status: 'draft', retentionPercent: 20 })],
  });
  check('a DRAFT invoice is not a source (a draft is a guess in progress)',
    draftsOnly.needsAsk && draftsOnly.source === 'unknown', `got source=${draftsOnly.source}`);

  const self = resolveRetainagePercent({
    priorInvoices: [prior({ id: 'self', number: 9, retentionPercent: 12 })],
    excludeInvoiceId: 'self',
  });
  check('the invoice being edited cannot carry from itself',
    self.needsAsk, `got source=${self.source} percent=${self.percent}`);
}

// ── 5. an issued invoice's own rate is a fact about a sent document ─────────
{
  const r = resolveRetainagePercent({
    invoice: { retentionPercent: 0 },
    priorInvoices: [prior({ id: 'a', number: 2, retentionPercent: 10 })],
    project: { retainagePercent: 10 },
    payApps: [{ applicationNumber: 1, retainagePercent: 10 }],
  });
  check('a deliberate 0% ON THIS INVOICE outranks every other source',
    r.percent === 0 && r.source === 'invoice' && !r.needsAsk,
    `got percent=${r.percent} source=${r.source} — a contract edit must never rewrite a sent invoice`);
}

// ── 6. damaged rates fall through instead of becoming confident withholdings ─
{
  for (const bad of [NaN, Infinity, -5, 150]) {
    check(`a stored rate of ${bad} is not treated as recorded`,
      !isRecordedRetainageRate(bad));
    const r = resolveRetainagePercent({ project: { retainagePercent: bad } });
    check(`a project rate of ${bad} falls through to the ask rather than being clamped`,
      r.needsAsk && r.percent === 0, `got percent=${r.percent} source=${r.source}`);
  }
  check('0 IS a recorded rate ("he holds nothing" is an answer)', isRecordedRetainageRate(0));
  check('100 is still inside the range', isRecordedRetainageRate(100));
}

// ── 7. "I don't know" stores NOTHING ────────────────────────────────────────
{
  check('declining the ask writes no project patch at all',
    retainageAnswerPatch(null) === null,
    'a guess stored with a caveat is still a guess that gets billed');
  const zero = retainageAnswerPatch(0);
  check('answering 0% DOES write 0 (distinguishable from never asked)',
    zero != null && zero.retainagePercent === 0, JSON.stringify(zero));
  const ten = retainageAnswerPatch(10, { assumed: false });
  check('an answered rate is not flagged assumed',
    ten != null && ten.retainagePercent === 10 && ten.retainagePercentAssumed === false, JSON.stringify(ten));
  const inferred = retainageAnswerPatch(10, { assumed: true });
  check('a back-filled rate IS flagged assumed so no surface calls it a contract term',
    inferred != null && inferred.retainagePercentAssumed === true, JSON.stringify(inferred));
  check('a nonsense answer is refused rather than stored',
    retainageAnswerPatch(-1) === null && retainageAnswerPatch(101) === null);
}

// ── 8. the wiring — a resolver nothing calls is a guard over nothing ────────
{
  const types = read('types/index.ts');
  check('Project declares a nullable retainagePercent',
    /retainagePercent\?:\s*number;/.test(types),
    'types/index.ts lost Project.retainagePercent — the contract term has nowhere to live again.');
  check('Project declares retainagePercentAssumed',
    /retainagePercentAssumed\?:\s*boolean;/.test(types),
    'without the assumed flag an inferred rate gets presented as a contract term.');

  const bfe = read('app/bill-from-estimate.tsx');
  check('bill-from-estimate resolves retainage before writing its Invoice literal',
    /resolveRetainagePercent\(/.test(bfe),
    'app/bill-from-estimate.tsx writes an Invoice and calls addInvoice BEFORE the editor mounts. ' +
    'Without the resolver here the draft carries no rate and invoice #1 holds zero again.');
  check('bill-from-estimate leaves the rate UNDEFINED when nothing is on file',
    /retentionPercent:\s*retainage\.needsAsk\s*\?\s*undefined/.test(bfe),
    'writing 0 instead of undefined tells the editor a rate was chosen, so it never asks.');

  const inv = read('app/invoice.tsx');
  check('the invoice editor seeds from the resolver, not from a private carry',
    /resolveRetainagePercent\(/.test(inv),
    'app/invoice.tsx must read the shared stack; a second copy of the layering is how two screens ' +
    'come to disagree about one job.');
  check("the editor no longer falls back to the string '0'",
    !/carriedRetention\s*\?\s*String\(carriedRetention\.pct\)\s*:\s*'0'/.test(inv),
    "the old seed presented 'nobody asked' as a chosen 0%.");
  check('the editor asks when the resolver found nothing',
    /retainageSeed\.needsAsk/.test(inv) && /setShowRetainageAsk\(true\)/.test(inv),
    'needsAsk with no ask is just the old silent zero with extra steps.');
  check('declining the ask goes through retainageAnswerPatch / stores nothing',
    /retainageAnswerPatch\(/.test(inv),
    'the honest-provenance rule lives in the pure helper; the screen must not hand-roll the write.');
  check('the ask offers no preselected rate',
    !/useState\(['"]10['"]\)/.test(inv) && !/retainageAskInput\s*=\s*useState\(['"]\d/.test(inv),
    'a prefilled 10% is the invented fallback this codebase already removed from the G702 seeder.');
}

console.log('');
if (failures > 0) {
  console.error(`✗ validate-retainage-source: ${failures} failure(s) — the first invoice on a job can hold zero by omission again.\n`);
  process.exit(1);
}
console.log(`✓ validate-retainage-source: ${passes} checks — the retainage rate is resolved from four sources, asked for when absent, and never invented.\n`);
