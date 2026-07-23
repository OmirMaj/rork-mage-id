// utils/profitLeak/scopeSummary.ts — deterministic scope text for the leak scan.
// Emit order (most important → least):
//   1. Project header
//   2. Scope notes (always survives truncation)
//   3. Already-captured additions — approved + draft/submitted/under_review/revised COs
//      (always survives truncation; the whole point is 'never flag these again')
//   4. Contracted scope / estimate items (truncated last, with a marker)
// Pure; never throws; capped so the prompt stays cheap on fast tier.
import type { ChangeOrder, LinkedEstimateItem, Project } from '@/types';
import { csiDivisionLabel } from '@/utils/csiMasterFormat';

export const MAX_SCOPE_CHARS = 6000;

// Statuses that mean the work is already captured — should not be re-flagged.
const CAPTURED_STATUSES = new Set(['approved', 'draft', 'submitted', 'under_review', 'revised']);

export function buildScopeSummary(project: Project, changeOrders: ChangeOrder[]): string {
  try {
    const name = project?.name || 'This project';
    const meta: string[] = [];
    if (project?.type) meta.push(String(project.type));
    if (project?.squareFootage) meta.push(`${project.squareFootage} sf`);
    if (project?.quality) meta.push(String(project.quality));
    const header = `PROJECT: ${name}${meta.length ? ` (${meta.join(', ')})` : ''}`;

    // ── Priority section: scope notes (always included) ──
    const noteParts: string[] = [];
    const notes = [project?.scope?.scope, project?.scope?.specialRequirements, project?.description]
      .map(s => (s ?? '').trim())
      .filter(Boolean);
    if (notes.length > 0) {
      noteParts.push('\nSCOPE NOTES:');
      for (const n of notes) noteParts.push(n);
    }

    // ── Priority section: already-captured additions (always included) ──
    // Include all non-rejected/non-void COs: approved, drafted, submitted, etc.
    const coParts: string[] = [];
    const captured = (changeOrders ?? []).filter(c => c?.projectId === project?.id && CAPTURED_STATUSES.has(c?.status));
    const approved = captured.filter(c => c.status === 'approved');
    const pending = captured.filter(c => c.status !== 'approved');
    if (approved.length > 0) {
      coParts.push('\nALREADY APPROVED ADDITIONS (in scope — never flag these):');
      for (const c of approved) {
        const lineNames = (c.lineItems ?? []).map(l => l.name).filter(Boolean).join(', ');
        coParts.push(`- CO #${c.number}: ${c.description}${lineNames ? ` (${lineNames})` : ''}`);
      }
    }
    if (pending.length > 0) {
      coParts.push('\nALREADY CAPTURED ADDITIONS — DRAFTED OR PENDING (do not flag again):');
      for (const c of pending) {
        const lineNames = (c.lineItems ?? []).map(l => l.name).filter(Boolean).join(', ');
        coParts.push(`- CO #${c.number} [${c.status}]: ${c.description}${lineNames ? ` (${lineNames})` : ''}`);
      }
    }

    // ── Estimate items section (truncated last, with a marker) ──
    const items: LinkedEstimateItem[] = project?.linkedEstimate?.items ?? [];
    const estimateLines: string[] = [];
    if (items.length === 0) {
      estimateLines.push('\nCONTRACTED SCOPE: No line-item estimate on file — judge only against the scope notes below.');
    } else {
      estimateLines.push('\nCONTRACTED SCOPE (estimate line items):');
      const groups = new Map<string, LinkedEstimateItem[]>();
      for (const it of items) {
        const key = it.csiDivision ?? '';
        const bucket = groups.get(key);
        if (bucket) bucket.push(it); else groups.set(key, [it]);
      }
      for (const [division, group] of groups) {
        estimateLines.push(division ? `${csiDivisionLabel(division)}:` : 'Other scope:');
        for (const it of group) {
          estimateLines.push(`- ${it.category} — ${it.name} (${it.quantity} ${it.unit})`);
        }
      }
    }

    // Assemble: header + notes + CO sections are always kept whole.
    // Estimate items are the only section that gets truncated.
    const priorityText = [header, ...noteParts, ...coParts].join('\n');
    const estimateText = estimateLines.join('\n');
    const full = `${priorityText}\n${estimateText}`;

    if (full.length <= MAX_SCOPE_CHARS) return full;

    // Truncate only the estimate-items tail; priority sections are intact.
    const budget = MAX_SCOPE_CHARS - priorityText.length - 30;
    if (budget <= 0) {
      // Extreme edge: even the priority text is huge — clip it.
      return priorityText.slice(0, MAX_SCOPE_CHARS - 22) + '\n…(scope truncated)';
    }
    const truncatedEstimate = estimateText.slice(0, budget) + '\n…(estimate items truncated)';
    return `${priorityText}\n${truncatedEstimate}`;
  } catch {
    return 'PROJECT: (scope unavailable)';
  }
}
