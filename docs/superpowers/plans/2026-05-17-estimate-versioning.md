# Estimate Versioning + F0 Money-Spine Unify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make estimate writes never silently destroy the prior number — milestone-driven immutable revisions on the project, a per-CSI-category "what changed" diff + restore, and one shared estimate-total accessor so budget/contract/AIA never disagree (F0).

**Architecture:** A pure helper module `utils/estimateCommit.ts` produces `Partial<Project>` patches; the 5 scattered `updateProject({ linkedEstimate })` overwrite sites apply those patches via the existing `updateProject`. Revisions persist as a new `estimate_versions jsonb` column on `public.projects` (same offline-first path as `linked_estimate`).

**Tech Stack:** React Native / Expo Router (TypeScript strict), Supabase Postgres (jsonb column + migration), `@tanstack/react-query`/context for project state. Spec: `docs/superpowers/specs/2026-05-17-estimate-versioning-design.md`.

**Verification model (READ THIS):** No unit-test runner in this repo. The TDD red/green template does not apply. Every task's gate is (1) `npx tsc --noEmit` clean and (2) the specific manual check named in the task (from spec §7). Run all commands from the worktree root `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main` (HEAD `d97f977`).

**Confirmed shapes (do not re-derive):**
- `updateProject(id: string, updates: Partial<Project>)` and `getProject(id) => Project | null` — `contexts/ProjectContext.tsx:1117,1142`.
- `LinkedEstimate = { id; items: LinkedEstimateItem[]; globalMarkup; baseTotal; markupTotal; grandTotal; createdAt }` (`types/index.ts`). `LinkedEstimateItem` has `category`, optional `csiDivision`, `lineTotal`, etc. `Project.linkedEstimate?: LinkedEstimate | null` (`types/index.ts:164`); legacy `Project.estimate: EstimateBreakdown | null` (`types/index.ts:162`) — `EstimateBreakdown` has `grandTotal`.
- `linked_estimate` persistence: read-map `contexts/ProjectContext.tsx:136` (`linkedEstimate: r.linked_estimate as Project['linkedEstimate']`); sync upsert `contexts/ProjectContext.tsx:957` (`linked_estimate: project.linkedEstimate as unknown, status: project.status,`).
- The **5 genuine overwrite sites**: `app/estimate-wizard.tsx:188`, `app/takeoff-estimate.tsx:305`, `app/drawing-analyzer.tsx:190`, `app/(tabs)/estimate/index.tsx:802-811` (merge), `app/(tabs)/estimate/index.tsx:813-816` (replace).
- **DO NOT TOUCH:** `app/(tabs)/estimate/index.tsx:871` and `:931` (temp `Project` objects `id:'temp-email'`/`'temp'` for PDF/email — not project writes); `contexts/ProjectContext.tsx:1850` (buyout in-place item edit — not a re-estimate).
- F0 reads: `utils/projectFinancials.ts:20` (`getContractValue`: `const base = project?.estimate?.grandTotal ?? 0;`) and `:32` (`getBaseContractValue`: `return project?.estimate?.grandTotal ?? 0;`). `utils/contractEngine.ts:129-132` (`buildDraftContract`: `input.contractValue ?? input.project.linkedEstimate?.grandTotal ?? input.project.estimate?.grandTotal ?? 0`).
- Migration pattern: `supabase/migrations/<ts>_*.sql` + apply via Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`), verify via `execute_sql`. Edge/SQL files are NOT in app tsconfig.

---

### Task 1: Domain types

**Files:** Modify `types/index.ts`

- [ ] **Step 1:** Add immediately ABOVE `export interface Project {` in `types/index.ts`:

```ts
export type EstimateChangeReason =
  | 'manual'
  | 'sent_to_client'
  | 'converted_to_contract'
  | 'pre_overwrite'
  | 'restore';

export interface EstimateRevision {
  id: string;
  revNumber: number;          // 1-based, monotonic per project
  snapshot: LinkedEstimate;   // full immutable estimate at that point
  grandTotal: number;         // denormalized from snapshot for list render
  reason: EstimateChangeReason;
  note?: string;
  createdAt: string;          // ISO
  createdBy?: string;
}
```

- [ ] **Step 2:** Inside `export interface Project { ... }`, add immediately after the `linkedEstimate?: LinkedEstimate | null;` line:

```ts
  /** Immutable estimate revision history (milestone-driven). Absent ⇒ none yet. */
  estimateVersions?: EstimateRevision[];
```

- [ ] **Step 3 — Verify:** `npx tsc --noEmit` → clean (pure type addition; `LinkedEstimate` is declared earlier in this file so it is in scope).

- [ ] **Step 4 — Commit:**
```bash
git add types/index.ts
git commit -m "feat(estimate-versioning): domain types (EstimateRevision, EstimateChangeReason)"
```

---

### Task 2: DB migration — `estimate_versions` column (DEPLOY = CHECKPOINT)

**Files:** Create `supabase/migrations/20260517120000_estimate_versions.sql`

- [ ] **Step 1:** Create the file with exactly:

```sql
-- Estimate versioning: immutable milestone-driven revision history,
-- stored as a jsonb array on the project (same pattern as linked_estimate).
alter table public.projects
  add column if not exists estimate_versions jsonb;
```

- [ ] **Step 2 — CHECKPOINT (controller-gated):** Do NOT apply. The controller pauses for explicit user confirmation, then applies via Supabase MCP `apply_migration` (name `estimate_versions`, project `nteoqhcswappxxjlpvap`) and verifies with `execute_sql`:
```sql
select count(*) from information_schema.columns
where table_name='projects' and column_name='estimate_versions';
```
Expected: `1`.

- [ ] **Step 3 — Commit (file only; safe even before apply):**
```bash
git add supabase/migrations/20260517120000_estimate_versions.sql
git commit -m "feat(estimate-versioning): estimate_versions jsonb column migration"
```

---

### Task 3: Pure helper module `utils/estimateCommit.ts`

**Files:** Create `utils/estimateCommit.ts`

These are PURE functions returning a `Partial<Project>` patch (or a number). They never call context — callers apply the patch via the existing `updateProject`. This keeps them testable and matches the codebase's pure-util pattern.

- [ ] **Step 1:** Create `utils/estimateCommit.ts` with exactly:

```ts
import type {
  Project,
  LinkedEstimate,
  EstimateRevision,
  EstimateChangeReason,
} from '@/types';

const MAX_REVISIONS = 30;
const KEEP_REASONS: EstimateChangeReason[] = [
  'manual', 'sent_to_client', 'converted_to_contract', 'restore',
];

function genId(): string {
  return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Stable equality of two estimates, ignoring the volatile id/createdAt
 *  on the estimate object itself (compare items + totals + globalMarkup). */
export function estimatesEqual(
  a: LinkedEstimate | null | undefined,
  b: LinkedEstimate | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  const norm = (e: LinkedEstimate) => JSON.stringify({
    items: e.items, globalMarkup: e.globalMarkup,
    baseTotal: e.baseTotal, markupTotal: e.markupTotal, grandTotal: e.grandTotal,
  });
  return norm(a) === norm(b);
}

function nextRevNumber(versions: EstimateRevision[]): number {
  return versions.reduce((m, v) => Math.max(m, v.revNumber), 0) + 1;
}

/** Cap: never drop manual/sent_to_client/converted_to_contract/restore;
 *  drop oldest pre_overwrite first until length <= MAX_REVISIONS. */
function applyCap(versions: EstimateRevision[]): EstimateRevision[] {
  if (versions.length <= MAX_REVISIONS) return versions;
  const protectedIdx = new Set<number>();
  versions.forEach((v, i) => { if (KEEP_REASONS.includes(v.reason)) protectedIdx.add(i); });
  const result = [...versions];
  // oldest-first scan, removing unprotected until within cap
  for (let i = 0; i < result.length && result.length > MAX_REVISIONS; ) {
    if (KEEP_REASONS.includes(result[i].reason)) { i++; continue; }
    result.splice(i, 1);
  }
  return result;
}

function makeRevision(
  est: LinkedEstimate,
  versions: EstimateRevision[],
  reason: EstimateChangeReason,
  note?: string,
  createdBy?: string,
): EstimateRevision {
  return {
    id: genId(),
    revNumber: nextRevNumber(versions),
    snapshot: est,
    grandTotal: est.grandTotal ?? 0,
    reason,
    note,
    createdAt: new Date().toISOString(),
    createdBy,
  };
}

/** Patch that sets `next` as the current estimate, first snapshotting the
 *  project's CURRENT estimate (if any & not a dup of the latest revision). */
export function commitEstimatePatch(
  project: Project | null | undefined,
  next: LinkedEstimate,
  opts: { reason?: EstimateChangeReason; note?: string; createdBy?: string } = {},
): Partial<Project> {
  const versions = project?.estimateVersions ?? [];
  const current = project?.linkedEstimate;
  const latest = versions[versions.length - 1];
  const isDup = current != null && latest != null && estimatesEqual(current, latest.snapshot);
  if (!current || isDup) {
    return { linkedEstimate: next, estimateVersions: versions };
  }
  const rev = makeRevision(current, versions, opts.reason ?? 'pre_overwrite', opts.note, opts.createdBy);
  return {
    linkedEstimate: next,
    estimateVersions: applyCap([...versions, rev]),
  };
}

/** Patch that snapshots the CURRENT estimate without changing it.
 *  Returns {} (no-op) when there is nothing to snapshot or it dups latest. */
export function snapshotPatch(
  project: Project | null | undefined,
  reason: EstimateChangeReason,
  note?: string,
  createdBy?: string,
): Partial<Project> {
  const versions = project?.estimateVersions ?? [];
  const current = project?.linkedEstimate;
  if (!current) return {};
  const latest = versions[versions.length - 1];
  if (latest && estimatesEqual(current, latest.snapshot)) return {};
  const rev = makeRevision(current, versions, reason, note, createdBy);
  return { estimateVersions: applyCap([...versions, rev]) };
}

/** Patch that restores a prior revision as the current estimate, first
 *  snapshotting the outgoing current as a 'restore' revision (undoable). */
export function restorePatch(
  project: Project | null | undefined,
  revisionId: string,
): Partial<Project> {
  const versions = project?.estimateVersions ?? [];
  const target = versions.find(v => v.id === revisionId);
  if (!target) return {};
  const current = project?.linkedEstimate;
  let nextVersions = versions;
  if (current) {
    const rev = makeRevision(current, versions, 'restore');
    nextVersions = applyCap([...versions, rev]);
  }
  return { linkedEstimate: target.snapshot, estimateVersions: nextVersions };
}

export interface EstimateDiff {
  categories: { key: string; label: string; delta: number }[];
  netDelta: number;
}

/** Per-CSI-category (fallback `category`, then 'Uncategorized') delta b - a. */
export function diffEstimates(a: LinkedEstimate, b: LinkedEstimate): EstimateDiff {
  const sum = (e: LinkedEstimate) => {
    const m = new Map<string, number>();
    for (const it of e.items) {
      const key = (it.csiDivision || it.category || 'Uncategorized').toString();
      m.set(key, (m.get(key) ?? 0) + (it.lineTotal ?? 0));
    }
    return m;
  };
  const ma = sum(a); const mb = sum(b);
  const keys = new Set<string>([...ma.keys(), ...mb.keys()]);
  const categories = [...keys]
    .map(k => ({ key: k, label: k, delta: (mb.get(k) ?? 0) - (ma.get(k) ?? 0) }))
    .filter(c => Math.abs(c.delta) > 0.0001)
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const netDelta = (b.grandTotal ?? 0) - (a.grandTotal ?? 0);
  return { categories, netDelta };
}

/** F0: single source of truth for a project's estimate base total. */
export function effectiveEstimateTotal(project: Project | null | undefined): number {
  return project?.linkedEstimate?.grandTotal ?? project?.estimate?.grandTotal ?? 0;
}
```

- [ ] **Step 2 — Verify:** `npx tsc --noEmit` clean. Reason-check (no test runner): `commitEstimatePatch({linkedEstimate:E1, estimateVersions:[]}, E2, {})` → `{ linkedEstimate:E2, estimateVersions:[rev(E1, reason 'pre_overwrite', revNumber 1)] }`. `commitEstimatePatch({linkedEstimate:null}, E1, {})` → `{ linkedEstimate:E1, estimateVersions:[] }`. `snapshotPatch({linkedEstimate:E1, estimateVersions:[{snapshot:E1,...}]}, 'manual')` → `{}` (dup). State these in the report.

- [ ] **Step 3 — Commit:**
```bash
git add utils/estimateCommit.ts
git commit -m "feat(estimate-versioning): pure commit/snapshot/restore/diff + effectiveEstimateTotal (F0)"
```

---

### Task 4: Persist `estimateVersions` on the project

**Files:** Modify `contexts/ProjectContext.tsx`

- [ ] **Step 1 (read-map):** Immediately AFTER the line `linkedEstimate: r.linked_estimate as Project['linkedEstimate'],` (`contexts/ProjectContext.tsx:136`), add:
```ts
              estimateVersions: r.estimate_versions as Project['estimateVersions'],
```
(match the existing indentation of that object literal).

- [ ] **Step 2 (sync upsert):** In the `syncProjectToSupabase` upsert payload, the line at ~`:957` reads `linked_estimate: project.linkedEstimate as unknown, status: project.status,`. Add, immediately after `linked_estimate: project.linkedEstimate as unknown,`:
```ts
          estimate_versions: project.estimateVersions as unknown,
```
(match indentation of sibling upsert keys).

- [ ] **Step 3 — Verify:** `npx tsc --noEmit` clean. Manual: with the migration applied (Task 2), set `estimateVersions` on a project via `updateProject` (exercised in later tasks) — it must survive an app reload (Supabase) and offline (AsyncStorage). For THIS task, confirm by code-reading both edits are in the read-map and the upsert respectively.

- [ ] **Step 4 — Commit:**
```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(estimate-versioning): persist project.estimateVersions (read + sync)"
```

---

### Task 5: F0 — route money reads through `effectiveEstimateTotal`

**Files:** Modify `utils/projectFinancials.ts`, `utils/contractEngine.ts`

- [ ] **Step 1:** In `utils/projectFinancials.ts`, add at the top of the file with the other imports:
```ts
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
```
Replace line ~20 `const base = project?.estimate?.grandTotal ?? 0;` with:
```ts
  const base = effectiveEstimateTotal(project);
```
Replace line ~32 `return project?.estimate?.grandTotal ?? 0;` with:
```ts
  return effectiveEstimateTotal(project);
```
Do not change the CO-sum logic (contract value = base + approved COs is unchanged; only the base read moves to the shared accessor — no double-count).

- [ ] **Step 2:** In `utils/contractEngine.ts`, add the import:
```ts
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
```
In `buildDraftContract`, replace the value expression
`input.contractValue ?? input.project.linkedEstimate?.grandTotal ?? input.project.estimate?.grandTotal ?? 0`
with:
```ts
  const value = input.contractValue ?? effectiveEstimateTotal(input.project);
```
(keep the surrounding code; only collapse that fallback chain).

- [ ] **Step 3 — Verify:** `npx tsc --noEmit` clean. Reason-check: a project with `linkedEstimate.grandTotal=151000` and `estimate=null` now yields `getContractValue` base `151000` (previously `0`) — budget and contract agree (spec §7.7). Watch for an import cycle: `estimateCommit.ts` imports only from `@/types`, so `projectFinancials`/`contractEngine` → `estimateCommit` → types is acyclic; confirm tsc is clean.

- [ ] **Step 4 — Commit:**
```bash
git add utils/projectFinancials.ts utils/contractEngine.ts
git commit -m "fix(F0): unify estimate base via effectiveEstimateTotal (budget == contract)"
```

---

### Task 6: Route the 5 overwrite sites through `commitEstimatePatch`

**Files:** Modify `app/estimate-wizard.tsx`, `app/takeoff-estimate.tsx`, `app/drawing-analyzer.tsx`, `app/(tabs)/estimate/index.tsx`

The uniform transformation: where the site currently does
`updateProject(<idExpr>, { linkedEstimate: <estExpr>, ...rest })`,
change to
`updateProject(<idExpr>, { ...commitEstimatePatch(<projectExpr>, <estExpr>, { reason: 'pre_overwrite' }), ...rest })`
where `<projectExpr>` is the current project object (use `getProject(<idExpr>)` if only an id is in scope). Add `import { commitEstimatePatch } from '@/utils/estimateCommit';` to each file. **Do not** touch `:871`/`:931` of the estimate tab or `ProjectContext.tsx:1850`.

- [ ] **Step 1 — `app/estimate-wizard.tsx`:** It builds `const linkedEstimate: LinkedEstimate = {…}` then `updateProject(projectId, { linkedEstimate });` (`:188`). This screen already uses `useProjects()`. Ensure `getProject` is destructured from `useProjects()` (add it if absent). Replace the `updateProject(projectId, { linkedEstimate });` call with:
```ts
          updateProject(projectId, commitEstimatePatch(getProject(projectId), linkedEstimate, { reason: 'pre_overwrite' }));
```

- [ ] **Step 2 — `app/takeoff-estimate.tsx`:** builds `const linkedEstimate: LinkedEstimate = {…}` then `updateProject(project.id, { linkedEstimate });` (`:305`). `project` is in scope. Replace with:
```ts
      updateProject(project.id, commitEstimatePatch(project, linkedEstimate, { reason: 'pre_overwrite' }));
```

- [ ] **Step 3 — `app/drawing-analyzer.tsx`:** `updateProject(pickedProjectId, { linkedEstimate: linked });` (`:190`). Ensure `getProject` is available from `useProjects()` (add to destructure if absent). Replace with:
```ts
            updateProject(pickedProjectId, commitEstimatePatch(getProject(pickedProjectId), linked, { reason: 'pre_overwrite' }));
```

- [ ] **Step 4 — `app/(tabs)/estimate/index.tsx` merge branch (`:802-811`):** currently:
```ts
      updateProject(pendingLinkProject.id, {
        linkedEstimate: { ...linkedEst, items: mergedItems, baseTotal: mergedBase, markupTotal: mergedMarkup, grandTotal: mergedGrand },
        status: 'estimated',
      });
```
Replace with (build the merged estimate into a const, then patch + keep `status`):
```ts
      const mergedEstimate = { ...linkedEst, items: mergedItems, baseTotal: mergedBase, markupTotal: mergedMarkup, grandTotal: mergedGrand };
      updateProject(pendingLinkProject.id, { ...commitEstimatePatch(pendingLinkProject, mergedEstimate, { reason: 'pre_overwrite' }), status: 'estimated' });
```

- [ ] **Step 5 — `app/(tabs)/estimate/index.tsx` replace branch (`:813-816`):** currently `updateProject(pendingLinkProject.id, { linkedEstimate: linkedEst, status: 'estimated' });`. Replace with:
```ts
      updateProject(pendingLinkProject.id, { ...commitEstimatePatch(pendingLinkProject, linkedEst, { reason: 'pre_overwrite' }), status: 'estimated' });
```

- [ ] **Step 6 — Verify:** `npx tsc --noEmit` clean. Manual (spec §7.1): link a cart estimate to a project that already has a `linkedEstimate` → the prior estimate becomes a `pre_overwrite` revision; the new one is current. Re-run the AI wizard on a scoped project → prior auto-saved. Confirm `:871`/`:931` and `ProjectContext.tsx:1850` are unchanged (`git diff` shows no edits there).

- [ ] **Step 7 — Commit:**
```bash
git add app/estimate-wizard.tsx app/takeoff-estimate.tsx app/drawing-analyzer.tsx "app/(tabs)/estimate/index.tsx"
git commit -m "feat(estimate-versioning): route the 5 overwrite sites through commitEstimatePatch"
```

---

### Task 7: Milestone hook — `converted_to_contract` (+ `sent_to_client` if a site exists)

**Files:** Modify the contract-conversion call site (locate via grep)

- [ ] **Step 1:** `grep -rn "buildDraftContract\|addContract\|createContract" app components` to find where an estimate is converted to a contract for a real project (it has a `project`/`projectId` in scope). At that site, BEFORE the contract is created, apply a snapshot of the current estimate:
```ts
import { snapshotPatch } from '@/utils/estimateCommit';
// …at the contract-create handler, with the project in scope as `proj`/projectId:
const _snap = snapshotPatch(proj, 'converted_to_contract');
if (Object.keys(_snap).length) updateProject(proj.id, _snap);
```
(Use the file's actual project/updateProject identifiers.)

- [ ] **Step 2 — `sent_to_client`:** `grep -rn "buildEstimateEmailHtml\|generateEstimatePDF\|sendEmail" app | grep -i estimate` to find any estimate-send that has a REAL linked project id in scope. If one exists, add `updateProject(<projId>, snapshotPatch(getProject(<projId>), 'sent_to_client'))` before the send. **If the only estimate-send is the standalone cart path** (`app/(tabs)/estimate/index.tsx` `handlePDFSend`, which uses `id:'temp-email'`/`'temp'` — no real project), then `sent_to_client` is **not wireable in v1**: document this in the task report and adjust spec §7 step 3 expectation (the `sent_to_client` enum value remains for D1c/future). Do NOT fabricate a project id.

- [ ] **Step 3 — Verify:** `npx tsc --noEmit` clean. Manual (spec §7.3, §7 generally): convert a scoped project's estimate to a contract → a `converted_to_contract` revision appears. Report whether `sent_to_client` was wireable or deferred (with the reason).

- [ ] **Step 4 — Commit:**
```bash
git add -A
git commit -m "feat(estimate-versioning): snapshot on convert-to-contract (sent_to_client per Step 2 note)"
```

---

### Task 8: Revisions UI (list + delta + restore + save-as-revision)

**Files:** Modify the estimate surface — `app/(tabs)/estimate/index.tsx` and/or the project-detail estimate section (`app/project-detail.tsx`). READ both first to choose the surface that already has the project's `linkedEstimate`/`estimateVersions` in scope and an existing list/modal pattern to reuse.

This is the one in-situ-judgment task. The behavior is fully specified; the exact placement/styles must match the file you put it in (reuse existing row/list/modal styles — do not invent a design system).

- [ ] **Step 1:** Add `import { diffEstimates, snapshotPatch, restorePatch } from '@/utils/estimateCommit';` to the chosen file.

- [ ] **Step 2 — Revisions list:** On the estimate surface for a project, render a "Revisions" section listing `project.estimateVersions ?? []` newest-first: each row shows `Rev {revNumber}`, `{grandTotal}` (use the file's existing money formatter), `{new Date(createdAt).toLocaleDateString()}`, and a friendly reason label via this map (define inline):
```ts
const REASON_LABEL: Record<EstimateChangeReason, string> = {
  manual: 'Manual save',
  sent_to_client: 'Sent to client',
  converted_to_contract: 'Converted to contract',
  pre_overwrite: 'Before re-estimate',
  restore: 'Restored',
};
```
Empty state: "No revisions yet — saved automatically when you re-estimate or send to a client."

- [ ] **Step 3 — Revision detail:** Tapping a row opens a modal (reuse the file's modal pattern) showing: the revision's `grandTotal`; the per-category delta vs the immediately-previous revision in the list (`diffEstimates(prev.snapshot, this.snapshot)` — render each `categories[i]` as `label  ±$delta` and the `netDelta`); the `note` if present; and two actions: **View line items** (read-only list of `snapshot.items`: name, qty, unit, lineTotal) and **Restore this revision**.

- [ ] **Step 4 — Restore action:** "Restore this revision" shows a confirm: "Restore Rev N as the current estimate? Your current estimate is saved as a revision first. Existing contracts/invoices are not changed — regenerate them if needed." On confirm: `const patch = restorePatch(project, rev.id); if (Object.keys(patch).length) updateProject(project.id, patch);` then close the modal.

- [ ] **Step 5 — Save as revision:** Add a "Save as revision" button on the estimate surface (only when `project.linkedEstimate` exists). It prompts for an optional note (reuse an existing prompt/input pattern, or a minimal `Alert.prompt` on iOS / inline TextInput), then `const patch = snapshotPatch(project, 'manual', note?.trim() || undefined); if (Object.keys(patch).length) updateProject(project.id, patch);` Show the file's existing success toast/alert.

- [ ] **Step 6 — Verify:** `npx tsc --noEmit` clean. Manual (spec §7.2,§7.4,§7.5,§7.6): Save-as-revision with a note → row appears labelled "Manual save". Open a revision → category deltas + net delta match the totals. Restore an older revision → it becomes current, the outgoing one is preserved (a "Restored" row appears), no contract/invoice changed. Empty state shows when a project has no revisions.

- [ ] **Step 7 — Commit:**
```bash
git add -A
git commit -m "feat(estimate-versioning): revisions list + delta + restore + save-as-revision UI"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` clean across the repo.
- [ ] `npx eslint <changed files>` → 0 errors (pre-existing warnings OK).
- [ ] Full manual walkthrough of spec §7 steps 1–8.
- [ ] Migration applied + column verified (Task 2 checkpoint).
- [ ] `git diff` confirms `app/(tabs)/estimate/index.tsx:871/:931` and `contexts/ProjectContext.tsx:1850` were NOT modified.
- [ ] Budget-screen total == contract-screen total for a `linkedEstimate`-only project (F0, spec §7.7).

## Self-review notes / accepted refinements

- **Spec said "7+ overwrite sites"; the real count is 5.** `:871`/`:931` are temp `Project` objects for PDF/email (no persistence) and are explicitly excluded — wrapping them would create phantom revisions on a standalone cart estimate. This is a precision refinement of the spec, not a scope change.
- **`sent_to_client` may be deferred (Task 7 Step 2).** The only estimate-send path found in recon (`handlePDFSend`) operates on a `temp` project with no real id, so a revision cannot attribute there. `converted_to_contract` + the automatic `pre_overwrite` capture + manual saves fully deliver the core "never silently lose a number" value; `sent_to_client` is best-effort and documented if not wireable in v1 (the enum value stays for D1c). Surface this in execution, don't fabricate a project id.
- **Helpers are pure + return patches** (not context-bound) so callers apply via existing `updateProject` — testable, offline-first for free, matches the codebase. `estimateCommit.ts` imports only `@/types` (no import cycle with projectFinancials/contractEngine).
- Do not collect any new PII; this is internal estimate history only.
