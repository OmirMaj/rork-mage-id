// validate-invoice-dunning-due-date.ts — a due date the app moves must reach
// the server, because invoice-dunning counts "days overdue" from the SERVER's
// invoices.due_date.
//
// WHY THIS EXISTS (audit round 2, #13). ProjectContext.updateInvoice queues
// only the columns it lists, and due_date / payment_terms / progress_percent
// were not among them (only addInvoice wrote them). Two everyday paths move the
// due date through updateInvoice:
//
//   * Sending a saved draft. app/invoice.tsx recomputes dueDate from today and
//     the terms. Draft saved Sep 1 net-15 (server due_date Sep 16), sent Oct 20:
//     the app said "due Nov 4", the server kept Sep 16, and the homeowner's
//     FIRST reminder was "Final notice — Invoice #7 is 34 days overdue".
//   * Releasing retainage on a paid invoice (utils/retainage.ts
//     buildRetainageReleasePatch). It re-opens the invoice with a fresh dueDate
//     and dunningStage 0; the stage reached the server, the date did not, so a
//     closeout release on an invoice due in March drew a 200-day FINAL NOTICE
//     the morning the GC released it.
//
// The next refetch hydrates dueDate from r.due_date, so the device lost the new
// date too — the GC could not see anything had gone wrong.
//
// WHAT THIS PINS. The payload builder (utils/invoiceWrites, which the shipped
// contexts/ProjectContext.tsx is held to calling) is executed against the real release patch and
// a draft-then-send edit. A presence regex would pass a column written under
// the wrong condition.
//
// The invoice-dunning "skip if updated_at is newer than the due date" rule the
// audit first proposed was deliberately NOT built (its reviewers dropped it):
// once the column is written it only hides a missing write, and on a real
// overdue invoice any later touch — a partial payment, a note — would silence
// every reminder after it. Check 4 keeps it from creeping in.
//
// PROJECT_CONTEXT_PATH overrides the file (used to mutation-test a patched copy).
//
// Run via: bun run scripts/validate-invoice-dunning-due-date.ts

import { readFileSync } from 'node:fs';
import { join, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRetainageReleasePatch, PAYMENT_TERM_DAYS } from '../utils/retainage';
import { invoiceUpdatePayload } from '../utils/invoiceWrites';
import type { Invoice } from '../types';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(isAbsolute(p) ? p : join(ROOT, p), 'utf8');

let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log('  ✓', label);
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

const CTX = process.env.PROJECT_CONTEXT_PATH || 'contexts/ProjectContext.tsx';
const src = read(CTX);

console.log(`\ninvoice due date reaches the server (${CTX}):\n`);

// ── the updateInvoice payload builder ──────────────────────────────────────
// It moved out of the context into utils/invoiceWrites.ts (blocker #3: the
// context now runs it on the latest list, or on `{ id, ...updates }` for a row
// not in memory). It is imported and executed here; the context is held to
// calling it, so a second inline builder cannot drift from this one.
const fnStart = src.indexOf('const updateInvoice = useCallback(');
const fnEnd = src.indexOf('const getInvoicesForProject = useCallback(', fnStart);
const updateBody = fnStart >= 0 && fnEnd > fnStart ? src.slice(fnStart, fnEnd) : '';
check('ProjectContext.updateInvoice builds its payload with invoiceUpdatePayload',
  /const payload = invoiceUpdatePayload\(inv, updates, id, now\);/.test(updateBody)
  && !/payload\.due_date =/.test(updateBody));

/** What updateInvoice does: merge, then build the queued payload. */
const queued = (prev: Invoice, updates: Partial<Invoice>) =>
  invoiceUpdatePayload({ ...prev, ...updates } as Invoice, updates, prev.id, '2026-10-20T15:00:00.000Z');

const base = {
  id: 'inv-7', projectId: 'p1', number: 7, type: 'full', status: 'draft',
  issueDate: '2026-09-01', dueDate: '2026-09-16T12:00:00.000Z', paymentTerms: 'net_15',
  notes: '', lineItems: [], subtotal: 84_000, taxRate: 0, taxAmount: 0, totalDue: 84_000,
  amountPaid: 0, payments: [], createdAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T12:00:00.000Z',
} as unknown as Invoice;

// ── 1. draft → send ────────────────────────────────────────────────────────
console.log('  1. sending a saved draft');
{
  const sendEdit: Partial<Invoice> = {
    paymentTerms: 'net_15', dueDate: '2026-11-04T15:00:00.000Z', status: 'sent',
    progressPercent: undefined,
  };
  const p = queued(base, sendEdit);
  check('the recomputed due date is queued', p.due_date === '2026-11-04T15:00:00.000Z', JSON.stringify(p));
  check('...with the terms it was computed from', p.payment_terms === 'net_15', JSON.stringify(p));
  check('...and a cleared progress percent reaches the server as null, not an omitted key',
    'progress_percent' in p && p.progress_percent === null, JSON.stringify(p));
  check('...and the status', p.status === 'sent');

  // The screen really does hand these to updateInvoice on both send paths.
  const screen = read('app/invoice.tsx');
  const sendCalls = screen.match(/updateInvoice\(existingInvoice\.id, \{[\s\S]{0,400}?dueDate,[\s\S]{0,120}?status/g) ?? [];
  check('app/invoice.tsx passes dueDate on the save and the send of an existing invoice', sendCalls.length >= 2,
    `found ${sendCalls.length}`);

  const notesOnly = queued(base, { notes: 'gate code 4411' });
  check('an unrelated edit does not touch due_date / payment_terms / progress_percent',
    !('due_date' in notesOnly) && !('payment_terms' in notesOnly) && !('progress_percent' in notesOnly),
    JSON.stringify(notesOnly));
}

// ── 1b. draft → "Mark sent" on the status pipeline ────────────────────────
// The OTHER way a draft becomes sent: he prints or texts the PDF himself and
// taps the pipeline's "Mark sent". That handler wrote only `status`, so the
// server kept the due date from the day the draft was saved and the first
// reminder could be a FINAL NOTICE. The shipped handler is EXTRACTED from
// app/invoice.tsx and executed with stubs.
console.log('\n  1b. "Mark sent" on a saved draft (the status pipeline)');
{
  const screen = read('app/invoice.tsx');
  const hStart = screen.indexOf('onAdvance={(next) => {');
  const hEnd = hStart < 0 ? -1 : screen.indexOf('\n                }}', hStart);
  const gStart = screen.indexOf('function getDueDate(issueDate: string, terms: PaymentTerms): string {');
  const gEnd = gStart < 0 ? -1 : screen.indexOf('\n}\n', gStart);
  if (hStart < 0 || hEnd < 0 || gStart < 0 || gEnd < 0) {
    check('found the pipeline onAdvance handler and getDueDate in app/invoice.tsx', false, 'anchors moved — update them');
  } else {
    const handlerBody = screen.slice(hStart + 'onAdvance={(next) => {'.length, hEnd);
    const getDueSrc = screen.slice(gStart, gEnd + 2);
    const t = new Bun.Transpiler({ loader: 'ts' });
    const runAdvance = new Function('PAYMENT_TERM_DAYS', 'existingInvoice', 'updateInvoice', 'openRecordPayment', 'next',
      t.transformSync(`${getDueSrc}\n${handlerBody}`)) as (
      days: typeof PAYMENT_TERM_DAYS, inv: Invoice, upd: (id: string, u: Partial<Invoice>) => void, orp: () => void, next: string,
    ) => void;
    const calls: Partial<Invoice>[] = [];
    runAdvance(PAYMENT_TERM_DAYS, base, (_id, u) => { calls.push(u); }, () => {}, 'sent');
    const patch = calls[0] ?? {};
    const today = new Date();
    const want = new Date(today); want.setDate(want.getDate() + 15);
    const got = patch.dueDate ? new Date(patch.dueDate) : null;
    check('Mark sent on a draft writes a due date = today + its terms (net 15)',
      calls.length === 1 && patch.status === 'sent' && !!got && Math.abs(got.getTime() - want.getTime()) < 60_000,
      JSON.stringify(calls));
    const p = queued(base, patch);
    check('...and that due date reaches the queued server write', typeof p.due_date === 'string' && p.due_date === patch.dueDate, JSON.stringify(p));
    // A non-draft advance keeps its old shape; "paid" still routes to Record Payment.
    const calls2: Partial<Invoice>[] = []; let recorded = 0;
    runAdvance(PAYMENT_TERM_DAYS, { ...base, status: 'sent' } as Invoice, (_id, u) => { calls2.push(u); }, () => { recorded++; }, 'paid');
    check('"Mark paid" still opens Record Payment and writes nothing itself', recorded === 1 && calls2.length === 0, JSON.stringify(calls2));
  }
}

// ── 2. retainage release re-opens a paid invoice ───────────────────────────
console.log('\n  2. releasing retainage on a paid invoice');
{
  const paid = {
    ...base, id: 'inv-3', number: 3, status: 'paid', dueDate: '2026-03-01T12:00:00.000Z',
    paymentTerms: 'net_30', retentionPercent: 10, retentionAmount: 8_400, retentionReleased: 0,
    amountPaid: 75_600,
  } as unknown as Invoice;
  const out = buildRetainageReleasePatch(paid, 8_400, {
    now: '2026-09-17T14:00:00.000Z',
    makeId: () => 'rel-1',
    dueDateFor: () => '2026-10-17T14:00:00.000Z',
  });
  check('the release re-opens the invoice (fixture sanity)', out?.reopened === true, JSON.stringify(out));
  const p = out ? queued(paid, out.patch) : {};
  check('the fresh due date is queued', p.due_date === '2026-10-17T14:00:00.000Z', JSON.stringify(p));
  check('...alongside the reset dunning stage', p.dunning_stage === 0, JSON.stringify(p));
}

// ── 3. the progress percent QBO reads ──────────────────────────────────────
console.log('\n  3. an edited progress percent');
{
  const p = queued({ ...base, type: 'progress', progressPercent: 30 } as Invoice, { progressPercent: 45 });
  check('progress_percent is queued', p.progress_percent === 45, JSON.stringify(p));
}

// ── 4. no dunning guard that hides a missing write ─────────────────────────
console.log('\n  4. invoice-dunning trusts the due date instead of guessing around it');
{
  const dunning = read('supabase/functions/invoice-dunning/index.ts');
  check('invoice-dunning does not skip on updated_at',
    !/updated_at/.test(dunning),
    'A "skip when updated_at is newer than due_date" rule silences every reminder on an overdue invoice ' +
    'that is touched after its due date (a partial payment, a note). Fix the write, not the reader.');
}

// ── 5. the new due date reaches QuickBooks too ─────────────────────────────
// qbo-sync reads the invoice off the SERVER row. Fired in the same tick as the
// row write, it could read the pre-edit row and stamp it 'synced' after the
// write landed — the new due_date / progress_percent (sections 1 and 3) never
// reached QuickBooks, and the reconciler only retries rows that are NOT
// 'synced'. The invoice push must wait for the row, as the payment push does.
console.log('\n  5. the QuickBooks invoice push waits for the row write');
{
  const body = src.slice(fnStart, src.indexOf('const getInvoicesForProject = useCallback(', fnStart));
  const chained = /void invoiceWrite\.then\(synced => \{\s*if \(!synced\) return;\s*void import\('@\/utils\/qboSync'\)\.then\(m => m\.triggerQboSync\('invoice', 'upsert', id\)\);\s*\}\);/;
  check('the invoice push runs only after invoiceWrite resolved synced', chained.test(body));
  const bare = body.replace(chained, '');
  check('...and there is no same-tick invoice push left beside it',
    !/triggerQboSync\('invoice', 'upsert', id\)/.test(bare));
}

if (failures > 0) {
  console.error(`\n✗ validate-invoice-dunning-due-date: ${failures} failure(s)\n`);
  process.exit(1);
}
console.log('\n✓ validate-invoice-dunning-due-date: all checks passed\n');
