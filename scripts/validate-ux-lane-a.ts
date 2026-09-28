// scripts/validate-ux-lane-a.ts — UX wave, lane A: the daily log, voice, and
// what the app reminds you about.
//
// Pins the pure rules this lane added and the screen wiring it cannot import:
//   A1  "Add today's N photos" (todaysPhotosToAttach) + Photos under Work
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
import { pickDefaultProjectId, PICK_JOB_FIRST } from '../utils/defaultProjectId';
import { urlProjectIdFrom } from '../utils/activeProject';
import {
  voiceJobChips, planVoiceNoteFilings, fileReadyVoiceNotes, voiceNoteFiledLine, voiceClipHoldLine,
  type VoiceFilingDeps,
} from '../utils/voiceNoteFiling';
import {
  voiceBacklog, voiceWaitingLine, voiceFailedLine, voiceNoteQueueKey, voiceNoteProjectIdOf, recordedAtMs,
  type AudioTranscribeTask,
} from '../utils/audioTranscribeCore';
import { localDayKey } from '../utils/dailyLogCompletion';
import type { DailyFieldReport } from '../types';

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
  ok('3 photos today → "Add today\'s 3 photos", one tap attaches 3', three.label === "Add today's 3 photos" && three.add.length === 3, String(three.label));
  ok('0 photos → no chip', todaysPhotosToAttach([], [], 10).label === null);
  const nineOn = Array.from({ length: 9 }, (_, i) => ({ id: `x${i}` }));
  const oneFits = todaysPhotosToAttach([ph('a'), ph('b'), ph('c')], nineOn, 10);
  ok('9 already attached → adds 1 and says "1 more fits"', oneFits.add.length === 1 && /1 more fits$/.test(oneFits.label ?? ''), String(oneFits.label));
  const dedupe = todaysPhotosToAttach([ph('a'), ph('b'), ph('a')], [{ id: 'a' }], 10);
  ok('photos already on the report (same id) are skipped', dedupe.add.map(p => p.id).join(',') === 'b' && dedupe.label === "Add today's 1 photo", String(dedupe.label));
  ok('a full report shows no chip', todaysPhotosToAttach([ph('z')], Array.from({ length: 10 }, (_, i) => ({ id: `y${i}` })), 10).label === null);
  ok('a backdated report says "that day\'s"', todaysPhotosToAttach([ph('a')], [], 10, "that day's").label === "Add that day's 1 photo");
  // Integration fix: a delivery ticket ("It's here now" files it tagged
  // 'Delivery ticket') can carry supplier pricing; the one tap never sends it.
  const withTicket = oneTapDayPhotos([ph('a'), ph('t', { tag: 'Delivery ticket' }), ph('b', { tag: 'Framing' })]);
  const tPlan = todaysPhotosToAttach(withTicket, [], 10);
  ok('a delivery-ticket photo is not in the one tap, and the chip count leaves it out',
    tPlan.add.map(p => p.id).join(',') === 'a,b' && tPlan.label === "Add today's 2 photos", String(tPlan.label));
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
  ok('each choice shows its own lock', /voiceBlocked\s*\n?\s*\? <Lock/.test(dr) && /label="Dictate the day"/.test(dr));
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
console.log('\nA7 — Action required shows the lawsuit items, each row does its job:');
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

// A5 marker persistence: DailyFieldReport.origin is typed, local only (never
// in the write payload), and a daily_reports refetch merges it forward the
// way it merges leakScan, so a refetch cannot turn a voice-only day filed.
{
  console.log('\nA5 — the voice marker survives a refetch:');
  const types = code('types/index.ts');
  const dfr = types.slice(types.indexOf('export interface DailyFieldReport {'), types.indexOf('\n}', types.indexOf('export interface DailyFieldReport {')));
  ok("DailyFieldReport carries origin?: 'voice'", /\borigin\?: 'voice';/.test(dfr));
  const pc = code('contexts/ProjectContext.tsx');
  ok('the daily_reports refetch merges origin forward from the local copy',
    /const localOrigin = local\?\.origin;/.test(pc) && /\.\.\.\(localOrigin !== undefined \? \{ origin: localOrigin \} : \{\}\)/.test(pc)
    && /const localLeakScan = local\?\.leakScan;/.test(pc));
  const pure = code('utils/projectContextPure.ts');
  const cols = pure.slice(pure.indexOf('export function dailyReportColumns('), pure.indexOf('\n}', pure.indexOf('export function dailyReportColumns(')));
  ok('origin never reaches the write payload (dailyReportColumns does not name it)', cols.length > 0 && !/\borigin\b/.test(cols));
}

// ── A3 (held items, wave next) ─────────────────────────────────────────────
console.log('\nA3 — a voice note files to the project he is on:');
{
  const job = (id: string, name: string, status: Project['status'] = 'in_progress', updatedAt = '2026-09-01T00:00:00Z') =>
    ({ id, name, status, updatedAt }) as Pick<Project, 'id' | 'name' | 'status' | 'updatedAt'>;
  const H = job('henderson', 'Henderson'), S = job('smith', 'Smith');
  const jobs = [H, S, job('c', 'Cole'), job('d', 'Diaz'), job('e', 'Eaton'), job('f', 'Fisher', 'in_progress', '2026-09-20T00:00:00Z')];
  // The mic resolves the default on every open from the route it is opened on.
  const openOn = (path: string, params: Record<string, string>, recent: string[] = []) =>
    pickDefaultProjectId({ routeProjectId: urlProjectIdFrom(path, params), activeProjectId: null, recentProjectIds: recent, projects: jobs });
  ok('opened on /project-detail?id=henderson → Henderson', openOn('/project-detail', { id: 'henderson' }) === 'henderson');
  ok('open on Henderson, close, open on Smith → Smith (no latch)',
    openOn('/project-detail', { id: 'henderson' }) === 'henderson' && openOn('/punch-list', { projectId: 'smith' }, ['henderson']) === 'smith');
  ok('a route with no project falls to his most recent job, never "most recently updated"',
    openOn('/(tabs)/(home)', {}, ['d']) === 'd' && openOn('/(tabs)/(home)', {}, []) === null);
  const six = voiceJobChips({ projects: jobs, recentProjectIds: ['henderson', 'smith'], defaultId: 'henderson' });
  ok('with 6 open jobs the chips stop at 4 and offer "More…"', six.chips.length === 4 && six.hasMore);
  ok('…the default leads the chips', six.chips[0].id === 'henderson');
  ok('…and job 6 is reachable through "More…"', six.all.length === 6 && six.all.some(p => p.id === 'f'));
  const picked = voiceJobChips({ projects: jobs, recentProjectIds: ['henderson'], defaultId: 'henderson', pickedId: 'e' });
  ok('a job picked from "More…" becomes the first chip', picked.chips[0].id === 'e');
  const closedOut = voiceJobChips({ projects: [...jobs, job('x', 'Xavier', 'closed'), job('y', 'Yang', 'completed')], recentProjectIds: ['x', 'y'] });
  ok('closed and completed jobs are neither chips nor in "More…"', !closedOut.all.some(p => p.id === 'x' || p.id === 'y'));
  ok('no route, no pick, no recent job → nothing preselected', pickDefaultProjectId({ routeProjectId: null, activeProjectId: 'c', recentProjectIds: [], projects: jobs }) === null);
  ok('PICK_JOB_FIRST reads "Pick the project first"', PICK_JOB_FIRST === 'Pick the project first');

  const mic = code('components/UniversalMicButton.tsx');
  const fnBody = (src: string, head: string) => {
    const i = src.indexOf(head);
    return i < 0 ? '' : src.slice(i, src.indexOf('}, [', i));
  };
  ok('the mic resolves its default with pickDefaultProjectId from the route',
    /pickDefaultProjectId\(\{ routeProjectId, activeProjectId, recentProjectIds, projects: projectsList \}\)/.test(mic)
    && /const routeProjectId = requestedProjectId \?\? projectId \?\? urlProjectIdFrom\(/.test(mic));
  ok('the "most recently updated" default is gone', !/getTime\(\) - new Date\(a\.updatedAt\)/.test(mic) && !/activeProjects/.test(mic));
  ok('no projects[0] fallback anywhere in the mic', !/projectsList\[0\]/.test(mic));
  ok('the pick starts empty on every open (no latch)', /useState<string \| undefined>\(undefined\)/.test(mic)
    && /setPickedProjectId\(undefined\)/.test(fnBody(mic, 'const handleOpen = useCallback(')) && !/setPickedProjectId\(project/.test(mic));
  ok('close clears the pick and the request', /setPickedProjectId\(undefined\);/.test(fnBody(mic, 'const handleClose = useCallback(')) && /onClosed\?\.\(\)/.test(fnBody(mic, 'const handleClose = useCallback(')));
  ok('the chips come from voiceJobChips, with "More…" listing every open job',
    /voiceJobChips\(\{ projects: projectsList, recentProjectIds, defaultId: defaultProjectId, pickedId: pickedProjectId \}\)/.test(mic)
    && /jobChips\.all\.map\(/.test(mic) && /testID="voice-job-more"/.test(mic) && !/projectsList\.slice\(0, 4\)/.test(mic));
  ok('with no project, Create is disabled and says why',
    /const createBlocked = [^;]*!project;/.test(mic) && /disabled=\{createBlocked\}/.test(mic) && /\{createBlocked && !error && <Text style=\{styles\.blockedText\}>\{PICK_JOB_FIRST\}<\/Text>\}/.test(mic));
  ok('autoStart defaults to false on the recorder, the capture sheet and the mic',
    /autoStart = false, queueKey,/.test(code('components/VoiceRecorder.tsx'))
    && /queueKey,\s*autoStart = false,\s*\}: Props\)/.test(code('components/VoiceCaptureModal.tsx'))
    && /requestedProjectId, autoStart = false, onClosed, filesParkedNotes = false,/.test(mic));
  const vcm = code('components/VoiceCaptureModal.tsx');
  ok('the capture sheet auto-starts through the record button\'s own path, only when idle, never on the web',
    /if \(autoStart && Platform\.OS !== 'web'\)/.test(vcm) && /stepRef\.current === 'idle'\) void startRecordingRef\.current\(\)/.test(vcm)
    && /startRecordingRef\.current = startRecording;/.test(vcm));
  const vr = code('components/VoiceRecorder.tsx');
  ok('the recorder opens its sheet on mount for autoStart, never on the web or locked',
    /if \(!autoStart \|\| isLocked \|\| Platform\.OS === 'web'\) return;/.test(vr) && /autoStart=\{autoStart\}/.test(vr) && /queueKey=\{queueKey\}/.test(vr));
  ok('an open that asked for autoStart arms it once; a transcript or Try again disarms it',
    /setAutoStartArmed\(autoStart && Platform\.OS !== 'web'\)/.test(mic) && (mic.match(/setAutoStartArmed\(false\)/g) ?? []).length >= 2
    && /autoStart=\{autoStartArmed\}/.test(mic));
  ok('the nine-line "Try saying" wall is one rotating line in the capture sheet',
    !/styles\.tipsLine/.test(mic) && /suggestions=\{VOICE_ACTION_SUGGESTIONS\}/.test(mic));
  ok('no blocking alert on success: the note and field-update paths toast and close',
    !/showAlert\(/.test(mic) && !/'Note saved'/.test(mic) && !/'Field update saved'/.test(mic)
    && (mic.match(/nailIt\(`Added to today's report · \$\{proj\.name\}`\)/g) ?? []).length === 2);
  ok('…and a field update that could not reach the schedule says so', /if \(summaryParts\.length > 0\) \{\s*const said = summaryParts\.join\('\. '\);\s*oops\(`Added to today's report\. /.test(mic));
  const sc = code('contexts/SearchContext.tsx');
  ok('openVoice takes { projectId, autoStart } and openVoice() behaves as before',
    /const openVoice = useCallback\(\(opts\?: OpenVoiceOptions\) =>/.test(sc) && /autoStart: o\?\.autoStart === true/.test(sc) && /setVoiceSignal\(n => n \+ 1\)/.test(sc));
  const bs = code('components/brain/BrainSurface.tsx');
  ok('BrainSurface hands the request to the always-mounted mic, which files parked notes',
    /requestedProjectId=\{voiceRequest\?\.projectId\}/.test(bs) && /autoStart=\{voiceRequest\?\.autoStart === true\}/.test(bs)
    && /onClosed=\{clearVoiceRequest\}/.test(bs) && /filesParkedNotes/.test(bs));
  const fab = code('components/brain/BrainFab.tsx');
  ok('holding the Brain button starts a voice note (phone only; the tap is unchanged)',
    /openVoice\(\{ autoStart: true \}\)/.test(fab) && /if \(Platform\.OS === 'web' \|\| !openVoice\) return;/.test(fab) && /onPress=\{handlePress\}/.test(fab));
}

// ── A4 wiring (held items, wave next) ──────────────────────────────────────
console.log('\nA4 — the mic writes through planVoiceLogWrite:');
{
  const mic = code('components/UniversalMicButton.tsx');
  const note = mic.slice(mic.indexOf("} else if (parsed.kind === 'note') {"), mic.indexOf("} else if (parsed.kind === 'punch') {"));
  ok('the note branch plans the write for today', /planVoiceLogWrite\(\{ reports: ctx\.dailyReports, projectId: proj\.id, at, line \}\)/.test(note));
  ok('…appends to today\'s unsent report', /if \(w\.kind === 'append'\) \{\s*ctx\.updateDailyReport\(w\.reportId, w\.patch\);/.test(note));
  ok('…or creates the full report base with the voice seed', /ctx\.addDailyReport\(\{\s*\.\.\.voiceReportBase\(\{[^}]*\}\),\s*\.\.\.w\.seed,\s*\}\);/.test(note));
  const fu = mic.slice(mic.indexOf("} else if (parsed.kind === 'field_update') {"), mic.indexOf("} else if (parsed.kind === 'submittal') {"));
  ok('the field-update branch plans with its crew and materials',
    /planVoiceLogWrite\(\{ reports: ctx\.dailyReports, projectId: proj\.id, at: now, line: workPerformed, manpower, materials \}\)/.test(fu));
  ok('…appends (keeping its task progress) or creates with the voice seed',
    /ctx\.updateDailyReport\(w\.reportId, \{ \.\.\.w\.patch,/.test(fu) && /\.\.\.voiceReportBase\([\s\S]*?\.\.\.w\.seed,/.test(fu));
  ok('neither branch builds a bare new report any more', (mic.match(/ctx\.addDailyReport\(/g) ?? []).length === 2 && !/workPerformed: parsed\.noteBody/.test(mic) && !/weather: \{ temperature: ''/.test(mic));
}

// ── A6 (held items, wave next) ─────────────────────────────────────────────
console.log('\nA6 — voice notes recorded with no signal are not lost:');
{
  const T = (o: Partial<AudioTranscribeTask> & { id: string }): AudioTranscribeTask => ({
    userId: 'u1', fileRef: 'f.wav', staged: true, uploadName: 'recording.wav', contentType: 'audio/wav',
    contextKey: voiceNoteQueueKey('henderson'), contextLabel: 'Voice dictation — Henderson', durationMs: 30_000,
    queuedAt: new Date(2026, 8, 16, 10, 0).getTime(), retryCount: 0, status: 'pending', ...o,
  });
  ok('the queue key names the project and reads back', voiceNoteQueueKey('p9') === 'voice-note:p9' && voiceNoteProjectIdOf('voice-note:p9') === 'p9'
    && voiceNoteProjectIdOf('daily-report-abc123') === null && voiceNoteProjectIdOf('voice-note:') === null);
  const one = voiceBacklog([T({ id: 'a' })], 'u1');
  ok('one clip queued offline → "1 voice note waiting"', voiceWaitingLine(one) === '1 voice note waiting' && voiceFailedLine(one) === '');
  const mixed = voiceBacklog([
    T({ id: 'a' }), T({ id: 'b', status: 'ready', transcript: 'x', fileRef: '' }),
    T({ id: 'c', retryCount: 2 }), T({ id: 'd', retryCount: 1 }), T({ id: 'z', userId: 'u2' }),
  ], 'u1');
  ok('counts are the caller\'s own clips only', mixed.waiting === 1 && mixed.ready === 1 && mixed.failed === 2, JSON.stringify(mixed));
  ok('waiting and failed are separate lines, never summed', voiceWaitingLine(mixed) === '2 voice notes waiting' && voiceFailedLine(mixed) === "2 voice notes couldn't be transcribed");
  ok('no user → nothing is anyone\'s', JSON.stringify(voiceBacklog([T({ id: 'a' })], null)) === JSON.stringify({ waiting: 0, ready: 0, failed: 0 }));

  // The filing pass, run for real against an in-memory queue and report list.
  const projects = [
    { id: 'henderson', name: 'Henderson', status: 'in_progress' as const },
    { id: 'shut', name: 'Shut', status: 'closed' as const },
  ];
  const mkDeps = (queue: AudioTranscribeTask[], reports: DailyFieldReport[], opts: { projects?: typeof projects; now?: number } = {}) => {
    const toasts: string[] = [];
    let takes = 0;
    let n = 0;
    const deps: VoiceFilingDeps = {
      readQueue: async () => [...queue],
      ownUserId: async () => 'u1',
      takeTranscript: async (id) => {
        takes++;
        const i = queue.findIndex(t => t.id === id && t.status === 'ready' && !!t.transcript);
        if (i < 0) return null;
        const [t] = queue.splice(i, 1);
        return t.transcript ?? null;
      },
      projects: () => opts.projects ?? projects,
      reports: () => reports,
      addDailyReport: (r) => { reports.unshift(r); },
      updateDailyReport: (id, patch) => {
        const i = reports.findIndex(r => r.id === id);
        if (i >= 0) reports[i] = { ...reports[i], ...patch };
      },
      newId: () => `r${++n}`,
      now: () => opts.now ?? new Date(2026, 8, 17, 9, 0).getTime(),
      toast: (m) => { toasts.push(m); },
    };
    return { deps, toasts, takes: () => takes };
  };
  // Spoken 11:59:30 pm on the 16th, 60 s long, parked (queued) at 12:00:30 am on the 17th.
  const lateNight = T({ id: 'late', status: 'ready', transcript: 'poured the slab', fileRef: '', durationMs: 60_000, queuedAt: new Date(2026, 8, 17, 0, 0, 30).getTime() });
  ok('the recorded time is the START of the clip', localDayKey(recordedAtMs(lateNight)) === '2026-09-16');
  const q1 = [lateNight];
  const r1: DailyFieldReport[] = [];
  const run1 = mkDeps(q1, r1);
  const res1 = await fileReadyVoiceNotes(run1.deps);
  ok('back online, a ready note is filed once', res1.filed === 1 && r1.length === 1);
  ok('…onto the day it was SPOKEN (yesterday), not today', localDayKey(r1[0].date) === '2026-09-16', r1[0].date);
  ok('…as a voice draft carrying his words', r1[0].origin === 'voice' && r1[0].status === 'draft' && /poured the slab$/.test(r1[0].workPerformed));
  ok('…with a toast naming the time and the project', run1.toasts[0] === voiceNoteFiledLine(recordedAtMs(lateNight), new Date(2026, 8, 17, 9, 0).getTime(), 'Henderson')
    && /^Voice note from yesterday 11:59 PM added to Henderson's report$/.test(run1.toasts[0]), run1.toasts[0]);
  const res2 = await fileReadyVoiceNotes(run1.deps);
  ok('a second pass files nothing twice', res2.filed === 0 && r1.length === 1 && run1.toasts.length === 1);

  // Two passes at once, and a clip the capture sheet's "Use it" took first.
  const q2 = [T({ id: 'r1', status: 'ready', transcript: 'one', fileRef: '' }), T({ id: 'r2', status: 'ready', transcript: 'two', fileRef: '', queuedAt: new Date(2026, 8, 16, 11, 0).getTime() })];
  const r2: DailyFieldReport[] = [];
  const run2 = mkDeps(q2, r2);
  const [a, b] = await Promise.all([fileReadyVoiceNotes(run2.deps), fileReadyVoiceNotes(run2.deps)]);
  ok('two passes at once file each clip exactly once', a.filed + (a === b ? 0 : b.filed) === 2 && r2.length === 1);
  ok('…two notes on one day land in ONE report, two lines', r2[0].workPerformed.split('\n').length === 2, r2[0].workPerformed);

  const q3 = [T({ id: 'gone', status: 'ready', transcript: 'x', fileRef: '', contextKey: voiceNoteQueueKey('deleted') }),
    T({ id: 'closed', status: 'ready', transcript: 'y', fileRef: '', contextKey: voiceNoteQueueKey('shut') }),
    T({ id: 'form', status: 'ready', transcript: 'z', fileRef: '', contextKey: 'daily-report-abc' }),
    T({ id: 'bad', retryCount: 3 })];
  const r3: DailyFieldReport[] = [];
  const run3 = mkDeps(q3, r3);
  const res3 = await fileReadyVoiceNotes(run3.deps);
  ok('a note for a project that is gone or closed is NOT filed and NOT taken', res3.filed === 0 && r3.length === 0 && run3.takes() === 0 && q3.length === 4);
  const plan3 = planVoiceNoteFilings({ tasks: q3, ownUserId: 'u1', projects, projectsLoaded: true });
  const hold = (id: string) => plan3.rows.find(r => r.task.id === id)?.hold;
  ok('…it stays listed with the reason', hold('gone') === 'project_missing' && hold('closed') === 'project_closed'
    && /no longer on this phone/.test(voiceClipHoldLine('project_missing')) && /closed/.test(voiceClipHoldLine('project_closed')));
  ok('a form\'s own dictation is never filed to a report (it waits for its form)', plan3.rows.find(r => r.task.id === 'form')?.projectId === null && !plan3.toFile.some(f => f.taskId === 'form'));
  ok('a failed transcription stays listed as failed', plan3.rows.find(r => r.task.id === 'bad')?.state === 'failed');
  const cold = planVoiceNoteFilings({ tasks: q3, ownUserId: 'u1', projects: [], projectsLoaded: false });
  ok('before the project list loads nothing is filed and nothing is called missing', cold.toFile.length === 0 && cold.rows.every(r => r.hold === null));

  const filing = code('utils/voiceNoteFiling.ts');
  const iTake = filing.indexOf('await deps.takeTranscript(item.taskId)');
  const iPlan = filing.indexOf('planVoiceLogWrite({ reports: working');
  ok('filing goes through takeTranscript BEFORE any write (single consumer)', iTake > 0 && iPlan > iTake);
  ok('…and files at the recorded time, not now', /at: recordedAtMs\(r\.task\)/.test(filing) && /projectId: item\.projectId, at: item\.at, line: text/.test(filing));
  const mic = code('components/UniversalMicButton.tsx');
  ok('the always-mounted mic runs the pass with the real queue\'s takeTranscript',
    /readQueue: getOwnAudioTranscribeQueue,/.test(mic) && /\n\s*takeTranscript,\n/.test(mic) && /if \(!filesParkedNotes \|\| Platform\.OS === 'web'\) return;/.test(mic));
  ok('…on mount, on reconnect, on foreground, on a queue change and on the sheet\'s request',
    /if \(projectsLoaded\) drainThenFile\(\);/.test(mic) && /onlineManager\.subscribe\(\(online\) => \{ if \(online\) drainThenFile\(\); \}\)/.test(mic)
    && /if \(next === 'active'\) drainThenFile\(\);/.test(mic) && /onAudioQueueChange\(fileParkedNotes\)/.test(mic) && /onVoiceNoteFilingRequested\(fileParkedNotes\)/.test(mic));
  ok('the global mic records under voice-note:<projectId>', /queueKey=\{project \? voiceNoteQueueKey\(project\.id\) : undefined\}/.test(mic));
  const pill = code('components/OfflineSyncPill.tsx');
  ok('the floating pill shows the waiting and failed voice lines separately',
    /const voiceWaiting = floating && voiceWaitingLine\(voice\.backlog\)/.test(pill) && /const voiceFailed = floating && voiceFailedLine\(voice\.backlog\)/.test(pill)
    && /testID="offline-sync-voice-waiting"/.test(pill) && /testID="offline-sync-voice-failed"/.test(pill));
  ok('…the failed line in the failed colour, the waiting line in the pending one',
    /<Text style=\{\[styles\.text, \{ color: themeColors\.danger \}\]\} numberOfLines=\{1\}>\{voiceFailed\}<\/Text>/.test(pill)
    && /<Text style=\{styles\.text\} numberOfLines=\{1\}>\{voiceWaiting\}<\/Text>/.test(pill));
  const sheet = code('components/VoiceBacklogSheet.tsx');
  ok('the sheet runs the queue, then asks the mic to file, on open and on Retry',
    /await processAudioTranscribeQueue\(\);\s*\} finally \{\s*requestVoiceNoteFiling\(\);/.test(sheet) && /useEffect\(\(\) => \{ if \(visible\) void runNow\(\); \}, \[visible, runNow\]\);/.test(sheet));
  ok('…and offers no discard (nothing is dropped from here)', !/[Dd]iscard/.test(sheet.replace(/\/\/.*$/gm, '')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
