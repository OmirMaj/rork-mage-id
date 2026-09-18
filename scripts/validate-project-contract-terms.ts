// validate-project-contract-terms.ts — contract mode, GMP cap, fee and
// retainage must survive a server load, reach the server, and agree with the
// database about what a legal value is.
//
// WHY THIS EXISTS. Project.contractMode / gmpCap / contractorFeePercent /
// contractorFeeAmount were declared in types/index.ts and READ by two shipped
// surfaces (utils/portalSnapshot.ts's open-book block, utils/wip.ts's "GMP cap
// you entered in project setup" contract fallback), but had no column, no
// payload entry, no mapper line and no screen. Project.retainagePercent had a
// setter (the invoice's retainage ask) and the same missing plumbing, so the
// next fetch threw the GC's answer away. 20260917110000_project_contract_terms
// .sql adds the columns on project_financials; this guard pins the four places
// that have to stay in step:
//
//   1. PARITY   the migration's CHECK constraints == CONTRACT_MODES and
//               CONTRACT_TERM_RANGES (a value the app accepts but the DB
//               rejects is TERMINAL in the offline queue and drops the whole
//               project_financials upsert — the estimate in it included), and
//               the columns land on project_financials, never on projects
//               (a 'field' foreman can read the projects row).
//   2. LOAD     contractTermsAfterLoad — the server wins only where it can
//               vouch for a value; a queued edit, a failed read, a missing
//               column or a missing row carries the device copy forward.
//   3. SYNC     contractTermsSyncColumns — a held term always goes; an empty
//               term goes as NULL only after the device has seen the server's
//               terms, so a device that never loaded them cannot wipe them.
//   4. WIRING   ProjectContext calls both helpers at the right sites (and the
//               projects writes carry none of the columns); project-detail's
//               edit modal writes through the range-checked patch, hides the
//               block from a field role, and says when the portal breakdown
//               has no commitments to show.
//
// Run via: bun run scripts/validate-project-contract-terms.ts
// Overridable paths (PCT_MIGRATION / PCT_CONTEXT / PCT_DETAIL) so the guard
// can be negative-tested against a mutated copy.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CONTRACT_MODES,
  CONTRACT_TERM_COLUMNS,
  CONTRACT_TERM_RANGES,
  contractTermsAfterLoad,
  contractTermsSyncColumns,
  type LoadedContractTerms,
} from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATION = process.env.PCT_MIGRATION || join(ROOT, 'supabase/migrations/20260917110000_project_contract_terms.sql');
const CONTEXT = process.env.PCT_CONTEXT || join(ROOT, 'contexts/ProjectContext.tsx');
const DETAIL = process.env.PCT_DETAIL || join(ROOT, 'app/project-detail.tsx');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail = '') {
  if (cond) { passes++; return; }
  failures++;
  console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}
const j = (v: unknown) => JSON.stringify(v);

// ─── 1. PARITY ───────────────────────────────────────────────────────────────
const sql = readFileSync(MIGRATION, 'utf8');
// Comment lines carry prose that names columns and values; parse code only.
const code = sql.split('\n').map(l => l.replace(/--.*$/, '')).join('\n');

const modeCheck = code.match(/contract_mode\s+in\s*\(([^)]*)\)/i);
check('migration has a contract_mode IN (...) check', !!modeCheck);
if (modeCheck) {
  const sqlModes = [...modeCheck[1].matchAll(/'([^']+)'/g)].map(m => m[1]).sort();
  check('contract_mode CHECK == CONTRACT_MODES', j(sqlModes) === j([...CONTRACT_MODES].sort()), `${j(sqlModes)} vs ${j([...CONTRACT_MODES].sort())}`);
}

for (const [key, range] of Object.entries(CONTRACT_TERM_RANGES)) {
  const col = CONTRACT_TERM_COLUMNS[key as keyof typeof CONTRACT_TERM_COLUMNS];
  const min = code.match(new RegExp(`\\b${col}\\s*>=\\s*(-?[\\d.]+)`));
  check(`${col}: CHECK has a lower bound`, !!min);
  if (min) check(`${col}: lower bound ${min[1]} == ${range.min}`, Number(min[1]) === range.min);
  const max = code.match(new RegExp(`\\b${col}\\s*<=\\s*(-?[\\d.]+)`));
  if (Number.isFinite(range.max)) {
    check(`${col}: CHECK has an upper bound`, !!max);
    if (max) check(`${col}: upper bound ${max[1]} == ${range.max}`, Number(max[1]) === range.max);
  } else {
    check(`${col}: no upper bound in SQL (none in TS)`, !max, max?.[0]);
  }
}

const altered = [...code.matchAll(/alter\s+table\s+(?:public\.)?(\w+)/gi)].map(m => m[1]);
check('migration only alters project_financials', altered.length > 0 && altered.every(t => t === 'project_financials'), j(altered));
for (const col of Object.values(CONTRACT_TERM_COLUMNS)) {
  check(`migration adds ${col}`, new RegExp(`add\\s+column\\s+if\\s+not\\s+exists\\s+${col}\\b`, 'i').test(code));
}
check('every add column is idempotent (if not exists)', !/add\s+column\s+(?!if\s+not\s+exists)/i.test(code));
check('header says the migration must land BEFORE the OTA', /BEFORE THE OTA/i.test(sql));

// ─── 2. LOAD ─────────────────────────────────────────────────────────────────
const cachedTerms: LoadedContractTerms = {
  contractMode: 'gmp', gmpCap: 1_400_000, contractorFeePercent: 12, retainagePercent: 10, retainagePercentAssumed: true,
  contractTermsLoaded: true,
};
const fullRow = {
  project_id: 'p1', contract_mode: 'cost_plus', gmp_cap: null, contractor_fee_percent: 15,
  contractor_fee_amount: null, retainage_percent: 5, retainage_percent_assumed: false,
};
const base = { readSucceeded: true, canViewMoney: true, writePending: false };

let out = contractTermsAfterLoad({ ...base, finRow: fullRow, cached: cachedTerms });
check('row with every column → server values', out.contractMode === 'cost_plus' && out.contractorFeePercent === 15 && out.retainagePercent === 5 && out.retainagePercentAssumed === false, j(out));
check('row with every column → server NULL clears the cached cap', out.gmpCap === undefined, j(out));
check('row with every column → stamped loaded', out.contractTermsLoaded === true, j(out));

out = contractTermsAfterLoad({ ...base, finRow: { project_id: 'p1', target_budget: null }, cached: cachedTerms });
check('pre-migration row (no columns) → cached terms carried', out.contractMode === 'gmp' && out.gmpCap === 1_400_000 && out.retainagePercent === 10 && out.retainagePercentAssumed === true, j(out));
check('pre-migration row → NOT stamped loaded', out.contractTermsLoaded !== true, j(out));

const partial: Record<string, unknown> = { ...fullRow };
delete partial.retainage_percent;
out = contractTermsAfterLoad({ ...base, finRow: partial, cached: cachedTerms });
check('one column missing → that term carried from cache, others from server', out.retainagePercent === 10 && out.contractMode === 'cost_plus', j(out));
check('one column missing → not stamped', out.contractTermsLoaded !== true, j(out));

out = contractTermsAfterLoad({ ...base, readSucceeded: false, finRow: undefined, cached: cachedTerms });
check('financials read FAILED → cached terms + cached stamp', out.gmpCap === 1_400_000 && out.retainagePercent === 10 && out.contractTermsLoaded === true, j(out));

out = contractTermsAfterLoad({ ...base, writePending: true, finRow: fullRow, cached: cachedTerms });
check('edit still queued → device copy beats the stale server row', out.contractMode === 'gmp' && out.gmpCap === 1_400_000 && out.retainagePercent === 10, j(out));

const onlyRetainage: LoadedContractTerms = { retainagePercent: 10, retainagePercentAssumed: false };
out = contractTermsAfterLoad({ ...base, finRow: undefined, cached: onlyRetainage });
check('read OK, no row, may see money → retainage answer carried (not wiped)', out.retainagePercent === 10 && out.retainagePercentAssumed === false, j(out));
check('read OK, no row → NOT stamped (would null six unmigrated columns)', out.contractTermsLoaded !== true, j(out));

out = contractTermsAfterLoad({ ...base, canViewMoney: false, finRow: undefined, cached: cachedTerms });
check('read OK, no row, field / unknown role → holds no money', Object.values(out).every(v => v === undefined), j(out));

out = contractTermsAfterLoad({
  ...base, cached: undefined,
  finRow: { ...fullRow, contract_mode: 'lump_sum', contractor_fee_percent: 150, gmp_cap: '1250000.50', retainage_percent: -1, retainage_percent_assumed: 'yes' },
});
check('illegal server values are dropped, numeric strings parsed', out.contractMode === undefined && out.contractorFeePercent === undefined && out.gmpCap === 1_250_000.5 && out.retainagePercent === undefined && out.retainagePercentAssumed === undefined, j(out));

// ─── 3. SYNC ─────────────────────────────────────────────────────────────────
let cols = contractTermsSyncColumns({});
check('nothing held, never loaded → no column at all', j(cols) === '{}', j(cols));

cols = contractTermsSyncColumns({ retainagePercent: 10, retainagePercentAssumed: false });
check('unloaded device sends only the terms it holds', j(Object.keys(cols).sort()) === j(['retainage_percent', 'retainage_percent_assumed']) && cols.retainage_percent === 10 && cols.retainage_percent_assumed === false, j(cols));

cols = contractTermsSyncColumns({ contractMode: 'fixed', contractTermsLoaded: true });
const allCols = Object.values(CONTRACT_TERM_COLUMNS).sort();
check('loaded device sends every column', j(Object.keys(cols).sort()) === j(allCols), j(cols));
check('loaded device sends a cleared term as NULL', cols.gmp_cap === null && cols.contractor_fee_percent === null && cols.contract_mode === 'fixed', j(cols));

cols = contractTermsSyncColumns({ retainagePercent: 0 });
check('a real 0% retainage is sent as 0, not dropped', cols.retainage_percent === 0, j(cols));

// Round trip: what a loaded device writes, the next load reads back.
const roundTrip = contractTermsAfterLoad({ ...base, cached: undefined, finRow: { project_id: 'p1', ...contractTermsSyncColumns({ contractMode: 'gmp', gmpCap: 900_000, contractorFeeAmount: 40_000, contractTermsLoaded: true }) } });
check('sync → load round trip', roundTrip.contractMode === 'gmp' && roundTrip.gmpCap === 900_000 && roundTrip.contractorFeeAmount === 40_000 && roundTrip.contractorFeePercent === undefined && roundTrip.contractTermsLoaded === true, j(roundTrip));

// ─── 4. WIRING ───────────────────────────────────────────────────────────────
const ctx = readFileSync(CONTEXT, 'utf8');
const loaderCall = ctx.match(/\.\.\.contractTermsAfterLoad\(\{([\s\S]*?)\}\)/);
check('ProjectContext mapper spreads contractTermsAfterLoad', !!loaderCall);
if (loaderCall) {
  check('mapper passes the financials row + read result', /finRow:\s*f\b/.test(loaderCall[1]) && /readSucceeded:\s*finReadOk\b/.test(loaderCall[1]), loaderCall[1]);
  check('mapper passes the cached device copy', /\bcached\b/.test(loaderCall[1]), loaderCall[1]);
  check('mapper passes writePending from the queued projects ids', /writePending:\s*pendingProjectIds\.has\(/.test(loaderCall[1]), loaderCall[1]);
  check('mapper blinds a field role from cached money', /canViewMoney:[^\n]*isFinancialsBlinded/.test(loaderCall[1]), loaderCall[1]);
}
check('pendingProjectIds comes from queuedIdsFor(\'projects\')', /pendingProjectIds\s*=\s*await\s+queuedIdsFor\('projects'\)/.test(ctx));

// Argument block of each supabaseWrite(<table>, ...) call.
function writeBlocks(table: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`supabaseWrite\\(\\s*'${table}'\\s*,`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx))) {
    let depth = 0;
    let i = m.index + 'supabaseWrite'.length;
    const start = i;
    for (; i < ctx.length; i++) {
      if (ctx[i] === '(') depth++;
      else if (ctx[i] === ')') { depth--; if (depth === 0) break; }
    }
    blocks.push(ctx.slice(start, i + 1));
  }
  return blocks;
}
const finWrites = writeBlocks('project_financials');
const syncFin = finWrites.filter(b => /estimate_versions:/.test(b) && /updated_at:\s*project\.updatedAt/.test(b));
check('the sync-path project_financials upsert exists', syncFin.length === 1, `found ${syncFin.length}`);
check('sync-path project_financials upsert spreads contractTermsSyncColumns(project)', syncFin.every(b => /\.\.\.contractTermsSyncColumns\(project\)/.test(b)));
const termColRe = new RegExp(`\\b(${Object.values(CONTRACT_TERM_COLUMNS).join('|')})\\s*:|contractTermsSyncColumns`);
const projWrites = writeBlocks('projects');
check('found the projects writes', projWrites.length >= 2, `found ${projWrites.length}`);
check('no projects write carries a contract term (field can read that row)', projWrites.every(b => !termColRe.test(b)));
// The `base` object spread into both projects writes.
const baseObj = ctx.match(/const base = \{([\s\S]*?)\n\s*\};/);
check('the shared `base` projects payload carries no contract term', !!baseObj && !termColRe.test(baseObj[1]));

const detail = readFileSync(DETAIL, 'utf8');
const save = detail.match(/const handleSaveEdit = useCallback\(\(\) => \{([\s\S]*?)\n  \}, \[/);
check('project-detail handleSaveEdit found', !!save);
if (save) {
  check('handleSaveEdit writes the range-checked contract patch', /buildContractPatch\(\)/.test(save[1]) && /\.\.\.contractPatch/.test(save[1]));
  check('handleSaveEdit refuses to save an out-of-range term', /'error' in built[\s\S]*?return;/.test(save[1]));
  check('handleSaveEdit skips the terms when hidden or locked', /!contractAccess\.hidden && !contractAccess\.lockedReason/.test(save[1]));
}
check('edit modal validates against CONTRACT_TERM_RANGES', /CONTRACT_TERM_RANGES\.gmpCap/.test(detail) && /CONTRACT_TERM_RANGES\.retainagePercent/.test(detail) && /CONTRACT_TERM_RANGES\.contractorFeePercent/.test(detail));
check('edit modal hides the block from a money-blinded role', /const role = pricingRoleFor\(project\.myRole \?\? null, project\.ownerUserId, authUser\?\.id\);\s*if \(isFinancialsBlinded\(role\)\)/.test(detail) && /\{!contractAccess\.hidden && \(/.test(detail));
check('…and locks it (fail-closed, with the reason) while the role is unconfirmed', /if \(!canViewFinancials\(role\)\) return \{ hidden: false, lockedReason: "Your access to this job hasn't been confirmed/.test(detail));
check('edit modal says when the portal breakdown has no commitments', /portalShowsCost && projectCommitments\.length === 0/.test(detail));
check('edit modal mode picker iterates CONTRACT_MODES', /CONTRACT_MODES\.map\(/.test(detail));

console.log(`\nvalidate-project-contract-terms: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
