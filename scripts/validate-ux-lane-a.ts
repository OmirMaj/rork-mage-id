// scripts/validate-ux-lane-a.ts — UX wave, lane A: the daily log, voice, and
// what the app reminds you about.
//
// Pins the pure rules this lane added and the screen wiring it cannot import:
//   A1  "Add today's N job photos" (todaysPhotosToAttach) + Photos under Work
//       Performed + ONE "Fill it for me" door above the first field;
//   A2  the remembered recipient (dfrRecipientPrefill, the mageid_ key, saved
//       only after a real send, never over the sample lock);
//   A4  a voice note appends to today's UNSENT report (planVoiceLogWrite) —
//       the rule; the two call sites are in the held UniversalMicButton;
//   A5  a voice-created draft does not file its day; every report he saved
//       himself does (computeDailyLogCompletion, attentionRows, DailyLogCard);
//   A7  RFIs / submittals in the canonical attention set, rows that open the
//       record, per-job punch rows, the CO rollup to /waiting-on, and the
//       dock's Remind / Nudge / Prep through the shared helpers
//       (utils/chaseNudge, utils/remindInvoice).
//
// Pure: bun + node:fs. The screens are asserted by source scan (comments
// stripped first, so a comment can never satisfy a pin).
//
// Run: bun scripts/validate-ux-lane-a.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  computeDailyLogCompletion, isVoiceOnlyReport, withVoiceOriginCleared, VOICE_ORIGIN,
  todaysPhotosToAttach, dayPhotoAsReportPhoto, oneTapDayPhotos,
  dfrLastRecipientKey, parseDfrRecipient, dfrRecipientPrefill, dfrRecipientLine,
  planVoiceLogWrite, type VoiceLogReport, type DailyLogReport,
} from '../utils/dailyLogCompletion';
import {
  buildDailyLogGaps, dailyLogGapLine, dailyLogGapTarget, dailyLogVoiceDraft, punchAttentionByJob,
} from '../utils/portfolio/attentionRows';
import {
  rfiAttention, submittalAttention, invoiceAttention, permitAttention,
  punchAttention, changeOrderAttention, scopePunchToProject, coRollupToWaitingOn,
} from '../utils/brainWatch';
import {
  appendChase, recordChaseToLog, onChaseRecorded, chaseRecipientEmail, chaseMailSubject,
  sendNudge, CHASE_LOG_KEY, chaseLogId, DID_YOU_SEND_TITLE, DID_YOU_SEND_YES, DID_YOU_SEND_NO,
  type SendNudgeDeps, type ShareResult,
} from '../utils/chaseNudge';
import { isAppStorageKey, selectTenantKeysToWipe } from '../utils/localCacheKeys';
import type { Project, RFI, Submittal, Invoice, Permit, PunchItem, ChangeOrder } from '../types';
import type { AlertButton } from '../utils/alertCore';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const raw = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string) => raw(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// 2026-09-14 is a Monday. Bare day keys are read untouched (local days).
const MON = '2026-09-14', TUE = '2026-09-15', WED = '2026-09-16';
const crew = [{ id: 'm1', trade: 'Framer', company: 'Smith', headcount: 3, hoursWorked: 8 }];
const rep = (id: string, date: string, o: Partial<DailyLogReport> = {}): DailyLogReport => ({ id, date, manpower: crew, ...o });

// ── A5 ─────────────────────────────────────────────────────────────────────
console.log('\nA5 — a voice-created draft does not file its day:');
{
  const voiceToday = computeDailyLogCompletion({
    reports: [rep('a', MON), rep('b', TUE), rep('v', WED, { origin: VOICE_ORIGIN })],
    todayISO: WED,
  });
  ok('today with only a voice note is NOT filed', voiceToday.todayFiled === false);
  ok('…it is named as today\'s voice draft', voiceToday.todayVoiceDraftId === 'v', String(voiceToday.todayVoiceDraftId));
  ok('…and listed as a voice-only day', voiceToday.voiceOnlyDays[0]?.date === WED && voiceToday.voiceOnlyDays[0]?.reportId === 'v');
  ok('…and it is not "missing" either', voiceToday.missedDays === 0, String(voiceToday.missedDays));

  const voicePast = computeDailyLogCompletion({
    reports: [rep('a', MON), rep('v', TUE, { origin: 'voice' })],
    todayISO: WED,
  });
  ok('a past voice-only day is neither filed nor missed', voicePast.filedDays === 1 && voicePast.missedDays === 0 && voicePast.closedExpectedDays === 2,
    `filed ${voicePast.filedDays} missed ${voicePast.missedDays} closed ${voicePast.closedExpectedDays}`);
  ok('…it breaks the running streak (not filed)', voicePast.currentStreak === 0);
  ok('…and reads as a voice-only day', voicePast.voiceOnlyDays.length === 1 && voicePast.voiceOnlyDays[0].date === TUE);

  // He opens it in the form and saves: the marker is cleared → filed.
  const savedPatch = withVoiceOriginCleared({ workPerformed: 'x' }) as { origin?: unknown };
  ok('the form save clears the marker', 'origin' in savedPatch && savedPatch.origin === undefined);
  const afterSave = computeDailyLogCompletion({
    reports: [rep('a', MON), { ...rep('v', TUE, { origin: 'voice' }), ...savedPatch }],
    todayISO: WED,
  });
  ok('after he saves it, the day reads filed', afterSave.filedDays === 2 && afterSave.voiceOnlyDays.length === 0 && afterSave.currentStreak === 2);

  const formDraft = computeDailyLogCompletion({ reports: [rep('a', MON), rep('f', TUE)], todayISO: TUE });
  ok('a form-saved draft still files its day', formDraft.todayFiled && formDraft.filedDays === 2);
  const noWork = computeDailyLogCompletion({ reports: [rep('a', MON), { id: 'n', date: TUE }], todayISO: TUE });
  ok('a no-work-day filing still counts (and as a no-work day)', noWork.todayFiled && noWork.emptyDayFilings === 1);
  const both = computeDailyLogCompletion({ reports: [rep('v', TUE, { origin: 'voice' }), rep('f', TUE)], todayISO: TUE });
  ok('a voice note beside a real report: the day is filed', both.todayFiled && both.voiceOnlyDays.length === 0 && both.todayVoiceDraftId === null);
  const onlyVoice = computeDailyLogCompletion({ reports: [rep('v', WED, { origin: 'voice' })], todayISO: WED });
  ok('a first-ever voice note opens the record (hasRecord) without filing', onlyVoice.hasRecord && !onlyVoice.todayFiled && onlyVoice.todayVoiceDraftId === 'v');
  ok('no reports: still no record (the no-nag guard)', computeDailyLogCompletion({ reports: [], todayISO: WED }).hasRecord === false);
  ok('isVoiceOnlyReport reads only the voice origin', isVoiceOnlyReport({ origin: 'voice' }) && !isVoiceOnlyReport({ origin: 'scan' }) && !isVoiceOnlyReport({}) && !isVoiceOnlyReport(null));

  // The surfaces: attentionRows + DailyLogCard.
  const proj = { id: 'p1', name: 'Henderson', status: 'in_progress' } as unknown as Project;
  const rows = buildDailyLogGaps([proj], [
    { ...rep('a', MON), projectId: 'p1' }, { ...rep('b', TUE), projectId: 'p1' }, { ...rep('v', WED, { origin: 'voice' }), projectId: 'p1' },
  ] as never, WED);
  ok('the row shows for a voice-only today', rows.length === 1);
  ok('…reading "voice note only · finish it"', /voice note only · finish it/i.test(dailyLogGapLine(rows[0])), dailyLogGapLine(rows[0]));
  const tgt = dailyLogGapTarget(rows[0]);
  ok('…and one tap opens THAT report', tgt.reportId === 'v' && !tgt.new && !tgt.date, JSON.stringify(tgt));
  const pastRows = buildDailyLogGaps([proj], [
    { ...rep('a', MON), projectId: 'p1' }, { ...rep('v', TUE, { origin: 'voice' }), projectId: 'p1' }, { ...rep('c', WED), projectId: 'p1' },
  ] as never, WED);
  ok('a past voice-only day keeps a row even with today filed', pastRows.length === 1 && dailyLogVoiceDraft(pastRows[0])?.reportId === 'v');
  const gapRows = buildDailyLogGaps([proj], [{ ...rep('a', MON), projectId: 'p1' }, { ...rep('c', WED), projectId: 'p1' }] as never, WED);
  ok('a real gap still reads "missing" (not voice)', gapRows.length === 1 && /1 day missing/.test(dailyLogGapLine(gapRows[0])) && dailyLogGapTarget(gapRows[0]).date === TUE);

  const card = code('components/home/DailyLogCard.tsx');
  ok('DailyLogCard opens a voice-only row\'s draft (dailyLogGapTarget) before the gap / new-report rule',
    /if \(voiceRow && dailyLogVoiceDraft\(voiceRow\)\) \{\s*router\.push\(\{ pathname: '\/daily-report', params: dailyLogGapTarget\(voiceRow\) \}\);\s*return;/.test(card));
  ok('DailyLogCard names a voice-only row', /VOICE_NOTE_ONLY/.test(card) && /dailyLogVoiceDraft\(r\)/.test(card));
}

// ── A1 ─────────────────────────────────────────────────────────────────────
console.log('\nA1 — today\'s photos in one tap:');
{
  const ph = (id: string, extra: Record<string, unknown> = {}) => ({ id, uri: `file:///${id}.jpg`, timestamp: `${WED}T15:00:00.000Z`, ...extra });
  const three = todaysPhotosToAttach([ph('a'), ph('b'), ph('c')], [], 10);
  ok('3 photos today → "Add today\'s 3 job photos", one tap attaches 3', three.label === "Add today's 3 job photos" && three.add.length === 3, String(three.label));
  ok('0 photos → no chip', todaysPhotosToAttach([], [], 10).label === null);
  const nineOn = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}` }));
  const oneFits = todaysPhotosToAttach([ph('a'), ph('b'), ph('c')], nineOn, 10);
  ok('9 already attached → adds 1 and says "1 more fits"', oneFits.add.length === 1 && /1 more fits$/.test(oneFits.label ?? ''), String(oneFits.label));
  const dedupe = todaysPhotosToAttach([ph('a'), ph('b'), ph('a')], [{ id: 'a' }], 10);
  ok('photos already on the report (same id) are skipped', dedupe.add.map(p => p.id).join(',') === 'b' && dedupe.label === "Add today's 1 job photo", String(dedupe.label));
  ok('a full report shows no chip', todaysPhotosToAttach([ph('z')], Array.from({ length: 10 }, (_, i) => ({ id: `y${i}` })), 10).label === null);
  ok('a backdated report says "that day\'s"', todaysPhotosToAttach([ph('a')], [], 10, "that day's").label === "Add that day's 1 job photo");
  // Integration fix: a delivery ticket ("It's here now" files it tagged
  // 'Delivery ticket') can carry supplier pricing; the one tap never sends it.
  const withTicket = oneTapDayPhotos([ph('a'), ph('t', { tag: 'Delivery ticket' }), ph('b', { tag: 'Framing' })]);
  const tPlan = todaysPhotosToAttach(withTicket, [], 10);
  ok('a delivery-ticket photo is not in the one tap, and the chip count leaves it out',
    tPlan.add.map(p => p.id).join(',') === 'a,b' && tPlan.label === "Add today's 2 job photos", String(tPlan.label));
  ok('…a day of only tickets shows no chip', todaysPhotosToAttach(oneTapDayPhotos([ph('t', { tag: 'Delivery ticket' })]), [], 10).label === null);
  const conv = dayPhotoAsReportPhoto({ ...ph('g'), storagePath: 'u/p/g.jpg', latitude: 40.7, longitude: -74, locationLabel: 'Site' } as never);
  ok('a gallery photo keeps its id, storage path and capture GPS', conv.id === 'g' && conv.storagePath === 'u/p/g.jpg' && conv.latitude === 40.7 && conv.locationLabel === 'Site');

  const dr = code('app/daily-report.tsx');
  const iWork = dr.indexOf('Work Performed</Text>');
  const iPhotos = dr.indexOf('Photos ({photos.length}/10)');
  const iMats = dr.indexOf('Materials Delivered</Text>');
  ok('Photos renders directly under Work Performed', iWork > 0 && iPhotos > iWork && iMats > iPhotos, `${iWork} ${iPhotos} ${iMats}`);
  ok('the chip is in the Photos card and needs the tap', /testID="dfr-add-todays-photos"/.test(dr) && /onPress=\{handleAddTodaysPhotos\}/.test(dr));
  ok('both one-tap plans read the ticket-free list, never the raw day photos',
    (dr.match(/todaysPhotosToAttach\(oneTapPhotos, /g) ?? []).length === 2 && !/todaysPhotosToAttach\(todaysProjectPhotos/.test(dr)
    && /const oneTapPhotos = useMemo\(\(\) => oneTapDayPhotos\(todaysProjectPhotos\)/.test(dr));
  ok('Deliveries files the ticket under the shared tag', /tag: DELIVERY_TICKET_TAG/.test(code('app/deliveries.tsx')));
  ok('ONE "Fill it for me" door', (dr.match(/testID="dfr-fill-door"/g) ?? []).length === 1);
  const iDoor = dr.indexOf('testID="dfr-fill-door"');
  const iVoice = dr.indexOf('<TutorialTarget id="dfr.voice">');
  const iPhotoChoice = dr.indexOf('testID="dfr-fill-from-photos"');
  const iFirstField = dr.indexOf('<Text style={styles.sectionTitle}>Weather</Text>');
  ok('the door is above the first field and holds Say it + From today\'s photos', iDoor > 0 && iVoice > iDoor && iPhotoChoice > iVoice && iFirstField > iPhotoChoice);
  ok('the photo draft keeps its own gate and metering (not the dictation parser)',
    /<AIDFRFromPhotos[\s\S]{0,400}isLocked=\{voiceBlocked\}/.test(dr) && /recordAIUsage\('fast', 'voiceCapture'\)/.test(dr));
  ok('each choice shows its own lock', /voiceBlocked\s*\n?\s*\? <Lock/.test(dr) && /label="Say it — dictate the day"/.test(dr));
  ok('the save does not mirror a gallery photo back as a duplicate', (dr.match(/inGallery\.has\(p\.id\)/g) ?? []).length === 2);
  ok('A5: the form save clears the voice marker', /updateDailyReport\(savedRecord\.id, withVoiceOriginCleared\(\{/.test(dr));
}

// ── A2 ─────────────────────────────────────────────────────────────────────
console.log('\nA2 — remember who gets the report:');
{
  const key = dfrLastRecipientKey('p1');
  ok('the key is per project under mageid_', key === 'mageid_dfr_last_recipient:p1');
  ok('…app-owned (the tenant sweep sees it)', isAppStorageKey(key));
  ok('…and wiped on a tenant switch', selectTenantKeysToWipe([key]).length === 1);
  ok('parse: a stored recipient round-trips', parseDfrRecipient(JSON.stringify({ name: 'Tom Reyes', email: 'tom@arch.com' }))?.email === 'tom@arch.com');
  ok('parse: garbage or a bad address is no recipient', parseDfrRecipient('{') === null && parseDfrRecipient(JSON.stringify({ email: 'nope' })) === null && parseDfrRecipient(null) === null);
  const last = dfrRecipientPrefill({ last: { name: 'Tom Reyes', email: 'tom@arch.com' }, settingsRecipients: ['pm@x.com'] });
  ok('this job\'s last recipient comes first', last?.email === 'tom@arch.com' && last.source === 'last');
  ok('the line reads "Tom Reyes (tom@arch.com)"', last ? dfrRecipientLine(last) === 'Tom Reyes (tom@arch.com)' : false);
  const fromSettings = dfrRecipientPrefill({ last: null, settingsRecipients: ['', 'bad', 'pm@x.com'], contacts: [{ firstName: 'Pat', lastName: 'M', email: 'PM@x.com' }] });
  ok('settings.dfrRecipients is the fallback, named from a contact', fromSettings?.email === 'pm@x.com' && fromSettings.name === 'Pat M' && fromSettings.source === 'settings');
  ok('nothing on file → no prefill (the blank sheet)', dfrRecipientPrefill({ last: null, settingsRecipients: [] }) === null);

  const dr = code('app/daily-report.tsx');
  const iSample = dr.indexOf('if (samplePlan.sample) {');
  const iPrefill = dr.indexOf('} else if (!sendRecipientEmail.trim() && !contactPicked) {');
  ok('the sample lock overrides the prefill', iSample > 0 && iPrefill > iSample && iPrefill - iSample < 400);
  const iSent = dr.indexOf('emailSent = true;');
  const iSave = dr.indexOf('AsyncStorage.setItem(dfrLastRecipientKey(projectId)');
  ok('it is remembered only after a real send, never on a sample', iSent > 0 && iSave > iSent && iSave - iSent < 600 && /!sampleSendPlan\(project, user\?\.email\)\.sample/.test(dr.slice(iSent, iSave)));
  ok('the sheet says "Send to … · Change"', /Send to \{sendRecipientName\.trim\(\) \|\| sendRecipientEmail\}/.test(dr) && /testID="dfr-send-to-change"/.test(dr));
}

// ── A4 ─────────────────────────────────────────────────────────────────────
console.log('\nA4 — a voice note adds to today\'s report:');
{
  const at = (h: number, m: number) => new Date(2026, 8, 16, h, m);
  let reports: VoiceLogReport[] = [];
  let nextId = 1;
  const file = (line: string, when: Date) => {
    const w = planVoiceLogWrite({ reports, projectId: 'p1', at: when, line });
    if (w.kind === 'create') {
      reports = [...reports, { id: `n${nextId++}`, projectId: 'p1', date: when.toISOString(), updatedAt: when.toISOString(), ...w.seed } as VoiceLogReport];
    } else {
      reports = reports.map(r => (r.id === w.reportId ? { ...r, ...w.patch, updatedAt: when.toISOString() } : r));
    }
    return w;
  };
  const first = file('poured the footing', at(7, 42));
  ok('the first note of the day creates a draft marked origin voice', first.kind === 'create' && first.seed.origin === 'voice' && first.seed.status === 'draft');
  file('inspector came by', at(9, 5));
  file('rain after lunch', at(13, 30));
  ok('three notes on one job, one day → one report', reports.length === 1, String(reports.length));
  ok('…with three timestamped lines', reports[0].workPerformed.split('\n').length === 3 && reports[0].workPerformed.startsWith('[7:42 AM] poured the footing') && /\[1:30 PM\] rain after lunch$/.test(reports[0].workPerformed), reports[0].workPerformed);

  const sentOnly: VoiceLogReport[] = [{ id: 's', projectId: 'p1', date: at(8, 0).toISOString(), status: 'sent', workPerformed: 'Sent log' }];
  const add = planVoiceLogWrite({ reports: sentOnly, projectId: 'p1', at: at(15, 0), line: 'late note' });
  ok('a day whose report was SENT gets a new draft addendum (the sent record is never touched)', add.kind === 'create');
  const typed: VoiceLogReport[] = [{ id: 't', projectId: 'p1', date: at(8, 0).toISOString(), status: 'draft', workPerformed: 'Framed the east wall  ', manpower: crew }];
  const ap = planVoiceLogWrite({ reports: typed, projectId: 'p1', at: at(10, 0), line: 'more', manpower: [{ id: 'q', trade: 'framer', company: 'smith', headcount: 3, hoursWorked: 8 }, { id: 'e', trade: 'Electrician', company: 'Volt', headcount: 2, hoursWorked: 4 }], materials: ['Drywall', ''] });
  ok('appending never overwrites what he typed', ap.kind === 'append' && ap.patch.workPerformed === 'Framed the east wall\n[10:00 AM] more');
  ok('a field update merges crew without duplicating a row', ap.kind === 'append' && ap.patch.manpower?.length === 2 && ap.patch.manpower[1].trade === 'Electrician');
  ok('…and adds its materials', ap.kind === 'append' && ap.patch.materialsDelivered?.join('|') === 'Drywall');
  ok('another job\'s draft is not the target', planVoiceLogWrite({ reports: typed, projectId: 'p2', at: at(10, 0), line: 'x' }).kind === 'create');
  const yesterday: VoiceLogReport[] = [{ id: 'y', projectId: 'p1', date: new Date(2026, 8, 15, 12).toISOString(), status: 'draft', workPerformed: 'y' }];
  ok('yesterday\'s draft is not today\'s', planVoiceLogWrite({ reports: yesterday, projectId: 'p1', at: at(10, 0), line: 'x' }).kind === 'create');
}

// ── A7 ─────────────────────────────────────────────────────────────────────
console.log('\nA7 — Action Required shows the lawsuit items, each row does its job:');
{
  const NOWMS = Date.parse('2026-02-15T12:00:00Z');
  const proj = { id: 'p1', name: 'Oak Kitchen', status: 'in_progress' } as unknown as Project;
  const rfi = { id: 'r1', projectId: 'p1', number: 12, subject: 'Beam', question: 'q', submittedBy: 'GC', assignedTo: 'Kestrel Architects',
    dateSubmitted: '2026-02-01', dateRequired: '2026-02-05', status: 'open', priority: 'urgent', attachments: [] } as unknown as RFI;
  const r = rfiAttention(proj, [rfi], NOWMS)[0];
  ok('an overdue RFI opens THAT RFI (rfiId), not the log', r?.route.pathname === '/rfi' && r.route.params?.rfiId === 'r1');
  ok('…and carries a Nudge', r?.action?.kind === 'nudge' && r.action.record === 'rfi' && r.action.recordId === 'r1');
  const sub = { id: 's1', projectId: 'p1', number: 4, title: 'Windows', specSection: '08', currentStatus: 'in_review', submittedDate: '2026-01-10', reviewCycles: [] } as unknown as Submittal;
  const sa = submittalAttention(proj, [sub], NOWMS)[0];
  ok('a stale submittal opens THAT submittal', sa?.route.params?.submittalId === 's1' && sa.action?.kind === 'nudge');
  const inv = { id: 'i1', projectId: 'p1', number: 7, status: 'sent', dueDate: '2026-01-01', totalDue: 1000, amountPaid: 0, retentionAmount: 0 } as unknown as Invoice;
  const ia = invoiceAttention(proj, [inv], NOWMS)[0];
  ok('an overdue invoice carries Remind', ia?.action?.kind === 'remind' && ia.action.invoiceId === 'i1');
  const permit = { id: 'pm1', projectId: 'p1', type: 'Electrical', status: 'approved', inspectionDate: '2026-02-20' } as unknown as Permit;
  const pa = permitAttention(proj, [permit], NOWMS).find(i => i.id === 'permit-pm1');
  ok('a permit inspection this week carries Prep', pa?.action?.kind === 'prep' && pa.action.permitId === 'pm1');

  const punch = [{ id: 'pi1', projectId: 'p1', priority: 'high', status: 'open' }, { id: 'pi2', projectId: 'p1', priority: 'high', status: 'open' }] as unknown as PunchItem[];
  const pr = punchAttention(punch).map(it => scopePunchToProject(it, proj))[0];
  ok('punch: one row per job, opening its punch list', pr.route.pathname === '/punch-list' && pr.route.params?.projectId === 'p1' && pr.id === 'punch-high-open-p1' && pr.message.startsWith('Oak Kitchen: 2 high-priority'));
  // Integration fix: the per-job rows keep punchAttention's whole population —
  // a Post-Con ('completed') job is where punch matters, so it is not skipped.
  const postCon = { id: 'p9', name: 'Elm Duplex', status: 'completed' } as unknown as Project;
  const pcPunch = [{ id: 'pc1', projectId: 'p9', priority: 'high', status: 'open' }, { id: 'pc2', projectId: 'p9', priority: 'high', status: 'open' }] as unknown as PunchItem[];
  const pcRows = punchAttentionByJob(pcPunch, [proj, postCon]);
  ok('a completed (Post-Con) job with high-priority open punch yields ONE /punch-list?projectId row',
    pcRows.length === 1 && pcRows[0].route.pathname === '/punch-list' && pcRows[0].route.params?.projectId === 'p9'
    && pcRows[0].message === 'Elm Duplex: 2 high-priority punch items open');
  const mixed = punchAttentionByJob([...punch, ...pcPunch, { id: 'px', projectId: 'gone', priority: 'high', status: 'open' } as unknown as PunchItem], [proj, postCon]);
  ok('…one row per job, and an unknown job\'s items stay in the old unscoped rollup (nothing dropped)',
    mixed.length === 3 && mixed.filter(m => m.route.pathname === '/punch-list').length === 2 && mixed.some(m => m.id === 'punch-high-open' && m.message.startsWith('1 high-priority')));
  ok('…and the row count matches the portfolio rule\'s population (sum of per-row counts = punchAttention count)',
    mixed.reduce((n, m) => n + Number((m.message.match(/(\d+) high-priority/) ?? [])[1] ?? 0), 0) === 5);
  const co = changeOrderAttention([{ id: 'c1', projectId: 'p1', status: 'submitted' }] as unknown as ChangeOrder[]).map(coRollupToWaitingOn)[0];
  ok('the change-order rollup opens /waiting-on', co.route.pathname === '/waiting-on');

  const hook = code('hooks/useBrainWatch.ts');
  ok('the canonical hook counts overdue RFIs', /all\.push\(\.\.\.rfiAttention\(project, rfis, nowMs\)\)/.test(hook));
  ok('…and stale submittals', /all\.push\(\.\.\.submittalAttention\(project, submittals, nowMs\)\)/.test(hook));
  const loopBody = (hook.match(/for \(const project of projects\) \{([\s\S]*?)\n    \}\n/) ?? [])[1] ?? '';
  ok('…punch per job over every punch item (outside the loop that skips completed jobs), CO rollup to Waiting On',
    loopBody.length > 0 && !/punch/i.test(loopBody)
    && /all\.push\(\.\.\.punchAttentionByJob\(punchItems, projects\)\)/.test(hook)
    && /changeOrderAttention\(changeOrders\)\.map\(coRollupToWaitingOn\)/.test(hook));
  const att = code('app/(tabs)/(home)/attention.tsx');
  const rail = code('components/DesktopActionRail.tsx');
  ok('/attention has no side-count any more', !/outsideTheScan/.test(att) && !/rfiAttention\(|submittalAttention\(/.test(att));
  ok('/attention offers the chase for the rows someone else holds (Waiting On)',
    /\{chaseable > 0 \? \(\s*<TouchableOpacity[\s\S]{0,120}onPress=\{\(\) => router\.push\('\/waiting-on'\)\}/.test(att)
    && /i\.kind === 'rfi' \|\| i\.kind === 'submittal' \|\| i\.kind === 'changeOrder'/.test(att));
  ok('the dock has no side-count any more', !/outsideTheScan/.test(rail) && !/rfiAttention\(|submittalAttention\(/.test(rail));
  ok('the dock pill is still the canonical count, alone', /<Text style=\{styles\.countPillText\}>\{items\.length\}<\/Text>/.test(rail));
  ok('Remind goes through remindInvoice, and the helper asks the QuickBooks question', /remindInvoice\(/.test(rail) && /confirm: confirmViaAlert\(showAlert\)/.test(rail) && !/qboClosedConfirmed/.test(rail));
  ok('…the outcome is shown (toast on sent, the alert otherwise)', /if \(out\.kind === 'sent'\) nailIt\(out\.message\);\s*else if \(out\.kind !== 'cancelled'\) showAlert\(out\.title, out\.message\);/.test(rail));
  ok('Nudge logs a chase only when something left', (rail.match(/if \(!via\) return;\s*await recordChaseToLog\(/g) ?? []).length === 2);
  ok('a collaborator gets no Remind', /role === 'editor' \|\| role === 'viewer' \|\| role === 'field'\) return null;/.test(rail));
  ok('a locked plan says why (never a dead button)', /explainLocked\('Sending invoice reminders'\)/.test(rail));
  ok('Nudge carries /waiting-on\'s gate (none) — never the viewer\'s own tier on a shared job', !/rfis_submittals/.test(rail));
  ok('every row still opens the record', (rail.match(/onPress=\{\(\) => onRowPress\(item\)\}/g) ?? []).length === 2);
}

// ── chaseNudge ─────────────────────────────────────────────────────────────
console.log('\nutils/chaseNudge — one way to chase:');
{
  const at = '2026-09-16T14:00:00.000Z';
  const log1 = appendChase({}, { id: 'rfi:r1', projectId: 'p1', via: 'share', message: 'hi', at });
  const log2 = appendChase(log1, { id: 'rfi:r1', projectId: 'p1', via: 'clipboard', message: 'again', at: '2026-09-17T14:00:00.000Z' });
  ok('appendChase appends and keeps lastFollowUpAt beside it', log2['rfi:r1'].chases?.length === 2 && log2['rfi:r1'].lastFollowUpAt === '2026-09-17T14:00:00.000Z' && log2['rfi:r1'].createdAt === at && log2['rfi:r1'].status === 'chased');
  ok('…and is pure (the previous map is untouched)', log1['rfi:r1'].chases?.length === 1);
  ok('chaseLogId matches waiting-on\'s `${kind}:${id}`', chaseLogId('rfi', 'r1') === 'rfi:r1' && chaseLogId('submittal', 's1') === 'submittal:s1');

  const waiting = raw('app/waiting-on.tsx');
  const keyMatch = /const\s+FOLLOW_UP_HOLDS_KEY\s*=\s*'([^']+)'/.exec(waiting);
  ok('CHASE_LOG_KEY is the same key /waiting-on persists', keyMatch?.[1] === CHASE_LOG_KEY);
  ok('/waiting-on uses the shared updater and send', /appendChase\(prev, \{ id, projectId, via, message, at \}\)/.test(waiting) && /sendChaseNudge\(/.test(waiting) && /onChaseRecorded\(/.test(waiting));

  // recordChaseToLog with a fake store + a listener.
  const store = new Map<string, string>([[CHASE_LOG_KEY, JSON.stringify(log1)]]);
  const heard: string[] = [];
  const off = onChaseRecorded(e => heard.push(e.id));
  await recordChaseToLog({ id: 'submittal:s1', projectId: 'p1', via: 'share', message: 'x', at }, {
    getItem: async k => store.get(k) ?? null,
    setItem: async (k, v) => { store.set(k, v); },
  });
  off();
  const stored = JSON.parse(store.get(CHASE_LOG_KEY) ?? '{}');
  ok('recordChaseToLog keeps the old log and adds the chase', !!stored['rfi:r1'] && stored['submittal:s1']?.chases?.length === 1);
  ok('…and tells a mounted Waiting On', heard.join(',') === 'submittal:s1');

  const book = {
    contacts: [
      { firstName: 'Tom', lastName: 'Reyes', companyName: 'Kestrel Architects', email: 'tom@kestrel.com' },
      { firstName: 'Ann', lastName: 'Lee', companyName: 'Two Firms', email: 'ann@a.com' },
      { firstName: 'Bo', lastName: 'Kim', companyName: 'Two Firms', email: 'bo@b.com' },
    ],
    subs: [{ id: 'sub1', companyName: 'Volt Electric', contactName: 'Vic', email: 'vic@volt.com' }],
  };
  ok('an address written in the holder field wins', chaseRecipientEmail({ text: 'Tom <tom@x.com>' }, book) === 'tom@x.com');
  ok('the assigned sub\'s email', chaseRecipientEmail({ text: 'Whoever', subId: 'sub1' }, book) === 'vic@volt.com');
  ok('ONE contact whose company matches', chaseRecipientEmail({ text: ' kestrel  architects ' }, book) === 'tom@kestrel.com');
  ok('two different addresses is no address', chaseRecipientEmail({ text: 'Two Firms' }, book) === null);
  ok('no match is no address (never a guess)', chaseRecipientEmail({ text: 'Nobody Inc' }, book) === null && chaseRecipientEmail({ text: '' }, book) === null);
  ok('the subject reads "RFI #12 · Oak Kitchen"', chaseMailSubject('rfi', 12, 'Oak Kitchen') === 'RFI #12 · Oak Kitchen' && chaseMailSubject('submittal', 4, '') === 'Submittal #4');

  type Alert = { title: string; message?: string; buttons?: AlertButton[]; onDismiss?: () => void };
  const mk = (o: { platform: string; share?: ShareResult; canShare?: boolean; openThrows?: boolean; press?: string }) => {
    const alerts: Alert[] = [];
    const opened: string[] = [];
    let shared = 0;
    const deps: SendNudgeDeps = {
      platform: o.platform,
      shareText: async () => { shared++; return o.share ?? 'shared'; },
      canShare: () => o.canShare ?? true,
      showAlert: (title, message, buttons, options) => {
        alerts.push({ title, message, buttons, onDismiss: options?.onDismiss });
        if (o.press) buttons?.find(b => b.text === o.press)?.onPress?.();
      },
      openURL: async (u) => { if (o.openThrows) throw new Error('no handler'); opened.push(u); },
    };
    return { deps, alerts, opened, shared: () => shared };
  };
  const yes = mk({ platform: 'web', press: DID_YOU_SEND_YES });
  const vYes = await sendNudge({ message: 'Line 1\nLine 2', to: 'tom@kestrel.com', subject: 'RFI #12 · Oak Kitchen', toName: 'Tom' }, yes.deps);
  ok('web + an address → a pre-addressed email with the subject', yes.opened[0]?.startsWith('mailto:tom@kestrel.com?subject=RFI%20%2312') === true && /body=Line%201%0ALine%202/.test(yes.opened[0] ?? ''), yes.opened[0]);
  ok('…then "Did you send it?", and only "Sent" logs a chase', yes.alerts[0]?.title === DID_YOU_SEND_TITLE && vYes === 'share' && yes.shared() === 0);
  const no = mk({ platform: 'web', press: DID_YOU_SEND_NO });
  ok('"Not sent" logs nothing', (await sendNudge({ message: 'm', to: 'tom@kestrel.com' }, no.deps)) === null);
  const esc = mk({ platform: 'web' });
  const pEsc = sendNudge({ message: 'm', to: 'tom@kestrel.com' }, esc.deps);
  await Promise.resolve(); await Promise.resolve();
  esc.alerts[0]?.onDismiss?.();
  ok('dismissing the question logs nothing', (await pEsc) === null);
  const noAddr = mk({ platform: 'web', share: 'copied', canShare: false });
  const vCopy = await sendNudge({ message: 'm', to: null }, noAddr.deps);
  ok('web with no address → copied, and it says so', vCopy === 'clipboard' && noAddr.opened.length === 0 && /No address is on file/.test(noAddr.alerts[0]?.message ?? ''));
  const broken = mk({ platform: 'web', share: 'copied', canShare: false, openThrows: true });
  ok('a mail client that will not open falls back to the clipboard', (await sendNudge({ message: 'm', to: 'tom@kestrel.com' }, broken.deps)) === 'clipboard' && broken.shared() === 1);
  const phone = mk({ platform: 'ios', share: 'shared' });
  ok('the phone keeps the share sheet (no email path) → share', (await sendNudge({ message: 'm', to: 'tom@kestrel.com' }, phone.deps)) === 'share' && phone.opened.length === 0 && phone.alerts.length === 0);
  ok('a cancelled share records nothing', (await sendNudge({ message: 'm' }, mk({ platform: 'ios', share: 'cancelled' }).deps)) === null);
  ok('a failed share records nothing', (await sendNudge({ message: 'm' }, mk({ platform: 'ios', share: 'failed' }).deps)) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
