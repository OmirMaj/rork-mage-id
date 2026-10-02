// utils/learn/types.ts — the skill-check contract every LEARN lane builds on:
// the quiz bank (LEARNBANK), the quiz screen and progress (LEARNQUIZ), the
// award / verify functions (LEARNCERT) and the profile / certificate card
// (LEARNPROFILE). Pure types and two copy constants; no runtime imports.
//
// WHAT THESE ARE. An APP-SKILL certificate says one thing: the person passed a
// short check on using one part of the MAGE ID app, after practising its
// tutorial. It is never a trade, safety, OSHA or licence credential, and
// nothing about it may look like one: no shared names, tables or screens with
// the worker certifications in app/safety-certifications.tsx and
// public.certifications (supabase/migrations/20260708180000_safety_wave_b.sql).
// The words a topic label or certificate title may not use are pinned by
// scripts/validate-learn-topics.ts.
//
// COPY. Quiz text renders from data. `key` / `whyKey` are catalog ids kept for
// a later i18n phase and are NEVER passed to t() (scripts/i18n-extract.ts fails
// a non-literal t() key). See the header of utils/tutorial/types.ts.

import type { I18nKey } from '@/i18n/types';
import type { TutorialId } from '@/utils/tutorial/types';

/** The fifteen tutorials that carry a skills check: the three shipped ones and
 *  the LEARN wave's twelve. Extract<> keeps every member a real TutorialId. */
export type SkillTopicId = Extract<
  TutorialId,
  | 'daily-report-voice'
  | 'punch-walk'
  | 'invoice-to-self'
  | 'estimate-first'
  | 'change-order-draft'
  | 'field-ticket-log'
  | 'takeoff-to-estimate'
  | 'ask-your-plans'
  | 'construction-ai-ask'
  | 'schedule-say-it'
  | 'time-clock-in'
  | 'punch-list-close'
  | 'contract-from-estimate'
  | 'pay-app-period'
  | 'closeout-binder'
>;

export interface SkillTopic {
  id: SkillTopicId;
  /** Short name, e.g. 'Change orders'. */
  label: string;
  /** Always `MAGE ID skills: ${label}`. */
  certificateTitle: string;
  /** One line: `Using ${label, first letter lowercased} in the MAGE ID app.` */
  scope: string;
  /** Bumped when the topic's question bank changes; a certificate records the
   *  version it was earned on, and an award against another is refused. */
  quizVersion: number;
}

export interface QuizChoice {
  id: string;
  en: string;
  /** Catalog id for a later i18n phase — never passed to t(). */
  key: I18nKey;
}

export interface QuizQuestion {
  id: string;
  en: string;
  /** Catalog id for a later i18n phase — never passed to t(). */
  key: I18nKey;
  choices: readonly QuizChoice[];
  correctId: string;
  /** Why the right answer is right, shown after he answers. */
  why: string;
  /** Catalog id for a later i18n phase — never passed to t(). */
  whyKey: I18nKey;
  /** Where in the code the answer is true: a validator reads `file` and
   *  requires `mustContain`, so a question cannot outlive the feature. */
  source: { file: string; mustContain: string };
}

export interface QuizBank {
  topic: SkillTopicId;
  version: number;
  questions: readonly QuizQuestion[];
}

export interface SkillCertificate {
  id: string;
  topic: SkillTopicId;
  quizVersion: number;
  correct: number;
  total: number;
  /** The name the account holder typed. Not checked (CERT_NAME_NOTE). */
  holderName: string;
  verifyCode: string;
  issuedAt: string;
  revokedAt: string | null;
}

export type AwardResult =
  | { ok: true; passed: true; certificate: SkillCertificate }
  | { ok: true; passed: false; correct: number; total: number }
  | { ok: false; reason: 'offline' | 'quiz_changed' | 'rate_limited' | 'server'; message: string };

/** Printed on every certificate, card, PDF and the verify page. The ONE string
 *  in the LEARN track allowed to name 'safety' and 'license' — it says what a
 *  certificate is not. */
export const CERT_SCOPE_NOTE =
  'This shows the person passed a short check on using the MAGE ID app. It is not a trade, safety or license credential.';

/** Shown under the printed name (verify page, card, PDF, naming step): the
 *  name is client-typed, so any name can be printed. */
export const CERT_NAME_NOTE = 'The name is the one the account holder typed. MAGE ID does not check identity.';
