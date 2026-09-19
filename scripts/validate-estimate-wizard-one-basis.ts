// validate-estimate-wizard-one-basis — the Quick Estimate wizard's money, and
// what its first bid does on the way out (audit 2026-09-18, wave 3 lane
// estimate-wizard).
//
//   #118 + #158  ONE PRICE BASIS. The PDF, the portal proposal and the contract
//                printed three totals and three deposits for one estimate
//                ($19,473.60 / $19,473 / $19,472.85). Every figure is now on the
//                cent grid and derived from one priced line: the PDF total ==
//                the project's linkedEstimate.grandTotal == the portal view's
//                projectTotal == the contract value, with equal deposits.
//   #120         A job's portal stamp is the split its re-sent PDF prints.
//   #69          An onboarding share never discards the bid: it is saved to a
//                project first, and the screen is left only on a delivery the
//                app can see.
//   #157         The pricing market is not the jobsite.
//
// The arithmetic is EXECUTED against the shipped functions (the ones the wizard
// imports). The wizard screen and utils/contractEngine import react-native /
// supabase and cannot run under bun, so what they do with those functions is
// pinned by source.
//
// fileURLToPath + join because the repo path contains a space.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildQuickLinkedEstimate, priceCostBreakdown, round2, type CostBreakdown } from '../utils/estimateMarkup';
import { toClientEstimateView } from '../utils/clientEstimateView';
import { effectiveEstimateTotal } from '../utils/estimateCommit';
import {
  contractScheduleFromSplit, paymentStageRows, proposalPaymentLines, resolvePaymentSplit,
} from '../utils/paymentTerms';
import { jobsiteLocationFor, typedPricingLocation } from '../utils/scopeQuestions';
import type { PaymentSplit, Project } from '../types';

let passed = 0;
let failed = 0;
const ok = (msg: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; console.log('  ✓ ' + msg); } else { failed++; console.error('  ✗ ' + msg + (detail ? `\n      ${detail}` : '')); }
};
const cents = (n: number) => Math.round(n * 100);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (src: string): string => {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? src.length : end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') quote = c;
    out += c;
    i++;
  }
  return out;
};
const balanced = (src: string, open: number): string => {
  const o = src[open];
  const cl = o === '(' ? ')' : o === '{' ? '}' : '';
  if (!cl) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === o) depth++;
    else if (src[i] === cl) { depth--; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
};
/** The body of `const name = useCallback(...)`. */
const callbackBody = (src: string, name: string): string => {
  const at = src.indexOf(`const ${name} = useCallback(`);
  return at >= 0 ? balanced(src, at + `const ${name} = useCallback`.length) : '';
};

// ── The cost breakdown, as the wizard normalizes it ─────────────────────────
// Unit to the cent, line = round2(qty × unit), subtotal = Σ lines, contingency
// at his 10%, permits to the cent — the rule app/estimate-wizard.tsx applies
// (pinned by source in section D, so this fixture cannot drift from it).
function wizardCost(lines: { q: number; u: number; cat?: string }[], permitsRaw: number, rate = 10): CostBreakdown {
  const lineItems = lines.map((l, i) => {
    const unitCost = round2(l.u);
    return { category: l.cat ?? 'Work', description: `Line ${i}`, quantity: l.q, unit: 'sf', unitCost, total: round2(l.q * unitCost) };
  });
  const subtotal = round2(lineItems.reduce((s, li) => s + li.total, 0));
  const contingency = round2(subtotal * rate / 100);
  const permits = round2(permitsRaw);
  return { lineItems, subtotal, contingency, permits, total: round2(subtotal + contingency + permits) };
}

// Non-integer qty × unit on every line, the audit's own shapes.
const COST = wizardCost([
  { q: 137.5, u: 12.35 }, { q: 1250, u: 4.75 }, { q: 125, u: 3.33 }, { q: 3, u: 1234.567 }, { q: 42.25, u: 18.19 },
], 850.4);
const SPLITS: PaymentSplit[] = [
  { depositPct: 10, progressPct: 80, finalPct: 10 },
  { depositPct: 25, progressPct: 65, finalPct: 10 },
  { depositPct: 33, progressPct: 0, finalPct: 67 },
];

console.log('\nA. one price basis — PDF == project == portal == contract (#118, #158):');
for (const pct of [20, 17.5, 0, null] as const) {
  let n = 0;
  const seq = () => `id${n++}`;
  const priced = priceCostBreakdown(COST, pct);          // what the PDF and the hero print
  const linked = buildQuickLinkedEstimate(COST, pct, seq); // what the project, portal and contract read
  const view = toClientEstimateView(linked);               // the portal proposal
  const contractValue = effectiveEstimateTotal({ linkedEstimate: linked } as unknown as Project); // buildDraftContract's value
  const tag = `markup ${pct === null ? 'unset' : pct + '%'}`;

  ok(`${tag}: every priced line is qty × its printed unit, to the cent`,
    priced.lineItems.every((li) => cents(li.total) === Math.round(li.quantity * li.unitCost * 100 + 1e-7) || cents(li.total) === cents(round2(li.quantity * li.unitCost))),
    JSON.stringify(priced.lineItems.map((li) => [li.quantity, li.unitCost, li.total])));
  ok(`${tag}: the printed subtotal is the sum of the printed lines`,
    cents(priced.subtotal) === priced.lineItems.reduce((s, li) => s + cents(li.total), 0),
    `${priced.subtotal} vs Σ ${priced.lineItems.reduce((s, li) => s + li.total, 0)}`);
  ok(`${tag}: every money figure on the PDF is on the cent grid`,
    [priced.subtotal, priced.contingency, priced.permits, priced.total, ...priced.lineItems.map((l) => l.total)]
      .every((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6));
  ok(`${tag}: PDF total == linkedEstimate.grandTotal`, cents(priced.total) === cents(linked.grandTotal),
    `PDF ${priced.total} vs linked ${linked.grandTotal}`);
  ok(`${tag}: each project row sells at the PDF's line total`,
    priced.lineItems.every((li, i) => cents(li.total) === cents(linked.items[i].lineTotal)),
    JSON.stringify(priced.lineItems.map((li, i) => [li.total, linked.items[i].lineTotal])));
  ok(`${tag}: the project row keeps COST in unitPrice (the job-cost engine reads it)`,
    COST.lineItems.every((li, i) => linked.items[i].unitPrice === li.unitCost));
  ok(`${tag}: portal projectTotal == linkedEstimate.grandTotal, to the cent`, cents(view.projectTotal) === cents(linked.grandTotal),
    `portal ${view.projectTotal} vs ${linked.grandTotal}`);
  ok(`${tag}: portal scope groups tie out to the cent`,
    view.scopeGroups.reduce((s, g) => s + cents(g.total), 0) === cents(view.projectTotal));
  ok(`${tag}: contract value == PDF total`, cents(contractValue) === cents(priced.total), `${contractValue} vs ${priced.total}`);

  for (const split of SPLITS) {
    const pdfRows = paymentStageRows(priced.total, split);
    const portal = proposalPaymentLines(view.projectTotal, split);
    const contract = contractScheduleFromSplit(contractValue, split, seq);
    // Every split here has a deposit, so all three documents print the same
    // stages in the same order (a contract omits only a 0% stage).
    const amounts = (rows: { amount?: number }[]) => rows.map((r) => cents(r.amount ?? NaN));
    const same = JSON.stringify(amounts(pdfRows)) === JSON.stringify(amounts(portal))
      && JSON.stringify(amounts(pdfRows)) === JSON.stringify(amounts(contract));
    ok(`${tag}, ${split.depositPct}/${split.progressPct}/${split.finalPct}: PDF, portal and contract print the same deposit, progress and final`,
      same, JSON.stringify({ pdf: pdfRows.map((r) => r.amount), portal: portal.map((r) => r.amount), contract: contract.map((r) => r.amount) }));
  }
}

// The audit's repro shape, pinned as numbers: 125 SF × $3.33 at +20% prints a
// $4.00 unit, so the line is $500.00 — not the $499.50 cost × qty × f gave the
// project while the PDF printed $500, and not the $416 whole-dollar cost line.
{
  let n = 0;
  const one = wizardCost([{ q: 125, u: 3.33 }], 0, 0);
  ok('125 SF × $3.33 is a $416.25 cost line, not $416', one.lineItems[0].total === 416.25, String(one.lineItems[0].total));
  const pricedOne = priceCostBreakdown(one, 20);
  const linkedOne = buildQuickLinkedEstimate(one, 20, () => `x${n++}`);
  ok('…priced at +20% it prints $4.00 × 125 = $500.00', pricedOne.lineItems[0].unitCost === 4 && pricedOne.lineItems[0].total === 500,
    JSON.stringify(pricedOne.lineItems[0]));
  ok('…and the project sells the same $500.00', linkedOne.grandTotal === 500, String(linkedOne.grandTotal));
}

console.log('\nB. the job stamp wins on a re-sent PDF (#120):');
{
  const stamp: PaymentSplit = { depositPct: 25, progressPct: 65, finalPct: 10 };
  const profile = { paymentSplit: { depositPct: 10, progressPct: 80, finalPct: 10 } };
  const fromStamp = resolvePaymentSplit({ record: { ...stamp, stampedAt: '2026-09-01T00:00:00Z' } }).split;
  ok('resolvePaymentSplit reads a portal stamp as the record', !!fromStamp && fromStamp.depositPct === 25);
  // The gate resolves record-before-profile; the deposit on $10,000 is then 2,500, not 1,000.
  const gateSplit = resolvePaymentSplit({ record: fromStamp, settings: profile }).split!;
  ok('with a stamp and newer profile terms, the stamp decides the deposit', paymentStageRows(10000, gateSplit)[0].amount === 2500);

  const wiz = stripComments(read('app/estimate-wizard.tsx'));
  ok('the wizard derives jobStamp from this job’s portal stamp, only with a ?projectId',
    /const jobStamp = useMemo<PaymentSplit \| null>\(\s*\(\) => \(projectId \? resolvePaymentSplit\(\{ record: scopedProject\?\.clientPortal\?\.proposalPaymentTerms \}\)\.split : null\)/.test(wiz));
  const share = callbackBody(wiz, 'share');
  ok('share() hands the stamp to the gate as `record`', /purpose: 'proposal_pdf',[\s\S]*?record: jobStamp,/.test(share));
  ok('…and lists it as a dependency (a stale stamp would otherwise be kept)', /\[costResult, gate, scopedProject\?\.type, jobStamp,/.test(wiz));
  ok('the terms card’s "Set now" passes the same record',
    /gate\.run\(\{ terms: true, purpose: 'proposal_pdf', total: result\.total, projectType: scopedProject\?\.type \?\? null, record: jobStamp \}/.test(wiz));
  ok('the preview prints the stamp when there is one, so it matches the PDF',
    /const previewSplit = jobStamp \?\? savedTerms\.split;/.test(wiz));
  ok('a stamp that differs from his profile says so in one line',
    /jobStamp && savedTerms\.split && !sameSplit\(jobStamp, savedTerms\.split\)/.test(wiz) && wiz.includes('testID="wizard-payment-terms-job-stamp"'));
}

console.log('\nC. the onboarding share keeps the bid (#69):');
{
  const wiz = stripComments(read('app/estimate-wizard.tsx'));
  const gen = callbackBody(wiz, 'generateAndSharePdf');
  const onb = balanced(gen, gen.indexOf('if (isOnboarding) {') + 'if (isOnboarding) '.length);
  ok('an unattached onboarding bid is saved to a new project, at the shared price',
    /const attachedId = committedProjectId \?\? savedProjectId\s*\?\? persistNewProject\(sharePctRef\.current/.test(onb), onb.slice(0, 300));
  ok('…the screen is left only on web (a window that opened), and only WITH that project',
    /if \(Platform\.OS === 'web' && attachedId\) \{\s*router\.replace\(\{ pathname: ONBOARDING_PAYWALL_ROUTE, params: \{ projectId: attachedId \} \} as never\);/.test(onb));
  ok('…and never onto the bare paywall route (the replace that discarded the bid)',
    !/router\.replace\([^)]*\?[^)]*: ONBOARDING_PAYWALL_ROUTE\)/.test(wiz) && !/router\.replace\(ONBOARDING_PAYWALL_ROUTE\)/.test(wiz));
  const sendAt = gen.indexOf('await shareQuickEstimatePDF(');
  ok('the funnel event and the save both wait for the share to resolve',
    sendAt >= 0 && gen.indexOf('AnalyticsEvents.ESTIMATE_SHARED') > sendAt && gen.indexOf('persistNewProject(') > sendAt);
  const go = callbackBody(wiz, 'share');
  ok('share() records the price it quoted before it runs the gate',
    go.indexOf('sharePctRef.current = pct;') >= 0 && go.indexOf('sharePctRef.current = pct;') < go.indexOf('gate.run('));
}

console.log('\nD. the wizard rounds to cents, not dollars (#158):');
{
  const wiz = stripComments(read('app/estimate-wizard.tsx'));
  const gen = callbackBody(wiz, 'generate');
  ok('no whole-dollar round helper in generate', !/Math\.round\(Number\.isFinite\(n\) \? n : 0\)/.test(gen) && !/const round = /.test(gen));
  ok('unit to the cent, then line = round2(qty × unit)',
    /const unitCost = round2\(li\.unitCost\);/.test(gen) && /total: round2\(quantity \* unitCost\)/.test(gen));
  ok('contingency, permits and total on the cent grid',
    /round2\(subtotal \* rate \/ 100\) : round2\(raw\.contingency\)/.test(gen) && /const permits = round2\(raw\.permits\);/.test(gen)
    && /const total = round2\(subtotal \+ contingency \+ permits\);/.test(gen));
  ok('the result screen prints lines and footings with two decimals',
    /formatMoney\(li\.total, 2\)/.test(wiz) && /formatMoney\(result\.total, 2\)/.test(wiz) && /formatMoney\(result\.subtotal, 2\)/.test(wiz)
    && !/maximumFractionDigits: 0/.test(wiz));
}

console.log('\nE. the pricing market is not the jobsite (#157):');
{
  const cases: [string, Parameters<typeof jobsiteLocationFor>[0], string][] = [
    ['a typed jobsite wins', { jobsite: ' 412 Oak St, Austin, TX ', pricingAnswer: 'Austin, TX', homeMarket: 'Houston, TX' }, '412 Oak St, Austin, TX'],
    ['no jobsite + his default market carried through → blank, not the market', { jobsite: '', pricingAnswer: 'Houston, TX', homeMarket: 'Houston, TX' }, ''],
    ['…case and spacing do not smuggle it through', { jobsite: '', pricingAnswer: ' houston, tx', homeMarket: 'Houston, TX' }, ''],
    ['no jobsite + a city he TYPED for this job → that city', { jobsite: '', pricingAnswer: 'Austin, TX', homeMarket: 'Houston, TX' }, 'Austin, TX'],
    ['nothing at all → blank, never "United States"', { jobsite: '', pricingAnswer: '', homeMarket: '' }, ''],
    ['"United States" typed anywhere is not an address', { jobsite: 'United States', pricingAnswer: 'united states', homeMarket: '' }, ''],
  ];
  for (const [label, input, want] of cases) {
    const got = jobsiteLocationFor(input);
    ok(`${label} (${JSON.stringify(got)})`, got === want);
  }
  ok('the one-tap fill is offered only for a city he typed', typedPricingLocation('Austin, TX', 'Houston, TX') === 'Austin, TX'
    && typedPricingLocation('Houston, TX', 'Houston, TX') === null && typedPricingLocation('', '') === null);

  const wiz = stripComments(read('app/estimate-wizard.tsx'));
  const persist = callbackBody(wiz, 'persistNewProject');
  ok('a created project’s location comes from jobsiteLocationFor',
    /location: jobsiteLocationFor\(\{ jobsite, pricingAnswer: answers\.location, homeMarket: homeMarketSeed \}\)/.test(persist));
  ok('…the pricing answer stays in scope.location', /scope: \{[\s\S]*?location: answers\.location,/.test(persist));
  ok('no "United States" fallback on a created project', !/\|\| 'United States'/.test(wiz));
  ok('the Save sheet asks for the jobsite, with the typed city as a one-tap fill',
    wiz.includes('testID="wizard-new-project-jobsite"') && wiz.includes('testID="wizard-new-project-jobsite-fill"')
    && /onPress=\{\(\) => setJobsiteAddress\(jobsiteOffer\)\}/.test(wiz));
  ok('createAt writes what he typed in that field', /persistNewProject\(pct, name, jobsiteAddress\)/.test(callbackBody(wiz, 'createAt')));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
