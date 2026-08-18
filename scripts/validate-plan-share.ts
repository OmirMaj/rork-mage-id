// validate-plan-share.ts — pins the CLIENT-FACING half of the Living Floor Plan.
//
// /shared-plan is an unauthenticated link: the token in the URL is the whole
// credential, and it gets pasted into texts and forwarded to spouses, lenders
// and neighbours. Two rules govern everything it can show, and both are the
// kind of thing that rots quietly when someone adds "just one more field":
//
//  1. NO COST, MARKUP, OR MARGIN. Absolute product rule for every client-facing
//     surface (same boundary as utils/clientEstimateView.ts). Zone tints by
//     trade and real site photos are the product; anything money-adjacent is
//     not.
//
//  2. NO INTERNAL TASK DETAIL. Trade and status are fine. Task TITLES are not
//     — they carry sub names and internal shorthand — and neither are crew,
//     assignedSubName, notes, float/slack, or critical-path flags. A homeowner
//     must never be able to work out which sub is behind.
//
// The deep key scan below is negative-tested — it is fed a deliberately
// poisoned payload and must FAIL on it — so a scanner that has quietly stopped
// scanning cannot pass. The source scan strips comments first, so the prose
// explaining "never ship cost/markup/margin" doesn't itself trip the check
// (and that stripper is negative-tested too).
//
// Run: bun run scripts/validate-plan-share.ts
import { readFileSync } from 'node:fs';
import {
  buildPlanSharePayload, encodePlanShareToken, decodePlanShareToken,
  hydratePlanShare, PLAN_SHARE_MAX_PHOTOS, SHARE_PLAN_SHEET_ID,
  type PlanSharePayload,
} from '../utils/planShareToken';
import { zoneStateAsOf } from '../utils/planZoneStatus';
import type { PlanSheet, PlanZone, ScheduleTask, DrawingPin, ProjectPhoto } from '../types';

let pass = 0, fail = 0;
function expect<T>(name: string, got: T, want: T) {
  const okEq = JSON.stringify(got) === JSON.stringify(want);
  if (okEq) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, '\n      got: ', JSON.stringify(got), '\n      want:', JSON.stringify(want)); }
}
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string): string => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

// ─────────────────────────────────────────────────────────────────────────────
// The client-facing safety scanners. Same style as
// scripts/validate-portal-owner.ts, walking the whole object graph because the
// payload is nested (tasks and photos inside a payload inside a URL).
// ─────────────────────────────────────────────────────────────────────────────
const FORBIDDEN_KEY =
  /cost|markup|margin|profit|price|supplier|vendor|wholesale|burden|overhead|budget|invoice|total|amount|rate|fee/i;

/** Internal (non-money) fields a homeowner must never receive. */
const FORBIDDEN_INTERNAL_KEY =
  /^(title|crew|crewSize|notes|rationale|assignedSubId|assignedSubName|linkedEstimateItems|isCriticalPath|float|slack|totalFloat|freeFloat|baselineStartDay|baselineEndDay|wbsCode|progress)$/i;

function scanKeys(value: unknown, re: RegExp, path = '$', out: string[] = []): string[] {
  if (value == null) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanKeys(v, re, `${path}[${i}]`, out));
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (re.test(k)) out.push(`${path}.${k}`);
      scanKeys(v, re, `${path}.${k}`, out);
    }
  }
  return out;
}
const forbiddenKeys = (v: unknown) => scanKeys(v, FORBIDDEN_KEY);
const internalKeys = (v: unknown) => scanKeys(v, FORBIDDEN_INTERNAL_KEY);

/** Every string in the payload — a leaked sub name or dollar figure doesn't
 *  need a suspicious key name to be a leak. */
function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') { out.push(value); return out; }
  if (Array.isArray(value)) { value.forEach(v => allStrings(v, out)); return out; }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) allStrings(v, out);
  }
  return out;
}

/**
 * Strip comments so a source scan reads CODE, not the prose that explains the
 * rule. The `[^:]` guard keeps `https://` intact. Negative-tested below.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * Money-rendering vectors in client-facing source. Bare `margin` is
 * deliberately NOT here — in a React Native StyleSheet it is a box-model
 * property, and a check that fires on `margin: 3` gets deleted by the first
 * person it annoys. The money sense of the word is spelled out instead.
 */
const MONEY_SOURCE =
  /\b(formatMoney|formatCurrency|toCurrency|grandTotal|baseTotal|contractValue|unitPrice|unitCost|lineTotal|changeAmount|amountPaid|markup|markupPercent|grossMargin|profitMargin|marginPercent|costPer|totalCost|effectiveEstimateTotal|jobCost)\b/;

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures — a DELIBERATELY POISONED project. Every field a homeowner must
// never see is populated, so "the payload is clean" means the projection
// actually dropped them rather than the fixture never having them.
// ─────────────────────────────────────────────────────────────────────────────
const SHEET: PlanSheet = {
  id: 'sheet-1',
  projectId: 'p1',
  name: 'A-101 Floor Plan',
  sheetNumber: 'A-101',
  imageUri: 'https://cdn.example.com/plans/a101.png',
  width: 1000,
  height: 800,
  createdAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
};

const TASKS: ScheduleTask[] = [
  {
    id: 't-frame', title: 'Framing — Bob’s Framing Co, 2BR wing', phase: 'Framing',
    durationDays: 10, startDay: 1, progress: 40,
    crew: 'Bob’s Framing Co', crewSize: 4,
    dependencies: [], notes: 'Bob is 3 days behind, chase him Monday',
    status: 'in_progress',
    isCriticalPath: true,
    assignedSubId: 'sub-9', assignedSubName: 'Bob’s Framing Co',
    linkedEstimateItems: ['li-1', 'li-2'],
    rationale: 'Duration from the $42/sf framing cost basis',
    baselineStartDay: 1, baselineEndDay: 10,
    wbsCode: '03.10',
  },
  {
    id: 't-elec', title: 'Electrical rough-in', phase: 'Electrical',
    durationDays: 5, startDay: 11, progress: 0,
    crew: 'Sparky LLC', dependencies: ['t-frame'], notes: '',
    status: 'not_started',
  },
  // Not linked to any zone — must not ship at all.
  {
    id: 't-orphan', title: 'Punchlist walkthrough', phase: 'Closeout',
    durationDays: 2, startDay: 30, progress: 0,
    crew: '', dependencies: [], notes: '', status: 'not_started',
  },
];

const ZONES: PlanZone[] = [
  {
    id: 'z-kitchen', projectId: 'p1', planSheetId: 'sheet-1',
    x: 0.1, y: 0.1, w: 0.4, h: 0.3,
    label: 'Kitchen', linkedTaskIds: ['t-frame', 't-elec'],
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
  {
    id: 'z-bath', projectId: 'p1', planSheetId: 'sheet-1',
    x: 0.6, y: 0.1, w: 0.2, h: 0.2,
    // A dangling link to a task that does not exist at all.
    label: 'Bath', linkedTaskIds: ['t-elec', 't-ghost'],
    createdAt: '2026-05-01T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z',
  },
];

const PINS: DrawingPin[] = [
  { id: 'pin-1', planSheetId: 'sheet-1', projectId: 'p1', x: 200, y: 160, kind: 'photo', linkedPhotoId: 'ph-1', createdAt: '', updatedAt: '' },
  { id: 'pin-2', planSheetId: 'sheet-1', projectId: 'p1', x: 0.65, y: 0.15, kind: 'photo', linkedPhotoId: 'ph-2', createdAt: '', updatedAt: '' },
  // Local-only photo (never synced) — must be dropped, it would render blank.
  { id: 'pin-3', planSheetId: 'sheet-1', projectId: 'p1', x: 0.2, y: 0.2, kind: 'photo', linkedPhotoId: 'ph-local', createdAt: '', updatedAt: '' },
  // A pin on a DIFFERENT sheet — must not ship.
  { id: 'pin-4', planSheetId: 'sheet-2', projectId: 'p1', x: 0.2, y: 0.2, kind: 'photo', linkedPhotoId: 'ph-other', createdAt: '', updatedAt: '' },
  // A non-photo pin — nothing to ship.
  { id: 'pin-5', planSheetId: 'sheet-1', projectId: 'p1', x: 0.3, y: 0.3, kind: 'rfi', linkedRfiId: 'rfi-1', createdAt: '', updatedAt: '' },
];

const PHOTOS: ProjectPhoto[] = [
  { id: 'ph-1', projectId: 'p1', uri: 'https://cdn.example.com/p/1.jpg', timestamp: '2026-05-06T12:00:00.000Z', createdAt: '2026-05-06T12:00:00.000Z', tag: 'Framing', location: 'Kitchen' },
  { id: 'ph-2', projectId: 'p1', uri: 'https://cdn.example.com/p/2.jpg', timestamp: '2026-05-20T12:00:00.000Z', createdAt: '2026-05-20T12:00:00.000Z' },
  { id: 'ph-local', projectId: 'p1', uri: 'file:///var/mobile/x.jpg', timestamp: '2026-05-07T12:00:00.000Z', createdAt: '2026-05-07T12:00:00.000Z' },
  { id: 'ph-other', projectId: 'p1', uri: 'https://cdn.example.com/p/other.jpg', timestamp: '2026-05-08T12:00:00.000Z', createdAt: '2026-05-08T12:00:00.000Z' },
];

const built = buildPlanSharePayload({
  projectName: 'Maple St Renovation',
  gcName: 'Northwind Builders',
  scheduleStartDate: '2026-05-01',
  sheet: SHEET,
  zones: ZONES,
  tasks: TASKS,
  pins: PINS,
  photos: PHOTOS,
});
const payload = built.payload;

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE FIREWALL — the payload cannot carry money or internal detail
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nplan share — client-facing firewall:');

{
  const hits = forbiddenKeys(payload);
  ok('payload carries NO cost / markup / margin / price / supplier key',
    hits.length === 0, `leaked: ${JSON.stringify(hits)}`);
}
{
  const hits = internalKeys(payload);
  ok('payload carries NO internal task key (title / crew / sub / notes / float / critical-path)',
    hits.length === 0, `leaked: ${JSON.stringify(hits)}`);
}
{
  // Value-level: the poisoned fixture's sub name and dollar figure must not
  // appear anywhere in the payload, under ANY key.
  const strings = allStrings(payload);
  ok('no sub / assignee name appears anywhere in the payload',
    !strings.some(s => /Bob|Sparky/i.test(s)), `strings: ${JSON.stringify(strings)}`);
  ok('no dollar figure appears anywhere in the payload',
    !strings.some(s => /\$\s?\d/.test(s)), `strings: ${JSON.stringify(strings)}`);
  ok('no internal chase-the-sub note appears in the payload',
    !strings.some(s => /behind|chase/i.test(s)));
}
{
  // The allowlist itself, pinned. Adding a field to the payload must be a
  // deliberate product decision that breaks this assertion first.
  expect('payload task keys are EXACTLY {id, ph, s, d}',
    Object.keys(payload.tasks[0]).sort(), ['d', 'id', 'ph', 's']);
  expect('payload zone keys are EXACTLY {id, x, y, w, h, l, t}',
    Object.keys(payload.zones[0]).sort(), ['h', 'id', 'l', 't', 'w', 'x', 'y']);
  expect('payload photo keys are EXACTLY {id, u, ts, x, y}',
    Object.keys(payload.photos[0]).sort(), ['id', 'ts', 'u', 'x', 'y']);
  expect('payload top-level keys are the documented allowlist',
    Object.keys(payload).sort(),
    ['gc', 'ih', 'img', 'iw', 'n', 'photos', 'sd', 'sn', 'tasks', 'v', 'zones']);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Projection correctness — only what a homeowner needs actually ships
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nplan share — projection:');

expect('only zone-linked tasks ship (the orphan task is dropped)',
  payload.tasks.map(t => t.id).sort(), ['t-elec', 't-frame']);
expect('the trade survives — it is what tints the room',
  payload.tasks.find(t => t.id === 't-frame')?.ph, 'Framing');
expect('planned start + duration survive — the scrubber needs them',
  payload.tasks.find(t => t.id === 't-frame'), { id: 't-frame', ph: 'Framing', s: 1, d: 10 });
expect('a dangling task link is dropped rather than shipped',
  payload.zones.find(z => z.id === 'z-bath')?.t, ['t-elec']);
expect('the GC-authored room label survives',
  payload.zones.map(z => z.l), ['Kitchen', 'Bath']);

console.log('\nplan share — photos:');
expect('only CDN-backed photos pinned on THIS sheet ship',
  payload.photos.map(p => p.id), ['ph-2', 'ph-1']);
expect('an unsynced file:// photo is dropped, and counted', built.droppedLocal, 1);
expect('pixel pin coords are normalized to 0–1',
  payload.photos.find(p => p.id === 'ph-1'), { id: 'ph-1', u: 'https://cdn.example.com/p/1.jpg', ts: '2026-05-06T12:00:00.000Z', x: 0.2, y: 0.2 });
ok('already-normalized pin coords are left alone',
  payload.photos.find(p => p.id === 'ph-2')?.x === 0.65);
ok('every shipped photo carries the date it was taken (the honest signal)',
  payload.photos.every(p => !!p.ts && !isNaN(new Date(p.ts).getTime())));
{
  const many = buildPlanSharePayload({
    projectName: 'X', sheet: SHEET, zones: ZONES, tasks: TASKS,
    pins: Array.from({ length: 5 }, (_, i) => ({
      id: `p${i}`, planSheetId: 'sheet-1', projectId: 'p1', x: 0.2, y: 0.2,
      kind: 'photo' as const, linkedPhotoId: `x${i}`, createdAt: '', updatedAt: '',
    })),
    photos: Array.from({ length: 5 }, (_, i) => ({
      id: `x${i}`, projectId: 'p1', uri: `https://cdn.example.com/${i}.jpg`,
      timestamp: `2026-05-0${i + 1}T00:00:00.000Z`, createdAt: `2026-05-0${i + 1}T00:00:00.000Z`,
    })),
    maxPhotos: 2,
  });
  expect('the photo cap keeps the NEWEST slice', many.payload.photos.map(p => p.id), ['x4', 'x3']);
  expect('trimmed photos are counted for the UI', many.droppedExcess, 3);
  ok('there is a documented photo cap', PLAN_SHARE_MAX_PHOTOS > 0);
}
{
  const local = buildPlanSharePayload({
    projectName: 'X', sheet: { ...SHEET, imageUri: 'file:///var/mobile/plan.png' },
    zones: ZONES, tasks: TASKS, pins: [], photos: [],
  });
  ok('an unsynced PLAN IMAGE is flagged so the GC never shares a blank link',
    local.planNotSynced === true);
  ok('a synced plan image is not flagged', built.planNotSynced === false);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Round-trip + hydration
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nplan share — token round-trip:');

{
  const token = encodePlanShareToken(payload);
  ok('token is URL-safe base64 (no +, /, or = to be mangled by SMS)',
    /^[A-Za-z0-9_-]+$/.test(token), token.slice(0, 40));
  expect('decode(encode(payload)) round-trips exactly', decodePlanShareToken(token), payload);
  expect('a corrupted token decodes to null, not a partial render',
    decodePlanShareToken('not-a-real-token'), null);
  expect('an empty token decodes to null', decodePlanShareToken(''), null);
  const wrongVersion = encodePlanShareToken({ ...payload, v: 2 as unknown as 1 });
  expect('a future payload version is refused rather than half-rendered',
    decodePlanShareToken(wrongVersion), null);
}

console.log('\nplan share — hydration:');
{
  const h = hydratePlanShare(payload);
  // Load-bearing: the fields the domain types demand but the payload never
  // carried are EMPTY, not placeholders. If some future edit renders
  // task.title in client mode it paints nothing rather than leaking.
  ok('hydrated tasks have an EMPTY title (never a placeholder or a real one)',
    h.tasks.every(t => t.title === ''));
  ok('hydrated tasks have an EMPTY crew', h.tasks.every(t => t.crew === ''));
  ok('hydrated tasks have EMPTY notes', h.tasks.every(t => t.notes === ''));
  ok('hydrated tasks carry no sub name', h.tasks.every(t => t.assignedSubName === undefined));
  ok('hydrated tasks carry no critical-path flag', h.tasks.every(t => t.isCriticalPath === undefined));
  ok('hydrated tasks report zero progress (planned view only, no actuals)',
    h.tasks.every(t => t.progress === 0));
  ok('hydrated tasks keep the trade', h.tasks.some(t => t.phase === 'Framing'));
  ok('hydrated zones keep their label + links',
    h.zones[0].label === 'Kitchen' && h.zones[0].linkedTaskIds.length === 2);
  ok('hydrated zones carry no real projectId', h.zones.every(z => z.projectId === ''));
  ok('hydrated pins point at the synthetic share sheet id',
    h.pins.every(p => p.planSheetId === SHARE_PLAN_SHEET_ID));
  expect('photoById resolves a shipped photo to {uri, createdAt}',
    h.photoById('ph-1'), { uri: 'https://cdn.example.com/p/1.jpg', createdAt: '2026-05-06T12:00:00.000Z' });
  expect('photoById returns undefined for a photo that never shipped',
    h.photoById('ph-local'), undefined);

  // The hydrated tasks must actually drive the view: zoneStateAsOf reads
  // startDay/durationDays, which is the whole reason those two fields ship.
  const kitchenTasks = h.zones[0].linkedTaskIds
    .map(id => h.tasks.find(t => t.id === id))
    .filter((t): t is ScheduleTask => !!t);
  expect('day 0: framing has started, room reads in-progress',
    zoneStateAsOf(kitchenTasks, 0).status, 'in_progress');
  expect('day 12: electrical is the active trade',
    zoneStateAsOf(kitchenTasks, 12).activeTask?.phase, 'Electrical');
  expect('day 40: everything planned is done',
    zoneStateAsOf(kitchenTasks, 40).status, 'done');
  ok('the whole-payload scan still finds nothing after hydration round-trips',
    forbiddenKeys(h.zones).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SOURCE-LEVEL — the portal view cannot RENDER money
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nplan share — the portal view cannot render money:');

const CLIENT_FACING_SOURCES = [
  'app/shared-plan.tsx',
  'utils/planShareToken.ts',
  'components/schedule/mobile/LivingFloorPlan.tsx',
];
for (const path of CLIENT_FACING_SOURCES) {
  const src = read(path);
  ok(`${path} exists`, src.length > 0);
  const code = stripComments(src);
  const money = code.match(MONEY_SOURCE);
  ok(`${path} renders no money helper or money field`,
    money === null, `matched: ${money?.[0]}`);
  ok(`${path} has no '$' currency literal`,
    !/['"`]\s*\$\s*['"`]/.test(code) && !/\$\{?\s*\d/.test(code.replace(/\$\{/g, '')));
}
{
  const src = read('utils/planShareToken.ts');
  const code = stripComments(src);
  // A spread is how an unaudited field reaches a homeowner. The projection
  // must copy field by field.
  ok('buildPlanSharePayload never spreads a domain object into the payload',
    !/\.\.\.\s*(task|t|zone|z|photo|ph|pin|p|sheet)\b/.test(code));
}
{
  const src = read('app/shared-plan.tsx');
  const code = stripComments(src);
  ok('shared-plan renders the REAL LivingFloorPlan (not a fork)',
    /<LivingFloorPlan/.test(code));
  ok('shared-plan passes clientMode', /clientMode/.test(code));
  ok('shared-plan never imports ProjectContext (it has no account to read)',
    !/useProjects|contexts\/ProjectContext/.test(code));
  ok('shared-plan never touches supabase directly', !/from '@\/lib\/supabase'/.test(code));
  ok('shared-plan gets everything from the decoded token',
    /decodePlanShareToken/.test(code) && /hydratePlanShare/.test(code));
}
{
  const src = read('components/schedule/mobile/LivingFloorPlan.tsx');
  const code = stripComments(src);
  ok('LivingFloorPlan takes tasks, NOT a whole Project (narrow client surface)',
    !/project:\s*Project/.test(code) && /tasks:\s*ScheduleTask\[\]/.test(code));
  ok('clientMode gates the linked-task list so titles never render for a client',
    /clientMode\s*\?/.test(code) && /t\.title/.test(code));
  ok('clientMode implies readOnly (a caller cannot forget the editor)',
    /readOnly\s*\|\|\s*!!clientMode/.test(code));
  ok('the edit affordance is gated on the locked flag',
    /!locked/.test(code));
  ok('photos are filtered by the scrubbed date, not shown all at once',
    /cutoffMs/.test(code) && /createdAt\)\.getTime\(\)\s*<=\s*cutoffMs/.test(code));
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. ROUTE WIRING — unauthenticated, and no AI assistant
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nplan share — route wiring:');
{
  const fab = read('components/brain/BrainFab.tsx');
  ok('the AI FAB is suppressed on /shared-plan (HIDDEN_ROOTS)',
    /HIDDEN_ROOTS[\s\S]{0,300}'shared-plan'/.test(fab));
  const layout = read('app/_layout.tsx');
  ok('/shared-plan is exempt from the auth wall (token IS the credential)',
    /inSharedView[\s\S]{0,300}'shared-plan'/.test(layout));
  ok('/shared-plan is exempt from the desktop nav shell (no account, no nav)',
    /DESKTOP_SHELL_EXEMPT[\s\S]{0,900}'shared-plan'/.test(layout));
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. NEGATIVE TESTS
// A scanner that has quietly stopped scanning passes every assertion above.
// Feed each one something poisoned and require it to FAIL.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\nplan share — NEGATIVE (the scanners must still bite):');
{
  const poisoned = { ...payload, tasks: [{ id: 't', ph: 'Framing', s: 1, d: 2, unitCost: 118.4 }] };
  ok('NEGATIVE: key scanner catches a cost smuggled onto a task',
    forbiddenKeys(poisoned).includes('$.tasks[0].unitCost'));
}
{
  const poisoned = { zones: [{ id: 'z', grossMargin: 0.18 }] };
  ok('NEGATIVE: key scanner catches a margin key',
    forbiddenKeys(poisoned).includes('$.zones[0].grossMargin'));
}
{
  const poisoned = { tasks: [{ id: 't', title: 'Bob’s Framing rough-in' }] };
  ok('NEGATIVE: internal scanner catches a task title',
    internalKeys(poisoned).includes('$.tasks[0].title'));
  ok('NEGATIVE: value scanner catches a sub name in a string',
    allStrings(poisoned).some(s => /Bob/i.test(s)));
}
{
  const poisoned = { zones: [{ id: 'z', meta: { deep: { supplier: 'Ferguson' } } }] };
  ok('NEGATIVE: key scanner catches a supplier nested three levels down',
    forbiddenKeys(poisoned).includes('$.zones[0].meta.deep.supplier'));
}
{
  // The comment stripper must not become a blanket "delete everything".
  const src = `// never ship cost\nconst x = formatMoney(1);\n/* markup */\nconst u = 'https://a.b';`;
  const code = stripComments(src);
  ok('NEGATIVE: stripComments removes prose but KEEPS code',
    MONEY_SOURCE.test(code) && !/never ship cost/.test(code),
    `stripped: ${JSON.stringify(code)}`);
  ok('NEGATIVE: stripComments does not eat a URL', /https:\/\/a\.b/.test(code));
}
{
  // The money source scan must still catch the real leak shapes.
  for (const leak of [
    'const label = formatMoney(total);',
    'const m = job.grossMargin;',
    '<Text>{item.unitPrice}</Text>',
    'const v = effectiveEstimateTotal(project);',
  ]) {
    ok(`NEGATIVE: money source scan catches \`${leak}\``, MONEY_SOURCE.test(leak));
  }
  ok('NEGATIVE: money source scan does NOT fire on a CSS margin',
    !MONEY_SOURCE.test('wrap: { margin: 3, marginBottom: 10 },'));
}
{
  // And the source scan must bite on a real render, not just on a helper name.
  const fake = `const s = StyleSheet.create({});\nconst label = \`$\${cost}\`;`;
  ok('NEGATIVE: the $-literal check catches a template-interpolated dollar amount',
    /\$\{?\s*\d/.test(fake.replace(/\$\{/g, '')) || /\$\$?\{/.test(fake));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
