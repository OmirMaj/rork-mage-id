// utils/projectTypes.ts
//
// Q6 · The ONE reader of a project's type for people and for the AI.
//
// The founder ran a whole-house repipe and the app had nowhere to put it. The
// fix adds a real 'other' type whose meaning lives in the contractor's own
// words (Project.projectTypeOther, column projects.project_type_other). Those
// words — never the id 'other', and never a raw id like 'new_build' — are what
// the job list, PDFs, the client portal, data export and the AI prompt lines
// print. Every such surface goes through projectTypeLabel below.
//
// Pure: no React, no Supabase. scripts/validate-project-types.ts runs it.

import { PROJECT_TYPES, type ProjectType } from '@/types';

/** Same bound as the column CHECK in 20260924160600_project_type_other.sql.
 *  A longer value would make PostgREST refuse the WHOLE project upsert, so
 *  every writer caps here first (projectTypeOtherColumn). */
export const PROJECT_TYPE_OTHER_MAX = 60;

/** Trimmed, inner whitespace collapsed, capped at PROJECT_TYPE_OTHER_MAX
 *  CHARACTERS (code points, as Postgres char_length counts them — slicing
 *  UTF-16 units could split an emoji into a lone surrogate, which Postgres
 *  refuses). Anything that is not a string reads as ''. */
export function cleanProjectTypeOther(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  return Array.from(collapsed).slice(0, PROJECT_TYPE_OTHER_MAX).join('').trim();
}

/** Ids that live in the column but not in the ProjectType union. award_rfp
 *  writes 'awarded_rfp' server-side (utils/autoBid.ts PROJECT_TYPE_TO_BID_CATEGORY). */
const OFF_UNION_LABELS: Readonly<Record<string, string>> = {
  awarded_rfp: 'Awarded bid',
};

const titleCaseId = (id: string) =>
  id.replace(/[_-]+/g, ' ').trim().replace(/\s+/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());

type TypeCarrier = { type?: string | null; projectTypeOther?: string | null } | null | undefined;

/**
 * What a person reads for this job's type.
 *   'other' + words → his words ("Whole-house repipe")
 *   'other', no words → "Other" (an old client, or a job typed before Q6)
 *   a known id → its PROJECT_TYPES label ("New Build", never "new_build")
 *   anything else → the id title-cased ("Awarded bid" for awarded_rfp)
 *   nothing → ''
 */
export function projectTypeLabel(p: TypeCarrier): string {
  const type = typeof p?.type === 'string' ? p.type.trim() : '';
  if (!type) return '';
  if (type === 'other') return cleanProjectTypeOther(p?.projectTypeOther) || 'Other';
  const known = PROJECT_TYPES.find(t => t.id === type);
  if (known) return known.label;
  return OFF_UNION_LABELS[type] ?? titleCaseId(type);
}

/** The value the project write sends for projects.project_type_other: his
 *  words when the type is 'other', NULL otherwise — so switching a job from
 *  Other to Roofing clears a stale description instead of leaving it behind. */
export function projectTypeOtherColumn(p: TypeCarrier): string | null {
  if (p?.type !== 'other') return null;
  return cleanProjectTypeOther(p.projectTypeOther) || null;
}

/** Row → Project: the column, cleaned; absent when NULL / blank. */
export function projectTypeOtherFromRow(v: unknown): string | undefined {
  return cleanProjectTypeOther(v) || undefined;
}

/** True for an id in the ProjectType union. */
export function isProjectType(v: unknown): v is ProjectType {
  return typeof v === 'string' && PROJECT_TYPES.some(t => t.id === v);
}

/** Why a type picker cannot save, or null when it can. Other needs words:
 *  "Other" alone tells nobody what the job is. The copy names what to type
 *  and — honestly — where the words go: 'job' pickers save them on the job
 *  (job list, PDFs, portal); 'ai' pickers (JUDGES describe, Quick Estimate)
 *  create no job and only send them to the AI. */
export function projectTypeBlockReason(type: string, other: string | undefined, use: 'job' | 'ai' = 'job'): string | null {
  if (type !== 'other') return null;
  if (cleanProjectTypeOther(other)) return null;
  return use === 'ai'
    ? 'You picked Other. Describe the job in a few words, for example "Whole-house repipe", so the AI knows what kind of job it is pricing.'
    : 'You picked Other. Describe the job in a few words, for example "Whole-house repipe". That is what the job list, PDFs and the client portal will show.';
}
