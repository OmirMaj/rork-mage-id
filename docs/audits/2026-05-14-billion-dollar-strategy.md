# MAGE ID — billion-dollar strategy audit

Date: 2026-05-14
Status: strategic synthesis, not a commit list
Sources: 4 parallel research agents — market sizing, embedded fintech, network effects, expansion + distribution
Companion docs:
- [2026-05-14-features-audit.md](2026-05-14-features-audit.md) — competitive feature matrix
- [2026-05-14-p4-feature-ideas-expanded.md](2026-05-14-p4-feature-ideas-expanded.md) — 157 feature ideas

---

## 0. The honest answer up front

**A $1B outcome is plausible, not probable.** Independent research across four
dimensions converges on the same realistic probability distribution from
where MAGE ID stands today (pre-TestFlight, solo founder, no funding):

| Outcome | Probability | What it looks like |
|---|---|---|
| Plateau under $5M ARR; tuck-in or sunset | **~50%** | sub-$10M acquisition by Buildertrend/Procore/Autodesk or quiet wind-down |
| $10-40M ARR; strategic acquisition | **~30%** | $50-300M exit, CoConstruct-style |
| $50-150M ARR with payments revenue layer | **~15%** | $400M-$1.5B acquisition or pre-IPO growth round |
| $300M+ ARR with successful fintech expansion | **~5%** | $2-5B+, IPO-eligible (Procore-tier) |

The 50/30/15/5 split is not a prediction — it's the prior distribution of
outcomes from your actual reference class (solo-founder, SMB-vertical,
pre-launch SaaS). Execution and a few strategic decisions move you up
the ladder. The single biggest lever is **revenue mix**: every company
above $1B ARR in this category got there via fintech, not seats. None
crossed it on subscription alone.

---

## 1. Why pure SaaS can't reach $1B in this market

Three of four agents independently arrived at this math. The numbers:

- **US addressable firms** (SMB residential remodelers + small commercial GCs): ~180K
- **Currently using any software**: ~35% (~63K firms)
- **Greenfield**: ~117K firms
- **MAGE blended ARPU** (mix of $29/$79/$150 tiers): ~$700/year
- **Theoretical 100% capture of SAM**: ~$130M ARR ceiling
- **At a 9x revenue multiple (top quartile for vertical SaaS)**: **$1.2B max equity value** — and only if you somehow take every single firm

That's the ceiling **before** subtracting churn, win-rate losses to
Buildertrend / JobTread / Knowify / CoConstruct, and the segment of GCs
who'll never adopt mobile-first software. Realistic seat-only ceiling is
closer to **$30-50M ARR**, $200-400M equity value — and that's the
CoConstruct exit pattern, not the Procore/ServiceTitan one.

For a $1B+ outcome the math forces one of three structural moves:

1. **Layer fintech revenue** (ServiceTitan model — 25% of revenue is now fintech, growing fastest)
2. **Build a transaction-validated marketplace inside the workflow** (Levelset pattern, sold to Procore for $500M at ~$30M ARR — ~16x because of the network)
3. **Move up-market into commercial mid-market / enterprise** (Procore model — requires a sales team, 18-month cycles, and a different product surface)

Path #3 is **closed** for a solo founder. Paths #1 and #2 are open. The
rest of this doc is what to do about that.

---

## 2. The single architectural decision that determines everything

> **Build MAGE ID as a payment system-of-record from now, not as a workflow tool with payment buttons.**

Every $1B+ vertical SaaS company made this decision early and rode it
for a decade:

- **Toast** (restaurants): 80% of revenue is now fintech. $25B market cap.
- **Shopify** (e-commerce): 73% Merchant Solutions. $11.5B revenue.
- **ServiceTitan** (HVAC/plumbing/electrical): 25% fintech and the fastest-growing line. $772M ARR, IPO'd Dec 2024.
- **Procore** (commercial construction): didn't make this decision until 2023 — and it shows. $1.3B revenue but only a 5.9x EV/Revenue multiple, vs. 9x for vertical SaaS with embedded fintech. Their market cap of $8B is the **cautionary tale** of getting payments wrong, not the success story.

MAGE ID's existing Stripe Connect integration is the foundation. The
question is whether you architect everything from here forward
(invoices, change orders, pay apps, sub payments, owner draws, COI
renewals) as **events that flow through MAGE's payment rails** vs.
**events that link out to Stripe**. The first version is worth 5-10x
the second at exit.

Concretely: every dollar of value that moves between an owner, GC, sub,
supplier, or insurer should *route through MAGE* by default. Take a tiny
slice (50-75 bps) of each transaction. At maturity that's
**$5,000-$10,000 per GC per year**, vs. $948 of subscription. Same
customer base, 6-10x the revenue, higher gross margin.

---

## 3. The three converging high-leverage bets

The four agents independently arrived at overlapping recommendations.
The set that ALL of them name as top-priority:

### Bet A: Wisetack-style homeowner financing
**Who it helps:** the GC and the homeowner. Homeowner gets monthly-payment
financing for a $30-150K project. GC closes 20% more deals (industry
data) at 5-7x larger average ticket.

**MAGE's edge:** the project scope, estimate, and owner data are already
in the system. Wisetack alone requires manual application entry; with
MAGE pre-filling, time-to-funded drops from days to minutes. **That's
the moat** — it's an AI/data moat on top of Wisetack's lending stack,
not a competing lender.

**Revenue:** GC pays Wisetack 3.9-7% of financed amount. MAGE rev-share
30-40% of that. At ~$200K/yr financed per active GC, that's
**$3,000-$4,000/GC/yr** at 90%+ gross margin.

**90-day step:** apply to Wisetack partner program, integrate pre-qual
widget into existing project-detail flow.

### Bet B: Stripe Connect payment markup (50-75 bps)
**Who it helps:** the company. Net positive to GCs who already use
Stripe Connect at base rates.

**MAGE's edge:** already wired. Negative effort to add.

**Revenue:** $500-$4,000/GC/yr at 70-80% gross margin. Bigger than the
$79/mo Business subscription on most accounts.

**90-day step:** add `platform_fee_percent: 0.5-0.75` to existing Stripe
Connect setup. Bundle into Business + Enterprise tiers; keep Pro
unmarked so top-of-funnel doesn't suffer.

### Bet C: COI re-quote exchange (embedded insurance)
**Who it helps:** GCs (always-current COIs without nagging) + insurance
brokers (warm leads).

**MAGE's edge:** the COI watcher already exists. When a sub's policy
expires in 30 days, route the renewal to 3 commercial-insurance brokers
(Next, Coterie, Hiscox have APIs) and take a 10-15% referral commission
on first-year premium.

**Revenue:** ~$240-360 per renewal × subs-per-GC × renewal frequency =
**~$400-1,200/GC/yr** at 80%+ gross margin. Compounds with sub-base
size.

**90-day step:** sign LOI with Coterie or Next Insurance, white-label
quote → bind flow inside the existing COI tab.

**The compounding network effect:** within 18 months MAGE has more
transaction-validated data on what GCs require, what subs carry, and
what premiums clear than any single broker. That data moats the
business.

### Combined revenue impact

If a single GC adopts all three bets at maturity:

| Revenue line | Per GC/year |
|---|---|
| Business subscription | $948 |
| Stripe Connect markup | $1,500 (mid-range) |
| Homeowner financing rev-share | $3,500 (mid-range) |
| COI re-quote commission | $800 (mid-range) |
| **Total ACV** | **~$6,750** |

That's **~7x** the subscription-only ACV. At 5,000 GCs that's **$33.7M ARR
with strong gross margin** — already in the $200-400M acquisition zone.
At 20,000 GCs it's $135M ARR — IPO territory.

---

## 4. The lower-priority but worth-architecting bets

### Bet D: Factoring on AIA G702/G703 pay apps
**Why it matters:** GCs wait 60-90 days to get paid by owners. Factoring
fronts 80-95% of an unpaid invoice for a 2-4% fee per 30 days. MAGE
already builds the G702 — the receivable is verifiable, the underwriting
data is right there.

**Revenue:** $400-2,400/GC/yr at 80%+ gross margin (referral rev-share
with altLINE or eCapital — never be the lender).

**Why it's bet #4, not #1:** smaller AOV than Bet A (homeowner
financing) and competes for the same GC mindshare. Ship it second.

### Bet E: Sub-bid auto-network (the Levelset pattern)
**Why it matters:** GCs already invite subs to MAGE's sub portal — that
free-side onboarding is doing the work of a marketplace acquisition.
When the GC defines a scope, broadcast it to 3 vetted subs in the same
trade + zip code, take 2-3% of the awarded sub contract.

**Revenue:** at scale, 2% of $25K/sub-contract × 10/yr × 1,000 GCs =
$5M GMV / $100K take in early metros; compounds geometrically with
density.

**Why it's bet #5:** requires local density (~50 active subs per trade
per metro). Won't work until 500+ paying GCs are concentrated in 3-5
metros. Architect for it now, monetize in year 2.

**The acquisition story slide for this bet:**
> "MAGE is the only live, transaction-validated subcontractor graph in
> residential & light-commercial construction. Every completed bid,
> signed COI, and paid invoice strengthens the edge."

That sentence is the difference between a $200M exit and a $1B+ exit.

### Bet F: Inter-GC referral exchange
**Why it matters:** SMB GCs turn down 20-40% of inbound leads (wrong
scope, full schedule, wrong trade). Today these die. Build a one-tap
"refer to the nearest qualified MAGE GC" with a 5% referral fee on the
signed contract.

**Revenue:** small absolute dollars but **zero CAC** — every refused
lead becomes a node. Combined with Bets A-E, makes MAGE the only place
an SMB GC can survive without external lead-gen.

**Why it's bet #6:** lowest absolute revenue, but it's a sleeper because
it produces virality without spend.

---

## 5. What to deliberately NOT build

Pulled from cross-cutting agent recommendations. Each of these is a
known graveyard for SMB-construction startups:

| Anti-pattern | Why to skip |
|---|---|
| **Owner→GC lead-gen marketplace** (Houzz/Angi/Thumbtack model) | Angi revenue down 18%/yr for 3 years; Houzz Pro BBB rating 1.02/5; CAC per booked job exceeds $1,400. Adverse-selection death spiral. |
| **Materials marketplace from scratch** | Ferguson/Home Depot/Lowes own 15-year B2B relationships + pro-desk pricing. Needs $20M inventory float a solo founder doesn't have. |
| **Procore-tier enterprise commercial GC** | Different product surface, 60-90 day sales cycles, security reviews, RFP responses. Eats 18 months at near-zero close rate without a sales team. |
| **Homeowner DTC subscription** | Zero pricing power. Houzz/Angi all failed at recurring homeowner revenue. Use the portal as a trust feature, not a revenue line. |
| **Becoming a money transmitter** | $500K surety bonds × 49 states, 12-24 month timelines. Procore is doing it; you are not Procore. Stay a referrer/originator. |
| **International before $2M ARR domestic** | Localization tax (currency, AIA-equivalent in CA/UK/AU, payroll, lien laws) is real engineering work. Take inbound; don't push. |
| **Conference circuit before PMF** | $50-200K/yr in shows for visibility you can't convert. One booth/yr max, not three. |
| **AI-as-product positioning** | AI is table stakes by mid-2026. Differentiation is workflow depth, not AI claims. |
| **Tax-advance products** | Levelset already proved the demand is shallow. |
| **Hardware** | Toast's revenue mix includes hardware; you ship pixels. |
| **Building Procore Pay's MTL stack in-house** | Three-year, multi-million-dollar regulatory project. Refer instead. |
| **Synapse-style embedded banking partners** | The 2024 Synapse collapse cost depositors $85M. Use only Treasury Prime, Increase, or Stripe — survivors of that cull. |

---

## 6. Expansion ladder (in order)

Year 1 (post-TestFlight, months 1-12):
- **ICP 1:** Residential remodelers + small commercial GCs (where you already are)
- **ICP 2 — validate fast:** Real-estate investors / flippers / STR-prep operators. Same product, different landing page. JobTread proved this works; takes ~2 weeks to test.
- **Distribution:** Founder-led YouTube (1 video/week), Reddit + Facebook contractor groups, 1 conference booth (IBS or JLC Live)
- **Goal:** $1-3M ARR, 500-1,500 customers

Year 2 (months 13-24):
- **Adjacent trade #1:** Roofing — closest workflow to GC (photo-heavy, insurance-adjacent). JobNimbus took $330M from Sumeru on this thesis (Nov 2024). Ship as a "Roofing" preset, not a separate app.
- **Activate Bets A, B, C** (Wisetack, Stripe markup, COI re-quote)
- **Series A** at $3-5M ARR for $15-25M at $80-150M post
- **Goal:** $5-15M ARR

Year 3 (months 25-36):
- **Adjacent trade #2:** Restoration (insurance-paid jobs, higher AOV, Xactimate integration mandatory)
- **Activate Bet D** (factoring on G702)
- **Architecturally land Bet E** (sub-bid network) — local density now plausible
- **Optional:** strategic acquisition conversation with Buildertrend / Procore / Autodesk at $200-500M, OR continue to Series B
- **Goal:** $25-50M ARR

Year 4-5: $80-200M ARR. Either acquired in the $1-2B range or set up for IPO at $300M+ ARR with full fintech mix.

---

## 7. What to do in the next 90 days

A solo founder's quarterly capacity is ~3 substantial things. From the
synthesis above:

1. **Architect for payment system-of-record.** This is a design
   decision, not a feature. Every new invoice/payment/COI/sub-payment
   should flow through MAGE's Stripe Connect rails by default —
   not link out to anything else. This is 5 days of careful refactoring
   work that pays for itself many times over by year 2.

2. **Sign LOI with Wisetack.** Their partner program is the single
   highest-leverage fintech bet for MAGE's ICP. Targeting integration
   live within 60 days; pre-fill flow live within 90.

3. **Ship the embedded COI re-quote exchange.** Coterie or Next
   Insurance partner program → white-label quote-and-bind inside the
   existing COI tab. Sign LOI in week 1, prototype week 3, live week 8.

4. **Re-frame the public landing page for the real-estate investor
   ICP.** Same product, different message. JobTread playbook. 2 weeks
   of work; signal in 60 days if 5 paying investors close.

5. **Start the founder-led YouTube channel.** 1 video/week, AI-on-the-
   jobsite POV. No production budget — phone + DaVinci Resolve. The
   compounding distribution moat starts now, not at $1M ARR.

Everything else on the P4 list (157 ideas) is shelved until at least
one of the above is past a real signal.

---

## 8. The single sentence to keep above the laptop

> "Procore is a $1.3B-ARR company stuck at a 5.9x revenue multiple
> because they treated payments as a feature, not as the company.
> Don't be Procore."

The decision to architect MAGE as a payment system-of-record is the
single load-bearing strategic move. Everything else — features,
expansion, distribution — flows downstream from there.

---

## 9. Sources

Each agent's full findings + sources are in the conversation thread
that produced this doc. Headline citations:

- [Procore Q4 + FY 2025 Financial Results](https://www.procore.com/press/procore-announces-fourth-quarter-and-full-year-2025-financial-results) — $1.323B revenue, 5.9x EV/Revenue
- [ServiceTitan S-1 Breakdown — Meritech](https://www.meritechcapital.com/blog/servicetitan-s-1-breakdown) — 71% subscription / 25% fintech / 4% services
- [Sacra — ServiceTitan revenue mix](https://sacra.com/c/servicetitan/) — fintech grew 3x faster than subs
- [Toast Q4 2025 Earnings](https://www.businesswire.com/news/home/20260212058106/en/Toast-Announces-Fourth-Quarter-and-Full-Year-2025-Financial-Results) — 80% of revenue is fintech
- [SaaS Mag — Embedded Finance rewriting SaaS unit economics](https://www.saasmag.com/embedded-finance-rewriting-saas-unit-economics/) — vertical SaaS with fintech trades at 7-9.5x revenue
- [Autodesk Completes PlanGrid Acquisition for $875M](https://adsknews.autodesk.com/en/pressrelease/autodesk-completes-plangrid-acquisition/) — 8.75x ARR benchmark
- [Procore acquires Levelset for $500M](https://www.procore.com/press/procore-completes-acquisition-of-levelset-to-simplify-lien-management-workflows-for-construction) — ~16x ARR for the network
- [Wisetack + LendingClub 2026 Partnership (PYMNTS)](https://www.pymnts.com/partnerships/2025/lendingclub-partners-with-wisetack-and-enters-home-improvement-financing-market/)
- [JobNimbus $330M Sumeru investment](https://www.jobnimbus.com/blog/sumeru-equity-partners-invests-330-million-in-jobnimbus-to-revolutionize-the-roofing-industry) — roofing-vertical thesis
- [Synapse Collapse Lessons (Banking Dive)](https://www.bankingdive.com/news/5-lessons-learned-from-synapses-collapse/731543/) — why to use only post-cull embedded-banking partners
- [NAHB Remodelers Census 2025](https://eyeonhousing.org/2025/09/who-are-nahb-remodelers/) — 128K addressable US firms
- [IRS 1099-K FAQs Post-OBBBA](https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000) — threshold reverted to $20K + 200 tx

End of doc.
