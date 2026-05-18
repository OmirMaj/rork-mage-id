# H5 — ProjectContext Re-render Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `contexts/ProjectContext.tsx` (one context value, 92 consumers, ~200-dep memo) from re-rendering every consumer on any write — with **zero behavior change**.

**Architecture:** Provider-internal rewire only. Replace the single `createContextHook` value with nested `React.createContext` providers grouped by write-disjoint domain (data + that domain's own data-coupled actions/getters together), a small stable-actions context for data-independent functions, and a cross-domain context for multi-domain actions. A composed `useProjects()` shim returns the byte-identical key set so all 92 existing consumers are untouched. `app/_layout.tsx` keeps one `<ProjectProvider>` at its current position.

**Tech Stack:** React (RN/Expo, New Arch), `@nkzw/create-context-hook` (being partially replaced internally by hand-rolled `React.createContext`), TypeScript strict, typed routes. No unit runner — gate is `npx tsc --noEmit` + manual behavior-parity walkthrough.

**Spec:** `docs/superpowers/specs/2026-05-18-h5-projectcontext-rerender-isolation-design.md` (@ aba6648). Read spec §4 (architecture) and §6 (verification) before starting.

---

## CRITICAL: this is a BEHAVIOR-PRESERVATION refactor

- The provider body (queries, mutations, every `useCallback`/`useMemo`, all logic) is **moved VERBATIM**. No logic edits, no "while I'm here" cleanups, no signature changes.
- `useProjects()` after the change MUST return an object with the **exact same keys, same values, same semantics** as before. The 92 existing consumers are NOT modified in Task 2 and must behave identically.
- The ONLY observable change is fewer re-renders. If a step would change behavior, stop and flag it.
- Build authors code only. No migration, no edge-fn, no deploy. Per-task gate = `npx tsc --noEmit` clean repo-wide + the named manual behavior-parity check. Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

---

## File Structure

- Create `docs/superpowers/audits/2026-05-18-h5-context-key-map.md` — Task 1, the authoritative 1:1 key→context mapping.
- Modify `contexts/ProjectContext.tsx` — Task 2 (the rewire) + Task 3 (export granular hooks) + Task 4 (photos scoping). Single file remains (file-size reduction is explicitly NOT a goal).
- Modify in Task 3 only: the always-mounted hot consumers (`app/(tabs)/(home)/index.tsx`, `app/project-detail.tsx`, and the other always-mounted tab screens enumerated from `app/(tabs)/_layout.tsx`).
- `app/_layout.tsx` — unchanged (single `<ProjectProvider>` stays; nesting is internal to the provider component).

---

### Task 1: Authoritative key→context mapping (read-only analysis)

**Files:**
- Create: `docs/superpowers/audits/2026-05-18-h5-context-key-map.md`

**Why:** Task 2's correctness depends on assigning every `useProjects()` key to exactly one context, grouped so that a write to one domain does not invalidate another domain's context. Action/getter identities are largely **data-coupled** (e.g. `updateProject`'s `useCallback` deps include `projects`; `getInvoicesForProject` depends on `invoices`), so grouping must be by *actual dependency array*, not by name.

- [ ] **Step 1: Extract the full key list**

Read `contexts/ProjectContext.tsx`. Locate the final `return useMemo(() => ({ … }), [ … ])`. Record EVERY key in the returned object (there are ~150). This is the exact public surface of `useProjects()`.

- [ ] **Step 2: Classify each key**

For each key:
- If it is a **data value** (state array, `settings`, `hasSeenOnboarding`, `isLoading`, `sortedProjects` exposed as `projects`, etc.) → it is DATA; note which underlying state array(s) it derives from.
- If it is a **function** → find its `useCallback`/`useMemo` definition in the file and record its **exact dependency array**. Note which domain data array(s) appear in those deps (transitively: if it depends on another callback, follow one level).

- [ ] **Step 3: Assign every key to exactly one context bucket**

Buckets (per spec §4.1, refined for data-coupling):
- **`CoreData`**: `projects`/`sortedProjects`, `settings`, `hasSeenOnboarding`, `isLoading`, `contacts`, `commEvents`, `priceAlerts` + functions whose data deps are confined to these (`addProject`, `updateProject`, `deleteProject`, `getProject`, `updateSettings`, `completeOnboarding`, `addContact`/`updateContact`/`deleteContact`/`getContact`, `addCommEvent`/`getCommEventsForProject`, `addPriceAlert`/`updatePriceAlert`/`deletePriceAlert`, `addCollaborator`/`removeCollaborator`).
- **`FinancialsData`**: `changeOrders`, `invoices`, `commitments`, `prequalPackets`, `aiaPayApps` + their confined functions (`add/update*ChangeOrder`, `getChangeOrdersForProject`, `add/updateInvoice`, `getInvoicesForProject`, `getTotalOutstandingBalance`, `add/update/deleteCommitment`, `getCommitmentsForProject`, `upsert/deletePrequalPacket`, `getPrequalPacketForSub`, `getPrequalPacketByToken`, `addAIAPayApp`, `deleteAIAPayApp`, `getAIAPayAppsForProject`).
- **`FieldData`**: `dailyReports`, `punchItems`, `projectPhotos`, `equipment`, `planSheets`, `drawingPins`, `planMarkups`, `planCalibrations` + confined functions (daily-report, punch, photo, equipment, plan-sheet, drawing-pin, plan-markup, plan-calibration add/update/delete/get*).
- **`PreconData`**: `leads`, `bidPackages`, `bidPackageBids`, `subcontractors`, `cois` + confined functions (lead add/update/delete/get/touch [NOT convert — see Cross], bid-package + bid add/update/delete/get, `getBidsForPackage`, subcontractor add/update/delete/get, COI add/update/delete/get).
- **`DocsData`**: `rfis`, `submittals`, `permits`, `warranties`, `oacMeetings`, `subPortalLinks`, `portalMessages` + confined functions (rfi, submittal [+`addReviewCycle`], permit, warranty [+`addWarrantyClaim`], oac-meeting, sub-portal-link, portal-message add/update/delete/get/mark/count).
- **`StableActions`**: functions whose dependency arrays contain **no domain data array** (only stable refs like mutations, `userId`, `canSync`, helper callbacks). These never change identity on data writes → action-only consumers using them never re-render on data writes.
- **`CrossDomain`**: functions whose deps span **more than one** domain — at minimum `convertLeadToProject` (leads+projects), `awardBidPackage` (bidPackages+bidPackageBids+commitments+projects), and any DFR→project progress propagation (`addDailyReport`/`updateDailyReport` if they depend on both `dailyReports` and `projects` via `propagateProgressFromDFR`). Determine membership strictly from the recorded dep arrays in Step 2, not assumption.

Rule: **every key maps to exactly one bucket; none dropped; none duplicated.** A function is `CrossDomain` if and only if its (transitive, one level) deps include data arrays from ≥2 of the 5 data domains. Otherwise it goes in the single domain it touches, or `StableActions` if it touches none.

- [ ] **Step 4: Write the mapping doc**

Create `docs/superpowers/audits/2026-05-18-h5-context-key-map.md` with: (a) a table — every key | kind (data/fn) | recorded dep array (for fns) | assigned bucket; (b) per-bucket key counts and their sum; (c) an explicit reconciliation line: `TOTAL keys in useProjects() = N; sum of buckets = N; dropped = 0; duplicated = 0`; (d) the explicit `CrossDomain` list with the multi-domain deps that justify each entry.

- [ ] **Step 5: Gate**

`npx tsc --noEmit` from worktree root → clean (no code changed; sanity).

- [ ] **Step 6: Commit**

```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add docs/superpowers/audits/2026-05-18-h5-context-key-map.md
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "docs(H5): authoritative useProjects() key -> context mapping"
```

If Step 3 cannot cleanly assign a key (e.g. a function depends on data from 3+ domains in a way that makes `CrossDomain` a near-duplicate of the old god-context), record it and report `DONE_WITH_CONCERNS` — the controller decides whether to widen `CrossDomain` or accept that those specific consumers keep god-context behavior (still correct, just not isolated).

---

### Task 2: Provider-internal rewire + back-compat shim

**Files:**
- Modify: `contexts/ProjectContext.tsx`

**Why:** Deliver the isolation. The provider component's body is preserved verbatim; only the value delivery changes from one `createContextHook` memo to nested per-bucket `React.createContext` providers, plus a composed `useProjects()` shim.

- [ ] **Step 1: Create the context objects**

At module scope in `contexts/ProjectContext.tsx`, define one `React.createContext` per bucket from Task 1's map, each typed with that bucket's slice of the current return type, default `null`:

```tsx
type CoreDataValue = { projects: Project[]; settings: AppSettings; /* …exact keys from the map… */ };
const CoreDataContext = React.createContext<CoreDataValue | null>(null);
const FinancialsDataContext = React.createContext<FinancialsDataValue | null>(null);
const FieldDataContext = React.createContext<FieldDataValue | null>(null);
const PreconDataContext = React.createContext<PreconDataValue | null>(null);
const DocsDataContext = React.createContext<DocsDataValue | null>(null);
const StableActionsContext = React.createContext<StableActionsValue | null>(null);
const CrossDomainContext = React.createContext<CrossDomainValue | null>(null);
```
The slice types are the exact sub-sets of the existing inferred return shape. Reuse existing domain types from `@/types`; do not invent new domain types.

- [ ] **Step 2: Convert `ProjectProvider` to a real component preserving the body verbatim**

`@nkzw/create-context-hook` currently wraps the body. Replace `export const [ProjectProvider, useProjects] = createContextHook(() => { <BODY> });` with an explicit component:

```tsx
function ProjectProviderInner({ children }: { children: React.ReactNode }) {
  <BODY — moved verbatim, exactly as today, up to and including all the const declarations, queries, mutations, useCallback/useMemo definitions. DELETE only the final `return useMemo(() => ({...}), [...])`. >

  const coreData = useMemo<CoreDataValue>(() => ({ /* exact CoreData keys */ }), [/* only CoreData deps */]);
  const financialsData = useMemo<FinancialsDataValue>(() => ({ /* … */ }), [/* … */]);
  const fieldData = useMemo<FieldDataValue>(() => ({ /* … */ }), [/* … */]);
  const preconData = useMemo<PreconDataValue>(() => ({ /* … */ }), [/* … */]);
  const docsData = useMemo<DocsDataValue>(() => ({ /* … */ }), [/* … */]);
  const stableActions = useMemo<StableActionsValue>(() => ({ /* … */ }), [/* … */]);
  const crossDomain = useMemo<CrossDomainValue>(() => ({ /* … */ }), [/* … */]);

  return (
    <StableActionsContext.Provider value={stableActions}>
      <CrossDomainContext.Provider value={crossDomain}>
        <CoreDataContext.Provider value={coreData}>
          <FinancialsDataContext.Provider value={financialsData}>
            <FieldDataContext.Provider value={fieldData}>
              <PreconDataContext.Provider value={preconData}>
                <DocsDataContext.Provider value={docsData}>
                  {children}
                </DocsDataContext.Provider>
              </PreconDataContext.Provider>
            </FieldDataContext.Provider>
          </FinancialsDataContext.Provider>
        </CoreDataContext.Provider>
      </CrossDomainContext.Provider>
    </StableActionsContext.Provider>
  );
}
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  return <ProjectProviderInner>{children}</ProjectProviderInner>;
}
```
Each per-bucket `useMemo` dependency array contains ONLY that bucket's keys (so it recomputes only when its own slice changes). Every key from Task 1's map appears in exactly one bucket object, spelled identically to today.

- [ ] **Step 3: Compose the back-compat `useProjects()` shim**

```tsx
function useCtx<T>(c: React.Context<T | null>, name: string): T {
  const v = React.useContext(c);
  if (v === null) throw new Error(`use${name} must be used within ProjectProvider`);
  return v;
}
export function useProjects() {
  return {
    ...useCtx(CoreDataContext, 'CoreData'),
    ...useCtx(FinancialsDataContext, 'FinancialsData'),
    ...useCtx(FieldDataContext, 'FieldData'),
    ...useCtx(PreconDataContext, 'PreconData'),
    ...useCtx(DocsDataContext, 'DocsData'),
    ...useCtx(StableActionsContext, 'StableActions'),
    ...useCtx(CrossDomainContext, 'CrossDomain'),
  };
}
```
This returns an object whose keys are the union of all buckets = **exactly** the original `useProjects()` shape (Task 1 guarantees 1:1, no dup/drop). The spread order does not matter because keys are disjoint. (`useProjects()` consumers still subscribe to all contexts → same re-render behavior as today = no regression; the win is for Task 3's granular consumers. This is intended and documented in the spec.)

- [ ] **Step 4: Reconcile types & imports**

Ensure `import React, { useMemo, useContext, createContext } from 'react'` (or `React.*`) is present; remove the now-unused `createContextHook` import IF nothing else in the file uses it (grep first; if still used elsewhere keep it). The exported `useProjects` return type must remain structurally identical — if a `ProjectContextValue` type alias was exported and is consumed elsewhere, keep that alias and have `useProjects` satisfy it (grep for the type name across the repo; if consumed, preserve it exactly).

- [ ] **Step 5: Gate — tsc**

`npx tsc --noEmit` from worktree root → expect clean. Type errors here usually mean a key landed in the wrong/no bucket — fix the bucket objects/types until the shim's inferred shape matches the original (and matches any exported value-type alias).

- [ ] **Step 6: Gate — behavior parity walkthrough (spec §6)**

Start the app (`bun run start` or `bun run start-web`). Exercise and confirm IDENTICAL behavior to pre-change: create project; edit a project field; add a change order; add an invoice; create a daily report and confirm project progress propagation still happens; award a bid package and confirm the commitment is created; add a portal photo; create a lead and `convertLeadToProject`. Any divergence = a key landed in the wrong bucket or a dep array is wrong — fix and re-run. State explicitly in the report that parity held (or the exact divergence found+fixed).

- [ ] **Step 7: Commit**

```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add contexts/ProjectContext.tsx
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "refactor(H5): split ProjectContext value into per-domain contexts behind back-compat useProjects() shim"
```

---

### Task 3: Granular hooks + migrate always-mounted hot consumers

**Files:**
- Modify: `contexts/ProjectContext.tsx` (export granular hooks)
- Modify: `app/(tabs)/(home)/index.tsx`, `app/project-detail.tsx`, and the other always-mounted tab screens (enumerate from `app/(tabs)/_layout.tsx`)

**Why:** The shim alone gives no re-render benefit to existing consumers. The benefit is realized when always-mounted hot screens subscribe only to the slices they use.

- [ ] **Step 1: Export granular hooks**

In `contexts/ProjectContext.tsx`:
```tsx
export const useCoreData = () => useCtx(CoreDataContext, 'CoreData');
export const useFinancialsData = () => useCtx(FinancialsDataContext, 'FinancialsData');
export const useFieldData = () => useCtx(FieldDataContext, 'FieldData');
export const usePreconData = () => useCtx(PreconDataContext, 'PreconData');
export const useDocsData = () => useCtx(DocsDataContext, 'DocsData');
export const useProjectActions = () => useCtx(StableActionsContext, 'StableActions');
export const useProjectCrossActions = () => useCtx(CrossDomainContext, 'CrossDomain');
```

- [ ] **Step 2: Enumerate the always-mounted hot consumers**

Read `app/(tabs)/_layout.tsx`. The always-mounted screens = the tab screens not `href: null`. Combined with `app/project-detail.tsx` (the heaviest screen). Produce the concrete file list (expected to include `app/(tabs)/(home)/index.tsx` and the project list / dashboard tab screens). Only these are migrated in this batch.

- [ ] **Step 3: Migrate each hot consumer to precise hooks**

For each file in Step 2: find its `const { … } = useProjects();` destructure. Determine which buckets those destructured keys belong to (Task 1 map). Replace the single `useProjects()` call with the minimal set of granular hooks, destructuring each key from its owning hook. Example:
```tsx
// before
const { projects, updateProject, invoices, getInvoicesForProject } = useProjects();
// after
const { projects } = useCoreData();
const { updateProject } = useCoreData(); // if updateProject is CoreData per the map
const { invoices, getInvoicesForProject } = useFinancialsData();
```
(Collapse multiple destructures from the same hook into one call.) Do not change any other logic in the consumer. If a hot screen genuinely needs keys from most buckets, it is acceptable to leave it on `useProjects()` (no regression) and note that in the report — do not contort it.

- [ ] **Step 4: Gate**

`npx tsc --noEmit` clean. Behavior-parity re-check of each migrated screen (it renders and functions identically). Re-render spot check (spec §6.3): with a temporary render counter or React DevTools reasoning, confirm a migrated screen that does not read the financials domain does NOT re-render when an invoice is added (it did before). Remove any temporary instrumentation before commit.

- [ ] **Step 5: Commit**

```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add contexts/ProjectContext.tsx app/
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "perf(H5): migrate always-mounted hot screens to granular ProjectContext hooks"
```

---

### Task 4: Photos per-project scoping (with documented fallback)

**Files:**
- Modify: `contexts/ProjectContext.tsx`

**Why:** Spec §4.4 — `projectPhotos`/`getPhotosForProject` hold all projects' photos. Scope the working set to the active project where the access pattern allows, without behavior change.

- [ ] **Step 1: Inspect the photo load path**

In `contexts/ProjectContext.tsx`, find how `projectPhotos` is loaded (the photos query / AsyncStorage read) and every consumer path of `projectPhotos` and `getPhotosForProject` (grep repo). Determine whether the global array can be replaced by a per-active-project working set **without changing any returned value for a given project** (i.e., `getPhotosForProject(id)` returns the same photos as today).

- [ ] **Step 2: Decision gate (documented fallback)**

- If per-project scoping is achievable with identical observable results (e.g. the load can be filtered/lazy by `projectId` and no consumer relies on the global array spanning projects): implement it — keep `getPhotosForProject(projectId)` semantics identical; only the in-memory/loaded set narrows.
- If ANY consumer relies on cross-project `projectPhotos` (e.g. a global gallery/count) such that scoping would change behavior: **DEFER**. Do not force it. Write a short note into the H5 spec's §7 (out-of-scope/future) recording why, and skip to Step 4. (The re-render isolation from Tasks 2–3 is the primary, sufficient H5 win; D3 later builds a real photo library.)

- [ ] **Step 3: Implement (only if Step 2 = achievable)**

Apply the minimal change so photos load/retain per active project. Preserve `getPhotosForProject`/`addProjectPhoto`/`updateProjectPhoto`/`deleteProjectPhoto` signatures and results exactly. No change to the photos written to Supabase / offline queue.

- [ ] **Step 4: Gate**

`npx tsc --noEmit` clean. Behavior parity: open a project with photos → same photos shown; add/delete a photo → same result; switch projects → correct per-project photos. If deferred, state "Task 4 deferred per Step 2 fallback; spec §7 updated" in the report.

- [ ] **Step 5: Commit**

```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add contexts/ProjectContext.tsx docs/superpowers/specs/2026-05-18-h5-projectcontext-rerender-isolation-design.md
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "perf(H5): scope project photos per active project"   # or: "docs(H5): defer photos-per-project per spec fallback"
```

---

## Ship (controller, after final whole-impl review — not a build step)

Code-only, OTA-able. After the final opus whole-impl review APPROVES: FF-merge `claude/p0-launch-on-main` → `main`, push, `eas update --branch production` (no migration, no edge-fn). (Independent of H4's Netlify-blocked cutover tail.)

---

## Self-Review

**Spec coverage:** §1 problem → Task 1 quantifies the surface. §3 chosen approach B → Tasks 2–3. §4.1 buckets → Task 1 map + Task 2 contexts (refined to data-coupled grouping + StableActions + CrossDomain, which spec §4.1 explicitly delegates to the plan). §4.2 shim → Task 2 Step 3. §4.3 granular hooks + hot consumers → Task 3. §4.4 photos + fallback → Task 4. §6 verification (tsc + parity + re-render check) → every task's gate. §2 non-goals respected (single file kept; long tail on shim; no new dep; no physical state split). No gaps.

**Placeholder scan:** The `<BODY — moved verbatim>` / `/* exact … keys */` markers in Task 2 are deliberate **verbatim-preserve** instructions (the body is 3,000 lines of existing code that must NOT be retyped or altered — reproducing it in the plan would invite edits, the opposite of the goal) bounded by Task 1's authoritative key map which supplies the exact per-bucket keys. This is a preserve-don't-rewrite directive, not an unspecified TODO. All new code (contexts, shim, hooks, provider JSX) is given in full. No "handle X appropriately" placeholders.

**Type/name consistency:** Context names (`CoreDataContext`/`FinancialsDataContext`/`FieldDataContext`/`PreconDataContext`/`DocsDataContext`/`StableActionsContext`/`CrossDomainContext`) and hook names (`useCoreData`/`useFinancialsData`/`useFieldData`/`usePreconData`/`useDocsData`/`useProjectActions`/`useProjectCrossActions`) are identical across Tasks 1–3. `useProjects()` shim preserves the original key set (Task 1 1:1 guarantee). `useCtx` helper defined once (Task 2 Step 3), reused in Task 3 hooks. Bucket set is the same 7 in Task 1 Step 3, Task 2 Step 1/2, and the shim.
