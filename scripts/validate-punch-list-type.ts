// scripts/validate-punch-list-type.ts — the crew list must never reach the
// client, and nothing already on the client's punch list may fall off it.
//
// WHY THIS EXISTS. A punch item belongs to one of two lists (types/index.ts
// PunchListType):
//
//   • 'punch' — the formal punch list the owner / client / architect walks and
//     holds the builder to. The client portal renders it.
//   • 'crew'  — touch-ups and cleanup for the builder's own crew and subs.
//     INTERNAL. "Sweep the corridor" on a client's project page is exactly the
//     leak this feature exists to prevent.
//
// Both failure modes are silent:
//
//   1. The portal filter goes missing → crew items publish to the client and
//      the app looks completely normal to the builder.
//   2. One of the three ProjectContext mapping sites drops list_type → the
//      field survives creation and vanishes on the first edit or refetch. The
//      update path is the classic one: moving an item to the crew list works on
//      screen, the next refetch reads the server's untouched 'punch' back, and
//      the item is on the client's portal again.
//
// And the backfill direction matters: an absent value MUST read as 'punch', or
// every item created before the split disappears from portals clients are
// already looking at.
//
// HOW IT CHECKS. The default and the portal snapshot are EXECUTED. The mapping
// sites live inside React hooks that cannot run under bun, so those are a
// source scan on comment-stripped text, each site named in its own message.
// The migration file is scanned the same way.
//
// Run via: bun run test:punch-list-type

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { punchListTypeOf } from '../types';
import type { PunchItem, Project, ClientPortalSettings, Subcontractor, SubPortalLink, PunchListType } from '../types';
import { buildPortalSnapshot } from '../utils/portalSnapshot';
import { buildSubPortalSnapshot } from '../utils/subPortalSnapshot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(label: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', label); }
  else { fail++; console.log('  ✗', label, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(label: string, got: T, want: T, why?: string) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(label, g === w, g === w ? undefined : `got  ${g}\n      want ${w}${why ? `\n      ${why}` : ''}`);
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };

/** Strip // and /* *\/ comments. `(^|[^:])` keeps `https://` inside strings
 *  intact; a mis-strip can only REMOVE text, so it errs red, never green. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
function stripSqlComments(src: string): string {
  return src.replace(/--.*$/gm, '');
}
/** The text between the first `start` and the next `end` after it ('' if absent). */
function between(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) return '';
  const j = src.indexOf(end, i + start.length);
  return j < 0 ? '' : src.slice(i, j);
}

// ───────────────────────────────────────────────────────────────────────────
console.log('\npunchListTypeOf — absent means a formal punch item');
// ───────────────────────────────────────────────────────────────────────────
eq('no listType resolves to punch', punchListTypeOf({}), 'punch',
  'every item that predates the split is a formal punch item');
eq('undefined listType resolves to punch', punchListTypeOf({ listType: undefined }), 'punch');
eq('null (a pre-migration row) resolves to punch', punchListTypeOf({ listType: null }), 'punch');
eq('a missing item resolves to punch', punchListTypeOf(undefined), 'punch');
eq('explicit punch stays punch', punchListTypeOf({ listType: 'punch' }), 'punch');
eq('explicit crew stays crew', punchListTypeOf({ listType: 'crew' }), 'crew');
eq('an unrecognised value resolves to punch (visible, never hidden)',
  punchListTypeOf({ listType: 'CREW ' as unknown as PunchListType }), 'punch',
  'the safe mis-read keeps an item on the client portal rather than silently dropping it');

// ───────────────────────────────────────────────────────────────────────────
console.log('\nclient portal snapshot — punch in, crew out');
// ───────────────────────────────────────────────────────────────────────────
const project = {
  id: 'p1', name: 'Maple St Reno', type: 'renovation', status: 'in_progress', location: '12 Maple St',
} as unknown as Project;
const portal = {
  portalId: 'portal-abc', enabled: true,
  showSchedule: false, showBudgetSummary: false, showInvoices: false, showChangeOrders: false,
  showPhotos: false, showDailyReports: false, showPunchList: true, showRFIs: false, showDocuments: false,
} as unknown as ClientPortalSettings;

const base = {
  projectId: 'p1', location: 'Unit 4B', assignedSub: 'Ace Drywall', assignedSubId: 'sub-1',
  dueDate: '2026-09-20', priority: 'medium', status: 'open',
  createdAt: '2026-09-15T08:00:00.000Z', updatedAt: '2026-09-15T08:00:00.000Z',
} as const;
const LEGACY = { ...base, id: 'legacy', description: 'Cabinet door misaligned' } as PunchItem;
const PUNCH = { ...base, id: 'punch', description: 'Grout missing at tub surround', listType: 'punch' } as PunchItem;
const CREW = { ...base, id: 'crew', description: 'Sweep the corridor', listType: 'crew' } as PunchItem;
const CREW_WIP = { ...base, id: 'crew-wip', description: 'Patch the scuff behind the door', listType: 'crew', status: 'in_progress' } as PunchItem;

const snap = buildPortalSnapshot({ project, portal, punchItems: [LEGACY, PUNCH, CREW, CREW_WIP] });
const shownIds = (snap.sections.punchList ?? []).map(p => p.id);
ok('a punch item with no listType is on the client portal', shownIds.includes('legacy'),
  `shown: ${JSON.stringify(shownIds)} — an existing item vanished from a client's portal`);
ok('an explicit punch item is on the client portal', shownIds.includes('punch'), `shown: ${JSON.stringify(shownIds)}`);
ok('an open crew item is EXCLUDED from the client portal', !shownIds.includes('crew'),
  `shown: ${JSON.stringify(shownIds)} — "sweep the corridor" is on the client's project page`);
ok('an in-progress crew item is EXCLUDED too', !shownIds.includes('crew-wip'), `shown: ${JSON.stringify(shownIds)}`);
const serialized = JSON.stringify(snap);
ok('no crew item text appears anywhere in the serialized snapshot',
  !serialized.includes('Sweep the corridor') && !serialized.includes('Patch the scuff'),
  'crew item text reached the client payload through some other section');

const crewOnly = buildPortalSnapshot({ project, portal, punchItems: [CREW, CREW_WIP] });
eq('a project with ONLY crew items ships no punch section at all', crewOnly.sections.punchList, undefined,
  'an empty section header would still tell the client something was filtered');

// ───────────────────────────────────────────────────────────────────────────
console.log('\nsub portal snapshot — a sub still sees their crew items');
// ───────────────────────────────────────────────────────────────────────────
// The opposite mistake: applying the client filter everywhere. A crew item
// assigned to a sub is precisely that sub's work.
const subSnap = buildSubPortalSnapshot({
  link: { id: 'l1', requirePasscode: false } as unknown as SubPortalLink,
  project,
  sub: { id: 'sub-1', companyName: 'Ace Drywall' } as unknown as Subcontractor,
  commitments: [],
  punchItems: [LEGACY, CREW],
});
const subIds = (subSnap.punchItems ?? []).map(p => p.id);
ok('the sub portal includes a crew item assigned to that sub', subIds.includes('crew'),
  `shown: ${JSON.stringify(subIds)} — the crew-list filter was applied to the sub portal`);
ok('the sub portal includes their punch item too', subIds.includes('legacy'), `shown: ${JSON.stringify(subIds)}`);

// ───────────────────────────────────────────────────────────────────────────
console.log('\nProjectContext — all three punch_items mapping sites carry list_type');
// ───────────────────────────────────────────────────────────────────────────
const ctx = stripTsComments(read('contexts/ProjectContext.tsx'));
ok('contexts/ProjectContext.tsx is readable', ctx.length > 0);

const readSite = between(ctx, "queryKey: ['punchItems'", "mergeLocalOnly(mapped, priorPunch");
ok('site a (READ mapper, punchItemsQuery) was located', readSite.length > 0,
  "could not find queryKey: ['punchItems'] … mergeLocalOnly(mapped, priorPunch — rewrite this locator, do not delete it");
ok('site a (READ mapper, punchItemsQuery) reads r.list_type into listType',
  /listType\s*:[^,\n]*\br\.list_type\b/.test(readSite),
  'without the read-back, a refetch drops listType and the next save writes punch over a crew item');

const insertSite = between(ctx, 'const punchItemToRow = useCallback', '[userId]);');
ok('site b (INSERT payload, punchItemToRow) was located', insertSite.length > 0);
ok('site b (INSERT payload, punchItemToRow) writes list_type',
  /\blist_type\s*:/.test(insertSite),
  'a crew item created offline syncs as the column default — punch — and publishes to the client');

const updateSite = between(ctx, 'const updatePunchItem = useCallback', 'const deletePunchItem');
ok('site c (UPDATE payload, updatePunchItem) was located', updateSite.length > 0);
ok("site c (UPDATE payload, updatePunchItem) sends list_type in supabaseWrite('punch_items', 'update')",
  /supabaseWrite\(\s*'punch_items'\s*,\s*'update'[\s\S]*?\blist_type\s*:[\s\S]*?\}\s*\)/.test(updateSite),
  'moving an item between lists works on screen and silently reverts on the next refetch');

// Every OTHER write to punch_items anywhere in app code: inserts must go
// through punchItemToRow (so they inherit site b); updates must carry
// list_type literally. A fourth site added later cannot quietly skip it.
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[] = [];
  try { entries = readdirSync(join(ROOT, dir)); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = join(dir, name);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}
const sources = ['app', 'components', 'contexts', 'hooks', 'utils', 'lib'].flatMap(d => walk(d));
let writeSites = 0;
const directWrites: string[] = [];
for (const rel of sources) {
  const src = stripTsComments(read(rel));
  for (const m of src.matchAll(/supabaseWrite\(\s*'punch_items'\s*,\s*'(insert|update|upsert)'\s*,([\s\S]*?)\)\s*;/g)) {
    writeSites++;
    const [, op, args] = m;
    if (op === 'insert' || op === 'upsert') {
      ok(`${rel}: punch_items ${op} builds its row with punchItemToRow`,
        /punchItemToRow\(/.test(args) || /\blist_type\s*:/.test(args),
        `args: ${args.trim().slice(0, 120)}`);
    } else {
      ok(`${rel}: punch_items update carries list_type`, /\blist_type\s*:/.test(args),
        `args: ${args.trim().slice(0, 120)}`);
    }
  }
  if (/from\(\s*'punch_items'\s*\)\s*\.\s*(insert|update|upsert)\b/.test(src)) directWrites.push(rel);
}
ok("no direct supabase.from('punch_items') write bypasses the queue (and this guard)",
  directWrites.length === 0, `direct writes in: ${directWrites.join(', ')}`);
ok('the scan found the known punch_items write sites (≥3)', writeSites >= 3,
  `found ${writeSites} — the scan regex has stopped matching, so every assertion above is vacuous`);

// ───────────────────────────────────────────────────────────────────────────
console.log('\nmigration — NOT NULL DEFAULT punch, CHECK admits exactly punch and crew');
// ───────────────────────────────────────────────────────────────────────────
const MIG = 'supabase/migrations/20260916120000_punch_list_type.sql';
const sql = stripSqlComments(read(MIG)).replace(/\s+/g, ' ');
ok(`${MIG} exists`, sql.trim().length > 0);
ok('adds list_type text NOT NULL DEFAULT \'punch\' idempotently',
  /ALTER TABLE public\.punch_items ADD COLUMN IF NOT EXISTS list_type text NOT NULL DEFAULT 'punch'/i.test(sql),
  'NOT NULL + DEFAULT punch is what backfills every existing row as a formal punch item');
const checkMatch = /CHECK\s*\(\s*list_type\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql);
const admitted = checkMatch
  ? checkMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).sort()
  : null;
eq('the CHECK constraint admits exactly punch and crew', admitted, ['crew', 'punch']);
ok('the CHECK is guarded by a pg_constraint lookup, so re-running is safe',
  /IF NOT EXISTS\s*\(\s*SELECT[\s\S]*?FROM pg_constraint/i.test(sql) && /ADD CONSTRAINT punch_items_list_type_check/i.test(sql));

// ───────────────────────────────────────────────────────────────────────────
console.log('\nevery OTHER road a punch item takes to the client filters crew out');
// ───────────────────────────────────────────────────────────────────────────
// The portal snapshot is not the only way a punch item reaches the client. The
// punch list screen now TELLS the builder a crew item is "never shown to your
// client", so each of these is a promise, not a nicety. Found by the data-layer
// pass after the portal filter alone had been written and called done:
//   - the weekly update, which is EMAILED to the client;
//   - the closeout packet, which is HANDED to the client at handover;
//   - the builder's own "preview as your client", whose local path was unfiltered.
{
  const weekly = stripTsComments(read('utils/weeklyClientUpdate.ts'));
  ok('weekly client update filters to formal punch at its source',
    /punchItems:\s*allPunchItems[\s\S]{0,160}punchListTypeOf\(p\)\s*===\s*'punch'/.test(weekly),
    'this update is emailed to the client; a crew chore must not count as an open item');

  const closeout = stripTsComments(read('utils/closeoutPacketGenerator.ts'));
  ok('closeout packet narrows punchItems to formal punch before using it',
    /const punchItems\s*=\s*data\.punchItems\.filter\(p\s*=>\s*punchListTypeOf\(p\)\s*===\s*'punch'\)/.test(closeout),
    'the packet is handed to the client; crew items must not reach its punch section or its % complete');
  ok('closeout packet no longer destructures the unfiltered list',
    !/const\s*\{[^}]*\bpunchItems\b[^}]*\}\s*=\s*data/.test(closeout),
    'destructuring punchItems straight off data would shadow the filtered one');

  const preview = stripTsComments(read('app/client-view.tsx'));
  ok("client-view's LOCAL path filters to formal punch",
    /getPunchItemsForProject\(localProject\.id\)\.filter\(p\s*=>\s*punchListTypeOf\(p\)\s*===\s*'punch'\)/.test(preview),
    'a preview that shows crew items the real portal hides is a preview that lies');
}

console.log('');
if (fail > 0) {
  console.error(`✗ validate-punch-list-type: ${fail} failure(s), ${pass} passed.\n`);
  process.exit(1);
}
console.log(`✓ validate-punch-list-type: ${pass} checks — crew items stay internal, punch items stay visible.\n`);
