# Security hardening — 2026-07-13 audit → fixes → deploy runbook

Full-app hacker-grade audit (9 attack surfaces, adversarially verified) found **17
confirmed, exploit-verified vulnerabilities**. This is the fix + deploy record.
Branch: **`claude/security-hardening`**. No app JS changed → **no OTA needed**.

## Status at a glance

| # | Finding (sev) | Fix | State |
|---|---|---|---|
| 1 | `award_rfp` RFP hijack via forged `p_homeowner_id` (🔴 crit, 3 live RFPs) | revoke direct grant + `auth.uid()` pin | ✅ **APPLIED to prod** |
| 2 | `portal_snapshots` anon `USING(true)` cross-tenant dump (🔴 crit, LIVE PII leak) | token-gated RPC + revoke anon (part 2) | ⏳ RPCs live+tested; lock staged |
| 3 | `messages` tautological RLS → read all tenants' DMs (🟠 high) | drop broken policy | ✅ **APPLIED** |
| 4 | `match_project_memory` anon IDOR (🟠 high) | revoke anon/auth/PUBLIC grant | ✅ **APPLIED** |
| 5 | `change_order_approvals` anon forgery (🟠 high) | token-gated RPC + drop anon INSERT | ⏳ RPC live; drop staged |
| 6 | `sub_submitted_invoices` fake-invoice injection (🟠 high) | token-gated RPC + drop anon INSERT | ⏳ RPC live; drop staged |
| 7 | og-image DNS-rebinding SSRF (🟡 med) | resolve-and-check + manual redirect | 🔨 built; deploy pending |
| 8 | portal passcode brute-force, no rate limit (🟡 med) | per-portal+IP hourly limit | 🔨 built; deploy pending |
| 9 | `portal_messages` anon injection (🟡 med) | token-gated RPC + drop anon INSERT | ⏳ RPC live; drop staged |
| 10 | project-memory endpoints uncapped Gemini spend (🟡 med) | cap + rate limit + charge | 🔨 built; deploy pending |
| 11 | AI usage counter fails OPEN on DB blip (🟡 med) | fail CLOSED | 🔨 built; deploy pending |
| 12 | worker/companies contact-PII table-wide read (🟢 low, 0 rows) | documented — needs marketplace decision | 📋 deferred |
| 13 | financing-redirect weak length-check gate (🟢 low, dormant) | accessToken check | 📋 deferred follow-up |
| 14 | `portal_budget_proposals` anon injection (🟢 low) | token-gated RPC + drop anon INSERT | ⏳ RPC live; drop staged |
| 15 | public-lead-intake spam, no rate limit (🟢 low) | per-IP+slug limit | 🔨 built; deploy pending |
| 16 | free-tier cap 3-vs-1 + enterprise wrongly capped (🟢 low) | align to 1 + add enterprise | ✅ **APPLIED** |
| 17 | sub_portal_snapshots anon read (🟠 high, 0 rows) | token-gated RPC + revoke anon | ⏳ RPC live; drop staged |

**6 candidate findings were REFUTED by the audit's skeptic pass** (e.g. "forge a JWT to
steal payments" — blocked by `verify_jwt`; unescaped-email-HTML — same-party, no trust
boundary). Not fixed because not exploitable.

## Adversarial review of the fixes (done)

A 6-way skeptic review tried to break each fix. Fail-closed metering + the live portal
RPCs came back **SOUND**; it caught **4 issues in the fixes**, all now fixed + re-verified:
memory cost-metering counted calls not docs (→ per-doc), og-image missed the IPv4-mapped
IPv6 **hex** form (→ decode + DoH fallback + verified `::ffff:a9fe:a9fe` blocked), the
Part-2 lock would have broken the GC's in-app client-view writes (→ owner-scoped authed
INSERT policies added to Part 2), and an awarded project could hit the winner's free cap
(→ exempted). Ship-check green.

## Already applied to prod (verified, reversible)

- **`20260713140000_security_standalone_authz_fixes`** — award_rfp, match_project_memory,
  messages, free-tier trigger. Verified live: grants show service_role-only; messages has
  only the 2 correct policies; free-tier trigger has enterprise + cap-1-excl-samples.
- **`20260713140001_award_rfp_free_cap_exemption`** — awarded projects (`type='awarded_rfp'`)
  bypass the free cap so winning a marketplace job is never blocked. Verified live.
- **`20260713150000_portal_token_rpcs`** (ADDITIVE) — the 7 token-gated portal RPCs +
  `sub_portal_links.access_token`. Live-tested as anon: valid token → snapshot returned,
  wrong token → `portal_denied`, anon can exec RPCs but not the internal helper.

> ⚠️ The staged Part-2 lock now also **adds** two owner-scoped authenticated INSERT policies
> (`gc records client CO approval/message in own portal`) — these must apply with the drops.

## Owner-gated deploy — DO THESE (in order)

### 1. Merge the branch
Agent-authored; needs your merge. `gh pr` or:
```bash
git checkout main && git merge claude/security-hardening
```

### 2. Redeploy edge functions (fail-closed metering + og-image/memory/lead-intake/passcode + verifyUserToken)
The fail-closed AI cost-cap only takes effect on redeploy. All 26 functions importing
`_shared/auth.ts` should be redeployed; at minimum the changed ones. Safe (behavior is
stricter). Deploy all:
```bash
for f in ai analyze-drawings analyze-photos analyze-plan-code analyze-spec-book \
  analyze-takeoff compare-drawings convert-pdf-to-images delete-account financing-redirect \
  import-schedule og-image project-memory-embed project-memory-search public-lead-intake \
  qbo-connect-start qbo-connect-status qbo-sync safety-detect-hazards safety-draft-incident \
  safety-generate-jha scan-anything scan-credential seal-document usage-status \
  validate-portal-passcode; do supabase functions deploy "$f"; done
```
Smoke-test after: `curl -s -o /dev/null -w "%{http_code}" -X POST \
https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/og-image -d '{}'` → expect `401`.

### 3. Portal coordinated deploy (closes the live cross-tenant leak) — DO TOGETHER
The portal HTML must switch to the RPCs **before** the anon table access is dropped.
1. **Deploy the marketing site** (portal + sub-portal HTML). Per the deploy note, mageid.app
   builds are credit-paused → build-free `netlify deploy --dir` + `restoreSiteDeploy`
   (needs your Netlify PAT).
2. **Verify** a real portal share link (with `?t=`) still loads its snapshot + messages.
3. **Apply the lock migration** (drops the anon reads/writes + old tokenless RPCs):
   `20260713150001_portal_lock_direct_access.sql` via Supabase MCP `apply_migration`
   (project `nteoqhcswappxxjlpvap`) — **NOT** `db push`.
4. **Verify** the same portal link STILL loads (now via the RPC only) and that
   `GET /rest/v1/portal_snapshots?select=*` with the anon key now returns `[]`/permission
   denied instead of every tenant's data.

If step 3 is applied without step 1, **every live client portal breaks** — order matters.

## Deferred follow-ups (documented, low urgency)

- **Sub-portal app link `?t=` wiring** — sub-portals are dormant (0 rows). Their DB holes
  are closed by the migration + the sub-portal HTML uses the RPCs, but the app doesn't yet
  put `access_token` in the sub-portal share URL, so sub invoice-submit degrades to the
  existing mailto fallback until wired. To re-enable: add `accessToken` to `SubPortalLink`
  (type + `subPortalLinksQuery` map `r.access_token` + `upsertSubPortalLink` write
  `access_token` + `buildSubPortalUrl` append `?t=`).
- **financing-redirect portal branch** — replace the `length >= 20` check with an
  accessToken match (LOW; feature dormant, 0 rows, no money moves).
- **worker_profiles / companies contact-PII** — table-wide `authenticated` read is a
  marketplace-directory design choice (0 rows today). Expose non-PII columns via a view +
  gate contact details behind a connection/consent flow before the marketplace ships.

## Rollback
Every applied change is reversible: re-`GRANT` the revoked EXECUTE/SELECT/INSERT, re-`CREATE`
a dropped policy, or `CREATE OR REPLACE` the trigger/function back to its prior body (prior
defs captured in the audit output). No data was migrated or deleted.
