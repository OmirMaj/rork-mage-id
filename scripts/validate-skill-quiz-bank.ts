// validate-skill-quiz-bank.ts — the skills-check bank (utils/learn/quizBank.ts)
// is complete, about the app only, pinned to the code that makes each answer
// true, and identical to the server's answer key.
// OWNER: LEARNBANK.
//
//   (a) SHAPE — every SkillTopicId (utils/learn/topics.ts SKILL_TOPICS) has a
//       bank and nothing else does; bank.topic is its own id; bank.version ===
//       the topic's quizVersion (a question change bumps both); 5 questions
//       with ids q1..q5 in order; 3 or 4 choices with ids a, b, c(, d) in order
//       and no repeated text; exactly one correct (correctId is one of them);
//       across a bank the right answers are not all the same letter (S2).
//   (b) ABOUT THE APP — no question, choice or why names a trade / safety /
//       credential subject (osha, safety, licen…, certif…, code compliance,
//       inspection pass, competent, hazard), and none calls the check an exam,
//       a test of knowledge or "verified" (the check is "a short check on using
//       the app", CERT_SCOPE_NOTE).
//   (c) PINS — every question's source.file exists in the repo and contains
//       source.mustContain OUTSIDE comments. A renamed control or reworded
//       string fails here instead of shipping a wrong answer.
//   (d) VOICE (docs/VOICE.md) — no emoji (the regex of
//       validate-tutorial-defs.ts), first character a capital or a digit,
//       question ≤ 120 chars ending in "?", choice ≤ 70 chars with no closing
//       period, why ≤ 120 chars ending in "."; no "!", no "...", at most one em
//       dash; no he / his / him / she / her; no developer words (sync,
//       payload, queue, seat, RLS, API, null, undefined); none of the
//       copy-voice ratchet's tells (R14 "the job's" / "this job" / "your jobs",
//       R19 homeowner).
//   (e) KEY DRIFT — scripts/gen-skill-quiz-key.ts renders the server key in
//       memory and it must equal supabase/functions/_shared/
//       skillQuizKey.generated.ts byte for byte; the file carries the
//       GENERATED header and exports SKILL_QUIZ_KEY and SKILL_PASS_PCT.
//   (f) CATALOG IDS — question key 'settings.learn.quiz.<topic>.<qid>', choice
//       key '<question key>.<choiceId>', whyKey '<question key>.why'; every key
//       unique across the whole bank.
//   (g) PURITY — quizBank.ts has no runtime import (type-only), so bun, the
//       generator and any screen can load it without React Native.
//
// MUTATION PLANTS (each turned this red; restored byte-identical, then cmp):
//   • quizBank.ts  punch-walk q3 correctId 'a' → 'b'          → (e) drift goes red
//   • quizBank.ts  a why gains "safety"                        → (b) goes red
//   • quizBank.ts  a mustContain → 'This number is your costt' → (c) goes red
//   • quizBank.ts  drop q5 from closeout-binder                → (a) goes red
//   • quizBank.ts  pay-app-period bank version 1 → 2           → (a) version goes red
//   • quizBank.ts  a choice gains an emoji (alone, and with a lowercase start)
//                                                              → (d) goes red
//   • quizBank.ts  key base 'settings.learn.quiz' → 'settings.learn.quizz'
//                                                              → (f) goes red
//   • quizBank.ts  every daily-report-voice answer → 'a'       → (a) S2 goes red
//   • quizBank.ts  `import type` → `import`                    → (g) goes red
//   • key file     ask-your-plans q1 "b" → "a" (hand edit)     → (e) drift goes red
//   • key file     GENERATED header line removed               → (e) header goes red
//
// Pure node:fs + direct imports. fileURLToPath + join: the repo path has a space.
// Run: bun run scripts/validate-skill-quiz-bank.ts

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIZ_BANKS } from '../utils/learn/quizBank';
import { SKILL_TOPICS } from '../utils/learn/topics';
import { SKILL_QUIZ_KEY_PATH, renderSkillQuizKey } from './gen-skill-quiz-key';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Block comments and whole-line // comments out; code and strings stay. */
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function rule(name: string, problems: string[]) {
  if (problems.length === 0) { pass++; console.log(`  ✓ ${name}`); return; }
  fail++;
  console.log(`  ✗ ${name}`);
  for (const p of problems.slice(0, 25)) console.log(`      ${p}`);
  if (problems.length > 25) console.log(`      … and ${problems.length - 25} more`);
}

const QUESTION_IDS = ['q1', 'q2', 'q3', 'q4', 'q5'];
const CHOICE_IDS = ['a', 'b', 'c', 'd'];
const KEY_BASE = 'settings.learn.quiz';

// Same emoji class as scripts/validate-tutorial-defs.ts.
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
const BANNED_SUBJECT = /osha|safety|licen|certif|code compliance|inspection pass|competent|hazard/i;
const BANNED_FRAMING = /\bexams?\b|test of knowledge|\bverified\b/i;
const GENDERED = /\b(he|his|him|she|her|hers)\b/i;
const DEV_WORDS = /\b(sync\w*|payloads?|queues?|queued|seats?|RLS|API|null|undefined|NaN)\b/i;
const JOB_TELL = /\b(?:this job(?!s)(?:'s|’s)?|on this job|your jobs|the job's|the job’s)\b/i;
const HOMEOWNER = /homeowner/i;

/** Every user-facing string of the bank, labelled for messages. */
type Line = { where: string; text: string; kind: 'question' | 'choice' | 'why' };
const lines: Line[] = [];
for (const [topic, bank] of Object.entries(QUIZ_BANKS)) {
  for (const q of bank?.questions ?? []) {
    lines.push({ where: `${topic}.${q.id}`, text: q.en, kind: 'question' });
    for (const c of q.choices) lines.push({ where: `${topic}.${q.id}.${c.id}`, text: c.en, kind: 'choice' });
    lines.push({ where: `${topic}.${q.id}.why`, text: q.why, kind: 'why' });
  }
}

// ── (a) shape ───────────────────────────────────────────────────────────────
console.log('(a) shape');
{
  const ids = SKILL_TOPICS.map(t => t.id);
  const missing = ids.filter(id => !QUIZ_BANKS[id]);
  const extra = Object.keys(QUIZ_BANKS).filter(k => !ids.includes(k as never));
  rule(`every one of the ${ids.length} skill topics has a bank, and no bank is extra`, [
    ...missing.map(m => `no bank for ${m}`),
    ...extra.map(x => `bank for unknown topic ${x}`),
  ]);

  const shape: string[] = [];
  const version: string[] = [];
  const spread: string[] = [];
  for (const t of SKILL_TOPICS) {
    const bank = QUIZ_BANKS[t.id];
    if (!bank) continue;
    if (bank.topic !== t.id) shape.push(`${t.id}: bank.topic is ${bank.topic}`);
    if (bank.version !== t.quizVersion) version.push(`${t.id}: bank.version ${bank.version} ≠ quizVersion ${t.quizVersion}`);
    const qids = bank.questions.map(q => q.id);
    if (qids.join(',') !== QUESTION_IDS.join(',')) shape.push(`${t.id}: question ids ${JSON.stringify(qids)} — need q1..q5 in order`);
    for (const q of bank.questions) {
      const P = `${t.id}.${q.id}`;
      const cids = q.choices.map(c => c.id);
      if (q.choices.length < 3 || q.choices.length > 4) shape.push(`${P}: ${q.choices.length} choices — need 3 or 4`);
      if (cids.join(',') !== CHOICE_IDS.slice(0, cids.length).join(',')) shape.push(`${P}: choice ids ${JSON.stringify(cids)} — need a, b, c(, d) in order`);
      const right = q.choices.filter(c => c.id === q.correctId);
      if (right.length !== 1) shape.push(`${P}: correctId '${q.correctId}' matches ${right.length} choices — need exactly one`);
      const texts = q.choices.map(c => c.en.trim().toLowerCase());
      if (new Set(texts).size !== texts.length) shape.push(`${P}: two choices read the same`);
    }
    const letters = new Set(bank.questions.map(q => q.correctId));
    if (bank.questions.length > 1 && letters.size < 2) spread.push(`${t.id}: every right answer is '${[...letters][0]}'`);
  }
  rule('each bank: its own topic id, q1..q5, 3-4 choices a..d, exactly one correct', shape);
  rule('bank.version === SKILL_TOPICS quizVersion (a question change bumps both)', version);
  rule('the right answers are not all the same letter in any bank (S2)', spread);
}

// ── (b) about the app only ──────────────────────────────────────────────────
console.log('(b) about the app only');
rule('no trade / safety / credential subject in any question, choice or why', lines
  .filter(l => BANNED_SUBJECT.test(l.text))
  .map(l => `${l.where}: "${l.text}"`));
rule('never framed as an exam, a test of knowledge or "verified"', lines
  .filter(l => BANNED_FRAMING.test(l.text))
  .map(l => `${l.where}: "${l.text}"`));

// ── (c) source pins ─────────────────────────────────────────────────────────
console.log('(c) source pins');
{
  const problems: string[] = [];
  const cache = new Map<string, string | null>();
  for (const [topic, bank] of Object.entries(QUIZ_BANKS)) {
    for (const q of bank?.questions ?? []) {
      const P = `${topic}.${q.id}`;
      const { file, mustContain } = q.source ?? ({} as { file: string; mustContain: string });
      if (!file || !mustContain || mustContain.trim().length < 6) { problems.push(`${P}: source needs a file and a literal of 6+ chars`); continue; }
      if (normalize(file) !== file || file.startsWith('/') || file.includes('..')) { problems.push(`${P}: source.file must be a plain repo-relative path (${file})`); continue; }
      if (!cache.has(file)) cache.set(file, existsSync(join(ROOT, file)) ? strip(read(file)) : null);
      const src = cache.get(file);
      if (src == null) problems.push(`${P}: ${file} does not exist`);
      else if (!src.includes(mustContain)) problems.push(`${P}: ${file} no longer contains ${JSON.stringify(mustContain)} (outside comments) — fix the question and bump quizVersion`);
    }
  }
  rule('every right answer is pinned to a literal that is still in its file', problems);
}

// ── (d) voice ───────────────────────────────────────────────────────────────
console.log('(d) voice');
{
  const p: string[] = [];
  for (const l of lines) {
    const S = `${l.where}: "${l.text}"`;
    const t = l.text;
    if (t !== t.trim() || t.length === 0) p.push(`${S} — empty or padded`);
    if (EMOJI.test(t)) p.push(`${S} — emoji`);
    if (!/^[A-Z0-9]/.test(t)) p.push(`${S} — must start with a capital (sentence case)`);
    if (/!/.test(t)) p.push(`${S} — exclamation mark`);
    if (/\.\.\./.test(t)) p.push(`${S} — "..."`);
    if ((t.match(/—/g) ?? []).length > 1) p.push(`${S} — more than one em dash`);
    if (GENDERED.test(t)) p.push(`${S} — he / his / she / her (use "you" or "they")`);
    if (DEV_WORDS.test(t)) p.push(`${S} — developer word`);
    if (JOB_TELL.test(t)) p.push(`${S} — copy-voice R14 ("the job's" / "this job" / "your jobs")`);
    if (HOMEOWNER.test(t)) p.push(`${S} — copy-voice R19 (say "client")`);
    if (l.kind === 'question') {
      if (t.length > 120) p.push(`${S} — question is ${t.length} chars (max 120)`);
      if (!t.endsWith('?')) p.push(`${S} — a question ends with "?"`);
    } else if (l.kind === 'choice') {
      if (t.length > 70) p.push(`${S} — choice is ${t.length} chars (max 70)`);
      if (/[.?]$/.test(t)) p.push(`${S} — a choice has no closing period`);
    } else {
      if (t.length > 120) p.push(`${S} — why is ${t.length} chars (max 120)`);
      if (!t.endsWith('.')) p.push(`${S} — a why is a sentence ending in "."`);
    }
  }
  rule('copy follows docs/VOICE.md (case, length, emoji, pronouns, dev words)', p);
}

// ── (e) the server key does not drift ───────────────────────────────────────
console.log('(e) server key');
{
  let rendered = '';
  let renderError = '';
  try { rendered = renderSkillQuizKey(); } catch (e) { renderError = e instanceof Error ? e.message : String(e); }
  const committed = existsSync(join(ROOT, SKILL_QUIZ_KEY_PATH)) ? read(SKILL_QUIZ_KEY_PATH) : null;
  const drift: string[] = [];
  if (renderError) drift.push(`the generator threw: ${renderError}`);
  else if (committed == null) drift.push(`${SKILL_QUIZ_KEY_PATH} is missing — run bun run scripts/gen-skill-quiz-key.ts`);
  else if (committed !== rendered) {
    const a = committed.split('\n');
    const b = rendered.split('\n');
    const i = a.findIndex((line, n) => line !== b[n]);
    const at = i < 0 ? Math.min(a.length, b.length) : i;
    drift.push(`${SKILL_QUIZ_KEY_PATH} differs from the bank at line ${at + 1}: committed ${JSON.stringify(a[at])} vs bank ${JSON.stringify(b[at])} — run bun run scripts/gen-skill-quiz-key.ts`);
  }
  rule('the committed key is byte-identical to a fresh render of the bank', drift);

  const shape: string[] = [];
  if (committed != null) {
    if (!committed.startsWith('// GENERATED — do not edit; run bun run scripts/gen-skill-quiz-key.ts')) shape.push('missing the GENERATED header on line 1');
    if (!/^export const SKILL_QUIZ_KEY\b/m.test(committed)) shape.push('does not export SKILL_QUIZ_KEY');
    if (!/^export const SKILL_PASS_PCT = \d+;$/m.test(committed)) shape.push('does not export SKILL_PASS_PCT as an integer');
    if (/^import\b/m.test(committed)) shape.push('imports something (it must stand alone in _shared)');
  }
  rule('the key carries the GENERATED header and exports SKILL_QUIZ_KEY + SKILL_PASS_PCT, with no imports', shape);
}

// ── (f) catalog ids ─────────────────────────────────────────────────────────
console.log('(f) catalog ids');
{
  const p: string[] = [];
  const seen = new Set<string>();
  const once = (k: string, where: string) => { if (seen.has(k)) p.push(`${where}: key ${k} used twice`); seen.add(k); };
  for (const [topic, bank] of Object.entries(QUIZ_BANKS)) {
    for (const q of bank?.questions ?? []) {
      const qk = `${KEY_BASE}.${topic}.${q.id}`;
      if (q.key !== qk) p.push(`${topic}.${q.id}: key ${q.key} — need ${qk}`);
      if (q.whyKey !== `${qk}.why`) p.push(`${topic}.${q.id}: whyKey ${q.whyKey} — need ${qk}.why`);
      once(q.key, `${topic}.${q.id}`);
      once(q.whyKey, `${topic}.${q.id}.why`);
      for (const c of q.choices) {
        if (c.key !== `${qk}.${c.id}`) p.push(`${topic}.${q.id}.${c.id}: key ${c.key} — need ${qk}.${c.id}`);
        once(c.key, `${topic}.${q.id}.${c.id}`);
      }
    }
  }
  rule(`every key is '${KEY_BASE}.<topic>.<qid>[.<choice>|.why]' and unique`, p);
}

// ── (g) purity ──────────────────────────────────────────────────────────────
console.log('(g) purity');
{
  const src = strip(read('utils/learn/quizBank.ts'));
  const imports = src.match(/^\s*import\b[^;]*;/gm) ?? [];
  rule('quizBank.ts has only type imports', imports
    .filter(i => !/^\s*import\s+type\b/.test(i))
    .map(i => `runtime import: ${i.trim()}`));
}

const questionCount = Object.values(QUIZ_BANKS).reduce((n, b) => n + (b?.questions.length ?? 0), 0);
console.log(`\n${Object.keys(QUIZ_BANKS).length} banks, ${questionCount} questions`);
if (fail > 0) {
  console.log(`✗ validate-skill-quiz-bank: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`✓ validate-skill-quiz-bank: ${pass} passed`);
