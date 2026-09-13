import type { ScanDocType, ScanDestination } from '@/types';

// Exhaustive: `satisfies` forces a compile error if a docType is missing.
const ROUTING = {
  invoice:            { folder: 'financials',    recordKind: 'cost' },
  delivery_ticket:    { folder: 'daily-reports', recordKind: 'file_only' },
  permit:             { folder: 'permits',       recordKind: 'file_only' },
  insurance_coi:      { folder: 'contracts',     recordKind: 'sub_compliance' },
  contract:           { folder: 'contracts',     recordKind: 'file_only' },
  business_card:      { folder: 'photos',        recordKind: 'contact' },
  spec_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  plan_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  equipment_nameplate:{ folder: 'photos',        recordKind: 'file_only' },
  material_tag:       { folder: 'photos',        recordKind: 'file_only' },
  warranty:           { folder: 'closeout',      recordKind: 'file_only' },
  inspection_notice:  { folder: 'photos',        recordKind: 'file_only' },
  government_id:      { folder: 'photos',        recordKind: 'file_only' }, // never reached (redirect)
  other:              { folder: 'photos',        recordKind: 'file_only' },
} satisfies Record<ScanDocType, ScanDestination>;

export function resolveDestination(docType: ScanDocType): ScanDestination {
  return ROUTING[docType] ?? ROUTING.other;
}

export function defaultTitleFor(docType: ScanDocType, fields: Record<string, unknown>): string {
  const s = (k: string) => (typeof fields[k] === 'string' ? (fields[k] as string) : '');
  switch (docType) {
    case 'invoice': return s('vendor') ? `Invoice — ${s('vendor')}` : 'Invoice';
    case 'permit': return s('permitNumber') ? `Permit ${s('permitNumber')}` : 'Permit';
    case 'insurance_coi': return s('insured') ? `COI — ${s('insured')}` : 'Certificate of Insurance';
    case 'business_card': return s('name') || s('company') || 'Business Card';
    case 'delivery_ticket': return s('supplier') ? `Delivery — ${s('supplier')}` : 'Delivery Ticket';
    case 'warranty': return s('product') ? `Warranty — ${s('product')}` : 'Warranty';
    case 'equipment_nameplate': return [s('make'), s('model')].filter(Boolean).join(' ') || 'Equipment';
    case 'material_tag': return s('product') || s('sku') || 'Material';
    default: return docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MONEY-AP-1 / F9 (audit 2026-09-11). A SCANNED BILL SHOULD ARRIVE ATTACHED TO
// THE COMMITMENT IT PAYS DOWN.
//
// `ROUTING.invoice` above sends every scanned invoice to `recordKind: 'cost'`
// regardless of who the vendor is, and app/scan.tsx passes no `commitmentId`,
// so a GC who scans his electrician's bill — the natural thing to do, and the
// only AP path the product has — produces an UNLINKED material receipt.
// utils/jobCostEngine books that as DIRECT cost: the bill buys down the
// uncommitted budget while the full subcontract still stands as remaining
// exposure, so the projected final overstates by the whole invoice. Measured
// on the guard's own fixture, a $6,000 bill on a $20,000 subcontract:
// unlinked, projectedFinal $26,000; linked, $20,000.
//
// Widening the picker (done) only helps the GC who notices a chip. This is the
// half that makes the DEFAULT right.
//
// WHY THE MATCH IS EXACT AND UNAMBIGUOUS-ONLY. Mislinking is not a smaller
// error than not linking: it buys down the WRONG commitment, understating one
// trade's exposure and overstating another's, and it does so silently on a
// screen the GC is tapping through. So a substring match is refused ('Alder'
// must not claim both 'Alder Mechanical' and 'Alder Electric'), and TWO
// candidates means no default — the picker is right there. Case and internal
// whitespace are folded, because those are typing, not identity.
// ─────────────────────────────────────────────────────────────────────────────

/** Case- and space-folded name. Same rule utils/jobCostEngine.foldName uses. */
function fold(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The minimum a caller must know about a commitment to match a bill to it. */
export interface CommitmentCounterparty {
  id: string;
  /** Who the commitment is WITH — `vendorName` for a PO, the subcontractor's
   *  companyName for a subcontract. The caller resolves it; this file has no
   *  roster. */
  counterparty: string;
}

/**
 * The one commitment a scanned bill unambiguously belongs to, or undefined.
 *
 * Returns undefined when the vendor is blank, when nothing matches, and —
 * deliberately — when more than one commitment shares the vendor's name. Two
 * open POs with the same supplier is a real shape (a change order written as a
 * second PO), and guessing between them books the money against the wrong one.
 */
export function matchCommitmentByVendor(
  vendor: string | null | undefined,
  commitments: readonly CommitmentCounterparty[],
): string | undefined {
  const v = fold(vendor);
  if (!v) return undefined;
  const hits = commitments.filter(c => fold(c.counterparty) === v);
  return hits.length === 1 ? hits[0].id : undefined;
}
