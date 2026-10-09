// validate-code-flags — Code Flags (Big Bets, Bet 4, Phase 1; lane CODEFLAGS).
// Dark behind CODE_FLAGS_ENABLED = false.
//
// WHAT IT PROVES, with no phone.
//
// A. THE MATCHER (utils/codeFlags, run directly, no React)
//    A1 every positive example line gives exactly its families (at least 150);
//    A2 every negative example line gives none (at least 150);
//    A3 every family's `quiet` lines do not fire that family;
//    A4 the matcher is deterministic, never changes the line it is handed, and
//       an empty line is unflagged;
//    A5 the table is built on what exists: all nine model-code books are
//       covered, every reused phrase is read off utils/codeScopeTriggers, the
//       lead words ARE utils/buildingScopeTriggers' words, the two years are
//       the existing rules' years, and the list still says nobody reviewed it;
//    A6 building age: no year means no age flag; 1977 and 1978, 1987 and 1988
//       fall on the right sides; asbestos is New York City only; lead is
//       residential only;
//    A7 a verb and its noun match a few words apart, and only then: three
//       ordinary words reach, four do not; "and", "at" and a comma end the
//       reach; "wall tile" is tile; the sheet is handed both words;
//    A8 plurals: "s", "es" and "y" to "ies", and nothing looser;
//    A9 "no X", "not including X" and "excluding X" cancel X, in English and
//       Spanish; "X by others" still flags;
//    A10 accents are folded before the words are split, and the Spanish
//       phrases match with and without their accents;
//    A11 no family has a line-wide veto: sprinkler work on a garden level
//       flags, a lawn sprinkler does not;
//    A12 building age shows ONCE for a change order or an estimate: no line
//       ever carries it, forty lines give one row, and each screen mounts
//       one row;
//    A13 layout changes: non-bearing work is the layout family alone, never
//       structural; its words never say "bearing"; New York City gets the
//       filing sentence and nowhere else does; the family says it still
//       needs a founder or an expediter.
// B. PLACES
//    B1 New York City, Baltimore City and Baltimore County resolve through the
//       app's one resolver; a bare "Baltimore, MD" is unsettled; everything
//       else (New Jersey, Riyadh, Doha, Kuwait City, no address) is 'other';
//    B2 outside the three places no line ever carries a section number or a
//       link;
//    B3 every link is found, character for character, in the data the repo
//       already checked; there are exactly two section numbers, each found in
//       the row it is credited to, and New York City has none.
// C. WHAT IT MAY NEVER DO (source text)
//    C1 no model call and no network in the core, the components or the hook;
//    C2 it never blocks: the two screens use the feature in fixed shapes only,
//       the chip takes no callback, no disabled= or onPress= on those screens
//       reads it, and a result has no blocking field;
//    C3 flag off: the flag is false, the screens load the feature only through
//       a require guarded by it (no static import), every component returns
//       null first, and nothing else in the app imports the feature;
//    C4 nothing reaches a client: no file reachable from the portal snapshot,
//       the PDFs, the emails, the proof packet, the sub portal or the share
//       text imports or names the feature; the line types carry no flag field;
//       the static pages and the server functions never name it; and the
//       strings are read only by the one copy hook;
//    C5 storage: one key, under an app-owned prefix, written only by the
//       dismiss store; a record from another account is read as empty; a
//       hidden flag comes back when the line changes to a new kind of work.
// D. THE WORDS (the English shard and the Spanish file)
//    D1 the banned words are in neither language;
//    D2 the sheet says that no flag means nothing, that a flag never stops an
//       action, and that it is not on anything the contractor sends;
//    D3 every sentence passes the app's own-words gate
//       (utils/codeCard/echoCheck) and is short;
//    D4 English and Spanish key sets, placeholders and source hashes agree;
//    D5 house style: labels in Title Case, sentences that end, no em dash, no
//       "&", no "e.g.", no arrows; the chip says the agreed words; the standing
//       line is the app's own CODE_RESULT_NOTE;
//    D6 the sheet prints the words that triggered the flag.
// E. THE LOOK AND THE GATE
//    E1 no react-native-reanimated, Lucide icons only, no warning triangle, no
//       danger colour, the accent is never a background;
//    E2 the chip is on every plan (no tier check in the feature) and the
//       deeper answer goes to Code Check, which keeps its own gate;
//    E3 cost and reach: the rule phrases are split into words once, at module
//       load; the chip reads only its labels and the sheet alone builds the
//       sentences; the chip has a hit slop, the sheet's names and headings
//       are headers, and the sheet has no scroll view of its own.
//
// Every rule has at least one planted mutation that must turn it red.
//
// Run: bun run scripts/validate-code-flags.ts
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CORE from '../utils/codeFlags';
import { CODE_FLAG_NEGATIVES, CODE_FLAG_POSITIVES, type CodeFlagFixture } from '../utils/codeFlags/fixtures';
import { CODE_SCOPE_RULES } from '../utils/codeScopeTriggers';
import { normalizeScopeText } from '../utils/scopeCoverage';
import { ACP5_LAST_YEAR, BUILDING_TRIGGER_PHRASES, RRP_CUTOFF_YEAR } from '../utils/buildingScopeTriggers';
import { LOCAL_ADOPTIONS } from '../utils/codeJurisdiction';
import { APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';
import { longestRun, passesProseCheck } from '../utils/codeCard/echoCheck';
import { CODE_RESULT_NOTE } from '../utils/codeAckCore';
import { sourceHash } from '../i18n/hash';
import { EN as EN_REAL } from '../i18n/catalog/en/office.code-flags.generated';
import { ES_OFFICE_CODE_FLAGS as ES_REAL } from '../i18n/catalog/es/office/codeFlags';
import { SURFACES } from '../i18n/surfaces';
import { isTitleCase } from './copy-title-case';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

// ── the world a rule looks at (a mutation hands it an edited copy) ──────────
const CORE_FILES = [
  'utils/codeFlags/rules.ts', 'utils/codeFlags/text.ts', 'utils/codeFlags/place.ts', 'utils/codeFlags/match.ts',
  'utils/codeFlags/dismissCore.ts', 'utils/codeFlags/dismissStore.ts', 'utils/codeFlags/index.ts',
  'utils/codeFlags/fixtures.ts',
] as const;
const UI_FILES = [
  'components/codeFlags/CodeFlagChip.tsx', 'components/codeFlags/CodeFlagAgeRow.tsx', 'components/codeFlags/CodeFlagSheet.tsx',
  'components/codeFlags/CodeFlagsProbe.tsx', 'components/codeFlags/contextStore.ts', 'components/codeFlags/index.ts',
  'hooks/useCodeFlagsCopy.ts',
] as const;
const FEATURE_FILES: readonly string[] = [...CORE_FILES, ...UI_FILES];
const SCREENS = ['app/change-order.tsx', 'app/(tabs)/estimate/full.tsx'] as const;
const FLAG_FILE = 'constants/featureFlags.ts';
/** The builders of everything a client, a sub or an architect is handed. */
const CLIENT_ROOTS = [
  'utils/portalSnapshot.ts', 'utils/subPortalSnapshot.ts', 'utils/pdfGenerator.ts', 'utils/emailService.ts',
  'utils/coProofPacket.ts', 'utils/codeCard/shareText.ts', 'utils/bidInvites.ts',
] as const;

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  if (!existsSync(join(ROOT, dir))) return out;
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, exts, out);
    else if (exts.test(name)) out.push(rel);
  }
  return out;
}
const SOURCE_DIRS = ['app', 'components', 'utils', 'hooks', 'contexts', 'constants', 'lib', 'i18n', 'types'];
const ALL: Record<string, string> = {};
for (const dir of SOURCE_DIRS) for (const f of walk(dir, /\.(ts|tsx|js|jsx)$/)) ALL[f] = read(f);
/** Static pages and server functions: named, never imported. Read once. */
const FAR: Record<string, string> = {};
for (const f of [...walk('marketing', /\.(html|js)$/), ...walk('supabase/functions', /\.(ts|js)$/)]) FAR[f] = read(f);

interface Mods {
  flagLine: typeof CORE.flagLine;
  flagAge: typeof CORE.flagBuildingAge;
  tokenize: typeof CORE.tokenize;
  isFormOf: typeof CORE.isFormOf;
  dismissScope: typeof CORE.dismissScope;
  withDismissal: typeof CORE.withDismissal;
  resolvePlace: typeof CORE.resolveCodeFlagPlace;
  localRefs: typeof CORE.codeFlagLocalRefs;
  families: typeof CORE.CODE_FLAG_FAMILIES;
  parseDismiss: typeof CORE.parseDismissRecord;
  isDismissed: typeof CORE.isDismissed;
  dismissKey: string;
  review: typeof CORE.CODE_FLAG_RULES_REVIEW;
}
interface World {
  /** Every source file (feature, screens and the rest of the app). */
  F: Record<string, string>;
  far: Record<string, string>;
  M: Mods;
  positives: readonly CodeFlagFixture[];
  negatives: readonly CodeFlagFixture[];
  EN: Record<string, unknown>;
  ES: Record<string, { s: unknown; src: string } | undefined>;
}
const REAL: World = {
  F: ALL, far: FAR,
  M: {
    flagLine: CORE.flagLine, flagAge: CORE.flagBuildingAge, tokenize: CORE.tokenize, isFormOf: CORE.isFormOf,
    dismissScope: CORE.dismissScope, withDismissal: CORE.withDismissal, resolvePlace: CORE.resolveCodeFlagPlace, localRefs: CORE.codeFlagLocalRefs,
    families: CORE.CODE_FLAG_FAMILIES, parseDismiss: CORE.parseDismissRecord, isDismissed: CORE.isDismissed,
    dismissKey: CORE.CODE_FLAG_DISMISS_KEY, review: CORE.CODE_FLAG_RULES_REVIEW,
  },
  positives: CODE_FLAG_POSITIVES, negatives: CODE_FLAG_NEGATIVES,
  EN: EN_REAL as Record<string, unknown>,
  ES: ES_REAL as unknown as World['ES'],
};

// ── helpers ──────────────────────────────────────────────────────────────────
const ADDRESS: Record<CORE.CodeFlagPlaceId, { city?: string; state?: string; zip?: string }> = {
  nyc: { city: 'Brooklyn', state: 'NY' },
  baltimore_city: { city: 'Baltimore', state: 'MD', zip: '21201' },
  baltimore_county: { city: 'Towson', state: 'MD' },
  other: {},
};
function ctxOf(w: World, f: CodeFlagFixture['ctx']): CORE.CodeFlagContext {
  const id = f?.place ?? 'other';
  return {
    place: id === 'other' ? CORE.NO_PLACE : w.M.resolvePlace(ADDRESS[id]),
    yearBuilt: f?.yearBuilt ?? null,
    jobKind: f?.jobKind ?? 'residential',
  };
}
const ids = (r: { hits: readonly CORE.CodeFlagHit[] }) => r.hits.map((h) => h.familyId).sort().join(',');
/** A fixture's answer: the line's own chip, and the one row of a document holding only that line. */
function hitsOf(w: World, line: CORE.CodeFlagLine, ctx: CORE.CodeFlagContext): CORE.CodeFlagHit[] {
  return [...w.M.flagLine(line, ctx).hits, ...w.M.flagAge([line], ctx).hits];
}
const famOf = (w: World, name: string, ctx: CORE.CodeFlagContext = CORE.DEFAULT_CODE_FLAG_CONTEXT, extra: Partial<CORE.CodeFlagLine> = {}) =>
  ids(w.M.flagLine({ name, ...extra }, ctx));
/** True when the rule phrase's words stand side by side on the line (the last may be plural). */
function onLine(lineText: string, phrase: string): boolean {
  const words = CORE.tokenize(lineText);
  const want = CORE.phraseTokens(phrase);
  if (!want.length) return false;
  for (let i = 0; i + want.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < want.length; k++) {
      const last = k === want.length - 1;
      if (last ? !CORE.isFormOf(words[i + k], want[k]) : words[i + k] !== want[k]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** Files a file imports ('@/x' and relative), resolved to repo paths that exist in `F`. */
function importsOf(F: Record<string, string>, file: string): string[] {
  const src = stripComments(F[file] ?? '');
  const out: string[] = [];
  const re = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const spec = m[1];
    let base: string | null = null;
    if (spec.startsWith('@/')) base = spec.slice(2);
    else if (spec.startsWith('.')) {
      const parts = dirname(file).split('/');
      for (const seg of spec.split('/')) {
        if (seg === '.') continue;
        if (seg === '..') parts.pop(); else parts.push(seg);
      }
      base = parts.join('/');
    }
    if (!base) continue;
    for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]) {
      if (c in F) { out.push(c); break; }
    }
  }
  return out;
}
function closure(F: Record<string, string>, roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const todo = roots.filter((r) => r in F);
  while (todo.length) {
    const f = todo.pop() as string;
    if (seen.has(f)) continue;
    seen.add(f);
    for (const i of importsOf(F, f)) if (!seen.has(i)) todo.push(i);
  }
  return seen;
}
const NAMES_FEATURE = /code[-_ ]?flag/i;

const BANNED_EN: readonly RegExp[] = [
  /\bcompliant\b/i, /\bcompliance\b/i, /\bcomplies\b/i, /\bpasses\b/i, /\bpassed\b/i, /\bmeets? (?:the )?code\b/i, /\bup to code\b/i,
  /\bapproved\b/i, /\bapproval\b/i, /\brequired\b/i, /\brequires\b/i, /\bmandatory\b/i, /\bmust\b/i, /\bviolat/i,
  /\bis fine\b/i, /\bno permit needed\b/i, /\bguarantee/i,
];
const BANNED_ES: readonly RegExp[] = [
  /\bcumple/i, /\bconforme\b/i, /\bpasa\b/i, /\bpasó\b/i, /\baprobad[oa]s?\b/i, /\baprueba\b/i, /\baprobación\b/i,
  /\bexigid[oa]s?\b/i, /\bexige\b/i, /\brequerid[oa]s?\b/i, /\brequiere\b/i, /\bobligatori[oa]s?\b/i, /\bdebe[ns]?\b/i,
  /\bviola/i, /\bestá bien\b/i, /\ben regla\b/i, /\bgarantiza/i,
];
const placeholders = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(',');
const enStrings = (w: World) => Object.entries(w.EN).filter((e): e is [string, string] => typeof e[1] === 'string');
const esStrings = (w: World) => Object.entries(w.ES).filter((e): e is [string, { s: string; src: string }] => !!e[1] && typeof e[1].s === 'string').map(([k, v]) => [k, v.s] as [string, string]);
const feature = (w: World, files: readonly string[] = FEATURE_FILES) => files.map((f) => [f, stripComments(w.F[f] ?? '')] as [string, string]);

// ── the rules ────────────────────────────────────────────────────────────────
const RULES: Record<string, (w: World) => string[]> = {
  'A1 every positive example gives exactly its families': (w) => {
    const p: string[] = [];
    if (w.positives.length < 150) p.push(`only ${w.positives.length} positive examples (150 at least)`);
    for (const f of w.positives) {
      if (!f.expect.length) { p.push(`"${f.line.name}" is listed as a positive with no family`); continue; }
      const got = ids({ hits: hitsOf(w, f.line, ctxOf(w, f.ctx)) });
      const want = [...f.expect].sort().join(',');
      if (got !== want) p.push(`"${f.line.name}": expected ${want}, got ${got || 'no flag'}`);
    }
    return p;
  },
  'A2 every negative example gives no flag': (w) => {
    const p: string[] = [];
    if (w.negatives.length < 150) p.push(`only ${w.negatives.length} negative examples (150 at least)`);
    for (const f of w.negatives) {
      if (f.expect.length) { p.push(`"${f.line.name}" is listed as a negative with a family`); continue; }
      const hits = hitsOf(w, f.line, ctxOf(w, f.ctx));
      if (hits.length) p.push(`"${f.line.name}": expected no flag, got ${ids({ hits })}`);
    }
    return p;
  },
  'A3 every quiet line stays quiet for its family': (w) => {
    const p: string[] = [];
    const ctx: CORE.CodeFlagContext = { place: w.M.resolvePlace(ADDRESS.nyc), yearBuilt: 1931, jobKind: 'residential' };
    for (const fam of w.M.families) {
      if (!fam.quiet.length) p.push(`${fam.id} lists no quiet line`);
      for (const q of fam.quiet) {
        const hit = hitsOf(w, { name: q }, ctx).find((h) => h.familyId === fam.id && h.triggers.some((t) => t.via !== 'permit_flag'));
        if (hit) p.push(`${fam.id}: quiet line "${q}" fired on ${hit.triggers.map((t) => t.phrase).join(', ')}`);
      }
    }
    return p;
  },
  'A4 the matcher is deterministic, leaves the line alone, and reads an empty line as unflagged': (w) => {
    const p: string[] = [];
    const line = Object.freeze({ name: 'Upgrade service to 200 amp', description: 'new meter pan', category: 'electrical', csiDivision: '26' });
    const before = JSON.stringify(line);
    const ctx: CORE.CodeFlagContext = { place: w.M.resolvePlace(ADDRESS.nyc), yearBuilt: 1931, jobKind: 'residential' };
    let a: CORE.CodeFlagLineResult;
    try { a = w.M.flagLine(line, ctx); } catch (e) { return [`threw on a frozen line: ${String(e)}`]; }
    const b = w.M.flagLine(line, ctx);
    if (JSON.stringify(a) !== JSON.stringify(b)) p.push('two runs on the same line differ');
    if (JSON.stringify(line) !== before) p.push('the line was changed');
    if (!a.flagged) p.push('the probe line is not flagged');
    for (const bad of [null, undefined, { name: '' }, { name: '   ', description: '' }] as const) {
      const r = w.M.flagLine(bad as never, ctx);
      if (r.flagged || r.hits.length) p.push(`an empty line was flagged: ${JSON.stringify(bad)}`);
    }
    for (const h of a.hits) {
      if (!h.triggers.length) p.push(`${h.familyId} fired with no trigger to show`);
      for (const k of Object.keys(h)) if (/block|disable|must|require|prevent|stop/i.test(k)) p.push(`a hit carries a blocking field "${k}"`);
    }
    for (const k of Object.keys(a)) if (/block|disable|must|require|prevent|stop/i.test(k)) p.push(`a result carries a blocking field "${k}"`);
    const age = w.M.flagAge([line], ctx);
    if (JSON.stringify(age) !== JSON.stringify(w.M.flagAge([line], ctx))) p.push('two runs of the building-age check differ');
    for (const k of Object.keys(age)) if (/block|disable|must|require|prevent|stop/i.test(k)) p.push(`a building-age result carries a blocking field "${k}"`);
    for (const bad of [null, undefined, [], [null, undefined, { name: '' }]] as const) {
      try { if (w.M.flagAge(bad as never, ctx).flagged) p.push('an empty document carries a building-age flag'); }
      catch { p.push('the building-age check threw on an empty document'); }
    }
    return p;
  },
  'A5 the table is built on the existing rules': (w) => {
    const p: string[] = [];
    const books = new Set(w.M.families.flatMap((f) => [...f.books]));
    // The nine books are the existing ScopeRuleFamily type. (Its thirty rules
    // use seven of them: none is filed under IEBC or IFC.)
    const decl = /export type ScopeRuleFamily = ([^;]+);/.exec(w.F['utils/codeScopeTriggers.ts'])?.[1] ?? '';
    const nine = (decl.match(/'([A-Z]+)'/g) ?? []).map((x) => x.replace(/'/g, ''));
    if (nine.length !== 9) p.push(`the existing table names ${nine.length} books, not nine`);
    for (const b of ['IBC', 'IRC', 'IECC', 'IEBC', 'IPC', 'IMC', 'IFC', 'IFGC', 'NEC']) {
      if (!nine.includes(b)) p.push(`the existing table no longer has book ${b}`);
      if (!books.has(b as never)) p.push(`no family sits under ${b}`);
    }
    for (const b of books) if (!nine.includes(b)) p.push(`${b} is not one of the existing nine books`);
    for (const fam of w.M.families) {
      for (const id of fam.reuses) {
        const rule = CODE_SCOPE_RULES.find((r) => r.id === id);
        const how = CORE.CODE_FLAG_REUSE[id];
        if (!rule || !how) { p.push(`${fam.id} reuses "${id}", which is not in the existing table or the reuse list`); continue; }
        const src = how.from === 'triggers' ? rule.triggers : rule.coveredBy;
        for (const t of src) {
          if (how.skipTriggers.includes(t)) { if (fam.triggers.includes(t)) p.push(`${fam.id} carries "${t}", which the reuse list says is skipped`); continue; }
          if (!fam.triggers.includes(t)) p.push(`${fam.id} lost the reused phrase "${t}" from ${id}`);
        }
      }
      if (new Set(fam.triggers).size !== fam.triggers.length) p.push(`${fam.id} lists a trigger twice`);
      const pairWords = [...(fam.pairs ?? []), ...(fam.maskPairs ?? [])].flatMap((x) => [...x.first, ...x.then]);
      for (const t of [...fam.triggers, ...fam.es, ...fam.mask, ...pairWords]) if (t !== t.toLowerCase() || !t.trim()) p.push(`${fam.id}: "${t}" is not a lower-case phrase`);
      for (const x of [...(fam.pairs ?? []), ...(fam.maskPairs ?? [])]) if (!x.first.length || !x.then.length) p.push(`${fam.id}: a pair with no verb or no noun`);
      if (!fam.es.length) p.push(`${fam.id} has no Spanish phrase`);
    }
    const lead = w.M.families.find((f) => f.id === 'lead_age');
    if (!lead || lead.triggers.join('|') !== BUILDING_TRIGGER_PHRASES.join('|')) p.push('the lead words are not the existing building-age words');
    if (CORE.LEAD_BUILT_BEFORE !== RRP_CUTOFF_YEAR || RRP_CUTOFF_YEAR !== 1978) p.push('the lead year is not the existing rule year (1978)');
    if (CORE.ASBESTOS_LAST_YEAR !== ACP5_LAST_YEAR || ACP5_LAST_YEAR !== 1987) p.push('the asbestos year is not the existing rule year (1987)');
    if (w.M.families.length !== 14) p.push(`expected 14 families, found ${w.M.families.length}`);
    if (w.M.review.status !== 'pending_founder_review' && !w.M.review.reviewedOn) p.push('the list says it was reviewed, with no date');
    const flagOn = /export const CODE_FLAGS_ENABLED\s*=\s*true\b/.test(stripComments(w.F[FLAG_FILE]));
    if (flagOn && w.M.review.status !== 'founder_reviewed') p.push('the flag is on while the list is still waiting for the founder');
    return p;
  },
  'A6 building age follows the year, the place and the job': (w) => {
    const p: string[] = [];
    const nyc = w.M.resolvePlace(ADDRESS.nyc);
    const bc = w.M.resolvePlace(ADDRESS.baltimore_city);
    const has = (name: string, ctx: CORE.CodeFlagContext, fam: string) => w.M.flagAge([{ name }], ctx).hits.some((h) => h.familyId === fam);
    const res = 'residential' as const;
    if (has('Replace windows', { place: bc, yearBuilt: null, jobKind: res }, 'lead_age')) p.push('lead fired with no year');
    if (!w.M.flagAge([{ name: 'Replace windows' }], { place: bc, yearBuilt: null, jobKind: res }).ageNotChecked) p.push('a line the lead rule would read does not say the year is missing');
    if (w.M.flagAge([{ name: 'Quartz countertop' }], { place: bc, yearBuilt: null, jobKind: res }).ageNotChecked) p.push('a document with no building-age words says the year is missing');
    if (!has('Replace windows', { place: bc, yearBuilt: 1977, jobKind: res }, 'lead_age')) p.push('lead did not fire for 1977');
    if (has('Replace windows', { place: bc, yearBuilt: 1978, jobKind: res }, 'lead_age')) p.push('lead fired for 1978');
    if (has('Replace windows', { place: bc, yearBuilt: 1950, jobKind: 'commercial' }, 'lead_age')) p.push('lead fired on a commercial job');
    if (has('Replace windows', { place: bc, yearBuilt: 0, jobKind: res }, 'lead_age')) p.push('a year of 0 was read as a year');
    if (!has('Demo kitchen', { place: nyc, yearBuilt: 1987, jobKind: res }, 'asbestos_age')) p.push('asbestos did not fire for 1987');
    if (has('Demo kitchen', { place: nyc, yearBuilt: 1988, jobKind: res }, 'asbestos_age')) p.push('asbestos fired for 1988');
    if (has('Demo kitchen', { place: nyc, yearBuilt: null, jobKind: res }, 'asbestos_age')) p.push('asbestos fired with no year');
    if (has('Demo kitchen', { place: bc, yearBuilt: 1931, jobKind: res }, 'asbestos_age')) p.push('asbestos fired outside New York City');
    if (has('Demo kitchen', { place: CORE.NO_PLACE, yearBuilt: 1931, jobKind: res }, 'asbestos_age')) p.push('asbestos fired with no place');
    if (!has('Add subpanel', { place: nyc, yearBuilt: 1931, jobKind: res }, 'asbestos_age')) p.push('asbestos did not ride along with a permit flag in New York City');
    if (has('Quartz countertop', { place: nyc, yearBuilt: 1931, jobKind: res }, 'asbestos_age')) p.push('asbestos fired on a line with no flag and no trigger word');
    return p;
  },
  'A7 a verb and its noun match a few words apart, and only then': (w) => {
    const p: string[] = [];
    const yes: [string, string][] = [
      ['Remove the wall', 'structural'], ['Take down the kitchen wall', 'structural'], ['Open up wall between LR and DR', 'structural'],
      ['Move the toilet 2 ft to the left', 'plumbing'], ['Relocate kitchen sink to island', 'plumbing'],
      ['Enlarge door opening to 36 in', 'structural'], ['Replace cast iron stack', 'plumbing'],
      ['Rebuild front steps', 'decks_stairs'], ['Rebuild front porch', 'decks_stairs'],
      ['Remove one two three wall', 'structural'],
    ];
    for (const [name, fam] of yes) if (famOf(w, name) !== fam) p.push(`"${name}": expected ${fam}, got ${famOf(w, name) || 'no flag'}`);
    const no: [string, string][] = [
      ['Remove one two three four wall', 'four ordinary words between the verb and the noun'],
      ['Remove cabinets and patch wall', '"and" ends the reach'],
      ['Remove cabinets, patch wall', 'a comma ends the reach'],
      ['Remove tile at wall', '"at" ends the reach'],
      ['Remove wall tile at backsplash', '"wall tile" is tile'],
      ['Wall, then remove', 'the noun comes before the verb'],
      ['Replace stair treads', '"stair treads" are treads'],
      ['Replace HVAC filter', 'a filter is not the system'],
    ];
    for (const [name, why] of no) if (famOf(w, name)) p.push(`"${name}" flagged (${famOf(w, name)}): ${why}`);
    const hit = w.M.flagLine({ name: 'Take down the kitchen wall' }).hits.find((h) => h.familyId === 'structural');
    const t = hit?.triggers.find((x) => x.via === 'pair');
    if (!t || !t.pair || t.pair[0] !== 'take down' || t.pair[1] !== 'wall') p.push('the pair trigger does not carry its two rule words');
    else if (t.phrase !== 'take down, wall') p.push(`the pair is shown as "${t.phrase}"`);
    if (CORE.PAIR_WINDOW !== 3) p.push(`the window is ${CORE.PAIR_WINDOW} words, not three`);
    return p;
  },
  'A8 plurals are "s", "es" and "y" to "ies", and nothing looser': (w) => {
    const p: string[] = [];
    const forms: [string, string, boolean][] = [
      ['truss', 'truss', true], ['trusses', 'truss', true], ['porches', 'porch', true], ['balconies', 'balcony', true],
      ['panels', 'panel', true], ['paneles', 'panel', true], ['gass', 'gas', false], ['walled', 'wall', false],
      ['balconys', 'balcony', true], ['beamer', 'beam', false], ['wallpaper', 'wall', false],
    ];
    for (const [token, base, want] of forms) if (w.M.isFormOf(token, base) !== want) p.push(`"${token}" as a form of "${base}": expected ${want}`);
    const lines: [string, string][] = [
      ['Replace roof trusses', 'structural'], ['Rebuild porches', 'decks_stairs'], ['Repair balconies', 'decks_stairs'],
      ['Fire dampers at corridor', 'fire_rating'], ['Add subpanels', 'electrical_service'],
    ];
    for (const [name, fam] of lines) if (famOf(w, name) !== fam) p.push(`"${name}": expected ${fam}, got ${famOf(w, name) || 'no flag'}`);
    for (const name of ['Remove wallpaper at dining room', 'Beamer projector mount']) if (famOf(w, name)) p.push(`"${name}" flagged: ${famOf(w, name)}`);
    return p;
  },
  'A9 "no X", "not including X" and "excluding X" cancel X': (w) => {
    const p: string[] = [];
    for (const name of ['No structural work', 'Not including electrical panel', 'Excluding gas piping', 'No new circuits', 'Sin trabajo estructural', 'No incluye panel eléctrico']) {
      if (famOf(w, name)) p.push(`"${name}" flagged: ${famOf(w, name)}`);
    }
    const still: [string, string][] = [
      ['Electrical panel by others', 'electrical_service'], ['Gas piping by others', 'gas'],
      ['Structural work, no painting', 'structural'], ['No painting, replace electrical panel', 'electrical_service'],
      ['Electrical panel', 'electrical_service'],
    ];
    for (const [name, fam] of still) if (famOf(w, name) !== fam) p.push(`"${name}": expected ${fam}, got ${famOf(w, name) || 'no flag'}`);
    return p;
  },
  'A10 accents are folded before the words are split': (w) => {
    const p: string[] = [];
    if (w.M.tokenize('Nueva línea de gas').join(' ') !== 'nueva linea de gas') p.push(`"línea" is read as "${w.M.tokenize('Nueva línea de gas').join(' ')}"`);
    if (w.M.tokenize('Baño, sótano; ático: ¿señal?').join(' ') !== `bano ${CORE.BREAK} sotano ${CORE.BREAK} atico ${CORE.BREAK} senal`) p.push('accents, the tilde or the breaks are read wrong');
    for (const [a, b, fam] of [
      ['Nueva línea de gas', 'Nueva linea de gas', 'gas'], ['Cambio de panel eléctrico', 'Cambio de panel electrico', 'electrical_service'],
      ['Legalizar apartamento en el sótano', 'Legalizar apartamento en el sotano', 'change_of_use'], ['Balcón nuevo', 'Balcon nuevo', 'decks_stairs'],
    ] as const) {
      if (famOf(w, a) !== fam) p.push(`"${a}": expected ${fam}, got ${famOf(w, a) || 'no flag'}`);
      if (famOf(w, b) !== fam) p.push(`"${b}" (no accent): expected ${fam}, got ${famOf(w, b) || 'no flag'}`);
    }
    // Break-free English reads exactly as the app's shared normalizer reads it.
    for (const f of w.positives.slice(0, 60)) {
      if (/[,;:|]/.test(f.line.name)) continue;
      const mine = w.M.tokenize(f.line.name).join(' ');
      const theirs = normalizeScopeText(f.line.name).split(/[ /]+/).filter(Boolean).join(' ');
      if (mine !== theirs) { p.push(`"${f.line.name}" is split differently from normalizeScopeText`); break; }
    }
    const match = stripComments(w.F['utils/codeFlags/match.ts']);
    if (/normalizeScopeText/.test(match)) p.push('the matcher reads through normalizeScopeText, which drops accented letters');
    if (!/tokenize\(line\.name\)/.test(match)) p.push('the matcher does not split the line with the accent-folding tokenizer');
    for (const fam of w.M.families) for (const es of fam.es) if (CORE.phraseTokens(es).some((t) => !/^[a-z0-9]+$/.test(t))) p.push(`${fam.id}: Spanish "${es}" does not fold to plain letters`);
    return p;
  },
  'A11 no family has a line-wide veto': (w) => {
    const p: string[] = [];
    for (const name of ['Relocate sprinkler heads at garden level', 'Garden level fire alarm devices', 'Sprinkler main at rear yard extension', 'Add sprinkler heads at garden apartment']) {
      if (famOf(w, name) !== 'fire_protection') p.push(`"${name}": expected fire_protection, got ${famOf(w, name) || 'no flag'}`);
    }
    for (const name of ['Lawn sprinkler system, 6 zones', 'Replace irrigation sprinkler heads', 'Garden sprinkler timer', 'Drip irrigation line at planters']) {
      if (famOf(w, name)) p.push(`"${name}" flagged: ${famOf(w, name)}`);
    }
    for (const fam of w.M.families) if ('veto' in fam) p.push(`${fam.id} carries a veto list`);
    if (/\bveto\s*[?:]/.test(stripComments(w.F['utils/codeFlags/rules.ts']))) p.push('the rule table declares a veto field');
    return p;
  },
  'A12 building age shows once for a change order or an estimate': (w) => {
    const p: string[] = [];
    const nyc: CORE.CodeFlagContext = { place: w.M.resolvePlace(ADDRESS.nyc), yearBuilt: 1925, jobKind: 'residential' };
    const names = [
      'Demo kitchen to studs', 'Demo bathroom', 'Remove plaster ceiling', 'New drywall at kitchen', 'Paint kitchen walls and ceiling',
      'Paint bathroom', 'Replace 3 windows', 'New interior doors, 4', 'Door casing and trim', 'Baseboard trim', 'Crown molding trim',
      'Skim coat plaster walls', 'Sanding and prep', 'Add subpanel', 'Relocate kitchen sink to island', 'New bath exhaust fan',
      'Kitchen cabinets', 'Quartz countertop', 'Tile backsplash', 'Floor tile at bathroom',
    ];
    const lines = [...names, ...names.map((n) => `${n} (second floor)`)].map((name) => ({ name }));
    if (lines.length !== 40) p.push('the probe document is not forty lines');
    let onLines = 0;
    for (const l of lines) {
      const r = w.M.flagLine(l, nyc);
      onLines += r.hits.filter((h) => h.kind === 'building_age' || h.familyId === 'lead_age' || h.familyId === 'asbestos_age').length;
      if (r.kind !== null && r.kind !== 'permit') p.push(`"${l.name}": the line's kind is ${String(r.kind)}`);
      if ('ageNotChecked' in r) p.push('a line result carries the building-age note');
    }
    if (onLines) p.push(`${onLines} building-age flags sit on lines (they belong to the one row)`);
    const age = w.M.flagAge(lines, nyc);
    if (!age.flagged || ids(age) !== 'asbestos_age,lead_age') p.push(`the document row carries ${ids(age) || 'nothing'} (expected lead and asbestos, once each)`);
    if (age.hits.length > 2) p.push(`the document row carries ${age.hits.length} hits`);
    const lead = age.hits.find((h) => h.familyId === 'lead_age');
    if (lead && lead.lineCount !== 26) p.push(`the lead row counts ${lead.lineCount} lines (26 have its words)`);
    for (const h of age.hits) {
      if (h.kind !== 'building_age' || h.yearBuilt !== 1925) p.push(`${h.familyId}: the row lost its kind or its year`);
      if (!h.triggers.length || h.triggers.length > CORE.MAX_TRIGGERS_SHOWN) p.push(`${h.familyId}: ${h.triggers.length} trigger words shown`);
    }
    const chip = stripComments(w.F['components/codeFlags/CodeFlagChip.tsx']);
    if (/ageLabel|ageA11yBody/.test(chip)) p.push('the chip on a line shows the building-age label');
    const row = stripComments(w.F['components/codeFlags/CodeFlagAgeRow.tsx'] ?? '');
    if (!/flagBuildingAge\(lines\.map\(toCodeFlagLine\), ctx\)/.test(row)) p.push('the row does not read the whole list of lines');
    if (!/labels\.ageLabel/.test(row)) p.push('the row does not show the building-age label');
    for (const sc of SCREENS) {
      const n = (stripComments(w.F[sc]).match(/<CodeFlags\.CodeFlagAgeRow\b/g) ?? []).length;
      if (n !== 1) p.push(`${sc} mounts ${n} building-age rows (exactly one)`);
    }
    return p;
  },
  'A13 layout changes are their own family and never say bearing': (w) => {
    const p: string[] = [];
    for (const name of ['Remove non-load-bearing partition', 'Remove non load bearing wall', 'Demo partition walls', 'Frame new partition at bedroom closet', 'Quitar tabique del closet']) {
      if (famOf(w, name) !== 'layout_change') p.push(`"${name}": expected layout_change, got ${famOf(w, name) || 'no flag'}`);
    }
    for (const name of ['Remove the wall', 'Remove load bearing wall between kitchen and dining', 'Remove partition and install LVL beam']) {
      if (famOf(w, name) !== 'structural') p.push(`"${name}": expected structural alone, got ${famOf(w, name) || 'no flag'}`);
    }
    for (const name of ['Temporary dust partition at kitchen', 'Toilet partitions, powder coated', 'Install wall cabinets', 'Paint the wall at stair']) {
      if (famOf(w, name)) p.push(`"${name}" flagged: ${famOf(w, name)}`);
    }
    for (const f of [...w.positives, ...w.negatives]) {
      const r = w.M.flagLine(f.line, ctxOf(w, f.ctx));
      if (r.hits.some((h) => h.familyId === 'structural') && r.hits.some((h) => h.familyId === 'layout_change')) p.push(`"${f.line.name}" carries both the structural and the layout flag`);
    }
    const fam = w.M.families.find((f) => f.id === 'layout_change');
    if (!fam) return [...p, 'no layout_change family'];
    if (fam.confirm !== 'founder_or_expediter') p.push('the layout family no longer says a founder or an expediter still has to confirm it');
    if (w.M.families.some((f) => f.id !== 'layout_change' && f.confirm)) p.push('another family is marked as waiting for confirmation');
    const words = [...fam.triggers, ...fam.es, ...(fam.pairs ?? []).flatMap((x) => [...x.first, ...x.then])];
    if (words.some((t) => /bearing|carga|portante|structur|estructur/.test(t))) p.push('a layout trigger says "bearing" or "structural"');
    for (const [k, v] of [...enStrings(w), ...esStrings(w)]) {
      if (/layoutChange/.test(k) && /bearing|structur|de carga|portante|estructur/i.test(v)) p.push(`${k} says "bearing" or "structural"`);
    }
    const general = w.EN['office.codeFlags.family.layoutChange.why'];
    const city = w.EN['office.codeFlags.family.layoutChange.nycWhy'];
    if (typeof general !== 'string' || /New York/.test(general)) p.push('the general layout sentence names New York City');
    if (typeof city !== 'string' || !/In New York City, changing the layout of rooms commonly involves a filing/.test(city)) p.push('the New York City layout sentence does not say a layout change commonly involves a filing');
    const hook = stripComments(w.F['hooks/useCodeFlagsCopy.ts']);
    if (!/id === 'layout_change' && place === 'nyc' \? layoutNycWhy : familyWhys\[id\]/.test(hook)) p.push('the filing sentence is not kept to New York City');
    return p;
  },
  'B1 the three places resolve, and everything else is other': (w) => {
    const p: string[] = [];
    const want: [string, { city?: string; state?: string; zip?: string; county?: string }, CORE.CodeFlagPlaceId, boolean][] = [
      ['Brooklyn, NY', { city: 'Brooklyn', state: 'NY' }, 'nyc', false],
      ['Astoria, NY', { city: 'Astoria', state: 'NY' }, 'nyc', false],
      ['Baltimore, MD 21201', { city: 'Baltimore', state: 'MD', zip: '21201' }, 'baltimore_city', false],
      ['Towson, MD', { city: 'Towson', state: 'MD' }, 'baltimore_county', false],
      ['Baltimore, MD (no ZIP)', { city: 'Baltimore', state: 'MD' }, 'other', true],
      ['Annapolis, MD', { city: 'Annapolis', state: 'MD' }, 'other', false],
      ['Hoboken, NJ', { city: 'Hoboken', state: 'NJ' }, 'other', false],
      ['Hempstead, NY', { city: 'Hempstead', state: 'NY' }, 'other', false],
      ['Riyadh, Saudi Arabia', { city: 'Riyadh', state: 'Saudi Arabia' }, 'other', false],
      ['Doha, Qatar', { city: 'Doha', state: 'Qatar' }, 'other', false],
      ['Kuwait City, Kuwait', { city: 'Kuwait City', state: 'Kuwait' }, 'other', false],
      ['no address', {}, 'other', false],
    ];
    for (const [label, q, id, unsettled] of want) {
      const got = w.M.resolvePlace(q);
      if (got.id !== id) p.push(`${label}: expected ${id}, got ${got.id}`);
      if (got.unsettledBaltimore !== unsettled) p.push(`${label}: unsettledBaltimore is ${got.unsettledBaltimore}`);
      if (got.id === 'other' && got.name !== null) p.push(`${label}: an "other" place carries the name ${got.name}`);
    }
    if (w.M.resolvePlace(null).hasAddress || w.M.resolvePlace({}).hasAddress) p.push('no address reads as having one');
    return p;
  },
  'B2 no section number and no local link outside the three places': (w) => {
    const p: string[] = [];
    const others: CORE.CodeFlagPlace[] = [
      CORE.NO_PLACE, w.M.resolvePlace({ city: 'Baltimore', state: 'MD' }), w.M.resolvePlace({ city: 'Hoboken', state: 'NJ' }),
      w.M.resolvePlace({ city: 'Riyadh', state: 'Saudi Arabia' }), w.M.resolvePlace({ city: 'Hempstead', state: 'NY' }),
    ];
    for (const place of others) {
      if (place.id !== 'other') { p.push(`a test place resolved to ${place.id}`); continue; }
      for (const f of w.positives) {
        for (const h of hitsOf(w, f.line, { place, yearBuilt: 1931, jobKind: 'residential' })) {
          if (h.local.section) p.push(`"${f.line.name}" carries ${h.local.section.label} with no local place`);
          if (h.local.links.length) p.push(`"${f.line.name}" carries ${h.local.links.length} link(s) with no local place`);
        }
      }
      for (const fam of w.M.families) {
        const refs = w.M.localRefs(place, fam.id, [...fam.triggers]);
        if (refs.section || refs.links.length) p.push(`${fam.id} has local references for an "other" place`);
      }
    }
    return p;
  },
  'B3 every link and section number is in the data the repo already checked': (w) => {
    const p: string[] = [];
    const checked = `${w.F['utils/codeJurisdiction.ts']}\n${w.F['utils/permitPath/packs/sources.ts']}`;
    const sections = new Set<string>();
    for (const id of ['nyc', 'baltimore_city', 'baltimore_county'] as const) {
      const place = w.M.resolvePlace(ADDRESS[id]);
      let links = 0;
      for (const fam of w.M.families) {
        const refs = w.M.localRefs(place, fam.id, [...fam.triggers]);
        links += refs.links.length;
        for (const l of [...refs.links, ...(refs.section ? [refs.section.link] : [])]) {
          if (!/^https:\/\//.test(l.url)) p.push(`${id}/${fam.id}: ${l.url} is not https`);
          if (!checked.includes(`'${l.url}'`)) p.push(`${id}/${fam.id}: ${l.url} is not in the checked data`);
          if (!checked.includes(l.label)) p.push(`${id}/${fam.id}: the label "${l.label}" is not in the checked data`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(l.checkedOn)) p.push(`${id}/${fam.id}: no checked-on day`);
        }
        if (refs.section) {
          sections.add(refs.section.id);
          const meta = CORE.CODE_FLAG_SECTION_LABELS[refs.section.id];
          const row = LOCAL_ADOPTIONS.find((e) => e.name === place.name);
          if (!meta || meta.place !== id) p.push(`${refs.section.label} is shown in ${id}`);
          else if (!row || !(row.notes ?? '').includes(meta.needle)) p.push(`"${meta.needle}" is not in the ${place.name} row`);
          if (refs.section.label !== meta?.label) p.push(`section label "${refs.section.label}" is not the pinned one`);
          if (id === 'nyc') p.push('New York City carries a section number, and none is on file');
          // The County section is about which edition applies: a note, never under the heading.
          if (refs.section.asNote !== (refs.section.id === 'baltimore_county_21_7_303')) p.push(`${refs.section.label}: shown ${refs.section.asNote ? 'as a note' : 'under the Section Number heading'}`);
        }
        if ((fam.id === 'lead_age') && refs.links.length) p.push(`${id}: the lead rule carries a local link`);
      }
      if (!links) p.push(`${id} has no link at all`);
      const quietWord = w.M.localRefs(place, 'structural', ['beam']);
      if (quietWord.section) p.push(`${id}: a beam line carries the underpinning section`);
    }
    if ([...sections].sort().join(',') !== 'baltimore_city_105_1_3,baltimore_county_21_7_303') p.push(`sections shown: ${[...sections].join(', ') || 'none'} (exactly two are on file)`);
    return p;
  },
  'C1 no model call and no network in the feature': (w) => {
    const p: string[] = [];
    const badImport = /from\s+['"][^'"]*(?:\/ai[A-Z/]|aiRelay|aiService|mageAI|gemini|anthropic|openai|lib\/supabase|offlineQueue|construction-answer|react-query)[^'"]*['"]/;
    for (const [f, src] of feature(w)) {
      if (badImport.test(src)) p.push(`${f} imports an AI, network or queue module`);
      if (/\bfetch\s*\(|supabase\.|functions\.invoke|XMLHttpRequest|generateContent/.test(src)) p.push(`${f} makes a network or model call`);
    }
    for (const [f, src] of feature(w, CORE_FILES)) {
      if (/from\s+['"]react(?:-native)?['"]/.test(src)) p.push(`${f} (core) imports React`);
      if (/Math\.random|Date\.now\(\)/.test(src)) p.push(`${f} (core) is not deterministic`);
      if (f !== 'utils/codeFlags/dismissStore.ts' && /new Date\(/.test(src)) p.push(`${f} (core) reads the clock`);
    }
    return p;
  },
  'C2 it never blocks an action': (w) => {
    const p: string[] = [];
    const allowed: readonly RegExp[] = [
      /^import \{ CODE_FLAGS_ENABLED \} from '@\/constants\/featureFlags';$/,
      /^const CodeFlags: typeof import\('@\/components\/codeFlags'\) \| null = CODE_FLAGS_ENABLED \? require\('@\/components\/codeFlags'\) : null;$/,
      /^\{CodeFlags \? <CodeFlags\.CodeFlagsProbe projectId=\{[A-Za-z]+\} \/> : null\}$/,
      /^\{CodeFlags \? <CodeFlags\.CodeFlagAgeRow projectId=\{[A-Za-z]+\} lines=\{[A-Za-z]+\} \/> : null\}$/,
      /^\{CodeFlags \? <CodeFlags\.CodeFlagChip (?:[a-zA-Z]+(?:=\{[^{}]*\})? )+\/> : null\}$/,
      /^\{CodeFlags \? lineItems\.map\(\(item\) => \($/,
      /^<CodeFlags\.CodeFlagChip (?:[a-zA-Z]+(?:=\{[^{}]*\})? )+\/>$/,
    ];
    for (const s of SCREENS) {
      const lines = stripComments(w.F[s]).split('\n').map((l) => l.trim()).filter((l) => /CodeFlag|CODE_FLAGS|codeFlag/.test(l));
      if (!lines.length) p.push(`${s} does not use the feature`);
      for (const l of lines) {
        if (!allowed.some((a) => a.test(l))) p.push(`${s}: an unexpected use of the feature: ${l.slice(0, 120)}`);
        if (/\bon[A-Z][A-Za-z]*=|disabled=|\bref=/.test(l)) p.push(`${s}: the feature is handed a callback or a disabled prop: ${l.slice(0, 120)}`);
      }
      if (!lines.some((l) => /CodeFlagChip/.test(l))) p.push(`${s} shows no chip`);
      if (!lines.some((l) => /CodeFlagsProbe/.test(l))) p.push(`${s} mounts no probe`);
    }
    const chip = stripComments(w.F['components/codeFlags/CodeFlagChip.tsx']);
    const props = /export interface CodeFlagChipProps \{([\s\S]*?)\n\}/.exec(chip)?.[1] ?? '';
    if (!props) p.push('CodeFlagChipProps not found');
    if (/=>|\bon[A-Z]\w*\??:|Function|disabled/.test(props)) p.push('the chip takes a callback or a disabled prop from the screen');
    const rowSrc = stripComments(w.F['components/codeFlags/CodeFlagAgeRow.tsx'] ?? '');
    const rowProps = /export interface CodeFlagAgeRowProps \{([\s\S]*?)\n\}/.exec(rowSrc)?.[1] ?? '';
    if (!rowProps) p.push('CodeFlagAgeRowProps not found');
    if (/=>|\bon[A-Z]\w*\??:|Function|disabled/.test(rowProps)) p.push('the building-age row takes a callback or a disabled prop from the screen');
    if (/disabled\s*[:=]/.test(rowSrc)) p.push('the building-age row disables something');
    const sheet = stripComments(w.F['components/codeFlags/CodeFlagSheet.tsx']);
    if (/disabled\s*[:=]/.test(chip) || /disabled\s*[:=]/.test(sheet)) p.push('the chip or the sheet disables something');
    for (const [f, src] of feature(w, UI_FILES)) {
      if (/updateChangeOrder|addChangeOrder|updateProject|setLineItems|supabaseWrite/.test(src)) p.push(`${f} writes to the line or the project`);
    }
    return p;
  },
  'C3 flag off means no chip and nothing loaded': (w) => {
    const p: string[] = [];
    const flags = stripComments(w.F[FLAG_FILE]);
    if (!/export const CODE_FLAGS_ENABLED\s*=\s*false\s*;/.test(flags)) p.push('CODE_FLAGS_ENABLED is not false');
    for (const s of SCREENS) {
      const src = stripComments(w.F[s]);
      if (/^import[^;]*from\s+['"]@\/(?:components|utils)\/codeFlags[^'"]*['"]/m.test(src) || /^import[^;]*useCodeFlagsCopy/m.test(src)) p.push(`${s} imports the feature statically`);
      if (!/CODE_FLAGS_ENABLED \? require\('@\/components\/codeFlags'\) : null/.test(src)) p.push(`${s} does not load the feature behind the flag`);
      if ((src.match(/require\('@\/components\/codeFlags'\)/g) ?? []).length !== 1) p.push(`${s} loads the feature more than once or not at all`);
    }
    for (const f of ['components/codeFlags/CodeFlagChip.tsx', 'components/codeFlags/CodeFlagAgeRow.tsx', 'components/codeFlags/CodeFlagsProbe.tsx']) {
      const src = stripComments(w.F[f]);
      const body = /export default function \w+\([^)]*\)\s*\{\s*([^\n]*)/.exec(src)?.[1] ?? '';
      if (!/^if \(!CODE_FLAGS_ENABLED\) return null;/.test(body.trim())) p.push(`${f} does not return null first while the flag is off`);
      const exported = /export default function \w+\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? '';
      if (/\buse[A-Z]\w*\(/.test(exported)) p.push(`${f}: the exported component runs a hook before the flag check`);
    }
    // Derived: every file that imports a feature module, outside the feature.
    const importers: string[] = [];
    for (const f of Object.keys(w.F)) {
      if (FEATURE_FILES.includes(f)) continue;
      if (importsOf(w.F, f).some((i) => FEATURE_FILES.includes(i))) importers.push(f);
    }
    const extra = importers.filter((f) => !(SCREENS as readonly string[]).includes(f));
    if (extra.length) p.push(`imported outside the two screens: ${extra.join(', ')}`);
    for (const s of SCREENS) if (!importers.includes(s)) p.push(`${s} does not reach the feature`);
    return p;
  },
  'C4 nothing of a flag reaches a client, a sub or an architect': (w) => {
    const p: string[] = [];
    const reach = closure(w.F, CLIENT_ROOTS);
    for (const r of CLIENT_ROOTS) if (!(r in w.F)) p.push(`client root ${r} is missing`);
    if (reach.size < CLIENT_ROOTS.length + 10) p.push(`the client closure is only ${reach.size} files: the walk is broken`);
    for (const f of reach) {
      if (FEATURE_FILES.includes(f)) p.push(`${f} is reachable from a client-facing builder`);
      if (f.startsWith('i18n/catalog/')) continue;
      if (NAMES_FEATURE.test(stripComments(w.F[f])) && f !== FLAG_FILE) p.push(`${f} (client-facing) names the feature`);
    }
    if (NAMES_FEATURE.test(stripComments(w.F['types/index.ts']))) p.push('types/index.ts carries a flag field');
    for (const [f, src] of Object.entries(w.far)) if (NAMES_FEATURE.test(src) || /office\.codeFlags\./.test(src)) p.push(`${f} names the feature`);
    // The strings: read only by the one copy hook.
    for (const [f, src] of Object.entries(w.F)) {
      if (f === 'hooks/useCodeFlagsCopy.ts' || f.startsWith('i18n/')) continue;
      if (/office\.codeFlags\./.test(stripComments(src))) p.push(`${f} reads a Code Flags string`);
    }
    const importers = Object.keys(w.F).filter((f) => importsOf(w.F, f).includes('hooks/useCodeFlagsCopy.ts'));
    const badCopy = importers.filter((f) => !f.startsWith('components/codeFlags/'));
    if (badCopy.length) p.push(`the copy hook is imported by ${badCopy.join(', ')}`);
    // The screens never put a flag into what they save, send or print.
    for (const s of SCREENS) {
      const src = stripComments(w.F[s]);
      if (/flagLine\(|hitFamilyIds\(|codeFlagLocalRefs\(/.test(src)) p.push(`${s} computes a flag itself`);
    }
    // The line the matcher is handed comes back untouched (no field added).
    const line = { id: 'coli_1', name: 'Add subpanel', description: '', quantity: 1, unit: 'ea', unitPrice: 10, total: 10, isNew: true };
    const before = JSON.stringify(line);
    w.M.flagLine(line, CORE.DEFAULT_CODE_FLAG_CONTEXT);
    if (JSON.stringify(line) !== before) p.push('the matcher wrote onto the change order line');
    return p;
  },
  'C5 the hidden-flag memory is one owned key on this device': (w) => {
    const p: string[] = [];
    const key = w.M.dismissKey;
    if (!key.startsWith('mageid_')) p.push(`the key ${key} is not under mageid_`);
    if (!APP_STORAGE_PREFIXES.some((x) => key.startsWith(x))) p.push(`the key ${key} is not under an app-owned prefix`);
    for (const [f, src] of feature(w)) {
      const usesStorage = /AsyncStorage/.test(src);
      if (usesStorage && f !== 'utils/codeFlags/dismissStore.ts') p.push(`${f} touches AsyncStorage`);
      if (/localStorage|SecureStore|AsyncStorage\.clear/.test(src)) p.push(`${f} uses another store`);
    }
    const store = stripComments(w.F['utils/codeFlags/dismissStore.ts']);
    const keys = store.match(/AsyncStorage\.(?:getItem|setItem|removeItem)\(([^,)]+)/g) ?? [];
    if (keys.length < 2 || keys.some((k) => !/CODE_FLAG_DISMISS_KEY$/.test(k.trim()))) p.push('the dismiss store reads or writes a key other than CODE_FLAG_DISMISS_KEY');
    for (const [f, src] of Object.entries(w.F)) {
      if (FEATURE_FILES.includes(f)) continue;
      if (stripComments(src).includes(key)) p.push(`${f} names the dismiss key`);
    }
    const mine = CORE.withDismissal(CORE.emptyDismissRecord('user-a'), 'p:1', 'line-1', ['plumbing'], '2026-10-06T00:00:00.000Z');
    const raw = JSON.stringify(mine);
    if (!w.M.isDismissed(w.M.parseDismiss(raw, 'user-a'), 'p:1', 'line-1', ['plumbing'])) p.push('his own hidden flag is not remembered');
    if (w.M.isDismissed(w.M.parseDismiss(raw, 'user-b'), 'p:1', 'line-1', ['plumbing'])) p.push('another account reads his hidden flag');
    if (w.M.isDismissed(w.M.parseDismiss(raw, 'user-a'), 'p:1', 'line-1', ['plumbing', 'gas'])) p.push('a hidden flag stays hidden after the line changed to a new kind of work');
    if (w.M.isDismissed(w.M.parseDismiss(raw, 'user-a'), 'p:2', 'line-1', ['plumbing'])) p.push('a hidden flag leaks to another project');
    if (w.M.isDismissed(w.M.parseDismiss(raw, 'user-a'), 'p:1', 'line-1', [])) p.push('an unflagged line reads as hidden');
    // No project, no memory: an estimate that is not on a project keys its lines
    // by catalog material id, so one shared scope would hide a flag on every
    // later estimate.
    for (const none of [null, undefined, '', '   '] as const) if (w.M.dismissScope(none) !== '') p.push(`no project gives the scope "${w.M.dismissScope(none)}"`);
    if (w.M.dismissScope('abc') !== 'p:abc') p.push('a project no longer gives its own scope');
    const start = CORE.emptyDismissRecord('user-a');
    for (const scope of ['', 'cart', 'p:']) {
      const next = w.M.withDismissal(start, scope, '200-amp-panel', ['electrical_service'], '2026-10-08T00:00:00.000Z');
      if (Object.keys(next.lines).length) p.push(`a hidden flag was stored under the scope "${scope}"`);
      if (w.M.isDismissed({ ...start, lines: { [scope]: { '200-amp-panel': { families: ['electrical_service'], at: '' } } } }, scope, '200-amp-panel', ['electrical_service'])) p.push(`a flag reads as hidden under the scope "${scope}"`);
    }
    const legacy = JSON.stringify({ v: CORE.CODE_FLAG_DISMISS_VERSION, account: 'user-a', lines: { cart: { 'mat-1': { families: ['gas'], at: '' } }, 'p:1': { 'line-1': { families: ['gas'], at: '' } } } });
    if (Object.keys(w.M.parseDismiss(legacy, 'user-a').lines).join() !== 'p:1') p.push('a stored record keeps a scope that has no project');
    const chipSrc = stripComments(w.F['components/codeFlags/CodeFlagChip.tsx']);
    if (!/if \(isStorableScope\(scope\)\) void dismissLine\(scope, lineKey, families\);\s*else setHiddenHere\(true\);/.test(chipSrc)) p.push('the chip stores a hidden flag for a line with no project');
    for (const bad of ['', 'not json', '[]', '{"v":99}', 'null']) {
      try { if (Object.keys(w.M.parseDismiss(bad, 'user-a').lines).length) p.push(`unreadable storage "${bad}" produced hidden flags`); }
      catch { p.push(`unreadable storage "${bad}" threw`); }
    }
    return p;
  },
  'D1 the banned words are in neither language': (w) => {
    const p: string[] = [];
    for (const [k, v] of enStrings(w)) for (const re of BANNED_EN) if (re.test(v)) p.push(`English ${k}: ${re.source}`);
    for (const [k, v] of esStrings(w)) for (const re of BANNED_ES) if (re.test(v)) p.push(`Spanish ${k}: ${re.source}`);
    for (const [f, src] of feature(w, UI_FILES)) {
      const literals = src.match(/>[^<>{}]*[A-Za-z]{4,}[^<>{}]*</g) ?? [];
      for (const l of literals) for (const re of BANNED_EN) if (re.test(l)) p.push(`${f}: raw text ${l.trim().slice(0, 60)}`);
    }
    return p;
  },
  'D2 the sheet says what a flag is not': (w) => {
    const p: string[] = [];
    const need: [string, RegExp, RegExp][] = [
      ['office.codeFlags.sheet.noFlagBody', /no flag can still need a permit or an inspection\. No flag means nothing\./i, /sin aviso todavía puede necesitar un permiso o una inspección\. Que no haya aviso no significa nada\./i],
      ['office.codeFlags.sheet.neverBlocksBody', /never stops you from saving, sending, signing or billing/i, /nunca te impide guardar, enviar, firmar ni facturar/i],
      ['office.codeFlags.sheet.privateBody', /^This flag is not on anything you send\.$/, /^Este aviso no aparece en nada de lo que envías\.$/],
      ['office.codeFlags.place.otherBody', /no local rules for this place.*no section number and no local link/i, /no tiene reglas locales para este lugar.*sin número de sección y sin enlace local/i],
      ['office.codeFlags.sheet.introBody', /You decide what to do\./, /Tú decides qué hacer\./],
    ];
    for (const [key, en, es] of need) {
      const e = w.EN[key];
      const s = w.ES[key]?.s;
      if (typeof e !== 'string' || !en.test(e)) p.push(`English ${key} does not say it`);
      if (typeof s !== 'string' || !es.test(s)) p.push(`Spanish ${key} does not say it`);
    }
    const sheet = stripComments(w.F['components/codeFlags/CodeFlagSheet.tsx']);
    for (const field of ['noFlagBody', 'neverBlocksBody', 'privateBody', 'starterBody', 'standingNoteBody', 'introBody', 'placeBody(', 'askBody', 'hideBody(']) {
      if (!new RegExp(`\\{copy\\.${field.replace('(', '\\(')}`).test(sheet)) p.push(`the sheet does not show ${field}`);
    }
    const noFlagLine = sheet.split('\n').find((l) => l.includes('{copy.noFlagBody}')) ?? '';
    if (!noFlagLine.trim().startsWith('<Text')) p.push('the no-flag sentence is shown only sometimes');
    return p;
  },
  'D3 every sentence is in our own words and short': (w) => {
    const p: string[] = [];
    for (const [k, v] of [...enStrings(w), ...esStrings(w)]) {
      const text = v.replace(/\{[a-zA-Z]+\}/g, 'x');
      if (/["“”«»]/.test(v)) p.push(`${k} carries a quotation mark`);
      if (!passesProseCheck(text)) p.push(`${k} would be withheld by the own-words gate`);
      if (longestRun(text) > 30) p.push(`${k} has a run of ${longestRun(text)} words with no sentence break`);
      if (/§|\b\d{3,4}\.\d/.test(v)) p.push(`${k} writes a section number into the words (they come from the checked data)`);
    }
    for (const [f, src] of feature(w, CORE_FILES)) {
      if (f === 'utils/codeFlags/place.ts' || f === 'utils/codeFlags/fixtures.ts') continue;
      if (/§/.test(src)) p.push(`${f} holds a section number`);
    }
    return p;
  },
  'D4 English and Spanish agree': (w) => {
    const p: string[] = [];
    const en = Object.keys(w.EN).sort();
    const es = Object.keys(w.ES).filter((k) => w.ES[k]).sort();
    for (const k of en) if (!es.includes(k)) p.push(`no Spanish for ${k}`);
    for (const k of es) if (!en.includes(k)) p.push(`Spanish for a key that is gone: ${k}`);
    for (const k of en) {
      const e = w.EN[k];
      const s = w.ES[k];
      if (!s) continue;
      if (typeof e !== 'string' || typeof s.s !== 'string') { p.push(`${k} is not a plain string in both`); continue; }
      if (placeholders(e) !== placeholders(s.s)) p.push(`${k}: placeholders differ`);
      if (s.src !== sourceHash(e)) p.push(`${k}: the Spanish was written for other English`);
      if (!s.s.trim()) p.push(`${k}: empty Spanish`);
    }
    if (en.some((k) => !k.startsWith('office.codeFlags.'))) p.push('a key is outside office.codeFlags.');
    const surface = SURFACES.find((s) => s.id === 'office.code-flags');
    if (!surface || surface.state !== 'complete' || surface.files.join() !== 'hooks/useCodeFlagsCopy.ts') p.push('the i18n surface office.code-flags is not registered complete on the one copy hook');
    if (en.length < 50) p.push(`only ${en.length} keys`);
    return p;
  },
  'D5 house style': (w) => {
    const p: string[] = [];
    for (const [k, v] of enStrings(w)) {
      if (/[—–]|&|\be\.g\.|\bi\.e\.|→|->|=>|!/.test(v)) p.push(`${k}: a dash, an ampersand, an e.g., an arrow or an exclamation mark`);
      if (/Label$/.test(k)) {
        if (!isTitleCase(v)) p.push(`${k}: "${v}" is not in Title Case`);
        if (/[.!?]$/.test(v)) p.push(`${k}: a label ends with punctuation`);
      } else if (/(Body|why)$/i.test(k)) {
        if (!/[.]$/.test(v)) p.push(`${k}: a sentence does not end with a period`);
        if (!/^(\{[a-z]+\}|[A-Z])/.test(v)) p.push(`${k}: a sentence does not start with a capital`);
      } else if (/Sub$/.test(k)) {
        if (/[.]$/.test(v)) p.push(`${k}: a caption ends with a period`);
      } else p.push(`${k}: the key does not say whether it is a Label, a Body, a Sub or a why`);
    }
    for (const [k, v] of esStrings(w)) if (/[—–]|&|→|->|!|¡/.test(v)) p.push(`Spanish ${k}: a dash, an ampersand, an arrow or an exclamation mark`);
    // Every string is used: a key the copy hook defines and no component reads is dead weight.
    const hookSrc = stripComments(w.F['hooks/useCodeFlagsCopy.ts']);
    const uiSrc = UI_FILES.filter((f) => f !== 'hooks/useCodeFlagsCopy.ts').map((f) => stripComments(w.F[f] ?? '')).join('\n');
    const iface = /export interface CodeFlagsCopy \{([\s\S]*?)\n\}/.exec(hookSrc)?.[1] ?? '';
    for (const m of iface.matchAll(/^\s*([a-zA-Z0-9]+)\??:/gm)) if (!new RegExp(`copy\\.${m[1]}\\b`).test(uiSrc)) p.push(`the copy hook defines ${m[1]}, and nothing shows it`);
    if (w.EN['office.codeFlags.chip.permitLabel'] !== 'May Need a Permit Amendment or an Inspection') p.push('the chip does not say "May Need a Permit Amendment or an Inspection"');
    if (w.EN['office.codeFlags.sheet.standingNoteBody'] !== CODE_RESULT_NOTE) p.push("the standing line is not the app's CODE_RESULT_NOTE");
    return p;
  },
  'D6 the sheet shows the words that triggered the flag': (w) => {
    const p: string[] = [];
    const sheet = stripComments(w.F['components/codeFlags/CodeFlagSheet.tsx']);
    if (!/copy\.triggerBody\(hit\.triggers, categoryName\)/.test(sheet)) p.push('the sheet does not print the triggers');
    if (!/hit\.local\.section \? copy\.sectionBody\(hit\.local\.section\.id, hit\.local\.section\.label\) : copy\.noSectionBody/.test(sheet)) p.push('the sheet does not print the section, or the plain line that there is none');
    if (!/hit\.local\.links\.map/.test(sheet)) p.push('the sheet does not list the official sources');
    if (!/\{hit\.local\.section\?\.asNote \? null : <Text[^>]*>\{copy\.sectionHeadingLabel\}<\/Text>\}/.test(sheet)) p.push('a background section is shown under the Section Number heading');
    if (!/copy\.docTriggerBody\(hit\.triggers, hit\.lineCount \?\? 0\)/.test(sheet)) p.push('the building-age sheet does not print its words and its line count');
    const county = w.EN['office.codeFlags.section.baltimoreCountyElectricalBody'];
    if (typeof county !== 'string' || !/^\{label\} sets when /.test(county)) p.push('the Baltimore County section is not written as one plain sentence');
    const words = w.EN['office.codeFlags.trigger.wordsBody'];
    if (typeof words !== 'string' || !words.includes('{words}')) p.push('the trigger sentence has no place for the words');
    for (const f of w.positives) {
      for (const h of hitsOf(w, f.line, ctxOf(w, f.ctx))) {
        const fam = w.M.families.find((x) => x.id === h.familyId);
        for (const t of h.triggers) {
          if (t.via === 'permit_flag') continue;
          const text = `${f.line.name} | ${f.line.description ?? ''}`;
          if (t.via === 'pair') {
            const [verb, noun] = t.pair ?? ['', ''];
            if (!fam?.pairs?.some((x) => x.first.includes(verb) && x.then.includes(noun))) p.push(`"${f.line.name}": the shown pair "${t.phrase}" is not in the ${h.familyId} table`);
            if (!onLine(text, verb) || !onLine(text, noun)) p.push(`"${f.line.name}": the shown pair "${t.phrase}" is not on the line`);
            if (t.phrase !== `${verb}, ${noun}`) p.push(`"${f.line.name}": the pair is shown as "${t.phrase}"`);
            continue;
          }
          const inTable = t.via === 'words' ? (fam?.triggers.includes(t.phrase) || fam?.es.includes(t.phrase)) : fam?.categoryTriggers?.some((c) => c.phrases.includes(t.phrase));
          if (!inTable) p.push(`"${f.line.name}": the shown trigger "${t.phrase}" is not in the ${h.familyId} table`);
          if (!onLine(text, t.phrase)) p.push(`"${f.line.name}": the shown trigger "${t.phrase}" is not on the line`);
        }
      }
    }
    return p;
  },
  'E1 a quiet chip: no reanimated, Lucide only, no warning, accent never a background': (w) => {
    const p: string[] = [];
    for (const [f, src] of feature(w, UI_FILES)) {
      if (/react-native-reanimated/.test(src)) p.push(`${f} imports react-native-reanimated`);
      if (/@expo\/vector-icons/.test(src)) p.push(`${f} uses an icon set other than Lucide`);
      if (/AlertTriangle|TriangleAlert|AlertOctagon|ShieldAlert|OctagonAlert|\bSiren\b/.test(src)) p.push(`${f} uses a warning icon`);
      if (/\b(?:danger|error|warning|red)\b\s*[,;)}]|t\.(?:danger|error|warning)|colors\.(?:danger|error|warning)/.test(src)) p.push(`${f} uses a danger or warning colour`);
      if (/backgroundColor:\s*(?:t|colors|Colors)\.(?:accent|primary)\b/.test(src)) p.push(`${f} uses the accent as a background`);
      if (/#[0-9a-fA-F]{3,8}\b/.test(src)) p.push(`${f} hard-codes a colour`);
    }
    const chip = stripComments(w.F['components/codeFlags/CodeFlagChip.tsx']);
    if (!/from 'lucide-react-native'/.test(chip)) p.push('the chip has no Lucide icon');
    const sheet = stripComments(w.F['components/codeFlags/CodeFlagSheet.tsx']);
    if (!/import \{ Sheet \} from '@\/components\/ui\/Sheet'/.test(sheet)) p.push("the sheet is not the app's Sheet");
    return p;
  },
  'E2 the chip is on every plan and the detail goes to Code Check': (w) => {
    const p: string[] = [];
    for (const [f, src] of feature(w)) if (/useTierAccess|canAccess|requireTier|SubscriptionContext/.test(src)) p.push(`${f} checks the plan (the chip is for every plan)`);
    const sheet = stripComments(w.F['components/codeFlags/CodeFlagSheet.tsx']);
    if (!/codeCheckFromJobHref\(projectId\)/.test(sheet) || !/'\/\(tabs\)\/construction-ai'/.test(sheet)) p.push('the sheet does not open Code Check');
    const cc = w.F['app/(tabs)/construction-ai/index.tsx'] ?? '';
    if (!/canAccess\('ai_code_check'\)/.test(cc) || !/ensureCodeAck\(\)/.test(cc)) p.push('Code Check no longer carries its own plan gate and one-time notice');
    return p;
  },
  'E3 cost and reach': (w) => {
    const p: string[] = [];
    const match = stripComments(w.F['utils/codeFlags/match.ts']);
    if (!/^const COMPILED: readonly CompiledFamily\[\] = CODE_FLAG_FAMILIES\.map\(compile\);$/m.test(match)) p.push('the rule phrases are not split once at module load');
    const fnBodies = match.slice(match.indexOf('// ── reading a line'));
    if (/phraseTokens\(/.test(fnBodies)) p.push('a rule phrase is split into words while a line is read');
    const chip = stripComments(w.F['components/codeFlags/CodeFlagChip.tsx']);
    const row = stripComments(w.F['components/codeFlags/CodeFlagAgeRow.tsx'] ?? '');
    const sheet = stripComments(w.F['components/codeFlags/CodeFlagSheet.tsx']);
    for (const [name, src] of [['the chip', chip], ['the building-age row', row]] as const) {
      if (/useCodeFlagsCopy\(/.test(src)) p.push(`${name} builds the whole sheet's copy`);
      if (!/useCodeFlagChipLabels\(\)/.test(src)) p.push(`${name} does not read the shared labels`);
      if (!/hitSlop=\{10\}/.test(src)) p.push(`${name} has no hit slop`);
      if (!/\{open \? \(\s*<CodeFlagSheet/.test(src)) p.push(`${name} mounts the sheet while it is closed`);
    }
    if (!/const copy = useCodeFlagsCopy\(\);/.test(sheet)) p.push('the sheet does not build its own copy');
    const hook = stripComments(w.F['hooks/useCodeFlagsCopy.ts']);
    if (!/const LABELS = new Map<string, CodeFlagChipLabels>\(\);/.test(hook) || !/LABELS\.get\(displayLang\)/.test(hook)) p.push('the chip labels are rebuilt for every chip');
    if (/ScrollView/.test(sheet)) p.push("the sheet nests a scroll view inside Sheet's own");
    const headers = (sheet.match(/accessibilityRole="header"/g) ?? []).length;
    if (headers < 5) p.push(`only ${headers} headings in the sheet are marked as headers (the family name and four section headings)`);
    if (!/style=\{styles\.familyName\} accessibilityRole="header"/.test(sheet)) p.push('the family name is not a header');
    if (/<Text style=\{styles\.heading\}>/.test(sheet)) p.push('a section heading is not marked as a header');
    // A generous ceiling, far above the measured time: it only catches a return to per-line phrase scans.
    const lines = Array.from({ length: 300 }, (_, i) => ({ name: `${w.positives[i % w.positives.length].line.name} ${i}`, description: 'per plan, furnish and install' }));
    // The best of three, so a busy machine does not turn the rule red.
    let ms = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      for (const l of lines) w.M.flagLine(l);
      ms = Math.min(ms, performance.now() - t0);
    }
    if (ms > 60) p.push(`300 lines took ${ms.toFixed(0)} ms (the compiled table runs them in well under 20)`);
    return p;
  },
};

// ── run ──────────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
console.log('validate-code-flags\n');
for (const [id, rule] of Object.entries(RULES)) {
  let problems: string[];
  try { problems = rule(REAL); } catch (e) { problems = [`threw ${e instanceof Error ? e.message : String(e)}`]; }
  if (problems.length === 0) { pass += 1; console.log(`  ✓ ${id}`); }
  else { fail += 1; console.log(`  ✗ ${id}`); for (const x of problems.slice(0, 12)) console.log(`      ${x}`); if (problems.length > 12) console.log(`      … and ${problems.length - 12} more`); }
}

// ── planted mutations ────────────────────────────────────────────────────────
interface Mutation { rule: string; what: string; plant: (w: World) => World }
const mods = (over: Partial<Mods>) => (w: World): World => ({ ...w, M: { ...w.M, ...over } });
function text(file: string, from: string | RegExp, to: string) {
  return (w: World): World => {
    const s = w.F[file];
    if (s === undefined) throw new Error(`no such file ${file}`);
    const next = s.replace(from as never, to);
    if (next === s) throw new Error(`mutation anchor not found in ${file}: ${String(from)}`);
    return { ...w, F: { ...w.F, [file]: next } };
  };
}
const append = (file: string, add: string) => (w: World): World => {
  if (!(file in w.F)) throw new Error(`no such file ${file}`);
  return { ...w, F: { ...w.F, [file]: `${w.F[file]}\n${add}\n` } };
};
const far = (add: string) => (w: World): World => {
  const first = Object.keys(w.far)[0];
  if (!first) throw new Error('no far file');
  return { ...w, far: { ...w.far, [first]: w.far[first] + add } };
};
const en = (key: string, value: unknown) => (w: World): World => {
  if (!(key in w.EN)) throw new Error(`mutation key not found: ${key}`);
  return { ...w, EN: { ...w.EN, [key]: value } };
};
const es = (key: string, value: { s: unknown; src: string } | undefined) => (w: World): World => {
  const next = { ...w.ES };
  if (value === undefined) delete next[key]; else next[key] = value;
  return { ...w, ES: next };
};
const esText = (key: string, fn: (s: string) => string) => (w: World): World => {
  const cur = w.ES[key];
  if (!cur || typeof cur.s !== 'string') throw new Error(`no Spanish ${key}`);
  return { ...w, ES: { ...w.ES, [key]: { ...cur, s: fn(cur.s) } } };
};
/** A family table with one family edited. */
const family = (id: CORE.CodeFlagFamilyId, fn: (f: CORE.CodeFlagFamily) => CORE.CodeFlagFamily) => (w: World): World => {
  const families = w.M.families.map((f) => (f.id === id ? fn(f) : f));
  return { ...w, M: { ...w.M, families } };
};
/** A matcher that answers from a wrapped result. */
const wrapFlag = (fn: (r: CORE.CodeFlagLineResult, line: CORE.CodeFlagLine | null | undefined, ctx: CORE.CodeFlagContext) => CORE.CodeFlagLineResult) =>
  mods({ flagLine: (line, ctx = CORE.DEFAULT_CODE_FLAG_CONTEXT) => fn(CORE.flagLine(line, ctx), line, ctx) });
const fakeHit = (familyId: CORE.CodeFlagFamilyId, phrase: string, place: CORE.CodeFlagPlace): CORE.CodeFlagHit => ({
  familyId, kind: 'permit', triggers: [{ via: 'words', phrase, field: 'name' }], local: CORE.codeFlagLocalRefs(place, familyId, [phrase]),
});
const withHit = (r: CORE.CodeFlagLineResult, h: CORE.CodeFlagHit): CORE.CodeFlagLineResult => ({ ...r, flagged: true, kind: 'permit', hits: [...r.hits, h] });
const nameHas = (line: CORE.CodeFlagLine | null | undefined, re: RegExp) => !!line && re.test(line.name ?? '');
/** A building-age check that answers from a wrapped result. */
const wrapAge = (fn: (r: CORE.CodeFlagAgeResult, lines: readonly (CORE.CodeFlagLine | null | undefined)[], ctx: CORE.CodeFlagContext) => CORE.CodeFlagAgeResult) =>
  mods({ flagAge: (lines, ctx = CORE.DEFAULT_CODE_FLAG_CONTEXT) => fn(CORE.flagBuildingAge(lines, ctx), lines ?? [], ctx) });
const anyName = (lines: readonly (CORE.CodeFlagLine | null | undefined)[], re: RegExp) => lines.some((l) => nameHas(l, re));
const ageHit = (familyId: 'lead_age' | 'asbestos_age', phrase: string): CORE.CodeFlagHit => ({
  familyId, kind: 'building_age', triggers: [{ via: 'words', phrase, field: 'name' }], local: { links: [], section: null }, lineCount: 1,
});
const withAge = (r: CORE.CodeFlagAgeResult, h: CORE.CodeFlagHit): CORE.CodeFlagAgeResult => ({ ...r, flagged: true, hits: [...r.hits, h] });
const noHits = (r: CORE.CodeFlagLineResult): CORE.CodeFlagLineResult => ({ ...r, flagged: false, kind: null, hits: [] });
const ROW = 'components/codeFlags/CodeFlagAgeRow.tsx';
const HOOK = 'hooks/useCodeFlagsCopy.ts';
const CO = 'app/change-order.tsx';
const EST = 'app/(tabs)/estimate/full.tsx';
const CHIP = 'components/codeFlags/CodeFlagChip.tsx';
const SHEET = 'components/codeFlags/CodeFlagSheet.tsx';
const NYC_LINK = { label: 'NYC DOB · Do I need a permit?', url: 'https://www.nyc.gov/site/buildings/property-or-business-owner/do-i-need-a-permit.page', checkedOn: '2026-10-02' };

const MUTATIONS: Mutation[] = [
  { rule: 'A1', what: 'the matcher misses a subpanel', plant: wrapFlag((r, l) => (nameHas(l, /subpanel/i) ? { ...r, flagged: false, kind: null, hits: [] } : r)) },
  { rule: 'A1', what: 'a gas line also reads as plumbing', plant: wrapFlag((r, l, c) => (nameHas(l, /gas line/i) ? withHit(r, fakeHit('plumbing', 'gas line', c.place)) : r)) },
  { rule: 'A1', what: 'the positives are cut to 40', plant: (w) => ({ ...w, positives: w.positives.slice(0, 40) }) },
  { rule: 'A2', what: '"fire pit" reads as fire rating', plant: wrapFlag((r, l, c) => (nameHas(l, /fire pit/i) ? withHit(r, fakeHit('fire_rating', 'fire', c.place)) : r)) },
  { rule: 'A2', what: '"exit interview" reads as egress', plant: wrapFlag((r, l, c) => (nameHas(l, /exit interview/i) ? withHit(r, fakeHit('egress', 'exit', c.place)) : r)) },
  { rule: 'A2', what: '"panel door" reads as an electrical panel', plant: wrapFlag((r, l, c) => (nameHas(l, /panel door/i) ? withHit(r, fakeHit('electrical_service', 'panel', c.place)) : r)) },
  { rule: 'A2', what: 'a room name alone flags a line', plant: wrapFlag((r, l, c) => (nameHas(l, /kitchen cabinets/i) ? withHit(r, fakeHit('electrical_service', 'kitchen', c.place)) : r)) },
  { rule: 'A2', what: 'the negatives are cut to 30', plant: (w) => ({ ...w, negatives: w.negatives.slice(0, 30) }) },
  { rule: 'A3', what: 'a quiet line fires its own family', plant: wrapFlag((r, l, c) => (nameHas(l, /^lawn sprinkler system$/i) ? withHit(r, fakeHit('fire_protection', 'sprinkler system', c.place)) : r)) },
  { rule: 'A3', what: 'a family lists no quiet line', plant: family('gas', (f) => ({ ...f, quiet: [] })) },
  { rule: 'A4', what: 'the matcher writes a flag onto the line', plant: mods({ flagLine: (line, ctx) => { const r = CORE.flagLine(line, ctx); try { (line as unknown as Record<string, unknown>).codeFlag = r.flagged; } catch { throw new Error('wrote to a frozen line'); } return r; } }) },
  { rule: 'A4', what: 'a result carries a "blocksSend" field', plant: wrapFlag((r) => ({ ...r, blocksSend: true } as CORE.CodeFlagLineResult)) },
  { rule: 'A4', what: 'an empty line is flagged', plant: mods({ flagLine: (line, ctx) => (line && (line.name ?? '').trim() ? CORE.flagLine(line, ctx) : { ...CORE.flagLine({ name: 'add subpanel' }, ctx) }) }) },
  { rule: 'A5', what: 'the lead words drift from the existing rule', plant: family('lead_age', (f) => ({ ...f, triggers: [...f.triggers, 'caulk'] })) },
  { rule: 'A5', what: 'a reused phrase is dropped', plant: family('gas', (f) => ({ ...f, triggers: f.triggers.filter((t) => t !== 'gas line') })) },
  { rule: 'A5', what: 'no family sits under the energy code', plant: family('energy_tests', (f) => ({ ...f, books: [] })) },
  { rule: 'A5', what: 'the flag is turned on before the founder reviewed the list', plant: text(FLAG_FILE, 'export const CODE_FLAGS_ENABLED = false;', 'export const CODE_FLAGS_ENABLED = true;') },
  { rule: 'A6', what: 'lead fires with no year on file', plant: wrapAge((r, l, c) => (c.yearBuilt == null && anyName(l, /windows/i) ? withAge(r, ageHit('lead_age', 'windows')) : r)) },
  { rule: 'A6', what: 'asbestos fires in Baltimore', plant: wrapAge((r, l, c) => (c.place.id === 'baltimore_city' && anyName(l, /demo/i) ? withAge(r, ageHit('asbestos_age', 'demo')) : r)) },
  { rule: 'A6', what: 'lead fires for a building from 1978', plant: wrapAge((r, l, c) => (c.yearBuilt === 1978 && anyName(l, /windows/i) ? withAge(r, ageHit('lead_age', 'windows')) : r)) },
  { rule: 'A6', what: 'a document with no such words says the year is missing', plant: wrapAge((r, _l, c) => (c.yearBuilt == null ? { ...r, ageNotChecked: true } : r)) },
  { rule: 'A7', what: 'the verb and the noun must be side by side again', plant: wrapFlag((r, l) => (nameHas(l, /the kitchen wall|front steps|cast iron stack/i) ? noHits(r) : r)) },
  { rule: 'A7', what: 'the window is widened to four words', plant: wrapFlag((r, l, c) => (nameHas(l, /three four wall/i) ? withHit(r, fakeHit('structural', 'remove, wall', c.place)) : r)) },
  { rule: 'A7', what: '"and" no longer ends the reach', plant: wrapFlag((r, l, c) => (nameHas(l, /cabinets and patch wall/i) ? withHit(r, fakeHit('structural', 'remove, wall', c.place)) : r)) },
  { rule: 'A7', what: '"wall tile" reads as a wall', plant: wrapFlag((r, l, c) => (nameHas(l, /^Remove wall tile/i) ? withHit(r, fakeHit('structural', 'remove, wall', c.place)) : r)) },
  { rule: 'A7', what: 'the pair trigger loses its two words', plant: wrapFlag((r) => ({ ...r, hits: r.hits.map((h) => ({ ...h, triggers: h.triggers.map((t) => (t.via === 'pair' ? { ...t, pair: undefined } : t)) })) })) },
  { rule: 'A8', what: 'only a bare "s" is a plural again', plant: wrapFlag((r, l) => (nameHas(l, /trusses|porches|balconies/i) ? noHits(r) : r)) },
  { rule: 'A8', what: 'any word that starts with the phrase counts', plant: mods({ isFormOf: (t, b) => t.startsWith(b) }) },
  { rule: 'A8', what: '"wallpaper" reads as a wall', plant: wrapFlag((r, l, c) => (nameHas(l, /wallpaper/i) ? withHit(r, fakeHit('structural', 'remove, wall', c.place)) : r)) },
  { rule: 'A9', what: '"No structural work" flags', plant: wrapFlag((r, l, c) => (nameHas(l, /^No structural work$/i) ? withHit(r, fakeHit('structural', 'structural', c.place)) : r)) },
  { rule: 'A9', what: '"by others" silences the line', plant: wrapFlag((r, l) => (nameHas(l, /by others/i) ? noHits(r) : r)) },
  { rule: 'A9', what: 'a "no" anywhere on the line silences it', plant: wrapFlag((r, l) => (nameHas(l, /\bno\b/i) ? noHits(r) : r)) },
  { rule: 'A9', what: 'the Spanish negation is not read', plant: wrapFlag((r, l, c) => (nameHas(l, /^Sin trabajo estructural$/i) ? withHit(r, fakeHit('structural', 'estructural', c.place)) : r)) },
  { rule: 'A10', what: 'accents are dropped, not folded', plant: mods({ tokenize: (x) => normalizeScopeText(x ?? '').split(/[ /]+/).filter(Boolean) }) },
  { rule: 'A10', what: 'a phrase typed with no accent is missed', plant: wrapFlag((r, l) => (nameHas(l, /linea de gas|panel electrico/i) ? noHits(r) : r)) },
  { rule: 'A10', what: 'the matcher reads through the shared normalizer again', plant: append('utils/codeFlags/match.ts', "import { normalizeScopeText } from '@/utils/scopeCoverage';\nexport const n = normalizeScopeText('x');") },
  { rule: 'A11', what: '"garden" or "yard" anywhere silences sprinkler work', plant: wrapFlag((r, l) => (nameHas(l, /garden|yard|lawn|drip/i) ? { ...r, hits: r.hits.filter((h) => h.familyId !== 'fire_protection'), flagged: r.hits.some((h) => h.familyId !== 'fire_protection') } : r)) },
  { rule: 'A11', what: 'a lawn sprinkler reads as a fire sprinkler', plant: wrapFlag((r, l, c) => (nameHas(l, /^Lawn sprinkler system/i) ? withHit(r, fakeHit('fire_protection', 'sprinkler system', c.place)) : r)) },
  { rule: 'A11', what: 'the rule table grows a veto field', plant: append('utils/codeFlags/rules.ts', 'export interface WithVeto { veto?: readonly string[] }') },
  { rule: 'A12', what: 'the lead flag is a chip on every painted line again', plant: wrapFlag((r, l, c) => (c.yearBuilt != null && c.yearBuilt < 1978 && nameHas(l, /paint|door|window|trim/i) ? { ...r, flagged: true, hits: [...r.hits, ageHit('lead_age', 'paint')] } : r)) },
  { rule: 'A12', what: 'the row repeats a family for every line', plant: wrapAge((r) => ({ ...r, hits: [...r.hits, ...r.hits] })) },
  { rule: 'A12', what: 'the row counts the wrong number of lines', plant: wrapAge((r) => ({ ...r, hits: r.hits.map((h) => ({ ...h, lineCount: 1 })) })) },
  { rule: 'A12', what: 'the change order screen mounts the row twice', plant: append(CO, '{CodeFlags ? <CodeFlags.CodeFlagAgeRow projectId={projectId} lines={lineItems} /> : null}') },
  { rule: 'A12', what: 'the chip on a line shows the building-age label', plant: append(CHIP, 'const second = (l: { ageLabel: string }) => l.ageLabel;') },
  { rule: 'A12', what: 'the row reads one line, not the page', plant: text(ROW, 'flagBuildingAge(lines.map(toCodeFlagLine), ctx)', 'flagBuildingAge(lines.slice(0, 1).map(toCodeFlagLine), ctx)') },
  { rule: 'A13', what: 'the structural flag fires on a non-bearing partition', plant: wrapFlag((r, l, c) => (nameHas(l, /non.load.bearing/i) ? { ...r, flagged: true, kind: 'permit', hits: [fakeHit('structural', 'remove, wall', c.place)] } : r)) },
  { rule: 'A13', what: 'a wall carries both the structural and the layout flag', plant: wrapFlag((r, l, c) => (nameHas(l, /^Remove the wall$/i) ? withHit(r, fakeHit('layout_change', 'remove, wall', c.place)) : r)) },
  { rule: 'A13', what: 'the layout sentence says "bearing"', plant: en('office.codeFlags.family.layoutChange.why', 'Taking out a non-bearing wall changes the layout of rooms. Building departments commonly look at it.') },
  { rule: 'A13', what: 'the filing sentence is shown everywhere', plant: (w) => en('office.codeFlags.family.layoutChange.why', w.EN['office.codeFlags.family.layoutChange.nycWhy'])(w) },
  { rule: 'A13', what: 'the layout family drops its "needs confirmation" mark', plant: family('layout_change', (f) => ({ ...f, confirm: undefined })) },
  { rule: 'A13', what: 'a temporary dust partition flags', plant: wrapFlag((r, l, c) => (nameHas(l, /dust partition/i) ? withHit(r, fakeHit('layout_change', 'partition', c.place)) : r)) },
  { rule: 'B1', what: 'a bare "Baltimore, MD" is taken as Baltimore City', plant: mods({ resolvePlace: (q) => (q && q.city === 'Baltimore' && !q.zip ? CORE.resolveCodeFlagPlace({ ...q, zip: '21201' }) : CORE.resolveCodeFlagPlace(q)) }) },
  { rule: 'B1', what: 'Riyadh is given New York City rules', plant: mods({ resolvePlace: (q) => (q && q.city === 'Riyadh' ? CORE.resolveCodeFlagPlace({ city: 'Brooklyn', state: 'NY' }) : CORE.resolveCodeFlagPlace(q)) }) },
  { rule: 'B1', what: 'all of New York State is treated as the City', plant: mods({ resolvePlace: (q) => (q && q.state === 'NY' ? CORE.resolveCodeFlagPlace({ city: 'Brooklyn', state: 'NY' }) : CORE.resolveCodeFlagPlace(q)) }) },
  { rule: 'B2', what: 'a line with no place carries a New York City link', plant: wrapFlag((r) => ({ ...r, hits: r.hits.map((h) => (r.place.id === 'other' ? { ...h, local: { links: [NYC_LINK], section: null } } : h)) })) },
  { rule: 'B2', what: 'an "other" place is handed the Baltimore County section', plant: mods({ localRefs: (place, fam, matched) => (place.id === 'other' && fam === 'electrical_service' ? CORE.codeFlagLocalRefs(CORE.resolveCodeFlagPlace({ city: 'Towson', state: 'MD' }), fam, matched) : CORE.codeFlagLocalRefs(place, fam, matched)) }) },
  { rule: 'B3', what: 'a link is written from recall', plant: mods({ localRefs: (place, fam, matched) => { const r = CORE.codeFlagLocalRefs(place, fam, matched); return place.id === 'nyc' && fam === 'gas' ? { ...r, links: [...r.links, { label: 'NYC Fuel Gas Code', url: 'https://www.nyc.gov/site/buildings/codes/fuel-gas-code.page', checkedOn: '2026-10-06' }] } : r; } }) },
  { rule: 'B3', what: 'New York City is given a section number', plant: mods({ localRefs: (place, fam, matched) => { const r = CORE.codeFlagLocalRefs(place, fam, matched); return place.id === 'nyc' && fam === 'structural' ? { ...r, section: { id: 'baltimore_city_105_1_3', label: 'NYC Administrative Code § 28-105.1', link: NYC_LINK, asNote: false } } : r; } }) },
  { rule: 'B3', what: 'every structural line in Baltimore City carries the underpinning section', plant: mods({ localRefs: (place, fam, matched) => CORE.codeFlagLocalRefs(place, fam, place.id === 'baltimore_city' && fam === 'structural' ? ['underpinning'] : matched) }) },
  { rule: 'B3', what: 'the Baltimore County edition section goes back under the Section Number heading', plant: mods({ localRefs: (place, fam, matched) => { const r = CORE.codeFlagLocalRefs(place, fam, matched); return r.section ? { ...r, section: { ...r.section, asNote: false } } : r; } }) },
  { rule: 'C1', what: 'the matcher asks a model', plant: append('utils/codeFlags/match.ts', "import { askAi } from '@/utils/aiService';") },
  { rule: 'C1', what: 'the chip calls the network', plant: append(CHIP, "void fetch('https://example.com/flag');") },
  { rule: 'C1', what: 'the matcher reads the clock', plant: append('utils/codeFlags/match.ts', 'export const stamp = new Date().toISOString();') },
  { rule: 'C2', what: 'Send is disabled while a line has a flag', plant: append(CO, '  <TouchableOpacity disabled={!!CodeFlags && hasCodeFlag} onPress={handleSend} />') },
  { rule: 'C2', what: 'the chip is handed a callback from the screen', plant: text(CO, 'csiDivision={item.csiDivision} /> : null}', 'csiDivision={item.csiDivision} onFlag={setHasFlag} /> : null}') },
  { rule: 'C2', what: 'the chip props grow an onFlagged callback', plant: text(CHIP, '  testID?: string;\n}', '  testID?: string;\n  onFlagged?: (flagged: boolean) => void;\n}') },
  { rule: 'C2', what: 'the estimate screen reads the feature in a handler', plant: append(EST, '  const blocked = CodeFlags ? true : false;') },
  { rule: 'C2', what: 'the sheet edits the line', plant: append(SHEET, 'const fix = () => setLineItems([]);') },
  { rule: 'C2', what: 'the building-age row is handed a callback from the screen', plant: text(CO, 'lines={lineItems} /> : null}', 'lines={lineItems} onFlag={setHasFlag} /> : null}') },
  { rule: 'C3', what: 'the building-age row renders before the flag check', plant: text(ROW, '  if (!CODE_FLAGS_ENABLED) return null;\n  return <RowOn {...props} />;', '  return <RowOn {...props} />;') },
  { rule: 'C3', what: 'the flag is on', plant: text(FLAG_FILE, 'export const CODE_FLAGS_ENABLED = false;', 'export const CODE_FLAGS_ENABLED = true;') },
  { rule: 'C3', what: 'the change order screen imports the chip statically', plant: append(CO, "import { CodeFlagChip as StaticChip } from '@/components/codeFlags';") },
  { rule: 'C3', what: 'the chip renders before the flag check', plant: text(CHIP, '  if (!CODE_FLAGS_ENABLED) return null;\n  return <ChipOn {...props} />;', '  return <ChipOn {...props} />;') },
  { rule: 'C3', what: 'another screen imports the matcher', plant: append('app/project-detail.tsx', "import { flagLine as fl } from '@/utils/codeFlags';") },
  { rule: 'C3', what: 'the estimate screen requires the feature without the flag', plant: text(EST, "CODE_FLAGS_ENABLED ? require('@/components/codeFlags') : null", "require('@/components/codeFlags')") },
  { rule: 'C4', what: 'the portal snapshot imports the matcher', plant: append('utils/portalSnapshot.ts', "import { flagLine as fl } from '@/utils/codeFlags/match';") },
  { rule: 'C4', what: 'the change order PDF prints a flag', plant: append('utils/pdfGenerator.ts', 'const codeFlagNote = "May need a permit amendment";') },
  { rule: 'C4', what: 'the email builder reads a Code Flags string', plant: append('utils/emailService.ts', "const s = 'office.codeFlags.chip.permitLabel';") },
  { rule: 'C4', what: 'the change order line type gets a codeFlag field', plant: append('types/index.ts', 'export interface WithFlag { codeFlags?: string[] }') },
  { rule: 'C4', what: 'the client portal page names the flag', plant: far('<span class="code-flag">May need a permit</span>') },
  { rule: 'C4', what: 'a file the PDF builder imports names the flag', plant: append('utils/formatters.ts', 'export const CODE_FLAG_FOOTNOTE = 1;') },
  { rule: 'C4', what: 'the screen computes a flag itself (so it could save it)', plant: append(CO, "const f = flagLine({ name: 'x' });") },
  { rule: 'C5', what: 'the key leaves the app-owned prefixes', plant: mods({ dismissKey: 'codeflags_dismissed' }) },
  { rule: 'C5', what: 'another account reads his hidden flags', plant: mods({ parseDismiss: (raw, account) => { try { const v = JSON.parse(raw ?? '') as CORE.CodeFlagDismissRecord; return v && v.lines ? { ...v, account } : CORE.emptyDismissRecord(account); } catch { return CORE.emptyDismissRecord(account); } } }) },
  { rule: 'C5', what: 'a hidden flag stays hidden when the line becomes a new kind of work', plant: mods({ isDismissed: (rec, scope, key, fams) => !!rec?.lines?.[scope]?.[key] && fams.length > 0 }) },
  { rule: 'C5', what: 'the chip writes to AsyncStorage itself', plant: append(CHIP, "import AsyncStorage from '@react-native-async-storage/async-storage';") },
  { rule: 'C5', what: 'the sync queue names the dismiss key', plant: append('utils/offlineQueue.ts', "const k = 'mageid_code_flag_dismissed';") },
  { rule: 'C5', what: 'a line with no project is remembered under one shared scope', plant: mods({ dismissScope: (id) => ((id ?? '').trim() ? `p:${(id ?? '').trim()}` : 'cart') }) },
  { rule: 'C5', what: 'a hidden flag is stored under a scope with no project', plant: mods({ withDismissal: (rec, scope, key, fams, at) => ({ ...rec, lines: { ...rec.lines, [scope]: { ...(rec.lines[scope] ?? {}), [key]: { families: [...fams], at } } } }) }) },
  { rule: 'C5', what: 'a stored "cart" scope is read back', plant: mods({ parseDismiss: (raw, account) => { const r = CORE.parseDismissRecord(raw, account); try { const v = JSON.parse(raw ?? '') as CORE.CodeFlagDismissRecord; if (v?.lines?.cart && v.account === account) r.lines.cart = v.lines.cart; } catch { /* unreadable */ } return r; } }) },
  { rule: 'C5', what: 'the chip stores a hidden flag when there is no project', plant: text(CHIP, 'if (isStorableScope(scope)) void dismissLine(scope, lineKey, families);\n    else setHiddenHere(true);', 'void dismissLine(scope, lineKey, families);') },
  { rule: 'D1', what: 'English says a line "is compliant"', plant: en('office.codeFlags.sheet.introBody', 'This line is compliant. You decide what to do.') },
  { rule: 'D1', what: 'English says "required by code"', plant: en('office.codeFlags.family.gas.why', 'A permit is required by code for gas piping.') },
  { rule: 'D1', what: 'English says the plans are "approved"', plant: en('office.codeFlags.sheet.starterBody', 'This list is approved.') },
  { rule: 'D1', what: 'English says it "passes" or "meets code"', plant: en('office.codeFlags.section.noneBody', 'This passes and meets code.') },
  { rule: 'D1', what: 'Spanish says "cumple"', plant: esText('office.codeFlags.sheet.introBody', (s) => `${s} Este renglón cumple con el código.`) },
  { rule: 'D1', what: 'Spanish says "aprobado"', plant: esText('office.codeFlags.sheet.starterBody', () => 'Esta lista está aprobada.') },
  { rule: 'D1', what: 'Spanish says "exigido por el código"', plant: esText('office.codeFlags.family.gas.why', () => 'El permiso es exigido por el código.') },
  { rule: 'D2', what: 'the no-flag sentence is softened', plant: en('office.codeFlags.sheet.noFlagBody', 'A line with no flag is usually fine.') },
  { rule: 'D2', what: 'the sheet stops showing the no-flag sentence', plant: text(SHEET, '{copy.noFlagBody}', '{null}') },
  { rule: 'D2', what: 'the no-flag sentence is shown only for some lines', plant: text(SHEET, /<Text style=\{styles\.text\} testID=\{testID \? `\$\{testID\}-no-flag` : undefined\}>\{copy\.noFlagBody\}<\/Text>/, '{result.hits.length > 1 ? <Text>{copy.noFlagBody}</Text> : null}') },
  { rule: 'D2', what: 'the Spanish drops "never stops you"', plant: esText('office.codeFlags.sheet.neverBlocksBody', () => 'Un aviso es solo una nota.') },
  { rule: 'D2', what: 'the other-place sentence stops saying there is no local link', plant: en('office.codeFlags.place.otherBody', 'Ask your building department.') },
  { rule: 'D2', what: 'the private sentence says "you and your team" again', plant: en('office.codeFlags.sheet.privateBody', 'Only you and your team see this flag. It is not on anything your client, your subs or your architect see.') },
  { rule: 'D2', what: 'the private sentence says "only you see" again (a teammate on the same change order sees the chip too)', plant: en('office.codeFlags.sheet.privateBody', 'Only you see this flag. It is not on anything you send.') },
  { rule: 'D2', what: 'the Spanish private sentence says "solo tú ves" again', plant: esText('office.codeFlags.sheet.privateBody', () => 'Solo tú ves este aviso. No aparece en nada de lo que envías.') },
  { rule: 'D3', what: 'a why line quotes the code', plant: en('office.codeFlags.family.egress.why', 'The code says "exits shall be maintained". Check it.') },
  { rule: 'D3', what: 'a why line reads like code text', plant: en('office.codeFlags.family.fireRating.why', 'Penetrations shall be protected in accordance with Section 714.') },
  { rule: 'D3', what: 'a section number is typed into the words', plant: en('office.codeFlags.family.structural.why', 'See § 105.1.3 for this work.') },
  { rule: 'D3', what: 'the rule table holds a section number', plant: append('utils/codeFlags/rules.ts', "export const S = 'BC § 1011.5';") },
  { rule: 'D4', what: 'a key has no Spanish', plant: es('office.codeFlags.sheet.noFlagBody', undefined) },
  { rule: 'D4', what: 'the Spanish was written for other English', plant: en('office.codeFlags.sheet.hideBody', 'Hidden on this phone. It comes back if the line changes to a new kind of work.') },
  { rule: 'D4', what: 'a placeholder is lost in Spanish', plant: esText('office.codeFlags.trigger.wordsBody', () => 'Estas palabras en el renglón.') },
  { rule: 'D5', what: 'a label is in sentence case', plant: en('office.codeFlags.sheet.hideLabel', 'Hide this flag') },
  { rule: 'D5', what: 'an em dash', plant: en('office.codeFlags.sheet.introBody', 'This kind of work is commonly looked at — you decide what to do.') },
  { rule: 'D5', what: 'the chip says something else', plant: en('office.codeFlags.chip.permitLabel', 'Permit Amendment Needed') },
  { rule: 'D5', what: 'the standing line drifts from the app note', plant: en('office.codeFlags.sheet.standingNoteBody', 'Confirm with your building department.') },
  { rule: 'D5', what: 'a caption loses its full stop', plant: en('office.codeFlags.sheet.askBody', 'Opens Code Check for the detail. Code Check has its own daily limit on your plan') },
  { rule: 'D5', what: 'the copy hook grows a label nothing shows', plant: text(HOOK, '  askLabel: string;', '  askLabel: string;\n  closeLabel: string;') },
  { rule: 'D6', what: 'the edition section goes back under the Section Number heading', plant: text(SHEET, '{hit.local.section?.asNote ? null : <Text', '{hit.local.section === undefined ? null : <Text') },
  { rule: 'D6', what: 'the building-age sheet drops its line count', plant: text(SHEET, 'copy.docTriggerBody(hit.triggers, hit.lineCount ?? 0)', 'copy.triggerBody(hit.triggers, null)') },
  { rule: 'D6', what: 'a shown pair is not in the table', plant: wrapFlag((r) => ({ ...r, hits: r.hits.map((h) => ({ ...h, triggers: h.triggers.map((t) => (t.via === 'pair' ? { ...t, phrase: 'paint, wall', pair: ['paint', 'wall'] as [string, string] } : t)) })) })) },
  { rule: 'D6', what: 'the sheet stops printing the trigger words', plant: text(SHEET, 'copy.triggerBody(hit.triggers, categoryName)', 'copy.whyHeadingLabel') },
  { rule: 'D6', what: 'the shown trigger is a word that is not on the line', plant: wrapFlag((r) => ({ ...r, hits: r.hits.map((h) => ({ ...h, triggers: h.triggers.map((t) => (t.via === 'words' ? { ...t, phrase: 'load bearing' } : t)) })) })) },
  { rule: 'D6', what: 'the sheet hides the "no section number" line', plant: text(SHEET, ': copy.noSectionBody}', ": ''}") },
  { rule: 'E1', what: 'a warning triangle', plant: text(CHIP, "import { Info } from 'lucide-react-native';", "import { AlertTriangle as Info } from 'lucide-react-native';") },
  { rule: 'E1', what: 'the accent as the chip background', plant: text(CHIP, 'backgroundColor: t.surfaceAlt', 'backgroundColor: t.accent') },
  { rule: 'E1', what: 'a red chip', plant: text(CHIP, 'borderColor: t.line', 'borderColor: t.danger') },
  { rule: 'E1', what: 'react-native-reanimated', plant: append(SHEET, "import Animated from 'react-native-reanimated';") },
  { rule: 'E2', what: 'the chip is hidden on the free plan', plant: append(CHIP, "import { useTierAccess } from '@/hooks/useTierAccess';") },
  { rule: 'E2', what: 'the sheet stops opening Code Check', plant: text(SHEET, 'router.push(codeCheckFromJobHref(projectId))', 'router.back()') },
  { rule: 'E3', what: 'every chip builds the whole sheet copy', plant: append(CHIP, 'const useAll = () => useCodeFlagsCopy();') },
  { rule: 'E3', what: 'the chip loses its hit slop', plant: text(CHIP, 'hitSlop={10}', 'hitSlop={0}') },
  { rule: 'E3', what: 'the sheet is mounted while closed', plant: text(CHIP, '{open ? (', '{true ? (') },
  { rule: 'E3', what: "the sheet nests a scroll view inside Sheet's own", plant: append(SHEET, "import { ScrollView } from 'react-native';") },
  { rule: 'E3', what: 'a section heading is not a header', plant: text(SHEET, ' accessibilityRole="header">{copy.whyHeadingLabel}', '>{copy.whyHeadingLabel}') },
  { rule: 'E3', what: 'the family name is not a header', plant: text(SHEET, 'style={styles.familyName} accessibilityRole="header"', 'style={styles.familyName}') },
  { rule: 'E3', what: 'the chip labels are rebuilt for every chip', plant: text(HOOK, 'let labels = LABELS.get(displayLang);', 'let labels: CodeFlagChipLabels | undefined;') },
  { rule: 'E3', what: 'the rule phrases are split again for every line', plant: mods({ flagLine: (line, ctx) => { for (let k = 0; k < 4; k++) for (const f of CORE.CODE_FLAG_FAMILIES) for (const t of [...f.triggers, ...f.mask]) CORE.phraseTokens(t); return CORE.flagLine(line, ctx); } }) },
];

console.log('\n── planted mutations (each must turn its own rule red)');
const proven = new Set<string>();
for (const m of MUTATIONS) {
  const id = Object.keys(RULES).find((k) => k.startsWith(`${m.rule} `));
  let caught = false;
  let how = '';
  try {
    if (!id) throw new Error(`no rule ${m.rule}`);
    const w = m.plant(REAL);
    let problems: string[];
    try { problems = RULES[id](w); } catch (e) { problems = [`threw ${e instanceof Error ? e.message : String(e)}`]; }
    caught = problems.length > 0;
    if (!caught) how = 'the rule stayed green';
  } catch (e) {
    how = `mutation could not be planted: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (caught) { pass += 1; proven.add(m.rule); }
  else { fail += 1; console.log(`  ✗ ${m.rule}: ${m.what} (${how})`); }
}
const unproven = Object.keys(RULES).map((k) => k.split(' ')[0]).filter((r) => !proven.has(r));
if (unproven.length === 0) { pass += 1; console.log('  ✓ every rule has at least one planted mutation that it catches'); }
else { fail += 1; console.log(`  ✗ rules with no caught mutation: ${unproven.join(', ')}`); }

const size = CORE.codeFlagTableSize();
console.log(`\n  ${CODE_FLAG_POSITIVES.length} positive and ${CODE_FLAG_NEGATIVES.length} negative example lines, ${CORE.CODE_FLAG_FAMILIES.length} families, ${size.phrases} English phrases, ${size.spanish} Spanish phrases, ${size.pairs} verb-and-noun pairs`);
console.log(`\n${fail === 0 ? '✓' : '✗'} validate-code-flags: ${pass} checks (${MUTATIONS.length} planted mutations), ${fail} failed`);
if (fail > 0) process.exit(1);
