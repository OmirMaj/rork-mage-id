# MAGE ID — Master Ship Handoff (2026-07-09)

Branch **`claude/feature-buildout`** — **101 commits ahead of `origin/main`**. This is the single ordered ship-day runbook. It supersedes and references the earlier per-phase docs:
- `docs/deploy/2026-07-07-production-handoff.md` — pre-prod P0/P1 edge-fn deploy list + Stripe Connect webhook config.
- `docs/deploy/2026-07-07-feature-buildout-deploy.md` — takeoff pricing + punchlist plan-anchoring.
- `docs/deploy/2026-07-08-crew-worker-ids-bucket.md` — the `worker-ids` bucket runbook.

> **Everything below is owner-gated.** The sandbox cannot push, merge, apply migrations, deploy edge functions, create buckets, `eas update`, or deploy static sites. All of it is built + verified as code; you run the ship steps. **NEVER `supabase db push`** (divergent history) — apply migrations via the Supabase MCP `apply_migration` and verify with `execute_sql` (project `nteoqhcswappxxjlpvap`).

---

## What's on this branch
- **Pre-production hardening** (P0/P1): offline-queue data-loss, invoice/tax immutability, stripe-webhook retry, SSRF allowlist on vision fns, digest ownership+cron gate, server JWT verification, real slip KPI, hidden fake RFP paywall, `HIRE_ENABLED=false`.
- **Takeoff pricing** — real pricing engine wired to takeoff quantities + waste-factor fallback.
- **Punchlist plan-anchoring** — punch items pin to plan sheets; GPS/pin persist on sync.
- **Marketing** — amber-brand rebrand + factual fixes + re-audit (now advertises Safety/WIP/Crew).
- **4 new Business-tier features:** Safety Wave A (JHAs/toolbox/incidents/hazards + 3 AI fns), Worker Profile + ID Scan (CrewMember, scan-credential, claim-crew), Safety Wave B (inspections/certs/forms/OSHA-300), WIP Reporting (engine + snapshot/lock + export).

Each new feature was built task-by-task (implement→review→fix), then given a 4-dimension adversarial holistic review; **all findings fixed** (Wave A 15, Worker Profile 13, Wave B 12, WIP 15) + a cross-feature final review (iOS reachability, migration-race write safety, crew RLS). See `docs/reviews/2026-07-08-*`.

## Pre-flight gates (green as of this doc)
```bash
npx tsc --noEmit     # 0 errors
bun run ship-check   # ALL PASS — typecheck + lint + 14 validators
```
OTA-safe: **no new native modules** added anywhere in this branch → ships over OTA; keep `expo.version` stable.

---

## 🚧 CRITICAL: migration-before-OTA ordering
Every new feature's context writes new columns/tables. If the JS (OTA) reaches devices before its migration is live, PostgREST rejects the write. **Mitigation shipped this branch:** the offline queue now treats a PGRST204 schema-cache miss as *transient* (re-queues, doesn't drop) — so a brief race self-heals instead of losing data. **Still apply migrations FIRST** — the mitigation is a safety net, not a license to reorder.

**Ship order: merge → migrations → bucket → edge functions → OTA → static sites → config → smoke.**

---

## Step 1 — Merge to main
```bash
git push -u origin claude/feature-buildout
gh pr create --base main --title "Safety + Worker Profile + WIP + pre-prod hardening" \
  --body-file docs/deploy/2026-07-09-master-ship-handoff.md
# review, then merge
```

## Step 2 — Apply migrations IN ORDER (Supabase MCP `apply_migration`, never `db push`)
Project `nteoqhcswappxxjlpvap`. Apply in this exact order (dependencies: crew before safety_wave_b certs):
1. `20260707120000_punch_location.sql`
2. `20260708120000_safety_wave_a.sql`
3. `20260708130000_crew_members.sql`
4. `20260708180000_safety_wave_b.sql`
5. `20260708190000_wip_periods.sql`

All additive/nullable. After each, `execute_sql` a `select` to confirm the columns/tables + RLS policies + the two triggers (`crew_members_freeze_ownership`, `wip_periods_block_locked_update`) exist. `supabase/schema.sql` mirrors all five (reference only).

## Step 3 — Create the private `worker-ids` storage bucket
Per `docs/deploy/2026-07-08-crew-worker-ids-bucket.md`: a **private, RLS-scoped** bucket named `worker-ids`. Only reached when a GC opts in to *retain* a raw ID image (default is extract-then-purge → no image stored). Records store a path, never a durable URL. Without the bucket, retain-opt-in uploads fail gracefully; default scanning is unaffected.

## Step 4 — Deploy edge functions
**New this branch (the 4 features):**
```bash
supabase functions deploy safety-generate-jha safety-detect-hazards safety-draft-incident
supabase functions deploy scan-credential
supabase functions deploy claim-crew
```
- All gate with `requireTier(['business'])`, meter AFTER input validation, try/catch the model response, and SSRF-guard any fetched URL.
- `scan-credential` **never persists the ID image** and does not extract DOB.
- `claim-crew` runs with the **service role** (redeems an invite the claiming worker's JWT can't see under RLS); single-use — burns the token on redemption.
- Each needs `SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` (claim-crew) + `GEMINI_API_KEY` in env.

**Pre-prod-hardened fns (redeploy):** see `docs/deploy/2026-07-07-production-handoff.md` §2 — `stripe-webhook`, `analyze-*`, digests, `award-rfp`, and every fn importing `_shared/auth.ts` (server JWT verification). **Plus Stripe Connect webhook config** (that doc §3).

## Step 5 — OTA
```bash
eas update --branch production --message "Safety, Worker Profile, WIP + hardening"
```
App changes are OTA-safe (no native deps). Keep `expo.version` stable.

## Step 6 — Static sites (Netlify)
- **Marketing** (`marketing/`): redeploy build-free (`netlify deploy --dir`, per the netlify memory). ⚠️ **Deploy AT/AFTER the app OTA, never before** — the site now advertises Safety/WIP/Crew and must not claim features users can't yet reach.
- **Client portal** (`marketing/portal/`): unchanged this branch (its craft redesign is a separate branch) — redeploy only if bundling that.

## Step 7 — Config / entitlements
- **`supabase/config.toml` `verify_jwt`** — set `true` for the new user-gated fns (`safety-*`, `scan-credential`) and `false`/service-appropriate for `claim-crew` (it verifies the caller itself). Deferred deliberately (a wrong entry breaks a fn's auth model) — categorize + commit. The real protection (server-side JWT verify in `requireTier`) is already in code.
- **AI caps** (already in `_shared/auth.ts` `MONTHLY_CAPS`): `safety_ai` = free 0 / pro 0 / business 900 / enterprise 1800; `scan_credential` = free 0 / pro 20 / business 60 / enterprise 150. (Pro `scan_credential`=20 is dead config — scanning is Business-gated server-side; kept for uniformity.)
- **Tiers**: `safety_management`, `crew_management`, `wip_reporting` all → Business+; client `useTierAccess` matches server `requireTier`. Confirm RevenueCat entitlements gate correctly.

---

## Post-deploy smoke tests
- **Safety:** create a JHA → AI-generate steps; add a toolbox talk + sign an attendee → confirm it's now delete/edit-locked; log an incident with `daysAway>0`/`fatality` → open **OSHA-300**, confirm it lands in the correct column and only the selected **calendar year** appears; fail an inspection item → a Hazard spawns once (not on re-save).
- **Worker Profile:** create a CrewMember → **Scan ID** (consent gate appears, only masked last-4 saved, no image unless you opt in); send a claim invite → redeem on a second account → confirm the worker can edit only their own fields and can't forge `id_verified`/rename/self-assign.
- **WIP:** open a project → cost-to-date seeds from the suggestion + is editable → verify over/under-billing, a loss job books the full loss now; **Lock** a period → confirm it can't be edited (DB trigger raises); export PDF/CSV.
- **Offline/migration-race:** airplane-mode, create safety/crew/wip rows, restore signal → all flush, nothing lost.
- **iOS reachability:** on device, Tools screen shows **Safety / Crew / WIP** tiles (Business paywall for lower tiers).
- **Regression:** takeoff shows engine price beside AI; punch item pins to a plan; invoice tax immutability holds.

---

## ⚠️ Owner decisions / still outstanding (NOT auto-done)
1. **Legal AI sub-processor** — `privacy.html` says "Google (Gemini)"; `terms.html` + `do-not-sell.html` say "Anthropic." Pick the canonical vendor and make all three legal pages consistent. (Product uses Anthropic/Claude, so privacy.html is likely the stale one.)
2. **30 stale marketing screenshots** — `marketing/screenshots/screens/*.png` are old *green*-brand captures. Re-capture from the amber build with the repo's iOS-sim helper (`scripts/`, commits `920677b`/`5549315`), same filenames. The generators are already amber; these are real app captures.
3. **`HIRE_ENABLED` stays `false`** — the Crew→marketplace surfacing is built but gated. Flip only when you're ready to launch the Hire marketplace (verified worker profiles are the trust layer for it).
4. **P2/P3 backlog** — per `docs/audits/2026-07-07-preprod-audit.md` (AI-metering fail-closed, atomic invoice-payment append, cross-tenant flush race, etc.).
5. **JACK App / IP hygiene** — trademark clearance + registration for "MAGE ID"; a short IP-attorney freedom-to-operate check (see the competitive/IP notes from the JACK research).

## Rollback
OTA is instant-revertible (`eas update` republish the prior). Migrations are additive/nullable — safe to leave even if you roll back the JS (columns just go unused). Edge functions: redeploy the prior version. No destructive changes anywhere.
