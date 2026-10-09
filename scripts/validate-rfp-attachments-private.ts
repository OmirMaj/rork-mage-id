// validate-rfp-attachments-private.ts — homeowner photos and drawings are
// served through short-lived signed links, never a public URL (audit DB-F11b,
// lane PROTECT-SERVER).
//
// WHY. `rfp-attachments` was a public bucket and the app stored each file's
// permanent public URL in a table every signed-in account can list. The fix
// has a client half (every reader maps the stored value to a PATH and signs it
// at read time: utils/rfpAttachmentPath + utils/rfpAttachmentUrls) and two
// migrations: the read rule and its policy (20261010120000, no gate) and the
// flip (20261010140000, founder opt-in). This guard keeps every half from
// sliding back:
//
//   A. the path rule    rfpAttachmentPath() recovers a path from a bare path
//                       and from every legacy URL shape, refuses everything
//                       else, and its shape equals the server's one rule
//                       (supabase/functions/_shared/storagePath.ts).
//   B. the stored form  ONE constant decides what an upload stores. The
//                       resolver is RUN (its imports stubbed) for both stored
//                       forms, under both settings of the constant, with
//                       Storage refusing and granting: both forms resolve
//                       whenever Storage grants a link, a public URL is the
//                       only thing shown without one and only while the
//                       constant says the bucket is public, and a value that
//                       is not in this bucket is dropped.
//   C. the readers      EVERY file that reads photo_urls / drawing_urls of
//                       public_bids is found by a scan, not a list. A file the
//                       scan finds that is not classified below fails. In each
//                       one, no value that came from those columns reaches an
//                       <Image>, Linking or a browser without going through
//                       the resolver.
//   D. the migrations   part 1: no gate, no flip, one read policy for
//                       authenticated only, a definer rule with an empty
//                       search_path that admits the awarded bidder only once a
//                       posting is closed, nothing for anon. Part 2: the
//                       opt-in guard, the preconditions, then the flip.
//   E. mutations        planted in memory; each must turn its check red.
//
// The migrations' behaviour is proved on PGlite by
// scripts/pgq/rfp-attachments-private.mjs and
// scripts/pgq/bid-responses-closed-posting.mjs (not part of ship-check).
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
const MIGRATION = 'supabase/migrations/20261010120000_rfp_attachments_private.sql';
const FLIP = 'supabase/migrations/20261010140000_rfp_attachments_flip.sql';
const BID_GUARD = 'supabase/migrations/20261010130000_bid_responses_closed_posting.sql';
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'mageid-rfp-'));
let evalSeq = 0;

// Every file the reader scan may find, and what it does with the stored values.
// The scan decides WHICH files are here; this map only says what each is. A
// file the scan finds that is missing from this map fails C0, and so does an
// entry the scan no longer finds.
//   renders  shows a photo or opens a drawing: must call useRfpAttachmentUrls
//   writes   puts values INTO the columns (from uploadRfpAttachment)
//   selects  names the columns in a query and shows nothing from them
const READER_ROLES: Record<string, 'renders' | 'writes' | 'selects'> = {
  'app/rfp-detail.tsx': 'renders',
  'app/my-rfps.tsx': 'renders',
  'app/nearby-rfps.tsx': 'renders',
  'app/(tabs)/mage-id-bids/index.tsx': 'renders',
  'components/ClientHome.tsx': 'renders',
  'app/post-rfp.tsx': 'writes',
  'app/rfp-responses-review.tsx': 'selects',
};
const READER_DIRS = ['app', 'components', 'contexts', 'hooks', 'lib', 'utils'];

/** Files that read or write public_bids.photo_urls / drawing_urls. */
function findReaders(files: Files): string[] {
  const out: string[] = [];
  for (const [file, raw] of Object.entries(files)) {
    if (!READER_DIRS.some((d) => file.startsWith(`${d}/`))) continue;
    const src = stripCommentsSafe(raw);
    if (/\b(photo_urls|drawing_urls)\b/.test(src) && /\bpublic_bids\b/.test(src)) out.push(file);
  }
  return out.sort();
}

/**
 * Stored attachment values that reach a screen unsigned, in one file.
 * A name is TAINTED when it is bound from the columns (`const x = ...photo_urls...`,
 * or the parameter of `.photo_urls.map(x =>`), or from another tainted name.
 * A call of the function useRfpAttachmentUrls returned, or of signRfpAttachment /
 * resolveRfpAttachmentUrls / rfpAttachmentDisplayName, cleans what is inside it.
 * A sink is `uri: <expr>`, Linking.openURL(<expr>), openBrowserAsync(<expr>),
 * window.open(<expr>) and href={<expr>}. Scope-blind on purpose: a signed link
 * must not share a name with a stored value.
 */
function unsignedUses(raw: string): string[] {
  const src = stripCommentsSafe(raw);
  const cleaners = new Set<string>(['signRfpAttachment', 'resolveRfpAttachmentUrls', 'rfpAttachmentDisplayName', 'useRfpAttachmentUrls']);
  for (const m of src.matchAll(/const\s+(\w+)\s*=\s*useRfpAttachmentUrls\(/g)) cleaners.add(m[1]);
  const clean = (expr: string): string => {
    let cur = expr;
    for (let i = 0; i < 6; i++) {
      const next = cur.replace(new RegExp(`\\b(${[...cleaners].join('|')})\\([^()]*\\)`, 'g'), ' ');
      if (next === cur) break;
      cur = next;
    }
    return cur;
  };
  const tainted = new Set<string>();
  for (const m of src.matchAll(/\.(?:photo_urls|drawing_urls)\s*(?:\?\.|\.)\s*(?:map|forEach|filter|find)\(\s*\(?\s*(\w+)/g)) tainted.add(m[1]);
  const decls = [...src.matchAll(/(?:const|let|var)\s+(\w+)\s*(?::[^=\n]+)?=\s*([^;\n]+)/g)].map((m) => ({ name: m[1], rhs: clean(m[2]) }));
  const hasTaint = (expr: string): boolean => /\b(photo_urls|drawing_urls)\b/.test(expr) || [...tainted].some((t) => new RegExp(`\\b${t}\\b`).test(expr));
  for (let pass = 0; pass < 6; pass++) {
    let grew = false;
    for (const d of decls) if (!tainted.has(d.name) && hasTaint(d.rhs)) { tainted.add(d.name); grew = true; }
    if (!grew) break;
  }
  const sinks: Array<[string, RegExp]> = [
    ['<Image> uri', /\buri:\s*([^,}\n]+)/g],
    ['Linking.openURL', /\bopenURL\(([^)\n]*)\)/g],
    ['openBrowserAsync', /\bopenBrowserAsync\(([^)\n]*)\)/g],
    ['window.open', /\bwindow\.open\(([^)\n]*)\)/g],
    ['href', /\bhref=\{([^}\n]*)\}/g],
  ];
  const found: string[] = [];
  for (const [label, re] of sinks) {
    for (const m of src.matchAll(re)) {
      if (hasTaint(clean(m[1]))) found.push(`${label}: ${m[1].trim().slice(0, 60)}`);
    }
  }
  return found;
}


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
/**
 * Comments out, strings kept. Unlike stripComments above it walks the text, so
 * a slash-star inside a string ('image/*') does not swallow the code after it.
 * A quote opened in JSX text ends at the line break.
 */
function stripCommentsSafe(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/' ) { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const end = src.indexOf('*/', i + 2); i = end === -1 ? n : end + 2; out += ' '; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') { if (src[j] === '\\') j++; j++; }
      out += src.slice(i, Math.min(j + 1, n));
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}
const stripSqlComments = (sql: string): string => sql.replace(/--[^\n]*/g, '');

type Files = Record<string, string>;
function loadFiles(): Files {
  const files: Files = {};
  for (const dir of SOURCE_DIRS) for (const f of walk(dir)) files[f] = read(f);
  files[MIGRATION] = read(MIGRATION);
  files[FLIP] = read(FLIP);
  files[BID_GUARD] = read(BID_GUARD);
  return files;
}

interface Result { name: string; pass: boolean; detail: string }

async function evalPathModule(src: string): Promise<{
  rfpAttachmentPath: (v: unknown) => string | null;
  rfpAttachmentDisplayName: (v: string) => string;
  rfpAttachmentFallback: (v: string, form?: string) => string;
  rfpAttachmentResolved: (v: unknown, signed: unknown, form?: string) => string;
  rfpAttachmentStoredValue: (p: string, base: unknown, form?: string) => string | null;
  RFP_ATTACHMENT_STORED_FORM: string;
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

type SignStub = (paths: string[]) => { data: Array<{ path: string; signedUrl: string | null; error?: string }> | null; error: { message: string } | null } | Promise<never>;

/**
 * utils/rfpAttachmentUrls.ts, really run: transpiled next to the path module
 * (as given, so a planted mutation in either is run) with `react` and
 * `@/lib/supabase` replaced by stubs. `sign` plays Storage.
 */
async function evalUrlsModule(pathSrc: string, urlsSrc: string, sign: SignStub): Promise<{
  resolveRfpAttachmentUrls: (values: readonly unknown[]) => Promise<Map<string, string>>;
  signRfpAttachment: (stored: string) => Promise<string>;
}> {
  const dir = mkdtempSync(path.join(SCRATCH, `u${evalSeq++}-`));
  const t = new Bun.Transpiler({ loader: 'ts' });
  const key = `__rfpSign${evalSeq}`;
  (globalThis as Record<string, unknown>)[key] = sign;
  writeFileSync(path.join(dir, 'path.mjs'), t.transformSync(pathSrc));
  writeFileSync(path.join(dir, 'react.mjs'), 'export const useEffect = () => {}; export const useMemo = (f) => f(); export const useState = (v) => [typeof v === "function" ? v() : v, () => {}];');
  writeFileSync(path.join(dir, 'supabase.mjs'), `export const isSupabaseConfigured = true; export const supabase = { storage: { from: (bucket) => ({ createSignedUrls: async (paths, ttl) => { if (bucket !== 'rfp-attachments' || !(ttl > 0 && ttl <= 3600)) throw new Error('wrong bucket or lifetime'); return globalThis.${key}(paths); } }) } };`);
  const js = t.transformSync(urlsSrc)
    .replace(/(["'])@\/utils\/rfpAttachmentPath\1/g, '"./path.mjs"')
    .replace(/(["'])@\/lib\/supabase\1/g, '"./supabase.mjs"')
    .replace(/(["'])react\1/g, '"./react.mjs"');
  writeFileSync(path.join(dir, 'urls.mjs'), js);
  return await import(path.join(dir, 'urls.mjs'));
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
  ok('A8 an unsigned in-bucket public URL falls back to itself only while the constant says the bucket is public; a bare path and any other URL fall back to nothing',
    P.rfpAttachmentFallback(`${base}/public/rfp-attachments/${good}`, 'public_url') === `${base}/public/rfp-attachments/${good}`
    && P.rfpAttachmentFallback(`${base}/public/rfp-attachments/${good}`, 'path') === ''
    && P.rfpAttachmentFallback(good, 'public_url') === ''
    && P.rfpAttachmentFallback('https://example.com/a.jpg', 'public_url') === ''
    && P.rfpAttachmentFallback(`${base}/public/plan-sheets/${good}`, 'public_url') === '');
  ok('A9 a minted link lives one hour or less', P.RFP_ATTACHMENT_URL_TTL_SECONDS > 0 && P.RFP_ATTACHMENT_URL_TTL_SECONDS <= 3600, String(P.RFP_ATTACHMENT_URL_TTL_SECONDS));

  // ── B. the stored form, and no public URL built anywhere else ──
  const PROJECT = 'https://nteoqhcswappxxjlpvap.supabase.co';
  const asUrl = `${PROJECT}/storage/v1/object/public/rfp-attachments/${good}`;
  {
    const offenders: string[] = [];
    for (const [file, raw] of Object.entries(files)) {
      if (file === MIGRATION || file === FLIP || file === BID_GUARD) continue;
      const src = stripComments(raw);
      if (/from\(\s*(['"`]rfp-attachments['"`]|RFP_ATTACHMENT_BUCKET)\s*\)\s*\.getPublicUrl/.test(src)) offenders.push(`${file}: getPublicUrl on the bucket`);
      const typed = (src.match(/object\/public\/(rfp-attachments|\$\{RFP_ATTACHMENT_BUCKET\})/g) ?? []).length;
      if (typed > (file === PATH_FILE ? 1 : 0)) offenders.push(`${file}: a typed /object/public/ URL for the bucket`);
      // A file that names the bucket must not call getPublicUrl at all, unless it is a file with other, public buckets (storage.ts).
      if (/rfp-attachments|RFP_ATTACHMENT_BUCKET/.test(src) && /getPublicUrl/.test(src) && file !== STORAGE_FILE) offenders.push(`${file}: names the bucket and calls getPublicUrl`);
    }
    const pathSrc = stripComments(files[PATH_FILE]);
    const svAt = pathSrc.indexOf('export function rfpAttachmentStoredValue');
    const svEnd = pathSrc.indexOf('\nexport ', svAt + 10);
    const sv = svAt === -1 ? '' : pathSrc.slice(svAt, svEnd === -1 ? undefined : svEnd);
    if (!/object\/public\/\$\{RFP_ATTACHMENT_BUCKET\}/.test(sv)) offenders.push(`${PATH_FILE}: the one public URL is not inside rfpAttachmentStoredValue`);
    ok('B1 no file calls getPublicUrl on rfp-attachments, and the one typed public URL is the value to store (rfpAttachmentStoredValue)', offenders.length === 0, offenders.join('; '));
    const storage = stripComments(files[STORAGE_FILE]);
    const fnAt = storage.indexOf('export async function uploadRfpAttachment');
    const fnEnd = storage.indexOf('\nexport ', fnAt + 10);
    const fn = fnAt === -1 ? '' : storage.slice(fnAt, fnEnd === -1 ? undefined : fnEnd);
    ok('B2 uploadRfpAttachment stores what the one constant says (rfpAttachmentStoredValue) and builds nothing itself', fn.length > 0 && /return rfpAttachmentStoredValue\(path, SUPABASE_URL\) \?\? path;/.test(fn) && !/getPublicUrl|publicUrl|createSignedUrl|object\/public/.test(fn), fn.length === 0 ? 'function not found' : '');
    ok('B3 the upload path is <userId>/<rfpId>/<stamp>_<name>, the shape the read policy and the server rule expect', /const path = `\$\{userId\}\/\$\{rfpId\}\/\$\{Date\.now\(\)\}_\$\{safeName\}`;/.test(fn));
    ok('B4 the stored value: under public_url it is exactly the legacy public URL (what a build before this one renders); under path it is the bare path; a bad path stores nothing',
      P.rfpAttachmentStoredValue(good, PROJECT, 'public_url') === asUrl && P.rfpAttachmentStoredValue(good, `${PROJECT}/`, 'public_url') === asUrl
      && P.rfpAttachmentStoredValue(good, PROJECT, 'path') === good && P.rfpAttachmentStoredValue(good, '', 'public_url') === good
      && P.rfpAttachmentStoredValue(`${U}/../x`, PROJECT, 'public_url') === null && P.rfpAttachmentStoredValue('https://example.com/a.jpg', PROJECT, 'path') === null);
    ok('B5 the constant is public_url in this build: the bucket is still public and older builds render only a URL. Change it to path, and this pin with it, in the first update AFTER 20261010140000_rfp_attachments_flip.sql is applied',
      P.RFP_ATTACHMENT_STORED_FORM === 'public_url' && P.rfpAttachmentStoredValue(good, PROJECT) === asUrl, String(P.RFP_ATTACHMENT_STORED_FORM));
    ok('B6 both stored forms name the same path on this build', P.rfpAttachmentPath(P.rfpAttachmentStoredValue(good, PROJECT, 'public_url')) === good && P.rfpAttachmentPath(P.rfpAttachmentStoredValue(good, PROJECT, 'path')) === good);
  }
  // The resolver, run. Storage is played by a stub: `refuse` is a bucket with no read policy yet, or a
  // caller the rule does not admit; `grant` signs; `down` is no network.
  {
    const signed = (p: string): string => `${PROJECT}/storage/v1/object/sign/rfp-attachments/${p}?token=t`;
    const refuse: SignStub = (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: null, error: 'Either the object does not exist or you do not have access' })), error: null });
    const grant: SignStub = (paths) => ({ data: paths.map((p) => ({ path: p, signedUrl: signed(p) })), error: null });
    const down: SignStub = () => Promise.reject(new Error('network'));
    const other = 'https://example.com/a.jpg';
    const local = `file:///var/mobile/${good}`;
    const constant = /export const RFP_ATTACHMENT_STORED_FORM: RfpAttachmentStoredForm = '(public_url|path)';/;
    const rows: string[] = [];
    let cOk = constant.test(files[PATH_FILE]);
    for (const form of ['public_url', 'path'] as const) {
      const pathSrc = files[PATH_FILE].replace(constant, `export const RFP_ATTACHMENT_STORED_FORM: RfpAttachmentStoredForm = '${form}';`);
      for (const [world, stub] of [['refuse', refuse], ['grant', grant], ['down', down]] as const) {
        const M = await evalUrlsModule(pathSrc, files[URLS_FILE], stub);
        const map = await M.resolveRfpAttachmentUrls([asUrl, good, other, local, null, '']);
        const tap = await M.signRfpAttachment(other);
        rows.push(`${form}/${world}: url=${map.get(asUrl) === signed(good) ? 'signed' : map.get(asUrl) === asUrl ? 'stored' : map.get(asUrl) === '' ? 'none' : '?'} path=${map.get(good) === signed(good) ? 'signed' : map.get(good) === '' ? 'none' : '?'} other=${map.get(other) === '' && map.get(local) === '' && tap === '' ? 'dropped' : 'SHOWN'}`);
      }
    }
    const want = [
      'public_url/refuse: url=stored path=none other=dropped',
      'public_url/grant: url=signed path=signed other=dropped',
      'public_url/down: url=stored path=none other=dropped',
      'path/refuse: url=none path=none other=dropped',
      'path/grant: url=signed path=signed other=dropped',
      'path/down: url=none path=none other=dropped',
    ];
    if (rows.length !== want.length) cOk = false;
    ok('B7 the resolver, run for both stored forms under both settings of the constant: Storage granting, both forms come back signed (before and after the flip)',
      cOk && rows.filter((r) => r.includes('/grant')).join(' | ') === want.filter((r) => r.includes('/grant')).join(' | '), rows.join(' | '));
    ok('B8 with no link granted, a stored public URL is shown only while the constant says the bucket is public; a bare path shows nothing; nothing throws with no network',
      cOk && rows.filter((r) => !r.includes('/grant')).join(' | ') === want.filter((r) => !r.includes('/grant')).join(' | '), rows.join(' | '));
    ok('B9 a stored value that is not in this bucket is dropped in every case: never rendered, never opened', cOk && rows.length === 6 && rows.every((r) => r.endsWith('other=dropped')), rows.join(' | '));
    ok('B10 the pure rule agrees: not in the bucket is nothing even when a link is offered', P.rfpAttachmentResolved(other, signed(good)) === '' && P.rfpAttachmentResolved(null, signed(good)) === '' && P.rfpAttachmentResolved(good, signed(good), 'path') === signed(good));
  }

  // ── C. the readers ──
  {
    const urls = stripComments(files[URLS_FILE]);
    ok('C1 the resolver signs with createSignedUrls on the bucket and the one-hour TTL', /\.from\(RFP_ATTACHMENT_BUCKET\)\s*\.createSignedUrls\([^;]{0,80}, RFP_ATTACHMENT_URL_TTL_SECONDS\);/.test(urls));
    const found = findReaders(files);
    const unlisted = found.filter((f) => !(f in READER_ROLES));
    const stale = Object.keys(READER_ROLES).filter((f) => !found.includes(f));
    ok(`C0 the scan finds ${found.length} files that read or write public_bids.photo_urls / drawing_urls and every one is classified`,
      unlisted.length === 0 && stale.length === 0 && found.length >= 5,
      [unlisted.length ? `NEW, unclassified: ${unlisted.join(', ')} (make it sign through utils/rfpAttachmentUrls, then add it to READER_ROLES)` : '', stale.length ? `no longer found: ${stale.join(', ')}` : ''].filter(Boolean).join('; '));
    for (const f of found) {
      const role = READER_ROLES[f] ?? 'renders';
      const src = stripCommentsSafe(files[f] ?? '');
      if (role === 'renders') ok(`C3 ${f} resolves through useRfpAttachmentUrls`, /useRfpAttachmentUrls\(/.test(src));
      const bad = unsignedUses(files[f] ?? '');
      ok(`C4 ${f} hands no stored value to an <Image>, Linking or a browser`, bad.length === 0, bad.join('; '));
    }
    const detail = stripComments(files['app/rfp-detail.tsx'] ?? '');
    ok('C5 rfp-detail opens an attachment with a link minted at the tap, and says Could Not Open when there is none', /signRfpAttachment\(stored\)/.test(detail) && !/Linking\.openURL\(stored\)/.test(detail) && /if \(!url\) \{ showAlert\('Could Not Open'/.test(detail));
    const ctx = stripComments(files['contexts/ProjectContext.tsx'] ?? '');
    ok('C6 the project photo loader signs a carried posting photo in its own bucket, never as a project-photos path',
      /looksLikeStoragePath\(v\) && !isRfpAttachmentRef\(v\)/.test(ctx) && /resolveRfpAttachmentUrls\(rfpRefs\)/.test(ctx));
    // The scan itself, on a made-up file: it must see through a renamed copy.
    const probe = "const { data } = await supabase.from('public_bids').select('photo_urls');\nconst first = row.photo_urls?.[0];\nconst copy = first;\nreturn <Image source={{ uri: copy }} />;";
    const probeOk = "const attachmentUrl = useRfpAttachmentUrls(refs);\nconst first = row.photo_urls?.[0];\nconst shown = attachmentUrl(first);\nreturn <Image source={{ uri: shown }} />;";
    ok('C7 the reader scan catches a stored value passed on under another name, and passes a signed one', unsignedUses(probe).length === 1 && unsignedUses(probeOk).length === 0, JSON.stringify([unsignedUses(probe), unsignedUses(probeOk)]));
  }

  // ── D. the migrations ──
  {
    const sql = stripSqlComments(files[MIGRATION]);
    const flip = stripSqlComments(files[FLIP]);
    const guardAt = flip.indexOf("current_setting('mageid.founder_ok_rfp_private', true)");
    const flipAt = flip.indexOf("update storage.buckets set public = false where id = 'rfp-attachments'");
    const preAt = flip.indexOf("to_regprocedure('public.can_read_rfp_attachment(text)') is null");
    ok('D1 part 2 refuses to run without the opt-in line, before anything else', guardAt !== -1 && flipAt !== -1 && guardAt < flipAt && /raise exception 'held: rfp-attachments stays public/.test(flip));
    ok('D2 part 1 has no gate and never touches the bucket flag; only part 2 flips it, after checking part 1 is applied and no read policy is bucket-less',
      !/founder_ok_rfp_private/.test(sql) && !/update\s+storage\.buckets/i.test(sql) && !/public\s*=\s*false/i.test(sql)
      && preAt !== -1 && preAt < flipAt && /coalesce\(qual, ''\) not like '%bucket_id%'/.test(flip) && flip.indexOf("not like '%bucket_id%'") < flipAt
      && !/create policy|create or replace function|drop policy/i.test(flip));
    ok('D3 the one read policy is for authenticated only and names the bucket and the rule',
      /create policy rfp_attachments_read on storage\.objects\s+for select to authenticated\s+using \(\s*bucket_id = 'rfp-attachments'\s+and public\.can_read_rfp_attachment\(objects\.name\)\s*\);/.test(sql));
    ok('D4 the rule is SECURITY DEFINER with an empty search_path', /create or replace function public\.can_read_rfp_attachment\(p_name text\)\s+returns boolean\s+language plpgsql\s+stable\s+security definer\s+set search_path to ''/.test(sql));
    ok('D5 anon cannot call the rule', /revoke all on function public\.can_read_rfp_attachment\(text\) from public, anon;/.test(sql) && !/grant execute on function public\.can_read_rfp_attachment\(text\) to[^;]*\banon\b/.test(sql));
    ok('D6 a signed-out caller is refused inside the rule', /if v_uid is null or p_name is null then\s+return false;/.test(sql));
    ok('D7 someone else\'s folder opens only through that owner\'s posting: while it is open, or for the awarded bidder; a bid row by itself opens nothing',
      /b\.user_id = v_owner::uuid/.test(sql)
      && /\(b\.status = 'open' and b\.awarded_response_id is null\)\s+or exists \(\s*select 1\s+from public\.bid_responses r\s+where r\.id = b\.awarded_response_id\s+and r\.bid_id = b\.id\s+and r\.user_id = v_uid\s+and r\.status = 'awarded'/.test(sql)
      && !/where r\.bid_id = b\.id and r\.user_id = v_uid\)/.test(sql));
    ok('D8 neither file touches another bucket or drops an owner policy', !/plan-sheets|project-photos|worker-ids/.test(sql + flip) && !/drop policy if exists rfp_attachments_owner/.test(sql + flip));
    ok('D9 both self-checks refuse a leftover public or anon read policy', /roles && array\['public', 'anon'\]::name\[\]/.test(sql) && /roles && array\['public', 'anon'\]::name\[\]/.test(flip));
    const guard = stripSqlComments(files[BID_GUARD]);
    ok('D10 the bid guard stores a bid on a posting that is not open as withdrawn (pinned, never raised) and stamps the date itself',
      /new\.created_at := pg_catalog\.now\(\);/.test(guard)
      && /if found and \(coalesce\(v_post_status, ''\) <> 'open' or v_post_award is not null\) then\s+new\.status := 'withdrawn';\s+end if;/.test(guard)
      && /if new\.created_at is distinct from old\.created_at then\s+raise exception/.test(guard));
    const header = files[MIGRATION] + files[FLIP];
    ok('D11 the headers say what stays exposed and list the three preconditions of the flip',
      /WHAT STAYS EXPOSED AFTER BOTH PARTS/.test(header) && /READ THE FILES OF EVERY OPEN POSTING/.test(header) && /chooses the lifetime of the link it signs/.test(header)
      && /THE APP UPDATE HAS REACHED PHONES/.test(header) && /storage\.objects POLICIES HAVE BEEN READ/.test(header) && /THE AWARD PATH/.test(header));
  }
  return results;
}

// ── E. planted mutations ──
interface Mutation { name: string; file: string; from: string | RegExp; to: string; red: string; add?: boolean }
const UPLOAD_RETURN = "    return rfpAttachmentStoredValue(path, SUPABASE_URL) ?? path;";
const MUTATIONS: Mutation[] = [
  { name: 'the upload returns getPublicUrl again', file: STORAGE_FILE, from: UPLOAD_RETURN, to: "    return supabase.storage.from('rfp-attachments').getPublicUrl(path).data.publicUrl;", red: 'B1' },
  { name: 'the upload returns a URL built by hand', file: STORAGE_FILE, from: UPLOAD_RETURN, to: '    return `${SUPABASE_URL}/storage/v1/object/public/rfp-attachments/${path}`;', red: 'B1' },
  { name: 'the upload returns the bare path whatever the constant says', file: STORAGE_FILE, from: UPLOAD_RETURN, to: '    return path;', red: 'B2' },
  { name: 'the stored value is the bare path under public_url', file: PATH_FILE, from: "  if (form === 'path') return path;", to: '  if (form) return path;', red: 'B4' },
  { name: 'the constant is changed to path before the flip', file: PATH_FILE, from: "export const RFP_ATTACHMENT_STORED_FORM: RfpAttachmentStoredForm = 'public_url';", to: "export const RFP_ATTACHMENT_STORED_FORM: RfpAttachmentStoredForm = 'path';", red: 'B5' },
  { name: 'a second public URL is built in the path module', file: PATH_FILE, from: 'export function isRfpAttachmentRef(', to: 'export const legacyUrl = (p: string): string => `x/storage/v1/object/public/${RFP_ATTACHMENT_BUCKET}/${p}`;\nexport function isRfpAttachmentRef(', red: 'B1' },
  { name: 'a bare path falls back to a built public URL', file: PATH_FILE, from: "return form === 'public_url' && isHttp(stored) && rfpAttachmentPath(stored) !== null ? stored : '';", to: "return form === 'public_url' && isHttp(stored) && rfpAttachmentPath(stored) !== null ? stored : `https://x.supabase.co/storage/v1/object/sign/rfp-attachments/${stored}`;", red: 'A8' },
  { name: 'the public URL fallback outlives the flip', file: PATH_FILE, from: "return form === 'public_url' && isHttp(stored) && rfpAttachmentPath(stored) !== null ? stored : '';", to: "return isHttp(stored) && rfpAttachmentPath(stored) !== null ? stored : '';", red: 'B8' },
  { name: 'any http value is a fallback', file: PATH_FILE, from: "return form === 'public_url' && isHttp(stored) && rfpAttachmentPath(stored) !== null ? stored : '';", to: "return form === 'public_url' && isHttp(stored) ? stored : '';", red: 'A8' },
  { name: 'the resolver shows a value that is not in the bucket', file: URLS_FILE, from: "    if (!path) { out.set(v, ''); continue; }", to: '    if (!path) { out.set(v, v); continue; }', red: 'B9' },
  { name: 'the resolver ignores a granted link for a stored URL', file: URLS_FILE, from: 'for (const stored of byPath.get(path) ?? []) out.set(stored, rfpAttachmentResolved(stored, signedUrl));', to: 'for (const stored of byPath.get(path) ?? []) if (stored === path) out.set(stored, signedUrl);', red: 'B7' },
  { name: 'the resolver throws with no network', file: URLS_FILE, from: '    } catch { /* offline: the fallbacks stand */ }', to: '    } catch (e) { throw e; }', red: 'B8' },
  { name: 'the rule resolves a value outside the bucket when a link is offered', file: PATH_FILE, from: "  if (typeof stored !== 'string' || rfpAttachmentPath(stored) === null) return '';\n  if (typeof signedUrl", to: "  if (typeof stored !== 'string') return '';\n  if (typeof signedUrl", red: 'B10' },
  { name: 'the path rule accepts any bucket', file: PATH_FILE, from: '    if (!rest.startsWith(prefix)) return null;\n    candidate = rest.slice(prefix.length);', to: "    candidate = rest.slice(rest.indexOf('/') + 1);", red: 'A5' },
  { name: 'the path rule accepts any three segments', file: PATH_FILE, from: 'return RFP_ATTACHMENT_PATH_RE.test(candidate) ? candidate : null;', to: "return candidate.split('/').length === 3 ? candidate : null;", red: 'A5' },
  { name: 'the client shape drifts from the server rule', file: PATH_FILE, from: '[0-9]{1,16}_[A-Za-z0-9._-]*$', to: '[0-9]{1,20}_[A-Za-z0-9._-]*$', red: 'A6' },
  { name: 'links live a week', file: PATH_FILE, from: 'export const RFP_ATTACHMENT_URL_TTL_SECONDS = 60 * 60;', to: 'export const RFP_ATTACHMENT_URL_TTL_SECONDS = 7 * 24 * 60 * 60;', red: 'A9' },
  { name: 'the posting page shows the stored value', file: 'app/rfp-detail.tsx', from: 'source={{ uri: attachmentUrl(stored) || undefined }}', to: 'source={{ uri: stored }}', red: 'C4' },
  { name: 'My Projects shows the stored value', file: 'app/my-rfps.tsx', from: 'source={{ uri: attachmentUrl(heroPhoto) || undefined }}', to: 'source={{ uri: heroPhoto }}', red: 'C4' },
  { name: 'the bids tab shows the stored value (browse card)', file: 'app/(tabs)/mage-id-bids/index.tsx', from: '          <Image source={{ uri: attachmentUrl(heroPhoto) }} style={styles.rfpHero} resizeMode="cover" />\n        ) : null}', to: '          <Image source={{ uri: heroPhoto }} style={styles.rfpHero} resizeMode="cover" />\n        ) : null}', red: 'C4' },
  { name: 'the homeowner home card shows the stored value', file: 'components/ClientHome.tsx', from: 'source={{ uri: heroUri }}', to: 'source={{ uri: heroPhoto as string }}', red: 'C4' },
  { name: 'the homeowner home card shows the stored value under another name', file: 'components/ClientHome.tsx', from: '  const heroUri = attachmentUrl(heroPhoto);', to: '  const heroUri = heroPhoto;', red: 'C4' },
  { name: 'the bids tab stops using the resolver', file: 'app/(tabs)/mage-id-bids/index.tsx', from: '  const attachmentUrl = useRfpAttachmentUrls(heroRefs);', to: "  const attachmentUrl = (v: string): string => (v ? '' : '');", red: 'C3' },
  { name: 'a NEW screen reads the columns and is not classified', file: 'components/NewRfpCard.tsx', add: true, from: '', to: "import { supabase } from '@/lib/supabase';\nexport const q = () => supabase.from('public_bids').select('id,photo_urls');\n", red: 'C0' },
  { name: 'an attachment opens the stored value', file: 'app/rfp-detail.tsx', from: 'void signRfpAttachment(stored).then((url) => {', to: 'void Promise.resolve(stored).then((url) => {', red: 'C5' },
  { name: 'an attachment opens the stored value directly', file: 'app/rfp-detail.tsx', from: 'onPress={() => openAttachment(stored)} activeOpacity={0.85}', to: 'onPress={() => Linking.openURL(stored)} activeOpacity={0.85}', red: 'C4' },
  { name: 'part 2 loses its guard', file: FLIP, from: "    raise exception 'held: rfp-attachments stays public", to: "    raise notice 'held: rfp-attachments stays public", red: 'D1' },
  { name: 'part 1 flips the bucket by itself', file: MIGRATION, from: '-- ── self-check ─', to: "update storage.buckets set public = false where id = 'rfp-attachments';\n-- ── self-check ─", red: 'D2' },
  { name: 'part 2 no longer checks for a bucket-less read policy', file: FLIP, from: "     and coalesce(qual, '') not like '%bucket_id%';", to: '     and false;', red: 'D2' },
  { name: 'the read policy is for everyone', file: MIGRATION, from: 'for select to authenticated\n  using (\n    bucket_id = \'rfp-attachments\'', to: "for select to public\n  using (\n    bucket_id = 'rfp-attachments'", red: 'D3' },
  { name: 'the rule runs with the caller\'s search_path', file: MIGRATION, from: "stable\nsecurity definer\nset search_path to ''", to: 'stable\nsecurity definer\nset search_path to public', red: 'D4' },
  { name: 'anon may call the rule', file: MIGRATION, from: 'revoke all on function public.can_read_rfp_attachment(text) from public, anon;', to: '', red: 'D5' },
  { name: 'a closed posting stays readable', file: MIGRATION, from: "         (b.status = 'open' and b.awarded_response_id is null)\n", to: '         true\n', red: 'D7' },
  { name: 'any bid row on the posting opens it (the first draft)', file: MIGRATION, from: "            where r.id = b.awarded_response_id\n              and r.bid_id = b.id", to: '            where r.bid_id = b.id', red: 'D7' },
  { name: 'a late bid is refused with a raise', file: BID_GUARD, from: "      new.status := 'withdrawn';\n", to: "      raise exception 'closed' using errcode = '42501';\n", red: 'D10' },
  { name: 'the header stops saying what stays exposed', file: MIGRATION, from: 'READ THE FILES OF EVERY OPEN POSTING', to: 'read some files', red: 'D11' },
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
  const src = m.add ? '' : files[m.file];
  const out = m.add ? m.to : (typeof m.from === 'string' ? src.replace(m.from, m.to) : src.replace(m.from, m.to));
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
