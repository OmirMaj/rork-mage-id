// utils/permitPath/jurisdiction.ts — which family of question packs a job gets
// (PLAN §4), from the existing pure resolvers. Cautions are copied verbatim
// from permitOfficeFor; this file writes no caution text of its own.

import type { ResolvedCodeJurisdiction } from '@/utils/codeJurisdiction';
import type { PermitOffice, PlaceLookupResult, PermitOfficeAnswer } from '@/utils/permitOffices';
import { DEPARTMENTS, MD_COUNTY_OFFICES, PIN_TOWN_CAUTION, VILLAGE_CAUTION } from '@/utils/permitOffices';
import { PP_COPY } from '@/utils/permitPath/copy';
import type { Family, PermitRoute } from '@/utils/permitPath/types';

/** Nassau and Suffolk: the Long Island packs. */
export const LONG_ISLAND_COUNTY_FIPS: readonly string[] = ['36059', '36103'];
export const NYC_JURISDICTION = 'NYC';
/** The key of a job whose department is not known. Department answers are
 *  NEVER matched under it: it would pool every unplaced job together. */
export const UNRESOLVED_JURISDICTION = 'UNRESOLVED';

/**
 * The hand-verified permit office behind a verified department block in
 * utils/codeJurisdiction.ts, when one exists outside NYC. Those jobs never call
 * place-lookup (the DepartmentCard rule), so the office comes from the same
 * row by name: MD_COUNTY_OFFICES names the LOCAL_ADOPTIONS row each Baltimore
 * office is built from. Anything else is null; nothing is guessed.
 */
export function verifiedDepartmentOffice(resolved: ResolvedCodeJurisdiction): PermitOffice | null {
  if (resolved.kind !== 'city' || !resolved.entry.department || resolved.entry.state !== 'MD') return null;
  const geoid = Object.keys(MD_COUNTY_OFFICES).find((g) => MD_COUNTY_OFFICES[g].row === resolved.entry.name);
  return geoid ? DEPARTMENTS[`MD:${geoid}`] ?? null : null;
}

export function classifyJurisdiction(args: {
  officeAnswer: PermitOfficeAnswer | null;
  place: PlaceLookupResult | null;
  nyc: boolean;
  /** The office came from a verified department block (verifiedDepartmentOffice),
   *  so it stands without a Census place. */
  departmentVerified?: boolean;
}): PermitRoute['jurisdiction'] {
  const { officeAnswer, place, nyc } = args;
  const countyFips = place?.county?.geoid ? place.county.geoid.slice(0, 5) : null;
  const cautions: string[] = [...(officeAnswer?.cautions ?? [])];
  const headline = officeAnswer?.headline ?? null;

  if (nyc || officeAnswer?.kind === 'nyc') {
    return {
      key: NYC_JURISDICTION, family: 'nyc', name: PP_COPY.jurisdiction.nycName, officeTitle: PP_COPY.jurisdiction.nycOffice,
      headline, cautions, countyFips,
    };
  }

  const office = officeAnswer?.kind === 'office' ? officeAnswer.office : null;
  if (office && args.departmentVerified && office.verification === 'hand-verified') {
    return { key: office.key, family: 'elsewhere', name: office.jurisdiction, officeTitle: office.title, headline, cautions, countyFips };
  }
  if (!office || !place || place.match === 'none') {
    // Unplaced. In New York the town-or-village question leads, so the
    // village caution travels with it (verbatim).
    const isNy = place?.state === 'NY';
    if (isNy && !cautions.includes(VILLAGE_CAUTION) && officeAnswer?.kind !== 'unsupported') cautions.push(VILLAGE_CAUTION);
    const family: Family = officeAnswer?.kind === 'unsupported' ? 'elsewhere' : 'unresolved';
    return { key: UNRESOLVED_JURISDICTION, family, name: PP_COPY.jurisdiction.unresolvedName, officeTitle: null, headline, cautions, countyFips };
  }

  const state = place.state ?? (office.key.split(':')[0] || null);
  let family: Family = 'elsewhere';
  if (state === 'NY' && countyFips && LONG_ISLAND_COUNTY_FIPS.includes(countyFips)) {
    const ip = place.incorporatedPlace;
    if (ip && place.match === 'address' && ip.kind === 'village') family = 'ny_village';
    else if (ip && place.match === 'address' && ip.kind === 'city') family = 'ny_city';
    else family = 'ny_town';
    // A map-pin match never picks the village for the GC: town family, and the
    // pin caution says the village may be the one that issues.
    if (place.match === 'approximate' && !cautions.includes(PIN_TOWN_CAUTION)) cautions.push(PIN_TOWN_CAUTION);
  }

  return { key: office.key, family, name: office.jurisdiction, officeTitle: office.title, headline, cautions, countyFips };
}
