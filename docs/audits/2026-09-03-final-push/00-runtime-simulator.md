# runtime (iOS simulator + production logs) — final-push audit — 2026-09-03

Method: booted the iPhone 17 Pro simulator that carries the Aug-16 DEBUG build of com.mageid.app
(no embedded bundle; loads JS from Metro on port 8083), started Metro from the main checkout, and
drove 20 screens by `mageid://` deep links (taps were unavailable: the native panel needs
`xcode-select`). Cross-checked what the app logged against production logs (auth_logs,
auth_audit_logs, realtime_logs, edge_logs) and the Supabase advisors. Read-only throughout.

## Findings

### R1 — [P1] [CONFIRMED] A session whose JWT is no longer valid stays "signed in": every read fails silently, Home shows "All clear — your jobs are on track", and Realtime retries the dead token every ~4 s
- Where: `lib/supabase.ts:35-40` (autoRefreshToken only refreshes on `exp`), `contexts/AuthContext.tsx` (the only zombie-session handling is inside deleteAccount, ~line 676-700), `contexts/NotificationContext.tsx:160` (logs CHANNEL_ERROR, never backs off), `components/home/BrainWatchCard.tsx:93-98` ("All clear" when `total === 0`, which is also what a failed fetch produces), hooks that swallow the error: `useTimeEntries`, `useNotificationFeed`, `BidResponsesPortfolio`, `StripeConnect` (all logged as warn/log in Metro).
- Evidence: Metro: `[useTimeEntries] Server fetch failed: No suitable key or wrong key type`, `[useNotificationFeed] fetch failed …`, `[StripeConnect] status error: non-2xx`, `[NotificationContext] Bid/CO realtime status: CHANNEL_ERROR` ×N; no `TOKEN_REFRESHED`/`SIGNED_OUT` ever fired. Production: `auth_logs` `GET /user … error: token signature is invalid, error_code: bad_jwt` ×5 at 23:59:31–36Z; `realtime_logs` `JwtSignatureError: Failed to validate JWT signature` 12 times in 75 s (00:02:23–00:03:37Z). The token: HS256, iat 2026-08-16, **exp 2027-08-16**; the project's JWKS now publishes a single ES256 key, so the legacy HS256 secret is gone.
- Failure scenario (real users): any device whose access token stops verifying before its `exp` — a signing-key rotation like this one, a password change with "sign out everywhere", an admin-side user ban/deletion — keeps a green Home screen with $0 tiles and cached lists, queues writes that will never land, and hammers Realtime. Nothing tells the user to sign in again.
- Fix: one place (a Supabase fetch wrapper or `onAuthStateChange` + a PostgREST error interceptor) that maps `bad_jwt` / `PGRST301` / 401 from `/auth/v1/user` to: `refreshSession()` once → on failure `signOut({scope:'local'})` + a "Session expired, sign in again" screen; make `BrainWatchCard` render "Couldn't reach MAGE" when the feeds errored rather than "All clear"; add exponential backoff and a cap on Realtime resubscribe after `CHANNEL_ERROR`.
- Effort: M
- Caveat (important): the simulator's token was a hand-minted one-year token for a user id (`11111111-2222-…`) that does not exist in `auth.users` — an artifact of the Aug-16 audit login, not a production session. The owner's real web session refreshed normally at 17:59Z the same day. So this is a latent defect, not a live incident; the class is real.

### R2 — [P1] [CONFIRMED] Job Costing renders a blank light sheet with no back control whenever the collaborator-role lookup errors or is slow
- Where: `hooks/useProjectRole.ts:24` (`if (!projectId || isLoading || isError) return null;` — by design, NULL on error), `app/job-costing.tsx:171` (`if (role === null) return null;`), `app/job-costing.tsx:192` (`if (!summary) return null;`).
- Evidence: screenshots `sim/17-job-costing.png`, `sim/23-job-costing-wait.png` (12 s later, still blank; a light modal card over the dark app). The screen has a Back button only in the branches that render.
- Failure scenario: offline, RLS-filtered, or slow `project_collaborators` read → the user opens Job Costing from the project tile grid (`app/project-detail.tsx:3467`) and gets an empty white card; the only way out is the modal swipe. Same class as launch-readiness #13 (rfp-detail spinner), closed on 09-02 for one screen.
- Fix: render the header with Back plus "Checking your access…" while loading and "Couldn't verify your access — Retry" on error; keep financials hidden (the role-blinding intent stands). Sweep every consumer of `useProjectRole` (`app/schedule-pro.tsx`, `components/ProjectHero.tsx`, `components/collaborators/CollaboratorsManager.tsx`, `hooks/useProjectAccess.ts`) for the same `return null`.
- Effort: S

### R3 — [P1] [CONFIRMED] A new invoice silently applies 7.5 % tax when the contractor never set a tax rate
- Where: `app/invoice.tsx:330` `const taxRate = existingInvoice?.taxRate ?? settings.taxRate ?? 7.5;`
- Evidence: screenshot `sim/14-invoice.png` — a fresh "New Invoice" shows "Tax (7.5%)" on a $0 subtotal; no tax rate was ever configured on this device.
- Failure scenario: a Brooklyn GC (NY capital-improvement work is not sales-taxable to the customer) sends a $48,000 invoice; the app adds $3,600 of tax the client should not pay, or the GC deletes it by hand every time. Any state with no sales tax on labor is over-billed by default.
- Fix: default to 0 with an explicit "Set your tax rate" nudge on the first invoice, or block send until the rate is confirmed once in Settings; never invent a jurisdiction.
- Effort: S

### R4 — [P3] [CONFIRMED] RN-web leaks transform props into the DOM on the sign-in page
- Where: web console on `/` (login): `React does not recognize the translateX / translateY prop on a DOM element`, `Invalid DOM property transform-origin`, `Received false for a non-boolean attribute collapsable`.
- Consequence: whichever animated element passes `translateX/translateY` as props is not animating on web; harmless but noisy, and it will hide real errors in Sentry breadcrumbs.
- Fix: find the component spreading a style object as props (likely the hero/marketing motion on `app/login.tsx`) and put the transform inside `style`.
- Effort: S

## Observations for the report (not defects)
- Production auth: 30 users; 17 have no email (bulk-created 2026-03-25…04-13 — test or anonymous accounts); 7 projects across 3 owners; two failed password logins from 139.178.129.4 on 2026-09-03T02:12Z; Supabase advisor: leaked-password protection is OFF.
- Supabase security advisors: 42 SECURITY DEFINER functions executable by `anon`, 51 by `authenticated`; 8 functions with mutable search_path; 3 tables with RLS and no policy (app_config, email_unsubscribes, rate_limit_counters); pg_net and vector installed in `public`. Performance advisors: 309 policies re-evaluating auth.uid() per row (`auth_rls_initplan`), 325 multiple-permissive-policy warnings, 19 duplicate indexes, 20 unindexed FKs, 108 unused indexes. Saved as `advisors-security.tsv` / `advisors-performance.tsv` in this directory.
- Dev-environment: a 16-day-old Metro from a deleted agent worktree held port 8083 (the port this debug build is hard-wired to) and served an HTML error page as the bundle — START-HERE gotcha #2 in action. Killed. The Aug-16 simulator install works; its session must be re-minted (the legacy HS256 secret no longer validates) or a real sign-in used.
- Screens that rendered correctly in dark mode with local sample data: Home, Summary, Settings, Discover, Project Detail, Estimate hub, Schedule (empty), Daily Report, Invoice, Paywall (restore + legal links exist in code: `app/paywall.tsx:256-272`), Copilot, Deliveries, Punch List, Cash Flow setup, RFI. No red-box, no unhandled promise rejections in Metro during the tour.
