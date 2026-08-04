# Phase 1 — Make It Launchable Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the last product-integrity and funnel-handoff leaks so a real first user can install, use, and pay without hitting a fabricated number or a dead end.

**Architecture:** Three focused pieces. (1) Replace the seed-only `bulkSavingsTotal` with a pure engine util that computes real savings from existing buyout-award data, provenance-tagged and shown only when real. (2) Rebuild the deep-link resolver to pass authenticated in-app paths through (with a post-login replay) instead of silently rewriting them to Home. (3) Capture the marketing `?plan=&trial=` intent and pre-select the tier on the paywall. Plus a small caveat-finish on plan-intelligence cold-start rates.

**Tech Stack:** React Native + Expo (Expo Router 6, typed routes), TypeScript strict, `bun`. No jest — pure logic is validated by throwaway `scripts/verify-*.ts` harnesses run with `bun` and deleted before commit (per CLAUDE.md). Integration is gated by `bun run typecheck`.

**Reference spec:** `docs/superpowers/specs/2026-08-04-phase1-make-it-launchable-design.md`

---

## File structure

**Create:**
- `utils/bulkSavings.ts` — pure engine: `computeBulkSavings(projectId, bidPackages, commitments, asOf?)`.
- `utils/deepLinkScheme.ts` is modified (not created).
- `utils/pendingDeepLink.ts` — persist/replay the intended deep-link across the login gate.
- `utils/signupIntent.ts` — parse + persist the marketing `?plan=&trial=` intent.
- `scripts/verify-bulkSavings.ts`, `scripts/verify-deepLink.ts`, `scripts/verify-signupIntent.ts` — throwaway harnesses (deleted in the final task).

**Modify:**
- `types/index.ts` — make `bulkSavingsTotal` optional (derived, not authored).
- `app/project-detail.tsx` — compute + render real bulk savings with a grounding chip; gate on `hasRealData && > 0`.
- `utils/pdfGenerator.ts`, `components/PDFPreSendSheet.tsx` — feed the real number; gate the section.
- `utils/demoSeed.ts`, `app/dev-seeder.tsx`, `app/dev-flagship-seeder.tsx` — stop setting `bulkSavingsTotal`; give the flagship demo real awarded packages.
- `utils/deepLinkScheme.ts`, `app/_layout.tsx`, `contexts/AuthContext.tsx` — resolver rebuild + pending-deeplink stash/replay + cache-key registration.
- `app/paywall.tsx` and/or `app/onboarding-paywall.tsx` — consume the signup intent.
- `utils/planIntelligence.ts` / `app/plan-intelligence.tsx` — finish the cold-start rate caveat.

---

## Piece 1 — Real Bulk Savings

### Task 1: Pure engine `utils/bulkSavings.ts`

**Files:**
- Create: `utils/bulkSavings.ts`
- Test: `scripts/verify-bulkSavings.ts` (throwaway)

- [ ] **Step 1: Write the failing harness**

Create `scripts/verify-bulkSavings.ts`:

```ts
import { computeBulkSavings } from '@/utils/bulkSavings';
import type { BidPackage, Commitment } from '@/types';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

const ASOF = '2026-08-04T00:00:00.000Z';
const pkg = (o: Partial<BidPackage>): BidPackage => ({
  id: 'p1', projectId: 'proj1', name: 'Framing', linkedEstimateItemIds: [],
  estimateBudget: 10000, status: 'awarded', createdAt: ASOF, updatedAt: ASOF, ...o,
} as BidPackage);
const com = (o: Partial<Commitment>): Commitment => ({
  id: 'c1', projectId: 'proj1', number: 'BO-1', type: 'subcontract', description: 'Framing',
  amount: 8500, signedDate: ASOF, status: 'active', createdAt: ASOF, updatedAt: ASOF, ...o,
} as Commitment);

// (a) empty → no data
eq('empty.hasRealData', computeBulkSavings('proj1', [], [], ASOF).hasRealData, false);
eq('empty.bulkSavings', computeBulkSavings('proj1', [], [], ASOF).bulkSavings, 0);

// (b) one awarded package 10000 budget / 8500 commitment → 1500, count 1
{
  const r = computeBulkSavings('proj1',
    [pkg({ awardedCommitmentId: 'c1' })],
    [com({})], ASOF);
  eq('one.savings', r.bulkSavings, 1500);
  eq('one.count', r.awardedPackageCount, 1);
  eq('one.hasRealData', r.hasRealData, true);
  eq('one.source', r.source, 'measured_from_buyout');
}

// (c) an overrun nets against a saving: pkg1 +1500, pkg2 -500 → net 1000
{
  const r = computeBulkSavings('proj1',
    [pkg({ id: 'p1', awardedCommitmentId: 'c1' }),
     pkg({ id: 'p2', name: 'Roofing', estimateBudget: 5000, awardedCommitmentId: 'c2' })],
    [com({ id: 'c1', amount: 8500 }),
     com({ id: 'c2', amount: 5500 })], ASOF);
  eq('overrun.net', r.bulkSavings, 1000);
  eq('overrun.count', r.awardedPackageCount, 2);
}

// (d) awarded but no signed commitment → excluded (0 contribution)
{
  const r = computeBulkSavings('proj1', [pkg({ awardedCommitmentId: undefined })], [], ASOF);
  eq('uncommitted.hasRealData', r.hasRealData, false);
  eq('uncommitted.savings', r.bulkSavings, 0);
}

// (e) a changeAmount on the commitment erodes the saving: 10000 - (8500+1000) = 500
{
  const r = computeBulkSavings('proj1',
    [pkg({ awardedCommitmentId: 'c1' })],
    [com({ changeAmount: 1000 })], ASOF);
  eq('changeAmount.savings', r.bulkSavings, 500);
}

// (f) a non-awarded (open) package never counts
{
  const r = computeBulkSavings('proj1',
    [pkg({ status: 'open', awardedCommitmentId: 'c1' })], [com({})], ASOF);
  eq('open.hasRealData', r.hasRealData, false);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
if (failures) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/verify-bulkSavings.ts`
Expected: FAIL — `Cannot find module '@/utils/bulkSavings'` (the util does not exist yet).

- [ ] **Step 3: Implement `utils/bulkSavings.ts`**

```ts
import type { BidPackage, Commitment } from '@/types';

export interface BulkSavingsLine {
  packageId: string;
  packageName: string;
  estimateBudget: number;
  awardedAmount: number;
  savings: number; // estimateBudget - awardedAmount; negative = overrun
}

export interface BulkSavingsSummary {
  bulkSavings: number;          // net Σ of line savings across awarded+committed packages
  awardedPackageCount: number;  // packages awarded AND with a resolvable signed commitment
  totalBudgeted: number;
  totalAwarded: number;
  byPackage: BulkSavingsLine[];
  hasRealData: boolean;         // awardedPackageCount > 0
  source: 'measured_from_buyout';
  asOf: string;
}

/**
 * Real bulk savings for a project = Σ(estimate budget − signed award) across
 * buyout packages that are actually AWARDED and have a resolvable signed
 * Commitment. Forward estimates, open/leveling packages, and awarded-but-not-
 * committed packages never contribute. Overruns (negative lines) are included
 * in the net so the number is honest, never cherry-picked. Provenance is
 * 'measured_from_buyout' — distinct from seeded claims and closed-job actuals.
 */
export function computeBulkSavings(
  projectId: string,
  bidPackages: BidPackage[],
  commitments: Commitment[],
  asOf: string = new Date().toISOString(),
): BulkSavingsSummary {
  const byPackage: BulkSavingsLine[] = [];
  let totalBudgeted = 0;
  let totalAwarded = 0;

  const awarded = bidPackages.filter(
    (p) => p.projectId === projectId && p.status === 'awarded',
  );

  for (const pkg of awarded) {
    const commitment = pkg.awardedCommitmentId
      ? commitments.find(
          (c) => c.id === pkg.awardedCommitmentId && c.projectId === projectId,
        )
      : undefined;
    if (!commitment) continue; // awarded but not committed → excluded

    const awardedAmount = commitment.amount + (commitment.changeAmount ?? 0);
    const estimateBudget = pkg.estimateBudget ?? 0;
    byPackage.push({
      packageId: pkg.id,
      packageName: pkg.name,
      estimateBudget,
      awardedAmount,
      savings: estimateBudget - awardedAmount,
    });
    totalBudgeted += estimateBudget;
    totalAwarded += awardedAmount;
  }

  return {
    bulkSavings: totalBudgeted - totalAwarded,
    awardedPackageCount: byPackage.length,
    totalBudgeted,
    totalAwarded,
    byPackage,
    hasRealData: byPackage.length > 0,
    source: 'measured_from_buyout',
    asOf,
  };
}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `bun scripts/verify-bulkSavings.ts`
Expected: every line `ok`, final `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors from `utils/bulkSavings.ts`. (If `BidPackage`/`Commitment` field names differ from the harness fixtures, fix the fixtures to match `types/index.ts` — the real types are the source of truth.)

- [ ] **Step 6: Commit**

```bash
git add utils/bulkSavings.ts
git commit -m "feat(bulk-savings): pure engine computing real savings from awarded buyout packages"
```

---

### Task 2: Make the type honest + stop seeding the fabricated value

**Files:**
- Modify: `types/index.ts:74` (`bulkSavingsTotal`)
- Modify: `utils/demoSeed.ts:136,264,379`; `app/dev-seeder.tsx:246`; `app/dev-flagship-seeder.tsx:201`

- [ ] **Step 1: Make the field optional**

In `types/index.ts`, change the declaration at line 74 from:

```ts
bulkSavingsTotal: number;
```

to:

```ts
// DERIVED, not authored. Real value comes from utils/bulkSavings.ts
// (computeBulkSavings) at render time. Seed/demo code must NOT set this to a
// fabricated figure — a demo shows real savings only via awarded BidPackages.
bulkSavingsTotal?: number;
```

- [ ] **Step 2: Remove the fabricated writers**

Delete the `bulkSavingsTotal: <n>,` line at each of: `utils/demoSeed.ts:136`, `utils/demoSeed.ts:264`, `utils/demoSeed.ts:379`, `app/dev-seeder.tsx:246`, `app/dev-flagship-seeder.tsx:201`. (Grep to confirm zero remain: `grep -rn "bulkSavingsTotal:" utils app` should return nothing.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY at the `project-detail.tsx` / `pdfGenerator.ts` read sites that assumed a required number (they'll be fixed in Tasks 3–4). Note each error location; they are the checklist for the next tasks. No errors in the seed files.

- [ ] **Step 4: Commit**

```bash
git add types/index.ts utils/demoSeed.ts app/dev-seeder.tsx app/dev-flagship-seeder.tsx
git commit -m "refactor(bulk-savings): bulkSavingsTotal is derived, not a seeded number"
```

---

### Task 3: Render real bulk savings in `app/project-detail.tsx`

**Files:**
- Modify: `app/project-detail.tsx` (assignment `:1073`; render sites `:1109, :1162, :1198, :1451, :2409`; explainer copy near the "How Bulk Savings Work" panel)

- [ ] **Step 1: Compute the summary once**

Near the existing estimate-derived memo block (around `:1073` where `const totalBulkSavings = estimate.bulkSavingsTotal ?? 0;` lives), source `bidPackages` and `commitments` from `ProjectContext` (the context already exposes `commitments: Commitment[]` and a per-project bid-package accessor — use the existing project-scoped selectors) and replace the assignment with:

```ts
import { computeBulkSavings } from '@/utils/bulkSavings';
// ...inside the component, with project + bidPackages + commitments in scope:
const bulkSavings = useMemo(
  () => computeBulkSavings(project.id, projectBidPackages, projectCommitments),
  [project.id, projectBidPackages, projectCommitments],
);
const totalBulkSavings = bulkSavings.bulkSavings;
const showBulkSavings = bulkSavings.hasRealData && bulkSavings.bulkSavings > 0;
```

(If `project-detail` does not already pull bid packages, add the context selector the same way it pulls other project sub-collections — follow the existing `use...()` pattern in the file. Confirm the accessor name in `contexts/ProjectContext.tsx`.)

- [ ] **Step 2: Gate every render site**

At each of `:1109, :1162, :1198, :1451, :2409`, wrap the savings render in `showBulkSavings ? (...) : null`. Replace the raw `estimate.bulkSavingsTotal` reads with `totalBulkSavings`. Example for the hero chip (`~:1109`):

```tsx
{showBulkSavings ? (
  <Text style={[detailStyles.heroChipLabel, { color: themeColors.success }]}>
    -{formatMoney(totalBulkSavings)}
  </Text>
) : null}
```

Apply the same gate to the breakdown row, full breakdown, hero stat, and summary row. **No site may render when `showBulkSavings` is false — render nothing, never `$0`** (mirrors `RecoveredCard` at `components/home/RecoveredCard.tsx:72-76`).

- [ ] **Step 3: Add the grounding chip + real breakdown**

Where the current "How Bulk Savings Work" explainer sits, replace the invented explanation with a sourced one, shown only when `showBulkSavings`:

```tsx
{showBulkSavings ? (
  <Pressable onPress={() => setShowBulkBreakdown(true)}>
    <Text style={detailStyles.groundingChip}>
      Measured from your buyout · {bulkSavings.awardedPackageCount} package{bulkSavings.awardedPackageCount > 1 ? 's' : ''}
    </Text>
  </Pressable>
) : null}
```

The tap target opens a sheet listing `bulkSavings.byPackage` (packageName, estimateBudget, awardedAmount, savings) — reuse the file's existing modal/sheet pattern. This satisfies the standing brain-center directive: the number is grounded (sourced from awards), adaptive (drill into per-package), and honest (chip states provenance).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: the `project-detail.tsx` errors from Task 2 Step 3 are gone; no new errors.

- [ ] **Step 5: Commit**

```bash
git add app/project-detail.tsx
git commit -m "feat(bulk-savings): render real, provenance-chipped savings; nothing when none"
```

---

### Task 4: Feed the real number into the client PDF + gate the pre-send section

**Files:**
- Modify: `utils/pdfGenerator.ts:521,1538` (reads `legacyEst.bulkSavingsTotal`, already guarded `> 0`)
- Modify: `components/PDFPreSendSheet.tsx:108` (the "Bulk Savings Breakdown" section, enabled by default)

- [ ] **Step 1: Pass the computed value to the generator**

At the call site(s) that build the estimate object handed to `pdfGenerator` (search where the PDF is generated from `project-detail`/`PDFPreSendSheet`), compute `computeBulkSavings(...)` and set `bulkSavingsTotal` on the passed object to `summary.hasRealData && summary.bulkSavings > 0 ? summary.bulkSavings : undefined`. Because `pdfGenerator.ts:521` and `:1538` already guard `(legacyEst.bulkSavingsTotal ?? 0) > 0`, an `undefined`/absent value prints no line and a real value prints correctly — no change needed inside `pdfGenerator.ts` beyond confirming the guard.

- [ ] **Step 2: Gate the pre-send section**

In `components/PDFPreSendSheet.tsx` around `:108`, change the "Bulk Savings Breakdown" section's default-enabled state to be enabled only when the real value is present (`hasRealData && > 0`); otherwise omit the toggle entirely so a contractor is never offered a fabricated section.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual verification note**

Because PDF output isn't unit-tested here, verify in the running app/sim: a project with **no awarded packages** produces a client PDF with **no** Bulk Savings line and no pre-send section; a project with an awarded package showing a real saving prints the correct figure. (Sim screenshot per the repo's sim workflow.)

- [ ] **Step 5: Commit**

```bash
git add utils/pdfGenerator.ts components/PDFPreSendSheet.tsx
git commit -m "fix(bulk-savings): client PDF + pre-send show savings only when real"
```

---

## Piece 2 — Deep-link resolver rebuild + post-login replay

### Task 5: Rebuild `resolveDeepLinkPath`

**Files:**
- Modify: `utils/deepLinkScheme.ts:45-63`
- Test: `scripts/verify-deepLink.ts` (throwaway)

- [ ] **Step 1: Write the failing harness**

Create `scripts/verify-deepLink.ts`:

```ts
import { resolveDeepLinkPath } from '@/utils/deepLinkScheme';

let failures = 0;
function eq(name: string, got: string, want: string) {
  if (got !== want) { failures++; console.error(`FAIL ${name}: got '${got}' want '${want}'`); }
  else console.log(`ok   ${name}`);
}

eq('public.prequal', resolveDeepLinkPath('mageid://prequal-form'), '/prequal-form');
eq('public.reset', resolveDeepLinkPath('mageid://reset-password?token=x'), '/reset-password?token=x');
eq('inapp.qbo', resolveDeepLinkPath('mageid://qbo-setup'), '/qbo-setup');
eq('inapp.crew.query', resolveDeepLinkPath('mageid://claim-crew?token=abc'), '/claim-crew?token=abc');
eq('inapp.clientview', resolveDeepLinkPath('mageid://client-view'), '/client-view');
eq('inapp.nested', resolveDeepLinkPath('mageid://integrations/qbo/callback'), '/integrations/qbo/callback');
eq('empty', resolveDeepLinkPath('mageid://'), '/');
eq('malformed', resolveDeepLinkPath('mageid://!!bad path!!'), '/');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
if (failures) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/verify-deepLink.ts`
Expected: FAIL — `inapp.qbo` etc. currently return `/` (the bug), so several lines FAIL.

- [ ] **Step 3: Implement the three-case resolver**

In `utils/deepLinkScheme.ts`, keep `PUBLIC_PATHS` as-is and add an in-app-route shape guard, then rewrite `resolveDeepLinkPath`:

```ts
// A well-formed in-app route: one or more '/'-separated segments of
// [a-z0-9-], optionally followed by a query string. This lets EVERY real
// route through to the router/auth-gate instead of the old behaviour of
// silently rewriting ~99 routes to Home. Unknown routes fall to +not-found.
const IN_APP_ROUTE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/i;

export function isInAppRoute(route: string): boolean {
  return IN_APP_ROUTE.test(route);
}

export function resolveDeepLinkPath(path: string): string {
  try {
    const cleaned = stripAppScheme(path);
    if (!cleaned) return '/';
    const [route] = cleaned.split('?');
    if (!route) return '/';
    if (PUBLIC_PATHS.has(route)) return '/' + cleaned;       // pre-login public
    if (isInAppRoute(route)) return '/' + cleaned;           // authenticated in-app
  } catch {
    // fall through
  }
  return '/';                                                // genuinely malformed
}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `bun scripts/verify-deepLink.ts`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add utils/deepLinkScheme.ts
git commit -m "fix(deep-links): pass authenticated in-app paths through instead of rewriting to Home"
```

---

### Task 6: Pending-deeplink stash + post-login replay

**Files:**
- Create: `utils/pendingDeepLink.ts`
- Modify: `app/_layout.tsx` (the unauthenticated redirect ~`:498` and the post-onboarding home route)
- Modify: `contexts/AuthContext.tsx` (`LOCAL_USER_CACHE_KEYS`)

- [ ] **Step 1: Implement the pending-deeplink store**

Create `utils/pendingDeepLink.ts`:

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isInAppRoute } from '@/utils/deepLinkScheme';

export const PENDING_DEEPLINK_KEY = 'mageid_pending_deeplink';
const TTL_MS = 10 * 60 * 1000; // a link older than 10 min is stale, don't replay

/** Stash an intended in-app path to replay after the user authenticates. */
export async function setPendingDeepLink(path: string): Promise<void> {
  const route = path.replace(/^\//, '').split('?')[0];
  if (!route || !isInAppRoute(route)) return;      // never stash junk/external
  await AsyncStorage.setItem(PENDING_DEEPLINK_KEY, JSON.stringify({ path, ts: Date.now() }));
}

/** Return the pending path once (clearing it), or null if none/expired/invalid. */
export async function takePendingDeepLink(): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_DEEPLINK_KEY);
  await AsyncStorage.removeItem(PENDING_DEEPLINK_KEY);
  if (!raw) return null;
  try {
    const { path, ts } = JSON.parse(raw) as { path: string; ts: number };
    if (typeof path !== 'string' || Date.now() - ts > TTL_MS) return null;
    const route = path.replace(/^\//, '').split('?')[0];
    return isInAppRoute(route) ? path : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Register the cache key**

In `contexts/AuthContext.tsx`, add `PENDING_DEEPLINK_KEY` (import from `@/utils/pendingDeepLink`) to the `LOCAL_USER_CACHE_KEYS` array so it is cleared on sign-out and never leaks across tenants on a shared device.

- [ ] **Step 3: Stash on the unauthenticated redirect**

In `app/_layout.tsx`, at the gate that does `router.replace('/login')` for an unauthenticated user (~`:498`), read the current path via `usePathname()` and, when it is not `/login` and not a public path, call `setPendingDeepLink(currentPath)` before the redirect. Import `setPendingDeepLink` from `@/utils/pendingDeepLink` and `PUBLIC_PATHS` from `@/utils/deepLinkScheme`.

```tsx
// inside the auth gate, before router.replace('/login'):
const firstSeg = pathname.replace(/^\//, '').split('?')[0];
if (pathname !== '/login' && !PUBLIC_PATHS.has(firstSeg)) {
  void setPendingDeepLink(pathname);
}
router.replace('/login');
```

- [ ] **Step 4: Replay after auth + onboarding completes**

In `app/_layout.tsx`, at the point where an authenticated, onboarded user is routed to home (the branch that lands on the tabs after `persona-select`/`onboarding`/`onboarding-paywall` gating, ~`:509-524`), check for a pending deeplink first:

```tsx
// when the user is authed AND onboarding is complete, before/instead of the
// default home replace:
const pending = await takePendingDeepLink();
if (pending) { router.replace(pending as any); }
else { /* existing default home navigation */ }
```

Because this branch may be synchronous, wrap the async read in a small effect that runs once when auth+onboarding become true; guard with a ref so it fires at most once per session.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (Typed routes: casting the dynamic `pending` string with `as any` at the single `router.replace` call is acceptable here since the value is validated by `isInAppRoute`; add a short comment explaining why.)

- [ ] **Step 6: Manual verification note**

Verify in sim/dev: (a) launch `mageid://qbo-setup` while logged out → lands on login → after login lands on `/qbo-setup`, not Home. (b) `mageid://claim-crew?token=abc` while logged out replays with the token intact. (c) A push-notification deep link to an in-app route lands on that route post-login. (Deep links testable via `xcrun simctl openurl booted "mageid://qbo-setup"`.)

- [ ] **Step 7: Commit**

```bash
git add utils/pendingDeepLink.ts app/_layout.tsx contexts/AuthContext.tsx
git commit -m "feat(deep-links): replay the intended route after login instead of dropping it"
```

---

## Piece 3 — Marketing plan/trial capture

### Task 7: Pure parser + persistence `utils/signupIntent.ts`

**Files:**
- Create: `utils/signupIntent.ts`
- Test: `scripts/verify-signupIntent.ts` (throwaway)

- [ ] **Step 1: Write the failing harness**

Create `scripts/verify-signupIntent.ts`:

```ts
import { parseSignupIntent } from '@/utils/signupIntent';

let failures = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failures++; console.error(`FAIL ${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${name}`);
}

eq('pro.trial', parseSignupIntent({ plan: 'pro', trial: '14' }), { plan: 'pro', trialDays: 14 });
eq('business.notrial', parseSignupIntent({ plan: 'business' }), { plan: 'business', trialDays: 0 });
eq('free', parseSignupIntent({ plan: 'free', trial: '0' }), { plan: 'free', trialDays: 0 });
eq('uppercase', parseSignupIntent({ plan: 'PRO', trial: '14' }), { plan: 'pro', trialDays: 14 });
eq('invalid.plan', parseSignupIntent({ plan: 'hacker', trial: '14' }), null);
eq('missing.plan', parseSignupIntent({ trial: '14' }), null);
eq('garbage.trial', parseSignupIntent({ plan: 'pro', trial: 'abc' }), { plan: 'pro', trialDays: 0 });
eq('negative.trial', parseSignupIntent({ plan: 'pro', trial: '-5' }), { plan: 'pro', trialDays: 0 });

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
if (failures) process.exit(1);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun scripts/verify-signupIntent.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `utils/signupIntent.ts`**

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export type SignupPlan = 'free' | 'pro' | 'business' | 'enterprise';
export interface SignupIntent { plan: SignupPlan; trialDays: number; }

const VALID_PLANS: readonly SignupPlan[] = ['free', 'pro', 'business', 'enterprise'];
export const SIGNUP_INTENT_KEY = 'mageid_signup_intent';

type Params = Record<string, string | undefined> | URLSearchParams;
function get(params: Params, key: string): string | undefined {
  return params instanceof URLSearchParams ? params.get(key) ?? undefined : params[key];
}

/** Parse the marketing ?plan=&trial= handoff. Returns null if plan is absent/invalid. */
export function parseSignupIntent(params: Params): SignupIntent | null {
  const plan = (get(params, 'plan') ?? '').toLowerCase() as SignupPlan;
  if (!VALID_PLANS.includes(plan)) return null;
  const rawTrial = get(params, 'trial');
  const parsed = rawTrial ? Math.floor(Number(rawTrial)) : 0;
  const trialDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return { plan, trialDays };
}

export async function persistSignupIntent(intent: SignupIntent): Promise<void> {
  await AsyncStorage.setItem(SIGNUP_INTENT_KEY, JSON.stringify(intent));
}

export async function readSignupIntent(): Promise<SignupIntent | null> {
  const raw = await AsyncStorage.getItem(SIGNUP_INTENT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as SignupIntent;
    return VALID_PLANS.includes(v.plan) ? v : null;
  } catch {
    return null;
  }
}

export async function clearSignupIntent(): Promise<void> {
  await AsyncStorage.removeItem(SIGNUP_INTENT_KEY);
}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `bun scripts/verify-signupIntent.ts`
Expected: `ALL PASS`, exit 0.

- [ ] **Step 5: Typecheck & commit**

Run: `npx tsc --noEmit` (expected clean), then:

```bash
git add utils/signupIntent.ts
git commit -m "feat(signup-intent): parse + persist the marketing plan/trial handoff"
```

---

### Task 8: Read the intent on load, consume it on the paywall

**Files:**
- Modify: `app/_layout.tsx` (read `plan`/`trial` from the initial URL on web; persist once)
- Modify: `app/paywall.tsx` and/or `app/onboarding-paywall.tsx` (pre-select the tier + trial framing)
- Modify: `contexts/AuthContext.tsx` (`LOCAL_USER_CACHE_KEYS` — add `SIGNUP_INTENT_KEY`)

- [ ] **Step 1: Capture on first load**

In `app/_layout.tsx`, in a run-once effect near the root, read the incoming params (web: `new URLSearchParams(window.location.search)`; native/universal-link: the router's `useLocalSearchParams`). Call `parseSignupIntent(...)`; if non-null, `persistSignupIntent(intent)`. Guard so it only writes when no session exists yet (a fresh arrival), and only once.

```tsx
useEffect(() => {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const intent = parseSignupIntent(new URLSearchParams(window.location.search));
    if (intent) void persistSignupIntent(intent);
  }
}, []);
```

- [ ] **Step 2: Register the cache key**

In `contexts/AuthContext.tsx`, add `SIGNUP_INTENT_KEY` (import from `@/utils/signupIntent`) to `LOCAL_USER_CACHE_KEYS`.

- [ ] **Step 3: Consume on the paywall**

In the paywall screen (`app/paywall.tsx`; mirror in `app/onboarding-paywall.tsx` if it renders its own offering), on mount call `readSignupIntent()`. If present:
- pre-select the matching tier's offering package (map `plan` → the RC offering package identifier `${plan}_monthly`, per CLAUDE.md's RC convention) so that tier is the highlighted/default selection;
- when `trialDays > 0`, show the trial framing (e.g. a "14-day free trial" badge/label on the CTA);
- if `plan === 'free'`, skip the hard paywall / route straight through.
- After the paywall is shown/acted upon, `clearSignupIntent()` so it fires once.

Add an in-code comment marking the boundary: **this pre-selects and frames only; actual trial/purchase activation is the existing RevenueCat purchase flow and requires the RC webhook + real web key (owner task) to unlock a tier.**

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Manual verification note**

On web: open `app.mageid.app/?plan=pro&trial=14` in a fresh session → after signup, the paywall opens with **Pro** pre-selected and a **14-day trial** label. `?plan=free` routes through without a hard wall. `?plan=bogus` is ignored (default paywall).

- [ ] **Step 6: Commit**

```bash
git add app/_layout.tsx app/paywall.tsx app/onboarding-paywall.tsx contexts/AuthContext.tsx
git commit -m "feat(signup-intent): pre-select tier + trial framing from the marketing handoff"
```

---

## Piece 4 — Finish plan-intelligence cold-start caveat

### Task 9: Chip the cold-start room rates

**Files:**
- Modify: `app/plan-intelligence.tsx:~102,~378` (render sites); `utils/planIntelligence.ts:32-36` (`DEFAULT_ROOM_RATES`) for reference

- [ ] **Step 1: Confirm current state**

Read `app/plan-intelligence.tsx` around `:102` and `:378`. Determine whether each dollar total derived from `DEFAULT_ROOM_RATES` (i.e. when the user has no learned rate) already carries a grounding chip / `—` treatment, or renders a bare number.

- [ ] **Step 2: Apply the grounding pattern where missing**

For any cold-start render that shows a hard dollar total with no disclosure, add a chip mirroring the sanctioned pattern (`components/AIBidScorecard.tsx:303-310` and `estimate-wizard.tsx:681-691`): when the rate is a default (no learned rate for that room type), show `Market placeholder — MAGE has none of your rates yet` beside/under the figure; when it is a learned rate, keep the existing positive chip. Do not present a `DEFAULT_ROOM_RATES`-derived total as measured.

- [ ] **Step 3: Typecheck & commit**

Run: `npx tsc --noEmit` (expected clean), then:

```bash
git add app/plan-intelligence.tsx
git commit -m "fix(plan-intelligence): disclose cold-start placeholder rates instead of asserting them"
```

---

## Final Task 10: Ship-check + remove throwaway harnesses

**Files:**
- Delete: `scripts/verify-bulkSavings.ts`, `scripts/verify-deepLink.ts`, `scripts/verify-signupIntent.ts`

- [ ] **Step 1: Re-run every harness one last time**

Run: `bun scripts/verify-bulkSavings.ts && bun scripts/verify-deepLink.ts && bun scripts/verify-signupIntent.ts`
Expected: three `ALL PASS`.

- [ ] **Step 2: Delete the harnesses (per CLAUDE.md — never commit them)**

```bash
rm scripts/verify-bulkSavings.ts scripts/verify-deepLink.ts scripts/verify-signupIntent.ts
```

- [ ] **Step 3: Full ship-check**

Run: `bun run ship-check` (typecheck + lint + validation suites)
Expected: green. Fix anything it flags.

- [ ] **Step 4: Confirm no fabricated writer survives**

Run: `grep -rn "bulkSavingsTotal:" utils app components`
Expected: no assignment lines (only the optional type declaration in `types/index.ts` and derived reads remain).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(phase-1): ship-check green; remove throwaway verify harnesses"
```

---

## Self-review — spec coverage

- Real bulk savings computed + provenance + gated render + PDF + type honesty + seed cleanup → Tasks 1–4. ✓
- Deep-link resolver rebuild + post-login replay → Tasks 5–6. ✓
- Marketing plan/trial capture + pre-select → Tasks 7–8. ✓
- Plan-intelligence cold-start caveat → Task 9. ✓
- Owner prerequisites (RevenueCat, App Store) → documented in the spec as out-of-code; the code boundary is marked in Task 8 Step 3. ✓
- Non-goals (comprehensive copy sweep, auto-start trial) → excluded, not tasked. ✓
- Ship discipline (verify harnesses deleted, ship-check) → Task 10. ✓

No placeholders; types are consistent across tasks (`BulkSavingsSummary.hasRealData`/`bulkSavings`, `isInAppRoute`, `SignupIntent.trialDays`, `PENDING_DEEPLINK_KEY`, `SIGNUP_INTENT_KEY` all defined before use).
