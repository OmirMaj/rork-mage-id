# Safety Management — Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the daily-field core of MAGE's Safety module — Job Hazard Analyses (JHAs), Toolbox Talks, Incident/near-miss reporting, and a Hazard Log — plus the three AI edge functions (`safety-generate-jha`, `safety-detect-hazards`, `safety-draft-incident`) that differentiate MAGE from JACK App. Business-tier gated, offline-first, OTA-safe (no new native deps). Wave B (inspections, certifications, forms library, OSHA-300 export) is explicitly OUT of scope for this plan.

**Architecture:** A dedicated `SafetyContext` (built with `@nkzw/create-context-hook`) mounted directly inside `<ProjectProvider>` in `app/_layout.tsx`. Every collection persists to `AsyncStorage` under a `tertiary_*` key and, when the user is authed + Supabase is configured, mirrors writes through `utils/offlineQueue.ts` `supabaseWrite` (optimistic-local, queued-on-fail, flushed by the already-mounted `OfflineSyncManager`). Pure risk-scoring / OSHA-recordable logic lives in `utils/safety/*` and is unit-tested by pure-fn validators wired into `bun run ship-check` (the repo has no jest). AI runs in new Supabase edge functions behind `requireTier(['business'])` + monthly metering. UI is a project-scoped hub (`app/safety.tsx`) whose tiles route to four feature screens that each mirror the `app/punch-list.tsx` list + create/edit-modal pattern.

**Tech Stack:** React Native / Expo (New Arch, OTA-safe), Expo Router 6 typed routes, `@tanstack/react-query` + Supabase (RLS tables + Deno edge functions), `zustand`/context for state, `lucide-react-native` icons, `useThemedStyles`/`useTheme` amber-brand theming. Package manager **bun**; type-check `npx tsc --noEmit`; gate `bun run ship-check`.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `utils/safety/risk.ts` | Pure risk-matrix logic: `computeRiskScore(severity, likelihood)` = severity×likelihood on a 1–5 scale + `riskBand(score)` banding. No UI, no RN imports. |
| `utils/safety/osha.ts` | Pure `isOshaRecordable(input)` classifier (fatality / days-away / restricted-duty / lost-consciousness / medical-beyond-first-aid) + the `IncidentClassInput` type. |
| `scripts/validate-safety-risk.ts` | Pure-fn validator for `utils/safety/risk.ts`, wired into ship-check as `test:safety-risk`. |
| `scripts/validate-safety-osha.ts` | Pure-fn validator for `utils/safety/osha.ts`, wired into ship-check as `test:safety-osha`. |
| `contexts/SafetyContext.tsx` | `createContextHook` provider exposing `jhas`/`toolboxTalks`/`incidents`/`hazards` collections + add/update/delete/getForProject for each; local persistence + `supabaseWrite` sync. |
| `app/safety.tsx` | Project-scoped hub screen: 4 tiles (JHAs, Toolbox Talks, Incidents, Hazard Log) that route to the feature screens; Business paywall gate. |
| `app/safety-jha.tsx` | JHA list + create/edit modal + "Generate with AI" (`safety-generate-jha`) handler. |
| `app/safety-toolbox.tsx` | Toolbox Talk list + create/edit modal + attendee sign-off capture. |
| `app/safety-incidents.tsx` | Incident/near-miss list + create/edit modal + OSHA-recordable computation + "Draft with AI" (`safety-draft-incident`) handler. |
| `app/safety-hazards.tsx` | Hazard Log list + create/edit modal + risk-score banding + "Detect from photo" (`safety-detect-hazards`) handler. |
| `supabase/functions/safety-generate-jha/index.ts` | Deno edge fn: text → JHA steps (hazards+controls) + required PPE. `requireTier(['business'])`, meters `safety_ai`. |
| `supabase/functions/safety-detect-hazards/index.ts` | Deno edge fn: site photo(s) → candidate hazards `{description,severity,likelihood}[]`. `requireTier(['business'])`, meters `analyze_photos`, SSRF-guards every URL. |
| `supabase/functions/safety-draft-incident/index.ts` | Deno edge fn: transcript/notes(+optional photos) → structured incident draft. `requireTier(['business'])`, meters `safety_ai`. |
| `supabase/migrations/20260708120000_safety_wave_a.sql` | Additive tables `jhas`, `toolbox_talks`, `safety_incidents`, `hazards` (+ RLS, indexes, updated_at triggers). |

**Modified**

| File | Change |
| --- | --- |
| `types/index.ts` | Add `JHAStep`, `SafetySignoff`, `JobHazardAnalysis`, `SafetyAttendee`, `ToolboxTalk`, `SafetyIncidentType`, `SafetyIncidentSeverity`, `SafetyIncident`, `Hazard` domain types. |
| `hooks/useTierAccess.ts` | Add `'safety_management'` to `FeatureKey` union + `REQUIRED_TIER['safety_management'] = 'business'`. |
| `supabase/functions/_shared/auth.ts` | Add a `safety_ai` monthly-cap key to every tier in `MONTHLY_CAPS`. |
| `supabase/schema.sql` | Mirror the four new tables + RLS + indexes + triggers (source-of-truth schema). |
| `app/_layout.tsx` | Import + mount `<SafetyProvider>` inside `<ProjectProvider>`; register the five `safety*` `Stack.Screen`s. |
| `components/DesktopSidebar.tsx` | Add a `{ key: 'safety', ..., requires: 'safety_management' }` NavItem in the `FIELD OPS` section. |
| `package.json` | Add `test:safety-risk` + `test:safety-osha` scripts and append both to `ship-check`. |

---

## Task 1 — Domain types

Adds every Safety Wave-A type to the single source of truth. No logic, no runtime — this unblocks every later task.

**Files:**
- Modify: `types/index.ts`

Steps:

- [ ] 1. Open `types/index.ts` and locate the `PunchItem` interface block (around line 1983). Immediately AFTER the `PunchItem` interface's closing `}` (line 2013, before `export interface ProjectPhoto`), insert the following Safety block:

```typescript
// ─────────────────────────────────────────────────────────────────────────
// SAFETY MANAGEMENT — Wave A (JHAs, Toolbox Talks, Incidents, Hazard Log)
// All records carry id / projectId / createdAt / createdBy; mutated records
// also carry updatedAt. Collections persist under tertiary_* keys and mirror
// to snake_case Supabase tables via SafetyContext.
// ─────────────────────────────────────────────────────────────────────────

/** One row of a Job Hazard Analysis: a task step + its hazards + controls. */
export interface JHAStep {
  id: string;
  step: string;
  hazards: string[];
  controls: string[];
}

/** An append-only signature on a JHA (crew acknowledging the analysis). */
export interface SafetySignoff {
  name: string;
  role: string;
  subId?: string;
  signedAt: string;
}

export type JHAStatus = 'draft' | 'active' | 'archived';

export interface JobHazardAnalysis {
  id: string;
  projectId: string;
  title: string;
  trade: string;
  taskDescription: string;
  date: string;
  steps: JHAStep[];
  requiredPPE: string[];
  signOffs: SafetySignoff[];
  /** Optional plan anchor — reuses the punch-list pin infra. */
  planSheetId?: string;
  pinX?: number;
  pinY?: number;
  aiGenerated: boolean;
  status: JHAStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** An attendee on a Toolbox Talk; signedAt set when they acknowledge. */
export interface SafetyAttendee {
  name: string;
  subId?: string;
  signedAt?: string;
}

export type ToolboxTopicSource = 'incident' | 'hazard' | 'weather' | 'manual';

export interface ToolboxTalk {
  id: string;
  projectId: string;
  topic: string;
  date: string;
  presenter: string;
  notes: string;
  attachmentUrl?: string;
  attendees: SafetyAttendee[];
  aiTopicSource?: ToolboxTopicSource;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SafetyIncidentType = 'injury' | 'near_miss' | 'property' | 'environmental';
export type SafetyIncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SafetyIncidentStatus = 'open' | 'investigating' | 'closed';

/** Medical treatment level — drives OSHA-recordable classification. */
export type SafetyTreatment = 'none' | 'first_aid' | 'medical_beyond_first_aid';

export interface IncidentPerson {
  name: string;
  role: string;
  injuryDescription?: string;
}

export interface IncidentCorrectiveAction {
  action: string;
  owner: string;
  dueDate?: string;
  done: boolean;
}

export interface SafetyIncident {
  id: string;
  projectId: string;
  type: SafetyIncidentType;
  severity: SafetyIncidentSeverity;
  occurredAt: string;
  description: string;
  location: string;
  /** Optional plan anchor — reuses the punch-list pin infra. */
  planSheetId?: string;
  pinX?: number;
  pinY?: number;
  peopleInvolved: IncidentPerson[];
  photoUrls: string[];
  correctiveActions: IncidentCorrectiveAction[];
  // OSHA classification inputs — fed to isOshaRecordable(); oshaRecordable is
  // the computed result stored alongside so the log can filter without recompute.
  treatment: SafetyTreatment;
  daysAway: number;
  restrictedDuty: boolean;
  lostConsciousness: boolean;
  fatality: boolean;
  oshaRecordable: boolean;
  status: SafetyIncidentStatus;
  reportedBy: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type HazardScale = 1 | 2 | 3 | 4 | 5;
export type HazardStatus = 'open' | 'mitigated' | 'closed';

export interface Hazard {
  id: string;
  projectId: string;
  description: string;
  location: string;
  photoUrl?: string;
  severity: HazardScale;
  likelihood: HazardScale;
  /** severity × likelihood, computed by utils/safety/risk.ts. */
  riskScore: number;
  planSheetId?: string;
  pinX?: number;
  pinY?: number;
  assignedTo?: string;
  dueDate?: string;
  correctiveAction?: string;
  status: HazardStatus;
  /** Set when auto-spawned from a failed inspection item (Wave B). */
  sourceInspectionId?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] 2. Type-check to confirm the additions are self-consistent (no callers yet):

```bash
npx tsc --noEmit
```

Expected: PASS (0 errors).

- [ ] 3. Commit:

```bash
git add types/index.ts
git commit -m "$(cat <<'EOF'
Safety Wave A: domain types (JHA, ToolboxTalk, Incident, Hazard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2 — Pure risk logic + validator (TDD)

Risk-matrix scoring is pure math with a table of banding thresholds — write the failing test first, then the module.

**Files:**
- Create: `scripts/validate-safety-risk.ts`
- Create: `utils/safety/risk.ts`
- Modify: `package.json`

Steps:

- [ ] 1. Write the FAILING validator first. Create `scripts/validate-safety-risk.ts`:

```typescript
// validate-safety-risk.ts — unit tests for utils/safety/risk.ts.
// Run via: bun run scripts/validate-safety-risk.ts
//
// Bun executes TypeScript natively — import and exercise the pure fns
// directly. risk.ts has no React Native dependencies.

import { computeRiskScore, riskBand } from '../utils/safety/risk';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

console.log('\nsafety risk validation:');

// computeRiskScore — severity × likelihood on the 1..5 matrix
expect('1 × 1 = 1', computeRiskScore(1, 1), 1);
expect('3 × 3 = 9', computeRiskScore(3, 3), 9);
expect('5 × 5 = 25', computeRiskScore(5, 5), 25);
expect('4 × 2 = 8', computeRiskScore(4, 2), 8);

// Out-of-range + non-integer inputs clamp to 1..5 (defensive — never NaN)
expect('0 clamps up to 1 → 1 × 3 = 3', computeRiskScore(0, 3), 3);
expect('9 clamps down to 5 → 5 × 5 = 25', computeRiskScore(9, 9), 25);
expect('2.6 rounds to 3 → 3 × 2 = 6', computeRiskScore(2.6, 2), 6);
expect('NaN severity → treated as 1 → 1 × 4 = 4', computeRiskScore(NaN, 4), 4);

// riskBand — 5×5 matrix bands: 1-4 low, 5-9 medium, 10-15 high, 16-25 critical
expect('score 1 → low', riskBand(1), 'low');
expect('score 4 → low', riskBand(4), 'low');
expect('score 5 → medium', riskBand(5), 'medium');
expect('score 9 → medium', riskBand(9), 'medium');
expect('score 10 → high', riskBand(10), 'high');
expect('score 15 → high', riskBand(15), 'high');
expect('score 16 → critical', riskBand(16), 'critical');
expect('score 25 → critical', riskBand(25), 'critical');

// Composed: score then band
expect('5×5 → critical', riskBand(computeRiskScore(5, 5)), 'critical');
expect('1×2 → low', riskBand(computeRiskScore(1, 2)), 'low');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] 2. Run it — it MUST fail because `utils/safety/risk.ts` does not exist yet:

```bash
bun run scripts/validate-safety-risk.ts
```

Expected: FAIL (module-not-found / import error — the file isn't there yet).

- [ ] 3. Create `utils/safety/risk.ts`:

```typescript
// utils/safety/risk.ts — pure risk-matrix math for the Hazard Log.
//
// riskScore = severity × likelihood on a 1..5 scale (classic 5×5 matrix,
// range 1..25). Banding maps the score to a four-level qualitative band
// used for sort order + chip color. No UI, no RN imports — unit-tested by
// scripts/validate-safety-risk.ts.

export type RiskBand = 'low' | 'medium' | 'high' | 'critical';

/** Clamp any input to an integer in [1, 5]. Non-finite → 1 (never NaN). */
function clampScale(v: number): number {
  if (!Number.isFinite(v)) return 1;
  const r = Math.round(v);
  if (r < 1) return 1;
  if (r > 5) return 5;
  return r;
}

/** severity × likelihood, each clamped to [1,5] → product in [1,25]. */
export function computeRiskScore(severity: number, likelihood: number): number {
  return clampScale(severity) * clampScale(likelihood);
}

/** 5×5 matrix bands: 1-4 low, 5-9 medium, 10-15 high, 16-25 critical. */
export function riskBand(score: number): RiskBand {
  if (score <= 4) return 'low';
  if (score <= 9) return 'medium';
  if (score <= 15) return 'high';
  return 'critical';
}
```

- [ ] 4. Re-run the validator — it MUST pass now:

```bash
bun run scripts/validate-safety-risk.ts
```

Expected: PASS (`16 passed, 0 failed`).

- [ ] 5. Wire the validator into `package.json`. In the `scripts` block, add a `test:safety-risk` entry after `test:app-slop`:

```json
    "test:app-slop": "bun run scripts/validate-app-slop.ts",
    "test:safety-risk": "bun run scripts/validate-safety-risk.ts",
```

Then append `&& bun run test:safety-risk` to the `ship-check` script, immediately before `&& bun run test:app-slop`:

```json
    "ship-check": "bun run typecheck && bun run lint && bun run test:colors && bun run test:health && bun run test:barlabel && bun run test:gating && bun run test:sched-schema && bun run test:sched-history && bun run test:sched-depcycle && bun run test:sched-copilot && bun run test:cpm && bun run test:safety-risk && bun run test:app-slop",
```

- [ ] 6. Commit:

```bash
git add utils/safety/risk.ts scripts/validate-safety-risk.ts package.json
git commit -m "$(cat <<'EOF'
Safety Wave A: risk-matrix pure logic + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3 — Pure OSHA-recordable logic + validator (TDD)

`oshaRecordable` classification (per OSHA 1904 recording criteria) is pure boolean logic — test first, then implement.

**Files:**
- Create: `scripts/validate-safety-osha.ts`
- Create: `utils/safety/osha.ts`
- Modify: `package.json`

Steps:

- [ ] 1. Write the FAILING validator first. Create `scripts/validate-safety-osha.ts`:

```typescript
// validate-safety-osha.ts — unit tests for utils/safety/osha.ts.
// Run via: bun run scripts/validate-safety-osha.ts

import { isOshaRecordable, type IncidentClassInput } from '../utils/safety/osha';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:  ', got, '\n      want: ', want); }
}

// Baseline: a non-recordable first-aid-only injury. Each case overrides.
function base(over: Partial<IncidentClassInput>): IncidentClassInput {
  return {
    type: 'injury',
    treatment: 'first_aid',
    daysAway: 0,
    restrictedDuty: false,
    lostConsciousness: false,
    fatality: false,
    ...over,
  };
}

console.log('\nsafety OSHA-recordable validation:');

// Non-injury types are never recordable (near-miss / property / environmental)
expect('near_miss → not recordable', isOshaRecordable(base({ type: 'near_miss', treatment: 'none' })), false);
expect('property damage → not recordable', isOshaRecordable(base({ type: 'property', treatment: 'none' })), false);
expect('environmental → not recordable', isOshaRecordable(base({ type: 'environmental', treatment: 'none' })), false);

// First-aid-only injury is NOT recordable
expect('injury, first aid only → not recordable', isOshaRecordable(base({})), false);
expect('injury, no treatment → not recordable', isOshaRecordable(base({ treatment: 'none' })), false);

// Any recording trigger flips it to recordable
expect('medical beyond first aid → recordable', isOshaRecordable(base({ treatment: 'medical_beyond_first_aid' })), true);
expect('days away > 0 → recordable', isOshaRecordable(base({ daysAway: 3 })), true);
expect('restricted duty → recordable', isOshaRecordable(base({ restrictedDuty: true })), true);
expect('lost consciousness → recordable', isOshaRecordable(base({ lostConsciousness: true })), true);

// Fatality is always recordable — even if some other field looks benign
expect('fatality → recordable', isOshaRecordable(base({ fatality: true, treatment: 'none' })), true);
// A fatality on a non-injury-typed record is still recordable (death is death)
expect('fatality on environmental → recordable', isOshaRecordable(base({ type: 'environmental', fatality: true, treatment: 'none' })), true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] 2. Run it — it MUST fail (module missing):

```bash
bun run scripts/validate-safety-osha.ts
```

Expected: FAIL (module-not-found).

- [ ] 3. Create `utils/safety/osha.ts`:

```typescript
// utils/safety/osha.ts — pure OSHA-recordable classifier for incidents.
//
// Mirrors the OSHA 1904 general recording criteria: a work-related injury or
// illness is recordable if it results in death, days away from work,
// restricted work / job transfer, loss of consciousness, or medical treatment
// beyond first aid. Near-misses and pure property / environmental events with
// no injury are not recordable (a fatality always is). Pure logic — no UI,
// unit-tested by scripts/validate-safety-osha.ts.

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
```

- [ ] 4. Re-run — it MUST pass:

```bash
bun run scripts/validate-safety-osha.ts
```

Expected: PASS (`11 passed, 0 failed`).

- [ ] 5. Wire into `package.json`. Add the script after `test:safety-risk`:

```json
    "test:safety-risk": "bun run scripts/validate-safety-risk.ts",
    "test:safety-osha": "bun run scripts/validate-safety-osha.ts",
```

Append `&& bun run test:safety-osha` to `ship-check` immediately after `test:safety-risk`:

```json
    "ship-check": "bun run typecheck && bun run lint && bun run test:colors && bun run test:health && bun run test:barlabel && bun run test:gating && bun run test:sched-schema && bun run test:sched-history && bun run test:sched-depcycle && bun run test:sched-copilot && bun run test:cpm && bun run test:safety-risk && bun run test:safety-osha && bun run test:app-slop",
```

- [ ] 6. Commit:

```bash
git add utils/safety/osha.ts scripts/validate-safety-osha.ts package.json
git commit -m "$(cat <<'EOF'
Safety Wave A: OSHA-recordable pure classifier + validator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4 — SafetyContext (provider + collections)

Builds the offline-first context that owns all four Wave-A collections. Mirrors the `punchItems` add/update/delete/getForProject shape from `ProjectContext.tsx` but uses the simpler local `saveLocal`/`loadLocal` helpers (as in `PropertyContext.tsx`) plus `supabaseWrite` sync gated on `canSync`.

**Files:**
- Create: `contexts/SafetyContext.tsx`

Steps:

- [ ] 1. Create `contexts/SafetyContext.tsx` with the full implementation:

```typescript
// SafetyContext — Wave A safety collections (JHAs, Toolbox Talks, Incidents,
// Hazard Log). Kept OUT of the already-large ProjectContext: this is a new
// feature surface with its own tertiary_* collections and its own server
// tables. Follows the createContextHook + AsyncStorage pattern (PropertyContext)
// but adds offline-first Supabase sync via supabaseWrite (ProjectContext's
// punchItems shape): optimistic setState → persist local → queue remote write.
//
// Mounted directly inside <ProjectProvider> in app/_layout.tsx, so it is below
// <AuthProvider> and can read the current user for canSync + row user_id.

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { useAuth } from '@/contexts/AuthContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import type {
  JobHazardAnalysis,
  ToolboxTalk,
  SafetyIncident,
  Hazard,
} from '@/types';

const JHAS_KEY = 'tertiary_jhas';
const TOOLBOX_KEY = 'tertiary_toolbox_talks';
const INCIDENTS_KEY = 'tertiary_safety_incidents';
const HAZARDS_KEY = 'tertiary_hazards';

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[Safety] Local save failed for', key, err);
  }
}

export const [SafetyProvider, useSafety] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;

  const [jhas, setJhas] = useState<JobHazardAnalysis[]>([]);
  const [toolboxTalks, setToolboxTalks] = useState<ToolboxTalk[]>([]);
  const [incidents, setIncidents] = useState<SafetyIncident[]>([]);
  const [hazards, setHazards] = useState<Hazard[]>([]);

  // Don't write the empty initial state back over persisted data before the
  // first hydrate completes (same guard PropertyContext uses).
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [j, t, i, h] = await Promise.all([
        loadLocal<JobHazardAnalysis[]>(JHAS_KEY, []),
        loadLocal<ToolboxTalk[]>(TOOLBOX_KEY, []),
        loadLocal<SafetyIncident[]>(INCIDENTS_KEY, []),
        loadLocal<Hazard[]>(HAZARDS_KEY, []),
      ]);
      if (cancelled) return;
      if (Array.isArray(j)) setJhas(j.filter(x => x && typeof x.id === 'string'));
      if (Array.isArray(t)) setToolboxTalks(t.filter(x => x && typeof x.id === 'string'));
      if (Array.isArray(i)) setIncidents(i.filter(x => x && typeof x.id === 'string'));
      if (Array.isArray(h)) setHazards(h.filter(x => x && typeof x.id === 'string'));
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, [userId]);

  // ── JHAs ─────────────────────────────────────────────────────────────
  const addJha = useCallback((jha: JobHazardAnalysis) => {
    const updated = [jha, ...jhas];
    setJhas(updated);
    void saveLocal(JHAS_KEY, updated);
    if (canSync) {
      void supabaseWrite('jhas', 'insert', {
        id: jha.id, user_id: userId, project_id: jha.projectId,
        title: jha.title, trade: jha.trade, task_description: jha.taskDescription,
        date: jha.date, steps: jha.steps, required_ppe: jha.requiredPPE,
        sign_offs: jha.signOffs, plan_sheet_id: jha.planSheetId, pin_x: jha.pinX, pin_y: jha.pinY,
        ai_generated: jha.aiGenerated, status: jha.status, created_by: jha.createdBy,
        created_at: jha.createdAt, updated_at: jha.updatedAt,
      });
    }
  }, [jhas, canSync, userId]);

  const updateJha = useCallback((id: string, updates: Partial<JobHazardAnalysis>) => {
    const now = new Date().toISOString();
    const updated = jhas.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setJhas(updated);
    void saveLocal(JHAS_KEY, updated);
    if (canSync) {
      const j = updated.find(x => x.id === id);
      if (j) void supabaseWrite('jhas', 'update', {
        id, title: j.title, trade: j.trade, task_description: j.taskDescription,
        date: j.date, steps: j.steps, required_ppe: j.requiredPPE, sign_offs: j.signOffs,
        plan_sheet_id: j.planSheetId, pin_x: j.pinX, pin_y: j.pinY,
        ai_generated: j.aiGenerated, status: j.status, updated_at: now,
      });
    }
  }, [jhas, canSync]);

  const deleteJha = useCallback((id: string) => {
    const updated = jhas.filter(x => x.id !== id);
    setJhas(updated);
    void saveLocal(JHAS_KEY, updated);
    if (canSync) void supabaseWrite('jhas', 'delete', { id });
  }, [jhas, canSync]);

  const getJhasForProject = useCallback(
    (projectId: string) => jhas.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [jhas],
  );

  // ── Toolbox Talks ────────────────────────────────────────────────────
  const addToolboxTalk = useCallback((talk: ToolboxTalk) => {
    const updated = [talk, ...toolboxTalks];
    setToolboxTalks(updated);
    void saveLocal(TOOLBOX_KEY, updated);
    if (canSync) {
      void supabaseWrite('toolbox_talks', 'insert', {
        id: talk.id, user_id: userId, project_id: talk.projectId,
        topic: talk.topic, date: talk.date, presenter: talk.presenter, notes: talk.notes,
        attachment_url: talk.attachmentUrl, attendees: talk.attendees,
        ai_topic_source: talk.aiTopicSource, created_by: talk.createdBy,
        created_at: talk.createdAt, updated_at: talk.updatedAt,
      });
    }
  }, [toolboxTalks, canSync, userId]);

  const updateToolboxTalk = useCallback((id: string, updates: Partial<ToolboxTalk>) => {
    const now = new Date().toISOString();
    const updated = toolboxTalks.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setToolboxTalks(updated);
    void saveLocal(TOOLBOX_KEY, updated);
    if (canSync) {
      const t = updated.find(x => x.id === id);
      if (t) void supabaseWrite('toolbox_talks', 'update', {
        id, topic: t.topic, date: t.date, presenter: t.presenter, notes: t.notes,
        attachment_url: t.attachmentUrl, attendees: t.attendees,
        ai_topic_source: t.aiTopicSource, updated_at: now,
      });
    }
  }, [toolboxTalks, canSync]);

  const deleteToolboxTalk = useCallback((id: string) => {
    const updated = toolboxTalks.filter(x => x.id !== id);
    setToolboxTalks(updated);
    void saveLocal(TOOLBOX_KEY, updated);
    if (canSync) void supabaseWrite('toolbox_talks', 'delete', { id });
  }, [toolboxTalks, canSync]);

  const getToolboxTalksForProject = useCallback(
    (projectId: string) => toolboxTalks.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [toolboxTalks],
  );

  // ── Incidents ────────────────────────────────────────────────────────
  const addIncident = useCallback((incident: SafetyIncident) => {
    const updated = [incident, ...incidents];
    setIncidents(updated);
    void saveLocal(INCIDENTS_KEY, updated);
    if (canSync) {
      void supabaseWrite('safety_incidents', 'insert', {
        id: incident.id, user_id: userId, project_id: incident.projectId,
        type: incident.type, severity: incident.severity, occurred_at: incident.occurredAt,
        description: incident.description, location: incident.location,
        plan_sheet_id: incident.planSheetId, pin_x: incident.pinX, pin_y: incident.pinY,
        people_involved: incident.peopleInvolved, photo_urls: incident.photoUrls,
        corrective_actions: incident.correctiveActions, treatment: incident.treatment,
        days_away: incident.daysAway, restricted_duty: incident.restrictedDuty,
        lost_consciousness: incident.lostConsciousness, fatality: incident.fatality,
        osha_recordable: incident.oshaRecordable, status: incident.status,
        reported_by: incident.reportedBy, created_by: incident.createdBy,
        created_at: incident.createdAt, updated_at: incident.updatedAt,
      });
    }
  }, [incidents, canSync, userId]);

  const updateIncident = useCallback((id: string, updates: Partial<SafetyIncident>) => {
    const now = new Date().toISOString();
    const updated = incidents.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setIncidents(updated);
    void saveLocal(INCIDENTS_KEY, updated);
    if (canSync) {
      const i = updated.find(x => x.id === id);
      if (i) void supabaseWrite('safety_incidents', 'update', {
        id, type: i.type, severity: i.severity, occurred_at: i.occurredAt,
        description: i.description, location: i.location,
        plan_sheet_id: i.planSheetId, pin_x: i.pinX, pin_y: i.pinY,
        people_involved: i.peopleInvolved, photo_urls: i.photoUrls,
        corrective_actions: i.correctiveActions, treatment: i.treatment,
        days_away: i.daysAway, restricted_duty: i.restrictedDuty,
        lost_consciousness: i.lostConsciousness, fatality: i.fatality,
        osha_recordable: i.oshaRecordable, status: i.status, updated_at: now,
      });
    }
  }, [incidents, canSync]);

  const deleteIncident = useCallback((id: string) => {
    const updated = incidents.filter(x => x.id !== id);
    setIncidents(updated);
    void saveLocal(INCIDENTS_KEY, updated);
    if (canSync) void supabaseWrite('safety_incidents', 'delete', { id });
  }, [incidents, canSync]);

  const getIncidentsForProject = useCallback(
    (projectId: string) => incidents.filter(x => x.projectId === projectId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [incidents],
  );

  // ── Hazards ──────────────────────────────────────────────────────────
  const addHazard = useCallback((hazard: Hazard) => {
    const updated = [hazard, ...hazards];
    setHazards(updated);
    void saveLocal(HAZARDS_KEY, updated);
    if (canSync) {
      void supabaseWrite('hazards', 'insert', {
        id: hazard.id, user_id: userId, project_id: hazard.projectId,
        description: hazard.description, location: hazard.location, photo_url: hazard.photoUrl,
        severity: hazard.severity, likelihood: hazard.likelihood, risk_score: hazard.riskScore,
        plan_sheet_id: hazard.planSheetId, pin_x: hazard.pinX, pin_y: hazard.pinY,
        assigned_to: hazard.assignedTo, due_date: hazard.dueDate,
        corrective_action: hazard.correctiveAction, status: hazard.status,
        source_inspection_id: hazard.sourceInspectionId, created_by: hazard.createdBy,
        created_at: hazard.createdAt, updated_at: hazard.updatedAt,
      });
    }
  }, [hazards, canSync, userId]);

  const updateHazard = useCallback((id: string, updates: Partial<Hazard>) => {
    const now = new Date().toISOString();
    const updated = hazards.map(x => x.id === id ? { ...x, ...updates, updatedAt: now } : x);
    setHazards(updated);
    void saveLocal(HAZARDS_KEY, updated);
    if (canSync) {
      const hz = updated.find(x => x.id === id);
      if (hz) void supabaseWrite('hazards', 'update', {
        id, description: hz.description, location: hz.location, photo_url: hz.photoUrl,
        severity: hz.severity, likelihood: hz.likelihood, risk_score: hz.riskScore,
        plan_sheet_id: hz.planSheetId, pin_x: hz.pinX, pin_y: hz.pinY,
        assigned_to: hz.assignedTo, due_date: hz.dueDate,
        corrective_action: hz.correctiveAction, status: hz.status,
        source_inspection_id: hz.sourceInspectionId, updated_at: now,
      });
    }
  }, [hazards, canSync]);

  const deleteHazard = useCallback((id: string) => {
    const updated = hazards.filter(x => x.id !== id);
    setHazards(updated);
    void saveLocal(HAZARDS_KEY, updated);
    if (canSync) void supabaseWrite('hazards', 'delete', { id });
  }, [hazards, canSync]);

  const getHazardsForProject = useCallback(
    (projectId: string) => hazards.filter(x => x.projectId === projectId)
      .sort((a, b) => b.riskScore - a.riskScore),
    [hazards],
  );

  return {
    jhas, addJha, updateJha, deleteJha, getJhasForProject,
    toolboxTalks, addToolboxTalk, updateToolboxTalk, deleteToolboxTalk, getToolboxTalksForProject,
    incidents, addIncident, updateIncident, deleteIncident, getIncidentsForProject,
    hazards, addHazard, updateHazard, deleteHazard, getHazardsForProject,
  };
});
```

- [ ] 2. Type-check (context compiles even though not yet mounted):

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] 3. Commit:

```bash
git add contexts/SafetyContext.tsx
git commit -m "$(cat <<'EOF'
Safety Wave A: SafetyContext with offline-first collections

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5 — Migration + schema.sql

Additive tables for the four collections, RLS-scoped to the owning user (mirrors `punch_items`). Timestamp is AFTER `20260707120000`.

**Files:**
- Create: `supabase/migrations/20260708120000_safety_wave_a.sql`
- Modify: `supabase/schema.sql`

Steps:

- [ ] 1. Create `supabase/migrations/20260708120000_safety_wave_a.sql`:

```sql
-- 20260708120000_safety_wave_a.sql
-- Safety Management — Wave A tables (JHAs, Toolbox Talks, Incidents, Hazards).
--
-- All additive. RLS scoped to the owning user (auth.uid() = user_id), mirroring
-- punch_items. JSONB columns hold the nested arrays the client owns as a unit
-- (steps, sign_offs, attendees, people_involved, corrective_actions). Apply to
-- PROD before the OTA that writes these tables — same PGRST204 gate discipline
-- as 20260707120000_punch_location.sql (an OTA that writes a column the live
-- schema lacks fails silently in supabaseWrite).

-- ── JHAs ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.jhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trade TEXT DEFAULT '',
  task_description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  steps JSONB DEFAULT '[]'::JSONB,
  required_ppe JSONB DEFAULT '[]'::JSONB,
  sign_offs JSONB DEFAULT '[]'::JSONB,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  ai_generated BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jhas_project ON public.jhas(project_id);
ALTER TABLE public.jhas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jhas_select_own" ON public.jhas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jhas_insert_own" ON public.jhas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jhas_update_own" ON public.jhas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jhas_delete_own" ON public.jhas FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER jhas_updated_at BEFORE UPDATE ON public.jhas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Toolbox Talks ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.toolbox_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  date TEXT DEFAULT '',
  presenter TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  attachment_url TEXT,
  attendees JSONB DEFAULT '[]'::JSONB,
  ai_topic_source TEXT CHECK (ai_topic_source IN ('incident', 'hazard', 'weather', 'manual')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_toolbox_talks_project ON public.toolbox_talks(project_id);
ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "toolbox_select_own" ON public.toolbox_talks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "toolbox_insert_own" ON public.toolbox_talks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "toolbox_update_own" ON public.toolbox_talks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "toolbox_delete_own" ON public.toolbox_talks FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER toolbox_talks_updated_at BEFORE UPDATE ON public.toolbox_talks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Safety Incidents ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('injury', 'near_miss', 'property', 'environmental')),
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  occurred_at TEXT DEFAULT '',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  people_involved JSONB DEFAULT '[]'::JSONB,
  photo_urls JSONB DEFAULT '[]'::JSONB,
  corrective_actions JSONB DEFAULT '[]'::JSONB,
  treatment TEXT DEFAULT 'none' CHECK (treatment IN ('none', 'first_aid', 'medical_beyond_first_aid')),
  days_away INTEGER DEFAULT 0,
  restricted_duty BOOLEAN DEFAULT FALSE,
  lost_consciousness BOOLEAN DEFAULT FALSE,
  fatality BOOLEAN DEFAULT FALSE,
  osha_recordable BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'closed')),
  reported_by TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_project ON public.safety_incidents(project_id);
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidents_select_own" ON public.safety_incidents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "incidents_insert_own" ON public.safety_incidents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "incidents_update_own" ON public.safety_incidents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "incidents_delete_own" ON public.safety_incidents FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER safety_incidents_updated_at BEFORE UPDATE ON public.safety_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Hazards ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.hazards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  location TEXT DEFAULT '',
  photo_url TEXT,
  severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  likelihood INTEGER DEFAULT 1 CHECK (likelihood BETWEEN 1 AND 5),
  risk_score INTEGER DEFAULT 1,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  assigned_to TEXT,
  due_date TEXT,
  corrective_action TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'closed')),
  source_inspection_id TEXT,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hazards_project ON public.hazards(project_id);
ALTER TABLE public.hazards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hazards_select_own" ON public.hazards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hazards_insert_own" ON public.hazards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hazards_update_own" ON public.hazards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "hazards_delete_own" ON public.hazards FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER hazards_updated_at BEFORE UPDATE ON public.hazards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] 2. Mirror the same four `CREATE TABLE` + index + `ENABLE ROW LEVEL SECURITY` + policy + trigger blocks into `supabase/schema.sql`. Append a `SAFETY MANAGEMENT — Wave A` section AFTER the `punch_items` block (after schema.sql line 224, the punch_items trigger) using the identical DDL from step 1 but WITHOUT the `IF NOT EXISTS` on the policies (match the existing schema.sql style — `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX` without `IF NOT EXISTS`, `CREATE POLICY`, `CREATE TRIGGER`). Concretely, insert this block after the punch_items trigger:

```sql

-- ============================================
-- SAFETY MANAGEMENT — Wave A
-- ============================================
CREATE TABLE IF NOT EXISTS public.jhas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  trade TEXT DEFAULT '',
  task_description TEXT DEFAULT '',
  date TEXT DEFAULT '',
  steps JSONB DEFAULT '[]'::JSONB,
  required_ppe JSONB DEFAULT '[]'::JSONB,
  sign_offs JSONB DEFAULT '[]'::JSONB,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  ai_generated BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'archived')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_jhas_project ON public.jhas(project_id);
CREATE TRIGGER jhas_updated_at BEFORE UPDATE ON public.jhas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.toolbox_talks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  date TEXT DEFAULT '',
  presenter TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  attachment_url TEXT,
  attendees JSONB DEFAULT '[]'::JSONB,
  ai_topic_source TEXT CHECK (ai_topic_source IN ('incident', 'hazard', 'weather', 'manual')),
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_toolbox_talks_project ON public.toolbox_talks(project_id);
CREATE TRIGGER toolbox_talks_updated_at BEFORE UPDATE ON public.toolbox_talks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.safety_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('injury', 'near_miss', 'property', 'environmental')),
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  occurred_at TEXT DEFAULT '',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  people_involved JSONB DEFAULT '[]'::JSONB,
  photo_urls JSONB DEFAULT '[]'::JSONB,
  corrective_actions JSONB DEFAULT '[]'::JSONB,
  treatment TEXT DEFAULT 'none' CHECK (treatment IN ('none', 'first_aid', 'medical_beyond_first_aid')),
  days_away INTEGER DEFAULT 0,
  restricted_duty BOOLEAN DEFAULT FALSE,
  lost_consciousness BOOLEAN DEFAULT FALSE,
  fatality BOOLEAN DEFAULT FALSE,
  osha_recordable BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'investigating', 'closed')),
  reported_by TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_safety_incidents_project ON public.safety_incidents(project_id);
CREATE TRIGGER safety_incidents_updated_at BEFORE UPDATE ON public.safety_incidents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.hazards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  location TEXT DEFAULT '',
  photo_url TEXT,
  severity INTEGER DEFAULT 1 CHECK (severity BETWEEN 1 AND 5),
  likelihood INTEGER DEFAULT 1 CHECK (likelihood BETWEEN 1 AND 5),
  risk_score INTEGER DEFAULT 1,
  plan_sheet_id TEXT,
  pin_x DOUBLE PRECISION,
  pin_y DOUBLE PRECISION,
  assigned_to TEXT,
  due_date TEXT,
  corrective_action TEXT,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'mitigated', 'closed')),
  source_inspection_id TEXT,
  created_by TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_hazards_project ON public.hazards(project_id);
CREATE TRIGGER hazards_updated_at BEFORE UPDATE ON public.hazards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
```

- [ ] 3. In the `ENABLE ROW LEVEL SECURITY` block of `schema.sql` (the run of `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` around lines 578-600), add after `punch_items`:

```sql
ALTER TABLE public.jhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hazards ENABLE ROW LEVEL SECURITY;
```

- [ ] 4. In the `CREATE POLICY` block of `schema.sql` (after the `punch_*` policies around line 641), add the 16 safety policies:

```sql
-- Safety Wave A policies
CREATE POLICY "jhas_select_own" ON public.jhas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "jhas_insert_own" ON public.jhas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "jhas_update_own" ON public.jhas FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "jhas_delete_own" ON public.jhas FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "toolbox_select_own" ON public.toolbox_talks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "toolbox_insert_own" ON public.toolbox_talks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "toolbox_update_own" ON public.toolbox_talks FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "toolbox_delete_own" ON public.toolbox_talks FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "incidents_select_own" ON public.safety_incidents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "incidents_insert_own" ON public.safety_incidents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "incidents_update_own" ON public.safety_incidents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "incidents_delete_own" ON public.safety_incidents FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "hazards_select_own" ON public.hazards FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "hazards_insert_own" ON public.hazards FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hazards_update_own" ON public.hazards FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "hazards_delete_own" ON public.hazards FOR DELETE USING (auth.uid() = user_id);
```

> **Prod-apply note (owner-gated, do NOT run from the sandbox):** Apply `20260708120000_safety_wave_a.sql` to prod (project `nteoqhcswappxxjlpvap`) via Supabase MCP `apply_migration` + verify with `execute_sql`, BEFORE publishing the OTA that ships the Safety screens. NEVER `supabase db push` (divergent history). Same PGRST204 gate discipline as `punch_location`: if the OTA writes a column the live schema lacks, `supabaseWrite` fails silently.

- [ ] 5. Commit:

```bash
git add supabase/migrations/20260708120000_safety_wave_a.sql supabase/schema.sql
git commit -m "$(cat <<'EOF'
Safety Wave A: additive migration + schema.sql (jhas, toolbox_talks, safety_incidents, hazards)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6 — Tier gate + server monthly cap

Register the client feature key and add the server-side `safety_ai` monthly cap the two text edge functions meter against.

**Files:**
- Modify: `hooks/useTierAccess.ts`
- Modify: `supabase/functions/_shared/auth.ts`

Steps:

- [ ] 1. In `hooks/useTierAccess.ts`, add `'safety_management'` to the `FeatureKey` union. In the `// Business-only features` group (after `'full_budget_dashboard'`, before `// All tiers (with limits)`), insert:

```typescript
  | 'full_budget_dashboard'
  | 'safety_management'
```

- [ ] 2. In the same file, add the requirement to `REQUIRED_TIER` after `full_budget_dashboard: 'business',`:

```typescript
  full_budget_dashboard: 'business',
  safety_management: 'business',
```

- [ ] 3. In `supabase/functions/_shared/auth.ts`, add a `safety_ai` key to EVERY tier in `MONTHLY_CAPS`. `safety_ai` meters the two TEXT safety functions (`safety-generate-jha`, `safety-draft-incident`). Because both are `requireTier(['business'])`, free/pro can never reach the increment, so their caps are 0; business/enterprise get real budgets. Add the line to each tier block:

```typescript
  free: {
    analyze_drawings: 0,
    analyze_photos: 0,
    convert_pdf: 0,
    takeoff_pages: 0,
    ai_text: 150,
    plan_code_review: 0,
    safety_ai: 0,
  },
  pro: {
    analyze_drawings: 15,
    analyze_photos: 50,
    convert_pdf: 50,
    takeoff_pages: 30,
    ai_text: 900,
    plan_code_review: 10,
    safety_ai: 0,
  },
  business: {
    analyze_drawings: 50,
    analyze_photos: 150,
    convert_pdf: 150,
    takeoff_pages: 100,
    ai_text: 2400,
    plan_code_review: 30,
    safety_ai: 900,
  },
  enterprise: {
    analyze_drawings: 100,
    analyze_photos: 200,
    convert_pdf: 300,
    takeoff_pages: 300,
    ai_text: 4500,
    plan_code_review: 60,
    safety_ai: 1800,
  },
```

> Metering summary (used by Task 8):
> - `safety-generate-jha` → `aiUsageIncrement(userId, 'safety_ai')` vs `MONTHLY_CAPS[tier].safety_ai` (text).
> - `safety-draft-incident` → `aiUsageIncrement(userId, 'safety_ai')` vs `MONTHLY_CAPS[tier].safety_ai` (text; optional photos ride the same text meter to keep one budget).
> - `safety-detect-hazards` → `aiUsageIncrement(userId, 'analyze_photos')` vs `MONTHLY_CAPS[tier].analyze_photos` (reuses the existing vision cap).

- [ ] 4. Type-check:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] 5. Commit:

```bash
git add hooks/useTierAccess.ts supabase/functions/_shared/auth.ts
git commit -m "$(cat <<'EOF'
Safety Wave A: safety_management tier gate + safety_ai monthly cap

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7 — Safety hub screen + nav registration

The project-scoped hub with four tiles, plus mounting the provider, registering the screens, and adding the sidebar entry. After this task the module is reachable (screens themselves land in Task 8-11).

**Files:**
- Create: `app/safety.tsx`
- Modify: `app/_layout.tsx`
- Modify: `components/DesktopSidebar.tsx`

Steps:

- [ ] 1. Create `app/safety.tsx` (hub). Mirror `app/punch-list.tsx`'s Paywall gate + EmptyState + theming. The hub reads `projectId`, shows a Business paywall when `!canAccess('safety_management')`, an EmptyState when no project is selected, else a 2-column tile grid routing to the four feature screens.

```tsx
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { HardHat, Megaphone, ShieldAlert, TriangleAlert, ChevronRight } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function SafetyScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  if (!canAccess('safety_management')) {
    return (
      <Paywall
        visible={true}
        feature="Safety Management"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <SafetyHubInner />;
}

function SafetyHubInner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { getProject } = useProjects();
  const { getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject } = useSafety();

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  const pid = projectId ?? '';

  const tiles = useMemo(() => ([
    { key: 'jha', label: 'JHAs', icon: HardHat, count: getJhasForProject(pid).length, route: '/safety-jha' as const },
    { key: 'toolbox', label: 'Toolbox Talks', icon: Megaphone, count: getToolboxTalksForProject(pid).length, route: '/safety-toolbox' as const },
    { key: 'incidents', label: 'Incidents', icon: ShieldAlert, count: getIncidentsForProject(pid).length, route: '/safety-incidents' as const },
    { key: 'hazards', label: 'Hazard Log', icon: TriangleAlert, count: getHazardsForProject(pid).length, route: '/safety-hazards' as const },
  ]), [pid, getJhasForProject, getToolboxTalksForProject, getIncidentsForProject, getHazardsForProject]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: t.bg }]}>
        <Stack.Screen options={{ title: 'Safety' }} />
        <EmptyState
          icon={<HardHat size={36} color={t.accent} strokeWidth={1.75} />}
          title="Safety is tied to a project"
          message="Open a project to run JHAs, toolbox talks, incident reports, and the hazard log for that job."
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Safety inside the project tile grid.',
            'Pick a tool below to start capturing.',
          ]}
          actionLabel="Open Projects"
          onAction={() => router.push('/(tabs)/(home)' as never)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: t.bg }]}>
      <Stack.Screen options={{ title: `Safety — ${project.name}` }} />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 40, gap: 12 }}>
        <View style={styles.grid}>
          {tiles.map(tile => (
            <TouchableOpacity
              key={tile.key}
              style={styles.tile}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: tile.route, params: { projectId: pid } })}
            >
              <View style={styles.tileIcon}><tile.icon size={22} color={t.accent} strokeWidth={1.75} /></View>
              <Text style={styles.tileLabel}>{tile.label}</Text>
              <View style={styles.tileFooter}>
                <Text style={styles.tileCount}>{tile.count}</Text>
                <ChevronRight size={16} color={t.textMuted} strokeWidth={1.75} />
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: {
    width: '47%', flexGrow: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, padding: 16, gap: 12, minHeight: 120, justifyContent: 'space-between',
  },
  tileIcon: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.accent + '14',
  },
  tileLabel: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  tileFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileCount: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: t.accent },
});
```

- [ ] 2. Mount the provider in `app/_layout.tsx`. Add the import near the other context imports (after the `ProjectProvider` import at line 11):

```typescript
import { SafetyProvider } from "@/contexts/SafetyContext";
```

Then wrap `<ProjectProvider>`'s children: change the block so `<SafetyProvider>` sits directly inside `<ProjectProvider>` and above `<PropertyProvider>`, and close it after `</PropertyProvider>`:

```tsx
                <ProjectProvider>
                  <SafetyProvider>
                  <PropertyProvider>
                  <MaterialCartProvider>
                    <BidsProvider>
                      <CompaniesProvider>
                        <HireProvider>
                          <NotificationProvider>
                            <SearchProvider>
                            {/* …existing children… */}
                            </SearchProvider>
                          </NotificationProvider>
                        </HireProvider>
                      </CompaniesProvider>
                    </BidsProvider>
                  </MaterialCartProvider>
                  </PropertyProvider>
                  </SafetyProvider>
                </ProjectProvider>
```

- [ ] 3. Register the five screens in `app/_layout.tsx`. Alongside the other `<Stack.Screen>` declarations (e.g. after the `punch-list` screen block near line 591), add:

```tsx
      <Stack.Screen name="safety" options={{ title: 'Safety' }} />
      <Stack.Screen name="safety-jha" options={{ title: 'JHAs' }} />
      <Stack.Screen name="safety-toolbox" options={{ title: 'Toolbox Talks' }} />
      <Stack.Screen name="safety-incidents" options={{ title: 'Incidents' }} />
      <Stack.Screen name="safety-hazards" options={{ title: 'Hazard Log' }} />
```

- [ ] 4. Add the sidebar NavItem in `components/DesktopSidebar.tsx`. `HardHat` is already imported (used by the `subs` item). In the `NAV_ITEMS` array, in the `FIELD OPS` section (after the `punch-list` entry at line 88), add:

```typescript
  { key: 'safety',            label: 'Safety',           icon: HardHat,         route: '/safety',                           section: 'FIELD OPS', requires: 'safety_management' },
```

- [ ] 5. Type-check (safety-jha / safety-toolbox / safety-incidents / safety-hazards routes are declared in the Stack but the screen files don't exist yet — Expo Router typed-routes generation runs at dev/build time, not tsc, so `npx tsc --noEmit` passes; the `router.push` calls use `pathname` string literals that resolve once the files land in Tasks 9-11 and 8):

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] 6. Commit:

```bash
git add app/safety.tsx app/_layout.tsx components/DesktopSidebar.tsx
git commit -m "$(cat <<'EOF'
Safety Wave A: hub screen + provider mount + nav registration

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8 — Edge functions (3 AI functions)

All three Deno functions mirror `supabase/functions/analyze-photos/index.ts`: shared CORS + `jsonResponse` helpers, `requireTier(['business'])`, monthly metering, fail-closed. The vision function SSRF-guards every URL via `validateFetchableUrl` before fetch. They ship together (one commit) since they share the same shape and none has a validator.

**Files:**
- Create: `supabase/functions/safety-generate-jha/index.ts`
- Create: `supabase/functions/safety-detect-hazards/index.ts`
- Create: `supabase/functions/safety-draft-incident/index.ts`

Steps:

- [ ] 1. Create `supabase/functions/safety-generate-jha/index.ts`:

```typescript
// safety-generate-jha
//
// Text → Job Hazard Analysis. Input { trade, taskDescription, projectContext? }
// returns { steps: [{ step, hazards[], controls[] }], requiredPPE[] } for the
// user to REVIEW and edit before saving (client sets aiGenerated: true). No
// images — pure text prompt to Gemini. Business-tier gated; metered against the
// safety_ai monthly cap (text). Fail-closed: on any error the client keeps the
// manual JHA form.
//
// Secrets required: GEMINI_API_KEY (Google AI Studio).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface GenerateJhaRequest {
  trade?: string;
  taskDescription?: string;
  projectContext?: string;
}

interface JhaStepOut {
  step: string;
  hazards: string[];
  controls: string[];
}

const JHA_PROMPT = `You are a construction safety professional (CHST) writing a Job Hazard Analysis (JHA) for a residential/commercial GC crew. Break the task into its sequential work steps; for each step list the specific hazards a worker faces and the controls that eliminate or mitigate each hazard (prefer elimination > engineering controls > administrative controls > PPE). Then list the PPE required for the whole task.

Return a single JSON object:
{
  "steps": [
    { "step": "short imperative work step (<=100 chars)", "hazards": ["specific hazard", ...], "controls": ["specific control", ...] }
  ],
  "requiredPPE": ["Hard hat", "Safety glasses", ...]
}

Rules:
- 4-10 steps. Each step has 1-4 hazards and 1-4 controls. Be specific and site-real ("Silica dust from cutting masonry" not "dust").
- requiredPPE: 3-8 concrete items.
- Return JSON only — no preamble.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'safety_generate_jha');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: GenerateJhaRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const trade = String(body.trade ?? '').slice(0, 120);
  const taskDescription = String(body.taskDescription ?? '').slice(0, 2000);
  if (!taskDescription.trim()) return jsonResponse({ success: false, error: 'taskDescription is required' }, 400);

  const used = await aiUsageIncrement(auth.userId, 'safety_ai');
  const cap = MONTHLY_CAPS[auth.tier].safety_ai;
  if (used > cap) {
    return jsonResponse({
      success: false,
      error: `Monthly safety-AI limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }

  const ctxLine = [
    trade ? `Trade: ${trade}` : null,
    body.projectContext ? `Project context: ${String(body.projectContext).slice(0, 800)}` : null,
    `Task: ${taskDescription}`,
  ].filter(Boolean).join('\n');
  const prompt = `${ctxLine}\n\n${JHA_PROMPT}`;

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 2000 },
      }),
    });
  } catch (e) {
    return jsonResponse({ success: false, error: `Gemini network error: ${(e as Error).message}` }, 502);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    return jsonResponse({ success: false, error: `Gemini ${geminiResp.status}: ${text.slice(0, 200)}` }, 502);
  }

  const j = await geminiResp.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON', raw }, 500); }

  const o = (parsed ?? {}) as Record<string, unknown>;
  const rawSteps = Array.isArray(o.steps) ? o.steps : [];
  const steps: JhaStepOut[] = rawSteps.map((s): JhaStepOut => {
    const r = (s ?? {}) as Record<string, unknown>;
    return {
      step: String(r.step ?? '').slice(0, 200),
      hazards: Array.isArray(r.hazards) ? r.hazards.map((h) => String(h).slice(0, 200)) : [],
      controls: Array.isArray(r.controls) ? r.controls.map((c) => String(c).slice(0, 200)) : [],
    };
  }).filter((s) => s.step.length > 0);
  const requiredPPE = Array.isArray(o.requiredPPE) ? o.requiredPPE.map((p) => String(p).slice(0, 100)).filter(Boolean) : [];

  return jsonResponse({ success: true, data: { steps, requiredPPE } });
});
```

- [ ] 2. Create `supabase/functions/safety-detect-hazards/index.ts` (vision — SSRF-guarded):

```typescript
// safety-detect-hazards
//
// Site photo(s) → candidate hazards { description, severity, likelihood }[] to
// prefill the Hazard Log. Reuses the analyze-photos vision pattern. Business-
// tier gated; metered against the analyze_photos monthly (vision) cap. Every
// photo URL is validated through validateFetchableUrl BEFORE any fetch (SSRF
// guard). Fail-closed: on error the user keeps the manual hazard form.
//
// Request: { photoUrls: string[] } OR { photos: [{ base64, mimeType? }] }.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl } from "../_shared/urlGuard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface DetectHazardsRequest {
  photoUrls?: string[];
  photos?: { base64: string; mimeType?: string }[];
}

interface HazardOut {
  description: string;
  severity: number;
  likelihood: number;
}

const HAZARD_PROMPT = `You are a construction safety inspector reviewing job-site photos. Identify visible safety hazards (fall exposure, missing guardrails, unsafe ladders, exposed rebar, housekeeping/trip hazards, electrical, missing PPE, unshored trenches, fire/flammables, etc.).

Return a JSON array; each item:
  - description: specific hazard (<=140 chars). "Unguarded floor opening near stair core" not "fall hazard".
  - severity: integer 1-5 (1 minor first-aid, 5 fatal/permanent).
  - likelihood: integer 1-5 (1 rare, 5 almost certain given current conditions).

Only include real, visible hazards. Return an empty array if the photos show none. Return JSON only — no preamble.`;

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl);
  if (!r.ok) throw new Error(`Fetch image failed: ${r.status}`);
  const mimeType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = await r.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'safety_detect_hazards');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: DetectHazardsRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const used = await aiUsageIncrement(auth.userId, 'analyze_photos');
  const cap = MONTHLY_CAPS[auth.tier].analyze_photos;
  if (used > cap) {
    return jsonResponse({
      success: false,
      error: `Monthly photo-analysis limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }

  const usingInline = Array.isArray(body.photos) && body.photos.length > 0;
  const usingUrls = Array.isArray(body.photoUrls) && body.photoUrls.length > 0;
  if (!usingInline && !usingUrls) {
    return jsonResponse({ success: false, error: 'Either photos[] (inline base64) or photoUrls[] required' }, 400);
  }
  const inputCount = usingInline ? body.photos!.length : body.photoUrls!.length;
  if (inputCount > 8) return jsonResponse({ success: false, error: 'Max 8 photos per call' }, 400);

  let goodPhotos: { data: string; mimeType: string }[] = [];
  if (usingInline) {
    const MAX_PER = 6 * 1024 * 1024;
    for (let i = 0; i < body.photos!.length; i++) {
      const p = body.photos![i];
      if (!p || typeof p.base64 !== 'string' || p.base64.length === 0) {
        return jsonResponse({ success: false, error: `Photo ${i} missing base64 data` }, 400);
      }
      if (p.base64.length > MAX_PER) {
        return jsonResponse({ success: false, error: `Photo ${i} too large. Use ~1200×1600 px.` }, 413);
      }
    }
    goodPhotos = body.photos!.map((p) => ({ data: p.base64, mimeType: p.mimeType || 'image/jpeg' }));
  } else {
    // SSRF guard: validate EVERY URL before any fetch; generic 400 on rejection.
    for (const u of body.photoUrls!) {
      try { validateFetchableUrl(u); }
      catch { return jsonResponse({ success: false, error: 'One or more photo URLs are not allowed.' }, 400); }
    }
    const fetched = await Promise.allSettled(body.photoUrls!.map(fetchAsBase64));
    goodPhotos = fetched
      .map((r) => r.status === 'fulfilled' ? r.value : null)
      .filter((x): x is { data: string; mimeType: string } => x !== null);
  }
  if (goodPhotos.length === 0) return jsonResponse({ success: false, error: 'Could not load any of the supplied photos' }, 400);

  const parts: Record<string, unknown>[] = [{ text: HAZARD_PROMPT }];
  for (const p of goodPhotos) parts.push({ inline_data: { mime_type: p.mimeType, data: p.data } });

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1500 },
      }),
    });
  } catch (e) {
    return jsonResponse({ success: false, error: `Gemini network error: ${(e as Error).message}` }, 502);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    return jsonResponse({ success: false, error: `Gemini ${geminiResp.status}: ${text.slice(0, 200)}` }, 502);
  }

  const j = await geminiResp.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON', raw }, 500); }
  if (!Array.isArray(parsed)) return jsonResponse({ success: false, error: 'Expected array of hazards' }, 500);

  const clampScale = (v: unknown) => {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(5, n));
  };
  const hazards: HazardOut[] = (parsed as unknown[])
    .map((x): HazardOut => {
      const o = (x ?? {}) as Record<string, unknown>;
      return {
        description: String(o.description ?? '').slice(0, 200),
        severity: clampScale(o.severity),
        likelihood: clampScale(o.likelihood),
      };
    })
    .filter((h) => h.description.length > 0);

  return jsonResponse({ success: true, data: { hazards } });
});
```

- [ ] 3. Create `supabase/functions/safety-draft-incident/index.ts`:

```typescript
// safety-draft-incident
//
// Voice transcript / notes (+ optional site photos) → structured SafetyIncident
// draft { type, severity, description, location, correctiveActions[] } for the
// user to confirm before saving. Business-tier gated; metered against the
// safety_ai monthly cap (text). Optional photos are SSRF-validated + fed to the
// model on the same text meter. Fail-closed: on error the user keeps the manual
// incident form.
//
// Request: { voiceTranscript?, notes?, photoUrls?: string[] }.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier, aiUsageIncrement, MONTHLY_CAPS } from "../_shared/auth.ts";
import { validateFetchableUrl } from "../_shared/urlGuard.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface DraftIncidentRequest {
  voiceTranscript?: string;
  notes?: string;
  photoUrls?: string[];
}

interface CorrectiveActionOut { action: string; owner: string; }
interface IncidentDraftOut {
  type: 'injury' | 'near_miss' | 'property' | 'environmental';
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  location: string;
  correctiveActions: CorrectiveActionOut[];
}

const INCIDENT_PROMPT = `You are a construction safety manager turning a field report (spoken/typed notes, plus any photos) into a structured incident record. Classify and summarize.

Return a single JSON object:
{
  "type": "injury" | "near_miss" | "property" | "environmental",
  "severity": "low" | "medium" | "high" | "critical",
  "description": "objective factual summary of what happened (<=600 chars, no blame language)",
  "location": "where on site (<=100 chars, empty if unknown)",
  "correctiveActions": [ { "action": "specific corrective/preventive action (<=160 chars)", "owner": "role responsible, e.g. Site Super (empty if unknown)" } ]
}

Rules:
- Choose type by whether a person was hurt (injury), almost hurt (near_miss), only property was damaged (property), or a spill/environmental release occurred (environmental).
- 1-4 corrective actions. Return JSON only — no preamble.`;

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string }> {
  const safeUrl = validateFetchableUrl(url);
  const r = await fetch(safeUrl);
  if (!r.ok) throw new Error(`Fetch image failed: ${r.status}`);
  const mimeType = r.headers.get('content-type') ?? 'image/jpeg';
  const buf = await r.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return { data: btoa(binary), mimeType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'POST only' }, 405);
  if (!GEMINI_API_KEY) return jsonResponse({ success: false, error: 'GEMINI_API_KEY not configured' }, 500);

  const auth = await requireTier(req, ['business'], 'safety_draft_incident');
  if (!auth.ok) return jsonResponse(auth.body, auth.status);

  let body: DraftIncidentRequest;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const transcript = String(body.voiceTranscript ?? '').slice(0, 4000);
  const notes = String(body.notes ?? '').slice(0, 2000);
  const hasPhotos = Array.isArray(body.photoUrls) && body.photoUrls.length > 0;
  if (!transcript.trim() && !notes.trim() && !hasPhotos) {
    return jsonResponse({ success: false, error: 'Provide voiceTranscript, notes, or photoUrls' }, 400);
  }

  const used = await aiUsageIncrement(auth.userId, 'safety_ai');
  const cap = MONTHLY_CAPS[auth.tier].safety_ai;
  if (used > cap) {
    return jsonResponse({
      success: false,
      error: `Monthly safety-AI limit reached (${cap} on ${auth.tier}). Resets on the 1st.`,
      code: 'monthly_cap_reached', used, cap,
    }, 429);
  }

  const ctxLine = [
    transcript ? `Spoken report: ${transcript}` : null,
    notes ? `Notes: ${notes}` : null,
  ].filter(Boolean).join('\n');
  const parts: Record<string, unknown>[] = [{ text: `${ctxLine}\n\n${INCIDENT_PROMPT}` }];

  if (hasPhotos) {
    const urls = body.photoUrls!.slice(0, 6);
    for (const u of urls) {
      try { validateFetchableUrl(u); }
      catch { return jsonResponse({ success: false, error: 'One or more photo URLs are not allowed.' }, 400); }
    }
    const fetched = await Promise.allSettled(urls.map(fetchAsBase64));
    for (const r of fetched) {
      if (r.status === 'fulfilled') parts.push({ inline_data: { mime_type: r.value.mimeType, data: r.value.data } });
    }
  }

  let geminiResp: Response;
  try {
    geminiResp = await fetch(`${ENDPOINT}?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 1200 },
      }),
    });
  } catch (e) {
    return jsonResponse({ success: false, error: `Gemini network error: ${(e as Error).message}` }, 502);
  }
  if (!geminiResp.ok) {
    const text = await geminiResp.text().catch(() => '');
    return jsonResponse({ success: false, error: `Gemini ${geminiResp.status}: ${text.slice(0, 200)}` }, 502);
  }

  const j = await geminiResp.json();
  const raw = j?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return jsonResponse({ success: false, error: 'Gemini returned non-JSON', raw }, 500); }

  const o = (parsed ?? {}) as Record<string, unknown>;
  const VALID_TYPES = ['injury', 'near_miss', 'property', 'environmental'];
  const VALID_SEV = ['low', 'medium', 'high', 'critical'];
  const rawActions = Array.isArray(o.correctiveActions) ? o.correctiveActions : [];
  const draft: IncidentDraftOut = {
    type: (VALID_TYPES.includes(String(o.type)) ? o.type : 'near_miss') as IncidentDraftOut['type'],
    severity: (VALID_SEV.includes(String(o.severity)) ? o.severity : 'low') as IncidentDraftOut['severity'],
    description: String(o.description ?? '').slice(0, 800),
    location: String(o.location ?? '').slice(0, 120),
    correctiveActions: rawActions.map((a): CorrectiveActionOut => {
      const r = (a ?? {}) as Record<string, unknown>;
      return { action: String(r.action ?? '').slice(0, 200), owner: String(r.owner ?? '').slice(0, 120) };
    }).filter((a) => a.action.length > 0),
  };

  return jsonResponse({ success: true, data: draft });
});
```

- [ ] 4. Deno-lint each function locally if the Supabase CLI is available (optional; these are not part of `tsc`/`ship-check` since they're Deno). Skip if unavailable — they deploy via `supabase functions deploy <name>`.

> **Deploy note (owner-gated):** deploy after the migration is applied — `supabase functions deploy safety-generate-jha`, `supabase functions deploy safety-detect-hazards`, `supabase functions deploy safety-draft-incident` (or Supabase MCP `deploy_edge_function`). `GEMINI_API_KEY` must already be set as a project secret (it is — shared with analyze-photos).

- [ ] 5. Commit:

```bash
git add supabase/functions/safety-generate-jha/index.ts supabase/functions/safety-detect-hazards/index.ts supabase/functions/safety-draft-incident/index.ts
git commit -m "$(cat <<'EOF'
Safety Wave A: AI edge functions (generate-jha, detect-hazards, draft-incident)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9 — JHA screen

**Files:**
- Create: `app/safety-jha.tsx`

**Component spec.** Mirror `app/punch-list.tsx` for structure/theming: a default-exported `SafetyJhaScreen` that renders `<Paywall visible feature="Safety Management" requiredTier="business" onClose={() => router.back()} />` when `!canAccess('safety_management')`, else `<SafetyJhaInner/>`. Standard imports: `useLocalSearchParams`/`useRouter`/`Stack` from `expo-router`, `useSafeAreaInsets`, `useTheme`, `useThemedStyles`, `Type`, `Tokens`, `generateUUID` from `@/utils/generateId`, `Alert`/`Platform`/`Modal`/`KeyboardAvoidingView`/`ScrollView`/`TextInput`/`TouchableOpacity`/`View`/`Text` from `react-native`, `* as Haptics`. Lucide icons: `HardHat`, `Plus`, `X`, `Sparkles` (AI), `Trash2`, `ChevronLeft`, `CheckCircle`, `PenLine` (sign-off).

Data hooks / derived state:
- `const { projectId } = useLocalSearchParams<{ projectId: string }>();`
- `const { getProject } = useProjects();` and `const { getJhasForProject, addJha, updateJha, deleteJha } = useSafety();`
- `const items = useMemo(() => getJhasForProject(projectId ?? ''), [projectId, getJhasForProject]);`
- Reuse punch-list's `if (!project)` EmptyState guard (icon `HardHat`, "Open a project…").

Local state: `showForm`, `editingJha: JobHazardAnalysis | null`, form fields `title`, `trade`, `taskDescription`, `date` (default `new Date().toISOString().slice(0,10)`), `steps: JHAStep[]`, `requiredPPE: string[]` (edited as a comma-joined `ppeText` string), `aiGenerated: boolean`, `generating: boolean`. A `resetForm` clears all. Steps are edited inline — a small sub-list where each step row has `step`, comma-joined `hazards`, comma-joined `controls` text inputs and an add/remove step button.

Section-modal structure (mirror punch-list `showForm` `<Modal transparent animationType="slide">` + `KeyboardAvoidingView` + `styles.formCard`): header row with title + `X` close; fields for Title (required), Trade, Task Description (multiline), Date; a "Generate with AI" button; the editable steps list; a Required PPE input; Cancel / Save actions. Copy the `makeStyles` block wholesale from `punch-list.tsx` (`modalOverlay`, `formCard`, `formHeader`, `fieldLabel`, `input`, `formActions`, `cancelBtn`, `saveBtn`, `addItemBtn`, `punchCard` → rename to `card`) and add a `stepRow`/`aiBtn` style pair.

The AI-invoke handler (critical — include verbatim). Client pre-check uses the generic daily quota (no new `AIFeature` key needed) then calls the edge function:

```tsx
const { tier } = useTierAccess();

const handleGenerate = useCallback(async () => {
  if (!taskDescription.trim()) { Alert.alert('Add a task', 'Describe the task first so AI can analyze it.'); return; }
  const check = await checkAILimit(tier, 'smart');
  if (!check.allowed) { Alert.alert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
  setGenerating(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-generate-jha`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ trade, taskDescription, projectContext: project?.name ?? '' }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) { Alert.alert('AI unavailable', json.error ?? 'Could not generate. Fill the JHA manually.'); return; }
    const aiSteps: JHAStep[] = (json.data.steps ?? []).map((s: { step: string; hazards: string[]; controls: string[] }) => ({
      id: generateUUID(), step: s.step, hazards: s.hazards ?? [], controls: s.controls ?? [],
    }));
    setSteps(aiSteps);
    setRequiredPPE(json.data.requiredPPE ?? []);
    setAiGenerated(true);
    await recordAIUsage('smart');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    Alert.alert('AI unavailable', 'Network issue — fill the JHA manually.');
  } finally {
    setGenerating(false);
  }
}, [taskDescription, trade, tier, project]);
```

Import the relay plumbing at the top: `import { supabase, SUPABASE_FUNCTIONS_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';` and `import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';`. `SUPABASE_FUNCTIONS_URL` (= `${SUPABASE_URL}/functions/v1`) and `SUPABASE_ANON_KEY` are already exported from `lib/supabase.ts` — use them as shown (do NOT invent `supabaseUrl`/`supabaseAnonKey`; those identifiers are module-private).

The save handler (critical — include verbatim):

```tsx
const handleSave = useCallback(() => {
  const t = title.trim();
  if (!t) { Alert.alert('Missing title', 'Give this JHA a title.'); return; }
  const now = new Date().toISOString();
  const ppe = requiredPPE.map(p => p.trim()).filter(Boolean);
  if (editingJha) {
    updateJha(editingJha.id, { title: t, trade: trade.trim(), taskDescription: taskDescription.trim(), date, steps, requiredPPE: ppe, aiGenerated });
  } else {
    const jha: JobHazardAnalysis = {
      id: generateUUID(), projectId: projectId ?? '', title: t, trade: trade.trim(),
      taskDescription: taskDescription.trim(), date, steps, requiredPPE: ppe, signOffs: [],
      aiGenerated, status: 'draft', createdBy: '', createdAt: now, updatedAt: now,
    };
    addJha(jha);
  }
  setShowForm(false); resetForm();
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}, [title, trade, taskDescription, date, steps, requiredPPE, aiGenerated, editingJha, projectId, addJha, updateJha, resetForm]);
```

List rendering: for each JHA render a `card` with `title`, a `trade · date` meta line, a step-count + PPE-count summary, a status chip (`draft`/`active`/`archived`), an "Activate" button that calls `updateJha(item.id, { status: 'active' })` when `status === 'draft'`, a sign-off count (`item.signOffs.length` signatures), and a `Trash2` delete (Alert-confirmed → `deleteJha`). Tapping the card opens the form in edit mode (populate all fields from the JHA). An "Add JHA" `addItemBtn` (Plus) opens the empty form. Empty state via `<EmptyState icon={<HardHat .../>} title="No JHAs yet" .../>`.

Sign-off capture: an inline "Add sign-off" action on each card that opens a small centered modal (mirror punch-list's `rejectOverlay`/`rejectCard`) with Name + Role inputs, appending `{ name, role, signedAt: new Date().toISOString() }` to `signOffs` via `updateJha(item.id, { signOffs: [...item.signOffs, sig] })`. Sign-offs are append-only (never edited/removed).

Steps:

- [ ] 1. Create `app/safety-jha.tsx` per the spec above (full screen, mirroring `app/punch-list.tsx` layout/styles; the two handlers above verbatim).

- [ ] 2. Type-check:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] 3. Commit:

```bash
git add app/safety-jha.tsx
git commit -m "$(cat <<'EOF'
Safety Wave A: JHA screen with AI generation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10 — Toolbox Talks + Incidents screens

Two screens; both mirror `app/punch-list.tsx`. Incidents carries the OSHA-recordable computation + the `safety-draft-incident` AI handler.

**Files:**
- Create: `app/safety-toolbox.tsx`
- Create: `app/safety-incidents.tsx`

**`app/safety-toolbox.tsx` spec.** Same Paywall wrapper (`safety_management`) + `if (!project)` EmptyState (icon `Megaphone`) as Task 9. Hooks: `const { getToolboxTalksForProject, addToolboxTalk, updateToolboxTalk, deleteToolboxTalk } = useSafety();`. Form fields: `topic` (required), `date` (default today), `presenter`, `notes` (multiline), and an attendee editor (list of `{ name }` rows with add/remove; `signedAt` set when an attendee is marked "signed" via a `PenLine` toggle). Lucide: `Megaphone`, `Plus`, `X`, `Trash2`, `PenLine`, `CheckCircle`, `Users`.

Save handler (verbatim):

```tsx
const handleSave = useCallback(() => {
  const tp = topic.trim();
  if (!tp) { Alert.alert('Missing topic', 'What was the talk about?'); return; }
  const now = new Date().toISOString();
  if (editingTalk) {
    updateToolboxTalk(editingTalk.id, { topic: tp, date, presenter: presenter.trim(), notes: notes.trim(), attendees });
  } else {
    const talk: ToolboxTalk = {
      id: generateUUID(), projectId: projectId ?? '', topic: tp, date, presenter: presenter.trim(),
      notes: notes.trim(), attendees, aiTopicSource: 'manual', createdBy: '', createdAt: now, updatedAt: now,
    };
    addToolboxTalk(talk);
  }
  setShowForm(false); resetForm();
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}, [topic, date, presenter, notes, attendees, editingTalk, projectId, addToolboxTalk, updateToolboxTalk, resetForm]);
```

Attendee sign toggle:

```tsx
const toggleAttendeeSigned = useCallback((idx: number) => {
  setAttendees(prev => prev.map((a, i) => i === idx
    ? { ...a, signedAt: a.signedAt ? undefined : new Date().toISOString() }
    : a));
}, []);
```

List card: `topic`, `presenter · date`, `{attendees.length} attendees ({signed} signed)`, `Trash2` delete (Alert → `deleteToolboxTalk`), tap-to-edit. "Add Toolbox Talk" `addItemBtn`. Empty state icon `Megaphone`. (No new edge function — toolbox topic suggestion reuses the existing text relay and is out of Wave-A build scope per the spec.)

**`app/safety-incidents.tsx` spec.** Same Paywall + `if (!project)` EmptyState (icon `ShieldAlert`). Hooks: `const { getIncidentsForProject, addIncident, updateIncident, deleteIncident } = useSafety();` plus `useTierAccess`. Import the OSHA classifier: `import { isOshaRecordable } from '@/utils/safety/osha';`. Lucide: `ShieldAlert`, `Plus`, `X`, `Sparkles`, `Trash2`, `AlertTriangle`.

Form fields: `type` (segmented `injury`/`near_miss`/`property`/`environmental`), `severity` (segmented `low`/`medium`/`high`/`critical`), `occurredAt` (default today), `description` (multiline, required), `location`; OSHA inputs — `treatment` (segmented `none`/`first_aid`/`medical_beyond_first_aid`), `daysAway` (numeric TextInput), `restrictedDuty`/`lostConsciousness`/`fatality` (toggle rows); a corrective-actions editor (`{ action, owner, done:false }` rows) and a `peopleInvolved` editor (`{ name, role }` rows). Segmented controls mirror punch-list's `priorityBtn` row pattern.

The recordable computation is applied at save (verbatim):

```tsx
const handleSave = useCallback(() => {
  const desc = description.trim();
  if (!desc) { Alert.alert('Missing description', 'Describe what happened.'); return; }
  const now = new Date().toISOString();
  const recordable = isOshaRecordable({
    type, treatment,
    daysAway: Number(daysAway) || 0,
    restrictedDuty, lostConsciousness, fatality,
  });
  if (editingIncident) {
    updateIncident(editingIncident.id, {
      type, severity, occurredAt, description: desc, location: location.trim(),
      peopleInvolved, photoUrls, correctiveActions, treatment,
      daysAway: Number(daysAway) || 0, restrictedDuty, lostConsciousness, fatality,
      oshaRecordable: recordable, status,
    });
  } else {
    const incident: SafetyIncident = {
      id: generateUUID(), projectId: projectId ?? '', type, severity, occurredAt,
      description: desc, location: location.trim(), peopleInvolved, photoUrls,
      correctiveActions, treatment, daysAway: Number(daysAway) || 0,
      restrictedDuty, lostConsciousness, fatality, oshaRecordable: recordable,
      status: 'open', reportedBy: '', createdBy: '', createdAt: now, updatedAt: now,
    };
    addIncident(incident);
  }
  setShowForm(false); resetForm();
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}, [type, severity, occurredAt, description, location, peopleInvolved, photoUrls, correctiveActions, treatment, daysAway, restrictedDuty, lostConsciousness, fatality, status, editingIncident, projectId, addIncident, updateIncident, resetForm]);
```

AI-invoke handler (`safety-draft-incident`) — same relay plumbing as Task 9 (`supabase.auth.getSession()`, `checkAILimit(tier,'smart')`/`recordAIUsage('smart')`), posting `{ voiceTranscript: draftNotes, notes: draftNotes }`. On success, prefill the form fields from `json.data` (`type`, `severity`, `description`, `location`, and map `correctiveActions` to `{ action, owner, done:false }`), then let the user confirm and Save (never auto-commit):

```tsx
const handleDraftAI = useCallback(async () => {
  if (!draftNotes.trim()) { Alert.alert('Add notes', 'Type or dictate what happened first.'); return; }
  const check = await checkAILimit(tier, 'smart');
  if (!check.allowed) { Alert.alert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
  setDrafting(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-draft-incident`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ voiceTranscript: draftNotes, notes: draftNotes }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) { Alert.alert('AI unavailable', json.error ?? 'Fill the incident manually.'); return; }
    setType(json.data.type); setSeverity(json.data.severity);
    setDescription(json.data.description ?? ''); setLocation(json.data.location ?? '');
    setCorrectiveActions((json.data.correctiveActions ?? []).map((a: { action: string; owner: string }) => ({ action: a.action, owner: a.owner, done: false })));
    await recordAIUsage('smart');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    Alert.alert('AI unavailable', 'Network issue — fill the incident manually.');
  } finally {
    setDrafting(false);
  }
}, [draftNotes, tier]);
```

List card: `description` (numberOfLines 2), a `type · severity` meta line, an amber "OSHA Recordable" badge when `item.oshaRecordable`, a status chip (`open`/`investigating`/`closed`) that advances on tap via `updateIncident`, corrective-action progress (`{done}/{total} actions`), `Trash2` delete. "Report Incident" `addItemBtn`. Empty state icon `ShieldAlert`.

Steps:

- [ ] 1. Create `app/safety-toolbox.tsx` per spec.

- [ ] 2. Create `app/safety-incidents.tsx` per spec (OSHA computation + AI draft handler verbatim).

- [ ] 3. Type-check:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] 4. Commit:

```bash
git add app/safety-toolbox.tsx app/safety-incidents.tsx
git commit -m "$(cat <<'EOF'
Safety Wave A: Toolbox Talks + Incidents screens (OSHA classify + AI draft)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11 — Hazard Log screen + final ship-check

The last feature screen (risk-score banding + `safety-detect-hazards` AI), then run the full gate.

**Files:**
- Create: `app/safety-hazards.tsx`

**Component spec.** Same Paywall + `if (!project)` EmptyState (icon `TriangleAlert`). Hooks: `const { getHazardsForProject, addHazard, updateHazard, deleteHazard } = useSafety();` plus `useTierAccess`. Import the pure risk logic: `import { computeRiskScore, riskBand } from '@/utils/safety/risk';`. Lucide: `TriangleAlert`, `Plus`, `X`, `Sparkles`, `Trash2`.

`getHazardsForProject` already returns hazards sorted by `riskScore` desc — render highest-risk first. Form fields: `description` (required), `location`, `severity` (segmented 1–5), `likelihood` (segmented 1–5), `assignedTo`, `dueDate`, `correctiveAction` (multiline). A live risk preview under the two scales: `Risk {computeRiskScore(severity, likelihood)} — {riskBand(...)}` colored by band (`low`→`textMuted`, `medium`→`accent`, `high`→`danger`, `critical`→`danger`). A band→color helper mirrors punch-list's `getPriorityConfig`.

Save handler (verbatim — riskScore is computed, never hand-entered):

```tsx
const handleSave = useCallback(() => {
  const desc = description.trim();
  if (!desc) { Alert.alert('Missing description', 'Describe the hazard.'); return; }
  const now = new Date().toISOString();
  const score = computeRiskScore(severity, likelihood);
  if (editingHazard) {
    updateHazard(editingHazard.id, {
      description: desc, location: location.trim(), severity, likelihood, riskScore: score,
      assignedTo: assignedTo.trim() || undefined, dueDate: dueDate.trim() || undefined,
      correctiveAction: correctiveAction.trim() || undefined, status,
    });
  } else {
    const hazard: Hazard = {
      id: generateUUID(), projectId: projectId ?? '', description: desc, location: location.trim(),
      photoUrl: undefined, severity, likelihood, riskScore: score,
      assignedTo: assignedTo.trim() || undefined, dueDate: dueDate.trim() || undefined,
      correctiveAction: correctiveAction.trim() || undefined, status: 'open',
      createdBy: '', createdAt: now, updatedAt: now,
    };
    addHazard(hazard);
  }
  setShowForm(false); resetForm();
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}, [description, location, severity, likelihood, assignedTo, dueDate, correctiveAction, status, editingHazard, projectId, addHazard, updateHazard, resetForm]);
```

AI-invoke handler (`safety-detect-hazards`) — same relay plumbing as Task 9. This one posts inline photos: reuse the app's existing image picker path if wired, else accept a single `photoUrl` from an already-uploaded Supabase URL. On success, present the returned `hazards[]` as tappable suggestion chips; tapping one prefills the form (`description`, `severity`, `likelihood`) for the user to confirm and Save — never auto-committed:

```tsx
const handleDetect = useCallback(async (photoUrls: string[]) => {
  if (photoUrls.length === 0) { Alert.alert('Add a photo', 'Attach a site photo to scan for hazards.'); return; }
  const check = await checkAILimit(tier, 'smart');
  if (!check.allowed) { Alert.alert('AI limit reached', check.message ?? 'Daily AI limit reached.'); return; }
  setDetecting(true);
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/safety-detect-hazards`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token ?? ''}` },
      body: JSON.stringify({ photoUrls }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) { Alert.alert('AI unavailable', json.error ?? 'Log hazards manually.'); return; }
    setSuggestions(json.data.hazards ?? []);
    await recordAIUsage('smart');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    Alert.alert('AI unavailable', 'Network issue — log hazards manually.');
  } finally {
    setDetecting(false);
  }
}, [tier]);

const applySuggestion = useCallback((s: { description: string; severity: number; likelihood: number }) => {
  setDescription(s.description);
  setSeverity(Math.max(1, Math.min(5, s.severity)) as 1|2|3|4|5);
  setLikelihood(Math.max(1, Math.min(5, s.likelihood)) as 1|2|3|4|5);
  setShowForm(true);
}, []);
```

List card: `description`, `location`, a risk chip `{riskScore} · {band}` colored by band, `assignedTo`/`dueDate` meta, a status chip (`open`/`mitigated`/`closed`) advanced on tap via `updateHazard`, `Trash2` delete. "Log Hazard" `addItemBtn` + a "Scan photo for hazards" button (mirrors punch-list's `walkBtn`, icon `Sparkles`). Empty state icon `TriangleAlert`.

Steps:

- [ ] 1. Create `app/safety-hazards.tsx` per spec (risk preview + detect handler verbatim).

- [ ] 2. Type-check:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] 3. Run the full ship gate (includes the two new safety validators):

```bash
bun run ship-check
```

Expected: PASS — typecheck + lint clean, and `test:safety-risk` (`16 passed, 0 failed`) + `test:safety-osha` (`11 passed, 0 failed`) both green among the rest.

- [ ] 4. Commit:

```bash
git add app/safety-hazards.tsx
git commit -m "$(cat <<'EOF'
Safety Wave A: Hazard Log screen with risk banding + AI photo detection

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Ship sequence (owner-gated — do NOT run from the sandbox)

1. **Apply the migration to prod FIRST** (`20260708120000_safety_wave_a.sql`) via Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`), verify tables with `execute_sql`. Never `supabase db push`.
2. **Deploy the three edge functions**: `safety-generate-jha`, `safety-detect-hazards`, `safety-draft-incident`.
3. **Then OTA the JS**: `eas update --branch production --message "Safety Management Wave A"`. Ordering matters — an OTA that writes columns the live schema lacks fails silently through `supabaseWrite` (the PGRST204 gate).

---

## Wave-A requirement → task coverage

| Spec Wave-A requirement | Task |
| --- | --- |
| `JobHazardAnalysis` + `JHAStep` + `SafetySignoff` types | 1 |
| `ToolboxTalk` + `SafetyAttendee` types | 1 |
| `SafetyIncident` (+ OSHA input fields) types | 1 |
| `Hazard` type | 1 |
| Risk score = severity×likelihood + banding (`utils/safety/risk.ts` + validator) | 2 |
| `oshaRecordable` classification (`utils/safety/osha.ts` + validator) | 3 |
| Both validators wired into `ship-check` | 2, 3, 11 |
| `SafetyContext` (tertiary_* collections, offline-first `supabaseWrite`) | 4 |
| Additive migration + `schema.sql` (4 tables, RLS) | 5 |
| Business-tier client gate (`safety_management`) | 6 |
| Server `safety_ai` monthly cap | 6 |
| Provider mount inside `ProjectProvider` | 7 |
| Screen registration in `_layout.tsx` | 7 |
| Hub screen (`app/safety.tsx`) | 7 |
| Sidebar NavItem (`HardHat`, FIELD OPS) | 7 |
| JHA screen + `safety-generate-jha` invoke | 8, 9 |
| Toolbox Talks screen | 8, 10 |
| Incidents screen + OSHA classify + `safety-draft-incident` invoke | 8, 10 |
| Hazard Log screen + risk banding + `safety-detect-hazards` invoke | 8, 11 |
| Edge fn: `safety-generate-jha` (text, `safety_ai` cap) | 8 |
| Edge fn: `safety-detect-hazards` (vision, `analyze_photos` cap, SSRF-guarded) | 8 |
| Edge fn: `safety-draft-incident` (text, `safety_ai` cap) | 8 |
| AI outputs are suggestions the user confirms; fail-closed to manual form | 8, 9, 10, 11 |
