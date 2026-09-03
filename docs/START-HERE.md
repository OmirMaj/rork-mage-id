# START HERE — orientation for a new session

_Written 2026-08-19 at the end of a long working session, so the next one begins
where this ended. Read this, then `CLAUDE.md`, then `docs/PRODUCT-BIBLE.md`._

---

# ⚠ CURRENT STATE — 2026-09-03. READ THIS BEFORE ANYTHING BELOW.

Everything under this banner is current. The sections further down were written
2026-08-19 and are still broadly true about the product, but their status claims
are stale.

## Where the work stands

Two full audits were run and closed. Findings live in:
- `docs/audits/2026-08-31-medium-sweep.md` — 32 findings, all closed or refuted
- `docs/audits/2026-09-02-launch-readiness.md` — 16 findings, 14 closed, 2 PARTIAL

`bun run ship-check` is green: **205 guards, 465 jest tests, tsc clean.**
`expo export` passes for both ios and web.

## THE DEPLOY IS HALF DONE. Read `DEPLOY-VERIFIED-2026-09-02.md` next.

Applied to production directly (via Supabase MCP `apply_migration`, each
verified by introspection):
- the security batch — anon-executable `grant_rfp_post_credit` locked, two RLS
  write leaks closed, ownership-freeze triggers, account-deletion FK cascades,
  `subscriptions_tier_check` widened to accept `'enterprise'`
- the feature batch — `project_financials` (backfilled), `deliveries`,
  `building_access_rules`, `access_reservations`, `portal_get_snapshot_v2`,
  9 columns, 6 indexes, 16 policies

**NOT deployed, and all still blocked from the CLI in that session:**
- `git push` — the repo is ~108 commits ahead of origin/main
- the edge functions. `invoice-dunning` is STILL emailing clients a "FINAL
  NOTICE" demanding retention their contract entitles them to hold, on every
  run. This is the most user-visible harm still live.
- the OTA. Every app-side fix from those audits is in the repo and not on any
  device.

## THREE THINGS DELIBERATELY HELD BACK — do not just apply them

1. **`20260826180000_portal_link_expiry_cron`** — schedules a pg_cron job that
   calls the `portal-link-expiry-notice` EDGE FUNCTION, which is not deployed.
   Applying it produces a silent stream of failing runs. Apply AFTER that
   function ships.
2. **`20260827120000_project_financials_drop_legacy`** — PHASE 2. It drops
   `estimate` / `linked_estimate` / `estimate_versions` / `target_budget` off
   `projects`. Phase 1 is applied, so the money lives in BOTH places and the
   current app works. Phase 2 must not run until the OTA is live and verified,
   or it removes columns every installed build still reads. **`supabase db push`
   applies in filename order and WILL run it with everything else** — move the
   file out of the directory for a bulk push.
3. **`alter table cost_seeds add column deleted_at`** from `20260826150000`.
   cost_seeds is under a standing do-not-touch instruction, so that migration
   was SPLIT and only its `delay_events` index applied. Consequence: soft-delete
   of a cost seed does not persist — `hooks/useCostSeeds.ts` writes a tombstone
   the table cannot hold, so the UNION merge resurrects it. Needs a founder call.

## FOUR OPEN FOUNDER DECISIONS — not bugs, do not "fix" unilaterally

1. **`RFP_BROWSE_ENABLED = false`** (`app/(tabs)/mage-id-bids/index.tsx`).
   Browsing other users' RFPs is gated OFF for 1.0 because App Store Guideline
   1.2 requires report/block/filter for user-generated content and none exists.
   Posting and "My RFPs" still work. The full 1.2 kit is specced in the
   launch-readiness doc as a 1.0.1 item.
2. **`CLIENT_SUBS_ENABLED = false`** (`components/ClientPaywall.tsx`). The $19
   and $49 client tiers never touched StoreKit — `handleStartTrial` was an
   AsyncStorage write — which is Guideline 3.1.1. The homeowner path ships FREE
   for 1.0. Turning it on needs real RevenueCat products.
3. **"Verified pros only"** (`app/post-rfp.tsx`) was fixed by DE-SCOPING the
   claim to notifications only. If it should actually restrict who can BID,
   that enforcement is unbuilt.
4. **`notification_outbox_recipient_kind_check`** allows `['gc','client','sub']`
   while the app writes `'user'`. Widen the constraint or fix the app? Nobody
   has decided. No migration exists.

Two more are recorded in the medium-sweep doc as tested, deliberate models
awaiting a call: `utils/jobCostEngine.ts:245` (client payments counted as
job-cost actual) and `utils/aiaBilling.ts:144` (`thisPeriod = scheduledValue`).

## WHAT IS STILL UNPROVEN

**None of this has run on a physical iPhone.** It is static analysis, jsdom
mounts and database introspection. The closing section of
`DEPLOY-VERIFIED-2026-09-02.md` lists five on-device checks, each sitting
exactly where a bug was just fixed:
delete an INVITED account · import a 1,000-row MS Project file and scroll ·
offline create-then-approve a change order and check a second device ·
open the schedule in a negative UTC offset · post an RFP as a homeowner.

## TWO THINGS THAT WILL MISLEAD YOU

1. **`supabase/schema.sql` is authoritative; the migrations are NOT.** The
   migration tracker's last entry is `20260804225749` while objects from far
   later migrations exist and earlier ones do not. During the 08-31 audit two
   agents read `schema.sql` when it was stale and filed FALSE bug reports. It is
   now regenerated from production with a per-section MD5 verification — its own
   header explains how to re-run that check. Regenerate it after any deploy.
2. **A guard that names files goes blind.** `validate-schedule-date-basis` named
   three components and therefore never looked at `MobileScheduleList`, the
   primary iOS schedule surface, which kept the exact bug the guard existed to
   catch. Same shape as `validate-alert-shim`, whose ROOTS omitted `utils/`.
   **Enumerate, do not list.** `scripts/validate-guard-coverage.ts` exists
   because 19 validators were on disk and unreachable from `ship-check` —
   including four security ones. It fails the build if a validator is not wired.

---

## What MAGE ID is, in four lines

React Native / Expo construction-management app for **small-to-mid general
contractors**. iOS-first (`ios.supportsTablet: false`), web secondary via RN Web.
Pre-launch, **no active users** — breaking changes need no grandfathering.
Tiers: free / Pro $29 / Business $79 / Enterprise $150.

**The moat:** a cost book that learns from closed jobs, with an absolute rule —
*a rate the contractor STATED is never presented as one we MEASURED.* Research
found no competitor in this segment does this; several claim "historical costs"
and mean a static catalog or a bought third-party feed. That firewall is
enforced in the engine, in every AI prompt, and now visibly on the estimate row
(`components/estimate/RateProvenanceChip.tsx`).

## Read these, in this order

| Doc | Why |
|---|---|
| `CLAUDE.md` | build/commands/architecture. Auto-loaded. |
| `docs/PRODUCT-BIBLE.md` | product, personas, strategy |
| `LAUNCH-CHECKLIST.md` | **the only true launch blockers** |
| `docs/audits/2026-08-16-ios-visual-audit.md` | 19 defects found by running the app |
| `docs/audits/2026-08-17-web-audit.md` | 22 more, web-specific |
| `docs/audits/2026-08-15-where-mageid-could-lead.md` | market research; where the moat is |
| `docs/audits/2026-08-15-bid-qualification-brief.md` | next feature, 3 decisions already made |
| `docs/audits/2026-08-19-product-decisions.md` | founder calls on 4 deferred items |
| **`DEPLOY-VERIFIED-2026-09-02.md`** | **the live deploy state + ordered runbook. Read this second.** |
| `docs/audits/2026-08-31-medium-sweep.md` | 32 correctness findings, closed |
| `docs/audits/2026-09-02-launch-readiness.md` | 16 App Store / tenant-isolation findings |

## THE OPERATIONAL GOTCHAS — these cost hours, none are obvious

1. **`bun run test:smoke` ran ZERO tests inside a git worktree** until 2026-08-18.
   Fixed (`<rootDir>/.claude/`), but if you ever see "No tests found", you are on
   a stale base. Several agents reported "402 passed" while running nothing.
2. **Port 8081 is often held by an unrelated project's Metro** (`cutlist`, from
   `~/Desktop/BELI MOVIE`). A dev build defaulting to 8081 silently loads the
   WRONG bundle. Use 8083 and confirm the app is MAGE ID.
3. **Fast Refresh does not work** in the simulator setup here. Terminate and
   relaunch after edits or you will screenshot stale UI and "verify" nothing.
4. **Theme tokens are NOT what you expect.** `ThemeColors` has **no**
   `.error` / `.warning` / `.success` in most contexts. Real names: `danger`,
   `dangerSoft`, `dangerLabel`, `info`, `warningLabel`, `success`, `successSoft`,
   `text`, `textSecondary`, `textMuted`, `surface`, `surfaceAlt`, `line`,
   `accent`, `accentSoft`. `Tokens.radius.full` (not `pill`).
   `Type.caption1`/`caption2` (not `caption`). Repo lints against hex literals
   and inline `fontSize`. **Verify against `constants/colors.ts` — do not guess.**
5. **Agent worktrees have no `node_modules`.** Node resolves upward so tsc/jest/
   eslint work, but Metro cannot bundle. Symlink from the main checkout.
6. **Two test systems, deliberately.** ~140 `bun` scripts in `scripts/validate-*.ts`
   (pure logic + source assertions) AND a jest smoke suite (~404 tests, mounts
   every route in empty + populated states). Neither replaces the other.
   `scripts/validate-workflow-pipelines.ts` has **no `test:*` entry** — a
   file-glob sweep catches it, `bun run test:*` does not.

## THE LESSON THIS SESSION KEPT TEACHING

**Documents lie; code doesn't.** Nearly every significant find came from a doc
confidently asserting something the code contradicted:

- the workflow roadmap invented warranty states (`walk_scheduled`) that exist nowhere
- it said "permits is TODO" — permits was wired, and wrong
- a PR was closed "superseded by #116"; only half of it was
- `git branch --no-merged` showed 41 branches; **40 were squash-merge artifacts**
- `jobCostEngine`'s own comment claimed variance goes negative when over. The
  formula says positive. **The UI trusted the comment and told contractors they
  were $49K under budget when they were $49K over.**
- an implementation plan (mine) assumed detail views that didn't exist
- an agent was told hero text measured 1.08:1; it rendered the tree and found
  15.56:1 — the audit tool couldn't see an opaque gradient sibling

**And: 402 automated tests found zero bugs. Twenty minutes in the simulator found
nineteen.** Mounting is not working. Nothing substitutes for opening the app.

Every guard added this week exists to make that class fail loudly —
exhaustiveness, purity, partial-day rounding, placement, transaction guards,
provenance, storage hygiene, contrast. **Each was verified by deliberately
breaking it.** Keep that standard: a guard nobody has watched fail is not known
to work.

## State as of 2026-08-19

**Merged this session:** de-lawyering + cost-seed convergence · hero stats ·
workflow lifecycle core · rate-provenance chip · runtime test suite (0 → 404) ·
iOS build fix · storage/tenant leak · job-costing sign inversion · contrast ·
test harness · 4D homeowner portal view.

**In flight:** a workflow fixing the remaining audit defects across six
`claude/fix-*` branches, each adversarially reviewed before merge.

**Blocked on the founder, and ONLY the founder:**
1. `ALTER TABLE public.cost_seeds ADD COLUMN IF NOT EXISTS deleted_at timestamptz;`
2. **RevenueCat webhook secret** — unset, so paying users get 403 on every
   server-gated AI feature
3. **Sandbox web billing key in `eas.json`** — confirmed live in production, so
   web purchases are not real money
4. **A Release build has never been run** since the iOS build fix. The fix was
   verified in Debug; the bug's significance was that Release bundling breaks.

**Known unfixed:** ~30 defects across the two audits, ranked. Five orphaned
production tables (`draw_periods`, `owner_supplied_items`, `contractor_licenses`,
`delivery_receipts`, `permit_templates`) whose **schema exists nowhere in git** —
two are unrecoverable if production is lost.

## Next feature

**Bid qualification** — click a bid posted online, see whether your company
qualifies. Three decisions already made (see the brief). The insight: MAGE ID
holds BOTH halves — the solicitation and the company's licenses, COI, bonding
and prequal. A bid board has one; Procore and Buildertrend have neither with a
measured cost book. And it inverts the failing model: lead-gen sells MORE bids,
this sells FEWER by naming the ones you'd waste a week losing.
