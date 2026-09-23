// validate-w5-scan-files-files.ts — Project Files tells the truth (wave 5).
//
//   #5   uploadProjectFile takes BYTES, refuses an empty file, reads the
//        object back and removes + throws on a 0-byte landing; a retry that
//        collides with its own earlier copy (same name, same size) succeeds
//   #159 a failed folder read is `failed`, not an empty folder; a failed tile
//        count is null ("—"), and the other folders keep their counts
//   #160 a delete RLS silently refused throws "Not removed"; Delete is
//        disabled below editor with the reason; Open re-signs and refuses an
//        empty link; the "stable URL you can share" / "public-read" claims go
//
// Behaviour runs against the REAL module with a fake storage client (the
// same Bun.plugin trick as validate-project-file-urls), so a regression in the
// code fails here, not just a regex.
//
// Run: bun run scripts/validate-w5-scan-files-files.ts
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

// ── fake storage ────────────────────────────────────────────────────────────
type ListRes = { data: { name: string; created_at?: string; metadata?: { size?: number } }[] | null; error: unknown };
const calls: string[] = [];
let listImpl: (dir: string, opts?: { search?: string }) => Promise<ListRes> = async () => ({ data: [], error: null });
let uploadImpl: (path: string, body: unknown) => Promise<{ data: unknown; error: { message: string } | null }> =
  async () => ({ data: {}, error: null });
let removeImpl: (paths: string[]) => Promise<{ data: unknown[] | null; error: { message: string } | null }> =
  async (paths) => ({ data: paths.map(name => ({ name })), error: null });
const uploadedBodies: unknown[] = [];

const api = {
  list: async (dir: string, opts?: { search?: string }) => { calls.push(`list:${dir}:${opts?.search ?? ''}`); return listImpl(dir, opts); },
  upload: async (path: string, body: unknown) => { calls.push(`upload:${path}`); uploadedBodies.push(body); return uploadImpl(path, body); },
  remove: async (paths: string[]) => { calls.push(`remove:${paths.join(',')}`); return removeImpl(paths); },
  createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/project-documents/${p}?token=t` }, error: null }),
  createSignedUrls: async (ps: string[]) => ({ data: ps.map(p => ({ path: p, signedUrl: `https://x.supabase.co/storage/v1/object/sign/project-documents/${p}?token=t` })), error: null }),
};
const supabaseStub = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
  storage: { from: () => api },
};
interface VirtualModuleBuilder { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }
interface BunGlobal { plugin(def: { name: string; setup: (b: VirtualModuleBuilder) => void }): void }
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) { console.error('must run under bun'); process.exit(1); }
bun.plugin({
  name: 'stub-supabase-w5-files',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: supabaseStub, isSupabaseConfigured: true }, loader: 'object' }));
  },
});
const pf = await import('../utils/projectFiles');

// ── #5 upload ───────────────────────────────────────────────────────────────
console.log('\n#5 uploads carry bytes and are read back:');
{
  const bytes = new Uint8Array([1, 2, 3, 4]);
  listImpl = async (_d, o) => ({ data: [{ name: o?.search ?? '', metadata: { size: 4 } }], error: null });
  calls.length = 0; uploadedBodies.length = 0;
  const up = await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'coi-p1.jpg', bytes, contentType: 'image/jpeg' });
  ok('the Uint8Array itself is what supabase-js uploads', uploadedBodies[0] === bytes);
  eq('size is the byte length', up.size, 4);
  ok('the object is read back after upload', calls.some(c => c === 'list:p1/contracts:coi-p1.jpg'), calls.join(' | '));

  let threw = '';
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'e.jpg', bytes: new Uint8Array(0) }); }
  catch (e) { threw = (e as Error).message; }
  eq('an empty file is refused before any upload', threw, 'That file is empty.');

  listImpl = async (_d, o) => ({ data: [{ name: o?.search ?? '', metadata: { size: 0 } }], error: null });
  calls.length = 0; threw = '';
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'z.jpg', bytes }); }
  catch (e) { threw = (e as Error).message; }
  ok('a 0-byte landing THROWS (so Scan keeps the capture)', /0 bytes/.test(threw), threw);
  ok('…and the empty object is removed', calls.includes('remove:p1/contracts/z.jpg'), calls.join(' | '));
  // Review round 1: a field seat's remove() matches nothing — the caller is
  // told the empty copy is still there, and why.
  removeImpl = async () => ({ data: [], error: null });
  let emptyErr: unknown = null;
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'f.jpg', bytes }); } catch (e) { emptyErr = e; }
  ok('an empty copy that could NOT be removed is reported as such (removed=false)',
    emptyErr instanceof pf.ProjectFileEmptyError && emptyErr.removed === false && /could not be removed/.test(emptyErr.message), String(emptyErr));
  removeImpl = async (paths) => ({ data: paths.map(name => ({ name })), error: null });
  emptyErr = null;
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'g.jpg', bytes }); } catch (e) { emptyErr = e; }
  ok('…and one that was removed says removed=true', emptyErr instanceof pf.ProjectFileEmptyError && emptyErr.removed === true);
  // A retry colliding with an earlier EMPTY copy is not "Upload failed: exists".
  uploadImpl = async () => ({ data: null, error: { message: 'The resource already exists' } });
  emptyErr = null;
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'z.jpg', bytes }); } catch (e) { emptyErr = e; }
  ok('a collision with a 0-byte copy says what to do (not a bare "already exists")',
    emptyErr instanceof pf.ProjectFileEmptyError && emptyErr.removed === false && /empty \(0-byte\) copy of z\.jpg/.test(emptyErr.message), String(emptyErr));
  uploadImpl = async () => ({ data: {}, error: null });

  listImpl = async () => ({ data: null, error: { message: 'offline' } });
  let okUnknown = true;
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'u.jpg', bytes }); } catch { okUnknown = false; }
  ok('a read-back that cannot answer does not fail an accepted upload', okUnknown);

  uploadImpl = async () => ({ data: null, error: { message: 'The resource already exists' } });
  listImpl = async (_d, o) => ({ data: [{ name: o?.search ?? '', metadata: { size: 4 } }], error: null });
  let retried = true;
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'r.jpg', bytes }); } catch { retried = false; }
  ok('a retry colliding with its own earlier copy (same size) counts as landed', retried);
  listImpl = async (_d, o) => ({ data: [{ name: o?.search ?? '', metadata: { size: 999 } }], error: null });
  threw = '';
  try { await pf.uploadProjectFile({ projectId: 'p1', folderKey: 'contracts', fileName: 'r.jpg', bytes }); } catch (e) { threw = (e as Error).message; }
  ok('…but a DIFFERENT file with that name is still a collision', /Upload failed/.test(threw), threw);
  uploadImpl = async () => ({ data: {}, error: null });
}

// ── #159 honest reads ───────────────────────────────────────────────────────
console.log('\n#159 a failed read is not an empty folder:');
{
  listImpl = async () => ({ data: null, error: { message: 'Failed to fetch' } });
  const failed = await pf.listProjectFilesChecked('p1', 'contracts');
  eq('an errored list is failed', failed, { files: [], failed: true });
  listImpl = async () => { throw new TypeError('Network request failed'); };
  eq('a thrown list is failed', await pf.listProjectFilesChecked('p1', 'contracts'), { files: [], failed: true });
  listImpl = async () => ({ data: [], error: null });
  eq('a missing folder is a real, successful empty', await pf.listProjectFilesChecked('p1', 'contracts'), { files: [], failed: false });
  listImpl = async (dir) => (dir.endsWith('/permits') ? { data: null, error: { message: '503' } } : { data: [{ name: 'a.pdf', metadata: { size: 3 } }], error: null });
  const counts = await pf.countProjectFilesByFolder('p1');
  eq('a failed folder counts null', counts.permits, null);
  eq('…and the other folders keep their counts', [counts.plans, counts.contracts, counts.financials], [1, 1, 1]);
}

// ── #160 delete refused ─────────────────────────────────────────────────────
console.log('\n#160 a refused delete says so:');
{
  removeImpl = async () => ({ data: [], error: null });
  let threw = '';
  try { await pf.deleteProjectFile('p1/contracts/a.pdf'); } catch (e) { threw = (e as Error).message; }
  eq('RLS matching nothing (the file still there) throws Not removed', threw, pf.PROJECT_FILE_DELETE_REFUSED);
  // Review round 1: an empty answer is also what an already-deleted file gives.
  const savedList = listImpl;
  listImpl = async () => ({ data: [], error: null });
  let gone = true;
  try { await pf.deleteProjectFile('p1/contracts/a.pdf'); } catch { gone = false; }
  ok('a file another device already deleted is not blamed on the role', gone);
  listImpl = async () => ({ data: null, error: { message: 'offline' } });
  threw = '';
  try { await pf.deleteProjectFile('p1/contracts/a.pdf'); } catch (e) { threw = (e as Error).message; }
  eq('…and when the read-back cannot answer, it says it could not confirm', threw, pf.PROJECT_FILE_DELETE_UNCONFIRMED);
  listImpl = savedList;
  ok('…naming who can delete', /only the job owner or an editor/.test(pf.PROJECT_FILE_DELETE_REFUSED));
  removeImpl = async (paths) => ({ data: paths.map(name => ({ name })), error: null });
  let removed = true;
  try { await pf.deleteProjectFile('p1/contracts/a.pdf'); } catch { removed = false; }
  ok('a real delete still succeeds', removed);
}

// ── source guards (React Native screens can't mount under bun) ─────────────
console.log('\nProject Files screen:');
{
  const B = strip(readFileSync('components/ProjectFilesBrowser.tsx', 'utf8'));
  const RAW = readFileSync('components/ProjectFilesBrowser.tsx', 'utf8');
  ok('the browser reads through the checked listing', /listProjectFilesChecked\(projectId, activeFolder\)/.test(B));
  ok('a failed folder shows the failure + Retry before the empty state',
    B.indexOf('filesFailed ?') > 0 && B.indexOf('filesFailed ?') < B.indexOf('files.length === 0 ?'));
  ok('a failed tile shows "—", never "0 files"', /count == null \? '—'/.test(B) && !/counts\[f\.key\] \?\? 0/.test(B));
  ok('the grid says the read failed, with Retry', /countsFailed && !loadingCounts/.test(B) && /refreshCounts\(\)/.test(B));
  ok('the false "stable URL you can share" claim is gone', !/stable URL/i.test(RAW));
  ok('the "public-read" header claim is gone', !/public-read, auth-only-write/.test(RAW));
  ok('Delete is disabled below editor, with the reason',
    /useProjectRoleState\(projectId\)/.test(B) && /role !== 'viewer' && role !== 'field'/.test(B) && /DELETE_NEEDS_EDITOR/.test(B));
  ok('Open re-signs the file on tap', /resolveProjectFileUrl\(file\.path\)/.test(B));
  ok('Open failures are shown, not voided', /showAlert\("Couldn't open file"/.test(B));
  // Raw source: the comment stripper would eat the `\/\/` inside the regex.
  const D = readFileSync('utils/projectDocuments.ts', 'utf8');
  const body = D.slice(D.indexOf('export async function openSavedDocument'), D.indexOf('export async function openSavedDocument') + 300);
  ok('openSavedDocument refuses a non-http link before opening anything',
    body.includes('throw new Error(OPEN_DOCUMENT_NO_LINK)') && body.indexOf('throw new Error(OPEN_DOCUMENT_NO_LINK)') < body.indexOf('window.open'));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} w5 scan-files (files): ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
