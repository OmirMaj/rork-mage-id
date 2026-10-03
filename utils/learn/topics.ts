// utils/learn/topics.ts — the fifteen skill topics and the pass rule. Pure.
//
// A topic is one tutorial's skills check. LEARNQUIZ shows a topic's check only
// once its tutorial has a def in this build AND he has practised it; until a
// content lane lands the def, the topic exists here and stays hidden.
//
// Labels and titles name a part of the APP, never a trade skill, and never a
// word that reads as a credential (scripts/validate-learn-topics.ts pins the
// banned list). See the header of ./types.ts.

import type { SkillTopic, SkillTopicId } from './types';

/** Share of answers needed to pass, in percent. 5 questions → 4 right. */
export const PASS_PCT = 80;

/** Integer math only: correct × 100 ≥ PASS_PCT × total. A check has 3 to 5
 *  questions; anything else (or a count out of range) is never a pass. */
export function passed(correct: number, total: number): boolean {
  if (!Number.isInteger(correct) || !Number.isInteger(total)) return false;
  if (total < 3 || total > 5 || correct < 0 || correct > total) return false;
  return correct * 100 >= PASS_PCT * total;
}

/** 'Construction AI' → 'construction AI': only the first letter drops, so an
 *  acronym inside a label keeps its capitals ('construction ai' reads wrong). */
export function lowerFirst(label: string): string {
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** `quizVersion` moves with the topic's bank version in ./quizBank.ts: a
 *  question change bumps both, then the server key is regenerated
 *  (bun run gen:skill-quiz-key) and skill-certificate-award is redeployed
 *  before the client ships, or every attempt on the new version gets 409. */
function topic(id: SkillTopicId, label: string, quizVersion = 1): SkillTopic {
  return {
    id,
    label,
    certificateTitle: `MAGE ID skills: ${label}`,
    scope: `Using ${lowerFirst(label)} in the MAGE ID app.`,
    quizVersion,
  };
}

/** Hub order (utils/tutorial/defs TUTORIAL_ORDER), the shipped three first. */
export const SKILL_TOPICS: readonly SkillTopic[] = [
  // v2 (2026-10-02): q4 no longer names the retired weather Auto-fetch.
  topic('daily-report-voice', 'Daily reports by voice', 2),
  topic('punch-walk', 'Punch walks'),
  topic('invoice-to-self', 'Invoicing'),
  topic('schedule-say-it', 'Schedule changes'),
  topic('estimate-first', 'Estimates'),
  topic('takeoff-to-estimate', 'Takeoff'),
  topic('construction-ai-ask', 'Construction AI'),
  topic('change-order-draft', 'Change orders'),
  topic('pay-app-period', 'Pay applications'),
  topic('field-ticket-log', 'Field tickets'),
  topic('time-clock-in', 'Time clock'),
  topic('punch-list-close', 'Punch lists'),
  topic('ask-your-plans', 'Ask your plans'),
  topic('contract-from-estimate', 'Contracts'),
  topic('closeout-binder', 'Closeout binders'),
];

/** The topic for `id`, or null. */
export function skillTopic(id: string): SkillTopic | null {
  return SKILL_TOPICS.find(t => t.id === id) ?? null;
}
