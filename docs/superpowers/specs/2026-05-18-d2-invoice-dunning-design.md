# D2 — Automated Payment Reminders / Dunning on Overdue Invoices — Design

Source: `docs/superpowers/audits/2026-05-17-feature-depth-audit.md` (D2). Build target: p0-on-main worktree, branch `claude/p0-launch-on-main`, HEAD `ce86197`.

**Server-only:** a scheduled edge function + one additive idempotent migration + one idempotent cron block. **No app code, no OTA, no portal-HTML** → fully independent of H4's Netlify block. Ships via `supabase functions deploy` + Supabase MCP `apply_migration` (the H4-independent path).

## 1. Problem

Overdue invoices just sit there — the GC must manually chase payment. The market-loved flow is automatic, escalating, polite payment reminders that stop when paid. MAGE already has every primitive:
- **Invoices:** `Invoice { id, number, projectId, dueDate: string, totalDue, amountPaid, status: 'draft'|'sent'|'partially_paid'|'paid'|'overdue', payLinkUrl? (Stripe one-tap pay) }` in the `invoices` table.
- **Two close analogs to mirror:** `supabase/functions/coi-expiry-watch` — a daily service-role cron that emails on a date condition with **per-row dedup markers** (`coi_last_warned_at`/`coi_last_warned_threshold`) so each threshold fires once; and `supabase/functions/homeowner-weekly-digest` — resolves the project's homeowner/client from `projects.client_portal` and emails via the shared shell with unsubscribe.
- **Shared email:** `_shared/email.ts` (`wrapEmailHtml({..., unsubscribe})`, `resendSend`, `emailButton`, `escapeHtml`) — every transactional email's shell, incl. footer/List-Unsubscribe/compliance. D2 inherits it identically by mirroring a digest's send call.
- **Cron infra:** `supabase/migrations/schedule_all_crons.sql` — idempotent `cron.unschedule` then `cron.schedule` POSTing the edge fn (empty body); functions deployed `--no-verify-jwt` to accept the unauthenticated cron call; each fn is itself dedup-safe so a duplicate fire won't double-send.

D2 = the `coi-expiry-watch` trigger/dedup pattern + `homeowner-weekly-digest` recipient resolution + the shared email shell, applied to overdue invoices.

## 2. Goal / Non-goals

**Goal:** A daily scheduled `invoice-dunning` edge fn finds each overdue, still-owed invoice, and emails the project's client an escalating, polite reminder at fixed stages (≥1d, ≥7d, ≥14d past due), exactly once per stage, with a one-tap "Pay now" (Stripe `payLinkUrl`) when available. Stops automatically when paid / zero balance / not yet due. Recipient can unsubscribe (existing footer/`email_unsubscribes` compliance, category `payment_reminders`). Cron-fire-idempotent (no double-send).

**Non-goals (YAGNI / scope / independence):**
- No app/UI change, no OTA — purely server-side (keeps D2 fast, fully Netlify/H4-independent). A GC-facing on/off toggle and per-GC custom schedules are **deferred** (documented §7); v1 uses fixed sensible stages, and the *recipient* opt-out (unsubscribe) is the real compliance lever.
- No change to invoice financial fields/logic, the app's `status` transitions, Stripe, or any existing edge fn / the portal.
- No SMS/push — email only (mirrors the existing digests).
- Not a collections/legal-escalation engine — 3 polite stages then stop.

## 3. Architecture

### 3.1 Scheduled edge fn `supabase/functions/invoice-dunning/index.ts` (mirror `coi-expiry-watch`)

- Same shell verbatim: `Deno.serve`, service-role client (`SUPABASE_SERVICE_ROLE_KEY`), `_shared/email.ts` (`wrapEmailHtml`/`resendSend`/`emailButton`/`escapeHtml`), CORS/`jsonResponse` helpers, the brand color consts — copy `coi-expiry-watch`'s structure.
- Triggers: `POST { all: true }` (cron, daily) processes all eligible invoices; `POST { invoiceId }` (preview/test) processes one. Unauthenticated-cron-safe (deployed `--no-verify-jwt`); dedup makes a duplicate fire a no-op.
- **Eligibility (computed robustly, not trusting a possibly-stale `status`):** an invoice is dunnable when `due_date < now()` AND `status NOT IN ('paid','draft')` AND outstanding `= total_due - coalesce(amount_paid,0) > 0`. (Confirm exact `invoices` snake_case column names against the live table read-only at build — `due_date,total_due,amount_paid,status,project_id,number,pay_link_url`.)
- **Stage policy (fixed v1):** `daysOverdue = floor((now - due_date)/1d)`. Stages: **1** at `daysOverdue ≥ 1` (friendly reminder), **2** at `≥ 7` (second notice), **3** at `≥ 14` (final notice). The fn sends the **highest not-yet-sent** stage the invoice currently qualifies for, then records it. After stage 3 is sent, no further emails (cap). Stop conditions (no send, and optionally clear nothing): paid / zero-balance / draft / not yet overdue.
- **Dedup (mirror coi):** per-invoice marker columns `dunning_stage int` + `dunning_last_sent_at timestamptz`. Send stage N only if `coalesce(dunning_stage,0) < N`. On success, set `dunning_stage = N, dunning_last_sent_at = now()`. A re-fire same day → `dunning_stage` already ≥ N → skip. (Idempotent like every other cron fn.)
- **Recipient:** resolve the project's client/homeowner email from `projects.client_portal` exactly as `homeowner-weekly-digest` does (same lookup + same "no email → skip" guard). One email per eligible invoice to that client.
- **Email:** compose via `wrapEmailHtml({ ...content, unsubscribe: { category: 'payment_reminders', ... } })` + `resendSend`, mirroring `homeowner-weekly-digest`'s send call (so List-Unsubscribe/footer/`email_unsubscribes` compliance is inherited identically — D2 does NOT re-implement unsubscribe). Content: project name, invoice #, amount outstanding (`total_due - amount_paid`), days overdue, due date; stage-appropriate subject/tone; a primary `emailButton('Pay now', payLinkUrl)` when `pay_link_url` present, else a "View invoice" link to the existing portal. Service role reads invoices + project, writes ONLY the 2 marker columns; never mutates financial fields.

### 3.2 Migration (additive, idempotent — via MCP, not Netlify)

`supabase/migrations/<ts>_invoice_dunning_markers.sql`:
```sql
alter table public.invoices add column if not exists dunning_stage integer;
alter table public.invoices add column if not exists dunning_last_sent_at timestamptz;
```
Nullable, no default/rewrite/NOT NULL — safe on the live `invoices` table; idempotent. No RLS change (service-role fn bypasses RLS; the app never reads these columns — they're operational markers).

### 3.3 Cron registration (idempotent block in `schedule_all_crons.sql`)

Append a block mirroring the `coi-expiry-watch` one: `DO $$ BEGIN PERFORM cron.unschedule('invoice-dunning'); EXCEPTION WHEN OTHERS THEN NULL; END $$;` then `cron.schedule('invoice-dunning', '<daily UTC time distinct from existing jobs, e.g. 15:00>', $$ select net.http_post(<the project's functions URL>/invoice-dunning, body := '{"all":true}'::jsonb, ...) $$);` — copy the exact `net.http_post` form the existing blocks use (same headers/url construction). Idempotent (unschedule-then-schedule); applied via MCP `apply_migration`.

## 4. Error handling / correctness

- Per-invoice try/catch: a bad row (missing project/email, Resend failure) logs + continues; never aborts the batch (mirror coi-expiry-watch's loop resilience). A failed send does NOT advance `dunning_stage` (so it retries next day) — only a confirmed send records the marker.
- Idempotent at every layer: migration (`add column if not exists`), cron (unschedule-then-schedule), and the fn (stage marker) — a duplicate cron fire or migration re-apply is a safe no-op (the schedule_all_crons.sql header guarantees this contract).
- Compliance: unsubscribe handled entirely by `_shared/email.ts` via the `unsubscribe` category — a client who unsubscribed from `payment_reminders` is suppressed by the same mechanism the other digests use (D2 passes the category and inherits it; verify by mirroring `homeowner-weekly-digest`'s `wrapEmailHtml` unsubscribe usage exactly).
- No financial mutation: the fn only reads invoice/project and writes the 2 marker columns. It cannot change balances, status, or the portal.
- Stale-status robustness: eligibility is computed from `due_date` + balance, so it's correct even if the app hasn't flipped `status` to `'overdue'`.

## 5. Verification (no unit runner)

`npx tsc --noEmit` clean (edge fns excluded from tsconfig — hand-review the Deno fn) + manual/`curl`:
- `POST {invoiceId}` for a synthetic overdue invoice (1/7/14 days past due, balance>0) → correct stage email to the client_portal email, with Pay-now button when payLinkUrl set; marker advances.
- Re-`POST` same invoice same day → no second email (dedup).
- Paid / zero-balance / not-overdue / draft invoice → no email.
- Stage escalation: at +1d stage 1; advancing the clock to +7d → stage 2; +14d → stage 3; beyond → none (cap).
- Unsubscribed client → suppressed (same as other digests).
- Migration `apply_migration` succeeds; re-run no-op. Cron block schedules `invoice-dunning` daily; re-apply no-op. No invoice financial field changed by the fn.
- Final whole-impl review (opus) — verify schema/RLS claims against LIVE prod (information_schema/pg_policies), not stale schema.sql.

## 6. Ship (controller, after final review — not build)

No FF-merge-then-OTA needed for app code (none changed). Sequence: FF-merge docs/fn/migration → push → `supabase functions deploy invoice-dunning --no-verify-jwt --project-ref nteoqhcswappxxjlpvap` → apply the marker migration via MCP `apply_migration` → apply the cron-block migration via MCP. All independent of Netlify/H4. (Optionally `eas update` only if any app file changed — expected none.)

## 7. Out of scope / future

- GC-facing enable/disable toggle + per-GC custom dunning schedule/templates (requires app UI + settings + OTA) — deferred; v1 is fixed sensible stages with recipient unsubscribe.
- SMS/push reminders; collections/legal escalation; partial-payment-aware re-aging beyond the 3 stages; per-invoice manual "send reminder now" button (app/OTA) — future.
- D1b-2 (per-project cost-book), D3, D4 — separate.
