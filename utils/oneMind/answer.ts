// utils/oneMind/answer.ts — askOneMind: the One Mind ask pipeline.
//
//   question → resolveScope (deterministic, no AI)
//            → assembleFactBlocks (every engine, additive)
//            → composeOneMindPrompt (grounded, cited)
//            → mageAI({ tier:'smart', feature:'askMage' })   ← G9: metering
//            → parse [REF] citations → drill-in chips
//
// Failure never leaves the user empty-handed: when the model is unreachable
// the answer degrades to the top fact lines of the highest-priority blocks
// verbatim (narrateVerdict.ts fallback pattern) — the data still speaks.
//
// This module is impure by design (mageAI). Everything testable lives in
// resolveScope / factBlocks / composePrompt.

import { mageAI } from '@/utils/mageAI';
import { resolveScope, type OneMindScope } from './resolveScope';
import { assembleFactBlocks, isColdStart, type FactBlock, type FactBlockDrillIn, type OneMindBundle } from './factBlocks';
import { composeOneMindPrompt, parseCitations } from './composePrompt';

export interface OneMindTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface OneMindCitation {
  ref: string;
  domain: string;
  drillIn?: FactBlockDrillIn;
}

export interface OneMindAnswer {
  answer: string;
  /** Blocks the model actually cited, in citation order — the drill-in chips. */
  citations: OneMindCitation[];
  scope: OneMindScope;
  /** True only when a real model call produced the answer — callers meter
   *  (recordAIUsage) on this, so cold-start/fallback answers never burn a
   *  daily call or a free-tier trial. */
  usedAI: boolean;
  errorKind?: string;
  fromCache?: boolean;
}

const COLD_START_ANSWER =
  "I don't have anything to answer from yet — no projects, invoices, leads or " +
  'daily reports are logged. Create your first project (or say it to the ' +
  'Copilot) and I can start answering from your real data.';

function toCitations(blocks: FactBlock[], refs: string[]): OneMindCitation[] {
  return refs
    .map(ref => blocks.find(b => b.ref === ref))
    .filter((b): b is FactBlock => !!b)
    .map(b => ({ ref: b.ref, domain: b.domain, drillIn: b.drillIn }));
}

/** Verbatim-facts fallback when the AI is unreachable: the first two blocks
 *  with facts (assembly order = priority), skipping the RECORDS dump. */
function fallbackAnswer(blocks: FactBlock[]): { text: string; used: FactBlock[] } {
  const preferred = blocks.filter(b => b.ref !== 'RECORDS' && b.facts.length > 0).slice(0, 2);
  const used = preferred.length > 0 ? preferred : blocks.filter(b => b.facts.length > 0).slice(0, 1);
  if (used.length === 0) return { text: '', used: [] };
  const lines = used.flatMap(b => b.facts.slice(0, 3).map(f => `• ${f}`));
  return {
    text: `I couldn't reach the AI right now — but here's what your data shows:\n\n${lines.join('\n')}`,
    used,
  };
}

/**
 * Answer a question against everything the app knows. Never throws.
 */
export async function askOneMind(
  question: string,
  turns: OneMindTurn[],
  bundle: OneMindBundle,
): Promise<OneMindAnswer> {
  const scope = resolveScope(question, bundle.projects);

  // Cold-start honesty: no data → no AI call, just the truth.
  if (isColdStart(bundle)) {
    return { answer: COLD_START_ANSWER, citations: [], scope, usedAI: false };
  }

  let blocks: FactBlock[] = [];
  try {
    blocks = await assembleFactBlocks(scope, question, bundle);
  } catch {
    blocks = []; // assembleFactBlocks is already additive; belt and braces
  }

  const scopeLabel =
    scope.scope === 'project'
      ? `One project — ${bundle.projects.find(p => p.id === scope.projectId)?.name ?? 'unknown'}`
      : 'Whole business';

  const prompt = composeOneMindPrompt({ question, turns, blocks, scopeLabel });

  try {
    const res = await mageAI({ prompt, tier: 'smart', maxTokens: 700, feature: 'askMage' });
    const text = typeof res.data === 'string' && res.data.trim()
      ? res.data.trim()
      : (res.raw?.trim() || '');
    if (res.success && text) {
      const refs = parseCitations(text, blocks);
      return {
        answer: text,
        citations: toCitations(blocks, refs),
        scope,
        usedAI: !res.fromCache,
        errorKind: res.errorKind,
        fromCache: res.fromCache,
      };
    }
    // Model unreachable / empty → verbatim facts.
    const fb = fallbackAnswer(blocks);
    return {
      answer: fb.text || (res.error ? `MAGE couldn't answer that: ${res.error}` : "MAGE couldn't answer that right now. Try again in a moment."),
      citations: fb.used.map(b => ({ ref: b.ref, domain: b.domain, drillIn: b.drillIn })),
      scope,
      usedAI: false,
      errorKind: res.errorKind ?? 'model',
      fromCache: res.fromCache,
    };
  } catch (e) {
    const fb = fallbackAnswer(blocks);
    return {
      answer: fb.text || `MAGE hit an error: ${String((e as Error).message ?? e)}`,
      citations: fb.used.map(b => ({ ref: b.ref, domain: b.domain, drillIn: b.drillIn })),
      scope,
      usedAI: false,
      errorKind: 'unknown',
    };
  }
}
