// validate-plan-sheet-urls.ts — pins the CLIENT half of audit DB-F11 and guards
// it against regressing.
//
// WHY THIS EXISTS. `plan-sheets` was a PUBLIC Supabase Storage bucket with NO
// storage.objects policy of any kind (the policies in add_pdf_render_buckets.sql
// used `CREATE POLICY IF NOT EXISTS`, which is not valid Postgres, so they never
// landed). convert-pdf-to-images wrote each rendered page there with the service
// role and handed back getPublicUrl(); the client rendered that URL, forwarded it
// to four analyzer functions, and — in app/plans.tsx — PERSISTED it into
// plan_sheets.image_uri.
//
// The result: a construction drawing, the most sensitive document class in the
// product, was readable by anyone who had ever seen a link. Forever. No expiry,
// no revocation when the sheet was superseded, the sub left the job, or the
// project was deleted. And every live object sat under a SHARED `tmp/` prefix,
// because app/takeoff.tsx passed `projectId: pickedProjectId ?? 'tmp'`.
//
// This guard asserts, in order of what matters:
//   1. BEHAVIOUR — the resolver mints SIGNED urls, batched, and never a
//      `/object/public/` one, driven through a stubbed storage client.
//   2. DURABILITY — what reaches a DB row / the local cache is the PATH. A
//      signed URL that reaches the write path is converted back to a path,
//      because persisting one is how photos silently 400'd a week later.
//   3. LEGACY — a row written before the fix (a permanent public URL) is
//      recovered to a path and re-signed, and an unsignable input is returned
//      UNCHANGED rather than blanked, so the pre-migration release still renders.
//   4. NO SHARED PREFIX — the write path REFUSES a non-project projectId, and
//      refuses it before it uploads anything.
//
// The companion guard scripts/validate-plan-sheet-privacy.ts covers the server
// half (paths preferred over URLs, and the IDOR that switching to paths could
// have introduced) plus the repo-wide no-regrowth scan.
//
// Run: bun run scripts/validate-plan-sheet-urls.ts

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
// The modules under test import `@/lib/supabase` (which pulls in react-native
// and crashes bun), plus react-native / pdf-lib / expo-file-system in the case
// of pdfRenderClient. Virtual modules give us the REAL modules under test with
// fake edges, so these are behaviour tests and not greps.
const BUCKET = 'plan-sheets';
const HOST = 'https://nteoqhcswappxxjlpvap.supabase.co';
const PUBLIC_URL = (p: string) => `${HOST}/storage/v1/object/public/${BUCKET}/${p}`;
const SIGNED = (p: string) => `${HOST}/storage/v1/object/sign/${BUCKET}/${p}?token=tok`;

const calls: string[] = [];
let signOk = true;
/** Paths the stub refuses to sign, to model a per-object RLS denial. */
let unsignable = new Set<string>();
let uploadedPaths: string[] = [];
let invokeResponse: unknown = null;

const storageApi = {
  // Deliberately REACHABLE so the guard can prove the modules stopped calling
  // it, rather than proving only that a regex did not match.
  getPublicUrl: (path: string) => {
    calls.push('getPublicUrl');
    return { data: { publicUrl: PUBLIC_URL(path) } };
  },
  createSignedUrl: async (path: string) => {
    calls.push('createSignedUrl');
    if (!signOk || unsignable.has(path)) return { data: null, error: { message: 'denied' } };
    return { data: { signedUrl: SIGNED(path) }, error: null };
  },
  createSignedUrls: async (paths: string[]) => {
    calls.push('createSignedUrls');
    if (!signOk) return { data: null, error: { message: 'offline' } };
    return {
      data: paths
        .filter(p => !unsignable.has(p))
        .map(p => ({ path: p, signedUrl: SIGNED(p), error: null })),
      error: null,
    };
  },
  upload: async (path: string) => { calls.push('upload'); uploadedPaths.push(path); return { data: { path }, error: null }; },
  remove: async () => ({ data: [], error: null }),
  download: async () => ({ data: null, error: { message: 'not used here' } }),
};

const supabaseStub = {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
  storage: { from: () => storageApi },
  functions: {
    invoke: async () => { calls.push('invoke'); return { data: invokeResponse, error: null }; },
  },
};

// Reached off globalThis rather than `import { plugin } from 'bun'` because the
// repo has no bun type declarations and `npx tsc --noEmit` covers scripts/ —
// the import is a TS2307 even though it runs fine. Same shape as
// scripts/validate-project-file-urls.ts.
interface VirtualModuleBuilder {
  module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}
interface BunGlobal {
  plugin(def: { name: string; setup: (build: VirtualModuleBuilder) => void }): void;
}
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) {
  console.error('\n✗ validate-plan-sheet-urls must run under bun (needs Bun.plugin to stub @/lib/supabase)\n');
  process.exit(1);
}
const asyncStore = new Map<string, string>();
bun.plugin({
  name: 'stub-edges-for-plan-sheets',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: { supabase: supabaseStub, isSupabaseConfigured: true },
      loader: 'object',
    }));
    build.module('react-native', () => ({
      exports: { Platform: { OS: 'ios' } },
      loader: 'object',
    }));
    build.module('pdf-lib', () => ({
      exports: { PDFDocument: { load: async () => ({ getPageCount: () => 3 }) } },
      loader: 'object',
    }));
    build.module('@/utils/fileBytes', () => ({
      exports: { readFileBytes: async () => new Uint8Array([1, 2, 3]) },
      loader: 'object',
    }));
    build.module('@react-native-async-storage/async-storage', () => ({
      exports: {
        default: {
          setItem: async (k: string, v: string) => { asyncStore.set(k, v); },
          getItem: async (k: string) => asyncStore.get(k) ?? null,
          removeItem: async (k: string) => { asyncStore.delete(k); },
        },
      },
      loader: 'object',
    }));
  },
});

const mod = await import('../utils/planSheetUrls');
const {
  PLAN_SHEET_BUCKET,
  PLAN_SHEET_URL_TTL_SECONDS,
  planSheetStoragePath,
  isProjectScopedPlanSheetPath,
  resolvePlanSheetUrls,
  resolvePlanSheetUrl,
  durablePlanSheetValue,
  localPlanSheetValue,
  planSheetRowUris,
  carryDeviceLocalPlanSheetUris,
} = mod;

const PROJECT = '11111111-2222-3333-4444-555555555555';
const P1 = `${PROJECT}/sheet-abc-page-1.png`;
const P2 = `${PROJECT}/sheet-abc-page-2.png`;

// ── 1. behaviour: signed, batched, never public ─────────────────────────────
console.log('\nplan-sheet urls are signed, not public:');

eq('the bucket under guard is plan-sheets', PLAN_SHEET_BUCKET, 'plan-sheets');
ok('TTL is a positive number of seconds',
  typeof PLAN_SHEET_URL_TTL_SECONDS === 'number' && PLAN_SHEET_URL_TTL_SECONDS > 0);
// A minted url is an UNREVOCABLE bearer token — deleting the project or
// superseding the sheet does not invalidate it — and utils/planShareToken.ts
// embeds one in a link texted to a homeowner with no account. It must not
// outlive the 24h photo urls sitting in that same payload.
eq('and it is no longer than the 24h photo TTL it ships beside',
  PLAN_SHEET_URL_TTL_SECONDS <= 60 * 60 * 24, true);

calls.length = 0; signOk = true; unsignable = new Set();
const m1 = await resolvePlanSheetUrls([P1, P2]);
eq('a stored path resolves to a signed url', m1.get(P1), SIGNED(P1));
ok('no resolved url is an /object/public/ one',
  ![...m1.values()].some(u => u.includes('/object/public/')),
  'A private bucket answers /object/public/ with 400 Bucket not found.');
ok('the resolver never calls getPublicUrl', !calls.includes('getPublicUrl'), calls.join(','));
eq('two paths are signed in ONE batched call', calls.filter(c => c === 'createSignedUrls').length, 1);

// Chunking: 150 paths must not become one unbounded request (a hospital set).
calls.length = 0;
const many = Array.from({ length: 150 }, (_, i) => `${PROJECT}/p-${i}.png`);
await resolvePlanSheetUrls(many);
eq('150 paths are chunked into 2 requests', calls.filter(c => c === 'createSignedUrls').length, 2);

// ── 2. durability: a DB row / the cache never holds an expiring url ──────────
console.log('\nwhat gets persisted is the PATH:');

eq('a path passes through', durablePlanSheetValue(P1, SIGNED(P1)), P1);
eq('a signed url with no path is converted back to a path',
  durablePlanSheetValue(undefined, SIGNED(P1)), P1);
eq('a legacy public url is converted back to a path',
  durablePlanSheetValue(undefined, PUBLIC_URL(P1)), P1);
eq('a device-local capture is dropped, not written to Postgres',
  durablePlanSheetValue(undefined, 'file:///var/mobile/a.png'), '');
eq('a foreign https image is kept as-is',
  durablePlanSheetValue(undefined, 'https://picsum.photos/seed/x/1400/1000'),
  'https://picsum.photos/seed/x/1400/1000');
eq('nothing in, nothing out', durablePlanSheetValue(undefined, undefined), '');
ok('the durable value is never a signed url',
  !durablePlanSheetValue(undefined, SIGNED(P1)).includes('token='),
  'utils/storage.ts:11-14: a baked expiring URL silently 400s a week later.');

// The LOCAL cache is a different store with a different rule, and getting that
// wrong is how the first cut of this fix destroyed user data: app/plans.tsx
// `confirmImport` makes a sheet out of an ImagePicker result — a PHOTO of a
// plan, nothing uploads it — so its only value is a device-local URI. Dropping
// that in the cache as well as in Postgres blanked the sheet on the very device
// that took it, permanently, with no replacement path anywhere.
console.log('\nthe LOCAL cache keeps a device-local capture (Postgres still must not):');

eq('a device-local capture SURVIVES in the cache',
  localPlanSheetValue(undefined, 'file:///var/mobile/a.png'), 'file:///var/mobile/a.png');
eq('a web blob survives too', localPlanSheetValue(undefined, 'blob:http://localhost:8081/x'),
  'blob:http://localhost:8081/x');
eq('a ph:// asset survives too', localPlanSheetValue(undefined, 'ph://ABC-123'), 'ph://ABC-123');
eq('but Postgres still drops it',
  durablePlanSheetValue(undefined, 'file:///var/mobile/a.png'), '');
eq('a path still wins over everything', localPlanSheetValue(P1, 'file:///var/mobile/a.png'), P1);
eq('and a SIGNED url is still converted to a path, never cached as a token',
  localPlanSheetValue(undefined, SIGNED(P1)), P1);
ok('nothing the cache stores can contain a token',
  ![
    localPlanSheetValue(undefined, SIGNED(P1)),
    localPlanSheetValue(P1, SIGNED(P1)),
    localPlanSheetValue(undefined, 'file:///var/mobile/a.png'),
  ].some(v => v.includes('token=')),
  'An expiring URL on disk is the bug utils/storage.ts:11-14 documents.');
eq('nothing in, nothing out', localPlanSheetValue(undefined, undefined), '');

// A photo-library sheet has image_uri '' on the server. The hydration must not
// let that '' overwrite the copy this device still holds.
const carried = carryDeviceLocalPlanSheetUris(
  [{ id: 'a', imageUri: '' }, { id: 'b', imageUri: SIGNED(P1) }, { id: 'c', imageUri: '' }],
  [{ id: 'a', imageUri: 'file:///var/mobile/a.png' }, { id: 'b', imageUri: 'file:///stale.png' }],
);
eq('a server row with no image keeps this device’s capture', carried[0]?.imageUri, 'file:///var/mobile/a.png');
eq('a server row WITH an image always wins', carried[1]?.imageUri, SIGNED(P1));
eq('a row with neither stays empty', carried[2]?.imageUri, '');
eq('a cached REMOTE url is never carried over (only device-local)',
  carryDeviceLocalPlanSheetUris([{ id: 'a', imageUri: '' }], [{ id: 'a', imageUri: PUBLIC_URL(P1) }])[0]?.imageUri,
  '');

// ── 2b. the hydration mapper (extracted out of ProjectContext on purpose) ────
// This mapper and the two write values above ARE the client half. They used to
// live inline in a 5,000-line provider that no test loads, and the fix was
// proven green with both of them gutted.
console.log('\nthe plan_sheets row mapper:');

const signedMap = new Map<string, string>([[P1, SIGNED(P1)], [PUBLIC_URL(P2), SIGNED(P2)]]);
eq('a stored PATH renders as a signed url', planSheetRowUris(P1, signedMap).imageUri, SIGNED(P1));
eq('and carries its path for the server-side readers',
  planSheetRowUris(P1, signedMap).storagePath, P1);
eq('a LEGACY public url renders signed, keyed by what the row stores',
  planSheetRowUris(PUBLIC_URL(P2), signedMap).imageUri, SIGNED(P2));
eq('and recovers its path', planSheetRowUris(PUBLIC_URL(P2), signedMap).storagePath, P2);
eq('an unsignable row keeps what it stored, rather than blanking',
  planSheetRowUris(PUBLIC_URL(P1), new Map()).imageUri, PUBLIC_URL(P1));
// THE compare-drawings REGRESSION. A legacy object under the old shared `tmp/`
// prefix DOES recover a path — and that path can never be admitted by a
// membership policy, so publishing it turns a comparison that works today off
// the public URL into a 403 at function-deploy time, before the migration.
eq('a legacy tmp/ row deliberately exposes NO storagePath',
  planSheetRowUris(`${HOST}/storage/v1/object/public/${BUCKET}/tmp/x-page-1.png`, new Map()).storagePath,
  undefined);
eq('but it still renders off its public url',
  planSheetRowUris(`${HOST}/storage/v1/object/public/${BUCKET}/tmp/x-page-1.png`, new Map()).imageUri,
  `${HOST}/storage/v1/object/public/${BUCKET}/tmp/x-page-1.png`);
eq('a non-uuid folder exposes no storagePath either',
  planSheetRowUris('smith-kitchen/a.png', new Map()).storagePath, undefined);
eq('a device-local row exposes no storagePath',
  planSheetRowUris('file:///var/mobile/a.png', new Map()).storagePath, undefined);
eq('an empty row is empty, not undefined-shaped', planSheetRowUris(null, new Map()).imageUri, '');

// THE UN-OTA'd BUILD'S TIME BOMB, and why it defuses itself. A build that has
// not taken the OTA keeps writing convert-pdf-to-images' `publicUrl` — now a
// SIGNED url — straight into plan_sheets.image_uri. That row is NOT permanently
// dead when the signature expires: the path is recoverable from an
// /object/sign/ url, so a post-OTA client re-signs it off its own stored value
// on every hydration, and the local cache rewrites it to the bare path.
const staleRow = SIGNED(P1);
const staleSigned = await resolvePlanSheetUrls([staleRow]);
eq('a row a stale build filled with a signed url is re-signable by that value',
  staleSigned.has(staleRow), true);
eq('and it recovers its path for the server-side readers',
  planSheetRowUris(staleRow, staleSigned).storagePath, P1);
eq('and the cache rewrites it to the path, dropping the token',
  localPlanSheetValue(planSheetRowUris(staleRow, staleSigned).storagePath, staleRow), P1);

// ── 3. legacy rows + the pre-migration release ──────────────────────────────
console.log('\nlegacy rows and the release before the migration:');

eq('legacy public URL -> path', planSheetStoragePath(PUBLIC_URL(P1)), P1);
eq('expired signed URL -> path', planSheetStoragePath(SIGNED(P1)), P1);
eq('authenticated object URL -> path',
  planSheetStoragePath(`${HOST}/storage/v1/object/${BUCKET}/${P1}`), P1);
eq('percent-escapes are decoded',
  planSheetStoragePath(`${HOST}/storage/v1/object/public/${BUCKET}/${PROJECT}/Sheet%20A-101.png`),
  `${PROJECT}/Sheet A-101.png`);
eq('a bare path passes through', planSheetStoragePath(P1), P1);
eq('a leading slash is trimmed', planSheetStoragePath(`/${P1}`), P1);
eq('device-local file:// is not a storage path', planSheetStoragePath('file:///var/mobile/a.png'), '');
eq('device-local blob: is not a storage path', planSheetStoragePath('blob:http://localhost:8081/x'), '');
eq('another bucket is not ours',
  planSheetStoragePath(`${HOST}/storage/v1/object/public/project-documents/a.pdf`), '');
eq('a seeded placeholder is not ours',
  planSheetStoragePath('https://picsum.photos/seed/mage-plan-a201/1400/1000'), '');
eq('empty in, empty out', planSheetStoragePath(''), '');
eq('null in, empty out', planSheetStoragePath(null), '');

calls.length = 0;
eq('a legacy row is re-signed, keyed by what the row actually stores',
  await resolvePlanSheetUrl(PUBLIC_URL(P1)), SIGNED(P1));

// THE PRE-MIGRATION RELEASE. While the bucket is still public there is no
// SELECT policy, so signing can be refused — and the legacy public URL in the
// row still works. An unresolvable input must therefore come back UNCHANGED.
signOk = false;
eq('an unsignable legacy url is returned unchanged, not blanked',
  await resolvePlanSheetUrl(PUBLIC_URL(P1)), PUBLIC_URL(P1));
eq('an unsignable path is returned unchanged', await resolvePlanSheetUrl(P1), P1);
eq('a batch that cannot be signed resolves to an empty map',
  (await resolvePlanSheetUrls([P1, P2])).size, 0);
signOk = true;

// A per-object denial (someone else's project) must not take out the batch.
unsignable = new Set([P2]);
const mixed = await resolvePlanSheetUrls([P1, P2]);
eq('one denied object does not blank the rest', mixed.get(P1), SIGNED(P1));
eq('the denied object is simply absent', mixed.has(P2), false);
unsignable = new Set();

eq('a local capture is left alone', await resolvePlanSheetUrl('file:///var/mobile/a.png'), 'file:///var/mobile/a.png');
eq('empty stays empty', await resolvePlanSheetUrl(''), '');

// ── 4. no shared bucket prefix, ever ────────────────────────────────────────
console.log('\nthe write path refuses a non-project prefix:');

ok('a project uuid is a valid prefix', isProjectScopedPlanSheetPath(P1));
ok("the old shared 'tmp' prefix is refused", !isProjectScopedPlanSheetPath('tmp/x-page-1.png'));
ok('a bare tmp is refused', !isProjectScopedPlanSheetPath('tmp'));
ok('an empty prefix is refused', !isProjectScopedPlanSheetPath(''));
ok('undefined is refused', !isProjectScopedPlanSheetPath(undefined));
ok('a non-uuid project name is refused', !isProjectScopedPlanSheetPath('smith-kitchen/a.png'));

const { uploadAndRenderPdf, resolveRenderedPages } = await import('../utils/pdfRenderClient');

calls.length = 0; uploadedPaths = [];
let threw = '';
try {
  await uploadAndRenderPdf({ fileUri: 'file:///tmp/a.pdf', projectId: 'tmp', fileName: 'a.pdf' });
} catch (e) { threw = (e as Error).message; }
// Both halves matter. "it threw" alone is nearly a tautology here — with the
// prefix check deleted the call still throws, just later and from the render
// step, which is exactly the failure mode this assertion must not accept.
ok('uploadAndRenderPdf REFUSES a non-project projectId, naming the fix',
  /pick a project/i.test(threw), threw);
ok('and the refusal is the prefix check, not a downstream render failure',
  !/render/i.test(threw), threw);
eq('and it refuses BEFORE uploading anything', uploadedPaths.length, 0);
ok('and before invoking the render function', !calls.includes('invoke'), calls.join(','));

// The happy path: durable path out, signed url out, deprecated field gone.
calls.length = 0; uploadedPaths = [];
invokeResponse = {
  success: true,
  pages: [
    { pageNumber: 1, storagePath: P1, publicUrl: PUBLIC_URL(P1), width: 1700, height: 2200 },
    { pageNumber: 2, storagePath: P2, publicUrl: PUBLIC_URL(P2), width: 1700, height: 2200 },
  ],
};
const rendered = await uploadAndRenderPdf({ fileUri: 'file:///tmp/a.pdf', projectId: PROJECT, fileName: 'a.pdf' });
eq('a real project id renders', rendered.length, 2);
eq('the durable storagePath is returned', rendered[0]?.storagePath, P1);
eq('the view url is signed', rendered[0]?.viewUrl, SIGNED(P1));
ok('the deprecated publicUrl field does not survive the helper',
  !Object.prototype.hasOwnProperty.call(rendered[0] ?? {}, 'publicUrl'),
  Object.keys(rendered[0] ?? {}).join(','));
ok('no caller is handed a public url',
  !rendered.some(p => p.viewUrl.includes('/object/public/')), JSON.stringify(rendered.map(p => p.viewUrl)));
ok('the render path never calls getPublicUrl', !calls.includes('getPublicUrl'), calls.join(','));
eq('page order is preserved', rendered.map(p => p.pageNumber), [1, 2]);

// Pre-migration: signing refused, so the server's legacy URL is the fallback
// and the thumbnail still renders.
signOk = false;
const degraded = await uploadAndRenderPdf({ fileUri: 'file:///tmp/a.pdf', projectId: PROJECT, fileName: 'a.pdf' });
eq('when signing is refused the legacy url keeps the thumbnail alive',
  degraded[0]?.viewUrl, PUBLIC_URL(P1));
signOk = true;

// A reloaded saved takeoff has no viewUrl at all — it must come back from the path.
const reResolved = await resolveRenderedPages([
  { pageNumber: 1, storagePath: P1, viewUrl: '', width: 1, height: 1 },
]);
eq('a saved page re-signs from its storagePath', reResolved[0]?.viewUrl, SIGNED(P1));
signOk = false;
const reResolvedOffline = await resolveRenderedPages([
  { pageNumber: 1, storagePath: P1, viewUrl: '', width: 1, height: 1 },
]);
eq('offline, a saved page degrades to empty rather than throwing', reResolvedOffline[0]?.viewUrl, '');
// A takeoff saved BEFORE this release carries `publicUrl`, not `viewUrl`, and in
// the window where the bucket is still public NOTHING signs — so without this
// one-release fallback the "Pages the AI read" strip and the page inspector go
// blank while a working URL sits on the same object.
const preRelease = await resolveRenderedPages([
  { pageNumber: 1, storagePath: P1, publicUrl: PUBLIC_URL(P1), width: 1, height: 1 },
]);
eq('a takeoff saved BEFORE this release still shows its pages',
  preRelease[0]?.viewUrl, PUBLIC_URL(P1));
signOk = true;
const preReleaseSigned = await resolveRenderedPages([
  { pageNumber: 1, storagePath: P1, publicUrl: PUBLIC_URL(P1), width: 1, height: 1 },
]);
eq('and once signing works, the signature wins over that legacy url',
  preReleaseSigned[0]?.viewUrl, SIGNED(P1));

// ── 5. a saved takeoff must not carry an expiring url to disk ───────────────
console.log('\nAsyncStorage never holds a signed plan-sheet url:');

const { saveTakeoff, loadTakeoff } = await import('../utils/takeoffStorage');
asyncStore.clear();
await saveTakeoff(PROJECT, {
  result: { walls: [] } as never,
  overrides: {},
  rejected: {},
  modelUsed: 'gemini-2.5-flash',
  pages: [{ pageNumber: 1, storagePath: P1, viewUrl: SIGNED(P1), width: 1, height: 1 }],
  fileName: 'a.pdf',
});
const raw = [...asyncStore.values()].join('');
ok('a saved takeoff contains the storage path', raw.includes(P1), raw.slice(0, 200));
ok('a saved takeoff contains NO signed url',
  !raw.includes('token=') && !raw.includes('/object/sign/'),
  'An expiring URL written to disk is the bug utils/storage.ts:11-14 documents.');
const reloaded = await loadTakeoff(PROJECT);
eq('the reloaded page still knows its path', reloaded?.pages?.[0]?.storagePath, P1);

// ── 6. source scan: the wiring, not just the helpers ────────────────────────
// Labelled honestly as a SOURCE assertion. It exists because the three sites
// that matter most live in files no test can load — a 5,000-line provider and
// two screens — and this fix was once proven fully green by two guards while
// contexts/ProjectContext.tsx had its hydration mapper AND its insert mapper
// replaced with the raw column value.
console.log('\nsource scan (the call sites the helpers above are useless without):');

/** Read a file with comments stripped. This repo documents its defects in-file
 *  — app/plans.tsx literally says "this line used to persist `p.publicUrl`" —
 *  so prose that names the bad pattern must not be able to fail the scan, and
 *  prose that names the GOOD one must not be able to pass it. */
const readSrc = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter(l => !/^\s*(\/\/|\*)/.test(l))
  .map(l => l.replace(/\/\/.*$/, ''))
  .join('\n');

{
  const ctx = readSrc('contexts/ProjectContext.tsx');
  ok('ProjectContext signs plan_sheets rows in one batch at hydration',
    /const sheetSigned = await resolvePlanSheetUrls\(/.test(ctx),
    'Without this every sheet renders a bare storage path after the migration.');
  ok('and maps each row through planSheetRowUris',
    /\.\.\.planSheetRowUris\(r\.image_uri as string, sheetSigned\)/.test(ctx),
    'Reverting to `imageUri: r.image_uri` blanks every sheet and leaks a tmp/ path into compare-drawings.');
  ok('the plan_sheets INSERT persists durablePlanSheetValue, not what the screen holds',
    /image_uri: durablePlanSheetValue\(fresh\.storagePath, fresh\.imageUri\)/.test(ctx),
    'app/plans.tsx hands addPlanSheet a SIGNED url; persisting it is the photo bug again.');
  ok('the plan_sheets UPDATE does the same',
    /patch\.image_uri = durablePlanSheetValue\(/.test(ctx));
  ok('every local-cache write of the sheets goes through localPlanSheetValue',
    (ctx.match(/saveLocal\(PLAN_SHEETS_KEY, [\s\S]{0,140}?localPlanSheetValue\(/g) ?? []).length === 2,
    'Both the hydration write and persistPlanSheets. One of the two is how a device-local import gets lost.');
  ok('and the device-local capture is carried across the server hydration',
    /carryDeviceLocalPlanSheetUris\(mapped, lSheets\)/.test(ctx),
    "A photo-library sheet's row is '' on the server; without this it overwrites the copy this device has.");
}
{
  const plans = readSrc('app/plans.tsx');
  ok('app/plans.tsx passes the PDF page path, not a url, to addPlanSheet',
    /storagePath: p\.storagePath/.test(plans) && /imageUri: p\.viewUrl/.test(plans));
  ok('and it never reads the deprecated publicUrl field', !/p\.publicUrl/.test(plans));
}
{
  const pi = readSrc('app/plan-intelligence.tsx');
  ok('plan-intelligence persists the DURABLE value in its saved session',
    /imageUri: localPlanSheetValue\(undefined, imageUri \?\? undefined\)/.test(pi),
    "mageid_plan_room_sessions is AsyncStorage — a signed url there is dead the next time the GC opens it.");
  ok('and re-signs it when the session is restored',
    /await resolvePlanSheetUrl\(session\.imageUri\)/.test(pi));
}
{
  const takeoff = readSrc('app/takeoff.tsx');
  ok('app/takeoff.tsx re-signs a restored takeoff’s pages',
    /await resolveRenderedPages\(saved\.pages/.test(takeoff));
  ok('and sends PATHS to the analyzers',
    (takeoff.match(/pagePaths: rendered\.map\(p => p\.storagePath\)/g) ?? []).length === 2);
}

console.log(`\n${fail === 0 ? '✓' : '✗'} plan-sheet urls: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
