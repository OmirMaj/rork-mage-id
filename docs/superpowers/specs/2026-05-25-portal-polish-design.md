# Client Portal Polish — Design

**Date:** 2026-05-25
**Status:** Approved (audit-driven pass) — ready for implementation plan
**Scope:** Three high-value, low-effort portal improvements identified in the 2026-05-25 portal audit. No new sections/toggles; tighten what exists.

## Goal
Make the client portal's schedule match the app's quality and fix two correctness/privacy bugs — using data already in the portal payload wherever possible.

## Items

### 1. Schedule header roll-up + look-ahead (the "looks different" fix)
The portal already renders a real animated Gantt + list from `sections.schedule.tasks[]` (carries `title, phase, progress, status, durationDays, startDay, isMilestone, isCriticalPath`) + anchors `startDate, workingDaysPerWeek, totalDurationDays`. It's date-accurate but the **header is bare** (date range + counts only). Add, computed **client-side in `renderSchedule` (marketing/portal/index.html)** from data already present:
- **Overall % complete** — duration-weighted: `Σ(progress·durationDays) / Σ(durationDays)` over non-summary tasks → a labeled progress bar in the schedule header.
- **Next milestone** — nearest future `isMilestone` task; show its title + computed date (`startDate + (startDay-1) calendar days`).
- **"This week / Next week" look-ahead** — a compact two-column list above the Gantt: tasks whose `[startDay, startDay+durationDays-1]` window overlaps `[today, +6]` (This week) and `[+7, +13]` (Next week), showing title + phase. Convert day-offsets to dates via `startDate`.

No payload change required — all fields already ship.

### 2. Punch-list leak fix (P1 privacy)
`utils/portalSnapshot.ts` maps **all** punch items into `sections.punchList` with no status filter (the comment claims "only open/in-progress" but the code doesn't filter) — so completed/internal items reach the client. **Filter to open / in-progress** before serializing (exclude `done`/`completed`/verified statuses). Match the real `PunchItem.status` union — read it before filtering.

### 3. Activity-feed field-name fixes (P1 correctness)
`buildActivityFeed` in `marketing/portal/index.html` reads payload fields that don't exist, so rows render with **blank bodies / wrong timestamps**:
- Daily-report rows read `d.workSummary`/`d.summary` → payload emits **`workPerformed`** (`portalSnapshot.ts`). Read `workPerformed`.
- Photo rows read `p.locationLabel`/`p.createdAt`/`p.uploadedAt` → payload carries **`caption`**/**`timestamp`**. Read those.
- Change-order / invoice rows read `updatedAt`/`createdAt` → payload carries **`dateSubmitted`** (CO) / **`date`** (invoice). Read those for the timestamp + sorting.

Verify each field name against the actual `portalSnapshot.ts` serializer before editing (the audit cited these; confirm exact keys).

## Out of scope (deferred, from the audit)
- Documents section (currently a dead `[]` stub) — needs real file wiring (M).
- Always-on Warranty center; Permits & Inspections section; richer fixed-price budget (each M).
- Baseline ghost-bars on the portal Gantt (needs payload additions).
- Nightly portal auto-refresh (cron).

## Ship path (important)
- `utils/portalSnapshot.ts` changes (punch filter) ride the app → **OTA** (it builds the payload in-app at share time).
- `marketing/portal/index.html` changes (schedule header/look-ahead + activity feed) deploy to **Netlify** (`mageid.app`) via the build-free `netlify deploy --dir` + `restoreSiteDeploy` path — **requires a user-supplied Netlify PAT** (per the documented procedure). Confirm with the user at ship time.

## Testing & gates
No unit runner. `npx tsc --noEmit` clean for the `portalSnapshot.ts` change. The portal HTML is static JS — verify by reading the rendered functions + (optionally) loading the portal locally. Confirm: punch list shows only open/in-progress; activity rows have real bodies/dates; schedule header shows %-complete + next milestone + this/next-week. Non-regression: portal still passes `portal_sign_contract`/`portal_choose_selection` (don't touch those paths).
