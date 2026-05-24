# Permit & Inspection Roadmap (Construction AI — B v1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a project-aware "Project Roadmap" mode to the Construction AI tool that reads the project's estimate + schedule + location and produces a sequenced permit + inspection roadmap (gating tasks, book-by dates, flags), saved + trackable, integrated with the existing Permit tracker.

**Architecture:** A pure util (`utils/permitRoadmap.ts`) builds the AI prompt, calls the existing `mageAISmart` relay with a zod schema, and post-processes the result (ids, default statuses, gating-task resolution). The roadmap persists local-first in ProjectContext (`tertiary_plan_roadmaps`, mirroring `DrawingPin`/`PlanZone` — no `supabaseWrite`, no migration). The Construction AI screen gains a Code-Check | Project-Roadmap mode toggle. Each roadmap permit can be promoted into the existing synced `Permit` collection.

**Tech Stack:** React Native / Expo, TypeScript strict, `zod`, `mageAISmart`, `useTierAccess`/`FEATURE_LIMITS`, AsyncStorage via ProjectContext, lucide-react-native.

**Per-task gate:** `npx tsc --noEmit` clean at the worktree root (NO unit runner per CLAUDE.md) + the grep in each task. Strict TS, no `any`, theme-aware, OTA-safe (no native modules, no migration, no `supabaseWrite` for the roadmap).

---

## File Structure

- **Modify** `types/index.ts` — add `RoadmapPermit`, `RoadmapInspection`, `PermitRoadmap`, `RoadmapFlag`.
- **Create** `utils/permitRoadmap.ts` — the zod schema, prompt builder, `generateRoadmap`, and pure helpers (`resolveGatingTask`, `bookByDate`, `roadmapFlags`, `scopeHashOf`). No React.
- **Modify** `contexts/ProjectContext.tsx` — `tertiary_plan_roadmaps` sub-collection + CRUD (mirror `DrawingPin`, local-first).
- **Modify** `hooks/useTierAccess.ts` — add `ai_permit_roadmap_daily` to `FEATURE_LIMITS`.
- **Modify** `app/(tabs)/construction-ai/index.tsx` — mode toggle + the Project Roadmap mode (picker, generate/regenerate, render, "Add to Permits").

---

## Task 1: Types

**Files:** Modify `types/index.ts` (add near the `Permit` interface)

- [ ] **Step 1: Add the types**

```ts
export interface RoadmapPermit {
  id: string;
  type: string;            // AI label: electrical | structural | plumbing | building | mechanical | demolition | zoning | other
  title: string;
  description: string;
  whoPulls: 'gc' | 'sub' | 'owner';
  leadTimeDays: number;
  status: 'needed' | 'applied' | 'approved';
  linkedPermitId?: string;
}
export interface RoadmapInspection {
  id: string;
  type: string;
  title: string;
  description: string;
  gatesTaskHint: string;
  gatesTaskId?: string;
  leadTimeDays: number;
  status: 'pending' | 'scheduled' | 'passed';
}
export interface PermitRoadmap {
  id: string;
  projectId: string;
  generatedAt: string;
  scopeHash: string;
  permits: RoadmapPermit[];
  inspections: RoadmapInspection[];
}
export interface RoadmapFlag {
  kind: 'permit' | 'inspection';
  itemId: string;
  message: string;
  severity: 'high' | 'med';
}
```

- [ ] **Step 2: Gate** — `npx tsc --noEmit` → clean. `grep -c "interface PermitRoadmap" types/index.ts` → 1.
- [ ] **Step 3: Commit** — `git add types/index.ts && git commit -m "feat(roadmap): permit/inspection roadmap types"`

---

## Task 2: Roadmap util (schema, prompt, generate, helpers)

**Files:** Create `utils/permitRoadmap.ts`

**Verify first:** the Estimate line-item array field name (open `types/index.ts`, find the `Estimate` interface — likely `lineItems` with `.description`/`.name`). Use the real field in `scopeHashOf` + the prompt. `createId` is exported from `@/utils/scheduleEngine`.

- [ ] **Step 1: Write the util**

```ts
import { z } from 'zod';
import type { Project, ScheduleTask, PermitRoadmap, RoadmapPermit, RoadmapInspection, RoadmapFlag } from '@/types';
import { mageAISmart } from '@/utils/mageAI';
import { createId } from '@/utils/scheduleEngine';

const MS_DAY = 86400000;

export const roadmapSchema = z.object({
  permits: z.array(z.object({
    type: z.string().catch('other').default('other'),
    title: z.string().catch('').default(''),
    description: z.string().catch('').default(''),
    whoPulls: z.enum(['gc', 'sub', 'owner']).catch('gc').default('gc'),
    leadTimeDays: z.number().catch(5).default(5),
  })).default([]),
  inspections: z.array(z.object({
    type: z.string().catch('other').default('other'),
    title: z.string().catch('').default(''),
    description: z.string().catch('').default(''),
    gatesTaskHint: z.string().catch('').default(''),
    leadTimeDays: z.number().catch(3).default(3),
  })).default([]),
});

// VERIFY the Estimate line-item field; this uses `lineItems[].description`.
function scopeSummary(project: Project): string {
  const est = project.linkedEstimate ?? project.estimate;
  const items = (est && 'lineItems' in est && Array.isArray(est.lineItems))
    ? est.lineItems.map((li) => (li as { description?: string; name?: string }).description ?? (li as { name?: string }).name ?? '').filter(Boolean)
    : [];
  return items.slice(0, 60).join('; ');
}

export function scopeHashOf(project: Project): string {
  const tasks = (project.schedule?.tasks ?? []).map((t) => `${t.title}:${t.startDay}:${t.durationDays}`).join('|');
  const s = scopeSummary(project) + '::' + tasks;
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

export function resolveGatingTask(hint: string, tasks: ScheduleTask[]): ScheduleTask | null {
  const h = hint.trim().toLowerCase();
  if (!h) return null;
  return tasks.find((t) => (t.title || '').toLowerCase().includes(h) || (t.phase || '').toLowerCase().includes(h)) ?? null;
}

export function bookByDate(insp: RoadmapInspection, tasks: ScheduleTask[], startDate: string): Date | null {
  const t = insp.gatesTaskId ? tasks.find((x) => x.id === insp.gatesTaskId) : null;
  if (!t) return null;
  const base = new Date(startDate); base.setHours(0, 0, 0, 0);
  return new Date(base.getTime() + (t.startDay ?? 0) * MS_DAY - insp.leadTimeDays * MS_DAY);
}

export function roadmapFlags(roadmap: PermitRoadmap, tasks: ScheduleTask[], startDate: string): RoadmapFlag[] {
  const out: RoadmapFlag[] = [];
  const now = Date.now();
  for (const insp of roadmap.inspections) {
    if (insp.status === 'passed') continue;
    const by = bookByDate(insp, tasks, startDate);
    if (by && by.getTime() <= now + 7 * MS_DAY) {
      const overdue = by.getTime() < now;
      out.push({ kind: 'inspection', itemId: insp.id, severity: overdue ? 'high' : 'med',
        message: `${insp.title}: ${overdue ? 'book-by date passed' : 'book by ' + by.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` });
    }
  }
  for (const p of roadmap.permits) {
    if (p.status === 'needed') out.push({ kind: 'permit', itemId: p.id, severity: 'med', message: `${p.title}: not pulled yet` });
  }
  return out;
}

export async function generateRoadmap(project: Project): Promise<{ ok: true; roadmap: PermitRoadmap } | { ok: false; error: string }> {
  const tasks = project.schedule?.tasks ?? [];
  const taskList = tasks.map((t) => `- ${t.title} [${t.phase || 'General'}] day ${t.startDay ?? 0}`).join('\n');
  const prompt = `You are a construction permitting expert. For this project, list the PERMITS required (inferred from the scope) and the INSPECTIONS required, sequenced to the schedule.\n\nLOCATION: ${project.location || 'unknown'}\nPROJECT TYPE: ${project.type || 'unknown'}\nSCOPE (estimate line items): ${scopeSummary(project) || '(none — infer from project type)'}\nSCHEDULE TASKS:\n${taskList || '(no schedule)'}\n\nFor each permit: type, title, description (tie to the scope), whoPulls (gc/sub/owner), leadTimeDays (typical issuance lead).\nFor each inspection: type, title, description, gatesTaskHint (the schedule task/phase keyword this inspection must precede, e.g. "Drywall"), leadTimeDays (book-ahead lead).\nReturn ONLY JSON matching the schema.`;
  const res = await mageAISmart(prompt, roadmapSchema, `roadmap::${project.id}::${scopeHashOf(project)}`);
  if (!res.success) return { ok: false, error: res.error || 'Roadmap unavailable right now.' };
  const data = res.data as z.infer<typeof roadmapSchema>;
  const roadmap: PermitRoadmap = {
    id: createId('roadmap'),
    projectId: project.id,
    generatedAt: new Date().toISOString(),
    scopeHash: scopeHashOf(project),
    permits: data.permits.map((p) => ({ ...p, id: createId('rmp'), status: 'needed' as const })),
    inspections: data.inspections.map((i) => {
      const t = resolveGatingTask(i.gatesTaskHint, tasks);
      return { ...i, id: createId('rmi'), status: 'pending' as const, gatesTaskId: t?.id };
    }),
  };
  return { ok: true, roadmap };
}
```

- [ ] **Step 2: Gate** — `npx tsc --noEmit` → clean (fix the Estimate field name if it differs). `grep -c "export async function generateRoadmap" utils/permitRoadmap.ts` → 1.
- [ ] **Step 3: Commit** — `git add utils/permitRoadmap.ts && git commit -m "feat(roadmap): generateRoadmap + scheduling helpers"`

---

## Task 3: ProjectContext persistence (local-first)

**Files:** Modify `contexts/ProjectContext.tsx` — mirror the `DrawingPin` blocks (key ~line 36, interface ~163, state/load/persist ~2919, value `useMemo` ~3195). **No `supabaseWrite`.** `generateUUID`/`loadLocal`/`saveLocal`/`useCallback` already exist.

- [ ] **Step 1: Key** — after the plan-zones/markups keys add `const PLAN_ROADMAPS_KEY = 'tertiary_plan_roadmaps';`
- [ ] **Step 2: Interface members** — add to the context interface + the `import type { … } from '@/types'`:
```ts
  permitRoadmaps: PermitRoadmap[];
  getPermitRoadmapForProject: (projectId: string) => PermitRoadmap | undefined;
  savePermitRoadmap: (roadmap: PermitRoadmap) => void;       // upsert by projectId (one per project)
  updatePermitRoadmap: (id: string, patch: Partial<PermitRoadmap>) => void;
  deletePermitRoadmap: (id: string) => void;
```
- [ ] **Step 3: State + load + persist**
```ts
  const [permitRoadmaps, setPermitRoadmaps] = useState<PermitRoadmap[]>([]);
  // in the load useEffect: void loadLocal<PermitRoadmap[]>(PLAN_ROADMAPS_KEY, []).then(setPermitRoadmaps);
  const persistPermitRoadmaps = useCallback((list: PermitRoadmap[]) => {
    setPermitRoadmaps(list);
    void saveLocal(PLAN_ROADMAPS_KEY, list);
  }, []);
```
- [ ] **Step 4: CRUD (local-only, upsert one per project)**
```ts
  const getPermitRoadmapForProject = useCallback((projectId: string) => permitRoadmaps.find((r) => r.projectId === projectId), [permitRoadmaps]);
  const savePermitRoadmap = useCallback((roadmap: PermitRoadmap) => {
    persistPermitRoadmaps([roadmap, ...permitRoadmaps.filter((r) => r.projectId !== roadmap.projectId)]);
  }, [permitRoadmaps, persistPermitRoadmaps]);
  const updatePermitRoadmap = useCallback((id: string, patch: Partial<PermitRoadmap>) => {
    persistPermitRoadmaps(permitRoadmaps.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, [permitRoadmaps, persistPermitRoadmaps]);
  const deletePermitRoadmap = useCallback((id: string) => {
    persistPermitRoadmaps(permitRoadmaps.filter((r) => r.id !== id));
  }, [permitRoadmaps, persistPermitRoadmaps]);
```
- [ ] **Step 5: Expose** — add the 5 names (+ `persistPermitRoadmaps`) to the context-value `useMemo` return + its dependency array.
- [ ] **Step 6: Gate** — `npx tsc --noEmit` → clean. `grep -c "tertiary_plan_roadmaps\|savePermitRoadmap" contexts/ProjectContext.tsx` → ≥2.
- [ ] **Step 7: Commit** — `git add types/index.ts contexts/ProjectContext.tsx && git commit -m "feat(roadmap): tertiary_plan_roadmaps local storage in ProjectContext"`

---

## Task 4: Tier limit entry

**Files:** Modify `hooks/useTierAccess.ts` (the `FEATURE_LIMITS` const, ~line 101)

- [ ] **Step 1:** add next to `ai_code_check_daily`:
```ts
  ai_permit_roadmap_daily: { free: 2, pro: 15, business: 50, enterprise: Infinity },
```
- [ ] **Step 2: Gate** — `npx tsc --noEmit` → clean. `grep -c "ai_permit_roadmap_daily" hooks/useTierAccess.ts` → 1.
- [ ] **Step 3: Commit** — `git add hooks/useTierAccess.ts && git commit -m "feat(roadmap): ai_permit_roadmap daily limit"`

---

## Task 5: "Project Roadmap" mode in the Construction AI screen

**Files:** Modify `app/(tabs)/construction-ai/index.tsx`

**Read first:** the existing screen's AI-usage flow (the `supabase.rpc` increment with `p_feature: 'ai_code_check'` ~lines 135-160, the `dailyCap`/`FEATURE_LIMITS.ai_code_check_daily[tier]` check, the in-flight loader Modal, and the result accordion Modal). **Mirror that exact pattern** for the roadmap (use `p_feature: 'ai_permit_roadmap'` and `FEATURE_LIMITS.ai_permit_roadmap_daily[tier]`).

- [ ] **Step 1: Add a mode toggle + state**

At the top of the screen body add `const [mode, setMode] = useState<'code' | 'roadmap'>('code');` and a segmented control `[ Code Check | Project Roadmap ]` above the existing content. When `mode === 'code'` render the existing UI unchanged; when `mode === 'roadmap'` render the new block (below).

- [ ] **Step 2: Roadmap block**

Use `const { projects, getPermitRoadmapForProject, savePermitRoadmap, updatePermitRoadmap, addPermit } = useProjects();` and a `const [roadmapProjectId, setRoadmapProjectId] = useState<string | null>(projects[0]?.id ?? null);`. Resolve `const project = projects.find(p => p.id === roadmapProjectId)` and `const roadmap = project ? getPermitRoadmapForProject(project.id) : undefined`.

- A **project picker** (reuse the app's cycle/picker style — a tap-to-cycle header like MobileScheduleScreen, or a simple list).
- If no `roadmap`: a **"Generate roadmap"** button → (a) check daily cap (mirror code-check); (b) `const res = await generateRoadmap(project)`; (c) on `res.ok` → `savePermitRoadmap(res.roadmap)` + record usage (`p_feature: 'ai_permit_roadmap'`); on `!res.ok` → alert. Show the in-flight loader Modal (reuse).
- If `roadmap` exists: render two sections —
  - **Permits**: each `RoadmapPermit` row → title, description, whoPulls + leadTimeDays, a status chip cycling `needed → applied → approved` (calls `updatePermitRoadmap(roadmap.id, { permits: … })`), and an **"Add to Permits"** button (Task 6) hidden once `linkedPermitId` is set.
  - **Inspections**: each `RoadmapInspection` row → title, description, the gating task (look up `gatesTaskId` in `project.schedule?.tasks` → its title, else show `gatesTaskHint`), the **book-by date** (`bookByDate(insp, tasks, startDate)` → formatted, or "—"), and a status chip cycling `pending → scheduled → passed`.
  - A **flags banner** at top from `roadmapFlags(roadmap, tasks, startDate)` (high = danger color, med = warning).
  - A **"Regenerate"** button (highlighted when `roadmap.scopeHash !== scopeHashOf(project)`), which re-runs generate but **carries over status** by matching `title` to prior items before `savePermitRoadmap`.
- Import `{ generateRoadmap, bookByDate, roadmapFlags, scopeHashOf }` from `@/utils/permitRoadmap`; `useProjects` from `@/contexts/ProjectContext`. Theme via the screen's existing `Colors`/`Type`/`Tokens`.

- [ ] **Step 3: Gate** — `npx tsc --noEmit` → clean. `grep -c "generateRoadmap\|Project Roadmap" "app/(tabs)/construction-ai/index.tsx"` → ≥2.
- [ ] **Step 4: Commit** — `git add "app/(tabs)/construction-ai/index.tsx" && git commit -m "feat(roadmap): Project Roadmap mode in Construction AI"`

---

## Task 6: "Add to Permits" → existing synced Permit tracker

**Files:** Modify `app/(tabs)/construction-ai/index.tsx` (the permit-row action from Task 5)

`addPermit` signature: `(permit: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'>) => Permit`. `PermitType` is the fixed union `building|electrical|plumbing|mechanical|demolition|grading|fire|occupancy|special_inspection|other` — map the AI's free-text `type`.

- [ ] **Step 1: Map + add**

```ts
const PERMIT_TYPE_MAP: Record<string, import('@/types').PermitType> = {
  electrical: 'electrical', plumbing: 'plumbing', mechanical: 'mechanical', hvac: 'mechanical',
  building: 'building', structural: 'building', demolition: 'demolition', demo: 'demolition',
  grading: 'grading', fire: 'fire', occupancy: 'occupancy', zoning: 'other',
};
const toPermitType = (t: string): import('@/types').PermitType => PERMIT_TYPE_MAP[t.trim().toLowerCase()] ?? 'other';

const onAddToPermits = (p: RoadmapPermit) => {
  if (!project || p.linkedPermitId) return;
  const created = addPermit({
    projectId: project.id,
    projectName: project.name,
    type: toPermitType(p.type),
    jurisdiction: project.location || '',
    status: 'applied',
    appliedDate: new Date().toISOString(),
    fee: 0,
    notes: p.description,
  });
  updatePermitRoadmap(roadmap!.id, {
    permits: roadmap!.permits.map((x) => (x.id === p.id ? { ...x, linkedPermitId: created.id, status: 'applied' } : x)),
  });
  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
};
```
(If the real `Permit` type requires other non-optional fields beyond those above, supply sensible defaults — check the `Permit` interface.)

- [ ] **Step 2: Gate** — `npx tsc --noEmit` → clean. `grep -c "addPermit(" "app/(tabs)/construction-ai/index.tsx"` → ≥1.
- [ ] **Step 3: Commit** — `git add "app/(tabs)/construction-ai/index.tsx" && git commit -m "feat(roadmap): Add-to-Permits wires roadmap into the permit tracker"`

---

## Deferred (post-v1)
- Auto-create schedule **milestones** for inspections.
- Cross-device **sync** of the roadmap (a `plan_roadmaps` table).
- Jurisdiction lead-time **database**.
- Manual **link** of an unmatched inspection to a task (v1 shows the hint only).
- Feature **A** (Plan Code Red-Line) — separate spec.

## Self-Review
**Spec coverage:** types (T1), util+AI+helpers (T2), local persistence (T3), tier limit (T4), Project Roadmap mode + render + generate/regenerate + flags (T5), Add-to-Permits (T6). Schedule tie-in (resolveGatingTask/bookByDate/roadmapFlags) in T2, used in T5. All spec sections covered. ✓
**Placeholder scan:** full code for T1-T4 + T6; T5 gives precise construction + the exact pattern to mirror (ai_code_check flow) rather than re-pasting the large existing screen — acceptable. Two flagged verification points (Estimate line-item field name; any extra required Permit fields) are concrete "check the real type" instructions, not vague TODOs. ✓
**Type consistency:** `PermitRoadmap`/`RoadmapPermit`/`RoadmapInspection`/`RoadmapFlag` (T1) used identically in T2/T3/T5/T6. `generateRoadmap`/`bookByDate`/`roadmapFlags`/`scopeHashOf`/`resolveGatingTask` (T2) consumed in T5. `ai_permit_roadmap_daily` (T4) used in T5. `addPermit` signature matches T6. ✓
