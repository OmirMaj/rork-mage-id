// utils/automation/leadTimeLibrary.ts
//
// PURE data + lookup for the automation engine. No I/O, no side effects.
//
// Every lead time carries PROVENANCE — a `source` (default | jurisdiction |
// learned) and a `confidence` (low | med | high) — because the automation
// engine must NEVER present a guess as truth. v1 is static seeded defaults;
// the `jurisdiction` overlay is a thin placeholder that a real AHJ dataset
// plugs into later, and `learned` is reserved for the prediction ledger.
// The shape is what the factory (eventToScheduleWork) and the review sheet
// consume, so the provenance survives all the way to the UI chip.

/**
 * Kinds of lead time the engine knows about. `material_lead` is deliberately
 * coarse (varies wildly by material) and returns the widest/lowest-confidence
 * default so callers know to override it with a real quote.
 */
export type LeadTimeKind =
  | 'dob_inspection'
  | 'permit_review'
  | 'submittal_review'
  | 'rfi_response'
  | 'material_lead';

// 'ai_estimate' is an unverified LLM-sized lead — e.g. a RoadmapInspection's
// leadTimeDays, which generateRoadmap zod-defaults and grounds only in the
// free-text project.location. There is NO jurisdiction dataset behind it, so it
// must NOT masquerade as 'jurisdiction'. It is a guess the contractor confirms;
// only a value resolved from a REAL jurisdiction dataset (JURISDICTION_OVERRIDES
// below) may ever carry source: 'jurisdiction'.
export type LeadTimeSource = 'default' | 'jurisdiction' | 'learned' | 'ai_estimate';
export type LeadTimeConfidence = 'low' | 'med' | 'high';

export interface LeadTime {
  /** Book-ahead lead in calendar days. ALWAYS a positive integer. */
  days: number;
  source: LeadTimeSource;
  confidence: LeadTimeConfidence;
}

/**
 * Seeded defaults. Numbers are typical book-ahead leads drawn from the spec
 * (DOB inspection ~7–10 d, permit review ~30 d, submittal ~14 d, RFI ~7 d).
 * `material_lead` is a catch-all placeholder — real projects override it per
 * material, so its confidence is 'low'.
 *
 * INVARIANT (pinned by the validator): every entry has days > 0 so a lead
 * time can never collapse to a same-day / negative anchor downstream.
 */
const DEFAULTS: Record<LeadTimeKind, { days: number; confidence: LeadTimeConfidence }> = {
  dob_inspection: { days: 8, confidence: 'med' },
  permit_review: { days: 30, confidence: 'med' },
  submittal_review: { days: 14, confidence: 'high' },
  rfi_response: { days: 7, confidence: 'high' },
  // Materials vary enormously (stock lumber same-week vs custom millwork
  // months). A conservative 2-week placeholder that callers should override
  // with a real quote — hence low confidence.
  material_lead: { days: 14, confidence: 'low' },
};

/**
 * Per-jurisdiction overlays. v1 ships EMPTY — the map exists so a real AHJ
 * dataset (or a future parcel/permit API) plugs in behind the same signature
 * without touching call sites. When a jurisdiction override is present it wins
 * over the default and reports `source: 'jurisdiction'`. Jurisdiction keys are
 * normalized (lowercased, trimmed) before lookup.
 *
 * Deliberately not exported/frozen-mutable: this is a static seed, not a
 * runtime store. Learned values (prediction ledger) are Track-3 and never
 * mutate this object.
 */
const JURISDICTION_OVERRIDES: Record<string, Partial<Record<LeadTimeKind, { days: number; confidence: LeadTimeConfidence }>>> = {
  // Example shape (kept commented so v1 has zero grounded claims):
  // 'new york, ny': { dob_inspection: { days: 10, confidence: 'high' } },
};

function normalizeJurisdiction(j: string): string {
  return j.trim().toLowerCase();
}

/**
 * Look up the book-ahead lead time for a `kind`, optionally grounded to a
 * `jurisdiction`. PURE — same inputs always yield the same output.
 *
 * Resolution order (most specific wins):
 *   1. jurisdiction override → source: 'jurisdiction'
 *   2. seeded default        → source: 'default'
 *
 * `learned` is reserved for the prediction ledger and never produced by v1.
 * The return ALWAYS carries provenance so the caller can render a source /
 * confidence chip — a lead time with no provenance must not exist.
 */
export function getLeadTime(kind: LeadTimeKind, jurisdiction?: string): LeadTime {
  if (jurisdiction && jurisdiction.trim()) {
    const overlay = JURISDICTION_OVERRIDES[normalizeJurisdiction(jurisdiction)];
    const hit = overlay?.[kind];
    if (hit) {
      return { days: hit.days, source: 'jurisdiction', confidence: hit.confidence };
    }
  }
  const def = DEFAULTS[kind];
  return { days: def.days, source: 'default', confidence: def.confidence };
}

/** All kinds the library knows — handy for the validator + review-sheet UIs. */
export const LEAD_TIME_KINDS: LeadTimeKind[] = [
  'dob_inspection',
  'permit_review',
  'submittal_review',
  'rfi_response',
  'material_lead',
];
