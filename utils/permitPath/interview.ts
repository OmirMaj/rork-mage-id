// utils/permitPath/interview.ts — the scope interview over the pack data. PURE.
//
// STALE ANSWERS. Removing an answer can hide questions that depended on it.
// Their answers stay stored (so turning the parent back on restores them) but
// are IGNORED: only answers to currently visible questions count, everywhere —
// for askIf, for item `when`, for skips. effectiveAnswers() is that rule.

import { evalPredicate, type PredicateCtx } from '@/utils/permitPath/predicate';
import type { InterviewAnswer, InterviewAnswers, Question, QuestionPack } from '@/utils/permitPath/types';

export type InterviewCtx = PredicateCtx;

export function activePacks(packs: readonly QuestionPack[], ctx: InterviewCtx): QuestionPack[] {
  return packs.filter((p) => evalPredicate(p.appliesTo, ctx));
}

function allQuestions(packs: readonly QuestionPack[]): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const p of packs) for (const q of p.questions) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push(q);
  }
  return out;
}

function restrict(answers: InterviewAnswers, ids: ReadonlySet<string>): InterviewAnswers {
  const out: Record<string, InterviewAnswer> = {};
  for (const k of Object.keys(answers).sort()) if (ids.has(k)) out[k] = answers[k];
  return out;
}

function visibleIds(qs: readonly Question[], ctx: InterviewCtx): Set<string> {
  return new Set(qs.filter((q) => q.askIf == null || evalPredicate(q.askIf, ctx)).map((q) => q.id));
}

/**
 * The answers that count: those whose question is active and visible. A
 * fixpoint, because hiding one question can hide another; capped so a cyclic
 * pack can never spin (it settles on the last pass, deterministically).
 */
export function effectiveAnswers(packs: readonly QuestionPack[], ctx: InterviewCtx): InterviewAnswers {
  const qs = allQuestions(activePacks(packs, ctx));
  let eff = restrict(ctx.answers, new Set(qs.map((q) => q.id)));
  for (let i = 0; i <= qs.length; i++) {
    const next = restrict(ctx.answers, visibleIds(qs, { ...ctx, answers: eff }));
    if (Object.keys(next).join('|') === Object.keys(eff).join('|')) return next;
    eff = next;
  }
  return eff;
}

/**
 * Visible questions in pack order, then question order — except that a
 * question pre-filled from the permit office (village or town?) leads: no
 * other answer means much until the GC knows which department issues.
 */
export function visibleQuestions(packs: readonly QuestionPack[], ctx: InterviewCtx): Question[] {
  const qs = allQuestions(activePacks(packs, ctx));
  const eff = effectiveAnswers(packs, ctx);
  const vis = visibleIds(qs, { ...ctx, answers: eff });
  const shown = qs.filter((q) => vis.has(q.id));
  return [...shown.filter((q) => q.prefill === 'permit_office'), ...shown.filter((q) => q.prefill !== 'permit_office')];
}

export function nextQuestion(packs: readonly QuestionPack[], ctx: InterviewCtx): Question | null {
  return visibleQuestions(packs, ctx).find((q) => !ctx.answers[q.id]) ?? null;
}

export function interviewProgress(packs: readonly QuestionPack[], ctx: InterviewCtx): { answered: number; visible: number } {
  const vis = visibleQuestions(packs, ctx);
  return { answered: vis.filter((q) => !!ctx.answers[q.id]).length, visible: vis.length };
}

export function withAnswer(answers: InterviewAnswers, id: string, answer: InterviewAnswer): InterviewAnswers {
  return { ...answers, [id]: answer };
}

export function withoutAnswer(answers: InterviewAnswers, id: string): InterviewAnswers {
  const out: Record<string, InterviewAnswer> = { ...answers };
  delete out[id];
  return out;
}
