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
  const runTurn = useCallback(async () => {
    const s = stateRef.current;
    const asking = s.currentGap;
    const transcriptText = s.transcript.map(t => t.text).join(' | ');
    const { prompt, schemaHint } = cap.buildTurnPrompt({ transcript: transcriptText, draft: s.draft, grounding: s.grounding, asking });

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

    const draft = cap.mergeDraft(s.draft, res.data);
    const gaps = cap.gaps(draft, s.grounding);
    const threshold = cap.askThreshold ?? 0.35;
    const decision = decideAsk(gaps, { asked: s.askedFields, count: s.questionCount, cap: cap.maxQuestions ?? 4, threshold });
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
    void runTurn();
  }, [runTurn]);

  const answer = useCallback((field: string, value: unknown) => {
    dispatch({ type: 'ANSWER', field, value });
    void runTurn();
  }, [runTurn]);

  const skip = useCallback(() => {
    dispatch({ type: 'SKIP_QUESTION' });
    void runTurn();
  }, [runTurn]);

  const editTranscript = useCallback((turnId: string, text: string) => {
    dispatch({ type: 'EDIT_TRANSCRIPT', turnId, text });
    void runTurn();
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
