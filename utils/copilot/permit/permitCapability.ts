// utils/copilot/permit/permitCapability.ts — the Permit Copilot capability.
//
// Log a permit as you pull it ("pulled the electrical permit from the county,
// number E-2231, expires in six months, fee was 420") → the interview fills the
// type/jurisdiction it needs → addPermit files it and drops you on the permit
// log. Adder-based (ProjectContext, ctx.ctx); computes a relative expiry from
// "in N months/years" so you don't do the math.
import type { CopilotCapability, CopilotContext, Gap, Grounding } from '../types';
import type { PermitType, PermitStatus } from '@/types';
import { permitGaps, type PermitDraft } from './permitGaps';
import { buildPermitGrounding } from './permitGrounding';
import { addMonths } from '../dateMath';

export interface PermitApplied { route: '/permits'; projectId: string; params: { projectId: string } }

const TYPES: PermitType[] = ['building', 'electrical', 'plumbing', 'mechanical', 'demolition', 'grading', 'fire', 'occupancy', 'special_inspection', 'other'];
const asType = (v: unknown): PermitType | null => (typeof v === 'string' && (TYPES as string[]).includes(v) ? (v as PermitType) : null);

const STATUSES: PermitStatus[] = ['applied', 'under_review', 'approved', 'denied', 'expired', 'inspection_scheduled', 'inspection_passed', 'inspection_failed'];
const asStatus = (v: unknown): PermitStatus | null => (typeof v === 'string' && (STATUSES as string[]).includes(v) ? (v as PermitStatus) : null);

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) && v >= 0 ? v : null);

export const permitCapability: CopilotCapability<PermitDraft, PermitApplied> = {
  id: 'permit',
  label: 'Log a permit',
  aiFeature: 'voiceCapture',
  maxQuestions: 2,
  askThreshold: 0.4,
  suggestions: [
    'Pulled the electrical permit from the county, number E-2231, expires in six months',
    'Building permit approved by the city, fee was 1,200',
  ],
  topicChecklist: [
    { label: 'Type', hint: 'building / electrical / …' },
    { label: 'Jurisdiction', hint: 'city or county' },
    { label: 'Status', hint: 'applied / approved' },
  ],
  copy: {
    voiceTitle: 'Log a permit',
    composeEyebrow: 'A PERMIT UPDATE',
    composeQuestion: 'What’s the permit?',
    composeHint: 'Which permit, who issued it, the number, expiry, fee — whatever you have.',
    reviewHeadline: 'Here’s your permit, ready to log.',
    reviewSub: 'Review it, then save. It shows on the permit log and drives expiry + inspection reminders.',
    buildingLabel: 'Logging the permit…',
    webRoute: '/permits',
  },
  buildGrounding: buildPermitGrounding,
  gaps: (draft: PermitDraft, grounding: Grounding): Gap[] => permitGaps(draft, grounding),

  buildTurnPrompt: ({ transcript, draft, grounding, asking }) => ({
    prompt: [
      'You are MAGE Copilot logging a construction permit for a contractor.',
      'Extract ONLY what they stated — a null field is how you ASK, never invent:',
      '• type: building | electrical | plumbing | mechanical | demolition | grading |',
      '  fire | occupancy | special_inspection | other — only if clear; else null.',
      '• jurisdiction: the city/county/authority that issued it, if named.',
      '• permitNumber: the permit number, if given.',
      '• status: applied | under_review | approved | denied | expired — a "pulled" or',
      '  "issued" permit is "approved". Only if stated; else null.',
      '• fee: the permit fee in dollars, if given.',
      '• expiresInMonths: if they said it expires in N months/years, put the number of',
      '  MONTHS (a year = 12). Else null. Do NOT guess a date.',
      '',
      ...grounding.facts,
      '',
      'DRAFT SO FAR: ' + JSON.stringify(draft),
      asking ? `THEY ARE ANSWERING: "${asking.question}"` : '',
      'WHAT THEY SAID: ' + transcript,
      'Return ONLY the updated draft JSON.',
    ].filter(Boolean).join('\n'),
    schemaHint: { type: 'electrical', jurisdiction: 'County', permitNumber: 'E-2231', status: 'approved', fee: null, expiresInMonths: 6 },
  }),

  mergeDraft: (draft, aiJson): PermitDraft => ({
    // Validate here so a junk type can't suppress the type gap.
    type: asType(aiJson?.type) ?? draft.type ?? null,
    jurisdiction: typeof aiJson?.jurisdiction === 'string' ? aiJson.jurisdiction : draft.jurisdiction ?? null,
    permitNumber: typeof aiJson?.permitNumber === 'string' ? aiJson.permitNumber : draft.permitNumber ?? null,
    status: asStatus(aiJson?.status) ?? draft.status ?? null,
    fee: num(aiJson?.fee) ?? draft.fee ?? null,
    expiresInMonths: num(aiJson?.expiresInMonths) ?? draft.expiresInMonths ?? null,
    expiresDate: typeof aiJson?.expiresDate === 'string' ? aiJson.expiresDate : draft.expiresDate ?? null,
  }),

  apply: async (draft: PermitDraft, ctx: CopilotContext): Promise<PermitApplied> => {
    const project = ctx.project;
    if (!project) throw new Error('No project for this permit.');

    const today = new Date().toISOString().slice(0, 10);
    const type: PermitType = asType(draft.type) ?? 'building';
    const status: PermitStatus = asStatus(draft.status) ?? 'approved';
    const expiresDate = draft.expiresDate
      ?? (draft.expiresInMonths != null ? addMonths(today, draft.expiresInMonths) : undefined);

    ctx.ctx?.addPermit?.({
      projectId: ctx.projectId,
      projectName: project.name ?? 'Project',
      type,
      jurisdiction: (draft.jurisdiction ?? '').trim() || 'Local jurisdiction',
      status,
      appliedDate: today,
      fee: num(draft.fee) ?? 0,
      ...(draft.permitNumber ? { permitNumber: draft.permitNumber.trim() } : {}),
      ...(expiresDate ? { expiresDate } : {}),
    });
    return { route: '/permits', projectId: ctx.projectId, params: { projectId: ctx.projectId } };
  },
};
