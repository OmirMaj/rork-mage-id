// validate-learn-topics.ts — the skill-topic contract (utils/learn/types.ts +
// utils/learn/topics.ts) is complete, honest and pure.
//
//   1. TOPICS — exactly the fifteen tutorials (the shipped three + the LEARN
//      wave's twelve), each once, in hub order (TUTORIAL_ORDER); every id is a
//      TutorialId (SkillTopicId = Extract<TutorialId, …>, so tsc refuses a
//      typo); quizVersion a positive integer. A topic whose tutorial has no
//      def in this build yet is ALLOWED (the content lanes land later) and is
//      printed as a WARNING line — LEARNQUIZ keeps its check hidden until then.
//   2. COPY — label / certificateTitle / scope are the exact COPY of the spec;
//      certificateTitle === `MAGE ID skills: ${label}`; scope ===
//      `Using ${label, first letter lowercased} in the MAGE ID app.`; no label
//      or title uses a word that reads as a trade / safety credential
//      (OSHA, licen…, certif… — 'certificate' alone is allowed in a title,
//      'certified' is not — qualif…, competen…, card, safety, hours). The ONE
//      exempt string is CERT_SCOPE_NOTE, which says what a certificate is NOT.
//      CERT_SCOPE_NOTE and CERT_NAME_NOTE are the exact spec strings and
//      exported.
//   3. PASS RULE — passed() is integer math at PASS_PCT = 80: 5→4 pass, 5→3
//      fail, 4→3 fail, 4→4 pass, 3→3 pass, 3→2 fail; counts outside 3..5,
//      negatives, fractions and correct > total never pass.
//   4. PURITY — utils/learn/{types,topics}.ts import no React / RN / context /
//      storage; types.ts emits nothing but the two constants.
//
// MUTATION PLANTS (each must turn this red; restore byte-identical after):
//   • topics.ts  PASS_PCT = 75            → "4 of 5 … 3 of 4 fails" goes red
//   • topics.ts  'Change orders' → 'Change order certified'
//                                          → exact copy + banned words go red
//   • topics.ts  drop the closeout-binder topic → "fifteen topics" goes red
//   • types.ts   remove `export` from CERT_NAME_NOTE → "exported" goes red
//
// Pure node:fs + direct imports. fileURLToPath + join: the repo path has a space.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PASS_PCT, SKILL_TOPICS, lowerFirst, passed, skillTopic } from '../utils/learn/topics';
import * as LEARN_TYPES from '../utils/learn/types';
import { TUTORIAL_DEFS, TUTORIAL_ORDER } from '../utils/tutorial/defs';
import type { SkillTopicId } from '../utils/learn/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// The spec's COPY table, verbatim. Typed by SkillTopicId so a stale id is a
// tsc error here as well.
const COPY: Record<SkillTopicId, string> = {
  'daily-report-voice': 'Daily reports by voice',
  'punch-walk': 'Punch walks',
  'invoice-to-self': 'Invoicing',
  'estimate-first': 'Estimates',
  'change-order-draft': 'Change orders',
  'field-ticket-log': 'Field tickets',
  'takeoff-to-estimate': 'Takeoff',
  'ask-your-plans': 'Ask your plans',
  'construction-ai-ask': 'Construction AI',
  'schedule-say-it': 'Schedule changes',
  'time-clock-in': 'Time clock',
  'punch-list-close': 'Punch lists',
  'contract-from-estimate': 'Contracts',
  'pay-app-period': 'Pay applications',
  'closeout-binder': 'Closeout binders',
};
const EXPECTED_SCOPE_NOTE = 'This shows the person passed a short check on using the MAGE ID app. It is not a trade, safety or license credential.';
const EXPECTED_NAME_NOTE = 'The name is the one the account holder typed. MAGE ID does not check identity.';

// Words that would make an app-skill certificate read as a trade / safety
// credential. `certif` catches 'certified' / 'certification'; the bare noun
// 'certificate' (and 'certificates') is allowed in a title only.
const BANNED: { name: string; re: RegExp }[] = [
  { name: 'OSHA', re: /osha/i },
  { name: 'licen…', re: /licen/i },
  { name: 'certif… (not "certificate")', re: /certif(?!icates?\b)/i },
  { name: 'qualif…', re: /qualif/i },
  { name: 'competen…', re: /competen/i },
  { name: 'card', re: /\bcards?\b/i },
  { name: 'safety', re: /safety/i },
  { name: 'hours', re: /\bhours?\b/i },
];
const bannedIn = (s: string) => BANNED.filter(b => b.re.test(s)).map(b => b.name);

// ── self-test: the banned-word scanner ──────────────────────────────────────
console.log('learn topics');
console.log('banned-word scanner self-test');
ok('flags certified / OSHA / licence / license / card / safety / hours',
  ['Certified estimator', 'OSHA 10', 'Licence', 'license holder', 'Wallet card', 'Safety lead', '10 hours'].every(s => bannedIn(s).length > 0));
ok("allows the bare 'certificate' and ordinary labels", ['MAGE ID skills: Change orders', 'Your certificate', 'Certificates', 'Time clock', 'Discard'].every(s => bannedIn(s).length === 0),
  JSON.stringify(['Your certificate', 'Certificates', 'Discard'].map(bannedIn)));

// ── 1. topics ───────────────────────────────────────────────────────────────
console.log('topics');
{
  const ids = SKILL_TOPICS.map(t => t.id);
  ok('fifteen topics', SKILL_TOPICS.length === 15, `${SKILL_TOPICS.length}`);
  ok('ids are unique', new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join(', '));
  const expected = Object.keys(COPY).sort();
  ok('exactly the spec\'s fifteen tutorials', JSON.stringify([...ids].sort()) === JSON.stringify(expected),
    `missing: ${expected.filter(x => !ids.includes(x as SkillTopicId)).join(', ')} extra: ${ids.filter(x => !(x in COPY)).join(', ')}`);
  const notInOrder = ids.filter(id => !TUTORIAL_ORDER.includes(id));
  ok('every topic is a tutorial in TUTORIAL_ORDER', notInOrder.length === 0, notInOrder.join(', '));
  const hubOrder = TUTORIAL_ORDER.filter(id => ids.includes(id as SkillTopicId));
  ok('topics run in hub order', JSON.stringify(hubOrder) === JSON.stringify(ids), `${ids.join(' ')}\n      hub: ${hubOrder.join(' ')}`);
  ok('quizVersion is a positive integer', SKILL_TOPICS.every(t => Number.isInteger(t.quizVersion) && t.quizVersion >= 1));
  ok('skillTopic() finds each topic and nothing else', SKILL_TOPICS.every(t => skillTopic(t.id) === t) && skillTopic('client-portal-preview') === null && skillTopic('') === null);
  const noDef = SKILL_TOPICS.filter(t => !TUTORIAL_DEFS[t.id]);
  for (const t of noDef) console.log(`  ! WARNING ${t.id}: no tutorial def in this build yet — its check stays hidden until a content lane lands it`);
  console.log(`  (${SKILL_TOPICS.length - noDef.length} of ${SKILL_TOPICS.length} topics have a def)`);
}

// ── 2. copy ─────────────────────────────────────────────────────────────────
console.log('copy');
{
  const wrongLabel = SKILL_TOPICS.filter(t => t.label !== COPY[t.id]).map(t => `${t.id}: "${t.label}" ≠ "${COPY[t.id]}"`);
  ok('labels are the exact spec copy', wrongLabel.length === 0, wrongLabel.join('\n      '));
  const wrongTitle = SKILL_TOPICS.filter(t => t.certificateTitle !== `MAGE ID skills: ${t.label}`).map(t => `${t.id}: "${t.certificateTitle}"`);
  ok('certificateTitle === `MAGE ID skills: ${label}`', wrongTitle.length === 0, wrongTitle.join('\n      '));
  const wrongScope = SKILL_TOPICS.filter(t => t.scope !== `Using ${lowerFirst(t.label)} in the MAGE ID app.`).map(t => `${t.id}: "${t.scope}"`);
  ok('scope === `Using ${label, first letter lowered} in the MAGE ID app.`', wrongScope.length === 0, wrongScope.join('\n      '));
  ok("lowerFirst keeps an acronym: 'Construction AI' → 'construction AI'", lowerFirst('Construction AI') === 'construction AI' && skillTopic('construction-ai-ask')?.scope === 'Using construction AI in the MAGE ID app.');
  const banned: string[] = [];
  for (const t of SKILL_TOPICS) {
    for (const [slot, s] of [['label', t.label], ['certificateTitle', t.certificateTitle], ['scope', t.scope]] as const) {
      const hits = bannedIn(s);
      if (hits.length) banned.push(`${t.id} ${slot} "${s}": ${hits.join(', ')}`);
    }
  }
  ok('no label, title or scope reads as a trade / safety credential', banned.length === 0, banned.join('\n      '));
  ok('no emoji in topic copy', SKILL_TOPICS.every(t => !/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(t.label + t.certificateTitle + t.scope)));
  ok('label ≤ 30 chars, title ≤ 50 chars (certificate and card fit)', SKILL_TOPICS.every(t => t.label.length <= 30 && t.certificateTitle.length <= 50));

  const exported = LEARN_TYPES as unknown as Record<string, unknown>;
  ok('CERT_SCOPE_NOTE is exported and is the exact spec string', exported.CERT_SCOPE_NOTE === EXPECTED_SCOPE_NOTE, JSON.stringify(exported.CERT_SCOPE_NOTE));
  ok('CERT_NAME_NOTE is exported and is the exact spec string', exported.CERT_NAME_NOTE === EXPECTED_NAME_NOTE, JSON.stringify(exported.CERT_NAME_NOTE));
  // CERT_SCOPE_NOTE is the one exempt string: it names safety and license to
  // say the certificate is NOT one. Nothing else in the two files may.
  const typesSrc = strip(read('utils/learn/types.ts')).replace(/export const CERT_SCOPE_NOTE\s*=\s*\n?\s*'[^']*';/, '');
  const topicsSrc = strip(read('utils/learn/topics.ts'));
  const stringLits = (src: string) => Array.from(src.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g)).map(m => m[1] ?? m[2] ?? '');
  const leaks = [...stringLits(typesSrc), ...stringLits(topicsSrc)].filter(s => /safety|licen|osha/i.test(s));
  ok('only CERT_SCOPE_NOTE names safety / license (the exempt constant)', leaks.length === 0, leaks.join(' | '));
}

// ── 3. pass rule ────────────────────────────────────────────────────────────
console.log('pass rule');
{
  ok('PASS_PCT is 80', PASS_PCT === 80);
  const table: [number, number, boolean][] = [[4, 5, true], [3, 5, false], [3, 4, false], [4, 4, true], [3, 3, true], [2, 3, false], [5, 5, true], [0, 5, false]];
  const wrong = table.filter(([c, t, want]) => passed(c, t) !== want).map(([c, t, want]) => `${c}/${t} → ${!want}`);
  ok('4 of 5 passes, 3 of 5 fails, 3 of 4 fails, 4 of 4 passes, 3 of 3 passes, 2 of 3 fails', wrong.length === 0, wrong.join(', '));
  const never: [number, number][] = [[2, 2], [6, 6], [1, 1], [6, 5], [-1, 5], [4.5, 5], [4, 5.5], [NaN, 5], [4, Infinity]];
  const leaked = never.filter(([c, t]) => passed(c, t)).map(([c, t]) => `${c}/${t}`);
  ok('a count outside 3..5, a negative, a fraction or correct > total never passes', leaked.length === 0, leaked.join(', '));
  const src = strip(read('utils/learn/topics.ts'));
  const fn = /export function passed\([\s\S]*?\n\}/.exec(src)?.[0] ?? '';
  ok('passed() is integer math (no division, no rounding)', fn.length > 0 && !/\/(?![/*])|Math\.(round|floor|ceil)|toFixed/.test(fn.replace(/\/\/.*$/gm, '')), fn);
}

// ── 4. purity ───────────────────────────────────────────────────────────────
console.log('purity');
{
  const probs: string[] = [];
  for (const f of ['utils/learn/types.ts', 'utils/learn/topics.ts']) {
    const src = strip(read(f));
    if (/from\s+['"](react|react-native|expo[-\w/]*|@react-native-async-storage\/[\w-]+|@\/contexts\/[\w/]+|@\/hooks\/[\w/]+|@\/components\/[\w/]+|@\/lib\/[\w/]+)['"]/.test(src)) probs.push(`${f} imports React / RN / a context / a client`);
    if (/AsyncStorage|supabase|fetch\(/.test(src)) probs.push(`${f} reaches storage or the network`);
  }
  ok('utils/learn types + topics are pure', probs.length === 0, probs.join(', '));
  const typesSrc = strip(read('utils/learn/types.ts'));
  ok('types.ts has only type imports', !/^\s*import\s+(?!type\b)/m.test(typesSrc));
  const runtime = Object.keys(LEARN_TYPES).sort();
  ok('types.ts exports at run time only CERT_NAME_NOTE and CERT_SCOPE_NOTE', JSON.stringify(runtime) === JSON.stringify(['CERT_NAME_NOTE', 'CERT_SCOPE_NOTE']), runtime.join(', '));
  ok('no skill-certificate name collides with the safety certifications screen / table',
    !/safety-certifications|public\.certifications|from\(['"]certifications['"]\)/.test(strip(read('utils/learn/topics.ts')) + typesSrc));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
