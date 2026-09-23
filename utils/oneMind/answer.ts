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
// verbatim (narrateVerdict.ts fallback pattern) — the data still speaks, and
// says up front that it is not an answer. When the user is BLOCKED (monthly
// or hourly cap, signed out) the reply is the reason instead, with no facts —
// see failureAnswer.ts (audit #119).
//
// Scope: a conversation opened from a job's own screen carries that job as
// its ANCHOR (opts.anchorProjectId), so "is this project over budget?" is
// answered for that job — applyAnchorScope in resolveScope.ts (audit #36).
//
// This module is impure by design (mageAI). Everything testable lives in
// resolveScope / factBlocks / composePrompt.

import { mageAI } from '@/utils/mageAI';
import { resolveScope, applyAnchorScope, type OneMindScope } from './resolveScope';
import { assembleFactBlocks, isColdStart, type FactBlock, type FactBlockDrillIn, type OneMindBundle } from './factBlocks';
import { composeOneMindPrompt, parseCitations, stripCitations } from './composePrompt';
import { oneMindFailureReply } from './failureAnswer';

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
  /** The relay's machine code (mageAI errorCode) — 'hourly_limit' vs
   *  'monthly_cap' decide whether the screen offers the paywall. */
  errorCode?: string;
  fromCache?: boolean;
  /** The model hit its output ceiling and stopped mid-thought rather than
   *  finishing. The answer text already carries a plain-English note saying so
   *  — this flag exists so a surface can style or act on it too. */
  truncated?: boolean;
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

/**
 * Answer a question against everything the app knows. Never throws.
 */
export async function askOneMind(
  question: string,
  turns: OneMindTurn[],
  bundle: OneMindBundle,
  opts: { anchorProjectId?: string | null } = {},
): Promise<OneMindAnswer> {
  // A named project wins; otherwise an anchored conversation is about its job.
  const scope = applyAnchorScope(
    resolveScope(question, bundle.projects), question, opts.anchorProjectId, bundle.projects,
  );

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
    // 700 tokens is ~525 words, and a multi-part answer ("two draft change
    // orders … CO#3 is") ran straight past it and stopped MID-SENTENCE, which
    // the screen then rendered as if it were the whole answer (founder report,
    // 2026-09-07). Raised to 1600 — still well under the relay's 24k cap and
    // still one metered call — and, more importantly, truncation is no longer
    // silent: see the MAX_TOKENS branch below.
    const res = await mageAI({ prompt, tier: 'smart', maxTokens: 1600, feature: 'askMage' });
    const text = typeof res.data === 'string' && res.data.trim()
      ? res.data.trim()
      : (res.raw?.trim() || '');
    if (res.success && text) {
      const refs = parseCitations(text, blocks);
      // Display text drops the raw [REF] markers — the chips carry them.
      // stripCitations only removes RECOGNIZED refs, so a fully-stripped
      // answer can never lose non-citation brackets.
      const display = stripCitations(text, blocks);
      // AN ANSWER THAT STOPPED IS NOT AN ANSWER. Gemini reports finishReason
      // MAX_TOKENS when it hit the ceiling rather than finishing its thought;
      // rendering that as ordinary prose tells the GC "CO#3 is" and lets him
      // believe that is all there was. The standing rule is that an absent fact
      // beats an invented one, and a sentence cut in half is worse than both.
      const truncated = res.finishReason === 'MAX_TOKENS';
      const body = display || text;
      return {
        answer: truncated
          ? `${body}\n\n— That is as far as MAGE got before running out of room. Ask a narrower question (one job, or one thing) and it can finish the thought.`
          : body,
        truncated,
        citations: toCitations(blocks, refs),
        scope,
        usedAI: !res.fromCache,
        errorKind: res.errorKind,
        fromCache: res.fromCache,
      };
    }
    // Blocked (cap / session) → the reason, no facts. Unreachable / empty →
    // verbatim facts, labelled as not answering the question.
    const reply = oneMindFailureReply(
      { error: res.error, errorKind: res.errorKind, errorCode: res.errorCode },
      blocks,
    );
    return {
      answer: reply.answer,
      citations: reply.used.map(b => ({ ref: b.ref, domain: b.domain, drillIn: b.drillIn })),
      scope,
      usedAI: false,
      errorKind: reply.errorKind,
      errorCode: reply.errorCode,
      fromCache: res.fromCache,
    };
  } catch (e) {
    const reply = oneMindFailureReply(
      { error: String((e as Error).message ?? e), errorKind: 'unknown' },
      blocks,
    );
    return {
      answer: reply.answer,
      citations: reply.used.map(b => ({ ref: b.ref, domain: b.domain, drillIn: b.drillIn })),
      scope,
      usedAI: false,
      errorKind: 'unknown',
    };
  }
}
