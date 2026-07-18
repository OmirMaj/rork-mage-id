// utils/copilot/schedule/scheduleGaps.ts — schedule interview gap rules.
// A gap is emitted ONLY when the draft + grounding can't resolve the field.
import type { Gap, Grounding } from '../types';

export interface ScheduleDraft {
  startDate?: string | null;
  phased?: boolean | null;
  longLeadMilestones?: string[];
  crewCap?: number | null;
  weatherBuffer?: boolean | null;
}

export function scheduleGaps(draft: ScheduleDraft, grounding: Grounding): Gap[] {
  const d = grounding.data as {
    heavyCategories?: { name: string; total: number; hasLeadSignal: boolean }[];
    crewCapHistory?: number;
    weatherSensitive?: boolean;
    occupiedLikely?: boolean;
  };
  const gaps: Gap[] = [];

  // 1. Start date — ask if unset. NEVER auto-stamp today (startDate jump bug).
  if (draft.startDate == null) {
    gaps.push({
      field: 'startDate', impact: 0.9, kind: 'date',
      question: 'No start date is set — when do you break ground?',
      groundedDefault: { value: null, basis: 'not derivable — must be chosen' },
    });
  }

  // 2. Long-lead procurement — ask only for a heavy category with no lead signal.
  const unresolvedLead = (d.heavyCategories ?? []).filter(c => c.total >= 15000 && !c.hasLeadSignal);
  if (unresolvedLead.length > 0 && draft.longLeadMilestones == null) {
    const c = unresolvedLead[0];
    gaps.push({
      field: 'longLeadMilestones', impact: 0.7, kind: 'choice',
      question: `Your ${c.name.toLowerCase()} line is $${(c.total / 1000).toFixed(0)}k — that usually means a multi-week lead. Add a procurement milestone before install?`,
      groundedDefault: { value: [c.name], basis: `$${c.total.toLocaleString()} category, no lead recorded` },
      choices: [
        { label: 'Yes — add the milestone', value: [c.name], basis: 'keeps install off the critical path', recommended: true },
        { label: 'No — already on site', value: [] },
      ],
    });
  }

  // 3. Crew cap — default from history when we have it; ask only if absent.
  if (draft.crewCap == null && d.crewCapHistory == null && (d.heavyCategories ?? []).some(c => c.total >= 15000)) {
    gaps.push({
      field: 'crewCap', impact: 0.4, kind: 'number',
      question: 'How many on the heaviest crew?',
      groundedDefault: { value: 3, basis: 'no crew-size history yet — assuming 3' },
    });
  }

  // 4. Phasing — ask only when an occupied remodel is likely and unstated.
  if (draft.phased == null && d.occupiedLikely) {
    gaps.push({
      field: 'phased', impact: 0.5, kind: 'choice',
      question: 'Occupied remodel by the look of it — phase it by area, or can trades overlap?',
      groundedDefault: { value: false, basis: 'defaulting to overlapping trades' },
      choices: [
        { label: 'Trades can overlap', value: false, recommended: true },
        { label: 'Phase it by area', value: true },
      ],
    });
  }
  return gaps;
}
