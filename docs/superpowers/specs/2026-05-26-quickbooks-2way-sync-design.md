# QuickBooks Online 2-Way Sync (push-primary) — Design

**Date:** 2026-05-26
**Status:** Approved (design) — ready for implementation plan
**Scope:** A deep, ongoing **push-primary** sync between MAGE ID and **QuickBooks Online (US)** that replaces the existing CSV-export bridge as the GC's default accounting workflow. Comprehensive object coverage (Customers, Invoices, Items, Payments, Vendors, Bills, Change Orders, AIA pay apps). The user has an Intuit Developer app ready.

## Goal

Answer the #1 GC buying objection (per the 2026-05-25 competitive audit): "Does it sync with QuickBooks?" with **yes, properly** — invoices, payments, change orders, AIA progress billing, and vendor bills flow live between MAGE and QBO without a manual CSV dance. MAGE remains the source of truth; QBO is the always-current reflection plus the place where payments come back.

## Non-goals (v1)

- **Full bidirectional editing with conflict resolution** (per the picked direction — push-primary). If the GC edits an invoice in QBO, MAGE wins on the next push.
- **QuickBooks Desktop / QBO Self-Employed** — only QuickBooks Online (US edition, V3 REST API).
- **Sales-tax computation** — defer to QBO's tax settings on the customer/item.
- **Class / Location tracking, inventory, custom fields.**
- **Multi-realm switching for one user** — one connection per user account at a time.
- **Smart "match existing QBO customer/item"** UI on connect — v1 creates new in QBO; a v2 "match existing" wizard later (existing QBO data isn't duplicated maliciously, just shows up alongside; user can re-map manually post-MVP).
- **Replacing the existing CSV export** — the CSV stays for Xero/Sage users and one-shot exports; the live sync is the new default for QBO.

---

## Architecture — mirrors the Stripe Connect pattern

### OAuth 2.0 connection
- **Scope:** `com.intuit.quickbooks.accounting` (and `openid profile email` if we want the user's QBO identity for display). Authorization endpoint `https://appcenter.intuit.com/connect/oauth2`; token endpoint `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`.
- **Flow** — three edge functions, mirroring `connect-onboarding`/`connect-status`/`stripe-webhook`:
  - **`qbo-connect-start`** (`requireTier(req, ['business','enterprise'], 'qbo_connect')`): returns the Intuit authorize URL with a state-signed nonce keyed to `auth.uid()` (HMAC over `userId|nonce|exp`). Caller opens it in an in-app browser / `WebBrowser.openAuthSessionAsync`.
  - **`qbo-connect-callback`**: receives `code` + `state` + `realmId` from Intuit's redirect, verifies state HMAC + expiry, POSTs to Intuit's token endpoint with `INTUIT_CLIENT_ID`/`INTUIT_CLIENT_SECRET` (Basic auth, per Intuit spec), upserts a `qbo_connections` row.
  - **`qbo-connect-status`**: returns the current connection's `{ status, realmId, companyName?, environment, lastSyncAt, errorCount }` for the Settings UI.
- **Redirect URL** — `https://app.mageid.app/integrations/qbo/callback` (web build handles deep-link forwarding to native via the existing Expo Router origin pin). Configure the redirect URL in the Intuit Developer app for **both sandbox + production**.
- **Secrets** — `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET` (one set per environment, controlled by the `qbo_environment` field on the connection). User-provided at deploy time via Supabase secrets.

### Connection table — `qbo_connections` (NEW migration)
```sql
create table public.qbo_connections (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  realm_id         text not null,
  environment      text not null check (environment in ('sandbox','production')),
  access_token     text not null,        -- ~1h TTL, refreshed on demand
  refresh_token    text not null,        -- ~100 days, rotated each refresh per Intuit spec
  access_expires_at timestamptz not null,
  company_name     text,
  status           text not null default 'connected'
                     check (status in ('connecting','connected','reauth_required','error','disconnected')),
  last_sync_at     timestamptz,
  last_error       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.qbo_connections enable row level security;
create policy qbo_connections_owner on public.qbo_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
**Tokens are sensitive** — RLS owner-only; writes only via edge fns (SECURITY DEFINER). Never log them.

### Sync engine — one router + per-family workers
- **`qbo-sync`** (router, `requireTier(['business','enterprise'])`): body `{ kind: 'invoice'|'payment'|'customer'|'item'|'vendor'|'bill'|'changeOrder'|'aiaPayApp', op: 'upsert'|'delete', objectId: string }`. Loads connection, refreshes access token if expiring within 5 min, dispatches to the worker.
- **Per-family worker** functions (separate files for isolation + testability): each owns the MAGE↔QBO mapping for one family. Each function:
  1. Fetches the MAGE object from Supabase (RLS scoped).
  2. Hashes the synced-relevant fields → `qboHash`.
  3. If `qboHash` unchanged AND `qboId` present → no-op (idempotent).
  4. Builds the QBO V3 request body (Invoice / Item / Payment / etc.).
  5. POSTs to `https://{sandbox-,}quickbooks.api.intuit.com/v3/company/{realmId}/{entity}` (`Authorization: Bearer <access>`, `Accept: application/json`).
  6. On success: writes `{ qboId, qboHash, qboSyncedAt: now, qboSyncStatus: 'synced', qboError: null }` back to the MAGE row.
  7. On failure (4xx/5xx): writes `{ qboSyncStatus: 'error', qboError: '<status>: <fault.error[].Message>' }` and enqueues a retry (see "Error queue").
- **Token refresh** — a small `refreshAccessToken(connection)` helper POSTs to Intuit's token endpoint with `grant_type=refresh_token`. Updates `access_token`/`refresh_token`/`access_expires_at` (Intuit rotates the refresh token on every call — must persist both). If refresh fails with `invalid_grant` → set connection `status='reauth_required'`, surface to the UI.

### Triggers — hybrid
- **Real-time push** on financial mutations: a thin `useQboSync()` hook in the app subscribes to mutations on Invoice / Payment / ChangeOrder / AIASavedPayApp / Commitment via the existing offline-queue post-write callback; each enqueues an `invoke('qbo-sync', { kind, op, objectId })`. **Fire-and-forget** — UI never blocks on sync; status flows via the `qboSyncStatus` field.
- **On-demand** — a global **"Sync now"** button in Settings → QuickBooks (re-pushes everything `pending|error` for the user). A per-object **"Retry"** in the errors tray.
- **Cron** — `qbo-reconciler` (`verify_jwt:false`, cron-secret-guarded like the other crons; runs every 30 min): for each connection, (a) re-pushes anything `pending|error` older than 5 min, (b) queries QBO for invoices updated since `last_sync_at` and flows payment status back into MAGE (creates a `Payment` row when QBO has one MAGE doesn't), (c) updates `last_sync_at`.

### Error queue (lightweight, no new table)
The `qboSyncStatus: 'error'` + `qboError` columns ON the MAGE rows themselves ARE the queue. The reconciler retries anything `'error'` older than 5 min with exponential backoff (`max_retries: 5`, store `qboRetryCount` on the row). After 5 failures it stays `'error'` until the user retries. No separate queue table — keeps the system observable in the app.

### Settings UI — `app/qbo-setup.tsx`
- Mirrors `app/payments-setup.tsx` shape.
- **Disconnected:** "Connect QuickBooks" button (opens `qbo-connect-start` URL via `WebBrowser.openAuthSessionAsync`).
- **Connected:** company name + realm id (read-only) + environment (sandbox/production toggle for testing; gated to dev users), sync counts (✓ synced / ⌛ pending / ⚠ error totals across all objects), **"Sync now"** button, **"Errors" tray** (a list of objects in `qboSyncStatus='error'` with the error string + a per-row Retry), **"Disconnect"** (revokes refresh token via Intuit's revocation endpoint + deletes the row).
- Settings entry: a new row under the existing payments section pointing to `/qbo-setup`. Business+ tier (gated via `useTierAccess`).

---

## Object mapping

Every financial MAGE object gains these columns (one additive migration; nullable, default null):
```sql
alter table public.invoices       add column qbo_id text, add column qbo_hash text, add column qbo_synced_at timestamptz, add column qbo_sync_status text, add column qbo_error text, add column qbo_retry_count int default 0;
alter table public.aia_pay_apps   add column qbo_id text, add column qbo_hash text, add column qbo_synced_at timestamptz, add column qbo_sync_status text, add column qbo_error text, add column qbo_retry_count int default 0;
alter table public.change_orders  add column qbo_id text, add column qbo_hash text, add column qbo_synced_at timestamptz, add column qbo_sync_status text, add column qbo_error text, add column qbo_retry_count int default 0;
alter table public.commitments    add column qbo_id text, add column qbo_hash text, add column qbo_synced_at timestamptz, add column qbo_sync_status text, add column qbo_error text, add column qbo_retry_count int default 0;
alter table public.subcontractors add column qbo_vendor_id text, add column qbo_synced_at timestamptz;
alter table public.projects       add column qbo_customer_id text, add column qbo_synced_at timestamptz;
-- Estimate items live inside projects.linked_estimate jsonb; the qbo_item_id is stored in-blob per item.
```
Mirrored in TS types (additive, optional fields).

| MAGE | → | QBO V3 entity | Notes |
|---|---|---|---|
| `Project` | → | `Customer` | One per project. Display name = project name; bill addr from project location; `PrimaryEmailAddr` from `primaryContact.email` if present. |
| `LinkedEstimateItem.name` | → | `Item` | Created on first reference; `Type='Service'`; `IncomeAccountRef` = QBO's default "Services" account (looked up once per realm and cached on the connection). |
| `Subcontractor` | → | `Vendor` | One vendor per sub. |
| `Invoice` | → | `Invoice` | `CustomerRef` = project's `qbo_customer_id`; `Line[].SalesItemLineDetail.ItemRef` from each line's stored `qbo_item_id`; `Line[].Amount` per line. |
| `AIASavedPayApp` | → | `Invoice` | One QBO invoice per pay app; `Line[]` from G703 rows (`Description = "{trade} — % complete: {n}%"`, `Amount = this_period`); memo links back to the application number. |
| `ChangeOrder` (approved) | → | `Invoice` | **Separate CO invoice** (cleaner audit trail) per the design recommendation; description includes the CO number + reason. |
| `Commitment` | → | `Bill` | `VendorRef` = sub's `qbo_vendor_id`; `Line[]` from commitment line items; due date from commitment. |
| `Payment` (Stripe) | → | `Payment` | `CustomerRef` + `Line[].LinkedTxn` pointing at the QBO Invoice (`qbo_id`); `TotalAmt` = paid amount. |
| QBO `Payment` (paid in QBO) | → | `Payment` (read-back) | `qbo-reconciler` queries `Invoice` where `Balance = 0` + `MetaData.LastUpdatedTime > last_sync_at`; if MAGE has no `Payment` row for that invoice with `source='qbo'`, creates one. |

---

## Phased delivery — **one spec, one plan, four shippable phases**

Each phase is independently shippable (its own commit batch + OTA + edge-fn deploys + the migration ships with Phase 1). Phases gate-verify via `npx tsc --noEmit` + manual smoke against the Intuit sandbox.

### Phase 1 — Foundation + Core wedge (~2 weeks)
**What ships:** OAuth connect + `qbo_connections` table + `qbo-connect-start`/`callback`/`status` edge fns + Settings UI + the migration for all `qbo_*` columns + Customers + Invoices + Items + Payments sync + the reconciler (payments-back).

**Why first:** this is the answer to the buying objection. Once Phase 1 is live, a GC can connect QuickBooks and have invoices + payments flow without a manual export.

### Phase 2 — AP (~3–5 days)
**What ships:** `qbo-sync-vendor` + `qbo-sync-bill` workers; Subcontractor → Vendor; Commitment → Bill. Real-time push on commitment writes.

### Phase 3 — Construction billing detail (~3–5 days)
**What ships:** `qbo-sync-change-order` (separate CO invoice path) + `qbo-sync-aia-pay-app` (G703 line-level invoice). Real-time push on CO approval + AIA finalize.

### Phase 4 — Reconciler hardening + polish (~3 days)
**What ships:** exponential backoff with `qbo_retry_count`; the errors tray UI + per-row retry; sandbox/prod toggle exposed (currently dev-only); "Sync now" global button; disconnect flow with refresh-token revocation; rate-limit handling (HTTP 429 → respect `Retry-After`).

---

## Reliability + safety

- **Token rotation** — Intuit rotates refresh tokens on every refresh; `qbo-sync` always persists BOTH `access_token` and `refresh_token` after a refresh, atomically. A stale refresh token = `invalid_grant` → set `status='reauth_required'` and surface a banner in Settings → QuickBooks.
- **Rate limits** — QBO V3 caps ~500 req/min/realm (batch) and ~10 req/sec. Workers honor `Retry-After` from 429s; the reconciler paces itself.
- **Idempotency** — `qboHash` (stable-stringify of the synced-relevant subset + a version tag) prevents redundant pushes; presence of `qboId` triggers an update path (`/v3/.../{id}?operation=update`) instead of a create.
- **Partial failures** — each worker is atomic per MAGE object; one failed invoice doesn't block others. The errors tray shows what failed + why.
- **Sandbox/prod** — `qbo_environment` field on the connection routes API calls to the right base URL. Initial dev uses sandbox; flip to production for launch.
- **Secrets hygiene** — `access_token`/`refresh_token` never leave the server (no client-side reads via select; the client reads `qbo_connections` columns *except* the tokens via a view or column-level grants). Edge fns log statuses + error messages, never tokens.
- **Disconnect** — POST to Intuit's revocation endpoint (`https://developer.api.intuit.com/v2/oauth2/tokens/revoke`) with the refresh token, then delete the row. MAGE `qboId`s stay on the financial rows so a reconnect can re-link existing QBO records without dups.
- **Read-back integrity** — payments created from QBO read-back are marked `Payment.source='qbo'` to prevent feedback loops (don't push them back).

## OTA-safety

- **Client** (Settings UI, the `useQboSync` hook, types/mappings): pure JS → **OTA**.
- **Edge functions** (`qbo-connect-start/callback/status`, `qbo-sync`, `qbo-reconciler`, per-family workers): Deno → **`supabase functions deploy <name>`** per fn. No native modules.
- **Migration** — additive (new table + nullable columns on financial tables). Ships once at Phase 1 launch via `supabase migration up` (or the SQL MCP `apply_migration`). Backfill not required (all new columns nullable).
- **Cron registration** — `qbo-reconciler` registered via `pg_cron`-style schedule + the shared `cron_secret_guard` already in place (see prior cron work). 30-min interval.
- **No `expo.version` bump** — pure JS + edge fns, OTA-safe boundary preserved.

## Testing & gates

No unit runner (per CLAUDE.md). Per-task gate: `npx tsc --noEmit` clean + grep assertions for each worker's mapping; strict TS, no `any`. Manual smoke against the **Intuit sandbox** before flipping the connection to production:
- Connect → company name + realmId render in Settings.
- Create an invoice in MAGE → appears in QBO sandbox within ~10 s.
- Mark paid in QBO → reconciler creates a Payment in MAGE within ~30 min (or trigger manually).
- Approve a CO → separate QBO invoice posted.
- Finalize an AIA pay app → QBO invoice with G703 lines.
- Create a commitment → QBO Bill posted.
- Disconnect → `qbo_connections` row deleted, banner clears.

## File structure (high level)

- **New edge functions (5 deployments):** `qbo-connect-start/index.ts`, `qbo-connect-callback/index.ts`, `qbo-connect-status/index.ts`, `qbo-sync/index.ts` (a single router function), and `qbo-reconciler/index.ts`. The per-family **workers live as modules under** `supabase/functions/_shared/qbo-mapping/` — `customer.ts`, `invoice.ts`, `item.ts`, `payment.ts`, `vendor.ts`, `bill.ts`, `changeOrder.ts`, `aiaPayApp.ts` — each exporting a `pushUpsert(ctx, mageRow)` and `pushDelete(ctx, mageRow)`. The `qbo-sync` router imports the worker by `kind`. One deploy per function, fewer ops surfaces, modules are independently testable by virtue of being plain TS.
- **Shared edge module:** `supabase/functions/_shared/qbo.ts` — OAuth helpers (`refreshAccessToken`, `qboFetch`, base URL by env, error parsing, hashing).
- **New migrations (ship together at Phase 1):** `supabase/migrations/20260526120000_qbo_connections.sql` (table + RLS + owner-only policy) and `supabase/migrations/20260526120100_qbo_sync_columns.sql` (additive nullable `qbo_*` columns on `invoices`, `aia_pay_apps`, `change_orders`, `commitments`, `subcontractors`, `projects`).
- **New client util:** `utils/qboSync.ts` (the `useQboSync` hook + a `triggerSync(kind, op, objectId)` helper invoked from existing mutation paths).
- **New client screen:** `app/qbo-setup.tsx` (Settings → QuickBooks).
- **Modified:** `types/index.ts` (additive optional `qbo*` fields on the 6 financial interfaces + `QboConnection` interface), `app/(tabs)/settings/index.tsx` (new row → `/qbo-setup`), `contexts/ProjectContext.tsx` (call `triggerSync` from financial `add*`/`update*` paths), `utils/accountingExport.ts` (unchanged — kept as the Xero/Sage path).

## Definition of done — Phase 1

A GC on the **Business tier** can:
1. Tap Settings → **Connect QuickBooks** → complete the Intuit OAuth flow.
2. See their company name + sync status in Settings.
3. Create a customer (project), an invoice, and process a Stripe payment in MAGE → all three appear correctly in QBO within seconds.
4. Mark the QBO invoice paid manually → the matching MAGE invoice flips to paid within 30 min (or via "Sync now" instantly).
5. Disconnect cleanly with no orphaned tokens server-side.

Phases 2–4 extend coverage on top of this same foundation.
