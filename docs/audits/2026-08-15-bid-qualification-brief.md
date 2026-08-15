# Bid qualification — brief for the next session

_Founder's idea, 2026-08-15. Not yet brainstormed. Start here._

## The idea, in the founder's words

> "The bids here isn't great — it's not gonna help most people because you cannot
> customise what bids you would be able to do. I wanted it to be an app where if
> I clicked on a bid that's posted online, you can click in the app to see if you
> qualify based on your company."

## Why this is stronger than it first sounds

**MAGE ID already holds both halves of the question, and no competitor holds both.**

Answering *"can I bid this?"* requires: license class and status · COI limits and
expiry · bonding capacity · prequal history · trade fit · geography · current
crew capacity.

The product has or is adjacent to all of it:
- `contractor_licenses` — a table that EXISTS in production (currently orphaned;
  see `2026-08-15-where-mageid-could-lead.md` and the orphaned-tables
  investigation). This is the strongest argument for BUILD on that table.
- COI vault — carrier limits and expiry
- Prequal packets — already modelled, with a status lifecycle
- **Bonding capacity** — falls out of the cost book as a byproduct (Opportunity 3
  in the market research: the WIP schedule is the first document a surety pulls)
- Schedule / crew — capacity to take the work

A bid board has the solicitation but not the company. Procore and Buildertrend
have some company data but no measured cost history and no bid feed.
**MAGE ID can have both sides.**

## It inverts the model that's failing

Lead-gen sells contractors MORE bids. Angi/HomeAdvisor economics have collapsed
doing exactly that (FTC $7.2M order in 2023 for misrepresenting lead quality;
contractors reporting single-digit net margins on platform work).

This sells FEWER: it tells a contractor which solicitations they would waste a
week losing. That is the opposite of what the industry does, and it is a thing
contractors would thank you for rather than resent.

It also pairs with the measured cost book: "you qualify, AND here is what your
own history says this scope costs you" is an answer nobody else can assemble.

## The hard part is ingestion, not matching

The matching logic is a rules engine over structured company data — genuinely
tractable. **Getting the bid in is the real work.** Public solicitations live
across county portals, state procurement sites, Dodge, BidClerk, plan rooms, and
PDF attachments, with no common schema.

Scope this carefully before building. Plausible ladder, cheapest first:
1. **Paste a URL or a PDF** → parse the solicitation → qualify. No feed to
   maintain, works day one, and proves the matching is valuable before any
   ingestion investment.
2. Share-sheet from a browser on iOS (matches how a GC actually finds these).
3. Feeds/integrations only if 1-2 prove demand.

## DECISIONS MADE (brainstorm session 1, 2026-08-15)

Three of the five open questions are settled. Resume the brainstorm from here.

### 1. Scope — BOTH public solicitations and private invitations, one engine

One qualification engine, two feeds. **But they decompose, and the build order
matters:**

- **Private invitations first.** MAGE ID already owns this data — bid packages,
  prequal packets, subcontractor records. **Zero ingestion problem.** Prove the
  engine here.
- **Public solicitations second.** County portals, state procurement, plan
  rooms, PDFs — no common schema. This is the hard, expensive half, and the
  investment should follow evidence that the engine is valuable, not precede it.

Two specs. The engine + private feed is the first one.

### 2. Output — a GAP LIST, not a verdict

Not yes/no. A checklist:

```
✓ GC license class B — current
✓ GL $2M / $4M — meets the $1M/$2M minimum
✗ Bond capacity $2M short of the $5M requirement
✗ COI expires 2026-10-02, before the 2026-11-15 close
```

Every ✗ becomes an actionable to-do inside the app. This makes the feature a
**coach rather than a gate** — a bare "no" gives the contractor nothing and they
stop opening it. A gap list turns a rejection into a path forward, and that is
also what brings them back.

### 3. Profile — UPLOAD DOCUMENTS, AI EXTRACTS

Snap or upload the license, the COI, the bond letter; AI reads class, limits,
expiry and capacity, and fills the profile.

Chosen over a manual form because it matches how contractors actually hold this
(a PDF from their agent), because the documents are needed as bid attachments
anyway, and because parsing the expiry sets up renewal reminders for free.

**The gap this exposes:** MAGE ID's existing COI vault and prequal packets are
about **SUBS**, not about the GC themselves. The COI vault stores subcontractor
certificates; prequal packets are what the GC *sends* to subs. So the
contractor's OWN qualification profile does not really exist yet — and
`contractor_licenses` (orphaned, no CREATE TABLE anywhere in git) is the closest
thing. See `2026-08-15-orphaned-tables.md`: this decision promotes that table
from KEEP-DORMANT to load-bearing, and its schema must be recorded first.

## Questions still open

- Within the gap list, which checks are HARD blockers (no license class, bond
  too small — you literally cannot bid) versus SOFT signals (never done this
  trade, site is 3h away)? The rendering should differ.
- Which persona owns the surface? This is arguably the **Expeditor** — a
  documented persona with NO surface in the app today.
- Does the answer get better with the cost book (win-rate history by bid type)?
  That would make it compound, which is the moat pattern that matters.
- Public/government work only, or private invitations too?

## Related open threads

- `docs/audits/2026-08-15-where-mageid-could-lead.md` — the market research;
  Opportunity 3 (bonding readiness) feeds directly into this
- The orphaned-tables investigation — `contractor_licenses` is a dependency here
- Migration/switching: the other founder idea from the same conversation. The
  thing worth importing is **cost history** (from QuickBooks, invoices,
  spreadsheets), not projects — Buildertrend's ToS makes export "subject to
  applicable fees" and blocks it anyway. Everything imported must land as
  `STATED`, never `MEASURED`.
