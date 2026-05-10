// permitCorpus.ts — research-derived permit / DOB rules per metro.
//
// Source: a 460s research run that pulled from .gov department sites,
// industry publications (ENR, BuildZoom, Construction Dive), and
// public open-data portals. Last refreshed 2026-05-10.
//
// Each metro entry is the system-prompt context the Permit Q&A agent
// injects when the user asks a question scoped to that jurisdiction.
// Designed to be read by an LLM, not by a human (terse, fact-dense,
// no decorative formatting).
//
// The full markdown reference doc lives in the user's Google Drive:
//   "MAGE ID — Permit Rules Corpus (research output 2026-05-10)"
// — keep this file in sync with the Drive doc when adding metros.

export type MetroKey =
  | 'NYC'
  | 'Long Island'
  | 'LA'
  | 'Chicago'
  | 'Houston'
  | 'Phoenix'
  | 'Miami'
  | 'Seattle'
  | 'SF';

export const PERMIT_CORPUS: Record<MetroKey, string> = {
  NYC: `
NYC Department of Buildings (DOB) — covers all 5 boroughs. Most filings route through DOB NOW: Build (e-filing successor to BIS).

FILING TYPES:
- PW1: Plan/Work Approval Application (foundational form, digitized in DOB NOW)
- NB (New Building): ground-up new construction, RA/PE required
- Alt-1: major alteration changing use, egress, or occupancy → new/amended CofO; RA/PE required
- Alt-2: multiple types of work without changing use/egress/occupancy; RA/PE required
- Alt-3: one discrete trade, sometimes self-fileable
- DM: full or partial demolition
- LAA (Limited Alteration Application): plumbing/sprinkler/standpipe/oil-burner; licensed master plumber/master fire-suppression piping/oil-burner only. Cat 1 capped at $35K/building/12 mo; Cat 2 uncapped.
- TPP (Tenant Protection Plan): required for occupied multi-family alterations; not for LAAs

TIMELINES:
- Alt-3: 2–4 weeks
- Alt-2: 4–8 weeks (Standard Plan Examination)
- Alt-1: 8–16 weeks
- NB: 3–6 months
- Pro Cert (Professional Certification by RA/PE) shaves 8–10 weeks off Standard Plan Exam — half the file under Pro Cert skips the plan-examiner queue

TOP REJECTION REASONS:
1. Zoning Resolution non-compliance (FAR overage, sky exposure plane, use group conflicts) — biggest source on residential alterations
2. Egress / fire-stair widths under NYC BC Ch. 10
3. Energy Code (NYECC) deficiencies — missing TR8, no envelope U-values, inadequate ECCNYS support
4. Special Inspection (BC Ch. 17) gaps — no SIA designated, missing TR1
5. Inconsistent forms vs. drawings — story counts, occupancy, zoning lot info not matching across PW1/PD1/plans (auto-rejection at intake)

FEES: valuation-based.
- 1-/2-/3-family alteration: $2.60 per $1,000 of cost above first $5K
- Other residential alteration: ~$13 per $1,000 over first $5K + $100 base
- $200K residential reno indicative DOB filing fee: ~$2,600–$2,700, before architect/expediter, special inspections, FDNY fees, asbestos investigation

INSPECTIONS (Alt-2 typical): foundation/underpinning (if any), structural (if any), plumbing rough, sprinkler rough, electrical (separate ED1/EL2), insulation, energy code progress (TR8), final building, sign-off (CofO amendment if Alt-1)

QUIRKS:
- Special Inspections (BC Ch. 17) heavier than IBC baseline — soils, structural welding, post-installed anchors, fire-resistant penetrations need TR1 with designated SIA
- Asbestos Investigation (ACP-5/ACP-7) required for nearly every Alt and DM in pre-1988 buildings
- Sidewalk shed / supported scaffold permits trigger separate filings, very high carrying cost
- Local Law 11/Façade, LL97/Carbon, LL152/Gas drive a parallel compliance calendar permits won't surface

PUBLIC DATA: DOB NOW Build Approved Permits + DOB Permit Issuance + DOB Job Application Filings — all on data.cityofnewyork.us via Socrata SODA, JSON, daily refresh, free.
`.trim(),

  'Long Island': `
SUFFOLK COUNTY: no county-wide building department. 10 towns + 33 incorporated villages each have their own. Suffolk County DOH Wastewater Management controls septic — major gating step.
NASSAU COUNTY: same pattern. 3 towns (Hempstead, North Hempstead, Oyster Bay) + 2 cities (Glen Cove, Long Beach) + 64 villages. Nassau DPW reviews county roads/drainage only.

FILING TYPES (any LI town):
- Building Permit (alteration, addition, new SFD)
- ZBA variance / special exception when setbacks/use don't comply
- ARB (Architectural Review Board) common in villages
- Suffolk DOH Article 6 permit: required for new construction, replacement dwelling, bedroom addition (increases design flow), or septic replacement
- NYSDEC tidal/freshwater wetlands permit on coastal parcels

TIMELINES:
- Town building permit: 2–8 weeks (some 8–12 in peak)
- Suffolk DOH Article 6 review: 4–12 weeks for I/A OWTS designs
- Hempstead Fast Track: 1–2 weeks for simple repairs
- New SFD with septic + wetlands: 6–12 months end-to-end

TOP REJECTION REASONS (LI):
1. Suffolk Article 6 / I/A OWTS — since 7/1/2021 all new construction needs Innovative/Alternative OWTS, not conventional septic
2. Setbacks / zoning, especially Hamptons (E. Hampton, Southampton, Southold)
3. NYSDEC tidal/freshwater wetlands — 100/300 ft adjacent area
4. FEMA / flood elevation in coastal V/AE zones
5. Nassau: variance triggers — older neighborhoods routinely need ZBA

FEES: town-set, generally low/flat or per-sf. $200K reno: ~$300–$1,500 in town fees + Suffolk DOH ($500–$2,500) + wetlands fees if applicable. Order of magnitude cheaper than NYC.

INSPECTIONS: foundation, framing, plumbing rough, electrical (3rd-party agency: Commonwealth, NYBFU — NOT the town), insulation, final, CofO. New SFD adds Suffolk DOH septic inspections.

QUIRKS:
- Every town is its own jurisdiction — Brookhaven won't help with Islip code
- Electrical inspections are 3rd-party agencies, not town
- I/A OWTS adds $15K–$30K cost to a new Suffolk SFD
- Hamptons towns are slow + design-restrictive; ARB common
- Nassau open-permit history routinely surfaces on title work, blocks new permits until cured
- Permits expire 6–18 months depending on town
`.trim(),

  LA: `
City of LA = LADBS. Unincorporated LA County = LA County Public Works. Most volume is City under LADBS.

FILING TYPES:
- Express Permit: no plan review (re-roof, water heater, AC change-out, simple electrical)
- Counter Plan Check (CPC): small projects reviewed by engineer at counter, often same-day
- Expanded Counter Plan Check (E-CPC): slightly larger scope
- Regular Plan Check (RPC): full plan review; default for additions, larger remodels, new SFD/duplex
- Parallel Design Permitting Process (PDPP): staged review for complex projects; foundation issued while superstructure still in design
- Trade permits (electrical/plumbing/HVAC) pulled separately on PermitLA

TIMELINES:
- Express Permit: same day online via PermitLA
- Counter Plan Check: same-day to 1 week
- Regular Plan Check residential: first review ~3–4 weeks; total 4–10 weeks including 1–2 correction cycles
- Submission via ePlanLA portal

TOP REJECTION REASONS:
1. Zoning / setbacks / FAR (LAMC) — accessory setbacks, hillside grading, R1 variations
2. CalGreen + Title 24 energy compliance — missing T24 forms, mandatory measures, PV for new SFD
3. Structural / seismic — soft-story bracing, hold-downs, shear nailing schedules per LABC
4. Hillside / grading in HCR or VHFHSZ — non-combustible exterior, ember-resistant vents per Ch. 7A
5. Mello-Roos / school fees / sewer connection fees missing at issuance

FEES: valuation-based per LAMC §91.107 Table 1-A. Plan check = 90% of building permit fee. + CA SB 1473 ($4/$100K), CA Green ($4/$100K), LADBS records management ($160). $200K reno indicative: ~$3,500–$4,500 building permit + ~$3,200–$4,000 plan check + ~$200–$400 surcharges + trade permits separate.

INSPECTIONS (residential alteration): setback/foundation, foundation rebar, foundation form, anchor bolt, sub-floor, framing, shear/nailing, roof nailing, lath (if stucco), MEP rough, insulation, drywall nailing, lath/scratch coat, brown coat, final.

QUIRKS:
- Mandatory Soft-Story Retrofit (Ord. 183893): pre-1978 wood-frame multi-family with tuck-under parking. Active enforcement.
- Non-Ductile Concrete Retrofit (also Ord. 183893)
- VHFHSZ Chapter 7A wildfire hardening for new builds and major reroofs
- BSO / Specific Plans / HPOZ add parallel Planning review
- Mansionization / Baseline Hillside / Baseline Mansionization Ordinance restricts SFD size aggressively
`.trim(),

  Chicago: `
Chicago Department of Buildings (CDOB). Cook County itself does not issue building permits for incorporated areas — Chicago work is purely CDOB.

FILING TYPES (Nov 2023 reorg):
- Express Permit Program (EPP): like-for-like + minor reno, online without full plan review
- Standard Plan Review (SPR): default. Buildings ≤80 ft, residential ≤12 units, mercantile/institutional ≤100K sf, foundations ≤12 ft deep
- Developer Services: mandatory for >80 ft, complex high-rises, planned developments
- Self-Certification Permit Program: limited qualifying licensed architects, certain Type V residential, bypasses plan review
- Certified Plan Corrections: qualified architect can clear corrections without re-routing through CDOB plan review (excludes zoning, geotech, stormwater)

TIMELINES:
- Express Permit: 1–5 business days
- Standard Plan Review: target 53 calendar days; actual median ~70 days
- Complex projects: 12–20 weeks
- Developer Services: months
- Two real-time correction-mediation meetings mandatory if past 2 review cycles

TOP REJECTION REASONS:
1. Incomplete drawings — missing plumbing fixture counts, ventilation calcs, egress plan; auto-flag at intake
2. Zoning (DPD review for setbacks, FAR, parking, ADU)
3. Stormwater Management Ordinance compliance (≥7,500 sf disturbance triggers SMO)
4. Energy code (IECC + Chicago amendments) — envelope, blower-door, mech sizing
5. Fire-rated assemblies + concealed-space firestopping in two-flat / three-flat conversions

FEES: construction-type, occupancy, area-based (NOT pure valuation). Calculator at ipiweb.cityofchicago.org. Most $500–$5,000. Senior homeowners (65+) on 1-3 unit income-eligible buildings may waive. $200K reno indicative: ~$1,500–$3,500.

QUIRKS:
- City-licensed General Contractor registration required for permits >$25K (and most plumbing/electrical)
- Lead-paint pre-1978 enforcement; RRP firm cert required
- Self-Certification revocations are public + permanent
- Cook County does NOT issue building permits for Chicago (only unincorporated)

PUBLIC DATA: data.cityofchicago.org/Buildings/Building-Permits/ydr8-5enu (Socrata)
`.trim(),

  Houston: `
Largest US city WITHOUT zoning. Permits focus on building code compliance, floodplain (Chapter 19), and recorded deed restrictions.

FILING TYPES (Houston Permitting Center):
- Residential Repair Permit: like-for-like
- Residential Alteration Permit: interior reno without addition
- Residential Addition Permit: increases footprint or volume
- New Single-Family Construction Permit
- Trade permits — Electrical, Plumbing, Mechanical separate (NOT a single master permit)
- Chapter 19 Floodplain Development Permit: required additionally if parcel in 100-yr (Zone AE), 500-yr (Zone X500), or floodway

TIMELINES:
- Simple residential: 5–10 business days
- Complex residential (additions, new SFD): 2–4 weeks plan review; longer in spring/summer peak
- iPermits portal handles submissions; plan review fee = 25% of total permit fee

TOP REJECTION REASONS:
1. Chapter 19 floodplain compliance — finished floor below BFE+24" (Houston enforces +2 ft freeboard, stricter than FEMA)
2. Setback/parking under platting/subdivision ordinances (no zoning, but subdivision rules apply)
3. Wind-load / structural — Houston is wind-borne debris region; bracing, strapping, opening protection
4. Energy code (IECC) / blower-door — common for new SFD
5. Missing Master Trades licensee info on E/P/M permits

FEES: square-footage tiered, NOT valuation. Texas HB 852 prohibits cities from setting residential permit fees from value/cost. $200K reno + $50K reno can carry similar fees if same sf and trades. Typical residential alteration with 4 trades: $300–$900 total.

INSPECTIONS: foundation (form + reinforcing), wind strap/framing, electrical rough, plumbing rough (top-out), mechanical rough, insulation, gas pressure test, electrical final, plumbing final, mechanical final, building final.

QUIRKS:
- No zoning — but deed restrictions are city-enforceable. Always check restrictive covenants before designing setbacks/uses.
- Chapter 19 freeboard: 2 ft above BFE for new and substantial improvements (50% market value triggers full Ch 19 compliance)
- Separate Harris County Engineering Department for unincorporated areas
- Houston uses iPermits portal; Harris County uses Accela-like system
- Floodplain permits + detention requirements are big timeline drivers
`.trim(),

  Phoenix: `
City of Phoenix Planning & Development (PDD) handles incorporated City. Maricopa County P&D handles unincorporated. Most metro construction is municipal (Phoenix, Tempe, Mesa, Scottsdale, Chandler, Glendale).

FILING TYPES:
- Self-Certification Permits: re-roof, water heater, AC change-out — same day OTC
- Standard Residential Plan Review: default for additions, remodels, new SFD
- Commercial Plan Review: separate track
- Stand-alone trade permits

TIMELINES:
- Same-day OTC: re-roofs, water heater, AC
- Residential plan review: 10–15 business days first review; resubmittal another 10–15
- Standard residential issuance: ~60–75 days end-to-end with one correction cycle
- Plans not approvable after 3rd review require new submittal + full plan-fee re-payment

TOP REJECTION REASONS:
1. Site plan inaccuracy (most common) — setbacks, easements, distances to neighbors, septic clearances (10 ft to PL, 25 ft to septic, 15 ft to wells)
2. HOA / overlay / historic district non-compliance
3. Energy code (2018 IECC + AZ amendments) — envelope, duct sealing, mech sizing
4. Stucco/lath details — Phoenix is stucco-everywhere; lath fastening (16-ga staples 7" oc, ASTM C1063), weep screed clearances, two-coat over OSB rules
5. Structural for desert soils — expansive clay foundation requirements, post-tensioned slab specs

FEES: valuation-based. $200K reno indicative: ~$1,800–$2,800 building permit + plan review (~65% of permit fee) + state surcharges.

INSPECTIONS: foundation pre-pour, slab, framing, lath (after waterproof barrier, before scratch), MEP rough, insulation, drywall, stucco scratch, stucco brown, MEP final, building final.

QUIRKS:
- Stucco predominance — almost every wall assembly is 3-coat or 1-coat stucco; lath/weather barrier its own gating step
- Pool permits common, separate setback/barrier rules
- MAG (Maricopa Association of Governments) Building Code Amendments — local amendments to ICC codes used across Phoenix-metro
- Solar PV routinely required + routinely a hold-up (roof structural + electrical interconnection)
- Heat-related construction safety regs in summer affect inspection scheduling
`.trim(),

  Miami: `
Miami-Dade RER Building handles unincorporated areas. Each municipality (City of Miami, Miami Beach, Coral Gables, Hialeah, etc.) has its own building department under SAME county-wide product approval and HVHZ rules. ENTIRE COUNTY IS HVHZ.

FILING TYPES:
- Building Permit (Master Permit): main structural/architectural
- Sub-Permits: electrical, plumbing, mechanical, roofing, low-voltage (filed under master)
- Revisions: must re-route through plan review
- Window/door/garage/shutter permits: standalone with NOA review
- Recertification (40/30/25-year) — Building Recertification Program for older structures

TIMELINES:
- Initial plan review: 1–10 business days residential (varies RER vs. municipality)
- Total to issuance: 2 weeks – 3 months depending on revisions; most: 2–6 weeks through 2–3 cycles

TOP REJECTION REASONS:
1. Non-NOA products — every exterior envelope item (windows, doors, shutters, roof tile, soffit, garage door) MUST carry Miami-Dade Notice of Acceptance (NOA) or pass TAS 201/202/203
2. Wind-load calcs — must use 175 mph (Risk Cat II) 3-sec gust; component & cladding pressures often miscalculated
3. Impact glazing — all glazed openings must be impact-rated or covered by approved shutters; deemed-to-comply panels NOT allowed
4. Roofing — TAS 100/100A uplift, secondary water barrier, roof-to-wall connections
5. Flood / FEMA elevation — finished-floor in V/AE zones; coastal compliance

FEES: valuation-based with multiple line items: base permit + plan review + Building Code Compliance Fee + DBPR + state surcharges. $200K reno unincorporated Miami-Dade: ~$2,500–$4,500. Municipalities (Miami Beach, Coral Gables) tend higher. Roofing permits separately fee'd.

INSPECTIONS: pile (if applicable), foundation/tie beam, slab pre-pour, sheathing/wind strap, framing, roof in-progress, MEP rough, insulation, drywall, MEP finals, final building, CO (or CC for renovations).

QUIRKS:
- HVHZ — strictest exterior building product standards in continental US
- NOA — Miami-Dade Product Control Section maintains the database; verify current and not expired
- 40-Year Recertification (now plus 30 and 25) — post-Surfside expansion. Engineer's structural + electrical reports.
- Two parallel jurisdictions — RER for unincorporated + 30+ municipal departments under same county-wide rules. Always verify which authority has jurisdiction.
- Florida Building Code statewide; HVHZ chapters apply only Miami-Dade and Broward
`.trim(),

  Seattle: `
Seattle Department of Construction & Inspections (SDCI) covers City of Seattle. King County DLS handles unincorporated. Major suburbs (Bellevue, Redmond, Kirkland) have their own.

FILING TYPES:
- Subject-to-Field-Inspection (STFI): over-the-counter, no formal plan review
- Construction Permit – Addition or Alteration: default for residential reno
- Construction Permit – New Building (SFD/Duplex): pre-approved DADU plans available
- Construction Permit – Establishing Use: change of occupancy
- MUP (Master Use Permit): land use entitlement when SEPA, design review, or subdivision applies

TIMELINES:
- Pre-approved DADU: 4–6 weeks
- Standard SFD/duplex new: ~2 weeks SDCI initial review; 6–12 weeks total
- Complex new construction: ~8 weeks initial review
- SDCI publishes median plan-review-time dashboards. Calendar days "in city control" is roughly half applicant's elapsed time.

TOP REJECTION REASONS:
1. Energy code (Seattle Energy Code, beyond WSEC) — most stringent in US; envelope, mechanical, lighting, EV-ready, solar-ready triggers
2. Land use / zoning — design review thresholds, SEPA, lowrise vs. midrise translation, MHA (Mandatory Housing Affordability) fees
3. Stormwater (Drainage Code & GSI) — green stormwater infrastructure, flow control, water quality
4. Tree protection — exceptional trees, replacement, canopy preservation
5. Geotechnical — landslide/steep-slope, ECA (Environmentally Critical Area) overlays

FEES: valuation-based with hourly review charges layered in. ~75% at submittal, balance at issuance. $200K reno indicative: ~$3,000–$6,000 SDCI fees + King County surcharges + SBCC ($6.50).

INSPECTIONS: footings, foundation walls, slab, framing, shear wall, roof nailing, insulation, drywall, plumbing rough, mechanical rough, electrical rough (separate L&I some cases), final.

QUIRKS:
- Seattle Energy Code (SEC) is its own code amendment, stricter than WSEC; HVAC sizing, heat pumps, ventilation, lighting, commissioning more rigorous
- MHA fee-in-lieu triggered on new MF / commercial — large dollars, easy to miss
- Construction Permit Timeline tool (buildingconnections.seattle.gov) shows real applicant data per project type
- Electrical permits for some scopes go to Washington State L&I, not SDCI
- Seattle Services Portal is single-entry submission system
`.trim(),

  SF: `
SF DBI is building department; SF Planning is separate parallel review (entitlement). Many residential projects need both. Median DBI residency-related project = ~259 days at DBI alone, separate from Planning.

FILING TYPES:
- Over-the-Counter (OTC): same-day for simpler scopes (replace-in-kind, like work)
- Building Permit Application (BPA): full plan review
- Site Permit: entitlement-style, then addenda for structural, MEP, etc. (used on big projects)
- Soft-Story Retrofit Permit: most processed OTC
- No-Plan Permits: minor work without drawings

TIMELINES:
- OTC: same day
- Standard residential renovation: 5–8 weeks for design + permits with energy compliance up front; full BPA cycle typically 2–12 months
- DBI median hold ~259 days for housing; planning adds 2–6 months on top

TOP REJECTION REASONS:
1. Planning Department (separate) — discretionary review (DR), neighborhood notification, demo calc
2. Title 24 energy — added at submittal recently; lighting decorative allowance, mandatory PV, mandatory EV-ready trip up small GCs
3. Soft-story compliance in older multi-units (Tier 1–4 ordinance)
4. Accessibility (CBC Ch. 11A/11B) for multi-family and TI
5. Seismic — anchorage, hold-downs, retrofit obligations on substantial alterations

FEES: valuation-based per SF Building Code Table 1A-A. Roughly 6–9% of project value all-in (DBI fees, NOT including Planning, school, utilities). $200K reno indicative: ~$12,000–$18,000 DBI fees alone, before Planning. Scope ≤$200K may qualify for streamlined no-plans review depending on type.

INSPECTIONS: foundation, framing, shear, energy/insulation, MEP rough (DBI handles plumbing + some electrical; separate licensing for some electrical), drywall, T24 final compliance, final building.

QUIRKS:
- Mandatory Soft-Story Retrofit (Ch. 4D, SFEBC) — wood-frame multi-unit, 5+ residential units, 2+ stories over soft/weak story, permitted before 1/1/1978
- All-Electric New Construction (AB-112) — gas hookups banned in new construction
- Discretionary Review (DR) — any neighbor can trigger Planning Commission hearing on residential project; opaque + costly
- Vacant Building Surcharge / Speculator Tax — political environment is anti-flipping
- Title 24 Final Compliance Letter required from energy designer to clear final permit conditions
`.trim(),
};

/**
 * Builds a system-prompt prefix that injects the corpus for the
 * selected metro into the Permit Q&A agent. Calling this with a
 * metro key returns the right context block; the screen wraps it
 * in instructional framing.
 */
export function getMetroContext(metro: MetroKey): string {
  return PERMIT_CORPUS[metro] ?? '';
}

/**
 * Cross-jurisdiction operating principles — included with every
 * Q&A request regardless of metro selection. Keeps answers
 * grounded in research-backed defaults.
 */
export const CROSS_JURISDICTION_PRINCIPLES = `
GLOBAL PRINCIPLES (apply to every metro):
1. Identify which authority has jurisdiction BEFORE answering — Hempstead is not Nassau; Miami Beach is not Miami-Dade RER; LADBS is not LA County.
2. Anchor on FILING TYPE, not project description — "kitchen remodel" maps to Alt-2 in NYC, RPC in LA, EPP/SPR in Chicago, residential alteration in Houston.
3. Surface energy code early — most universal source of plan corrections across all 10 metros.
4. Always flag the local quirk — NOA in Miami-Dade, soft-story in SF, I/A OWTS in Suffolk, stucco lath in Phoenix, deed restrictions/floodplain in Houston, Ch. 17 special inspections in NYC.
5. Never invent timelines or fees — say "verify with [authority]" and cite the department site if uncertain.
6. Never give legal advice — suggest a licensed expediter / attorney for contested or jurisdiction-specific filings.
`.trim();
