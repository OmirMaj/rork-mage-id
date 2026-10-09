// scripts/pgq/lib.mjs: the small harness the PGlite proofs in this folder share.
//
// PGlite is NOT a dependency of this repo. It is installed in a folder outside
// the repo and found through the PGLITE_DIR environment variable (the folder
// that holds node_modules/@electric-sql/pglite). See README.md.
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const migration = (name) => readFileSync(join(REPO, 'supabase', 'migrations', name), 'utf8');
export const repoFile = (rel) => readFileSync(join(REPO, rel), 'utf8');

export async function loadPGlite() {
  const dir = process.env.PGLITE_DIR;
  if (!dir) {
    console.error('PGLITE_DIR is not set. Install PGlite outside the repo and point PGLITE_DIR at that folder (scripts/pgq/README.md).');
    process.exit(2);
  }
  let entry;
  try {
    entry = createRequire(join(resolve(dir), 'noop.js')).resolve('@electric-sql/pglite');
  } catch {
    console.error(`@electric-sql/pglite was not found under ${dir}/node_modules (scripts/pgq/README.md).`);
    process.exit(2);
  }
  const mod = await import(pathToFileURL(entry).href);
  const PGlite = mod.PGlite ?? mod.default?.PGlite;
  if (!PGlite) { console.error('The PGlite module did not export PGlite.'); process.exit(2); }
  return PGlite;
}

/** A PGlite contrib extension (for example 'pgcrypto'), from the same outside folder. */
export async function loadContrib(name) {
  const entry = createRequire(join(resolve(process.env.PGLITE_DIR), 'noop.js')).resolve(`@electric-sql/pglite/contrib/${name}`);
  const mod = await import(pathToFileURL(entry).href);
  const ext = mod[name] ?? mod.default?.[name];
  if (!ext) { console.error(`PGlite contrib ${name} was not found.`); process.exit(2); }
  return ext;
}

/** The text between two anchors of a file (start included, end excluded). A missing anchor stops the proof. */
export function between(src, start, end, label = '') {
  const i = src.indexOf(start);
  const j = end === null ? src.length : src.indexOf(end, i + start.length);
  if (i < 0 || j < 0) throw new Error(`slice anchor not found ${label}: ${(i < 0 ? start : end).slice(0, 90)}`);
  return src.slice(i, j);
}

// What every Supabase database has before a migration runs: the three API
// roles, auth.users, auth.uid() read from the request's JWT claim, and the
// default privileges that hand every new table and function to all three
// roles (which is why a migration has to revoke).
// SUBSTITUTION: on Supabase the claim arrives from PostgREST; here the proof
// sets request.jwt.claim.sub itself before each statement. service_role has
// BYPASSRLS, as it does there.
export const SUPABASE_BASE = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

/** One database and the two ways the proofs talk to it. */
export async function openDb(PGlite, options = undefined) {
  const db = new PGlite(options);
  /** As a role PostgREST would use, with (or without) a signed-in user id. */
  const as = async (role, uid, sql, params = []) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role ${role};`);
    try { const r = await db.query(sql, params); return { rows: r.rows, err: null, n: r.affectedRows }; }
    catch (e) { return { rows: [], err: e, n: 0 }; }
    finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
  };
  /** As the database owner (postgres), no signed-in user. */
  const root = async (sql, params = []) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    try { const r = await db.query(sql, params); return { rows: r.rows, err: null, n: r.affectedRows }; }
    catch (e) { return { rows: [], err: e, n: 0 }; }
  };
  return { db, as, root };
}

/** A recorder of named checks for one run of a battery. */
export function recorder() {
  const pass = []; const fail = [];
  const ok = (id, cond, detail = '') => { (cond ? pass : fail).push({ id, detail: String(detail ?? '').slice(0, 600) }); };
  return { ok, pass, fail };
}

/** Replace exactly one anchor; a missing or repeated anchor is a broken proof, not a pass. */
export function swap(src, from, to, label = '') {
  const n = src.split(from).length - 1;
  if (n !== 1) throw new Error(`mutation anchor ${label ? `(${label}) ` : ''}found ${n} times, wanted 1: ${from.slice(0, 100)}`);
  return src.replace(from, () => to);
}

/**
 * Runs the battery on the file as written, then once per planted mutation.
 *   battery(sql) -> { pass: [{id}], fail: [{id, detail}] }
 *   mutations: [{ what, edit(sql) -> sql, red: [check ids that MUST fail] }]
 * A mutation is CAUGHT only when every check it names goes red. Prints the
 * summary line and returns the exit code.
 */
export async function judge(name, sql, battery, mutations) {
  const base = await battery(sql);
  for (const p of base.pass) console.log(`PASS ${p.id}${p.detail ? '  ' + p.detail : ''}`);
  for (const f of base.fail) console.log(`FAIL ${f.id}  ${f.detail}`);
  let caught = 0; let broken = 0;
  if (process.env.NO_MUTATIONS) mutations = [];
  for (const [i, m] of mutations.entries()) {
    let mutated;
    try { mutated = m.edit(sql); } catch (e) { broken++; console.log(`M${i + 1} BROKEN  ${m.what}: ${e.message}`); continue; }
    const r = await battery(mutated);
    const red = r.fail.map((f) => f.id);
    const missing = m.red.filter((id) => !red.includes(id));
    const hit = m.red.length > 0 && missing.length === 0;
    if (hit) caught++;
    console.log(`M${i + 1} ${hit ? 'CAUGHT' : 'MISSED'}  ${m.what}\n     named: ${m.red.join(' ')}   red: ${red.join(' ') || 'none'}`);
    if (!hit) for (const f of r.fail) console.log(`     ${f.id}: ${f.detail}`);
  }
  const good = base.fail.length === 0 && broken === 0 && caught === mutations.length;
  console.log(`\n${name}: ${base.pass.length} checks passed${base.fail.length ? `, ${base.fail.length} FAILED` : ''}, ${caught} of ${mutations.length} planted mutations caught${broken ? `, ${broken} mutation(s) could not be planted` : ''}`);
  return good ? 0 : 1;
}
