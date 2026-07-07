# MAGE ID — Production Handoff & Deploy Checklist (2026-07-07)

Branch: **`claude/deslop-emoji-icons`** (all the de-slop + pre-prod fix work).
Companion docs: `docs/audits/2026-07-07-preprod-audit.md` (findings), `docs/audits/2026-07-06-app-wide-ai-slop-audit.md` (design/slop).

> **Sandbox constraint:** push / PR / merge-to-main and `supabase functions deploy` / `eas update` are **gated to the repo owner** — Claude cannot push, merge, or deploy from this environment. Everything below is prepared and verified as code; the owner runs the ship steps.

---

## 0. Pre-ship gates (run on the branch before merging)

```bash
npx tsc --noEmit          # must be clean
bun run lint
bun run ship-check        # includes the new test:app-slop guard
```

All app-side fixes are verified `tsc`-clean as they land. Edge functions are Deno (not in the node tsc pass) — they validate on `supabase functions deploy`.

---

## 1. Merge to main (owner)

```bash
git push -u origin claude/deslop-emoji-icons
gh pr create --base main --title "Pre-production: de-slop pass + P0/P1 audit fixes" \
  --body-file docs/deploy/2026-07-07-production-handoff.md
# review, then merge
```

**Runtime-version note (from CLAUDE.md):** keep `expo.version` stable so JS-only changes ship over OTA. **No new native modules were added** in this pass (the offline reconnect deliberately stayed pure-JS), so the app layer is OTA-shippable — no new native build required for these fixes.

---

## 2. Deploy edge functions (owner) — required for the server fixes to take effect

Project `nteoqhcswappxxjlpvap`. Use `supabase functions deploy <name>` (or the Supabase MCP `deploy_edge_function`).

**Wave 1 (P0):**
```bash
supabase functions deploy stripe-webhook
supabase functions deploy analyze-drawings analyze-photos analyze-takeoff compare-drawings analyze-spec-book
supabase functions deploy homeowner-weekly-digest morning-digest
```

**Wave 2 (P1):**
```bash
# requireTier now VERIFIES the JWT server-side (via GoTrue) — redeploy every
# function that imports _shared/auth.ts, plus award-rfp:
supabase functions deploy award-rfp analyze-drawings analyze-photos analyze-takeoff compare-drawings analyze-spec-book analyze-plan-code convert-pdf-to-images
# (redeploy any OTHER function that imports _shared/auth.ts — grep to confirm the full set)
supabase functions deploy homeowner-weekly-digest   # preview no longer suppresses the Friday send
```
> **Behavior change (auth-jwt):** `requireTier`/`award-rfp` now make one GoTrue `/auth/v1/user` round-trip per call (fail-closed → 401 on any error). This rejects any server-to-server caller that was authenticating these with the **service-role** key instead of a user JWT. None was found in the audit — but confirm before deploy. Each function needs `SUPABASE_ANON_KEY`/`ANON_KEY` in its env (already required elsewhere).

**Static sites (Netlify):**
- Marketing (`marketing/`): redeploy to publish the mobile-nav + demo-page fixes.
- Client portal (`marketing/portal/`): redeploy (build-free `netlify deploy --dir`) for the closeout-binder print fix.

---

## 3. Stripe dashboard (owner — manual, cannot be scripted)

The webhook fix assumes a **Connect-enabled** endpoint. In the **production** Stripe dashboard:
- Confirm the webhook endpoint has **"Listen to events on connected accounts"** enabled (or is a dedicated Connect webhook).
- Confirm it's subscribed to: `checkout.session.completed`, `account.updated`, `account.application.deauthorized`.
- Test end-to-end with a **real connected-account payment** and confirm the invoice reconciles to `paid`.
> Without this, a standard endpoint receives **none** of these events and no invoice ever reconciles.

---

## 4. `supabase/config.toml` — `verify_jwt` pinning (owner review, deferred deliberately)

The audit recommends committing `supabase/config.toml` pinning `verify_jwt = true` for every `requireTier`-gated function + `award-rfp`, so a deploy can't silently flip it. **This was NOT auto-applied** — a wrong per-function entry breaks that function's auth model (webhook/cron/magic-link/anon-RPC functions must stay `verify_jwt = false`), and deploys can't be tested from the sandbox. The real protection (server-side JWT verification **in code**, in `requireTier`) is implemented in Wave 2. Treat the `config.toml` pinning as a reviewed defense-in-depth follow-up: categorize each function (user-gated → true; webhook/cron/service/anon → false) and commit deliberately.

---

## 5. Post-deploy verification (smoke the fixed paths)

- **Offline:** put a device in airplane mode, create DFRs/change orders, lock/unlock ~5×, restore signal → all writes flush, nothing lost.
- **Invoice:** issue an invoice, record a partial payment, re-send the pay link → new link charges the **remaining** balance; change the global tax rate in Settings → an already-issued invoice's total is **unchanged**.
- **Payments:** real Connect payment reconciles (see §3); simulate a transient DB error → Stripe retries (500), no stranded payment.
- **Security:** call a vision function with a `169.254.169.254` / non-allowlisted URL → generic 400; call `homeowner-weekly-digest` with another GC's `projectId` as a non-owner → 403; retry with `{all:true}` as non-cron → 403.

---

## 6. Deferred (per owner decision: P0+P1 now, polish later)

- **P2/P3 backlog** (33 P2 + 4 P3) — see `docs/audits/2026-07-07-preprod-audit.md`: AI-metering hardening (fail-closed caps, increment-after-success, per-feature counters), atomic invoice-payment append, token-adoption codemods, marketing copy/tier-table fixes, remaining marketing glassmorphism (`styles.css`/`landing.css` header `backdrop-filter`), etc.
- **Native-build item:** NetInfo/expo-network reachability listener for **instant** offline-queue reconnect (currently an OTA-safe backoff drain). Requires a native build — bundle with the next `eas build`.

### Surfaced by the final pre-merge review (deferred, not blocking)
- **Offline cross-tenant flush race** — `OfflineMutation` carries no `user_id`, so an in-flight flush that already read user A's queue can commit under user B's JWT (RLS stamps `auth.uid()=B`). Strictly better than pre-branch (magic-link previously did no wipe at all). Proper fix: tag each mutation with the enqueuing user id and have `processOfflineQueue` skip mutations whose `user_id` ≠ current session user — this also fully closes the wipe-vs-flush ordering race.
- **CPM lag edge case** — `esFromTargetEf`/`lfFromTargetLs` (`utils/cpm.ts:251-273`) under-constrain FF/SF/SS links whose *lag* lands the target exactly on a non-working day (rounds down, finishing one working-day short). Narrow: only non-FS links with a lag hitting a weekend/closure on a non-7-day calendar; FS and lag=0 are verified.
- **Draft tax-rate lock** — the immutability now also applies to *unsent drafts*, so a draft won't pick up a corrected global tax rate on reopen (`app/invoice.tsx`). Not a money bug (drafts are never charged). Gate on `status!=='draft'` if draft mutability is wanted.
- **Notification/messaging with `HIRE_ENABLED=false`** — a message push deep-link lands on the "coming soon" screen (graceful, not a crash); the client/property-owner persona has no messaging nav (consistent with the launch decision). Confirm intended; wire a client rail to `/client-messages` if client↔contractor messaging is meant to ship.
