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
// WHAT SITS ON TOP OF THIS TABLE
//   utils/codeAmendments.ts turns a row here into the RUNG a single Code Check
//   citation is standing on: whether MAGE holds the state's own amendment text
//   for that section, merely has a government document naming it, knows only
//   the edition, or knows nothing. This table is the floor of that ladder —
//   rung 3, "we know which edition governs" — and `iccVolumeId` below is what
//   turns rung 3 from advice into a link. Read that module's header before
//   adding anything that serves code TEXT: the licensing analysis lives there,
//   and the short version is that a state regulation may be reproduced and a
//   model code may not.
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
  /**
   * The volume id of this code in ICC's FREE Digital Codes viewer, so the app
   * can hand a contractor a one-tap link to the edition that actually governs
   * his address instead of telling him to go and find it.
   *
   * THE RULES, ALL THREE OF THEM LOAD-BEARING.
   *
   * 1. VOLUME LEVEL ONLY. Never a chapter, never a section. The /content/
   *    route validates the volume id and NOTHING below it — re-measured
   *    2026-09-13, /content/IBC2021P1/chapter-99-not-a-real-chapter returns
   *    HTTP 200 AND the real volume's title, "2021 International Building
   *    Code (IBC)" — so a link built from a recalled section number opens
   *    cleanly, passes the title oracle in rule 2, and points at nothing.
   *    NEITHER CHECK IN THIS FILE CAN CATCH THAT ONE; only the id itself can.
   *    `iccViewerUrl` below refuses anything that is not a bare volume id —
   *    no slash, no dot, no space — and that regex is the only thing standing
   *    between this feature and a fabrication machine. Do not route around it,
   *    and do not add a sibling that takes a section number.
   *
   * 2. THE ID MUST HAVE BEEN FETCHED, LIKE EVERY OTHER FACT IN THIS FILE.
   *    /content/<id> serves a server-rendered <title> naming the volume, and
   *    an id that does not resolve serves the generic "Digital Codes" shell.
   *    Measured 2026-09-13 (curl, Safari UA): IECC2021P1 → 200 "2021
   *    International Energy Conservation Code (IECC)"; IECC2015P1 → 404
   *    "Digital Codes"; the invented NOTACODE9999 → 404 "Digital Codes".
   *    An earlier pass recorded that a wrong id answers 200 rather than 404;
   *    it does not today, and BOTH signals are therefore checked — a 404 is a
   *    dead link and the generic title is a dead id. The title is the one
   *    recorded, because it also catches the far worse case: an id that
   *    resolves to a REAL volume of the wrong edition, which no status code
   *    can distinguish from a right one. `iccVolumeTitle` holds what came
   *    back, verbatim, and verify-code-sources.ts re-fetches and re-compares
   *    it. Do not assume the shape of an id either: every I-Code volume here
   *    ends `P1`, and Georgia's 2015 IECC is the bare `IECC2015` — the P1
   *    form of it 404s. Fetch, do not pattern-match.
   *
   *    Every id in this table was fetched by hand on 2026-09-13 and answered
   *    200 with a title naming the row's edition: 15 distinct volumes. (It was
   *    16 until Florida's FLBC2023P1 was withdrawn under rule 3 below.)
   *
   * 3. ONLY WHERE THE VOLUME IS THIS ROW'S CLAIM, AND ONLY WHERE THE CLAIM IS
   *    ONE BOOK. An entry with no `name` is claiming the model code itself
   *    ("IBC 2021"), and the ICC volume IS that claim. An entry WITH a `name`
   *    is claiming a locally-titled code, and it may only carry a volume when
   *    ICC publishes THAT NAME as ONE VOLUME. New York's RCNYS does: ICC's
   *    own title is "2025 Residential Code of New York State (2025 RCNYS)",
   *    the row's name and the book are the same object.
   *
   *    FLORIDA DOES NOT, AND THIS RULE PREVIOUSLY CITED IT AS THE EXAMPLE OF
   *    BEING SATISFIED. That was wrong and it shipped a wrong-book link. ICC
   *    publishes the FBC as a FAMILY — measured 2026-09-13 (curl, Safari UA):
   *    FLBC2023P1 "…, Building, Eighth Edition" (200), FLRC2023P1 "…,
   *    Residential, …" (200), FLEC2023P1 "…, Energy Conservation, …" (200),
   *    FLEBC2023P1 "…, Existing Building, …" (200), FLBC2023P2 (200). The
   *    row's name, "Florida Building Code, 8th Edition (2023)", is an umbrella
   *    over all of them, so no single id is what the row claims and the row
   *    now carries none. This is the same treatment New York's Uniform Code
   *    umbrella already got. An umbrella gets no link; the way to give Florida
   *    a link is to split the row into the volumes the state actually adopts,
   *    each read off a page that says so.
   *
   *    Ohio's "2024 Ohio Building Code" and Denver's "2025 Denver Building and
   *    Fire Code" are not the 2021/2024 IBC and must not be linked to it.
   *    Linking a contractor to the model code while the chip names his local
   *    code would be the edition error this table exists to prevent, wearing
   *    a URL.
   */
  iccVolumeId?: string;
  /** The <title> ICC's viewer returned for `iccVolumeId`, verbatim. */
  iccVolumeTitle?: string;
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
  /**
   * USPS postal-community names ("Astoria", "Long Island City") that place an
   * ADDRESS inside this row. Read ONLY by `resolveCodeJurisdiction`, on the
   * address's city field, by whole-name equality — and never when the address
   * carries a county that is not one of this row's `matchCounty` names (a
   * "Far Rockaway" address point filed under Nassau stays out).
   *
   * KEPT OUT OF `matchCity` ON PURPOSE. permitInspectionFacts.localEntryFor
   * reads matchCity/matchCounty as an AUTHORITY-NAME matcher that drops
   * "city"/"village" and compares the remaining words as a set, so "long
   * island city" there means any text containing "long" and "island" — every
   * Suffolk and Nassau town permit ("Town of Huntington, Long Island") — and
   * "middle village" means anything containing "middle". A postal name is an
   * address fact, not the name of a permit office; it lives here.
   */
  postalCity?: readonly string[];
  /**
   * Five-digit ZIPs that place an ADDRESS inside this row. Read ONLY by
   * `resolveCodeJurisdiction`, on the query's `zip`, and never when the
   * address carries a county that is not one of this row's `matchCounty`
   * names — a county always outranks a ZIP.
   *
   * A row may list a ZIP here only when that ZIP's Census ZCTA lies wholly
   * inside the row's government, measured from a fetched Census file (see the
   * Baltimore rows for the method). A ZCTA approximates a USPS ZIP; it is not
   * the same thing, which is why a ZIP that crosses a line is left out and
   * falls through to the state row rather than being guessed at.
   */
  postalZip?: readonly string[];
  /** How to reach the building department. Only rows verified on the
   *  authority's own site carry one (NYC today); `departmentFor` returns null
   *  for every other row, so nothing is rendered from recall. */
  department?: BuildingDepartment;
}

/** Where a contractor is in the permit's life when the question comes up. */
export type DepartmentQuestionStage = 'pre_filing' | 'in_review' | 'objection' | 'inspection' | 'general';

/** One way to put a question to the department at a given stage. */
export interface DepartmentChannel {
  stage: DepartmentQuestionStage;
  label: string;
  url?: string;
  phone?: string;
  email?: string;
  note: string;
}

/** Contact and process facts for a building department, every one read off
 *  `sourceUrl` (or the URL it names) on `checkedOn`. Fees are LINKED, never
 *  computed. */
export interface BuildingDepartment {
  portalUrl: string;
  /**
   * Link text for `portalUrl`, as the department names its own portal
   * ('E-Permits portal'). Absent means the NYC wording the card has always
   * used ('DOB NOW portal'), so the NYC row renders exactly as before.
   */
  portalLabel?: string;
  statusLookupUrl?: string;
  phone?: string;
  email?: string;
  hours?: string;
  afterHours?: string;
  questionChannels: readonly DepartmentChannel[];
  feeScheduleUrls?: readonly { label: string; url: string }[];
  applicantOfRecordNote?: string;
  sourceUrl: string;
  /**
   * Where the facts were read, in the words the card prints after "Checked …
   * on" ('baltimorecity.gov'). Absent means the NYC wording ('nyc.gov').
   */
  sourceLabel?: string;
  checkedOn: string;
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
//     else        Portland, Detroit, Minneapolis, New Orleans,
//                 San Diego, Sacramento, Indianapolis, Columbus, Jacksonville,
//                 Milwaukee, Albuquerque, Tucson and Kansas City have NOT been
//                 researched. They resolve to their state row where one exists
//                 and to 'unknown' otherwise, which is the correct answer
//                 until somebody reads their building department's page.
//
// MARYLAND (added 2026-09-28; every page below fetched that day with curl and
// a Safari User-Agent, PDFs through `pdftotext -layout`):
//   VERIFIED  the state row (Maryland Department of Labor's code matrix and
//             its building-codes pages), Baltimore City (the City's own Law
//             Library and DHCD's pages) and Baltimore County (PAI's codes
//             sheet Rev 08/25/26 and its pages). Both Baltimore rows carry a
//             department block.
//   NOT       every other Maryland county and every incorporated town inside
//   VERIFIED  them. They resolve to the state row, and the permit-office card
//             (utils/permitOffices.ts) is name-only for them. Montgomery,
//             Prince George's, Anne Arundel, Howard and the rest each set
//             their own amendments, fire code and electrical code; none of
//             that has been read, so none of it is claimed.
//   THE TRAP  "Baltimore, MD" is NOT Baltimore City. Baltimore County
//             addresses use the same postal name: its own address-point layer
//             (Facilities/Address/MapServer/0, grouped by CITY_POSTAL and ZIP
//             on 2026-09-28) holds 20,870 County address points whose postal
//             city is BALTIMORE, across nine ZIPs. So no row matches the city
//             name 'baltimore'; the County decides, or a ZIP that lies wholly
//             in one government, or the answer is the state row with
//             `localAmbiguity` set (see resolveCodeJurisdiction). One of those
//             nine is 21230, whose Census ZCTA is wholly City: that is why a
//             ZIP must also pass the address-point test (BALTIMORE ZIPs below).
//
// SOURCES THIS ENVIRONMENT CANNOT OPEN — every one of these WAS read on
// 2026-09-07, out of band, and the receipt records how. What they have in
// common is that `bun run scripts/verify-code-sources.ts` will never fetch
// them from a script, so it reports them unreachable FOREVER. That is a
// property of the host, not a defect in the row: do not "fix" it by swapping
// in a worse citation that happens to be fetchable.
//   New York      dos.ny.gov sits behind a Cloudflare interstitial that 403s
//     (state)     this repo's fetcher — verified again 2026-09-12: bun's
//                 `fetch`, with the script's own Chrome User-Agent, gets a
//                 5.9 kB 403 interstitial for the FAQ, for Part 1219 and for
//                 the Part 1240 PDF. So no dos.ny.gov URL will ever verify
//                 from verify-code-sources.ts. It is NOT unreadable, though,
//                 and the earlier note here overstated it: macOS `curl -L`
//                 with a Safari User-Agent gets HTTP 200 on all of them, and
//                 that is how the row was re-read on 2026-09-12 (FAQ as HTML;
//                 19 NYCRR Parts 1219, 1220 and 1240 and the Notice of
//                 Adoption as PDFs/HTML through `pdftotext -layout`). Reach
//                 for curl before you reach for the Internet Archive here.
//                 The FAQ states both 2025 codes and the 2024-ICC basis in a
//                 single sentence; § 1219.2(a)(1)-(8) names the eight 2025 New
//                 York volumes; § 1220.2(a) puts one- and two-family work
//                 under the 2025 RCNYS. This row is checked, not "re-check me".
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
      // The first two claims are cited to the BINDING regulation rather than to
      // the FAQ that is the row's sourceUrl. The FAQ does state both, in one
      // sentence, which is why it stays as the row citation; 19 NYCRR is what
      // makes them law. Part 1219 has a stable landing URL that redirects to the
      // current file, so it will follow the next code cycle by itself. Part 1240
      // has NO such landing URL (dos.ny.gov/19-nycrr-part-1240 is a 404), so its
      // citation is a dated file path and WILL rot at the next amendment —
      // when it does, re-find it from dos.ny.gov's laws-and-regulations page
      // rather than deleting the claim.
      { family: 'LOCAL', edition: '2025', name: '2025 Uniform Fire Prevention and Building Code of New York State (built on the 2024 I-Codes)', sourceUrl: 'https://dos.ny.gov/19-nycrr-part-1219' },
      { family: 'LOCAL', edition: '2025', name: '2025 Energy Conservation Construction Code of New York State', sourceUrl: 'https://dos.ny.gov/system/files/documents/2026/02/19-nycrr-part-1240.pdf', iccVolumeId: 'NYSECC2025P1', iccVolumeTitle: '2025 Energy Conservation Construction Code of New York State (2025 ECCCNYS)' },
      // THE RESIDENTIAL VOLUME, added 2026-09-12. The note below used to say the
      // state "does not publish separate IBC/IRC/IECC edition years" and left it
      // there, which read as "New York publishes nothing but the Uniform Code
      // umbrella". It does: 19 NYCRR § 1219.2(a)(1)-(8), read today, defines
      // EIGHT separately-titled 2025 New York volumes (BCNYS, EBCNYS, FCNYS,
      // FGCNYS, MCNYS, PCNYS, PMCNYS and RCNYS), each "(publication date: July
      // 2025)", and § 1220.2(a) makes the 2025 RCNYS the operative code for
      // detached one- and two-family dwellings and townhouses not more than
      // three stories above grade plane — which is most of what this app's users
      // build. Only the residential volume is claimed here because it is the one
      // whose absence was actively misleading; the other seven are real and can
      // be added the same way, each off a page that names it.
      //
      // WHY THIS URL AND NOT PART 1219: the title is stated in both, but a claim
      // is keyed FAMILY|edition|sourceUrl, so citing Part 1219 twice would give
      // two different claims one identical id and the receipt would then carry
      // the Uniform Code's evidence sentence as proof of this one. The Notice of
      // Adoption is the state's own notice of the very rule that did this, and
      // it prints the title verbatim in a list of what the rule incorporated by
      // reference. It is an ARCHIVE page — it also carries the 2020 and earlier
      // notices, so read the section headed by the 25 July 2025 adoption, not
      // the first match for "Residential Code of New York State" on the page.
      { family: 'LOCAL', edition: '2025', name: '2025 Residential Code of New York State', sourceUrl: 'https://dos.ny.gov/notice-adoption', iccVolumeId: 'NYSRC2025P1', iccVolumeTitle: '2025 Residential Code of New York State (2025 RCNYS)' },
    ],
    notes: 'The 2025 Uniform Code replaced the 2020 edition on 31 December 2025. The state states its basis as the 2024 ICC books collectively and does not publish separate IBC/IRC/IECC edition years, so none are claimed here — but it DOES publish separately-titled New York volumes under that umbrella, and the one a one- or two-family job is built to is the 2025 Residential Code of New York State (19 NYCRR § 1220.2(a); § 1219.2(a)(8) names the publication, July 2025). Which IRC edition sits under the RCNYS is still not stated by the state, so it is not claimed. NEW YORK CITY IS A PARTIAL, NOT A TOTAL, EXEMPTION: it writes its own Construction Codes in place of the Uniform Code, but the Energy Code is statewide and NYC enforces an approved, more-restrictive LOCAL version of it rather than being outside it. ONE LARGE PROVISION IS ON THE BOOKS BUT UNENFORCEABLE: the 2025 prohibition on fossil-fuel equipment and building systems in new buildings (19 NYCRR § 1240.6 and Subpart 1229-2) is suspended by court order and is neither effective nor enforceable — do not price a new build all-electric on the assumption that it applies. WHO ISSUES THE PERMIT OUTSIDE NEW YORK CITY: the Uniform Code applies in every part of the state except New York City, so this row governs Nassau, Suffolk, Westchester, Rockland, Putnam, Orange and Dutchess alike — but the permit office is the village, the city, or the town (for land outside any incorporated village), not the county. Executive Law § 381 puts enforcement on that local government; only if it has opted out by local law does enforcement pass to the county, and if the county has opted out too, to the Department of State. MAGE holds no list of which municipalities have opted out, so confirm the office with the village or town.',
    // The "WHO ISSUES THE PERMIT" sentences were added 2026-09-26, read off the
    // Department of State's Legal Memorandum LG03, "NYS Uniform Fire Prevention
    // and Building Code: What Elected Officials Need to Know" —
    //   https://dos.ny.gov/legal-memorandum-lg03-nys-uniform-fire-prevention-and-building-code-what-elected-officials-need
    // (curl -L with a Safari UA, HTTP 200; the fetcher gets the same 403 as the
    // FAQ). It says the Uniform Code is "applicable in every part of the State
    // (except the City of New York)", defines "local government" as "a village,
    // town (outside the area of any incorporated village) or city", and sets
    // out the Executive Law § 381 opt-out chain: local government → county →
    // Department of State. It names no county; the seven named in the note are
    // the ones this app's contractors work in, and all seven are "every part
    // of the State" outside New York City. The codes and checkedOn below are
    // unchanged — that memorandum is about who enforces, not which edition.
    sourceUrl: 'https://dos.ny.gov/division-building-standards-and-codes-frequently-asked-questions',
    // Re-verified 2026-09-12: the FAQ (this sourceUrl) was re-read and still
    // states the 2025 Uniform Code + 2025 ECCCNYS on the 2024 ICC books, the
    // NYC split, and the court-ordered suspension; 19 NYCRR Parts 1219, 1220
    // and 1240 were re-read as PDFs. See the New York paragraph in "SOURCES
    // THIS ENVIRONMENT CANNOT OPEN" for how — it is curl, not the fetcher.
    checkedOn: '2026-09-12',
  },
  {
    state: 'PA',
    stateName: 'Pennsylvania',
    authorityName: 'Pennsylvania Department of Labor and Industry, Bureau of Occupational and Industrial Safety (Uniform Construction Code)',
    codes: [
      { family: 'IBC', edition: '2021', iccVolumeId: 'IBC2021P1', iccVolumeTitle: '2021 International Building Code (IBC)' },
      { family: 'IRC', edition: '2021', iccVolumeId: 'IRC2021P1', iccVolumeTitle: '2021 International Residential Code (IRC)' },
      { family: 'IECC', edition: '2021', iccVolumeId: 'IECC2021P1', iccVolumeTitle: '2021 International Energy Conservation Code (IECC)' },
      { family: 'IEBC', edition: '2021', iccVolumeId: 'IEBC2021P1', iccVolumeTitle: '2021 International Existing Building Code (IEBC)' },
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
      { family: 'IBC', edition: '2021', iccVolumeId: 'IBC2021P1', iccVolumeTitle: '2021 International Building Code (IBC)' },
      { family: 'IRC', edition: '2021', sourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=51-51-003', iccVolumeId: 'IRC2021P1', iccVolumeTitle: '2021 International Residential Code (IRC)' },
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
      // NO VOLUME ID, DELIBERATELY. See rule 3 below. "Florida Building Code,
      // 8th Edition (2023)" is an umbrella over at least five separately
      // published ICC volumes, not one book — re-measured 2026-09-13 (curl,
      // Safari UA): FLBC2023P1 → 200 "2023 Florida Building Code, Building,
      // Eighth Edition"; FLRC2023P1 → 200 "… Residential …"; FLEC2023P1 → 200
      // "… Energy Conservation …"; FLEBC2023P1 → 200 "… Existing Building …";
      // FLBC2023P2 → 200 (a second Building part). This row carried
      // FLBC2023P1, the COMMERCIAL building volume, so a Florida residential
      // remodeler tapping an R310 egress citation landed in the wrong book
      // under a green badge. Splitting this into per-volume entries is the
      // right answer, but each one is an ADOPTION claim and must be read off a
      // page that makes it; until somebody does that, no link.
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
      { family: 'IBC', edition: '2024', iccVolumeId: 'IBC2024P1', iccVolumeTitle: '2024 International Building Code (IBC)' },
      { family: 'IRC', edition: '2024', iccVolumeId: 'IRC2024P1', iccVolumeTitle: '2024 International Residential Code (IRC)' },
      // THE ID HAS NO `P1`, AND THAT IS THE POINT OF FETCHING IT. Every other
      // I-Code volume in this table ends P1, so recall writes `IECC2015P1` —
      // which returns HTTP 404 and the generic "Digital Codes" shell (measured
      // 2026-09-13). The volume Georgia's energy code actually lives in is the
      // bare `IECC2015`, HTTP 200, title "2015 International Energy
      // Conservation Code (IECC)". A recalled id that merely LOOKS like its
      // neighbours is exactly the failure this field's rule 2 is about, and it
      // is the row a Georgia contractor most needs — the energy code is the
      // one that is nine years behind everything else on his job.
      { family: 'IECC', edition: '2015', iccVolumeId: 'IECC2015', iccVolumeTitle: '2015 International Energy Conservation Code (IECC)' },
      // NO VOLUME FOR THE NEC, HERE OR ANYWHERE IN THIS TABLE. The National
      // Electrical Code is NFPA's, not ICC's, and ICC's viewer does not carry
      // it: /content/NEC2023P1 and /content/NFPA70P1 both 404 (measured
      // 2026-09-13). Thirteen entries in this table claim an NEC edition and
      // not one can be linked. Leave them so rather than pointing an
      // electrician at a book that is not the one he is inspected against.
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
      // THE NJ EDITIONS, AND NO LINK FOR THEM. DCA's current-codes page (this
      // row's sourceUrl, re-read 2026-09-26) lists the building subcode as
      // "International Building Code/2024 , NJ ed" and the one- and two-family
      // subcode as "International Residential Code/2024 , NJ ed" — New
      // Jersey's own editions, not the model books. These two entries used to
      // link IBC2024P1 and IRC2024P1, the MODEL codes, under a chip naming New
      // Jersey: the wrong book, exactly as rule 3 on `iccVolumeId` forbids.
      // ICC has not published the NJ 2024 editions as volumes — measured
      // 2026-09-26 (curl, Safari UA): NJBC2024P1 → 404 "Digital Codes",
      // NJRC2024P1 → 404 "Digital Codes"; the 2021 NJ edition does exist
      // (NJBC2021P1 → 200 "2021 International Building Code New Jersey
      // Edition") and is the wrong cycle. So no link until the 2024 NJ volumes
      // appear; re-fetch those two ids then, record the titles, and add them.
      // The energy, mechanical and fuel gas lines carry no "NJ ed" on that page,
      // so their model-code volumes are what the state adopts and keep links.
      { family: 'IBC', edition: '2024', name: '2024 International Building Code (NJ edition)' },
      { family: 'IRC', edition: '2024', name: '2024 International Residential Code (NJ edition)' },
      { family: 'IECC', edition: '2024', iccVolumeId: 'IECC2024P1', iccVolumeTitle: '2024 International Energy Conservation Code (IECC)' },
      { family: 'IMC', edition: '2024', iccVolumeId: 'IMC2024P1', iccVolumeTitle: '2024 International Mechanical Code (IMC)' },
      { family: 'IFGC', edition: '2024', iccVolumeId: 'IFGC2024P1', iccVolumeTitle: '2024 International Fuel Gas Code (IFGC)' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: 'The 2024 I-Codes and the 2023 NEC became effective in the New Jersey Uniform Construction Code on 17 August 2026 — a very recent turnover, and the state\'s page states no grace period for the previous editions, so confirm with the municipal construction office which adoption a permit applied for around that date falls under. The building and residential codes are New Jersey\'s OWN editions of the 2024 IBC and IRC, not the model books; ICC has not published them online yet, so MAGE links neither. New Jersey does NOT use the International Plumbing Code: plumbing is the National Standard Plumbing Code (2024). The 2024 IECC governs low-rise residential only; commercial and other residential go to ASHRAE 90.1-2022.',
    sourceUrl: 'https://www.nj.gov/dca/codes/codreg/current.shtml',
    // Re-read 2026-09-26 (curl, Safari UA): every line still says "Aug 17,
    // 2026"; the building and one- and two-family subcodes say "NJ ed"; the
    // page says nothing about a grace period, so the note claims none.
    checkedOn: '2026-09-26',
  },
  {
    // CONNECTICUT, added 2026-09-26. Every fact below was read that day, with
    // curl and a Safari User-Agent, off the three DAS pages this row cites:
    //   - sourceUrl, the OSBI regulations page: "The 2022 Connecticut State
    //     Building Code (CSBC) is based on the International Code Council's
    //     widely-adopted 2021 International Codes … It applies to projects
    //     with permit applications filed from October 1, 2022." That page
    //     never names a single code family, which is why every claim cites
    //     the next document instead.
    //   - the code itself, 2022-CSBC-Final.pdf through `pdftotext -layout`.
    //     Its Introduction: "the following national model codes, as amended
    //     herein, are adopted and shall be known as the 2022 Connecticut State
    //     Building Code: 2021 International Building Code … 2021 International
    //     Existing Building Code … 2021 International Energy Conservation Code
    //     … 2020 NFPA 70, National Electrical Code … 2021 International
    //     Residential Code" (plus the IPC, IMC and ISPSC, which are not
    //     CodeFamily entries here, and ICC A117.1-2017).
    //   - noteSourceUrl, the code-adoption-process page: the next codes "were
    //     expected to take effect on July 1, 2026, but at this time, we await
    //     approval of the next codes by the Legislative Regulation Review
    //     Committee … and therefore the effective date has been delayed", and
    //     it lists the 2024 I-Codes and the "2023 NFPA 70 National Electrical
    //     Code" as the anticipated basis. A secondary source reports the
    //     committee rejected the package; DAS does not say so, so neither does
    //     this row.
    // THE TWO LINKS ARE CONNECTICUT'S OWN VOLUMES, NOT THE MODEL BOOKS. ICC
    // publishes the CT portions as single named volumes — measured 2026-09-26
    // (curl, Safari UA): CTBC2022P1 → 200 "2022 Connecticut State Building
    // Code - 2021 IBC Portion", CTRC2022P1 → 200 "… - 2021 IRC Portion" — so
    // the entry's name IS the book's name and rule 3 is satisfied. The energy
    // and existing-building entries carry no link: no CT volume for them was
    // fetched, and the model volume would be the wrong book under this chip.
    //
    // NO LOCAL ROW, AND NEVER A COUNTY KEY. OSBI "maintains a list of Building
    // Officials who are appointed to a local jurisdiction … in alphabetical
    // order by the name of the municipality" (read 2026-09-26 at
    // https://portal.ct.gov/das/oedm/list-of-local-building-officials), and
    // the Census geocoder no longer returns a Connecticut county at all:
    // queried 2026-09-26 for 888 Washington Blvd, Stamford, CT 06901 it
    // answered Counties "Western Connecticut Planning Region", County
    // Subdivisions "Stamford town". So any future Connecticut local row keys on
    // `matchCity` (the town); validate-code-jurisdiction.ts fails a CT row that
    // carries `matchCounty`.
    state: 'CT',
    stateName: 'Connecticut',
    authorityName: 'Connecticut Department of Administrative Services, Office of the State Building Inspector',
    codes: [
      { family: 'IBC', edition: '2021', name: '2022 Connecticut State Building Code - 2021 IBC Portion', sourceUrl: 'https://portal.ct.gov/-/media/DAS/Office-of-State-Building-Inspector/2022-State-Codes/2022-CSBC-Final.pdf', iccVolumeId: 'CTBC2022P1', iccVolumeTitle: '2022 Connecticut State Building Code - 2021 IBC Portion' },
      { family: 'IRC', edition: '2021', name: '2022 Connecticut State Building Code - 2021 IRC Portion', sourceUrl: 'https://portal.ct.gov/-/media/DAS/Office-of-State-Building-Inspector/2022-State-Codes/2022-CSBC-Final.pdf', iccVolumeId: 'CTRC2022P1', iccVolumeTitle: '2022 Connecticut State Building Code - 2021 IRC Portion' },
      { family: 'IECC', edition: '2021', name: '2022 Connecticut State Building Code', sourceUrl: 'https://portal.ct.gov/-/media/DAS/Office-of-State-Building-Inspector/2022-State-Codes/2022-CSBC-Final.pdf' },
      { family: 'IEBC', edition: '2021', name: '2022 Connecticut State Building Code', sourceUrl: 'https://portal.ct.gov/-/media/DAS/Office-of-State-Building-Inspector/2022-State-Codes/2022-CSBC-Final.pdf' },
      { family: 'NEC', edition: '2020', sourceUrl: 'https://portal.ct.gov/-/media/DAS/Office-of-State-Building-Inspector/2022-State-Codes/2022-CSBC-Final.pdf' },
    ],
    notes: 'The 2022 Connecticut State Building Code applies to permit applications filed on or after 1 October 2022. It adopts the 2021 I-Codes and the 2020 NEC as amended by Connecticut, so the model books alone are not the code. THE NEXT CODE IS LATE: the 2026 code (2024 I-Codes, NEC 2023) was expected to take effect 1 July 2026, and DAS says its effective date is delayed pending the Legislative Regulation Review Committee — confirm which code your permit date falls under. The office to ask is the building official appointed to the town or city (DAS keeps that list by municipality), not the state.',
    noteSourceUrl: 'https://portal.ct.gov/das/office-of-state-building-inspector/building-and-fire-code-adoption-process',
    sourceUrl: 'https://portal.ct.gov/das/office-of-state-building-inspector/connecticut-state-building-code/regulations',
    checkedOn: '2026-09-26',
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
  {
    // MARYLAND, added 2026-09-28. Every fact below was read that day (curl,
    // Safari UA; the PDF through `pdftotext -layout`):
    //   - sourceUrl, the Department of Labor's matrix "Current Adopted
    //     Building-Related Codes in the State of Maryland", dated 3/18/2026:
    //     Building "2021 IBC (MBPS)", Residential "2021 IRC (MBPS)", Energy
    //     "2021 IECC (MBPS)", Existing Building "2021 IEBC (MBRC)"; Electrical
    //     (2) "State Fire Marshal 2017 NEC (State Fire Prevention Code)" and
    //     Electrical (3) "local jurisdiction (locally adopted)"; Fire
    //     Prevention "2024 NFPA 1 and 2024 NFPA 101 (not applicable to one-
    //     and two-family dwellings and buildings located in Baltimore City …)".
    //   - https://labor.maryland.gov/labor/build/buildcodes.shtml: "Each local jurisdiction in
    //     Maryland may modify these codes to suit local conditions with
    //     exception to the International Energy Conservation Code … and
    //     Maryland Accessibility Code … The Energy Code and the Accessibility
    //     Code can be made more stringent but not less by the local
    //     jurisdictions." It also says "The State has modified the IBC and the
    //     IRC", which is why the codes below carry the state's own name.
    //   - noteSourceUrl, https://labor.maryland.gov/labor/build/buildadmin.shtml: the 2021
    //     IBC, IRC, IECC, IgCC and IEBC were adopted; "The effective date is
    //     May 29, 2023. State law requires local jurisdiction to start
    //     implementing & enforcing the new requirements by May 29, 2024."
    //   - https://www.labor.maryland.gov/labor/build/buildnews.shtml: the 2024
    //     IBC, IRC and IECC update is PROPOSED — "published in the Maryland
    //     Register on June 26, 2026", comments until July 27, 2026, hearing
    //     July 16, 2026. No effective date is posted, so none is claimed.
    //   - https://labor.maryland.gov/labor/build/buildmech.shtml: "The Office
    //     of the State Fire Marshal has the authority to adopt the electrical
    //     code for the state. Certain local jurisdictions may adopt their own
    //     electrical codes."
    // A STALE STATE PAGE, NOTED SO NOBODY "FIXES" THE ROW TO IT:
    // https://labor.maryland.gov/labor/build/buildrehab.shtml still says the
    // Rehabilitation Code is the 2015 IEBC (effective April 11, 2016). The
    // dated matrix (3/18/2026) and buildadmin.shtml both say 2021; so do
    // Baltimore City's Building Code and Baltimore County's codes sheet.
    // NO FIRE OR ELECTRICAL EDITION IS CLAIMED: the matrix's 2017 NEC and
    // NFPA rows belong to the State Fire Prevention Code, which does not reach
    // one- and two-family dwellings or Baltimore City, and counties adopt
    // their own electrical code.
    state: 'MD',
    stateName: 'Maryland',
    authorityName: 'Maryland Department of Labor, Division of Labor and Industry, Building Codes Administration',
    codes: [
      { family: 'IBC', edition: '2021', name: 'Maryland Building Performance Standards' },
      { family: 'IRC', edition: '2021', name: 'Maryland Building Performance Standards' },
      { family: 'IECC', edition: '2021', name: 'Maryland Building Performance Standards' },
      { family: 'IEBC', edition: '2021', name: 'Maryland Building Rehabilitation Code' },
    ],
    notes: 'The Maryland Building Performance Standards are the 2021 IBC, IRC and IECC with state changes, in effect since 29 May 2023; every county and Baltimore City had to enforce them by 29 May 2024. Work on existing buildings follows the Maryland Building Rehabilitation Code (the 2021 IEBC with state changes). Counties and Baltimore City may amend these codes, except the energy code and the Maryland Accessibility Code, which they can make stricter but not weaker, so the local amendments matter. No statewide fire or electrical edition is claimed here. The state\'s code matrix marks the State Fire Prevention Code (2024 NFPA 1 and NFPA 101) "not applicable to one- and two-family dwellings and buildings located in Baltimore City", and local governments may adopt their own electrical code. A move to the 2024 IBC, IRC and IECC was published as a proposal in the Maryland Register on 26 June 2026, and the department\'s page posted no effective date when MAGE checked it on 28 September 2026, so ask the county which edition your permit date falls under.',
    // noteSourceUrl names the page behind the note's first, dated facts (the
    // 2021 codes, 29 May 2023, 29 May 2024). The note's other facts each sit
    // on their own page (quoted above): the local-amendment rule on
    // buildcodes.shtml, the fire-code scope on the matrix (sourceUrl), the
    // electrical rule on buildmech.shtml, and the 26 June 2026 proposal on
    // buildnews.shtml. buildcodes.shtml carries none of the dates.
    noteSourceUrl: 'https://labor.maryland.gov/labor/build/buildadmin.shtml',
    sourceUrl: 'https://labor.maryland.gov/labor/build/buildcodematrix.pdf',
    checkedOn: '2026-09-28',
  },
];

// ─────────────────────────────────────────────────────────────────────
// BALTIMORE ZIPs — which government a ZIP places an address in.
//
// SOURCE (fetched 2026-09-28): the Census Bureau's 2020 ZCTA-to-county
// relationship file,
//   https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt
// METHOD: every ZCTA with a row for county 24510 (Baltimore city) or 24005
// (Baltimore County). A ZCTA is WHOLLY in one of them when it has exactly one
// county row and that row's AREALAND_PART equals AREALAND_ZCTA5_20 (all of
// its land). Every other one is split, and is listed below with the county
// GEOIDs it touches. (No split ZCTA here has a zero-land part, so "one county
// row" and "all its land in one county" agree for every ZCTA in this list.)
//
// A ZCTA APPROXIMATES A USPS ZIP; it is not the same thing. The Postal
// Service can put an address in a ZIP whose Census tabulation area it sits
// just outside of. That is why only WHOLLY-inside ZIPs decide anything, why a
// county on the address always outranks a ZIP, and why a split ZIP decides
// nothing: it falls through to the Maryland row.
//
// SO THE ZCTA TEST ALONE IS NOT ENOUGH. A ZIP is WHOLLY in one government
// only when BOTH hold:
//   1. its Census ZCTA passes the test above; and
//   2. neither government's own address-point layer uses that ZIP on the
//      other side of the line. Checked 2026-09-28 by grouping every point by
//      ZIP:
//        City   https://baltegis.baltimorecity.gov/mapping/rest/services/Address_Points/AddressPoint_Native/FeatureServer/0
//               (279,299 points, 37 zip_code values): no City point uses any
//               ZIP in the County list below.
//        County https://bcgisdata.baltimorecountymd.gov/arcgis/rest/services/Facilities/Address/MapServer/0
//               (57 ZIP values): exactly one City-only ZCTA is used by County
//               points — 21230, 10 points, all CITY_POSTAL 'BALTIMORE', on
//               Patapsco Ave and Marmenco Ct (the Census geocoder puts a
//               sampled one, -76.6597,39.2545, in Baltimore County 24005).
//   21230 therefore fails rule 2 and is listed as SPLIT below, not City-only.
// WHAT RULE 2 DOES NOT SEE: address points of the OTHER neighbouring counties
// (Anne Arundel, Carroll, Harford, Howard). Maryland's statewide address
// service (geodata.md.gov) answered with a "Site Maintenance" page on
// 2026-09-28, so that was NOT checked. A county on the address still outranks
// the ZIP, which is the guard for that case.
// ─────────────────────────────────────────────────────────────────────

/** ZIPs lying wholly in Baltimore City (24510): both rules above. */
const BALTIMORE_CITY_ZCTAS: readonly string[] = [
  '21201', '21202', '21205', '21211', '21213', '21214', '21216', '21217',
  '21218', '21223', '21231', '21233', '21251', '21287',
];

/** ZIPs lying wholly in Baltimore County (24005): both rules above. */
const BALTIMORE_COUNTY_ZCTAS: readonly string[] = [
  '21023', '21030', '21031', '21051', '21052', '21053', '21057', '21071',
  '21093', '21105', '21117', '21120', '21128', '21131', '21133', '21152',
  '21153', '21156', '21162', '21204', '21219', '21220', '21221', '21244',
  '21250', '21252', '21285', '21286',
];

/**
 * ZIPs partly in Baltimore City or Baltimore County, each with the county
 * GEOIDs it touches (24510 Baltimore city, 24005 Baltimore County, 24003
 * Anne Arundel, 24013 Carroll, 24025 Harford, 24027 Howard). They never match
 * a row; each one sets localAmbiguity on the Maryland answer when nothing
 * else decides (see localAmbiguityFor). 31 come straight from the Census
 * file. 21230 is the 32nd: its ZCTA is wholly in the City, but Baltimore
 * County's own address points use it (rule 2 above), so it is split here.
 */
export const BALTIMORE_SPLIT_ZCTAS: Readonly<Record<string, readonly string[]>> = {
  '21013': ['24005', '24025'], '21043': ['24005', '24027'], '21074': ['24005', '24013'],
  '21082': ['24005', '24025'], '21085': ['24005', '24025'], '21087': ['24005', '24025'],
  '21102': ['24005', '24013'], '21104': ['24005', '24013', '24027'], '21111': ['24005', '24025'],
  '21136': ['24005', '24013'], '21155': ['24005', '24013'], '21161': ['24005', '24025'],
  '21163': ['24005', '24027'], '21206': ['24005', '24510'], '21207': ['24005', '24510'],
  '21208': ['24005', '24510'], '21209': ['24005', '24510'], '21210': ['24005', '24510'],
  '21212': ['24005', '24510'], '21215': ['24005', '24510'], '21222': ['24005', '24510'],
  '21224': ['24005', '24510'], '21225': ['24003', '24510'], '21226': ['24003', '24510'],
  '21227': ['24005', '24510'], '21228': ['24005', '24510'], '21229': ['24005', '24510'],
  // Census ZCTA wholly City; County address points use the USPS ZIP (rule 2).
  '21230': ['24005', '24510'],
  '21234': ['24005', '24510'], '21236': ['24005', '24510'], '21237': ['24005', '24510'],
  '21239': ['24005', '24510'],
};

export const LOCAL_ADOPTIONS: readonly LocalAdoption[] = [
  {
    name: 'New York City',
    state: 'NY',
    // All five boroughs are NYC and answer to the same DOB. The screen's own
    // placeholder says "Brooklyn, NY", so borough names have to resolve.
    //
    // THE POSTAL CITIES, AND WHY QUEENS NEEDED THEM. Mail in Queens is not
    // addressed to "Queens": the Postal Service names each Queens ZIP after its
    // old village, so a job the contractor saved as "Astoria, NY" or "Long
    // Island City, NY" carried no borough, no county, and resolved to the NEW
    // YORK STATE row — the Uniform Code instead of the NYC Construction Codes,
    // no DOB department card, and no building record (isNycJobsite reads this
    // same resolver). Manhattan, Brooklyn, the Bronx and Staten Island use the
    // borough names already listed above.
    //
    // WHERE THE LIST CAME FROM (fetched 2026-09-26, not recalled): New York
    // State's own address-point file, SAM Address Points, whose `ZipName` field
    // is the postal community name of every addressed building in the state —
    //   https://gisservices.its.ny.gov/arcgis/rest/services/SAM_Address_Points/MapServer/0
    //   (statistics query: count by ZipName, CountyName, first for the five NYC
    //   counties, then for every one of the names found, statewide).
    // A name is here only when BOTH hold:
    //   1. at least 99% of that name's address points statewide lie in the five
    //      NYC counties (New York, Kings, Queens, Bronx, Richmond); and
    //   2. no city, town or village OUTSIDE New York City carries that name in
    //      NYS Civil Boundaries (layers 6 and 7 of
    //      https://gisservices.its.ny.gov/arcgis/rest/services/NYS_Civil_Boundaries/FeatureServer).
    // THREE QUEENS POSTAL NAMES FAIL AND ARE DELIBERATELY ABSENT: Floral Park
    // (1,201 Queens points, 8,000 Nassau) and New Hyde Park (756 Queens, 14,328
    // Nassau) are mostly Nassau and are incorporated Nassau villages; Bellerose
    // is 99.6% Queens but is ALSO the Incorporated Village of Bellerose in
    // Nassau, and a contractor there types exactly that. Those three keep
    // resolving to the state row, which is the honest answer for an address
    // this table cannot place. The near-misses that pass rule 1 — Far Rockaway
    // (15 Nassau points of 8,944), Queens Village (4 of 16,295), Rosedale (2 of
    // 6,812) — are border-line address points, not a Nassau community; and an
    // address that names Nassau as its county never takes a postal name here
    // (resolveCodeJurisdiction checks the county before a postalCity wins).
    //
    // NO ZIP RULE, ON PURPOSE. The 110xx prefix is split between Queens and
    // Nassau — the same file, counted by ZipCode: 11004 is all Queens, 11001
    // and 11040 straddle the county line, and 11003, 11010, 11020, 11021,
    // 11023, 11024, 11030, 11042, 11050 and 11096 are all Nassau — so a prefix shortcut
    // would send Nassau jobs to the DOB.
    //
    // 'st albans' is the only entry not spelled exactly as SAM spells it: it is
    // "Saint Albans" abbreviated the way the address is usually written, and
    // normalizePlace strips the period but cannot expand the word.
    //
    // THEY ARE `postalCity`, NOT `matchCity`. matchCity is also read by
    // permitInspectionFacts as the names of the PERMIT OFFICE, word-set style
    // with "city"/"village" dropped; there "long island city" matched "Town of
    // Huntington, Long Island" and folded Long Island town permits into the
    // DOB's inspection record (review 2026-09-26). postalCity is read only by
    // resolveCodeJurisdiction, on an address's city, by whole name.
    matchCity: [
      'new york', 'new york city', 'nyc', 'manhattan', 'brooklyn',
      'queens', 'the bronx', 'bronx', 'staten island',
    ],
    postalCity: [
      'brooklyn navy yard',
      // Queens postal cities (SAM ZipName, rules 1 and 2 above).
      'arverne', 'astoria', 'bayside', 'breezy point', 'cambria heights',
      'college point', 'corona', 'east elmhurst', 'elmhurst', 'far rockaway',
      'flushing', 'forest hills', 'fresh meadows', 'glen oaks', 'hollis',
      'howard beach', 'jackson heights', 'jamaica', 'kew gardens', 'little neck',
      'long island city', 'maspeth', 'middle village', 'oakland gardens',
      'ozone park', 'queens village', 'rego park', 'richmond hill', 'ridgewood',
      'rockaway park', 'rosedale', 'saint albans', 'st albans',
      'south ozone park', 'south richmond hill', 'springfield gardens',
      'sunnyside', 'whitestone', 'woodhaven', 'woodside',
    ],
    matchCounty: ['new york', 'kings', 'queens', 'bronx', 'richmond'],
    authorityName: 'New York City Department of Buildings',
    codes: [
      { family: 'LOCAL', edition: '2022', name: 'NYC Construction Codes' },
    ],
    notes: 'New York City writes and enforces its own Construction Codes rather than the state code; the 2022 Construction Codes took effect 7 November 2022.',
    sourceUrl: 'https://www.nyc.gov/site/buildings/codes/2022-construction-codes.page',
    checkedOn: '2026-09-07',
    // Every fact below was read off the nyc.gov page its channel links to on
    // 2026-09-26. a810-* hosts answer 403 to scripts (Akamai), so those are
    // LINKED exactly as nyc.gov links them and nothing is claimed about what
    // they say. Fees are links only: MAGE never computes a DOB fee.
    department: {
      // nyc.gov's own "Login to DOB NOW" link (using-dob-now.page).
      portalUrl: 'https://a810-dobnow.nyc.gov/publish/#/',
      statusLookupUrl: 'https://www.nyc.gov/site/buildings/industry/dob-now-public-portal.page',
      phone: '212-393-2550',
      hours: 'Borough offices: in person 8:30 am to 4:00 pm; phone lines 8:30 am to 4:30 pm, Monday to Friday.',
      afterHours: 'Buildings After Hours: borough offices open the first and third Tuesday of the month, 4:00 pm to 7:00 pm.',
      questionChannels: [
        {
          stage: 'pre_filing',
          label: 'Pre-Determination Request',
          url: 'https://www.nyc.gov/site/buildings/industry/determinations.page',
          note: 'For a possible objection on a job not yet filed. Submitted in DOB NOW under +Determinations by a registered architect or professional engineer (or another professional DOB lists).',
        },
        {
          stage: 'pre_filing',
          label: 'Development HUB (New Building and Alt-1 projects)',
          url: 'https://www.nyc.gov/site/buildings/industry/the-hub.page',
          phone: '212-393-2850',
          email: 'nycdevelopmenthub@buildings.nyc.gov',
          note: 'Request a HUB consultation to file a New Building or Alteration Type-1 job at the Development HUB.',
        },
        {
          stage: 'in_review',
          label: 'Plan Examination Appointment',
          url: 'https://a810-dobnow.nyc.gov/Publish/Appointments/index.html#/',
          note: 'For standard plan review BIS filings. The applicant needs a DOB ID number and PIN plus the BIS job and document numbers.',
        },
        {
          stage: 'objection',
          label: 'Second Review of Objection, Then a CCD1/ZRD1 Determination',
          url: 'https://www.nyc.gov/site/buildings/industry/determinations.page',
          note: 'On a DOB NOW job, open the filing and choose Second Review of Objection under Select Action. A CCD1 or ZRD1 determination request goes in under +Determinations.',
        },
        {
          stage: 'inspection',
          label: 'DOB NOW: Inspections',
          url: 'https://www.nyc.gov/site/buildings/industry/dob-now-inspection.page',
          note: 'Most DOB inspections are scheduled online in DOB NOW: Inspections.',
        },
        {
          stage: 'general',
          label: 'DOB Customer Service and Online Help',
          url: 'https://www.nyc.gov/dobhelp',
          phone: '212-393-2550',
          note: 'Customer service line, or the online help form at nyc.gov/dobhelp.',
        },
      ],
      feeScheduleUrls: [
        { label: 'New Permit Fee Structure (PDF)', url: 'https://www.nyc.gov/assets/buildings/pdf/new_permit_fee_structure.pdf' },
        { label: 'Alteration Filing Fees (PDF)', url: 'https://www.nyc.gov/assets/buildings/pdf/alteration_filing_fees.pdf' },
      ],
      applicantOfRecordNote: 'In NYC the registered architect or engineer (or their expeditor) is usually the applicant of record and the one who talks to the plan examiner — not the GC.',
      sourceUrl: 'https://www.nyc.gov/site/buildings/dob/contact-us.page',
      checkedOn: '2026-09-26',
    },
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
      { family: 'IBC', edition: '2021', iccVolumeId: 'IBC2021P1', iccVolumeTitle: '2021 International Building Code (IBC)' },
      { family: 'IRC', edition: '2021', iccVolumeId: 'IRC2021P1', iccVolumeTitle: '2021 International Residential Code (IRC)' },
      { family: 'IECC', edition: '2021', iccVolumeId: 'IECC2021P1', iccVolumeTitle: '2021 International Energy Conservation Code (IECC)' },
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
      { family: 'IECC', edition: '2021', iccVolumeId: 'IECC2021P1', iccVolumeTitle: '2021 International Energy Conservation Code (IECC)' },
      { family: 'IEBC', edition: '2021', iccVolumeId: 'IEBC2021P1', iccVolumeTitle: '2021 International Existing Building Code (IEBC)' },
      { family: 'IFC', edition: '2021', iccVolumeId: 'IFC2021P1', iccVolumeTitle: '2021 International Fire Code (IFC)' },
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
      { family: 'IECC', edition: '2024', iccVolumeId: 'IECC2024P1', iccVolumeTitle: '2024 International Energy Conservation Code (IECC)' },
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
      { family: 'IECC', edition: '2021', iccVolumeId: 'IECC2021P1', iccVolumeTitle: '2021 International Energy Conservation Code (IECC)' },
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
      // No volume id — the same umbrella problem as the Florida state row
      // above, verified the same way on 2026-09-13.
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
      { family: 'IFC', edition: '2024', sourceUrl: 'https://www.austintexas.gov/fire/fire-building-code', iccVolumeId: 'IFC2024P1', iccVolumeTitle: '2024 International Fire Code (IFC)' },
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
      { family: 'IBC', edition: '2024', iccVolumeId: 'IBC2024P1', iccVolumeTitle: '2024 International Building Code (IBC)' },
      { family: 'IRC', edition: '2024', iccVolumeId: 'IRC2024P1', iccVolumeTitle: '2024 International Residential Code (IRC)' },
      { family: 'IEBC', edition: '2024', iccVolumeId: 'IEBC2024P1', iccVolumeTitle: '2024 International Existing Building Code (IEBC)' },
      { family: 'IECC', edition: '2021', iccVolumeId: 'IECC2021P1', iccVolumeTitle: '2021 International Energy Conservation Code (IECC)' },
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
      { family: 'IBC', edition: '2021', iccVolumeId: 'IBC2021P1', iccVolumeTitle: '2021 International Building Code (IBC)' },
      { family: 'IRC', edition: '2021', iccVolumeId: 'IRC2021P1', iccVolumeTitle: '2021 International Residential Code (IRC)' },
      { family: 'IEBC', edition: '2021', iccVolumeId: 'IEBC2021P1', iccVolumeTitle: '2021 International Existing Building Code (IEBC)' },
      { family: 'IECC', edition: '2021', iccVolumeId: 'IECC2021P1', iccVolumeTitle: '2021 International Energy Conservation Code (IECC)' },
      { family: 'IFC', edition: '2021', iccVolumeId: 'IFC2021P1', iccVolumeTitle: '2021 International Fire Code (IFC)' },
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
  {
    // BALTIMORE CITY, added 2026-09-28. Every fact read that day (curl,
    // Safari UA; PDFs through `pdftotext -layout`) off these pages:
    //   - sourceUrl, the City Law Library's "Building, Fire, and Related Codes
    //     2024 Edition" index. Its introductory note lists the codes "as
    //     supplemented, amended, or otherwise modified by the Mayor and City
    //     Council of Baltimore": "International Building Code / 2021",
    //     "National Electrical Code / 2020", "International Fuel Gas Code /
    //     2021", "International Mechanical Code / 2021", "International
    //     Plumbing Code / 2021", "International Fire Code / 2021",
    //     "International Energy Conservation Code / 2021", "International
    //     Residential Code, 1- and 2- Family Dwellings / 2021" (plus the
    //     IPMC, IgCC and ISPSC, which are not CodeFamily entries). Its
    //     Transitions note: "Ordinance 24-341 became effective May 22, 2024",
    //     applying "to all building operations for which a permit application
    //     is filed on or after the effective date". The Law Library's code
    //     page, https://codes.baltimorecity.gov/us/md/cities/baltimore/code
    //     (not the site root), says "Current through July 17, 2026", last
    //     codified Ord. 26-129.
    //   - Part II (the Building Code), full text, .../building-codes/II/
    //     index.full.html: "Existing buildings undergoing repair, alterations,
    //     or additions, and change of occupancy must comply with the Maryland
    //     Building Rehabilitation Code, set forth in COMAR 09.12.58. {Note: The
    //     Maryland Building Rehabilitation Code comprises the 2021
    //     International Existing Building Code, with State modifications.}"
    //     § 105.1.3 (who applies), § 109 fees, § 109.7 the 5% Building Code
    //     Permit Tax (amended by Ord. 24-437, effective December 2, 2024, per
    //     .../ordinances/2024/24-437), § 1511.9 rooftop decks.
    //   - Part X (the IRC), full text: R302.1.1 porch roofs, R311.7.5.1-.2
    //     riser 8¼ in. and tread 9 in., R312.1.3 no horizontal rails or ladder
    //     effect, R313.1 sprinklers in any new townhouse or 1- or 2-family
    //     dwelling, R301.2.4 floodplain "{Not Adopted}" with a pointer to City
    //     Code Article 7, and R911.1 sending rooftop structures to Building
    //     Code "§ 1510". Part II has "Sections 1505 to 1510. {As in IBC}" and
    //     puts rooftop decks in § 1511.9, so R911.1's "§ 1510" looks like a
    //     cross-reference slip; the note cites § 1511.9.
    //   - DHCD's building-permits page (updated 09/04/2026): "renovations,
    //     modifications, and reconstructions always need a permit"; 1- and
    //     2-family work "Requires a Maryland Home Improvement License (MHIC)
    //     contractor"; its linked "Work Exempt From Permit" list (REV 09/24),
    //     https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2026-03/Work%20Exempt%20From%20Permit.pdf,
    //     does not list fences, decks or retaining walls.
    //   - DHCD's special-referrals page (updated 07/27/2026) and CHAP's
    //     review procedures (updated 09/16/2026): exterior work in a CHAP
    //     district or on a landmark goes through CHAP, and a permit filed
    //     first is held until CHAP issues an Authorization to Proceed.
    //   - https://www.baltimoresustainability.org/floodplain-management-program/ :
    //     "the regulated floodplain includes the 1% and 0.2% annual-chance
    //     flood areas"; the City's floodplain code "supersedes both State and
    //     Federal floodplain regulations".
    // NO 2024 CITY ADOPTION FOUND: the Law Library's 2025 and 2026 ordinance
    // lists (read 2026-09-28, codified through July 17, 2026) show no
    // ordinance adopting new I-Code editions, so the state's proposed 2024
    // codes are not claimed here either.
    //
    // MATCHING. matchCounty 'baltimore city' is the Census name for 24510
    // ("Baltimore city"; the resolver strips only a trailing " county").
    // matchCity 'baltimore city' is what a contractor types for the City.
    // NEVER 'baltimore' in matchCity or postalCity: Baltimore County uses that
    // postal name for 20,870 address points (see the MARYLAND block above).
    name: 'Baltimore City',
    state: 'MD',
    matchCity: ['baltimore city'],
    matchCounty: ['baltimore city'],
    postalZip: BALTIMORE_CITY_ZCTAS,
    authorityName: 'Baltimore City Department of Housing & Community Development (DHCD), Permits and Inspections',
    codes: [
      { family: 'IBC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IRC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IECC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IFC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IPC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IMC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IFGC', edition: '2021', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'NEC', edition: '2020', name: 'Baltimore City Building, Fire, and Related Codes, 2024 Edition' },
      { family: 'IEBC', edition: '2021', name: 'Maryland Building Rehabilitation Code', sourceUrl: 'https://codes.baltimorecity.gov/us/md/cities/baltimore/code/building-codes/II/index.full.html' },
    ],
    notes: 'Baltimore City and Baltimore County are separate governments with different codes; a "Baltimore, MD" mailing address can be in either. The City\'s 2024 Edition (Ordinance 24-341) applies to permit applications filed on or after 22 May 2024. The fire code is the 2021 IFC (Part VIII), not the NFPA 1 and 101 used by the state and by Baltimore County, and the electrical code is the 2020 NEC (Part III). Local IRC changes: risers 8¼ in. maximum and treads 9 in. minimum; fire-retardant-treated sheathing on a new or replaced porch roof that abuts another porch roof; guards may not use horizontal rails or a ladder pattern; sprinklers in every new townhouse and 1- or 2-family dwelling; the IRC\'s flood sections (R301.2.4, R309.3 and R322) are not adopted and the City\'s floodplain code (City Code Article 7) applies instead, covering the 0.2% annual-chance flood area as well as the 1% area; rooftop decks follow Building Code § 1511.9. Work on existing buildings follows the Maryland Building Rehabilitation Code. Renovations, modifications and reconstructions always need a permit; DHCD\'s "Work Exempt From Permit" list (REV 09/24) is short and does not include fences, decks or retaining walls. A permit to remove formstone, paint or other material from exterior surfaces, or for underpinning or a retaining foundation wall, must be applied for by the licensed contractor doing the work (Building Code § 105.1.3), and work on 1- and 2-family dwellings needs an MHIC-licensed contractor. In a CHAP historic district or on a landmark, exterior work generally needs CHAP approval before the permit issues. Permit fees are set in Building Code § 109, plus a 5% permit tax (§ 109.7). No City ordinance adopting the 2024 codes was found in the City\'s codified ordinances through 17 July 2026.',
    noteSourceUrl: 'https://codes.baltimorecity.gov/us/md/cities/baltimore/code/building-codes/X/index.full.html',
    sourceUrl: 'https://codes.baltimorecity.gov/us/md/cities/baltimore/code/building-codes',
    checkedOn: '2026-09-28',
    // Every fact below read 2026-09-28 off the page its channel links to, or
    // off the E-Permits Expanded Customer Support Guide (rev. June 17, 2025),
    // https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2025-09/E-Permits%20Portal%20Expanded%20Customer%20Support%20Guide%20(1).pdf .
    // Only department mailboxes are used; the guide also lists staff members'
    // personal addresses, and none of them is copied here.
    // TWO CONFLICTS, SHOWN RATHER THAN PICKED:
    //   - Hours. The permits-and-inspections page (updated 08/01/2026) says
    //     Permits and Plans Review in person "Monday - Tuesday - Thursday -
    //     Friday - 8:30 am - 3:30 pm ( No In-Person Assistance on Wednesdays
    //     )"; the E-Permits Help Center (updated 07/27/2026) lists the kiosk
    //     "Monday - Friday, 8:30 AM - 3:30 PM". Both are named in `hours`.
    //   - CHAP's phone. The special-referrals page prints 410-396-4866; CHAP's
    //     own page and the E-Permits guide both print (410) 396-7526. The
    //     number two official sources agree on is used.
    // Left out on purpose: the 3-1-1 / (443) 263-2220 lines in the City
    // website's footer (a City-wide line, not a DHCD channel) and the Zoning
    // office's room (two City pages disagree).
    department: {
      portalUrl: 'https://aca-prod.accela.com/BALTIMORE/Default.aspx',
      portalLabel: 'E-Permits portal',
      // "No, you do not need to create an account to search permit or license
      // registration information in E-Permits." (E-Permits Help Center)
      statusLookupUrl: 'https://aca-prod.accela.com/BALTIMORE/Default.aspx',
      phone: '443-984-1809',
      email: 'DHCD.Permits@baltimorecity.gov',
      hours: 'Permits and Plans Review, in person at the One Stop Shop, 417 E. Fayette Street, Room 100: Monday, Tuesday, Thursday and Friday, 8:30 am to 3:30 pm, with no in-person help on Wednesdays. The E-Permits Help Center lists the kiosk as open Monday to Friday, so call ahead.',
      afterHours: 'E-Permits is open 24 hours a day, 7 days a week, and inspections can be scheduled online at any hour.',
      questionChannels: [
        {
          stage: 'pre_filing',
          label: 'DHCD Permits Office',
          url: 'https://www.baltimorecity.gov/dhcd/our-work/permits-inspections/building-permits',
          phone: '443-984-1809',
          email: 'DHCD.Permits@baltimorecity.gov',
          note: 'Questions before you file. Applications are made online in E-Permits; you can also apply at the One Stop Shop kiosk.',
        },
        {
          stage: 'pre_filing',
          label: 'Work exempt from permit (DHCD list, REV 09/24)',
          url: 'https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2026-03/Work%20Exempt%20From%20Permit.pdf',
          note: 'Check this list before you skip a permit. Fences, decks and retaining walls are not on it, and renovations, modifications and reconstructions always need a permit.',
        },
        {
          stage: 'in_review',
          label: 'DHCD Plans Review',
          url: 'https://www.baltimorecity.gov/dhcd/our-work/permits-inspections/building-permits',
          phone: '410-396-3460',
          email: 'DHCD.PlansReview@baltimorecity.gov',
          note: 'Questions on an application in plan review. Plans are uploaded through ProjectDox once staff send instructions.',
        },
        {
          stage: 'objection',
          label: 'Plans Review, then the Board of Municipal and Zoning Appeals',
          url: 'https://s3.amazonaws.com/baltimorecity.gov.if-us-east-1/s3fs-public/2025-09/E-Permits%20Portal%20Expanded%20Customer%20Support%20Guide%20(1).pdf',
          phone: '410-396-3460',
          email: 'DHCD.PlansReview@baltimorecity.gov',
          note: 'Take a review comment to Plans Review first. Permit appeals go to the Board of Municipal and Zoning Appeals (BMZA), 410-396-4301.',
        },
        {
          stage: 'inspection',
          label: 'DHCD Building Inspections',
          url: 'https://www.baltimorecity.gov/dhcd/our-work/permits-and-inspections/inspection-scheduling',
          phone: '410-396-3470',
          email: 'DHCD.ConstructionInspection@baltimorecity.gov',
          note: 'Schedule, cancel or reschedule inspections in E-Permits under "Schedule an Inspection". Every permit needs a final inspection before a Certificate of Occupancy is issued.',
        },
        {
          stage: 'general',
          label: 'Zoning Office',
          phone: '410-396-4126',
          note: 'Zoning questions and zoning verification.',
        },
        {
          stage: 'general',
          label: 'CHAP (Historic Districts and Landmarks)',
          url: 'https://chap.baltimorecity.gov/review-procedures',
          phone: '410-396-7526',
          note: 'Exterior work in a CHAP district or on a landmark goes through CHAP. A permit filed first is held until CHAP issues an Authorization to Proceed.',
        },
        {
          stage: 'general',
          label: 'Department of Planning',
          phone: '410-396-7526',
          email: 'deptofplanning@baltimorecity.gov',
          note: 'Floodplain, Critical Area, design review and forest conservation reviews. The City regulates both the 1% and the 0.2% annual-chance flood areas.',
        },
        {
          stage: 'general',
          label: 'Fire Marshal Plans Review (Baltimore City Fire Department)',
          phone: '410-396-5752',
          email: 'BCFD.Plans@baltimorecity.gov',
          note: 'Fire protection plans review and system acceptance.',
        },
      ],
      feeScheduleUrls: [
        { label: 'Permit fees, Building Code § 109 (plus a 5% permit tax)', url: 'https://codes.baltimorecity.gov/us/md/cities/baltimore/code/building-codes/II/109' },
      ],
      applicantOfRecordNote: 'In Baltimore City the owner, the lessee, their agent, or the licensed engineer or architect applies for most permits. A permit to remove formstone, paint or other material from exterior surfaces, or for underpinning or a retaining foundation wall, must be applied for by the licensed contractor doing the work (Building Code § 105.1.3).',
      sourceUrl: 'https://www.baltimorecity.gov/dhcd/our-work/permits-and-inspections',
      sourceLabel: 'baltimorecity.gov',
      checkedOn: '2026-09-28',
    },
  },
  {
    // BALTIMORE COUNTY, added 2026-09-28. Every fact read that day (curl,
    // Safari UA; bun's fetch also got HTTP 200 from baltimorecountymd.gov that
    // day, although earlier research recorded 403s):
    //   - sourceUrl, PAI's sheet "Current Building and Fire Codes in Effect"
    //     (PAI PR1w, Rev 08/25/26): "Building Code - 2021 International
    //     Building Code – adopted/amended by Baltimore County Bill #49-24
    //     (Effective date: September 3, 2024)"; the same bill and date for
    //     the 2021 IRC, the 2021 IMC and the "2021 International Energy Code";
    //     "Plumbing Code - 2021 International Plumbing Code adopted/amended by
    //     Baltimore County Bill #94-23 (Effective date: July 1, 2024)";
    //     "Electrical Code - 2026 NEC – Effective September 1, 2026"; "Life
    //     Safety Code - 2018 NFPA 101" and "Fire Prevention Code – 2018
    //     Edition NFPA 1", both "Baltimore County Bill #14-21 (Effective date:
    //     April 18, 2021)"; "Rehab Code – COMAR 09.12.58 Maryland Building
    //     Rehabilitation Code. (2021 International Existing Building Code)";
    //     floodplain "Baltimore County Bill #6-24, effective May 6, 2024";
    //     and its phone list.
    //   - noteSourceUrl, PAI's "Current Codes and Regulations" page: "Per
    //     Section 21-7-303 of the Baltimore County Code, 2015, electrical
    //     installations shall conform to most recent edition year of the
    //     published National Electric Code (NEC, effective September 1 of the
    //     edition year of the code)." THAT PAGE IS STALE ON ONE LINE: it still
    //     calls the Rehabilitation Code the 2015 IEBC (effective April 11,
    //     2016). The newer sheet says 2021, and the row follows the sheet.
    //   - /departments/pai: County Office Building, 111 West Chesapeake
    //     Avenue, Towson; Monday through Friday 8:30 a.m. to 4:30 p.m.;
    //     410-887-3353. /departments/pai/permit-processing: Room 100,
    //     paipermitstatus@baltimorecountymd.gov, 410-887-3900; "All
    //     applications for building, plumbing, electrical and other
    //     construction permits must be completed online." /departments/pai/
    //     application: the portal link and "Permits are valid for one year
    //     with an option to request one additional year at the time the
    //     application is filed." /departments/pai/building-inspections: Room
    //     G-24, 7:30 a.m. to 3:30 p.m., 410-887-3953, "call 410-887-3953 on the
    //     morning of the inspection between 7:30 and 8 a.m.", and the local
    //     design requirements quoted in the note.
    // CONFLICTS, SHOWN RATHER THAN PICKED:
    //   - Plans Review's phone: 410-887-3985 on the codes page, 410-887-3987
    //     on the Rev 08/25/26 sheet. The channel carries the email and names
    //     both numbers with where each is printed.
    //   - When to ask for the second permit year: "at the time the
    //     application is filed" (application page) vs "Request to extend must
    //     be submitted prior to the expiration of the permit" (the building
    //     fee schedule effective 07/01/26). The note names both.
    //   - The 2021 Rehabilitation Code's effective date: March 29, 2023 on the
    //     County sheet, May 29, 2023 on the state's page. No date is claimed.
    // Staff names and a staff email appear on these pages; none is copied.
    //
    // MATCHING. matchCounty 'baltimore' is the Census "Baltimore County"
    // after the resolver strips " county". NEVER matchCity 'baltimore' (see
    // the MARYLAND block). postalCity: the County's own address points
    // (Facilities/Address/MapServer/0, 296,513 points, grouped by CITY_POSTAL
    // and ZIP on 2026-09-28) keep a postal name here only when EVERY ZIP it is
    // used with is a ZCTA lying wholly in Baltimore County (the list above).
    // That keeps out names that cross a line (Catonsville 21228, Dundalk
    // 21222, Parkville 21234, Pikesville 21208, Reisterstown 21136, Rosedale
    // 21237, Nottingham 21236, Halethorpe 21227, Gwynn Oak 21207 …) and
    // BALTIMORE itself. The method only sees Baltimore County's own points, so
    // it cannot see a same-named community in another county; a county on the
    // address still outranks the name.
    name: 'Baltimore County',
    state: 'MD',
    matchCounty: ['baltimore'],
    postalCity: [
      'cockeysville', 'essex', 'fork', 'fort howard', 'freeland', 'glen arm',
      'glyndon', 'hunt valley', 'lutherville timonium', 'middle river',
      'owings mills', 'parkton', 'perry hall', 'phoenix', 'randallstown',
      'sparks glencoe', 'sparrows point', 'stevenson', 'towson', 'upper falls',
      'white marsh', 'windsor mill',
    ],
    postalZip: BALTIMORE_COUNTY_ZCTAS,
    authorityName: 'Baltimore County Department of Permits, Approvals and Inspections (PAI)',
    codes: [
      { family: 'IBC', edition: '2021', name: 'Baltimore County Building Code, Bill 49-24' },
      { family: 'IRC', edition: '2021', name: 'Baltimore County Building Code, Bill 49-24' },
      { family: 'IMC', edition: '2021', name: 'Baltimore County Building Code, Bill 49-24' },
      { family: 'IECC', edition: '2021', name: 'Baltimore County Building Code, Bill 49-24' },
      { family: 'IPC', edition: '2021', name: 'Baltimore County Plumbing Code, Bill 94-23' },
      { family: 'NEC', edition: '2026' },
      { family: 'IEBC', edition: '2021', name: 'Maryland Building Rehabilitation Code' },
      // NFPA is not an ICC family and has no CodeFamily of its own, so the
      // County's fire code is carried as a LOCAL entry under the name the
      // County gives it. Left out, the chip would list every other code and
      // say nothing about fire, and a contractor could assume the IFC.
      { family: 'LOCAL', edition: '2018', name: 'Fire Prevention Code (2018 NFPA 1) and Life Safety Code (2018 NFPA 101), Bill 14-21' },
    ],
    notes: 'Baltimore County and Baltimore City are separate governments with different codes; a "Baltimore, MD" mailing address can be in either. The County\'s building code (Bill 49-24, the 2021 IBC, IRC, IMC and IECC with County amendments) took effect 3 September 2024, and plumbing is the 2021 IPC under Bill 94-23 from 1 July 2024. The electrical code is the 2026 NEC from 1 September 2026: County Code § 21-7-303 puts each new NEC edition in force on 1 September of its edition year. The fire code is the 2018 NFPA 1 and NFPA 101 (Bill 14-21), not the IFC the City uses. The same County sheet also lists, under the State of Maryland, the State Fire Prevention Code (COMAR 29.06.01: the 2024 NFPA 1 and NFPA 101, effective 23 June 2025), so ask the County which edition your job is reviewed under; the sheet gives Fire Inspections as (410) 887-4880. Work on existing buildings follows the Maryland Building Rehabilitation Code (the 2021 IEBC). Floodplain rules are Bill 6-24, in effect since 6 May 2024. Local design values from the County: footings 30 in. below final grade (pole buildings 48 in.), ground snow load 30 psf, design wind speed 90 mph. All building, plumbing and electrical applications are filed online. Permits run one year with one optional added year; the application page says to ask for it when you file, and the fee schedule says to ask before the permit expires, so confirm with PAI.',
    noteSourceUrl: 'https://www.baltimorecountymd.gov/departments/pai/building-plans-review/current-codes-regulations',
    sourceUrl: 'https://www.baltimorecountymd.gov/files/departments/permits-approvals-and-inspections/documents/currentbuildingandfirecodes.pdf',
    checkedOn: '2026-09-28',
    department: {
      portalUrl: 'https://cityworkspro.baltimorecountymd.gov/PLLPortal/',
      portalLabel: 'Permits portal (PLL)',
      // The application page's "Permits Online Query Search".
      statusLookupUrl: 'https://permitreview.baltimorecountymd.gov/PermitReview',
      phone: '410-887-3353',
      email: 'paipermitstatus@baltimorecountymd.gov',
      hours: 'Monday to Friday, 8:30 am to 4:30 pm, at the County Office Building, 111 West Chesapeake Avenue, Towson. Permit Processing is in Room 100.',
      questionChannels: [
        {
          stage: 'pre_filing',
          label: 'PAI Permit Processing',
          url: 'https://www.baltimorecountymd.gov/departments/pai/permit-processing',
          phone: '410-887-3900',
          email: 'paipermitstatus@baltimorecountymd.gov',
          note: 'Questions before you file. Applications are filed online; lobby workstations and staff can help you set up an account.',
        },
        {
          stage: 'in_review',
          label: 'PAI Building Plans Review',
          url: 'https://www.baltimorecountymd.gov/departments/pai/building-plans-review/current-codes-regulations',
          email: 'paibldgrvw@baltimorecountymd.gov',
          note: 'Email first: the County lists two phone numbers for Plans Review, 410-887-3985 on its codes page and 410-887-3987 on its codes sheet (Rev 08/25/26).',
        },
        {
          stage: 'inspection',
          label: 'PAI Building Inspections',
          url: 'https://www.baltimorecountymd.gov/departments/pai/building-inspections',
          phone: '410-887-3953',
          note: 'Monday to Friday, 7:30 am to 3:30 pm. To learn the time of a scheduled inspection, call between 7:30 and 8 am that morning with your permit number.',
        },
        {
          stage: 'general',
          label: 'Zoning Office',
          phone: '410-887-3391',
          note: 'From the County codes sheet (Rev 08/25/26).',
        },
        {
          stage: 'general',
          label: 'Electrical Inspections',
          phone: '410-887-3960',
          note: 'From the County codes sheet (Rev 08/25/26).',
        },
        {
          stage: 'general',
          label: 'Plumbing Inspections',
          phone: '410-887-3620',
          note: 'From the County codes sheet (Rev 08/25/26).',
        },
        {
          stage: 'general',
          label: 'Fire Inspections',
          phone: '410-887-4880',
          note: 'From the County codes sheet (Rev 08/25/26).',
        },
      ],
      feeScheduleUrls: [
        { label: 'Building permit fees, effective 1 July 2026 (PDF)', url: 'https://www.baltimorecountymd.gov/files/departments/permits-approvals-and-inspections/documents/buildingprocessfee.pdf' },
      ],
      sourceUrl: 'https://www.baltimorecountymd.gov/departments/pai',
      sourceLabel: 'baltimorecountymd.gov',
      checkedOn: '2026-09-28',
    },
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

/**
 * The trailing five-digit US ZIP of a free-text location, or ''.
 *
 *   '620 E 31st St, Baltimore, MD 21218'      → '21218'
 *   '620 E 31st St, Baltimore, MD 21218-1234' → '21218'
 *   'Baltimore, MD'                            → ''
 *   '21218 Main St, Somewhere, MD'             → ''  (a house number is not a ZIP)
 *
 * It uses the same trailing-ZIP shape splitLocationText strips — a separator,
 * five digits, an optional +4, and the end of the string — so the two can
 * never disagree about what the ZIP of a location is. A five-digit number
 * anywhere else in the text is never read as one.
 */
export function zipFromLocationText(text: string | null | undefined): string {
  const m = /[,\s]+(\d{5})(?:-\d{4})?$/.exec((text ?? '').trim());
  return m ? m[1] : '';
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
  /**
   * The jobsite's five-digit ZIP, when the caller has one. Read only by rows
   * that carry `postalZip`, and only when the address names no county or
   * names that row's own county — a county always outranks a ZIP.
   */
  zip?: string;
}

/**
 * The resolver query for a PROJECT: every resolveCodeJurisdiction /
 * issuingAuthorityForAddress / departmentFor caller that starts from a
 * project goes through here.
 *
 * WHY IT EXISTS. jobsiteAddressForProject returns zip '' for a project that
 * only has the free-text `location` — and that is pinned (validate-code-
 * jurisdiction, "THE AI-1 PROPERTY"), so it cannot change. Most real projects
 * are location-only, so without this helper a ZIP typed into the location
 * never reached the resolver at all.
 *
 *   city / state — exactly as jobsiteAddressForProject gives them.
 *   county       — the address's own county when it has one, else
 *                  `confirmedCounty` (the side of a parcel the contractor
 *                  CONFIRMED in the building record, e.g. 'Baltimore city'),
 *                  else ''. The address's own county wins: a disagreement is
 *                  left for the contractor to fix, never resolved silently
 *                  the other way.
 *   zip          — structuredAddress.zip's first five digits, else the
 *                  trailing ZIP of `location`, else ''.
 *
 * Pure, like the rest of this module.
 */
export function jurisdictionQueryForProject(
  project: AddressableProject | null | undefined,
  confirmedCounty?: string | null,
): AddressQuery {
  const addr = jobsiteAddressForProject(project);
  const saZip = /^(\d{5})/.exec((project?.structuredAddress?.zip ?? '').trim());
  const zip = saZip ? saZip[1] : zipFromLocationText(project?.location);
  const county = addr.county || (confirmedCounty ?? '').trim();
  return { city: addr.city, county, state: addr.state, zip };
}

export type ResolvedCodeJurisdiction =
  | {
      kind: 'city';
      entry: LocalAdoption;
      /** Which key the row matched on — useful when a county answered. */
      matchedOn: 'city' | 'county' | 'zip';
      state: string;
    }
  | {
      kind: 'state';
      entry: StateAdoption;
      state: string;
      /**
       * Set only when a Maryland address could be in Baltimore City or
       * Baltimore County (or a neighbour of one of them) and nothing on it
       * decides which: the postal name "Baltimore", a ZIP from
       * BALTIMORE_SPLIT_ZCTAS, or a city field and
       * a county field naming opposite Baltimore governments. `candidates`
       * are government names, Baltimore rows first ('Baltimore City',
       * 'Baltimore County', then e.g. 'Anne Arundel County' — a name with no
       * row is one MAGE has not researched). `askFor` says what would settle
       * it: 'zip-or-county' (the address has no ZIP), 'county' (it has a ZIP
       * and the ZIP cannot decide), 'fix-address' (its fields contradict each
       * other). Absent in every other case, so every other state answer is
       * byte-for-byte what it was.
       */
      localAmbiguity?: {
        candidates: string[];
        reason: string;
        askFor?: 'zip-or-county' | 'county' | 'fix-address';
      };
    }
  | { kind: 'unknown'; reason: string };

/** Rows a Baltimore address can belong to, by `name`. */
const BALTIMORE_ROW_NAMES = ['Baltimore City', 'Baltimore County'] as const;

/**
 * The governments behind the county GEOIDs in BALTIMORE_SPLIT_ZCTAS. Names
 * from the NAMELSAD_COUNTY_20 column of the same Census file (fetched
 * 2026-09-28: 24003 "Anne Arundel County", 24005 "Baltimore County", 24013
 * "Carroll County", 24025 "Harford County", 24027 "Howard County", 24510
 * "Baltimore city" — written 'Baltimore City' here to match the row).
 */
const MD_GOVERNMENT_BY_GEOID: Readonly<Record<string, string>> = {
  '24510': 'Baltimore City',
  '24005': 'Baltimore County',
  '24003': 'Anne Arundel County',
  '24013': 'Carroll County',
  '24025': 'Harford County',
  '24027': 'Howard County',
};

type LocalAmbiguity = { candidates: string[]; reason: string; askFor?: 'zip-or-county' | 'county' | 'fix-address' };

/** Baltimore rows first, then the rest in GEOID order; no duplicates. */
function orderedCandidates(names: Iterable<string>): string[] {
  const set = new Set(names);
  const first = BALTIMORE_ROW_NAMES.filter((n) => set.has(n));
  const rest = Object.values(MD_GOVERNMENT_BY_GEOID).filter(
    (n) => set.has(n) && !(BALTIMORE_ROW_NAMES as readonly string[]).includes(n),
  );
  return [...first, ...rest];
}

/**
 * A Maryland address whose city field and county field name OPPOSITE
 * Baltimore governments ("Baltimore City" in one, "Baltimore County" in the
 * other). Nothing on it can be trusted to decide, so the resolver answers
 * with the state row and says so instead of letting whichever field it reads
 * first win. `city`/`county` are normalizePlace'd; `county` still carries its
 * " county" suffix.
 */
function baltimoreFieldConflict(state: string, city: string, rawCounty: string): LocalAmbiguity | null {
  if (state !== 'MD' || !city || !rawCounty) return null;
  const cityIsCity = city === 'baltimore city' || city === 'city of baltimore';
  const cityIsCounty = city === 'baltimore county';
  const countyIsCity = rawCounty === 'baltimore city' || rawCounty === 'city of baltimore';
  const countyIsCounty = rawCounty === 'baltimore county';
  if ((cityIsCity && countyIsCounty) || (cityIsCounty && countyIsCity)) {
    return {
      candidates: [...BALTIMORE_ROW_NAMES],
      reason: 'This address names Baltimore City in one field and Baltimore County in the other.',
      askFor: 'fix-address',
    };
  }
  return null;
}

/**
 * Why a Maryland address could be in Baltimore City, Baltimore County or a
 * neighbour of one, with nothing to decide between them, or null. Only called
 * once no row matched, so a county, a wholly-inside ZIP or a postal name has
 * already had its chance.
 *
 *   - the city is the postal name "Baltimore", which both governments use;
 *   - or the ZIP is in BALTIMORE_SPLIT_ZCTAS. The candidates are every
 *     government that ZIP touches (21225: Baltimore City or Anne Arundel
 *     County; 21013: Baltimore County or Harford County), plus both Baltimore
 *     rows when the postal name is "Baltimore" too.
 * With a ZIP on the address, only the county can settle it, so askFor is
 * 'county'; without one, the ZIP might (askFor 'zip-or-county').
 */
function localAmbiguityFor(
  state: string, city: string, county: string, zip: string,
): LocalAmbiguity | null {
  if (state !== 'MD' || county) return null;
  const askFor = zip ? 'county' : 'zip-or-county';
  const saysBaltimore = city === 'baltimore';
  const split = zip ? BALTIMORE_SPLIT_ZCTAS[zip] : undefined;
  if (split) {
    const touched = split.map((g) => MD_GOVERNMENT_BY_GEOID[g]).filter((n): n is string => !!n);
    const candidates = orderedCandidates(saysBaltimore ? [...BALTIMORE_ROW_NAMES, ...touched] : touched);
    const lead = saysBaltimore
      ? 'The mailing name "Baltimore" is used in both Baltimore City and Baltimore County. '
      : '';
    return {
      candidates,
      reason: `${lead}ZIP ${zip} crosses the line between ${orderedCandidates(touched).join(' and ')}, and this address names no county that decides it.`,
      askFor,
    };
  }
  if (city === 'baltimore') {
    return {
      candidates: [...BALTIMORE_ROW_NAMES],
      reason: 'The mailing name "Baltimore" is used in both Baltimore City and Baltimore County, and this address names no county.',
      askFor,
    };
  }
  return null;
}

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
  const rawCounty = normalizePlace(q.county);
  // A county field of just "Baltimore" is read as Baltimore County, the
  // government whose Census name is "Baltimore County" (the City's is
  // "Baltimore city"); validate-code-jurisdiction pins that every row answers
  // to its first matchCounty name.
  const county = rawCounty.replace(/\s+county$/, '');
  const zip = /^\s*(\d{5})/.exec(q.zip ?? '')?.[1] ?? '';

  const conflict = baltimoreFieldConflict(state, city, rawCounty);
  if (conflict) {
    const md = STATE_ADOPTIONS.find((e) => e.state === state);
    if (md) return { kind: 'state', entry: md, state, localAmbiguity: conflict };
  }

  for (const entry of LOCAL_ADOPTIONS) {
    if (entry.state !== state) continue;
    if (city && entry.matchCity?.some((m) => normalizePlace(m) === city)) {
      return { kind: 'city', entry, matchedOn: 'city', state };
    }
    // A postal name wins only when the address names no county, or names one
    // of this row's own counties.
    if (
      city &&
      entry.postalCity?.some((m) => normalizePlace(m) === city) &&
      (!county || (entry.matchCounty ?? []).some((m) => normalizePlace(m) === county))
    ) {
      return { kind: 'city', entry, matchedOn: 'city', state };
    }
  }
  // A ZIP places the address only through a row's own `postalZip`, and only
  // when the address names no county or names that row's county — the same
  // gate a postal name has. Only rows whose ZIPs lie wholly inside them carry
  // the list, and no two rows share a ZIP, so the order of the rows cannot
  // change the answer.
  if (zip) {
    for (const entry of LOCAL_ADOPTIONS) {
      if (entry.state !== state || !entry.postalZip?.includes(zip)) continue;
      if (county && !(entry.matchCounty ?? []).some((m) => normalizePlace(m) === county)) continue;
      return { kind: 'city', entry, matchedOn: 'zip', state };
    }
  }
  for (const entry of LOCAL_ADOPTIONS) {
    if (entry.state !== state) continue;
    if (county && entry.matchCounty?.some((m) => normalizePlace(m) === county)) {
      return { kind: 'city', entry, matchedOn: 'county', state };
    }
  }

  const st = STATE_ADOPTIONS.find((e) => e.state === state);
  if (st) {
    const localAmbiguity = localAmbiguityFor(state, city, county, zip);
    return localAmbiguity ? { kind: 'state', entry: st, state, localAmbiguity } : { kind: 'state', entry: st, state };
  }

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

export const ICC_VIEWER_BASE = 'https://codes.iccsafe.org/content/';

/**
 * A link to ONE VOLUME in ICC's free, anonymous, no-account Digital Codes
 * viewer — the code a contractor can open on a jobsite phone in ten seconds.
 *
 * WHY LINKING IS ALLOWED WHERE HOLDING THE TEXT IS NOT. Loading
 * codes.iccsafe.org/content/NYSRC2025P1 logged-out renders the volume with no
 * paywall interstitial and no sign-in gate (verified 2026-09-13). ICC's Terms
 * of Use were read in full the same day and grepped for "link", "hyperlink",
 * "frame" and "deep link": there is NO anti-linking clause — the only linking
 * section governs ICC linking outward. `/content/` is also not among the paths
 * codes.iccsafe.org/robots.txt disallows (`/lookup` is). Pointing a contractor
 * at the publisher's own free page is not copying, not crawling, and not
 * addressed by those terms. Holding the text IS addressed by them, which is
 * why this app links and does not hold.
 *
 * THE GUARD IS THE WHOLE FUNCTION. `volumeId` must be a bare volume id:
 * uppercase, alphanumeric, no slash, no dot, no space. That makes it
 * structurally impossible to build /content/IBC2021P1/chapter-99-not-a-real-
 * chapter, which returns HTTP 200 while pointing at nothing (verified
 * 2026-09-13). There is deliberately no sibling that takes a section number,
 * and there must never be one while section numbers come from model recall.
 */
export function iccViewerUrl(volumeId: string | undefined | null): string | null {
  const id = (volumeId ?? '').trim();
  if (!/^[A-Z][A-Z0-9]{3,23}$/.test(id)) return null;
  return `${ICC_VIEWER_BASE}${id}`;
}

/**
 * THE LAST GATE BEFORE Linking.openURL. Nothing else may open a viewer link.
 *
 * `iccViewerUrl` guards id → URL. It does not, and cannot, guard URL → URL
 * plus a path, and that is the hole a reviewer walked through on 2026-09-13:
 * changing the screen's opener from `Linking.openURL(l.url)` to
 * `Linking.openURL(`${l.url}/chapter-${citedSectionNumber}`)` produced a live,
 * tappable, fabricated section link — the exact machine the scope limit exists
 * to prevent — and the whole suite stayed green at 1798/0, because the guard
 * watching for it was two regexes over the screen's source text and neither
 * regex could see an interpolation that does not sit immediately after the
 * literal host string.
 *
 * So the check moved to where it can be executed. This function takes whatever
 * URL reached the opener, re-parses it, and REBUILDS the URL from the volume
 * id it captured — so a path, a query, a fragment or a section slug cannot
 * ride along even if one was appended a line earlier. Refusing returns null
 * and the tap does nothing, which is the correct behaviour: /content/<id>/
 * <anything> returns HTTP 200 whether the chapter exists or not, so an
 * unopenable link is strictly better than a confident one pointing at nothing.
 */
export function viewerUrlToOpen(url: string | null | undefined): string | null {
  const m = /^https:\/\/codes\.iccsafe\.org\/content\/([A-Z][A-Z0-9]{3,23})$/.exec(
    (url ?? '').trim(),
  );
  return m ? iccViewerUrl(m[1]) : null;
}

/** What a re-check of one ICC volume concluded. `unreachable` is the ONLY
 *  verdict the committed receipt is allowed to carry forward. */
export type IccVolumeCheck =
  | { verdict: 'ok' }
  | { verdict: 'wrong'; why: string }
  | { verdict: 'unreachable'; why: string };

/**
 * Judge one re-fetch of /content/<id>. Pure, so the rule can be tested without
 * the network — scripts/verify-code-sources.ts does the fetching and hands the
 * result here, and scripts/validate-code-jurisdiction.ts drives it directly.
 *
 * WHY A 4xx IS `wrong` AND NOT `unreachable`. The two verdicts are not
 * synonyms: `unreachable` is forgiven by the committed receipt (a host that
 * blocks scripts, a timeout on a 44 MB PDF), and `wrong` never is. ICC answers
 * a volume id that no longer exists with HTTP 404 — measured 2026-09-13 on
 * IECC2015P1, which is the real id IECC2015 plus the two-character suffix every
 * OTHER volume in this table carries. Classifying that as
 * `unreachable` would let a DEAD LINK ride forever behind a receipt written
 * when the id still resolved, which is the whole failure mode this file's
 * header calls "a real URL beside a recalled claim". A 5xx or a transport
 * error is genuinely the network's fault and stays `unreachable`.
 *
 * The title checks are the other half, and they catch what a status code
 * cannot: the generic "Digital Codes" shell (the id resolved to no volume) and
 * a real volume of the WRONG edition (200, perfect title, wrong book).
 */
export function iccVolumeVerdict(input: {
  volumeId: string | undefined | null;
  /** The `iccVolumeTitle` the table recorded when the id was first read. */
  recordedTitle: string | undefined | null;
  /** The row's edition string — '2021', '8th Edition (2023)'. */
  edition: string;
  /** HTTP status, or null when no response arrived at all. */
  status: number | null;
  /** The page as text. '' when the fetch failed. */
  text: string;
  /** Transport failure detail, when there was one. */
  why?: string;
}): IccVolumeCheck {
  if (!iccViewerUrl(input.volumeId)) {
    return { verdict: 'wrong', why: 'refused by iccViewerUrl — not a bare volume id' };
  }
  const status = input.status;
  if (status !== null && status >= 400 && status < 500) {
    return { verdict: 'wrong', why: `HTTP ${status} — this volume id does not resolve; the link is dead` };
  }
  if (status === null || status < 200 || status >= 300) {
    return { verdict: 'unreachable', why: input.why ?? (status === null ? 'no response' : `HTTP ${status}`) };
  }
  const head = (input.text ?? '').replace(/\s+/g, ' ').trim();
  if (/^digital codes\b/i.test(head)) {
    return { verdict: 'wrong', why: 'generic fallback title — this id does not resolve to a volume' };
  }
  const year = input.edition.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;
  if (!year || !head.slice(0, 200).includes(year)) {
    return { verdict: 'wrong', why: `title does not carry the edition year ${year ?? '(none in the edition string)'}` };
  }
  const recorded = (input.recordedTitle ?? '').replace(/\s+/g, ' ').trim();
  if (!recorded || !head.startsWith(recorded)) {
    return { verdict: 'wrong', why: 'the recorded iccVolumeTitle no longer matches what ICC returns' };
  }
  return { verdict: 'ok' };
}

/** One openable volume: ICC's own title for it, and the link. */
export interface CodeViewerLink {
  label: string;
  url: string;
  /** The AdoptedCode this came from, so the UI can say which code it is. */
  code: AdoptedCode;
}

/** Every adopted code at this address that MAGE can open in ICC's viewer. */
export function viewerLinksFor(resolved: ResolvedCodeJurisdiction): CodeViewerLink[] {
  if (resolved.kind === 'unknown') return [];
  const out: CodeViewerLink[] = [];
  const seen = new Set<string>();
  for (const c of resolved.entry.codes) {
    const url = iccViewerUrl(c.iccVolumeId);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: c.iccVolumeTitle ?? codeLine(c), url, code: c });
  }
  return out;
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
  /**
   * The governing volumes the contractor can OPEN, produced here so the link
   * and the chip come from the same resolved value — the same reason
   * promptBlock and chipLabel do. Deliberately absent from `promptBlock`: the
   * model is never handed a URL, because a model handed a URL cites URLs.
   */
  viewerLinks: CodeViewerLink[];
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
      viewerLinks: [],
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

  // THE AMBIGUOUS BALTIMORE ADDRESS. The state row is still the answer — it is
  // the only thing MAGE can stand behind — but the model and the contractor are
  // both told, in words built from the candidate rows' OWN data, that more
  // than one local code is in play and none is grounded (a candidate with no
  // row is named as not researched). Its own cache key keeps an answer given
  // here from ever being served to a resolved City or County job.
  const ambiguity = resolved.kind === 'state' ? resolved.localAmbiguity : undefined;
  if (ambiguity && resolved.kind === 'state') {
    const names = ambiguity.candidates;
    const rowFor = (n: string) => LOCAL_ADOPTIONS.find((e) => e.state === resolved.state && e.name === n);
    const which = names.length <= 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
    // Every candidate MAGE has a row for is described from that row's own
    // data; one without a row is named as not researched, never guessed at.
    const each = names
      .map((n) => {
        const e = rowFor(n);
        return e ? `${e.name}, ${e.authorityName}: ${codesSummary(e.codes)}` : `${n}: not researched by MAGE, so its local codes are not known here`;
      })
      .join('; ');
    const allRows = names.every((n) => !!rowFor(n));
    const baltimorePair = names.length === 2 && BALTIMORE_ROW_NAMES.every((n) => names.includes(n));
    // Both Baltimore rows are verified to carry their own fire and electrical
    // codes. For any other set, only what the Maryland row's own source says
    // is claimed: counties may amend the state codes.
    const governments = baltimorePair
      ? 'They are separate governments with their own fire code, electrical code and local amendments'
      : `They are separate governments, and each may amend ${resolved.entry.stateName}'s codes`;
    const askFor = ambiguity.askFor ?? 'zip-or-county';
    const tell = askFor === 'county'
      ? "add the job's county"
      : askFor === 'fix-address'
        ? "correct the job's city or county so the two agree"
        : "add the job's ZIP or county";
    const chipAsk = askFor === 'county'
      ? "Add the job's county"
      : askFor === 'fix-address'
        ? "Fix the job's city or county so they agree"
        : "Add the job's ZIP or county";
    facts.push(
      `This address could be in ${which}. ${governments} (${each}). ${ambiguity.reason} MAGE could not tell which from this address, so only ${resolved.entry.stateName}'s statewide editions are grounded here. Do not cite ${names.length === 2 ? 'either' : 'any'} local code as the one that governs; tell the contractor to ${tell}.`,
    );
    // The plain "Baltimore, MD" shape keeps the key it always had; any other
    // shape gets its own, so an answer is never served across two different
    // sets of candidates or two different asks.
    const base = `state:${entry.state}:${normalizePlace(resolved.entry.stateName)}:baltimore-ambiguous`;
    const cacheKey = baltimorePair && askFor === 'zip-or-county'
      ? base
      : `${base}:${names.map((n) => normalizePlace(n)).join('+')}:${askFor}`;
    return {
      facts,
      promptBlock: `JURISDICTION (verified adoption record):\n${facts.map((f) => `- ${f}`).join('\n')}\n${GROUNDED_INSTRUCTION}`,
      chipLabel: `${resolved.entry.stateName} statewide codes only. ${which}? ${chipAsk}${allRows && askFor !== 'fix-address' ? ' to get the local codes' : ''}.`,
      grounded: true,
      cacheKey,
      viewerLinks: viewerLinksFor(resolved),
    };
  }

  return {
    facts,
    promptBlock: `JURISDICTION (verified adoption record):\n${facts.map((f) => `- ${f}`).join('\n')}\n${GROUNDED_INSTRUCTION}`,
    chipLabel: `Grounded on ${entry.authorityName} — ${codes}. Adoption checked ${entry.checkedOn}. Code sections below are still model recall.`,
    grounded: true,
    cacheKey: `${resolved.kind}:${entry.state}:${normalizePlace(scope)}`,
    viewerLinks: viewerLinksFor(resolved),
  };
}

/**
 * The verified building-department block for a resolved jurisdiction. City
 * rows only, and only when the row carries one; a state row, an unknown
 * address or a city without a verified block all answer null, so a caller can
 * render nothing rather than guess.
 */
export function departmentFor(resolved: ResolvedCodeJurisdiction): BuildingDepartment | null {
  if (resolved.kind !== 'city') return null;
  return resolved.entry.department ?? null;
}
