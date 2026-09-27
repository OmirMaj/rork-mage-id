# MAGE ID voice and copy guide

This is the rulebook for every word a person reads in MAGE ID: the iPhone app,
the desktop web app, the client, sub and architect portals, emails, push
notifications, PDFs and the marketing site. It also covers accessibility labels,
because VoiceOver reads them out loud.

If a string in the product breaks a rule here, the string is wrong. If a rule
here is wrong, change this file first, then the strings.

---

## 1. Who we write for

A general contractor running two to ten jobs, usually standing on one of them.
They are:

- **Busy.** They read a screen in the truck, between calls, with gloves in a
  pocket. Every extra word costs them.
- **Expert in construction, not in software.** They know what retainage, a
  CO, a G702 and a punch walk are. They do not know what a sync queue, a seat
  or a payload is, and they should never have to.
- **Accountable for money.** Most of what they do in MAGE ends up in front of a
  client, a sub, a lender or an inspector. The copy has to be something they
  would put their name on.

The other readers (clients, homeowners, subs, architects) see what the GC sends
them. Write those surfaces as if the GC wrote them, in the GC's name.

## 2. Voice

**Plain, direct, confident, specific.**

| We are | We are not |
|---|---|
| Plain: "Send invoice" | Clever: "Fire it off" |
| Direct: "Add a client email to send this." | Hedging: "It looks like you might want to add an email first?" |
| Confident: "Invoice #12 sent to Dana Ruiz" | Excited: "Invoice sent! 🎉" |
| Specific: "3 punch items past due" | Vague: "Some items need attention" |
| Calm about failure: "Couldn't send. Your draft is saved." | Apologetic: "Oops! Sorry, something went wrong :(" |
| Shows the fact: "No rate on file" | Talks about its own honesty: "MAGE will never invent a rate" |

The benchmark is Procore, Stripe and Apple system software: short sentences,
real nouns, no personality performance. The personality is in how precise and
useful the words are, not in jokes or exclamation marks.

## 3. Casing: sentence case everywhere

**Rule: every piece of UI text uses sentence case.** Capitalize the first word
and proper nouns only. This applies to screen titles, tab labels, sidebar items,
section headers, buttons, menu items, chips, badges, form labels, alert titles,
toasts, email subjects and PDF headings.

**Why sentence case.** It is the current standard in Apple's Human Interface
Guidelines for most UI text, in Material Design, and in Stripe, Linear and
GitHub. It reads faster, it never makes anyone decide whether "on" or "to" gets
a capital, and it makes proper nouns (QuickBooks, Home Passport, AIA) stand out
because they are the only capitals. Mixed Title Case and sentence case on one
screen is the single most visible sign of copy that was never edited.

**Examples**

| Wrong | Right |
|---|---|
| Daily Reports | Daily reports |
| Change Orders | Change orders |
| Waiting on Others | Waiting on others |
| Get AI Advice | Get cash-flow advice |
| Check Your Email | Check your email |
| Assigned Sub | Assigned sub |
| no cost basis | No cost basis |

**Exceptions (capitalize these wherever they appear)**

1. **Proper nouns:** people, companies, cities, streets, project names the user
   typed.
2. **Our names:** MAGE ID (the product and company), MAGE (the assistant).
3. **A closed list of named features.** Only these are treated as proper nouns:
   Ask MAGE, MAGE ID Bids, Home Passport, Cost X-Ray, Last Planner. Everything
   else is described in plain words and sentence-cased: "Plan intelligence",
   "Scan anything", "Smart proposal", "Budget dashboard". Adding a name to this
   list is a product decision, not a copy decision.
4. **Third-party names:** QuickBooks, Xero, Stripe, Apple Pay, Google, OSHA,
   RevenueCat never appears in UI at all.
5. **Acronyms and form numbers:** RFI, CO, AIA, G702/G703, WIP, COI, T&M, JHA,
   OAC, PPE, SOV, GC, AHJ, PDF, CSV, W-9, 1099, TIN.
6. **Subscription plan names:** Free, Pro, Business, Enterprise.
7. **Role names shown as a value:** Owner, Editor, Field, Viewer (in a role
   picker, on a team row). In a sentence: "You have view access."

**Lowercase is never a style choice.** The only lowercase-first text is a
caption that finishes a number and reads as one phrase with it: "$29 / per
month", "14 / days left", "12 / open". A label that stands on its own starts
with a capital: "Your rate", "Not signed", "Needs scale", "No adjustment".

**Uppercase is a style, never content.** Eyebrows and section labels that look
ALL CAPS are written in sentence case in the source and uppercased by the text
style (`textTransform: 'uppercase'`). Never hard-code `'FIND WORK'` or
`'THIS JOB'` as a display string: VoiceOver can spell short all-caps words
letter by letter, and hard-coded caps drift from the rest of the screen. If an
all-caps string is also used as a key, split the key from the display label.

## 4. Punctuation and formatting

- **No exclamation marks.** Anywhere. Not in success toasts, not in welcome
  alerts, not in emails, not in the celebration moment.
- **Periods on full sentences only.** Body text, descriptions and alert bodies
  end with a period. Titles, buttons, labels, chips, badges, tab names and
  one-line toasts do not.
- **Toasts** are one past-tense fragment with no period: "Invoice #12 sent",
  "Daily report saved", "Moved to the crew list". If a toast needs two
  sentences, punctuate both: "Saved offline. It sends when you're back online."
- **One em dash per string, at most, and none in buttons, labels or toasts.**
  If a sentence needs a second dash, it is two sentences. Prefer a period.
- **Middle dot (·) separates metadata**, as the app already does:
  "Kitchen · Electrical · A-101". Not dashes, not pipes.
- **Ellipsis is the single character …**, only for work in progress, and it
  names the work: "Generating estimate…", "Sending…". Never "...", never
  "Analyzing..." with nothing after it.
- **Numbers are numerals:** "3 items", "2 days", "1 sub". Money, percentages
  and dates always go through the app's formatters (`formatMoney`,
  `formatCalendarDay`); never hand-format.
- **Real plurals.** "1 task", "3 tasks". Never "task(s)".
- **No tilde for "about".** "About 20 seconds", not "~20 seconds".
- **"and", not "&"**, except in fixed names (T&M) and tight nav labels.
- **Contractions are good:** can't, couldn't, isn't, you're. They read like a
  person. Use "cannot" only in legal text.
- **Quotes and apostrophes:** straight or curly are both acceptable in source;
  never mix the two on one screen.
- **No emoji** in UI, emails, subject lines, push notifications or PDFs. Use a
  Lucide icon if a visual marker is needed. Check marks in subject lines count.

## 5. Words for actions

**Buttons are a verb plus the thing:** "Send invoice", "Save draft", "Add
punch item", "Sign and approve", "Export PDF". One to three words. The button
says what will happen, so the person can predict the result without reading
the rest of the screen.

- Never "Submit", "Go", "Done" (for a save), "Yes/No", "Click here".
- "OK" only on an alert that just informs and asks for nothing.
- An alert that confirms an action uses the action as its button: "Delete" /
  "Cancel", not "Yes" / "No".
- "Cancel" is always "Cancel". "Back" is always "Back". "Close" closes a sheet
  without deciding anything.
- **Delete vs remove.** Delete means gone for good. Remove means taken off a
  list and still exists ("Remove from roster", "Remove from this project").
- **Sign in / sign out**, not log in / login / logout.
- Loading labels name the thing: "Loading projects…", not "Loading…" alone
  where the thing is known.

## 6. Screen patterns

### Empty states
What this is, plus one action. One sentence of body at most.

> **No change orders yet**
> Change orders you create or a client requests show up here.
> [New change order]

- A filter that returns nothing is not an empty account: "Nothing matches these
  filters" + [Clear filters].
- **A failed read is an error, not an empty state.** Never show "No invoices
  yet" when the invoices could not be loaded (pinned by
  `scripts/validate-error-copy.ts`).

### Errors
Title: what did not happen, in plain words. Body: why, if we know it, then what
to do, then what happened to their work.

> **Couldn't send invoice**
> You're offline. Your draft is saved and sends when you reconnect.

- Never show `err.message`, a stack trace, a Postgres code, "Unknown error",
  "Something went wrong" on its own, "null" or "undefined".
- Use `utils/errorCopy.ts` `describeError()` for anything thrown. It already
  writes the title, the next step and the fate of the user's work. Its
  "(Reference: …)" suffix is the only place a code may appear, because support
  acts on it.
- Drop "Please". "Try again." is enough.

### Confirmations
Title is the question, body is the consequence, buttons are the verb and Cancel.

> **Delete this change order?**
> It's removed from the project and the client portal. This can't be undone.
> [Delete] [Cancel]

### Blocked actions
A disabled button always says why and what unblocks it, next to the button or
as its accessibility hint: "Add a client email to send". Never a silent grey
button. (Product rule from the brain-center directive.)

### Plan limits
"Compare drawings is on the Business plan." + [See plans]. Never "your seat",
"locked", "unlock", "upgrade to unlock".

### Long operations
Say how long: "Scanning photos. This takes about 20 seconds."

### Status labels
Every status shown to a person comes from a label map, never from the raw enum.
`in_progress` → "In progress", `pending_review` → "Pending review",
`ready_for_review` → "Ready for review", `revise_and_resubmit` → "Revise and
resubmit", `net_30` → "Net 30". The pattern
`status.replace(/_/g, ' ').replace(/\b\w/g, …)` is banned: it produces Title
Case, and it prints whatever the database holds.

## 7. AI copy

MAGE's AI is only as good as what it read. The copy shows that, briefly.

1. **Say what it read.** A grounding line, once, near the answer: "From your 14
   closed projects", "Priced with your cost history · 38 rates". If it read
   nothing of theirs, say so: "No cost history yet. Priced from regional
   averages."
2. **Say how sure, in words:** High, Medium or Low confidence, or "Based on 3
   projects". No invented percentages.
3. **Drafts are labelled drafts.** Tag editable AI output "AI draft", one
   consistent tag, not "AI-generated", "AI generated", "AI-powered" in
   different places. A draft never claims to have been sent.
4. **Verify once.** Code, permit and safety answers end with one sentence:
   "Confirm with your building department before you build." Once per answer,
   at the end. Not on every line, not in every heading.
5. **No chatbot voice.** No "Great question", "I think", "As an AI", "Here's
   what I found!". The answer starts with the answer.
6. **Show the gap, don't narrate the virtue.** "No rate on file for drywall"
   beats "MAGE does not invent a rate". The words "honest", "real data", "no
   fake data", "we never guess" do not appear in UI. The provenance line is the
   proof.
7. **Name the action, not the technology.** "Get cash-flow advice", "Evaluate
   this sub", "Rent or buy?" rather than "AI Evaluate Sub".

## 8. The one celebratory moment

**Contract signed** is the one moment the product celebrates (the signature
seal and burst in `app/contract.tsx`). It is the moment a GC wins the job.

- Motion may celebrate other completions (slide-to-complete, a pay app
  approved, final payment received) with rich animation. **The words never
  celebrate.** The copy on those moments is a plain, specific, past-tense
  confirmation: "Punch list complete · 42 items closed".
- On the signed contract, the headline may be warmer, still with no
  exclamation mark and no emoji: "Signed. The job is yours." with one specific
  subline ("Kitchen remodel · $84,500").

## 9. Pronouns and people

- **You / your** for the reader. "Your projects", "your cost history".
- **The app speaks without an actor when it can:** "Drafted from your
  estimate" rather than "MAGE drafted this from your estimate". When an actor
  is needed, it is "MAGE". "We" is reserved for legal text, support and emails
  sent by the company. Never "I".
- **Never assume gender.** No he/his/him/she/her for a client, sub, crew member
  or the user. Use the role ("the sub", "the crew member"), their name, or
  "they". This applies to alert bodies and accessibility labels too.
- On client and sub portals, the GC is "your contractor" or the GC's company
  name, never "the GC".

## 10. Glossary: one word per concept

| Concept | Use | Do not use | Notes |
|---|---|---|---|
| A construction job the GC runs | **project** | job, site, build | Matches the Projects tab and the data model. "Job" survives only in fixed industry terms: job costing, job cost, jobsite. The hiring marketplace says "job post". |
| Physical location of the work | **jobsite** | site, job site | |
| Person or company paying for the project | **client** | customer, owner, homeowner | In GC-facing UI. "Owner" only on AIA/contract documents and OAC, where it is the legal term. "Homeowner" only in residential-only features (Home Passport). |
| Account holder role | **Owner** (role value), **account owner** in sentences | admin, master | Distinct from the client. |
| Person invited into the GC's account | **team member** | seat, user, collaborator, member | |
| Access level | **role**, "view access" / "edit access" in sentences | seat, permission level, RLS | Values: Owner, Editor, Field, Viewer. |
| GC's own workers | **crew**, **crew member** | workers, employees, staff | |
| Trade contractor | **sub** in app UI; **subcontractor** in documents, PDFs and emails to third parties | trade partner, vendor | |
| Sells materials | **supplier** | vendor | |
| GC's internal pricing | **estimate** | quote, bid | |
| What the client sees and signs | **proposal** | quote, estimate PDF | |
| Price submitted to someone else's RFP, or a sub's price on a package | **bid** | offer, quote | |
| A supplier's or sub's informal price to the GC | **quote** | | Also the product name Quick Quote. |
| Change to scope or price after signing | **change order**; **CO #4** only with a number in tight space | CO alone, change request | |
| AIA progress billing | **pay app** in app UI; **Application for Payment (AIA G702/G703)** on documents | pay application, AIA pay app | |
| Money held back until completion | **retainage** | retention, holdback | |
| Bill to the client | **invoice** | bill, statement | |
| Unfinished item at closeout | **punch item**, on the **punch list** | punch, issue, task | |
| Question to the architect | **RFI** | question, request | |
| Product data for approval | **submittal** | | |
| End-of-day field record | **daily report** | daily log, DFR | |
| Time and materials record | **T&M ticket** | field ticket | |
| Payment release | **lien waiver** | release, waiver alone | |
| Insurance proof | **certificate of insurance (COI)** first use, then **COI** | insurance cert | |
| Schedule line | **task**; **milestone** for zero-duration | activity, item | |
| Drawing set / one page | **plans** / **sheet** | drawings, docs, page | |
| What MAGE learned from closed projects | **cost history** | cost book, learned costs, brain, cost DB | |
| Subscription | **plan** (Free, Pro, Business, Enterprise) in the paywall; **subscription** elsewhere | tier, seat, package | "Plans" alone means drawings outside the paywall. |
| Portal for the client / sub | **client portal** / **sub portal** | share page, link | |
| The product / the assistant | **MAGE ID** / **MAGE** | the app, the AI, the brain | |

## 11. Banned in UI

Remove on sight. Accessibility labels included.

**Tone:** exclamation marks; emoji; "Oops", "Whoops", "Uh oh", "Yay", "Boom",
"Nailed it", "Awesome", "Magic"; "Let's…" ("Let's get building"); "Coming soon"
(say what exists, or say nothing); "Welcome to Pro!".

**AI-template tics:** seamless(ly), effortless(ly), supercharge, unlock, dive
in, level up, game-changer, powerful, robust, "we've got you", "in seconds"
(unless measured), "all-in-one".

**Meta-honesty chatter:** honest / honestly, "real data", "no fake data", "we
never guess", "MAGE will not invent", "made-up", "not a guess". Show the source
instead.

**Developer-speak:** seat, lane, tenant, RLS, payload, hydrate / rehydrate,
schema, sync ledger, sync queue, offline queue, edge function, null,
undefined, NaN, sample guard, enum values with underscores, error codes such as
42501 or PGRST116, raw exception text, "Unknown error".

**Casing and punctuation:** all-lowercase labels, hard-coded ALL CAPS display
strings, Title Case next to sentence case, "..." for ellipsis, "item(s)",
"~20 seconds", two em dashes in one string, periods on buttons or titles.

**People:** he / his / him / she / her for any user, client, sub or crew
member.

**Filler:** "Please" in errors, "Simply", "Just", "Easily", "Click here",
"Note:", paragraphs longer than two sentences on a working screen (move them to
an info bubble or delete them).

## 12. Before and after, from the real app

| # | Where | Before | After |
|---|---|---|---|
| 1 | `app/onboarding.tsx:774` eyebrow | ● price from your numbers | Priced from your numbers |
| 2 | `app/onboarding.tsx:785` lede | MAGE learns your rates from every job you close — which means nothing to price with today. Paste what you already charge and your first estimate is built on your numbers, not a national average. | Paste what you charge today. Your first estimate uses your rates, and every project you close makes them sharper. |
| 3 | `app/(tabs)/(home)/index.tsx:1799` | Project Created! | Project created |
| 4 | `app/paywall.tsx:265` alert | Welcome to Pro! / You now have access to all Pro features. | You're on Pro / Every Pro feature is on for your account. |
| 5 | `app/onboarding-paywall.tsx:429` | Unlock every tool on the jobsite | Every tool for the jobsite |
| 6 | `app/compare-drawings.tsx:608` | Compare isn't available on your seat | Your role on this project can't compare drawings (body keeps naming the role that can and who to ask) |
| 7 | `app/time-tracking.tsx:291` | Clocking crew in on this job needs a field or editor seat. You have view access. | Clocking in crew needs Field or Editor access. You have view access. |
| 8 | `components/DesktopSidebar.tsx:133-192` | Daily Reports · Change Orders · Waiting on Others · section "THIS JOB" | Daily reports · Change orders · Waiting on others · section "This project" (uppercased by style) |
| 9 | `app/(tabs)/_layout.tsx` tab title | Your Projects (tab) / Projects (sidebar) | Projects, in both |
| 10 | `app/cash-flow.tsx:1321` | Analyzing... / Get AI Advice | Reading your invoices… / Get cash-flow advice |
| 11 | `components/AISubEvaluator.tsx:99` | AI Evaluate Sub | Evaluate this sub |
| 12 | `app/cost-xray.tsx:657` | Analyzing — this can take ~20 seconds… | Scanning photos. This takes about 20 seconds. |
| 13 | `app/estimate-wizard.tsx:755` | Estimate failed / `err.message` or "Unknown error." | `describeError(err, { action: 'generate the estimate', keptLocally: true })` → "Couldn't generate the estimate. Your answers are saved. Try again." |
| 14 | `app/schedule-import.tsx:273` toast | Imported 3 task(s) into the schedule. | Imported 3 tasks |
| 15 | `app/(tabs)/estimate/full.tsx:3482` | Bulk pricing applied! | Bulk pricing applied |
| 16 | `app/project-detail.tsx:3384` and 10 more sites | `displayStatus.replace(/_/g,' ').replace(/\b\w/g, …)` → "Pending Review" | Status label map → "Pending review" |
| 17 | `app/reports.tsx:672` chip | no cost basis | No cost basis |
| 18 | `app/wip-report.tsx:945-951` alert body (7 lines, ALL CAPS emphasis) | …AS THEY STAND TODAY… a trade or a machine with no rate on file adds nothing, because MAGE will not invent one. | Figures are as of today, labelled with this period end. Check cost to date on each project before you lock it. Trades or equipment with no rate on file count as $0 until you add one. |
| 19 | `app/crew.tsx:597` | Any attached ID is purged, and his certificate links go with him. To keep his certificates and history, mark him inactive instead. | Their ID and certificate links are deleted too. To keep their history, mark them inactive instead. |
| 20 | `supabase/functions/_shared/email.ts:946` subjects | 🏆 / 🎉 / 📦 "Your closeout binder is ready" | Closeout binder ready · Maple St remodel |
| 21 | `app/contract.tsx:1058` toast | Homeowner signature recorded | Client signature recorded |
| 22 | `app/(tabs)/discover/tools.tsx:178` | Suppliers (sample) / Sample catalog — made-up suppliers, not live vendors | Supplier catalog (demo) / Example listings. These suppliers are not real. |

## 13. Applying this guide without breaking the build

- **Validators pin some strings for a reason.** When a string you change is
  pinned, update the pin in the same change and keep the rule it protects.
  Known pins: `scripts/validate-glossary.ts` (asserts the term
  `'Change Order'`; update to `'Change order'` along with
  `constants/glossary.ts`), `validate-error-copy.ts`,
  `validate-ai-failure-copy.ts`, `validate-w5-paywall-copy.ts`,
  `validate-w5-push-unsub-copy.ts`, `validate-app-slop.ts`, and the `*-honesty`
  guards. The honesty substance stays: "Not checked" is never shown as zero, a
  blocked button still says why, AI still says to confirm with the building
  department, and drafts never claim to be sent.
- **Snapshots with text will change.** Copy-only golden deltas are expected.
  Do not blanket-update snapshots; review the diff and confirm the delta is
  copy only.
- **Change the words, not the styles.** A copy pass edits string literals and
  accessibility labels, never style blocks.
- **Code comments are not UI.** This guide governs what a person reads in the
  product. Comments can stay as they are.
