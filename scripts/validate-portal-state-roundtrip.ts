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
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}

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

if (failures > 0) {
  console.error(`\n✗ validate-portal-state-roundtrip: ${failures} failure(s)`);
  console.error('  Add `portalState: (r.portal_state as PortalState | null) ?? undefined,`');
  console.error('  to the mapper(s) above.\n');
  process.exit(1);
}
console.log(`\n${TABLES.length + 2} passed, 0 failed\n`);
