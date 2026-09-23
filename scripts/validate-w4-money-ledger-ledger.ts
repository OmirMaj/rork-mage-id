#!/usr/bin/env bun
// scripts/validate-w4-money-ledger-ledger.ts
//
// Audit wave 4, lane money-ledger — #80 (= #35, BLOCKER) and #85.
//
// #80: a payment recorded from a stale or offline phone wrote the device's
// WHOLE ledger (payments + amount_paid + status) and the offline queue
// replayed it — erasing a Stripe payment the client had already made. The
// fix: payments are appended on the server (invoice_append_payment, executed
// in PGlite by the lane's migration test), the client never writes the ledger
// columns, and the pay-link re-mint is computed from the SERVER's balance.
//
// #85: the weekly snapshot and the client book dated payments by when he
// tapped Save instead of the 'Date received'.
//
// Executed where possible (invoiceUpdatePayload, afterRecordedPayment,
// buildRetainageReleasePatch, buildClientBook); source-pinned only where the
// code is a screen.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoiceUpdatePayload, afterRecordedPayment, insertStillQueued } from '../utils/invoiceWrites';
import { buildRetainageReleasePatch } from '../utils/retainage';
import { buildClientBook } from '../utils/portfolio/clientBook';
import type { Invoice, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0, failed = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}

// ── #80: the client never writes the ledger ────────────────────────────────
console.log('\n#80 invoiceUpdatePayload never writes the ledger columns');
{
  const inv: Partial<Invoice> = {
    id: 'inv1', status: 'partially_paid', amountPaid: 300,
    payments: [{ id: 'p1', date: '2026-09-19T15:00:00Z', amount: 300, method: 'check' }],
  };
  const p1 = invoiceUpdatePayload(inv, { amountPaid: 300, payments: inv.payments, status: 'partially_paid' }, 'inv1', 'now');
  ok('a payment edit sends no payments', !('payments' in p1));
  ok('…no amount_paid', !('amount_paid' in p1));
  ok('…and no status computed from the same stale balance', !('status' in p1), JSON.stringify(p1));
  const p2 = invoiceUpdatePayload(inv, { amountPaid: 300 }, 'inv1', 'now');
  ok('amountPaid alone writes neither', !('amount_paid' in p2) && !('payments' in p2) && !('status' in p2));
  const p3 = invoiceUpdatePayload({ ...inv, status: 'sent' }, { status: 'sent' }, 'inv1', 'now');
  ok('a status-only edit (Mark sent) still writes status', p3.status === 'sent');
  const p4 = invoiceUpdatePayload(inv, { notes: 'x' }, 'inv1', 'now');
  ok('a passive edit touches none of them', !('status' in p4) && !('payments' in p4) && !('amount_paid' in p4));
  ok('insertStillQueued keeps its frozen signature (co-workflow / rfi-core import it)',
    insertStillQueued.length === 3 && insertStillQueued([{ table: 'invoices', operation: 'insert', data: { id: 'a' } }], 'invoices', 'a'));
}

console.log('\n#80 the re-mint charges the SERVER\'s balance');
{
  const server = {
    total_due: '20000', amount_paid: '20300', subtotal: '20000', retention_percent: null,
    retention_amount: null, retention_released: null, status: 'paid', pay_pending_at: null,
  };
  const f1 = afterRecordedPayment('synced', server, { hadPayLink: true, localStatus: 'partially_paid' });
  ok('a stale phone whose client already paid by card does NOT re-mint (server balance 0)',
    f1.recorded && f1.remintFor === null && f1.serverBalance === 0 && f1.status === 'paid', JSON.stringify(f1));
  const f2 = afterRecordedPayment('synced', { ...server, amount_paid: '5000', status: 'partially_paid' }, { hadPayLink: true, localStatus: 'partially_paid' });
  ok('a real remaining balance re-mints for exactly the server figure', f2.remintFor === 15000, JSON.stringify(f2));
  const f3 = afterRecordedPayment('synced', { ...server, total_due: '10000', subtotal: '10000', retention_percent: '10', amount_paid: '4000', status: 'partially_paid' },
    { hadPayLink: true, localStatus: 'partially_paid' });
  ok('…net of held retention ($10,000 less 10% held less $4,000 = $5,000)', f3.remintFor === 5000, JSON.stringify(f3));
  const f4 = afterRecordedPayment('queued', null, { hadPayLink: true, localStatus: 'partially_paid' });
  ok('queued (offline): recorded, and no mint from a balance the server has not moved to', f4.recorded && f4.remintFor === null);
  const f5 = afterRecordedPayment('failed', null, { hadPayLink: true, localStatus: 'paid' });
  ok('failed: NOT recorded', f5.recorded === false && f5.remintFor === null);
  const f6 = afterRecordedPayment('synced', { ...server, amount_paid: '5000', pay_pending_at: '2026-09-18T00:00:00Z' }, { hadPayLink: true, localStatus: 'partially_paid' });
  ok('no mint while a bank payment is processing (#83)', f6.remintFor === null);
  const f7 = afterRecordedPayment('synced', { ...server, amount_paid: '5000' }, { hadPayLink: false, localStatus: 'partially_paid' });
  ok('no link before, no link minted after', f7.remintFor === null);
  const f8 = afterRecordedPayment('synced', null, { hadPayLink: true, localStatus: 'partially_paid' });
  ok('an unreadable server row skips the mint rather than guessing', f8.recorded && f8.remintFor === null);
}

console.log('\n#80 the retention release writes no ledger column');
{
  const out = buildRetainageReleasePatch({
    id: 'i', number: 1, subtotal: 10000, totalDue: 10000, amountPaid: 9000, status: 'paid',
    paymentTerms: 'net_30', retentionPercent: 10, retentionAmount: 1000, retentionReleased: 0,
    payLinkUrl: 'https://x',
  }, 1000, { now: '2026-09-19T12:00:00Z', makeId: () => 'r1', dueDateFor: () => '2026-10-19' });
  const keys = Object.keys(out?.patch ?? {});
  ok('patch keys are retention + status/due/dunning + the local pay-link clear only',
    !!out && keys.every(k => ['retentionReleased', 'retentionReleases', 'status', 'dueDate', 'dunningStage', 'payLinkUrl', 'payLinkId', 'payLinkAmount'].includes(k))
    && !keys.includes('payments') && !keys.includes('amountPaid'), keys.join(','));
  const payload = invoiceUpdatePayload({ id: 'i', ...(out?.patch ?? {}) }, out?.patch ?? {}, 'i', 'now');
  ok('…and its server payload carries no payments / amount_paid', !('payments' in payload) && !('amount_paid' in payload));
}

console.log('\n#80 commitPayment records through recordInvoicePayment');
{
  const src = read('app/invoice.tsx');
  const start = src.indexOf('const commitPayment = useCallback(');
  const end = src.indexOf('const handleMarkPaid = useCallback(');
  const body = start > -1 && end > start ? src.slice(start, end) : '';
  ok('commitPayment found', body.length > 0);
  ok('it appends ONE entry via recordInvoicePayment', /await recordInvoicePayment\(existingInvoice\.id, payment\)/.test(body));
  ok('it never hands updateInvoice a payments array, amountPaid or status', !/updateInvoice\(/.test(body));
  // Integration round 1 put a three-line WHY comment above the alert: window 600.
  // Round 2 (data-sync) put the HELD branch ('Payment not sent', also returns)
  // before it: window 2000, and that branch is pinned too.
  ok('a failed write is never reported as recorded', /if \(outcome === 'failed'\) \{[\s\S]{0,2000}Payment not recorded[\s\S]{0,400}return;/.test(body)
    && /if \(held\) \{\s*showAlert\(\s*'Payment not sent',[\s\S]{0,600}?\);\s*return;\s*\}/.test(body));
  ok('the re-mint is driven by afterRecordedPayment (the server\'s balance)',
    /afterRecordedPayment\(outcome, server,/.test(body) && /mintPayLinkFor\(existingInvoice, follow\.remintFor\)/.test(body)
    && !/mintPayLinkFor\(existingInvoice, newBalance\)/.test(body));
  ok('the server row is read after the append, only when it synced',
    /if \(outcome === 'synced'\) \{[\s\S]{0,200}from\('invoices'\)[\s\S]{0,200}\.select\('total_due,amount_paid,subtotal,retention_percent,retention_amount,retention_released,status,pay_pending_at'\)/.test(body));
  ok('no screen path writes a whole payments array', !/payments: \[\.\.\.\(existingInvoice\.payments/.test(src));
}

console.log('\n#80 the migration');
{
  const sql = read('supabase/migrations/20260920020000_invoice_payment_ledger.sql');
  ok('invoice_append_payment(p_invoice_id uuid, p_entry jsonb) returns jsonb, SECURITY DEFINER, search_path \'\'',
    /create or replace function public\.invoice_append_payment\(p_invoice_id uuid, p_entry jsonb\)\s+returns jsonb\s+language plpgsql\s+security definer\s+set search_path = ''/.test(sql));
  ok('row lock', /from public\.invoices where id = p_invoice_id for update/.test(sql));
  ok('errors: invoice_not_found P0002, not_invoice_owner 42501',
    /'invoice_not_found' using errcode = 'P0002'/.test(sql) && /'not_invoice_owner' using errcode = '42501'/.test(sql));
  ok('execute to authenticated + service_role only',
    /revoke all on function public\.invoice_append_payment\(uuid, jsonb\) from public, anon;/.test(sql)
    && /grant execute on function public\.invoice_append_payment\(uuid, jsonb\) to authenticated, service_role;/.test(sql));
  ok('the ledger guard acts on client roles only',
    /if current_user not in \('authenticated', 'anon'\) then\s+return new;/.test(sql)
    && /create trigger invoices_ledger_guard\s+before update on public\.invoices/.test(sql));
  ok('CONTRACT 3 columns on both tables', ['invoices', 'aia_pay_apps'].every(t =>
    new RegExp(`alter table public\\.${t}\\s+add column if not exists pay_pending_at\\s+timestamptz`).test(sql)
    && new RegExp(`alter table public\\.${t}\\s+add column if not exists pay_pending_amount\\s+numeric\\(12,2\\)`).test(sql)
    && new RegExp(`alter table public\\.${t}\\s+add column if not exists pay_pending_session text`).test(sql)));
  ok('an id-less entry cannot slip through a NULL in the OR chain',
    /jsonb_typeof\(p_entry -> 'id'\) is distinct from 'string'/.test(sql));
}

// ── #85: dated by the day received ──────────────────────────────────────────
console.log('\n#85 days-to-pay and the weekly window use the day RECEIVED');
{
  const project = {
    id: 'p1', name: 'P', primaryContact: { name: 'Owner', email: 'o@x.com' },
    estimate: null, createdAt: '2026-01-01', updatedAt: '2026-01-01', status: 'active',
  } as unknown as Project;
  // Issued Sep 1; a check RECEIVED Sep 5 but keyed in Sep 15.
  const invoice = {
    id: 'i1', projectId: 'p1', number: 1, issueDate: '2026-09-01', dueDate: '2026-10-01',
    totalDue: 1000, subtotal: 1000, amountPaid: 1000, status: 'paid', lineItems: [], taxRate: 0, taxAmount: 0,
    payments: [{ id: 'c1', date: '2026-09-15T22:00:00.000Z', receivedDate: '2026-09-05', amount: 1000, method: 'check' }],
  } as unknown as Invoice;
  const book = buildClientBook({ projects: [project], invoices: [invoice], changeOrders: [] });
  ok('client book: 4 days to pay (Sep 1 → Sep 5), not 14 from the keying instant',
    book.clients[0]?.payment.medianDaysToPaid === 4, JSON.stringify(book.clients[0]?.payment));
  const legacy = { ...invoice, payments: [{ id: 'c2', date: '2026-09-11T12:00:00', amount: 1000, method: 'check' }] } as unknown as Invoice;
  const book2 = buildClientBook({ projects: [project], invoices: [legacy], changeOrders: [] });
  ok('a legacy payment with no received day still counts from its recorded date', book2.clients[0]?.payment.medianDaysToPaid === 10,
    JSON.stringify(book2.clients[0]?.payment));
  const ws = read('app/weekly-snapshot.tsx');
  ok('weekly snapshot filters payments by paymentReceivedAt(...).getTime() against the window',
    /paymentReceivedAt\(p as InvoicePayment & RecordedPaymentFields\)\.getTime\(\);\s*return Number\.isFinite\(t\) && t >= range\.start && t <= range\.end;/.test(ws));
  ok('…and no longer by the keying instant', !/\.filter\(p => inRange\(p\.date\)\)/.test(ws));
  const cb = read('utils/portfolio/clientBook.ts');
  ok('client book no longer Date.parse-s payment dates', !/Date\.parse\(a\.date\)|Date\.parse\(pmt\.date\)/.test(cb));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
