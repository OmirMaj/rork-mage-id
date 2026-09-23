// hooks/useCopilotConversation.ts — drives the Copilot interview.
//
// Owns the turn loop: build the per-turn prompt → one stateless mageAI call →
// merge the AI's JSON into the draft → recompute the capability's gaps → decide
// (via the ask-only-when-unresolved rule) whether to ask one more question or
// go to review. The state machine (turnReducer) and the ask decision are pure +
// validated; this hook is the thin async shell around them. No new edge fn —
// each turn reuses utils/mageAI.ts → supabase/functions/ai.
//
// Metering (#35): ONE charge per interview at the capability's real cost class
// — see utils/copilot/turnMeter.ts. A limit hit once the draft holds what he
// said goes to review with a note instead of an error, because most apply()s
// need no AI.
import { useReducer, useCallback, useRef } from 'react';
import { copilotReducer, initialCopilotState } from '@/utils/copilot/turnReducer';
import { decideAsk } from '@/utils/copilot/askDecision';
import { getCapability } from '@/utils/copilot/registry';
import { mageAI } from '@/utils/mageAI';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiterCore';
import { createInterviewMeter, interviewMeterPlan, onLimitHit, LIMIT_REACHED_NOTE } from '@/utils/copilot/turnMeter';
import { copilotPrecondition } from '@/utils/copilot/projectScope';
import type { CopilotCapabilityId, CopilotContext, CopilotState, Grounding } from '@/utils/copilot/types';

export function useCopilotConversation(capabilityId: CopilotCapabilityId, ctx: CopilotContext) {
  const cap = getCapability(capabilityId)!;
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState(capabilityId, {}));
  const stateRef = useRef(state);
  stateRef.current = state;
  // The subscription tier can resolve after mount; the meter reads it live.
  const tierRef = useRef(ctx.tier);
  tierRef.current = ctx.tier;
  const meterRef = useRef<ReturnType<typeof createInterviewMeter> | null>(null);
  if (!meterRef.current) {
    meterRef.current = createInterviewMeter({
      plan: () => interviewMeterPlan(cap),
      check: (tier, feature) => checkAILimit(tierRef.current as SubscriptionTierKey, tier, feature),
      record: (tier, feature) => recordAIUsage(tier, feature),
    });
  }
  const meter = meterRef.current;

  // Shown-not-asked defaults for a draft: gaps below the ask threshold.
  const resolvedFor = useCallback((gaps: ReturnType<typeof cap.gaps>, threshold: number): CopilotState['resolved'] =>
    gaps
      .filter(g => g.impact < threshold)
      .map(g => ({ field: g.field, label: g.question, basis: g.groundedDefault.basis, source: g.groundedDefault.source ?? 'assumed' })),
  [cap]);

  // A limit hit mid-interview. With something he said already in the draft it
  // goes to review ("built from what you said so far") so Build can still run
  // apply(); on an empty draft it is an error that names the real reason and
  // offers the plans (never the old hard-coded 'monthly_cap' string).
  const limitHit = useCallback((draft: object, grounding: Grounding, errorKind: string, message: string) => {
    if (onLimitHit(draft) === 'review') {
      const threshold = cap.askThreshold ?? 0.35;
      dispatch({
        type: 'AI_DRAFT', draft, nextGap: null, ready: true,
        resolved: resolvedFor(cap.gaps(draft, grounding), threshold),
        note: `${LIMIT_REACHED_NOTE} ${message}`.trim(),
      });
      return;
    }
    dispatch({ type: 'APPLY_ERR', errorKind, message });
  }, [cap, resolvedFor]);

  // One AI turn: prompt → mageAI → merge → recompute gaps → ask or ready.
  //
  // CRITICAL: dispatch() + runTurn() fire in the SAME tick, so stateRef is still
  // the PRE-dispatch snapshot when runTurn reads it (React hasn't re-rendered
  // yet). Reading stale state here ran the very first turn on an EMPTY transcript
  // — the AI got no "WHAT THEY SAID", extracted nothing, and every field fell to
  // its default (a project named "New Project" with location "null"). So the
  // caller hands us the action it just dispatched and we fold its effect (new
  // transcript line / edited line / answered field / consumed question) in by
  // hand rather than racing the render.
  const runTurn = useCallback(async (
    input:
      | { kind: 'utterance'; text: string }
      | { kind: 'edit'; turnId: string; text: string }
      | { kind: 'answer'; field: string; value: unknown }
      | { kind: 'skip' },
  ) => {
    const s = stateRef.current;
    const gap = s.currentGap; // the gap being answered/skipped, if any

    const turns = s.transcript.map(t =>
      input.kind === 'edit' && t.id === input.turnId ? input.text : t.text);
    if (input.kind === 'utterance') turns.push(input.text);
    const transcriptText = turns.join(' | ');

    // The answer is authoritative — write it into the draft up front so a
    // gap-only field (never re-extracted from the transcript) can't be lost and
    // re-fire the same question forever.
    const baseDraft = input.kind === 'answer'
      ? { ...s.draft, [input.field]: input.value }
      : s.draft;

    const consumed = input.kind === 'answer' || input.kind === 'skip';
    const askedFields = consumed && gap ? [...s.askedFields, gap.field] : s.askedFields;
    const questionCount = consumed ? s.questionCount + 1 : s.questionCount;
    // On answer/skip the model should see which gap was just handled; a fresh
    // utterance or transcript edit isn't answering a specific gap.
    const asking = consumed ? gap : null;

    const { prompt, schemaHint } = cap.buildTurnPrompt({ transcript: transcriptText, draft: baseDraft, grounding: s.grounding, asking });

    const limit = await meter.gate();
    if (!limit.allowed) {
      limitHit(baseDraft, s.grounding, limit.reason ?? 'daily_cap', limit.message ?? 'You’ve used your AI allowance for this. See plans to keep going.');
      return;
    }
    // The model call runs at the meter's cost class too: an interview turn is
    // a small JSON extraction, which the fast ceiling covers.
    const res = await mageAI({ prompt, schemaHint, tier: interviewMeterPlan(cap).tier, feature: cap.aiFeature });
    meter.settle(res.success);
    if (!res.success) {
      if (res.errorKind === 'monthly_cap') {
        limitHit(baseDraft, s.grounding, 'monthly_cap', res.error ?? 'Monthly AI limit reached.');
        return;
      }
      dispatch({ type: 'APPLY_ERR', errorKind: res.errorKind ?? 'unknown', message: res.error ?? 'The AI couldn’t respond. Try again.' });
      return;
    }

    // Pass the raw utterance + the gap being answered so a capability can reject
    // a field the model *presumed* but the contractor never actually stated
    // (e.g. a guessed start date) — which is what keeps the clarifying question
    // from ever appearing.
    const draft = cap.mergeDraft(baseDraft, res.data, { transcript: transcriptText, asking });
    const gaps = cap.gaps(draft, s.grounding);
    const threshold = cap.askThreshold ?? 0.35;
    const decision = decideAsk(gaps, { asked: askedFields, count: questionCount, cap: cap.maxQuestions ?? 4, threshold });
    // Gaps below the ask threshold become stated (shown-not-asked) defaults.
    const resolved = resolvedFor(gaps, threshold);
    dispatch({
      type: 'AI_DRAFT',
      draft,
      resolved,
      nextGap: decision.kind === 'ask' ? decision.gap : null,
      ready: decision.kind !== 'ask',
    });
  }, [cap, meter, limitHit, resolvedFor]);

  const start = useCallback(async () => {
    meter.reset();
    const grounding = await cap.buildGrounding(ctx);
    dispatch({ type: 'START', grounding });
  }, [cap, ctx, meter]);

  const utterance = useCallback((text: string) => {
    dispatch({ type: 'UTTERANCE', turnId: 't' + Date.now(), text });
    void runTurn({ kind: 'utterance', text });
  }, [runTurn]);

  const answer = useCallback((field: string, value: unknown) => {
    dispatch({ type: 'ANSWER', field, value });
    void runTurn({ kind: 'answer', field, value });
  }, [runTurn]);

  const skip = useCallback(() => {
    dispatch({ type: 'SKIP_QUESTION' });
    void runTurn({ kind: 'skip' });
  }, [runTurn]);

  const editTranscript = useCallback((turnId: string, text: string) => {
    dispatch({ type: 'EDIT_TRANSCRIPT', turnId, text });
    void runTurn({ kind: 'edit', turnId, text });
  }, [runTurn]);

  const confirm = useCallback(async () => {
    dispatch({ type: 'CONFIRM' });
    try {
      const applied = await cap.apply(stateRef.current.draft, ctx);
      dispatch({ type: 'APPLY_OK' });
      return applied;
    } catch (e) {
      // Name a missing job / estimate so the shell can offer the fix ('Pick a
      // job', 'Build the estimate first') and keep the draft (#34); anything
      // else is an apply failure that can go back to review.
      const pre = copilotPrecondition(cap.id, ctx.project);
      // #57 / #156: the free plan's job cap refused the create — the shell
      // shows the sentence with See plans, not "Couldn't build it".
      const capRefused = (e as { code?: unknown } | null)?.code === 'project_cap';
      dispatch({ type: 'APPLY_ERR', errorKind: capRefused ? 'project_cap' : (pre.ok ? 'apply_failed' : pre.kind), message: (e as Error).message });
      return undefined;
    }
  }, [cap, ctx]);

  const cancel = useCallback(() => { meter.reset(); dispatch({ type: 'CANCEL' }); }, [meter]);
  const patchDraft = useCallback((patch: Record<string, unknown>) => dispatch({ type: 'PATCH_DRAFT', patch }), []);
  const backToReview = useCallback(() => dispatch({ type: 'BACK_TO_REVIEW' }), []);

  return { state, cap, start, utterance, answer, skip, editTranscript, confirm, cancel, patchDraft, backToReview };
}
