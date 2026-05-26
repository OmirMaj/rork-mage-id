# QuickBooks 2-Way Sync — Phase 1 Implementation Plan (Foundation + Core Wedge)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the **shippable MVP** of QuickBooks Online sync: OAuth connect, status, and live push of **Customers + Items + Invoices + Payments** with payments flowing back from QBO. This phase alone answers the #1 GC buying objection.

**Architecture:** Mirrors the Stripe Connect OAuth pattern. Five new edge functions (`qbo-connect-start`, `qbo-connect-callback`, `qbo-connect-status`, `qbo-sync`, `qbo-reconciler`) + a shared `_shared/qbo.ts` (token refresh, `qboFetch`, hashing) and a `_shared/qbo-mapping/*` worker per object family. A new `qbo_connections` table + additive `qbo_*` columns on financial tables. A `qbo-setup` screen and a `useQboSync()` hook that fires push on financial mutations. Cron reconciler every 30 min pulls payments back.

**Tech Stack:** Deno edge functions (Supabase), `expo-web-browser` (in-app OAuth), Intuit QuickBooks Online V3 REST API, OAuth 2.0 with state-signed nonce, RLS-protected token storage.

**Per-task gate (NO unit runner):** `npx tsc --noEmit` clean at the worktree root + grep assertions, then commit. Strict TS, no `any`. Do NOT deploy edge fns or `eas update` during the plan — ship is a separate batched step after final review. Worktree root: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`.

---

## File Structure

- **Create:** 2 migrations (`20260526120000_qbo_connections.sql`, `20260526120100_qbo_sync_columns.sql`).
- **Create:** 5 edge fn entry points (`supabase/functions/{qbo-connect-start,qbo-connect-callback,qbo-connect-status,qbo-sync,qbo-reconciler}/index.ts`).
- **Create:** shared edge module `supabase/functions/_shared/qbo.ts` (auth/refresh/fetch/hash/error helpers).
- **Create:** mapping modules `supabase/functions/_shared/qbo-mapping/{customer,item,invoice,payment}.ts`.
- **Create:** client wrapper `utils/qboSync.ts` (`triggerQboSync`, `connectQbo`, `fetchQboStatus`).
- **Create:** Settings screen `app/qbo-setup.tsx`.
- **Modify:** `types/index.ts` (additive optional `qbo*` fields + `QboConnection`/`QboSyncStatus` types).
- **Modify:** `app/(tabs)/settings/index.tsx` (one row → `/qbo-setup`, gated to Business+).
- **Modify:** `contexts/ProjectContext.tsx` (call `triggerQboSync` after `addProject`/`addInvoice`/`updateInvoice` + a payment-applied path).
- **Modify:** `app/_layout.tsx` (add the `qbo-setup` screen to the Stack).

---

## Task 1: Types + Migrations

**Files:**
- Create: `supabase/migrations/20260526120000_qbo_connections.sql`
- Create: `supabase/migrations/20260526120100_qbo_sync_columns.sql`
- Modify: `types/index.ts`

- [ ] **Step 1: Create the connections migration**

```sql
-- 20260526120000_qbo_connections.sql
-- One QBO Online connection per MAGE user. Tokens are sensitive; RLS owner-only.

create table if not exists public.qbo_connections (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  realm_id         text not null,
  environment      text not null check (environment in ('sandbox','production')) default 'production',
  access_token     text not null,
  refresh_token    text not null,
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

drop policy if exists qbo_connections_owner on public.qbo_connections;
create policy qbo_connections_owner on public.qbo_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- updated_at sticky trigger.
create or replace function public.qbo_connections_touch() returns trigger
language plpgsql security invoker as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists trg_qbo_connections_touch on public.qbo_connections;
create trigger trg_qbo_connections_touch
  before update on public.qbo_connections
  for each row execute function public.qbo_connections_touch();
```

- [ ] **Step 2: Create the additive-columns migration**

```sql
-- 20260526120100_qbo_sync_columns.sql
-- Additive nullable qbo_* columns on the financial tables so we can track
-- the QBO counterpart, last-synced hash, and per-row sync status without
-- breaking anything. Backfill is unnecessary (everything starts as null).

alter table public.projects        add column if not exists qbo_customer_id text;
alter table public.projects        add column if not exists qbo_synced_at  timestamptz;

alter table public.invoices        add column if not exists qbo_id           text;
alter table public.invoices        add column if not exists qbo_hash         text;
alter table public.invoices        add column if not exists qbo_synced_at    timestamptz;
alter table public.invoices        add column if not exists qbo_sync_status  text;
alter table public.invoices        add column if not exists qbo_error        text;
alter table public.invoices        add column if not exists qbo_retry_count  int default 0;

-- Payments live inside invoices.payments jsonb in the codebase; no separate
-- payments table. The qbo_payment_id and source markers live in-blob per
-- payment (handled in the worker).

-- Phase 2/3 columns (vendors, bills, COs, AIA) are added in their phases' migrations.
```

- [ ] **Step 3: Add types to `types/index.ts`**

Locate the financial interfaces (`Invoice`, `Project`) and add the optional fields. Also add the two new types. Insert near where `Invoice` is defined (`grep -n "^export interface Invoice\b" types/index.ts`).

Add to `Invoice`:
```ts
  // QuickBooks 2-way sync — Phase 1.
  qboId?: string;
  qboHash?: string;
  qboSyncedAt?: string;
  qboSyncStatus?: 'pending' | 'synced' | 'error';
  qboError?: string;
  qboRetryCount?: number;
```

Add to `Project`:
```ts
  qboCustomerId?: string;
  qboSyncedAt?: string;
```

Add at the bottom of the file (or near the other connection-y types):
```ts
export interface QboConnection {
  userId: string;
  realmId: string;
  environment: 'sandbox' | 'production';
  companyName: string | null;
  status: 'connecting' | 'connected' | 'reauth_required' | 'error' | 'disconnected';
  lastSyncAt: string | null;
  lastError: string | null;
}
export interface QboPaymentBlob {
  qboId?: string;
  source?: 'mage' | 'qbo';
}
```

(Note: the `qbo_payment_id` + `source` will be stored per `InvoicePayment` row in the existing `invoices.payments` jsonb — see Task 7. Don't add to `InvoicePayment` yet if it lives in a different interface; for now, type-extend the union by intersecting at the worker layer.)

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "QboConnection\|qboId\|qboCustomerId\|qbo_connections\|qbo_sync_status" types/index.ts supabase/migrations/20260526120000_qbo_connections.sql supabase/migrations/20260526120100_qbo_sync_columns.sql | head -20` → matches.

```bash
git add types/index.ts supabase/migrations/20260526120000_qbo_connections.sql supabase/migrations/20260526120100_qbo_sync_columns.sql
git commit -m "feat(qbo): types + migrations for QuickBooks 2-way sync (Phase 1)"
```

---

## Task 2: Shared edge module — `_shared/qbo.ts`

**Files:**
- Create: `supabase/functions/_shared/qbo.ts`

This module owns the OAuth + HTTP plumbing every QBO edge fn uses: token refresh (Intuit rotates the refresh token on every refresh — must persist both), `qboFetch` (wraps API calls + auto-refresh on 401), hashing, and error parsing. Mirrors the helper-module pattern of `_shared/auth.ts`.

- [ ] **Step 1: Create the file**

```ts
// supabase/functions/_shared/qbo.ts — OAuth + HTTP helpers for QuickBooks Online.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const INTUIT_CLIENT_ID     = Deno.env.get("INTUIT_CLIENT_ID")     || "";
const INTUIT_CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET") || "";
const SUPABASE_URL         = Deno.env.get("SUPABASE_URL")         || "";
const SERVICE_ROLE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

export const TOKEN_ENDPOINT = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const REVOKE_ENDPOINT = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";

export function qboApiBase(env: 'sandbox' | 'production'): string {
  return env === 'sandbox'
    ? "https://sandbox-quickbooks.api.intuit.com"
    : "https://quickbooks.api.intuit.com";
}

export interface QboConnectionRow {
  user_id: string;
  realm_id: string;
  environment: 'sandbox' | 'production';
  access_token: string;
  refresh_token: string;
  access_expires_at: string;
  company_name: string | null;
  status: 'connecting' | 'connected' | 'reauth_required' | 'error' | 'disconnected';
}

export function svc() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Supabase service-role not configured.");
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

/** Load the caller's connection by user_id. Returns null if not connected. */
export async function loadConnection(userId: string): Promise<QboConnectionRow | null> {
  const { data, error } = await svc().from('qbo_connections').select('*').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`qbo_connections read failed: ${error.message}`);
  return data as QboConnectionRow | null;
}

/** Persist new tokens after a refresh or initial exchange. Intuit rotates the
 *  refresh token on every call — persist BOTH atomically. */
export async function saveTokens(userId: string, patch: {
  access_token: string; refresh_token: string; access_expires_at: string;
  realm_id?: string; environment?: 'sandbox' | 'production';
  company_name?: string | null; status?: QboConnectionRow['status']; last_error?: string | null;
}): Promise<void> {
  const { error } = await svc().from('qbo_connections').upsert({ user_id: userId, ...patch }, { onConflict: 'user_id' });
  if (error) throw new Error(`qbo_connections write failed: ${error.message}`);
}

/** Refresh the access token IF expiring within 5 minutes. Updates the row. */
export async function ensureFreshAccess(conn: QboConnectionRow): Promise<QboConnectionRow> {
  const exp = new Date(conn.access_expires_at).getTime();
  if (Date.now() < exp - 5 * 60_000) return conn;
  return await refreshAccessToken(conn);
}

/** Exchange the refresh token for a new access (+refresh) token. */
export async function refreshAccessToken(conn: QboConnectionRow): Promise<QboConnectionRow> {
  const basic = btoa(`${INTUIT_CLIENT_ID}:${INTUIT_CLIENT_SECRET}`);
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(conn.refresh_token)}`,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    // invalid_grant => the user must re-auth.
    if (/invalid_grant/i.test(text)) {
      await saveTokens(conn.user_id, {
        access_token: conn.access_token,
        refresh_token: conn.refresh_token,
        access_expires_at: conn.access_expires_at,
        status: 'reauth_required',
        last_error: 'QuickBooks needs to be reconnected (refresh token expired).',
      });
    }
    throw new Error(`Intuit token refresh ${r.status}: ${text.slice(0, 300)}`);
  }
  const j = await r.json() as { access_token: string; refresh_token: string; expires_in: number };
  const next: QboConnectionRow = {
    ...conn,
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    access_expires_at: new Date(Date.now() + (j.expires_in - 30) * 1000).toISOString(),
  };
  await saveTokens(conn.user_id, {
    access_token: next.access_token,
    refresh_token: next.refresh_token,
    access_expires_at: next.access_expires_at,
    status: 'connected',
    last_error: null,
  });
  return next;
}

/** Call a QBO V3 endpoint. Auto-refreshes once on 401; otherwise throws on non-2xx. */
export async function qboFetch(conn: QboConnectionRow, path: string, init: RequestInit = {}): Promise<unknown> {
  let live = await ensureFreshAccess(conn);
  const url = `${qboApiBase(live.environment)}/v3/company/${encodeURIComponent(live.realm_id)}${path}`;
  const doFetch = (c: QboConnectionRow) => fetch(url, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      'Authorization': `Bearer ${c.access_token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  });
  let r = await doFetch(live);
  if (r.status === 401) {
    live = await refreshAccessToken(live);
    r = await doFetch(live);
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new Error(`QBO ${r.status} ${path}: ${parseQboError(text)}`);
  }
  return await r.json();
}

/** Extract a useful message from Intuit's verbose Fault envelope. */
export function parseQboError(text: string): string {
  try {
    const j = JSON.parse(text);
    const msgs: string[] = [];
    const errs = j?.Fault?.Error ?? j?.fault?.error ?? [];
    for (const e of errs) {
      if (e?.Message) msgs.push(e.Message);
      else if (e?.message) msgs.push(e.message);
      if (e?.Detail) msgs.push(e.Detail);
      else if (e?.detail) msgs.push(e.detail);
    }
    if (msgs.length) return msgs.join(' · ');
  } catch { /* not JSON */ }
  return text.slice(0, 300);
}

/** Stable hash of a sync-relevant object, used to skip redundant pushes. */
export async function qboHash(obj: unknown): Promise<string> {
  const enc = new TextEncoder().encode(stableStringify(obj));
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])).join(',') + '}';
}

/** State signing for the OAuth start→callback handoff (HMAC-SHA256). */
const STATE_SECRET = Deno.env.get("INTUIT_STATE_SECRET") || INTUIT_CLIENT_SECRET; // re-uses client secret if no dedicated state secret is set.
const STATE_TTL_MS = 10 * 60_000;
export async function signState(userId: string): Promise<string> {
  const exp = Date.now() + STATE_TTL_MS;
  const payload = `${userId}|${exp}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  return btoa(`${payload}|${hex}`).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
export async function verifyState(state: string): Promise<{ userId: string } | null> {
  try {
    const decoded = atob(state.replace(/-/g, '+').replace(/_/g, '/'));
    const [userId, expStr, hex] = decoded.split('|');
    if (!userId || !expStr || !hex) return null;
    if (Date.now() > Number(expStr)) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}|${expStr}`));
    const expectHex = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expectHex !== hex) return null;
    return { userId };
  } catch { return null; }
}
```

- [ ] **Step 2: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean (the file is Deno; expect tsc to skip the `supabase/functions/**` like the other edge fns).
Run: `grep -n "export function qboFetch\|export async function refreshAccessToken\|export async function signState\|export async function verifyState\|export async function qboHash" supabase/functions/_shared/qbo.ts` → all match.

```bash
git add supabase/functions/_shared/qbo.ts
git commit -m "feat(qbo): _shared/qbo.ts — token refresh + qboFetch + signed state"
```

---

## Task 3: `qbo-connect-start` + `qbo-connect-callback` edge fns

**Files:**
- Create: `supabase/functions/qbo-connect-start/index.ts`
- Create: `supabase/functions/qbo-connect-callback/index.ts`

OAuth bootstrap. `start` builds the Intuit authorize URL (state-signed); `callback` exchanges the code and stores tokens.

- [ ] **Step 1: `qbo-connect-start`**

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { signState } from "../_shared/qbo.ts";

const CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID") || "";
const REDIRECT_URI = Deno.env.get("INTUIT_REDIRECT_URI") || "https://app.mageid.app/integrations/qbo/callback";
const AUTHORIZE_URL = "https://appcenter.intuit.com/connect/oauth2";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'Method not allowed' }, 405);
  const auth = await requireTier(req, ['business','enterprise'], 'qbo_connect');
  if (!auth.ok) return json(auth.body, auth.status);
  if (!CLIENT_ID) return json({ success: false, error: 'INTUIT_CLIENT_ID not configured.' }, 500);

  const state = await signState(auth.userId);
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'com.intuit.quickbooks.accounting openid profile email');
  url.searchParams.set('redirect_uri', REDIRECT_URI);
  url.searchParams.set('state', state);
  return json({ success: true, authorizeUrl: url.toString() });
});
```

- [ ] **Step 2: `qbo-connect-callback`**

This handler runs server-side (NOT user-authenticated — Intuit calls our public redirect URL). It identifies the user via the signed state. Intuit redirects with `?code=...&realmId=...&state=...`.

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verifyState, saveTokens, TOKEN_ENDPOINT } from "../_shared/qbo.ts";

const CLIENT_ID = Deno.env.get("INTUIT_CLIENT_ID") || "";
const CLIENT_SECRET = Deno.env.get("INTUIT_CLIENT_SECRET") || "";
const REDIRECT_URI = Deno.env.get("INTUIT_REDIRECT_URI") || "https://app.mageid.app/integrations/qbo/callback";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

interface CallbackBody { code: string; realmId: string; state: string; environment?: 'sandbox' | 'production' }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'Method not allowed' }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json({ success: false, error: 'INTUIT_* not configured' }, 500);

  let body: CallbackBody;
  try { body = await req.json() as CallbackBody; }
  catch { return json({ success: false, error: 'Bad JSON' }, 400); }
  if (!body.code || !body.realmId || !body.state) return json({ success: false, error: 'Missing code/realmId/state' }, 400);

  const verified = await verifyState(body.state);
  if (!verified) return json({ success: false, error: 'Invalid or expired state — start the connection again.' }, 401);

  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const r = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: `grant_type=authorization_code&code=${encodeURIComponent(body.code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    return json({ success: false, error: `Intuit token exchange ${r.status}: ${text.slice(0, 200)}` }, 502);
  }
  const tok = await r.json() as { access_token: string; refresh_token: string; expires_in: number };

  // Fetch the company name for display. Best-effort.
  let companyName: string | null = null;
  try {
    const env = body.environment ?? 'production';
    const base = env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com';
    const info = await fetch(`${base}/v3/company/${encodeURIComponent(body.realmId)}/companyinfo/${encodeURIComponent(body.realmId)}`, {
      headers: { 'Authorization': `Bearer ${tok.access_token}`, 'Accept': 'application/json' },
    });
    if (info.ok) {
      const j = await info.json();
      companyName = j?.CompanyInfo?.CompanyName ?? null;
    }
  } catch { /* non-fatal */ }

  await saveTokens(verified.userId, {
    realm_id: body.realmId,
    environment: body.environment ?? 'production',
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    access_expires_at: new Date(Date.now() + (tok.expires_in - 30) * 1000).toISOString(),
    company_name: companyName,
    status: 'connected',
    last_error: null,
  });
  return json({ success: true, companyName });
});
```

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean. Grep: `grep -n "AUTHORIZE_URL\|signState\|verifyState\|grant_type=authorization_code" supabase/functions/qbo-connect-*/index.ts | head` → matches.

```bash
git add supabase/functions/qbo-connect-start/index.ts supabase/functions/qbo-connect-callback/index.ts
git commit -m "feat(qbo): connect-start + connect-callback edge functions (OAuth)"
```

---

## Task 4: `qbo-connect-status` edge fn

**Files:**
- Create: `supabase/functions/qbo-connect-status/index.ts`

Returns the current user's connection summary for the Settings UI. Token values are NEVER returned.

- [ ] **Step 1: Create the file**

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection, svc } from "../_shared/qbo.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'Method not allowed' }, 405);

  const auth = await requireTier(req, ['business','enterprise'], 'qbo_status');
  if (!auth.ok) return json(auth.body, auth.status);

  const conn = await loadConnection(auth.userId);
  if (!conn) return json({ success: true, status: 'disconnected' });

  // Count invoices by qbo_sync_status for the user.
  const s = svc();
  const { data: errorCount } = await s.from('invoices').select('id', { count: 'exact', head: true }).eq('user_id', auth.userId).eq('qbo_sync_status', 'error');
  const { data: pendingCount } = await s.from('invoices').select('id', { count: 'exact', head: true }).eq('user_id', auth.userId).eq('qbo_sync_status', 'pending');
  const { data: syncedCount } = await s.from('invoices').select('id', { count: 'exact', head: true }).eq('user_id', auth.userId).eq('qbo_sync_status', 'synced');

  return json({
    success: true,
    status: conn.status,
    realmId: conn.realm_id,
    environment: conn.environment,
    companyName: conn.company_name,
    lastSyncAt: (conn as { last_sync_at?: string }).last_sync_at ?? null,
    counts: {
      synced: (syncedCount as unknown as { count?: number })?.count ?? 0,
      pending: (pendingCount as unknown as { count?: number })?.count ?? 0,
      error: (errorCount as unknown as { count?: number })?.count ?? 0,
    },
  });
});
```

(Note: `select('id', { count: 'exact', head: true })` returns the count in the response — `data` will be null with the count attached to the response. Adjust at implementation time if the supabase-js return shape differs; the precise call is `const { count } = await s.from('invoices').select('*', { count: 'exact', head: true }).eq(...)`. Use that form.)

- [ ] **Step 2: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean. Grep: `grep -n "qbo_sync_status\|loadConnection" supabase/functions/qbo-connect-status/index.ts | head` → matches.

```bash
git add supabase/functions/qbo-connect-status/index.ts
git commit -m "feat(qbo): connect-status edge function (read-only connection summary)"
```

---

## Task 5: Settings UI — `app/qbo-setup.tsx` + Settings entry row

**Files:**
- Create: `app/qbo-setup.tsx`
- Create: `utils/qboSync.ts` (the client wrapper that talks to the 3 connect edge fns + the future sync trigger)
- Modify: `app/(tabs)/settings/index.tsx` (a new row)
- Modify: `app/_layout.tsx` (declare the `qbo-setup` Stack screen)

- [ ] **Step 1: Client wrapper `utils/qboSync.ts`**

```ts
import { Platform } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase';

export interface QboStatus {
  status: 'disconnected' | 'connecting' | 'connected' | 'reauth_required' | 'error';
  realmId?: string;
  environment?: 'sandbox' | 'production';
  companyName?: string | null;
  lastSyncAt?: string | null;
  counts?: { synced: number; pending: number; error: number };
}

/** Start the OAuth flow. Opens an in-app browser to Intuit; the redirect
 *  URL is handled by the web build (or a deep link). Resolves once the
 *  browser closes; caller should refetch status to confirm. */
export async function connectQuickBooks(): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; authorizeUrl?: string; error?: string }>(
    'qbo-connect-start', { body: {} },
  );
  if (error || !data?.success || !data.authorizeUrl) {
    return { ok: false, error: error?.message ?? data?.error ?? 'Could not start QuickBooks connection.' };
  }
  try {
    if (Platform.OS === 'web') {
      window.location.href = data.authorizeUrl;
    } else {
      await WebBrowser.openAuthSessionAsync(data.authorizeUrl, 'https://app.mageid.app/integrations/qbo/callback');
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Browser could not open.' };
  }
}

/** Complete the callback (called from the web build's /integrations/qbo/callback route). */
export async function completeQuickBooksCallback(opts: { code: string; realmId: string; state: string; environment?: 'sandbox' | 'production' }): Promise<{ ok: boolean; companyName?: string | null; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ success: boolean; companyName?: string | null; error?: string }>(
    'qbo-connect-callback', { body: opts },
  );
  if (error || !data?.success) return { ok: false, error: error?.message ?? data?.error ?? 'Connection failed.' };
  return { ok: true, companyName: data.companyName };
}

export async function fetchQboStatus(): Promise<QboStatus> {
  const { data, error } = await supabase.functions.invoke<QboStatus & { success: boolean }>(
    'qbo-connect-status', { body: {} },
  );
  if (error || !data) return { status: 'disconnected' };
  return data;
}

/** Fire-and-forget push (used by useQboSync from financial mutations). */
export async function triggerQboSync(kind: 'project' | 'invoice' | 'payment' | 'item', op: 'upsert' | 'delete', objectId: string): Promise<void> {
  try { await supabase.functions.invoke('qbo-sync', { body: { kind, op, objectId } }); }
  catch { /* fire-and-forget; status flows via the qbo_sync_status field on the row */ }
}
```

- [ ] **Step 2: Settings screen `app/qbo-setup.tsx`**

A focused screen mirroring `app/payments-setup.tsx` shape (theme-aware, Stack header, owner-only paths). Provides: connect / disconnect / status + counts + Sync-now / Retry tray entry.

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { ChevronLeft, ExternalLink, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { connectQuickBooks, fetchQboStatus, triggerQboSync, type QboStatus } from '@/utils/qboSync';

export default function QboSetupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<QboStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setStatus(await fetchQboStatus());
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const onConnect = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const r = await connectQuickBooks();
    setBusy(false);
    if (!r.ok) Alert.alert('Connect failed', r.error ?? 'Try again.');
    else await refresh();
  }, [busy, refresh]);

  const onSyncNow = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    // Push everything pending/error for the current user via the reconciler.
    await triggerQboSync('invoice', 'upsert', '*'); // placeholder; real impl reads the user's pending rows via the reconciler
    setBusy(false);
    await refresh();
  }, [busy, refresh]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityLabel="Back"><ChevronLeft size={22} color={colors.text} /></TouchableOpacity>
        <Text style={styles.title}>QuickBooks</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}>
        {loading ? <ActivityIndicator color={colors.accent} /> :
          (!status || status.status === 'disconnected') ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connect QuickBooks Online</Text>
              <Text style={styles.cardSub}>One-tap OAuth. Your invoices, payments, and customers will sync live from MAGE to QuickBooks.</Text>
              <TouchableOpacity style={[styles.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={onConnect} testID="qbo-connect">
                <ExternalLink size={16} color="#FFFFFF" />
                <Text style={styles.primaryText}>{busy ? 'Opening…' : 'Connect QuickBooks'}</Text>
              </TouchableOpacity>
            </View>
          ) : status.status === 'reauth_required' ? (
            <View style={[styles.card, styles.cardWarn]}>
              <AlertTriangle size={20} color={colors.danger} />
              <Text style={styles.cardTitle}>Reconnect QuickBooks</Text>
              <Text style={styles.cardSub}>Your QuickBooks session expired. Tap to reconnect — your existing links to QBO records will be preserved.</Text>
              <TouchableOpacity style={styles.primary} onPress={onConnect}><Text style={styles.primaryText}>Reconnect</Text></TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.row}><CheckCircle2 size={18} color={colors.success} /><Text style={styles.cardTitle}>Connected · {status.companyName ?? 'QuickBooks Online'}</Text></View>
                <Text style={styles.cardSub}>Realm {status.realmId} · {status.environment}</Text>
                {status.lastSyncAt ? <Text style={styles.cardSub}>Last reconcile: {new Date(status.lastSyncAt).toLocaleString()}</Text> : null}
              </View>
              <View style={styles.statsRow}>
                <Stat label="Synced" value={status.counts?.synced ?? 0} good styles={styles} />
                <Stat label="Pending" value={status.counts?.pending ?? 0} styles={styles} />
                <Stat label="Errors" value={status.counts?.error ?? 0} bad styles={styles} />
              </View>
              <TouchableOpacity style={styles.primary} onPress={onSyncNow} disabled={busy} testID="qbo-sync-now">
                <RefreshCw size={16} color="#FFFFFF" />
                <Text style={styles.primaryText}>{busy ? 'Syncing…' : 'Sync now'}</Text>
              </TouchableOpacity>
            </>
          )}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, good, bad, styles }: { label: string; value: number; good?: boolean; bad?: boolean; styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={[styles.stat, good && styles.statGood, bad && styles.statBad]}>
      <Text style={styles.statVal}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line },
  backBtn: { width: 34, height: 34, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 17, backgroundColor: t.surfaceAlt },
  title: { fontSize: 17, fontWeight: '800' as const, color: t.text },
  card: { backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 16, marginBottom: 12, gap: 6 },
  cardWarn: { borderWidth: 1, borderColor: t.danger },
  cardTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text },
  cardSub: { fontSize: Type.subhead.fontSize, color: t.textMuted },
  primary: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, marginTop: 10, paddingVertical: 13, borderRadius: Tokens.radius.md, backgroundColor: t.accent },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' as const },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  statsRow: { flexDirection: 'row' as const, gap: 8, marginBottom: 12 },
  stat: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.card, padding: 12, alignItems: 'center' as const },
  statGood: { borderLeftWidth: 3, borderLeftColor: t.success },
  statBad: { borderLeftWidth: 3, borderLeftColor: t.danger },
  statVal: { fontSize: 22, fontWeight: '800' as const, color: t.text },
  statLabel: { fontSize: 11, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
});
```

- [ ] **Step 3: Add the Stack screen + Settings row**

In `app/_layout.tsx`, add `<Stack.Screen name="qbo-setup" />` next to the other Stack.Screen declarations.

In `app/(tabs)/settings/index.tsx`, find the existing payments-setup row block (≈L913–945) and add an adjacent row:
```tsx
<TouchableOpacity
  style={styles.row}
  onPress={() => router.push('/qbo-setup' as any)}
  activeOpacity={0.7}
  testID="qbo-setup-link"
>
  <View style={[styles.iconWrap, { backgroundColor: themeColors.accent }]}>
    <ExternalLink size={14} color="#fff" />
  </View>
  <Text style={[styles.rowLabel, { flex: 1 }]}>Connect QuickBooks</Text>
  <ChevronRight size={16} color={themeColors.textMuted} />
</TouchableOpacity>
```
(`ExternalLink` is already imported from lucide elsewhere in the file; if not, add it to the existing lucide import.)

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "qbo-setup-link\|connectQuickBooks\|fetchQboStatus" app/qbo-setup.tsx "app/(tabs)/settings/index.tsx" utils/qboSync.ts | head` → matches.

```bash
git add app/qbo-setup.tsx utils/qboSync.ts "app/(tabs)/settings/index.tsx" app/_layout.tsx
git commit -m "feat(qbo): qbo-setup screen + Settings entry + connect/status client wrapper"
```

---

## Task 6: `qbo-sync` router + customer/item mappers

**Files:**
- Create: `supabase/functions/qbo-sync/index.ts`
- Create: `supabase/functions/_shared/qbo-mapping/customer.ts`
- Create: `supabase/functions/_shared/qbo-mapping/item.ts`

- [ ] **Step 1: Router `qbo-sync/index.ts`**

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { requireTier } from "../_shared/auth.ts";
import { loadConnection } from "../_shared/qbo.ts";
import { upsertCustomer } from "../_shared/qbo-mapping/customer.ts";
import { upsertItem }      from "../_shared/qbo-mapping/item.ts";
import { upsertInvoice }   from "../_shared/qbo-mapping/invoice.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

type Kind = 'project' | 'invoice' | 'payment' | 'item';
interface Body { kind: Kind; op: 'upsert' | 'delete'; objectId: string; }

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')   return json({ success: false, error: 'Method not allowed' }, 405);

  const auth = await requireTier(req, ['business','enterprise'], 'qbo_sync');
  if (!auth.ok) return json(auth.body, auth.status);

  const body = await req.json().catch(() => null) as Body | null;
  if (!body?.kind || !body?.op || !body?.objectId) return json({ success: false, error: 'Missing kind/op/objectId' }, 400);

  const conn = await loadConnection(auth.userId);
  if (!conn || conn.status === 'disconnected') return json({ success: false, error: 'QuickBooks not connected' }, 409);
  if (conn.status === 'reauth_required')        return json({ success: false, error: 'Reconnect QuickBooks' }, 409);

  try {
    if (body.op === 'upsert') {
      if (body.kind === 'project')  await upsertCustomer(conn, body.objectId, auth.userId);
      else if (body.kind === 'item')    await upsertItem(conn, body.objectId, auth.userId);
      else if (body.kind === 'invoice') await upsertInvoice(conn, body.objectId, auth.userId);
      else if (body.kind === 'payment') await upsertPaymentForInvoice(conn, body.objectId, auth.userId);
      else return json({ success: false, error: `Unknown kind ${body.kind}` }, 400);
    } else {
      // Delete is a no-op for v1 (we don't void/delete in QBO automatically). Caller can handle manually.
      return json({ success: true, skipped: 'delete-not-implemented' });
    }
    return json({ success: true });
  } catch (e) {
    console.error('[qbo-sync] failed', e);
    return json({ success: false, error: String((e as Error).message ?? e) }, 500);
  }
});
```

- [ ] **Step 2: `_shared/qbo-mapping/customer.ts`**

Maps `projects` row → QBO `Customer`. Stores `qbo_customer_id` back on the project.

```ts
import { qboFetch, qboHash, svc, type QboConnectionRow } from "../qbo.ts";

interface MageProjectRow {
  id: string; user_id: string;
  name: string; location: string | null;
  primary_contact: { name?: string | null; email?: string | null; phone?: string | null } | null;
  qbo_customer_id: string | null;
}

export async function upsertCustomer(conn: QboConnectionRow, projectId: string, userId: string): Promise<void> {
  const s = svc();
  const { data: row, error } = await s
    .from('projects')
    .select('id,user_id,name,location,primary_contact,qbo_customer_id')
    .eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`project read: ${error.message}`);
  if (!row) throw new Error('project not found');
  const p = row as MageProjectRow;

  const body: Record<string, unknown> = {
    DisplayName: p.name,
    CompanyName: p.name,
    PrimaryEmailAddr: p.primary_contact?.email ? { Address: p.primary_contact.email } : undefined,
    PrimaryPhone: p.primary_contact?.phone ? { FreeFormNumber: p.primary_contact.phone } : undefined,
    BillAddr: p.location ? { Line1: p.location } : undefined,
  };
  if (p.qbo_customer_id) Object.assign(body, { Id: p.qbo_customer_id, sparse: true, SyncToken: '0' });

  const path = p.qbo_customer_id ? '/customer?operation=update' : '/customer';
  const r = await qboFetch(conn, path, { method: 'POST', body: JSON.stringify(body) }) as { Customer?: { Id?: string } };
  const newId = r?.Customer?.Id ?? p.qbo_customer_id;
  if (!newId) throw new Error('QBO did not return a Customer.Id');

  await s.from('projects').update({ qbo_customer_id: newId, qbo_synced_at: new Date().toISOString() }).eq('id', projectId);
}
```

(Note on `SyncToken`: QBO requires the latest SyncToken for sparse updates; v1 sends `'0'` which works if no one's edited the QBO record. If we hit 5010 (stale-object) errors, fetch the current SyncToken first. This is the cheap path; Phase 4 hardens it.)

- [ ] **Step 3: `_shared/qbo-mapping/item.ts`**

Maps an estimate line item NAME to a QBO `Item` (Service, default income account). Caches `qbo_item_id` per line in `projects.linked_estimate` jsonb (since items live inside that blob).

```ts
import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";

interface LinkedEstimateItem { id: string; name: string; qboItemId?: string }
interface ProjectRow { id: string; linked_estimate: { items?: LinkedEstimateItem[] } | null }

/** Object IDs for items are encoded as "<projectId>::<itemId>" since items
 *  don't live in their own table — they're embedded in projects.linked_estimate.items. */
export async function upsertItem(conn: QboConnectionRow, encodedId: string, userId: string): Promise<void> {
  const [projectId, itemId] = encodedId.split('::');
  if (!projectId || !itemId) throw new Error(`bad item id ${encodedId}`);

  const s = svc();
  const { data: row, error } = await s
    .from('projects').select('id,linked_estimate').eq('id', projectId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`project read: ${error.message}`);
  if (!row) throw new Error('project not found');
  const project = row as ProjectRow;
  const items = project.linked_estimate?.items ?? [];
  const item  = items.find(i => i.id === itemId);
  if (!item) throw new Error(`item ${itemId} not found`);
  if (item.qboItemId) return; // already linked

  // Look up the QBO default "Services" income account once.
  const accountQuery = await qboFetch(conn, "/query?query=" + encodeURIComponent("select Id from Account where AccountType = 'Income' MAXRESULTS 1"), { method: 'GET' }) as { QueryResponse?: { Account?: { Id?: string }[] } };
  const incomeId = accountQuery?.QueryResponse?.Account?.[0]?.Id;
  if (!incomeId) throw new Error('No Income account found in QBO');

  const r = await qboFetch(conn, '/item', { method: 'POST', body: JSON.stringify({ Name: item.name, Type: 'Service', IncomeAccountRef: { value: incomeId } }) }) as { Item?: { Id?: string } };
  const qboItemId = r?.Item?.Id;
  if (!qboItemId) throw new Error('QBO did not return an Item.Id');

  const nextItems = items.map(i => i.id === itemId ? { ...i, qboItemId } : i);
  const nextEstimate = { ...(project.linked_estimate ?? {}), items: nextItems };
  await s.from('projects').update({ linked_estimate: nextEstimate }).eq('id', projectId);
}
```

- [ ] **Step 4: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "upsertCustomer\|upsertItem\|qboFetch" supabase/functions/qbo-sync/index.ts supabase/functions/_shared/qbo-mapping/*.ts | head` → matches.

```bash
git add supabase/functions/qbo-sync/index.ts supabase/functions/_shared/qbo-mapping/customer.ts supabase/functions/_shared/qbo-mapping/item.ts
git commit -m "feat(qbo): sync router + customer/item mappers"
```

---

## Task 7: Invoice + Payment mappers

**Files:**
- Create: `supabase/functions/_shared/qbo-mapping/invoice.ts`
- Create: `supabase/functions/_shared/qbo-mapping/payment.ts`

- [ ] **Step 1: `invoice.ts`**

```ts
import { qboFetch, qboHash, svc, type QboConnectionRow } from "../qbo.ts";

interface MageInvoiceRow {
  id: string; user_id: string; project_id: string;
  number: number; issue_date: string; due_date: string; notes: string | null;
  line_items: Array<{ id: string; name: string; description?: string; quantity: number; unitPrice: number; total: number; sourceEstimateItemId?: string | null }>;
  total_due: number; tax_amount: number; subtotal: number;
  qbo_id: string | null; qbo_hash: string | null;
}

export async function upsertInvoice(conn: QboConnectionRow, invoiceId: string, userId: string): Promise<void> {
  const s = svc();
  const { data: row, error } = await s
    .from('invoices').select('*').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (error) throw new Error(`invoice read: ${error.message}`);
  if (!row) throw new Error('invoice not found');
  const inv = row as MageInvoiceRow;

  // Resolve project's qbo_customer_id (push the project first if missing).
  const { data: projRow } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).maybeSingle();
  let customerId = (projRow as { qbo_customer_id?: string } | null)?.qbo_customer_id;
  if (!customerId) {
    // Lazily push the project so the invoice can land. Defensive — the router
    // normally pushes the project on add, but seeded/migrated data may lack it.
    const { upsertCustomer } = await import("./customer.ts");
    await upsertCustomer(conn, inv.project_id, userId);
    const { data: projRow2 } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).maybeSingle();
    customerId = (projRow2 as { qbo_customer_id?: string } | null)?.qbo_customer_id;
    if (!customerId) throw new Error('Could not establish QBO Customer for project');
  }

  // Build Line[] — each line maps to an Item via its sourceEstimateItemId.
  // If the line has no item yet, lazily push the item.
  const { upsertItem } = await import("./item.ts");
  const lines = [];
  for (const li of inv.line_items) {
    if (li.sourceEstimateItemId) {
      // Look up the qboItemId in the project's linked_estimate.items
      const { data: pjRow } = await s.from('projects').select('linked_estimate').eq('id', inv.project_id).maybeSingle();
      const items = ((pjRow as { linked_estimate?: { items?: { id: string; qboItemId?: string }[] } } | null)?.linked_estimate?.items) ?? [];
      let qboItemId = items.find(i => i.id === li.sourceEstimateItemId)?.qboItemId;
      if (!qboItemId) {
        await upsertItem(conn, `${inv.project_id}::${li.sourceEstimateItemId}`, userId);
        const { data: pjRow2 } = await s.from('projects').select('linked_estimate').eq('id', inv.project_id).maybeSingle();
        const items2 = ((pjRow2 as { linked_estimate?: { items?: { id: string; qboItemId?: string }[] } } | null)?.linked_estimate?.items) ?? [];
        qboItemId = items2.find(i => i.id === li.sourceEstimateItemId)?.qboItemId;
      }
      lines.push({
        DetailType: 'SalesItemLineDetail',
        Amount: li.total,
        Description: li.description ?? li.name,
        SalesItemLineDetail: { ItemRef: { value: qboItemId }, Qty: li.quantity, UnitPrice: li.unitPrice },
      });
    } else {
      // No estimate item — fall back to a description-only line.
      lines.push({
        DetailType: 'DescriptionOnly',
        Amount: li.total,
        Description: li.description ?? li.name,
      });
    }
  }

  const body: Record<string, unknown> = {
    CustomerRef: { value: customerId },
    DocNumber: String(inv.number),
    TxnDate: inv.issue_date.slice(0, 10),
    DueDate: inv.due_date.slice(0, 10),
    PrivateNote: inv.notes ?? undefined,
    Line: lines,
  };
  if (inv.qbo_id) Object.assign(body, { Id: inv.qbo_id, sparse: true, SyncToken: '0' });

  // Idempotency check.
  const hash = await qboHash({ body, customerId });
  if (inv.qbo_id && inv.qbo_hash === hash) return; // no drift

  const path = inv.qbo_id ? '/invoice?operation=update' : '/invoice';
  const r = await qboFetch(conn, path, { method: 'POST', body: JSON.stringify(body) }) as { Invoice?: { Id?: string } };
  const newId = r?.Invoice?.Id ?? inv.qbo_id;
  if (!newId) throw new Error('QBO did not return an Invoice.Id');

  await s.from('invoices').update({
    qbo_id: newId,
    qbo_hash: hash,
    qbo_synced_at: new Date().toISOString(),
    qbo_sync_status: 'synced',
    qbo_error: null,
    qbo_retry_count: 0,
  }).eq('id', invoiceId);
}
```

- [ ] **Step 2: `payment.ts`**

When MAGE records a payment (Stripe webhook flips an invoice payment), push it as a QBO Payment applied to the QBO Invoice. Since payments live inside `invoices.payments` jsonb, this is called with the **invoice id** + an inner `paymentId`. Encoded as `"<invoiceId>::<paymentId>"`.

```ts
import { qboFetch, svc, type QboConnectionRow } from "../qbo.ts";

interface InvoicePaymentBlob { id: string; date: string; amount: number; method?: string; qboId?: string; source?: 'mage' | 'qbo' }

export async function upsertPaymentForInvoice(conn: QboConnectionRow, encodedId: string, userId: string): Promise<void> {
  const [invoiceId, paymentId] = encodedId.split('::');
  if (!invoiceId || !paymentId) throw new Error(`bad payment id ${encodedId}`);

  const s = svc();
  const { data: row } = await s.from('invoices').select('id,project_id,user_id,qbo_id,payments').eq('id', invoiceId).eq('user_id', userId).maybeSingle();
  if (!row) throw new Error('invoice not found');
  const inv = row as { id: string; project_id: string; user_id: string; qbo_id: string | null; payments: InvoicePaymentBlob[] };
  const pay = inv.payments.find(p => p.id === paymentId);
  if (!pay) throw new Error('payment not found in invoice.payments');
  if (pay.source === 'qbo') return; // came FROM QBO — don't push back (feedback loop)
  if (pay.qboId) return; // already pushed

  if (!inv.qbo_id) throw new Error('Invoice not yet synced to QBO — cannot apply payment');
  const { data: projRow } = await s.from('projects').select('qbo_customer_id').eq('id', inv.project_id).maybeSingle();
  const customerId = (projRow as { qbo_customer_id?: string } | null)?.qbo_customer_id;
  if (!customerId) throw new Error('Project missing QBO customer');

  const body = {
    CustomerRef: { value: customerId },
    TotalAmt: pay.amount,
    TxnDate: pay.date.slice(0, 10),
    Line: [{ Amount: pay.amount, LinkedTxn: [{ TxnId: inv.qbo_id, TxnType: 'Invoice' }] }],
  };
  const r = await qboFetch(conn, '/payment', { method: 'POST', body: JSON.stringify(body) }) as { Payment?: { Id?: string } };
  const qboPaymentId = r?.Payment?.Id;
  if (!qboPaymentId) throw new Error('QBO did not return a Payment.Id');

  const nextPayments = inv.payments.map(p => p.id === paymentId ? { ...p, qboId: qboPaymentId, source: 'mage' } : p);
  await s.from('invoices').update({ payments: nextPayments }).eq('id', invoiceId);
}
```

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "upsertInvoice\|upsertPaymentForInvoice\|SalesItemLineDetail\|LinkedTxn" supabase/functions/_shared/qbo-mapping/{invoice,payment}.ts | head` → matches.

```bash
git add supabase/functions/_shared/qbo-mapping/invoice.ts supabase/functions/_shared/qbo-mapping/payment.ts
git commit -m "feat(qbo): invoice + payment mappers"
```

---

## Task 8: `useQboSync` hook + wire mutations

**Files:**
- Modify: `contexts/ProjectContext.tsx` — call `triggerQboSync(...)` after `addProject`, `addInvoice`, `updateInvoice`. (Payments live inside invoices; the Stripe webhook → `updateInvoice` path covers them; we call the payment sync separately when a payment is applied.)
- Modify: `utils/qboSync.ts` (already created in T5; nothing new here unless additional helpers are needed).

- [ ] **Step 1: Wire ProjectContext**

In `contexts/ProjectContext.tsx`, after the successful `supabaseWrite('projects','insert',...)` in `addProject` (≈L1320–1360), append (after `if (canSync && userId)` block):
```ts
void import('@/utils/qboSync').then(m => m.triggerQboSync('project', 'upsert', project.id));
```

In `addInvoice` (≈L1451) and `updateInvoice` (≈L1467), after the supabaseWrite, append:
```ts
void import('@/utils/qboSync').then(m => m.triggerQboSync('invoice', 'upsert', invoice.id));
```
For `updateInvoice` the param is `id` (not `invoice.id`).

For Stripe payment-applied paths (search the file for where `invoices.payments` is appended — typically in a `recordInvoicePayment` or similar that wraps an `updateInvoice` with a new `payments[]` entry), after the supabaseWrite append:
```ts
void import('@/utils/qboSync').then(m => m.triggerQboSync('payment', 'upsert', `${invoiceId}::${paymentId}`));
```

Use dynamic `import()` so the bundle code-splits the wrapper (avoids loading it for non-Business users; v1 keeps it simple but the lazy load is cheap and avoids a circular import with selectionsEngine etc.).

- [ ] **Step 2: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "triggerQboSync" contexts/ProjectContext.tsx | head` → at least 3 matches (addProject, addInvoice, updateInvoice; plus payments if applicable).

```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(qbo): trigger QBO sync after project/invoice/payment writes"
```

---

## Task 9: `qbo-reconciler` cron + payments read-back

**Files:**
- Create: `supabase/functions/qbo-reconciler/index.ts`
- Create: `supabase/migrations/20260526120200_qbo_reconciler_cron.sql` (cron registration; uses the existing `cron_secret` guard pattern)

- [ ] **Step 1: `qbo-reconciler/index.ts`**

```ts
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { isValidCron } from "../_shared/cronAuth.ts";
import { loadConnection, qboFetch, svc, type QboConnectionRow } from "../_shared/qbo.ts";
import { upsertInvoice } from "../_shared/qbo-mapping/invoice.ts";
import { upsertCustomer } from "../_shared/qbo-mapping/customer.ts";
import { upsertItem } from "../_shared/qbo-mapping/item.ts";
import { upsertPaymentForInvoice } from "../_shared/qbo-mapping/payment.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

serve(async (req) => {
  if (!(await isValidCron(req))) return json({ success: false, error: 'cron auth required' }, 401);

  const s = svc();
  const { data: conns, error } = await s.from('qbo_connections').select('*').eq('status', 'connected');
  if (error) return json({ success: false, error: error.message }, 500);

  let pushed = 0, pulled = 0, errors = 0;
  for (const row of (conns ?? []) as QboConnectionRow[]) {
    try {
      // 1) Re-push rows in 'error' or 'pending' older than 5 min (retry up to 5 times).
      const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
      const { data: pending } = await s.from('invoices')
        .select('id')
        .eq('user_id', row.user_id)
        .or('qbo_sync_status.eq.pending,qbo_sync_status.eq.error')
        .lt('qbo_synced_at', cutoff)
        .lt('qbo_retry_count', 5)
        .limit(50);
      for (const p of (pending ?? []) as { id: string }[]) {
        try {
          await upsertInvoice(row, p.id, row.user_id);
          pushed++;
        } catch (e) {
          errors++;
          await s.from('invoices').update({
            qbo_sync_status: 'error',
            qbo_error: String((e as Error).message ?? e).slice(0, 500),
            qbo_retry_count: (await s.from('invoices').select('qbo_retry_count').eq('id', p.id).maybeSingle()).data?.qbo_retry_count ?? 0 + 1,
          }).eq('id', p.id);
        }
      }

      // 2) Pull QBO invoices updated since last_sync_at and flow payment status back.
      const sinceIso = (row as { last_sync_at?: string }).last_sync_at ?? '1970-01-01';
      const since = sinceIso.replace('T', ' ').replace(/\..*$/, '').slice(0, 19);
      const q = await qboFetch(row, "/query?query=" + encodeURIComponent(
        `select Id, Balance, TotalAmt, MetaData from Invoice where MetaData.LastUpdatedTime > '${since}' MAXRESULTS 200`
      ), { method: 'GET' }) as { QueryResponse?: { Invoice?: { Id: string; Balance: number; TotalAmt: number }[] } };
      const updated = q?.QueryResponse?.Invoice ?? [];
      for (const qInv of updated) {
        if (qInv.Balance > 0) continue; // not paid
        const { data: m } = await s.from('invoices').select('id,payments').eq('qbo_id', qInv.Id).eq('user_id', row.user_id).maybeSingle();
        if (!m) continue;
        const payments = (m as { payments?: { id: string; source?: string }[] } | null)?.payments ?? [];
        const hasQboPayment = payments.some(p => p.source === 'qbo');
        if (hasQboPayment) continue;
        // Synthesize a payment record marked as source='qbo' to prevent feedback loops.
        const next = [...payments, {
          id: `qbo-${qInv.Id}-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          amount: qInv.TotalAmt,
          method: 'qbo',
          source: 'qbo' as const,
        }];
        await s.from('invoices').update({ payments: next, amount_paid: qInv.TotalAmt, status: 'paid' }).eq('id', (m as { id: string }).id);
        pulled++;
      }

      // 3) Update last_sync_at.
      await s.from('qbo_connections').update({ last_sync_at: new Date().toISOString() }).eq('user_id', row.user_id);
    } catch (e) {
      errors++;
      await s.from('qbo_connections').update({ last_error: String((e as Error).message ?? e).slice(0, 300) }).eq('user_id', row.user_id);
    }
  }

  return json({ success: true, pushed, pulled, errors });
});
```

- [ ] **Step 2: Cron registration migration**

```sql
-- 20260526120200_qbo_reconciler_cron.sql
-- Schedule qbo-reconciler every 30 minutes via pg_cron + the existing cron-secret pattern.
-- Reuses the private.cron_auth helper installed by 20260523xxxxxx_cron_secret_guard.sql.

select cron.schedule(
  'qbo-reconciler-every-30m',
  '*/30 * * * *',
  $$
    select net.http_post(
      url := current_setting('app.functions_url', true) || '/qbo-reconciler',
      headers := jsonb_build_object('content-type','application/json', 'x-cron-secret', private.cron_auth()),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $$
);
```
(Adjust to match the project's actual cron registration pattern — `grep` for `cron.schedule` in `supabase/migrations/` and mirror exactly. The above is the shape; field names may vary.)

- [ ] **Step 3: Type-check + grep + commit**

Run: `npx tsc --noEmit` → clean.
Run: `grep -n "qbo-reconciler-every-30m\|isValidCron" supabase/functions/qbo-reconciler/index.ts supabase/migrations/20260526120200_qbo_reconciler_cron.sql | head` → matches.

```bash
git add supabase/functions/qbo-reconciler/index.ts supabase/migrations/20260526120200_qbo_reconciler_cron.sql
git commit -m "feat(qbo): reconciler cron — retry pending + flow QBO payments back"
```

---

## Final verification (after all Phase 1 tasks)

- [ ] `npx tsc --noEmit` clean.
- [ ] `bun run lint` — no new errors.
- [ ] Whole-implementation review (opus): OAuth flow correctness (state HMAC + expiry + redirect URI match), token refresh + rotation persisted atomically, no token leakage in responses/logs, idempotency via `qbo_hash`, retry caps, reconciler payments-back marker prevents feedback loops, owner RLS on `qbo_connections`, all mapping bodies match QBO V3 schema. **No P0/P1 = ship.**
- [ ] **Ship** (separate batched step):
  - Apply both migrations via Supabase MCP `apply_migration`.
  - Deploy 5 edge functions: `qbo-connect-start`, `qbo-connect-callback`, `qbo-connect-status`, `qbo-sync`, `qbo-reconciler`.
  - Set Supabase secrets: `INTUIT_CLIENT_ID`, `INTUIT_CLIENT_SECRET`, optionally `INTUIT_REDIRECT_URI` and `INTUIT_STATE_SECRET`.
  - OTA prod + preview.
  - Manual smoke against the Intuit sandbox connection.

## Edge cases & known gaps (intentional for v1)
- `SyncToken` is sent as `'0'` for updates. If we hit 5010 errors, Phase 4 hardens by fetching the current token first.
- Customer matching is **create-new**, not match-existing-QBO. Phase 4 adds a "match existing" UI.
- Delete operations are a no-op (we never void/delete in QBO automatically). Manual cleanup expected for now.
- The reconciler treats anything with `Balance=0` as paid; partial QBO payments aren't synced back in v1.
- The Settings "Sync now" button currently just refreshes status; a full re-sync-everything button is Phase 4.

## Out of scope (Phase 1 — covered by later phases)
- Vendors + Bills (Phase 2).
- Change Orders + AIA Pay Apps (Phase 3).
- Errors tray UI + sandbox/prod toggle + disconnect-with-revoke (Phase 4).
