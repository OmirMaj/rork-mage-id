// scripts/validate-permit-path-facts.ts — the offline gate for the Permit Path
// question packs (utils/permitPath/packs/*). Runs under bun, no network, in the
// ship gate:
//
//     bun run scripts/validate-permit-path-facts.ts
//
// It holds the packs to the firewall that utils/codeJurisdiction.ts set: a
// requirement the app states as fact cites an official page in SOURCES, read on
// a recent date; everything else is a question for the department.
//
//   R1  every source is one of SOURCE_REFS (identity), and no pack string holds a URL
//   R2  every SOURCES url is https on an allowlisted host, checkedOn within 180
//       days of the pinned clock (never after it), phrase present
//   R3  ids unique; every predicate reads an existing question (or an engine
//       DERIVED id) with a value that question can take; askQuestionId exists
//   R4  shape (verified ⇔ source, unknown ⇔ askQuestionId), and the Long Island
//       ratchet: only LI_VERIFIED_ALLOWED may be verified
//   R5  no durations in pack strings (durations live in the engine, from data)
//   R6  banned words (PLAN §6.3) and docs/VOICE.md §4 and §11
//   R7  every department question ends with "?"
//   R8  planted mutations: each one must turn the check red on its own rule
//   R9  route behaviour, evaluated with the engine's own evalPredicate/prefillFor:
//       the NYC job type is exactly one of Alteration-CO / Alteration / Ask for
//       any answers (and an addition never reads as a plain Alteration); a CO
//       sign-off line only follows a provable Alteration-CO; a line citing a
//       1- and 2-family page is gated to 1- and 2-family homes; every question
//       the GC answers is read by some predicate; trade hints don't match a
//       corpus of unrelated estimate lines
//
// The network half is scripts/verify-permit-path-sources.ts (run by hand).

import { localDayIso } from '../__tests__/helpers/testClock';
import { NY_HAND_VERIFIED } from '../utils/permitOffices';
import {
  ALL_PACKS,
  ASK_ROUTE_HINTS,
  READINESS_LABEL,
  SLOT_ITEM_IDS,
  SOURCES,
  SOURCE_IDS,
  SOURCE_REFS,
  TO_CONFIRM,
  TRADE_HINTS,
  WORK_TYPE_CHOICES,
  YES_NO_UNSURE,
  type FactSource,
  type SourceId,
  type ToConfirm,
} from '../utils/permitPath/packs';
import { DERIVED_QUESTION_IDS, evalPredicate, predicateQuestionIds } from '../utils/permitPath/predicate';
import { prefillFor } from '../utils/permitPath/prefill';
import type { Family, InterviewAnswers, ItemTemplate, Predicate, Question, QuestionPack, SourceRef } from '../utils/permitPath/types';

/** The pinned clock (testClock rule: a dated fixture pins its day). Move it
 *  forward together with FACTS_CHECKED_ON after a verify-permit-path-sources run. */
export const FACTS_CLOCK = '2026-10-02';
const MAX_AGE_DAYS = 180;

/** THE LONG ISLAND RATCHET. Adding a verified Long Island line needs a V-source
 *  that says it AND a deliberate edit to this list. */
export const LI_VERIFIED_ALLOWED: readonly string[] = ['li.nassau_hic', 'li.suffolk_hic', 'li.suffolk_check'];
const LI_PACK_IDS: readonly string[] = ['li_common', 'nassau', 'suffolk', 'li_village'];

/** The tokens utils/permitPath/buildRoute.ts replaces in slot items. */
const SLOT_TOKENS: readonly string[] = ['{zoning}', '{plutoVersion}', '{title}', '{phone}', '{hours}'];
const BASE_HOSTS = ['nyc.gov', 'nassaucountyny.gov', 'suffolkcountyny.gov'];
const FAMILIES: readonly Family[] = ['nyc', 'ny_town', 'ny_village', 'ny_city', 'elsewhere', 'unresolved'];
const PACK_IDS: readonly QuestionPack['id'][] = ['base', 'nyc', 'li_common', 'nassau', 'suffolk', 'li_village'];
/** Engine-derived ids and the values they take (utils/permitPath/predicate.ts). */
const DERIVED_VALUES: Readonly<Record<string, readonly string[]>> = {
  'derived.year_band': ['before_1987', 'in_1987', 'after_1987'],
  'derived.pre_apr_1987': ['yes', 'no', 'unsure'],
  'derived.open_violations': ['yes', 'no'],
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function allowedHosts(): string[] {
  const hand = NY_HAND_VERIFIED.map((h) => hostOf(h.sourceUrl)).filter((h): h is string => !!h);
  return [...new Set([...BASE_HOSTS, ...hand])];
}

function hostAllowed(host: string, allow: readonly string[]): boolean {
  return allow.some((d) => host === d || host.endsWith(`.${d}`));
}

// ---------------------------------------------------------------- string rules

const DURATION_RE =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|sixty|ninety)\s*(?:(?:-|to|or)\s*\d+\s*)?(?:working\s+|business\s+|calendar\s+)?(day|week|month)s?\b/i;

/** PLAN §6.3, then docs/VOICE.md §11 (the parts that apply to fact text). */
const BANNED: readonly { re: RegExp; why: string }[] = [
  { re: /\bfiles? permits\b/i, why: '"files permits"' },
  { re: /\bfile for you\b/i, why: '"file for you"' },
  { re: /\bverified code\b/i, why: '"verified code"' },
  { re: /\bapproved\b/i, why: '"approved"' },
  { re: /\bcompliant\b/i, why: '"compliant"' },
  { re: /\bguarantee(d|s)?\b/i, why: '"guaranteed"' },
  { re: /\bpermit-ready\b/i, why: '"permit-ready"' },
  { re: /\bDOB-approved\b/i, why: '"DOB-approved"' },
  { re: /\bplease\b/i, why: '"Please"' },
  { re: /\bsimply\b/i, why: '"Simply"' },
  { re: /\bjust\b/i, why: '"Just"' },
  { re: /\beasily\b/i, why: '"Easily"' },
  { re: /\bclick here\b/i, why: '"Click here"' },
  { re: /\bnote:/i, why: '"Note:"' },
  { re: /\b(seamless|effortless|unlock|supercharge|powerful|robust)\w*/i, why: 'AI-template word' },
  { re: /\bhonest(ly)?\b/i, why: 'meta-honesty chatter' },
  { re: /\bcoming soon\b/i, why: '"Coming soon"' },
  { re: /\b(null|undefined|NaN)\b/, why: 'developer-speak' },
  { re: /\(s\)/, why: '"(s)" plural' },
  { re: /~/, why: 'tilde' },
];

function voiceProblems(s: string): string[] {
  const out: string[] = [];
  for (const b of BANNED) if (b.re.test(s)) out.push(`banned ${b.why}`);
  // "certified" only inside the verbatim title.
  if (/\bcertified\b/i.test(s.replace(/Certified Asbestos Investigator/g, ''))) out.push('banned "certified" (outside "Certified Asbestos Investigator")');
  if (s.includes('!')) out.push('exclamation mark');
  if (s.includes('...')) out.push('"..." (use … for work in progress only)');
  if ((s.match(/—/g) ?? []).length > 1) out.push('more than one em dash');
  return out;
}

// ---------------------------------------------------------------- the check

export interface FactsInput {
  packs: readonly QuestionPack[];
  sources: Readonly<Record<string, FactSource>>;
  refs: Readonly<Record<string, SourceRef>>;
  clock: string;
  slotIds: readonly string[];
  readinessLabels: Readonly<Record<string, string>>;
  askRouteHints: Readonly<Record<string, string>>;
  toConfirm: readonly ToConfirm[];
  tradeHints: Readonly<Record<string, readonly string[]>>;
}

export function realInput(): FactsInput {
  return {
    packs: ALL_PACKS,
    sources: SOURCES,
    refs: SOURCE_REFS,
    clock: FACTS_CLOCK,
    slotIds: SLOT_ITEM_IDS,
    readinessLabels: READINESS_LABEL,
    askRouteHints: ASK_ROUTE_HINTS,
    toConfirm: TO_CONFIRM,
    tradeHints: TRADE_HINTS,
  };
}

interface Str { where: string; text: string; kind: 'pack' | 'deptq' | 'slot' | 'meta' }

function packStrings(input: FactsInput): Str[] {
  const out: Str[] = [];
  for (const p of input.packs) {
    for (const q of p.questions) {
      out.push({ where: `${p.id}:${q.id}.text`, text: q.text, kind: 'pack' });
      if (q.help) out.push({ where: `${p.id}:${q.id}.help`, text: q.help, kind: 'pack' });
      for (const c of q.choices ?? []) out.push({ where: `${p.id}:${q.id}.choice ${c.id}`, text: c.label, kind: 'pack' });
    }
    for (const it of p.items) out.push({ where: `${p.id}:${it.id}.text`, text: it.text, kind: input.slotIds.includes(it.id) ? 'slot' : 'pack' });
    for (const s of p.skips) out.push({ where: `${p.id}:skip ${s.station}.because`, text: s.because, kind: 'pack' });
    for (const d of p.deptQuestions) out.push({ where: `${p.id}:${d.id}.text`, text: d.text, kind: 'deptq' });
  }
  for (const [id, l] of Object.entries(input.readinessLabels)) out.push({ where: `readiness ${id}`, text: l, kind: 'pack' });
  for (const id of Object.keys(input.sources)) out.push({ where: `SOURCES.${id}.label`, text: input.sources[id].label, kind: 'meta' });
  for (const t of input.toConfirm) {
    out.push({ where: `TO_CONFIRM ${t.id}.fact`, text: t.fact, kind: 'meta' });
    out.push({ where: `TO_CONFIRM ${t.id}.note`, text: t.note, kind: 'meta' });
  }
  return out;
}

function walkPredicate(p: Predicate, visit: (leaf: Predicate) => void): void {
  if ('all' in p) p.all.forEach((c) => walkPredicate(c, visit));
  else if ('any' in p) p.any.forEach((c) => walkPredicate(c, visit));
  else if ('not' in p) walkPredicate(p.not, visit);
  else visit(p);
}

/** Every violation, each tagged with its rule: '[R4] …'. Empty means green. */
export function checkFacts(input: FactsInput): string[] {
  const v: string[] = [];
  const refList = Object.values(input.refs);
  const allow = allowedHosts();

  // ---- R2: the sources themselves
  const floor = localDayIso(new Date(`${input.clock}T15:00:00`).getTime(), -MAX_AGE_DAYS);
  for (const [id, s] of Object.entries(input.sources)) {
    const host = hostOf(s.url);
    if (!/^https:\/\//.test(s.url)) v.push(`[R2] SOURCES.${id}: url is not https (${s.url})`);
    if (!host || !hostAllowed(host, allow)) v.push(`[R2] SOURCES.${id}: host ${host ?? '?'} is not on the allowlist`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checkedOn)) v.push(`[R2] SOURCES.${id}: checkedOn "${s.checkedOn}" is not YYYY-MM-DD`);
    else if (s.checkedOn < floor) v.push(`[R2] SOURCES.${id}: checkedOn ${s.checkedOn} is more than ${MAX_AGE_DAYS} days before ${input.clock}; re-run verify-permit-path-sources`);
    else if (s.checkedOn > input.clock) v.push(`[R2] SOURCES.${id}: checkedOn ${s.checkedOn} is after the pinned clock ${input.clock}`);
    if (!s.phrase || s.phrase.trim().length < 8) v.push(`[R2] SOURCES.${id}: phrase is missing or too short to prove anything`);
    if (!s.label.includes(' · ')) v.push(`[R2] SOURCES.${id}: label should read "Agency · Page"`);
    const r = input.refs[id];
    if (!r || r.url !== s.url || r.label !== s.label || r.checkedOn !== s.checkedOn) v.push(`[R2] SOURCE_REFS.${id} does not mirror SOURCES.${id}`);
  }

  // ---- R1: sources by identity; no URL in any string
  const checkSource = (where: string, ref: SourceRef | null) => {
    if (ref === null) return;
    if (!refList.includes(ref)) v.push(`[R1] ${where}: source "${ref.label}" (${ref.url}) is not one of SOURCE_REFS; cite a SOURCES entry, never an inline URL`);
  };
  for (const p of input.packs) {
    for (const q of p.questions) checkSource(`${p.id}:${q.id}`, q.source);
    for (const it of p.items) checkSource(`${p.id}:${it.id}`, it.source);
    for (const s of p.skips) checkSource(`${p.id}:skip ${s.station}`, s.source);
  }
  const strings = packStrings(input);
  for (const s of strings) if (s.kind !== 'meta' && /https?:\/\/|www\.|\.gov\b|\.com\b/i.test(s.text)) v.push(`[R1] ${s.where}: inline URL in text`);

  // ---- R3: ids and predicates
  const packIds = input.packs.map((p) => p.id);
  if (new Set(packIds).size !== packIds.length) v.push('[R3] duplicate pack id');
  for (const id of packIds) if (!PACK_IDS.includes(id)) v.push(`[R3] unknown pack id ${id}`);

  const questions = new Map<string, Question>();
  const everyId = new Map<string, string>();
  const claim = (id: string, where: string) => {
    const prev = everyId.get(id);
    if (prev) v.push(`[R3] id ${id} is used twice (${prev} and ${where}); ids double as i18n keys`);
    else everyId.set(id, where);
  };
  for (const p of input.packs) {
    for (const q of p.questions) {
      claim(q.id, `${p.id} question`);
      questions.set(q.id, q);
    }
    for (const it of p.items) claim(it.id, `${p.id} item`);
    for (const d of p.deptQuestions) claim(d.id, `${p.id} deptQuestion`);
  }
  const deptIds = new Set(input.packs.flatMap((p) => p.deptQuestions.map((d) => d.id)));

  const valuesOf = (qid: string): readonly string[] | 'year' | null => {
    if (qid in DERIVED_VALUES) return DERIVED_VALUES[qid];
    const q = questions.get(qid);
    if (!q) return null;
    if (q.kind === 'yes_no_unsure') return YES_NO_UNSURE;
    if (q.kind === 'year') return 'year';
    return (q.choices ?? []).map((c) => c.id);
  };
  const checkPredicate = (where: string, p: Predicate | null) => {
    if (p === null) return;
    for (const qid of predicateQuestionIds(p)) {
      if (!questions.has(qid) && !DERIVED_QUESTION_IDS.includes(qid)) v.push(`[R3] ${where}: predicate reads "${qid}", which no pack asks and the engine does not derive`);
    }
    walkPredicate(p, (leaf) => {
      if ('family' in leaf) for (const f of leaf.family) if (!FAMILIES.includes(f)) v.push(`[R3] ${where}: unknown family "${f}"`);
      if ('county' in leaf) for (const c of leaf.county) if (!/^\d{5}$/.test(c)) v.push(`[R3] ${where}: county "${c}" is not a 5-digit FIPS`);
      if ('q' in leaf && 'is' in leaf) {
        const allowed = valuesOf(leaf.q);
        const want = typeof leaf.is === 'string' ? [leaf.is] : [...leaf.is];
        if (allowed === 'year') {
          for (const w of want) if (!/^\d{4}$/.test(w)) v.push(`[R3] ${where}: "${leaf.q}" is a year; "${w}" is not one`);
        } else if (allowed) {
          for (const w of want) if (!allowed.includes(w)) v.push(`[R3] ${where}: "${leaf.q}" can never be "${w}" (it takes ${allowed.join(', ')})`);
        }
      }
    });
  };
  for (const p of input.packs) {
    checkPredicate(`${p.id}.appliesTo`, p.appliesTo);
    for (const q of p.questions) {
      checkPredicate(`${p.id}:${q.id}.askIf`, q.askIf);
      if (q.askIf && predicateQuestionIds(q.askIf).includes(q.id)) v.push(`[R3] ${p.id}:${q.id}: askIf reads its own answer`);
      const hasChoices = !!q.choices && q.choices.length > 0;
      if ((q.kind === 'choice' || q.kind === 'multi') !== hasChoices) v.push(`[R3] ${p.id}:${q.id}: a ${q.kind} question ${hasChoices ? 'must not carry' : 'needs'} choices`);
      const cids = (q.choices ?? []).map((c) => c.id);
      if (new Set(cids).size !== cids.length) v.push(`[R3] ${p.id}:${q.id}: duplicate choice id`);
    }
    for (const it of p.items) checkPredicate(`${p.id}:${it.id}.when`, it.when);
    for (const s of p.skips) checkPredicate(`${p.id}:skip ${s.station}.when`, s.when);
    for (const d of p.deptQuestions) checkPredicate(`${p.id}:${d.id}.askIf`, d.askIf);
    for (const it of p.items) if (it.askQuestionId !== null && !deptIds.has(it.askQuestionId)) v.push(`[R3] ${p.id}:${it.id}: askQuestionId "${it.askQuestionId}" is no department question`);
  }
  const itemById = new Map<string, ItemTemplate>(input.packs.flatMap((p) => p.items.map((it) => [it.id, it] as const)));
  for (const id of Object.keys(input.readinessLabels)) {
    const it = itemById.get(id);
    if (!it) v.push(`[R3] READINESS_LABEL.${id}: no such item`);
    else if (!it.readiness) v.push(`[R3] READINESS_LABEL.${id}: the item is not a readiness item`);
  }
  for (const id of input.slotIds) if (!itemById.has(id)) v.push(`[R3] SLOT_ITEM_IDS: ${id} is no pack item`);
  for (const id of Object.keys(input.askRouteHints)) if (!deptIds.has(id)) v.push(`[R3] ASK_ROUTE_HINTS.${id}: no such department question`);
  const workTypes = WORK_TYPE_CHOICES.map((c) => c.id as string);
  for (const k of Object.keys(input.tradeHints)) if (!workTypes.includes(k)) v.push(`[R3] TRADE_HINTS.${k}: not a base.work_types choice`);
  for (const k of workTypes) if (!(k in input.tradeHints)) v.push(`[R3] TRADE_HINTS is missing ${k}`);
  for (const [k, phrases] of Object.entries(input.tradeHints)) {
    for (const ph of phrases) if (!ph || ph !== ph.toLowerCase() || ph.trim() !== ph) v.push(`[R3] TRADE_HINTS.${k}: "${ph}" must be lowercase and trimmed`);
  }

  // ---- R4: shape and the Long Island ratchet
  for (const p of input.packs) {
    for (const it of p.items) {
      const at = `${p.id}:${it.id}`;
      if (it.certainty === 'verified' && it.source === null) v.push(`[R4] ${at}: verified without a source`);
      if (it.certainty !== 'verified' && it.source !== null) v.push(`[R4] ${at}: a source on a ${it.certainty} line (source only with verified)`);
      if ((it.certainty === 'unknown') !== (it.askQuestionId !== null)) v.push(`[R4] ${at}: askQuestionId must be set exactly when certainty is unknown`);
      if (it.certainty === 'department_said' || it.certainty === 'measured' || it.certainty === 'ai_draft') v.push(`[R4] ${at}: ${it.certainty} only comes from runtime data, never a pack`);
      const isLi = LI_PACK_IDS.includes(p.id) || it.id.startsWith('li.');
      if (isLi && it.certainty === 'verified' && !LI_VERIFIED_ALLOWED.includes(it.id)) {
        v.push(`[R4] ${at}: a verified Long Island line outside LI_VERIFIED_ALLOWED; a town or village requirement is a department question`);
      }
    }
  }

  // ---- R5, R6, R7: strings
  for (const s of strings) {
    if (s.kind !== 'meta' && DURATION_RE.test(s.text)) v.push(`[R5] ${s.where}: a duration in pack text ("${s.text.match(DURATION_RE)?.[0]}"); durations come from data in the engine`);
    for (const pr of voiceProblems(s.text)) v.push(`[R6] ${s.where}: ${pr}`);
    if (s.kind === 'deptq') {
      if (!s.text.trimEnd().endsWith('?')) v.push(`[R7] ${s.where}: a department question must end with "?"`);
      const ph = s.text.match(/<[^>]*>|\{[^}]*\}/g) ?? [];
      for (const x of ph) if (x !== '<scope>') v.push(`[R7] ${s.where}: placeholder ${x} (only <scope> is filled in)`);
    } else if (s.kind === 'pack' && /<[a-z_]+>|\{[a-z_]+\}/i.test(s.text)) {
      v.push(`[R6] ${s.where}: a placeholder in rendered text; only SLOT_ITEM_IDS items are filled by the engine`);
    } else if (s.kind === 'slot') {
      for (const x of s.text.match(/<[^>]*>|\{[^}]*\}/g) ?? []) if (!SLOT_TOKENS.includes(x)) v.push(`[R6] ${s.where}: placeholder ${x} is not one the engine fills (${SLOT_TOKENS.join(' ')})`);
    }
  }
  v.push(...checkRoutes(input));
  return v;
}

// ---------------------------------------------------------------- R9 route behaviour

const JOB_TYPE_ITEMS = ['nyc.job_type_alt_co', 'nyc.job_type_alt', 'nyc.job_type_unsure'] as const;
const CO_SIGNOFF_ITEMS = ['nyc.signoff_co', 'nyc.signoff_co_other'] as const;
/** The engine's derived ids, and the GC answers each one is computed from. */
const DERIVED_READS: Readonly<Record<string, readonly string[]>> = {
  'derived.year_band': ['base.building_year'],
  'derived.pre_apr_1987': ['base.building_year', 'nyc.built_before_apr_1987'],
  'derived.open_violations': [],
};
/** Questions the GC answers that no route line reads yet, each with why it stays.
 *  Keep this list short: a question that changes nothing is a question to drop. */
export const QUESTIONS_NOT_ON_ROUTE: Readonly<Record<string, string>> = {
  'li.village_or_town': 'the village interview leads with it (prefill permit_office); the engine decides the department from the office row',
};
/** Estimate lines that must NOT pick the given work type (substring traps). */
export const TRADE_HINT_TRAPS: readonly (readonly [string, string])[] = [
  ['Additional outlets in bedroom', 'new_building_addition'],
  ['Foundation crack repair', 'new_building_addition'],
  ['Stainless steel sink', 'structural'],
  ['Product delivery', 'hvac'],
  ['Pull conductor to sub panel', 'hvac'],
  ['Gutter cleaning', 'interior_renovation'],
  ['Wood paneling in den', 'electrical'],
  ['Copper tube stubs', 'plumbing'],
  ['Demo existing cabinets', 'demolition'],
  ['Tear out carpet', 'demolition'],
];
/** Estimate lines that MUST still pick the given work type. */
export const TRADE_HINT_HITS: readonly (readonly [string, string])[] = [
  ['Rear addition framing', 'new_building_addition'],
  ['Breaker panel upgrade', 'electrical'],
  ['Bathtub replacement', 'plumbing'],
  ['Ductwork for second floor', 'hvac'],
  ['Steel beam install', 'structural'],
  ['Full demo of detached garage', 'demolition'],
  ['Gut rehab of top floor', 'interior_renovation'],
];

const ans = (o: Record<string, string | string[] | undefined>): InterviewAnswers =>
  Object.fromEntries(
    Object.entries(o)
      .filter((e): e is [string, string | string[]] => e[1] !== undefined)
      .map(([k, value]) => [k, { value, from: 'gc' as const, prefillNote: null, at: '2026-10-02T12:00:00' }]),
  );

const isLeaf = (p: Predicate, q: string, value: string): boolean =>
  'q' in p && p.q === q && 'is' in p && (p.is === value || (Array.isArray(p.is) && p.is.length === 1 && p.is[0] === value));

export function checkRoutes(input: FactsInput): string[] {
  const v: string[] = [];
  const items = new Map<string, ItemTemplate>(input.packs.flatMap((p) => p.items.map((it) => [it.id, it] as const)));

  // (a) the NYC job type: exactly one line, for any answers.
  const missing = [...JOB_TYPE_ITEMS].filter((id) => !items.has(id));
  if (missing.length) v.push(`[R9] job type: missing ${missing.join(', ')}`);
  else {
    const workSets: (string[] | undefined)[] = [undefined, ...WORK_TYPE_CHOICES.map((c) => [c.id as string]), ['kitchen_bath', 'new_building_addition'], ['plumbing', 'change_of_use']];
    const coValues: (string | undefined)[] = [undefined, 'yes', 'no', 'unsure'];
    const resValues: (string | undefined)[] = [undefined, 'one_two_family', 'apartment', 'commercial', 'mixed_use'];
    let bad = 0;
    for (const w of workSets) for (const co of coValues) for (const res of resValues) {
      const ctx = { answers: ans({ 'base.work_types': w, 'nyc.co_change': co, 'base.residential': res }), family: 'nyc' as Family, countyFips: '36047' };
      const on = JOB_TYPE_ITEMS.filter((id) => evalPredicate(items.get(id)!.when, ctx));
      if (on.length !== 1 && bad++ < 3) v.push(`[R9] job type: work ${JSON.stringify(w ?? null)}, co_change ${co ?? 'unanswered'} → ${on.length ? on.join(' + ') : 'no line'} (exactly one must hold)`);
      for (const id of CO_SIGNOFF_ITEMS) {
        const it = items.get(id);
        if (it && evalPredicate(it.when, ctx) && !on.includes('nyc.job_type_alt_co') && bad++ < 3) v.push(`[R9] ${id} holds without a provable Alteration-CO (work ${JSON.stringify(w ?? null)}, co_change ${co ?? 'unanswered'})`);
      }
    }
    const pick = (w: string[], co: string) => JOB_TYPE_ITEMS.filter((id) => evalPredicate(items.get(id)!.when, { answers: ans({ 'base.work_types': w, 'nyc.co_change': co }), family: 'nyc', countyFips: '36047' })).join('+');
    const spot: [string[], string, string][] = [
      [['new_building_addition'], 'no', 'nyc.job_type_unsure'],
      [['change_of_use'], 'no', 'nyc.job_type_unsure'],
      [['demolition'], 'yes', 'nyc.job_type_unsure'],
      [['kitchen_bath'], 'no', 'nyc.job_type_alt'],
      [['change_of_use'], 'yes', 'nyc.job_type_alt_co'],
    ];
    for (const [w, co, want] of spot) if (pick(w, co) !== want) v.push(`[R9] job type: ${w.join(',')} with co_change ${co} gives "${pick(w, co)}", want ${want}`);
  }

  // (b) a line citing a 1- and 2-family page is gated to 1- and 2-family homes.
  for (const p of input.packs) for (const it of p.items) {
    if (!it.source || !/1- and 2-family/.test(it.source.label)) continue;
    const w = it.when;
    const gated = !!w && (isLeaf(w, 'base.residential', 'one_two_family') || ('all' in w && w.all.some((c) => isLeaf(c, 'base.residential', 'one_two_family'))));
    if (!gated) v.push(`[R9] ${p.id}:${it.id}: cites "${it.source.label}" but is not gated to base.residential one_two_family`);
  }

  // (c) every question the GC answers is read by some predicate.
  const read = new Set<string>();
  const note = (pr: Predicate | null) => {
    if (!pr) return;
    for (const id of predicateQuestionIds(pr)) {
      read.add(id);
      for (const r of DERIVED_READS[id] ?? []) read.add(r);
    }
  };
  for (const p of input.packs) {
    note(p.appliesTo);
    p.questions.forEach((q) => note(q.askIf));
    p.items.forEach((it) => note(it.when));
    p.skips.forEach((s) => note(s.when));
    p.deptQuestions.forEach((d) => note(d.askIf));
  }
  for (const p of input.packs) for (const q of p.questions) {
    if (!read.has(q.id) && !(q.id in QUESTIONS_NOT_ON_ROUTE)) v.push(`[R9] ${p.id}:${q.id}: no item, skip or question reads this answer; wire it or drop the question`);
  }

  // (d) trade hints: traps never match, hits still do (the engine's own prefill).
  const wt = input.packs.flatMap((p) => p.questions).find((q) => q.prefill === 'scope_trades');
  if (!wt) v.push('[R9] trade hints: no scope_trades question');
  else {
    const picks = (line: string): string[] => {
      const r = prefillFor(wt, { parcel: null, buildingYear: null, officeTitle: null, placeMatch: null, scope: line, tradeHints: input.tradeHints });
      return r && Array.isArray(r.value) ? r.value.map(String) : [];
    };
    for (const [line, not] of TRADE_HINT_TRAPS) if (picks(line).includes(not)) v.push(`[R9] trade hints: "${line}" picks ${not}`);
    for (const [line, want] of TRADE_HINT_HITS) if (!picks(line).includes(want)) v.push(`[R9] trade hints: "${line}" no longer picks ${want}`);
  }
  return v;
}

// ---------------------------------------------------------------- R8 mutations

function replacePack(input: FactsInput, id: QuestionPack['id'], fn: (p: QuestionPack) => QuestionPack): FactsInput {
  return { ...input, packs: input.packs.map((p) => (p.id === id ? fn(p) : p)) };
}

const LI_SURVEY_RULE: ItemTemplate = {
  id: 'li.survey_rule',
  station: 'filing',
  kind: 'need',
  text: 'Long Island towns want a survey with the application.',
  who: ['gc'],
  certainty: 'verified',
  source: SOURCE_REFS.V11,
  askQuestionId: null,
  readiness: true,
  when: null,
};

export const MUTATIONS: readonly { name: string; rule: string; apply: (i: FactsInput) => FactsInput }[] = [
  {
    name: 'a verified Long Island survey item',
    rule: '[R4]',
    apply: (i) => replacePack(i, 'li_common', (p) => ({ ...p, items: [...p.items, LI_SURVEY_RULE] })),
  },
  {
    name: 'an inline URL as a source',
    rule: '[R1]',
    apply: (i) =>
      replacePack(i, 'nyc', (p) => ({
        ...p,
        items: p.items.map((it) =>
          it.id === 'nyc.permit_rule' ? { ...it, source: { label: 'NYC DOB · Do I need a permit?', url: SOURCES.V5.url, checkedOn: SOURCES.V5.checkedOn } } : it,
        ),
      })),
  },
  {
    name: 'an inline URL in item text',
    rule: '[R1]',
    apply: (i) =>
      replacePack(i, 'nassau', (p) => ({
        ...p,
        items: p.items.map((it) => (it.id === 'li.nassau_hic' ? { ...it, text: `${it.text} See https://www.nassaucountyny.gov/Faq.aspx?TID=36` } : it)),
      })),
  },
  {
    name: 'a stale checkedOn',
    rule: '[R2]',
    apply: (i) => ({ ...i, sources: { ...i.sources, V5: { ...i.sources.V5, checkedOn: '2025-12-01' } } }),
  },
  {
    name: 'a source off the allowlist',
    rule: '[R2]',
    apply: (i) => ({ ...i, sources: { ...i.sources, V13: { ...i.sources.V13, url: 'https://permits-r-us.example.com/hempstead' } } }),
  },
  {
    name: '"approved" in an item',
    rule: '[R6]',
    apply: (i) =>
      replacePack(i, 'nyc', (p) => ({
        ...p,
        items: p.items.map((it) => (it.id === 'nyc.dob_now' ? { ...it, text: 'Filings go through DOB NOW: Build and are approved there.' } : it)),
      })),
  },
  {
    name: 'a predicate pointing to a missing id',
    rule: '[R3]',
    apply: (i) =>
      replacePack(i, 'nyc', (p) => ({
        ...p,
        items: p.items.map((it) => (it.id === 'nyc.lpc' ? { ...it, when: { q: 'nyc.landmarked', is: 'yes' } } : it)),
      })),
  },
  {
    name: 'a duration in a department question',
    rule: '[R5]',
    apply: (i) =>
      replacePack(i, 'li_common', (p) => ({
        ...p,
        deptQuestions: p.deptQuestions.map((d) => (d.id === 'li.review_time' ? { ...d, text: 'Is plan review still about 6 weeks?' } : d)),
      })),
  },
  {
    name: 'a placeholder in an item the engine does not fill',
    rule: '[R6]',
    apply: (i) =>
      replacePack(i, 'suffolk', (p) => ({
        ...p,
        items: p.items.map((it) => (it.id === 'li.suffolk_check' ? { ...it, text: 'Check license {license} at the county.' } : it)),
      })),
  },
  {
    name: 'job type: Alteration without the work-type guard (an addition reads as a plain Alteration)',
    rule: '[R9]',
    apply: (i) =>
      replacePack(i, 'nyc', (p) => ({
        ...p,
        items: p.items.map((it) => (it.id === 'nyc.job_type_alt' ? { ...it, when: { q: 'nyc.co_change', is: 'no' } } : it)),
      })),
  },
  {
    name: 'a 1- and 2-family rule shown for every building type',
    rule: '[R9]',
    apply: (i) => replacePack(i, 'nyc', (p) => ({ ...p, items: p.items.map((it) => (it.id === 'nyc.rdp' ? { ...it, when: null } : it)) })),
  },
  {
    name: 'a question no line reads',
    rule: '[R9]',
    apply: (i) =>
      replacePack(i, 'li_common', (p) => ({
        ...p,
        items: p.items.filter((it) => it.id !== 'li.survey_note'),
      })),
  },
  {
    name: 'a bare "steel" trade hint',
    rule: '[R9]',
    apply: (i) => ({ ...i, tradeHints: { ...i.tradeHints, structural: [...(i.tradeHints.structural ?? []), 'steel'] } }),
  },
  {
    name: 'a department question without "?"',
    rule: '[R7]',
    apply: (i) =>
      replacePack(i, 'base', (p) => ({
        ...p,
        deptQuestions: p.deptQuestions.map((d) => (d.id === 'base.fees' ? { ...d, text: 'Send me your current fee schedule.' } : d)),
      })),
  },
];

// ---------------------------------------------------------------- run

if (import.meta.main) {
  let failed = false;
  const real = checkFacts(realInput());
  if (real.length) {
    failed = true;
    console.error(`FAIL: ${real.length} problem(s) in the Permit Path packs:`);
    for (const x of real) console.error(`  ${x}`);
  } else {
    const items = ALL_PACKS.reduce((n, p) => n + p.items.length, 0);
    const verified = ALL_PACKS.reduce((n, p) => n + p.items.filter((it) => it.certainty === 'verified').length, 0);
    const dq = ALL_PACKS.reduce((n, p) => n + p.deptQuestions.length, 0);
    const qs = ALL_PACKS.reduce((n, p) => n + p.questions.length, 0);
    console.log(`ok   packs: ${ALL_PACKS.length} packs, ${qs} questions, ${items} items (${verified} verified), ${dq} department questions, ${SOURCE_IDS.length} sources`);
  }
  for (const m of MUTATIONS) {
    const got = checkFacts(m.apply(realInput()));
    const hit = got.filter((x) => x.startsWith(m.rule));
    if (hit.length === 0) {
      failed = true;
      console.error(`FAIL: planted mutation "${m.name}" did not turn ${m.rule} red (got: ${got.join(' | ') || 'nothing'})`);
    } else {
      console.log(`ok   red as planted · ${m.name} → ${hit[0]}`);
    }
  }
  const sid: SourceId[] = [...SOURCE_IDS];
  if (failed) {
    console.error('validate-permit-path-facts: FAILED');
    process.exit(1);
  }
  console.log(`validate-permit-path-facts: OK (${sid.length} sources checked against ${FACTS_CLOCK}, ${MUTATIONS.length} planted mutations red)`);
}
