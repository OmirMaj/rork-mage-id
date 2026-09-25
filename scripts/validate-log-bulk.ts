// validate-log-bulk.ts — the desktop logs' bulk writes (wave 6d, lane V3).
//
// WHY. Wave 6c shipped the RFI log's bulk "Close" and the invoice log's bulk
// "Mark sent" DISABLED, because no per-record handler existed. They are on now
// (founder default 3): each confirms first, emails nobody, and writes one
// record at a time through the context's updateRFI / updateInvoice (the
// offline queue). A bulk write that differs from the record screen's own write
// is the dangerous kind — it looks like the same action and leaves different
// data — so this EXECUTES both and requires the same patch:
//
//   c) markSentPatch (utils/logs/invoiceLogRows) === the invoice screen's
//      "Mark sent" (app/invoice.tsx, the status pipeline's onAdvance handler).
//      The handler is EXTRACTED and executed with stubs exactly as
//      validate-invoice-dunning-due-date §1b does, with the same invoice and a
//      pinned clock, across every payment term and 300 random clocks
//      (DST crossings included).
//   d) rfiBulkClosePlan's patch === persistForm's updates (app/rfi.tsx) when
//      he flips Status to Closed and saves. persistForm is EXTRACTED and
//      executed; rfiBallAfterSave / rfiRegressionReason / changedFields come
//      from the rfi-core-pure block of hooks/useCollectionSettled, transpiled as
//      validate-w4-rfi-core-screens does.
//   e) the plans skip what they must (sent / paid / sample-job invoices;
//      open / closed / void RFIs) and say why.
//   f) source pins: the bulk handlers call updateInvoice / updateRFI inside a
//      confirm's onPress, never supabase.from, and neither button is disabled.
//
// Run: bun run test:log-bulk   (bun scripts/validate-log-bulk.ts)

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAYMENT_TERM_DAYS } from '../utils/retainage';
import {
  MARK_SENT_SKIP, invoiceBulkMarkSentPlan, markSentPatch,
} from '../utils/logs/invoiceLogRows';
import {
  RFI_CLOSE_SKIP, logBulkSkippedLine, rfiBulkClosePlan, type RfiBulkCloseDeps,
} from '../utils/logs/rfiLogRows';
import type { Invoice, PaymentTerms, RFI } from '../types';

declare const Bun: { Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); return; }
  fail++;
  console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`);
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A Date whose `new Date()` (no argument) is the pinned instant. */
function pinnedDate(ms: number): DateConstructor {
  const Real = Date;
  class Pinned extends Real {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(ms);
      else super(...(args as [string | number]));
    }
    static now() { return ms; }
  }
  return Pinned as unknown as DateConstructor;
}

const TERMS = Object.keys(PAYMENT_TERM_DAYS) as PaymentTerms[];

// ── c) markSentPatch === the invoice screen's "Mark sent" ───────────────────
console.log('\nc) markSentPatch equals the invoice screen\'s "Mark sent" (onAdvance), same invoice, same clock:');
const invBase = {
  id: 'inv-7', projectId: 'p1', number: 7, type: 'full', status: 'draft',
  issueDate: '2026-09-01', dueDate: '2026-09-16T12:00:00.000Z', paymentTerms: 'net_15',
  notes: '', lineItems: [], subtotal: 84_000, taxRate: 0, taxAmount: 0, totalDue: 84_000,
  amountPaid: 0, payments: [], createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
} as unknown as Invoice;
{
  const screen = read('app/invoice.tsx');
  const hStart = screen.indexOf('onAdvance={(next) => {');
  const hEnd = hStart < 0 ? -1 : screen.indexOf('\n                }}', hStart);
  const gStart = screen.indexOf('function getDueDate(issueDate: string, terms: PaymentTerms): string {');
  const gEnd = gStart < 0 ? -1 : screen.indexOf('\n}\n', gStart);
  ok('found the pipeline onAdvance handler and getDueDate in app/invoice.tsx', hStart >= 0 && hEnd > hStart && gStart >= 0 && gEnd > gStart,
    'anchors moved — update them (they are validate-invoice-dunning-due-date §1b\'s)');
  if (hStart >= 0 && hEnd > hStart && gStart >= 0 && gEnd > gStart) {
    const handlerBody = screen.slice(hStart + 'onAdvance={(next) => {'.length, hEnd);
    const getDueSrc = screen.slice(gStart, gEnd + 2);
    const t = new Bun.Transpiler({ loader: 'ts' });
    const runAdvance = new Function('Date', 'PAYMENT_TERM_DAYS', 'existingInvoice', 'updateInvoice', 'openRecordPayment', 'next',
      t.transformSync(`${getDueSrc}\n${handlerBody}`)) as (
      D: DateConstructor, days: typeof PAYMENT_TERM_DAYS, inv: Invoice, upd: (id: string, u: Partial<Invoice>) => void, orp: () => void, next: string,
    ) => void;
    const screenPatch = (inv: Invoice, ms: number): Partial<Invoice>[] => {
      const calls: Partial<Invoice>[] = [];
      runAdvance(pinnedDate(ms), PAYMENT_TERM_DAYS, inv, (_id, u) => { calls.push(u); }, () => {}, 'sent');
      return calls;
    };

    const clock = Date.parse('2026-10-20T15:00:00.000Z');
    for (const terms of TERMS) {
      const inv = { ...invBase, paymentTerms: terms } as Invoice;
      const calls = screenPatch(inv, clock);
      const mine = markSentPatch(inv, new Date(clock).toISOString());
      ok(`a ${terms} draft: the same patch as the screen (${JSON.stringify(mine)})`, calls.length === 1 && same(calls[0], mine),
        `screen ${JSON.stringify(calls)} · log ${JSON.stringify(mine)}`);
    }
    // 300 random clocks × every term, across the DST changes both ways.
    let rnd = 0x2f6b3a;
    const next = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
    let diffs = 0;
    let firstDiff = '';
    for (let i = 0; i < 300; i++) {
      const ms = Date.parse('2026-01-01T00:00:00.000Z') + Math.floor(next() * 730 * 86400000);
      const terms = TERMS[i % TERMS.length];
      const inv = { ...invBase, paymentTerms: terms } as Invoice;
      const calls = screenPatch(inv, ms);
      const mine = markSentPatch(inv, new Date(ms).toISOString());
      if (!(calls.length === 1 && same(calls[0], mine))) { diffs++; firstDiff ||= `${new Date(ms).toISOString()} ${terms}: ${JSON.stringify(calls)} vs ${JSON.stringify(mine)}`; }
    }
    ok('300 random clocks over two years (DST both ways), every term: identical patches', diffs === 0, firstDiff);
    ok('markSentPatch writes nothing for an invoice past draft (the log skips it; the screen has no "Mark sent" there)',
      (['sent', 'partially_paid', 'paid', 'overdue'] as const).every((s) => markSentPatch({ ...invBase, status: s } as Invoice, '2026-10-20T15:00:00.000Z') === null));
  }
}

// ── d) rfiBulkClosePlan's patch === persistForm's updates ──────────────────
console.log('\nd) bulk Close equals persistForm\'s save when he flips Status to Closed:');
type H = { at: string; fromParty: string; toParty: string; note?: string };
{
  const HOOK = read('hooks/useCollectionSettled.ts');
  const RFI_SCREEN = read('app/rfi.tsx');
  const start = HOOK.indexOf('// >>> rfi-core-pure');
  const end = HOOK.indexOf('// <<< rfi-core-pure');
  const pStart = RFI_SCREEN.indexOf('const persistForm = useCallback((): RFI | null => {');
  const pEnd = pStart < 0 ? -1 : RFI_SCREEN.indexOf('\n  }, [existingRFI, opened,', pStart);
  const fStart = RFI_SCREEN.indexOf('function rfiFormValuesOf(r: RFI) {');
  const fEnd = fStart < 0 ? -1 : RFI_SCREEN.indexOf('\n}\n', fStart);
  ok('found the rfi-core-pure block, persistForm and rfiFormValuesOf', start > -1 && end > start && pStart > -1 && pEnd > pStart && fStart > -1 && fEnd > fStart,
    'anchors moved — update them');
  if (start > -1 && end > start && pStart > -1 && pEnd > pStart && fStart > -1 && fEnd > fStart) {
    const t = new Bun.Transpiler({ loader: 'ts' });
    const P = new Function(`${t.transformSync(HOOK.slice(start, end).replace(/^export /gm, ''))}
      return { rfiRegressionReason, rfiBallAfterSave, changedFields, RFI_RESPONSE_CONFLICT_REASON };`)() as {
      rfiRegressionReason: RfiBulkCloseDeps['regressionReason'];
      rfiBallAfterSave: (p: { prevBall?: string; handoffs?: H[]; status: string; responseTyped: boolean; dateResponded?: string; now: string }) => { ball: string; added: H[] };
      changedFields: (a: Record<string, unknown>, b: Record<string, unknown>) => Record<string, unknown>;
      RFI_RESPONSE_CONFLICT_REASON: string;
    };
    const formOf = new Function(`${t.transformSync(RFI_SCREEN.slice(fStart, fEnd + 2))}\nreturn rfiFormValuesOf;`)() as (r: RFI) => Record<string, unknown>;
    const body = RFI_SCREEN.slice(pStart + 'const persistForm = useCallback((): RFI | null => {'.length, pEnd);
    const names = ['Date', 'existingRFI', 'opened', 'subject', 'question', 'assignedTo', 'assignedSubId', 'submittedBy', 'dateRequired',
      'priority', 'status', 'linkedDrawing', 'linkedTaskId', 'response', 'attachments', 'formValues', 'responseConflict', 'sourceUnlinked',
      'sourcePhotoIdOf', 'showAlert', 'RFI_RESPONSE_CONFLICT_REASON', 'rfiRegressionReason', 'changedFields', 'rfiFormValuesOf',
      'rfiBallAfterSave', 'updateRFI', 'applyFormValues', 'setOpened'];
    const persist = new Function(...names, t.transformSync(`const __run = () => {${body}\n};\nreturn __run();`));

    /** persistForm on `r` with Status flipped to Closed and nothing else touched. */
    const saveAsClosed = (r: RFI, ms: number): { updates: Partial<RFI>[]; alerts: string[] } => {
      const form: Record<string, unknown> = { ...formOf(r), status: 'closed' };
      const updates: Partial<RFI>[] = [];
      const alerts: string[] = [];
      persist(pinnedDate(ms), r, r, form.subject, form.question, form.assignedTo, form.assignedSubId, form.submittedBy, form.dateRequired,
        form.priority, form.status, form.linkedDrawing, form.linkedTaskId, form.response, form.attachments, form, false, false,
        () => undefined, (title: string) => { alerts.push(title); }, P.RFI_RESPONSE_CONFLICT_REASON, P.rfiRegressionReason, P.changedFields,
        formOf, P.rfiBallAfterSave, (_id: string, u: Partial<RFI>) => { updates.push(u); }, () => {}, () => {});
      return { updates, alerts };
    };
    const deps: RfiBulkCloseDeps = { ballAfterSave: P.rfiBallAfterSave as RfiBulkCloseDeps['ballAfterSave'], regressionReason: P.rfiRegressionReason };

    const base = {
      id: 'rfi-4', projectId: 'p1', number: 4, subject: 'Joist size at grid C', question: 'Confirm 2x10 at 16" o.c.?',
      assignedTo: 'Hale Architects', submittedBy: 'GC', dateSubmitted: '2026-09-01', dateRequired: '2026-09-10', priority: 'normal',
      status: 'answered', attachments: [], createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-05T12:00:00.000Z',
    } as unknown as RFI;
    const cases: [string, RFI][] = [
      ['answered, ball back with the GC (the usual case)', { ...base, ballInCourt: 'gc', response: '2x10 @ 16" o.c.', dateResponded: '2026-09-05T15:00:00.000Z',
        handoffs: [{ at: '2026-09-01T12:00:00.000Z', fromParty: 'gc', toParty: 'architect' }, { at: '2026-09-05T15:00:00.000Z', fromParty: 'architect', toParty: 'gc', note: 'Response received' }] } as RFI],
      ['answered, ball still with the architect', { ...base, ballInCourt: 'architect', response: 'Use LUS210', dateResponded: '2026-09-05T15:00:00.000Z',
        handoffs: [{ at: '2026-09-01T12:00:00.000Z', fromParty: 'gc', toParty: 'architect' }] } as RFI],
      ['answered, no ball or hand-off history on record', { ...base, response: 'OK as drawn' } as RFI],
      ['answered with only the day on record, no text', { ...base, ballInCourt: 'owner', dateResponded: '2026-09-06' } as RFI],
      ['answered, ball already "closed"', { ...base, ballInCourt: 'closed', response: 'Proceed', dateResponded: '2026-09-05T15:00:00.000Z', handoffs: [] } as RFI],
      ['answered, sub-assigned', { ...base, ballInCourt: 'sub', assignedSubId: 'sub-9', response: 'Will do', dateResponded: '2026-09-07T10:00:00.000Z' } as RFI],
    ];
    const clock = Date.parse('2026-09-20T14:30:00.000Z');
    for (const [label, r] of cases) {
      const screen = saveAsClosed(r, clock);
      const plan = rfiBulkClosePlan([r], new Date(clock).toISOString(), deps);
      ok(`${label}: bulk Close writes persistForm's exact updates`,
        screen.alerts.length === 0 && screen.updates.length === 1 && plan.close.length === 1 && same(plan.close[0].patch, screen.updates[0]),
        `screen ${JSON.stringify(screen)} · plan ${JSON.stringify(plan)}`);
    }
    const handed = rfiBulkClosePlan([cases[0][1]], new Date(clock).toISOString(), deps).close[0]?.patch;
    ok('…the hand-off is to "closed", logged "RFI closed by GC", appended to the history',
      handed?.ballInCourt === 'closed' && handed.handoffs?.length === 3
      && same(handed.handoffs?.[2], { at: new Date(clock).toISOString(), fromParty: 'gc', toParty: 'closed', note: 'RFI closed by GC' }),
      JSON.stringify(handed));
    const already = rfiBulkClosePlan([cases[4][1]], new Date(clock).toISOString(), deps).close[0]?.patch;
    ok('…a ball already at "closed" adds no hand-off (status only, as persistForm)', same(already, { status: 'closed' }), JSON.stringify(already));
    ok('the plan is built with the SAME rules RfiLog injects (useCollectionSettled\'s, transpiled here)',
      /rfiBulkClosePlan\(picked, new Date\(\)\.toISOString\(\), \{\s*ballAfterSave: rfiBallAfterSave,\s*regressionReason: rfiRegressionReason,\s*\}\)/.test(read('components/logs/RfiLog.tsx')));
  }
}

// ── e) what each plan skips, and says ──────────────────────────────────────
console.log('\ne) the plans skip what they must and name it:');
{
  const nowIso = '2026-10-20T15:00:00.000Z';
  const mk = (id: string, number: number, status: string, extra: Partial<Invoice> = {}) =>
    ({ ...invBase, id, number, status, ...extra } as Invoice);
  const invs = [
    mk('a', 1, 'draft'),
    mk('b', 2, 'sent'),
    mk('c', 3, 'paid', { amountPaid: 84_000 }),
    mk('d', 4, 'partially_paid', { amountPaid: 1_000 }),
    mk('e', 5, 'draft', { projectId: 'sample' }),
    mk('f', 6, 'overdue'),
    mk('g', 7, 'draft', { paymentTerms: 'net_45' }),
  ];
  const plan = invoiceBulkMarkSentPlan(invs, nowIso, (pid) => pid === 'sample');
  ok('Mark sent writes the non-sample drafts only, one patch each', same(plan.mark.map((m) => m.id), ['a', 'g'])
    && plan.mark.every((m) => same(m.patch, markSentPatch(invs.find((i) => i.id === m.id)!, nowIso))), JSON.stringify(plan.mark));
  ok('…skips sent, partly paid and overdue as "already sent", paid as "paid", the sample job\'s draft as the sample reason',
    same(plan.skipped, [
      { number: 2, reason: MARK_SENT_SKIP.sent }, { number: 3, reason: MARK_SENT_SKIP.paid }, { number: 4, reason: MARK_SENT_SKIP.sent },
      { number: 5, reason: MARK_SENT_SKIP.sample }, { number: 6, reason: MARK_SENT_SKIP.sent },
    ]), JSON.stringify(plan.skipped));
  ok('…the reasons read as the founder default spells them',
    MARK_SENT_SKIP.sent === 'already sent' && MARK_SENT_SKIP.paid === 'paid' && MARK_SENT_SKIP.sample === 'sample job — sends only reach you');
  ok('a sent invoice paid in full reads "paid", not "already sent"',
    invoiceBulkMarkSentPlan([mk('h', 8, 'sent', { amountPaid: 84_000 })], nowIso, () => false).skipped[0]?.reason === MARK_SENT_SKIP.paid);

  const deps: RfiBulkCloseDeps = {
    ballAfterSave: (p) => ({ ball: 'closed', added: [{ at: p.now, fromParty: p.prevBall ?? 'gc', toParty: 'closed', note: 'RFI closed by GC' }] }),
    regressionReason: () => null,
  };
  const r = (id: string, number: number, status: string) => ({ id, number, status, projectId: 'p1' } as unknown as RFI);
  const rp = rfiBulkClosePlan([r('1', 1, 'open'), r('2', 2, 'answered'), r('3', 3, 'closed'), r('4', 4, 'void')], nowIso, deps);
  ok('bulk Close takes answered RFIs only', same(rp.close.map((c) => c.id), ['2']), JSON.stringify(rp.close));
  ok('…open → "not answered yet — close it from its record", closed → "already closed", void → "void"',
    same(rp.skipped, [{ number: 1, reason: RFI_CLOSE_SKIP.open }, { number: 3, reason: RFI_CLOSE_SKIP.closed }, { number: 4, reason: RFI_CLOSE_SKIP.void }])
    && RFI_CLOSE_SKIP.open === 'not answered yet — close it from its record' && RFI_CLOSE_SKIP.closed === 'already closed' && RFI_CLOSE_SKIP.void === 'void',
    JSON.stringify(rp.skipped));
  const blocked = rfiBulkClosePlan([r('5', 5, 'answered')], nowIso, { ...deps, regressionReason: () => 'no' });
  ok('an answered RFI the regression rule refuses is skipped with that rule\'s words, not written', blocked.close.length === 0
    && same(blocked.skipped, [{ number: 5, reason: 'no' }]), JSON.stringify(blocked));
  ok('the skipped line groups by reason, in order',
    logBulkSkippedLine(plan.skipped) === 'Skipped 5: #2, #4, #6 — already sent; #3 — paid; #5 — sample job — sends only reach you.',
    logBulkSkippedLine(plan.skipped));
  ok('…and is empty when nothing was skipped', logBulkSkippedLine([]) === '');
}

// ── f) source pins: queue-backed writers, behind a confirm, enabled ────────
console.log('\nf) the bulk handlers write through the context (the offline queue), after a confirm:');
{
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const rfiLog = strip(read('components/logs/RfiLog.tsx'));
  const invLog = strip(read('components/logs/InvoiceLog.tsx'));
  const closeFn = rfiLog.slice(rfiLog.indexOf('const closeSelected = useCallback('), rfiLog.indexOf('}, [all, updateRFI]);'));
  const sentFn = invLog.slice(invLog.indexOf('const markSentSelected = useCallback('), invLog.indexOf('}, [all, getProject, updateInvoice]);'));
  ok('RfiLog: closeSelected writes each planned RFI with updateRFI(c.id, c.patch), inside the confirm\'s onPress',
    closeFn.length > 0 && /\{ text: `Close \$\{n\}`, onPress: \(\) => plan\.close\.forEach\(\(c\) => updateRFI\(c\.id, c\.patch\)\) \}/.test(closeFn)
    && /\{ text: 'Cancel', style: 'cancel' \}/.test(closeFn) && (closeFn.match(/updateRFI\(/g) ?? []).length === 1);
  ok('InvoiceLog: markSentSelected writes each planned draft with updateInvoice(m.id, m.patch), inside the confirm\'s onPress',
    sentFn.length > 0 && /\{ text: `Mark \$\{n\} sent`, onPress: \(\) => plan\.mark\.forEach\(\(m\) => updateInvoice\(m\.id, m\.patch\)\) \}/.test(sentFn)
    && /\{ text: 'Cancel', style: 'cancel' \}/.test(sentFn) && (sentFn.match(/updateInvoice\(/g) ?? []).length === 1);
  ok('the Mark sent confirm says it emails nobody', /This does not email anything\./.test(sentFn));
  ok('neither log touches supabase (no supabase.from, no import of lib/supabase)',
    !/supabase/.test(rfiLog) && !/supabase/.test(invLog));
  ok('both bulk buttons are ENABLED and wired (founder default 3)',
    /\{ key: 'close', label: 'Close', run: closeSelected \}/.test(rfiLog) && /\{ key: 'sent', label: 'Mark sent', run: markSentSelected \}/.test(invLog)
    && !/disabledReason/.test(rfiLog) && !/disabledReason/.test(invLog));
  // The host screen refetches on open/foreground; RfiLog must not add a second
  // invalidate (react-query's cancelRefetch would cancel the host's request).
  const rfiHost = readFileSync(join(ROOT, 'app/rfi.tsx'), 'utf8');
  ok('the RFI host refetches the collection on open (so a plan runs on the live copy), and RfiLog does not refetch twice',
    /useRefetchCollectionOnOpen\('rfis'\);/.test(rfiHost) && /<RfiLog\b/.test(rfiHost) && !/useRefetchCollectionOnOpen\(/.test(rfiLog));
  ok('InvoiceLog builds its plan with the sample-job rule', /invoiceBulkMarkSentPlan\(picked, new Date\(\)\.toISOString\(\), \(pid\) => isSampleProject\(getProject\(pid\)\)\)/.test(sentFn));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  console.error('✗ validate-log-bulk');
  process.exit(1);
}
console.log('✓ validate-log-bulk: bulk Close and Mark sent write exactly what their record screens write, through the queue, after a confirm');
