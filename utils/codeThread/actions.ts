/**
 * Code Thread — the draft builders behind "Add to Permits / Punch / RFI"
 * (CONTRACT C9). Pure: no React, no storage, no network. The action buttons
 * (components/codeThread/CodeThreadActions.tsx) hand these drafts to the
 * ProjectContext writers; nothing here files, sends or submits anything.
 *
 * Honesty rules baked in:
 * - A permit's jurisdiction is the AHJ (the issuing authority), NEVER the
 *   street address. No authority on file → '' (the permit form asks).
 * - A permit draft says 'Not filed yet' — it is a to-do, not a filing.
 * - An RFI draft is UNSENT: dateSubmitted '' and ball in the GC's court, so
 *   Waiting On files it as 'not sent yet', never as the architect being late.
 */
import type { Permit, PermitType, Project, PunchItem, RFI } from '@/types';
import type { CodeThreadSourceKind } from './types';

/** Keyword map from a code item's wording to the permit type it implies. */
export function permitTypeForCodeItem(text: string): PermitType {
  const t = (text || '').toLowerCase();
  if (/electric/.test(t)) return 'electrical';
  if (/plumb/.test(t)) return 'plumbing';
  if (/mechanical|hvac|duct/.test(t)) return 'mechanical';
  if (/demolition|\bdemo\b/.test(t)) return 'demolition';
  if (/fire|sprinkler|alarm/.test(t)) return 'fire';
  if (/occupancy|certificate of occupancy/.test(t)) return 'occupancy';
  return 'building';
}

export function permitDraftFromCodeItem(a: {
  project: Pick<Project, 'id' | 'name'>;
  text: string;
  authority: string | null;
  checkedOnLabel: string;
  today: string;
}): Omit<Permit, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    projectId: a.project.id,
    projectName: a.project.name,
    type: permitTypeForCodeItem(a.text),
    jurisdiction: (a.authority ?? '').trim(),
    status: 'applied',
    appliedDate: a.today,
    fee: 0,
    notes: `${a.text}\nFrom a code check on ${a.checkedOnLabel}. Not filed yet: update the status and date when you file.`,
  };
}

export function punchDraftFromCodeItem(a: {
  projectId: string;
  text: string;
  recordDateLabel: string;
  authority: string | null;
  nowISO: string;
  id: string;
  location?: string;
}): PunchItem {
  const description = `Code check: ${a.text}`.slice(0, 240);
  return {
    id: a.id,
    projectId: a.projectId,
    description,
    location: a.location ?? '',
    assignedSub: '',
    dueDate: '',
    priority: 'medium',
    status: 'open',
    listType: 'punch',
    createdAt: a.nowISO,
    updatedAt: a.nowISO,
  };
}

export function rfiDraftFromCodeItem(a: {
  projectId: string;
  text: string;
  authority: string | null;
  codes: string;
  submittedBy: string;
  nowISO: string;
}): Omit<RFI, 'id' | 'createdAt' | 'updatedAt' | 'number'> {
  const codes = (a.codes || '').trim() || 'model codes';
  return {
    projectId: a.projectId,
    subject: `Code question: ${a.text.slice(0, 80)}`,
    question: `Our code check (${codes}; ${a.authority ?? 'jurisdiction not on file'}) flagged: ${a.text}. Please confirm the requirement for this job and how you want it detailed.`,
    submittedBy: a.submittedBy,
    assignedTo: '',
    // UNSENT: an empty dateSubmitted is how Waiting On knows it was never sent.
    dateSubmitted: '',
    dateRequired: '',
    status: 'open',
    priority: 'normal',
    attachments: [],
    ballInCourt: 'gc',
  };
}

/** The route into the Code Check screen for a job (and optionally a source). */
export function codeCheckRoute(a: {
  projectId: string;
  source?: CodeThreadSourceKind;
  sourceId?: string;
  mode?: 'code' | 'roadmap';
}): { pathname: '/(tabs)/construction-ai'; params: Record<string, string> } {
  const params: Record<string, string> = { projectId: a.projectId };
  if (a.source !== undefined) params.source = a.source;
  if (a.sourceId !== undefined) params.sourceId = a.sourceId;
  if (a.mode !== undefined) params.mode = a.mode;
  return { pathname: '/(tabs)/construction-ai', params };
}
