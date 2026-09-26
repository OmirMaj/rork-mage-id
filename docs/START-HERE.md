# START HERE — orientation for a new session

_Written 2026-08-19 at the end of a long working session, so the next one begins
where this ended. Read this, then `CLAUDE.md`, then `docs/PRODUCT-BIBLE.md`._

---

# CURRENT STATE — 2026-09-25 (desktop waves 6a–6d + the smoothness pass)

The founder works in the web app (app.mageid.app, react-native-web) on a
1512 × 945 MacBook: "the website app … really isn't utilizing the space a
computer screen gives you"; "the scheduler does not work well"; "the boxes are
so stretched out". Waves 6a–6d are the answer. iOS stays the primary target and
every desktop change is gated so the iPhone renders byte-identically (each
wave recorded phone goldens FIRST and ran them with --ci afterwards).

## 1. What is live

- **6a — schedule surfaces.** The scheduler AI fix (closed anyOf relay,
  7f4cc150) and the schedule surfaces the founder called broken.
- **6b — desktop primitives** (components/ui, components/desktop):
  ActionBar (+ ActionBarReadout), Button's desktop sizing (fullWidth capped at
  Layout.button.fullWidthMax), Sheet (useSheetFrame / useSheetDialogScope /
  useSheetPrimaryHotkey / SheetOverlay; SheetScrim from 6d P0),
  SegmentedControl + segmentedDesktop, TileGrid, ChipRail, Card/cardSurface,
  DesktopPageFrame, DataTable, SplitView, SidePanel, FormGrid, LineItemGrid,
  KpiStrip, NoticeStrip, ToolbarActions, RowLink, JobSwitcher, ShellDock.
- **6c phase A** (3643fab4, merged e2a453d6): the 64 px sidebar rail, the
  dialog scope for sheets, the one-screen job page, the DFR log beside the
  report and the field screens.
- **6c phase B** (57f9ffc1, merged e16fb8dd): Schedule Pro's two-row toolbar
  and docked AI pane, scheduleDestination routing, the portfolio Home and
  /attention, the RFI / submittal / change-order / invoice logs.
- **6d** (trimmed: the founder is low on credits; K1/K2 Ask dock + Cmd+K
  palette + CreateMenu popover + sidebar power layer, X1–X3 sheet batches, Z1
  print + header alignment and B2 WIP/Reports/Buyout were CUT).
  Merged and live (OTA per phase; gate green except the known-red release keys):
  - P0 (c1086c0c): Layout column/register/print, ContentWidth folded into Layout,
    SheetScrim, the SA6/SA7/SA3 sheet rules.
  - Phase 1 (8a124b20, OTA fee0021d): V1 one Esc rule for every panel, dialog-aware
    grid keys, Cmd+S never signs/releases (validate-shell-6c scans handler WORDS),
    the rail-key layout subscription; V2 Schedule Pro row 2 fits (row2Plan);
    V3 honest loading on the logs and /attention + bulk Close / Mark sent;
    V4 the job page's Schedule keeps Back; Z2 closeout (below).
  - Phase 2 (124dc7c4, OTA 8cce92f2): R1 RegisterShell + Contacts/Crew; B1
    DashboardColumns + Budget/Job costing/Cash flow; M1 the AIA G703 grid + G702
    strip (cents everywhere) + the CO line grid; M2 the payments desk, the lien log,
    invoice lines, honest early-access / financing copy (D8).
  - Phase 3 (a0f77d45, OTA f7c37ed5): R2 Subs + COI vault registers; R3 Leads
    board+list, Deliveries, Documents; P1 Plans grid + the plan-viewer sheet rail;
    P2 the one-page estimate wizard, two-pane Settings, the web paywall card.
- **The smoothness pass** (439e119a, OTA 05b942c6): components/ui/motion.ts
  (Reduce Motion store — matchMedia on web, never RNW AccessibilityInfo;
  layoutNext with no scaleXY; useRiseOnOpen native-only; useSwapFade
  opacity-only; the web keyframe registry), no-wobble springs, fading tabs,
  rising sheets, the Brain button without glow, the two-spring segment
  indicator. OTA-only: react-native-reanimated is stubbed out of the binary.
  The global web colour glide must stay a zero-specificity :where() rule
  (an :is() version silently killed TouchableOpacity's own fade).
  Lane Z2 (closeout): contract's Save draft / Sign & send row goes through
  ActionBar (40 px, right-aligned to the form, not 17 px tall); dev-ar-measure's
  two CTAs are fullWidth on desktop; construction-ai's two inspection review
  sheets are centred 'wide' cards over a scrim and its code-check result is a
  right-docked panel; the last "Unlimited … today" AI copy is gone (in-app;
  the marketing/index.html Pro card is committed but reaches mageid.app only
  through a Netlify deploy); the onboarding Business tagline reads
  'Teams · 5 office seats'; the daily report never sends a country-only
  location to wttr.in and its weather chip names the place wttr.in actually
  read (nearest_area); useProjects() is identity-stable.

## 2. The desktop model in ten lines

1. Layout.* tokens only (Layout.page {form 760, dashboard 1280, table 1600},
   Layout.column, Layout.register, Layout.print); ContentWidth is gone; no new
   numeric maxWidth >= 700.
2. Every route has a page type in utils/desktopPage.ts ROUTE_PAGE_TYPE, checked
   by scripts/validate-desktop-page-map.ts.
3. DesktopPageFrame wraps screen CONTENT through the root Stack's screenLayout
   (the native header is outside it); SELF_CAPPED_ROUTES cap themselves.
4. Sidebar 240 wide or a 64 px rail, toggled with Cmd+\.
5. Home alone has the right-hand action rail, at >= 1280.
6. Sheets: useSheetFrame(size, { visible, animationType }) → overlay / card /
   footer styles on desktop, null on a phone; useSheetDialogScope for a Modal
   that is not reframed; <Sheet> for new ones; useSheetPrimaryHotkey with
   { saveKey: false } when the primary sends, signs, records money, approves or
   shares.
7. Hotkey scopes: global → page → dialog (topmost wins; Esc typed in a page
   field belongs to the field). Cmd+P/W/T/N/L are refused (the browser keeps them).
8. isDesktop (useIsDesktop) is ALSO true on native >= 1024 (Android tablet):
   desktop STYLES may apply there; browser-only BEHAVIOUR (hotkeys, URL writes,
   CSV download, structural switches) sits behind useIsDesktopWeb().
9. Phone first in every style array: `isDesktop && styles.xDesktop`, or an
   `isDesktopWeb ? <new/> : <today's JSX>` ternary. A prop new on a phone
   element is spread, never `prop={cond ? f : undefined}`.
10. Record pages link with getRowHref / RowLink (typed routeHref): right-click
    and Cmd-click open a new tab through the browser's own menu.

## 3. Guards that bite

- scripts/validate-desktop-layout.ts: CEILING, SHEET_PENDING and PINS are
  orchestrator-owned and only go down. stretchedButtons is 0 after 6d: a
  `<Button style={{ flex: 1 }}>` outside an <ActionBar> fails the build. SA1–SA7
  govern every useSheetFrame adoption (SA2: once a file uses a frame, EVERY
  <Modal> in it needs onRequestClose — construction-ai's non-dismissable
  loaders pass a named no-op, KEEP_LOADER_OPEN).
- validate-ui-adoption is held at 684: a new StyleSheet entry pairing
  `backgroundColor: t.surface` with a borderRadius fails; use <Card>,
  cardSurface(t, …) or t.surfaceAlt.
- validate-type-identity: 31 sans screen headers, no headroom — no new style
  key named title / headerTitle / screenTitle / pageTitle in a sans face.
- validate-a11y-roles: ceiling 1764; every new Pressable/Touchable has an
  accessibilityRole.
- validate-collaborator-gates has a blind spot (6c-B issue 1): it does not see
  every seat-role gate; do not treat green as proof a new write is gated.
- Tutorial validators pin every TutorialTarget id and tutorialSignal call
  (e.g. the dfr.* targets in app/daily-report.tsx) — keep them byte-identical.
- validate-release-keys is red on main until the RevenueCat web key exists
  (founder-blocked).

## 4. Gotchas

- Typed routes: scripts/ci-generate-expo-types.sh KEEPS an existing
  .expo/types/router.d.ts, so a route added since reads to tsc as "not a
  route". Run `EXPO_TYPEGEN_REFRESH=1 sh scripts/ci-generate-expo-types.sh`
  (or delete the file first). It starts a dev server on :18081 — never two at
  once. CI's default (flag unset) is unchanged.
- Memory: tsc is ~3.6 GB RSS on this repo and the 18 GB Mac has OOM-crashed
  with parallel runs. Run tsc/jest ONLY through heavy.sh (2 slots machine-wide),
  jest with -w 1, and shut the iOS simulator. heavy.sh and memwatch.sh live in
  the session tools (scratchpad) dir, not in the repo.
- The web app is an SPA: it serves public/index.html and IGNORES
  app/+html.tsx (app.json web has no `output`). Change the document CSS in
  components/desktop/webDocument.ts and paste it into public/index.html;
  validate-desktop-page-map fails on drift.
- Web jest is a separate config: __tests__/web/jest.web.config.js via
  `bun run test:desktop-web`.
- w6c-home needs --forceExit when run alone (Home's Smart Inbox now also runs a
  60 s clock tick, cleared on unmount).
- useProjects() is identity-stable after 6d: a memo or effect keyed on the
  whole object re-runs only when provider data changes. A value derived from
  the clock inside such a memo must key on its own tick (useSmartInbox does);
  never assign into the returned object.

## 5. Live checks still owed

- Phase-B list F: the DataTable geometry probe at 1512 / 2560 / 1366 / 1280 on
  Henderson; the 2-up Summary, the ~960 px classic landing and a /summary cold
  load; Home at 4 widths + /attention; the SplitView geometry (>= 18 rows,
  j/k, Cmd+S).
- 6d lane Z2 (signed in, light and dark, sidebar 240):
  - /contract with a draft at 1512 and 2560: Save draft and Sign & send sit
    right-aligned in the 760 column, each 40 px tall and >= 120 wide.
    /change-order unchanged.
  - /construction-ai: open the auto-schedule inspection review and an
    inspection-result review — each a centred card over a scrim; a click on
    the scrim closes it; Esc closes it. Run a code check: the result opens as a
    right-docked full-height panel; the loaders are not dismissable.
  - Enterprise copy on /construction-ai ('No daily cap on code checks · each
    run counts toward your AI requests') — the master account reads as
    Business, so check with a jest fixture or the owner override only.
  - /onboarding-paywall Business card: 'Teams · 5 office seats'.
  - A new daily report on a job with a street address: the chip reads
    'Read live at … for <wttr area>, <region>.'; on a job whose location is
    'United States': no auto-fetch, and tapping Auto-fetch alerts
    'No jobsite address'.
  - Optional (useProjects): React Profiler on Home at 1512 — toggling the
    sidebar rail does not recompute the Smart Inbox; 'Lead waiting Nh'
    advances within 60 s of crossing the hour.
- 6d phases 1–3 and the smoothness pass: each lane report's live checklist is in the
  session reports; the short list is Contacts/Crew/Subs/COI/Leads/Deliveries/
  Documents registers at 1512/1366/1280/2560 (36 px rows, the record split,
  j/k, the discard guard), the AIA grid footer G = KPI = G702 line 4 = PDF,
  payments aging Σ = Pending, Plans grid + sheet-rail arrow keys, the one-page
  estimate wizard, two-pane Settings — and on a real iPhone: tab fade,
  back-swipe inside a tab, the + menu into New estimate / New schedule,
  a Reduce Motion toggle.
- Deferred beyond 6d (cut for credits): the Ask MAGE dock + Cmd+K palette +
  CreateMenu popover + sidebar power layer (K1/K2), the ~70 remaining
  SHEET_PENDING sheets (X1–X3), print + header alignment (Z1), WIP / Reports /
  Buyout (B2). Specs are in the session's wave6d-lane-specs/.

## 6. Ship-check

524 checks (521 validators, typecheck, lint, jest) — 523 green on main a0f77d45;
the one red is validate-release-keys (founder-blocked RevenueCat web key).
test:smoke can time out under load (a 40 s punch-list test): re-run it alone
before calling it red.

---

# HISTORICAL — 2026-09-03 state (superseded by the banner above)

> **2026-09-03, evening — a full final-push audit exists.** Read
> `docs/audits/2026-09-03-final-push-audit.md` before touching the deploy: 211
> findings (5 P0), a fix order in waves, and corrections to claims in THIS file
> and in `DEPLOY-VERIFIED-2026-09-02.md`. Two of the corrections are already
> applied below and marked **Correction**.

Everything under this banner was current on 2026-09-03; the desktop-wave banner above supersedes its status claims. The sections further down were written
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

**NOT deployed.** They were blocked from the CLI in the 09-02/03 session by a
deploy gate that cited earlier conversation content; a fresh session on the
evening of 2026-09-03 reached `git ls-remote`, `eas whoami` and `supabase
projects list` without incident, so the gate was session-specific.
- `git push` — the repo is ~108 commits ahead of origin/main
- the edge functions. **Correction (audit 2026-09-03):** `invoice-dunning` has
  NOT been emailing anyone. It, `morning-digest` and `qbo-reconciler` are
  deployed `verify_jwt: true`, the cron sends no JWT, and the gateway has
  answered 401 on every fire since 2026-08-03 / 07-26 while `cron.job_run_details`
  recorded "succeeded". Deploy the repo versions WITH `--no-verify-jwt` (the
  deployed dunning copy still carries the retention bug). The list in
  `DEPLOY-VERIFIED-2026-09-02.md` step 4 is 13 functions plus `award-rfp`; the
  flag-per-function rule there is now written out.
- the OTA. Every app-side fix from those audits is in the repo and not on any
  device.

## THREE THINGS DELIBERATELY HELD BACK — do not just apply them

1. **`20260826180000_portal_link_expiry_cron`** — schedules a pg_cron job that
   calls the `portal-link-expiry-notice` EDGE FUNCTION, which is not deployed.
   Applying it produces a silent stream of failing runs. Apply AFTER that
   function ships (it is in the 2026-09-04 deploy list, `verify_jwt = false`
   per `supabase/config.toml`). **Now parked in `supabase/migrations/held/`**
   so no bulk push can sweep it up; `git mv` it back up to apply.
2. **`20260827120000_project_financials_drop_legacy`** — PHASE 2. It drops
   `estimate` / `linked_estimate` / `estimate_versions` / `target_budget` off
   `projects`. Phase 1 is applied, so the money lives in BOTH places and the
   current app works. Phase 2 must not run until the OTA is live and verified,
   or it removes columns every installed build still reads. **Now parked in
   `supabase/migrations/held/`** (its README lists the precondition per file);
   `scripts/validate-project-financials-split.ts` reads it from there.
3. **`alter table cost_seeds add column deleted_at`** from `20260826150000`.
   cost_seeds is under a standing do-not-touch instruction, so that migration
   was SPLIT and only its `delay_events` index applied. Consequence: soft-delete
   of a cost seed does not persist server-side — the tombstone carries
   `deleted_at`, a column the table cannot hold. Needs a founder call.
   **Audit 2026-09-03 (CONTRACT-F2) found the consequence was larger**: every
   cost-seed upsert carried `deleted_at`, so PostgREST rejected ALL cost-seed
   writes (PGRST204) and production held 0 cost seeds.
   **Fixed on `claude/final-push-fixes` without touching the table:**
   `utils/costSeedCore.ts` `seedToRow` emits `deleted_at` only on a tombstone,
   so live seeds sync again the moment the OTA lands. Only the delete tombstone
   still needs the column; until the founder adds it, a deleted seed stays
   deleted on the device that deleted it and can reappear from another device.

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
   has decided. No migration exists. **Audit 2026-09-03:** no code path writes
   `'user'` any more — every writer (repo and deployed bundle) sends gc/client/sub,
   and `scripts/validate-outbox-contract.ts` pins it. Treat as closed.

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
   migration tracker does not correspond to the files in `supabase/migrations`
   (the 09-02 / 09-03 direct applies were registered under MCP-generated
   versions, `20260902184034` … `20260903205215`, not the local filenames),
   and objects from far later migrations exist while earlier ones do not.
   During the 08-31 audit two
   agents read `schema.sql` when it was stale and filed FALSE bug reports. It is
   now regenerated from production with a per-section MD5 verification — its
   own header explains how to re-run that check (re-done on the evening of
   2026-09-03 for the feature batch; all nine sections match). Regenerate it
   after any deploy, and after phase 2 in particular.
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
7. **Supabase Auth "Confirm email" must stay ON** (Dashboard → Authentication →
   Sign In / Providers → Email). `project-invite`'s `listPending` and
   `acceptPending` find and accept a project invite on the caller's GoTrue email
   ALONE, with no token (`acceptPending` compares `invited_email` to
   `caller.email`; `_shared/verifyUser.ts` never reads `email_confirmed_at`).
   That is safe only because nobody can hold an unconfirmed address. Turn the
   setting off and anyone who signs up as a GC's invitee's address walks onto
   that job, editor financials included. Production had it ON on 2026-09-17
   (7 email users, 0 unconfirmed, 0 confirmed at the moment of signup). **Check
   it before every `project-invite` deploy.** If it ever has to go off, make
   those two actions require `email_confirmed_at` first.

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
