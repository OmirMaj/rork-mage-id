// utils/roomScan/clearancePlace.ts — Clearance Check: is this project in New
// York City?
//
// Two rows of the table (utils/roomScan/clearanceRefs, `where: 'nyc_only'`)
// are New York City's commonly cited ceiling figures. They are shown only when
// the project's address resolves to New York City, and that answer comes from
// the app's ONE resolver (utils/codeJurisdiction.resolveCodeJurisdiction, with
// the query the rest of the app builds for a project), never from a second
// reading of the address here. No address, an address the resolver cannot
// place, the rest of New York State, Baltimore: all "not New York City".
//
// (Code Flags has the same answer in utils/codeFlags/place, but that module
// loads only on its own two screens, behind its own flag.)
//
// Pure: no React, no storage, no network.
import { jurisdictionQueryForProject, resolveCodeJurisdiction, type AddressableProject } from '@/utils/codeJurisdiction';

/** The resolver's own name for the New York City row. */
export const NYC_ROW_NAME = 'New York City';

/** True only when the project's address resolves to the New York City row. */
export function clearanceInNyc(project: AddressableProject | null | undefined): boolean {
  if (!project) return false;
  const resolved = resolveCodeJurisdiction(jurisdictionQueryForProject(project));
  return resolved.kind === 'city' && resolved.entry.name === NYC_ROW_NAME;
}
