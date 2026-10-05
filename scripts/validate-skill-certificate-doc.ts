// scripts/validate-skill-certificate-doc.ts — the certificate a person can
// save, share and remove (lane LEARNPROFILE) says only what it is, and cannot
// pass for a trade credential.
//
// WHAT IT PINS
//   (a) buildCertificateHtml escapes every value it prints: a typed name with
//       <script>, quotes or an apostrophe comes out as text, and so does a
//       hostile verify URL. One US-letter landscape page, no script tag.
//   (b) the HTML carries CERT_SCOPE_NOTE and CERT_NAME_NOTE verbatim, the
//       "Awarded to" line, "Check it at {url}" and the check code grouped
//       XXXX-XXXX-XXXX.
//   (c) the pure helpers: check-code grouping, "{n} of 15" (newest per topic,
//       a revoked newest does not count), the share text (it carries
//       CERT_NAME_NOTE after the name), the screen-reader line.
//   (d) banned words and cues are absent from certificateDoc.ts,
//       CertificateCard.tsx and the generated HTML outside CERT_SCOPE_NOTE
//       (osha, licen, certified, qualif, competent, wallet, the pocket-card
//       inch sizes, expires, seal, badge, shield, hard hat, hours of training),
//       and none of the three learn files imports a medal / star / shield /
//       ribbon / hard-hat icon.
//   (e) the card renders both notes and the "Awarded to" line; removal is a
//       confirmed, direct, server-confirmed delete (the documented exception
//       to the offline queue), offline sends nothing, and the success toast
//       hangs only off the 'removed' answer.
//   (f) SkillsProfileRow renders nothing when signed out, before any data
//       hook runs; Settings mounts it exactly once, between the profile hero
//       and the "Account Type" header.
//   (g) the certificates screen never shows the empty state for a failed read,
//       and its two-up grid uses a fixed flexBasis, not a percentage.
//   Every source rule is then fed planted mutations, each of which must fail.
//
// Run: bun run scripts/validate-skill-certificate-doc.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SKILL_TOPIC_COUNT,
  buildCertificateHtml,
  certificateA11yLabel,
  certificateShareText,
  earnedCount,
  formatCheckCode,
  topicsNotEarned,
} from '../utils/learn/certificateDoc';
import { skillTopic } from '../utils/learn/topics';
import { CERT_NAME_NOTE, CERT_SCOPE_NOTE, type SkillCertificate } from '../utils/learn/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const P = {
  doc: 'utils/learn/certificateDoc.ts',
  card: 'components/learn/CertificateCard.tsx',
  row: 'components/learn/SkillsProfileRow.tsx',
  screen: 'app/skills-certificates.tsx',
  settings: 'app/(tabs)/settings/index.tsx',
};

let pass = 0;
let fail = 0;
function rule(name: string, problems: string[]) {
  if (problems.length === 0) { pass++; console.log(`  ✓ ${name}`); return; }
  fail++;
  console.log(`  ✗ ${name}`);
  for (const p of problems.slice(0, 20)) console.log(`      ${p}`);
}

/** TS without block comments and line comments (a URL's // follows ':' and stays). */
const tsCode = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');

function cert(over: Partial<SkillCertificate> = {}): SkillCertificate {
  return {
    id: 'c1',
    topic: 'change-order-draft',
    quizVersion: 1,
    correct: 4,
    total: 5,
    holderName: 'Dana Ruiz',
    verifyCode: 'ABCDEFGHJKLM',
    issuedAt: '2026-10-01T15:00:00.000Z',
    revokedAt: null,
    ...over,
  };
}
const CO = skillTopic('change-order-draft')!;
const URL_OK = 'https://mageid.app/skills/ABCDEFGHJKLM';

// ── (a) escaping ────────────────────────────────────────────────────────────
export function checkEscaping(build: typeof buildCertificateHtml): string[] {
  const p: string[] = [];
  const hostile = cert({ holderName: `Dana <script>alert("x")</script> O'Neil & Co` });
  const html = build(hostile, CO, { verifyUrl: `https://mageid.app/skills/"><script>bad()</script>`, issuedLabel: '<b>Oct 1</b>' });
  if (/<script/i.test(html)) p.push('a <script> tag reached the HTML');
  if (!html.includes('Dana &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; O&#39;Neil &amp; Co')) p.push('the typed name is not HTML-escaped (<, >, ", \', &)');
  if (!html.includes('&quot;&gt;&lt;script&gt;bad()')) p.push('the verify URL is not HTML-escaped');
  if (html.includes('<b>Oct 1</b>')) p.push('the issued label is not HTML-escaped');
  if (!/@page\s*\{\s*size:\s*letter landscape;/.test(html)) p.push('not a US-letter landscape page (@page size: letter landscape)');
  return p;
}

// ── (b) the words on the page ───────────────────────────────────────────────
export function checkWords(build: typeof buildCertificateHtml): string[] {
  const p: string[] = [];
  const html = build(cert(), CO, { verifyUrl: URL_OK, issuedLabel: 'Oct 1, 2026' });
  const want: [string, string][] = [
    [CERT_SCOPE_NOTE, 'CERT_SCOPE_NOTE verbatim'],
    [CERT_NAME_NOTE, 'CERT_NAME_NOTE verbatim'],
    ['MAGE ID skills: Change orders', 'the certificate title'],
    ['Awarded to Dana Ruiz', 'Awarded to {name}'],
    ['Passed the in-app check, 4 of 5 · Oct 1, 2026', 'the score line'],
    [CO.scope, 'the topic scope line'],
    [`Check it at ${URL_OK}`, 'Check it at {verifyUrl}'],
    ['Check code ABCD-EFGH-JKLM', 'the grouped check code'],
  ];
  for (const [s, what] of want) if (!html.includes(s)) p.push(`missing ${what}: "${s}"`);
  const nameAt = html.indexOf('Awarded to Dana Ruiz');
  const noteAt = html.indexOf(CERT_NAME_NOTE);
  if (nameAt >= 0 && noteAt >= 0 && !(noteAt > nameAt && noteAt - nameAt < 200)) p.push('CERT_NAME_NOTE is not right under "Awarded to {name}"');
  return p;
}

// ── (c) pure helpers ────────────────────────────────────────────────────────
export function checkHelpers(): string[] {
  const p: string[] = [];
  if (formatCheckCode('ABCDEFGHJKLM') !== 'ABCD-EFGH-JKLM') p.push(`formatCheckCode → ${formatCheckCode('ABCDEFGHJKLM')}`);
  if (formatCheckCode('abcd-efgh-jklm') !== 'ABCD-EFGH-JKLM') p.push('formatCheckCode does not normalise an already-grouped code');
  if (SKILL_TOPIC_COUNT !== 15) p.push(`SKILL_TOPIC_COUNT is ${SKILL_TOPIC_COUNT}, not 15`);
  const certs: SkillCertificate[] = [
    cert({ id: 'a', topic: 'punch-walk', issuedAt: '2026-09-01T00:00:00Z' }),
    cert({ id: 'b', topic: 'punch-walk', issuedAt: '2026-09-05T00:00:00Z' }),
    cert({ id: 'c', topic: 'invoice-to-self', issuedAt: '2026-09-02T00:00:00Z' }),
    cert({ id: 'd', topic: 'invoice-to-self', issuedAt: '2026-09-09T00:00:00Z', revokedAt: '2026-09-10T00:00:00Z' }),
    cert({ id: 'e', topic: 'change-order-draft', issuedAt: '2026-09-03T00:00:00Z' }),
  ];
  // punch-walk (newest b) counts; invoice-to-self's newest is revoked → not; change-order counts.
  if (earnedCount(certs) !== 2) p.push(`earnedCount = ${earnedCount(certs)}, want 2 (one per topic, a revoked newest does not count)`);
  if (earnedCount([]) !== 0) p.push('earnedCount([]) is not 0');
  const missing = topicsNotEarned(certs).map(t => t.id);
  if (missing.length !== 13 || missing.includes('punch-walk') || !missing.includes('invoice-to-self')) p.push(`topicsNotEarned wrong: ${missing.join(', ')}`);
  const share = certificateShareText(cert(), CO, URL_OK);
  if (share !== `MAGE ID skills: Change orders — Dana Ruiz. ${CERT_NAME_NOTE} Check it at ${URL_OK}`) p.push(`share text (must carry CERT_NAME_NOTE after the name): ${share}`);
  const a11y = certificateA11yLabel(cert(), CO, 'October 1, 2026');
  if (a11y !== 'MAGE ID skills: Change orders. Awarded to Dana Ruiz, October 1, 2026. Covers using the MAGE ID app only.') p.push(`a11y label: ${a11y}`);
  return p;
}

// ── (d) banned words and cues ───────────────────────────────────────────────
export const BANNED = ['osha', 'licen', 'certified', 'qualif', 'competent', 'wallet', '3.375in', '2.125in', 'expires', 'seal', 'badge', 'shield', 'hard hat', 'hours of training'];
const BANNED_ICONS = /\b(Award|Medal|Star|Stars|Shield\w*|Badge\w*|Ribbon|HardHat|Trophy|Crown|Stamp|IdCard|CreditCard)\b/;

export function checkBanned(files: Record<string, string>, html: string): string[] {
  const p: string[] = [];
  const scan = (label: string, text: string) => {
    const lower = text.split(CERT_SCOPE_NOTE).join(' ').toLowerCase();
    for (const w of BANNED) if (lower.includes(w)) p.push(`${label} contains "${w}"`);
  };
  scan(P.doc, files.doc);
  scan(P.card, files.card);
  scan('the generated HTML (outside CERT_SCOPE_NOTE)', html);
  for (const k of ['card', 'row', 'screen'] as const) {
    const lucide = /import\s*\{([^}]*)\}\s*from\s*'lucide-react-native'/.exec(files[k]);
    if (lucide && BANNED_ICONS.test(lucide[1])) p.push(`${P[k]} imports a credential-looking icon: ${lucide[1].trim()}`);
  }
  if (/aspectRatio/.test(tsCode(files.card))) p.push('the card sets an aspectRatio (a pocket-card shape)');
  if (/\bBadge\b/.test(tsCode(files.card))) p.push('the card uses the Badge primitive');
  return p;
}

// ── (e) the card ────────────────────────────────────────────────────────────
export function checkCard(card: string): string[] {
  const p: string[] = [];
  const code = tsCode(card);
  if (!/\{CERT_NAME_NOTE\}/.test(code)) p.push('the card does not render CERT_NAME_NOTE');
  if (!/\{CERT_SCOPE_NOTE\}/.test(code)) p.push('the card does not render CERT_SCOPE_NOTE');
  const awardedAt = code.indexOf("'Awarded to {name}'");
  const noteAt = code.indexOf('{CERT_NAME_NOTE}');
  if (awardedAt < 0) p.push('no "Awarded to {name}" line');
  else if (noteAt < awardedAt) p.push('CERT_NAME_NOTE is not under the "Awarded to" line');
  if (!/accessibilityLabel=\{certificateA11yLabel\(/.test(code)) p.push('the card does not read its certificateA11yLabel');
  if (!/REMOVE IS NOT QUEUED/.test(card)) p.push('the file-header note on the unqueued removal is gone');
  const rm = /export async function removeCertificate[\s\S]*?\n\}/.exec(code)?.[0] ?? '';
  if (!rm) p.push('no removeCertificate');
  else {
    const off = rm.indexOf('isOfflineNow()');
    const del = rm.indexOf(".from('app_skill_certificates').delete()");
    if (off < 0 || del < 0 || off > del) p.push('removeCertificate does not check offline before the delete');
    if (!/\.delete\(\)\.eq\('id', id\)\.select\('id'\)/.test(rm)) p.push('the delete does not ask the server for the deleted row (.select)');
    if (!/data\.length > 0 \? 'removed'/.test(rm)) p.push("'removed' is not tied to a returned row");
  }
  if (/supabaseWrite|offlineQueue/.test(code)) p.push('the removal goes through the offline queue');
  const nailCalls = code.match(/nailIt\(/g) ?? [];
  if (nailCalls.length !== 1 || !/if \(outcome === 'removed'\) \{\s*nailIt\(/.test(code)) p.push("the success toast is not only on outcome === 'removed'");
  if (!/'Connect to remove it\.'/.test(code)) p.push('no "Connect to remove it." offline line');
  if (!/showAlert\(t\('settings\.learn\.removeConfirm'[\s\S]{0,300}style: 'destructive', onPress: \(\) => \{ void doRemove\(\); \}/.test(code)) p.push('Remove does not confirm first');
  if (!/printHtmlDocument\(html\)/.test(code)) p.push('Save PDF does not use printHtmlDocument');
  if (!/Platform\.OS === 'web'\) \{\s*const ok = await copyToClipboard\(message\)/.test(code)) p.push('Share link on web does not copy to the clipboard');
  return p;
}

// ── (f) the profile row + Settings ──────────────────────────────────────────
export function checkRow(row: string, settings: string): string[] {
  const p: string[] = [];
  const code = tsCode(row);
  const fn = /export function SkillsProfileRow\(\)\s*\{([\s\S]*?)\n\}/.exec(code)?.[1] ?? '';
  if (!fn) p.push('no export function SkillsProfileRow()');
  else {
    const guard = fn.indexOf('if (!isAuthenticated || !user) return null;');
    if (guard < 0) p.push('SkillsProfileRow does not return null when signed out');
    if (/useMyCertificates|useQuery|useRouter/.test(fn)) p.push('SkillsProfileRow runs a data hook before the signed-out guard');
    const body = fn.indexOf('<SkillsProfileRowBody');
    if (guard >= 0 && body >= 0 && body < guard) p.push('the body renders before the guard');
  }
  if (!/testID="settings-skills-row"/.test(code)) p.push('no testID settings-skills-row');
  if (!/router\.push\('\/skills-certificates'\)/.test(code)) p.push('the row does not open /skills-certificates');
  if (!/"Couldn't load"/.test(code)) p.push('no "Couldn\'t load" error value');
  if (!/if \(certsQ\.data\)/.test(code)) p.push('the number does not wait for loaded data');
  const s = tsCode(settings);
  const uses = s.match(/<SkillsProfileRow\s*\/>/g) ?? [];
  if (uses.length !== 1) p.push(`Settings mounts <SkillsProfileRow /> ${uses.length} times`);
  const hero = s.indexOf('testID="profile-hero-tap"');
  const at = s.indexOf('<SkillsProfileRow');
  const acct = s.indexOf('<Text style={styles.sectionHeader}>Account Type</Text>');
  if (!(hero >= 0 && at > hero && acct > at)) p.push('the row is not between the profile hero and the "Account Type" header');
  if (!/import \{ SkillsProfileRow \} from '@\/components\/learn\/SkillsProfileRow';/.test(s)) p.push('Settings does not import SkillsProfileRow');
  return p;
}

// ── (g) the certificates screen ─────────────────────────────────────────────
export function checkScreen(screen: string): string[] {
  const p: string[] = [];
  const code = tsCode(screen);
  if (!/const failed = !certs && certsQ\.isError;/.test(code)) p.push('no failed-read state');
  if (!/\{certs && earned\.length === 0 \?/.test(code)) p.push('the empty state does not wait for a real list');
  if (!/"Couldn't load your certificates\."/.test(code) || !/testID="skills-certificates-retry"/.test(code)) p.push('the load error has no reason + Try again');
  if (!/cardTwoUp: \{ flexBasis: 320, flexGrow: 1 \}/.test(code)) p.push('the two-up card is not a fixed flexBasis');
  if (/flexBasis:\s*'\d+%'|width:\s*'(?:4\d|50)%'/.test(code)) p.push('a percentage tile');
  if (!/maxWidth: \(gridWidth - 12\) \/ 2/.test(code) || !/\[styles\.cardTwoUp, halfColumn\]/.test(code)) p.push('a lone last card can stretch across the column (no half-column maxWidth)');
  if (!/retryPendingAwards\(awardSkillCertificate\)/.test(code) || !/useFocusEffect\(/.test(code)) p.push('pending awards are not retried on focus');
  if (!/'Passed, not issued yet'/.test(code)) p.push('a pending pass is not labelled "Passed, not issued yet"');
  if (!/BRAIN_FAB_CLEARANCE/.test(code)) p.push('no BRAIN_FAB_CLEARANCE bottom padding');
  return p;
}

// ── Run ─────────────────────────────────────────────────────────────────────
const files = { doc: read(P.doc), card: read(P.card), row: read(P.row), screen: read(P.screen), settings: read(P.settings) };
const sampleHtml = buildCertificateHtml(cert(), CO, { verifyUrl: URL_OK, issuedLabel: 'Oct 1, 2026' });

console.log('\nskill certificate document');
rule('(a) every printed value is HTML-escaped; one letter landscape page', checkEscaping(buildCertificateHtml));
rule('(b) the page carries both notes, the title, the name, the score, the scope, the check link and code', checkWords(buildCertificateHtml));
rule('(c) check code, {n} of 15, share text and the screen-reader line', checkHelpers());
rule('(d) no credential words, cues or icons outside CERT_SCOPE_NOTE', checkBanned(files, sampleHtml));
rule('(e) the card shows both notes; removal is confirmed, direct and server-confirmed', checkCard(files.card));
rule('(f) the profile row is signed-in only and sits under the profile hero', checkRow(files.row, files.settings));
rule('(g) the screen never shows "none" for a failed read; fixed-basis two-up', checkScreen(files.screen));

// ── Planted mutations: each must FAIL its rule ──────────────────────────────
function plant(src: string, from: string | RegExp, to: string): string {
  const out = src.replace(from, to);
  if (out === src) throw new Error(`plant: anchor not found: ${String(from)}`);
  return out;
}
const unescaped: typeof buildCertificateHtml = (c, t, o) =>
  buildCertificateHtml({ ...c, holderName: 'PLACEHOLDER' }, t, o).replace('Awarded to PLACEHOLDER', `Awarded to ${c.holderName}`);
const noScopeNote: typeof buildCertificateHtml = (c, t, o) => buildCertificateHtml(c, t, o).split(CERT_SCOPE_NOTE).join('');
const noNameNote: typeof buildCertificateHtml = (c, t, o) => buildCertificateHtml(c, t, o).split(CERT_NAME_NOTE).join('');

const mutations: { name: string; run: () => string[] }[] = [
  { name: '(a) the name printed unescaped', run: () => checkEscaping(unescaped) },
  { name: '(a) portrait page', run: () => checkEscaping((c, t, o) => buildCertificateHtml(c, t, o).replace('letter landscape', 'letter portrait')) },
  { name: '(b) CERT_SCOPE_NOTE dropped from the HTML', run: () => checkWords(noScopeNote) },
  { name: '(b) CERT_NAME_NOTE dropped from the HTML', run: () => checkWords(noNameNote) },
  { name: '(b) check code ungrouped', run: () => checkWords((c, t, o) => buildCertificateHtml(c, t, o).replace('ABCD-EFGH-JKLM', 'ABCDEFGHJKLM')) },
  { name: '(d) "wallet" in the doc', run: () => checkBanned({ ...files, doc: files.doc + '\n// wallet size' }, sampleHtml) },
  { name: '(d) "Certified" in the card', run: () => checkBanned({ ...files, card: files.card.replace("'Awarded to {name}'", "'Certified: {name}'") }, sampleHtml) },
  { name: '(d) "Expires" in the HTML', run: () => checkBanned(files, sampleHtml + '<p>Expires 2027</p>') },
  { name: '(d) a 3.375in pocket card', run: () => checkBanned({ ...files, doc: files.doc.replace('@page { size: letter landscape;', '@page { size: 3.375in 2.125in;') }, sampleHtml) },
  { name: '(d) an Award icon on the card', run: () => checkBanned({ ...files, card: plant(files.card, "import { Platform, StyleSheet, Text, View } from 'react-native';", "import { Platform, StyleSheet, Text, View } from 'react-native';\nimport { Award } from 'lucide-react-native';") }, sampleHtml) },
  { name: '(d) a ShieldCheck icon on the row', run: () => checkBanned({ ...files, row: plant(files.row, '{ BookOpen, ChevronRight }', '{ ShieldCheck, ChevronRight }') }, sampleHtml) },
  { name: '(e) CERT_NAME_NOTE no longer rendered', run: () => checkCard(plant(files.card, '{CERT_NAME_NOTE}', '{null}')) },
  { name: '(e) CERT_SCOPE_NOTE no longer rendered', run: () => checkCard(plant(files.card, '{CERT_SCOPE_NOTE}', '{null}')) },
  { name: '(e) the offline check removed', run: () => checkCard(plant(files.card, "  if (isOfflineNow()) return 'offline';\n", '')) },
  { name: '(e) removed without asking for the row back', run: () => checkCard(plant(files.card, ".delete().eq('id', id).select('id')", ".delete().eq('id', id)")) },
  { name: '(e) success toast before the server answers', run: () => checkCard(plant(files.card, '    busyRef.current = true;\n    setBusy(\'remove\');', "    busyRef.current = true;\n    nailIt('Certificate removed');\n    setBusy('remove');")) },
  { name: '(e) removal through the offline queue', run: () => checkCard(files.card + '\nconst q = supabaseWrite;') },
  { name: '(e) no confirm before removing', run: () => checkCard(plant(files.card, "style: 'destructive', onPress: () => { void doRemove(); }", "style: 'destructive', onPress: () => {}")) },
  { name: '(e) header note dropped', run: () => checkCard(plant(files.card, 'REMOVE IS NOT QUEUED', 'REMOVE')) },
  { name: '(f) signed-out guard removed', run: () => checkRow(plant(files.row, '  if (!isAuthenticated || !user) return null;\n', ''), files.settings) },
  { name: '(f) data hook before the guard', run: () => checkRow(plant(files.row, '  const { isAuthenticated, user } = useAuth();\n', '  const { isAuthenticated, user } = useAuth();\n  const q = useMyCertificates();\n'), files.settings) },
  { name: '(f) row mounted twice', run: () => checkRow(files.row, plant(files.settings, '<SkillsProfileRow />', '<SkillsProfileRow />\n<SkillsProfileRow />')) },
  { name: '(f) row moved above the hero', run: () => checkRow(files.row, plant(files.settings, '\n        <SkillsProfileRow />\n', '\n').replace('{isAuthenticated && user ? (\n          <TouchableOpacity', '<SkillsProfileRow />\n        {isAuthenticated && user ? (\n          <TouchableOpacity')) },
  { name: '(g) empty state shown while the read failed', run: () => checkScreen(plant(files.screen, '{certs && earned.length === 0 ?', '{earned.length === 0 ?')) },
  { name: '(g) percentage tile', run: () => checkScreen(plant(files.screen, 'cardTwoUp: { flexBasis: 320, flexGrow: 1 }', "cardTwoUp: { flexBasis: '48%', flexGrow: 1 }")) },
  { name: '(g) lone last card stretches', run: () => checkScreen(plant(files.screen, '[styles.cardTwoUp, halfColumn]', 'styles.cardTwoUp')) },
  { name: '(g) no focus retry', run: () => checkScreen(plant(files.screen, 'useFocusEffect(useCallback(() => {', 'useEffectLater(useCallback(() => {')) },
];

console.log('\nplanted mutations (each must fail)');
for (const m of mutations) {
  let problems: string[];
  try { problems = m.run(); } catch (e) { problems = []; console.log(`      ${(e as Error).message}`); }
  if (problems.length > 0) { pass++; console.log(`  ✓ caught: ${m.name}`); }
  else { fail++; console.log(`  ✗ NOT caught: ${m.name}`); }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
