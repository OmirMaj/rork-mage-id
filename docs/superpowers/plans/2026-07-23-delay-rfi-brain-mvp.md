# Delay Cascade + RFI Brain MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Delay Cascade + RFI Brain MVP — (1) a **Schedule impact** card on the daily report: one tap reads the `issuesAndDelays` free text into `{task, days, quote}` confirm rows, previews the downstream CPM ripple (what slides, what turns critical, how the finish moves) through the existing copilot diff view, and applies the reflow on confirm; and (2) an **RFI brain** on `app/rfi.tsx`: a "MAGE suggests" button that drafts a response from how this project's records answered similar questions (cited), plus an overdue banner and a "blocks a critical-path task" warning for task-linked RFIs.

**Architecture:** AI proposes, the user confirms, the engine computes. A pure engine (`utils/delayScan/*`): `buildDelayPrompt` + `coerceDelayResult` handle the single fast-tier AI call (the AI's ONLY job is reading `issuesAndDelays` into `{taskTitleGuess, deltaDays, quote}`); `matchTaskByTitle` pre-selects the confirm row's task strictly (null on ambiguity — the user picks); `rfiBlockStatus` is a null-safe pure wrapper over `runCpm`. Every schedule number comes from the existing, already-validated copilot pipeline used **verbatim**: `interpretScheduleOps` → `ScheduleDiffView` (which internally runs interpret + `runCpm` ×2 + `diffSchedule`) → `applyToProjectSchedule` + `buildScheduleFromTasks` (the mobile `persistEditedTasks` pattern) → `updateProject`. The RFI suggest reuses `extractMemoryDocs` + `answerFromMemorySemantic` exactly as `app/project-memory.tsx` does.

**Tech Stack:** TypeScript (strict), React Native / Expo Router, bun. No jest — one pure-function validator (`scripts/validate-delay-rfi.ts`) chained into `ship-check`. AI via the existing `mageAI` relay (`feature: 'delayScan'`, fast tier, standard daily quota — free tier included); the RFI suggest rides the existing project-memory path (smart tier via `answerFromMemorySemantic`, no new feature key — same as `app/project-memory.tsx`).

**Branch:** `claude/delay-rfi-brain` (already checked out, off `main`).

**Ship boundary:** Everything here is OTA-safe: pure JS/TS, reuses the existing `ai` + project-memory edge functions (no server change — `delayScan` is not `proOnly`, so the relay's per-feature allowlist does not need an entry; `scripts/validate-ai-feature-gating.ts` only requires relay entries for `proOnly` features). **No migration, no type-schema change**: nothing is persisted on the daily report — the confirm rows are ephemeral and the applied result lives in `project.schedule`, which already persists through `updateProject`. No new AsyncStorage keys (the scan cache rides the existing `mage_ai_cache_` prefix), so no `LOCAL_USER_CACHE_KEYS` change. **Merge note:** the unmerged `claude/profit-leak` branch also adds an `AIFeature` after `'projectReport'` and a card after the Issues & Delays section — both are trivial adjacent-line merge conflicts, not logic conflicts.

---

## File Structure

**Create (pure engine):**
- `utils/delayScan/delayPrompt.ts` — `buildDelayPrompt(issuesText, taskTitles)`, `coerceDelayResult(raw): DelayScanResult`, `hashDelayText`, `DELAY_SCHEMA_HINT`, `DelayScanResult`/`DelayHit`, `MAX_DELAY_HITS`, `MAX_DELTA_DAYS`.
- `utils/delayScan/matchTask.ts` — `matchTaskByTitle(guess, tasks): ScheduleTask | null`.
- `utils/delayScan/rfiBlocking.ts` — `rfiBlockStatus(rfi, schedule, cpmOptions): RfiBlockStatus`.

**Create (validator):**
- `scripts/validate-delay-rfi.ts` — ALL three modules tested in this ONE file, built up progressively across Tasks 1–3.

**Modify:**
- `utils/aiRateLimiterCore.ts` — `'delayScan'` in the `AIFeature` union + `FEATURE_CONFIG` entry (Task 4).
- `app/daily-report.tsx` — Schedule impact card: scan button → confirm rows (task picker + delta stepper + quote) → `ScheduleDiffView` → apply via the `persistEditedTasks` pattern → `updateProject` (Task 4).
- `app/rfi.tsx` — MAGE-suggests button + citation line, overdue/critical-path banner, widened Response-field render condition, `linkedTaskId` added to `handleSave` deps (Task 5).
- `package.json` — `"test:delay-rfi"` script chained into `ship-check` (Task 1).

**Reference (reuse, unchanged):** `utils/copilot/scheduleEdit/editOps.ts` (`EditOp`), `utils/copilot/scheduleEdit/interpretOps.ts` (`interpretScheduleOps`, `applyEditEffects`), `utils/copilot/scheduleEdit/diffSchedule.ts`, `utils/copilot/scheduleEdit/applyToProjectSchedule.ts`, `components/copilot/ScheduleDiffView.tsx`, `utils/copilot/types.ts` (`CopilotContext`), `utils/cpm.ts` (`runCpm`, `RunCpmOptions`), `utils/scheduleEngine.ts` (`buildScheduleFromTasks`), `utils/projectMemory.ts`, `utils/mageAI.ts`, `utils/aiRateLimiter.ts` (`checkAILimit`, `recordAIUsage`).

**NOT in scope (spec "Out of scope v2+"):** cross-project RFI memory (`match_project_memory_user_wide` RPC — owner-gated migration), RFI reminders/notifications, auto-scan on report save, RFI-as-CPM-constraint modeling, Brain Watch integration.

---

## Grounded reality (verified in code, 2026-07-23)

These are REAL signatures/shapes from the repo. Do not re-derive them — build against these.

### 1. `EditOp` / `TaskRef` (`utils/copilot/scheduleEdit/editOps.ts:5-18`)

```ts
/** A task reference: a ScheduleTask.id. The resolver (interpretOps) also
 *  falls back to a case-insensitive name match. */
export type TaskRef = string;

export type EditOp =
  | { op: 'move'; task: TaskRef; deltaDays?: number; toStartDay?: number }
  | { op: 'setDuration'; task: TaskRef; days: number }
  // … addDependency / removeDependency / addTask / removeTask / setCrew / setProgress / level
```

**The move op we emit is `{ op: 'move', task: <ScheduleTask.id>, deltaDays: <n> }`.** `TaskRef` is a plain string; we always pass the confirmed task's **id** (never the title), so the resolver's fuzzy title fallback never engages — our own `matchTaskByTitle` + user confirmation own the matching.

### 2. `interpretScheduleOps` (`utils/copilot/scheduleEdit/interpretOps.ts:8-25`)

```ts
export interface OpResult { op: EditOp; ok: boolean; reason?: string }

export function interpretScheduleOps(
  ops: EditOp[],
  tasks: ScheduleTask[],
): { nextTasks: ScheduleTask[]; results: OpResult[] }
```

**SPEC CORRECTION:** the design doc said `{nextTasks, rejected?}` — the real return is `{nextTasks, results}`; rejections are derived by filtering `results` for `!r.ok` (that is exactly what `ScheduleDiffView` does internally, line 26). A `move` clamps `startDay` to `Math.max(1, Math.round(next))` (:38). Also exported from the same file — pure, needed for the `level` op only but kept in the apply path for preview/apply parity:

```ts
export function applyEditEffects(ops: EditOp[], tasks: ScheduleTask[], cpmOptions: RunCpmOptions): ScheduleTask[]
```

### 3. `diffSchedule` (`utils/copilot/scheduleEdit/diffSchedule.ts:6-21`)

```ts
export interface ScheduleDiff {
  finishBeforeDay: number; finishAfterDay: number; finishDeltaDays: number;
  moved: { id: string; name: string; startDelta: number; durationDelta: number }[];
  added: { name: string; startDay: number; durationDays: number; isMilestone: boolean }[];
  removed: { name: string }[];
  depChanges: { fromName: string; toName: string; type: DependencyType; added: boolean }[];
  criticalEntered: string[];
  criticalLeft: string[];
  rejected: { summary: string }[];
}

export function diffSchedule(
  before: ScheduleTask[], after: ScheduleTask[],
  cpmBefore: CpmResult, cpmAfter: CpmResult,
  rejected: { summary: string }[] = [],
): ScheduleDiff
```

We never call this directly — `ScheduleDiffView` does (see #4). Quoted so the reviewer can verify the view's internals.

### 4. `ScheduleDiffView` (`components/copilot/ScheduleDiffView.tsx:17-29`) — **the load-bearing fact**

```tsx
export default function ScheduleDiffView({ ops, ctx, onApply, onDiscard }: {
  ops: EditOp[]; ctx: CopilotContext; onApply: () => void; onDiscard: () => void;
}) {
  // …
  const { diff, valid } = useMemo(() => {
    const before = ctx.currentTasks ?? [];
    const { nextTasks, results } = interpretScheduleOps(ops, before);
    const after = applyEditEffects(ops, nextTasks, ctx.cpmOptions ?? {});
    const rejected = results.filter(r => !r.ok).map(r => ({ summary: r.reason ?? 'skipped' }));
    const d = diffSchedule(before, after, runCpm(before, ctx.cpmOptions ?? {}), runCpm(after, ctx.cpmOptions ?? {}), rejected);
    return { diff: d, valid: results.some(r => r.ok) };
  }, [ops, ctx]);
```

**It takes `ops` + `ctx` and computes the whole preview INTERNALLY** (interpret → effects → `runCpm` ×2 → `diffSchedule`). It reads exactly two ctx fields: `ctx.currentTasks` and `ctx.cpmOptions`. `onApply`/`onDiscard` receive **nothing** — the parent must recompute `nextTasks` itself in its apply handler (the desktop editor does the same via `commitTasks`). It renders its own "Apply it" / "Not that — discard" buttons (`testID="schedule-edit-apply"` / `"schedule-edit-discard"`), disabling Apply when no op resolved. Its `body` ScrollView is capped at `maxHeight: 320` — fine to mount inside the daily-report screen's ScrollView. **SPEC CORRECTION:** the design doc's "interpretScheduleOps + runCpm before/after + diffSchedule → render ScheduleDiffView" flow is what the view does *for us*; Task 4 hands it `ops` + a ctx and only re-runs `interpretScheduleOps`/`applyEditEffects` in the apply handler.

### 5. `CopilotContext` (`utils/copilot/types.ts`)

```ts
export interface CopilotContext {
  project: Project | null;
  projectId: string;
  ctx: any;
  safety?: any;
  commitTasks?: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void;
  currentTasks?: import('@/types').ScheduleTask[];
  cpmOptions?: import('@/utils/cpm').RunCpmOptions;
  tier: string;
}
```

Required fields are `project`, `projectId`, `ctx`, `tier`; we pass `ctx: null` (it's `any`, used only by full copilot capabilities) plus `currentTasks` + `cpmOptions`. No `commitTasks` — our apply handler persists directly.

### 6. `runCpm` / `RunCpmOptions` (`utils/cpm.ts:50-150, 905`)

```ts
export interface CpmTaskResult {
  id: string;
  es: number; ef: number; ls: number; lf: number;
  totalFloat: number;   // LS − ES. 0 or less → critical.
  freeFloat: number;
  isCritical: boolean;  // totalFloat ≤ 0
}
export interface CpmResult {
  perTask: Map<string, CpmTaskResult>;
  projectStart: number;
  projectFinish: number;      // max EF across all tasks
  criticalPath: string[];
  conflicts: CpmConflict[];
  leveledStartDays?: Map<string, number>;
}
export interface RunCpmOptions {
  levelResources?: boolean;
  targetFinishDay?: number;
  criticalFloatThresholdDays?: number;
  scheduleStartDate?: string;        // ISO YYYY-MM-DD — enables calendar/anchor mode
  workingDaysPerWeek?: number;       // default 7 (raw-day back-compat)
  nonWorkingDates?: string[];
  taskCalendars?: Map<string, { workingDaysPerWeek: number; closures: string[] }>;
}
export function runCpm(tasks: ScheduleTask[], options: RunCpmOptions = {}): CpmResult
```

`runCpm` anchors each task's ES to its `startDay` floor and raises dependents (that is what makes a `move` ripple). How the **real mobile schedule screen** builds `cpmOptions` from a `ProjectSchedule` (`app/(tabs)/schedule/index.tsx:283-287`) — Task 4 mirrors this exactly:

```ts
const cpmOptions = useMemo(() => ({
  scheduleStartDate: activeSchedule?.startDate,
  workingDaysPerWeek: activeSchedule?.workingDaysPerWeek,
  nonWorkingDates: activeSchedule?.nonWorkingDates,
}), [activeSchedule?.startDate, activeSchedule?.workingDaysPerWeek, activeSchedule?.nonWorkingDates]);
```

### 7. Apply path: `applyToProjectSchedule` + the `persistEditedTasks` pattern

`utils/copilot/scheduleEdit/applyToProjectSchedule.ts:10-21` (whole file):

```ts
export function applyToProjectSchedule(
  schedule: ProjectSchedule,
  editedTasks: ScheduleTask[],
  cpmOptions: RunCpmOptions,
): ProjectSchedule {
  const cpm = runCpm(editedTasks, cpmOptions);
  const tasks = editedTasks.map(t => {
    const r = cpm.perTask.get(t.id);
    return r ? { ...t, startDay: r.es } : t;
  });
  return { ...schedule, tasks };
}
```

The mobile schedule's canonical persist helper (`app/(tabs)/schedule/index.tsx:447-473`) — **this is the pattern Task 4 replicates; skipping step 2 reintroduces the stale-`totalDurationDays` regression the PR #89 review caught:**

```ts
const persistEditedTasks = useCallback((nextTasks: ScheduleTask[]) => {
  if (!selectedProject || !activeSchedule) return;
  // Step 1: reflow dependent startDay values via CPM.
  const reflowed = applyToProjectSchedule(activeSchedule, nextTasks, cpmOptions).tasks;
  // Step 2: derive accurate scalar fields via the canonical builder.
  const cpmResult = runCpm(reflowed, cpmOptions);
  const built = buildScheduleFromTasks(
    activeSchedule.name ?? selectedProject.name ?? 'Schedule',
    selectedProject.id,
    reflowed,
    activeSchedule.baseline ?? null,
    { criticalPathDays: cpmResult.projectFinish },
  );
  // Step 3: merge — keep ALL of activeSchedule's sidecar fields; only
  // take built's freshly-derived scalars. saveSchedule preserves startDate.
  const merged: typeof activeSchedule = {
    ...activeSchedule,
    tasks: reflowed,
    totalDurationDays: built.totalDurationDays,
    criticalPathDays: built.criticalPathDays,
    healthScore: built.healthScore,
    laborAlignmentScore: built.laborAlignmentScore,
    riskItems: built.riskItems,
    updatedAt: new Date().toISOString(),
  };
  saveSchedule(merged, selectedProject);
}, [selectedProject, activeSchedule, cpmOptions, saveSchedule]);
```

`buildScheduleFromTasks` (`utils/scheduleEngine.ts:271`):

```ts
export function buildScheduleFromTasks(
  name: string,
  projectId: string | null,
  tasks: ScheduleTask[],
  existingBaseline?: ScheduleBaseline | null,
  opts?: { criticalPathDays?: number; startDate?: string },
): ProjectSchedule
```

Passing `opts.criticalPathDays` (from `cpm.projectFinish`) skips its legacy forward-pass resolver — required, otherwise the two engines can disagree by ±1 day ("save jitters task by 1 day" bug, documented at :289-299). Daily-report has no `saveSchedule`; the merged schedule goes through `updateProject(project.id, { schedule: merged })` (the same context write `saveSchedule` performs; `updateProject: (id: string, updates: Partial<Project>) => void` at `contexts/ProjectContext.tsx:104`). We do NOT touch `schedule.startDate` (the finish-jump bug lives there — `move` ops only change `tasks[].startDay`).

### 8. Daily-report screen idiom (`app/daily-report.tsx`, 2364 lines)

- `useProjects()` destructure (:61-64) — **does NOT include `updateProject`; Task 4 adds it:**

```ts
const {
  getProject, getDailyReportsForProject, addDailyReport, updateDailyReport, contacts, settings, addProjectPhoto,
  getPhotosForProject,
} = useProjects();
const { tier } = useSubscription();      // :65 — already present
```

- `issuesAndDelays` state (:119): `const [issuesAndDelays, setIssuesAndDelays] = useState(existingReport?.issuesAndDelays ?? '');`
- The **Issues & Delays section card closes at :1342** — the new Schedule impact card inserts directly after it (before the Homeowner-update comment block at :1344).
- The AI-gating pattern (:73-80): `checkAILimit(tier, 'fast', <feature>)` → `LimitCheck`; blocked → `setUpgradeLimit(limit)` opens the already-mounted `UpgradeSheet`.
- The AI-button idiom to mirror (Homeowner update, :1363-1381): `hsStyles.aiBtn` + `MageAIMark` icon, `RefreshCw` + progress copy while generating, `disabled` while busy. Styles factory idiom (`makeHsStyles`, :1972-1985): `helperText` caption, pill pinned right via `marginLeft: 'auto'`.
- `stableReportId` (:168-171): `useMemo(() => existingReport?.id ?? generateUUID(), [existingReport?.id])` — stable per report, safe for `cacheKey`.
- Already imported and reusable: `Modal`, `Alert`, `Haptics`, `Plus`, `X`, `AlertTriangle`, `RefreshCw`, `CheckCircle2`, `MageAIMark`, `Colors`, `checkAILimit`, `recordAIUsage`, `UpgradeSheet`, `PHASE_COLORS` (from `@/utils/scheduleEngine` — extend that import for `buildScheduleFromTasks`). NOT imported yet: `CalendarClock`, `ChevronDown`, `Link2`, `Minus` (lucide), `ScheduleDiffView`, the copilot/cpm/delayScan modules.

### 9. RFI screen structure (`app/rfi.tsx`, 996 lines)

- State (:111-125): `subject`, `question`, `assignedTo`, `submittedBy`, `dateRequired`, `priority`, `status`, `linkedDrawing`, `response`, `linkedTaskId`, `attachments` + picker booleans. Context (:95-96): `const { getProject, getRFIsForProject, addRFI, updateRFI, settings } = ctx;` where `ctx = useProjects()`.
- Schedule access (:137-138): `const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);` + `linkedTask` lookup. Task picker modal exists at :718-748 (the pattern the daily-report confirm-row picker copies).
- **THE TRAP — the Response field only renders for answered/closed** (:589-602):

```tsx
{(existingRFI && (status === 'answered' || status === 'closed')) && (
  <>
    <Text style={[styles.fieldLabel, { marginTop: 20 }]}>Response</Text>
    <TextInput … value={response} onChangeText={setResponse} … />
  </>
)}
```

A suggest button that fills `response` on an **open** RFI would fill an invisible field. Task 5 widens the condition with `|| response.trim().length > 0` (additive: any legacy row with a response but open status gains visibility — a fix, not a regression).
- Save flow (:152-194): typing a new response flips `ballInCourt` back to `'gc'` and stamps `dateResponded`; `updateRFI(existingRFI.id, { …, linkedTaskId: linkedTaskId || undefined, response: response.trim() || undefined, … })`.
- **Pre-existing bug in scope:** `handleSave`'s dependency array (:224) is missing `linkedTaskId` — `[subject, question, assignedTo, submittedBy, dateRequired, priority, status, linkedDrawing, response, existingRFI, projectId, addRFI, updateRFI, router, attachments]`. A pure "open RFI → link task → save" flow saves a stale `''`. The critical-path warning depends on the link persisting, so Task 5 adds `linkedTaskId` to the deps.
- Header for existing RFIs starts with `StatusPipeline` (:363-387) — the overdue/critical banner mounts directly above it. `Colors`, `Alert`, `Haptics`, `Platform` already imported; `AlertTriangle`, `RefreshCw` (lucide) and `MageAIMark` (extend `@/components/icons` import, currently `{ MageRFI }`) are not.

### 10. Project memory (`utils/projectMemory.ts`)

```ts
export interface MemoryCollections {
  rfis: RFI[]; dailyReports: DailyFieldReport[]; changeOrders: ChangeOrder[];
  submittals: Submittal[]; punchItems: PunchItem[];
}
export function extractMemoryDocs(c: MemoryCollections): MemoryDoc[]        // :59

export interface MemoryAnswer {
  answer: string;
  usedRefs: string[];       // citation labels, e.g. "RFI #12", "CO #4"
  searched: number;         // 0 ⟺ the project had no records at all
  matched: boolean;
  semantic?: boolean;
  errorKind?: string;       // set ⟺ the AI call failed (answer holds the error text)
  fromCache?: boolean;
}
export async function answerFromMemorySemantic(
  question: string,
  projectId: string,
  docs: MemoryDoc[],
): Promise<MemoryAnswer>                                                    // :251 — never throws
```

**Failure contract (matters for "a failure leaves the field untouched"):** on AI failure the promise still RESOLVES, with `errorKind` set and `answer` containing an error sentence ("MAGE couldn't answer that…"); with zero records it resolves with `searched: 0` and a "no records yet" sentence. Task 5 must gate on `errorKind || searched === 0` before writing `answer` into the response field. The RFI list comes from **ProjectContext** — `getRFIsForProject: (projectId: string) => RFI[]` (`contexts/ProjectContext.tsx:244`, implemented :2938 as a filtered+sorted memo); the sibling getters `getDailyReportsForProject` (:151), `getChangeOrdersForProject` (:127), `getSubmittalsForProject` (:260), `getPunchItemsForProject` (:157) all exist. The real call-site pattern to mirror (`app/project-memory.tsx:62-71`):

```ts
const docs = useMemo(() => {
  if (!projectId) return [];
  return extractMemoryDocs({
    rfis: getRFIsForProject(projectId),
    dailyReports: getDailyReportsForProject(projectId),
    changeOrders: getChangeOrdersForProject(projectId),
    submittals: getSubmittalsForProject(projectId),
    punchItems: getPunchItemsForProject(projectId),
  });
}, [projectId, getRFIsForProject, getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject]);
```

`project-memory.tsx` applies **no client-side `checkAILimit`** around `answerFromMemorySemantic` — the relay enforces caps server-side; Task 5 follows that precedent (the RFI screen is already Business-gated by `canAccess('rfis_submittals')` at :72).

### 11. AI feature registration (`utils/aiRateLimiterCore.ts:13-30, 53-66`)

```ts
export type AIFeature =
  // Fast / cheap — counted toward the daily fast quota
  | 'voiceIntake'
  | 'leadScoring'
  // …
  | 'dailyReport'
  | 'projectReport'
  // Smart / expensive …

export const FEATURE_CONFIG: Record<AIFeature, FeatureConfig> = {
  // Fast features — unlimited within daily quota
  // …
  dailyReport:        { tier: 'fast', displayName: 'Daily report' },
  projectReport:      { tier: 'fast', displayName: 'Project report' },
  // …
};
```

`FEATURE_CONFIG` is `Record<AIFeature, FeatureConfig>` — adding to the union without a config entry fails `tsc`. `delayScan` gets no `freeLifetimeCap`, no `proOnly` (spec: fast tier; free tier gets the standard fast daily quota).

### 12. `mageAI` (`utils/mageAI.ts:14-49`)

```ts
interface MageAIParams {
  prompt: string;
  schema?: any;           // Zod — client-side validation only
  schemaHint?: object;    // Plain JSON example — sent to the edge fn (sets jsonMode)
  tier?: "fast" | "smart";
  maxTokens?: number;     // default 1000
  cacheKey?: string;      // AsyncStorage cache, `mage_ai_cache_` prefix
  cacheHours?: number;    // default 2
  timeoutMs?: number;     // default 60000
  feature?: string;       // FEATURE_CONFIG vocabulary; relay gates an explicit allowlist
}
interface MageAIResult {
  success: boolean;
  data: any;              // schemaHint/jsonMode → the parsed JSON arrives here
  raw?: string;
  error?: string;
  errorKind?: 'timeout' | 'network' | 'http' | 'model' | 'validation' | 'unauthenticated' | 'monthly_cap' | 'unknown';
  finishReason?: string;
  cached?: boolean;
  fromCache?: boolean;
}
```

With `schemaHint` (no zod `schema`), `res.data` is the parsed JSON as-is — so we run it through our own pure `coerceDelayResult` before trusting it.

### 13. Validator harness + ship-check (`package.json`, `scripts/validate-*.ts`)

Harness (identical across the suite, e.g. `scripts/validate-copilot-edit-ops.ts`): `let pass = 0, fail = 0;` + an `expect`/`ok` helper comparing `JSON.stringify`, footer `console.log(\`\n${pass} passed, ${fail} failed\`); if (fail > 0) process.exit(1);`. Imports are RELATIVE (`../utils/delayScan/...`, `../types`) — bun resolves the `@/` alias *inside* imported modules (proven: `validate-copilot-edit-ops.ts` imports `interpretOps`, which imports `@/utils/cpm`). Scripts wire as `"test:delay-rfi": "bun run scripts/validate-delay-rfi.ts"` and append `&& bun run test:delay-rfi` to the END of the `ship-check` chain (which currently ends with `&& bun run test:copilot-split-intents`). Anti-slop (`test:app-slop`) bans emoji-as-icons, purple/pink/violet hex, and the "Inter" font — lucide icons + theme colors only.

### 14. Domain types (`types/index.ts`)

`RFI` (:2813): carries `linkedTaskId?: string`, `dateRequired: string`, `dateResponded?: string`, `response?: string`, `status: RFIStatus` (`'open' | 'answered' | 'closed' | 'void'`), `ballInCourt?`, `handoffs?`. `ScheduleTask` (:456) required fields for fixtures: `id, title, phase, durationDays, startDay, progress, crew, dependencies, notes, status` (+ optional `crewSize`, `dependencyLinks`, `isMilestone`, …). `ProjectSchedule` required fields for fixtures: `id, name, projectId, workingDaysPerWeek, bufferDays, tasks, totalDurationDays, criticalPathDays, laborAlignmentScore, riskItems` (+ optional `startDate?`, `nonWorkingDates?`, `baseline?`, `healthScore?`).

---

## Conventions the implementer must follow

- **AI reads, the user confirms, the engine computes.** No schedule number may originate from the model — `deltaDays` is a *proposal* the user confirms/adjusts; every start/finish/critical fact comes from `runCpm` via the copilot pipeline.
- **Pure functions never throw** on bad input — clamp/default/return-empty instead.
- **Ops carry task IDs**, never titles — the confirm row resolves the title; `interpretScheduleOps`'s fuzzy fallback must never be the matcher.
- **Never write `schedule.startDate`.** The apply path spreads the existing schedule and replaces only `tasks` + the derived scalars (Grounded reality #7) — the finish-jump bug class stays dead.
- **No supabase payload changes, no migration, no new persisted fields.**
- **Validator imports are RELATIVE** (`../utils/...`); app code uses the `@/` alias.
- **UI:** lucide icons only, `Type.*` font sizes, `Tokens.radius.*`, theme colors via `useThemedStyles` factories — match the daily-report/rfi idioms quoted above.
- **Commit after each task** with the trailer `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. `git add` only the files the task touched.
- **Gate after each task:** `npx tsc --noEmit` clean; for validator tasks the stated `bun run test:delay-rfi` count passes.

---

### Task 1: `delayPrompt.ts` + validator scaffold (TDD)

**Files:**
- Create: `utils/delayScan/delayPrompt.ts`
- Create: `scripts/validate-delay-rfi.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** — create `scripts/validate-delay-rfi.ts`:

```ts
// validate-delay-rfi.ts — unit tests for the Delay Cascade + RFI Brain pure
// engine: delay prompt grounding + coercion, strict task-title matching,
// RFI critical-path block status. Run via: bun run test:delay-rfi
import { buildDelayPrompt, coerceDelayResult, hashDelayText, DELAY_SCHEMA_HINT, MAX_DELAY_HITS, MAX_DELTA_DAYS } from '../utils/delayScan/delayPrompt';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got:  ', JSON.stringify(got), '\n      want: ', JSON.stringify(want)); }
}

console.log('\ndelayScan buildDelayPrompt:');

const TITLES = ['Electrical rough-in', 'Drywall hang', 'Paint interior'];
const prompt = buildDelayPrompt('Inspector no-show this morning — electrical rough-in pushed 2 days. Also drywall stack got rained on.', TITLES);

expect('embeds the issues text', prompt.includes('electrical rough-in pushed 2 days'), true);
expect('lists every task title', prompt.includes('- Electrical rough-in') && prompt.includes('- Drywall hang') && prompt.includes('- Paint interior'), true);
expect('rule: guess must be verbatim from the list or empty', /VERBATIM/.test(prompt), true);
expect('rule: prefer empty over speculation', /empty hits list over speculation/i.test(prompt), true);
expect('rule: quote the exact phrase', /exact phrase/i.test(prompt), true);
expect('rule: vague delay defaults to 1 day', /minimum 1/.test(prompt), true);
expect('empty task list stays safe', buildDelayPrompt('x', []).includes('(no tasks)'), true);
expect('schema hint carries the hit shape', Object.keys(DELAY_SCHEMA_HINT.hits[0]).sort(), ['deltaDays', 'quote', 'taskTitleGuess']);

console.log('\ndelayScan hashDelayText:');
expect('stable for identical input', hashDelayText('rain delay') === hashDelayText('rain delay'), true);
expect('changes when text changes', hashDelayText('rain delay') === hashDelayText('rain delay tomorrow'), false);
expect('ignores case and outer whitespace', hashDelayText('  Rain Delay ') === hashDelayText('rain delay'), true);

console.log('\ndelayScan coerceDelayResult:');
const goodHit = { taskTitleGuess: 'Electrical rough-in', deltaDays: 2, quote: 'rough-in pushed 2 days' };
expect('accepts the {hits:[...]} envelope', coerceDelayResult({ hits: [goodHit] }).hits.length, 1);
expect('accepts a bare array', coerceDelayResult([goodHit]).hits[0].taskTitleGuess, 'Electrical rough-in');
expect('clamps deltaDays below 1 up to 1', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 0 }] }).hits[0].deltaDays, 1);
expect('rounds fractional deltaDays', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 2.6 }] }).hits[0].deltaDays, 3);
expect('missing deltaDays defaults to 1', coerceDelayResult({ hits: [{ taskTitleGuess: '', quote: 'delayed by weather' }] }).hits[0].deltaDays, 1);
expect('caps oversize deltaDays', coerceDelayResult({ hits: [{ ...goodHit, deltaDays: 999 }] }).hits[0].deltaDays, MAX_DELTA_DAYS);
expect('drops hits without a quote', coerceDelayResult({ hits: [{ taskTitleGuess: 'Drywall hang', deltaDays: 3 }] }).hits.length, 0);
expect('missing guess defaults to empty string', coerceDelayResult({ hits: [{ quote: 'stuck on inspection' }] }).hits[0].taskTitleGuess, '');
expect('junk input → empty hits', coerceDelayResult('nope').hits.length, 0);
expect('caps the hit count', coerceDelayResult({ hits: Array.from({ length: 9 }, (_, i) => ({ quote: `q${i}` })) }).hits.length, MAX_DELAY_HITS);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Wire the script + run to verify it fails**

In `package.json` `scripts`, add after `"test:copilot-split-intents"`:

```json
"test:delay-rfi": "bun run scripts/validate-delay-rfi.ts",
```

and append ` && bun run test:delay-rfi` to the END of the `ship-check` chain.

Run: `bun run test:delay-rfi`
Expected: FAIL — cannot find module `../utils/delayScan/delayPrompt`.

- [ ] **Step 3: Implement `delayPrompt.ts`**

```ts
// utils/delayScan/delayPrompt.ts — the ONE AI seam of the Delay Cascade.
// The model's only job: read the daily report's issuesAndDelays free text
// into {taskTitleGuess, deltaDays, quote} proposals. The user confirms the
// task + days; every schedule number afterwards comes from the pure CPM
// pipeline. coerceDelayResult never trusts the model's JSON. React/RN-free.

export interface DelayHit {
  /** Best-match against the provided task titles — verbatim from the list, or ''. */
  taskTitleGuess: string;
  /** Proposed delay in days (integer >= 1; vague language → 1). */
  deltaDays: number;
  /** The exact report phrase that describes the delay — anchors the confirm row. */
  quote: string;
}

export interface DelayScanResult {
  /** Empty = no delay language found. */
  hits: DelayHit[];
}

export const MAX_DELAY_HITS = 5;
export const MAX_DELTA_DAYS = 60;

/** Plain-JSON example sent as mageAI schemaHint (sets jsonMode on the relay). */
export const DELAY_SCHEMA_HINT = {
  hits: [{
    taskTitleGuess: 'Electrical rough-in',
    deltaDays: 2,
    quote: 'inspector no-show, rough-in pushed 2 days',
  }],
};

export function buildDelayPrompt(issuesText: string, taskTitles: string[]): string {
  const titles = (taskTitles ?? []).map(t => (t ?? '').trim()).filter(Boolean);
  return [
    'You are a construction scheduler reading a daily report for the general contractor.',
    "Find every SCHEDULE DELAY the report's issues text explicitly describes, and map each to one of the schedule's task titles.",
    '',
    'Rules:',
    '- Only report delays the text explicitly describes. Prefer an empty hits list over speculation.',
    '- taskTitleGuess must be copied VERBATIM from the task list below, or "" when no listed task clearly matches.',
    '- deltaDays is a whole number of days, minimum 1. Vague language ("delayed", "pushed back") with no number means 1.',
    '- quote is the exact phrase from the issues text that describes the delay.',
    '- Weather, inspection, material and labor delays all count; complaints with no schedule effect do not.',
    '- Respond with JSON only, matching the provided shape.',
    '',
    '=== SCHEDULE TASKS ===',
    titles.length ? titles.map(t => `- ${t}`).join('\n') : '(no tasks)',
    '',
    "=== ISSUES AND DELAYS (today's report) ===",
    issuesText?.trim() || '(none)',
  ].join('\n');
}

export function coerceDelayResult(data: unknown): DelayScanResult {
  const rawHits: unknown[] = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { hits?: unknown[] }).hits))
      ? (data as { hits: unknown[] }).hits
      : [];
  const hits: DelayHit[] = [];
  for (const raw of rawHits) {
    if (hits.length >= MAX_DELAY_HITS) break;
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const quote = typeof r.quote === 'string' ? r.quote.trim() : '';
    if (!quote) continue; // the quote anchors the confirm row — no quote, no hit
    const n = typeof r.deltaDays === 'number' && Number.isFinite(r.deltaDays) ? Math.round(r.deltaDays) : 1;
    hits.push({
      taskTitleGuess: typeof r.taskTitleGuess === 'string' ? r.taskTitleGuess.trim() : '',
      deltaDays: Math.min(MAX_DELTA_DAYS, Math.max(1, n)),
      quote,
    });
  }
  return { hits };
}

/** djb2 over normalized text — stable across sessions, cheap, collision-fine
 *  for a per-report cache key. */
export function hashDelayText(issuesText: string): string {
  const text = (issuesText ?? '').trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (((h << 5) + h) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:delay-rfi`
Expected: `21 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/delayScan/delayPrompt.ts scripts/validate-delay-rfi.ts package.json
git commit -m "$(cat <<'EOF'
feat(delay-rfi): grounded delay prompt + coercion + text hash, validator scaffold

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `matchTaskByTitle` (TDD)

**Files:**
- Create: `utils/delayScan/matchTask.ts`
- Modify: `scripts/validate-delay-rfi.ts` (append cases BEFORE the footer)

- [ ] **Step 1: Append the failing tests** to `scripts/validate-delay-rfi.ts` (before the `console.log(\`\n${pass} passed…\`)` footer):

```ts
import { matchTaskByTitle } from '../utils/delayScan/matchTask';
import type { ScheduleTask } from '../types';

function task(id: string, title: string, startDay: number, durationDays: number, over: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id, title, phase: 'General', durationDays, startDay, progress: 0, crew: 'Crew A', dependencies: [], notes: '', status: 'not_started', ...over };
}

console.log('\ndelayScan matchTaskByTitle:');

const TASKS = [
  task('A', 'Demo', 1, 3),
  task('B', 'Electrical rough-in', 4, 5),
  task('C', 'Drywall hang', 9, 4),
  task('D', 'Paint interior', 13, 3),
  task('E', 'Paint exterior', 13, 3),
  task('F', 'Demo prep', 1, 1),
];

expect('exact match, case/whitespace-insensitive', matchTaskByTitle('  electrical ROUGH-IN ', TASKS)?.id, 'B');
expect('guess-inside-title substring', matchTaskByTitle('rough-in', TASKS)?.id, 'B');
expect('title-inside-guess substring', matchTaskByTitle('Drywall hang west wing', TASKS)?.id, 'C');
expect('ambiguous substring → null', matchTaskByTitle('paint', TASKS), null);
expect('exact wins over substring ambiguity', matchTaskByTitle('demo', TASKS)?.id, 'A');
expect('no match → null', matchTaskByTitle('landscaping', TASKS), null);
expect('empty guess → null', matchTaskByTitle('', TASKS), null);
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `bun run test:delay-rfi`
Expected: FAIL — cannot find module `../utils/delayScan/matchTask`.

- [ ] **Step 3: Implement `matchTask.ts`**

```ts
// utils/delayScan/matchTask.ts — resolve the AI's task-title guess to a real
// ScheduleTask for PRE-SELECTION in the confirm row. Deliberately stricter
// than the copilot resolver (interpretOps.resolveId): ambiguity returns null
// so the USER picks, instead of silently taking the first substring hit.
// Pure; React/RN-free so the validator drives it.
import type { ScheduleTask } from '@/types';

function norm(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matchTaskByTitle(guess: string, tasks: ScheduleTask[]): ScheduleTask | null {
  const g = norm(guess);
  if (!g) return null;
  const exact = (tasks ?? []).filter(t => norm(t.title) === g);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const sub = (tasks ?? []).filter(t => {
    const title = norm(t.title);
    return title.length > 0 && (title.includes(g) || g.includes(title));
  });
  return sub.length === 1 ? sub[0] : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:delay-rfi`
Expected: `28 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/delayScan/matchTask.ts scripts/validate-delay-rfi.ts
git commit -m "$(cat <<'EOF'
feat(delay-rfi): strict task-title matcher — null on ambiguity, user picks

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `rfiBlockStatus` (TDD) — pure CPM wrapper, zero AI

**Files:**
- Create: `utils/delayScan/rfiBlocking.ts`
- Modify: `scripts/validate-delay-rfi.ts` (append cases before the footer)

- [ ] **Step 1: Append the failing tests**:

```ts
import { rfiBlockStatus } from '../utils/delayScan/rfiBlocking';
import type { ProjectSchedule } from '../types';

function sched(tasks: ScheduleTask[]): ProjectSchedule {
  return {
    id: 's1', name: 'Test schedule', projectId: 'P1', workingDaysPerWeek: 7, bufferDays: 0,
    tasks, totalDurationDays: 0, criticalPathDays: 0, laborAlignmentScore: 0, riskItems: [],
  };
}

console.log('\ndelayScan rfiBlockStatus:');

// A(1-5) → B(6-10) → C(11-15) is the zero-float chain; D(1-2) has no
// successors → LF = projectFinish 15 → totalFloat 13.
const CHAIN = [
  task('A', 'Foundation', 1, 5),
  task('B', 'Framing', 6, 5, { dependencies: ['A'] }),
  task('C', 'Roofing', 11, 5, { dependencies: ['B'] }),
  task('D', 'Order fixtures', 1, 2),
];
const S = sched(CHAIN);

const critical = rfiBlockStatus({ linkedTaskId: 'B', status: 'open' }, S);
expect('open RFI on a zero-float task → critical', critical.critical, true);
expect('carries the task title', critical.taskTitle, 'Framing');
expect('carries totalFloat 0', critical.totalFloat, 0);

const floaty = rfiBlockStatus({ linkedTaskId: 'D', status: 'open' }, S);
expect('open RFI on a floaty task → not critical', floaty.critical, false);
expect('still reports the float', floaty.totalFloat, 13);

expect('no linkedTaskId → not blocking', rfiBlockStatus({ status: 'open' }, S).critical, false);
expect('answered RFI → not blocking', rfiBlockStatus({ linkedTaskId: 'B', status: 'answered' }, S).critical, false);
expect('missing schedule → not blocking', rfiBlockStatus({ linkedTaskId: 'B', status: 'open' }, null).critical, false);
expect('unknown task id → not blocking', rfiBlockStatus({ linkedTaskId: 'ZZ', status: 'open' }, S).critical, false);

const doneChain = sched(CHAIN.map(t => t.id === 'B' ? { ...t, status: 'done' as const, progress: 100 } : t));
expect('done task never warns', rfiBlockStatus({ linkedTaskId: 'B', status: 'open' }, doneChain).critical, false);
```

- [ ] **Step 2: Run to verify the new cases fail**

Run: `bun run test:delay-rfi`
Expected: FAIL — cannot find module `../utils/delayScan/rfiBlocking`.

- [ ] **Step 3: Implement `rfiBlocking.ts`**

```ts
// utils/delayScan/rfiBlocking.ts — does this open RFI sit on a task with no
// float? Pure wrapper over runCpm so the RFI screen can warn "this answer is
// holding up the critical path". The screen wraps the call in useMemo (memo-
// friendly: plain args in, plain object out). Null-safe on every input;
// never throws. React/RN-free so the validator drives it.
import type { ProjectSchedule, RFI } from '@/types';
import { runCpm, type RunCpmOptions } from '@/utils/cpm';

export interface RfiBlockStatus {
  critical: boolean;
  taskTitle?: string;
  totalFloat?: number;
}

const NOT_BLOCKING: RfiBlockStatus = { critical: false };

export function rfiBlockStatus(
  rfi: Pick<RFI, 'linkedTaskId' | 'status'>,
  schedule: ProjectSchedule | null | undefined,
  cpmOptions: RunCpmOptions = {},
): RfiBlockStatus {
  try {
    if (!rfi?.linkedTaskId) return NOT_BLOCKING;
    if (rfi.status !== 'open') return NOT_BLOCKING;
    const tasks = schedule?.tasks ?? [];
    const task = tasks.find(t => t.id === rfi.linkedTaskId);
    if (!task) return NOT_BLOCKING;
    if (task.status === 'done' || task.progress >= 100) return NOT_BLOCKING; // finished work can't be blocked
    const cpm = runCpm(tasks, cpmOptions);
    const r = cpm.perTask.get(task.id);
    if (!r) return NOT_BLOCKING;
    return { critical: r.isCritical, taskTitle: task.title, totalFloat: r.totalFloat };
  } catch {
    return NOT_BLOCKING;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test:delay-rfi`
Expected: `38 passed, 0 failed`.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit` — expected clean.

```bash
git add utils/delayScan/rfiBlocking.ts scripts/validate-delay-rfi.ts
git commit -m "$(cat <<'EOF'
feat(delay-rfi): pure RFI critical-path block status over runCpm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Schedule impact card on the daily report + `delayScan` registration

**Files:**
- Modify: `utils/aiRateLimiterCore.ts`
- Modify: `app/daily-report.tsx`

> **Before writing:** re-read the Homeowner-update card (`app/daily-report.tsx:1349-1437`), `makeHsStyles` (`:1972-1985`), the rfi.tsx task-picker modal (`app/rfi.tsx:718-748`), and Grounded reality #4/#6/#7 — the diff view computes its own preview; the apply handler replicates `persistEditedTasks`.

- [ ] **Step 1: Register the feature** in `utils/aiRateLimiterCore.ts`. Add to the `AIFeature` union after `| 'projectReport'` (:25):

```ts
  | 'delayScan'
```

and to `FEATURE_CONFIG` after the `projectReport:` line (:65), matching the fast-feature shape exactly:

```ts
  delayScan:          { tier: 'fast', displayName: 'Delay scan' },
```

(No `freeLifetimeCap`, no `proOnly` — free tier gets the standard fast daily quota. `Record<AIFeature, …>` makes a missed entry a compile error.)

- [ ] **Step 2: Imports** in `app/daily-report.tsx`:

Add `CalendarClock`, `ChevronDown`, `Link2`, `Minus` to the existing `lucide-react-native` import list (:10-15). Add `ScheduleTask` to the existing `@/types` type import (:35). Extend the existing `@/utils/scheduleEngine` import (:36) to `import { PHASE_COLORS, buildScheduleFromTasks } from '@/utils/scheduleEngine';`. Then add below the existing utils imports:

```ts
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';
import type { CopilotContext } from '@/utils/copilot/types';
import type { EditOp } from '@/utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps, applyEditEffects } from '@/utils/copilot/scheduleEdit/interpretOps';
import { applyToProjectSchedule } from '@/utils/copilot/scheduleEdit/applyToProjectSchedule';
import { runCpm } from '@/utils/cpm';
import { buildDelayPrompt, coerceDelayResult, hashDelayText, DELAY_SCHEMA_HINT, MAX_DELTA_DAYS } from '@/utils/delayScan/delayPrompt';
import { matchTaskByTitle } from '@/utils/delayScan/matchTask';
import { mageAI } from '@/utils/mageAI';
```

- [ ] **Step 3: Module-scope row type** — add next to `createId` (:49-51):

```ts
/** One confirm row of the delay scan: the AI's quote + proposal, the user's
 *  confirmed task + days. taskId null = unmatched, user must pick. */
type DelayRow = { quote: string; deltaDays: number; taskId: string | null };
```

- [ ] **Step 4: Hook up context + state.** Extend the `useProjects()` destructure (:61-64) with `updateProject,`. Add a styles hook next to the others (:57-59): `const dcStyles = useThemedStyles(makeDcStyles);`. Add state below the homeowner-summary state block (after :128):

```ts
// ─── Delay cascade (Schedule impact) ───
const [delayRows, setDelayRows] = useState<DelayRow[] | null>(null); // null = not scanned yet
const [delayScanning, setDelayScanning] = useState<boolean>(false);
const [delayPreviewOps, setDelayPreviewOps] = useState<EditOp[] | null>(null);
const [delayTaskPickerIdx, setDelayTaskPickerIdx] = useState<number | null>(null);
const [delayApplied, setDelayApplied] = useState<boolean>(false);
```

- [ ] **Step 5: Derived values + handlers** — add after `handleGenerateHomeownerSummary` (:525):

```ts
// ─── Delay cascade scan ───
const scheduleTasks = useMemo<ScheduleTask[]>(() => project?.schedule?.tasks ?? [], [project]);

// Mirrors app/(tabs)/schedule/index.tsx:283-287 — the schedule's own CPM options.
const delayCpmOptions = useMemo(() => ({
  scheduleStartDate: project?.schedule?.startDate,
  workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
  nonWorkingDates: project?.schedule?.nonWorkingDates,
}), [project?.schedule?.startDate, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates]);

// ScheduleDiffView reads exactly ctx.currentTasks + ctx.cpmOptions; the rest
// satisfies the CopilotContext required fields (ctx is `any` by design).
const diffCtx = useMemo<CopilotContext>(() => ({
  project: project ?? null,
  projectId: project?.id ?? '',
  ctx: null,
  tier,
  currentTasks: scheduleTasks,
  cpmOptions: delayCpmOptions,
}), [project, tier, scheduleTasks, delayCpmOptions]);

const handleDelayScan = useCallback(async () => {
  if (!project?.schedule || scheduleTasks.length === 0) return;
  if (!issuesAndDelays.trim()) {
    Alert.alert('Nothing to scan yet', "Note the delay under Issues & Delays first — that's the text the scan reads.");
    return;
  }
  const limit = await checkAILimit(tier, 'fast', 'delayScan');
  if (!limit.allowed) { setUpgradeLimit(limit); return; }
  setDelayScanning(true);
  setDelayPreviewOps(null);
  setDelayApplied(false);
  try {
    const res = await mageAI({
      prompt: buildDelayPrompt(issuesAndDelays, scheduleTasks.map(t => t.title)),
      tier: 'fast',
      maxTokens: 800,
      feature: 'delayScan',
      schemaHint: DELAY_SCHEMA_HINT,
      cacheKey: `delay_${stableReportId}_${hashDelayText(issuesAndDelays)}`,
    });
    if (!res.success) {
      Alert.alert('Scan failed', res.error ?? 'Try again in a moment.');
      return;
    }
    const { hits } = coerceDelayResult(res.data);
    setDelayRows(hits.map(h => ({
      quote: h.quote,
      deltaDays: h.deltaDays,
      taskId: matchTaskByTitle(h.taskTitleGuess, scheduleTasks)?.id ?? null,
    })));
    if (!res.fromCache) void recordAIUsage('fast', 'delayScan');
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  } finally {
    setDelayScanning(false);
  }
}, [project, scheduleTasks, issuesAndDelays, tier, stableReportId]);

const confirmableRows = useMemo(
  () => (delayRows ?? []).filter((r): r is DelayRow & { taskId: string } => !!r.taskId && r.deltaDays > 0),
  [delayRows],
);

const handlePreviewRipple = useCallback(() => {
  if (confirmableRows.length === 0) return;
  setDelayPreviewOps(confirmableRows.map(r => ({ op: 'move' as const, task: r.taskId, deltaDays: r.deltaDays })));
}, [confirmableRows]);

const handleApplyRipple = useCallback(() => {
  const schedule = project?.schedule;
  if (!project || !schedule || !delayPreviewOps) return;
  // Recompute exactly what ScheduleDiffView previewed (it computes internally
  // from ops + ctx; onApply hands us nothing).
  const { nextTasks } = interpretScheduleOps(delayPreviewOps, schedule.tasks);
  const edited = applyEditEffects(delayPreviewOps, nextTasks, delayCpmOptions);
  // persistEditedTasks pattern (app/(tabs)/schedule/index.tsx:447-473):
  // reflow startDays via CPM, re-derive the scalar fields, merge over a
  // spread of the schedule so sidecar fields (startDate, calendars,
  // scenarios, baseline, …) survive. NEVER touch schedule.startDate.
  const reflowed = applyToProjectSchedule(schedule, edited, delayCpmOptions).tasks;
  const cpmResult = runCpm(reflowed, delayCpmOptions);
  const built = buildScheduleFromTasks(
    schedule.name ?? project.name ?? 'Schedule',
    project.id,
    reflowed,
    schedule.baseline ?? null,
    { criticalPathDays: cpmResult.projectFinish },
  );
  updateProject(project.id, {
    schedule: {
      ...schedule,
      tasks: reflowed,
      totalDurationDays: built.totalDurationDays,
      criticalPathDays: built.criticalPathDays,
      healthScore: built.healthScore,
      laborAlignmentScore: built.laborAlignmentScore,
      riskItems: built.riskItems,
      updatedAt: new Date().toISOString(),
    },
  });
  setDelayPreviewOps(null);
  setDelayApplied(true);
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}, [project, delayPreviewOps, delayCpmOptions, updateProject]);
```

- [ ] **Step 6: Render the section.** Insert a new section card AFTER the Issues & Delays section card closes (:1342, the `</View>` right before the Homeowner-update comment):

```tsx
{/* Delay cascade — one tap turns the delay noted above into the downstream
    schedule ripple. AI reads the text; the user confirms task + days; the
    CPM engine computes every number. */}
{scheduleTasks.length > 0 && issuesAndDelays.trim().length > 0 && (
  <View style={styles.sectionCard}>
    <View style={styles.sectionHeader}>
      <CalendarClock size={18} color={themeColors.accent} strokeWidth={1.75} />
      <Text style={styles.sectionTitle}>Schedule impact</Text>
      {delayApplied && (
        <View style={dcStyles.appliedPill}>
          <Text style={dcStyles.appliedPillText}>APPLIED</Text>
        </View>
      )}
    </View>
    <Text style={dcStyles.helperText}>
      Reads the delays above, maps them to schedule tasks, and shows the downstream ripple — what slides, what turns critical, how the finish moves. Nothing changes until you apply it.
    </Text>

    <TouchableOpacity
      style={[dcStyles.aiBtn, delayScanning && dcStyles.aiBtnDisabled]}
      onPress={handleDelayScan}
      disabled={delayScanning}
      testID="delay-scan"
    >
      {delayScanning ? (
        <>
          <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={dcStyles.aiBtnText}>Reading the delays…</Text>
        </>
      ) : (
        <>
          <MageAIMark size={14} color={themeColors.accent} />
          <Text style={dcStyles.aiBtnText}>{delayRows ? 'Re-check schedule impact' : 'Check schedule impact'}</Text>
        </>
      )}
    </TouchableOpacity>

    {delayRows && delayRows.length === 0 && (
      <View style={dcStyles.cleanRow}>
        <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
        <Text style={dcStyles.cleanText}>No delay language detected in this report.</Text>
      </View>
    )}

    {delayRows && delayRows.length > 0 && !delayPreviewOps && (
      <View style={dcStyles.rowsBlock}>
        {delayRows.map((row, i) => {
          const rowTask = scheduleTasks.find(t => t.id === row.taskId);
          return (
            <View key={i} style={dcStyles.hitRow}>
              <Text style={dcStyles.hitQuote}>&ldquo;{row.quote}&rdquo;</Text>
              <View style={dcStyles.hitControls}>
                <TouchableOpacity style={dcStyles.taskPickBtn} onPress={() => setDelayTaskPickerIdx(i)} activeOpacity={0.7} testID={`delay-task-${i}`}>
                  <Link2 size={14} color={rowTask ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={[dcStyles.taskPickText, !rowTask && { color: themeColors.textMuted }]} numberOfLines={1}>
                    {rowTask ? rowTask.title : 'Pick the delayed task'}
                  </Text>
                  <ChevronDown size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                <View style={dcStyles.stepperRow}>
                  <TouchableOpacity
                    style={dcStyles.stepBtn}
                    onPress={() => setDelayRows(rs => (rs ?? []).map((r, j) => j === i ? { ...r, deltaDays: Math.max(1, r.deltaDays - 1) } : r))}
                    accessibilityRole="button" accessibilityLabel="One day less"
                  >
                    <Minus size={14} color={themeColors.text} strokeWidth={2} />
                  </TouchableOpacity>
                  <Text style={dcStyles.stepValue}>{row.deltaDays}d</Text>
                  <TouchableOpacity
                    style={dcStyles.stepBtn}
                    onPress={() => setDelayRows(rs => (rs ?? []).map((r, j) => j === i ? { ...r, deltaDays: Math.min(MAX_DELTA_DAYS, r.deltaDays + 1) } : r))}
                    accessibilityRole="button" accessibilityLabel="One day more"
                  >
                    <Plus size={14} color={themeColors.text} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
        <TouchableOpacity
          style={[dcStyles.previewBtn, confirmableRows.length === 0 && dcStyles.previewBtnOff]}
          onPress={handlePreviewRipple}
          disabled={confirmableRows.length === 0}
          activeOpacity={0.85}
          testID="delay-preview"
        >
          <Text style={dcStyles.previewBtnText}>
            {confirmableRows.length === 0
              ? 'Pick a task to preview the ripple'
              : `Preview the ripple (${confirmableRows.length} ${confirmableRows.length === 1 ? 'delay' : 'delays'})`}
          </Text>
        </TouchableOpacity>
      </View>
    )}

    {delayPreviewOps && (
      <View style={dcStyles.diffWrap}>
        <ScheduleDiffView
          ops={delayPreviewOps}
          ctx={diffCtx}
          onApply={handleApplyRipple}
          onDiscard={() => setDelayPreviewOps(null)}
        />
      </View>
    )}
  </View>
)}
```

- [ ] **Step 7: Task-picker modal** — add next to the screen's other modals (before the closing of the component's returned JSX, alongside `UpgradeSheet`), mirroring `app/rfi.tsx:718-748`:

```tsx
{/* Delay-row task picker */}
<Modal visible={delayTaskPickerIdx !== null} transparent animationType="fade" onRequestClose={() => setDelayTaskPickerIdx(null)}>
  <Pressable style={dcStyles.modalOverlay} onPress={() => setDelayTaskPickerIdx(null)}>
    <Pressable style={dcStyles.taskPickerCard} onPress={() => undefined}>
      <View style={dcStyles.taskPickerHeader}>
        <Text style={dcStyles.taskPickerTitle}>Which task slipped?</Text>
        <TouchableOpacity onPress={() => setDelayTaskPickerIdx(null)} accessibilityRole="button" accessibilityLabel="Close">
          <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      <ScrollView style={{ maxHeight: 360 }}>
        {scheduleTasks.map(t => {
          const active = delayTaskPickerIdx !== null && delayRows?.[delayTaskPickerIdx]?.taskId === t.id;
          return (
            <TouchableOpacity
              key={t.id}
              style={[dcStyles.taskOption, active && dcStyles.taskOptionActive]}
              onPress={() => {
                setDelayRows(rs => (rs ?? []).map((r, j) => j === delayTaskPickerIdx ? { ...r, taskId: t.id } : r));
                setDelayTaskPickerIdx(null);
              }}
            >
              {active && <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={1.75} />}
              <View style={{ flex: 1 }}>
                <Text style={[dcStyles.taskOptionText, active && dcStyles.taskOptionTextActive]} numberOfLines={1}>{t.title}</Text>
                <Text style={dcStyles.taskOptionMeta}>{t.phase} · {t.durationDays}d · day {t.startDay}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Pressable>
  </Pressable>
</Modal>
```

`Pressable` is not yet imported in daily-report — add it to the `react-native` import (:2-5).

- [ ] **Step 8: Styles factory** — add next to `makeHsStyles` (:1972):

```ts
const makeDcStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  appliedPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, marginLeft: 'auto', backgroundColor: 'rgba(30,142,74,0.12)' },
  appliedPillText: { fontSize: 9, fontWeight: '800', color: themeColors.success, letterSpacing: 0.6 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  aiBtnDisabled: { opacity: 0.7 },
  aiBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.accent },
  cleanRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  cleanText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  rowsBlock: { marginTop: 12, gap: 12 },
  hitRow: { gap: 8 },
  hitQuote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontStyle: 'italic' },
  hitControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskPickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    borderRadius: Tokens.radius.md, paddingHorizontal: 10, paddingVertical: 9,
  },
  taskPickText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 30, height: 30, borderRadius: Tokens.radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  stepValue: { minWidth: 34, textAlign: 'center', fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  previewBtn: { marginTop: 2, paddingVertical: 12, borderRadius: 11, alignItems: 'center', backgroundColor: themeColors.accent },
  previewBtnOff: { opacity: 0.4 },
  previewBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: '#FFFFFF' },
  diffWrap: { marginTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center', alignItems: 'center', padding: 24 },
  taskPickerCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, width: '100%', overflow: 'hidden' },
  taskPickerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  taskPickerTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: themeColors.text },
  taskOption: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: themeColors.line + '80' },
  taskOptionActive: { backgroundColor: themeColors.accent + '10' },
  taskOptionText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500', color: themeColors.text },
  taskOptionTextActive: { fontWeight: '700', color: themeColors.accent },
  taskOptionMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, marginTop: 1 },
});
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && bun run lint && bun run test:app-slop && bun run test:gating && bun run test:ai-feature-gating`
Expected: all clean (`CalendarClock`/`Minus`/`Link2`/`ChevronDown` exist in lucide-react-native; `delayScan` is not proOnly so the relay-allowlist validator does not require an entry; no emoji icons, no banned hex).

- [ ] **Step 10: Commit**

```bash
git add utils/aiRateLimiterCore.ts app/daily-report.tsx
git commit -m "$(cat <<'EOF'
feat(delay-rfi): schedule-impact card on daily report — scan, confirm, ripple, apply

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: RFI brain — MAGE-suggests + overdue/critical-path banner

**Files:**
- Modify: `app/rfi.tsx`

> **Before writing:** re-read Grounded reality #9 (the Response-field render TRAP + the `linkedTaskId` deps bug) and #10 (the `MemoryAnswer` failure contract).

- [ ] **Step 1: Imports.** Add `RefreshCw`, `AlertTriangle` to the existing `lucide-react-native` import (:9). Extend the icons import (:10) to `import { MageRFI, MageAIMark } from '@/components/icons';`. Add:

```ts
import { extractMemoryDocs, answerFromMemorySemantic } from '@/utils/projectMemory';
import { rfiBlockStatus } from '@/utils/delayScan/rfiBlocking';
```

- [ ] **Step 2: Context + state.** Extend the destructure (:96) to:

```ts
const {
  getProject, getRFIsForProject, addRFI, updateRFI, settings,
  getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject,
} = ctx;
```

Add state below the send-modal state block (:135):

```ts
// ─── RFI brain ───
const [suggesting, setSuggesting] = useState(false);
const [suggestCitation, setSuggestCitation] = useState<string | null>(null);
const [suggestError, setSuggestError] = useState<string | null>(null);
```

- [ ] **Step 3: Derived banner facts** — add after the `linkedTask` memo (:138):

```ts
// Critical-path check for the linked task — pure rfiBlockStatus wrapped in a
// memo. cpmOptions mirror the schedule screens (Grounded reality #6).
const blocking = useMemo(() => rfiBlockStatus(
  { linkedTaskId: linkedTaskId || undefined, status },
  project?.schedule,
  {
    scheduleStartDate: project?.schedule?.startDate,
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  },
), [linkedTaskId, status, project?.schedule]);

const overdueDays = useMemo(() => {
  if (!existingRFI || status !== 'open' || !dateRequired) return 0;
  const due = new Date(dateRequired).getTime();
  if (Number.isNaN(due)) return 0;
  return Math.max(0, Math.floor((Date.now() - due) / 86400000));
}, [existingRFI, status, dateRequired]);
```

- [ ] **Step 4: Suggest handler** — add after `handleSendToPro` (:313):

```ts
// ─── MAGE suggests an answer ───
// Same machinery as app/project-memory.tsx: extract this project's records,
// retrieve semantically (pgvector when deployed, TF-IDF fallback), draft an
// answer citing refs. answerFromMemorySemantic NEVER throws — but on failure
// it resolves with errorKind set (answer = error sentence) and with zero
// records it resolves with searched === 0. Gate on both so a failure leaves
// the response field untouched.
const handleSuggestAnswer = useCallback(async () => {
  const q = question.trim();
  if (!q || suggesting || !projectId) return;
  setSuggesting(true);
  setSuggestError(null);
  try {
    const docs = extractMemoryDocs({
      rfis: getRFIsForProject(projectId).filter(r => r.id !== existingRFI?.id), // don't cite the question at itself
      dailyReports: getDailyReportsForProject(projectId),
      changeOrders: getChangeOrdersForProject(projectId),
      submittals: getSubmittalsForProject(projectId),
      punchItems: getPunchItemsForProject(projectId),
    });
    const res = await answerFromMemorySemantic(q, projectId, docs);
    if (res.errorKind || res.searched === 0 || !res.answer.trim()) {
      setSuggestError(res.searched === 0
        ? 'No project records to draft from yet — answers, reports and change orders become source material as you log them.'
        : res.answer || "MAGE couldn't draft an answer right now. Try again in a moment.");
      return;
    }
    setResponse(res.answer.trim());
    setSuggestCitation(res.usedRefs.length > 0
      ? `Drafted from ${res.usedRefs.slice(0, 3).join(', ')} — review before sending.`
      : "Drafted from this project's records — review before sending.");
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } finally {
    setSuggesting(false);
  }
}, [question, suggesting, projectId, existingRFI, getRFIsForProject, getDailyReportsForProject, getChangeOrdersForProject, getSubmittalsForProject, getPunchItemsForProject]);
```

- [ ] **Step 5: Overdue / critical-path banner** — insert directly ABOVE the StatusPipeline block (:363, `{existingRFI && (` → `<View style={styles.pipelineWrap}>`):

```tsx
{/* Overdue / critical-path banner — the RFI's cost made visible. Danger
    when the response is late; warning when the linked task has no float. */}
{existingRFI && status === 'open' && (overdueDays > 0 || blocking.critical) && (
  <View style={[styles.alertBanner, overdueDays > 0 ? styles.alertBannerDanger : styles.alertBannerWarn]} testID="rfi-alert-banner">
    <AlertTriangle size={15} color={overdueDays > 0 ? themeColors.danger : Colors.warning} strokeWidth={1.75} />
    <Text style={styles.alertBannerText}>
      {overdueDays > 0
        ? `Response due ${overdueDays} ${overdueDays === 1 ? 'day' : 'days'} ago`
        : 'Waiting on this answer'}
      {blocking.critical && blocking.taskTitle ? ` — blocks “${blocking.taskTitle}” on the critical path.` : ''}
    </Text>
  </View>
)}
```

- [ ] **Step 6: Widen the Response-field condition + mount the suggest block.** Edit the Response conditional (:589), old:

```tsx
{(existingRFI && (status === 'answered' || status === 'closed')) && (
```

new (a filled suggestion must be visible/editable on an open RFI):

```tsx
{(existingRFI && (status === 'answered' || status === 'closed' || response.trim().length > 0)) && (
```

Then insert the suggest block immediately AFTER that conditional closes (:602's `)}`), so it sits under the response field when visible and in the same spot when hidden:

```tsx
{/* MAGE suggests — drafts a response from how this project answered
    similar questions before. Cited; GC reviews before sending. */}
{existingRFI && (
  <>
    <TouchableOpacity
      style={[styles.suggestBtn, (suggesting || !question.trim()) && styles.suggestBtnDisabled]}
      onPress={handleSuggestAnswer}
      disabled={suggesting || !question.trim()}
      activeOpacity={0.85}
      testID="rfi-suggest"
    >
      {suggesting ? (
        <>
          <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.suggestBtnText}>Searching this project&rsquo;s history…</Text>
        </>
      ) : (
        <>
          <MageAIMark size={14} color={themeColors.accent} />
          <Text style={styles.suggestBtnText}>MAGE suggests an answer</Text>
        </>
      )}
    </TouchableOpacity>
    {!!suggestCitation && !suggesting && (
      <Text style={styles.suggestCitation}>{suggestCitation}</Text>
    )}
    {!!suggestError && !suggesting && (
      <Text style={styles.suggestError}>{suggestError}</Text>
    )}
  </>
)}
```

- [ ] **Step 7: Fix the stale-closure bug** — add `linkedTaskId` to `handleSave`'s dependency array (:224):

old: `}, [subject, question, assignedTo, submittedBy, dateRequired, priority, status, linkedDrawing, response, existingRFI, projectId, addRFI, updateRFI, router, attachments]);`
new: `}, [subject, question, assignedTo, submittedBy, dateRequired, priority, status, linkedDrawing, response, linkedTaskId, existingRFI, projectId, addRFI, updateRFI, router, attachments]);`

(Without this, "open RFI → link task → save" persists a stale `''` — and the critical-path warning depends on the link persisting.)

- [ ] **Step 8: Styles** — add to `makeStyles` (:753, anywhere after `saveBtnText`):

```ts
// RFI brain — suggest button + banners
suggestBtn: {
  flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
  backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  borderRadius: Tokens.radius.md, paddingVertical: 11, marginTop: 12,
},
suggestBtnDisabled: { opacity: 0.6 },
suggestBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
suggestCitation: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, marginTop: 6 },
suggestError: { fontSize: Type.caption1.fontSize, color: themeColors.danger, marginTop: 6 },
alertBanner: {
  flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
  marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: Tokens.radius.md, borderWidth: 1,
},
alertBannerDanger: { backgroundColor: themeColors.danger + '12', borderColor: themeColors.danger + '40' },
alertBannerWarn: { backgroundColor: Colors.warning + '14', borderColor: Colors.warning + '40' },
alertBannerText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit && bun run lint && bun run test:app-slop`
Expected: all clean.

- [ ] **Step 10: Commit**

```bash
git add app/rfi.tsx
git commit -m "$(cat <<'EOF'
feat(delay-rfi): RFI brain — MAGE-suggested answer + overdue/critical-path banner

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full ship-check + review

- [ ] **Step 1: Run the full gate**

Run: `bun run ship-check`
Expected: EXIT 0 — typecheck + lint + the whole validator suite including `test:delay-rfi` (`38 passed, 0 failed`).

- [ ] **Step 2: Review checklist** (fix + commit anything found):

- Ops carry IDs: every emitted op is `{ op: 'move', task: <ScheduleTask.id>, deltaDays }` built from `confirmableRows` — `taskTitleGuess` never reaches `interpretScheduleOps`.
- `git grep -n "startDate" app/daily-report.tsx` → the apply handler must NOT set `schedule.startDate` (the spread preserves it; nothing overwrites it).
- Apply parity: `handleApplyRipple` runs `interpretScheduleOps` + `applyEditEffects` with the SAME `delayPreviewOps` + `delayCpmOptions` the mounted `ScheduleDiffView` received — preview and apply compute identical task arrays.
- Derived scalars: the `updateProject` payload carries `totalDurationDays`/`criticalPathDays`/`healthScore`/`laborAlignmentScore`/`riskItems` from `buildScheduleFromTasks(..., { criticalPathDays: cpmResult.projectFinish })` — the stale-scalar regression and the ±1-day double-engine bug both stay dead.
- RFI suggest failure paths: force-test mentally against `MemoryAnswer` — `errorKind` set → error line shown, `response` untouched; `searched === 0` → friendly empty-state error, `response` untouched.
- The response field is visible whenever it holds text (`|| response.trim().length > 0`), so a suggestion on an open RFI is never invisible.
- `git grep -n "supabaseWrite" app/daily-report.tsx app/rfi.tsx` → no new direct writes; all persistence rides `updateProject`/`updateRFI`/`updateDailyReport` (offline-queue-backed context paths).
- No dollar signs, no schedule numbers sourced from `res.data` anywhere — only `quote`/`taskTitleGuess`/`deltaDays` proposals, all user-confirmed.

- [ ] **Step 3:** Branch is ready for the adversarial-review workflow (apply-path parity + prompt-grounding verification) before merge. Deploy (merge + OTA) stays owner-gated.

---

## Self-Review

**Spec coverage:** `buildDelayPrompt` embedding the task-title list + `DelayScanResult`/`DelayHit` + `coerceDelayResult` clamps + hash for cacheKey → Task 1. `matchTaskByTitle` normalized exact→substring→null-on-ambiguity → Task 2. `rfiBlockStatus` per spec (memo-friendly, null-safe, done-task no-warn) → Task 3. Daily-report flow — "Check schedule impact" action, `mageAI({feature:'delayScan', tier:'fast', schemaHint, cacheKey: delay_<reportId>_<hash>})`, confirm rows (picker pre-selected from the guess + delta stepper + quote), `ScheduleDiffView` with its own Apply/Discard, apply via `applyToProjectSchedule` → `updateProject`, "No delay language detected" empty state, `delayScan` in `AIFeature` + `FEATURE_CONFIG` → Task 4. RFI brain — suggest button under the response field enabled when question non-empty, `extractMemoryDocs` from ProjectContext getters, `answerFromMemorySemantic`, citation line ("Drafted from RFI #4, #9 — review before sending"), failure leaves the field untouched, overdue banner ("Response due N days ago", danger tokens), critical-path warning appended ("— blocks '<task>' on the critical path") → Task 5. Testing spec (prompt grounding, coerce clamps, matcher cases, rfiBlockStatus cases; ripple math NOT re-tested) → Tasks 1–3 + 6. Out-of-scope items (cross-project memory, reminders, auto-scan, RFI-as-constraint, Brain Watch) untouched. **No gaps.**

**Spec corrections carried into the plan** (verified against source, not the design doc): (1) `interpretScheduleOps` returns `{nextTasks, results}` — not `{nextTasks, rejected?}`; (2) `ScheduleDiffView` computes the entire preview internally from `ops` + `ctx` and its `onApply` passes nothing, so Task 4 recomputes `nextTasks` in the apply handler instead of pre-computing a diff; (3) the RFI Response field is hidden for open RFIs — Task 5 widens its render condition so a suggestion is visible; (4) the flow persists through the full `persistEditedTasks` pattern (reflow + `buildScheduleFromTasks` scalars), not bare `applyToProjectSchedule`, per the PR #89 stale-scalar lesson.

**Placeholder scan:** every code step contains complete, real code; commands carry exact expected outputs (validator counts 21/28/38 match the `expect()` calls per task: 8+3+10, +7, +10).

**Type consistency:** `DelayHit`/`DelayScanResult`/`DELAY_SCHEMA_HINT` keys (`taskTitleGuess`,`deltaDays`,`quote`) defined once in Task 1 and consumed identically in Task 4's scan handler and the schema-hint test. `MAX_DELTA_DAYS` caps both `coerceDelayResult` (Task 1) and the stepper (Task 4). `DelayRow.taskId` (id, not title) is the only value that reaches `EditOp.task`. `RfiBlockStatus` defined in Task 3, consumed in Task 5's banner. `CopilotContext`'s required fields (`project`, `projectId`, `ctx`, `tier`) all present in `diffCtx`. `rfiBlockStatus`'s `Pick<RFI, 'linkedTaskId' | 'status'>` matches both the validator fixtures and the rfi.tsx call site.
