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
// THE TABLE. Every row: verified 2026-09-06 against `sourceUrl`.
// Adding a row means FETCHING the authority's page — never recalling it.
//
// DELIBERATELY ABSENT — do not "helpfully" fill these in from memory:
//   Chicago, IL   every chicago.gov path, American Legal's Chicago library,
//                 ICC and Municode all refuse automated fetches. Search
//                 snippets describe a 2019 Chicago Building Code on the 2018
//                 IBC; snippets are not a source. Needs a human with a browser.
//   Boston, MA    ISD enforces the statewide 780 CMR rather than a city code
//                 (that much IS verified) — but every mass.gov page carrying
//                 the EDITION refused to load, so there is no edition to cite.
//   Los Angeles   LADBS's site does not state its current edition anywhere
//                 reachable; the CA row covers LA correctly enough for now.
//   Texas         adopts the IRC/IBC "as they existed on May 1, 2012" as a
//                 statutory FLOOR for municipalities, with no state agency
//                 enforcing it and every large city on something later. A row
//                 saying "Texas: IBC 2012" would actively mislead. Houston has
//                 its own verified row; the rest of Texas correctly resolves
//                 to 'unknown'.
//   Illinois      sets a stringency floor ("current or most recent preceding
//                 edition"), never naming an edition. Nothing to cite.
//   Arizona       no statewide code; no state page affirmatively says so, only
//                 statutes delegating adoption to cities and counties. Phoenix
//                 has its own row.
// ─────────────────────────────────────────────────────────────────────

export const STATE_ADOPTIONS: readonly StateAdoption[] = [
  {
    state: 'CA',
    stateName: 'California',
    authorityName: 'California Building Standards Commission',
    codes: [
      { family: 'LOCAL', edition: '2025', name: 'California Building Standards Code (Title 24), 2025 Triennial Edition' },
    ],
    notes: 'California writes its own Title 24 rather than adopting a model code straight; cities amend Title 24 on top of it. The 2025 edition took effect 1 January 2026.',
    sourceUrl: 'https://www.dgs.ca.gov/BSC/Codes',
    checkedOn: '2026-09-06',
  },
  {
    state: 'NY',
    stateName: 'New York',
    authorityName: 'New York State Department of State, Division of Building Standards and Codes',
    codes: [
      { family: 'LOCAL', edition: '2025', name: '2025 Uniform Fire Prevention and Building Code of New York State (built on the 2024 I-Codes)' },
      { family: 'LOCAL', edition: '2025', name: '2025 Energy Conservation Construction Code of New York State' },
    ],
    notes: 'The 2025 Uniform Code replaced the 2020 edition on 31 December 2025. The state states its basis as the 2024 ICC books collectively and does not publish separate IBC/IRC/IECC edition years, so none are claimed here. New York City is exempt — it runs its own Construction Codes.',
    sourceUrl: 'https://dos.ny.gov/division-building-standards-and-codes-frequently-asked-questions',
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
  },
  {
    state: 'WA',
    stateName: 'Washington',
    authorityName: 'Washington State Building Code Council (SBCC)',
    codes: [
      { family: 'IBC', edition: '2021' },
      { family: 'IRC', edition: '2021' },
      { family: 'IECC', edition: '2021', name: '2021 Washington State Energy Code' },
      { family: 'NEC', edition: '2023' },
    ],
    notes: "Verified against the binding rule text (WAC 51-50-003 and 51-51-003) because the SBCC's own landing page still presents the 2018 codes as current. The electrical code is run separately by the Department of Labor & Industries (WAC 296-46B), and it flips to the 2026 NEC on 31 December 2026 — re-check this row after that date.",
    noteSourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=296-46B-010',
    sourceUrl: 'https://app.leg.wa.gov/WAC/default.aspx?cite=51-50-003',
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
  },
  {
    name: 'Seattle',
    state: 'WA',
    matchCity: ['seattle'],
    authorityName: 'Seattle Department of Construction & Inspections (SDCI)',
    codes: [
      { family: 'IBC', edition: '2021', name: '2021 Seattle Building Code' },
      { family: 'IRC', edition: '2021', name: '2021 Seattle Residential Code' },
    ],
    notes: 'The Seattle Residential Code governs houses, duplexes and townhouses up to three storeys with separate entrances; everything else is under the Building Code.',
    sourceUrl: 'https://www.seattle.gov/construction-and-inspections/codes/codes-we-enforce-(a-z)/building-code',
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
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
      { family: 'IFC', edition: '2021' },
    ],
    notes: 'Houston takes its mechanical and plumbing codes from IAPMO — the Uniform Mechanical Code and Uniform Plumbing Code with Houston amendments — NOT the ICC\'s IMC/IPC. The 2021 Houston Construction Code took effect 1 January 2024. MAGE could not resolve which NEC edition Houston is on (two city pages disagree), so no electrical edition is claimed here.',
    sourceUrl: 'https://www.houstonpermittingcenter.org/houston-code-archive',
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
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
    checkedOn: '2026-09-06',
  },
];

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
export function splitLocationText(text: string): { city: string; state: string } {
  const raw = (text ?? '').trim();
  if (!raw) return { city: '', state: '' };

  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const state = normalizeState(parts[parts.length - 1]);
    if (state) return { city: parts[parts.length - 2], state };
    return { city: parts[0], state: '' };
  }

  // No comma: try "<city> <state>" by peeling words off the end, longest
  // state name first so "Seattle Washington" and "Austin TX" both land.
  const words = raw.split(/\s+/);
  for (let take = Math.min(3, words.length - 1); take >= 1; take--) {
    const state = normalizeState(words.slice(words.length - take).join(' '));
    if (state) return { city: words.slice(0, words.length - take).join(' '), state };
  }
  return { city: raw, state: '' };
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
