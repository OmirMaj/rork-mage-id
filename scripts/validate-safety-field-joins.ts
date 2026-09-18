// validate-safety-field-joins.ts — the joins the safety screens had the data
// for and never made (audit round 2, safety-compliance #2, #3, #5, #6).
//
//   #2  a lapsed certification is flagged on the toolbox sign-in and the JHA
//       sign-off — by exact CrewMember.id, never by a typed name.
//   #3  the hazard photo the AI scanned is saved on the hazard (it was
//       hard-coded `photoUrl: undefined`), once per photo, and a pasted URL too.
//   #5  the toolbox sign-in sheet starts from the crew assigned to the job, and
//       the topic picker says what it was grounded on.
//   #6  no safety form or the toolbox Copilot defaults a date to the UTC day.
//
// Pure functions are run for real; the screens are Expo Router routes that
// cannot be imported under bun, so their wiring is pinned textually.
// Run via: bun scripts/validate-safety-field-joins.ts

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { certFlagsForWorker, lapsedCertConfirmText } from '../utils/safety/crewCerts';
import { prefillAttendeesFromCrew } from '../utils/safety/toolboxRoster';
import { hazardPhotoForSave, stagedPathFor } from '../utils/safety/hazardPhoto';
import { toolboxGroundedOnLine, buildToolboxGrounding } from '../utils/copilot/toolbox/toolboxGrounding';
import { toolboxGaps } from '../utils/copilot/toolbox/toolboxGaps';
import type { Certification } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}

// ── #2 certification flags ───────────────────────────────────────────────
console.log('\ncertification flags (#2):');
const cert = (o: Partial<Certification>): Certification =>
  ({ id: 'c', type: 'SST', status: 'valid', createdAt: '', createdBy: '', ...o }) as Certification;
const certs: Certification[] = [
  cert({ id: 'c1', workerId: 'w1', type: 'SST', expiresDate: '2026-09-12' }),
  cert({ id: 'c2', workerId: 'w1', type: 'OSHA 30', expiresDate: '2026-10-02' }),
  cert({ id: 'c3', workerId: 'w1', type: 'CPR', expiresDate: '2028-01-01' }),
  cert({ id: 'c4', workerId: 'w1', type: 'First Aid' }),                  // no expiry
  cert({ id: 'c5', workerId: 'w2', type: 'SST', expiresDate: '2026-01-01' }),
  cert({ id: 'c6', holderName: 'Jose R', type: 'SST', expiresDate: '2026-01-01' }), // not linked
];
const f1 = certFlagsForWorker(certs, 'w1', '2026-09-17');
eq('w1: expired SST then expiring OSHA 30; valid and undated not flagged', f1.map(f => f.certId), ['c1', 'c2']);
ok('expired chip names the card and its date', f1[0].label.startsWith('Expired: SST (') && f1[0].label.includes('Sep 12'), f1[0].label);
ok('expiring chip says expiring', f1[1].label.startsWith('Expiring: OSHA 30'));
eq('no worker id → no flags (a typed name is never matched)', certFlagsForWorker(certs, undefined, '2026-09-17'), []);
eq('an unlinked holderName cert is never attributed to anyone', certFlagsForWorker(certs, 'Jose R', '2026-09-17'), []);
// Last valid day: a cert expiring today is NOT expired (certExpiry flags days < 0).
eq('expires today → expiring, not expired',
  certFlagsForWorker([cert({ id: 'x', workerId: 'w9', expiresDate: '2026-09-17' })], 'w9', '2026-09-17').map(f => f.status), ['expiring']);
const confirm = lapsedCertConfirmText('Ana', f1);
ok('the confirmation names the lapsed card and its date, as the chip prints it', !!confirm && confirm.includes('SST (expired Sep 12)'), String(confirm));
ok('…and asks with the default verb of the sign-in sheets', !!confirm && confirm.endsWith('Sign them in anyway?'), String(confirm));
ok('clock-in asks with ITS verb (the button says "Clock in anyway")',
  /lapsedCertConfirmText\(member\.name, certFlagsByMember\[member\.id\] \?\? \[\], 'Clock them in'\)/.test(read('app/time-tracking.tsx'))
  && (lapsedCertConfirmText('Ana', f1, 'Clock them in') ?? '').endsWith('Clock them in anyway?'));
// The roster pre-fill lists the crew before anyone signs; calling that list
// "attendees" counted people who never attended.
ok('the toolbox card counts the sheet as "listed", and only signers as signed',
  /\{item\.attendees\.length\} listed · \{signed\} signed/.test(read('app/safety-toolbox.tsx'))
  && !/attendee\{item\.attendees\.length === 1/.test(read('app/safety-toolbox.tsx')));
ok('an expiring-only worker gets no confirmation (not lapsed yet)', lapsedCertConfirmText('Ana', [f1[1]]) === null);

// ── #5 toolbox roster pre-fill ───────────────────────────────────────────
console.log('\ntoolbox sign-in pre-fill (#5):');
const crew = [
  { id: 'w1', fullName: 'Ana Ruiz', status: 'active' },
  { id: 'w2', fullName: 'Ben Cole', status: 'active' },
  { id: 'w3', fullName: 'Old Timer', status: 'inactive' },
];
const fresh = prefillAttendeesFromCrew([], crew);
eq('fresh sheet lists active assigned crew', fresh.map(a => a.name), ['Ana Ruiz', 'Ben Cole']);
eq('rows carry the crew id in subId (the exact join)', fresh.map(a => a.subId), ['w1', 'w2']);
ok('nobody is pre-signed', fresh.every(a => !a.signedAt));
const signed = [{ name: 'Ana Ruiz', subId: 'w1', signedAt: '2026-09-17T13:00:00Z' }];
const topped = prefillAttendeesFromCrew(signed, crew);
eq('re-adding keeps signed rows untouched and first', topped[0], signed[0]);
eq('re-adding does not duplicate an id already on the sheet', topped.filter(a => a.subId === 'w1').length, 1);
const typed = prefillAttendeesFromCrew([{ name: 'ben  cole' }], crew);
eq('a hand-typed matching name blocks a duplicate row', typed.length, 2);
ok('…but is NOT linked to the crew member (a name match is a guess)', typed[0].subId === undefined);

// Grounded-on honesty line.
eq('grounded-on with history', toolboxGroundedOnLine(2, 1), 'Grounded on: 2 recent incidents, 1 open hazard on this job.');
ok('grounded-on with nothing says so', toolboxGroundedOnLine(0, 0).includes('nothing logged on this job yet'));
{
  const g = await buildToolboxGrounding({
    project: null, projectId: 'p', ctx: {}, tier: 'business',
    safety: {
      getIncidentsForProject: () => [{ type: 'near_miss', description: 'Dropped a pipe' }],
      getHazardsForProject: () => [{ description: 'Open floor hole', status: 'open' }],
    },
  });
  eq('grounding reports what it read', (g.data as { groundedOn?: string }).groundedOn,
    'Grounded on: 1 recent incident, 1 open hazard on this job.');
  const gap = toolboxGaps({}, g)[0];
  ok('the recommended topic cites its grounding', gap.groundedDefault.basis.includes('Grounded on: 1 recent incident'));
  const empty = await buildToolboxGrounding({ project: null, projectId: 'p', ctx: {}, tier: 'business', safety: {} });
  ok('an evergreen default on an empty job says it had nothing to learn from',
    toolboxGaps({}, empty)[0].groundedDefault.basis.includes('nothing logged on this job yet'));
}

// ── #3 hazard photo ───────────────────────────────────────────────────────
console.log('\nhazard photo (#3):');
eq('new hazard with the scanned photo attached stores the staged path',
  hazardPhotoForSave({ attach: true, stagedPhoto: 'u/p/hazard-1.jpg', isEdit: false }), 'u/p/hazard-1.jpg');
eq('a pasted https URL is stored as-is (no upload needed)',
  hazardPhotoForSave({ attach: true, pastedUrl: ' https://x.test/a.jpg ', isEdit: false }), 'https://x.test/a.jpg');
eq('a non-URL typed in the box is not stored',
  hazardPhotoForSave({ attach: true, pastedUrl: 'roof pic', isEdit: false }), undefined);
eq('not attached → no photo on a new hazard',
  hazardPhotoForSave({ attach: false, stagedPhoto: 'u/p/h.jpg', isEdit: false }), undefined);
eq('editing without attaching keeps the existing photo',
  hazardPhotoForSave({ attach: false, stagedPhoto: 'u/p/new.jpg', existing: 'u/p/old.jpg', isEdit: true }), 'u/p/old.jpg');
eq('editing and attaching replaces it',
  hazardPhotoForSave({ attach: true, stagedPhoto: 'u/p/new.jpg', existing: 'u/p/old.jpg', isEdit: true }), 'u/p/new.jpg');
{
  const cache = new Map<string, string>();
  let uploads = 0;
  const stage = (uri: string) => { uploads++; return `u/p/hazard-${uploads}-${uri.length}.jpg`; };
  const a = stagedPathFor(cache, 'file:///shot.jpg', stage);
  const b = stagedPathFor(cache, 'file:///shot.jpg', stage);
  eq('two hazards from one photo share one path', a, b);
  eq('…and one upload', uploads, 1);
  stagedPathFor(cache, 'file:///other.jpg', stage);
  eq('a different photo is a different upload', uploads, 2);
}

// ── Screen wiring (textual) ──────────────────────────────────────────────
console.log('\nscreen wiring:');
const hz = read('app/safety-hazards.tsx');
ok('hazards no longer hard-code photoUrl: undefined', !/photoUrl:\s*undefined/.test(hz),
  'every hazard is saved without its photo again.');
ok('new and updated hazards both write photoForRecord',
  (hz.match(/photoUrl: photoForRecord/g) ?? []).length === 2);
ok('the photo is staged through the upload queue into project-photos',
  hz.includes('queuePhotoUpload({') && hz.includes('buildPhotoStoragePath(userId, projectId, recordId, ext)'));
ok('staging goes through the per-photo cache (one upload per photo)',
  hz.includes('stagedPathFor(stagedByUriRef.current, pickedUri, stageHazardPhoto)'));
ok('applying an AI suggestion attaches its photo and says the AI suggested it',
  /setAttachPhoto\(true\);\s*setFromSuggestion\(true\);/.test(hz) && hz.includes('Suggested by AI from this photo'));
// The sign effect runs before the queued upload lands and never retries, so a
// hazard saved a second ago had no thumbnail on the phone that took it.
{
  const tf = hz.slice(hz.indexOf('const thumbFor = useCallback('), hz.indexOf('}, [signedThumbs]);', hz.indexOf('const thumbFor = useCallback(')));
  ok('a path staged this session falls back to its local capture until the signed URL exists',
    /if \(signedThumbs\[value\]\) return signedThumbs\[value\];/.test(tf)
    && /for \(const \[localUri, path\] of stagedByUriRef\.current\) if \(path === value\) return localUri;/.test(tf));
}
ok('cards render the stored photo (signed when it is a bucket path)',
  hz.includes('resolvePhotoUrls(unresolved)') && hz.includes('thumbFor(item.photoUrl)'));

const tb = read('app/safety-toolbox.tsx');
ok('a new toolbox talk opens pre-filled from the assigned crew',
  tb.includes('setAttendees(prefillAttendeesFromCrew([], assignedCrew))') && tb.includes('getCrewForProject(projectId'));
ok('toolbox attendee chips come from the exact subId join',
  tb.includes('a.subId ? certFlagsForWorker(certifications, a.subId, today) : []'));
ok('signing a lapsed attendee asks first', tb.includes('lapsedCertConfirmText(a.name, certFlagsForWorker(certifications, a.subId, today))'));

const jha = read('app/safety-jha.tsx');
ok('JHA sign-off chip only follows a roster pick (typing clears the link)',
  jha.includes('onChangeText={(v) => { setSigName(v); setSigWorkerId(null); }}')
    && jha.includes('certFlagsForWorker(certifications, sigWorkerId, today)'));
ok('JHA sign-off of a lapsed card asks first, with the JHA\'s own verb (the button says "Sign off anyway")',
  jha.includes("lapsedCertConfirmText(name, sigFlags, 'Sign them off')")
    && jha.includes("{ text: 'Sign off anyway'")
    && (lapsedCertConfirmText('Ana', f1, 'Sign them off') ?? '').endsWith('Sign them off anyway?'));
// The marketing line must not promise a flag the app does not raise: only a
// roster pick is linked to a card (a typed name never is), and clock-in warns too.
{
  const mk = read('marketing/features/index.html');
  ok('marketing says the flag follows a roster pick, and names clock-in',
    mk.includes('when a crew member picked from the roster signs a toolbox talk or JHA, and at clock-in')
      && !mk.includes('flagged when that worker signs'));
}

const cf = read('app/safety-certifications.tsx');
ok('the certification form can scan a card', cf.includes('await scanCertification(') && cf.includes("checkAILimit(tier, 'smart', 'scanCredential')"));
ok('scanned values are labelled as read by AI', cf.includes('Read from the card by AI'));

const mk = read('marketing/features/index.html');
ok('marketing no longer promises that no one works past a lapsed license',
  !mk.includes('so no one works past a lapsed license') && !mk.includes('verified certifications'));

// ── #6 local calendar day for every safety date default ──────────────────
console.log('\nlocal date defaults (#6):');
// Scoped on purpose: scripts/ci-ship-check.ts uses the UTC idiom deliberately
// for UTC midnight, and other Copilot capabilities belong to other lanes.
const safetyScreens = readdirSync(join(ROOT, 'app')).filter(f => /^safety(-[a-z]+)?\.tsx$/.test(f)).map(f => `app/${f}`);
const scoped = [
  ...safetyScreens,
  ...readdirSync(join(ROOT, 'utils/copilot/toolbox')).map(f => `utils/copilot/toolbox/${f}`),
  ...readdirSync(join(ROOT, 'utils/safety')).map(f => `utils/safety/${f}`),
];
ok('found the safety screens', safetyScreens.length >= 9, `found ${safetyScreens.length}`);
const UTC_DAY = /toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|split\(\s*['"]T['"]\s*\)\s*\[\s*0\s*\]|substring\(\s*0\s*,\s*10\s*\))/;
for (const rel of scoped) {
  const src = read(rel).split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  ok(`${rel} has no UTC-day idiom`, !UTC_DAY.test(src),
    'toISOString().slice(0,10) is the UTC day: after ~5pm Pacific it names tomorrow, and on Dec 31 files the case on next year\'s 300. Use todayCalendarDay().');
}
const tcap = read('utils/copilot/toolbox/toolboxCapability.ts');
ok('the Copilot toolbox record is dated with the local day',
  tcap.includes('date: todayCalendarDay(),') && !/date:\s*now\.slice\(0,\s*10\)/.test(tcap));
for (const rel of ['app/safety-incidents.tsx', 'app/safety-toolbox.tsx', 'app/safety-jha.tsx', 'app/safety-inspections.tsx', 'app/safety-certifications.tsx']) {
  ok(`${rel} defaults dates with todayCalendarDay`, read(rel).includes('todayCalendarDay()'));
}

// #1: the OSHA 300 and the Safety hub count by isRecordableCase (stored flag OR
// the recordability test). A surface that still reads the stored flag alone
// disagrees with the log about the same legacy case.
{
  const inc = read('app/safety-incidents.tsx');
  const dfr = read('app/daily-report.tsx');
  ok('the Incidents list badge comes from isRecordableCase, not the stored flag',
    /\{isRecordableCase\(item\) \? \(\s*<View style=\{styles\.oshaBadge\}>/.test(inc) && !/\{item\.oshaRecordable \? \(/.test(inc));
  ok('the daily report\'s linked-incident lines use isRecordableCase too',
    (dfr.match(/isRecordableCase\(linkedIncident\)/g) ?? []).length === 2 && !/linkedIncident\.oshaRecordable/.test(dfr));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
