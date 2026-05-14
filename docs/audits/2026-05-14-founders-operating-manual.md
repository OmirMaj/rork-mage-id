# MAGE ID — Founder's Operating Manual

**Date:** 2026-05-14
**Source docs:** [billion-dollar-strategy.md](./2026-05-14-billion-dollar-strategy.md), [features-audit.md](./2026-05-14-features-audit.md), commits `6374550` + `6aea3fa`.

---

## Executive summary

MAGE ID is a residential and small-commercial construction management app for solo GCs and small contractor teams — iOS-first, with web and Android backup. Post-rollout it is no longer a workflow tool that happens to bill. **The single architectural decision the strategy doc forced is that MAGE ID is a payment system-of-record first, and a workflow product second.** Every invoice, change order, AIA pay app, sub payment, COI renewal, and lien waiver routes through MAGE's Stripe Connect rails so a thin platform fee can ride each transaction — and so the partner-revenue products in this manual have a place to land.

Realistic outcome distribution from the strategy doc: **50%** plateaus under $5M ARR (tuck-in or sunset). **30%** reaches $10–40M ARR and exits $50–300M (CoConstruct pattern). **15%** layers fintech, hits $50–150M ARR, exits $400M–$1.5B. **5%** rides full fintech expansion to $300M+ ARR and IPOs at $2–5B+ (ServiceTitan pattern). This manual is the playbook for moving up that ladder.

### How to use this doc

- **For yourself:** each chapter is a self-contained brief. Re-read the one you're working on this week.
- **For partners (Wisetack, altLINE, Coterie, Track1099, etc.):** the "pitch when talking to the partner" section is the literal Zoom-call script.
- **For future hires:** read top to bottom. You'll understand the product, the economics, and what NOT to build.
- **For investors:** the executive summary plus the table below is the back-of-napkin math.

### Revenue product summary

**per-GC/yr** = dollars MAGE earns per active GC per year once they adopt the product at typical volume. **TAM** (total addressable market) = the user pool you can theoretically sell to.

| # | Product | Status | Per-GC/yr at maturity | Partner needed? |
|---|---|---|---|---|
| 1 | Tier-aware Stripe markup | **Live** | $1,500 (mid) | No |
| 2 | Wisetack-style homeowner financing | Waitlist | $3,500 (mid) | **Yes — Wisetack LOI** |
| 3 | AIA G702 factoring | Waitlist | $1,400 (mid) | **Yes — altLINE or eCapital LOI** |
| 4 | COI re-quote marketplace | Waitlist | $800 (mid) | **Yes — Coterie or Next LOI** |
| 5 | Sub-bid auto-network | Waitlist | $100–500 early, grows with density | No partner; needs density |
| 6 | Inter-GC referral exchange | Waitlist | Small $, zero CAC | No partner; needs density |
| 7 | Mass sub-payouts + auto-1099 | Waitlist | $200–600 | **Yes — Track1099 LOI** |
| 8 | Lien-waiver e-sign + escrow | Waitlist | $300–800 | Optional partner bank |
| 9 | Equipment / vehicle financing | Waitlist | $300–600 | **Yes — equipment-lender LOI** |
| 10 | Tier A quick wins | **Live** | n/a (retention) | No |
| 11 | Payment system-of-record | **Live** (architectural) | unlocks #1–9 | No |
| 12 | Anti-patterns (NOT building) | n/a | n/a | n/a |

A single GC adopting products 1–4 at mid-range maturity: **~$6,750 ACV/yr** (~7x subscription-only). At 5,000 GCs that's **$33.7M ARR**. At 20,000 GCs: **$135M ARR** — IPO territory.

---

## 1. Tier-aware Stripe payment markup

**Status:** Live

**Where it shows up in the app:**
- "Generate Payment Link" on `app/invoice.tsx` (3 call sites)
- "Generate Payment Link" on `app/aia-pay-app.tsx`
- Server-side fee logic in `supabase/functions/create-payment-link/index.ts:104-126`
- Paywall comparison table in `app/paywall.tsx:73-81`

**What the user sees and does:** GC taps "Generate Payment Link" on an invoice or pay app. A Stripe hosted checkout URL appears. They text or email it to their client. Money lands in the GC's connected Stripe Express account. MAGE silently takes a slice via Stripe's `application_fee_amount` — the GC never sees a separate MAGE charge.

**How it actually works under the hood:** The `create-payment-link` edge function (Deno) creates a Stripe `Price`, then a `PaymentLink`, both on behalf of the contractor's Connect account via the `Stripe-Account` header. The fee is `amountCents × feeBps / 10000`, attached as `application_fee_amount`. Schedule (lines 114–126): **Free/Pro = 0 bps, Business = 50 bps, Enterprise = 40 bps.** Env-overridable for promotions. Client passes tier from `useSubscription()`; trusting the client tier is a deliberate fraud-trade — spoofing saves $10 on a $100k invoice, not worth a round-trip.

**Why this generates money:** 50 bps on $200k annual GC volume = $1,000/yr; on $600k = $3,000/yr. Per strategy doc: **$500–$4,000 per GC per year at 70–80% gross margin** — bigger than the $79/mo Business subscription. At 5,000 paying GCs averaging $1,500/yr: $7.5M ARR from this line alone. Pro pays zero so the top-of-funnel never feels squeezed and the Pro→Business upgrade has a concrete dollar reason.

**The pitch when talking to the partner (or the user):** *"Toast lives at 48 basis points net take on $150B of restaurant volume — that's how they got to a $25B market cap. We charge 50 bps to Business-tier GCs because we already own the rails and your bank doesn't change. Pro is free. Business and Enterprise bake it in — no separate bill, no surprise."*

**What still has to happen for it to be fully live:** Already shipped (commit `6374550`). Open question: shave Business to 40 bps in year 2 once volume is proven? Probably yes once we have data.

**Common objections + how to answer them:**
- *"Why am I paying 0.5% on top of Stripe?"* — You're not. The 0.5% replaces what other workflow tools charge as a higher subscription. Buildertrend bundles their payment fee silently; we show it.
- *"What if I want to use my own Stripe account?"* — You already are. Money lands in your bank, not ours.
- *"Procore has Procore Pay — why MAGE?"* — Procore's payment business is at a 5.9x revenue multiple precisely because they treated it as a feature. Our architecture starts there.

---

## 2. Wisetack-style homeowner financing

**Status:** Early-access waitlist (CTAs live)

**Where it shows up in the app:**
- `app/invoice.tsx:1139-1146` — "Offer your client monthly payments" card, surfaces only when invoice balance > 0
- `components/RevenueEarlyAccessCard.tsx` with `eventKey: 'revenue.financing.wisetack'`
- Paywall: `app/paywall.tsx:75`

**What the user sees and does:** GC creates a $48k kitchen-remodel invoice. At the bottom, an "EARLY ACCESS" card: *"Offer your client monthly payments — contractors who offer financing close 20% more deals at 5-7x larger ticket."* GC taps; card flips to "ON THE LIST." When Wisetack ships, the same card becomes a "Generate financing link" button that pre-fills homeowner, address, and amount from MAGE data.

**How it actually works under the hood:** Today, `RevenueEarlyAccessCard` writes `{user_id, event_key}` to `feature_interest` (deduped). When partner program signs, the card swaps to a pre-qual widget. MAGE→Wisetack is a server-side POST with project scope, owner contact, address, and invoice total — all already on `Project` / `Invoice` / `PortalMessage`. Wisetack returns a payment link. Homeowner taps a soft-pull approval (typically funded in 1 minute); project gets a `financingStatus` field; rev-share credited via Wisetack's partner API on funding.

**Why this generates money:** GC pays Wisetack 3.9–7% of financed amount. MAGE rev-shares **30–40% of that**. A GC financing $200k/yr × 30% × 5% = **$3,000/yr**. Strategy doc: **$3,000–$4,000/GC/yr at 90%+ gross margin** (cost: two API calls + a notification). At 5,000 GCs: $15–20M ARR.

**The pitch when talking to the partner (or the user):**
- *To Wisetack:* "We're the field-of-record for thousands of SMB GCs. Project scope, estimate, and owner contact are already structured in our database. Your pre-qual widget alone takes 4 minutes of manual entry; with MAGE pre-filling, time-to-funded drops to under 60 seconds. We turn your form into an in-product tap. Same rev-share you give your top 5 affiliates."
- *To the user:* "You close 20% more deals when you offer financing — that's industry data from Wisetack's own case studies. We pre-fill the application from your invoice. Your homeowner gets a decision in 60 seconds, you get paid in full today."

**What still has to happen for it to be fully live:**
1. Wisetack partner LOI (target Q2 2026).
2. Edge function `submit-financing-app` (pre-fill payload to Wisetack API).
3. Webhook listener for funding events → `financingStatus` updates.
4. CTA flip: waitlist → "Generate financing link."

**Common objections + how to answer them:**
- *(Wisetack) "What's your active-GC count?"* — Pre-launch. We use waitlist signups to size affiliate negotiation. Every tap is a slide.
- *(GC) "Won't my client get mad if they see I'm pushing financing?"* — The card surfaces for you. The homeowner sees the option only if you forward it.
- *(Investor) "This is just a referral fee."* — 30% rev-share on 5% of $200k per GC is $3k/yr at 90% margin. ServiceTitan's fintech line is structurally the same and is now 25% of their revenue.

---

## 3. AIA G702 factoring (altLINE / eCapital)

**Status:** Early-access waitlist (CTAs live)

**Where it shows up in the app:**
- `app/aia-pay-app.tsx:617-624` — "Advance 90% on this pay app today" card (dynamic dollar figure), surfaces only when `currentPaymentDue > 0`
- `app/invoice.tsx:1131-1138` — "Get paid today, not in 60 days" card
- Paywall: `app/paywall.tsx:76`

**What the user sees and does:** GC finishes an $87,500 AIA G702 pay app. Below the dollar figure, an early-access card: *"Advance $78,750 on this pay app today — owners average 60-83 days to release pay-app funds."* When the partnership ships, the card becomes a "Get advance" button: pay app submits to the factor; advance hits the GC's account in 24 hours minus 2–4% per 30 days outstanding.

**How it actually works under the hood:** MAGE already builds the G702/G703 and stores the underwriting data the factor wants (owner, contract value, completed-to-date, retainage, prior payments). On tap, an edge function submits the pay-app payload + connected Stripe account to the factor's API. Funds arrive via ACH. When the owner eventually pays, the factor sweeps. MAGE collects a referral rev-share per origination. We do NOT become the lender — that's an explicitly listed anti-pattern.

**Why this generates money:** Strategy doc: **$400–$2,400/GC/yr at 80%+ gross margin**. Smaller than Wisetack because AOV per advance is high but frequency is lower. At 2,000 GCs in active commercial × $1,400/yr: $2.8M ARR. Why bet #4 not #1: competes for the same GC mindshare as Wisetack and ships second.

**The pitch when talking to the partner (or the user):**
- *To altLINE / eCapital:* "We build the AIA G702 inside our app — the very document you require for underwriting. We sit between you and an addressable population of small commercial GCs who today fax these forms. We deliver pre-verified structured pay-apps to your underwriting queue. Standard partner rev-share."
- *To the GC:* "Owners take 60–83 days to release a pay-app. Don't float that. 90% in 24 hours for a 2–4% fee per 30 days. You decide if the cost is worth the cash."

**What still has to happen for it to be fully live:**
1. Partner LOI with altLINE or eCapital (target Q3 2026).
2. Edge function `submit-factoring-advance` posting AIA payload + connected account.
3. Webhook listener for advance funding + sweep events.
4. UI swap: waitlist → "Get advance."

**Common objections + how to answer them:**
- *(altLINE) "We already have AR-financing relationships."* — Yours is the only product that pre-verifies the receivable inside the GC's invoicing tool. You save days of underwriting per deal.
- *(GC) "Factoring is for businesses that can't make payroll — won't this look bad?"* — That stigma is decades old. Today factoring is a cash-flow tool the same way a HELOC is.
- *(Investor) "Margins are thin on factoring referrals."* — 80%+ gross margin on $1,400/GC/yr is fine. The strategic value is defensive: single-vendor lock-in.

---

## 4. COI re-quote insurance marketplace

**Status:** Early-access waitlist (CTAs live)

**Where it shows up in the app:**
- `app/prequal-manager.tsx:226-233` — "Compare renewal quotes from 3 brokers" card, surfaces only when subs have COIs expiring ≤30 days or already expired
- Paywall: `app/paywall.tsx:77`

**What the user sees and does:** Three subs' policies expire in 30 days. A card: *"Compare renewal quotes from 3 brokers — Coterie + Next Insurance + Hiscox quote your sub in 60 seconds."* When the partner is signed: existing COI data (carrier, premium, limits) pushes to 2–3 broker APIs; the sub gets 3 quotes back in under a minute; the GC's COI tracker auto-updates on bind.

**How it actually works under the hood:** The COI watcher already exists. Each `Sub` has a policy with carrier, premium, limits, expiration. When the watcher flags an expiry, the marketplace CTA appears. Tap routes to an edge function fanning out to Coterie / Next / Hiscox APIs. The sub picks a quote in the portal (passwordless magic-link). On bind, MAGE collects 10–15% of first-year premium.

**Why this generates money:** Strategy doc: ~$240–360/renewal × subs-per-GC × renewal frequency = **~$400–$1,200/GC/yr at 80%+ gross margin**. GC with 10 subs × $1,800 avg premium × 15% commission = $2,700 high end. Mid $800/GC/yr. At 5,000 GCs: $4M ARR. **The compounding moat:** within 18 months MAGE has more transaction-validated data on what GCs require, what subs carry, and what premiums clear than any single broker. That data is the moat.

**The pitch when talking to the partner (or the user):**
- *To Coterie / Next:* "When a sub's policy expires, the GC nags them to renew — and the GC already has the existing policy data on file in our tool. We hand you pre-qualified renewal leads with the existing carrier, premium, and limits attached. Standard 10–15% first-year-premium commission."
- *To the GC:* "Your sub's policy expires next month. Tap once. Three brokers quote in 60 seconds. Renewal hits your COI tracker automatically. Stop nagging."

**What still has to happen for it to be fully live:**
1. LOI with one of Coterie, Next Insurance, or Hiscox (target Q2 2026 — per 90-day plan).
2. Edge function `request-coi-quotes` fanning to broker APIs.
3. Passwordless sub-portal quote-pick screen.
4. Webhook listener for bind events → COI tracker auto-update + commission credit.

**Common objections + how to answer them:**
- *(Coterie/Next) "How do you handle agency relationships?"* — We're a referral source, not the agency of record. The broker is the principal.
- *(GC) "My sub already has a broker."* — That broker may not have the best price. The platform makes them compete. Sub keeps whoever they pick.
- *(Investor) "Insurance is regulated — what's your licensing exposure?"* — None. Referrer/originator, not a producer.

---

## 5. Sub-bid auto-network

**Status:** Early-access waitlist (CTAs live) — needs local density before broadcast

**Where it shows up in the app:**
- `app/estimate-wizard.tsx:551-558` — "Post this scope to 3 vetted subs" card on the estimate result screen
- Paywall: `app/paywall.tsx:79`

**What the user sees and does:** GC finishes a $185k bathroom-remodel estimate. On the result screen: *"Post this scope to 3 vetted subs — receive 3 bids in 48h."* When the network hits ~50 active subs per trade in the metro, the same CTA broadcasts line-items-by-trade to qualified nearby subs — they bid, GC awards, MAGE takes 2–3% of the awarded sub contract.

**How it actually works under the hood:** The product already invites subs into the sub portal (free side). Every COI signed, invoice paid, bid responded-to accumulates as transaction-validated trust signal on each sub. When a GC posts a scope, an edge function indexes line items by trade (the wizard already tags them), filters subs by trade + zip + active-COI + minimum-jobs-completed, and broadcasts a request-for-bid. Subs respond passwordless via magic link. The contract routes via Stripe Connect — MAGE silently takes 2–3%.

**Why this generates money:** Strategy doc: at scale, 2% of $25K/sub-contract × 10/yr × 1,000 GCs = $5M GMV / $100K take in early metros, **compounds geometrically with density**. Why bet #5: requires ~50 active subs per trade per metro before it works at all. Real revenue waits for 500+ paying GCs in 3–5 metros. Architecting now is what matters.

**The pitch when talking to the partner (or the user):**
- *To investors:* "MAGE is the only live, transaction-validated subcontractor graph in residential and light-commercial construction. Every completed bid, signed COI, and paid invoice strengthens the edge. That's the Levelset story — sold to Procore for $500M at ~$30M ARR. Sixteen times revenue because the network was the asset."
- *To the GC:* "Stop texting six subs to get one bid back. Post your scope to MAGE. Three vetted subs reply in 48 hours."

**What still has to happen for it to be fully live:**
1. Aggressively onboard subs in 3–5 target metros until density crosses ~50/trade.
2. Broadcast edge function with trade + zip indexing.
3. Sub passwordless magic-link bid form.
4. Award-and-route flow funneling the awarded contract via Stripe Connect.

**Common objections + how to answer them:**
- *(Investor) "Marketplaces are chicken-and-egg."* — Not starting from zero. The product already requires subs to be invited for COI tracking. Every paying GC brings ~10 subs into MAGE as a side effect.
- *(GC) "I have my regular subs."* — Use the network when your regulars are booked. Backup, not replacement.
- *(Sub) "Why bid through MAGE?"* — Passwordless, no signup. We forward you the scope. You bid or don't.

---

## 6. Inter-GC referral exchange

**Status:** Early-access waitlist (CTAs live) — needs density

**Where it shows up in the app:**
- `app/(tabs)/discover/index.tsx:473-480` — "Refer a lead, earn 5% if it closes" card in the EARN MORE section
- Paywall: `app/paywall.tsx:80`

**What the user sees and does:** Discover → EARN MORE. *"Got an inbound lead outside your scope or schedule? Refer it to the nearest qualified MAGE GC. Cash payout via Stripe Connect when they sign."* When live: one-tap referral on every inbound lead → forwards to nearest qualified MAGE GC → 5% of signed contract via Stripe Connect on close.

**How it actually works under the hood:** Product already has leads + CRM. Today declined leads die. The exchange adds a "refer to MAGE network" button. Edge function picks nearest qualified GC (trade, zip, capacity, prior acceptance rate). On signature, MAGE collects 5% via Stripe Connect; pays 5% to the originator; takes a 1–2 point spread as platform fee.

**Why this generates money:** Strategy doc: small absolute dollars but **zero CAC** — every refused lead becomes a node. 5,000 GCs × 8 leads/yr declined × 25% closing × $35k average × 1.5% platform fee = $5.25M GMV/yr — modest, but zero acquisition cost. The compounding effect is virality without spend.

**The pitch when talking to the partner (or the user):**
- *To investors:* "Every refused lead today dies. We make it a node. The platform becomes the only place SMB GCs can survive without paying $1,400/booked-job to Angi or Houzz."
- *To the GC:* "You turn down 20–40% of leads. Refer them. Earn 5% when they close. Free money on a deal you weren't going to do."

**What still has to happen for it to be fully live:**
1. Need ~500 active GCs per metro for the pool to be useful.
2. One-tap referral flow on the Leads screen.
3. Stripe Connect referral-fee payout (rails exist).
4. Receiving-GC acceptance UI.

**Common objections + how to answer them:**
- *(GC) "Why give away leads?"* — You're not — they're dead in your pipeline. 5% is free money.
- *(Investor) "This is Houzz-Pro for contractors."* — No. Houzz monetizes the homeowner finding a GC at $1,400 CAC. We monetize the *handoff* between existing trusted GCs at zero CAC.

---

## 7. Mass sub-payouts + auto-1099

**Status:** Early-access waitlist (CTAs live)

**Where it shows up in the app:**
- `app/(tabs)/discover/index.tsx:482-489` — "One-tap Friday payouts to all your subs" in EARN MORE
- Paywall: `app/paywall.tsx:78`

**What the user sees and does:** Discover → EARN MORE. *"Pay 15 subs at once via Stripe Connect, auto-file their 1099-NEC at year-end. The $20K threshold reverted under OBBBA — you need 1099s anyway."* When live: payouts screen lists every sub owed this pay period. Tap "Pay all," 15 simultaneous ACH transfers fire via Stripe Connect; each sub's payout accumulates against a year-end 1099 that MAGE auto-files via Track1099.

**How it actually works under the hood:** Stripe Connect already supports multi-destination transfers — MAGE platform account; each sub is an Express connected account. On "Pay all," batched destination transfers fire (`transfer_data` per line) with metadata (project, pay period, sub). At year-end, edge function aggregates each sub → Track1099 API → IRS e-filed 1099-NEC + emailed copy. MAGE charges per payout (small flat + bps) and per 1099 filed.

**Why this generates money:** $200–$600/GC/yr estimate. Mechanism: $0.50–$1 per payout × 30–60 payouts/yr = $15–60, plus ~$3 per 1099 × 10–25 subs = $30–75, plus payment-volume bps (collected via Chapter 1's markup). OBBBA reversion to the $20K/200-transaction 1099-K threshold makes clean 1099-NECs mandatory again starting tax year 2025 — compliance pain we monetize. Track1099's existing partner program rev-shares on filings.

**The pitch when talking to the partner (or the user):**
- *To Track1099:* "We have the structured data — every sub's W-9, every paid invoice tagged to that sub. We deliver pre-validated 1099-NEC payloads to your filing pipeline at scale. Rev-share on filings."
- *To the GC:* "Pay 15 subs at once on Friday. We file all the 1099s at year-end. Forget tax season exists."

**What still has to happen for it to be fully live:**
1. Track1099 partner LOI (target Q3 2026).
2. Batch-payout edge function (Stripe Connect already wired — small wrapper).
3. W-9 collection flow in the sub portal (passwordless magic-link).
4. Year-end 1099 file-and-email cron edge function.

**Common objections + how to answer them:**
- *(GC) "My accountant handles 1099s."* — Your accountant charges $25–50/form. We charge $3 and you do nothing.
- *(Track1099) "What's your filing volume?"* — Today zero. Waitlist count is the negotiation lead.

---

## 8. Lien-waiver e-sign + escrow

**Status:** Early-access waitlist (CTAs live) — base lien-waiver tool already ships

**Where it shows up in the app:**
- `app/aia-pay-app.tsx:625-632` — "Auto-generate lien waivers at payment" card
- `app/(tabs)/discover/index.tsx:491-498` — "Lien waivers at point-of-payment" in EARN MORE
- Base waiver builder already in the app (no partner needed)

**What the user sees and does:** When an Invoice or pay app is marked paid (Stripe Connect already wired), a card appears: *"Auto-generate lien waivers at payment — MAGE drafts conditional & unconditional waivers for every sub paid out of it. E-sign in one tap."* The sub gets an SMS magic link, signs, returns. Next pay app is locked until prior period's waivers are in. Optional escrow tier for big jobs holds GC funds at a partner bank until waivers are signed.

**How it actually works under the hood:** Lien waivers are already a feature. New: auto-trigger on payment-event + escrow tier. On a Stripe `payment_intent.succeeded` webhook, an edge function fans conditional waivers to every sub on the project for that pay period. Each generates from a template; sub signs passwordless via SMS link; waiver files back to the project's compliance file. Escrow tier needs a partner bank (Treasury Prime or Increase per strategy doc — both survivors of the 2024 Synapse collapse) holding funds FBO the GC.

**Why this generates money:** $5–15 per waiver e-sign × 30–60 waivers/yr per GC = $150–$900/yr base. Escrow tier (jobs >$100k): 25 bps × $200k × 30-day hold = ~$40/job × 5 jobs/yr = $200/yr. Total ~$300–$800/GC/yr at 70%+ margin. Levelset-replacement for the SMB segment Procore-Pay can't serve cleanly.

**The pitch when talking to the partner (or the user):**
- *To Treasury Prime / Increase:* "Custom escrow accounts for residential and small commercial GCs. Average balance $200k for 30 days. We're the originator; you hold the funds. Standard FBO-account fee split."
- *To the GC:* "Lien waivers are how you don't get sued in year 2. MAGE auto-drafts them every time you pay a sub. The sub e-signs on their phone. Compliance file builds itself."

**What still has to happen for it to be fully live:**
1. Auto-trigger on Stripe webhook (only net-new code — builder exists).
2. Sub passwordless e-sign magic link.
3. Escrow tier: partner LOI with Treasury Prime or Increase (Q4 2026 — explicitly NOT Synapse-stack partners).
4. FBO-account onboarding for GCs opting into escrow.

**Common objections + how to answer them:**
- *(GC) "Why do I care about lien waivers?"* — A sub who isn't paid can file a mechanic's lien against the property. With unconditional waivers signed at every payment, you're protected. If you've never been sued, you've never run a big job.
- *(Investor) "Why isn't Levelset already winning here?"* — Levelset is enterprise/commercial. SMB residential is the gap.

---

## 9. Equipment / vehicle financing

**Status:** Early-access waitlist (CTAs live) — lowest priority of the fintech bets

**Where it shows up in the app:**
- `app/(tabs)/discover/index.tsx:500-507` — "Finance a truck or new equipment" in EARN MORE

**What the user sees and does:** Discover → EARN MORE. *"When you outgrow rentals: $25K–$80K loans for trucks, lifts, scaffold, tools. 24-hour decisions via partner lenders."* When live: GC fills a 5-field application; MAGE pre-fills financials from its own invoices and pay-apps; partner lender (Currency / Crest Capital / Balboa) decides in 24 hours.

**How it actually works under the hood:** Same referral pattern as Wisetack/altLINE — we do not become the lender. MAGE→lender API push contains trailing-12 revenue (from invoices), pay-app volume (from G702s), average DSO (from payment dates), bank info (from Stripe Connect KYC). Lender funds; MAGE collects 1–3% origination fee.

**Why this generates money:** Lower-priority bet — the EARN MORE CTA footer says it explicitly. Estimate $300–$600/GC/yr at 80% margin. Mechanics: 2% × $40k average loan × 1-in-5 GCs/yr = $400/qualifying GC. Why #9: equipment financing is competitive (every bank does it), the addressable subset is smaller, and the data isn't a strong moat.

**The pitch when talking to the partner (or the user):**
- *To equipment lender:* "We have structured trailing-12 revenue and DSO on every GC. Standard 1–3% origination rev-share."
- *To the GC:* "When you've out-rented your usefulness, get the truck. 24-hour decision. We're not the lender; we route you to the best terms among our partners."

**What still has to happen for it to be fully live:**
1. Lender LOI (year-2 priority — not 90-day).
2. Edge function pushing pre-filled application.
3. Decision/funding webhook listener.

**Common objections + how to answer them:**
- *(GC) "My credit union has me on this."* — Use whoever has the best terms. We just save you the application time.
- *(Investor) "Margins are thin."* — Yes — that's why it's bet #9. Incremental ARR per GC at zero marginal effort once the integration is built.

---

## 10. Tier A quick wins

**Status:** Live (commit `8e25864`)

**Where it shows up in the app:**
- ProjectCard — gross-margin pill ("GP X%") next to status
- Summary tab — A/R aging strip (5 bucket pills above CashFlowGlance)
- `app/schedule-pro.tsx` — "iCal" Add-to-Calendar header button (uses `utils/icsGenerator.ts`)
- Onboarding skip path — auto-seeds Sample Project
- `app/project-detail.tsx` Photos — "Share read-only timeline" → `app/shared-photos.tsx` magic-link route
- `app.json` — 3 iOS quick-action shortcuts (new photo, new daily report, quick estimate) — plist-only, needs native rebuild
- `utils/estimateAssemblies.ts` — 10 hardcoded RSMeans-2024 assemblies (demo, framing, drywall, paint, kitchen/bath rough-in, roofing, slab, electrical, windows)
- `utils/photoShareToken.ts` — URL-safe base64 token for photo timeline magic link
- Offline-sync pill already shipped

**What the user sees and does:** First-5-minutes impression changes. Project cards show profitability at a glance (green pill >20% gross margin, amber 10–20%, red <10%). Reports tab shows A/R aging buckets at the top. Schedule has a one-tap "Add to Calendar" button. New users who skip onboarding land on a populated app. Sharing a photo timeline is now a magic-link CompanyCam-style page.

**How it actually works under the hood:** Each leverages existing data. Margin pill computes from `projectFinancials.ts`. A/R aging is pure UI over `Invoice[]`. iCal export uses existing `utils/icsGenerator.ts` (sidesteps mock Google OAuth). Photo share token is URL-safe base64 (max 30 photos — URL length budget). Sample Project seed from `utils/demoSeed.ts`. iOS quick-actions are plist entries needing a native rebuild.

**Why this generates money:** Indirectly — retention/conversion, not a revenue line. Per the features-audit, these close the "looks unfinished" gap with competitors charging 6x our price. Each is a feature JobTread / Buildertrend / CompanyCam ships and we didn't. Dollar value is in trial-to-paid conversion and churn reduction in months 2–3.

**The pitch when talking to the partner (or the user):** *"MAGE shows you whether each project is making money on the same screen as the status. Buildertrend buries margin three clicks deep. We surface it on the card."*

**What still has to happen for it to be fully live:** Tier B and C from the features-audit (AI weekly client update, punch-on-plan, real QBO sync, Project Memory vector store, SMS-to-project ingestion) are deferred until the revenue products land or until specific user pain validates them.

**Common objections + how to answer them:**
- *(User) "This is table stakes."* — Yes — that's why it's Tier A. The product story is "feature-leading at one-sixth the price," not "cheap with a wedge."

---

## 11. Strategic architectural decision: payment system-of-record

**Status:** Live (the decision itself, not a single line of code)

**Where it shows up in the app:** Everywhere. The decision: any transaction between a homeowner, GC, sub, supplier, or insurer routes through MAGE's Stripe Connect rails by default — not via a link out.

**What the user sees and does:** Nothing changes visually. System-side, every dollar has a place to be recorded, taxed with a thin fee, and observed. That observation accumulates into the dataset that powers products 5, 6, and 7 — none possible if money flows off-platform.

**How it actually works under the hood:** Strategy-doc commitment is to say *no* to features that transact outside MAGE — even when outside ships faster. New invoice screen? Stripe Connect. New sub-payment workflow? Stripe Connect. New COI renewal? Stripe Connect. The discipline is mechanical: PRs with "pay outside MAGE" paths get rejected.

**Why this generates money:** Precondition for all of Chapters 1–9. Toast got to 80% fintech revenue this way. ServiceTitan: 25% (grows 3x faster than subs). Procore did NOT make this decision until 2023 — that's why their EV/Revenue multiple is 5.9x. They're the cautionary tale.

**The pitch when talking to the partner (or the user):** *"MAGE is architected as a payment system-of-record. Toast: 80% fintech revenue. ServiceTitan: 25%. Procore: 0% until 2023, and it shows. We are aligned with the model that produced ten-figure outcomes, not the model stuck at 5.9x."*

**What still has to happen for it to be fully live:** Architecturally shipped (commits `6374550` + `6aea3fa`). What remains is *discipline*. The single sentence to keep above the laptop, per strategy doc:

> *"Procore is a $1.3B-ARR company stuck at a 5.9x revenue multiple because they treated payments as a feature, not as the company. Don't be Procore."*

**Common objections + how to answer them:**
- *(Investor) "What if you can't compete with QuickBooks Payments on rate?"* — We don't beat QBP on the base rate (they're at 2.9% + 30¢). We beat them on bundle — payment + workflow + AI breadth at one-sixth the subscription. The 50 bps is in addition to underlying Stripe; we're not pricing against QBP rate at all.
- *(GC) "I already use QuickBooks for payment."* — Use whatever you want. Every time we save you a step (re-entering invoices, manually tagging sub payments) is when the integrated experience pays for itself. Toast's restaurants asked the same question.

---

## 12. What was deliberately NOT built (and why)

From strategy doc Section 5. These are known graveyards for SMB-construction startups. Saying *no* is the work.

| Anti-pattern | Why we skipped it |
|---|---|
| **Owner→GC lead-gen marketplace** (Houzz/Angi/Thumbtack) | Angi revenue down 18%/yr for 3 years. Houzz Pro BBB rating 1.02/5. CAC per booked job >$1,400. Adverse-selection death spiral. |
| **Materials marketplace from scratch** | Ferguson / Home Depot / Lowes own 15-year B2B pro-desk relationships. Requires $20M of inventory float a solo founder doesn't have. |
| **Procore-tier enterprise sales** | Different product surface, 60–90 day cycles, security reviews, RFP responses. Eats 18 months at near-zero close rate. |
| **Homeowner DTC subscription** | Zero pricing power. Houzz / Angi failed at it. The portal is a trust feature, not a revenue line. |
| **Becoming a money transmitter** | $500K surety bonds × 49 states. 12–24 month timeline. Procore is doing it; you are not Procore. Stay a referrer/originator. |
| **International before $2M ARR domestic** | Localization tax (currency, AIA-equivalent in CA/UK/AU, payroll, lien laws) is real engineering. Take inbound; don't push. |
| **Conference circuit before PMF** | $50–200K/yr in shows for visibility you can't convert. One booth/yr max. |
| **AI-as-product positioning** | AI is table stakes by mid-2026. Workflow depth differentiates. |
| **Tax-advance products** | Levelset already proved demand is shallow. |
| **Hardware** | We ship pixels. Different company. |
| **Synapse-style embedded banking partners** | 2024 Synapse collapse cost depositors $85M. Only Treasury Prime / Increase / Stripe. |

**The why behind the why:** A solo founder's capacity is 2–3 substantial things per quarter. Every "no" above is a "yes" to the bets in Chapters 1–9. Saying yes to all of these is how the 50% plateau outcome happens.

---

## 90-day execution checklist

Ranked by leverage. Strategy doc's quarterly capacity for a solo founder is ~3 substantial things — anything beyond #4 is bonus.

1. **Sign Wisetack LOI (or competitor).** Bet A is the single highest-revenue fintech product for the ICP. Email their partner team this week. LOI in 30 days, integration in 60, pre-fill live in 90. Every waitlist tap is a slide for the negotiation.
2. **Sign Coterie or Next Insurance LOI.** Bet C compounds the COI moat — the data we accumulate becomes the slide for any future broker or insurer conversation. Week-1 outreach, week-3 prototype, week-8 live.
3. **Re-frame the public landing page for the real-estate investor ICP.** Same product, different message. JobTread playbook. 2 weeks of work; signal in 60 days if 5 paying investors close. Deliberately deferred from the in-app rollout — marketing-site task.
4. **Start the founder-led YouTube channel.** 1 video/week. AI-on-the-jobsite POV. Phone + DaVinci Resolve. The compounding distribution moat starts now, not at $1M ARR.
5. **Track waitlist counts per `event_key` weekly.** Simple Supabase query against `feature_interest`. The numbers ARE the partner-negotiation leverage. Slack yourself the totals every Friday.
6. **Ship Tier B feature audit items #9 (AI weekly client update) and #11 (punch-on-plan)** ONLY if revenue products land partner-blocked. These close named JobTread/Buildertrend gaps; ship if you have a free week.
7. **Do not ship the QBO real two-way sync until at least one revenue product is live with a partner.** It's the #1 dealbreaker for $500k+ GCs per the features audit — but per strategy doc, revenue layer comes first.

---

## 60-second elevator pitch

> "MAGE ID is the construction app for solo and small-team contractors — a residential and small-commercial GC's whole back office. Estimates, schedules, AIA pay apps, invoices, daily reports, photo timelines, client portal. We start at $29 a month because the price isn't the differentiator. The differentiator is what's under the hood: every payment, sub payout, and insurance renewal routes through our rails, so we make money on the workflow the way Toast makes money on restaurants — a tiny slice of every transaction, baked in. Year three: factoring, financing, an insurance marketplace, a sub-bid network. The five-year version is what ServiceTitan became for HVAC — fintech revenue larger than subscription revenue. We're solo-founder, pre-TestFlight, validating partner-revenue products via in-app waitlists today so the LOI conversations carry numbers, not hopes."

---

## What NOT to do (pinned reminders from the strategy doc)

- Don't say *"$1B outcome guaranteed."* Say *"5% probability per the reference class — and here's how we move up the ladder."*
- Don't pitch *"AI-first construction software."* AI is table stakes. Pitch *workflow depth*.
- Don't quote a TAM that requires 100% market capture. Realistic seat-only ceiling is $30–50M ARR.
- Don't sign with Synapse-style embedded banking partners — only Treasury Prime, Increase, or Stripe.
- Don't build the materials marketplace. Don't build the lead-gen marketplace. Don't pursue Procore-tier enterprise.
- Don't ship a feature that lets a dollar of value flow off-platform. Reject the PR.
- Don't burn the quarter on three booths or a 50-feature roadmap. Ship Wisetack. Ship Coterie. Ship the YouTube channel.
- Don't apologize for being solo. Solo is the speed advantage.

---

End of manual.
