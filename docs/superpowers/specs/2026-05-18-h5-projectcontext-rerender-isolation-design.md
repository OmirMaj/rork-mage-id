# H5 — ProjectContext Re-render Isolation — Design

Source: `docs/superpowers/audits/2026-05-17-prebroad-testflight-hardening-audit.md` item **H5**.
Pre-broad-TestFlight perf hardening. Code-only, OTA-able. No migration / no edge-fn.

## 1. Problem (verified against the code)

`contexts/ProjectContext.tsx` (3,005 lines) is a single `@nkzw/create-context-hook` context (`[ProjectProvider, useProjects]`, mounted once in `app/_layout.tsx:936`). Its value is one `return useMemo(() => ({ …~25 data arrays + ~150 actions/getters… }), [~200 deps])`. **92 files** call `useProjects()`.

Because it is one context value behind one hook:
- Any single write — e.g. `updateProject` mutating `projects` → `sortedProjects` — produces a new memo object identity.
- **Every one of the 92 consumers re-renders**, including screens that only read `cois`, `permits`, or only call an action and read no data.
- The ~200-entry dependency array means the memo recomputes on essentially every state change anywhere in the domain.

Separately, project photos are loaded globally (all projects' photos in `projectPhotos`) rather than scoped to the active project — extra memory + a contributor to the churn.

## 2. Goal / Non-goals

**Goal:** Eliminate unnecessary re-render fan-out from `ProjectContext` **with zero behavior change**. Success = a write to one domain (e.g. an invoice) no longer re-renders consumers of unrelated domains or action-only consumers; every existing screen behaves identically.

**Non-goals (YAGNI / risk control):**
- NOT physically splitting state ownership across separate providers (the provider has heavy intentional cross-domain coupling — `convertLeadToProject`, `awardBidPackage` (bidPackages+commitments+projects), `propagateProgressFromDFR` (dailyReports→projects) — moving state across provider boundaries is high behavior-risk and explicitly counter to the "no behavior change" mandate).
- NOT migrating all 92 consumers in this batch (disproportionate single-batch risk).
- NOT introducing a new state library or a second source of truth (no zustand mirror of context state — duplicate-source-of-truth risk).
- NOT shrinking the 3,005-line file for its own sake (file size is not the success metric; re-render fan-out is).

## 3. Approach decision

Three options considered:

- **A — Physical provider split (N domain providers).** Rejected: requires moving coupled state across provider boundaries; high behavior-change risk; contradicts the no-behavior-change goal; 92-file big-bang import churn.
- **B — One provider, internal split into a stable Actions context + per-domain Data contexts, with a back-compat `useProjects()` shim. (CHOSEN.)** Keeps ALL existing logic/state/mutations in place (behavior identical); changes only *how the value is provided*. Action-only consumers and unrelated-domain consumers stop re-rendering on unrelated writes. No new dependency. Incremental: the shim keeps all 92 consumers working unchanged; only hot always-mounted screens migrate to granular hooks in this batch.
- **C — `use-context-selector` selector layer.** Viable and low structural risk, but adds a third-party dependency to the RN/Expo New-Arch app and still requires per-consumer migration to realize the benefit. B achieves the same isolation with no new dependency and a clearer stable-actions win; preferred. (C noted as a fallback if B's manual context plumbing proves unwieldy during implementation.)

User's standing delegation satisfies the design-approval gate (consistent with the H1–H4 flow this session).

## 4. Architecture

All changes are internal to `contexts/ProjectContext.tsx` plus thin new hook exports. `app/_layout.tsx` keeps a single `<ProjectProvider>` at its current position in the provider stack (provider-order constraints in CLAUDE.md respected — nesting is internal to the provider component, not new top-level providers).

### 4.1 Provider internals

Replace the single `createContextHook` value with hand-rolled nested `React.createContext` providers inside one `ProjectProvider` component (the body — queries, mutations, all `useCallback`/`useMemo` logic — is moved verbatim; **no logic edits**):

- **`ProjectActionsContext`** — every action/getter function (`addProject`, `updateProject`, …, `getPhotosForProject`, …). They are already `useCallback`-stabilized. Bundled in a `useMemo` whose dep array is **only the functions**. Function identities are stable across pure data writes, so this context value rarely changes → action-only consumers effectively stop re-rendering on data writes.
- **Per-domain Data contexts**, grouping the ~25 arrays by cohesion:
  - `CoreDataContext`: `projects`/`sortedProjects`, `settings`, onboarding, `isLoading`, `contacts`, `commEvents`, `priceAlerts`
  - `FinancialsDataContext`: `changeOrders`, `invoices`, `commitments`, `prequalPackets`, `aiaPayApps`
  - `FieldDataContext`: `dailyReports`, `punchItems`, `projectPhotos`, `equipment`, `planSheets`, `drawingPins`, `planMarkups`, `planCalibrations`
  - `PreconDataContext`: `leads`, `bidPackages`, `bidPackageBids`, `subcontractors`, `cois`
  - `DocsDataContext`: `rfis`, `submittals`, `permits`, `warranties`, `oacMeetings`, `subPortalLinks`, `portalMessages`
  Each its own `useMemo` keyed only on its own arrays. A write to one domain re-renders only that domain's data consumers + the (already-isolated) action consumers are unaffected.
  (Exact grouping is finalized in the plan against the real dependency arrays; the principle — cohesive, write-disjoint groups — is fixed here. Number of groups may be tuned 4–6; not 1, not 25.)

### 4.2 Back-compat shim (zero behavior change)

`export const useProjects = () => ({ ...allDataContexts, ...actionsContext })` — composes every context into the exact same object shape/keys the 92 consumers use today. Existing consumers are **not touched** and behave identically (a `useProjects()` consumer still re-renders on any change — same as today — so no regression, just no improvement until migrated). This makes the change safe and incremental.

### 4.3 Granular hooks + hot-path migration

Export `useProjectActions()`, `useCoreData()`, `useFinancialsData()`, `useFieldData()`, `usePreconData()`, `useDocsData()`. In **this batch**, migrate only the always-mounted hot consumers (the tab screens that are mounted during the most frequent writes — `app/(tabs)/(home)/index.tsx`, the projects list, the dashboard, `app/project-detail.tsx`) to the precise granular hooks they need. The long tail of 92 stays on the shim (those screens are not always-mounted; their re-render cost is irrelevant) — documented as future incremental migration.

### 4.4 Photos per-project scoping

`getPhotosForProject`/`projectPhotos` currently hold all projects' photos. Scope the in-memory working set to the active project where the access pattern allows (the audit's concrete sub-ask). Bounded, behavior-preserving (same data returned for a given project); details finalized in the plan against the actual photo load path. Treated as its own task; if it cannot be done without behavior change in this batch, it is deferred and documented (the re-render isolation is the primary win).

## 5. Error handling / correctness

No new failure modes — this is a provider-internal re-wiring. The shim guarantees the public surface (`useProjects()` keys + semantics) is byte-identical. Cross-domain actions keep operating on the same underlying state (state is not partitioned across providers — only the *context delivery* is split), so coupled flows (`convertLeadToProject`, `awardBidPackage`, `propagateProgressFromDFR`, offline-queue writes) are unaffected.

## 6. Verification (no unit runner)

1. `npx tsc --noEmit` clean repo-wide (typed routes + strict).
2. Manual walkthrough — **behavior parity is the gate**: exercise the hot flows end-to-end (create/edit project; add invoice/change order; daily report → progress propagation; award a bid package → commitment; portal photo; lead → convert to project) and confirm identical behavior to pre-change.
3. Re-render check: on a hot screen that does NOT read the written domain (e.g. a screen reading only `permits`), confirm it no longer re-renders when an unrelated write occurs (e.g. an invoice add) — via React DevTools/`why-did-you-render`-style reasoning or a temporary render counter in the manual walkthrough, removed before ship.
4. Final whole-impl review (opus).

## 7. Out of scope / future

Long-tail migration of the remaining ~85 consumers to granular hooks (incremental, safe under the shim); physical provider/file split; `use-context-selector` adoption; any state-library change. Logged here, not built now.
