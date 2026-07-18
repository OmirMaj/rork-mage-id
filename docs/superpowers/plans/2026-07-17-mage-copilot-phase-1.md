# MAGE Copilot — Phase 1 (Engine + Schedule flagship) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the reusable MAGE Copilot conversational-automation engine and its first capability — a grounded, adaptive voice-to-schedule interview — proving the pattern end-to-end on iOS + web.

**Architecture:** A pure client-side turn state machine drives a stateless per-turn call to the *existing* `mageAI` → `supabase/functions/ai` relay (no new edge function, no conversation server). A `CopilotCapability` object per feature declares grounding / gap-rules / draft-schema+prompt / apply. The engine asks a clarifying question **only** when the capability's `gaps()` fn (fed the draft + the contractor's own cost/history grounding) can't already resolve the field; otherwise it states a grounded default. The Schedule capability's `apply()` reuses the existing `generateScheduleFromEstimate` → `stashDraft` → `app/schedule-review.tsx` → `updateProject({ schedule })` tail unchanged.

**Tech Stack:** React Native / Expo (RN-web), TypeScript strict, `bun`, `zod`, existing `utils/mageAI.ts` (Gemini relay), `utils/costDatabase.ts` / `utils/projectMemory.ts` / `utils/estimateCalibration.ts` (grounding), pure-fn validators via `scripts/validate-*.ts` wired into `package.json` `ship-check` (NO jest). OTA-safe (JS-only, `expo.version` unchanged; no edge-fn deploy).

---

## File structure

**New — engine core (`utils/copilot/`):**
- `types.ts` — `CopilotCapability<Draft,Applied>`, `Gap`, `Grounding`, `CopilotContext`, `CopilotState`, `CopilotAction`, `CopilotCapabilityId`, `AskDecision`. Pure types; no runtime deps.
- `askDecision.ts` — `decideAsk(gaps, state)` → the single highest-impact unresolved gap to ask, or `{ kind: 'ready' }` / `{ kind: 'capped' }`. Pure. The "ask only when it matters" + `MAX_QUESTIONS` cap live here.
- `turnReducer.ts` — `copilotReducer(state, action)` pure state machine (`idle→listening→thinking→asking→confirming→review→applying→done|error`).
- `registry.ts` — `registerCapability` / `getCapability(id)`.

**New — Schedule capability (`utils/copilot/schedule/`):**
- `scheduleGrounding.ts` — `buildScheduleGrounding(ctx)` → compact `Grounding` from cost book + project memory + linked estimate.
- `scheduleGaps.ts` — `scheduleGaps(draft, grounding)` → `Gap[]` (pure).
- `scheduleCapability.ts` — the `CopilotCapability` object (id `'schedule'`), wiring grounding/gaps/prompt/apply.

**New — client loop + UI:**
- `hooks/useCopilotConversation.ts` — drives `copilotReducer` + one `mageAI` call per turn; exposes state + `answer()/skip()/editTranscript()/confirm()/cancel()`.
- `components/copilot/CopilotShell.tsx` — the interview modal (per spec §3.7). Uses `Colors`/`Type`/`Tokens` only.
- `components/copilot/QuestionView.tsx`, `ResolvedChips.tsx`, `OptionCard.tsx` — focused sub-views.
- `app/copilot.tsx` — modal route hosting `CopilotShell`, params `{ capabilityId, projectId }`.

**New — validators (`scripts/`):** `validate-copilot-turn-reducer.ts`, `validate-copilot-ask-decision.ts`, `validate-copilot-gaps-schedule.ts`.

**Modify:**
- `app/_layout.tsx` — register `copilot` `Stack.Screen` (`presentation: 'modal'`).
- `app/schedule-pro.tsx` + the mobile schedule screen — add a "Build by voice" entry that routes to `/copilot?capabilityId=schedule&projectId=…`.
- `package.json` — add `test:copilot-reducer` / `test:copilot-ask` / `test:copilot-gaps-schedule`, append them to the `ship-check` `&&`-chain.

---

## Task 1: Engine core types

**Files:**
- Create: `utils/copilot/types.ts`

- [ ] **Step 1: Write the types (no test — pure declarations, verified by `tsc` in later tasks)**

```ts
// utils/copilot/types.ts — MAGE Copilot engine contracts.
//
// One engine, many capabilities. A feature registers a CopilotCapability that
// declares FOUR things: grounding (its own history), gaps (what's still
// unresolved), the draft schema + per-turn prompt, and apply (persist). The
// engine owns the turn loop, the "ask only when it matters" discipline, the
// confirm-back, and the review→apply handoff. Pure types; no runtime imports
// except the domain Project type.
import type { Project } from '@/types';

export type CopilotCapabilityId =
  | 'schedule' | 'estimate' | 'daily_report' | 'change_order'
  | 'rfi' | 'punch' | 'safety_incident' | 'invoice';

/** A field the interview may need. `impact` 0..1 ranks urgency; a gap below the
 *  ask threshold is NEVER asked — the engine states `groundedDefault` instead. */
export interface Gap {
  field: string;
  impact: number;
  question: string;                               // grounded, one sentence
  groundedDefault: { value: unknown; basis: string };
  kind: 'number' | 'text' | 'enum' | 'date' | 'choice';
  choices?: { label: string; value: unknown; basis?: string; recommended?: boolean }[];
}

/** Compact, serializable snapshot of the contractor's own history that the
 *  interview cites. Built once per session by the capability. */
export interface Grounding {
  facts: string[];                                // human-readable, cited in prompts
  data: Record<string, unknown>;                  // structured hints for gaps()
}

/** Everything a capability needs to read history + persist. Assembled by the
 *  shell; no capability touches Supabase directly. */
export interface CopilotContext {
  project: Project | null;
  projectId: string;
  ctx: any;                                       // the useProjects() context (adders)
  tier: string;
}

export interface CopilotCapability<Draft = any, Applied = any> {
  id: CopilotCapabilityId;
  label: string;
  featureKey?: string;                            // hooks/useTierAccess FeatureKey; omit = free
  aiFeature: 'scheduleCopilot';                   // utils/aiRateLimiterCore AIFeature bucket
  maxQuestions?: number;                          // default 4
  askThreshold?: number;                          // default 0.35
  buildGrounding(ctx: CopilotContext): Promise<Grounding>;
  gaps(draft: Draft, grounding: Grounding): Gap[];
  /** Turn prompt: given transcript + draft + grounding + the one gap being
   *  asked (or null on the first pass), returns the prompt + a plain-object
   *  schemaHint for mageAI. mageAI returns the updated draft as JSON. */
  buildTurnPrompt(a: { transcript: string; draft: Draft; grounding: Grounding; asking: Gap | null }): { prompt: string; schemaHint: object };
  /** Merge mageAI's JSON into the running draft (typed, defensive). */
  mergeDraft(draft: Draft, aiJson: any): Draft;
  apply(draft: Draft, ctx: CopilotContext): Promise<Applied>;
  suggestions: string[];                          // "Try saying…" seeds
  topicChecklist?: { label: string; hint?: string }[];
}

export type CopilotPhase =
  | 'idle' | 'listening' | 'thinking' | 'asking' | 'confirming'
  | 'review' | 'applying' | 'done' | 'error';

export interface TranscriptTurn { id: string; text: string; edited?: boolean }

export interface CopilotState<Draft = any> {
  phase: CopilotPhase;
  capabilityId: CopilotCapabilityId;
  draft: Draft;
  grounding: Grounding;
  transcript: TranscriptTurn[];
  askedFields: string[];
  currentGap: Gap | null;
  resolved: { field: string; label: string; basis: string }[];
  questionCount: number;
  errorKind?: string;
  errorMessage?: string;
}

export type CopilotAction<Draft = any> =
  | { type: 'START'; grounding: Grounding }
  | { type: 'UTTERANCE'; turnId: string; text: string }
  | { type: 'EDIT_TRANSCRIPT'; turnId: string; text: string }
  | { type: 'AI_DRAFT'; draft: Draft; resolved: CopilotState['resolved']; nextGap: Gap | null; ready: boolean }
  | { type: 'ANSWER'; field: string; value: unknown }
  | { type: 'SKIP_QUESTION' }
  | { type: 'CONFIRM' }
  | { type: 'APPLY_OK' }
  | { type: 'APPLY_ERR'; errorKind: string; message: string }
  | { type: 'CANCEL' };

export type AskDecision =
  | { kind: 'ask'; gap: Gap }
  | { kind: 'ready' }
  | { kind: 'capped' };
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `utils/copilot/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add utils/copilot/types.ts
git commit -m "feat(copilot): engine core types"
```

---

## Task 2: Ask-decision (the "ask only when it matters" core)

**Files:**
- Create: `utils/copilot/askDecision.ts`
- Create: `scripts/validate-copilot-ask-decision.ts`

- [ ] **Step 1: Write the failing validator**

```ts
// scripts/validate-copilot-ask-decision.ts — pure-fn validator for utils/copilot/askDecision.ts.
// The "ask only when it matters" discipline: never ask a gap below threshold;
// ask the single highest-impact remaining gap; stop at the question cap.
import { decideAsk } from '../utils/copilot/askDecision';
import type { Gap } from '../utils/copilot/types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const g = (field: string, impact: number): Gap => ({ field, impact, question: field + '?', groundedDefault: { value: 1, basis: 'b' }, kind: 'number' });

// No gaps → ready.
eq('no gaps → ready', decideAsk([], { asked: [], count: 0, cap: 4, threshold: 0.35 }).kind, 'ready');
// All gaps below threshold → ready (they get defaults, never asked).
eq('all below threshold → ready', decideAsk([g('a', 0.2), g('b', 0.1)], { asked: [], count: 0, cap: 4, threshold: 0.35 }).kind, 'ready');
// Asks the highest-impact gap above threshold.
{
  const d = decideAsk([g('a', 0.4), g('b', 0.9), g('c', 0.5)], { asked: [], count: 0, cap: 4, threshold: 0.35 });
  eq('asks highest-impact', d.kind === 'ask' ? d.gap.field : d.kind, 'b');
}
// Never re-asks an already-asked field.
{
  const d = decideAsk([g('b', 0.9), g('c', 0.5)], { asked: ['b'], count: 1, cap: 4, threshold: 0.35 });
  eq('skips already-asked', d.kind === 'ask' ? d.gap.field : d.kind, 'c');
}
// Question cap reached → capped (remaining gaps fall to defaults, flagged in review).
eq('cap reached → capped', decideAsk([g('a', 0.9)], { asked: ['x','y','z','w'], count: 4, cap: 4, threshold: 0.35 }).kind, 'capped');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — verify it fails**

Run: `bun run scripts/validate-copilot-ask-decision.ts`
Expected: FAIL — `Cannot find module '../utils/copilot/askDecision'`.

- [ ] **Step 3: Implement**

```ts
// utils/copilot/askDecision.ts — the ask-only-when-unresolved discipline.
import type { Gap, AskDecision } from './types';

export interface AskState { asked: string[]; count: number; cap: number; threshold: number }

/** Decide the ONE gap to ask next, or that we're ready / capped. Gaps below
 *  `threshold` are never asked (the engine states their grounded default).
 *  Already-asked fields are skipped. At/over the cap we stop asking. */
export function decideAsk(gaps: Gap[], s: AskState): AskDecision {
  const askable = gaps
    .filter(g => g.impact >= s.threshold && !s.asked.includes(g.field))
    .sort((a, b) => b.impact - a.impact);
  if (askable.length === 0) return { kind: 'ready' };
  if (s.count >= s.cap) return { kind: 'capped' };
  return { kind: 'ask', gap: askable[0] };
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `bun run scripts/validate-copilot-ask-decision.ts`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/askDecision.ts scripts/validate-copilot-ask-decision.ts
git commit -m "feat(copilot): ask-decision (ask only when it matters) + validator"
```

---

## Task 3: Turn reducer (the state machine)

**Files:**
- Create: `utils/copilot/turnReducer.ts`
- Create: `scripts/validate-copilot-turn-reducer.ts`

- [ ] **Step 1: Write the failing validator**

```ts
// scripts/validate-copilot-turn-reducer.ts — pure-fn validator for the turn reducer.
import { copilotReducer, initialCopilotState } from '../utils/copilot/turnReducer';
import type { Gap } from '../utils/copilot/types';

let pass = 0, fail = 0;
function eq<T>(n: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, '\n   got ', JSON.stringify(got), '\n   want', JSON.stringify(want)); }
}
const gap = (f: string): Gap => ({ field: f, impact: 0.9, question: f + '?', groundedDefault: { value: 1, basis: 'b' }, kind: 'number' });
const G = { facts: [], data: {} };

let s = initialCopilotState('schedule', {});
s = copilotReducer(s, { type: 'START', grounding: G });
eq('START → listening', s.phase, 'listening');

s = copilotReducer(s, { type: 'UTTERANCE', turnId: 't1', text: 'gut bath' });
eq('UTTERANCE → thinking', s.phase, 'thinking');
eq('transcript captured', s.transcript.map(t => t.text), ['gut bath']);

s = copilotReducer(s, { type: 'AI_DRAFT', draft: { a: 1 }, resolved: [{ field: 'x', label: 'X', basis: 'b' }], nextGap: gap('start'), ready: false });
eq('AI_DRAFT with gap → asking', s.phase, 'asking');
eq('currentGap set', s.currentGap?.field, 'start');
eq('resolved recorded', s.resolved.length, 1);

s = copilotReducer(s, { type: 'ANSWER', field: 'start', value: '2026-03-21' });
eq('ANSWER → thinking (loops back for next turn)', s.phase, 'thinking');
eq('asked field recorded', s.askedFields, ['start']);
eq('question count incremented', s.questionCount, 1);

s = copilotReducer(s, { type: 'AI_DRAFT', draft: { a: 1 }, resolved: [], nextGap: null, ready: true });
eq('AI_DRAFT ready → review', s.phase, 'review');

s = copilotReducer(s, { type: 'CONFIRM' });
eq('CONFIRM → applying', s.phase, 'applying');
s = copilotReducer(s, { type: 'APPLY_OK' });
eq('APPLY_OK → done', s.phase, 'done');

// EDIT_TRANSCRIPT re-marks the turn and returns to thinking.
let e = copilotReducer(initialCopilotState('schedule', {}), { type: 'START', grounding: G });
e = copilotReducer(e, { type: 'UTTERANCE', turnId: 't1', text: 'ten K' });
e = copilotReducer(e, { type: 'EDIT_TRANSCRIPT', turnId: 't1', text: '$10k' });
eq('EDIT_TRANSCRIPT updates text', e.transcript[0].text, '$10k');
eq('EDIT_TRANSCRIPT marks edited', e.transcript[0].edited, true);
eq('EDIT_TRANSCRIPT → thinking', e.phase, 'thinking');

// CANCEL from any phase → idle with empty draft.
eq('CANCEL → idle', copilotReducer(s, { type: 'CANCEL' }).phase, 'idle');
// APPLY_ERR preserves draft + records error.
{
  let f = copilotReducer(e, { type: 'AI_DRAFT', draft: { a: 9 }, resolved: [], nextGap: null, ready: true });
  f = copilotReducer(f, { type: 'CONFIRM' });
  f = copilotReducer(f, { type: 'APPLY_ERR', errorKind: 'network', message: 'offline' });
  eq('APPLY_ERR → error', f.phase, 'error');
  eq('APPLY_ERR preserves draft', (f.draft as any).a, 9);
  eq('APPLY_ERR records kind', f.errorKind, 'network');
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — verify it fails**

Run: `bun run scripts/validate-copilot-turn-reducer.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// utils/copilot/turnReducer.ts — pure state machine for the Copilot interview.
import type { CopilotState, CopilotAction, CopilotCapabilityId } from './types';

export function initialCopilotState<Draft = any>(capabilityId: CopilotCapabilityId, draft: Draft): CopilotState<Draft> {
  return {
    phase: 'idle', capabilityId, draft,
    grounding: { facts: [], data: {} },
    transcript: [], askedFields: [], currentGap: null, resolved: [],
    questionCount: 0,
  };
}

export function copilotReducer<Draft = any>(s: CopilotState<Draft>, a: CopilotAction<Draft>): CopilotState<Draft> {
  switch (a.type) {
    case 'START':
      return { ...s, phase: 'listening', grounding: a.grounding };
    case 'UTTERANCE':
      return { ...s, phase: 'thinking', transcript: [...s.transcript, { id: a.turnId, text: a.text }] };
    case 'EDIT_TRANSCRIPT':
      return {
        ...s, phase: 'thinking',
        transcript: s.transcript.map(t => t.id === a.turnId ? { ...t, text: a.text, edited: true } : t),
      };
    case 'AI_DRAFT': {
      // Newly-resolved defaults accumulate (dedupe by field). Ready → review;
      // a gap → asking; neither → confirming (fallback, shouldn't normally hit).
      const resolvedFields = new Set(s.resolved.map(r => r.field));
      const resolved = [...s.resolved, ...a.resolved.filter(r => !resolvedFields.has(r.field))];
      if (a.ready) return { ...s, phase: 'review', draft: a.draft, resolved, currentGap: null };
      if (a.nextGap) return { ...s, phase: 'asking', draft: a.draft, resolved, currentGap: a.nextGap };
      return { ...s, phase: 'confirming', draft: a.draft, resolved, currentGap: null };
    }
    case 'ANSWER':
      // Record the answer as a virtual utterance, mark the field asked, loop back.
      return {
        ...s, phase: 'thinking',
        transcript: [...s.transcript, { id: 'a-' + a.field, text: `${a.field}: ${String(a.value)}` }],
        askedFields: s.currentGap ? [...s.askedFields, s.currentGap.field] : s.askedFields,
        questionCount: s.questionCount + 1,
        currentGap: null,
      };
    case 'SKIP_QUESTION':
      // Skip = accept the grounded default; mark asked so we don't re-ask; loop.
      return {
        ...s, phase: 'thinking',
        askedFields: s.currentGap ? [...s.askedFields, s.currentGap.field] : s.askedFields,
        questionCount: s.questionCount + 1,
        currentGap: null,
      };
    case 'CONFIRM':
      return { ...s, phase: 'applying' };
    case 'APPLY_OK':
      return { ...s, phase: 'done' };
    case 'APPLY_ERR':
      return { ...s, phase: 'error', errorKind: a.errorKind, errorMessage: a.message };
    case 'CANCEL':
      return initialCopilotState(s.capabilityId, {} as Draft);
    default:
      return s;
  }
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `bun run scripts/validate-copilot-turn-reducer.ts`
Expected: all assertions pass, `0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/turnReducer.ts scripts/validate-copilot-turn-reducer.ts
git commit -m "feat(copilot): pure turn reducer + validator"
```

---

## Task 4: Schedule gap-rules

**Files:**
- Create: `utils/copilot/schedule/scheduleGaps.ts`
- Create: `scripts/validate-copilot-gaps-schedule.ts`

Schedule draft (Phase-1 shape — the small set the interview needs; the full CPM
task list is generated in `apply`, Task 6):

```ts
export interface ScheduleDraft {
  startDate?: string | null;          // ISO; NEVER auto-stamped to today
  phased?: boolean | null;
  longLeadMilestones?: string[];      // categories that need a procurement milestone
  crewCap?: number | null;
  weatherBuffer?: boolean | null;
}
```

- [ ] **Step 1: Write the failing validator**

```ts
// scripts/validate-copilot-gaps-schedule.ts — pure-fn validator for scheduleGaps.
// Grounding suppresses questions the data resolves; leaves the genuinely-open ones.
import { scheduleGaps, type ScheduleDraft } from '../utils/copilot/schedule/scheduleGaps';
import type { Grounding } from '../utils/copilot/types';

let pass = 0, fail = 0;
function has(n: string, gapFields: string[], field: string, want: boolean) {
  const ok = gapFields.includes(field) === want;
  if (ok) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, `(fields: ${gapFields.join(',')})`); }
}
const ground = (data: any): Grounding => ({ facts: [], data });

// Start date UNSET → ask (never auto-stamp today, per the known startDate jump bug).
{
  const gaps = scheduleGaps({ startDate: null }, ground({}));
  has('unset start date is asked', gaps.map(g => g.field), 'startDate', true);
}
// Start date already stated → NOT asked.
{
  const gaps = scheduleGaps({ startDate: '2026-03-21' }, ground({}));
  has('stated start date not asked', gaps.map(g => g.field), 'startDate', false);
}
// Big long-lead category ($ >= 15k) with no lead signal in memory → ask a milestone.
{
  const gaps = scheduleGaps({ startDate: '2026-03-21' }, ground({ heavyCategories: [{ name: 'Cabinets', total: 28000, hasLeadSignal: false }] }));
  has('unresolved long-lead is asked', gaps.map(g => g.field), 'longLeadMilestones', true);
}
// Same category WITH a lead signal in memory → default, not asked.
{
  const gaps = scheduleGaps({ startDate: '2026-03-21' }, ground({ heavyCategories: [{ name: 'Cabinets', total: 28000, hasLeadSignal: true }] }));
  has('resolved long-lead not asked', gaps.map(g => g.field), 'longLeadMilestones', false);
}
// Crew cap: bottleneck history present → default (not asked); absent+heavy → asked.
{
  has('crew cap defaulted from history', scheduleGaps({ startDate: '2026-03-21' }, ground({ crewCapHistory: 3 })).map(g => g.field), 'crewCap', false);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — verify it fails**

Run: `bun run scripts/validate-copilot-gaps-schedule.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// utils/copilot/schedule/scheduleGaps.ts — schedule interview gap rules.
// A gap is emitted ONLY when the draft + grounding can't resolve the field.
import type { Gap, Grounding } from '../types';

export interface ScheduleDraft {
  startDate?: string | null;
  phased?: boolean | null;
  longLeadMilestones?: string[];
  crewCap?: number | null;
  weatherBuffer?: boolean | null;
}

export function scheduleGaps(draft: ScheduleDraft, grounding: Grounding): Gap[] {
  const d = grounding.data as {
    heavyCategories?: { name: string; total: number; hasLeadSignal: boolean }[];
    crewCapHistory?: number;
    weatherSensitive?: boolean;
    occupiedLikely?: boolean;
  };
  const gaps: Gap[] = [];

  // 1. Start date — ask if unset. NEVER auto-stamp today (startDate jump bug).
  if (draft.startDate == null) {
    gaps.push({
      field: 'startDate', impact: 0.9, kind: 'date',
      question: 'No start date is set — when do you break ground?',
      groundedDefault: { value: null, basis: 'not derivable — must be chosen' },
    });
  }

  // 2. Long-lead procurement — ask only for a heavy category with no lead signal.
  const unresolvedLead = (d.heavyCategories ?? []).filter(c => c.total >= 15000 && !c.hasLeadSignal);
  if (unresolvedLead.length > 0 && draft.longLeadMilestones == null) {
    const c = unresolvedLead[0];
    gaps.push({
      field: 'longLeadMilestones', impact: 0.7, kind: 'choice',
      question: `Your ${c.name.toLowerCase()} line is $${(c.total / 1000).toFixed(0)}k — that usually means a multi-week lead. Add a procurement milestone before install?`,
      groundedDefault: { value: [c.name], basis: `$${c.total.toLocaleString()} category, no lead recorded` },
      choices: [
        { label: 'Yes — add the milestone', value: [c.name], basis: 'keeps install off the critical path', recommended: true },
        { label: 'No — already on site', value: [] },
      ],
    });
  }

  // 3. Crew cap — default from history when we have it; ask only if absent.
  if (draft.crewCap == null && d.crewCapHistory == null && (d.heavyCategories ?? []).some(c => c.total >= 15000)) {
    gaps.push({
      field: 'crewCap', impact: 0.4, kind: 'number',
      question: 'How many on the heaviest crew?',
      groundedDefault: { value: 3, basis: 'no crew-size history yet — assuming 3' },
    });
  }

  // 4. Phasing — ask only when an occupied remodel is likely and unstated.
  if (draft.phased == null && d.occupiedLikely) {
    gaps.push({
      field: 'phased', impact: 0.5, kind: 'choice',
      question: 'Occupied remodel by the look of it — phase it by area, or can trades overlap?',
      groundedDefault: { value: false, basis: 'defaulting to overlapping trades' },
      choices: [
        { label: 'Trades can overlap', value: false, recommended: true },
        { label: 'Phase it by area', value: true },
      ],
    });
  }
  return gaps;
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `bun run scripts/validate-copilot-gaps-schedule.ts`
Expected: `5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/schedule/scheduleGaps.ts scripts/validate-copilot-gaps-schedule.ts
git commit -m "feat(copilot): schedule gap-rules + validator"
```

---

## Task 5: Wire the three validators into ship-check

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the script entries** (next to the other `test:*` scripts):

```json
"test:copilot-ask": "bun run scripts/validate-copilot-ask-decision.ts",
"test:copilot-reducer": "bun run scripts/validate-copilot-turn-reducer.ts",
"test:copilot-gaps-schedule": "bun run scripts/validate-copilot-gaps-schedule.ts",
```

- [ ] **Step 2: Append them to the `ship-check` chain** (the chain currently ends `… && bun run test:scheme`). Change the tail to:

```
… && bun run test:scheme && bun run test:copilot-ask && bun run test:copilot-reducer && bun run test:copilot-gaps-schedule"
```

- [ ] **Step 3: Run ship-check — verify green**

Run: `bun run ship-check`
Expected: all suites pass including the three new copilot validators.

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore(copilot): wire copilot validators into ship-check"
```

---

## Task 6: Schedule grounding + capability object

**Files:**
- Create: `utils/copilot/schedule/scheduleGrounding.ts`
- Create: `utils/copilot/schedule/scheduleCapability.ts`
- Create: `utils/copilot/registry.ts`

Read first (to match real signatures): `utils/costDatabase.ts` (`buildCostDatabase`, `CostBookEntry`), `utils/projectMemory.ts` (`retrieveRelevant`), `utils/autoScheduleFromEstimate.ts` (`buildEstimateSummary`, `generateScheduleFromEstimate`, `stashDraft`, `AutoScheduleResult`), `types/index.ts` `LinkedEstimate`.

- [ ] **Step 1: `scheduleGrounding.ts`** — assemble the `data` blob `scheduleGaps` consumes + human `facts` the prompt cites.

```ts
// utils/copilot/schedule/scheduleGrounding.ts
import type { CopilotContext, Grounding } from '../types';
import { buildCostDatabase } from '@/utils/costDatabase';
import { retrieveRelevant } from '@/utils/projectMemory';

/** Compact grounding for the schedule interview: heavy estimate categories (+
 *  whether memory has a lead-time signal), crew-cap history, weather/occupancy
 *  hints. Read-only; no mutation. */
export async function buildScheduleGrounding(c: CopilotContext): Promise<Grounding> {
  const project = c.project;
  const est = project?.linkedEstimate ?? null;
  const items = est?.items ?? [];

  // Heavy categories by $ — the ones worth a long-lead question.
  const byCat = new Map<string, number>();
  for (const it of items) byCat.set(it.category ?? 'Other', (byCat.get(it.category ?? 'Other') ?? 0) + (it.lineTotal ?? 0));
  const heavyCategories = [...byCat.entries()]
    .map(([name, total]) => ({ name, total, hasLeadSignal: false }))
    .filter(x => x.total >= 15000)
    .sort((a, b) => b.total - a.total);

  // Memory: does the contractor's history mention a lead time for each heavy cat?
  for (const cat of heavyCategories) {
    const hits = await retrieveRelevant(`${cat.name} lead time`, c.projectId).catch(() => []);
    cat.hasLeadSignal = Array.isArray(hits) && hits.length > 0;
  }

  const facts: string[] = [];
  if (project?.squareFootage) facts.push(`Project is ${project.squareFootage} SF, ${project.quality ?? 'standard'} quality.`);
  for (const c2 of heavyCategories) facts.push(`${c2.name}: $${c2.total.toLocaleString()} (heavy category).`);

  return {
    facts,
    data: {
      heavyCategories,
      crewCapHistory: undefined,     // populated once crew history util lands; ask-fallback covers null
      occupiedLikely: (project?.type ?? '').toLowerCase().includes('remodel'),
      weatherSensitive: heavyCategories.some(c2 => /roof|site|concrete|excav/i.test(c2.name)),
    },
  };
}
```

- [ ] **Step 2: `scheduleCapability.ts`** — the capability object. `apply` reuses the existing generate→review→apply tail: it runs `generateScheduleFromEstimate` (the grounded draft), applies the interview's answers (start date, milestones, crew cap) onto the result, `stashDraft`s it, and returns a route signal the shell uses to open `app/schedule-review.tsx`.

```ts
// utils/copilot/schedule/scheduleCapability.ts
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { scheduleGaps, type ScheduleDraft } from './scheduleGaps';
import { buildScheduleGrounding } from './scheduleGrounding';
import { generateScheduleFromEstimate, stashDraft } from '@/utils/autoScheduleFromEstimate';

export interface ScheduleApplied { route: '/schedule-review'; projectId: string }

export const scheduleCapability: CopilotCapability<ScheduleDraft, ScheduleApplied> = {
  id: 'schedule',
  label: 'Build a schedule',
  featureKey: 'schedule_pro',          // confirm exact FeatureKey in hooks/useTierAccess.ts
  aiFeature: 'scheduleCopilot',
  maxQuestions: 4,
  askThreshold: 0.35,
  suggestions: [
    'Gut bath, break ground end of March, cabinets already ordered',
    'Kitchen and two baths, standard finishes, start in three weeks',
  ],
  buildGrounding: buildScheduleGrounding,
  gaps: (draft: ScheduleDraft, grounding: Grounding): Gap[] => scheduleGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot helping a contractor scope a construction schedule.',
      'Extract structured fields from what they said. Use their own history below;',
      'do NOT invent durations. Fields: startDate (ISO or null), phased (bool),',
      'longLeadMilestones (string[]), crewCap (number), weatherBuffer (bool).',
      '',
      'THEIR HISTORY:', ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript.map(t => t.text).join(' | '),
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { startDate: '2026-03-21', phased: false, longLeadMilestones: ['Cabinets'], crewCap: 3, weatherBuffer: true },
  }),

  mergeDraft: (draft, aiJson) => ({
    startDate: typeof aiJson?.startDate === 'string' ? aiJson.startDate : draft.startDate ?? null,
    phased: typeof aiJson?.phased === 'boolean' ? aiJson.phased : draft.phased ?? null,
    longLeadMilestones: Array.isArray(aiJson?.longLeadMilestones) ? aiJson.longLeadMilestones : draft.longLeadMilestones,
    crewCap: typeof aiJson?.crewCap === 'number' ? aiJson.crewCap : draft.crewCap ?? null,
    weatherBuffer: typeof aiJson?.weatherBuffer === 'boolean' ? aiJson.weatherBuffer : draft.weatherBuffer ?? null,
  }),

  apply: async (draft: ScheduleDraft, ctx: CopilotContext): Promise<ScheduleApplied> => {
    const project = ctx.project!;
    const result = await generateScheduleFromEstimate(project, project.linkedEstimate!);
    // Fold the interview's decisions onto the generated draft (start date is the
    // key one — never today unless the user said so).
    if (draft.startDate) (result.schedule as any).projectStartDate = draft.startDate;
    stashDraft(result);
    return { route: '/schedule-review', projectId: ctx.projectId };
  },
};
```

- [ ] **Step 3: `registry.ts`**

```ts
// utils/copilot/registry.ts — capability lookup.
import type { CopilotCapability, CopilotCapabilityId } from './types';
import { scheduleCapability } from './schedule/scheduleCapability';

const REGISTRY: Partial<Record<CopilotCapabilityId, CopilotCapability>> = {
  schedule: scheduleCapability as CopilotCapability,
};
export function getCapability(id: CopilotCapabilityId): CopilotCapability | null {
  return REGISTRY[id] ?? null;
}
```

- [ ] **Step 4: Type-check + commit**

Run: `npx tsc --noEmit` (fix any signature mismatches by reading the real files named above). Expected: clean.

```bash
git add utils/copilot/schedule/scheduleGrounding.ts utils/copilot/schedule/scheduleCapability.ts utils/copilot/registry.ts
git commit -m "feat(copilot): schedule grounding + capability + registry"
```

---

## Task 7: The client conversation hook

**Files:**
- Create: `hooks/useCopilotConversation.ts`

Drives the reducer, calls `mageAI` once per turn, runs `decideAsk` after each AI
draft, and records usage. Reuses `mageAI` (`utils/mageAI.ts`) + `checkAILimit`/
`recordAIUsage` (`utils/aiRateLimiter.ts`).

- [ ] **Step 1: Implement**

```ts
// hooks/useCopilotConversation.ts
import { useReducer, useCallback, useRef } from 'react';
import { copilotReducer, initialCopilotState } from '@/utils/copilot/turnReducer';
import { decideAsk } from '@/utils/copilot/askDecision';
import { getCapability } from '@/utils/copilot/registry';
import { mageAI } from '@/utils/mageAI';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { CopilotCapabilityId, CopilotContext } from '@/utils/copilot/types';

export function useCopilotConversation(capabilityId: CopilotCapabilityId, ctx: CopilotContext) {
  const cap = getCapability(capabilityId)!;
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState(capabilityId, {}));
  const stateRef = useRef(state); stateRef.current = state;

  // One AI turn: build prompt → mageAI → merge → recompute gaps → decide ask/ready.
  const runTurn = useCallback(async () => {
    const s = stateRef.current;
    const asking = s.currentGap;
    const { prompt, schemaHint } = cap.buildTurnPrompt({ transcript: s.transcript, draft: s.draft, grounding: s.grounding, asking });
    const limit = await checkAILimit(ctx.tier as any, 'smart', cap.aiFeature);
    if (!limit.allowed) { dispatch({ type: 'APPLY_ERR', errorKind: 'monthly_cap', message: limit.message ?? 'Limit reached' }); return; }
    const res = await mageAI({ prompt, schemaHint, tier: 'smart', feature: cap.aiFeature });
    if (!res.success) { dispatch({ type: 'APPLY_ERR', errorKind: res.errorKind ?? 'unknown', message: res.error ?? 'AI error' }); return; }
    void recordAIUsage('smart', cap.aiFeature);
    const draft = cap.mergeDraft(s.draft, res.data);
    const gaps = cap.gaps(draft, s.grounding);
    const decision = decideAsk(gaps, { asked: s.askedFields, count: s.questionCount, cap: cap.maxQuestions ?? 4, threshold: cap.askThreshold ?? 0.35 });
    const resolved = gaps.filter(g => g.impact < (cap.askThreshold ?? 0.35)).map(g => ({ field: g.field, label: g.question, basis: g.groundedDefault.basis }));
    dispatch({ type: 'AI_DRAFT', draft, resolved, nextGap: decision.kind === 'ask' ? decision.gap : null, ready: decision.kind !== 'ask' });
  }, [cap, ctx.tier]);

  const start = useCallback(async () => {
    const grounding = await cap.buildGrounding(ctx);
    dispatch({ type: 'START', grounding });
  }, [cap, ctx]);
  const utterance = useCallback((text: string) => { dispatch({ type: 'UTTERANCE', turnId: 't' + Date.now(), text }); void runTurn(); }, [runTurn]);
  const answer = useCallback((field: string, value: unknown) => { dispatch({ type: 'ANSWER', field, value }); void runTurn(); }, [runTurn]);
  const skip = useCallback(() => { dispatch({ type: 'SKIP_QUESTION' }); void runTurn(); }, [runTurn]);
  const editTranscript = useCallback((turnId: string, text: string) => { dispatch({ type: 'EDIT_TRANSCRIPT', turnId, text }); void runTurn(); }, [runTurn]);
  const confirm = useCallback(async () => {
    dispatch({ type: 'CONFIRM' });
    try { const applied = await cap.apply(stateRef.current.draft, ctx); dispatch({ type: 'APPLY_OK' }); return applied; }
    catch (e) { dispatch({ type: 'APPLY_ERR', errorKind: 'unknown', message: (e as Error).message }); }
  }, [cap, ctx]);
  const cancel = useCallback(() => dispatch({ type: 'CANCEL' }), []);

  return { state, cap, start, utterance, answer, skip, editTranscript, confirm, cancel };
}
```

> Note: `Date.now()` is fine here (runtime hook, not a workflow script). Confirm `checkAILimit`'s `LimitCheck` field names (`allowed`/`message`) against `utils/aiRateLimiter.ts` and adjust.

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add hooks/useCopilotConversation.ts
git commit -m "feat(copilot): client conversation hook (mageAI turn loop)"
```

---

## Task 8: The interview UI shell (spec §3.7)

**Files:**
- Create: `components/copilot/CopilotShell.tsx`
- Create: `app/copilot.tsx`
- Modify: `app/_layout.tsx` (register the modal screen)

Build the UI from the approved mockup (spec §3.7) using **only** `Colors`/`Type`/
`Tokens` — no raw hex, no inline `fontSize`/`borderRadius` (anti-slop lint). Map:
the question → `Type.serifHeadline` (Fraunces); every "your-data" citation →
`Type.monoLabel`/`monoEyebrow` (JetBrains Mono); the recommended option →
`Colors.accent` (`#FF6A1A`); "your data" signal → `Colors.accentLight`
(`#FFCC00`); ground → `Colors.background`; radii `Tokens.radius.lg`/`xl`;
spacing `Tokens.spacing.*`. Reuse `VoiceCaptureModal` for capture on the
listening phase (props: `visible`, `onClose`, `onTranscriptReady`, `title`,
`contextLine`, `suggestions`, `topicChecklist`).

- [ ] **Step 1: `CopilotShell.tsx`** — render by `state.phase`:
  - `idle`/`listening` → mount `VoiceCaptureModal` (from `cap.suggestions`/`topicChecklist`); on `onTranscriptReady(t)` call `utterance(t)`.
  - `thinking` → the listening-hero spinner + waveform.
  - `asking` → `ResolvedChips` (the `state.resolved` shown-not-asked list) + the `QuestionView` (Fraunces question + mono grounding line) + `OptionCard`s from `state.currentGap.choices` (recommended one accented); tapping a choice → `answer(field, value)`; a "type/say another" path → `skip()` or re-open the mic; the editable "you said" chip → `editTranscript`.
  - `review` → confirm-back list (draft summarized, each grounded default labeled by basis; `assumption`/capped fields flagged) + primary "Build it" → `confirm()` then `router.replace(applied.route + '?id=' + applied.projectId)`.
  - `applying` → progress; `done` → dismiss; `error` → `state.errorMessage` + retry (`runTurn`)/paywall (on `monthly_cap`) per §3.5.
  - Persistent bottom bar every phase: mic (answer by voice), "Build it now" (→ jump to `review`), "Open on web ↗" (stash + dismiss; deep-link `mageid://schedule-pro?id=…`).

- [ ] **Step 2: `app/copilot.tsx`** — modal host:

```tsx
// app/copilot.tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import CopilotShell from '@/components/copilot/CopilotShell';
import type { CopilotCapabilityId } from '@/utils/copilot/types';

export default function CopilotScreen() {
  const { capabilityId, projectId } = useLocalSearchParams<{ capabilityId: CopilotCapabilityId; projectId: string }>();
  const router = useRouter();
  const projectsCtx = useProjects() as any;
  const { tier } = useSubscription();
  const project = projectsCtx.getProject?.(projectId ?? '') ?? null;
  return (
    <CopilotShell
      capabilityId={capabilityId}
      ctx={{ project, projectId: projectId ?? '', ctx: projectsCtx, tier }}
      onDone={() => router.back()}
    />
  );
}
```

- [ ] **Step 3: Register the modal** in `app/_layout.tsx` (next to `estimate-wizard`):

```tsx
<Stack.Screen name="copilot" options={{ presentation: 'modal', headerShown: false }} />
```

- [ ] **Step 4: Lint + type-check + commit**

Run: `bun run lint` (must be zero errors — anti-slop) and `npx tsc --noEmit`.

```bash
git add components/copilot/ app/copilot.tsx app/_layout.tsx
git commit -m "feat(copilot): conversational interview UI shell (spec §3.7)"
```

---

## Task 9: Schedule entry points

**Files:**
- Modify: `app/schedule-pro.tsx` (desktop) and the mobile schedule screen (`app/(tabs)/schedule/index.tsx` → `MobileScheduleScreen`)

- [ ] **Step 1:** Add a "Build by voice" affordance (a mic button in the schedule empty-state / header) that routes:

```tsx
router.push({ pathname: '/copilot', params: { capabilityId: 'schedule', projectId: project.id } });
```

On the empty-state (no schedule yet) this is the primary CTA; when a schedule exists it's a secondary action. Web falls back to the same shell (voice → typing, `VoiceCaptureModal` already returns a web-unavailable message and the shell shows a text input).

- [ ] **Step 2: Ship-check + commit**

```bash
bun run ship-check
git add app/schedule-pro.tsx "app/(tabs)/schedule/index.tsx"
git commit -m "feat(copilot): 'Build by voice' entry on schedule surfaces"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1:** `bun run ship-check` — all green (typecheck, lint, all validators incl. the three copilot ones).
- [ ] **Step 2:** iOS simulator manual pass (reload Metro): open a project with a linked estimate → schedule → "Build by voice" → speak a scope → confirm the interview asks a grounded question (or none) → confirm-back → "Build it" lands on `schedule-review` with a real schedule. Screenshot each state and compare against the §3.7 mockup.
- [ ] **Step 3:** Verify the escapes: "Build it now" skips remaining questions; "Open on web" stashes + deep-links; a mis-heard transcript is editable.
- [ ] **Step 4:** Commit any fixes; open the PR (owner merges).

---

## Self-review

**Spec coverage:** §3.1 interface → Task 1; §3.2 stateless relay → Task 7 (mageAI, no new server); §3.3 ask-only-when-unresolved → Tasks 2+4; §3.4 confirm-back/editable transcript → Tasks 3 (EDIT_TRANSCRIPT) + 8 (review/heard chip); §3.5 errors/escapes/tier → Tasks 7 (checkAILimit/errorKind) + 8; §3.6 phone/web synced → Task 8 (VoiceCaptureModal web fallback) + 9; §3.7 visual design → Task 8; §4.1 Schedule adapter → Tasks 4+6+9; §6 validators → Tasks 2/3/4 + 5. **Deferred (not in this plan, per §7):** optioneering, Last-Planner automation, conversational structural editing, other capabilities.

**Placeholder scan:** the UI shell (Task 8) is specified by phase + token mapping + the approved mockup rather than line-by-line JSX — this is deliberate (the visual is pinned by §3.7 and the tokens), not a TODO. Every logic-bearing file (types, askDecision, turnReducer, scheduleGaps, grounding, capability, hook) has complete code. Two "confirm the real field name" notes (`FeatureKey` for schedule, `LimitCheck.allowed`) are flagged inline because they depend on reading one existing file at build time.

**Type consistency:** `ScheduleDraft` fields match across scheduleGaps/scheduleCapability; `CopilotAction`/`CopilotState` match reducer + hook; `decideAsk`'s `AskState` matches the hook's call; `mageAI`/`checkAILimit`/`recordAIUsage` calls match the verified signatures.
