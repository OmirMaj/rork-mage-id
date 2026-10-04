// utils/permitPath/packs/sources.ts — the official pages Permit Path states
// facts from. PURE DATA: no React, no storage, no network.
//
// THE FIREWALL (the utils/codeJurisdiction.ts rule, carried over)
//   Every entry below was read off the agency's own page on `checkedOn`, and
//   `phrase` (plus `extraPhrases`) is text copied from that page that day.
//   Nothing here is written from recall. A real URL next to a recalled claim
//   is the most dangerous shape a row can take, because every offline check
//   passes. So:
//
//     bun run scripts/verify-permit-path-sources.ts
//
//   fetches each URL and looks for the phrases (case-insensitive, whitespace
//   collapsed). Run it whenever you touch this file or a pack item that cites
//   it, then move `checkedOn`. scripts/validate-permit-path-facts.ts (offline,
//   in the ship gate) fails any entry more than 180 days old, any URL off the
//   allowlist, and any pack item whose source is not one of SOURCE_REFS.
//
// WHAT A SOURCE IS NOT
//   A page that does not state a rule is never a source for that rule. The
//   Town of Hempstead's building page (V13) lists no application documents,
//   which is exactly why every Long Island town or village requirement is a
//   question for the department and not a fact here.

import type { SourceRef } from '../types';

export type SourceId = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7' | 'V8' | 'V9' | 'V10' | 'V11' | 'V12' | 'V13';

export interface FactSource extends SourceRef {
  /** Copied from the page on `checkedOn`. The verifier must find it there. */
  phrase: string;
  /** More text from the same page that the items citing it lean on. */
  extraPhrases: readonly string[];
}

/** The day every entry below was last fetched and read. */
export const FACTS_CHECKED_ON = '2026-10-02';

function src(label: string, url: string, phrase: string, extraPhrases: readonly string[] = []): FactSource {
  return Object.freeze({ label, url, checkedOn: FACTS_CHECKED_ON, phrase, extraPhrases: Object.freeze([...extraPhrases]) });
}

export const SOURCES: Readonly<Record<SourceId, FactSource>> = Object.freeze({
  V1: src(
    'NYC DOB · DOB NOW: Build',
    'https://www.nyc.gov/site/buildings/industry/dob-now-build.page',
    'Alteration-CO and Occupancy for BIS Jobs',
    ['Filing Representatives and Owners to submit jobs'],
  ),
  V2: src(
    'NYC DOB · DOB NOW: Build FAQ',
    'https://www.nyc.gov/site/buildings/industry/new-building-buildfaqs.page',
    'Alt-1 in BIS is Alteration-CO in DOB NOW',
    ['alterations that impact Certificate of Occupancy', 'a New Building application must be filed'],
  ),
  V3: src(
    'NYC DOB · Alteration projects',
    'https://www.nyc.gov/site/buildings/dob/project-categories-alterations.page',
    'Work that does not result in the issuance of a new Certificate of Occupancy is considered a renovation project',
    ['Egress Modifications', 'Horizontal Enlargements', 'will always result in the issuance of a new Certificate of Occupancy'],
  ),
  V4: src(
    'NYC DOB · Alterations, 1- and 2-family buildings',
    'https://www.nyc.gov/site/buildings/dob/project-categories-alt-1-2-family-buildings.page',
    'Alteration work always results in the issuance of a new or amended Certificate of Occupancy',
  ),
  V5: src(
    'NYC DOB · Do I need a permit?',
    'https://www.nyc.gov/site/buildings/property-or-business-owner/do-i-need-a-permit.page',
    'Most construction in New York City requires approval and permits',
    ['Plumbing Fixture Replacement', 'Non-structural Roof Repair', 'Home Improvement Contractor (HIC) license'],
  ),
  V6: src(
    'NYC DOB · Owner requirements, 1- and 2-family buildings',
    'https://www.nyc.gov/site/buildings/property-or-business-owner/project-requirements-owner-alt-1-2-family-buildings.page',
    'must submit construction plans for approval by the Department, prior to obtaining a work permit',
    [
      'can only be performed by a Licensed Master Plumber',
      'requires a separately submitted electrical permit',
      'New York City licensed electrical contractor',
    ],
  ),
  V7: src(
    'NYC DEP/DOB · Asbestos requirements',
    'https://www.nyc.gov/site/buildings/dob/project-requirements-asbestos.page',
    'exempts buildings constructed after April 1, 1987',
    ['Certified Asbestos Investigator', 'Asbestos Assessment Report form ACP-5', 'Asbestos Project Notification form ACP-7', 'must still be abated'],
  ),
  V8: src(
    'NYC LPC · Apply',
    'https://www.nyc.gov/site/lpc/applications/apply.page',
    'web-based permit portal',
    ['Certificate of No Effect: 30 working days', 'Permit for Minor Work: 20 working days', 'Certificate of Appropriateness: 90 working days'],
  ),
  V9: src(
    'NYC LPC · Permit types',
    'https://www.nyc.gov/site/lpc/applications/permit-types.page',
    'LPC permit is still required',
    ['Any interior work that requires a permit from the Department of Buildings', 'filed and processed through Portico'],
  ),
  V10: src(
    'NYC DCWP · Home improvement license',
    'https://www.nyc.gov/site/dca/businesses/license-checklist-home-improvement-contractor.page',
    'home improvement work to any residential land or building in New York City',
  ),
  V11: src(
    'Nassau County Consumer Affairs · FAQ',
    'https://www.nassaucountyny.gov/Faq.aspx?TID=36',
    'Contractors who perform remodeling on residential homes in Nassau County',
    ['working solely in the field in which they are licensed', 'works only on COMMERCIAL buildings does NOT need a license'],
  ),
  V12: src(
    'Suffolk County Consumer Affairs · Home improvement',
    'https://suffolkcountyny.gov/Departments/Consumer-Affairs/Type-of-License/Home-Improvement-Contractors',
    'subject to arrest and prosecution for working without a license',
    ['Master Electrician', 'Master Plumbers', '(631) 853-4600', 'Search Contractors with Valid Licenses'],
  ),
  V13: src(
    'Town of Hempstead · Building Department',
    'https://hempsteadny.gov/191/Building-Department',
    'Online Permit Center',
  ),
});

export const SOURCE_IDS: readonly SourceId[] = Object.freeze(Object.keys(SOURCES) as SourceId[]);

/**
 * The SourceRef objects pack items carry. Items point at THESE objects (the
 * validator checks identity), so an inline `{ label, url }` literal fails.
 */
export const SOURCE_REFS: Readonly<Record<SourceId, SourceRef>> = Object.freeze(
  Object.fromEntries(
    SOURCE_IDS.map((id) => [id, Object.freeze({ label: SOURCES[id].label, url: SOURCES[id].url, checkedOn: SOURCES[id].checkedOn })]),
  ) as Record<SourceId, SourceRef>,
);

export function sourceRef(id: SourceId): SourceRef {
  return SOURCE_REFS[id];
}

/** Which SOURCES id a SourceRef object is, by identity. Null for anything else. */
export function sourceIdOf(ref: SourceRef | null | undefined): SourceId | null {
  if (!ref) return null;
  return SOURCE_IDS.find((id) => SOURCE_REFS[id] === ref) ?? null;
}

/**
 * PLAN §7's "to confirm" queue for the next facts pass. The UI shows nothing
 * from this list; each one stays a department question until an official page
 * says it and the verifier confirms the phrase.
 */
export interface ToConfirm { id: string; fact: string; note: string }

export const TO_CONFIRM: readonly ToConfirm[] = Object.freeze([
  {
    id: 'nassau_license_phone',
    fact: 'The Nassau County phone number for checking a home improvement license.',
    note: '516-571-2600 came from a search snippet, not from the FAQ page (V11). Not shown anywhere until a county page states it.',
  },
  {
    id: 'li_survey_co_search',
    fact: 'Whether every Long Island town or village wants a survey, or a certificate of occupancy or completion search, before filing.',
    note: 'The one town page read (V13) states no application document list. Asked as li.survey and li.co_search.',
  },
  {
    id: 'nyc_tpp_triggers',
    fact: 'What triggers a Tenant Protection Plan in NYC.',
    note: 'No V-source yet. Asked as nyc.tpp.',
  },
  {
    id: 'nyc_violations_block',
    fact: 'Whether open violations stop a DOB permit from being issued.',
    note: 'No V-source yet. Asked as nyc.violations.',
  },
  {
    id: 'lpc_typical_times',
    fact: 'Typical, not maximum, LPC review times.',
    note: "V8 states the maximum in working days and says staff-level permits usually come faster. Only the stated maximum is shown, labelled as LPC's stated maximum.",
  },
  {
    id: 'nyc_laa_filer',
    fact: 'Who may file a Limited Alteration Application (LAA).',
    note: 'V1 lists LAA filings in DOB NOW but not who files them.',
  },
] satisfies ToConfirm[]);
