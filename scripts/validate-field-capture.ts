// validate-field-capture.ts — the three pieces of field capture that are pure
// logic, RUN for real rather than pinned by a regex.
//
// WHY THIS EXISTS. Wave C of the 2026-09-07 app-experience audit fixed four
// ways a jobsite record quietly lost what the super put into it:
//
//   #9  a half-written daily report vanished on a mis-tapped back chevron
//   #10 the "non-blocking" GPS stamp was awaited, so every photo cost ~4.5s
//   #14 booking the framing inspection overwrote the footing's failure notes
//   #35 a twenty-defect punch walk was ~80 interactions in direct sun
//
// The shapes of #10 and #35 are pinned textually in
// scripts/validate-photo-upload.ts. What lives HERE is the logic those fixes
// stand on, exercised with real inputs: does the dirty check actually go
// quiet when nothing changed, does the inspection codec actually round-trip,
// does the burst actually say something honest when it stops early.
//
// All three regions live in files Metro owns — two Expo Router routes and one
// component that imports react-native — so none of them can be imported here.
// They are extracted from between sentinel comments, transpiled, and executed.
// That is the same technique scripts/validate-calendar-date.ts uses on this
// repo's other in-route logic, and it is the reason moving a sentinel fails
// loudly instead of silently unpinning the code.
//
// Run: bun run scripts/validate-field-capture.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

// Declared locally rather than pulled from `bun-types`: this repo has no bun
// type package installed, and without this `npx tsc --noEmit` fails with
// TS2867 "Cannot find name 'Bun'". Same pattern as validate-calendar-date.ts.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T, detail?: string) {
  ok(label, JSON.stringify(got) === JSON.stringify(want),
    detail ?? `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

/**
 * Pull one sentinel-delimited region out of a Metro-only file and evaluate it.
 *
 * A missing sentinel EXITS rather than failing a check, because at that point
 * every assertion below it is meaningless and a run that reports "3 failed"
 * invites someone to fix the three instead of restoring the sentinel.
 */
function loadRegion<T>(file: string, name: string, returns: string): T {
  const src = read(file);
  const begin = `// --- BEGIN ${name} ---`;
  const end = `// --- END ${name} ---`;
  const from = src.indexOf(begin);
  const to = src.indexOf(end);
  if (from < 0 || to < 0 || to <= from) {
    console.error(`\n  FAIL could not find the ${name} sentinels in ${file}.`);
    console.error('       Someone moved or renamed them, and everything this guard');
    console.error('       protects would go unpinned. Restore the sentinels rather');
    console.error('       than deleting this validator.');
    process.exit(1);
  }
  const js = new Bun.Transpiler({ loader: 'ts' })
    .transformSync(src.slice(from, to))
    .replace(/\bexport\s+(function|const|type|interface)\b/g, '$1');
  return new Function(`${js}\nreturn ${returns};`)() as T;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. burstSummary — what a burst says when it ends (audit #35)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\nburst capture — what it says when it stops:');

type BurstStop = 'cancelled' | 'limit' | 'permission' | 'error' | 'unsupported';
const { burstSummary: summary } = loadRegion<{
  burstSummary: (captured: number, stoppedBy: BurstStop, capLabel: string) => string | null;
}>('components/PhotoCapture.tsx', 'burstSummary', '{ burstSummary }');

// Silence is the RIGHT answer when the user ended the walk themselves: every
// frame they took is already on screen, and a toast repeating the count is
// noise the next one gets swiped away with.
eq('a user-cancelled walk says nothing', summary(7, 'cancelled', '10-photo'), null);
eq('a cancelled walk with no shots says nothing', summary(0, 'cancelled', '10-photo'), null);
eq('the web library fallback says nothing (its own dialog reported)',
  summary(4, 'unsupported', '10-photo'), null);

// Everything that ends a walk WITHOUT the user choosing to must be said out
// loud, because in each of these the count on screen is lower than the count
// the super believes he took.
ok('hitting the cap is announced', (summary(10, 'limit', '10-photo') ?? '').includes('10-photo'));
ok('the cap message names how many landed', (summary(10, 'limit', '10-photo') ?? '').includes('10 photos'));
ok('a denied camera is announced with a fix', (summary(0, 'permission', '10-photo') ?? '').includes('Settings'));
ok('permission lost MID-walk still reports what was kept',
  (summary(3, 'permission', '10-photo') ?? '').includes('3 photos'),
  'telling a super "access is off" while silently keeping 3 shots is the same lie as dropping them');
ok('a camera that dies mid-walk reports what was kept',
  (summary(6, 'error', '10-photo') ?? '').includes('6 photos'));
ok('a camera that never opened does not claim photos were added',
  !/\d+ photo/.test(summary(0, 'error', '10-photo') ?? ''));
ok('one photo is not "1 photos"', !(summary(1, 'limit', '10-photo') ?? '').includes('1 photos'));

// ═══════════════════════════════════════════════════════════════════════════
// 2. The daily-report unsaved-work draft (audit #9)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\ndaily report — the unsaved-work guard:');

interface DfrDraftFns {
  dfrDraftKey: (projectId: string, reportId: string | null | undefined) => string;
  dfrDraftSignature: (c: Record<string, unknown>) => string;
  isDfrDirty: (c: Record<string, unknown>, baseline: string) => boolean;
  dfrDraftAgeLabel: (savedAt: string, now: Date) => string;
}
const dfr = loadRegion<DfrDraftFns>(
  'app/daily-report.tsx', 'dfrDraft',
  '{ dfrDraftKey, dfrDraftSignature, isDfrDirty, dfrDraftAgeLabel }',
);

const EMPTY_WEATHER = { temperature: '', conditions: '', wind: '', isManual: true };
const EMPTY_INCIDENT = {
  hasIncident: false, severity: undefined, description: '', peopleInvolved: '',
  injuriesReported: false, medicalTreatment: false, oshaRecordable: false,
  correctiveAction: '', reportedBy: '',
};
const blankReport = (over: Record<string, unknown> = {}) => ({
  reportDate: '2026-09-07T15:00:00.000Z',
  weather: EMPTY_WEATHER,
  manpower: [],
  workPerformed: '',
  workProgress: [],
  materialsDelivered: [],
  issuesAndDelays: '',
  photos: [],
  incident: EMPTY_INCIDENT,
  homeownerSummary: '',
  ...over,
});

// ── the key is swept on a tenant switch ────────────────────────────────────
// This is the half a new AsyncStorage key gets wrong. utils/localCacheKeys.ts
// sweeps BY PREFIX, so a key under a prefix nobody owns survives sign-out and
// hands the next contractor on a shared site-office iPad someone else's
// half-written report — the exact leak the 2026-08-17 web audit found live.
const draftKey = dfr.dfrDraftKey('proj-1', 'report-9');
ok('the draft key carries an app-owned prefix',
  APP_STORAGE_PREFIXES.some(p => draftKey.startsWith(p)),
  `"${draftKey}" is invisible to wipeLocalUserCache and leaks across tenants`);
ok('the draft key is scoped to the project AND the report',
  draftKey.includes('proj-1') && draftKey.includes('report-9'));
ok('a brand-new report gets its own slot, not a shared one',
  dfr.dfrDraftKey('proj-1', undefined) !== dfr.dfrDraftKey('proj-1', 'report-9'));
ok('two reports on one job do not share a slot',
  dfr.dfrDraftKey('proj-1', 'r1') !== dfr.dfrDraftKey('proj-1', 'r2'),
  'yesterday\'s draft and today\'s would overwrite each other');
ok('two jobs do not share a slot',
  dfr.dfrDraftKey('proj-1', 'r1') !== dfr.dfrDraftKey('proj-2', 'r1'));

// ── the dirty check ────────────────────────────────────────────────────────
const cleanSignature = dfr.dfrDraftSignature(blankReport());
ok('an untouched report is not dirty', !dfr.isDfrDirty(blankReport(), cleanSignature));
ok('typing work performed makes it dirty',
  dfr.isDfrDirty(blankReport({ workPerformed: 'Poured the north footing' }), cleanSignature));
ok('adding a crew row makes it dirty',
  dfr.isDfrDirty(blankReport({ manpower: [{ id: 'm1', trade: 'Framing', company: 'Ace', headcount: 4, hoursWorked: 8 }] }), cleanSignature));
ok('adding a photo makes it dirty',
  dfr.isDfrDirty(blankReport({ photos: [{ id: 'p1', uri: 'file:///a.jpg', timestamp: 'x' }] }), cleanSignature));
ok('logging an incident makes it dirty',
  dfr.isDfrDirty(blankReport({ incident: { ...EMPTY_INCIDENT, hasIncident: true, description: 'Cut hand' } }), cleanSignature));
ok('changing the report date makes it dirty',
  dfr.isDfrDirty(blankReport({ reportDate: '2026-09-06T15:00:00.000Z' }), cleanSignature));
ok('a materials delivery makes it dirty',
  dfr.isDfrDirty(blankReport({ materialsDelivered: ['12 sheets 5/8 type X'] }), cleanSignature));

// Whitespace-only edits are not edits. A guard that calls them edits makes the
// leave-prompt fire on a report nobody touched, and a prompt that cries wolf is
// a prompt the super learns to dismiss without reading — which is how the
// original data loss comes back through the front door.
ok('trailing whitespace alone is NOT dirty',
  !dfr.isDfrDirty(blankReport({ workPerformed: '   ' }), cleanSignature));

// The whole reason the signature is hand-ordered instead of JSON.stringify of
// the object: the geo stamp patches coordinates onto a photo SECONDS after it
// was taken, and that must not read as the user editing the report.
const withPhoto = blankReport({ photos: [{ id: 'p1', uri: 'file:///a.jpg', timestamp: 't' }] });
const withStampedPhoto = blankReport({
  photos: [{ id: 'p1', uri: 'file:///a.jpg', timestamp: 't', latitude: 39.7, longitude: -104.9, locationLabel: '1 Main St' }],
});
ok('a late GPS stamp does not, on its own, count as an edit',
  !dfr.isDfrDirty(withStampedPhoto, dfr.dfrDraftSignature(withPhoto)),
  'coordinates arriving 3s after the shutter would otherwise re-arm the leave prompt');

// Key order is an implementation detail of however the object was built.
const reordered = { photos: [], incident: EMPTY_INCIDENT, homeownerSummary: '', issuesAndDelays: '',
  materialsDelivered: [], workProgress: [], workPerformed: '', manpower: [],
  weather: EMPTY_WEATHER, reportDate: '2026-09-07T15:00:00.000Z' };
ok('the signature does not depend on object key order',
  !dfr.isDfrDirty(reordered, cleanSignature));

// ── the restore prompt names the draft honestly ────────────────────────────
const NOW = new Date('2026-09-07T18:30:00.000Z');
ok('a draft from today is named by clock time',
  dfr.dfrDraftAgeLabel('2026-09-07T16:12:00.000Z', NOW).startsWith('at '));
ok('a draft from another day is named by that day, not "2 hours ago"',
  dfr.dfrDraftAgeLabel('2026-09-05T16:12:00.000Z', NOW).startsWith('on '),
  'a relative phrase read the next morning is the DFR-CARRY-LABEL failure again');
eq('an unreadable savedAt says "earlier" rather than "Invalid Date"',
  dfr.dfrDraftAgeLabel('not a date', NOW), 'earlier');

// ── the exits are actually guarded ─────────────────────────────────────────
const dfrCode = read('app/daily-report.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the back chevron goes through the dirty check, not straight to router.back()',
  /onPress=\{handleBack\}/.test(dfrCode),
  'a bare router.back() on a screen with no header is how twenty minutes of work disappeared');
ok('the edge-swipe is disabled while there is unsaved work',
  /gestureEnabled: !isDirty/.test(dfrCode),
  'headerShown is false, so the swipe is a second exit that never reaches handleBack');
// Windowed, not a bare occurrence check. There are four removeItem(draftKey)
// calls on this screen — the debounced effect, the discard branch, the
// save-draft branch and this one — so a bare `/removeItem\(draftKey\)/` stayed
// green with the save's own clear deleted, which is the case that matters: the
// save navigates away, cancelling the debounce, and the draft then outlives the
// record it was a draft OF and gets offered back on the next new report.
// The window that would turn this fix into its own data loss: the form seeds
// its fields from `existingReport` at mount and does not re-seed, so if the
// report list hydrates a beat later, a BLANK form sits against a populated
// baseline — reads as dirty, autosaves an empty draft over the real one, and
// offers that back on the next open.
// Both halves are asserted, and that is the lesson of the first version of
// this check: `/const draftReady = /` plus one gate stayed green when
// `draftReady` was replaced by the constant `true`, and again when the gate was
// deleted from the WRITE effect (the surviving restore-effect gate matched).
// So: the flag must actually be derived from the loaded record, and BOTH
// effects must be behind it.
{
  const readyGates = (dfrCode.match(/if \(!projectId \|\| !draftReady\) return;/g) ?? []).length;
  ok('the draft waits until the screen knows what is actually saved',
    /const draftReady = [^;]*\bexistingReport\b[^;]*;/.test(dfrCode)
      && /const draftReady = [^;]*\bproject\b[^;]*;/.test(dfrCode)
      && readyGates >= 2,
    `draftReady must be derived from the loaded record and gate BOTH draft effects (found ${readyGates} gate(s))`);
}

ok('a save clears the draft rather than leaving it to the debounce',
  /AsyncStorage\.removeItem\(draftKey\)[\s\S]{0,160}?if \(!silent\) router\.back\(\);/.test(dfrCode),
  'without this the draft outlives the record and is offered back on the next new report');

// ── what the APP filled in is not unsaved work ─────────────────────────────
//
// DFR-DIRTY-AUTOFILL (review 2026-09-08). Two effects on this screen write
// fields with no user action on a brand-new report — the weather auto-fetch
// (any project with a location) and the schedule crew prefill (any project
// with a task live today). Compared against the EMPTY report, both make the
// screen dirty within a second of opening: the iOS edge-swipe goes dead, the
// back chevron raises "Leave without saving?" on a report nobody touched, and
// a draft of the app's own guesses is written and offered back the next
// morning — with yesterday's date and yesterday's crew on it, because Restore
// sets reportDate from the draft. A prompt that cries wolf is one the super
// learns to dismiss without reading, which is how the original data loss
// walks back in through the front door.
//
// First, prove the exposure is real: an auto-filled field genuinely reads as
// an edit against an empty baseline. That is WHY the wiring below matters.
ok('an app-written weather block would read as an edit if it were not folded in',
  dfr.isDfrDirty(blankReport({ weather: { temperature: '71°F / 22°C', conditions: 'Clear', wind: '5 mph NW', isManual: false } }), cleanSignature));
ok('an app-seeded crew roster would too',
  dfr.isDfrDirty(blankReport({ manpower: [{ id: 'seed-1', trade: 'Framing', company: '', headcount: 4, hoursWorked: 8 }] }), cleanSignature));

ok('the unsaved-work baseline absorbs the weather the screen fetched itself',
  /weather: existingReport\?\.weather \?\? autoFilled\.weather \?\?/.test(dfrCode),
  'otherwise every new DFR on a project with a location is dirty before the super types');
ok('...and the crew the schedule prefilled',
  /manpower: existingReport\?\.manpower \?\? autoFilled\.manpower \?\?/.test(dfrCode),
  'otherwise every new DFR on a project with a live task is dirty before the super types');
ok('...and the baseline actually recomputes when they land',
  /\}\), \[existingReport, autoFilled\]\);/.test(dfrCode),
  'a memo that never re-runs holds the empty baseline and the screen stays dirty forever');
ok('the on-mount weather fetch is marked as the app acting, not the user',
  /void fetchWeather\(\{ auto: true \}\)/.test(dfrCode));
ok('the schedule crew prefill records what it seeded',
  /setManpower\(seeded\);\s*setAutoFilled\(/.test(dfrCode),
  'the seed has to reach the baseline or it reads as the GC typing a roster');
// The manual "Auto-fetch" button IS the user's work and must read as an edit.
// Wired straight to onPress, the press event arrives as the options argument
// and `opts.auto` is undefined by luck rather than by design — one refactor
// away from a tap that silently stops counting.
ok('the manual weather button is not wired straight through to fetchWeather',
  !/onPress=\{fetchWeather\}/.test(dfrCode),
  'a tap on Auto-fetch is an edit; only the unattended mount fetch is not');

// ═══════════════════════════════════════════════════════════════════════════
// 3. The permit inspection history (audit #14)
// ═══════════════════════════════════════════════════════════════════════════
console.log('\npermits — the inspection history:');

type Result = 'scheduled' | 'passed' | 'failed' | 'cancelled';
interface Inspection {
  id: string; name: string; scheduledFor: string; result: Result;
  notes?: string; inspectorName?: string; recordedAt: string;
}
interface PermitFns {
  decodePermitInspectionNotes: (raw: string | undefined | null) => { notes: string; inspections: Inspection[] };
  encodePermitInspectionNotes: (notes: string, rows: Inspection[]) => string | undefined;
  foldCurrentInspection: (args: {
    inspections: Inspection[]; status: string; inspectionDate: string; inspectionNotes: string;
    phase?: string; inspectorName?: string; now: string; newId: () => string;
  }) => Inspection[];
  sortPermitInspections: (rows: Inspection[]) => Inspection[];
  inspectionHistorySummary: (rows: Inspection[]) => string | null;
}
const permit = loadRegion<PermitFns>(
  'app/permits.tsx', 'permitInspectionCodec',
  '{ decodePermitInspectionNotes, encodePermitInspectionNotes, foldCurrentInspection, sortPermitInspections, inspectionHistorySummary }',
);

const insp = (over: Partial<Inspection> = {}): Inspection => ({
  id: 'i1', name: 'Footing', scheduledFor: '2026-05-04', result: 'failed',
  notes: 'Rebar clearance short at the NE corner.', recordedAt: '2026-05-04T18:00:00.000Z', ...over,
});

// ── the round trip is the whole point ──────────────────────────────────────
{
  const rows = [insp(), insp({ id: 'i2', name: 'Rough electrical', scheduledFor: '2026-06-11', result: 'passed', notes: undefined })];
  const encoded = permit.encodePermitInspectionNotes('Re-inspection booked for the 12th.', rows);
  const back = permit.decodePermitInspectionNotes(encoded);
  eq('the human note survives the round trip', back.notes, 'Re-inspection booked for the 12th.');
  eq('every inspection survives the round trip', back.inspections.length, 2);
  eq('the failure notes survive — the whole reason the history exists',
    back.inspections.find(i => i.id === 'i1')?.notes,
    'Rebar clearance short at the NE corner.');
}

// ── the encoded block must never reach a human ─────────────────────────────
{
  const encoded = permit.encodePermitInspectionNotes('Corrections due Friday.', [insp()]) ?? '';
  ok('the raw column is NOT display text', encoded.includes('[[mage:inspections]]'));
  const decoded = permit.decodePermitInspectionNotes(encoded);
  ok('the decoder strips the block out of the notes',
    !decoded.notes.includes('[[mage:') && !decoded.notes.includes('scheduledFor'),
    'the permit card prints these notes; a JSON blob in the failed-inspection alert is the visible failure');
}

// ── what comes back from rows written before this shipped ──────────────────
eq('a plain note (seeder, console, older build) decodes as a plain note',
  permit.decodePermitInspectionNotes('Smoke detector placement non-compliant.'),
  { notes: 'Smoke detector placement non-compliant.', inspections: [] });
eq('an empty column decodes to nothing', permit.decodePermitInspectionNotes(undefined), { notes: '', inspections: [] });
eq('a null column decodes to nothing', permit.decodePermitInspectionNotes(null), { notes: '', inspections: [] });
{
  const corrupt = permit.decodePermitInspectionNotes('Notes here.\n\n[[mage:inspections]]{not json[[/mage:inspections]]');
  eq('unreadable JSON still yields readable notes', corrupt.notes, 'Notes here.');
  eq('...and drops the history rather than rendering machine text', corrupt.inspections.length, 0);
}
{
  const truncated = permit.decodePermitInspectionNotes('Notes here.\n\n[[mage:inspections]][{"id":"a"');
  eq('a truncated block (column length limit) still yields readable notes', truncated.notes, 'Notes here.');
}
{
  const halfRow = permit.decodePermitInspectionNotes(
    `x\n\n[[mage:inspections]]${JSON.stringify([insp(), { id: 'bad', name: 'X' }, { ...insp({ id: 'c' }), result: 'exploded' }])}[[/mage:inspections]]`);
  eq('rows missing required fields are dropped, not half-rendered', halfRow.inspections.length, 1);
  eq('a result outside the union is dropped too', halfRow.inspections[0].id, 'i1');
}

// ── empty encodes to nothing, not to an empty block ────────────────────────
eq('no notes and no history writes NULL, not an empty sentinel',
  permit.encodePermitInspectionNotes('', []), undefined);
eq('notes with no history are stored as plain text',
  permit.encodePermitInspectionNotes('Just a note.', []), 'Just a note.');

// ── ordering ───────────────────────────────────────────────────────────────
{
  const sorted = permit.sortPermitInspections([
    insp({ id: 'a', scheduledFor: '2026-05-04' }),
    insp({ id: 'b', scheduledFor: '2026-07-20' }),
    insp({ id: 'c', scheduledFor: '2026-06-11' }),
  ]);
  eq('newest inspection first', sorted.map(i => i.id), ['b', 'c', 'a']);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. foldCurrentInspection — the bug itself
//
// THE ORIGINAL DEFECT: one inspectionDate + one inspectionNotes. Scheduling the
// framing inspection overwrote the footing's failure AND its correction note.
// The fold is what makes the existing, unchanged workflow leave a record.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\npermits — booking the next inspection cannot erase the last:');

const NEW_ID = () => 'generated-id';
const fold = (over: Partial<Parameters<PermitFns['foldCurrentInspection']>[0]> = {}) =>
  permit.foldCurrentInspection({
    inspections: [], status: 'inspection_failed', inspectionDate: '2026-05-04',
    inspectionNotes: 'Rebar clearance short at the NE corner.', phase: 'Foundation',
    now: '2026-05-04T18:00:00.000Z', newId: NEW_ID, ...over,
  });

{
  // The exact reported sequence: footing fails, framing is then booked.
  const afterFooting = fold();
  eq('the failed footing is recorded', afterFooting.length, 1);
  eq('...with its correction notes', afterFooting[0].notes, 'Rebar clearance short at the NE corner.');

  const afterFraming = permit.foldCurrentInspection({
    inspections: afterFooting, status: 'inspection_scheduled',
    inspectionDate: '2026-06-11', inspectionNotes: '', phase: 'Framing',
    now: '2026-05-20T18:00:00.000Z', newId: () => 'framing-id',
  });
  eq('booking the next inspection keeps the last one', afterFraming.length, 2);
  eq('THE BUG: the footing failure notes are still there',
    afterFraming.find(i => i.scheduledFor === '2026-05-04')?.notes,
    'Rebar clearance short at the NE corner.',
    'this is the exact loss the finding described');
  eq('...and the footing is still a failure, not overwritten by the new booking',
    afterFraming.find(i => i.scheduledFor === '2026-05-04')?.result, 'failed');
}

// ── idempotence: the fold runs on EVERY save of the permit form ────────────
{
  const once = fold();
  const twice = permit.foldCurrentInspection({
    inspections: once, status: 'inspection_failed', inspectionDate: '2026-05-04',
    inspectionNotes: 'Rebar clearance short at the NE corner.', phase: 'Foundation',
    now: '2026-05-05T09:00:00.000Z', newId: NEW_ID,
  });
  eq('re-saving the form does not log a second inspection', twice.length, 1);
  eq('...and does not touch the row it already wrote', twice[0].id, once[0].id);
}

// ── a scheduled visit that gets called resolves IN PLACE ───────────────────
{
  const booked = permit.foldCurrentInspection({
    inspections: [], status: 'inspection_scheduled', inspectionDate: '2026-06-11',
    inspectionNotes: '', phase: 'Rough electrical', now: '2026-06-01T09:00:00.000Z', newId: () => 'sched',
  });
  eq('the booking is recorded', booked[0].result, 'scheduled');
  const called = permit.foldCurrentInspection({
    inspections: booked, status: 'inspection_failed', inspectionDate: '2026-06-11',
    inspectionNotes: 'GFCI missing in the two bathrooms.', phase: 'Rough electrical',
    now: '2026-06-11T16:00:00.000Z', newId: () => 'should-not-be-used',
  });
  eq('a called inspection is ONE inspection, not two', called.length, 1);
  eq('...it resolves in place', called[0].result, 'failed');
  eq('...keeping the row id it was booked under', called[0].id, 'sched');
  eq('...and gaining the inspector notes', called[0].notes, 'GFCI missing in the two bathrooms.');
}

// ── two inspections on ONE day are still two inspections ───────────────────
//
// Review 2026-09-08: the fold matched a row on its calendar DAY alone, which
// is the finding's own bug narrowed to a day. A permit runs two inspections on
// one Thursday all the time — a re-inspection called the same morning a new
// trade is booked, a combined permit covering rough plumbing and rough
// mechanical, or any row the GC logged by hand — and folding the head onto
// whichever row shared the date replaced that inspection's verdict and its
// correction notes.
{
  const failedFooting = permit.foldCurrentInspection({
    inspections: [], status: 'inspection_failed', inspectionDate: '2026-06-10',
    inspectionNotes: 'Rebar clearance short at the NE corner.', phase: 'Foundation',
    now: '2026-06-10T16:00:00.000Z', newId: () => 'footing',
  });
  const alsoFraming = permit.foldCurrentInspection({
    inspections: failedFooting, status: 'inspection_scheduled', inspectionDate: '2026-06-10',
    inspectionNotes: '', phase: 'Framing',
    now: '2026-06-10T17:00:00.000Z', newId: () => 'framing',
  });
  eq('a different inspection on the SAME day gets its own row', alsoFraming.length, 2);
  eq('THE BUG, same-day: the failed footing keeps its verdict',
    alsoFraming.find(i => i.id === 'footing')?.result, 'failed');
  eq('...and its correction notes',
    alsoFraming.find(i => i.id === 'footing')?.notes, 'Rebar clearance short at the NE corner.');
}
{
  // The same collision from the other direction: a row the GC logged by hand
  // in the history editor, then a head that happens to share its date.
  const logged: Inspection = {
    id: 'logged-mech', name: 'Rough mechanical', scheduledFor: '2026-07-02', result: 'passed',
    notes: 'Duct straps re-spaced, accepted.', recordedAt: '2026-07-02T15:00:00.000Z',
  };
  const after = permit.foldCurrentInspection({
    inspections: [logged], status: 'inspection_passed', inspectionDate: '2026-07-02',
    inspectionNotes: 'Rough plumbing accepted.', phase: 'Rough plumbing',
    now: '2026-07-02T16:00:00.000Z', newId: () => 'plumbing',
  });
  eq('a hand-logged inspection is not overwritten by a same-day head', after.length, 2);
  eq('...and keeps the note the GC typed into it',
    after.find(i => i.id === 'logged-mech')?.notes, 'Duct straps re-spaced, accepted.');
}
{
  // The behaviour this must NOT break: a booking with no verdict yet is still
  // resolved in place even when the phase was renamed between the two saves.
  const booked = permit.foldCurrentInspection({
    inspections: [], status: 'inspection_scheduled', inspectionDate: '2026-08-14',
    inspectionNotes: '', phase: undefined, now: '2026-08-01T09:00:00.000Z', newId: () => 'booked',
  });
  const called = permit.foldCurrentInspection({
    inspections: booked, status: 'inspection_passed', inspectionDate: '2026-08-14',
    inspectionNotes: '', phase: 'Final', now: '2026-08-14T16:00:00.000Z', newId: () => 'unused',
  });
  eq('a booking with no verdict still resolves in place after a phase rename', called.length, 1);
  eq('...on the row it was booked under', called[0].id, 'booked');
}

// ── what must NOT be folded ────────────────────────────────────────────────
eq('an applied permit with no inspection status records nothing',
  fold({ status: 'applied' }).length, 0);
eq('an approved permit records nothing', fold({ status: 'approved' }).length, 0);
eq('a denied permit records nothing', fold({ status: 'denied' }).length, 0);
eq('no inspection date means there is nothing to record',
  fold({ inspectionDate: '' }).length, 0);

// ── the name is the phase the GC typed, never invented from the type ───────
eq('the phase names the inspection', fold({ phase: 'Foundation' })[0].name, 'Foundation');
eq('no phase falls back to a neutral label, not a guessed trade',
  fold({ phase: undefined })[0].name, 'Inspection');
eq('a blank phase does too', fold({ phase: '   ' })[0].name, 'Inspection');

// ── a full ISO instant in the legacy column still lands on the right day ───
eq('an ISO timestamp is stored as a calendar day',
  fold({ inspectionDate: '2026-05-04T00:00:00.000Z' })[0].scheduledFor, '2026-05-04');

// ── the card summary ───────────────────────────────────────────────────────
eq('no history says nothing on the card', permit.inspectionHistorySummary([]), null);
ok('a history with a failure says so',
  (permit.inspectionHistorySummary([insp(), insp({ id: 'b', result: 'passed' })]) ?? '').includes('1 failed'));
ok('nothing called yet reads as scheduled, not as passed',
  (permit.inspectionHistorySummary([insp({ result: 'scheduled' })]) ?? '').includes('scheduled'));

// ── the invariant that keeps the encoding safe ─────────────────────────────
const permitCode = read('app/permits.tsx')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('nothing on the permits screen renders inspectionNotes raw',
  !/\{permit\.inspectionNotes\}/.test(permitCode) && !/inspectionNotes: permit\.inspectionNotes/.test(permitCode),
  'the column carries an encoded block; every read must go through the decoder');
ok('the save folds the current inspection into the history',
  /foldCurrentInspection\(/.test(permitCode),
  'without the fold, scheduling the next inspection still overwrites the last one');
ok('the save re-encodes the history into the column it round-trips through',
  /inspectionNotes: encodePermitInspectionNotes\(/.test(permitCode),
  'writing an unmapped `inspections` field alone is data loss — the permits query overwrites local rows from the server');

// ── the OTHER half of that invariant: universal search ─────────────────────
//
// The check above reads only app/permits.tsx, and the leak was never there.
// hooks/useUniversalSearch.ts put `p.inspectionNotes` into the permit haystack
// and rendered `matchSnippet` as a window into that same raw string, so a
// search landing inside the encoded block printed JSON at the GC. The screen
// was clean and the invariant was violated anyway — an encoding is only as
// private as its LEAKIEST reader, and the guard has to walk every reader, not
// the file where the encoding lives.
const searchCode = read('hooks/useUniversalSearch.ts')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('universal search never puts inspectionNotes into the haystack raw',
  !/\[\s*'inspectionNotes'\s*,\s*p\.inspectionNotes\s*\]/.test(searchCode),
  'that string is the encoded block; a snippet window into it prints machine text at the GC');
ok('it reads inspection notes through a decoding reader',
  /\[\s*'inspectionNotes'\s*,\s*permitInspectionSearchText\(/.test(searchCode),
  'the haystack entry must go through the decode + shape scrub');
ok('that reader falls back on SHAPE, not on a sentinel constant it cannot see',
  /MACHINE_TEXT_SHAPE/.test(searchCode) && /stopAtMachineText\(/.test(searchCode),
  'app/permits.tsx owns the sentinel; a reader keyed to its literal value silently ' +
  'un-fixes itself the day that constant is renamed, in a different file, with nothing coupling them');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
