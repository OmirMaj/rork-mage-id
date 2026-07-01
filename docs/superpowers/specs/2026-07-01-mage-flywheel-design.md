# MAGE ID Differentiator Flywheel — Design Spec

**Date:** 2026-07-01
**Status:** Approved to build ("do all"). Phased delivery.

## Thesis

Every competitor owns one slice of the job lifecycle (Procore = enterprise ops,
Buildertrend = residential PM, CompanyCam = photos, STACK = takeoffs, Jobber =
service trades). **MAGE ID owns the whole loop** — estimate → bid → schedule →
field → change orders → invoice → pay — and is AI-native. The differentiator is
a flywheel that exploits that:

1. **Voice-native field capture (hands)** — one spoken note fans out to every
   system, so real field data actually gets entered.
2. **Cost-learning bid engine (brain)** — that real data calibrates future bids
   per cost code, compounding into an un-copyable, personal accuracy moat.
3. **Portal trust/referral engine (growth)** — a glass-box client portal turns
   finished jobs into new leads.

Build order is deliberate: **1 feeds 2 feeds 3.** Field capture generates the
actuals that make calibration real; better bids + smoother jobs make the portal
worth sharing.

---

## Phase 1 — Voice-native field capture

**Goal:** A contractor speaks one note on-site
("*log 3 hours framing, floor 2 drywall 80%, order 40 sheets of 5/8 drywall,
add a change order for the extra window*") and it fans out to time tracking,
schedule %, the daily report, a material PO draft, and a change-order draft —
after a one-tap review.

**Reuse (do not rebuild):**
- `utils/mageAI.ts` — `mageAI({prompt, schema, tier})` → `{success, data|error}`.
- `utils/voiceCommandParser.ts` — Zod-schema parse pattern (already handles
  single/batch schedule updates + daily-report voice). Extend, don't replace.
- `utils/offlineQueue.ts` `supabaseWrite(table, op, data)` — all writes.
- Contexts: `useProjects()` (`addChangeOrder`, `addCommitment`, `addDailyReport`,
  `updateProject`, `getProject`), `useTimeEntries().addEntry`.
- Types: `TimeEntry`, `ChangeOrder`, `Commitment`, `DailyFieldReport`,
  `ScheduleTask` in `types/index.ts`.

**New:**
- `utils/fieldCaptureParser.ts` — `fieldCaptureSchema` (Zod) covering the 5
  targets, each optional + `confidence`; `parseFieldCapture(text, tasks,
  projectName)` returning a normalized `FieldCapture` object. Never writes.
- `hooks/useFieldCapture.ts` — orchestrator: `capture(text, projectId)` → parse
  → build a **preview list of proposed actions** (no writes). `apply(actions)` →
  performs the real writes via the reused context methods. Records AI usage via
  `aiRateLimiter`.
- `components/FieldCaptureReview.tsx` — a review sheet listing each proposed
  action with a toggle + editable value, then **Apply** / **Cancel**. Writes are
  side-effectful, so nothing is committed until the user confirms. All created
  records are drafts (`status:'draft'`) → reversible.
- Wire an entry point: extend `VoiceCommandModal` with a "Field Update" path
  and/or the home "Quick Field Update" submit to route into `useFieldCapture`.

**Safety:** Change orders and POs are created as **drafts**, never submitted.
Review-before-write is mandatory. Low-confidence (<60) items are pre-unchecked
with a clarification note.

**Done when:** speaking/typing a multi-part note produces a correct review sheet
and, on Apply, creates the right records; `tsc` clean; verified on the sim.

---

## Phase 2 — Cost-learning bid engine (mostly wiring)

Infra already exists: `utils/estimateActuals.ts`, `utils/estimateCalibration.ts`
(cross-job per-category bias multipliers, 0.8–1.5 clamp, confidence by job
count), `utils/estimateConfidence.ts` (0–100 score), `utils/costDatabase.ts`
(personal price book, cold-start blend `w=n/(n+3)`), plus screens
`estimate-confidence`, `estimate-calibration`, `estimate-accuracy`,
`job-costing`.

**Gaps to close:**
1. **Close the loop on job-close** — when a project → `closed`, persist the
   per-category calibration (new `estimate_calibrations` table or reuse existing
   derivation) so it survives and syncs.
2. **Apply calibration in the estimate wizard** — offer "adjust to your history"
   using `computeCalibration` multipliers, with a before/after banner.
3. **Surface a Bid Confidence badge** prominently on every estimate (reuse
   `computeEstimateConfidence` score), with the backed/calibrated/unproven split.

**Done when:** a fresh estimate shows a Bid Confidence badge and a one-tap
"calibrate to my history" adjustment driven by real closed-job data.

---

## Phase 3 — Portal trust/referral engine (mostly surfacing)

Infra ~70% there: `client-portal-setup`, `portalSnapshot.ts` (v7 encoder),
messages/approvals/selections/payments (Stripe Connect via
`create-payment-link`), `public-profile-setup`, static `marketing/portal`.

**Gaps to close:**
1. **Live progress hero** — a top-level "% complete" derived from schedule task
   rollup, surfaced in the portal snapshot hero (data exists, not surfaced).
2. **Shareable progress link** — a compact, forwardable snapshot (project + hero
   photo + progress bar + next 3 tasks + latest photo + "See full project")
   with a **"Built with MAGE ID" + refer-a-builder** CTA — the referral wedge.
3. **Payment-success / next-step CTA** in the portal.

**Done when:** a GC can share a live progress link that shows a real progress %
and carries a referral CTA.

---

## Cross-cutting

- All writes via `supabaseWrite` (offline-first). Never call `supabase.from()`
  directly from UI.
- Respect tier gating (`useTierAccess`) and AI caps (`aiRateLimiter`,
  server `requireTier`).
- iOS-first; Lucide icons; new native modules must be Fabric-compatible.
- Each phase: spec (this doc) → implement → `tsc --noEmit` clean → verify on sim
  → commit.
