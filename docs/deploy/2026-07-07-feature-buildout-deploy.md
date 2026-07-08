# MAGE ID — Feature Build-Out Deploy Notes (2026-07-07)

Branch: **`claude/feature-buildout`** (off the merge-ready `claude/deslop-emoji-icons` tip, so it merges cleanly *after* the pre-prod fix branch).
Companion reviews: `docs/reviews/2026-07-07-price-takeoff-deep-review.md`, `…-punchlist-location-deep-review.md`, `…-marketing-site-audit.md`.

> Sandbox constraint: push / PR / merge / `eas update` / `supabase` apply / Netlify deploy are **owner-gated**. Everything below is built + gated (tsc clean, ship-check ALL PASS) as code; the owner runs ship steps.

## What shipped on this branch
- **Takeoff pricing** (`app/takeoff-estimate.tsx`, `app/area-takeoff.tsx`) — deterministic engine price (getLivePrices/getRegionMultiplier) shown alongside the AI's; area-takeoff manual/engine-rate fallback + single user-adjustable waste factor. OTA-safe.
- **Punchlist plan-anchoring** (`types/index.ts`, `app/plan-viewer.tsx`, `app/punch-list.tsx`, `contexts/ProjectContext.tsx`, `supabase/schema.sql`, migration) — planSheetId/pinX/pinY, create-from-pin, "On plan" chip, bidirectional pin↔item, and the GPS/pin fields now persist on sync. OTA-safe **once the migration is applied** (see gate).
- **Marketing** — amber-brand sweep + factual/pricing fixes across 30+ pages + screenshot-generator rebrand. Static; deploy via Netlify.

## 🚧 HARD DEPLOY GATE — order matters (punchlist)
`ProjectContext` now writes `plan_sheet_id/pin_x/pin_y/photo_*` on **every** punch insert/update. Until the migration is live, PostgREST rejects those writes with `PGRST204` (unknown column), which `utils/offlineQueue.ts` treats as a non-network error → shows an error toast **and drops the write** (not requeued). Net effect if JS ships first: every punch create/edit fails to sync and is **lost server-side** while local storage looks fine.

**Therefore, in order:**
1. Apply `supabase/migrations/20260707120000_punch_location.sql` to prod (project `nteoqhcswappxxjlpvap`) via Supabase MCP `apply_migration` (never `db push`). Additive/nullable — safe.
2. Verify columns exist (`execute_sql`).
3. *Then* `eas update --branch production` (app changes are OTA-safe — no native deps).

## Marketing deploy
- Source edited under `marketing/` (the `dist/` mirror was **not** touched). **Verify whether Netlify publishes `marketing/` source or a built `dist/`** — if `dist/`, regenerate it before deploy so these edits ship. Deploy build-free via `netlify deploy --dir` (mageid.app builds are credit-paused).

## ⚠️ Owner decisions / still-outstanding (NOT done here)
1. **Legal AI sub-processor inconsistency** — `privacy.html` names "Google (Gemini)"; `terms.html` + `do-not-sell.html` name "Anthropic". Left untouched deliberately (compliance statement). **Decide which vendor(s) actually process data and make all three legal pages consistent.**
2. **30 stale green app screenshots** (`marketing/screenshots/screens/01-projects.png` … `46-time-tracking.png`) — these are real screen captures from the *old green app*, embedded across ~18 pages. They must be **re-captured from the shipped amber build** (simulator; `scripts/` has an iOS-sim capture helper). The generator rebrand above fixes the App-Store/social/OG *hero* images, a separate set — it does not regenerate these app screenshots.
3. **JACK-gap features** — **safety management** (JHAs/incident/hazard) and **WIP reporting** are net-new modules (the one area competitor JACK App leads). They need a design pass (brainstorm → spec) before building.
4. **Takeoff P1/P2** (per review) — engine pricing is exact-unit-only today (walls LF / roofing SF fall back to AI-only); assemblies, unit-conversion, and supplier feeds are follow-ups.

## Gates (green on this branch)
`npx tsc --noEmit` → 0 · `bun run ship-check` → ALL PASS (incl. CPM slip==0 regression + app-slop guard) · marketing banned-pattern grep → 0 offenders (portal excluded).
