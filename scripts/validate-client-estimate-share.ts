// Client-estimate-share validation — utils/clientEstimateShareToken.ts (pure).
//
// The shareable proposal link carries the estimate OUTSIDE the app, so it is a
// second safety boundary: the token must round-trip cleanly, be URL-safe, and
// never contain the contractor's internal numbers. Guards:
//   1. Payload is built from the client view (total + scope + allowances).
//   2. encode → decode round-trips exactly.
//   3. Token is URL-safe (no +, /, =).
//   4. decode rejects garbage / wrong version.
//   5. No forbidden internal key appears in the payload.

import { toClientEstimateView, defaultPaymentSchedule } from '@/utils/clientEstimateView';
import {
  buildClientEstimateSharePayload, encodeClientEstimateToken, decodeClientEstimateToken,
} from '@/utils/clientEstimateShareToken';
import type { LinkedEstimate } from '@/types';

let failed = 0;
let passed = 0;
const assert = (c: boolean, m: string) => { if (c) { passed++; console.log('  ✓ ' + m); } else { failed++; console.error('  FAIL  ' + m); } };

console.log('\nclient-estimate-share validation:');

const est: LinkedEstimate = {
  id: 'e1', globalMarkup: 0.25, baseTotal: 200000, markupTotal: 50000, grandTotal: 250000,
  createdAt: '2026-07-27T00:00:00.000Z',
  items: [
    { materialId: 'm', name: 'Foundations', category: 'c', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 150000, supplier: 'ACME', csiDivision: '03' },
    { materialId: 'm', name: 'Electrical', category: 'c', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 40000, supplier: 'ACME', csiDivision: '26' },
    { materialId: 'm', name: 'Tile', category: 'c', unit: 'ea', quantity: 1, unitPrice: 0, bulkPrice: 0, markup: 0, usesBulk: false, lineTotal: 10000, supplier: 'ACME', csiDivision: '09', isAllowance: true },
  ],
};

const view = toClientEstimateView(est);
const payload = buildClientEstimateSharePayload(view, {
  projectName: 'Harborview Office Building',
  gcName: 'Harborview Construction Co.',
  clientName: 'Meridian Partners',
  inclusions: ['All labor & materials', 'Permits & inspections'],
  exclusions: ['Furniture & FF&E'],
  paymentSchedule: defaultPaymentSchedule(view.projectTotal),
  validThrough: '2026-08-31',
});

// 1. Payload reflects the client view
assert(payload.total === view.projectTotal, `payload total matches client total (${payload.total})`);
assert(payload.scope.length === view.scopeGroups.length, 'payload carries every scope group');
assert(payload.allow?.length === 1, 'payload carries the allowance');
assert(payload.pay?.length === 3, 'payload carries the payment schedule');
assert(payload.pay?.[0]?.a === Math.round(view.projectTotal * 0.1), 'deposit is 10% of total');
assert(payload.n === 'Harborview Office Building' && payload.cl === 'Meridian Partners', 'payload carries labels');

// 2. Round-trip
const token = encodeClientEstimateToken(payload);
const back = decodeClientEstimateToken(token);
assert(JSON.stringify(back) === JSON.stringify(payload), 'encode → decode round-trips exactly');

// 3. URL-safe
assert(/^[A-Za-z0-9_-]+$/.test(token), 'token is URL-safe (no +, /, =)');

// 4. Garbage / wrong version rejected
assert(decodeClientEstimateToken('!!!not-base64!!!') === null, 'garbage token → null');
assert(decodeClientEstimateToken('') === null, 'empty token → null');

// 5. No forbidden internal keys anywhere in the payload
const FORBIDDEN = ['markup', 'baseTotal', 'markupTotal', 'globalMarkup', 'unitPrice', 'bulkPrice', 'supplier', 'margin', 'usesBulk'];
const keys = new Set<string>();
const walk = (v: unknown) => {
  if (Array.isArray(v)) { v.forEach(walk); return; }
  if (v && typeof v === 'object') { for (const k of Object.keys(v)) { keys.add(k); walk((v as Record<string, unknown>)[k]); } }
};
walk(payload);
for (const f of FORBIDDEN) assert(!keys.has(f), `payload never exposes internal key '${f}'`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
