// utils/profitLeak/scopeSummary.ts — deterministic scope text for the leak scan.
// Estimate items grouped by CSI division, then the GC's scope notes, then
// prior APPROVED change orders (already-captured additions are not leaks).
// Pure; never throws; capped so the prompt stays cheap on fast tier.
import type { ChangeOrder, LinkedEstimateItem, Project } from '@/types';
import { csiDivisionLabel } from '@/utils/csiMasterFormat';

export const MAX_SCOPE_CHARS = 6000;

export function buildScopeSummary(project: Project, changeOrders: ChangeOrder[]): string {
  try {
    const parts: string[] = [];
    const name = project?.name || 'This project';
    const meta: string[] = [];
    if (project?.type) meta.push(String(project.type));
    if (project?.squareFootage) meta.push(`${project.squareFootage} sf`);
    if (project?.quality) meta.push(String(project.quality));
    parts.push(`PROJECT: ${name}${meta.length ? ` (${meta.join(', ')})` : ''}`);

    const items: LinkedEstimateItem[] = project?.linkedEstimate?.items ?? [];
    if (items.length === 0) {
      parts.push('\nCONTRACTED SCOPE: No line-item estimate on file — judge only against the scope notes below.');
    } else {
      parts.push('\nCONTRACTED SCOPE (estimate line items):');
      const groups = new Map<string, LinkedEstimateItem[]>();
      for (const it of items) {
        const key = it.csiDivision ?? '';
        const bucket = groups.get(key);
        if (bucket) bucket.push(it); else groups.set(key, [it]);
      }
      for (const [division, group] of groups) {
        parts.push(division ? `${csiDivisionLabel(division)}:` : 'Other scope:');
        for (const it of group) {
          parts.push(`- ${it.category} — ${it.name} (${it.quantity} ${it.unit})`);
        }
      }
    }

    const notes = [project?.scope?.scope, project?.scope?.specialRequirements, project?.description]
      .map(s => (s ?? '').trim())
      .filter(Boolean);
    if (notes.length > 0) {
      parts.push('\nSCOPE NOTES:');
      for (const n of notes) parts.push(n);
    }

    const approved = (changeOrders ?? []).filter(c => c?.projectId === project?.id && c?.status === 'approved');
    if (approved.length > 0) {
      parts.push('\nALREADY APPROVED ADDITIONS (in scope — never flag these):');
      for (const c of approved) {
        const lineNames = (c.lineItems ?? []).map(l => l.name).filter(Boolean).join(', ');
        parts.push(`- CO #${c.number}: ${c.description}${lineNames ? ` (${lineNames})` : ''}`);
      }
    }

    const full = parts.join('\n');
    if (full.length <= MAX_SCOPE_CHARS) return full;
    return full.slice(0, MAX_SCOPE_CHARS - 22) + '\n…(scope truncated)';
  } catch {
    return 'PROJECT: (scope unavailable)';
  }
}
