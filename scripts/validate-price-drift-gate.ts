// scripts/validate-price-drift-gate.ts
//
// Roadmap T2 (ideas-1 lane TRUST): the stale-price check at SEND and SIGN, and
// the "Prices valid until" date. Pure — no React, no storage, no network.
//
//   1. driftLineText / driftSummaryText: cents, sign, one-decimal percent,
//      M/D date, unit words, vendor clause only when there is one.
//   2. driftAtSend: Kept lines hidden; unread input → null (never an empty
//      "no drift"); read + nothing moved → a result with no lines; the one
//      project is checked in any status; totals are repriceEstimate's own.
//   3. estimateDrift's new includeProjectIds option: default output is
//      byte-identical to the base implementation for a fixture (golden JSON
//      captured from 64d397af), and an in-progress project is checked only
//      when asked.
//   4. utils/proposalValidity: +30 calendar days across a month end, a year
//      end and both US DST changes (run under America/New_York); the lines;
//      isExpired on the day itself and the day after.
//   5. proposalToShareText: a record without validUntil prints byte-for-byte
//      what 64d397af printed (goldens); with it, one line above the licence.
//   6. The share token: round trip with and without `valid`, an old token
//      parses, a malformed date is dropped (the proposal still opens).
//   7. Wiring: the screen and the check render what these functions return.
//
// Exits non-zero on any failure.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { LinkedEstimate, LinkedEstimateItem, MaterialReceipt, MaterialReceiptLine, Project } from '../types';
import { estimateDrift, keptKeyFor, repriceEstimate, type DriftFinding } from '../utils/receiptPriceWatch';
import { driftAtSend, driftLineText, driftSummaryText, keptKeysFor, monthDay, unitWord } from '../utils/priceDriftGate';
import {
  DEFAULT_VALID_DAYS, defaultValidUntil, expiredValidityLine, isCalendarDay, isExpired, validUntilLine,
} from '../utils/proposalValidity';
import { buildQuickQuote, proposalToShareText, type SmartProposal } from '../utils/proposalBuilder';
import { buildClientEstimateSharePayload, decodeClientEstimateToken, encodeClientEstimateToken } from '../utils/clientEstimateShareToken';
import { toClientEstimateView } from '../utils/clientEstimateView';

// Every date check runs on New York's calendar, DST changes included (Date
// reads TZ at call time, so setting it here, before any check, is enough).
process.env.TZ = 'America/New_York';

let passed = 0;
let failed = 0;
function assert(cond: boolean, label: string): void {
  if (cond) { console.log(`  PASS ${label}`); passed++; } else { console.error(`  FAIL ${label}`); failed++; }
}
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

// ── Fixtures (shared by the golden checks below) ──
let lineSeq = 0;
function rline(description: string, unit: string, quantity: number, unitPrice: number): MaterialReceiptLine {
  lineSeq++;
  return { id: `l${lineSeq}`, description, unit, quantity, unitPrice, lineTotal: quantity * unitPrice };
}
function receipt(id: string, vendor: string, date: string, lines: MaterialReceiptLine[], status: MaterialReceipt['status'] = 'reviewed'): MaterialReceipt {
  return { id, projectId: 'p1', vendor, receiptDate: date, lines, subtotal: 0, total: 0, status, createdAt: `${date}T15:00:00.000Z`, updatedAt: `${date}T15:00:00.000Z` };
}
function item(o: Partial<LinkedEstimateItem>): LinkedEstimateItem {
  return { materialId: 'm', name: 'x', category: 'plumbing', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 0, supplier: '', ...o };
}
function footed(items: LinkedEstimateItem[], extraCents = 0): LinkedEstimate {
  const withTotals = items.map((it) => ({ ...it, lineTotal: Math.round(it.quantity * (it.usesBulk ? it.bulkPrice : it.unitPrice) * (1 + it.markup / 100) * 100) / 100 }));
  const base = Math.round(withTotals.reduce((s, it) => s + it.quantity * (it.usesBulk ? it.bulkPrice : it.unitPrice), 0) * 100);
  const grand = Math.round(withTotals.reduce((s, it) => s + it.lineTotal, 0) * 100) + extraCents;
  return { id: 'e1', items: withTotals, globalMarkup: 15, baseTotal: base / 100, markupTotal: (grand - base) / 100, grandTotal: grand / 100, createdAt: '2026-09-01' };
}
function project(id: string, status: Project['status'], est: LinkedEstimate | undefined): Project {
  return { id, name: `Job ${id}`, status, linkedEstimate: est } as unknown as Project;
}
const ITEMS = [
  item({ materialId: 'cu', name: 'Copper pipe', unit: 'lf', quantity: 600, unitPrice: 4.10, markup: 20 }),
  item({ materialId: 'pvc', name: 'PVC fitting', unit: 'ea', quantity: 120, unitPrice: 2.00, markup: 10 }),
  item({ materialId: 'ply', name: '1/2in CDX plywood', unit: 'sheet', quantity: 40, unitPrice: 60, bulkPrice: 50, usesBulk: true, markup: 15 }),
  item({ materialId: 'lab', name: 'Copper pipe', unit: 'lf', category: 'Plumbing labor', quantity: 10, unitPrice: 4.10 }),
];
const RECEIPTS: MaterialReceipt[] = [
  receipt('r1', 'Ferguson', '2026-09-12', [rline('Copper pipe', 'LF', 100, 4.40), rline('1/2in CDX plywood', 'sheet', 10, 54.00)]),
  receipt('r2', 'Ferguson', '2026-09-20', [rline('copper  pipe', 'lin ft', 100, 4.62)]),
  receipt('r3', '', '2026-09-21', [rline('PVC fitting', 'ea', 50, 1.70)]),
  receipt('r4', 'Yard D', '2026-09-25', [rline('Copper pipe', 'lf', 50, 3.00)], 'extracted'),
];
const PROJECTS: Project[] = [
  project('open', 'estimated', footed(ITEMS)),
  project('draft', 'draft', footed(ITEMS, 150000)),
  project('live', 'in_progress', footed(ITEMS)),
  project('done', 'completed', footed(ITEMS)),
  project('none', 'estimated', undefined),
];
const PROPOSAL_TIERED = {
  id: 'prop1', clientName: 'Dana Ruiz', projectName: 'Rivera kitchen', status: 'draft' as const,
  createdAt: '2026-09-28T12:00:00.000Z', updatedAt: '2026-09-28T12:00:00.000Z',
  tiers: [
    { key: 'essential' as const, label: 'Essential', tagline: 'The job done right.', price: 41234.5, markup: 0.12, winProbability: 0.6, expectedProfit: 1, inclusions: ['Full scope of work as discussed'], recommended: false },
    { key: 'signature' as const, label: 'Signature', tagline: 'Our most popular package.', price: 45678.9, markup: 0.18, winProbability: 0.5, expectedProfit: 1, inclusions: ['Everything in Essential'], recommended: true },
  ],
};
const QUICK_INPUT = { clientName: 'Dana Ruiz', jobTitle: 'Bath refresh', scope: 'Swap vanity', lineItems: [{ description: 'Vanity', amount: 1000 }, { description: 'Labor', amount: 1234.56 }], markupPct: 10, taxPct: 7 };

// Goldens captured from the base implementation (64d397af) on the fixtures
// above: estimateDrift's default output, and the share text of a record with
// no validUntil. A change to either default fails here.
const GOLDEN_DRIFT = "[{\"projectId\":\"open\",\"projectName\":\"Job open\",\"materialId\":\"cu\",\"itemName\":\"Copper pipe\",\"unit\":\"lf\",\"pricedUnitCents\":410,\"latestUnitCents\":462,\"latestReceiptId\":\"r2\",\"latestReceiptLineId\":\"l3\",\"latestVendor\":\"Ferguson\",\"latestDate\":\"2026-09-20\",\"pct\":12.7,\"deltaCents\":31200},{\"projectId\":\"open\",\"projectName\":\"Job open\",\"materialId\":\"ply\",\"itemName\":\"1/2in CDX plywood\",\"unit\":\"sheet\",\"pricedUnitCents\":5000,\"latestUnitCents\":5400,\"latestReceiptId\":\"r1\",\"latestReceiptLineId\":\"l2\",\"latestVendor\":\"Ferguson\",\"latestDate\":\"2026-09-12\",\"pct\":8,\"deltaCents\":16000},{\"projectId\":\"draft\",\"projectName\":\"Job draft\",\"materialId\":\"cu\",\"itemName\":\"Copper pipe\",\"unit\":\"lf\",\"pricedUnitCents\":410,\"latestUnitCents\":462,\"latestReceiptId\":\"r2\",\"latestReceiptLineId\":\"l3\",\"latestVendor\":\"Ferguson\",\"latestDate\":\"2026-09-20\",\"pct\":12.7,\"deltaCents\":31200},{\"projectId\":\"draft\",\"projectName\":\"Job draft\",\"materialId\":\"ply\",\"itemName\":\"1/2in CDX plywood\",\"unit\":\"sheet\",\"pricedUnitCents\":5000,\"latestUnitCents\":5400,\"latestReceiptId\":\"r1\",\"latestReceiptLineId\":\"l2\",\"latestVendor\":\"Ferguson\",\"latestDate\":\"2026-09-12\",\"pct\":8,\"deltaCents\":16000}]";
// 2026-10-05 copy lane 1: the three goldens below were re-typed for the copy style (no dash as
// punctuation, "Total:" not "TOTAL —"). Words, amounts, order and line breaks are as 64d397af printed them.
const GOLDEN_TIERED = "PROPOSAL: Rivera kitchen\nPrepared for Dana Ruiz\n\n──────────────────────\nESSENTIAL: $41,234.50\nThe job done right.\n  • Full scope of work as discussed\n\n──────────────────────\nSIGNATURE  ★ Most popular: $45,678.90\nOur most popular package.\n  • Everything in Essential\n\n──────────────────────\nLicensed contractor, License #12345\nEvery option is delivered by the same team. To move forward, just reply with the option that fits best.";
const GOLDEN_TIERED_NOLIC = "PROPOSAL: Rivera kitchen\nPrepared for Dana Ruiz\n\n──────────────────────\nESSENTIAL: $41,234.50\nThe job done right.\n  • Full scope of work as discussed\n\n──────────────────────\nSIGNATURE  ★ Most popular: $45,678.90\nOur most popular package.\n  • Everything in Essential\n\n──────────────────────\nEvery option is delivered by the same team. To move forward, just reply with the option that fits best.";
const GOLDEN_QUICK = "QUOTE: Bath refresh\nPrepared for Dana Ruiz\n\n──────────────────────\nSwap vanity\n  • Vanity: $1,100.00\n  • Labor: $1,358.02\n\nSubtotal: $2,458.02\nSales tax (7%): $172.06\n\nTotal: $2,630.08\n──────────────────────\nLicensed contractor, License #12345\nReply to accept this quote.";

const finding = (o: Partial<DriftFinding>): DriftFinding => ({
  projectId: 'p', projectName: 'Job p', materialId: 'cu', itemName: 'Copper pipe', unit: 'lf',
  pricedUnitCents: 410, latestUnitCents: 462, latestReceiptId: 'r2', latestReceiptLineId: 'l3',
  latestVendor: 'Ferguson', latestDate: '2026-09-20', pct: 12.7, deltaCents: 31200, ...o,
});

console.log('\n── 1. line and summary copy');
assert(driftLineText(finding({})) === 'Copper pipe: priced $4.10/ft, your 9/20 receipt from Ferguson says $4.62 (+12.7%), +$312.00 cost.',
  `the spec line, exactly (${driftLineText(finding({}))})`);
assert(driftLineText(finding({ latestVendor: '' })) === 'Copper pipe: priced $4.10/ft, your 9/20 receipt says $4.62 (+12.7%), +$312.00 cost.',
  'no vendor on the receipt → no "from" clause');
assert(driftLineText(finding({ latestVendor: '   ' })).includes('receipt says'), 'a blank vendor is no vendor');
{
  const down = driftLineText(finding({ itemName: 'PVC fitting', unit: 'ea', pricedUnitCents: 200, latestUnitCents: 170, pct: -15, deltaCents: -3600, latestDate: '2026-01-05' }));
  assert(down === 'PVC fitting: priced $2.00/ea, your 1/5 receipt from Ferguson says $1.70 (-15.0%), -$36.00 cost.', `a drop: minus sign, one decimal, M/D without zeros (${down})`);
}
{
  const big = driftLineText(finding({ itemName: '1/2in CDX plywood', unit: 'sheet', pricedUnitCents: 123456, latestUnitCents: 130000, pct: 5.3, deltaCents: 12345678 }));
  assert(big === '1/2in CDX plywood: priced $1,234.56/sheet, your 9/20 receipt from Ferguson says $1,300.00 (+5.3%), +$123,456.78 cost.', `thousands separators and cents (${big})`);
}
assert(unitWord('lf') === 'ft' && unitWord('LIN FT') === 'ft' && unitWord('sq ft') === 'sq ft' && unitWord('SF') === 'sq ft', 'unit words: lf → ft, SF / sq ft → sq ft');
assert(unitWord('Sheet') === 'sheet' && unitWord('') === 'unit' && unitWord(undefined) === 'unit' && unitWord('CY') === 'cu yd', 'unit words: as typed otherwise, blank → unit, CY → cu yd');
assert(monthDay('2026-09-20') === '9/20' && monthDay('2026-12-01') === '12/1', 'M/D from the calendar day');
assert(driftSummaryText(2, 48600) === "2 prices on this estimate are older than your latest receipts. +$486.00 cost at today's prices.",
  'the spec summary, exactly');
assert(driftSummaryText(1, -3600) === "1 price on this estimate is older than your latest receipt. -$36.00 cost at today's prices.",
  'one price: singular, signed cents');
assert(driftSummaryText(0, 0) === '', 'no lines → no summary');

console.log('\n── 2. driftAtSend');
const open = PROJECTS.find((p) => p.id === 'open')!;
const live = PROJECTS.find((p) => p.id === 'live')!;
{
  assert(driftAtSend(open, null, RECEIPTS, []) === null, 'projects unread → null');
  assert(driftAtSend(open, PROJECTS, null, []) === null, 'receipts unread → null');
  assert(driftAtSend(open, PROJECTS, RECEIPTS, null) === null, 'Keep memory unread → null');
  assert(driftAtSend(null, PROJECTS, RECEIPTS, []) === null, 'no project → null');

  const r = driftAtSend(open, PROJECTS, RECEIPTS, [])!;
  assert(!!r && r.lines.length === 2, `two drifted lines: copper and plywood; labor and unreviewed skipped (${r?.lines.map((l) => l.finding.materialId).join(',')})`);
  assert(r.lines[0].text === driftLineText(r.lines[0].finding), 'each line carries driftLineText of its finding');
  assert(r.lines[0].text === 'Copper pipe: priced $4.10/ft, your 9/20 receipt from Ferguson says $4.62 (+12.7%), +$312.00 cost.', `the fixture's copper line (${r.lines[0].text})`);
  assert(r.summary === "2 prices on this estimate are older than your latest receipts. +$472.00 cost at today's prices.", `summary (${r.summary})`);

  const est = open.linkedEstimate!;
  const ref = repriceEstimate(est, estimateDrift([open], RECEIPTS));
  assert(r.costDeltaCents === ref.costDeltaCents && r.sellDeltaCents === ref.sellDeltaCents, `deltas are repriceEstimate's own (${r.costDeltaCents}, ${r.sellDeltaCents})`);
  assert(r.grandBeforeCents === Math.round(est.grandTotal * 100) && r.grandAfterCents === Math.round(ref.next.grandTotal * 100),
    `totals to the cent: ${r.grandBeforeCents} → ${r.grandAfterCents}`);
  assert(JSON.stringify(r.next) === JSON.stringify(ref.next), 'next is exactly the estimate Reprice writes');
  assert(r.grandAfterCents - r.grandBeforeCents === r.sellDeltaCents, 'grand moves by the sell delta only');
  assert([r.costDeltaCents, r.sellDeltaCents, r.grandBeforeCents, r.grandAfterCents].every(Number.isInteger), 'money is integer cents');

  // Keep hides exactly the kept line.
  const copperKey = keptKeyFor(r.lines[0].finding);
  const k = driftAtSend(open, PROJECTS, RECEIPTS, new Set([copperKey]))!;
  assert(k.lines.length === 1 && k.lines[0].finding.materialId === 'ply', 'a Kept line stays hidden, the other still shows');
  assert(k.summary.startsWith('1 price on this estimate'), 'the summary counts visible lines only');
  const both = driftAtSend(open, PROJECTS, RECEIPTS, keptKeysFor(r))!;
  assert(!!both && both.lines.length === 0 && both.summary === '' && both.grandAfterCents === both.grandBeforeCents,
    'everything Kept → a read result with no lines (not null)');
  // A NEWER receipt line resurfaces a kept drift (the key names the receipt line).
  const newer = [...RECEIPTS, receipt('r9', 'Ferguson', '2026-09-26', [rline('Copper pipe', 'lf', 10, 4.80)])];
  const re = driftAtSend(open, PROJECTS, newer, [copperKey])!;
  assert(re.lines.some((l) => l.finding.materialId === 'cu' && l.finding.latestReceiptId === 'r9'), 'a newer receipt resurfaces a kept line');

  const none = driftAtSend(PROJECTS.find((p) => p.id === 'none')!, PROJECTS, RECEIPTS, [])!;
  assert(!!none && none.lines.length === 0 && none.next === null, 'no estimate → a read result with no lines');
  const empty = driftAtSend(open, PROJECTS, [], [])!;
  assert(!!empty && empty.lines.length === 0, 'no receipts (read) → no lines, not null');

  const lv = driftAtSend(live, PROJECTS, RECEIPTS, [])!;
  assert(lv.lines.length === 2, `an in-progress project being signed IS checked (${lv.lines.length})`);
  const fresher = { ...open, linkedEstimate: repriceEstimate(open.linkedEstimate!, estimateDrift([open], RECEIPTS)).next } as Project;
  const fr = driftAtSend(open, [fresher], RECEIPTS, [])!;
  assert(fr.lines.length === 0, 'the freshest copy in projects wins (already repriced → nothing to say)');
  assert(driftAtSend(open, PROJECTS, RECEIPTS, [], { minPct: 10 })!.lines.length === 1, 'minPct is passed through (8% plywood drops out at 10)');
}

console.log('\n── 3. estimateDrift includeProjectIds');
{
  assert(JSON.stringify(estimateDrift(PROJECTS, RECEIPTS)) === GOLDEN_DRIFT, 'default output is byte-identical to 64d397af for the fixture');
  assert(JSON.stringify(estimateDrift(PROJECTS, RECEIPTS, 5, {})) === GOLDEN_DRIFT, 'an empty options object changes nothing');
  assert(JSON.stringify(estimateDrift(PROJECTS, RECEIPTS, 5, { includeProjectIds: [] })) === GOLDEN_DRIFT, 'an empty include list changes nothing');
  assert(estimateDrift([live], RECEIPTS).length === 0, "an 'in_progress' project is not checked by default");
  assert(estimateDrift([live], RECEIPTS, 5, { includeProjectIds: ['live'] }).length === 2, '…and is checked when named');
  assert(estimateDrift([live], RECEIPTS, 5, { includeProjectIds: ['other'] }).length === 0, '…only when it is the one named');
  const withLive = estimateDrift(PROJECTS, RECEIPTS, 5, { includeProjectIds: ['live'] });
  assert(withLive.filter((d) => d.projectId === 'done').length === 0 && withLive.filter((d) => d.projectId === 'live').length === 2,
    'naming one project widens only that project (a completed one is still skipped)');
}

console.log('\n── 4. proposalValidity');
{
  assert(DEFAULT_VALID_DAYS === 30, 'default is 30 days');
  assert(defaultValidUntil('2026-09-28') === '2026-10-28', `Sep 28 → Oct 28 (${defaultValidUntil('2026-09-28')})`);
  assert(defaultValidUntil('2026-01-31') === '2026-03-02', `across a month end: Jan 31 → Mar 2 (${defaultValidUntil('2026-01-31')})`);
  assert(defaultValidUntil('2026-12-15') === '2027-01-14', `across a year end (${defaultValidUntil('2026-12-15')})`);
  assert(defaultValidUntil('2026-10-20') === '2026-11-19', `across the November DST change (${defaultValidUntil('2026-10-20')})`);
  assert(defaultValidUntil('2026-03-01') === '2026-03-31', `across the March DST change (${defaultValidUntil('2026-03-01')})`);
  assert(defaultValidUntil('2028-02-10') === '2028-03-11', `a leap February (${defaultValidUntil('2028-02-10')})`);
  assert(defaultValidUntil('nope') === null && defaultValidUntil('2026-02-30') === null, 'not a calendar day → null');
  assert(isCalendarDay('2026-10-28') && !isCalendarDay('2026-10-28T12:00:00.000Z') && !isCalendarDay('2026-13-01') && !isCalendarDay(20261028),
    'isCalendarDay: exact YYYY-MM-DD real days only');
  assert(validUntilLine('2026-10-28') === 'Prices valid until Oct 28, 2026.', `the line (${validUntilLine('2026-10-28')})`);
  assert(validUntilLine(undefined) === null && validUntilLine('garbage') === null, 'no or bad date → no line');
  assert(!isExpired('2026-10-28', '2026-10-28'), 'the valid-until day itself is still valid');
  assert(isExpired('2026-10-28', '2026-10-29'), 'the day after, it has passed');
  assert(!isExpired('2026-10-28', '2026-09-28') && !isExpired('bad', '2026-10-29'), 'before it, or a bad value → not expired');
  assert(expiredValidityLine('2026-10-28', 'Acme Builders') === 'These prices were valid until Oct 28, 2026. Ask Acme Builders to confirm them before you go ahead.',
    'expired line names the contractor');
  assert(expiredValidityLine('2026-10-28', '  ') === 'These prices were valid until Oct 28, 2026. Ask your contractor to confirm them before you go ahead.',
    "…or 'your contractor' when the link carries no name");
  const lib = read('utils/proposalValidity.ts').replace(/\/\/.*$/gm, '');
  assert(!/Date\.now\(|new Date\(|getTime\(\)/.test(lib), 'proposalValidity reads no clock and does no ms arithmetic');
  assert(!/volatil/i.test(lib), 'no volatility-derived date anywhere in the code');
}

console.log('\n── 5. proposalToShareText');
{
  const base = PROPOSAL_TIERED as SmartProposal;
  assert(proposalToShareText(base, { licenseNumber: '12345' }) === GOLDEN_TIERED, 'tiered, no validUntil: byte-identical to 64d397af');
  assert(proposalToShareText(base) === GOLDEN_TIERED_NOLIC, 'tiered, no validUntil, no licence: byte-identical');
  const withV = proposalToShareText({ ...base, validUntil: '2026-10-28' }, { licenseNumber: '12345' });
  assert(withV === GOLDEN_TIERED.replace('Licensed contractor', 'Prices valid until Oct 28, 2026.\nLicensed contractor'),
    'tiered with validUntil: one line, just above the licence line');
  const noLicV = proposalToShareText({ ...base, validUntil: '2026-10-28' });
  assert(noLicV === GOLDEN_TIERED_NOLIC.replace('Every option', 'Prices valid until Oct 28, 2026.\nEvery option'), 'no licence: the line sits above the closing sentence');
  assert(proposalToShareText({ ...base, validUntil: 'soon' }, { licenseNumber: '12345' }) === GOLDEN_TIERED, 'a malformed validUntil prints nothing');

  const q = { ...buildQuickQuote(QUICK_INPUT), id: 'q1', createdAt: 'x', updatedAt: 'x' };
  assert(!('validUntil' in q), 'buildQuickQuote without validUntil adds no field');
  assert(proposalToShareText(q, { licenseNumber: '12345' }) === GOLDEN_QUICK, 'quick quote, no validUntil: byte-identical to 64d397af');
  const qv = { ...buildQuickQuote({ ...QUICK_INPUT, validUntil: '2026-10-28' }), id: 'q1', createdAt: 'x', updatedAt: 'x' };
  assert(qv.validUntil === '2026-10-28', 'buildQuickQuote carries validUntil');
  assert(proposalToShareText(qv, { licenseNumber: '12345' }) === GOLDEN_QUICK.replace('Licensed contractor', 'Prices valid until Oct 28, 2026.\nLicensed contractor'),
    'quick quote with validUntil: one line above the licence line');
  assert(!('validUntil' in buildQuickQuote({ ...QUICK_INPUT, validUntil: '2026-10-28T12:00:00.000Z' })), 'buildQuickQuote drops a value that is not a calendar day');
}

console.log('\n── 6. share token');
{
  const est: LinkedEstimate = footed([item({ materialId: 'a', name: 'Framing', unit: 'ea', quantity: 1, unitPrice: 1000 })]);
  const view = toClientEstimateView(est);
  const withValid = buildClientEstimateSharePayload(view, { projectName: 'Kitchen', gcName: 'Acme Builders', validThrough: '2026-10-28' });
  const rt = decodeClientEstimateToken(encodeClientEstimateToken(withValid));
  assert(!!rt && rt.valid === '2026-10-28' && JSON.stringify(rt) === JSON.stringify(withValid), 'with a valid-until day: round-trips exactly');
  const without = buildClientEstimateSharePayload(view, { projectName: 'Kitchen' });
  const rt2 = decodeClientEstimateToken(encodeClientEstimateToken(without));
  assert(!!rt2 && rt2.valid === undefined && JSON.stringify(rt2) === JSON.stringify(without), 'without one: round-trips, no valid field');
  const old = decodeClientEstimateToken(encodeClientEstimateToken({ v: 1, n: 'Old', total: 100, scope: [] }));
  assert(!!old && old.n === 'Old', 'a link minted before any of this still opens');
  const crafted = decodeClientEstimateToken(encodeClientEstimateToken({ v: 1, n: 'X', total: 100, scope: [], valid: '<b>tomorrow</b>' }));
  assert(!!crafted && crafted.valid === undefined && crafted.n === 'X', 'a crafted date is dropped; the proposal still opens');
  const instant = buildClientEstimateSharePayload(view, { projectName: 'Kitchen', validThrough: '2026-10-28T12:00:00.000Z' });
  assert(instant.valid === undefined, 'the builder drops a value that is not a calendar day');
}

console.log('\n── 7. wiring');
{
  const shared = read('app/shared-estimate.tsx');
  assert(/isExpired\(payload\.valid, todayCalendarDay\(\)\)/.test(shared), "shared-estimate compares the date with today's calendar day on the device");
  assert(/expiredValidityLine\(payload\.valid, payload\.gc\)/.test(shared), '…and prints expiredValidityLine with the contractor name once it has passed');
  const check = read('components/priceWatch/PriceDriftCheck.tsx');
  assert(/driftAtSend\(project, projects, receipts, kept\)/.test(check), 'PriceDriftCheck reads driftAtSend');
  assert(/loaded && project \?/.test(check) && /projectsLoaded/.test(check) && /isLoading !== true/.test(check) && /kept !== null/.test(check),
    'the hook returns check = null until projects, receipts and Keep memory are all read');
  assert(/updateProject\(base\.id, commitEstimatePatch\(base, check\.next, \{ reason: 'manual', note: 'Repriced from your receipts' \}\)\)/.test(check),
    "Reprice is PriceWatchCard's exact write (commitEstimatePatch, reason manual)");
  assert(/PRICE_WATCH_KEPT_KEY/.test(check) && /try \{[\s\S]{0,200}AsyncStorage\.setItem\(PRICE_WATCH_KEPT_KEY/.test(check), 'Keep writes PRICE_WATCH_KEPT_KEY inside try/catch');
  for (const id of ['pricewatch-drift-card', 'pricewatch-drift-sheet', 'pricewatch-drift-reprice', 'pricewatch-drift-keep', 'pricewatch-drift-continue']) {
    assert(check.includes(`testID="${id}"`), `testID ${id}`);
  }
  assert(check.includes("'Sign at These Prices'") && check.includes("'Send Anyway'") && check.includes('"Reprice to Today\'s Receipts"') && check.includes('"Keep These Prices"'),
    'the four button labels');
  assert(!/supabase|sendEmail|shareText|setContractStatus|onSign\b/.test(check.replace(/\/\/.*$/gm, '')), 'the check sends and signs nothing');
  const gate = read('utils/priceDriftGate.ts');
  assert(!/Date\.now\(|new Date\(/.test(gate), 'priceDriftGate reads no clock');
  // TRUST-2, landed in the wave-next W2 integration: the contract's check sits
  // in the signing sheet itself, in the SigningCeremony's `above` slot.
  const contract = read('app/contract.tsx');
  const press = contract.slice(contract.indexOf('const handleSignPress = useCallback('), contract.indexOf('const handleSignTogetherPress = useCallback('));
  const termsAt = press.indexOf("askContractTerms({ terms: needsTerms, warranty: needsWarranty }, 'review');");
  const driftAt = press.indexOf('setDriftAsk(!!drift && drift.lines.length > 0);');
  const modeAt = press.indexOf('const mode = pendingSignModeRef.current;');
  assert(termsAt > 0 && driftAt > termsAt && modeAt > driftAt,
    'contract: the sign press decides the price check after the lock and missing-terms asks, before the mode is consumed');
  assert(/const priceDrift = usePriceDriftAtSend\(project\?\.linkedEstimate \? project\.id : null\);/.test(contract)
    && /driftCheckRef\.current = priceDrift\.check;/.test(contract), 'contract: the check reads the project\'s linked estimate (unread = no card, never a held signature)');
  assert(/above=\{driftAsk && contract\?\.status === 'draft' \? \(\s*<PriceDriftCheck\s+project=\{project\}\s+presentation="card"\s+action="sign"/.test(contract)
    && /onKeep=\{continueSignPastDrift\}\s+onContinue=\{continueSignPastDrift\}/.test(contract),
    'contract: the card (action sign) is the signing sheet\'s `above`, and "Keep" / "Sign at these prices" clear it');
  assert(/recordFrom=\{recordFrom\}\s+above=\{above\}/.test(contract), 'contract: SignatureModal hands `above` to the SigningCeremony');
  const reprice = contract.slice(contract.indexOf('const handleDriftRepriced = useCallback('), contract.indexOf('}, [handleValueChange]);'));
  assert(/Math\.round\(\(c\.contractValue \?\? 0\) \* 100\) === r\.grandBeforeCents/.test(reprice) && !/setSignatureModal|handleSignAndSend|onSign/.test(reprice),
    'contract: Reprice moves the contract value only while it still equals the old estimate total (cents), and signs nothing');
  const field = read('components/proposal/ValidUntilField.tsx');
  assert(/DatePickerModal/.test(field) && /defaultValidUntil\(/.test(field) && /allowFuture/.test(field), 'ValidUntilField: the app picker, future allowed, 30-day default');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
