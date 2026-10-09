// scripts/pgq/_harness.mjs — shared pieces of the PGlite migration proofs.
// See scripts/pgq/README.md for how to run them.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Load PGlite from PGLITE_DIR (a folder holding node_modules/@electric-sql/pglite), else from wherever node resolves it. */
export async function loadPGlite() {
  const dir = process.env.PGLITE_DIR;
  if (dir) {
    const req = createRequire(path.join(path.resolve(dir), 'noop.js'));
    const entry = req.resolve('@electric-sql/pglite');
    return (await import(pathToFileURL(entry).href)).PGlite;
  }
  try {
    return (await import('@electric-sql/pglite')).PGlite;
  } catch {
    console.error('PGlite not found. Install it OUTSIDE the repo and point PGLITE_DIR at that folder:\n  mkdir -p ~/pgq && cd ~/pgq && npm i @electric-sql/pglite\n  PGLITE_DIR=~/pgq node scripts/pgq/<proof>.mjs . --all');
    process.exit(2);
  }
}

/** Roles, auth.users, auth.uid() and production's default privileges (every new public object granted to the client roles). */
export const BASE_SQL = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select current_user::text
$$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select, delete on auth.users to service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** A storage schema shaped like Supabase's, enough for bucket and policy proofs. */
export const STORAGE_SQL = `
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid, metadata jsonb);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, anon;
grant all on storage.objects to service_role;
grant select on storage.buckets to anon, authenticated, service_role;
create or replace function storage.foldername(name text) returns text[] language plpgsql immutable as $f$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts,1)-1];
end $f$;
`;

export function worktreeArg(usage) {
  const root = process.argv[2];
  if (!root) { console.error(`usage: node ${usage} <worktree> [--all]`); process.exit(2); }
  return path.resolve(root);
}

export function readMigration(root, file) {
  const p = path.join(root, 'supabase/migrations', file);
  if (!existsSync(p)) { console.error(`migration not found: ${p}`); process.exit(2); }
  return readFileSync(p, 'utf8');
}

/** A text replacer that exits 3 when its anchor is gone (a mutation that plants nothing proves nothing). */
export function replacer(get, set, mutate) {
  return (from, to, all = false) => {
    const cur = get();
    if (!cur.includes(from)) { console.error(`MUTATE=${mutate}: anchor not found: ${from.slice(0, 90)}`); process.exit(3); }
    set(all ? cur.split(from).join(to) : cur.replace(from, to));
  };
}

/** `--all`: run MUTATE=0..n in child processes; M0 must be all green, each plant must turn its expected cases red. */
export function runAll(scriptUrl, root, expect) {
  const script = new URL(scriptUrl).pathname;
  const n = Math.max(...Object.keys(expect).map(Number));
  let bad = 0;
  for (let m = 0; m <= n; m++) {
    const r = spawnSync(process.execPath, [script, root], { env: { ...process.env, MUTATE: String(m) }, encoding: 'utf8' });
    const red = (r.stdout.match(/^FAIL (\S+)/gm) ?? []).map((l) => l.slice(5));
    if (m === 0) {
      const good = r.status === 0 && red.length === 0;
      console.log(`${good ? 'PASS' : 'FAIL'} M0 as written: exit ${r.status}, ${(r.stdout.match(/^PASS /gm) ?? []).length} cases pass, ${red.length} red`);
      if (!good) { bad++; console.log(r.stdout.slice(-2500), r.stderr.slice(-1200)); }
    } else {
      const want = expect[m];
      const good = r.status === 1 && want.every((c) => red.includes(c));
      console.log(`${good ? 'PASS' : 'FAIL'} M${m} goes red: exit ${r.status}, red cases [${red.join(', ')}], expected at least [${want.join(', ')}]`);
      if (!good) { bad++; console.log(r.stdout.slice(-2500), r.stderr.slice(-1200)); }
    }
  }
  console.log(bad ? `\n${bad} FAILED` : `\nALL PASS (as written green; ${n} planted mutations red)`);
  process.exit(bad ? 1 : 0);
}

/** Case reporter plus role-switching helpers bound to one database. */
export function makeKit(db) {
  let fails = 0;
  const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'} ${n}${d ? ' — ' + d : ''}`); if (!c) fails++; };
  const as = async (role, uid = '') => {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    if (role) await db.exec(`set role ${role}`);
  };
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const tryRun = async (role, sql, uid = '', params = []) => {
    await as(role, uid);
    try { const r = await db.query(sql, params); return { ok: true, n: r.rows.length, affected: r.affectedRows ?? 0, rows: r.rows }; }
    catch (e) { return { ok: false, err: String(e.message) }; }
    finally { await as(null); }
  };
  const done = () => { console.log(fails ? `\n${fails} FAILED` : '\nALL PASS'); process.exit(fails ? 1 : 0); };
  return { ok, as, rows, tryRun, done };
}
