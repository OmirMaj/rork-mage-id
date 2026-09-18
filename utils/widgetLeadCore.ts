// utils/widgetLeadCore.ts — telling a homeowner's own budget apart from the
// website widget's national ballpark on a lead.
//
// WHY (audit round 2, #24). supabase/functions/widget-estimate priced the
// homeowner's picks from a hard-coded table of published U.S. ranges and then
// saved that range into leads.budget_min / budget_max. From there it read as
// THEIR budget everywhere: "Budget min (theirs)" on the lead, "tuned to their
// budget" in Instant Bid (which then skipped asking the GC for his own
// ballpark), and on Convert the top of the range became Project.targetBudget
// marked setBy 'gc' — the portal and WIP use that as the contract value until
// an estimate exists. Nobody said that number: not him, not the homeowner.
//
// The edge function no longer writes those columns (the range stays in the
// lead's scope text, labelled "Instant Estimate shown: $X–$Y"). Leads captured
// BEFORE that fix still carry the range in both places, and updateLead writes
// the stored numbers back on every edit, so the app recognises it here instead
// of trusting the columns: a budget that is exactly the widget range printed
// in the same lead's scope is the widget's, not theirs.
//
// Pure: bun-executable by scripts/validate-widget-lead-budget.ts.

import type { Lead, ProjectType } from '@/types';
import { quotedFromTouches } from '@/utils/leadQuoteCore';
import { WIDGET_PROJECT_TYPES } from '@/utils/widgetEstimate';

/**
 * Widget scope id -> the app's ProjectType. KEEP IN SYNC with
 * WIDGET_TYPE_TO_PROJECT_TYPE in supabase/functions/widget-estimate/index.ts
 * (the validator diffs them). A scope with no honest match is left out, so the
 * lead's type stays unset rather than being guessed.
 */
export const WIDGET_TYPE_TO_PROJECT_TYPE: Record<string, ProjectType> = {
  kitchen_remodel: 'remodel',
  bathroom_remodel: 'remodel',
  whole_home_remodel: 'renovation',
  home_addition: 'addition',
  new_construction: 'new_build',
  adu: 'new_build',
  basement_finish: 'renovation',
  roof_replacement: 'roofing',
  flooring: 'flooring',
  commercial_ti: 'commercial',
};

/** The exact phrase widget-estimate prints ahead of the range in the scope. */
const BALLPARK_RX = /Instant Estimate shown: \$([\d,]+)\s*[–-]\s*\$([\d,]+)/;
const WIDGET_MARK_RX = /Instant Estimate (shown|could not price)/;

type LeadLike = Pick<Lead, 'source' | 'scope' | 'budgetMin' | 'budgetMax'>;

/** True for a lead the website widget created. */
export function isWidgetLead(lead: Pick<Lead, 'source' | 'scope'>): boolean {
  return lead.source === 'website' && WIDGET_MARK_RX.test(lead.scope ?? '');
}

/** The range the widget showed the homeowner, read from the lead's scope text. */
export function widgetBallparkOf(lead: Pick<Lead, 'source' | 'scope'>): { low: number; high: number } | null {
  if (lead.source !== 'website') return null;
  const m = BALLPARK_RX.exec(lead.scope ?? '');
  if (!m) return null;
  const low = Number(m[1].replace(/,/g, ''));
  const high = Number(m[2].replace(/,/g, ''));
  if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high < low) return null;
  return { low, high };
}

/**
 * The scope text with the widget's "Instant Estimate shown: $X–$Y" segment
 * removed — what an AI prompt should read. The rest (scope, size, finish,
 * zip, the homeowner's notes) is the homeowner's own input and stays.
 */
export function scopeWithoutBallpark(scope: string | undefined): string | undefined {
  if (!scope) return scope;
  const kept = scope
    .split(' \u00B7 ')
    .filter(part => !WIDGET_MARK_RX.test(part))
    .join(' \u00B7 ')
    .trim();
  return kept || undefined;
}

/**
 * The budget the homeowner actually gave, or nothing. A widget lead's stored
 * min/max that equal the ballpark in its scope are the widget's range (the
 * pre-fix write) and are dropped; any other figure was typed by the GC and is
 * kept. A widget lead that the widget could not price never had a range.
 */
export function statedBudgetOf(lead: LeadLike): { min?: number; max?: number } {
  const min = lead.budgetMin && lead.budgetMin > 0 ? lead.budgetMin : undefined;
  const max = lead.budgetMax && lead.budgetMax > 0 ? lead.budgetMax : undefined;
  const ballpark = widgetBallparkOf(lead);
  if (ballpark) {
    return {
      min: min === ballpark.low ? undefined : min,
      max: max === ballpark.high ? undefined : max,
    };
  }
  return { min, max };
}

/**
 * The project type to carry onto a converted project, or undefined. The
 * stored mapping first; for a widget lead captured before the edge function
 * wrote one, its label maps back to the widget scope id.
 */
export function projectTypeForLead(lead: Pick<Lead, 'source' | 'scope' | 'projectType' | 'projectTypeMapped'>): ProjectType | undefined {
  if (lead.projectTypeMapped) return lead.projectTypeMapped;
  if (!isWidgetLead(lead)) return undefined;
  const label = (lead.projectType ?? '').trim().toLowerCase();
  const scope = WIDGET_PROJECT_TYPES.find(t => t.label.toLowerCase() === label);
  return scope ? WIDGET_TYPE_TO_PROJECT_TYPE[scope.id] : undefined;
}

/**
 * The target budget a converted lead starts with. The GC's own latest quote
 * (utils/leadQuoteCore) wins; otherwise the budget the homeowner stated;
 * otherwise none — never a widget ballpark. `setBy: 'gc'` is honest for the
 * first and is what the conversion has always stamped for the second.
 */
export function targetBudgetSeedForLead(
  lead: LeadLike & Pick<Lead, 'touches'>,
  now: string,
): { amount: number; setAt: string; setBy: 'gc' } | undefined {
  const quoted = quotedFromTouches(lead.touches);
  if (quoted && quoted.amount > 0) return { amount: quoted.amount, setAt: now, setBy: 'gc' };
  const stated = statedBudgetOf(lead);
  const amount = stated.max ?? stated.min;
  return amount && amount > 0 ? { amount, setAt: now, setBy: 'gc' } : undefined;
}
