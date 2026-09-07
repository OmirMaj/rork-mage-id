# Runtime audit — the app, running, on the founder's own account (2026-09-06)

Every finding below was taken from a **Release build on an iPhone 17 Pro
simulator, signed into the production account**, not from reading code. 48
screens were captured from real data — ~$121K budget, ~$77K outstanding, the
Houston Phone Booth Ad / Henderson / Watermark 9F jobs, 21 subs, 16
certifications. Six domain auditors read those screenshots against the source;
every finding they raised was then attacked by three independent verifiers with
different lenses (is it true, is it deliberate, does it actually harm anyone)
and killed on a majority refutation. A completeness critic then looked for what
all six missed.

**45 findings survived. 30 were refuted and are not listed** — that ratio is the
point of the verification pass.

Claims here are checked against production by read-only SQL wherever a number
was involved. Where a cause could not be proven, it says so.

## What was verified WORKING

Worth stating first, because the list below is all defects.

- **Retention netting is live and correct.** Houston invoice #1 is $81,264.63
  gross with $4,063.23 retained; Summary reports **$77,201**, the net figure.
  Before this branch that read gross.
- **Date arithmetic is right** where it is anchored: due 2026-08-26, today
  2026-09-06, the app says 11 days overdue.
- **Code Check address grounding works in both directions.** Brooklyn resolves
  to NYC's own Department of Buildings and NYC Construction Codes (2022) rather
  than New York State's; Chicago, deliberately absent from the table, says "no
  adoption record ... verify with the local building department".
- **The Release build runs at all** — the first successful Release launch since
  the iOS build fix.

## The one that should be fixed before anyone else sees the app

### NAV-01 — "LIVE PRICING" on Materials is a sine wave of the system clock, and those prices flow into estimates

**Where:** `constants/materials.ts:405-408 (applyPriceVariance) and :533-544 (getLivePrices); app/(tabs)/materials/index.tsx:96-104 (refreshPrices), :123 (5-min interval), :257 ("LIVE PRICING"), :381 ("Prices updated …"); consumed by app/(tabs)/estimate/review.tsx:48 and app/(tabs)/estimate/full.tsx:179 via MaterialCartContext`  ·  screenshot `08_materials.png`

The screen shows a pulsing green dot with "LIVE PRICING" and "Prices updated
9:20 PM · New York City rates · Pull to refresh". There is no supplier feed
and no network call anywhere in this path. getLivePrices() takes the hardcoded
EXPANDED_MATERIALS table and multiplies each price by (1 + sin(seed) *
volatility) where seed = Date.now()/10000. refreshPrices() re-rolls that sine
every 5 minutes, on pull-to-refresh, and on app foreground, then stamps the
current wall-clock time as "Prices updated". The same fabricated movements are
compared against user price alerts (index.tsx:106-116) and fire "Price Alert —
X is now $Y, below your $Z target" dialogs for price moves that never
happened. The cart built from these numbers is read by the Full Estimator and
Review Estimate screens.

**What it costs:** A contractor prices lumber, roofing or concrete off numbers the app presents
as a live market feed for their city, puts them in a bid, and sends it to a
client. The numbers are invented. He can also be alerted to "buy now" on a
price drop that is a sine function of what time he opened the app.

## Blocks a real task (13)

### AI-1 — Code Check keeps the previous project's jobsite address when you switch linked projects — the answer is grounded on the wrong city's code while the screen says otherwise

**Where:** `app/(tabs)/construction-ai/index.tsx:373-392 (prefill effect), :957 ("Using X's location and scope"), :1024-1035 (jurisdiction chip), :719-731 (prompt)`  ·  `00_construction-ai.png`

The project-link chip row visible in the screenshot (No project / Houston
Phone Booth Ad / The Henderson Residence …) fills the address via a useEffect
whose every assignment is guarded by the field already being empty (`if (!city
&& sa.city?.trim()) setCity(sa.city)`), and whose dep array is only
`[codeCheckProjectId]`. Link project A, then tap project B: the
city/state/zip/county stay on project A. Meanwhile line 957 renders "Using
<project B>'s location and scope — edit below to adjust",
resolveCodeJurisdiction (:406) still resolves project A's city, and the prompt
is assembled with `PROJECT CONTEXT (auto-filled from "project B")` on line 720
next to `Address: <project A's address>` on line 726.

**Cost:** A GC with jobs in two jurisdictions — exactly this account, which has Houston
plus other projects — runs a code check on the second job and gets an answer
grounded on the first job's building department, presented under a green
ShieldCheck chip reading "Grounded on Houston Permitting Center — 2021 Houston
Construction Code…" and a note saying it used the other project's location.
Wrong adopted edition, wrong permit list, wrong inspection list, asserted
confidently. That is the exact failure the codeJurisdiction module was written
to prevent.

### AI-2 — The iOS location permission dialog states a rule the app breaks in the same session

**Where:** `app.json:26 (NSLocationWhenInUseUsageDescription) vs utils/location.ts:47,56,73-75; callers app/(tabs)/mage-id-bids/index.tsx:31, app/nearby-rfps.tsx:29, app/(tabs)/discover/bids.tsx:52, discover/hire.tsx:21, discover/companies.tsx:20`  ·  `30_estimate-wizard.png`

The purpose string says "Location is only read when you take a photo or stamp
a row — never in the background." But `useUserLocation` calls
`requestForegroundPermissionsAsync()` and then `getCurrentPositionAsync()`
from a bare `useEffect(() => { void requestLocation(); }, [])` that runs on
mount of five list screens, with no photo and no stamp involved. The
screenshots prove it: the prompt first fires on the MAGE ID Bids tab at 9:20
(10_mage-id-bids.png) — a job list — and is still standing, unanswered, over
the estimate wizard, Ask, Copilot Hub and Bid Advisor at 9:22-9:23 (30, 31,
32, 33).

**Cost:** The one sentence a contractor reads before granting location access is untrue,
and it is untrue in the very moment it is shown — a bids list, not a camera.
Beyond the honesty breach this is a classic App Review 5.1.1 purpose-string
rejection: the stated use does not match the observed use.

### MISS-01 — Summary says "Nothing scheduled on site today" and "No scheduled work this week" for two jobs whose Schedule tab is showing tasks running today

**Where:** `app/(tabs)/summary/index.tsx:74 and utils/summaryBriefing.ts:70 vs app/(tabs)/schedule/index.tsx:270-277`  ·  `01_summary.png (also 00_summary-first.png; contradicted by 05_schedule.png)`

Summary anchors an undated schedule to the PROJECT'S CREATION DATE — `const
baseIso = p.schedule?.startDate || p.createdAt;` (summary/index.tsx:74) and
`projectStartBaseMs` (summaryBriefing.ts:70, feeding THIS WEEK via
computeWeekLoad). The Schedule tab anchors the same undated schedule to TODAY
(schedule/index.tsx:274-276, "default to today if missing"). That is a FIFTH
basis for the same missing field, not one of the four the schedule-anchor
finding already listed. Verified read-only in production: The Henderson
Residence (schedule->>'startDate' NULL, created 2026-03-20, 20 not-done tasks
spanning working days 1-29) and Watermark 9F (NULL, created 2026-05-13, 15
not-done tasks, days 1-31). Anchored at createdAt, today (2026-09-06) is
working day ~122 and ~83 — far past day 29/31 — so both cards come back empty.
Anchored at today, the Schedule tab draws task 1 of 20 starting today. The
same screen also contradicts itself: THIS WEEK reads "0 tasks · 0 milestones"
while NEEDS YOU two cards below reads "The Henderson Residence: schedule at
risk (health 55)" and "Watermark 9F: schedule at risk (health 60)" — a health
score for a schedule the card above says has no work in it. TODAY ON SITE and
THIS WEEK also disagree with each other internally: TODAY uses the working-day
model (scheduleDayNumberFor), THIS WEEK uses raw calendar days (dayIndexFor,
Math.round over MS_DAY).

**Cost:** The contractor's morning briefing — the screen the app opens on — reports an
empty day and an empty week on 2 of his 3 active jobs while the Schedule tab
shows 20 and 15 open tasks running now. He plans crew and deliveries off a
briefing that is silently blank.

### MISS-02 — The Release build crashed to the root error boundary during the session — "Maximum update depth exceeded" — and no agent reported it

**Where:** `app/_layout.tsx:1479 (<ErrorBoundary fallbackMessage="MAGE ID encountered an error. Tap below to restart.">), components/ErrorBoundary.tsx:24-39`  ·  `60_CRASH-max-update-depth.png (the crash card is already visible blurred behind the alert in 50_cc-before.png at 9:25)`

This is a real crash in a Release build signed into the founder's production
account, captured at 9:26 during ordinary navigation. The whole app is
replaced by the fallback card: "Something went wrong — MAGE ID encountered an
error. Tap below to restart." plus React's raw text "Maximum update depth
exceeded. This can happen when a component repeatedly calls setState inside
componentWillUpdate or componentDidUpdate…". The boundary is mounted at the
root (app/_layout.tsx:1479), so every screen, the tab bar and the router are
gone. It fired between the 9:24 capture (46_profit-leak-history) and the 9:25
capture (50_cc-before, where the pink alert-triangle tile and the green Try
Again button are already visible behind the location dialog) — i.e. while the
app was being driven through routes, not while doing anything exotic. Sentry
does receive it (ErrorBoundary.componentDidCatch), so it is recorded, but
nothing in the 48-screenshot set was flagged for it. I could not pin the
offending component from source alone — the effects in the Code Check screen
and CodeCheckLoader are all guarded — so treat the root cause as open; the
crash itself is not in doubt.

**Cost:** A paying contractor loses the entire app mid-session and is shown a React
internals string. If this is reproducible on the route it fired on, it is a
launch blocker; either way it is the single worst screen in the capture set to
show a customer.

### MISS-04 — Retainage is withheld on sales tax — and the AIA pay app in the same repo withholds it on work completed instead

**Where:** `app/invoice.tsx:338 and :341; contrast utils/aiaBilling.ts:86-94`  ·  `13_retention.png ($4,063.23 headline) and 12_payments.png ($77,201 Pending)`

app/invoice.tsx:338 sets `totalDue = subtotal + taxAmount`, then :341 sets
`retentionAmount = totalDue * (retentionPctValue / 100)` — so the retainage
percentage is applied to the TAX-INCLUSIVE total. The G702/G703 path in the
same codebase does it the standard way: utils/aiaBilling.ts:86-94 computes
retainage as `(fromPreviousApp + thisPeriod) * pct` on completed work plus
`materialsPresentlyStored * pct`, i.e. on line values only, and the printed
form labels those lines "% of Completed Work" and "% of Stored Material"
(:438-443). Verified against production: Houston Phone Booth Ad invoice #1 has
subtotal 75595, tax_amount 5669.625, total_due 81264.625, retention_amount
4063.23125 — exactly 5% of the tax-inclusive total. 5% of the subtotal would
be 3779.75. The $283.48 difference is retainage held against sales tax the GC
must remit to the state regardless. The invoice totals card
(app/invoice.tsx:1459) shows only "Retention Held (5%)" with no basis
disclosed, sitting directly under "Contract Total".

**Cost:** The Retention screen's headline reads $4,063.23 when $3,779.75 is the
defensible figure, and the same $283.48 is stripped out of the collectible
balance on Payments ($77,201 instead of $77,484.87), on Summary's OUTSTANDING
tile and in the overdue-invoice alert. The contractor under-collects on every
taxed invoice, and the invoice and the pay application for the same job
compute retainage two different ways.

### MONEY-01 — Payments hero "Received" is net of invented card fees and contradicts the row right below it

**Where:** `app/payments.tsx:46-54 (methodToProvider), app/payments.tsx:90 (fee), app/payments.tsx:99 (netAmount), app/payments.tsx:240 + :322 (hero "Received")`  ·  `12_payments.png`

The hero tile renders `formatMoney(stats.received)` where `received` sums
`p.netAmount` — the payment amount MINUS an estimated Stripe fee and MINUS the
MAGE platform fee — while the payment card two rows below renders the gross
amount plus the fee as a separate line, and the "Est. Fees" tile shows the
same fee a third time. Worse, the fee is applied to payments that never went
through Stripe: `methodToProvider` maps every `method: 'credit_card'` to
provider `stripe`, and `cardFeeFor` then deducts 2.9% + 30c + the tier
platform fee. The account's only recorded payment (verified read-only in
production: invoices.payments on The Henderson Residence #1) is $48,826.93,
method `credit_card`, manually keyed on an invoice with `pay_link_url = NULL`
— no MAGE pay link was ever minted, so MAGE charged no platform fee at all.
The screen still deducts $1,415.98 + $0.30 Stripe + $244.13 platform =
$1,660.41 and prints $47,166.52 -> "$47,167". The card is also badged "Stripe"
for a payment MAGE never processed.

**Cost:** The GC's Payments dashboard says $47,167 came in when $48,826.93 actually did.
The hero does not equal the sum of its own rows ($48,827 - $1,660.41 fee), it
will never tie to the bank statement or to the invoice's own Amount Paid, and
$244.13 of the deduction is a MAGE fee that was never charged. Any GC
reconciling collections from this screen is off by $1,660.41 on a single
payment, and the error scales with every hand-entered card payment.

### MONEY-02 — Stripe receipt email tells the client a gross "Balance remaining" that includes retention the client is entitled to hold

**Where:** `supabase/functions/stripe-webhook/index.ts:819 (`const remaining = Math.max(0, opts.totalDue - opts.newAmountPaid)`) vs supabase/functions/_shared/paymentMath.ts:56 (`netPayable`, already imported at index.ts:61 and used at :512/:536)`  ·  `12_payments.png (source-only: the receipt is sent server-side by the Stripe webhook that Payments' pay links feed; not visible in any screenshot)`

Every other retention surface on this branch was moved to the net rule
(utils/invoiceBilling.invoiceOutstanding, paymentMath.settlementStatus,
financialReports A/R aging), but the customer receipt still computes the
remaining balance as gross `total_due - amount_paid`. `ReceiptOpts` carries
only `totalDue`, so the retention columns the same function already read
(INVOICE_COLS at :423 includes retention_amount / retention_released) never
reach the email. `settlementStatus` decides paid/partially_paid on the NET
balance, so the two halves of the same email disagree by exactly the held
retention.

**Cost:** On the founder's live Houston Phone Booth Ad invoice #1 ($81,264.63 total,
$4,063.23 retention at 5%), a client who part-pays through the Stripe link
gets a receipt saying "Balance remaining: $41,264.63" while the app, the
portal and the A/R aging all say $37,201.39. The client is invoiced $4,063.23
of retention that is not due until closeout — either they overpay retention
early or they email the GC about a balance the app cannot reproduce.

### NAV-02 — The #1 item in "4 things need your attention" navigates to an empty Crew screen with no way to fix it

**Where:** `utils/brainWatch.ts:359 (route: { pathname: '/crew' }); components/home/BrainWatchCard.tsx:155-161 (row push); app/crew.tsx:380-390 ("No crew yet" EmptyState); the real screen is app/safety-certifications.tsx:66-76`  ·  `02_home.png`

Home's top critical attention row is "Dana Cole — First Aid / CPR expired".
certAttention() hardcodes route '/crew' for every certification item.
Certifications are not crew rows: the production database has 16 rows in
`certifications` and 0 rows in `crew_members`, so tapping that row lands on
the Crew screen's empty state — "No crew yet · Add your first crew member to
build a verified roster" (visible behind the dialog in 35_crew.png). Dana Cole
is not there and the expired cert cannot be renewed, reassigned, or dismissed
from that screen. The screen that actually holds the 16 certifications and
lets you edit them is /safety-certifications, reachable only via Safety →
Certifications.

**Cost:** The contractor taps the most urgent safety item on his home screen and is
dumped on a blank roster asking him to add his first crew member. The expired
First Aid/CPR flag stays on his home screen and in the tab badge forever
because the path the app offers cannot clear it.

### NAV-03 — MAGE ID Bids "Browse" is a live control for a feature that is switched off, and its empty state blames the user's location

**Where:** `app/(tabs)/mage-id-bids/index.tsx:99 (RFP_BROWSE_ENABLED = false), :308-317 (Browse segment still rendered and tappable), :120 (query permanently disabled), :395-406 (empty card); honest wording already exists at app/nearby-rfps.tsx:172-181; advertised at app/(tabs)/discover/index.tsx:358 and :367`  ·  `10_mage-id-bids.png`

RFP_BROWSE_ENABLED is false, so the browse query never runs. The "Browse"
segment is still rendered and still calls setMode('browse'); the result is the
empty card "No projects within 25 miles yet — Homeowners post their remodel +
new-build RFPs here… Allow location access or expand your radius to see what's
near you." Nothing is within any radius because nothing is ever fetched. The
same team already fixed exactly this string in app/nearby-rfps.tsx (its
comment calls the old text "a permanent lie") and changed it to "Browsing
nearby projects is coming soon" — the fix was not applied here. Meanwhile
Discover advertises "MAGE ID MARKETPLACE · Homeowners post projects,
contractors bid, you pick a winner" and "MAGE ID Bids · Browse nearby private
projects · post your own". mage-id-bids and nearby-rfps are the only two
contractor-facing browse surfaces and both are gated off.

**Cost:** A contractor taps Browse, is told there is no work near him, and is pushed to
grant location and widen his radius to fix a problem that has nothing to do
with either. On the other side, the founder's own two posted projects show "0
bids" on this very screen and will stay at zero, because no contractor in the
app can see a posted RFP at all.

### NAV-04 — Opening the Bids tab fires an iOS location prompt whose stated reason is false, and the prompt blocks the whole app until answered

**Where:** `utils/location.ts:71-74 (useEffect auto-requests on mount) and :49; app/(tabs)/mage-id-bids/index.tsx:110 (hook called unconditionally); same pattern in app/(tabs)/discover/companies.tsx:20, discover/hire.tsx:21, discover/bids.tsx:52; purpose string in app.json:26`  ·  `10_mage-id-bids.png`

useUserLocation() calls requestForegroundPermissionsAsync() from a useEffect
on mount, with no user gesture. Merely opening the MAGE ID Bids tab raises the
OS prompt — and it does so for the distance sort in browse mode, which is
disabled (NAV-03), so the permission is being requested for a feature that
cannot run. The prompt shows the app's Info.plist string: "Location is only
read when you take a photo or stamp a row — never in the background." That is
not what just happened; no photo and no stamp was involved. In this capture
the alert stayed up and the next eleven deep-linked screens (36-46) rendered
identically behind it — the app is unusable until it is answered.

**Cost:** A contractor browsing bids gets an out-of-nowhere GPS prompt with a reason
that does not match what he is doing, so he taps Don't Allow. That same
permission is what stamps daily-report photos and takeoff field verifications,
so the feature the prompt actually described is now silently dead and he has
to find it in iOS Settings. The mismatch between the purpose string and the
real trigger is also an App Review exposure.

### NAV-05 — A subcontractor with no COI on file is shown as green "Compliant" and counted in the Compliant tile

**Where:** `app/(tabs)/subs/index.tsx:32-42 (getComplianceStatus returns 'compliant' when both expiry dates are null), :319-322 (tile counts), :587 and :594 (License Expiry / COI Expiry are optional free-text fields on the add form)`  ·  `07_subs.png`

getComplianceStatus() only ever returns 'expired' or 'expiring_soon' when a
licenseExpiry or coiExpiry date exists. When both are absent it falls through
to `return 'compliant'`. The add-subcontractor form collects COI Expiry as an
optional free-text "YYYY-MM-DD" field with no validation and no requirement,
so any sub added without one immediately renders a green "Compliant" chip and
increments the green Compliant tile — on a screen that also advertises "COI
vault — Upload Certificates of Insurance — AI checks expirations +
endorsements". I confirmed against production that all 21 of this account's
subs currently have both dates, so the "20 Compliant / 0 Expiring / 0 Expired"
in this screenshot is truthful for this data; the defect appears the moment a
sub is added without dates.

**Cost:** A GC adds a sub from his phone without typing a COI date, the roster says
Compliant in green, and he lets an uninsured trade on site on the strength of
a claim the app has no certificate to support. "Unknown" and "Compliant" are
being rendered as the same thing.

### PORTAL-01 — Homeowner portal shows "Project complete: 102%" — the figure is percent-PAID, not percent-built, and is unclamped

**Where:** `utils/portalSnapshot.ts:558-566 (pctComplete = round(paidToDate / contractValue * 100)); marketing/portal/index.html:5528 (stat card labelled 'Project complete')`  ·  `37_client-portal-setup.png`

The portal's headline progress stat is derived purely from money received:
pctComplete = round(paidToDate / contractValue * 100), with no clamp and no
relation to work performed. paidToDate sums invoice amountPaid (tax-inclusive
cash); contractValue is the pre-tax estimate grandTotal plus approved COs. The
two are not the same basis, so a fully-billed taxed job always exceeds 100%.
Verified live: portal_snapshots row portal-827ca6a9-demo for the real project
"The Henderson Residence" currently stores {contractValue: 47725, paidToDate:
48826.93, pctComplete: 102}. The single invoice in that same snapshot is
subtotal 45300.51 + tax 3397.54 = 48698.05, which is exactly why paid exceeds
the pre-tax contract. Note that the same snapshot carries
schedule.tasks[].progress — real progress data the portal already has and
ignores for this stat.

**Cost:** The homeowner opens the link the contractor sent and reads "Project complete
102%" on a job that is not 102% of anything. Before a job is billed out, the
same formula reads 0% while the house is framed — the homeowner concludes
nothing has been done, or that the contractor's software is broken. Either way
it is the first number on the page the customer sees.

### SCHED-NO-ANCHOR — Schedules with no startDate are drawn from 'today', so their task dates silently move forward one day every day (2 of the 3 real schedules)

**Where:** `components/schedule/mobile/MobileScheduleScreen.tsx:100 (`const startDate = activeSchedule?.startDate ?? todayCalendarDay()`), consumed by components/schedule/mobile/MobileScheduleList.tsx:127-131 and TaskDetailSheet.tsx:89`  ·  `05_schedule.png`

The project switcher on this screen reaches The Henderson Residence and
Watermark 9F. Verified in production (`select (schedule ? 'startDate') from
projects`): both schedules have NO startDate key at all — Henderson 20 tasks,
Watermark 9F 19 tasks, both status in_progress, both last updated May 2026.
With no anchor the mobile screen substitutes today's local day and renders
every task from there. Nothing on screen discloses that the anchor was
invented. Other surfaces use different fallbacks for the same missing field —
app/project-detail.tsx:322 and app/last-planner.tsx:86 pass null,
utils/icsGenerator.ts:60 falls back to today, app/(tabs)/construction-
ai/index.tsx:417 to the UTC day — so no two agree.

**Cost:** Opening Henderson's schedule today shows 'Layout & Design Review · Sep 8 – Sep
12'; open it tomorrow, having changed nothing, and the same task reads Sep 9 –
Sep 13. A 33-day schedule that actually began in May presents as starting
today, so a job months behind reads as starting now, and the exported calendar
(.ics) writes those invented dates into the GC's calendar.

## Visible defect (22)

### AI-3 — Construction AI mode toggle: "Code Check" overflows its pill and the Project Roadmap icon is drawn on top of it

**Where:** `app/(tabs)/construction-ai/index.tsx:2442-2467 (modeToggleBar / modeToggleBtn / modeToggleText), JSX :847-884`  ·  `00_construction-ai.png`

Four `modeToggleBtn`s each take `flex: 1` in a fixed-width row (margin 16,
padding 3, gap 3), giving ~89pt per column at 402pt. Content is a 14px icon +
6pt gap + a 13pt semibold label; the `Text` has no `numberOfLines`, no
`flexShrink`, no `adjustsFontSizeToFit`, and the bar has no horizontal
ScrollView, so the content simply overflows (RN's default `overflow:
visible`). Measured off the screenshot: the orange pill spans 19.5→106pt while
its content runs ~18→107pt, and the Roadmap map icon starts at ~106pt — i.e.
it is painted over the "k" of "Check", which is what the crop shows. "Project
Roadmap" wraps to two lines and its first line begins inside the neighbouring
pill; the gavel icon is half outside the pill on the left.

**Cost:** The active mode is unreadable ("Code Chec" with an icon on the last letter),
the bar reads as broken on the first screen of the app's flagship AI feature,
and because the Roadmap icon straddles the boundary, tapping its left half
selects Code Check instead of Project Roadmap.

### CLOSE-DIGEST-TODAY — Friday Close says the homeowner digest 'goes out automatically today' — on a Sunday, when the job only runs Fridays

**Where:** `utils/weekClose/composeWeekClose.ts:372-374; cron verified live: supabase/migrations/20260523130000_cron_secret_guard.sql:89 and `select jobname, schedule, active from cron.job` -> homeowner-weekly-digest-friday, '0 21 * * 5', active`  ·  `23_week-close.png`

The screenshot's header reads SUNDAY, SEP 6 and the Tell-the-clients leg still
shows 'Portal homeowner digest goes out automatically today'. The line is
emitted whenever any active project has a portal, with no weekday test, while
the pg_cron job that actually sends it fires only on Fridays at 21:00 UTC. The
card that opens this modal (components/home/WeekCloseCard.tsx:41-44,
isFridayWindow) shows Friday through Sunday, so the sentence is false on two
of the three days it can be read.

**Cost:** A GC reading this on Saturday or Sunday believes their homeowner already
received a weekly update today and skips sending one; the client actually
heard nothing since Friday. The line is written as an honesty note ('don't re-
surface as a to-do'), so it is exactly the kind of claim a user will trust and
not verify.

### MISS-03 — The crash screen clips its own error text mid-sentence and its only button drops you back into the state that just crashed

**Where:** `components/ErrorBoundary.tsx:42-45 (handleReset), :151-158 (errorBox maxHeight 80), :162 (monospace), :169 (#1A6B3C)`  ·  `60_CRASH-max-update-depth.png`

Three separate defects on the one screen a customer sees when the app breaks.
(1) `errorBox` is capped at `maxHeight: 80` with 12px monospace, which fits
about five lines; the message is six, so the screenshot shows it cut through
the middle of "of nested updates to prevent infinite loops." with no scroll
affordance. (2) `handleReset` does nothing but `this.setState({ hasError:
false, error: null })` — it re-renders the identical subtree on the identical
route. If the update loop is deterministic (and a `Maximum update depth` loop
normally is), "Try Again" re-crashes immediately and there is no other
control: no Go Home, no reset-to-root, no report. Force-quitting the app is
the only exit. (3) The button is hardcoded `#1A6B3C` — the retired forest-
green brand. Every other primary CTA in this capture set is MAGE orange
("Continue" 14_cash-flow, "Judge this job" 33_judges, "Open Projects" 27_lien-
waivers, "Done — close this week" 23_week-close), so the crash screen is the
one place the old brand still ships.

**Cost:** The user is shown a truncated developer stack message in a foreign brand
colour, and the single button offered can loop them straight back into the
crash with no way out of the app short of killing it.

### MISS-05 — An invoice billed with NO retainage seeds an AIA pay application that withholds 10%

**Where:** `utils/aiaBilling.ts:133, reached from app/aia-pay-app.tsx:145; written by app/invoice.tsx:437`  ·  `20_aia-pay-app.png (source-only — that screen never rendered in the capture; the Cash Flow sheet was covering it, see MISS-07)`

app/invoice.tsx:437 stores `retentionPercent: retentionPctValue || undefined`
— a deliberate 0% retention is persisted as `undefined`, not 0. app/aia-pay-
app.tsx:145 then calls `seedAIAPayApplicationFromInvoice(invoice, project,
approvedCOs, settings.branding)` with no `opts`, and utils/aiaBilling.ts:133
resolves `opts?.retainagePercent ?? invoice.retentionPercent ?? 10`. So
`undefined` falls through to a fabricated 10%. Confirmed against production:
The Henderson Residence invoice #1 has retention_amount NULL, total_due
48698.05 — converting it to a pay app pre-fills 10% retainage, about $4,869.80
withheld that the invoice never withheld. The screen does show "Retainage
(10%)" and offers chips to change it (app/aia-pay-app.tsx:660-670), so it is
visible rather than silent — but the default is invented, not carried from the
source invoice.

**Cost:** A GC who bills without retainage and exports a G702 for a lender or architect
submits a certificate showing 10% held and an "amount due this period" roughly
10% short, unless he notices and overrides the pre-filled figure.

### MISS-06 — Every permit created by the AI Permit Roadmap records the jobsite street address as the issuing jurisdiction

**Where:** `app/(tabs)/construction-ai/index.tsx:676; rendered at app/permits.tsx:167; intended semantics at app/permits.tsx:413`  ·  `26_permits.png`

`onAddToPermits` writes `jurisdiction: roadmapProject.location || ''`
(construction-ai/index.tsx:676) — the project's free-text location string goes
into the permit's jurisdiction field, which app/permits.tsx:167 renders
verbatim on the card. The manual add-permit form in that same file proves the
field means the authority: it refuses to save without one and says so — "Add
the issuing jurisdiction (e.g. \"City of Phoenix, AZ\")"
(app/permits.tsx:413). Verified in production: all four of the founder's
permits carry jurisdiction = "124 Park Slope, Brooklyn NY 11215", and that
address is what shows under each card in 26_permits.png. The app already knows
the right answer — `resolveCodeJurisdiction` on the adjacent Code Check tab
resolves that exact address to "New York City Department of Buildings — NYC
Construction Codes (2022)", visible in 61_codecheck-nyc-grounded.png — and
does not use it here. The value also propagates to the homeowner-facing
closeout passport (utils/passport/consumerPassport.ts:528 copies
p.jurisdiction) and to inspection records (construction-ai/index.tsx:530).

**Cost:** The permit tracker, the permit export and the homeowner's closeout passport
all state the permit was issued by a street address instead of a building
department, so the one field an inspector or a closing attorney reads is wrong
on every AI-generated permit.

### MISS-07 — The Cash Flow Setup sheet is a native modal on a screen the router keeps mounted, so it covers every route pushed after it — eight screens never rendered in this capture

**Where:** `app/cash-flow.tsx:210-218 (auto-open) and :987-991; components/CashFlowSetup.tsx:271 (<Modal presentationStyle="pageSheet">)`  ·  `14_cash-flow.png through 22_payment-predictions.png (nine consecutive captures, 9:21-9:22)`

Flagging this because it was refuted and I believe the refutation is wrong.
app/cash-flow.tsx:216 auto-opens the setup wizard on mount whenever
`isSetupComplete()` is false — which is this account's state, corroborated by
Summary's CASH · 4WK tile rendering as "—" (01_summary.png).
components/CashFlowSetup.tsx:271 renders it as a React Native `<Modal
presentationStyle="pageSheet">`, which iOS presents as its own view controller
over the whole window. Expo Router's native stack keeps /cash-flow mounted
underneath as you push on top of it, so the sheet stays presented over each
new screen. The screenshots bear this out: 14 (cash-flow), 15 (budget-
dashboard), 16 (job-costing), 17 (wip-report), 18 (reports), 19
(tax-1099-export), 20 (aia-pay-app), 21 (change-order) and 22 (payment-
predictions) all show the identical "Cash Flow Setup 1/4" sheet with the
Continue button. They are not one repeated frame — they have seven distinct
MD5s, differing in the strip of the parent screen visible above the sheet,
which is exactly what changes when the router navigates underneath. Navigation
was working at the time: the same deep-link run rendered distinct screens for
23_week-close, 26_permits and 28_deliveries a minute later. Real-user
reachability is narrower than a deep-link run (an iOS modal blocks touches, so
you need a programmatic push — a notification tap or an emailed link opened
while the sheet is up), which is why I am scoring this P2 rather than P1.

**Cost:** Anything that navigates the app while the Cash Flow onboarding sheet is open
leaves the user staring at a 4-step wizard for a feature they did not ask for,
with the screen they actually opened invisible underneath it. It also means
eight money screens in this audit set were never actually inspected by anyone.

### MONEY-03 — The overdue amount on the Summary's Needs You list renders as raw digits: "$77201"

**Where:** `utils/brainWatch.ts:123 (`const amt = outstanding.toFixed(0)`) and :131 (`... ${overdueDays}d overdue ($${amt})`)`  ·  `01_summary.png (also 00_summary-first.png)`

The invoice-attention message interpolates `outstanding.toFixed(0)` straight
into the string instead of going through `formatMoney`
(utils/formatters.ts:43), which every other money render in the app uses. The
row reads "Houston Phone Booth Ad: invoice #1 is 11d overdue ($77201)" while
the MONEY tile 300px above it on the same screen shows the same figure as
"$77K".

**Cost:** The one number the app is asking the GC to act on is the only unformatted
money string on the screen. At a glance $77201 reads as easily as $772.01 or
$7.72M; a contractor triaging collections on a phone has to stop and count
digits, and the inconsistency with the tile above it undermines trust in both.

### MONEY-04 — Summary greeting clips the user's name to a single letter: "Good morning, O…"

**Where:** `components/summary/BriefingHero.tsx:26 (greeting string), :32 (`numberOfLines={1}`), :63 (`greet` at Type.largeTitle = 34px/800 weight, constants/typography.ts:34), :61 (row reserves a 38px tools button + 10px gap + 20px padding)`  ·  `01_summary.png (also 00_summary-first.png)`

"Good morning, Omir" at 34px bold is wider than the ~325pt the flex row leaves
after the ••• button, and the Text is capped at one line, so iOS ellipsizes
mid-name. The heading renders as "Good morning, O…" — the greeting keeps the
boilerplate and truncates the only personal token in it.

**Cost:** The first thing the paying user sees every launch is their own name cut to one
letter. It is the largest text on the primary dashboard and it is visibly
broken on a stock iPhone 17 Pro at default text size — not an accessibility-
size edge case.

### NAV-07 — Tools → Subs / Equipment / Materials switches hidden tabs: no back button and no tab highlighted

**Where:** `app/(tabs)/_layout.tsx:229-236 (subs, equipment, materials, estimate, mage-id-bids all href:null); app/(tabs)/discover/tools.tsx:337 and :605 (router.push('/(tabs)/equipment'), router.push('/(tabs)/subs'))`  ·  `07_subs.png`

Subs, Equipment, Materials, Estimate and MAGE ID Bids are registered as tabs
with href:null. Pushing to them from Discover → Tools is a tab switch, not a
stack push, so no back button is created and none of the four visible tabs is
highlighted — visible in 07_subs, 08_materials, 09_equipment, 10_mage-id-bids
and 06_estimate, where Summary, Your Projects, Discover and Settings are all
grey. The screens themselves draw no back control either (Subs' header is
title + Invite + "+").

**Cost:** A contractor goes Discover → Tools → Subs, checks a sub, and has no way back
to Tools and no indication of where he is. He has to tap Discover (which
resets to the Overview tab), then Tools again, and scroll back down to where
he was.

### NAV-08 — Equipment's "Add" button and the global Brain FAB are stacked on top of each other

**Where:** `app/(tabs)/equipment/index.tsx:200 (bottom: insets.bottom + 20) and :431-437 (right: 20, 56x56); components/brain/BrainFab.tsx:115 (bottom: insets.bottom + 70) and :154 (right: 20, 56x56, zIndex 40)`  ·  `09_equipment.png`

Both are 56pt circles pinned to right:20. Their vertical offsets differ by
50pt, less than their 56pt height, so they overlap by 6pt and the Brain FAB
(zIndex 40) is painted over the Add button — clearly visible in the screenshot
as two overlapping orange discs, which also cover the "Available" status chip
of the Tower crane row underneath. The Add FAB's top edge is not tappable.

**Cost:** The Add Equipment button looks broken — two orange circles jammed together in
the corner of the screen — and taps near its top edge open the AI assistant
instead of the add form.

### NAV-10 — Home says "40 working days in the last 30 have no log" — an arithmetically impossible sentence

**Where:** `components/home/DailyLogCard.tsx:88 (totalMissed sums missedDays across projects) and :90-92 (headline template); utils/dailyLogCompletion.ts:49 (DEFAULT_WINDOW_DAYS = 30), :285 (per-project missedDays)`  ·  `02_home.png`

computeDailyLogCompletion() returns missedDays per project, capped at the
working days inside a 30-calendar-day window (at most ~22). The card sums that
across every in-progress project (`rows.reduce((s, r) => s + r.c.missedDays,
0)`) but renders it in a sentence framed as one 30-day calendar window: "{n}
working days in the last 30 have no log." With three active jobs the total
exceeds the window and the sentence contradicts itself.

**Cost:** The first number a contractor reads on the daily-log card is impossible on its
face. It teaches him that the app's counts are not to be trusted, and it hides
the real fact (three jobs each have roughly two weeks of holes).

### NAV-11 — "Friday close — Clean close, nothing left on the table" sits directly above an 11-day overdue invoice and $287 of unsent change orders

**Where:** `components/home/WeekCloseCard.tsx:162-163 and :180-185; utils/weekClose/composeWeekClose.ts:95-120 (projectIsActive 14-day activity gate), :468 (allQuiet)`  ·  `02_home.png`

composeWeekClose only lets a project contribute items when it is in_progress
AND had a daily report, invoice or task movement in the trailing 14 days. Leg
2 is overdue invoices and leg 1 includes drafted change orders. On this screen
the attention card lists "Houston Phone Booth Ad: invoice #1 is 11d overdue"
and the card below it says "$287 in change orders ready to send · 2 drafted
and waiting to send" — yet allQuiet came back true, so the Friday-close card
claims a clean close. The activity gate suppresses exactly the case that
matters: a job that has gone quiet while an invoice ages past due.

**Cost:** On the one screen a contractor checks before closing out the week, one card
tells him there is nothing left to do while two cards next to it show money he
has not chased and change orders he has not sent. If he trusts the close card
he leaves $287 unsent and an 11-day-old invoice unchased.

### PORTAL-07 — The portal link shown on screen is not the link Copy/Share sends — the displayed URL is missing the access token

**Where:** `app/client-portal-setup.tsx:883 (displays `${PORTAL_BASE_URL}/${portal.portalId}`) vs :365-367 + utils/portalSnapshot.ts:1216-1228 (buildShortPortalUrl appends `?t=<accessToken>`), used by handleCopyLink :646 and SendPortalLinkModal :1459`  ·  `37_client-portal-setup.png`

The Portal Link card prints the bare `https://mageid.app/portal/<id>`, but
Copy and Share both hand out `...?t=<64-char accessToken>`. The token is what
authorizes homeowner decisions (change-order e-signature). Separately,
handleCopyLink guards on `linkPending` (:641-644) but handleShare (:656-664)
does not, so the Send-by-email modal can dispatch `portalLink` while
accessToken is still undefined — a token-less link.

**Cost:** A contractor who reads the link off the screen to a customer on the phone, or
retypes it into their own CRM, hands over a URL that opens the portal but
cannot approve change orders. The email path can send that same crippled link
during the token-sync window, and the failure is silent on both ends.

### VIS-01 — Construction AI mode toggle: labels overflow their segments and the next segment's icon draws on top of the active label

**Where:** `app/(tabs)/construction-ai/index.tsx:2451-2467 (modeToggleBtn / modeToggleText), labels at :855, :864, :873, :882`  ·  `00_construction-ai.png`

Four segments are laid out as `flex: 1` inside a fixed-width row
(`modeToggleBar`, gap 3, padding 3) with a 14px icon + gap 6 + an untruncated
`<Text>` in each. On a 402pt-wide iPhone each segment gets ~89pt but "Code
Check" needs ~98pt, so content overflows the segment box. In the capture the
gavel icon is clipped by the left edge of the orange active pill, the Project
Roadmap map icon is painted on top of the "k" in "Code Check", and "Project
Roadmap" wraps to two lines while its three siblings stay on one, so nothing
in the bar shares a baseline. No `numberOfLines`, `flexShrink`, `minWidth` or
`overflow: 'hidden'` is set anywhere in the bar.

**Cost:** The primary mode switcher on the Construction AI screen — the first thing on
screen — renders as overlapping garbage. The selected mode reads as "Code
Chec" with a foreign icon jammed into it, and a contractor cannot tell where
one tappable segment ends and the next begins.

### VIS-02 — Global Brain FAB physically collides with the Equipment screen's own "+" FAB

**Where:** `components/brain/BrainFab.tsx:115 and :153-156 vs app/(tabs)/equipment/index.tsx:200 and :431-437`  ·  `09_equipment.png`

Both are 56pt circles at `right: 20`. The Brain FAB is mounted at the root,
above the router, so its `insets.bottom` is the raw home-indicator inset (34)
→ bottom edge at 104pt. Equipment's own add button lives inside the tab
navigator, whose safe-area context includes the tab bar, so its `insets.bottom
+ 20` puts it at ~137pt. The two circles overlap by ~21pt and, because the
Brain FAB is above the router in the tree, it paints over the "+". Measured in
the PNG: a single continuous orange band 273px (91pt) tall where two separate
56pt circles should be.

**Cost:** Two stacked orange circles in the bottom-right corner with the "Add equipment"
button half-eaten by the AI button. The user cannot tell which is which, and
taps in the overlap region open the AI assistant instead of the add-equipment
sheet.

### VIS-04 — textMuted renders at 2.2:1 contrast — used for real content, not decoration

**Where:** `constants/colors.ts:261 (Theme.light.textMuted = 'rgba(43,48,56,0.4)'), constants/colors.ts:126 (Colors.textMuted = 'rgba(60,60,67,0.36)')`  ·  `00_summary-first.png`

Measured directly from the Release-build pixels: "3 active" and "CASH · 4WK"
render as rgb(164,163,160) on the cream ground rgb(244,239,230) = 2.20:1; "0
tasks · 0 jobs", "across all jobs" and "Nothing scheduled on site today."
render as rgb(170,172,175) on white = 2.28:1. Both sampled values match
`rgba(43,48,56,0.4)` composited exactly, so these are the true glyph colors,
not anti-aliasing. WCAG AA needs 4.5:1 for body text and 3:1 even for large
text.

**Cost:** Counts, empty-state copy and the cash-flow label are effectively unreadable on
a phone in daylight — which is where a superintendent uses this app. The Money
strip's third tile in particular ('—' plus a 2.2:1 caption) reads as a
rendering failure rather than "no data".

### VIS-06 — Status chips paint the brand/system colour as text on its own 8-12% tint — 2.07:1 on the Subs compliance badge

**Where:** `app/(tabs)/subs/index.tsx:354-356 (`backgroundColor: statusColor + '15'`, `color: statusColor`) with getStatusColor at :45-49 returning Colors.success (#34C759, constants/colors.ts:134); same pattern at app/(tabs)/equipment/index.tsx:177-178 and app/(tabs)/construction-ai/index.tsx:2840/2847`  ·  `07_subs.png`

Measured: "Compliant" = #34C759 on rgb(238,250,241) → 2.07:1. "In Use"
(Colors.info #007AFF on its own '20' tint) → 3.41:1. The "Business" tier pill
(Colors.primary #FF6A1A on its own '1A' tint) → 2.58:1. The codebase already
ships the correct darker label tokens — Theme.light.success #2E7D44
(constants/colors.ts:291) and accentFill #BC440C (constants/colors.ts,
documented as founder decision #1 precisely because #FF6A1A only reaches
2.87:1) — and the Materials "avg -17%" chip, which uses the dark green,
measures 4.56:1 and passes.

**Cost:** The single most load-bearing label on the Subs screen — whether a sub's
insurance and licence are current — is the least legible text on it. A GC
scanning 20 rows for a non-compliant sub cannot read the chips without holding
the phone to their face.

### VIS-07 — Summary greets "Good morning" at every hour — the capture was taken at 9:20 PM

**Where:** `components/summary/BriefingHero.tsx:26`  ·  `01_summary.png`

`const greeting = greetingName ? \`Good morning, ${greetingName}\` : 'Good
morning';` — there is no hour check. The screenshots' file timestamps are
21:20–21:21 on Sep 6, and the Materials screen in the same run correctly
prints "Prices updated 9:20 PM", so the device clock was 9:20 PM while the
Summary tab said "Good morning". The two sibling home components do it
correctly (components/ClientHome.tsx:72 and
components/PropertyManagerHome.tsx:40 both branch on `h < 12`).

**Cost:** The headline on the app's landing tab is wrong for two thirds of the working
day. A super checking tomorrow's plan at 7 PM is told good morning, which
undercuts the credibility of everything else on the briefing.

### VIS-08 — Overdue-invoice alert prints an unformatted dollar amount that contradicts the Payments screen

**Where:** `utils/brainWatch.ts:123 (`const amt = outstanding.toFixed(0);`) and :131 (`…is ${overdueDays}d overdue ($${amt})`)`  ·  `00_summary-first.png`

The amount is rendered with `toFixed(0)` and no grouping separators, producing
"($77201)". The Payments screen renders the identical figure as "$77,201" and
the Money strip on the same Summary screen renders it as "$77K". Three
renderings of one number on two screens.

**Cost:** A five-digit receivable shown as "$77201" is easy to misread by an order of
magnitude at a glance, and the inconsistency with the Payments screen makes a
contractor doubt which figure is the real balance.

### VIS-09 — Daily Log card claims "40 working days in the last 30 have no log" — arithmetically impossible

**Where:** `components/home/DailyLogCard.tsx:84 (`const totalMissed = rows.reduce((s, r) => s + r.c.missedDays, 0);`) and :88 (headline)`  ·  `02_home.png`

`missedDays` is computed per project over a 30-calendar-day window
(utils/dailyLogCompletion.ts:49 `DEFAULT_WINDOW_DAYS = 30`, :285 `missedDays:
missedDates.length`). The headline sums that across all in-progress projects
but states it as a single calendar-window fact: "N working days in the last 30
have no log." With three active jobs the sum exceeded the window and printed
40 of 30.

**Cost:** The card on the home screen states an impossible number. A contractor who
notices it stops trusting the daily-log completeness metric entirely — and
this card is the app's argument for why the log matters.

### VIS-11 — iOS location prompt fires from the Bids tab, contradicting the permission copy shown inside it

**Where:** `utils/location.ts:73-75 (`useEffect(() => { void requestLocation(); }, [requestLocation])`) called from app/(tabs)/mage-id-bids/index.tsx:110; prompt text at app.json:26 (NSLocationWhenInUseUsageDescription)`  ·  `10_mage-id-bids.png`

`useUserLocation` requests foreground location permission unconditionally on
mount, and it is mounted by simply opening MAGE ID Bids (also by
discover/bids, discover/companies, discover/hire and nearby-rfps). The alert
it triggers says "MAGE ID stamps jobsite photos with GPS coordinates… Location
is only read when you take a photo or stamp a row — never in the background."
No photo is being taken and no row is being stamped — the user is browsing a
list of posted projects.

**Cost:** The user is asked for GPS at a moment the prompt itself says location will not
be used, which reads as a bait-and-switch and invites a "Don't Allow". Once
the alert is up it is modal over the whole app: in this capture it stayed on
screen across every subsequent route (screenshots 10 through 46), leaving the
app unusable until answered.

### WARR-FORM-UTC-PREFILL — New Warranty prefills tomorrow's start date in the evening, shifting the stored expiry by a day

**Where:** `app/warranties.tsx:197 (`setStartDate(new Date().toISOString().slice(0, 10))` inside resetForm, called by openNew at :202-205) — the useState initializer at :186 correctly uses todayCalendarDay() but resetForm overwrites it on every open`  ·  `25_warranties.png`

This is the exact UTC-day idiom the branch removed elsewhere, left in the one
code path that actually runs. After 18:00 MDT / 20:00 EDT the Start Date field
is prefilled with tomorrow. handleSave then derives endDate =
addCalendarMonths(startDay, months) from that value (app/warranties.tsx:236),
so the whole coverage window is stored one day late.

**Cost:** A GC adding a warranty after the workday accepts the prefilled date and stores
a 12-month warranty that starts and ends one day later than the real handover.
The reminder window, the Expiring Soon tile and any claim-deadline decision
inherit the error.

## Polish (9)

### DFR-CARRY-LABEL — 'Copy from yesterday' can name the wrong day — the relative label is computed from elapsed hours, not calendar days

**Where:** `app/daily-report.tsx:316-324 (`Math.round((today.getTime() - d.getTime()) / 86400000)` over two instants), rendered at app/daily-report.tsx:1571`  ·  `24_daily-report.png`

The superintendent presses 'Copy from yesterday' and gets content from a
different day than the button named, carrying the wrong crew counts and work-
performed text into a record that is signed and sent to the owner.

### MISS-08 — The Schedule tab advertises a "4D Model" — the app has no 3D model and no 3D dependency of any kind

**Where:** `components/schedule/mobile/MobileScheduleScreen.tsx:37; the component itself is components/schedule/mobile/LivingFloorPlan.tsx:1-8`  ·  `05_schedule.png`

A GC evaluating MAGE against Procore or Navisworks taps "4D Model" expecting
model-linked scheduling and gets a zone overlay on a floor-plan image. It is
the kind of label that gets caught in a demo.

### NAV-13 — MAGE ID Bids header title is truncated to "Your posted pro…"

**Where:** `app/(tabs)/mage-id-bids/index.tsx:296-298 (numberOfLines={1}) and :301-304 (the "Post project" CTA sharing the row)`  ·  `10_mage-id-bids.png`

The screen's own name is cut off in the middle of a word, on the first screen
of the marketplace.

### VIS-15 — Summary greeting truncates the user's name to a single letter

**Where:** `components/summary/BriefingHero.tsx:32 (`numberOfLines={1}`) with :63 (`greet: { fontSize: Type.largeTitle.fontSize, fontWeight: '800' }`) and :60 (`paddingHorizontal: 20`, gap 10, 38pt tools button)`  ·  `00_summary-first.png`

The headline on the landing tab addresses the owner as "O…". It looks like a
data bug (a broken name field) rather than a layout limit.

### VIS-17 — textSecondary renders at 3.8:1 — below WCAG AA for all body and description copy

**Where:** `constants/colors.ts:260 (Theme.light.textSecondary = 'rgba(43,48,56,0.6)'), constants/colors.ts:125 (Colors.textSecondary = 'rgba(60,60,67,0.6)')`  ·  `03_discover.png`

Every explanatory line in the app — including the text of the alerts on the
Home card — sits under the legibility floor. In bright site conditions the
descriptions that tell a contractor what each tool does are the first thing to
disappear.

### VIS-18 — Navigation header titles render in two different typefaces across the same stack

**Where:** `app/_layout.tsx:94-98 (NATIVE_HEADER_TITLE = Fraunces_700Bold) applied on 41 routes, overridden without the fontFamily at app/payments.tsx:315, app/retention.tsx:103, app/warranties.tsx:275, app/permits.tsx:479; app/_layout.tsx:611 sets no default headerTitleStyle, so routes declared with title only (e.g. safety at :744) also miss it`  ·  `12_payments.png`

Moving between two financial screens one tap apart changes the title font,
weight and colour, so the app reads as several apps stitched together rather
than one product.

### VIS-19 — Crew screen renders its title twice, stacked

**Where:** `app/crew.tsx:364 (`<Stack.Screen options={{ title: 'Crew' }} />`, with the native header enabled at app/_layout.tsx:793-800) and app/crew.tsx:367 (`<Text style={styles.headerTitle}>Crew</Text>`)`  ·  `35_crew.png`

The word "Crew" appears twice on the same screen, wasting the top ~90pt and
reading as a rendering bug.

### VIS-20 — Discover "My Profile" tile uses a magnifying-glass icon

**Where:** `app/(tabs)/discover/index.tsx:276-285 — `<Search size={16} …/>` above `<Text …>My Profile</Text>`, onPress navigates to `/(tabs)/settings``  ·  `03_discover.png`

The icon and the label disagree, so the tile reads as a search box. A
contractor looking for search taps it and lands in Settings; one looking for
their profile skips past it.

### VIS-21 — MAGE ID Bids header title truncates to "Your posted pro…"

**Where:** `app/(tabs)/mage-id-bids/index.tsx:296-297 (`numberOfLines={1}`) with the style at :569 (`title: { ...Type.serifHeadline }`) sharing the row with the fixed-width "Post project" CTA at :302-304 / :570-575`  ·  `10_mage-id-bids.png`

The header of the marketplace tab shows a cut-off word, and the two modes of
the same screen present differently for no reason visible to the user.

## Refuted, and why that matters

Thirty findings were raised and killed by the verifiers — misread screenshots,
deliberate behaviour with a comment or guard explaining it, and empty states on
deep-linked screens that legitimately need a route parameter. They are not
listed because they are not real. The verification pass exists so this document
can be acted on without re-litigating it.

## Known open

- The **"Maximum update depth exceeded"** crash (MISS-02) is real and captured,
  but its cause is **not proven**. The new Code Check address block was
  exonerated concretely. The decisive evidence — React's component stack — is
  already in Sentry at `mage-id.sentry.io`, project `react-native`; the repo's
  token is upload-scoped and cannot read it.
- Money is stored with **sub-cent precision**: two of five invoices carry a
  `total_due` that is not a whole number of cents, and one retention amount is
  `4063.2312500000003`. Rounding belongs at the point money is computed.

---

## 2026-09-07 — production secrets set, and one new finding

### Closed in production (no deploy required)

**`SCHEDULE_ICAL_SECRET` is set.** It was unset, and the deployed
`schedule-ical` fell back to the literal `mage-id-ical-fallback-rotate-on-leak`,
which is in this public repo — anyone who could guess a project id and its
owner's user id could mint a valid feed token and read that jobsite's schedule.

Measured before rotating, because rotation invalidates every outstanding
calendar-subscription URL: no ical table exists, no stored feed rows, two
projects carry a dated schedule. Blast radius was nil.

Proof it is closed — the same forgery, replayed against the live function after
the secret was set:

```
token from the public literal → oJpYjRxYdaMwHLom
GET …/schedule-ical?sid=…&uid=…&t=oJpYjRxYdaMwHLom → 401 Bad token
```

**`UNSUB_SECRET` is set.** Inert today and deliberately so: the *deployed*
`_shared/email.ts` is still the pre-rotation FNV version and never reads the
variable. Setting it now satisfies the runbook's first gate without touching
live behaviour. Neither secret is shared with any other system — both are
minted and verified only inside edge functions — so there is nothing to record
anywhere else, and nothing to copy into `.env`.

> Live vulnerability this measurement confirmed, still open until the deploy:
> the deployed `unsubscribe` function verifies tokens with that same public FNV
> literal, so today any address can be globally suppressed by a forged token —
> silently blocking that person's invoices, dunning and COI warnings. The fix is
> already in this branch; it ships with the function deploy.

### New finding — UNSUB-C1: the client still mints the public-literal token

`utils/emailLayout.ts:257` keeps the old `UNSUB_SECRET` literal and the FNV
`buildUnsubscribeToken`, under a comment claiming it "mirrors
`supabase/functions/_shared/email.ts`". It no longer does — the server moved to
HMAC-SHA256. `wrapEmailHtml` builds both footer links from it, and two live
screens send mail through it (`app/client-update.tsx:164` weekly update,
`app/client-portal-setup.tsx:748,757` portal invite).

Two consequences, one already happening:

1. **"manage email preferences" is broken today.** The server's legacy grace
   authorises the FNV token for the unsubscribe direction *only* — never
   re-subscribe — so the preferences link in a portal invite fails
   `token_invalid` when the homeowner clicks it.
2. **"Unsubscribe" breaks on 2026-10-04** when the grace path is deleted as its
   own comment instructs, and stays broken, because the client keeps minting
   legacy tokens.

The header path is unaffected: `send-email` already builds `List-Unsubscribe`
with the correct server-minted HMAC, so Gmail/Apple one-click is fine. Only the
in-body links are wrong.

**Not fixed here, deliberately.** The client cannot mint an HMAC without holding
`UNSUB_SECRET`, and putting it in the bundle would recreate the original defect.
The fix is a pipeline change — most likely `send-email` substituting a sentinel
in the HTML it already receives — and it has to answer for the composer fallback
path, which never reaches the server. That deserves the same implement-then-
adversarially-review treatment as the rest of this branch rather than a
string-rewrite bolted on at the end of a session.

### The crash (AI-2 follow-up) is still unproven

"Maximum update depth exceeded", observed once live after granting location.
Ruled out since, with evidence:

- `useUserLocation` — its `request` is `useCallback(…, [])`, so the pre-fix
  `useEffect(() => { void requestLocation(); }, [requestLocation])` ran once. It
  raised the prompt at the wrong time (the AI-2/NAV-04 finding) but did not loop.
- All five consumers (discover/hire, discover/bids, discover/companies,
  mage-id-bids, nearby-rfps) — none has an effect keyed on `location` at all.
- Construction AI, where the error surfaced, never calls the hook. The iOS alert
  is modal across routes, so it was raised by a list screen and merely answered
  while Construction AI happened to be on screen.
- A static scan of `app/`, `components/`, `hooks/`, `contexts/` found **zero**
  effects that set state with no dependency array and **zero** keyed on a
  per-render identity — the two patterns that produce this error most often. The
  eleven self-feeding candidates it did find all converge on a latch.

So the loop is dynamic. Reproduction needs an authenticated session: the web
dev build boots clean to the login screen, and Sentry's issues API rejects the
repo's `sntrys_` token (upload-scoped, HTTP 403). To finish this, either
generate a Sentry token with `event:read` + `project:read`, or connect the
Claude in Chrome extension so the already-logged-in `mage-id.sentry.io` session
can be read.
