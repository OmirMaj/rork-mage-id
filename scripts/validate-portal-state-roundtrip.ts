// validate-portal-state-roundtrip.ts — a column written must be read back.
//
// WHY THIS EXISTS. `portal_state` decides whether a record is visible to the
// HOMEOWNER. utils/portalSnapshot.isShared() is:
//
//     function isShared(s?: PortalState) { return s == null || s.status === 'sent'; }
//
// undefined is deliberately grandfathered as SENT, so records predating the
// portal feature stay visible. That is correct — and it makes a missing read
// catastrophic rather than merely lossy.
//
// The app wrote portal_state to EIGHT tables and hydrated it back on exactly
// ONE (invoices). Any refetch stripped it, saveLocal destroyed the local copy,
// isShared then said "sent", and the 2-second debounced snapshot upsert on
// project open published it. Net effect, with no user action beyond opening a
// screen: unsent DRAFT change orders (with pricing) and items the GC had
// explicitly RECALLED — "your builder removed this, please disregard" — became
// visible to the client. The Client Outbox, the one screen that would have
// surfaced the mistake, keys off portalState?.status and reported zero drafts.
//
// Worse still on warranties and aia_pay_apps: their row mappers emit
// `portal_state: x.portalState ?? null` on UPDATE, so once a refetch stripped
// the field in memory, the next edit wrote NULL over a good server row. Server
// truth destroyed, not just the view.
//
// This is the THIRD instance of the same shape in one week — RFI custody chains
// and punch-photo GPS were the others. Hence a guard rather than another fix.
//
// THE RULE: every table the app writes portal_state to must read it back in the
// query mapper that hydrates it.
//
// Run via: bun run test:portal-state-roundtrip

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'contexts', 'ProjectContext.tsx');
const src = readFileSync(SRC, 'utf8');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); passes++; }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

/** Source with `//` line comments stripped, so a check can't be satisfied (or
 *  broken) by prose that merely NAMES the thing it is looking for. */
const code = src.split('\n').map(l => l.split('//')[0]).join('\n');

console.log('\nportal_state round-trip:');

// ── 1. isShared still treats undefined as visible ───────────────────────────
// If this ever flips, the blast radius below changes and this guard's rationale
// needs rewriting rather than silently over-guarding.
const snap = readFileSync(join(ROOT, 'utils', 'portalSnapshot.ts'), 'utf8');
check(
  'isShared() still grandfathers undefined as SENT (the reason this matters)',
  /function isShared[^{]*\{\s*return s == null \|\| s\.status === 'sent';/.test(snap),
  'If undefined now HIDES instead, a missing read is a visibility bug the other way — update this guard.',
);

// ── 2. every written table is read back ─────────────────────────────────────
// Tables the app persists portal_state to. Derived from the write sites; add a
// table here when you add a portal_state column to it.
const TABLES = [
  'change_orders', 'invoices', 'daily_reports', 'photos',
  'rfis', 'submittals', 'aia_pay_apps', 'warranties',
];

const writeCount = (src.match(/portal_state:/g) ?? []).length;
check('portal_state is still written somewhere', writeCount > 0);

// Each query mapper is the block between `.from('<table>')` and its `})) as`.
for (const table of TABLES) {
  const from = src.indexOf(`.from('${table}').select`);
  if (from === -1) {
    check(`${table}: query located`, false, `no .from('${table}').select — table renamed? update this guard.`);
    continue;
  }
  // Bound the window by the NEXT query, not by the first `})) as`. Several
  // mappers nest an inner one (daily_reports maps its photos array, and its
  // close reads `})) as DailyFieldReport['photos']`), so stopping at the first
  // close cuts the window short and reports a false failure on a correct file.
  // A guard that cries wolf gets disabled, which is how the real bug returns.
  const rest = src.slice(from);
  const nextQuery = rest.indexOf(".from('", 10);
  const mapper = nextQuery === -1 ? rest : rest.slice(0, nextQuery);
  check(
    `${table}: portal_state is read back`,
    /r\.portal_state/.test(mapper),
    `The mapper hydrating ${table} drops portal_state. A refetch will make DRAFT and RECALLED records read as SENT and publish them to the client.`,
  );
}

// ── 3. an EDIT must persist every column a CREATE persists ──────────────────
// SAME BUG CLASS, ONE STEP EARLIER. Section 2 catches "written but never read
// back". This catches "written on INSERT, silently dropped on UPDATE" — which
// has exactly the same ending, because the mapper faithfully reads the column
// the update never wrote and saveLocal() then overwrites the local copy with
// the server's stale value. The user's edit reverts on next launch, no error.
//
// Shipped instances (2026-08-31 sweep):
//   change_orders — the insert omitted schedule_impact_days AND both anchor
//     columns; the update wrote only schedule_impact_days. An approved CO's
//     "+5 days" hydrated as undefined, normalizeImpactDays(undefined) → 0 →
//     'no_impact', and nothing on the Gantt moved.
//   rfis — the update dropped date_required / submitted_by / linked_drawing /
//     linked_task_id. A granted extension reverted and the overdue machinery
//     kept auto-chasing against the old date.
//   submittals — the update dropped submitted_by / required_date, same shape.
//
// THE RULE: insert and update share ONE row builder per table, that builder
// carries the columns below, and the query mapper reads them back.
interface RowBuilder {
  table: string;
  /** The useCallback that builds the row shared by insert and update. */
  builder: string;
  /** Columns that must be in the shared builder AND read back by the mapper. */
  columns: string[];
}

const ROW_BUILDERS: RowBuilder[] = [
  {
    table: 'change_orders',
    builder: 'changeOrderToRow',
    columns: [
      'schedule_impact_days', 'schedule_impact_applied',
      'schedule_impact_task_ids', 'schedule_anchor_task_id',
    ],
  },
  {
    table: 'rfis',
    builder: 'rfiMutableRow',
    columns: ['date_required', 'submitted_by', 'linked_drawing', 'linked_task_id'],
  },
  {
    table: 'submittals',
    builder: 'submittalMutableRow',
    columns: ['submitted_by', 'required_date'],
  },
];

console.log('\ninsert/update row-builder parity:');

for (const { table, builder, columns } of ROW_BUILDERS) {
  const decl = code.indexOf(`const ${builder} = useCallback(`);
  if (decl === -1) {
    check(`${table}: ${builder} exists`, false, `no \`const ${builder} = useCallback(\` — renamed? update this guard.`);
    continue;
  }
  // Builder body: declaration through its `}), [` close.
  const close = code.indexOf('}), [', decl);
  const body = close === -1 ? code.slice(decl) : code.slice(decl, close);

  for (const col of columns) {
    check(
      `${table}: ${builder} writes ${col}`,
      new RegExp(`\\b${col}\\s*:`).test(body),
      `${col} is written on INSERT and read back by the mapper. Leaving it out of the shared builder means an edit never reaches the server and the next refetch reverts it.`,
    );
  }

  // The UPDATE must go through the builder — hand-listing columns at the
  // update site is precisely how these three drifted in the first place.
  check(
    `${table}: the update payload spreads ${builder}`,
    new RegExp(`supabaseWrite\\(\\s*'${table}'\\s*,\\s*'update'\\s*,\\s*\\{\\s*\\.\\.\\.${builder}\\(`).test(code),
    `Build the update payload as { ...${builder}(x), updated_at: now } so it cannot drop a column the insert writes.`,
  );

  // …and so must the INSERT, or the two can drift the other way.
  check(
    `${table}: ${builder} is used by more than one write path`,
    (code.match(new RegExp(`${builder}\\(`, 'g')) ?? []).length >= 2,
    `${builder} should be called by BOTH the insert and the update path.`,
  );

  // Same mapper-window technique as section 2.
  const from = src.indexOf(`.from('${table}').select`);
  const rest = src.slice(from);
  const nextQuery = from === -1 ? -1 : rest.indexOf(".from('", 10);
  const mapper = from === -1 ? '' : (nextQuery === -1 ? rest : rest.slice(0, nextQuery));
  for (const col of columns) {
    check(
      `${table}: ${col} is read back`,
      mapper.includes(`r.${col}`),
      `The mapper hydrating ${table} drops ${col}, so it hydrates as undefined after any refetch.`,
    );
  }
}

// ── 4. batch send must not loop the single-item setter ──────────────────────
// updateItemPortalState reads the state arrays out of its CLOSURE. That is
// correct for one call and silently lossy when called N times in one
// synchronous tick: React does not re-render mid-loop, so iteration 2 maps over
// the ORIGINAL array and drops iteration 1. batchSendToClientPortal did exactly
// that — only the LAST item of each kind kept status 'sent' while `sent++`
// counted every one. The GC was told "3 items sent to your client" and the
// Client Outbox still listed 2 as drafts; tapping Send all again inserted a
// SECOND consolidated portal message and re-versioned documents the client
// already had. Batches go through applyPortalStates, which maps and persists
// each list exactly once.
console.log('\nbatch portal send:');

const batchStart = code.indexOf('const batchSendToClientPortal = useCallback(');
if (batchStart === -1) {
  check('batchSendToClientPortal located', false, 'renamed? update this guard.');
} else {
  const batchEnd = code.indexOf('\n  const ', batchStart + 10);
  const batchBody = batchEnd === -1 ? code.slice(batchStart) : code.slice(batchStart, batchEnd);
  check(
    'batchSendToClientPortal does NOT call the single-item updateItemPortalState',
    !/updateItemPortalState\s*\(/.test(batchBody),
    'Calling it per item makes every iteration map over the same pre-loop array — all but the last item of each kind lose the sent flag while the success count reports them all.',
  );
  check(
    'batchSendToClientPortal applies portal states via applyPortalStates',
    /applyPortalStates\s*\(/.test(batchBody),
    'Collect { kind, itemId, next } for the whole batch and apply once.',
  );
  check(
    'applyPortalStates groups by kind before mapping each list',
    /const applyPortalStates = useCallback\(/.test(code) &&
      /byKind/.test(code),
    'applyPortalStates must map+persist each kind exactly once, not once per item.',
  );
}

if (failures > 0) {
  console.error(`\n✗ validate-portal-state-roundtrip: ${failures} failure(s)`);
  console.error('  Section 2: add `portalState: (r.portal_state as PortalState | null) ?? undefined,` to the mapper(s).');
  console.error('  Section 3: route insert AND update through the shared row builder.');
  console.error('  Section 4: batch sends go through applyPortalStates, never a loop of updateItemPortalState.\n');
  process.exit(1);
}
console.log(`\n${passes} passed, 0 failed\n`);
