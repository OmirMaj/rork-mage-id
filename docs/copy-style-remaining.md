# Copy style: what was converted, and what is left for the server pass

Written 2026-10-05 by lane COPYSTYLE (the trial lane); closed out 2026-10-06 by lane 5. The style is in `docs/VOICE.md` sections 3 and 4. The guard is `scripts/validate-copy-voice.ts`.

## Where things stand

- **The app is converted: 869 files**, listed in `scripts/copy-style-converted.json` (`CONVERTED_PINNED` = 869). That is every file the five lanes and the trial lane were given: `app/`, `components/`, `utils/`, `constants/`, `hooks/` and `contexts/`. The guard reads zero for R15 (label case), R20 (dash as punctuation), R21 ("&"), R22 ("e.g." / "i.e.") and R23 (arrows) in all of them, and R24 ("unlimited") is zero everywhere.
- **Nothing in the app is still waiting for a lane.** To check: `bun scripts/validate-copy-voice.ts --strict-preview "app/,components/,utils/,constants/,hooks/,contexts/"` prints 0 strict hits.
- **The server and the static portal pages were converted on 2026-10-08** (lane SERVER): see "The server and portal pass" at the end of this file, and "Not converted: what is still left" under it. None of it is live without a deploy.
- **What is left as typed inside the app** has an entry in `scripts/copy-voice-allowlist.json` (405 entries) with the reason: a string that is also a key, text the server compares, prompt text, legal and consent text, captions, another organization's name.
- The guard only calls a string a label when its position says so (a `title` / `label` prop, an alert title, an alert button, a short VoiceOver label, a constant named `…_LABEL` / `…_TITLE`, a style key such as `rowLabel` or `sectionHeader`, text inside a button). A label held in a plain constant, or drawn with a style key the guard does not know, was found by reading the `--dump`, and a few will have been missed. When you see one on a screen, fix it: nothing else is needed.

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
| 4. Office, AI and portal (**done**) | Client portal, RFIs, submittals, plans, permits, Code Check, Construction AI, Ask MAGE, copilot, inspection, warranty, closeout, handover, subs, tutorials, messages, notifications, team. | 0 of 178 left | 0 of 1,678 left |
| 5. Shell remainder and everything else (**done**) | The project page, Discover and the Tools list, the feature registry, the create menu, Summary, the root layout (every screen title), shared components (ui, desktop, registers), PDFs and emails built in utils/, demo and sample data. | 0 of 203 left | 0 of 1,886 left |
| **Total** | | **823** | **9,198** |
| **Still to convert in the app** | | **0** | **0** |

### Lane 1. Estimate, bids and contract (144 files, 1,849 strings): DONE 2026-10-05

All 144 files are in `scripts/copy-style-converted.json` and the guard reads zero for them. The file list is in git history (this section before the lane landed).

### Lane 2. Money and schedule (195 files, 2,164 strings): DONE 2026-10-06

All 195 files are in `scripts/copy-style-converted.json` and the guard reads zero for them. About 2,070 source lines changed in 185 files. Four English catalog entries regenerated (`money.coProof`, `schedule.lateness`); those surfaces have no Spanish yet, so no Spanish entry moved. The file list is in git history (this section before the lane landed).

What this lane left as typed, each with an allow-list entry and its reason in `scripts/copy-voice-allowlist.json`:

- **Legal documents, not restyled at all.** `utils/aiaForms.ts` (the G704, G706, G706A, G707, G714 and A401-style closeout forms and the subcontract), `utils/lienWaiverForms.ts` (statutory waiver text and its field labels), the pay app PDF template in `utils/aiaBilling.ts` (form line text such as "Total Completed &amp; Stored to Date"), the notary labels "State of" and "County of" on the pay app screen, and the contract placeholder `[warranty period — set before signing]` (code matches it).
- **Captions are sentence case.** A caption beside a figure is helper text, not a label, even when its constant is named `…_LABEL`: `CONTRACT_SUM_BASIS_LABEL` ("Estimate (no signed contract yet)"), the WIP source captions in `utils/wip.ts`, the retainage source captions ("from your contract"), "Over by" and "Under by" before an amount. They are printed after other words and validators pin the exact text. Their dashes were rewritten.
- **Labels that are also keys.** `LEGACY_SEED_SCHEDULE` labels ("Deposit (signing)" and three more) are matched, case and all, against milestones saved on projects. The `InlineVoiceFill` title "Dictate this change order" is hashed into the dictation queue key. "Billed as work is completed" is held equal to the contract wording. "Subs & pay" in `utils/projectWorkspaceLayout.ts` is held equal to the project page tile in `app/project-detail.tsx` (lane 5). `SAMPLE_PORTAL_NOTE` carries `SAMPLE_PORTAL_REASON` word for word (lane 5). The 1099 CSV column header "Commitment Paid To Date (undated — NOT counted)" is a field name a CPA maps.
- **Text sent to the model.** `buildAnswersPrompt.ts`, the profit leak prompts, the bid leveling prompt, `scheduleAI.ts`, the EVM prompt in `app/budget-dashboard.tsx`.
- **The client view is a preview of the portal page.** Its button says "Check financing options" because the page the client opens (`marketing/portal`, not in any lane) and the note beside it (`utils/financingCore.ts`) say that; all three change together. "Last updated 3:38 PM" carries a time, so it is sentence case. The pay app grid header "D From Previous" has a column letter in front, so "From" takes a capital.
- **Left for a founder decision.** `app/payment-predictions.tsx` line 189 ("to forecast real inflows"), the narrative sentences in `utils/brain/accuracyReport.ts` (they state how accurate MAGE has been), and the financing line in `utils/financing.ts` ("/mo", "see if you prequalify").

Things the next lanes will hit, found here:

- **A caption is not a label.** `--fix-labels` capitalizes every `…_LABEL` map. Read where each one prints before accepting it: lane 2 put about 40 back.
- **The guard skips a label that opens with This, You, It, We or There.** "This week" (a tab), "This period" (a column) and "Your price" read as sentences to it. Search the `--dump` for short strings that open with those words.
- **A text change can move a pinned hash.** `validate-money-desk` hashes a block of `app/payments.tsx`; the hash was re-recorded after reading the diff (text only).
- **Do not run a blanket old-to-new replacement over validators or tests, even only the red ones.** It renamed three `it()` titles (which are snapshot keys), a slice marker that is a code comment, fixture data and a button constant from another lane's file, and one of those made a validator hang. Every one was put back by hand. Fix each red check by reading it.
- **Task names changed.** Schedule template and demo schedule task names say "and" now ("Prime and Paint"). A schedule already saved keeps the name it was saved with.
- **A test lookup can go stale without failing.** `w6d-b1-phone` pressed the first pill matching `/^(On track|Watch|Over|Unbudgeted)$/`; with "On Track" on screen it pressed a different phase and the golden grew by 12 lines. When a re-recorded golden changes its `lines` count, the tree changed: find out why before accepting it. Every other golden in this lane kept its line count.
- **`test:desktop-web` holds lookups too.** `__tests__/web/*.webtest.tsx` find column headers, row labels and VoiceOver labels by their text. Lane 2 repaired 17 of them in three files.
- **One string outside this lane's list changed:** the desktop A/R aging pill in `utils/dashboardTables.ts` says "Retainage Only", because it is held equal to the phone pill in `app/reports.tsx`.
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
- **Jest lookups are not found by the validators.** After every validator was green, 21 smoke suites and 2 web suites still looked up the old words (`getByText`, `getByLabelText`, `toBe` on an alert title, a CSV header row). Run the whole smoke suite before calling the pins done. A `not.toMatch(/old words/)` passes for ever once the words change: search the tests for the old string, do not wait for a red.
- **The bulk "Skipped" line** (`logBulkSkippedLine` in `utils/logs/rfiLogRows.ts`, also used by the invoice and change order logs in lane 2) no longer joins with a dash: "Skipped 3: #4, #7 (already sent); #2 (paid).".
- **"so" inside a label** has no Title Case the guard accepts ("Cost so Far" is what it asks for). "Cost so far" became "Cost to Date".

### Lane 5. Shell remainder and everything else (done, 2026-10-06)

Converted: all 203 files are on `scripts/copy-style-converted.json` and the guard reads zero for them. 188 of them changed (about 1,920 source lines, about 1,600 distinct strings). About 250 of those were labels the guard could not see, found by reading the dump: every value in `utils/routeTitle.ts` (about 125 route titles), the field screen titles that go through `t('nav.title.…')` in `app/_layout.tsx`, the glossary terms, and the table headers and stat rows of the PDFs and emails built in `utils/pdfGenerator.ts`, `utils/purchaseOrderPdf.ts` and `utils/emailService.ts`. English catalog shards were regenerated and 40 Spanish entries re-stamped (none re-worded: the meaning did not change). The file list is in git history (this section before the lane landed).

What this lane left as typed, each with an allow-list entry and its reason:

- **The four Discover early-access cards** (`app/(tabs)/discover/index.tsx`, headlines, bodies and footers): a founder decision, see below.
- **Text the model reads.** The Ask MAGE fact blocks and prompt (`utils/oneMind/factBlocks.ts`, `composePrompt.ts`, `buildReadinessBlock.ts`), the prompt lines in `utils/aiService.ts`, the grounding line in `utils/groundingChip.ts`, the fact-block domain name `PIPELINE & CAPACITY`. The building-record lines in `utils/buildingRecord.ts` and the recipient lines in `utils/departmentQuestion.ts` are printed on the card AND sent in the record prompt block, and `validate-building-record` / `validate-baltimore-ai` hold every output byte-identical to a recorded baseline, so they keep their dashes. `csiDivisionLabel` ("Div 26 — Electrical") is printed into the profit-leak scope summary the model reads.
- **Text stored on the device or the server and compared.** The two refusal reasons in `utils/syncLedger.ts` and `utils/offlineQueue.ts` ("Free plan allows 1 project — upgrade, or delete a job first", "This job has safety records — it was not deleted") are saved on queued records and matched as text. The `'Sample — '` project-name prefix (`utils/projectCap.ts`, `utils/demoSeed.ts`, two components). The `'Labor — '` line prefix in `utils/laborSamples.ts`. The trade value `Doors & Hardware`.
- **Legal and consent text.** The AI consent lines in `utils/aiConsentCore.ts` (with their arrows and "Not now"), the T&M ticket attestation in `utils/pdfDesign.ts`, the notice-clock disclaimer in `utils/noticeClock.ts`.
- **Held equal to a page this pass cannot change.** "Photo code check" on the project page (two of its eight copies are in `supabase/functions`). The schedule chips in `utils/ownerConfidence.ts` ("On track", "Minor delays", "Behind schedule" …) and the five row labels of `components/OwnerConfidenceCard.tsx` ("Invoiced to date" …) are the in-app copy of the static client portal page. "Use my location", "Location set" and "Location unavailable" in `utils/location.ts`: the iOS purpose string in `app.json` quotes the control word for word.
- **Captions and fragments.** The audit-trail and evidence captions of the change order proof packet (`utils/coProofPacket.ts`, `utils/jobFacts/buildJobFacts.ts`), nouns printed after a count (`utils/dataExport.ts`), the rule nouns in `utils/buildingAccess.ts`, "per SF", default PDF file names ("Maple St - Estimate - Oct 2026"), a font URL and a script inside HTML.

Not restyled and not on the allow-list, because the guard does not read them as labels: the proof packet's section titles and row labels (`COPROOF_COPY`, `utils/coProofPacketHtml.ts`), the values a PDF prints for a missing field ("Not set", "Not recorded"), `humanizeEnum()` in `utils/statusLabels.ts` (the fallback for an enum with no label map still writes sentence case, "Ready for review"; every enum a person sees should have a map), and the dev-only kit gallery.

Things found here that a later pass will hit:

- **The guard hid a second string on a line.** Its de-duplication keyed a strict hit on rule and line, so an allow-listed string hid any other string on the same line (`'Min $/hr *' : 'Min $/yr *'`). The key now includes the text. Units (`$/hr`), file extensions (`(.json)`), "vs." and a unit sign after a small word ("Step Down to a %", "% of Cost") are handled in `titleCase()` instead of by allow-list entries.
- **`&middot;` and `&bull;`** are HTML entities, not "&": the guard skips them now.
- **A title equal to an HTTP reason phrase leaks the raw error.** "Too Many Requests" is exactly what a 429 says, and `validate-error-copy` reads a title that contains the thrown text as a leak. The rate-limit title is "Request Limit Reached".
- **A validator that waits on a button it looks up by text hangs when the text changes** (`validate-w5-photo-ai-errors` looked for "See plans"; `validate-ai-consent` was given the wrong casing by a mapped replacement and looped). Kill the stuck `bun` processes: a timeout on the parent does not.
- **Mapped pin replacement is only safe one whole literal at a time, and still needs reading.** This lane built an old-to-new map from its own diff and applied it only to red validators and failing suites, never to a line that opens `it(` / `describe(`. It still rewrote fixture data (task titles, a package name, a consent constant) and seven validators had to be put back by hand.
- **Line counts.** Two goldens in `w6c-summary` lost two lines each: the arrow after "See all {n}" and after each action label in `components/summary/NeedsYou.tsx` was its own text node, and it is gone. Every other re-recorded golden kept its line count (327 snapshots in 44 files).

### The alert-title rule (decided 2026-10-06, applied in every lane's files)

The lanes had split: lane 4 kept a title that is a sentence or a question in sentence case ("Delete this sheet?"), the others capitalised theirs ("Milestone Was Already Billed"). Lane 4's way is the rule, and it is written in `docs/VOICE.md` section 3: a full sentence or a question is sentence case with its period or question mark; a noun phrase or a short command is Title Case. `isSentenceTitle()` in `scripts/copy-title-case.ts` decides (it ends in "." or "?", or opens with a pronoun subject, or has a helping verb after its first word), R15 enforces both directions, and 19 fixtures and 4 planted mutations cover it. 121 alert titles changed in 50 files. A sentence whose verb is not a helping verb is only caught once it has its period: type it.

### Left for a founder decision (unchanged, or changed in punctuation only)

- **The four Discover early-access cards**, `app/(tabs)/discover/index.tsx` lines 503 to 532, exactly as typed: "Refer a lead, earn 5% if it closes", "One-tap Friday payouts to all your subs", "Lien waivers at point-of-payment", "Finance a truck or new equipment", with their bodies and footers (payout, escrow, 1099 and lender wording; the footers are internal notes).
- **"MAGE Copilot"**: `utils/featureRegistry.ts` line 184 (the feature title), and the files lanes 3 and 4 listed.
- **Price notation**: `utils/aiLimitAlert.ts` lines 38 to 40 ("$29/mo", "$79/mo", "$150/mo").
- **Outcome and prediction wording** (dashes removed, words kept): `app/(tabs)/discover/tools.tsx` line 107 ("AI reads the floor plan room by room and learns your prices on every job"), line 156 ("The bid price that wins and profits, learned from your own win/loss history"), line 157 ("Good / better / best, priced to win. Send, track, close"); `components/NextStepHero.tsx` line 149 ("Most owners pay within 48 hours of a nudge.") and line 355 ("so every next bid gets sharper"); `utils/weekClose/composeWeekClose.ts` line 380 ("predicted landing"); the driver sentences in `utils/winOptimizer.ts` lines 285 to 330 ("worth about $… more in expected profit"); the tile "Estimate Accuracy · Bid vs Actual" in `app/project-detail.tsx` line 4241. Earlier lanes' list still stands: `app/payment-predictions.tsx` line 189, `utils/brain/accuracyReport.ts`, `utils/financing.ts`, the onboarding line "Each finished project makes the next estimate more accurate."

## The server and portal pass (2026-10-08)

Lane SERVER converted the words that do not ship in the app bundle. Nothing in it is live until the functions are deployed and the static pages are published, together.

**Converted, and held from now on by `scripts/validate-server-copy-voice.ts`** (`bun run test:server-copy-voice`, the list is `scripts/server-copy-style-converted.json`, 19 files, pinned):

- **Static pages (8):** the client portal (`marketing/portal/index.html`), the sub portal, the bid invite, the lien waiver signing page, the architect reply page, email preferences, unsubscribe, and the pay-link thank-you page (`marketing/paid`).
- **Edge function files (11):** `_shared/email.ts`, `notify`, `daily-digest`, `morning-digest`, `homeowner-weekly-digest`, `auth-magic-link/copy.ts`, `coi-expiry-watch`, `portal-link-expiry-notice`, `project-invite`, `stripe-webhook` (the payment receipt), `notify-nearby-contractors/reach.ts`.
- Three more function files changed one sentence each and are NOT on the list, because the rest of the file is prompt text: `analyze-photos` ("Photo Code Check"), `plan-extract` and `project-memory-embed` (the plan-index refusal).

**App strings released with it** (both sides changed together, 18 allow-list entries removed): "Photo Code Check" in all eight files; `PLAN_INDEX_REFUSAL`; the signing-off sentence in `utils/portalOwnerCore.ts`; the schedule chips in `utils/ownerConfidence.ts` and the five rows of `components/OwnerConfidenceCard.tsx`; "Check Financing Options" (client view, invoice email, the note in `utils/financingCore.ts`); the English labels of the portal language pack (`utils/portalLanguages.ts`). The Spanish and Portuguese selections subtitle no longer says "curated by AI" (the English never did); the French, Vietnamese and Chinese lines said the same and were corrected too.

**What the guard reads, and what it does not.** It reads every string literal of a listed function file, and on a page the text between tags, four attributes and every string of an inline script. It calls a string a label only where the position says so (a `<button>`, `<th>`, `<label>`, a heading, a class that ends in `label` / `title` / `eyebrow` / `chip` and so on, a key named `subject` / `title` / `eyebrow` / `pushTitle` / `…Label` / `…Title`, the first argument of `emailStatRow()`). A label built by joining pieces, set through `textContent`, held under another key (`payNow`), or written as the first item of a row pair (`['Filed By', who]`) is read for dashes, "&", "e.g." and arrows but not for Title Case: those were converted by reading the file. The header of the script lists every gap.

**Left as typed, on purpose** (each has an entry and a reason in `scripts/server-copy-voice-allowlist.json`, or is in a file that is not listed):

- **Legal and signed text.** The e-signature disclosures and canonical records on the portal page (`ESIGN_DISCLOSURE_TEXT`, `PROPOSAL_DISCLOSURE_TEXT`, `buildCOConsentRecord`), `CONTRACT_COPY` and the contract terms the signing page prints ("N calendar days — on or before …", the warranty placeholder), the signing moments block (the slide labels, "APPROVED", "ACCEPTED"), the lien waiver page's consent text, attestation and warning callout, the pay application form lines ("Total completed & stored", "Balance to finish" …), the AIA trademark notice, the email footer in `_shared/email.ts`, the sentence on the unsubscribe page about which emails still arrive, and the payment reminder emails in `invoice-dunning` (collection notices).
- **Keys and stored values.** The four news topics with "&" (`construction-news/core.ts` and `utils/constructionNews.ts`): the server stamps each article with its topic and the app's chips filter on that exact text, so an installed app that has not taken the update would stop matching. The `'Sample — '` project-name prefix. The punch default note `'Rejected — needs rework'`.
- **AI consent.** The AI-off sentence (`utils/aiConsentCore.ts` and the server's copy).
- **Activity feed lines** on the client portal ("Photo added", "Invoice sent", "Change order approved") stay in sentence case: they are past-tense events, written like toasts.

## Not converted: what is still left

1. **Error sentences an edge function returns in a JSON body** (`delete-account`, `convert-pdf-to-images`, `import-schedule`, `transcribe-audio`, `public-lead-intake`, `qbo-connect-callback` and the AI relays). Several still carry a dash. The app shows some of them and matches others, so each needs its caller read first.
2. **Stripe product names** built in `create-payment-link` ("Invoice #12 — Maple St") and `create-rfp-checkout` ("MAGE ID — Post a project (RFP)"): they print on Stripe's checkout page and receipts.
3. **`marketing/access.html`.** `validate-marketing-seo` holds it to the marketing site's rules (sentence-case `<title>`, the " — MAGE ID" suffix), so it converts with the marketing pass.
4. **The other outsider pages**: the lead widget (`marketing/widget`), public project pages (`marketing/builders`), `support.html`, `switch.html`, `who-built-this.html`, `thanks.html`, `404.html`, `calculator.html`. `marketing/skills` and `marketing/facts` read clean already.
5. **PDFs rendered on the server and their app twins**: the closeout binder's section titles (`utils/closeoutBinderEngine.ts`) and the proof packet's (`COPROOF_COPY`).
6. **The marketing site** (`marketing/`). Not app copy; its own voice pass.
7. **Skills-check questions** (`utils/learn/quizBank.ts`): three questions and their choices still say "Sign & send" and "Revise & re-issue". Changing a question needs a `quizVersion` bump and a regenerated server key.
8. **Voice sheet titles** ("Dictate this invoice", "Dictate today's report" …): each is hashed into the offline dictation queue key. They convert when the callers pass a stable `queueKey`.
9. **Native strings in `app.json`** (permission purpose strings, the "Near me" and "Use my location" control words they quote): a native build.
10. **A portal snapshot already published** carries the English labels it was published with (`uiStrings`), so an existing client link shows the old capitals until the contractor's app publishes it again.
