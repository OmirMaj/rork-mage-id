#!/usr/bin/env bun
// scripts/validate-w4-final-fix-r8.ts
//
// Audit wave 4 · final fix, round 8 (data-sync critic). Each guard runs the
// shipped code or pins the one line that wires it, and was mutation-tested
// against the real round-7 code.
//
//  A. A job named ONLY by a Not-saved line is never pinned whole. The load
//     takes the SERVER's projects row and lays the line's own row over it —
//     a money-only line's project_financials row over the server's fin row,
//     a projects line over the projects row. Round 7 pinned the device row
//     whole, and his next edit of that job sent the phone's OLD row back as a
//     whole-row write: a rename, a close-out (which then reopened the
//     homeowner's portal link), a portal switched off on the web — all
//     overwritten. Nothing owes a re-read (the loop stays closed) and no job is
//     dropped. Mount-level proof: __tests__/sync/ledger-no-reload-loop.test.tsx.
//  B. The settings twin: the profiles row is read through his Not-saved
//     settings line (the ledger survives a re-auth sweep, the cache does not),
//     and a kept device copy is written back when the sweep removed it.
//  C. Record Payment after "Open Not saved": the typed payment is NOT brought
//     back when the waiting append is the same money, and a payment chain that
//     ends after he left the invoice never calls router.back().
//
// Run: bun run scripts/validate-w4-final-fix-r8.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unsavedProjectPinsIn, overlayUnsavedRow } from '../utils/projectContextPure';
import { settingsRowWithUnsaved } from '../utils/settingsLoadGuard';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

let passed = 0, failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail !== undefined ? ` — ${String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 500)}` : ''}`); }
}
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  const b = a > -1 ? src.indexOf(to, a + from.length) : -1;
  return a > -1 && b > a ? src.slice(a, b) : '';
}

const CTX = read('contexts/ProjectContext.tsx');

console.log('\nA. a Not-saved job: the SERVER row with the line laid over it, never the stale device row');
{
  const L = (id: string, table: string, recordId: string, operation: string, row: Record<string, unknown> | undefined, queuedAt: number) =>
    ({ id, kind: 'write', table, recordId, operation, row, queuedAt, at: queuedAt });
  const pins = unsavedProjectPinsIn([
    L('f2', 'project_financials', 'p1', 'upsert', { project_id: 'p1', user_id: 'u', target_budget: 175000, updated_at: 'x' }, 20),
    L('f1', 'project_financials', 'p1', 'upsert', { project_id: 'p1', user_id: 'u', target_budget: 150000, retainage_percent: 5 }, 10),
    L('p', 'projects', 'p2', 'update', { id: 'p2', user_id: 'u', status: 'on_hold', created_at: 'c' }, 5),
    L('d', 'projects', 'p3', 'delete', { id: 'p3' }, 5),
    L('r', 'projects', 'p4', 'rpc', undefined, 5),
  ], new Set());
  ok('a money line\'s rows fold oldest → newest (the newest column wins), identity columns dropped',
    JSON.stringify(pins.finRows.get('p1')) === JSON.stringify({ target_budget: 175000, retainage_percent: 5 }), [...pins.finRows]);
  ok('a projects line\'s columns, identity columns dropped', JSON.stringify(pins.projectRows.get('p2')) === JSON.stringify({ status: 'on_hold' }), [...pins.projectRows]);
  ok('a refused DELETE is marked (the device\'s absence is kept, not laid over)', pins.deleted.has('p3') && !pins.projectRows.has('p3'));
  ok('an rpc-only line carries no row', !pins.projectRows.has('p4') && !pins.whole.has('p4'));
  const over = overlayUnsavedRow({ id: 'p1', name: 'renamed on the web', status: 'closed', target_budget: 100000 }, { target_budget: 150000 });
  ok('overlay: the line\'s columns win, every other column is the server\'s',
    JSON.stringify(over) === JSON.stringify({ id: 'p1', name: 'renamed on the web', status: 'closed', target_budget: 150000 }), over);
  ok('overlay with no line is the server row itself', overlayUnsavedRow({ a: 1 }, undefined)?.a === 1);
  ok('overlay with no server fin row (not created yet) is the line alone', overlayUnsavedRow(undefined, { target_budget: 1 })?.target_budget === 1);

  const load = slice(CTX, "console.log('[ProjectContext] Loading projects');", 'const bearerBefore = await readBearer();');
  ok('the loader no longer pins every Not-saved job whole before the SELECT',
    !/for \(const id of unsavedProjects\) pendingAtStart\.add\(id\);/.test(CTX) && /const ledgerOnlyPins = new Set\(\[\.\.\.unsavedProjects\]\.filter\(\(id\) => !queuePinned\.has\(id\)\)\);/.test(load));
  ok('...the overlaid jobs are the ledger-only ones less a refused delete',
    /const overlaidIds = new Set\(\[\.\.\.ledgerOnlyPins\]\.filter\(\(id\) => !unsavedPins\.deleted\.has\(id\)\)\);/.test(load));
  const mapper = flat(slice(CTX, 'const mapped = data.map((serverRow: Record<string, unknown>) => {', '}) as Project[];'));
  ok('the mapper lays the projects line over the SERVER row and the fin line over the SERVER fin row',
    /const r = overlaid \? overlayUnsavedRow\(serverRow, unsavedPins\.projectRows\.get\(rid\)\) as Record<string, unknown> : serverRow;/.test(mapper)
      && /const f = overlaid \? overlayUnsavedRow\(fServer, unsavedPins\.finRows\.get\(rid\)\) : fServer;/.test(mapper), mapper.slice(0, 900));
  ok('...hasRow and legacyHasMoney still read the SERVER\'s answer (B-1 / B-3)',
    /hasRow: !!fServer/.test(mapper) && /const legacyHasMoney = legacyMoneyPresent\(serverRow\);/.test(mapper));
  ok('...the terms come from the overlaid fin row, the cache only for a QUEUED write',
    /const pendingProjectIds = new Set\(\[\.\.\.await queuedIdsFor\('projects'\), \.\.\.\[\.\.\.unsavedProjects\]\.filter\(\(id\) => queuePinned\.has\(id\)\)\]\);/.test(CTX)
      && /finRow: f,/.test(mapper));
  ok('only a Not-saved job with no server row to lay over (or a refused delete) keeps the device pin — after the SELECT',
    /for \(const id of ledgerOnlyPins\) if \(!overlaidIds\.has\(id\) \|\| !remoteIds\.has\(id\)\) pendingAtStart\.add\(id\);/.test(CTX)
      && CTX.indexOf('for (const id of ledgerOnlyPins) if (!overlaidIds.has(id)') < CTX.indexOf('const plan = planProjectsLoad('));
  ok('the schedule base is the SERVER\'s tasks, never a line\'s schedule laid over the mapped row',
    /const serverTasks = selectedTasks\.get\(p\.id\) \?\? \[\];\s*serverScheduleTasksRef\.current\.set\(p\.id, serverTasks\);/.test(CTX)
      && !/serverScheduleTasksRef\.current\.set\(p\.id, p\.schedule\?\.tasks \?\? \[\]\);/.test(CTX));
}

console.log('\nB. the settings twin');
{
  const row = { id: 'u', tax_rate: 7.5, company_name: 'Ridgeline Builders', logo_uri: 'web-logo', deposit_pct: 10 };
  const lines = [
    { operation: 'update', data: { id: 'u', tax_rate: 8.25, company_name: 'Ridgeline Builders LLC' }, queuedAt: 2 },
    { operation: 'update', data: { id: 'u', tax_rate: 8.0 }, queuedAt: 1 },
    { operation: 'update', data: { id: 'other', tax_rate: 99 }, queuedAt: 3 },
    { operation: 'update', data: { id: 'u', deposit_pct: 30 }, queuedAt: 4 },
  ];
  const out = settingsRowWithUnsaved(row, lines, 'u');
  ok('his Not-saved settings columns win (newest last), the rest is the server\'s',
    out.tax_rate === 8.25 && out.company_name === 'Ridgeline Builders LLC' && out.logo_uri === 'web-logo', out);
  ok('another user\'s line is ignored; payment terms keep their own rule (not laid over here)', out.deposit_pct === 10, out);
  ok('no user / no line: the row itself', settingsRowWithUnsaved(row, [], 'u') === row && settingsRowWithUnsaved(row, lines, null) === row);
  const q = flat(slice(CTX, "const { data, error } = await supabase.from('profiles')", 'settingsFirstReadFailuresRef.current = { owner: ownerKey, n: 0 };'));
  const sObj = slice(q, 'const s: AppSettings = {', '...paymentTermsAfterLoad(');
  ok('the settings loader builds the settings columns from the row read through the line (after the queue read)',
    /const row = settingsRowWithUnsaved\(data as Record<string, unknown>, await unsavedAsQueueEntries\('profiles'\), userId\);/.test(q)
      && q.indexOf('const termsQueue = await getOfflineQueue();') < q.indexOf('const row = settingsRowWithUnsaved(')
      && q.indexOf('const row = settingsRowWithUnsaved(') < q.indexOf('const s: AppSettings = {')
      && /taxRate: coerceRate\(row\.tax_rate,/.test(sObj) && !/\bdata\./.test(sObj), q.slice(0, 900));
  ok('a kept device copy is written back when the sweep removed the cache',
    /if \(outcome\.kept === 'device' && !outcome\.persist && !outcome\.rereadOwed && !\(await loadLocal<AppSettings \| null>\(SETTINGS_KEY, null\)\)\) \{ await saveLocal\(SETTINGS_KEY, outcome\.settings\); \}/.test(q), q.slice(-900));
}

console.log('\nC. Record Payment after "Open Not saved", and after he left the invoice');
{
  const INV = read('app/invoice.tsx');
  const past = flat(slice(INV, 'const commitPaymentPastUnsaved = useCallback(', 'const recordUnderLock = useCallback('));
  ok('the same money as a waiting append is NOT resumed (retry it there; the next open starts fresh)',
    /const sameMoney = waiting\.some\(\(w\) => Math\.round\(w \* 100\) === Math\.round\(amt \* 100\)\);/.test(past)
      && /onPress: \(\) => openNotSavedFromPaymentSheet\(!sameMoney\)/.test(past), past.slice(0, 900));
  const commit = flat(slice(INV, 'const commitPayment = useCallback(async (amt: number) => {', 'const commitPaymentPastUnsaved = useCallback('));
  ok('the end of a payment closes the sheet and goes back only while the invoice is still in front',
    /const stillInFront = screenInFrontRef\.current; if \(stillInFront\) \{ setShowPaymentModal\(false\);/.test(commit)
      && /if \(stillInFront\) router\.back\(\);/.test(commit) && !/\);\s*router\.back\(\);\s*\}, \[paymentMethod/.test(commit), commit.slice(-900));
  ok('...the result alert still shows either way', commit.indexOf('showAlert(\n') > -1 || /showAlert\( outcome === 'queued' \? 'Payment saved on this phone'/.test(commit));
  ok('the invoice clears "in front" on blur and on unmount',
    /useFocusEffect\(useCallback\(\(\) => \{\s*screenInFrontRef\.current = true;\s*return \(\) => \{ screenInFrontRef\.current = false; \};\s*\}, \[\]\)\);/.test(INV)
      && /useEffect\(\(\) => \(\) => \{ screenInFrontRef\.current = false; \}, \[\]\);/.test(INV));
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
