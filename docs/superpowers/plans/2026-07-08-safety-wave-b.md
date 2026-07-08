# Safety Management — Wave B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Each task below is a bite-sized, independently-committable unit with a TDD-first ordering (pure logic + validators before UI). Run `npx tsc --noEmit` and `bun run ship-check` at the gates called out per task. Do not batch tasks; commit after each.

**Goal:** Extend the Safety Management module (shipped in Wave A) with the **compliance layer**: Inspections/Audits, Certifications tracking, a reusable Forms Library, and an OSHA-300 log export. Wave B *adds to* the files Wave A created — new collections on the existing `contexts/SafetyContext.tsx`, new domain types in `types/index.ts`, new `tertiary_*` tables, and new tiles/screens hung off the existing `app/safety.tsx` hub. It never re-plans Wave A items (JHAs, Toolbox Talks, Incidents, Hazards) but *reuses* them: a failed inspection item spawns a Wave-A `Hazard`, and the OSHA-300 report reads Wave-A `SafetyIncident`s where `oshaRecordable === true`.

**Architecture:** Same spine as Wave A. Offline-first — every write goes through `utils/offlineQueue.ts` `supabaseWrite`; local state persists to `AsyncStorage` under new `tertiary_*` keys; `OfflineSyncManager` flushes on reconnect. Domain types in `types/index.ts`. Pure logic in `utils/safety/*` (no React Native imports) so it is unit-testable by plain `bun run` validators wired into `ship-check`. UI follows the modal-in-screen pattern of `app/punch-list.tsx`. Certifications and Forms are **company-scoped** (keyed by the signed-in user, not by project); Inspections are **project-scoped**.

**Tech Stack:** React Native / Expo (New Architecture, OTA-safe — no new native modules), Expo Router 6 typed routes, Supabase (RLS tables + `supabaseWrite`), `@nkzw/create-context-hook`, `@tanstack/react-query`, `lucide-react-native`, `useTheme` / `useThemedStyles`, amber brand, `expo-print` + `expo-sharing` + `expo-file-system/legacy` for the OSHA export (all already in the dependency tree — used by `utils/scheduleReportExport.ts`).

**Tier:** Business+. Reuse the `safety_management` `FeatureKey` gate that Wave A adds to `hooks/useTierAccess.ts` — **no new gate key**. Inspections / Certifications / Forms / OSHA export are not AI features, so there is no metering.

**Assumes Wave A is implemented.** Concretely, Wave A has already created:
- `contexts/SafetyContext.tsx` — provider `SafetyProvider` + hook `useSafety`, mounted under `ProjectProvider` in `app/_layout.tsx`; exposes at least `hazards`, `addHazard(hazard: Hazard)`, and `incidents: SafetyIncident[]`.
- `types/index.ts` — `JobHazardAnalysis`, `ToolboxTalk`, `SafetyIncident`, `Hazard` (with `sourceInspectionId?: string`), and their sub-types.
- `app/safety.tsx` — the hub with a modal-in-screen tile grid (Wave A tiles: JHAs, Toolbox Talks, Incidents, Hazard Log).
- `hooks/useTierAccess.ts` — a `'safety_management'` `FeatureKey` at Business tier.
- A Wave A migration named `20260708HHMMSS_safety_wave_a.sql`.

If any Wave A anchor differs (e.g. the hazard-add function is named differently), adapt the reference at implementation time — the *names Wave B introduces* below are authoritative.

---

## File Structure

**New files**
```
utils/safety/certStatus.ts            # pure: certification status from expiresDate + reference date
utils/safety/inspectionScore.ts       # pure: inspection score, fail→hazard mapping, template→items
utils/safety/oshaLog.ts               # pure: OSHA-300 row assembly, CSV builder, HTML builder (NO RN imports)
utils/safety/oshaExport.ts            # RN glue: expo-print PDF + expo-sharing CSV (imports oshaLog)
scripts/validate-safety-cert.ts       # validator → ship-check (test:safety-cert)
scripts/validate-safety-inspection.ts # validator → ship-check (test:safety-inspection)
scripts/validate-safety-osha.ts       # validator → ship-check (test:safety-osha)
app/safety-inspections.tsx            # Inspections/Audits screen (project-scoped)
app/safety-certifications.tsx         # Certifications dashboard (company-scoped, expiring-soon)
app/safety-forms.tsx                  # Forms Library (company-scoped, ordered field list)
app/safety-osha.tsx                   # OSHA-300 log screen (read-only report + PDF/CSV export)
supabase/migrations/20260708180000_safety_wave_b.sql   # additive: safety_inspections, certifications, safety_templates
```

**Modified files (Wave A artifacts — Wave B extends them)**
```
types/index.ts            # + SafetyInspection, InspectionItem, Certification, SafetyFormTemplate, SafetyFormField, enums
contexts/SafetyContext.tsx# + inspections / certifications / templates collections + CRUD + selectors
app/safety.tsx            # + 4 hub tiles (Inspections, Certifications, Forms, OSHA 300 Log)
app/_layout.tsx           # + 4 Stack.Screen registrations
package.json              # + 3 test scripts, appended into ship-check
supabase/schema.sql       # mirror the 3 new tables (idempotent CREATE TABLE IF NOT EXISTS)
```

**Convention reminders (mirror exactly):**
- Pure `utils/safety/*` files import types with `import type` ONLY (so `bun run` never loads `react-native`). See `utils/scheduleColors.ts`.
- Validators use relative imports (`../utils/safety/...`, `../types`) — bun does not resolve the `@/` alias in `scripts/`. See `scripts/validate-schedule-colors.ts`.
- Row PKs written via `supabaseWrite` are `text` columns here (like `time_entries.id`), so `generateUUID()` from `@/utils/generateId` is fine but a `prefix-uuid` string is also accepted; keep IDs stable.
- Never call `supabase.from(...)` directly from the context — always `supabaseWrite`.

---

## Task 1 — Wave B domain types

**File:** `types/index.ts`

- [ ] Append the Wave B safety block **after the Wave A safety types** (search for the Wave A `Hazard` interface and add below it). Real code to add:

```typescript
// ─────────────────────────────────────────────────────────────
// Safety Management — Wave B (compliance layer)
// Inspections/Audits, Certifications, Forms Library.
// Extends the Wave A safety types (JobHazardAnalysis, ToolboxTalk,
// SafetyIncident, Hazard). See docs/superpowers/plans/2026-07-08-safety-wave-b.md
// ─────────────────────────────────────────────────────────────

/** A single checklist line inside a SafetyInspection. */
export interface InspectionItem {
  id: string;
  prompt: string;
  result: 'pass' | 'fail' | 'na';
  note?: string;
  photoUrl?: string;
}

/** An inspection / audit run against a project. Checklist items are
 *  scored pass/(pass+fail); a failed item can spawn a Wave-A Hazard. */
export interface SafetyInspection {
  id: string;
  projectId: string;
  templateId?: string;          // SafetyFormTemplate the checklist came from
  title: string;
  date: string;                 // 'YYYY-MM-DD'
  inspector: string;
  items: InspectionItem[];
  score: number;                // pass / (pass+fail); see utils/safety/inspectionScore
  status?: 'draft' | 'complete';
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export type CertificationStatus = 'valid' | 'expiring' | 'expired';

/** A worker / sub certification. COMPANY-scoped (not project-scoped) —
 *  keyed by the owning GC. status is computed from expiresDate. */
export interface Certification {
  id: string;
  holderName: string;
  subId?: string;               // links to tertiary_subcontractors / PrequalSafetyRecord
  type: string;                 // e.g. 'OSHA 10', 'OSHA 30', 'SST', 'CPR', trade license
  issuedDate?: string;          // 'YYYY-MM-DD'
  expiresDate?: string;         // 'YYYY-MM-DD'; absent = non-expiring
  documentUrl?: string;
  status: CertificationStatus;  // recomputed on read via certStatus()
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}

export type SafetyFormFieldType = 'text' | 'checkbox' | 'select' | 'signature' | 'photo';

/** One field in a reusable form template. Order is the array order —
 *  there is NO drag-drop builder in v1. */
export interface SafetyFormField {
  id: string;
  label: string;
  type: SafetyFormFieldType;
  required: boolean;
  options?: string[];           // for type === 'select'
}

/** A reusable form/checklist definition. COMPANY-scoped. Powers
 *  inspection checklists (category 'inspection') + custom forms. */
export interface SafetyFormTemplate {
  id: string;
  name: string;
  category: 'jha' | 'inspection' | 'general';
  fields: SafetyFormField[];
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
}
```

- [ ] `npx tsc --noEmit` — must pass (no consumers yet; this just checks the type syntax).
- [ ] `git add types/index.ts`
- [ ] `git commit -m "types: add Safety Wave B types (inspections, certifications, forms library)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 2 — Certification status (pure) + validator

**Files:** `utils/safety/certStatus.ts`, `scripts/validate-safety-cert.ts`, `package.json`

- [ ] Create `utils/safety/certStatus.ts`:

```typescript
// certStatus.ts — pure certification-status computation.
// No React Native imports: bun runs this directly under the validator.
//
// A cert is 'expired' once its expiry day is strictly in the past, 'expiring'
// while it is within CERT_EXPIRING_WINDOW_DAYS (inclusive, today counts as
// expiring), otherwise 'valid'. A cert with no expiresDate is treated as
// non-expiring → 'valid'. Comparison is on calendar days at UTC midnight so a
// cert expiring "today" reads as expiring until the day actually rolls over.

import type { CertificationStatus } from '@/types';

export const CERT_EXPIRING_WINDOW_DAYS = 30;

/** Integer count of UTC-midnight days since epoch for a 'YYYY-MM-DD' (or ISO)
 *  string. Returns null for unparseable input. */
export function dayNumber(dateStr: string): number | null {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  const t = d.getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 86_400_000);
}

/**
 * Compute a certification's status relative to a fixed reference date.
 * @param expiresDate 'YYYY-MM-DD' | ISO | undefined | null (undefined/null → non-expiring)
 * @param referenceDate 'YYYY-MM-DD' | ISO — "today" for the computation
 */
export function certStatus(
  expiresDate: string | undefined | null,
  referenceDate: string,
): CertificationStatus {
  if (!expiresDate) return 'valid';
  const exp = dayNumber(expiresDate);
  const ref = dayNumber(referenceDate);
  if (exp === null || ref === null) return 'valid';
  const daysUntil = exp - ref;
  if (daysUntil < 0) return 'expired';
  if (daysUntil <= CERT_EXPIRING_WINDOW_DAYS) return 'expiring';
  return 'valid';
}
```

- [ ] Create `scripts/validate-safety-cert.ts`:

```typescript
// validate-safety-cert.ts — unit tests for utils/safety/certStatus.
// Run via: bun run scripts/validate-safety-cert.ts
import { certStatus, dayNumber, CERT_EXPIRING_WINDOW_DAYS } from '../utils/safety/certStatus';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T){ const ok = JSON.stringify(got)===JSON.stringify(want); if(ok){pass++;console.log('  ✓',name);}else{fail++;console.log('  ✗',name,'\n   got:',got,'\n   want:',want);} }

console.log('\nsafety cert-status validation:');

const REF = '2026-07-08';
expect('no expiry → valid',            certStatus(undefined, REF), 'valid');
expect('null expiry → valid',          certStatus(null, REF), 'valid');
expect('empty string expiry → valid',  certStatus('', REF), 'valid');
expect('expired yesterday → expired',  certStatus('2026-07-07', REF), 'expired');
expect('expires today → expiring',     certStatus('2026-07-08', REF), 'expiring');
expect('expires in 1 day → expiring',  certStatus('2026-07-09', REF), 'expiring');
expect('expires in 30 days → expiring',certStatus('2026-08-07', REF), 'expiring');
expect('expires in 31 days → valid',   certStatus('2026-08-08', REF), 'valid');
expect('far future → valid',           certStatus('2027-01-01', REF), 'valid');
expect('ISO timestamp input works',    certStatus('2026-07-08T15:00:00.000Z', REF), 'expiring');
expect('window constant is 30',        CERT_EXPIRING_WINDOW_DAYS, 30);
expect('dayNumber returns a number',   typeof dayNumber(REF) === 'number', true);
expect('dayNumber bad input → null',   dayNumber('not-a-date'), null);
expect('dayNumber monotonic',          (dayNumber('2026-07-09')! - dayNumber('2026-07-08')!), 1);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] Add to `package.json` scripts (place the three Wave B `test:safety-*` lines next to the other `test:*` entries):

```json
    "test:safety-cert": "bun run scripts/validate-safety-cert.ts",
```

- [ ] Append `&& bun run test:safety-cert` to the end of the `ship-check` script value (after `bun run test:app-slop`; if Wave A appended its own `test:safety-risk`, add after that).
- [ ] Run `bun run scripts/validate-safety-cert.ts` — expect `14 passed, 0 failed`.
- [ ] `git add utils/safety/certStatus.ts scripts/validate-safety-cert.ts package.json`
- [ ] `git commit -m "safety: certification status computation + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 3 — Inspection scoring + fail→hazard (pure) + validator

**Files:** `utils/safety/inspectionScore.ts`, `scripts/validate-safety-inspection.ts`, `package.json`

- [ ] Create `utils/safety/inspectionScore.ts`:

```typescript
// inspectionScore.ts — pure inspection scoring + derivations.
// No React Native imports.
//
//  - scoreInspection: pass / (pass+fail); N/A items are excluded from the
//    denominator. An inspection with nothing scored (all N/A or empty) returns
//    score 1 ("nothing failed"), documented so the UI can badge it distinctly.
//  - inspectionItemsFromTemplate: turn a form template's ordered fields into a
//    fresh checklist (every item starts 'na').
//  - hazardFromFailedItem: build a Wave-A Hazard draft from a failed item; the
//    "log as hazard" affordance hands this to SafetyContext.addHazard.

import type { InspectionItem, Hazard } from '@/types';

export interface InspectionScore {
  pass: number;
  fail: number;
  na: number;
  total: number;
  /** pass / (pass + fail); 1 when nothing was scored. */
  score: number;
}

export function scoreInspection(items: InspectionItem[]): InspectionScore {
  let pass = 0, fail = 0, na = 0;
  for (const it of items) {
    if (it.result === 'pass') pass++;
    else if (it.result === 'fail') fail++;
    else na++;
  }
  const scored = pass + fail;
  const score = scored === 0 ? 1 : pass / scored;
  return { pass, fail, na, total: items.length, score };
}

/** Derive a fresh checklist from a template's ordered fields. Each item
 *  starts 'na'. makeId supplies unique ids (generateUUID in the app). */
export function inspectionItemsFromTemplate(
  template: { fields: { id: string; label: string }[] },
  makeId: () => string,
): InspectionItem[] {
  return template.fields.map((f) => ({
    id: makeId(),
    prompt: f.label,
    result: 'na' as const,
  }));
}

/**
 * Build a Hazard draft from a failed inspection item. Severity/likelihood
 * default to a mid 3×3 (riskScore 9) — a failed safety-inspection line is a
 * known deficiency, not a speculative risk; the inspector can adjust before
 * saving. riskScore mirrors the Wave-A risk matrix (severity × likelihood).
 */
export function hazardFromFailedItem(
  inspection: { id: string; projectId: string; createdBy: string },
  item: InspectionItem,
  now: string,
  id: string,
): Hazard {
  return {
    id,
    projectId: inspection.projectId,
    description: item.prompt,
    location: '',
    photoUrl: item.photoUrl,
    severity: 3,
    likelihood: 3,
    riskScore: 9,
    correctiveAction: item.note,
    status: 'open',
    sourceInspectionId: inspection.id,
    createdAt: now,
    createdBy: inspection.createdBy,
  };
}
```

> Note: if the Wave-A `Hazard` interface requires a field not set here (e.g. `updatedAt` is required rather than optional), add it to the returned object at implementation time — keep the defaults above.

- [ ] Create `scripts/validate-safety-inspection.ts`:

```typescript
// validate-safety-inspection.ts — unit tests for utils/safety/inspectionScore.
// Run via: bun run scripts/validate-safety-inspection.ts
import { scoreInspection, inspectionItemsFromTemplate, hazardFromFailedItem } from '../utils/safety/inspectionScore';
import type { InspectionItem } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T){ const ok = JSON.stringify(got)===JSON.stringify(want); if(ok){pass++;console.log('  ✓',name);}else{fail++;console.log('  ✗',name,'\n   got:',got,'\n   want:',want);} }

console.log('\nsafety inspection validation:');

const items: InspectionItem[] = [
  { id: '1', prompt: 'Guardrails in place', result: 'pass' },
  { id: '2', prompt: 'Fire extinguisher tagged', result: 'fail', note: 'Missing tag', photoUrl: 'p.jpg' },
  { id: '3', prompt: 'Eyewash station clear', result: 'na' },
  { id: '4', prompt: 'PPE worn', result: 'pass' },
];

const s = scoreInspection(items);
expect('pass count', s.pass, 2);
expect('fail count', s.fail, 1);
expect('na count', s.na, 1);
expect('total', s.total, 4);
expect('score = 2/3', s.score, 2 / 3);
expect('all-na → score 1', scoreInspection([{ id: 'x', prompt: 'q', result: 'na' }]).score, 1);
expect('empty → score 1', scoreInspection([]).score, 1);
expect('all-pass → 1', scoreInspection([{ id: 'a', prompt: 'q', result: 'pass' }]).score, 1);
expect('all-fail → 0', scoreInspection([{ id: 'a', prompt: 'q', result: 'fail' }]).score, 0);

// template → checklist items
let n = 0; const mk = () => `it-${++n}`;
const derived = inspectionItemsFromTemplate({ fields: [{ id: 'f1', label: 'Guardrails?' }, { id: 'f2', label: 'PPE?' }] }, mk);
expect('template → 2 items', derived.length, 2);
expect('first prompt from label', derived[0].prompt, 'Guardrails?');
expect('items default to na', derived[1].result, 'na');
expect('ids from makeId', derived[0].id, 'it-1');

// fail → hazard mapping
const hz = hazardFromFailedItem(
  { id: 'insp1', projectId: 'proj1', createdBy: 'user1' },
  items[1],
  '2026-07-08T00:00:00.000Z',
  'haz1',
);
expect('hazard id', hz.id, 'haz1');
expect('hazard links inspection', hz.sourceInspectionId, 'insp1');
expect('hazard projectId', hz.projectId, 'proj1');
expect('hazard description = prompt', hz.description, 'Fire extinguisher tagged');
expect('hazard correctiveAction = note', hz.correctiveAction, 'Missing tag');
expect('hazard photo carried over', hz.photoUrl, 'p.jpg');
expect('hazard severity default', hz.severity, 3);
expect('hazard likelihood default', hz.likelihood, 3);
expect('hazard riskScore = 9', hz.riskScore, 9);
expect('hazard status open', hz.status, 'open');
expect('hazard createdBy', hz.createdBy, 'user1');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] Add to `package.json` scripts:

```json
    "test:safety-inspection": "bun run scripts/validate-safety-inspection.ts",
```

- [ ] Append `&& bun run test:safety-inspection` to the `ship-check` value (after `test:safety-cert`).
- [ ] Run `bun run scripts/validate-safety-inspection.ts` — expect `22 passed, 0 failed`.
- [ ] `git add utils/safety/inspectionScore.ts scripts/validate-safety-inspection.ts package.json`
- [ ] `git commit -m "safety: inspection scoring + fail→hazard mapping + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 4 — OSHA-300 row assembly (pure) + validator

**Files:** `utils/safety/oshaLog.ts`, `scripts/validate-safety-osha.ts`, `package.json`

> Wave A owns `oshaRecordable` **classification** (whether an incident is recordable). Wave B's `oshaLog.ts` consumes the already-set `incident.oshaRecordable` flag and assembles the OSHA Form 300 **log rows** + CSV/HTML. The two never overlap. This file is PURE (no RN / expo imports) so the validator can run it; the RN export glue lives in `utils/safety/oshaExport.ts` (Task 11).

- [ ] Create `utils/safety/oshaLog.ts`:

```typescript
// oshaLog.ts — pure OSHA Form 300 log assembly + serializers.
// No React Native / expo imports (the validator runs this under bun).
// The RN export glue (expo-print PDF, expo-sharing CSV) lives in
// utils/safety/oshaExport.ts and re-uses the builders here.
//
// Maps Wave-A SafetyIncident records where oshaRecordable === true onto the
// OSHA 300 column layout. Column outcomes (classification, days away/restricted,
// illness type) are DERIVED heuristically from the incident's severity + type
// because Wave A's SafetyIncident does not yet carry explicit OSHA outcome
// fields. When those fields are added, tighten oshaRowFromIncident — the row
// SHAPE stays the same.

import type { SafetyIncident } from '@/types';

export type OshaClassification = 'death' | 'days_away' | 'restricted' | 'other';
export type OshaIllnessType = 'injury' | 'skin' | 'respiratory' | 'poisoning' | 'hearing' | 'other_illness';

export interface OshaEstablishment {
  name: string;
  year: string; // 'YYYY'
}

export interface Osha300Row {
  caseNo: string;          // sequential 1..N within the log
  employeeName: string;    // first injured person, or '—'
  jobTitle: string;        // that person's role, or '—'
  dateOfIncident: string;  // 'YYYY-MM-DD'
  location: string;        // "where the event occurred"
  description: string;     // injury description if present, else incident description
  classification: OshaClassification; // OSHA 300 cols G–J
  daysAway: number;        // col K
  daysRestricted: number;  // col L
  illnessType: OshaIllnessType; // cols M(1)–M(6)
}

export const OSHA_CLASS_LABEL: Record<OshaClassification, string> = {
  death: 'Death',
  days_away: 'Days away from work',
  restricted: 'Job transfer / restriction',
  other: 'Other recordable case',
};

export const OSHA_ILLNESS_LABEL: Record<OshaIllnessType, string> = {
  injury: 'Injury',
  skin: 'Skin disorder',
  respiratory: 'Respiratory condition',
  poisoning: 'Poisoning',
  hearing: 'Hearing loss',
  other_illness: 'All other illnesses',
};

function classificationForSeverity(sev: SafetyIncident['severity']): OshaClassification {
  switch (sev) {
    case 'critical': return 'death';
    case 'high':     return 'days_away';
    case 'medium':   return 'restricted';
    default:         return 'other';
  }
}

function illnessForType(type: SafetyIncident['type']): OshaIllnessType {
  switch (type) {
    case 'environmental': return 'respiratory';
    case 'injury':        return 'injury';
    default:              return 'injury';
  }
}

/** Assemble a single OSHA 300 row from an incident and its 1-based case number. */
export function oshaRowFromIncident(inc: SafetyIncident, caseNumber: number): Osha300Row {
  const person = inc.peopleInvolved && inc.peopleInvolved.length > 0 ? inc.peopleInvolved[0] : undefined;
  return {
    caseNo: String(caseNumber),
    employeeName: person?.name ?? '—',
    jobTitle: person?.role ?? '—',
    dateOfIncident: (inc.occurredAt ?? '').slice(0, 10),
    location: inc.location ?? '',
    description: person?.injuryDescription || inc.description || '',
    classification: classificationForSeverity(inc.severity),
    daysAway: 0,        // no field on SafetyIncident yet — see header note
    daysRestricted: 0,  // no field on SafetyIncident yet — see header note
    illnessType: illnessForType(inc.type),
  };
}

/** Build the full OSHA 300 log: recordable incidents only, sorted oldest→newest,
 *  numbered 1..N. */
export function buildOsha300Log(incidents: SafetyIncident[]): Osha300Row[] {
  const recordable = incidents
    .filter((i) => i.oshaRecordable)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
  return recordable.map((inc, idx) => oshaRowFromIncident(inc, idx + 1));
}

/** RFC-4180-ish CSV cell escaping: quote when the value has a comma, quote,
 *  or newline; double interior quotes. */
export function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function osha300ToCsv(rows: Osha300Row[], est: OshaEstablishment): string {
  const header = ['Case No.', 'Employee', 'Job Title', 'Date', 'Location', 'Description', 'Classification', 'Days Away', 'Days Restricted', 'Type'];
  const lines: string[] = [
    'OSHA Form 300 — Log of Work-Related Injuries and Illnesses',
    `Establishment:,${csvCell(est.name)},Year:,${csvCell(est.year)}`,
    '',
    header.join(','),
    ...rows.map((r) => [
      r.caseNo, r.employeeName, r.jobTitle, r.dateOfIncident, r.location, r.description,
      OSHA_CLASS_LABEL[r.classification], String(r.daysAway), String(r.daysRestricted), OSHA_ILLNESS_LABEL[r.illnessType],
    ].map(csvCell).join(',')),
  ];
  return lines.join('\n');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Branded printable HTML for the OSHA 300 log. Pure string — consumed by
 *  utils/safety/oshaExport.ts via expo-print. */
export function buildOsha300Html(rows: Osha300Row[], est: OshaEstablishment): string {
  const body = rows.length
    ? rows.map((r) => `
        <tr>
          <td class="num">${esc(r.caseNo)}</td>
          <td>${esc(r.employeeName)}</td>
          <td>${esc(r.jobTitle)}</td>
          <td>${esc(r.dateOfIncident)}</td>
          <td>${esc(r.location)}</td>
          <td>${esc(r.description)}</td>
          <td>${esc(OSHA_CLASS_LABEL[r.classification])}</td>
          <td class="num">${r.daysAway}</td>
          <td class="num">${r.daysRestricted}</td>
          <td>${esc(OSHA_ILLNESS_LABEL[r.illnessType])}</td>
        </tr>`).join('')
    : `<tr><td colspan="10" class="empty">No recordable cases for ${esc(est.year)}.</td></tr>`;
  const capturedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>OSHA 300 Log — ${esc(est.name)} — ${esc(est.year)}</title>
<style>
  @page { size: A4 landscape; margin: 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111; margin: 0; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 10px; border-bottom: 2px solid #FF9500; margin-bottom: 14px; }
  header .brand { font-size: 10px; font-weight: 800; color: #FF9500; letter-spacing: 3px; text-transform: uppercase; }
  header h1 { font-size: 18px; margin: 4px 0 0; }
  header .meta { text-align: right; font-size: 10px; color: #555; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  thead th { font-size: 9px; text-transform: uppercase; color: #666; text-align: left; padding: 6px 8px; border-bottom: 1.5px solid #ccc; letter-spacing: 0.5px; }
  td { font-size: 10px; padding: 5px 8px; border-bottom: 1px solid #eee; vertical-align: top; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.empty { text-align: center; color: #888; padding: 24px; }
  tr { page-break-inside: avoid; }
  footer { margin-top: 16px; font-size: 9px; color: #888; text-align: right; }
</style></head>
<body>
  <header>
    <div>
      <div class="brand">MAGE Safety · OSHA Form 300</div>
      <h1>${esc(est.name)}</h1>
    </div>
    <div class="meta">
      <div>Log year: <b>${esc(est.year)}</b></div>
      <div>Recordable cases: <b>${rows.length}</b></div>
      <div>Generated: ${esc(capturedOn)}</div>
    </div>
  </header>
  <table>
    <thead><tr>
      <th>Case</th><th>Employee</th><th>Job Title</th><th>Date</th><th>Location</th>
      <th>Description</th><th>Classification</th><th>Days Away</th><th>Days Restr.</th><th>Type</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>
  <footer>Generated by MAGE ID · OSHA 300 Log · ${esc(capturedOn)} — verify against your recordkeeping before posting.</footer>
</body></html>`;
}
```

- [ ] Create `scripts/validate-safety-osha.ts`:

```typescript
// validate-safety-osha.ts — unit tests for utils/safety/oshaLog (row assembly).
// Run via: bun run scripts/validate-safety-osha.ts
import { buildOsha300Log, oshaRowFromIncident, osha300ToCsv, csvCell } from '../utils/safety/oshaLog';
import type { SafetyIncident } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T){ const ok = JSON.stringify(got)===JSON.stringify(want); if(ok){pass++;console.log('  ✓',name);}else{fail++;console.log('  ✗',name,'\n   got:',got,'\n   want:',want);} }

console.log('\nsafety OSHA-300 validation:');

// Minimal incident shapes — cast like validate-schedule-colors does with tasks.
function inc(o: Partial<SafetyIncident>): SafetyIncident { return o as unknown as SafetyIncident; }

const incidents: SafetyIncident[] = [
  inc({ id: 'i1', oshaRecordable: true,  occurredAt: '2026-03-02', severity: 'high',     type: 'injury',        location: 'Level 2', description: 'Fall from ladder', peopleInvolved: [{ name: 'Jose R', role: 'Laborer', injuryDescription: 'Sprained ankle' }] }),
  inc({ id: 'i2', oshaRecordable: false, occurredAt: '2026-03-05', severity: 'low',      type: 'near_miss',     location: 'Yard',    description: 'Dropped tool',    peopleInvolved: [] }),
  inc({ id: 'i3', oshaRecordable: true,  occurredAt: '2026-01-15', severity: 'critical', type: 'injury',        location: 'Roof',    description: 'Fatal fall',      peopleInvolved: [{ name: 'Sam T', role: 'Roofer' }] }),
  inc({ id: 'i4', oshaRecordable: true,  occurredAt: '2026-04-01', severity: 'medium',   type: 'environmental', location: 'Basement',description: 'Chemical exposure',peopleInvolved: [] }),
];

const log = buildOsha300Log(incidents);
expect('only recordable included',        log.length, 3);
expect('sorted oldest first (Jan)',       log[0].dateOfIncident, '2026-01-15');
expect('sorted (Mar second)',             log[1].dateOfIncident, '2026-03-02');
expect('sorted (Apr last)',               log[2].dateOfIncident, '2026-04-01');
expect('case numbers sequential',         [log[0].caseNo, log[1].caseNo, log[2].caseNo], ['1','2','3']);
expect('critical → death class',          log[0].classification, 'death');
expect('high → days_away class',          log[1].classification, 'days_away');
expect('medium → restricted class',       log[2].classification, 'restricted');
expect('employee name from person',       log[1].employeeName, 'Jose R');
expect('job title from role',             log[1].jobTitle, 'Laborer');
expect('desc prefers injuryDescription',  log[1].description, 'Sprained ankle');
expect('no person → dash name',           log[2].employeeName, '—');
expect('no person → dash title',          log[2].jobTitle, '—');
expect('environmental → respiratory',     log[2].illnessType, 'respiratory');
expect('injury → injury illness type',    log[1].illnessType, 'injury');
expect('days away default 0',             log[0].daysAway, 0);

// direct row assembly with explicit case number
const row = oshaRowFromIncident(incidents[0], 7);
expect('explicit case number honored',    row.caseNo, '7');

// CSV
const csv = osha300ToCsv(log, { name: 'Acme, Inc', year: '2026' });
expect('csv includes a case row',         csv.includes('Fatal fall'), true);
expect('csv establishment escaped',       csv.includes('"Acme, Inc"'), true);
expect('csvCell escapes comma',           csvCell('Acme, Inc'), '"Acme, Inc"');
expect('csvCell escapes quote',           csvCell('a"b'), '"a""b"');
expect('csvCell plain passthrough',       csvCell('plain'), 'plain');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] Add to `package.json` scripts:

```json
    "test:safety-osha": "bun run scripts/validate-safety-osha.ts",
```

- [ ] Append `&& bun run test:safety-osha` to the `ship-check` value (after `test:safety-inspection`).
- [ ] Run `bun run scripts/validate-safety-osha.ts` — expect `24 passed, 0 failed`.
- [ ] `git add utils/safety/oshaLog.ts scripts/validate-safety-osha.ts package.json`
- [ ] `git commit -m "safety: OSHA-300 log assembly (pure) + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 5 — Extend SafetyContext with Wave B collections

**File:** `contexts/SafetyContext.tsx`

Add three collections to the existing `createContextHook` body. Certifications and Templates are **company-scoped** (persisted under one AsyncStorage key per user; RLS scopes by `user_id` server-side). Inspections are **project-scoped**. Mirror the Wave A collection wiring already in this file; the snippets below are self-contained.

- [ ] Ensure these imports exist at the top of `contexts/SafetyContext.tsx` (Wave A already imports most — add any missing):

```typescript
import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabaseWrite } from '@/utils/offlineQueue';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { certStatus } from '@/utils/safety/certStatus';
import type { SafetyInspection, Certification, SafetyFormTemplate } from '@/types';
```

- [ ] Inside the hook body, add the keys, `canSync`/`userId` (reuse Wave A's if present), state, and load effect:

```typescript
  // ── Safety Wave B collections ────────────────────────────────
  const SAFETY_INSPECTIONS_KEY = 'tertiary_safety_inspections';
  const CERTIFICATIONS_KEY = 'tertiary_certifications';
  const SAFETY_TEMPLATES_KEY = 'tertiary_safety_templates';

  const { user } = useAuth();                       // reuse Wave A's if it already destructures user
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;

  const [inspections, setInspections] = useState<SafetyInspection[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [templates, setTemplates] = useState<SafetyFormTemplate[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const [i, c, t] = await Promise.all([
          AsyncStorage.getItem(SAFETY_INSPECTIONS_KEY),
          AsyncStorage.getItem(CERTIFICATIONS_KEY),
          AsyncStorage.getItem(SAFETY_TEMPLATES_KEY),
        ]);
        if (i) setInspections(JSON.parse(i) as SafetyInspection[]);
        if (c) setCertifications(JSON.parse(c) as Certification[]);
        if (t) setTemplates(JSON.parse(t) as SafetyFormTemplate[]);
      } catch (e) {
        console.log('[SafetyContext] Wave B load failed:', e);
      }
    })();
  }, []);
```

- [ ] Add the Inspections CRUD:

```typescript
  const addInspection = useCallback((inspection: SafetyInspection) => {
    setInspections((prev) => {
      const next = [inspection, ...prev];
      void AsyncStorage.setItem(SAFETY_INSPECTIONS_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) void supabaseWrite('safety_inspections', 'insert', {
      id: inspection.id, user_id: userId, project_id: inspection.projectId,
      template_id: inspection.templateId ?? null, title: inspection.title,
      date: inspection.date, inspector: inspection.inspector,
      items: inspection.items, score: inspection.score,
      status: inspection.status ?? 'complete',
      created_by: inspection.createdBy, created_at: inspection.createdAt,
    });
  }, [canSync, userId]);

  const updateInspection = useCallback((id: string, changes: Partial<SafetyInspection>) => {
    setInspections((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, ...changes, updatedAt: new Date().toISOString() } : x));
      void AsyncStorage.setItem(SAFETY_INSPECTIONS_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) {
      const payload: Record<string, unknown> = { id };
      if (changes.title !== undefined) payload.title = changes.title;
      if (changes.date !== undefined) payload.date = changes.date;
      if (changes.inspector !== undefined) payload.inspector = changes.inspector;
      if (changes.items !== undefined) payload.items = changes.items;
      if (changes.score !== undefined) payload.score = changes.score;
      if (changes.status !== undefined) payload.status = changes.status;
      if (changes.templateId !== undefined) payload.template_id = changes.templateId;
      void supabaseWrite('safety_inspections', 'update', payload);
    }
  }, [canSync]);

  const deleteInspection = useCallback((id: string) => {
    setInspections((prev) => {
      const next = prev.filter((x) => x.id !== id);
      void AsyncStorage.setItem(SAFETY_INSPECTIONS_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) void supabaseWrite('safety_inspections', 'delete', { id });
  }, [canSync]);

  const getInspectionsForProject = useCallback(
    (projectId: string) => inspections.filter((i) => i.projectId === projectId),
    [inspections],
  );
```

- [ ] Add the Certifications CRUD + status selectors:

```typescript
  const addCertification = useCallback((cert: Certification) => {
    setCertifications((prev) => {
      const next = [cert, ...prev];
      void AsyncStorage.setItem(CERTIFICATIONS_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) void supabaseWrite('certifications', 'insert', {
      id: cert.id, user_id: userId, holder_name: cert.holderName, sub_id: cert.subId ?? null,
      type: cert.type, issued_date: cert.issuedDate ?? null, expires_date: cert.expiresDate ?? null,
      document_url: cert.documentUrl ?? null, status: cert.status,
      created_by: cert.createdBy, created_at: cert.createdAt,
    });
  }, [canSync, userId]);

  const updateCertification = useCallback((id: string, changes: Partial<Certification>) => {
    setCertifications((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, ...changes, updatedAt: new Date().toISOString() } : x));
      void AsyncStorage.setItem(CERTIFICATIONS_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) {
      const payload: Record<string, unknown> = { id };
      if (changes.holderName !== undefined) payload.holder_name = changes.holderName;
      if (changes.subId !== undefined) payload.sub_id = changes.subId;
      if (changes.type !== undefined) payload.type = changes.type;
      if (changes.issuedDate !== undefined) payload.issued_date = changes.issuedDate;
      if (changes.expiresDate !== undefined) payload.expires_date = changes.expiresDate;
      if (changes.documentUrl !== undefined) payload.document_url = changes.documentUrl;
      if (changes.status !== undefined) payload.status = changes.status;
      void supabaseWrite('certifications', 'update', payload);
    }
  }, [canSync]);

  const deleteCertification = useCallback((id: string) => {
    setCertifications((prev) => {
      const next = prev.filter((x) => x.id !== id);
      void AsyncStorage.setItem(CERTIFICATIONS_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) void supabaseWrite('certifications', 'delete', { id });
  }, [canSync]);

  /** Certifications with status re-derived against `referenceDate` (today). */
  const certificationsWithStatus = useCallback(
    (referenceDate: string) =>
      certifications.map((c) => ({ ...c, status: certStatus(c.expiresDate, referenceDate) })),
    [certifications],
  );

  /** Non-valid certs (expiring or expired) for the company dashboard. */
  const expiringCertifications = useCallback(
    (referenceDate: string) => certificationsWithStatus(referenceDate).filter((c) => c.status !== 'valid'),
    [certificationsWithStatus],
  );
```

- [ ] Add the Templates CRUD:

```typescript
  const addTemplate = useCallback((template: SafetyFormTemplate) => {
    setTemplates((prev) => {
      const next = [template, ...prev];
      void AsyncStorage.setItem(SAFETY_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) void supabaseWrite('safety_templates', 'insert', {
      id: template.id, user_id: userId, name: template.name, category: template.category,
      fields: template.fields, created_by: template.createdBy, created_at: template.createdAt,
    });
  }, [canSync, userId]);

  const updateTemplate = useCallback((id: string, changes: Partial<SafetyFormTemplate>) => {
    setTemplates((prev) => {
      const next = prev.map((x) => (x.id === id ? { ...x, ...changes, updatedAt: new Date().toISOString() } : x));
      void AsyncStorage.setItem(SAFETY_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) {
      const payload: Record<string, unknown> = { id };
      if (changes.name !== undefined) payload.name = changes.name;
      if (changes.category !== undefined) payload.category = changes.category;
      if (changes.fields !== undefined) payload.fields = changes.fields;
      void supabaseWrite('safety_templates', 'update', payload);
    }
  }, [canSync]);

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => {
      const next = prev.filter((x) => x.id !== id);
      void AsyncStorage.setItem(SAFETY_TEMPLATES_KEY, JSON.stringify(next));
      return next;
    });
    if (canSync) void supabaseWrite('safety_templates', 'delete', { id });
  }, [canSync]);
```

- [ ] Extend the hook's returned `useMemo` object (append these keys to the Wave A return; add every new value to the dependency array):

```typescript
    // Wave B — inspections (project-scoped)
    inspections, getInspectionsForProject, addInspection, updateInspection, deleteInspection,
    // Wave B — certifications (company-scoped)
    certifications, certificationsWithStatus, expiringCertifications,
    addCertification, updateCertification, deleteCertification,
    // Wave B — forms library (company-scoped)
    templates, addTemplate, updateTemplate, deleteTemplate,
```

- [ ] `npx tsc --noEmit` — must pass.
- [ ] `git add contexts/SafetyContext.tsx`
- [ ] `git commit -m "safety: SafetyContext Wave B collections (inspections, certs, templates)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 6 — Migration + schema.sql mirror

**Files:** `supabase/migrations/20260708180000_safety_wave_b.sql`, `supabase/schema.sql`

> The timestamp `20260708180000` is intentionally after the Wave A migration (`20260708HHMMSS_safety_wave_a.sql`). If Wave A used a later time, bump this filename so it sorts after. **Additive, RLS-scoped, apply BEFORE the OTA** that writes these tables (PGRST204 gate — a missing column silently drops the write via `supabaseWrite`). Owner applies via Supabase MCP `apply_migration`, never `db push`.

- [ ] Create `supabase/migrations/20260708180000_safety_wave_b.sql`:

```sql
-- 20260708180000_safety_wave_b.sql
-- Safety Management — Wave B (compliance layer): inspections/audits,
-- certifications tracking, and the reusable forms library.
--
-- Extends the Wave A safety tables (jhas, toolbox_talks, safety_incidents,
-- hazards). All additive. Apply BEFORE the OTA that writes these tables.
--
-- Scoping:
--   safety_inspections — project-scoped, owned by the GC (user_id).
--   certifications     — COMPANY-scoped (person/sub); owned by user_id; NO project.
--   safety_templates   — COMPANY-scoped forms library; owned by user_id.

-- Shared updated_at bump used by all three tables.
CREATE OR REPLACE FUNCTION public.safety_wave_b_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $body$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$body$;

-- ── safety_inspections ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_inspections (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id text NOT NULL,
  template_id text,
  title text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  inspector text NOT NULL DEFAULT '',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  score numeric(4,3) NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'complete' CHECK (status IN ('draft','complete')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_inspections_user_idx ON public.safety_inspections(user_id);
CREATE INDEX IF NOT EXISTS safety_inspections_project_idx ON public.safety_inspections(project_id);
ALTER TABLE public.safety_inspections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "safety_inspections_all_own" ON public.safety_inspections;
CREATE POLICY "safety_inspections_all_own" ON public.safety_inspections
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS safety_inspections_updated_at ON public.safety_inspections;
CREATE TRIGGER safety_inspections_updated_at
  BEFORE UPDATE ON public.safety_inspections
  FOR EACH ROW EXECUTE FUNCTION public.safety_wave_b_set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_inspections TO authenticated;

-- ── certifications ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.certifications (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  holder_name text NOT NULL DEFAULT '',
  sub_id text,
  type text NOT NULL DEFAULT '',
  issued_date text,
  expires_date text,
  document_url text,
  status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid','expiring','expired')),
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS certifications_user_idx ON public.certifications(user_id);
CREATE INDEX IF NOT EXISTS certifications_sub_idx ON public.certifications(sub_id);
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "certifications_all_own" ON public.certifications;
CREATE POLICY "certifications_all_own" ON public.certifications
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS certifications_updated_at ON public.certifications;
CREATE TRIGGER certifications_updated_at
  BEFORE UPDATE ON public.certifications
  FOR EACH ROW EXECUTE FUNCTION public.safety_wave_b_set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.certifications TO authenticated;

-- ── safety_templates ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_templates (
  id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'general' CHECK (category IN ('jha','inspection','general')),
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS safety_templates_user_idx ON public.safety_templates(user_id);
ALTER TABLE public.safety_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "safety_templates_all_own" ON public.safety_templates;
CREATE POLICY "safety_templates_all_own" ON public.safety_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP TRIGGER IF EXISTS safety_templates_updated_at ON public.safety_templates;
CREATE TRIGGER safety_templates_updated_at
  BEFORE UPDATE ON public.safety_templates
  FOR EACH ROW EXECUTE FUNCTION public.safety_wave_b_set_updated_at();
GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_templates TO authenticated;
```

- [ ] Mirror the three `CREATE TABLE IF NOT EXISTS` blocks (plus their indexes, RLS enable, `_all_own` policy, and GRANT — the `safety_wave_b_set_updated_at` function + triggers may be omitted from `schema.sql` to keep it declarative, matching how `schema.sql` handles other tables) into `supabase/schema.sql`, appended at the end **before** the `ENABLE REALTIME` / `handle_new_user` trigger section. Keep them idempotent.
- [ ] `git add supabase/migrations/20260708180000_safety_wave_b.sql supabase/schema.sql`
- [ ] `git commit -m "safety: Wave B migration + schema (inspections, certifications, templates)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 7 — Hub tiles + route registration

**Files:** `app/safety.tsx`, `app/_layout.tsx`

- [ ] In `app/safety.tsx`, add four tiles to the existing Wave A tile grid (mirror the shape of the Wave A tiles — same tile component, `useTheme`, amber accent, lucide icons; import `ClipboardCheck`, `BadgeCheck`, `FileText`, `ShieldAlert` from `lucide-react-native`). Each tile navigates to its screen. If the hub is project-scoped, pass `projectId`; certifications / forms / OSHA are company-scoped and take no projectId (OSHA takes an optional `projectId` for a project-filtered log — pass it when present):

```tsx
// Inspections — project-scoped
<SafetyTile
  icon={<ClipboardCheck size={24} color={themeColors.accent} strokeWidth={1.75} />}
  label="Inspections"
  sublabel="Audits & safety walks"
  onPress={() => router.push({ pathname: '/safety-inspections' as never, params: { projectId } as never })}
/>
// Certifications — company-scoped dashboard
<SafetyTile
  icon={<BadgeCheck size={24} color={themeColors.accent} strokeWidth={1.75} />}
  label="Certifications"
  sublabel="Expiring soon"
  onPress={() => router.push('/safety-certifications' as never)}
/>
// Forms Library — company-scoped
<SafetyTile
  icon={<FileText size={24} color={themeColors.accent} strokeWidth={1.75} />}
  label="Forms Library"
  sublabel="Reusable checklists"
  onPress={() => router.push('/safety-forms' as never)}
/>
// OSHA 300 Log — recordable-incident report
<SafetyTile
  icon={<ShieldAlert size={24} color={themeColors.accent} strokeWidth={1.75} />}
  label="OSHA 300 Log"
  sublabel="Export PDF / CSV"
  onPress={() => router.push({ pathname: '/safety-osha' as never, params: { projectId } as never })}
/>
```

> Use the actual Wave A tile component / markup in this file — the snippet shows intent, not necessarily the exact JSX names. Keep the Business gate the hub already enforces.

- [ ] In `app/_layout.tsx`, register the four routes next to the Wave A `safety` `Stack.Screen` (mirror its options style):

```tsx
<Stack.Screen name="safety-inspections" options={{ title: 'Inspections' }} />
<Stack.Screen name="safety-certifications" options={{ title: 'Certifications' }} />
<Stack.Screen name="safety-forms" options={{ title: 'Forms Library' }} />
<Stack.Screen name="safety-osha" options={{ title: 'OSHA 300 Log' }} />
```

- [ ] `npx tsc --noEmit` — typed routes must resolve (the screen files land in Tasks 8–11; if typed-routes fails because the route files don't exist yet, complete Tasks 8–11 then re-run before committing this task, OR commit Tasks 8–11 first and do the tile/route wiring last. Recommended: reorder to wire routes after the screens exist.)
- [ ] `git add app/safety.tsx app/_layout.tsx`
- [ ] `git commit -m "safety: hub tiles + route registration for Wave B screens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 8 — Inspections screen

**File:** `app/safety-inspections.tsx`

**Component spec** — mirror `app/punch-list.tsx` structure exactly: a default-exported gate wrapper + an `Inner` component; `useThemedStyles(makeStyles)` + `useTheme`; `useSafeAreaInsets`; a `Stack.Screen` title; a scrolling list of cards; a slide-up `Modal` form; a `makeStyles(themeColors)` block copied from `punch-list.tsx` and trimmed. Copy `punch-list.tsx`'s modal + card + button styles wholesale and rename.

Behavior:
- **Gate:** wrap with `useTierAccess().canAccess('safety_management')`; render `<Paywall visible feature="Safety Management" requiredTier="business" onClose={() => router.back()} />` when denied (mirror `PunchListScreen`).
- **Params:** `const { projectId } = useLocalSearchParams<{ projectId: string }>();`
- **Data:** `const { getInspectionsForProject, addInspection, updateInspection, deleteInspection, templates, addHazard } = useSafety();`
- **List:** each inspection card shows `title`, `date`, `inspector`, a score chip (`Math.round(scoreInspection(items).score * 100)%`), and counts (`pass`/`fail`/`na`). Use `scoreInspection` from `@/utils/safety/inspectionScore`.
- **New inspection modal:** fields `title`, `date` (YYYY-MM-DD), `inspector`; a template picker (from `templates.filter(t => t.category === 'inspection')`) — picking one seeds `items` via `inspectionItemsFromTemplate(template, generateUUID)`. If no template, start with an empty item list and an "Add item" affordance (each item = `{ id: generateUUID(), prompt, result: 'na' }`).
- **Per-item control:** a three-way pass / fail / na segmented control. When set to `fail`, reveal a "Log as hazard" button.
- **Save:** compute `score` with `scoreInspection`, then `addInspection({...})` (or `updateInspection` when editing).
- **Fail → hazard:** on "Log as hazard", call `addHazard(hazardFromFailedItem({ id: inspection.id, projectId, createdBy }, item, new Date().toISOString(), generateUUID()))`, then toast/Alert confirming the hazard was added to the Hazard Log.

**Key snippets:**

```tsx
import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Alert, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, X, ClipboardCheck, TriangleAlert, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { generateUUID } from '@/utils/generateId';
import { scoreInspection, inspectionItemsFromTemplate, hazardFromFailedItem } from '@/utils/safety/inspectionScore';
import type { SafetyInspection, InspectionItem } from '@/types';

const RESULTS: InspectionItem['result'][] = ['pass', 'fail', 'na'];

// ...gate wrapper mirrors PunchListScreen...

function cycleResult(items: InspectionItem[], id: string, result: InspectionItem['result']): InspectionItem[] {
  return items.map((it) => (it.id === id ? { ...it, result } : it));
}

const handleLogHazard = useCallback((inspectionId: string, projectId: string, item: InspectionItem) => {
  const hz = hazardFromFailedItem(
    { id: inspectionId, projectId, createdBy: userId ?? '' },
    item,
    new Date().toISOString(),
    generateUUID(),
  );
  addHazard(hz);
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  Alert.alert('Hazard logged', `"${item.prompt}" was added to the Hazard Log for follow-up.`);
}, [addHazard, userId]);

const handleSave = useCallback(() => {
  if (!title.trim()) { Alert.alert('Missing title', 'Give the inspection a title.'); return; }
  const score = scoreInspection(items).score;
  if (editing) {
    updateInspection(editing.id, { title: title.trim(), date, inspector: inspector.trim(), items, score });
  } else {
    const inspection: SafetyInspection = {
      id: generateUUID(), projectId: projectId ?? '', title: title.trim(), date,
      inspector: inspector.trim(), items, score, status: 'complete', templateId,
      createdAt: new Date().toISOString(), createdBy: userId ?? '',
    };
    addInspection(inspection);
  }
  setShowForm(false);
}, [title, date, inspector, items, templateId, editing, projectId, userId, addInspection, updateInspection]);
```

- [ ] Implement the full screen (list + modal + styles). `npx tsc --noEmit` must pass.
- [ ] `git add app/safety-inspections.tsx`
- [ ] `git commit -m "safety: inspections/audits screen with fail→hazard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 9 — Certifications dashboard screen

**File:** `app/safety-certifications.tsx`

**Component spec** — company-scoped (no `projectId`). Mirror `punch-list.tsx` for scaffolding. Gate on `'safety_management'`.

Behavior:
- **Data:** `const { certifications, certificationsWithStatus, addCertification, updateCertification, deleteCertification } = useSafety();`
- **Reference date:** `const today = useMemo(() => new Date().toISOString().slice(0, 10), []);`
- **Derived list:** `const withStatus = useMemo(() => certificationsWithStatus(today), [certificationsWithStatus, today]);`
- **Filter chips:** `all | expiring | expired | valid` (default `all`). An "Expiring soon" summary banner at top shows the count of non-valid certs (`withStatus.filter(c => c.status !== 'valid').length`).
- **Status badge colors:** valid → `themeColors.success`, expiring → `themeColors.accent` (amber), expired → `themeColors.danger`.
- **Card:** `holderName`, `type`, `expiresDate` ("Expires {date}" or "No expiry"), status badge, optional linked sub name (`subId`), a "View document" chip when `documentUrl` present.
- **New cert modal:** `holderName`, `type` (free text with quick-pick chips: `OSHA 10`, `OSHA 30`, `SST`, `CPR`, `First Aid`), `issuedDate`, `expiresDate`, optional sub picker (from `useProjects().subcontractors`), optional `documentUrl`. On save, set `status: certStatus(expiresDate, today)` and `addCertification({...})`.

**Key snippet:**

```tsx
import { certStatus } from '@/utils/safety/certStatus';
import type { Certification, CertificationStatus } from '@/types';

const STATUS_STYLE = (t: ThemeColors): Record<CertificationStatus, { label: string; color: string }> => ({
  valid:    { label: 'Valid',    color: t.success },
  expiring: { label: 'Expiring', color: t.accent },
  expired:  { label: 'Expired',  color: t.danger },
});

const handleSave = useCallback(() => {
  if (!holderName.trim() || !type.trim()) { Alert.alert('Missing info', 'Holder name and type are required.'); return; }
  const status = certStatus(expiresDate || undefined, today);
  if (editing) {
    updateCertification(editing.id, { holderName: holderName.trim(), type: type.trim(), subId: subId || undefined, issuedDate: issuedDate || undefined, expiresDate: expiresDate || undefined, documentUrl: documentUrl || undefined, status });
  } else {
    const cert: Certification = {
      id: generateUUID(), holderName: holderName.trim(), type: type.trim(),
      subId: subId || undefined, issuedDate: issuedDate || undefined,
      expiresDate: expiresDate || undefined, documentUrl: documentUrl || undefined,
      status, createdAt: new Date().toISOString(), createdBy: userId ?? '',
    };
    addCertification(cert);
  }
  setShowForm(false);
}, [holderName, type, subId, issuedDate, expiresDate, documentUrl, today, editing, userId, addCertification, updateCertification]);
```

- [ ] Implement the full screen. `npx tsc --noEmit` must pass.
- [ ] `git add app/safety-certifications.tsx`
- [ ] `git commit -m "safety: certifications dashboard (expiring-soon)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 10 — Forms Library screen

**File:** `app/safety-forms.tsx`

**Component spec** — company-scoped. Mirror `punch-list.tsx`. Gate on `'safety_management'`. **No drag-drop** — fields are an ordered list edited with move-up / move-down / delete controls.

Behavior:
- **Data:** `const { templates, addTemplate, updateTemplate, deleteTemplate } = useSafety();`
- **List:** each template card shows `name`, a category chip (`jha` / `inspection` / `general`), and `{fields.length} fields`.
- **Editor modal:** `name`; `category` segmented control (`jha | inspection | general`); an ordered field list. Each field row: `label` text input, a `type` picker (`text | checkbox | select | signature | photo`), a `required` toggle, and (when `type === 'select'`) a comma-separated `options` input. Move-up / move-down reorder buttons + a delete button per field. "Add field" appends `{ id: generateUUID(), label: '', type: 'text', required: false }`.
- **Save:** trim empty-label fields out, then `addTemplate`/`updateTemplate`.

**Key snippets:**

```tsx
import type { SafetyFormTemplate, SafetyFormField, SafetyFormFieldType } from '@/types';

const FIELD_TYPES: SafetyFormFieldType[] = ['text', 'checkbox', 'select', 'signature', 'photo'];

function moveField(fields: SafetyFormField[], index: number, dir: -1 | 1): SafetyFormField[] {
  const j = index + dir;
  if (j < 0 || j >= fields.length) return fields;
  const next = [...fields];
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

const handleSave = useCallback(() => {
  const cleaned = fields.filter((f) => f.label.trim()).map((f) => ({
    ...f, label: f.label.trim(),
    options: f.type === 'select' ? (f.options ?? []).filter(Boolean) : undefined,
  }));
  if (!name.trim() || cleaned.length === 0) { Alert.alert('Incomplete', 'A form needs a name and at least one labeled field.'); return; }
  if (editing) {
    updateTemplate(editing.id, { name: name.trim(), category, fields: cleaned });
  } else {
    const template: SafetyFormTemplate = {
      id: generateUUID(), name: name.trim(), category, fields: cleaned,
      createdAt: new Date().toISOString(), createdBy: userId ?? '',
    };
    addTemplate(template);
  }
  setShowForm(false);
}, [name, category, fields, editing, userId, addTemplate, updateTemplate]);
```

- [ ] Implement the full screen. `npx tsc --noEmit` must pass.
- [ ] `git add app/safety-forms.tsx`
- [ ] `git commit -m "safety: reusable forms library (ordered field list)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 11 — OSHA-300 export (RN glue) + screen

**Files:** `utils/safety/oshaExport.ts`, `app/safety-osha.tsx`

- [ ] Create `utils/safety/oshaExport.ts` (mirrors `utils/scheduleReportExport.ts` — web opens a print tab, native uses `printToFileAsync` + `Sharing`):

```typescript
// oshaExport.ts — RN glue for the OSHA-300 log. Imports the pure builders
// from oshaLog.ts and renders/share them. Kept separate from oshaLog.ts so
// the validator can run the pure module under bun without loading react-native.
import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import type { SafetyIncident } from '@/types';
import { buildOsha300Log, buildOsha300Html, osha300ToCsv, type OshaEstablishment } from '@/utils/safety/oshaLog';

export async function exportOsha300Pdf(incidents: SafetyIncident[], est: OshaEstablishment): Promise<void> {
  const rows = buildOsha300Log(incidents);
  const html = buildOsha300Html(rows, est);
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    const w = window.open('', '_blank', 'noopener,noreferrer');
    if (!w) { const blob = new Blob([html], { type: 'text/html' }); window.open(URL.createObjectURL(blob), '_blank'); return; }
    w.document.open(); w.document.write(html); w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* user can Cmd-P */ } }, 350);
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'OSHA 300 Log', UTI: 'com.adobe.pdf' });
  else await Print.printAsync({ uri });
}

export async function shareOsha300Csv(incidents: SafetyIncident[], est: OshaEstablishment): Promise<void> {
  const rows = buildOsha300Log(incidents);
  const csv = osha300ToCsv(rows, est);
  const filename = `OSHA300_${est.year}.csv`;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click();
    return;
  }
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: 'utf8' });
  const canShare = await Sharing.isAvailableAsync();
  if (canShare) await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: filename });
}
```

- [ ] Create `app/safety-osha.tsx` — a read-only report screen. Gate on `'safety_management'`. Mirror `punch-list.tsx` scaffolding (no add-modal; two export buttons).

**Component spec:**
- **Data:** `const { incidents } = useSafety();` (Wave-A collection). Optional `projectId` param filters the log to one project.
- **Establishment:** `const est = { name: companyName ?? 'My Company', year: String(new Date().getFullYear()) };` — pull `companyName` from `useCompanies().companies[0]?.companyName` if available, else a sensible default.
- **Derived:** `const rows = useMemo(() => buildOsha300Log(scopedIncidents), [scopedIncidents]);` where `scopedIncidents = projectId ? incidents.filter(i => i.projectId === projectId) : incidents;`.
- **Summary header:** recordable case count, and a note that outcome columns (days away / restriction) are derived until Wave A adds explicit OSHA outcome fields.
- **List:** one row per `Osha300Row` — case no., date, employee, classification label, description.
- **Two buttons:** "Export PDF" → `exportOsha300Pdf(scopedIncidents, est)`; "Export CSV" → `shareOsha300Csv(scopedIncidents, est)`. Amber primary + secondary styling.
- **Empty state:** when `rows.length === 0`, `<EmptyState icon={<ShieldAlert .../>} title="No recordable cases" message="Recordable incidents from the Incidents log appear here for OSHA 300 reporting." />`.

**Key snippet:**

```tsx
import { buildOsha300Log } from '@/utils/safety/oshaLog';
import { exportOsha300Pdf, shareOsha300Csv } from '@/utils/safety/oshaExport';

const scopedIncidents = useMemo(
  () => (projectId ? incidents.filter((i) => i.projectId === projectId) : incidents),
  [incidents, projectId],
);
const rows = useMemo(() => buildOsha300Log(scopedIncidents), [scopedIncidents]);
const est = useMemo(() => ({ name: companyName || 'My Company', year: String(new Date().getFullYear()) }), [companyName]);
```

- [ ] `npx tsc --noEmit` must pass. If Task 7 was committed before the screens existed and typed-routes failed, re-run `npx tsc --noEmit` now — all four routes resolve.
- [ ] `git add utils/safety/oshaExport.ts app/safety-osha.tsx`
- [ ] `git commit -m "safety: OSHA-300 log screen + PDF/CSV export

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`

---

## Task 12 — Nav / tier verification + final gate

No new gate key: Inspections / Certifications / Forms / OSHA all reuse the `'safety_management'` `FeatureKey` (Business+) that Wave A added to `hooks/useTierAccess.ts`. Every Wave B screen wraps its content in that gate + `<Paywall requiredTier="business" />`.

- [ ] **Nav:** confirm the four tiles live under the existing `app/safety.tsx` hub (already Business-gated). The hub itself is the single nav entry (registered in `DesktopSidebar` / tabs by Wave A) — **do not** add the sub-screens to `DesktopSidebar` or the tab bar; they are reached from the hub, matching how `punch-list` sits under a project rather than in the tab bar.
- [ ] **Tier sanity:** grep that every Wave B screen calls `canAccess('safety_management')`:
  ```bash
  grep -n "safety_management" app/safety-inspections.tsx app/safety-certifications.tsx app/safety-forms.tsx app/safety-osha.tsx
  ```
  Expect a hit in each.
- [ ] **Migration-before-OTA reminder** (owner action, not a code change): the `20260708180000_safety_wave_b.sql` migration must be applied via Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`) **before** publishing the OTA that ships these screens — otherwise `supabaseWrite` inserts silently fail with PGRST204 on the missing tables. Verify with:
  ```sql
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('safety_inspections','certifications','safety_templates');
  ```
- [ ] **Full gate:** run `bun run ship-check`. It must pass — including the three new lines `test:safety-cert`, `test:safety-inspection`, `test:safety-osha` alongside the existing suite.
- [ ] `npx tsc --noEmit` — clean.
- [ ] `git add -A && git commit -m "safety: Wave B nav/tier verification + ship-check wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"` (only if any files changed in this task; otherwise skip the commit.)

---

## Wave B spec-coverage checklist (self-review)

| Spec requirement | Task |
| --- | --- |
| `SafetyInspection` type + `InspectionItem` (`prompt/result/note?/photoUrl?`) | 1 |
| `Certification` type (person/sub-scoped) + `CertificationStatus` | 1 |
| `SafetyFormTemplate` + `SafetyFormField` (5 field types, ordered) | 1 |
| Inspection `score = pass/(pass+fail)` computed | 3 (pure) + 8 (UI) |
| Failed item → Wave-A `Hazard` with `sourceInspectionId` | 3 (pure) + 8 (UI) |
| Inspection uses `SafetyFormTemplate` for the checklist | 3 (`inspectionItemsFromTemplate`) + 8 |
| Cert `status` (valid/expiring-≤30d/expired) from `expiresDate` + reference date | 2 (pure) + 9 (UI) |
| Cert links to subs (`tertiary_subcontractors`) + `PrequalSafetyRecord` (`subId`) | 1 + 9 |
| Company-level "expiring soon" dashboard | 9 |
| Forms library company-level, ordered field list, NO drag-drop | 10 |
| OSHA-300 as computed report over recordable `SafetyIncident`s | 4 (pure) + 11 |
| OSHA-300 PDF (`expo-print`) + CSV export | 11 |
| `tertiary_safety_inspections` / `tertiary_certifications` / `tertiary_safety_templates` collections | 5 |
| Additive tables `safety_inspections` / `certifications` / `safety_templates` (RLS) + schema.sql | 6 |
| `scripts/validate-safety-cert.ts` → ship-check | 2 |
| `scripts/validate-safety-inspection.ts` → ship-check | 3 |
| `scripts/validate-safety-osha.ts` → ship-check | 4 |
| Business+ gate via existing `safety_management` key (no new key) | 7, 9, 8, 10, 11, 12 |
| Hub tiles + route registration | 7 |
| Migration applied before OTA (PGRST204 gate) | 6, 12 |

**Name-consistency guarantee:** Wave B reuses Wave A's `useSafety` hook, `SafetyProvider`, `addHazard`, `incidents`, and the `Hazard.sourceInspectionId` field verbatim; introduces `SafetyInspection` / `InspectionItem` / `Certification` / `SafetyFormTemplate` / `SafetyFormField`; and reuses the amber brand, `lucide-react-native`, `useTheme` / `useThemedStyles`, `supabaseWrite`, and the `tertiary_*` AsyncStorage convention throughout.
