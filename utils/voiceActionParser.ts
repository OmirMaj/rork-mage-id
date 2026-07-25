// voiceActionParser.ts — universal voice → in-app action.
//
// The GC taps the floating mic anywhere in the app and speaks. We
// transcribe, then this util reads intent and returns a structured
// draft for one of seven action kinds:
//
//   - 'rfi'      — Question for the architect / engineer / owner.
//   - 'co'       — Change order; out-of-scope work that changes price.
//   - 'note'     — Internal field note (no formal doc).
//   - 'project'  — Create a new project ("Smith kitchen remodel...").
//   - 'punch'    — Punch-list item ("hallway 2, light fixture loose").
//   - 'invoice'  — Invoice draft ("bill them for demolition, 2800").
//   - 'submittal'— Submittal ("door hardware schedule, spec 08 71 00").
//   - 'unsure'   — AI couldn't tell; the UI asks the GC to retry.
//
// GROUNDING: line items in 'co' and 'invoice' kinds carry a `priceStated`
// flag — true only when the contractor actually said the number. When
// priceStated is false, callers look up the rate from the cost book rather
// than trusting an AI-invented price. 'unsure' returns a clarifyQuestion
// so the UI can offer a one-tap follow-up instead of forcing a full re-record.
//
// The parser also gets a tiny project context (name, type, recent
// schedule items) so it can pick a sensible priority + assignee.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Project, ScheduleTask } from '@/types';

export const voiceActionSchema = z.object({
  kind: z.enum(['rfi', 'co', 'note', 'project', 'punch', 'invoice', 'submittal', 'lead', 'field_update', 'unsure']).catch('unsure').default('unsure'),
  // Why we chose this kind. Surfaces in the confirmation toast so the GC
  // can see the AI's read and quickly correct it.
  reasoning: z.string().default(''),

  // RFI fields
  subject: z.string().default(''),
  question: z.string().default(''),
  priority: z.enum(['low', 'normal', 'urgent']).catch('normal').default('normal'),
  assignedTo: z.string().default(''),
  dateRequired: z.string().default(''),

  // Change-order fields
  description: z.string().default(''),
  reason: z.string().default(''),
  scheduleImpactDays: z.number().default(0),
  changeAmount: z.number().default(0),
  lineItems: z.array(z.object({
    name: z.string().default(''),
    description: z.string().default(''),
    quantity: z.number().default(1),
    unit: z.string().default('lump'),
    unitPrice: z.number().default(0),
    // true only when the contractor explicitly stated the price in their voice
    // recording. false = price not stated; callers should look up from cost book.
    priceStated: z.boolean().default(false),
  })).default([]),

  // Note fields
  noteBody: z.string().default(''),

  // Project create fields. projectType MUST match ProjectType in
  // types/index.ts — otherwise PROJECT_TYPES.find(...).label resolves
  // to undefined and the project-detail screen crashes with
  // "Cannot read property 'charAt' of undefined".
  projectName: z.string().default(''),
  projectType: z.enum(['new_build','renovation','addition','remodel','commercial','landscape','roofing','flooring','painting','plumbing','electrical','concrete']).catch('renovation').default('renovation'),
  projectLocation: z.string().default(''),
  targetBudget: z.number().default(0),

  // Punch fields
  punchLocation: z.string().default(''),
  punchTrade: z.string().default('General'),
  punchPriority: z.enum(['low','medium','high']).catch('medium').default('medium'),

  // Invoice fields
  invoiceNotes: z.string().default(''),
  invoiceLineItems: z.array(z.object({
    name: z.string().default(''),
    description: z.string().default(''),
    quantity: z.number().default(1),
    unit: z.string().default('lump'),
    unitPrice: z.number().default(0),
    // true only when the contractor explicitly stated the price in their voice
    // recording. false = price not stated; callers should look up from cost book.
    priceStated: z.boolean().default(false),
  })).default([]),

  // Submittal fields
  submittalTitle: z.string().default(''),
  submittalSpecSection: z.string().default(''),
  submittalSubmittedBy: z.string().default(''),
  submittalRequiredDate: z.string().default(''),

  // Field-update fields — a single spoken log that fans out to several
  // systems at once (the voice jobsite-OS differentiator). Any subset may be
  // present; empty arrays / strings are skipped on apply.
  fieldWorkPerformed: z.string().default(''),
  fieldTimeEntries: z.array(z.object({
    trade: z.string().default(''),
    hours: z.number().default(0),
    notes: z.string().default(''),
  })).default([]),
  fieldScheduleUpdates: z.array(z.object({
    taskName: z.string().default(''),
    progressPercent: z.number().default(0),
  })).default([]),
  fieldMaterials: z.array(z.string()).default([]),

  // Lead (CRM) fields
  leadName: z.string().default(''),
  leadPhone: z.string().default(''),
  leadEmail: z.string().default(''),
  leadAddress: z.string().default(''),
  leadProjectType: z.string().default(''),
  leadScope: z.string().default(''),
  leadBudgetMin: z.number().default(0),
  leadBudgetMax: z.number().default(0),
  leadTimeline: z.string().default(''),
  leadSource: z.enum(['referral','website','houzz','angi','yelp','thumbtack','google','facebook','instagram','walk_in','repeat','sign','truck','other']).catch('other').default('other'),
  leadSourceOther: z.string().default(''),
  leadScore: z.number().default(0),
  leadScoreReason: z.string().default(''),

  // When kind === 'unsure': a short, specific question the GC can answer with
  // one phrase (rather than re-recording the whole thing). The UI shows this
  // as a one-tap follow-up chip. Empty string when not applicable.
  clarifyQuestion: z.string().default(''),
});

export type VoiceActionResult = z.infer<typeof voiceActionSchema>;

interface ParseOpts {
  transcript: string;
  project?: Project | null;
}

export async function parseVoiceAction(opts: ParseOpts): Promise<VoiceActionResult> {
  const { transcript, project } = opts;

  // Compact project context — the AI doesn't need the whole project, just
  // enough to set priority + a sensible default assignee.
  const ctxLines: string[] = [];
  if (project) {
    ctxLines.push(`Project: ${project.name}`);
    if (project.type) ctxLines.push(`Type: ${project.type}`);
    if (project.location) ctxLines.push(`Location: ${project.location}`);
    const tasks: ScheduleTask[] = (project.schedule?.tasks ?? []).slice(0, 8);
    if (tasks.length) {
      ctxLines.push('Recent schedule items:');
      for (const t of tasks) {
        ctxLines.push(`  - ${t.title} (${t.phase ?? 'phase ?'}) — ${t.progress}% ${t.status}`);
      }
    }
  } else {
    ctxLines.push('No project context — pick the most likely action kind based on the transcript alone.');
  }

  const aiResult = await mageAI({
    prompt: `You are a construction superintendent's voice assistant. The contractor just dictated something on site. Decide what kind of in-app action they want, then return a structured draft.

KINDS
- rfi: A question that needs an answer from architect / engineer / owner. ("ask the architect about the steel beam size", "we need to know the tile pattern", "submit an RFI about knob-and-tube")
- co: Out-of-scope work that needs a change order. ("owner wants the heat pump upgrade", "create a change order for forty-five hundred to redo the bath tile", "need to add a window in the basement")
- note: Internal field note — no formal document needed. ("remind me to call the inspector tomorrow", "framing on second floor is half done")
- project: Create a NEW project. ("new project: Smith kitchen remodel at 123 Main, eighty thousand budget", "start a project for the Patel bathroom")
- punch: Punch-list item discovered while walking the site. ("master bath, light fixture loose", "punch list item: hallway 2 paint touch-up", "kitchen GFCI outlet not working")
- invoice: Bill the client / send a bill / collect payment for work performed. ("invoice them for demolition, twenty-eight hundred", "bill 850 square feet of drywall at 2.50 a foot", "send an invoice for the kitchen demo", "I need to bill the homeowner", "draft a bill for ten hours of labor", "invoice the client", "create an invoice", "charge them for materials")
- submittal: A submittal package (cut sheets, shop drawings). ("submit door hardware schedule, spec 08 71 00", "light fixture cut sheets for the kitchen by Friday")
- lead: A NEW homeowner inquiry / sales lead — a potential customer the GC just talked to or got a message from. ("new lead: John Smith, 555 1234, kitchen remodel, found us on Houzz", "got a lead from referral — Jane wants a bathroom reno around 25 grand", "Patel family called about a two-story addition", "lead came in from Yelp, walk-in this morning")
- field_update: A daily field log that reports MULTIPLE things at once about work already done on THIS project — hours worked, task progress, and/or materials delivered. Pick this when the contractor is logging their day rather than asking a question or creating one document. ("log 3 hours framing, floor 2 drywall is 80 percent, 40 sheets of drywall delivered", "put me down for 6 hours today, rough plumbing done, electrical is half way", "we finished the foundation, spent 8 hours, got the rebar delivered")
- unsure: The intent is ambiguous and the contractor should re-record.

OUTPUT RULES
- For rfi: subject (≤80 chars), question, priority (urgent/normal/low), assignedTo, dateRequired (YYYY-MM-DD if a deadline given).
- For co: description (≤80 chars), reason, scheduleImpactDays, changeAmount (single $ if stated), lineItems (array of {name, description, quantity, unit, unitPrice, priceStated}). Set priceStated:true ONLY when the contractor explicitly said the dollar amount in their recording; priceStated:false when you inferred or invented the price.
- For note: noteBody.
- For project: projectName, projectType (one of: new_build, renovation, addition, remodel, commercial, landscape, roofing, flooring, painting, plumbing, electrical, concrete — pick the closest. "Kitchen remodel" -> remodel; "bathroom renovation" -> renovation; "ADU" -> new_build; "deck" -> addition), projectLocation, targetBudget.
- For punch: description (the issue), punchLocation, punchTrade ("Electrical","Plumbing","HVAC","Drywall","Painting","Flooring","Roofing","Concrete","Framing","Landscaping","General","Other"), punchPriority (low/medium/high).
- For invoice: invoiceNotes, invoiceLineItems (array of {name, description, quantity, unit, unitPrice, priceStated}). Set priceStated:true ONLY when the contractor explicitly said the dollar amount; priceStated:false otherwise — the app will look up the rate from their cost history.
- For submittal: submittalTitle, submittalSpecSection, submittalSubmittedBy, submittalRequiredDate.
- For lead: leadName (homeowner, title-case), leadPhone, leadEmail, leadAddress, leadProjectType (free-text like "Kitchen remodel"), leadScope (any extra detail), leadBudgetMin / leadBudgetMax (dollars), leadTimeline ("spring", "ASAP"), leadSource (referral/website/houzz/angi/yelp/thumbtack/google/facebook/instagram/walk_in/repeat/sign/truck/other), leadSourceOther (referrer name if applicable), leadScore (1-10 fit score — be honest), leadScoreReason (one short sentence).
- For field_update: fieldWorkPerformed (a one-line summary of the day's work), fieldTimeEntries (array of {trade, hours, notes} — one per crew/trade whose hours were stated; "put me down for 6 hours" with no trade -> trade "General"), fieldScheduleUpdates (array of {taskName, progressPercent} — match taskName to the schedule items in CONTEXT when possible; "done"/"finished" = 100, "halfway" = 50, "almost done" = 90), fieldMaterials (array of short strings for materials delivered, e.g. "40 sheets 5/8 drywall"). Only include the sub-parts actually mentioned.
- For unsure: DO NOT leave the contractor stuck. Set clarifyQuestion to ONE short, specific question that resolves the ambiguity — e.g. "Are you invoicing the client or recording a sub's bill?" or "Is this a change order or an internal note?". The app will show this as a one-tap follow-up instead of forcing a full re-record. Set reasoning to explain what was ambiguous.

Always set 'reasoning' to a one-sentence explanation of why you picked this kind, in the contractor's voice ("Sounds like an RFI because…").

CONTEXT
${ctxLines.join('\n')}

TRANSCRIPT
${transcript}`,
    schema: voiceActionSchema,
    schemaHint: {
      kind: 'rfi',
      reasoning: 'Sounds like an RFI because they asked about a spec.',
      subject: 'LVL beam size for kitchen island',
      question: 'What LVL spec should we use for the new kitchen island beam?',
      priority: 'urgent',
      assignedTo: 'Engineer',
      dateRequired: '',
      description: '',
      reason: '',
      scheduleImpactDays: 0,
      changeAmount: 0,
      lineItems: [],
      noteBody: '',
      projectName: '',
      projectType: 'renovation',
      projectLocation: '',
      targetBudget: 0,
      punchLocation: '',
      punchTrade: 'General',
      punchPriority: 'medium',
      invoiceNotes: '',
      invoiceLineItems: [],
      clarifyQuestion: '',
      submittalTitle: '',
      submittalSpecSection: '',
      submittalSubmittedBy: '',
      submittalRequiredDate: '',
      fieldWorkPerformed: '',
      fieldTimeEntries: [],
      fieldScheduleUpdates: [],
      fieldMaterials: [],
      leadName: '',
      leadPhone: '',
      leadEmail: '',
      leadAddress: '',
      leadProjectType: '',
      leadScope: '',
      leadBudgetMin: 0,
      leadBudgetMax: 0,
      leadTimeline: '',
      leadSource: 'other',
      leadSourceOther: '',
      leadScore: 0,
      leadScoreReason: '',
    },
    tier: 'fast',
  });

  if (!aiResult.success) {
    return voiceActionSchema.parse({
      kind: 'unsure',
      reasoning: 'AI is unavailable right now — try again in a moment.',
    });
  }
  return aiResult.data as VoiceActionResult;
}
