# 2026-09-03 — Final-push audit

_A full re-audit of MAGE ID before launch: thirteen domain passes run in parallel plus a runtime
pass in the iOS simulator, every finding proven against code and, where it mattered, against the
live production project. Written to be acted on. The per-domain reports with full evidence,
worked examples and appendices are in `docs/audits/2026-09-03-final-push/`._

## How to read this

- **IDs** are `<DOMAIN>-F<n>` and point into the domain report of the same name.
- **Severity** follows the rubric every auditor used: **P0** = money wrong for the user, data loss,
  cross-tenant exposure, App Store rejection, or a crash on a main path; **P1** = user-visible
  defect, silent failure, compliance/privacy risk, a feature that cannot work; **P2** = quality,
  debt, performance; **P3** = polish. Every finding is **CONFIRMED** (traced end to end, quoted)
  unless marked **LIKELY** (one link unverified, named in the report).
- **Effort** S / M / L is per fix, not per wave.
- Two prior audits (08-31 medium sweep, 09-02 launch readiness) are treated as closed; three of
  their closures turned out incomplete and are marked **REGRESSION/UNCLOSED** below.

## Baseline

| | |
|---|---|
| `bun run ship-check` | green: lint, tsc strict, 465 jest tests, 205 guards |
| `supabase/schema.sql` | regenerated today, all nine sections MD5-match production |
| Production (`nteoqhcswappxxjlpvap`) | Postgres 17.6, 108 tables, 337 policies, 82 functions; 30 auth users, 7 projects, 3 portals enabled, 0 collaborators, 0 pay apps, 0 cost seeds |
| Supabase org plan | **free** — no backups, no PITR, 1-day logs |
| Deployed edge functions | 62; 22 with `verify_jwt: false`; 2 exist only in production |
| pg_cron | 8 jobs; 3 have failed at the gateway on every fire since late July |
| Simulator | iPhone 17 Pro, Aug-16 debug build against Metro from HEAD, 20 screens driven by deep link |

## Verdict

The product is deeper than anything in its segment and the code is mostly honest about what it
does. What stands between it and a launch it can survive is not features. It is a short list of
things that are **wrong in ways users cannot see**: four automations that have silently failed
since July, notifications that never leave the database, a tax rate no account can turn off, a
payment link a client can pay twice, a cost book that never reaches the server, an App Store
binary that still contains the bugs fixed a day ago, and a production database with no backup.
None of these is hard. All of them are invisible from inside the app, which is why the audits
before this one — which read the app — did not find them; this one read the database, the logs,
the deployed functions and the running simulator.

Across the fourteen reports: **211 findings — 5 P0, 64 P1, 107 P2, 35 P3 — and 90 ranked
opportunities.** About a dozen root causes were found independently by two or three auditors
(the dead crons, the trigger credential, the field role, the portal credentials, the tax
default, the fee schedule, the dead-session UX); they are cross-referenced below and counted
once in the fix order. Zero cross-tenant data exposure was found. Three prior closures are
unclosed.

## The fix order

Ordered by risk retired per hour. Waves 0 and 1 are the launch gate; the rest is the first month.

### Wave 0 — Before anything ships (config, secrets, one build; mostly S; about a day)

1. **Build native #15 from HEAD and submit that, not #14.** Every existing build and the newest
   OTA embed pre-09-02 JS: the $19/$49 client "free trial" (3.1.1) and the un-moderated RFP feed
   (1.2) are what a reviewer's first launch runs. `APPSTORE-F1`.
2. **Bring the three dead crons back and pin `verify_jwt` in a committed `supabase/config.toml`.**
   `morning-digest`, `invoice-dunning`, `qbo-reconciler` have 401'd on every fire since late July
   (pg_cron logs them as "succeeded"). Redeploy them with `--no-verify-jwt`; commit the config so a
   redeploy cannot flip the flag again; fix the runbook lines that would otherwise switch off the
   Stripe webhook, `notify`, `mcp` and the Friday digest. `EDGE-F1/F2`, `OPS-F1/F3`.
3. **Give the database triggers a credential.** Every client→GC notification (portal message,
   budget proposal, CO approval, sub invoice) is dropped because `app_config.notify_key` has been
   empty since April. Use the `x-cron-secret` header the nearby-RFP trigger already uses and let
   `notify` treat it as privileged. `EDGE-F3`, `DB-F1`, `OPS-F2`.
4. **Back up production.** Free plan = no backups. Move to Pro (or at minimum a scheduled
   `db dump` + storage export) before the migrations in Wave 2 touch live tables. `OPS-F4`.
5. **Set the RevenueCat webhook secrets and prove one sandbox purchase** on the TestFlight build;
   otherwise App Review's own purchase shows "Upgrade to Pro". `APPSTORE-F3` (the known blocker,
   with its App-Review consequence now recorded).
6. **Purge reanimated from `bun.lock` and `node_modules`**, assert it is absent in an `expo
   export`, and switch `runtimeVersion` to the fingerprint policy. `APPSTORE-F2`.
7. **Defuse the stale deploy SQL.** Delete `schedule_all_crons.sql` and `schedule_daily_digest.sql`
   (they re-create live jobs without the cron secret), strip the expiry-cron block from
   `DEPLOY-NOW.sql`, and move **both** held-back migrations out before any `db push`. `OPS-F9`.
8. **Delete the two orphan production functions** (`sync-bids` writes Kansas-coordinate bids
   into the shared feed; `fetch-material-price` burns a paid API from any account). `EDGE-F12`.
9. **Fix the two portal-facing 400s that need one `CREATE OR REPLACE` each:** the architect reply
   RPCs select a column that does not exist, so every RFI/submittal reply link ever emailed fails
   (`CONTRACT-F1`); "Ask Your Home" is deployed with JWT verification the static page cannot
   satisfy (`AUTH-F4`).

### Wave 1 — Money (P0s and the P1s that feed them; S–M each; 2–3 days)

10. **Tax: stop forcing 7.5 %.** `Number(tax_rate) || 7.5` turns a saved 0 back into 7.5 on every
    load; all 30 accounts are at 7.5; every invoice is taxed. Null-check, default 0, prompt once.
    `MONEY-F3`, `RT-R3`.
11. **Payment links: single-use and deactivated on payment**, and gate the portal's Pay button on
    the link's amount. Today a client can be charged $90,000 twice. `MONEY-F2`, then `MONEY-F16`
    (an AIA pay app paid via Stripe never marks its invoice paid) and `MONEY-F17` (refunds).
12. **AIA pay apps: persist `totals` and the pay link.** The writer reads a field that never
    exists, so the second pay app of any project crashes and WIP reports $0 billed. `MONEY-F1`.
13. **Retention: one definition of "outstanding".** Eighteen surfaces report held retention as
    overdue; the PDF prints a total that ignores its own retainage line; "release" is counted up
    to three times in cash flow. `MONEY-F5/F6/F7`.
14. **1099-NEC: 2026 threshold is $2,000, net of retention, dated by `paid_on`.** `MONEY-F4`.
15. **Cost book: stop sending `deleted_at`.** Every cost-seed upsert is rejected and re-queued
    forever; production holds zero seeds. One conditional spread. `CONTRACT-F2`.
16. **Then the rest of the money list**, each small: bill-from-estimate quantity inflation
    (`MONEY-F14`), WIP counting earlier COs twice (`MONEY-F10`), the half-finished sweep #2 fix
    (`MONEY-F11`), the Reports-hub "Unbilled" column that is always zero (`MONEY-F13`), the fee
    schedule stated four ways (`MONEY-F8`, `EDGE-F8`), the G703 seeded from the wrong source
    (`MONEY-F15`), QBO tax and progress (`MONEY-F9`), deductive CO sign (`MONEY-F18`), overtime
    premium (`MONEY-F19`).

### Wave 2 — Data integrity and security (P1s; mostly S; a week)

17. **Offline queue: parents before children, idempotent inserts, flush before sign-out, flush
    on background, per-group write-back.** A project created offline loses its daily report and
    photos on reconnect; sign-out discards the queue with a bare "Are you sure?"; a kill mid-flush
    drops dependent updates. `SYNC-F1/F2/F4/F7`, then `SYNC-F3` (local-only merge for every
    loader) and `SYNC-F6` (the unimplemented sweep #24).
18. **Apply the field-role migration for real and redeploy `project-invite`.** The role does not
    exist in production despite the deploy record; six 09-03 policies fall through to "any
    collaborator, including viewers". `DB-F2`. Then keep the legacy-estimate fallback to owned
    rows only, so a field user cannot read `projects.estimate` while phase 2 waits. `AUTH-F2`.
19. **Portal credentials off the `projects` row**, hashed passcode, a single `portal_authorize()`
    every portal RPC calls (token + enabled + expiry + passcode), and a "Regenerate link" action.
    Today any collaborator can e-sign a change order as the client, the passcode gates only the
    HTML, expiry is cosmetic, and a leaked link cannot be rotated. `DB-F3/F4`, `AUTH-F5/F7/F8`,
    `DB-F6/AUTH-F9` (sub portal).
20. **`notify` authorization:** user-JWT callers may only address themselves or projects they own;
    recipients capped and resolved server-side; anon path rate-limited by resolved GC and IP.
    Today any signup can push and email any user under the victim's brand. `EDGE-F4/F5`.
21. **Database defaults and grants:** revoke default EXECUTE from anon/authenticated, revoke
    `portal_mark_item_viewed`, `fire_notify`, `cost_benchmark_stats`; drop the QBO-token policy;
    make `plan-sheets` private; membership-based storage policies so a collaborator's photos are
    not blank tiles for the GC. `DB-F5/F8/F9/F10/F11`, `EDGE-F13`.
22. **Account deletion that deletes.** Nine tables with client and sub PII have no path; the
    `portal_messages` delete targets a column that does not exist and reports success. `DB-F7`,
    `AUTH-F1`. Verify the INVITED-account case on a device (START-HERE's first check).
23. **Cryptographic caller verification in the eight decode-only functions** and a real secret
    for unsubscribe/iCal tokens. `EDGE-F14`, `OPS-F11`, `AUTH-F13`.
24. **Dead portal links in every system email** (`EDGE-F6`) and the `sub_change_request` /
    `submit_sub_change_request` dead RPCs (`CONTRACT-F4`, `DB-F13`).

### Wave 3 — The first week in a GC's hands (P1/P2 product and UX; S each; a week)

25. **Dates:** eleven off-by-one-day surfaces west of Greenwich, including Home/Summary "Today on
    site" contradicting the schedule tab on day one, permits and warranties changing date after
    a sync, and a lien-waiver "through" date wrong twice. One `parseCalendarDay` sweep plus a
    guard that enumerates date parses instead of naming three files. `UX-F1–F4, F9–F11`.
26. **Dead ends:** a revoked/invalid session that shows "All clear" (`RT-R1`); Job Costing's
    blank sheet and the money hero vanishing on a failed role lookup (`RT-R2`, `UX-F6`); the
    bid-response spinner (`UX-F5`); "Page Not Found" from two search results (`UX-F8`); Back that
    does nothing on cold-start routes (`UX-F18`).
27. **The estimate wizard must not lose a draft to a pull-down** on the first screen after
    signup. `UX-F14`.
28. **Make the phone reach what was shipped:** Deliveries, Building Access, Waiting-on, Equipment,
    Suppliers, Pre-priced Bids, Home Passport have no iOS entry; the marketed chase list and the
    09-02 Deliveries batch are search-only. `PRODUCT-F4`, `UX-F16`.
29. **Connections that are one function call away:** COI vault → sub expiry (reminders can never
    fire today, `PRODUCT-F1`); search "quickbooks" → the real `/qbo-setup`, not the mock
    (`PRODUCT-F2`); QBO push failures visible on the invoice (`PRODUCT-F3`); push-tap routes for
    seven server kinds and gating the RFP fan-out while browse is off (`PRODUCT-F8`).
30. **AI honesty:** swap the retired embedding model so Plan Intelligence / Ask Your Plans / Ask
    Your Home work at all (`AI-F1`); an anti-invention rule and a "from model recall" chip on the
    live Code Check (`AI-F3`); stop counting STATED rates as learned in the wizard chip (`AI-F4`);
    make "set the markup" move money (`AI-F5`); charge after the model answers (`AI-F8`).
31. **App Store metadata:** privacy labels and policy for location, microphone, Sentry replay and
    the STT/geocoding/CloudConvert processors (`APPSTORE-F4`, `AUTH-F3`); listing copy that does
    not promise bidding while browse is off (`APPSTORE-F7`); a non-owner reviewer account and
    notes (`APPSTORE-F8`); symbolicated crashes (`OPS-F6`); a Settings › About row with build and
    OTA id (`OPS-F13`).

### Wave 4 — Scale and hygiene (P2; the second month)

32. Local-first boot with bounded, tenant-filtered queries (`PERF-F1/F2`); context churn
    (`PERF-F3`, `UX-F12`); resize photos on capture and virtualize the grid (`PERF-F4`,
    `UX-F13`); coalesced local persistence and the Android size guard (`PERF-F8`); timeouts
    everywhere (`PERF-F9`).
33. RLS `(select auth.uid())` wrap, collaborator sub-select, duplicate indexes and policies,
    realtime trim (`PERF-F6/F7/F10`); the 233 kB data-URI logo (`PERF-F5`); unvirtualized field
    lists (`PERF-F11`).
34. Universal links (`OPS-F7`, `APPSTORE-F6`); security headers on `app.mageid.app` (`OPS-F8`);
    the invalid SAM.gov key behind a green heartbeat (`OPS-F5`); push-token pruning (`OPS-F10`);
    device-only collections (`OPS-F12`); the remaining AI cost/robustness items (`AI-F2, F6, F7,
    F11, F12, F13`); export/import fidelity (`SYNC-F16`); the realtime publication vs the four
    subscriptions that can never fire (`SYNC-F10`); orphan photo rows (`SYNC-F11`).

### Decisions this audit surfaces for the founder (not bugs)

- **Fee schedule truth:** the code charges Pro 30 bps; the paywall says 0 %; setup says 1 %. Pick one.
- **Tax default:** 0 with a one-time prompt (recommended) or a per-state hint.
- **Field role:** apply the migration now (Wave 2) or hide the role in the picker until phase 2.
- **Notify trigger credential:** cron-secret header (recommended) vs storing the service key in `app_config`.
- **Embedding model:** `gemini-embedding-001` (768-dim compatible, retires 2028) vs `gemini-embedding-2` (Google's current recommendation; needs a column change).
- **RFP fan-out while browse is off:** disable the trigger, or ship the report/block kit on `/rfp-detail`.
- **Supabase plan:** Pro before launch, or accept operating a production database with no restore path.
- **Cost-seed soft delete:** the recorded decision withheld a column; the unrecorded consequence is that no cost seed reaches the server at all. Wave 1 item 15 works with or without the column.

## What would make the product better (top ten, across domains)

1. **Record a payment to a sub on a commitment.** The moat's read side is real; its write side is
   starved because nothing lets a GC who pays by check record it. Turns on calibration, real-basis
   cost-book samples, the 1099 export and lien-waiver prefill in one sheet. `PRODUCT-O1`.
2. **Retainage as a first-class receivable** with its own lifecycle, invoice and pay link, and AP
   (approved sub invoices, open commitments) into the cash-flow forecast. `MONEY-O1/O2`.
3. **One job-cost input bundle** so Job Costing, Reports, Margin Board, Living Estimate and the
   portal show the same projected final. `MONEY-O2`, `PRODUCT-O2`.
4. **A dead-letter sync tray** the GC can see and retry, parent-before-child ordering, and
   per-record version stamps with patch writes. `SYNC-O1/O2/O3`.
5. **Repair the retrieval stack, then move the estimate wizard to a Claude tool-use loop** where
   every line is priced from a `get_cost_rates` tool result and stamped with provenance
   server-side — the STATED/MEASURED firewall enforced in code, and the ADAPTIVE leg for real.
   `AI-O1/O2`, `PRODUCT-O9`.
6. **A "Price it → Schedule it → Share it" strip on every new project**, and the three nav
   surfaces generated from `featureRegistry` so iOS, Tools and the sidebar stop disagreeing.
   `UX-O1/O2`.
7. **Local-first boot and resize-on-capture** — the two largest perceived-speed wins for a phone
   opened thirty times a day on site. `PERF-O1/O2`.
8. **Operational truth:** `config.toml`, a cron-health record that outlives pg_net's six hours, a
   "send test notification" button, heartbeats on the crons that lack them. `OPS-O1/O2/O3`,
   `EDGE-O1/O2`.
9. **One portal trust choke point and a privacy page the code can keep** (deletion completeness,
   field blinding, replay disclosure, link rotation). `AUTH-O1/O2`, `DB-O3`.
10. **Guards that enumerate:** a schema-contract validator and generated `Database` types
    (`CONTRACT-O1/O2`), plus calendar-date, deletion-coverage, role-tier, storage-policy,
    native-surface and verify-jwt guards — each named after a finding above that a listing guard
    missed.

Also worth doing: CO line items as billable rows and a stable Schedule of Values (`PRODUCT-O5`,
`MONEY-O4`); award → estimate/contract seed (`PRODUCT-O6`); delivery ↔ task ↔ receipt ↔ DFR
(`PRODUCT-O7`); universal links and staged OTA rollouts (`APPSTORE-O1/O2/O3`); an app lock and
background privacy overlay (`AUTH-O4`).

## Documents that currently mislead (fix alongside the code)

| Where | Says | Reality |
|---|---|---|
| `docs/START-HERE.md` banner | invoice-dunning "is STILL emailing clients a FINAL NOTICE on every run" | it has never run from cron: gateway 401 since 2026-08-03 (`OPS-F1`) — **corrected in this commit** |
| `docs/START-HERE.md` held-back #3 | consequence = soft-delete of a cost seed does not persist | every cost-seed write is rejected; the cost book never reaches the server (`CONTRACT-F2`) — **corrected** |
| `docs/START-HERE.md` founder decision #4 | the app writes `recipient_kind = 'user'` | no code path writes `'user'`; every writer sends `gc|client|sub` (`OPS`) |
| `DEPLOY-VERIFIED-2026-09-02.md:107` | `20260826130000_field_role` "IS applied" | the role CHECK, `can_access_project` and the deployed `project-invite` all lack `field` (`DB-F2`) — **corrected** |
| `DEPLOY-VERIFIED-2026-09-02.md` step 4 | `supabase functions deploy …` | omits `--no-verify-jwt`; as written it disables the Stripe webhook, `notify`, `mcp`, `seal-document`, the Friday digest (`EDGE-F2`) — **corrected** |
| `DEPLOY-VERIFIED-2026-09-02.md` step 5 | OTA only | a native build from HEAD is required for App Review (`APPSTORE-F1`) — **corrected** |
| `DEPLOY-VERIFIED-2026-09-02.md:242-244` | "the reanimated runtime trap … is not in play" | reanimated 4.1.7 is still in `bun.lock` and `node_modules`; the export bundles it (`APPSTORE-F2`) — **corrected** |
| `DEPLOY-VERIFIED` step 2 | move only the phase-2 file before `db push` | `20260826180000_portal_link_expiry_cron` is also pending and would be applied (`OPS-F9`) — **corrected** |
| `CLAUDE.md` | EAS project `9f6536e0-…`; deploy via `supabase functions deploy <name>` | real project `00860b05-b25b-4b37-b85a-846ecb80bb4c`; the command needs the per-function flag |
| `docs/audits/2026-08-31-medium-sweep.md` | #2, #17, #24 closed | #2 half (`MONEY-F11`), #17 client half only (`AI-F9`), #24 never implemented (`SYNC-F6`) |
| `LAUNCH.md` | references `lib/stripe.ts`; "no third-party trackers" | file does not exist; PostHog + Sentry replay are live |
| `supabase/functions/delete-account/index.ts:23-26` | "no event logging tool" | PostHog is live |
| `marketing/pricing.html` | downgrade → read-only; 2 bids/mo; sub portal has COIs/prequal/RFIs | no read-only mode; code says 3; sub portal has none of those |
| `docs/app-store-metadata.md` | "homeowners post projects, you bid" | browse/bid is gated off for 1.0 |

## Guards to add (each one exists because a listing guard went blind)

- `validate-schema-contract` — every column, RPC name/argument, `onConflict` target and SQL-function column reference must exist in `schema.sql`.
- `validate-edge-verify-jwt` — `config.toml` vs `list_edge_functions`; deployed slugs vs `supabase/functions/*`.
- `validate-calendar-date` rewritten to enumerate `new Date(<date-ish>)` / `Date.parse` sites with a dated allowlist.
- `validate-account-deletion` rewritten to enumerate every table with a tenant-bearing column.
- `validate-role-tiers` — role CHECK vs the picker; every `min_role` literal vs `can_access_project`'s branches.
- `validate-storage-policies` and `validate-function-grants` over a committed grants section in `schema.sql`.
- `validate-native-surface` — `expo export` must not contain native modules absent from `package.json`.
- `validate-money-outstanding` — no `totalDue -` arithmetic outside `invoiceBilling.ts`.
- `validate-offline-group-abort` extended to pin the record-key fallback (`SYNC-F6`).
- `validate-feature-search` extended to require an iOS inbound reference for every sidebar route.

## What none of this proves

Nothing here has run on a physical iPhone. Before submitting build #15, on a device:

1. The five checks START-HERE already lists (delete an INVITED account; import a 1,000-row MS
   Project file; offline create-then-approve a CO on two devices; the schedule in a negative UTC
   offset; post an RFP as a homeowner).
2. Create a project offline, file a DFR with photos, reconnect, and read the toast (`SYNC-F1`).
3. One sandbox purchase on TestFlight, then `select tier from subscriptions` (`APPSTORE-F3`).
4. Open Job Costing on a flaky link (`RT-R2`); open Home in Denver with a Tuesday-start schedule
   (`UX-F1`); open the Month sheet and the CSV (`UX-F2`).
5. Tap one architect reply link and one portal link from a system email after Wave 0 (`CONTRACT-F1`, `EDGE-F6`).
6. Sign in as user B on a device where user A left unsynced projects (`SYNC-F13`).

## Method

Thirteen domain auditors ran in parallel against a shared brief (repo read-only, production
SELECT-only, prior closures honoured, findings only with file:line and a failure scenario):
edge-function security, database security, app↔database contract, money, offline sync,
auth/tenancy/portals/privacy, App Store and release, frontend UX, AI features, product
connection, code health, operations, performance. A runtime pass drove the installed debug build
in the simulator against Metro from HEAD and cross-checked Metro output with production auth,
realtime and edge logs. Every headline claim in this synthesis was re-verified by the coordinator
against production (`pg_get_constraintdef`, `net._http_response`, `get_organization`, live
function probes) or the repo (`git merge-base`, `bun.lock`, direct reads of the cited lines).
Google's model-deprecation page and the Supabase plan were checked externally. Supabase's own
security (107) and performance (781) advisors were pulled and folded in.

## Domain findings, condensed

Each domain's full report (evidence, worked examples, appendix, what could not be verified)
is in `docs/audits/2026-09-03-final-push/`. IDs below are `<domain>-F<n>` as in those files.
Severity is the auditor's, re-checked; where the synthesis disagrees it says so.

### Runtime (simulator + production logs) — `00-runtime-simulator.md`

- **RT-R1 · P1 · CONFIRMED** — A session whose JWT stops verifying stays "signed in": every read fails with console warnings only, Home says "All clear — your jobs are on track", Realtime retries the dead token every ~4 s (`realtime_logs`: 12 `JwtSignatureError` in 75 s). `lib/supabase.ts:35-40`, `components/home/BrainWatchCard.tsx:93-98`, `contexts/NotificationContext.tsx:160`. Fix: central `bad_jwt`/`PGRST301` handler → `refreshSession()` once, else local sign-out + "session expired" screen; Brain Watch distinguishes "fetch failed" from "nothing to show"; backoff on `CHANNEL_ERROR`. Effort M. (Latent: the simulator token was a hand-minted one; real sessions rotate hourly.)
- **RT-R2 · P1 · CONFIRMED** — Job Costing renders a blank light sheet with no back control whenever the role lookup errors or is slow. `hooks/useProjectRole.ts:24` returns null on error; `app/job-costing.tsx:171` returns null on null. Same class as launch-readiness #13. Fix: header + Back + "Checking access… / Couldn't verify — Retry" states; sweep the other `useProjectRole` consumers. Effort S.
- **RT-R3 · P1 · CONFIRMED** — New invoice applies 7.5 % tax when no rate was ever set (`app/invoice.tsx:330`). Same root as MONEY-F3 below.
- **RT-R4 · P3** — RN-web leaks `translateX/translateY/transform-origin/collapsable` into the DOM on the sign-in page (an animation is not applied on web).

### Edge-function security — `01-security-edge-functions.md` (17 findings: 6 P1, 11 P2)

- **EDGE-F1 · P1 · CONFIRMED** — `morning-digest`, `invoice-dunning`, `qbo-reconciler` are deployed `verify_jwt: true`; cron sends no JWT; the gateway answers 401 on every tick (18 of 20 `net._http_response` rows in the last 6 h; `function_edge_logs` 401 ×73/day). None has run from cron since late July. `cron.job` 7/15/23; no `supabase/config.toml`. Fix: redeploy the three with `--no-verify-jwt`; add `Authorization: Bearer <anon key>` to the seven cron jobs so either flag works. Effort S. **Corrects START-HERE:** dunning has never sent the FINAL NOTICE — it has never run.
- **EDGE-F2 · P1 · CONFIRMED** — No `config.toml`; `DEPLOY-VERIFIED` step 4 as written would flip `stripe-webhook`, `mcp`, `notify`, `seal-document`, `homeowner-weekly-digest` to `verify_jwt: true` → Stripe reconciliation, MCP, trigger notifications and the Friday digest stop (P0 the moment the command runs). Fix: commit `supabase/config.toml` (22 × `false`, rest `true`) + a ship-check diffing it against `list_edge_functions`; fix the runbook lines. Effort S.
- **EDGE-F3 · P1 · CONFIRMED** — Five trigger-driven GC notifications (portal message, budget proposal, CO approval, sub invoice submitted/reviewed) are dropped: triggers post with an empty bearer (`app_config.notify_key` length 0 since the seeding migration), `notify` fails closed for those events (`notify/index.ts:220-226, 266-267, 938-942`). Fix: triggers send `x-cron-secret` (as `public_bids_notify_nearby_fn` already does); `notify` treats `isValidCron` as privileged. Effort S. (Also DB-F1, OPS-F2.)
- **EDGE-F4 · P1 · CONFIRMED** — Any signed-in account is a fully privileged `notify` caller: push + email to any user with attacker text under the victim's company name; unbounded `bidder_recipients` fan-out (`notify/index.ts:277-279, 359-390, 758-802, 938-942`). Fix: user-JWT callers may only target themselves / projects they own; cap recipients (≤50); per-caller hourly bucket. Effort S–M.
- **EDGE-F5 · P1 · CONFIRMED** — Unauthenticated relay: with any project uuid the anon path resolves a real GC with no limiter (`:269, :290-293`); `bid_question_answered` / `closeout_binder_sent` deliver attacker text to attacker-chosen recipients. Fix: limit by resolved GC and IP; resolve recipients server-side. Effort S.
- **EDGE-F6 · P1 · CONFIRMED** — Every portal link in system emails is dead: dunning and the weekly digest link `/portal/<project.id>` (page expects `portal-<id8>-<ts>`), and every `notify` CTA omits the `?t=` token the page requires (`invoice-dunning/index.ts:400`, `homeowner-weekly-digest/index.ts:393`, `notify/index.ts:304,814`, `marketing/portal/index.html:4742`). Fix: one `_shared/portalLinks.ts` helper. Effort S.
- **EDGE-F7 · P2** — `ai` relay's per-feature tier floor applies only when the client sends `feature` (`ai/index.ts:125-143`) → free accounts can run Pro prompts. Fix: make `feature` required. (Also AI-F7.)
- **EDGE-F8 · P2** — `create-payment-link` computes the platform fee from client-supplied `userTier` (`:96-107, 387-390`). Fix: derive server-side via `requireTier`. (Also MONEY-F8.)
- **EDGE-F9 · P2** — `send-email` is an authenticated relay: 25 recipients/call, no per-user limit, FROM name = self-editable `company_name`. Fix: per-user bucket, validate recipients, attributable reply-to.
- **EDGE-F10 · P2** — `revenuecat-webhook` downgrades to free on CANCELLATION/EXPIRATION/PAUSED when the RC REST lookup is unavailable, contrary to its own comment (`:105-114, 164-186`); latent until the webhook secret is set.
- **EDGE-F11 · P2** — `convert-pdf-to-images:169` caps Enterprise at 50 pages (`tier === 'business' ? 200 : 50`).
- **EDGE-F12 · P2** — Two functions exist only in production (`sync-bids`, `fetch-material-price`), callable by any signed-in user; `sync-bids` upserts federal bids at hard-coded Kansas coordinates into the shared `cached_bids`. Fix: delete both; ship-check diffs deployed slugs vs `supabase/functions/*`.
- **EDGE-F13 · P2** — `cost_benchmark_stats` is anon-executable and ignores `public_index_opt_in` — the cost book's aggregate is readable without an account. Fix: revoke from anon/authenticated or add the predicate. (Also DB-F8.)
- **EDGE-F14 · P2** — Eight functions identify the caller by an unverified JWT decode and depend solely on the gateway flag (`connect-onboarding`, `connect-status`, `create-payment-link`, `create-rfp-checkout`, `project-invite`, `send-email`, `schedule-ical-url`, `transcribe-audio` — the last has no identity check at all). Fix: `verifyUser(req)` each.
- **EDGE-F15 · P2 · LIKELY** — Every per-IP limiter keys on `x-forwarded-for[0]`, client-suppliable.
- **EDGE-F16 · P2 · LIKELY** — `import-schedule` parses user workbooks with `xlsx@0.18.5` (CVE-2023-30533, CVE-2024-22363). Fix: SheetJS 0.20.x from the vendor CDN.
- **EDGE-F17 · P2** — `financing-redirect`'s emailed link requires a header an email client cannot send → every emailed financing link falls to the marketing site.
- Passed: MASTER_EMAILS == OWNER_EMAILS; MONTHLY_CAPS == paywall table == LIMITS×30; Stripe and RevenueCat signature checks correct; vision SSRF allowlist holds; cron-secret guard holds.

### Database security — `02-security-database.md` (15 findings: 5 P1, 7 P2, 3 P3)

- **DB-F1 · P1** — Same dead trigger→notify path as EDGE-F3 (`fire_notify` sends `Bearer ` + empty; `notify_portal_message_fn` sends no credential).
- **DB-F2 · P1 · CONFIRMED** — The `field` collaborator role does not exist in production: `project_collaborators_role_check` is `owner|editor|viewer` (live), `can_access_project` has no `field` branch, deployed `project-invite` v1 rejects it — while `DEPLOY-VERIFIED-2026-09-02.md:107` says `20260826130000_field_role` "IS applied" (it verified overload existence, which the migration itself says was created out of band). Second consequence: six 09-03 policies pass `'field'` as `min_role` (`access_reservations_*`, `building_access_rules_*`, `deliveries_*` insert/update) and resolve through `else true` — **any accepted collaborator, including a Viewer, can insert deliveries/reservations**. Fix: apply the migration (re-verify its 8 policy names first), redeploy `project-invite`, correct the deploy doc, add `validate-role-tiers.ts`. Effort S.
- **DB-F3 · P1 · CONFIRMED** — The client-portal passcode is enforced only by the HTML gate: every data RPC accepts the link token alone, and `portal_sign_contract` skips the passcode when `p_passcode` is NULL — which the shipped portal always passes (`schema.sql:4943-4989`, `marketing/portal/index.html:3793`). 0 of 3 live portals use a passcode. Fix: `portal_authorize(portal_id, token, passcode)` called first in every portal RPC. Effort M.
- **DB-F4 · P1 · CONFIRMED** — Any accepted collaborator can read `client_portal.accessToken` and plaintext `passcode` off the `projects` row (`projects_select` is row-level) and e-sign change orders as the client — an evidentiary record the GC cannot distinguish from a real signature. Phase 2 does not remove this column. Fix: `portal_credentials` table, owner-only RLS, hashed passcode; strip both keys from the collaborator mapping meanwhile. Effort M. (Also AUTH-F5.)
- **DB-F5 · P1 · CONFIRMED** — Storage policies bind `project-photos` SELECT to the uploader's folder and `project-documents` to `owner = auth.uid()`, so a collaborator's photos/files are invisible to the GC (URL resolver swallows the denial → blank tiles). Fix: membership-based policies via `can_access_project((storage.foldername(name))[n])`. Effort S.
- **DB-F6 · P2** — Sub-portal passcode is serialized into the snapshot, compared in the browser, generated with `Math.random`, emailed beside the link. (Also AUTH-F9.)
- **DB-F7 · P2 · CONFIRMED** — Account deletion leaves eight tenant tables with no FK path behind (`change_order_approvals` with signature images, `portal_messages`, `portal_budget_proposals`, `portal_decision_audit`, `sub_submitted_invoices`, `notification_outbox`, `memory_embeddings`, `conversations`), and the `portal_messages` delete targets a `user_id` column that does not exist → 42703 swallowed, `success: true`. The validator enumerates FKs, so FK-less tables are invisible to it. Live: 2 orphaned portal messages already. Fix: delete by collected project/portal ids; FKs where a parent exists; guard enumerates tenant-bearing columns. Effort M. (Also AUTH-F1.)
- **DB-F8 · P2** — `cost_benchmark_stats` anon + no opt-in (see EDGE-F13); rates are upserted into `cost_benchmark_samples` on every screen load regardless of opt-in (`hooks/useCostBenchmark.ts:61-69`).
- **DB-F9 · P2 · CONFIRMED** — Default privileges still grant EXECUTE to anon/authenticated on every new function (42 SECURITY DEFINER functions anon-callable; `can_view_project_financials` shipped 09-03 with `=X` PUBLIC). Two have no caller check at all: `portal_mark_item_viewed` (anyone with two uuids forges "client viewed" timestamps) and `fire_notify`. Fix: `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM public, anon, authenticated` (for `postgres` and `supabase_admin`) + targeted revokes. Effort S.
- **DB-F10 · P2** — QuickBooks OAuth access/refresh tokens are readable through PostgREST with the user's own JWT (`qbo_connections_owner FOR ALL`); no client code needs the table. Fix: drop the policy.
- **DB-F11 · P2** — Construction drawings are served from the PUBLIC `plan-sheets` bucket by permanent unsigned URLs under a shared `tmp/` prefix. Fix: private bucket + membership SELECT policy + signed URLs at read time.
- **DB-F12 · P2 · LIKELY** — Portal/sub-portal tokens generated on the client via `generateUUID()` whose native fallback is `Math.random` (`expo-crypto` present, unused).
- **DB-F13/14/15 · P3** — `submit_sub_change_request` references a nonexistent column, anon-executable, no token; `lookup_prequal_packet_by_token` returns the GC's `reviewer_notes` to the sub; free-tier project cap bypass via `type='awarded_rfp'` or a `Sample — ` name.
- Verified closed: zero UPDATE/ALL policies with a weaker WITH CHECK than USING remain; freeze triggers attached; `grant_rfp_post_credit` locked live.

### Money — `04-money.md` (19 findings: 4 P0, 12 P1, 3 P2)

- **MONEY-F1 · P0 · CONFIRMED** — AIA pay apps lose `totals` and `payLinkUrl` on the server round-trip: the writer reads `a.snapshotTotals` (never set; the object carries `totals`) → `snapshot_totals` is always NULL; the reader never maps `totals`/`payLinkUrl`/`paidAt` (`contexts/ProjectContext.tsx:4360, 1818`). After a relaunch, the second pay app throws on `priorAIA.totals.totalEarnedLessRetainage` (`app/aia-pay-app.tsx:170`), WIP "billed to date" reads $0 (`utils/wip.ts:232-236`), the AIA Pay button vanishes from the next portal publish. Live: 0 pay apps saved yet (latent). Fix: `snapshot_totals: a.totals ?? null`; add `pay_link_url/id` columns; map back; guard `:170`; round-trip validator. Effort S.
- **MONEY-F2 · P0 · CONFIRMED** — Stripe Payment Links are reusable and never deactivated; after a net-of-retention payment the portal shows "Pay $10,000" against a link that charges $90,000 (`create-payment-link/index.ts:397-420` no `restrictions`; `stripe-webhook/index.ts:299-329` never deactivates; `marketing/portal/index.html:4171-4179, 4703-4707` — the AIA button has no paid state at all). Fix: `restrictions.completed_sessions.limit = 1`; deactivate on `checkout.session.completed`; persist `pay_link_amount` and gate the button on it. Effort S/M.
- **MONEY-F3 · P0 · CONFIRMED** — A tax rate of 0 % saved in Settings comes back as 7.5 % on every synced load (`Number(data.tax_rate) || 7.5`, `contexts/ProjectContext.tsx:649`; `DEFAULT_SETTINGS.taxRate: 7.5`; `profiles.tax_rate DEFAULT 7.5`), and 7.5 % is applied to every invoice, progress bill and CO preview. Live: all 30 profiles at 7.5; 5 of 5 invoices taxed. Fix: null-check instead of `||`; default 0 with an onboarding prompt; render the Tax row only when > 0. Effort S. (= RT-R3.)
- **MONEY-F4 · P0 · CONFIRMED** — 1099-NEC export flags "required" at $600 for 2026 (federal threshold for payments after 12/31/2025 is $2,000 under P.L. 119-21 §70433), counts retention the sub never received, and dates by `paid_at` not `paid_on` (`utils/tax1099Export.ts:58-86`, `app/tax-1099-export.tsx:47-50, 70`). Fix: year-keyed threshold table; net of retention held; `paidOn ?? paidAt`. Effort S. (Synthesis note: P0 as a wrong legal figure; confirm the indexed 2027 figure with the CPA.)
- **MONEY-F5 · P1 · CONFIRMED** — Eighteen "outstanding" computations use `totalDue − amountPaid` gross of held retention, so retention the contract lets the client hold is reported as owed and overdue on A/R aging, the home strip, the portal, the PDF, the Stripe receipt and the weekly client email, and a retention invoice can never reach `paid` (sites listed in the report; correct reference already exists: `utils/invoiceBilling.ts:54-58 netBalanceDue`). Fix: one `invoiceOutstanding()`/`invoiceIsSettled()` + a guard forbidding `totalDue -` outside `invoiceBilling.ts`. Effort M.
- **MONEY-F6 · P1** — Invoice PDF prints "Retainage −$X" then a "Total Due" that does not subtract it; the email and Pay button use the net figure (`utils/pdfGenerator.ts:958-975`).
- **MONEY-F7 · P1** — "Release Retention" has two contradictory meanings; the cash-flow forecast counts a released amount up to three times (`app/invoice.tsx:1043-1071`, `utils/cashFlowEngine.ts:64-79, 212`).
- **MONEY-F8 · P1 · CONFIRMED** — The platform payment fee is stated four different ways (code: free 0 / pro 30 / business 50 / enterprise 40 bps, unknown 50; paywall: 1 % / 0 % / 0.5 % / 0.4 %; payments-setup "1 %"; payments screen 1 % + 2.9 % + 30¢ for every tier) and none matches what is charged. Fix: one `PLATFORM_FEE_BPS` table mirrored server-side with a validator. Effort S.
- **MONEY-F9 · P1** — QuickBooks push sends invoices without sales tax and ignores the progress percentage; payments pushed tax-inclusive; the reconciler writes `amount_paid` from QBO's ex-tax total with `status='paid'` (`_shared/qbo-mapping/invoice.ts:36-69`, `payment.ts:24-29`, `qbo-reconciler:193-231`).
- **MONEY-F10 · P1** — WIP "original contract" is read from the newest CO, whose `originalContractValue` already includes earlier approved COs → earlier COs counted twice (`utils/wip.ts:94-112`).
- **MONEY-F11 · P1 · REGRESSION/UNCLOSED** — Sweep #2 was only half fixed: `utils/livingEstimate.ts:125-128` and `utils/jobCostEngine.ts:327-331` still compare at-cost commitments to marked-up `lineTotal`.
- **MONEY-F12 · P1** — Five screens run the job-cost engine with different inputs (only Job Costing feeds receipts and crew labor) → contradictory EAC on Living Estimate, Reports, Margin Risk and the portal. (Also PRODUCT-F5.)
- **MONEY-F13 · P1** — Reports-hub WIP "Unbilled" column is identically zero by construction (`utils/financialReports.ts:99-110`).
- **MONEY-F14 · P1** — Bill-from-Estimate keeps the pre-markup unit price and inflates the quantity so the row foots: "115 sf @ $10.00" for 100 sf of scope (`app/bill-from-estimate.tsx:124-151, 273-281`).
- **MONEY-F15 · P1** — G703 Schedule of Values is seeded from the source invoice's line totals → changes every period, excludes COs and tax, carry-forward yields >100 % lines and negative balance-to-finish (`utils/aiaBilling.ts:138-147`, `app/aia-pay-app.tsx:158-166`).
- **MONEY-F16 · P1** — An AIA pay app paid through Stripe never reconciles to its source invoice → dunning/A-R/cash flow keep chasing a paid bill (`stripe-webhook:240-265` flips only `paid_at`).
- **MONEY-F17 · P2** — Refunds, disputes and failed payments never reach the invoice (`stripe-webhook:510-651`).
- **MONEY-F18 · P2** — Deductive CO shows without a sign on screen (`app/change-order.tsx:617-636, 1225-1227`); PDF is right.
- **MONEY-F19 · P2** — Overtime hours are computed but never priced (`hooks/useTimeEntries.ts:111-119`, `utils/jobCostEngine.ts:305-310`).
- Verified holding: markup-vs-margin copy/math; STATED-vs-MEASURED provenance through `costDatabase`; sweep #1/#4/#8/#13/#28 fixes present.

### AI features — `09-ai-features.md` (16 findings: 3 P1, 10 P2, 3 P3)

- **AI-F1 · P1 · CONFIRMED (externally re-verified)** — Every semantic-memory feature calls `text-embedding-004`, which Google shut down on 2026-01-14 (`_shared/embeddings.ts:7`; Google's deprecations page now recommends `gemini-embedding-2`); `memory_embeddings` has 0 rows in production. Plan Intelligence indexing, Ask Your Plans, Ask Your Home and Construction Answers' plan tool have never worked; Project Memory silently falls back to TF-IDF. Fix: `gemini-embedding-001` (shutdown 2028-05-14) or `gemini-embedding-2`, with `outputDimensionality: 768` to keep the `vector(768)` column; redeploy three functions; add a live model canary. Effort S + deploy.
- **AI-F2 · P1 · LIKELY** — AI Takeoff / Drawing Analyzer / Spec Book send up to 16–24 rendered pages inline in one Gemini request; Google's inline limit is 20 MB total, so mid-size sets fail after pages and the unit are charged (`app/takeoff.tsx:230-252`, `analyze-takeoff/index.ts:350-353, 761-770`). Fix: batch ≤4 pages or use the Files API; charge after success.
- **AI-F3 · P1 · CONFIRMED** — The live Code Check emits building-code section numbers from model recall with no retrieval and no anti-invention rule in the main prompt, and the UI renders them as lookups ("Looking up IRC R311…"); the retrieval-grounded engine (`construction-answer`) is inert without a key — an unrecorded consequence of that decision. Fix (S): the anti-invention sentence in the main prompt, `section` optional, a "from model recall — verify with AHJ" grounding chip.
- **AI-F4 · P2** — Estimate Wizard / Quick Estimate grounding chips count STATED (seeded) rates as "learned rates" (`app/estimate-wizard.tsx:302-306, 733-734`; `estimate/full.tsx:232`) — the firewall breached on the flagship surface. Fix: filter `provenance !== 'seeded'`.
- **AI-F5 · P2** — Voice estimate edit "set the markup to X %" is a no-op on money (`interpretEstimateOps.ts:46-49`; helper `applyGlobalMarkupToItems` exists unused). Leftover of sweep #22.
- **AI-F6 · P2** — Drawing Analyzer hydrates the estimate from unvalidated model JSON with model-computed totals and no grounding (`analyze-drawings:244-246`, `app/drawing-analyzer.tsx:173-190`).
- **AI-F7 · P2** — Tier gate is opt-in by the client; the 24k-token "smart" budget is unenforced per tier; daily/smart/lifetime caps are client-only. (Also EDGE-F7.)
- **AI-F8 · P2** — Ten metered functions charge before the model call with no refund; over-cap retries keep climbing the counter (`usage 57 of 50`).
- **AI-F9 · P2 · UNCLOSED (partial)** — Sweep #17: `requireTier` still has no `projectId`; an invited free-tier collaborator still cannot run AI on the seat the owner paid for (`app/ai-punch.tsx:283-300` says so in a comment).
- **AI-F10 · P2** — Construction Answers over-cites (every returned row becomes a citation) and `verified` is the model's own "VERIFIED: yes".
- **AI-F11 · P2 · LIKELY** — `analyze-photos` 2,000-token output budget is below a 12-photo punch walk's need; truncation surfaces as "non-JSON" with raw model text echoed (receipts → vendor text in client logs).
- **AI-F12 · P2** — 16 Gemini call sites hard-code model ids; no env override, no canary (AI-F1 is the first casualty).
- **AI-F13 · P2 · LIKELY** — Homeowner weekly digest: field-authored daily-report text enters a Gemini prompt whose output is emailed to the homeowner unreviewed (prompt injection → client-facing mail).
- **AI-F14/15/16 · P3** — Unmetered surfaces (JUDGES narration, Ask Your Plans answer, MCP, transcribe-audio 40 MB uploads, orphan `fetch-material-price`); metering-contract inconsistencies (usage-status tracks 5 of 14 features; dead `convert_pdf` counter; `scan_credential` pro cap dead config); raw upstream error text shown to users; no request cancellation on navigate-away.
- Refuted: usage RPCs are not anon-executable; no `-latest`/`-exp` aliases; deployed `ai` v35 == repo; every auto-apply path requires a tap (no injection→auto-apply P0).

### Auth, tenancy, portals, privacy — `06-auth-tenancy-portal-privacy.md` (19 findings: 4 P1, 9 P2, 6 P3; 0 cross-tenant exposure)

- **AUTH-F1 · P1 · CONFIRMED** — Account deletion leaves client and sub PII behind (same class as DB-F7): `portal_messages` is filtered by a `user_id` column the table lacks → 42703 swallowed, `success: true`; nine more tables have no deletion path. Live: 2 orphaned portal messages already. Apple exercises 5.1.1(v) at review. Fix: delete by resolved portal/project/sub-portal ids; validator enumerates every `CREATE TABLE`. Effort M.
- **AUTH-F2 · P1 · CONFIRMED** — The field role's "no costs or margins" promise is void even once the role exists: `projects_select` hands every collaborator the whole row, and `ProjectContext.tsx:590-600` falls back to the legacy `projects.estimate` exactly when `project_financials` returns nothing (the field case); `project-detail.tsx` renders "Total Estimate" with zero role checks. 3 of 7 live projects still carry legacy estimate JSON — an unrecorded consequence of the phase-2 hold. Fix: apply the legacy fallback only for owned rows; gate the money sections on `canViewFinancials(role)`. Effort S+S.
- **AUTH-F3 · P1 · CONFIRMED** — The privacy policy omits processors that receive personal data: Sentry (crash + 10 % session replay), the Rork speech-to-text proxy (every voice recording), CloudConvert, Google/Nominatim geocoding of client addresses, OpenWeather, Intuit, Pexels, Netlify (`marketing/privacy.html:85-96`). Fix: enumerate them; consider replay sampling 0 until disclosed. (Also APPSTORE-F4.)
- **AUTH-F4 · P1 · CONFIRMED (live probe)** — "Ask Your Home" on the static homeowner portal is dead: the function is deployed `verify_jwt: true`, the page sends no JWT → gateway 401 every time (`marketing/portal/index.html:4043-4047`). Fix: three header lines, or deploy with `--no-verify-jwt` per its design.
- **AUTH-F5 · P2** — Any accepted collaborator can act as the homeowner: the portal access token and passcode ride in the `projects` row every collaborator reads; `portal_sign_contract` and `portal_submit_co_approval_signed` authenticate by that token alone. (= DB-F4.)
- **AUTH-F6 · P2** — A revoked collaborator keeps the project on-device forever: the projects loader union-merges local with server and re-persists (`ProjectContext.tsx:620-628`). Fix: keep only genuinely pending local rows.
- **AUTH-F7 · P2** — Portal link expiry is cosmetic: only `portal_get_snapshot_v2` checks `expires_at`; the `#d=` hash path and every write RPC ignore it.
- **AUTH-F8 · P2** — A leaked portal or sub-portal link cannot be revoked or rotated; disable/re-enable restores the same token (`portal_set_access_token` reuses the old value).
- **AUTH-F9 · P2** — Sub-portal passcode is theatre: serialized into the URL hash and snapshot, emailed beside the link, compared client-side, generated with `Math.random`. (= DB-F6.)
- **AUTH-F10 · P2** — The public portfolio page publishes the client's street address with no opt-out (`utils/publicProfileSnapshot.ts:115`).
- **AUTH-F11 · P2** — Native sessions (access + refresh token) sit in plaintext AsyncStorage; implicit flow, no PKCE (`lib/supabase.ts:35-41`). Fix: SecureStore adapter + `flowType: 'pkce'`.
- **AUTH-F12 · P2 (latent)** — The RN `client-view` route writes homeowner decisions straight to tables `anon` cannot INSERT, then says "We saved your response locally"; unreachable by homeowners today (links go to the static page).
- **AUTH-F13 · P2 · LIKELY** — Calendar-feed HMAC falls back to a hard-coded secret when `SCHEDULE_ICAL_SECRET` is unset; both token inputs are obtainable from any portal link.
- **AUTH-F14–F19 · P3** — MCP tokens travel in the URL and land in edge logs; `submit_sub_change_request` broken and anon-executable; weekly digest logs the homeowner's email; sign-out never calls `Purchases.logOut()`; accept-invite stash is wiped by the login sweep; magic-link email says "no account will be created" while `generateLink` provisions one.
- Verified: portal snapshots contain no markup, margin, unit cost or sub rate; tokenless legacy snapshot RPCs are locked to service role; PostHog carries no PII; sign-out is otherwise complete.

### Product connection — `10-product-connect.md` (19 findings: 4 P1, 13 P2, 2 P3)

Verdict: "the gap is connection, not capture" still holds but has moved. The money spine is wired (lead→project, estimate→contract→invoice, buyout→commitment, CO→contract sum and schedule, closed job→cost book→grounding). What is disconnected: the actuals side of the moat (no way to record a sub payment outside the sub portal), the same job-cost number computed five ways, six shipped features unreachable on iPhone, and three silent-success classes.

- **PRODUCT-F1 · P1 · CONFIRMED** — COI expiry reminders can never fire for a certificate filed in the COI Vault: the watcher reads `subcontractors.coi_expiry`, which the vault never writes (`coi-expiry-watch/index.ts:186-195`, `ProjectContext.tsx:4626-4640`; no `updateSubcontractor` in `coi-vault.tsx`). Three unsynced expiry sources. Fix: derive the sub's `coiExpiry` from the vault's earliest coverage. Effort S.
- **PRODUCT-F2 · P1 · CONFIRMED** — Universal Search routes "quickbooks / accounting / sync" to a mock Integrations screen whose Connect button flips local state; the real `/qbo-setup` is unindexed (`utils/featureRegistry.ts:248`, `app/integrations.tsx:19-124`). Fix: repoint the registry; delete or owner-gate the mock. Effort S.
- **PRODUCT-F3 · P1 · CONFIRMED** — A QuickBooks push that fails five times is abandoned and nothing in the app shows it (`qbo-reconciler/index.ts:142-164`; zero readers of `qboSyncStatus/qboError`). Fix: status on the invoice row + a "Needs attention" list with Retry. Effort S–M.
- **PRODUCT-F4 · P1 · CONFIRMED** — Six shipped features have no entry point on iPhone except Universal Search: `/waiting-on` (the marketed chase list), `/deliveries` (the 09-02 batch — nothing on iOS can create a delivery, so Brain Watch can never show a late one), `/equipment`, `/marketplace`, `/auto-bids`, `/home-passport`, `/widget-setup`. The feature-search guard checks registry↔sidebar, not iOS. Fix: Discover tools rows, a Deliveries tile in project-detail, a Summary row for Waiting-on; extend the guard. Effort S.
- **PRODUCT-F5 · P2** — Five screens compute "projected final cost" with different inputs; labor rates live only in AsyncStorage; overtime never premium-priced. (= MONEY-F12.)
- **PRODUCT-F6 · P2 · CONFIRMED** — Nothing lets a GC record a payment to a sub outside the sub portal, so calibration, real-basis cost-book samples, the 1099 export and lien-waiver amounts are blind for the common case (`tax1099Export.ts:74` is `void opts.commitments; // Future`). The missing write behind the moat.
- **PRODUCT-F7 · P2** — Winning an RFP creates the project but drops the winning price and stamps `type = 'awarded_rfp'`, a type no engine knows (`award_rfp` RPC).
- **PRODUCT-F8 · P2 · CONFIRMED** — Tapping 7 of 12 server push kinds does nothing (`NotificationContext.tsx:62-118`); with browse gated off, the nearby-RFP fan-out still invites contractors by push+email to `/rfp-detail`, which renders the homeowner's free text and photos with no report/block — the Guideline-1.2 surface the flag was meant to remove is reachable from every fan-out; `/nearby-rfps` is a permanent empty state.
- **PRODUCT-F9 · P2** — Two markup conventions coexist in `LinkedEstimate` (markup-inclusive `lineTotal` vs separate markup); sweep #1/#2/#22/#28 were four symptoms of this one cause. Fix: `normalizeLinkedEstimate()` on every write path + an identity guard.
- **PRODUCT-F10 · P2** — Approved change-order line items never become billable rows (Bill-from-Estimate and G703 only see estimate rows).
- **PRODUCT-F11 · P2 · LIKELY** — The failed-inspection automation reflows successors with a second, calendar-blind engine (`recalculateStartDays`) and persists the result; every other reflow uses `runCpm` with the schedule's calendar.
- **PRODUCT-F12 · P2** — A delivery is an island: no schedule task, no daily-report link, two unlinked receipt objects.
- **PRODUCT-F13 · P2** — The weather delay log is desktop-only; the daily report's weather never reaches it and the DFR→delay handoff drops the cause.
- **PRODUCT-F14 · P2** — Pricing FAQ promises "Downgrade to Free and Pro features become read-only"; no read-only mode exists.
- **PRODUCT-F15/16 · P3** — Pricing page contradicts itself on the free bid cap (2 vs 3); sells the sub portal with "COIs, prequal, RFIs" it does not have.
- **PRODUCT-F17 · P2** — No notification exists for invoice paid (GC side), RFI answered, submittal returned, lien waiver received, schedule slip; COI warnings never reach the in-app inbox.
- **PRODUCT-F18 · P2** — The estimate wizard grounds the AI on the six largest-exposure cost-book entries regardless of the scope being priced (`estimate-wizard.tsx:303`).
- **PRODUCT-F19 · P3** — Captured-but-never-read fields: `xray` provenance (written by Cost X-Ray, zero readers), `qboSyncStatus/qboError`, `weatherAlerts` (never persisted), `bufferDays`, `DelayEvent.sealedAt`, and four declared-only fields.

### Operations, observability, jobs — `12-ops-observability-jobs.md` (14 findings: 4 P1, 10 P2)

- **OPS-F1 · P1 · CONFIRMED** — The cron 401s (= EDGE-F1) with the twist that `cron.job_run_details` recorded every one of those 2,898 fires as `succeeded` — pg_cron only records that the HTTP call was queued. Deploy dates line up with commits deployed by sessions that omitted `--no-verify-jwt`.
- **OPS-F2 · P1** — Dead trigger→notify path (= EDGE-F3/DB-F1). Also: the live `portal_messages` trigger is the older `notify_portal_message_fn` (fires on GC-authored messages too) while the correct `trg_notify_portal_message` exists unattached.
- **OPS-F3 · P1** — Both runbooks and `CLAUDE.md` deploy without `--no-verify-jwt` (= EDGE-F2). Full 26-function `false` list is in the report.
- **OPS-F4 · P1 · CONFIRMED (re-verified: `get_organization` → plan "free")** — Production is on the Supabase Free plan: no daily backups, no PITR, 1-day log retention, 150 s edge wall clock (two cron timeouts exceed it), auto-pause after 7 idle days. There is no backup of any kind and no runbook mentions it. DB is 45 MB. Fix: Pro plan before launch; until then a scheduled `db dump` + storage export from a founder machine or GitHub Action. Effort S decision / M job.
- **OPS-F5 · P2** — `fetch-external-data` returns 200 "cycle complete" and fires its heartbeat while SAM.gov rejects its key on every run (`API_KEY_INVALID`); the federal bid feed has been stale since April.
- **OPS-F6 · P2** — Sentry events are unsymbolicated by construction (`SENTRY_DISABLE_AUTO_UPLOAD=true` in production; no OTA source-map step). (= APPSTORE-F5.)
- **OPS-F7 · P2** — No universal links: no `associatedDomains`, AASA path returns the SPA's index.html. (= APPSTORE-F6.)
- **OPS-F8 · P2** — `app.mageid.app` serves no security headers except HSTS and `X-Robots-Tag`: no CSP, no frame-ancestors, no Referrer-Policy (portal tokens travel in query strings); hashed chunks served `max-age=0`. The marketing site already has the full block to copy.
- **OPS-F9 · P2 · CONFIRMED** — Cron SQL in the repo is a trap: the two un-prefixed migration files re-create three live jobs without `x-cron-secret` and duplicate four others under old names; `DEPLOY-NOW.sql:623-637` and `20260826180000_*` schedule the undeployed `portal-link-expiry-notice`; the runbook's `db push` (which moves only the phase-2 file) WOULD apply the expiry cron. Fix: delete the two stale files, strip DEPLOY-NOW, move both held-back migrations out before push.
- **OPS-F10 · P2 · LIKELY** — Expo push tokens are never validated or pruned (`DeviceNotRegistered` tickets arrive as HTTP 200 → marked `sent`).
- **OPS-F11 · P2** — Unsubscribe tokens are a 12-char FNV-1a hash keyed by a string literal in source (anyone with the deployed bundle can suppress any address); `schedule-ical` falls back to a literal HMAC key.
- **OPS-F12 · P2** — Nine collections are AsyncStorage-only with no Supabase mirror (material cart, scope sheets, takeoff + field verification + corrections, managed properties, cash-flow data, Ask/voice history) — wiped on sign-out by design, unrecoverable on device loss.
- **OPS-F13 · P2** — Nothing tells support what a user is running: no version/build/OTA id anywhere, `expo-updates` never called, no diagnostics export; `Sentry.feedbackIntegration()` loaded but never surfaced.
- **OPS-F14 · P2 · LIKELY** — Abuse/cost edges: `send-email` unlimited calls; anon `notify` unlimited across portal ids; 10 `verify_jwt:false` endpoints with no limiter; no global Gemini spend cap.
- Inventories in the report: live cron table (8 jobs), notification pipeline end to end (the outbox is an audit row, not a queue — no drain, no retry, no dead letter), ~40 server secret names (8 documented), analytics events emitted (19) vs declared (15 never emitted), recoverability (formerly-orphaned tables now backfilled; storage never in DB backups).

### Performance and scale — `13-performance.md` (17 findings: 4 P1, 9 P2, 4 P3; measured against production)

- **PERF-F1 · P1 · CONFIRMED** — Cold start is gated on four un-timed network round-trips even when a complete local cache exists; a stalled connection shows the crane loader until the OS times out (~60 s) (`app/_layout.tsx:546-551`, `ProjectContext.tsx:559-612, 5512`, `lib/supabase.ts:36-43` no fetch timeout). Fix: hydrate from disk first (query persister), `AbortSignal.timeout(8000)` with local fallback. Effort M (S for the timeout).
- **PERF-F2 · P1 · CONFIRMED** — Boot fans out 32 unbounded `select('*')` full-collection queries (+12 from sibling providers), each re-serialized into AsyncStorage inside the queryFn; zero `.eq('user_id')`, zero `.limit()`; photos add 20 sequential signed-URL batches. Estimated 3–5 MB of JSON parsed and rewritten on every cold start for a 30-project account. Fix: tenant-filter + column-select the boot queries, page photos/DFRs, persist once, cache signed URLs.
- **PERF-F3 · P1 · CONFIRMED** — The seven-bucket context split is defeated: `deleteProject` (in `coreData`) depends on all 31 collections, so any record change re-renders all 162 `useProjects()` files including the root navigator and tab bar (`ProjectContext.tsx:5484-5519, 5673-5683`). Fix: move `deleteProject`/`importData` to the cross-domain context via refs; a boot-only context for the navigator; narrow hooks on the three 5K-line screens. Effort M.
- **PERF-F4 · P1 · CONFIRMED** — Photos are uploaded at full sensor resolution (no `expo-image-manipulator` anywhere), thumbnails are the originals, the project photo grid mounts every photo in a ScrollView, and the daily signed-URL rotation busts the image cache. Fix: resize on capture (2048 px, 0.8), thumbnails, `expo-image` with a stable cache key, `FlatList numColumns=3`. Effort M.
- **PERF-F5 · P2 · CONFIRMED (re-verified: one 233 kB data-URI logo)** — The company logo is stored as a base64 `data:` URI in `profiles.logo_uri`, fetched with `select('*')` on every cold start and inlined into every PDF; it is why `profiles` PK reads average 125–183 ms. Unused `uploadBrandingAsset` helper already exists.
- **PERF-F6 · P2 now / P1 at ~100 tenants · CONFIRMED** — 301 of 337 policies re-run `auth.uid()` per row and 47 call `can_access_project()` per row (measured 20 µs/call); boot queries seq-scan every tenant's rows because the client never filters by tenant. Fix: `(select auth.uid())` wrap, client tenant filter, collaborator branch as a hashed sub-select, merge duplicate permissive policies.
- **PERF-F7 · P2 · CONFIRMED** — Realtime WAL polling is ≈92 % of recorded DB time, driven by every client subscribing unfiltered to `change_orders` and `public_bids` (browse is off) and a publication carrying four tables nobody subscribes to.
- **PERF-F8 · P2** — Every local mutation JSON-stringifies and rewrites the whole collection to AsyncStorage (N times for an N-photo DFR, once per Gantt bar drag); Android's 2 MB/6 MB limits fail silently (`saveLocal` swallows).
- **PERF-F9 · P2** — 26 of 27 client edge invocations and 15 edge functions have no timeout; `invokeWithTimeout` has zero callers; paid usage is counted before the model call. (= AI-F8.)
- **PERF-F10 · P2** — 19 exact-duplicate indexes on the hottest tables, 108 never-used indexes, 325 duplicated permissive policies.
- **PERF-F11 · P2** — Field collection screens (punch list, RFIs, invoices, submittals, time tracking, cash flow, delay events, permits, warranties, COI vault, photo triage) render every row via `.map()` in a ScrollView; time-tracking re-renders the whole screen every 30 s. Same class as launch-readiness #15, fixed for schedule surfaces only.
- **PERF-F12 · P2 · LIKELY** — Root navigator re-renders on every context change with 158 inline `options` objects.
- **PERF-F13 · P2** — Desktop `InteractiveGantt`/`GridPane` are unvirtualized and outside the four perf guards, which are shape-regex checks that cannot see render time.
- **PERF-F14–F17 · P3** — Three serial hops per tier-gated call; redundant pollers (queue depth every 4 s, feed poll + channel, push token written every launch); unbounded tables with no reaper (`notification_outbox`, `rate_limit_counters`, `cron.job_run_details`); cold-start-heavy edge imports and a 620 ms Discover bids query.

### Offline sync and data integrity — `05-offline-sync.md` (17 findings: 8 P1, 8 P2, 1 P3; one regression)

- **SYNC-F1 · P1 (P0 by the letter of the rubric) · CONFIRMED** — Children created offline in the same session as their project are permanently dropped on flush: the flush runs the parent's group and the children's groups concurrently, the child's RLS `WITH CHECK` (`can_access_project`) is evaluated before the FK, and the RLS error is classified terminal (`utils/offlineQueue.ts:347-355, 137-147, 306-322`). A DFR with photos filed on a project created in the truck is lost; the photo bytes upload and orphan. Fix: run `projects` groups to completion first; treat an RLS INSERT rejection on a projects-dependent table as retryable once. Effort S.
- **SYNC-F2 · P1 · CONFIRMED** — Sign-out and every password/OAuth sign-in delete both offline queues without flushing or warning; the dialog is a bare "Are you sure?" (`AuthContext.tsx:608-645, 504, 854…`). The stuck-sync → sign-out reflex destroys exactly the pending data. Fix: flush both queues in `logout()`; count pending items in the dialog; same-user re-login keeps the queue. Effort S.
- **SYNC-F3 · P1 · CONFIRMED** — Every child loader replaces local storage wholesale with the server list, so an offline-created record vanishes on the first online launch when the SELECT beats the flush's INSERT; nothing refetches after a flush; re-entry duplicates the invoice number (no unique `(project_id, number)` index). Fix: apply the projects-style local-only merge to every loader; invalidate after flush; unique index. Effort M.
- **SYNC-F4 · P1 · CONFIRMED** — A kill mid-flush re-sends inserts that already landed; duplicate-key is terminal and the record's dependent updates are dropped with a false "couldn't be synced" toast (write-back happens once, after all batches). Fix: treat 23505 on INSERT as success; write back per group. Effort S.
- **SYNC-F5 · P1 · CONFIRMED** — Project edits are whole-row upserts of an enqueue-time snapshot with no version check: a reconnecting phone replays a stale `schedule`/`estimate`/`client_portal` over the web app's newer edits, and the live merge adopts it. Fix: server-bumped `version` + patch writes + dead-letter on conflict. Effort M.
- **SYNC-F6 · P1 · REGRESSION/UNCLOSED** — Medium-sweep #24 is marked closed but was never implemented: `offlineQueue.ts:204` still keys on `data.id`; `project_financials` and `building_access_rules` payloads have none, so two queued upserts for the same project run concurrently and the older can win. Fix: widen the key fallback; pin it in the guard. Effort S.
- **SYNC-F7 · P1 · CONFIRMED** — The 800 ms project-sync debounce (and the 500 ms schedule persist above it) is an in-memory timer that never enters the queue, and nothing flushes on background: a kill inside the window loses the edit outright because the next launch's server-first load overwrites the only copy. Fix: flush timers + queue on `AppState` background; queue-first writes. Effort S.
- **SYNC-F8 · P1 · CONFIRMED** — GC portal messages are fire-and-forget: composer clears and a success haptic fires whether or not the insert succeeded (`hooks/usePortalThread.ts:128-145`, `app/client-messages.tsx:288-295`). Same class: notification read/dismiss, budget-proposal accept/decline.
- **SYNC-F9 · P2** — 35 direct Supabase writes bypass the queue; four are consistency bugs offline (portal thread, budget proposals, financing referral returns a token for a row that failed to insert, lien-waiver status silent no-op).
- **SYNC-F10 · P2 · CONFIRMED** — Four realtime subscriptions target tables not in the publication and can never fire: the client portal's `invoices`, `daily_reports`, `photos`, and `financing_referrals`.
- **SYNC-F11 · P2 · CONFIRMED (live)** — Nothing repairs photo rows that pre-date the upload-queue fix: production holds 4 `photos` rows and 3 daily reports with `file://` paths and one bucket path with no object for 14 days — blank tiles on web, in the portal, on any second device.
- **SYNC-F12 · P2** — CO approval that reflows the schedule is two independent writes with different timing and no linkage; a partial failure leaves `scheduleImpactApplied` true with an unmoved schedule that no device will re-apply.
- **SYNC-F13 · P2 · LIKELY** — Every sign-in path establishes the new session first and wipes the previous tenant's cache afterwards; on a shared device user B's projects query can persist user A's unsynced local-only projects under B's account (would be P0 if the ordering lands that way — needs a device test).
- **SYNC-F14 · P2 · LIKELY** — Lead conversion fires the `projects` insert and `project_financials` upsert concurrently; a live-path RLS rejection is toasted, not queued; after phase 2 the budget is simply gone for leads converted while the race lost.
- **SYNC-F15 · P2 · LIKELY** — `time_entries` has no project FK, so a deleted project's time entries come back as orphans through the union merge; the photo bucket is never reaped on project delete.
- **SYNC-F16 · P2** — Export→import is lossy in ways the UI does not state: eleven collections omitted, photo bucket paths emitted as "URLs", imported projects owned by another account become silent local-only zombies.
- **SYNC-F17 · P3** — Staged photo copies in `documentDirectory/mageid-photo-queue/` survive sign-out.
- Verified closed: sweep #3 (group abort) and #23 (photo drain).

### App Store submission and release engineering — `07-app-store-release.md` (12 findings: 1 P0, 3 P1, 4 P2, 4 P3)

- **APPSTORE-F1 · P0 · CONFIRMED** — Every existing native build (#11–#14) and the newest production OTA embed JS that predates the 09-02 App Store blocker fixes: `git show` of each build commit has 0 references to `CLIENT_SUBS_ENABLED` / `RFP_BROWSE_ENABLED` (both landed in `bd6721e4`, Sep 2). `EXUpdatesLaunchWaitMs = 0` means a reviewer's first launch runs the embedded bundle — the $19/$49 "Start free trial" client paywall (3.1.1) and the un-moderated RFP feed (1.2). The deploy plan calls for an OTA only. Fix: build #15 from HEAD and submit that. Effort S.
- **APPSTORE-F2 · P1 · LIKELY** — The build-#12 reanimated boot-crash trap is re-armed: the fix removed `react-native-reanimated` from package.json only; `bun.lock:1840` and `node_modules` still carry 4.1.7; an `expo export` from this checkout bundles `Native part of Reanimated` again (21.4 MB vs the 20.1 MB clean bundle); three native fingerprints share runtime `1.0.0`; `DEPLOY-VERIFIED:242-244` says "not in play". Only RNGH's guarded `require` stands between the fleet and a silent rollback on the first unguarded import. Fix: purge lockfile + node_modules, a `validate-native-surface.ts` export assertion in ship-check, `runtimeVersion.policy: fingerprint`. Effort M.
- **APPSTORE-F3 · P1 · CONFIRMED** — App Review's sandbox purchase will unlock the UI while every server-gated AI feature answers 403 and the client tells the reviewer who just bought Pro to "Upgrade to Pro" — the App-Review consequence of the known unset RevenueCat webhook secret (re-probed: still `500 Server not configured`). Fix: set the two secrets, register the URL, prove with one sandbox purchase before submitting. Effort S (owner).
- **APPSTORE-F4 · P1 · CONFIRMED** — Privacy policy and the planned App Privacy labels omit precise location, microphone audio, and Sentry crash/performance/session replay; `docs/app-store-metadata.md:127-140` lacks Location/Audio/Device ID rows. (= AUTH-F3.) Fix: declare the full label set; add Sentry/GPS/voice paragraphs.
- **APPSTORE-F5 · P2** — Unsymbolicated crashes by construction (`SENTRY_DISABLE_AUTO_UPLOAD`; `eas env:list --environment production` → no variables). (= OPS-F6.)
- **APPSTORE-F6 · P2** — No universal links; native auth redirects rely on custom-scheme 302s that Gmail's in-app browser blocks. (= OPS-F7.)
- **APPSTORE-F7 · P2** — The prepared listing copy promises "homeowners post projects, you bid" and the `bid` keyword while browse is off → 2.3.1.
- **APPSTORE-F8 · P2** — No App Review path: login mandatory, the only data-rich account is the owner's, whose override forces `business` and exposes the dev seeders — a reviewer handed that account cannot exercise IAP.
- **APPSTORE-F9–F12 · P3** — Boilerplate "Always" location strings; dead `UIApplicationShortcutItems` block (overwritten by the plugin; the photo shortcut never exists); doc drift (CLAUDE.md cites EAS project `9f6536e0…`, real is `00860b05…`; `delete-account` says no analytics tool while PostHog is live); `EXPO_NO_CAPABILITY_SYNC=1`, a `development` profile with no `expo-dev-client`, build #14's artifact expires 2026-09-22, orphan `react-native-maps` in node_modules.
- Verified OK: privacy manifest (template + aggregation; ITMS-91053 does not apply), Sign in with Apple parity, account deletion reachable, no Stripe digital-goods path on iOS (the client paywall's kill switches hold; `create-rfp-checkout` has zero callers), paywall 3.1.2 disclosures, notification-prompt timing, export compliance, dev surfaces owner-gated, first-launch safety.
- Release-day gaps (none in LAUNCH-CHECKLIST): native build from HEAD before `eas submit`; RC webhook proven with a sandbox purchase; ASC IAP products attached + Paid Apps agreement + privacy labels + a check for a lingering 1.1.0 version record; reviewer account + notes; Sentry token; lockfile purge; APNs/SIWA credentials and the Supabase redirect allow-list for `mageid://`; the on-device pass; a recorded known-good OTA group for rollback.

### App ↔ database contract — `03-schema-contract.md` (5 findings: 2 P1, 1 P2, 2 P3; 253 query chains, 181 write sites, 85 edge REST URLs, 28 RPC calls and every CHECK enumeration cross-checked mechanically)

- **CONTRACT-F1 · P1 · CONFIRMED (live probe, re-verified)** — Both architect/pro reply RPCs select `profiles.full_name`, a column that does not exist (`schema.sql:4424, 4484`); every "reply via portal" link ever emailed to an architect or sub fails with "Could not load this document." Neither function exists in any repo migration. Fix: one `CREATE OR REPLACE` using `company_name/contact_name/name`; open one real token. Effort S.
- **CONTRACT-F2 · P1 · CONFIRMED (live: 0 cost_seeds rows across 30 profiles)** — Every cost-seed write carries `deleted_at` (`utils/costSeedCore.ts:635`), the column deliberately not applied, so the whole cost book — not only deletes — is rejected with PGRST204, classified transient, and re-queued forever with no toast. The learned-cost moat is device-local for everyone and evaporates on reinstall. **Corrects START-HERE's held-back item #3**, whose recorded consequence covers only tombstones. Fix (no schema change): emit the key only when set. Effort S.
- **CONTRACT-F3 · P2 · CONFIRMED** — `companies` is read with `.order('fetched_at')`, a column that does not exist; the 400 is swallowed into the AsyncStorage fallback, so server company rows never load on any device (the closed sweep #14 fixed `public_bids` but not its three siblings; `job_listings`/`worker_profiles` identical, gated off).
- **CONTRACT-F4 · P3** — `submit_sub_change_request` references two nonexistent columns; dead, anon-executable SECURITY DEFINER. Drop it.
- **CONTRACT-F5 · P3** — Ten tables with RLS and policies that no code reads or writes (`draw_periods`, `labor_rates`, `material_prices`, `materials_pricing`, `owner_supplied_items`, `permit_templates`, `user_tracked_bids`, `zip_cost_factors`, `workers`, `estimate_versions`).
- Appendix worth acting on: the built `marketing/dist/portal/index.html` still calls only `portal_get_snapshot` (no `_v2`, no signed CO approval) — if Netlify serves `dist/`, link expiry is not enforced for viewers (verify which directory is published).
- Verified consistent: all 11 buckets exist; all 20 `onConflict` targets match a PK/UNIQUE; all RPC names/arguments match; all 85 edge REST column lists exist; every write payload has full NOT NULL coverage (F2 is the sole extra key); every CHECK enumeration matches the TS union or literal the app writes (table in the report).

### Frontend UX — `08-frontend-ux.md` (22 findings: 4 P1, 14 P2, 4 P3)

The dominant class is date-only parsing: 94 `new Date(<date-ish>)` + 23 `Date.parse` sites repo-wide, 11 traced to user-visible off-by-one-day defects, while `scripts/validate-calendar-date.ts` names only three files — the "guard that names files goes blind" pattern again.

- **UX-F1 · P1 · CONFIRMED** — Home and Summary "TODAY ON SITE" run one working day ahead of the schedule everywhere west of Greenwich (`Date.parse` of a bare `startDate` then local `setHours`; `app/(tabs)/(home)/index.tsx:373-376`, `app/(tabs)/summary/index.tsx:97-99`); the daily-report "Day N of M" hero is off the same way and counts weekends. The mobile schedule uses `parseCalendarDay`, so the app contradicts itself on day one. Effort S.
- **UX-F2 · P1 · CONFIRMED** — Mobile Month calendar, CSV export and the homeowner share link anchor the schedule a day early (`MobileScheduleScreen.tsx:98,386,396` passes the bare string to `MonthCalendarSheet.tsx:35` and `ExportCenterSheet.tsx:73,75`); the closed #6/#11 fix stopped at the screen. Effort S.
- **UX-F3 · P1 · CONFIRMED** — Lien-waiver "Through" date is written as the UTC day and rendered a day early (`app/lien-waivers.tsx:108,384,446,454`) — a legal field wrong twice. Effort S.
- **UX-F4 · P1 · CONFIRMED** — Permits and warranties change date after a sync: Postgres `date` columns round-trip bare and are parsed as UTC (`ProjectContext.tsx:1758,1761`; `permits.tsx:177,199,335,503`; `warranties.tsx:101-104`) — the two screens `utils/calendarDate.ts` cites as its reason to exist, and neither imports it. Effort S.
- **UX-F5 · P2** — `/submit-bid-response` dead-ends on a bare spinner with no Back when the RFP lookup returns null (`:380-386`) — the unfixed sibling of closed #13.
- **UX-F6 · P2** — `useProjectRole` returns null on `isError`, so the job-costing blank sheet is permanent after a failed collaborators query and `ProjectHero` silently drops the money hero. (= RT-R2.)
- **UX-F7 · P2 · CONFIRMED (computed)** — Report Inbox badges fail contrast: 1.8–2.8:1 in dark mode; the "Open" RFI pill is 2.0:1 in both themes (static `Colors.*Light` fills with theme-flipping text; the guard cannot see token references).
- **UX-F8 · P2** — Universal Search results for portal messages and price alerts open "Page Not Found" (`/client-portal`, `/price-alerts` do not exist; an `as never` cast hides it).
- **UX-F9/F10/F11 · P2** — Desktop scheduler "Due by" differs across Grid/Board/Dashboard and marks tasks overdue from 6 pm the evening before; weather-day labels a weekday early; sub daily updates stamped with the UTC day.
- **UX-F12 · P2** — `useProjects()` subscribes 163 files to all seven contexts; `coreData` is invalidated by any collection change. (= PERF-F3.)
- **UX-F13 · P2** — project-detail renders every schedule task and every photo unvirtualized inside its section modals.
- **UX-F14 · P2 · CONFIRMED** — The estimate wizard and Quick Quote are swipe-dismissible modals with no draft: a pull-down on step 5 discards everything — on the very first screen after signup (`app/_layout.tsx:1297-1310` vs the schedule wizard's `gestureEnabled: false`).
- **UX-F15 · P2** — Deliveries and Building Access add-sheets put four inputs and Save in a bottom-anchored Modal with no KeyboardAvoidingView.
- **UX-F16 · P2** — Deliveries and Building Access have no navigation entry on iOS at all; taxonomy diff: sidebar 66 routes, Tools grid 44, project tiles 47 — 30 sidebar-only, only 13 in all three. (= PRODUCT-F4.)
- **UX-F17 · P2** — Android: answering a bid question calls the iOS-only `Alert.prompt` (no-op).
- **UX-F18 · P2 · LIKELY** — Back is dead on any screen opened as the first route of a fresh web tab or a `mageid://` cold start: 254 unconditional `router.back()` vs one `canGoBack()`, no `initialRouteName`.
- **UX-F19–F22 · P3** — Sub-44pt touch targets incl. a 20×20 destructive photo-remove with no confirm; 18 icon-only pressables without `accessibilityLabel`; design-system lints are warn-only (641 warnings on 23 screens); 23 modules bake theme colors at module scope so a runtime theme switch leaves mixed palettes.
- Verified: `/rfp-detail` #13 fix holds; web globals are guarded; no hover-only actions; safe areas via insets everywhere.

### Code health, dependencies, configuration, tests — `11-code-health-deps-tests.md` (15 findings: 2 P1, 9 P2, 4 P3)

Re-verified today: tsc 0 errors; lint 0 errors / 2,931 warnings; jest 465/465; `expo install --check` clean; `expo-doctor` fails 2 of 18 (multiple lockfiles; duplicate `expo-constants`); 205 validators, none dark.

- **HEALTH-F1 · P1 · CONFIRMED** — Both documented deploy paths apply two of the three "deliberately held back" changes: `DEPLOY-NOW.sql:625/637/441` and `DEPLOY-VERIFIED` §2's `db push` schedule the portal-link-expiry cron against an undeployed function and add `cost_seeds.deleted_at`; none of the 17 local migrations ≥ 20260826 is registered in the tracker, so `db push` replays them all. (= OPS-F9.) Fix: retire `DEPLOY-NOW.sql`/`DEPLOY-RUNBOOK.md`, move both held-back files out, `migration repair` the applied versions.
- **HEALTH-F2 · P1** — No `config.toml`; the step-4 deploy command re-enables JWT verification on the Stripe webhook, `notify`, `seal-document`, `mcp`. (= EDGE-F2.)
- **HEALTH-F3 · P2 · CONFIRMED** — Two lockfiles: `package-lock.json` is a 4½-month-old snapshot of a different tree (still lists tRPC/Hono packages); `bun audit` on the real tree: 81 advisories, all build-time except dead `hono` (HIGH, CORS reflection) and unreachable `nanoid`; 40 extraneous packages in `node_modules`. Fix: `git rm package-lock.json`, reinstall frozen, drop `hono`.
- **HEALTH-F4 · P2** — `expo-av` is deprecated in SDK 54 and removed in 55; voice capture depends on it (`components/VoiceCaptureModal.tsx`). Migrate the one file to `expo-audio`.
- **HEALTH-F5 · P2 · LIKELY** — Money is formatted by 60 separate helpers; five app-side copies use `Math.abs`, so a credit change order shows no sign and its reflow preview says "Commits $5,000" for a −$5,000 credit. (= MONEY-F18.) One `formatMoney` + a lint that forbids local definitions.
- **HEALTH-F6 · P2** — 20 dead files (3,289 lines) incl. a diverging second sub-overpayment guard and the unmounted Hono backend; zero-import deps `zustand`, `hono`, `@stardazed/streams-text-encoding`, `@ungap/structured-clone`. (`react-native-worklets` is NOT dead — it is reanimated's required peer.)
- **HEALTH-F7 · P2** — Edge-function drift: two production functions have no source in git; five were deployed from a different working tree. (= EDGE-F12.)
- **HEALTH-F8 · P2 · LIKELY** — Build-path env drift: laptop-exported OTAs inline a live OpenWeather key that EAS builds and the docs say does not exist; 6 of 10 `EXPO_PUBLIC_*` reads are absent from `eas.json`; the Supabase anon key is hard-coded as a fallback in four files. Fix: every read key present in `eas.json` (empty where "off") + a parity guard.
- **HEALTH-F9 · P2** — 24 direct writes in five document engines bypass `supabaseWrite` and return null offline (contracts, lien waivers, selections, closeout, bid questions). (Overlaps SYNC-F9.)
- **HEALTH-F10 · P2 · CONFIRMED** — The offline queue's own enqueue failure drops the write with a `console.log` (`utils/offlineQueue.ts:103-124`) — optimistic local state stands, nothing queued, nobody told.
- **HEALTH-F11 · P2 · CONFIRMED** — Zero executing tests on `offlineQueue`, `billingFlowCore` (dunning), `aiaBilling`, `localCacheKeys` (tenant wipe), `projectFinancials`, the document engines; 37 of 205 guards are regex-on-source, including the ones for exactly the bug classes that reached production. Ten concrete tests are specified in the report.
- **HEALTH-F12–F15 · P3** — 352 `as any` (project-detail 60), 124 `: any`, 51 `eslint-disable`, 477 `console.log`, 189 empty catches (20 on money/sync/auth paths, all inspected as benign); 15 files over 2,000 lines with named seams; tracked root junk (`Untitled.base/.canvas`, `.verb.md`, business `.docx/.xlsx`, superseded `LAUNCH.md`, stray `expo-env.d.ts`); seven functions hand-decode the JWT while `verifyUser` exists (= EDGE-F14).
