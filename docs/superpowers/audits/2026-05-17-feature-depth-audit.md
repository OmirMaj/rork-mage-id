# MAGE ID — Feature-Depth Audit ("make contractors love it")

Date: 2026-05-17
Method: 4 parallel agents against shipped `main` (HEAD c8f7359) — money spine, field/PM loop, client+subs relationship surfaces (all real code, file:line), + external competitive research (G2/Capterra/Reddit user voice). Lens: NOT bugs/dead-ends (already audited). Question: is each feature *deep enough that a contractor relies on it daily and loves it*, or a thin shell — and where does the market say depth creates love/word-of-mouth/lock-in.
Status: findings + ranked depth investments. Not yet implemented.

## Verdict (read first)

**The engines are genuinely deep; the love-making layer is thin.** MAGE already out-depths thin-shell rivals where it counts: real CPM scheduling (float/anchors/leveling/weather-ripple), correct AIA G702/G703 + retainage + partial payments, a 42-assembly/21-template estimator, an auto-compiled lifetime closeout binder, a realtime homeowner portal with true 2-way messaging. A solo/fixed-price residential GC would already find this powerful.

It's **lopsided**, and the internal audit + external market evidence point at the *same* shallow spots:
- **Iteration betrays the GC.** Estimates silently overwrite — no version history (every real job re-prices 2–4×). The market's #1 loved estimating depth (JobTread/Houzz) is exactly versioned, assembly-driven, proposal-grade estimating.
- **The app stores the loop instead of running it.** No payment reminders (overdue is computed, nothing sends); NextStepHero ignores schedule/inspection/weather though all inputs exist; the project hub is a 25-tile filing cabinet. The market's single most "worth it alone" feature (Jobber) is automated follow-up.
- **Retrieval & client polish are the shallow half.** Photo *capture/triage* is deep; photo *library/search* and the portal gallery (capped at 9, no lightbox) are weak — yet organized + shareable photos are the #1 retention/word-of-mouth hook in the market (CompanyCam).
- **Sub-risk is decorative.** COI expiry, lien waivers, and prequal never gate award or payment — "demos like a 9, protects like a 4." The market shows this is genuine small-GC whitespace (leapfrog, not catch-up).
- **One latent trust bug:** the financial roll-up reads `project.estimate?.grandTotal` while every estimator writes `project.linkedEstimate` — budget vs. contract totals can silently disagree. Fix before deepening anything money-adjacent.

Net: don't add breadth. Deepen the ~6 things below — each is independently validated by *both* our code and outside user voice as where depth converts to love, referrals, and lock-in for small GCs.

## Scorecard (condensed)

| Area | Engine depth | Love-layer depth | Net |
|---|---|---|---|
| Estimating | DEEP (assemblies/templates/labor) | SHALLOW (no versioning; can't author assemblies/rates; thin proposal) | **Lopsided** |
| Getting paid | DEEP (retainage, partial, AIA G702/703, Stripe close-loop) | SHALLOW (zero reminders/dunning) | **Lopsided** |
| Scheduling | DEEP (real CPM, Today/Lookahead) | ADEQUATE (not surfaced on hub) | Good, under-surfaced |
| Daily reports | DEEP (voice/AI/auto-manpower) | SHALLOW (no signature/lock → weak legal value) | Lopsided |
| Photos | DEEP (AI triage→records) | SHALLOW (no library/search; portal cap 9, no lightbox) | **Lopsided** |
| Project hub / "what matters today" | engines exist | SHALLOW (tile grid w/ raw counts; NextStepHero ignores field loop) | **Shallow** |
| Client portal | DEEP (realtime, 2-way msg, closeout binder) | SHALLOW spots (cosmetic e-sign; stale w/o GC revisit) | Mostly deep |
| Sub risk (COI/lien/prequal) | data + engines exist | SHALLOW (everything is a soft warning; gates nothing) | **False confidence** |
| Financial roll-up | DEEP | latent bug (`estimate` vs `linkedEstimate`) | Quick must-fix |

## Tier 0 — Quick trust must-fix (surfaced by the audit; ~S)

- **F0. Unify the financial spine on one estimate source.** `utils/projectFinancials.ts:17,32` reads `project.estimate?.grandTotal`; the wizard/estimator write `project.linkedEstimate` (contract engine reads `linkedEstimate ?? estimate`, `contractEngine.ts:131`). Budget dashboard and contract value can show different totals for the same job. One shared accessor. **Do this before any money-side depth work.** S.

## Tier 1 — Deepen these to be LOVED (cross-validated internal + market)

- **D1. Estimate versioning + author-your-own assemblies/rates + polished e-signable proposal.**
  Now: `buildLinkedEstimate` overwrites; no `estimateHistory`; assemblies hardcoded (`constants/assemblies.ts`, can't add own/override rates); result view is a number, not a client proposal.
  Deep: immutable snapshots ("Rev A $142k → Rev B $151k" + what-changed diff), GC-authored assemblies & per-project cost-book, one-tap branded proposal the client e-signs.
  Why: Money agent's #1 felt-gap (every job re-prices 2–4× and the prior number is silently destroyed) **and** the market's clearest lock-in (JobTread "5–6h→1h", Houzz "estimate→signed in one meeting"; Jobber actively punished for shallow estimating). Effort: **L** (phase it — versioning first, S/M, since it currently destroys data).

- **D2. Automated getting-paid loop (reminders/dunning).**
  Now: overdue computed everywhere (`projectFinancials.ts:93`), nothing sends.
  Deep: configurable polite→firm reminder cadence on overdue invoices via the existing email/notification fan-out; "it chases payment for me."
  Why: invoicing is already DEEP — this is the missing 10% that the market calls "worth the subscription alone" (Jobber). Highest emotional ROI vs. effort; infra exists. Effort: **M**.

- **D3. Photo library + client-facing live gallery/timeline.**
  Now: `photo-triage.tsx` deep per-batch, but no durable album/tag/search; portal hard-caps 9 thumbnails, dead "+N", no lightbox (`client-view.tsx:889`).
  Deep: auto-album by date/phase/location, persisted AI tags + search ("all electrical-rough photos"), full-screen client gallery + shareable live timeline.
  Why: Field #5 + Client #6 internally; the market's #1 retention + word-of-mouth hook (CompanyCam) — the "show my friends this app" moment. Effort: **M**.

- **D4. Make sub-risk real (gate, don't decorate).**
  Now: COI expiry display-only; lien waivers never touch the payment path; prequal always offers "Award anyway" (`buyout-package.tsx:212-235`).
  Deep: COI expiry/endorsement blocks (or hard-confirms) award + sub payment; conditional/unconditional lien waiver required at draw/final; per-project "require prequal+valid COI" policy that actually enforces.
  Why: Client/subs agent ("protects like a 4") **and** genuine small-GC market whitespace (#12) — a leapfrog differentiator, not catch-up. Effort: **M**.

## Tier 2 — Strong internal signal, market-aligned

- **D5. Project hub → command center; NextStepHero learns the field loop.** Hub is a 25-tile grid w/ raw counts (`project-detail.tsx:1374`); NextStepHero has zero schedule/inspection/weather rules though CPM/permits/weather all exist. Deep: "Today on this job" strip (tasks behind/critical, RFIs aging, inspections this week, weather risk, overdue waivers) + NextStepHero rules for them. Turns "you drive it" into "it drives your day." Effort: **M**.
- **D6. Client-portal credibility.** E-sign is a stroke-count string, no rendered signature/signed-CO PDF artifact (`client-view.tsx:353`); rich snapshot only refreshes when the GC reopens the project (no cron) so the "live" promise can lie. Deep: capture SignaturePad image → stamped signed-CO PDF stored + shown both parties; nightly snapshot-refresh edge fn for active portals. Effort: **M**.
- **D7. Sign & lock the daily report.** `DailyFieldReport` has no signature; `status:'sent'` stays editable. Deep: "Sign & submit" (SignaturePad already exists) freezes the record (edits → revision). Turns the DFR into the legally-useful delay-claim doc. Effort: **S**.

## Differentiator / cheap

- **D8. Anti-lock-in, marketed.** One-tap full export (projects, photos, PDFs, estimates). The loudest trust complaint about Buildertrend/Procore is data captivity (#9); cheap to build, direct acquisition wedge ("your data is always yours"). Effort: **S**.

## Recommended sequencing

1. **F0 now** (latent money-trust bug; S; gates D1/D2 correctness).
2. **D2 + D7 first depth batch** (M + S, both lean on existing infra, fastest "love" per effort — automated follow-up + a legally-real DFR).
3. **D1 phased** (versioning first — it currently destroys data — then GC-authored assemblies, then proposal/e-sign). The biggest lock-in lever; also the largest.
4. **D3, D4** next (photo library/gallery; sub-risk gating) — top word-of-mouth + the leapfrog differentiator.
5. **D5, D6** (command-center hub; portal credibility) as the "it runs my day / I look pro" pass.
6. **D8** opportunistically (cheap differentiator).

Each item is independently shippable + OTA-able. F0 is the only one that's a correctness fix rather than a depth play — treat as urgent.
