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
// flag — true only when the contractor actually said the number. When it is
// not true the price is zeroed here (groundVoicePrices) and the preview says
// "No price said": an AI-invented price never reaches a CO or an invoice. 'unsure' returns a clarifyQuestion
// so the UI can offer a one-tap follow-up instead of forcing a full re-record.
//
// The parser also gets a tiny project context (name, type, recent
// schedule items) so it can pick a sensible priority + assignee.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Project, ScheduleTask } from '@/types';
import { projectTypeLabel } from '@/utils/projectTypes';
import { isMicScheduleEditUtterance, scheduleEditHref } from '@/utils/copilot/intentTable';
import { scheduleWritePathForRole } from '@/utils/fieldScheduleUpdate';

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
    // recording. Anything else has its unitPrice zeroed (groundVoicePrices).
    priceStated: z.boolean().default(false),
  })).default([]),

  // Note fields
  noteBody: z.string().default(''),

  // Project create fields. projectType is a type id OR, when no listed type
  // fits (an HVAC changeout, windows & doors), the kind of job in his own
  // words (Q6). It is NEVER written to a project as-is: the consumer
  // (components/UniversalMicButton.tsx) resolves it through
  // projectTypeFromParsedType, which only returns a ProjectType id (+ his
  // words for 'other'), so an off-list value can't reach a screen that
  // looks the type up. The schemaHint below is unchanged — projectType was
  // already a string there — so the relay's inferred schema doesn't move.
  projectName: z.string().default(''),
  projectType: z.string().catch('renovation').default('renovation'),
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
    // recording. Anything else has its unitPrice zeroed (groundVoicePrices).
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
    if (project.type) ctxLines.push(`Type: ${projectTypeLabel(project)}`);
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
- For co: description (≤80 chars), reason, scheduleImpactDays, changeAmount (single $ if stated), lineItems (array of {name, description, quantity, unit, unitPrice, priceStated}). Set priceStated:true ONLY when the contractor explicitly said the dollar amount for that line; otherwise priceStated:false and unitPrice 0 — never guess a price. A single total he said for the whole change goes in changeAmount, not spread over the lines.
- For note: noteBody.
- For project: projectName, projectType (one of: new_build, renovation, addition, remodel, commercial, landscape, roofing, flooring, painting, plumbing, electrical, concrete — pick the closest. "Kitchen remodel" -> remodel; "bathroom renovation" -> renovation; "ADU" -> new_build; "deck" -> addition; "repipe" -> plumbing; "rewire" or "panel upgrade" -> electrical. If NONE of them fits — e.g. an HVAC changeout, or windows & doors — write the kind of job in 2-5 of his words instead, e.g. "HVAC changeout"), projectLocation, targetBudget.
- For punch: description (the issue), punchLocation, punchTrade ("Electrical","Plumbing","HVAC","Drywall","Painting","Flooring","Roofing","Concrete","Framing","Landscaping","General","Other"), punchPriority (low/medium/high).
- For invoice: invoiceNotes, invoiceLineItems (array of {name, description, quantity, unit, unitPrice, priceStated}). Set priceStated:true ONLY when the contractor explicitly said the dollar amount; otherwise priceStated:false and unitPrice 0 — never guess a price; he fills it in on the invoice.
- For submittal: submittalTitle, submittalSpecSection, submittalSubmittedBy, submittalRequiredDate.
- For lead: leadName (homeowner, title-case), leadPhone, leadEmail, leadAddress, leadProjectType (free-text like "Kitchen remodel"), leadScope (any extra detail), leadBudgetMin / leadBudgetMax (dollars), leadTimeline ("spring", "ASAP"), leadSource (referral/website/houzz/angi/yelp/thumbtack/google/facebook/instagram/walk_in/repeat/sign/truck/other), leadSourceOther (referrer name if applicable), leadScore (1-10 fit score — be honest), leadScoreReason (one short sentence).
- For field_update: fieldWorkPerformed (a one-line summary of the day's work), fieldTimeEntries (array of {trade, hours, notes} — one per crew/trade whose hours were stated; "put me down for 6 hours" with no trade -> trade "General"), fieldScheduleUpdates (array of {taskName, progressPercent} — match taskName to the schedule items in CONTEXT when possible; "done"/"finished" = 100, "halfway" = 50, "almost done" = 90), fieldMaterials (array of short strings for materials delivered, e.g. "40 sheets 5/8 drywall"). Only include the sub-parts actually mentioned.
- For unsure: DO NOT leave the contractor stuck. Set clarifyQuestion to ONE short, specific question that resolves the ambiguity — e.g. "Are you invoicing the client or recording a sub's bill?" or "Is this a change order or an internal note?". The app will show this as a one-tap follow-up instead of forcing a full re-record. Set reasoning to explain what was ambiguous.

- Arrays: one entry per thing the contractor actually said, and an EMPTY array when they said nothing of that kind — never a blank entry.

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
  return resolveMicScheduleUpdates(
    groundVoicePrices(dropBlankVoiceEntries(aiResult.data as VoiceActionResult)),
    project?.schedule?.tasks ?? [],
  );
}

/**
 * Money only lands when he said it (integration review, wave 6).
 *
 * Once the array hints were filled (E8) line items survived Zod for the first
 * time, and with them any price the model made up: "owner wants the heat pump
 * upgrade" filed a draft CO at $8,500, "send an invoice for the kitchen demo"
 * prefilled $3,200. The prompt asks the model to flag those (priceStated:
 * false); the mic and the invoice prefill never read the flag. So:
 *   · a line whose price he did not state is filed at $0 — the preview says
 *     "No price said" and he types it on the next screen;
 *   · a CO whose lines are all unpriced but which carries a stated total in
 *     changeAmount ("six grand total", "forty-five hundred to redo the tile")
 *     returns NO lines, so the mic's changeAmount fallback files that amount —
 *     exactly how every voice CO was filed before the arrays survived.
 * Pure; exported for scripts/validate-w6a-entry-mageai.ts.
 */
export function groundVoicePrices(r: VoiceActionResult): VoiceActionResult {
  const ground = (li: VoiceActionResult['lineItems'][number]) =>
    li.priceStated === true ? li : { ...li, unitPrice: 0, priceStated: false };
  const lineItems = (r.lineItems ?? []).map(ground);
  const invoiceLineItems = (r.invoiceLineItems ?? []).map(ground);
  const linesTotal = lineItems.reduce((s, li) => s + (Number(li.quantity) || 0) * (Number(li.unitPrice) || 0), 0);
  const stated = Number(r.changeAmount) || 0;
  const statedTotalOnly = r.kind === 'co' && linesTotal <= 0 && stated > 0;
  if (statedTotalOnly) return { ...r, lineItems: [], invoiceLineItems };
  // A mixed CO: "basement window twelve hundred, and extend the deck — six
  // grand total". The window's price is stated, the deck's is not, and the
  // total is. Filing only the lines filed $1,200 and lost the $6,000 he said.
  // The unpriced scope gets the REMAINDER of his stated total as one lump
  // line (named for that scope) — a number derived only from what he said,
  // so the lines add up to his total and nothing is invented.
  const unpriced = lineItems.filter((li) => li.priceStated !== true);
  if (r.kind === 'co' && linesTotal > 0 && stated > linesTotal && unpriced.length > 0) {
    const remainder = Math.round((stated - linesTotal) * 100) / 100;
    const names = unpriced.map((li) => li.name || li.description).filter(Boolean);
    const remainderLine = {
      name: names.join(' + ') || 'Remaining scope',
      description: `Rest of the $${stated.toLocaleString()} total you said`,
      quantity: 1, unit: 'lump', unitPrice: remainder, priceStated: true,
    };
    return { ...r, lineItems: [...lineItems.filter((li) => li.priceStated === true), remainderLine], invoiceLineItems };
  }
  return { ...r, lineItems, invoiceLineItems };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE ARRAYS (audit W6 A2, E8).
//
// The hint above gives lineItems / invoiceLineItems / fieldTimeEntries /
// fieldScheduleUpdates as `[]`. The relay builds Gemini's response schema from
// the hint, and an empty array becomes an array of STRINGS — so "framing 80%,
// 6 hours" came back as ["framing 80%"], Zod refused the strings, and the
// salvage emptied the field: no schedule progress, no hours, no line items,
// every time. mageAI now fills an empty-array hint field from the Zod element
// shape (utils/mageAI.ts fillEmptyArrayHints), so the model sees — and is held
// to — one object per entry. The price of an example element is that the
// model can echo it blank; those echoes are removed here, never filed.
// ─────────────────────────────────────────────────────────────────────────────

const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** Remove entries that carry nothing he said: a line item with no name and no
 *  description, an hours row with no hours, a progress row with no task. */
export function dropBlankVoiceEntries(r: VoiceActionResult): VoiceActionResult {
  const line = (li: VoiceActionResult['lineItems'][number]) => hasText(li?.name) || hasText(li?.description);
  return {
    ...r,
    lineItems: (r.lineItems ?? []).filter(line),
    invoiceLineItems: (r.invoiceLineItems ?? []).filter(line),
    fieldTimeEntries: (r.fieldTimeEntries ?? []).filter((t) => Number(t?.hours) > 0),
    fieldScheduleUpdates: (r.fieldScheduleUpdates ?? []).filter((u) => hasText(u?.taskName)),
    fieldMaterials: (r.fieldMaterials ?? []).filter(hasText),
  };
}

export interface FieldScheduleMatch {
  taskId: string;
  taskTitle: string;
  /** 0-100, rounded. */
  pct: number;
  /** The words he used for it. */
  spoken: string;
}

export interface FieldScheduleMatchResult {
  matched: FieldScheduleMatch[];
  /** Spoken task names that named no task on the schedule — say so, don't drop. */
  unmatched: string[];
  /** Spoken names that fit more than one task — not applied; he picks. */
  ambiguous: { spoken: string; candidates: string[] }[];
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Match spoken progress to tasks ONE UPDATE AT A TIME (E8).
 *
 * The mic used to walk the TASKS and give each the first update whose name
 * overlapped it, so "drywall 80%" set Drywall Hang AND Drywall Tape AND Drywall
 * Finish to 80, and an update that named nothing was silently lost. Here each
 * spoken update picks at most one task: an exact title first, else the single
 * task whose title contains the words (or is contained by them). Two or more
 * candidates is ambiguous and is not applied; none is reported. A task named
 * twice keeps the later figure (he corrected himself).
 */
export function matchFieldScheduleUpdates(
  tasks: readonly Pick<ScheduleTask, 'id' | 'title'>[],
  updates: readonly { taskName?: string; progressPercent?: number }[],
): FieldScheduleMatchResult {
  const out: FieldScheduleMatchResult = { matched: [], unmatched: [], ambiguous: [] };
  const byTask = new Map<string, FieldScheduleMatch>();
  for (const u of updates ?? []) {
    const spoken = (u?.taskName ?? '').trim();
    const said = normTitle(spoken);
    if (!said) continue;
    const exact = tasks.filter((t) => normTitle(t.title ?? '') === said);
    const loose = exact.length > 0 ? exact : tasks.filter((t) => {
      const title = normTitle(t.title ?? '');
      return !!title && (title.includes(said) || said.includes(title));
    });
    if (loose.length === 0) { out.unmatched.push(spoken); continue; }
    if (loose.length > 1) { out.ambiguous.push({ spoken, candidates: loose.map((t) => t.title) }); continue; }
    const t = loose[0];
    const pct = Math.max(0, Math.min(100, Math.round(Number(u?.progressPercent) || 0)));
    byTask.set(t.id, { taskId: t.id, taskTitle: t.title, pct, spoken });
  }
  out.matched = [...byTask.values()];
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE PREVIEW SHOWS FOR PROGRESS (W6 A2, E8).
//
// Filling the empty-array hints means fieldScheduleUpdates now arrive as real
// objects — the first time they ever survived Zod. The mic files them through
// matchFieldScheduleUpdates (one spoken update → at most one task). Here, before
// he confirms, each update is resolved the same way:
//   · its name is rewritten to the matched task's exact title, so the preview
//     shows the task that will change, not the words he used;
//   · an update that fits several tasks, or none, is not kept, and is SAID in
//     `reasoning` (shown above the rows) — never silently dropped.
// The mic's old task-first loop ("drywall is done" → every drywall task done)
// is gone; scripts/validate-w6a-entry-mageai.ts pins that it stays gone.
// Pure; exported for that validator.
// ─────────────────────────────────────────────────────────────────────────────

export function resolveMicScheduleUpdates(
  r: VoiceActionResult,
  tasks: readonly Pick<ScheduleTask, 'id' | 'title'>[],
): VoiceActionResult {
  const updates = r.fieldScheduleUpdates ?? [];
  // Only a daily log files progress; other kinds never read these rows.
  if (updates.length === 0 || r.kind !== 'field_update') return r;
  const m = matchFieldScheduleUpdates(tasks, updates);
  const kept: VoiceActionResult['fieldScheduleUpdates'] = m.matched.map((x) => ({ taskName: x.taskTitle, progressPercent: x.pct }));
  const notes: string[] = [];
  for (const a of m.ambiguous) notes.push(`"${a.spoken}" fits ${a.candidates.join(' and ')}`);
  if (m.unmatched.length) notes.push(`${m.unmatched.map((u) => `"${u}"`).join(', ')} ${m.unmatched.length === 1 ? 'is' : 'are'} not on the schedule`);
  if (notes.length === 0) return { ...r, fieldScheduleUpdates: kept };
  const said = `Progress not applied: ${notes.join('; ')} — say the exact task name.`;
  return { ...r, fieldScheduleUpdates: kept, reasoning: r.reasoning ? `${r.reasoning} ${said}` : said };
}

/**
 * "Add three tasks after rough-in" said into the global mic is a change to
 * the running schedule, not a note or an RFI — and the mic's parser has no
 * kind for it. When the job has tasks and the words START with an imperative
 * add of new tasks ("add three tasks…", "insert a milestone…", "can you add a
 * task…" — see isMicScheduleEditUtterance; nothing looser, so a daily log that
 * mentions the schedule is still filed), this is where the mic should send
 * him instead of spending a parse: the Schedule tab's editor, seeded with
 * exactly what he said. Null = parse as before.
 */
export function scheduleEditRouteForTranscript(
  transcript: string,
  project: Pick<Project, 'id'> & { myRole?: Project['myRole'] | null; schedule?: { tasks?: readonly { title?: string | null }[] | null } | null } | null | undefined,
) {
  const words = (transcript ?? '').trim();
  const tasks = project?.schedule?.tasks;
  if (!project || !words || !Array.isArray(tasks) || tasks.length === 0) return null;
  // Only a seat that can write the plan is sent to the editor. A field or
  // viewer seat's editor refuses the change, and by then his words were never
  // parsed — nothing is filed. Those seats keep today's parse (review round 2).
  if (scheduleWritePathForRole(project.myRole) !== 'row') return null;
  if (!isMicScheduleEditUtterance(words)) return null;
  return scheduleEditHref(project.id, words);
}
