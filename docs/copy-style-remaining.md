# Copy style: what is still to convert

Written 2026-10-05 by lane COPYSTYLE (the trial lane). The style is in `docs/VOICE.md` sections 3 and 4. The guard is `scripts/validate-copy-voice.ts`.

## Where things stand

- **Converted: 482 files**, listed in `scripts/copy-style-converted.json`. The app shell and first run (40 files, the trial lane): the tab bar, the desktop sidebar, Home and its cards, Needs Attention, Settings, sign-in, sign-up, reset password, onboarding, persona select and the three paywalls, plus the files they print labels from (`utils/planFeatureCopy.ts`, `utils/settingsSections.ts`, `utils/onboardingProfile.ts`, the desktop action rail and the sidebar pieces). **Lane 1 (144 files, done 2026-10-05):** estimate, takeoff, quotes, cost history, proposals, the contract, selections, bids, buyout, leads, prequal, materials, the marketplace and RFP screens. **Lane 3 (103 files, done 2026-10-05):** daily report, punch, the invoice screen, time tracking, crew, T&M tickets, deliveries, building access, safety, equipment, scan, photos, voice and lineup; see its section below. **Lane 2 (195 files, done 2026-10-06):** invoices and pay apps, change orders, payments, cash flow, WIP, budget, job costing, retainage, lien waivers, reports, margin, QuickBooks, tax, the client portal setup and client view, and everything under schedule (Schedule Pro, the phone schedule, Last Planner, delays, weather); see its section below.
- **Still to convert: 381 files with 3,562 strings the guard would fail today** (counted 2026-10-06 with lanes 1, 2 and 3 in). Counts by rule: label not in Title Case 2,352, dash used as punctuation 935, "&" 184, "e.g." or "i.e." 52, arrows 39. To count again: `bun scripts/validate-copy-voice.ts --strict-preview "app/,components/,utils/,constants/,hooks/,contexts/"`.
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
| 2. Money and schedule (**done**) | Invoices, pay apps, payments, change orders, cash flow, WIP, budget, job costing, retainage, lien waivers, reports, margin, QuickBooks, tax; and schedule, Last Planner, lookahead, pace, delay, weather. | 0 of 195 left | 0 of 2,164 left |
| 3. Field and safety (**done**) | Daily report, punch, photos, time tracking, crew, T&M tickets, deliveries, safety, equipment, scan, voice, lineup. This is the lane that goes through t(): most of its English has a Spanish entry to re-read and re-stamp. | 0 of 103 left | 0 of 1,621 left |
| 4. Office, AI and portal | Client portal, RFIs, submittals, plans, permits, Code Check, Construction AI, Ask MAGE, copilot, inspection, warranty, closeout, handover, subs, tutorials, messages, notifications, team. | 178 | 1,678 |
| 5. Shell remainder and everything else | The project page, Discover and the Tools list, the feature registry, the create menu, Summary, the root layout (every screen title), shared components (ui, desktop, registers), PDFs and emails built in utils/, demo and sample data. | 203 | 1,886 |
| **Total** | | **823** | **9,198** |
| **Still to convert (lanes 4 and 5)** | Less the handful of strings lanes 1, 2 and 3 changed in other lanes' files. | **381** | **3,562** |

### Lane 1. Estimate, bids and contract (144 files, 1,849 strings): DONE 2026-10-05

All 144 files are in `scripts/copy-style-converted.json` and the guard reads zero for them. The file list is in git history (this section before the lane landed).

### Lane 2. Money and schedule (195 files, 2,164 strings): DONE 2026-10-06

All 195 files are in `scripts/copy-style-converted.json` and the guard reads zero for them. About 2,070 source lines changed in 185 files. Four English catalog entries regenerated (`money.coProof`, `schedule.lateness`); those surfaces have no Spanish yet, so no Spanish entry moved. The file list is in git history (this section before the lane landed).

What this lane left as typed, each with an allow-list entry and its reason in `scripts/copy-voice-allowlist.json`:

- **Legal documents, not restyled at all.** `utils/aiaForms.ts` (the G704, G706, G706A, G707, G714 and A401-style closeout forms and the subcontract), `utils/lienWaiverForms.ts` (statutory waiver text and its field labels), the pay app PDF template in `utils/aiaBilling.ts` (form line text such as "Total Completed &amp; Stored to Date"), the notary labels "State of" and "County of" on the pay app screen, and the contract placeholder `[warranty period — set before signing]` (code matches it).
- **Captions are sentence case.** A caption beside a figure is helper text, not a label, even when its constant is named `…_LABEL`: `CONTRACT_SUM_BASIS_LABEL` ("Estimate (no signed contract yet)"), the WIP source captions in `utils/wip.ts`, the retainage source captions ("from your contract"), "Over by" and "Under by" before an amount. They are printed after other words and validators pin the exact text. Their dashes were rewritten.
- **Labels that are also keys.** `LEGACY_SEED_SCHEDULE` labels ("Deposit (signing)" and three more) are matched, case and all, against milestones saved on projects. The `InlineVoiceFill` title "Dictate this change order" is hashed into the dictation queue key. "Billed as work is completed" is held equal to the contract wording. "Subs & pay" in `utils/projectWorkspaceLayout.ts` is held equal to the project page tile in `app/project-detail.tsx` (lane 5). `SAMPLE_PORTAL_NOTE` carries `SAMPLE_PORTAL_REASON` word for word (lane 5). The 1099 CSV column header "Commitment Paid To Date (undated — NOT counted)" is a field name a CPA maps.
- **Text sent to the model.** `buildAnswersPrompt.ts`, the profit leak prompts, the bid leveling prompt, `scheduleAI.ts`, the EVM prompt in `app/budget-dashboard.tsx`.
- **Left for a founder decision.** `app/payment-predictions.tsx` line 189 ("to forecast real inflows"), the narrative sentences in `utils/brain/accuracyReport.ts` (they state how accurate MAGE has been), and the financing line in `utils/financing.ts` ("/mo", "see if you prequalify").

Things the next lanes will hit, found here:

- **A caption is not a label.** `--fix-labels` capitalizes every `…_LABEL` map. Read where each one prints before accepting it: lane 2 put about 40 back.
- **The guard skips a label that opens with This, You, It, We or There.** "This week" (a tab), "This period" (a column) and "Your price" read as sentences to it. Search the `--dump` for short strings that open with those words.
- **A text change can move a pinned hash.** `validate-money-desk` hashes a block of `app/payments.tsx`; the hash was re-recorded after reading the diff (text only).
- **Do not run a blanket old-to-new replacement over validators or tests, even only the red ones.** It renamed three `it()` titles (which are snapshot keys), a slice marker that is a code comment, fixture data and a button constant from another lane's file, and one of those made a validator hang. Every one was put back by hand. Fix each red check by reading it.
- **Task names changed.** Schedule template and demo schedule task names say "and" now ("Prime and Paint"). A schedule already saved keeps the name it was saved with.
- **`runv`-style parallel runners need stdin closed** (`< /dev/null`), or a validator that waits on a fake alert never exits.

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

### Lane 4. Office, AI and portal (178 files, 1,678 strings)

Strings the guard would fail, per file, largest first.

```
  90  app/(tabs)/construction-ai/index.tsx
  76  app/permits.tsx
  74  app/rfi.tsx
  72  app/submittal.tsx
  58  app/plans.tsx
  57  app/plan-viewer.tsx
  52  app/notifications-settings.tsx
  51  app/oac-meeting.tsx
  44  app/closeout-binder.tsx
  43  app/sub-portal-setup.tsx
  41  utils/codeJurisdiction.ts
  40  app/(tabs)/subs/index.tsx
  39  app/warranty-walk.tsx
  33  app/warranties.tsx
  28  app/notifications-inbox.tsx
  26  components/inspectionPrep/InspectionReadySheet.tsx
  24  app/handover.tsx
  24  components/copilot/CopilotShell.tsx
  19  utils/plans/planSweep.ts
  19  utils/subScorecard.ts
  18  app/extract-submittals.tsx
  18  app/plan-intelligence.tsx
  18  components/plans/AskPlansPanel.tsx
  18  utils/plans/revisionActions.ts
  18  utils/portalSnapshot.ts
  16  utils/tutorial/fixtures.ts
  13  components/collaborators/CollaboratorsManager.tsx
  13  utils/portalLanguages.ts
  12  utils/copilot/intentTable.ts
  12  utils/permitInspectionFacts.ts
  12  utils/tutorial/learn/laneD.ts
  11  components/codeLook/CodeLookSheet.tsx
  11  components/passport/HomePassportCard.tsx
  11  components/permitPath/SaveAnswerSheet.tsx
  11  utils/oacEngine.ts
  11  utils/permitPath/copy.ts
  10  app/managed-property.tsx
  10  app/skills-check.tsx
  10  app/sub-scorecard.tsx
  10  components/logs/SubmittalLog.tsx
  10  components/registers/SubsRegister.tsx
  10  utils/permitPath/packs/base.ts
   9  components/AISubEvaluator.tsx
   9  components/SubDailyUpdateModal.tsx
   9  components/brain/AskConversation.tsx
   9  components/construction/AskConstructionMode.tsx
   9  components/logs/RfiLog.tsx
   9  utils/passport/buildHomePassport.ts
   8  app/copilot.tsx
   8  components/automation/InspectionResultReviewSheet.tsx
   8  components/codeCard/CodeCardSheet.tsx
   8  components/codeThread/SavedCodeCheckSheet.tsx
   8  components/permitPath/AskDepartmentSheet.tsx
   8  components/subs/SubCredentialCard.tsx
   8  utils/tutorial/learn/laneA.ts
   7  app/shared-plan.tsx
   7  app/skills-certificates.tsx
   7  components/AIHomeBriefing.tsx
   7  utils/closeoutBinderEngine.ts
   7  utils/codeAmendments.ts
   7  utils/portalOwnerCore.ts
   7  utils/subCompliance.ts
   6  app/accept-invite.tsx
   6  app/copilot-hub.tsx
   6  components/PropertyManagerHome.tsx
   6  components/permitPath/ReadinessPanel.tsx
   6  components/subs/SubReferralCard.tsx
   6  utils/brain/trackRecord.ts
   6  utils/constructionNews.ts
   6  utils/learn/quizBank.ts
   6  utils/passport/askHomePrompt.ts
   6  utils/passport/consumerPassport.ts
   6  utils/tutorial/learn/laneC.ts
   5  app/brief.tsx
   5  app/home-passport.tsx
   5  app/messages.tsx
   5  components/codeThread/ProjectCodeChecksCard.tsx
   5  components/subs/SubNetworkProfileView.tsx
   5  components/tutorial/TutorialHost.tsx
   5  utils/codeThread/cloudSync.ts
   5  utils/copilot/hubRouting.ts
   5  utils/logs/submittalLogRows.ts
   5  utils/portalLinkExpiry.ts
   5  utils/tutorial/registry.ts
   4  app/sub-portals.tsx
   4  app/tutorials.tsx
   4  components/RFITriageModal.tsx
   4  components/codeThread/CodeThreadActions.tsx
   4  contexts/SubscriptionContext.tsx
   4  utils/closeoutPacketGenerator.ts
   4  utils/copilot/newProject/newProjectCapability.ts
   4  utils/copilot/rfi/rfiGaps.ts
   4  utils/copilot/submittal/submittalCapability.ts
   4  utils/copilot/submittal/submittalGaps.ts
   4  utils/permitPath/packs/longIsland.ts
   4  utils/plans/memoryIndexCore.ts
   4  utils/registers/subRows.ts
   4  utils/subNetwork.ts
   4  utils/tutorial/entryPoints.ts
   4  utils/tutorial/handoff.ts
   4  utils/tutorial/learn/laneB.ts
   3  app/construction-news.tsx
   3  components/SendPortalLinkModal.tsx
   3  components/codeCard/CodeCardList.tsx
   3  components/codeThread/CodeCheckThisButton.tsx
   3  components/learn/CertificateCard.tsx
   3  components/permitPath/StationDetail.tsx
   3  components/project/SubsPayTile.tsx
   3  components/tutorial/CoachCard.tsx
   3  utils/brainWatch.ts
   3  utils/brief/composeBrief.ts
   3  utils/copilot/warranty/warrantyGaps.ts
   3  utils/handoverWaivers.ts
   3  utils/permitPath/packs/nyc.ts
   3  utils/planRevisionCore.ts
   3  utils/plans/planDiscipline.ts
   3  utils/tutorial/defs/askYourPlans.ts
   3  utils/tutorial/defs/closeoutBinder.ts
   3  utils/tutorial/learn/fixturesB.ts
   2  app/permit-path.tsx
   2  app/project-memory.tsx
   2  app/sub-profile.tsx
   2  components/CodeCheckLoader.tsx
   2  components/codeCard/CodeCard.tsx
   2  components/codeCard/JurisdictionBlock.tsx
   2  components/learn/QuizResultCard.tsx
   2  components/plans/PlanSweepPanel.tsx
   2  components/tutorial/PausedPill.tsx
   2  components/tutorial/TutorialOfferChip.tsx
   2  utils/codeCard/summary.ts
   2  utils/codeLook.ts
   2  utils/constructionAnswer.ts
   2  utils/copilot/newProject/newProjectGaps.ts
   2  utils/copilot/permit/permitCapability.ts
   2  utils/copilot/permit/permitGaps.ts
   2  utils/copilot/warranty/warrantyCapability.ts
   2  utils/planSheetBatchCore.ts
   2  utils/plans/planAnswer.ts
   2  utils/plans/specBookRange.ts
   2  utils/portalMessageWrite.ts
   2  utils/subTradeMatch.ts
   2  utils/submittalAttachments.ts
   2  utils/tutorial/defs/index.ts
   1  components/PortalStatusPill.tsx
   1  components/WarrantyWalkBanner.tsx
   1  components/collaborators/PendingInvitesCard.tsx
   1  components/permitPath/InterviewPanel.tsx
   1  components/plans/PlanSheetRail.tsx
   1  components/subs/SubWorkHistoryList.tsx
   1  components/summary/BriefingHero.tsx
   1  components/tutorial/FinaleCard.tsx
   1  hooks/useAskCopy.ts
   1  hooks/useConstructionNews.ts
   1  hooks/useMessageAttachmentCopy.ts
   1  hooks/usePortalApprovalReconciler.ts
   1  utils/brief/nudge.ts
   1  utils/codeAckCore.ts
   1  utils/codeCard/echoCheck.ts
   1  utils/codeThread/context.ts
   1  utils/copilot/rfi/rfiCapability.ts
   1  utils/copilot/turnMeter.ts
   1  utils/copilot/types.ts
   1  utils/inspectionPrep.ts
   1  utils/learn/certificateDoc.ts
   1  utils/logs/rfiLogRows.ts
   1  utils/permitInspectionHistory.ts
   1  utils/permitOffices.ts
   1  utils/permitPath/deptAnswers.ts
   1  utils/planCodeReviewer.ts
   1  utils/planIntelligence.ts
   1  utils/planSheetImageCore.ts
   1  utils/projectMemory.ts
   1  utils/pushPermissionAsk.ts
   1  utils/rfiHoldTime.ts
   1  utils/rfiLatency.ts
   1  utils/subsPayRows.ts
   1  utils/tutorial/learn/fixturesD.ts
   1  utils/tutorial/machine.ts
```

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
