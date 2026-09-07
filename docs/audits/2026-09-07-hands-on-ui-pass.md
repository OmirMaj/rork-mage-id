# Hands-on UI pass — the app running on a simulator, 2026-09-07

Separate from the code-read audit. This is what the app actually looks like and
what the accessibility tree actually reports, captured from the running app on
an iPhone 17 Pro simulator, signed into the real production account.

Method: `xcrun simctl` for launch/screenshot, `idb ui describe-all` for the real
accessibility tree, deep links (`mageid:///…`) and taps for navigation. The
native simulator integration refused to attach (it claims Xcode is not selected,
though `xcode-select -p` is correct), so this was driven directly — stated here
rather than left implicit.

## Two things I nearly reported and did not

Recording these because they are the difference between an audit and a list of
guesses.

1. **The blue "Refreshing…" banner clipping every screen header is NOT a
   defect.** It appears on every screenshot and looks like a systemic layout
   bug. It is React Native's dev loading indicator: the installed build has no
   `main.jsbundle`, so it is a Debug build loading from Metro. It cannot appear
   in a shipped build.
2. **The Brain FAB does NOT cover the paywall's Subscribe buttons.** The paywall
   is presented as a modal sheet, so the root-layout FAB renders behind it.
   Verified by screenshot, after suspecting the opposite from code.

## Real findings

### 1. 30 screens render the Brain FAB with no clearance under it
`BrainSurface` is mounted once in `app/_layout.tsx`, so the FAB renders on every
screen. `BRAIN_FAB_CLEARANCE` (150pt, `components/brain/brainFabState.ts:45`) is
opt-in per screen — 134 screens apply it. Thirty scrollable screens do not, so
their last ~150pt sits under the button.

Confirmed visually on Payments, where the FAB covers "Processor fee u[nknown]"
on the Henderson invoice card.

The list, excluding the routes in `BrainFab`'s `HIDDEN_ROOTS` (which correctly
hides it pre-auth and on public viewers):

`ai-punch aia-pay-app bid-detail brief change-order client-update copilot-hub
cost-xray data-export estimate-wizard generative-setup import-pipeline invoice
judges lead-detail messages paywall photo-annotator plan-intelligence
plan-viewer post-rfp qbo-review quick-quote scan schedule-import
schedule-review schedule-wizard submit-bid-response takeoff-estimate week-close`

The money screens in that list are the ones that matter: `invoice`,
`aia-pay-app`, `change-order`, `cost-xray`, `estimate-wizard`.

Fix: apply `BRAIN_FAB_CLEARANCE` to the scroll container's
`contentContainerStyle` on each. Mechanical. A guard could pin it.

### 2. Accessibility is inconsistent between screens, and bad on Payments
Real numbers from the accessibility tree, not inference:

| Screen | Button | GenericElement |
|---|---|---|
| Home (`(tabs)/(home)`) | 21 | 16 |
| Summary | 8 | 7 |
| Payments | **1** | many |
| Discover | 8 | **24** |

On Payments, "Collect Oldest Unpaid" — the primary action — is a
`GenericElement`. VoiceOver will not announce it as a button. The All/Pending/
Completed segmented control and both invoice rows are the same. Only "Open MAGE
Brain" is a real `Button`.

On Discover, all six sub-tabs (Overview, Tools, Public Bids, Companies,
Estimator, Schedule) are `GenericElement`.

Fix: these are `Pressable`/`TouchableOpacity` without
`accessibilityRole="button"`. Cheap, and it is also an App Store accessibility
expectation.

### 3. Discover is a junk drawer with two parallel navigation trees
Its own subtitle names five unrelated things: "Tools · bids · companies · AI ·
marketplace".

The same destinations are reachable two ways: **Tools**, **Estimator** and
**Schedule** are each a sub-tab in the top strip AND a card in the list below.
That is the parallel-nav-tree pattern this codebase has been warned about
before.

"MANAGE WORK — Approvals, cash flow, permits, compliance **& 14 more**" puts 14
destinations behind one card with no way to see them without tapping in.

The sub-tab strip also clips mid-word ("Compa…") with no scroll affordance.

### 4. The triage list truncates the part you need
On Home, "4 things need your attention" is the best thing on the screen — but
two of the four truncate exactly where the actionable detail starts:

- "The Henderson Residence: schedule at risk (he…"
- "Houston Phone Booth Ad: invoice #1 is 12d ove…"

A triage list that hides *how* overdue and *why* at-risk makes the user tap to
learn what the list exists to tell them. Two lines, or move the number to the
front.

### 5. Schedule Pro tells users to use an iPad the app does not support
`app/schedule-pro.tsx:1658` renders "Schedule Pro is built for laptops and
iPad." `app.json` sets `ios.supportsTablet: false` — there is no native iPad
app. A contractor who follows that advice gets iPhone compatibility mode, which
triggers the same phone redirect, which shows the same message. A loop.

Either support tablet or stop naming iPad in the copy.

Also: that screen leaves roughly the top half of the phone empty before the
centred message. It reads as a broken screen rather than a deliberate redirect.

### 6. The app defaults to Light and ignores the phone's dark setting
`contexts/ThemeContext.tsx:32` initialises `ThemePref` to `'light'`, not
`'system'`. The machinery for all three is there and correct — it re-resolves on
OS appearance change when the pref is `'system'` — but a contractor whose phone
is in dark mode gets a bright cream app and has to find
Settings → Appearance to fix it.

That is worth changing precisely BECAUSE the dark theme is good (see below).
Defaulting to `'system'` costs one word.

### 7. The tab bar announces twelve tabs to VoiceOver; four exist
From the live accessibility tree on any tab screen:

```
Button  "Summary, tab, 1 of 12"
Button  "Your Projects, tab, 2 of 12"
Button  "Discover, tab, 4 of 12"      <- 3 is missing
Button  "Settings, tab, 5 of 12"
```

Root cause, pinned: `app/(tabs)/_layout.tsx` declares 24 `Tabs.Screen`, 21 of
them `href: null`. In the branch that renders, `estimate` (line 225) is
registered hidden BETWEEN `(home)` and `discover`, which is exactly why the
announced indices run 1, 2, **4**, 5 — React Navigation counts every registered
screen when it builds the accessibility position, visible or not, and twelve are
registered in that branch.

Everything visual is correct; only the announcement is wrong. Cheapest fix:
set an explicit `tabBarAccessibilityLabel` on the four visible tabs (e.g.
`'Summary, tab, 1 of 4'`). The architectural fix — moving the 21 hidden routes
out of the tab navigator — is much larger and not worth it for this alone.

### 8. Project detail stacks two floating buttons over a tile it needs
`app/project-detail.tsx:4593` renders `<UniversalMicButton projectId={...} />`
WITHOUT `hideFab`, so it draws its own floating dark mic — and the global orange
`BrainFab` from `BrainSurface` is already there. It is the only screen in the app
that does this (checked across app/ and components/).

The result on the screen a GC lives in: **three concurrent ways to talk to the
AI** — the inline "Ask MAGE to do anything" card with its own mic, the floating
dark mic, and the orange Brain FAB — with the two floating ones stacked over the
"Cash Flow" tile.

Fix: pass `hideFab` at :4593 and let the inline card be the project-scoped
entry point, or drop the inline card and keep the FAB. Not both plus a third.

### 9. The stage stepper truncates the CURRENT stage
"Construction" renders as "Constru…" in the 4-item Project Stage control. The
one label a user most needs to read — where the job is right now — is the one
that does not fit. Shorten the labels ("Pre-Con / Build / Post-Con / Closeout")
or let the active chip size to its content.

### 10. The hub reports 0% markup without comment
The Houston project shows `Markup 0% · Base Cost $76,525 · + Markup $0`,
presented as three neutral stat tiles. The paywall two screens away promises
"Margin that defends itself — get warned before a job loses money."

A job bid at zero markup loses money by definition once overhead is counted, and
this is the screen where that should be said. (Caveat: this is the founder's own
test data, so the number may not be representative — but the *presentation* is
neutral by design, not by accident.)

## What is genuinely good

Worth stating plainly, because an audit of only faults gives no baseline.

- **Money copy carries its own provenance.** Payments shows "Amount paid, before
  fees", "Excludes $3,780 retention held", and — unprompted — "1 card payment
  was recorded by hand. MAGE did not process it, so its processor fee is
  unknown and none is deducted above." That last sentence is the product's
  honesty rule doing real work.
- **The daily-log copy teaches the job, not the UI**: "A daily log is worth more
  for being complete than for being detailed… A day filed later carries the date
  you filed it, not the day it covers, so the gap stays." That is domain
  expertise, and no competitor's empty state reads like it.
- **Home leads with money and risk**, not navigation: "4 things need your
  attention", "$287 in change orders ready to send", "2 jobs have no log for
  today."
- **CTAs are specific**: "Collect Oldest Unpaid", not "Submit".
- **The "pick a project" interstitial explains itself** ("Invoices live inside a
  project so they roll up to the right place") instead of just blocking.
- **Only four bottom tabs.** The restraint is right.
- **Dark mode is properly built, not inverted.** Settings → Appearance → Dark
  gives a real ink/amber theme: true dark ground, warm off-white text, cards
  with their own elevation and borders, and the orange accent used for emphasis
  and never as a background — which is the house rule. It is one of the
  best-executed parts of the app, which is exactly why defaulting away from it
  (finding 6) is a waste.
