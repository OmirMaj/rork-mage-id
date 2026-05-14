# MAGE ID — P4 expanded feature ideas

Date: 2026-05-14
Status: ideas backlog (not a commit list)
Author: pre-TestFlight strategic survey, follow-up to 2026-05-14-features-audit.md

## Why this doc exists

The Tier A / B / C lists in `2026-05-14-features-audit.md` cover the
**competitive-parity** play — what JobTread / Houzz Pro / Buildertrend
already do that we don't. Shipping all of Tier A closes the visible gap.

But the audit asked one more question — *"is this really all you can find?"*
This doc is the honest answer. It's an **ideas backlog**, not a roadmap.
Some of these are small enough to ship in a day. Some are 6-month
strategic bets. None of them are ranked here. The point is to make the
total surface of "things MAGE ID could plausibly do" visible so we can
decide what *not* to build with confidence.

Categories below are themed. Each idea is one line — name + the
one-sentence reason it'd matter + a rough effort estimate ([S]/[M]/[L]).
Effort is calibrated to "a solo engineer who knows this codebase":

- **[S]** ≤ 1 day
- **[M]** 1-3 days
- **[L]** ≥ 1 week

---

## 1. Marketing & lead generation

GCs constantly need leads. Knowify and Buildertrend treat lead gen as a
"connect HubSpot" afterthought. There's headroom for an opinionated, GC-specific
lead funnel built into the same app where the work happens.

1. **Public profile pages with photo timelines** [M] — `mageid.app/c/<slug>` showing the GC's company, recent project photos, completed-project counters, and a "request a quote" form. Auto-built from already-stored data.
2. **"Featured project" PDF/social-media generator** [S] — pick 3 photos + scope summary, get back a 1-pager PDF and a 1080x1350 IG carousel image. Marketing-grade output in 90 seconds.
3. **Google Business Profile auto-poster** [M] — every closed-out project becomes a GBP post with photos and location. Single biggest local-SEO move most GCs aren't doing.
4. **Yelp / Houzz / Angi review request automation** [S] — on close-out, prompt for review on the 1 platform the customer prefers. Gentle, single-link, mobile-friendly.
5. **Lead scoring from estimate request** [M] — when a lead fills the form, score "likelihood to close" from project size + zip + scope keywords. Helps small GCs prioritize callbacks.
6. **Referral tracking** [S] — "who sent you?" question on the request-quote form; pay-out tracking + thank-you note generation.
7. **Lost-bid auto-followup** [S] — 4 weeks after losing a bid, send a "checking in, here's a project we just finished nearby" email.
8. **Project sign / yard sign QR generator** [S] — printable lawn-sign artwork with project name + QR → photo timeline. Free signage that doubles as a marketing site.
9. **Neighborhood prospecting** [M] — given a current project's address, surface comparable homes within a 0.5mi radius and generate a "we're working nearby" intro letter.
10. **Door-knock script generator (AI)** [S] — context-aware talk track for the GC's apprentice to knock the 5 neighbors of an active jobsite.

## 2. Smart notifications & communication

Construction notifications are spammy or silent — never tuned. There's
high leverage in making the app *quieter* than competitors, not louder.

11. **Quiet-hours auto-batching** [S] — between 6pm and 7am, batch all notifications into a single 7am digest. Sub texts still through.
12. **Per-stakeholder channel routing** [M] — homeowner gets photo + invoice push; architect gets RFI + submittal email; sub gets schedule SMS. Configured once per role.
13. **Smart escalation** [M] — if an RFI is unanswered after 48h, auto-escalate to the architect's PM with the original GC's note appended.
14. **In-app focus mode** [S] — "I'm framing today, only ping me for safety issues / urgent client texts." Mutes the rest until 4pm.
15. **Voice-note transcription + threading** [M] — record a voice note on a daily report, transcribe it to text, route it to the right project channel.
16. **Two-way SMS bridge** [L] — clients/subs reply to notifications via plain SMS without leaving Messages.app; replies thread into the right project conversation.
17. **WhatsApp portal channel** [M] — homeowner-facing portal mirrored into a WhatsApp business chat for trades who live there.
18. **End-of-day automatic recap email to the homeowner** [S] — "Today we did: framing on the north wall, found one sister-joist; tomorrow: electrical rough-in." Photos auto-attached.
19. **Pre-meeting prep brief** [M] — 30 min before any calendar meeting tagged to a project, AI generates a "what's open / what's changed / what to ask about" brief.
20. **Read receipts on critical items only** [S] — see when the architect actually opened the RFI, not on every casual message.

## 3. Crew safety & field ops

Construction has the most-injured workforce per capita in the US.
Modern OSHA + private safety reporting is still mostly clipboard +
plywood signs. Real moat here.

21. **Toolbox-talk library + sign-off** [M] — pick from 60 OSHA-aligned 5-min talks, hand the phone around, fingerprint sign-off, archived.
22. **Near-miss reporting** [S] — single-tap "near miss happened" with photo + 30s voice note. Builds the file the GC needs when OSHA shows up.
23. **JHA (job-hazard analysis) per task** [M] — when a sub starts a task on the schedule, prompt them with the JHA for that task type (e.g. excavation, hot work).
24. **Heat-stress alert** [S] — at temp + humidity thresholds, push everyone on the active project a hydration / break reminder.
25. **Daily site safety photo + AI flag** [M] — 1 shot of the gangway / fall protection / scaffolding, AI flags obvious red flags (missing rails, debris on stair).
26. **Subcontractor PPE compliance log** [S] — checkbox per crew per day. Defensible if a sub injures themselves and claims it was the GC's fault.
27. **Emergency action plan generator per site** [M] — given site address, generate the EAP with nearest hospital + EMS routes + assembly point map. Pin to portal.
28. **Hot-work permit issuance** [S] — issue + log a hot-work permit from the app, including the required fire-watch sign-off.
29. **Confined-space entry log** [M] — atmospheric reading entry + entrant/attendant log + emergency-retrieval plan. Niche but solves a real problem for GCs doing commercial work.
30. **Lockout/Tagout (LOTO) checklist** [S] — sign off energy-isolated equipment per OSHA 1910.147.

## 4. Material management

GCs lose 5-10% to material waste, theft, and over-ordering. The
estimate gives the BOM — the operations side has zero feedback loop
back to it.

31. **Receiving / delivery sign-off** [S] — driver shows up, foreman scans the PO QR, marks delivered + photos the dropped-off pallet.
32. **Back-order tracker** [S] — when a PO line is partially delivered, surface the gap with auto-followup to the supplier.
33. **As-built BOM vs. estimate variance report** [M] — when the job closes, compare actual material used to estimate, output a "next-bid adjustment factors" sheet.
34. **Material-theft daily lockup checklist** [S] — site-secure photos + tag count of high-value items (copper, tools) every Friday afternoon.
35. **Returns / RMA tracker** [S] — over-ordered tile, returned 4 boxes — keep the credit memo + supplier-side return reference attached to the PO.
36. **Lien-waiver auto-generation from PO** [M] — generate conditional/unconditional lien waivers tied to a PO at the right milestones; sub e-signs.
37. **Just-in-time delivery scheduler** [M] — given the schedule, propose delivery windows per material so the site isn't a 6-week boneyard.
38. **Material-substitution capture** [S] — sub showed up with PEX instead of copper — log it, photo, get GC approval, append to as-built.
39. **Take-back / leftover marketplace** [L] — internal company-wide pool: "we have 14 LF of leftover Schluter trim, who needs it?" Bigger GCs save real money here.
40. **Supplier scorecard** [S] — auto-roll-up of supplier on-time %, short-ship %, return rate. Surfaced when picking a supplier for the next PO.

## 5. Sub management deep

We have COIs, change orders, and sub portal. Below the surface there's
a real "sub-CRM" opportunity.

41. **Sub performance scorecard** [S] — on-time start %, callback rate, cleanliness rating, GC-tagged. Used to filter the sub picker.
42. **Sub onboarding flow** [M] — one-time portal where a new sub uploads W9 + COI + bank info, agrees to backcharge terms, signs MSA. GC gets a "ready to work" status badge.
43. **Sub-bid recall** [S] — "you bid $5,200 on tile last June" — surfaces when GC opens estimate-wizard for similar scope.
44. **Sub callback hot-list** [S] — when a punch item is assigned back to a sub, surface in a Friday-PM list so it doesn't slip.
45. **Sub geofenced clock-in** [M] — sub's foreman clocks in / out by entering the site. Required for prevailing-wage projects.
46. **Per-sub backcharge ledger** [S] — running tally of damages, cleanup, mistakes charged back, attached to next pay app.
47. **1099 year-end packet** [S] — once-a-year, generate per-sub 1099-NEC ready PDFs from year's paid invoices.
48. **Sub-pay schedule + ACH initiation** [L] — schedule sub payments to align with owner pay apps; ACH (or Stripe issuing) from the app.
49. **Sub-license expiry watcher** [S] — like COI watcher but for state contractor license and trade-specific licenses (electrical, plumbing).
50. **Crew-mix tracker** [M] — record union/non-union, residency status (for prevailing-wage compliance), apprentice ratio. Bid pre-qual ready.

## 6. Insurance & bonding

We've nailed COI expiry. The deeper sell is **getting the GC's own
business insured / bonded better.**

51. **Annual policy renewal coordinator** [S] — 60-day countdown to each policy renewal with quote-shopping checklist.
52. **Builders-risk quote shopping** [M] — given a project address + construction value, pull 2-3 carrier quotes via an embedded broker (rev-share).
53. **Performance & payment bond facilitation** [L] — embedded surety partnership; on a $250K+ public-works project, "get a bond" is one tap.
54. **Workers-comp audit prep packet** [S] — pre-fills the auditor's spreadsheet from year's paid sub/employee data.
55. **Premium-audit dispute helper** [S] — when WC carrier's audit comes in $X over estimate, AI drafts the dispute letter with the supporting payroll detail.
56. **Claim-evidence kit** [M] — when an incident is logged, instantly bundle photos + witness statements + safety log + COI into a 1-PDF claim packet.

## 7. Permitting & code compliance

Permit clerks are the unsung gatekeeper of small-business construction.

57. **AHJ-specific permit checklist** [M] — given the address + scope, generate the doc list (plans, structural calc, energy compliance, etc.) required by that AHJ.
58. **Permit fee estimator** [S] — predict fees from scope + valuation per local AHJ schedule, line-item it into the estimate.
59. **Code-section AI lookup** [S] — type "egress window basement" → cite IRC R310.2 + the AHJ's amendments. Cite verifiable, no hallucination.
60. **Inspection scheduling automation** [M] — book inspections via the AHJ portal where APIs exist (Honolulu, Austin, Denver, others), email-template-driven elsewhere.
61. **Pass/fail inspection log + AI prep** [S] — before inspector arrives, AI gives the GC a 5-bullet "check these first" list based on the type of inspection.
62. **Energy / HERS / Title 24 compliance packet generator** [L] — niche but in CA / WA / NY, this is a real time-suck on every job.

## 8. Bidding & estimation refinements

Assemblies are Tier A. Below are higher-effort but bigger-leverage moves.

63. **Historical unit-cost calibrator** [M] — on close-out, look at actual unit costs vs. the estimate; auto-tune the GC's per-line "cost factors" for the next bid. Compounds into a real moat over 10 jobs.
64. **Estimate confidence score** [S] — for each line, surface "we've done this 14 times, this estimate is ±5%" vs. "first time you've bid this — be careful."
65. **Side-by-side bid comparison** [M] — when the GC has bids from 3 different subs, lay them out next to each other, highlight outliers and missing scope.
66. **Estimate-to-pay-app continuity** [L] — every line item in the estimate maps to a SOV line in the AIA pay app, with cost-loaded values that flow on close-out.
67. **AI scope-of-work writer from estimate** [S] — given the line items, draft the homeowner-readable scope of work for the contract.
68. **AI exclusions/inclusions library** [S] — keep the GC's preferred contract-exclusion list and surface relevant ones based on scope (e.g. mold remediation auto-excluded for old basements).
69. **Soft-cost line items** [S] — preset bundles for builder's risk insurance prorated, dumpsters, port-a-potty, supervision %, contingency %.
70. **Allowance burn-down dashboard** [M] — homeowner's tile allowance is $4,500 — when they pick $7,800 worth at the showroom, the GC sees the variance in real time and pushes a CO.

## 9. Operations & scheduling

71. **Crew workload heatmap** [M] — across all projects, see when a sub is double-booked weeks ahead. Resource conflict avoidance.
72. **Weather-aware schedule reshuffling** [M] — given the 10-day forecast, suggest moving concrete pours / roofing days to a clear window.
73. **Lookahead-3-week schedule auto-generator** [S] — Friday afternoon, AI generates the 3-week lookahead for distribution to subs and owner.
74. **Daily/weekly forecast (cashflow + crew + materials)** [M] — Monday-morning briefing: "this week you'll pay subs $X, you're owed $Y by Thursday, here are the 3 bottleneck materials to confirm by Wednesday."
75. **Punch-list aging dashboard** [S] — surface punch items > 14 days old per sub, with auto-followup.
76. **Project closeout countdown** [S] — visible 30-60-90-day-to-substantial-completion ticker on the project tile with the open critical-path items.

## 10. Tax & accounting

77. **Mileage tracking** [M] — auto-track miles between projects via background GPS or manual log; export per-project for job-cost or quarterly tax estimate.
78. **Sales-tax matrix per AHJ** [M] — materials taxable in NY, services taxable in WA, etc. Auto-fills the right sales tax on invoices.
79. **WIP (work-in-progress) report** [L] — over/underbilling per project per period for the GC's CPA. The single biggest reason small GCs lose their banker's confidence.
80. **Tax-deduction capture** [S] — photo a receipt, AI tags it (fuel, meals, materials, tools), exports a Schedule C / 8829 ready spreadsheet at year-end.

## 11. Novel AI features (beyond what we have today)

We already have: AI estimate from a sentence, vision analysis, daily-report summarization, RFI assistant, multilingual portal translation.

81. **Memory across projects** [L] — vector-store every project's transcripts, RFIs, daily reports, change-order rationales. Ask "how do we usually handle stuck plumbing rough-ins on remodels?" and get the GC's own institutional knowledge back. Outlined in main features audit as "Project Memory" innovation moat.
82. **AI standup host** [M] — voice-driven 90-second morning standup over the phone; the AI asks "what'd you finish, what's next, any blockers?" and routes the answers into daily reports + risk register.
83. **Drawing-set delta detective** [M] — when arch issues plan-set rev 3, AI surfaces the 12 changes vs. rev 2 with cost impact + RFI suggestions.
84. **Submittal auto-prep** [M] — given an estimate line "Sherwin-Williams ProClassic, Snowbound semi-gloss," AI fetches the spec sheet + composes the submittal package.
85. **Code-compliance pre-flight** [M] — AI reads the drawings, calls out probable code issues (no foundation drains in flood zone, undersized rebar, etc.) before submission.
86. **Specification interpreter** [S] — homeowner-facing "what does Schluter DITRA-HEAT do?" plain-English answers, optionally translated.
87. **Negotiation coach** [M] — when a sub's bid comes in 40% over budget, AI suggests which line items to push back on with talking points.
88. **Closeout narrative writer** [S] — given all the photos + reports + COs, draft the project-history narrative for the homeowner's records + the GC's portfolio.
89. **Litigation-risk early warning** [M] — pattern-recognize "this is becoming a problem client" from message tone, payment delays, and CO refusal. Flag for a sit-down before it becomes a lien.
90. **Daily AI digest tuned per role** [S] — owner gets a different digest than the PM than the GC's bookkeeper. Same data, three lenses.

## 12. Hardware & IoT integration

GC-grade hardware is exploding (Hilti tool tracking, Procore IoT cameras, Site1001). Almost no small-GC software talks to it.

91. **Time-clock terminal mode** [S] — left an old iPad at the trailer, pin it as kiosk for clock-in/out. Maps to existing time-tracking.
92. **Hilti / Milwaukee / DeWalt tool ID scan** [M] — scan a tool barcode → log who took it, when. Reduces tool theft (real $5-10k/year for medium GCs).
93. **Bluetooth crew tag check-in** [L] — like an Apple AirTag for hard hats; auto-clocks the crew in when on-site.
94. **Smart-jobsite door lock provisioning** [M] — issue / revoke August / Lockly / Yale codes to subs via the app, tied to schedule windows.
95. **Drone progress capture import** [M] — drop a DJI flight folder, AI tags by location/date, auto-builds the chronological photo timeline.
96. **3D matterport / scan integration** [L] — embed Matterport scans as the "before" and "after" in the closeout packet.
97. **Project camera live feed** [M] — embed a Sense / Soiltech / EarthCam stream into the portal for the homeowner.
98. **Weather station / dust meter ingestion** [L] — for commercial GCs, ingest on-site sensor data into the daily report.

## 13. Mobile-specific (iOS-deep)

We targeted iOS-first per CLAUDE.md. Lean into it.

99. **Apple Watch complications** [S] — "today's labor cost vs. budget" / "open punch items" complication. Tap → open the project.
100. **Siri shortcuts** [S] — "Hey Siri, log a daily report for Maple St" → opens dictation flow pre-routed.
101. **CarPlay daily-recap audio playback** [M] — drive home from the jobsite, the day's daily reports play back. Hands-free + delivers ROI immediately.
102. **iOS Live Activities (Dynamic Island)** [M] — schedule today is showing on the iPhone lock screen; CO awaiting signature pings via Live Activity.
103. **iOS Focus filter** [S] — "Work" Focus only allows MAGE ID notifications; rest are silenced.
104. **iOS share-sheet target** [S] — share a photo from Photos / Messages directly into a project's gallery.
105. **iCloud Drive backup folder** [M] — opt-in mirror of project photos + PDFs into iCloud Drive for the GC's own off-platform backup.
106. **Files.app provider** [L] — appear in iOS Files.app as a folder per project. Lets the GC's accountant open MAGE PDFs from Numbers/Word.

## 14. Owner-focused (homeowner-side)

The client portal is in place. There's a lot more we can do on the
*homeowner's* problem, not just on showing them progress.

107. **Owner's manual / closeout binder** [M] — at closeout, generate a homeowner-facing PDF + web binder with appliance manuals, paint colors, finish brands, behind-the-wall photos, warranty terms. Reused for resale.
108. **Resale-ready disclosure packet** [S] — 7 years later, the owner can pull a renovation-disclosure packet for their realtor.
109. **Maintenance reminder schedule** [S] — quarterly reminders to drain the water heater, change HVAC filter, reseal grout. Auto-scheduled per house from the closeout.
110. **Owner-side budget tracker** [M] — homeowner sees committed-to-date / spent / remaining contingency in a digestible way (their accountant view).
111. **Selection-portal for finishes** [M] — homeowner clicks through tile / paint / fixture options, locks-in selections by deadline, GC sees ready-to-order in real time.
112. **Owner referral kit at closeout** [S] — "love your project? here's a sharable photo set + a referral code."
113. **Owner mortgage / draw-loan integration** [L] — fold draw-loan disbursements into the project's cash-flow view.
114. **Behind-the-walls photo archive permalink** [S] — never-expiring private gallery of "what was behind your drywall" so 10 years later the homeowner can find a stud.

## 15. Field-specific quality of life

115. **Sketch-on-photo with measurements** [S] — drag a calibrated reference line, then annotate distances on a photo. Faster than pulling out the laser.
116. **Punch-list bulk-mode** [S] — walk the house, tap-tap-tap on photos for each defect; AI auto-groups by room / trade afterwards.
117. **Voice-to-RFI dictation** [S] — hold mic, describe the question + photo the issue, AI drafts the RFI.
118. **Stamped photos with markup baked in** [S] — exported photos burn-in date/time/GPS/project name so they survive on legal evidence.
119. **Offline-first plan viewer** [M] — when the GC's iPad has no cell signal in a foundation pit, they can still scroll the structural sheets.
120. **Plan-sheet pin map** [M] — open the floor plan, pin issues / RFIs / photos to xy on the sheet.

## 16. Office-specific quality of life

121. **Quickbooks-Online job-cost sync** [L] — flagged in Tier B; deepest single feature ROI on the office side. Worth its own track.
122. **Xero sync** [M] — same as QBO but smaller market — important in AU/NZ/UK.
123. **DocuSign / Adobe Sign / Dropbox Sign embedded signing** [M] — pay-apps + COs + contracts sign in-app instead of "downloaded PDF → opened other app → mailed back."
124. **Bank-rec for the deposit** [M] — when the homeowner Zelles the deposit, match it to the project's expected deposit, auto-mark the invoice paid.
125. **Stripe Atlas / LLC formation referral** [S] — for the GC's apprentice spinning up their own LLC, embed an Atlas referral. Tiny rev share, big trust signal.
126. **Audit trail export (immutable log)** [S] — append-only ledger of every state change. Required for some commercial / public-works contracts.

## 17. Reports & analytics deeper

127. **Profitability cohort over time** [M] — show "your kitchens are 22% gross margin, your basements are 11%" by tag. Most GCs cannot see this and lose tons of money to it.
128. **Per-trade callback rate** [S] — over the last 24 months, which subs generated the most warranty callbacks?
129. **Bid-win rate by lead source** [S] — referrals win 60%, Yelp leads win 8%. Stop spending on Yelp.
130. **Cycle-time per project type** [M] — "your bathroom remodels average 41 working days." Sales tool when the homeowner asks "how long will this take?"
131. **Yearly business review packet** [S] — Dec 31 auto-generates a 1-pager with revenue, gross margin, top 3 wins, top 3 losses, suggested 3 changes for next year.
132. **Benchmarks vs. anonymized peers** [L] — opt-in: see "GCs your size in your market are at 14% net margin; you're at 9%." Network-effect moat.

## 18. Trust & legitimacy

133. **Verified COI / license badge on profile** [S] — the public profile page shows a "verified by MAGE ID" badge from our COI watcher + license-expiry watcher.
134. **Public sample portal** [S] — let prospective clients see a watered-down demo of "what the portal will look like for you." Reduces "what am I buying?" friction.
135. **BBB / Angi / state-license auto-import on signup** [M] — paste your license number, AI pulls your public record + creates a verified profile.
136. **Trust score / reviews aggregate** [M] — pull external reviews (Yelp, Google, Houzz) into a single rolled-up rating shown on the public profile.

## 19. Recurring & maintenance contracts

A surprising amount of GC revenue is service/maintenance — and the GC's
existing tools (job-centric) suck at it.

137. **Maintenance contract template** [M] — annual termite, gutter cleaning, snowblower tune-up. Recurring schedule + recurring invoice.
138. **Service-call dispatch board** [M] — small-job board (mostly punchlist + service) separate from project board.
139. **Customer asset register** [S] — once installed, "the Lennox 3-ton heat pump at 142 Maple St" is a permanent asset record we can reference for the next service call.

## 20. Quote / proposal / sales

140. **AI proposal generator** [M] — given the estimate, generate a polished, branded, homeowner-friendly proposal PDF with photos + scope + price + assumptions + payment schedule.
141. **Interactive proposal (web link)** [L] — homeowner clicks through proposal in a browser; can comment, accept/decline alternates, e-sign at the end. Conversion-rate beast.
142. **Per-line proposal alternates** [M] — "tile bathroom for $14k OR LVP bathroom for $9k" — homeowner picks → estimate auto-updates.
143. **Proposal versioning** [S] — v1, v2, v3 — see the full history of what changed and why.
144. **Win/loss reason tagging** [S] — on close, tag why we won (price, timing, fit, referral) or lost (price, scope-too-big, owner ghosted). Feeds the bid-win-rate report above.
145. **Auto-followup sequence on open proposals** [S] — D+2, D+5, D+10 polite nudges; stop on "we picked someone else."

## 21. Multi-project / multi-company stretch

146. **Multi-company / GC-as-platform** [L] — let a small GC invite their PM, foreman, bookkeeper with role-based access. We already have role infra (`useTierAccess`) — productize it.
147. **Cross-project search** [S] — "find the photo of that weird P-trap from the Maple St project" — full-text search across all projects' notes + transcribed voice notes.
148. **Project portfolio rollup view** [M] — for a GC with 12 active projects, a single Kanban + cashflow view across all of them.
149. **Inter-project material transfer** [S] — leftover 2x4s from job A → log as transfer to job B with cost-shift.
150. **Company-wide KPI dashboard** [M] — for a 3-5-person GC office, surface this week's billings, this month's pipeline, oldest A/R per project.

## 22. Curiosities / experimental

The "moonshot" list. Most won't ship; one or two might define the next 2 years.

151. **Owner mortgage-payoff tracker** [L] — for renovation loans, show owner real-time loan balance + interest cost + projected total. Adjacent to draw-loan.
152. **Project-NFT closeout certificate** [L] — half-joking, but a verifiable signed digital record of the work done would be a real trust artifact. Skip the blockchain hype, do it as a signed PDF + verification URL.
153. **AR site overlay** [L] — point iPhone at a wall, see the plumbing rough-in behind it from the photo archive. (LiDAR + ARKit is getting there.)
154. **Voice-cloning project recap to homeowner** [L] — homeowner gets a 90-second daily voice message in *the GC's own voice* (consent-gated) summarizing today. Wildly differentiating, slightly creepy — needs careful UX.
155. **AI-generated finalized contract** [M] — from estimate + selections + assumptions + state, draft the full AIA A105-style contract for the homeowner.
156. **Materials-price futures hedging** [L] — for big jobs, lock in lumber / copper prices via a partner. Real cost savings on 6-month projects in volatile markets.
157. **Embedded factoring marketplace** [L] — submit an unpaid invoice, get same-day factoring offers from 3 partner firms.

---

## How to actually use this list

1. **Don't ship more than 1 quarter's worth at a time.** Scope discipline beats feature velocity.
2. **Tag ideas by audit dimension** before promoting them out of P4: does this close a competitive gap (parity), expand the moat (innovation), or grow the market (lead-gen)?
3. **Re-survey customers between Tier A and Tier B.** What you'd guess they want and what they ask for after first TestFlight will rarely match.
4. **Kill ideas without ceremony.** If, after 30 days in TestFlight, no customer has asked for an item on this list, mark it Won't Do and move on. The point of the list is to *see* the space, not to *fill* the space.

If two items on this list look like the same idea expressed twice — that's intentional. Adjacent framings of the same opportunity make it easier to figure out what the real underlying job-to-be-done is.

End of doc.
