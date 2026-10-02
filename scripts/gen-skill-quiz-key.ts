// scripts/gen-skill-quiz-key.ts — writes the server's answer key for the skills
// checks: supabase/functions/_shared/skillQuizKey.generated.ts.
// OWNER: LEARNBANK.
//
// WHY A GENERATED FILE. The award edge function (skill-certificate-award,
// LEARNCERT) grades the answers itself, and edge functions are Deno: they can
// import only from supabase/functions/_shared, never from utils/. So the key is
// rendered from the one source, utils/learn/quizBank.ts (QUIZ_BANKS) plus
// utils/learn/topics.ts (SKILL_TOPICS, PASS_PCT), and
// scripts/validate-skill-quiz-bank.ts re-renders it in memory and fails on any
// byte of drift. Change a question → bump the topic's quizVersion → run this.
//
// DETERMINISTIC: topics and question ids are sorted, numbers are plain
// integers, strings go through JSON.stringify. No timestamps, no hashes of the
// clock, so the same bank always renders the same bytes.
//
// Run: bun run scripts/gen-skill-quiz-key.ts            (writes the file)
//      bun run scripts/gen-skill-quiz-key.ts --check    (exit 1 on drift, writes nothing)
//
// fileURLToPath + join: the repo path has a space.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QUIZ_BANKS } from '../utils/learn/quizBank';
import { PASS_PCT, SKILL_TOPICS } from '../utils/learn/topics';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Repo-relative path of the generated key. */
export const SKILL_QUIZ_KEY_PATH = 'supabase/functions/_shared/skillQuizKey.generated.ts';

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The key file's full text, rendered from QUIZ_BANKS + SKILL_TOPICS. Throws
 *  when a topic has no bank (the validator reports that first, by name). */
export function renderSkillQuizKey(): string {
  const topics = [...SKILL_TOPICS].sort((a, b) => cmp(a.id, b.id));
  const out: string[] = [];
  out.push('// GENERATED — do not edit; run bun run scripts/gen-skill-quiz-key.ts');
  out.push('//');
  out.push('// The answer key the skill-certificate-award function grades with. Rendered');
  out.push('// from utils/learn/quizBank.ts (QUIZ_BANKS) and utils/learn/topics.ts');
  out.push('// (SKILL_TOPICS, PASS_PCT); scripts/validate-skill-quiz-bank.ts fails the build');
  out.push('// when this file and the bank disagree. A pass is integer math:');
  out.push('// correct * 100 >= SKILL_PASS_PCT * total.');
  out.push('');
  out.push('export interface SkillQuizKeyTopic {');
  out.push('  readonly version: number;');
  out.push('  readonly label: string;');
  out.push('  readonly certificateTitle: string;');
  out.push('  /** question id → the correct choice id */');
  out.push('  readonly answers: Readonly<Record<string, string>>;');
  out.push('  readonly total: number;');
  out.push('}');
  out.push('');
  out.push('export interface SkillQuizKey {');
  out.push('  readonly PASS_PCT: number;');
  out.push('  readonly TOPICS: Readonly<Record<string, SkillQuizKeyTopic>>;');
  out.push('}');
  out.push('');
  out.push(`export const SKILL_PASS_PCT = ${PASS_PCT};`);
  out.push('');
  out.push('export const SKILL_QUIZ_KEY: SkillQuizKey = {');
  out.push('  PASS_PCT: SKILL_PASS_PCT,');
  out.push('  TOPICS: {');
  for (const topic of topics) {
    const bank = QUIZ_BANKS[topic.id];
    if (!bank) throw new Error(`no quiz bank for topic ${topic.id}`);
    const questions = [...bank.questions].sort((a, b) => cmp(a.id, b.id));
    out.push(`    ${JSON.stringify(topic.id)}: {`);
    out.push(`      version: ${topic.quizVersion},`);
    out.push(`      label: ${JSON.stringify(topic.label)},`);
    out.push(`      certificateTitle: ${JSON.stringify(topic.certificateTitle)},`);
    out.push('      answers: {');
    for (const q of questions) out.push(`        ${JSON.stringify(q.id)}: ${JSON.stringify(q.correctId)},`);
    out.push('      },');
    out.push(`      total: ${questions.length},`);
    out.push('    },');
  }
  out.push('  },');
  out.push('};');
  out.push('');
  return out.join('\n');
}

if (import.meta.main) {
  const path = join(ROOT, SKILL_QUIZ_KEY_PATH);
  const next = renderSkillQuizKey();
  if (process.argv.includes('--check')) {
    let current = '';
    try { current = readFileSync(path, 'utf8'); } catch { /* missing = drift */ }
    if (current !== next) {
      console.error(`✗ ${SKILL_QUIZ_KEY_PATH} is out of date — run bun run scripts/gen-skill-quiz-key.ts`);
      process.exit(1);
    }
    console.log(`✓ ${SKILL_QUIZ_KEY_PATH} matches the bank`);
  } else {
    writeFileSync(path, next);
    console.log(`wrote ${SKILL_QUIZ_KEY_PATH} (${next.length} bytes)`);
  }
}
