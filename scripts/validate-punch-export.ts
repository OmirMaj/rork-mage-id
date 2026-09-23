// scripts/validate-punch-export.ts — "export that punchlist, all items".
//
// WHY THIS EXISTS. The founder, 2026-09-17: "make it a feature to export that
// punchlist please, allow me to export all items". A punch list export is a
// document three people hold copies of — the GC, the sub, the owner's rep —
// and every way it goes wrong is silent on the phone that made it:
//
//   • a filtered copy numbered 1..k instead of by the full list sends the sub
//     to "#3" when the GC's copy calls that item "#14";
//   • ties in createdAt (a Photo walk stamps ONE `now` on a whole batch — 63
//     items, 24 distinct instants on Watermark 9F) numbered in input order
//     reshuffle between two exports of the same list;
//   • `new Date('2026-09-14')` prints Sep 13 west of Greenwich;
//   • a description starting with "=" runs as a formula in Excel;
//   • a failed <img> prints WebKit's "?" icon; an <object> hosting an SVG
//     document can run script; the internal crew list reaches the owner
//     unmarked; an iOS share sheet presented mid-dismiss is dropped.
//
// HOW IT CHECKS.
//   A–D. utils/punchExportCore.ts and utils/punchExportHtml.ts are pure and
//        EXECUTED here over a 22-item fixture (both lists, all four statuses,
//        tied and mixed-form timestamps, pins in every state, eight items on
//        one spot, hostile text in every field, sentinel ids that must never
//        be exported) plus a generated 105-photo fixture for caps/priority.
//   E.   The date rules re-run in child processes under TZ = America/Denver,
//        UTC and Asia/Tokyo.
//   F.   Source pins on comment-stripped text for the platform file and the
//        component (the parts bun cannot execute).
//   G.   The wiring in app/punch-list.tsx and package.json. G0 self-tests the
//        wiring checker on the handoff snippet and on a known-bad one, so the
//        rule is proven before the handoff lands; G1 reads the real files and
//        stays RED until the orchestrator applies the handoff.
//
// MUTATION TEST (2026-09-17, builder). Each mutation below was applied to the
// real file, one at a time; the guard went red in a non-G section every time;
// the file was restored and confirmed byte-identical with cmp/sha256:
//   1 numbering descending · 2 id tiebreak removed · 3 createdAt compared as a
//   string · 4 model numbers the subset · 5 itemsInScope ignores includeCrew ·
//   6 listType read raw · 7 statusLabel 'Review' · 8 dueInfo new Date(due) ·
//   9 closedDay for any closedAt · 10 formula guard removed · 11 LF not CRLF ·
//   12 BOM dropped · 13 escHtml dropped from the description · 14 escHtml
//   dropped from markup text · 15 safeObjectSrc accepts any https origin ·
//   16 safeObjectSrc accepts svg+xml · 17 unavailable photo renders <object> ·
//   18 .pe-fail removed from the <object> · 19 <img> instead of <object> ·
//   20 CSP meta dropped / object-src widened · 21 pin transform -50%,-50% ·
//   22 clusterPins removed · 23 formatNumberRuns emits no ranges · 24 shortRefs
//   loses its collision extension · 25 photo priority removed · 26 iOS cap 25 /
//   web cap 101 · 27 '-internal' dropped · 28 sign-off with crew present ·
//   29 effective grouping removed · 30 await before openPrintWindow · 31 iOS
//   share called directly · 32 margins removed · 33 noopener added ·
//   34 nativeRenderBusy check removed · 35 xray tell printed · 36 punch-list
//   passes items={items} (proven through G0's synthetic bad wiring).
// 38 runs in all (20, 24 and 26 were each run as two variants, 24b being a
// collision that needs a second round); every one red, every file restored
// with a matching sha256. FIX ROUND 1 added 16 more, all red and restored
// byte-identical: bare Ref cell · days open counted to today with no closedAt ·
// GPS from the label only (first run GREEN, then a model-level CSV case was
// added) · prototype-key markup colour · pre-wrap dropped · .pe-fail and
// .pe-plan-fail z-index lowered · legend description unescaped ·
// over_offline_budget text dropped · verifyRemote accepts any image/* · CORS
// fallback for non-raster paths · plan signing unbounded · logo unchecked ·
// share failure silent · synchronous throw swallowed · literal scrim. Two first drafts of this guard let #21 and #24 pass
// (a -webkit-transform twin, a one-round collision) and were tightened.
//
// Run via: bun run scripts/validate-punch-export.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { PhotoMarkup, PlanSheet, PunchItem } from '../types';
import {
  buildPunchExportCsv,
  buildPunchExportModel,
  calendarDaysBetween,
  clusterPins,
  csvCell,
  csvRefCell,
  describeFilters,
  describeScope,
  dueInfo,
  exportDisabledReason,
  exportFileName,
  formatGeneratedAt,
  formatNumberRuns,
  itemsInScope,
  listChoice,
  nativePhotoEstimate,
  overCapPhotoText,
  photoCapFor,
  photoGpsText,
  photoNotes,
  photoSummaryLine,
  primaryLabel,
  punchItemNumbers,
  scopeOptions,
  shortRefs,
  statusLabel,
  parseExportPref,
  webPrintWaitMs,
  PUNCH_EXPORT_CSV_COLUMNS,
  PUNCH_EXPORT_PHOTO_TEXT,
  PUNCH_EXPORT_PREF_KEY,
  PUNCH_EXPORT_INTERNAL_STAMP,
  type BuildPunchExportModelInput,
  type PunchExportAssets,
  type PunchExportImageAsset,
  type PunchExportModel,
  type PunchExportScopeInput,
} from '../utils/punchExportCore';
import {
  buildCsp,
  buildPunchExportHtml,
  markupSvg,
  pinStyle,
  safeLogoSrc,
  safeObjectSrc,
  PUNCH_EXPORT_CSS,
} from '../utils/punchExportHtml';
import { UNPLACED_LOCATION_GROUP } from '../utils/punchLocations';
import { punchStatusPatch } from '../utils/punchGcCore';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TZ_CHILD_FLAG = 'PUNCH_EXPORT_TZ_CHILD';
const IS_CHILD = !!process.env[TZ_CHILD_FLAG];

let pass = 0, fail = 0;
let section = 'A';
const failedSections = new Set<string>();
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; if (!IS_CHILD) console.log('  \u2713', label); }
  else { fail++; failedSections.add(section); console.log('  \u2717', `[${section}]`, label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}`);
}
function head(s: string, title: string) {
  section = s;
  if (!IS_CHILD) console.log(`\n${s}. ${title}`);
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}
function count(hay: string, needle: string | RegExp): number {
  if (typeof needle === 'string') return hay.split(needle).length - 1;
  return (hay.match(new RegExp(needle.source, needle.flags.includes('g') ? needle.flags : needle.flags + 'g')) ?? []).length;
}

// ───────────────────────────────────────────────────────────────────────────
// Fixture
// ───────────────────────────────────────────────────────────────────────────

const PROJECT = { id: 'p1', name: 'Watermark 9F', location: '120 Main St, Denver CO' };
const XRAY_TELL = 'XRAY-SENTINEL-7731';
const SUBID = 'SUBID-SENTINEL-4410';
const TASKID = 'TASKID-SENTINEL-9902';
const SPATH = 'u1/p1/punch-SPATH-SENTINEL.jpg';
const HOSTILE_DESC = '<script>alert(1)</script> & "quoted", \'single\' "><img src=x>';
const HOSTILE_LOC = '<b>Hall</b> & "2"';
const STORAGE_ORIGIN = 'https://nteoqhcswappxxjlpvap.supabase.co';

const uid = (prefix: string, n: number) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;

function mk(id: string, over: Partial<PunchItem>): PunchItem {
  return {
    id,
    projectId: 'p1',
    description: `Item ${id.slice(0, 4)}`,
    location: '',
    assignedSub: '',
    dueDate: '',
    priority: 'medium',
    status: 'open',
    createdAt: '2026-09-01T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00Z',
    ...over,
  };
}

const MARKUP: PhotoMarkup[] = [
  { id: 'm1', type: 'arrow', color: 'red', points: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.5 }] },
  { id: 'm2', type: 'circle', color: 'yellow', points: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }] },
  { id: 'm3', type: 'freehand', color: 'green', points: [{ x: 0.1, y: 0.9 }, { x: 0.2, y: 0.8 }, { x: 0.3, y: 0.85 }] },
  { id: 'm4', type: 'text', color: 'red', points: [{ x: 0.6, y: 0.2 }], text: '<i>x</i> & "y"' },
  { id: 'm5', type: 'rectangle', color: 'red', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }] },
  { id: 'm6', type: 'arrow', color: 'red', points: [{ x: NaN, y: 0.1 }, { x: 0.5, y: 0.5 }] },
];

const ID = {
  i01: 'c0000001-0000-4000-8000-000000000001',
  i02: 'a0000002-0000-4000-8000-000000000002',
  i03: 'b0000003-0000-4000-8000-000000000003',
  i04: uid('d0000004', 4),
  i05: uid('d0000005', 5),
  i06: uid('d0000006', 6),
  i15: uid('d0000015', 15),
  i16: uid('d0000016', 16),
  r1: 'abcdef11-0000-4000-8000-000000000018',
  r2: 'abcdef22-0000-4000-8000-000000000019',
  f1: uid('d0000020', 20),
  f2: uid('d0000021', 21),
  f3: uid('d0000022', 22),
  i17: uid('d0000017', 17),
};
const K_IDS = Array.from({ length: 8 }, (_, i) => uid(`e00000${String(i + 1).padStart(2, '0')}`, 30 + i));

/** #57: the sub's own words from his portal — hostile, so escaping is proven. */
const SUB_NOTE = '<i>replaced</i> & see "closet" side';

const ITEMS: PunchItem[] = [
  mk(ID.i01, {
    description: HOSTILE_DESC, location: 'Hall 2', dueDate: '2026-09-14', priority: 'high',
    photoStoragePath: 'u1/p1/punch-i01.jpg', assignedSub: '=SUM(A1)', assignedSubId: SUBID,
    linkedTaskId: TASKID, linkedTaskName: '@task <x>', rejectionNote: '<b>no</b> & back', photoLocationLabel: '+39.7, -104.9',
    xray: { tell: XRAY_TELL } as unknown as PunchItem['xray'],
  }),
  mk(ID.i02, { location: 'Hall 10', status: 'in_progress', dueDate: '2026-09-20T00:00:00.000Z', photoUri: `${STORAGE_ORIGIN}/storage/v1/object/sign/p/x.jpg?token=abc` }),
  mk(ID.i03, { location: 'Hall 2', status: 'ready_for_review', createdAt: '2026-09-01T10:00:00+00:00', photoLocalUri: 'file:///var/x/i03.jpg', subNote: SUB_NOTE }),
  mk(ID.i04, { listType: 'crew', location: 'Roof', status: 'closed', closedAt: '2026-09-05T15:00:00Z', createdAt: '2026-09-02T10:00:00Z' }),
  mk(ID.i05, { status: 'open', closedAt: '2026-09-04T12:00:00Z', createdAt: '2026-09-02T11:00:00Z', assignedSub: 'Acme' }),
  mk(ID.i06, { planSheetId: 'S1', pinX: 0.5, pinY: 0.5, createdAt: '2026-09-02T12:00:00Z' }),
  mk(ID.i15, { planSheetId: 'S1', createdAt: '2026-09-02T13:00:00Z' }),
  mk(ID.i16, { planSheetId: 'sheet-gone', pinX: 0.2, pinY: 0.2, createdAt: '2026-09-02T14:00:00Z' }),
  mk(ID.r1, { location: 'Basement', createdAt: '2026-09-02T15:00:00Z', assignedSub: 'acme' }),
  mk(ID.r2, { location: 'Basement', createdAt: '2026-09-02T16:00:00Z' }),
  mk(ID.f1, { listType: 'crew', location: 'Roof', dueDate: '2026-09-14T00:00:00.000Z', createdAt: '2026-09-02T17:00:00Z' }),
  mk(ID.f2, { location: HOSTILE_LOC, status: 'closed', closedAt: '2026-09-06T12:00:00Z', createdAt: '2026-09-02T18:00:00Z', photoStoragePath: SPATH }),
  mk(ID.f3, { location: HOSTILE_LOC, status: 'ready_for_review', createdAt: '2026-09-02T19:00:00Z' }),
  ...K_IDS.map((id, i) => mk(id, {
    location: 'Kitchen', planSheetId: 'S2', pinX: 0.3, pinY: 0.4,
    createdAt: `2026-09-03T00:00:0${i + 1}Z`,
    status: i === 0 ? 'open' : i % 2 ? 'closed' : 'in_progress',
    ...(i === 0 ? { photoStoragePath: 'u1/p1/punch-k1.jpg' } : {}),
  })),
  mk(ID.i17, { createdAt: 'not a date' }),
];

const SHEETS: PlanSheet[] = [
  { id: 'S1', projectId: 'p1', name: 'Level 1', sheetNumber: 'A-101', imageUri: '', storagePath: 'p1/s1.png', width: 3000, height: 2000, createdAt: '', updatedAt: '' },
  { id: 'S2', projectId: 'p1', name: 'Level 2 <plan>', sheetNumber: 'A-102', imageUri: '', storagePath: 'p1/s2.png', width: 2000, height: 2000, createdAt: '', updatedAt: '' },
];

const FILTERS = { status: 'all' as const, sub: '', priority: 'all' as const, locationKey: '', locationLabel: '' };
function scopeIn(over: Partial<PunchExportScopeInput> = {}): PunchExportScopeInput {
  return { allItems: ITEMS, filteredItems: ITEMS, selectedIds: [], activeList: 'punch', filters: FILTERS, ...over };
}
const NOW = new Date(2026, 8, 17, 12, 0, 0);
const MARKUP_MAP = new Map<string, readonly PhotoMarkup[]>([[ID.i01, MARKUP]]);
function model(over: Partial<BuildPunchExportModelInput> = {}): PunchExportModel {
  return buildPunchExportModel({
    scopeInput: scopeIn(),
    scope: 'all',
    includeCrew: true,
    target: 'web',
    project: PROJECT,
    sheets: SHEETS,
    markupByItemId: MARKUP_MAP,
    now: NOW,
    ...over,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// E. Timezones (runs in the parent AND in each TZ child)
// ───────────────────────────────────────────────────────────────────────────

function timezoneChecks(tz: string) {
  const bare = dueInfo({ dueDate: '2026-09-14', status: 'open' }, NOW);
  const iso = dueInfo({ dueDate: '2026-09-14T00:00:00.000Z', status: 'open' }, NOW);
  eq(`${tz}: bare and ISO due dates name the same day`, [bare.dueDay, iso.dueDay], ['2026-09-14', '2026-09-14']);
  eq(`${tz}: overdue by 3 days`, [bare.daysOverdue, iso.daysOverdue], [3, 3]);
  eq(`${tz}: a closed item is never overdue`, dueInfo({ dueDate: '2026-09-14', status: 'closed' }, NOW).daysOverdue, null);
  eq(`${tz}: an unparseable due date stays raw`, dueInfo({ dueDate: 'next Tuesday', status: 'open' }, NOW), { dueRaw: 'next Tuesday', dueDay: null, daysOverdue: null, dueToday: false });
  const late = new Date(2026, 8, 17, 23, 30).toISOString();
  const m = buildPunchExportModel({
    scopeInput: { ...scopeIn(), allItems: [mk('late', { createdAt: late })], filteredItems: [] },
    scope: 'all', includeCrew: true, target: 'ios', project: PROJECT, sheets: [], markupByItemId: new Map(), now: new Date(2026, 8, 18, 9, 0),
  });
  eq(`${tz}: an instant logged 11:30 pm local is created on the LOCAL day`, m.rows[0]?.createdDay, '2026-09-17');
  eq(`${tz}: days open counts calendar days`, m.rows[0]?.daysOpen, 1);
  eq(`${tz}: file-name date is the local day`, exportFileName({ projectName: 'X', scope: 'all', hasCrew: false, format: 'pdf', now: new Date(2026, 8, 17, 23, 30) }), 'punch-list-x-2026-09-17.pdf');
  const label = formatGeneratedAt(new Date(2026, 8, 17, 15, 42));
  const want: Record<string, string> = {
    'America/Denver': 'Sep 17, 2026 at 3:42 PM (GMT-6)',
    UTC: 'Sep 17, 2026 at 3:42 PM (GMT)',
    'Asia/Tokyo': 'Sep 17, 2026 at 3:42 PM (GMT+9)',
  };
  if (want[tz]) eq(`${tz}: generated-at label`, label, want[tz]);
  else ok(`${tz}: generated-at label has the shape`, /^Sep 17, 2026 at 3:42 PM \(GMT([+-]\d+(:\d\d)?)?\)$/.test(label), label);
}

if (IS_CHILD) {
  section = 'E';
  timezoneChecks(process.env.TZ ?? '');
  process.exit(fail > 0 ? 1 : 0);
}

// ───────────────────────────────────────────────────────────────────────────
head('A', 'numbering, refs, scope');
// ───────────────────────────────────────────────────────────────────────────

const nums = punchItemNumbers(ITEMS);
eq('numbers are 1..N', [...nums.values()].sort((a, b) => a - b), Array.from({ length: ITEMS.length }, (_, i) => i + 1));
eq('equal instants (Z and +00:00) tie-break by id', [nums.get(ID.i02), nums.get(ID.i03), nums.get(ID.i01)], [1, 2, 3]);
eq('an invalid createdAt sorts last', nums.get(ID.i17), ITEMS.length);
eq('the eight walk items are consecutive 14..21', K_IDS.map(id => nums.get(id)), [14, 15, 16, 17, 18, 19, 20, 21]);
{
  const shuffled = [...ITEMS].reverse();
  shuffled.push(shuffled.splice(3, 1)[0]);
  const again = punchItemNumbers(shuffled);
  ok('numbering does not depend on input order', ITEMS.every(i => again.get(i.id) === nums.get(i.id)));
  const moved = punchItemNumbers(ITEMS.map(i => (i.id === ID.i05 ? { ...i, listType: 'crew' as const } : i)));
  eq('moving an item to the crew list keeps its number', moved.get(ID.i05), nums.get(ID.i05));
  const dup = punchItemNumbers([...ITEMS, mk(ID.i02, { createdAt: '2020-01-01T00:00:00Z' })]);
  eq('a duplicate id keeps its first occurrence', dup.get(ID.i02), 1);
}

const refs = shortRefs(ITEMS);
eq('refs are 6 characters', refs.get(ID.i01), 'c00000');
eq('a colliding pair grows to 8', [refs.get(ID.r1), refs.get(ID.r2)], ['abcdef11', 'abcdef22']);
eq('refs are deterministic across input order', shortRefs([...ITEMS].reverse()).get(ID.r2), 'abcdef22');
eq('a collision that survives one round keeps growing', [...shortRefs([{ id: 'abcdef11-aaaa' }, { id: 'abcdef11-bbbb' }, { id: 'abcdef22-cccc' }]).values()], ['abcdef11aa', 'abcdef11bb', 'abcdef22']);
eq('ref of a symbol-only id falls back', shortRefs([{ id: '---' }]).get('---'), 'item');

{
  const all = itemsInScope(scopeIn(), 'all', true);
  eq("'all' + crew has every item", all.length, ITEMS.length);
  eq("'all' + crew covers every status", [...new Set(all.map(i => i.status))].sort(), ['closed', 'in_progress', 'open', 'ready_for_review']);
  ok("'all' + crew has both lists", all.some(i => i.listType === 'crew') && all.some(i => i.listType === undefined));
  const noCrew = itemsInScope(scopeIn(), 'all', false);
  eq("crew off drops only the crew list (missing listType counts as punch)", noCrew.length, ITEMS.length - 2);
  eq('filtered is filtered ∩ all', itemsInScope(scopeIn({ filteredItems: [ITEMS[0], mk('ghost', {})] }), 'filtered', false).map(i => i.id), [ID.i01]);
  eq('selected drops deleted ids', itemsInScope(scopeIn({ selectedIds: [ID.i04, 'deleted-id'] }), 'selected', false).map(i => i.id), [ID.i04]);
  eq('listChoice', listChoice(ITEMS), { available: true, punchCount: ITEMS.length - 2, crewCount: 2 });
}

{
  const f = { status: 'open' as const, sub: 'Acme', priority: 'high' as const, locationKey: UNPLACED_LOCATION_GROUP, locationLabel: '' };
  eq('describeFilters, every part', describeFilters(f, 'punch'), 'Punch list · Open · Sub: Acme · High priority · Location: No location given');
  eq('describeScope all + crew', describeScope(scopeIn(), 'all', true), 'All 22 items — 20 on the punch list, 2 on the crew list (internal)');
  eq('describeScope crew off', describeScope(scopeIn(), 'all', false), 'All 20 punch list items — crew list left out');
  eq('describeScope filtered', describeScope(scopeIn({ filteredItems: [ITEMS[0], ITEMS[4]], filters: f }), 'filtered', true),
    'Filtered: 2 of 22 items — Punch list · Open · Sub: Acme · High priority · Location: No location given');
  eq('describeScope selected, one list', describeScope(scopeIn({ selectedIds: [ID.i04, ID.f1] }), 'selected', true), 'Selected: 2 of 22 items — Crew list (internal)');
  eq('describeScope selected, mixed', describeScope(scopeIn({ selectedIds: [ID.i01, ID.i04] }), 'selected', true), 'Selected: 2 of 22 items');
  eq('describeScope crew-only project', describeScope(scopeIn({ allItems: [ITEMS[3], ITEMS[10]] }), 'all', true), 'All 2 items — crew list (internal)');
  eq('describeScope one list', describeScope(scopeIn({ allItems: ITEMS.slice(0, 3) }), 'all', true), 'All 3 items');

  const opts = scopeOptions(scopeIn({ filteredItems: [ITEMS[0]], selectedIds: [ID.i02, ID.i03] }), true);
  eq('three scope options', opts.map(o => o.label), ['Everything', "What's on screen", 'Selected (2)']);
  eq('Everything detail', opts[0].detail, '22 items · every status · punch and crew lists');
  eq('Everything detail, crew off', scopeOptions(scopeIn(), false)[0].detail, '20 items · every status · punch list only');
  eq("What's on screen detail", opts[1].detail, '1 item · Punch list');
  eq('Selected detail', opts[2].detail, 'The items you ticked');
  eq('filtered hidden when nothing is filtered, selected hidden when none', scopeOptions(scopeIn({ selectedIds: ['deleted'] }), true).map(o => o.scope), ['all']);
  const emptyFilter = scopeOptions(scopeIn({ filteredItems: [] }), true).find(o => o.scope === 'filtered');
  eq('empty filter reason', emptyFilter?.disabledReason, 'Nothing matches the filters on screen. Choose Everything, or clear a filter.');
  eq('empty project reason', exportDisabledReason({ projectItemCount: 0, scope: 'all', count: 0 }), 'Nothing to export yet — add a punch item first.');
  eq('no selection reason', exportDisabledReason({ projectItemCount: 3, scope: 'selected', count: 0 }), 'No items are selected. Choose Everything, or select items first.');
  eq('enabled when there is something', exportDisabledReason({ projectItemCount: 3, scope: 'all', count: 3 }), null);
}

// ───────────────────────────────────────────────────────────────────────────
head('B', 'model');
// ───────────────────────────────────────────────────────────────────────────

const M = model();
const rowOf = (m: PunchExportModel, id: string) => m.rows.find(r => r.id === id);
eq('sections: punch then crew', M.sections.map(s => [s.list, s.internal]), [['punch', false], ['crew', true]]);
eq('effective groups (typed + sheet, natural order, unplaced last)', M.sections[0].groups.map(g => g.label),
  [HOSTILE_LOC, 'A-101 · Level 1 — pinned, no room typed', 'Basement', 'Hall 2', 'Hall 10', 'Kitchen', 'No location given']);
eq('group kinds', M.sections[0].groups.map(g => g.kind), ['typed', 'sheet', 'typed', 'typed', 'typed', 'typed', 'unplaced']);
eq('sheet group holds the pinned and no-position unlocated items', M.sections[0].groups[1]?.rows.map(r => r.number), [6, 7]);
eq('unplaced group: no pin, a missing sheet, an undated item', M.sections[0].groups[6]?.rows.map(r => r.number), [5, 8, 22]);
ok('rows inside every group ascend by number', M.sections.every(s => s.groups.every(g => g.rows.every((r, i) => i === 0 || g.rows[i - 1].number < r.number))));
eq('rows are the CSV order (ascending number)', M.rows.map(r => r.number), Array.from({ length: 22 }, (_, i) => i + 1));
eq('pipeline label', statusLabel('ready_for_review'), 'Ready for Review');
eq('row status label', rowOf(M, ID.i03)?.statusLabel, 'Ready for Review');
eq('an open item with a stale closedAt has no closed day', rowOf(M, ID.i05)?.closedDay, null);
eq('a closed item has its closed day', rowOf(M, ID.f2)?.closedDay, '2026-09-06');
eq('plan refs in all four states', [ID.i06, ID.i15, ID.i16, ID.i01].map(id => rowOf(M, id)?.plan.state), ['pinned', 'no-position', 'sheet-missing', 'none']);
eq('typedLocation is raw, not the sheet group', rowOf(M, ID.i06)?.typedLocation, '');
eq('refs in the model', [rowOf(M, ID.r1)?.ref, rowOf(M, ID.i01)?.ref], ['abcdef11', 'c00000']);
eq('overdue from a bare due date', rowOf(M, ID.i01)?.daysOverdue, 3);
eq('ISO due date keeps its day', rowOf(M, ID.i02)?.dueDay, '2026-09-20');

{
  const sub = model({ scope: 'filtered', scopeInput: scopeIn({ filteredItems: [ITEMS.find(i => i.id === K_IDS[2]) as PunchItem, ITEMS[1]] }) });
  eq('a filtered model keeps full-list numbers', sub.rows.map(r => r.number), [1, 16]);
  eq('…and full-list refs', rowOf(sub, ID.i02)?.ref, 'a00000');
  const sel = model({ scope: 'selected', scopeInput: scopeIn({ selectedIds: [ID.r2] }) });
  eq('a selected model keeps full-list numbers and refs', [sel.rows[0]?.number, sel.rows[0]?.ref], [10, 'abcdef22']);
  eq('assignees hidden with fewer than 2 buckets', sel.assignees, []);
}

{
  const S2 = M.sheetPages.find(p => p.sheetId === 'S2');
  eq('a plan page per pinned sheet', M.sheetPages.map(p => p.sheetId), ['S1', 'S2']);
  eq('eight identical pins make ONE marker', S2?.markers.map(m => m.label), ['14–21']);
  eq('legend lists all eight, label on the first', S2?.legend.map(l => [l.number, l.firstOfMarker]), [14, 15, 16, 17, 18, 19, 20, 21].map((n, i) => [n, i === 0]));
  const S1 = M.sheetPages.find(p => p.sheetId === 'S1');
  eq('no-position rows follow with an em dash', S1?.legend.map(l => [l.number, l.markerLabel]), [[6, '6'], [7, '—']]);
  eq('pinnedCount', [S1?.pinnedCount, S2?.pinnedCount], [1, 8]);
  eq('clusterPins: 1% apart is one marker', clusterPins([{ itemId: 'a', number: 1, x: 0.5, y: 0.5, closed: false }, { itemId: 'b', number: 2, x: 0.51, y: 0.5, closed: true }]).length, 1);
  eq('clusterPins: 5% apart is two', clusterPins([{ itemId: 'a', number: 1, x: 0.5, y: 0.5, closed: false }, { itemId: 'b', number: 2, x: 0.55, y: 0.5, closed: false }]).length, 2);
  eq('clusterPins: allClosed', clusterPins([{ itemId: 'a', number: 3, x: 0.1, y: 0.1, closed: true }])[0].allClosed, true);
  eq('formatNumberRuns 14..21', formatNumberRuns([14, 15, 16, 17, 18, 19, 20, 21]), '14–21');
  eq('formatNumberRuns mixed', formatNumberRuns([30, 3, 9, 10, 11]), '3, 9–11, 30');
  eq('formatNumberRuns pair', formatNumberRuns([9, 10]), '9, 10');
  eq('formatNumberRuns overflow', formatNumberRuns([1, 3, 5, 7, 9]), '1, 3, 5 +2');
  eq('formatNumberRuns run + overflow', formatNumberRuns([14, 15, 16, 17, 18, 19, 20, 21, 30, 40, 50]), '14–21, 30, 40 +1');
}

{
  // 105 photo items: all closed except the LAST 10 in document order.
  const many: PunchItem[] = Array.from({ length: 105 }, (_, i) => mk(uid(`f${String(i).padStart(7, '0')}`, i), {
    createdAt: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
    status: i >= 95 ? 'open' : 'closed',
    closedAt: i >= 95 ? undefined : '2026-09-10T00:00:00Z',
    photoStoragePath: `u1/p1/punch-${i}.jpg`,
  }));
  const base = { scopeInput: scopeIn({ allItems: many, filteredItems: many }), sheets: [], markupByItemId: new Map() };
  const web = model({ ...base, target: 'web' });
  const openIds = many.slice(95).map(i => i.id);
  eq('photoCapFor', [photoCapFor('web'), photoCapFor('ios'), photoCapFor('android')], [100, 24, 12]);
  eq('web: 100 slots', web.photoSlots.length, 100);
  ok('web: every open item gets a slot', openIds.every(id => web.photoSlots.some(s => s.itemId === id)));
  eq('web: 5 closed items are over the cap', web.photoOverCapIds.length, 5);
  ok('web: the over-cap items are closed', web.photoOverCapIds.every(id => many.find(i => i.id === id)?.status === 'closed'));
  const ios = model({ ...base, target: 'ios' });
  eq('ios: 24 slots = 10 open + 14 closed', [ios.photoSlots.length, ios.photoSlots.filter(s => s.priority === 0).length], [24, 10]);
  eq('ios: open slots come first', ios.photoSlots.slice(0, 10).map(s => s.itemId), openIds);
  eq('ios: photoItemIds are document order', ios.photoItemIds.slice(0, 3), many.slice(0, 3).map(i => i.id));
  eq('android cap', model({ ...base, target: 'android' }).photoSlots.length, 12);
  ok('slots carry the storage path, not a url', ios.photoSlots.every(s => !!s.storagePath && !s.httpUri));
}

{
  eq('includeSignOff: crew present → no', M.includeSignOff, false);
  eq('includeSignOff: crew off → yes', model({ includeCrew: false }).includeSignOff, true);
  eq('includeSignOff: filtered punch-only (one floor) → yes', model({ scope: 'filtered', scopeInput: scopeIn({ filteredItems: ITEMS.slice(0, 3) }) }).includeSignOff, true);
  eq('includeSignOff: crew-only selection → no', model({ scope: 'selected', scopeInput: scopeIn({ selectedIds: [ID.i04] }) }).includeSignOff, false);
  eq('hasCrew / internal', [M.hasCrew, M.internal, model({ includeCrew: false }).internal], [true, true, false]);
  eq('file name, crew included', exportFileName({ projectName: M.projectName, scope: 'all', hasCrew: true, format: 'pdf', now: NOW }), 'punch-list-watermark-9f-internal-2026-09-17.pdf');
  eq('file name, crew-free', exportFileName({ projectName: 'Café Ünit #4', scope: 'all', hasCrew: false, format: 'csv', now: NOW }), 'punch-list-cafe-unit-4-2026-09-17.csv');
  eq('file name, filtered with crew', exportFileName({ projectName: '', scope: 'filtered', hasCrew: true, format: 'html', now: NOW }), 'punch-list-project-filtered-internal-2026-09-17.html');
  eq('areas mirror the groups', M.sections[0].areas.map(a => [a.label, a.total]).slice(2, 4), [['Basement', 2], ['Hall 2', 2]]);
  eq("'United States' is no address", model({ project: { id: 'p1', name: 'X', location: 'United States' } }).projectAddress, '');
  eq('assignees: Acme merged case-insensitively, most open first, Unassigned last', M.assignees.map(a => [a.label, a.total]), [['Acme', 2], ['=SUM(A1)', 1], ['Unassigned', 19]]);
  eq('generated label/day', [M.generatedDay, M.generatedAtLabel.startsWith('Sep 17, 2026 at 12:00 PM')], ['2026-09-17', true]);
  eq('projectItemCount / totalCount', [M.projectItemCount, M.totalCount], [22, 22]);
}

{
  eq('estimate ios 63', nativePhotoEstimate({ photoCount: 63, target: 'ios' }), { included: 24, leftOut: 39, approxBytes: 62_400_000 });
  eq('estimate web', nativePhotoEstimate({ photoCount: 63, target: 'web' }), { included: 63, leftOut: 0, approxBytes: null });
  eq('notes: ios, under the cap, big', photoNotes({ target: 'ios', format: 'pdf', includePhotos: true, photoCount: 10 }),
    ['Photos go in at full size on a phone — about 26 MB. Too big for most email; AirDrop, Messages or Mail Drop will take it.']);
  eq('notes: ios, small', photoNotes({ target: 'ios', format: 'pdf', includePhotos: true, photoCount: 5 }), ['Photos go in at full size on a phone — about 13 MB.']);
  eq('notes: ios, over the cap', photoNotes({ target: 'ios', format: 'pdf', includePhotos: true, photoCount: 63 }), [
    'A PDF made on a phone carries up to 24 photos, at full size — about 62 MB. Open items get them first; the other 39 print "Photo not included".',
    'For all 63 photos in one small file, export from app.mageid.app on a computer — or export one room or one sub at a time.',
  ]);
  eq('notes: web over 100', photoNotes({ target: 'web', format: 'pdf', includePhotos: true, photoCount: 105 }), [
    'Each photo goes in as a small copy, so the PDF stays small enough to email.',
    'One PDF holds up to 100 photos — the first 100 (open items first) go in and the other 5 print "Photo not included". Export one room or one sub at a time to get every photo.',
  ]);
  eq('notes: csv', photoNotes({ target: 'ios', format: 'csv', includePhotos: true, photoCount: 5 }), []);
  eq('notes: photos off', photoNotes({ target: 'ios', format: 'pdf', includePhotos: false, photoCount: 5 }), ['The PDF lists every item in a compact table, without photos.']);
  eq('notes: no photos', photoNotes({ target: 'web', format: 'pdf', includePhotos: true, photoCount: 0 }), ['None of these items has a photo, so the PDF will be a compact table.']);
  eq('over-cap text per target', [overCapPhotoText('web'), overCapPhotoText('ios'), overCapPhotoText('android')], [
    'Photo not included — one PDF holds up to 100 photos',
    'Photo not included — a PDF made on a phone holds up to 24 photos',
    'Photo not included — a PDF made on a phone holds up to 12 photos',
  ]);
  eq('primary labels', [
    primaryLabel({ format: 'pdf', target: 'ios', blocked: false, approxBytes: 62_400_000 }),
    primaryLabel({ format: 'pdf', target: 'web', blocked: false, approxBytes: null }),
    primaryLabel({ format: 'csv', target: 'web', blocked: false, approxBytes: null }),
    primaryLabel({ format: 'csv', target: 'android', blocked: false, approxBytes: null }),
    primaryLabel({ format: 'pdf', target: 'web', blocked: true, approxBytes: null }),
  ], ['Share PDF (about 62 MB)', 'Open PDF', 'Download spreadsheet', 'Share spreadsheet', 'Open PDF']);
  eq('webPrintWaitMs', [webPrintWaitMs(0), webPrintWaitMs(10), webPrintWaitMs(1000)], [15_000, 35_000, 90_000]);
  eq('parseExportPref', [parseExportPref('{"format":"csv","photos":false}'), parseExportPref('{"format":"x"}'), parseExportPref('nope')],
    [{ format: 'csv', photos: false }, { format: 'pdf', photos: true }, null]);
  ok('pref key is under an app storage prefix', PUNCH_EXPORT_PREF_KEY.startsWith('mageid_'));
  eq('calendarDaysBetween', [calendarDaysBetween('2026-03-07', '2026-03-09'), calendarDaysBetween('x', '2026-03-09')], [2, null]);
}

// ───────────────────────────────────────────────────────────────────────────
head('C', 'CSV');
// ───────────────────────────────────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

{
  const csv = buildPunchExportCsv(M);
  ok('starts with a BOM', csv.charCodeAt(0) === 0xfeff);
  ok('CRLF line endings only', !/[^\r]\n/.test(csv) && csv.endsWith('\r\n'));
  const rows = parseCsv(csv.slice(1));
  eq('22 columns in the fixed order', rows[0], [...PUNCH_EXPORT_CSV_COLUMNS]);
  eq('column count', PUNCH_EXPORT_CSV_COLUMNS.length, 22);
  // #57 (wave 4): the sub's note sits right after the GC's rejection note.
  eq('Sub Note follows Rejection Note', PUNCH_EXPORT_CSV_COLUMNS.indexOf('Sub Note' as (typeof PUNCH_EXPORT_CSV_COLUMNS)[number]),
    PUNCH_EXPORT_CSV_COLUMNS.indexOf('Rejection Note') + 1);
  eq('one row per item, sorted by Item #', rows.slice(1).map(r => Number(r[0])), Array.from({ length: 22 }, (_, i) => i + 1));
  ok('every row has 22 cells', rows.every(r => r.length === 22));
  const col = (name: string) => PUNCH_EXPORT_CSV_COLUMNS.indexOf(name as (typeof PUNCH_EXPORT_CSV_COLUMNS)[number]);
  const byId = (id: string): string[] => rows.find(r => r[col('Item ID')] === id) ?? [];
  eq('#57: the sub\'s note is in its CSV cell, verbatim', byId(ID.i03)[col('Sub Note')], SUB_NOTE);
  eq('#57: an item without a sub note has a blank cell', byId(ID.i01)[col('Sub Note')], '');
  eq('#57: the Rejection Note cell is unchanged beside it', byId(ID.i01)[col('Rejection Note')], '<b>no</b> & back');
  eq('hostile description round-trips (RFC 4180)', byId(ID.i01)[col('Description')], HOSTILE_DESC);
  eq('hostile location round-trips', byId(ID.f3)[col('Location')], HOSTILE_LOC);
  eq('formula guard on Assigned To', byId(ID.i01)[col('Assigned To')], "'=SUM(A1)");
  eq('formula guard on Photo GPS', byId(ID.i01)[col('Photo GPS')], "'+39.7, -104.9");
  eq('Due Date is a calendar day', [byId(ID.i01)[col('Due Date')], byId(ID.i02)[col('Due Date')]], ['2026-09-14', '2026-09-20']);
  eq('Days Overdue', [byId(ID.i01)[col('Days Overdue')], byId(ID.i02)[col('Days Overdue')]], ['3', '']);
  eq('Ref column is the PDF text "ref …"', byId(ID.r1)[col('Ref')], 'ref abcdef11');
  {
    // ~3% of 6-hex refs read as numbers in Excel/Sheets ('052331' → 52331,
    // '4e0123' → 4E+123) unless the cell carries a word.
    const numericIds = ['052331aa-0000-4000-8000-000000000001', '4e0123bb-0000-4000-8000-000000000002', '1234e5cc-0000-4000-8000-000000000003'];
    const nm = model({ scopeInput: scopeIn({ allItems: numericIds.map(id => mk(id, {})), filteredItems: [] }) });
    const nrows = parseCsv(buildPunchExportCsv(nm).slice(1));
    const refCells = nrows.slice(1).map(r => r[col('Ref')]);
    eq('numeric-looking refs are written as text', refCells, ['ref 052331', 'ref 1234e5', 'ref 4e0123']);
    ok('no Ref cell can parse as a number', refCells.every(c => !/^\s*[+-]?\d*\.?\d+(e[+-]?\d+)?\s*$/i.test(c) && Number.isNaN(Number(c))));
    eq('csvRefCell: empty stays empty', csvRefCell(''), '');
  }
  {
    // StatusPipeline closes without stamping closedAt: Days Open must be blank,
    // never a count that keeps growing to today.
    const noClose = mk('ffff0001-0000-4000-8000-000000000001', { status: 'closed', createdAt: '2026-09-01T10:00:00Z' });
    const cm = model({ scopeInput: scopeIn({ allItems: [noClose], filteredItems: [] }) });
    eq('closed without closedAt: daysOpen null', cm.rows[0]?.daysOpen, null);
    const crow = parseCsv(buildPunchExportCsv(cm).slice(1))[1] ?? [];
    eq('closed without closedAt: Closed and Days Open blank', [crow[col('Closed')], crow[col('Days Open')]], ['', '']);
    eq('closed with closedAt still counts', rowOf(M, ID.f2)?.daysOpen, 4);
  }
  eq('photoGpsText: coordinates + accuracy + street label', photoGpsText({ photoLatitude: 39.7392, photoLongitude: -104.9903, photoLocationAccuracyMeters: 8.4, photoLocationLabel: '120 Main St Denver CO' }),
    '39.73920, -104.99030 (±8 m) — 120 Main St Denver CO');
  {
    const gm = model({ scopeInput: scopeIn({ allItems: [mk('ffff0002-0000-4000-8000-000000000002', { photoLatitude: 39.7392, photoLongitude: -104.9903, photoLocationLabel: '120 Main St' })], filteredItems: [] }) });
    eq('CSV Photo GPS carries the coordinates, not just the street label', parseCsv(buildPunchExportCsv(gm).slice(1))[1]?.[col('Photo GPS')], '39.73920, -104.99030 — 120 Main St');
  }
  eq('photoGpsText: coordinates with no label', photoGpsText({ photoLatitude: 39.7392, photoLongitude: -104.9903 }), '39.73920, -104.99030');
  eq('photoGpsText: a label that is the coordinates is not repeated', photoGpsText({ photoLatitude: 39.7392, photoLongitude: -104.9903, photoLocationLabel: '39.7392, -104.9903' }), '39.73920, -104.99030');
  eq('photoGpsText: label only / nothing / junk numbers', [photoGpsText({ photoLocationLabel: ' Site gate ' }), photoGpsText({}), photoGpsText({ photoLatitude: NaN, photoLongitude: 5, photoLocationLabel: 'x' })], ['Site gate', '', 'x']);
  eq('Location is raw, Plan Sheet carries the pin', [byId(ID.i06)[col('Location')], byId(ID.i06)[col('Plan Sheet')]], ['', 'A-101 · Level 1']);
  eq('Plan Sheet for a deleted sheet', byId(ID.i16)[col('Plan Sheet')], '(sheet removed)');
  eq('Status / List / Has Photo', [byId(ID.i04)[col('Status')], byId(ID.i04)[col('List')], byId(ID.i01)[col('Has Photo')], byId(ID.i04)[col('Has Photo')]],
    ['Closed', 'Crew list (internal)', 'Yes', 'No']);
  eq('Closed only for closed items', [byId(ID.i05)[col('Closed')], byId(ID.f2)[col('Closed')]], ['', '2026-09-06']);
  for (const leak of [XRAY_TELL, SUBID, TASKID, SPATH, 'token=', 'punch-i01.jpg', 'file:///']) {
    ok(`CSV never carries ${leak}`, !csv.includes(leak));
  }
  eq('csvCell: comma', csvCell('a,b'), '"a,b"');
  eq('csvCell: quote', csvCell('say "hi"'), '"say ""hi"""');
  eq('csvCell: LF', csvCell('a\nb'), '"a\nb"');
  eq('csvCell: CR', csvCell('a\rb'), '"a\rb"');
  eq('csvCell: formula prefixes', ['=1+1', '+1', '-2 outlets', '@x', '\tx'].map(csvCell), ["'=1+1", "'+1", "'-2 outlets", "'@x", "'\tx"]);
  eq('csvCell: leading CR is guarded and quoted', csvCell('\rx'), '"\'\rx"');
  eq('csvCell: numbers are not prefixed', [csvCell(-5), csvCell(3), csvCell(NaN), csvCell(null)], ['-5', '3', '', '']);
  eq('csvCell: control characters removed', csvCell('a\u0001b'), 'ab');
}

// ───────────────────────────────────────────────────────────────────────────
head('D', 'HTML');
// ───────────────────────────────────────────────────────────────────────────

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHR8eHR0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
const ORIGINS = [STORAGE_ORIGIN];
function assetsFor(m: PunchExportModel, over: Record<string, PunchExportImageAsset> = {}, sheetOver: Record<string, PunchExportImageAsset> = {}): PunchExportAssets {
  const photos = new Map<string, PunchExportImageAsset>();
  photos.set(ID.i01, { kind: 'image', src: JPEG, mime: 'image/jpeg' });
  photos.set(ID.i02, { kind: 'unavailable', reason: 'over_size' });
  photos.set(K_IDS[0], { kind: 'image', src: 'javascript:alert(1)', mime: 'image/jpeg' });
  for (const [k, v] of Object.entries(over)) photos.set(k, v);
  const sheets = new Map<string, PunchExportImageAsset>([
    ['S1', { kind: 'image', src: JPEG, mime: 'image/jpeg', width: 3000, height: 2000 }],
    ['S2', { kind: 'image', src: `${STORAGE_ORIGIN}/storage/v1/object/sign/plan-sheets/s2.png?token=t`, mime: 'image/png', width: 2000, height: 2000, remote: true }],
  ]);
  for (const [k, v] of Object.entries(sheetOver)) sheets.set(k, v);
  let included = 0;
  for (const id of m.photoItemIds) if (photos.get(id)?.kind === 'image') included++;
  return { photos, sheets, approxBytes: null, remoteCount: 1, includedPhotoCount: included };
}
const BRANDING = { companyName: 'Majeed <Build> & Co', contactName: 'Omir', email: '', phone: '', address: '', licenseNumber: '', tagline: '' };
const html = buildPunchExportHtml(M, assetsFor(M), { includePhotos: true, branding: BRANDING, target: 'web', allowedOrigins: ORIGINS });
const decode = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

{
  ok("no '<script'", !/<script/i.test(html));
  ok("no ' on*=' attribute", !/\son[a-z]+=/i.test(html));
  ok('no background-image', !/background-image/i.test(html));
  ok('no SVG <image>', !/<image\s/i.test(html));
  ok('hostile description only escaped', !html.includes(HOSTILE_DESC) && html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;'));
  ok('hostile rejection note escaped', html.includes('&lt;b&gt;no&lt;/b&gt; &amp; back') && !html.includes('<b>no</b>'));
  ok('hostile task / sub / company escaped', html.includes('Task: @task &lt;x&gt;') && html.includes('Majeed &lt;Build&gt; &amp; Co') && !html.includes('<Build>'));
  ok('hostile typed location escaped (group header and card)', count(html, '&lt;b&gt;Hall&lt;/b&gt; &amp; &quot;2&quot;') >= 3 && !html.includes(HOSTILE_LOC));
  ok('hostile sheet label escaped', html.includes('Level 2 &lt;plan&gt;') && !html.includes('<plan>'));
  ok('markup text escaped', html.includes('&lt;i&gt;x&lt;/i&gt; &amp; &quot;y&quot;') && !html.includes('<i>x</i>'));
  eq('no logo → no <img>', count(html, /<img\b/i), 0);
  const withLogo = buildPunchExportHtml(M, assetsFor(M), { includePhotos: true, branding: { ...BRANDING, logoUri: 'https://cdn.example.com/logo.png' }, target: 'web', allowedOrigins: ORIGINS });
  eq('logo → exactly one <img>', count(withLogo, /<img\b/i), 1);
  const jsLogo = buildPunchExportHtml(M, assetsFor(M), { includePhotos: true, branding: { ...BRANDING, logoUri: 'javascript:alert(1)' }, target: 'web', allowedOrigins: ORIGINS });
  ok('a javascript: logo is dropped (monogram)', count(jsLogo, /<img\b/i) === 0 && !jsLogo.includes('javascript:'));

  const headEnd = html.indexOf('</head>');
  const cspAt = html.indexOf('http-equiv="Content-Security-Policy"');
  const fontsAt = html.indexOf('fonts.googleapis.com/css2');
  ok('CSP meta inside <head>, before the fonts link', cspAt > 0 && cspAt < headEnd && cspAt < fontsAt);
  const csp = decode(/http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? '');
  ok("CSP: script-src 'none'", csp.includes("script-src 'none'"));
  eq('CSP: object-src is exactly data: + the storage origin', /object-src ([^;]*)/.exec(csp)?.[1], `data: ${STORAGE_ORIGIN}`);
  ok('CSP: img-src allows data: and https:', csp.includes('img-src data: https:'));
  eq('buildCsp filters a bad origin', /object-src ([^;]*)/.exec(buildCsp(['https://ok.example.com', 'javascript:x', 'http://plain.example.com']))?.[1], 'data: https://ok.example.com');

  const accept = [JPEG, 'data:image/png;base64,AAAA', `${STORAGE_ORIGIN}/storage/v1/object/sign/x.jpg?token=a`];
  const reject = ['javascript:alert(1)', 'vbscript:x', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://nteoqhcswappxxjlpvap.supabase.co/x.jpg',
    'file:///x.jpg', 'blob:https://app.mageid.app/uuid', 'content://x', 'ph://x', 'https://evil.example.com/x.jpg', ''];
  ok('safeObjectSrc accepts raster data: and the storage origin', accept.every(s => safeObjectSrc(s, ORIGINS) === s));
  eq('safeObjectSrc rejects everything else', reject.map(s => safeObjectSrc(s, ORIGINS)), reject.map(() => null));
  eq('safeLogoSrc accepts svg+xml and any https', [safeLogoSrc('data:image/svg+xml;base64,PHN2Zz4='), safeLogoSrc('https://a.example.com/l.png')], ['data:image/svg+xml;base64,PHN2Zz4=', 'https://a.example.com/l.png']);
  eq('safeLogoSrc rejects script and plain http', [safeLogoSrc('javascript:x'), safeLogoSrc('http://a.example.com/l.png'), safeLogoSrc('data:text/html;base64,x')], [null, null, null]);

  eq('exactly one photo <object> (the one safe image)', count(html, '<object class="pe-obj"'), 1);
  ok('the photo <object> carries a safe data= and a type, with the unreachable fallback inside',
    html.includes(`<object class="pe-obj" data="${JPEG}" type="image/jpeg"><div class="pe-fail">${PUNCH_EXPORT_PHOTO_TEXT.unreachable}</div></object><svg class="pe-mk"`));
  ok('over_size photo prints its text, no object', html.includes(`<div class="pe-ph"><div class="pe-ph-msg">${PUNCH_EXPORT_PHOTO_TEXT.over_size}</div></div>`));
  eq('a missing or unsafe asset prints unreachable, never an object or svg', count(html, `<div class="pe-ph"><div class="pe-ph-msg">${PUNCH_EXPORT_PHOTO_TEXT.unreachable}</div></div>`), 3);
  ok('no photo → "No photo"', html.includes('<div class="pe-ph-msg">No photo</div>'));
  eq('one markup svg (only over the drawn photo)', count(html, '<svg class="pe-mk"'), 1);

  const capModel = model({ target: 'ios', scopeInput: scopeIn({ allItems: [ITEMS[0], ...Array.from({ length: 25 }, (_, i) => mk(uid(`g${String(i).padStart(7, '0')}`, i), { createdAt: `2026-09-0${(i % 9) + 1}T00:00:00Z`, photoStoragePath: `u/p/${i}.jpg` }))] }) });
  const capHtml = buildPunchExportHtml(capModel, assetsFor(capModel), { includePhotos: true, branding: BRANDING, target: 'ios', allowedOrigins: ORIGINS });
  eq('ios over-cap items print the phone cap text', count(capHtml, overCapPhotoText('ios')), 2);
  ok('ios over-cap summary line', capHtml.includes('left out (a PDF made on a phone holds up to 24)'));
  ok('ios html has no web landscape page', !capHtml.includes('@page pe-land') && !capHtml.includes('pe-plan pe-plan-land'));

  const noPhotos = buildPunchExportHtml(M, assetsFor(M), { includePhotos: false, branding: BRANDING, target: 'web', allowedOrigins: ORIGINS });
  // #57: the sub's note, labelled as his, escaped (he typed it on his portal),
  // before the GC's "Returned:" line — in BOTH layouts.
  const escNote = '&lt;i&gt;replaced&lt;/i&gt; &amp; see &quot;closet&quot; side';
  ok('#57 cards: "Sub\'s note:" printed, escaped', html.includes(`<b>Sub's note:</b> ${escNote}`) && !html.includes('<i>replaced</i>'));
  ok('#57 table: "Sub\'s note:" printed, escaped', noPhotos.includes(`Sub's note: ${escNote}`) && !noPhotos.includes('<i>replaced</i>'));
  ok('#57: one sub note in the fixture → one label per layout (no stray label on items without one)',
    (html.match(/Sub's note:/g) ?? []).length === 1 && (noPhotos.match(/Sub's note:/g) ?? []).length === 1);
  ok('photos off → compact table, no cards, no objects', noPhotos.includes('<table class="pe-tbl">') && !noPhotos.includes('<div class="pe-card') && !noPhotos.includes('<object class="pe-obj"'));
  ok('table mode escapes too', !noPhotos.includes(HOSTILE_DESC) && noPhotos.includes('&lt;script&gt;'));

  const svg = markupSvg(MARKUP);
  ok('markup svg viewBox is the 0..100 square', svg.startsWith('<svg class="pe-mk" viewBox="0 0 100 100" preserveAspectRatio="none"'));
  ok('line / polygon / circle / path / text present', ['<line ', '<polygon ', '<circle ', '<path ', '<text '].every(t => svg.includes(t)));
  ok('rectangle skipped', !svg.includes('<rect'));
  eq('the NaN arrow is skipped (one line only)', count(svg, '<line '), 1);
  ok('exact hexes', svg.includes('#E5484D') && svg.includes('#F5A623') && svg.includes('#1E8E4A'));
  eq('empty markup → no svg', markupSvg([]), '');
  eq('a prototype-key colour falls back to red, never a function string', ['__proto__', 'constructor', 'toString'].map(c =>
    /stroke="([^"]*)"/.exec(markupSvg([{ id: 'z', type: 'freehand', color: c as 'red', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]))?.[1]), ['#E5484D', '#E5484D', '#E5484D']);
  {
    const z = (sel: string) => Number(new RegExp(`\\${sel} \\{[^}]*z-index:\\s*(\\d+)`).exec(PUNCH_EXPORT_CSS)?.[1] ?? NaN);
    ok('failed-photo box sits above the markup (z .pe-fail > .pe-mk)', z('.pe-fail') > z('.pe-mk'), `${z('.pe-fail')} vs ${z('.pe-mk')}`);
    ok('failed-plan box sits above the pins (z .pe-plan-fail > .pe-pin)', z('.pe-plan-fail') > z('.pe-pin'), `${z('.pe-plan-fail')} vs ${z('.pe-pin')}`);
    for (const sel of ['.pe-desc', '.pe-returned', '.pe-tdesc']) {
      ok(`${sel} keeps line breaks (white-space: pre-wrap)`, new RegExp(`\\${sel} \\{[^}]*white-space:\\s*pre-wrap`).test(PUNCH_EXPORT_CSS));
    }
  }
  {
    const off = buildPunchExportHtml(M, assetsFor(M, { [ID.i01]: { kind: 'unavailable', reason: 'over_offline_budget' } }), { includePhotos: true, branding: BRANDING, target: 'ios', allowedOrigins: ORIGINS });
    ok('over_offline_budget prints its own text', off.includes(PUNCH_EXPORT_PHOTO_TEXT.over_offline_budget));
    // Hostile text on a PINNED item reaches the card AND the plan legend.
    const pinnedHostile = ITEMS.map(i => i.id === ID.i06 ? { ...i, description: HOSTILE_DESC } : i);
    const pm = model({ scopeInput: scopeIn({ allItems: pinnedHostile, filteredItems: pinnedHostile }) });
    const ph = buildPunchExportHtml(pm, assetsFor(pm), { includePhotos: true, branding: BRANDING, target: 'web', allowedOrigins: ORIGINS });
    const esc = '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quoted&quot;';
    const legend = ph.slice(ph.indexOf('<section class="pe-plan'));
    ok('pinned hostile description escaped in the plan legend', legend.includes(esc) && !legend.includes(HOSTILE_DESC) && !/<script/i.test(ph));
    ok('pinned hostile description escaped on card + legend (>= 3 with i01)', count(ph, esc) >= 3);
  }
  eq('an unknown colour falls back to red', /stroke="(#[0-9A-F]+)"/.exec(markupSvg([{ id: 'z', type: 'freehand', color: 'purple' as 'red', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }]))?.[1], '#E5484D');

  ok('card: number, ref and not pinned', html.includes('<span class="pe-num">#3</span><span class="pe-ref">ref c00000</span>') && html.includes('Plan: not pinned'));
  ok('card: sheet-grouped item reads No location given · Plan: sheet — pin n', html.includes('<b>No location given</b> &middot; Plan: A-101 · Level 1 — pin 6'));
  ok('card: pin position missing / deleted sheet', html.includes('A-101 · Level 1 (pin position missing)') && html.includes('pinned on a sheet that&#39;s no longer in this project'));
  eq('completion strip on every open card', count(html, '<span class="pe-box"></span>Done'), M.rows.filter(r => !r.closed).length);
  eq('CLOSED stamp on every closed card', count(html, '<span class="pe-stamp">CLOSED'), M.rows.filter(r => r.closed).length);
  ok('CLOSED stamp carries the day', html.includes('CLOSED SEP 6, 2026'));
  eq("'Internal' pill on each crew card", count(html, '>Internal</span>'), 2);
  ok('overdue flag', html.includes('Overdue 3 days'));
  ok('INTERNAL stamp + footer line present with crew', html.includes(PUNCH_EXPORT_INTERNAL_STAMP) && html.includes('INTERNAL — includes crew list · Punch list'));
  ok('no sign-off with crew', !html.includes('Sign-off'));
  const clean = buildPunchExportHtml(model({ includeCrew: false }), assetsFor(M), { includePhotos: true, branding: BRANDING, target: 'web', allowedOrigins: ORIGINS });
  ok('crew off: no INTERNAL marks, sign-off present', !clean.includes(PUNCH_EXPORT_INTERNAL_STAMP) && !clean.includes('INTERNAL — includes') && clean.includes('Sign-off') && clean.includes('Owner / owner&#39;s representative'));
  ok('sign-off makes no payment claim', !/retainage|payment/i.test(between(clean, 'Sign-off', 'Built with')));

  eq('a plan page per pinned sheet', count(html, '<section class="pe-plan'), 2);
  eq('one marker head reading 14–21', count(html, '<div class="pe-pin-head">14–21</div>'), 1);
  ok('marker style is the clamped position', html.includes('style="left:30.000%;top:40.000%"'));
  eq('pinStyle clamps and rejects NaN', [pinStyle(1.5, -0.2), pinStyle(NaN, 0.5)], ['left:100.000%;top:0.000%', null]);
  {
    const pinRule = /\.pe-pin \{([^}]*)\}/.exec(PUNCH_EXPORT_CSS)?.[1] ?? '';
    const translates = pinRule.match(/translate\([^)]*\)/g) ?? [];
    ok('pin tip on the point: every transform is translate(-50%,-100%)', translates.length > 0 && translates.every(t => t.replace(/\s/g, '') === 'translate(-50%,-100%)'), translates.join(' '));
  }
  ok('landscape sheet gets the landscape page on web only', html.includes('<section class="pe-plan pe-plan-land">') && count(html, 'pe-plan-land"') === 1);
  ok('max-height 700px and 600px', /max-height:\s*700px/.test(PUNCH_EXPORT_CSS) && /max-height:\s*600px/.test(PUNCH_EXPORT_CSS));
  ok('no heights in inches', !/height:\s*[\d.]+in\b/.test(PUNCH_EXPORT_CSS));
  ok('remote plan uses the storage origin in an <object>', html.includes(`<object class="pe-plan-obj" data="${STORAGE_ORIGIN}/storage/v1/object/sign/plan-sheets/s2.png?token=t" type="image/png">`));
  const missingPlan = buildPunchExportHtml(M, assetsFor(M, {}, { S2: { kind: 'unavailable', reason: 'unreachable' } }), { includePhotos: true, branding: BRANDING, target: 'web', allowedOrigins: ORIGINS });
  ok('a missing plan image: honest box, legend, no markers', missingPlan.includes('<div class="pe-plan-missing">') && count(missingPlan, '<div class="pe-pin-head">') === 1 && missingPlan.includes('>#21<'));

  ok('summary lead line', html.includes('<div class="pe-lead">15 still open (2 ready for inspection) · 1 overdue · 5 closed</div>'));
  ok('Open by area table', html.includes('Ready for inspection'));
  ok('generated label and scope label present', html.includes(M.generatedAtLabel) && html.includes(M.scopeLabel));
  ok('xray sentinel and ids never printed', ![XRAY_TELL, SUBID, TASKID, 'punch-i01.jpg'].some(s => html.includes(s)));
  ok('photo summary line', html.includes('Photos: 1 of 5 in this report — 3 not available (offline / not uploaded); 1 left out (size limit on a phone).'));
  eq('photoSummaryLine empty when photos are off', photoSummaryLine(M, assetsFor(M), false), '');
  ok('web hint is screen-only', html.includes('class="screen-only pe-hint" id="pe-hint"'));
}

// ───────────────────────────────────────────────────────────────────────────
head('E', 'timezones');
// ───────────────────────────────────────────────────────────────────────────

timezoneChecks('host');
for (const tz of ['America/Denver', 'UTC', 'Asia/Tokyo']) {
  const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, TZ: tz, [TZ_CHILD_FLAG]: '1' },
    encoding: 'utf8',
  });
  ok(`TZ=${tz}: every date rule holds`, res.status === 0, `${res.stdout}${res.stderr}`.trim());
}

// ───────────────────────────────────────────────────────────────────────────
head('F', 'source pins');
// ───────────────────────────────────────────────────────────────────────────

const FILES = {
  core: 'utils/punchExportCore.ts',
  html: 'utils/punchExportHtml.ts',
  delivery: 'utils/punchExportDelivery.ts',
  sheet: 'components/punch/PunchExportSheet.tsx',
};
const raw = Object.fromEntries(Object.entries(FILES).map(([k, f]) => [k, read(f)])) as Record<keyof typeof FILES, string>;
const code = Object.fromEntries(Object.entries(raw).map(([k, s]) => [k, stripTsComments(s)])) as Record<keyof typeof FILES, string>;
ok('all four source files exist', Object.values(raw).every(s => s.length > 0));

{
  const ALLOWED_RUNTIME = new Set(['@/types', '@/utils/workflowPipelines', '@/utils/calendarDate', '@/utils/punchLocations', '@/utils/punchPlanPin',
    '@/utils/planSheetImageCore', '@/utils/photoUploadCore', '@/utils/pdfDesign', '@/utils/errorCopy', '@/utils/punchExportCore',
    // punchGcCore is pure too (types + collaboratorAccess, itself type-only
    // imports): the export reads its 'Unspecified'-is-no-room rule (#56).
    '@/utils/punchGcCore']);
  for (const k of ['core', 'html'] as const) {
    const imports = [...code[k].matchAll(/^import\s+(type\s+)?[\s\S]*?from\s+'([^']+)';/gm)];
    const bad = imports.filter(m => !m[1] && !ALLOWED_RUNTIME.has(m[2])).map(m => m[2]);
    eq(`${FILES[k]}: only pure runtime imports`, bad, []);
    ok(`${FILES[k]}: no react / expo / storage / supabase import at all`,
      !/from\s+'(react|react-native|expo-[^']*|@react-native-async-storage[^']*|@\/lib\/[^']*|@\/contexts\/[^']*|@\/components\/[^']*|@\/utils\/storage|@\/utils\/planSheetUrls|@\/utils\/platformFile)'/.test(code[k]));
  }
  ok('Html imports Core only for its runtime helpers (no delivery import)', !/punchExportDelivery/.test(code.html) && !/punchExportDelivery/.test(code.core));
  for (const k of Object.keys(FILES) as (keyof typeof FILES)[]) {
    ok(`${FILES[k]}: never reads .listType raw`, !raw[k].includes('.listType'));
    ok(`${FILES[k]}: no emoji / dingbat glyphs`, !/[\u2600-\u27BF]|[\u{1F000}-\u{1FAFF}]/u.test(raw[k]));
  }
  const hexOf = (src: string, name: string) => {
    const block = between(src, name, '};');
    return ['red', 'yellow', 'green'].map(c => new RegExp(`${c}:\\s*'(#[0-9A-Fa-f]{6})'`).exec(block)?.[1]?.toUpperCase() ?? null);
  };
  const ours = hexOf(raw.html, 'const MARKUP_HEX');
  eq('markup hexes = app/photo-annotator.tsx COLOR_HEX', ours, hexOf(read('app/photo-annotator.tsx'), 'const COLOR_HEX:'));
  eq('markup hexes = PhotoMarkupOverlay COLOR_HEX_MARKUP', ours, hexOf(read('components/PhotoMarkupOverlay.tsx'), 'const COLOR_HEX_MARKUP'));
  ok('html source: no <img literal, no background-image, uses <object', !code.html.includes('<img') && !code.html.includes('background-image') && code.html.includes('<object'));
}

{
  const d = code.delivery;
  const render = between(d, 'export async function renderNativePdf', '\n}\n');
  ok('printToFileAsync with margins', /printToFileAsync\(\{[\s\S]{0,120}margins:\s*\{\s*top:\s*36/.test(render));
  ok('renderNativePdf checks nativeRenderBusy first', /if \(nativeRenderBusy\(\)\) throw new PunchExportError\('busy'\)/.test(render));
  ok('the timeout path deletes the orphaned render', /raw\.then\(r => discardFile\(r\?\.uri\)/.test(render));
  ok('file is MOVED into its run folder, never copied', d.includes('moveAsync(') && !d.includes('copyAsync(') && d.includes("punch-export/"));
  ok('share UTIs', d.includes("'com.adobe.pdf'") && d.includes("'public.comma-separated-values-text'"));
  ok("imports 'expo-file-system/legacy'", d.includes("from 'expo-file-system/legacy'"));
  ok("window.open('', '_blank') with no noopener, no innerHTML", d.includes("window.open('', '_blank')") && !/noopener/.test(d) && !/innerHTML/.test(d));
  ok('Image onload, never .decode(', !d.includes('.decode(') && d.includes('onload'));
  ok('photos signed through resolvePhotoUrls, plans through resolvePlanSheetUrls', d.includes('resolvePhotoUrls(') && d.includes('resolvePlanSheetUrls('));
  ok('no storage image transformations (free plan)', !d.includes('/render/image') && !d.includes('transform:'));
  ok("web thumbnails are JPEG", d.includes("toDataURL('image/jpeg'"));
  ok("ranged-GET fallback", d.includes("'bytes=0-0'"));
  const verify = between(d, 'export async function verifyRemote', '\n}\n');
  ok('verifyRemote accepts raster content types only (never image/svg+xml)', count(verify, 'isRasterContentType(ct)') === 2 && !/\^image\\\//.test(verify));
  ok('isRasterContentType is the MIMES list', /function isRasterContentType[\s\S]{0,200}MIMES as readonly string\[\]\)\.includes\(ct\)/.test(d));
  ok('web CORS fallback only for raster paths', /!corsFallback && [^\n]*hasRasterExt\(c\)/.test(d));
  ok('signing calls are time-bounded', /withTimeout\(\s*resolvePhotoUrls\(/.test(d) && /withTimeout\(resolvePlanSheetUrls\(/.test(d));
  ok('shareExportFile reports its outcome', /export async function shareExportFile\([^)]*\): Promise<\{ ok: boolean \}>/.test(d));
  ok('an https logo is checked on native before the header uses it', /target !== 'web' && \/\^https:\/i\.test\(logo\)[\s\S]{0,80}verifyRemote\(logo\)/.test(d));
  for (const fn of ['loadExportPref', 'saveExportPref']) {
    const body = between(d, `export async function ${fn}`, '\n}\n');
    ok(`${fn}: try/catch around ${PUNCH_EXPORT_PREF_KEY}`, /try\s*\{/.test(body) && /catch/.test(body) && body.includes('PUNCH_EXPORT_PREF_KEY'));
  }
  ok('no script written into the print tab', !/<script/i.test(d));
}

{
  const s = code.sheet;
  const press = between(s, 'const onPrimaryPress = useCallback(', 'const handleClose = useCallback(');
  ok('onPrimaryPress found', press.length > 200);
  ok('onPrimaryPress is synchronous (no async, no await)', !/\basync\b/.test(press) && !/\bawait\b/.test(press));
  ok('onPrimaryPress opens the print tab and starts the download itself', press.includes('openPrintWindow(') && press.includes('startWebDownload('));
  ok('Modal has onDismiss', /<Modal[^>]*onDismiss=\{/.test(s));
  ok("iOS parks the share for onDismiss", /Platform\.OS === 'ios'\)\s*\{[^}]*pendingShareRef\.current = share;/.test(s));
  ok('an unmount effect runs a parked share', /useEffect\(\(\) => \(\) => \{[\s\S]{0,160}pendingShareRef\.current[\s\S]{0,120}parked\(\)/.test(s));
  ok('no Alert.alert, no raw .message in UI', !s.includes('Alert.alert') && !/showAlert\([^)]*\.message/.test(s));
  ok("imports '@/components/ui'", s.includes("from '@/components/ui'"));
  ok("no fontWeight '800'", !/fontWeight:\s*'800'/.test(s));
  ok('share failure after the sheet closed is told (showAlert + shareFailureCopy)', /shareExportFile\([^)]*\)\.then\(res => \{[\s\S]{0,120}shareFailureCopy\(kind\)[\s\S]{0,60}showAlert\(/.test(s));
  ok('onPrimaryPress: a synchronous throw lands in the sheet', /\btry \{[\s\S]*\} catch \(e\) \{[\s\S]{0,200}fail\('render', e\)/.test(press) && /catch \(e\) \{[\s\S]{0,200}printHandleRef\.current\?\.close\(\)/.test(press));
  ok('scrim is the theme overlay token, not a literal', s.includes('backgroundColor: Colors.overlay') && !/rgba\(0,\s*0,\s*0/.test(s));
  ok('markup resolved through markupForSource', s.includes('markupForSource(projectPhotos, sourcePhotoIdOf(item), item.photoUri)'));
}

// ───────────────────────────────────────────────────────────────────────────
head('G', 'wiring (red until the handoff lands)');
// ───────────────────────────────────────────────────────────────────────────

function wiringProblems(punchList: string, pkgJson: string): string[] {
  const out: string[] = [];
  const src = stripTsComments(punchList);
  if (!/import\s*\{\s*PunchExportHeaderButton,\s*PunchExportSheet\s*\}\s*from\s*'@\/components\/punch\/PunchExportSheet'/.test(src)) out.push('import both exports');
  const listAt = src.indexOf('testID="punch-list"');
  const sheetAt = src.indexOf('<PunchExportSheet');
  const sheet = sheetAt >= 0 ? src.slice(sheetAt, src.indexOf('/>', sheetAt)) : '';
  if (sheetAt < 0) out.push('<PunchExportSheet is rendered');
  if (!/allItems=\{allItems\}/.test(sheet)) out.push('allItems={allItems}');
  if (!/filteredItems=\{filteredItems\}/.test(sheet)) out.push('filteredItems={filteredItems}');
  if (!/projectId=/.test(sheet)) out.push('projectId=');
  if (/\bitems=\{items\}/.test(sheet)) out.push('never items={items}');
  if (!(listAt >= 0 && sheetAt > listAt)) out.push('sheet after testID="punch-list" (screen root)');
  if (/options=\{\{[^}]*headerRight/.test(src)) out.push('no inline options={{ headerRight }}');
  const guardAt = src.indexOf('if (!project) {');
  const showAt = src.indexOf('const [showExport');
  const optsAt = src.indexOf('const stackOptions');
  if (!(showAt >= 0 && optsAt >= 0 && guardAt > showAt && guardAt > optsAt)) out.push('hooks before if (!project) {');
  try {
    const pkg = JSON.parse(pkgJson) as { scripts?: Record<string, string> };
    if (pkg.scripts?.['test:punch-export'] !== 'bun run scripts/validate-punch-export.ts') out.push('package.json test:punch-export');
    if (!String(pkg.scripts?.['ship-check'] ?? '').includes('bun run test:punch-export')) out.push('ship-check runs test:punch-export');
  } catch {
    out.push('package.json parses');
  }
  return out;
}

{
  // G0 — the checker, proven on the handoff's own snippet and on a bad one.
  const good = `import { PunchExportHeaderButton, PunchExportSheet } from '@/components/punch/PunchExportSheet';
  function X() {
    const [showExport, setShowExport] = useState(false);
    const stackOptions = useMemo(() => ({ title: 'P', headerRight: undefined }), []);
    if (!project) {
      return <Stack.Screen options={stackOptions} />;
    }
    return (<View><Stack.Screen options={stackOptions} />
      <FlatList data={x} testID="punch-list" />
      <PunchExportSheet visible={showExport} onClose={closeExport} projectId={projectId} allItems={allItems} filteredItems={filteredItems} />
    </View>);
  }`;
  const goodPkg = JSON.stringify({ scripts: { 'test:punch-export': 'bun run scripts/validate-punch-export.ts', 'ship-check': 'a && bun run test:punch-export' } });
  eq('G0: the handoff wiring passes the checker', wiringProblems(good, goodPkg), []);
  const bad = good.replace('allItems={allItems}', 'items={items}');
  ok('G0: items={items} is rejected (mutation 36)', wiringProblems(bad, goodPkg).includes('allItems={allItems}') && wiringProblems(bad, goodPkg).includes('never items={items}'));
  ok('G0: an inline headerRight is rejected', wiringProblems(good.replace('options={stackOptions}', "options={{ title: 'x', headerRight: () => null }}"), goodPkg).includes('no inline options={{ headerRight }}'));
  ok('G0: a sheet inside the list header is rejected', wiringProblems(good.replace('<FlatList data={x} testID="punch-list" />', '').replace('</View>);', '<FlatList data={x} testID="punch-list" /></View>);'), goodPkg).length > 0);
  ok('G0: a missing ship-check entry is rejected', wiringProblems(good, JSON.stringify({ scripts: { 'test:punch-export': 'bun run scripts/validate-punch-export.ts', 'ship-check': 'a' } })).includes('ship-check runs test:punch-export'));
}
{
  section = 'G1';
  const problems = wiringProblems(read('app/punch-list.tsx'), read('package.json'));
  eq('G1: app/punch-list.tsx + package.json are wired', problems, []);
}
{
  // G2 — every path in app/punch-list.tsx that closes an item stamps closedAt.
  // The edit sheet's StatusPipeline used to set status 'closed' with no close
  // date, so the export printed Closed / Days Open blank for exactly the items
  // a GC closes while looking at them. Each close site is found by its status
  // write and must carry closedAt within the same statement block.
  section = 'G2';
  const src = read('app/punch-list.tsx');
  const pipe = src.indexOf('onAdvance={(next) => {');
  const pipeBody = pipe >= 0 ? src.slice(pipe, src.indexOf('}}', pipe)) : '';
  ok('G2: the edit sheet\'s StatusPipeline is found', pipeBody.length > 0);
  // Wave 4 (punch-gc): every status write goes through punchStatusPatch
  // (utils/punchGcCore), which stamps closedAt on a close — proven by running
  // it below, and pinned here at each call site.
  ok('G2: ...and closing from it stamps closedAt', /punchStatusPatch\(editingItem, next as PunchItem\['status'\], nowIso\)/.test(pipeBody) && /updatePunchItem\(editingItem\.id, patch\)/.test(pipeBody));
  {
    const closedPatch = punchStatusPatch({ status: 'ready_for_review' }, 'closed', '2026-09-19T12:00:00.000Z');
    eq('G2: punchStatusPatch stamps closedAt on close', closedPatch.closedAt, '2026-09-19T12:00:00.000Z');
    eq('G2: ...and names the status explicitly', closedPatch.status, 'closed');
  }
  const hsc = src.indexOf('const handleStatusChange = useCallback(');
  // A photo walk files N items in one press. Their createdAt must follow
  // capture order, because the export numbers by createdAt — one shared stamp
  // numbered a walk by random UUID instead of by the route walked.
  const fws = src.indexOf('const fileWalkShots = useCallback(');
  const fwsBody = fws >= 0 ? src.slice(fws, src.indexOf('}, [describedWalkShots', fws)) : '';
  ok('G2: a photo walk staggers createdAt in capture order',
    /describedWalkShots\.map\(\(shot, i\) =>/.test(fwsBody) && /createdAt: new Date\(nowMs \+ i\)\.toISOString\(\)/.test(fwsBody));
  ok('G2: handleStatusChange still stamps closedAt on close (through punchStatusPatch)',
    hsc >= 0 && /updatePunchItem\(item\.id, punchStatusPatch\(item, newStatus, new Date\(\)\.toISOString\(\)\)\)/.test(src.slice(hsc, hsc + 600)));
}

// #56 (wave 4 punch-gc): the legacy 'Unspecified' placeholder punch-walk used
// to save is no room — grouped with the unplaced items, never a room on the
// GC's walk sheet — and the filter line names the unplaced group the way the
// document's own group header does, whatever label the screen passed.
{
  const legacy = mk('legacy-unspec', { location: 'Unspecified' });
  const blank = mk('legacy-blank', { location: '' });
  const m = buildPunchExportModel({
    scopeInput: { ...scopeIn(), allItems: [legacy, blank], filteredItems: [] },
    scope: 'all', includeCrew: true, target: 'web', project: PROJECT, sheets: [], markupByItemId: new Map(), now: NOW,
  });
  const row = m.rows.find(r => r.id === 'legacy-unspec');
  eq("#56: an 'Unspecified' item prints no typed room", row?.typedLocation, '');
  const groups = m.sections.flatMap(sec => sec.groups);
  ok("#56: ...and shares the one unplaced group (no 'Unspecified' group)",
    groups.length === 1 && groups[0].key === UNPLACED_LOCATION_GROUP && groups[0].rows.length === 2
    && !groups.some(g => /unspecified/i.test(g.label)), JSON.stringify(groups.map(g => [g.key, g.label, g.rows.length])));
  eq('#56: the filter line words the unplaced group as the document does, whatever the screen called it',
    describeFilters({ status: 'all', sub: '', priority: 'all', locationKey: UNPLACED_LOCATION_GROUP, locationLabel: 'No room given' }, 'punch'),
    'Punch list · Location: No location given');
  eq('#56: a typed room still uses the screen\'s label', describeFilters({ status: 'all', sub: '', priority: 'all', locationKey: 'hall 2', locationLabel: 'Hall 2' }, 'punch'), 'Punch list · Location: Hall 2');
}

// ───────────────────────────────────────────────────────────────────────────
console.log(`\n${pass} passed, ${fail} failed`);
console.log(`FAILED-SECTIONS: ${[...failedSections].sort().join(',') || 'none'}`);
if (fail > 0) process.exit(1);
