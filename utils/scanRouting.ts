import type {
  ScanDocType, ScanRecordKind, ScanDestination, COICoverage, COICoverageType,
  Permit, PermitType, Warranty, WarrantyCategory, Subcontractor, MaterialReceipt,
} from '@/types';
import { parseCalendarDay, addCalendarMonths } from '@/utils/calendarDate';
import { normalizeExtraction } from '@/utils/materialReceipt';

// Exhaustive: `satisfies` forces a compile error if a docType is missing.
const ROUTING = {
  invoice:            { folder: 'financials',    recordKind: 'cost' },
  delivery_ticket:    { folder: 'daily-reports', recordKind: 'file_only' },
  permit:             { folder: 'permits',       recordKind: 'permit' },
  insurance_coi:      { folder: 'contracts',     recordKind: 'sub_compliance' },
  contract:           { folder: 'contracts',     recordKind: 'file_only' },
  business_card:      { folder: 'photos',        recordKind: 'contact' },
  spec_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  plan_sheet:         { folder: 'plans',         recordKind: 'file_only' },
  equipment_nameplate:{ folder: 'photos',        recordKind: 'file_only' },
  material_tag:       { folder: 'photos',        recordKind: 'file_only' },
  warranty:           { folder: 'closeout',      recordKind: 'warranty' },
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
// regardless of who the vendor is. An UNLINKED material receipt is booked by
// utils/jobCostEngine as DIRECT cost: the bill buys down the uncommitted
// budget while the full subcontract still stands as remaining exposure, so
// the projected final overstates by the whole invoice. Measured on the
// guard's own fixture, a $6,000 bill on a $20,000 subcontract: unlinked,
// projectedFinal $26,000; linked, $20,000.
//
// Both AP doors now default the link through this match: app/material-receipt
// and (wave 5, #63) app/scan.tsx, which builds its candidates through
// utils/commitmentLinking — the same filter and counterparty rule — and shows
// a "Pays against" chip row so the GC can override a name the match refused.
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

// ─────────────────────────────────────────────────────────────────────────────
// SCAN → DOMAIN RECORD (wave 5, #33 / #162 / #64 / #68). Pure, so
// scripts/validate-w5-scan-files-*.ts exercises the exact code app/scan.tsx
// runs. Every date an AI read is only written when it is a REAL calendar day:
// the extraction prompt asks for YYYY-MM-DD "if determinable, else the printed
// string", and a printed "3/4/26" stored as a date is a guess shown as fact.
// ─────────────────────────────────────────────────────────────────────────────

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** The value as a calendar day ('YYYY-MM-DD') only when it IS one, else null. */
export function scanCalendarDay(v: unknown): string | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return parseCalendarDay(s) ? s : null;
}

/** What the confirm card says the auto-file will DO, per record kind. */
export function recordKindPhrase(kind: ScanRecordKind): string {
  switch (kind) {
    case 'cost': return 'logs a cost entry';
    case 'contact': return 'creates a contact';
    case 'sub_compliance': return 'files the COI on the sub';
    case 'permit': return 'adds a permit to the Permits list';
    case 'warranty': return 'adds a warranty';
    case 'file_only': return 'saves the image only';
  }
}

/**
 * Product decision #53 (interim, owner-only): warranties are kept on the
 * project OWNER's account — warranties RLS is `auth.uid() = user_id`, so a
 * warranty an invited PM or foreman creates lands on HIS account and the GC's
 * Warranties list, handover, binder and portal never see it. Permits are
 * managed by the owner too (app/permits.tsx gates owner_only). So a scan on a
 * job he doesn't own files the image only, and says why. While the role is
 * still loading nothing is decided ('checking'); a failed, offline or empty
 * read is not ownership, so it files as an image and says it couldn't confirm.
 * `open` when the record may be created.
 *
 * Integration round 1: the same holds for a scanned bill ('cost') and a COI
 * ('sub_compliance'). material_receipts and cois are owner-only by RLS, so an
 * invited PM's bill or COI landed on HIS account while the banner said
 * "logged the bill as a cost entry" / "filed the COI on the sub" — the GC's
 * job costing and COI vault never saw it. Contacts stay open: a contact is
 * his own address book, not the job's record.
 */
export type ScanOwnerGate =
  | { state: 'open' }
  | { state: 'checking'; reason: string }
  | { state: 'blocked'; reason: string };
export function scanOwnerOnlyGate(
  recordKind: ScanRecordKind | null | undefined,
  role: { role: string | null; isLoading: boolean; isError: boolean },
): ScanOwnerGate {
  if (recordKind !== 'warranty' && recordKind !== 'permit' && recordKind !== 'cost' && recordKind !== 'sub_compliance') {
    return { state: 'open' };
  }
  if (role.role === 'owner') return { state: 'open' };
  const noun = recordKind === 'warranty' ? 'warranty'
    : recordKind === 'permit' ? 'permit'
    : recordKind === 'cost' ? 'cost entry'
    : 'COI';
  if (role.isLoading) return { state: 'checking', reason: `Checking your role on this job before adding the ${noun}…` };
  // A failed / offline / settled-null read is not ownership: never create
  // the record on a guess, and don't blame a role he may not have.
  if (role.isError || role.role == null) {
    return { state: 'blocked', reason: `Couldn't confirm you own this job, so this scan files as an image only — the ${noun} isn't added.` };
  }
  return {
    state: 'blocked',
    reason: recordKind === 'warranty'
      ? "Warranties are kept on the project owner's account — ask them to log it. This scan files as an image only."
      : recordKind === 'permit'
        ? 'Permits are managed by the project owner — this scan files as an image only.'
        : recordKind === 'cost'
          ? "Bills are booked on the project owner's account — job costing only counts theirs. Ask them to log it; this scan files as an image only."
          : "COIs are kept on the project owner's sub records — ask them to file it. This scan files as an image only.",
  };
}

/**
 * The same owner-only rule on the DIRECT path: app/material-receipt.tsx.
 * Job Costing is open to editor and viewer invitees and links straight to
 * Material Receipt, and material_receipts RLS is owner-only, so an invited
 * PM's receipt was written to HIS account while the screen said "Saved to your
 * account — it counts on the web and your other devices"; the GC's job
 * costing and budget never counted it. No projectId = nothing to decide yet
 * ('open'; the screen asks him to pick a project before it extracts).
 */
export function materialReceiptOwnerGate(
  projectId: string | null | undefined,
  role: { role: string | null; isLoading: boolean; isError: boolean },
): ScanOwnerGate {
  if (!projectId || role.role === 'owner') return { state: 'open' };
  if (role.isLoading) return { state: 'checking', reason: 'Checking your role on this job before saving the receipt…' };
  if (role.isError || role.role == null) {
    return { state: 'blocked', reason: "Couldn't confirm you own this job, so this receipt can't be saved to its job costing." };
  }
  return {
    state: 'blocked',
    reason: "Bills are booked on the project owner's account — job costing only counts theirs. Ask them to log this receipt.",
  };
}

/** Storage-folder key → readable folder name. */
export function scanFolderLabel(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * The success banner — names what was actually created. "The record is
 * logged" used to print for every kind, including file_only, where the fields
 * the card showed were thrown away (#162).
 */
export function scanFiledMessage(kind: ScanRecordKind, folder: string, pages: number): string {
  const where = `Project Files › ${scanFolderLabel(folder)}`;
  const saved = pages > 1 ? `Saved all ${pages} pages to ${where}` : `Saved the image to ${where}`;
  switch (kind) {
    case 'cost': return `${saved} and logged the bill as a cost entry.`;
    case 'contact': return `${saved} and created the contact.`;
    case 'sub_compliance': return `${saved} and filed the COI on the sub.`;
    case 'permit': return `${saved} and added the permit to the Permits list. The scan doesn't read the fee or the application date — add them there.`;
    case 'warranty': return `${saved} and added the warranty.`;
    case 'file_only': return `${saved}. The fields it read are not saved as a record.`;
  }
}

// ── Multi-page filing (#64) ───────────────────────────────────────────────
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/heic': 'heic',
  'image/heif': 'heif', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

/**
 * `<title>-<stamp>-p<n>.<ext>`: one stamp for the whole scan so the pages sort
 * together and a retry re-targets the SAME names (pages already filed are
 * skipped, never duplicated). The title is trimmed to 40 characters here
 * because utils/projectFiles caps a stored name at 80 — a long insured name
 * would otherwise cut off the `-pN` and make every page collide.
 *
 * `attempt` (0 = first) moves ONE page to a new name, `-pN-rA`, after its
 * upload landed as a 0-byte object: a field seat can't delete that object
 * (project_docs_delete needs 'editor'), so re-targeting the same name would
 * collide with it on every retry, forever.
 */
export function scanPageFileName(title: string, stamp: number, index: number, mimeType: string | undefined, attempt = 0): string {
  const stem = (title || 'Scan').replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Scan';
  const ext = EXT_BY_MIME[(mimeType ?? '').toLowerCase()] ?? 'jpg';
  const retry = attempt > 0 ? `-r${attempt}` : '';
  return `${stem}-${stamp}-p${index + 1}${retry}.${ext}`;
}

// ── Payload guard (#68 / #124, carried for photo-ai) ──────────────────────
/** Same ceilings supabase/functions/scan-anything enforces on base64 length. */
export const SCAN_MAX_BYTES_PER_IMAGE = 6 * 1024 * 1024;
export const SCAN_MAX_BYTES_TOTAL = 8 * 1024 * 1024;

/** The refusal sentence when a scan would be rejected by the server for size,
 *  or null when it fits. Checked BEFORE the call so a 5-page scan is not sent
 *  only to come back as "Edge Function returned a non-2xx status code". */
export function scanPayloadTooLarge(captures: readonly { base64: string }[]): string | null {
  let total = 0;
  let largest = 0;
  for (const c of captures) {
    const n = c.base64?.length ?? 0;
    total += n;
    largest = Math.max(largest, n);
  }
  if (total <= SCAN_MAX_BYTES_TOTAL && largest <= SCAN_MAX_BYTES_PER_IMAGE) return null;
  const mb = (Math.max(total, largest) / 1024 / 1024).toFixed(1);
  return `Scan payload too large (${mb} MB). Remove a page or retake — up to ~8 MB per scan.`;
}

// ── COI → sub (#33) ───────────────────────────────────────────────────────
/** Company name folded for comparison: case, spacing, punctuation and the
 *  legal suffix ("LLC", "Inc.") are typing, not identity. */
function foldCompany(s: string): string {
  return s.toLowerCase()
    .replace(/[.,&'"]/g, ' ')
    .replace(/\b(llc|l l c|inc|incorporated|co|corp|corporation|ltd|company)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Subs offered by the COI picker. The rule is buyout-package's: a sub with an
 * EMPTY `assignedProjects` is "available everywhere". The old picker required
 * the project id to be listed, and no screen ever writes assignedProjects (the
 * Subs form saves `[]`), so the list was empty for every real sub and every
 * scanned COI fell through to a loose document. Subs assigned to this job sort
 * first; `matchId` is the one sub whose name matches the certificate's insured,
 * and only when exactly one does — two same-named subs is not a match.
 */
export function coiPickerSubs(
  subs: readonly Subcontractor[],
  projectId: string,
  insured: unknown,
): { subs: Subcontractor[]; matchId: string } {
  const eligible = subs.filter(s => !s.assignedProjects?.length || (!!projectId && s.assignedProjects.includes(projectId)));
  const onJob = (s: Subcontractor) => (projectId && s.assignedProjects?.includes(projectId) ? 0 : 1);
  const sorted = [...eligible].sort((a, b) => onJob(a) - onJob(b) || a.companyName.localeCompare(b.companyName));
  const want = foldCompany(str(insured));
  const hits = want ? sorted.filter(s => foldCompany(s.companyName ?? '') === want) : [];
  return { subs: sorted, matchId: hits.length === 1 ? hits[0].id : '' };
}

export function coiCoverageType(raw: unknown): COICoverageType {
  const s = str(raw).toLowerCase();
  if (/general|\bgl\b|\bcgl\b/.test(s)) return 'general_liability';
  if (/worker|\bwc\b|comp/.test(s)) return 'workers_comp';
  if (/auto|vehicle/.test(s)) return 'auto';
  if (/umbrella|excess/.test(s)) return 'umbrella';
  return 'other';
}

/**
 * The coverage a scanned COI carries, so addCOI → syncSubCoiExpiry can move
 * the sub's coi_expiry. Written ONLY when the expiry is a real calendar day —
 * with no date there is nothing for the sync to read and no coverage is
 * claimed (the confirm card says so).
 */
export function scanCoiCoverages(fields: Record<string, unknown>): COICoverage[] {
  const expiresAt = scanCalendarDay(fields.expiresDate);
  if (!expiresAt) return [];
  const effectiveDate = scanCalendarDay(fields.effectiveDate);
  const cov: COICoverage = { type: coiCoverageType(fields.coverageType), expiresAt };
  const carrierName = str(fields.carrier);
  const policyNumber = str(fields.policyNumber);
  if (carrierName) cov.carrierName = carrierName;
  if (policyNumber) cov.policyNumber = policyNumber;
  if (effectiveDate) cov.effectiveDate = effectiveDate;
  return [cov];
}

// ── Permit (#162) ─────────────────────────────────────────────────────────
export function scanPermitType(raw: unknown): PermitType {
  const s = str(raw).toLowerCase();
  if (/electric/.test(s)) return 'electrical';
  if (/plumb/.test(s)) return 'plumbing';
  if (/mechanical|hvac/.test(s)) return 'mechanical';
  if (/demo/.test(s)) return 'demolition';
  if (/grad/.test(s)) return 'grading';
  if (/fire/.test(s)) return 'fire';
  if (/occupan/.test(s)) return 'occupancy';
  if (/build/.test(s)) return 'building';
  return 'other';
}

/**
 * The Permit a scanned permit creates. Status is 'approved' only when an issue
 * date was READ (an issued permit card); otherwise 'applied'. Dates that are
 * not real calendar days stay blank. The fee is not on the scan, so it is 0
 * and the notes say so. appliedDate stays blank: a permit card prints the
 * ISSUE date, not when he applied — stamping the issue day there made the
 * card say "Applied <issue day>" and fed utils/automation/learnedLeadTime a
 * fake 0-day review (applied = approved) as if it were his real lead time. The file reference goes in the notes, NOT
 * attachmentUri — that field holds a `project-photos` path the Permits screen
 * signs against that bucket, and this file lives in `project-documents`.
 */
export function buildScanPermit(
  fields: Record<string, unknown>,
  ctx: { projectId: string; projectName: string; fileName: string },
): Omit<Permit, 'id' | 'createdAt' | 'updatedAt'> {
  const issued = scanCalendarDay(fields.issuedDate);
  const expires = scanCalendarDay(fields.expiresDate);
  const address = str(fields.address);
  const notes = [
    `Filed from Scan Anything — Project Files › Permits › ${ctx.fileName}.`,
    address ? `Job address on the permit: ${address}.` : '',
    'Fee not read from the scan.',
  ].filter(Boolean).join(' ');
  const permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'> = {
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    type: scanPermitType(fields.type),
    jurisdiction: str(fields.jurisdiction),
    status: issued ? 'approved' : 'applied',
    appliedDate: '', // never read from a permit card — see above
    fee: 0,
    notes,
  };
  const permitNumber = str(fields.permitNumber);
  if (permitNumber) permit.permitNumber = permitNumber;
  if (issued) permit.approvedDate = issued;
  if (expires) permit.expiresDate = expires;
  return permit;
}

// ── Warranty (#162) ───────────────────────────────────────────────────────
/** "10 years" → 120, "18 months" → 18, "1 yr" → 12; null when unreadable. */
export function warrantyMonthsFromTerm(term: unknown): number | null {
  const s = str(term).toLowerCase();
  const m = /(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const months = /^y/.test(m[2]) ? n * 12 : n;
  return Number.isInteger(months) ? months : null;
}

function monthsBetween(start: string, end: string): number | null {
  const a = parseCalendarDay(start);
  const b = parseCalendarDay(end);
  if (!a || !b || b <= a) return null;
  const months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  return months > 0 ? months : null;
}

export function scanWarrantyCategory(product: unknown): WarrantyCategory {
  const s = str(product).toLowerCase();
  if (/roof|shingle/.test(s)) return 'roofing';
  if (/plumb|water heater|faucet/.test(s)) return 'plumbing';
  if (/electric|panel|breaker/.test(s)) return 'electrical';
  if (/hvac|furnace|air condition|heat pump|condenser/.test(s)) return 'hvac';
  if (/window|door/.test(s)) return 'windows';
  if (/appliance|refrigerator|fridge|dishwasher|range|oven|washer|dryer/.test(s)) return 'appliances';
  if (/foundation/.test(s)) return 'foundation';
  return 'other';
}

export type ScanWarrantyInput = Omit<Warranty, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'claims'>;

/**
 * The Warranty a scanned warranty creates, or the reason it can't. A warranty
 * row needs a start day and an end day (its whole job is the expiry
 * countdown), so it is only built when the start date READ as a calendar day
 * and either an end date did too or the term reads as a number of months/years.
 * Nothing is inferred beyond that arithmetic — no start date is assumed.
 */
export function buildScanWarranty(
  fields: Record<string, unknown>,
  ctx: { projectId: string; projectName: string; fileName: string },
): { ok: true; warranty: ScanWarrantyInput } | { ok: false; reason: string } {
  const start = scanCalendarDay(fields.startDate);
  const endRead = scanCalendarDay(fields.endDate);
  const termMonths = warrantyMonthsFromTerm(fields.term);
  if (!start) {
    return { ok: false, reason: 'To add a warranty, Start Date must read as a date (YYYY-MM-DD) — edit it above, or it files as an image only.' };
  }
  const end = endRead ?? (termMonths ? addCalendarMonths(start, termMonths) : null);
  const months = termMonths ?? (end ? monthsBetween(start, end) : null);
  if (!end || !months || end <= start) {
    return { ok: false, reason: 'To add a warranty, End Date (YYYY-MM-DD) or a term like "10 years" must be readable — edit it above, or it files as an image only.' };
  }
  const product = str(fields.product);
  const term = str(fields.term);
  return {
    ok: true,
    warranty: {
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      title: product || 'Warranty',
      category: scanWarrantyCategory(product),
      provider: str(fields.provider),
      startDate: start,
      durationMonths: months,
      endDate: end,
      description: [
        `Filed from Scan Anything — Project Files › Closeout › ${ctx.fileName}.`,
        term ? `Term as printed: ${term}.` : '',
      ].filter(Boolean).join(' '),
    },
  };
}

// ── Invoice → material receipt (#63) ──────────────────────────────────────
/** The invoice's line items as the confirm card shows them (read-only). */
export function scanInvoiceLines(fields: Record<string, unknown>): { description: string; qty: string; unit: string; lineTotal: string }[] {
  const raw = Array.isArray(fields.lines) ? (fields.lines as Record<string, unknown>[]) : [];
  return raw.map(l => ({
    description: str(l?.description),
    qty: str(l?.qty),
    unit: str(l?.unit),
    lineTotal: str(l?.lineTotal),
  })).filter(l => l.description || l.lineTotal);
}

/**
 * The material receipt a scanned invoice books. `commitmentId` is what the
 * "Pays against" chips resolved to (the vendor auto-match unless the GC
 * picked otherwise). `imagePath` is the bare project-documents path (CONTRACT
 * 7) — never the 7-day signed URL, which went blank a week later (#66).
 * Status is 'reviewed' only when the card SHOWED the line items; a receipt
 * whose lines he never saw stays 'extracted'.
 */
export function buildScanReceipt(
  fields: Record<string, unknown>,
  ctx: { projectId: string; commitmentId?: string; imagePath?: string; now?: string; linesShown: boolean },
): MaterialReceipt {
  const rawLines = Array.isArray(fields.lines) ? (fields.lines as Record<string, unknown>[]) : [];
  const receipt = normalizeExtraction(
    {
      vendor: str(fields.vendor),
      receiptDate: str(fields.date),
      documentNumber: str(fields.docNumber),
      subtotal: str(fields.subtotal),
      tax: str(fields.tax),
      total: str(fields.total),
      lines: rawLines.map(l => ({
        description: str(l?.description),
        category: str(l?.category) || undefined,
        quantity: str(l?.qty),
        unit: str(l?.unit),
        unitPrice: str(l?.unitPrice),
        lineTotal: str(l?.lineTotal),
      })),
    },
    { projectId: ctx.projectId, commitmentId: ctx.commitmentId, imageUri: ctx.imagePath || undefined, now: ctx.now },
  );
  receipt.status = ctx.linesShown && receipt.lines.length > 0 ? 'reviewed' : 'extracted';
  return receipt;
}
