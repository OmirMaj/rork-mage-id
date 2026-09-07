// utils/codeJurisdiction.ts — which Authority Having Jurisdiction governs an
// address, and which code edition that authority has actually adopted. Pure:
// no React, no RN, no storage — scripts/validate-code-jurisdiction.ts drives it
// under bun.
//
// THE FIREWALL (brain-center directive, HONEST leg)
//   Every row below was read off the authority's OWN page in a working session
//   and carries the URL and the date it was checked. NOTHING here is written
//   from recall. That rule is the whole point: this repo already ships an
//   honest stub rather than a plausible guess (utils/automation/jurisdiction.ts
//   returns a null zoning district instead of inventing one), and a code
//   edition is a far more dangerous thing to invent than a zoning district —
//   a contractor who builds to the wrong edition fails inspection.
//
//   Concretely: recall said Denver was on the 2022 Denver Building and Fire
//   Code. Denver's own page says the 2025 code (2024 I-Codes) has been in
//   effect since the end of 2024. Recall was a full code cycle out of date.
//   That is why `checkedOn` exists and why the validator fails a stale row.
//
//   It has failed once already IN THIS FILE, which is why the firewall is
//   worded as a rule and not a hope: a row shipped "Dallas: NEC 2023" while
//   the very page it cited said "CHAPTER 56: 2020 National Electrical Code
//   with Dallas Amendments (effective June 13, 2022)". A real URL next to a
//   recalled edition is the most dangerous shape a row can take, because
//   every automated check passes. `bun run scripts/verify-code-sources.ts`
//   is the answer to that shape: it FETCHES each sourceUrl and looks for the
//   editions the row claims. Run it whenever you touch the table. And see
//   "SOURCES THIS ENVIRONMENT CANNOT OPEN", in the comment block that opens
//   the table, for the rows whose citations no script here can fetch.
//
//   READ THE REST OF THAT STORY BEFORE YOU DRAW THE WRONG MORAL FROM IT.
//   The Dallas row TODAY says NEC 2023 — the same string that was once the
//   fabrication. It is not a relapse: Dallas actually enacted the 2023 NEC as
//   Ordinance No. 33081, adopted 28 April 2025 and effective 23 May 2025, and
//   the row cites the executed ordinance with the City Secretary's proof of
//   publication bound into it. In between, a pass "corrected" the row to 2020
//   against the city's landing page, which had gone stale, and against an
//   unsigned working draft of the ordinance whose number was still blank. So
//   the row has now been wrong in BOTH directions, and neither error was
//   caught by the shape of the citation. The moral is not "2023 is the wrong
//   answer" — it is that an edition is only as good as the document it was
//   read off, and a department's summary page is not that document when an
//   ordinance exists. Prefer the enacted instrument; and a blank ordinance
//   number proves you are holding the draft, never that the law did not pass.
//
// AN ABSENT ROW IS A CORRECT ANSWER
//   resolveCodeJurisdiction returns { kind: 'unknown', reason } for anywhere
//   this table does not cover, and groundingFactsFor renders that as "no
//   adoption record — this is model recall, verify with the local building
//   department". That is a shippable answer. The table is deliberately SMALL
//   and cited; it is never padded for coverage.
//
// ONE RENDERER, SO THE CHIP AND THE PROMPT CANNOT DRIFT
//   groundingFactsFor is the ONLY place the facts are worded. It returns the
//   exact `promptBlock` that goes to the model AND the exact `chipLabel` the
//   UI shows, from the same resolved value. The estimate surface was bitten by
//   exactly this class of bug (AI-F4: the chip counted something the prompt
//   did not), which is why utils/groundingChip.ts centralises its wording the
//   same way — this module follows its shape on purpose.

// ─────────────────────────────────────────────────────────────────────
// Shapes
// ─────────────────────────────────────────────────────────────────────

/**
 * Model-code family. 'LOCAL' is for a jurisdiction that writes its own code
 * rather than amending a model code (New York City, and California's Title 24
 * as published by the state) — we say so instead of pretending a family.
 */
export type CodeFamily =
  | 'IBC' | 'IRC' | 'IECC' | 'IEBC' | 'IPC' | 'IMC' | 'IFC' | 'IFGC'
  | 'NEC' | 'LOCAL';

export interface AdoptedCode {
  family: CodeFamily;
  /** Edition exactly as the source states it — '2021', '8th Edition (2023)'. */
  edition: string;
  /** The code's own name when it is not simply "<family> <edition>". */
  name?: string;
  /**
   * The page that states THIS family's edition, when the row's own `sourceUrl`
   * does not.
   *
   * This exists because jurisdictions genuinely split their adoptions across
   * documents, and the single-URL row forced a choice between citing one
   * document and dropping every claim the other one carried. Washington adopts
   * the IBC in WAC 51-50-003, the IRC in WAC 51-51-003 and the NEC in a
   * different agency's rule entirely (WAC 296-46B-010); Minnesota adopts the
   * IRC in Rules 1309 and the NEC in Rules 1315. Before this field those rows
   * carried claims their cited page never made — the exact shape the firewall
   * above exists to stop.
   *
   * scripts/verify-code-sources.ts fetches this URL instead of the row's for
   * this one code, so every claim is checked against the page that actually
   * makes it.
   */
  sourceUrl?: string;
}

interface BaseEntry {
  /** The office's real name, as it calls itself. Not a generic "building dept". */
  authorityName: string;
  /** ONLY the families the cited page actually states. */
  codes: readonly AdoptedCode[];
  /** The page the row was read off. */
  sourceUrl: string;
  /** ISO date (YYYY-MM-DD) the row was verified against sourceUrl. */
  checkedOn: string;
  /** A real, load-bearing quirk — not colour. */
  notes?: string;
  /** Where `notes` was verified, when that is a different page. */
  noteSourceUrl?: string;
}

/** A state-level adoption. `state` is the two-letter USPS code. */
export interface StateAdoption extends BaseEntry {
  state: string;
  /** Display name of the state. */
  stateName: string;
}

/**
 * A city or county that writes its own code or amends the state's enough to
 * matter. `matchCity` / `matchCounty` are the names a contractor might type;
 * both are matched case- and punctuation-insensitively, and BOTH require
 * `state` to match, so a Springfield in one state never answers for another.
 */
export interface LocalAdoption extends BaseEntry {
  /** Display name — "New York City", "Miami-Dade County". */
  name: string;
  state: string;
  matchCity?: readonly string[];
  matchCounty?: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────
// THE TABLE. Every row carries the date it was verified against `sourceUrl`.
// Adding a row means FETCHING the authority's page — never recalling it.
//
// STILL DELIBERATELY ABSENT — do not "helpfully" fill these in from memory:
//   Texas         adopts the IRC/IBC "as they existed on May 1, 2012" as a
//                 statutory FLOOR for municipalities, with no state agency
//                 enforcing it and every large city on something later. A row
//                 saying "Texas: IBC 2012" would actively mislead. Houston,
//                 Austin, San Antonio and Dallas have their own verified rows;
//                 the rest of Texas correctly resolves to 'unknown'.
//   Illinois      sets a stringency floor ("current or most recent preceding
//                 edition"), never naming an edition. Nothing to cite.
//                 Chicago writes its own code and has a row.
//   Arizona       no statewide code; no state page affirmatively says so, only
//                 statutes delegating adoption to cities and counties. Phoenix
//                 has its own row.
//   Michigan      every michigan.gov/lara rules path returns 403 to an
//                 automated fetch. Search snippets describe a 2015-I-Code
//                 adoption; snippets are not a source.
//   MN's IBC      Minnesota Rules 1305 adopts "the International Building
//                 Code" and no DLI page reached this session names the
//                 edition. The MN row therefore claims IRC and NEC only.
//   NC's model    the North Carolina row names its own code edition (2018)
//     editions    because OSFM's current-codes page states that and nothing
//                 more; which ICC editions sit under it is unverified.
//   Austin's NEC  Austin's own page lists the 2023 NEC as current while also
//                 stating the 2026 NEC is "Effective September 1, 2026" — a
//                 date that has now passed. A self-contradicting page is not a
//                 source, so the Austin row claims no electrical edition.
//   Everywhere    Fort Worth, Atlanta, Charlotte, Nashville, Las Vegas,
//     else        Portland, Baltimore, Detroit, Minneapolis, New Orleans,
//                 San Diego, Sacramento, Indianapolis, Columbus, Jacksonville,
//                 Milwaukee, Albuquerque, Tucson and Kansas City have NOT been
//                 researched. They resolve to their state row where one exists
//                 and to 'unknown' otherwise, which is the correct answer
//                 until somebody reads their building department's page.
//
// SOURCES THIS ENVIRONMENT CANNOT OPEN — every one of these WAS read on
// 2026-09-07, out of band, and the receipt records how. What they have in
// common is that `bun run scripts/verify-code-sources.ts` will never fetch
// them from a script, so it reports them unreachable FOREVER. That is a
// property of the host, not a defect in the row: do not "fix" it by swapping
// in a worse citation that happens to be fetchable.
//   New York      dos.ny.gov sits behind a Cloudflare interstitial ("Just a
//     (state)     moment…") that returns 403 to curl and to every fetch tool,
//                 with or without a browser User-Agent, and does the same for
//                 its regulation PDFs — so no dos.ny.gov URL will ever verify
//                 from a script. It loads normally in a real browser, and it
//                 was read in one: the row's FAQ states both 2025 codes and
//                 the 2024-ICC basis in a single sentence, and 19 NYCRR
//                 1219.2(a)(1) and 1240.2(a) were read as well and say the
//                 same. This row is no longer "re-check me" — it is checked.
//   Massachusetts www.mass.gov 403s every automated request (a 14 kB block
//                 page, not an outage). The state row keeps citing the live
//                 BBRS handbook because that is the right page for a HUMAN to
//                 open; it was read through the Internet Archive's snapshot
//                 of that exact URL, which names all four families at 2021 in
//                 one sentence, and corroborated against the promulgated
//                 780 CMR chapter PDFs. Boston no longer depends on mass.gov
//                 at all — it now cites those 780 CMR PDFs directly, and
//                 sec.state.ma.us serves them to a script quite happily.
//   Dallas        dallascityhall.com serves an incomplete TLS chain (the
//                 Sectigo intermediate is missing), so bun, node and this
//                 repo's fetcher all correctly refuse it; macOS `curl` gets
//                 through only because it chases the missing intermediate via
//                 AIA. Both Dallas citations therefore go through the
//                 Internet Archive, and both captures were diffed against the
//                 live documents.
//   Large PDFs    Los Angeles cites a 44 MB ordinance and Austin a 34 MB one;
//                 the fetcher may time out on them. They parse fine when it
//                 does not.
//
//                 verify-code-sources.ts knows about all of this now: when a
//                 fetch fails and the committed receipt already holds a
//                 `confirmed` verdict for that exact claim, it reports the
//                 claim as receipted rather than counting it a failure. A
//                 MISMATCH is still a failure, always. The script is NOT in
//                 ship-check — it needs the network. Its run on 2026-09-07:
//                 79 editions read off the page by the script itself, 7
//                 carried by the receipt (the four Massachusetts claims, both
//                 New York ones, and the Dallas NEC ordinance), 0 MISMATCH,
//                 0 unconfirmed.
// ─────────────────────────────────────────────────────────────────────

export const STATE_ADOPTIONS: readonly StateAdoption[] = [
  {
    state: 'CA',
    stateName: 'California',
    authorityName: 'California Building Standards Commission',
    codes: [
      { family: 'LOCAL', edition: '2025', name: 'California Building Standards Code (Title 24), 2025 Triennial Edition' },
    ],
    notes: 'Title 24 is NOT simply "California\'s version of a model code", and it is not simply California\'s own writing either — the Commission describes it as a compilation of three kinds of standard, the first being "building standards that have been adopted by state agencies without change from building standards contained in national model codes", the rest being state amendments to those model codes and standards written by state agencies where no model code covers the subject. Cities then amend Title 24 on top of that. The 2025 edition took effect 1 January 2026.',
    sourceUrl: 'https://www.dgs.ca.gov/BSC/Codes',
    checkedOn: '2026-09-07',
  },
  {
    state: 'NY',
    stateName: 'New York',
    authorityName: 'New York State Department of State, Division of Building Standards and Codes',
    codes: [
      // Both claims are cited to the BINDING regulation rather than to the FAQ
      // that is the row's sourceUrl. The FAQ does state both, in one sentence,
      // which is why it stays as the row citation; 19 NYCRR is what makes them
      // law. Part 1219 has a stable landing URL that redirects to the current
      // file, so it will follow the next code cycle by itself. Part 1240 has
      // NO such landing URL (dos.ny.gov/19-nycrr-part-1240 is a 404), so its
      // citation is a dated file path and WILL rot at the next amendment —
      // when it does, re-find it from dos.ny.gov's laws-and-regulations page
      // rather than deleting the claim.
      { family: 'LOCAL', edition: '2025', name: '2025 Uniform Fire Prevention and Building Code of New York State (built on the 2024 I-Codes)', sourceUrl: 'https://dos.ny.gov/19-nycrr-part-1219' },
      { family: 'LOCAL', edition: '2025', name: '2025 Energy Conservation Construction Code of New York State', sourceUrl: 'https://dos.ny.gov/system/files/documents/2026/02/19-nycrr-part-1240.pdf' },
    ],
    notes: 'The 2025 Uniform Code replaced the 2020 edition on 31 December 2025. The state states its basis as the 2024 ICC books collectively and does not publish separate IBC/IRC/IECC edition years, so none are claimed here. NEW YORK CITY IS A PARTIAL, NOT A TOTAL, EXEMPTION: it writes its own Construction Codes in place of the Uniform Code, but the Energy Code is statewide and NYC enforces an approved, more-restrictive LOCAL version of it rather than being outside it. ONE LARGE PROVISION IS ON THE BOOKS BUT UNENFORCEABLE: the 2025 prohibition on fossil-fuel equipment and building systems in new buildings (19 NYCRR § 1240.6 and Subpart 1229-2) is suspended by court order and is neither effective nor enforceable — do not price a new build all-electric on the assumption that it applies.',
    sourceUrl: 'https://dos.ny.gov/division-building-standards-and-codes-frequently-asked-questions',
    checkedOn: '2026-09-07',
  },
  {
    state: 'PA',
    stateName: 'Pennsylvania',
    authorityName: 'Pennsylvania Department of Labor and Industry, Bureau of Occupational and Industrial Safety (Uniform Construction Code)',
    codes: [
      { family: 'IBC', edition: '2021' },
      { family: 'IRC', edition: '2021' },
      { family: 'IECC', edition: '2021' },
      { family: 'IEBC', edition: '2021' },
    ],
    notes: "Pennsylvania's Uniform Construction Code moved to the 2021 I-Codes on 1 January 2026. Verified against the binding regulation (34 Pa. Code § 403.21) because the department's own landing page still describes the superseded 2018 adoption. No NEC edition is claimed — the state reaches it through the adopted I-Codes rather than listing one.",
    sourceUrl: 'https://www.pacodeandbulletin.gov/Display/pacode?file=/secure/pacode/data/034/chapter403/s403.21.html',
    checkedOn: '2026-09-07',
  },
  {
    state: 'WA',
    stateName: 'Washington',
    authorityName: 'Washington State Building Code Council (SBCC)',
    codes: [
      { family: 'IBC', edition: '2021' },
      { family: 'IRC', edition: '2021', sourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=51-51-003' },
      // The SECTION text (WAC 51-11C-10100) only ever says "Washington State
      // Energy Code" — the words "International Energy Conservation Code"
      // appear in the CHAPTER heading, which is why this cites the chapter and
      // not a section inside it.
      { family: 'IECC', edition: '2021', name: '2021 Washington State Energy Code', sourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=51-11C' },
      { family: 'NEC', edition: '2023', sourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=296-46B-010' },
    ],
    notes: "Verified against the binding rule text (WAC 51-50-003 for the IBC, 51-51-003 for the IRC, chapter 51-11C for the energy code) because the SBCC's own landing page still presents the 2018 codes as current. Washington does not enforce the IECC directly — it writes the Washington State Energy Code as an adoption and amendment of the 2021 IECC, and the amendments are extensive, so price the envelope off the WSEC rather than the model code. THE ELECTRICAL CODE HAS A HARD EXPIRY: it is run separately by the Department of Labor & Industries (WAC 296-46B), and the same rule that adopts the 2023 NEC also states that on 31 December 2026 the 2026 NEC replaces it — this row is wrong the day after that date.",
    noteSourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=296-46B-010',
    sourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=51-50-003',
    checkedOn: '2026-09-07',
  },
  {
    state: 'FL',
    stateName: 'Florida',
    authorityName: 'Florida Building Commission',
    codes: [
      { family: 'LOCAL', edition: '8th Edition (2023)', name: 'Florida Building Code, 8th Edition (2023)' },
    ],
    notes: 'Statewide code — local jurisdictions enforce it rather than writing their own. Effective 31 December 2023.',
    sourceUrl: 'https://www.floridabuilding.org/c/default.aspx',
    checkedOn: '2026-09-07',
  },
  {
    state: 'MA',
    stateName: 'Massachusetts',
    authorityName: 'Massachusetts Board of Building Regulations and Standards (Office of Public Safety and Inspections)',
    codes: [
      { family: 'IBC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition' },
      { family: 'IRC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition' },
      { family: 'IEBC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition' },
      { family: 'IECC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition' },
    ],
    notes: 'The 10th Edition took effect 11 October 2024 and, after an extended concurrency period, became the only code in effect on 30 June 2025. It is structured on the 2021 IBC with Massachusetts amendments; the residential code is 780 CMR Chapter 51, which adopts the 2021 IRC. ENERGY IS THE TRAP: the 10th Edition is only the BASE energy code, and the Department of Energy Resources publishes stretch and specialized stretch codes (225 CMR 22.00 and 23.00) that individual municipalities adopt on top of it — ask the city or town which of the three applies before you price the envelope.',
    noteSourceUrl: 'https://www.mass.gov/info-details/dates-and-editions-of-massachusetts-building-code-780-cmr',
    sourceUrl: 'https://www.mass.gov/handbook/tenth-edition-of-the-ma-state-building-code-780',
    checkedOn: '2026-09-07',
  },
  {
    state: 'VA',
    stateName: 'Virginia',
    authorityName: 'Virginia Department of Housing and Community Development (Virginia Uniform Statewide Building Code)',
    codes: [
      { family: 'IBC', edition: '2021', name: '2021 Virginia Uniform Statewide Building Code', sourceUrl: 'https://law.lis.virginia.gov/admincode/title13/agency5/chapter63/section10/' },
      { family: 'NEC', edition: '2020' },
    ],
    notes: 'Virginia adopted the 2021 USBC effective 18 January 2024; 13VAC5-63-10 incorporates chapters 2-35 of the 2021 International Building Code by reference. The electrical edition is a cycle behind — the 2020 National Electrical Code — so do not assume the two move together. NO IRC EDITION IS CLAIMED: houses are built to the Virginia Residential Code, which 13VAC5-63-210 defines as "the provisions of the IRC … as amended by VCC Section 310.8" WITHOUT naming an edition year, and the only place the regulation prints "2021 International Residential Code" is a note that 13VAC5-63-10 itself says is "to provide information only". Confirm the residential edition with the building official.',
    noteSourceUrl: 'https://law.lis.virginia.gov/admincode/title13/agency5/chapter63/section210/',
    sourceUrl: 'https://www.dhcd.virginia.gov/codes',
    checkedOn: '2026-09-07',
  },
  {
    state: 'GA',
    stateName: 'Georgia',
    authorityName: 'Georgia Department of Community Affairs, Office of Construction Codes and Industrialized Buildings',
    codes: [
      { family: 'IBC', edition: '2024' },
      { family: 'IRC', edition: '2024' },
      { family: 'IECC', edition: '2015' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: 'The energy code is NINE YEARS behind the rest of the family: Georgia\'s mandatory state minimum codes are the 2024 I-Codes and the 2023 NEC, but the energy code is still the 2015 IECC with Georgia supplements and amendments. The International Existing Building Code is PERMISSIVE in Georgia (2018 edition) rather than mandatory, so whether it applies to your renovation depends on the local jurisdiction adopting it.',
    sourceUrl: 'https://dca.georgia.gov/community-assistance/construction-codes/current-state-minimum-codes-construction',
    checkedOn: '2026-09-07',
  },
  {
    state: 'OH',
    stateName: 'Ohio',
    authorityName: 'Ohio Board of Building Standards (Department of Commerce, Division of Industrial Compliance)',
    codes: [
      { family: 'IBC', edition: '2021', name: '2024 Ohio Building Code' },
      { family: 'IEBC', edition: '2021', name: '2024 Ohio Building Code' },
      { family: 'IECC', edition: '2021', name: '2024 Ohio Building Code' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: 'The "2024" Ohio Building Code is the 2021 ICC model codes (IBC, IMC, IPC, IFGC, IECC, IEBC) adopted by reference, effective 1 March 2024 — the year in its name is the Ohio edition, not the model-code year. Its electrical chapter is NFPA 70 (2023). One-, two- and three-family dwellings are NOT under the Ohio Building Code: they are under the separate Residential Code of Ohio (Ohio Administrative Code 4101:8), whose model-code edition MAGE has not verified.',
    noteSourceUrl: 'https://codes.ohio.gov/ohio-administrative-code/4101:8',
    sourceUrl: 'https://dam.assets.ohio.gov/image/upload/com.ohio.gov/documents/2024%20OBC%20Executive%20Summary%201.pdf',
    checkedOn: '2026-09-07',
  },
  {
    state: 'NJ',
    stateName: 'New Jersey',
    authorityName: 'New Jersey Department of Community Affairs, Division of Codes and Standards (Uniform Construction Code)',
    codes: [
      { family: 'IBC', edition: '2024' },
      { family: 'IRC', edition: '2024' },
      { family: 'IECC', edition: '2024' },
      { family: 'IMC', edition: '2024' },
      { family: 'IFGC', edition: '2024' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: 'The 2024 I-Codes and the 2023 NEC became effective in the New Jersey Uniform Construction Code on 17 August 2026 — a very recent turnover, so a job permitted before that date is on the previous adoption. New Jersey does NOT use the International Plumbing Code: plumbing is the National Standard Plumbing Code (2024). The 2024 IECC governs low-rise residential only; commercial and other residential go to ASHRAE 90.1-2022.',
    sourceUrl: 'https://www.nj.gov/dca/codes/codreg/current.shtml',
    checkedOn: '2026-09-07',
  },
  {
    state: 'MN',
    stateName: 'Minnesota',
    authorityName: 'Minnesota Department of Labor and Industry, Construction Codes and Licensing Division',
    codes: [
      { family: 'IRC', edition: '2018', name: '2020 Minnesota Residential Code', sourceUrl: 'https://www.revisor.mn.gov/rules/1309.0010/' },
      { family: 'NEC', edition: '2023', sourceUrl: 'https://www.revisor.mn.gov/rules/1315.0200/' },
    ],
    notes: 'The 2020 Minnesota State Building Code took effect 31 March 2020 and is mandatory statewide with limited exceptions. Minnesota Rules 1309.0010 adopts the 2018 IRC as amended. THE ELECTRICAL CODE IS A FULL CYCLE AHEAD OF THE RESIDENTIAL ONE: Minnesota Rules 1315.0200 requires the 2023 NEC (ANSI/NFPA 70-2023), not the 2020 edition the DLI residential fact sheet era implies — the two chapters move independently. MAGE could NOT verify which IBC edition Rules 1305 adopts, so no commercial building edition is claimed here — confirm that one with the building official.',
    noteSourceUrl: 'https://www.dli.mn.gov/business/codes-and-laws/makeup-minnesota-state-building-code',
    sourceUrl: 'https://www.dli.mn.gov/sites/default/files/pdf/fs-2020-residential-code.pdf',
    checkedOn: '2026-09-07',
  },
  {
    state: 'NC',
    stateName: 'North Carolina',
    authorityName: 'North Carolina Building Code Council (Office of the State Fire Marshal, Engineering and Codes)',
    codes: [
      { family: 'LOCAL', edition: '2018', name: '2018 North Carolina State Building Code' },
    ],
    notes: 'North Carolina is stuck between editions. OSFM still lists the 2018 codes — in effect since 1 January 2019 — as the current ones. The 2024 North Carolina State Building Code has been adopted but does not take effect until twelve months after the State Fire Marshal certifies that publication and distribution are complete and the Residential Code Council is fully constituted, so it has no fixed effective date; confirm before designing to it. MAGE has not verified which ICC model-code editions sit under the 2018 North Carolina code, so none are claimed here.',
    noteSourceUrl: 'https://www.ncosfm.gov/news/press-releases/2025/04/07/north-carolina-delays-implementation-2024-state-building-code',
    sourceUrl: 'https://www.ncosfm.gov/codes/codes-current-and-past',
    checkedOn: '2026-09-07',
  },
];

export const LOCAL_ADOPTIONS: readonly LocalAdoption[] = [
  {
    name: 'New York City',
    state: 'NY',
    // All five boroughs are NYC and answer to the same DOB. The screen's own
    // placeholder says "Brooklyn, NY", so borough names have to resolve.
    matchCity: [
      'new york', 'new york city', 'nyc', 'manhattan', 'brooklyn',
      'queens', 'the bronx', 'bronx', 'staten island',
    ],
    matchCounty: ['new york', 'kings', 'queens', 'bronx', 'richmond'],
    authorityName: 'New York City Department of Buildings',
    codes: [
      { family: 'LOCAL', edition: '2022', name: 'NYC Construction Codes' },
    ],
    notes: 'New York City writes and enforces its own Construction Codes rather than the state code; the 2022 Construction Codes took effect 7 November 2022.',
    sourceUrl: 'https://www.nyc.gov/site/buildings/codes/2022-construction-codes.page',
    checkedOn: '2026-09-07',
  },
  {
    name: 'San Francisco',
    state: 'CA',
    matchCity: ['san francisco'],
    matchCounty: ['san francisco'],
    authorityName: 'San Francisco Department of Building Inspection (DBI)',
    codes: [
      { family: 'LOCAL', edition: '2025', name: 'San Francisco Building Code (2025 California Building Code as amended by San Francisco)' },
    ],
    notes: 'Permits filed on or after 1 January 2026 use the 2025 California Codes plus the 2025 San Francisco amendments.',
    sourceUrl: 'https://www.sf.gov/resource--2022--current-san-francisco-building-codes',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Seattle',
    state: 'WA',
    matchCity: ['seattle'],
    authorityName: 'Seattle Department of Construction & Inspections (SDCI)',
    codes: [
      { family: 'IBC', edition: '2021', name: '2021 Seattle Building Code' },
      { family: 'IRC', edition: '2021', name: '2021 Seattle Residential Code', sourceUrl: 'https://www.seattle.gov/construction-and-inspections/codes/codes-we-enforce-(a-z)/residential-code' },
    ],
    notes: 'The Seattle Residential Code governs houses, duplexes and townhouses up to three storeys with separate entrances; everything else is under the Building Code. SDCI publishes the two on separate pages and each names only its own basis, so the row cites both.',
    sourceUrl: 'https://www.seattle.gov/construction-and-inspections/codes/codes-we-enforce-(a-z)/building-code',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Philadelphia',
    state: 'PA',
    matchCity: ['philadelphia', 'philly'],
    matchCounty: ['philadelphia'],
    authorityName: 'Philadelphia Department of Licenses and Inspections (L&I)',
    codes: [
      { family: 'IBC', edition: '2021' },
      { family: 'IRC', edition: '2021' },
      { family: 'IECC', edition: '2021' },
      { family: 'NEC', edition: '2020', name: 'Philadelphia Electrical Code' },
      { family: 'IFC', edition: '2018', name: 'Philadelphia Fire Code' },
    ],
    notes: 'The electrical and fire codes are off-cycle from the rest of the family: the Electrical Code is on the 2020 NEC and the Fire Code on the 2018 IFC inside an otherwise-2021 adoption. Philadelphia amends the ICC family locally.',
    sourceUrl: 'https://www.phila.gov/departments/department-of-licenses-and-inspections/resources/applicable-codes/',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Houston',
    state: 'TX',
    matchCity: ['houston'],
    authorityName: 'Houston Permitting Center',
    codes: [
      { family: 'IBC', edition: '2021', name: '2021 Houston Construction Code' },
      { family: 'IRC', edition: '2021', name: '2021 Houston Construction Code' },
      { family: 'IECC', edition: '2021' },
      { family: 'IEBC', edition: '2021' },
      { family: 'IFC', edition: '2021' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: 'Houston takes its mechanical and plumbing codes from IAPMO — the 2021 Uniform Mechanical Code and Uniform Plumbing Code with Houston amendments — NOT the ICC\'s IMC/IPC. The 2021 Houston Construction Code took effect 1 January 2024 (Ord. No. 2023-907). THE ELECTRICAL CODE IS A CYCLE AHEAD OF THE REST and is not Houston\'s choice: the 2023 NEC applies as a Texas state mandate from 1 September 2023, and the city publishes only administrative amendments to it.',
    sourceUrl: 'https://www.houstonpermittingcenter.org/building-code-enforcement/code-development',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Phoenix',
    state: 'AZ',
    matchCity: ['phoenix'],
    authorityName: 'City of Phoenix Planning and Development Department (PDD)',
    codes: [
      { family: 'IBC', edition: '2024', name: '2024 Phoenix Building Construction Code' },
      { family: 'IRC', edition: '2024', name: '2024 Phoenix Building Construction Code' },
      { family: 'IECC', edition: '2024' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: 'Phoenix adopts BOTH the 2024 IPC and the 2024 UPC, so confirm which plumbing code your reviewer is working from. The 2024 Phoenix Building Construction Code took effect 1 August 2025 — a full cycle ahead of most large cities.',
    sourceUrl: 'https://www.phoenix.gov/administration/departments/pdd/tools-resources/codes-ordinance/building-code.html',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Denver',
    state: 'CO',
    matchCity: ['denver'],
    matchCounty: ['denver'],
    authorityName: 'Denver Community Planning and Development (CPD)',
    codes: [
      { family: 'IBC', edition: '2024', name: '2025 Denver Building and Fire Code' },
      { family: 'IRC', edition: '2024', name: '2025 Denver Building and Fire Code' },
      { family: 'IECC', edition: '2021' },
    ],
    notes: 'The 2025 Denver Building and Fire Code is built on the 2024 I-Codes, except the energy code, which stays on the 2021 IECC.',
    sourceUrl: 'https://www.denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Community-Planning-and-Development/Building-Codes-Policies-and-Guides',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Miami-Dade County',
    state: 'FL',
    matchCity: ['miami', 'miami-dade', 'miami dade'],
    matchCounty: ['miami-dade', 'miami dade', 'dade'],
    authorityName: 'Miami-Dade County Department of Regulatory and Economic Resources — Construction, Permitting and Building Code Division',
    codes: [
      { family: 'LOCAL', edition: '8th Edition (2023)', name: 'Florida Building Code, 8th Edition (2023)' },
    ],
    notes: "The county's Product Control Section must approve building-envelope products before use — windows, exterior glazing, wall cladding, roofing, exterior doors, skylights, glass block, siding and shutters.",
    noteSourceUrl: 'https://www.miamidade.gov/global/economy/board-and-code/product-approval.page',
    sourceUrl: 'https://www.miamidade.gov/global/economy/building/home.page',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Chicago',
    state: 'IL',
    matchCity: ['chicago'],
    // NOT keyed on Cook County — most of Cook is suburbs with their own
    // adoptions, and the Chicago Construction Codes stop at the city line.
    authorityName: 'City of Chicago Department of Buildings',
    codes: [
      { family: 'IBC', edition: '2018', name: '2019 Chicago Building Code' },
      { family: 'IEBC', edition: '2018', name: '2019 Chicago Building Rehabilitation Code' },
      { family: 'IECC', edition: '2021', name: 'Chicago Energy Transformation Code' },
      { family: 'NEC', edition: '2017', name: 'Chicago Electrical Code' },
    ],
    notes: 'Chicago writes its own Construction Codes (Municipal Code Titles 14A-14X) rather than enforcing an Illinois code. The 2019 Chicago Building Code (Title 14B) applies to MOST permit applications started on or after 1 August 2020, and work in existing buildings goes to the Building Rehabilitation Code (Title 14R) instead of the new-construction code. Two traps: the Department of Buildings code index lists no separate residential code at all, so ask the Department which title covers a one- or two-family house before you assume it is 14B; and fuel gas is still on the 2000 International Fuel Gas Code (Chapter 18-28, Article XIV), while plumbing and mechanical are not on any model-code edition — they are Municipal Code chapters 18-29 and 18-28 respectively, mirrored by the INTERIM Chicago Plumbing Code (14P) and INTERIM Chicago Mechanical Code (14M).',
    sourceUrl: 'https://www.chicago.gov/city/en/depts/bldgs/provdrs/bldg_code/svcs/chicago_buildingcodeonline.html',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Boston',
    state: 'MA',
    matchCity: ['boston'],
    authorityName: 'City of Boston Inspectional Services Department (ISD)',
    codes: [
      // Each claim now cites the PROMULGATED 780 CMR chapter that makes it, as
      // published by the Secretary of the Commonwealth. The row used to cite a
      // boston.gov homeowner-permits page whose only code sentence is "all the
      // work follows the Massachusetts State Building Code (780 CMR)" — true,
      // and proof of the AUTHORITY, but it names no edition and no model-code
      // family, so it proved none of these four. It is kept as noteSourceUrl.
      // (www.mass.gov, the obvious alternative, 403s every automated request.)
      { family: 'IBC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition' },
      { family: 'IRC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition', sourceUrl: 'https://www.sec.state.ma.us/reg_pub/pdf/700/780051.pdf' },
      { family: 'IEBC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition', sourceUrl: 'https://www.sec.state.ma.us/reg_pub/pdf/700/780034.pdf' },
      // 780 CMR 51.00 § 1101.1.1, NOT 780 CMR 13.00. The commercial energy
      // chapter never plainly adopts an IECC edition — its only "IECC2021" is
      // inside a drafting note, unspaced, which would not even match.
      { family: 'IECC', edition: '2021', name: 'Massachusetts State Building Code, 780 CMR 10th Edition', sourceUrl: 'https://www.sec.state.ma.us/reg_pub/pdf/700/780051.pdf' },
    ],
    notes: 'Boston has no building code of its own: the Inspectional Services Department issues the permits and enforces the statewide Massachusetts State Building Code (780 CMR), whose 10th Edition has been the only code in effect since 30 June 2025. Massachusetts municipalities may adopt the Department of Energy Resources stretch or specialized stretch energy code (225 CMR 22.00 / 23.00) on top of the base code — MAGE could NOT verify which one Boston is on, so confirm the energy code with ISD before pricing insulation, glazing or heating. ELECTRICAL IS NOT IN THIS CODE AT ALL and is not claimed here: 780 CMR 1.00 § 101.4.10 sends every electrical reference to 527 CMR 12.00, the Massachusetts Electrical Code, which is promulgated separately by the Board of Fire Prevention Regulations and moves on its own schedule — ask the electrical inspector, and do not assume it tracks the 2021 I-Codes.',
    noteSourceUrl: 'https://www.boston.gov/departments/inspectional-services/what-homeowners-should-know-about-permits',
    sourceUrl: 'https://www.sec.state.ma.us/reg_pub/pdf/700/780001.pdf',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Los Angeles',
    state: 'CA',
    matchCity: ['los angeles', 'la'],
    // NOT keyed on Los Angeles County — unincorporated LA County is a
    // different AHJ (County Public Works) with its own county building code.
    authorityName: 'Los Angeles Department of Building and Safety (LADBS)',
    codes: [
      { family: 'LOCAL', edition: '2025', name: 'California Building Standards Code (Title 24), 2025 Edition, with City of Los Angeles amendments' },
    ],
    // sourceUrl is the ADOPTING ORDINANCE, as LADBS itself publishes it.
    // Ordinance No. 188797 opens "An ordinance amending Chapter IX of the Los
    // Angeles Municipal Code to incorporate by reference certain portions of
    // the 2025 Edition of the California Building Standards Code…", was passed
    // 12 December 2025 and approved 24 December 2025, and carries an urgency
    // clause making it effective on publication. That single document proves
    // the edition, the LAMC Chapter IX location and the adopt-by-ordinance
    // mechanism — three things this row previously had to hedge.
    //
    // WHAT IT REPLACED, AND WHY. The row used to cite LADBS's EO-8 wildfire
    // implementation guidelines, the only LADBS document then reachable that
    // NAMED the edition — and it names it only to suspend it ("Standards in
    // the 2025 California Building Standards Code are suspended… Projects may
    // utilize the 2022…"). Reading that as proof of adoption is an inference,
    // not a citation, and by the Dallas rule an inference is not a source. The
    // guidelines are now noteSourceUrl, where they belong: they are what
    // proves the wildfire carve-out in `notes`. The LADBS report to Council
    // (cityclerk.lacity.org/onlinedocs/2025/25-0247_rpt_dbs_1_6-25-25.pdf)
    // carried the structural half before the ordinance was found and still
    // states it verbatim — "State law requires local jurisdictions to follow
    // the current edition of Title 24" — but the ordinance now covers it.
    //
    // TWO THINGS TO KNOW BEFORE TOUCHING THIS CITATION. The ordinance PDF is
    // 44 MB (it embeds the CALGreen checklists), so verify-code-sources.ts is
    // slow on this row and a phone tapping straight through to sourceUrl will
    // pull a large file. The City Clerk publishes a byte-identical copy at
    // cityclerk.lacity.org/onlinedocs/2025/25-1217_ord_188797_12-24-25.pdf;
    // LADBS's own copy is cited because LADBS is the authority in this row.
    // codelibrary.amlegal.com, which hosts the codified LAMC, 403s automation.
    notes: 'Los Angeles has no code of its own: LADBS enforces the state California Building Standards Code (Title 24), which the City adopts and amends by ordinance, and state law requires local jurisdictions to follow the CURRENT edition of Title 24. The ordinance in force is No. 188797, the 2025 triennial adoption — passed 12 December 2025, approved 24 December 2025, effective on publication — which amends Chapter IX of the Los Angeles Municipal Code so that the Los Angeles Building Code and Los Angeles Residential Code adopt portions of the 2025 California Building Code and 2025 California Residential Code (Title 24 Parts 2 and 2.5) by reference. Read the City amendments in LAMC Chapter IX rather than pricing off the state code alone. WILDFIRE REBUILDS ARE DIFFERENT: LADBS\'s Executive Order No. 8 implementation guidelines (v2.0, 18 December 2025) suspend the 2025 California Building Standards Code standards for a project repairing, restoring, demolishing or replacing a residential structure substantially damaged or destroyed by the wildfires — those projects may use the 2022 edition instead, EXCEPT the State Fire Marshal fire and public-life-safety requirements carried into the 2025 code. Flood-zone minimum-elevation standards still come from the 2025 code, and the California Energy Code solar-PV requirement is suspended while Solar Ready still applies. That suspension rides on an emergency executive order, and emergency orders lapse: MAGE has confirmed the guidelines still read this way but NOT that the order behind them is still live, so confirm the carve-out with LADBS before relying on it.',
    noteSourceUrl: 'https://dbs.lacity.gov/sites/default/files/efs/pdf/publications/EO-8-Implementation-Guidelines.pdf',
    sourceUrl: 'https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/26-ord-188797-260108.pdf',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Washington, DC',
    state: 'DC',
    matchCity: ['washington', 'washington dc', 'district of columbia', 'dc'],
    matchCounty: ['district of columbia', 'washington'],
    authorityName: 'District of Columbia Department of Buildings (DOB)',
    codes: [
      { family: 'IBC', edition: '2015', name: '2017 District of Columbia Construction Codes' },
      { family: 'IRC', edition: '2015', name: '2017 District of Columbia Construction Codes' },
      { family: 'NEC', edition: '2014' },
    ],
    notes: 'The District is more than a code cycle behind most of the country and the name hides it: the "2017" DC Construction Codes are the 2015 ICC family plus the 2014 National Electrical Code and ASHRAE 90.1-2013, and they only took effect on 29 May 2020. Do not price a DC job off the current I-Codes. This is still the code in force — the 2024 DC Construction Codes, built on the 2021 I-Codes, are in rulemaking and not adopted; the Department of Buildings took over code development in February 2026 and does not expect final rules before winter 2027.',
    sourceUrl: 'https://dob.dc.gov/node/1615636',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Austin',
    state: 'TX',
    matchCity: ['austin'],
    authorityName: 'City of Austin Development Services Department',
    codes: [
      // Every claim cites the ENACTED ordinance that adopts it, not the
      // department's summary table. The table is right, but a landing page
      // that lists editions is a description of the law; these are the law.
      // (Two mirrors that look authoritative are NOT usable: Municode serves
      // only an SPA shell to every client, and austin-tx.elaws.us still
      // returns "The International Fire Code and Appendices B and F, 2015
      // Edition" marked "Latest version." — three cycles stale.)
      { family: 'IBC', edition: '2024', name: 'Austin City Code § 25-12-1, Ordinance No. 20250410-045', sourceUrl: 'https://services.austintexas.gov/edims/document.cfm?id=453143' },
      { family: 'IRC', edition: '2024', name: 'Austin City Code § 25-12-241, Ordinance No. 20250410-040', sourceUrl: 'https://services.austintexas.gov/edims/document.cfm?id=450486' },
      { family: 'IEBC', edition: '2024', name: 'Austin City Code § 25-12-231, Ordinance No. 20250410-045', sourceUrl: 'https://services.austintexas.gov/edims/document.cfm?id=453143' },
      { family: 'IECC', edition: '2024', name: 'Austin City Code § 25-12-261, Ordinance No. 20250410-038', sourceUrl: 'https://services.austintexas.gov/edims/document.cfm?id=452785' },
      // No enacted IFC ordinance is reachable: the city's link for it goes to
      // Municode, and the only Austin fire ordinance that does open is a
      // pre-adoption draft headed "ORDINANCE NO. 1" — the Dallas trap, so it
      // is not cited. Austin Fire's own page states the adoption instead.
      { family: 'IFC', edition: '2024', sourceUrl: 'https://www.austintexas.gov/fire/fire-building-code' },
    ],
    notes: 'Austin\'s technical codes are Chapter 25-12 of the City Code; the 2024 I-Codes took effect 10 July 2025. Like Houston, Austin takes plumbing and mechanical from IAPMO — the 2024 Uniform Plumbing Code and Uniform Mechanical Code — NOT the ICC\'s IPC/IMC. MAGE claims no electrical edition for Austin: the city\'s own code page lists the 2023 NEC as current while also stating the 2026 NEC is effective 1 September 2026 — a date that has now passed with the page left unchanged, so the page implies both editions at once. Confirm the electrical edition with Development Services.',
    sourceUrl: 'https://www.austintexas.gov/development-services/building-technical-codes',
    checkedOn: '2026-09-07',
  },
  {
    name: 'San Antonio',
    state: 'TX',
    matchCity: ['san antonio'],
    authorityName: 'City of San Antonio Development Services Department',
    codes: [
      { family: 'IBC', edition: '2024' },
      { family: 'IRC', edition: '2024' },
      { family: 'IEBC', edition: '2024' },
      { family: 'IECC', edition: '2021' },
      // NOT the row's Chapter 10 PDF: that document's Article VI is STALE. It
      // still prints "Sec. 10-51. Adoption of National Electrical Code (2020)"
      // and "The 2020 edition of the National Electrical Code … is adopted",
      // while the ordinance that enacted it adopts the 2023 edition in the
      // same section. The enacting ordinance is the law; the codified
      // compilation is a publication of it, and here it lags.
      { family: 'NEC', edition: '2023', sourceUrl: 'https://mcclibraryfunctions.azurewebsites.us/api/ordinanceDownload/11508/1339820/pdf' },
    ],
    notes: 'Chapter 10 of the City Code, effective 1 May 2025 (Ordinance 2025-01-30-0075), adopts the 2024 IBC, IRC, IMC, IPC, IEBC, IFGC, IFC and ISPSC — but the energy code stayed on the 2021 IECC, a cycle behind the rest. THE ELECTRICAL EDITION IS A DOCUMENTED CONFLICT, so confirm it in writing: Ordinance 2025-01-30-0075 adopts the 2023 NEC in its caption, its recitals and its operative Sec. 10-51 ("The 2023 edition of the National Electrical Code … is adopted"), but the codified Chapter 10 PDF the city publishes still prints the superseded 2020 article, and the definitions article of BOTH documents still reads "NFPA 70, 2020 edition". MAGE follows the enacting ordinance.',
    noteSourceUrl: 'https://docsonline.sanantonio.gov/DSDUploads/2024Ch10Building-RelatedCodesFinal.pdf',
    sourceUrl: 'https://docsonline.sanantonio.gov/DSDUploads/2024Ch10Building-RelatedCodesFinal.pdf',
    checkedOn: '2026-09-07',
  },
  {
    name: 'Dallas',
    state: 'TX',
    matchCity: ['dallas'],
    authorityName: 'City of Dallas Planning and Development, Permitting and Inspections',
    codes: [
      { family: 'IBC', edition: '2021' },
      { family: 'IRC', edition: '2021' },
      { family: 'IEBC', edition: '2021' },
      { family: 'IECC', edition: '2021' },
      { family: 'IFC', edition: '2021' },
      // NOT the row's know_code landing page: that page is STALE on this one
      // family. Sixteen months after the 2023 NEC took effect it still prints
      // "CHAPTER 56: 2020 National Electrical Code with Dallas Amendments
      // (effective June 13, 2022)" — while hyperlinking that very line to the
      // 2023-NEC adoption. The enacted ordinance is the law; the landing page
      // is a description of it, and here it lags. Cited through the archive
      // for the same TLS reason as the row itself (see below).
      { family: 'NEC', edition: '2023', name: 'Dallas Electrical Code (Dallas City Code chapter 56), Ordinance No. 33081', sourceUrl: 'https://web.archive.org/web/20260513201721/https://dallascityhall.com/departments/pnv/Documents/AH%20Memos/Chapter%2056%20Amendment,%20Dallas%20Electrical%20Code,.pdf' },
    ],
    notes: 'The 2021 ICC codes with Dallas amendments took effect 12 May 2023 and live as Dallas City Code chapters 53-62 (Building 53, Plumbing 54, Mechanical 55, Electrical 56, Residential 57, Existing Building 58, Energy 59, Fuel Gas 60); the Fire Code is chapter 16. THE ELECTRICAL CODE IS OUT OF STEP WITH THE REST, AND THE CITY\'S OWN PAGE WILL TELL YOU THE WRONG ONE: Chapter 56 is now the 2023 National Electrical Code with Dallas amendments, adopted as Ordinance No. 33081 on 28 April 2025 and effective 23 May 2025, replacing the 2020 NEC that had been in force since 13 June 2022 — but the city\'s "Know the Code" page still displays the superseded 2020 line, so a contractor pricing off that page is a full cycle behind. The Dallas Fire Code amendment to the 2021 IFC took effect earlier still, on 10 February 2023, and the Existing Building and Swimming Pool codes also date from 13 June 2022.',
    // CITED THROUGH THE INTERNET ARCHIVE ON PURPOSE. dallascityhall.com serves
    // an incomplete TLS chain (the Sectigo intermediate is missing), so every
    // correct client — bun, node, this repo's fetcher — refuses it, and
    // dallas.gov redirects there. American Legal's copy is behind Cloudflare
    // and returns 403 to everything. The capture below was diffed against the
    // live page and matches it verbatim; noteSourceUrl is the live page a
    // human should open in a browser. Do NOT "fix" this by disabling
    // certificate verification — a checker that lies about the transport is
    // worth less than no checker.
    //
    // A BLANK ORDINANCE NUMBER PROVES YOU HAVE THE DRAFT, NOT THAT THE LAW
    // DID NOT PASS. This row previously said the 2023 NEC was "drafted but
    // NOT enacted" because the PDF the know_code page links (…/DCH documents/
    // adopt 2023 National Electrical Code w edits.pdf, dated 4-22-25) has a
    // blank "ORDINANCE NO.", a blank "Passed:" line and an unsigned attorney
    // block. That is the working draft. Dallas publishes the EXECUTED copy at
    // a different path — the scan cited on the NEC entry above — carrying the
    // stamped number 33081, "Passed APR 2 8 2025" and the City Secretary's
    // "PROOF OF PUBLICATION — LEGAL ADVERTISING" page. Look for the executed
    // or published copy before ever concluding "not enacted".
    noteSourceUrl: 'https://dallascityhall.com/departments/sustainabledevelopment/buildinginspection/Pages/know_code.aspx',
    sourceUrl: 'https://web.archive.org/web/20260813101626/https://dallascityhall.com/departments/sustainabledevelopment/buildinginspection/Pages/know_code.aspx',
    checkedOn: '2026-09-07',
  },
];

// ─────────────────────────────────────────────────────────────────────
// The verification receipt's vocabulary
//
// scripts/verify-code-sources.ts opens every page above and writes what it
// found to utils/codeJurisdiction.receipt.json; scripts/validate-code-
// jurisdiction.ts (which runs in ship-check, offline) refuses to pass a row
// whose claims are not covered by that receipt. The two scripts have to agree
// EXACTLY on how a row is named and on what counts as "the same claim", so
// both helpers live here, next to the table, rather than being written twice.
//
// This is the loop the audit found open: the offline validator checked the
// SHAPE of a citation and had never opened one, so a real URL next to a
// recalled edition passed everything. It cannot any more — change a family, an
// edition or a citation and the fingerprint below stops matching the receipt,
// which fails ship-check until somebody re-runs the fetcher.
// ─────────────────────────────────────────────────────────────────────

export type CodeVerdict = 'confirmed' | 'mismatch' | 'unconfirmed' | 'unreachable' | 'manual';

/** Stable identity for one row of the table, used as the receipt's key. */
export function codeReceiptKey(e: StateAdoption | LocalAdoption): string {
  return 'name' in e ? `city:${e.state}:${normalizePlace(e.name)}` : `state:${e.state}`;
}

/**
 * Canonical description of ONE verifiable claim: the family, the edition, and
 * the page that is supposed to prove it. Deliberately NOT hashed — a receipt
 * you can read is worth more than one you have to trust, and this module is
 * kept import-free (it ships inside the RN bundle) so it has no crypto to
 * reach for anyway.
 */
export function codeClaimId(c: AdoptedCode, rowSourceUrl: string): string {
  return `${c.family}|${c.edition}|${c.sourceUrl ?? rowSourceUrl}`;
}

/** Every claim a row makes, in table order. Any edit changes this list. */
export function codeClaimIds(e: StateAdoption | LocalAdoption): string[] {
  return e.codes.map((c) => codeClaimId(c, e.sourceUrl));
}

// ─────────────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────────────

/** Two-letter USPS codes, plus DC. Not a code-adoption claim — just spelling. */
const STATE_CODES: Readonly<Record<string, string>> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI',
  minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC',
  'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV',
  wisconsin: 'WI', wyoming: 'WY',
};

const VALID_CODES = new Set(Object.values(STATE_CODES));

/** Lower-case, strip punctuation, collapse whitespace. */
export function normalizePlace(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[.,'’`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * "NY" / "ny" / "New York" / " new  york " → "NY". Returns '' when the input
 * is empty or is not a US state — an unrecognised state is a resolution
 * failure, never a silent fallback to some other state's table.
 */
export function normalizeState(s: string | undefined | null): string {
  const n = normalizePlace(s);
  if (!n) return '';
  const upper = n.toUpperCase();
  if (upper.length === 2 && VALID_CODES.has(upper)) return upper;
  return STATE_CODES[n] ?? '';
}

/**
 * Best-effort split of a legacy free-text location ("Brooklyn, NY",
 * "Seattle Washington") into city + state, for prefilling the structured
 * fields from a project that only ever stored one string. Returns empty
 * strings when it cannot tell — it never guesses a state.
 */
function peelTrailingState(text: string): { city: string; state: string } {
  // Longest state name first so "Seattle Washington" and "Austin TX" both land.
  const words = text.split(/\s+/).filter(Boolean);
  for (let take = Math.min(3, words.length - 1); take >= 1; take--) {
    const state = normalizeState(words.slice(words.length - take).join(' '));
    if (state) return { city: words.slice(0, words.length - take).join(' '), state };
  }
  return { city: text, state: '' };
}

export function splitLocationText(text: string): { city: string; state: string } {
  const raw = (text ?? '').trim();
  if (!raw) return { city: '', state: '' };

  // A trailing US ZIP is never part of the city or the state, and leaving it
  // attached is what made "124 Park Slope, Brooklyn NY 11215" — the exact
  // shape of the addresses on this account — come back as the street name
  // with NO state, which then resolved to no jurisdiction at all.
  const stripped = raw.replace(/[,\s]+\d{5}(?:-\d{4})?$/, '').trim();
  const noZip = stripped || raw;

  const parts = noZip.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    const state = normalizeState(last);
    if (state) return { city: parts[parts.length - 2], state };
    // "…, Brooklyn NY" — the final segment carries BOTH city and state.
    const tail = peelTrailingState(last);
    if (tail.state) return { city: tail.city || parts[parts.length - 2], state: tail.state };
    return { city: parts[0], state: '' };
  }

  const single = peelTrailingState(noZip);
  return single.state ? single : { city: noZip, state: '' };
}

// ─────────────────────────────────────────────────────────────────────
// A project's jobsite address, as ONE value
// ─────────────────────────────────────────────────────────────────────

/** The five fields Code Check's address block holds. Always complete: an
 *  absent part is `''`, never `undefined`, so a value can REPLACE the form
 *  rather than merge into it. */
export interface JobsiteAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  county: string;
}

export const EMPTY_JOBSITE_ADDRESS: JobsiteAddress = Object.freeze({
  street: '', city: '', state: '', zip: '', county: '',
});

const JOBSITE_ADDRESS_FIELDS = ['street', 'city', 'state', 'zip', 'county'] as const;

/**
 * Field-for-field equality, so a caller can tell an UNTOUCHED prefill from one
 * the contractor has edited. That distinction is the whole reason it exists:
 * a project's address changing elsewhere should flow into an untouched box and
 * must never overwrite something a human typed.
 */
export function sameJobsiteAddress(a: JobsiteAddress, b: JobsiteAddress): boolean {
  return JOBSITE_ADDRESS_FIELDS.every((k) => a[k] === b[k]);
}

/** The shape this module needs off a Project. Structural on purpose so the
 *  module keeps its zero imports and the validator can drive it under bun. */
export interface AddressableProject {
  structuredAddress?: {
    street?: string; city?: string; state?: string; zip?: string; county?: string;
  } | null;
  location?: string | null;
}

/**
 * The jobsite address a project implies, as a COMPLETE value.
 *
 * Complete is the whole point. The old prefill assigned field-by-field and
 * only when the field was still empty, so switching from a Houston job to a
 * Brooklyn one kept Houston's city while the screen said it was using
 * Brooklyn's — the chip, the note and the prompt each described a different
 * address. Returning every field, blanks included, makes the switch a single
 * replacement that cannot half-apply.
 *
 * structuredAddress wins because it carries the county some AHJs are keyed on;
 * the legacy free-text `location` is the fallback and yields no street.
 */
export function jobsiteAddressForProject(
  project: AddressableProject | null | undefined,
): JobsiteAddress {
  if (!project) return { ...EMPTY_JOBSITE_ADDRESS };

  const sa = project.structuredAddress;
  if (sa && ((sa.city ?? '').trim() || (sa.state ?? '').trim())) {
    return {
      street: (sa.street ?? '').trim(),
      city: (sa.city ?? '').trim(),
      state: (sa.state ?? '').trim(),
      zip: (sa.zip ?? '').trim(),
      county: (sa.county ?? '').trim(),
    };
  }

  const parsed = splitLocationText(project.location ?? '');
  return { street: '', city: parsed.city, state: parsed.state, zip: '', county: '' };
}

// ─────────────────────────────────────────────────────────────────────
// Resolution
// ─────────────────────────────────────────────────────────────────────

export interface AddressQuery {
  city?: string;
  county?: string;
  state?: string;
}

export type ResolvedCodeJurisdiction =
  | {
      kind: 'city';
      entry: LocalAdoption;
      /** Which key the row matched on — useful when a county answered. */
      matchedOn: 'city' | 'county';
      state: string;
    }
  | { kind: 'state'; entry: StateAdoption; state: string }
  | { kind: 'unknown'; reason: string };

/**
 * Resolve the AHJ for an address. Deterministic, case- and
 * punctuation-insensitive, and NEVER cross-state: a city row only matches when
 * its `state` matches the normalised state, so the several dozen Springfields
 * cannot answer for one another.
 *
 * Order: city/county override → state adoption → unknown-with-reason.
 */
export function resolveCodeJurisdiction(q: AddressQuery): ResolvedCodeJurisdiction {
  const state = normalizeState(q.state);
  if (!state) {
    const typed = normalizePlace(q.state);
    return {
      kind: 'unknown',
      reason: typed
        ? `"${(q.state ?? '').trim()}" is not a US state we recognise, so no authority could be identified.`
        : 'No state was given, so the authority having jurisdiction could not be identified.',
    };
  }

  const city = normalizePlace(q.city);
  const county = normalizePlace(q.county).replace(/\s+county$/, '');

  for (const entry of LOCAL_ADOPTIONS) {
    if (entry.state !== state) continue;
    if (city && entry.matchCity?.some((m) => normalizePlace(m) === city)) {
      return { kind: 'city', entry, matchedOn: 'city', state };
    }
  }
  for (const entry of LOCAL_ADOPTIONS) {
    if (entry.state !== state) continue;
    if (county && entry.matchCounty?.some((m) => normalizePlace(m) === county)) {
      return { kind: 'city', entry, matchedOn: 'county', state };
    }
  }

  const st = STATE_ADOPTIONS.find((e) => e.state === state);
  if (st) return { kind: 'state', entry: st, state };

  return {
    kind: 'unknown',
    reason: `MAGE has no verified code-adoption record for ${city ? `${(q.city ?? '').trim()}, ` : ''}${state}.`,
  };
}

/**
 * The office that ISSUES permits at an address — the value a Permit record's
 * `jurisdiction` field is asking for — or `null` when MAGE cannot name one.
 *
 * ONLY a city/county row answers. Every row in LOCAL_ADOPTIONS is the office a
 * contractor actually pulls a permit from; a STATE row names the body that
 * ADOPTS the code, and the Florida Building Commission does not issue permits
 * in Orlando. Keep that true when adding a local row.
 *
 * `null` is a real answer and callers must pass it through as an empty field.
 * Do NOT substitute the address: the permit tracker, the permit export and the
 * homeowner's closeout passport all print this string, and "124 Park Slope,
 * Brooklyn NY 11215" printed where a building department belongs is worse than
 * a blank a contractor can fill in.
 */
export function issuingAuthorityForAddress(q: AddressQuery): string | null {
  const resolved = resolveCodeJurisdiction(q);
  return resolved.kind === 'city' ? resolved.entry.authorityName : null;
}

// ─────────────────────────────────────────────────────────────────────
// The ONE renderer — prompt text and chip text, from the same value.
// ─────────────────────────────────────────────────────────────────────

/**
 * Human line for one adopted code: "2021 Seattle Building Code (IBC 2021)".
 *
 * The edition is the single most load-bearing fact on this screen, so it is
 * never allowed to fall off the line: a LOCAL code whose name does not already
 * carry its edition gets it appended.
 */
export function codeLine(c: AdoptedCode): string {
  if (c.family === 'LOCAL') {
    if (!c.name) return c.edition;
    return c.name.includes(c.edition) ? c.name : `${c.name} (${c.edition})`;
  }
  const base = `${c.family} ${c.edition}`;
  return c.name ? `${c.name} (${base})` : base;
}

/**
 * All of a row's codes, comma-joined, in table order. Adjacent model codes
 * published under ONE local code name collapse into a single clause —
 * "2024 Phoenix Building Construction Code (IBC/IRC 2024)" rather than naming
 * the Phoenix code once per family.
 */
export function codesSummary(codes: readonly AdoptedCode[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < codes.length) {
    const c = codes[i];
    if (!c.name || c.family === 'LOCAL') { out.push(codeLine(c)); i += 1; continue; }
    let j = i + 1;
    while (j < codes.length && codes[j].name === c.name && codes[j].family !== 'LOCAL') j += 1;
    const group = codes.slice(i, j);
    if (group.length === 1) {
      out.push(codeLine(c));
    } else {
      const oneEdition = group.every((g) => g.edition === group[0].edition);
      const basis = oneEdition
        ? `${group.map((g) => g.family).join('/')} ${group[0].edition}`
        : group.map((g) => `${g.family} ${g.edition}`).join(', ');
      out.push(`${c.name} (${basis})`);
    }
    i = j;
  }
  return out.join(', ');
}

/**
 * What ONE code check is grounded on. `promptBlock` is inserted into the model
 * prompt verbatim and `chipLabel` is shown to the contractor verbatim — both
 * built here, from the same resolved value, so the two cannot drift.
 */
export interface JurisdictionGrounding {
  /** One fact per line, in the order they reach the model. */
  facts: string[];
  /** EXACTLY the text the prompt carries. */
  promptBlock: string;
  /** EXACTLY the text the grounding chip shows. */
  chipLabel: string;
  /** True when a verified adoption record backed the facts. */
  grounded: boolean;
  /** Stable fragment identifying this jurisdiction for a cache key. Two
   *  different cities can never collide on it. */
  cacheKey: string;
}

const UNKNOWN_INSTRUCTION =
  'You have no adoption record for this jurisdiction. Do not state which edition governs here. Answer from the model codes, say plainly that the governing edition is unconfirmed, and tell the contractor to confirm with the local building department.';

const GROUNDED_INSTRUCTION =
  'Answer against THAT authority and THAT edition. Name the authority in your summary. Where the adopted edition differs from the generic model code, say so. Do not cite an edition other than the one above.';

/**
 * Render the grounding for a resolved jurisdiction.
 *
 * Grounded: names the authority, the adopted editions, and the date the
 * adoption was checked — the contractor can see how fresh the record is.
 * Unknown: says plainly there is no adoption record, that the answer is model
 * recall, and to verify with the local building department. It never dresses
 * an absent record up as a soft yes.
 */
export function groundingFactsFor(resolved: ResolvedCodeJurisdiction): JurisdictionGrounding {
  if (resolved.kind === 'unknown') {
    return {
      facts: [resolved.reason],
      promptBlock: `JURISDICTION: unresolved. ${resolved.reason}\n${UNKNOWN_INSTRUCTION}`,
      chipLabel: `No adoption record for this jurisdiction — this answer is model recall, not a code lookup. Verify the governing edition with the local building department.`,
      grounded: false,
      cacheKey: 'unknown',
    };
  }

  // Narrow through `resolved`, not a destructured `entry` — a shared binding
  // drops the discriminant and the two row shapes only overlap on BaseEntry.
  const where = resolved.kind === 'city' ? resolved.entry.name : resolved.entry.stateName;
  const entry: StateAdoption | LocalAdoption = resolved.entry;
  const codes = codesSummary(entry.codes);

  const facts = [
    `Authority having jurisdiction for ${where}: ${entry.authorityName}.`,
    `Code in effect there: ${codes}.`,
    `MAGE verified that adoption on ${entry.checkedOn} against ${entry.sourceUrl}.`,
  ];
  if (entry.notes) facts.push(`Jurisdiction note: ${entry.notes}`);
  if (resolved.kind === 'state') {
    facts.push(
      `This is the STATE adoption — MAGE has no city-level record for this address, so local amendments may apply on top of it.`,
    );
  }

  const scope = resolved.kind === 'state' ? `${resolved.entry.stateName} (state adoption)` : resolved.entry.name;

  return {
    facts,
    promptBlock: `JURISDICTION (verified adoption record):\n${facts.map((f) => `- ${f}`).join('\n')}\n${GROUNDED_INSTRUCTION}`,
    chipLabel: `Grounded on ${entry.authorityName} — ${codes}. Adoption checked ${entry.checkedOn}. Code sections below are still model recall.`,
    grounded: true,
    cacheKey: `${resolved.kind}:${entry.state}:${normalizePlace(scope)}`,
  };
}
