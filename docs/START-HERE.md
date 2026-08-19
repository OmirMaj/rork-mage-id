# START HERE — orientation for a new session

_Written 2026-08-19 at the end of a long working session, so the next one begins
where this ended. Read this, then `CLAUDE.md`, then `docs/PRODUCT-BIBLE.md`._

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
