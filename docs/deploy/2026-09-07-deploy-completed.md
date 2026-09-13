# Final-push deploy — executed 2026-09-07

Companion to `docs/deploy/2026-09-04-final-push-deploy.md` (the plan). This is
what actually happened, in order, with the evidence.

Production is `nteoqhcswappxxjlpvap`. Everything below is live.

## What shipped

| Step | State |
|---|---|
| 1. Secrets | `SCHEDULE_ICAL_SECRET`, `UNSUB_SECRET` set (2026-09-07) |
| 2. Migrations | **11/11 applied**, every post-condition passed |
| 3. Static pages | `mageid.app` published from `main` |
| 4. Edge functions | **57/57 deployed**, 0 failures; 2 orphans deleted |
| 5. App | PR #145 merged to `main` (`54fe9aa8`) |
| 6. Financials backfill | re-run immediately before the OTA — 0 missing / 0 behind |
| 7. Money repair | 5 sub-cent rows + 1 retention row corrected |
| 8. OTA | published, runtime 1.0.0, group `17bdf656` |
| 9. Verify | live probes below |
| Build #15 | **FINISHED** — `a8be02f6`, buildNumber 17, runtime 1.0.0, channel `production`, IPA present |

**NOT submitted to the App Store.** `eas submit` starts Apple review and is a
release decision, not part of this runbook. The binary is built and waiting.

## Live verification, after the fact

Run as `anon` with the public key — the three that matter:

```
portal_get_snapshot_v2   -> 400 P0001 "portal_denied"        (still reachable; the portal works)
cost_benchmark_stats     -> 401 42501 "permission denied"    (was readable by anyone)
portal_mark_item_viewed  -> 404 PGRST202 (not in schema cache) (was a cross-tenant write)
```

The four cron functions now answer from their own code instead of being refused
at the gateway — which is what "every cron fire since July 401'd" looked like:

```
morning-digest   401 {"error":"unauthorized"}
invoice-dunning  401 {"success":false,"error":"unauthorized"}
qbo-reconciler   401 {"success":false,"error":"cron auth required"}
portal-ask-home  400 {"success":false,"error":"Missing portalId, accessToken, or question"}
```

### The cron fix, observed in `net._http_response`

Not inferred — the rows either side of the function deploy (~17:47 UTC):

```
17:00  401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
17:05  401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
17:30  401  {"code":"UNAUTHORIZED_NO_AUTH_HEADER","message":"Missing authorization header"}
--- deploy ---
18:00  200  {"success":true,"message":"Data fetch cycle complete"}          fetch-external-data
18:00  200  {"success":true,"pushed":0,"pulled":0,"costStaged":0,"errors":2} qbo-reconciler
18:05  200  {"ok":true,"fired":0,"results":[]}                              morning-digest
```

The 401s were the GATEWAY refusing the request before any code ran — the
`verify_jwt: true` that had been wrong since July. Every response after the
deploy is the function's own answer.

`qbo-reconciler`'s `errors: 2` is expected and not a regression: the preflight
found its only QBO grant is a sandbox token with `access_expires_at`
2026-05-26. It is now running and reporting, where before it never ran at all.

`schedule-ical` still returns `401 Bad token` for a token minted from the old
public fallback literal. `sync-bids` and `fetch-material-price` return 404.

## Five defects found DURING the deploy, before they shipped

The pre-deploy audit and the deploy itself surfaced five real bugs that were not
in the 211-finding audit. All five are fixed, guarded and on `main`.

1. **The postinstall hook failed every Linux install.**
   `scripts/patch-ios-space-paths.sh` used BSD-only `sed -i ''` under `set -e`.
   GNU sed exits non-zero, so Netlify's "Install dependencies" stage died before
   the build command ran — every `app.mageid.app` deploy since 2026-09-06. `main`
   was still green, so merging would have carried it onto `main`.

2. **The config plugin wrote a Podfile that would not parse.**
   `withQuotedXcodeScriptPaths` injected a Ruby block with an unterminated string
   literal. `ios/` is gitignored, so no local build ever regenerated the Podfile
   and only EAS ran it — build #15 died in "Install pods". The exact inverse of
   the bug the plugin exists to fix.

3. **`eas.json` declared `EXPO_PUBLIC_OPENWEATHER_API_KEY` as an empty string**,
   which EAS rejects at schema validation. No production build could start at
   all. The key is now an EAS environment variable, not a value in this public
   repo.

4. **"Duplicate project" copied the source's portal credential.** The clone was a
   spread of the source with a few fields stripped; `clientPortal` was not one of
   them, so a copy inherited the source's `portalId` AND its `accessToken`. With
   the new unique index it would have failed `23505` on first sync, and
   offlineQueue discards that as terminal — a copy that lives on one device
   forever, silently.

5. **`20260826130000_field_role` granted nothing**, relying on CREATE OR REPLACE
   preserving ACLs. True against production; on a rebuilt database where
   `100200` runs first it would create the collaborator helpers
   `{owner, service_role}` only and lock every collaborator out of twelve tables.

## Build #15 took three attempts. Two of the failures were introduced by the fixes.

Recording these because they are the argument for reproducing rather than
theorising — I guessed wrong twice before reproducing locally.

1. **Empty `eas.json` key** (pre-existing). EAS rejects an empty env value at
   schema validation, so no production build could start at all. Not a build
   failure — a refusal to begin.
2. **Unparseable Podfile** (introduced by the space-path plugin). Died in
   "Install pods". Invisible locally because `ios/` is gitignored and already
   existed, so no local build ever regenerated the Podfile.
3. **Lost executable bit** (introduced by the postinstall portability fix, the
   same morning). Making the script portable replaced `sed -i` with
   write-temp-then-`mv`; `mv` installs a fresh file at the default umask, so
   the patched Xcode build-phase scripts became 644. Xcode runs them directly:
   `Permission denied`, and "Run fastlane" fails.

   Diagnosed by reproducing it: `expo prebuild --clean` + `pod install` +
   `xcodebuild -configuration Release` failed identically (exit 65, same
   phase). The file modes were the proof — expo-constants' script, patched on
   09-06 by the old `sed -i`, was still 755; expo-updates', patched 09-07 by
   the new code, was 644.

   Fixed by writing back in place with `cat > "$f"` — same inode, so mode,
   ownership and xattrs survive, and it needs neither `stat` nor `chmod`
   (which differ between BSD and GNU).

Each now has a guard that fails on the exact defect, all mutation-tested:
`ruby -c` on the injected Podfile block, `+x` on both patched scripts, no
`sed -i`, no `set -e`, explicit `exit 0`, and — for (1) — env-parity's new
"EAS-managed key must NOT be back in eas.json".

## Known-open, deliberately

- **UNSUB-C1**: `utils/emailLayout.ts` still mints unsubscribe tokens with the
  old public literal. "manage email preferences" already fails for homeowners;
  "Unsubscribe" breaks 2026-10-04 when the server grace path is deleted. The
  client cannot hold the HMAC key, so the fix is a pipeline change.
- **offlineQueue's `_pkey`-only 23505 exemption** turns any future unique
  constraint into a silently dropped write. `100950` added the first one.
- **The "Maximum update depth exceeded" crash** is still unproven. See
  `docs/audits/2026-09-06-runtime-audit.md`.
- Four migrations remain in `supabase/migrations/held/`.
- `AUTH-F8` portal-token rotation is server-side ready with no client caller.

## Note on ordering

`100400` and `100900` fight over the same three storage policies — `100400` sets
them to the `editor` tier, `100900` to `field`. Both are individually
idempotent, which is the trap: re-running `100400` later silently reverts the
field tier. **`100900` must always be last of the pair.**

---

# Gate for the NEXT ship (added 2026-09-08)

## Deploy the `ai` edge function BEFORE the next OTA. Not optional.

The deployed function is **v37**, and it still carries

```ts
const FEATURE_MIN_RANK: Record<string, number> = {
  aiEstimateWizard: 1,    // pro
```

The branch removes that floor and re-registers `aiEstimateWizard` explicitly in
`KNOWN_FEATURES` (removing a floor also removed the registration, because that
Set is built from `...Object.keys(FEATURE_MIN_RANK)`).

The client half is already on the branch. `app/estimate-wizard.tsx:400` now
sends `'aiEstimateWizard'` as the feature tag, and `app/takeoff-estimate.tsx:337`
sends the same. Before 2026-09-07 the wizard sent no tag at all, so the server
scored it as `general` and no floor ever fired — that accident is the only
reason free onboarding has ever worked.

So the two halves are now in a strict order:

| order | state | what a free user gets from /estimate-wizard |
|---|---|---|
| today (v37 server, shipped client) | untagged | works — scored `general` |
| **OTA first** (v37 server, branch client) | tagged, floor live | **403 `tier_required`** |
| deploy first (v38 server, shipped client) | untagged | works — scored `general` |
| deploy then OTA | tagged, no floor | works |

The third row is why deploying first is safe: removing a floor is strictly
permissive and cannot break a client that predates the tag. The second row is
the one that ships a broken app — and it breaks **the last tap of onboarding**
(`app/onboarding.tsx:233` routes every new account into
`/estimate-wizard?onboarding=1`), i.e. the activation moment, for every free
user.

```bash
supabase functions deploy ai --project-ref nteoqhcswappxxjlpvap
```

Verify it took before OTA'ing — the deployed source must NOT contain
`aiEstimateWizard: 1`:

```bash
supabase functions download ai --project-ref nteoqhcswappxxjlpvap -o /tmp/ai-check && grep -c 'aiEstimateWizard: 1' /tmp/ai-check/index.ts
```

Expect `0`. `grep -c 'aiEstimateWizard'` should still be ≥ 1 — the id must
remain in `KNOWN_FEATURES`, or every AI estimate 400s instead.

Nothing else on this branch changes any edge function; `ai` is the whole
server-side delta (`git diff --name-only origin/main...HEAD -- supabase/functions/`).

---

# Why the daily brief was empty (traced 2026-09-08, from a real inbox)

The founder reported the emailed daily brief as "terrible. Nothing good" —
a giant serif **"Quiet day."** over one sentence saying nothing.

## There are two daily digests, and only the thin one was reaching the inbox

| function | reads | cron | state before 2026-09-07 |
|---|---|---|---|
| `morning-digest` | today's schedule tasks, yesterday's DFRs, open RFIs, hyperlocal weather | `5 * * * *` | **401 at the gateway. Never ran.** |
| `daily-digest` | `notification_outbox` only | `0 13 * * *` | ran daily, sent 20 emails |

`morning-digest` is the substantive one. Its cron POSTs with `x-cron-secret`
and no bearer JWT, and the function was deployed with `verify_jwt: true`, so
the **gateway rejected every call before the function ran**:

```
2026-09-07T13:05:02  POST | 401 | .../functions/v1/morning-digest
2026-09-07T12:05:02  POST | 401 | .../functions/v1/morning-digest
```

This is exactly the EDGE-F1/F2 class `CLAUDE.md` warns about: a pg_cron target
redeployed without `--no-verify-jwt` silently resets the flag to `true`. It had
been failing this way for months — `notification_outbox` holds **zero**
`morning_brief` rows in its entire history, while the profile has had
`digest_enabled = true` since 2026-08-06.

**The 2026-09-07 deploy fixed it.** `supabase/config.toml` now pins the flag,
and the same endpoint has returned 200 on every hourly run since 18:05 UTC:

```
2026-09-08T05:05:02  POST | 200 | .../functions/v1/morning-digest
… every hour back to 2026-09-07T18:05
```

It has reported `{"ok":true,"fired":0}` on each of those, which is correct —
the only enabled profile has `digest_hour = 9` in `America/New_York`, and every
run since the fix has been 8pm–1am ET. **The first genuine morning briefing
lands at 13:05 UTC (9:05am ET) on 2026-09-08.** Nothing more to do; watch for a
`morning_brief` row.

## What was actually wrong with the email that DID arrive

`daily-digest` reads `notification_outbox` and nothing else. That table has
**one** event type in it — `daily_digest_sent`, its own send marker. There has
never been a portal message, CO approval, budget proposal, sub invoice or RFP
award. So `totalEvents` was 0 on all 20 sends and every one of them rendered
the quiet-day template.

Three fixes on this branch:

1. **An empty digest is no longer sent at all.** The old code sent on weekdays
   on the theory that the cadence was reassuring. It is the opposite: an email
   that is empty most mornings teaches the reader to archive the subject line
   on sight, so the mornings that *do* carry an unanswered client message get
   archived with them. The quiet-day body, subject and preheader are deleted
   rather than left behind a flag.
2. **The self-addressed sender footer is gone.** `wrapEmailHtml`'s `sender`
   block renders *"Sent by <name> · <email> · <phone>. Replies go to them, not
   us."* — copy for a homeowner reading a contractor's email. On a digest
   addressed to the GC it printed his own name, address and phone back at him
   and told him replies would reach himself.
3. **One brand per header.** The right-hand `MAGE ID` pill means "sent THROUGH
   MAGE ID" and only makes sense opposite a contractor's own name. It rendered
   unconditionally, so any email with no `companyName` showed the wordmark on
   the left and the identical wordmark in a pill on the right.

Five checks in `scripts/validate-email-honesty.ts` pin all three, each
mutation-tested (re-add the empty send, restore the quiet body, restore the
sender block, restore the unconditional pill, restore the empty subject —
all five fail the guard).

**Deploy note:** `daily-digest` and `_shared/email.ts` both changed, so
`daily-digest` needs a redeploy. `_shared/email.ts` is bundled into every
function that imports it, so the header fix reaches other emails only as those
functions are redeployed.

---

# Two migrations written and NOT applied (2026-09-08)

Both are new tables plus policies — additive, nothing dropped, nothing altered
on an existing table. Neither has any effect until its client half ships, and
each is independently safe to apply early.

### `20260908120000_bid_package_invites.sql` — invitation to bid

Unblocks worth-doing #24. `bid_package_bids` carries one policy,
`user_id = auth.uid()`, so a subcontractor — who has no account — could never
write a bid; every competing bid in the buyout matrix is typed by the GC. This
adds `bid_package_invites` (owner-scoped RLS, `anon` gets nothing) and two
SECURITY DEFINER RPCs granted to `anon`:

- `bid_invite_get(token)` — the package scope only. Deliberately **not**
  `estimate_budget`: handing the GC's own number to the people bidding against
  it would anchor every bid just under it.
- `bid_invite_submit(token, …)` — inserts into `bid_package_bids` stamping
  `user_id` **from the invite row**, never from the caller. That is the line
  that lets an owner-scoped table accept a write from someone with no account
  without widening the policy for everyone else.

Both raise `bid_invite_denied` on any failure so a caller cannot tell "no such
invite" from "wrong token". Modelled on `sub_portal_submit_invoice`.

### `20260908120100_cashflow_and_wip_overrides_sync.sql` — stop a bank-facing number reverting

The WIP cost-to-date override lives only in AsyncStorage. A GC types $340,000 of
self-performed labor into it on the laptop, opens WIP on his phone where the map
is empty, and the screen falls back to the subs-plus-materials lower bound. He
freezes the period and exports it — and the locked period **does** sync, so what
reaches his surety is a schedule that quietly reverted to a number he had
already corrected, with nothing on screen saying so.

`wip_cost_overrides` is one row per project, not one blob per user, so
correcting Henderson on the phone cannot wipe the Ridgeline override typed on
the laptop an hour earlier. `cash_flow_settings` keeps `expenses` and
`expected_payments` as jsonb, which **is** last-writer-wins on those two lists —
stated in the migration header, and the client must not describe them as merged.

Apply with the Supabase MCP `apply_migration`, never `supabase db push` (the
migration history is divergent, and four migrations in `supabase/migrations/held/`
must not be swept into a push).
