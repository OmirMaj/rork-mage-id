# Total-audit fix wave — 2026-07-14

Branch: `claude/compare-audit`. Mandate: "fix everything" + **auto-fix, gate only ship**.
Full audit of iOS app + web app + marketing; keep the contractor's two complaints in mind.

Source audit: workflow `wv7tl2u17` — 41 findings (6 P0, 14 P1, 20 P2), find→adversarially-verify.
Every wave below is **ship-check green** (typecheck + lint + 33 validators). Nothing merged or deployed — ship is owner-gated.

---

## Contractor complaints — FIXED (commit `1f8a696`)

1. **"Task editor too dense / too many tabs."** Collapsed the advanced task fields (Start Day Override,
   Milestone, Critical Path, Weather Sensitive) behind an **"Advanced"** disclosure in the mobile
   schedule task editor (`app/(tabs)/schedule/index.tsx`). The common edit path is now short.
2. **"Statuses all orange."** Root cause: the **desktop/web Pro Gantt** bars fell back to trade-amber.
   Added a **Status/Trade color-mode toggle** (default Status) with per-status fills (done green,
   in-progress blue, on-hold orange, not-started grey) + a mode-aware legend
   (`components/schedule/InteractiveGantt.tsx`, `constants/colors.ts` statusFills,
   `utils/scheduleColors.ts`, new `hooks/useGanttColorMode.ts`).
   Note: the **mobile** schedule already had correct per-status colors (`utils/scheduleEngine.ts` getStatusColor) —
   the bug was desktop-only.

---

## P0 — money / data-loss (commit `6de0d7c`) — all 6 FIXED

| File | Bug | Fix |
|---|---|---|
| `app/(tabs)/estimate/index.tsx` | Linked estimate saved/emailed materials-only total under a full-total subject; labor+assembly dropped | Fold labor+assembly into `buildLinkedEstimate`; grandTotal = materials+labor+assembly; modal copy shows the real total |
| `utils/cashFlowEngine.ts` | Monthly expense fired on BOTH the 1st and 15th → doubled outflow | Anchor to `expense.startDate` day-of-month, once per calendar month (month-length clamped) |
| `app/cash-flow.tsx` + engine | Approved COs counted as income AND in Total Pending while also billed via invoices | Drop CO income projection + CO from Total Pending (they flow in via invoices) |
| `app/ai-punch.tsx` | Batch save looped a stale-closure single-add → only the LAST punch item persisted locally | New `addPunchItems()` batch in ProjectContext; called once |
| `app/photo-triage.tsx` | Same stale-closure loss for punch + RFI; RFIs all collided on one number | New `addRFIs()` batch (sequential per-project numbers); called once |
| `app/sub-portal-setup.tsx` + `utils/subPortalSnapshot.ts` + core | Sub-portal invoice submit dead — access token never wired, always fell to mailto | Add `SubPortalLink.accessToken`, mint+persist in `upsertSubPortalLink`, emit `?t=` before `#d=` in `buildSubPortalUrl` |

Shared core changes in `contexts/ProjectContext.tsx` + `types/index.ts` (batch inserts + sub-portal token).

## P1 — correctness / UX (commit `4bc7cfa`) — 12 of 14 FIXED

Fixed: estimate-wizard reconcile (itemize contingency/permits) · summary+summaryBriefing exclude draft
invoices from Outstanding · schedule-pro Gantt anchored to `schedule.startDate` · construction-ai stops
upselling a tier you already own · takeoff aiTakeoff made proOnly to match the server gate (validators
updated to the corrected gate) · client-view Documents rows open the file · time-tracking honors the
`projectId` route param · lead-detail persists edits before convert · project-detail "Add Internal Note"
works on web/Android · settings "Clear All Data" clears in one shot (all `tertiary_*` keys + zeroed query
cache) · home auto-"active" filter no longer traps phones with <5 projects.

**Deferred (owner-gated infra) — 2 of 14:**
- **AIA pay-app "Pay" button** (`app/aia-pay-app.tsx`): the create-payment-link edge function looks up
  `invoices` by id and 404s on an AIA pay-app id. Fix needs a `recordType` param on `create-payment-link`
  + stripe-webhook routing + **edge-function redeploy**. → owner-gated.
- **Daily-report incident/workProgress persistence** (`contexts/ProjectContext.tsx`): the columns don't
  exist on `daily_reports`, so those fields are lost on refetch. Fix needs a **DB migration**
  (`incident jsonb`, `work_progress jsonb`) shipped together with the app-side payload change. → owner-gated.

## P2 — accuracy / durability / polish (commit `668bd96`) — 12 FIXED

Paywall "20/day" → correct 15/day cap · leads "Open leads" excludes won/lost · Time Tracking subtitle
drops the false "cost rollups" claim · smart-proposal only marks 'sent' on a real share · marketing
portal re-renders on a fresh snapshot · notifications-settings + NotificationContext writes now go through
offlineQueue · invoice pay-link callback deps fixed · daily-report mirrors edit-added photos to the gallery
· client-view centered at 1200pt on desktop · budget chart width resize-reactive · home FAB no longer
overlaps the last card.

**Deferred P2s (need design, geocoding, or edge-fn deploy):** mobile schedule 0→1-index day model
(5 files + migrate persisted `startDay`; display off-by-one, do as its own pass) · classic schedule weather
hardcoded to NYC coords (wire project-address geocode) · stripe-webhook receipt money formatter missing
thousands separators (edge fn, owner-gated deploy) · Home vs Summary "Today on site" day-membership
mismatch · Estimator header 7-tap-target density (needs design) · biweekly-expense startDate phase ·
wip.ts contract-value fallback of 0 · DesktopSidebar time-tracking `requires` (verify tier first).

---

## Update — later same session (authorized follow-ups)

- **Daily-report P1 is now FIXED (not deferred).** `daily_reports.incident jsonb` + `work_progress jsonb`
  migration **applied to prod** via Supabase MCP + verified live; app insert/update/load wired
  (commit `56c2424`, migration file `supabase/migrations/20260714160000_...`). Only the **AIA pay-app**
  P1 remains owner-gated (needs a `create-payment-link` + stripe-webhook change and redeploy).
- **NEW: Quick Quote** (commit `3049cd5`) — DMG-Pro-style fast small-job bidding. One screen
  (`app/quick-quote.tsx`) → single-tier `SmartProposal` (`kind:'quick'`) reusing useSmartProposals +
  proposalToShareText; entry via the `+` Create menu. Verified rendering on the iOS sim.
- **NEW: Home speed-dial FAB** (commit `90ef1ab`) — the 3 stacked Home FABs (AI/voice/help) collapsed
  into one `HomeFabStack` (AI FAB + `+` expander). Verified on the iOS sim (2 buttons, was 3).

## Ship checklist (owner-gated)

- [ ] Review the commits on `claude/compare-audit`: `1f8a696` (contractor), `6de0d7c` (P0),
      `4bc7cfa` (P1×12), `668bd96` (P2×12), `56c2424` (daily-report P1 + migration),
      `3049cd5` (Quick Quote), `90ef1ab` (speed-dial FAB), + docs.
- [ ] Merge to `main`.
- [ ] **OTA** to production (all JS-only, runtime `expo.version` unchanged) — reaches existing installs.
- [ ] **Netlify** deploy for the marketing/portal change (`marketing/portal/index.html`) — separate from OTA.
- [ ] Visually eyeball the two contractor fixes (status colors + task-editor declutter) on the **web app**
      (they're desktop-only surfaces the iOS sim can't show).
- [ ] The one remaining deferred P1 (AIA pay-app) needs a `create-payment-link`/webhook redeploy.
- [ ] The `daily_reports` migration is ALREADY applied to prod — so ship the app change with it (already
      coupled in `56c2424`); no separate migration step needed.
