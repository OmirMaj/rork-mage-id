// utils/learn/quizEngine.ts — the skills check's rules, pure (no react-native,
// no storage, no network), so scripts/validate-skill-quiz-engine.ts runs every
// one of them under bun.
//
// WHAT LIVES HERE
//   • orderFor   — the questions in bank order with each question's choices
//                  shuffled by a seeded xorshift32. Same seed, same order; no
//                  Math.random anywhere in this file.
//   • gradeLocal — counts right answers and applies LEARNCORE's passed(), the
//                  SAME integer rule the award function grades with
//                  (correct × 100 ≥ 80 × total; 4 of 5 passes, 3 of 5 does not).
//                  The local grade only decides what the screen shows next.
//                  It never issues anything: the server re-grades from the
//                  answers and its own key (SKILL_QUIZ_KEY).
//   • checkAvailability — hidden (no tutorial def or no bank in this build),
//                  passed (an unrevoked certificate on the current version),
//                  locked (the tutorial is not practised yet), or open.
//   • quizReducer — the screen's state machine:
//        intro → question i → answered i → … → naming (local pass)
//                                             └→ failed (local fail)
//        naming → issuing → issued   (ONLY on an ok award that says passed)
//                         → failed   (the server's numbers, never the local ones)
//                         → pending  (offline: kept on the device, retried)
//                         → refused  (quiz changed / rate limited / server /
//                                     rejected (400) / revoked (410))
//     'result' in the spec is naming | failed: the pass result and the name
//     field are one screen.
//   • afterRetry, canRetryRefused, prefillHolderName, holderNameProblem —
//     small rules the screen and the retry loop share. The name rule is the
//     award function's own cleanHolderName (2 to 80 characters, no '@'), so a
//     name the server would refuse is blocked before Issue, with its reason.
//
// HONESTY. No phase other than 'issued' carries a certificate, and the only
// way into 'issued' is an AWARD_RESULT whose result is { ok: true, passed:
// true }. The validator plants a mutation on exactly that line.

import type { AwardResult, QuizBank, QuizQuestion, SkillCertificate, SkillTopicId } from './types';
import { passed, skillTopic } from './topics';
import type { TutorialDefs, TutorialProgress } from '@/utils/tutorial/types';

// ── Seeded order ────────────────────────────────────────────────────────────

/** xorshift32 over a numeric seed. A zero state would stick at zero, so 0 is
 *  replaced by a fixed odd constant. Returns floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let x = (Math.floor(Math.abs(seed)) >>> 0) || 0x9e3779b9;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    return x / 0x100000000;
  };
}

/** The bank's questions in bank order (they are written to build on each
 *  other), each with its choices shuffled (Fisher–Yates) by `seed`. The input
 *  bank is never mutated. */
export function orderFor(bank: QuizBank, seed: number): QuizQuestion[] {
  const rand = seededRandom(seed);
  return bank.questions.map(q => {
    const choices = q.choices.slice();
    for (let i = choices.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = choices[i];
      choices[i] = choices[j];
      choices[j] = tmp;
    }
    return { ...q, choices };
  });
}

// ── Grading ─────────────────────────────────────────────────────────────────

export interface LocalGrade {
  correct: number;
  total: number;
  passed: boolean;
}

/** Right answers out of the bank's questions. An unanswered question, or an
 *  answer for a question the bank does not have, never counts. */
export function gradeLocal(bank: QuizBank, answers: Readonly<Record<string, string>>): LocalGrade {
  return gradeQuestions(bank.questions, answers);
}

function gradeQuestions(questions: readonly QuizQuestion[], answers: Readonly<Record<string, string>>): LocalGrade {
  const total = questions.length;
  let correct = 0;
  for (const q of questions) {
    if (Object.prototype.hasOwnProperty.call(answers, q.id) && answers[q.id] === q.correctId) correct += 1;
  }
  return { correct, total, passed: passed(correct, total) };
}

// ── Availability ────────────────────────────────────────────────────────────

/** Shown on a locked check (the screen renders the same words through t()). */
export const LOCKED_REASON = 'Finish the tutorial first.';

export type Availability =
  | { kind: 'hidden' }
  | { kind: 'locked'; reason: string }
  | { kind: 'open' }
  | { kind: 'passed'; certificate: SkillCertificate };

/** The certificate that still counts for `topic`: unrevoked and earned on the
 *  topic's current quiz version. Newest first wins. */
export function currentCertificate(topic: string, certs: readonly SkillCertificate[]): SkillCertificate | null {
  const t = skillTopic(topic);
  if (!t) return null;
  const valid = certs.filter(c => c.topic === t.id && c.revokedAt === null && c.quizVersion === t.quizVersion);
  if (valid.length === 0) return null;
  return valid.slice().sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : a.issuedAt > b.issuedAt ? -1 : 0))[0];
}

export function checkAvailability(
  topic: string,
  progress: TutorialProgress,
  defs: TutorialDefs,
  certs: readonly SkillCertificate[],
  banks: Readonly<Partial<Record<SkillTopicId, QuizBank>>>,
): Availability {
  const t = skillTopic(topic);
  if (!t) return { kind: 'hidden' };
  const bank = banks[t.id];
  // No def in this build (a content lane has not landed it) or no questions:
  // the check does not exist yet. Hidden, not locked — a lock would promise
  // something he cannot reach.
  if (!defs[t.id] || !bank || bank.questions.length === 0) return { kind: 'hidden' };
  const cert = currentCertificate(t.id, certs);
  if (cert) return { kind: 'passed', certificate: cert };
  if (progress.byId[t.id]?.status !== 'practised') return { kind: 'locked', reason: LOCKED_REASON };
  return { kind: 'open' };
}

// ── The printed name ────────────────────────────────────────────────────────

/** Longest name the field accepts. */
export const HOLDER_NAME_MAX = 80;

/** The name field's starting value. AuthContext falls back to the email's
 *  local part when the account has no name (user.name = 'omir.m' for
 *  omir.m@…): that fragment is never prefilled, so it can never be printed by
 *  accident. Anything holding an '@' is dropped too. */
export function prefillHolderName(userName: string | null | undefined, email: string | null | undefined): string {
  const name = (userName ?? '').trim();
  if (!name || name.includes('@')) return '';
  const local = (email ?? '').split('@')[0]?.trim() ?? '';
  if (local && name.toLowerCase() === local.toLowerCase()) return '';
  return name.slice(0, HOLDER_NAME_MAX);
}

/** Shortest name the award function accepts. */
export const HOLDER_NAME_MIN = 2;

/** The name before the length and '@' checks: control and format characters
 *  removed, inner runs of spaces collapsed, trimmed. The SAME steps as the
 *  award function's cleanHolderName (supabase/functions/skill-certificate-award). */
function tidyHolderName(raw: string): string {
  return raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim();
}

/** Why a name cannot be printed, or null when it can. Counted in code points,
 *  like the server (and Postgres char_length). */
export type HolderNameProblem = 'empty' | 'short' | 'long' | 'email';
export function holderNameProblem(raw: string): HolderNameProblem | null {
  const name = tidyHolderName(raw);
  const len = [...name].length;
  if (len === 0) return 'empty';
  if (name.includes('@')) return 'email';
  if (len < HOLDER_NAME_MIN) return 'short';
  if (len > HOLDER_NAME_MAX) return 'long';
  return null;
}

/** The name as sent, or '' when the award function would refuse it (400
 *  bad_name). Never shortened: a name over the limit is refused, not cut. */
export function cleanHolderName(raw: string): string {
  return holderNameProblem(raw) === null ? tidyHolderName(raw) : '';
}

// ── Pending awards ──────────────────────────────────────────────────────────

/** AwardResult plus the answers no retry of the SAME request can change:
 *  400 bad_name ('rejected': the name was refused, and he can fix it), any
 *  other 400 ('bad_request': the request itself was refused — a body the
 *  function could not parse, an unknown topic, answers that do not cover the
 *  key; nothing about the name) and 410 (that certificate was revoked). Kept
 *  here, beside the mapping, so the shared type stays as is. */
export type AwardOutcome =
  | AwardResult
  | { ok: false; reason: 'rejected' | 'bad_request' | 'revoked'; message: string };

/** What a retried pending award does to its entry. Kept only while retrying
 *  can still change the answer (offline, a server blip, the hourly limit). */
export function afterRetry(result: AwardOutcome): 'drop' | 'keep' {
  if (result.ok) return 'drop';
  return result.reason === 'offline' || result.reason === 'server' || result.reason === 'rate_limited' ? 'keep' : 'drop';
}

// ── The screen's state machine ──────────────────────────────────────────────

export type RefusedReason = 'quiz_changed' | 'rate_limited' | 'server' | 'rejected' | 'bad_request' | 'revoked';

/** Whether Try again re-sends the award from a refusal. A changed quiz is
 *  retaken instead; a revoked certificate is not issued again. A 'rejected'
 *  one re-sends because he can fix the name first. A 'bad_request' one never
 *  re-sends: the identical body would get the identical 400, so the check is
 *  taken again instead (like a changed quiz). */
export function canRetryRefused(reason: RefusedReason): boolean {
  return reason === 'rate_limited' || reason === 'server' || reason === 'rejected';
}

export type QuizPhase =
  | { kind: 'intro' }
  | { kind: 'question'; index: number }
  | { kind: 'answered'; index: number; choiceId: string; right: boolean }
  | { kind: 'naming'; correct: number; total: number }
  | { kind: 'issuing'; correct: number; total: number }
  | { kind: 'issued'; certificate: SkillCertificate }
  | { kind: 'failed'; correct: number; total: number; source: 'local' | 'server' }
  | { kind: 'pending'; correct: number; total: number }
  | { kind: 'refused'; correct: number; total: number; reason: RefusedReason; message: string };

export interface QuizState {
  topic: SkillTopicId;
  seed: number;
  questions: readonly QuizQuestion[];
  answers: Readonly<Record<string, string>>;
  phase: QuizPhase;
}

export type QuizAction =
  | { type: 'BEGIN' }
  | { type: 'PICK'; choiceId: string }
  | { type: 'NEXT' }
  | { type: 'ISSUE'; holderName: string }
  | { type: 'AWARD_RESULT'; result: AwardOutcome }
  | { type: 'RESTART'; questions: readonly QuizQuestion[]; seed: number }
  | { type: 'RESUME_PENDING'; answers: Readonly<Record<string, string>>; correct: number; total: number };

export function initialQuizState(topic: SkillTopicId, bank: QuizBank, seed: number): QuizState {
  return { topic, seed, questions: orderFor(bank, seed), answers: {}, phase: { kind: 'intro' } };
}

function scoreOf(phase: QuizPhase): { correct: number; total: number } | null {
  switch (phase.kind) {
    case 'naming':
    case 'issuing':
    case 'pending':
    case 'refused':
      return { correct: phase.correct, total: phase.total };
    default:
      return null;
  }
}

export function quizReducer(state: QuizState, action: QuizAction): QuizState {
  const p = state.phase;
  switch (action.type) {
    case 'BEGIN':
      if (p.kind !== 'intro' || state.questions.length === 0) return state;
      return { ...state, phase: { kind: 'question', index: 0 } };

    case 'PICK': {
      // One answer per question: a pick after the reveal changes nothing.
      if (p.kind !== 'question') return state;
      const q = state.questions[p.index];
      if (!q || !q.choices.some(c => c.id === action.choiceId)) return state;
      return {
        ...state,
        answers: { ...state.answers, [q.id]: action.choiceId },
        phase: { kind: 'answered', index: p.index, choiceId: action.choiceId, right: action.choiceId === q.correctId },
      };
    }

    case 'NEXT': {
      if (p.kind !== 'answered') return state;
      const next = p.index + 1;
      if (next < state.questions.length) return { ...state, phase: { kind: 'question', index: next } };
      // orderFor only moves choices, so this equals gradeLocal over the bank.
      const g = gradeQuestions(state.questions, state.answers);
      return {
        ...state,
        phase: g.passed
          ? { kind: 'naming', correct: g.correct, total: g.total }
          : { kind: 'failed', correct: g.correct, total: g.total, source: 'local' },
      };
    }

    case 'ISSUE': {
      // From the name step, or a retry after offline / a refusal that a retry
      // can fix. Never with a name the server would refuse (the button says why).
      if (!cleanHolderName(action.holderName)) return state;
      const canIssue = p.kind === 'naming' || p.kind === 'pending' || (p.kind === 'refused' && canRetryRefused(p.reason));
      const s = scoreOf(p);
      if (!canIssue || !s) return state;
      return { ...state, phase: { kind: 'issuing', correct: s.correct, total: s.total } };
    }

    case 'AWARD_RESULT': {
      // Only an award in flight (or a pending one retried on focus) lands.
      if (p.kind !== 'issuing' && p.kind !== 'pending') return state;
      const r = action.result;
      if (r.ok && r.passed) return { ...state, phase: { kind: 'issued', certificate: r.certificate } };
      if (r.ok) return { ...state, phase: { kind: 'failed', correct: r.correct, total: r.total, source: 'server' } };
      if (r.reason === 'offline') return { ...state, phase: { kind: 'pending', correct: p.correct, total: p.total } };
      return { ...state, phase: { kind: 'refused', correct: p.correct, total: p.total, reason: r.reason, message: r.message } };
    }

    case 'RESTART':
      if (action.questions.length === 0) return state;
      return { ...state, seed: action.seed, questions: action.questions, answers: {}, phase: { kind: 'question', index: 0 } };

    case 'RESUME_PENDING':
      if (p.kind !== 'intro') return state;
      return { ...state, answers: action.answers, phase: { kind: 'pending', correct: action.correct, total: action.total } };

    default:
      return state;
  }
}

/** A fresh numeric seed. The ONE impure helper, kept out of orderFor so the
 *  order stays a pure function of its seed. */
export function freshSeed(now: number = Date.now()): number {
  return (Math.floor(now) % 2147483647) + 1;
}

// ── The award function's answer → AwardResult ──────────────────────────────
// Pure so the validator can drive every branch. certificateClient hands in
// what supabase.functions.invoke resolved with.

/** English fallbacks carried on a refusal; the screen shows its own t() copy
 *  per reason, so these only reach logs and the profile lane. */
export const AWARD_MESSAGES = {
  offline: "Couldn't reach MAGE ID. Your pass is saved on this device.",
  quiz_changed: 'This check was updated. Take the new version to get your certificate.',
  rate_limited: 'Too many tries for now. Try again in an hour.',
  server: "Couldn't issue the certificate just now. Your pass is saved.",
  rejected: "MAGE ID couldn't issue a certificate with this name. Use 2 to 80 characters and no email address.",
  bad_request: "MAGE ID couldn't accept this attempt, so no certificate was issued. Take the check again.",
  revoked: "Your certificate for this check was removed, so it can't be issued again.",
} as const;

function refusal(reason: keyof typeof AWARD_MESSAGES): AwardOutcome {
  return { ok: false, reason, message: AWARD_MESSAGES[reason] };
}

/** The HTTP status a supabase-js error carries (FunctionsHttpError hangs the
 *  Response off `.context`), or null when nothing reached the function. */
function statusOf(error: unknown): number | null {
  const s = (error as { context?: { status?: unknown } } | null)?.context?.status;
  return typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** The snake_case row (award response and table select) → SkillCertificate,
 *  or null when any field is missing or the wrong type. */
export function certificateFromRow(row: unknown): SkillCertificate | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  const topic = typeof r.topic === 'string' ? skillTopic(r.topic) : null;
  const id = str(r.id);
  const holderName = str(r.holder_name);
  const verifyCode = str(r.verify_code);
  const issuedAt = str(r.issued_at);
  const revokedAt = r.revoked_at === null || r.revoked_at === undefined ? null : str(r.revoked_at);
  const ints = [r.quiz_version, r.correct, r.total].every(n => typeof n === 'number' && Number.isInteger(n) && n >= 0);
  if (!topic || !id || !holderName || !verifyCode || !issuedAt || !ints) return null;
  if (r.revoked_at !== null && r.revoked_at !== undefined && revokedAt === null) return null;
  return {
    id,
    topic: topic.id,
    quizVersion: r.quiz_version as number,
    correct: r.correct as number,
    total: r.total as number,
    holderName,
    verifyCode,
    issuedAt,
    revokedAt,
  };
}

/** The award function's 400 error codes that are about the NAME (its
 *  cleanHolderName refused it). Only these get the name copy; every other 400
 *  (bad_request: a body it could not parse, an unknown topic, answers that do
 *  not cover the key, or a body nobody could read) is 'bad_request'. */
export const NAME_REFUSAL_CODES: readonly string[] = ['bad_name'];

/** POST /skill-certificate-award resolved with { data, error } → AwardResult.
 *  `errorCode` is the function's own `error` field from a non-2xx body (the
 *  client reads it through utils/edgeError), or null when none was read.
 *    error, no status (fetch failed, timed out)  → offline
 *    400 bad_name → rejected · any other 400 → bad_request
 *    409 → quiz_changed · 410 → revoked · 429 → rate_limited
 *    any other status → server
 *    200 { passed: false, correct, total }        → ok, not passed (server numbers)
 *    200 { passed: true, certificate } for THIS topic → ok, passed
 *    anything else                                 → server
 *  A certificate is only ever built from the server's own row. */
export function awardResultFrom(data: unknown, error: unknown, topic: SkillTopicId, errorCode: string | null = null): AwardOutcome {
  if (error) {
    const status = statusOf(error);
    if (status === null) return refusal('offline');
    if (status === 400) return refusal(errorCode !== null && NAME_REFUSAL_CODES.includes(errorCode) ? 'rejected' : 'bad_request');
    if (status === 409) return refusal('quiz_changed');
    if (status === 410) return refusal('revoked');
    if (status === 429) return refusal('rate_limited');
    return refusal('server');
  }
  if (typeof data !== 'object' || data === null) return refusal('server');
  const d = data as Record<string, unknown>;
  if (d.passed === false) {
    const { correct, total } = d;
    if (typeof correct === 'number' && typeof total === 'number' && Number.isInteger(correct) && Number.isInteger(total) && correct >= 0 && total > 0 && correct <= total) {
      return { ok: true, passed: false, correct, total };
    }
    return refusal('server');
  }
  if (d.passed === true) {
    const cert = certificateFromRow(d.certificate);
    if (cert && cert.topic === topic && cert.revokedAt === null) return { ok: true, passed: true, certificate: cert };
  }
  return refusal('server');
}
