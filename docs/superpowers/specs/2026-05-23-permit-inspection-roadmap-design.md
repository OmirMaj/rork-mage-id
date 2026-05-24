# Auto Permit & Inspection Roadmap (Construction AI — B) — Design

**Date:** 2026-05-23
**Status:** Approved (design) — ready for implementation plan
**Scope:** v1 of feature **B**. Feature **A** (Plan Code Red-Line) is the planned next, its own spec.

## Goal

Turn the Construction AI tool from a *generic* code/permit Q&A into a **project-aware** assistant: it reads *this project's* estimate, schedule, and location and produces a **sequenced permit + inspection roadmap** tied to the actual timeline. The moat: a standalone AI has none of the GC's project data — this does.

## What it is

A new **"Project Roadmap"** mode in `app/(tabs)/construction-ai/index.tsx` (alongside the existing "Code Check"). Pick a project → AI returns:
- **Permits needed**, inferred from the estimate's actual line items (e.g. "200A panel upgrade" → electrical permit; "remove load-bearing wall" → structural permit), each with who-pulls + lead time + status.
- **Inspections**, sequenced to the schedule: each inspection's *gating task* and a computed **book-by date** (gating task start − lead time), with status.
- **Flags**: e.g. "electrical permit not pulled and rough-electrical gates Drywall (May 14) → pull now / book inspector by May 10."

Saved per project (trackable + regenerate-able), and each permit can flow into the existing synced `Permit` tracker.

## Architecture (OTA-safe — AI + existing data; no native modules, no migration)

### AI call
`mageAISmart` (the existing relay) with a new zod schema. Prompt built from:
- `project.location` (jurisdiction), `project.type`,
- **estimate scope summary** — top line items / scope text from `project.linkedEstimate ?? project.estimate`,
- **schedule task list** — `project.schedule.tasks` titles + phases + startDay.

New `FEATURE_LIMITS.ai_permit_roadmap_daily` entry (mirror `ai_code_check_daily`: free 2, pro 15, business unlimited) + the `ai_permit_roadmap` usage feature (mirror the `ai_code_check` increment in the current screen). Cached via mageAI `cacheKey` = `roadmap::<projectId>::<scopeHash>`.

### Output schema (AI returns the content; app assigns ids/status/dates)
```ts
// AI returns arrays of these (without id/status):
roadmapPermit:    { type, title, description, whoPulls: 'gc'|'sub'|'owner', leadTimeDays }
roadmapInspection:{ type, title, description, gatesTaskHint, leadTimeDays }
```

### Data model (types/index.ts)
```ts
export interface RoadmapPermit {
  id: string;
  type: string;            // electrical | structural | plumbing | building | mechanical | demolition | zoning | other
  title: string;
  description: string;     // why it's needed (ties to the scope line)
  whoPulls: 'gc' | 'sub' | 'owner';
  leadTimeDays: number;
  status: 'needed' | 'applied' | 'approved';
  linkedPermitId?: string; // set when "Add to Permits" creates a real Permit
}
export interface RoadmapInspection {
  id: string;
  type: string;            // rough_electrical | framing | final | ...
  title: string;
  description: string;
  gatesTaskHint: string;   // phase/keyword it precedes, e.g. "Drywall"
  gatesTaskId?: string;    // resolved schedule task id (fuzzy match)
  leadTimeDays: number;
  status: 'pending' | 'scheduled' | 'passed';
}
export interface PermitRoadmap {
  id: string;
  projectId: string;
  generatedAt: string;
  scopeHash: string;       // detects estimate/schedule drift since generation
  permits: RoadmapPermit[];
  inspections: RoadmapInspection[];
}
```

### Schedule tie-in (`utils/permitRoadmap.ts`, pure functions)
- `resolveGatingTask(hint, tasks)`: find the schedule task whose `title`/`phase` contains the hint (case-insensitive, first match) → `gatesTaskId`.
- `bookByDate(inspection, tasks, startDate)`: if resolved, `gatingTask.startDay → date (startDate + days)` minus `leadTimeDays`. Returns null if unresolved.
- `roadmapFlags(roadmap, tasks, startDate)`: produces the actionable flags — a permit `status==='needed'` whose earliest gating inspection book-by is within 14 days (or past); an inspection `status==='pending'` whose book-by ≤ today+7 (or past).
- `scopeHashOf(project)`: stable hash of the estimate line items + task list, to detect drift and prompt "scope changed — regenerate."

### Persistence (`tertiary_permit_roadmaps`, local-first — mirror the PlanZone/DrawingPin pattern)
ProjectContext gains: state `permitRoadmaps: PermitRoadmap[]`, `getPermitRoadmapForProject(projectId)`, `savePermitRoadmap(roadmap)` (upsert — one per project), `updatePermitRoadmap(id, patch)` (for status toggles), `deletePermitRoadmap(id)`. **No `supabaseWrite`** (v1 local-first; no migration). Regenerate preserves prior item `status` by title match where possible.

### Existing-tracker integration
Each `RoadmapPermit` has an **"Add to Permits"** action → `addPermit({ projectId, projectName, type, jurisdiction: project.location, status: 'pending', phase: …, … })` via the existing synced permits collection, and sets `linkedPermitId` so it isn't added twice.

## Where it lives & UX
- Construction AI tool: a top mode toggle **[ Code Check | Project Roadmap ]**.
- Project Roadmap: project picker → if none saved, **"Generate roadmap"** (AI, gated/limited) → renders two sections (Permits, Inspections) with status chips, book-by dates, flags banner at top, "Add to Permits" per permit, and **"Regenerate"** (highlighted when `scopeHash` drifted).

## Edge cases
- **No estimate** → AI works from `project.type` + description (degraded; note "based on project type").
- **No schedule/tasks** → inspections render without book-by dates (hint only).
- **No location** → AI returns generic IRC/IBC guidance + a "jurisdiction unknown — verify locally" banner.
- **AI failure / rate-limited** → error state + retry; daily-limit message reuses the existing `ai_code_check`-style alert.
- **Regenerate** → replaces the roadmap but carries over `status` for items whose `title` matches a prior item.
- **Unmatched inspection** → shown with hint, no date; GC can tap to link a task (v1: link via a task picker, optional — if it bloats, defer linking to A/later and just show the hint).

## Testing & gates
No unit runner (per CLAUDE.md). Gate per task = `npx tsc --noEmit` clean + grep assertions. Strict TS, no `any`, theme-aware, iOS + web, OTA-safe.

## Out of scope (v1)
- Auto-creating schedule **milestones** for inspections.
- Cross-device **sync** of the roadmap (local-first now; a `permit_roadmaps` table later).
- A jurisdiction-specific **lead-time database** (AI estimates lead times in v1).
- IBC special-inspection report-cadence automation.
- Feature **A** (Plan Code Red-Line) — separate spec, next.
