// voiceFormParsers.ts — one parser per form type.
//
// The flow inside any form screen is:
//   1. User taps an inline mic.
//   2. VoiceCaptureModal records + transcribes.
//   3. The transcript is handed to the parser for THAT form (e.g.
//      parseRFIFromTranscript, parseCOFromTranscript).
//   4. The parser returns a Partial<XYZFields> shape — only the fields
//      the AI was confident enough to populate. Empty / unknown fields
//      stay undefined so the form can do a clean MERGE without nuking
//      what the user typed.
//   5. The form merges the partial with current state, preferring AI
//      values when the field is currently empty, and APPENDING for
//      free-text long-form fields like "question" or "description".
//
// Every parser routes through mageAI -> Gemini, with a tight
// schema + schemaHint so the model returns structured JSON. If the
// AI errors out we return an empty partial — never a crash.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { Project } from '@/types';

// ───────────────────────────────────────────────
// RFI
// ───────────────────────────────────────────────

const rfiPartialSchema = z.object({
  subject: z.string().default(''),
  question: z.string().default(''),
  priority: z.enum(['low', 'normal', 'urgent']).catch('normal').default('normal'),
  assignedTo: z.string().default(''),
  dateRequired: z.string().default(''), // YYYY-MM-DD or ''
});
export type RFIPartial = z.infer<typeof rfiPartialSchema>;

export async function parseRFIFromTranscript(transcript: string, project?: Project | null): Promise<RFIPartial> {
  const ctx = project ? `Project: ${project.name}${project.type ? ` (${project.type})` : ''}` : 'No project context';
  const r = await mageAI({
    prompt: `Extract the fields for a Request for Information (RFI) from this dictation. The contractor is creating or editing an RFI form.

OUTPUT RULES
- subject: ≤80 chars, what the question is about. Title-case.
- question: full re-statement of the question, in clear sentence form.
- priority: 'urgent' if they said urgent / asap / today / blocker; 'low' if they said when you get a chance / no rush; otherwise 'normal'.
- assignedTo: best guess of who should answer ("Architect", "Engineer", "Owner", "Inspector", or a specific name if mentioned).
- dateRequired: ISO date YYYY-MM-DD if a "by" date was given (e.g., "need it by Friday"); else ''.
- Leave any field blank that the dictation doesn't speak to. Don't guess.

CONTEXT: ${ctx}
TRANSCRIPT: ${transcript}`,
    schema: rfiPartialSchema,
    schemaHint: { subject: 'LVL beam size for kitchen island', question: 'What LVL specification should we use for the new kitchen island beam?', priority: 'urgent', assignedTo: 'Engineer', dateRequired: '' },
    tier: 'fast',
  });
  if (!r.success) return rfiPartialSchema.parse({});
  return r.data as RFIPartial;
}

// ───────────────────────────────────────────────
// Change Order
// ───────────────────────────────────────────────

const coLineItemSchema = z.object({
  name: z.string().default(''),
  description: z.string().default(''),
  quantity: z.number().default(1),
  unit: z.string().default('lump'),
  unitPrice: z.number().default(0),
});

const coPartialSchema = z.object({
  description: z.string().default(''),
  reason: z.string().default(''),
  scheduleImpactDays: z.number().default(0),
  changeAmount: z.number().default(0),
  lineItems: z.array(coLineItemSchema).default([]),
});
export type COPartial = z.infer<typeof coPartialSchema>;

export async function parseCOFromTranscript(transcript: string, project?: Project | null): Promise<COPartial> {
  const ctx = project ? `Project: ${project.name}${project.type ? ` (${project.type})` : ''}` : 'No project context';
  const r = await mageAI({
    prompt: `Extract change-order fields from this dictation. The contractor is creating or editing a CO.

OUTPUT RULES
- description: ≤80 chars, what the change is. ("Heat pump upgrade — owner")
- reason: one of "Owner direction", "Field condition", "Code requirement", "Design change", "Unforeseen", or "" if unclear.
- scheduleImpactDays: days added/removed to schedule (negative for time saved). 0 if not stated.
- changeAmount: total $ if explicitly stated as a single number ("forty-five hundred" -> 4500); else 0.
- lineItems: array of {name, description, quantity, unit, unitPrice} when itemized work is mentioned. Quantity defaults to 1, unit to 'lump'.
- Leave any field blank/zero that the dictation doesn't speak to.

CONTEXT: ${ctx}
TRANSCRIPT: ${transcript}`,
    schema: coPartialSchema,
    schemaHint: {
      description: 'Heat pump upgrade — owner request',
      reason: 'Owner direction',
      scheduleImpactDays: 2,
      changeAmount: 4500,
      lineItems: [{ name: 'Heat pump unit', description: 'High-efficiency variable-speed', quantity: 1, unit: 'ea', unitPrice: 3800 }],
    },
    tier: 'fast',
  });
  if (!r.success) return coPartialSchema.parse({});
  return r.data as COPartial;
}

// ───────────────────────────────────────────────
// Submittal
// ───────────────────────────────────────────────

const submittalPartialSchema = z.object({
  title: z.string().default(''),
  specSection: z.string().default(''),
  submittedBy: z.string().default(''),
  requiredDate: z.string().default(''),
});
export type SubmittalPartial = z.infer<typeof submittalPartialSchema>;

export async function parseSubmittalFromTranscript(transcript: string, project?: Project | null): Promise<SubmittalPartial> {
  const ctx = project ? `Project: ${project.name}${project.type ? ` (${project.type})` : ''}` : 'No project context';
  const r = await mageAI({
    prompt: `Extract submittal fields from this dictation.

OUTPUT RULES
- title: ≤80 chars, what's being submitted ("Door hardware schedule", "Light fixture cut sheets").
- specSection: CSI section like "08 71 00" if stated; else ''.
- submittedBy: contractor or sub name if mentioned; else ''.
- requiredDate: ISO date YYYY-MM-DD if a deadline was stated; else ''.

CONTEXT: ${ctx}
TRANSCRIPT: ${transcript}`,
    schema: submittalPartialSchema,
    schemaHint: { title: 'Light fixture cut sheets — kitchen', specSection: '26 51 00', submittedBy: 'Acme Electric', requiredDate: '' },
    tier: 'fast',
  });
  if (!r.success) return submittalPartialSchema.parse({});
  return r.data as SubmittalPartial;
}

// ───────────────────────────────────────────────
// Punch Item — replaces the existing inferTradeFromText one-shot
// ───────────────────────────────────────────────

const punchPartialSchema = z.object({
  description: z.string().default(''),
  location: z.string().default(''),
  trade: z.string().default('General'),
  priority: z.enum(['low', 'medium', 'high']).catch('medium').default('medium'),
});
export type PunchPartial = z.infer<typeof punchPartialSchema>;

export async function parsePunchFromTranscript(transcript: string, project?: Project | null): Promise<PunchPartial> {
  const ctx = project ? `Project: ${project.name}${project.type ? ` (${project.type})` : ''}` : 'No project context';
  const r = await mageAI({
    prompt: `Extract punch-list item fields from a contractor walking the site.

OUTPUT RULES
- description: ≤80 chars, what needs fixing.
- location: where in the project ("Master bath", "Hallway 2", "Kitchen", "Front door", "Garage stairs"). Leave '' if not mentioned.
- trade: the specialty trade — one of "Electrical", "Plumbing", "HVAC", "Drywall", "Paint", "Tile", "Trim/Carpentry", "Doors/Hardware", "Cabinets", "Flooring", "Roofing", "Concrete", "Masonry", "Framing", "Insulation", "Landscaping", "Cleanup", "General". Pick the closest match.
- priority: 'high' for safety / blocking final / urgent; 'low' for cosmetic small touch-ups; else 'medium'.

CONTEXT: ${ctx}
TRANSCRIPT: ${transcript}`,
    schema: punchPartialSchema,
    schemaHint: { description: 'Light fixture loose, needs to be re-anchored', location: 'Master bath', trade: 'Electrical', priority: 'medium' },
    tier: 'fast',
  });
  if (!r.success) return punchPartialSchema.parse({});
  return r.data as PunchPartial;
}

// ───────────────────────────────────────────────
// Invoice
// ───────────────────────────────────────────────

const invoiceLineSchema = z.object({
  name: z.string().default(''),
  description: z.string().default(''),
  quantity: z.number().default(1),
  unit: z.string().default('lump'),
  unitPrice: z.number().default(0),
});

const invoicePartialSchema = z.object({
  notes: z.string().default(''),
  dueDate: z.string().default(''),
  lineItems: z.array(invoiceLineSchema).default([]),
});
export type InvoicePartial = z.infer<typeof invoicePartialSchema>;

export async function parseInvoiceFromTranscript(transcript: string, project?: Project | null): Promise<InvoicePartial> {
  const ctx = project ? `Project: ${project.name}${project.type ? ` (${project.type})` : ''}` : 'No project context';
  const r = await mageAI({
    prompt: `Extract invoice fields from this dictation.

OUTPUT RULES
- notes: free-text note for the client; '' if none.
- dueDate: ISO date YYYY-MM-DD when payment is due; '' if not stated.
- lineItems: array of {name, description, quantity, unit, unitPrice} when work to be billed is mentioned. Default quantity 1, unit 'lump'.

CONTEXT: ${ctx}
TRANSCRIPT: ${transcript}`,
    schema: invoicePartialSchema,
    schemaHint: { notes: 'Net 15. Late fee 1.5%/mo on unpaid balance.', dueDate: '', lineItems: [{ name: 'Demolition — kitchen', description: 'Remove cabinets, countertops, flooring', quantity: 1, unit: 'lump', unitPrice: 2800 }] },
    tier: 'fast',
  });
  if (!r.success) return invoicePartialSchema.parse({});
  return r.data as InvoicePartial;
}

// ───────────────────────────────────────────────
// Project Create / Edit
// ───────────────────────────────────────────────

const projectPartialSchema = z.object({
  name: z.string().default(''),
  // Must match ProjectType in types/index.ts — see voiceActionParser
  // for the full reasoning. Wrong values cause downstream crashes.
  type: z.enum(['new_build','renovation','addition','remodel','commercial','landscape','roofing','flooring','painting','plumbing','electrical','concrete']).catch('renovation').default('renovation'),
  location: z.string().default(''),
  targetBudget: z.number().default(0),
  startDate: z.string().default(''),
  notes: z.string().default(''),
});
export type ProjectPartial = z.infer<typeof projectPartialSchema>;

export async function parseProjectFromTranscript(transcript: string): Promise<ProjectPartial> {
  const r = await mageAI({
    prompt: `Extract project fields from this dictation. The contractor is creating or editing a project.

OUTPUT RULES
- name: short project name. If they say "Smith kitchen remodel", use that. Title-case.
- type: one of new_build / renovation / addition / remodel / commercial / landscape / roofing / flooring / painting / plumbing / electrical / concrete. Pick the closest. ("Kitchen remodel" -> remodel. "Bathroom renovation" -> renovation. "ADU" or "new construction" -> new_build. "Deck" -> addition.)
- location: street + city if stated.
- targetBudget: dollar amount if stated. "Eighty thousand" -> 80000. 0 if not stated.
- startDate: YYYY-MM-DD if a start date was mentioned; '' otherwise.
- notes: any catch-all detail that doesn't fit other fields.

TRANSCRIPT: ${transcript}`,
    schema: projectPartialSchema,
    schemaHint: { name: 'Smith Kitchen Remodel', type: 'remodel', location: '123 Main St, San Diego, CA', targetBudget: 80000, startDate: '', notes: 'Two-week timeline, owner wants quartz counters and shaker cabinets.' },
    tier: 'fast',
  });
  if (!r.success) return projectPartialSchema.parse({});
  return r.data as ProjectPartial;
}

// ───────────────────────────────────────────────
// Estimate line item — single line at a time
// ───────────────────────────────────────────────

const estimateLineSchema = z.object({
  name: z.string().default(''),
  description: z.string().default(''),
  quantity: z.number().default(1),
  unit: z.string().default('lump'),
  unitPrice: z.number().default(0),
  category: z.enum(['material', 'labor', 'subcontract', 'other']).catch('other').default('other'),
});
export type EstimateLinePartial = z.infer<typeof estimateLineSchema>;

export async function parseEstimateLineFromTranscript(transcript: string): Promise<EstimateLinePartial> {
  const r = await mageAI({
    prompt: `Extract a single estimate line item from this dictation. Contractor is dictating one line at a time.

OUTPUT RULES
- name: short product/service name.
- description: extra detail if provided.
- quantity: numeric. Default 1.
- unit: 'ea', 'lf', 'sf', 'sqyd', 'cy', 'hr', 'lump', etc. Default 'lump'.
- unitPrice: dollar amount per unit.
- category: 'material' for goods, 'labor' for hours, 'subcontract' for subbed work, 'other' for fees / permits / dump.

TRANSCRIPT: ${transcript}`,
    schema: estimateLineSchema,
    schemaHint: { name: 'Drywall', description: '5/8" type-X fire-rated', quantity: 28, unit: 'sheet', unitPrice: 18, category: 'material' },
    tier: 'fast',
  });
  if (!r.success) return estimateLineSchema.parse({});
  return r.data as EstimateLinePartial;
}

// ───────────────────────────────────────────────
// Helper: merge an AI partial into existing form state.
// Empty current values get filled. Filled long-form fields get APPENDED
// (so dictation "adds to" the existing question / description). Numeric
// fields only overwrite if the AI returned non-zero.
// ───────────────────────────────────────────────

export function mergeText(current: string, parsed: string, mode: 'replace-if-empty' | 'append' = 'replace-if-empty'): string {
  if (!parsed) return current;
  if (!current) return parsed;
  if (mode === 'append') return `${current} ${parsed}`.trim();
  return current; // replace-if-empty and current is non-empty -> keep
}

export function pickIfEmpty<T>(current: T | undefined | null | '', parsed: T): T {
  if (current === undefined || current === null || (typeof current === 'string' && current === '')) return parsed;
  if (typeof current === 'number' && current === 0 && typeof parsed === 'number' && parsed !== 0) return parsed;
  return current as T;
}

/**
 * Sentence-case a string — capitalize the first letter of each
 * comma-separated clause, leave the rest alone. Used for punch
 * descriptions and other free-text the AI returns lowercase
 * ("master bath, light fixture loose" → "Master bath, Light
 * fixture loose").
 */
export function sentenceCase(s: string): string {
  if (!s) return s;
  return s
    .split(/(,\s*)/)
    .map(chunk => {
      if (/^,\s*$/.test(chunk)) return chunk;
      return chunk.charAt(0).toUpperCase() + chunk.slice(1);
    })
    .join('');
}

/** Title-case a string — capitalize the first letter of every word. */
export function titleCase(s: string): string {
  if (!s) return s;
  return s.replace(/\b\w/g, c => c.toUpperCase());
}
