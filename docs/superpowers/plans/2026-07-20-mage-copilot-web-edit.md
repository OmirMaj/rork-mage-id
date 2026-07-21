# MAGE Copilot Schedule Web-Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a contractor talk/type an edit to an existing schedule ("push framing back a week and re-level the crew"), see the CPM cascade as a before→after diff, and apply it through the desktop editor's existing undo-safe `commit()` path.

**Architecture:** The AI emits a typed `EditOp[]` (referencing real task ids from grounding); a **pure** `interpretScheduleOps` applies them → `runCpm` recalculates → a **pure** `diffSchedule` produces the preview. The copilot engine (turn loop + `CopilotShell`) is reused via two additive seams: a `renderReview` hook (draws the diff) and `commitTasks`/`currentTasks` on `CopilotContext` (routes apply through the editor's `commit()`).

**Tech Stack:** TypeScript (strict), React Native / Expo (RN-web), bun. No jest — pure-fn validators via `scripts/validate-*.ts` in the ship-check `&&`-chain. Reuses `utils/cpm.ts`, `app/schedule-pro.tsx`, the copilot engine. OTA-safe (no new edge fn).

**Ground truth (verified):**
- `ScheduleTask` (types/index.ts:456): `{ id, title, phase, durationDays, startDay, progress, crew: string, crewSize?: number, dependencies: string[], dependencyLinks?: DependencyLink[], notes, status, isMilestone?, ... }`. **`crew` is a string label; `crewSize` is the number** → the crew op sets `crewSize`.
- `DependencyLink` (types/index.ts:426): `{ taskId: string; type?: DependencyType; lagDays: number }`. `DependencyType = 'FS'|'SS'|'FF'|'SF'` (types/index.ts:424).
- `runCpm(tasks: ScheduleTask[], options?: RunCpmOptions): CpmResult` (utils/cpm.ts:905). `CpmResult` = `{ perTask: Map<id, CpmTaskResult>, projectStart, projectFinish, criticalPath: string[], conflicts, leveledStartDays?: Map<id,number> }`. `CpmTaskResult` has `{ es, ef, ls, lf, totalFloat, freeFloat, isCritical }`.
- Leveling: `runCpm(tasks, { levelResources: true })` → `result.leveledStartDays` (a Map). NOT auto-applied — the caller writes them onto `startDay`.
- `wouldCreateCycle(tasks, taskId, candidateDepId): boolean` (utils/cpm.ts:1045). `taskId` is the task GAINING a predecessor `candidateDepId`. A task's `dependencies[]` holds its PREDECESSOR ids.
- Host (app/schedule-pro.tsx): `commit = useCallback((producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void)` (:596) — snapshots history + debounced persist + audit. `workingTasks` = live task array. `runCpm(rolledTasks, { scheduleStartDate: scheduleStartIso, ... })` (:281). `scheduleStartIso` = ISO start.
- Engine: `hooks/useCopilotConversation.ts` (turn loop, `confirm()`→`apply`), `components/copilot/CopilotShell.tsx` (phases; review phase at ~:200), `utils/copilot/types.ts` (`CopilotCapability`, `CopilotContext`, `CopilotCapabilityId`), `utils/copilot/registry.ts`.

**Validator convention:** `scripts/validate-*.ts` are plain TS run by `bun run scripts/validate-x.ts` (exit 1 on failure). They import ONLY pure files (no `mageAI`/RN/React). Pattern: a local `ok(name, cond)` counter, print `\nN passed, M failed`, `process.exit(1)` if any fail. Wire each into `package.json` `scripts` + the `ship-check` `&&`-chain.

---

## Task 1: EditOp vocabulary + normalizer (pure)

**Files:**
- Create: `utils/copilot/scheduleEdit/editOps.ts`
- Create: `scripts/validate-copilot-edit-ops.ts` (extended in Task 2)

- [ ] **Step 1: Write the failing validator (normalizer half)**

Create `scripts/validate-copilot-edit-ops.ts`:
```ts
// scripts/validate-copilot-edit-ops.ts — pure-fn validator for the schedule
// edit-op vocabulary: the normalizer (drops junk, clamps bounds) and the
// interpreter (Task 2 adds its cases).
import { normalizeEditOps } from '../utils/copilot/scheduleEdit/editOps';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

// --- normalizeEditOps ---
ok('non-array → []', normalizeEditOps(null).length === 0 && normalizeEditOps({}).length === 0);
ok('keeps a valid move op', normalizeEditOps([{ op: 'move', task: 't1', deltaDays: 7 }]).length === 1);
ok('drops an unknown op', normalizeEditOps([{ op: 'nuke', task: 't1' }]).length === 0);
ok('drops move with no task', normalizeEditOps([{ op: 'move', deltaDays: 3 }]).length === 0);
ok('clamps progress to 0..100', (() => {
  const o = normalizeEditOps([{ op: 'setProgress', task: 't1', pct: 250 }])[0] as any;
  return o.op === 'setProgress' && o.pct === 100;
})());
ok('drops setDuration with negative days', normalizeEditOps([{ op: 'setDuration', task: 't1', days: -4 }]).length === 0);
ok('coerces addDependency type + defaults lag 0', (() => {
  const o = normalizeEditOps([{ op: 'addDependency', from: 'a', to: 'b', type: 'SS' }])[0] as any;
  return o.type === 'SS' && o.lag === 0;
})());
ok('bad dep type → FS', (() => {
  const o = normalizeEditOps([{ op: 'addDependency', from: 'a', to: 'b', type: 'ZZ' }])[0] as any;
  return o.type === 'FS';
})());
ok('keeps level + setStartDate', normalizeEditOps([{ op: 'level' }, { op: 'setStartDate', iso: '2026-08-01' }]).length === 2);
ok('addTask needs a title', normalizeEditOps([{ op: 'addTask', durationDays: 3 }]).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run it — expect failure**

Run: `bun run scripts/validate-copilot-edit-ops.ts`
Expected: FAIL — `Cannot find module '.../editOps'`.

- [ ] **Step 3: Implement `editOps.ts`**

Create `utils/copilot/scheduleEdit/editOps.ts`:
```ts
// utils/copilot/scheduleEdit/editOps.ts — the typed edit-operation vocabulary
// the AI emits, plus a pure normalizer. React/RN-free so validators drive it.
import type { DependencyType } from '@/types';

/** A task reference: a ScheduleTask.id. The resolver (interpretOps) also
 *  falls back to a case-insensitive name match. */
export type TaskRef = string;

export type EditOp =
  | { op: 'move'; task: TaskRef; deltaDays?: number; toStartDay?: number }
  | { op: 'setDuration'; task: TaskRef; days: number }
  | { op: 'addDependency'; from: TaskRef; to: TaskRef; type: DependencyType; lag: number }
  | { op: 'removeDependency'; from: TaskRef; to: TaskRef }
  | { op: 'addTask'; title: string; durationDays: number; after?: TaskRef; crew?: number; isMilestone?: boolean }
  | { op: 'removeTask'; task: TaskRef }
  | { op: 'setCrew'; task: TaskRef; crewSize: number }
  | { op: 'setProgress'; task: TaskRef; pct: number }
  | { op: 'level' }
  | { op: 'setStartDate'; iso: string };

const DEP_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const numOr = (v: unknown, fallback: number): number => (typeof v === 'number' && isFinite(v) ? v : fallback);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Validate + clean a raw AI ops array into usable EditOps. Pure. Unknown ops,
 *  missing required refs, and out-of-bounds values are dropped/clamped rather
 *  than trusted. */
export function normalizeEditOps(raw: unknown): EditOp[] {
  if (!Array.isArray(raw)) return [];
  const out: EditOp[] = [];
  for (const r of raw) {
    const op = (r as { op?: unknown })?.op;
    if (typeof op !== 'string') continue;
    const a = r as Record<string, unknown>;
    switch (op) {
      case 'move': {
        const task = str(a.task); if (!task) break;
        const move: EditOp = { op: 'move', task };
        if (typeof a.deltaDays === 'number') move.deltaDays = Math.round(a.deltaDays);
        if (typeof a.toStartDay === 'number') move.toStartDay = Math.max(1, Math.round(a.toStartDay));
        if (move.deltaDays === undefined && move.toStartDay === undefined) break;
        out.push(move); break;
      }
      case 'setDuration': {
        const task = str(a.task); const days = numOr(a.days, NaN);
        if (task && isFinite(days) && days >= 0) out.push({ op: 'setDuration', task, days: Math.round(days) });
        break;
      }
      case 'addDependency': {
        const from = str(a.from), to = str(a.to);
        if (!from || !to || from === to) break;
        const type = DEP_TYPES.includes(a.type as DependencyType) ? (a.type as DependencyType) : 'FS';
        out.push({ op: 'addDependency', from, to, type, lag: Math.round(numOr(a.lag, 0)) });
        break;
      }
      case 'removeDependency': {
        const from = str(a.from), to = str(a.to);
        if (from && to) out.push({ op: 'removeDependency', from, to });
        break;
      }
      case 'addTask': {
        const title = str(a.title); const durationDays = numOr(a.durationDays, NaN);
        if (!title || !isFinite(durationDays) || durationDays < 0) break;
        const t: EditOp = { op: 'addTask', title, durationDays: Math.round(durationDays) };
        if (str(a.after)) t.after = str(a.after);
        if (typeof a.crew === 'number' && a.crew > 0) t.crew = Math.round(a.crew);
        if (a.isMilestone === true || durationDays === 0) t.isMilestone = true;
        out.push(t); break;
      }
      case 'removeTask': {
        const task = str(a.task); if (task) out.push({ op: 'removeTask', task }); break;
      }
      case 'setCrew': {
        const task = str(a.task); const crewSize = numOr(a.crewSize ?? a.crew, NaN);
        if (task && isFinite(crewSize) && crewSize >= 0) out.push({ op: 'setCrew', task, crewSize: Math.round(crewSize) });
        break;
      }
      case 'setProgress': {
        const task = str(a.task); const pct = numOr(a.pct, NaN);
        if (task && isFinite(pct)) out.push({ op: 'setProgress', task, pct: clamp(Math.round(pct), 0, 100) });
        break;
      }
      case 'level': out.push({ op: 'level' }); break;
      case 'setStartDate': {
        const iso = str(a.iso); if (/^\d{4}-\d{2}-\d{2}/.test(iso)) out.push({ op: 'setStartDate', iso: iso.slice(0, 10) });
        break;
      }
      default: break;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it — expect pass**

Run: `bun run scripts/validate-copilot-edit-ops.ts`
Expected: `10 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/scheduleEdit/editOps.ts scripts/validate-copilot-edit-ops.ts
git commit -m "copilot(web-edit): typed EditOp vocabulary + pure normalizer"
```

---

## Task 2: interpretScheduleOps (pure) — apply ops with guards

**Files:**
- Create: `utils/copilot/scheduleEdit/interpretOps.ts`
- Modify: `scripts/validate-copilot-edit-ops.ts` (append interpreter cases)

- [ ] **Step 1: Append failing interpreter cases to the validator**

Append to `scripts/validate-copilot-edit-ops.ts` BEFORE the final `console.log`:
```ts
import { interpretScheduleOps } from '../utils/copilot/scheduleEdit/interpretOps';
import type { ScheduleTask } from '../types';

const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
// framing(1) → rough(2, dep framing) → mep(3, dep rough)
const base = (): ScheduleTask[] => [
  mk('t1', { title: 'Framing', startDay: 1, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }),
  mk('t3', { title: 'MEP', startDay: 10, durationDays: 3, dependencies: ['t2'] }),
];

ok('move by delta shifts startDay', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'move', task: 't1', deltaDays: 7 }], base());
  return results[0].ok && nextTasks.find(t => t.id === 't1')!.startDay === 8;
})());
ok('resolves a ref by name (case-insensitive)', (() => {
  const { results } = interpretScheduleOps([{ op: 'setDuration', task: 'framing', days: 9 }], base());
  return results[0].ok;
})());
ok('rejects an unresolved ref', (() => {
  const { results } = interpretScheduleOps([{ op: 'move', task: 'nope', deltaDays: 1 }], base());
  return !results[0].ok && !!results[0].reason;
})());
ok('addDependency rejects a cycle', (() => {
  // t1 already → t2 → t3; adding t3 as a predecessor of t1 closes a loop
  const { results } = interpretScheduleOps([{ op: 'addDependency', from: 't3', to: 't1', type: 'FS', lag: 0 }], base());
  return !results[0].ok && /cycle/i.test(results[0].reason || '');
})());
ok('addDependency (no cycle) adds the link', (() => {
  const { nextTasks, results } = interpretScheduleOps([{ op: 'addDependency', from: 't1', to: 't3', type: 'FS', lag: 0 }], base());
  return results[0].ok && nextTasks.find(t => t.id === 't3')!.dependencies.includes('t1');
})());
ok('removeTask strips dangling deps', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'removeTask', task: 't2' }], base());
  return !nextTasks.find(t => t.id === 't2') && !nextTasks.find(t => t.id === 't3')!.dependencies.includes('t2');
})());
ok('addTask appends after a ref', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'addTask', title: 'Cabinet procurement', durationDays: 10, after: 't1' }], base());
  return nextTasks.length === 4 && !!nextTasks.find(t => t.title === 'Cabinet procurement');
})());
ok('setCrew writes crewSize', (() => {
  const { nextTasks } = interpretScheduleOps([{ op: 'setCrew', task: 't1', crewSize: 6 }], base());
  return nextTasks.find(t => t.id === 't1')!.crewSize === 6;
})());
ok('partial application: valid applies, invalid reported', (() => {
  const { nextTasks, results } = interpretScheduleOps([
    { op: 'setDuration', task: 't1', days: 9 },
    { op: 'move', task: 'ghost', deltaDays: 2 },
  ], base());
  return nextTasks.find(t => t.id === 't1')!.durationDays === 9 && results[0].ok && !results[1].ok;
})());
```

- [ ] **Step 2: Run — expect failure** (`Cannot find module '.../interpretOps'`)

Run: `bun run scripts/validate-copilot-edit-ops.ts`

- [ ] **Step 3: Implement `interpretOps.ts`**

Create `utils/copilot/scheduleEdit/interpretOps.ts`:
```ts
// utils/copilot/scheduleEdit/interpretOps.ts — pure interpreter: apply EditOps
// to a task array with per-op guards. Never throws; every op yields an OpResult.
// React/RN-free (only domain types + cpm's wouldCreateCycle) so validators run it.
import type { ScheduleTask } from '@/types';
import { wouldCreateCycle, runCpm, type RunCpmOptions } from '@/utils/cpm';
import type { EditOp } from './editOps';

export interface OpResult { op: EditOp; ok: boolean; reason?: string }

/** Resolve a TaskRef (id, else case-insensitive title match) to a task id. */
function resolveId(ref: string, tasks: ScheduleTask[]): string | null {
  if (tasks.some(t => t.id === ref)) return ref;
  const lc = ref.trim().toLowerCase();
  const byName = tasks.find(t => t.title.trim().toLowerCase() === lc)
    ?? tasks.find(t => t.title.trim().toLowerCase().includes(lc));
  return byName?.id ?? null;
}

let seq = 0;
function freshId(): string { seq += 1; return `edit-${seq}-${(seq * 2654435761 % 100000)}`; }

export function interpretScheduleOps(
  ops: EditOp[],
  tasks: ScheduleTask[],
): { nextTasks: ScheduleTask[]; results: OpResult[] } {
  let working = tasks.map(t => ({ ...t, dependencies: [...t.dependencies], dependencyLinks: t.dependencyLinks ? [...t.dependencyLinks] : undefined }));
  const results: OpResult[] = [];
  const patch = (id: string, over: Partial<ScheduleTask>) => { working = working.map(t => t.id === id ? { ...t, ...over } : t); };

  for (const op of ops) {
    try {
      switch (op.op) {
        case 'move': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          const cur = working.find(t => t.id === id)!;
          const next = op.toStartDay != null ? op.toStartDay : cur.startDay + (op.deltaDays ?? 0);
          patch(id, { startDay: Math.max(1, Math.round(next)) });
          results.push({ op, ok: true }); break;
        }
        case 'setDuration': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          patch(id, { durationDays: Math.max(0, Math.round(op.days)) });
          results.push({ op, ok: true }); break;
        }
        case 'setProgress': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          patch(id, { progress: op.pct });
          results.push({ op, ok: true }); break;
        }
        case 'setCrew': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          patch(id, { crewSize: op.crewSize });
          results.push({ op, ok: true }); break;
        }
        case 'addDependency': {
          const toId = resolveId(op.to, working), fromId = resolveId(op.from, working);
          if (!toId || !fromId) { results.push({ op, ok: false, reason: `couldn't resolve both tasks` }); break; }
          if (wouldCreateCycle(working, toId, fromId)) { results.push({ op, ok: false, reason: `that dependency would create a cycle` }); break; }
          const to = working.find(t => t.id === toId)!;
          const deps = to.dependencies.includes(fromId) ? to.dependencies : [...to.dependencies, fromId];
          const links = [...(to.dependencyLinks ?? []).filter(l => l.taskId !== fromId), { taskId: fromId, type: op.type, lagDays: op.lag }];
          patch(toId, { dependencies: deps, dependencyLinks: links });
          results.push({ op, ok: true }); break;
        }
        case 'removeDependency': {
          const toId = resolveId(op.to, working), fromId = resolveId(op.from, working);
          if (!toId || !fromId) { results.push({ op, ok: false, reason: `couldn't resolve both tasks` }); break; }
          const to = working.find(t => t.id === toId)!;
          patch(toId, { dependencies: to.dependencies.filter(d => d !== fromId), dependencyLinks: (to.dependencyLinks ?? []).filter(l => l.taskId !== fromId) });
          results.push({ op, ok: true }); break;
        }
        case 'removeTask': {
          const id = resolveId(op.task, working);
          if (!id) { results.push({ op, ok: false, reason: `no task matching "${op.task}"` }); break; }
          working = working.filter(t => t.id !== id).map(t => ({
            ...t,
            dependencies: t.dependencies.filter(d => d !== id),
            dependencyLinks: t.dependencyLinks?.filter(l => l.taskId !== id),
          }));
          results.push({ op, ok: true }); break;
        }
        case 'addTask': {
          const afterId = op.after ? resolveId(op.after, working) : null;
          const anchor = afterId ? working.find(t => t.id === afterId) : working[working.length - 1];
          const startDay = anchor ? anchor.startDay + anchor.durationDays : 1;
          const t: ScheduleTask = {
            id: freshId(), title: op.title, phase: anchor?.phase ?? 'General',
            durationDays: op.durationDays, startDay, progress: 0, crew: '',
            crewSize: op.crew, dependencies: afterId ? [afterId] : [], notes: '',
            status: 'not_started', isMilestone: op.isMilestone,
          };
          const idx = anchor ? working.findIndex(x => x.id === anchor.id) + 1 : working.length;
          working = [...working.slice(0, idx), t, ...working.slice(idx)];
          results.push({ op, ok: true }); break;
        }
        case 'setStartDate': {
          // Handled by the capability's apply against the schedule object, not
          // the task array — record as applied so the diff can note it.
          results.push({ op, ok: true }); break;
        }
        case 'level': {
          // Applied via runCpm({levelResources:true}) in the capability, which
          // has the CPM options; the interpreter just marks it applied.
          results.push({ op, ok: true }); break;
        }
        default: results.push({ op, ok: false, reason: 'unknown op' });
      }
    } catch (e) {
      results.push({ op, ok: false, reason: (e as Error).message });
    }
  }
  return { nextTasks: working, results };
}

/** Fold effects that need CPM (currently `level`) onto the task array after the
 *  pure interpreter runs. Lives here (not in the capability) so both the
 *  capability and ScheduleDiffView import it WITHOUT a cycle. Pure. */
export function applyEditEffects(ops: EditOp[], tasks: ScheduleTask[], cpmOptions: RunCpmOptions): ScheduleTask[] {
  let out = tasks;
  if (ops.some(o => o.op === 'level')) {
    const res = runCpm(out, { ...cpmOptions, levelResources: true });
    if (res.leveledStartDays) {
      const lvl = res.leveledStartDays;
      out = out.map(t => lvl.has(t.id) ? { ...t, startDay: lvl.get(t.id)! } : t);
    }
  }
  return out;
}
```

Note: `level` and `setStartDate` are marked ok in `interpretScheduleOps` but their EFFECT is applied by `applyEditEffects` (`level`) / the capability's `apply` (`setStartDate` → schedule object). `interpretScheduleOps` is task-array-pure. `applyEditEffects` is still pure (only `runCpm` + a `RunCpmOptions` arg — no React/ctx).

- [ ] **Step 4: Run — expect pass** (`19 passed, 0 failed` total)

Run: `bun run scripts/validate-copilot-edit-ops.ts`

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/scheduleEdit/interpretOps.ts scripts/validate-copilot-edit-ops.ts
git commit -m "copilot(web-edit): pure interpretScheduleOps with cycle/ref/bounds guards"
```

---

## Task 3: diffSchedule (pure)

**Files:**
- Create: `utils/copilot/scheduleEdit/diffSchedule.ts`
- Create: `scripts/validate-copilot-diff-schedule.ts`

- [ ] **Step 1: Write the failing validator**

Create `scripts/validate-copilot-diff-schedule.ts`:
```ts
// scripts/validate-copilot-diff-schedule.ts — pure-fn validator for diffSchedule.
import { diffSchedule } from '../utils/copilot/scheduleEdit/diffSchedule';
import { runCpm } from '../utils/cpm';
import type { ScheduleTask } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const mk = (id: string, over: Partial<ScheduleTask> = {}): ScheduleTask => ({
  id, title: id, phase: 'P', durationDays: 5, startDay: 1, progress: 0, crew: '',
  dependencies: [], notes: '', status: 'not_started', ...over,
});
const before: ScheduleTask[] = [
  mk('t1', { title: 'Framing', startDay: 1, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 6, durationDays: 4, dependencies: ['t1'] }),
];
// push framing +7d and stretch rough-in dep
const after: ScheduleTask[] = [
  mk('t1', { title: 'Framing', startDay: 8, durationDays: 5 }),
  mk('t2', { title: 'Rough-in', startDay: 13, durationDays: 4, dependencies: ['t1'] }),
];
const d = diffSchedule(before, after, runCpm(before), runCpm(after), [{ summary: 'x' }]);

ok('finish delta is positive after the push', d.finishDeltaDays > 0);
ok('framing shows a start delta of +7', !!d.moved.find(m => m.name === 'Framing' && m.startDelta === 7));
ok('carries rejected reasons through', d.rejected.length === 1 && d.rejected[0].summary === 'x');
ok('added/removed empty when none', d.added.length === 0 && d.removed.length === 0);

const withNew = [...before, mk('t3', { title: 'Cabinet procurement', startDay: 1, durationDays: 10 })];
const d2 = diffSchedule(before, withNew, runCpm(before), runCpm(withNew), []);
ok('detects an added task', d2.added.length === 1 && d2.added[0].name === 'Cabinet procurement');
const d3 = diffSchedule(before, [before[0]], runCpm(before), runCpm([before[0]]), []);
ok('detects a removed task', d3.removed.length === 1 && d3.removed[0].name === 'Rough-in');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
```

- [ ] **Step 2: Run — expect failure**

Run: `bun run scripts/validate-copilot-diff-schedule.ts`

- [ ] **Step 3: Implement `diffSchedule.ts`**

Create `utils/copilot/scheduleEdit/diffSchedule.ts`:
```ts
// utils/copilot/scheduleEdit/diffSchedule.ts — pure before→after schedule diff
// for the edit preview. React/RN-free.
import type { ScheduleTask, DependencyType } from '@/types';
import type { CpmResult } from '@/utils/cpm';

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
): ScheduleDiff {
  const beforeById = new Map(before.map(t => [t.id, t]));
  const afterById = new Map(after.map(t => [t.id, t]));
  const nameOf = (id: string) => afterById.get(id)?.title ?? beforeById.get(id)?.title ?? id;

  const moved: ScheduleDiff['moved'] = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    if (!b) continue;
    const startDelta = a.startDay - b.startDay;
    const durationDelta = a.durationDays - b.durationDays;
    if (startDelta !== 0 || durationDelta !== 0) moved.push({ id: a.id, name: a.title, startDelta, durationDelta });
  }
  const added = after.filter(a => !beforeById.has(a.id))
    .map(a => ({ name: a.title, startDay: a.startDay, durationDays: a.durationDays, isMilestone: !!a.isMilestone }));
  const removed = before.filter(b => !afterById.has(b.id)).map(b => ({ name: b.title }));

  const depChanges: ScheduleDiff['depChanges'] = [];
  for (const a of after) {
    const b = beforeById.get(a.id);
    const beforeDeps = new Set(b?.dependencies ?? []);
    const afterDeps = new Set(a.dependencies);
    for (const dep of afterDeps) if (!beforeDeps.has(dep)) {
      const type = a.dependencyLinks?.find(l => l.taskId === dep)?.type ?? 'FS';
      depChanges.push({ fromName: nameOf(dep), toName: a.title, type, added: true });
    }
    for (const dep of beforeDeps) if (!afterDeps.has(dep)) depChanges.push({ fromName: nameOf(dep), toName: a.title, type: 'FS', added: false });
  }

  const critBefore = new Set([...cpmBefore.perTask].filter(([, r]) => r.isCritical).map(([id]) => id));
  const critAfter = new Set([...cpmAfter.perTask].filter(([, r]) => r.isCritical).map(([id]) => id));
  const criticalEntered = [...critAfter].filter(id => !critBefore.has(id)).map(nameOf);
  const criticalLeft = [...critBefore].filter(id => !critAfter.has(id) && afterById.has(id)).map(nameOf);

  return {
    finishBeforeDay: cpmBefore.projectFinish,
    finishAfterDay: cpmAfter.projectFinish,
    finishDeltaDays: cpmAfter.projectFinish - cpmBefore.projectFinish,
    moved, added, removed, depChanges, criticalEntered, criticalLeft, rejected,
  };
}
```

- [ ] **Step 4: Run — expect pass** (`6 passed, 0 failed`)

Run: `bun run scripts/validate-copilot-diff-schedule.ts`

- [ ] **Step 5: Commit**

```bash
git add utils/copilot/scheduleEdit/diffSchedule.ts scripts/validate-copilot-diff-schedule.ts
git commit -m "copilot(web-edit): pure diffSchedule (finish delta, moves, adds, critical transitions)"
```

---

## Task 4: Wire validators into ship-check

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the two scripts + chain entries**

In `package.json` `scripts`, after `"test:copilot-datemath"`, add:
```json
"test:copilot-edit-ops": "bun run scripts/validate-copilot-edit-ops.ts",
"test:copilot-diff-schedule": "bun run scripts/validate-copilot-diff-schedule.ts",
```
In the `"ship-check"` value, append (before the closing quote): ` && bun run test:copilot-edit-ops && bun run test:copilot-diff-schedule`.

- [ ] **Step 2: Run the two + a full ship-check**

Run: `bun run test:copilot-edit-ops && bun run test:copilot-diff-schedule`
Expected: both green. Then `bun run ship-check` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "copilot(web-edit): wire edit-ops + diff-schedule validators into ship-check"
```

---

## Task 5: Engine seams — types

**Files:**
- Modify: `utils/copilot/types.ts`

- [ ] **Step 1: Add the capability id, the review hook, and the ctx fields**

In `utils/copilot/types.ts`:
1. Add `'scheduleEdit'` to the `CopilotCapabilityId` union.
2. Add to `CopilotContext` (after `safety?: any;`):
```ts
  /** Injected by the schedule-edit panel: the desktop editor's undo-safe
   *  commit + the live task array + the CPM options it renders with, so an
   *  edit capability can preview + apply against exactly what's on screen. */
  commitTasks?: (producer: (prev: import('@/types').ScheduleTask[]) => import('@/types').ScheduleTask[]) => void;
  currentTasks?: import('@/types').ScheduleTask[];
  cpmOptions?: import('@/utils/cpm').RunCpmOptions;
```
3. Add to `CopilotCapability` (after `copy: CopilotCopy;`):
```ts
  /** When present, the shell's review phase renders THIS (e.g. an edit diff)
   *  instead of the generic reviewHeadline + Build button, wiring the passed
   *  confirm/cancel to the diff's Apply/Discard. */
  renderReview?(a: { draft: Draft; ctx: CopilotContext; confirm: () => void; cancel: () => void }): import('react').ReactNode;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → clean (no consumer references the new optional fields yet).

- [ ] **Step 3: Commit**

```bash
git add utils/copilot/types.ts
git commit -m "copilot(web-edit): additive engine seams — renderReview hook + commitTasks/currentTasks ctx"
```

---

## Task 6: CopilotShell honors renderReview

**Files:**
- Modify: `components/copilot/CopilotShell.tsx` (review phase, ~:200-211)

- [ ] **Step 1: Branch the review phase on the hook**

Find the review block (`{state.phase === 'review' && ( ... )}`). Replace its inner body so that when `cap.renderReview` exists, it renders that (passing `confirm`/`cancel`), else the existing generic review. The `confirm` handler must keep the existing post-apply nav. Concretely, wrap:
```tsx
{state.phase === 'review' && (
  cap.renderReview
    ? <View style={styles.ask}>{cap.renderReview({
        draft: state.draft, ctx,
        confirm: async () => { const a = await confirm(); if (a?.route) { onDone(); router.replace({ pathname: a.route as never, params: { id: a.projectId, projectId: a.projectId, ...(a.params ?? {}) } as never }); } else { onDone(); } },
        cancel: () => { cancel(); onDone(); },
      })}</View>
    : (
      <View style={styles.ask}>
        {/* ...existing generic review JSX unchanged... */}
      </View>
    )
)}
```
`cap`, `ctx`, `confirm`, `cancel`, `onDone`, `router` are all already in scope in `CopilotShell`. (For an edit capability, `apply` returns a routeless `Applied`, so the confirm just closes via `onDone()`.)

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit` (clean) and `npx expo lint` (0 errors). Existing capabilities (no `renderReview`) still hit the generic branch.

- [ ] **Step 3: Commit**

```bash
git add components/copilot/CopilotShell.tsx
git commit -m "copilot(web-edit): CopilotShell renders capability.renderReview in the review phase"
```

---

## Task 7: Schedule-edit grounding

**Files:**
- Create: `utils/copilot/scheduleEdit/scheduleEditGrounding.ts`

- [ ] **Step 1: Implement**

Create `utils/copilot/scheduleEdit/scheduleEditGrounding.ts`:
```ts
// utils/copilot/scheduleEdit/scheduleEditGrounding.ts — the CURRENT schedule IS
// the grounding for an edit (no history lookup). Serializes the live tasks +
// finish date so the model can resolve references and reason about the change.
import type { CopilotContext, Grounding } from '../types';
import { runCpm } from '@/utils/cpm';

export async function buildScheduleEditGrounding(c: CopilotContext): Promise<Grounding> {
  const tasks = c.currentTasks ?? [];
  const cpm = runCpm(tasks, c.cpmOptions ?? {});
  const facts: string[] = [];
  if (c.project?.name) facts.push(`Editing the schedule for ${c.project.name}.`);
  facts.push(`${tasks.length} tasks; current finish is day ${cpm.projectFinish}.`);
  const list = tasks.map(t => {
    const crit = cpm.perTask.get(t.id)?.isCritical ? ' [critical]' : '';
    return `- ${t.id} "${t.title}" start day ${t.startDay}, ${t.durationDays}d${crit}`;
  });
  return { facts, data: { taskList: list, finishDay: cpm.projectFinish } };
}
```

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**

```bash
git add utils/copilot/scheduleEdit/scheduleEditGrounding.ts
git commit -m "copilot(web-edit): schedule-edit grounding (serialize live tasks + CPM)"
```

---

## Task 8: The scheduleEdit capability + registry

**Files:**
- Create: `utils/copilot/scheduleEdit/scheduleEditCapability.ts`
- Modify: `utils/copilot/registry.ts`

- [ ] **Step 1: Implement the capability**

Create `utils/copilot/scheduleEdit/scheduleEditCapability.ts`. Draft = `{ ops: EditOp[] }`. `gaps` returns `[]` in v1 (the model asks for clarification by leaving ops empty and the review shows "nothing to change"; grounded ambiguity gaps are a follow-up). `mergeDraft` APPENDS normalized ops. `apply` interprets ops, applies `level`/`setStartDate` effects, and calls `ctx.commitTasks`. `renderReview` mounts `ScheduleDiffView` (Task 9) via `React.createElement`.
```ts
// utils/copilot/scheduleEdit/scheduleEditCapability.ts — conversational editing
// of an existing schedule. AI → EditOp[] → interpret → commit via the editor's
// own undo-safe commit(). Review renders a diff (ScheduleDiffView).
import { createElement } from 'react';
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import { normalizeEditOps, type EditOp } from './editOps';
import { interpretScheduleOps, applyEditEffects } from './interpretOps';
import { buildScheduleEditGrounding } from './scheduleEditGrounding';
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';

export interface ScheduleEditDraft { ops: EditOp[]; startDateIso?: string | null }
export interface ScheduleEditApplied { done: true }

export const scheduleEditCapability: CopilotCapability<ScheduleEditDraft, ScheduleEditApplied> = {
  id: 'scheduleEdit',
  label: 'Edit the schedule',
  aiFeature: 'scheduleCopilot',
  maxQuestions: 0,
  askThreshold: 1,
  suggestions: [
    'Push framing back a week and re-level the crew',
    'Add a two-week cabinet procurement milestone before install',
  ],
  copy: {
    voiceTitle: 'Edit the schedule',
    composeEyebrow: 'CHANGE THE SCHEDULE',
    composeQuestion: 'What should change?',
    composeHint: 'Say the change — push a task, add a milestone, re-level the crew. I’ll show the ripple before it sticks.',
    reviewHeadline: 'Here’s the change.',
    reviewSub: 'Review the ripple, then apply.',
    buildingLabel: 'Applying the change…',
    webRoute: '/schedule-pro',
  },
  buildGrounding: buildScheduleEditGrounding,
  gaps: (_draft: ScheduleEditDraft, _g: Grounding): Gap[] => [],
  buildTurnPrompt: ({ transcript, draft, grounding }) => ({
    prompt: [
      'You are MAGE Copilot EDITING an existing construction schedule.',
      'Output edit OPERATIONS against the tasks below — reference tasks by their',
      'id (the token in quotes is the name; use the id). Emit ONLY changes the',
      'contractor actually asked for. Ops:',
      '• {op:"move", task, deltaDays} or {op:"move", task, toStartDay}',
      '• {op:"setDuration", task, days}  • {op:"setCrew", task, crewSize}',
      '• {op:"setProgress", task, pct}',
      '• {op:"addDependency", from, to, type:"FS|SS|FF|SF", lag}  • {op:"removeDependency", from, to}',
      '• {op:"addTask", title, durationDays, after, isMilestone}  • {op:"removeTask", task}',
      '• {op:"level"}  (re-level / fix crew overloads)  • {op:"setStartDate", iso}',
      '',
      'CURRENT TASKS:', ...(grounding.data.taskList as string[] ?? []),
      '',
      'DRAFT OPS SO FAR: ' + JSON.stringify(draft.ops ?? []),
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY JSON: { "ops": [ ... ] }.',
    ].join('\n'),
    schemaHint: { ops: [{ op: 'move', task: 't1', deltaDays: 7 }] },
  }),
  mergeDraft: (draft, aiJson): ScheduleEditDraft => {
    const fresh = normalizeEditOps(aiJson?.ops);
    const startOp = fresh.find(o => o.op === 'setStartDate') as { iso: string } | undefined;
    return { ops: [...(draft.ops ?? []), ...fresh], startDateIso: startOp?.iso ?? draft.startDateIso ?? null };
  },
  apply: async (draft: ScheduleEditDraft, ctx: CopilotContext): Promise<ScheduleEditApplied> => {
    const ops = draft.ops ?? [];
    if (!ctx.commitTasks) return { done: true };
    ctx.commitTasks((prev) => {
      const { nextTasks } = interpretScheduleOps(ops, prev);
      return applyEditEffects(ops, nextTasks, ctx.cpmOptions ?? {});
    });
    return { done: true };
  },
  renderReview: ({ draft, ctx, confirm, cancel }) =>
    createElement(ScheduleDiffView, { ops: (draft as ScheduleEditDraft).ops ?? [], ctx, onApply: confirm, onDiscard: cancel }),
};
```
Register in `utils/copilot/registry.ts`: import `scheduleEditCapability` and add `scheduleEdit: scheduleEditCapability as CopilotCapability` to `REGISTRY`.

- [ ] **Step 2: Typecheck + lint** — `npx tsc --noEmit` (clean once Task 9's `ScheduleDiffView` exists — do Task 9 first if tsc complains about the import), `npx expo lint` 0 errors.

- [ ] **Step 3: Commit**

```bash
git add utils/copilot/scheduleEdit/scheduleEditCapability.ts utils/copilot/registry.ts
git commit -m "copilot(web-edit): scheduleEdit capability (ops → interpret → commit; diff review)"
```

---

## Task 9: ScheduleDiffView (the diff UI)

**Files:**
- Create: `components/copilot/ScheduleDiffView.tsx`

- [ ] **Step 1: Implement**

Create `components/copilot/ScheduleDiffView.tsx`. It computes the diff purely and renders it with Colors/Type/Tokens (anti-slop: NO raw hex/inline fontSize/borderRadius). Props: `{ ops, ctx, onApply, onDiscard }`.
```tsx
// components/copilot/ScheduleDiffView.tsx — the before→after preview for a
// conversational schedule edit. Pure compute (interpret → CPM → diff), memoized.
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { Hammer, X } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Colors, type ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { runCpm } from '@/utils/cpm';
import type { CopilotContext } from '@/utils/copilot/types';
import type { EditOp } from '@/utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps, applyEditEffects } from '@/utils/copilot/scheduleEdit/interpretOps';
import { diffSchedule } from '@/utils/copilot/scheduleEdit/diffSchedule';

export default function ScheduleDiffView({ ops, ctx, onApply, onDiscard }: {
  ops: EditOp[]; ctx: CopilotContext; onApply: () => void; onDiscard: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { diff, valid } = useMemo(() => {
    const before = ctx.currentTasks ?? [];
    const { nextTasks, results } = interpretScheduleOps(ops, before);
    const after = applyEditEffects(ops, nextTasks, ctx.cpmOptions ?? {});
    const rejected = results.filter(r => !r.ok).map(r => ({ summary: r.reason ?? 'skipped' }));
    const d = diffSchedule(before, after, runCpm(before, ctx.cpmOptions ?? {}), runCpm(after, ctx.cpmOptions ?? {}), rejected);
    return { diff: d, valid: results.some(r => r.ok) };
  }, [ops, ctx]);

  const dd = (n: number) => (n > 0 ? `+${n}d` : `${n}d`);
  return (
    <View style={styles.wrap}>
      <Text style={styles.eyebrow}>HERE’S THE RIPPLE</Text>
      <ScrollView style={styles.body} showsVerticalScrollIndicator={false}>
        {diff.finishDeltaDays !== 0 && (
          <Text style={styles.finish}>Finish {dd(diff.finishDeltaDays)} — day {diff.finishBeforeDay} → {diff.finishAfterDay}</Text>
        )}
        {diff.moved.map(m => (
          <Text key={m.id} style={styles.line}>{m.name}: {m.startDelta ? `start ${dd(m.startDelta)}` : ''}{m.durationDelta ? ` dur ${dd(m.durationDelta)}` : ''}</Text>
        ))}
        {diff.added.map((a, i) => <Text key={`a${i}`} style={styles.add}>+ {a.name} ({a.durationDays}d{a.isMilestone ? ', milestone' : ''})</Text>)}
        {diff.removed.map((r, i) => <Text key={`r${i}`} style={styles.remove}>− {r.name}</Text>)}
        {diff.depChanges.map((c, i) => <Text key={`d${i}`} style={styles.line}>{c.added ? '+' : '−'} dep {c.fromName} → {c.toName} ({c.type})</Text>)}
        {diff.criticalEntered.length > 0 && <Text style={styles.warn}>⚠ now critical: {diff.criticalEntered.join(', ')}</Text>}
        {diff.criticalLeft.length > 0 && <Text style={styles.line}>off critical: {diff.criticalLeft.join(', ')}</Text>}
        {diff.rejected.map((r, i) => <Text key={`x${i}`} style={styles.reject}>couldn’t: {r.summary}</Text>)}
        {!valid && <Text style={styles.reject}>Nothing to change — try rephrasing.</Text>}
      </ScrollView>
      <TouchableOpacity style={[styles.apply, !valid && styles.applyOff]} onPress={onApply} disabled={!valid} activeOpacity={0.9}>
        <Hammer size={18} color={Colors.textOnAccent} strokeWidth={2} />
        <Text style={styles.applyText}>Apply it</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.discard} onPress={onDiscard} activeOpacity={0.7}>
        <X size={14} color={colors.textMuted} strokeWidth={2} />
        <Text style={styles.discardText}>Not that — discard</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: Tokens.spacing.sm },
    eyebrow: { ...Type.monoLabel, color: colors.accent },
    body: { maxHeight: 320 },
    finish: { ...Type.subheadEmphasized, color: colors.text, marginBottom: Tokens.spacing.xs },
    line: { ...Type.body, color: colors.textSecondary, paddingVertical: Tokens.spacing.xxs },
    add: { ...Type.body, color: colors.success, paddingVertical: Tokens.spacing.xxs },
    remove: { ...Type.body, color: colors.danger, paddingVertical: Tokens.spacing.xxs },
    warn: { ...Type.body, color: colors.accent, paddingVertical: Tokens.spacing.xxs },
    reject: { ...Type.footnote, color: colors.textMuted, paddingVertical: Tokens.spacing.xxs },
    apply: { flexDirection: 'row', gap: Tokens.spacing.xs, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderRadius: Tokens.radius.full, paddingVertical: Tokens.spacing.md, marginTop: Tokens.spacing.sm },
    applyOff: { opacity: 0.4 },
    applyText: { ...Type.subheadEmphasized, color: Colors.textOnAccent },
    discard: { flexDirection: 'row', gap: Tokens.spacing.xxs, alignItems: 'center', justifyContent: 'center', paddingVertical: Tokens.spacing.sm },
    discardText: { ...Type.footnote, color: colors.textMuted },
  });
}
```
Verify `colors.success`/`colors.danger` exist in `constants/colors.ts`; if not, use `colors.accent`/`colors.textMuted`. (Emoji ⚠ in a Text string is allowed — the anti-slop rule bans emoji-AS-ICONS, i.e. in place of a Lucide icon component, not inline in copy. If `test:app-slop` flags it, replace with a Lucide `AlertTriangle` inline.)

- [ ] **Step 2: Typecheck + lint + slop** — `npx tsc --noEmit`, `npx expo lint`, `bun run test:app-slop` all clean.

- [ ] **Step 3: Commit**

```bash
git add components/copilot/ScheduleDiffView.tsx
git commit -m "copilot(web-edit): ScheduleDiffView — before→after ripple preview"
```

---

## Task 10: ScheduleEditPanel + mount in schedule-pro

**Files:**
- Create: `components/copilot/ScheduleEditPanel.tsx`
- Modify: `app/schedule-pro.tsx`

- [ ] **Step 1: Implement the panel host**

Create `components/copilot/ScheduleEditPanel.tsx` — a modal/overlay wrapping `CopilotShell` with the ctx seam:
```tsx
// components/copilot/ScheduleEditPanel.tsx — hosts the copilot shell for
// conversational schedule editing, wiring the editor's commit + live tasks +
// CPM options into ctx so the edit previews + applies against what's on screen.
import React from 'react';
import { Modal, View, StyleSheet } from 'react-native';
import CopilotShell from '@/components/copilot/CopilotShell';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import type { ScheduleTask } from '@/types';
import type { RunCpmOptions } from '@/utils/cpm';

export default function ScheduleEditPanel({ visible, onClose, projectId, tasks, commit, cpmOptions }: {
  visible: boolean; onClose: () => void; projectId: string;
  tasks: ScheduleTask[];
  commit: (producer: (prev: ScheduleTask[]) => ScheduleTask[]) => void;
  cpmOptions: RunCpmOptions;
}) {
  const projectsCtx = useProjects() as any;
  const { tier } = useSubscription();
  if (!visible) return null;
  const project = projectsCtx.getProject?.(projectId) ?? null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <CopilotShell
            capabilityId={'scheduleEdit' as never}
            ctx={{ project, projectId, ctx: projectsCtx, tier, commitTasks: commit, currentTasks: tasks, cpmOptions }}
            onDone={onClose}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  sheet: { height: '82%' },
});
```

- [ ] **Step 2: Mount it in `app/schedule-pro.tsx`**

In `ScheduleProScreen` (the desktop component): add `const [editOpen, setEditOpen] = useState(false);`. Add an "Edit by voice" control near the existing toolbar (mirror an existing header button; label "Ask MAGE to edit", `Mic`/`Sparkles` icon → `setEditOpen(true)`). Render at the end of the component tree:
```tsx
<ScheduleEditPanel
  visible={editOpen}
  onClose={() => setEditOpen(false)}
  projectId={project.id}
  tasks={workingTasks}
  commit={commit}
  cpmOptions={{ scheduleStartDate: scheduleStartIso, /* pass the same opts runCpm gets at :281 */ }}
/>
```
Use the SAME options object the screen passes to `runCpm` at :281 (scheduleStartDate + workingDaysPerWeek + nonWorkingDates + taskCalendars if present) so the preview CPM matches the editor. Import `ScheduleEditPanel`.

- [ ] **Step 3: Typecheck + lint** — `npx tsc --noEmit`, `npx expo lint` clean.

- [ ] **Step 4: Commit**

```bash
git add components/copilot/ScheduleEditPanel.tsx app/schedule-pro.tsx
git commit -m "copilot(web-edit): ScheduleEditPanel + 'Ask MAGE to edit' entry in the desktop scheduler"
```

---

## Task 11: Final gate

- [ ] **Step 1: Full ship-check**

Run: `bun run ship-check` → exit 0 (typecheck + lint + all validators incl. the two new).

- [ ] **Step 2: Commit any fixups**, then the feature is ready for review + live sim verification (owner-gated merge/OTA).

---

## Notes for the implementer

- **`level`/`setStartDate` effects**: `level` is applied by `applyEditEffects` (in `interpretOps.ts`, pure — takes `RunCpmOptions`); `setStartDate` is handled in the capability's `apply` against the schedule object. Neither lives in `interpretScheduleOps` (task-array-only). `applyEditEffects` sits in `interpretOps.ts` (not the capability) so both the capability and `ScheduleDiffView` import it without a circular dependency. Keep that boundary — it's what keeps the pure files validator-safe.
- **`setStartDate`** only affects the schedule object's start date, not tasks; v1 records it in the draft (`startDateIso`) and the diff notes it. Persisting the schedule start (vs tasks) is out of the `commitTasks` path — if you wire it, do it via `updateProject({ schedule: { ...schedule, startDate } })` in `apply` alongside `commitTasks`; otherwise leave `setStartDate` as a no-op-with-note in v1 and flag it.
- **Undo:** because `apply` goes through the editor's `commit()`, the AI edit lands on the same `scheduleHistory` stack — Cmd/Ctrl-Z (or the editor's undo control) reverts it like any manual edit. No separate undo needed.
- **Gaps are empty in v1** (`maxQuestions: 0`). Grounded ambiguity clarifiers (ambiguous ref → choice, "re-level to what cap?" → number) are a fast-follow once the core loop is verified live.
