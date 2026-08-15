# Runtime smoke tests — prove every screen renders

_Design, 2026-08-15._

## The problem

This repo has **no runtime test tooling at all** — no jest, no detox, no
testing-library. Its 137 test files are `bun` scripts in `scripts/validate-*.ts`
that assert on pure functions and on source text. They are good, and they cannot
answer the one question that matters before inviting testers:

> Does the screen render?

The git history says this is not hypothetical. Recent commits include *"fix(ux):
seven screens no longer dead-end without a projectId"* and *"fix: revive the
still-valid parts of PR #81 and #85"*. A source-level grep cannot catch a screen
that throws on mount, and neither can a validator that never imports React.

There are **~200 `.tsx` files** under `app/` and **31 providers** in
`app/_layout.tsx`. (That file count includes `_layout` and other non-routes the
suite skips, so the true route count is somewhat lower — the suite derives it
rather than assuming.) Nothing currently verifies that any of them survive
contact with each other.

## What this is NOT

Out of scope, deliberately:

- **Interaction, navigation, and content assertions.** Tapping, typing, asserting
  that a total reads $12,500 — all of that belongs to the behavioural-flow spec
  that follows this one.
- **Snapshots.** They churn on every style change and train people to run `-u`
  without reading the diff. A snapshot suite that is always slightly wrong is
  indistinguishable from no suite.
- **The behavioural flows themselves** (onboarding → first estimate, cost-seed →
  priced estimate, daily report → client portal). Second spec, after this one is
  green and stable.

This spec buys one thing: **a screen that throws on mount fails the build.**

## Architecture

### Tooling

`jest-expo` preset plus `@testing-library/react-native`. This is not a free
choice — `jest-expo` is the only preset that handles Expo's native-module
surface, and RNTL is what renders a component tree without a device. This is the
one place the project takes on real new dependencies, and it is why the decision
deserved a spec rather than a commit.

The existing `bun` validators stay exactly as they are. They are not replaced,
not migrated, and not wrapped. Two test systems is the correct answer here: pure
logic is far cheaper to assert under `bun` than under jest, and 137 files of
working assertions have no reason to move.

### The mock boundary: the edge, not the providers

Mock the network and native edge only:

`lib/supabase` · RevenueCat (`react-native-purchases`) · `expo-haptics` ·
`expo-secure-store` · `expo-image-picker` · `expo-file-system` ·
`@react-native-async-storage/async-storage` (the community in-memory mock)

Do **not** mock the 31 providers. They run for real and hydrate from the fixture.

This is the load-bearing decision in the whole design. Mocking providers would
test the mocks — the render paths that actually break are the ones where a real
context returns a real (or missing) value and a screen dereferences it. Running
the real provider stack is the entire point; the edge mocks exist only so that
stack can boot without a device or a network.

### Routes are discovered, not listed

Expo Router is file-based, so the suite walks `app/` and derives the route list
from the filesystem, applying the same conventions the router does — skip
`_layout`, `+not-found`, `+html`, and any non-route file.

A hand-maintained list is the obvious alternative and it is wrong: it drifts the
moment someone adds a screen, and **catching new screens is the point.** A
screen added next month must be covered without anyone remembering to add it.

## The fixture

One module, `__tests__/fixtures/world.ts`, exporting a seeded world:

- one contractor account
- one project carrying a linked estimate
- a handful of RFIs, punch items, permits, daily reports
- a few cost seeds (so the seeded/earned provenance paths render)
- one homeowner portal with a share token

The fixture is deliberately a **product artifact, not test scaffolding**. It is
the same shape wanted for demo data, for marketing screenshots, and for a
"try it with sample data" onboarding path. Building it once and using it three
ways is the reason to make it realistic rather than minimal.

## The two states

Every route mounts **twice**:

1. **Empty** — contexts hydrate from nothing. Exercises empty states and the
   missing-param paths, which is exactly the dead-end class the history shows.
2. **Populated** — contexts hydrate from the fixture. Exercises list rendering,
   the populated branches, and anything that only appears with data.

This roughly doubles runtime and fixture maintenance. That cost was accepted
knowingly: the two states are the two code paths that genuinely differ, and a
suite that only ever sees empty state would have missed, for example, the
punch-list breadcrumb stacking that a populated list made obvious.

## What counts as failure

**A test fails if mounting throws. That is all, initially.**

Specifically NOT failing on `console.error`, even though React logs real
problems there (`Cannot update a component while rendering a different
component`, key warnings, act() warnings). The reason is credibility: this repo
carries 2,931 existing lint warnings. If the smoke suite lights up red on day
one for pre-existing noise, it will be ignored — and an ignored suite is worse
than no suite, because it looks like coverage.

Tighten later, deliberately, once the suite is green and trusted: promote
`console.error` to a failure in a follow-up change, fix the fallout, and keep it
strict from then on.

## Error handling

- A route that cannot be resolved to a component fails with the file path, not a
  stack trace from inside the router.
- Mount failures report the route and the thrown message on one line, so a run
  with twelve failures is readable without scrolling.
- The suite must not swallow errors to keep going — a screen that throws is a
  failure, not a skip.

## Testing the tests

The suite is worthless if nobody has watched it fail. Before it is considered
done, it must be proven in both directions:

1. Introduce a deliberate throw into one screen; confirm that screen — and only
   that screen — fails, naming the route.
2. Remove a required prop guard so a screen dereferences undefined; confirm the
   populated or empty variant catches it.
3. Revert both; confirm a clean run.

This is the same discipline applied to the workflow-pipeline guards: a guard
nobody has seen fail is not known to work.

## Success criteria

1. `bun run test:smoke` (or `npx jest`) mounts every DISCOVERED route in both
   states — the count comes from the filesystem walk, not from this document.
2. A screen that throws on mount fails the run and names itself.
3. Adding a new screen to `app/` puts it under test with no other action.
4. The existing 137 `bun` validators are untouched and still pass.
5. Proven to fail when deliberately broken, in both directions, per above.
6. Runs in CI alongside `tsc` and the validators.
