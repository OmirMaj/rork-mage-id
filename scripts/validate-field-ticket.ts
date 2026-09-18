// validate-field-ticket.ts — pins the T&M / extra-work field ticket.
//
// WHY: unbilled extra work is the single largest source of lost revenue for a
// GC. The whole feature rests on four claims, and every one of them is a place
// where a quiet bug costs real money:
//
//   1. The totals are right. Labor + materials + equipment + markup is the
//      number that lands on a client-facing change order.
//   2. An unsigned or incomplete ticket is NEVER treated as authorized. If
//      that ever slips, the app starts billing owners for work nobody agreed
//      to — which is worse than not having the feature.
//   3. The ticket→CO mapping preserves the money. The CO's changeAmount must
//      reconcile to the ticket, and its line items must sum to it.
//   4. Converting the same ticket twice does not double-bill.
//
// Plus: the reachability checks. Several fully-built screens in this repo
// shipped unreachable. A ticket flow nobody can find is worth exactly zero.
//
// Run: bun run scripts/validate-field-ticket.ts
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  authorizerRoleLabel,
  buildChangeOrderFromTicket,
  buildPricingAuditEntries,
  fieldTicketPriceChanges,
  FIELD_TICKET_PRICED_ACTION,
  isPricingOnlyRowChange,
  lastPricedAt,
  pricingProvenanceNote,
  suggestEquipmentRate,
  suggestLaborRate,
  unpricedConversionWarning,
  checkFieldTicketConversion,
  checkFieldTicketReadiness,
  computeFieldTicketTotals,
  equipmentRowTotal,
  fieldTicketLabel,
  FIELD_TICKET_CO_ACTION,
  findChangeOrderForTicket,
  isFieldTicketAuthorized,
  isFieldTicketCO,
  isFieldTicketSealed,
  isFieldTicketSignable,
  laborRowTotal,
  materialRowTotal,
  nextFieldTicketNumber,
  round2,
  sealedFieldTicketViolations,
  ticketConversionPatch,
  emptyFieldTicket,
  fieldTicketPricingBlockReason,
  pricingRoleFor,
  pricingActorName,
} from '../utils/fieldTicketCore';
import type { ChangeOrder, FieldTicket } from '../types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const NOW = '2026-08-03T15:00:00.000Z';

// A fully-formed, signed ticket: 3 crew, 2 materials, 1 excavator, 15% markup.
function signedTicket(overrides: Partial<FieldTicket> = {}): FieldTicket {
  return {
    id: 'tkt-1',
    number: 7,
    projectId: 'proj-1',
    date: '2026-08-03',
    workDescription: 'Removed and hauled off undocumented concrete footing under the east slab.',
    reasonExtra: 'Unforeseen condition — footing is not on the structural drawings.',
    labor: [
      { id: 'l1', workerName: 'R. Alvarez', trade: 'Laborer', hours: 6, rate: 62 },
      { id: 'l2', workerName: 'D. Chen', trade: 'Laborer', hours: 6, rate: 62 },
      { id: 'l3', workerName: 'M. Okafor', trade: 'Foreman', hours: 2.5, rate: 88 },
    ],
    materials: [
      { id: 'm1', description: 'Ready-mix, 4000 psi', quantity: 2, unit: 'cy', unitCost: 215 },
      { id: 'm2', description: 'Disposal — mixed debris', quantity: 1, unit: 'ea', unitCost: 340 },
    ],
    equipment: [
      { id: 'e1', description: 'Mini excavator', hours: 4, rate: 95 },
    ],
    markupPercent: 15,
    status: 'signed',
    authorization: {
      name: 'Karen Volpe',
      title: "Owner's Rep — Volpe & Assoc.",
      role: 'owner_rep',
      signedAt: '2026-08-03T14:42:00.000Z',
      signaturePaths: ['M10,40 L30,20 L50,55'],
    },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

console.log('\nT&M field ticket:');

// ── 1. Row + category + markup totals ───────────────────────────────────────
console.log('\n  totals');
eq('labor row: 6 hr × $62', laborRowTotal({ id: 'x', workerName: 'a', trade: 'b', hours: 6, rate: 62 }), 372);
eq('labor row with no rate is $0, not NaN', laborRowTotal({ id: 'x', workerName: 'a', trade: 'b', hours: 6 }), 0);
eq('material row: 2 cy × $215', materialRowTotal({ id: 'x', description: 'd', quantity: 2, unit: 'cy', unitCost: 215 }), 430);
eq('equipment row: 4 hr × $95', equipmentRowTotal({ id: 'x', description: 'd', hours: 4, rate: 95 }), 380);
eq('round2 kills float drift', round2(0.1 + 0.2), 0.3);

const t = computeFieldTicketTotals(signedTicket());
eq('labor hours sum (6 + 6 + 2.5)', t.laborHours, 14.5);
eq('labor cost (372 + 372 + 220)', t.laborCost, 964);
eq('material cost (430 + 340)', t.materialCost, 770);
eq('equipment hours', t.equipmentHours, 4);
eq('equipment cost', t.equipmentCost, 380);
eq('subtotal = labor + material + equipment', t.subtotal, 2114);
eq('15% markup on 2114', t.markupAmount, 317.1);
eq('billable total = subtotal + markup', t.billableTotal, 2431.1);
ok('subtotal really is the sum of the three categories',
  round2(t.laborCost + t.materialCost + t.equipmentCost) === t.subtotal);

const noMarkup = computeFieldTicketTotals(signedTicket({ markupPercent: undefined }));
eq('absent markup bills at cost', noMarkup.billableTotal, 2114);
eq('negative markup is clamped to zero',
  computeFieldTicketTotals(signedTicket({ markupPercent: -20 })).markupAmount, 0);

const emptyTotals = computeFieldTicketTotals({ labor: [], materials: [], equipment: [] });
eq('empty ticket totals zero', emptyTotals.billableTotal, 0);

// Unpriced rows: real work, no money yet. They must count as work but not
// silently invent a dollar amount.
const unpriced = signedTicket({
  labor: [{ id: 'l1', workerName: 'R. Alvarez', trade: 'Laborer', hours: 8 }],
  materials: [{ id: 'm1', description: 'Lumber', quantity: 12, unit: 'ea' }],
  equipment: [],
  markupPercent: 0,
});
const ut = computeFieldTicketTotals(unpriced);
eq('unpriced rows contribute $0', ut.billableTotal, 0);
eq('unpriced rows still record hours', ut.laborHours, 8);
eq('unpriced rows are counted for the office', ut.unpricedRowCount, 2);

// ── 2. Readiness: what makes a ticket complete enough to sign ───────────────
console.log('\n  readiness to sign');
ok('a complete ticket is signable', isFieldTicketSignable(signedTicket()));
for (const [label, patch] of [
  ['no project',        { projectId: '' }],
  ['no date',           { date: '' }],
  ['no work described', { workDescription: '  ' }],
  ['no reason it is extra', { reasonExtra: '' }],
  ['no labor/material/equipment rows', { labor: [], materials: [], equipment: [] }],
] as [string, Partial<FieldTicket>][]) {
  ok(`incomplete (${label}) is NOT signable`, !isFieldTicketSignable(signedTicket(patch)));
}
ok('zero-hour rows do not count as work',
  !isFieldTicketSignable(signedTicket({
    labor: [{ id: 'l', workerName: 'a', trade: 'b', hours: 0, rate: 60 }],
    materials: [], equipment: [],
  })));
ok('pricing is NOT required to sign — the rep signs for hours, not dollars',
  isFieldTicketSignable(unpriced));
const readiness = checkFieldTicketReadiness(signedTicket({ workDescription: '', reasonExtra: '' }));
ok('readiness names every missing field', readiness.missing.length === 2, JSON.stringify(readiness.missing));
ok('a brand-new ticket is not signable', !isFieldTicketSignable(
  emptyFieldTicket({ id: 'n', projectId: 'p', number: 1, nowISO: NOW })));

// ── 3. Authorization: unsigned work is NEVER authorized ─────────────────────
console.log('\n  authorization');
ok('a properly signed ticket is authorized', isFieldTicketAuthorized(signedTicket()));
ok('a draft is never authorized', !isFieldTicketAuthorized(signedTicket({ status: 'draft' })));
ok('a voided ticket is never authorized', !isFieldTicketAuthorized(signedTicket({ status: 'void' })));
ok('missing authorization block → not authorized',
  !isFieldTicketAuthorized(signedTicket({ authorization: undefined })));
ok('signed status with NO signature strokes → not authorized',
  !isFieldTicketAuthorized(signedTicket({
    authorization: { name: 'Karen Volpe', role: 'owner_rep', signedAt: NOW, signaturePaths: [] },
  })));
ok('strokes but no typed name → not authorized',
  !isFieldTicketAuthorized(signedTicket({
    authorization: { name: '   ', role: 'owner_rep', signedAt: NOW, signaturePaths: ['M0,0 L1,1'] },
  })));
ok('no signedAt timestamp → not authorized',
  !isFieldTicketAuthorized(signedTicket({
    authorization: { name: 'Karen Volpe', role: 'owner_rep', signedAt: '', signaturePaths: ['M0,0 L1,1'] },
  })));
ok('a ticket emptied AFTER signing is no longer authorized',
  !isFieldTicketAuthorized(signedTicket({ labor: [], materials: [], equipment: [] })));

// ── 4. Sealing: a signature freezes the captured content ────────────────────
console.log('\n  sealing');
ok('a draft is not sealed', !isFieldTicketSealed({ status: 'draft' }));
ok('a signed ticket is sealed', isFieldTicketSealed({ status: 'signed' }));
ok('a converted ticket is sealed', isFieldTicketSealed({ status: 'converted' }));
eq('a draft accepts any edit',
  sealedFieldTicketViolations({ status: 'draft' }, { labor: [], workDescription: 'x' }), []);
eq('a sealed ticket rejects an edit to the labor rows',
  sealedFieldTicketViolations({ status: 'signed' }, { labor: [] }), ['labor']);
eq('a sealed ticket rejects rewriting the work description',
  sealedFieldTicketViolations({ status: 'signed' }, { workDescription: 'something else' }), ['workDescription']);
eq('a sealed ticket rejects a markup change (it would move the signed amount)',
  sealedFieldTicketViolations({ status: 'signed' }, { markupPercent: 40 }), ['markupPercent']);
eq('a sealed ticket rejects re-signing under a different name',
  sealedFieldTicketViolations({ status: 'signed' }, { authorization: undefined }), ['authorization']);
eq('a sealed ticket still allows the conversion stamp',
  sealedFieldTicketViolations({ status: 'signed' }, ticketConversionPatch(
    { id: 'co-1' } as ChangeOrder, NOW)), []);
eq('a sealed ticket still allows photo storagePath backfill from the upload queue',
  sealedFieldTicketViolations({ status: 'signed' }, { photos: [] }), []);
ok('a mixed update is rejected WHOLE, not partially applied',
  sealedFieldTicketViolations({ status: 'signed' }, { status: 'void', labor: [] }).length === 1);

// ── 5. Ticket → ChangeOrder mapping ─────────────────────────────────────────
console.log('\n  ticket → change order');
const co = buildChangeOrderFromTicket({
  ticket: signedTicket(), existingCOs: [], baseContractValue: 250000, nowISO: NOW,
});
eq('CO change amount equals the ticket billable total', co.changeAmount, 2431.1);
eq('line items reconcile to the change amount',
  round2(co.lineItems.reduce((s, li) => s + li.total, 0)), co.changeAmount);
// Labor splits by RATE ($62 crew, $88 foreman) so no line has to blend.
ok('mixed labor rates split into one line per rate',
  co.lineItems.length === 5, `got ${co.lineItems.length}: ${co.lineItems.map(l => l.name).join(' | ')}`);
ok('the $62 crew line is 12 hrs',
  co.lineItems[0].quantity === 12 && co.lineItems[0].unitPrice === 62 && co.lineItems[0].total === 744,
  JSON.stringify(co.lineItems[0]));
// The reason grouping-by-rate exists: a blended $66.48/hr × 14.5 hr is $963.96
// against a $964.00 total, and a line whose own arithmetic is four cents off
// invites an argument about the entire ticket.
ok('EVERY line satisfies quantity × unitPrice === total exactly',
  co.lineItems.every(li => round2(li.quantity * li.unitPrice) === li.total),
  JSON.stringify(co.lineItems.filter(li => round2(li.quantity * li.unitPrice) !== li.total)));
ok('no $0 line items reach the change order', co.lineItems.every(li => li.total > 0));
eq('new contract total = original + change', co.newContractTotal, round2(250000 + 2431.1));
eq('CO starts as a draft — a signed ticket authorizes WORK, not the CO', co.status, 'draft');
eq('CO inherits the project', co.projectId, 'proj-1');
ok('CO description names the ticket and the signer',
  co.description.includes('T&M-007') && co.description.includes('Karen Volpe'), co.description);
ok('CO reason carries the "why it is extra" argument',
  co.reason.includes('Unforeseen condition'), co.reason);
ok('every line item is flagged isNew', co.lineItems.every(li => li.isNew));

// Unpriced categories must not emit a $0 line — a blank row on a client
// document reads as an error and invites a fight over the whole ticket.
const laborOnly = buildChangeOrderFromTicket({
  ticket: signedTicket({ materials: [], equipment: [], markupPercent: 0 }),
  existingCOs: [], baseContractValue: 0, nowISO: NOW,
});
eq('a labor-only ticket emits only labor lines', laborOnly.lineItems.length, 2);
eq('labor-only change amount', laborOnly.changeAmount, 964);
ok('a labor-only ticket still reconciles',
  round2(laborOnly.lineItems.reduce((s, li) => s + li.total, 0)) === 964);

// A single-rate crew must stay a SINGLE line — grouping must not fragment the
// common case into one line per worker.
const oneRate = buildChangeOrderFromTicket({
  ticket: signedTicket({
    labor: [
      { id: 'a', workerName: 'A', trade: 'Laborer', hours: 4, rate: 60 },
      { id: 'b', workerName: 'B', trade: 'Laborer', hours: 4, rate: 60 },
    ],
    materials: [], equipment: [], markupPercent: 0,
  }),
  existingCOs: [], baseContractValue: 0, nowISO: NOW,
});
eq('two workers at the same rate collapse into one line', oneRate.lineItems.length, 1);
eq('…with the combined hours', oneRate.lineItems[0].quantity, 8);
eq('…and the combined total', oneRate.changeAmount, 480);

// Unpriced rows must not emit a phantom line.
const halfPriced = buildChangeOrderFromTicket({
  ticket: signedTicket({
    labor: [
      { id: 'a', workerName: 'A', trade: 'Laborer', hours: 4, rate: 60 },
      { id: 'b', workerName: 'B', trade: 'Laborer', hours: 4 },
    ],
    materials: [], equipment: [], markupPercent: 0,
  }),
  existingCOs: [], baseContractValue: 0, nowISO: NOW,
});
eq('an unpriced labor row emits no line item', halfPriced.lineItems.length, 1);
eq('and does not inflate the change amount', halfPriced.changeAmount, 240);

// CO numbering + contract roll-up against existing COs.
const priorCOs: ChangeOrder[] = [
  { id: 'co-a', number: 4, projectId: 'proj-1', date: NOW, description: '', reason: '', lineItems: [],
    originalContractValue: 250000, changeAmount: 5000, newContractTotal: 255000, status: 'approved',
    createdAt: NOW, updatedAt: NOW },
  { id: 'co-b', number: 2, projectId: 'proj-1', date: NOW, description: '', reason: '', lineItems: [],
    originalContractValue: 250000, changeAmount: 9999, newContractTotal: 259999, status: 'rejected',
    createdAt: NOW, updatedAt: NOW },
];
const co2 = buildChangeOrderFromTicket({
  ticket: signedTicket(), existingCOs: priorCOs, baseContractValue: 250000, nowISO: NOW,
});
eq('CO number is max(existing) + 1, never length + 1', co2.number, 5);
eq('only APPROVED prior COs roll into the original contract value',
  co2.originalContractValue, 255000);
eq('CO numbering is independent of the T&M ticket number', co2.number !== signedTicket().number, true);
eq('ticket label formatting', fieldTicketLabel(7), 'T&M-007');
eq('next ticket number is max + 1', nextFieldTicketNumber([
  { number: 3 } as FieldTicket, { number: 11 } as FieldTicket, { number: 2 } as FieldTicket,
]), 12);
ok('authorizer roles all resolve to prose', ['owner_rep', 'client', 'architect', 'cm', 'other']
  .every(r => authorizerRoleLabel(r).length > 0));

// ── 6. Double-billing guard ─────────────────────────────────────────────────
console.log('\n  double-bill guard');
ok('the built CO carries the dedupe marker', isFieldTicketCO(co));
ok('a hand-written CO is not mistaken for a ticket CO', !isFieldTicketCO(priorCOs[0]));
eq('the marker detail is the ticket id',
  (co.auditTrail ?? []).find(e => e.action === FIELD_TICKET_CO_ACTION)?.detail, 'tkt-1');

const first = checkFieldTicketConversion(signedTicket(), []);
ok('a signed, priced ticket converts', first.canConvert, first.reason);

// The exact regression this guards: convert, persist, then try again.
const converted = signedTicket({ ...ticketConversionPatch(co, NOW) });
const second = checkFieldTicketConversion(converted, [co]);
ok('converting the SAME ticket a second time is refused', !second.canConvert);
ok('the refusal names the change order that already bills it',
  (second.reason ?? '').includes(`#${co.number}`), second.reason);
eq('the refusal points at the existing CO', second.existingChangeOrderId, co.id);

// The durable half of the guard: the ticket's own flag is gone (cache wipe,
// reinstall, second device) but the CO's audit marker still stops the rebill.
const amnesiac = signedTicket();
ok('audit marker alone blocks a re-convert after a cache wipe',
  !checkFieldTicketConversion(amnesiac, [co]).canConvert);
ok('findChangeOrderForTicket locates the CO by marker with no local flag',
  findChangeOrderForTicket({ id: 'tkt-1' }, [priorCOs[0], co])?.id === co.id);
ok('and by the ticket flag when the marker is missing',
  findChangeOrderForTicket({ id: 'tkt-9', convertedChangeOrderId: 'co-a' }, priorCOs)?.id === 'co-a');
ok('a different ticket is NOT blocked by another ticket\'s CO',
  checkFieldTicketConversion(signedTicket({ id: 'tkt-2' }), [co]).canConvert);

// Everything that must never reach a change order.
for (const [label, patch] of [
  ['unsigned draft',      { status: 'draft' as const }],
  ['voided',              { status: 'void' as const }],
  ['no signature strokes', { authorization: { name: 'K. Volpe', role: 'owner_rep' as const, signedAt: NOW, signaturePaths: [] } }],
  ['no typed name',       { authorization: { name: '', role: 'owner_rep' as const, signedAt: NOW, signaturePaths: ['M0,0'] } }],
] as [string, Partial<FieldTicket>][]) {
  const check = checkFieldTicketConversion(signedTicket(patch), []);
  ok(`${label} cannot become a change order`, !check.canConvert);
  ok(`  …and says why`, !!check.reason && check.reason.length > 0);
}
const zeroDollar = checkFieldTicketConversion(
  signedTicket({ ...unpriced, status: 'signed', authorization: signedTicket().authorization }), []);
ok('a $0 ticket cannot become a change order', !zeroDollar.canConvert);
ok('  …and asks for rates rather than blaming the signature',
  (zeroDollar.reason ?? '').toLowerCase().includes('rate'), zeroDollar.reason);

// ── 6b. Pricing a SIGNED ticket ─────────────────────────────────────────────
// The bug this section exists to stop coming back (audit 2026-09-17 #7): the
// data model says the super signs for HOURS and the office attaches money
// later, but the seal froze the rate fields too. A ticket signed the designed
// way was therefore signed evidence that could NEVER become a change order —
// "Bill it" greyed out forever with no control anywhere that could price it.
//
// The relaxation is narrow on purpose. Allowing the whole `labor` key would let
// hours, trades and worker names be rewritten under the signature, which is
// worse than the bug. Only the rate/unitCost field on an otherwise-identical
// row may move, and every move is recorded.
console.log('\n  pricing a signed ticket');

const unpricedSigned = signedTicket({
  labor: [
    { id: 'l1', workerName: 'R. Alvarez', trade: 'Carpenter', hours: 6 },
    { id: 'l2', workerName: 'D. Chen', trade: 'Carpenter', hours: 6 },
    { id: 'l3', workerName: 'M. Okafor', trade: 'Carpenter', hours: 6 },
  ],
  materials: [{ id: 'm1', description: 'Blocking', quantity: 1, unit: 'ls', unitCost: 400 }],
  equipment: [],
  markupPercent: 0,
});

// THE REPRO, end to end. Labor with no rate + a priced material: converting
// today bills $400 and drops 18 signed carpentry hours without a word.
const halfGate = checkFieldTicketConversion(unpricedSigned, []);
ok('a half-priced ticket still converts (partial billing is legitimate)', halfGate.canConvert);
ok('…but the gate reports the unpriced lines', halfGate.unpricedRowCount === 3, String(halfGate.unpricedRowCount));
ok('…and hands the caller a warning to show before it drops them', !!halfGate.warning, halfGate.warning);
ok('…that names the hours that will NOT be billed',
  (halfGate.warning ?? '').includes('18 labor hr'), halfGate.warning);
eq('unpriced labor hours are counted', computeFieldTicketTotals(unpricedSigned).unpricedLaborHours, 18);
eq('a fully priced ticket carries no warning',
  unpricedConversionWarning(computeFieldTicketTotals(signedTicket())), undefined);
eq('a fully priced ticket has no unpriced labor hours',
  computeFieldTicketTotals(signedTicket()).unpricedLaborHours, 0);
ok('the conversion gate on a fully priced ticket sets no warning',
  !checkFieldTicketConversion(signedTicket(), []).warning);

// The seal, row by row.
const priced = (rate: number) => unpricedSigned.labor.map(r => ({ ...r, rate }));
eq('a sealed ticket ACCEPTS a rate filled in by the office',
  sealedFieldTicketViolations(unpricedSigned, { labor: priced(95) }), []);
eq('…and a material unit cost',
  sealedFieldTicketViolations(unpricedSigned, {
    materials: [{ id: 'm1', description: 'Blocking', quantity: 1, unit: 'ls', unitCost: 525 }],
  }), []);
eq('…and an equipment rate',
  sealedFieldTicketViolations(signedTicket(), {
    equipment: [{ id: 'e1', description: 'Mini excavator', hours: 4, rate: 110 }],
  }), []);
eq('a sealed ticket REFUSES an hours change hidden in the same array',
  sealedFieldTicketViolations(unpricedSigned, {
    labor: unpricedSigned.labor.map((r, i) => i === 0 ? { ...r, hours: 12, rate: 95 } : { ...r, rate: 95 }),
  }), ['labor']);
eq('…a renamed trade',
  sealedFieldTicketViolations(unpricedSigned, {
    labor: unpricedSigned.labor.map((r, i) => i === 0 ? { ...r, trade: 'Foreman', rate: 95 } : { ...r, rate: 95 }),
  }), ['labor']);
eq('…a row added under the signature',
  sealedFieldTicketViolations(unpricedSigned, {
    labor: [...priced(95), { id: 'l4', workerName: 'New', trade: 'Carpenter', hours: 8, rate: 95 }],
  }), ['labor']);
eq('…a row removed under the signature',
  sealedFieldTicketViolations(unpricedSigned, { labor: priced(95).slice(1) }), ['labor']);
eq('…rows reordered (the printed document would no longer match)',
  sealedFieldTicketViolations(unpricedSigned, { labor: [...priced(95)].reverse() }), ['labor']);
eq('…a quantity change on a material',
  sealedFieldTicketViolations(unpricedSigned, {
    materials: [{ id: 'm1', description: 'Blocking', quantity: 9, unit: 'ls', unitCost: 400 }],
  }), ['materials']);
eq('…and an edit whose prior rows are unknown (unprovable ⇒ refused)',
  sealedFieldTicketViolations({ status: 'signed' }, { labor: [] }), ['labor']);
eq('a rate change bundled with a description rewrite is refused WHOLE',
  sealedFieldTicketViolations(unpricedSigned, {
    labor: priced(95),
    workDescription: 'something else',
  }), ['workDescription']);
ok('an explicitly-undefined rate reads the same as an absent one',
  isPricingOnlyRowChange(
    [{ id: 'a', hours: 4 }],
    [{ id: 'a', hours: 4, rate: undefined }],
    'rate',
  ));
ok('a null row in the update is refused rather than crashing',
  !isPricingOnlyRowChange([{ id: 'a', hours: 4 }], [null as unknown as Record<string, unknown>], 'rate'));

// Pricing must not change whether the ticket was signable / authorized —
// isFieldTicketAuthorized re-runs the readiness check on every read.
const pricedTicket: FieldTicket = { ...unpricedSigned, labor: priced(95) };
ok('a ticket priced after signing is still authorized', isFieldTicketAuthorized(pricedTicket));

// The record of who priced it.
const changes = fieldTicketPriceChanges(unpricedSigned, { labor: priced(95) });
eq('every rate the office moved is listed', changes.length, 3);
eq('a change carries the old and new rate', { from: changes[0].from, to: changes[0].to },
  { from: undefined, to: 95 });
ok('a change names the row in the ticket\'s own words',
  changes[0].label.includes('Carpenter') && changes[0].label.includes('R. Alvarez'), changes[0].label);
eq('an unchanged rate is not reported as a change',
  fieldTicketPriceChanges(pricedTicket, { labor: priced(95) }).length, 0);
eq('clearing a rate is reported too',
  fieldTicketPriceChanges(pricedTicket, {
    labor: pricedTicket.labor.map(r => ({ ...r, rate: undefined })),
  }).length, 3);

let seq = 0;
const entries = buildPricingAuditEntries(changes, 'Dana (office)', NOW, () => `aud-${++seq}`);
eq('one audit entry per rate applied', entries.length, 3);
eq('the audit action marks it as priced AFTER the signature',
  entries[0].action, FIELD_TICKET_PRICED_ACTION);
eq('the audit entry names who applied it', entries[0].actor, 'Dana (office)');
ok('the audit detail states the rate that was applied',
  (entries[0].detail ?? '').includes('$95.00/hr'), entries[0].detail);
ok('a material audit detail is per unit, not per hour',
  (buildPricingAuditEntries(
    fieldTicketPriceChanges(unpricedSigned, {
      materials: [{ id: 'm1', description: 'Blocking', quantity: 1, unit: 'ls', unitCost: 525 }],
    }), 'Dana', NOW, () => 'x')[0].detail ?? '').includes('/unit'));
eq('an unpriced ticket has never been priced', lastPricedAt(unpricedSigned), undefined);
eq('lastPricedAt returns the LATEST pricing pass', lastPricedAt({
  auditTrail: [
    { id: 'a', action: FIELD_TICKET_PRICED_ACTION, actor: 'x', timestamp: '2026-08-04T10:00:00.000Z' },
    { id: 'b', action: 'signed_on_site', actor: 'x', timestamp: '2026-08-09T10:00:00.000Z' },
    { id: 'c', action: FIELD_TICKET_PRICED_ACTION, actor: 'x', timestamp: '2026-08-06T10:00:00.000Z' },
  ],
}), '2026-08-06T10:00:00.000Z');

// The point of the record: the change order separates what the rep attested to
// from what the office added later. Without it a priced-after-the-fact ticket
// reads as if the owner's rep approved the dollars too.
const pricedCO = buildChangeOrderFromTicket({
  ticket: { ...pricedTicket, auditTrail: entries },
  existingCOs: [], baseContractValue: 0, nowISO: NOW,
});
eq('a priced ticket now reaches a dollar amount and converts', pricedCO.changeAmount, 2110);
ok('the CO says the rates were applied in the office, and when',
  pricedCO.description.includes('applied in the office') && pricedCO.description.includes('Aug 3, 2026'),
  pricedCO.description);
ok('the CO still says the rep signed for the hours',
  pricedCO.description.includes('signed on site') || pricedCO.description.includes('Signed on site'),
  pricedCO.description);
ok('a ticket priced in the field carries NO office-pricing sentence',
  !buildChangeOrderFromTicket({
    ticket: signedTicket(), existingCOs: [], baseContractValue: 0, nowISO: NOW,
  }).description.includes('applied in the office'));
// The PDF is the document a GC actually hands an owner who disputes a T&M
// charge, and it prints the rates right above the signature — so it needs the
// same separation as the CO, from the same function (review 2 on #7).
const pricedForPdf = { ...pricedTicket, auditTrail: entries };
const pdfNote = pricingProvenanceNote(pricedForPdf, { withSigner: true });
ok('the PDF provenance line names the signer and the pricing date',
  pdfNote.includes('as signed on site by ') && pdfNote.includes('applied in the office Aug 3, 2026')
  && !!pricedForPdf.authorization && pdfNote.includes(pricedForPdf.authorization.name), pdfNote);
eq('the CO and the PDF share one wording (the CO just omits the signer it already names)',
  pricingProvenanceNote(pricedForPdf).length > 0
  && pricedCO.description.includes(pricingProvenanceNote(pricedForPdf)), true);
eq('a ticket never priced after signing prints no provenance line',
  pricingProvenanceNote(signedTicket(), { withSigner: true }), '');
ok('the provenance line survives a ticket with every row priced (unpricedRowCount 0)',
  computeFieldTicketTotals(pricedForPdf).unpricedRowCount === 0 && pdfNote.length > 0);
{
  // Landed by the integration pass: the PDF must print the line, and print it
  // ABOVE the signature block (where the priced total sits).
  const pdfSrc = existsSync(join(ROOT, 'utils/pdfGenerator.ts'))
    ? readFileSync(join(ROOT, 'utils/pdfGenerator.ts'), 'utf8') : '';
  ok('the field-ticket PDF prints the pricing provenance line, directly above the signature',
    /C\.pricingProvenanceNote\(ticket, \{ withSigner: true \}\)/.test(pdfSrc)
      && /totalsHtml \+ provenanceHtml \+ authHtml/.test(pdfSrc));
}
ok('the previously-unbillable ticket is now billable', checkFieldTicketConversion({
  ...pricedTicket, auditTrail: entries,
}, []).canConvert);
ok('and carries no unpriced warning once every line has a rate',
  !checkFieldTicketConversion({ ...pricedTicket, auditTrail: entries }, []).warning);

// Suggestions: the app already knows these numbers. It offers them with their
// source; it never writes one silently and never invents one.
eq('a configured trade rate is suggested',
  suggestLaborRate('Carpenter', { carpenter: 95 })?.rate, 95);
ok('the suggestion says where it came from',
  (suggestLaborRate('Carpenter', { carpenter: 95 })?.source ?? '').includes('Time Tracking'));
// useLaborRates stores the GC's PAYROLL number (wages + burden). The ticket
// row is a BILLING rate. A chip reading "Your Carpenter rate" invites a tap
// that bills 18 hr of carpentry at cost, which is the exact money this whole
// finding exists to stop leaving on the table — the chip has to say so.
ok('…and says the number is a COST, with O&P still to add',
  /\bcost\b/i.test(suggestLaborRate('Carpenter', { carpenter: 95 })?.source ?? '')
  && /O&P/.test(suggestLaborRate('Carpenter', { carpenter: 95 })?.source ?? ''),
  suggestLaborRate('Carpenter', { carpenter: 95 })?.source);
eq('a trade with NO configured rate gets no suggestion — never a market average',
  suggestLaborRate('Plumber', { carpenter: 95 }), undefined);
eq('a zero / nonsense rate is not suggested', suggestLaborRate('Carpenter', { carpenter: 0 }), undefined);
eq('a blank trade falls back to the general bucket',
  suggestLaborRate('', { general: 58 })?.rate, 58);
eq('equipment day rate becomes an hourly figure the same way the job-cost engine does',
  suggestEquipmentRate('Mini excavator', [
    { name: 'Kubota KX040 mini excavator', dailyRate: 760 },
  ])?.rate, 95);
eq('a machine that is not on this job is not guessed at',
  suggestEquipmentRate('Skid steer', [{ name: 'Kubota KX040 mini excavator', dailyRate: 760 }]),
  undefined);
eq('a machine with no day rate yields no suggestion',
  suggestEquipmentRate('Mini excavator', [{ name: 'Mini excavator', dailyRate: 0 }]), undefined);
// Name matching used plain substring containment in both directions, so a
// machine's day rate landed on any line whose text happened to contain its
// name's letters. Both of these put a real dollar amount on a client-facing
// change order for a machine that was never on the job.
eq('a machine name buried mid-word is not a match ("Forklift" is not "Lift")',
  suggestEquipmentRate('Forklift', [{ name: 'Lift', dailyRate: 300 }]), undefined);
eq('a three-letter brand fragment is not a match ("Cat" in "scaffold cat walk")',
  suggestEquipmentRate('Scaffold cat walk', [{ name: 'Cat', dailyRate: 1200 }]), undefined);
eq('a short machine name still matches a verbose description on a word boundary',
  suggestEquipmentRate('Excavator for footing dig', [{ name: 'Excavator', dailyRate: 800 }])?.rate,
  100);

// ── 7. Reachability — a screen nobody can find is worth zero ────────────────
console.log('\n  reachability');
const read = (p: string) => existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '';

ok('app/field-ticket.tsx exists', existsSync(join(ROOT, 'app', 'field-ticket.tsx')));
ok('the route is registered in app/_layout.tsx',
  /<Stack\.Screen\s+name="field-ticket"/.test(read('app/_layout.tsx')));
const registry = read('utils/featureRegistry.ts');
ok('the screen is in the feature registry (universal search)',
  registry.includes("route: '/field-ticket'"));
ok('the registry entry is gated on change_orders_invoicing',
  /id: 'field-ticket'[^}]*requires: 'change_orders_invoicing'/.test(registry));
ok('a super searching "t&m" / "extra work" / "ticket" finds it',
  ["'t&m'", "'extra work'", "'ticket'"].every(s => registry.includes(s)));
ok('the screen is in the desktop sidebar under FIELD OPS',
  /route: '\/field-ticket',\s*section: 'FIELD OPS'/.test(read('components/DesktopSidebar.tsx')));
ok('project-detail routes its Field Ops tile to the screen',
  /tile\.key === 'fieldTickets'[\s\S]{0,120}\/field-ticket/.test(read('app/project-detail.tsx')));
ok('project-detail lists the tile inside the Field Ops group',
  /key: 'field',[\s\S]{0,300}'fieldTickets'/.test(read('app/project-detail.tsx')));
ok('the daily report offers a T&M ticket entry point',
  read('app/daily-report.tsx').includes("'/field-ticket'"));
ok('the screen gates on change_orders_invoicing (Pro)',
  read('app/field-ticket.tsx').includes("canAccess('change_orders_invoicing')"));
ok('the screen writes through supabaseWrite, never supabase.from(...).insert',
  !/supabase\s*\.\s*from\([^)]*\)\s*\.\s*(insert|update)/.test(read('app/field-ticket.tsx')));
ok('the ticket cache key is registered in LOCAL_USER_CACHE_KEYS (tenant isolation)',
  read('contexts/AuthContext.tsx').includes("'mageid_field_tickets'"));

// The seal must hold at the DATA layer, not only wherever a screen remembers
// to set `editable={false}`. Without this, a future caller can rewrite the
// hours somebody already signed for.
const ctx = read('contexts/ProjectContext.tsx');
ok('ProjectContext.updateFieldTicket enforces the seal',
  /sealedFieldTicketViolations/.test(ctx) && /const updateFieldTicket/.test(ctx));
ok('…and refuses the whole update rather than applying it partially',
  /violations\.length > 0[\s\S]{0,220}return false/.test(ctx));
ok('ticket photos are staged onto the photo-upload queue (never a raw file:// URI)',
  /stageTicketPhotos/.test(ctx) && /stagePhotoUpload\(\{[\s\S]{0,120}recordId: p\.id/.test(ctx));
ok('the persisted photo column carries the storage path, not the local URI',
  /ticketPhotoRows[\s\S]{0,160}uri: p\.storagePath \?\? p\.uri/.test(ctx));

// A ticket saved unsigned must remain signable, or "Save" is a dead end that
// manufactures permanently unbillable records.
const screen = read('app/field-ticket.tsx');
ok('a ticket saved unsigned can still be signed later',
  screen.includes('ticket-sign-existing') && /signTargetId/.test(screen));
ok('the signature pad is remounted per open (no carry-over between signers)',
  /\{signOpen && \(\s*<SignatureModal/.test(screen));

// The other dead end: a ticket signed for HOURS with the rates left to the
// office needs a control that can attach them, or it can never be billed.
ok('the signed detail view can price the ticket',
  screen.includes('ticket-price') && /<PricingModal/.test(screen));
ok('pricing writes through updateFieldTicket (the seal is re-checked there)',
  /handleApplyPricing[\s\S]{0,1600}updateFieldTicket\(ticket\.id/.test(screen));
ok('every applied rate is written into the ticket auditTrail',
  /handleApplyPricing[\s\S]{0,1600}buildPricingAuditEntries\(changes/.test(screen));
ok('only the categories whose rates moved are sent (the seal cannot judge an absent array)',
  /for \(const c of changes\) \{[\s\S]{0,260}patch\.labor = next\.labor;/.test(screen)
  && /updateFieldTicket\(ticket\.id, \{\s*\.\.\.patch,/.test(screen));
ok('a refused pricing write tells the user why instead of failing silently',
  /if \(!ok\) \{[\s\S]{0,320}showAlert\(/.test(screen));
ok('pricing is closed once a change order exists (it would desync the CO)',
  /pricingOpenForTicket = openTicket\.status === 'signed' && !billedCO/.test(screen)
  && /const canPrice = pricingOpenForTicket && /.test(screen));
ok('…and says why rather than just hiding the control',
  /openTicket\.convertedChangeOrderId \|\| gate\.existingChangeOrderId[\s\S]{0,900}Revise the change order/.test(screen));
// Keyed on the TICKET's marker, not on the resolved CO. gate.existingChangeOrderId
// is only ever set from a change order found in the same array the screen then
// searches, so keying the explanation on it alone made this branch unreachable
// and the assertion below vacuous — it matched a string no user could ever see.
ok('…including when the change order it became has since been deleted',
  /\{!!\(openTicket\.convertedChangeOrderId \|\| gate\.existingChangeOrderId\)/.test(screen)
  && /already billed, so its rates are locked/.test(screen));
ok('the conversion confirmation shows the unpriced-lines warning',
  /gate\.warning,\s*\]\.filter\(Boolean\)/.test(screen));
ok('the ticket total says what it EXCLUDES when lines have no rate',
  /totals\.unpricedRowCount > 0[\s\S]{0,260}Excludes/.test(screen));
ok('a suggested rate names its source and is tapped, never auto-applied',
  /RateSuggestion/.test(screen) && /suggestion\.source/.test(screen)
  && /onUse=\{\(\) => set/.test(screen));
ok('suggestions come from the GC\'s own configured rates, not a market average',
  /useLaborRates\(\)/.test(screen) && /suggestLaborRate\(row\.trade, laborRates\)/.test(screen));
// The suggestion chips offer a COST, so the sheet has to say what stands
// between that number and the owner's bill. A 0% ticket saying nothing reads
// as "O&P is added somewhere else" — it is not.
ok('the pricing sheet says what markup the rates will be billed at',
  /preview\.markupPercent > 0[\s\S]{0,400}O&P on top of the rates you enter/.test(screen)
  && /no O&P markup/.test(screen));
// A controlled money field that renders String(parseFloat(keystrokes)) eats
// the decimal point: "95." parses to 95 and re-renders as "95", so $95.50
// cannot be typed at all. This is the only surface where T&M rates are entered
// to the cent.
ok('a rate can be typed to the cent (the field renders raw keystrokes)',
  /function MoneyInput\([\s\S]{0,1400}value=\{raw\}/.test(screen)
  && !/function MoneyInput\([\s\S]{0,1400}value=\{value == null \? '' : String\(value\)\}/.test(screen));

// ── #7 provenance: who priced it, and who may ──────────────────────────────
// The audit entry named the device's company branding (or the literal
// 'Office'), never the person who set the rate, and any collaborator —
// a field user included — could price a sealed ticket.
console.log('\npricing names the signed-in user, and only the owner or an editor may price:');
{
  const branding = { contactName: 'Omir Majeed', companyName: 'Majeed Builders' };
  eq('the audit actor is the signed-in user\'s name, not the branding',
    pricingActorName({ name: 'Dana Office', email: 'dana@example.com' }, branding), 'Dana Office');
  eq('…their email when the profile has no name',
    pricingActorName({ name: '  ', email: 'dana@example.com' }, branding), 'dana@example.com');
  eq('…branding only when there is no signed-in identity at all', pricingActorName(null, branding), 'Omir Majeed');
  eq("…and 'Office' only as the last resort", pricingActorName(undefined, { contactName: '', companyName: ' ' }), 'Office');
  const unpriced = signedTicket({ labor: [{ id: 'l1', workerName: 'Ray', trade: 'Laborer', hours: 8 }] });
  const entries = buildPricingAuditEntries(
    fieldTicketPriceChanges(unpriced, {
      labor: [{ id: 'l1', workerName: 'Ray', trade: 'Laborer', hours: 8, rate: 55 }],
      materials: unpriced.materials, equipment: unpriced.equipment,
    }),
    pricingActorName({ name: 'Dana Office' }, branding), NOW, () => 'id');
  ok('the priced_after_signature entry carries that name', entries.length > 0 && entries.every(e => e.actor === 'Dana Office'),
    JSON.stringify(entries));
  eq('an owner may price', fieldTicketPricingBlockReason('owner'), null);
  eq('an editor may price', fieldTicketPricingBlockReason('editor'), null);
  ok('a viewer may not, and is told why', /view-only/.test(fieldTicketPricingBlockReason('viewer') ?? ''));
  ok('a field user may not, and is told why', /office/.test(fieldTicketPricingBlockReason('field') ?? ''));
  ok('a role still resolving is not a yes', !!fieldTicketPricingBlockReason(null));
  ok('…and a failed role read says so', /Couldn’t confirm/.test(fieldTicketPricingBlockReason(null, true) ?? ''));
  ok('the screen names the actor through pricingActorName(user, settings.branding), not the branding alone',
    /pricingActorName\(user, settings\.branding\)/.test(screen)
      && !/settings\.branding\?\.contactName\.trim\(\)/.test(screen) && /useAuth\(\)/.test(screen));
  ok('the price button is gated on the role and a blocked role sees the reason',
    /const canPrice = pricingOpenForTicket && !pricingBlockReason;/.test(screen)
      && /pricingOpenForTicket && !!pricingBlockReason && \(/.test(screen)
      && /fieldTicketPricingBlockReason\(pricingRole, projectRoleError\)/.test(screen));
  // Integration round 1 (money-accounts): no signal on site → the collaborator
  // read fails → the OWNER was locked out of pricing his own ticket.
  eq('the owner is known from the cached project row when the role read failed', pricingRoleFor(null, 'u1', 'u1'), 'owner');
  ok('…so his pricing is open even with the read failed', fieldTicketPricingBlockReason(pricingRoleFor(null, 'u1', 'u1'), true) === null);
  eq('anyone else still fails closed', pricingRoleFor(null, 'u1', 'u2'), null);
  eq('…as does a project row with no owner id', pricingRoleFor(null, undefined, 'u2'), null);
  eq('a resolved role is never overridden (a field seat stays field)', pricingRoleFor('field', 'u1', 'u1'), 'field');
  ok('the screen gates pricing on pricingRoleFor(projectRole, project?.ownerUserId, user?.id)',
    /const pricingRole = pricingRoleFor\(projectRole, project\?\.ownerUserId, user\?\.id\);/.test(screen));
  ok('applying prices re-checks the role', /if \(pricingBlockReason\) \{ showAlert\('Not saved', pricingBlockReason\); return; \}/.test(screen));
}

// Integration round 1: the field role SEES no money on a saved ticket either —
// pricing was gated, the display was not.
console.log('\nfield access sees hours and quantities, not the office\'s rates:');
{
  ok('the screen decides it from the role (isFinancialsBlinded)', /const moneyBlinded = isFinancialsBlinded\(projectRole\);/.test(screen));
  ok('...the open ticket shows quantities in place of the total and O&P',
    /\{moneyBlinded \? \(\s*<View style=\{styles\.amountCard\} testID="ticket-amount-blinded">/.test(screen));
  ok('...no labour, equipment or material rate on its rows',
    (screen.match(/\{r\.hours\} hr\{moneyBlinded \? '' : r\.rate \?/g) ?? []).length === 2
      && /\{r\.quantity\} \{r\.unit\}\{moneyBlinded \? '' : r\.unitCost \?/.test(screen));
  ok('...no unbilled total, no list amounts (screen or screen reader)',
    /\{!moneyBlinded && <Text style=\{styles\.unbilledValue\}>/.test(screen)
      && /\{!moneyBlinded && <Text style=\{styles\.ticketAmount\}>/.test(screen)
      && /\$\{moneyBlinded \? '' : `, \$\{money\(tot\.billableTotal\)\}`\}/.test(screen));
  ok('...no amount in the signed toast or on the re-sign button',
    !/signed — \$\{money\(/.test(screen) && /amount=\{moneyBlinded \? null : totals\.billableTotal\}/.test(screen));
  ok('...and every saved-ticket money display left is behind the flag',
    !/<Text style=\{styles\.(unbilledValue|ticketAmount)\}>\{money/.test(screen.replace(/\{!moneyBlinded && <Text/g, '')));
}

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
