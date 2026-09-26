// utils/inspectionPrepAI.ts — the ONE network call Inspection Ready makes: the
// "commonly checked" recall list. Tagged feature: 'ai_code_check' so the relay
// holds it to the same Pro floor as Code Check (L4's gating validator pins
// this file to that literal). The prompt is built by the pure
// utils/inspectionPrep.buildRecallPrompt; this file only sends it and shapes
// the answer. Nothing here is ever rendered as a disclaimer or a fact — the
// sheet labels every item as model recall.

import { z } from 'zod';
import { mageAI } from '@/utils/mageAI';
import type { RecallAnswer } from '@/utils/inspectionPrep';

const MAX_ITEMS = 10;
const MAX_FOLLOW_UPS = 3;

export const recallSchema = z.object({
  items: z.array(z.object({
    text: z.string().default(''),
    codeRef: z.string().default(''),
    confidence: z.enum(['high', 'med', 'low']).catch('low'),
    why: z.string().default(''),
  })).default([]),
  followUps: z.array(z.object({
    question: z.string().default(''),
    options: z.array(z.string()).default([]),
  })).default([]),
});

const recallHint = {
  items: [{ text: 'What the inspector checks', codeRef: '', confidence: 'med', why: 'Why it matters here' }],
  followUps: [{ question: 'Any basement bedrooms?', options: ['Yes', 'No', 'Not sure'] }],
};

export type RecallResult =
  | { ok: true; answer: RecallAnswer; cached: boolean }
  | { ok: false; error: string };

/** Caps applied after parsing, so an over-long answer is trimmed rather than
 *  refused whole (a Zod .max() failure would empty the list). */
function shape(data: unknown): RecallAnswer {
  const parsed = recallSchema.safeParse(data ?? {});
  const v = parsed.success ? parsed.data : { items: [], followUps: [] };
  return {
    items: v.items
      .filter((i) => i.text.trim())
      .slice(0, MAX_ITEMS)
      .map((i) => ({ text: i.text.trim(), codeRef: i.codeRef.trim(), confidence: i.confidence, why: i.why.trim() })),
    followUps: v.followUps
      .map((f) => ({ question: f.question.trim(), options: f.options.map((o) => o.trim()).filter(Boolean).slice(0, 4) }))
      .filter((f) => f.question && f.options.length >= 2)
      .slice(0, MAX_FOLLOW_UPS),
  };
}

export async function runInspectionRecall(prompt: string, cacheKey: string): Promise<RecallResult> {
  try {
    const res = await mageAI({
      prompt,
      schema: recallSchema,
      schemaHint: recallHint,
      tier: 'smart',
      maxTokens: 1500,
      cacheKey,
      cacheHours: 24,
      feature: 'ai_code_check',
    });
    if (!res.success) return { ok: false, error: res.error || 'The commonly-checked list could not load.' };
    return { ok: true, answer: shape(res.data), cached: !!res.cached };
  } catch {
    return { ok: false, error: 'The commonly-checked list could not load.' };
  }
}
