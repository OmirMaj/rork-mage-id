// utils/safety/osha.ts — pure OSHA-recordable classifier for incidents.
//
// Mirrors the OSHA 1904 general recording criteria: a work-related injury or
// illness is recordable if it results in death, days away from work,
// restricted work / job transfer, loss of consciousness, or medical treatment
// beyond first aid. Near-misses and pure property / environmental events with
// no injury are not recordable (a fatality always is). Pure logic — no UI,
// unit-tested by scripts/validate-safety-osha.ts.

import type { SafetyIncident, SafetyIncidentSeverity, IncidentSeverity } from '@/types';

export type IncidentType = 'injury' | 'near_miss' | 'property' | 'environmental';
export type Treatment = 'none' | 'first_aid' | 'medical_beyond_first_aid';

export interface IncidentClassInput {
  type: IncidentType;
  treatment: Treatment;
  daysAway: number;
  restrictedDuty: boolean;
  lostConsciousness: boolean;
  fatality: boolean;
}

export function isOshaRecordable(input: IncidentClassInput): boolean {
  // A fatality is recordable regardless of any other field.
  if (input.fatality) return true;
  // Only actual injury/illness cases can be recordable — a near-miss,
  // property-damage, or environmental event with no injury is not.
  if (input.type !== 'injury') return false;
  if (input.daysAway > 0) return true;
  if (input.restrictedDuty) return true;
  if (input.lostConsciousness) return true;
  if (input.treatment === 'medical_beyond_first_aid') return true;
  // First-aid-only or no treatment → not recordable.
  return false;
}

// ─────────────────────────────────────────────────────────────────────────
// DFR → safety register bridge.
//
// WHY THIS EXISTS (screen audit, daily-report Safety & Incident block). The
// super does the right thing at 4:30pm: he writes the injury on the report he
// was already filing. Grepping every consumer of `DailyFieldReport.incident`
// returned exactly one — utils/oacEngine.ts, which turns it into a talking
// point for a meeting agenda. It never became a SafetyIncident, so months
// later when the OSHA 300 is pulled for an insurance renewal or a GC prequal,
// the case is simply not there. Meanwhile the DFR asked him to SELF-CERTIFY
// "OSHA recordable" with a checkbox while isOshaRecordable() — the app's own
// 1904 classifier, right above — sat unused.
//
// Everything below is pure so scripts/validate-safety-osha.ts can run the real
// join: the vocabulary translation, the determination text, and the id
// derivation that links one report to one register case.
// ─────────────────────────────────────────────────────────────────────────


/**
 * The DFR has ONE five-value severity field; the register has TWO orthogonal
 * ones (`type` and `severity`), and they share only the literal 'critical'.
 * A severity→severity copy would drop 'near_miss' into a slot that has no such
 * value and lose it entirely, so the translation is explicit and tested.
 *
 * Note this map deliberately does NOT decide `type`: 'near_miss' appearing
 * here as a SEVERITY is exactly the conflation that makes the register wrong.
 * The type is captured separately on the DFR (see DFR_INCIDENT_TYPE_LABEL) —
 * isOshaRecordable branches on it first, so an inferred type would decide the
 * determination by accident.
 */
export const DFR_SEVERITY_TO_REGISTER_SEVERITY: Record<IncidentSeverity, SafetyIncidentSeverity> = {
  near_miss: 'low',
  minor: 'low',
  moderate: 'medium',
  major: 'high',
  critical: 'critical',
};

/** Field-readable names for the four register types. */
export const DFR_INCIDENT_TYPE_LABEL: Record<IncidentType, string> = {
  injury: 'Injury or illness',
  near_miss: 'Near miss',
  property: 'Property damage',
  environmental: 'Environmental',
};

/** Field-readable names for the three treatment levels. */
export const DFR_TREATMENT_LABEL: Record<Treatment, string> = {
  none: 'None',
  first_aid: 'First aid only',
  medical_beyond_first_aid: 'Medical beyond first aid',
};

/** A determination plus the single 1904 criterion that decided it. */
export interface RecordabilityVerdict {
  recordable: boolean;
  /** One sentence naming the criterion — shown to the super instead of a
   *  checkbox, and never rendered as a guess. */
  reason: string;
}

/**
 * The same answer isOshaRecordable() gives, with the reason it gave it.
 *
 * `recordable` is taken FROM isOshaRecordable rather than re-derived, so the
 * displayed verdict and the stored boolean can never disagree — a guard in
 * scripts/validate-safety-osha.ts walks the whole input matrix asserting that.
 * The reason branches mirror that function's order, because 1904 triggers are
 * not mutually exclusive and the first one that fires is the one to name.
 */
export function describeRecordability(input: IncidentClassInput): RecordabilityVerdict {
  const recordable = isOshaRecordable(input);
  if (input.fatality) return { recordable, reason: 'Recordable — fatality.' };
  if (input.type !== 'injury') {
    return {
      recordable,
      reason: `Not recordable — ${DFR_INCIDENT_TYPE_LABEL[input.type].toLowerCase()}, no injury.`,
    };
  }
  if (input.daysAway > 0) return { recordable, reason: 'Recordable — days away from work.' };
  if (input.restrictedDuty) return { recordable, reason: 'Recordable — restricted work or job transfer.' };
  if (input.lostConsciousness) return { recordable, reason: 'Recordable — loss of consciousness.' };
  if (input.treatment === 'medical_beyond_first_aid') {
    return { recordable, reason: 'Recordable — medical treatment beyond first aid.' };
  }
  if (input.treatment === 'first_aid') {
    return { recordable, reason: 'Not recordable — first aid only, no days away, no restriction.' };
  }
  return { recordable, reason: 'Not recordable — no treatment, no days away, no restriction.' };
}

/**
 * The register-case id that belongs to one daily report.
 *
 * DERIVED, not stored, because `IncidentReport` has no room for a foreign key
 * and adding one would mean two copies of the OSHA determination inputs drifting
 * apart. A stable derivation means: re-saving the report UPDATES its case instead
 * of filing a duplicate every time he taps Save, closing and reopening the report
 * finds the case again, and the register is the single home for the determination
 * fields the DFR type cannot carry.
 *
 * The derivation is a nibble-wise XOR against a fixed namespace, which is a
 * BIJECTION on the 128-bit space: two different reports can never collide on one
 * case, and the full entropy of the report's own UUID is preserved (a hash of the
 * id would throw entropy away for no gain). Postgres' UUID type accepts any 32 hex
 * digits, so the version/variant nibbles being non-v4 is not a problem.
 *
 * Ids that are not canonical UUIDs (they should not exist — every report id comes
 * from generateUUID()) are folded into 32 hex digits first, so the function is
 * total and a malformed id still produces a stable, insertable case id rather than
 * silently dropping the injury on the floor.
 */
const DFR_CASE_NAMESPACE = '5b3e7c1a9d024f68';

export function safetyIncidentIdForReport(reportId: string): string {
  const raw = (reportId ?? '').replace(/-/g, '').toLowerCase();
  const hex = /^[0-9a-f]{32}$/.test(raw) ? raw : foldToHex32(reportId ?? '');
  let out = '';
  for (let i = 0; i < 32; i++) {
    const a = parseInt(hex[i], 16);
    const b = parseInt(DFR_CASE_NAMESPACE[i % DFR_CASE_NAMESPACE.length], 16);
    out += (a ^ b).toString(16);
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

/** Deterministic 32-hex fold for the non-UUID fallback above. Four independent
 *  FNV-1a lanes so a one-character difference moves the whole string, not one
 *  eighth of it. Not cryptographic and does not need to be — it only has to be
 *  stable across runs and devices. */
function foldToHex32(s: string): string {
  const lanes = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  for (let i = 0; i < s.length; i++) {
    for (let l = 0; l < 4; l++) {
      lanes[l] ^= s.charCodeAt(i) + l * 31;
      lanes[l] = Math.imul(lanes[l], 0x01000193) >>> 0;
    }
  }
  return lanes.map(v => (v >>> 0).toString(16).padStart(8, '0')).join('');
}

/** Everything the DFR knows, in register vocabulary. Assembled by the screen;
 *  turned into a SafetyIncident by the pure builder below. */
export interface DfrIncidentSource {
  /** DailyFieldReport.id — the case id is derived from it. */
  reportId: string;
  projectId: string;
  /** The report's own date. The day the incident happened is the day the report
   *  is FOR, never "now" — a backfilled report must not file a case for today. */
  occurredOn: string;
  severity?: IncidentSeverity;
  description: string;
  /** Free-text names as typed on the DFR. */
  peopleInvolved: string;
  correctiveAction: string;
  reportedBy: string;
  /** SafetyIncident.location is required and the DFR has no location field, so
   *  the project's own site address stands in. Empty is allowed — an empty
   *  string is honest; an invented one is not. */
  location: string;
  photoUrls: string[];
  classification: IncidentClassInput;
  /** OSHA 300 column L — calendar days on restriction/transfer. */
  daysRestricted: number;
  author: string;
  now: string;
  /** createdAt of the case if it is already on the register, so a re-save does
   *  not rewrite when it was first filed. */
  existingCreatedAt?: string;
  /** Status if the case is already on the register — a case the safety manager
   *  has already moved to 'investigating' must not snap back to 'open' because
   *  the super fixed a typo in the report. */
  existingStatus?: SafetyIncident['status'];
}

export function buildSafetyIncidentFromDfr(src: DfrIncidentSource): SafetyIncident {
  const names = src.peopleInvolved.trim();
  const action = src.correctiveAction.trim();
  const reportedBy = src.reportedBy.trim() || src.author;
  return {
    id: safetyIncidentIdForReport(src.reportId),
    projectId: src.projectId,
    type: src.classification.type,
    severity: DFR_SEVERITY_TO_REGISTER_SEVERITY[src.severity ?? 'minor'],
    occurredAt: src.occurredOn,
    description: src.description.trim(),
    location: src.location.trim(),
    // One person, not a comma-split: "Jose R, foreman" is one man with a role,
    // and guessing which commas separate people would put a job title in the
    // employee-name column of the 300.
    peopleInvolved: names ? [{ name: names, role: '' }] : [],
    photoUrls: src.photoUrls,
    correctiveActions: action ? [{ action, owner: reportedBy, done: false }] : [],
    treatment: src.classification.treatment,
    daysAway: src.classification.daysAway,
    daysRestricted: src.daysRestricted,
    restrictedDuty: src.classification.restrictedDuty,
    lostConsciousness: src.classification.lostConsciousness,
    fatality: src.classification.fatality,
    // Column M is a recordkeeping judgement (skin vs respiratory vs hearing)
    // the DFR does not ask for. Left unset rather than guessed — oshaLog reads
    // an absent value as a physical injury, which is the honest default.
    oshaRecordable: isOshaRecordable(src.classification),
    status: src.existingStatus ?? 'open',
    reportedBy,
    createdBy: src.author,
    createdAt: src.existingCreatedAt ?? src.now,
    updatedAt: src.now,
  };
}
