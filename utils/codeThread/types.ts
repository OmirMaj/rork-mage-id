/**
 * Code Thread — the shapes behind a job-aware, saved code check.
 *
 * A code check run against a job becomes a CodeCheckRecord: a snapshot of
 * what was SENT (the job data, the jurisdiction grounding, the answers to the
 * follow-ups) and what came back. The records are local (utils/codeThread/
 * store.ts) and erased on sign-out. CONTRACT C7 — the job page (L4) reads
 * these shapes; change them in lock-step with components/codeThread/*.
 */

export type CodeThreadSourceKind = 'project' | 'punch' | 'plan_sheet' | 'manual';

export interface CodeThreadSource { kind: CodeThreadSourceKind; id?: string; label?: string }

export type CodeThreadSection = 'codes' | 'permits' | 'inspections' | 'violations';

export interface CodeThreadAnswer { questionId: string; question: string; answer: string }

export interface CodeThreadFollowUp { id: string; question: string; options: string[] }

export interface CodeCheckGroundingSnapshot {
  authority: string | null;
  codes: string;
  checkedOn: string | null;
  grounded: boolean;
  chipLabel: string;
  buildingRecordKind: 'none' | 'attention' | 'no_active_in_checked' | 'incomplete' | 'not_checked';
  buildingRecordHeadline: string | null;
  departmentName: string | null;
  jobDataSent: string[];
}

export type CodeThreadActionKind = 'permit' | 'punch' | 'rfi' | 'roadmap';

export interface CodeThreadActionRecord { kind: CodeThreadActionKind; section: CodeThreadSection; index: number; createdId: string | null; at: string }

export interface CodeCheckResultSnapshot {
  summary: string;
  applicableCodes: { code: string; section: string; requirement: string }[];
  permitsRequired: string[];
  inspections: string[];
  commonViolations: string[];
}

export interface CodeCheckRecord {
  id: string;
  projectId: string;
  createdAt: string;
  updatedAt: string;
  source: CodeThreadSource;
  category: string;
  categoryLabel: string;
  scenario: string;
  address: string;
  answers: CodeThreadAnswer[];
  followUps: CodeThreadFollowUp[];
  grounding: CodeCheckGroundingSnapshot;
  result: CodeCheckResultSnapshot;
  disclaimer: string;
  recallNote: string;
  actions: CodeThreadActionRecord[];
}
