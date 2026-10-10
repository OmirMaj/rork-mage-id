# The Demo Job (owner preview)

One made-up job, built inside the app, in the owner's own account, so every
screen has something believable on it. Settings, Developer (Owner Only),
**Demo Job (Owner Preview)**. One tap creates it, one tap removes it.

Code: `utils/demoJob/` (pure generator and writer), `hooks/useDemoJobPorts.ts`
(the only link to the app's contexts), `components/demoJob/`, `app/demo-job.tsx`.
Gate: `scripts/validate-demo-job.ts` (`bun run test:demo-job`, in ship-check) and
`__tests__/smoke/demo-job.test.tsx`.

## The job

**Sample — Demo: Harbor Point Mixed-Use**, 1400 Example Wharf Street, Baltimore
(the street does not exist). Seven storeys: ground-floor retail and lobby on a
cast-in-place podium, 48 apartments on six floors of light-gauge framing (eight
per floor), two elevators, 62,000 gross square feet. Owner "Example Development
Group", architect "Sample Architects", subs "Sample ... Co.". Every email is at
example.com and every phone is (410) 555-01xx.

| | |
|---|---|
| Schedule of values at cost, 22 CSI divisions | $20,000,000 |
| Markup, 12 percent on every line | $2,400,000 |
| **Original contract sum** | **$22,400,000** |
| Approved change orders, 7 (one is a credit) | +$640,000 |
| **Contract sum to date** | **$23,040,000** |
| Pending change orders, 2 / rejected, 1 | $104,000 / $58,000 |
| Retainage | flat 10 percent |
| Pay applications 1 to 9, completed to date | $12.64M, 54.9 percent |
| Paid (applications 1 to 8) / outstanding (9) | 8 paid in full net of retainage / 1 out, due in about two weeks |
| Committed to subs and suppliers | $17,798,000: 14 subcontracts, 4 purchase orders, 7 change-order subcontracts |
| Projected final cost / margin | $20,823,429 against a $20,571,429 budget / 9.6 percent, Concrete (+$118,000) and Finishes (+$134,000) over |
| Schedule | 120 tasks, 378 working days (about 17.5 months), data date is working day 228 (month 11), 58.1 percent complete |

"Today" is the device's local day when Create is tapped (the last working day
on or before it). The job starts 227 working days earlier. Billing reads the
schedule: a schedule-of-values line is as complete as the tasks that build it
were at the end of the period, so the pay applications and the schedule cannot
drift apart. All totals on a pay application come from the app's own
`computeAIATotals`.

Four tasks ran over their baseline, each with the reason typed in: excavation
(+4, unsuitable soil, CO 1), Level 1 columns (+4, rebar resubmittal), podium
deck (+3, added transfer beam, CO 3), windows (+12 and still running, late
shipment).

## What is created

| Area | Records | Table | How it is written |
|---|---|---|---|
| Project with estimate, schedule of values, schedule and baseline | 1 (120 tasks inside) | `projects`, `project_financials` | `addProject` |
| Subcontractors | 17 | `subcontractors` | `addSubcontractor` |
| Contacts | 10 | `contacts` | `addContact` |
| Subcontracts and purchase orders | 25 | `commitments` | `addCommitment` |
| Insurance certificates (no expiry dates) | 14 | `cois` | `addCOI` |
| Change orders | 10 | `change_orders` | `addChangeOrders` |
| Invoices | 9 | `invoices` | `addInvoice` |
| Pay applications | 9 | `aia_pay_apps` | `addAIAPayApp` |
| Daily reports, last 30 working days | 30 | `daily_reports` | `addDailyReport` |
| RFIs (7 closed, 3 answered, 2 open and overdue, 2 open) | 14 | `rfis` | `addRFIs` |
| Submittals | 18 | `submittals` | `addSubmittals` |
| Punch items, Levels 2 and 3 | 35 | `punch_items` | `addPunchItems` |
| Permits with inspections | 7 | `permits` | `addPermit` |
| Owner meetings with minutes | 6 | `oac_meetings` | `addOACMeeting` |
| Warranties (started early) | 4 | `warranties` | `addWarranty` |
| Toolbox talks | 10 | `toolbox_talks` | `addToolboxTalk` |
| Hazard observations | 3 | `hazards` | `addHazard` |
| Deliveries | 10 | `deliveries` | `addDelivery` |
| Building access rules and reservations | 1 + 4 | `building_access_rules`, `access_reservations` | `setBuildingAccess`, `addReservation` |
| Delays (none from weather) | 3 | `delay_events` | `addDelayEvent` |
| Equipment with use logged | 3 | `equipment` | `addEquipment` |
| Field tickets (drafts) | 3 | `field_tickets` | `addFieldTicket` |
| Crew | 6 | `crew_members` | `addCrewMember` |
| Time entries, last 10 working days | 40 | `time_entries` | `addManualEntry` |
| Lien waivers ("received on paper") | 6 | `lien_waivers` | `saveLienWaiver` (needs a connection) |
| Draft contract | 1 | `project_contracts` | `saveContract` (needs a connection) |
| Selections with options | 3 + 7 | `selection_categories`, `selection_options` | selections engine (needs a connection) |
| Plan sheet (the bundled A-101 sample) | 1 | `plan_sheets` + 1 file | the tutorial's `ensureTutorialPlan` (needs a connection) |
| Photos (the bundled sample photo, 4 times) | 4 | `photos` + 4 files | `addProjectPhoto` |
| Living Model: Level 4, 28 rooms, every room ticked | 1 | none, this device only | `utils/livingModel` core and store |

About 320 rows and 5 small files. The offline queue holds 1,000 writes; the
builder refuses to start if fewer than 400 slots are free.

The writer adds one record, waits until the app's own list shows it, then adds
the next. Many add functions build on the list as of the last render, so two
adds in one tick keep only the second on the device. This also paces the
server to a few writes a second.

## What is left out, and why

| Left out | Why |
|---|---|
| Insurance expiry dates ("expiring soon") | The server's daily insurance check (`coi-expiry-watch`) emails the account for any sub that has an expiry date, and it has no sample fence. Certificates are there, without dates. |
| A safety incident record | A job with an incident cannot be deleted, by design (injury records are kept five years, enforced by the app and by a database trigger). The one first-aid event is a note inside a daily report, with no name and no OSHA answer. |
| A weather delay day | The app only writes one from a live weather reading. The demo does not fabricate one. Daily report weather is typed by hand and marked typed. |
| Team members, client portal invites, sub portal links, bid packages, the marketplace, leads, financing, pay links, QuickBooks | Each one reaches another person or another company. |
| Sending anything: invoices, pay applications, change orders, the contract, lien waiver signing, meeting minutes, the closeout binder | Nothing is sent. Sends from a sample job go only to the account's own email, or are refused. |
| Prequalification packets, a saved Code Check, a takeoff | Not written without a public link, an AI call or real drawings. |
| Closeout binder, WIP periods, job hazard analyses, safety inspections, crew certifications, plan pins and zones | Left out to keep sign-offs and non-cascading rows out of the account. Warranties are the closeout items that are started. |
| Retainage stepping down to 5 percent at half way | The app holds one retainage rate per line. Flat 10 percent, on every application. |

## The marker

Two tests in `utils/demoJob/marker.ts`, for two different jobs. No migration,
no new column.

- **Leaving it out** (`isDemoProject`): the name starts with `Sample — Demo: `
  OR `leadSource` is `mage_demo_job` (stamped at creation, synced, on no edit
  screen). Loose on purpose: leaving one job too many out of the cost book
  costs nothing.
- **Finding, finishing and deleting it** (`isStampedDemoProject`): the stamp
  ALONE. The builder (`utils/demoJob/writer`) uses nothing else. A job named
  `Sample — Demo: ...` by hand, or a copy of the demo, is not the builder's: it
  is not counted, not finished and never deleted, and `removeDemoJob` refuses
  it by id (rule H5).

The name starts with the app's existing sample prefix on purpose. A sample job
is already fenced by the app and by the server, and the demo inherits all of it:

- an invoice, report or change order email goes only to the account's own
  address, and `send-email` refuses anything else;
- no pay link (`create-payment-link` answers 409), no payment reminder
  (`invoice-dunning` skips the job), no QuickBooks push (`qbo-sync`,
  `qbo-reconciler`), no client portal, no public project page;
- no slot of the free plan's project cap; shifts stay out of payroll and the
  labor rates.

The demo job cannot be renamed out of that prefix: `updateProject` drops such
an edit (`demoSafeUpdates`), because the name is what the fences test, and
says so in one sentence ("Name Not Changed", rule D3).

The project carries **no client portal settings at all**. A project row with a
portal id makes the server mint a live portal key for it
(`portal_set_access_token`), and the demo must not have a credential (rule F1).

What a sample job cannot do, so the owner cannot try it on the demo: be the
active job in the desktop job switcher, appear in Ready to Bill, enable the
client portal, seal the final punch, sync a takeoff to the cloud.

## Who can open it

`utils/demoJob/allowed.ts`: an account in `utils/owner.ts` `OWNER_EMAILS`, and
only while `DEMO_JOB_BUILDER_ENABLED` is on. That list holds the founder's
account and the support account, and the repo has no helper that tells the two
apart, so both can open the builder. Narrowing it to the founder alone needs a
new "primary owner" rule, which is a decision, not a fix.

## What the demo is kept out of

Each of these goes through `isDemoProject` (or the id registry it fills) and is
pinned by `validate-demo-job` rule G2 with a planted mutation.

| Path | Where | How |
|---|---|---|
| Cost book, learned rates, cost confidence | `utils/costDatabase.ts` `buildCostDatabase` | The demo project, its commitments and its receipts are dropped at the top of the one function all 24 readers call. Closing the demo later still teaches nothing (rule G1 runs it). |
| Shared cost benchmark, public price index | same | The only writer (`hooks/useCostBenchmark`) posts rates from the cost book, which never holds a demo rate. |
| Bid calibration | `utils/estimateCalibration.ts` | Skipped beside the closed-job test. |
| Brain predictions, grading, accuracy reports | `utils/brain/predictionLedger.ts`, `hooks/useBrainGrading.ts` | Nothing is recorded for a demo project id; open rows about one are never graded. |
| Background payment forecast (an AI call) and Payment Predictions | `hooks/useWeekClose.ts`, `app/payment-predictions.tsx` | Demo invoices never start the forecast and are never sent to the model. |
| Margin alert notifications | `components/MarginAlertManager.tsx` | Demo projects are dropped before alerts are computed. |
| Self-drafted change orders | `hooks/useLeakCoDrafts.ts` | Demo projects are dropped. |
| 1099 export, insurance audit pack | `app/tax-1099-export.tsx`, `app/insurance-audit.tsx` | Demo subs, subcontracts and what is recorded against them are dropped (`utils/demoJob/payees.ts`). |
| Analytics | `utils/analytics.ts` `track` | Events for a demo project id are dropped, not tagged. The id is registered before the first write. |
| Geocoder | `contexts/ProjectContext.tsx` | The made-up street is never sent out. Coordinates are stamped at creation. |
| One Mind (Ask), every prompt and every fallback answer | `utils/oneMind/demoFence.ts`, applied in `components/brain/AskConversation.tsx` (where the bundle is built) and in `utils/oneMind/answer.ts` `askOneMind` (where it is read) | The demo project, every row that names it, its made-up subs and its constraints are dropped. Rule G4 runs it. |
| Bid advisor margin by job type, type profitability, prediction grading | `utils/judges/typeMargin.ts` `realizedMarginPct` and `aggregateTypeMargin`, `utils/portfolio/typeProfitability.ts` | A demo job has no realized margin and is not a closed job. Rule G4 runs it. |
| Morning brief email | `supabase/functions/morning-digest/index.ts` | Sample jobs are not briefed and their open RFIs are not counted (rule F4). **Needs a deploy.** |
| Assistant connector (`mcp`) | `supabase/functions/mcp/index.ts` | Sample jobs are left out of the project list, project names, RFIs, invoices, change orders, the money roll-up and the project count; the demo's "Sample ..." subs are left out of the sub list while the account holds a sample job (rule F4). **Needs a deploy.** |
| Payroll, labor rates, free plan cap, onboarding steps, Ready to Bill | existing sample rules | By name. |
| Tape and room-scan learning | none needed | It reads scans on the device, not projects. |

The demo is deliberately **not** hidden from the owner's own Home, WIP, cash
flow, job costing and portfolio screens. Those are what he asked to walk.

## Nothing leaves the account

Every kind of record was traced through the app and the migrations:

- No add function calls an edge function, an email, a push or an AI model.
  `validate-demo-job` rule F2 fails if the builder's source mentions any of 37
  such calls, or imports anything outside a fixed list of 16 modules.
- Database triggers: `notify_field_report_filed` and
  `notify_safety_incident_filed` return early when the author owns the project.
  The change-order and lien-waiver triggers fire on an UPDATE; the builder only
  inserts, in the final state. The punch trigger needs the sub portal. No
  portal message row is written.
- Scheduled jobs: payment reminders skip a sample job. The client weekly digest
  needs `weeklyDigest.enabled`, which is not set, and an invite, of which there
  are none. The insurance check needs an expiry date, of which there are none.
- No invoice is overdue on the day the job is made. Application 9 is due about
  two weeks later; the reminder job still skips it by name.

**The morning brief.** `morning-digest` is an opt-in email to the account
owner himself. It now leaves sample jobs out (see the table above), but only
once the function is deployed. Until then, if his morning brief is on, it will
mention the demo job; the screen still says so. Take that sentence
(`office.demoJob.briefBody`) off the screen after the deploy.

## Removal

**Remove Demo Job** asks first, naming the job or jobs it will delete and how
many, then deletes exactly those, each only if it still carries the builder's
stamp:

1. deletes the project through the app's `deleteProject`, handed the id and
   nothing else, so the app's own check runs: it asks the server (not only this
   device) whether the job holds a safety record, and refuses when it does or
   when it cannot ask. If this is refused, or the app says yes and the job is
   still in its list, **nothing else is touched** and the reason is shown
   (rule H6);
2. queues a delete by id for the four project tables the server does not
   cascade (`cois`, `oac_meetings`, `delay_events`, `field_tickets`);
3. deletes the shifts, the equipment, the crew, the contacts and the
   subcontractors through their own delete functions. They are recognised by
   ids worked out from the project's id, or by project id, never by a name, a
   number or a serial, so removal works on any device and never touches a
   record the owner made;
4. removes the Living Model from this device.

Creation is resumable: the screen reads the account, not a note on the device.
A job that is part way shows **Finish Creating** and **Remove**, and finishing
adds only what is missing. Every record has an id worked out from the
project's id; the four kinds whose id the app normally makes (submittals,
permits, equipment, manual shifts) are handed theirs through a second argument
of the app's add function, so a record the owner has edited is still found and
never written twice (rule H7). One demo at a time: Create is not offered while
one exists, and nothing is offered at all until the app has read its project
list (rule H8).

What removal cannot take back:

- the plan image and four photo files in private storage, if the server does
  not delete a project's files with it;
- a safety incident the owner adds to the demo by hand: the job then cannot be
  deleted until that incident is (the screen shows the app's own reason);
- a demo job whose stamp was lost (nothing in the app clears it): the builder
  no longer sees it, and it is deleted from its own project screen, which
  leaves its made-up subs, contacts, crew and equipment to delete by hand;
- records he adds himself to account-level lists while playing (a new sub, a
  new piece of equipment) and anything he sends himself from the job;
- a Living Model saved on another device for the same job.
