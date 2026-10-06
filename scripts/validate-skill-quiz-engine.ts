// validate-skill-quiz-engine.ts — the skills check's engine, screen and
// finale door (lane LEARNQUIZ).
//
// WHAT IT HOLDS
//   1. gradeLocal agrees with LEARNCORE passed() AND with the server's key
//      (SKILL_QUIZ_KEY, what skill-certificate-award grades with) for every
//      bank and every subset of right answers (0..5 right).
//   2. orderFor is a permutation of each question's choices, keeps question
//      order and the right answer, never mutates the bank, and is the same for
//      the same seed; the engine never calls Math.random.
//   3. checkAvailability: hidden / locked / open / passed over practised or
//      not, no / valid / revoked / old-version / other-topic certificate.
//   4. skillsProgress parses garbage to EMPTY and drops bad entries one by one.
//   5. quizReducer: the only way into 'issued' is { ok: true, passed: true };
//      a server "not passed" shows the SERVER's numbers; offline → pending;
//      an empty name never issues; a revoked or changed-quiz refusal never
//      re-issues.
//   6. awardResultFrom maps every status of the award contract (400 rejected
//      and 410 revoked are dropped from the pending list, never retried). Only
//      the function's NAME code (bad_name) gets the name copy; any other 400
//      (bad_request, an unreadable body, no code) is 'bad_request': its own
//      copy that never mentions the name, never re-sent unchanged.
//   6b. The client's name rule equals the award function's cleanHolderName
//      (its body is lifted from the server file and run on the same names).
//   7. Source scans: the screen draws the certificate only from the reducer's
//      issued phase, the haptic and the issued event sit inside the ok-award
//      branch, the intro states the scope, the finale door ends the run before
//      it opens /skills-check, and analytics carry { topic } only.
//   8. PLANTED MUTATIONS: each of thirteen one-line breaks of the engine
//      (loaded from a temp copy) must turn at least one engine check red, and
//      each of five breaks of the screen/card/client source must turn a scan red.
//
// Pure: imports only the bun-safe engine, bank, topics and the generated key.
// Run: bun run scripts/validate-skill-quiz-engine.ts

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as RealEngine from '../utils/learn/quizEngine';
import { parseSkillsProgress, EMPTY_SKILLS_PROGRESS, withPending, withoutPending } from '../utils/learn/skillsProgress';
import { QUIZ_BANKS } from '../utils/learn/quizBank';
import { SKILL_TOPICS, passed, skillTopic } from '../utils/learn/topics';
import { CERT_SCOPE_NOTE } from '../utils/learn/types';
import type { QuizBank, SkillCertificate, SkillTopicId } from '../utils/learn/types';
import type { AwardOutcome as AwardResult } from '../utils/learn/quizEngine';
import { SKILL_QUIZ_KEY, SKILL_PASS_PCT } from '../supabase/functions/_shared/skillQuizKey.generated';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass += 1; console.log('  ✓', name); }
  else { fail += 1; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

type Engine = typeof RealEngine;
const BANKS = Object.values(QUIZ_BANKS) as QuizBank[];

// ── Engine checks, runnable against the real engine or a mutated copy ──────
// Each returns the names of the checks that failed (empty = all green).

function cert(over: Partial<SkillCertificate> = {}): SkillCertificate {
  return {
    id: 'c1', topic: 'punch-walk', quizVersion: 1, correct: 5, total: 5, holderName: 'Dana Ruiz',
    verifyCode: 'ABC123', issuedAt: '2026-10-01T12:00:00Z', revokedAt: null, ...over,
  };
}

function engineChecks(E: Engine): string[] {
  const bad: string[] = [];
  const check = (name: string, cond: boolean) => { if (!cond) bad.push(name); };

  // 1. Grading agrees with passed() and the server key, every subset.
  for (const bank of BANKS) {
    const key = SKILL_QUIZ_KEY.TOPICS[bank.topic];
    const n = bank.questions.length;
    for (let mask = 0; mask < (1 << n); mask += 1) {
      const answers: Record<string, string> = {};
      let right = 0;
      bank.questions.forEach((q, i) => {
        if (mask & (1 << i)) { answers[q.id] = q.correctId; right += 1; }
        else answers[q.id] = q.choices.find(c => c.id !== q.correctId)!.id;
      });
      const g = E.gradeLocal(bank, answers);
      const serverRight = Object.entries(answers).filter(([qid, cid]) => key?.answers[qid] === cid).length;
      const serverPass = serverRight * 100 >= SKILL_PASS_PCT * (key?.total ?? -1);
      check(`grade ${bank.topic} mask ${mask}`, g.correct === right && g.total === n && g.passed === passed(right, n)
        && serverRight === right && serverPass === g.passed);
    }
    // Unanswered questions never count.
    check(`grade ${bank.topic} empty`, E.gradeLocal(bank, {}).correct === 0);
  }

  // 2. orderFor: permutation, deterministic, bank untouched.
  for (const bank of BANKS) {
    const before = JSON.stringify(bank);
    for (const seed of [0, 1, 2, 42, 123456, 2147483647, -5]) {
      const a = E.orderFor(bank, seed);
      const b = E.orderFor(bank, seed);
      check(`order ${bank.topic} ${seed} deterministic`, JSON.stringify(a) === JSON.stringify(b));
      check(`order ${bank.topic} ${seed} question order`, a.map(q => q.id).join() === bank.questions.map(q => q.id).join());
      a.forEach((q, i) => {
        const orig = bank.questions[i];
        const ids = q.choices.map(c => c.id).sort().join();
        check(`order ${bank.topic} ${seed} ${q.id} permutation`, ids === orig.choices.map(c => c.id).sort().join() && q.choices.length === orig.choices.length);
        check(`order ${bank.topic} ${seed} ${q.id} right answer kept`, q.correctId === orig.correctId);
      });
    }
    check(`order ${bank.topic} bank untouched`, JSON.stringify(bank) === before);
  }
  // It actually shuffles: across 40 seeds the first question takes > 1 order.
  const firstOrders = new Set<string>();
  for (let s = 1; s <= 40; s += 1) firstOrders.add(E.orderFor(BANKS[0], s)[0].choices.map(c => c.id).join());
  check('order shuffles across seeds', firstOrders.size > 1);

  // 3. Availability.
  const defs = { 'punch-walk': {} } as never;
  const banks = { 'punch-walk': QUIZ_BANKS['punch-walk'] };
  const practised = { v: 1 as const, byId: { 'punch-walk': { status: 'practised' as const, version: 1 } }, chips: {} };
  const fresh = { v: 1 as const, byId: {}, chips: {} };
  const exited = { v: 1 as const, byId: { 'punch-walk': { status: 'exited' as const, version: 1 } }, chips: {} };
  const kind = (a: { kind: string }) => a.kind;
  check('avail: unknown topic hidden', kind(E.checkAvailability('nope', practised, defs, [], banks)) === 'hidden');
  check('avail: no def hidden', kind(E.checkAvailability('punch-walk', practised, {} as never, [], banks)) === 'hidden');
  check('avail: no bank hidden', kind(E.checkAvailability('punch-walk', practised, defs, [], {})) === 'hidden');
  const locked = E.checkAvailability('punch-walk', fresh, defs, [], banks);
  check('avail: not practised locked', locked.kind === 'locked' && locked.reason === 'Finish the tutorial first.');
  check('avail: exited locked', kind(E.checkAvailability('punch-walk', exited, defs, [], banks)) === 'locked');
  check('avail: practised open', kind(E.checkAvailability('punch-walk', practised, defs, [], banks)) === 'open');
  check('avail: valid cert passed', kind(E.checkAvailability('punch-walk', practised, defs, [cert()], banks)) === 'passed');
  check('avail: cert beats lock (new phone)', kind(E.checkAvailability('punch-walk', fresh, defs, [cert()], banks)) === 'passed');
  check('avail: revoked cert open', kind(E.checkAvailability('punch-walk', practised, defs, [cert({ revokedAt: '2026-10-02T00:00:00Z' })], banks)) === 'open');
  check('avail: old version open', kind(E.checkAvailability('punch-walk', practised, defs, [cert({ quizVersion: 0 })], banks)) === 'open');
  check('avail: other topic open', kind(E.checkAvailability('punch-walk', practised, defs, [cert({ topic: 'invoice-to-self' })], banks)) === 'open');

  // 4. The name.
  check('name: email prefix never prefilled', E.prefillHolderName('omir.m', 'omir.m@example.com') === '');
  check('name: email prefix, any case', E.prefillHolderName('Omir.M', 'omir.m@example.com') === '');
  check('name: real name kept', E.prefillHolderName('Dana Ruiz', 'dana@example.com') === 'Dana Ruiz');
  check('name: an email never prefilled', E.prefillHolderName('dana@example.com', null) === '');
  check('name: none → empty', E.prefillHolderName(null, null) === '' && E.prefillHolderName('  ', 'x@y.z') === '');
  check('name: cleaned', E.cleanHolderName('  Dana   Ruiz ') === 'Dana Ruiz');
  check('name: over 80 refused, not cut', E.cleanHolderName('x'.repeat(81)) === '' && E.cleanHolderName('x'.repeat(80)) === 'x'.repeat(80)
    && E.holderNameProblem('x'.repeat(81)) === 'long');
  check('name: one character refused', E.cleanHolderName('D') === '' && E.holderNameProblem(' D ') === 'short' && E.cleanHolderName('Di') === 'Di');
  check("name: an '@' refused", E.cleanHolderName('dana@example.com') === '' && E.holderNameProblem('Dana @ Ruiz') === 'email');
  check('name: empty is empty', E.holderNameProblem('  ') === 'empty' && E.holderNameProblem('') === 'empty' && E.holderNameProblem('Dana') === null);
  check('name: control characters dropped', E.cleanHolderName('Dana\u202E Ruiz') === 'Dana Ruiz' && E.cleanHolderName('\u200B\u200BD') === '');

  // 5. afterRetry.
  const off: AwardResult = { ok: false, reason: 'offline', message: '' };
  check('retry: offline keeps', E.afterRetry(off) === 'keep');
  check('retry: server keeps', E.afterRetry({ ok: false, reason: 'server', message: '' }) === 'keep');
  check('retry: rate limited keeps', E.afterRetry({ ok: false, reason: 'rate_limited', message: '' }) === 'keep');
  check('retry: quiz changed drops', E.afterRetry({ ok: false, reason: 'quiz_changed', message: '' }) === 'drop');
  check('retry: a refused name / request (400) drops', E.afterRetry({ ok: false, reason: 'rejected', message: '' }) === 'drop');
  check('retry: a revoked certificate (410) drops', E.afterRetry({ ok: false, reason: 'revoked', message: '' }) === 'drop');
  check('retry: a refused request (400 bad_request) drops', E.afterRetry({ ok: false, reason: 'bad_request', message: '' }) === 'drop');
  check('retry: an answer drops', E.afterRetry({ ok: true, passed: false, correct: 2, total: 5 }) === 'drop'
    && E.afterRetry({ ok: true, passed: true, certificate: cert() }) === 'drop');

  // 6. The reducer.
  const bank = QUIZ_BANKS['punch-walk'];
  const start = E.initialQuizState('punch-walk', bank, 7);
  let s = E.quizReducer(start, { type: 'BEGIN' });
  check('reducer: begin → question 0', s.phase.kind === 'question' && (s.phase as { index: number }).index === 0);
  const answerAll = (st: typeof s, rightCount: number) => {
    let cur = st;
    cur.questions.forEach((q, i) => {
      const choice = i < rightCount ? q.correctId : q.choices.find(c => c.id !== q.correctId)!.id;
      cur = E.quizReducer(cur, { type: 'PICK', choiceId: choice });
      // A second pick after the reveal changes nothing.
      const again = E.quizReducer(cur, { type: 'PICK', choiceId: q.correctId });
      if (again !== cur) bad.push('reducer: second pick ignored');
      cur = E.quizReducer(cur, { type: 'NEXT' });
    });
    return cur;
  };
  const passedState = answerAll(s, 4);
  check('reducer: 4 of 5 → naming', passedState.phase.kind === 'naming' && (passedState.phase as { correct: number }).correct === 4);
  const failedState = answerAll(s, 3);
  check('reducer: 3 of 5 → failed (local)', failedState.phase.kind === 'failed' && (failedState.phase as { source: string }).source === 'local');
  check('reducer: empty name never issues', E.quizReducer(passedState, { type: 'ISSUE', holderName: '   ' }) === passedState);
  check('reducer: a name the server refuses never issues', E.quizReducer(passedState, { type: 'ISSUE', holderName: 'D' }) === passedState
    && E.quizReducer(passedState, { type: 'ISSUE', holderName: 'd@x.co' }) === passedState);
  const issuing = E.quizReducer(passedState, { type: 'ISSUE', holderName: 'Dana Ruiz' });
  check('reducer: name → issuing', issuing.phase.kind === 'issuing');
  check('reducer: award before issuing ignored', E.quizReducer(passedState, { type: 'AWARD_RESULT', result: { ok: true, passed: true, certificate: cert() } }) === passedState);
  const issued = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: true, passed: true, certificate: cert() } });
  check('reducer: ok + passed → issued', issued.phase.kind === 'issued');
  const serverFail = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: true, passed: false, correct: 2, total: 5 } });
  check('reducer: server not passed → failed with the SERVER numbers', serverFail.phase.kind === 'failed'
    && (serverFail.phase as { correct: number }).correct === 2 && (serverFail.phase as { source: string }).source === 'server');
  const pending = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: off });
  check('reducer: offline → pending', pending.phase.kind === 'pending');
  const changed = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: false, reason: 'quiz_changed', message: '' } });
  check('reducer: quiz changed → refused', changed.phase.kind === 'refused');
  check('reducer: quiz changed cannot re-issue', E.quizReducer(changed, { type: 'ISSUE', holderName: 'Dana' }) === changed);
  const server = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: false, reason: 'server', message: '' } });
  check('reducer: server blip can re-issue', E.quizReducer(server, { type: 'ISSUE', holderName: 'Dana' }).phase.kind === 'issuing');
  const revoked = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: false, reason: 'revoked', message: '' } });
  check('reducer: revoked → refused, never re-issued', revoked.phase.kind === 'refused' && E.quizReducer(revoked, { type: 'ISSUE', holderName: 'Dana' }) === revoked);
  const rejected = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: false, reason: 'rejected', message: '' } });
  check('reducer: rejected → refused, re-issued after a name fix', rejected.phase.kind === 'refused'
    && E.quizReducer(rejected, { type: 'ISSUE', holderName: 'Dana Ruiz' }).phase.kind === 'issuing');
  check('canRetryRefused: only rate_limited / server / rejected', E.canRetryRefused('rate_limited') && E.canRetryRefused('server') && E.canRetryRefused('rejected')
    && !E.canRetryRefused('quiz_changed') && !E.canRetryRefused('revoked') && !E.canRetryRefused('bad_request'));
  const badRequest = E.quizReducer(issuing, { type: 'AWARD_RESULT', result: { ok: false, reason: 'bad_request', message: '' } });
  check('reducer: bad_request → refused, never re-sent unchanged', badRequest.phase.kind === 'refused'
    && E.quizReducer(badRequest, { type: 'ISSUE', holderName: 'Dana Ruiz' }) === badRequest);
  check('reducer: pending + ok award → issued', E.quizReducer(pending, { type: 'AWARD_RESULT', result: { ok: true, passed: true, certificate: cert() } }).phase.kind === 'issued');
  const restarted = E.quizReducer(failedState, { type: 'RESTART', questions: E.orderFor(bank, 99), seed: 99 });
  check('reducer: restart clears answers', restarted.phase.kind === 'question' && Object.keys(restarted.answers).length === 0 && restarted.seed === 99);
  // No phase but 'issued' carries a certificate.
  const everyPhase = [start, s, passedState, failedState, issuing, serverFail, pending, changed, server, revoked, rejected, badRequest, restarted];
  check('reducer: only issued carries a certificate', everyPhase.every(st => !('certificate' in st.phase)) && 'certificate' in issued.phase);

  // 7. The award contract.
  const status = (n: number) => ({ message: 'x', context: { status: n } });
  const award = (d: unknown, e: unknown, code: string | null = null) => E.awardResultFrom(d, e, 'punch-walk', code);
  const reason = (r: AwardResult) => (r.ok ? (r.passed ? 'passed' : 'not_passed') : r.reason);
  const row = { id: 'c1', topic: 'punch-walk', quiz_version: 1, correct: 5, total: 5, holder_name: 'Dana Ruiz', verify_code: 'ABC123', issued_at: '2026-10-01T12:00:00Z', revoked_at: null };
  check('award: no status → offline', reason(award(null, { message: 'Failed to send' })) === 'offline');
  check('award: 409 → quiz_changed', reason(award(null, status(409))) === 'quiz_changed');
  check('award: 429 → rate_limited', reason(award(null, status(429))) === 'rate_limited');
  check('award: 400 bad_name → rejected (the name copy)', reason(award(null, status(400), 'bad_name')) === 'rejected');
  check('award: 400 bad_request → bad_request, not the name copy', reason(award(null, status(400), 'bad_request')) === 'bad_request');
  check('award: 400 with no readable code (null / http_400 / unknown) → bad_request',
    [null, 'http_400', 'unknown_code', ''].every(c => reason(award(null, status(400), c)) === 'bad_request'));
  check('award: the name codes are exactly the server\'s bad_name', E.NAME_REFUSAL_CODES.length === 1 && E.NAME_REFUSAL_CODES[0] === 'bad_name');
  check('award: a code on a non-400 changes nothing', reason(award(null, status(409), 'bad_name')) === 'quiz_changed'
    && reason(award(null, status(500), 'bad_name')) === 'server');
  const badCopy = award(null, status(400), 'bad_request');
  check('award: the bad_request copy never talks about the name', !badCopy.ok && !/\bname\b/i.test(badCopy.message) && badCopy.message === E.AWARD_MESSAGES.bad_request);
  check('award: 410 → revoked', reason(award(null, status(410))) === 'revoked');
  check('award: 500 / 401 / 403 → server', [500, 401, 403].every(n => reason(award(null, status(n))) === 'server'));
  const np = award({ passed: false, correct: 2, total: 5 }, null);
  check('award: 200 not passed → server numbers', np.ok && !np.passed && np.correct === 2 && np.total === 5);
  const yes = award({ passed: true, certificate: row }, null);
  check('award: 200 passed → certificate', yes.ok && yes.passed && yes.certificate.verifyCode === 'ABC123' && yes.certificate.holderName === 'Dana Ruiz');
  check('award: another topic\'s certificate → server', reason(award({ passed: true, certificate: { ...row, topic: 'invoice-to-self' } }, null)) === 'server');
  check('award: a revoked certificate → server', reason(award({ passed: true, certificate: { ...row, revoked_at: '2026-10-02' } }, null)) === 'server');
  check('award: a malformed certificate → server', reason(award({ passed: true, certificate: { ...row, verify_code: 7 } }, null)) === 'server');
  check('award: passed with no certificate → server', reason(award({ passed: true }, null)) === 'server');
  check('award: empty body → server', reason(award(null, null)) === 'server');

  return bad;
}

// ── 1-6: the real engine ───────────────────────────────────────────────────
console.log('\nskills check engine (real):');
const realBad = engineChecks(RealEngine);
ok('every engine check passes on the real engine', realBad.length === 0, realBad.slice(0, 12).join('\n      '));

console.log('\nbank, topic and server key agree:');
for (const t of SKILL_TOPICS) {
  const b = QUIZ_BANKS[t.id];
  const k = SKILL_QUIZ_KEY.TOPICS[t.id];
  ok(`${t.id}: topic v${t.quizVersion} = bank v${b.version} = key v${k?.version}`, b.version === t.quizVersion && k?.version === b.version && k.total === b.questions.length);
}
ok('the server key uses the same pass percentage', SKILL_PASS_PCT === 80 && SKILL_QUIZ_KEY.PASS_PCT === 80);

// ── 4. skillsProgress parse ────────────────────────────────────────────────
console.log('\nmageid_skills_v1 parse:');
const garbage: unknown[] = [null, undefined, 'not json', '{"v":2}', 123, [], '[]', { v: 1, pending: 'x' }, { v: '1' }];
ok('garbage parses to EMPTY', garbage.every(g => JSON.stringify(parseSkillsProgress(g)) === JSON.stringify(EMPTY_SKILLS_PROGRESS)));
const goodPending = { topic: 'punch-walk', quizVersion: 1, answers: { q1: 'a' }, holderName: 'Dana Ruiz', passedAt: '2026-10-01T00:00:00Z' };
const parsed = parseSkillsProgress(JSON.stringify({
  v: 1,
  pending: [
    goodPending,
    { ...goodPending, topic: 'not-a-topic' },
    { ...goodPending, topic: 'invoice-to-self', holderName: '  ' },
    { ...goodPending, topic: 'invoice-to-self', answers: { q1: 5 } },
    { ...goodPending, topic: 'daily-report-voice', quizVersion: 0 },
    { ...goodPending, holderName: 'Newer Name' },
  ],
  lastAttempt: {
    'punch-walk': { correct: 4, total: 5, at: 'x' },
    'invoice-to-self': { correct: 6, total: 5, at: 'x' },
    'nope': { correct: 1, total: 5, at: 'x' },
    'daily-report-voice': { correct: 'a', total: 5, at: 'x' },
  },
}));
ok('another schema version parses to EMPTY, even with good entries', parseSkillsProgress({ v: 2, pending: [goodPending], lastAttempt: {} }).pending.length === 0);
ok('bad pending entries dropped one by one; one per topic, newest wins', parsed.pending.length === 1 && parsed.pending[0].holderName === 'Newer Name');
ok('bad attempts dropped (unknown topic, correct > total, not a count)', JSON.stringify(Object.keys(parsed.lastAttempt)) === JSON.stringify(['punch-walk']));
const w = withPending(EMPTY_SKILLS_PROGRESS, { ...goodPending, topic: 'punch-walk' as SkillTopicId });
ok('withPending / withoutPending round-trip', w.pending.length === 1 && withoutPending(w, 'punch-walk').pending.length === 0 && EMPTY_SKILLS_PROGRESS.pending.length === 0);
ok('the key sits under the swept mageid_ prefix', /SKILLS_PROGRESS_KEY = 'mageid_skills_v1'/.test(read('utils/learn/skillsProgress.ts')));

// ── 7. Source scans (functions, so the planted mutations can reuse them) ───
console.log('\nscreen, card and finale (source):');
const engineSrc = read('utils/learn/quizEngine.ts');
const screenSrc = read('app/skills-check.tsx');
const cardSrc = read('components/learn/QuizResultCard.tsx');
const hostSrc = read('components/tutorial/TutorialHost.tsx');
const finaleSrc = read('components/tutorial/FinaleCard.tsx');
const storeSrc = read('utils/tutorial/store.ts');
const hubSrc = read('app/tutorials.tsx');
const clientSrc = read('utils/learn/certificateClient.ts');

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}

type Scan = { name: string; test: (src: string) => boolean };

/** The certificate preview is drawn only inside the card's issued branch. */
const scanCardIssued: Scan = {
  name: 'QuizResultCard draws the certificate ONLY inside `if (phase.kind === \'issued\')`',
  test: src => {
    const c = code(src);
    const at = c.indexOf("if (phase.kind === 'issued') {");
    const certAt = c.indexOf('testID="skills-check-certificate"');
    const nextBranch = c.indexOf('if (phase.kind', at + 10);
    return at >= 0 && certAt > at && certAt < nextBranch && c.split('testID="skills-check-certificate"').length === 2;
  },
};
/** The screen hands the card the reducer's own phase. */
const scanScreenPhase: Scan = {
  name: 'the screen renders the result from the reducer state (const phase = state.phase → <QuizResultCard phase={phase}>)',
  test: src => {
    const c = code(src);
    return /const phase = state\.phase;/.test(c) && /<QuizResultCard phase=\{phase\}/.test(c) && /useReducer\(quizReducer,/.test(c);
  },
};
/** Haptic + issued event live inside the ok-award branch, once each. */
const scanHaptic: Scan = {
  name: 'haptic.success() and skill_certificate_issued fire only inside `if (result.ok && result.passed)`',
  test: src => {
    const c = code(src);
    const m = c.match(/if \(result\.ok && result\.passed\) \{([\s\S]*?)\}/);
    return !!m && /haptic\.success\(\)/.test(m[1]) && /track\('skill_certificate_issued'/.test(m[1])
      && c.split('haptic.success()').length === 2 && c.split("'skill_certificate_issued'").length === 2
      && !/haptic\.(warning|error)\(/.test(c);
  },
};
/** The engine builds 'issued' in exactly one place, behind ok && passed. */
const scanEngineIssued: Scan = {
  name: "the engine builds an 'issued' phase only behind `r.ok && r.passed`",
  test: src => {
    const c = code(src);
    return c.split("kind: 'issued',").length === 2 && /if \(r\.ok && r\.passed\) return \{ \.\.\.state, phase: \{ kind: 'issued', certificate: r\.certificate \} \};/.test(c);
  },
};

/** A 400's own code reaches the mapping: the client reads the body through
 *  readEdgeError (the one reader) and hands the code to awardResultFrom. */
const scanClient400Code: Scan = {
  name: "certificateClient reads a 400's error code (readEdgeError) and passes it to awardResultFrom",
  test: src => {
    const c = code(src);
    return /if \(error && edgeErrorStatus\(error\) === 400\) \{\s*const info = await readEdgeError\(error, [^)]*\);\s*errorCode = info\.code \|\| info\.message;\s*\}/.test(c)
      && /const result = awardResultFrom\(data, error, input\.topic, errorCode\);/.test(c)
      && c.split('awardResultFrom(data, error, input.topic').length === 2;
  },
};

// ── 6b. The name rule: client == award function ───────────────────────────
// The server's cleanHolderName body is lifted from its file (it carries no
// type annotations inside the body) and run on the same names as the client.
{
  const awardSrc = read('supabase/functions/skill-certificate-award/index.ts');
  const m = awardSrc.match(/export function cleanHolderName\(raw: string\): string \| null \{\n([\s\S]*?)\n\}/);
  ok('the award function\'s cleanHolderName is found', !!m);
  if (m) {
    const server = new Function('raw', m[1]) as (raw: string) => string | null;
    const NAMES = ['', ' ', 'D', ' D ', 'Di', 'Dana Ruiz', '  Dana   Ruiz ', 'dana@example.com', 'Dana @ Ruiz', 'x'.repeat(80), 'x'.repeat(81),
      'Dana\u202E Ruiz', '\u200B\u200BD', 'D\u0000a', 'José Núñez', '李小龙', '😀', '😀😀', '😀'.repeat(80), '😀'.repeat(41), 'A\tB\nC', '\u00ADD'];
    const off = NAMES.filter(n => (server(n) ?? '') !== RealEngine.cleanHolderName(n));
    ok(`client cleanHolderName == server cleanHolderName on ${NAMES.length} names`, off.length === 0, off.map(n => JSON.stringify(n)).join(', '));
    const problems = NAMES.filter(n => (server(n) === null) !== (RealEngine.holderNameProblem(n) !== null));
    ok('holderNameProblem blocks exactly the names the server refuses', problems.length === 0, problems.map(n => JSON.stringify(n)).join(', '));
  }
}

for (const s of [scanCardIssued, scanScreenPhase, scanHaptic]) ok(s.name, s.test(s === scanCardIssued ? cardSrc : screenSrc));
ok(scanEngineIssued.name, scanEngineIssued.test(engineSrc));
ok('the engine never calls Math.random', !/Math\.random/.test(code(engineSrc)));

const sc = code(screenSrc);
ok('the intro states the scope (CERT_SCOPE_NOTE) and the 5 / 4 rule', /\{CERT_SCOPE_NOTE\}/.test(sc) && sc.includes("'5 questions about using MAGE ID. Get 4 right to pass.'")
  && CERT_SCOPE_NOTE.includes('not a trade, safety or license credential'));
ok('the locked copy equals the engine\'s LOCKED_REASON', sc.includes(`'${RealEngine.LOCKED_REASON}'`));
ok('the name field is prefilled through prefillHolderName(user?.name, user?.email)', /prefillHolderName\(user\?\.name, user\?\.email\)/.test(sc));
ok('the name step shows CERT_NAME_NOTE after the helper', /nameHelper[\s\S]{0,300}\{CERT_NAME_NOTE\}/.test(code(cardSrc)));
ok('a name the server would refuse blocks Issue and says which rule', /const nameProblem = holderNameProblem\(holderName\);/.test(sc)
  && /disabled=\{phase\.kind === 'naming' && nameBlocked\}/.test(sc) && sc.includes("'Add the name to print first.'")
  && sc.includes("'Use a name, not an email address.'") && sc.includes("'Use at least 2 characters for the name.'") && sc.includes("'Use 80 characters or fewer for the name.'"));
ok('a revoked refusal offers Done, not Try again', /phase\.kind === 'refused' && phase\.reason === 'revoked'\) \{\s*(?:\/\/[^\n]*\n\s*)?bar = <Button label=\{t\('settings\.learn\.done'/.test(sc));
ok('the card has its own copy for rejected and revoked', code(cardSrc).includes("'settings.learn.awardRejected'") && code(cardSrc).includes("'settings.learn.awardRevoked'"));
{
  const m = code(cardSrc).match(/t\('settings\.learn\.awardBadRequest', "([^"]+)"\)/);
  ok('the card has its own bad_request copy, and it never talks about the name', !!m && !/\bname\b/i.test(m[1]) && m[1] === RealEngine.AWARD_MESSAGES.bad_request);
}
ok('a bad_request refusal hides the name field and retakes the check (never re-sends the same body)',
  /phase\.reason === 'quiz_changed' \|\| phase\.reason === 'bad_request' \|\| phase\.reason === 'revoked'\)\) \? \(/.test(code(cardSrc))
  && /const fresh = phase\.kind === 'refused' && \(phase\.reason === 'quiz_changed' \|\| phase\.reason === 'bad_request'\);/.test(sc));
ok(scanClient400Code.name, scanClient400Code.test(clientSrc));
{
  // The award function's 400 codes: bad_name only from the name check, every
  // other 400 is bad_request — so NAME_REFUSAL_CODES is exactly its name code.
  const awardSrc = read('supabase/functions/skill-certificate-award/index.ts');
  const codes400 = [...awardSrc.matchAll(/json\(\{ error: "([a-z_]+)" \}, 400\)/g)].map(m => m[1]);
  ok(`the award function's 400 codes are bad_request / bad_name (${codes400.join(', ')})`,
    codes400.length >= 2 && codes400.every(c => c === 'bad_request' || c === 'bad_name') && codes400.filter(c => c === 'bad_name').length === 1);
  ok('bad_name is answered only when cleanHolderName refuses the name, and it is the only name code',
    /const holderName = cleanHolderName\(body\.holderName\);\s*if \(!holderName\) return json\(\{ error: "bad_name" \}, 400\);/.test(awardSrc)
    && RealEngine.NAME_REFUSAL_CODES.join() === 'bad_name');
}
ok('the client never sends a name the server would refuse', /const holderName = cleanHolderName\(input\.holderName\);\s*if \(!holderName\) return \{ ok: false, reason: 'rejected'/.test(code(clientSrc)));
ok('a failed check offers Try again and Practice the tutorial again (startTutorial … entry: \'hub\')',
  sc.includes("'Practice the Tutorial Again'") && /startTutorial\(topicId, \{ entry: 'hub' \}\)/.test(sc));
ok('pending awards retry on focus and on the foreground', /useFocusEffect\(/.test(sc) && /AppState\.addEventListener\('change'/.test(sc) && /retryPendingAwards\(/.test(sc));
ok('the screen clears the Brain FAB', /BRAIN_FAB_CLEARANCE/.test(sc));
ok('no tier gate on the check (free on every plan)', !/useTierAccess|requireTier|Paywall/.test(sc));
const trackCalls = [...(sc + code(hostSrc)).matchAll(/track\('(skills?_[a-z_]+)', \{([^}]*)\}\)/g)];
ok(`analytics carry { topic } only (${trackCalls.length} calls)`, trackCalls.length >= 5 && trackCalls.every(m => /^\s*topic: [A-Za-z.]+\s*$/.test(m[2])),
  trackCalls.map(m => m[0]).join(' | '));
ok('the issuing call is NOT routed through the offline queue, and says why', !/offlineQueue'/.test(code(clientSrc)) && /NOT ROUTED THROUGH utils\/offlineQueue\.ts, ON PURPOSE/.test(clientSrc));
ok('verifyUrl is https://mageid.app/skills/<code>', /`https:\/\/mageid\.app\/skills\/\$\{encodeURIComponent\(code\)\}`/.test(clientSrc));

ok('FinalePresentation carries quiz', /quiz: FinaleAction \| null;/.test(code(storeSrc)));
const hc = code(hostSrc);
ok("finaleAction 'quiz': FINISH, then push /skills-check with the topic",
  /if \(key === 'quiz'\) \{[\s\S]{0,300}dispatchTutorial\(\{ type: 'FINISH'[\s\S]{0,120}push\(\{ pathname: '\/skills-check', params: \{ topic \} \}\)/.test(hc));
ok('the door is offered only with a bank and no current certificate', /QUIZ_BANKS\[topic\.id\]\?\.questions\.length > 0/.test(hc) && /currentCertificate\(topic\.id, certs\) \? null : topic\.id/.test(hc));
ok("the finale's quiz label is literal t('settings.learn.finaleQuiz', 'Take the Skills Check')", hc.includes("t('settings.learn.finaleQuiz', 'Take the Skills Check')"));
const fc = code(finaleSrc);
ok('FinaleCard draws the quiz button above Done', fc.indexOf('tutorial-finale-quiz') > 0 && fc.indexOf('tutorial-finale-quiz') < fc.indexOf('tutorial-finale-done'));
const hb = code(hubSrc);
ok('the hub lines: passed / take it, from checkAvailability', /checkAvailability\(c\.id, progress, TUTORIAL_DEFS, certs, QUIZ_BANKS\)/.test(hb)
  && hb.includes("'Skills check: passed'") && hb.includes("'Skills check: take it'") && /pathname: '\/skills-check', params: \{ topic: id \}/.test(hb));
ok('the hub view stays prop-driven (checks default to none)', /checks = \{\}/.test(hb));
ok("desktop: 'skills-check' is a 'form' page", /'skills-check': 'form'/.test(read('utils/desktopPage.ts')));
ok('question / choice / why text renders from data, never t(q.key …)', !/t\(\s*(q|question|c|choice)\.(key|whyKey)/.test(code(read('components/learn/QuizQuestionCard.tsx')) + sc));

// ── 8. Planted mutations ───────────────────────────────────────────────────
console.log('\nplanted mutations (each must go red):');

interface Mutation { name: string; from: string; to: string }
const ENGINE_MUTATIONS: Mutation[] = [
  { name: 'grade counts any answer', from: 'answers[q.id] === q.correctId', to: 'answers[q.id] !== undefined' },
  { name: 'shuffle loses a choice', from: '      choices[j] = tmp;\n', to: '\n' },
  { name: 'a revoked certificate still counts', from: 'c.revokedAt === null && ', to: '' },
  { name: 'issued on any ok award', from: 'if (r.ok && r.passed) return', to: 'if (r.ok) return' },
  { name: '409 read as 410', from: 'status === 409', to: 'status === 410' },
  { name: 'email prefix prefilled', from: "if (local && name.toLowerCase() === local.toLowerCase()) return '';", to: '' },
  { name: 'a one-character name passes', from: 'if (len < HOLDER_NAME_MIN) return', to: 'if (len < 1) return' },
  { name: "an '@' name passes", from: "if (name.includes('@')) return 'email';", to: '' },
  { name: '410 read as a server blip', from: "if (status === 410) return refusal('revoked');", to: '' },
  { name: 'a refused name retried forever', from: "result.reason === 'offline' || result.reason === 'server' || result.reason === 'rate_limited' ? 'keep' : 'drop'", to: "result.reason === 'quiz_changed' ? 'drop' : 'keep'" },
  // The critic's honesty minor: every 400 shown as a name problem.
  { name: 'every 400 read as a name refusal', from: "refusal(errorCode !== null && NAME_REFUSAL_CODES.includes(errorCode) ? 'rejected' : 'bad_request')", to: "refusal('rejected')" },
  { name: 'a refused request re-sent unchanged', from: "return reason === 'rate_limited' || reason === 'server' || reason === 'rejected';", to: "return reason === 'rate_limited' || reason === 'server' || reason === 'rejected' || reason === 'bad_request';" },
  { name: 'the bad_request copy blames the name', from: "bad_request: \"MAGE ID couldn't accept this attempt, so no certificate was issued. Take the check again.\",", to: "bad_request: \"MAGE ID couldn't issue a certificate with this name.\"," },
];

const tmp = mkdtempSync(join(tmpdir(), 'lq-mut-'));
try {
  const learn = join(ROOT, 'utils', 'learn');
  // Every copy is written before the first import: bun caches the directory
  // listing on the first import from it.
  const files = ENGINE_MUTATIONS.map((m, i) => {
    if (!engineSrc.includes(m.from)) return null;
    const mutated = engineSrc
      .replace(m.from, m.to)
      .replace("from './topics'", `from '${join(learn, 'topics.ts')}'`)
      .replace(/from '\.\/types'/g, `from '${join(learn, 'types.ts')}'`);
    const file = join(tmp, `engine${i}.ts`);
    writeFileSync(file, mutated);
    return file;
  });
  for (const [i, m] of ENGINE_MUTATIONS.entries()) {
    const file = files[i];
    if (!file) { ok(`mutation "${m.name}" anchor found`, false, m.from); continue; }
    const E = (await import(file)) as Engine;
    let bad: string[];
    try { bad = engineChecks(E); } catch (err) { bad = [`threw: ${String(err)}`]; }
    ok(`engine mutation "${m.name}" is caught`, bad.length > 0);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

const SOURCE_MUTATIONS: { name: string; scan: Scan; src: string; from: RegExp | string; to: string }[] = [
  { name: 'certificate drawn outside the issued branch', scan: scanCardIssued, src: cardSrc, from: "if (phase.kind === 'issued') {", to: "if (phase.kind === 'issued' || phase.kind === 'naming') {" },
  { name: 'haptic before the award', scan: scanHaptic, src: screenSrc, from: 'dispatch({ type: \'ISSUE\', holderName: name });', to: "dispatch({ type: 'ISSUE', holderName: name }); haptic.success();" },
  { name: 'result card fed a local flag', scan: scanScreenPhase, src: screenSrc, from: '<QuizResultCard phase={phase}', to: '<QuizResultCard phase={localPhase}' },
  { name: 'engine issues on a local pass', scan: scanEngineIssued, src: engineSrc, from: "? { kind: 'naming', correct: g.correct, total: g.total }", to: "? { kind: 'issued', certificate: null as never }" },
  { name: "the client drops a 400's error code", scan: scanClient400Code, src: clientSrc, from: 'awardResultFrom(data, error, input.topic, errorCode)', to: 'awardResultFrom(data, error, input.topic)' },
];
for (const m of SOURCE_MUTATIONS) {
  const anchored = typeof m.from === 'string' ? m.src.includes(m.from) : m.from.test(m.src);
  const mutated = m.src.replace(m.from, m.to);
  ok(`source mutation "${m.name}" is caught`, anchored && !m.scan.test(mutated));
}

// Sanity: the bank's topics are all known to the topic list.
ok('every bank topic is a skill topic', BANKS.every(b => skillTopic(b.topic) !== null));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
