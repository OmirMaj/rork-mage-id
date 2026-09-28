// validate-esclock-i18n.ts — the time clock, the punch list and AI punch in
// Spanish (wave-next W3, lane ESCLOCK). docs/I18N.md §3.5, docs/i18n-glossary-es.md.
//
//   A. The moments sentences (utils/moments/sites/fieldCopy.ts): every
//      time-clock and punch function is ONE key per sentence. In English each
//      returns, byte for byte, the sentence MOMFIELD wrote in W2; in Spanish
//      the whole reviewed-draft sentence with the data filled in. The closeout
//      binder and WIP functions stay English (Phase 2).
//   B. The display-string builders used only by the time clock
//      (utils/crewClockBatch.ts, and payrollBlockedReason / openShiftsNote /
//      outTimeProblem in utils/timeClockPayroll.ts) take a trailing `lang`:
//      English is byte-identical with or without it; Spanish is whole
//      sentences, and a pay period is never a numeric date (§6).
//   C. The glossary, over every entry in i18n/catalog/es/field/time.ts and
//      punch.ts: crew → cuadrilla, punch item → pendiente, clock in/out →
//      entrada/salida, never "OT", the punch STATUS "pending" is never
//      "pendiente", no Spain forms.
//
// Every rule is proven red on a planted defect first.
// Run via: bun run scripts/validate-esclock-i18n.ts

process.env.TZ = 'America/Los_Angeles';

import type { TimeEntry } from '../types';
import type { CatalogValue } from '../i18n/types';
import { setLang, getLang } from '../i18n/core';
import { ES_FIELD_TIME } from '../i18n/catalog/es/field/time';
import { ES_FIELD_PUNCH } from '../i18n/catalog/es/field/punch';
import { EN as EN_TIME } from '../i18n/catalog/en/field.time-clock.generated';
import { EN as EN_PUNCH } from '../i18n/catalog/en/field.punch.generated';
import * as F from '../utils/moments/sites/fieldCopy';
import * as B from '../utils/crewClockBatch';
import * as P from '../utils/timeClockPayroll';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}

// ── A. fieldCopy ──────────────────────────────────────────────────────────
// [export, args, the W2 English (MOMFIELD's templates, filled with the args)]
type Row = [keyof typeof F, unknown[], string];
const TIME_ROWS: Row[] = [
  ['clockOutSheetTitle', [], 'Clock out'],
  ['clockOutSummary', ['Jose', '8h 12m', '8.20'], 'Jose has been on the clock 8h 12m. This ends the shift and records 8.20 hours.'],
  ['clockOutSummaryAfterBreak', ['Jose', '8h 42m', '8h 12m', 30, '8.20'], 'Jose has been on the clock 8h 42m (8h 12m after a 30-min break). This ends the shift and records 8.20 hours.'],
  ['clockOutSlideLabel', [], 'Slide to clock out'],
  ['clockOutBusy', [], 'Clocking out…'],
  ['clockOutSrLabel', ['Jose'], 'Clock out Jose'],
  ['clockOutSrConfirm', [], 'Confirm clock out'],
  ['clockedOutTitle', ['8h 12m'], 'Clocked out · 8h 12m'],
  ['clockOutQueued', [], 'Clocked out on this phone · sends when online'],
  ['clockOutAlready', [], 'Already clocked out. Nothing was changed.'],
  ['clockOutRefused', [], 'Not clocked out. Something went wrong on our side, so the shift is still open.'],
  ['clockOutTimeout', ['Jose'], "No answer yet. Check Jose's shift before trying again."],
  ['clockOutTimeoutNoName', [], 'No answer yet. Check the shift before trying again.'],
  ['teamShiftCaption', ['Maria'], 'Maria logged this shift. It stays theirs, and their copy updates too.'],
  ['teamShiftCaptionUnnamed', [], 'A teammate logged this shift. It stays theirs, and their copy updates too.'],
  ['teamShiftNotOwn', [], 'Only shifts on your own projects can be closed here.'],
];
const PUNCH_ROWS: Row[] = [
  ['punchAllClosedBanner', ['Oak St'], 'Every punch item on Oak St is closed.'],
  ['closeProjectAction', [], 'Close the project'],
  ['closeProjectSheetBody', ['Oak St'], 'Oak St is marked closed and moves to Closeout in your projects list.'],
  ['closeProjectSlideLabel', [], 'Slide to close the project'],
  ['closeProjectBusy', [], 'Closing the project…'],
  ['closeProjectSrLabel', ['Oak St'], 'Close Oak St'],
  ['closeProjectNoNameSrLabel', [], 'Close the project'],
  ['closeProjectSrConfirm', [], 'Confirm close'],
  ['closeProjectBlocked', [], 'Close every punch item first.'],
  ['projectClosedTitle', [], 'Project closed'],
  ['projectClosedNextBinder', [], 'The closeout binder is ready to hand over.'],
  ['projectClosedNextFind', [], 'Find it under Closeout in your projects list.'],
  ['projectCloseQueued', [], 'Closed on this phone · sends when online'],
  ['projectCloseRefused', [], 'Not closed. Something went wrong on our side, so the project is still open.'],
  ['closeProjectTimeout', ['Oak St'], 'No answer yet. Check Oak St before trying again.'],
  ['closeProjectTimeoutNoName', [], 'No answer yet. Check the project before trying again.'],
];
/** Phase 2: these stay English in every language. */
const ENGLISH_ONLY: (keyof typeof F)[] = [
  'binderFinalizeSlideLabel', 'binderFinalizeBusy', 'binderFinalizeSrLabel', 'binderFinalizeSrConfirm', 'binderFinalizedTitle',
  'binderFinalizedNext', 'binderFinalizeRefused', 'binderFinalizeTimeout', 'binderFinalizeSaving', 'binderFinalizeOffline',
  'wipLockSheetTitle', 'wipLockSheetBody', 'wipLockSlideLabel', 'wipLockBusy', 'wipLockSrLabel', 'wipLockSrConfirm', 'wipLockedTitle',
  'wipLockedNext', 'wipLockQueued', 'wipLockRefused', 'wipLockTimeout', 'wipLockAlready', 'wipAlreadyLockedReason', 'wipNoPeriodReason',
];

const call = (mod: Record<string, unknown>, name: string, args: unknown[]) => (mod[name] as (...a: unknown[]) => string)(...args);

/** English words that mean an untranslated line slipped through in Spanish. */
const ENGLISH_TELL = /\b(the|and|clock(ed|ing)?|shift|project|punch|item|answer|yet|before|again|slide|confirm|already|nothing|changed|closed|sends|online|phone|something|wrong|still|open|logged|theirs|every|first)\b/i;

export function checkMoments(mod: Record<string, unknown>): string[] {
  const f: string[] = [];
  setLang('en');
  for (const [name, args, want] of [...TIME_ROWS, ...PUNCH_ROWS]) {
    const got = call(mod, name, args);
    if (got !== want) f.push(`en ${name}() = ${JSON.stringify(got)}, W2 said ${JSON.stringify(want)}`);
  }
  const enOnly = ENGLISH_ONLY.map((n) => call(mod, n, Array.from({ length: (mod[n] as (...a: unknown[]) => string).length }, () => 'Sep 2026')));
  setLang('es');
  try {
    for (const [name, args] of [...TIME_ROWS, ...PUNCH_ROWS]) {
      const got = call(mod, name, args);
      if (/[{}]/.test(got)) f.push(`es ${name}() left a placeholder: ${JSON.stringify(got)}`);
      if (ENGLISH_TELL.test(got.replace(/Oak St|Jose|Maria|Closeout/g, ''))) f.push(`es ${name}() is not Spanish: ${JSON.stringify(got)}`);
      for (const a of args) if (typeof a === 'string' && !got.includes(a)) f.push(`es ${name}() dropped the data ${JSON.stringify(a)}: ${JSON.stringify(got)}`);
    }
    ENGLISH_ONLY.forEach((n, i) => {
      const got = call(mod, n, Array.from({ length: (mod[n] as (...a: unknown[]) => string).length }, () => 'Sep 2026'));
      if (got !== enOnly[i]) f.push(`${n}() is Phase 2 and must stay English, got ${JSON.stringify(got)}`);
    });
  } finally {
    setLang('en');
  }
  return f;
}

// ── B. the builders ───────────────────────────────────────────────────────
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString();
const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  id: 'e1', projectId: 'P', projectName: 'Henderson', workerId: 'w1', workerName: 'Ava', trade: 'Framing',
  clockIn: at('2026-09-14', '07:00'), status: 'clocked_in', breakMinutes: 0, totalHours: 0, overtimeHours: 0,
  ...over,
} as TimeEntry);

export function checkBuilders(b: typeof B, p: typeof P): string[] {
  const f: string[] = [];
  const eq = (name: string, got: unknown, want: unknown) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) f.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  };
  setLang('en');
  // English, with and without the trailing lang: byte-identical to today.
  eq('clockInButton en', b.clockInButton(6, true), { label: 'Clock in 6', disabled: false, reason: null });
  eq('clockInButton en explicit', b.clockInButton(6, true, 'en'), b.clockInButton(6, true));
  eq('clockInButton nobody', b.clockInButton(0, true).reason, 'Tick who is on site');
  eq('allCrewChipLabel', [b.allCrewChipLabel(0, false), b.allCrewChipLabel(6, false), b.allCrewChipLabel(6, true)], ['Nobody left to clock in', 'All 6 on this project', 'Clear all 6']);
  eq('listNames', [b.listNames(['A']), b.listNames(['A', 'B']), b.listNames(['A', 'B', 'C'])], ['A', 'A and B', 'A, B and C']);
  const crew = [{ id: 'a', name: 'Ava' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cal' }];
  eq('splitAlreadyOnClock one', b.splitAlreadyOnClock(crew, new Map([['b', {}]])).note, 'Ben is already on the clock, so they were left out — a second shift is paid twice.');
  eq('splitAlreadyOnClock many', b.splitAlreadyOnClock(crew, new Map([['b', {}], ['c', {}]])).note, 'Ben and Cal are already on the clock, so they were left out — a second shift is paid twice.');
  const flag = (status: 'expired', type: string) => ({ certId: type, type, status, expiresDate: '2026-09-12', label: type });
  eq('batchLapsedText one', b.batchLapsedText(crew, { a: [flag('expired', 'SST')] } as never)?.message,
    '1 crew member you picked has a lapsed card.\n\nAva: SST (expired Sep 12)\n\nClock them in anyway, or leave them out?');
  eq('batchLapsedText many', b.batchLapsedText(crew, { a: [flag('expired', 'SST')], c: [flag('expired', 'OSHA 10'), flag('expired', 'SST')] } as never)?.message,
    '2 crew members you picked have a lapsed card.\n\nAva: SST (expired Sep 12)\nCal: OSHA 10 (expired Sep 12), SST (expired Sep 12)\n\nClock them in anyway, or leave them out?');
  const NOW = Date.parse(at('2026-09-14', '16:00'));
  const own = [entry({ id: 'x' }), entry({ id: 'y', workerName: 'Ben' })];
  const outMs = Date.parse(at('2026-09-14', '15:30'));
  const plan = b.planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs, nowMs: NOW, alertHours: 8 });
  eq('planBatchClockOut title', plan.title, 'Clock out 2 at 3:30 pm?');
  eq('planBatchClockOut message', plan.message, "Ends the shifts of Ava and Ben on Henderson at 3:30 pm. Each keeps its own hours, and a running break is taken off. Shifts on other projects, your team's, and missed clock-outs are not touched.");
  eq('planBatchClockOut one', b.planBatchClockOut({ ownEntries: [own[0]], projectId: 'P', jobName: 'Henderson', outMs, nowMs: NOW, alertHours: 8 }).message,
    "Ends Ava's shift on Henderson at 3:30 pm. Each keeps its own hours, and a running break is taken off. Shifts on other projects, your team's, and missed clock-outs are not touched.");
  const none = b.planBatchClockOut({ ownEntries: own, projectId: 'EMPTY', jobName: 'Empty', outMs, nowMs: NOW, alertHours: 8 });
  eq('planBatchClockOut none', [none.title, none.problem], ['Nobody to clock out', 'Nobody you clocked in is on the clock on Empty.']);
  eq('planBatchClockOut future', b.planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs: NOW + 7_200_000, nowMs: NOW, alertHours: 8 }).problem,
    'Ava: The out time can’t be later than now.');
  const period = { start: '2026-09-14', end: '2026-09-20' };
  eq('payrollBlockedReason empty', p.payrollBlockedReason({ rows: [], open: [] } as never, period), 'No finished shifts between 2026-09-14 and 2026-09-20. Pick another week or project.');
  eq('payrollBlockedReason open', p.payrollBlockedReason({ rows: [], open: [entry({})] } as never, period), 'Nobody has finished a shift between 2026-09-14 and 2026-09-20 yet — 1 still on the clock. Clock them out first.');
  eq('openShiftsNote', [p.openShiftsNote([entry({ workerName: 'Mike' })]), p.openShiftsNote([entry({ workerName: '' })])], ['1 crew still on the clock (Mike) — not included', '1 crew still on the clock — not included']);
  const inMs = Date.parse(entry({}).clockIn);
  eq('outTimeProblem en', [p.outTimeProblem(entry({}), NaN, NOW), p.outTimeProblem(entry({}), inMs, NOW), p.outTimeProblem(entry({}), NOW + 120_000, NOW), p.outTimeProblem(entry({}), inMs + 25 * 3_600_000, inMs + 30 * 3_600_000)],
    ['Enter the time they left, e.g. 3:30 pm.', 'The out time has to be after the clock-in.', 'The out time can’t be later than now.', 'A shift can’t run past 24 hours. Pick a time within a day of the clock-in.']);

  // Spanish: whole sentences, no English left, no numeric date.
  const es: [string, string | null | undefined][] = [
    ['clockInButton', b.clockInButton(6, true, 'es').label],
    ['clockInButton reason', b.clockInButton(0, true, 'es').reason],
    ['allCrewChipLabel', b.allCrewChipLabel(6, false, 'es')],
    ['splitAlreadyOnClock', b.splitAlreadyOnClock(crew, new Map([['b', {}], ['c', {}]]), 'es').note],
    ['batchLapsedText', b.batchLapsedText(crew, { a: [flag('expired', 'SST')] } as never, 'es')?.message.replace(/SST/g, '')],
    ['planBatchClockOut title', b.planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs, nowMs: NOW, alertHours: 8 }, 'es').title],
    ['planBatchClockOut message', b.planBatchClockOut({ ownEntries: own, projectId: 'P', jobName: 'Henderson', outMs, nowMs: NOW, alertHours: 8 }, 'es').message.replace('Henderson', '')],
    ['payrollBlockedReason', p.payrollBlockedReason({ rows: [], open: [] } as never, period, 'es')],
    ['openShiftsNote', p.openShiftsNote([entry({ workerName: 'Mike' })], 'es')?.replace('Mike', '')],
    ['outTimeProblem', p.outTimeProblem(entry({}), inMs, NOW, 'es')],
  ];
  for (const [name, s] of es) {
    if (!s) { f.push(`es ${name}: no text`); continue; }
    if (/[{}]/.test(s)) f.push(`es ${name} left a placeholder: ${JSON.stringify(s)}`);
    if (/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\b/.test(s)) f.push(`es ${name} prints a numeric date: ${JSON.stringify(s)}`);
    if (ENGLISH_TELL.test(s.replace(/ pm\b/g, ''))) f.push(`es ${name} is not Spanish: ${JSON.stringify(s)}`);
  }
  if (b.listNames(['A', 'B', 'C'], 'es') !== 'A, B y C') f.push(`es listNames: ${JSON.stringify(b.listNames(['A', 'B', 'C'], 'es'))}`);
  return f;
}

// ── C. the glossary over the two es shards ────────────────────────────────
const other = (v: CatalogValue): string => (typeof v === 'string' ? v : [v.one, v.other, v.many ?? '', v.zero ?? ''].join(' | '));
export function checkGlossary(en: Record<string, CatalogValue>, es: Record<string, { s: CatalogValue }>): string[] {
  const f: string[] = [];
  for (const [k, e] of Object.entries(es)) {
    const E = en[k];
    if (E === undefined) continue;
    const eng = other(E);
    const spa = other(e.s);
    if (/\bcrew\b/i.test(eng) && !/cuadrilla/i.test(spa)) f.push(`${k}: "crew" is cuadrilla — ${JSON.stringify(spa)}`);
    if (/\bpunch items?\b/i.test(eng) && !/pendiente/i.test(spa)) f.push(`${k}: a punch item is un pendiente — ${JSON.stringify(spa)}`);
    if (/\bclock(ed|ing)? (in|out)\b|\bclock-(in|out)\b|\bclock(ed|ing)? (them|everyone|crew) (in|out)\b/i.test(eng) && !/entrada|salida/i.test(spa)) f.push(`${k}: clock in/out is marcar entrada/salida — ${JSON.stringify(spa)}`);
    if (/\bOT\b/.test(spa)) f.push(`${k}: never "OT" in Spanish (H. extra) — ${JSON.stringify(spa)}`);
    if (/\bequipo\b/i.test(spa) && /\bcrew\b/i.test(eng)) f.push(`${k}: crew is never "equipo" — ${JSON.stringify(spa)}`);
    if (/\bpending\b/i.test(eng) && /pendiente/i.test(spa) && !/\bpunch\b/i.test(eng)) f.push(`${k}: the status "pending" is not "pendiente" (glossary D3) — ${JSON.stringify(spa)}`);
    if (/\b(vosotros|ordenador|móvil|vale|coger|pulse|pulsa|hormigón|fontaner\w*|bitácora|estimación)\b/i.test(spa)) f.push(`${k}: a form the glossary forbids — ${JSON.stringify(spa)}`);
    if (/\busted\b/i.test(spa)) f.push(`${k}: in-app Spanish is tú — ${JSON.stringify(spa)}`);
  }
  return f;
}

// ── planted proofs ────────────────────────────────────────────────────────
console.log('\nPlanted defects (each rule must go red):');
{
  const base = { ...(F as unknown as Record<string, unknown>) };
  ok('A red on planted: a changed English sentence', checkMoments({ ...base, clockOutAlready: () => 'Already clocked out.' }).some((x) => /clockOutAlready/.test(x)));
  ok('A red on planted: an English sentence in Spanish', checkMoments({ ...base, clockOutRefused: () => 'Not clocked out. Something went wrong on our side, so the shift is still open.' }).some((x) => /es clockOutRefused/.test(x)));
  ok('A red on planted: Spanish that drops the name', checkMoments({ ...base, clockOutTimeout: () => 'Aún no hay respuesta.' }).some((x) => /dropped the data/.test(x)));
  ok('A red on planted: a Phase 2 line that turns Spanish', checkMoments({ ...base, wipLockBusy: () => (getLang() === 'es' ? 'Bloqueando el periodo…' : 'Locking the period…') }).some((x) => /Phase 2/.test(x)));
  ok('B red on planted: English that changed', checkBuilders({ ...B, listNames: () => 'A, B, and C' } as typeof B, P).some((x) => /listNames/.test(x)));
  ok('B red on planted: a numeric date in Spanish', checkBuilders(B, { ...P, payrollBlockedReason: (s: never, per: { start: string }, lang?: string) => (lang === 'es' ? `No hay turnos desde ${per.start}.` : P.payrollBlockedReason(s, per as never)) } as unknown as typeof P).some((x) => /numeric date/.test(x)));
  ok('C red on planted: crew as equipo', checkGlossary({ 'x.k': 'Clock in crew' }, { 'x.k': { s: 'Marcar entrada al equipo' } }).length > 0);
  ok('C red on planted: a punch item not called pendiente', checkGlossary({ 'x.k': 'Add punch item' }, { 'x.k': { s: 'Agregar tarea' } }).length > 0);
  ok('C red on planted: OT in Spanish', checkGlossary({ 'x.k': 'OT so far' }, { 'x.k': { s: 'OT hasta ahora' } }).length > 0);
  ok('C red on planted: the status pending as pendiente', checkGlossary({ 'x.k': '{a} saved · {b} pending' }, { 'x.k': { s: '{a} guardados · {b} pendientes' } }).length > 0);
  ok('C passes a clean entry', checkGlossary({ 'x.k': 'Clock in crew' }, { 'x.k': { s: 'Marcar entrada a la cuadrilla' } }).length === 0);
}

console.log('\nA. The moments sentences: one key each, English byte-identical, Spanish whole:');
{
  const f = checkMoments(F as unknown as Record<string, unknown>);
  ok(`fieldCopy time-clock + punch functions (${TIME_ROWS.length + PUNCH_ROWS.length}) and the Phase 2 lines`, f.length === 0, f.join('\n      '));
}

console.log('\nB. The time clock\'s builders take `lang`: English unchanged, Spanish whole:');
{
  const f = checkBuilders(B, P);
  ok('crewClockBatch + payrollBlockedReason / openShiftsNote / outTimeProblem', f.length === 0, f.join('\n      '));
}

console.log('\nC. The glossary over es/field/time.ts and es/field/punch.ts:');
{
  const f = [...checkGlossary(EN_TIME as Record<string, CatalogValue>, ES_FIELD_TIME as never), ...checkGlossary(EN_PUNCH as Record<string, CatalogValue>, ES_FIELD_PUNCH as never)];
  ok(`${Object.keys(ES_FIELD_TIME).length + Object.keys(ES_FIELD_PUNCH).length} entries follow the glossary`, f.length === 0, f.join('\n      '));
  const missing = [...Object.keys(EN_TIME).filter((k) => !(k in ES_FIELD_TIME)), ...Object.keys(EN_PUNCH).filter((k) => !(k in ES_FIELD_PUNCH))].filter((k) => !k.includes('.legal.'));
  ok('every key the lane created has its Spanish', missing.length === 0, missing.join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
