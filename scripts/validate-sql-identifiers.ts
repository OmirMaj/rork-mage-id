// validate-sql-identifiers.ts — no migration may use a reserved word as a name.
//
// WHY THIS EXISTS. `window` is a RESERVED keyword in Postgres (it heads the
// WINDOW clause), so `create table deliveries (window text)` is not a subtle
// portability concern — it is a hard syntax error. 20260826200000_deliveries.sql
// shipped with exactly that and would have failed the deploy at the moment the
// founder ran it, after the preceding migrations had already applied: a partial
// deploy, which is the worst kind.
//
// It survived review because it reads perfectly. Nothing about `window text`
// looks wrong unless you happen to know the keyword list, which is precisely
// what a machine should be checking instead of a person.
//
// The list below is `select word from pg_get_keywords() where catcode in
// ('R','T')` on Postgres 17 — the two categories excluded from the `ColId`
// grammar rule that governs column names, table names, and column aliases.
// ('C' / col_name_keyword IS permitted as a column name, so words like `date`,
// `time` and `text` are deliberately absent.)
//
// Run via: bun run test:sql-identifiers

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Postgres 17: pg_get_keywords() catcode 'R' (reserved) + 'T' (type_func_name).
// Neither is accepted where a ColId is expected.
const RESERVED = new Set<string>([
  'all', 'analyse', 'analyze', 'and', 'any', 'array', 'as', 'asc', 'asymmetric',
  'authorization', 'binary', 'both', 'case', 'cast', 'check', 'collate',
  'collation', 'column', 'concurrently', 'constraint', 'create', 'cross',
  'current_catalog', 'current_date', 'current_role', 'current_schema',
  'current_time', 'current_timestamp', 'current_user', 'default', 'deferrable',
  'desc', 'distinct', 'do', 'else', 'end', 'except', 'false', 'fetch', 'for',
  'foreign', 'freeze', 'from', 'full', 'grant', 'group', 'having', 'ilike', 'in',
  'initially', 'inner', 'intersect', 'into', 'is', 'isnull', 'join', 'lateral',
  'leading', 'left', 'like', 'limit', 'localtime', 'localtimestamp', 'natural',
  'not', 'notnull', 'null', 'offset', 'on', 'only', 'or', 'order', 'outer',
  'overlaps', 'placing', 'primary', 'references', 'returning', 'right', 'select',
  'session_user', 'similar', 'some', 'symmetric', 'system_user', 'table',
  'tablesample', 'then', 'to', 'trailing', 'true', 'union', 'unique', 'user',
  'using', 'variadic', 'verbose', 'when', 'where', 'window', 'with',
]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

// Lines that START with one of these are TABLE-LEVEL CONSTRAINTS, not column
// definitions — `primary key (a, b)` and `constraint foo unique (x)` are valid
// SQL and share the "<word> <word>" shape a naive scan looks for. Without this
// the guard cries wolf on almost every well-built table, and a guard that
// always fails is a guard everyone learns to skip.
const CONSTRAINT_STARTERS = /^\s*(primary|unique|constraint|foreign|check|exclude|like|partition)\b/i;

interface Violation { file: string; line: number; word: string; text: string }
const violations: Violation[] = [];
const warnings: Violation[] = [];

for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
  const lines = readFileSync(join(MIGRATIONS, file), 'utf8').split('\n');

  // Track whether we are inside a CREATE TABLE (...) column list. Checking only
  // there keeps the scan honest: `select ... from x` uses reserved words on
  // every other line and none of those are identifiers.
  let inCreateTable = false;
  let depth = 0;

  lines.forEach((raw, i) => {
    const line = raw.split('--')[0];      // strip comments; the fix note itself says "window"
    if (!line.trim()) return;

    if (/\bcreate\s+table\b/i.test(line)) { inCreateTable = true; depth = 0; }

    if (inCreateTable && !CONSTRAINT_STARTERS.test(line)) {
      // First token of a column definition, e.g. "  window        text,"
      const m = line.match(/^\s+"?([a-z_][a-z0-9_]*)"?\s+[a-z]/i);
      if (m && depth <= 1) {
        const word = m[1].toLowerCase();
        const isQuoted = /^\s+"/.test(line);
        if (RESERVED.has(word)) {
          // A QUOTED reserved word parses. It is still a wart — every query
          // against that column must quote it forever — but it does not break a
          // deploy, and several already-applied migrations contain one. Failing
          // the build on history nobody can safely rewrite would just teach
          // people to disable the guard. Warn on quoted, fail on bare.
          (isQuoted ? warnings : violations).push({ file, line: i + 1, word, text: raw.trim() });
        }
      }
      depth += (line.match(/\(/g) ?? []).length - (line.match(/\)/g) ?? []).length;
      if (/\)\s*;/.test(line) && depth <= 0) inCreateTable = false;
    }

    // ALTER TABLE ... ADD COLUMN <reserved>
    const add = line.match(/\badd\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/i);
    if (add && RESERVED.has(add[1].toLowerCase())) {
      violations.push({ file, line: i + 1, word: add[1].toLowerCase(), text: raw.trim() });
    }

    // CREATE TABLE <reserved> / ALTER TABLE <reserved>
    const tbl = line.match(/\b(?:create|alter)\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z_][a-z0-9_]*)"?/i);
    if (tbl && RESERVED.has(tbl[1].toLowerCase())) {
      violations.push({ file, line: i + 1, word: tbl[1].toLowerCase(), text: raw.trim() });
    }
  });
}

if (warnings.length > 0) {
  console.warn('  ! quoted reserved keywords (parse, but must stay quoted in every query):');
  for (const w of warnings) console.warn(`    ${w.file}:${w.line}  ${w.text}`);
}

if (violations.length > 0) {
  console.error('\n✗ validate-sql-identifiers: reserved Postgres keyword used as an identifier\n');
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
    console.error(`    "${v.word}" is reserved — this is a SYNTAX ERROR, not a style issue.`);
    console.error(`    Rename it (e.g. delivery_${v.word}). Do not quote it.\n`);
  }
  console.error(`  ${violations.length} violation(s). These fail at deploy time, mid-bundle.\n`);
  process.exit(1);
}
console.log('✓ validate-sql-identifiers: no reserved keywords used as identifiers');
