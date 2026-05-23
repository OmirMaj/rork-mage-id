# Client Portal Security Hardening — Access-Token Gate on Key Decisions

**Date:** 2026-05-23
**Status:** Approved (approach A — token-gated decisions, reads stay open; signing token-required immediately)
**Task:** #48. Follow-up to H4a (`20260518120100_portal_write_rpc_hardening.sql`).

## Threat model / gap found

The client/homeowner portal (`mageid.app/portal/<portalId>`) is where clients make **binding decisions** — sign contracts, choose selections, submit budget proposals. Investigation found:

1. **`portalId` is guessable and is the *sole* boundary for decisions.** It's generated as `` `portal-${projectId.slice(0,8)}-${Date.now().toString(36)}` `` (`app/client-portal-setup.tsx:225`) — a short project-id prefix + a base-36 timestamp. Low entropy, brute-forceable.
2. **Passcode is not a server-side gate for decisions.** Per H4a, `portal_sign_contract` only checks the passcode *if supplied*, but the passcode is deliberately never in the snapshot, so the normal client flow passes `p_passcode = null` → the check is a no-op. `portal_choose_selection` has no passcode param at all. **Signing a contract requires only knowledge of the portalId.**
3. **Budget proposals + client messages are anon `INSERT`s** gated only by `is_published_portal(portal_id)` (`20260518120000_rls_baseline.sql`) — again, portalId knowledge = write access.
4. **No rate-limiting** on decision RPCs and **no audit trail** of who made a decision.

**Net:** anyone who guesses a portalId can sign contracts / change selections / submit budget changes on someone else's project. H4a closed the *forgeable-UUID* hole; this closes the *weak-boundary* hole.

## Approved approach

**A — high-entropy access token, verified server-side on decisions; reads stay open.** Existing links keep **viewing**; making a **new** decision requires the token (GC re-shares the link once). **Signing is token-required immediately** (no grace).

## Design

### Access token (server-managed — no client crypto)
- A 192-bit token (`encode(gen_random_bytes(24),'hex')` → 48 hex chars) stored in `projects.client_portal` jsonb as `accessToken`, alongside `portalId`/`passcode`/`enabled`.
- **Generation is entirely server-side** (avoids a new client-crypto/native dependency — the same class of trap the clipboard bug hit):
  - **Backfill migration:** set `accessToken` on every existing portal that has a `portalId` and lacks one.
  - **Sticky `BEFORE INSERT OR UPDATE` trigger** on `projects`: when `client_portal.enabled = true` and the incoming row lacks a token, set it to the **OLD** row's token if present (preserve across app writes), else generate a fresh one. This makes the token sticky and app-write-safe (the app may overwrite `client_portal` wholesale; the trigger preserves the token).
- **The token lives only in the share link** (`…/portal/<portalId>?t=<accessToken>`) and is **never** added to the snapshot (`utils/portalSnapshot.ts`), so fetching the snapshot by portalId cannot leak it.

### Server (migration)
- `portal_sign_contract`: add `p_access_token text`; **reject (`sign_denied`) unless** `p_access_token = v_portal->>'accessToken'`. Enforced immediately (no grace). Keep all existing checks (enabled scope, contract-belongs-to-project, status='sent', server-constructed columns).
- `portal_choose_selection`: add `p_access_token text`; reject (`selection_denied`) on mismatch. Keep existing scope checks.
- **Budget proposals:** add `portal_submit_budget_proposal(p_portal_id, p_access_token, p_amount, p_note)` SECURITY DEFINER RPC that verifies the token + portal-enabled scope and inserts a `status='pending'` row; **drop the permissive anon `INSERT` policy** `"portal can submit proposals"` (mirrors H4a). 
- **Audit + throttle:** new table `portal_decision_audit (id, portal_id, project_id, action, success bool, detail jsonb, created_at)`. Each decision RPC inserts an audit row (success or denial). Lightweight throttle: a decision RPC raises `rate_limited` if there are > 20 failed attempts for that `portal_id` in the last 10 minutes (defense-in-depth; the 192-bit token is already infeasible to brute-force). RLS: GC can read audit rows for their own projects; no anon read.
- **Reads unchanged:** snapshot fetch + `portal_messages` insert stay as-is (backward-compatible viewing + messaging). Messages are communication, not a binding decision, so they remain on the existing `is_published_portal` gate (noted; can be tightened later).
- All RPC grants: `revoke all from public; grant execute to anon, authenticated` (matches H4a).

### Portal HTML (`marketing/portal/index.html`)
- Read `accessToken` from the URL query (`?t=`); keep it in memory (`api.accessToken`).
- Pass it to the decision calls: `portal_sign_contract` (`p_access_token`), `portal_choose_selection` (`p_access_token`), and the new `portal_submit_budget_proposal` RPC (replacing the direct REST insert to `portal_budget_proposals`).
- **Graceful no-token UX:** viewing always works. When `accessToken` is absent (old link) or the RPC returns a denial, decision actions show: "To sign or make selections, ask your contractor to re-send your portal link." (Don't hard-block the UI on load — only the decision action surfaces the message.)

### App (`app/client-portal-setup.tsx`, `utils/portalSnapshot.ts`)
- Read `accessToken` back from the (synced) portal and append `?t=<accessToken>` in `buildShortPortalUrl` (extend its existing `inviteId` query handling) so Copy/Share links carry it.
- If the portal has no `accessToken` yet (not synced server-side), the Copy/Share UI shows "Finalizing secure link…" and disables copy until it's present (the trigger sets it on the next sync). Online enable → token appears within a sync cycle.
- **Do NOT** add `accessToken` to the snapshot payload in `portalSnapshot.ts` (assert via the spec's verification grep).

### Backward-compatibility
- Existing portals: migration backfills a token; existing links (no `?t=`) still **view**; **decisions require the re-shared link**. The GC taps Copy/Share to get the token-bearing link.
- New portals: trigger sets the token on enable; the link carries it from the first share.
- Signing: token-required from day one (no grace), per the approved decision.

## File / change ledger
- **Create:** `supabase/migrations/20260523HHMMSS_portal_access_token.sql` — backfill + trigger + RPC param additions (`portal_sign_contract`, `portal_choose_selection`) + new `portal_submit_budget_proposal` + drop anon budget-insert policy + `portal_decision_audit` table + its RLS.
- **Modify:** `marketing/portal/index.html` — read `?t=`, pass token to the 3 decision calls, graceful no-token UX.
- **Modify:** `app/client-portal-setup.tsx` — token in Copy/Share link + "finalizing" state.
- **Modify:** `utils/portalSnapshot.ts` — `buildShortPortalUrl` appends `?t=`; confirm token never enters the snapshot object.

## Deferred (not this pass)
- High-entropy **portalId** for new portals (read-privacy enhancement; reads are intentionally open under approach A; needs a generation source — do server-side later).
- Tightening `portal_messages` anon insert to token-gated.
- Link **expiry/revocation** UI (rotate `accessToken` to revoke — the trigger already supports regeneration if the field is cleared; a "Revoke & reissue link" button is a fast follow).

## Edge cases
- Old link (no `?t=`): view OK; decision → friendly re-share message; audit logs the denial.
- Wrong/တampered token: RPC denies (`sign_denied`/`selection_denied`); audit logs it; throttle after 20 fails/10 min.
- Passcode-protected portal: passcode remains the existing client-side + edge-fn gate for *viewing*; the access token is the gate for *decisions*. (Passcode + token are independent layers.)
- App offline at enable: token set on sync; Copy shows "finalizing" until present.
- Trigger idempotency: re-saving `client_portal` never churns the token (OLD value preserved).

## Deploy (all confirm-gated — NOT an OTA-only change)
1. **Supabase migration** (`supabase db push` / apply) — backfill + trigger + RPCs + audit table. **Irreversible-ish on prod financial-decision security → explicit confirm before applying.** Reversible notes included in the migration header.
2. **`marketing/portal` Netlify deploy** (build-free `netlify deploy --dir`, per the marketing deploy procedure) — the updated portal HTML.
3. **App OTA** (production, per the just-shipped channel) — `client-portal-setup.tsx` + `portalSnapshot.ts` link change.
Order: apply the migration → immediately deploy the portal HTML → app OTA. The new RPC params default to null for SQL signature compatibility, but the security check **rejects null/mismatched tokens** — so from the moment the migration applies, decisions require a valid token. Expect a brief window where decisions are gated until the portal HTML is live and GCs re-share token-bearing links; that is the fix taking effect (old links intentionally can't sign). Keep the deploy steps close together to minimize it. Reversible notes in the migration header.

## Verification
- Migration applies cleanly on a branch/preview DB; RPCs reject on token mismatch, accept on match; audit rows written; anon budget-insert policy gone.
- `npx tsc --noEmit` clean (app changes).
- Grep: `accessToken` present in `client-portal-setup.tsx` link build + `portalSnapshot.ts` `buildShortPortalUrl`, and **absent** from the snapshot payload object.
- Portal HTML: signing without `?t=` shows the re-share message; with a valid `?t=` succeeds.
- Backward-compat: an existing (pre-token) link still loads the portal view.
