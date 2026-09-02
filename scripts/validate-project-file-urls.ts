// validate-project-file-urls.ts — pins the fix for the dead project-document
// URLs and guards it against regressing.
//
// WHY THIS EXISTS. `project-documents` is a PRIVATE Supabase Storage bucket
// (storage.buckets.public = false; policy project_docs_select is
// `bucket_id = 'project-documents' AND owner = auth.uid()`), but a comment at
// the top of utils/projectFiles.ts asserted the opposite — "authenticated-write
// + public-read for now ... same pattern as plan-sheets" — and the code
// believed it. Every filed document was handed a
// `/storage/v1/object/public/project-documents/...` URL, which a private bucket
// answers with HTTP 400 {"statusCode":"404","error":"Bucket not found"}.
//
// The upload itself succeeded, so the user got a success toast and then:
//   - the COI Vault tile for a freshly scanned certificate stayed blank forever
//   - tapping a file in the Project Files browser opened a JSON error blob
//   - saved daily-report PDFs pointed at nothing
// The bytes were in the bucket. Nothing in the app could render them. From the
// contractor's side every document they filed was gone.
//
// The fix is the read-time-signing pattern utils/storage.ts (photos) and
// utils/contractSealing.ts (sealed PDFs) already follow: persist the storage
// PATH, mint a short-lived signed URL when you actually need to show it.
//
// This guard asserts, in order of what matters:
//   1. BEHAVIOUR — listProjectFiles / uploadProjectFile emit signed URLs, not
//      `/object/public/` ones, driven through a stubbed storage client.
//   2. RECOVERY — projectFileStoragePath() turns an already-persisted dead
//      public URL (and an expired signed URL) back into a storage path, so the
//      rows written before this fix are not lost.
//   3. NO REGROWTH — getPublicUrl() must never come back into this module.
//
// Run: bun run scripts/validate-project-file-urls.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

// ── stub the network edge ───────────────────────────────────────────────────
// utils/projectFiles.ts imports `@/lib/supabase`, which pulls in react-native
// and crashes bun. A virtual module gives us the real module under test with a
// fake storage client, so this is a behaviour test and not a grep.
const BUCKET = 'project-documents';
const SUPABASE_HOST = 'https://nteoqhcswappxxjlpvap.supabase.co';

const calls: string[] = [];
let listResponse: { data: unknown[] | null; error: unknown } = { data: [], error: null };
let signOk = true;

const storageFileApi = {
  list: async () => { calls.push('list'); return listResponse; },
  getPublicUrl: (path: string) => {
    // Deliberately reachable so the guard can prove the module stopped calling
    // it, rather than proving only that a regex did not match.
    calls.push('getPublicUrl');
    return { data: { publicUrl: `${SUPABASE_HOST}/storage/v1/object/public/${BUCKET}/${path}` } };
  },
  createSignedUrl: async (path: string) => {
    calls.push('createSignedUrl');
    if (!signOk) return { data: null, error: { message: 'offline' } };
    return { data: { signedUrl: `${SUPABASE_HOST}/storage/v1/object/sign/${BUCKET}/${path}?token=tok` }, error: null };
  },
  createSignedUrls: async (paths: string[]) => {
    calls.push('createSignedUrls');
    if (!signOk) return { data: null, error: { message: 'offline' } };
    return {
      data: paths.map(p => ({ path: p, signedUrl: `${SUPABASE_HOST}/storage/v1/object/sign/${BUCKET}/${p}?token=tok`, error: null })),
      error: null,
    };
  },
  upload: async () => { calls.push('upload'); return { data: { path: 'x' }, error: null }; },
  remove: async () => ({ data: [], error: null }),
};

const supabaseStub = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
  storage: { from: () => storageFileApi },
};

// Reached off globalThis rather than `import { plugin } from 'bun'` because the
// repo has no bun type declarations and `npx tsc --noEmit` covers scripts/ —
// the import is a TS2307 even though it runs fine.
interface VirtualModuleBuilder {
  module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}
interface BunGlobal {
  plugin(def: { name: string; setup: (build: VirtualModuleBuilder) => void }): void;
}
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) {
  console.error('\n✗ validate-project-file-urls must run under bun (needs Bun.plugin to stub @/lib/supabase)\n');
  process.exit(1);
}
bun.plugin({
  name: 'stub-supabase-for-project-files',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: { supabase: supabaseStub, isSupabaseConfigured: true },
      loader: 'object',
    }));
  },
});

const mod = await import('../utils/projectFiles');
const {
  PROJECT_FILE_URL_TTL_SECONDS,
  projectFileStoragePath,
  resolveProjectFileUrl,
  listProjectFiles,
  uploadProjectFile,
  countProjectFilesByFolder,
} = mod;

const DEAD_PUBLIC_URL = `${SUPABASE_HOST}/storage/v1/object/public/${BUCKET}/proj-1/permits/coi.pdf`;
const SIGNED = (p: string) => `${SUPABASE_HOST}/storage/v1/object/sign/${BUCKET}/${p}?token=tok`;

// ── 1. behaviour: no public URL ever leaves this module ─────────────────────
console.log('\nproject file URLs are signed, not public:');

calls.length = 0;
signOk = true;
listResponse = {
  data: [
    { name: 'coi.pdf', created_at: '2026-09-01T00:00:00Z', metadata: { size: 1234, mimetype: 'application/pdf' } },
    { name: '.emptyFolderPlaceholder', created_at: '2026-09-01T00:00:00Z', metadata: { size: 0 } },
  ],
  error: null,
};
const listed = await listProjectFiles('proj-1', 'permits');
eq('listProjectFiles drops the folder placeholder', listed.length, 1);
eq('listProjectFiles path is the durable storage key', listed[0]?.path, 'proj-1/permits/coi.pdf');
eq('listProjectFiles url is signed', listed[0]?.publicUrl, SIGNED('proj-1/permits/coi.pdf'));
ok('listProjectFiles never mints an /object/public/ url',
  !listed.some(f => f.publicUrl.includes('/object/public/')),
  'A private bucket answers /object/public/ with 400 Bucket not found.');
ok('listProjectFiles does not call getPublicUrl', !calls.includes('getPublicUrl'), calls.join(','));
ok('listProjectFiles signs in ONE batched call', calls.filter(c => c === 'createSignedUrls').length === 1, calls.join(','));

calls.length = 0;
const uploaded = await uploadProjectFile({
  projectId: 'proj-1', folderKey: 'permits', fileName: 'coi.pdf',
  blob: { size: 10 } as unknown as Blob, contentType: 'application/pdf',
});
eq('uploadProjectFile returns the storage path', uploaded.path, 'proj-1/permits/coi.pdf');
eq('uploadProjectFile url is signed', uploaded.publicUrl, SIGNED('proj-1/permits/coi.pdf'));
ok('uploadProjectFile does not call getPublicUrl', !calls.includes('getPublicUrl'), calls.join(','));

// The bytes already landed, so a signing failure must not be reported as
// "nothing was saved" (app/scan.tsx's copy) — it falls back to the path, which
// resolveProjectFileUrl can turn into a live URL on the next read.
calls.length = 0;
signOk = false;
const degraded = await uploadProjectFile({
  projectId: 'proj-1', folderKey: 'permits', fileName: 'coi.pdf',
  blob: { size: 10 } as unknown as Blob, contentType: 'application/pdf',
});
eq('upload survives a signing failure and returns the path', degraded.publicUrl, 'proj-1/permits/coi.pdf');

// A file we cannot sign must still be listed — vanishing from the folder reads
// as data loss, an un-openable row does not.
const degradedList = await listProjectFiles('proj-1', 'permits');
eq('unsignable file is still listed', degradedList.length, 1);
eq('unsignable file has an empty url, not a dead public one', degradedList[0]?.publicUrl, '');
signOk = true;

// Counting tiles must not fire a signing round-trip per folder.
calls.length = 0;
await countProjectFilesByFolder('proj-1');
ok('countProjectFilesByFolder signs nothing',
  !calls.includes('createSignedUrls') && !calls.includes('createSignedUrl'),
  calls.join(','));

// ── 2. recovery: rows written before the fix are not lost ───────────────────
console.log('\nstorage-path recovery from already-persisted URIs:');

eq('dead public URL -> path', projectFileStoragePath(DEAD_PUBLIC_URL), 'proj-1/permits/coi.pdf');
eq('expired signed URL -> path', projectFileStoragePath(SIGNED('proj-1/permits/coi.pdf')), 'proj-1/permits/coi.pdf');
eq('authenticated object URL -> path',
  projectFileStoragePath(`${SUPABASE_HOST}/storage/v1/object/${BUCKET}/proj-1/plans/a.pdf`), 'proj-1/plans/a.pdf');
eq('percent-escapes are decoded',
  projectFileStoragePath(`${SUPABASE_HOST}/storage/v1/object/public/${BUCKET}/proj-1/permits/Daily%20Report.pdf`),
  'proj-1/permits/Daily Report.pdf');
eq('a bare path passes through', projectFileStoragePath('proj-1/permits/coi.pdf'), 'proj-1/permits/coi.pdf');
eq('a leading slash is trimmed', projectFileStoragePath('/proj-1/permits/coi.pdf'), 'proj-1/permits/coi.pdf');
eq('device-local file:// is not a storage path', projectFileStoragePath('file:///var/mobile/coi.jpg'), '');
eq('device-local blob: is not a storage path', projectFileStoragePath('blob:http://localhost:8081/abc'), '');
eq('another bucket is not ours', projectFileStoragePath(`${SUPABASE_HOST}/storage/v1/object/public/plan-sheets/a.png`), '');
eq('empty in, empty out', projectFileStoragePath(''), '');
eq('null in, empty out', projectFileStoragePath(null), '');

eq('resolveProjectFileUrl re-signs a dead public URL', await resolveProjectFileUrl(DEAD_PUBLIC_URL), SIGNED('proj-1/permits/coi.pdf'));
eq('resolveProjectFileUrl re-signs a bare path', await resolveProjectFileUrl('proj-1/permits/coi.pdf'), SIGNED('proj-1/permits/coi.pdf'));
eq('resolveProjectFileUrl leaves a local capture alone',
  await resolveProjectFileUrl('file:///var/mobile/coi.jpg'), 'file:///var/mobile/coi.jpg');
signOk = false;
eq('resolveProjectFileUrl falls back to the input when signing fails',
  await resolveProjectFileUrl('proj-1/permits/coi.pdf'), 'proj-1/permits/coi.pdf');
signOk = true;

ok('TTL is a positive number of seconds',
  typeof PROJECT_FILE_URL_TTL_SECONDS === 'number' && PROJECT_FILE_URL_TTL_SECONDS > 0);

// ── 3. no regrowth ──────────────────────────────────────────────────────────
console.log('\nsource guard (the wrong comment is what caused this):');

const src = readFileSync(join(ROOT, 'utils/projectFiles.ts'), 'utf8');
// Comment lines are dropped first: the header deliberately NAMES getPublicUrl
// while explaining why it is wrong, and that prose must not trip this check.
const code = src.split('\n').filter(l => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
ok('utils/projectFiles.ts calls no getPublicUrl', !/getPublicUrl\s*\(/.test(code),
  'project-documents is private; getPublicUrl produces a URL that 400s.');
ok('utils/projectFiles.ts signs its URLs', /createSignedUrls?\s*\(/.test(src));
ok('the "public-read" claim is gone from the header',
  !/public-read for now/.test(src),
  'That comment is what convinced the previous author getPublicUrl was fine.');
ok('the file states the bucket is private', /PRIVATE/.test(src));

console.log(`\n${fail === 0 ? '✓' : '✗'} project-file urls: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
