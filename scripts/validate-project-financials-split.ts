// validate-project-financials-split.ts — the money must not drift back onto
// the projects row.
//
// WHY THIS EXISTS. 20260826140000_project_financials_split.sql moves estimate /
// linked_estimate / estimate_versions / target_budget off `projects` and into
// `project_financials`, which 'field' collaborators cannot read. Postgres RLS
// is row-level, so this SPLIT is the only way to keep a foreman out of the
// margin while still letting them read projects.schedule.
//
// The split only holds if every write path keeps both sides in step. During the
// dual-write window a site that writes the legacy columns but forgets
// project_financials silently strands that project's money on the old row —
// and then the phase-2 drop migration deletes it. This guard makes that
// impossible to introduce quietly.
//
// THE RULE. In contexts/ProjectContext.tsx, every supabaseWrite to 'projects'
// that carries a financial column must be accompanied by a supabaseWrite to
// 'project_financials' within the same block.
//
// Run via: bun run test:project-financials-split

import { readFileSync } from 'fs';

// Overridable so the guard itself can be negative-tested against a mutated
// copy — a guard that has never failed is an unverified guard.
const FILE = process.env.PFS_FILE || 'contexts/ProjectContext.tsx';
const FINANCIAL_COLS = ['estimate:', 'linked_estimate:', 'estimate_versions:', 'target_budget:'];

const src = readFileSync(FILE, 'utf8');
const lines = src.split('\n');

let failures = 0;
function fail(msg: string) {
  console.error(`  FAIL: ${msg}`);
  failures++;
}

// Find every supabaseWrite('projects', ...) call and capture its argument block.
interface Site { line: number; body: string; op: string }
const sites: Site[] = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/supabaseWrite\(\s*'projects'\s*,\s*'(\w+)'/);
  if (!m) continue;
  let depth = 0;
  let body = '';
  for (let j = i; j < Math.min(lines.length, i + 45); j++) {
    body += lines[j] + '\n';
    depth += (lines[j].match(/\(/g) ?? []).length;
    depth -= (lines[j].match(/\)/g) ?? []).length;
    if (depth <= 0 && j > i) break;
  }
  sites.push({ line: i + 1, body, op: m[1] });
}

if (sites.length === 0) fail(`no supabaseWrite('projects', ...) call found — did the file move?`);

for (const s of sites) {
  if (s.op === 'delete') continue; // cascade handles the child row
  const carries = FINANCIAL_COLS.filter(c => s.body.includes(c));
  if (carries.length === 0) continue;

  // Look for the paired project_financials write in the following ~30 lines.
  const after = lines.slice(s.line - 1, s.line + 45).join('\n');
  if (!/supabaseWrite\(\s*'project_financials'/.test(after)) {
    fail(
      `${FILE}:${s.line} writes financial column(s) [${carries.join(' ')}] to 'projects' ` +
      `with no paired project_financials write. That money is stranded on the legacy row and the ` +
      `phase-2 drop migration will delete it.`,
    );
  }
}

// The read path must prefer the new table, not silently read only legacy.
if (!/from\(\s*'project_financials'\s*\)/.test(src)) {
  fail(`${FILE} never SELECTs project_financials — the read path would show no money after the phase-2 drop.`);
}

// Both migrations must exist and stay in the intended order.
const split = 'supabase/migrations/20260826140000_project_financials_split.sql';
// Phase 2 is parked under held/ until the OTA is verified (see held/README.md).
const drop = 'supabase/migrations/held/20260827120000_project_financials_drop_legacy.sql';
for (const f of [split, drop]) {
  try { readFileSync(f, 'utf8'); } catch { fail(`missing migration ${f}`); }
}
try {
  const dropSrc = readFileSync(drop, 'utf8');
  if (!/REFUSING TO DROP/.test(dropSrc)) {
    fail(`${drop} lost its orphan guard — it could drop a column that was the only copy.`);
  }
  if (!/drop column if exists estimate\b/.test(dropSrc)) {
    fail(`${drop} no longer drops the legacy estimate column — the leak would stay open.`);
  }
  const splitSrc = readFileSync(split, 'utf8');
  if (/alter table public\.projects\s+drop column/.test(splitSrc)) {
    fail(`${split} drops a legacy column — that belongs in phase 2, after the OTA is live.`);
  }
  if (!/'field' excluded|field.*excluded/i.test(splitSrc)) {
    fail(`${split} no longer documents that 'field' is excluded from can_view_project_financials.`);
  }
} catch { /* missing-file already reported */ }

// ── Phase-2 readiness: SERVER-side readers of the legacy columns ────────────
// The client is not the only consumer. Edge functions query PostgREST directly,
// so a legacy column they still select (or update) breaks the moment phase 2
// drops it — and `item.ts` WRITES linked_estimate, which would also silently
// desync project_financials during the dual-write window.
//
// These are listed explicitly rather than auto-scanned so that the phase-2
// checklist is a hard, reviewable list: every entry must be migrated to
// project_financials BEFORE 20260827120000_..._drop_legacy.sql is applied.
// All four were migrated on 2026-08-26 to read project_financials with a legacy
// fallback (and, for item.ts, to dual-write). They remain listed so the check
// keeps running: if one regresses to a bare legacy read, it reappears here.
const PHASE2_BLOCKERS: { file: string; what: string }[] = [
  { file: 'supabase/functions/construction-answer/index.ts', what: 'project context estimate' },
  { file: 'supabase/functions/mcp/index.ts', what: 'list_projects value' },
  { file: 'supabase/functions/_shared/qbo-mapping/invoice.ts', what: 'linked_estimate items' },
  { file: 'supabase/functions/_shared/qbo-mapping/item.ts', what: 'linked_estimate read + write' },
];

// A migrated consumer routes through project_financials. The legacy fallback is
// allowed (and expected) until phase 2 — what must NOT happen is a consumer that
// only ever touches the legacy column.
function readsNewTable(src: string): boolean {
  return /project_financials/.test(src) || /readLinkedEstimate|writeLinkedEstimate|moneyByProject|getProjectMoney/.test(src);
}

const stillLegacy = PHASE2_BLOCKERS.filter(b => {
  try {
    return !readsNewTable(readFileSync(b.file, 'utf8'));
  } catch { return false; }
});

if (stillLegacy.length > 0) {
  console.error(`\n  FAIL  ${stillLegacy.length} server-side consumer(s) still read ONLY the legacy columns.`);
  console.error('        They break the moment the phase-2 drop migration runs. Route them');
  console.error('        through project_financials (legacy fallback is fine until phase 2):');
  for (const b of stillLegacy) console.error(`          · ${b.file} — ${b.what}`);
  failures += stillLegacy.length;
} else {
  console.log(`  ✓ ${PHASE2_BLOCKERS.length} server-side consumer(s) route through project_financials — phase 2 is unblocked`);
}

if (failures > 0) {
  console.error(`\n✗ validate-project-financials-split: ${failures} check(s) failed`);
  process.exit(1);
}
console.log(`\n✓ validate-project-financials-split: ${sites.length} projects write-site(s) checked, all paired`);
