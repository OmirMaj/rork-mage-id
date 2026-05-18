# D2 — Automated Payment Reminders / Dunning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A daily scheduled `invoice-dunning` edge fn emails the project's client an escalating, polite reminder on each overdue still-owed invoice (stages at ≥1/7/14 days past due, once per stage, stop on paid).

**Architecture:** Server-only. Mirror `supabase/functions/coi-expiry-watch` (shell + per-row stage dedup + `{all}`/single trigger) and `supabase/functions/homeowner-weekly-digest` (resolve client from `projects.client_portal.invites[].email`; `wrapEmailHtml`+`resendSend` with unsubscribe). One additive idempotent marker migration + one idempotent cron block. **No app code / no OTA / no portal-HTML** → fully independent of H4's Netlify block.

**Tech Stack:** Deno edge fn, `_shared/email.ts`, Supabase service-role, pg_cron. No unit runner — gate = `npx tsc --noEmit` (edge fns excluded from tsconfig; hand-review the Deno fn) + the spec §5 manual/curl checks.

**Spec:** `docs/superpowers/specs/2026-05-18-d2-invoice-dunning-design.md` (@ `350d76e`). Worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main`. Use `git -C "<that path>"`.

## CRITICAL
- **Build authors files only.** `supabase functions deploy invoice-dunning --no-verify-jwt --project-ref nteoqhcswappxxjlpvap`, applying the marker migration via Supabase MCP, and applying the cron-block migration via MCP are **SHIP-TIME controller steps** (independent of Netlify/H4) — NOT build steps. Do NOT deploy/apply during build. Read-only MCP `execute_sql` (information_schema) to confirm column names is allowed.
- **Verified live `invoices` columns:** `due_date text`, `total_due numeric`, `amount_paid numeric`, `status text`, `project_id uuid`, `number integer`, `user_id uuid`. **No `pay_link_url` / `dunning_stage` / `dunning_last_sent_at` columns yet** (the markers are added by Task 1; there is NO pay-link column — link to the portal generically). `due_date` is TEXT (ISO) — cast for date math.
- Per-task gate: `npx tsc --noEmit` clean + the named manual reasoning.

## File Structure
- Create `supabase/migrations/20260518150000_invoice_dunning_markers.sql` — Task 1.
- Create `supabase/functions/invoice-dunning/index.ts` — Task 2.
- Modify `supabase/migrations/schedule_all_crons.sql` — Task 3 (append one idempotent block).

---

### Task 1: Marker migration (authored only)

**Files:** Create `supabase/migrations/20260518150000_invoice_dunning_markers.sql`

- [ ] **Step 1** Create exactly:
```sql
-- D2 — per-invoice dunning dedup markers (mirror coi-expiry-watch's
-- coi_last_warned_* pattern). Additive, idempotent, nullable, no default/
-- rewrite — safe on the live invoices table. Operational columns only;
-- the app never reads them; service-role dunning fn bypasses RLS. Applied
-- via Supabase MCP apply_migration at ship (independent of Netlify/H4).
alter table public.invoices add column if not exists dunning_stage integer;
alter table public.invoices add column if not exists dunning_last_sent_at timestamptz;
```
- [ ] **Step 2** Verify: only the 2 `add column if not exists` (no NOT NULL/default/RLS/other DDL). `grep -c "add column if not exists" <file>` → 2. `npx tsc --noEmit` clean (SQL-only). **Do NOT apply.**
- [ ] **Step 3** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/migrations/20260518150000_invoice_dunning_markers.sql
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D2): additive invoices dunning_stage + dunning_last_sent_at markers"
```

---

### Task 2: `invoice-dunning` edge fn

**Files:** Create `supabase/functions/invoice-dunning/index.ts`

- [ ] **Step 1** Read FULLY: `supabase/functions/coi-expiry-watch/index.ts` (the shell + trigger + per-row dedup + batch-resilient loop to mirror) and `supabase/functions/homeowner-weekly-digest/index.ts` (how it resolves the client email from `projects.client_portal.invites[].email`, and its `wrapEmailHtml({..., unsubscribe})` + `resendSend(RESEND_API_KEY, { to, ... })` send path). Read `supabase/functions/_shared/email.ts` exports (`wrapEmailHtml`, `resendSend`, `emailButton`, `escapeHtml`, the `UnsubscribeOpts` shape).

- [ ] **Step 2** Create `supabase/functions/invoice-dunning/index.ts` mirroring `coi-expiry-watch`'s structure VERBATIM where generic (Deno serve, service-role client from `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `RESEND_API_KEY`, CORS + `jsonResponse`, brand consts, the per-row try/catch batch loop that logs+continues on error), changing only the domain logic:
  - **Trigger:** `POST {}` or `{ all: true }` (cron) → process all eligible; `POST { invoiceId }` → just that one (preview/test). Treat empty body as all (the cron posts `'{}'`).
  - **Fetch eligible invoices** via the service-role REST/`supabase-js` client: select `id, number, project_id, due_date, total_due, amount_paid, status, dunning_stage` from `invoices` where `status not in ('paid','draft')` and `(total_due - coalesce(amount_paid,0)) > 0` and `due_date < now()` (cast: `due_date` is text ISO — compare as `new Date(due_date).getTime() < Date.now()` in JS after fetch, OR a SQL filter `due_date::timestamptz < now()` if filtering server-side; prefer fetching candidates `status not in ('paid','draft')` then computing overdue+balance+stage in JS for clarity, mirroring how coi computes thresholds in JS). For `{invoiceId}` fetch just that row.
  - **Stage policy:** `daysOverdue = Math.floor((Date.now() - new Date(due_date).getTime()) / 86400000)`. `targetStage = daysOverdue >= 14 ? 3 : daysOverdue >= 7 ? 2 : daysOverdue >= 1 ? 1 : 0`. Skip if `targetStage === 0` or `coalesce(dunning_stage,0) >= targetStage` (already sent this/higher stage) or balance ≤ 0 or status paid/draft.
  - **Recipient:** for the invoice's `project_id`, load the project's `client_portal` and take the client email exactly as `homeowner-weekly-digest` resolves it (`client_portal.invites[].email` — reuse its resolution logic; "no email → skip, log, continue"). 
  - **Email:** subject/tone by stage (1 = friendly reminder, 2 = second notice, 3 = final notice). Body via `wrapEmailHtml({ title, ..., unsubscribe: { category: 'payment_reminders', /* mirror homeowner-weekly-digest's unsubscribe opts shape exactly */ } })`: project name, `Invoice #<number>`, amount outstanding `total_due - (amount_paid||0)` (format like the other emails), due date, days overdue, and `emailButton('View invoice', <portalUrl>)` where `<portalUrl>` is the existing homeowner portal link for that project (reuse however homeowner-weekly-digest builds the portal URL; do NOT invent a pay link — there is no pay_link_url column). Send via `resendSend(RESEND_API_KEY, { to, subject, html, ... })` mirroring homeowner-weekly-digest's `sendEmail`.
  - **Dedup write (only on confirmed send):** after a successful `resendSend`, update that invoice row `dunning_stage = targetStage, dunning_last_sent_at = now()` (service-role; ONLY these 2 columns — never touch financial/status fields). A failed send does NOT write the marker (retries next day). Mirror coi's "write marker only after send".
  - Return `jsonResponse({ processed, sent, skipped })` like coi.

- [ ] **Step 3** Gate: `npx tsc --noEmit` from worktree root → clean (edge fns are excluded from tsconfig; this confirms the repo still compiles — also hand-read the new Deno file: no `any`/`@ts-ignore`; service-role only writes the 2 marker columns; per-row try/catch; treats empty body as all; unsubscribe category passed). Reason through spec §5 cases statically.

- [ ] **Step 4** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/functions/invoice-dunning/index.ts
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D2): invoice-dunning scheduled edge fn (3-stage, dedup, portal link, unsubscribe)"
```
If `coi-expiry-watch`/`homeowner-weekly-digest` differ materially from assumptions (recipient resolution, send helper, dedup write), ADAPT to the real patterns (goal: behaves like those two analogs) and report it.

---

### Task 3: Cron registration (idempotent block)

**Files:** Modify `supabase/migrations/schedule_all_crons.sql`

- [ ] **Step 1** Read the existing `coi-expiry-watch` block (its exact `DO $$ ... cron.unschedule ... $$;` + `SELECT cron.schedule('coi-expiry-watch','0 14 * * *', $cronbody$ SELECT net.http_post(url:='https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/coi-expiry-watch', headers:='{"Content-Type": "application/json"}'::jsonb, body:='{}'::jsonb, timeout_milliseconds:=60000); $cronbody$);` form).

- [ ] **Step 2** APPEND (do not modify existing blocks) a numbered block mirroring it exactly, swapping name/url/time:
```sql

-- N. invoice-dunning — daily at 15:00 UTC (10 AM EST). Emails the project
--    client an escalating reminder on each overdue, still-owed invoice.
--    Idempotent via per-invoice dunning_stage; empty body = process all.
DO $$ BEGIN PERFORM cron.unschedule('invoice-dunning'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule(
  'invoice-dunning',
  '0 15 * * *',
  $cronbody$
  SELECT net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/invoice-dunning',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $cronbody$
);
```
(Use the next sequential block number in the file's comment numbering. `0 15 * * *` is distinct from coi's `0 14`. Match the file's exact existing punctuation/quoting.)

- [ ] **Step 3** Gate: `npx tsc --noEmit` clean (SQL-only). Verify: block appended, existing blocks byte-unchanged (`git diff` shows only an added block), idempotent unschedule-then-schedule, url ends `/functions/v1/invoice-dunning`, `body := '{}'::jsonb`. **Do NOT apply.**

- [ ] **Step 4** Commit:
```bash
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" add supabase/migrations/schedule_all_crons.sql
git -C "/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main" commit -m "feat(D2): schedule invoice-dunning daily cron (idempotent block)"
```

---

## Ship (controller, after final whole-impl review — NOT build)
1. FF-merge `claude/p0-launch-on-main` → `main`, push.
2. `supabase functions deploy invoice-dunning --no-verify-jwt --project-ref nteoqhcswappxxjlpvap`.
3. Apply the marker migration via Supabase MCP `apply_migration` (name `invoice_dunning_markers`, Task-1 SQL) — additive/idempotent.
4. Apply the updated `schedule_all_crons.sql` cron block via Supabase MCP `apply_migration` (name `schedule_invoice_dunning`, just the new block's SQL) — idempotent unschedule-then-schedule.
5. Smoke: `curl` the deployed fn with `{ "invoiceId": "<a known overdue test invoice>" }` and confirm one staged email + the marker advanced (or a dry inspection). No app OTA (no app file changed). Independent of Netlify/H4.

## Self-Review
**Spec coverage:** §3.1 fn (trigger/eligibility/stage/recipient/email/dedup) → Task 2. §3.2 migration → Task 1. §3.3 cron → Task 3. §4 error handling → Task 2 (per-row try/catch, marker-only-on-send, no financial mutation, inherited unsubscribe). §5 verification → per-task gates + ship smoke. §6 ship → Ship section. §2 non-goals respected (server-only, no OTA/app/portal, 3 fixed stages, no pay-link-column assumption — corrected). No gaps.
**Placeholder scan:** Migration SQL + cron block given verbatim. The edge fn is specified as "mirror `coi-expiry-watch` + `homeowner-weekly-digest` (named, read-in-full) with THIS exact eligibility/stage/dedup/recipient/email logic" — a precise named-anchor mirror (reproducing two 200-line Deno fns in the plan would invite drift; read+mirror is the established correct approach, same as the useTimeEntries-mirrored hook). Exact column names + the no-pay-link-column fact are pinned from live verification. No vague TODOs.
**Type/name consistency:** `dunning_stage`/`dunning_last_sent_at` identical in Task 1 (migration), Task 2 (fn read/write), Task 3 (comment). Fn name `invoice-dunning` identical across Tasks 2-3 + cron url + ship. Stage thresholds (≥1/7/14 → 1/2/3) consistent with spec §3.1. Unsubscribe `category: 'payment_reminders'` consistent with spec. Cron `0 15 * * *` distinct from coi `0 14`. Migration filename `20260518150000` sorts after D1c's `20260518140000`.
