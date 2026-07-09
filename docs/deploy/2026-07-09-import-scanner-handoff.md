# Schedule Import + Scan Anything — Deploy Handoff (2026-07-09, overnight build)

Branch **`claude/scheduler-import-scanner`** — **23 commits ahead of `origin/main`**. Two new features, built → gated → adversarially reviewed → fixed → committed to ship-ready while you slept. **Nothing pushed or deployed.**

> **All steps below are owner-gated.** Apply migrations via the Supabase MCP `apply_migration` (project `nteoqhcswappxxjlpvap`) — **NEVER `supabase db push`**. Deploy edge functions via the already-authenticated `supabase functions deploy`.

---

## Pre-flight (green as of this doc)
- `npx tsc --noEmit` → **0 errors**
- `bun run ship-check` → **ALL PASS** (added validators: `test:schedule-import`, `test:scan-routing`)
- OTA-safe: **no new native modules** (all parsing/vision in Deno edge fns; capture reuses `expo-image-picker`). Keep `expo.version` stable.

## What's on the branch
- **Feature A — Schedule Import** (Pro+): import Excel `.xlsx` + MS Project XML into Schedule Pro. AI-detected Excel column mapping (confirm/override), structured MSPDI auto-map, replace-with-**restorable-scenario-snapshot**, CPM-validated.
- **Feature B — Scan Anything** (Business): one capture → Gemini classifies the doc/item → extracts fields → files to the right `project-documents` folder + creates the matching record (invoice→cost, business card→contact, COI→sub compliance); government IDs **redirect** to the consented crew ID-scan flow (never extracted here). Logged in `scan_records`.

## Bugs the adversarial review caught + fixed (worth knowing)
1. **CRITICAL (import):** the "baseline snapshot before replace" was hollow — `captureBaseline` stores only `{id,startDay,endDay}`, no restore path, mismatched IDs → import would have **irreversibly destroyed a user's schedule** despite the UI promising "nothing is lost." Now saves the **full schedule as a restorable What-If Scenario** + adds destructive replace-confirm dialogs.
2. **HIGH (import):** Excel predecessor off-by-one (0-based vs 1-based) → wrong dependency links. Fixed to 1-based `sourceId`.
3. **HIGH (scan):** on upload failure `onSave` showed a false "Filed" banner, discarded the capture (no retry), and logged an orphan `scan_records` row. Now early-returns on failure — no banner, no orphan, capture kept for retry.
4. **HIGH (scan):** no timeout on the Gemini fetch (could hang to the wall-clock limit after burning quota). Added `AbortController` timeouts.
5. **MEDIUM (scan):** government-ID boundary now checks **both** the redirect flag **and** the docType (defense-in-depth) + `maxOutputTokens` raised so large invoices don't truncate to a blank form.

---

## 🚧 Deploy order: merge → migration → edge fns → OTA → smoke

### Step 1 — Merge to main
```bash
git push -u origin claude/scheduler-import-scanner
gh pr create --base main --title "Schedule Import + Scan Anything" \
  --body-file docs/deploy/2026-07-09-import-scanner-handoff.md
# review, then: gh pr merge <#> --squash
```

### Step 2 — Apply the ONE new migration (Supabase MCP `apply_migration`)
- `supabase/migrations/20260709120000_scan_records.sql` — `scan_records` table + owner-scoped RLS + `updated_at` trigger. Additive/nullable.
- After applying, `execute_sql` a quick `select` to confirm the table + 4 RLS policies + trigger exist. (Schedule Import adds **no** table — it writes into the existing `projects.schedule` JSONB.)
- **Apply BEFORE the OTA** (PGRST204 gate — the shipped offline-queue tolerance re-queues a race, but migration-first is still correct).

### Step 3 — Deploy the TWO new edge functions
```bash
supabase functions deploy import-schedule --project-ref nteoqhcswappxxjlpvap
supabase functions deploy scan-anything   --project-ref nteoqhcswappxxjlpvap
```
- Both bundle the current `_shared/auth.ts` (which now carries the new `schedule_import` + `scan_anything` caps) — the CLI reads from disk, so this is automatic.
- Both default to `verify_jwt=true` (correct — both require an authenticated caller via `requireTier`).
- Both need `GEMINI_API_KEY` in project env (already set — `analyze-photos` uses it).
- `import-schedule` pulls SheetJS from `https://esm.sh/xlsx@0.18.5` — no app-side dependency. **Version is pinned to 0.18.5 deliberately:** SheetJS stopped publishing to npm after 0.18.5 (0.19+/0.20+ live only on `cdn.sheetjs.com`, which the Supabase deploy bundler refuses to fetch). Only `XLSX.read` + `XLSX.utils.sheet_to_json` are used — both stable since well before 0.18.5. Do NOT "upgrade" this to a 0.20.x esm.sh/cdn URL; the deploy will fail to bundle.

### Step 4 — OTA
```bash
eas update --branch production --message "Schedule Import + Scan Anything"
```
JS-only, OTA-safe; do NOT bump `expo.version`.

### Step 5 — Marketing (optional)
No marketing changes are required. If you want to advertise these (both are strong differentiators — "import your MS Project/Excel schedule" and "scan anything → auto-filed"), that's a separate marketing edit + redeploy.

---

## Post-deploy smoke tests
- **Schedule Import:** open Schedule Pro → Import → pick an MS Project XML export → confirm tasks/links/constraints/WBS import and the Gantt renders; then pick a messy Excel → confirm the AI column mapping + override; verify the **destructive "Replace current schedule?" confirm** appears when the project already has tasks, and that the pre-import plan is recoverable via **What-If Scenarios → "Before import — <date>"**.
- **Scan Anything:** scan an invoice → confirm it files to **Financials** + creates a cost entry; scan a business card → **Contact** created; scan a COI → filed to Contracts (attach to a sub); scan a **government ID** → confirm the **redirect card** appears and **nothing is uploaded/saved**; kill wifi mid-save → confirm the failure keeps the capture for retry (no false "Filed" banner).
- **Tiers:** a Pro user gets Schedule Import but hits the Business paywall on Scan; a free user hits both paywalls.

## ⚠️ Screenshots — need you at the login
I could not capture the two new screens overnight: the simulator runs a standalone build without the new code (no Metro server was running), and the web build needs a login I can't perform. **~2 minutes with you:** run `bun run start` on this branch (I'll deep-link `/schedule-import` and `/scan` and capture), or log into the web build and I'll drive the capture.

## Open decisions (flagged for you)
1. **Tiers** — Schedule Import = **Pro+**, Scan = **Business** (my picks). Change either if you prefer.
2. **Deferred, per spec:** native `.mpp` import (needs a server converter), round-trip export back to MS Project XML, the Scan **asset/equipment register** + **barcode/QR** (needs `expo-camera` = a native build, not OTA), batch multi-doc scanning.

## Rollback
- OTA: `eas update` republish the prior group (instant).
- Migration: `scan_records` is additive — safe to leave even if you revert the JS.
- Edge functions: redeploy the prior version (or just leave them — they're gated + unused if the JS is rolled back).
- Merge: revert the squash commit on `main`.
