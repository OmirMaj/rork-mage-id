// passportInputs — turns what app/home-passport.tsx already has in memory into
// buildConsumerPassport's inputs. Pure, so validate-home-passport-screen can pin
// the join.
//
// WHY (audit round 2, #21). The screen passed 5 of the builder's 11 inputs and
// built each job as {id, name, location, type, status, createdAt, sqft}. With no
// completion date the record printed no finish date; with no `contractor` the
// GC who ran the job never appeared in Contractors or Work History; with no
// selections there were no model numbers; with no maintenance "No maintenance
// schedule yet." showed even after the closeout binder saved one; with no
// subcontractors each trade was a bare vendor name; with no photos the shared
// job photos were missing. The sibling builder in closeout-binder.tsx has been
// passed these all along.

import type {
  CompanyBranding, Project, ProjectPhoto, SelectionCategory, Subcontractor,
} from '@/types';
import type { MaintenanceItem } from '@/utils/closeoutBinderEngine';
import type {
  PassportContractorInput, PassportJobInput, PassportMaintenanceInput,
} from '@/utils/passport/consumerPassport';
import { calendarDayOf } from '@/utils/calendarDate';

const clean = (s: string | undefined | null): string => (typeof s === 'string' ? s.trim() : '');

/**
 * The GC on every job at this home is the account's own company — the Home
 * Passport screen is opened from the contractor's Tools. Contact info only.
 * Returns undefined when there is no company name, so the builder does not
 * invent a nameless "contractor".
 */
export function passportContractorFromBranding(
  b: Partial<CompanyBranding> | null | undefined,
): PassportContractorInput | undefined {
  const companyName = clean(b?.companyName);
  if (!companyName) return undefined;
  return {
    companyName,
    ...(clean(b?.contactName) ? { contactName: clean(b?.contactName) } : {}),
    ...(clean(b?.phone) ? { phone: clean(b?.phone) } : {}),
    ...(clean(b?.email) ? { email: clean(b?.email) } : {}),
    ...(clean(b?.licenseNumber) ? { licenseNumber: clean(b?.licenseNumber) } : {}),
  };
}

type ProjectLike = Pick<Project, 'id' | 'name' | 'location' | 'type' | 'status' | 'createdAt' | 'squareFootage'>
  & Partial<Pick<Project, 'substantialCompletionDate' | 'closedAt'>>;

function withDay<K extends 'substantialCompletionDate' | 'closedAt'>(key: K, value: string | null | undefined): Partial<Record<K, string>> {
  const day = calendarDayOf(value);
  return day ? ({ [key]: day } as Partial<Record<K, string>>) : {};
}

/** One PassportJobInput per project, carrying the completion dates and the GC. */
export function passportJobsFromProjects(
  projects: readonly ProjectLike[],
  contractor: PassportContractorInput | undefined,
): PassportJobInput[] {
  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    location: p.location,
    type: String(p.type ?? ''),
    status: String(p.status ?? ''),
    createdAt: p.createdAt,
    squareFootage: p.squareFootage,
    // Both are saved as INSTANTS (closeout-binder stamps new Date().toISOString()),
    // and the builder reads the leading YYYY-MM-DD — the UTC date. A job closed
    // after ~8 pm Eastern printed the NEXT day on the homeowner's record. Hand
    // the builder the local calendar day the instant fell on (a bare day passes
    // through unchanged); an unparseable value is left out, not guessed.
    ...withDay('substantialCompletionDate', p.substantialCompletionDate),
    ...withDay('closedAt', p.closedAt),
    ...(contractor ? { contractor } : {}),
  }));
}

/** What the per-job fetches returned: the binder's saved schedule and the selections. */
export interface PassportJobExtras {
  selections: SelectionCategory[];
  /** The CLOSEOUT BINDER's saved schedule only — never the template default,
   *  which would show the owner a schedule nobody set for their home. */
  maintenanceSchedule: MaintenanceItem[] | null;
}

/** The remaining builder inputs for the jobs at one home. */
export function passportExtrasFor(
  jobIds: readonly string[],
  extras: Readonly<Record<string, PassportJobExtras | undefined>>,
  subcontractors: readonly Subcontractor[] | undefined,
  photos: readonly ProjectPhoto[] | undefined,
): {
  selections: SelectionCategory[];
  maintenance: PassportMaintenanceInput[];
  subcontractors: Subcontractor[];
  photos: ProjectPhoto[];
} {
  const ids = new Set(jobIds);
  const selections: SelectionCategory[] = [];
  const maintenance: PassportMaintenanceInput[] = [];
  for (const id of jobIds) {
    const x = extras[id];
    if (!x) continue;
    selections.push(...x.selections.filter((c) => c.projectId === id));
    if (x.maintenanceSchedule && x.maintenanceSchedule.length > 0) {
      maintenance.push({ projectId: id, items: x.maintenanceSchedule });
    }
  }
  return {
    selections,
    maintenance,
    // The builder resolves a trade's phone and licence through this roster.
    subcontractors: [...(subcontractors ?? [])],
    // Only this home's jobs; the builder still applies the portal-share gate.
    photos: (photos ?? []).filter((ph) => ids.has(ph.projectId)),
  };
}
