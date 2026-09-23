// Home Passport — shared types.
//
// The passport is assembled ENTIRELY on the contractor's device (where
// selections/warranties/commitments/photos live) by the pure engine in
// buildHomePassport.ts, then:
//   - docs are indexed into memory_embeddings (project-memory-embed,
//     source 'Home Passport') so portal-ask-home can retrieve them;
//   - faqInputs are pre-answered via the existing project-memory AI flow
//     and baked into the portal snapshot's closeout section (v9);
//   - summary drives the passport header card in the portal.

// 'supplier' and 'contact' hold the GC's own relationships (a supplier name, a
// sub's phone/email) in docs of their own, emitted only while the job's
// owner-sharing switch is on and dropped by portal-ask-home at answer time
// unless that switch is on now (Phase 0, founder decision 5).
export type PassportDocKind = 'finish' | 'warranty' | 'trade' | 'maintenance' | 'photo' | 'supplier' | 'contact';

export interface PassportDoc {
  /** 'passport:<kind>:<entityId>' — STABLE across re-generations so the
   *  embed upsert on (user_id, doc_id) re-indexes idempotently. */
  docId: string;
  /** Human citation label, e.g. "Warranty — Trane HVAC". */
  ref: string;
  /** Dense searchable text, ≤ 4000 chars (clamped by the builder). */
  text: string;
  kind: PassportDocKind;
  /** ISO date for recency fallback + display (MemoryDoc.date). */
  date: string;
}

export interface FaqInput {
  id: string;
  question: string;
  /** Included only when ≥1 doc of ANY of these kinds exists. */
  requires: PassportDocKind[];
}

export interface PassportSummary {
  finishes: number;
  warranties: number;
  trades: number;
  maintenanceItems: number;
  photos: number;
  docCount: number;
  generatedAt: string;
}

export interface HomePassport {
  docs: PassportDoc[];
  faqInputs: FaqInput[];
  summary: PassportSummary;
}

export interface BakedFaqEntry {
  q: string;
  a: string;
  refs: string[];
}

/** What generation persists + what the portal snapshot bakes in. */
export interface BakedHomePassport {
  faq: BakedFaqEntry[];
  summary: PassportSummary;
  generatedAt: string;
  /** The job's owner-sharing switches when this was baked (Phase 0). The FAQ
   *  answers are prose that can quote a supplier or a sub's phone, so the
   *  portal ships them only under settings at least as open as these
   *  (ownerSharing.bakedSharingAllowed). Absent = baked before the switches
   *  existed, with everything in. */
  sharing?: import('./ownerSharing').OwnerSharing;
}
