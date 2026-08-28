// validate-supplier-scorecard.ts — pins what the app may and may not say about
// a supplier.
//
// WHY THIS EXISTS. This module produces a letter grade a GC might quote at a
// buyout table, or use to drop a vendor. That makes every generous assumption
// expensive. The failure modes worth guarding are all of the same shape — the
// app claiming to know something it does not:
//
//   • grading a supplier off one or two deliveries (that is luck, not a record)
//   • counting an UNINSPECTED load as damage-free, which would reward exactly
//     the loads nobody checked
//   • returning 0 when there is no evidence — a 0 renders as an F, and "we have
//     never measured them" is not the same as "they are terrible"
//   • letting an early delivery cancel out a late one, when a slip has already
//     cost a crew a day that an early load does not give back
//
// Run via: bun run test:supplier-scorecard

import {
  computeSupplierScorecards, summarizeSuppliers, slipDays,
  MIN_DELIVERIES_TO_SCORE, MIN_RECEIPTS_TO_SCORE, BADLY_LATE_DAYS,
  W_ON_TIME,
} from '../utils/supplierScorecard';
import type { Delivery } from '../utils/deliverySchedule';

let failures = 0;
function check(label: string, cond: boolean) {
  if (!cond) { console.error(`  FAIL: ${label}`); failures++; }
}

let seq = 0;
/** A settled delivery promised on `promised`, delivered `slip` days later. */
const del = (supplier: string, promised: string, slip: number | null, over: Partial<Delivery> = {}): Delivery => {
  seq += 1;
  const base: Delivery = {
    id: `d${seq}`, projectId: 'p1', description: 'material', supplier,
    expectedDate: promised, status: 'delivered',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    confirmedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
  if (slip !== null) {
    const d = new Date(`${promised}T12:00:00`);
    d.setDate(d.getDate() + slip);
    base.deliveredAt = d.toISOString();
  }
  return base;
};

const cardFor = (cards: ReturnType<typeof computeSupplierScorecards>, name: string) =>
  cards.find(c => c.supplierKey === name.toLowerCase());

// ── slipDays ────────────────────────────────────────────────────────────────
{
  check('on-time delivery slips 0', slipDays(del('Acme', '2026-03-02', 0)) === 0);
  check('two days late slips 2', slipDays(del('Acme', '2026-03-02', 2)) === 2);
  check('early delivery slips negative', slipDays(del('Acme', '2026-03-02', -3)) === -3);
  check('an undelivered load has no slip',
    slipDays(del('Acme', '2026-03-02', null, { status: 'scheduled' })) === null);
  check('delivered with no deliveredAt has no slip',
    slipDays(del('Acme', '2026-03-02', null)) === null);
}

// ── refuses to grade thin history ───────────────────────────────────────────
{
  const thin = computeSupplierScorecards({
    deliveries: [del('Acme', '2026-03-02', 5), del('Acme', '2026-03-09', 4)],
  });
  const c = cardFor(thin, 'Acme');
  check('a supplier with 2 deliveries still gets a card', !!c);
  // Two catastrophic slips would be an F if we scored it. We do not.
  check('…but NO score — two deliveries is luck, not a record', c?.score === null);
  check('…and no grade', c?.grade === null);
  check('…confidence is low', c?.confidence === 'low');
  check('…and the card says why', !!c?.topDriver.includes(`need ${MIN_DELIVERIES_TO_SCORE}`));
  check('threshold is 3', MIN_DELIVERIES_TO_SCORE === 3);
}

// ── an uninspected load is not a clean load ─────────────────────────────────
{
  // 4 deliveries, ZERO receipts. The damage factor must sit out entirely rather
  // than score a perfect 1.0 for loads nobody ever opened.
  const noReceipts = computeSupplierScorecards({
    deliveries: [
      del('Acme', '2026-03-02', 0), del('Acme', '2026-03-09', 0),
      del('Acme', '2026-03-16', 0), del('Acme', '2026-03-23', 0),
    ],
  });
  const c = cardFor(noReceipts, 'Acme')!;
  const dmg = c.factors.find(f => f.key === 'damage_free')!;
  check('damage factor is NOT applicable with no receipts', dmg.applicable === false);
  check('…contributes zero weight', dmg.weight === 0);
  check('…so a perfect on-time record still scores 100', c.score === 100);
  check('…and the detail explains the gap', dmg.detail.includes(`need ${MIN_RECEIPTS_TO_SCORE}`));

  // One damaged load out of one is a bad Tuesday, not a 0% clean rate.
  const oneReceipt = computeSupplierScorecards({
    deliveries: noReceipts.length ? [
      del('Acme', '2026-03-02', 0), del('Acme', '2026-03-09', 0), del('Acme', '2026-03-16', 0),
    ] : [],
    receipts: [{ supplier: 'Acme', hasDamage: true }],
  });
  check('a single damaged receipt does not score the damage factor',
    cardFor(oneReceipt, 'Acme')!.factors.find(f => f.key === 'damage_free')!.applicable === false);
}

// ── early does not cancel late ──────────────────────────────────────────────
{
  // 3 days early once, 3 days late once, on time once. The late load cost a crew
  // a day the early one did not give back, so this must NOT read as perfect.
  const mixed = computeSupplierScorecards({
    deliveries: [
      del('Acme', '2026-03-02', -3), del('Acme', '2026-03-09', 3), del('Acme', '2026-03-16', 0),
    ],
  });
  const c = cardFor(mixed, 'Acme')!;
  check('an early load does not offset a late one', (c.score ?? 100) < 100);
  check('lateCount counts only genuine slips', c.lateCount === 1);
  check('avgSlipDays averages LATE loads only, not all', c.avgSlipDays === 3);
}

// ── badly late scores zero for that delivery, not negative ──────────────────
{
  const awful = computeSupplierScorecards({
    deliveries: [
      del('Acme', '2026-03-02', BADLY_LATE_DAYS * 4),
      del('Acme', '2026-03-09', 0), del('Acme', '2026-03-16', 0),
    ],
  });
  const onTime = cardFor(awful, 'Acme')!.factors.find(f => f.key === 'on_time')!;
  // Two clean of three ⇒ 2/3, floored at 0 for the disaster. A negative
  // contribution would let one load erase an otherwise good record.
  check('a catastrophic slip floors at 0 for that delivery, not below',
    Math.abs(onTime.score - 2 / 3) < 0.001);
  check('on_time carries the dominant weight', onTime.weight === W_ON_TIME);
}

// ── unconfirmed dates are scored, in-flight loads are not ───────────────────
{
  const quiet = computeSupplierScorecards({
    deliveries: [
      del('Mute', '2026-03-02', 0, { confirmedAt: undefined }),
      del('Mute', '2026-03-09', 0, { confirmedAt: undefined }),
      del('Mute', '2026-03-16', 0, { confirmedAt: undefined }),
    ],
  });
  const conf = cardFor(quiet, 'Mute')!.factors.find(f => f.key === 'confirmation')!;
  check('never confirming scores 0 on confirmation', conf.score === 0);
  check('…and it is applicable', conf.applicable === true);
  check('perfect on-time but silent still loses points', (cardFor(quiet, 'Mute')!.score ?? 100) < 100);

  // A load still in flight must not be held against them yet.
  const inFlight = computeSupplierScorecards({
    deliveries: [
      del('Acme', '2026-03-02', 0), del('Acme', '2026-03-09', 0), del('Acme', '2026-03-16', 0),
      del('Acme', '2026-04-01', null, { status: 'scheduled', confirmedAt: undefined }),
    ],
  });
  check('an in-flight unconfirmed load does not drag confirmation',
    cardFor(inFlight, 'Acme')!.factors.find(f => f.key === 'confirmation')!.score === 1);
  check('…and does not count as settled', cardFor(inFlight, 'Acme')!.settledCount === 3);
}

// ── grouping, naming, ordering ──────────────────────────────────────────────
{
  const cards = computeSupplierScorecards({
    deliveries: [
      del('acme  glass', '2026-03-02', 0), del('ACME GLASS', '2026-03-09', 0),
      del('Acme Glass', '2026-03-16', 6),
      del('Volt', '2026-03-02', 0), del('Volt', '2026-03-09', 0), del('Volt', '2026-03-16', 0),
    ],
  });
  check('spelling and case variants fold into one supplier', cards.length === 2);
  check('…keeping the most recent spelling', cardFor(cards, 'acme glass')!.supplier === 'Acme Glass');
  check('worst score leads', cards[0].supplierKey === 'acme glass');

  const withUnscored = computeSupplierScorecards({
    deliveries: [...[0, 1, 2].map(i => del('Volt', `2026-03-0${i + 2}`, 0)), del('New Co', '2026-03-02', 0)],
  });
  // "Never measured" is not good news, but burying a measured D under it would
  // hide the actual finding.
  check('unscored suppliers sort last', withUnscored[withUnscored.length - 1].supplierKey === 'new co');
}

// ── receipts only attach to known suppliers ─────────────────────────────────
{
  const cards = computeSupplierScorecards({
    deliveries: [del('Acme', '2026-03-02', 0), del('Acme', '2026-03-09', 0), del('Acme', '2026-03-16', 0)],
    receipts: [
      { supplier: 'Acme', hasDamage: false }, { supplier: 'Acme', hasDamage: true },
      { supplier: 'Acme', hasDamage: false },
      { supplier: 'Ghost Supply', hasDamage: true },
    ],
  });
  check('a receipt from an unknown supplier does not mint a card', cards.length === 1);
  const c = cardFor(cards, 'Acme')!;
  check('receipts counted', c.receiptCount === 3 && c.damagedCount === 1);
  const dmg = c.factors.find(f => f.key === 'damage_free')!;
  check('damage factor applies at 3 receipts', dmg.applicable === true);
  check('…scoring 2/3 clean', Math.abs(dmg.score - 2 / 3) < 0.001);
}

// ── confidence ladder + summary ─────────────────────────────────────────────
{
  const many = computeSupplierScorecards({
    deliveries: Array.from({ length: 8 }, (_, i) => del('Acme', `2026-03-${String(i + 1).padStart(2, '0')}`, 0)),
  });
  check('8 settled deliveries earns high confidence', cardFor(many, 'Acme')!.confidence === 'high');
  check('summary says nobody is late when nobody is',
    /none running late/.test(summarizeSuppliers(many) ?? ''));

  const late = computeSupplierScorecards({
    deliveries: [del('Acme', '2026-03-02', 4), del('Acme', '2026-03-09', 4), del('Acme', '2026-03-16', 0)],
  });
  check('summary names the worst supplier', !!summarizeSuppliers(late)?.includes('Acme'));
  check('no measurable suppliers → no summary line',
    summarizeSuppliers(computeSupplierScorecards({ deliveries: [] })) === null);
}

// ── empty / malformed ───────────────────────────────────────────────────────
{
  check('no deliveries → no cards', computeSupplierScorecards({ deliveries: [] }).length === 0);
  check('a blank supplier name is skipped, not grouped under ""',
    computeSupplierScorecards({ deliveries: [del('   ', '2026-03-02', 0)] }).length === 0);
}

if (failures > 0) {
  console.error(`\n✗ validate-supplier-scorecard: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('✓ validate-supplier-scorecard: all checks passed');
