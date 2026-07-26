#!/usr/bin/env bun
// scripts/validate-portfolio-clientbook.ts
// Pinned validator for buildClientBook + normalizeClientKey.
// Covers: key normalization (email > phone > name), payment latency,
// CO friction, repeat detection, unattributed count, coverage note.

import { buildClientBook, normalizeClientKey } from '../utils/portfolio/clientBook';
import type { Project, Invoice, ChangeOrder } from '../types';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

const NOW_ISO = '2026-07-25T12:00:00Z';

// ── normalizeClientKey ─────────────────────────────────────────────────────

console.log('\nTest 1: normalizeClientKey priority');
assert('email wins over phone+name', normalizeClientKey({ email: 'A@B.com', phone: '555', name: 'X' }) === 'a@b.com');
assert('phone when no email (digits only)', normalizeClientKey({ phone: '(303) 555-1234', name: 'X' }) === '3035551234');
assert('name fallback when no email/phone', normalizeClientKey({ name: 'Alice Smith' }) === 'alice smith');
assert('null when all empty', normalizeClientKey({ email: '', phone: '', name: '' }) === null);
assert('null when undefined', normalizeClientKey(undefined) === null);

// ── Fixture helpers ────────────────────────────────────────────────────────

function makeProject(id: string, email: string | null, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `Project ${id}`,
    type: 'renovation',
    location: 'Denver',
    squareFootage: 1000,
    quality: 'standard',
    description: '',
    status: 'completed',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    estimate: null,
    linkedEstimate: email
      ? { id: `e${id}`, grandTotal: 100_000, lineItems: [], version: 1, createdAt: '', updatedAt: '' }
      : null,
    primaryContact: email ? { email, name: `Owner ${id}` } : undefined,
    ...overrides,
  } as Project;
}

function makeInvoice(id: string, projectId: string, totalDue: number, daysToFullPay?: number): Invoice {
  const issueDate = '2026-01-01';
  const pmtDate = daysToFullPay != null
    ? new Date(Date.parse(issueDate + 'T00:00:00Z') + daysToFullPay * 86_400_000).toISOString().slice(0, 10)
    : undefined;
  return {
    id,
    number: 1,
    projectId,
    type: 'full',
    issueDate,
    dueDate: '2026-02-01',
    paymentTerms: 'net_30',
    notes: '',
    lineItems: [],
    subtotal: totalDue,
    taxRate: 0,
    taxAmount: 0,
    totalDue,
    amountPaid: pmtDate ? totalDue : 0,
    status: pmtDate ? 'paid' : 'sent',
    payments: pmtDate ? [{ id: 'pmt1', date: pmtDate, amount: totalDue, method: 'check' }] : [],
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  } as Invoice;
}

function makeChangeOrder(id: string, projectId: string, status: ChangeOrder['status']): ChangeOrder {
  return {
    id,
    number: 1,
    projectId,
    date: '2026-03-01',
    description: 'Extra work',
    reason: 'Owner request',
    lineItems: [],
    originalContractValue: 100_000,
    changeAmount: 5_000,
    newContractTotal: 105_000,
    status,
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
  } as ChangeOrder;
}

// ── Test 2: repeat client detection ───────────────────────────────────────

console.log('\nTest 2: Repeat client detected');
{
  const p1 = makeProject('p1', 'alice@example.com');
  const p2 = makeProject('p2', 'alice@example.com');
  const p3 = makeProject('p3', 'bob@example.com');
  const result = buildClientBook({ projects: [p1, p2, p3], invoices: [], changeOrders: [] });

  const alice = result.clients.find(c => c.key === 'alice@example.com');
  const bob = result.clients.find(c => c.key === 'bob@example.com');
  assert('alice repeat = true (2 projects)', alice?.repeat === true);
  assert('alice projectCount = 2', alice?.projectCount === 2);
  assert('bob repeat = false (1 project)', bob?.repeat === false);
  assert('2 clients total', result.clients.length === 2);
  assert('0 unattributed', result.unattributedCount === 0);
}

// ── Test 3: payment latency ───────────────────────────────────────────────

console.log('\nTest 3: Payment latency median');
{
  const p1 = makeProject('p1', 'payer@example.com');
  const inv1 = makeInvoice('inv1', 'p1', 10_000, 15); // paid in 15 days
  const inv2 = makeInvoice('inv2', 'p1', 10_000, 25); // paid in 25 days
  const result = buildClientBook({ projects: [p1], invoices: [inv1, inv2], changeOrders: [] });
  const client = result.clients[0]!;
  // Median of [15, 25] = 20
  assert('medianDaysToPaid = 20', client.payment.medianDaysToPaid === 20, `got ${client.payment.medianDaysToPaid}`);
}

// ── Test 4: CO friction ───────────────────────────────────────────────────

console.log('\nTest 4: CO friction metrics');
{
  const p1 = makeProject('p1', 'friction@example.com');
  const co1 = makeChangeOrder('co1', 'p1', 'rejected');
  const co2 = makeChangeOrder('co2', 'p1', 'approved');
  const co3 = makeChangeOrder('co3', 'p1', 'approved');
  const result = buildClientBook({ projects: [p1], invoices: [], changeOrders: [co1, co2, co3] });
  const client = result.clients[0]!;
  assert('CO count = 3', client.coFriction.count === 3);
  // rejectionRate = 1/3
  assert('rejection rate ≈ 33%', Math.abs(client.coFriction.rejectionRate - 1/3) < 0.001);
}

// ── Test 5: unattributed projects ─────────────────────────────────────────

console.log('\nTest 5: Unattributed projects (no primaryContact)');
{
  const pNoContact = makeProject('px', null);
  const result = buildClientBook({ projects: [pNoContact], invoices: [], changeOrders: [] });
  assert('unattributedCount = 1', result.unattributedCount === 1);
  assert('no clients in book', result.clients.length === 0);
  assert('coverage note mentions 0 of 1', result.coverageNote.includes('0') && result.coverageNote.includes('1'));
}

// ── Test 6: never throws on empty ─────────────────────────────────────────

console.log('\nTest 6: Empty input — never throws');
{
  let threw = false;
  try {
    buildClientBook({ projects: [], invoices: [], changeOrders: [] });
  } catch { threw = true; }
  assert('did not throw', !threw);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nportfolio-clientbook: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
