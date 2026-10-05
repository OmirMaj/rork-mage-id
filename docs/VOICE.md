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

## 3. Casing: Title Case on labels, sentence case on sentences

Founder decision, 2026-10-05: "the wording for things that are lower case dont
make the app look professional." This section replaces the earlier "sentence
case everywhere" rule. The study behind it is `design-previews/copy-style/`.

**The test that decides everything: is it a name or an action, or is it a
sentence?**

- A **label** names a thing or an action: a screen, a tab, a button, a section,
  a menu row, a tile, a chip, a field, a toggle, a status, an empty-state
  heading, an alert title. It is short and has no period. **Labels use Title
  Case.**
- A **sentence** tells you something: it has a subject and a verb, or it asks a
  question. Body text, helper text, error messages, toasts and confirmations
  are sentences. **Sentences use sentence case and end with a period or a
  question mark.**

**Why Title Case on labels.** iPhone's own apps write titles, buttons and
settings rows this way (Screen Time, Battery Health, Add to Home Screen), and
so do the contractor tools MAGE ID is compared against. A label either equals
its Title Case form or it does not, so a script can check it.

**Casing by role**

| Role | Rule | Example |
|---|---|---|
| Screen titles | Title Case | Your Projects, Choose Your Plan |
| Tabs and sidebar | Title Case, one or two words | Projects, Daily Reports, Cash Flow |
| Buttons | Title Case, verb first, one to four words | Send Invoice, Set Up Stripe, Sign Out |
| Section headers and eyebrows | Typed in Title Case. A small tracked header is drawn in ALL CAPS by its style. | typed "Estimate Defaults", drawn ESTIMATE DEFAULTS |
| Row, card and tile titles | Title Case | Waiting on Others, Get Paid in One Tap |
| Field labels and toggles | Title Case | Project Name, Sales Tax Rate, Auto-Name PDFs |
| Badges, chips, status words | Title Case when it is only words. Sentence case when it carries a number or a date. | In Review, Reconnect Required; "Overdue 3 days · was due Oct 2" |
| Empty-state title | Title Case | No Projects Yet |
| Alert title | Title Case when it is a fragment. Sentence case with a question mark when it is a question. | Invoice Not Sent; "Delete this change order?" |
| Alert buttons | Title Case | Delete and Sign Out, Not Now |
| Toasts | Sentence case, past tense, no period | Invoice #12 sent |
| Subtitles and helper text | Capital first letter. A fragment has no period. Full sentences end with periods. | "Overdue RFIs, submittals and sub confirmations" |
| Alert bodies, empty-state bodies, body copy | Full sentences, sentence case, period | "Your draft is saved. It sends when you're back online." |
| Placeholders | The example value itself. No "e.g.", no dash, no instruction. "(optional)" in parentheses if needed. | Kitchen Renovation; 2,400 (optional) |
| VoiceOver labels | The same words as the visible label, in Title Case. A longer description (one with a comma, a colon or a period) is a sentence. | Sign Out; "Ask MAGE, opens beside the page" |

**Title Case, exactly.** Capitalize the first word, the last word and every
word in between except: a, an, the, and, but, or, nor, for, so, yet, as, at,
by, in, of, on, per, to, vs, via, with, from, into.

- Capitalize in, on, up, out and off when they belong to the verb: Sign In,
  Set Up, Sign Out, Clock In, Fill In, Follow Up, Bring the Plan Up to Date.
- Capitalize both halves of a hyphenated word: Sign-In Link, Auto-Name PDFs,
  Pre-Priced Bids. A small word in the middle stays small: Day-to-Day.
- The first word after "(" or ":" starts again: Supplier Catalog (Demo),
  Bid Advisor (Take, Hold or Walk).
- Leave acronyms and names exactly as they are: RFI, G702/G703, T&M, MAGE ID,
  QuickBooks, iPhone.

The one function that implements this is `titleCase()` in
`scripts/copy-title-case.ts`. The guard and its `--fix-labels` mode both import
it.

**A label that is really a sentence stays a sentence.** "You can't edit this
project", "You're on Pro" and "Delete this change order?" keep sentence case.
The guard treats a string as a sentence when it opens with You, This, It, We,
There or That's, or ends in ".", "?", ":" or "…".

**Feature names are Title Case everywhere, including inside a sentence:**
Ask MAGE, Code Check, Inspection Ready, Cost X-Ray, Home Passport, Quick Quote,
Bid Advisor, Last Planner, Permit Path, MAGE ID Bids. One name per feature,
always written the same way.

**Industry documents are Title Case as labels and lowercase inside a
sentence.** The row says "Change Orders". The sentence says "3 change orders
are awaiting approval".

**Always capital, wherever they appear**

1. Proper nouns: people, companies, cities, streets, project names the user
   typed.
2. Our names: MAGE ID (the product and company), MAGE (the assistant).
3. Third-party names: QuickBooks, Xero, Stripe, Apple Pay, Google, OSHA.
   RevenueCat never appears in UI at all.
4. Acronyms and form numbers: RFI, CO, AIA, G702/G703, WIP, COI, T&M, JHA,
   OAC, PPE, SOV, GC, AHJ, PDF, CSV, W-9, 1099, TIN.
5. Subscription plan names: Free, Pro, Business, Enterprise.
6. Role names: Owner, Editor, Field, Viewer.

**Never start a standalone string with a lowercase letter.** The only
exception is a caption that finishes a number and reads as one phrase with it:
"$29 per month", "14 days left", "12 open".

**Never type ALL CAPS** for display, except an acronym or a legal form heading
(lien waivers). Eyebrows and section labels that look ALL CAPS are typed in
Title Case and uppercased by the text style (`textTransform: 'uppercase'`).
Never use caps for emphasis inside a sentence ("does NOT cancel"). If an
all-caps string is also a key, keep the key and print a separate label
(`components/DesktopSidebar.tsx` `SECTION_LABEL`).

## 4. Punctuation and formatting

- **No dash used as punctuation.** No em dash and no en dash anywhere a person
  reads, and no " - " standing in for one. Rewrite the sentence: two sentences,
  a comma, a colon, or the word that was missing ("and", "so", "to",
  "without"). The em dash gluing two half-sentences together is the single most
  recognizable sign of machine-written copy.
  - A lone "—" in an empty table cell stays. It means "no value".
  - An en dash stays in a compact number range: "Oct 5–12", "80–85%". A
    hyphenated range such as "3-5 days" is fine too.
- **"and", never "&".** "&" stays only in fixed terms (T&M, O&P, P&L) and in
  another organization's own name.
- **No "e.g." and no "i.e.".** Say "for example", or give the example on its
  own. A placeholder is the example value: "Kitchen Renovation".
- **No arrows in copy** (→, ←, ->). A step path uses ">": Settings > Apple ID >
  Subscriptions. A change uses "to": "PDF to LF and SF". A button that goes
  somewhere gets a chevron icon. Keyboard legends (↑ ↓ ↵) are the keys
  themselves and stay.
- **No exclamation marks.** Anywhere.
- **Periods on full sentences only.** Body text, descriptions and alert bodies
  end with a period. Titles, buttons, labels, chips, badges, tab names and
  one-line toasts do not.
- **Toasts** are one past-tense fragment with no period: "Invoice #12 sent",
  "Daily report saved". If a toast needs two sentences, punctuate both: "Saved
  offline. It sends when you're back online."
- **Middle dot (·) separates data fields**, three at most, never inside a
  sentence: "CO #3 · $1,200 · Approved". A fixed name is not two fields:
  G702/G703.
- **Ellipsis is the single character …**, only for work in progress, and it
  names the work: "Sending invoice…". Never "...".
- **Numbers are numerals:** "3 items", "2 days", "1 sub". Money, percentages
  and dates always go through the app's formatters (`formatMoney`,
  `formatCalendarDay`); never hand-format.
- **Real plurals.** "1 task", "3 tasks". Never "task(s)".
- **Words, not symbols.** "About 20 seconds", not "~20 seconds". "per month",
  not "/mo", in a label. "$600 or more", not "≥ $600".
- **Parentheses** only for "(optional)", a unit, or an acronym on first use.
- **Contractions are good:** can't, couldn't, isn't, you're. Use "cannot" only
  in legal text.
- **Quotes and apostrophes:** straight or curly are both acceptable in source;
  never mix the two on one screen.
- **No emoji** in UI, emails, subject lines, push notifications or PDFs.

**Honesty outranks style.** A style pass may change capitals and punctuation
and nothing else in these:

- Never "unlimited". Say the real limit (the numbers are in `app/paywall.tsx`
  `AI_LIMITS`, `utils/aiRateLimiter.ts` and `_shared/auth.ts` `MONTHLY_CAPS`),
  or describe the thing without a quantity: "More Than One Project", "On the
  Business plan you can keep bidding this month."
- "AIA-style", never bare "AIA" as if the forms were licensed. As a label:
  "AIA-Style G702/G703 Pay Apps".
- No accuracy or outcome promises. No bank or lender promises.
- The AI drafts and a person approves. A draft never claims to have been sent.

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

> **No Change Orders Yet**
> Change orders you create or a client requests show up here.
> [New Change Order]

- A filter that returns nothing is not an empty account: "Nothing matches these
  filters" + [Clear Filters].
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
`in_progress` → "In Progress", `pending_review` → "Pending Review",
`ready_for_review` → "Ready for Review", `revise_and_resubmit` → "Revise and
Resubmit", `net_30` → "Net 30". The pattern
`status.replace(/_/g, ' ').replace(/\b\w/g, …)` is banned: it capitalizes the
small words too ("Ready For Review"), and it prints whatever the database
holds.

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

**Casing and punctuation:** a label that is not in Title Case, all-lowercase
labels, hard-coded ALL CAPS display strings, "..." for ellipsis, "item(s)",
"~20 seconds", any em dash or en dash used as punctuation, " - " used as a
dash, "&" for "and", "e.g." and "i.e.", arrows, periods on buttons or titles.

**Claims:** "unlimited", bare "AIA" for a MAGE pay app, accuracy promises, bank
or lender promises.

**People:** he / his / him / she / her for any user, client, sub or crew
member.

**Filler:** "Please" in errors, "Simply", "Just", "Easily", "Click here",
"Note:", paragraphs longer than two sentences on a working screen (move them to
an info bubble or delete them).

## 12. Before and after, from the real app

Rows 1 to 22 are from the first copy pass (2026-09). Their "After" column is
written in that pass's sentence case; under section 3 a label among them is now
Title Case. Rows 23 on are from the Title Case pass (2026-10-05).

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
| 23 | `components/DesktopSidebar.tsx` | Daily reports · Change orders · Proposal & contract · Seed your rates | Daily Reports · Change Orders · Proposal and Contract · Add Your Rates |
| 24 | `app/(tabs)/(home)/index.tsx` empty state | Build something / Your first project is one tap away. Add it to start tracking estimates, daily reports, invoices — every job, every detail. | No Projects Yet / Add your first project to track its estimates, daily reports and invoices. |
| 25 | `app/(tabs)/(home)/index.tsx` placeholder | e.g. 2400 — leave blank if you don't know yet | 2,400 (optional) |
| 26 | `app/(tabs)/settings/index.tsx` row | Push & email preferences | Push and Email Preferences |
| 27 | `app/(tabs)/settings/index.tsx` FAQ | cancel it first in Settings → Apple ID → Subscriptions. Deleting your account does NOT cancel your subscription. | cancel it first in Settings > Apple ID > Subscriptions. Deleting your account does not cancel your subscription. |
| 28 | `app/paywall.tsx` row | Unlimited projects | More Than One Project |
| 29 | `app/paywall.tsx` row | AI takeoff (PDF → LF/SF) | AI Takeoff (PDF to LF and SF) |
| 30 | `app/paywall.tsx` row | Photo analyses /mo | Photo Analyses per Month |
| 31 | `app/login.tsx` | Check your inbox — we just sent a sign-in link to… | Check your inbox. We sent a sign-in link to… |
| 32 | `app/login.tsx` button | Email me a sign-in link | Email Me a Sign-In Link |

## 13. Applying this guide without breaking the build

- **Validators pin some strings for a reason.** When a string you change is
  pinned, update the pin in the same change and keep the rule it protects.
  Known pins: `scripts/validate-glossary.ts`, `validate-error-copy.ts`,
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
- **The guard is `scripts/validate-copy-voice.ts`** (`bun run test:copy-voice`).
  It has two halves. The ratchet (rules R01 to R14 and R16 to R19) counts each
  tell per file against `scripts/copy-voice-baseline.json` and never lets a
  count rise. The copy style (R15 label case, R20 no dash as punctuation, R21
  "and" not "&", R22 no "e.g." / "i.e.", R23 no arrows) is strict: zero hits,
  no baseline, enforced on the files in `scripts/copy-style-converted.json`.
  R24 (never "unlimited") is strict in every file under `app/`, `components/`,
  `hooks/`, `contexts/`, `utils/` and `constants/`.
- **Converting more files.** Add them to `scripts/copy-style-converted.json`
  and raise `CONVERTED_PINNED` in the guard in the same change. The list may
  only grow. `bun scripts/validate-copy-voice.ts --strict-preview <path>` lists
  what a file would fail before it is on the list, `--fix-labels` rewrites the
  R15 hits of every listed file with `titleCase()`, and `--dump <path>` prints
  every string the guard reads. Read the diff after `--fix-labels`: a script
  cannot tell a label from a short sentence. What is still to convert is in
  `docs/copy-style-remaining.md`.
- **Spanish stays in sentence case.** That is correct Spanish. When an English
  string changes, regenerate its shard (`bun run i18n:extract`), re-read the
  Spanish entry, and set its `src` to the new hash that `bun run test:i18n`
  prints. Translate again when the meaning changed (a dash rewrite), not when
  only the capitals did.
