# Project Scope screen — design spec

Date: 2026-05-15
Status: design approved, pending written-spec review
Approach: A (new dedicated screen + `project.scope` object + project-aware wizard)

## 1. Problem

Today "scope" = `project.description`, a free-text field on the generic
"Edit Project" modal. It is a dead end:

- It unlocks nothing — no downstream feature consumes it.
- The Estimate Wizard (`app/estimate-wizard.tsx`) already asks the exact
  8 structured questions that *would* make a good scope, but it is
  **standalone**: never tied to a project, answers never saved.
- NextStepHero's "Add scope now" therefore lands users on a 6-field
  edit form that produces no value, and "Open estimator" lands on a
  blank section modal (the estimate tile only renders once an estimate
  already exists).

The lost workflow: **answer scope once → AI produces a rough estimate
from it with zero re-entry → estimate links back to the project.**

## 2. Goals / non-goals

**Goals**
- A dedicated, project-linked Scope screen with guided questions.
- Scope answers persist on the project and are the AI estimator's input.
- Getting an estimate for a scoped project requires no re-typing.
- AI returns a rough estimate from whatever was provided and *asks for
  the specific missing inputs* that would sharpen it (never blocks).
- Scope capture is FREE; the Pro gate stays on AI generation only.
- Preserve the existing standalone "quick estimate → email/PDF, no
  project" flow untouched.
- Fold in the NextStepHero destination audit (every "next step" lands
  on the correct working page).

**Non-goals (YAGNI)**
- A "save this standalone estimate to a project" button on the wizard
  (the materials Estimator already has an "Add to Project" flow; not
  duplicated here).
- Bidirectional sync between `project.scope` and the legacy
  `type/squareFootage/quality/targetBudget` fields.
- Any change to the standalone wizard behavior when no projectId given.

## 3. The two flows (one engine)

**Flow 1 — Standalone quick estimate (PRESERVE AS-IS).**
User opens the Estimate Wizard directly (no project), answers, gets an
AI estimate, shares/emails the PDF. Nothing saved to a project. This is
the current behavior and is explicitly left unchanged.

**Flow 2 — Project-scoped (NEW, the lost workflow).**
Scope screen on a project → saved `project.scope` → opening the
estimator for that project generates a rough AI estimate directly from
saved scope, zero re-entry → estimate links back to the project.

The wizard is the shared generation engine. It is standalone unless a
`projectId` param is present.

## 4. Data model

Add to `Project` in `types/index.ts`:

```ts
export interface ProjectScope {
  projectType: string;          // friendly label, e.g. "Kitchen Remodel"
  sizeSqft: string;
  location: string;
  quality: 'budget' | 'standard' | 'high_end';
  scope: string;                // free-text "what this job covers"
  timelineWeeks: string;
  specialRequirements: string;
  targetBudget: string;
  updatedAt: string;            // ISO; lets us detect "scope present"
}
// Project gains:  scope?: ProjectScope;
```

Decisions:
- **Standalone object**, not mapped onto legacy `project.type`
  (`ProjectType` enum), `squareFootage` (number), `quality`
  (`QualityTier` = `'economy'|'standard'|'premium'|'luxury'` — a
  *different* enum from scope's `'budget'|'standard'|'high_end'`), or
  `targetBudget` (`ProjectTargetBudget` object). The shapes differ and
  the legacy fields are set at project creation; bidirectional sync
  would be fragile and could clobber them.
- Mirrors the wizard's `WizardAnswers` shape exactly (+`updatedAt`) so
  prefilling the wizard is a direct field copy, no translation layer.
- Persists through the existing offline-first path:
  `updateProject(id, { scope })` → `syncProjectToSupabase` → the
  `projects` table. The sync serializes JSON-ish project fields already;
  confirm a `scope jsonb` column exists on `public.projects` and add it
  via a committed migration if missing (follow the
  `20260515000000_*` migration convention; never the dashboard).
- "Has scope" predicate (single source):
  `!!project.scope && project.scope.scope.trim().length > 0`.

## 5. Shared question module

New `utils/scopeQuestions.ts` exports the 8 question definitions once
(id, label, helper text, input kind, options, validation predicate).
Both the new Scope screen and `estimate-wizard.tsx` import from it. The
wizard currently hardcodes these inline; this extraction is the
structural guarantee that the two screens cannot drift apart.

Question set (unchanged from the wizard):
projectType, sizeSqft, location, quality, scope, timelineWeeks,
specialRequirements, targetBudget.

## 6. Scope screen — `app/project-scope.tsx` (NEW, FREE)

- Route param: `?id=<projectId>` (required).
- Guided stepper, one question per screen, progress indicator,
  Back/Next — same visual pattern as the existing wizard for
  consistency.
- "Skip for now" affordance on every step; partial answers are saved.
  Skipping the whole thing returns to the project; NextStepHero keeps
  prompting until scope's free-text `scope` field is non-empty.
- On mount, loads existing `project.scope` (resume/edit).
- Save: `updateProject(id, { scope: { ...answers, updatedAt: nowISO } })`.
- **No Paywall.** Scope is data capture. The `ai_estimate_wizard` gate
  is NOT applied here.
- Final step CTA: "Save scope" → returns to project-detail. Copy makes
  clear the next step is generating an estimate (which is where the AI
  runs), but does not itself run the AI.

## 7. Wizard becomes project-aware (additive)

`estimate-wizard.tsx` changes — all additive, standalone path untouched:

- Read `projectId` via `useLocalSearchParams`.
- **No projectId** → identical to today (standalone quick estimate).
- **With projectId**:
  - If `project.scope` exists, initialize `WizardAnswers` from it
    (direct copy — shapes match). User reviews pre-answered questions.
  - Pro gate (`ai_estimate_wizard`) still fires on **Generate**, not on
    open.
  - On successful generate, link the estimate to the project. NOTE: the
    wizard's output is `estimateSchema` (`lineItems[]` with
    category/description/quantity/unit/unitCost/total + subtotal/
    contingency/permits/total/notes). The rest of the app reads a
    project estimate from `project.linkedEstimate` (a `LinkedEstimate`).
    The implementation plan must define an explicit mapping
    `estimateSchema → LinkedEstimate` (one line item → one
    `LinkedEstimateItem`, carrying category/qty/unit/unitCost/lineTotal;
    rolling subtotal/contingency/permits into the estimate totals) and
    write it via `updateProject(id, { linkedEstimate })`. Do NOT reuse
    the materials-cart cart→LinkedEstimate builder verbatim (different
    input shape); define the wizard-specific mapping. This is the single
    riskiest integration point — call it out as its own plan phase with
    its own verification.
- **AI prompt change:** instruct the model to (a) return a *rough*
  estimate from whatever fields are populated, never refuse on blanks,
  using clearly-labeled assumptions for missing inputs; (b) include a
  short `refineWith: string[]` — the specific missing inputs that would
  most improve accuracy — surfaced in the result UI as "Add these for a
  sharper number." Extend `estimateSchema` with `refineWith` (default
  `[]`, back-compatible).

## 8. NextStepHero destination audit (folded in)

| # | Step | Corrected destination |
|---|---|---|
| 1 | overdue_invoices | `/invoice?projectId&invoiceId` — already correct, keep |
| 2 | coi_expiring | `/prequal-manager` — Pro-gated; keep. Card only shows with subs+prequal packets (rare for free); acceptable. |
| 3 | stale_rfis | `/project-detail?id&tile=rfis` (scoped) / `/rfi-log` (portfolio) — already correct, keep |
| 4 | project_no_scope | **CHANGE → `/project-scope?id=X`** (new free screen). Remove the `?edit=scope` scope-mode modal hack added 2026-05-15. |
| 5 | project_no_estimate | **CHANGE → `/estimate-wizard?projectId=X`** (project-aware, prefilled from scope) |
| 6 | project_no_invoice | `/invoice?projectId` — already correct, keep |

Related cleanups:
- NextStepHero `project_no_scope` detection switches from
  `description.trim().length < 10` to the `project.scope?.scope`
  non-empty predicate (§4).
- project-detail's own "no estimate" quick-action (currently
  `router.replace('/(tabs)/discover/estimate')`, line ~1274) → route to
  `/estimate-wizard?projectId=<id>` for consistency with NextStepHero
  #5.
- Remove the `scopeFocusMode` state + `editParam === 'scope'` branch +
  the scope-mode retitle/auto-focus in `project-detail.tsx` (added
  2026-05-15, now superseded by the real screen). Keep the generic
  `?tile=` / `?edit=1` deep-link plumbing.

## 9. Entry points

- NextStepHero "Add scope now" → `/project-scope?id=X` (free).
- NextStepHero "Open estimator" + project-detail "no estimate" →
  `/estimate-wizard?projectId=X` (prefilled if scope present).
- Discover / direct wizard entry → unchanged (no projectId → standalone
  quick estimate → email/PDF).

## 10. Edge cases

- **Project deleted while on Scope screen:** guard `project` lookup;
  if null, show a brief "project no longer exists" state + back.
- **Partial scope then open estimator:** wizard prefills the answered
  questions, leaves the rest blank; AI estimates rough + `refineWith`
  lists the blanks that matter. No block.
- **Free user opens estimator from scope:** prefilled wizard renders;
  Pro Paywall fires only on Generate. Scope already saved (free), so no
  data lost.
- **Re-running scope:** screen loads existing `project.scope`, edits
  overwrite, `updatedAt` refreshes. Existing linked estimate is not
  auto-regenerated (user re-generates if they want).
- **Offline:** `updateProject` already optimistic + queued; scope saves
  locally and syncs later like all project writes.

## 11. Verification

This RN/Expo project has no unit-test framework wired. Verification:
- `npx tsc --noEmit` clean across changed files.
- Manual flow walkthrough (documented in the implementation plan):
  (a) standalone wizard still works with no project;
  (b) Add scope on a project (free) → saved, survives reload;
  (c) Open estimator for that project → prefilled, no re-entry;
  (d) generate → estimate links to project, `refineWith` shows;
  (e) all 6 NextStepHero CTAs land on the correct page.

## 12. Files touched (summary)

- `types/index.ts` — add `ProjectScope`, `Project.scope?`.
- `utils/scopeQuestions.ts` — NEW, shared question definitions.
- `app/project-scope.tsx` — NEW, free guided stepper.
- `app/estimate-wizard.tsx` — project-aware (additive) + prompt/schema
  change for rough + `refineWith`.
- `components/NextStepHero.tsx` — hrefs #4/#5, has-scope predicate.
- `app/project-detail.tsx` — remove scope-mode hack; "no estimate"
  button → project-aware wizard.
- `supabase/migrations/<ts>_add_scope_to_projects.sql` — only if the
  `scope` column is missing.
