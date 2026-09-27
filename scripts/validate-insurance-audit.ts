// validate-insurance-audit.ts — the workers' comp audit pack says only what
// the records show (utils/insuranceAuditPack).
//
// Pins: calendar-day coverage tests (the day before effective, the effective
// day, the expiry day, ISO instants on both sides); project scoping (an
// unknown project is never covered by a project-scoped certificate; one job's
// certificate never covers another job's payment); every status; parity of
// auditGcPaymentsFromReceipts with the 1099 export's
// gcRecordedSubPaymentsFromReceipts; $Y = not_covered + no_certificate only,
// $Z = dates_missing + unconfirmed + undated; integer cents; portal load
// failure; the empty period; the CSV; and the words it must never use.
//
// Run: bun run scripts/validate-insurance-audit.ts

import type {
  CertificateOfInsurance, Commitment, MaterialReceipt, Subcontractor, SubSubmittedInvoice,
} from '../types';

// utils/coiFiles (hasUnconfirmedAi) carries the storage client; stub it the way
// scripts/validate-w5-coi-subs-coverage does so bun never loads react-native.
interface VirtualModuleBuilder { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
const bun = (globalThis as unknown as { Bun?: { plugin(d: { name: string; setup: (b: VirtualModuleBuilder) => void }): void } }).Bun;
if (!bun) { console.error('must run under bun'); process.exit(1); }
bun.plugin({
  name: 'stub-insurance-audit-edges',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
  },
});

const M = await import('../utils/insuranceAuditPack');
const { gcRecordedSubPaymentsFromReceipts } = await import('../utils/tax1099Export');
const { csvCell } = await import('../utils/punchExportCore');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── Fixtures ────────────────────────────────────────────────────────────────
const sub = (id: string, name: string, over: Partial<Subcontractor> = {}): Subcontractor =>
  ({ id, companyName: name, contactName: '', phone: '', email: '', address: '', trade: 'Framing', licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over } as Subcontractor);
const inv = (id: string, subId: string, amount: number, paidOn: string | undefined, over: Partial<SubSubmittedInvoice> = {}): SubSubmittedInvoice =>
  ({ id, subPortalId: 'sp', subcontractorId: subId, invoiceNumber: id, amount, status: 'paid', createdAt: '2026-01-02T12:00:00Z', paidOn, projectId: 'P1', ...over } as SubSubmittedInvoice);
const coi = (id: string, subId: string, coverages: CertificateOfInsurance['coverages'], projectId?: string): CertificateOfInsurance =>
  ({ id, subcontractorId: subId, fileUri: '', uploadedAt: '2026-01-01T00:00:00Z', coverages, projectId } as CertificateOfInsurance);
const WC = (effectiveDate?: string, expiresAt?: string, over: object = {}) => ({ type: 'workers_comp' as const, carrierName: 'Harbor Mutual', policyNumber: 'WC-1', effectiveDate, expiresAt, source: 'manual' as const, ...over });

type Input = Parameters<typeof M.buildInsuranceAudit>[0];
const base = (over: Partial<Input>): Input => ({
  periodStart: '2026-01-01', periodEnd: '2026-12-31',
  subs: [sub('A', 'Acme Framing'), sub('B', 'Bolt Electric')],
  portalInvoices: [], gcRecordedPayments: [], cois: [], commitments: [], ...over,
});
const statusOf = (a: ReturnType<typeof M.buildInsuranceAudit>, key: string, type: 'workers_comp' | 'general_liability' = 'workers_comp') =>
  a.subs.flatMap(s => s.payments).find(p => p.key === key)?.status[type];

// ── 1. Calendar-day coverage ────────────────────────────────────────────────
console.log('\ncalendar-day coverage:');
{
  const cois = [coi('c1', 'A', [WC('2026-03-01', '2026-06-30')])];
  const a = M.buildInsuranceAudit(base({
    cois,
    portalInvoices: [
      inv('before', 'A', 100, '2026-02-28'),
      inv('eff', 'A', 100, '2026-03-01'),
      inv('exp', 'A', 100, '2026-06-30'),
      inv('after', 'A', 100, '2026-07-01'),
    ],
  }));
  eq('a payment the day before WC effective → not_covered', statusOf(a, 'portal:before'), 'not_covered');
  eq('on the effective day → covered', statusOf(a, 'portal:eff'), 'covered');
  eq('on the expiry day → covered', statusOf(a, 'portal:exp'), 'covered');
  eq('the day after expiry → not_covered', statusOf(a, 'portal:after'), 'not_covered');

  // ISO instants on the certificate and a late-evening createdAt instant on the
  // payment compare on the calendar day, never through a timezone.
  const isoCois = [coi('c2', 'A', [WC('2026-03-01T00:00:00.000Z', '2026-06-30T00:00:00.000Z')])];
  const b = M.buildInsuranceAudit(base({
    cois: isoCois,
    gcRecordedPayments: [
      { subcontractorId: 'A', amount: 50, date: '2026-06-30T23:58:00.000Z', dateSource: 'created', projectId: 'P1', reference: 'late' },
      { subcontractorId: 'A', amount: 50, date: '2026-03-01T23:59:59.000Z', dateSource: 'created', projectId: 'P1', reference: 'eff' },
    ],
  }));
  eq('ISO expiry + a createdAt instant late on the expiry day → covered', statusOf(b, 'recorded:0:late'), 'covered');
  eq('ISO effective + a createdAt instant late on the effective day → covered', statusOf(b, 'recorded:1:eff'), 'covered');
  ok('a createdAt-dated bill says it is the date recorded, not paid',
    b.subs[0].payments.every(p => p.notes.includes(M.DATE_RECORDED_NOTE)));
}

// ── 2. Statuses ─────────────────────────────────────────────────────────────
console.log('\nevery status:');
{
  const a = M.buildInsuranceAudit(base({
    cois: [
      coi('c-b-gl', 'B', [{ type: 'general_liability', effectiveDate: '2026-01-01', expiresAt: '2026-12-31' }]),
    ],
    portalInvoices: [inv('b1', 'B', 100, '2026-05-05')],
  }));
  eq('no WC certificate → no_certificate', statusOf(a, 'portal:b1'), 'no_certificate');
  eq('…while its GL certificate spans it → GL covered', statusOf(a, 'portal:b1', 'general_liability'), 'covered');

  const m = M.buildInsuranceAudit(base({
    cois: [coi('c-miss', 'A', [WC('2026-01-01', undefined)])],
    portalInvoices: [inv('m1', 'A', 100, '2026-05-05')],
  }));
  eq('certificate with a missing expiry → dates_missing', statusOf(m, 'portal:m1'), 'dates_missing');
  const m2 = M.buildInsuranceAudit(base({
    cois: [coi('c-miss2', 'A', [WC('2026-06-01', undefined)])],
    portalInvoices: [inv('m2', 'A', 100, '2026-05-05')],
  }));
  eq('…but an effective date AFTER the payment rules it out → not_covered', statusOf(m2, 'portal:m2'), 'not_covered');

  const u = M.buildInsuranceAudit(base({
    cois: [coi('c-ai', 'A', [{ type: 'workers_comp', source: 'ai', aiEffectiveDate: '2026-01-01', aiExpiresAt: '2026-12-31' }])],
    portalInvoices: [inv('u1', 'A', 100, '2026-05-05')],
  }));
  eq('AI-read dates not yet confirmed → unconfirmed', statusOf(u, 'portal:u1'), 'unconfirmed');
  const u2 = M.buildInsuranceAudit(base({
    cois: [coi('c-ai2', 'A', [WC('2026-01-01', '2026-12-31', { source: 'ai' })])],
    portalInvoices: [inv('u2', 'A', 100, '2026-05-05')],
  }));
  eq("a source:'ai' row with real dates is still unconfirmed (hasUnconfirmedAi)", statusOf(u2, 'portal:u2'), 'unconfirmed');
  const u3 = M.buildInsuranceAudit(base({
    cois: [coi('c-ai3', 'A', [{ type: 'workers_comp', source: 'ai', aiEffectiveDate: '2026-01-01', aiExpiresAt: '2026-12-31' }]), coi('c-ok', 'A', [WC('2026-01-01', '2026-12-31')])],
    portalInvoices: [inv('u3', 'A', 100, '2026-05-05')],
  }));
  eq('a confirmed certificate beside an AI one → covered', statusOf(u3, 'portal:u3'), 'covered');
}

// ── 3. Project scoping ─────────────────────────────────────────────────────
console.log('\nproject scoping:');
{
  const scoped = [coi('c-p1', 'A', [WC('2026-01-01', '2026-12-31')], 'P1')];
  const a = M.buildInsuranceAudit(base({
    cois: scoped,
    portalInvoices: [
      inv('noproj', 'A', 100, '2026-05-05', { projectId: undefined }),
      inv('p1', 'A', 100, '2026-05-05', { projectId: 'P1' }),
      inv('p2', 'A', 100, '2026-05-05', { projectId: 'P2' }),
    ],
  }));
  const np = statusOf(a, 'portal:noproj');
  ok('no projectId + only a project-scoped COI → NOT covered', np !== 'covered' && (np === 'no_certificate' || np === 'not_covered'), `got ${np}`);
  ok('…and the row says only unscoped certificates were checked',
    a.subs[0].payments.find(p => p.key === 'portal:noproj')!.notes.includes(M.PROJECT_UNKNOWN_NOTE));
  eq('a project-scoped COI covers its own project', statusOf(a, 'portal:p1'), 'covered');
  ok("a project-scoped COI does not cover another project's payment", statusOf(a, 'portal:p2') !== 'covered', `got ${statusOf(a, 'portal:p2')}`);
  const blanket = M.buildInsuranceAudit(base({
    cois: [coi('c-blanket', 'A', [WC('2026-01-01', '2026-12-31')])],
    portalInvoices: [inv('noproj2', 'A', 100, '2026-05-05', { projectId: undefined })],
  }));
  eq('an unscoped (blanket) COI covers a payment whose project is unknown', statusOf(blanket, 'portal:noproj2'), 'covered');
}

// ── 4. Parity with the 1099 export's GC-recorded payments ──────────────────
console.log('\nauditGcPaymentsFromReceipts == gcRecordedSubPaymentsFromReceipts:');
{
  const commitments = [
    { id: 'k1', projectId: 'P1', number: 'SC-1', type: 'subcontract', subcontractorId: 'A', description: '', amount: 0, signedDate: '', status: 'executed', createdAt: '', updatedAt: '' },
    { id: 'k2', projectId: 'P2', number: 'PO-2', type: 'purchase_order', subcontractorId: 'B', description: '', amount: 0, signedDate: '', status: 'executed', createdAt: '', updatedAt: '' },
    { id: 'k3', projectId: 'P3', number: 'SC-3', type: 'subcontract', description: '', amount: 0, signedDate: '', status: 'executed', createdAt: '', updatedAt: '' },
  ] as unknown as Commitment[];
  const r = (id: string, over: Partial<MaterialReceipt>): MaterialReceipt =>
    ({ id, projectId: 'P1', vendor: 'V', lines: [], subtotal: 0, total: 100, createdAt: '2026-04-01T20:00:00Z', ...over } as MaterialReceipt);
  const receipts = [
    r('r1', { commitmentId: 'k1', receiptDate: '2026-04-02', documentNumber: 'INV-9' }),
    r('r2', { commitmentId: 'k1', total: 250.5 }),
    r('r3', { commitmentId: 'k2' }),
    r('r4', { commitmentId: 'k3' }),
    r('r5', {}),
    r('r6', { commitmentId: 'k1', total: 0 }),
    r('r7', { commitmentId: 'k1', total: Number.NaN }),
    r('r8', { commitmentId: 'missing' }),
  ];
  const ours = M.auditGcPaymentsFromReceipts(receipts, commitments);
  const theirs = gcRecordedSubPaymentsFromReceipts(receipts, commitments);
  eq('same sub / amount / date / reference, same order',
    ours.map(p => [p.subcontractorId, p.amount, p.date, p.reference]),
    theirs.map(p => [p.subcontractorId, p.amount, p.date, p.reference]));
  eq('plus the commitment project', ours.map(p => p.projectId), ['P1', 'P1']);
  eq('plus the date basis', ours.map(p => p.dateSource), ['receipt', 'created']);
}

// ── 5. $Y, $Z, K and integer cents ─────────────────────────────────────────
console.log('\ntotals:');
{
  const a = M.buildInsuranceAudit(base({
    subs: [sub('A', 'Acme Framing'), sub('B', 'Bolt Electric'), sub('C', 'Cedar Drywall'), sub('D', 'Delta Tile')],
    cois: [
      coi('cA', 'A', [WC('2026-01-01', '2026-12-31')]),
      coi('cB', 'B', [WC('2025-01-01', '2025-12-31')]),
      coi('cC', 'C', [WC('2026-01-01', undefined)]),
      coi('cD', 'D', [{ type: 'workers_comp', source: 'ai', aiEffectiveDate: '2026-01-01', aiExpiresAt: '2026-12-31' }]),
    ],
    portalInvoices: [
      inv('a1', 'A', 0.1, '2026-02-01'), inv('a2', 'A', 0.1, '2026-02-02'), inv('a3', 'A', 0.1, '2026-02-03'),
      inv('b1', 'B', 1234.565, '2026-03-01'),
      inv('c1', 'C', 200, '2026-04-01'),
      inv('d1', 'D', 300, '2026-04-01'),
      inv('e1', 'E', 400, '2026-04-01'), // not on the roster, no certificate
      inv('x1', 'A', 999, '2025-12-31'), // outside the period
    ],
    gcRecordedPayments: [{ subcontractorId: 'C', amount: 75, date: 'not a date', dateSource: 'receipt', projectId: 'P1', reference: 'u' }],
  }));
  eq('3 × $0.10 = 30 cents exactly', a.subs.find(s => s.subcontractorId === 'A')!.paidCents, 30);
  // Converted to cents ONCE at the edge (Math.round(x × 100) = 123457), and
  // every figure downstream is that integer — no float sum ever re-rounds it.
  eq('$1,234.565 rounds once, at the edge, to 123457 cents', a.subs.find(s => s.subcontractorId === 'B')!.payments[0].amountCents, 123457);
  const wc = a.byStatus.workers_comp;
  eq('$Y counts only not_covered + no_certificate', a.uncoveredWcCents, wc.not_covered + wc.no_certificate);
  eq('$Y = B (not covered) + E (no certificate)', a.uncoveredWcCents, Math.round(1234.565 * 100) + 40000);
  eq('K = 2 distinct subs', a.subsWithUncovered, 2);
  eq('$Z = dates_missing + unconfirmed + undated', a.cantTellWcCents, 20000 + 30000 + 7500);
  ok('$Z never folded into $Y or covered', wc.covered === 30 && a.uncoveredWcCents !== a.cantTellWcCents);
  eq('the undated payment is listed separately', a.undatedPayments.map(p => p.key), ['recorded:0:u']);
  eq('…with status undated, never covered', a.undatedPayments[0].status.workers_comp, 'undated');
  eq('paid total = dated in-period only', a.paidTotalCents, 30 + Math.round(1234.565 * 100) + 20000 + 30000 + 40000);
  ok('the out-of-period payment is not counted', !a.subs.flatMap(s => s.payments).some(p => p.key === 'portal:x1'));
  ok('a deleted sub is still a row', a.subs.some(s => s.subcontractorId === 'E'));
  ok('the headline names $X, N, $Y, K and $Z',
    a.headline.includes('paid to 5 subs') && a.headline.includes('went to 2 subs') && a.headline.includes("more can't be checked"),
    a.headline);
  ok('every cents value is an integer', [a.paidTotalCents, a.uncoveredWcCents, a.cantTellWcCents, ...a.subs.map(s => s.paidCents)].every(Number.isInteger));
  eq('formatCents', [M.formatCents(41200000), M.formatCents(3850050), M.formatCents(5, true)], ['$412,000', '$38,500.50', '$0.05']);
  eq('toCents rounds once and floors negatives / NaN to 0', [M.toCents(1234.565), M.toCents(0.1 + 0.2), M.toCents(-4), M.toCents(Number.NaN)], [123457, 30, 0, 0]);

  // Undated commitment money is a note, never tested.
  const withCommit = M.buildInsuranceAudit(base({
    commitments: [{ id: 'k', projectId: 'P1', number: 'SC', type: 'subcontract', subcontractorId: 'A', paidToDate: 42000, description: '', amount: 0, signedDate: '', status: 'executed', createdAt: '', updatedAt: '' } as unknown as Commitment],
  }));
  const rowA = withCommit.subs.find(s => s.subcontractorId === 'A');
  ok('Commitment.paidToDate shows as an "also recorded, no dates" note', !!rowA?.commitmentNote && /no payment dates/.test(rowA.commitmentNote));
  eq('…and is never tested or totalled', [withCommit.paidTotalCents, withCommit.uncoveredWcCents, withCommit.cantTellWcCents], [0, 0, 0]);
}

// ── 6. Portal failure, the empty period ────────────────────────────────────
console.log('\nportal failure and the empty period:');
{
  const failed = M.buildInsuranceAudit(base({ portalInvoices: null, gcRecordedPayments: [{ subcontractorId: 'A', amount: 10, date: '2026-02-02', dateSource: 'receipt', projectId: 'P1' }] }));
  ok('a failed portal read prefixes the headline', failed.headline.startsWith(M.PORTAL_LOAD_FAILED_PREFIX), failed.headline);
  ok('…and disables export with the reason', failed.exportBlockedReason === M.EXPORT_BLOCKED_PORTAL);
  const loaded = M.buildInsuranceAudit(base({}));
  eq('a loaded portal does not block export', loaded.exportBlockedReason, null);
  ok('empty → "No dated sub payments recorded in this period"', loaded.headline.startsWith(M.EMPTY_HEADLINE), loaded.headline);
  ok('…with the coverage note', loaded.headline.includes(M.AUDIT_SOURCES_NOTE));
  ok('…and no "covered" / "all clear" wording', !/covered|all clear/i.test(loaded.headline));
}

// ── 7. The request message ─────────────────────────────────────────────────
console.log('\nthe request message:');
{
  const msg = M.requestMessageFor({ name: 'Acme Framing' }, [{ payDay: '2026-05-05' }, { payDay: '2026-02-01' }], 'Hudson Build Co');
  ok('names the sub, the earliest–latest dates and the GC as holder',
    msg.startsWith('Hi Acme Framing,') && msg.includes('Feb 1, 2026–May 5, 2026') && msg.includes('naming Hudson Build Co as certificate holder'), msg);
}

// ── 8. CSV ─────────────────────────────────────────────────────────────────
console.log('\nCSV:');
{
  const a = M.buildInsuranceAudit(base({
    subs: [sub('A', '=HYPERLINK("x")'), sub('B', 'Bolt, "Sparky" Electric')],
    cois: [coi('cA', 'A', [WC('2026-01-01', '2026-12-31')])],
    portalInvoices: [inv('a1', 'A', 1234.5, '2026-02-01'), inv('b1', 'B', 10, '2026-02-01')],
  }));
  const csv = M.toCsv(a);
  const lines = csv.split('\n');
  eq('header', lines[0], 'Sub,Payment date,Amount,Source,WC status,"WC certificate (carrier, policy, dates)",GL status,GL certificate,Notes');
  ok('formula-injection guard on a cell starting with =', csv.includes(`"'=HYPERLINK(""x"")"`) || csv.includes(`'=HYPERLINK`), csv.split('\n')[1]);
  ok('RFC-4180 quoting of commas and quotes', csv.includes('"Bolt, ""Sparky"" Electric"'));
  ok('amount from cents with two decimals', /,1234\.50,/.test(csv));
  ok('the exemption note rides in the CSV', csv.includes(csvCell(M.EXEMPTION_NOTE)));
  eq('csvAmount', [M.csvAmount(123450), M.csvAmount(5), M.csvAmount(0)], ['1234.50', '0.05', '0.00']);
  const html = M.toPdfHtml(a, null, 'Hudson Build Co');
  ok('the PDF carries the exemption note and escapes names', html.includes('sole proprietor') && !html.includes('"Sparky" Electric</td>') && html.includes('&quot;Sparky&quot;'));
}

// ── 9. Words it must never use ─────────────────────────────────────────────
console.log('\nno verdict words:');
{
  const BANNED = /\b(all clear|fully covered|compliant|no exposure)\b/i;
  const samples = [
    M.buildInsuranceAudit(base({})).headline,
    M.buildInsuranceAudit(base({ cois: [coi('c', 'A', [WC('2026-01-01', '2026-12-31')])], portalInvoices: [inv('a', 'A', 10, '2026-02-01')] })).headline,
    M.EXEMPTION_NOTE, M.AUDIT_SOURCES_NOTE, M.PROJECT_UNKNOWN_NOTE, ...Object.values(M.STATUS_LABEL),
  ];
  ok('headlines, notes and status labels never say all clear / fully covered / compliant / no exposure',
    samples.every(s => !BANNED.test(s)), samples.find(s => BANNED.test(s)) ?? '');
}

// ── 10. The pay-flow warning (list 3, lane FA) ─────────────────────────────
// Paying a sub in the sub portal tells him when the sub's workers' comp does
// not cover the day he enters — and never stops the payment.
console.log('\npay-flow workers\' comp warning:');
{
  const cois = [
    coi('pw-span', 'A', [WC('2026-03-01', '2026-06-30')]),
    coi('pw-nodates', 'D', [WC('2026-01-01', undefined)]),
    coi('pw-ai', 'E', [{ type: 'workers_comp', source: 'ai', aiEffectiveDate: '2026-01-01', aiExpiresAt: '2026-12-31' }]),
    coi('pw-otherjob', 'F', [WC('2026-01-01', '2026-12-31')], 'P-OTHER'),
    coi('pw-gl-only', 'G', [{ type: 'general_liability', carrierName: 'X', policyNumber: 'GL', effectiveDate: '2026-01-01', expiresAt: '2026-12-31', source: 'manual' }]),
  ];
  eq('workersCompStatusOn: a certificate spanning the day → covered', M.workersCompStatusOn(cois, 'A', 'P1', '2026-04-01'), 'covered');
  eq('workersCompStatusOn: the day after expiry → not_covered', M.workersCompStatusOn(cois, 'A', 'P1', '2026-07-01'), 'not_covered');
  eq('workersCompStatusOn: no WC certificate for the sub → no_certificate', M.workersCompStatusOn(cois, 'B', 'P1', '2026-04-01'), 'no_certificate');
  eq('workersCompStatusOn: a GL-only certificate is not WC → no_certificate', M.workersCompStatusOn(cois, 'G', 'P1', '2026-04-01'), 'no_certificate');
  eq('workersCompStatusOn: a WC certificate with no expiry → dates_missing', M.workersCompStatusOn(cois, 'D', 'P1', '2026-04-01'), 'dates_missing');
  eq('workersCompStatusOn: AI-read dates only → unconfirmed', M.workersCompStatusOn(cois, 'E', 'P1', '2026-04-01'), 'unconfirmed');
  eq('workersCompStatusOn: a certificate scoped to another job → no_certificate', M.workersCompStatusOn(cois, 'F', 'P1', '2026-04-01'), 'no_certificate');
  eq('workersCompStatusOn: …and an unknown project never borrows it', M.workersCompStatusOn(cois, 'F', undefined, '2026-04-01'), 'no_certificate');
  eq('workersCompStatusOn: …but on its own job it covers', M.workersCompStatusOn(cois, 'F', 'P-OTHER', '2026-04-01'), 'covered');
  eq('workersCompStatusOn: no usable pay day → undated', M.workersCompStatusOn(cois, 'A', 'P1', M.calendarDayOfValue('2026-04')), 'undated');

  eq('payWarningFor: covered → null', M.payWarningFor('covered', 'Acme', 'Apr 1, 2026'), null);
  eq('payWarningFor: undated → null (nothing said while the date is half-typed)', M.payWarningFor('undated', 'Acme', ''), null);
  const WARN: Array<Parameters<typeof M.payWarningFor>[0]> = ['not_covered', 'no_certificate', 'dates_missing', 'unconfirmed'];
  const msgs = WARN.map(st => M.payWarningFor(st, 'Acme Framing', 'Jul 1, 2026'));
  ok('payWarningFor: every other status says something', msgs.every(m => typeof m === 'string' && m.length > 0));
  ok('payWarningFor: every message says the payment can still be recorded', msgs.every(m => !!m && m.includes('You can still record this payment')));
  ok('payWarningFor: every message carries the exemption note', msgs.every(m => !!m && m.endsWith(` ${M.EXEMPTION_NOTE}`)));
  ok('payWarningFor: every message names the sub', msgs.every(m => !!m && m.includes('Acme Framing')));
  ok('payWarningFor: not_covered / dates_missing name the day', !!msgs[0]?.includes('Jul 1, 2026') && !!msgs[2]?.includes('Jul 1, 2026'));
  const BLOCKING = /\b(blocked|can’t pay|can't pay|cannot pay|stop)\b/i;
  ok('payWarningFor: no message says blocked / can’t pay / cannot pay / stop', msgs.every(m => !BLOCKING.test(m ?? '')), msgs.find(m => BLOCKING.test(m ?? '')) ?? '');

  // Static: the notice is display-only in RecordPaymentModal — it never feeds
  // the submit, the skip, the primary button or the Cmd+Enter hotkey.
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const ROOT_PW = join(dirname(fileURLToPath(import.meta.url)), '..');
  const MODAL = readFileSync(join(ROOT_PW, 'components', 'RecordPaymentModal.tsx'), 'utf8');
  const lines = MODAL.split('\n');
  const touching = lines.filter(l => /\bdisabled\b|const submit\b|onPress=\{submit\}|onPress=\{onSkip\}|useSheetPrimaryHotkey\(|onSubmit\(/.test(l));
  ok('RecordPaymentModal: the submit / skip / hotkey / disabled lines never read `notice`', touching.length >= 3 && touching.every(l => !/notice/i.test(l)), touching.join(' | '));
  ok('RecordPaymentModal: the modal has no `disabled` on its buttons at all', !/\bdisabled\b/.test(MODAL));
  ok('RecordPaymentModal: the warning block is an alert with its testID', /testID="insaudit-pay-warning"[^>]*accessibilityRole="alert"/.test(MODAL));
  const SETUP = readFileSync(join(ROOT_PW, 'app', 'sub-portal-setup.tsx'), 'utf8');
  ok('sub-portal-setup passes the WC notice to the payment sheet', /notice=\{sub \? \(d\) => payWarningFor\(workersCompStatusOn\(cois, sub\.id, projectId \?\? undefined, calendarDayOfValue\(d\)\)/.test(SETUP));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
