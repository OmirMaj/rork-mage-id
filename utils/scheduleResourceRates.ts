// scheduleResourceRates — pick the right rate from a resource's
// rate table for a given date / kind. Construction loves this for
// Davis-Bacon prevailing-wage tracking, OT accruals, and weekend
// premium pay. P6 supports up to 5 rate columns; we expose the same.

import type { ProjectResource, ResourceRate } from '@/types';

export type RateKind = ResourceRate['kind'];

/** Resolve the active rate for a resource at a given ISO date. Falls
 *  back to the legacy `ratePerHour` when no rate table exists. */
export function resolveRate(
  resource: ProjectResource,
  opts: { kind?: RateKind; onDate?: string } = {},
): { ratePerHour: number; rate: ResourceRate | null } {
  const kind: RateKind = opts.kind ?? 'standard';
  const table = resource.rateTable ?? [];
  // Filter to the requested kind, sort by effective-from descending,
  // pick the most-recent that's not in the future.
  const candidates = table
    .filter(r => r.kind === kind)
    .filter(r => !r.effectiveFrom || !opts.onDate || r.effectiveFrom <= opts.onDate)
    .sort((a, b) => (b.effectiveFrom ?? '').localeCompare(a.effectiveFrom ?? ''));
  if (candidates.length > 0) {
    return { ratePerHour: candidates[0].ratePerHour, rate: candidates[0] };
  }
  // Fall back to legacy `ratePerHour` field.
  return {
    ratePerHour: resource.ratePerHour ?? 0,
    rate: resource.ratePerHour != null
      ? { kind: 'standard', ratePerHour: resource.ratePerHour }
      : null,
  };
}

/** All rate columns currently active on the date. Used by the Resource
 *  manager UI to render a "what does this resource cost on a given day"
 *  preview. */
export function activeRates(resource: ProjectResource, onDate?: string): ResourceRate[] {
  const out: ResourceRate[] = [];
  for (const kind of ['standard', 'overtime', 'weekend', 'prevailing', 'custom'] as const) {
    const r = resolveRate(resource, { kind, onDate });
    if (r.rate) out.push(r.rate);
  }
  return out;
}

/** Default starter table — when a user creates a resource and wants to
 *  add multi-rate support, pre-fill 4 of the 5 columns at sensible
 *  multipliers off their standard rate. */
export function defaultRateTable(standardRate: number): ResourceRate[] {
  return [
    { kind: 'standard', ratePerHour: standardRate },
    { kind: 'overtime', ratePerHour: standardRate * 1.5 },
    { kind: 'weekend', ratePerHour: standardRate * 2.0 },
    { kind: 'prevailing', ratePerHour: standardRate * 1.4 },
  ];
}
