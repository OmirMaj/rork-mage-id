// utils/safety/osha.ts — pure OSHA-recordable classifier for incidents.
//
// Mirrors the OSHA 1904 general recording criteria: a work-related injury or
// illness is recordable if it results in death, days away from work,
// restricted work / job transfer, loss of consciousness, or medical treatment
// beyond first aid. Near-misses and pure property / environmental events with
// no injury are not recordable (a fatality always is). Pure logic — no UI,
// unit-tested by scripts/validate-safety-osha.ts.

import type { SafetyIncident, SafetyIncidentSeverity, IncidentSeverity, OshaIllnessType, IncidentPerson } from '@/types';
import { parseCalendarDay } from '@/utils/calendarDate';

export type IncidentType = 'injury' | 'near_miss' | 'property' | 'environmental';
export type Treatment = 'none' | 'first_aid' | 'medical_beyond_first_aid';

export interface IncidentClassInput {
  type: IncidentType;
  treatment: Treatment;
  daysAway: number;
  restrictedDuty: boolean;
  lostConsciousness: boolean;
  fatality: boolean;
  /**
   * OSHA 300 column L — calendar days on restriction / job transfer.
   *
   * WHY IT IS HERE (audit round 2, safety-compliance #1). The incident form and
   * the DFR both ask for this number AND for a separate "Restricted duty" toggle,
   * and the classifier only ever read the toggle. Typing "5" with the toggle left
   * off produced "Not recordable — … no restriction." directly under the field
   * showing 5, and the case never reached the 300. A counted day of restriction IS
   * the 1904.7(b)(4) trigger, so the number decides it on its own.
   * Optional so a caller that has no day count still type-checks; absent reads 0.
   */
  daysRestricted?: number;
  /**
   * OSHA 300 column M. Anything other than 'injury' is an explicit statement
   * that a worker became ILL (skin, respiratory, poisoning, hearing, other), so
   * the case is an injury/illness case whatever the coarse event `type` says.
   * A chemical exposure logged as type 'environmental' with a respiratory
   * illness was never recordable before — the type gate rejected it first.
   */
  oshaIllnessType?: OshaIllnessType;
}

/** True when the record describes a worker who was hurt or made ill — the
 *  precondition for every non-fatal 1904 trigger. */
export function isInjuryOrIllnessCase(input: Pick<IncidentClassInput, 'type' | 'oshaIllnessType'>): boolean {
  if (input.type === 'injury') return true;
  return !!input.oshaIllnessType && input.oshaIllnessType !== 'injury';
}

/** Restricted work counts when EITHER the toggle is on or a day of restriction
 *  was counted. Exported so the screens show the toggle in the same state the
 *  classifier and the 300 log read, and store the same boolean. */
export function hasRestriction(input: Pick<IncidentClassInput, 'restrictedDuty' | 'daysRestricted'>): boolean {
  return !!input.restrictedDuty || (Number(input.daysRestricted) || 0) > 0;
}

export function isOshaRecordable(input: IncidentClassInput): boolean {
  // A fatality is recordable regardless of any other field.
  if (input.fatality) return true;
  // Only actual injury/illness cases can be recordable — a near-miss,
  // property-damage, or environmental event with nobody hurt or made ill is
  // not. An explicit illness classification (col M) is someone made ill.
  if (!isInjuryOrIllnessCase(input)) return false;
  if (input.daysAway > 0) return true;
  if (hasRestriction(input)) return true;
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
  if (!isInjuryOrIllnessCase(input)) {
    return {
      recordable,
      reason: `Not recordable — ${DFR_INCIDENT_TYPE_LABEL[input.type].toLowerCase()}, no injury.`,
    };
  }
  if (input.daysAway > 0) return { recordable, reason: 'Recordable — days away from work.' };
  if (hasRestriction(input)) return { recordable, reason: 'Recordable — restricted work or job transfer.' };
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

/** Case-insensitive, whitespace-trimmed text key, for "is this the same entry". */
function sameText(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();
}

/**
 * The register case for one daily report.
 *
 * `existing` is the case already on the register (the DFR's `linkedIncident`).
 * Without it this files a fresh case. WITH it, it MERGES, and that is the fix
 * for audit #83: re-saving the report used to rebuild the whole record from the
 * DFR's few fields, so a typo fix on Tuesday wiped everything the safety manager
 * had added in Incidents on Monday — the injured worker's job title (the 300
 * printed a blank Job Title), his extra corrective actions and their done
 * marks, the scene photos (replaced by the report's device URIs), the real
 * location, and who first filed it.
 *
 * The DFR owns ONLY what the DFR asks: what happened (description), when
 * (occurredAt), how bad (severity) and the 1904 classification inputs, with
 * oshaRecordable recomputed from them. Everything else belongs to the log:
 *  - people involved: kept as the log has them; the DFR's names are used only
 *    when the log has nobody yet,
 *  - corrective actions: kept, done marks included; the DFR's action is
 *    appended only when no action with the same text is already there,
 *  - photos: a union — the log's storage paths are never dropped,
 *  - location: the log's, unless it is blank,
 *  - illness type (col M), plan pin, status, createdBy / reportedBy / createdAt.
 * One pure function so scripts/validate-safety-dfr-merge.ts runs the real rule.
 */
export function buildSafetyIncidentFromDfr(src: DfrIncidentSource, existing?: SafetyIncident | null): SafetyIncident {
  const names = src.peopleInvolved.trim();
  const action = src.correctiveAction.trim();
  const reportedBy = src.reportedBy.trim() || src.author;
  // Col M is a recordkeeping judgement the DFR never asks for. A value the
  // safety manager set in the log is part of the determination, so the
  // recomputed flag must read it — otherwise a respiratory case logged as
  // 'environmental' would drop off the 300 on the next DFR save.
  const illness = src.classification.oshaIllnessType ?? existing?.oshaIllnessType;
  const dfrOwned = {
    type: src.classification.type,
    severity: DFR_SEVERITY_TO_REGISTER_SEVERITY[src.severity ?? 'minor'],
    occurredAt: src.occurredOn,
    description: src.description.trim(),
    treatment: src.classification.treatment,
    daysAway: src.classification.daysAway,
    daysRestricted: src.daysRestricted,
    // The day count and the toggle are one fact; store them agreeing, so the
    // 300 log's classification (which reads the stored fields) cannot disagree
    // with the recordable flag computed below.
    restrictedDuty: hasRestriction({ restrictedDuty: src.classification.restrictedDuty, daysRestricted: src.daysRestricted }),
    lostConsciousness: src.classification.lostConsciousness,
    fatality: src.classification.fatality,
    // daysRestricted is folded in here rather than trusted to the caller: the
    // DFR assembles `classification` without it, and a light-duty week typed on
    // the report must still put the case on the 300.
    oshaRecordable: isOshaRecordable({ ...src.classification, oshaIllnessType: illness, daysRestricted: src.daysRestricted }),
    updatedAt: src.now,
  };

  if (existing) {
    const actions = existing.correctiveActions ?? [];
    const photos = existing.photoUrls ?? [];
    return {
      ...existing,
      ...dfrOwned,
      id: existing.id,
      projectId: existing.projectId || src.projectId,
      oshaIllnessType: illness,
      location: (existing.location ?? '').trim() ? existing.location : src.location.trim(),
      peopleInvolved: (existing.peopleInvolved ?? []).length > 0
        ? existing.peopleInvolved
        : (names ? [{ name: names, role: '' }] : []),
      correctiveActions: action && !actions.some(a => sameText(a.action, action))
        ? [...actions, { action, owner: reportedBy, done: false }]
        : actions,
      photoUrls: [...photos, ...src.photoUrls.filter(u => u && !photos.includes(u))],
      status: existing.status ?? src.existingStatus ?? 'open',
      reportedBy: existing.reportedBy || reportedBy,
      createdBy: existing.createdBy || src.author,
      createdAt: existing.createdAt || src.existingCreatedAt || src.now,
    };
  }

  return {
    id: safetyIncidentIdForReport(src.reportId),
    projectId: src.projectId,
    ...dfrOwned,
    location: src.location.trim(),
    // One person, not a comma-split: "Jose R, foreman" is one man with a role,
    // and guessing which commas separate people would put a job title in the
    // employee-name column of the 300.
    peopleInvolved: names ? [{ name: names, role: '' }] : [],
    photoUrls: src.photoUrls,
    correctiveActions: action ? [{ action, owner: reportedBy, done: false }] : [],
    // Column M left unset rather than guessed — oshaLog reads an absent value
    // as a physical injury, which is the honest default.
    ...(illness ? { oshaIllnessType: illness } : {}),
    status: src.existingStatus ?? 'open',
    reportedBy,
    createdBy: src.author,
    createdAt: src.existingCreatedAt ?? src.now,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The injured worker on the 300 (audit #88).
//
// peopleInvolved is a flat list; nothing said which entry was HURT, so the 300
// printed peopleInvolved[0] — which could be the witness — and a recordable
// case could be saved with nobody on it at all, printing '—' in the one column
// an inspector reads first. `injured` marks the employee the case is about;
// `privacyCase` is 1904.29(b)(7): for the listed injury types the employer
// writes "Privacy case" instead of the name (the job title is still required).
//
// IncidentPersonRecord widens IncidentPerson locally so this compiles whether
// or not types/index.ts has the two optional fields yet; the JSONB column
// round-trips them verbatim either way.
// ─────────────────────────────────────────────────────────────────────────

export type IncidentPersonRecord = IncidentPerson & { injured?: boolean; privacyCase?: boolean };

/** The person the case is about: the one marked injured, else the first entry
 *  (every case saved before the flag existed has only that to go on). */
export function injuredPersonOf(people: readonly IncidentPerson[] | undefined): IncidentPersonRecord | undefined {
  const list = (people ?? []) as readonly IncidentPersonRecord[];
  return list.find(p => p?.injured) ?? list[0];
}

/** Blank rows ({name:'', role:''}) are an "Add" tap nobody filled in. They are
 *  dropped at save instead of printing an empty line on the record. */
export function cleanPeopleInvolved(people: readonly IncidentPerson[]): IncidentPersonRecord[] {
  return (people as readonly IncidentPersonRecord[]).filter(
    p => (p.name ?? '').trim() || (p.role ?? '').trim() || p.privacyCase,
  );
}

/**
 * Why a RECORDABLE case can't be saved yet, or null when it can. The 300 needs
 * the injured employee's name (or "Privacy case") and job title — a recordable
 * case without them is a log row the employer has to fix by hand later, and
 * the Save button is where he is still looking at the case.
 */
export function recordableWorkerProblem(people: readonly IncidentPerson[]): string | null {
  const list = cleanPeopleInvolved(people);
  const marked = list.find(p => p.injured);
  const person = marked ?? (list.length === 1 ? list[0] : undefined);
  if (!person) {
    return list.length === 0
      ? 'This case is OSHA-recordable, so the 300 log needs the injured worker. Add him under People involved with his name and job title.'
      : 'This case is OSHA-recordable. Mark which person was injured (tap "Injured" on his row) so the 300 log names the right worker.';
  }
  if (!person.privacyCase && !(person.name ?? '').trim()) {
    return 'The injured worker needs a name on the 300 log. Type it, or mark it a privacy case if 1904.29(b)(7) applies.';
  }
  if (!(person.role ?? '').trim()) {
    return 'The injured worker needs a job title on the 300 log (for example "Carpenter"). Add it on his row.';
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// Dates (audit #168). The safety forms took dates as free text, so '9/18/26'
// saved as typed: buildOsha300Log's year filter dropped the case from every
// year's log while the hub still counted it recordable, and the OSHA screen
// offered a '9/18' year chip. A date field now accepts a real calendar day
// in YYYY-MM-DD or refuses, and says why.
// ─────────────────────────────────────────────────────────────────────────

const STRICT_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The value as a real calendar day, or null. 2026-02-30 is not a day
 *  (parseCalendarDay round-trips the components), and nothing may trail it. */
export function strictCalendarDay(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return STRICT_DAY.test(v) && parseCalendarDay(v) ? v : null;
}

/** Why `value` is refused as the `label` date, or null when it is fine. An
 *  optional field may be blank; a required one may not. */
export function safetyDateProblem(value: string | null | undefined, label: string, opts: { optional?: boolean } = {}): string | null {
  const v = (value ?? '').trim();
  if (!v) return opts.optional ? null : `${label} is required. Enter it as YYYY-MM-DD, for example ${EXAMPLE_DAY}.`;
  if (strictCalendarDay(v)) return null;
  return `${label} "${v}" is not a date MAGE can file. Enter it as YYYY-MM-DD, for example ${EXAMPLE_DAY}, so it lands in the right year's log.`;
}
const EXAMPLE_DAY = '2026-09-18';

// ─────────────────────────────────────────────────────────────────────────
// Who may do what on a project's safety records — the client half of
// supabase/migrations/20260919130000_safety_project_rls.sql. A collaborator
// may file (field / editor), a viewer may only read, and only the project
// owner may delete. The server refuses the rest, and the offline queue treats
// that refusal as terminal — so a button the server will refuse must be
// disabled here, with the reason, rather than "succeeding" locally and
// quietly coming back on the next load.
// ─────────────────────────────────────────────────────────────────────────

export type SafetySeat = 'owner' | 'crew' | 'viewer' | 'checking';

/**
 * `ownerUserId` is the device copy of the project's owner (offline-safe, the
 * change-order gate's rule); `role` is useProjectRole (null while loading or on
 * error); `myRole` is the loader's stamp on a shared project.
 */
export function safetySeatFor(args: {
  ownerUserId?: string | null;
  userId?: string | null;
  role: 'owner' | 'editor' | 'viewer' | 'field' | null;
  myRole?: string | null;
}): SafetySeat {
  const { ownerUserId, userId, role, myRole } = args;
  if (ownerUserId && userId && ownerUserId === userId) return 'owner';
  if (role === 'owner') return 'owner';
  const r = role ?? myRole ?? null;
  if (r === 'editor' || r === 'field') return 'crew';
  if (r === 'viewer') return 'viewer';
  return 'checking';
}

/** The reason a seat can't delete a safety record, or null when it can. */
export function safetyDeleteBlockedReason(seat: SafetySeat): string | null {
  if (seat === 'owner') return null;
  if (seat === 'checking') return 'Checking your role on this job. Try again in a moment.';
  return 'Only the project owner can delete safety records. Ask your GC to remove it.';
}

/** The reason a seat can't file or edit safety records, or null when it can. */
export function safetyWriteBlockedReason(seat: SafetySeat): string | null {
  return seat === 'viewer'
    ? 'You were invited to this job as a viewer, so you can read its safety records but not file them. Ask your GC for field access.'
    : null;
}
