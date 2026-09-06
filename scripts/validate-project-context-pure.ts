// validate-project-context-pure.ts — the loader/mapper math ProjectContext
// used to do inline, now pure and testable (utils/projectContextPure.ts).
//
// WHY THIS EXISTS. Five audit findings in 2026-09-03-final-push-audit.md were
// the same shape: a 5,700-line context did a one-line coercion or mapping
// inline, nothing could test it, and money or tenancy quietly went wrong:
//
//   MONEY-F3   `Number(tax_rate) || 7.5` turned a saved 0% back into 7.5%.
//   MONEY-F1   the AIA writer read `a.snapshotTotals` (never set) so
//              `snapshot_totals` was always NULL and `totals` never came back.
//   AUTH-F2    the legacy `projects.estimate` fallback fired precisely for the
//              collaborator whose role project_financials was built to blind.
//   AUTH-F5    portal accessToken/passcode rode along on every row a
//              collaborator could read.
//   SYNC-F3    every child loader overwrote the device copy wholesale, so an
//              offline-created record vanished when the SELECT beat the flush.
//   SYNC-F7    debounced project syncs lived only in a timer nothing flushed.
//   PRODUCT-F1 the COI vault never told the subcontractor record when the
//              certificate expires, so coi-expiry-watch had nothing to read.
//   B-1        a FAILED project_financials SELECT looked exactly like "no
//              rows", so a shared project cached `estimate: null` and the next
//              PATCH wrote it to both tables (financialPickAfterLoad /
//              financialsLoadedFor / classifyProjectForSync.sendMoney).
//   B-2        shared/blinded were read off the display roster, which the
//              invite flow never writes (acceptedRolesByProject / myRoleAfterLoad).
//   A-1        a shared row whose owner is unknown skips project_financials;
//              every creation path stamps ownerUserId (claimProjectForUser),
//              so a cache with none is a pre-field cache → PATCHed base-only.
//   A-2        a viewer never sends money (their PATCH is filtered to 0 rows
//              and the project_financials upsert is RLS-refused → toast).
//   B-3        "read OK + no fin row + editor" stamped financialsLoaded:true
//              while projects.estimate still carried the owner's money (fin
//              table behind the pre-split devices): the editor's next PATCH
//              sent `estimate: null` over it and INSERTed the null
//              (legacyMoneyPresent / financialsLoadedFor / financialPickAfterLoad).
//   A-3 / A-8  AuthContext keep-queue narrowing; in-flight syncs never re-fire.
//
// Run via: bun run scripts/validate-project-context-pure.ts

import {
  coerceRate,
  mergeLocalOnly,
  pendingIdsForTable,
  pendingIdsByTable,
  vanishedPendingIds,
  queryKeysForFlushedTables,
  financialPick,
  financialPickAfterLoad,
  financialsLoadedFor,
  legacyMoneyPresent,
  claimProjectForUser,
  acceptedRolesByProject,
  myRoleAfterLoad,
  stripPortalCredentials,
  collaboratorRoleFor,
  classifyProjectForSync,
  earliestCoverageExpiry,
  subCoiExpiryAcross,
  aiaTotalsFromLines,
  aiaRowToSaved,
  savedToAiaRow,
  shouldFlipInvoiceToPaid,
} from '../utils/projectContextPure';
import type { ProjectSyncSubject } from '../utils/projectContextPure';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ClientPortalSettings, ProjectCollaborator, SavedAIAPayApp } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Source with line and block comments blanked, so the pins read code only.
function codeOnly(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.split('//')[0]).join('\n');
}

let passes = 0;
let failures = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { console.log('  ✓', label); passes++; }
  else { console.error('  ✗', label, detail ? `\n      ${detail}` : ''); failures++; }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ── MONEY-F3 · coerceRate ───────────────────────────────────────────────────
console.log('\ncoerceRate (MONEY-F3):');
check('0 stays 0 — a saved 0% tax rate must not become the fallback', coerceRate(0, 7.5) === 0);
check("'0' (PostgREST numeric-as-string) stays 0", coerceRate('0', 7.5) === 0);
check('null → fallback', coerceRate(null, 7.5) === 7.5);
check('undefined → fallback', coerceRate(undefined, 10) === 10);
check("'7.5' → 7.5", coerceRate('7.5', 0) === 7.5);
check('NaN → fallback', coerceRate(Number.NaN, 7.5) === 7.5);
check("'abc' → fallback", coerceRate('abc', 7.5) === 7.5);
check("'' → fallback (never silently 0)", coerceRate('', 7.5) === 7.5);
check('Infinity → fallback', coerceRate(Number.POSITIVE_INFINITY, 7.5) === 7.5);

// ── SYNC-F3 · mergeLocalOnly / pendingIdsForTable ───────────────────────────
console.log('\nmergeLocalOnly (SYNC-F3):');
type Row = { id: string; v: string };
const server: Row[] = [{ id: 'a', v: 'server-a' }, { id: 'b', v: 'server-b' }];
const local: Row[] = [
  { id: 'a', v: 'local-a' },          // both → server wins
  { id: 'p', v: 'local-pending' },    // local-only, queued → kept
  { id: 'x', v: 'local-stale' },      // local-only, not queued → dropped (deleted elsewhere)
];
const merged = mergeLocalOnly(server, local, new Set(['p']));
check('server-only row survives', merged.some(r => r.id === 'b' && r.v === 'server-b'));
check('local-only PENDING row is kept', merged.some(r => r.id === 'p' && r.v === 'local-pending'));
check('local-only NON-pending row is dropped', !merged.some(r => r.id === 'x'));
check('row on both sides: server wins', merged.find(r => r.id === 'a')?.v === 'server-a');
check('server order is preserved and local-only rows append', same(merged.map(r => r.id), ['a', 'b', 'p']));
check('no duplicate ids', new Set(merged.map(r => r.id)).size === merged.length);
check('empty pending set → server list exactly', same(mergeLocalOnly(server, local, new Set()), server));
check('does not mutate its inputs', server.length === 2 && local.length === 3);
// A4: the device copy itself can carry the same id twice (two optimistic
// paths saved the same record); the kept local-only row must appear once.
const dupLocal: Row[] = [{ id: 'p', v: 'first' }, { id: 'p', v: 'second' }, { id: 'a', v: 'local-a' }];
const dedup = mergeLocalOnly(server, dupLocal, new Set(['p']));
check('duplicate id inside localRows is kept once (first occurrence wins)',
  dedup.filter(r => r.id === 'p').length === 1 && dedup.find(r => r.id === 'p')?.v === 'first');
check('dedup output has no repeated ids at all', new Set(dedup.map(r => r.id)).size === dedup.length);

console.log('\npendingIdsForTable (SYNC-F3):');
const queue = [
  { id: 'q1', table: 'invoices', operation: 'insert', data: { id: 'inv-1' } },
  { id: 'q2', table: 'invoices', operation: 'update', data: { id: 'inv-2' } },
  { id: 'q3', table: 'invoices', operation: 'delete', data: { id: 'inv-3' } },
  { id: 'q4', table: 'change_orders', operation: 'insert', data: { id: 'co-1' } },
  { id: 'q5', table: 'invoices', operation: 'upsert', data: {} },
];
const pending = pendingIdsForTable(queue, 'invoices');
check('collects insert/upsert/update ids for the table', pending.has('inv-1') && pending.has('inv-2'));
check('a queued DELETE does not resurrect the row', !pending.has('inv-3'));
check('other tables are ignored', !pending.has('co-1'));
check('entries without an id are skipped', pending.size === 2);
check('empty queue → empty set', pendingIdsForTable([], 'invoices').size === 0);

// A4: a write that leaves the queue landed OR was discarded; the diff names
// the tables to re-pull so a discarded optimistic row does not linger.
console.log('\npendingIdsByTable / vanishedPendingIds (A4):');
const byTable = pendingIdsByTable(queue);
check('groups pending ids by table (deletes excluded)',
  same([...(byTable.get('invoices') ?? [])].sort(), ['inv-1', 'inv-2']) && same([...(byTable.get('change_orders') ?? [])], ['co-1']));
const afterFlush = pendingIdsByTable(queue.filter(q => q.id !== 'q2' && q.id !== 'q4'));
const gone = vanishedPendingIds(byTable, afterFlush);
check('ids that left the queue are reported per table', same([...(gone.get('invoices') ?? [])], ['inv-2']) && same([...(gone.get('change_orders') ?? [])], ['co-1']));
check('ids still queued are not reported', !(gone.get('invoices')?.has('inv-1')));
check('a table whose ids all remain is absent from the diff', vanishedPendingIds(byTable, byTable).size === 0);
check('a table that vanished entirely reports every id', vanishedPendingIds(byTable, new Map()).get('invoices')?.size === 2);
check('ids that only APPEARED are not "vanished"', vanishedPendingIds(new Map(), byTable).size === 0);

console.log('\nqueryKeysForFlushedTables (SYNC-F3):');
const keys = queryKeysForFlushedTables(new Set(['invoices', 'project_financials', 'projects', 'punch_items', 'no_such_table']));
check('invoices → invoices', keys.includes('invoices'));
check('punch_items → punchItems (camel query key)', keys.includes('punchItems'));
check('project_financials and projects both → projects, deduped', keys.filter(k => k === 'projects').length === 1);
check('unknown table is ignored', !keys.includes('no_such_table'));
check('every listed loader table maps to a key',
  ['change_orders', 'daily_reports', 'photos', 'commitments', 'rfis', 'submittals', 'subcontractors', 'cois', 'aia_pay_apps']
    .every(t => queryKeysForFlushedTables([t]).length === 1));

// ── AUTH-F2 · financialPick ─────────────────────────────────────────────────
console.log('\nfinancialPick (AUTH-F2):');
const fin = { estimate: { grandTotal: 100 }, target_budget: null };
check('financials row wins when present', same(financialPick(fin, 'estimate', { grandTotal: 1 }, true), { grandTotal: 100 }));
check('financials row wins for a collaborator too', same(financialPick(fin, 'estimate', { grandTotal: 1 }, false), { grandTotal: 100 }));
check('owner with no financials row → legacy column', same(financialPick(undefined, 'estimate', { grandTotal: 1 }, true), { grandTotal: 1 }));
check('owner, financials key null → legacy column', same(financialPick(fin, 'target_budget', { amount: 5 }, true), { amount: 5 }));
check('COLLABORATOR with no financials row → undefined, never the legacy column', financialPick(undefined, 'estimate', { grandTotal: 1 }, false) === undefined);
check('collaborator, financials key null → undefined', financialPick(fin, 'target_budget', { amount: 5 }, false) === undefined);

// ── AUTH-F5 · stripPortalCredentials ────────────────────────────────────────
console.log('\nstripPortalCredentials (AUTH-F5):');
const portal: ClientPortalSettings = {
  enabled: true, portalId: 'p-1', passcode: '1234', accessToken: 'tok', requirePasscode: true,
  showSchedule: true, showChangeOrders: false, showInvoices: true, showPhotos: true,
  showBudgetSummary: false, showDailyReports: true, showPunchList: false, showRFIs: false, showDocuments: true,
};
const stripped = stripPortalCredentials(portal);
check('accessToken is gone', stripped != null && !('accessToken' in stripped));
check('passcode is gone', stripped != null && !('passcode' in stripped));
check('enabled / portalId / show* flags survive',
  stripped?.enabled === true && stripped?.portalId === 'p-1' && stripped?.showSchedule === true && stripped?.showChangeOrders === false);
check('input is not mutated', portal.accessToken === 'tok' && portal.passcode === '1234');
check('undefined passes through', stripPortalCredentials(undefined) === undefined);
check('null passes through as undefined', stripPortalCredentials(null) === undefined);

// ── Items 1-2 · classifyProjectForSync — decided from the project, not the last load
console.log('\nclassifyProjectForSync (blocking items 1-2):');
const ME = 'user-me';
const OWNER = 'user-owner';
const team: ProjectCollaborator[] = [
  { id: 'c1', email: 'Owner@Example.com', name: 'O', role: 'owner', status: 'accepted', invitedAt: '', userId: OWNER },
  { id: 'c2', email: 'me@example.com', name: 'M', role: 'editor', status: 'accepted', invitedAt: '', userId: ME },
  { id: 'c3', email: 'foreman@example.com', name: 'F', role: 'field', status: 'accepted', invitedAt: '' },
];
check('role by userId', collaboratorRoleFor(team, ME, null) === 'editor');
check('role by e-mail when the entry has no userId (legacy Team list), case-insensitive', collaboratorRoleFor(team, 'user-foreman', ' FOREMAN@example.com ') === 'field');
check('not listed → undefined', collaboratorRoleFor(team, 'stranger', 'stranger@example.com') === undefined);
check('empty / missing list → undefined', collaboratorRoleFor([], ME, null) === undefined && collaboratorRoleFor(undefined, ME, null) === undefined);

const ownedByMe = classifyProjectForSync({ ownerUserId: ME, collaborators: team }, ME, 'me@example.com');
check('ownerUserId === me → owned, not blinded', ownedByMe.shared === false && ownedByMe.blinded === false && ownedByMe.ownerId === ME);
const editorRow = classifyProjectForSync({ ownerUserId: OWNER, collaborators: team }, ME, 'me@example.com');
check('ownerUserId is someone else → shared', editorRow.shared === true && editorRow.ownerId === OWNER);
check('an EDITOR on a shared row is not blinded — their estimate must reach project_financials', editorRow.blinded === false);
const fieldRow = classifyProjectForSync({ ownerUserId: OWNER, collaborators: team }, 'user-foreman', 'foreman@example.com');
check('a FIELD collaborator is blinded (role, not "no financials row")', fieldRow.shared === true && fieldRow.blinded === true);
const viewerRow = classifyProjectForSync({ ownerUserId: OWNER, collaborators: [{ ...team[1], role: 'viewer' }] }, ME, null);
check('a viewer is shared but not blinded', viewerRow.shared === true && viewerRow.blinded === false);
const unlisted = classifyProjectForSync({ ownerUserId: OWNER, collaborators: [] }, ME, null);
check('shared row with the caller absent from the display list → still shared (ownerUserId wins), not blinded', unlisted.shared === true && unlisted.blinded === false);
const leadConverted = classifyProjectForSync({ ownerUserId: OWNER, collaborators: team }, ME, 'me@example.com');
check('a lead-converted project with NO financials row is classified exactly like any other editor row (financials are not an input)', leadConverted.blinded === false);
const localOnly = classifyProjectForSync({ collaborators: undefined }, ME, null);
check('A-1: no ownerUserId (pre-field cache), no collaborators → written base-only (PATCH), no money, no financials write',
  localOnly.shared === true && localOnly.ownerId === undefined && localOnly.sendMoney === false && localOnly.financialsUserId === undefined);
const legacyCacheShared = classifyProjectForSync({ collaborators: team }, ME, 'me@example.com');
check('no ownerUserId but I am listed as editor → shared (cache predating the field)', legacyCacheShared.shared === true && legacyCacheShared.blinded === false);
const legacyCacheOwner = classifyProjectForSync({ collaborators: team }, OWNER, 'owner@example.com');
check('A-1: no ownerUserId and the legacy list calls me OWNER → still base-only (the roster is no proof; the owner\'s PATCH passes RLS anyway)',
  legacyCacheOwner.shared === true && legacyCacheOwner.sendMoney === false && legacyCacheOwner.financialsUserId === undefined);
check('empty-string ownerUserId is treated as unknown', classifyProjectForSync({ ownerUserId: '', collaborators: [] }, ME, null).ownerId === undefined);

// ── B-1 / B-3 · financialPickAfterLoad / financialsLoadedFor ────────────────
console.log('\nfinancialPickAfterLoad + financialsLoadedFor (B-1, B-3):');
const finRow = { project_id: 'p1', estimate: { grandTotal: 100 } };
const cachedEst = { grandTotal: 42 };
const legacyEst = { grandTotal: 1 };
check('shared + read FAILED → the cached value, even with no row',
  same(financialPickAfterLoad(undefined, 'estimate', legacyEst, false, false, cachedEst), cachedEst));
check('shared + read failed + nothing cached → undefined (never the legacy column)',
  financialPickAfterLoad(undefined, 'estimate', legacyEst, false, false, undefined) === undefined);
check('shared + read OK + row → the row, not the cache', same(financialPickAfterLoad(finRow, 'estimate', legacyEst, false, true, cachedEst), { grandTotal: 100 }));
check('shared + read OK + no row + no display role → undefined (AUTH-F2: not the legacy column)',
  financialPickAfterLoad(undefined, 'estimate', legacyEst, false, true, cachedEst) === undefined);
check('owned + read failed → the legacy column (the owner\'s own fallback), not the cache',
  same(financialPickAfterLoad(undefined, 'estimate', legacyEst, true, false, cachedEst), legacyEst));
check('owned + read OK + row → the row', same(financialPickAfterLoad(finRow, 'estimate', legacyEst, true, true, cachedEst), { grandTotal: 100 }));
// B-3 companion: a known non-field SERVER role sees the legacy column while the fin table is behind.
check('B-3: shared + read OK + no row + EDITOR display role → the legacy column (display only)',
  same(financialPickAfterLoad(undefined, 'estimate', legacyEst, false, true, cachedEst, 'editor'), legacyEst));
check('B-3: …viewer too', same(financialPickAfterLoad(undefined, 'estimate', legacyEst, false, true, undefined, 'viewer'), legacyEst));
check('B-3: …a FIELD display role still gets nothing (AUTH-F2)',
  financialPickAfterLoad(undefined, 'estimate', legacyEst, false, true, cachedEst, 'field') === undefined);
check('B-3: a row that exists but has NOTHING for the key (QBO wrote linked_estimate only) → the legacy column for an editor',
  same(financialPickAfterLoad({ project_id: 'p1', estimate: null }, 'estimate', legacyEst, false, true, undefined, 'editor'), legacyEst));
check('B-3: the row still wins over the legacy column when it has the key',
  same(financialPickAfterLoad(finRow, 'estimate', legacyEst, false, true, undefined, 'editor'), { grandTotal: 100 }));
check('B-3: a FAILED read ignores the display role — the cache, not the legacy column',
  same(financialPickAfterLoad(undefined, 'estimate', legacyEst, false, false, cachedEst, 'editor'), cachedEst));
check('B-3: an empty legacy column → undefined for an editor (nothing to show)',
  financialPickAfterLoad(undefined, 'estimate', undefined, false, true, undefined, 'editor') === undefined);

check('legacyMoneyPresent: estimate alone', legacyMoneyPresent({ estimate: { grandTotal: 1 } }) === true);
check('legacyMoneyPresent: target_budget alone', legacyMoneyPresent({ estimate: null, target_budget: { amount: 5 } }) === true);
check('legacyMoneyPresent: linked_estimate / estimate_versions count too',
  legacyMoneyPresent({ linked_estimate: {} }) === true && legacyMoneyPresent({ estimate_versions: [] }) === true);
check('legacyMoneyPresent: all four null/absent → false (the backfill\'s own `is not null` test)',
  legacyMoneyPresent({ estimate: null, linked_estimate: null, estimate_versions: null, target_budget: null }) === false && legacyMoneyPresent({}) === false);
check('legacyMoneyPresent: unrelated columns are ignored', legacyMoneyPresent({ name: 'x', scope: { a: 1 }, schedule: {} }) === false);

const noLegacy = { legacyHasMoney: false };
check('owned → loaded, even after a failed read with no row', financialsLoadedFor({ owned: true, hasRow: false, readSucceeded: false, myRole: undefined, ...noLegacy }) === true);
check('owned → loaded with legacy money and no row (the legacy columns are the owner\'s own fallback)',
  financialsLoadedFor({ owned: true, hasRow: false, readSucceeded: true, myRole: undefined, legacyHasMoney: true }) === true);
check('shared + a financials row came back → loaded, whatever the role', financialsLoadedFor({ owned: false, hasRow: true, readSucceeded: true, myRole: 'field', ...noLegacy }) === true);
check('shared + row came back + legacy money too → loaded (the row is what this build writes)',
  financialsLoadedFor({ owned: false, hasRow: true, readSucceeded: true, myRole: 'editor', legacyHasMoney: true }) === true);
check('shared + read FAILED + no row → NOT loaded (editor)', financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: false, myRole: 'editor', ...noLegacy }) === false);
check('shared + read failed + no row → not loaded (unknown role)', financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: false, myRole: undefined, ...noLegacy }) === false);
check('shared + read OK + no row + editor + NO legacy money → loaded (no row EXISTS yet; the first estimate must create it)',
  financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: true, myRole: 'editor', ...noLegacy }) === true);
check('shared + read OK + no row + viewer + no legacy money → loaded', financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: true, myRole: 'viewer', ...noLegacy }) === true);
check('B-3: shared + read OK + no row + editor + LEGACY MONEY → NOT loaded (the fin table is provably behind; hold the money back)',
  financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: true, myRole: 'editor', legacyHasMoney: true }) === false);
check('B-3: …viewer too', financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: true, myRole: 'viewer', legacyHasMoney: true }) === false);
check('shared + read OK + no row + FIELD → not loaded (the absence may be RLS)', financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: true, myRole: 'field', ...noLegacy }) === false);
check('shared + read OK + no row + UNKNOWN role → not loaded', financialsLoadedFor({ owned: false, hasRow: false, readSucceeded: true, myRole: undefined, ...noLegacy }) === false);

// B-3 end to end — the reviewer's row: owner O estimated 50,000 on the pre-split
// build after the backfill (no fin row); editor E loads it, then edits anything.
{
  const row: Record<string, unknown> = { id: 'p-b3', user_id: OWNER, estimate: { grandTotal: 50000 }, linked_estimate: null, estimate_versions: null, target_budget: null };
  const owned = row.user_id === ME;
  const legacyHasMoney = legacyMoneyPresent(row);
  const loaded = financialsLoadedFor({ owned, hasRow: false, readSucceeded: true, myRole: 'editor', legacyHasMoney });
  const shown = financialPickAfterLoad(undefined, 'estimate', row.estimate, owned, true, undefined, 'editor') ?? null;
  const cls = classifyProjectForSync({ ownerUserId: row.user_id as string, myRole: 'editor', financialsLoaded: loaded, collaborators: [] }, ME, null);
  check('B-3 e2e: the editor SEES the owner\'s 50,000 estimate', same(shown, { grandTotal: 50000 }));
  check('B-3 e2e: …but the device is stamped NOT loaded, so the next PATCH carries no money key and project_financials is never written with null',
    loaded === false && cls.shared === true && cls.sendMoney === false && cls.financialsUserId === undefined);
  const afterOwner = financialsLoadedFor({ owned, hasRow: true, readSucceeded: true, myRole: 'editor', legacyHasMoney });
  check('B-3 e2e: once a fin row exists (owner\'s post-OTA device, or the runbook re-backfill) the editor holds the money again', afterOwner === true);
}

// ── B-2 · acceptedRolesByProject / myRoleAfterLoad ──────────────────────────
console.log('\nacceptedRolesByProject + myRoleAfterLoad (B-2):');
const pcRows = [
  { project_id: 'p1', role: 'editor', status: 'accepted' },
  { project_id: 'p2', role: 'field', status: 'accepted' },
  { project_id: 'p3', role: 'editor', status: 'pending' },
  { project_id: 'p4', role: 'viewer', status: 'revoked' },
  { project_id: 'p5', role: 'admin', status: 'accepted' },
  { role: 'editor', status: 'accepted' },
  { project_id: '', role: 'editor', status: 'accepted' },
  { project_id: 'p6', role: 42, status: 'accepted' },
];
const roles = acceptedRolesByProject(pcRows);
check('accepted rows map project → role', roles.get('p1') === 'editor' && roles.get('p2') === 'field');
check('pending and revoked rows grant nothing (every RLS gate requires accepted)', !roles.has('p3') && !roles.has('p4'));
check('an unknown role string / non-string is ignored, not trusted', !roles.has('p5') && !roles.has('p6'));
check('rows without a project id are skipped', roles.size === 2);
check('null / undefined input → empty map', acceptedRolesByProject(null).size === 0 && acceptedRolesByProject(undefined).size === 0);
check('read OK → the server role wins over the cache', myRoleAfterLoad(true, 'field', 'editor') === 'field');
check('read OK and no accepted row → undefined (a revoked invite clears the stale cache)', myRoleAfterLoad(true, undefined, 'editor') === undefined);
check('read FAILED → the cached role survives (never downgrades a shared project to owned)', myRoleAfterLoad(false, undefined, 'field') === 'field');
check('read failed with nothing cached → undefined', myRoleAfterLoad(false, undefined, undefined) === undefined);

// ── B-1 / B-2 / A-1 · classifyProjectForSync with myRole + financialsLoaded ──
console.log('\nclassifyProjectForSync — myRole / financialsLoaded (B-1, B-2, A-1):');
const editorLoaded = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'editor', financialsLoaded: true, collaborators: [] }, ME, null);
check("B-1: shared editor holding the money → sends it; project_financials carries the OWNER's id",
  editorLoaded.shared === true && editorLoaded.blinded === false && editorLoaded.sendMoney === true && editorLoaded.financialsUserId === OWNER);
const editorUnloaded = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'editor', financialsLoaded: false, collaborators: [] }, ME, null);
check('B-1: shared + financialsLoaded:false → NO money on the PATCH and NO project_financials write',
  editorUnloaded.shared === true && editorUnloaded.sendMoney === false && editorUnloaded.financialsUserId === undefined);
check('B-1: …and is still not "blinded" — the role is fine, the device just does not hold the money', editorUnloaded.blinded === false);
const preField = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'editor', collaborators: [] }, ME, null);
check('B-1: a cache predating financialsLoaded reads as loaded', preField.sendMoney === true && preField.financialsUserId === OWNER);
const ownedUnloaded = classifyProjectForSync({ ownerUserId: ME, financialsLoaded: false, collaborators: [] }, ME, null);
check("B-1: an OWNED row always sends its money (the legacy columns are the owner's own fallback)",
  ownedUnloaded.shared === false && ownedUnloaded.sendMoney === true && ownedUnloaded.financialsUserId === ME);
const fieldByRole = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'field', financialsLoaded: true, collaborators: team }, ME, 'me@example.com');
check('B-2: myRole "field" blinds even though the display roster lists me as editor',
  fieldByRole.blinded === true && fieldByRole.sendMoney === false && fieldByRole.financialsUserId === undefined);
const editorByRole = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'editor', financialsLoaded: true, collaborators: [{ ...team[1], role: 'field' }] }, ME, 'me@example.com');
check('B-2: myRole "editor" is not blinded even though the display roster says field', editorByRole.blinded === false && editorByRole.sendMoney === true);
const viewerByRole = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'viewer', financialsLoaded: true, collaborators: [] }, ME, null);
check('B-2: myRole "viewer" → shared, not blinded', viewerByRole.shared === true && viewerByRole.blinded === false);
const sharedBySecondSignal = classifyProjectForSync({ myRole: 'editor', financialsLoaded: true, collaborators: [] }, ME, null);
check('B-2: no ownerUserId but myRole present → shared (second signal), never owned', sharedBySecondSignal.shared === true && sharedBySecondSignal.blinded === false);
check('A-1: …owner unknown → the money is held back and project_financials is skipped', sharedBySecondSignal.sendMoney === false && sharedBySecondSignal.financialsUserId === undefined);
const ownerRole = classifyProjectForSync({ myRole: 'owner', collaborators: [] }, ME, null);
check('A-1: myRole "owner" with no ownerUserId is still a pre-field cache → base-only PATCH (this build never stamps one without the other)',
  ownerRole.shared === true && ownerRole.sendMoney === false && ownerRole.financialsUserId === undefined);
// A-1: every creation path stamps the owner, so a project made on THIS build is owned outright.
const fresh: ProjectSyncSubject = { collaborators: [] };
const created = classifyProjectForSync(claimProjectForUser(fresh, ME), ME, null);
check('A-1: a project created locally on this build carries ownerUserId and is OWNED — money and project_financials go out under MY id',
  claimProjectForUser(fresh, ME).ownerUserId === ME && created.shared === false && created.ownerId === ME && created.sendMoney === true && created.financialsUserId === ME);
const sharedSource: ProjectSyncSubject = { ownerUserId: OWNER, myRole: 'editor', financialsLoaded: false, collaborators: [] };
const cloned = claimProjectForUser(sharedSource, ME);
check('A-1: claimProjectForUser re-owns a clone of a SHARED project and drops the loader stamps (myRole, financialsLoaded)',
  cloned.ownerUserId === ME && !('myRole' in cloned) && !('financialsLoaded' in cloned) && classifyProjectForSync(cloned, ME, null).shared === false);
check('A-1: claimProjectForUser with no user id leaves the project untouched (nothing syncs signed-out)',
  claimProjectForUser(sharedSource, null).ownerUserId === OWNER && claimProjectForUser(sharedSource, undefined).myRole === 'editor');
const withTeam: ProjectSyncSubject = { collaborators: team };
check('A-1: claimProjectForUser keeps every other field', same(claimProjectForUser(withTeam, ME), { collaborators: team, ownerUserId: ME }));
// A-2: a viewer's PATCH is filtered to 0 rows and the financials upsert is RLS-refused (terminal toast) — never send money.
const viewerLoaded = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'viewer', financialsLoaded: true, collaborators: [] }, ME, null);
check('A-2: myRole "viewer" holding the money → shared, not blinded, but sendMoney false and no project_financials write',
  viewerLoaded.shared === true && viewerLoaded.blinded === false && viewerLoaded.sendMoney === false && viewerLoaded.financialsUserId === undefined);
const viewerByList = classifyProjectForSync({ ownerUserId: OWNER, financialsLoaded: true, collaborators: [{ ...team[1], role: 'viewer' }] }, ME, null);
check('A-2: viewer per the legacy display list (no myRole) → no money either', viewerByList.sendMoney === false && viewerByList.financialsUserId === undefined);
const editorOverList = classifyProjectForSync({ ownerUserId: OWNER, myRole: 'editor', financialsLoaded: true, collaborators: [{ ...team[1], role: 'viewer' }] }, ME, null);
check('A-2: the server role wins — myRole "editor" sends money even though the display list says viewer', editorOverList.sendMoney === true && editorOverList.financialsUserId === OWNER);
const legacyListShared = classifyProjectForSync({ collaborators: team }, ME, 'me@example.com');
check('A-1: legacy display-list-only shared row (no owner id, no myRole) → no money on the PATCH, no financials write',
  legacyListShared.shared === true && legacyListShared.sendMoney === false && legacyListShared.financialsUserId === undefined);
const fieldFromListOnly = classifyProjectForSync({ ownerUserId: OWNER, collaborators: team }, 'user-foreman', 'foreman@example.com');
check('B-2: with no myRole the display list is still the legacy fallback for blinding', fieldFromListOnly.blinded === true && fieldFromListOnly.sendMoney === false);

// ── PRODUCT-F1 · earliestCoverageExpiry ─────────────────────────────────────
console.log('\nearliestCoverageExpiry (PRODUCT-F1):');
check('picks the earliest expiresAt', earliestCoverageExpiry([
  { type: 'general_liability', expiresAt: '2026-12-01' },
  { type: 'auto', expiresAt: '2026-10-01' },
  { type: 'workers_comp', expiresAt: '2027-01-15' },
]) === '2026-10-01');
check('normalises a full ISO timestamp to YYYY-MM-DD (what coi-expiry-watch compares against)',
  earliestCoverageExpiry([{ type: 'auto', expiresAt: '2026-10-01T00:00:00.000Z' }]) === '2026-10-01');
check('skips coverages with no / unparseable expiresAt',
  earliestCoverageExpiry([{ type: 'auto' }, { type: 'umbrella', expiresAt: 'soon' }, { type: 'auto', expiresAt: '2026-11-05' }]) === '2026-11-05');
check('no usable date → undefined (never blank an existing expiry)',
  earliestCoverageExpiry([{ type: 'auto' }]) === undefined && earliestCoverageExpiry([]) === undefined && earliestCoverageExpiry(undefined) === undefined);

// A6: the sub is covered until the LATEST of their certificates' (earliest-
// coverage) expiries — editing an older cert must not regress the date and
// deleting one must recompute from what is left.
console.log('\nsubCoiExpiryAcross (A6):');
const oldCert = { coverages: [{ type: 'general_liability' as const, expiresAt: '2026-06-30' }, { type: 'auto' as const, expiresAt: '2026-09-30' }] };
const newCert = { coverages: [{ type: 'general_liability' as const, expiresAt: '2027-06-30' }, { type: 'auto' as const, expiresAt: '2027-03-31' }] };
const undated = { coverages: [{ type: 'umbrella' as const }] };
check('one cert → its earliest coverage', subCoiExpiryAcross([oldCert]) === '2026-06-30');
check('two certs → the LATER certificate governs (each counted from its earliest coverage)', subCoiExpiryAcross([oldCert, newCert]) === '2027-03-31');
check('order-independent', subCoiExpiryAcross([newCert, oldCert]) === '2027-03-31');
check('editing the OLDER cert while the newer stays on file does not regress', subCoiExpiryAcross([{ coverages: [{ type: 'auto', expiresAt: '2026-01-15' }] }, newCert]) === '2027-03-31');
check('deleting the newer cert recomputes to the older one', subCoiExpiryAcross([oldCert]) === '2026-06-30');
check('a cert with no usable date is ignored, not treated as expired', subCoiExpiryAcross([undated, newCert]) === '2027-03-31');
check('no usable date anywhere → undefined (leave the hand-entered value alone)',
  subCoiExpiryAcross([undated]) === undefined && subCoiExpiryAcross([]) === undefined && subCoiExpiryAcross(undefined) === undefined);
check('full ISO timestamps normalise to YYYY-MM-DD', subCoiExpiryAcross([{ coverages: [{ type: 'auto', expiresAt: '2027-03-31T12:00:00.000Z' }] }]) === '2027-03-31');

// ── MONEY-F5 · shouldFlipInvoiceToPaid ──────────────────────────────────────
console.log('\nshouldFlipInvoiceToPaid (MONEY-F5):');
// The audit's worked case: $100,000 invoice, 10 % retention held, client pays
// the $90,000 they were asked for.
const retentionInv = { status: 'sent', totalDue: 100_000, amountPaid: 90_000, retentionAmount: 10_000, retentionReleased: 0 };
check('retention invoice paid net → flips (the gross gate never could)', shouldFlipInvoiceToPaid(retentionInv) === true);
check('1-cent tolerance: $89,999.995 still settles', shouldFlipInvoiceToPaid({ ...retentionInv, amountPaid: 89_999.995 }) === true);
check('short by 2 cents → does not flip', shouldFlipInvoiceToPaid({ ...retentionInv, amountPaid: 89_999.98 }) === false);
check('released retention flows back into the net payable → $90,000 no longer settles', shouldFlipInvoiceToPaid({ ...retentionInv, retentionReleased: 10_000 }) === false);
check('no retention: full amount settles', shouldFlipInvoiceToPaid({ status: 'partially_paid', totalDue: 40_000, amountPaid: 40_000 }) === true);
check('no retention: partial does not flip', shouldFlipInvoiceToPaid({ status: 'partially_paid', totalDue: 40_000, amountPaid: 39_000 }) === false);
check('draft never flips', shouldFlipInvoiceToPaid({ ...retentionInv, status: 'draft' }) === false);
check('already paid never re-flips', shouldFlipInvoiceToPaid({ ...retentionInv, status: 'paid' }) === false);
check('$0 invoice never flips on its own', shouldFlipInvoiceToPaid({ status: 'sent', totalDue: 0, amountPaid: 0 }) === false);
check('overpayment settles', shouldFlipInvoiceToPaid({ status: 'sent', totalDue: 1_000, amountPaid: 1_200 }) === true);

// Source pin: the context must route its flip through the pure helper and
// must not carry a gross totalDue comparison of its own.
const ctxSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'contexts', 'ProjectContext.tsx'), 'utf8')
  .split('\n').map(l => l.split('//')[0]).join('\n');
check('ProjectContext flips status through shouldFlipInvoiceToPaid(next)', /if \(shouldFlipInvoiceToPaid\(next\)\)/.test(ctxSrc));
check('ProjectContext no longer compares amountPaid against gross totalDue', !/amountPaid[^\n]*>=[^\n]*totalDue/.test(ctxSrc));

// ── MONEY-F1 · aia_pay_apps round trip ──────────────────────────────────────
console.log('\naia_pay_apps round trip (MONEY-F1):');
const app: SavedAIAPayApp = {
  id: 'aia-1', projectId: 'proj-1', invoiceId: 'inv-9',
  applicationNumber: 2, applicationDate: '2026-09-01', periodTo: '2026-08-31', contractDate: '2026-01-10',
  ownerName: 'Owner', contractorName: 'GC', architectName: 'Arch', projectName: 'Henderson', projectLocation: 'TX',
  contractForDescription: 'Remodel', originalContractSum: 550000, netChangeByCO: 12000, contractSumToDate: 562000,
  retainagePercent: 0, lessPreviousCertificates: 45000,
  lines: [{ id: 'l1', itemNo: '1', description: 'Demo', scheduledValue: 10000, fromPreviousApp: 5000, thisPeriod: 2500, materialsPresentlyStored: 0, retainagePercent: 0 }],
  notes: 'n',
  totals: { totalScheduledValue: 562000, totalCompletedAndStored: 220000, totalRetainage: 0, totalEarnedLessRetainage: 220000, currentPaymentDue: 175000, balanceToFinish: 342000, percentComplete: 39.1 },
  payLinkUrl: 'https://pay.example/x', payLinkId: 'plink_1',
  savedAt: '2026-09-01T12:00:00.000Z',
};
const row = savedToAiaRow(app, 'user-1');
check('writer sends totals as snapshot_totals (not the never-set snapshotTotals)', same(row.snapshot_totals, app.totals));
check('writer does NOT send pay_link_* until migration 20260904100100 is applied (an unknown column rejects the whole upsert and the queue retries forever)',
  !('pay_link_url' in row) && !('pay_link_id' in row) && !('pay_link_amount' in row));
check('writer does not send paid_at (owned by the Stripe webhook)', !('paid_at' in row));
check('writer does not own portal_state (the context layers it on, guarded by validate-portal-state-roundtrip)', !('portal_state' in row));
check('writer stamps user_id and project_id', row.user_id === 'user-1' && row.project_id === 'proj-1');
check('writer falls back to savedAt for created_at', row.created_at === app.savedAt);

const back = aiaRowToSaved(row as Record<string, unknown>);
check('reader restores totals from snapshot_totals', same(back.totals, app.totals));
check('reader keeps id / numbers / lines', back.id === 'aia-1' && back.applicationNumber === 2 && back.contractSumToDate === 562000 && same(back.lines, app.lines));
check('reader keeps a 0% retainage as 0 (same class as MONEY-F3)', back.retainagePercent === 0);
check('reader restores savedAt from created_at', back.savedAt === app.savedAt);

// A5: every pay app saved before the writer fix has snapshot_totals NULL. The
// reader recomputes from the lines — `priorAIA.totals?.totalEarnedLessRetainage
// ?? 0` would otherwise bill the client for everything again next period.
console.log('\naiaTotalsFromLines (A5):');
// Hand-computed: two lines, 10 % retainage on the first, 0 % on the second.
const aiaLines: SavedAIAPayApp['lines'] = [
  { id: 'l1', itemNo: '1', description: 'Demo', scheduledValue: 100_000, fromPreviousApp: 30_000, thisPeriod: 20_000, materialsPresentlyStored: 5_000, retainagePercent: 10 },
  { id: 'l2', itemNo: '2', description: 'Framing', scheduledValue: 200_000, fromPreviousApp: 0, thisPeriod: 40_000, materialsPresentlyStored: 0, retainagePercent: 0 },
];
const t = aiaTotalsFromLines(aiaLines, 312_000, 27_000);
check('totalScheduledValue = Σ scheduledValue', t.totalScheduledValue === 300_000);
check('totalCompletedAndStored = Σ (previous + this period + stored)', t.totalCompletedAndStored === 95_000);
check('totalRetainage = Σ (completed + stored) × line retainage %', t.totalRetainage === 5_500);
check('totalEarnedLessRetainage = completed − retainage', t.totalEarnedLessRetainage === 89_500);
check('currentPaymentDue = earned − less previous certificates', t.currentPaymentDue === 62_500);
check('balanceToFinish = contract sum to date − earned', t.balanceToFinish === 222_500);
check('percentComplete = completed / scheduled × 100', Math.abs(t.percentComplete - (95_000 / 300_000) * 100) < 1e-9);
check('numeric-as-string cells (PostgREST jsonb round trip) are coerced', aiaTotalsFromLines([{ ...aiaLines[0], thisPeriod: '20000' as unknown as number }], 312_000, 27_000).totalCompletedAndStored === 95_000 - 40_000);
check('no lines → all-zero totals, percentComplete 0 (no divide-by-zero)', same(aiaTotalsFromLines([], 0, 0), { totalScheduledValue: 0, totalCompletedAndStored: 0, totalRetainage: 0, totalEarnedLessRetainage: 0, currentPaymentDue: 0, balanceToFinish: 0, percentComplete: 0 }));
check('matches the totals the writer snapshots for the round-trip app (same formula as utils/aiaBilling computeAIATotals)',
  (() => {
    const r = aiaTotalsFromLines(app.lines, app.contractSumToDate, app.lessPreviousCertificates);
    // app.lines: one line 10000 SV, 5000 prev + 2500 this, 0 stored, 0 % retainage.
    return r.totalScheduledValue === 10_000 && r.totalCompletedAndStored === 7_500 && r.totalRetainage === 0
      && r.totalEarnedLessRetainage === 7_500 && r.currentPaymentDue === 7_500 - 45_000 && r.balanceToFinish === 562_000 - 7_500;
  })());
const repaired = aiaRowToSaved({ ...row, snapshot_totals: null } as Record<string, unknown>);
check('reader: NULL snapshot_totals → totals RECOMPUTED from lines (never undefined, never a throw)',
  repaired.totals != null && repaired.totals.totalEarnedLessRetainage === 7_500 && repaired.totals.currentPaymentDue === 7_500 - 45_000);
check('reader: a stored snapshot is used verbatim, not recomputed', same(back.totals, app.totals));
check('reader: NULL lines and NULL snapshot → zero totals, not a throw', aiaRowToSaved({ ...row, lines: null, snapshot_totals: null } as Record<string, unknown>).totals.totalScheduledValue === 0);
const hydrated = aiaRowToSaved({ ...row, pay_link_url: 'https://pay.example/y', pay_link_id: 'plink_2', pay_link_amount: '175000', paid_at: '2026-09-03T10:00:00.000Z' } as Record<string, unknown>);
check('reader maps pay_link_url / pay_link_id defensively once the columns exist', hydrated.payLinkUrl === 'https://pay.example/y' && hydrated.payLinkId === 'plink_2');
check('reader maps pay_link_amount as a number', hydrated.payLinkAmount === 175000);
check('reader maps paid_at → paidAt', hydrated.paidAt === '2026-09-03T10:00:00.000Z');
check('reader: absent pay link columns → undefined, not null', back.payLinkUrl === undefined && back.payLinkId === undefined && back.paidAt === undefined);

// ── Source pins · the context must actually route through the helpers ───────
// Text pins on code with comments blanked. Each one names the regression it
// stops; a failing pin means the wiring was undone, not that the helper broke.
console.log('\nsource pins (review items 1-3, A3, A4, A6-A10; B-1, B-2, B-3, A-1, A-2, A-3, A-8):');
const ctx = codeOnly('contexts/ProjectContext.tsx');
const types = codeOnly('types/index.ts');

// Item 1 — a shared (collaborator-edited) row is PATCHed, never upserted
// without its NOT NULL user_id; project_financials carries the OWNER's id.
check("ProjectContext writes a shared project with the 'update' operation", /supabaseWrite\(\s*'projects'\s*,\s*'update'/.test(ctx));
check('ProjectContext still upserts an OWNED project', /supabaseWrite\(\s*'projects'\s*,\s*'upsert'/.test(ctx));
check('no write drops user_id for a shared row (the 23502 that locked editors out)', !/shared\s*\?\s*\{\}\s*:\s*\{\s*user_id/.test(ctx));
check("project_financials carries the classification's financialsUserId (the OWNER's id for a shared row)",
  /const \{ shared, sendMoney, financialsUserId \} = classifyProjectForSync\(project, userId, userEmail\);/.test(ctx) && /project_id: project\.id, user_id: financialsUserId,/.test(ctx));
check('project_financials stays an upsert (PK is project_id; the queue\'s update targets id)', /supabaseWrite\(\s*'project_financials'\s*,\s*'upsert'/.test(ctx) && !/supabaseWrite\(\s*'project_financials'\s*,\s*'update'/.test(ctx));

// Item 2 — ownership/blinding come from the project, not from a load-time set.
check('loader stamps ownerUserId from projects.user_id', /ownerUserId:\s*\(r\.user_id as string \| null\)\s*\?\?\s*undefined/.test(ctx));
check('Project type carries ownerUserId', /ownerUserId\?:\s*string;/.test(types));
check('sync path classifies from the project (classifyProjectForSync)', /classifyProjectForSync\(project,\s*userId,\s*userEmail\)/.test(ctx));
check('the load-time shared/blinded id sets are gone', !/sharedProjectIdsRef|blindedProjectIdsRef/.test(ctx));
check('blinded is never derived from a missing financials row', !/!owned\s*&&\s*!f/.test(ctx));

// Item 3 — invoice hydration keeps the minted pay-link amount.
check('invoice hydration reads pay_link_amount → payLinkAmount', /payLinkAmount:\s*r\.pay_link_amount == null \? undefined : Number\(r\.pay_link_amount\)/.test(ctx));

// A3 — the debounced entry outlives the write; released once, identity-checked.
const releases = ctx.match(/syncDebounceMap\.current\.delete\(project\.id\)/g) ?? [];
check('the pending sync slot is released exactly once, after the write, identity-checked',
  releases.length === 1 && /if \(syncDebounceMap\.current\.get\(project\.id\) === entry\) syncDebounceMap\.current\.delete\(project\.id\)/.test(ctx));
check('the release sits in a finally (a thrown write still frees the slot)', /\} finally \{\s*if \(syncDebounceMap\.current\.get\(project\.id\) === entry\)/.test(ctx));

// A4 — discards are reconciled from the queue-change signal.
check('ProjectContext subscribes to onQueueChanged and diffs pending ids', /onQueueChanged\(/.test(ctx) && /vanishedPendingIds\(/.test(ctx) && /pendingIdsByTable\(/.test(ctx));

// B-1 — a failed financials read is told apart from "no rows": the cached
// money stays for display, financialsLoaded is stamped, and the shared PATCH
// carries money only under sendMoney (project_financials only with an id).
check('B-1 loader: finReadOk flips true only when the SELECT returned no error',
  /let finReadOk = false;/.test(ctx) && /if \(finError\) \{[\s\S]{0,400}?\} else \{\s*finReadOk = true;/.test(ctx));
check('B-1 loader: every money pick routes through financialPickAfterLoad with the cached value',
  /financialPickAfterLoad\(f, key, legacy, owned, finReadOk, cachedValue, displayRole\)/.test(ctx)
  && /pick\('estimate', r\.estimate, cached\?\.estimate\)/.test(ctx)
  && /pick\('linked_estimate', r\.linked_estimate, cached\?\.linkedEstimate\)/.test(ctx)
  && /pick\('estimate_versions', r\.estimate_versions, cached\?\.estimateVersions\)/.test(ctx)
  && /pick\('target_budget', r\.target_budget, cached\?\.targetBudget\)/.test(ctx));
check('B-1 / B-3 loader: stamps financialsLoaded via financialsLoadedFor, legacy money included',
  /financialsLoaded: financialsLoadedFor\(\{ owned, hasRow: !!f, readSucceeded: finReadOk, myRole, legacyHasMoney \}\)/.test(ctx));
check('B-3 loader: legacy money is read off the projects row through legacyMoneyPresent', /const legacyHasMoney = legacyMoneyPresent\(r\);/.test(ctx));
check('B-3 loader: the display-fallback role is the FRESH server role only (never the cache)', /const displayRole = rolesReadOk \? myRole : undefined;/.test(ctx));
check('B-1 loader: the device copy is read ONCE — per-project stamps come from it and local-only rows merge from it',
  /const localById = new Map\(localForMerge\.map\(\(p\) => \[p\.id, p\] as const\)\);/.test(ctx)
  && /const merged = \[\.\.\.mapped, \.\.\.localForMerge\.filter\(\(p\) => !remoteIds\.has\(p\.id\)\)\];/.test(ctx));
check('Project type carries myRole and financialsLoaded', /myRole\?:\s*ProjectCollaborator\['role'\];/.test(types) && /financialsLoaded\?:\s*boolean;/.test(types));
const classifyAt = ctx.indexOf('classifyProjectForSync(project, userId, userEmail)');
const baseStart = classifyAt >= 0 ? ctx.indexOf('const base = {', classifyAt) : -1;
const baseBlock = baseStart >= 0 ? ctx.slice(baseStart, ctx.indexOf('};', baseStart)) : '';
check('B-1 sync: the shared PATCH base carries no money column', baseStart >= 0 && !/\b(estimate|linked_estimate|estimate_versions|target_budget):/.test(baseBlock));
check('B-1 sync: the shared PATCH adds the four money columns ONLY under sendMoney',
  /supabaseWrite\(\s*'projects'\s*,\s*'update'\s*,\s*\{\s*\.\.\.base,\s*\.\.\.\(sendMoney \? \{\s*estimate: project\.estimate as unknown,\s*linked_estimate: project\.linkedEstimate as unknown,\s*estimate_versions: project\.estimateVersions as unknown,\s*target_budget: project\.targetBudget as unknown,\s*\} : \{\}\),\s*\}\)/.test(ctx));
check('B-1 / A-1 sync: the project_financials write is gated on financialsUserId (undefined = blinded, not loaded, or owner unknown)',
  /if \(financialsUserId && \(landed \|\| \(await queuedIdsFor\('projects'\)\)\.has\(project\.id\)\)\) \{\s*await supabaseWrite\(\s*'project_financials'\s*,\s*'upsert'/.test(ctx));

// B-2 — the caller's role comes from their OWN project_collaborators rows.
check("B-2 loader: reads the caller's own project_collaborators rows (pc_invitee_read)",
  /\.from\('project_collaborators'\)\s*\.select\('project_id, role, status'\)\s*\.eq\('user_id', userId\)/.test(ctx));
check('B-2 loader: accepted rows only, a failed read keeps the cached stamp (myRoleAfterLoad)',
  /let rolesReadOk = false;/.test(ctx)
  && /acceptedRolesByProject\(pcRows as CollaboratorRowLike\[\] \| null\)/.test(ctx)
  && /const myRole = myRoleAfterLoad\(rolesReadOk, roleById\.get\(r\.id as string\), cached\?\.myRole\);/.test(ctx));
check('B-2 loader: stamps myRole on every mapped project, next to ownerUserId', /ownerUserId: \(r\.user_id as string \| null\) \?\? undefined,\s*myRole,\s*financialsLoaded:/.test(ctx));

// A-1 — every creation path stamps the creator as owner, so "no ownerUserId"
// can only be a cache that predates the field (written back base-only).
check('A-1: addProject claims the project for the signed-in user (ownerUserId stamped, loader stamps dropped)',
  /const addProject = useCallback\(\(incoming: Project\) => \{\s*const project = claimProjectForUser\(incoming, userId\);/.test(ctx));
check('A-1: importData claims every imported project', /\.filter\(p => p\.id && !have\.has\(p\.id\)\)\.map\(p => claimProjectForUser\(p, userId\)\)/.test(ctx));
check('A-1: convertLeadToProject stamps ownerUserId on the new project', /const newProject: Project = \{\s*id: projectId,\s*ownerUserId: userId \?\? undefined,/.test(ctx));
check('A-1: no creation path bypasses the stamp — addProject is the only place a caller-built Project enters the list',
  (ctx.match(/setProjects\(\[project, \.\.\.projects\]\)|const updated = \[project, \.\.\.projects\];/g) ?? []).length === 1);

// A-8 — an in-flight debounced sync is never re-issued; the post-discard
// settle timer restarts on a vanish only.
check('A-8: a pending sync marks itself inFlight the moment it runs', /inFlight: boolean; run: \(\) => Promise<void> \}/.test(ctx) && /entry\.inFlight = true;/.test(ctx));
check('A-8: flushPendingProjectSyncs skips in-flight entries instead of re-issuing their write',
  /const flushPendingProjectSyncs = useCallback\(async \(\): Promise<void> => \{[\s\S]*?if \(p\.inFlight\) continue;/.test(ctx));
check('A-8: the settle timer restarts on a VANISH only',
  /const gone = vanishedPendingIds\(prior, next\);\s*if \(gone\.size === 0\) return;[\s\S]{0,300}?if \(settleTimer\) clearTimeout\(settleTimer\);\s*settleTimer = setTimeout\(settle, 1_500\);/.test(ctx));

// A6 — the sub's coiExpiry is recomputed across all their certs on add/edit/delete.
// add (1) + update (2: the cert's sub, and the previous sub when re-filed) + delete (1).
check('COI paths recompute across the sub\'s certificates', (ctx.match(/syncSubCoiExpiry\(/g) ?? []).length >= 4 && /subCoiExpiryAcross\(/.test(ctx));
check('deleteCOI recomputes too', /const deleteCOI[\s\S]*?syncSubCoiExpiry\(removed\?\.subcontractorId, updated, false\)/.test(ctx));

// A7 — the lead-conversion financials write is gated on the project insert.
check('convertLeadToProject captures the project insert outcome', /const landed = await supabaseWrite\(\s*'projects'\s*,\s*'insert'/.test(ctx));
check('…and gates the project_financials upsert on it (queued still proceeds)', /targetBudget && \(landed \|\| \(await queuedIdsFor\('projects'\)\)\.has\(projectId\)\)/.test(ctx));

// A8 — no client-side tax-rate fallback of 7.5 anywhere; the default is 0.
check('DEFAULT_SETTINGS.taxRate is 0', /taxRate:\s*0,/.test(ctx));
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(rel, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out;
}
const taxFallbackHits: string[] = [];
for (const file of ['app', 'utils', 'contexts', 'hooks'].flatMap(d => walk(d))) {
  const lines = codeOnly(file).split('\n');
  lines.forEach((line, i) => {
    if (/(\?\?|\|\|)\s*7\.5\b/.test(line) || /tax\w*\s*[=:]\s*7\.5\b/i.test(line) || /\b7\.5\b[^\n]*\btax/i.test(line)) {
      taxFallbackHits.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}
check('no `?? 7.5` / `|| 7.5` / tax-rate 7.5 literal survives in app/ utils/ contexts/ hooks/ (comments excluded)',
  taxFallbackHits.length === 0, taxFallbackHits.join('\n      '));
for (const f of ['app/invoice.tsx', 'app/bill-from-estimate.tsx', 'app/change-order.tsx']) {
  check(`${f} falls back to settings.taxRate ?? 0`, /settings\.taxRate \?\? 0\b/.test(codeOnly(f)) && !/7\.5/.test(codeOnly(f)));
}

// A9 — gestureEnabled:false screens use the safe back (cold-start deep links).
for (const f of ['app/quick-quote.tsx', 'app/judges.tsx']) {
  const src = codeOnly(f);
  check(`${f} has no router.back() and uses useSafeBack`, !/router\.back\(\)/.test(src) && /useSafeBack\(\)/.test(src));
}

// A10 — the magic-link path decides the tenant handoff BEFORE setSession.
const layout = codeOnly('app/_layout.tsx');
const auth = codeOnly('contexts/AuthContext.tsx');
const magic = layout.slice(layout.indexOf('function MagicLinkHandler'), layout.indexOf('function MagicLinkHandler') + 4000);
check('MagicLinkHandler calls beginSessionFromToken before supabase.auth.setSession',
  magic.indexOf('beginSessionFromToken(accessToken)') > 0 && magic.indexOf('beginSessionFromToken(accessToken)') < magic.indexOf('supabase.auth.setSession('));
check('…and hands the verdict to onNewSessionEstablished', /onNewSessionEstablished\(handoff\)/.test(magic));
check('AuthContext.beginSessionFromToken decodes the token, then flushes THEN wipes (pre-session) for another user',
  /const beginSessionFromToken = useCallback\(async \(accessToken[\s\S]*?decodeJwtClaims\(accessToken\)[\s\S]*?beginSignIn\([\s\S]*?if \(!handoff\.sameUser\) \{\s*await flushQueuesBeforeSignOut\(\);\s*await wipeLocalUserCache\(PRE_SESSION_WIPE\);/.test(auth));
check('AuthContext exports beginSessionFromToken on the context value', /beginSessionFromToken,\s*onNewSessionEstablished,/.test(auth));

// A-3 — a marker-less install that a DIFFERENT user signs into keeps only the
// queue entries tagged for that user: an untagged entry would be adopted by
// the marker written right after, and may be another tenant's write.
// A MISSING handoff must count as not-same-user: the web password-reset path
// redeems its token through supabase-js and reaches here with no handoff, and
// the earlier `handoff && !handoff.sameUser` shape let it keep the whole queue.
check('A-3: the keep-queue branch keys on last === null and a not-same-user OR ABSENT handoff',
  /last === null && incoming && !handoff\?\.sameUser/.test(auth));
// The narrowing lives in the queue modules, under each queue's own lock — an
// unlocked AsyncStorage.setItem here raced the flush's write-back both ways.
check('A-3: …and narrows both persisted queues to entries tagged for the incoming user, under their locks',
  /retainOfflineQueueForUser\(incomingId\),\s*retainPhotoUploadQueueForUser\(incomingId\),/.test(auth)
  && /keepQueue = text\.kept > 0 \|\| photos\.kept > 0;/.test(auth)
  && !/AsyncStorage\.setItem\('mageid_offline_queue'/.test(auth));
check('A-3: a narrowing failure drops the queue (the safe direction), never keeps it whole', /Failed to narrow the offline queue[\s\S]{0,200}?keepQueue = false;/.test(auth));

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
  console.error('\n✗ validate-project-context-pure: FAILED');
  process.exit(1);
}
console.log('✓ validate-project-context-pure: all checks passed');
