# Copy style: what is still to convert

Written 2026-10-05 by lane COPYSTYLE (the trial lane). The style is in `docs/VOICE.md` sections 3 and 4. The guard is `scripts/validate-copy-voice.ts`.

## Where things stand

- **Converted: 287 files**, listed in `scripts/copy-style-converted.json`. The app shell and first run (40 files, the trial lane): the tab bar, the desktop sidebar, Home and its cards, Needs Attention, Settings, sign-in, sign-up, reset password, onboarding, persona select and the three paywalls, plus the files they print labels from (`utils/planFeatureCopy.ts`, `utils/settingsSections.ts`, `utils/onboardingProfile.ts`, the desktop action rail and the sidebar pieces). **Lane 1 (144 files, done 2026-10-05):** estimate, takeoff, quotes, cost history, proposals, the contract, selections, bids, buyout, leads, prequal, materials, the marketplace and RFP screens. **Lane 3 (103 files, done 2026-10-05):** daily report, punch, the invoice screen, time tracking, crew, T&M tickets, deliveries, building access, safety, equipment, scan, photos, voice and lineup; see its section below.
- **Still to convert: 576 files with 5,725 strings the guard would fail today** (counted 2026-10-05 with lanes 1 and 3 both in). Counts by rule: label not in Title Case 3,769, dash used as punctuation 1,537, "&" 263, "e.g." or "i.e." 82, arrows 74. To count again: `bun scripts/validate-copy-voice.ts --strict-preview "app/,components/,utils/,constants/,hooks/,contexts/"`.
- The count is a floor. The guard only calls a string a label when its position says so (a `title` / `label` prop, an alert title, an alert button, a short VoiceOver label, a constant named `…_LABEL` / `…_TITLE`, a style key such as `rowLabel` or `sectionHeader`, text inside a button). A label held in a plain constant, or drawn with a style key the guard does not know, is found by reading the screen, not by the guard. In the trial lane the guard found about two thirds of the roughly 580 strings that changed; the rest came from reading the dump.

## How to run a lane

1. `bun scripts/validate-copy-voice.ts --strict-preview "<path>,<path>"` lists what your files would fail. `--dump "<path>"` prints every string the guard reads in them, with its position.
2. Add your files to `scripts/copy-style-converted.json` (sorted) and raise `CONVERTED_PINNED` in the guard to the new length. The list may only grow.
3. `bun scripts/validate-copy-voice.ts --fix-labels` rewrites the R15 hits with `titleCase()`. Read the diff. A script cannot tell a label from a short sentence, and it capitalizes "in" and "on" only after a verb it knows (`PARTICLE_VERBS` in `scripts/copy-title-case.ts`).
4. Rewrite every dash, "&", "e.g." and arrow by hand. Then read the `--dump` output top to bottom for the labels the guard could not see.
5. Pins. Run every `test:*` link of `ship-check` that is not tsc, lint or jest and fix each red validator: change the quoted string, never the rule. Then the jest files that look a string up (`getByText`, `getByLabelText`), then re-record the goldens with `jest -u` on the affected files only and read the diff: it must be text only.
6. Spanish. `bun run i18n:extract` regenerates the English shards. `bun run test:i18n` lists each stale Spanish entry with its new hash. Spanish stays in sentence case; translate again only where the English meaning changed.

## Things the trial lane found that the next lanes will hit

- **A string that is also a key.** `feature="Unlimited Projects"` on Home is the Paywall lookup key and an analytics property, so it stays and has an allow-list entry; what prints comes from `FEATURE_TITLE` in `components/Paywall.tsx`. The sidebar section key `SETUP & TOOLS` stays (it is saved in `mageid_sidebar_sections`); the header prints `SECTION_LABEL`. The other sidebar section keys (`THIS JOB`, `FIELD OPS`, `MORE FOR THIS JOB`) are typed ALL CAPS and are still printed as typed.
- **Code that matches casing.** `storeSafeLabel` strips "(Android: beta)" from a plan row on the phone (App Review 2.3.10). Its pattern was case-sensitive and is now case-insensitive, because the row says "(Android: Beta)". Look for the same thing wherever a label is matched by a regular expression.
- **One sentence, six files.** "Couldn't reach MAGE. Showing what's on this phone." is typed in `app/brief.tsx`, `app/week-close.tsx`, `app/(tabs)/summary/index.tsx`, `components/DesktopActionRail.tsx`, Needs Attention and `BrainWatchCard`. All six were changed together; four of those files are otherwise unconverted.
- **Names that come from another lane's file.** Home prints stage names from `stageLabel()`, the project card, the create menu and the pending-invites card; Settings prints the team section and the language picker. Those files are in the lanes below, so Home and Settings are not fully converted on screen until lanes 4 and 5 land.
- **Left for a founder decision, not restyled:** the two Discover promo cards (`app/(tabs)/discover/index.tsx` near lines 539 and 548); the name "MAGE Copilot" (the study says the assistant is "MAGE"); price notation such as "$29/mo" and "/month"; the onboarding line "Each finished project makes the next estimate more accurate."
- **Not in any lane below:** push and email text in `supabase/functions/` (24 files quote strings that are also in the app), the static portal pages, PDFs rendered server-side and the marketing site. They need their own pass, and a deploy.

## Things lane 1 found

- **`--fix-labels` capitalizes a fragment that is printed mid-sentence.** A constant named `…_LABEL`, or a `label:` key, is a label to the guard even when the screen prints it after other words ("priced off {RATE_BASIS_LABEL[…]}", "Why: your scope notes triggers …", the lead-time chip "25d lead · Your record · medium confidence"). Grep the `--fix-labels` log for a string that started with a lower-case letter and read where it prints. Lane 1 put 15 of these back and gave each an allow-list entry.
- **A label that is also a key.** `CATEGORY_META` labels and the `scopePricing` map ("Lumber & Framing", "Concrete & Masonry" …) are what the cost history is keyed on (`lookupRate`), "Permits & fees" is a line category, "01 - General" is a CSI division saved on estimate lines. They keep their "&" and have allow-list entries. Catalog product names in `constants/materials.ts` are left as typed for the same reason.
- **Text sent to the model is not copy.** Prompt lines and grounding facts (`utils/scopeQuestions.ts`, `utils/judges/narrateVerdict.ts`, `utils/copilot/estimate/estimateGrounding.ts`, `utils/instantBid.ts`, `utils/bidHistoryFacts.ts`) keep their dashes and have allow-list entries: rewording them changes what the AI does.
- **A fragment before a value.** `<Text>Add to {name}</Text>` is read as the two-word label "Add to", and Title Case wants its last word capital ("Add To"). Leave the JSX as it is (one template would change the rendered tree and move every golden's line count) and give the fragment an allow-list entry. Lane 1 has seven.
- **"yet" is a small word.** "No Rate yet" is what `titleCase()` writes. Put it last ("Not Measured Yet") or make it a sentence ("No rate yet. Set one.").
- **`>` in JSX text does not compile.** A step path inside JSX text is `Settings &gt; Companies`.
- **`&rsquo;`, `&ldquo;` and `&rdquo;` trip R21.** Type the character itself (’ “ ”); it renders the same.
- **"Near me" stays.** The iOS location purpose string in `app.json` quotes that pill word for word and `validate-location-consent` holds the two together, so the pill changes only with a native build. Same idea for the units `$/hr` and `$/yr`.
- **Pins that were rules.** `validate-money-copy` (status label maps) and `validate-ny-home-improvement` asserted sentence case. Both now ask for Title Case on a converted file's labels and still refuse a Title Case sentence. Later lanes will meet more of these.
- **A pin in another lane's file.** `utils/learn/quizBank.ts` holds `mustContain` literals quoted from lane 1 screens; the four that changed were updated (the pins only, not the questions, so the server key did not move). The quiz sentences still say "Sign & send" and "Convert to estimate": that is lane 4's copy.
- **Blunt replacement in validators breaks other lanes' pins.** "Try again", "Not now", "Could not open" are in files that are not converted yet. Change a pin only on the check that reads your file.
- **Labels the same screen takes from another lane.** `toolName` now says "Bill from Estimate" and "Compare Drawings" while `app/_layout.tsx` screen titles, `utils/routeTitle.ts` and `utils/billingFlowCore.ts` sentences (lanes 2 and 5) still say "Bill from estimate".

## The lanes

File lists do not overlap. A file went to the first group whose words match its path, tried in this order: schedule, field, money, estimate, office, then everything else. So `app/schedule-import.tsx` is in lane 2 and `components/schedule/…` with it, even where a file also has a money word in its name. Check the list, not the description.

| Lane | What it covers | Files | Strings |
|---|---|---|---|
| 1. Estimate, bids and contract (**done**) | Everything with estimate, takeoff, quote, cost, proposal, contract, selections, bid, buyout, lead, prequal, materials, marketplace, RFP, supplier, scope, drawing or company in its path. | 144 | 1,849 |
| 2. Money and schedule | Invoices, pay apps, payments, change orders, cash flow, WIP, budget, job costing, retainage, lien waivers, reports, margin, QuickBooks, tax; and schedule, Last Planner, lookahead, pace, delay, weather. | 195 | 2,164 |
| 3. Field and safety (**done**) | Daily report, punch, photos, time tracking, crew, T&M tickets, deliveries, safety, equipment, scan, voice, lineup. This is the lane that goes through t(): most of its English has a Spanish entry to re-read and re-stamp. | 0 of 103 left | 0 of 1,621 left |
| 4. Office, AI and portal (**done**) | Client portal, RFIs, submittals, plans, permits, Code Check, Construction AI, Ask MAGE, copilot, inspection, warranty, closeout, handover, subs, tutorials, messages, notifications, team. | 0 of 178 left | 0 of 1,678 left |
| 5. Shell remainder and everything else | The project page, Discover and the Tools list, the feature registry, the create menu, Summary, the root layout (every screen title), shared components (ui, desktop, registers), PDFs and emails built in utils/, demo and sample data. | 203 | 1,886 |
| **Total** | | **823** | **9,198** |
| **Still to convert (lanes 2, 4 and 5)** | Less the handful of strings lanes 1 and 3 changed in other lanes' files. | **576** | **5,725** |

### Lane 1. Estimate, bids and contract (144 files, 1,849 strings): DONE 2026-10-05

All 144 files are in `scripts/copy-style-converted.json` and the guard reads zero for them. The file list is in git history (this section before the lane landed).

### Lane 2. Money and schedule (195 files, 2,164 strings)

Strings the guard would fail, per file, largest first.

```
 125  app/change-order.tsx
 110  app/client-portal-setup.tsx
  94  app/aia-pay-app.tsx
  88  app/(tabs)/schedule/index.tsx
  60  components/schedule/mobile/MobileScheduleScreen.tsx
  54  app/wip-report.tsx
  53  app/delay-events.tsx
  52  app/lien-waivers.tsx
  51  app/cash-flow.tsx
  50  utils/scheduleHealthScore.ts
  46  app/client-view.tsx
  46  utils/demoSchedule.ts
  43  app/job-costing.tsx
  39  utils/aiaForms.ts
  38  app/last-planner.tsx
  38  app/reports.tsx
  38  app/schedule-pro.tsx
  35  constants/scheduleTemplates.ts
  33  components/takeoff/TakeoffWorkspace.tsx
  30  app/schedule-wizard.tsx
  29  utils/wip.ts
  26  app/budget-dashboard.tsx
  25  utils/billingFlowCore.ts
  22  app/qbo-setup.tsx
  22  components/schedule/GridPane.tsx
  22  utils/brain/accuracyReport.ts
  21  app/schedule-import.tsx
  20  app/payments.tsx
  18  app/bid-leveling.tsx
  18  app/payments-setup.tsx
  16  app/client-update.tsx
  15  components/schedule/AIAssistantPanel.tsx
  15  components/schedule/ScheduleOnRamp.tsx
  15  utils/financialReportPdf.ts
  14  app/payment-predictions.tsx
  14  app/schedule-review.tsx
  14  utils/copilot/scheduleBuilder/questions.ts
  13  components/schedule/desktop/ScheduleProToolbar.tsx
  13  components/schedule/mobile/ExportCenterSheet.tsx
  13  utils/aiaBilling.ts
  13  utils/copilot/schedule/scheduleGaps.ts
  12  app/margin-risk.tsx
  12  components/automation/AutoScheduleReviewSheet.tsx
  12  components/schedule/TaskInspector.tsx
  12  utils/paymentTerms.ts
  11  app/tax-1099-export.tsx
  11  components/AIChangeOrderImpact.tsx
  11  components/CashFlowSetup.tsx
  11  utils/tax1099Export.ts
  10  app/qbo-review.tsx
  10  app/report-inbox.tsx
  10  components/backcharge/BackchargeSheet.tsx
  10  components/schedule/AddTaskModal.tsx
  10  components/schedule/ScenariosModal.tsx
  10  utils/clientDocumentAsk.ts
  10  utils/scheduleOps.ts
   9  components/schedule/BaselineManagerModal.tsx
   9  components/schedule/InteractiveGantt.tsx
   9  utils/copilot/scheduleBuilder/buildAnswersPrompt.ts
   9  utils/marginRiskScore.ts
   8  app/portfolio-margin.tsx
   8  components/AIProjectReport.tsx
   8  components/AIScheduleRisk.tsx
   8  components/ClientHome.tsx
   8  components/RecordPaymentModal.tsx
   8  components/backcharge/BackchargeDeductionCard.tsx
   8  components/project/ProjectWorkspaceHeader.tsx
   8  components/schedule/COScheduleReflowPreviewModal.tsx
   8  components/schedule/ScheduleBuilderInterview.tsx
   8  utils/wipExport.ts
   7  app/margin-alerts.tsx
   7  app/profit-leak-history.tsx
   7  components/backcharge/BackchargeSection.tsx
   7  components/copilot/ScheduleDiffView.tsx
   7  components/schedule/ScheduleSettingsMenu.tsx
   7  components/schedule/WeatherRescheduleModal.tsx
   7  components/schedule/mobile/PlanZoneEditor.tsx
   7  utils/deliverySchedule.ts
   7  utils/fieldScheduleUpdate.ts
   7  utils/lastPlanner.ts
   7  utils/ownerDelayCost.ts
   6  app/shared-schedule.tsx
   6  components/AIAutoScheduleButton.tsx
   6  components/schedule/EarnedValuePanel.tsx
   6  components/schedule/SchedulerMenuBar.tsx
   6  components/schedule/SchedulerTabShell.tsx
   6  components/schedule/mobile/LivingFloorPlan.tsx
   6  utils/projectFinancials.ts
   6  utils/scheduleReportModel.ts
   5  app/client-messages.tsx
   5  components/schedule/ExportSheet.tsx
   5  components/schedule/ScheduleShareSheet.tsx
   5  components/schedule/SubUpdatesPanel.tsx
   5  components/schedule/tabs/DashboardTab.tsx
   5  utils/coScheduleReflowCore.ts
   5  utils/lienWaiverEngine.ts
   5  utils/lienWaiverForms.ts
   5  utils/retainageSource.ts
   5  utils/scheduleAudit.ts
   4  app/client-outbox.tsx
   4  components/ClientDocumentAskSheet.tsx
   4  components/estimate/EstimateClientView.tsx
   4  components/logs/ChangeOrderLog.tsx
   4  components/schedule/CriticalPathPanel.tsx
   4  components/schedule/QuickBuildModal.tsx
   4  components/schedule/TodayView.tsx
   4  components/schedule/mobile/ProgressTab.tsx
   4  utils/backcharges.ts
   4  utils/bidLevelingEngine.ts
   4  utils/cpm.ts
   4  utils/exportSchedulePdf.ts
   4  utils/marginAlerts.ts
   4  utils/tutorial/defs/changeOrderDraft.ts
   4  utils/tutorial/defs/constructionAiAsk.ts
   4  utils/tutorial/defs/payAppPeriod.ts
   3  app/(tabs)/discover/schedule.tsx
   3  app/integrations/qbo/callback.tsx
   3  app/week-close.tsx
   3  components/SendToClientButton.tsx
   3  components/schedule/LevelingPreviewModal.tsx
   3  components/schedule/PredecessorPicker.tsx
   3  components/schedule/mobile/MonthCalendarSheet.tsx
   3  components/schedule/tabs/GanttTab.tsx
   3  components/schedule/tabs/WorkloadTab.tsx
   3  hooks/useClientDocumentGate.ts
   3  utils/automation/learnedLeadTime.ts
   3  utils/buildingRecordClient.ts
   3  utils/copilot/billing/billingGaps.ts
   3  utils/copilot/scheduleEdit/scheduleEditCapability.ts
   3  utils/jobCostEngine.ts
   3  utils/lienRightsClock.ts
   3  utils/paymentPrediction.ts
   3  utils/profitLeak/scopeSummary.ts
   3  utils/projectWorkspaceLayout.ts
   3  utils/scheduleEarnedValue.ts
   3  utils/tutorial/defs/scheduleSayIt.ts
   2  components/CostBreakdownReport.tsx
   2  components/changeOrders/COProofPacketButton.tsx
   2  components/copilot/ScheduleEditPanel.tsx
   2  components/schedule/LatenessPadChip.tsx
   2  components/schedule/ScheduleAuditModal.tsx
   2  components/schedule/WeatherReschedulePrompt.tsx
   2  components/schedule/mobile/MobileGantt.tsx
   2  components/schedule/mobile/WeekStrip.tsx
   2  components/schedule/tabs/TabComingSoon.tsx
   2  hooks/useServerChangeOrderNumber.ts
   2  utils/clientViewMoney.ts
   2  utils/copilot/billing/billingCapability.ts
   2  utils/copilot/changeOrder/coCapability.ts
   2  utils/copilot/changeOrder/coGaps.ts
   2  utils/copilot/schedule/scheduleCapability.ts
   2  utils/copilot/scheduleEdit/interpretOps.ts
   2  utils/financingCore.ts
   2  utils/judges/targetMargin.ts
   2  utils/lienWaiverDocument.ts
   2  utils/pace/stampActuals.ts
   2  utils/scheduleExportIcal.ts
   2  utils/scheduleReportHtml.ts
   2  utils/weatherService.ts
   2  utils/weeklyClientUpdate.ts
   1  components/schedule/PaceChip.tsx
   1  components/schedule/ResourceSwimlanes.tsx
   1  components/schedule/ScheduleHealthScore.tsx
   1  components/schedule/ScheduleRowMenu.tsx
   1  components/schedule/SchedulerHeader.tsx
   1  components/schedule/StartDayBasisNotice.tsx
   1  components/schedule/desktop/ScheduleAiPane.tsx
   1  components/schedule/desktop/ScheduleSignals.tsx
   1  components/schedule/mobile/MobileScheduleList.tsx
   1  components/schedule/mobile/MobileTomorrowCard.tsx
   1  components/schedule/mobile/TaskChecklist.tsx
   1  components/schedule/mobile/TaskDetailSheet.tsx
   1  utils/autoScheduleFromEstimate.ts
   1  utils/automation/eventToScheduleWork.ts
   1  utils/bidLeveling.ts
   1  utils/cashFlowEngine.ts
   1  utils/copilot/billing/billingGrounding.ts
   1  utils/copilot/changeOrder/coGrounding.ts
   1  utils/copilot/scheduleBuilder/paceGrounding.ts
   1  utils/financialReports.ts
   1  utils/financing.ts
   1  utils/levelingBasis.ts
   1  utils/logs/changeOrderLogRows.ts
   1  utils/permitRoadmapSchedule.ts
   1  utils/portfolio/typeProfitability.ts
   1  utils/printableGanttHtml.ts
   1  utils/profitLeak/leakPrompt.ts
   1  utils/profitLeak/rfiScopePrompt.ts
   1  utils/profitLeak/subBidCheck.ts
   1  utils/retainage.ts
   1  utils/scheduleAI.ts
   1  utils/scheduleColors.ts
   1  utils/scheduleProLayout.ts
   1  utils/scheduleVerdict.ts
   1  utils/weatherProvenance.ts
```

### Lane 3. Field and safety (done, 2026-10-05)

Converted: all 103 files are on `scripts/copy-style-converted.json`. About 1,660 source lines changed, 942 English catalog entries regenerated, 926 Spanish entries re-read and re-stamped (67 of them re-worded).

What this lane left as typed, each with an allow-list entry and its reason in `scripts/copy-voice-allowlist.json`:

- **Labels that are also keys.** `feature="Punch List & Closeout"` (three screens; the wall prints `FEATURE_TITLE`), the `case 'Doors & Hardware'` trade value in `app/punch-walk.tsx`, the five `NO_WORK_REASONS` `label` ids in `app/daily-report.tsx` (React key and testID; the chip prints `shown`), and `PUNCH_REJECT_DEFAULT_NOTE` ("Rejected — needs rework": the sub portal and a migration match it).
- **The voice sheet title is a storage key.** `VoiceCaptureModal` hashes its `title`, case and all, into the offline dictation queue key (`voiceContextKey`). So "Dictate this invoice", "Dictate today's report", "Describe the punch item", "Capture a punch item", the default "Voice dictation" / "Voice fill" and the copilot `voiceTitle` lines stay in sentence case until those callers pass a stable `queueKey`. The trial lane's "Dictate This Project" on Home did change, so one waiting dictation there may not be offered back.
- **"Photo code check"** in `app/punch-list.tsx`: one name pinned across eight files (two on the server) by `validate-code-look`. It converts with the lane that owns `CodeLookSheet`.
- **AI prompt lines** in `utils/voiceActionParser.ts`, `utils/voiceCommandParser.ts`, `utils/voiceDFRParser.ts` and the copilot capability files: not UI, not changed.
- **Keyboard legend** "← back" in `components/punch/PlanPinStep.tsx`, and the `&middot;` entity in the two punch PDFs.

Three strings outside this lane's list changed because a validator holds them equal to a lane 3 string: the "Due on Receipt" label in `components/CashFlowSetup.tsx`, `PROJECT_FILES_NEEDS_APP` in `utils/projectDocuments.ts`, and the "Clock Out" sheet title in `utils/moments/sites/fieldCopy.ts`. Six `mustContain` pins in `utils/learn/quizBank.ts` were updated to the new casing (the questions and answers are unchanged).

Things the next lanes will hit, found here:

- **`--fix-labels` rewrites keys.** It capitalized the `NO_WORK_REASONS` ids. Before accepting its diff, look at every rewritten string that is not inside `t()`: an object `label` next to a `shown`, a `case '…'`, a `feature=` prop.
- **"so" and "yet" are small words to `titleCase()`**, so it writes "OT so Far" and "Signed, Not yet Billed". Reword so the word is last ("Not Billed Yet") or leave the label.
- **A comma in a CSV cell** quotes the cell. "Not synced, this device only" broke a column read; it is "Not synced (this device only)".
- **Do not replace old strings across validators by script.** A pin often quotes a file from another lane that still has the old casing. Fix each red check by reading it.
- **The `title` props of `VoiceCaptureModal`, `InlineVoiceFill` and `VoiceRecorder`** feed the queue key above: lanes 1, 4 and 5 each have some.

### Lane 4. Office, AI and portal (done, 2026-10-06)

Converted: all 178 files are on `scripts/copy-style-converted.json` and the guard reads zero for them. 159 of them changed (1,662 source lines), about 180 of those lines being labels the guard could not see, found by reading the dump. 78 English catalog entries were regenerated; none of them has a Spanish entry yet, so no Spanish catalog entry was re-stamped. The portal language pack (`utils/portalLanguages.ts`) lost its dashes in Spanish, Portuguese, Vietnamese and French (13 strings, punctuation only). The file list is in git history (this section before the lane landed).

What this lane left as typed, each with an allow-list entry and its reason in `scripts/copy-voice-allowlist.json` (152 entries):

- **Text the server compares or stores.** `PLAN_INDEX_REFUSAL` (two edge functions refuse with the same sentence), the signing-off sentence in `utils/portalOwnerCore.ts` (the static portal page carries it byte for byte), the four `NEWS_TOPICS` with "&" (equal to the server's list), the canonical proposal text a client accepts (`utils/portalSnapshot.ts`, five lines), the `'Sample — '` project-name prefix, and the stored sheet-name prefix `— page N` in `utils/planSheetBatchCore.ts`.
- **The code-answer acknowledgement.** `CODE_ACK_COPY.title` ("Before you rely on a code answer") stays word for word, with its body and button.
- **"Photo code check".** The name is held equal in eight files by `validate-code-look`; two are the server's and one is `app/project-detail.tsx` (lane 5). It stays in sentence case on the sheet heading and the Inspection Ready button until all eight move together.
- **Prompt and grounding text.** The adoption-record `notes` in `utils/codeJurisdiction.ts` (sent to the model as "Jurisdiction note: …"), every fact line in `utils/permitInspectionFacts.ts`, the Ask Your Home prompt and its record references ("Warranty — Trane HVAC"), the copilot intent hints, the RFI latency fact lines, the plan-answer and Inspection Ready prompt lines, two lines of the sub evaluator prompt.
- **Skills-check questions.** Three questions and choices still say "Sign & send" and "Revise & re-issue": changing a question needs a `quizVersion` bump and a regenerated server key. Their `mustContain` pins were updated to the new casing (the key did not move).
- **Voice sheet titles** (the storage key found by lane 3): "Dictate this RFI", "Dictate this submittal", "Record the answer", "Describe the work", "Capture meeting discussion", "Ask by voice".
- **Paywall feature keys**: `feature="Permits & Inspections"`, `feature="RFIs & Submittals"`, `'Punch List & Closeout'` in the tutorial host (the wall prints `FEATURE_TITLE`).
- **Another organization's own name**: Seattle Department of Construction & Inspections, Baltimore City Department of Housing & Community Development, the Miami-Dade department name with its dash, Town of Huntington Building & Housing Division.
- **Developer notes on tutorial anchors** (`note` / `what` in `utils/tutorial/registry.ts` and `learn/lane*.ts`), a regular expression, two `readBy` provenance lines, verdict reasons printed only by `scripts/verify-code-sources.ts`.
- **Fragments**: "Share with {name}", "Invoices from {name}", "Title block reads {n}. Use it?", "2 with an open claim", the scale value "not read (sample counts)", the coverage sentence "No pages were read".
- **`SAMPLE_PORTAL_REASON`** keeps its dash: `validate-portalfix` holds it equal to `SAMPLE_PORTAL_NOTE` in `app/client-portal-setup.tsx` (lane 5). Change both there.

Not restyled, and not on the allow-list because the guard does not read them as labels: the English labels of the portal language pack ("Change orders", "Pay now", "Sign and make binding"). The static portal pages carry the same words, so they convert with the portal pass and its deploy. The closeout binder PDF's section titles (`utils/closeoutBinderEngine.ts`) are in the same position.

Things the next lanes will hit, found here:

- **A helper that rewrites pins by trial is dangerous.** A script that tried each old string against a red validator and kept the change when the red count fell also kept changes that made the validator crash (a crash prints no red line). It renamed `const save` to `const Save` in eight validators before the diff was read. Read every line of a validator diff.
- **A pinned digest.** `validate-building-scope-triggers` pins the sha256 of a fixture's JSON. Six NYC link labels and one note changed inside it; the two outputs were diffed field by field against `origin/main` before the digest was re-pinned.
- **A regular expression pin needs its dots escaped again.** "model recall — verify" became "model recall. Verify", and a bare "." in the pin matches anything.
- **`validate-money-copy` banned "Expiring Soon"** as a sentence-case rule. On a converted file the ban is now on "Expiring soon".
- **A label in a `label:` key that is really a sentence** ("No pages were read", "No current sheets to index") is still rewritten by `--fix-labels`. Check each against its validator.

### Lane 5. Shell remainder and everything else (203 files, 1,886 strings)

Strings the guard would fail, per file, largest first.

```
 143  app/project-detail.tsx
 121  constants/flagshipProject.ts
  79  utils/demoSeed.ts
  72  utils/featureRegistry.ts
  67  app/(tabs)/discover/tools.tsx
  47  utils/pdfGenerator.ts
  42  app/_layout.tsx
  42  app/coi-vault.tsx
  30  components/PDFPreSendSheet.tsx
  29  app/(tabs)/discover/index.tsx
  29  app/public-profile-setup.tsx
  25  components/CreateMenu.tsx
  24  app/data-export.tsx
  24  components/UniversalMicButton.tsx
  24  utils/arTrack/session.ts
  24  utils/syncLedger.ts
  23  utils/emailService.ts
  22  app/documents.tsx
  22  app/insurance-audit.tsx
  22  app/retention.tsx
  22  utils/insuranceAuditPack.ts
  21  utils/statusLabels.ts
  20  utils/errorCopy.ts
  19  utils/weekClose/composeWeekClose.ts
  18  app/business.tsx
  18  app/get-verified.tsx
  18  app/work-order.tsx
  17  utils/noticeClock.ts
  16  components/summary/ToolsSheet.tsx
  15  app/contacts.tsx
  15  components/NextStepHero.tsx
  15  utils/coProofPacket.ts
  14  app/generative-setup.tsx
  14  utils/nyHomeImprovement.ts
  13  components/AIWeeklySummary.tsx
  12  app/widget-setup.tsx
  12  components/AssemblyEditorModal.tsx
  12  components/desktop/DataTable.tsx
  12  components/followUp/PreventiveFollowUps.tsx
  12  components/registers/CoiVaultRegister.tsx
  11  app/import-pipeline.tsx
  11  components/ProjectFilesBrowser.tsx
  11  components/buildingRecord/BuildingRecordCard.tsx
  11  components/buildingRecord/NjBuildingRecordCard.tsx
  11  utils/jobFacts/buildJobFacts.ts
  10  app/data-import.tsx
  10  app/integrations.tsx
  10  components/UniversalSearch.tsx
  10  components/registers/DocumentsRegister.tsx
  10  utils/automation/jurisdiction.ts
  10  utils/registers/coiRows.ts
  10  utils/systemOfAction.ts
   9  app/(tabs)/summary/index.tsx
   9  app/connect-claude.tsx
   9  app/job-detail.tsx
   9  app/job-facts.tsx
   9  components/buildingRecord/MdBuildingRecordCard.tsx
   9  utils/aiService.ts
   9  utils/digestSettingsCopy.ts
   9  utils/generativeSetup.ts
   9  utils/quotaPrecheck.ts
   9  utils/winOptimizer.ts
   8  app/weekly-snapshot.tsx
   8  components/RateOverrideModal.tsx
   8  components/buildingRecord/DepartmentCard.tsx
   8  components/buildingRecord/DraftQuestionButton.tsx
   8  utils/oneMind/factBlocks.ts
   8  utils/purchaseOrderPdf.ts
   8  utils/syncStatusCore.ts
   8  utils/workflowPipelines.ts
   7  app/waiting-on.tsx
   7  components/ConfirmEmailModal.tsx
   7  components/ProductivityCalculator.tsx
   7  components/SquareFootEstimator.tsx
   7  constants/assemblies.ts
   7  hooks/useActivityFeed.ts
   7  utils/dataExport.ts
   7  utils/projectContextPure.ts
   6  app/activity-feed.tsx
   6  components/HelpFab.tsx
   6  components/buildingRecord/MdDraftQuestion.tsx
   6  components/priceWatch/PriceWatchCard.tsx
   6  contexts/ProjectContext.tsx
   6  hooks/useCollectionSettled.ts
   6  utils/aiLimitAlert.ts
   6  utils/buildingAccess.ts
   6  utils/buildingRecord.ts
   6  utils/departmentQuestion.ts
   6  utils/ownerConfidence.ts
   6  utils/shellChords.ts
   5  components/DemoSeedPickerModal.tsx
   5  components/OfflineSyncPill.tsx
   5  components/OwnerConfidenceCard.tsx
   5  components/ProjectHero.tsx
   5  components/priceWatch/PriceDriftCheck.tsx
   5  constants/glossary.ts
   5  utils/paletteRows.ts
   5  utils/registers/registerCsv.ts
   4  components/QuickUpdateClarifier.tsx
   4  components/ToolScreenChrome.tsx
   4  components/desktop/JobSwitcher.tsx
   4  components/motion/kit/__demo__/KitGallery.tsx
   4  contexts/AuthContext.tsx
   4  hooks/useUniversalSearch.ts
   4  utils/apReconciliation.ts
   4  utils/arTrack/availability.ts
   4  utils/coAdvance.ts
   4  utils/emailLayout.ts
   4  utils/followUp/rules.ts
   4  utils/pdfDesign.ts
   4  utils/sampleGuard.ts
   4  utils/settingsLoadGuard.ts
   3  app/+not-found.tsx
   3  app/track-record.tsx
   3  components/EntityActionSheet.tsx
   3  components/ErrorBoundary.tsx
   3  components/InfoBubble.tsx
   3  components/LockedAccessCard.tsx
   3  components/ReferralPrompt.tsx
   3  components/portfolio/PortfolioTable.tsx
   3  components/registers/ContactsRegister.tsx
   3  utils/aiConsentCore.ts
   3  utils/coProofPacketHtml.ts
   3  utils/dataImport.ts
   3  utils/offlineQueue.ts
   3  utils/oneMind/answer.ts
   3  utils/oneMind/composePrompt.ts
   3  utils/oneMind/demoColdStart.ts
   3  utils/queryPersist.ts
   3  utils/roleBlinding.ts
   2  app/project-files.tsx
   2  components/CSIDivisionPicker.tsx
   2  components/RevenueEarlyAccessCard.tsx
   2  components/StatusPipeline.tsx
   2  components/UpgradeSheet.tsx
   2  components/desktop/NoticeStrip.tsx
   2  components/desktop/SplitView.tsx
   2  components/desktop/ToolbarActions.tsx
   2  components/loaders/WorkProgress.tsx
   2  components/moments-sites/COApproveSheet.tsx
   2  components/summary/NeedsYou.tsx
   2  hooks/useBuildingRecord.ts
   2  hooks/useLeakCoDrafts.ts
   2  hooks/useMdBuildingRecord.ts
   2  hooks/useNjBuildingRecord.ts
   2  hooks/useProjectCapGate.ts
   2  utils/audioTranscribeCore.ts
   2  utils/chaseNudge.ts
   2  utils/coiValidator.ts
   2  utils/dailyLogCompletion.ts
   2  utils/entityActions.ts
   2  utils/followUp/engine.ts
   2  utils/groundingChip.ts
   2  utils/invokeWithTimeout.ts
   2  utils/location.ts
   2  utils/mailtoComposer.ts
   2  utils/oneMind/buildReadinessBlock.ts
   2  utils/projectDocuments.ts
   2  utils/projectRole.ts
   2  utils/weekClose/nudge.ts
   1  app/+html.tsx
   1  components/ContactPickerModal.tsx
   1  components/CraneLoader.tsx
   1  components/DatePickerModal.tsx
   1  components/FilterChipRow.tsx
   1  components/LanguagePicker.tsx
   1  components/desktop/LineItemGrid.tsx
   1  components/desktop/ShellDock.tsx
   1  components/desktop/ShellHotkeys.tsx
   1  components/desktop/ShortcutSheet.tsx
   1  components/desktop/webDocument.ts
   1  components/level/JobLevelReason.tsx
   1  components/level/ProjectLevelCard.tsx
   1  components/logs/LogShell.tsx
   1  components/project/ProjectOverviewColumns.tsx
   1  components/registers/RegisterShell.tsx
   1  components/search/CommandPalette.tsx
   1  components/summary/TodayOnSite.tsx
   1  constants/productivityRates.ts
   1  hooks/useJurisdictionAnswers.ts
   1  hooks/useSidebarRail.ts
   1  hooks/useSmartInbox.ts
   1  utils/accountingExport.ts
   1  utils/arTrack/native.ts
   1  utils/coApproval.ts
   1  utils/csiMasterFormat.ts
   1  utils/fileBytes.ts
   1  utils/floatExplain.ts
   1  utils/icsGenerator.ts
   1  utils/laborSamples.ts
   1  utils/mageAI.ts
   1  utils/nextBillableMilestone.ts
   1  utils/paywallPracticeOffer.ts
   1  utils/portfolio/factLines.ts
   1  utils/projectCap.ts
   1  utils/projectClone.ts
   1  utils/projectFiles.ts
   1  utils/projectTypes.ts
   1  utils/rateProvenance.ts
   1  utils/recoveredValue.ts
   1  utils/registers/documentRows.ts
   1  utils/routeTitle.ts
   1  utils/tradeInference.ts
```
