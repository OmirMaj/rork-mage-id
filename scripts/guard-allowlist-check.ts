// guard-allowlist-check.ts — one question, asked by the validators that pin a
// column guard's FIRST definition (the w4 ledger / change-order / punch files,
// validate-punch-seal): is the guard's LATEST definition, across every
// migration, an allow-list?
//
// Those first definitions act on "a client" spelled as two role names
// (current_user in ('authenticated', 'anon')), so a role added later passed
// them. 20261005110000_guard_allowlists.sql replaced the five bodies: each now
// names who MAY write (service_role, postgres, supabase_admin, and the owner of
// one SECURITY DEFINER function, looked up). The applied files are never
// edited, so a validator that reads only the first definition would stay green
// if a later migration put the deny-list back. This reads the last one.
//
// The body-for-body proof (the new body is the old one with only the role test
// swapped) and the planted mutations live in validate-w5-rls-hardening-sql.ts.
// Not a validator itself: it has no checks of its own and is imported.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const GUARD_ALLOWLIST_MIGRATION = '20261005110000_guard_allowlists.sql';

/** The statement that creates public.<fn>() in `src` (comments stripped), up to the next statement that starts a function or a DO block. */
function statementOf(src: string, fn: string): string {
  const code = src.replace(/--[^\n]*/g, '');
  const from = code.search(new RegExp(`create or replace function public\\.${fn}\\(`, 'i'));
  if (from < 0) return '';
  const rest = code.slice(from + 1);
  const next = rest.search(/create or replace function |\ndo \$/i);
  return code.slice(from, next < 0 ? code.length : from + 1 + next);
}

/**
 * `ok` when the last timestamped migration that defines public.<fn>() is the
 * allow-list migration or a later one, and that definition opens with the
 * allow-list, looks up the owner of `server`, names no client role and is not
 * SECURITY DEFINER. `detail` says which file was read and what is wrong.
 */
export function latestGuardIsAllowList(root: string, fn: string, server: string, files?: Record<string, string>): { ok: boolean; detail: string } {
  const dir = join(root, 'supabase', 'migrations');
  const all = files ?? Object.fromEntries(readdirSync(dir).filter(f => /^\d{14}_.*\.sql$/.test(f)).map(f => [f, readFileSync(join(dir, f), 'utf8')]));
  const last = Object.keys(all).sort().filter(f => statementOf(all[f], fn) !== '').pop();
  if (!last) return { ok: false, detail: `no migration defines public.${fn}()` };
  const stmt = statementOf(all[last], fn);
  const wrong: string[] = [];
  if (last < GUARD_ALLOWLIST_MIGRATION) wrong.push('its latest definition predates the allow-list migration');
  if (!stmt.includes("if current_user in ('service_role', 'postgres', 'supabase_admin') then")) wrong.push('it does not open with the three server roles');
  if (!stmt.includes(`pg_catalog.to_regprocedure('${server}')`) || !stmt.includes('if v_owner is not null and current_user = v_owner then')) wrong.push(`it does not look up the owner of ${server}`);
  if (/'authenticated'|'anon'/.test(stmt) || /current_user\s+not\s+in|current_user\s*(<>|!=)/i.test(stmt)) wrong.push('it names a client role (a deny-list)');
  if (/security definer/i.test(stmt)) wrong.push('it is SECURITY DEFINER');
  return { ok: wrong.length === 0, detail: `${last}: ${wrong.join('; ') || 'allow-list'}` };
}
