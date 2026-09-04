# Auth / tenancy / portals / privacy — final-push audit — 2026-09-03

Domain: authentication, session handling, tenancy on the client, the client and sub portals and
share links, and privacy (what leaves the tenant boundary, what gets logged, what a portal viewer
can see). Repo read-only; production access was SELECT-only SQL, read-only log queries, and two
unauthenticated HTTP probes that are rejected at the gateway (no side effects).

Headline: **no cross-tenant exposure found (0 × P0).** The two tokenless legacy RPCs
(`get_portal_snapshot`, `get_sub_portal_snapshot`) are locked to `postgres/service_role` in
production (live `has_function_privilege` = false for anon and authenticated), every portal read
and write RPC checks the 192-bit access token, `portal_snapshots`/`sub_portal_snapshots` have no
anon SELECT grant, and `project-invite` is gateway-verified. What is wrong sits one level in: data
that survives account deletion, a field role whose blinding is void until phase 2, a dead
homeowner feature, an incomplete privacy policy, and share links that can neither expire nor be
rotated.

## Scope covered (files/paths actually read; commands run)

Read end to end: `lib/supabase.ts`, `contexts/AuthContext.tsx`, `utils/localCacheKeys.ts`,
`utils/owner.ts`, `utils/portalSnapshot.ts`, `utils/subPortalSnapshot.ts`,
`utils/publicProfileSnapshot.ts`, `utils/clientEstimateShareToken.ts`, `utils/photoShareToken.ts`,
`utils/planShareToken.ts`, `utils/collaboratorAccess.ts`, `utils/projectRole.ts`,
`utils/roleBlinding.ts`, `utils/analytics.ts`, `utils/posthog.ts`, `hooks/usePortalSnapshot.ts`,
`hooks/useProjectRole.ts`, `hooks/useProjectAccess.ts`, `hooks/useProjectCollaborators.ts`,
`hooks/useAccountSeats.ts`, `app/accept-invite.tsx`, `supabase/functions/auth-magic-link`,
`project-invite`, `validate-portal-passcode`, `delete-account`, `mcp-token`, `mcp` (auth + tool
list), `_shared/auth.ts`, `_shared/verifyUser.ts`, `_shared/mcpToken.ts`, `schedule-ical-url`.
Read in the relevant regions: `app/_layout.tsx` (Sentry init, magic-link handler, analytics
identify/reset, route classification), `app/login.tsx`, `app/signup.tsx`, `app/reset-password.tsx`,
`app/persona-select.tsx`, `app/client-view.tsx`, `app/client-portal-setup.tsx`,
`app/sub-portal-setup.tsx`, `app/sub-portals.tsx`, `app/connect-claude.tsx`, `app/data-export.tsx`,
`app/public-profile-setup.tsx`, `app/project-detail.tsx`, `contexts/ProjectContext.tsx` (projects
query/merge, persona, `upsertSubPortalLink`), `contexts/SubscriptionContext.tsx` (RC identity),
`hooks/usePortalThread.ts`, `components/ErrorBoundary.tsx`, `utils/offlineQueue.ts` (Sentry
capture), `marketing/portal/index.html` and `marketing/sub-portal/index.html` (gate, token, fetch
headers, referrer/analytics), `marketing/builders/index.html`, `marketing/privacy.html`,
`netlify.toml`, `scripts/validate-account-deletion.ts`, `supabase/functions/portal-ask-home`,
`portal-mark-viewed`, `schedule-ical`, `og-image`, `transcribe-audio`, `homeowner-weekly-digest`
(logging + prompt), `types/index.ts` (portal/selection/invoice types),
`supabase/schema.sql` (all portal/share/collaborator/profile DDL, every policy on those tables,
FK map to `auth.users`/`projects`, and the bodies of every `portal_*`, `sub_portal_*`,
`get_*_by_token`, `is_project_collaborator`, `can_access_project`,
`can_view_project_financials`, `fetch_shared_schedule`, `submit_sub_change_request` function).
Closed-audit docs consulted for de-duplication: `docs/audits/2026-08-31-medium-sweep.md`,
`docs/audits/2026-09-02-launch-readiness.md`, `docs/START-HERE.md` banner.

Commands / production reads: `grep`/`awk`/`python3` over the repo and `schema.sql`; Supabase MCP
`execute_sql` (SELECT only): function ACLs via `has_function_privilege`, table RLS flags and
`role_table_grants`, row/orphan counts on portal tables, legacy-estimate and collaborator counts;
`list_edge_functions` (deployed `verify_jwt` per function); `query_logs` (which request fields
`function_edge_logs` record); two `curl` POSTs to `portal-ask-home` (one with no auth header,
one with the public anon key) to observe gateway vs function behaviour.

## Findings (ranked; most severe first)

### F1 — P1 CONFIRMED — Account deletion leaves client and sub PII behind: `portal_messages` is filtered by a `user_id` column the table does not have, and nine more tables have no deletion path at all
- Where: `supabase/functions/delete-account/index.ts:84` (`'portal_messages'` in `USER_SCOPED_TABLES`), `:267` (`.delete().eq('user_id', userId)`), `:271-274` (error appended to `tableErrors`, loop continues, `success: true` returned at `:423-427`); `supabase/schema.sql:1339-1351` (`portal_messages` columns: `id, portal_id, project_id text, invite_id, author_type, author_name, author_email, body, …` — no `user_id`); FK map `schema.sql:2326-2445`; `scripts/validate-account-deletion.ts:61-83`.
- Evidence: PostgREST rejects `portal_messages?user_id=eq.<uuid>` with "column portal_messages.user_id does not exist"; that string does not match `/relation .* does not exist/`, so it lands in `tableErrors` and deletion reports success. Computed from `schema.sql` (tables with neither an `auth.users … ON DELETE CASCADE` FK, nor a `projects` CASCADE chain, nor an explicit delete in the function): `change_order_approvals` (`signer_name`, `signer_email`, `signature_data`), `sub_submitted_invoices` (`submitted_by_name/email`), `portal_budget_proposals` (`proposer_name`), `portal_decision_audit` (signer detail), `notification_outbox` (`recipient_email`, `payload`), `memory_embeddings` (`content` = embedded project documents), `rate_overrides`, `ai_daily_usage`, `email_unsubscribes` (suppression list — arguably must persist), `conversations`. Live (SELECT): `portal_messages` = 10 rows, **2 already orphaned** (no project carries their `portal_id`); `notification_outbox` = 128 rows; `ai_daily_usage` = 17. The validator only enumerates FKs to `auth.users`, so a table with no FK is invisible to it (rule 5 in the brief).
- Failure scenario: a GC deletes their account. Every homeowner message thread (names, bodies), every e-signed CO approval (signature image + signer name), every sub-submitted invoice (sub email) and every queued notification email survive as unowned rows; the in-app "Delete Account" promise and the privacy policy's "delete your data" commitment are both false. Apple exercises 5.1.1(v) at review.
- Fix: before step 2 in `delete-account`, resolve the caller's portal ids (`select client_portal->>'portalId' from projects where user_id = …`), project ids, and sub-portal ids, then delete `portal_messages`, `change_order_approvals`, `portal_budget_proposals`, `portal_decision_audit` by `portal_id in (…) or project_id in (…)`, `sub_submitted_invoices` by `sub_portal_id in (…)`, `notification_outbox` by `recipient_user_id = …` (and `source_id` in the caller's rows), and `memory_embeddings`/`rate_overrides`/`ai_daily_usage` by `user_id` (or add `ON DELETE CASCADE` FKs by migration). Extend `validate-account-deletion.ts` to enumerate every `CREATE TABLE public.*` and require one of {auth CASCADE, projects CASCADE chain, explicit delete}.
- Effort: M

### F2 — P1 CONFIRMED — The `field` role's "no costs or margins" promise is void: RLS hands every collaborator the whole `projects` row, and the app falls back to the legacy estimate columns exactly for the users `project_financials` was built to exclude
- Where: `supabase/schema.sql:3421-3422` (`projects_select … USING ((auth.uid() = user_id) OR is_project_collaborator(id))`; `is_project_collaborator` `:4586-4599` admits any accepted role when `min_role` is the default `'viewer'`); `contexts/ProjectContext.tsx:566-568` (`.from('projects').select('*')`), `:569-575` (comment: "RLS returns ZERO rows here for a field user … their projects simply arrive with no estimate. Failure is non-fatal — we fall back to the legacy columns"), `:590-591` (`const pick = (key, legacy) => f && f[key] != null ? f[key] : legacy`), `:600` (`estimate: pick('estimate', r.estimate)`); `app/project-detail.tsx:1432` (`heroTotal = effectiveEstimateTotal(project)`), `:1477-1486` ("Total Estimate" card renders `heroTotal`), `:1161`, `:1271`, `:2017`, `:2088` (`formatMoney(estimate.grandTotal)` / `linkedEstimate.grandTotal`); `utils/roleBlinding.ts:58` (picker copy "Field — Schedule & field work — no costs or margins").
- Evidence: `can_view_project_financials` (`schema.sql:4035-4053`) correctly excludes `'field'` from `project_financials`, but RLS is row-level; the same field user reads `projects.estimate`, `linked_estimate`, `estimate_versions`, `target_budget` through `projects_select`, and `pick()` returns the legacy value precisely when the financials row is absent. Live: 3 of 7 projects still carry non-null legacy `estimate`/`linked_estimate` JSON (phase 2 not applied — a recorded decision whose consequence here is not recorded). The only client-side gates are `components/ProjectHero.tsx:90` and `app/job-costing.tsx:173`; `project-detail.tsx` has zero role checks (grep). Production has 0 collaborator rows today, so there is no live victim yet.
- Failure scenario: GC (Pro) invites a foreman as Field → foreman opens the project → the hero card prints "Total Estimate $184,300", the linked-estimate section lists every line with unit cost and markup, and the estimate is written into the foreman's `mageid_projects` cache.
- Fix (smallest): in `ProjectContext.tsx:590-600` only apply the legacy fallback when `r.user_id === userId` (owned project); for collaborator rows set `estimate/linkedEstimate/estimateVersions/targetBudget` to `undefined` when `project_financials` returned nothing. Then gate the money sections of `project-detail.tsx` on `canViewFinancials(useProjectRole(id))`. Keep phase 2 as planned.
- Effort: S (context) + S (screen gate)

### F3 — P1 CONFIRMED — The privacy policy omits processors that receive personal data: Sentry (crash reports **and 10 % session replay**), the third-party speech-to-text proxy, CloudConvert, Google/OSM geocoders, OpenWeather, Intuit, Pexels, Netlify
- Where: `marketing/privacy.html:85-96` (Third-Party Services: Supabase, Stripe, RevenueCat, PostHog, Resend, Apple/Google, "Google (Gemini) and other AI processing vendors"); `app/_layout.tsx:132-163` (`Sentry.init` with `mobileReplayIntegration()`, `replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1`); `supabase/functions/transcribe-audio/index.ts:34` (`STT_ENDPOINT = 'https://toolkit.rork.com/stt/transcribe/'` — every voice recording is forwarded there); vendor inventory from `supabase/functions` (`api.cloudconvert.com` ×2, `maps.googleapis.com` ×3, `nominatim.openstreetmap.org` ×2, `*.intuit.com` ×5, `api.pexels.com`, `api.openweathermap.org`, `api.anthropic.com`); client side `utils/geocodeProject.ts:23` (Nominatim gets project/client addresses), `utils/weatherService.ts:176`.
- Evidence: `grep -ci` on `privacy.html` for sentry, replay, cloudconvert, rork, geocod, openstreetmap, openweather, intuit, pexels — all 0. Replay masks text/images by default, but recording screens at all is a disclosure item under GDPR/CCPA and Apple's privacy nutrition label. `delete-account/index.ts:23-24` still claims "no event logging tool" while PostHog is live (documents lie).
- Failure scenario: a homeowner's address goes to Google Maps/Nominatim, a GC's voice notes go to a vendor never named, and 1 in 10 sessions is recorded — none of it disclosed. Any privacy complaint or App Review question is unanswerable from the published policy.
- Fix: enumerate the processors above in `privacy.html` (purpose + data category each), add a "Diagnostics and session replay" paragraph, and consider `replaysSessionSampleRate: 0` until the disclosure ships. Effort: S

### F4 — P1 CONFIRMED — "Ask Your Home" on the static homeowner portal is dead: the function is deployed `verify_jwt: true` but the page sends no JWT, so the gateway returns 401 before the function runs
- Where: `marketing/portal/index.html:4043-4047` (`fetch(base + '/functions/v1/portal-ask-home', { method:'POST', headers: { 'Content-Type': 'application/json' }, … })`); deployed config (`list_edge_functions`): `portal-ask-home` → `verify_jwt: true`; `supabase/functions/portal-ask-home/index.ts:3-4` ("Anonymous (no JWT) — authenticated by the … accessToken").
- Evidence (live probe): POST with no `Authorization` → `401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}`; the same POST with the public anon key as Bearer → the function runs and answers `{"success":false,"error":"Invalid portal link"}` for a bogus token. Compare `validate-portal-passcode`, which the same page calls correctly with `apikey` + `Authorization: Bearer <anon>` (`index.html:6709-6713`).
- Failure scenario: homeowner types "what paint did we use in the primary bath?" → the page maps the 401 to the generic error state every time. The feature is advertised in the portal and never works.
- Fix: add the two headers (`api.supabaseAnonKey` is already in the snapshot's `portalApi`) — three lines in `index.html` — or redeploy the function with `--no-verify-jwt` to match its design. Effort: S

### F5 — P2 CONFIRMED — Any accepted collaborator (field, viewer, editor) can act as the homeowner: the portal access token and passcode ride inside the `projects` row every collaborator can read
- Where: `contexts/ProjectContext.tsx:607` (`clientPortal: r.client_portal` for every row `projects_select` returns); `types/index.ts:2966-2970` (`ClientPortalSettings.passcode`, `.accessToken`); write RPCs that authenticate by that token alone: `portal_sign_contract` `schema.sql:4943-4990`, `portal_submit_co_approval_signed` `:5034+`, `portal_post_message` `:4876-4893`, `portal_choose_selection` `:4733-4773`.
- Evidence: live, 3 projects carry an `accessToken`; RLS is row-level so the JSON column is not blindable. `signer_name` in the audit rows is free text.
- Failure scenario: a sub invited as Field reads the token from the project cache, opens `mageid.app/portal/<id>?t=<token>`, and approves a change order with an e-signature "as the client".
- Fix: move `accessToken` (and `passcode`) out of `client_portal` into a column the owner alone can read (column-level `REVOKE SELECT … FROM authenticated` plus an owner-only RPC that returns it), and strip both keys in the collaborator mapping meanwhile. Effort: M

### F6 — P2 CONFIRMED — A revoked collaborator (or a project deleted elsewhere) keeps the project on the device indefinitely: the projects loader union-merges the local cache with the server and re-persists it
- Where: `contexts/ProjectContext.tsx:620-628` ("Merge in any local-only projects the server doesn't have yet…" → `const merged = [...mapped, ...localForMerge.filter((p) => !remoteIds.has(p.id))]; await saveLocal(PROJECTS_KEY, merged);`).
- Evidence: `project-invite` `revoke` sets `status: 'revoked'` (`index.ts:291-296`) and RLS then hides the project, but the loader treats "server no longer returns it" as "created offline, keep it". Only a sign-out wipes it (`AuthContext.tsx:638`).
- Failure scenario: GC removes a foreman; the foreman's phone keeps the schedule, client name and address, portal token (F5) and — until F2 is fixed — the estimate, refreshed into the cache on every launch. Same mechanism resurrects a project the owner deleted from another device.
- Fix: keep only local projects that are genuinely pending (an `offlineQueue` entry for that id, or a `pendingSync` flag set at create time); everything else follows the server. Effort: S

### F7 — P2 CONFIRMED — Portal link expiry is cosmetic: only `portal_get_snapshot_v2` checks `expires_at`; the `#d=` hash path and every write RPC ignore it
- Where: `schema.sql:4809-4840` (v2 checks `expires_at`), `:4896-4908` (`portal_project_for_token` — no expiry clause; used by messages, budget proposals, CO approvals, mark-viewed, ask-home), `:4943-4990` and `:4733-4773` (sign contract / choose selection query `projects` directly); `hooks/usePortalSnapshot.ts:147-151` (inline `#d=` snapshot returned with no server check); `marketing/portal/index.html:2898` and `marketing/sub-portal/index.html:735` (hash decoded first); `expires_at` exists only on `portal_snapshots` (`schema.sql:1358`), not on `client_portal`.
- Failure scenario: GC picks "7 days" (`utils/portalLinkExpiry.ts`), shares the long link from the Share sheet; on day 30 the homeowner still sees everything and can still e-sign a CO, post messages and pick selections.
- Fix: check `portal_snapshots.expires_at` inside `portal_project_for_token` and in the two RPCs that bypass it; embed `expiresAt` in the snapshot and have both viewers refuse to render past it. Effort: S

### F8 — P2 CONFIRMED — A leaked homeowner or sub-portal link cannot be revoked or rotated; disabling and re-enabling restores the same token
- Where: `schema.sql:4924-4941` (`portal_set_access_token` only fills an empty token and on UPDATE reuses `old.client_portal->>'accessToken'`); `app/client-portal-setup.tsx:380-387` (heal only when missing); `contexts/ProjectContext.tsx:4400+` (`if (link.enabled && !link.accessToken) { const token = … }` — mint only when missing); `app/sub-portal-setup.tsx:548-554` ("Disable to revoke the link" toggles `enabled` only).
- Evidence: no UI or RPC writes a new token; the trigger even reuses the old value when the client writes `''`.
- Failure scenario: homeowner forwards the link to a neighbour shopping for contractors; the GC's only remedy is to disable the portal for the homeowner too, and re-enabling hands the neighbour the same key back.
- Fix: "Regenerate link" that writes a fresh 24-byte hex token explicitly (client-generated, or an owner-only `portal_rotate_access_token(project_id)` RPC) and re-pushes the snapshot; same for `sub_portal_links.access_token`. Effort: S

### F9 — P2 CONFIRMED — The sub-portal passcode is theatre: it is serialized into the URL hash and the server snapshot, emailed in the same message as the link, and compared client-side
- Where: `utils/subPortalSnapshot.ts:170-171` (`requirePasscode: link.requirePasscode, passcode: link.requirePasscode ? link.passcode : undefined`); `marketing/sub-portal/index.html:1258` (`if (!data.requirePasscode || !data.passcode) { onPass(); … }`) and `:1268` (`String(input.value).trim() === String(data.passcode).trim()`); `app/sub-portal-setup.tsx:310-312, 326` (email: "Your passcode is <strong>${link.passcode}</strong> — keep it private."), `:569` (default `Math.floor(1000 + Math.random() * 9000)`).
- Evidence: the client portal already closed this exact class (`utils/portalSnapshot.ts:121-125`, `validate-portal-passcode`); the sub portal did not. Live: 0 sub links today.
- Failure scenario: GC enables "Require passcode" believing a forwarded link is useless without the code; the code is base64 in the link and printed in the email beside it.
- Fix: omit the passcode from the snapshot, validate through an edge function/RPC against `sub_portal_links.passcode` (generalise `validate-portal-passcode` with `kind: 'sub'`), and drop it from the email. Effort: S/M

### F10 — P2 CONFIRMED — The public portfolio page publishes the client's street address with no opt-out
- Where: `utils/publicProfileSnapshot.ts:115` (`address: project.location`), `:40` and `:122` (`hideStats` limited to `'value' | 'duration' | 'sqft'`); `marketing/builders/index.html:490` (`if (project.address) metaParts.push(esc(project.address))`); `app/public-profile-setup.tsx:255-267` (only those three toggles).
- Failure scenario: GC publishes a finished kitchen at `mageid.app/builders/<gc>/<project>`; the homeowner's home address is rendered on a public page and embedded in every copy of the URL.
- Fix: add `'address'` to `hideStats`, default hidden (or reduce to city/neighbourhood). Effort: S

### F11 — P2 CONFIRMED — On iOS/Android the Supabase session (access + refresh token) sits in plaintext `AsyncStorage`, and the auth flow is implicit (no PKCE), while the password itself is in SecureStore
- Where: `lib/supabase.ts:35-41` (`auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: Platform.OS === 'web' }` — no `flowType`); `contexts/AuthContext.tsx:333-346` (password → `SecureStore`).
- Evidence: AsyncStorage on native is an unencrypted SQLite/manifest file inside the app container and is included in device backups; a refresh token is as powerful as the password it protects. Magic-link/recovery tokens arrive in URL fragments (`_layout.tsx:196-216`, `reset-password.tsx:35-40`) — not server-logged, but PKCE would make an intercepted link useless.
- Failure scenario: an unencrypted Finder/iTunes backup, or a file-system read of a lost device, yields a live rotating refresh token.
- Fix: Supabase's documented chunked SecureStore adapter for native storage; `flowType: 'pkce'`. Effort: S

### F12 — P2 CONFIRMED (latent) — The RN `client-view` route writes homeowner decisions straight to tables `anon` cannot INSERT, then tells the visitor "We saved your response locally"
- Where: `app/client-view.tsx:733-735` (comment "RLS allows anon INSERT when portal_id matches…"), `:738-767` (`.from('change_order_approvals').insert(…)`), `:783-786` (fallback copy); `hooks/usePortalThread.ts:165-175` (`sendClientMessageMutation` inserts `author_type: 'client'`).
- Evidence (live grants): `change_order_approvals`, `portal_messages`, `portal_budget_proposals` grant `anon` SELECT/UPDATE/DELETE but **no INSERT**, and every INSERT policy is `TO authenticated` (`schema.sql:2910-2913, 3333-3336`). Reachability today: `PORTAL_BASE_URL = 'https://mageid.app/portal'` (`client-portal-setup.tsx:55`), so homeowner links go to the static page (which correctly uses the RPCs); only the GC's own preview (`:907`) reaches `client-view` and passes RLS as owner. `_layout.tsx:386-395` and `usePortalSnapshot.ts:1-31` nonetheless define this route as the anonymous homeowner viewer.
- Failure scenario (the moment the route is handed to a homeowner): e-signature captured → insert 401 → "Approved … We saved your response locally" → nothing is saved anywhere; the GC never sees it.
- Fix: when there is no session, call `portal_submit_co_approval_signed` / `portal_post_message` (already anon-executable) instead of table inserts; delete the misleading comment. Effort: S

### F13 — P2 LIKELY — The calendar-feed HMAC falls back to a hard-coded secret when `SCHEDULE_ICAL_SECRET` is unset, and the two inputs the token binds are obtainable from any portal link
- Where: `supabase/functions/schedule-ical-url/index.ts:17-18` and `schedule-ical/index.ts:29-30` (`Deno.env.get('SCHEDULE_ICAL_SECRET') ?? 'mage-id-ical-fallback-rotate-on-leak'`); token = `HMAC(scheduleId:userId)` truncated to 16 chars; `utils/portalSnapshot.ts:1122` (`project: { id: project.id … }` in every homeowner snapshot); `gc_for_portal(p_portal_id)` is anon-executable (live ACL) and returns the owner's uid; feed content `schedule-ical/index.ts:149, 162` (task titles + `Crew:`).
- Unverified link: whether the secret is set. It appears in no runbook or checklist (`LAUNCH-CHECKLIST.md`, `DEPLOY-RUNBOOK.md`, `DEPLOY-VERIFIED-2026-09-02.md`) — only in `docs/superpowers/plans/2026-05-12-pro-scheduler-redesign.md:2485`. Verify with `supabase secrets list --project-ref nteoqhcswappxxjlpvap`.
- Failure scenario (if unset): anyone holding a portal link computes the feed token and subscribes to the full schedule — task titles, crew and sub names the portal deliberately withholds.
- Fix: fail closed (500) when the env var is missing; set the secret; consider revoking anon EXECUTE on `gc_for_portal` after confirming its callers run as service role. Effort: S

### F14 — P3 CONFIRMED — MCP personal access tokens travel in the URL and edge logs record the request path/URL
- Where: `app/connect-claude.tsx:134` (`${MCP_URL}?token=${freshToken}`); `supabase/functions/mcp/index.ts:65-69` (accepts `?token=` and a trailing path segment); live `function_edge_logs` rows carry `request.pathname`, `request.url` and `request.search`; token lifetime 1 year (`schema.sql:1131`).
- Fix: default the UI to the header form; if the URL form must stay for claude.ai connectors, shorten expiry and note that logs hold the token. Effort: S

### F15 — P3 CONFIRMED — `submit_sub_change_request` is anon-executable, SECURITY DEFINER, and cannot run
- Where: `schema.sql:5519-5557` (reads `spl.sub_portal_id`, `spl.sub_name`, joins `p.id = spl.project_id` uuid=text); `sub_portal_links` DDL `:1850-1864` has none of those columns; live ACL `anon_exec = true`.
- Fix: drop it (or rewrite token-gated like `sub_portal_submit_invoice`). Effort: S

### F16 — P3 CONFIRMED — The weekly digest logs the homeowner's email address
- Where: `supabase/functions/homeowner-weekly-digest/index.ts:408` (`console.log('… recipient unsubscribed — skipping', project.id, invite.email)`). Same class as closed launch-readiness #16. Fix: log the invite id. Effort: S

### F17 — P3 CONFIRMED — Sign-out never calls `Purchases.logOut()`; RevenueCat stays identified as the previous account until the next user's `logIn`
- Where: `contexts/SubscriptionContext.tsx:205-218` (`Purchases.logIn(userId)` on sign-in); no `logOut` anywhere (grep). Fix: `Purchases.logOut()` in `AuthContext.logout`. Effort: S

### F18 — P3 CONFIRMED — The accept-invite token stash is wiped by the login sweep, so the promised auto-accept never fires
- Where: `app/accept-invite.tsx:23, 39` (`mageid_pending_invite`), `:62-65` (auto-accept only from `status === 'idle'`, which is already `'signin'`); `contexts/AuthContext.tsx:504` (`wipeLocalUserCache()` in `login()`), `utils/localCacheKeys.ts:35` (`mageid_` prefix swept); `app/login.tsx:136` (`router.replace('/(tabs)/summary')`). The screen's copy already tells the invitee to re-open the link, so the flow works; the stash is dead code. Fix: replay `/accept-invite?token=` after sign-in via the pending-deep-link mechanism. Effort: S

### F19 — P3 LIKELY — The magic-link email says "no account will be created" while `admin.generateLink({ type: 'magiclink' })` provisions one
- Where: `supabase/functions/auth-magic-link/index.ts:151` vs `:122-126`; `contexts/AuthContext.tsx:761-763` relies on exactly that auto-creation. Unverified link: GoTrue version behaviour. Fix: check user existence with the admin API first and send a distinct "no account" template, or reword. Effort: S

## ADD / CONNECT / DO BETTER (ranked by leverage)

### O1 — Publish privacy commitments the code can keep — leverage: trust is the sale for a GC handing a homeowner a portal link; today several natural promises are false — evidence of the gap: `marketing/privacy.html:85-96`, F1–F3, F7–F9 — sketch:
Commitments to make, with what must change first:
- "Deleting your account deletes what your clients and subs sent you" — false (F1).
- "Field crew never see your numbers" — false until F2 + phase 2.
- "Your client's data is not sent to AI vendors unless you use an AI feature on it, and here is the list" — currently: project name + address + daily-report text → Gemini (`homeowner-weekly-digest/index.ts:197-227`, `utils/weeklyClientUpdate.ts:74`, `utils/aiService.ts:134,286,1320`), homeowner questions + project memory → Gemini (`portal-ask-home`), worker credential images → Gemini Vision (`scan-credential`), voice → Rork (`transcribe-audio`), plan PDFs → CloudConvert, addresses → Google/Nominatim. Name them; commit that only the GC-curated `portalState:'sent'` items feed homeowner-facing prompts (already true for the pay-app narrative, `portalSnapshot.ts:963-966`).
- "We don't record your screen" — false while replay sampling is 0.1 (F3); either disclose or set to 0.
- "Links expire when you say and can be cut off" — false (F7, F8).
- "A passcode never travels with the link" — true for the client portal, false for the sub portal (F9).
- "Your session lives in the device keychain" — false (F11).

### O2 — One choke point for portal trust: `portal_project_for_token` checks token + enabled + expiry, and every RPC/edge function calls it — leverage: closes F7 and half of F5 in one migration — evidence of the gap: `schema.sql:4896-4908` vs `:4943-4990`, `:4733-4773` (two RPCs re-implement the check without it) — sketch: add `and coalesce((select expires_at from portal_snapshots ps where ps.portal_id = p_portal_id), 'infinity') > now()`; rewrite `portal_sign_contract` / `portal_choose_selection` to call it; add `portal_rotate_access_token(project_id)` owner-only for F8.

### O3 — Account-deletion coverage guard that cannot go blind — leverage: F1 is the third deletion gap found in a month; each was a table nobody listed — evidence: `scripts/validate-account-deletion.ts:61-83` enumerates FKs, not tables — sketch: parse every `CREATE TABLE public.*` in `schema.sql`, require {auth CASCADE | projects CASCADE chain | explicit delete in `USER_SCOPED_TABLES` or a `PORTAL_SCOPED_DELETES` map}, fail `ship-check` otherwise; allow-list reference tables explicitly.

### O4 — App lock + background privacy overlay — leverage: the app shows margins, client addresses and signed contracts; `expo-local-authentication` is already a dependency and used only to replay the password (`app/login.tsx:62`, `AuthContext.tsx:593`) — evidence of the gap: no `AppState` blur/overlay, no lock anywhere (grep) — sketch: optional Face ID on foreground after N minutes (Settings toggle, stored in `profiles.biometrics_enabled`, which already exists at `schema.sql:1435`), and a blur view rendered while `AppState !== 'active'` so the iOS app switcher never shows a cost sheet.

### O5 — Give collaborators a projection of `projects`, not the row — leverage: fixes F5 permanently and makes F2 survive future columns — evidence: `projects_select` is row-level (`schema.sql:3421`); `client_portal`, `estimate`, `linked_estimate`, `target_budget` all ride along — sketch: `projects_collab` view (or column-level grants) exposing schedule/scope/status/location only; `ProjectContext` reads the view when `role !== 'owner'`.

### O6 — Sub-portal parity with the client portal — leverage: subs are the supply side of the marketplace and the sub portal is the first thing they see — evidence: F9, F8 (sub half), `sub-portal-setup.tsx:310-326` — sketch: server-validated passcode, rotation, expiry, and the same "passcode travels separately" rule the client portal enforces.

### O7 — Privacy controls in Settings — leverage: a visible "Diagnostics & analytics" switch turns F3's disclosure into a feature — sketch: toggles for PostHog and Sentry replay (`Sentry.getReplay()?.stop()`), stored device-scoped; export/delete already exist next to them.

## Appendix — lower-severity notes (one line each with file:line)

- `lib/supabase.ts:27-28` logs presence only; `app/_layout.tsx:151,158` `sendDefaultPii:false`, `enableLogs:false`; replay masking left at defaults (mask all) — correct.
- `utils/posthog.ts:78-84` identifies by Supabase uid only; `app/_layout.tsx:256-257` resets on sign-out; no PII in `track()` props (grep) — correct.
- Sign-out completeness (`contexts/AuthContext.tsx:608-645`): Supabase global sign-out with `scope:'local'` fallback, prefix wipe, react-query clear, credentials on `clearCredentials`, PostHog reset — all present; only RevenueCat missing (F17).
- Tokenless `get_portal_snapshot` / `get_sub_portal_snapshot` (`schema.sql:4411, 4471`) are locked to `postgres/service_role` in production — the launch-readiness fix holds; not re-reported.
- `supabase/functions/project-invite/index.ts:60-74` trusts a bare claims decode; safe only because the function is deployed `verify_jwt: true` — use `verifyUser` like `mcp-token` for defence in depth.
- `gc_for_portal`, `is_published_portal`, `is_published_sub_portal` are anon-executable oracles (live ACL); `portalId` is `portal-<8 chars of project uuid>-<Date.now base36>` (`app/client-portal-setup.tsx:255`) — low entropy, acceptable only because the 192-bit token is the real gate.
- `?t=` portal tokens land in mageid.app's Netlify access logs and browser history; `marketing/portal/index.html` never `history.replaceState`s them away; outbound links use `rel="noopener"` (Referer is origin-only under modern default policy) — tolerable once F8 rotation exists.
- `contexts/AuthContext.tsx:486-507`: the tenant wipe runs after `SIGNED_IN` is broadcast; correctness relies on the local wipe beating the network fetch — wipe before `signInWithPassword` instead.
- No `AppState`-driven `startAutoRefresh/stopAutoRefresh` on native (`lib/supabase.ts`); an expired token after a long background self-heals on the next `getSession()`, realtime channels may briefly hold a stale JWT (LIKELY).
- `app/login.tsx:48` defaults `rememberMe` to true, so every default password login stores the raw password in Keychain (`AuthContext.tsx:340-341`) — a design choice worth a sentence in the policy.
- Passcodes are stored plaintext (`projects.client_portal.passcode`, `sub_portal_links.passcode` `schema.sql:1855`); `validate-portal-passcode/index.ts:90-98` fails open when the limiter is down — acceptable for a secondary control.
- `utils/portalSnapshot.ts:707-723`: the punch-list section ignores per-item `portalState` (every other section respects it), so a recalled punch item still ships.
- `supabase/functions/delete-account/index.ts:23-24` claims "no event logging tool"; PostHog is live.
- QuickBooks: `qbo_connections` cascades on auth delete (`schema.sql:2426`) but Intuit is never told, so the OAuth grant stays live at Intuit until it expires; RevenueCat/Stripe records are kept by documented decision.
- Persona switch (`contexts/ProjectContext.tsx:1697-1703`) is a UI mode on the same tenant (`profiles.user_role` + `mageid_user_role`); no tenancy change, isolation intact.
- `utils/dataExport.ts:370` shares the local ProjectContext state (own + collaborated projects) via the share sheet — expected scope.
- Email enumeration: reset (`AuthContext.tsx:704-728`) and magic link (`auth-magic-link/index.ts:169`) answer uniformly; `app/signup.tsx:135` surfaces Supabase's raw `error.message`, which enumerates only if "Confirm email" is off in the dashboard (unverified below).
- `portal_messages.author_email` exists (`schema.sql:1346`) but `portal_post_message` never writes it (live: 0 rows with an email) — fine.

### Answers to the brief's questions (evidence in the findings above)
1. **Homeowner sees cost/margin/sub rates/other clients?** Not through the snapshot by default. Client portal (v10) serializes: `language, uiStrings, requirePasscode, welcomeMessage, clientName, clientCanSetBudget, submitBudget{portalId, inviteId, projectId, supabaseUrl, supabaseAnonKey, contactEmail, contactName}, portalApi{same}, coApprovalEnabled, contract{id,status,contractValue,title,needsSignature}, latestUpdate{dateLabel,summary,publishedAt}, closeout{id,status,completionDate,noteFromContractor,finishes[category,productName,brand,sku,supplier],warranties[title,provider,durationMonths,endDate],maintenance[],tradeContacts[company=vendorName,scope,phase],emergencyEmail,emergencyPhone,faq[],passport{counts}}, selections[id,category,styleBrief,budget,dueDate,status,options[id,productName,brand,description,unitPrice,unit,quantity,total,leadTimeDays,supplier,productUrl,imageUrl,highlights,isChosen]], openBook{mode,budget,committed,actual,estimatedFinalCost,contractValue,gmpCap,feePercent,feeAmount,phases[]} — only when project.contractMode is gmp/open_book, ownerDecisions[], messages[id,authorType,authorName,body,createdAt], company{name,primaryColor}, project{id,name,type,address,status,heroPhotoUrl,startDate,targetDate,targetBudget,progressPct}, sections.schedule{startDate,workingDaysPerWeek,totalDurationDays,tasks[id,title,phase,progress,status,durationDays,startDay,isMilestone,isCriticalPath]}, sections.budget{contractValue,paidToDate,outstanding,pctComplete}, sections.invoices[id,number,total,status,dueDate,dateSubmitted,balance,payLinkUrl,amountPaid,issueDate,lineItems[name,description,quantity,unit,unitPrice,total],retentionPercent,retentionAmount,taxAmount,subtotal,paymentTerms,notes], sections.aiaPayApps[…G702/G703 totals, lines[itemNo,description,scheduledValue,fromPreviousApp,thisPeriod,materialsPresentlyStored,retainagePercent], payLinkUrl, periodFrom, narrative], sections.changeOrders[id,number,description,changeAmount,status,dateSubmitted,reason,newContractTotal,scheduleImpactDays], sections.photos[url,caption,timestamp,markup], sections.dailyReports[id,date,weather,totalManpower,totalManHours,workPerformed], sections.punchList[id,title,status,priority,location], sections.rfis[id,number,subject,status,dateSubmitted], sections.documents[]` (`utils/portalSnapshot.ts:104-433, 488-1135`). No markup, margin, unit cost or sub rate field exists; `openBook` and `tradeContacts` are explicit GC opt-ins; sub names reach the homeowner only through the closeout binder and through task titles/notes the GC wrote. Sub portal (v2) serializes: `v, snapshotAt, requirePasscode, passcode (F9), welcomeMessage, company{name,contactName,email,phone}, project{id,name,address,type}, sub{id,companyName,contactName,trade}, commitments[id,number,description,amount,changeAmount,contractToDate,paidToDate,balance,status,signedDate,phase], submittedInvoices[…,notesFromGc], punchItems[id,description,location,priority,status,dueDate,photoUri], scheduleSlice{projectStartDate,tasks[id,title,phase,progress,status,durationDays,startDay,isMilestone]}, submitInvoice{subPortalId,supabaseUrl,supabaseAnonKey,contactEmail,contactName}` (`utils/subPortalSnapshot.ts:22-112`) — scoped to that sub's commitments only. Other clients' data: never (one snapshot per project). Share links: `shared-estimate`/`shared-plan`/`shared-photos` are strict allow-lists (`clientEstimateShareToken.ts:1-9`, `planShareToken.ts:29-45`); `shared-schedule` ships titles/crew/assignedSub because it is sub-facing (`utils/scheduleOps.ts:405-419`).
2. **Field collaborator sees money on the client?** Yes today — F2.
3. **Removed collaborator keeps reading?** Server: no (revoked status → RLS). Device: yes, indefinitely — F6. Their own session stays valid, which is correct.
4. **Sub-portal link guessable / reusable after revocation?** Not guessable (`gen_random_bytes(24)` token, `schema.sql:1863`); disabled → RPCs deny; re-enabled → same token (F8); the `#d=` hash copy renders offline forever regardless; passcode is theatre (F9).
5. **Email enumeration?** Reset and magic-link: no. Signup: unverified (dashboard setting).
6. **Tokens/passcodes plaintext and shown after creation?** Passcodes plaintext and shown to the GC (by design); client-portal `accessToken` plaintext inside `client_portal` and visible to every collaborator (F5); MCP tokens hashed and shown once (`mcp-token/index.ts:57-72`); invite tokens plaintext, single-use, nulled on accept/revoke (`project-invite/index.ts:279, 293`).
7. **Account deletion removes snapshots/share links/storage/third parties?** `portal_snapshots`, `sub_portal_snapshots`, `shared_schedule_snapshots`, `project_contracts`, `selection_*` cascade via `projects`; storage buckets walked recursively — yes. Portal messages, CO approvals, sub invoices, budget proposals, decision audit, notification outbox, embeddings — no (F1). RevenueCat/Stripe/Intuit — no (documented).
8. **Persona switch isolates data?** Yes — same tenant, UI mode only.

## What I could not verify (and how it could be)

- Whether `SCHEDULE_ICAL_SECRET` is set in edge secrets (F13) — `supabase secrets list --project-ref nteoqhcswappxxjlpvap`.
- Supabase Auth "Confirm email" setting, which decides whether `signup.tsx:135` enumerates accounts — Dashboard → Authentication → Providers → Email; or sign up twice with a throwaway address on a staging project.
- GoTrue's `generateLink` magiclink auto-provisioning on this project's Auth version (F19) — call it for an unknown address on a non-production project and check `auth.users`.
- Whether Sentry events from `app.mageid.app/client-view?…&t=` include the full URL (`request.url` is default in `@sentry/browser`) — open a Sentry issue from the web build and inspect the Request context; moot while no share link targets that route.
- Netlify access-log retention for `mageid.app` (where `?t=` lands) — Netlify site settings → Logs/Log drains.
- Whether `function_edge_logs.request.search` is populated for real MCP calls (F14): no MCP token exists yet (`mcp_tokens` = 0 rows); mint one in a test project and query the logs.
- Live behaviour of F2 and F6 with a real collaborator: production has 0 `project_collaborators` rows; reproduce on the simulator by inviting a second test account as Field and opening the project (the estimate card) and then revoking it (the cached project).
