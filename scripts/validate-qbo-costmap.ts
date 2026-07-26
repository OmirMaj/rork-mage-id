// scripts/validate-qbo-costmap.ts
// Run: bun scripts/validate-qbo-costmap.ts
//
// Tests for utils/qbo/qboCostMap.ts (F5 — QBO cost pull, client mapping half):
//   - qboReceiptId: deterministic `qbo-<type>-<qboId>-<lineId>` ids —
//     idempotent re-materialization across devices/cache wipes
//   - stagedLineToReceipt: field mapping, origin:'qbo', status:'reviewed',
//     single synthetic line; unmapped rows (null project, no override) →
//     null — nothing silent into the cost book (G11)
//   - findLikelyDuplicate: same-vendor + total ±5% + txn_date within 7 days
//     against SCANNED receipts only (qbo-origin receipts never flag)

import {
  qboReceiptId,
  stagedLineToReceipt,
  findLikelyDuplicate,
  type QboCostLineRow,
} from '../utils/qbo/qboCostMap';
import type { MaterialReceipt } from '../types';

let failures = 0;
function assert(cond: boolean, msg: string, extra?: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}${extra ? ` — ${extra}` : ''}`);
    failures++;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<QboCostLineRow> = {}): QboCostLineRow {
  return {
    id: 'row-1',
    qbo_type: 'purchase',
    qbo_id: '184',
    qbo_line_id: '1',
    doc_number: 'INV-4471',
    vendor: 'Builders Supply Co',
    txn_date: '2026-07-22',
    amount: 1840.5,
    description: 'Framing lumber package',
    account_name: 'Job Materials',
    qbo_customer_ref: '42',
    project_id: 'proj-henderson',
    status: 'staged',
    ...overrides,
  };
}

function makeScannedReceipt(overrides: Partial<MaterialReceipt> = {}): MaterialReceipt {
  return {
    id: 'mr_scan_1',
    projectId: 'proj-henderson',
    vendor: 'Builders Supply Co',
    receiptDate: '2026-07-22',
    lines: [],
    subtotal: 1840.5,
    total: 1840.5,
    status: 'reviewed',
    createdAt: '2026-07-22T10:00:00Z',
    updatedAt: '2026-07-22T10:00:00Z',
    ...overrides,
  };
}

// ─── Deterministic ids ────────────────────────────────────────────────────────

{
  console.log('\n── qboReceiptId ──');
  const row = makeRow();
  assert(qboReceiptId(row) === 'qbo-purchase-184-1', 'id = qbo-<type>-<qboId>-<lineId>', qboReceiptId(row));
  assert(qboReceiptId(row) === qboReceiptId(makeRow()), 'same row → same id (deterministic)');
  assert(
    qboReceiptId(makeRow({ qbo_line_id: '2' })) !== qboReceiptId(row),
    'different line → different id',
  );
  assert(
    qboReceiptId(makeRow({ qbo_type: 'bill' })) !== qboReceiptId(row),
    'different entity type → different id',
  );
  assert(
    qboReceiptId(makeRow({ qbo_line_id: '' })) === 'qbo-purchase-184-0',
    "empty line id normalizes to '0' (still deterministic)",
  );
}

// ─── stagedLineToReceipt ──────────────────────────────────────────────────────

{
  console.log('\n── stagedLineToReceipt ──');
  const now = '2026-07-24T12:00:00Z';
  const r = stagedLineToReceipt(makeRow(), { now });
  assert(!!r, 'mapped row materializes');
  assert(r!.id === 'qbo-purchase-184-1', 'receipt id is the deterministic id');
  assert(r!.projectId === 'proj-henderson', 'projectId from the resolved row');
  assert(r!.origin === 'qbo', "origin = 'qbo'");
  assert(r!.status === 'reviewed', "status = 'reviewed' (no re-review loop)");
  assert(r!.vendor === 'Builders Supply Co', 'vendor mapped');
  assert(r!.receiptDate === '2026-07-22', 'receiptDate = txn_date');
  assert(r!.documentNumber === 'INV-4471', 'documentNumber = doc_number');
  assert(r!.total === 1840.5 && r!.subtotal === 1840.5, 'total/subtotal = amount');
  assert(r!.lines.length === 1, 'one synthetic line');
  assert(r!.lines[0]?.description === 'Framing lumber package', 'line description from row');
  assert(r!.lines[0]?.category === 'Job Materials', 'line category = account_name (cost-book trade key)');
  assert(r!.lines[0]?.quantity === 1 && r!.lines[0]?.unitPrice === 1840.5 && r!.lines[0]?.lineTotal === 1840.5, 'qty 1 × amount');
  assert(r!.createdAt === now && r!.updatedAt === now, 'timestamps from opts.now (deterministic)');

  // Unmapped: null project_id and no override → null (needs assignment first).
  const unmapped = stagedLineToReceipt(makeRow({ project_id: null }), { now });
  assert(unmapped === null, 'unmapped line (null project, no override) → null — never guesses a project');

  // Confirm-time assignment: override materializes.
  const assigned = stagedLineToReceipt(makeRow({ project_id: null }), { now, projectId: 'proj-baker' });
  assert(assigned?.projectId === 'proj-baker', 'projectId override (confirm-queue assignment) materializes');

  // The row's own resolution wins over a stale override.
  const both = stagedLineToReceipt(makeRow(), { now, projectId: 'proj-baker' });
  assert(both?.projectId === 'proj-henderson', 'row.project_id wins when both present');

  // Description fallback chain: description → account_name → generic.
  const noDesc = stagedLineToReceipt(makeRow({ description: null }), { now });
  assert(noDesc?.lines[0]?.description === 'Job Materials', 'missing description falls back to account_name');
  const bare = stagedLineToReceipt(makeRow({ description: null, account_name: null }), { now });
  assert(bare?.lines[0]?.description === 'QuickBooks cost', 'bare row gets the generic description');
  const noVendor = stagedLineToReceipt(makeRow({ vendor: null }), { now });
  assert(noVendor?.vendor === 'QuickBooks', 'missing vendor falls back to QuickBooks');

  // Non-positive amounts never materialize (credits are skipped server-side;
  // belt-and-suspenders here).
  assert(stagedLineToReceipt(makeRow({ amount: 0 }), { now }) === null, 'amount 0 → null');
  assert(stagedLineToReceipt(makeRow({ amount: -50 }), { now }) === null, 'negative amount → null');
}

// ─── findLikelyDuplicate ──────────────────────────────────────────────────────

{
  console.log('\n── findLikelyDuplicate ──');
  const row = makeRow(); // Builders Supply Co, $1840.50, 2026-07-22

  // Exact scanned twin → hit.
  const twin = makeScannedReceipt();
  assert(findLikelyDuplicate([twin], row)?.id === 'mr_scan_1', 'exact scanned twin flagged');

  // Case/whitespace-insensitive vendor match.
  const caseTwin = makeScannedReceipt({ vendor: '  builders supply co ' });
  assert(findLikelyDuplicate([caseTwin], row) !== null, 'vendor match is case/space-insensitive');

  // Total within ±5% → hit; beyond → miss.
  const near = makeScannedReceipt({ total: 1900 }); // ~3.2% off
  assert(findLikelyDuplicate([near], row) !== null, 'total within ±5% still flags');
  const far = makeScannedReceipt({ total: 2100 }); // ~14% off
  assert(findLikelyDuplicate([far], row) === null, 'total beyond ±5% does not flag');

  // Date within 7 days → hit; beyond → miss; missing date → miss.
  const dateNear = makeScannedReceipt({ receiptDate: '2026-07-18' }); // 4 days
  assert(findLikelyDuplicate([dateNear], row) !== null, 'txn_date within 7 days flags');
  const dateFar = makeScannedReceipt({ receiptDate: '2026-07-10' }); // 12 days
  assert(findLikelyDuplicate([dateFar], row) === null, 'txn_date beyond 7 days does not flag');
  const dateless = makeScannedReceipt({ receiptDate: undefined });
  assert(findLikelyDuplicate([dateless], row) === null, 'receipt without a date never flags (cannot verify)');

  // Different vendor → miss.
  const otherVendor = makeScannedReceipt({ vendor: 'Ace Hardware' });
  assert(findLikelyDuplicate([otherVendor], row) === null, 'different vendor does not flag');

  // QBO-origin receipts are ignored — the guard is against SCANNED receipts;
  // a previously confirmed QBO line is not a scan double-count.
  const qboTwin = makeScannedReceipt({ id: 'qbo-purchase-99-1', origin: 'qbo' });
  assert(findLikelyDuplicate([qboTwin], row) === null, 'qbo-origin receipts never flag');

  // Vendorless staged row → no dup detection (nothing to match on).
  assert(findLikelyDuplicate([twin], makeRow({ vendor: null })) === null, 'vendorless row → no dup flag');

  // First match wins among several.
  const list = [otherVendor, twin, caseTwin];
  assert(findLikelyDuplicate(list, row)?.id === 'mr_scan_1', 'first matching receipt returned');
}

// ─── Summary ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} qbo cost-map test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll qbo cost-map tests passed.');
}
