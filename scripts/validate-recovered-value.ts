// validate-recovered-value.ts — pins the honesty rules on the "MAGE recovered
// $X for you" number.
//
// WHY THESE ARE TESTS AND NOT COMMENTS: this figure is a claim the product makes
// about its own worth, shown to a contractor deciding whether to keep paying. If
// it can be inflated — by counting a CO a human wrote, by counting one the owner
// hasn't signed, by counting a credit backwards — it becomes marketing, and the
// contractor's trust in every other number in the app goes with it.
//
// Run: bun run scripts/validate-recovered-value.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeRecoveredValue, recoveredHeadline, recoveredPendingLine, recoveredProofLine,
  formatRecoveredMoney, isClientSigned, CLIENT_SIGNED_ACTION,
} from '../utils/recoveredValue';
import { changeOrderBillKey } from '../utils/changeOrderBilling';
import type { ChangeOrder, ChangeOrderStatus, Invoice, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const NOW = '2026-08-03T12:00:00.000Z';
const AUTO_DRAFT_ACTION = 'auto_drafted_from_leak';

const projects: Project[] = [
  { id: 'p1', name: 'Maple St' } as Project,
  { id: 'p2', name: 'Henderson' } as Project,
];

function co(over: Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus }): ChangeOrder {
  return {
    number: 1, projectId: 'p1', date: NOW, description: '', reason: '',
    lineItems: [], originalContractValue: 0, changeAmount: 1000,
    newContractTotal: 0, createdAt: NOW, updatedAt: NOW,
    ...over,
  } as ChangeOrder;
}

/** A CO carrying the marker leakCoDraft stamps — i.e. MAGE wrote it. */
function auto(over: Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus }): ChangeOrder {
  return co({
    ...over,
    auditTrail: [
      { id: 'a1', action: AUTO_DRAFT_ACTION, actor: 'MAGE', timestamp: NOW, detail: 'r1' },
      ...(over.auditTrail ?? []),
    ],
  } as Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus });
}

console.log('\nrecovered value:');

// ── The core claim: only MAGE-drafted AND owner-approved counts ──────────────
{
  const v = computeRecoveredValue(projects, [
    auto({ id: '1', status: 'approved', changeAmount: 2400 }),
    auto({ id: '2', status: 'approved', changeAmount: 1800 }),
  ], { nowISO: NOW });
  ok('approved auto-drafted COs sum into the headline', v.total === 4200, `got ${v.total}`);
  ok('and are counted', v.count === 2, `got ${v.count}`);
  ok('rows carry the project name', v.rows.every(r => r.projectName === 'Maple St'));
}

// ── The inflation guards. Each of these would make the number a lie. ─────────
{
  const v = computeRecoveredValue(projects, [
    co({ id: 'h', status: 'approved', changeAmount: 9999 }), // human wrote it
  ], { nowISO: NOW });
  ok('a hand-written CO NEVER counts as recovered by MAGE', v.total === 0, `got ${v.total}`);
  ok('but it is tracked separately as manual', v.manualTotal === 9999, `got ${v.manualTotal}`);
  ok('and hasData stays false with no MAGE wins', v.hasData === false);
}

{
  const statuses: ChangeOrderStatus[] = ['draft', 'submitted', 'under_review', 'rejected', 'void', 'revised'];
  const v = computeRecoveredValue(
    projects,
    statuses.map((s, i) => auto({ id: `s${i}`, status: s, changeAmount: 500 })),
    { nowISO: NOW },
  );
  ok('no unapproved status is ever counted as recovered', v.total === 0, `got ${v.total}`);
  // submitted + under_review are "with the owner"; draft/rejected/void/revised are not.
  ok('only owner-held COs count as pending', v.pendingCount === 2, `got ${v.pendingCount}`);
  ok('a REVISED co is not pending — it is back in negotiation', v.pendingTotal === 1000, `got ${v.pendingTotal}`);
}

{
  const v = computeRecoveredValue(projects, [
    auto({ id: 'c', status: 'approved', changeAmount: -5000 }), // credit CO
    auto({ id: 'z', status: 'approved', changeAmount: 0 }),
    auto({ id: 'n', status: 'approved', changeAmount: Number.NaN }),
  ], { nowISO: NOW });
  ok('a credit CO cannot drag the recovered number negative', v.total === 0, `got ${v.total}`);
  ok('zero and NaN amounts are ignored, not summed', v.count === 0, `got ${v.count}`);
}

// ── Windowing ────────────────────────────────────────────────────────────────
{
  const old = '2026-01-01T00:00:00.000Z';
  const rows = [
    auto({ id: 'recent', status: 'approved', changeAmount: 1000, updatedAt: NOW }),
    auto({ id: 'old', status: 'approved', changeAmount: 7000, updatedAt: old, date: old }),
  ];
  const windowed = computeRecoveredValue(projects, rows, { nowISO: NOW, windowDays: 90 });
  ok('a 90-day window excludes an older win', windowed.total === 1000, `got ${windowed.total}`);
  const allTime = computeRecoveredValue(projects, rows, { nowISO: NOW });
  ok('no window means all-time', allTime.total === 8000, `got ${allTime.total}`);
}

{
  // An unparseable date must not silently vanish — that would understate the
  // number for a reason the contractor cannot see or correct.
  const v = computeRecoveredValue(projects, [
    auto({ id: 'bad', status: 'approved', changeAmount: 1234, updatedAt: 'not-a-date', date: '', createdAt: '' }),
  ], { nowISO: NOW, windowDays: 30 });
  ok('an unparseable date is kept, never silently dropped', v.total === 1234, `got ${v.total}`);
}

// ── Ordering, naming, and shape ──────────────────────────────────────────────
{
  const v = computeRecoveredValue(projects, [
    auto({ id: 'a', status: 'approved', changeAmount: 100, updatedAt: '2026-07-01T00:00:00.000Z' }),
    auto({ id: 'b', status: 'approved', changeAmount: 100, updatedAt: '2026-08-01T00:00:00.000Z' }),
  ], { nowISO: NOW });
  ok('newest win sorts first', v.rows[0]?.id === 'b', `got ${v.rows[0]?.id}`);
}

{
  const v = computeRecoveredValue([], [
    auto({ id: 'x', status: 'approved', changeAmount: 100, projectId: 'ghost' }),
  ], { nowISO: NOW });
  ok('a CO on a missing project still counts, with a safe label',
    v.total === 100 && v.rows[0]?.projectName === 'Unknown project');
}

{
  const empty = computeRecoveredValue(projects, [], { nowISO: NOW });
  ok('empty input is empty, not a crash', empty.total === 0 && empty.hasData === false);
  ok('headline is null when there is nothing earned', recoveredHeadline(empty) === null);
  ok('pending line is null when nothing is pending', recoveredPendingLine(empty) === null);
}

// ── Copy ─────────────────────────────────────────────────────────────────────
{
  const v = computeRecoveredValue(projects, [
    auto({ id: '1', status: 'approved', changeAmount: 12400 }),
    auto({ id: '2', status: 'submitted', changeAmount: 3000 }),
  ], { nowISO: NOW });
  const h = recoveredHeadline(v, 'this quarter') ?? '';
  ok('headline states the money and the window', h.includes('$12,400') && h.includes('this quarter'), h);
  // #152: 'approved' is a status the GC can set himself ("Mark approved") with
  // no invoice behind it. The headline used to say "you billed"; it may claim
  // only what the status proves.
  ok('headline says APPROVED — the status is all it knows', h.includes('approved'), h);
  ok('headline never says billed or signed', !/billed|signed/i.test(h), h);
  ok('headline has no hype punctuation', !h.includes('!'), h);
  const p = recoveredPendingLine(v) ?? '';
  ok('pending line names the amount still with the client', p.includes('$3,000'), p);
  // Singular/plural
  const one = computeRecoveredValue(projects, [auto({ id: '1', status: 'approved', changeAmount: 500 })], { nowISO: NOW });
  ok('singular grammar for one CO', (recoveredHeadline(one) ?? '').includes('1 change order —') ||
    (recoveredHeadline(one) ?? '').includes('1 change order'), recoveredHeadline(one) ?? '');
}

// ── #152: "signed" and "billed" only where the record proves them ───────────
console.log('\nproof of signature / billing (#152):');
{
  const signed = auto({
    id: 's', status: 'approved', changeAmount: 1000,
    auditTrail: [{ id: 'x', action: CLIENT_SIGNED_ACTION, actor: 'Pat Smith', timestamp: NOW, detail: 'E-SIGN' }],
  } as Partial<ChangeOrder> & { id: string; status: ChangeOrderStatus });
  const marked = auto({ id: 'm', status: 'approved', changeAmount: 500 });
  ok('a portal e-signature marks the CO clientSigned', isClientSigned(signed));
  ok('a GC "Mark approved" with no signature is NOT clientSigned', !isClientSigned(marked));
  ok('an approver row the GC set is not a signature either',
    !isClientSigned({ auditTrail: [{ id: 'y', action: 'approved', actor: 'GC', timestamp: NOW }] }));
  // A signature vouches only for what it signed: re-decided afterwards, it no
  // longer proves the amount that is approved now (review of #152).
  const sig = (ts: string) => ({ id: 'sg', action: CLIENT_SIGNED_ACTION, actor: 'Pat Smith', timestamp: ts });
  const T1 = '2026-09-01T12:00:00.000Z', T2 = '2026-09-02T12:00:00.000Z', T3 = '2026-09-03T12:00:00.000Z';
  ok('signed, then revised, then GC-approved → NOT clientSigned',
    !isClientSigned({ auditTrail: [sig(T1), { id: 'r', action: 'marked_approved', actor: 'GC', timestamp: T3 }] }));
  ok('signed, then declined → NOT clientSigned',
    !isClientSigned({ auditTrail: [sig(T1), { id: 'd', action: 'client_declined_via_portal', actor: 'Pat', timestamp: T2 }] }));
  ok('a later unsigned portal approval or a decision conflict also voids it',
    !isClientSigned({ auditTrail: [sig(T1), { id: 'a', action: 'approved_via_portal', actor: 'Pat', timestamp: T2 }] })
    && !isClientSigned({ auditTrail: [sig(T1), { id: 'c', action: 'portal_decision_conflict', actor: 'MAGE ID', timestamp: T2 }] }));
  ok('a superseding entry with no readable time counts as later (under-claim)',
    !isClientSigned({ auditTrail: [sig(T2), { id: 'r', action: 'marked_approved', actor: 'GC', timestamp: '' }] }));
  ok('GC approval BEFORE the signature, re-signed after → clientSigned',
    isClientSigned({ auditTrail: [{ id: 'r', action: 'marked_approved', actor: 'GC', timestamp: T1 }, sig(T3)] }));
  ok('neutral entries after the signature do not void it',
    isClientSigned({ auditTrail: [
      { id: 'l', action: 'auto_drafted_from_leak', actor: 'MAGE', timestamp: T1 }, sig(T2),
      { id: 'p', action: 'portal_decision_applied', actor: 'MAGE ID', timestamp: T3 },
      { id: 'n', action: 'schedule_reflow_no_anchor', actor: 'MAGE ID', timestamp: T3 },
    ] }));
  ok('declined earlier, signed later → clientSigned',
    isClientSigned({ auditTrail: [{ id: 'd', action: 'client_declined_via_portal', actor: 'Pat', timestamp: T1 }, sig(T2)] }));

  const inv = (over: Partial<Invoice>): Invoice => ({
    id: 'i', number: 7, projectId: 'p1', type: 'progress', issueDate: NOW, dueDate: NOW,
    paymentTerms: 'net_30', notes: '', subtotal: 0, taxRate: 0, taxAmount: 0, totalDue: 0,
    amountPaid: 0, status: 'sent', payments: [], createdAt: NOW, updatedAt: NOW,
    lineItems: [],
    ...over,
  } as Invoice);
  const line = (coId: string, total: number) => ({
    id: `l-${coId}`, name: 'CO', description: '', quantity: 1, unit: 'lump', unitPrice: total, total,
    sourceEstimateItemId: changeOrderBillKey(coId),
  });

  // Nothing signed, nothing billed: the card claims "approved" and nothing more.
  const bare = computeRecoveredValue(projects, [marked], { nowISO: NOW, invoices: [] });
  const bareLine = recoveredProofLine(bare);
  ok('unsigned + unbilled: the subline says approved', /^approved on 1 change order MAGE drafted off your job-site notes\.$/.test(bareLine), bareLine);
  ok('unsigned + unbilled: no "billed", no "signed"', !/billed|signed/i.test(bareLine), bareLine);

  // A DRAFT invoice carrying the CO is not billing: nobody was sent it.
  const drafted = computeRecoveredValue(projects, [marked], {
    nowISO: NOW, invoices: [inv({ status: 'draft', lineItems: [line('m', 500)] })],
  });
  ok('a draft invoice line does not make the CO billed', drafted.billedTotal === 0 && !/billed/.test(recoveredProofLine(drafted)),
    recoveredProofLine(drafted));

  // A sent invoice on ANOTHER project with the same key must not count.
  const elsewhere = computeRecoveredValue(projects, [marked], {
    nowISO: NOW, invoices: [inv({ projectId: 'p2', lineItems: [line('m', 500)] })],
  });
  ok('an invoice on another project does not bill this CO', elsewhere.billedTotal === 0, `got ${elsewhere.billedTotal}`);

  // Part-billed and one of two signed: both stated as far as proven, to the cent.
  const mixed = computeRecoveredValue(projects, [signed, marked], {
    nowISO: NOW, invoices: [inv({ lineItems: [line('s', 250.5)] })],
  });
  const mixedLine = recoveredProofLine(mixed);
  ok('signedCount counts only the e-signed row', mixed.signedCount === 1, `got ${mixed.signedCount}`);
  ok('billedTotal is the sent-invoice dollars, to the cent', mixed.billedTotal === 250.5, `got ${mixed.billedTotal}`);
  ok('the subline says 1 of them signed and $250.50 billed so far',
    mixedLine.includes('signed 1 of them in the portal') && mixedLine.includes('$250.50 of it is billed so far'), mixedLine);

  // Over-billing one CO cannot claim billing on another.
  const capped = computeRecoveredValue(projects, [signed, marked], {
    nowISO: NOW, invoices: [inv({ lineItems: [line('s', 5000)] })],
  });
  ok('a row\'s billed dollars are capped at its own amount', capped.billedTotal === 1000, `got ${capped.billedTotal}`);
  ok('…so "All of it is billed" is not claimed while another CO is unbilled', !/All of it is billed/.test(recoveredProofLine(capped)),
    recoveredProofLine(capped));

  // Everything signed and billed: the strong words are earned.
  const full = computeRecoveredValue(projects, [signed], {
    nowISO: NOW, invoices: [inv({ lineItems: [line('s', 1000)] })],
  });
  const fullLine = recoveredProofLine(full);
  ok('fully signed + billed says so', fullLine.includes('Your client signed it in the portal.') && fullLine.includes('All of it is billed.'), fullLine);

  // No invoice list at all = billing unknown, never "billed".
  const unknown = computeRecoveredValue(projects, [signed], { nowISO: NOW });
  ok('no invoices passed → billingKnown false and nothing called billed',
    unknown.billingKnown === false && !/billed/.test(recoveredProofLine(unknown)), recoveredProofLine(unknown));

  ok('money keeps its cents', formatRecoveredMoney(1234.5) === '$1,234.50' && formatRecoveredMoney(12400) === '$12,400',
    `${formatRecoveredMoney(1234.5)} / ${formatRecoveredMoney(12400)}`);
  const pend = computeRecoveredValue(projects, [auto({ id: 'p', status: 'submitted', changeAmount: 999.99 })], { nowISO: NOW });
  ok('pending line is cent-exact (no Math.round)', (recoveredPendingLine(pend) ?? '').includes('$999.99'), recoveredPendingLine(pend) ?? '');
}

// ── The card reads the proof line, not its own copy ─────────────────────────
{
  const card = readFileSync(join(ROOT, 'components/home/RecoveredCard.tsx'), 'utf8');
  const code = card.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  ok('RecoveredCard renders recoveredProofLine', /recoveredProofLine\(recovered\)/.test(code));
  ok('RecoveredCard passes the invoice list (proof of billing)', /invoices,\s*\n\s*\}\),/.test(code) && /const \{ changeOrders, projects, invoices \} = useProjects\(\);/.test(code));
  ok('RecoveredCard carries no unconditional "billed" / "signed by your client" copy',
    !/billed from|approved and signed by your client/.test(code));
  ok('RecoveredCard header no longer claims every dollar was signed', !/every dollar shown was signed/.test(card));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
