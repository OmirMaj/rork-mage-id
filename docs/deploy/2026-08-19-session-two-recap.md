# Session recap — 2026-08-19 (second wave)

_What landed after the START-HERE handoff. `main` is green: tsc 0, 415 smoke
(8 suites), 149/149 validators, all now in `ship-check`._

## The six failed branches → merged

The prior session left four `claude/fix-*` branches that failed adversarial
review. Each was re-fixed against the actual reviewer findings (recovered from
the `wf_ff46b107-9d3` workflow transcript), verified by **breaking every guard
and watching it fail**, and merged:

- **invoice-money** — the guard-coverage regression: `{ fill, ink }` chips
  escaped `validate-contrast.ts` (`ink` not in `FG_KEYS`). Proven: injected
  `fill===ink` (contrast 1.00) → guard exit 0; added `ink` → same defect fails.
  Two wrong comments corrected to computed in-situ ratios.
- **estimate-web** — two *introduced* defects render-proven fixed:
  `accessibilityState={{selected}}` is dropped by RN-Web 0.21.2 → `aria-selected`;
  `<button>`-in-`<button>` → sibling structure. Added `successLabel` for sub-AA
  green. Adversarial verifier then caught **two more sub-AA sites I missed**
  (popupBreakdown 4.44:1, opportunityCard 4.33:1) — fixed.
- **platform-infra** — the readCache cross-tenant leak closed with a
  **generation-tagged** in-flight delete (the naive `inFlight.clear()` is also
  wrong); prequal packet sweep finished; AutonomyProvider load re-gated.
- **copy-polish** — eyebrow guard un-blinded; two more UTC date off-by-ones.

## Founder product decisions (`docs/audits/2026-08-19-product-decisions.md`)

- **#1 brand orange** — white on `#FF6A1A` was 2.87:1. **~187 buttons app-wide**
  moved to `accentFill #BC440C` (white ≥5.29:1); `accentLabel` darkened to
  `#B23E08`. A whole-app usage guard (`validate-brand-orange.ts`) now covers
  `makeStyles` factories, siblings, and JSX-inline — verification caught **34**
  beyond the agent's first 153.
- **#2 catalog price** — deal price + labels use the deeper `successLabel`.
- **#3 Clear All Data** — sweeps every app key by prefix (was ~10 of ~125),
  **wipes the offline queue with an explicit warning** (founder call), keeps
  theme/analytics/session; resurrection race closed.
- **#4 COI vault** — **discarded**: false premise. `Subcontractor.assignedProjects[]`
  means one record per company; the "16 rows" state doesn't exist, and the fix
  introduced a deep-link bug.

## The two "worse than they look" items

- **Cart data-loss** — `laborCart`/`assemblyCart` were local `useState` in
  `estimate/full.tsx`: destroyed on unmount AND invisible to Review (which
  under-reported by exactly labor+assemblies). Lifted both into
  `MaterialCartContext` (persisted). Review now folds them into totals, the CSI
  scope table, and the client view — grand-total parity proven.
- **deleteProject** — founder chose **cascade + confirm**. Cascades all 27
  project-scoped `ProjectContext` collections (independent verification caught
  `commEvents`, which the agent wrongly excluded). **Server side confirmed:** all
  34 child-table FKs are `ON DELETE CASCADE` (`leads.converted_project_id` is
  `SET NULL`). Known gap → task: `SafetyContext`'s 5 collections aren't in the
  client cascade (transient local orphan; self-heals on Supabase rehydrate).

## Build / TestFlight

- `plugins/withQuotedXcodeScriptPaths.js` (the Release-bundling fix) verified
  static — rewrites the unquoted backtick Xcode phases that break on the space
  in `MAGE ID - CLAUDE`. Unit-checked on the real failing string.
- **Blocked only on interactive Apple cert validation.** Both this shell and the
  `!`-prefixed shell are non-interactive, so `eas build` can't prompt. Run once
  in a real Terminal, or set up an App Store Connect API key for headless builds.
  `buildNumber` is at 4 from the attempts. See `2026-08-19-release-build-prep.md`.

## Still open

- On-simulator visual audit (needs the sim; 402 tests found 0 bugs, 20 min in the
  sim found 19 last time).
- Render-coverage tests + the invisible-label token pin (in flight).
- SafetyContext cascade; the ASC API key for headless builds.
