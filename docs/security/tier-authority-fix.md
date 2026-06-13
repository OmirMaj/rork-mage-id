# Security fix: subscription tier is now server-authoritative

**Severity:** Critical (privilege escalation / revenue loss)
**Status:** Fix staged on `claude/security-tier-authoritative` — review and deploy deliberately. Nothing here is applied to prod automatically.

## The hole

`public.subscriptions.tier` was the source of truth the edge functions trusted
to gate every paid feature (`supabase/functions/_shared/auth.ts` →
`lookupTier`). But the client wrote that row itself, and RLS only checked
ownership:

```sql
create policy subs_tier_update_own on public.subscriptions
  for update to public using (auth.uid() = user_id);   -- no guard on `tier`
```

So **any** authenticated user could run:

```sql
update subscriptions set tier = 'business' where user_id = auth.uid();
```

…and instantly unlock all Pro/Business features plus inflated AI/vision caps —
for free, forever. There was no RevenueCat webhook making the server
authoritative.

## The fix (three parts)

1. **Migration `20260608120000_subscriptions_server_authoritative_tier.sql`**
   A `BEFORE INSERT/UPDATE` trigger pins `tier` for any `authenticated`/`anon`
   writer: client INSERT → forced `free`; client UPDATE → tier unchanged (no
   self-elevation **and** no self-downgrade, so existing paying users keep what
   they have). `service_role` and direct DB connections set `tier` freely. Also
   adds the missing `WITH CHECK` to the UPDATE policy.

2. **`supabase/functions/revenuecat-webhook`** — the only trusted tier writer.
   Verifies a shared `Authorization` secret, re-reads the subscriber's current
   entitlements from RevenueCat's REST API (authoritative, immune to
   out-of-order events), maps RC `app_user_id` → Supabase `user_id`, and upserts
   `tier` under the service-role key.

3. **Client `Purchases.logIn(userId)`** (`contexts/SubscriptionContext.tsx`) so
   RC's `app_user_id` equals the Supabase user uuid, letting the webhook map
   events to the right row. The client's own tier upsert is now a server-side
   no-op (the trigger ignores it) and is kept only to keep
   `revenuecat_customer_id` linked.

## Deploy order (do NOT skip step 2 — it grants new purchases)

> ⚠️ If you apply the migration **without** the webhook configured, the trigger
> will stop new purchases from granting a tier server-side (existing users are
> unaffected). Deploy them together.

1. **Configure RevenueCat → Project → Webhooks**
   - URL: `https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook`
   - Set an **Authorization header value** (a long random secret).
2. **Set function secrets:**
   ```bash
   supabase secrets set REVENUECAT_WEBHOOK_SECRET='<the header value from step 1>'
   supabase secrets set REVENUECAT_SECRET_API_KEY='sk_<RC v1 secret API key>'
   # SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are already present.
   ```
3. **Deploy the function with JWT verification OFF** (RC sends no Supabase JWT;
   auth is the shared secret):
   ```bash
   supabase functions deploy revenuecat-webhook --no-verify-jwt
   ```
4. **Apply the migration** (review first):
   ```bash
   supabase db push        # or apply 20260608120000_*.sql via your migration flow
   ```
5. **Ship the client** (OTA is fine — JS-only): the `logIn` change.
6. **Verify:** send a RevenueCat **test webhook** (dashboard) and confirm a
   `subscriptions` row updates; then do a sandbox purchase and confirm the tier
   lands server-side and a gated edge function (e.g. `ai` at a Pro feature)
   accepts the account.

## Rollback

Drop the trigger to restore prior behavior (re-opens the hole — only as an
emergency):

```sql
drop trigger if exists trg_enforce_subscription_tier on public.subscriptions;
```

## Note on the master-account override

`utils/owner.ts` `OWNER_EMAILS` / `_shared/auth.ts` `MASTER_EMAILS` are
unaffected — the owner override is resolved before `lookupTier` and does not
depend on the `subscriptions` table.
