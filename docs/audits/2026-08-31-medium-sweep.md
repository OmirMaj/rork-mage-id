# 2026-08-31 — medium/high sweep (re-derived)

Produced by an 8-dimension parallel audit with 3-lens adversarial verification
(each finding needed 2-of-3 verifiers to survive; lenses were *does the code do
this*, *is there already a guard*, *is the impact real and medium*).
37 raised, 34 survived, 32 after dedup.

WHY THIS FILE EXISTS: the previous 65-defect list lived only in a conversation
and was lost to context compaction, so the work had to be re-derived from
scratch. Findings get written down now.

Severity note: the sweep was scoped to MEDIUM, but ranks 1-5, 7, 10, 12, 14 and
20 are materially worse than that. They are ordered by user impact, not by the
label they were collected under.

Status legend: [ ] open  [x] fixed  [~] refuted / needs founder call

ALL 30 non-refuted findings are fixed as of 2026-08-31. #10 and #20 were
refuted against the live database. Two items remain founder decisions and are
NOT in this list: utils/jobCostEngine.ts:245 (client invoice payments counted
as job-cost actual) and utils/aiaBilling.ts:144 (thisPeriod = scheduledValue).

## [x] #1 — Job-cost budget is seeded from the marked-up sell price, so every healthy job reports 0% margin and "critical" health

**Where:** `utils/jobCostEngine.ts:201`

**What breaks:** `existing.budget += item.lineTotal` sums the SELL figure (full.tsx:933 defines lineTotal = base * (1 + markup/100) * qty, and grandTotal = Σ lineTotal). Budget therefore equals revenue, so projectedFinal === projectedRevenue and livingEstimate.ts:252-256 computes $0 projected profit on a job where nothing has happened. Legacy branch at :204-210 uses project.estimate.grandTotal with the same defect.

**User impact:** A GC who just linked a $165K estimate (15% default markup) opens Living Estimate and is told the job projects $0 profit, health 'critical', with a fabricated "$15K of cost growth". Real erosion is indistinguishable from this baseline noise. The same inflated EAC flows into computeProfitReport (health 'red') and the bank-facing WIP row and its CSV, understating profit by exactly the markup.

**Fix plan:** Change line 201 to `existing.budget += (item.usesBulk ? item.bulkPrice : item.unitPrice) * item.quantity;` so Σ budget === estimate.baseTotal, change :207 to use project.estimate.baseTotal, and add a non-zero-markup fixture to scripts/validate-job-cost-variance.ts (every existing fixture uses markup: 0, which is why the guard is blind to this).

## [x] #2 — Bid-vs-actual compares marked-up bid against at-cost actuals, so the cost-calibration loop recommends pricing future jobs below cost

**Where:** `utils/estimateActuals.ts:155`

**What breaks:** `const bid = it.lineTotal || 0;` uses the marked-up total while commitment.amount/paidToDate are true cost dollars. Confirmed at estimateCalibration.ts:138-149: `bias = b.actual / b.estimated` buckets those mismatched numbers, so a line bought out exactly at cost ($8,000 cost, $9,200 lineTotal) yields bias 0.87 and a suggested ×0.87 multiplier. The doc comment at :39 ("lineTotal, pre-markup") and the on-screen note at app/estimate-accuracy.tsx:204 both assert the opposite of what the code does.

**User impact:** Every buyout reads more favorable than reality by the markup percentage, and the learning loop the product is built around systematically concludes the GC over-estimates. Accepting the correction runs applyCalibrationToEstimate, permanently repricing future estimates ~13% BELOW actual cost — and the bias compounds each time a correction is applied. livingEstimate.buyoutVariance and jobCostEngine.ts:305-309's overcommitted check read the same field the same wrong way.

**Fix plan:** Replace line 155 with `const base = it.usesBulk ? it.bulkPrice : it.unitPrice; const bid = base * (it.quantity || 0);`, use the same cost basis for the `weightTotal`/`share` weighting at :137 and :148 and for livingEstimate.buyoutVariance's estimatedCost, and correct the doc comment at :39 plus the user-facing note at app/estimate-accuracy.tsx:204.

## [x] #3 — Offline flush keeps processing a record's group after an earlier mutation fails, so UPDATEs and DELETEs match zero rows, "succeed", and are discarded

**Where:** `utils/offlineQueue.ts:271`

**What breaks:** processGroup's catch branches all `continue` to the next mutation in the SAME record group instead of aborting. When a queued insert FK-fails (parent row not yet synced), the follow-up `update(rest).eq('id', id)` matches 0 rows, PostgREST returns no error, `gProcessed++` fires and the mutation is dropped at write-back (line 330). The insert then succeeds on the next flush carrying its original payload. Grouping exists precisely to preserve intra-record ordering (comment at :191-194) and the loop defeats it.

**User impact:** A contractor who works offline — the normal jobsite state — and creates then edits a record in the same session loses that edit permanently and silently. Approve a $5,000 CO up to $7,500 offline and the server keeps $5,000/pending, which is what every other device and the homeowner's client portal show; changeOrdersQuery is server-first and calls saveLocal, so the device reverts to match on next launch. Create-then-delete resurrects the deleted row for good.

**Fix plan:** In all three catch branches except `isTerminalError`, push the failing mutation plus every remaining member of `group` into `gRemaining` and `break` out of the loop; separately give the update/delete arms `{ count: 'exact' }` or `.select('id')` and treat a zero-row match as a failure rather than success.

## [x] #4 — Cash-flow forecast silently drops any receivable whose expected date lands on the last day of a forecast week

**Where:** `utils/cashFlowEngine.ts:94`

**What breaks:** `weekEnd` is built at :168-169 as weekStart + 6 days at 00:00:00.000, and `isDateInWeek` tests `d >= weekStart && d <= weekEnd`. Every instant after midnight on day 6 belongs to no week. Invoice expected dates carry a real time-of-day (app/invoice.tsx:345 stores a full ISO timestamp; generateForecast preserves it through `expectedDate.setDate(+termsDays)`), so ~1 in 7 receivables matches zero weeks. Same hole hits expectedPayments (:250) and the pending-CO branch (:239).

**User impact:** Roughly one seventh of a GC's incoming cash vanishes from the weekly runway — a $76,780 invoice issued Aug 14 at 10:15 with net-30 appears in no week at all. This is the screen the GC uses for the "can I make payroll / is this a danger week" call, and it feeds hooks/useMorningBrief.ts:81 and utils/oneMind/factBlocks.ts:610, so the understated balance propagates into AI advice. The money never shows up, not even late.

**Fix plan:** After `weekEnd.setDate(weekEnd.getDate() + 6)` at line 169 add `weekEnd.setHours(23, 59, 59, 999);`, or change isDateInWeek to a half-open `d >= weekStart && d < new Date(weekStart).setDate(weekStart.getDate() + 7)`.

## [x] #5 — Four Business-gated screens render a Pro paywall — the user buys Pro at $29/mo and is still locked out

**Where:** `app/portfolio-margin.tsx:64`

**What breaks:** `canAccess('portfolio_margin')` is checked but `<Paywall requiredTier="pro">` is rendered, while featureTiers.ts:101 sets portfolio_margin: 'business'. Paywall.tsx:177 calls purchasePro, the purchase succeeds, and the identical wall reappears. Verified identical on app/win-optimizer.tsx:41 and app/estimate-calibration.tsx:44 (both gate portfolio_margin), and app/auto-bids.tsx:42 (gates bid_scoring, also 'business' per featureTiers.ts:94). Paywall has no "you already own this tier" check.

**User impact:** A contractor pays $29/mo to unlock Margin Board / Win Optimizer / Estimate Calibration / Auto-Bids and gets nothing — same wall, same "Upgrade to Pro" copy for the plan they just bought. That is a charge for undelivered product, and the likely next step is a chargeback or churn. Existing Pro subscribers are told to upgrade to the tier they already hold.

**Fix plan:** Replace the hardcoded literal with `requiredTier={requiredTierFor('portfolio_margin')}` (useTierAccess already exports requiredTierFor) at portfolio-margin.tsx:64, win-optimizer.tsx:41, estimate-calibration.tsx:44 and `requiredTierFor('bid_scoring')` at auto-bids.tsx:42, and make Paywall no-op when the current tier already meets requiredTier.

## [x] #6 — Mobile Gantt renders every task bar one calendar day early via UTC-midnight parse of the schedule anchor

**Where:** `components/schedule/mobile/MobileGantt.tsx:113`

**What breaks:** `startOfDayMs(startDate ? new Date(startDate) : new Date())` — startDate is a bare 'YYYY-MM-DD' (MobileScheduleScreen.tsx:97), which JS spec-parses as UTC midnight, floored to the PREVIOUS local day at any negative UTC offset. Every bar is `dayToX((startDay ?? 1) - 1)` off that shifted base, as are the week-tick labels (:268) and isWeekendOffset (:127) — but `todayIdx` (:114) is computed from the real local today, so the two disagree by one column.

**User impact:** On the iOS-primary mobile scheduler the whole timeline is off by a day for the entire US market: a Monday task is drawn under Sunday and sits LEFT of the today line, reading as already late. It contradicts the same schedule opened in schedule-pro, which correctly parses `startDate + 'T00:00:00'` (schedule-pro.tsx:519), and stampActuals writes actualStartDay off the correct basis so auto-stamped actuals land a column away from where the user tapped.

**Fix plan:** Change line 113 to `startOfDayMs(startDate ? new Date(startDate.slice(0, 10) + 'T00:00:00') : new Date())`, or route it through `parseCalendarDay` from utils/calendarDate.ts which exists for exactly this.

## [x] #7 — Change-order insert never writes schedule_impact_days, and the two anchor columns are neither written nor read — an approved CO's time extension never reaches the schedule

**Where:** `contexts/ProjectContext.tsx:2236`

**What breaks:** The only insert path for change_orders omits schedule_impact_days, schedule_impact_task_ids and schedule_anchor_task_id; only the UPDATE at :2347-2352 writes schedule_impact_days, and the mapper at :707 reads back only that one column. A repo-wide grep confirms schedule_impact_task_ids / schedule_anchor_task_id appear ONLY in migration 20260803150000 — never in any read or write — despite that migration's comment claiming "the anchor survives a device swap."

**User impact:** After any server-first refetch (app restart, or past the 5-min staleTime), scheduleImpactDays hydrates as undefined; approving the CO then runs normalizeImpactDays(undefined) → 0 → status 'no_impact' and nothing on the Gantt moves. The owner signed off on "+5 days", the CO PDF drops its Schedule Impact row (pdfGenerator.ts:863), the client portal stops showing the extension, the rescue prompt at project-detail.tsx:2726 disappears, and the contractual time-extension entitlement is absent from the server row entirely.

**Fix plan:** Add `schedule_impact_days: finalCo.scheduleImpactDays ?? null, schedule_impact_task_ids: finalCo.scheduleImpactTaskIds ?? null, schedule_anchor_task_id: finalCo.scheduleAnchorTaskId ?? null` to the insert at :2236, add the latter two to the update at :2352, hydrate both in the mapper next to :707, and extract a shared `changeOrderToRow(co)` so insert and update cannot drift again.

## [x] #8 — A/R aging report counts unsent draft invoices as outstanding receivables

**Where:** `utils/financialReports.ts:262`

**What breaks:** computeARAgingReport's only skip is `if (outstanding <= 0.5) continue;` — there is no status filter, despite the comment claiming it skips canceled invoices. app/reports.tsx:67 passes the full unfiltered `invoices` array. The same file's computeWIPReport at :79 DOES exclude drafts (`filter(inv => inv.status !== 'draft')`, comment "DRAFTS ARE NOT BILLINGS"), and app/project-detail.tsx:222 pre-filters at its call site — so only the Reports hub is exposed.

**User impact:** A $40K invoice staged via Bill from Estimate and never sent shows up as OUTSTANDING in danger red, then ages into the 31-60 past-due bucket, and rides out on the exported CSV/PDF. Two tabs of the same Reports screen contradict each other: WIP says nothing was billed, A/R says it's overdue. The GC's collections number is overstated by every staged draft.

**Fix plan:** Add `if (inv.status === 'draft') continue;` immediately before the outstanding check at line 261, and drop the now-redundant call-site filter in app/project-detail.tsx:222 so the two surfaces cannot drift.

## [x] #9 — sendEmail's web fallback returns success:true after opening a mailto: with a placeholder body and no attachments

**Where:** `utils/emailService.ts:196`

**What breaks:** When sendViaResend fails on web (edge function down, RESEND_API_KEY unset, Resend 4xx/5xx), the fallback opens `mailto:...&body='Please view the attached document.'` and unconditionally returns `{ success: true }`. The real HTML invoice, the Stripe pay link, the financing block and the PDF are all discarded; a popup blocker means nothing opens at all. The native arm two lines below correctly passes `body: params.html, isHtml: true, attachments`. This is the merged report of the two findings filed at :196 and :198.

**User impact:** A GC on web sends an invoice, sees "Email Sent", and app/invoice.tsx:604-628 flips the invoice to 'sent' so dunning and A/R aging start counting from a send that never happened. The client receives one sentence or nothing. Same false success for portal invites (client-portal-setup.tsx:732 — whose own better mailto fallback is dead code), RFIs (rfi.tsx:389), submittals (submittal.tsx:213) and sub-portal invites (sub-portal-setup.tsx:275).

**Fix plan:** On the web branch, put a text-stripped `params.html` in the mailto body, warn that attachments could not be included, and `return { success: false, error: resendResult.error }` (or a distinct `outcome: 'composer_opened'`) so no caller flips a document to 'sent'.

## [~] REFUTED #10 — plan_sheets insert writes three columns that do not exist, so every drawing upload is rejected and re-queued forever with no error surfaced

> **REFUTED 2026-08-31** by direct production introspection: plan_sheets.revision / previous_sheet_id / superseded ALL EXIST in production.
> The verifiers that read `supabase/schema.sql` and the migrations concluded the
> columns were missing; the repo schema file is STALE. Only the agent that
> queried the live database got this right.

**Where:** `contexts/ProjectContext.tsx:4996`

**What breaks:** The insert payload includes `revision`, `previous_sheet_id` and `superseded`. public.plan_sheets is defined at supabase/schema.sql:1155-1167 and supabase/migrations/add_plans_sync.sql:29-41 with exactly id, user_id, project_id, name, sheet_number, image_uri, page_number, width, height, created_at, updated_at — a grep for ALTER TABLE plan_sheets across all migrations returns only ENABLE ROW LEVEL SECURITY. PostgREST returns PGRST204, which offlineQueue.ts:84-90 classifies as a schema-cache error → TRANSIENT → re-queued unchanged with retryCount deliberately not incremented and no toast or Sentry event. The supersede update at :4977 fails the same way.

**User impact:** Drawings marked up on an iPad never reach Supabase and never will: hydratePlansFromServer gets zero rows, so the plan set is invisible on the web app and gone after a reinstall, and drawing_pins/plan_markups FK to plan_sheets.id so their inserts fail too. The app shows no error while the offline queue grows silently and eventually evicts other pending writes at its FIFO cap (offlineQueue.ts:113).

**Fix plan:** Ship `alter table public.plan_sheets add column if not exists revision integer, add column if not exists previous_sheet_id uuid, add column if not exists superseded boolean not null default false;` (the referenced add_plan_sheet_revisions.sql has never existed in this repo), or strip the three keys from the insert at :5001-5003 and the update at :4977 until it lands; also fix the mapper at :4849 which types revision as string|null while the writer produces a number.

## [x] #11 — Mobile task detail sheet shows a task's start and end one day early, weekday name included

**Where:** `components/schedule/mobile/TaskDetailSheet.tsx:74`

**What breaks:** `const d = startDate ? new Date(startDate) : new Date(); d.setHours(0,0,0,0);` — same UTC-midnight parse of a bare 'YYYY-MM-DD' as MobileGantt, so baseMs lands on the previous local day. `start = new Date(baseMs + startOffset * MS_DAY)` renders a startDay:1 task as "Sun, Mar 1" on a schedule anchored Monday Mar 2, where GridPane.tsx:547 reads Mar 2 → Mar 6 for the same task.

**User impact:** `fmt` prints the weekday name, so the error is loud and actionable in the wrong direction — a foreman reads "Sun, Mar 1" for a Monday task. The ± stepper next to it edits startDay against this mislabeled date, so a user correcting what looks like a wrong date actually moves real scheduled work by a day.

**Fix plan:** Change line 74 to `const d = startDate ? new Date(startDate.slice(0, 10) + 'T00:00:00') : new Date();`, or use parseCalendarDay from utils/calendarDate.ts.

## [x] #12 — batchSendToClientPortal loses the "sent" flag for every item but the last of each kind, so "Send all" reports success and the items stay in the outbox

**Where:** `contexts/ProjectContext.tsx:3704`

**What breaks:** updateItemPortalState reads the state arrays directly from its closure (`const n = setNext(changeOrders)` at :3585), and batchSendToClientPortal calls it in a synchronous loop — no re-render happens mid-loop, so every iteration maps over the ORIGINAL array. Only the last item of each kind survives in the persisted list, while `sent++` increments unconditionally. The file's own comment at :3598-3601 names this exact hazard.

**User impact:** The GC is told "3 items sent to your client" and the outbox immediately still lists 2 of them as drafts (client-outbox.tsx:69 buckets status 'draft'). They tap Send all again, which inserts a SECOND consolidated "N new updates from your builder" portal_messages row and re-versions documents the client already received. Send a batch of 10 photos and 9 stay 'draft' locally — the copy an offline device renders from.

**Fix plan:** Convert updateItemPortalState's cases to functional setState (`setChangeOrders(prev => prev.map(...))`) and derive the persisted list from the updater result, or add a batch variant that applies all items of a kind in one map before calling the setter and mutation once.

## [x] #13 — Sub-invoice overpayment guard double-counts the invoice being paid, firing a false "Overpayment risk" on every fully-billed commitment

**Where:** `app/sub-portal-setup.tsx:302`

**What breaks:** `commitment.paidToDate` is the server-trigger rollup of approved + paid sub invoices (types/index.ts:2216-2221), and the "Mark paid" button only renders for invoices already in 'approved' status (:634), so that invoice is already inside paidToDate — yet checkOverpayment computes `total = alreadyApproved + thisAmount`. The client-side fallback at :304-308 correctly excludes the current invoice but is unreachable, because ProjectContext.tsx:797 coerces `paid_to_date == null ? 0 : Number(...)` so `(commitment.paidToDate ?? null) != null` is always true. The handleApprove path at :325 is correct (the invoice is still 'submitted' there).

**User impact:** On the final draw of a fully-billed $50,000 commitment the GC gets a blocking destructive dialog claiming they are about to push the sub $10,000 over contract on a payment that is exactly on contract. They either stop and chase a change order that doesn't exist, or learn the warning is noise and click "Pay anyway" through it — defeating the guard the feature exists for.

**Fix plan:** Compute `const alreadyApproved = paidToDate - ((invoice.status === 'approved' || invoice.status === 'paid') ? thisAmount : 0)` in the paidToDate branch, and change the null test to `typeof commitment.paidToDate === 'number'` (or drop the `?? 0` coercion at ProjectContext.tsx:797) so the offline fallback can actually run.

## [x] #14 — Marketplace bid feed orders public_bids by fetched_at, a column that does not exist — every server read 400s and silently falls back to an empty local cache

**Where:** `contexts/BidsContext.tsx:27`

**What breaks:** `.from('public_bids').select('*').order('fetched_at', { ascending: false })`. public.public_bids is defined at supabase/schema.sql:552-574 with created_at and no fetched_at, and no migration adds one — fetched_at belongs to the cached_* / material_prices family. PostgREST returns 42703, `if (!error && data && data.length > 0)` is false, the mapper and AsyncStorage write never run, and the query returns the local cache, which on a fresh install is [].

**User impact:** The MAGE ID bid marketplace is empty for every user on a fresh install or second device even though the bids exist in Supabase, and app/auto-bids.tsx:55 builds its entire priced-opportunity list from useBids().bids so the Auto-Bids screen shows zero opportunities and $0 expected profit forever. app/bid-detail.tsx:159 renders "not found" for any non-cached bid. The contractor concludes the marketplace is dead.

**Fix plan:** Change line 27 to `.order('posted_date', { ascending: false })` (or created_at), and drop the `data.length > 0` condition so a genuinely empty successful read is distinguishable from a rejected one.

## [x] #15 — updateRFI never persists date_required, submitted_by, linked_drawing or linked_task_id, and the mapper reads them back over the local copy

**Where:** `contexts/ProjectContext.tsx:4150`

**What breaks:** The update payload carries subject, question, assigned_to, assigned_sub_id, ball_in_court, handoffs, date_responded, response, status, priority, attachments, updated_at — and none of the four fields the RFI screen edits. All four are real columns written on INSERT by rfiToRow (:4073-4082) and read back by the mapper (:1485-1487) followed by `await saveLocal(RFIS_KEY, mapped)`, so a refetch destroys the local copy too. app/rfi.tsx:262-277 does pass all four.

**User impact:** A GC who grants the architect a two-week extension on an RFI sees the date revert on next launch with no error. dateRequired drives the overdue machinery everywhere — the systemOfAction chase list and its auto-drafted nudge, oacEngine.ts:131/168 agenda aging, and the red "overdue" flag on the RFI Log PDF (pdfGenerator.ts:1128-1153) — so they keep being told it's overdue and keep auto-chasing against a deadline they already moved. A corrected drawing reference reverts to the wrong sheet.

**Fix plan:** Add `date_required: r.dateRequired, submitted_by: r.submittedBy, linked_drawing: r.linkedDrawing ?? null, linked_task_id: r.linkedTaskId ?? null` to the payload at :4150 — better, call the existing `rfiToRow(r)` for the update so insert and update share one row builder.

## [x] #16 — updateSubmittal never persists submitted_by or required_date, and the mapper reads them back over the local copy

**Where:** `contexts/ProjectContext.tsx:4416`

**What breaks:** The update payload is only `{ id, title, spec_section, review_cycles, current_status, attachments, updated_at }`. Both omitted fields are real columns (schema.sql:437-452, required_date is TEXT NOT NULL), both ARE written on INSERT by buildSubmittal (:4367-4374) and both ARE read back at :1518-1519 before `await saveLocal(SUBMITTALS_KEY, mapped)`. app/submittal.tsx:232-237 is the only caller and passes both.

**User impact:** A GC who extends a submittal's review window watches the date silently revert on next launch. requiredDate drives systemOfAction.ts:123's `daysPast(s.requiredDate)` awaiting-review chase list and its auto-drafted nudge ("awaiting review for N days past the required date. Material orders are held until it's returned"), so the reviewer keeps getting nudged against a deadline that moved, and pdfGenerator.ts:1608/1667 prints the stale Required By on the transmittal the reviewer receives.

**Fix plan:** Add `submitted_by: s.submittedBy, required_date: s.requiredDate` to the payload at :4416; ideally factor buildSubmittal's row construction into a `submittalToRow(s)` used by both insert and update, matching the commitmentToRow/permitToRow pattern already in this file.

## [x] #17 — Invited collaborators pass the screen gate but every AI action inside is still metered against their own free tier

**Where:** `app/ai-punch.tsx:245`

**What breaks:** The screen gate at :122 is collaborator-aware (`useProjectAccess(gateProjectId).canAccess('punch_list_closeout')`, and punch_list_closeout is in COLLABORATOR_PROJECT_FEATURES at collaboratorAccess.ts:53), so a free-tier invitee gets in. Line 245 then calls `checkAILimit(subscriptionTier, 'smart', 'photoAnalysis')` with the plain useSubscription tier, and aiRateLimiterCore.ts:171-181 returns `reason: 'pro_only'`. Even without the client block, supabase/functions/analyze-photos/index.ts:271 `requireTier(req, ['pro','business'])` resolves from the CALLER's own subscriptions row and 403s. Same shape at app/rfi.tsx:417 and app/safety-incidents.tsx:222.

**User impact:** The seat the GC already paid for is dead on arrival for exactly the work it was sold for: the foreman opens AI Punch on the job he was invited to, shoots the punch photos, and is told to buy Pro. The GC does the field work himself or the crew stops using the app — the failure collaboratorAccess.ts was written to fix, which fixed the screen gate and left the AI gate behind.

**Fix plan:** Thread an effectiveTier (the project owner's tier) or a `collaboratorGranted` flag from useProjectAccess into checkAILimit so it skips the proOnly/smart-cap branches, and give requireTier an optional projectId that resolves tier from the project owner's subscription for accepted collaborators, metering usage against the owner's MONTHLY_CAPS.

## [x] #18 — Schedule CSV export writes calendar-day dates for working-day task numbers

**Where:** `utils/scheduleOps.ts:275`

**What breaks:** `fmtDate(dayNum)` does `d.setDate(d.getDate() + dayNum - 1)` on projectStartDate — raw calendar days — but startDay/finishDay are working-day numbers under the addWorkingDays convention used by every display path (scheduleEngine.ts:215). A task with startDay 11 / duration 10 on a Mon anchor at 5 working days/week exports Start 2026-03-12 and Finish 2026-03-21 where the grid shows Mar 16 → Mar 27. Called from schedule-pro.tsx:1289 and utils/scheduleReportExport.ts:35. `toISOString().slice(0,10)` adds a second shift at negative UTC offsets.

**User impact:** A GC exports the schedule to hand to a sub or drop in a spreadsheet and every date is wrong by an amount that grows down the file — and the CSV cannot self-diagnose, because the 'Start day' / 'Finish day' integer columns sitting next to the dates are correct. Subs mobilize on the wrong dates.

**Fix plan:** Give exportTasksToCsv `workingDaysPerWeek` (and optionally nonWorkingDates) parameters, build each date with `addWorkingDays(projectStartDate, dayNum - 1, workingDaysPerWeek, nonWorkingDates)`, and format from local Y/M/D components rather than toISOString().

## [x] #19 — Scheduler header START KPI shows the day before the schedule's actual start, contradicting the grid beneath it

**Where:** `components/schedule/SchedulerHeader.tsx:56`

**What breaks:** `new Date(schedule.startDate).toLocaleDateString(...)` on a bare 'YYYY-MM-DD' parses as UTC midnight and renders as the previous local day, while schedule-pro.tsx:519 derives day 1 from `new Date(startDate + 'T00:00:00')`. Rendered in the desktop KPI strip at :129 and the phone header. The adjacent finishDate at :58-60 compounds it, adding `totalDurationDays * 86400000` raw calendar ms to the same bad anchor.

**User impact:** The headline "when does this job start" number on the Pro scheduler is one day early for every user west of Greenwich and disagrees with the task rows directly beneath it, the Gantt, and the shared PDF on the same data. utils/calendarDate.ts was written to eliminate exactly this and this call site never adopted it.

**Fix plan:** Replace line 56 with `const startDate = formatCalendarDay(schedule.startDate) || '—';` using formatCalendarDay from @/utils/calendarDate, and rebuild finishDate at :58 with `addWorkingDays(parseCalendarDay(schedule.startDate), Math.max(0, totalDuration - 1), schedule.workingDaysPerWeek)`.

## [~] REFUTED #20 — Homeowner-RFP fan-out selects four service_* columns that do not exist on companies, so notify-nearby-contractors throws before notifying anyone

> **REFUTED 2026-08-31** by direct production introspection: companies.service_states / _radius_miles / _origin_lat / _origin_lng ALL EXIST in production.
> The verifiers that read `supabase/schema.sql` and the migrations concluded the
> columns were missing; the repo schema file is STALE. Only the agent that
> queried the live database got this right.

**Where:** `supabase/functions/notify-nearby-contractors/index.ts:142`

**What breaks:** `rest('/companies?select=id,user_id,company_name,service_states,service_radius_miles,service_origin_lat,service_origin_lng')`. public.companies (schema.sql:582-600) has none of those four columns and no migration adds them — a repo-wide grep returns hits only inside this one file (its own type at :73-75 and its filter logic at :174-183). PostgREST returns 42703, `rest()` at :104 throws on !r.ok, the outer catch at :268 returns an error response, and the dispatch loop at :226 is never reached.

**User impact:** A homeowner posts a job, is told contractors near them are being notified, and zero contractors are ever pinged — the two-sided marketplace never connects. The AFTER INSERT trigger discards the error response, so nothing surfaces on either side.

**Fix plan:** Either add the columns (`alter table public.companies add column if not exists service_states jsonb default '[]'::jsonb, add column if not exists service_radius_miles integer, add column if not exists service_origin_lat double precision, add column if not exists service_origin_lng double precision;`) plus UI that populates them, or narrow the select at :142 to `id,user_id,company_name,city,state` and match on companies.state until the service-area feature is real.

## [x] #21 — Project end date on the client-facing shared schedule PDF is one working day later than the last task's finish

**Where:** `components/schedule/ScheduleShareSheet.tsx:57`

**What breaks:** `addWorkingDays(projectStartDate, schedule.totalDurationDays, workingDaysPerWeek)` — but totalDurationDays is a finish DAY NUMBER (scheduleEngine.ts:328-333 computes `max(startDay + dur - 1)`), and this file's own task rows use the -1 convention via getTaskDateRange at :63. A single startDay:1/duration:5 task on a Mon anchor prints End = Fri Mar 6 in the table and "Mar 2 – Mar 9 · 5 working days" in the header. Same off-by-one at app/(tabs)/schedule/index.tsx:397 and :1238.

**User impact:** A PDF the owner and subs receive states a completion date one working day (up to three calendar days across a weekend) later than the schedule actually finishes, and it contradicts the last row of its own task table. The same wrong end date drives the in-app Summary header and the daysRemaining counter.

**Fix plan:** Change line 57 to `addWorkingDays(projectStartDate, Math.max(0, schedule.totalDurationDays - 1), schedule.workingDaysPerWeek)` and apply the same -1 at app/(tabs)/schedule/index.tsx:397 and :1238.

## [x] #22 — Copilot estimate edit re-marks-up at-cost labor and assembly lines, silently raising the contract value on any voice edit

**Where:** `utils/copilot/estimateEdit/estimateOps.ts:76`

**What breaks:** recomputeEstimate sets `lineTotal: round2(it.quantity * base)` (discarding each item's own markup), then `baseTotal = Σ lineTotal`, `markupTotal = baseTotal * globalMarkup/100`, `grandTotal = baseTotal + markupTotal`. The estimator's real math is per-item markup with labor and assemblies at markup 0 because the adjusted rate is all-in (full.tsx:933, :988-997). estimateEditCapability.ts:63-65 persists the result via commitEstimatePatch + updateProject, moving getContractValue.

**User impact:** Any conversational estimate edit — even changing one quantity — reprices the whole estimate and applies 15% markup to self-perform labor and assemblies the estimator deliberately priced at cost. On a $100K materials + $50K labor job that is a $7,500 jump attributed to the requested change; the diff screen shows the inflated total as if it were what the user asked for, and applying it changes the number the client is quoted.

**Fix plan:** Mirror the estimator in recomputeEstimate: `lineTotal = round2(it.quantity * base * (1 + (it.markup ?? 0) / 100))`, `baseTotal = Σ qty * base`, `grandTotal = Σ lineTotal`, `markupTotal = grandTotal - baseTotal`; and make the setGlobalMarkup op write `markup` onto material items the way MaterialCartContext.setGlobalMarkup does instead of applying it to the whole base.

## [x] #23 — Photo-queue opportunistic drain is swallowed by the in-flight guard and never re-armed, so photos taken during an upload sit on disk

**Where:** `utils/photoUploadQueue.ts:202`

**What breaks:** scheduleOpportunisticDrain fires `processPhotoUploadQueue()` after 1500 ms; if a previous flush is still running, line 213 `if (inFlight) return inFlight` returns a promise whose queue snapshot predates the new photo. The result — including `remaining: 1` — is discarded by the bare `.catch()` at :202, drainTimer is already null, and OfflineSyncManager's backoff is dead when the user is online and synced. Verified there are exactly two call sites: this one and app/_layout.tsx:310.

**User impact:** Exactly the failure the function's own doc comment says it exists to prevent. A super shooting photos one at a time in the gallery gets only the first of each burst into Storage; the rest are missing from the client portal, the homeowner digest and every other device until the app is next foregrounded — and lost outright if the app is deleted first.

**Fix plan:** Make the coalescing re-check for work: in scheduleOpportunisticDrain do `const r = await processPhotoUploadQueue(); if (r.remaining > 0) scheduleOpportunisticDrain();`, or set a module-level `dirty` flag in queuePhotoUpload and have processPhotoUploadQueue's .finally re-invoke itself once when dirty was set during the flush.

## [x] #24 — Offline-queue record key falls back to a per-mutation id when the payload has no `id`, so project_financials upserts race and a stale snapshot can win

**Where:** `utils/offlineQueue.ts:204`

**What breaks:** `${mutation.table}:${(mutation.data && mutation.data.id) ?? mutation.id}` — syncProjectToSupabase's project_financials payload (ProjectContext.tsx:1915-1922) is keyed on project_id with no `id`, so each queued write lands in its own singleton group and two writes for the same row are dispatched concurrently inside the same MAX_CONCURRENCY=5 batch. Whichever commits last against the project_financials.project_id primary key wins, non-deterministically. building_access_rules (ProjectContext.tsx:2915) has the identical shape.

**User impact:** An estimate or target budget edited twice during one offline session can silently revert to the earlier version after reconnecting, and the two halves of the dual-write disagree — projects row newer, project_financials row older — with projectsQuery's `pick` at ProjectContext.tsx:588 PREFERRING project_financials, then saveLocal writing the stale value over the device copy. The GC sees their bid price change by itself with no error.

**Fix plan:** Add an optional `recordKey` to supabaseWrite/OfflineMutation and pass it for keyless payloads, or at minimum widen the fallback at :204 to `data.id ?? data.project_id ?? data.portal_id ?? mutation.id` so any two writes targeting the same server row share a group and apply in timestamp order.

## [x] #25 — Emailing an invoice or estimate from web silently sends with no PDF attached

**Where:** `app/invoice.tsx:720`

**What breaks:** `attachments: pdfUri ? [pdfUri] : undefined` where pdfUri comes from generateInvoicePDFUri, which is a hard `if (Platform.OS === 'web') return null` at utils/pdfGenerator.ts:1407. Resend succeeds, result.success is true, and line 726 shows "Email Sent". Identical at app/(tabs)/estimate/full.tsx:1096/1103 with generateEstimatePDFUri.

**User impact:** Web users' clients receive invoices and estimates with no attached document while the sender is told the send succeeded, and the "INCLUDE IN PDF" section toggles the user just configured in PDFPreSendSheet are silently discarded. utils/emailService.ts:53-60 already implements web attachment encoding (fetch + FileReader → base64), so the plumbing exists and is never fed.

**Fix plan:** Give generateInvoicePDFUri / generateEstimatePDFUri a web arm that produces the PDF as a blob:/data: URI (or send the HTML for server-side rendering in the send-email function) so attachments is populated; failing that, block the web email path with an explicit message rather than sending under an "Email Sent" toast.

## [x] #26 — Stripe Connect onboarding on web pops "Setup Not Finished" the instant the Stripe tab opens

**Where:** `app/payments-setup.tsx:164`

**What breaks:** `await WebBrowser.openBrowserAsync(...)` then immediately `await refresh()` and re-poll. Verified in node_modules/expo-web-browser/build/ExpoWebBrowser.web.js:36-44: the web implementation is `window.open(url, windowName, features); return { type: OPENED }` — it resolves instantly instead of on dismissal. connect-onboarding has already written stripe_account_id with charges_enabled=false, so connect-status/index.ts:47-51 returns 'incomplete' and the alert fires within the same second.

**User impact:** On web, the flow that lets a contractor get paid tells them it failed the moment it starts, over an app they have not left. Users who read the alert believe onboarding broke and abandon it; and since the poll already ran, a user who does finish in the other tab still sees a stale "not connected" state until they manually refresh.

**Fix plan:** Branch on Platform.OS: on web, fire-and-forget the open and rely on the returnUrl `?return=1` round-trip already configured at :141 to re-poll on mount (plus a visibilitychange/window-focus re-poll), keeping the await-then-poll only for native.

## [x] #27 — Universal Search lock chips read the wrong tier for three features, so Pro users are sent into Business walls and away from screens they own

**Where:** `utils/featureRegistry.ts:137`

**What breaks:** searchFeatures computes locked from `REQUIRED_TIER[entry.requires]`, but three entries name a key the destination does not gate on: margin-board `requires: 'job_costing'` (pro) vs app/portfolio-margin.tsx:59 `canAccess('portfolio_margin')` (business); coi-vault `requires: 'prequal_coi'` (pro, line 165) vs app/coi-vault.tsx:50 `canAccess('rfis_submittals')` (business); plan-intelligence `requires: 'ask_your_plans'` (business, line 172) vs app/plan-intelligence.tsx:61 `canAccess('ai_estimate_wizard')` (pro). DesktopSidebar.tsx:65 has the correct portfolio_margin key, so the registry has drifted from the sidebar it claims to mirror.

**User impact:** The lock chip is the app's promise about what a plan includes. A Pro subscriber searches "margin" or "coi", sees no lock, taps through, and hits a wall — the exact dead-end the chip exists to prevent, made worse because Margin Board then shows the wrong Pro paywall (rank 5). Conversely they see a Business lock on Plan Intelligence and never open a feature they already pay for.

**Fix plan:** Set featureRegistry.ts:137 to `requires: 'portfolio_margin'` and :165 to `requires: 'rfis_submittals'`, reconcile plan-intelligence (:172 and DesktopSidebar.tsx:104 → 'ai_estimate_wizard', or move the screen's gate to ask_your_plans), and extend scripts/validate-feature-search.ts to parse each route's screen for its first top-level canAccess('<key>') and fail on any mismatch with entry.requires.

## [x] #28 — Estimate revision diff appends a markup row on top of already-markup-inclusive category deltas, so the rows sum to twice the Net Change

**Where:** `utils/estimateCommit.ts:148`

**What breaks:** diffEstimates buckets categories by `it.lineTotal` (:134), which already includes markup, and netDelta is the grandTotal difference — so the categories already reconcile to netDelta before line 148 pushes a `__markup__` row for `markupTotal` movement. The comment at :146 ("categories use pre-markup lineTotal") states the opposite of what full.tsx:933 and applyCalibration.ts:74 define. Raising markup 15%→25% on a $100K line yields Materials +$10,000, Markup +$10,000, Net Change +$10,000.

**User impact:** The Changes tab of the estimate revision history (rendered at app/project-detail.tsx:4152-4168) shows a breakdown that does not foot to its own Net Change total whenever markup moved between revisions. A GC reading it to explain a price change to a client sees double the actual movement.

**Fix plan:** Delete the `__markup__` push at :146-149 since category deltas already carry markup — or, if a markup line is wanted, build the category map at :134 from `(it.usesBulk ? it.bulkPrice : it.unitPrice) * it.quantity` so the two pieces genuinely reconcile.

## [x] #29 — "Advance requested" confirmation is shown even when the feature_interest write is skipped or rejected

**Where:** `components/home/ReadyToBillCard.tsx:70`

**What breaks:** The upsert's result is discarded — no `{ error }` destructure — and supabase-js resolves rather than rejects on a PostgREST error, so failures flow straight to `setAdvanceState('done')` and the success alert. Two concrete paths: feature_interest has SELECT/INSERT/DELETE RLS policies but no UPDATE policy, so the ON CONFLICT DO UPDATE arm is rejected once a row exists; and an expired session makes getUser() return user: null, skipping the write entirely inside `if (user)` while the alert still fires. Both sibling writers check it (RevenueEarlyAccessCard.tsx:117-124, TabComingSoon.tsx:31-35).

**User impact:** The GC is told MAGE has recorded their request to advance a specific dollar amount against drafted change orders and that a lending partner will reach out. No row exists, so no one ever does — and the button latches to 'done' so they cannot retry.

**Fix plan:** Destructure `const { error } = await supabase.from('feature_interest').upsert(...)` and treat both `!user` and a non-null error as failure (`setAdvanceState('idle')` + the "Could not save" alert), matching RevenueEarlyAccessCard.tsx:117-131; and add the missing UPDATE RLS policy to feature_interest.

## [x] #30 — Paywall comparison table marks Plan Viewer as Business-only when the code unlocks it at Pro

**Where:** `app/paywall.tsx:63`

**What breaks:** `{ label: 'Plan Viewer · Sheet Pinning (Android: beta)', free: false, pro: false, business: true }` renders an XCircle in the Pro column, but the enforced gate is plan_markup = 'pro' (featureTiers.ts:78), checked identically at app/plans.tsx:218 and app/plan-viewer.tsx:79 (whose comment even says "plans.tsx uses 'plan_markup' = Pro").

**User impact:** A Pro subscriber who wants the plan viewer reads the pricing table and concludes they must upgrade to Business — a $50/mo increase for something already included in what they pay. The file's own header asserts rows appear "ONLY if there is a real, enforced gate," so the table is actively mispricing the product.

**Fix plan:** Change line 63 to `pro: true` — better, give each FEATURES row a FeatureKey and compute the free/pro/business columns via `tierMeetsRequirement(tier, REQUIRED_TIER[key])` so a row can never claim a tier the gate does not enforce.

## [x] #31 — Schedule Pro share link claims "copied to clipboard" without awaiting or checking the clipboard write

**Where:** `app/schedule-pro.tsx:1473`

**What breaks:** `navigator.clipboard?.writeText(url)` is not awaited, so its rejection escapes the synchronous try/catch; and in a non-secure context navigator.clipboard is undefined entirely, so the optional chain short-circuits without throwing. Either way the alert on the next line unconditionally asserts success and the `window.prompt('Copy this share link:', url)` recovery at :1476 is unreachable in exactly the situations it was written for. utils/clipboard.ts:6-19 documents this precise anti-pattern as the reason that helper exists, and every other share path (estimate/review.tsx:230, project-detail.tsx:1071, MobileScheduleScreen.tsx:548, client-portal-setup.tsx:645) was migrated — this call site was missed. (Reported twice; same defect.)

**User impact:** The read-only schedule link the GC is sending to subs and the owner never reaches their clipboard while the app says it did — on plain http:// over a jobsite LAN or in an embedded iframe. The link carries a long base64 share token, so there is no way to reproduce it by hand, and they paste stale clipboard content into the message instead.

**Fix plan:** Replace lines 1471-1477 with `const ok = await copyToClipboard(url);` from utils/clipboard.ts and branch: `window.alert` on true, `window.prompt('Copy this share link:', url)` on false.

## [x] #32 — Lead "Map" quick action uses the iOS-only maps: scheme and opens a dead tab on web

**Where:** `app/lead-detail.tsx:286`

**What breaks:** `Linking.openURL('maps:?q=...')` where Linking is react-native's, which on web resolves to react-native-web's shim: `new URL(url, window.location)` then `window.open(urlToOpen, '_blank', 'noopener')` — only tel: gets special handling. No desktop browser registers the maps: scheme. This is the only map link in the codebase, so no shared helper masks it.

**User impact:** One of the three quick actions on the lead screen is dead on web and fails by leaving an empty tab behind, whereas the same tap opens Apple Maps on iOS.

**Fix plan:** Change line 286 to `Linking.openURL(\`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(existing.address!)}\`)` — the https form opens the native Maps app on iOS/Android and a real map page on desktop.

