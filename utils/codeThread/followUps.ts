/**
 * Code Thread — adaptive follow-ups.
 *
 * The model may ask up to MAX_FOLLOW_UPS short questions, and ONLY where the
 * answer would change the requirements (a sleeping room, a new vs existing
 * window). Each tap re-runs the SAME Code Check call with the answer added as
 * an ANSWERED FACT; the cache key moves with the answers.
 *
 * followUpsZod is shaped for the relay's schema hint, see the note on it.
 */
import { z } from 'zod';
import { hashLeakText } from '@/utils/profitLeak/leakPrompt';
import type { CodeThreadAnswer, CodeThreadFollowUp } from './types';

export const MAX_FOLLOW_UPS = 3;
export const MAX_OPTION_CHARS = 60;

// `.default([])` DIRECTLY over the ZodArray, with NO `.catch` on the outer
// array or on `options`. utils/mageAI.ts deriveHintFromZod unwraps ZodDefault
// but not ZodCatch: an empty default falls through to its inner type, and a
// ZodCatch there yields null, which the relay's inferSchema(null) turns into a
// string, so Gemini could never return an array. With `.default([])` over the
// ZodArray the hint is [{id:'',question:'',options:['']}] and the relay
// constrains Gemini to an array of objects. The inner string fields keep
// `.catch('').default('')`: a non-empty-container default ('') is returned
// as-is and yields a string schema, which is right.
export const followUpsZod = z.array(z.object({
  id: z.string().catch('').default(''),
  question: z.string().catch('').default(''),
  options: z.array(z.string()).default([]),
})).default([]);

function idFromQuestion(q: string): string {
  const slug = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return slug || `q-${hashLeakText(q, '', [])}`;
}

/**
 * Keep only follow-ups the contractor can actually answer with a tap: a real
 * question, 2 to 4 distinct short options, not one already answered, and no
 * more than the 3-question budget leaves.
 */
export function coerceFollowUps(raw: unknown, answered: readonly CodeThreadAnswer[]): CodeThreadFollowUp[] {
  const budget = Math.max(0, MAX_FOLLOW_UPS - answered.length);
  if (budget === 0 || !Array.isArray(raw)) return [];
  const answeredIds = new Set(answered.map((a) => a.questionId));
  const answeredQs = new Set(answered.map((a) => a.question.trim().toLowerCase()));
  const out: CodeThreadFollowUp[] = [];
  const seenIds = new Set<string>();
  for (const item of raw) {
    if (out.length >= budget) break;
    if (!item || typeof item !== 'object') continue;
    const r = item as { id?: unknown; question?: unknown; options?: unknown };
    const question = typeof r.question === 'string' ? r.question.trim() : '';
    if (!question) continue;
    const rawOpts = Array.isArray(r.options) ? r.options : [];
    const options: string[] = [];
    for (const o of rawOpts) {
      if (typeof o !== 'string') continue;
      const t = o.trim();
      if (!t || t.length > MAX_OPTION_CHARS) continue;
      if (options.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
      options.push(t);
    }
    if (options.length < 2 || options.length > 4) continue;
    const id = (typeof r.id === 'string' && r.id.trim()) ? r.id.trim() : idFromQuestion(question);
    if (answeredIds.has(id) || answeredQs.has(question.toLowerCase()) || seenIds.has(id)) continue;
    seenIds.add(id);
    out.push({ id, question, options });
  }
  return out;
}

export function answeredFactsBlock(answered: readonly CodeThreadAnswer[]): string {
  if (answered.length === 0) return '';
  return 'ANSWERED FACTS (the contractor\'s own answers; treat them as true for this job):\n'
    + answered.map((a) => `- Q: ${a.question} A: ${a.answer}`).join('\n');
}

export function followUpInstruction(answered: readonly CodeThreadAnswer[]): string {
  if (answered.length >= MAX_FOLLOW_UPS) return 'Do not ask any more follow-up questions; return followUps as [].';
  return '- followUps: up to 3 questions ONLY where the answer would change the requirements above (for example whether a room is used for sleeping, or whether a window is new or existing). Each has an id, a short question and 2 to 4 short tap answers. Return [] when nothing you could ask would change the answer.';
}

export function answersCacheFragment(answered: readonly CodeThreadAnswer[]): string {
  return hashLeakText(JSON.stringify(answered), '', []);
}
