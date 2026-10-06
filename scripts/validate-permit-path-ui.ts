// scripts/validate-permit-path-ui.ts — the Permit Path screen's guard (lane PPUI, M9).
//
// Source-text and pure checks, the house style for screen guards:
//   1. every RouteItem line renders a source chip — StationDetail's ItemRow takes
//      a REQUIRED `chip`, built only by sourceChipFor(item), and sourceChipFor
//      covers all seven certainties (an exhaustive switch ending in `never`);
//   2. the confirm line is rendered exactly once, in StationDetail;
//   3. no banned words (PLAN §6.3) in any string of components/permitPath/*,
//      app/permit-path.tsx or hooks/usePermitPath.ts;
//   4. no hex colours and no motion code of their own (the kit only);
//   5. the AsyncStorage key is PERMIT_PATH_KEY from localStore.ts, under a
//      prefix the tenant sweep covers;
//   6. parsePermitPathStore survives garbage, null and older shapes (→ empty);
//   7. a pre-fill is never stored without confirmPrefill (the pure reducer);
//   8. the entry-point edits stay inside their budget.
//
// Pure node:fs + the typescript parser — no react-native import. fileURLToPath
// + join because the repo path contains a space.
// Run: bun run scripts/validate-permit-path-ui.ts

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';
import {
  EMPTY_PROJECT_STATE,
  PERMIT_PATH_KEY,
  parsePermitPathStore,
  pendingPrefills,
  reducePermitPathState,
  withProjectState,
} from '../utils/permitPath/localStore';
import { sourceChipFor } from '../components/permitPath/sourceChip';
import type { Certainty, RouteItem } from '../utils/permitPath/types';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

let failed = 0;
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  PASS  ${name}`);
  else { failed++; console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
}

/** Source with comments blanked (offsets kept), via the TS scanner. */
function code(src: string): string {
  const out = src.split('');
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.JSX, src);
  for (let k = scanner.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = scanner.scan()) {
    if (k === ts.SyntaxKind.SingleLineCommentTrivia || k === ts.SyntaxKind.MultiLineCommentTrivia) {
      for (let i = scanner.getTokenPos(); i < scanner.getTextPos(); i++) if (out[i] !== '\n') out[i] = ' ';
    }
  }
  return out.join('');
}

/** Every user-visible string in a file: string literals, template parts, JSX text. */
function strings(rel: string): string[] {
  const src = read(rel);
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    else if (ts.isJsxText(n)) { const t = n.text.trim(); if (t) out.push(t); }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

const count = (hay: string, needle: string | RegExp): number =>
  typeof needle === 'string' ? hay.split(needle).length - 1 : (hay.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : `${needle.flags}g`)) ?? []).length;

const PP_DIR = 'components/permitPath';
const PP_FILES = [
  ...readdirSync(join(ROOT, PP_DIR)).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => `${PP_DIR}/${f}`),
  'app/permit-path.tsx',
  'hooks/usePermitPath.ts',
];
/** The files this lane wrote (the motion / hex rules hold for PPASK's sheets via their own guard). */
const UI_FILES = [
  `${PP_DIR}/RouteSpine.tsx`, `${PP_DIR}/StationDetail.tsx`, `${PP_DIR}/InterviewPanel.tsx`, `${PP_DIR}/ReadinessPanel.tsx`,
  `${PP_DIR}/PermitPathHeroCard.tsx`, `${PP_DIR}/sourceChip.ts`, 'app/permit-path.tsx', 'hooks/usePermitPath.ts', 'utils/permitPath/localStore.ts',
];

console.log('validate-permit-path-ui');

// ── 1. Every line has a chip ────────────────────────────────────────────────
{
  const detail = code(read(`${PP_DIR}/StationDetail.tsx`));
  const sig = /function ItemRow\(\{[^}]*\}:\s*\{([^}]*)\}\)/.exec(detail);
  ok('1.1 StationDetail has an ItemRow component', !!sig);
  ok('1.2 ItemRow\'s `chip` prop is REQUIRED and typed SourceChip', !!sig && /\bchip:\s*SourceChip\b/.test(sig[1]) && !/\bchip\?:/.test(sig[1]), sig?.[1] ?? '');
  const rows = count(detail, /<ItemRow\b/);
  const built = count(detail, /<ItemRow\b[^>]*\bchip=\{sourceChipFor\(item\b/);
  ok(`1.3 every <ItemRow> builds its chip with sourceChipFor(item) (${built} of ${rows})`, rows > 0 && rows === built);
  ok('1.4 RouteItem text renders only through ItemRow in StationDetail', count(detail, /\{item\.text\}/) === 1 && /function ItemRow[\s\S]*?\{item\.text\}[\s\S]*?\bchip\b/.test(detail));

  const ready = code(read(`${PP_DIR}/ReadinessPanel.tsx`));
  ok('1.5 every readiness row builds its chip with sourceChipFor(r.item)', /sourceChipFor\(r\.item\b/.test(ready) && /\{chip\.label\}/.test(ready));

  const chipSrc = code(read(`${PP_DIR}/sourceChip.ts`));
  const types = read('utils/permitPath/types.ts');
  const union = /export type Certainty\s*=([^;]+);/.exec(types)?.[1] ?? '';
  const all = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]) as Certainty[];
  ok(`1.6 the contract has 7 certainties (${all.join(', ')})`, all.length === 7);
  const fn = /export function sourceChipFor[\s\S]*?\n}\n/.exec(chipSrc)?.[0] ?? '';
  const missingCase = all.filter((c) => !new RegExp(`case '${c}':`).test(fn));
  ok('1.7 sourceChipFor has a case for every certainty', missingCase.length === 0, missingCase.join(', '));
  ok('1.8 sourceChipFor\'s switch is exhaustive (never)', /default:\s*\{\s*const never: never = item\.certainty;/.test(fn));

  const base: RouteItem = { id: 'x', station: 'filing', kind: 'need', text: 'A line', who: [], certainty: 'unknown', source: null, answer: null, askQuestionId: null, readiness: true };
  const fixtures: Record<Certainty, RouteItem> = {
    verified: { ...base, certainty: 'verified', source: { label: 'NYC DOB · Do I need a permit?', url: 'https://www.nyc.gov/x', checkedOn: '2026-10-02' } },
    department_said: { ...base, certainty: 'department_said', answer: { id: 'a1', answeredOn: '2024-09-01', saidBy: 'J. Smith · plans examiner', channel: 'phone', sourceUrl: null } },
    your_records: { ...base, certainty: 'your_records' },
    measured: { ...base, certainty: 'measured' },
    your_answer: { ...base, certainty: 'your_answer' },
    ai_draft: { ...base, certainty: 'ai_draft' },
    unknown: { ...base, certainty: 'unknown', askQuestionId: 'li.survey' },
  };
  const labels = all.map((c) => sourceChipFor(fixtures[c], { today: '2026-10-02' }));
  ok('1.9 every certainty gets a non-empty chip label', labels.every((l) => l.label.trim().length > 0), labels.map((l) => `${l.certainty}=${l.label}`).join(' | '));
  const v = sourceChipFor(fixtures.verified, { today: '2026-10-02' });
  ok('1.10 verified: the source label, "checked <date>" and a link out', /checked Oct 2, 2026$/.test(v.label) && v.action?.kind === 'link');
  const u = sourceChipFor(fixtures.unknown, { today: '2026-10-02' });
  ok('1.11 unknown: "Not known yet · Ask", opening the ask sheet for its question', u.label === 'Not known yet · Ask' && u.action?.kind === 'ask' && u.action.questionId === 'li.survey');
  const d = sourceChipFor(fixtures.department_said, { today: '2026-10-02' });
  ok('1.12 department_said: date + who, stale after 365 days', /^Department said · Sep 1, 2024 · J\. Smith/.test(d.label) && d.stale && !!d.staleLabel);
  ok('1.13 ai_draft reads "AI draft"', sourceChipFor(fixtures.ai_draft, { today: '2026-10-02' }).label === 'AI draft');
  const noSrc = sourceChipFor({ ...fixtures.verified, source: null }, { today: '2026-10-02' });
  ok('1.14 a "verified" line with no source never says "checked"', !/checked/.test(noSrc.label));
}

// ── 1b. The F4 stale chip re-asks (integration fix round 1) ──────────────────
// A department_said line never carries askQuestionId (the engine nulls it), so
// the "Ask again?" chip must take its questions from the saved answer, and
// every new pressable carries a role (test:a11y-roles ceiling).
{
  const detail = code(read(`${PP_DIR}/StationDetail.tsx`));
  ok('1b.1 the stale chip re-asks with the saved answer\'s questionIds', /savedAnswer\?\.\(item\.answer\.id\)\?\.questionIds/.test(detail) && /testID=\{`\$\{testID\}-stale`\}/.test(detail) && /onPress=\{reAsk\}[\s\S]{0,200}?accessibilityRole="button"[\s\S]{0,300}?-stale`/.test(detail));
  ok('1b.2 ItemRow is handed savedAnswer', /<ItemRow\b[^>]*\bsavedAnswer=\{savedAnswer\}/.test(detail));
  const ready = code(read(`${PP_DIR}/ReadinessPanel.tsx`));
  ok('1b.3 the readiness source chip carries an accessibilityRole', /accessibilityRole=\{chip\.action\?\.kind === 'link' \? 'link' : 'button'\}[\s\S]{0,300}?-chip`/.test(ready));
}

// ── 2. One confirm line ─────────────────────────────────────────────────────
{
  const detail = code(read(`${PP_DIR}/StationDetail.tsx`));
  ok(`2.1 StationDetail renders station.confirmLine exactly once (${count(detail, /\bconfirmLine\b/)})`, count(detail, /\bconfirmLine\b/) === 1 && count(detail, /\{station\.confirmLine\}/) === 1);
  const others = PP_FILES.filter((f) => !f.endsWith('StationDetail.tsx') && /\bconfirmLine\b/.test(code(read(f))));
  ok('2.2 no other Permit Path UI file renders a confirm line', others.length === 0, others.join(', '));
  const screen = code(read('app/permit-path.tsx'));
  ok('2.3 the screen prints its disclaimer exactly once', count(screen, "It doesn’t file, review or approve anything.") === 1);
}

// ── 3. Banned words ─────────────────────────────────────────────────────────
{
  const BANNED: { re: RegExp; allow?: RegExp }[] = [
    { re: /files? permits/i },
    { re: /file for you/i },
    { re: /verified code/i },
    { re: /\bapproved\b/i, allow: /approved filings only/i },
    { re: /\bcompliant\b/i },
    { re: /\bguaranteed?\b/i },
    { re: /permit-ready/i },
    { re: /DOB-approved/i },
    { re: /\bcertified\b/i, allow: /Certified Asbestos Investigator/ },
    // MAGE never calls its own output verified (a single enum token like 'verified' is code, not copy).
    { re: /\bverified\b/i },
  ];
  const hits: string[] = [];
  for (const f of PP_FILES) {
    for (const s of strings(f)) {
      if (/^[a-z_-]+$/.test(s)) continue; // an enum token ('verified', 'hand-verified'), not copy
      for (const b of BANNED) {
        if (!b.re.test(s)) continue;
        if (b.allow && b.re.test(s.replace(b.allow, ''))) { hits.push(`${f}: "${s}"`); continue; }
        if (!b.allow) hits.push(`${f}: "${s}"`);
      }
    }
  }
  ok(`3.1 no banned words in ${PP_FILES.length} Permit Path UI files`, hits.length === 0, hits.join('\n        '));
}

// ── 4. No hex colours, no motion code of our own ────────────────────────────
{
  const hex: string[] = [];
  const motion: string[] = [];
  for (const f of UI_FILES) {
    for (const s of strings(f)) if (/#[0-9a-fA-F]{3,8}\b/.test(s)) hex.push(`${f}: ${s}`);
    const c = code(read(f));
    for (const re of [/Animated\.(timing|spring|decay|loop|sequence|parallel|Value)\b/, /\bwithTiming\b/, /\bwithSpring\b/, /useNativeDriver/, /react-native-reanimated/, /\bLayoutAnimation\b/]) {
      if (re.test(c)) motion.push(`${f}: ${re.source}`);
    }
  }
  ok('4.1 no hex colours (theme tokens only)', hex.length === 0, hex.join('\n        '));
  ok('4.2 no motion code outside the kit (Animated / withTiming / LayoutAnimation)', motion.length === 0, motion.join('\n        '));
  const spine = code(read(`${PP_DIR}/RouteSpine.tsx`));
  ok('4.3 RouteSpine arrives through StaggerList and marks "You are here" with FocusMarker', /<StaggerList\b/.test(spine) && /<FocusMarker\b/.test(spine));
  const ready = code(read(`${PP_DIR}/ReadinessPanel.tsx`));
  ok('4.4 ReadinessPanel ticks with CheckSync and tallies with CountRoll', /<CheckSync\b/.test(ready) && /<CountRoll\b/.test(ready));
  const hook = code(read('hooks/usePermitPath.ts'));
  const dispatch = /const dispatch = useCallback\(([\s\S]*?)\n  \}, \[projectId\]\);/.exec(hook)?.[1] ?? '';
  ok('4.5 every change calls layoutNext() before the state update', dispatch.indexOf('layoutNext()') > 0 && dispatch.indexOf('layoutNext()') < dispatch.indexOf('publish('));
}

// ── 5. The storage key ──────────────────────────────────────────────────────
{
  ok(`5.1 PERMIT_PATH_KEY is 'mageid_permit_path'`, PERMIT_PATH_KEY === 'mageid_permit_path');
  ok('5.2 its prefix is in APP_STORAGE_PREFIXES (the tenant sweep covers it)', APP_STORAGE_PREFIXES.some((p) => PERMIT_PATH_KEY.startsWith(p)));
  const stray: string[] = [];
  for (const f of [...UI_FILES.filter((x) => !x.endsWith('localStore.ts'))]) {
    const c = code(read(f));
    if (/AsyncStorage/.test(c) || /mageid_permit_path/.test(c)) stray.push(f);
  }
  ok('5.3 only localStore.ts touches AsyncStorage or spells the key', stray.length === 0, stray.join(', '));
  const store = code(read('utils/permitPath/localStore.ts'));
  ok('5.4 localStore reads and writes only PERMIT_PATH_KEY', count(store, /AsyncStorage\.(getItem|setItem)\(PERMIT_PATH_KEY\b/) === 2 && count(store, /AsyncStorage\.\w+\(/) === 2);
}

// ── 6. Parsing never throws, garbage is empty ───────────────────────────────
{
  const garbage: unknown[] = [
    null, undefined, '', 'not json', '{', '[]', '42', 'null', '"str"', [], 7, true,
    '{"p":5}', '{"p":null}', '{"p":[]}',
    // older shapes: answers as an array, no marks, or the top level holding one project's fields
    '{"p":{"answers":[["base.occupied","yes"]]}}', '{"p":{"answers":{}}}', '{"answers":{},"marks":{}}',
    { p: { answers: 'x', marks: {} } },
  ];
  const bad: string[] = [];
  for (const g of garbage) {
    try {
      const out = parsePermitPathStore(g);
      if (Object.keys(out).length !== 0) bad.push(`${JSON.stringify(g)} → ${JSON.stringify(out)}`);
    } catch (e) {
      bad.push(`${JSON.stringify(g)} threw ${(e as Error).message}`);
    }
  }
  ok(`6.1 ${garbage.length} garbage / null / older-shape blobs parse to {} and never throw`, bad.length === 0, bad.join('\n        '));
  const good = {
    p1: {
      answers: {
        'nyc.landmark': { value: 'yes', from: 'prefill_confirmed', prefillNote: 'PLUTO lists X (PLUTO 24v2)', at: '2026-10-02T15:00:00.000Z' },
        'base.work_types': { value: ['kitchen_bath', 'plumbing'], from: 'gc', prefillNote: null, at: 'x' },
        'base.building_year': { value: 1931, from: 'gc', prefillNote: null, at: 'x' },
        bad1: { value: { o: 1 }, from: 'gc', at: 'x' },
        bad2: { value: 'yes', from: 'prefill', at: 'x' },
      },
      marks: {
        'nyc.hic': { state: 'have', evidence: { kind: 'attested', ref: null }, at: '2026-10-02' },
        bad3: { state: 'maybe', evidence: null, at: 'x' },
      },
      updatedAt: '2026-10-02T15:00:00.000Z',
    },
  };
  const parsed = parsePermitPathStore(JSON.stringify(good));
  ok('6.2 a good blob round-trips; malformed answers and marks are dropped one by one',
    Object.keys(parsed.p1?.answers ?? {}).sort().join(',') === 'base.building_year,base.work_types,nyc.landmark'
    && Object.keys(parsed.p1?.marks ?? {}).join(',') === 'nyc.hic'
    && parsePermitPathStore(JSON.stringify(parsed)).p1?.updatedAt === good.p1.updatedAt);
}

// ── 7. A pre-fill is stored only through confirmPrefill ─────────────────────
{
  const qs = [{ id: 'nyc.landmark' }, { id: 'base.building_year' }];
  const suggestion = { value: 'yes', note: 'PLUTO lists Park Slope Historic District (PLUTO 24v2)' };
  let s = EMPTY_PROJECT_STATE;
  const pending = pendingPrefills(qs, s.answers, (q) => (q.id === 'nyc.landmark' ? suggestion : null));
  ok('7.1 a pending pre-fill is offered for an unanswered question', pending['nyc.landmark'] === suggestion && !('base.building_year' in pending));
  ok('7.2 offering it stores nothing', Object.keys(s.answers).length === 0 && Object.keys(EMPTY_PROJECT_STATE.answers).length === 0);
  s = reducePermitPathState(s, { type: 'answer', id: 'base.building_year', value: 1931, at: 't1' });
  ok('7.3 a GC answer is stored as from:gc with no pre-fill note', s.answers['base.building_year']?.from === 'gc' && s.answers['base.building_year']?.prefillNote === null);
  ok('7.4 the unconfirmed pre-fill is still not stored', !('nyc.landmark' in s.answers));
  s = reducePermitPathState(s, { type: 'confirmPrefill', id: 'nyc.landmark', value: suggestion.value, note: suggestion.note, at: 't2' });
  ok('7.5 Confirm stores it as prefill_confirmed, with its note', s.answers['nyc.landmark']?.from === 'prefill_confirmed' && s.answers['nyc.landmark']?.prefillNote === suggestion.note);
  ok('7.6 once answered it is no longer offered', !('nyc.landmark' in pendingPrefills(qs, s.answers, () => suggestion)));
  const cleared = reducePermitPathState(s, { type: 'clearAnswer', id: 'nyc.landmark', at: 't3' });
  ok('7.7 clearAnswer removes it and leaves the rest', !('nyc.landmark' in cleared.answers) && 'base.building_year' in cleared.answers);
  const marked = reducePermitPathState(s, { type: 'mark', itemId: 'nyc.hic', mark: { state: 'have', evidence: { kind: 'attested', ref: null }, at: '2026-10-02' }, at: 't4' });
  ok('7.8 a mark never touches the answers', marked.answers === s.answers && marked.marks['nyc.hic']?.state === 'have');
  ok('7.9 withProjectState is pure', Object.keys(withProjectState({}, 'p', s)).join() === 'p');

  const store = code(read('utils/permitPath/localStore.ts'));
  ok('7.10 the reducer writes prefill_confirmed in exactly one place', count(store, /from: 'prefill_confirmed'/) === 1 && /case 'confirmPrefill':[\s\S]{0,200}from: 'prefill_confirmed'/.test(store));
  const hook = code(read('hooks/usePermitPath.ts'));
  ok('7.11 the hook dispatches confirmPrefill only from confirmPrefill()', count(hook, /type: 'confirmPrefill'/) === 1 && /const confirmPrefill = useCallback\(\(id: string\) => \{[\s\S]{0,160}type: 'confirmPrefill'/.test(hook));
  ok('7.12 the hook never passes pre-fills to the store directly', !/publish\([^)]*prefill/i.test(hook) && !/savePermitPathStore\([^)]*prefill/i.test(hook));
}

// ── 8. Entry-point budget ───────────────────────────────────────────────────
{
  const IMPORT_HERO = "import { PermitPathHeroCard } from '@/components/permitPath/PermitPathHeroCard';";
  const ai = code(read('app/(tabs)/construction-ai/index.tsx'));
  ok('8.1 Construction AI: the segment reads "Permit Path", not "Project roadmap"', count(ai, '>Permit Path</Text>') === 1 && !/>Project roadmap</.test(ai));
  ok('8.2 Construction AI: one hero card mount on the roadmap project, plus its import', count(ai, /<PermitPathHeroCard\b/) === 1 && count(ai, '<PermitPathHeroCard project={roadmapProject} />') === 1 && count(ai, IMPORT_HERO) === 1);
  ok('8.3 Construction AI: the old hero is the "AI Draft List"', count(ai, '>AI Draft List</Text>') === 1
    && count(ai, 'Suggested permits and inspections from your scope and schedule. Check each one.') === 1
    && !/AI generates a sequenced permit and inspection roadmap/.test(ai));
  const permits = code(read('app/permits.tsx'));
  ok('8.4 Permits: one compact hero card on the scoped job, plus its import', count(permits, /<PermitPathHeroCard\b/) === 1 && count(permits, '<PermitPathHeroCard project={scopedProject} compact') === 1 && count(permits, IMPORT_HERO) === 1);
  const hub = code(read('app/project-detail.tsx'));
  ok(`8.5 Project hub: 'permitPath' in the key type, the flag map, the tile, its group and pressTile (${count(hub, /\bpermitPath\b/)})`, count(hub, /\bpermitPath\b/) === 5);
  ok('8.6 Project hub: the tile routes to /permit-path with the job id', count(hub, "if (tile.key === 'permitPath') { router.push({ pathname: '/permit-path', params: { projectId: id } }); return; }") === 1);
}

console.log(failed ? `\nvalidate-permit-path-ui: ${failed} FAILED` : '\nvalidate-permit-path-ui: all checks pass');
process.exit(failed ? 1 : 0);
