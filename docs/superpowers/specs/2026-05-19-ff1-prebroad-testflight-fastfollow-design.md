# FF1 — Pre-Broad-TestFlight Fast-Follow Batch — Design

Source: the 2026-05-19 consolidated re-audit (4 parallel traces against `main` @ `ff0d5df`). The re-audit verdict was **GO** (zero P0; all prior launch-gate items verified fixed). This batch is the small, honest, non-blocking fast-follow it surfaced — bundled "one shot" per the owner's request.

Build target: p0-on-main worktree `/Users/omirmajeed/Desktop/MAGE ID - CLAUDE/.claude/worktrees/p0-on-main`, branch `claude/p0-launch-on-main` (== `main` @ `ff0d5df`). **App-only, OTA-able. No migration, no portal, no edge-fn, no `types/index.ts`, no new dependency** → Netlify-independent. Standing autonomous authorization (reaffirmed this turn: "do it one shot") — self-approved design, no user check-in, ship via controller OTA after final review.

## 1. Scope (3 fixes — one plan, 3 independent-file tasks)

Three tightly-related first-run/lifecycle **wiring** fixes, each a single isolated file, zero cross-coupling. Honest YAGNI — explicitly **deferred** (not in this batch): per-card sample-remove (the home samples-banner already orients), the 38-item desktop sidebar (too large for a fast-follow), and the cosmetic non-issues (earnedValueEngine DRY duplication; `client-view.tsx` caption `Invalid Date` — unreachable, `ProjectPhoto.timestamp` is required; `offlineQueue` raw-but-`try/catch`-guarded `JSON.parse`).

## 2. The three fixes

### FF1-A — `?openCreate=1` is consumed by nothing (highest leverage; latent-P0)
`/?openCreate=1` is pushed from three places — `components/CreateMenu.tsx:71` (the global "+" menu's **"Project"** row), `components/CreateMenu.tsx:210` (zero-project fallback), `components/OnboardingChecklist.tsx:124` (the #1 "Create your first project" activation row). **Nothing under `app/(tabs)/(home)/` reads `openCreate`** (only the unrelated `app/(tabs)/subs/index.tsx:207` has its own local `openCreate`). `app/(tabs)/(home)/index.tsx` imports `useRouter` from `expo-router` (`:9`) but **not** `useLocalSearchParams`; the create modal is local state `const [showCreateModal,setShowCreateModal]=useState(false)` (`:220`). Net today: the "+"→Project row, the zero-project fallback, and the checklist's #1 row all **silently no-op** (route resolves to the home group, no crash, no modal).

**Fix:** in `app/(tabs)/(home)/index.tsx`, add `useLocalSearchParams`, and a fire-once effect: when the `openCreate` param is truthy → `setShowCreateModal(true)` then clear it via `router.setParams({ openCreate: undefined })`, additionally guarded by a `useRef(false)` "consumed" flag so it can never re-trigger on re-render or back-nav. (`router.setParams` is the standard Expo Router API; it is not currently used elsewhere in `app/`, hence the belt-and-suspenders `useRef` guard for fire-once certainty.) No change to `CreateMenu.tsx`/`OnboardingChecklist.tsx` — they already push the right URL; only the consumer is missing.

### FF1-B — Signed-contract terminal screen has no invoice CTA
`app/contract.tsx:655-664` renders the `contract.status === 'signed'` terminal banner ("Signed by both parties — Binding agreement on file. Invoices on this project should reference it.") with **no actionable CTA**; the only exit is the header `ChevronLeft` `router.back()` (`:394`). `projectId` is already in scope (`:69` `const { projectId, fromRevision } = useLocalSearchParams<{ projectId: string; … }>()`); `useRouter` and `Plus` are imported (`:19`, `:23`); `bill-from-estimate.tsx:78` reads `projectId` via `useLocalSearchParams`.

**Fix:** inside the existing signed block, add one primary CTA button ("Create first invoice", with the imported `Plus` icon) → `router.push({ pathname: '/bill-from-estimate', params: { projectId } })`. Purely additive UI inside the already-rendered signed banner; **no change** to signing/lock/sign-and-send logic or any other status branch. Reuse an existing button style in `contract.tsx` (or a minimal one matching its `makeStyles` conventions — chosen at plan time).

### FF1-C — Stripe-not-connected nudge re-fires on every invoice send
`app/invoice.tsx:511-521`: after every send, `if (stripeNotConnected && totalDue > 0) { Alert.alert('Invoice sent — no Pay button included', …, ['Later', 'Set up Stripe'→/payments-setup]) } else { nailIt(\`Invoice #… sent\`) }`. The Alert nags on **every** invoice send when not Stripe-connected, and on those sends the normal `nailIt(...)` success toast is **not** shown (it's the `else`).

**Fix:** gate the Alert behind a persisted show-once boolean flag in AsyncStorage, key `buildwise_stripe_nudge_seen` (the `buildwise_*` core-collection namespace per CLAUDE.md; a bare `'1'` string flag — no JSON, so `safeJsonParse` is not needed). Logic becomes: read the flag (async) before the branch; `if (stripeNotConnected && totalDue > 0 && !seen) { setItem(flag,'1'); Alert.alert(…) } else { nailIt(\`Invoice #… sent\`) }`. Effect: the nudge shows **once ever**; every subsequent send (connected or not) shows the normal success toast (a net improvement — today suppressed sends are silent). The create-then-edit pay-link logic, the email path, and `nailIt` text are byte-unchanged otherwise. Show-once is **once-forever** (simplest, lowest-risk, matches "stop nagging"; no reset surface — out of scope).

## 3. Architecture / non-goals

One plan, **3 tasks**, one file each (`app/(tabs)/(home)/index.tsx`, `app/contract.tsx`, `app/invoice.tsx`) — fully independent, no shared symbols, any order. Non-goals: no `CreateMenu`/`OnboardingChecklist` change (URLs already correct), no `types/index.ts`, no migration/portal/edge-fn, no new dependency, no change to the shipped P0 behaviors (invoice create-then-edit, paywall-needs-real-project, CreateMenu in-sheet picker) — FF1-A only *adds* a consumer for an already-emitted param, FF1-C only wraps an existing Alert in a seen-flag, FF1-B only adds a button to an already-rendered banner. No reset/config surface for the Stripe flag. No new design system.

## 4. Error handling / correctness

- **FF1-A:** `useRef` consumed-flag + `router.setParams({openCreate:undefined})` ⇒ fires exactly once per truthy arrival, cannot loop, back-nav safe; param absent ⇒ effect inert (zero behavior change for every non-`openCreate` entry to home). Modal open path identical to the existing `setShowCreateModal(true)` callers.
- **FF1-B:** `projectId` already guaranteed in scope (the screen is unreachable without it — `project = projectId ? getProject(projectId) : undefined`); CTA only rendered inside the existing `status === 'signed'` block, so no new conditional surface. `bill-from-estimate` reads `projectId` (verified) — no dead-end.
- **FF1-C:** AsyncStorage read failure → treat as "not seen" (show the nudge; never throw, never block the send); the send/email/pay-link path is untouched and runs regardless. Flag write is fire-and-forget (a failed write at worst shows the nudge again — acceptable, non-blocking).
- All three: `npx tsc --noEmit` clean; the no-trigger paths are byte-identical to today.

## 5. Verification (no unit runner)

`npx tsc --noEmit` clean + manual reasoning per task:
- **A:** entering home via `/?openCreate=1` (from "+"→Project, zero-project fallback, and the checklist row) opens the create modal exactly once; normal home entry (no param) unchanged, no modal, no loop; back-nav after closing does not re-open.
- **B:** a `signed` contract shows a working "Create first invoice" → `bill-from-estimate` with the right `projectId`; `draft`/`sent`/`void` branches and signing/lock logic byte-unchanged.
- **C:** first not-connected send → nudge once + flag set; every later send → no nudge, normal success toast; connected sends unaffected; pay-link/email path byte-unchanged; AsyncStorage error → nudge still shows, send still completes.
- Regression: shipped P0s (invoice create-then-edit, paywall-needs-real-project, CreateMenu picker) unaffected; no other screen touched.
- Final whole-impl review (opus): confirm single-file-per-task, additive-only, fire-once correctness, no P0 regression, no migration/portal/types.

## 6. Out of scope / future

Per-card "this is a sample — remove" affordance; desktop sidebar "start here" + collapse; a reset/settings surface for the Stripe nudge; the cosmetic DRY/defensive nits (earnedValueEngine, client-view caption, offlineQueue parse). All deferred — none gate TestFlight.
