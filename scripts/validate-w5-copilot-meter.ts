// scripts/validate-w5-copilot-meter.ts — audit wave 5, #35: a Copilot
// interview is charged ONCE, at the capability's real cost class.
//
// Before: every turn called checkAILimit(tier, 'smart', feature) and
// recordAIUsage('smart', feature). A free daily report hit the free smart cap
// of 0 on turn 1; a free voice RFI / punch spent all 3 Voice Capture trials in
// one interview; a free 4-question warranty died before its last question;
// a Pro GC spent his 6/day advanced quota on about two items.
//
// This runs whole interviews through the REAL evaluateLimit with in-memory
// counters shaped like utils/aiRateLimiter's (daily count, daily smart count,
// lifetime per feature), driven by the real createInterviewMeter the hook
// uses — and pins the hook to that meter so the per-turn code cannot return.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluateLimit, FEATURE_CONFIG, type AIFeature, type RequestTier, type SubscriptionTierKey } from '../utils/aiRateLimiterCore';
import { createInterviewMeter, interviewMeterPlan, draftHasContent, onLimitHit, isLimitErrorKind, LIMIT_REACHED_NOTE } from '../utils/copilot/turnMeter';
import { copilotReducer, initialCopilotState } from '../utils/copilot/turnReducer';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, detail !== undefined ? `\n      ${JSON.stringify(detail)}` : ''); }
}
const ROOT = join(__dirname, '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** A device's limiter state, mirroring checkAILimit / recordAIUsage. */
function world(tier: SubscriptionTierKey, lifetime: Partial<Record<AIFeature, number>> = {}) {
  const w = { count: 0, smart: 0, lifetime: { ...lifetime } as Partial<Record<AIFeature, number>> };
  const check = async (req: RequestTier, feature: AIFeature) =>
    evaluateLimit(tier, req, feature, w.count, w.smart, w.lifetime[feature] ?? 0);
  const record = (req: RequestTier, feature: AIFeature) => {
    w.count += 1;
    if (req === 'smart') w.smart += 1;
    w.lifetime[feature] = (w.lifetime[feature] ?? 0) + 1;
  };
  return { w, check, record };
}

/** Run an interview of `turns` model calls the way useCopilotConversation
 *  does: gate → (model call succeeds) → settle(true). Returns how many turns
 *  ran before a block, and the block reason if any. */
async function interview(cap: { aiFeature: AIFeature; turnMeterFeature?: AIFeature }, tier: SubscriptionTierKey, turns: number, lifetime: Partial<Record<AIFeature, number>> = {}) {
  const env = world(tier, lifetime);
  const meter = createInterviewMeter({ plan: () => interviewMeterPlan(cap), check: env.check, record: env.record });
  let ran = 0; let blocked: string | undefined;
  for (let i = 0; i < turns; i++) {
    const limit = await meter.gate();
    if (!limit.allowed) { blocked = limit.reason; break; }
    meter.settle(true);
    ran++;
  }
  return { ran, blocked, ...env.w };
}

(async () => {
  console.log('\n#35 — one charge per interview, at the feature’s real tier:');

  // Real cost classes (a regression here would re-break the free tier).
  ok('dailyReport is a fast feature', FEATURE_CONFIG.dailyReport.tier === 'fast');
  ok('voiceCapture is fast with 3 free trials', FEATURE_CONFIG.voiceCapture.tier === 'fast' && FEATURE_CONFIG.voiceCapture.freeLifetimeCap === 3);
  ok('interviewMeterPlan uses FEATURE_CONFIG[feature].tier, not a hard-coded smart',
    interviewMeterPlan({ aiFeature: 'dailyReport' }).tier === 'fast' && interviewMeterPlan({ aiFeature: 'scheduleCopilot' }).tier === 'smart');
  ok('turnMeterFeature overrides the meter (estimate turns meter as copilot)',
    JSON.stringify(interviewMeterPlan({ aiFeature: 'quickEstimate', turnMeterFeature: 'copilot' })) === JSON.stringify({ feature: 'copilot', tier: 'fast' }));

  {
    const r = await interview({ aiFeature: 'dailyReport' }, 'free', 3);
    ok('free daily report interview is allowed (every turn)', r.ran === 3 && !r.blocked, r);
    ok('…and costs one fast unit, no smart unit', r.count === 1 && r.smart === 0, r);
  }
  {
    const r = await interview({ aiFeature: 'changeOrderImpact' }, 'free', 3);
    ok('free change-order interview is allowed', r.ran === 3 && !r.blocked, r);
  }
  {
    const r = await interview({ aiFeature: 'voiceCapture' }, 'free', 3);
    ok('a free punch interview (3 turns) uses exactly 1 Voice Capture trial', r.ran === 3 && r.lifetime.voiceCapture === 1, r);
  }
  {
    // Warranty: maxQuestions 3 → the opening utterance + 3 answers = 4 turns.
    const r = await interview({ aiFeature: 'voiceCapture' }, 'free', 4);
    ok('a free 4-turn warranty interview reaches the end', r.ran === 4 && !r.blocked, r);
  }
  {
    // Two trials already spent: the old per-turn meter blocked turn 2.
    const r = await interview({ aiFeature: 'voiceCapture' }, 'free', 4, { voiceCapture: 2 });
    ok('with 1 trial left, a whole free interview still completes on that one trial', r.ran === 4 && r.lifetime.voiceCapture === 3, r);
  }
  {
    const r = await interview({ aiFeature: 'voiceCapture' }, 'free', 2, { voiceCapture: 3 });
    ok('with no trials left the FIRST turn is blocked with lifetime_cap', r.ran === 0 && r.blocked === 'lifetime_cap', r);
  }
  {
    const r = await interview({ aiFeature: 'scheduleCopilot' }, 'pro', 3);
    ok('a Pro 3-turn smart interview adds at most 1 smart unit', r.ran === 3 && r.smart <= 1, r);
  }
  {
    const r = await interview({ aiFeature: 'voiceCapture' }, 'pro', 3);
    ok('a Pro punch interview spends no advanced (smart) unit at all', r.smart === 0 && r.count === 1, r);
  }
  {
    // Six Pro punch items in a day used to exhaust the 6/day advanced quota
    // (3 smart units each); now none of them touches it.
    const env = world('pro');
    for (let k = 0; k < 6; k++) {
      const m = createInterviewMeter({ plan: () => interviewMeterPlan({ aiFeature: 'voiceCapture' }), check: env.check, record: env.record });
      for (let t = 0; t < 3; t++) { const l = await m.gate(); if (l.allowed) m.settle(true); }
    }
    const askMage = await env.check('smart', 'askMage');
    ok('six Pro Copilot items leave Ask MAGE (smart) available', askMage.allowed && env.w.smart === 0, env.w);
  }
  {
    const env = world('free');
    const m = createInterviewMeter({ plan: () => interviewMeterPlan({ aiFeature: 'voiceCapture' }), check: env.check, record: env.record });
    await m.gate(); m.settle(false); // a dropped signal
    ok('a failed model call records nothing (no trial spent on no signal)', env.w.count === 0 && !m.metered);
    await m.gate(); m.settle(true);
    ok('…the next successful turn is the one charged', env.w.lifetime.voiceCapture === 1 && m.metered);
    m.reset();
    ok('reset() (START / cancel) charges the next interview again', !m.metered);
  }

  console.log('\n#35 — a limit hit with something said goes to review, not an error:');
  ok('an empty draft → error', onLimitHit({}) === 'error' && onLimitHit({ question: null, notes: '' }) === 'error');
  ok('a draft with content → review', onLimitHit({ question: 'beam size at grid C' }) === 'review' && draftHasContent({ items: ['x'] }));
  ok('limit reasons get See plans; network does not',
    ['lifetime_cap', 'smart_cap', 'pro_only', 'daily_cap', 'monthly_cap'].every(isLimitErrorKind) && !isLimitErrorKind('network') && !isLimitErrorKind(undefined));
  {
    let s = initialCopilotState('rfi', {});
    s = copilotReducer(s, { type: 'START', grounding: { facts: [], data: {} } });
    s = copilotReducer(s, { type: 'AI_DRAFT', draft: { question: 'beam?' }, resolved: [], nextGap: null, ready: true, note: LIMIT_REACHED_NOTE });
    ok('AI_DRAFT ready + note → review carrying the note', s.phase === 'review' && s.reviewNote === LIMIT_REACHED_NOTE);
    s = copilotReducer(s, { type: 'PATCH_DRAFT', patch: { priority: 'high' } });
    ok('PATCH_DRAFT merges into the draft and stays in review', s.phase === 'review' && (s.draft as Record<string, unknown>).priority === 'high' && (s.draft as Record<string, unknown>).question === 'beam?');
    s = copilotReducer(s, { type: 'CONFIRM' });
    s = copilotReducer(s, { type: 'APPLY_ERR', errorKind: 'no_project', message: 'No project for this RFI.' });
    ok('a Build error keeps the draft', s.phase === 'error' && (s.draft as Record<string, unknown>).question === 'beam?');
    s = copilotReducer(s, { type: 'BACK_TO_REVIEW' });
    ok('BACK_TO_REVIEW returns to review with the same draft, error cleared', s.phase === 'review' && !s.errorKind && (s.draft as Record<string, unknown>).question === 'beam?');
    const listening = copilotReducer(initialCopilotState('rfi', {}), { type: 'BACK_TO_REVIEW' });
    ok('BACK_TO_REVIEW outside the error phase is a no-op', listening.phase === 'idle');
  }

  console.log('\nThe hook uses this meter (source pins — the defect was the call shape):');
  const hook = src('hooks/useCopilotConversation.ts');
  ok('no per-turn hard-coded smart check', !/checkAILimit\([^)]*'smart'/.test(hook) && !/recordAIUsage\('smart'/.test(hook));
  ok('turns are gated and settled through createInterviewMeter', /createInterviewMeter\(/.test(hook) && /meter\.gate\(\)/.test(hook) && /meter\.settle\(res\.success\)/.test(hook));
  ok('the model call runs at the meter’s tier', /tier: interviewMeterPlan\(cap\)\.tier/.test(hook));
  ok('a limit hit is routed through limitHit (review with note, or the real reason)', /limitHit\(baseDraft, s\.grounding, limit\.reason/.test(hook) && !/errorKind: 'monthly_cap', message: limit\.message/.test(hook));
  ok('START and cancel reset the meter', /meter\.reset\(\);\s*\n\s*const grounding/.test(hook) && /cancel = useCallback\(\(\) => \{ meter\.reset\(\)/.test(hook));
  const shell = src('components/copilot/CopilotShell.tsx');
  ok('the shell answers a limit with See plans → /paywall', /isLimitErrorKind\(state\.errorKind\)/.test(shell) && /router\.push\('\/paywall'/.test(shell) && /See plans/.test(shell));

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
})();
