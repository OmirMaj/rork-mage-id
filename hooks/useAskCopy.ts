// hooks/useAskCopy.ts — the ONLY place new Ask MAGE strings live (lanes AIDO
// and AILOOK). Every string goes through t('ai.ask.*', english, vars) so the
// i18n registry stays in one file (surface 'ai.ask', docs/I18N.md §3). AILOOK
// imports this; it adds no t() keys of its own.
//
// Copy per docs/VOICE.md: sentence case, no exclamation marks, no emoji.
// Never call t() at module scope: the object is rebuilt when the language
// changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { AskActionProposal } from '@/utils/oneMind/askAction';

export interface AskCopy {
  // ── lane AIDO: the do-it card ──
  /** The assistant line above the card: one workflow or several. */
  actionLead: (count: number) => string;
  howtoTitle: string;
  forJob: (job: string) => string;
  pickJobNext: string;
  honesty: string;
  start: string;
  startA11y: (label: string) => string;
  answerInstead: string;
  estimateFirst: string;
  pickTitle: string;
  scheduleLeaves: string;
  opened: (label: string) => string;
  saved: (label: string) => string;
  savedNoLabel: string;
  nothing: string;
  openAgain: string;
  openResult: string;
  /** The workflow's name on the card (a key where one exists, else its label). */
  label: (p: Pick<AskActionProposal, 'capabilityId' | 'label'>) => string;
  // ── lane AILOOK: the Ask surface ──
  lookTitle: string;
  lookPlaceholder: string;
  lookThinking: string;
  lookStillThinking: string;
  lookThinkingA11y: string;
  lookSendHintEmpty: string;
  lookSendHintBusy: string;
  lookJumpLatest: string;
  lookSources: string;
  lookEmptyTitle: string;
  lookEmptyHint: string;
}

export function useAskCopy(): AskCopy {
  const { t } = useT();
  return useMemo<AskCopy>(() => ({
    actionLead: (count: number) => (count === 1
      ? t('ai.ask.action.lead.one', 'I can do that.')
      : t('ai.ask.action.lead.many', 'I can do these. Start each one when you\'re ready.')),
    howtoTitle: t('ai.ask.action.howtoTitle', 'Want me to do it?'),
    forJob: (job: string) => t('ai.ask.action.forJob', 'For {job}', { job }),
    pickJobNext: t('ai.ask.action.pickJobNext', 'You\'ll pick the job next'),
    honesty: t('ai.ask.action.honesty', 'From what you typed. Nothing is saved until you check it and tap Build it.'),
    start: t('ai.ask.action.start', 'Start'),
    startA11y: (label: string) => t('ai.ask.action.startA11y', 'Start {label}', { label }),
    answerInstead: t('ai.ask.action.answerInstead', 'Answer instead'),
    estimateFirst: t('ai.ask.action.estimateFirst', 'Build the estimate'),
    pickTitle: t('ai.ask.action.pickTitle', 'Which job?'),
    scheduleLeaves: t('ai.ask.action.scheduleLeaves', 'Opens the schedule. Ask closes on this phone.'),
    opened: (label: string) => t('ai.ask.action.opened', 'Opened {label}', { label }),
    saved: (label: string) => t('ai.ask.action.saved', 'Saved: {label}', { label }),
    savedNoLabel: t('ai.ask.action.savedNoLabel', 'Saved'),
    nothing: t('ai.ask.action.nothing', 'Nothing was saved.'),
    openAgain: t('ai.ask.action.openAgain', 'Open again'),
    openResult: t('ai.ask.action.openResult', 'Open'),
    label: (p) => (p.capabilityId === 'estimateEdit'
      ? t('ai.ask.action.label.estimateEdit', 'Change the estimate')
      : p.label),
    lookTitle: t('ai.ask.look.title', 'Ask MAGE'),
    lookPlaceholder: t('ai.ask.look.placeholder', 'Ask a question or say what to do'),
    lookThinking: t('ai.ask.look.thinking', 'Reading your records'),
    lookStillThinking: t('ai.ask.look.stillThinking', 'Still working on it'),
    lookThinkingA11y: t('ai.ask.look.thinkingA11y', 'MAGE is reading your records'),
    lookSendHintEmpty: t('ai.ask.look.sendHintEmpty', 'Type a question to send'),
    lookSendHintBusy: t('ai.ask.look.sendHintBusy', 'Wait for the answer to finish'),
    lookJumpLatest: t('ai.ask.look.jumpLatest', 'Jump to latest'),
    lookSources: t('ai.ask.look.sources', 'Sources'),
    lookEmptyTitle: t('ai.ask.look.emptyTitle', 'What do you need?'),
    lookEmptyHint: t('ai.ask.look.emptyHint', 'Ask about your jobs, or tell MAGE to start something, like a daily report or a schedule.'),
  }), [t]);
}
