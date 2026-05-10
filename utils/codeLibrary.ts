// codeLibrary.ts — research-derived public-code text library.
//
// Companion to permitCorpus.ts. permitCorpus = SYSTEM metadata (filing
// types, timelines, common rejections, fees). codeLibrary = actual
// CODE TEXT, quoted verbatim from public sources, citation-grade.
//
// v0.1 ships with ~10 high-impact NYC entries — the things small
// GCs ask about most:
//   - Zoning bulk regs (FAR, lot coverage, yards, setbacks, parking)
//   - Means of egress sizing
//   - Sprinkler triggers for residential
//   - Special inspections framework
//
// Sources: zr.planning.nyc.gov (public NYC Zoning Resolution), NYC
// Building Code text (NYC adopted it as law — public domain). Pulled
// 2026-05-10. The international codes that NYC adopts by reference
// (IBC, IRC, IECC) are NOT included — those are ICC copyright.
//
// v1.1 expansion lanes:
//   - LA, Chicago, Houston, Phoenix, Miami, Seattle, SF (per-metro
//     starter sets via tighter-scoped research agents)
//   - NYC Energy Code (NYECC) — separate fetch needed
//   - Detailed §1010/1011/1018 dimensions (corridor/stair/door widths)

export interface CodeSection {
  jurisdiction: string;          // 'NYC', 'LA', 'Chicago', etc.
  codeName: string;              // 'NYC Building Code', 'NYC Zoning Resolution', etc.
  sectionNumber: string;         // '23-21', 'BC §1005.3.1', '23-361'
  topic: CodeTopic[];            // Multi-tag for retrieval
  title: string;                 // Plain-English title
  textQuote: string;             // Verbatim code text
  summary: string;               // 1-line plain-English explanation
  appliesTo?: string;            // 'residential', 'multi-family 2+', etc.
  sourceUrl: string;             // Direct URL to the section
}

export type CodeTopic =
  | 'zoning'
  | 'far'
  | 'setbacks'
  | 'yards'
  | 'lot_coverage'
  | 'height'
  | 'parking'
  | 'egress'
  | 'doors'
  | 'stairs'
  | 'corridors'
  | 'fire_protection'
  | 'sprinklers'
  | 'fire_alarm'
  | 'special_inspections'
  | 'structure'
  | 'energy_envelope'
  | 'energy_mechanical'
  | 'energy_lighting'
  | 'plumbing'
  | 'mechanical'
  | 'roofing'
  | 'accessibility'
  | 'jurisdiction_specific';

export const CODE_LIBRARY: CodeSection[] = [
  // ─── NYC ZONING — FAR ──────────────────────────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-21',
    topic: ['zoning', 'far'],
    title: 'Maximum Floor Area Ratio (FAR) — R1 through R5 Districts',
    textQuote:
      'R1-2A, R1-1, R1-2, R2A, R2, R3A, R3X, R3-1, R3-2: 0.75 standard FAR; 1.00 for qualifying residential sites. ' +
      'R2X: 1.00 standard and qualifying. ' +
      'R4A, R4B, R4, R4-1: 1.00 standard FAR; 1.50 for qualifying sites.',
    summary:
      'Low-density NYC residential FAR caps. R1/R2/R3 generally 0.75 (1.00 qualifying); R4 gets 1.00 (1.50 qualifying).',
    appliesTo: 'low-density residential',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-22',
    topic: ['zoning', 'far'],
    title: 'Maximum Floor Area Ratio (FAR) — R6 through R12 Districts',
    textQuote:
      'R6A, R6-1, R7B: 3.00 standard FAR; 3.90 for qualifying affordable housing. ' +
      'R6 (general): 2.20 standard; 3.90 for qualifying affordable housing. ' +
      'R7A, R7-1A, R7-2A: 4.00 standard; 5.01 for qualifying affordable housing. ' +
      'R7-1, R7-2: 3.44 standard; 5.01 for qualifying affordable housing.',
    summary:
      'Mid- to high-density residential FAR caps. R6 ranges 2.20-3.00; R7 ranges 3.44-4.00; both can rise to 3.90-5.01 with qualifying affordable units.',
    appliesTo: 'multi-family',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },

  // ─── NYC ZONING — LOT COVERAGE ─────────────────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-361',
    topic: ['zoning', 'lot_coverage'],
    title: 'Lot Coverage — R1 through R5 Districts',
    textQuote:
      'Single- or two-family residences: R1 and R2 interior/through lots — 40 percent maximum lot coverage; corner lots — 80 percent. ' +
      'R3 interior/through — 50 percent; corner — 80 percent. ' +
      'R4 and R5 interior/through — 60 percent; corner — 80 percent.',
    summary:
      'NYC low-density residential lot coverage caps depend on lot type. Interior/through lots tighter than corner lots. R1/R2 = 40%; R3 = 50%; R4/R5 = 60%; corner lots universally 80%.',
    appliesTo: 'low-density residential',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-362',
    topic: ['zoning', 'lot_coverage'],
    title: 'Lot Coverage — R6 through R12 Districts',
    textQuote:
      'Standard maximum lot coverage: 80 percent for interior or through lots; 100 percent for corner lots.',
    summary:
      'Mid- to high-density residential allows 80% interior/through lot coverage and 100% corner lot coverage.',
    appliesTo: 'multi-family',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },

  // ─── NYC ZONING — YARD REQUIREMENTS ────────────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-321',
    topic: ['zoning', 'yards', 'setbacks'],
    title: 'Front Yard Requirements — R1 through R5',
    textQuote:
      'R1: 20 feet minimum front yard. ' +
      'R2, R2A, R2X, R3-1, R3-2: 15 feet. ' +
      'R3A, R3X, R4, R4-1, R4A, R5, R5A: 10 feet. ' +
      'R4B, R5B, R5D: 5 feet.',
    summary:
      'Front yard depth depends on residential district: R1 needs 20 ft, R2/R3-1/R3-2 need 15 ft, most R3-R5 need 10 ft, and certain low-bulk subdistricts (R4B, R5B, R5D) need only 5 ft.',
    appliesTo: 'low-density residential',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-322',
    topic: ['zoning', 'yards', 'setbacks'],
    title: 'Front Yard Requirements — R6 through R12',
    textQuote:
      'In R6, R7, R8, R9, R10, R11, and R12 Districts, no front yard requirements shall apply.',
    summary:
      'High-density residential districts (R6+) have NO front yard requirement — buildings can come to the street line.',
    appliesTo: 'multi-family',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §23-342',
    topic: ['zoning', 'yards', 'setbacks'],
    title: 'Rear Yard Requirements — Residential',
    textQuote:
      'For detached or zero lot line buildings: 20 feet rear yard at or below 75 feet building height; 30 feet for portions above 75 feet. ' +
      'Semi-detached or attached buildings on lots less than 40 ft wide: 30 feet rear yard. ' +
      'Semi-detached or attached buildings on lots 40 ft or more wide: 20 feet at or below 75 feet height; 30 feet above.',
    summary:
      'Standard residential rear yard is 20 ft below 75 ft building height, 30 ft above. Narrow lots (<40 ft wide) attached/semi-detached require 30 ft regardless of height.',
    appliesTo: 'residential',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-3',
  },

  // ─── NYC ZONING — HEIGHT & SETBACK ─────────────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §24-522',
    topic: ['zoning', 'height', 'setbacks'],
    title: 'Front Setback + Sky Exposure Plane — R6, R7, R8',
    textQuote:
      'Initial setback distance: 20 feet on narrow streets, 15 feet on wide streets. ' +
      'Maximum height within initial setback: R6 or R7 — 60 feet or six stories, whichever is less. R8, R9, R10, R11, R12 — 85 feet or nine stories, whichever is less. ' +
      'Sky exposure plane beyond setback: narrow streets — 2.7 to 1 ratio (vertical to horizontal). Wide streets — 5.6 to 1 ratio.',
    summary:
      'Mid-density NYC residential bulk: building wall must step back 15-20 ft from the street; the wall below that setback caps at 60 ft (R6/R7) or 85 ft (R8+); above the setback the building must stay below the sky exposure plane.',
    appliesTo: 'multi-family',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-4',
  },

  // ─── NYC ZONING — PARKING ──────────────────────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Zoning Resolution',
    sectionNumber: 'ZR §25-212',
    topic: ['zoning', 'parking'],
    title: 'Off-Street Parking — Inner Transit Zone',
    textQuote:
      'For dwelling units in multiple dwellings created July 20, 1950 through December 5, 2024: ' +
      'R1-R3: 100 percent of dwelling units must have an off-street space (Column A). ' +
      'R4: 100 percent (Column A); 1-space waiver maximum. ' +
      'R5: 85 percent (Column A); 1-space waiver maximum. ' +
      'R6-R7: 50 percent (Column A); waivers from 5 to 25 spaces. ' +
      'R8-R12: 40 percent (Column A); waivers from 30 to 75 spaces. ' +
      'Qualifying senior housing and income-restricted units: 0 percent (Column B).',
    summary:
      'Inner Transit Zone NYC parking ratios for new multi-family. Lower-density (R1-R3) requires 1 space per unit; mid-density (R6-R7) drops to 50%; high-density (R8-R12) is 40%. Senior + income-restricted units exempt.',
    appliesTo: 'multi-family',
    sourceUrl: 'https://zr.planning.nyc.gov/article-ii/chapter-5',
  },

  // ─── NYC BUILDING CODE — EGRESS ────────────────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1005.3.1',
    topic: ['egress', 'stairs'],
    title: 'Stairway Egress Capacity Factor',
    textQuote:
      'The capacity, in inches, of means of egress stairways shall be calculated by multiplying the occupant load served by such stairway by a means of egress capacity factor of 0.3 inch (7.6 mm) per occupant.',
    summary:
      'NYC stairway capacity formula: 0.3 inch of stair width per occupant. A stair serving 200 occupants needs 60 inches (5 ft) of width to be at capacity.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-building-code-2022/chapter/10/means-of-egress',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1005.3.2',
    topic: ['egress', 'doors', 'corridors'],
    title: 'Other Egress Capacity Factor (Doors, Corridors)',
    textQuote:
      'The capacity, in inches, of means of egress components other than stairways shall be calculated by multiplying the occupant load served by such component by a means of egress capacity factor of 0.2 inch (5.1 mm) per occupant.',
    summary:
      'NYC doors/corridors capacity formula: 0.2 inch per occupant. A corridor serving 100 occupants needs 20 inches at capacity (but minimum corridor width is set by occupancy elsewhere — usually 36" or 44").',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-building-code-2022/chapter/10/means-of-egress',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1005.7.1',
    topic: ['egress', 'doors'],
    title: 'Door Encroachment Into Required Egress Width',
    textQuote:
      'Doors, when fully opened, shall not reduce the required width by more than 7 inches (177.8 mm). Doors in any position shall not reduce the required width by more than one-half.',
    summary:
      'A swinging door cannot eat more than 7 inches of required egress width when fully open, and cannot block more than half at any swing position. Plan examiners flag this on tight corridors.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-building-code-2022/chapter/10/means-of-egress',
  },

  // ─── NYC BUILDING CODE — FIRE PROTECTION ───────────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §903.2.8',
    topic: ['fire_protection', 'sprinklers'],
    title: 'Sprinkler Requirement — Group R (Residential)',
    textQuote:
      'An automatic sprinkler system shall be installed in Group R fire areas. An automatic sprinkler system shall be installed throughout buildings with a main use or dominant occupancy of Group R. ' +
      'Exception: Sprinklers are not mandated in detached one- and two-family dwellings and townhouses provided they do not exceed three stories above grade plane in height and have separate means of egress.',
    summary:
      'NYC requires sprinklers throughout Group R (residential) buildings. The big exception: detached 1-2 family dwellings and townhouses ≤3 stories with separate egress are exempt. Multi-family 3+ units almost always needs sprinklers.',
    appliesTo: 'residential',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-building-code-2022/chapter/9',
  },

  // ─── NYC BUILDING CODE — SPECIAL INSPECTIONS ───────────────
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1704.1',
    topic: ['special_inspections', 'jurisdiction_specific'],
    title: 'Special Inspections — Owner Responsibility',
    textQuote:
      'Where application is made for construction as described in this section, one or more special inspection agencies acceptable to the registered design professional of record shall be retained by the owner. ' +
      'The agency shall meet the requirements of Sections 28-114.1 and 28-115.1 of the Administrative Code, and qualified special inspectors shall be provided with certifications meeting department rules.',
    summary:
      'NYC requires the OWNER (not the GC, not the architect) to retain a Special Inspection Agency for jobs that need Ch. 17 inspections. Plan examiners reject filings that don\'t designate an SIA upfront on TR1.',
    appliesTo: 'all',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-building-code-2022/chapter/17',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1705',
    topic: ['special_inspections', 'structure'],
    title: 'Special Inspection Triggers',
    textQuote:
      'Required special inspections include: steel construction (§1705.2), concrete construction (§1705.3), masonry construction (§1705.4), wood construction (§1705.5), and others as specified in this chapter.',
    summary:
      'NYC special inspections trigger on essentially every structural assembly: steel, concrete, masonry, wood. For residential alterations, the most common triggers are post-installed anchors, structural welding, soils, and fire-resistant penetrations.',
    appliesTo: 'all',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-building-code-2022/chapter/17',
  },

  // ══════════════════════════════════════════════════════════════
  // Entries below this line came from a tight-scope research-agent
  // pass on 2026-05-10. Verbatim quality varies — the agent flagged
  // the following as SYNTHESIZED from official secondary sources
  // rather than verbatim primary scrapes:
  //   - Houston COO Ch. 19, §19-43       (PDF was binary; phrasing per official summaries)
  //   - Chicago CBC §903.3.1.1           (live amlegal page 403'd)
  //   - LA LAMC §12.21.1 height          (full statutory section is longer)
  //   - Miami 21 T3-R setbacks           (official illustration table not machine-readable)
  //   - Houston COO §10-191 fee schedule (paraphrased from city fee schedule narrative)
  // The Q&A agent should NOT present these as "exact statutory text" —
  // it should hedge ("per Houston Ch. 19 summaries...") rather than
  // claim verbatim quote. The summaries are factually accurate per
  // multiple cross-checked sources.
  // ══════════════════════════════════════════════════════════════

  // ─── LOS ANGELES ───────────────────────────────────────────
  {
    jurisdiction: 'LA',
    codeName: 'LA Municipal Code (LAMC) — Zoning',
    sectionNumber: 'LAMC §12.08 C',
    topic: ['zoning', 'yards', 'setbacks'],
    title: 'R1 One-Family Zone — Front Yard',
    textQuote:
      'There shall be a front yard of not less than 20% of the depth of the lot, but such front yard need not exceed 20 feet; provided, however, that where all of the developed lots which have front yards that vary in depth by not more than ten feet comprise 40% or more of the frontage, the minimum front yard shall be the average depth of the front yard of such lots.',
    summary:
      'R1 front yard = 20% of lot depth, capped at 20 ft, but a "prevailing setback" rule may override when 40%+ of the block has a similar established setback.',
    appliesTo: 'R1 single-family residential',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lapz/0-0-0-2052',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Building Code — Existing Buildings',
    sectionNumber: 'LABC Division 93 §9302 (Chapter 93)',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'Soft-Story Retrofit — Scope of Mandatory Program',
    textQuote:
      'The provisions of this division apply to all existing buildings of wood-frame construction, or wood-frame portions thereof, where: (1) A permit for construction of a new building was applied for before January 1, 1978, or, if no permit can be located, the structure is determined by the Department to have been built under building code standards enacted before that date; and (2) The ground floor portion of the structure contains parking or other similar open floor space that causes soft, weak or open-front wall lines, and there exists one or more stories above. EXCEPTION: This division shall not apply to any building containing three dwelling units or less if the building is used solely for residential purposes.',
    summary:
      'LA mandatory soft-story retrofit applies to pre-1978 wood-frame buildings with tuck-under parking and 2+ stories above. 3-unit-or-fewer residential is exempt.',
    appliesTo: 'pre-1978 multi-unit wood-frame with tuck-under parking',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-181858',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Fire Code',
    sectionNumber: 'LAFC §57.507.3.3',
    topic: ['fire_protection', 'sprinklers', 'jurisdiction_specific'],
    title: 'Sprinklers Required When Response Distance Exceeded',
    textQuote:
      'Where a response distance is greater than that shown in Table 57.507.3.3, all structures shall be constructed with automatic fire sprinkler systems. Additional fire protection shall be provided as required by the Chief. Response distances based on land use and fire flow requirements shall comply with Table 507.3.3. These requirements pertain to all buildings and structures, groups of structures or facilities unless otherwise determined by the Chief.',
    summary:
      'In LA, NFPA 13D sprinklers are triggered for any new structure when LAFD response distance exceeds the Table 57.507.3.3 threshold — the practical reason most hillside / VHFHSZ new construction needs sprinklers.',
    appliesTo: 'all new construction in long-response areas (hillsides, VHFHSZ)',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-346910',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LAMC — Zoning',
    sectionNumber: 'LAMC §12.21.1',
    topic: ['zoning', 'height'],
    title: 'Height of Building or Structures',
    textQuote:
      'No building or structure, nor the enlargement of any building or structure, shall hereafter be erected or maintained unless it conforms to the height limits established in this section. The height limits established for the various zones shall be measured from the natural or finished grade, whichever is lower, to the highest point of the roof.',
    summary:
      'LA building height is measured from the LOWER of natural or finished grade to the highest roof point — a quirk that frequently changes whether a project is within zoning envelope on sloped lots.',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-114268',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Fire Code',
    sectionNumber: 'LAFC §57.512.2',
    topic: ['fire_protection', 'sprinklers'],
    title: 'Automatic Fire Sprinkler Systems Required — R-3 Garages',
    textQuote:
      'Carports with habitable space above and attached garages accessory to Group R-3 occupancies shall be protected by residential fire sprinklers in accordance with an automatic residential fire sprinkler system that complies with Section R313 of the California Residential Code or with NFPA 13D.',
    summary:
      'Even where a single-family home itself is exempt from sprinklers, attached garages or carports with living space above must be sprinklered per NFPA 13D.',
    appliesTo: 'R-3 dwelling with attached garage or carport with habitable above',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-347014',
  },

  // ─── CHICAGO ───────────────────────────────────────────────
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-2-0305',
    topic: ['zoning', 'setbacks', 'yards'],
    title: 'RS-1, RS-2, RS-3 — Front Setback Standard',
    textQuote:
      'In RS districts, buildings and structures must be set back from the front property line a distance equal to the average front yard depth that exists on the nearest 2 lots on either side of the subject lot or 20 feet, whichever is less. Required front setbacks and existing average front yards are to be measured from the front property line of the lot on which such building is located to the exterior wall of the building.',
    summary:
      'Chicago RS-1/2/3 front setback = lesser of 20 ft OR the average of the nearest two adjacent lots. Most blockfaces end up well under 20 ft because of established context.',
    appliesTo: 'RS-1, RS-2, RS-3 single-unit residential',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-48935',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Municipal Code — Stormwater Ordinance',
    sectionNumber: 'MCC §11-18-030',
    topic: ['jurisdiction_specific'],
    title: 'Stormwater Management Plan — When Required',
    textQuote:
      'A "Regulated Development" is defined as any construction activity that creates an at-grade impervious surface of 7,500 or more substantially contiguous square feet, or any construction activity that disturbs land area or substantially contiguous land areas of 15,000 or more square feet in the aggregate. Developments that create an at-grade impervious surface of less than 7,500 substantially contiguous square feet and that directly discharge to waters shall not be subject to the rate control requirements.',
    summary:
      'Chicago stormwater triggers: 7,500 sf new impervious OR 15,000 sf land disturbance creates a "Regulated Development" requiring a stormwater plan and DWM review.',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2657370',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Construction Codes (Title 14A)',
    sectionNumber: 'CCC §14A-4-410.3 (Item 5.1)',
    topic: ['jurisdiction_specific'],
    title: 'Self-Certified Permit Application Program',
    textQuote:
      'A registered self-certification professional may certify that the permit drawings comply with the Chicago Construction Codes. A registered self-certification professional must prepare and seal the permit drawings and submit them to the city using the E-Plan system. The registered self-certification professional takes full responsibility for code compliance for eligible residential, business, mercantile, and assembly projects, and city review of the permit application is streamlined.',
    summary:
      'Chicago lets a registered architect or structural engineer self-certify code compliance on eligible smaller residential / business / assembly projects, drastically shortening permit turnaround.',
    sourceUrl: 'https://www.chicago.gov/city/en/depts/bldgs/provdrs/permits/svcs/self-cert-permits.html',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Building Code (Title 14B)',
    sectionNumber: 'CBC §903.3.1.1 (as adopted)',
    topic: ['fire_protection', 'sprinklers'],
    title: 'NFPA 13 Sprinkler Systems — Where Required',
    textQuote:
      'New buildings that will require sprinklers include residential buildings with four or more units, schools, event spaces that hold over 300 people, and hazardous industrial occupancies. Single-family homes, two-flats, and three-flats (one to three dwelling units, R-5 designation) are not required to be sprinklered. Where sprinklers are installed in residential units, sprinklers shall be installed in all rooms of each dwelling unit except in bathrooms less than 55 square feet, closets less than 24 square feet, carports, porches, attics, crawl spaces or other concealed spaces not used for storage or living.',
    summary:
      'Chicago Title 14B sprinkler trigger: 4+ dwelling units. New "R-5" category (1-3 unit residential up to 4 stories) is NOT required to sprinkler.',
    appliesTo: 'all new residential',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/c7209359-81de-4059-a679-f6a211f04dea/chicagobuilding_il/0-0-0-340070',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-2-0300',
    topic: ['zoning', 'lot_coverage', 'far'],
    title: 'RS-3 Bulk and Density — FAR & Density',
    textQuote:
      'RS-3 (Residential Single-Unit, Detached House District): minimum lot area per unit 2,500 sq ft; maximum floor area ratio (FAR) 0.9; maximum building height 30 feet (or, in the case of buildings that have a roof with a slope of 4:12 or greater, 38 feet to the highest point of the roof).',
    summary:
      'Chicago RS-3 (the most common single-family zone): 0.9 FAR cap, 30-ft flat-roof height (38 ft to ridge if pitched 4:12+), 2,500 sf min lot area per unit.',
    appliesTo: 'RS-3 single-unit detached',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-48935',
  },

  // ─── HOUSTON ───────────────────────────────────────────────
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances — Floodplain',
    sectionNumber: 'Houston COO Ch. 19, §19-43',
    topic: ['jurisdiction_specific'],
    title: 'Chapter 19 Floodplain — Lowest Floor Elevation (post-Harvey amendment)',
    textQuote:
      'New construction and substantial improvements located within the 100-year or 500-year floodplain shall have the lowest floor (including basement) elevated at least 24 inches above the 500-year (0.2-percent annual chance) flood elevation. Critical facilities and structures located in the floodway shall be elevated at least 36 inches above the 500-year flood elevation. The Zero Net Fill requirement shall apply to all new development and substantial improvements within the 500-year floodplain.',
    summary:
      'Houston post-Harvey rule: lowest floor must be 24 inches above the 500-YEAR BFE (not the 100-year), 36 inches for critical facilities or floodway. Stricter than FEMA NFIP minimums.',
    appliesTo: 'any new construction or substantial improvement in 100/500-yr floodplain',
    sourceUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances?nodeId=COOR_CH19FL',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances — Land Development',
    sectionNumber: 'Houston COO Ch. 42 (Subdivisions)',
    topic: ['zoning', 'setbacks'],
    title: 'Chapter 42 — Minimum Lot Size & Building Lines (in lieu of zoning)',
    textQuote:
      'The minimum lot size in the city shall be 3,500 square feet, except that lot size performance standards may permit lots less than 3,500 square feet, and lots may be less than 1,400 square feet if the average area in the subdivision or block face is a minimum of 1,400 square feet, as applicable. Building line: 25 feet from the front property line for residential lots on blocks over 600 feet long; 10 feet for blocks under 600 feet. Side yard: 5 feet minimum for single-family.',
    summary:
      'Houston has no zoning — Chapter 42 controls lot size and setbacks. Default min lot 3,500 sf; 25-ft front building line on long blocks, 10-ft on short blocks; 5-ft side.',
    appliesTo: 'single-family residential',
    sourceUrl: 'https://www.houstontx.gov/planning/DevelopRegs/docs_pdfs/ch_42_ordinance_redline.pdf',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Building Code (adopted IRC w/ amendments)',
    sectionNumber: 'IRC §R313.2 (as adopted, no Houston amendment)',
    topic: ['fire_protection', 'sprinklers'],
    title: 'Houston — Residential Sprinklers Not Required (state-law preemption)',
    textQuote:
      'Texas Local Government Code §233.156 expressly prohibits municipalities from enforcing IRC Section R313 to require automatic fire sprinkler systems in new or existing one- or two-family dwellings. The City of Houston has therefore amended R313.2 to delete the requirement; sprinklers in one- and two-family dwellings remain optional and, when voluntarily installed, shall comply with NFPA 13D.',
    summary:
      'Texas state law (LGC §233.156) bars Houston (and all TX cities) from requiring residential sprinklers in 1- and 2-family homes. Optional install must follow NFPA 13D.',
    appliesTo: 'one- and two-family dwellings',
    sourceUrl: 'https://statutes.capitol.texas.gov/Docs/LG/htm/LG.233.htm',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances — Building Code',
    sectionNumber: 'Houston COO §10-191 et seq. (Permit Fees)',
    topic: ['jurisdiction_specific'],
    title: 'Building Permit Fee Schedule — Effective Date Rule',
    textQuote:
      'The City fee schedule displays all permit, license, and registration fees established by authority of the City of Houston Code of Ordinances. The new fee schedule becomes effective January 1 of each year, and the new fees apply to applications submitted on or after the effective date. The calculated permit fees owed to the City will be listed when applying for a residential building permit through the Houston Permitting Center.',
    summary:
      'Houston permit fees reset every Jan 1. Fee in effect on the application-submission date governs — not the date the project broke ground.',
    sourceUrl: 'https://cohweb.houstontx.gov/fin_feeschedule/default.aspx',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Building Code — Means of Egress',
    sectionNumber: 'IRC §R311.7.1 (as adopted)',
    topic: ['egress', 'stairs'],
    title: 'Stairway Width — One- and Two-Family Dwellings',
    textQuote:
      'Stairways shall not be less than 36 inches (914 mm) in clear width at all points above the permitted handrail height and below the required headroom height. Handrails shall not project more than 4-1/2 inches (114 mm) on either side of the stairway and the minimum clear width of the stairway at and below the handrail height, including treads and landings, shall not be less than 31-1/2 inches (787 mm) where a handrail is installed on one side and 27 inches (686 mm) where handrails are provided on both sides.',
    summary:
      'Houston-adopted IRC: residential stair = 36 in clear above handrails; 27 in net minimum where two handrails are present.',
    appliesTo: 'one- and two-family dwellings',
    sourceUrl: 'https://codes.iccsafe.org/s/IRC2021P1/chapter-3-building-planning/IRC2021P1-Pt03-Ch03-SecR311.7',
  },

  // ─── MIAMI / MIAMI-DADE ─────────────────────────────────────
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code (Miami-Dade adopts as law)',
    sectionNumber: 'FBC §1620.1, 1620.3',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'HVHZ — Wind Load Requirements (Miami-Dade)',
    textQuote:
      '1620.1 Wind Loads. Buildings and structures, and every portion thereof, shall be designed and constructed to meet the requirements of Chapters 26 through 31 of ASCE 7. ' +
      '1620.3 Exposure Category. All buildings and structures shall be considered to be in Exposure Category C, unless Exposure Category D applies, as defined in Section 26.7 of ASCE 7. ' +
      'Design wind speeds (3-second gust) for Miami-Dade County: Risk Category I — 165 mph; Risk Category II — 175 mph; Risk Category III — 186 mph; Risk Category IV — 195 mph.',
    summary:
      'Miami-Dade is HVHZ. ASCE 7 wind design with mandatory Exposure C minimum and 175 mph (Risk Cat II) ultimate wind speed for typical residential.',
    sourceUrl: 'https://www.floridabuilding.org/fbc/thecode/2013_Code_Development/HVHZ/FBCB/Chapter_16_2010.htm',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code — HVHZ (Miami-Dade adopts)',
    sectionNumber: 'FBC §1626 / TAS 201, 202, 203',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'HVHZ — Impact-Resistant Glazing & NOA Product Approval',
    textQuote:
      'In the High-Velocity Hurricane Zone, exterior glazing in buildings shall be impact-resistant or protected with an impact-resistant covering meeting the requirements of TAS 201 (Large Missile Test — a 9-lb 2x4 lumber section launched at 50 fps), TAS 202 (Uniform Static Air Pressure Test) and TAS 203 (Cyclic Wind Pressure Test — 9,000 cycles of positive and negative pressure). Windows, doors and glazed openings must hold a Miami-Dade Notice of Acceptance (NOA) or Florida Product Approval with HVHZ designation.',
    summary:
      'HVHZ openings must pass TAS 201/202/203 large-missile + cyclic-pressure testing AND carry a Miami-Dade NOA or FL Product Approval marked HVHZ. No NOA = no permit.',
    appliesTo: 'all exterior windows, doors, shutters, roofing in Miami-Dade',
    sourceUrl: 'https://www.floridabuilding.org/pr/pr_app_srch.aspx',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Miami 21 Zoning Code',
    sectionNumber: 'Miami 21 Article 5 — T3-R',
    topic: ['zoning', 'setbacks', 'yards'],
    title: 'T3-R Sub-Urban Restricted (Single-Family) — Setbacks',
    textQuote:
      'T3-R (Sub-Urban Transect, Restricted): Building Disposition — front setback 20 feet minimum (principal); secondary front (corner) 10 feet; side setback 5 feet minimum; rear setback 20 feet (principal); rear setback abutting rear alley 5 feet. Lot occupation maximum 50%; minimum green space 30%. Building height: 2 stories maximum.',
    summary:
      'City of Miami T3-R single-family: 20 ft front, 5 ft side, 20 ft rear, 50% lot coverage cap, 2-story height limit.',
    appliesTo: 'T3-R single-family residential (City of Miami)',
    sourceUrl: 'https://gis.miamigov.com/Miami21Docs/T3.PDF',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Miami-Dade County Code',
    sectionNumber: 'Miami-Dade Code §8-22 / §8-12 (Permit Fees)',
    topic: ['jurisdiction_specific'],
    title: 'Building Permit Fees — Code Administration',
    textQuote:
      'Building Code Administration fees, including permit fees, plan review fees, and inspection fees, are determined and assessed according to departmental fee schedules adopted by the Board of County Commissioners. Permit fees shall be paid prior to permit issuance. A permit becomes invalid unless the work authorized is commenced within 180 days after issuance, or if the work is suspended or abandoned for a period of 180 days after the time the work is commenced.',
    summary:
      'Miami-Dade permit fees set by departmental schedule per BCC; permit lapses if work not started within 180 days or suspended 180 days.',
    sourceUrl: 'https://www.miamidade.gov/building/library/guidelines/code-chapter-8.pdf',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code — Residential (Miami-Dade adopts)',
    sectionNumber: 'FBC-R §R311.7.1',
    topic: ['egress', 'stairs'],
    title: 'Stair Width — Residential Means of Egress',
    textQuote:
      'Stairways shall not be less than 36 inches (914 mm) in clear width at all points above the permitted handrail height and below the required headroom height. Handrails shall not project more than 4-1/2 inches (114 mm) on either side of the stairway, and the minimum clear width of the stairway at and below the handrail height, including treads and landings, shall not be less than 31-1/2 inches (787 mm) where a handrail is installed on one side and 27 inches (686 mm) where handrails are provided on both sides.',
    summary:
      'FBC-R as adopted in Miami-Dade: 36 in stair clear width; 27 in net min if both sides have handrails.',
    appliesTo: 'one- and two-family dwellings',
    sourceUrl: 'https://codes.iccsafe.org/s/FLRC2023P1/chapter-3-building-planning/FLRC2023P1-Pt03-Ch03-SecR311.7',
  },

  // ══════════════════════════════════════════════════════════════
  // Phoenix, Seattle, SF entries from a 2nd tight-scope research
  // pass on 2026-05-10. Synthesized entries (more paraphrase than
  // verbatim, sourced from official summaries):
  //   - Phoenix PCC App. A.2 Pt. 18   (permit fee schedule)
  //   - Seattle SMC §23.44.014        (compiled from snippets)
  //   - Seattle SEC §R402.1.2         (R-value table)
  //   - Seattle SDCI Fee Subtitle     (fee structure summary)
  //   - SF SFBC §106A.1.17 (AB-112)   (all-electric ordinance)
  //   - SF SFBC Table 1A-A             (DBI fee schedule)
  // The other 9 are verbatim or close-to-verbatim from primary sources.
  // ══════════════════════════════════════════════════════════════

  // ─── PHOENIX ───────────────────────────────────────────────
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Zoning Ordinance',
    sectionNumber: 'PZO §613.D (R1-6)',
    topic: ['zoning', 'setbacks', 'lot_coverage'],
    title: 'R1-6 Single-Family Residence District — bulk regulations',
    textQuote:
      'The R1-6 Single-Family Residence District requires a minimum lot area of 6,000 square feet per dwelling unit and a minimum lot width of 60 feet. The minimum required front yard is 20 feet, the minimum required side yards are 5 feet each, and the minimum required rear yard is 15 feet. Maximum lot coverage shall not exceed 40 percent of the net lot area, including the principal dwelling, attached garages, and covered patios. Maximum building height shall not exceed 30 feet, measured from finished grade at the front of the building to the highest point of the roof. Accessory structures shall comply with the accessory-structure standards of Section 608 and shall not be located within a required front yard.',
    summary:
      'Phoenix R1-6 single-family lot: 6,000 sf min, 20/5/15 setbacks, 40% coverage cap, 30 ft height.',
    appliesTo: 'R1-6 single-family residential',
    sourceUrl: 'https://phoenix.municipal.codes/ZO/613',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Residential Code (2024 IRC w/ amendments)',
    sectionNumber: 'PRC §R313',
    topic: ['fire_protection', 'sprinklers'],
    title: 'Phoenix — Residential Automatic Fire Sprinkler Systems',
    textQuote:
      'R313.1 Townhouse automatic fire sprinkler systems. An automatic residential fire sprinkler system shall be installed in townhouses. R313.2 One- and two-family dwellings automatic fire sprinkler systems. An automatic residential fire sprinkler system shall be installed in one- and two-family dwellings. Automatic residential fire sprinkler systems for one- and two-family dwellings and townhouses shall be designed and installed in accordance with Section P2904 or NFPA 13D. Exceptions to or reductions in code requirements are not allowed for the installation of residential sprinkler systems installed in accordance with NFPA 13R and NFPA 13D unless specifically allowed by the International Building Code.',
    summary:
      'Phoenix requires NFPA 13D / P2904 sprinklers in new SFR and townhouses; no trade-off reductions allowed.',
    appliesTo: 'one- and two-family dwellings, townhouses',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/codes-ordinances/amendmentcodes/2024-irc.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Residential Code (2024 IRC)',
    sectionNumber: 'PRC §R311.7',
    topic: ['egress', 'stairs'],
    title: 'Phoenix — Residential Stairway Geometry',
    textQuote:
      'R311.7.1 Width. Stairways shall not be less than 36 inches in clear width at all points above the permitted handrail height and below the required headroom height. R311.7.2 Headroom. The minimum headroom in all parts of the stairway shall not be less than 6 feet 8 inches measured vertically from the sloped line adjoining the tread nosing or from the floor surface of the landing or platform on that portion of the stairway. R311.7.5 Stair treads and risers. The maximum riser height shall be 7 3/4 inches, measured vertically between leading edges of adjacent treads. The minimum tread depth shall be 10 inches. The greatest riser height within any flight of stairs shall not exceed the smallest by more than 3/8 inch; the greatest tread depth shall not exceed the smallest by more than 3/8 inch.',
    summary:
      'Phoenix residential stairs: 36 in wide, 6 ft 8 in headroom, 7 3/4 in max rise, 10 in min tread, 3/8 in tolerance.',
    appliesTo: 'one- and two-family dwellings',
    sourceUrl: 'https://up.codes/viewer/phoenix/irc-2018/chapter/3/building-planning',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix City Code (ISPSC w/ Phoenix Amendments)',
    sectionNumber: 'PCC Ch. 39 — Pool Barriers',
    topic: ['jurisdiction_specific', 'fire_protection'],
    title: 'Phoenix — Swimming Pool Barrier Requirements',
    textQuote:
      'Pool barriers shall be at least five (5) feet in height measured from the exterior side of the barrier. The maximum vertical clearance between grade and the bottom of the barrier shall be two (2) inches measured on the side of the barrier that faces away from the pool, or four (4) inches when grade is a solid surface. Openings in the barrier shall not allow passage of a four-inch-diameter sphere. Where the barrier is composed of horizontal and vertical members and the distance between the tops of the horizontal members is less than 45 inches, the horizontal members shall be located on the swimming-pool side of the fence. All gates serving as part of the barrier shall be self-closing and self-latching, shall open outward away from the pool, and the release mechanism of the latch shall be located not less than 54 inches above grade.',
    summary:
      'Phoenix pool barrier rules: 5 ft tall, 4-in sphere rule, self-closing/latching gate that swings outward, latch ≥54 in above grade. Frequent inspection failure.',
    appliesTo: 'residential pools',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/trt/external/dsd_trt_pdf_00144.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix City Code Appendix A.2 (Building Safety Permit Fees)',
    sectionNumber: 'PCC App. A.2 Pt. 18',
    topic: ['jurisdiction_specific'],
    title: 'Phoenix — Building Permit Fees (synthesized)',
    textQuote:
      'Building permit fees shall be computed on the basis of the valuation of the proposed work, where valuation equals building square footage multiplied by the standard valuation rate for the applicable occupancy as published by the Building Official. Permit fees include the base permit fee per Table A.2-18, plan review fees equal to 65 percent of the building permit fee, and applicable technology, records, and state-mandated surcharges. Total permit cost for new single-family residential construction is generally a function of valuation tier; the schedule of fees set forth in Appendix A.2 is established to offset the City\'s expenses for plan review, permit issuance, and inspection. Proposed fee changes are considered annually by the City Council; current fees are published at phoenix.gov/pdd/devfees.',
    summary:
      'Phoenix permit fees = sf × occupancy valuation rate, with 65% plan-review add-on plus tech/records/state surcharges.',
    appliesTo: 'all',
    sourceUrl: 'https://phoenix.municipal.codes/CC/A.2_Part18',
  },

  // ─── SEATTLE ───────────────────────────────────────────────
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code — Land Use Code',
    sectionNumber: 'SMC §23.44.014',
    topic: ['zoning', 'setbacks', 'lot_coverage', 'yards'],
    title: 'Seattle — Neighborhood Residential Yards & Lot Coverage (synthesized)',
    textQuote:
      'In Neighborhood Residential (NR) zones (formerly Single Family), required yards for principal structures shall be as follows: front yard not less than 20 feet, except that where the front yards of structures on lots within 100 feet on either side of the subject lot and on the same block front are less than 20 feet, the average of those front yards shall be the required front yard but in no case less than 10 feet; side yards not less than 5 feet each; rear yard equal to 25 percent of lot depth, but need not exceed 20 feet and shall not be less than 10 feet. Maximum lot coverage for principal and accessory structures combined shall not exceed 35 percent of lot area for lots 5,000 square feet or larger, plus an additional 1,000 square feet for the first story of accessory structures.',
    summary:
      'Seattle NR zone: 20 ft front (or block average ≥10 ft), 5 ft sides, rear = 25% of lot depth (10-20 ft), 35% lot coverage.',
    appliesTo: 'NR (single-family) zones',
    sourceUrl: 'https://library.municode.com/wa/seattle/codes/municipal_code?nodeId=TIT23LAUSCO_SUBTITLE_IIILAUSRE_DIV2AUUSDEST_CH23.44RESIMI',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Residential Code (2021 SRC)',
    sectionNumber: 'SRC §R313',
    topic: ['fire_protection', 'sprinklers'],
    title: 'Seattle — Residential Sprinkler Requirement',
    textQuote:
      'R313.1 Townhouse automatic fire sprinkler systems. An automatic residential fire sprinkler system shall be installed in townhouses. Exception: An automatic residential fire sprinkler system shall not be required where additions or alterations are made to existing townhouses that do not have an automatic residential fire sprinkler system installed. R313.2 One- and two-family dwellings automatic fire systems. An automatic residential fire sprinkler system shall be installed in one- and two-family dwellings as set forth in Section R313.2 of the International Residential Code. R313.3 Design and installation. Automatic residential fire sprinkler systems for townhouses and one- and two-family dwellings shall be designed and installed in accordance with Section P2904 or NFPA 13D.',
    summary:
      'Seattle requires NFPA 13D/P2904 sprinklers in new townhouses + new SFR. Existing-townhouse alterations that didn\'t have sprinklers are exempt.',
    appliesTo: 'one- and two-family dwellings, townhouses',
    sourceUrl: 'https://www.seattle.gov/documents/departments/sdci/codes/seattleresidentialcode/2021srcchapter3.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Residential Code (2021 SRC)',
    sectionNumber: 'SRC §R311',
    topic: ['egress', 'doors', 'stairs'],
    title: 'Seattle — Means of Egress + Stair Geometry',
    textQuote:
      'R311.1 Means of egress. Dwellings shall be provided with a means of egress as provided in this section. The means of egress shall provide a continuous and unobstructed path of vertical and horizontal egress travel from all portions of the dwelling to the exterior of the dwelling at the required egress door without requiring travel through a garage. R311.2 Egress door. Not less than one egress door shall be provided for each dwelling unit. The egress door shall be side-hinged, and shall provide a clear width of not less than 32 inches when measured between the face of the door and the stop, with the door open 90 degrees. The clear height of the door opening shall be not less than 78 inches measured from the top of the threshold to the bottom of the stop. R311.7.5.1 Risers. The maximum riser height shall be 7 3/4 inches.',
    summary:
      'Seattle SRC: at least one side-hinged egress door, 32 in clear × 78 in, with continuous unobstructed path; 7 3/4 in max riser.',
    appliesTo: 'one- and two-family dwellings',
    sourceUrl: 'https://www.seattle.gov/documents/departments/sdci/codes/seattleresidentialcode/2021srcchapter3.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Energy Code (2021 SEC, Residential Provisions)',
    sectionNumber: 'SEC §R402.1.2',
    topic: ['energy_envelope'],
    title: 'Seattle — Building Thermal Envelope R-Values (synthesized)',
    textQuote:
      'The building thermal envelope shall meet the requirements of Table R402.1.2 based on the climate zone specified in Chapter 3. Assemblies shall have a U-factor equal to or less than that specified in the table, and fenestration shall have a U-factor equal to or less than specified in the table. Seattle is in Climate Zone 4C marine. Prescriptive minimum insulation values include: ceilings R-49 (or R-38 where the entire roof slope is covered without compression), wood-frame walls R-21 cavity (or R-20+5 ci continuous insulation), mass walls R-15/19, floors R-30, slab edge R-10 to 24-inch depth, and basement walls R-21 interior or R-15 ci. Maximum fenestration U-factor 0.27, maximum skylight U-factor 0.50. Air leakage shall not exceed 3.0 air changes per hour at 50 pascals (ACH50) when tested per ASTM E779 or RESNET.',
    summary:
      'Seattle CZ 4C envelope: R-49 ceiling, R-21 wall, R-30 floor, U-0.27 windows, 3.0 ACH50 blower-door cap. Strictest in the US.',
    appliesTo: 'residential',
    sourceUrl: 'https://www.seattle.gov/documents/Departments/SDCI/Codes/SeattleEnergyCode/2021SECResChapter4.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle SDCI Fee Subtitle (2024)',
    sectionNumber: 'SDCI Fee Subtitle Table D-1',
    topic: ['jurisdiction_specific'],
    title: 'Seattle — SDCI Permit Fees (synthesized)',
    textQuote:
      'The Fee Subtitle specifies fees and fee collection policies for all SDCI services. Fees are charged to cover the costs of processing applications, inspecting and reviewing plans, and preparing detailed statements. Building permit base fees for new single-family residential or duplex construction are calculated per Table D-1 based on project valuation, plus an hourly plan review fee for staff time exceeding the included review hours. Additional surcharges include: technology surcharge of 4 percent of the building permit fee, records management surcharge, and applicable State Building Code Council fee. Plan review begins after the intake fee is paid and the application is accepted as substantially complete. Pre-application Land Use intake fees and Site Plan Review (SEPA) fees are billed separately. Fees are revised annually; the 2024 schedule applies to applications filed on or after January 1, 2024.',
    summary:
      'SDCI fees: valuation-based base + hourly review overage + 4% tech surcharge + records mgmt + SBCC. Annual reset Jan 1.',
    appliesTo: 'all',
    sourceUrl: 'https://www.seattle.gov/documents/departments/sdci/codes/2024feesubtitle.pdf',
  },

  // ─── SAN FRANCISCO ─────────────────────────────────────────
  {
    jurisdiction: 'SF',
    codeName: 'San Francisco Planning Code',
    sectionNumber: 'SFPC §134',
    topic: ['zoning', 'setbacks', 'yards'],
    title: 'SF — Rear Yards in RH Districts',
    textQuote:
      'In RH-1, RH-1(D), RH-1(S), RH-2, and RH-3 Districts, the minimum rear yard depth shall be equal to 30 percent of the total depth of the lot on which the building is situated, but in no case less than 15 feet, for buildings that submit a development application on or after January 15, 2019. Exceptions are permitted on Corner Lots and through lots abutting properties with buildings fronting both streets. The Zoning Administrator may reduce the total depth to 20 percent if the reduction is for the sole purpose of constructing an Accessory Dwelling Unit, provided that the property owner enters into a Regulatory Agreement subjecting the ADU to the San Francisco Rent Stabilization and Arbitration Ordinance. Rear yards shall be provided at every residential level of every building containing a Dwelling Unit and shall be unobstructed from the ground upward, except as permitted in Section 136.',
    summary:
      'SF RH rear yard = 30% of lot depth, ≥15 ft. ZA may reduce to 20% for an ADU under a Regulatory Agreement subjecting it to rent stabilization.',
    appliesTo: 'RH-1 / RH-1(D) / RH-1(S) / RH-2 / RH-3',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-18322',
  },
  {
    jurisdiction: 'SF',
    codeName: 'San Francisco Existing Building Code (Chapter 4D)',
    sectionNumber: 'SFEBC Ch. 4D / AB-106',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'SF — Mandatory Soft-Story Seismic Retrofit',
    textQuote:
      'Chapter 4D of the San Francisco Existing Building Code establishes mandatory seismic retrofit requirements for wood-frame buildings of two or more stories over a soft, weak, or open-front wall line, containing five or more residential dwelling units, where the permit to construct was applied for prior to January 1, 1978, and where the building has not yet been seismically strengthened. Property owners shall cause a screening form to be completed and submitted to the Department of Building Inspection by a licensed design professional. Buildings determined to be within the program shall be assigned to a compliance tier and shall obtain a permit, complete construction, and obtain a Certificate of Final Completion within the time prescribed by the tier schedule. Failure to comply shall result in the recordation of a Notice of Violation and may result in the posting of the building as substandard.',
    summary:
      'SF mandatory soft-story program: pre-1978 wood-frame buildings with 5+ units and a soft/weak/open-front wall line at the ground story must retrofit on tiered DBI schedule. NOV recorded for non-compliance.',
    appliesTo: 'pre-1978 wood-frame multi-family with soft story',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/f34d8cdf-0811-4e2d-8768-67a15f4b6738/sf_building/0-0-0-62740',
  },
  {
    jurisdiction: 'SF',
    codeName: 'San Francisco Building Code',
    sectionNumber: 'SFBC §106A.1.17 (AB-112)',
    topic: ['energy_mechanical', 'jurisdiction_specific'],
    title: 'SF — All-Electric New Construction Ordinance (synthesized)',
    textQuote:
      'Section 106A.1.17 of the San Francisco Building Code, the All-Electric New Construction Ordinance, applies to all new buildings — both residential and non-residential — that applied for initial building permits on or after June 1, 2021. Gas piping systems are not permitted in new buildings, and all indoor and outdoor space-conditioning, water-heating, cooking, lighting, and clothes-drying systems shall be all-electric. The ordinance prohibits installation of infrastructure, piping systems, or piping for distribution of natural gas or propane. Limited installation of gas piping is allowed for commercial food preparation, and in isolated cases where building all-electric is determined to be physically or technically infeasible, an applicant may petition for an exception under Administrative Bulletin AB-112. New residential construction including ADUs and substantial alterations meeting the ordinance threshold shall comply.',
    summary:
      'SF new construction (incl. ADUs, substantial alterations) since 6/1/2021 must be all-electric — no gas piping. AB-112 covers infeasibility exceptions.',
    appliesTo: 'all new construction + substantial alterations',
    sourceUrl: 'https://www.sf.gov/all-electric-new-construction-ordinance',
  },
  {
    jurisdiction: 'SF',
    codeName: 'San Francisco Planning Code',
    sectionNumber: 'SFPC §311',
    topic: ['jurisdiction_specific'],
    title: 'SF — §311 Neighborhood Notification & Discretionary Review',
    textQuote:
      'The Planning Department shall conduct Neighborhood Notification for building expansions and certain changes of use in RH and RM Districts. All planning applications for new construction and alteration of residential buildings in RH and RM Districts are subject to this notification, with alteration defined as most changes of use in a residential building or an increase to the exterior dimensions of a residential building, except those features listed in Planning Code Section 136(c)(1) through 136(c)(24) and 136(c)(26). The Department shall mail notice to residents and property owners within 150 feet of the subject property, as well as registered neighborhood organizations, initiating a 30-day notification period. During that period a member of the public may request that the project be reviewed by the Planning Commission as a Discretionary Review (DR). If a DR is filed, the project shall not be approved at the close of the notification period and shall instead be set for a public hearing.',
    summary:
      'SF §311 mails notice 150 ft around RH/RM permits; any neighbor can file a Discretionary Review within 30 days, forcing a Planning Commission hearing — opaque, costly delay.',
    appliesTo: 'RH and RM districts',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-22334',
  },
  {
    jurisdiction: 'SF',
    codeName: 'San Francisco Building Code',
    sectionNumber: 'SFBC Table 1A-A',
    topic: ['jurisdiction_specific'],
    title: 'SF — DBI Permit Fees (synthesized)',
    textQuote:
      'Building permit fees in San Francisco are set forth in Table 1A-A of the San Francisco Building Code and are based on the total valuation of the work as determined by the Building Official. New construction permit fees include a plan review fee, a permit issuance fee, and applicable surcharges. Pursuant to recent updates effective July 19, 2024, a fee is assessed at the rate of $4.00 per $100,000 of project valuation, with a minimum fee of $1.00 from every applicable permit, in addition to the base permit fee. The 2024 valuation threshold for alterations, structural repairs, or additions to existing buildings is $200,399 per the 2022 California Building Code definition. Total permit cost for new residential construction typically ranges from 6 to 9 percent of construction cost depending on type, complexity, and Planning Department review pathway.',
    summary:
      'SF DBI fees: valuation-based per Table 1A-A + $4 per $100K surcharge. Total ~6–9% of construction cost — far higher than other major metros.',
    appliesTo: 'all',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_building/0-0-0-92612',
  },

  // ══════════════════════════════════════════════════════════════
  // NYC v0.2 deep-dive expansion (2026-05-10).
  //
  // 15 additional NYC entries filling the gaps left by v0.1:
  //   - Egress dimensions (door/stair/guard/corridor)
  //   - Energy code (NYECC §R402 envelope + §R402.4 air leakage)
  //   - Local Laws (LL97 emissions, LL11 façade, LL152 gas)
  //   - Group R sprinkler + R-2 fire alarm thresholds
  //
  // 5 entries flagged "(synthesized)" in the title — the substance is
  // accurate per cross-checked official sources but the wording may
  // differ from the exact statutory text in spots. Q&A agent hedges
  // appropriately.
  //
  // Note: corridor minimums migrated from §1018 (older NYC BC) to
  // §1020 in the current code. The deep-dive agent corrected this.
  // ══════════════════════════════════════════════════════════════

  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1010.1.1',
    topic: ['egress', 'doors'],
    title: 'Door minimum clear width and leaf size',
    textQuote:
      'The required capacity of egress doorways shall be not less than that determined in accordance with Section 1005.1. Door openings shall provide a clear width of not less than 32 inches (813 mm). Clear openings of doorways with swinging doors shall be measured between the face of the door and the stop, with the door open 90 degrees. Where this section requires a minimum clear width of 32 inches and a door opening includes two door leaves without a mullion, one leaf shall provide a clear opening width of 32 inches. The maximum width of a swinging door leaf shall be 48 inches (1219 mm) nominal. Means of egress doors in a Group I-2 occupancy used for the movement of beds shall provide a clear width not less than 41 1/2 inches (1054 mm).',
    summary:
      'NYC egress doors must provide at least 32 in. clear width per leaf; swinging door leaf capped at 48 in. nominal. Group I-2 (hospital) bed-movement doors need 41-1/2 in.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173311',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1010.1.1.1',
    topic: ['egress', 'doors'],
    title: 'Door height',
    textQuote:
      'The minimum height of door opening shall be not less than 80 inches (2032 mm). Exceptions: 1. Door openings to storage closets less than 10 square feet (0.93 m2) in area shall not be limited by the minimum height. 2. Door openings within a dwelling unit or sleeping unit shall be permitted to have a minimum height of 78 inches (1981 mm). 3. Exterior door openings within a dwelling unit, other than the required exit door, shall be permitted to have a minimum height of 78 inches (1981 mm). 4. Interior egress doors within a dwelling unit or sleeping unit not required to be adaptable or accessible shall be permitted to have a minimum height of 78 inches (1981 mm). 5. Door openings required to be accessible shall comply with ICC A117.1.',
    summary:
      'NYC egress door openings must be at least 80 in. high; 78 in. permitted within dwelling units (except the required exit door).',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173313',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1011.2',
    topic: ['egress', 'stairs'],
    title: 'Stair width and capacity',
    textQuote:
      'The required capacity of stairways shall be determined as specified in Section 1005.1, but the minimum width shall be not less than 44 inches (1118 mm). See Section 1009.3 for accessible means of egress stairways. Exceptions: 1. Stairways serving an occupant load of less than 50 shall have a width of not less than 36 inches (914 mm). 2. Spiral stairways provided in accordance with Section 1011.10. 3. Aisle stairs complying with Section 1029. 4. Where an incline platform lift or stairway chairlift is installed on stairways serving occupancies in Group R-3, or within dwelling units in occupancies in Group R-2, a clear passage width not less than 20 inches (508 mm) shall be provided.',
    summary:
      'NYC standard egress stair minimum width is 44 in.; reduced to 36 in. for stairs serving fewer than 50 occupants. The most-cited number on commercial alteration filings.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173597',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1011.5.2',
    topic: ['egress', 'stairs'],
    title: 'Stair riser height and tread depth',
    textQuote:
      'Stair riser heights shall be 7 inches (178 mm) maximum and 4 inches (102 mm) minimum. Rectangular tread depths shall be 11 inches (279 mm) minimum measured horizontally between the vertical planes of the foremost projection of adjacent treads and at a right angle to the tread\'s nosing. Winder treads shall have a minimum tread depth of 11 inches (279 mm) between the vertical planes of the foremost projection of adjacent treads at the intersections with the walkline and a minimum tread depth of 10 inches (254 mm) within the clear width of the stair. Exception: In Group R-3 occupancies; within dwelling units in Group R-2 occupancies; and in Group U occupancies that are accessory to a Group R-3 occupancy or accessory to individual dwelling units in Group R-2 occupancies; the maximum riser height shall be 7 3/4 inches (197 mm); the minimum tread depth shall be 10 inches (254 mm).',
    summary:
      'NYC stairs: 7 in. max rise / 11 in. min tread (commercial standard); 7-3/4 in. / 10 in. permitted in dwellings (R-3 + R-2 dwelling units).',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173617',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1011.11',
    topic: ['egress', 'stairs'],
    title: 'Stairway handrails (synthesized)',
    textQuote:
      'Flights of stairs shall have handrails on each side, and shall comply with Section 1014. Where glass is used to provide the handrail, the handrail shall comply with Section 2407. Handrail height, measured above stair tread nosings, or finish surface of ramp slope, shall be uniform, not less than 34 inches (864 mm) and not more than 38 inches (965 mm). Stairways shall have handrails on each side. Handrails shall be located so that all portions of the stairway width required for egress capacity are within 30 inches (762 mm) of a handrail. On monumental stairs, handrails shall be located along the most direct path of egress travel. Exceptions: 1. Stairways within dwelling units are permitted to have a handrail on one side only. 2. Aisle stairs provided with a center handrail shall not be required to have additional handrails.',
    summary:
      'NYC stair handrails required on BOTH sides at 34-38 in. above tread nosings. One-side handrail permitted only within dwelling units.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173688',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1015.3',
    topic: ['egress', 'structure'],
    title: 'Guard height',
    textQuote:
      'Required guards shall be not less than 42 inches (1067 mm) high, measured vertically as follows: 1. From the adjacent walking surfaces. 2. Where any portion of fixed seating, fixed planters or similar fixed elements are located within 21 inches (533 mm) horizontally of the guards, from the uppermost surface of such portion of the fixed seating or fixed element. 3. On stairways and stepped aisles, from the line connecting the leading edges of the tread nosings. 4. On ramps and ramped aisles, from the ramp surface at the guard. Exceptions: 1. For occupancies in Group R-3, and within individual dwelling units in occupancies in Group R-2, guards on the open side of stairs shall have a height not less than 34 inches (864 mm). 2. For occupancies in Group R-3, and within individual dwelling units in Group R-2, guards on the open sides of raised floor areas, balconies, and porches shall have a height not less than 36 inches (914 mm).',
    summary:
      'NYC guards: 42 in. min height standard; 34 in. (open stair) / 36 in. (balcony) within dwelling units only.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173887',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1015.4',
    topic: ['egress', 'structure'],
    title: 'Guard opening limitations (4-inch sphere rule)',
    textQuote:
      'Required guards shall not have openings that allow passage of a sphere 4 inches (102 mm) in diameter from the walking surface to the required guard height. Exceptions: 1. From a height of 36 inches (914 mm) to 42 inches (1067 mm), guards shall not have openings that allow passage of a sphere 4 3/8 inches (111 mm) in diameter. 2. The triangular openings at the open sides of a stair, formed by the riser, tread and bottom rail shall not allow passage of a sphere 6 inches (152 mm) in diameter. 3. At elevated walking surfaces for access to and use of electrical, mechanical or plumbing systems or equipment, guards shall not have openings that allow passage of a sphere 21 inches (533 mm) in diameter. 4. In assembly seating areas, guards required at the end of aisles in accordance with Section 1029.17.4 shall not have openings that allow passage of a sphere 4 inches in diameter up to a height of 26 inches.',
    summary:
      'NYC 4-inch sphere rule for guards: openings up to required guard height cannot pass a 4-in. sphere. Stair triangle exception is 6 in.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-173898',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1020.2',
    topic: ['egress', 'corridors'],
    title: 'Corridor width and capacity',
    textQuote:
      'The required capacity of corridors shall be determined as specified in Section 1005.1, but the minimum width shall be not less than that specified in Table 1020.2. Per Table 1020.2: Any facilities not listed below = 44 inches; Access to and utilization of mechanical, plumbing or electrical systems or equipment = 24 inches; With a required occupancy capacity less than 50 = 36 inches; Within a dwelling unit = 36 inches; In Group E with a corridor having a required capacity of 100 or more = 72 inches; In corridors and areas serving stretcher traffic in ambulatory care facilities = 72 inches; Group I-2 in areas where required for bed movement = 96 inches.',
    summary:
      'NYC corridor minimums: 44 in. (most uses); 36 in. (<50 occupants OR within dwelling unit); 72 in. (assembly E ≥100, ambulatory care); 96 in. (hospital bed movement). 24 in. for MEP-access only.',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-174048',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §1020.4',
    topic: ['egress', 'corridors'],
    title: 'Dead-end corridor limits',
    textQuote:
      'Where more than one exit or exit access doorway is required, the exit access shall be arranged such that there are no dead ends in corridors more than 20 feet (6096 mm) in length. Exceptions: 1. In occupancies in Group I-3 of Occupancy Condition 2, 3 or 4, the dead end in a corridor shall not exceed 50 feet (15 240 mm). 2. In occupancies in Groups B, E, F, I-1, M, R-1, R-2, R-4, S and U, where the building is equipped throughout with an automatic sprinkler system in accordance with Section 903.3.1.1, the length of the dead-end corridors shall not exceed 50 feet (15 240 mm). 3. A dead-end corridor shall not be limited in length where the length of the dead-end corridor is less than 2.5 times the least width of the dead-end corridor.',
    summary:
      'NYC dead-end corridors: 20 ft non-sprinklered; 50 ft if building is fully sprinklered (Groups B/E/F/I-1/M/R-1/R-2/R-4/S/U).',
    appliesTo: 'all occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-174057',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Building Code',
    sectionNumber: 'BC §907.2.9',
    topic: ['fire_protection', 'fire_alarm'],
    title: 'Group R-2 fire alarm system thresholds',
    textQuote:
      'A fire alarm system without alarm notification appliances and smoke alarms shall be installed in Group R-2 occupancies, other than student apartments regulated by Section 907.2.9.1, where any of the following conditions exist: 1. Any dwelling unit or sleeping unit is located three or more stories above the lowest level of exit discharge (including penthouses and rooftop dwelling units). 2. Any dwelling unit or sleeping unit is located more than one story below the highest level of exit discharge of exits serving the dwelling unit or sleeping unit. 3. The building contains more than 16 dwelling units or sleeping units. The activation of any detector required by this section shall initiate a signal at a central supervising station or a constantly attended location.',
    summary:
      'NYC Group R-2 fire alarm required when: (a) any unit is 3+ stories above lowest exit discharge, (b) any unit is more than 1 story below highest exit discharge, OR (c) building has >16 dwelling/sleeping units.',
    appliesTo: 'Group R-2 (apartments and dormitories)',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/newyorkcity/latest/NYCadmin/0-0-0-171839',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Energy Conservation Code',
    sectionNumber: 'NYECC §R402.1.2',
    topic: ['energy_envelope'],
    title: 'Residential thermal envelope insulation Climate Zone 4 (synthesized)',
    textQuote:
      'Per Table R402.1.2 (Insulation and Fenestration Requirements by Component) for Climate Zone 4 (which covers New York City): Fenestration U-factor = 0.32 (NYC amendment) / 0.27 (NY State); Skylight U-factor = 0.55; Glazed Fenestration SHGC = 0.40; Ceiling R-value = R-49; Wood Frame Wall R-value = R-20 + R-5 continuous insulation, or R-13 + R-10 continuous insulation; Mass Wall R-value = R-8 / R-13; Floor R-value = R-19; Basement Wall R-value = R-15 continuous / R-19 cavity; Slab R-value and depth = R-10 to 4 ft; Crawlspace Wall = R-15 continuous / R-19 cavity. The opaque thermal envelope of one- and two-family dwellings, townhouses, and Group R-2/R-3/R-4 buildings three stories or less shall comply with these prescriptive component R-values where the insulation R-value compliance path is used.',
    summary:
      'NYECC residential CZ4 prescriptive: ceiling R-49; walls R-20+5ci or R-13+10ci; floor R-19; basement R-15 ci; slab R-10 to 4 ft; window U-0.32 / SHGC 0.40.',
    appliesTo: 'low-rise residential (R-2/R-3/R-4 ≤ 3 stories, 1-2 family)',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-energy-conservation-code-2020/chapter/R4/residential-energy-efficiency',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Energy Conservation Code',
    sectionNumber: 'NYECC §R402.4.1.2',
    topic: ['energy_envelope'],
    title: 'Residential air leakage testing (3.0 ACH50)',
    textQuote:
      'The building or dwelling unit shall be tested and verified as having an air leakage rate not exceeding three (3) air changes per hour. Testing shall be conducted in accordance with RESNET/ICC 380, ASTM E779 or ASTM E1827 and reported at a pressure of 0.2 inch w.g. (50 Pascals). Where required by the code official, testing shall be conducted by an approved third party. A written report of the results of the test shall be signed by the party conducting the test and provided to the code official. Testing shall be performed at any time after creation of all penetrations of the building thermal envelope. During testing: exterior windows and doors, fireplace and stove doors shall be closed, but not sealed, beyond the intended weatherstripping or other infiltration control measures; dampers including exhaust, intake, makeup air, backdraft and flue dampers shall be closed, but not sealed beyond intended infiltration control measures; interior doors, if installed at the time of the test, shall be open.',
    summary:
      'NYC residential building envelope must blower-door-test at 3.0 ACH50 or lower per RESNET/ICC 380 or ASTM E779. Required for CofO sign-off.',
    appliesTo: 'low-rise residential',
    sourceUrl: 'https://up.codes/viewer/new_york_city/nyc-energy-conservation-code-2020/chapter/R4/residential-energy-efficiency',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Local Law 97',
    sectionNumber: 'LL97 / NYC Admin Code §28-320',
    topic: ['energy_envelope', 'jurisdiction_specific'],
    title: 'Building emissions caps and penalties (synthesized)',
    textQuote:
      'Local Law 97 of 2019 (NYC Administrative Code Article 320) sets annual greenhouse gas emissions limits for covered buildings (generally those over 25,000 gross square feet, or two or more buildings on the same tax lot collectively exceeding 50,000 sf). Emissions limits are calculated as the building gross floor area, by occupancy group, multiplied by an annual emissions intensity coefficient (kg CO2e per square foot per year). For the 2024 through 2029 compliance period the coefficient is 0.00846 metric tons CO2e per square foot (8.46 kgCO2e/sf) for Occupancy Group B (office) and 0.00675 (6.75 kgCO2e/sf) for Group R-2 multifamily residential. For 2030 through 2034 the coefficient drops to roughly 0.00453 (Group B) and 0.00407 (Group R-2). The penalty for exceeding the annual limit is $268 per metric ton CO2e over the cap, assessed annually. The law sets a 2050 target of net-zero emissions for the covered building sector.',
    summary:
      'NYC LL97 caps emissions for buildings >25,000 sf. 2024-29: office 8.46 kgCO2e/sf, residential 6.75. Drops further for 2030-34. Penalty $268/ton over cap. Net-zero target 2050.',
    appliesTo: 'buildings over 25,000 gross sf',
    sourceUrl: 'https://www.nyc.gov/site/buildings/codes/ll97-buildings-emissions-limits.page',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Admin Code Title 28',
    sectionNumber: 'NYC Admin Code §28-302 (LL11/FISP)',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'Facade Inspection Safety Program (FISP) cycle (synthesized)',
    textQuote:
      'The exterior walls of all buildings greater than six stories in height (excluding the parts of any exterior wall that are less than 12 inches from the exterior wall of an adjacent building) shall be inspected by a Qualified Exterior Wall Inspector (QEWI) at periodic intervals as set by the department. A critical examination report shall be filed with the department once every five years. Each five-year period is divided into three sub-cycles based on the last digit of the building\'s block number: Sub-cycle A (blocks ending 4, 5, 6, 9), Sub-cycle B (blocks ending 0, 7, 8), Sub-cycle C (blocks ending 1, 2, 3). The QEWI shall classify each building wall and appurtenance as SAFE; UNSAFE; or SAFE WITH A REPAIR AND MAINTENANCE PROGRAM (SWARMP). Unsafe conditions must be remediated and re-inspected within 90 days of the report.',
    summary:
      'NYC LL11/FISP: buildings >6 stories must file 5-year facade inspection by a QEWI. Conditions classified SAFE / SWARMP / UNSAFE. Unsafe must be cured within 90 days. Sub-cycle A/B/C by block-number ending.',
    appliesTo: 'buildings greater than six stories',
    sourceUrl: 'https://www.nyc.gov/site/buildings/safety/facade-local-law.page',
  },
  {
    jurisdiction: 'NYC',
    codeName: 'NYC Admin Code Title 28',
    sectionNumber: 'NYC Admin Code §28-318 (LL152)',
    topic: ['plumbing', 'jurisdiction_specific'],
    title: 'Periodic gas piping inspection (synthesized)',
    textQuote:
      'Local Law 152 of 2016 requires that exposed gas piping systems in all buildings classified in occupancy groups other than R-3 be inspected by a Licensed Master Plumber (LMP), or a qualified individual working under the direct and continuing supervision of an LMP, at least once every four years. The four-year inspection cycle is staggered by Community District: Districts 1, 3, and 10 = January 1 through December 31, 2024; Districts 2, 5, 7, 13, and 18 = 2025; Districts 4, 6, 8, 9, and 16 = 2026; Districts 11, 12, 14, 15, and 17 = 2027. The LMP shall submit a Gas Piping System Periodic Inspection Certification (GPS-1) to the building owner within 30 days of the inspection, and the building owner shall submit a Certification (GPS-2) to the Department of Buildings within 60 days. Conditions identified as immediately hazardous require notification to the utility and Department within 24 hours.',
    summary:
      'NYC LL152: gas piping in non-R-3 buildings must be inspected every 4 years by an LMP. Schedule rotates by Community District. GPS-1 → owner in 30 days; GPS-2 → DOB in 60 days. Hazardous = 24-hour notification.',
    appliesTo: 'all occupancies except Group R-3',
    sourceUrl: 'https://www.nyc.gov/site/buildings/property-or-business-owner/gas-piping-inspections.page',
  },

  // ══════════════════════════════════════════════════════════════
  // Houston deep-dive expansion (2026-05-10).
  //
  // 14 additional Houston entries focused on the things small TX GCs
  // get tripped up by: floodplain (post-Harvey), trees, deed
  // restrictions, permit exemptions, inspections, wind design,
  // expansive-clay slab design, stormwater detention, Harris County
  // OSSF, TX state preemptions (sprinklers, solar), code adoption.
  //
  // Most entries marked "(synthesized)" — the public Houston source
  // PDFs returned binary streams to direct WebFetch and the agent
  // pulled wording from official municode summaries + state statutes.
  // The substance is accurate per cross-checked sources.
  // ══════════════════════════════════════════════════════════════

  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances',
    sectionNumber: 'Houston COO §19-33',
    topic: ['jurisdiction_specific'],
    title: 'Base Flood Elevation Requirements (post-Harvey, eff. 9/1/2018) (synthesized)',
    textQuote:
      'The lowest floor and all utilities of any new construction or substantial improvement shall be elevated to at least the minimum flood protection elevation, except that additions which are no greater than 33% of the habitable area of the existing structure shall be permitted to be constructed at one foot above the base flood elevation. Substantial improvement means any rehabilitation, reconstruction, or addition the cost of which equals or exceeds 50% of the market value of the structure (excluding land value). Within the 100-year (1% annual chance) floodplain, the finished floor elevation (FFE) shall meet or exceed the 500-year base flood elevation plus two feet of freeboard.',
    summary: 'Houston post-Harvey: new construction in 100-yr floodplain must be elevated to 500-yr BFE + 2 ft freeboard. 33%-addition exception = 1 ft above 100-yr BFE.',
    appliesTo: 'new construction + substantial improvements',
    sourceUrl: 'http://houston-tx.elaws.us/code/coor_ch19_artiii_div2_sec19-33',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances',
    sectionNumber: 'Houston COO Ch. 19 Art. III',
    topic: ['jurisdiction_specific'],
    title: 'Floodway Encroachment & Fill Restrictions (synthesized)',
    textQuote:
      'No new construction, substantial improvement, or other development (including fill) shall be permitted within the regulatory floodway unless certification by a licensed Texas P.E. — supported by hydraulic and hydrologic analyses meeting NFIP standards — demonstrates that the encroachment will not result in any increase in flood levels during the base flood. Recreational vehicles placed in Zones A1—30, A99, AH, AE, V, VE, or V1—30 must either be on the site fewer than 180 consecutive days and ready for highway use, or be permitted and meet the elevation and anchoring requirements applicable to manufactured homes. Dry floodproofing in lieu of elevation is allowed only for non-residential structures.',
    summary: 'Houston floodway: no new construction or fill without TX P.E. certification of zero rise. Dry floodproofing only for non-residential.',
    appliesTo: 'all parcels in regulatory floodway',
    sourceUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances?nodeId=COOR_CH19FL',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances',
    sectionNumber: 'Houston COO §§33-122, 33-128',
    topic: ['jurisdiction_specific'],
    title: 'Tree, Shrub & Landscape Buffer Requirements (synthesized)',
    textQuote:
      'A landscape plan shall be submitted as part of the building permit application identifying existing and proposed utility lines (above and below ground), roadways, sidewalks, street lights, trees, shrubs, understory, natural features, and planting/construction details. Preservation of existing vegetation within the landscape buffer may be used to meet the requirements of this section provided the vegetation is preserved in accordance with §33-130. Evergreen screening shall contain a minimum width of 15 feet of green space measured from the property line. Removal of street-tree-list species 1½ inches caliper or greater, or any other species 20-inch caliper or greater, requires written Parks & Recreation Department approval; unnecessary destruction of a protected tree is fineable at $90 per diameter inch.',
    summary: 'Houston Ch. 33 tree ordinance: landscape plan required at permit. Removing protected trees needs Parks approval; fines = $90/diameter inch.',
    appliesTo: 'all permits',
    sourceUrl: 'http://houston-tx.elaws.us/code/coor_ch33_artv_div2_sec33-128',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Code of Ordinances',
    sectionNumber: 'Houston COO §10-552',
    topic: ['jurisdiction_specific'],
    title: 'Deed Restriction Compliance + Civil Penalties',
    textQuote:
      'An owner or owner\'s representative with control over property that is subject to a recorded restriction who, after notice of the provisions of this article, fails to comply with any recorded restriction shall be deemed to civilly violate this article and shall be subject to civil penalties of not more than $1,000.00 per day for violation of this article. Each day of noncompliance shall constitute a separate violation. Authority derives from Chapter 212 of the Texas Local Government Code and Art. XV §§10-551 through 10-555 of the City of Houston Code of Ordinances; the City is authorized to enforce by suit for injunction restrictions affecting property use, building setback distances, lot and structure sizes, structure orientation, and fences requiring permits.',
    summary: 'Houston has no zoning, but deed restrictions are city-enforceable. $1,000/day civil penalty per violation. Confirms why Houston GCs check restrictive covenants BEFORE designing setbacks.',
    appliesTo: 'all parcels with recorded restrictions',
    sourceUrl: 'https://library.municode.com/tx/houston/codes/code_of_ordinances?nodeId=COOR_CH10BUNEPR_ARTXVDERECO',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Residential Code (2021 IRC w/ Houston amendments, eff. 1/1/2024)',
    sectionNumber: 'IRC §R105.2 (Houston amendment)',
    topic: ['jurisdiction_specific'],
    title: 'Permit Exemptions (synthesized)',
    textQuote:
      'Permits shall not be required for one-story detached accessory structures used as tool/storage sheds, playhouses and similar uses, provided the floor area does not exceed 120 square feet (11.15 m²), other than storm shelters. Roof coverings that do not exceed an aggregate of 100 square feet (9.29 m²) are exempt from permit; any re-roof exceeding this area requires a roofing permit. Exemption from permit shall not be deemed authorization to perform work in violation of this code or any other code, law, or ordinance. Exemptions do NOT apply to work that cuts structural elements or load-bearing supports, alters required egress, or rearranges water supply, sewer, drainage, gas, waste, vent, or electrical systems affecting public health/safety.',
    summary: 'Houston permit exemptions: storage sheds ≤120 sf, re-roofs ≤100 sf aggregate. Structural / egress / MEP changes always need permits.',
    appliesTo: 'residential',
    sourceUrl: 'https://up.codes/viewer/houston/irc-2021/chapter/1/scope-and-administration',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Building Code 2021 (Houston amendments)',
    sectionNumber: 'HBC §110',
    topic: ['jurisdiction_specific'],
    title: 'Required Inspection Sequence (synthesized)',
    textQuote:
      'Footing and foundation inspections shall be made after excavations for footings are complete and any required reinforcing steel is in place; for concrete foundations any required forms shall be in place prior to inspection. Framing inspections shall be made after the roof deck or sheathing, all framing, fireblocking, and bracing are in place and pipes, chimneys, and vents to be concealed are complete and the rough electrical systems are in place. Plumbing, mechanical, gas, and electrical rough-ins shall each be inspected before being concealed. The final inspection shall be made after all work required by the building permit is completed; if located in a flood hazard area, documentation of the elevation of the lowest floor as required in §1612.4 shall be submitted to the building official prior to the final inspection.',
    summary: 'Houston inspection sequence: footing → frame (after MEP rough) → MEP rough each before conceal → final. Flood-zone projects require elevation cert before final.',
    appliesTo: 'all',
    sourceUrl: 'https://up.codes/viewer/houston/ibc-2021/chapter/1/scope-and-administration',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Building Code 2021',
    sectionNumber: 'HBC §1609 / IRC R301.2.1 (Houston practice)',
    topic: ['structure'],
    title: 'Wind Design Criteria — 139 mph Risk Cat II (synthesized)',
    textQuote:
      'Houston basic wind speed (Vult, ASCE 7-16) for Risk Category II structures is 139 mph; designs at or above 140 mph trigger "wind design required" per IRC R301.2.1.1, and Houston practice typically uses 140 mph as the design value with Exposure Category C for typical suburban/open-terrain sites. Where Vult as modified by Table R301.2.1.5.1 equals or exceeds 140 mph the building shall be considered "wind design required" and conventional light-frame construction provisions are not permitted; engineered design per ASCE 7 (or AWC WFCM, ICC-600) is required. Houston is NOT within a designated Wind-Borne Debris Region under TDI, but engineers commonly specify impact-rated glazing for high-rise and coastal-adjacent zones.',
    summary: 'Houston: 139 mph design wind speed; ≥140 mph triggers engineered design. Exposure C standard. Not a TDI Wind-Borne Debris Region (impact glazing optional).',
    appliesTo: 'all',
    sourceUrl: 'https://up.codes/viewer/houston/ibc-2021/chapter/16/structural-design',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'PTI DC 10.5 (Houston engineering practice)',
    sectionNumber: 'PTI DC 10.5 / Beaumont Formation soils',
    topic: ['structure'],
    title: 'Post-Tensioned Slab-on-Ground for Expansive Clay (synthesized)',
    textQuote:
      'Most homes built in the Houston area in the last 25 years use post-tensioned slab-on-ground foundations to resist movement from expansive clay soils (Houston Black Clay, Beaumont/Lissie formations) which can have Plasticity Index >35 and PVR (potential vertical rise) >2 inches. Engineering plans per PTI DC 10.5 (formerly PTI 3rd Edition) shall specify beam depths, beam spacing (commonly 12-15 ft on center), slab thickness (typically 4-5 in), reinforcement, edge-lift and center-lift design moments based on a site-specific geotechnical report, and cable tension values. Cables are tensioned 3-7 days after placement to approximately 33,000 lb force per cable; a typical 2,000 sf home uses 40-60 cables. The City of Houston requires a sealed engineered foundation design by a Texas P.E. for any new SFR slab.',
    summary: 'Houston expansive clay → PTI DC 10.5 post-tensioned slab is standard. Sealed TX P.E. foundation design required for any new SFR. ~40-60 cables for a 2,000 sf home, tensioned to 33,000 lb each.',
    appliesTo: 'new SFR slab construction',
    sourceUrl: 'https://www.txpropertyinspections.com/blog/expansive-clay-soil-the-hidden-force-that-cracks-foundations',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Infrastructure Design Manual',
    sectionNumber: 'Houston IDM Ch. 9 (eff. 6/1/2026)',
    topic: ['jurisdiction_specific'],
    title: 'Stormwater Detention Requirements (synthesized)',
    textQuote:
      'Single-family residential lots of 15,000 square feet or less are not required to provide on-site detention if total impervious area is ≤65% of lot area; lots exceeding 65% impervious shall provide detention volume of 0.75 acre-feet per acre of impervious area. For all other new development, redevelopment, or site modification under 20 acres, a flat detention rate of 0.8 acre-feet per disturbed acre applies. Qualifying redevelopment projects may earn detention credit for removed impervious area at 0.4 acre-feet per acre. "Impervious surface" includes structures, roofs, swimming pools, foundations (pier-and-beam or slab), driveways, parking areas, patios/decks, walkways, and compacted/rolled areas.',
    summary: 'Houston detention: SFR ≤15K sf with ≤65% impervious is exempt. Non-SFR or large jobs: 0.8 acre-ft/disturbed acre. Pools + driveways count as impervious.',
    appliesTo: 'new development + site modifications',
    sourceUrl: 'https://houstonrecovers.org/wp-content/uploads/2018/06/IDM-CH-9-Show-changes.pdf',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Harris County Regulations',
    sectionNumber: 'Harris Co. Infrastructure Regs (eff. 7/9/2019)',
    topic: ['zoning', 'setbacks'],
    title: 'Public ROW + 25-ft Building Setback (Harris County) (synthesized)',
    textQuote:
      'Public road rights-of-way shall be a minimum fifty feet (50\') in width and shall conform to the Geometric Design Guidelines as adopted by Harris County Commissioners\' Court. A building setback line of not less than twenty-five feet (25\') from the road right-of-way shall be imposed on tracts intended for construction of a single-family structure or structures. Lots shall be of sufficient acreage to meet minimum requirements for on-site sewage service per TCEQ Chapter 285.4 Facility Planning regulations, unless served by public water and/or sewage.',
    summary: 'Unincorporated Harris Co.: 50-ft min ROW, 25-ft front building setback for SFR. Lot must accommodate OSSF if no public sewer.',
    appliesTo: 'unincorporated Harris County SFR',
    sourceUrl: 'https://www.eng.hctx.net/portals/23/infraregs-effect190709.pdf',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Harris County / Texas 30 TAC §285',
    sectionNumber: 'TX 30 TAC §285 (Harris Co. OSSF)',
    topic: ['plumbing'],
    title: 'On-Site Sewage Facility (OSSF) Requirements (synthesized)',
    textQuote:
      'OSSF systems in unincorporated Harris County (and within the County\'s OSSF jurisdiction) must meet all requirements of the Harris County Local Order and Texas 30 TAC §285. A preconstruction site evaluation by a licensed site evaluator or licensed Texas P.E. is required, including a survey of the entire lot, soil analysis in the proposed disposal area, groundwater observation, and identification of other criteria necessary to determine OSSF suitability. Feasibility studies must be submitted via Harris County\'s ePermits electronic plan submittal system. Inspection of the sewerage system is required prior to any component being covered, and a 24-hour notice shall be given to the Engineering Department; inspections may only be called in by the licensed installer.',
    summary: 'Harris County OSSF (septic): preconstruction site eval by licensed evaluator/PE. Submit via ePermits. 24-hour inspection notice; only licensed installer can call inspections.',
    appliesTo: 'unincorporated Harris County',
    sourceUrl: 'https://oce.harriscountytx.gov/Services/Permits/Permits-A-to-Z/Residential-Construction-On-site-Sewage-System-Septic',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Texas Property Code §202.010',
    sectionNumber: 'TX Prop Code §202.010 (Solar Rights Act)',
    topic: ['energy_envelope', 'jurisdiction_specific'],
    title: 'HOA Solar Ban Preemption (statewide)',
    textQuote:
      'A property owners\' association may not include or enforce a provision in a dedicatory instrument that prohibits or restricts a property owner from installing a solar energy device. A provision that violates this section is void. A property owners\' association or its architectural review committee may not withhold approval for installation of a solar energy device if the provisions of the dedicatory instruments are met or exceeded, unless the association determines in writing that placement constitutes a condition that substantially interferes with the use and enjoyment of land by causing unreasonable discomfort or annoyance to persons of ordinary sensibilities. "Solar energy device" has the meaning assigned by Tax Code §171.107 and (per HB 431, eff. 5/29/2025) expressly includes solar roof tiles.',
    summary: 'TX state law preempts HOA solar bans. HOAs that try to block solar = void. Solar roof tiles explicitly included since 5/29/2025.',
    appliesTo: 'all TX HOAs',
    sourceUrl: 'https://codes.findlaw.com/tx/property-code/prop-sect-202-010/',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'TDI Roofing Discount Rule / IBHS FORTIFIED',
    sectionNumber: 'TDI Class 4 / UL 2218 (advisory)',
    topic: ['roofing', 'jurisdiction_specific'],
    title: 'Class 4 Impact-Resistant Roofing — Houston Hail-Belt (synthesized)',
    textQuote:
      'Houston building code does not mandate Class 4 impact-resistant roofing, but the Texas Department of Insurance maintains a Products Qualifying for Impact-Resistant Roofing Credits list, and most Texas insurers offer 10-28% premium discounts when a Class 4 (UL 2218) shingle is installed. Class 4 rating is earned by surviving a 2-inch steel ball drop from 20 feet without cracking. North and West Houston (Cypress, Katy, The Woodlands) sit in a recurring hail corridor producing hail ≥2 inches in diameter; the IBHS FORTIFIED Roof Hail Supplement requires shingles rated "Excellent" or "Good" on the IBHS Impact-Resistant Shingle Performance Ratings. Builders should specify Class 4 in standard residential roofing scopes for both insurability and durability.',
    summary: 'Houston Class 4 roofing isn\'t required, but TDI lists qualifying products and most insurers give 10-28% premium discounts. Standard practice in N/W Houston hail corridors.',
    appliesTo: 'residential reroof + new construction',
    sourceUrl: 'https://www.tdi.texas.gov/company/roofing-discounts.html',
  },
  {
    jurisdiction: 'Houston',
    codeName: 'Houston Construction Code',
    sectionNumber: 'Council Ord. 10/25/2023 (eff. 1/1/2024)',
    topic: ['jurisdiction_specific'],
    title: '2021 Construction Code Modernization (synthesized)',
    textQuote:
      'The City of Houston adopted the 2021 family of International Codes (IBC, IRC, IECC, IMC, IPC, IFGC, IEBC) plus the 2017 NEC with Houston Amendments by Council ordinance 10/25/2023, effective 1/1/2024. The Houston Construction Code consists of Chapter 1 Administration (Parts 1—Scope/Application §§101—102 and Part 2—Administration/Enforcement §§103—116) plus the model code chapters as amended. Section 105 governs Permits and fees; §107 Submittal Documents; §111 Stop Work Orders; §114 Inspections. The Houston Plumbing Code is based on the 2015 Uniform Plumbing Code with Houston Amendments — NOT the IPC — diverging from the rest of the Construction Code family.',
    summary: 'Houston adopted 2021 ICC family + 2017 NEC eff. 1/1/2024. Plumbing code uniquely uses 2015 UPC (not IPC) — small GCs trip on this when reading "the code" generically.',
    appliesTo: 'all',
    sourceUrl: 'https://www.houstonpermittingcenter.org/construction-code-modernization/code-amendment',
  },

  // ══════════════════════════════════════════════════════════════
  // LA deep-dive (2026-05-10) — 16 entries on Wildland Urban
  // Interface (WUI / VHFHSZ Class A roof, ember-resistant vents,
  // ignition-resistant siding, dual-pane windows, defensible space),
  // Mansionization + Hillside ordinances, Non-Ductile Concrete
  // retrofit, HPOZ, CA Title 24 + CalGreen, plan check fees,
  // permit expiration. CA Title 24 + CalGreen entries flagged with
  // jurisdiction='LA' since LA enforces them; they apply statewide.
  // ══════════════════════════════════════════════════════════════
  {
    jurisdiction: 'LA',
    codeName: 'CA Building Code (LA-adopted)',
    sectionNumber: 'CBC §705A',
    topic: ['roofing', 'fire_protection', 'jurisdiction_specific'],
    title: 'VHFHSZ — Class A roofing assemblies',
    textQuote: 'Roofs shall comply with the requirements of Chapter 7A and Chapter 15. Roofs shall have a roofing assembly installed in accordance with its listing and the manufacturer\'s installation instructions. Roof assemblies in the Fire Hazard Severity Zones shall be Class A rating when tested in accordance with ASTM E108 or UL790. Where the roofing profile has an airspace under the roof covering, installed over a combustible deck, a 72 lb. cap sheet complying with ASTM D3909 shall be installed over the roof deck. Bird stops shall be used at the eaves when the profile fits, to prevent debris at the eave. Hip and ridge caps shall be mudded in to prevent intrusion of fire or embers.',
    summary: 'LA VHFHSZ roofs must be Class A (ASTM E108 / UL790); cap sheet over combustible decks, bird stops, mudded ridge caps required.',
    appliesTo: 'residential and commercial in VHFHSZ',
    sourceUrl: 'https://up.codes/viewer/california/ca-building-code-2022/chapter/7A/sfm-materials-and-construction-methods-for-exterior-wildfire-exposure',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CA Building Code (LA-adopted)',
    sectionNumber: 'CBC §706A',
    topic: ['fire_protection', 'jurisdiction_specific'],
    title: 'VHFHSZ — Ember-resistant ventilation openings',
    textQuote: 'Ventilation openings for enclosed attics, eave soffits, enclosed rafter spaces formed where ceilings are applied directly to the underside of roof rafters, and underfloor ventilation openings shall be Wildfire Flame and Ember Resistant vents approved and listed by the California State Fire Marshal, or WUI vents tested to ASTM E2886. Off-ridge vents must feature noncombustible, corrosion-resistant mesh with openings between 1/16-inch and 1/8-inch diameter to block ember entry. Ventilation openings shall not be installed in eaves and cornices unless meeting these requirements. Ventilation openings on the underside of eaves shall be located closer to the roof than to the wall.',
    summary: 'All attic, soffit, rafter, and underfloor vents in LA VHFHSZ must be SFM-listed ember-resistant or ASTM E2886 WUI-rated.',
    appliesTo: 'residential and commercial in VHFHSZ',
    sourceUrl: 'https://up.codes/viewer/california/ca-building-code-2022/chapter/7A/sfm-materials-and-construction-methods-for-exterior-wildfire-exposure',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CA Building Code (LA-adopted)',
    sectionNumber: 'CBC §707A',
    topic: ['structure', 'fire_protection', 'jurisdiction_specific'],
    title: 'VHFHSZ — Ignition-resistant exterior wall covering',
    textQuote: 'Exterior wall coverings shall comply with one of the following: Noncombustible material; Ignition-resistant material per Section 704A.2; Heavy-timber exterior wall assembly; Log wall construction assembly; Wall assemblies that meet performance criteria of SFM Standard 12-7A-1; or Fire-retardant-treated wood labeled for exterior use. Exterior wall coverings shall extend from the top of the foundation to the roof, and terminate at 2 inch nominal solid wood blocking between rafters at all roof overhangs, or in the case of enclosed eaves terminate at the enclosure. Wall openings into attics shall be protected as required for exterior walls.',
    summary: 'LA VHFHSZ siding: noncombustible, ignition-resistant per §704A.2, heavy-timber, log, FRT wood, or pass SFM 12-7A-1.',
    appliesTo: 'residential and commercial in VHFHSZ',
    sourceUrl: 'https://up.codes/viewer/california/ca-building-code-2022/chapter/7A/sfm-materials-and-construction-methods-for-exterior-wildfire-exposure',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CA Building Code (LA-adopted)',
    sectionNumber: 'CBC §708A',
    topic: ['fire_protection', 'jurisdiction_specific'],
    title: 'VHFHSZ — Exterior windows and glazing (dual-pane / tempered)',
    textQuote: 'Exterior windows, window walls and glazed doors, exterior structural glass veneer and skylights shall be tested, listed and labeled. Exterior windows and skylights shall comply with one of the following: Be constructed of multipane glazing with a minimum of one tempered pane meeting the requirements of Section 2406 Safety Glazing; Be constructed of glass block units; Have a fire-resistance rating of not less than 20 minutes when tested according to NFPA 257; or Be tested to meet the performance requirements of SFM Standard 12-7A-2. Exterior door assemblies shall conform to the performance requirements of SFM 12-7A-1 or be of approved noncombustible construction, or solid core wood having stiles and rails not less than 1-3/8 inches thick.',
    summary: 'LA VHFHSZ windows + skylights: multipane with at least one tempered pane, OR glass block, OR 20-min rated, OR SFM 12-7A-2.',
    appliesTo: 'residential and commercial in VHFHSZ',
    sourceUrl: 'https://up.codes/viewer/california/ca-building-code-2022/chapter/7A/sfm-materials-and-construction-methods-for-exterior-wildfire-exposure',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Municipal Code',
    sectionNumber: 'LAMC §12.21.1 / Ord. 184,802',
    topic: ['zoning', 'far', 'jurisdiction_specific'],
    title: 'Baseline Mansionization Ordinance — R1 FAR cap (synthesized)',
    textQuote: 'For lots in the R1 Zone, the maximum Residential Floor Area contained in all Buildings and Accessory Buildings shall not exceed 0.45 times the Lot Area, regardless of Lot size. The Floor Area Ratio for the RA, RE40, RE20, RE15, RE11, and RE9 Zones is 0.40 of the Lot Area, and 0.45 of the Lot Area for the RS Zone. An Encroachment Plane is established as an inclined plane sloping inward at a maximum angle of 45 degrees, beginning at a height of 20 feet directly above the minimum required front and side yard setbacks, which a Building may not intersect. Bonuses up to 20 percent of the base FAR are available for projects providing Green Building elements or qualifying architectural articulation.',
    summary: 'BMO caps R1 residential FAR at 0.45 × lot area + 45-degree encroachment plane at 20 ft above setbacks. +20% bonus for green-building.',
    appliesTo: 'single-family R1 / RS / RE / RA',
    sourceUrl: 'https://planning.lacity.gov/ordinances/docs/baseline/bmo_bho.pdf',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Municipal Code',
    sectionNumber: 'LAMC §12.21 C.10',
    topic: ['zoning', 'far', 'jurisdiction_specific'],
    title: 'Baseline Hillside Ordinance — slope-band FAR (synthesized)',
    textQuote: 'For each Lot located in a Hillside Area within an RA, RE, RS or R1 Zone, the maximum Residential Floor Area contained in all Buildings and Accessory Buildings shall not exceed the sum of the square footage of each Slope Band on the Lot multiplied by the corresponding Floor Area Ratio for the Zone of the Lot, as set forth in Table 12.21 C.10-2a. Slope Bands are defined as 0–14.99%, 15–29.99%, 30–44.99%, 45–59.99%, 60–99.99%, and 100% or greater, with progressively lower allowable FAR as slope increases. In no event shall the maximum Residential Floor Area exceed the value provided by the Maximum Residential Floor Area table for the corresponding Zone and Lot Size.',
    summary: 'BHO: hillside FAR = sum of (each slope band area × zone-specific FAR). Steeper slope bands earn less buildable floor area.',
    appliesTo: 'single-family in designated Hillside Area',
    sourceUrl: 'https://planning.lacity.gov/ordinances/docs/baseline/bmo_bho.pdf',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Building Code',
    sectionNumber: 'LABC §1613.5 / Ord. 183,893',
    topic: ['structure', 'special_inspections', 'jurisdiction_specific'],
    title: 'Non-Ductile Concrete Retrofit — scope (synthesized)',
    textQuote: 'The provisions of this section apply to each existing concrete building having concrete floors and/or roofs, either with or without beams, supported by concrete walls and/or concrete columns, and/or concrete frames with or without masonry (block or brick) infills, or any combination thereof, built pursuant to a permit application for a new building submitted to the Department before January 13, 1977. The provisions of this section do not apply to detached single-family dwellings or detached duplexes. The owner of each building within the scope of this section shall cause a structural analysis to be made by a civil or structural engineer, and shall complete a seismic retrofit of the building, within 25 years from the date of the order to comply.',
    summary: 'LA Ord. 183,893: pre-1977 concrete buildings (not SFR/duplex) must have structural eval + seismic retrofit within 25 yrs of compliance order.',
    appliesTo: 'pre-1977 concrete buildings (not SFR/duplex)',
    sourceUrl: 'https://dbs.lacity.gov/services/specialized-services/mandatory-retrofit-programs/non-ductile-concrete-retrofit-program',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Municipal Code',
    sectionNumber: 'LAMC §12.20.3',
    topic: ['zoning', 'jurisdiction_specific'],
    title: 'Historic Preservation Overlay Zone (HPOZ) review (synthesized)',
    textQuote: 'Within an HPOZ, no person shall make a Major or Minor Alteration, Addition, demolition, removal or relocation of any Contributing or Non-Contributing Element, nor construct any new Building or Structure, nor cause the same to be done, unless and until a Certificate of Appropriateness, a Certificate of Compatibility, or a Conforming Work clearance has been issued by the Director of Planning, the Cultural Heritage Commission, or the Area Planning Commission as applicable. Work that is solely interior, ordinary maintenance and repair using in-kind materials, and work entirely concealed from public view that does not affect Character-Defining Features may proceed without a Certificate of Appropriateness, but shall be reviewed for Conforming Work status before any building permit is issued.',
    summary: 'LA HPOZ: any exterior alteration / addition / demo / new construction needs Certificate of Appropriateness or Compatibility before permit.',
    appliesTo: 'properties within designated HPOZ',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-112632',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CA Title 24 Part 6',
    sectionNumber: 'T24 §150.0(c)',
    topic: ['energy_envelope', 'jurisdiction_specific'],
    title: 'Mandatory wall insulation — Climate Zone 9 (LA basin)',
    textQuote: 'Opaque portions of above grade walls separating conditioned spaces from unconditioned spaces or ambient air shall meet the following requirements: 2×4 inch framing shall have an overall assembly U-factor not exceeding U-0.095. 2×6 inch or greater framing shall have an overall assembly U-factor not exceeding U-0.069. In wood framed assemblies, compliance with U-factors may be demonstrated by installing wall insulation with an R-value of R-15 in 2×4 assemblies, and R-21 in 2×6 assemblies with 16 inches on center spacing. Nonframed opaque assemblies shall have an overall assembly U-factor not exceeding U-0.102. Climate Zone 9 prescriptive package additionally requires R-38 ceiling, U-0.30 fenestration, and 0.23 SHGC per Table 150.1-A.',
    summary: 'LA basin (CZ 9) mandatory: R-15 in 2x4 walls, R-21 in 2x6, R-38 ceiling, U-0.30 fenestration, SHGC 0.23 prescriptive.',
    appliesTo: 'low-rise residential new construction',
    sourceUrl: 'https://up.codes/s/mandatory-features-and-devices',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CA Title 24 Part 6',
    sectionNumber: 'T24 §150.1(c)14',
    topic: ['energy_envelope', 'jurisdiction_specific'],
    title: 'Mandatory PV solar — new single-family (synthesized)',
    textQuote: 'All single-family residential buildings shall have a newly installed photovoltaic (PV) system or newly installed PV modules meeting the minimum qualification requirements specified in Joint Appendix JA11. The annual electrical output of the PV system shall be no less than the smaller of a PV system size determined using Equation 150.1-C, or the maximum PV system size that can be installed on the building\'s Solar Access Roof Area (SARA). Exception 1: No PV system is required when the SARA is less than 80 contiguous square feet. Exception 2: No PV system is required when the minimum PV system size specified by Equation 150.1-C is less than 1.8 kWdc. PV system sizes determined using Equation 150.1-C may be reduced by 25 percent if installed in conjunction with a battery storage system.',
    summary: 'New CA SFR must include JA11-qualified PV system per Equation 150.1-C unless SARA < 80 sf or min size < 1.8 kWdc.',
    appliesTo: 'new single-family residential',
    sourceUrl: 'https://www.energy.ca.gov/programs-and-topics/programs/building-energy-efficiency-standards/energy-code-support-center/2022-0',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CalGreen Part 11',
    sectionNumber: 'CalGreen §4.106.4.1',
    topic: ['parking', 'jurisdiction_specific'],
    title: 'EV-ready raceway — one- and two-family / townhouses (synthesized)',
    textQuote: 'For each dwelling unit, install a listed raceway to accommodate a dedicated 208/240-volt branch circuit. The raceway shall not be less than trade size 1 (nominal 1-inch inside diameter). The raceway shall originate at the main service or subpanel and shall terminate into a listed cabinet, box or other enclosure in close proximity to the proposed location of the EV charger. Raceways are required to be continuous at enclosed, inaccessible or concealed areas and spaces. The service panel and/or subpanel shall provide capacity to install a 40-ampere minimum dedicated branch circuit and space(s) reserved to permit installation of a branch circuit overcurrent protective device. Exception: A raceway is not required if a minimum 40-ampere 208/240-volt dedicated EV branch circuit is installed at the time of original construction.',
    summary: 'New CA SFR/townhouses: 1-inch raceway from panel to garage EV-charger location, 40A 208/240V circuit reserved.',
    appliesTo: 'new SFR / two-family / townhouses with attached garage',
    sourceUrl: 'https://codes.iccsafe.org/content/CAGBC2022P1/chapter-4-residential-mandatory-measures',
  },
  {
    jurisdiction: 'LA',
    codeName: 'CalGreen Part 11',
    sectionNumber: 'CalGreen §4.303',
    topic: ['plumbing', 'jurisdiction_specific'],
    title: 'Indoor water-use efficiency — fixture flow rates',
    textQuote: 'A 20 percent reduction in the overall use of potable water within the building shall be provided. Plumbing fixtures and fittings shall comply with the following maximum flow rates: Showerheads — 1.8 gpm @ 80 psi; Lavatory faucets (residential) — 1.2 gpm @ 60 psi; Kitchen faucets — 1.8 gpm @ 60 psi (with optional temporary boost up to 2.2 gpm provided default returns to 1.8 gpm); Water closets — 1.28 gallons per flush; Urinals — 0.125 gallons per flush. The 20-percent reduction may be demonstrated by either: (1) each fixture meeting the maximum flow rate values above; or (2) by computing the building "water use" baseline and design totals using the formula Flow rate × Duration × Occupants × Daily uses. ENERGY STAR-certified clothes washers and dishwashers are required.',
    summary: 'CalGreen mandatory: 1.28 gpf toilets, 0.125 gpf urinals, 1.8 gpm showerheads, 1.2 gpm residential lavs, 1.8 gpm kitchen faucets.',
    appliesTo: 'all new buildings (residential and nonresidential)',
    sourceUrl: 'https://codes.iccsafe.org/content/CAGBC2022P1/chapter-4-residential-mandatory-measures',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Building Code',
    sectionNumber: 'LAMC §91.107',
    topic: ['jurisdiction_specific'],
    title: 'Plan check + permit fees calculation (synthesized)',
    textQuote: 'A fee for each plan check shall be paid to the Department at the time of submitting plans and specifications for checking. The plan check fee for buildings or structures shall be ninety percent (90%) of the building permit fee as established in Section 91.107.5 and Table No. 1-A. The plan check fee shall be in addition to the permit fee. The valuation to be used in computing the permit fee shall be the total value of all construction work for which the permit is issued, including all finish work, painting, roofing, electrical, plumbing, heating, air conditioning, elevators, fire-extinguishing systems, and any other permanent equipment. Where work for which a permit is required is started or proceeded with prior to obtaining said permit, fees shall be doubled as provided in this Code.',
    summary: 'LA plan check fee = 90% of building permit fee. Permit fee from Table 1-A based on full construction valuation. Unpermitted-then-discovered work = double fee.',
    appliesTo: 'all construction permits',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-172789',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Municipal Code',
    sectionNumber: 'LAMC §98.0602',
    topic: ['jurisdiction_specific'],
    title: 'Permit expiration time limits',
    textQuote: 'Every permit issued shall be valid for a period of two years from the date thereof, provided that any permit shall expire 12 months from date of issuance if the work authorized under any permit associated to the current scope of work has not been commenced; or shall expire whenever the Department determines the work authorized by any permit has been suspended, discontinued or abandoned for a continuous period of 12 months. Before such work can be recommenced, a new permit shall first be obtained, and the fee therefor shall be one-half the amount required for a new permit for such work, provided no changes have been or will be made in the original plans and specifications, and provided further that such suspension or abandonment has not exceeded one year.',
    summary: 'LA permits last 2 years total; expire at 12 mo if work hasn\'t started, or after any 12-mo work suspension.',
    appliesTo: 'all LADBS construction permits',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-190414',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Building Code',
    sectionNumber: 'LABC §1804.4',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'Site grading + drainage — 5% slope away from building',
    textQuote: 'The ground immediately adjacent to the foundation shall be sloped away from the building at a slope of not less than one unit vertical in 20 units horizontal (5-percent slope) for a minimum distance of 10 feet measured perpendicular to the face of the wall. If physical obstructions or lot lines prohibit 10 feet of horizontal distance, a 5-percent slope shall be provided to an approved alternative method of diverting water away from the foundation. Swales used for this purpose shall be sloped not less than 2 percent where located within 10 feet of the building foundation. Impervious surfaces within 10 feet of the building foundation shall be sloped a minimum of 2 percent away from the building.',
    summary: 'LA grading: 5% drop over first 10 ft from foundation; swales 2% within 10 ft; impervious surfaces 2% min away.',
    appliesTo: 'all foundations',
    sourceUrl: 'https://up.codes/viewer/los_angeles/ca-building-code-2022/chapter/18/soils-and-foundations',
  },
  {
    jurisdiction: 'LA',
    codeName: 'LA Fire Code',
    sectionNumber: 'LAFC Ch. 49 / §4907',
    topic: ['fire_protection', 'jurisdiction_specific'],
    title: 'WUI defensible space (100 ft + Zone 0) (synthesized)',
    textQuote: 'Persons owning, leasing, controlling, operating or maintaining buildings or structures in wildland-urban interface fire areas, and persons owning, leasing or controlling land adjacent to such buildings or structures, shall maintain an effective defensible space by removing and clearing away flammable vegetation and combustible growth from areas within 100 feet of such buildings or structures. Single specimens of trees, ornamental shrubbery or similar plants used as ground covers shall be permitted, provided they do not form a means of rapidly transmitting fire from native growth to any building or structure. Hazardous vegetation and fuels shall be managed to reduce the severity of potential exterior wildfire exposure to buildings. Within the first 5 feet (Zone 0), only noncombustible materials and irrigated, well-maintained ground cover are permitted.',
    summary: 'LA WUI defensible space: 100 ft cleared zone around buildings; Zone 0 (0-5 ft) is ember-resistant noncombustible only.',
    appliesTo: 'all buildings in WUI / VHFHSZ',
    sourceUrl: 'https://codes.iccsafe.org/content/CACLAFC2023P1/chapter-49-requirements-for-wildland-urban-interface-fire-areas',
  },

  // ══════════════════════════════════════════════════════════════
  // Phoenix deep-dive (13 entries) — stucco/lath, ADU 2024, hillside,
  // pool barriers, CZ 2B envelope, Self-Cert, SolarAPP+, MAG.
  // ══════════════════════════════════════════════════════════════
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Residential Code (2024 IRC w/ amendments)',
    sectionNumber: 'PRC §R703.7 / §R703.7.5',
    topic: ['roofing', 'structure'],
    title: 'Exterior Plaster (Stucco) — Lath, Weep Screed, Weather Barrier',
    textQuote: 'The lath shall be attached with 1-1/2-inch-long, 11-gage nails having a 7/16-inch head, or 7/8-inch-long, 16-gage staples, spaced not more than 7 inches on center along framing members or furring and not more than 24 inches on center between framing members or furring. A minimum 0.019-inch (No. 26 galvanized sheet gage) corrosion-resistant weep screed with a minimum vertical attachment flange of 3-1/2 inches shall be provided at or below the foundation plate line on exterior stud walls. The weep screed shall be placed not less than 4 inches above the earth or 2 inches above paved areas and shall be of a type that will allow trapped water to drain to the exterior of the building. The water-resistive barrier shall lap the attachment flange. The exterior lath shall cover and terminate on the attachment flange of the weep screed.',
    summary: 'Phoenix stucco fastening: 16-ga staples 7" oc on framing, 24" oc between. Weep screed 0.019 min, 3-1/2 in flange, 4 in above earth or 2 in above paving. Most-cited stucco rejection.',
    appliesTo: 'residential stucco assemblies',
    sourceUrl: 'https://up.codes/viewer/phoenix/irc-2018/chapter/7/wall-covering',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix PDD TRT-00990',
    sectionNumber: 'PDD TRT-00990 — Lath / Rough Wall',
    topic: ['special_inspections'],
    title: 'Lath Install Required Before Rough Wall Inspection (synthesized)',
    textQuote: 'The City of Phoenix Planning and Development Department Inspections Division will not perform rough wall inspections on exterior walls prior to the complete installation of exterior lath or sheathing on residential or commercial projects. Rationale: substantial code violations have occurred where lath staples or nails penetrated electrical conductors and plumbing installations, and that damage would not be evident if exterior rough walls were passed and covered prior to lath approval. Structural inspectors must verify lath staples are secured into framing members and not the outer plywood or substrate. Lath inspection is a separate gating step in the inspection sequence — schedule lath inspection before requesting rough wall, rough electrical-in-wall, or rough plumbing-in-wall sign-offs on stuccoed exterior assemblies.',
    summary: 'Phoenix sequence: lath inspection MUST be approved before rough wall. Penetrating MEP behind unverified lath = automatic rejection.',
    appliesTo: 'residential + commercial stucco assemblies',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/trt/external/dsd_trt_pdf_00990.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Zoning Ordinance',
    sectionNumber: 'PZO §608',
    topic: ['setbacks'],
    title: 'Accessory Structures — Height & Setbacks (synthesized)',
    textQuote: 'Accessory structures are not permitted within the required front yard. Accessory structures located behind the required front setback but between the primary dwelling unit and the front property line are not permitted unless use permit approval is obtained per Section 307. When located within a required rear or side yard, a maximum height of eight (8) feet is permitted when located less than five (5) feet from a street side property line, and a maximum height of fifteen (15) feet is permitted when located five (5) feet or more from a street side property line. Heights in excess of fifteen (15) feet, when located five feet or more from a street side property line, may be approved through a use permit obtained per Section 307. No setback is required adjacent to a fully dedicated alley, unless needed for required vehicular maneuvering.',
    summary: 'Phoenix accessory structures: not in front yard. 8 ft max if <5 ft from street side; 15 ft max if ≥5 ft. Higher needs use permit.',
    appliesTo: 'R1 districts',
    sourceUrl: 'https://phoenix.municipal.codes/ZO/608',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Zoning Ordinance',
    sectionNumber: 'PZO §608.E (Z-TA-2-24-Y)',
    topic: ['zoning'],
    title: 'Accessory Dwelling Units — 2024 Standards (synthesized)',
    textQuote: 'Each ADU may be up to seventy-five percent (75%) of the gross floor area of the main house, not to exceed 1,000 sf for lots up to 10,000 sf, or 3,000 sf for lots over 10,000 sf. When a lot has no more than one single-family detached primary dwelling, two ADUs are permitted in addition to the primary dwelling unit; a third ADU is permitted only when at least one ADU qualifies as affordable housing and the net lot size is a minimum of 43,560 sf. Side setbacks: minimum five feet from a street-side property line; no setback is required adjacent to a fully dedicated alley. Owner-occupancy: effective April 4, 2026, if the property has an ADU with a CO issued on or after September 14, 2024 and is operated as a short-term rental, the owner must submit a notarized attestation that the owner will reside on the same property. Per Z-TA-2-24-Y (adopted 2024) implementing AZ ARS §9-461.18.',
    summary: 'Phoenix ADUs: up to 75% of main house, capped at 1,000 sf (lots ≤10K sf) or 3,000 sf (>10K). Two ADUs allowed; third needs affordability + 1-acre lot.',
    appliesTo: 'single-family residential',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/pz/z-ta-2-24_adu.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Zoning Ordinance',
    sectionNumber: 'PZO §622 / §623',
    topic: ['setbacks', 'height'],
    title: 'C-1 Neighborhood Retail / C-2 Intermediate Commercial (synthesized)',
    textQuote: 'C-1 and C-2: For non-residential uses, a maximum building height of two stories not to exceed thirty (30) feet is permitted. Building setbacks apply with an additional one (1) foot of setback required for every one (1) foot of height above thirty (30) feet. C-2: Requests to exceed the height limits may be granted by City Council for developments up to four (4) stories not to exceed fifty-six (56) feet upon recommendation from the Planning Commission. C-1: For new commercial and office development on parcels of five acres or less adjacent to pre-existing structures with less than a 25-foot front building setback, the 25-foot minimum building and landscaped setback for buildings less than two stories or thirty feet may be reduced to the minimum setback established by the predominant frontage of existing buildings on a block.',
    summary: 'Phoenix C-1/C-2: 2 stories / 30 ft default. +1 ft setback per ft over 30. C-2 can rise to 4 stories / 56 ft via Council. Contextual front-setback reduction for small infill C-1 sites.',
    appliesTo: 'C-1 / C-2 commercial',
    sourceUrl: 'https://phoenix.municipal.codes/ZO/622',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Zoning Ordinance',
    sectionNumber: 'PZO §710 (Hillside Development)',
    topic: ['far', 'zoning'],
    title: 'Hillside Development — Slope-Tiered Lot Coverage & FAR (synthesized)',
    textQuote: 'A lot or parcel with a slope of ten percent (10%) or greater is considered to be in a hillside development area (a difference of 10 feet or more of grade in 100 feet). For single-family residential hillside development, the maximum disturbed/developed area shall not exceed thirty-five percent (35%) of the lot or 20,000 square feet, whichever is less, with a maximum twenty-five percent (25%) of the lot square footage allowable "under roof." Cut and fill, retaining walls, driveway grades, and natural-area set-aside requirements are tiered by average slope. Building pads, drives, and disturbed limits must be shown on a hillside grading plan; a Hillside Plan checklist review precedes building permit issuance.',
    summary: 'Phoenix Hillside: 10%+ slope triggers HDO. Disturbed area ≤35% of lot OR 20,000 sf (lesser); under-roof ≤25%. Hillside grading plan required pre-permit.',
    appliesTo: 'single-family on slopes ≥10%',
    sourceUrl: 'https://phoenix.municipal.codes/ZO/710',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix City Code / PDD TRT-00618',
    sectionNumber: 'PCC §32A-6',
    topic: ['jurisdiction_specific'],
    title: 'Permit Exemption — Sheds, Shade Structures, Containers (synthesized)',
    textQuote: 'One-story detached accessory structures used as tool and storage sheds, playhouses, non-cantilevered shade structures, and similar uses are exempt from a building permit, provided the floor area does not exceed 200 square feet (aggregate). Unaltered intermodal shipping containers are exempt up to 320 square feet provided they are not modified structurally. Permit exemption does NOT relieve compliance with zoning (setbacks, height, lot coverage), flood plain, hillside, historic, electrical, plumbing, or mechanical codes. Fences not over 7 feet high, retaining walls not retaining more than 4 feet of unbalanced fill measured from bottom of footing, sidewalks/driveways not more than 30 inches above adjacent grade, painting, papering, tiling, carpeting, cabinets, counter tops, and similar finish work are also exempt. Swimming-pool barriers, gas piping, water heaters, HVAC changeouts, and reroofs are NOT exempt and require permits.',
    summary: 'Phoenix permit exemptions: sheds/shade ≤200 sf, intermodal containers ≤320 sf, fences ≤7 ft, retaining walls ≤4 ft fill. Pool barriers, gas, water heaters, HVAC, re-roofs ALWAYS need permits.',
    appliesTo: 'all',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/trt/external/dsd_trt_pdf_00618.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix City Code / PISPSC R305',
    sectionNumber: 'PCC Ch. 39 — Pool Barriers (full detail)',
    topic: ['jurisdiction_specific'],
    title: 'Pool & Spa Barriers — Gate, Latch, Door, Alarm (synthesized)',
    textQuote: 'Outdoor pool/spa enclosures: minimum 5-foot non-climbable fence/wall completely surrounding the pool or property; openings shall not allow passage of a 4-inch sphere. Gates shall be self-closing and self-latching, shall open outward and away from the pool, and the release mechanism shall be located on the pool-side of the gate at least 54 inches above the ground; or if not, the gate latch shall be locked. Where a wall of a dwelling serves as part of the barrier, every door with direct access to the pool shall be equipped with an audible alarm meeting UL 2017 (minimum 7-second continuous tone, 85 dB at 10 feet) OR a self-closing, self-latching device with the release at least 54 inches above the floor, OR a power safety cover meeting ASTM F1346. Above-ground pool ladders shall be removable, lockable, or surrounded by a barrier. Pool electrical bonding and equipotential grid per NEC Art. 680 are required and inspected separately.',
    summary: 'Phoenix pool barrier full detail: 5 ft fence, 4-in sphere rule, self-latch outswing gate ≥54 in. Dwelling-wall doors need UL 2017 audible alarm OR self-latch ≥54 in OR ASTM F1346 power cover. NEC 680 bonding separate inspection.',
    appliesTo: 'residential pools and spas',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/trt/external/dsd_trt_pdf_00144.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Energy Conservation Code (2018 IECC + amendments)',
    sectionNumber: 'PECC Table R402.1.2 (Climate Zone 2B)',
    topic: ['energy_envelope'],
    title: 'CZ 2B Prescriptive Envelope — R-Values & U-Factors (synthesized)',
    textQuote: 'Phoenix is in IECC Climate Zone 2B (hot-dry). Adopted 2018 IECC with Phoenix amendments. Prescriptive Table R402.1.2 minimums for residential: fenestration U-factor 0.40 max; skylight U-factor 0.65 max; glazed fenestration SHGC 0.25 max; ceiling R-38 (R-30 over 100% of ceiling area satisfies R-38 where full-depth uncompressed insulation extends over the wall top plate at the eaves); wood-frame wall R-13 cavity (or equivalent U-0.082); mass wall R-4/6; floor R-13; slab-on-grade R-0 (unheated); crawlspace wall R-5/13. Mandatory air leakage (R402.4): blower-door tested at not more than 5 ACH50. Duct leakage (R403.3.4): total ≤ 4 CFM25 per 100 ft² of conditioned floor area when the air handler is installed. HVAC sized per ACCA Manual J / equipment selected per Manual S / ducts designed per Manual D.',
    summary: 'Phoenix CZ 2B: ceiling R-38, wall R-13, floor R-13, slab R-0 unheated, U-0.40 windows, SHGC 0.25. 5.0 ACH50 air leakage. Manual J/S/D required.',
    appliesTo: 'low-rise residential',
    sourceUrl: 'https://up.codes/viewer/phoenix/iecc-2018/chapter/RE_4/re-residential-energy-efficiency',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix Residential Code',
    sectionNumber: 'PRC §M1601 / §N1103',
    topic: ['energy_mechanical'],
    title: 'HVAC Sizing & Duct Sealing — Common Rejections (synthesized)',
    textQuote: '"Duct joints, longitudinal and transverse seams, and connections in ductwork shall be securely fastened and sealed with welds, gaskets, mastics (adhesives), mastic-plus-embedded-fabric systems, liquid sealants or tapes." Tapes/mastics for fibrous glass ductwork shall be listed and labeled to UL 181A; tapes/mastics for metallic and flexible air ducts shall comply with UL 181B. Duct systems shall be installed per ACCA Manual D. Heating and cooling equipment shall be sized per ACCA Manual S based on building loads calculated per ACCA Manual J. Cloth-back rubber-adhesive duct tape is prohibited unless specifically listed to UL 181A/B. Common Phoenix rejections: oversized AC (failure to submit Manual J/S worksheets, "rule-of-thumb" tonnage), duct leakage > 4 CFM25 per 100 ft² CFA at final, missing return-air pathway from bedrooms, and unsealed boot-to-drywall connections at registers.',
    summary: 'Phoenix HVAC: cloth-back duct tape NOT permitted. UL 181A/B sealants required. Manual J/S/D documentation. Common rejections: oversized AC, duct leak >4 CFM25, missing bedroom return path.',
    appliesTo: 'all HVAC installs',
    sourceUrl: 'https://up.codes/viewer/phoenix/irc-2018/chapter/16/duct-systems',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix City Code (TRT-00523/00653)',
    sectionNumber: 'PCC §32A — Self-Certification Program',
    topic: ['jurisdiction_specific'],
    title: 'Self-Certification — Eligibility & Plan-Review Bypass (synthesized)',
    textQuote: 'The Self-Certification Program eliminates plan review by allowing a registered professional to take responsibility for and certify a project\'s compliance with building code, standards and ordinances. Project size limits: commercial up to 20 acres; industrial and non-hazardous storage up to 80 acres; new residential single-family subdivisions up to 160 acres. Eligibility includes most buildings over 25,000 sf; landscape, parking-lot, inventory, and salvage plans by landscape architects; and grading/drainage and parking-lot plans by civil engineers. Certifying professional must be an Arizona-registered architect or structural engineer with at least three (3) years of registration; a Structural Peer Review Certificate by a PDD-approved Structural Peer Reviewer is required for projects with structural scope. Permits can issue within 1–5 business days. PDD performs random, automatic, and field-initiated audits. Ineligible: high-rise, hazardous occupancies, hospitals, and projects in floodways/historic overlays.',
    summary: 'Phoenix self-cert: AZ-registered architect/SE with 3+ yrs can bypass plan review on commercial ≤20 ac, industrial ≤80 ac, residential subd. ≤160 ac. Structural needs Peer Review Cert. Permits in 1-5 days.',
    appliesTo: 'commercial, industrial, residential subd. (with limits)',
    sourceUrl: 'https://www.phoenix.gov/content/dam/phoenix/pddsite/documents/trt/external/dsd_trt_pdf_00523.pdf',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'Phoenix SolarAPP+ / PCC App. A.2 Pt. 20 §232',
    sectionNumber: 'SolarAPP+ Phoenix',
    topic: ['energy_mechanical', 'jurisdiction_specific'],
    title: 'Residential Solar PV — Permit & Interconnection (synthesized)',
    textQuote: 'The City of Phoenix accepts SolarAPP+ approved designs for application and permitting of residential photovoltaic projects (instant online permit issuance for code-conforming, ≤ ~20 kW DC, single-family residential PV with or without ESS, on existing roofs). Unlike most Arizona jurisdictions, the Phoenix Fire Department requires a separate permit for photovoltaic and battery energy storage systems in addition to the PDD building/electrical permit (rapid-shutdown labeling, fire-access pathways per IFC §1205, and ESS clearances per IFC §1207 enforced by PFD). Inspection sequence: rooftop racking → DC/AC rough → final by PDD → fire final by PFD → utility witness test (APS or SRP). Net billing only — APS RCP-2 export rate ~$0.0617/kWh (10-yr lock); SRP E-27 time-of-use export ~$0.028/kWh (legacy net-metering retired Nov 2025). Interconnection follows ACC minimum standards plus utility tariff.',
    summary: 'Phoenix accepts SolarAPP+ instant permits for ≤20 kW SFR PV. PFD requires SEPARATE permit (rapid shutdown + IFC 1205/1207). Net billing only — APS RCP-2 ~$0.0617/kWh; SRP E-27 ~$0.028/kWh.',
    appliesTo: 'residential PV + ESS',
    sourceUrl: 'https://www.phoenix.gov/administration/departments/pdd/residential-building/resident-plan-reviews/solarapp-photovoltaic.html',
  },
  {
    jurisdiction: 'Phoenix',
    codeName: 'MAG Building Code Amendments & Standards (BCAS)',
    sectionNumber: 'MAG BCAS / MAG Specs (annual)',
    topic: ['jurisdiction_specific'],
    title: 'Maricopa Association of Governments — Regional Standards (synthesized)',
    textQuote: '"The adoption and use of MAG\'s Building Code Amendments and Standards (BCAS) are completely optional at the discretion of local jurisdictions, which may adopt the BCAS in whole or adopt specific documents within it as they see fit." MAG\'s Building Codes Committee provides a regional forum for the development, interpretation, and enforcement of building codes across the Maricopa County region. Operationally, the universally-adopted document is the MAG Uniform Standard Specifications and Details for Public Works Construction (annually updated; 2024 edition current) — referenced by Phoenix, Mesa, Tempe, Scottsdale, Glendale, Chandler, Peoria, Gilbert and Maricopa County for off-site civil work (water/sewer mains, curb/gutter, paving, ROW restoration). Phoenix publishes annual "City of Phoenix Supplements to the MAG Standard Specifications". For building (vertical) code, jurisdictions diverge — confirm the local amendment package; for civil/site work, MAG Specs + local supplement is the controlling document.',
    summary: 'MAG BCAS adoption is optional, but MAG Specs are universally referenced for civil/site work across Phoenix-metro. Vertical building code amendments diverge by city.',
    appliesTo: 'civil/site work in Phoenix-metro',
    sourceUrl: 'https://azmag.gov/Portals/0/Documents/BCC_2013-08-30_2013-MAG-Building-Code-Amendments-and-Standards-Manual.pdf',
  },

  // ══════════════════════════════════════════════════════════════
  // Miami-Dade deep-dive (15 entries) — full HVHZ depth (wind loads,
  // exposure, roof TAS, SWB, wind tunnel, special inspections),
  // 30-year recertification (post-Surfside), Miami 21 T4-T5,
  // FBC Energy CZ 1, CCCL state setback.
  // ══════════════════════════════════════════════════════════════
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code — Building (8th Ed., 2023)',
    sectionNumber: 'FBC §1612',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'Flood Loads — Design within Flood Hazard Areas',
    textQuote: 'Within flood hazard areas as established in Section 1612.3, all new construction of buildings, structures and portions of buildings and structures, including substantial improvement and restoration of substantial damage to buildings and structures, shall be designed and constructed to resist the effects of flood hazards and flood loads. The design and construction of buildings and structures located in flood hazard areas, including coastal high hazard areas (V Zones) and Coastal A Zones, shall be in accordance with Chapter 5 of ASCE 7 and with ASCE 24.',
    summary: 'Miami-Dade flood-zone construction must follow ASCE 7 Ch.5 + ASCE 24. Triggers ABFE elevation, breakaway walls, pile foundations in V-zones.',
    appliesTo: 'all construction in FEMA-mapped flood hazard areas',
    sourceUrl: 'https://up.codes/viewer/florida/fl-building-code-2023/chapter/16/structural-design',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code (HVHZ)',
    sectionNumber: 'FBC §1620.3',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'HVHZ — Mandatory Exposure Category C (or D)',
    textQuote: '1620.3 — All buildings and structures shall be considered to be in Exposure Category C, unless Exposure Category D applies, as defined in Section 26.7 of ASCE 7.',
    summary: 'Miami-Dade HVHZ: cannot take Exposure B reduction. Exposure C is the floor; coastal/water-adjacent gets Exposure D. Common reason wind calcs get rejected.',
    appliesTo: 'all HVHZ structures',
    sourceUrl: 'https://up.codes/s/high-velocity-hurricane-zones-wind-loads',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code (HVHZ)',
    sectionNumber: 'FBC §1620.4',
    topic: ['roofing', 'structure'],
    title: 'HVHZ — Roof Wind Uplift / TAS 100, 100A, 105 (synthesized)',
    textQuote: '1620.4 — For wind force calculations, roof live loads shall not be considered to act simultaneously with the wind load. Roof systems in HVHZ shall additionally satisfy uplift testing per TAS 100 (wind-driven rain), TAS 100(A) (uplift resistance for tile roofs), and TAS 105 (field withdrawal resistance of fasteners) as referenced in FBC Chapter 15 / Test Protocol HVHZ.',
    summary: 'Miami-Dade roof uplift: ignore live load in calc. TAS 100/100A/105 testing required. Most-cited roof permit rejection.',
    appliesTo: 'all roof assemblies in Miami-Dade and Broward',
    sourceUrl: 'https://www.floridabuilding.org/fbc/thecode/2013_Code_Development/HVHZ/FBCB/Chapter_16_2010.htm',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code (HVHZ)',
    sectionNumber: 'FBC §1626.1',
    topic: ['jurisdiction_specific', 'structure'],
    title: 'HVHZ — Whole-Envelope Impact Test Coverage',
    textQuote: '1626.1 — All parts or systems of a building or structure envelope such as, but not limited to, exterior walls, roof, outside doors, skylights, glazing and glass block shall meet impact test criteria or be protected with an external protection device that meets the impact test criteria.',
    summary: 'Miami-Dade HVHZ impact test extends to WHOLE envelope: mansards, canopies, cantilevered overhangs, skylights, glass block. Each needs NOA or external protection.',
    appliesTo: 'all envelope penetrations in HVHZ',
    sourceUrl: 'https://www.floridabuilding.org/fbc/thecode/2013_Code_Development/HVHZ/FBCB/Chapter_16_2010.htm',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code (HVHZ)',
    sectionNumber: 'FBC §1518.2 / §1518.3 / §1518.4',
    topic: ['roofing'],
    title: 'HVHZ — Secondary Water Barrier (synthesized)',
    textQuote: 'The entire roof deck shall be covered with an approved asphalt-impregnated 30# felt underlayment or approved synthetic underlayment installed with nails and tin-tabs in accordance with Section 1518.2, 1518.3 or 1518.4 of the Florida Building Code, Building. Asphalt shingles, metal roof panels or shingles, mineral surfaced roll roofing, slate, and slate-type shingles require two layers of underlayment. In the High-Velocity Hurricane Zone, full sheets of self-adhering membranes shall be installed over a mechanically attached base sheet.',
    summary: 'Miami-Dade re-roof failure source: missing SWB. Full-deck 30# felt or synthetic + tin-tabs mandatory. Peel-and-stick alone (no mechanically attached base) NOT permitted.',
    appliesTo: 'all asphalt shingle / metal / tile re-roofs in HVHZ',
    sourceUrl: 'https://www.miamidade.gov/building/library/2023-fbc-roofing-code-changes.pdf',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code',
    sectionNumber: 'FBC §1709',
    topic: ['structure', 'special_inspections'],
    title: 'Wind Tunnel Testing — When Standard Analysis Fails (synthesized)',
    textQuote: 'Materials and methods of construction that are not capable of being designed by approved engineering analysis or that do not comply with the applicable referenced standards, or alternative test procedures in accordance with Section 1707, shall be load tested in accordance with Section 1709. Where concrete and clay roof tiles do not satisfy the limitations in Chapter 16 for rigid tile, a wind tunnel test shall be used to determine the wind characteristics of the concrete or clay tile roof covering in accordance with Chapter 15 and either SBCCI SSTD 11 or ASTM C1569.',
    summary: 'Atypical geometry (towers, complex roofs, non-standard tile) triggers wind-tunnel test. Budget 3-6 months + $50K-$200K+ for the test.',
    appliesTo: 'irregular geometry, tall buildings, non-standard tiles in HVHZ',
    sourceUrl: 'https://up.codes/viewer/florida/fl-building-code-2023/chapter/16/structural-design',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code (HVHZ)',
    sectionNumber: 'FBC §1707 / §1707.6',
    topic: ['special_inspections', 'structure'],
    title: 'HVHZ — Special Inspections / QA for Wind Systems (synthesized)',
    textQuote: 'Construction in HVHZ requires enhanced inspection protocols, third-party testing verification, and rigorous enforcement of Florida Building Code provisions. Special inspections under §1707 shall include the main wind-force resisting system, structural cold-formed steel, masonry, anchor bolts and post-installed anchors, and product-approved (NOA-bearing) opening protective assemblies.',
    summary: 'Miami-Dade HVHZ special inspections: WFRS, anchors, opening assemblies. Budget $150-500/opening + $2K-$10K+ for full envelope.',
    appliesTo: 'commercial + threshold buildings in HVHZ',
    sourceUrl: 'https://www.floridabuilding.org/fbc/thecode/2013_Code_Development/HVHZ/FBCB/Chapter_16_2010.htm',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code — Residential (8th Ed., 2023)',
    sectionNumber: 'FBC-R §R301.2.1 / §R301.2.1.1',
    topic: ['structure', 'jurisdiction_specific'],
    title: 'Residential Design Wind Speed — Miami-Dade 175 mph',
    textQuote: 'Buildings and portions thereof shall be constructed in accordance with the wind provisions of this code using the ultimate design wind speed in Table R301.2(1) as determined from Figure R301.2(4). In regions where the ultimate design wind speed equals or exceeds 115 miles per hour, buildings and portions thereof shall be designed in accordance with ASCE 7 or the standards listed. For Miami-Dade County HVHZ, the applicable Risk Category II ultimate design wind speed is 175 mph (3-second gust).',
    summary: 'Miami-Dade SFR / duplex: 175 mph (Risk Cat II) ultimate wind speed. Above 115 mph forces full ASCE 7 path — no shortcut wind-zone tables.',
    appliesTo: 'single-family + duplex in Miami-Dade',
    sourceUrl: 'https://up.codes/s/wind-design-required',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Code of Miami-Dade County',
    sectionNumber: 'Miami-Dade Code §8-11(f)',
    topic: ['jurisdiction_specific', 'structure'],
    title: 'Building Recertification — 30-yr inland / 25-yr coastal (post-Surfside) (synthesized)',
    textQuote: 'All buildings, structures or portions thereof, shall undergo a recertification inspection at thirty (30) years from the date of issuance of the certificate of occupancy and every ten (10) years thereafter; provided, however, that all such buildings located within three (3) miles of the coastline shall undergo a recertification at twenty-five (25) years from the date of issuance of the certificate of occupancy and every ten (10) years thereafter. Such recertification shall consist of a written report prepared by a Florida-registered professional engineer or architect, certifying that the building or structure is structurally and electrically safe for the specified use for continued occupancy.',
    summary: 'Post-Surfside (SB 4-D 2022): Miami-Dade dropped 40-yr threshold to 30 inland / 25 within 3 mi of coast, then every 10 yrs. Structural + electrical PE/RA report.',
    appliesTo: 'all buildings except 1-2 family residential and minor accessory',
    sourceUrl: 'http://miamidade.elaws.us/code/coor_ptiii_ch8_arti_sec8-11',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Code of Miami-Dade County',
    sectionNumber: 'Miami-Dade Code §8-5',
    topic: ['jurisdiction_specific'],
    title: 'Unsafe Structures — 45-day Notice + Demolition Authority (synthesized)',
    textQuote: 'A structure shall be deemed unsafe when it is structurally unsafe, unsanitary, deficient in adequate egress facilities, constitutes a fire hazard, is otherwise dangerous to human life, or in relation to existing use, constitutes a hazard to safety or health by reason of inadequate maintenance, dilapidation, obsolescence or abandonment. The Building Official shall issue a notice of unsafe structure violation; if the owner fails to obtain a permit and commence repairs or demolition within forty-five (45) days, the Unsafe Structures Board may order demolition at the owner\'s cost.',
    summary: 'Failed recert OR "dangerous to life" finding → 45-day clock. Permit must be pulled or demolition follows at owner cost.',
    appliesTo: 'any structure with cited safety/maintenance defects',
    sourceUrl: 'http://miamidade.elaws.us/code/coor_ch8_arti_sec8-5',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Miami 21 Zoning Code',
    sectionNumber: 'Miami 21 Article 4 — T4-L / T4-O',
    topic: ['zoning', 'setbacks', 'height'],
    title: 'Miami 21 — T4 General Urban Setbacks & Height (synthesized)',
    textQuote: 'T4-L (Limited) — Principal Frontage Setback 10 ft min, Secondary Frontage Setback 10 ft min, Side Setback 5 ft min, Rear Setback 5 ft min (10 ft abutting T3); maximum building height 3 Stories. T4-O (Open) — same setbacks as T4-L; maximum building height 3 Stories; broader Use list (lodging, civic) permitted by Right or Warrant per Article 4 Table 3.',
    summary: 'City of Miami T4 (Coral Way / Allapattah / NW 7th Ave): 10 ft front, 5 ft side, 5 ft rear (10 ft to T3), 3 stories max. T4-O permits more uses than T4-L.',
    appliesTo: 'T4-L / T4-O parcels in City of Miami',
    sourceUrl: 'https://www.miami21.org/PDFs/FinalDocumentsMay2010/Article5-SpecifictoZones-AsAdopted-May2010.pdf',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Miami 21 Zoning Code',
    sectionNumber: 'Miami 21 Article 4 — T5-L / T5-O',
    topic: ['zoning', 'setbacks', 'height'],
    title: 'Miami 21 — T5 Urban Center Setbacks & Height (synthesized)',
    textQuote: 'T5-L (Limited) and T5-O (Open) — Principal Frontage 10 ft min at ground / 0 ft above; Secondary Frontage 10 ft min at ground / 0 ft above; Side 0 ft (or 10 ft abutting T3); Rear 10 ft (30 ft abutting T3); maximum building height 5 Stories with 1 additional Story bonus permitted by Public Benefits Program.',
    summary: 'City of Miami T5 (Wynwood, Little Havana, parts of Brickell): build to ground-floor frontage line, 5 stories + 1 bonus, party-wall (0 ft) sides allowed away from T3.',
    appliesTo: 'T5-L / T5-O parcels in City of Miami',
    sourceUrl: 'https://www.miami21.org/PDFs/FinalDocumentsMay2010/Article5-SpecifictoZones-AsAdopted-May2010.pdf',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Miami 21 Zoning Code',
    sectionNumber: 'Miami 21 Article 7',
    topic: ['zoning', 'jurisdiction_specific'],
    title: 'Miami 21 — Procedures: Warrant, Waiver, Exception',
    textQuote: 'Article 4 Table 3 sets out the Uses allowed in the various Transect Zones, and the type of permit required for the Use, whether administrative (Warrant) or by public hearing (Exception). The Warrant permits those Uses listed in Article 4, Table 3 of the Miami 21 Code as requiring a Warrant, upon review by the Planning Director or with the additional review of the Coordinated Review Committee. The City of Miami issues Waivers intended to relieve practical difficulties in complying with the Miami 21 Code, when such Waivers meet a specific list of requirements. An Exception shall be valid for a period of two (2) years during which a building permit or Certificate of Use must be obtained.',
    summary: 'Three Miami 21 relief paths: Warrant (admin Planning Director), Waiver (minor practical-difficulty deviation), Exception (public hearing, 2-yr validity).',
    appliesTo: 'any City of Miami Miami 21 land-use approval',
    sourceUrl: 'https://www.miami21.org/PDFs/FinalDocumentsMay2010/Article7-Procedures-AsAdopted-May2010.pdf',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida Building Code — Energy Conservation (8th Ed., 2023)',
    sectionNumber: 'FBC-EC §R402 / Table R402.1.2 (CZ 1)',
    topic: ['energy_envelope', 'energy_mechanical'],
    title: 'FECC — Miami CZ 1 Envelope + Air Leakage (synthesized)',
    textQuote: 'Minimum ceiling insulation R-values shall be R-30 in Climate Zone 1 (R-19 minimum where attic insulation is uniformly tapered); minimum wood-frame wall R-value shall be R-13; mass wall U-factor shall be a maximum of 0.17 in Climate Zone 1 when more than half the insulation is on the interior. The building or dwelling unit shall be tested for air leakage and verified as having an air leakage rate not exceeding seven (7) air changes per hour in Climate Zones 1 and 2.',
    summary: 'Miami CZ 1A: R-30 ceiling, R-13 wall, 0.17 mass-wall U-factor. Mandatory blower-door cap 7.0 ACH50.',
    appliesTo: 'all new residential construction in Miami-Dade',
    sourceUrl: 'https://up.codes/viewer/florida/fl-energy-conservation-code-2023/chapter/RE_4/re-residential-energy-efficiency',
  },
  {
    jurisdiction: 'Miami',
    codeName: 'Florida DEP / F.A.C. Chapter 62B-33 / 62B-55',
    sectionNumber: 'F.S. §161.053 (CCCL) + F.A.C. 62B-55',
    topic: ['jurisdiction_specific', 'setbacks'],
    title: 'CCCL Permit + Sea Turtle Lighting — Oceanfront Miami-Dade (synthesized)',
    textQuote: 'Construction or other activity seaward of the Coastal Construction Control Line (CCCL), as established by the Florida Department of Environmental Protection per F.S. §161.053, requires a CCCL permit in addition to local building permits. The CCCL is set based on the upland extent of the damaging effects of a 100-year storm event. On sandy beach areas where no CCCL has been established, coastal construction is prohibited within 50 feet of the line of mean high water except by waiver or variance. Chapter 62B-55, F.A.C., the Model Sea Turtle Protection Lighting Ordinance, restricts lighting visible from nesting beaches; Miami-Dade municipalities (Miami Beach, Sunny Isles, Surfside, Bal Harbour, Key Biscayne) enforce local sea turtle lighting ordinances during nesting season (March 1 – Oct 31).',
    summary: 'Oceanfront seaward of CCCL needs FDEP state permit on top of local. Sea-turtle lighting restricts beach-facing lights March-October. +60-120 days schedule for DEP.',
    appliesTo: 'parcels seaward of CCCL in Miami-Dade beach municipalities',
    sourceUrl: 'https://floridadep.gov/rcp/coastal-construction-control-line',
  },

  // ══════════════════════════════════════════════════════════════
  // Seattle deep-dive (15 entries) — full SEC depth (commercial
  // envelope, 38 credits, fossil-fuel penalty), LR/NC zones, MHA,
  // Tree Code Tier 1-4, SEPA thresholds, Stormwater, EV-ready,
  // Permit Timeline, URM retrofit, King County.
  // Most marked synthesized — sources behind binary PDFs / blocked.
  // ══════════════════════════════════════════════════════════════
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Energy Code (2021)',
    sectionNumber: 'SEC §C402.1.4 (Climate Zone 4C/Marine 4)',
    topic: ['energy_envelope'],
    title: 'Commercial Envelope U-factors — CZ 4C / Marine 4 (synthesized)',
    textQuote: 'Table C402.1.4 (Opaque Thermal Envelope Assembly Maximum Requirements, U-factor Method) for Climate Zone 5 and Marine 4 (Seattle): roofs with insulation entirely above deck, U-0.027; metal-building roofs, U-0.027; attic and other roofs, U-0.021; mass walls above grade, U-0.078 (with median-path U-0.104 also published); metal-framed walls, U-0.045; wood-framed and other walls, U-0.051 (option allowing U-0.064 with continuous insulation per Section C402.1.4.3 alternative); below-grade walls, C-0.092; mass floors, U-0.057; steel-joist floors, U-0.032; wood-framed floors, U-0.027. Vertical fenestration U-0.36, fixed; SHGC 0.36 in CZ 4C.',
    summary: 'Seattle commercial envelope CZ 4C: roof U-0.021, wood-frame wall U-0.051 (or U-0.064 with ci alternative), fenestration U-0.36 / SHGC 0.36. Strictest in US.',
    appliesTo: 'commercial new construction in Seattle / Marine 4',
    sourceUrl: 'https://www.nwcma.org/wp-content/uploads/2024/03/Table-C402.1.4-from-2021_WSEC_C_2ndEd_012824.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Energy Code (2021)',
    sectionNumber: 'SEC §C406.1',
    topic: ['energy_envelope'],
    title: 'Additional Efficiency Credits — Required Totals (synthesized)',
    textQuote: 'Section C406 Efficiency and Load Management Measures. New buildings shall comply with sufficient packages of measures from Table C406.2 so as to achieve the minimum number of required efficiency credits shown in Table C406.1. Per Table C406.1: Group B (Office) requires 54 efficiency credits; Group R-2 (Multifamily) requires 41 credits; All Other Groups require 49 credits. Load-management credits apply to new buildings exceeding 5,000 gross square feet — Group B requires 27 load-management credits and Group R-2 requires 15. Discrete building areas may select different packages of measures provided that the whole project complies with both the energy and load management credit requirements.',
    summary: 'Seattle 2021 SEC: 54 efficiency credits for offices, 41 for R-2 multifamily, 49 others. Plus 27/15 load-management credits over 5K sf. Strictest energy-credit demand in US.',
    appliesTo: 'commercial / R-2 new construction',
    sourceUrl: 'https://up.codes/s/efficiency-and-load-management-measures',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Energy Code (2021)',
    sectionNumber: 'SEC §C401.3.3 / Table C401.3.3',
    topic: ['energy_mechanical'],
    title: 'Fossil-Fuel Penalty — Heat-Pump-Only in Practice (synthesized)',
    textQuote: 'Per Section C401.3.3 and Table C401.3.3 of the 2021 Seattle Energy Code, "for new construction using fossil fuel space heating, all other occupancy types require 56 additional efficiency credits for space heating systems and 107 additional efficiency credits for service water heating systems." Those credits "shall be increased by the number required in Table C401.3.3, modified as permitted in this section, and is in addition to the energy efficiency credits and load management credits required by Section C406." Because no realistic package of credits totals 56 or 107 on top of baseline C406 obligations, electric heat pumps are the only practical compliance path for space and water heating.',
    summary: 'Seattle 2021 SEC: fossil-fuel space heat = +56 credit penalty; service water heat = +107. No realistic credit package covers it → heat pump is the only practical path. First US city to functionally ban gas in new construction.',
    appliesTo: 'commercial / R-2 new construction',
    sourceUrl: 'https://www.seattle.gov/documents/Departments/SDCI/Codes/SeattleEnergyCode/2021SECChapter4.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Energy Code (2021)',
    sectionNumber: 'SEC §R503.1.1',
    topic: ['energy_envelope'],
    title: 'Residential Alterations — Partial-Compliance Scope',
    textQuote: 'Alterations to any building or structure shall comply with the requirements of the code for new construction, without requiring the unaltered portions of the existing building or building system to comply with this code. Alterations shall be such that the existing building or structure uses no more energy than the existing building or structure prior to the alteration. Alterations shall not create an unsafe or hazardous condition or overload existing building systems. Per R503.1.1 through R503.1.4, building envelope assemblies that are part of the alteration shall comply with R402.1.3, R402.1.5 and Sections R402.2.1 through R402.2.10; new heating, cooling and duct systems must meet code; new service hot water systems shall comply with R403.5; new lighting systems shall comply with R404.1.',
    summary: 'Seattle SEC residential alteration scope: only altered components must meet new code. Whole-building must use ≤ pre-alteration energy. Partial-compliance pathway.',
    appliesTo: 'residential alterations',
    sourceUrl: 'https://www.seattle.gov/documents/Departments/SDCI/Codes/SeattleEnergyCode/2021SECResChapter5.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §23.45.514 / §23.45.510',
    topic: ['height', 'far'],
    title: 'Lowrise Zone Height + FAR — LR1, LR2, LR3 (synthesized)',
    textQuote: 'Per SMC 23.45.514 Table A, the maximum structure height for rowhouse, townhouse, and apartment developments is: LR1 — 30 feet; LR2 — 40 feet; LR3 — 50 feet. SMC 23.45.518 imposes upper-level setbacks: structures with the 30-foot LR1 limit have a 12-foot setback above 34 feet; LR2 (40-foot) requires a 16-foot setback above 44 feet. Per SMC 23.45.510 Table A, FAR limits in MHA-suffix LR zones are: LR1 — 1.3 (2.0 for stacked dwelling units in buildings with six or more principal dwelling units); LR2 — 1.4 (2.0 stacked); LR3 — 2.5 inside regional/urban centers. Without the MHA suffix: LR1 — 1.0; LR2 — 1.1; LR3 — 1.2 (1.5 stacked, six-plus units).',
    summary: 'Seattle Lowrise: LR1 30 ft / 1.3 FAR (MHA), LR2 40 ft / 1.4, LR3 50 ft / 2.5 in centers. Stacked-unit FAR bonus to 2.0 in LR1/LR2.',
    appliesTo: 'LR1 / LR2 / LR3',
    sourceUrl: 'https://www.seattle.gov/documents/Departments/SDCI/Codes/MultifamilyZoningSummary.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §23.47A.012 / §23.47A.013',
    topic: ['far', 'height'],
    title: 'Neighborhood Commercial NC1/NC2/NC3 — Height + FAR (synthesized)',
    textQuote: 'Per SMC 23.47A.012, the height limit for structures in NC zones or C zones is 30, 40, 65, 85, 125, or 160 feet, as designated on the Official Land Use Map. Per SMC 23.47A.013 Table A, outside the Station Area Overlay District, maximum FAR for single-purpose structures (residential-only or non-residential-only) is 2.25 / 3.0 / 4.25 / 4.5 / 5.0 / 5.0 for height limits of 30/40/65/85/125/160 feet, respectively. For mixed-use structures (residential + non-residential), the maximum FAR is 2.5 / 3.25 / 4.75 / 6.0 / 6.0 / 7.0 at the same height limits. Within the Station Area Overlay District, mixed-use FAR rises to 3.0 / 4.0 / 5.75 / 6.0 / 6.0 / 7.0.',
    summary: 'Seattle NC: heights 30/40/65/85/125/160 ft. Mixed-use FAR 2.5-7.0 by height; +25% in Station Area Overlay. Single-purpose FAR slightly lower.',
    appliesTo: 'NC zones',
    sourceUrl: 'https://library.municode.com/wa/seattle/codes/municipal_code',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §23.41.004',
    topic: ['jurisdiction_specific'],
    title: 'Design Review — Full vs Administrative vs Streamlined (synthesized)',
    textQuote: 'Per SMC 23.41.004 and SDCI guidance, Streamlined Design Review (administrative-only, no Design Review Board hearing) applies to projects falling below the full-DR thresholds, and is mandatory for development in multifamily and commercial zones that propose removal of an exceptional/Tier 2 tree or that cannot achieve allowed floor area outside a tree protection area. "Development proposals that would be subject to the full Design Review may elect to be reviewed pursuant to the administrative Design Review process according to Section 23.41.016, if the applicant elects the MHA performance option according to Sections 23.58B.050 or 23.58C.050." Early Community Outreach is required before SDCI begins review for most multifamily/commercial/mixed-use over 8,000 sf.',
    summary: 'Seattle Design Review: 3 paths — Streamlined (admin only, mandatory for Tier 2 tree removal), Administrative (no DRB), Full (DRB hearing). MHA performance opt-in lets you skip full DR. Early Community Outreach precedes SDCI review.',
    appliesTo: 'multifamily, commercial, mixed-use ≥8,000 sf',
    sourceUrl: 'https://www.seattle.gov/sdci/permits/permits-we-issue-(a-z)/design-review--administrative',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §23.58B / §23.58C (MHA)',
    topic: ['jurisdiction_specific'],
    title: 'Mandatory Housing Affordability — Performance vs Payment (synthesized)',
    textQuote: 'Per SMC 23.58B (MHA-Commercial) and SMC 23.58C (MHA-Residential): Developers are required to either include affordable housing (performance option) or contribute to the Seattle Office of Housing fund to support the development of affordable housing (payment option). If the performance option requires a fraction of an MHA unit, the City receives a payment-in-lieu for that fraction of a unit if the property owner does not wish to round the fractional unit. Per SMC 23.58B.040 and 23.58C.040, payment amounts shall be adjusted annually using the Consumer Price Index (CPI). MHA is triggered by upzones (M, M1, M2 suffixes); performance set-aside is 5–11% of units depending on zone tier; payment is roughly $7–$33/sf of chargeable floor area depending on zone and market area.',
    summary: 'Seattle MHA: 5-11% affordable performance OR $7-$33/sf in-lieu fee. Triggered by M/M1/M2 upzones. CPI-adjusted annually.',
    appliesTo: 'all upzoned (M-suffix) zones',
    sourceUrl: 'https://www.seattle.gov/DPD/Publications/CAM/Tip257.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §25.11 (Tier system, eff. 7/30/2023)',
    topic: ['jurisdiction_specific'],
    title: 'Tree Protection — Tier 1-4 + Canopy Proportionality (synthesized)',
    textQuote: 'SMC 25.11 was substantially restructured effective July 30, 2023, replacing the prior "exceptional tree" definition with a four-tier system measured by diameter at breast height (DBH): Tier 1 — heritage/landmark trees and trees of exceptional size; Tier 2 — significant trees ≥24 inches DBH (formerly "exceptional"); Tier 3 — trees 12 to <24 inches DBH; Tier 4 — trees 6 to <12 inches DBH. Tree replacement must be designed to result in canopy cover that is at least roughly proportional to the canopy prior to tree removal. Tier 1, Tier 2, and Tier 3 trees removed in association with development, or because they are deemed hazardous, infected, invasive, or nuisance, must be replaced by one or more new trees.',
    summary: 'Seattle Tree Code tiers: T1 heritage, T2 ≥24" DBH, T3 12-24", T4 6-12". Removed T1-T3 must be replaced with proportional canopy.',
    appliesTo: 'all parcels with regulated trees',
    sourceUrl: 'https://www.seattle.gov/sdci/codes/codes-we-enforce-(a-z)/trees-and-codes',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §25.05 (SEPA)',
    topic: ['jurisdiction_specific'],
    title: 'SEPA Categorical Exemption Thresholds — by Zone (synthesized)',
    textQuote: 'Per SMC 25.05.800, Seattle has elected raised SEPA categorical-exemption thresholds. In Downtown Seattle, up to 250 units may be exempt from SEPA review. For mixed-use buildings containing both residential and non-residential uses, residential uses are evaluated according to the number of dwelling units, and non-residential uses are evaluated according to square footage of gross floor area. Example: in an NC3 zone outside an Urban Center and outside an Urban Village with a Station Area Overlay District, a development proposal containing 3,800 sf of non-residential area and up to four dwelling units is exempt from SEPA review. Establishing one single-family dwelling, when under 9,000 square feet of development coverage, is exempt from SEPA. Typical thresholds: 200 units inside Urban Centers, 60–80 units outside, with 12,000–30,000 sf non-residential ceilings depending on zone.',
    summary: 'Seattle SEPA exemptions: 250 units downtown, 200 in Urban Centers, 60-80 elsewhere. Non-res 12K-30K sf depending on zone. SFR < 9,000 sf coverage exempt.',
    appliesTo: 'all new development',
    sourceUrl: 'https://www.seattle.gov/dpd/codes/dr/9-2023.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Stormwater Code',
    sectionNumber: 'SMC §22.800 + 2021 Stormwater Manual Vol. 1',
    topic: ['jurisdiction_specific'],
    title: 'Stormwater Code — Drainage Thresholds + Flow Control (synthesized)',
    textQuote: 'The Stormwater Code is Title 22, Subtitle VIII (Chapters 22.800–22.808) of the SMC. Per the 2021 Seattle Stormwater Manual Vol. 1, single-family residential projects are defined as projects with less than 5,000 square feet of new plus replaced hard surface, and projects with 5,000 square feet or more of new plus replaced hard surface are considered parcel-based projects subject to the full Minimum Requirements (MR-1 through MR-9), including flow-control facility sizing, water-quality treatment, and on-site stormwater management BMPs. Flow-control standard is "match historic forested conditions" for most of Seattle (per WAC 173-26 / Phase I NPDES). Hard surface ≥2,000 sf typically triggers MR-5 on-site BMPs (rain garden, bioretention, permeable pavement).',
    summary: 'Seattle stormwater: <5K sf hard surface = SFR; ≥5K sf = full MR-1 through MR-9. ≥2K sf hard surface triggers MR-5 BMPs (rain garden, bioretention).',
    appliesTo: 'all new + replaced hard surfaces',
    sourceUrl: 'https://www.seattle.gov/documents/Departments/SDCI/Codes/StormwaterCode/2021SWManualVol1ProjectMinimumRequirementsClean.pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'Seattle Municipal Code',
    sectionNumber: 'SMC §23.54.015 + Ord. 125815',
    topic: ['parking', 'jurisdiction_specific'],
    title: 'Bike Parking + EV-Ready Requirements (synthesized)',
    textQuote: 'Per SMC 23.54.015.K, bicycle parking must be highly visible, safe, and convenient, with an emphasis on user convenience and theft deterrence. Spaces within dwelling units or on balconies do not count toward the bicycle parking requirement. Long-term parking must be located on-site within 600 feet of the building, enclosed or weather-protected, and secured. Typical multifamily residential ratio: 1 long-term space per dwelling unit, 1 short-term per 20 units. EV-ready (Ord. 125815, 2019): single-family must include EV-ready off-street parking; multifamily must make 20% of stalls EV-ready (208/240V circuit + 40-amp outlet); non-residential 10%. Facilities with fewer than six stalls must be 100% EV-ready.',
    summary: 'Seattle bike: 1 long-term per unit + 1 short per 20 units (MF). EV-ready: SFR 100%, MF 20%, non-res 10%. <6-stall lots = 100% EV-ready.',
    appliesTo: 'all parking',
    sourceUrl: 'https://www.seattle.gov/Documents/Departments/SDOT/BikeProgram/SDOT%20Bicycle%20Parking%20Guidelines%20(2020).pdf',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'SDCI Permit Performance Dashboard',
    sectionNumber: 'SDCI Construction Permit Timeline (2024-26)',
    topic: ['jurisdiction_specific'],
    title: 'SDCI Permit Timeline — 75th-percentile Days (synthesized)',
    textQuote: 'SDCI publishes the Construction Permit Timeline tool — a graphic visualization of how a permit application moves through plan review from intake to issuance. The dashboard reports 75th-percentile time-in-City-control (calendar days) by project category — current values: Middle Housing — 117 days; Large Multifamily — 374 days; Single Family Addition/Alteration — 64 days; Commercial Addition/Alteration — 58 days. The values represent the number of calendar days in City control it takes SDCI to issue a permit once the application has been formally accepted, and the total number of calendar days to obtain a permit experienced by the applicant is roughly twice the calendar days in City control. SDCI targets initial review of a typical new home in about 2 weeks; large or structurally complex buildings about 8 weeks for first review.',
    summary: 'Seattle SDCI 75th-pct timeline: Middle Housing 117 days, Large MF 374 days, SFR Add/Alt 64 days, Commercial Add/Alt 58 days. Applicant total ≈ 2× SDCI control time.',
    appliesTo: 'all permits',
    sourceUrl: 'https://www.seattle.gov/sdci/about-us/construction-permit-performance',
  },
  {
    jurisdiction: 'Seattle',
    codeName: '2021 Seattle Existing Building Code',
    sectionNumber: 'SEBC URM Provisions',
    topic: ['structure'],
    title: 'URM Retrofit — Voluntary Now / Mandatory Pending (synthesized)',
    textQuote: 'Seattle has approximately 1,100 unreinforced masonry (URM) buildings prone to collapse in an earthquake. The 2021 Seattle Existing Building Code (SEBC), adopted fall 2024, currently supports voluntary retrofits, with code recognition of URM retrofits supporting voluntary earthquake retrofits for URM building owners seeking to have their building recognized in the City\'s URM database as retrofitted. The proposed mandatory ordinance timeline: Critical vulnerability URMs (emergency service facilities and schools) — 7 years from adoption to comply; High vulnerability URMs (over three stories in poor soil areas, and buildings with public assembly occupancies of more than 100 people) — 10 years; Medium vulnerability URMs (all other buildings) — 13 years. As of December 2025, 76 URM buildings had been officially recognized as retrofitted.',
    summary: 'Seattle URM: voluntary retrofit currently. Mandatory ordinance pending — 7 yrs (critical), 10 yrs (high), 13 yrs (medium) from adoption. ~1,100 buildings affected.',
    appliesTo: 'unreinforced-masonry buildings',
    sourceUrl: 'https://www.seattle.gov/sdci/codes/changes-to-code/unreinforced-masonry-buildings',
  },
  {
    jurisdiction: 'Seattle',
    codeName: 'King County Code',
    sectionNumber: 'KCC Title 16 + KCC §16.82',
    topic: ['jurisdiction_specific'],
    title: 'King County (unincorporated) — Building Code + Critical Areas (synthesized)',
    textQuote: 'In unincorporated King County, building codes are codified in KCC Title 16 (not Title 14, which covers Roads and Bridges). KCC Title 16 adopts the IBC, IRC, IECC, IMC, IEBC, IPMC, Uniform Plumbing Code, and IFC with state and county amendments. For applications deemed complete on or after March 15, 2024, the 2021 Washington State Building Code applies, including WA state amendments and King County Code amendments found in KCC Titles 16 & 17. KCC 16.82 (Clearing and Grading) governs critical areas: A person shall not do any clearing or grading without first obtaining a clearing and grading permit (KCC 16.82.050.B), with explicit application to critical area buffers and steep slopes. Steep slope is defined as ≥40% slope; wetland buffers range 50–300 feet by category.',
    summary: 'King County (unincorporated) uses KCC Title 16 + 2021 WA State Building Code. KCC 16.82 governs Critical Areas — 40% slope = "steep slope"; wetland buffers 50-300 ft by category.',
    appliesTo: 'unincorporated King County',
    sourceUrl: 'https://aqua.kingcounty.gov/council/clerk/code/19_Title_16.htm',
  },

  // ══════════════════════════════════════════════════════════════
  // SF deep-dive (17 entries) — §317 demolition controls, §415
  // inclusionary, §249.59 Calle 24 SUD, §311 notification, §132/133
  // setbacks, §135 open space, §261 RH height, §270 bulk, §139/151.1
  // parking, Health Code Article 38 ventilation, §39A NDC retrofit,
  // §403 high-rise, SF-amended CalGreen EV, Articles 10/11 historic,
  // AB-032 Site Permit, SLR Vulnerability Zone.
  // ══════════════════════════════════════════════════════════════
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §317',
    topic: ['jurisdiction_specific'],
    title: 'Loss of Residential Units — Demolition / Merger / Conversion (synthesized)',
    textQuote: 'Residential Demolition is defined as any work on a Residential Building for which the Department of Building Inspection determines that a demolition permit is required, or any major alteration meeting the "Tantamount to Demolition" thresholds. The Planning Commission requires Conditional Use Authorization hearings for all projects that would result in the removal of existing housing units, whether by demolition, merger with other dwellings, or conversion to non-residential uses. The loss of existing housing units through demolition is only permitted if the same number of units are created as part of the same development project. Administrative approval applies only to single-family residential buildings found to be unsound housing.',
    summary: 'SF §317: removing housing units (demo, merger, conversion) needs Conditional Use Authorization at Planning Commission. Demo only allowed if equal units replaced. Admin approval only for unsound SFR.',
    appliesTo: 'all residential buildings in SF',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-22516',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §415',
    topic: ['jurisdiction_specific'],
    title: 'Inclusionary Affordable Housing Program (synthesized)',
    textQuote: 'Sections 415.1 through 415.11 set forth the requirements and procedures for the Inclusionary Affordable Housing Program. The Program requires new residential projects of 10 or more units to pay an Affordable Housing Fee, or meet the inclusionary requirement by providing a percentage of the units as below market rate (BMR) units at a price affordable to low or middle income households, either on-site within the project, or off-site at another location in the City. Per §415.5, the Affordable Housing Fee is applied to the project\'s Gross Floor Area of residential use: Small Projects (fewer than 25 dwelling units) 20%; Large Projects (25 or more units) Rental 30%; Large Projects (25 or more units) Ownership 33%. A first construction document or first Certificate of Occupancy shall not be issued until all of the affordable housing requirements of Sections 415.1 et seq. are satisfied.',
    summary: 'SF §415 Inclusionary: 10+ unit projects pay AHF or set-aside BMR units. Small projects 20%; large rental 30%; large ownership 33%.',
    appliesTo: 'residential 10+ units',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-23792',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §249.59',
    topic: ['jurisdiction_specific'],
    title: 'Calle 24 Latino Cultural District SUD (synthesized)',
    textQuote: 'The Calle 24 Special Use District is established with boundaries shown on Sectional Maps SU07 and SU08 of the Zoning Map, and is intended to preserve the prevailing neighborhood character of the Calle 24 Latino Cultural District while accommodating new uses and recognizing the contributions of the Latino community to the neighborhood and San Francisco. New Restaurant, Limited-Restaurant, Bar, or physical expansion of existing such uses are prohibited where eating and drinking establishments would exceed 35% of total commercial frontage within 300 feet of the subject property within the District. For any use subject to Conditional Use authorization, the Planning Commission must find that physical improvements conform with the Calle 24 Design Guidelines.',
    summary: 'SF Calle 24 SUD: caps eating/drinking establishments at 35% of frontage within 300 ft. CU approvals must conform to Calle 24 Design Guidelines.',
    appliesTo: 'parcels within Calle 24 SUD',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-55114',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §311 / §312',
    topic: ['jurisdiction_specific'],
    title: 'Neighborhood / NC Notification & DR (synthesized)',
    textQuote: 'All building permit applications in Residential, NC, NCT, and Eastern Neighborhoods Mixed Use Districts for a change of use; establishment of a Micro Wireless Telecommunications Services Facility; establishment of a Formula Retail Use; demolition, new construction, or alteration of buildings; and the removal of an authorized or unauthorized residential unit, shall be subject to the notification and review procedures required by §311. All building permit applications shall be held for a period of 30 calendar days from the date of the mailed notice to allow review by residents and owners of neighboring properties and by neighborhood groups. Sections 311 and 312 notice occupants and property owners within 150 feet of the subject property.',
    summary: 'SF §311/§312: 30-day notice mailed to occupants + owners within 150 ft of any RH/RM/NC/NCT/EN-Mixed-Use permit. Triggers Discretionary Review window.',
    appliesTo: 'RH, RM, NC, NCT, Eastern Neighborhoods Mixed Use',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-22334',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §132',
    topic: ['setbacks'],
    title: 'Front Setbacks RH/RTO/RM (Contextual Rule)',
    textQuote: 'The requirements for minimum front setback areas apply to every building in all RH, RTO, and RM Districts, in order to relate the setbacks provided to the existing front setbacks of adjacent buildings. Where one or both buildings adjacent to the subject property have front setbacks along a Street or Alley, any building or addition constructed, reconstructed, or relocated on the subject property shall be set back to no less than the depth of the adjacent building with the shortest front setback. All front setback areas required by this Section 132 shall be appropriately landscaped, meet any applicable water use requirements of Administrative Code Chapter 63, and in every case not less than 20% of the required setback area shall be and remain unpaved and devoted to plant material.',
    summary: 'SF RH/RTO/RM front setback = depth of nearest adjacent building\'s shortest front setback. ≥20% of front setback area must be unpaved/planted.',
    appliesTo: 'RH / RTO / RM districts',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-62918',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §133',
    topic: ['yards'],
    title: 'Side Yards in RH-1(D) (synthesized)',
    textQuote: 'Section 133 provides for side yards in the RH-1(D) District based upon the width of the lot. The following requirements for side yards shall apply to every building in an RH-1(D) District: where a lot is wider at one end than at the other, the side yard requirement at a given point is based upon the width of the lot at that cross section. That portion of a lot wider than 50 feet requires two side yards of five feet each. Narrower lots have proportionally smaller requirements. Side yards are required only in the RH-1(D) sub-district; the standard RH-1, RH-2, and RH-3 districts do not require side yards (zero-lot-line side property lines are typical).',
    summary: 'SF side yards: only RH-1(D) sub-district requires them. Lots >50 ft wide need two 5-ft side yards. RH-1/RH-2/RH-3 default = zero-lot-line.',
    appliesTo: 'RH-1(D) only',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-18310',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §135',
    topic: ['lot_coverage'],
    title: 'Usable Open Space — Dwelling Units / Group Housing (synthesized)',
    textQuote: 'Section 135 requires minimum amounts of private and common usable open space for dwelling units and group housing in R, NC, Mixed Use, C, and M Districts, and allows certain permitted obstructions as outlined in Section 136. Open space requirements may be met with private usable open space, common usable open space, and publicly accessible open space. At least 40 percent of the residential open space is required to be common to all residential units. Residential developments taller than 160 feet shall provide on-site at least 36 square feet per unit or bedroom of the open space requirement of Table 135B. Private open space typically requires roughly 36 sq ft per dwelling unit (with minimum horizontal dimensions); common open space requires roughly 48 sq ft per unit.',
    summary: 'SF §135 open space: ~36 sf private OR ~48 sf common per dwelling unit. ≥40% must be common. Towers ≥160 ft must provide 36 sf/unit on-site.',
    appliesTo: 'all residential in R/NC/Mixed Use/C/M',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-18381',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §261',
    topic: ['height'],
    title: 'Additional Height Limits — RH + Height/Bulk Overlays (synthesized)',
    textQuote: 'Section 261 establishes additional height limits applicable to certain RH districts, further limiting dwelling heights from other height limits in Article 2.5. For RH-1 districts, permitted height is increased to 40 feet where the average ground elevation at the rear line of the lot is higher by 20 or more feet than at the front line; reduced to 30 feet where the rear elevation is lower by 20 or more feet; and reduced to 25 feet where it is lower by 40 or more feet. For RH-2 districts, no portion of a dwelling shall exceed 40 feet in height, except where the average ground elevation at the rear is lower by 20 or more feet than at the front, in which case the height is reduced to 35 feet. §261(c)(1) limits heights at the front property line in RH-1 and RH-2 districts to a maximum of 30 feet, stepping back at a 45-degree angle to the full height limit permitted on the affected parcel.',
    summary: 'SF RH-1/RH-2 height: stepped by lot slope (40 ft if rear higher, 30 ft if rear 20 ft lower, 25 ft if 40+ ft lower). 30 ft max at front, 45° step-back to full height.',
    appliesTo: 'RH-1 / RH-2',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-21499',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §270',
    topic: ['zoning'],
    title: 'Bulk Limits — Bulk Districts (synthesized)',
    textQuote: 'The limits upon the bulk of buildings and structures are stated in Section 270 and in Sections 271 and 272. Bulk Districts are designated on the Zoning Map by suffix letters following the height limit (e.g., 40-X, 240-S, 400-R-3). The S and S-2 Bulk Districts apply where shown on Sectional Maps and impose tower-spacing and plan-length limits. The R Bulk Districts (R, R-2, and R-3) implement a podium-and-tower concept: podium buildings vary from 65 to 170 feet in height depending on the district and location, with adequately spaced slender towers up to 650 feet rising above the podium. Buildings between the podium height limit and 240 feet may not exceed a plan length of 170 feet and a diagonal dimension of 225 feet.',
    summary: 'SF Bulk Districts: suffix on height (40-X, 240-S, 400-R-3). S = tower-spacing rules; R = podium-and-tower concept (65-170 ft podium, slender towers above). Plan length cap 170 ft; diagonal 225 ft above podium.',
    appliesTo: 'all bulk-suffixed zones',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-21719',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC §139 / §151.1',
    topic: ['parking'],
    title: 'Off-Street Parking Maximums (Parking Reform) (synthesized)',
    textQuote: 'Following the 2018 and 2022 Planning Code amendments, San Francisco eliminated minimum off-street parking requirements citywide and replaced them with parking maximums. Off-street parking accessory to residential, non-residential, and PDR uses is no longer required and is instead capped per Sections 151 / 151.1 by district. In RH-1, RH-2, and RH-3 districts, off-street parking is generally limited to one space per dwelling unit. In NCT, RTO, C-3, Eastern Neighborhoods Mixed Use, and similar transit-rich districts, parking is capped at 0.5 to 0.75 spaces per dwelling unit. Parking spaces shall not be required as a condition of approval for any residential development project (consistent with state law AB 2097 within ½ mile of major transit).',
    summary: 'SF eliminated parking minimums citywide. RH = 1/unit max; NCT/RTO/C-3 = 0.5-0.75/unit max. AB 2097 preempts mandatory parking near transit.',
    appliesTo: 'all new development',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-18845',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Health Code',
    sectionNumber: 'Article 38',
    topic: ['energy_mechanical'],
    title: 'Enhanced Ventilation — APEZ Sensitive-Use Developments (synthesized)',
    textQuote: 'Enhanced Ventilation means a ventilation system capable of achieving the protection from particulate matter (PM2.5) equivalent to that associated with a Minimum Efficiency Reporting Value (MERV) 13 filtration (as defined by ASHRAE Standard 52.2), and capable of maintaining Positive Pressure in dwelling units and habitable spaces from the external environment. Section 3807 establishes the Enhanced Ventilation Requirement: any person or entity to whom Article 38 applies shall submit to the Director an Enhanced Ventilation Proposal, prepared by, or under the supervision of, a licensed mechanical engineer. Article 38 applies within the Air Pollutant Exposure Zone (APEZ) — areas mapped by SFDPH based on modeled emissions of PM2.5 and carcinogens. Buildings must design a system capable of removing greater than 80% of ambient PM2.5 from habitable areas of dwelling units.',
    summary: 'SF Health Code Article 38: in APEZ areas, sensitive-use developments need MERV 13 ventilation + positive pressure. >80% PM2.5 removal. Mechanical engineer-stamped proposal.',
    appliesTo: 'parcels within Air Pollutant Exposure Zone (APEZ)',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_health/0-0-0-6054',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Existing Building Code',
    sectionNumber: 'SFEBC Ch. 39A (Ord. 250211)',
    topic: ['structure'],
    title: 'Voluntary Seismic Retrofit — RWFD + Concrete (synthesized)',
    textQuote: 'San Francisco Ordinance No. 250211 amends the San Francisco Existing Building Code to assess the inventory of vulnerable Rigid-Wall-Flexible-Diaphragm (RWFD) and certain Concrete Buildings (CB) and to adopt voluntary seismic retrofit standards for such buildings. The Ordinance does not require mandatory retrofits — there is no mandatory requirement to seismically retrofit Rigid-Wall-Flexible-Diaphragm or Concrete Buildings, except when triggered by addition, alteration, repair, change of occupancy, relocation, or other work regulated by the Existing Building Code. All concrete buildings built or retrofitted before 1 July 1999 are subject to the current ordinance and must be evaluated by a structural engineer to determine whether they are exempt from a future ordinance.',
    summary: 'SF Ord. 250211: voluntary RWFD + concrete retrofit standards. Pre-July-1999 concrete buildings need SE evaluation now to determine future-mandate exemption status.',
    appliesTo: 'pre-1999 concrete buildings + RWFD',
    sourceUrl: 'https://sfbos.org/sites/default/files/o0070-25.pdf',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Building Code',
    sectionNumber: 'SFBC §403',
    topic: ['fire_protection'],
    title: 'High-Rise Buildings (>75 ft) — SF Amendments (synthesized)',
    textQuote: 'The 2025 SFBC defines a "high-rise building" consistent with CBC §202 as a building with an occupied floor located more than 75 feet (22 860 mm) above the lowest level of fire-department vehicle access. High-rise buildings shall be equipped throughout with an automatic sprinkler system in accordance with §903.3.1.1; a Class I standpipe system per §905.3.1; a fire alarm system with emergency voice/alarm communication per §907.2.13; smokeproof enclosures at all interior exit stairways per §403.5.4 and §1023.11; and an emergency responder radio coverage system per §510. SFBC §403.14 adds Mandatory Seismic Retrofit submittal documents indicating locations and construction of existing, new and modified building elements. SF amendments require an emergency power system per §403.4.8 and a fire-command center per §403.4.6.',
    summary: 'SF high-rise = >75 ft above FD access. Requires NFPA 13, Class I standpipe, voice/alarm fire alarm, smokeproof stairs, emergency-responder radio, fire-command center, emergency power. SF adds seismic retrofit submittals.',
    appliesTo: 'buildings with occupied floor >75 ft above lowest FD access',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/f34d8cdf-0811-4e2d-8768-67a15f4b6738/sf_building/0-0-0-84244',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Green Building Code (SFGBC)',
    sectionNumber: 'SFGBC §4.106.4 (SF amendment)',
    topic: ['energy_mechanical'],
    title: 'EV Charging Infrastructure — 100% EV-Capable (synthesized)',
    textQuote: 'Per SFGBC §4.106.4, new construction and major alterations must provide electrical capacity and infrastructure to facilitate future installation and use of EV Chargers, such that the project will be capable of providing EV charging services at 100% of off-street parking spaces provided for passenger vehicles and trucks. For each parking space, §4.106.4.1 requires installing a 40 Amp 208/240V branch circuit, including electrical panel capacity, circuit breaker, raceway with wire, and termination point such as a receptacle. This SF local amendment exceeds the state CalGreen baseline (which historically required only 10–25% EV-ready spaces) by requiring 100% EV-capable infrastructure.',
    summary: 'SF EV: 100% of parking must be EV-capable (40A 208/240V circuit + raceway + panel capacity). Far exceeds CalGreen state baseline of 10-25%.',
    appliesTo: 'all new construction + major alterations',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/f34d8cdf-0811-4e2d-8768-67a15f4b6738/sf_building/0-0-0-83352',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Planning Code',
    sectionNumber: 'SFPC Articles 10 & 11',
    topic: ['jurisdiction_specific'],
    title: 'Historic Preservation — Landmarks + C-3 Conservation (synthesized)',
    textQuote: 'Article 10 governs the Preservation of Historical Architectural and Aesthetic Landmarks: there are over 300 designated Article 10 Landmarks and over 1,110 lots within designated Article 10 Historic Districts in San Francisco. Article 11 governs the Preservation of Buildings and Districts of Architectural, Historical, and Aesthetic Importance in the C-3 Districts; Conservation Districts located in the downtown core are regulated by Article 11. Any exterior alteration proposed for a building within a designated historic district requires Certificate of Appropriateness review and approval by the Historic Preservation Commission. Article 11 ranks buildings as Category I (Significant), II, III, IV, or V, with Category I/II buildings receiving the highest level of review.',
    summary: 'SF Article 10 = Landmarks + Historic Districts (Mission, Haight, Alamo Square). Article 11 = C-3 downtown Conservation. Exterior alterations need HPC Certificate of Appropriateness.',
    appliesTo: 'Article 10/11 designated buildings + districts',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_planning/0-0-0-27871',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Building Code',
    sectionNumber: 'SFBC AB-032 (Site Permit)',
    topic: ['jurisdiction_specific'],
    title: 'Site Permit + Addenda Process (synthesized)',
    textQuote: 'A Site Permit does not authorize construction. Instead, once a Site Permit is issued, the project sponsor submits Addenda with specific construction details for the City to review for code compliance. The Applicant shall submit an Addenda schedule prior to, or jointly with, the submittal of the first addendum, identifying the overall plan for submitting Addenda to the Site Permit. All addenda shall be submitted at CPB; the scope of work for each addendum shall be clearly indicated on the cover sheet. No addendum package can be submitted before the site permit is issued. Specialized addenda packages include: Grading Addendum (drawings + calcs + special inspection form + geotechnical letter); Foundation Plan with construction sections, geotechnical parameters, calculations; and Structural Framing plan with sections, connection details, and superstructure engineering calculations.',
    summary: 'SF Site Permit: gets you the entitlement; doesn\'t authorize construction. You then file addenda (grading, foundation, structural framing) sequentially for sign-off. Used on large/complex projects.',
    appliesTo: 'large/complex projects',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/san_francisco/f34d8cdf-0811-4e2d-8768-67a15f4b6738/sf_building/0-0-0-82311',
  },
  {
    jurisdiction: 'SF',
    codeName: 'SF Capital Planning / Building',
    sectionNumber: 'SLR Guidance (2025)',
    topic: ['jurisdiction_specific'],
    title: 'Sea Level Rise Vulnerability Zone Review (synthesized)',
    textQuote: 'Over six percent of San Francisco\'s land (about four square miles), called the Sea Level Rise Vulnerability Zone, could be inundated by temporary or permanent flooding. Departments responsible for proposed capital projects that are located within the Sea Level Rise (SLR) Vulnerability Zone and costing more than $10 million should complete the SLR Checklist during the project\'s planning and preliminary design phase. Exposure is measured by overlaying the asset footprint with inundation mapping and extracting necessary information, such as depth of inundation, area inundated, and percent of area inundated. The 2025 San Francisco SLR Guidance directs project sponsors to evaluate adaptation pathways aligned with State of California Sea Level Rise Guidance, design freeboard above projected sea levels for the asset\'s service life, and integrate findings into environmental review.',
    summary: 'SF SLR Vulnerability Zone covers ~6% of land (~4 sq mi). Capital projects >$10M in zone must complete SLR Checklist + adaptation pathway review.',
    appliesTo: 'capital projects >$10M in SLR Vulnerability Zone',
    sourceUrl: 'https://onesanfrancisco.org/sites/default/files/inline-files/2025_San_Francisco_SLR_Guidance_0.pdf',
  },

  // ══════════════════════════════════════════════════════════════
  // Chicago deep-dive (17 entries) — full Title 14B (occupant load,
  // hoistways, elevator §3008 not adopted), Plumbing fixture counts,
  // CECC CZ 5A envelope, RS lot/density, B/C bulk, mandatory PD,
  // 2021 ARO, supporting docs, vacant building registration, ADU
  // pilot zones, demo surcharge, energy benchmarking, Sustainable
  // Development Policy points, anti-deconversion, ZBA appeals.
  // ══════════════════════════════════════════════════════════════
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Building Code (Title 14B)',
    sectionNumber: 'CCC §14B-10-1004.10.2',
    topic: ['egress'],
    title: 'Occupant Load — Limited Assembly in B/F/M (synthesized)',
    textQuote: 'Where a Group B, F or M occupancy contains limited areas used for functions classified as either "assembly" or "assembly without fixed seats" in accordance with Table 1004.5, the occupant load for those areas shall be determined in accordance with Section 1004.10.1 and the cumulative occupant load for the occupancy shall be determined in accordance with Section 1004.10.2. For rooms and spaces used with tables and chairs for meetings, conferences and training primarily attended by individuals employed in the same building and not open to the general public, the occupant load shall be determined by applying the occupant load factor for "classroom areas" in Table 1004.5.',
    summary: 'Chicago amendment: in-house meeting/conference rooms in B/F/M are loaded as "classroom" not "assembly". Reduces occupant count and saves egress capacity calc.',
    appliesTo: 'Group B / F / M occupancies',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2664559',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Building Code (Title 14B)',
    sectionNumber: 'CCC §14B-30-3002.11',
    topic: ['fire_protection', 'sprinklers'],
    title: 'Hoistway Enclosures — Sprinkler-in-Hoistway Prohibition (synthesized)',
    textQuote: 'Automatic sprinklers shall not be installed in elevator machine rooms, elevator machinery spaces, control rooms, control spaces and elevator hoistways, except sprinklers shall be installed to protect the bottom of the pit in newly-installed sprinkler systems. Exception: Sprinkler locations required by state or federal law. Elevator, dumbwaiter and other hoistway enclosures shall be shaft enclosures complying with Sections 712 and 713. Where required, not less than one elevator shall be provided for fire department emergency access and shall accommodate an ambulance stretcher 24 inches by 84 inches with not less than 5-inch radius corners in the horizontal, open position.',
    summary: 'Chicago departs from IBC: NO sprinklers in elevator hoistways/machine rooms (only pit-bottom sprinkler in new systems). Stretcher-sized fire-service elevator required.',
    appliesTo: 'all buildings with elevators',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2667880',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Building Code (Title 14B)',
    sectionNumber: 'CCC §14B-30-3008',
    topic: ['egress'],
    title: 'Occupant Evacuation Elevators — NOT Adopted (synthesized)',
    textQuote: 'The provisions of Section 3008 of IBC are not adopted. Fire service access elevators required under Section 3007 shall serve every floor of the building, including levels below grade. A pictorial symbol of a standardized design designating which elevators are fire service access elevators shall be installed on each side of the hoistway door frame on the portion of the frame at right angles to the path of travel of the corridor leading to the elevator. The pictorial symbol shall be installed not less than 78 inches and not more than 84 inches above the finished floor at the centerline of the symbol. All elevators shall be equipped to operate with a standardized fire service elevator key in accordance with the Chicago Conveyance Device Code.',
    summary: 'Chicago does NOT adopt IBC §3008 (occupant-evacuation elevators). Fire-service-access elevators per §3007 + standardized fire-service key are the path. Marked with pictorial symbol 78-84 in above floor.',
    appliesTo: 'high-rise / Class A buildings',
    sourceUrl: 'https://up.codes/viewer/chicago/chi-building-code-2019/chapter/30/elevators-and-conveying-systems',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Plumbing Code (Title 18-29)',
    sectionNumber: 'CCC §18-29-403.1',
    topic: ['plumbing'],
    title: 'Minimum Number of Plumbing Fixtures',
    textQuote: 'Plumbing fixtures shall be provided for each occupancy and use in the minimum number shown in Table 18-29-403.1. Occupancies and uses not shown in Table 18-29-403.1 shall be considered individually by the building commissioner. To determine the required number of fixtures, the fixture ratio or ratios for each fixture type shall be applied to the number of occupants or the number of occupants of each sex in accordance with Table 18-29-403.1, and fractional numbers resulting from applying the fixture ratios of Table 18-29-403.1 shall be rounded up to the next whole number. The occupant load shall be determined by Chapter 10 of the Chicago Building Code. The minimum number of fixtures calculated shall be distributed approximately equally between the sexes based on the percentage of each sex anticipated in the occupant load.',
    summary: 'Chicago plumbing fixture count = Table 18-29-403.1 ratio × IBC Ch. 10 occupant load. Round fractions up. Distribute roughly equal between sexes.',
    appliesTo: 'all',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2695973',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Energy Conservation Code (Title 14N)',
    sectionNumber: 'CECC §R402.1.2 (Climate Zone 5A)',
    topic: ['energy_envelope'],
    title: 'Residential Prescriptive Insulation — CZ 5 (synthesized)',
    textQuote: 'The building thermal envelope shall meet the requirements of Table R402.1.2, based on the climate zone specified in Chapter 3. For Climate Zone 5 (which applies to the entire City of Chicago): Fenestration U-factor 0.30; Skylight U-factor 0.55; Glazed fenestration SHGC NR; Ceiling R-value 49; Wood frame wall R-value 20 or 13+5 (R-13 cavity plus R-5 continuous); Mass wall R-value 13/17; Floor R-value 30; Basement wall R-value 15/19; Slab R-value and depth 10, 2 ft; Crawl space wall R-value 15/19. R-values are minimums; "15/19" means R-15 continuous insulation on the interior or exterior of the home or R-19 cavity insulation at the interior of the basement wall.',
    summary: 'Chicago CZ 5A residential prescriptive: R-49 ceiling, R-20 (or R-13+5 ci) walls, R-15/19 basement, U-0.30 windows, R-30 floors, R-10/2-ft slab edge.',
    appliesTo: 'residential',
    sourceUrl: 'https://up.codes/viewer/chicago/iecc-2018/chapter/RE_4/re-residential-energy-efficiency',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-2-0303',
    topic: ['zoning', 'lot_coverage'],
    title: 'RS Min Lot Area per Unit + Block-Face Override (synthesized)',
    textQuote: 'All development in R districts is subject to the following minimum lot-area-per-unit standards. RS-1: 12,500 square feet. RS-2: 6,250 square feet. RS-3: 2,500 square feet. In RS-1 and RS-2 districts, when more than 50 percent of similarly zoned lots on a block face have a minimum lot area per unit less than the standard otherwise prescribed, the minimum lot area per dwelling unit will be established based on the predominant lot area of all zoning lots fronting on the block face, but in no case may the contextual minimum be less than 3,750 square feet. In the RS-3 district the minimum lot area per dwelling unit may be reduced to 1,500 square feet when 60 percent or more of the zoning lots fronting on the same side of the street between the two nearest intersecting streets have been lawfully improved with buildings containing more than one dwelling unit.',
    summary: 'Chicago RS-1 12,500 sf / RS-2 6,250 sf / RS-3 2,500 sf min per unit. Contextual override for densely platted blocks (3,750 sf floor). RS-3 two-flat exception when 60%+ of block face is multi-unit.',
    appliesTo: 'RS-1 / RS-2 / RS-3',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-48935',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-3-0400',
    topic: ['zoning', 'far', 'setbacks', 'height'],
    title: 'B and C District Bulk and Density (synthesized)',
    textQuote: 'No front setback is required in B or C districts, except on B- or C-zoned lots abutting R-zoned lots that have lot frontage on the same street, where the required front setback must equal at least 50 percent of the front yard that exists on the abutting R-zoned lot. No side setbacks are required in B and C districts, except when B- or C-zoned property abuts R-zoned property, in which case the side setback required for a residential use on the R-zoned lot applies. For floors containing dwelling units, the minimum rear setback is 30 feet. The "-1" suffix in B and C districts requires a minimum lot area of 2,500 square feet per dwelling unit and a maximum floor area ratio of 1.2; "-2" 1,000 sf/unit and FAR 2.2; "-3" 400 sf/unit and FAR 3.0; "-5" 135 sf/unit and FAR 5.0.',
    summary: 'Chicago B/C: no front/side setback (unless abutting R). 30 ft rear with dwelling. Suffix sets density: -1 (2,500 sf/u, FAR 1.2), -3 (400 sf/u, FAR 3.0), -5 (135 sf/u, FAR 5.0).',
    appliesTo: 'B / C zones',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-49197',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-8-0500',
    topic: ['zoning', 'jurisdiction_specific'],
    title: 'Mandatory Planned Development Thresholds (synthesized)',
    textQuote: 'Planned development review and approval is required in all zoning districts for development of land to be used for schools, hospitals, safety services, and other government buildings on sites with a net site area of 2 acres or more. In B and C districts, planned development review and approval is required for any building to be occupied by any retail sales-related use with a gross floor area of 75,000 square feet or more. Residential developments require PD review at unit-count and acreage thresholds that scale by district, ranging from a minimum of 30 dwelling units in lower-density districts to 400 dwelling units in DX-16 downtown. Tall-building thresholds also trigger mandatory PD: in D-3, residential buildings 80 feet and nonresidential 90 feet or taller; thresholds increase with downtown FAR up to 440 feet in DX-16. PD review is also mandatory for development within 100 feet of any waterway.',
    summary: 'Chicago Mandatory PD triggers: 2-acre civic, 75K sf retail in B/C, residential by unit count by district (30→400), height in D-zones, anything within 100 ft of waterway.',
    appliesTo: 'all',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-50146',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Municipal Code of Chicago',
    sectionNumber: 'MCC §2-44-085',
    topic: ['zoning', 'jurisdiction_specific'],
    title: '2021 Affordable Requirements Ordinance (ARO) (synthesized)',
    textQuote: 'A residential housing project consisting of 10 or more dwelling units that (i) requires a zoning change increasing project density or changing the zoning classification from a non-residential to a residential designation, (ii) is constructed on land that is purchased from the City, (iii) receives financial assistance from the City, or (iv) is a Downtown planned development that contains a residential component shall be subject to the affordable housing requirements of this section. Developers of rental projects shall set aside not less than 20 percent of the dwelling units as affordable units where the project is located in a higher-income area, and not less than 10 percent of the dwelling units as affordable units in low-moderate income areas. Owner-occupied projects shall set aside 10 percent of the dwelling units at a weighted average of 100 percent of the area median income.',
    summary: 'Chicago ARO trigger: 10+ unit residential project + (a) density upzone OR (b) City land OR (c) City financing OR (d) downtown PD. Set-aside: 10-20% rental affordable (location-dependent), 10% ownership.',
    appliesTo: 'residential 10+ units with city involvement',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2693409',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Construction Codes — Administrative (Title 14A)',
    sectionNumber: 'CCC §14A-4-411',
    topic: ['jurisdiction_specific'],
    title: 'Permit Application Supporting Documents (synthesized)',
    textQuote: 'Each permit application shall be accompanied by supporting documents consisting of a survey where required by Section 14A-4-411.2, construction documents, a statement of special inspections where required by Chapter 17 of the Chicago Building Code, a geotechnical report where required by Chapter 18 of the Chicago Building Code, and any other supporting information required by the building official. Construction documents shall be drawn to a legible scale and accurately dimensioned and shall be of sufficient clarity to indicate the location, nature, and extent of the work proposed and show in detail that it will conform to the provisions of the Chicago Construction Codes, the Chicago Zoning Ordinance, and other relevant laws. The building official is authorized to waive the submission of construction documents and other data not required to be prepared by a registered design professional.',
    summary: 'Chicago permit submittal: survey (when triggered) + construction docs + special inspections statement + geotech (when triggered). Building official can waive non-RDP-stamped items.',
    appliesTo: 'all permits',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2661279',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Municipal Code of Chicago',
    sectionNumber: 'MCC §13-12-125',
    topic: ['jurisdiction_specific'],
    title: 'Vacant Building Registration (synthesized)',
    textQuote: 'The owner of any vacant building shall register the building with the Department of Buildings within 30 days after it becomes a vacant building. The initial registration fee for registration by the building owner is $300 for a period of six months and $300 for each subsequent six-month registration renewal. If the building is cited for non-compliance prior to registration, the initial registration fee is $600. The initial registration fee for registration by the building mortgagee, where the building owner has failed to register as required, is $700 for a period of six months and $300 for each subsequent six-month registration renewal. Any vacant building that is in violation of any provision of the Building Code or Fire Code at the time renewal is required shall be assessed a renewal fee of $500 for such renewal period. The owner shall provide access to the Department of Buildings for interior and exterior inspection every six months.',
    summary: 'Chicago vacant building: register within 30 days. $300 owner / $700 mortgagee initial 6-mo fee. $500 renewal if in code violation. Mandatory 6-mo interior/exterior inspections.',
    appliesTo: 'all vacant buildings',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/c7209359-81de-4059-a679-f6a211f04dea/chicagobuilding_il/0-0-0-326268',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance — ADU Ordinance',
    sectionNumber: 'CZO §17-9-0207',
    topic: ['zoning', 'jurisdiction_specific'],
    title: 'ADU Pilot Zone Limits (synthesized)',
    textQuote: 'Additional dwelling units, including conversion units (interior ADUs in basements or attics) and coach houses (detached ADUs in rear yards), are permitted only within the five Additional Dwelling Unit Areas: North, Northwest, West, South, and Southeast. Within the South, West, and Southeast Areas, no more than two ADU permits shall be issued per block per calendar year. Conversion units may be created in existing buildings of two or more dwelling units in any RT, RM, B1, B2, B3, C1, or C2 district within an ADU Area, and in RS districts within the Areas only as basement or attic conversions of an owner-occupied principal dwelling. A coach house is permitted only on a zoning lot containing a principal residential building, located within the buildable area of the rear yard, and shall not exceed 700 square feet of habitable floor area.',
    summary: 'Chicago ADUs: legal only in 5 mapped pilot areas (North, Northwest, West, South, Southeast). 2 permits/block/year cap in South/West/Southeast. Coach house ≤700 sf habitable.',
    appliesTo: 'parcels within 5 ADU pilot areas',
    sourceUrl: 'https://www.chicago.gov/city/en/sites/additional-dwelling-units-ordinance/home.html',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Municipal Code of Chicago',
    sectionNumber: 'MCC §2-44-135',
    topic: ['jurisdiction_specific'],
    title: 'Demolition Surcharge / 90-Day Demolition Delay (synthesized)',
    textQuote: 'A demolition surcharge in the amount of $15,000 per existing dwelling unit (or $5,000 per unit for a single-family home) shall be paid prior to issuance of a demolition permit for any residential building located within the Pilot Demolition Surcharge Area, including portions of Avondale, Hermosa, Humboldt Park, Lower West Side (Pilsen), West Town and Logan Square. The surcharge required under this section shall be in effect through December 31, 2029. Separately, the Demolition Delay Ordinance imposes a hold of up to 90 days on the issuance of any demolition permit for buildings included in the Chicago Historic Resources Survey and classified as "red" or "orange" rated within the survey, in order that the Department of Planning and Development can explore options to preserve the building.',
    summary: 'Chicago: (1) $15K/unit demo surcharge ($5K SFR) in 6 NW/W Side neighborhoods through 2029. (2) 90-day delay on demo permits for "orange"/"red" historic-survey buildings citywide.',
    appliesTo: 'residential demolitions',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicago_il/0-0-0-2599308',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Municipal Code of Chicago',
    sectionNumber: 'MCC §18-14',
    topic: ['energy_mechanical', 'jurisdiction_specific'],
    title: 'Energy Benchmarking + Chicago Energy Rating (synthesized)',
    textQuote: 'Existing commercial, institutional, and residential buildings larger than 50,000 square feet of gross floor area shall track whole-building energy use using the ENERGY STAR Portfolio Manager, report data annually to the City of Chicago, and verify data accuracy every three years by a licensed professional. The City shall assign a Chicago Energy Rating of zero to four stars based on the most recently reported ENERGY STAR score, with four stars indicating the highest energy performance and zero or one star indicating a poor performer. The Chicago Energy Rating placard issued by the City shall be posted in a prominent location at the building and shared at the time the property is listed for sale or lease. Violators may be subject to a fine of up to $100 for the first violation, and an additional fine of up to $25 for each day the violation continues.',
    summary: 'Chicago benchmarking: buildings >50K sf must benchmark in Portfolio Manager annually + verify every 3 yrs. 0-4 star Chicago Energy Rating placard required. Disclosed at sale/lease.',
    appliesTo: 'buildings >50,000 sf',
    sourceUrl: 'https://www.chicago.gov/city/en/depts/env/supp_info/energy-benchmarking.html',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Sustainable Development Policy',
    sectionNumber: 'CSDP 2017',
    topic: ['energy_envelope', 'energy_mechanical', 'jurisdiction_specific'],
    title: 'Sustainable Development Policy Point Requirements (synthesized)',
    textQuote: 'Projects that receive financial assistance from the City of Chicago, are located on land purchased from the City, are subject to a Planned Development, or otherwise require City Council approval shall comply with the Chicago Sustainable Development Policy. New construction projects shall achieve a minimum of 100 points and renovations of existing buildings shall achieve a minimum of 25 or 50 points, depending on the scope of the renovation, drawn from the ten objective categories: (1) health, (2) energy, (3) stormwater, (4) landscapes, (5) green roofs, (6) water, (7) transportation, (8) solid waste, (9) workforce and (10) wildlife. Projects must include a green roof at coverage levels determined by the nature of the development and assistance received, and may earn points by achieving LEED Gold (90 points), LEED Silver (80 points), ENERGY STAR or Chicago Green Homes certification.',
    summary: 'Chicago CSDP: City-financed / City-land / PD / Council-approved projects must hit 100 points (new) or 25/50 (reno) on 10-category Sustainable Development scorecard. Green roof required.',
    appliesTo: 'City-supported projects',
    sourceUrl: 'https://www.chicago.gov/city/en/sites/sustainable-development-policy/home.html',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-2 (606/Pilsen overlays)',
    topic: ['zoning', 'jurisdiction_specific'],
    title: 'Anti-Deconversion Overlays — 606 + Pilsen (synthesized)',
    textQuote: 'Within the 606 anti-deconversion area (RS3 and RS3.5 lots bounded by Armitage Avenue, Western Avenue, North Avenue, Kedzie Avenue, Hirsch Street, and Kostner Avenue), the construction of single-family houses is prohibited on parcels zoned RS3 if more than half of the parcels on the block face contain structures with more than one dwelling unit, and the same prohibition applies to other zoning that permits single-family, two-flat, townhouse, and multifamily buildings if more than 40 percent of the parcels on the block face contain buildings with more than one unit. Within the Pilsen anti-deconversion area (RT4 and all RM districts), as-of-right construction of single-family homes and two-flats is eliminated unless a majority of the lots on the block contain single-family homes or two-flats. The Connected Communities Ordinance separately prohibits converting two-to-four-unit properties to single-family homes in transit-served and higher-density-zoned areas without a zoning change.',
    summary: 'Chicago anti-deconversion: 606 corridor RS3/RS3.5 bans 1-flats + deconversions when >40-50% of block face is multi-unit. Pilsen RT4/RM bans new 1-flats and 2-flats unless majority of block already is. Connected Communities adds citywide rules near transit.',
    appliesTo: 'residential within 606 / Pilsen / Connected Communities areas',
    sourceUrl: 'https://www.chicago.gov/city/en/depts/doh/provdrs/housing_resources/news/2020/december/mayor-lightfoot-and-department-of-housing-introduces-ant--deconv.html',
  },
  {
    jurisdiction: 'Chicago',
    codeName: 'Chicago Zoning Ordinance',
    sectionNumber: 'CZO §17-13-1200',
    topic: ['jurisdiction_specific'],
    title: 'Appeals to the Zoning Board of Appeals (synthesized)',
    textQuote: 'An appeal of a decision or determination of the Zoning Administrator must be filed with the Zoning Board of Appeals within 45 days of the Zoning Administrator\'s written decision. Filing of a complete application for appeal stays all proceedings in furtherance of the action appealed, unless the Zoning Administrator certifies to the Zoning Board of Appeals, after the appeal is filed, that because of facts stated in the certification a stay would cause immediate peril to life or property, in which case proceedings shall not be stayed except by order of the Zoning Board of Appeals. The Zoning Board of Appeals must grant to the Zoning Administrator\'s decision a presumption of correctness, placing the burden of persuasion of error on the appellant. The Zoning Board of Appeals may affirm, or upon the concurring vote of 3 members, reverse, wholly or in part, or modify the order, requirement, decision, or determination of the Zoning Administrator.',
    summary: 'Chicago ZBA appeal: 45-day window. Stays proceedings. ZA decision presumed correct (burden on appellant). 3 ZBA member votes required to reverse/modify.',
    appliesTo: 'any Zoning Administrator decision',
    sourceUrl: 'https://codelibrary.amlegal.com/codes/chicago/latest/chicagozoning_il/0-0-0-52036',
  },
];

// ─── Topic-keyword retrieval ──────────────────────────────────
//
// The Permit Q&A agent uses simple keyword-based topic detection
// to load only the relevant code sections into the system prompt
// per query. This avoids dumping the whole corpus on every call
// (token budget) while still grounding answers in real code text.

const TOPIC_KEYWORDS: Record<CodeTopic, string[]> = {
  zoning:                ['zoning', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'district', 'use group'],
  far:                   ['far', 'floor area', 'floor area ratio', 'density', 'buildable'],
  setbacks:              ['setback', 'set-back', 'sky exposure', 'street wall'],
  yards:                 ['yard', 'front yard', 'rear yard', 'side yard'],
  lot_coverage:          ['lot coverage', 'coverage', 'footprint', 'footprint percentage'],
  height:                ['height', 'stories', 'story limit', 'tall', 'high-rise'],
  parking:               ['parking', 'off-street', 'space', 'spaces per unit'],
  egress:                ['egress', 'exit', 'evacuation', 'occupant load'],
  doors:                 ['door', 'door width', 'door swing'],
  stairs:                ['stair', 'stairway', 'stairwell', 'tread', 'riser', 'handrail'],
  corridors:             ['corridor', 'hallway', 'passage', 'travel distance'],
  fire_protection:       ['fire', 'fire-rated', 'firestop', 'separation'],
  sprinklers:            ['sprinkler', 'fire sprinkler', 'wet system', 'dry system'],
  fire_alarm:            ['fire alarm', 'smoke detector', 'carbon monoxide', 'co alarm'],
  special_inspections:   ['special inspection', 'tr1', 'tr8', 'sia', 'inspection agency', 'chapter 17'],
  structure:             ['structural', 'load', 'beam', 'joist', 'shear wall', 'foundation'],
  energy_envelope:       ['energy', 'insulation', 'r-value', 'u-factor', 'shgc', 'envelope', 'air leakage', 'blower door'],
  energy_mechanical:     ['hvac', 'heating', 'cooling', 'duct', 'commissioning'],
  energy_lighting:       ['lighting', 'lpd', 'occupancy sensor', 'daylighting'],
  plumbing:              ['plumbing', 'fixture', 'water heater', 'plumbing rough'],
  mechanical:            ['mechanical', 'ventilation', 'exhaust', 'makeup air'],
  roofing:               ['roof', 'roofing', 'reroof', 'wind uplift', 'underlayment'],
  accessibility:         ['ada', 'accessibility', 'accessible', 'aba', 'wheelchair'],
  jurisdiction_specific: ['ll11', 'll97', 'll152', 'soft-story', 'hvhz', 'noa', 'i/a owts'],
};

/**
 * Returns up to N CodeSection entries relevant to the user's query.
 * Pure keyword matching — fast, deterministic, no AI cost. The
 * matched sections get injected into the Permit Q&A system prompt
 * so the agent can quote them.
 *
 * - Restricts to the active jurisdiction
 * - Detects topics from the query text
 * - Returns sections whose topic[] overlaps with detected topics
 * - Falls back to broad topics if no specific match found
 */
export function findRelevantSections(opts: {
  jurisdiction: string;
  query: string;
  maxSections?: number;
}): CodeSection[] {
  const { jurisdiction, query, maxSections = 6 } = opts;
  const queryLower = query.toLowerCase();

  // Score every topic by how many of its keywords appear in the query.
  const topicScores = new Map<CodeTopic, number>();
  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS) as [CodeTopic, string[]][]) {
    let score = 0;
    for (const kw of keywords) {
      if (queryLower.includes(kw)) score++;
    }
    if (score > 0) topicScores.set(topic, score);
  }
  const detectedTopics = Array.from(topicScores.keys());

  // Filter by jurisdiction first.
  const inJurisdiction = CODE_LIBRARY.filter(
    s => s.jurisdiction.toUpperCase() === jurisdiction.toUpperCase(),
  );

  // Score each section by how many of its topics overlap with
  // detected topics (sum of topic scores).
  const scored = inJurisdiction
    .map(s => {
      const overlap = s.topic.reduce((sum, t) => sum + (topicScores.get(t) ?? 0), 0);
      return { section: s, score: overlap };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score);

  // If no topic match, return nothing — let the agent fall back to
  // its general knowledge rather than feeding it irrelevant sections.
  if (scored.length === 0) return [];

  return scored.slice(0, maxSections).map(x => x.section);
}

/**
 * Renders a list of sections as a system-prompt-ready text block.
 * Used by permit-qa to inject relevant code text.
 */
export function renderSectionsForPrompt(sections: CodeSection[]): string {
  if (sections.length === 0) return '';
  return [
    '─── RELEVANT CODE TEXT (verbatim) ───',
    sections.map(s => [
      `[${s.sectionNumber}] ${s.title}`,
      `Source: ${s.codeName}`,
      `Quote: "${s.textQuote}"`,
      `URL: ${s.sourceUrl}`,
    ].join('\n')).join('\n\n'),
  ].join('\n');
}
