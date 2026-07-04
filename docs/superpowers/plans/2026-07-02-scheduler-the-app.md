# Scheduler v1 — "Builds Itself + Explains Itself" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn MAGE's already-built generative scheduler into an explainable, reviewable hero — every AI-generated task explains *why* (sequencing + duration basis), the GC reviews/edits/regenerates before it commits, and the already-wired copilot/undo/drag-deps get pure-fn test coverage and consistent reason-surfacing.

**Architecture:** This is a *surface-explain-and-harden* effort, NOT a rebuild — verified against code 2026-07-02: generation, the NL copilot (`aiAskSchedule`/`aiDelayImpact`/`aiExplainCriticalPath`), undo/redo (`commit`), and drag-to-create-deps are all already built and wired. The real gap is (1) generated tasks carry no `rationale`/`assumption`, (2) generation is fire-and-apply with no review step, and (3) the built pieces lack pure-fn tests and the copilot's reasons aren't consistently shown. We add a `rationale`/`assumption` field to the generator's schema + a review-and-refine screen, extract the undo/redo logic into a testable pure reducer, and add validation scripts.

**Tech Stack:** React Native/Expo, TypeScript strict, zod, mageAI (Claude); no jest — pure-fn `scripts/validate-*.ts` (RN-free modules only, run under `bun`) + `npx tsc --noEmit`; verify via `bun run ship-check`.

**Key constraint (learned in thread 1):** AsyncStorage/react-native imports crash `bun`. Pure logic that needs tests MUST live in RN-free modules (mirror `utils/aiRateLimiterCore.ts`). That's why Tasks 1 and 3 extract pure modules.

---

## File map

| File | Create/Modify | Responsibility |
|---|---|---|
| `utils/scheduleGenSchema.ts` | **Create** (RN-free) | The generator's zod schema + phases + pure `normalizeGeneratedTask` — extracted so the schema (incl. new `rationale`/`assumption`) is unit-testable. |
| `utils/autoScheduleFromEstimate.ts` | Modify | Import schema from the new module; add `rationale`/`assumption` to the prompt + carry them onto the built `ScheduleTask`s. |
| `types/index.ts` | Modify (~466) | Add `rationale?: string` + `assumption?: boolean` to `ScheduleTask`. |
| `utils/scheduleHistory.ts` | **Create** (RN-free) | Pure undo/redo reducer (`pushHistory`/`undo`/`redo`) over `{past, present, future}`, bounded depth. |
| `app/schedule-pro.tsx` | Modify (~160, ~509) | Refactor `commit`/`handleUndo`/`handleRedo` onto the pure reducer; route copilot apply paths through `commit`. |
| `app/schedule-review.tsx` | **Create** | Review-and-refine draft screen: list generated tasks grouped by phase, show each `rationale`, flag `assumption` tasks, accept / edit / regenerate-phase, then commit. |
| `app/generative-setup.tsx` | Modify (~115) | Route schedule generation to the review screen instead of fire-and-apply `updateProject`. |
| `utils/aiRateLimiterCore.ts` | Modify (~28, ~67) | Add a `scheduleCopilot` feature key so copilot calls are metered consistently. |
| `components/schedule/AIAssistantPanel.tsx` | Modify | Surface the copilot's `explanation`/`answer` reason text on every what-if/edit; meter via `scheduleCopilot`. |
| `scripts/validate-schedule-gen-schema.ts` | **Create** | Assert schema requires `rationale`, accepts `assumption`, and `normalizeGeneratedTask` fills defaults. |
| `scripts/validate-schedule-history.ts` | **Create** | Assert push/undo/redo/bound/redo-cleared-on-new-edit. |
| `scripts/validate-schedule-depcycle.ts` | **Create** | Assert `wouldCreateCycle` rejects a cycle-forming drag, accepts a valid one. |
| `scripts/validate-schedule-copilot-meter.ts` | **Create** | Assert `evaluateLimit` gates `scheduleCopilot` per tier. |
| `package.json` | Modify | Register the 4 new `test:*` scripts + add them to `ship-check`. |

---

## Task 1: Explainable generation — `rationale` + `assumption`

**Files:**
- Create: `utils/scheduleGenSchema.ts`
- Create (test): `scripts/validate-schedule-gen-schema.ts`
- Modify: `types/index.ts` (~466), `utils/autoScheduleFromEstimate.ts` (12-25, 83, 123-140), `package.json`

This is the moat. The generator (`autoScheduleFromEstimate.ts`) currently produces tasks with no reasoning; `autoScheduleSchema` (lines 12-25) has no `rationale`/`assumption`. We extract the schema to an RN-free module, add the two fields, and prompt Claude to fill them.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-schedule-gen-schema.ts`:

```ts
import { autoScheduleTaskSchema, normalizeGeneratedTask } from '../utils/scheduleGenSchema';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule generation schema validation:');

const full = {
  id: 't1', name: 'Framing', phase: 'Framing', duration: 5,
  predecessorIds: ['t0'], isMilestone: false, isCriticalPath: true,
  crewSize: 4, wbs: '3.1', rationale: 'Framing before drywall; 5 days from 1,800 SF at crew rate.',
  assumption: false, linkedCategories: ['lumber'],
};
expect('accepts a full task with rationale', autoScheduleTaskSchema.safeParse(full).success, true);

const noRationale = { ...full } as any; delete noRationale.rationale;
expect('rejects a task missing rationale', autoScheduleTaskSchema.safeParse(noRationale).success, false);

const noAssumption = { ...full } as any; delete noAssumption.assumption;
expect('assumption is optional', autoScheduleTaskSchema.safeParse(noAssumption).success, true);

// normalize fills defaults so a lenient model response never crashes the build
const normalized = normalizeGeneratedTask({ id: 't2', name: 'Roofing', phase: 'Roofing', duration: 3, predecessorIds: [] }, 1);
expect('normalize defaults rationale to ""', normalized.rationale, '');
expect('normalize defaults assumption to true when no basis given', normalized.assumption, true);
expect('normalize clamps crewSize into 1..8', normalized.crewSize, 2);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `bun run scripts/validate-schedule-gen-schema.ts`
Expected: FAIL — `Cannot find module '../utils/scheduleGenSchema'`.

- [ ] **Step 3: Create the RN-free schema module**

Create `utils/scheduleGenSchema.ts`:

```ts
import { z } from 'zod';

export const SCHEDULE_PHASES = [
  'Site Work', 'Demo', 'Foundation', 'Framing', 'Roofing',
  'MEP', 'Plumbing', 'Electrical', 'HVAC', 'Insulation',
  'Drywall', 'Interior', 'Finishes', 'Landscaping', 'Inspections', 'General',
] as const;

/** One generated task. `rationale` (required) is the explainability moat:
 *  a one-line reason for the task's sequencing + duration basis. `assumption`
 *  (optional) flags a task whose duration/sequence was guessed rather than
 *  derived from cost-DB / crew rates, so the review UI can highlight it. */
export const autoScheduleTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  phase: z.string(),
  duration: z.number(),
  predecessorIds: z.array(z.string()),
  isMilestone: z.boolean(),
  isCriticalPath: z.boolean(),
  crewSize: z.number(),
  wbs: z.string(),
  rationale: z.string(),
  assumption: z.boolean().optional(),
  linkedCategories: z.array(z.string()).optional(),
});

export const autoScheduleSchema = z.object({
  tasks: z.array(autoScheduleTaskSchema),
});

export type GeneratedTask = {
  id: string; name: string; phase: string; duration: number;
  predecessorIds: string[]; isMilestone: boolean; isCriticalPath: boolean;
  crewSize: number; wbs: string; rationale: string; assumption: boolean;
  linkedCategories: string[];
};

/** Lenient normalizer — a model response may omit fields; fill safe defaults.
 *  A task with no rationale/basis is treated as an `assumption` so review flags it. */
export function normalizeGeneratedTask(t: any, idx: number): GeneratedTask {
  const rationale = typeof t?.rationale === 'string' ? t.rationale : '';
  return {
    id: t?.id || `t${idx + 1}`,
    name: t?.name || t?.title || `Task ${idx + 1}`,
    phase: (SCHEDULE_PHASES as readonly string[]).includes(t?.phase) ? t.phase : 'General',
    duration: typeof t?.duration === 'number' ? t.duration : 3,
    predecessorIds: Array.isArray(t?.predecessorIds) ? t.predecessorIds : [],
    isMilestone: !!t?.isMilestone,
    isCriticalPath: !!t?.isCriticalPath,
    crewSize: typeof t?.crewSize === 'number' ? Math.min(8, Math.max(1, Math.round(t.crewSize))) : 2,
    wbs: t?.wbs || `${idx + 1}.0`,
    rationale,
    assumption: typeof t?.assumption === 'boolean' ? t.assumption : rationale.trim() === '',
    linkedCategories: Array.isArray(t?.linkedCategories) ? t.linkedCategories.map((c: any) => String(c).toLowerCase()) : [],
  };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `bun run scripts/validate-schedule-gen-schema.ts`
Expected: PASS — `6 passed, 0 failed`.

- [ ] **Step 5: Add the fields to `ScheduleTask`**

In `types/index.ts`, immediately after `notes: string;` (~line 466):

```ts
  notes: string;
  /** AI-generated one-line reason for this task's sequencing + duration basis.
   *  Populated by the generative scheduler; surfaced in the review screen and
   *  on tap. Distinct from the free-text `notes` field. */
  rationale?: string;
  /** True when the generator guessed the duration/sequence (no cost-DB / crew
   *  basis). Surfaced as a flag in the review screen so the GC can confirm. */
  assumption?: boolean;
```

- [ ] **Step 6: Rewire the generator to the shared schema + fill rationale**

In `utils/autoScheduleFromEstimate.ts`:

(a) Replace the local `SCHEDULE_PHASES` (lines 6-10) and `autoScheduleSchema` (lines 12-25) with an import at the top of the file:

```ts
import { autoScheduleSchema, normalizeGeneratedTask, SCHEDULE_PHASES } from '@/utils/scheduleGenSchema';
```

(b) In the prompt (line 83), extend the per-task field spec and add an instruction. Replace instruction line 2 and add a new numbered instruction:

```ts
2. Each task must have: id (string like "t1","t2"), name, phase (one of: ${SCHEDULE_PHASES.join(', ')}), duration (working days, integer), predecessorIds (array of other task ids — FS dependencies), isMilestone (bool), isCriticalPath (bool), crewSize (integer 1-8), wbs (like "1.1","2.3"), rationale (ONE sentence explaining WHY this task is sequenced here and how its duration was derived, e.g. "Framing precedes drywall; 5 days scaled from 1,800 SF at a 4-person crew"), assumption (bool — true if you GUESSED the duration/sequence rather than deriving it from the estimate quantities), linkedCategories (array of estimate category names this task draws from).
```

Add after the existing instruction 8:

```ts
9. Every task MUST include a non-empty rationale. Set assumption:true when the estimate lacks the quantities to size the task and you fell back to a rule of thumb.
```

(c) Replace the normalize block (lines 122-134) with the shared normalizer:

```ts
  // Normalize (shared, testable — utils/scheduleGenSchema.ts)
  const safeTasks = taskArray.map((t: any, idx: number) => normalizeGeneratedTask(t, idx));
```

(d) In the `ScheduleTask` build (starting line 137), carry the new fields onto each built task. Inside the returned object add:

```ts
      rationale: t.rationale,
      assumption: t.assumption,
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Register the test + commit**

In `package.json` add to scripts: `"test:sched-schema": "bun run scripts/validate-schedule-gen-schema.ts"`, and append ` && bun run test:sched-schema` to the `ship-check` script.

```bash
git add utils/scheduleGenSchema.ts scripts/validate-schedule-gen-schema.ts types/index.ts utils/autoScheduleFromEstimate.ts package.json
git commit -m "feat(schedule): explainable generation — rationale + assumption per task"
```

---

## Task 2: Review-and-refine draft screen

**Files:**
- Create: `app/schedule-review.tsx`
- Modify: `app/generative-setup.tsx` (~115-124), `app/_layout.tsx` (register the route)

Today generation is fire-and-apply (`generative-setup.tsx:117-118`: `generateScheduleFromEstimate` → `updateProject`). We insert a review step: the draft is shown grouped by phase, each task's `rationale` visible, `assumption` tasks flagged, with **Accept**, per-task **Edit**, and **Regenerate phase**. Only on Accept does it commit. This is what makes "works without BIM" trustworthy.

- [ ] **Step 1: Build the review screen**

Create `app/schedule-review.tsx`. It receives the generated `AutoScheduleResult` via a module-level handoff (avoid serializing tasks through router params). Add to the top of `utils/autoScheduleFromEstimate.ts`:

```ts
// Ephemeral handoff so the generator screen can pass a draft to the review
// screen without serializing large task arrays through navigation params.
let pendingDraft: AutoScheduleResult | null = null;
export function stashDraft(d: AutoScheduleResult) { pendingDraft = d; }
export function takeDraft(): AutoScheduleResult | null { const d = pendingDraft; pendingDraft = null; return d; }
```

Then the screen:

```tsx
import React, { useMemo, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { Stack, router } from 'expo-router';
import { ChevronLeft, Sparkles, AlertTriangle, RefreshCcw, Check } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { takeDraft, generateScheduleFromEstimate } from '@/utils/autoScheduleFromEstimate';
import type { ScheduleTask } from '@/types';

export default function ScheduleReviewScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { activeProject: project, updateProject } = useProjects();
  const [draft] = useState(() => takeDraft());
  const [tasks, setTasks] = useState<ScheduleTask[]>(draft?.tasks ?? []);
  const [regenerating, setRegenerating] = useState<string | null>(null);

  const byPhase = useMemo(() => {
    const m = new Map<string, ScheduleTask[]>();
    tasks.forEach(task => { const k = task.phase || 'General'; m.set(k, [...(m.get(k) ?? []), task]); });
    return Array.from(m.entries());
  }, [tasks]);

  const assumptionCount = useMemo(() => tasks.filter(x => x.assumption).length, [tasks]);

  const accept = useCallback(() => {
    if (!project || !draft) return;
    updateProject(project.id, { schedule: { ...draft.schedule, tasks } });
    router.replace('/schedule-pro' as any);
  }, [project, draft, tasks, updateProject]);

  const regeneratePhase = useCallback(async (phase: string) => {
    if (!project?.linkedEstimate) return;
    setRegenerating(phase);
    try {
      const fresh = await generateScheduleFromEstimate(project, project.linkedEstimate);
      const freshForPhase = fresh.tasks.filter(x => x.phase === phase);
      setTasks(prev => [...prev.filter(x => x.phase !== phase), ...freshForPhase]);
    } finally {
      setRegenerating(null);
    }
  }, [project]);

  if (!draft) {
    return (
      <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={{ color: t.text, padding: 24 }}>No draft to review. Generate a schedule first.</Text>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 24 }}>
          <Text style={{ color: t.accent }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: t.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={22} color={t.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Sparkles size={16} color={t.accent} strokeWidth={2} />
            <Text style={[styles.title, { color: t.text }]}>Review your schedule</Text>
          </View>
          <Text style={[styles.sub, { color: t.textMuted }]}>
            {tasks.length} tasks · {assumptionCount} assumption{assumptionCount === 1 ? '' : 's'} to confirm
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        {byPhase.map(([phase, phaseTasks]) => (
          <View key={phase} style={[styles.phaseCard, { backgroundColor: t.card, borderColor: t.border }]}>
            <View style={styles.phaseHead}>
              <Text style={[styles.phaseName, { color: t.text }]}>{phase}</Text>
              <TouchableOpacity
                onPress={() => regeneratePhase(phase)}
                disabled={regenerating === phase}
                style={styles.regenBtn}
                accessibilityRole="button"
                accessibilityLabel={`Regenerate ${phase}`}
              >
                <RefreshCcw size={14} color={t.accent} strokeWidth={2} />
                <Text style={{ color: t.accent, fontSize: 12 }}>{regenerating === phase ? 'Regenerating…' : 'Regenerate'}</Text>
              </TouchableOpacity>
            </View>
            {phaseTasks.map(task => (
              <View key={task.id} style={[styles.taskRow, { borderTopColor: t.border }]}>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.taskName, { color: t.text }]}>{task.title}</Text>
                    {task.assumption ? <AlertTriangle size={13} color={t.warning ?? '#c47f17'} strokeWidth={2} /> : null}
                  </View>
                  <Text style={[styles.taskMeta, { color: t.textMuted }]}>{task.durationDays}d · crew {task.crewSize ?? '—'}</Text>
                  {task.rationale ? <Text style={[styles.rationale, { color: t.textMuted }]}>{task.rationale}</Text> : null}
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: t.card, borderTopColor: t.border, paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity onPress={accept} style={[styles.acceptBtn, { backgroundColor: t.accent }]} accessibilityRole="button" accessibilityLabel="Accept schedule">
          <Check size={18} color="#fff" strokeWidth={2.2} />
          <Text style={styles.acceptText}>Use this schedule</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700' },
  sub: { fontSize: 12, marginTop: 2 },
  phaseCard: { borderWidth: 1, borderRadius: 14, marginBottom: 12, overflow: 'hidden' },
  phaseHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12 },
  phaseName: { fontSize: 14, fontWeight: '700' },
  regenBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  taskRow: { flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  taskName: { fontSize: 14, fontWeight: '600' },
  taskMeta: { fontSize: 12, marginTop: 2 },
  rationale: { fontSize: 12, marginTop: 4, fontStyle: 'italic', lineHeight: 16 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  acceptBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 12 },
  acceptText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
```

> Note: match `useProjects`/`useTheme` to the real hook names in this repo. Confirm by grepping `export` in `contexts/ProjectContext.tsx` and `contexts/ThemeContext.tsx` before writing; adjust `activeProject`, `updateProject`, and theme keys (`warning`) to whatever those contexts actually expose. If there is no `warning` theme key, use a literal `'#c47f17'`.

- [ ] **Step 2: Register the route**

In `app/_layout.tsx`, alongside the other `Stack.Screen` declarations, add:

```tsx
<Stack.Screen name="schedule-review" options={{ headerShown: false }} />
```

- [ ] **Step 3: Route generation through review instead of fire-and-apply**

In `app/generative-setup.tsx`, replace the schedule block (lines 115-124):

```tsx
      if (includeSchedule && project.linkedEstimate) {
        try {
          const r = await generateScheduleFromEstimate(project, project.linkedEstimate);
          stashDraft(r);
          scheduleCreated = true;
        } catch (e) {
          scheduleError = e instanceof Error ? e.message : 'Schedule generation failed';
          console.warn('[generative-setup] schedule failed:', scheduleError);
        }
      }
```

Add `stashDraft` to the existing import from `@/utils/autoScheduleFromEstimate`. Then, where the success `result` is shown, make the schedule row's action navigate to review: `router.push('/schedule-review' as any)` when `scheduleCreated`. (Find the result-rendering block below line 126 and add a "Review schedule" button when `result.scheduleCreated`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Manual smoke (documented, not automated — RN UI)**

On web (`bun run start-web`): open a project with a linked estimate → Generative Setup → generate → **Review your schedule** appears, tasks grouped by phase, each showing a rationale line, assumption tasks flagged with a triangle → Regenerate a phase swaps only that phase → **Use this schedule** lands in Schedule Pro with the tasks.

- [ ] **Step 6: Commit**

```bash
git add app/schedule-review.tsx app/generative-setup.tsx app/_layout.tsx utils/autoScheduleFromEstimate.ts
git commit -m "feat(schedule): review-and-refine draft screen (accept/edit/regenerate, rationale + assumption surfaced)"
```

---

## Task 3: Undo/redo — extract a pure reducer + capture copilot edits

**Files:**
- Create: `utils/scheduleHistory.ts`
- Create (test): `scripts/validate-schedule-history.ts`
- Modify: `app/schedule-pro.tsx` (~160, ~509-521), `package.json`

Undo/redo already works (`commit` at ~509 snapshots a bounded-20 history + clears redo). The gaps: the logic is trapped in inline `setHistory`/`setFuture` closures (untestable), and copilot apply paths must be confirmed to route through `commit`. We extract a pure reducer and refactor onto it.

- [ ] **Step 1: Write the failing test**

Create `scripts/validate-schedule-history.ts`:

```ts
import { emptyHistory, pushHistory, undo, redo, type HistoryState } from '../utils/scheduleHistory';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule history reducer validation:');

let s: HistoryState<string> = emptyHistory('A');
s = pushHistory(s, 'B');
s = pushHistory(s, 'C');
expect('present after two pushes', s.present, 'C');
expect('past holds prior states', s.past, ['A', 'B']);
expect('push clears future', s.future.length, 0);

s = undo(s);
expect('undo restores previous present', s.present, 'B');
expect('undo moves present to future', s.future, ['C']);

s = redo(s);
expect('redo re-applies', s.present, 'C');

// a new edit after undo clears redo
s = undo(s);              // present B, future [C]
s = pushHistory(s, 'D');  // new edit
expect('new edit clears future', s.future.length, 0);
expect('present is the new edit', s.present, 'D');

// bounded depth (cap 20): push 25 states, past never exceeds 20
let b: HistoryState<number> = emptyHistory(0);
for (let i = 1; i <= 25; i++) b = pushHistory(b, i, 20);
expect('past bounded to 20', b.past.length, 20);
expect('oldest states dropped', b.past[0], 5);

// undo at the start is a no-op
let e: HistoryState<string> = emptyHistory('only');
const e2 = undo(e);
expect('undo at start is no-op', e2.present, 'only');

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — expect FAIL (module missing)**

Run: `bun run scripts/validate-schedule-history.ts`
Expected: FAIL — `Cannot find module '../utils/scheduleHistory'`.

- [ ] **Step 3: Create the pure reducer**

Create `utils/scheduleHistory.ts`:

```ts
/** Pure, RN-free undo/redo reducer over an immutable present + past/future
 *  stacks. Used by app/schedule-pro.tsx so every mutation is undoable and the
 *  logic is unit-testable under bun (no react-native imports). */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export function emptyHistory<T>(present: T): HistoryState<T> {
  return { past: [], present, future: [] };
}

/** Record a new present. Pushes the old present onto `past` (bounded to `cap`),
 *  clears `future` (a new edit invalidates redo). */
export function pushHistory<T>(s: HistoryState<T>, next: T, cap = 20): HistoryState<T> {
  const past = [...s.past, s.present];
  const trimmed = past.length > cap ? past.slice(past.length - cap) : past;
  return { past: trimmed, present: next, future: [] };
}

export function canUndo<T>(s: HistoryState<T>): boolean { return s.past.length > 0; }
export function canRedo<T>(s: HistoryState<T>): boolean { return s.future.length > 0; }

export function undo<T>(s: HistoryState<T>): HistoryState<T> {
  if (s.past.length === 0) return s;
  const present = s.past[s.past.length - 1];
  return { past: s.past.slice(0, -1), present, future: [s.present, ...s.future] };
}

export function redo<T>(s: HistoryState<T>): HistoryState<T> {
  if (s.future.length === 0) return s;
  const present = s.future[0];
  return { past: [...s.past, s.present], present, future: s.future.slice(1) };
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `bun run scripts/validate-schedule-history.ts`
Expected: PASS — `10 passed, 0 failed`.

- [ ] **Step 5: Refactor `schedule-pro.tsx` onto the reducer**

Read the current `commit` (~509-521), `handleUndo`, and `handleRedo` first. Replace the two `useState` stacks (`history`/`future`, ~160) and the three functions so the past/future stacks come from the pure reducer. Keep the same external behavior (`commit(producer)`, `handleUndo`, `handleRedo`, `schedulePersist(next)`, button `disabled` from `canUndo`/`canRedo`). Import at top:

```ts
import { emptyHistory, pushHistory, undo as histUndo, redo as histRedo, canUndo, canRedo, type HistoryState } from '@/utils/scheduleHistory';
```

Model `workingTasks` as the reducer's `present`. `commit` becomes:

```ts
  const commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => {
    setHist(h => {
      const next = producer(h.present);
      schedulePersist(next);
      return pushHistory(h, next, 20);
    });
  }, [schedulePersist]);
```

where `const [hist, setHist] = useState<HistoryState<ScheduleTask[]>>(() => emptyHistory(initialTasks));` and `const workingTasks = hist.present;`. `handleUndo`/`handleRedo`:

```ts
  const handleUndo = useCallback(() => setHist(h => { const n = histUndo(h); schedulePersist(n.present); return n; }), [schedulePersist]);
  const handleRedo = useCallback(() => setHist(h => { const n = histRedo(h); schedulePersist(n.present); return n; }), [schedulePersist]);
```

Update button `disabled` props (~1362-1363) to `!canUndo(hist)` / `!canRedo(hist)`. Update `applyWeatherReschedule` (~565-570) to push through the reducer: replace the manual `setHistory`/`setFuture`/`setWorkingTasks` trio with `setHist(h => pushHistory(h, next, 20))` then persist.

- [ ] **Step 6: Confirm copilot edits are captured**

Verify the `AIAssistantPanel` props passed from `schedule-pro.tsx` (`onApplyPatch`, `onApplyBulkPatches`) call `handleEdit`/`commit` (not a raw `setWorkingTasks`). If any path sets tasks directly, route it through `commit` so AI edits are undoable. (Grep `onApplyPatch=` and `onApplyBulkPatches=` in `schedule-pro.tsx`.)

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Register test + commit**

Add `"test:sched-history": "bun run scripts/validate-schedule-history.ts"` to `package.json` scripts and append ` && bun run test:sched-history` to `ship-check`.

```bash
git add utils/scheduleHistory.ts scripts/validate-schedule-history.ts app/schedule-pro.tsx package.json
git commit -m "refactor(schedule): pure undo/redo reducer + capture copilot edits"
```

---

## Task 4: Dependency cycle-guard coverage

**Files:**
- Create (test): `scripts/validate-schedule-depcycle.ts`
- Modify: `package.json`

Drag-to-create-deps is already wired (`InteractiveGantt` fires `onDependencyCreate` → `schedule-pro.tsx:718 handleDependencyCreate` persists, guarded by `wouldCreateCycle`). No re-implementation — we lock the guard behind a test so a refactor can't silently break it.

- [ ] **Step 1: Confirm `wouldCreateCycle`'s real signature**

Read `utils/cpm.ts` for `export function wouldCreateCycle(...)`. Note the exact params — the guard is called two ways in the code: `wouldCreateCycle(tasks, task.id, depId)` (GridPane:631) and `wouldCreateCycle(tasks, target, prev.sourceTaskId)` (InteractiveGantt:516). Match the test to the real signature `(tasks, toId, fromId)`.

- [ ] **Step 2: Write the test**

Create `scripts/validate-schedule-depcycle.ts`:

```ts
import { wouldCreateCycle } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule dependency cycle-guard validation:');

// t2 depends on t1 (t1 -> t2). Adding t2 -> t1 would form a cycle.
const base = (deps: Record<string, string[]>): ScheduleTask[] =>
  ['t1', 't2', 't3'].map(id => ({
    id, title: id, phase: 'General', durationDays: 2, startDay: 1, progress: 0,
    crew: '', dependencies: deps[id] ?? [], notes: '', status: 'not_started',
  } as unknown as ScheduleTask));

const tasks = base({ t2: ['t1'], t3: ['t2'] });

// Adding edge from=t2 to=t1 (t1 already reaches t2 via t2->t1? here t2 depends on t1)
expect('cycle: t3 -> t1 (t1->t2->t3 already) is rejected', wouldCreateCycle(tasks, 't1', 't3'), true);
expect('valid: t1 -> t3 is accepted', wouldCreateCycle(tasks, 't3', 't1'), false);
expect('self-link is rejected', wouldCreateCycle(tasks, 't1', 't1'), true);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
```

> Adjust the expected booleans to `wouldCreateCycle`'s actual `(tasks, toId, fromId)` direction after reading it in Step 1 — the semantics (does adding `fromId → toId` close a loop?) must match. Keep the three cases: a genuine cycle → true, a valid forward edge → false, a self-link → true.

- [ ] **Step 3: Run it — expect PASS (guard already exists)**

Run: `bun run scripts/validate-schedule-depcycle.ts`
Expected: PASS — `3 passed, 0 failed`. If a case fails, the expected value was wrong for the real signature (fix the test, not the guard).

- [ ] **Step 4: Register test + commit**

Add `"test:sched-depcycle": "bun run scripts/validate-schedule-depcycle.ts"` and append ` && bun run test:sched-depcycle` to `ship-check`.

```bash
git add scripts/validate-schedule-depcycle.ts package.json
git commit -m "test(schedule): lock the dependency cycle-guard behavior"
```

---

## Task 5: Copilot — meter + always surface the reason

**Files:**
- Create (test): `scripts/validate-schedule-copilot-meter.ts`
- Modify: `utils/aiRateLimiterCore.ts` (~28, ~67), `components/schedule/AIAssistantPanel.tsx`, `package.json`

The copilot exists (`aiAskSchedule`, `aiDelayImpact` → `{explanation}`, `aiExplainCriticalPath`, `aiBulkEdit`). Two gaps: it isn't metered under its own key, and reason text isn't shown consistently on every what-if/edit. We add a `scheduleCopilot` feature key and ensure the panel renders `explanation`/`answer`.

- [ ] **Step 1: Write the failing meter test**

Create `scripts/validate-schedule-copilot-meter.ts` (mirror `scripts/validate-activation-gating.ts`):

```ts
import { evaluateLimit } from '../utils/aiRateLimiterCore';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else    { fail++; console.log('  ✗', name, '\n      got:', got, '\n      want:', want); }
}

console.log('\nschedule copilot metering validation:');

// scheduleCopilot — free tier, lifetime cap 3 (marquee AI, matches scheduleBuilder tier)
expect('copilot free 0/3 → allowed', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 0).allowed, true);
expect('copilot free 3/3 → blocked', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 3).allowed, false);
expect('copilot free 3/3 → lifetime_cap', evaluateLimit('free', 'smart', 'scheduleCopilot', 0, 0, 3).reason, 'lifetime_cap');
// pro tier is not capped by lifetime trials
expect('copilot pro 5/… → allowed', evaluateLimit('pro', 'smart', 'scheduleCopilot', 0, 0, 5).allowed, true);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — expect FAIL (key unknown)**

Run: `bun run scripts/validate-schedule-copilot-meter.ts`
Expected: FAIL — `scheduleCopilot` not a known feature (or an assertion fail).

- [ ] **Step 3: Add the feature key**

In `utils/aiRateLimiterCore.ts`, add to the feature-key union (~line 28, next to `scheduleBuilder`):

```ts
  | 'scheduleCopilot'   // free: 3 lifetime trials (NL what-if / edit copilot)
```

and to the config map (~line 67, next to `scheduleBuilder`):

```ts
  scheduleCopilot:    { tier: 'smart', freeLifetimeCap: 3, displayName: 'Schedule Copilot' },
```

- [ ] **Step 4: Run it — expect PASS**

Run: `bun run scripts/validate-schedule-copilot-meter.ts`
Expected: PASS — `4 passed, 0 failed`.

- [ ] **Step 5: Meter copilot calls + surface reasons**

In `components/schedule/AIAssistantPanel.tsx`: before invoking `aiAskSchedule`/`aiDelayImpact`/`aiBulkEdit`, gate with `checkAILimit('scheduleCopilot')` and on success call `recordAIUsage('scheduleCopilot')` — mirror an existing `checkAILimit(`/`recordAIUsage(` call site (grep for one in `app/`). Ensure the rendered response always shows the reason string: for `aiDelayImpact` render `explanation` + the `projectFinishDelta` (e.g. "Finish slips 2 days"); for `aiAskSchedule` render `answer`; for an applied edit, show the model's one-line reason before the Apply/undo affordance. Do not mutate on a what-if question (preview only) — confirm the existing code path already treats `aiAskSchedule`/`aiDelayImpact` as read-only.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Register test + commit**

Add `"test:sched-copilot": "bun run scripts/validate-schedule-copilot-meter.ts"` and append ` && bun run test:sched-copilot` to `ship-check`.

```bash
git add scripts/validate-schedule-copilot-meter.ts utils/aiRateLimiterCore.ts components/schedule/AIAssistantPanel.tsx package.json
git commit -m "feat(schedule): meter the NL copilot + always surface its reasoning"
```

---

## Task 6: Ship-check gate + full type-check

**Files:**
- Modify: `package.json` (verify)

- [ ] **Step 1: Confirm all four validators are wired into `ship-check`**

Read `package.json` `scripts`. Confirm `ship-check` runs `test:sched-schema`, `test:sched-history`, `test:sched-depcycle`, and `test:sched-copilot` (added in Tasks 1/3/4/5).

- [ ] **Step 2: Run the whole gate**

Run: `bun run ship-check`
Expected: all validate scripts print `… passed, 0 failed`; the run exits 0.

- [ ] **Step 3: Full type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 4: Commit any package.json cleanup**

```bash
git add package.json
git commit -m "chore(schedule): wire scheduler validators into ship-check"
```

---

## Notes for the executor
- **Extend, don't rebuild.** Generation, copilot, undo/redo, and drag-deps already exist and are wired. If a step looks like it's re-implementing working code, stop and re-read the current file — the task is gap-closing.
- **Confirm hook/theme/context names** (`useProjects`/`activeProject`/`updateProject`, `useTheme` keys) against the real contexts before writing Task 2's screen; the code block uses representative names.
- **Pure logic only in RN-free modules** (`scheduleGenSchema.ts`, `scheduleHistory.ts`) — anything importing react-native/AsyncStorage will crash `bun`. That boundary is why Tasks 1 and 3 extract modules.
- **No over-promised ROI** in any copilot/review UI string (spec decision 6): reasons explain, they don't promise savings.
