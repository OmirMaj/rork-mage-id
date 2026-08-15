// utils/rateProvenance.ts — the rate-provenance chip's logic, as pure functions.
//
// WHY THIS EXISTS
// ---------------
// MAGE ID's cost book learns from closed jobs. It ALSO accepts "cost seeds" —
// rates the contractor merely STATED before they had any history here
// (utils/costSeedCore). The product rule is absolute:
//
//     A rate you STATED is never presented as a rate we MEASURED.
//
// That firewall is enforced in the engine (utils/costDatabase keeps seeds out
// of jobCount / jobsAnalyzed / bidBias) and in every AI prompt that can see a
// rate. But it was INVISIBLE on the estimate itself. A competitor's AI
// estimator and ours both emit plausible line items with plausible numbers;
// the only real difference is where the rate came from — and a contractor (or
// a prospect reading a screenshot) could not see it. components/estimate/
// RateProvenanceChip.tsx renders that difference on the row; this module is
// the part of it that decides WHAT it may say.
//
// It lives in utils/ (no react-native imports) so the firewall can be asserted
// by the bun validators, which cannot load a component.
//
// THE TRAP THIS MODULE EXISTS TO AVOID
// `fromHistory` is TRUE for a seeded rate — a book hit exists either way. It
// can never be the thing a caption or a colour is gated on. Everything here
// branches on `provenance`, and `tone` is 'measured' if and only if provenance
// is 'earned', so a stated rate can never inherit an earned rate's treatment.

import type { CostBookEntry } from '@/utils/costDatabase';
import { isSeedSample } from '@/utils/costSeedCore';

/** 'measured' is reachable ONLY from provenance 'earned'. That is the firewall. */
export type RateProvenanceTone = 'measured' | 'stated';

export interface RateProvenanceChipModel {
  provenance: 'earned' | 'seeded' | 'mixed';
  label: string;
  tone: RateProvenanceTone;
  jobCount: number;
}

/**
 * What the chip may say for a cost-book entry.
 *
 * Returns null — meaning RENDER NOTHING — when there is no book hit, no
 * provenance stamp, or an 'earned' entry with nothing actually measured behind
 * it. A chip we cannot justify is worse than no chip: silence is honest, a
 * guess is not.
 */
export function rateProvenanceChipModel(
  entry: CostBookEntry | null | undefined,
): RateProvenanceChipModel | null {
  if (!entry || !entry.provenance) return null;
  const jobCount = entry.jobCount ?? 0;
  const jobs = `${jobCount} job${jobCount === 1 ? '' : 's'}`;

  if (entry.provenance === 'earned') {
    // jobCount EXCLUDES seed samples by construction. An 'earned' entry that
    // still counts zero measured jobs has nothing to claim, so it says nothing.
    if (jobCount < 1) return null;
    return { provenance: 'earned', label: `MEASURED · ${jobs}`, tone: 'measured', jobCount };
  }
  if (entry.provenance === 'mixed') {
    return { provenance: 'mixed', label: `MIXED · ${jobs}`, tone: 'stated', jobCount };
  }
  // seeded — the contractor's own stated rate, nothing measured. Neutral tone,
  // and it never cites a job count, because there are none.
  return { provenance: 'seeded', label: 'YOU SET THIS', tone: 'stated', jobCount: 0 };
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

/**
 * Date range of the MEASURED samples only, for the drill-down sheet. Seed
 * samples are filtered out — a seed's `closedAt` is whatever the contractor
 * typed (often empty), never a job we watched. null when nothing measured
 * carries a usable date, so a seeded-only entry can never show a window.
 */
export function measuredWindow(entry: CostBookEntry): string | null {
  const stamps = (entry.samples ?? [])
    .filter(s => !isSeedSample(s))
    .map(s => s.closedAt)
    .filter((s): s is string => !!s)
    .sort();
  if (stamps.length === 0) return null;
  const first = monthLabel(stamps[0]);
  const last = monthLabel(stamps[stamps.length - 1]);
  if (!first || !last) return null;
  return first === last ? first : `${first} – ${last}`;
}
