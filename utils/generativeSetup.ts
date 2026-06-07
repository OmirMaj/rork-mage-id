// generativeSetup.ts — turn a committed estimate into a working project.
//
// The moment a GC wins a job, there's a pile of setup work between "I have an
// estimate" and "I'm running the project": break the estimate into buyout
// packages by trade, stand up a submittal log, draft a schedule. Most of that
// is mechanical — it's all derivable from the estimate line items — but it's an
// hour of clicking that nobody does, so projects limp along with no buyout
// structure and the Living Estimate (utils/livingEstimate) has nothing to
// track buyout variance against.
//
// This builds a PLAN from the estimate — deterministically, no AI, no network —
// that the setup screen previews and then applies through the normal
// ProjectContext adders. The schedule is the one optional, AI-generated piece
// and is handled separately by the screen (utils/autoScheduleFromEstimate).
//
// Honesty rules this file lives by:
//   • We create buyout packages (status 'open') — NOT commitments. A commitment
//     means a signed sub; we don't fabricate those. Packages become commitments
//     at award, which is where buyout variance is born.
//   • We create submittal STUBS the user edits — derived from which CSI
//     divisions actually appear in the estimate, not invented.
//   • We never duplicate: divisions already covered by a package, and
//     submittals that already exist, are skipped (caller passes existing).

import type { Project, BidPackage, Submittal, LinkedEstimateItem } from '@/types';
import { CSI_DIVISION_BY_NUMBER, classifyToCSIDivision } from '@/utils/csiMasterFormat';

const UNCATEGORIZED = '00';

export interface BidPackagePlan {
  /** CSI division title, e.g. "Concrete". */
  name: string;
  /** Two-digit division number. "00" = couldn't classify. */
  csiDivision: string;
  scopeDescription: string;
  linkedEstimateItemIds: string[];
  estimateBudget: number;
  itemCount: number;
  /** Coarse construction phase for SOV/schedule grouping. */
  phase?: string;
}

export interface SubmittalPlan {
  title: string;
  /** Division number used as the spec section anchor. */
  specSection: string;
  csiDivision: string;
}

export interface GenerativeSetupPlan {
  packages: BidPackagePlan[];
  submittals: SubmittalPlan[];
  totalPackagedBudget: number;
  /** Items we couldn't classify to a real division (folded into "00"). */
  uncategorizedItemCount: number;
  /** Divisions skipped because a package already covers them. */
  skippedExistingPackages: number;
  /** Submittal stubs skipped because one already exists for that section. */
  skippedExistingSubmittals: number;
}

/**
 * Coarse phase bucket per division — used to group the buyout into a
 * recognizable sequence (Sitework → Foundation → Shell → MEP → Finishes).
 * Optional; only set when we're confident.
 */
const DIVISION_PHASE: Record<string, string> = {
  '02': 'Sitework', '31': 'Sitework', '32': 'Sitework', '33': 'Sitework',
  '03': 'Foundation', '04': 'Structure & Shell', '05': 'Structure & Shell',
  '06': 'Structure & Shell', '07': 'Structure & Shell', '08': 'Structure & Shell',
  '21': 'MEP', '22': 'MEP', '23': 'MEP', '26': 'MEP', '27': 'MEP', '28': 'MEP',
  '09': 'Finishes', '10': 'Finishes', '11': 'Finishes', '12': 'Finishes',
};

/**
 * Submittal stubs that a division typically requires. Title is the starter the
 * GC edits; we only emit one when the division shows up in the estimate.
 */
const DIVISION_SUBMITTALS: Record<string, string> = {
  '03': 'Concrete mix design',
  '04': 'Masonry product data',
  '05': 'Structural steel shop drawings',
  '06': 'Millwork & casework shop drawings',
  '07': 'Roofing & waterproofing — product data + warranty',
  '08': 'Doors, frames & windows shop drawings',
  '09': 'Finish samples — paint, tile, flooring',
  '10': 'Specialties product data',
  '14': 'Elevator shop drawings',
  '22': 'Plumbing fixtures product data',
  '23': 'HVAC equipment product data',
  '26': 'Electrical fixtures & gear product data',
};

/** Normalize an estimate item to a 2-digit CSI division, classifying on the
 *  fly when the item carries no division. Returns "00" when nothing fits. */
function divisionFor(item: LinkedEstimateItem): string {
  const raw = item.csiDivision?.trim();
  if (raw && raw.length >= 2) return raw.slice(0, 2);
  const guess = classifyToCSIDivision(`${item.name} ${item.category}`.trim());
  return guess ?? UNCATEGORIZED;
}

function divisionTitle(num: string): string {
  if (num === UNCATEGORIZED) return 'General Requirements & Uncategorized';
  return CSI_DIVISION_BY_NUMBER[num]?.title ?? `Division ${num}`;
}

export interface BuildSetupPlanOptions {
  existingPackages?: BidPackage[];
  existingSubmittals?: Submittal[];
}

/**
 * Build the setup plan from a project's estimate. Pure — no side effects.
 * Returns an empty plan (no packages/submittals) when there's no estimate.
 */
export function buildSetupPlan(
  project: Project,
  opts: BuildSetupPlanOptions = {},
): GenerativeSetupPlan {
  const estimate = project.linkedEstimate;
  const existingPackages = opts.existingPackages ?? [];
  const existingSubmittals = opts.existingSubmittals ?? [];

  if (!estimate || estimate.items.length === 0) {
    return {
      packages: [],
      submittals: [],
      totalPackagedBudget: 0,
      uncategorizedItemCount: 0,
      skippedExistingPackages: 0,
      skippedExistingSubmittals: 0,
    };
  }

  // Divisions already covered by a non-cancelled package — don't double-create.
  const coveredDivisions = new Set(
    existingPackages
      .filter(p => p.status !== 'cancelled' && p.csiDivision)
      .map(p => (p.csiDivision as string).slice(0, 2)),
  );

  // Group items by division.
  const groups = new Map<string, LinkedEstimateItem[]>();
  let uncategorizedItemCount = 0;
  for (const item of estimate.items) {
    const div = divisionFor(item);
    if (div === UNCATEGORIZED) uncategorizedItemCount += 1;
    const list = groups.get(div) ?? [];
    list.push(item);
    groups.set(div, list);
  }

  const packages: BidPackagePlan[] = [];
  let skippedExistingPackages = 0;
  for (const [div, items] of groups) {
    if (coveredDivisions.has(div)) {
      skippedExistingPackages += 1;
      continue;
    }
    const budget = items.reduce((s, it) => s + (it.lineTotal ?? 0), 0);
    if (budget <= 0) continue;
    const sample = items
      .slice(0, 4)
      .map(it => it.name)
      .filter(Boolean)
      .join(', ');
    packages.push({
      name: divisionTitle(div),
      csiDivision: div,
      scopeDescription:
        sample +
        (items.length > 4 ? `, +${items.length - 4} more` : '') +
        ` (${items.length} estimate line${items.length === 1 ? '' : 's'})`,
      linkedEstimateItemIds: items.map(it => it.materialId),
      estimateBudget: budget,
      itemCount: items.length,
      phase: DIVISION_PHASE[div],
    });
  }
  packages.sort((a, b) => b.estimateBudget - a.estimateBudget);

  // Submittal stubs for divisions present in the estimate.
  const existingSections = new Set(
    existingSubmittals.map(s => (s.specSection ?? '').slice(0, 2)).filter(Boolean),
  );
  const submittals: SubmittalPlan[] = [];
  let skippedExistingSubmittals = 0;
  for (const div of groups.keys()) {
    const title = DIVISION_SUBMITTALS[div];
    if (!title) continue;
    if (existingSections.has(div)) {
      skippedExistingSubmittals += 1;
      continue;
    }
    submittals.push({ title, specSection: div, csiDivision: div });
  }
  submittals.sort((a, b) => a.csiDivision.localeCompare(b.csiDivision));

  return {
    packages,
    submittals,
    totalPackagedBudget: packages.reduce((s, p) => s + p.estimateBudget, 0),
    uncategorizedItemCount,
    skippedExistingPackages,
    skippedExistingSubmittals,
  };
}

/** Map a plan package to the shape ProjectContext.addBidPackage expects. */
export function packagePlanToBidPackage(
  plan: BidPackagePlan,
  projectId: string,
): Omit<BidPackage, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    projectId,
    name: plan.name,
    csiDivision: plan.csiDivision === UNCATEGORIZED ? undefined : plan.csiDivision,
    phase: plan.phase,
    scopeDescription: plan.scopeDescription,
    linkedEstimateItemIds: plan.linkedEstimateItemIds,
    estimateBudget: plan.estimateBudget,
    status: 'open',
  };
}

/** Map a plan submittal to the shape ProjectContext.addSubmittal expects.
 *  requiredDate defaults to +30 days; the GC adjusts on the submittal screen. */
export function submittalPlanToSubmittal(
  plan: SubmittalPlan,
  projectId: string,
): Omit<Submittal, 'id' | 'createdAt' | 'updatedAt' | 'number'> {
  const required = new Date();
  required.setDate(required.getDate() + 30);
  return {
    projectId,
    title: plan.title,
    specSection: plan.specSection,
    submittedBy: '',
    submittedDate: '',
    requiredDate: required.toISOString(),
    reviewCycles: [],
    currentStatus: 'pending',
    attachments: [],
  };
}
