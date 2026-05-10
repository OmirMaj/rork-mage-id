# Marketing content briefs — 8 metro permit guides + supporting pieces

Briefs for the long-form SEO content surfaced in the May 2026 SEO audit.
Each guide targets a head term ("how to file a [city] building permit") plus
3-5 long-tail queries ("[city] permit fees", "[city] DOB inspection schedule").
Source material lives in `utils/codeLibrary.ts` (172 verbatim code sections).

Publish location: `/permits/{slug}.html` — create the `/permits/` folder when
the first guide ships.

---

## 1. NYC — "How to file a NYC DOB Build permit (full 2026 guide)"

- **Slug:** `/permits/nyc-dob-permit-guide.html`
- **Primary keyword:** how to file a NYC DOB permit
- **Secondary keywords:** NYC DOB NOW Build, DOB permit fees, PW2 form, PE/RA sign-off, NYC homeowner permit
- **Search intent:** Informational with strong commercial follow-through (people researching how to file are about to hire someone or buy software)
- **Target length:** 2,200–2,800 words
- **Target audience:** Residential GC, small commercial GC, owner-builder homeowners

### Outline
1. **What requires a permit in NYC** (the threshold-of-work table from BC §28-105) — minor work vs alteration vs new construction
2. **DOB NOW: Build walkthrough** — account creation, app entry, PW1 → PW2 → PW3 flow, fees calculator
3. **Documents required** — PE/RA sealed plans, ZD1 zoning calculation, TR1 / TR8 special inspection forms, energy code analysis, asbestos ACP-5/ACP-7
4. **Common rejection reasons** — wrong ZD1 math (R6 FAR + open space ratio), missing TR1, undeclared sprinkler scope, missing LL97 baseline for buildings >25K sf
5. **Timeline** — pre-filing 1-2 weeks, plan review 2-6 weeks first-pass, audits add 3-8 weeks
6. **Fee structure** — alteration $130 minimum + $5 per $1,000 of cost (PW3 self-certified), occupancy group multipliers
7. **Pro-cert vs standard filing** — when self-cert saves time, when it backfires (audit risk)
8. **Local laws to think about during filing** — LL97 (carbon), LL11/FISP (facade), LL152 (gas inspection), LL31 (lead)
9. **CTA:** Try the Permit Q&A agent for any DOB question

### Links to source
- `utils/codeLibrary.ts` NYC entries: ZR §11-43, BC §28-105, BC §28-104, AC §28-302, AC §28-320.3, ECC §C405
- nyc.gov/site/buildings/industry/filing-permit-applications.page

### Internal links
- → `/features/permit-qa.html`
- → `/tools/ll97-calculator.html`
- → `/features/vs-takeoff.html` (for the estimating angle)

---

## 2. Los Angeles — "How to pull an LA building permit (residential + small commercial)"

- **Slug:** `/permits/los-angeles-building-permit.html`
- **Primary keyword:** how to pull an LA building permit
- **Secondary keywords:** LADBS plan check, LA Express Permit, mansionization ordinance, LAMC §12.21.1, Title 24 energy
- **Target length:** 2,200–2,800 words

### Outline
1. **LADBS structure** — Plan Check, Express Permit Counter, Online Permits portal
2. **What you can self-permit (Express)** — water heater, reroof, panel upgrade, HVAC swap
3. **Plan-check track** — single-family, ADU, mansionization
4. **Baseline Mansionization Ordinance (BMO)** — LAMC §12.21.1, FAR 0.45/0.50, applies to R1 lots, BMO Tier 1 vs Tier 2 (Hillside, Coastal)
5. **CalGreen + Title 24** — Title 24 Part 6 energy compliance forms, CF1R prescriptive vs performance, CalGreen Tier 1 / Tier 2 for residential
6. **Chapter 7A** — Wildland-Urban Interface fire requirements (ignition-resistant siding, ember-resistant vents)
7. **Solar mandates** — Title 24 PV requirement for new homes 2020+
8. **Soft-story retrofit** — LA Ordinance 183893 mandate for wood-frame multifamily
9. **Timeline + fees** — plan check 4-8 weeks, fees vary by valuation
10. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` LA entries: LAMC §12.21.1, CBC §701A, T24 §150.1, CalGreen Section 4

---

## 3. Chicago — "Chicago building permit guide (E-Plan, ARO, ADU pilot)"

- **Slug:** `/permits/chicago-building-permit-guide.html`
- **Primary keyword:** how to file a Chicago building permit
- **Secondary keywords:** Chicago E-Plan, ARO affordable requirements, Chicago ADU pilot, CDOT permit, Pilsen 606 zoning
- **Target length:** 2,000–2,400 words

### Outline
1. **Chicago Permits Portal + E-Plan** — basic, easy, standard tracks
2. **Affordable Requirements Ordinance (ARO)** — 10-unit threshold, on-site/in-lieu fee/off-site
3. **ADU pilot zones** — 5 pilot zones (North, Southeast, etc.), how to apply, BLA permit
4. **CDOT scaffolding + curb cut** — separate permit, hot dispatch fee
5. **606/Pilsen demolition surtax** — anti-displacement ordinance trigger
6. **Energy code** — Chicago Energy Conservation Code (CECC) — adopted IECC 2018 with amendments
7. **Inspections + final** — TCO vs CO process
8. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` Chicago entries: CCC, CZO, ARO, ADU pilot, 606/Pilsen

---

## 4. Houston — "How to pull a Houston building permit (post-Harvey floodplain)"

- **Slug:** `/permits/houston-building-permit.html`
- **Primary keyword:** how to pull a Houston building permit
- **Secondary keywords:** Houston floodplain BFE+2, Chapter 19 floodplain, Houston solar rights, IRC compliance
- **Target length:** 1,800–2,200 words

### Outline
1. **Houston Permitting Center** — iPermits, plan review tracks
2. **No zoning, but…** — deed restrictions, plat restrictions, HOA covenants
3. **Floodplain — the post-Harvey rules** — COO Ch.19 §19-22, BFE+2 in 500-year floodplain, mandatory elevation certificate
4. **Solar rights** — Texas property code §202.010 supersedes HOA prohibitions
5. **Energy code** — IRC 2015 adopted, no Title-24-style stringency
6. **Inspections** — TGV (Texas Geo-spatial Viewer) for floodplain check before filing
7. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` Houston entries: COO Ch 19/33/42, TX Solar Rights

---

## 5. Miami-Dade — "Miami-Dade permits + post-Surfside recertification (2026)"

- **Slug:** `/permits/miami-dade-permit-guide.html`
- **Primary keyword:** Miami-Dade building permit guide
- **Secondary keywords:** post-Surfside recertification, 30-year recert, FBC HVHZ, Miami 21 form-based zoning, SB 4-D
- **Target length:** 2,000–2,400 words

### Outline
1. **Miami-Dade vs municipalities** — when MD county permits vs city of Miami / Miami Beach / Coral Gables
2. **FBC HVHZ — High Velocity Hurricane Zone** — wind load, impact glazing, NOA (Notice of Acceptance) products
3. **Miami 21 form-based code** — T3/T4/T5/T6 transect zones, plinth/middle/top requirements
4. **Post-Surfside Senate Bill 4-D** — Phase 1 milestone inspection at 25 yr coastal / 30 yr inland, every 10 yr after, mandatory reserve studies for condos
5. **Permit categories** — Master Building Permit + subs (plumbing, electrical, mechanical, roofing)
6. **Common rejections** — missing NOA on impact products, undeclared structural changes, missing SIRS study for 30+ year condos
7. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` Miami entries: FBC HVHZ, Miami 21, SB 4-D recertification

---

## 6. Phoenix — "Phoenix permits + SolarAPP+ (the fast track)"

- **Slug:** `/permits/phoenix-permit-guide.html`
- **Primary keyword:** Phoenix building permit guide
- **Secondary keywords:** SolarAPP+ Phoenix, stucco lath inspection, PRC Phoenix Residential Code, MAG Maricopa County
- **Target length:** 1,800–2,200 words

### Outline
1. **Phoenix Planning & Development Department** — online portal, e-plan review
2. **SolarAPP+ — same-day rooftop solar permits** — Phoenix was an early adopter; how to qualify, the size + inverter limits
3. **Stucco lath sequence** — PCC R703.6 — WRB, lath, scratch coat, brown, finish, cure times
4. **PRC vs PCC** — Residential code (R) vs commercial Construction Code (C)
5. **Heat & sun rules** — Title 39 cool roof, urban heat island setback adjustments
6. **MAG soil report** — Maricopa Association of Governments soil classification when geotech required
7. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` Phoenix entries: PCC, PRC, PZO, MAG, SolarAPP+

---

## 7. Seattle — "Seattle building permits + tree code + MHA (everything that gets you stuck)"

- **Slug:** `/permits/seattle-permit-guide.html`
- **Primary keyword:** Seattle building permit guide
- **Secondary keywords:** SDCI portal, Mandatory Housing Affordability (MHA), Seattle tree code, SEC Seattle Energy Code, KCC King County
- **Target length:** 2,000–2,400 words

### Outline
1. **SDCI (Seattle Department of Construction & Inspections)** — Accela portal, project-types
2. **Mandatory Housing Affordability (MHA)** — when triggered (urban village zones), payment/performance options
3. **Seattle Tree Code** — Tier 1 / Tier 2 / Tier 3 / Tier 4 trees, removal permits, replacement requirements
4. **SEC — Seattle Energy Code** — stricter than IECC, often requires heat pumps as practical compliance path
5. **King County overlay** — when Seattle vs KC permitting applies
6. **Site-Specific Considerations** — ECA (Environmentally Critical Areas), shoreline overlays
7. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` Seattle entries: SMC, SEC, MHA, Tree Code, KCC

---

## 8. San Francisco — "San Francisco building permits + AB-112 all-electric guide"

- **Slug:** `/permits/san-francisco-permit-guide.html`
- **Primary keyword:** how to pull a San Francisco building permit
- **Secondary keywords:** SF DBI permit, AB-112 all-electric, SF Articles 10/11 historic, SFPC, SFBC
- **Target length:** 2,000–2,400 words

### Outline
1. **SF DBI** — three tracks: over-the-counter, in-house review, full plan review
2. **AB-112 / Environment Code §707** — all-electric ordinance for new construction, restaurant fit-out exceptions
3. **Articles 10/11 historic** — landmark + conservation district review, COA (Certificate of Appropriateness)
4. **Soft-story retrofit** — Ordinance 66-13 wood-frame retrofit deadline + compliance
5. **SFPC / SFBC base codes** — adopted CBC with SF amendments
6. **Common rejections** — undeclared change of occupancy, missing seismic upgrade trigger, gas line in scope (post AB-112)
7. **CTA:** Permit Q&A

### Source
- `utils/codeLibrary.ts` SF entries: SFPC, SFBC, AB-112, Articles 10/11

---

# Supporting content (Phase 2)

After the 8 metro guides are live, ship these in order of search demand:

## 9. Glossary hub `/glossary/`

~30 short pages, ~300 words each. Each one is a definitional landing page with cross-links to feature pages where the term is used in MAGE ID.

### Initial term list (ranked by search volume estimate)
1. AIA G702/G703 pay application
2. RFI (Request for Information) — construction
3. Change order
4. Submittal log
5. Punch list
6. EVM — Earned Value Management
7. DFR — Daily Field Report
8. OFCI / OFOI — Owner-Furnished, Contractor-Installed
9. Draw period
10. Lien waiver — conditional vs unconditional
11. AHJ — Authority Having Jurisdiction
12. DOB — Department of Buildings
13. ZR — Zoning Resolution
14. FAR — Floor Area Ratio
15. BFE — Base Flood Elevation
16. LL97 (NYC Local Law 97)
17. LL11 / FISP
18. WIP — Work in Progress (construction accounting)
19. A/R aging
20. NAICS code
21. SAM.gov
22. SOV — Schedule of Values
23. Notice to Proceed
24. Substantial completion
25. TCO vs CO (Temp Certificate of Occupancy)
26. T&M vs lump sum
27. CCD — Construction Change Directive
28. Prequalification
29. 1099-NEC (vs 1099-MISC)
30. Mechanic's lien

---

## 10. Templates & calculators `/templates/`

After the LL97 calculator works, add these:
- **Free construction estimate template** (XLSX + PDF download, email gate)
- **Free WIP report template** (XLSX)
- **Free AIA G702/G703 template** (XLSX, the actual form is AIA copyright so we provide a working sheet that mirrors the schema)
- **Free 1099-NEC summary sheet** for year-end
- **Hours-to-completion calculator** (interactive, project type + sf + crew size → days)
- **NYC LL11/FISP cycle calculator** (when's my next inspection due)
- **Miami-Dade 30-year recert eligibility calculator**
- **Subcontractor lien-waiver tracker** (printable matrix)

Each template page: 600-1,000 words of explainer copy + download, with email gate (drop a sub-page into Convertkit or whatever email tool).

---

## 11. "How to" blog series `/blog/`

Cadence: 1 post/week. Cluster the first 12 posts to drive internal linking density on the metro permit hubs.

1. How to fill out an AIA G702/G703 pay application (with template)
2. How to write a daily field report in 60 seconds with voice capture
3. How to send a change order that won't be rejected
4. How to do a sub buyout that actually closes
5. How to read a set of architectural drawings (the 30-min primer)
6. How to bill a draw to a construction lender
7. How to write a punch list that actually gets closed
8. How to file an RFI without sounding like a junior PE
9. How to negotiate a 1% retainage release
10. How to build a project schedule that doesn't slip
11. How to manage OFCI/OFOI without losing your mind
12. How to do a job-cost variance report (and why it matters at 30% complete)

---

# How to publish

1. Each guide gets `<link rel="canonical">`, `<meta name="description">`, OG tags, FAQPage JSON-LD with 3-5 Q&A pairs.
2. Each guide cross-links to: the related metro entry in /features/permit-qa.html, the LL97 calculator (where relevant), and at least one other guide.
3. Update `sitemap.xml` to include each guide as it ships.
4. Submit updated sitemap to Google Search Console after each batch.
5. Aim for one publish per week. The compounding effect on rankings is what wins long-term — don't try to ship all 8 at once.

# Expected outcome

After 6-12 months of consistent publishing on this calendar, mageid.app
should rank in the top 10 for at least:

- "how to file a NYC DOB permit"
- "how to pull a Los Angeles building permit"
- "Buildertrend alternative"
- "Procore alternative for small contractors"
- "AI permit checker"
- "NYC LL97 calculator"
- "free construction estimate template"

Combined estimated search volume for these head terms: **15,000-25,000/mo**,
with another 30,000-50,000/mo across the long-tail.
