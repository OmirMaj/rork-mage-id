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

// ── Report ──────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
