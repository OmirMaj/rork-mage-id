/**
 * Code Thread — the job's own data, as the Code Check prompt sees it.
 *
 * Pure. What the block says is what `sent` says: the chip under the answer
 * ("Sent from this job: …") is built from the SAME pass that built the block,
 * so it can never claim a line the model was not handed.
 *
 * The zoning district goes in ONLY when a human confirmed it for this address
 * (isZoningConfirmed). A guessed district is never sent, not even labelled.
 */
import type { PlanSheet, Project, PunchItem } from '@/types';
import { projectTypeLabel } from '@/utils/projectTypes';
import { hashLeakText } from '@/utils/profitLeak/leakPrompt';
import { isZoningConfirmed } from '@/utils/automation/jurisdiction';
import type { CodeThreadSourceKind } from './types';

export type CodeCheckCategory = 'residential' | 'commercial' | 'electrical' | 'plumbing' | 'structural';

export function categoryForProject(p: Pick<Project, 'type'>): CodeCheckCategory {
  switch (p?.type) {
    case 'electrical': return 'electrical';
    case 'plumbing': return 'plumbing';
    case 'commercial': return 'commercial';
    case 'concrete': return 'structural';
    default: return 'residential';
  }
}

function sqftOf(project: Pick<Project, 'squareFootage'>): number {
  const n = Number(project?.squareFootage);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function scenarioForSource(args: {
  kind: CodeThreadSourceKind;
  project: Project;
  punch?: Pick<PunchItem, 'description' | 'location'> | null;
  sheet?: Pick<PlanSheet, 'sheetNumber' | 'name'> | null;
}): string {
  const { kind, project, punch, sheet } = args;
  if (kind === 'punch' && punch) {
    const description = (punch.description || '').trim() || 'an open punch item';
    const location = (punch.location || '').trim();
    return `Punch item: "${description}"${location ? ` at ${location}` : ''}. Is this a code issue, and what does the code usually require to fix it?`;
  }
  if (kind === 'plan_sheet' && sheet) {
    const num = (sheet.sheetNumber || '').trim();
    const title = (sheet.name || '').trim();
    const label = [num, title && title !== num ? title : ''].filter(Boolean).join(' ') || 'on file';
    return `Plan sheet ${label}: what code items does the work shown usually trigger, and what do inspectors commonly flag?`;
  }
  const typeLabel = projectTypeLabel(project) || 'construction';
  const sf = sqftOf(project);
  return `Check this job's scope for code items and inspections: ${typeLabel}${sf ? `, ${sf.toLocaleString()} sf` : ''}.`;
}

interface ContextLine { name: string; quantity: number | null; unit: string; category: string }

function estimateLinesOf(project: Project): ContextLine[] {
  const linked = project.linkedEstimate?.items;
  const src: { name?: string; quantity?: number; unit?: string; category?: string }[] =
    Array.isArray(linked) && linked.length > 0
      ? linked
      : Array.isArray(project.estimate?.materials) ? project.estimate!.materials : [];
  const out: ContextLine[] = [];
  for (const li of src) {
    const name = typeof li?.name === 'string' ? li.name.trim() : '';
    if (!name) continue;
    const q = Number(li.quantity);
    out.push({
      name,
      quantity: Number.isFinite(q) ? q : null,
      unit: typeof li.unit === 'string' ? li.unit.trim() : '',
      category: typeof li.category === 'string' ? li.category.trim() : '',
    });
  }
  return out;
}

function scopeNotesOf(project: Project): string {
  const parts = [project.scope?.scope, project.scope?.specialRequirements, project.description]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean);
  return parts.join(' / ').replace(/\s+/g, ' ').slice(0, 400);
}

export const MAX_CONTEXT_ESTIMATE_LINES = 40;

export function codeThreadContextBlock(project: Project): { block: string; sent: string[]; cacheFragment: string } {
  const lines: string[] = [];
  const sent: string[] = [];
  lines.push(`PROJECT CONTEXT (from "${project.name}", the contractor's own records):`);
  lines.push(`- Type: ${projectTypeLabel(project) || 'not set'}`);
  sent.push('type');

  const sf = sqftOf(project);
  if (sf > 0) {
    lines.push(`- Size: ${sf.toLocaleString()} sf`);
    sent.push(`${sf.toLocaleString()} sf`);
  }

  const notes = scopeNotesOf(project);
  if (notes) {
    lines.push(`- Scope notes: ${notes}`);
    sent.push('scope notes');
  }

  const all = estimateLinesOf(project);
  if (all.length > 0) {
    const shown = all.slice(0, MAX_CONTEXT_ESTIMATE_LINES);
    lines.push(`- Estimate lines (name — quantity unit, category), first ${MAX_CONTEXT_ESTIMATE_LINES}:`);
    for (const l of shown) {
      const qty = l.quantity === null ? 'qty not set' : `${l.quantity}${l.unit ? ` ${l.unit}` : ''}`;
      lines.push(`  - ${l.name} — ${qty}, ${l.category || 'no category'}`);
    }
    sent.push(
      shown.length < all.length
        ? `${shown.length} of ${all.length} estimate lines`
        : `${shown.length} estimate line${shown.length === 1 ? '' : 's'}`,
    );
  }

  const phases: string[] = [];
  for (const t of project.schedule?.tasks ?? []) {
    const ph = typeof t?.phase === 'string' ? t.phase.trim() : '';
    if (ph && !phases.includes(ph)) phases.push(ph);
  }
  if (phases.length > 0) {
    lines.push(`- Schedule phases: ${phases.join(', ')}`);
    sent.push(`${phases.length} schedule phase${phases.length === 1 ? '' : 's'}`);
  }

  if (isZoningConfirmed(project)) {
    const district = project.structuredAddress?.zoningDistrict?.trim();
    if (district) {
      lines.push(`- Zoning district: ${district} (confirmed by the contractor)`);
      sent.push('confirmed zoning');
    }
  }

  const block = lines.join('\n');
  return { block, sent, cacheFragment: hashLeakText(block, '', []) };
}
