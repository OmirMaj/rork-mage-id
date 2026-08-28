// validate-outbox-contract.ts — an edge function must write values the DB accepts.
//
// WHY THIS EXISTS. public.notification_outbox constrains recipient_kind:
//
//   CHECK (recipient_kind = ANY (ARRAY['gc','client','sub']))
//
// portal-link-expiry-notice shipped with `recipient_kind: "user"`. Every insert
// would have been rejected with a 23514 check violation, and the caller did
// `if (!ins.ok) { skipped++; continue; }` — so the cron would have run twice a
// day forever, returned `success: true`, and notified nobody. The one feature
// the function exists for (tell the GC their client's portal link died) would
// have silently never worked.
//
// Nothing could have caught it locally: Deno functions are not in the app's
// tsc pass, the string is valid TypeScript, and the constraint only bites at
// runtime against a database no test touches.
//
// This guard pins the literal values an edge function may write for a
// constrained column. When a CHECK constraint changes, update BOTH — the
// constraint is the source of truth and this file is its mirror.
//
// Verified against the live schema on 2026-08-27:
//   select pg_get_constraintdef(oid) from pg_constraint
//   where conname = 'notification_outbox_recipient_kind_check';
//
// Run via: bun run test:outbox-contract

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FUNCTIONS = join(ROOT, 'supabase', 'functions');

/** Mirrors notification_outbox_recipient_kind_check. */
const RECIPIENT_KINDS = new Set(['gc', 'client', 'sub']);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Violation { file: string; line: number; value: string }
const violations: Violation[] = [];
let checked = 0;

for (const file of walk(FUNCTIONS)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = raw.split('//')[0];
    const m = line.match(/recipient_kind\s*:\s*["']([^"']*)["']/);
    if (!m) return;
    checked++;
    if (!RECIPIENT_KINDS.has(m[1])) {
      violations.push({ file: relative(ROOT, file), line: i + 1, value: m[1] });
    }
  });
}

// A guard that silently matches nothing is worse than no guard: it reports
// "all clear" while checking zero call sites.
if (checked === 0) {
  console.error('✗ validate-outbox-contract: found ZERO recipient_kind writes.');
  console.error('  Either the column was renamed or this guard stopped matching. Fix the guard.');
  process.exit(1);
}

if (violations.length > 0) {
  console.error('\n✗ validate-outbox-contract\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  recipient_kind: "${v.value}"`);
    console.error(`    notification_outbox accepts only ${[...RECIPIENT_KINDS].map(k => `'${k}'`).join(', ')}.`);
    console.error('    This is a 23514 check violation at runtime — the insert is rejected,');
    console.error('    the notification is never sent, and the cron still reports success.\n');
  }
  process.exit(1);
}

console.log(`✓ validate-outbox-contract: ${checked} recipient_kind write(s), all valid`);
