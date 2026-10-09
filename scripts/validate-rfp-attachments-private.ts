// validate-rfp-attachments-private.ts — homeowner photos and drawings are
// served through short-lived signed links, never a public URL (audit DB-F11b,
// lane PROTECT-SERVER).
//
// WHY. `rfp-attachments` was a public bucket and the app stored each file's
// permanent public URL in a table every signed-in account can list. The fix
// has a client half (store the PATH, sign at read time: utils/rfpAttachmentPath
// + utils/rfpAttachmentUrls) and a held migration that makes the bucket private
// (supabase/migrations/20261009120000_rfp_attachments_private.sql). This guard
// keeps both halves from sliding back:
//
//   A. the path rule    rfpAttachmentPath() recovers a path from a bare path
//                       and from every legacy URL shape, refuses everything
//                       else, and its shape equals the server's one rule
//                       (supabase/functions/_shared/storagePath.ts).
//   B. no public URL    no file in the app or the edge functions calls
//                       getPublicUrl on this bucket or types a
//                       /object/public/rfp-attachments URL; the upload returns
//                       the path.
//   C. the readers      every screen that shows a posting's photo or drawing
//                       goes through the resolver; none hands a stored value
//                       straight to <Image> or Linking.
//   D. the migration    self-guard, private flip, one read policy for
//                       authenticated only, a definer rule with an empty
//                       search_path, nothing for anon.
//   E. mutations        planted in memory; each must turn its check red.
//
// The migration's behaviour is proved on PGlite by
// scripts/pgq/rfp-attachments-private.mjs (not part of ship-check).
//
// Run: bun run scripts/validate-rfp-attachments-private.ts

import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RFP_ATTACHMENT_PATH, requestStoragePath } from '../supabase/functions/_shared/storagePath';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(src: string): string } };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');

const PATH_FILE = 'utils/rfpAttachmentPath.ts';
const URLS_FILE = 'utils/rfpAttachmentUrls.ts';
const STORAGE_FILE = 'utils/storage.ts';
const MIGRATION = 'supabase/migrations/20261009120000_rfp_attachments_private.sql';
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'mageid-rfp-'));
let evalSeq = 0;
const READERS = ['app/rfp-detail.tsx', 'app/my-rfps.tsx', 'app/nearby-rfps.tsx'];

function walk(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try { names = readdirSync(path.join(ROOT, dir)); } catch { return out; }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const rel = `${dir}/${name}`;
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(rel);
  }
  return out;
}

const SOURCE_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'utils', 'supabase/functions'];
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const stripSqlComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

type Files = Record<string, string>;
function loadFiles(): Files {
  const files: Files = {};
  for (const dir of SOURCE_DIRS) for (const f of walk(dir)) files[f] = read(f);
  files[MIGRATION] = read(MIGRATION);
  return files;
}

interface Result { name: string; pass: boolean; detail: string }

async function evalPathModule(src: string): Promise<{
  rfpAttachmentPath: (v: unknown) => string | null;
  rfpAttachmentDisplayName: (v: string) => string;
  rfpAttachmentFallback: (v: string) => string;
  RFP_ATTACHMENT_PATH_RE: RegExp;
  RFP_ATTACHMENT_URL_TTL_SECONDS: number;
}> {
  // Transpiled to a scratch file outside the repo and imported from there (the
  // module has no imports of its own), so a planted mutation is really run.
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src);
  // A new folder per module: bun remembers a folder's listing after the first import from it.
  const file = path.join(mkdtempSync(path.join(SCRATCH, `m${evalSeq++}-`)), 'module.mjs');
  writeFileSync(file, js);
  return await import(file);
}

async function runChecks(files: Files): Promise<Result[]> {
  const results: Result[] = [];
  const ok = (name: string, pass: boolean, detail = ''): void => { results.push({ name, pass, detail }); };

  // ── A. the path rule ──
  const P = await evalPathModule(files[PATH_FILE]);
  const U = '0a1b2c3d-1111-4222-8333-444455556666';
  const B = '9f8e7d6c-aaaa-4bbb-8ccc-ddddeeeeffff';
  const good = `${U}/${B}/1759900000000_kitchen.jpg`;
  const base = 'https://nteoqhcswappxxjlpvap.supabase.co/storage/v1/object';
  ok('A1 a bare path is its own path', P.rfpAttachmentPath(good) === good);
  ok('A2 a legacy public URL maps to its path', P.rfpAttachmentPath(`${base}/public/rfp-attachments/${good}`) === good);
  ok('A3 a signed URL (with its token) and an authenticated URL map to the same path',
    P.rfpAttachmentPath(`${base}/sign/rfp-attachments/${good}?token=abc.def`) === good && P.rfpAttachmentPath(`${base}/authenticated/rfp-attachments/${good}`) === good);
  ok('A4 a percent-encoded legacy URL is decoded before it is judged', P.rfpAttachmentPath(`${base}/public/rfp-attachments/${U}/${B}/1759900000000_my%5Fplan.pdf`) === `${U}/${B}/1759900000000_my_plan.pdf`);
  const refused: Array<[string, unknown]> = [
    ['another bucket', `${base}/public/plan-sheets/${good}`],
    ['a project-photos path', `${U}/${B}/${U}.jpg`],
    ['a traversal', `${U}/${B}/../${B}/1759900000000_x.jpg`],
    ['an encoded traversal', `${base}/public/rfp-attachments/${U}/%2E%2E/1759900000000_x.jpg`],
    ['two segments', `${U}/1759900000000_x.jpg`],
    ['four segments', `${U}/${B}/extra/1759900000000_x.jpg`],
    ['a non-uuid owner', `me/${B}/1759900000000_x.jpg`],
    ['an unstamped file', `${U}/${B}/kitchen.jpg`],
    ['some other URL', 'https://example.com/a.jpg'],
    ['a file URI', `file:///var/mobile/${good}`],
    ['a leading slash', `/${good}`],
    ['a space in the name', `${U}/${B}/1759900000000_my plan.pdf`],
    ['empty', ''], ['null', null], ['a number', 42],
  ];
  const leaked = refused.filter(([, v]) => P.rfpAttachmentPath(v) !== null).map(([n]) => n);
  ok('A5 everything that is not a writer\'s key in this bucket is refused', leaked.length === 0, leaked.join(', '));
  {
    const samples = [good, `${U}/${B}/1_`, `${U}/${B}/1759900000000_a.b-c_d.PDF`, `${U}/${B}/x_1.jpg`, `${U.toUpperCase()}/${B}/1_a`, `${U}/${B}/12345678901234567_a`, `${U}/${B}/1759900000000_é.jpg`, `${U}/${B}/1759900000000_a/b`, `${U}/${B}/`, `${U}/${B}/1759900000000_a%20b`];
    const diff = samples.filter((s) => P.RFP_ATTACHMENT_PATH_RE.test(s) !== (requestStoragePath(s, RFP_ATTACHMENT_PATH) !== null));
    ok('A6 the client shape and the server rule (storagePath.ts RFP_ATTACHMENT_PATH) agree on every sample', diff.length === 0, diff.join(' | '));
  }
  ok('A7 a drawing shows by its file name without the stamp', P.rfpAttachmentDisplayName(good) === 'kitchen.jpg' && P.rfpAttachmentDisplayName(`${base}/public/rfp-attachments/${U}/${B}/1759900000000_site%20plan.pdf`) !== '');
  ok('A8 an unsigned legacy URL falls back to itself; an unsigned bare path falls back to nothing (no public URL is built for it)',
    P.rfpAttachmentFallback(`${base}/public/rfp-attachments/${good}`) === `${base}/public/rfp-attachments/${good}` && P.rfpAttachmentFallback(good) === '');
  ok('A9 a minted link lives one hour or less', P.RFP_ATTACHMENT_URL_TTL_SECONDS > 0 && P.RFP_ATTACHMENT_URL_TTL_SECONDS <= 3600, String(P.RFP_ATTACHMENT_URL_TTL_SECONDS));

  // ── B. no public URL for this bucket, anywhere ──
  {
    const offenders: string[] = [];
    for (const [file, raw] of Object.entries(files)) {
      if (file === MIGRATION) continue;
      const src = stripComments(raw);
      if (/from\(\s*(['"`]rfp-attachments['"`]|RFP_ATTACHMENT_BUCKET)\s*\)\s*\.getPublicUrl/.test(src)) offenders.push(`${file}: getPublicUrl on the bucket`);
      if (/object\/public\/rfp-attachments/.test(src)) offenders.push(`${file}: a typed /object/public/rfp-attachments URL`);
      // A file that names the bucket must not call getPublicUrl at all, unless it is a file with other, public buckets (storage.ts).
      if (/rfp-attachments|RFP_ATTACHMENT_BUCKET/.test(src) && /getPublicUrl/.test(src) && file !== STORAGE_FILE) offenders.push(`${file}: names the bucket and calls getPublicUrl`);
    }
    ok('B1 no file calls getPublicUrl on rfp-attachments or types a public URL for it', offenders.length === 0, offenders.join('; '));
    const storage = stripComments(files[STORAGE_FILE]);
    const fnAt = storage.indexOf('export async function uploadRfpAttachment');
    const fnEnd = storage.indexOf('\nexport ', fnAt + 10);
    const fn = fnAt === -1 ? '' : storage.slice(fnAt, fnEnd === -1 ? undefined : fnEnd);
    ok('B2 uploadRfpAttachment returns the storage path and never a URL', fn.length > 0 && /return path;/.test(fn) && !/getPublicUrl|publicUrl|createSignedUrl/.test(fn), fn.length === 0 ? 'function not found' : '');
    ok('B3 the upload path is <userId>/<rfpId>/<stamp>_<name>, the shape the read policy and the server rule expect', /const path = `\$\{userId\}\/\$\{rfpId\}\/\$\{Date\.now\(\)\}_\$\{safeName\}`;/.test(fn));
  }

  // ── C. the readers ──
  {
    const urls = stripComments(files[URLS_FILE]);
    ok('C1 the resolver signs with createSignedUrls on the bucket and the one-hour TTL', /\.from\(RFP_ATTACHMENT_BUCKET\)\s*\.createSignedUrls\([^;]{0,80}, RFP_ATTACHMENT_URL_TTL_SECONDS\);/.test(urls));
    ok('C2 the resolver starts every bucket value at its fallback, so a refused signing never throws or blanks a legacy URL early', /out\.set\(v, rfpAttachmentFallback\(v\)\);/.test(urls));
    for (const f of READERS) {
      const src = stripComments(files[f] ?? '');
      ok(`C3 ${f} resolves through useRfpAttachmentUrls`, /useRfpAttachmentUrls\(/.test(src));
      ok(`C4 ${f} never hands a stored value straight to an <Image>`, !/source=\{\{\s*uri:\s*(url|heroPhoto)\s*\}\}/.test(src));
    }
    const detail = stripComments(files['app/rfp-detail.tsx'] ?? '');
    ok('C5 rfp-detail opens an attachment with a link minted at the tap', /signRfpAttachment\(stored\)/.test(detail) && !/Linking\.openURL\(stored\)/.test(detail));
    const ctx = stripComments(files['contexts/ProjectContext.tsx'] ?? '');
    ok('C6 the project photo loader signs a carried posting photo in its own bucket, never as a project-photos path',
      /looksLikeStoragePath\(v\) && !isRfpAttachmentRef\(v\)/.test(ctx) && /resolveRfpAttachmentUrls\(rfpRefs\)/.test(ctx));
  }

  // ── D. the migration ──
  {
    const sql = stripSqlComments(files[MIGRATION]);
    const guardAt = sql.indexOf("current_setting('mageid.founder_ok_rfp_private', true)");
    const flipAt = sql.indexOf("update storage.buckets set public = false where id = 'rfp-attachments'");
    const policyAt = sql.indexOf('create policy rfp_attachments_read on storage.objects');
    ok('D1 the file refuses to run without the opt-in line, before anything else', guardAt !== -1 && guardAt < sql.indexOf('create or replace function') && /raise exception 'held: rfp-attachments stays public/.test(sql));
    ok('D2 the bucket is flipped private, after the read policy exists', flipAt !== -1 && policyAt !== -1 && policyAt < flipAt);
    ok('D3 the one read policy is for authenticated only and names the bucket and the rule',
      /create policy rfp_attachments_read on storage\.objects\s+for select to authenticated\s+using \(\s*bucket_id = 'rfp-attachments'\s+and public\.can_read_rfp_attachment\(objects\.name\)\s*\);/.test(sql));
    ok('D4 the rule is SECURITY DEFINER with an empty search_path', /create or replace function public\.can_read_rfp_attachment\(p_name text\)\s+returns boolean\s+language plpgsql\s+stable\s+security definer\s+set search_path to ''/.test(sql));
    ok('D5 anon cannot call the rule', /revoke all on function public\.can_read_rfp_attachment\(text\) from public, anon;/.test(sql) && !/grant execute on function public\.can_read_rfp_attachment\(text\) to[^;]*\banon\b/.test(sql));
    ok('D6 a signed-out caller is refused inside the rule', /if v_uid is null or p_name is null then\s+return false;/.test(sql));
    ok('D7 someone else\'s folder opens only through that owner\'s posting, open or bid on', /b\.user_id = v_owner::uuid/.test(sql) && /b\.status = 'open'\s+or exists \(select 1 from public\.bid_responses r where r\.bid_id = b\.id and r\.user_id = v_uid\)/.test(sql));
    ok('D8 the file touches no other bucket and drops no owner policy', !/plan-sheets|project-photos|worker-ids/.test(sql) && !/drop policy if exists rfp_attachments_owner/.test(sql));
    ok('D9 the self-check refuses a leftover public or anon read policy', /roles && array\['public', 'anon'\]::name\[\]/.test(sql));
  }
  return results;
}

// ── E. planted mutations ──
interface Mutation { name: string; file: string; from: string | RegExp; to: string; red: string }
const MUTATIONS: Mutation[] = [
  { name: 'the upload returns getPublicUrl again', file: STORAGE_FILE, from: '    return path;\n  } catch (err) {\n    console.log(\'[Storage] RFP attachment upload failed', to: "    return supabase.storage.from('rfp-attachments').getPublicUrl(path).data.publicUrl;\n  } catch (err) {\n    console.log('[Storage] RFP attachment upload failed", red: 'B1' },
  { name: 'the upload returns a URL built by hand', file: STORAGE_FILE, from: '    return path;\n  } catch (err) {\n    console.log(\'[Storage] RFP attachment upload failed', to: "    return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/rfp-attachments/${path}`;\n  } catch (err) {\n    console.log('[Storage] RFP attachment upload failed", red: 'B1' },
  { name: 'a bare path falls back to a built public URL', file: PATH_FILE, from: "return isHttp(stored) ? stored : '';", to: "return isHttp(stored) ? stored : `https://x.supabase.co/storage/v1/object/public/rfp-attachments/${stored}`;", red: 'A8' },
  { name: 'the path rule accepts any bucket', file: PATH_FILE, from: '    if (!rest.startsWith(prefix)) return null;\n    candidate = rest.slice(prefix.length);', to: "    candidate = rest.slice(rest.indexOf('/') + 1);", red: 'A5' },
  { name: 'the path rule accepts any three segments', file: PATH_FILE, from: 'return RFP_ATTACHMENT_PATH_RE.test(candidate) ? candidate : null;', to: "return candidate.split('/').length === 3 ? candidate : null;", red: 'A5' },
  { name: 'the client shape drifts from the server rule', file: PATH_FILE, from: '[0-9]{1,16}_[A-Za-z0-9._-]*$', to: '[0-9]{1,20}_[A-Za-z0-9._-]*$', red: 'A6' },
  { name: 'links live a week', file: PATH_FILE, from: 'export const RFP_ATTACHMENT_URL_TTL_SECONDS = 60 * 60;', to: 'export const RFP_ATTACHMENT_URL_TTL_SECONDS = 7 * 24 * 60 * 60;', red: 'A9' },
  { name: 'the posting page shows the stored value', file: 'app/rfp-detail.tsx', from: 'source={{ uri: attachmentUrl(url) || undefined }}', to: 'source={{ uri: url }}', red: 'C4' },
  { name: 'My Projects shows the stored value', file: 'app/my-rfps.tsx', from: 'source={{ uri: attachmentUrl(heroPhoto) || undefined }}', to: 'source={{ uri: heroPhoto }}', red: 'C4' },
  { name: 'an attachment opens the stored value', file: 'app/rfp-detail.tsx', from: 'void signRfpAttachment(stored).then((url) => {', to: 'void Promise.resolve(stored).then((url) => {', red: 'C5' },
  { name: 'the migration loses its guard', file: MIGRATION, from: "    raise exception 'held: rfp-attachments stays public", to: "    raise notice 'held: rfp-attachments stays public", red: 'D1' },
  { name: 'the read policy is for everyone', file: MIGRATION, from: 'for select to authenticated\n  using (\n    bucket_id = \'rfp-attachments\'', to: "for select to public\n  using (\n    bucket_id = 'rfp-attachments'", red: 'D3' },
  { name: 'the rule runs with the caller\'s search_path', file: MIGRATION, from: "stable\nsecurity definer\nset search_path to ''", to: 'stable\nsecurity definer\nset search_path to public', red: 'D4' },
  { name: 'anon may call the rule', file: MIGRATION, from: 'revoke all on function public.can_read_rfp_attachment(text) from public, anon;', to: '', red: 'D5' },
  { name: 'a closed posting stays readable', file: MIGRATION, from: "         b.status = 'open'\n         or exists", to: '         true\n         or exists', red: 'D7' },
  { name: 'the bucket is never flipped', file: MIGRATION, from: "update storage.buckets set public = false where id = 'rfp-attachments' and public = true;", to: '', red: 'D2' },
];

const files = loadFiles();
const base = await runChecks(files);
let fail = 0;
for (const r of base) {
  console.log(`  ${r.pass ? '✓' : '✗'} ${r.name}${!r.pass && r.detail ? ` — ${r.detail}` : ''}`);
  if (!r.pass) fail++;
}

console.log('\nplanted mutations (in memory; each must turn its check red)');
for (const m of MUTATIONS) {
  const src = files[m.file];
  const out = typeof m.from === 'string' ? src.replace(m.from, m.to) : src.replace(m.from, m.to);
  if (out === src) { console.log(`  ✗ mutation anchor not found: ${m.name} (${m.file})`); fail++; continue; }
  let res: Result[] = [];
  let threw = '';
  try { res = await runChecks({ ...files, [m.file]: out }); } catch (e) { threw = String(e); }
  const red = res.filter((r) => !r.pass).map((r) => r.name.split(' ')[0]);
  const caught = threw !== '' || red.some((id) => id === m.red);
  console.log(`  ${caught ? '✓' : '✗'} ${m.name} → ${m.red} red${caught ? '' : ` (red: ${red.join(', ') || 'none'})`}`);
  if (!caught) fail++;
}

try { rmSync(SCRATCH, { recursive: true, force: true }); } catch { /* scratch only */ }
const total = base.length + MUTATIONS.length;
console.log(`\n${fail === 0 ? '✓' : '✗'} rfp-attachments private: ${total - fail} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
