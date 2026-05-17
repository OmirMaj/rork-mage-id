# Client Financing (Hosted-Link MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a partner-hosted client-financing referral surface (homeowner finances the job through a licensed third party, GC paid in full upfront) on the estimate/invoice + client portal, with attribution tracking — MAGE ID is never a lender.

**Architecture:** GC opts in via a config stored on the existing `profiles` settings row (jsonb, exactly like `theme_colors`/`digest`). A shared `utils/financing.ts` renders the offer block + builds an opaque-token redirect URL targeting a new `financing-redirect` edge function (records click → 302 to the partner's hosted prequal page). A `financing_referrals` Supabase table tracks the funnel; `financing-callback` (partner return URL) moves status forward. Mirrors the existing Stripe-Connect boundary (`connect-status`/`stripe-webhook`).

**Tech Stack:** React Native / Expo Router (TypeScript strict), Supabase (Postgres + RLS + Deno edge functions), `@tanstack/react-query`. Spec: `docs/superpowers/specs/2026-05-17-client-financing-design.md`.

**Verification model (READ THIS):** This repo has **no unit-test runner** (per CLAUDE.md). The TDD red/green template does not apply. Every task's verification is: (1) `npx tsc --noEmit` is clean, and (2) the specific manual check named in the task (from spec §9). Run all commands from the worktree root: `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main` (currently `main` HEAD `47ccb06`).

**Conventions confirmed in this codebase:**
- Settings persist on the `profiles` table. Object-valued settings (`theme_colors`, `digest_*`) are set in `saveSettingsMutation` `.update({...})` (ProjectContext.tsx ~line 1054-1073) and read back in `settingsQuery` (~line 170-189). `updateSettings(updates: Partial<AppSettings>)` shallow-merges and persists.
- Edge functions: Deno, `serve` from `https://deno.land/std@0.177.0/http/server.ts`, `createClient` from `https://esm.sh/@supabase/supabase-js@2.45.0`, env `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`, a `corsHeaders` object. Service role bypasses RLS.
- `lib/supabase.ts` exports `SUPABASE_URL` and `isSupabaseConfigured`.
- `utils/generateId.ts` exports `generateUUID()`.
- `utils/offlineQueue.ts` exports `supabaseWrite(table, 'insert'|'update'|'delete', data)`; `'insert'` does `.upsert(data)`.
- Email HTML builders are `buildInvoiceEmailHtml(opts)` (emailService.ts:292) and `buildEstimateEmailHtml(opts)` (emailService.ts:531); both take an options object and return a string.

---

### Task 1: Domain types

**Files:**
- Modify: `types/index.ts` (add interfaces near other settings/portal types; add field to `AppSettings`)

- [ ] **Step 1: Add the financing types**

Add this block immediately **above** `export interface AppSettings {` in `types/index.ts`:

```ts
export interface FinancingConfig {
  enabled: boolean;
  partnerName: string;          // e.g. "Wisetack"
  prequalBaseUrl: string;       // partner's hosted prequalification page
  gcRefCode?: string;           // GC's partner/affiliate code, if any
  exampleApr?: number;          // optional — illustrative estimate only (e.g. 9.99)
  exampleTermMonths?: number;   // optional — illustrative estimate only (e.g. 60)
  updatedAt: string;            // ISO
}

export type FinancingReferralStatus =
  | 'created' | 'clicked' | 'prequalified' | 'funded' | 'declined';

export type FinancingReferralSource = 'estimate' | 'invoice' | 'portal';

export interface FinancingReferral {
  id: string;                   // = refToken; opaque, the only id in the URL
  projectId: string;
  gcUserId: string;
  partnerName: string;
  amountCents: number;          // amount the offer was for; 0 if unknown
  status: FinancingReferralStatus;
  source: FinancingReferralSource;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2: Add `financing` to `AppSettings`**

In `export interface AppSettings { ... }`, add this line immediately after the `digest?: { ... };` block's closing `};`:

```ts
  /** Client-financing referral config. Absent ⇒ feature off. */
  financing?: FinancingConfig;
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean (exit 0). No other file references these types yet.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts
git commit -m "feat(financing): domain types (FinancingConfig, FinancingReferral)"
```

---

### Task 2: Database — referrals table + profiles.financing column

**Files:**
- Create: `supabase/migrations/20260517090000_client_financing.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260517090000_client_financing.sql`:

```sql
-- Client financing (hosted-link MVP).
--
-- profiles.financing: GC-level FinancingConfig (jsonb), same pattern as
-- theme_colors. Absent/null ⇒ feature off.
alter table public.profiles
  add column if not exists financing jsonb;

-- financing_referrals: funnel attribution. id == the opaque refToken that
-- is the ONLY identifier placed in the outbound URL. Edge functions use
-- the service role (RLS-bypassing) and resolve rows by id; the GC sees
-- only their own rows.
create table if not exists public.financing_referrals (
  id text primary key,
  project_id uuid references public.projects(id) on delete cascade,
  gc_user_id uuid not null references auth.users(id) on delete cascade,
  partner_name text not null default '',
  amount_cents integer not null default 0,
  status text not null default 'created'
    check (status in ('created','clicked','prequalified','funded','declined')),
  source text not null default 'invoice'
    check (source in ('estimate','invoice','portal')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.financing_referrals enable row level security;

-- The GC owns their referral rows (read + write). Homeowner is anonymous
-- and never queries this table directly — the edge functions use the
-- service role, which bypasses RLS.
drop policy if exists financing_referrals_owner_all on public.financing_referrals;
create policy financing_referrals_owner_all on public.financing_referrals
  for all to authenticated
  using (gc_user_id = auth.uid())
  with check (gc_user_id = auth.uid());

create index if not exists financing_referrals_gc_idx
  on public.financing_referrals (gc_user_id);
create index if not exists financing_referrals_project_idx
  on public.financing_referrals (project_id);
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP (project `nteoqhcswappxxjlpvap`): call `apply_migration` with name `client_financing` and the SQL above. (Do NOT use the dashboard.)

- [ ] **Step 3: Verify**

Via Supabase MCP `execute_sql`:
```sql
select column_name from information_schema.columns
where table_name='profiles' and column_name='financing';
select policyname from pg_policies where tablename='financing_referrals';
```
Expected: one `financing` column row; one `financing_referrals_owner_all` policy row.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260517090000_client_financing.sql
git commit -m "feat(financing): financing_referrals table + profiles.financing column + RLS"
```

---

### Task 3: Shared financing helper (single source of truth)

**Files:**
- Modify: `lib/supabase.ts` (export functions base URL)
- Create: `utils/financing.ts`

- [ ] **Step 1: Export the functions base URL**

In `lib/supabase.ts`, immediately after the line `export const SUPABASE_ANON_KEY = ...`, add:

```ts
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
```

- [ ] **Step 2: Create `utils/financing.ts`**

```ts
// Single source of truth for the client-financing offer surface. The
// invoice email, estimate email, and client portal all render from here
// so copy / disclosure / URL can never drift between surfaces.
//
// MAGE ID is NOT a lender. This module only builds marketing copy and a
// redirect URL to the partner's hosted prequalification page. No SSN /
// income / bank data is ever collected in-app.

import type { AppSettings, FinancingConfig } from '@/types';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';

export function isFinancingAvailable(settings: AppSettings | undefined): boolean {
  const f = settings?.financing;
  return !!f && f.enabled && f.partnerName.trim().length > 0 && /^https:\/\//i.test(f.prequalBaseUrl.trim());
}

/** Standard amortized monthly payment. Returns null when an illustrative
 *  figure must NOT be shown (no example terms configured, or no amount). */
export function illustrativeMonthly(amountCents: number, cfg: FinancingConfig): number | null {
  if (!cfg.exampleApr || !cfg.exampleTermMonths || amountCents <= 0) return null;
  const principal = amountCents / 100;
  const r = cfg.exampleApr / 100 / 12;
  const n = cfg.exampleTermMonths;
  if (r === 0) return principal / n;
  const m = (principal * r) / (1 - Math.pow(1 + r, -n));
  return Math.round(m);
}

export function financingDisclosure(cfg: FinancingConfig): string {
  return `Financing provided by ${cfg.partnerName}, a third party, subject to credit approval. MAGE ID is not a lender and may receive compensation.`;
}

export function buildFinancingRedirectUrl(refToken: string): string {
  return `${SUPABASE_FUNCTIONS_URL}/financing-redirect?ref=${encodeURIComponent(refToken)}`;
}

/** Pre-rendered HTML block injected into invoice/estimate emails. Empty
 *  string when financing is unavailable (caller appends unconditionally). */
export function financingEmailBlockHtml(args: {
  settings: AppSettings | undefined;
  amountCents: number;
  refToken: string;
}): string {
  const { settings, amountCents, refToken } = args;
  if (!isFinancingAvailable(settings)) return '';
  const cfg = settings!.financing!;
  const url = buildFinancingRedirectUrl(refToken);
  const monthly = illustrativeMonthly(amountCents, cfg);
  const headline = monthly
    ? `Prefer to pay monthly? Est. <strong>$${monthly.toLocaleString('en-US')}/mo</strong> — see if you prequalify in ~2 min.`
    : `Prefer to pay monthly? See if you prequalify in ~2 min.`;
  return `
    <div style="margin:18px 0;padding:16px;border:1px solid #E2E5E9;border-radius:12px;background:#F7F8FA;">
      <p style="margin:0 0 10px;font-size:14px;color:#2B3038;">${headline}</p>
      <a href="${url}" style="display:inline-block;padding:10px 18px;background:#1F6FEB;color:#fff;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">Check financing options</a>
      <p style="margin:10px 0 0;font-size:11px;color:#9AA3AD;">${monthly ? 'Estimated payment, not an offer. Actual terms from ' + cfg.partnerName + ' on approval. ' : ''}${financingDisclosure(cfg)}</p>
    </div>`;
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean. Sanity-check the math by reasoning: `illustrativeMonthly(2_800_000, { exampleApr: 9.99, exampleTermMonths: 60, ... })` ≈ `$595` (principal $28,000, ~10% APR, 60 mo). `illustrativeMonthly(2_800_000, { ...no exampleApr })` → `null`. `isFinancingAvailable(undefined)` → `false`.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase.ts utils/financing.ts
git commit -m "feat(financing): shared offer helper (URL, disclosure, illustrative payment, email block)"
```

---

### Task 4: Persist `financing` config on settings

**Files:**
- Modify: `contexts/ProjectContext.tsx` (settings read map ~line 170-189; `saveSettingsMutation` update ~line 1059-1072)

- [ ] **Step 1: Read `financing` back from the profiles row**

In `settingsQuery`'s `queryFn`, inside the `const s: AppSettings = { ... }` object literal, add this line directly after the `digest: { ... },` block:

```ts
              financing: data.financing as AppSettings['financing'],
```

- [ ] **Step 2: Persist `financing` on save**

In `saveSettingsMutation`'s `supabase.from('profiles').update({ ... })` object, add this line directly after the `digest_timezone: ...,` line:

```ts
            financing: updatedSettings.financing ?? null,
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: clean.
Manual (spec §9.1): in the running app, call `updateSettings({ financing: { enabled: true, partnerName: 'Wisetack', prequalBaseUrl: 'https://wisetack.com', updatedAt: new Date().toISOString() } })` from the Financing card (built in Task 8) — but for this task, verify the round-trip by temporarily logging `settings.financing` after a save; it should survive an app reload (Supabase) and offline (AsyncStorage `SETTINGS_KEY`).

- [ ] **Step 4: Commit**

```bash
git add contexts/ProjectContext.tsx
git commit -m "feat(financing): persist settings.financing on profiles (read + write)"
```

---

### Task 5: `useFinancingReferrals` hook (list + ensure-referral)

**Files:**
- Create: `hooks/useFinancingReferrals.ts`

Modeled on `hooks/usePortalThread.ts` (react-query + Supabase + realtime + camel mapping).

- [ ] **Step 1: Create the hook**

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';
import type { FinancingReferral, FinancingReferralSource } from '@/types';

interface ReferralRow {
  id: string;
  project_id: string | null;
  gc_user_id: string;
  partner_name: string;
  amount_cents: number;
  status: FinancingReferral['status'];
  source: FinancingReferralSource;
  created_at: string;
  updated_at: string;
}

function rowToReferral(r: ReferralRow): FinancingReferral {
  return {
    id: r.id,
    projectId: r.project_id ?? '',
    gcUserId: r.gc_user_id,
    partnerName: r.partner_name,
    amountCents: r.amount_cents,
    status: r.status,
    source: r.source,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function useFinancingReferrals(gcUserId: string | undefined) {
  const queryClient = useQueryClient();
  const enabled = !!gcUserId && isSupabaseConfigured;

  const referralsQ = useQuery({
    queryKey: ['financingReferrals', gcUserId],
    enabled,
    queryFn: async (): Promise<FinancingReferral[]> => {
      if (!gcUserId) return [];
      const { data, error } = await supabase
        .from('financing_referrals')
        .select('*')
        .eq('gc_user_id', gcUserId)
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[useFinancingReferrals] fetch failed:', error.message);
        return [];
      }
      return ((data ?? []) as ReferralRow[]).map(rowToReferral);
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  // Find-or-create the referral row for (project, source). Re-sending the
  // same document reuses the same row + token (one per project+source),
  // so attribution is stable. Returns the opaque refToken.
  const ensureReferral = useCallback(
    async (args: {
      projectId: string;
      gcUserId: string;
      source: FinancingReferralSource;
      amountCents: number;
      partnerName: string;
    }): Promise<string> => {
      const existing = (referralsQ.data ?? []).find(
        r => r.projectId === args.projectId && r.source === args.source,
      );
      if (existing) return existing.id;
      const token = `fin_${generateUUID().replace(/-/g, '')}`;
      const now = new Date().toISOString();
      const { error } = await supabase.from('financing_referrals').insert({
        id: token,
        project_id: args.projectId,
        gc_user_id: args.gcUserId,
        partner_name: args.partnerName,
        amount_cents: Math.max(0, Math.round(args.amountCents)),
        status: 'created',
        source: args.source,
        created_at: now,
        updated_at: now,
      });
      if (error) console.log('[useFinancingReferrals] create failed:', error.message);
      void queryClient.invalidateQueries({ queryKey: ['financingReferrals', args.gcUserId] });
      return token;
    },
    [referralsQ.data, queryClient],
  );

  useEffect(() => {
    if (!enabled || !gcUserId) return;
    const channelName = `financing-referrals-${gcUserId}`;
    const existing = supabase.getChannels().find(c => c.topic === `realtime:${channelName}`);
    if (existing) return;
    const channel = supabase.channel(channelName);
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'financing_referrals', filter: `gc_user_id=eq.${gcUserId}` },
      () => { void queryClient.invalidateQueries({ queryKey: ['financingReferrals', gcUserId] }); },
    );
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [enabled, gcUserId, queryClient]);

  const referrals = referralsQ.data ?? [];
  return {
    referrals,
    counts: {
      created: referrals.length,
      clicked: referrals.filter(r => r.status !== 'created').length,
      funded: referrals.filter(r => r.status === 'funded').length,
    },
    ensureReferral,
    refetch: referralsQ.refetch,
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add hooks/useFinancingReferrals.ts
git commit -m "feat(financing): useFinancingReferrals hook (list + ensureReferral + realtime)"
```

---

### Task 6: `financing-redirect` edge function

**Files:**
- Create: `supabase/functions/financing-redirect/index.ts`

- [ ] **Step 1: Write the function**

```ts
// financing-redirect
//
// GET ?ref=<refToken>
// Records the homeowner click on the financing offer, then 302-redirects
// to the partner's hosted prequalification page (prefilled with amount +
// the GC's partner code + the ref token as the partner return key).
//
// MAGE is not a lender; this only forwards the homeowner to the partner.
// Unknown/missing token => safe redirect to the marketing site, never an
// error page to the homeowner.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCING_FALLBACK_URL
// (optional; defaults to https://mageid.app).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FALLBACK_URL = Deno.env.get("FINANCING_FALLBACK_URL") || "https://mageid.app";

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  try {
    const params = new URL(req.url).searchParams;
    const ref = params.get("ref") ?? "";
    const projectParam = params.get("project") ?? "";
    const srcParam = params.get("src") ?? "";

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Two entry modes:
    //  (a) ?ref=<token>  — emailed invoice/estimate link (row pre-created
    //      by the authenticated GC via the app).
    //  (b) ?project=<id>&src=portal — the anonymous client-portal button.
    //      The homeowner has no auth.uid(), so it CANNOT insert under RLS;
    //      instead this service-role fn find-or-creates the (project,
    //      'portal') row itself. projectId in the URL leaks nothing — the
    //      homeowner is already viewing that exact project in the portal.
    let row: {
      id: string; gc_user_id: string; amount_cents: number; status: string;
    } | null = null;

    if (ref) {
      const { data } = await db
        .from("financing_referrals").select("*").eq("id", ref).maybeSingle();
      row = data ?? null;
    } else if (projectParam && srcParam === "portal") {
      const { data: existing } = await db
        .from("financing_referrals")
        .select("*")
        .eq("project_id", projectParam)
        .eq("source", "portal")
        .maybeSingle();
      if (existing) {
        row = existing;
      } else {
        const { data: proj } = await db
          .from("projects").select("id,user_id").eq("id", projectParam).maybeSingle();
        if (!proj) return redirect(FALLBACK_URL);
        const id = `fin_${crypto.randomUUID().replace(/-/g, "")}`;
        const now = new Date().toISOString();
        const { data: created } = await db
          .from("financing_referrals")
          .insert({
            id, project_id: proj.id, gc_user_id: proj.user_id,
            partner_name: "", amount_cents: 0,
            status: "created", source: "portal",
            created_at: now, updated_at: now,
          })
          .select("*")
          .maybeSingle();
        row = created ?? null;
      }
    }

    if (!row) return redirect(FALLBACK_URL);

    if (row.status === "created") {
      await db
        .from("financing_referrals")
        .update({ status: "clicked", updated_at: new Date().toISOString() })
        .eq("id", row.id);
    }

    const { data: prof } = await db
      .from("profiles")
      .select("financing")
      .eq("id", row.gc_user_id)
      .maybeSingle();
    const cfg = (prof?.financing ?? {}) as {
      prequalBaseUrl?: string; gcRefCode?: string;
    };
    const base = (cfg.prequalBaseUrl ?? "").trim();
    if (!/^https:\/\//i.test(base)) return redirect(FALLBACK_URL);

    const dest = new URL(base);
    if (row.amount_cents > 0) {
      dest.searchParams.set("amount", String(Math.round(row.amount_cents / 100)));
    }
    if (cfg.gcRefCode) dest.searchParams.set("ref_code", cfg.gcRefCode);
    dest.searchParams.set("partner_ref", row.id);
    return redirect(dest.toString());
  } catch (err) {
    console.log("[financing-redirect] error:", err);
    return redirect(FALLBACK_URL);
  }
});
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy financing-redirect --project-ref nteoqhcswappxxjlpvap
```

- [ ] **Step 3: Verify** (spec §9.3)

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" \
  "https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/financing-redirect?ref=does-not-exist"
```
Expected: `302 https://mageid.app` (unknown token → safe fallback, never an error).
`npx tsc --noEmit` is not run for Deno files (excluded from app tsconfig); confirm the function file is under `supabase/functions/` so it is excluded.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/financing-redirect/index.ts
git commit -m "feat(financing): financing-redirect edge fn (record click → 302 to partner)"
```

---

### Task 7: `financing-callback` edge function

**Files:**
- Create: `supabase/functions/financing-callback/index.ts`

- [ ] **Step 1: Write the function**

```ts
// financing-callback
//
// GET/POST ?ref=<refToken>&status=<prequalified|funded|declined>
// Partner return-URL / postback target. Moves the referral status FORWARD
// only (created < clicked < prequalified < funded; declined is terminal).
// Unknown token => 200 no-op (never error). Then 302 to a thank-you page.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FINANCING_THANKYOU_URL
// (optional; defaults to https://mageid.app/financing/thanks).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const THANKYOU_URL = Deno.env.get("FINANCING_THANKYOU_URL") || "https://mageid.app/financing/thanks";

const RANK: Record<string, number> = {
  created: 0, clicked: 1, prequalified: 2, funded: 3,
};

function redirect(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url } });
}

serve(async (req) => {
  try {
    const u = new URL(req.url);
    const ref = u.searchParams.get("ref") ?? "";
    const next = (u.searchParams.get("status") ?? "").toLowerCase();
    const allowed = ["prequalified", "funded", "declined"];
    if (!ref || !allowed.includes(next)) return redirect(THANKYOU_URL);

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: row } = await db
      .from("financing_referrals")
      .select("status")
      .eq("id", ref)
      .maybeSingle();
    if (!row) return redirect(THANKYOU_URL);

    // Forward-only. 'declined' may set from any non-terminal state; the
    // ranked states never regress.
    const shouldUpdate =
      next === "declined"
        ? row.status !== "funded" && row.status !== "declined"
        : (RANK[next] ?? -1) > (RANK[row.status] ?? -1);

    if (shouldUpdate) {
      await db
        .from("financing_referrals")
        .update({ status: next, updated_at: new Date().toISOString() })
        .eq("id", ref);
    }
    return redirect(THANKYOU_URL);
  } catch (err) {
    console.log("[financing-callback] error:", err);
    return redirect(THANKYOU_URL);
  }
});
```

- [ ] **Step 2: Deploy**

```bash
supabase functions deploy financing-callback --project-ref nteoqhcswappxxjlpvap
```

- [ ] **Step 3: Verify** (spec §9.5)

Create a test row via Supabase MCP `execute_sql`:
```sql
insert into public.financing_referrals (id, project_id, gc_user_id, status, source)
values ('fin_test_cb', null, (select id from auth.users limit 1), 'clicked', 'invoice');
```
Then:
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/financing-callback?ref=fin_test_cb&status=funded"
```
Expected: `302`. Re-query the row → `status='funded'`. Call again with `status=clicked` → row stays `funded` (forward-only). Clean up: `delete from public.financing_referrals where id='fin_test_cb';`

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/financing-callback/index.ts
git commit -m "feat(financing): financing-callback edge fn (forward-only status update)"
```

---

### Task 8: GC setup — Financing card in payments-setup

**Files:**
- Modify: `app/payments-setup.tsx`

- [ ] **Step 1: Add imports**

At the top of `app/payments-setup.tsx` with the other imports, add:

```ts
import { useProjects } from '@/contexts/ProjectContext';
import { useFinancingReferrals } from '@/hooks/useFinancingReferrals';
import { financingDisclosure } from '@/utils/financing';
import type { FinancingConfig } from '@/types';
```

- [ ] **Step 2: Add state + handlers inside `PaymentsSetupScreen`**

After the existing `const [status, setStatus] = useState<ConnectStatus>('none');` line, add:

```ts
  const { settings, updateSettings } = useProjects();
  const fin = settings.financing;
  const referralStats = useFinancingReferrals(user?.id).counts;
  const [finEnabled, setFinEnabled] = useState<boolean>(!!fin?.enabled);
  const [finPartner, setFinPartner] = useState<string>(fin?.partnerName ?? '');
  const [finUrl, setFinUrl] = useState<string>(fin?.prequalBaseUrl ?? '');
  const [finRefCode, setFinRefCode] = useState<string>(fin?.gcRefCode ?? '');
  const [finApr, setFinApr] = useState<string>(fin?.exampleApr != null ? String(fin.exampleApr) : '');
  const [finTerm, setFinTerm] = useState<string>(fin?.exampleTermMonths != null ? String(fin.exampleTermMonths) : '');

  const saveFinancing = useCallback((enabled: boolean) => {
    const url = finUrl.trim();
    if (enabled && !/^https:\/\//i.test(url)) {
      Alert.alert('Invalid URL', "The partner's prequalification link must start with https://.");
      return;
    }
    const cfg: FinancingConfig = {
      enabled,
      partnerName: finPartner.trim(),
      prequalBaseUrl: url,
      gcRefCode: finRefCode.trim() || undefined,
      exampleApr: finApr.trim() ? Number(finApr) : undefined,
      exampleTermMonths: finTerm.trim() ? Number(finTerm) : undefined,
      updatedAt: new Date().toISOString(),
    };
    updateSettings({ financing: cfg });
    setFinEnabled(enabled);
  }, [finUrl, finPartner, finRefCode, finApr, finTerm, updateSettings]);
```

(If `useState`, `useCallback`, `Alert`, `TextInput`, `Switch` are not already imported in this file, add them to the existing `react`/`react-native` imports.)

- [ ] **Step 3: Render the Financing card**

Find the JSX where the Stripe Connect card/section ends (search for the closing of the last `<View style={styles.card}>` before the screen's container closes). Add a sibling card after it:

```tsx
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Client financing</Text>
          <Text style={styles.cardSubtitle}>
            Let homeowners pay monthly through a third-party partner — you’re paid in full upfront.
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
            <Text style={styles.cardSubtitle}>Offer financing on estimates & invoices</Text>
            <Switch value={finEnabled} onValueChange={(v) => saveFinancing(v)} testID="financing-enable" />
          </View>

          <TextInput style={styles.input} value={finPartner} onChangeText={setFinPartner}
            placeholder="Partner name (e.g. Wisetack)" placeholderTextColor="#9AA3AD" />
          <TextInput style={styles.input} value={finUrl} onChangeText={setFinUrl}
            placeholder="https://partner.com/prequalify" autoCapitalize="none" keyboardType="url" placeholderTextColor="#9AA3AD" />
          <TextInput style={styles.input} value={finRefCode} onChangeText={setFinRefCode}
            placeholder="Your partner referral code (optional)" autoCapitalize="none" placeholderTextColor="#9AA3AD" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput style={[styles.input, { flex: 1 }]} value={finApr} onChangeText={setFinApr}
              placeholder="Example APR % (optional)" keyboardType="decimal-pad" placeholderTextColor="#9AA3AD" />
            <TextInput style={[styles.input, { flex: 1 }]} value={finTerm} onChangeText={setFinTerm}
              placeholder="Example term (months)" keyboardType="number-pad" placeholderTextColor="#9AA3AD" />
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={() => saveFinancing(finEnabled)} testID="financing-save">
            <Text style={styles.primaryBtnText}>Save financing settings</Text>
          </TouchableOpacity>

          <Text style={{ fontSize: 11, color: '#9AA3AD', marginTop: 10 }}>
            {finPartner.trim() ? financingDisclosure({
              enabled: finEnabled, partnerName: finPartner.trim(), prequalBaseUrl: finUrl,
              updatedAt: '',
            }) : 'Configure a partner to see the client disclosure that will appear on every offer.'}
          </Text>
          {finEnabled && (
            <Text style={{ fontSize: 12, color: '#4A5159', marginTop: 8 }}>
              Referrals: {referralStats.created} created · {referralStats.clicked} clicked · {referralStats.funded} funded
            </Text>
          )}
        </View>
```

If `styles.cardTitle` / `styles.cardSubtitle` / `styles.input` / `styles.primaryBtn` / `styles.primaryBtnText` do not all exist in this file's `StyleSheet`, reuse the nearest existing equivalents (the Stripe card's title/subtitle/button styles) — match the established style names in this file rather than inventing new ones.

- [ ] **Step 4: Verify** (spec §9.1, §9.6)

Run: `npx tsc --noEmit` → clean.
Manual: open Settings → Payments. The Financing card renders. Toggle on, enter partner name + an `https://` URL, Save → reload the app → values persist. Toggle off → `settings.financing.enabled` is false.

- [ ] **Step 5: Commit**

```bash
git add app/payments-setup.tsx
git commit -m "feat(financing): GC Financing setup card in payments-setup"
```

---

### Task 9: Surface the offer (invoice email, estimate email, client portal)

**Files:**
- Modify: `utils/emailService.ts` (add `financingHtml?` to `buildInvoiceEmailHtml` and `buildEstimateEmailHtml`)
- Modify: `app/invoice.tsx` (wire at the `buildInvoiceEmailHtml` call in `handleConfirmSend`)
- Modify: `app/(tabs)/estimate/index.tsx` (wire at the `buildEstimateEmailHtml` call, ~line 848)
- Modify: `app/client-view.tsx` (a "Finance this project" button + disclosure)

- [ ] **Step 1: Add `financingHtml?` to the invoice email builder**

In `utils/emailService.ts`, in `buildInvoiceEmailHtml`'s `opts` type add `financingHtml?: string;` (next to `payLinkUrl?`), destructure it (`const { ..., payLinkUrl, financingHtml } = opts;`), and append it to `bodyHtml` immediately after the `emailStatCard(stats)` interpolation:

```ts
    ${financingHtml ?? ''}
```

Do the identical change in `buildEstimateEmailHtml` (add `financingHtml?: string;` to its opts, destructure, and inject `${financingHtml ?? ''}` after its main stat/summary card in its `bodyHtml`).

- [ ] **Step 2: Wire the invoice send**

In `app/invoice.tsx`, `handleConfirmSend` (the function that calls `buildInvoiceEmailHtml`), add these imports at the top of the file if missing:

```ts
import { useFinancingReferrals } from '@/hooks/useFinancingReferrals';
import { financingEmailBlockHtml, isFinancingAvailable } from '@/utils/financing';
```

Inside the component, near the other hooks, add:

```ts
  const { ensureReferral } = useFinancingReferrals(user?.id);
```

In `handleConfirmSend`, after `workingInvoice` is finalized and before `const html = buildInvoiceEmailHtml({`, add:

```ts
    let financingHtml = '';
    if (isFinancingAvailable(settings) && projectId && user?.id) {
      const refToken = await ensureReferral({
        projectId,
        gcUserId: user.id,
        source: 'invoice',
        amountCents: Math.round(totalDue * 100),
        partnerName: settings.financing!.partnerName,
      });
      financingHtml = financingEmailBlockHtml({
        settings,
        amountCents: Math.round(totalDue * 100),
        refToken,
      });
    }
```

Then pass `financingHtml,` into the `buildInvoiceEmailHtml({ ... })` call object. Add `ensureReferral`, `settings` to the `handleConfirmSend` `useCallback` dependency array (alongside the existing deps).

- [ ] **Step 3: Wire the estimate send**

In `app/(tabs)/estimate/index.tsx`, at the `buildEstimateEmailHtml({ ... })` call (~line 848), apply the same pattern: import `useFinancingReferrals`, `financingEmailBlockHtml`, `isFinancingAvailable`; get `ensureReferral` from the hook with the current user id (use the same user-id source already used in this screen — the screen already has access to `useProjects`/auth; reuse whatever id the screen uses for ownership). Before the builder call, if `isFinancingAvailable(settings)` and the screen's selected project id is present, `await ensureReferral({ projectId: <selectedProjectId in scope>, gcUserId: <userId>, source: 'estimate', amountCents: Math.round(<estimate grand total in scope> * 100), partnerName: settings.financing!.partnerName })`, build the block with `financingEmailBlockHtml`, and pass `financingHtml` into `buildEstimateEmailHtml({ ... })`. Use the project id and estimate total variables already in scope at that callsite (this screen sends an estimate for a specific project — those values exist where the email is assembled).

- [ ] **Step 4: Client portal button**

The client portal is **anonymous** (no `auth.uid()`), so it must NOT touch
`financing_referrals` directly (RLS forbids it) and does NOT need the GC's
`AppSettings` client-side. It just opens the `financing-redirect` edge fn
in `?project=&src=portal` mode (Task 6 mode (b)); that service-role fn
find-or-creates the row and resolves the partner config server-side.

In `app/client-view.tsx`, add imports (skip any already present):

```ts
import * as Linking from 'expo-linking';
import { SUPABASE_FUNCTIONS_URL } from '@/lib/supabase';
```

In the project's money/summary section JSX (where the estimate/invoice
total is shown to the homeowner), add:

```tsx
{project && financingEnabledForPortal && (
  <View style={{ marginTop: 12 }}>
    <TouchableOpacity
      testID="client-finance-cta"
      onPress={() => {
        void Linking.openURL(
          `${SUPABASE_FUNCTIONS_URL}/financing-redirect?project=${encodeURIComponent(project.id)}&src=portal`,
        );
      }}
      style={{ backgroundColor: '#1F6FEB', paddingVertical: 12, borderRadius: 10, alignItems: 'center' }}
    >
      <Text style={{ color: '#fff', fontWeight: '700' }}>Finance this project</Text>
    </TouchableOpacity>
    <Text style={{ fontSize: 11, color: '#9AA3AD', marginTop: 6 }}>
      Financing is provided by a third party, subject to credit approval. MAGE ID is not a lender.
    </Text>
  </View>
)}
```

**Visibility gate (`financingEnabledForPortal`):** determine the safest
in-scope signal that the GC enabled financing. In priority order:
1. If `client-view.tsx` already has the GC `AppSettings` in scope (it is
   sometimes used as the GC's own in-app portal preview via `useProjects`),
   use `isFinancingAvailable(settings)` (import it from `@/utils/financing`).
2. Else if the project's portal snapshot/object carries a financing flag,
   use that.
3. Else (true external homeowner, no GC settings, no snapshot flag):
   render the button unconditionally — the edge fn safely 302s to the
   marketing fallback if financing is off, so there is no broken-link
   dead-end, only a slightly-less-ideal "off" experience.

Pick the highest-priority option that is actually available in this file
and wire `financingEnabledForPortal` to it. This is the one genuine
in-situ decision in the plan — resolve it by reading what `client-view.tsx`
actually has in scope; do NOT invent a new data path.

- [ ] **Step 5: Verify** (spec §9.2, §9.3, §9.4)

Run: `npx tsc --noEmit` → clean.
Manual: with financing enabled (Task 8), send an invoice to yourself → the email contains the "Check financing options" block + disclosure; the est. monthly line appears only if example APR+term were set. Tap it → lands on the partner URL with `amount` + `partner_ref` query params (the `financing-redirect` 302). Repeat for an estimate send. Open the client portal → "Finance this project" button + disclosure present; tapping opens the same redirect. Disable financing → none of the three surfaces render the block.

- [ ] **Step 6: Commit**

```bash
git add utils/emailService.ts app/invoice.tsx "app/(tabs)/estimate/index.tsx" app/client-view.tsx
git commit -m "feat(financing): surface offer on invoice + estimate emails and client portal"
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` clean across the whole repo.
- [ ] `npx eslint <changed files>` → 0 errors (pre-existing warnings OK).
- [ ] Full manual walkthrough of spec §9 steps 1–7 end to end.
- [ ] Edge functions deployed and curl-verified (Tasks 6 & 7).
- [ ] Disabled-state check: with `settings.financing` absent/disabled, no financing UI or email block renders anywhere.

## Notes for the executor

- **Spec §5 said referral writes go through `supabaseWrite` (offline queue).** This plan instead uses a direct Supabase insert in `useFinancingReferrals.ensureReferral` because the closest existing analog (`usePortalThread`, same domain: partner/portal Supabase rows + edge-fn callbacks + realtime) uses direct mutations, and an attribution row is non-critical if a rare offline send misses it (the link still works; the redirect fn safe-falls-back). This is a deliberate, spec-consistent refinement, not a deviation in behavior.
- **Amount source:** the plan passes the invoice total / estimate grand total explicitly from each callsite (no `ProjectTargetBudget` object juggling — spec §6's "target budget fallback" was loose; tightened to "caller passes the amount it has; if none/0, the link still works and the figure is hidden", which matches spec §6's stated end behavior).
- Do not collect or store SSN/income/bank data anywhere. The partner-hosted page is the only place applicant data is entered. This is a hard constraint (spec §2).
- **Anonymous portal & RLS:** `financing_referrals` RLS is GC-owner-only (`gc_user_id = auth.uid()`). The authenticated GC paths (invoice/estimate send) create rows via `ensureReferral` and pass the RLS `with check`. The anonymous client portal can't insert under RLS, so its button instead hits `financing-redirect?project=&src=portal` and the **service-role edge fn** find-or-creates the row server-side (Task 6 mode b). No anon writes, no GC settings needed client-side. The only in-situ decision left is the portal button's *visibility gate* (Task 9 Step 4) — a read-only choice among signals already in `client-view.tsx`, with a safe unconditional fallback (edge fn 302s to marketing if financing is off, so never a broken link). Resolve by reading the file; don't invent a data path.
- `crypto.randomUUID()` is used in the Deno edge fn (Task 6 portal mode) — available in the Supabase Edge runtime. The app side uses `generateUUID()` from `utils/generateId.ts`.
