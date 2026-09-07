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
