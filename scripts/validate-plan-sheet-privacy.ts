// validate-plan-sheet-privacy.ts — the SERVER half of audit DB-F11, plus the
// repo-wide no-regrowth scan.
//
// WHY THIS EXISTS. Two separate things had to be true for the parked migration
// supabase/migrations/held/20260904101100_plan_sheets_private.sql to be safe to
// apply, and only one of them is about URLs.
//
//  1. THE ANALYZERS MUST NOT NEED A FETCHABLE URL. analyze-takeoff /
//     analyze-drawings / analyze-spec-book / compare-drawings took `pageUrls`
//     from the client and fetched them server-side, which is exactly what kept
//     `plan-sheets` a public bucket. They run with the SERVICE ROLE, so they can
//     read the bytes themselves. They now prefer `pagePaths` and keep accepting
//     `pageUrls` for ONE release, because an installed build keeps sending URLs
//     until the OTA lands and a function that rejected them would break takeoff
//     for every existing user.
//
//  2. SWITCHING TO PATHS MUST NOT CREATE AN IDOR. The service role BYPASSES
//     RLS. A path is an opaque client string, so "download whatever path you are
//     given" would let any paid user read a stranger's construction drawings —
//     strictly worse than the SSRF surface it replaced. _shared/planSheetBytes.ts
//     therefore checks shape (folder[1] is a uuid) and access (the caller owns or
//     is an accepted collaborator on that project) before reading a byte.
//
// Assertions here are BEHAVIOUR — the real _shared/planSheetBytes.ts is imported
// with a stubbed Supabase client, so the access check is executed, not grepped.
// The final section is an explicit source scan, and is labelled as one.
//
// Run: bun run scripts/validate-plan-sheet-privacy.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
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

// ── stub the service-role client ────────────────────────────────────────────
const OWNER = 'u-owner';
const OTHER = 'u-other';
const PROJECT_A = '11111111-2222-3333-4444-555555555555';   // owned by OWNER
const PROJECT_B = '99999999-8888-7777-6666-555555555555';   // someone else's
const PROJECT_C = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';   // shared with OWNER

const downloaded: string[] = [];
let fetched = 0;
let pageBytes = 1024;
let collaboratorStatus = 'accepted';

interface Filter { table: string; ids: string[]; userId?: string; status?: string }
function tableStub(table: string) {
  const f: Filter = { table, ids: [] };
  const api = {
    select: () => api,
    in: (_col: string, ids: string[]) => { f.ids = ids; return api; },
    eq: (col: string, val: string) => {
      if (col === 'user_id') f.userId = val;
      if (col === 'status') f.status = val;
      return api;
    },
    then: (resolve: (r: { data: unknown[]; error: null }) => void) => {
      if (f.table === 'projects') {
        // OWNER owns A and C's real owner is someone else; C is only reachable
        // through the collaborator table.
        const owned = f.userId === OWNER ? [PROJECT_A] : f.userId === OTHER ? [PROJECT_B] : [];
        resolve({ data: f.ids.filter(id => owned.includes(id)).map(id => ({ id })), error: null });
        return;
      }
      // project_collaborators
      const rows = f.ids
        .filter(id => id === PROJECT_C && f.userId === OWNER && f.status === collaboratorStatus)
        .map(id => ({ project_id: id }));
      resolve({ data: rows, error: null });
    },
  };
  return api;
}

const clientStub = {
  from: (table: string) => tableStub(table),
  storage: {
    from: () => ({
      download: async (path: string) => {
        downloaded.push(path);
        return {
          data: { arrayBuffer: async () => new Uint8Array(pageBytes).buffer },
          error: null,
        };
      },
    }),
  },
};

interface VirtualModuleBuilder {
  module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}
interface BunGlobal {
  plugin(def: { name: string; setup: (build: VirtualModuleBuilder) => void }): void;
}
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) {
  console.error('\n✗ validate-plan-sheet-privacy must run under bun (needs Bun.plugin)\n');
  process.exit(1);
}
bun.plugin({
  name: 'stub-service-role-client',
  setup(build) {
    build.module('https://esm.sh/@supabase/supabase-js@2.39.7', () => ({
      exports: { createClient: () => clientStub },
      loader: 'object',
    }));
  },
});

// The module reads SUPABASE_URL / SERVICE_ROLE_KEY at import time off `Deno`.
(globalThis as unknown as { Deno?: unknown }).Deno = {
  env: {
    get: (k: string) => (k === 'SUPABASE_URL' ? 'https://stub.supabase.co'
      : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service-role-key' : ''),
  },
};
// Any fetch at all is a failure for the paths route — count them.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (...args: Parameters<typeof realFetch>) => {
  fetched++;
  return await realFetch(...args);
}) as typeof realFetch;

// The specifier is ASSEMBLED so that `npx tsc --noEmit` cannot resolve it.
// tsconfig.json excludes `supabase/functions/**/*` — that code is Deno, with
// `Deno.env` and https: imports — but a literal `import('...ts')` from an
// INCLUDED file drags it back into the program and fails the build with TS5097 +
// TS2304. bun resolves it at runtime either way, and the shape is declared below
// so this file still type-checks against what it uses.
const HELPER = ['..', 'supabase', 'functions', '_shared', 'planSheetBytes.ts'].join('/');
interface PlanSheetBytesModule {
  planSheetProjectId(p: unknown): string;
  selectPageSource(
    req: { pagePaths?: unknown; pageUrls?: unknown },
    maxPages: number,
  ): { kind: 'paths' | 'urls'; values: string[] };
  planSheetSideSource(path: unknown, url: unknown): 'path' | 'url' | 'none';
  loadPlanSheetImageParts(
    paths: string[], userId: string, maxBytes: number,
  ): Promise<{ inlineData: { mimeType: string; data: string } }[]>;
  mintLegacyViewUrl(
    storage: {
      createSignedUrl(
        path: string, ttl: number,
      ): Promise<{ data?: { signedUrl?: string | null } | null; error?: unknown }>;
    },
    path: string,
    ttlSeconds: number,
  ): Promise<string>;
  PlanSheetAccessError: new () => Error;
  PLAN_SHEET_BUCKET: string;
}
const mod = await import(HELPER) as PlanSheetBytesModule;
const {
  planSheetProjectId, selectPageSource, planSheetSideSource, loadPlanSheetImageParts,
  mintLegacyViewUrl, PlanSheetAccessError, PLAN_SHEET_BUCKET,
} = mod;

const A1 = `${PROJECT_A}/sheet-abc-page-1.png`;
const A2 = `${PROJECT_A}/sheet-abc-page-2.png`;
const B1 = `${PROJECT_B}/sheet-xyz-page-1.png`;
const C1 = `${PROJECT_C}/sheet-shared-page-1.png`;

// ── 1. path shape is the tenant boundary ────────────────────────────────────
console.log('\na plan-sheet path is project-scoped or it is nothing:');

eq('the bucket under guard is plan-sheets', PLAN_SHEET_BUCKET, 'plan-sheets');
eq('a project-scoped path yields its project id', planSheetProjectId(A1), PROJECT_A);
eq("the old shared 'tmp/' prefix yields nothing", planSheetProjectId('tmp/abc-page-1.png'), '');
eq('a non-uuid folder yields nothing', planSheetProjectId('smith-kitchen/a.png'), '');
eq('traversal is refused', planSheetProjectId(`${PROJECT_A}/../${PROJECT_B}/a.png`), '');
eq('a bare .. is refused', planSheetProjectId('../a.png'), '');
eq('an absolute path is refused', planSheetProjectId(`/${A1}`), '');
eq('a single segment with no folder is refused', planSheetProjectId('a.png'), '');
eq('an empty segment is refused', planSheetProjectId(`${PROJECT_A}//a.png`), '');
eq('empty is refused', planSheetProjectId(''), '');
eq('a non-string is refused', planSheetProjectId(null), '');
eq('deep keys under the project are fine', planSheetProjectId(`${PROJECT_A}/rev2/a.png`), PROJECT_A);

// ── 2. paths win over urls, for one release only ────────────────────────────
console.log('\nthe analyzers prefer paths and still accept urls:');

eq('paths only -> paths', selectPageSource({ pagePaths: [A1] }, 16), { kind: 'paths', values: [A1] });
eq('urls only -> urls (the un-OTA’d installed build)',
  selectPageSource({ pageUrls: ['https://x/y.png'] }, 16),
  { kind: 'urls', values: ['https://x/y.png'] });
eq('BOTH -> paths win, and the url is never used',
  selectPageSource({ pagePaths: [A1], pageUrls: ['https://x/y.png'] }, 16),
  { kind: 'paths', values: [A1] });
eq('an empty pagePaths array falls through to urls',
  selectPageSource({ pagePaths: [], pageUrls: ['https://x/y.png'] }, 16),
  { kind: 'urls', values: ['https://x/y.png'] });

let threw = '';
try { selectPageSource({}, 16); } catch (e) { threw = (e as Error).message; }
ok('neither input is an error', /no pages/i.test(threw), threw);
threw = '';
try { selectPageSource({ pagePaths: Array(17).fill(A1) }, 16); } catch (e) { threw = (e as Error).message; }
ok('over the page cap is an error', /maximum 16/i.test(threw), threw);
threw = '';
try { selectPageSource({ pageUrls: Array(25).fill('https://x') }, 24); } catch (e) { threw = (e as Error).message; }
ok('the cap applies to the url route too', /maximum 24/i.test(threw), threw);

// ── 3. the IDOR that switching to paths could have created ──────────────────
console.log('\nservice-role reads are scoped to the caller:');

downloaded.length = 0; fetched = 0;
const parts = await loadPlanSheetImageParts([A1, A2], OWNER, 8 * 1024 * 1024);
eq('an owned project is read', parts.length, 2);
eq('page ORDER is the request order, never reshuffled', downloaded, [A1, A2]);
eq('pages are read from storage, not fetched over the network', fetched, 0);
eq('the part carries base64 inline data', typeof parts[0]?.inlineData?.data, 'string');
eq('png is the mime for a rendered page', parts[0]?.inlineData?.mimeType, 'image/png');
eq('a .jpg path reports jpeg',
  (await loadPlanSheetImageParts([`${PROJECT_A}/a.jpg`], OWNER, 8 * 1024 * 1024))[0]?.inlineData?.mimeType,
  'image/jpeg');

// THE ONE THAT MATTERS: another user's project.
downloaded.length = 0;
let err: unknown = null;
try { await loadPlanSheetImageParts([B1], OWNER, 8 * 1024 * 1024); } catch (e) { err = e; }
ok('a stranger’s project is refused', err instanceof PlanSheetAccessError, String(err));
eq('and NOTHING was downloaded', downloaded, []);

// Mixed batch: one owned + one not. The whole request must fail, or the caller
// gets a stranger's drawing described back alongside their own.
downloaded.length = 0;
err = null;
try { await loadPlanSheetImageParts([A1, B1], OWNER, 8 * 1024 * 1024); } catch (e) { err = e; }
ok('a mixed batch is refused whole', err instanceof PlanSheetAccessError, String(err));
eq('and no page of it was downloaded', downloaded, []);

// A tmp/ path cannot be laundered through the service role either.
downloaded.length = 0;
err = null;
try { await loadPlanSheetImageParts(['tmp/abc-page-1.png'], OWNER, 8 * 1024 * 1024); } catch (e) { err = e; }
ok('a tmp/ path is refused', err instanceof PlanSheetAccessError, String(err));
eq('and nothing was downloaded for it', downloaded, []);

err = null;
try { await loadPlanSheetImageParts([A1], '', 8 * 1024 * 1024); } catch (e) { err = e; }
ok('an empty caller id is refused', err instanceof PlanSheetAccessError, String(err));

err = null;
try { await loadPlanSheetImageParts([], OWNER, 8 * 1024 * 1024); } catch (e) { err = e; }
ok('an empty path list is refused', err instanceof PlanSheetAccessError, String(err));

// Collaborators: accepted reads (compare-drawings opens an existing sheet on a
// shared job); pending does not.
collaboratorStatus = 'accepted';
downloaded.length = 0;
const shared = await loadPlanSheetImageParts([C1], OWNER, 8 * 1024 * 1024);
eq('an ACCEPTED collaborator can read the project’s sheets', shared.length, 1);
collaboratorStatus = 'pending';
err = null;
try { await loadPlanSheetImageParts([C1], OWNER, 8 * 1024 * 1024); } catch (e) { err = e; }
ok('a PENDING invite cannot', err instanceof PlanSheetAccessError, String(err));
collaboratorStatus = 'accepted';

// Size ceiling still applies — a forged 50 MB object must not reach the model.
pageBytes = 9 * 1024 * 1024;
err = null;
try { await loadPlanSheetImageParts([A1], OWNER, 8 * 1024 * 1024); } catch (e) { err = e; }
ok('an oversize page is refused', err instanceof Error && /too large/i.test((err as Error).message), String(err));
ok('and the refusal is not the access error (different remedy)',
  !(err instanceof PlanSheetAccessError), String(err));
pageBytes = 1024;

// ── 3b. compare-drawings picks a side's source by SHAPE, not by presence ────
// The regression this closes: every hydrated legacy row recovers a path,
// including the ~7 objects under the old shared `tmp/` prefix. A "path is
// non-empty -> use the path" rule sent those to loadPlanSheetImageParts, which
// refuses a non-project folder, so a comparison that works today off the still
// public URL would have started answering 403 the moment the function deployed
// — BEFORE the migration, with nothing to roll back to.
console.log('\ncompare-drawings picks each side by path shape:');

const URL_OK = 'https://nteoqhcswappxxjlpvap.supabase.co/storage/v1/object/public/plan-sheets/tmp/x.png';
eq('a project-scoped path is read by path', planSheetSideSource(A1, URL_OK), 'path');
eq('a project-scoped path wins even with a url alongside it',
  planSheetSideSource(A1, 'https://x/y.png'), 'path');
eq("a legacy tmp/ path falls back to the url instead of 403ing",
  planSheetSideSource('tmp/abc-page-1.png', URL_OK), 'url');
eq('a non-uuid folder falls back to the url too',
  planSheetSideSource('smith-kitchen/a.png', URL_OK), 'url');
eq('no path at all is the url route', planSheetSideSource(undefined, URL_OK), 'url');
eq('an empty path is the url route', planSheetSideSource('', URL_OK), 'url');
eq('a bad path with NO url is refused outright',
  planSheetSideSource('tmp/abc-page-1.png', ''), 'none');
eq('nothing at all is refused', planSheetSideSource(undefined, undefined), 'none');
// THE ONE THAT MATTERS: the fallback must never launder a stranger's project.
eq("a stranger's project id is NEVER downgraded to a url fetch",
  planSheetSideSource(B1, URL_OK), 'path');

// ── 3c. the deprecated publicUrl field is a SIGNED value ────────────────────
// A NAME GREP for getPublicUrl cannot see the likeliest regrowth shape here:
// a future dev chasing a missing thumbnail hand-rolls
// `${SUPABASE_URL}/storage/v1/object/public/plan-sheets/${path}`. So assert the
// VALUE convert-pdf-to-images puts in that field, not the call that made it.
console.log('\nthe deprecated publicUrl convert-pdf-to-images returns is signed:');

let signedTtl = 0;
const SIGNED_STUB = {
  createSignedUrl: async (p: string, ttl: number) => {
    signedTtl = ttl;
    return { data: { signedUrl: `https://stub.supabase.co/storage/v1/object/sign/plan-sheets/${p}?token=tok` } };
  },
};
const legacy = await mintLegacyViewUrl(SIGNED_STUB, A1, 604800);
ok('it is a /object/sign/ url', legacy.includes('/object/sign/'), legacy);
ok('it carries a token', /[?&]token=/.test(legacy), legacy);
ok('it is NOT an /object/public/ url', !legacy.includes('/object/public/'), legacy);
eq('the TTL it was asked for is passed through', signedTtl, 604800);

eq('a public url handed back by the SDK is refused, not forwarded',
  await mintLegacyViewUrl(
    { createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://h/storage/v1/object/public/plan-sheets/${p}` } }) },
    A1, 60),
  '');
eq('a signing error degrades to empty, it does not fail the render',
  await mintLegacyViewUrl(
    { createSignedUrl: async () => ({ data: null, error: { message: 'denied' } }) }, A1, 60),
  '');
eq('a throwing storage client degrades to empty too',
  await mintLegacyViewUrl(
    { createSignedUrl: async () => { throw new Error('network'); } }, A1, 60),
  '');
ok('convert-pdf-to-images mints that field through this helper',
  /mintLegacyViewUrl\s*\(/.test(
    readFileSync(join(ROOT, 'supabase/functions/convert-pdf-to-images/index.ts'), 'utf8')),
  'Inlining the minting again puts the value back out of reach of the assertions above.');

// ── 4. source scan: no regrowth ─────────────────────────────────────────────
// Labelled honestly: this section is a SOURCE assertion, not behaviour. It
// exists because the defect was created by a single getPublicUrl() call and a
// single `?? 'tmp'`, in files no unit test reaches.
console.log('\nsource scan (no getPublicUrl on this bucket, no shared prefix):');

const SCAN_DIRS = ['app', 'utils', 'components', 'contexts', 'hooks', 'lib', 'supabase/functions'];
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.expo']);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIR.has(e)) continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(full);
  }
  return out;
}

/** Drop line comments and block comments so prose that NAMES the bad pattern
 *  (this repo documents its defects in-file, deliberately) cannot trip a check. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(l => !/^\s*(\/\/|\*)/.test(l))
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n');
}

const files = SCAN_DIRS.flatMap(d => walk(join(ROOT, d)));
ok('the scan actually found files to scan', files.length > 200, String(files.length));

const publicUrlOffenders: string[] = [];
const tmpPrefixOffenders: string[] = [];
const bucketFilesWithPublicUrl: string[] = [];
const publicObjectUrlOffenders: string[] = [];

// The ONLY two files allowed to name `/object/public/` while touching this
// bucket, and why. Both use it to RECOVER a path from a URL that already
// exists, never to mint one. Adding a third is a visible diff and a decision,
// which is the point: a hand-rolled
// `${SUPABASE_URL}/storage/v1/object/public/plan-sheets/${path}` is the shape a
// getPublicUrl grep cannot see, and it is how this defect would grow back.
const OBJECT_PUBLIC_ALLOWED = new Map<string, string>([
  ['utils/planSheetUrls.ts', 'OBJECT_URL_MARKERS — strips the prefix off a legacy row to recover its path'],
  ['supabase/functions/_shared/planSheetBytes.ts', 'mintLegacyViewUrl refuses a value containing it'],
]);

for (const f of files) {
  const rel = relative(ROOT, f);
  const src = readFileSync(f, 'utf8');
  const code = codeOnly(src);
  const mentionsBucket = /['"`]plan-sheets['"`]|PLAN_SHEET_BUCKET|PNG_BUCKET/.test(code);
  const callsPublicUrl = /getPublicUrl\s*\(/.test(code);
  if (mentionsBucket && callsPublicUrl) bucketFilesWithPublicUrl.push(rel);
  if (callsPublicUrl) publicUrlOffenders.push(rel);
  if (mentionsBucket && code.includes('/object/public/') && !OBJECT_PUBLIC_ALLOWED.has(rel)) {
    publicObjectUrlOffenders.push(rel);
  }
  // A projectId handed to THE RENDER PIPELINE must be a real id, never a
  // literal fallback — that is the exact shape of the original defect
  // (`projectId: pickedProjectId ?? 'tmp'`). Scoped to uploadAndRenderPdf call
  // sites on purpose: `projectId: params.projectId ?? ''` is everywhere in this
  // app and has nothing to do with a bucket prefix.
  for (const m of code.matchAll(/uploadAndRenderPdf\s*\(/g)) {
    const arg = code.slice(m.index ?? 0, (m.index ?? 0) + 600);
    const pid = /projectId:\s*([^,\n}]*)/.exec(arg);
    if (pid && /['"`]/.test(pid[1])) tmpPrefixOffenders.push(`${rel} -> projectId: ${pid[1].trim()}`);
  }
  if (/\bfrom\(\s*['"`]plan-sheets['"`]\s*\)[\s\S]{0,80}getPublicUrl/.test(code)) {
    bucketFilesWithPublicUrl.push(rel);
  }
}

ok('NO file that touches the plan-sheets bucket calls getPublicUrl',
  bucketFilesWithPublicUrl.length === 0,
  `offenders: ${bucketFilesWithPublicUrl.join(', ')}\n      plan-sheets is going private; getPublicUrl mints a link that leaks forever and then 400s.`);

ok('convert-pdf-to-images calls no getPublicUrl',
  !publicUrlOffenders.includes('supabase/functions/convert-pdf-to-images/index.ts'),
  'It is the only writer to the bucket; its getPublicUrl output is what reached plan_sheets.image_uri.');

// The regrowth shape a getPublicUrl grep is blind to. A permanent unsigned link
// can be BUILT with a template literal and no SDK call at all — one line, no
// import, type-checks.
ok('NO file that touches the plan-sheets bucket builds an /object/public/ url',
  publicObjectUrlOffenders.length === 0,
  `offenders: ${publicObjectUrlOffenders.join(', ')}\n      A hand-rolled \`\${SUPABASE_URL}/storage/v1/object/public/plan-sheets/…\` leaks exactly like getPublicUrl did.`);
ok('and the allowlist for that scan is still only the two path-RECOVERY sites',
  [...OBJECT_PUBLIC_ALLOWED.keys()].join('|')
    === 'utils/planSheetUrls.ts|supabase/functions/_shared/planSheetBytes.ts',
  [...OBJECT_PUBLIC_ALLOWED.keys()].join(', '));

// HINT, NOT COVERAGE — labelled so nobody mistakes it for the real fence. This
// only sees a QUOTED literal at an `uploadAndRenderPdf(` call site: a named
// const, object shorthand, or any wrapper walks straight past it. The actual
// protection is behavioural and lives one layer down —
// uploadAndRenderPdf throws on a non-uuid folder BEFORE it uploads, asserted
// (and mutation-proven) in scripts/validate-plan-sheet-urls.ts §4.
ok('no screen passes a literal projectId prefix (hint only — see the note above)',
  tmpPrefixOffenders.length === 0,
  `offenders: ${tmpPrefixOffenders.join(', ')}\n      app/takeoff.tsx used \`projectId: pickedProjectId ?? 'tmp'\`, which parked live drawings in a shared folder.`);

// The three URL-list analyzers must route through the shared selector, so the
// "paths win" decision above is the one they actually run.
for (const fn of ['analyze-takeoff', 'analyze-drawings', 'analyze-spec-book']) {
  const code = codeOnly(readFileSync(join(ROOT, 'supabase/functions', fn, 'index.ts'), 'utf8'));
  ok(`${fn} routes its pages through selectPageSource`,
    /selectPageSource\s*\(/.test(code) && /loadPlanSheetImageParts\s*\(/.test(code),
    'Otherwise the prefer-paths behaviour proved above is not what this function does.');
  ok(`${fn} still accepts pageUrls (one release of backward compatibility)`,
    /pageUrls/.test(code),
    'Removing it breaks takeoff for every installed build until the OTA lands.');
}
{
  const code = codeOnly(readFileSync(join(ROOT, 'supabase/functions/compare-drawings/index.ts'), 'utf8'));
  ok('compare-drawings reads each side by path when it has one',
    /loadPlanSheetImageParts\s*\(/.test(code) && /oldPagePath/.test(code));
  ok('compare-drawings routes each side through planSheetSideSource',
    /planSheetSideSource\s*\(/.test(code),
    'Otherwise the tmp/-falls-back-to-url behaviour proved above is not what this function does.');
  ok('compare-drawings still accepts the url fallback', /oldPageUrl/.test(code));
}

// The held migration must still be held, and must still be the one thing this
// work is a precondition for.
const held = join(ROOT, 'supabase/migrations/held/20260904101100_plan_sheets_private.sql');
let heldSrc = '';
try { heldSrc = readFileSync(held, 'utf8'); } catch {/* reported below */}
ok('the plan-sheets migration is still parked in held/', heldSrc.length > 0,
  'A file moved up out of held/ can be swept into a bulk apply before the OTA is live.');
ok('it still flips the bucket private', /set public = false where id = 'plan-sheets'/.test(heldSrc));
ok('it still adds a membership SELECT policy', /can_access_project\(\(storage\.foldername\(name\)\)\[1\]\)/.test(heldSrc));
// Flipping the bucket is not the same as closing anonymous read. The migration
// drops four policies BY NAME off a week-old snapshot; a policy created out of
// band in the dashboard (this project has documented out-of-band objects) would
// survive every drop and keep anon reads alive with the bucket reading
// "private". The DO block has to ENUMERATE, not assume.
ok('and it refuses to finish while any public/anon SELECT policy on the bucket survives',
  /from pg_policies/.test(heldSrc)
  && /plan-sheets/.test(heldSrc.slice(heldSrc.indexOf('from pg_policies')))
  && /array\['public','anon'\]/.test(heldSrc)
  && /raise exception[^;]*still grant public\/anon/.test(heldSrc),
  'The public=false assertion alone cannot see a leftover permissive policy.');

console.log(`\n${fail === 0 ? '✓' : '✗'} plan-sheet privacy: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
