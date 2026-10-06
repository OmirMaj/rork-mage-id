// scripts/validate-esdfr-i18n.ts — the daily report in Spanish (wave-next W3,
// lane ESDFR). Pure; runs under bun.
//
// What it proves, and why each matters:
//   1. ENGLISH IS BYTE-IDENTICAL. The dailyLogCompletion sentence builders,
//      the "Add today's photos" chip and the voice-line stamp return exactly
//      the pre-i18n sentences (the old templates are re-implemented here and
//      compared over a sweep of counts), with lang omitted AND with 'en'.
//   2. SPANISH IS WHOLE SENTENCES. With lang 'es' every builder answers from
//      the catalog: no English word left, the plural agrees with the count,
//      the time reads "7:42 a.m." (docs/I18N.md, formatting).
//   3. THE SCREEN'S PURE BLOCKS TAKE A TRANSLATOR. app/daily-report.tsx's
//      validator-evaluated blocks cannot import, so the screen passes useT's
//      t in; run with no translator they are English (their own validators
//      stay green), run with the Spanish t they are Spanish. The English
//      constants they replaced are pinned equal to the keyed English.
//   4. THE VOICE PROMPT. utils/voiceDFRParser.ts appends ONE line, only for
//      Spanish; the English prompt is the pre-i18n prompt, byte for byte.
//   5. THE CATALOG. Every field.dfr key has Spanish; "daily report" is
//      "reporte diario" and "crew" is "cuadrilla" wherever the English says
//      so (glossary); no user-facing English on the screen says "homeowner"
//      or "Daily Field Report" (Part A copy fixes).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLang, t as coreT } from '../i18n/core';
import {
  dailyLogHeadline, dailyLogEmptyDayLine, dailyLogGapLine, dailyLogTodayLine,
  todaysPhotosToAttach, voiceLineStamp, type DailyLogCompletion,
} from '../utils/dailyLogCompletion';
import { EN } from '../i18n/catalog/en/field.daily-report.generated';
import { ES_FIELD_DFR } from '../i18n/catalog/es/field/dfr';
import { DFR_INCIDENT_TYPE_LABEL, DFR_TREATMENT_LABEL } from '../utils/safety/osha';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;
const transpile = (src: string) => new Transpiler({ loader: 'ts' }).transformSync(src);

// English words that must never survive in a Spanish sentence of this lane.
const ENGLISH = /\b(the|and|day|days|working|report|reports|photo|photos|today|log|logged|has|have|was|were|with|add|copy|from|crew|filed|client|owner|draft)\b/i;

// ── 1 + 2. dailyLogCompletion ───────────────────────────────────────────────
console.log('\ndailyLogCompletion — English unchanged, Spanish whole sentences:');
{
  // The pre-i18n templates, verbatim.
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const oldHeadline = (c: DailyLogCompletion) => (!c.hasRecord || c.closedExpectedDays === 0) ? null
    : `Daily log covers ${c.filedDays} of ${plural(c.closedExpectedDays, 'working day')}.`;
  const oldEmpty = (c: DailyLogCompletion) => {
    if (!c.hasRecord || c.emptyDayFilings === 0) return null;
    const n = c.emptyDayFilings;
    return `${n} of those ${n === 1 ? 'days was' : 'days were'} logged with no work on site. Those count: a filed day with nothing on it still keeps the record unbroken.`;
  };
  const oldGap = (c: DailyLogCompletion) => {
    if (!c.hasRecord || c.missedDays === 0) return null;
    const n = c.missedDays;
    return `${plural(n, 'working day')} in this stretch ${n === 1 ? 'has' : 'have'} no log. A report written now would carry today's date, not that day's, so the gap stays.`;
  };
  const oldToday = (c: DailyLogCompletion) => (!c.hasRecord || !c.todayExpected || c.todayFiled) ? null
    : 'Today has no log yet. If nothing happened on site, that is still the day to record.';

  const mk = (n: number, flags: Partial<DailyLogCompletion> = {}): DailyLogCompletion => ({
    hasRecord: true, closedExpectedDays: n, filedDays: Math.max(0, n - 1), emptyDayFilings: n, missedDays: n,
    todayExpected: true, todayFiled: false, ...flags,
  } as unknown as DailyLogCompletion);
  const cases: DailyLogCompletion[] = [];
  for (let n = 0; n <= 31; n++) cases.push(mk(n));
  cases.push(mk(3, { hasRecord: false }), mk(2, { todayFiled: true }), mk(2, { todayExpected: false }));

  setLang('en');
  let bad = '';
  for (const c of cases) {
    for (const [name, now, old] of [
      ['headline', dailyLogHeadline, oldHeadline], ['emptyDays', dailyLogEmptyDayLine, oldEmpty],
      ['gap', dailyLogGapLine, oldGap], ['today', dailyLogTodayLine, oldToday],
    ] as const) {
      const want = old(c);
      if (now(c) !== want || now(c, 'en') !== want) bad = bad || `${name} n=${c.closedExpectedDays}: ${JSON.stringify(now(c, 'en'))} ≠ ${JSON.stringify(want)}`;
    }
  }
  ok('the four record sentences are the pre-i18n English for n = 0…31 (lang omitted and \'en\')', bad === '', bad);

  // Spanish, with the app language still English: lang is the argument.
  const es1 = dailyLogHeadline(mk(1), 'es') ?? '';
  const es5 = dailyLogHeadline(mk(5), 'es') ?? '';
  ok('headline in Spanish: "reporte diario", singular at 1, plural at 5', es1 === 'El reporte diario cubre 0 de 1 día hábil.' && es5 === 'El reporte diario cubre 4 de 5 días hábiles.', `${es1} | ${es5}`);
  const gap1 = dailyLogGapLine(mk(1), 'es') ?? '';
  const gap3 = dailyLogGapLine(mk(3), 'es') ?? '';
  ok('gap line in Spanish agrees with the count', /^A 1 día hábil .* le falta/.test(gap1) && /^A 3 días hábiles .* les falta/.test(gap3), `${gap1} | ${gap3}`);
  const emp = [dailyLogEmptyDayLine(mk(1), 'es') ?? '', dailyLogEmptyDayLine(mk(4), 'es') ?? ''];
  ok('empty-day line in Spanish agrees with the count', /se registró sin trabajo/.test(emp[0]) && /se registraron sin trabajo/.test(emp[1]), emp.join(' | '));
  const all = [es1, es5, gap1, gap3, ...emp, dailyLogTodayLine(mk(2), 'es') ?? ''];
  ok('no English word is left in any Spanish record sentence', all.every((s) => s && !ENGLISH.test(s)), all.find((s) => ENGLISH.test(s)));
  ok('…and the app language did not leak into English (still byte-identical after the es calls)', dailyLogHeadline(mk(5)) === oldHeadline(mk(5)));

  // The photo chip.
  const ph = (id: string) => ({ id, uri: `file://${id}`, timestamp: '2026-09-28T12:00:00Z' });
  const five = ['a', 'b', 'c', 'd', 'e'].map(ph);
  const oldLabel = (dayWord: string, add: number, fresh: number, room: number) => add === 0 ? null
    : add === fresh ? `Add ${dayWord} ${add} ${add === 1 ? 'photo' : 'photos'}` : `Add ${dayWord} photos · ${room} more ${room === 1 ? 'fits' : 'fit'}`;
  let chipBad = '';
  for (const dayWord of ["today's", "that day's"]) {
    for (let have = 0; have <= 10; have++) {
      const attached = Array.from({ length: have }, (_, i) => ({ id: `x${i}` }));
      const plan = todaysPhotosToAttach(five, attached, 10, dayWord);
      const want = oldLabel(dayWord, plan.add.length, plan.available, plan.room);
      if (plan.label !== want || todaysPhotosToAttach(five, attached, 10, dayWord, 'en').label !== want) chipBad = chipBad || `${dayWord} have=${have}: ${plan.label} ≠ ${want}`;
    }
  }
  ok('the photo chip is the pre-i18n English for every fill level and both day words', chipBad === '', chipBad);
  const esToday = todaysPhotosToAttach(five, [], 10, "today's", 'es').label;
  const esThat = todaysPhotosToAttach([ph('a')], [], 10, "that day's", 'es').label;
  const esFits = todaysPhotosToAttach(five, Array.from({ length: 9 }, (_, i) => ({ id: `x${i}` })), 10, "today's", 'es').label;
  ok('the photo chip in Spanish is one sentence per day word', esToday === 'Agregar las 5 fotos de hoy' && esThat === 'Agregar 1 foto de ese día' && esFits === 'Agregar fotos de hoy · cabe 1 más', `${esToday} | ${esThat} | ${esFits}`);

  // The voice-line stamp.
  const at = new Date(2026, 8, 28, 7, 42);
  const pm = new Date(2026, 8, 28, 15, 5);
  ok('voice stamp in English is unchanged ("7:42 AM", "3:05 PM")', voiceLineStamp(at) === '7:42 AM' && voiceLineStamp(pm, 'en') === '3:05 PM', `${voiceLineStamp(at)} ${voiceLineStamp(pm, 'en')}`);
  ok('voice stamp in Spanish is "7:42 a.m." / "3:05 p.m."', voiceLineStamp(at, 'es') === '7:42 a.m.' && voiceLineStamp(pm, 'es') === '3:05 p.m.', `${voiceLineStamp(at, 'es')} ${voiceLineStamp(pm, 'es')}`);
  ok('an unreadable instant is still no stamp in either language', voiceLineStamp('nope') === '' && voiceLineStamp('nope', 'es') === '');
}

// ── 3. The screen's pure blocks ─────────────────────────────────────────────
console.log('\napp/daily-report.tsx — pure blocks: English by default, Spanish through t:');
const DFR = read('app/daily-report.tsx');
{
  const block = (a: string, b: string) => DFR.slice(DFR.indexOf(a), DFR.indexOf(b));
  const src = [
    block('// >>> dfr-screen-pure', '// <<< dfr-screen-pure'),
    block('// >>> dfr-document-pure', '// <<< dfr-document-pure'),
    block('// >>> dfr-w4-pure', '// <<< dfr-w4-pure'),
  ].join('\n');
  const names = ['DFR_OWNER_DECIDES_HOMEOWNER', 'DFR_GC_CREATES_COS', 'DFR_FILES_NEEDS_APP', 'DFR_SENT_MARKUP_NOTE',
    'dfrPublishControl', 'dfrPublishAccess', 'dfrIncidentFileNote', 'dfrSendPlan', 'dfrPhotoMarkupTarget',
    'dfrPortalSeatNote', 'dfrFiledBy', 'dfrCaseNotYoursReason'];
  type Fn = (...a: unknown[]) => unknown;
  const P = new Function(`${transpile(src.replace(/^export /gm, ''))}\nreturn { ${names.join(', ')} };`)() as Record<string, Fn & string>;
  const esT = (k: string, en: string, v?: Record<string, string | number>) => coreT(k as `field.${string}`, en, v, 'es');

  const enOut = JSON.stringify([
    P.dfrPublishControl(true, true), P.dfrPublishControl(false, false),
    P.dfrPublishAccess({ ownerUserId: 'x', userId: 'u', role: 'field' }), P.dfrPublishAccess({ ownerUserId: 'x', userId: 'u', role: null, roleLoading: true }),
    P.dfrIncidentFileNote(false), P.dfrSendPlan({ email: '', saveToggle: false, os: 'ios' }),
    P.dfrPhotoMarkupTarget({ photoId: 'a', galleryIds: ['a'], reportSent: true }),
    P.dfrPortalSeatNote({ canPublish: false, portalEnabled: false, isNew: true }),
    P.dfrFiledBy({ filedByUserId: 'gc', viewerId: 'fm', ownerUserId: 'gc' }),
    P.dfrCaseNotYoursReason({ caseVisible: false, caseDeleted: false, isOwner: false, savedHadIncident: true, filedByUserId: 'gc', viewerId: 'fm', authorPossessive: 'the project owner’s' }),
  ]);
  ok('with no translator every pure helper answers English (their own validators read this)',
    enOut.includes('Published. Tap to take it down.') && enOut.includes('The project owner decides what the client sees.')
    && enOut.includes('Checking your role on this job…') && enOut.includes('Pick a Destination')
    && enOut.includes('This project has no client portal') && enOut.includes('Filed by the project owner')
    && enOut.includes('This case is in the project owner’s injury log'), enOut.slice(0, 300));

  const es = [
    (P.dfrPublishControl(true, true, esT) as { label: string }).label,
    (P.dfrPublishAccess({ ownerUserId: 'x', userId: 'u', role: 'field' }, esT) as { reason: string }).reason,
    (P.dfrPublishAccess({ ownerUserId: 'x', userId: 'u', role: null, roleLoading: true }, esT) as { reason: string }).reason,
    P.dfrIncidentFileNote(true, esT) as string,
    (P.dfrSendPlan({ email: '', saveToggle: false, os: 'web' }, esT) as { blocker: { title: string; message: string } }).blocker.message,
    ((P.dfrPhotoMarkupTarget({ photoId: 'a', galleryIds: [] }, esT)) as { reason: string }).reason,
    P.dfrPortalSeatNote({ canPublish: false, portalEnabled: true, status: 'sent', isNew: false }, esT) as string,
    P.dfrPortalSeatNote({ canPublish: false, portalEnabled: false, isNew: false }, esT) as string,
    P.dfrPortalSeatNote({ canPublish: false, portalEnabled: true, status: 'draft', isNew: true }, esT) as string,
    (P.dfrPublishControl(false, false, esT) as { label: string }).label,
    (P.dfrSendPlan({ email: '', saveToggle: false, os: 'ios' }, esT) as { blocker: { title: string } }).blocker.title,
    P.dfrIncidentFileNote(false, esT) as string,
    (P.dfrFiledBy({ filedByUserId: 'ed', viewerId: 'gc', ownerUserId: 'gc', people: [{ userId: 'ed', name: 'Eddie' }] }, esT) as { hero: string }).hero,
    P.dfrCaseNotYoursReason({ caseVisible: false, caseDeleted: false, isOwner: false, savedHadIncident: true, filedByUserId: 'ed', viewerId: 'fm', authorPossessive: 'Eddie’s' }, esT) as string,
  ];
  ok('with the Spanish t every pure helper answers a Spanish sentence', es.every((s) => !!s && !ENGLISH.test(s.replace(/Eddie/g, ''))), es.find((s) => !s || ENGLISH.test(s.replace(/Eddie/g, ''))));
  ok('a named author stays one Spanish sentence (never "Eddie’s" spliced in)', es.includes('Lo registró Eddie') && es.some((x) => /registro de lesiones de Eddie:/.test(x)), es.join(' | ').slice(0, 300));

  // The constants the screen used to render are the keyed English, exactly.
  const enOf = (k: string) => (EN as Record<string, unknown>)[k];
  ok('DFR_OWNER_DECIDES_HOMEOWNER === field.dfr.portal.ownerDecides', P.DFR_OWNER_DECIDES_HOMEOWNER === enOf('field.dfr.portal.ownerDecides'));
  ok('DFR_GC_CREATES_COS === field.dfr.leak.gcCreatesCos', P.DFR_GC_CREATES_COS === enOf('field.dfr.leak.gcCreatesCos'));
  ok('DFR_FILES_NEEDS_APP === field.dfr.send.filesNeedApp', P.DFR_FILES_NEEDS_APP === enOf('field.dfr.send.filesNeedApp'));
  ok('DFR_SENT_MARKUP_NOTE === field.dfr.markup.sentNote', P.DFR_SENT_MARKUP_NOTE === enOf('field.dfr.markup.sentNote'));

  // The screen passes the translator at every rendered call.
  const code = DFR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  ok('the screen passes t to every rendered pure helper',
    /dfrPublishControl\(hsPublishedSaved, hsPublished, t\)/.test(code) && /\{dfrIncidentFileNote\(isProjectOwner, t\)\}/.test(code)
    && /dfrSendPlan\(\{ email: sendRecipientEmail, saveToggle: saveToProjectFiles, os: Platform\.OS \}, t\)/.test(code)
    && /dfrPhotoMarkupTarget\(\{ photoId, galleryIds: galleryPhotoIds, reportSent: reportIsSent \}, t\)/.test(code)
    && /isNew: !existingReport,\s*\}, t\);/.test(code) && /authorPossessive: filedBy\.possessive,\s*\}, t\);/.test(code));
  ok('no user-facing English on the screen says "homeowner" or "Daily Field Report" (Part A)',
    !Object.entries(EN).some(([k, v]) => k.startsWith('field.dfr.') && /homeowner/i.test(JSON.stringify(v)))
    && !/\btn?\('field\.dfr\.[^']+', (?:'[^']*|"[^"]*|\{[^}]*)homeowner/i.test(code) && !/Daily Field Report/.test(code));
  ok('the screen reads the language from useT (displayLang for the English-tree branches)', /const \{ t, tn, lang, displayLang \} = useT\(\);/.test(code));
}

// ── 3b. Incident chips, shared-component labels, no suffix fragments ────────
console.log('\napp/daily-report.tsx — incident chips and whole sentences (fix round 1):');
{
  const en = EN as Record<string, string | Record<string, string>>;
  const es = ES_FIELD_DFR as Record<string, { s: string | Record<string, string> } | undefined>;
  const code = DFR.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const typeKey: Record<string, string> = { injury: 'injury', near_miss: 'nearMiss', property: 'property', environmental: 'environmental' };
  const trKey: Record<string, string> = { none: 'none', first_aid: 'firstAid', medical_beyond_first_aid: 'medical' };
  const pairs: Array<[string, string]> = [
    ...Object.entries(DFR_INCIDENT_TYPE_LABEL).map(([k, v]) => [`field.dfr.incident.type.${typeKey[k]}`, v] as [string, string]),
    ...Object.entries(DFR_TREATMENT_LABEL).map(([k, v]) => [`field.dfr.incident.treatment.${trKey[k]}`, v] as [string, string]),
  ];
  const enDiff = pairs.filter(([k, v]) => en[k] !== v);
  ok('the 7 incident chip keys carry osha.ts English word for word (English unchanged)', pairs.length === 7 && enDiff.length === 0, enDiff);
  const esBad = pairs.filter(([k, v]) => !es[k] || es[k]!.s === v || ENGLISH.test(String(es[k]!.s)));
  ok('each incident chip has its own Spanish', esBad.length === 0, esBad.map(([k]) => k));
  ok('the chips render through the keyed helpers with useT\'s t, never the raw English maps',
    /\{incidentTypeL\(kind, t\)\}/.test(code) && /\{treatmentL\(tr, t\)\}/.test(code)
    && !/\{DFR_INCIDENT_TYPE_LABEL\[/.test(code) && !/\{DFR_TREATMENT_LABEL\[/.test(code)
    && /incidentSeverityL\(incident\.severity, t\)/.test(code));
  ok('the no-project picker and the voice upgrade eyebrow are keyed (no raw English prop)',
    /toolName=\{t\('field\.dfr\.picker\.toolName', 'Daily Reports'\)\}/.test(code)
    && /message=\{t\('field\.dfr\.picker\.message', 'Daily reports log weather, crew and progress on one project\.'\)\}/.test(code)
    && /featureLabel=\{t\('field\.dfr\.voiceCaptureFeature', 'Voice Capture'\)\}/.test(code)
    && !/daily field reports?|\bDFRs\b/i.test(Object.values(en).map((v) => JSON.stringify(v)).join(' ')));
  const fragments = Object.entries(en).filter(([k, v]) => k.startsWith('field.dfr.') && /^\s/.test(typeof v === 'string' ? v : Object.values(v)[0]));
  ok('no field.dfr key is a suffix fragment (none starts with a space)', fragments.length === 0, fragments.map(([k]) => k));
  ok('the three former suffixes are whole sentences per case',
    en['field.dfr.progress.filledReady'] === '{done} of {total} filled · ready to send'
    && en['field.dfr.incident.caseFiledCounted'] === 'Case filed. Edit people, actions and photos in Incidents · counted on the OSHA 300'
    && JSON.stringify(en['field.dfr.incident.restrictedWithDays']) === JSON.stringify({ one: 'Restricted work / transfer ({count} day entered)', other: 'Restricted work / transfer ({count} days entered)' })
    && !/readySuffix|countedSuffix|restrictedDaysEntered/.test(code));
  // The English children of those three stay the pre-fix tree, behind displayLang === 'en'.
  ok('English keeps its children: " · ready to send", " · counted on the OSHA 300" and " (n day(s) entered)" only in the English branch',
    /progressMeta\.isReady && displayLang === 'en' \? ' · ready to send' : ''/.test(code)
    && /: <>\{'Case filed. Edit people, actions and photos in Incidents'\}\{counted \? ' · counted on the OSHA 300' : ''\}<\/>\)\)\(isRecordableCase\(linkedIncident\)\)\}/.test(code)
    && /: <>\{'Restricted Work \/ Transfer'\}\{incidentClassInput\.daysRestricted \? ` \(\$\{incidentClassInput\.daysRestricted\} day\$\{incidentClassInput\.daysRestricted === 1 \? '' : 's'\} entered\)` : ''\}<\/>/.test(code));
  // The English literal tree must equal what the old tn produced, for every count.
  const oldTn = (n: number) => (n === 1 ? ` (${n} day entered)` : ` (${n} days entered)`);
  const newLit = (n: number) => ` (${n} day${n === 1 ? '' : 's'} entered)`;
  ok('the English restricted-days suffix is byte-identical to the old tn for 1..60', Array.from({ length: 60 }, (_, i) => i + 1).every((n) => oldTn(n) === newLit(n)));
  const esR = (n: number) => (es['field.dfr.incident.restrictedWithDays']!.s as Record<string, string>)[n === 1 ? 'one' : 'other'].replace('{count}', String(n));
  ok('Spanish restricted days agree with the count', esR(1) === 'Trabajo restringido / cambio de puesto (1 día registrado)' && esR(4) === 'Trabajo restringido / cambio de puesto (4 días registrados)', [esR(1), esR(4)]);
  ok('"Client update" is an update FOR the client', (es['field.dfr.clientUpdate']?.s) === 'Actualización para el cliente'
    && !Object.values(es).some((e) => e && /actualización del cliente/i.test(JSON.stringify(e.s))));
}

// ── 4. The voice DFR prompt ─────────────────────────────────────────────────
console.log('\nutils/voiceDFRParser.ts — one Spanish line, English prompt unchanged:');
{
  const V = read('utils/voiceDFRParser.ts');
  const LINE = /export const DFR_SPANISH_TRANSCRIPT_LINE = '([^']+)';/.exec(V)?.[1];
  ok('the Spanish line is the spec\'s sentence', LINE === 'The transcript may be Spanish or mixed Spanish and English. Write field values in Spanish.', LINE);
  const m = /prompt: `(You are a construction daily field report parser\.[\s\S]*?)`,\n\s*schema: DFRSchema/.exec(V);
  ok('the transcript prompt is found', !!m);
  const tpl = m?.[1] ?? '';
  const render = (lang: string) => new Function('lang', 'DFR_SPANISH_TRANSCRIPT_LINE', 'photoCtx', 'transcript', `return \`${tpl}\`;`)(lang, LINE, '<PHOTOS>', '<T>') as string;
  const ORIGINAL = 'You are a construction daily field report parser. Extract structured data from this voice transcript of a field worker describing their day on a construction site. Extract: weather conditions, manpower headcount by trade, work performed description, materials delivered, and any issues or delays mentioned. Be thorough but only extract what was actually said.<PHOTOS>\n\nTranscript:\n<T>';
  ok('English prompt is byte-identical to the pre-i18n prompt', render('en') === ORIGINAL, render('en').slice(0, 120));
  ok('Spanish prompt = English + the one line, before the photos and transcript', render('es') === ORIGINAL.replace('said.<PHOTOS>', `said. ${LINE}<PHOTOS>`));
  ok('the language defaults to the app language and the schema is untouched', /lang: Lang = getLang\(\),/.test(V) && /const DFRSchema = z\.object\(\{\n  weather: z\.object\(\{/.test(V));
}

// ── 5. The catalog ──────────────────────────────────────────────────────────
console.log('\ni18n/catalog/es/field/dfr.ts — coverage and glossary:');
{
  const en = EN as Record<string, string | Record<string, string>>;
  const es = ES_FIELD_DFR as Record<string, { s: string | Record<string, string> } | undefined>;
  const missing = Object.keys(en).filter((k) => k.startsWith('field.dfr.') && !es[k]);
  ok('every field.dfr key has Spanish', missing.length === 0, missing.slice(0, 8).join(', '));
  const text = (v: string | Record<string, string>) => (typeof v === 'string' ? v : Object.values(v).join(' | '));
  const drBad = Object.keys(en).filter((k) => /daily reports?\b/i.test(text(en[k])) && es[k] && !/reportes? diarios?/i.test(text(es[k]!.s)));
  ok('"daily report" is "reporte diario" wherever the English says it', drBad.length === 0, drBad.join(', '));
  const crewBad = Object.keys(en).filter((k) => /\bcrews?\b/i.test(text(en[k])) && es[k] && !/cuadrilla/i.test(text(es[k]!.s)));
  ok('"crew" is "cuadrilla" wherever the English says it', crewBad.length === 0, crewBad.join(', '));
  const banned = Object.keys(es).filter((k) => es[k] && /bitácora|estimación|usted/i.test(text(es[k]!.s)));
  ok('no "bitácora", "estimación" or usted in the in-app Spanish', banned.length === 0, banned.join(', '));
}

console.log(`\n${failed ? '✗' : '✓'} validate-esdfr-i18n: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
