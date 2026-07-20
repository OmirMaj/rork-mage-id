// hooks/useCopilotConversation.ts — drives the Copilot interview.
//
// Owns the turn loop: build the per-turn prompt → one stateless mageAI call →
// merge the AI's JSON into the draft → recompute the capability's gaps → decide
// (via the ask-only-when-unresolved rule) whether to ask one more question or
// go to review. The state machine (turnReducer) and the ask decision are pure +
// validated; this hook is the thin async shell around them. No new edge fn —
// each turn reuses utils/mageAI.ts → supabase/functions/ai.
import { useReducer, useCallback, useRef } from 'react';
import { copilotReducer, initialCopilotState } from '@/utils/copilot/turnReducer';
import { decideAsk } from '@/utils/copilot/askDecision';
import { getCapability } from '@/utils/copilot/registry';
import { mageAI } from '@/utils/mageAI';
import { checkAILimit, recordAIUsage } from '@/utils/aiRateLimiter';
import type { SubscriptionTierKey } from '@/utils/aiRateLimiterCore';
import type { CopilotCapabilityId, CopilotContext, CopilotState } from '@/utils/copilot/types';

export function useCopilotConversation(capabilityId: CopilotCapabilityId, ctx: CopilotContext) {
  const cap = getCapability(capabilityId)!;
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState(capabilityId, {}));
  const stateRef = useRef(state);
  stateRef.current = state;

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

    const limit = await checkAILimit(ctx.tier as SubscriptionTierKey, 'smart', cap.aiFeature);
    if (!limit.allowed) {
      dispatch({ type: 'APPLY_ERR', errorKind: 'monthly_cap', message: limit.message ?? 'You’ve used your free trials of this feature. Upgrade to keep going.' });
      return;
    }
    const res = await mageAI({ prompt, schemaHint, tier: 'smart', feature: cap.aiFeature });
    if (!res.success) {
      dispatch({ type: 'APPLY_ERR', errorKind: res.errorKind ?? 'unknown', message: res.error ?? 'The AI couldn’t respond. Try again.' });
      return;
    }
    void recordAIUsage('smart', cap.aiFeature);

    // Pass the raw utterance + the gap being answered so a capability can reject
    // a field the model *presumed* but the contractor never actually stated
    // (e.g. a guessed start date) — which is what keeps the clarifying question
    // from ever appearing.
    const draft = cap.mergeDraft(baseDraft, res.data, { transcript: transcriptText, asking });
    const gaps = cap.gaps(draft, s.grounding);
    const threshold = cap.askThreshold ?? 0.35;
    const decision = decideAsk(gaps, { asked: askedFields, count: questionCount, cap: cap.maxQuestions ?? 4, threshold });
    // Gaps below the ask threshold become stated (shown-not-asked) defaults.
    const resolved: CopilotState['resolved'] = gaps
      .filter(g => g.impact < threshold)
      .map(g => ({ field: g.field, label: g.question, basis: g.groundedDefault.basis }));
    dispatch({
      type: 'AI_DRAFT',
      draft,
      resolved,
      nextGap: decision.kind === 'ask' ? decision.gap : null,
      ready: decision.kind !== 'ask',
    });
  }, [cap, ctx.tier]);

  const start = useCallback(async () => {
    const grounding = await cap.buildGrounding(ctx);
    dispatch({ type: 'START', grounding });
  }, [cap, ctx]);

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
      dispatch({ type: 'APPLY_ERR', errorKind: 'unknown', message: (e as Error).message });
      return undefined;
    }
  }, [cap, ctx]);

  const cancel = useCallback(() => dispatch({ type: 'CANCEL' }), []);

  return { state, cap, start, utterance, answer, skip, editTranscript, confirm, cancel };
}
