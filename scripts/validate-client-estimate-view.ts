// Client-estimate-view validation — utils/clientEstimateView.ts (pure, no RN imports).
//
// The client view is a SAFETY boundary: it must never leak the contractor's
// internal numbers (base cost, markup, margin, unit prices, suppliers) to a
// client. This validator guards:
//   1. projectTotal == grand total (what the client pays).
//   2. Scope groups sum EXACTLY to projectTotal (a fixed-price proposal must tie out).
//   3. Allowances come only from isAllowance items.
//   4. No forbidden internal key appears anywhere in the produced view.
//   5. A zero base total does not divide by zero.
//   2b. projectTotal and the groups are on the CENT grid (#118).
//   2c. A marked-up (sell-side) lineTotal is not marked up a second time.
//   6. No client-facing proposal text names a payment or warranty term the GC
//      never stated (Direction B, 2026-09-17): no invented 10% deposit here,
//      and the tier quotes print his ONE saved warranty — or "Workmanship
//      warranty" with no period — on every tier.
//
// fileURLToPath because the repo path contains a space.

import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { toClientEstimateView } from '@/utils/clientEstimateView';
import { buildProposalTiers, proposalToShareText } from '@/utils/proposalBuilder';
import type { LinkedEstimate } from '@/types';

let failed = 0;
let passed = 0;
const assert = (c: boolean, m: string) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  FAIL  ' + m); } };

console.log('\nclient-estimate-view validation:');

// ── Fixture: $200k base + 25% markup = $250k grand total ────────────────────
const mkItem = (over: Partial<LinkedEstimate['items'][number]>) => ({
  materialId: 'm', name: 'Item', category: 'c', unit: 'ea', quantity: 1,
  unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 0, supplier: 'ACME',
  ...over,
});

const est: LinkedEstimate = {
  id: 'e1',
  globalMarkup: 0.25,
  baseTotal: 200000,
  markupTotal: 50000,
  grandTotal: 250000,
  createdAt: '2026-07-27T00:00:00.000Z',
  items: [
    mkItem({ name: 'Foundations', csiDivision: '03', lineTotal: 100000 }),
    mkItem({ name: 'Slab on grade', csiDivision: '03', lineTotal: 50000 }),
    mkItem({ name: 'Electrical rough-in', csiDivision: '26', lineTotal: 40000 }),
    mkItem({ name: 'Tile', csiDivision: '09', lineTotal: 10000, isAllowance: true }),
  ],
};

const view = toClientEstimateView(est);

// 1. Project total is the grand total
assert(view.projectTotal === 250000, `projectTotal is the grand total (got ${view.projectTotal})`);

// 2. Groups sum EXACTLY to the project total (fixed-price proposal ties out)
const sum = view.scopeGroups.reduce((s, g) => s + g.total, 0);
assert(sum === view.projectTotal, `scope groups sum exactly to project total (got ${sum})`);

// Concrete (2 items) should be the largest group, markup baked in: 150000 * 1.25 = 187500
const concrete = view.scopeGroups.find(g => g.key === '03');
assert(!!concrete && concrete.total === 187500, `concrete group carries baked-in markup (got ${concrete?.total})`);
assert(view.scopeGroups.every(g => g.total !== 0), 'no empty scope groups');

// A credit in its own division is SCOPE, and must survive to the client view.
// Before 2026-09-13 the `> 0` filter dropped it and the drift fold folded its
// magnitude into the largest surviving group, overstating that group's price.
{
  const credited = toClientEstimateView({
    ...est,
    baseTotal: 190000,
    markupTotal: 0,
    grandTotal: 190000,
    items: [
      mkItem({ name: 'Framing', csiDivision: '06', lineTotal: 200000 }),
      mkItem({ name: 'Owner-supplied appliances credit', csiDivision: '11', lineTotal: -10000 }),
    ],
  });
  const framing = credited.scopeGroups.find(g => g.key === '06');
  const credit = credited.scopeGroups.find(g => g.key === '11');
  assert(framing?.total === 200000, `framing is not inflated by the credit (got ${framing?.total})`);
  assert(credit?.total === -10000, `the credit survives as its own line (got ${credit?.total})`);
  assert(credited.scopeGroups.reduce((s, g) => s + g.total, 0) === 190000, 'and the two still tie out');
}
assert(view.scopeGroups.some(g => /concrete/i.test(g.label)), 'groups are labeled by division name');

// 2b. TO THE CENT (audit 2026-09-18, #118). projectTotal was
// Math.round(grandTotal), so the portal proposal priced its payment lines off
// $19,473 while the contract priced off $19,472.85.
{
  const centsEst: LinkedEstimate = {
    ...est, baseTotal: 16227.38, markupTotal: 3245.47, grandTotal: 19472.85,
    items: [
      mkItem({ name: 'Framing', csiDivision: '06', lineTotal: 12345.67 }),
      mkItem({ name: 'Drywall', csiDivision: '09', lineTotal: 7127.18 }),
    ],
  };
  const v = toClientEstimateView(centsEst);
  assert(v.projectTotal === 19472.85, `projectTotal keeps the cents (got ${v.projectTotal}, old code 19473)`);
  const c = v.scopeGroups.reduce((s2, g) => s2 + Math.round(g.total * 100), 0);
  assert(c === 1947285, `scope groups tie out to the cent (got ${c / 100})`);
  assert(v.scopeGroups.every(g => Math.round(g.total * 100) / 100 === g.total), 'every group is on the cent grid');
}

// 2c. A SELL-side lineTotal is not marked up a second time (audit 2026-09-18,
// the wave-2 desktop-web note on #118 — confirmed real). The canonical
// LinkedEstimate (utils/estimateMarkup, the estimator, the wizard) stores
// lineTotal ALREADY marked up with Σ lineTotal === grandTotal. The old factor
// grandTotal / baseTotal multiplied it by the markup again, and the drift fold
// then dumped the excess into the largest group: $12,000 + $6,000 at 20%
// rendered as $10,800 / $7,200 on the homeowner's scope.
{
  const sellEst: LinkedEstimate = {
    ...est, globalMarkup: 20, baseTotal: 15000, markupTotal: 3000, grandTotal: 18000,
    items: [
      mkItem({ name: 'Framing', csiDivision: '06', unitPrice: 10000, markup: 20, lineTotal: 12000 }),
      mkItem({ name: 'Paint', csiDivision: '09', unitPrice: 5000, markup: 20, lineTotal: 6000 }),
    ],
  };
  const v = toClientEstimateView(sellEst);
  const g06 = v.scopeGroups.find(g => g.key === '06')?.total;
  const g09 = v.scopeGroups.find(g => g.key === '09')?.total;
  assert(g06 === 12000 && g09 === 6000, `sell-side rows keep their own price (06 ${g06}, 09 ${g09}; the double-markup gave 10800 / 7200)`);
  assert(v.projectTotal === 18000, 'and the total is the grand total');
}

// 3. Allowances only from isAllowance items, client price (markup baked in)
assert(view.allowances.length === 1, `one allowance item (got ${view.allowances.length})`);
assert(view.allowances[0]?.name === 'Tile' && view.allowances[0]?.amount === 12500, 'allowance shows client price');

// 4. No forbidden internal key anywhere in the view
const FORBIDDEN = ['markup', 'baseTotal', 'markupTotal', 'globalMarkup', 'unitPrice', 'bulkPrice', 'supplier', 'margin', 'usesBulk'];
const keys = new Set<string>();
const walk = (v: unknown) => {
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { keys.add(k); walk((v as Record<string, unknown>)[k]); } }
};
walk(view);
for (const f of FORBIDDEN) assert(!keys.has(f), `view never exposes internal key '${f}'`);

// 5. Degenerate: zero base total must not divide by zero
const empty = toClientEstimateView({ ...est, items: [], baseTotal: 0, markupTotal: 0, grandTotal: 0 });
assert(empty.projectTotal === 0 && empty.scopeGroups.length === 0, 'empty estimate is safe (no divide-by-zero)');

// 6. No guessed payment or warranty terms on anything a client reads.
//
// Until 2026-09-17 three pure modules invented terms the GC never stated:
// clientEstimateView.defaultPaymentSchedule printed a 10% deposit on every
// proposal, and the two tier builders (proposalBuilder, instantBid) promised a
// 1-, 2- and 5-year workmanship warranty on the Good/Better/Best ladder. The
// founder's decision: every tier prints the ONE warranty he saved, or
// "Workmanship warranty" with no period until he sets one.
{
  const ROOT = fileURLToPath(new URL('..', import.meta.url));
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
  // Comments explain the history and name the retired literals on purpose;
  // the checks below are about code, so strip them first.
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  const cev = code(read('utils/clientEstimateView.ts'));
  assert(!/defaultPaymentSchedule/.test(cev), 'clientEstimateView exports no defaultPaymentSchedule (the invented 10% deposit)');
  assert(!/export\s+function\s+\w*[Ss]chedule\w*\s*\(/.test(cev), 'clientEstimateView exports no payment-schedule builder at all');
  assert(!/\*\s*0?\.1\b|Due on signing|\b10%/.test(cev), 'clientEstimateView has no deposit multiplier or deposit copy');
  assert(/export interface PaymentMilestone\b/.test(cev), '…but still exports the PaymentMilestone type its importers need');

  // No file anywhere in the app imports or calls the retired builder.
  const offenders: string[] = [];
  const walkDir = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walkDir(full); continue; }
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const src = readFileSync(full, 'utf8');
      // A real import clause or a real call. Validators that ASSERT its absence
      // mention the name inside regex literals — `defaultPaymentSchedule\(` has
      // a backslash before the paren and sits in no `import { … } from` clause,
      // so they don't count; nor does prose "defaultPaymentSchedule (the …)"
      // in an assert message. (No comment stripping here: a regex literal
      // containing `/*` would swallow half a validator.)
      const imported = [...src.matchAll(/\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)]
        .some(m => /\bdefaultPaymentSchedule\b/.test(m[1]));
      const called = src.split('\n').some(l => !/^\s*(\/\/|\*)/.test(l) && /\bdefaultPaymentSchedule\(/.test(l));
      if (imported || called) offenders.push(relative(ROOT, full));
    }
  };
  for (const d of ['app', 'utils', 'components', 'scripts', 'contexts', 'hooks']) walkDir(join(ROOT, d));
  assert(offenders.length === 0, `nothing imports or calls defaultPaymentSchedule${offenders.length ? ` (found in ${offenders.join(', ')})` : ''}`);

  // A warranty/guarantee line that names ANY period.
  const PERIOD = /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)[\s-]*(yr|yrs|year|years|month|months|mo)\b/i;
  const WARRANTY = /warrant|guarantee/i;

  // Executed: buildProposalTiers with his 24 months.
  const leads: { stage: 'won' | 'lost'; lostReason?: string }[] = [];
  const withTerm = buildProposalTiers({ cost: 100000, leads, typicalMarkup: 0.2, warrantyMonths: 24 });
  assert(withTerm.tiers.length === 3, 'buildProposalTiers builds three tiers');
  for (const t of withTerm.tiers) {
    const w = t.inclusions.filter(i => WARRANTY.test(i));
    assert(w.length === 1 && w[0] === 'Workmanship warranty (2 years)',
      `${t.label}: exactly one warranty line, his "Workmanship warranty (2 years)" (got ${JSON.stringify(w)})`);
  }
  // Nothing else in any tier names a different warranty period.
  const otherPeriods = withTerm.tiers.flatMap(t => t.inclusions)
    .filter(i => WARRANTY.test(i) && i !== 'Workmanship warranty (2 years)');
  assert(otherPeriods.length === 0, `no tier carries another warranty period (got ${JSON.stringify(otherPeriods)})`);
  assert(withTerm.tiers.every(t => !WARRANTY.test(t.tagline)), 'no tier tagline mentions a warranty');
  // A period promised WITHOUT the word warranty ("10-year structural
  // coverage") slipped past the WARRANTY-keyed checks above. Every inclusion
  // on every tier that names a period must be his warranty line or the one
  // allow-listed service visit — for his term and for no term at all.
  const PERIOD_ALLOWED = new Set(['Six-month post-completion walkthrough']);
  for (const [label, months] of [['24 months', 24], ['never answered', null]] as const) {
    const r = buildProposalTiers({ cost: 100000, leads, warrantyMonths: months });
    const stray = r.tiers.flatMap(t => t.inclusions)
      .filter(i => PERIOD.test(i) && !PERIOD_ALLOWED.has(i) && !/^Workmanship warranty( \(.+\))?$/.test(i));
    assert(stray.length === 0, `warrantyMonths ${label}: no tier inclusion promises another period in other words (got ${JSON.stringify(stray)})`);
  }

  // Executed: 18 months prints as months, not rounded to a year.
  const eighteen = buildProposalTiers({ cost: 100000, leads, warrantyMonths: 18 });
  assert(eighteen.tiers.every(t => t.inclusions.includes('Workmanship warranty (18 months)')),
    'an 18-month warranty prints "(18 months)" on every tier');

  // Executed: never answered (absent and null) — the line has no period.
  for (const [label, input] of [
    ['absent', { cost: 100000, leads }],
    ['null', { cost: 100000, leads, warrantyMonths: null }],
    ['out of bounds (0)', { cost: 100000, leads, warrantyMonths: 0 }],
  ] as const) {
    const r = buildProposalTiers(input);
    const lines = r.tiers.flatMap(t => t.inclusions).filter(i => WARRANTY.test(i));
    assert(lines.length === 3 && lines.every(i => i === 'Workmanship warranty'),
      `warrantyMonths ${label}: every tier prints "Workmanship warranty" with no period (got ${JSON.stringify(lines)})`);
    const share = proposalToShareText({
      id: 'p', createdAt: '2026-09-17T00:00:00.000Z', updatedAt: '2026-09-17T00:00:00.000Z',
      status: 'draft', cost: r.cost, tiers: r.tiers,
    } as unknown as Parameters<typeof proposalToShareText>[0]);
    const periodLines = share.split('\n').filter(l => WARRANTY.test(l) && PERIOD.test(l));
    assert(periodLines.length === 0, `warrantyMonths ${label}: the share text names no warranty period (got ${JSON.stringify(periodLines)})`);
  }

  // instantBid imports mageAI (network), so its tier ladder is checked by source.
  const ib = read('utils/instantBid.ts');
  const ibCode = code(ib);
  const extras = ibCode.match(/const TIER_EXTRAS[\s\S]*?\n\};/)?.[0] ?? '';
  assert(extras.length > 0, 'instantBid still declares TIER_EXTRAS (source shape the checks below read)');
  assert(!/\(\s*\d+\s*yrs?\s*\)/i.test(extras) && !WARRANTY.test(extras),
    'instantBid TIER_EXTRAS carries no warranty line and no "(1 yr)" / "(2 yr)" / "(5 yr)"');
  const buildTier = ibCode.match(/function buildTier\([\s\S]*?\n\}/)?.[0] ?? '';
  assert(/inclusions:\s*\[[^\n]*workmanshipWarrantyLine\(\s*warrantyMonths\s*\)\s*\]/.test(buildTier),
    'instantBid buildTier appends workmanshipWarrantyLine(warrantyMonths) to every tier');
  assert(/buildTier\([^)]*opts\.warrantyMonths\s*\?\?\s*null/.test(ibCode),
    'generateInstantBid passes opts.warrantyMonths into buildTier');
  const heur = ibCode.match(/function heuristicMessage\([\s\S]*?\n\}/)?.[0] ?? '';
  assert(heur.length > 0 && !/start within|weeks?\b|availability/i.test(heur),
    'instantBid heuristicMessage promises no start window the GC never gave');
  const meta = ibCode.match(/const TIER_META[\s\S]*?\n\};/)?.[0] ?? '';
  const taglines = [...meta.matchAll(/tagline:\s*'([^']*)'/g)].map(m => m[1]);
  assert(taglines.length === 3 && taglines.every(t => !WARRANTY.test(t)), `no instantBid tagline mentions a warranty (got ${JSON.stringify(taglines)})`);
  assert(taglines.includes('Upgraded materials and finishes.'), 'the Premium tagline is "Upgraded materials and finishes."');
  assert(/Do not state any warranty period, deposit, or payment terms/.test(ib),
    'the AI cover-message prompt forbids inventing a warranty period, deposit or payment terms');
  const pb = code(read('utils/proposalBuilder.ts'));
  assert(!/\d+-year workmanship guarantee/i.test(pb), 'proposalBuilder names no N-year workmanship guarantee');

  // The three callers pass his saved months, resolved one way.
  for (const [file, call] of [
    ['app/smart-proposal.tsx', 'buildProposalTiers'],
    ['components/InstantBidProposalModal.tsx', 'generateInstantBid'],
    ['app/submit-bid-response.tsx', 'generateInstantBid'],
  ] as const) {
    const src = code(read(file));
    assert(/import\s*\{[^}]*\bresolveWarrantyMonths\b[^}]*\}\s*from\s*'@\/utils\/paymentTerms'/.test(src),
      `${file} imports resolveWarrantyMonths from utils/paymentTerms`);
    const direct = new RegExp(`${call}\\([\\s\\S]*?warrantyMonths:\\s*resolveWarrantyMonths\\(\\s*settings\\s*\\)`).test(src);
    const viaLocal = /const\s+warrantyMonths\s*=\s*resolveWarrantyMonths\(\s*settings\s*\)/.test(src)
      && new RegExp(`${call}\\(\\{[\\s\\S]*?\\bwarrantyMonths\\b[,\\s]`).test(src);
    assert(direct || viaLocal, `${file} passes resolveWarrantyMonths(settings) into ${call}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
