// validate-sample-guard.ts — the OUTBOUND INVARIANT for sample projects, and
// the data the tutorials stand on.
//
// A sample job ("Sample — Sarah's Place") is real synced data so the tutorials
// run the real save paths. It must never reach anyone but the user: no client
// email, no Stripe pay link, no payment reminder, no QuickBooks push. This file
// pins every fence, client AND server, and executes what can be executed:
//
//   1  utils/sampleGuard — the rule (byte-exact 'Sample — ', U+2014), the
//      locked recipient, the send plan, the id registry the QBO / analytics
//      readers use.
//   2  the server fences — create-payment-link refuses a sample with 409
//      sample_project; invoice-dunning skips it. The fence block of each is
//      EXTRACTED AND RUN, and its placement is checked (after the project row
//      is read, before anything is minted or sent).
//   2b the QuickBooks fence (_shared/sampleFence) — EXECUTED against a fake
//      database: qbo-sync refuses a sample's project / invoice / payment before
//      any push; qbo-reconciler's steps 1 and 1b and qbo-connect-status's
//      Pending count leave sample rows out by project (the status CHECK allows
//      no terminal 'skipped' value, and wave A ships no migration).
//   3  analytics hygiene — every event naming a project_id says is_sample; every
//      event during a run says in_tutorial; the two dead events now fire.
//   4  ProjectContext — addProject / addDailyReport / addPunchItem(s) are
//      compiled from source and RUN: the seed's events read is_sample, a sample
//      fires no aha event and no QuickBooks push; the QBO call sites skip samples.
//   5  utils/demoSeed — the small sample carries 8 lines footing to $422,400
//      (a progress invoice on it no longer bills $0), no fabricated
//      bulkSavingsTotal.
//   6  utils/tutorial/sandbox — run against stubs: reuse vs seed, one seed
//      for two concurrent starts, never a renamed / someone else's job, the
//      estimate patch, the plan through the real addFloorPlan within 8 s, the
//      offline skip.
//   7  the bundled assets — sizes and budgets.
//   8  (full mode) the screens' send paths consult the guard: app/invoice.tsx
//      send / pay-link / reminder, app/daily-report.tsx Submit, utils/qboSync.
//
// MODES. The default is the FULL check. `--lane-a` skips section 8, whose code
// lands with the screen lanes (L3 daily report, L4b invoice) and the
// orchestrator's qboSync join; everything else must be green in both modes.
//
// Every check here was watched failing against a deliberate break before it
// was trusted (fence removed, em dash swapped for a hyphen, the immediate
// noteSampleProject dropped, the send check opened, the plan budget ignored).
//
// Run: bun run scripts/validate-sample-guard.ts [--lane-a]

import { readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// @types/bun is not installed (same note as validate-closeout-binder.ts); only
// the sliver used here is declared, so `npx tsc` over scripts/ stays green.
type BunLoadResult = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = {
  onLoad: (opts: { filter: RegExp }, cb: () => BunLoadResult) => void;
  module: (specifier: string, cb: () => BunLoadResult) => void;
};
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANE_A = process.argv.includes('--lane-a');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

const EM = '—';
const PREFIX = `Sample ${EM} `;

// ── stubs for the RN-bound modules sandbox.ts reaches ───────────────────────
type FloorPlanCall = { projectId: string; name?: string; sheetNumber?: string; mimeType?: string | null; uri: string };
const fp = {
  calls: [] as FloorPlanCall[],
  answer: 'ok' as 'ok' | 'fail' | 'hang' | 'held',
  // 'held': the upload waits until release() — a slow upload that lands later.
  release: () => {},
};
const fs = { downloads: [] as string[], copies: [] as string[], exists: new Set<string>() };
let resolvedAssetUri = 'http://localhost:8083/assets/assets/tutorial/sample-plan-a101.png';
// What expo-asset's downloadAsync hands back on native (an Android release
// build, where resolveAssetSource returns a resource NAME).
let assetLocalUri: string | null = null;

Bun.plugin({
  name: 'sample-guard-stubs',
  setup(build) {
    // Metro turns a bundled image require into an asset id; bun would parse
    // the bytes as JS. The id is opaque to the code under test.
    build.onLoad({ filter: /\.(png|jpe?g)$/ }, () => ({ exports: { default: 1 }, loader: 'object' }));
    build.module('react-native', () => ({
      exports: { Platform: { OS: 'ios' }, Image: { resolveAssetSource: () => ({ uri: resolvedAssetUri }) } },
      loader: 'object',
    }));
    build.module('expo-file-system/legacy', () => ({
      exports: {
        cacheDirectory: 'file:///cache/',
        getInfoAsync: async (u: string) => ({ exists: fs.exists.has(u) }),
        downloadAsync: async (from: string, to: string) => { fs.downloads.push(from); fs.exists.add(to); return { status: 200, uri: to }; },
        copyAsync: async ({ from, to }: { from: string; to: string }) => { fs.copies.push(from); fs.exists.add(to); },
      },
      loader: 'object',
    }));
    build.module('expo-asset', () => ({
      exports: { Asset: { fromModule: () => ({ uri: '/assets/x.png', downloadAsync: async () => ({ localUri: assetLocalUri }) }) } },
      loader: 'object',
    }));
    build.module('@/utils/addFloorPlan', () => ({
      exports: {
        addFloorPlan: async (input: { projectId: string; image: { uri: string; mimeType?: string | null }; name?: string; sheetNumber?: string }, actions: () => { addPlanSheet: (s: unknown) => { id: string } }) => {
          fp.calls.push({ projectId: input.projectId, name: input.name, sheetNumber: input.sheetNumber, mimeType: input.image.mimeType, uri: input.image.uri });
          if (fp.answer === 'hang') return new Promise(() => { /* never */ });
          if (fp.answer === 'held') await new Promise<void>(res => { fp.release = res; });
          if (fp.answer === 'fail') return { ok: false, kind: 'retryable', reason: 'no signal' };
          const sheet = actions().addPlanSheet({ projectId: input.projectId, name: input.name, sheetNumber: input.sheetNumber, imageUri: input.image.uri, storagePath: `${input.projectId}/img-1.png` });
          return { ok: true, sheet, storagePath: `${input.projectId}/img-1.png` };
        },
      },
      loader: 'object',
    }));
  },
});

const G = await import('@/utils/sampleGuard');
const CAP = await import('@/utils/projectCap');
const A = await import('@/utils/analytics');
const RUN = await import('@/utils/tutorial/activeRun');
const { seedDemoProject, DEMO_FLAVORS } = await import('@/utils/demoSeed');
const FX = await import('@/utils/tutorial/fixtures');
const SB = await import('@/utils/tutorial/sandbox');

// ════════════════════════════════════════════════════════════════════════════
console.log('\n1. utils/sampleGuard — the rule');
{
  ok('the prefix is byte-exact: "Sample", space, EM DASH (U+2014), space', G.SAMPLE_PROJECT_PREFIX === PREFIX && CAP.SAMPLE_PROJECT_PREFIX === PREFIX,
    JSON.stringify(G.SAMPLE_PROJECT_PREFIX));
  ok("a seeded sample is a sample (by name and by project)", G.isSampleProject(`${PREFIX}Sarah's Place`) && G.isSampleProject({ name: DEMO_FLAVORS.small.name }));
  ok('a hyphen or an en dash is NOT (the server would not exempt it either)',
    !G.isSampleProject("Sample - Sarah's Place") && !G.isSampleProject("Sample – Sarah's Place") && !G.isSampleProject("Sample —Sarah's Place"));
  ok('a renamed sample is a real job; so are null / empty / a real name',
    !G.isSampleProject("Sarah's Place") && !G.isSampleProject(null) && !G.isSampleProject(undefined) && !G.isSampleProject({ name: null }) && !G.isSampleProject(''));
  ok('"Sample" only as a prefix, not anywhere in the name', !G.isSampleProject(`Kitchen ${PREFIX}copy`));

  ok('sampleRecipient: his own address, trimmed', G.sampleRecipient('  gc@example.com ') === 'gc@example.com');
  ok('sampleRecipient: nothing plausible → null (then the screen cannot send at all)',
    G.sampleRecipient('') === null && G.sampleRecipient(undefined) === null && G.sampleRecipient('undefined') === null && G.sampleRecipient('a b@c.d') === null);

  const real = G.sampleSendPlan({ name: 'Maple St' }, 'gc@example.com');
  ok('a real job sends exactly as before', real.sample === false);
  const plan = G.sampleSendPlan({ name: DEMO_FLAVORS.small.name }, 'gc@example.com');
  ok('a sample: locked to him, no portal post, no pay link, nobody notified, "Send to me"',
    plan.sample === true && plan.to === 'gc@example.com' && plan.postToPortal === false && plan.mintPayLink === false
      && plan.notifyOthers === false && plan.buttonLabel === 'Send to me' && plan.note === G.SAMPLE_SEND_NOTE, JSON.stringify(plan));
  const noEmail = G.sampleSendPlan({ name: DEMO_FLAVORS.small.name }, null);
  ok('a sample with no email on record: to is null (never the client)', noEmail.sample === true && noEmail.to === null);

  ok('sampleSendAllowed: a real job may email anyone', G.sampleSendAllowed({ name: 'Maple St' }, 'client@x.com', 'gc@example.com'));
  ok('sampleSendAllowed: a sample may email only him (case-insensitive)',
    G.sampleSendAllowed({ name: DEMO_FLAVORS.small.name }, 'GC@Example.com', 'gc@example.com')
      && !G.sampleSendAllowed({ name: DEMO_FLAVORS.small.name }, 'sarah@client.com', 'gc@example.com')
      && !G.sampleSendAllowed({ name: DEMO_FLAVORS.small.name }, 'gc@example.com', null)
      && !G.sampleSendAllowed({ name: DEMO_FLAVORS.small.name }, '', ''));

  ok('[Sample] subject, idempotent', G.sampleEmailSubject('Invoice #3') === '[Sample] Invoice #3' && G.sampleEmailSubject('[Sample] Invoice #3') === '[Sample] Invoice #3');
  ok('the refusal codes: client "sample", server "sample_project"', G.SAMPLE_PAY_LINK_REFUSAL === 'sample' && G.SAMPLE_SERVER_REFUSAL === 'sample_project');
  const copy = [G.SAMPLE_SEND_NOTE, G.SAMPLE_NOTHING_SENT, G.SAMPLE_PAY_SPECIMEN_NOTE, G.SAMPLE_SEND_TO_ME_LABEL];
  ok('the guard copy is honest and plain (no emoji, says "sample")',
    copy.every(c => !/\p{Extended_Pictographic}/u.test(c)) && /sample/i.test(G.SAMPLE_SEND_NOTE) && /sample/i.test(G.SAMPLE_NOTHING_SENT));
  // It sits on the invoice screen whose "Send to me" really emails him, so a
  // blanket "nothing is sent" is false; it must name what it refuses.
  ok('the refusal copy names what it refuses, never "nothing is sent"',
    !/nothing is sent/i.test(G.SAMPLE_NOTHING_SENT) && /reminder/i.test(G.SAMPLE_NOTHING_SENT) && /pay link/i.test(G.SAMPLE_NOTHING_SENT));

  // The id registry (analytics + QuickBooks see ids, not projects).
  G.noteSampleScope(
    [{ id: 'p-s', name: DEMO_FLAVORS.small.name }, { id: 'p-r', name: 'Maple St' }],
    [{ id: 'i-s', projectId: 'p-s' }, { id: 'i-r', projectId: 'p-r' }],
  );
  ok('registry: sample project / its invoice / its payment are samples to QuickBooks',
    G.isSampleQboObject('project', 'p-s') && G.isSampleQboObject('invoice', 'i-s') && G.isSampleQboObject('payment', 'i-s::pay-1'));
  ok('registry: a real project / invoice / payment is not; item never is',
    !G.isSampleQboObject('project', 'p-r') && !G.isSampleQboObject('invoice', 'i-r') && !G.isSampleQboObject('payment', 'i-r::pay-1')
      && !G.isSampleQboObject('item', 'p-s') && !G.isSampleQboObject('invoice', '') && !G.isSampleQboObject('invoice', null));
  G.noteSampleScope([], []);
  ok('registry: replaced wholesale — a sign-out (empty lists) empties it', !G.isKnownSampleProjectId('p-s') && !G.isSampleQboObject('invoice', 'i-s'));
  G.noteSampleProject({ id: 'p-new', name: DEMO_FLAVORS.small.name });
  G.noteSampleProject({ id: 'p-real', name: 'Real job' });
  ok('noteSampleProject adds a sample at once, and ignores a real job', G.isKnownSampleProjectId('p-new') && !G.isKnownSampleProjectId('p-real'));
  G.noteSampleScope([], []);

  const src = strip(read('utils/sampleGuard.ts'));
  ok('sampleGuard is pure (no React / RN / storage in its graph)', !/from\s+['"](react|react-native|expo[-\w/]*|@react-native-async-storage\/[\w-]+)['"]/.test(src));
  ok('sampleGuard defines "sample" through projectCap (one definition of the prefix)', /from '@\/utils\/projectCap'/.test(src) && !/'Sample —/.test(src));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2. the server fences (create-payment-link, invoice-dunning)');
{
  const fence = (file: string) => {
    const s = read(file);
    const m = /\/\/ >>> sample-project-fence[\s\S]*?\n([\s\S]*?)\/\/ <<< sample-project-fence/.exec(s);
    return { s, block: m?.[1] ?? '' };
  };
  const tx = new Bun.Transpiler({ loader: 'ts' });
  for (const file of ['supabase/functions/create-payment-link/index.ts', 'supabase/functions/invoice-dunning/index.ts']) {
    const { s, block } = fence(file);
    const name = file.split('/')[2];
    ok(`${name}: has the fence block`, block.length > 0);
    ok(`${name}: the prefix constant is the byte-exact literal 'Sample — ' (U+2014)`,
      new RegExp(`SAMPLE_PROJECT_PREFIX = (["'])Sample ${EM} \\1;`).test(block), block.split('\n').find(l => l.includes('SAMPLE_PROJECT_PREFIX =')) ?? '(none)');
    let isSample: ((n: string | null | undefined) => boolean) | null = null;
    try {
      isSample = new Function(`${tx.transformSync(block)}\nreturn isSampleProjectName;`)() as (n: string | null | undefined) => boolean;
    } catch (e) { ok(`${name}: the fence block runs`, false, String(e)); }
    if (isSample) {
      ok(`${name}: the fence answers exactly like the app's rule`,
        [DEMO_FLAVORS.small.name, DEMO_FLAVORS.medium.name, 'Sample - x', 'Sample – x', "Sarah's Place", '', null, undefined, `x ${PREFIX}`]
          .every(n => isSample!(n) === CAP.isSampleProjectName(n as string | null | undefined)));
    }
    ok(`${name}: the fence is called on the project row`, /isSampleProjectName\(\s*(projRows\[0\]\.name|project\.name)\s*\)/.test(strip(s)));
  }

  const cpl = strip(read('supabase/functions/create-payment-link/index.ts'));
  ok('create-payment-link reads the project NAME with its owner', /projects\?id=eq\.\$\{encodeURIComponent\(projectId\)\}&select=user_id,name&/.test(cpl));
  const ownerAt = cpl.indexOf('projRows[0].user_id !== callerSub');
  const fenceAt = cpl.indexOf('isSampleProjectName(projRows[0].name)');
  // The first Stripe request the HANDLER makes (helpers above serve() only define them).
  const serveAt = cpl.indexOf('serve(async');
  const mintRel = serveAt < 0 ? -1 : cpl.slice(serveAt).search(/stripe(Post|Get|Request|Fetch)?\(|`\$\{STRIPE_BASE\}/);
  const mintAt = mintRel < 0 ? -1 : serveAt + mintRel;
  const fenceTail = cpl.slice(fenceAt, fenceAt + 200);
  ok('create-payment-link: fence AFTER the owner check, BEFORE any Stripe call', ownerAt > 0 && fenceAt > ownerAt && (mintAt < 0 || fenceAt < mintAt), `owner ${ownerAt} fence ${fenceAt} stripe ${mintAt}`);
  ok('create-payment-link: a sample answers 409 sample_project, unconditionally',
    /^isSampleProjectName\(projRows\[0\]\.name\)\) \{\s*return jsonResponse\(\{ success: false, error: "sample_project" \}, 409\);/.test(fenceTail)
      && /if \($/.test(cpl.slice(fenceAt - 4, fenceAt)));

  const dun = strip(read('supabase/functions/invoice-dunning/index.ts'));
  const fetchAt = dun.indexOf(".select('id,user_id,name,client_portal')");
  const dFence = dun.indexOf('isSampleProjectName(project.name)');
  const recipAt = dun.indexOf('resolveDunningRecipient(invoice, project.client_portal?.invites)');
  const sendAt = dun.search(/sendEmail\(|fetch\([^)]*resend/i);
  ok('invoice-dunning reads the project name', fetchAt > 0);
  ok('invoice-dunning: fence after the project read, before the recipient is resolved and anything is sent',
    fetchAt > 0 && dFence > fetchAt && recipAt > dFence && (sendAt < 0 || sendAt > dFence), `read ${fetchAt} fence ${dFence} recipient ${recipAt} send ${sendAt}`);
  ok("invoice-dunning: a sample is skipped as 'sample_project' (a named reason, no send, no marker)",
    /if \(isSampleProjectName\(project\.name\)\) \{\s*return skip\('sample_project'\);/.test(dun) && /\| 'sample_project'/.test(dun));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n2b. the QuickBooks fence (qbo-sync, qbo-reconciler, qbo-connect-status)');
{
  const SHARED = 'supabase/functions/_shared/sampleFence.ts';
  const shared = read(SHARED);
  const m = /\/\/ >>> sample-project-fence[\s\S]*?\n([\s\S]*?)\/\/ <<< sample-project-fence/.exec(shared);
  const block = m?.[1] ?? '';
  ok('_shared/sampleFence has the fence block', block.length > 0);
  const prefixLine = (src: string) => src.split('\n').find(l => l.startsWith('const SAMPLE_PROJECT_PREFIX =')) ?? '';
  ok('…its prefix line is byte-identical to create-payment-link\'s (one rule, three restatements)',
    prefixLine(block) !== '' && prefixLine(block) === prefixLine(read('supabase/functions/create-payment-link/index.ts')), prefixLine(block));
  type Verdict = 'sample' | 'real' | 'unknown';
  type FakeRow = Record<string, unknown>;
  type SharedFence = {
    isSampleProjectName: (n: string | null | undefined) => boolean;
    notOnSampleProjectsFilter: (ids: readonly (string | null | undefined)[]) => string;
    sampleProjectIdsFor: (s: unknown, userId: string) => Promise<string[]>;
    qboObjectOnSample: (s: unknown, kind: string, objectId: string, userId: string) => Promise<Verdict>;
  };
  let F: SharedFence | null = null;
  try {
    F = new Function(`${new Bun.Transpiler({ loader: 'ts' }).transformSync(block)}
return { isSampleProjectName, notOnSampleProjectsFilter, sampleProjectIdsFor, qboObjectOnSample };`)() as SharedFence;
  } catch (e) { ok('the shared fence block runs', false, String(e)); }
  if (F) {
    const f = F;
    ok('the shared fence answers exactly like the app\'s rule',
      [DEMO_FLAVORS.small.name, DEMO_FLAVORS.medium.name, 'Sample - x', 'Sample – x', "Sarah's Place", '', null, undefined, `x ${PREFIX}`]
        .every(n => f.isSampleProjectName(n) === CAP.isSampleProjectName(n as string | null | undefined)));
    ok('no sample projects → a tautology (the filter is always safe to append)',
      f.notOnSampleProjectsFilter([]) === 'project_id.is.null,project_id.not.is.null' && f.notOnSampleProjectsFilter([null, '']) === 'project_id.is.null,project_id.not.is.null');
    ok('sample projects → excluded by id, and project-less invoices KEPT (SQL NULL NOT IN drops them)',
      f.notOnSampleProjectsFilter(['p1', 'p2', 'p1']) === 'project_id.is.null,project_id.not.in.("p1","p2")');
    ok('an id can never splice PostgREST syntax: quoted, with " and \\ escaped',
      f.notOnSampleProjectsFilter(['a"),id.eq.(x', 'b\\']) === 'project_id.is.null,project_id.not.in.("a\\"),id.eq.(x","b\\\\")',
      f.notOnSampleProjectsFilter(['a"),id.eq.(x', 'b\\']));

    // A fake of the slice of supabase-js the fence reads with.
    const fakeDb = (tables: Record<string, FakeRow[]>, failOn: string | null = null) => {
      const reads: string[] = [];
      const db = {
        from(table: string) {
          return {
            select(cols: string) {
              const filters: ((r: FakeRow) => boolean)[] = [];
              const run = () => {
                reads.push(`${table}:${cols}`);
                if (failOn === table) return { data: null, error: { message: 'boom' } };
                return { data: (tables[table] ?? []).filter(r => filters.every(fn => fn(r))), error: null };
              };
              const q = {
                eq(col: string, val: string) { filters.push(r => r[col] === val); return q; },
                like(col: string, pattern: string) {
                  const head = pattern.endsWith('%') ? pattern.slice(0, -1) : pattern;
                  filters.push(r => typeof r[col] === 'string' && (r[col] as string).startsWith(head));
                  return q;
                },
                maybeSingle() { const r = run(); return Promise.resolve({ data: r.error ? null : ((r.data as FakeRow[])[0] ?? null), error: r.error }); },
                then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) { return Promise.resolve(run()).then(res, rej); },
              };
              return q;
            },
          };
        },
      };
      return { db, reads };
    };
    const T = {
      projects: [
        { id: 'ps', user_id: 'u1', name: `${PREFIX}Sarah's Place` },
        { id: 'pr', user_id: 'u1', name: 'Henderson Kitchen' },
        { id: 'po', user_id: 'u2', name: `${PREFIX}Sarah's Place` },
        { id: 'pn', user_id: 'u1', name: "Sample - Hyphen" },
      ],
      invoices: [
        { id: 'is', user_id: 'u1', project_id: 'ps' },
        { id: 'ir', user_id: 'u1', project_id: 'pr' },
        { id: 'in', user_id: 'u1', project_id: null },
        { id: 'ic', user_id: 'u3', project_id: 'ps' },
      ],
    };
    const { db, reads } = fakeDb(T);
    const ids = await f.sampleProjectIdsFor(db, 'u1');
    ok('sampleProjectIdsFor: HIS sample projects only (not another user\'s, not a hyphen look-alike)', ids.join() === 'ps', ids.join());
    let threw = false;
    try { await f.sampleProjectIdsFor(fakeDb(T, 'projects').db, 'u1'); } catch { threw = true; }
    ok('…a failed read THROWS (the reconciler never pushes blind)', threw);

    const v = async (kind: string, id: string, user = 'u1', failOn: string | null = null) => f.qboObjectOnSample(fakeDb(T, failOn).db, kind, id, user);
    ok('qbo-sync verdict: the sample project itself → sample', (await v('project', 'ps')) === 'sample');
    ok('…an invoice on the sample → sample', (await v('invoice', 'is')) === 'sample');
    ok('…a payment (<invoice>::<entry>) on the sample → sample', (await v('payment', 'is::pay-1')) === 'sample');
    ok('…a real job\'s project / invoice / payment → real',
      (await v('project', 'pr')) === 'real' && (await v('invoice', 'ir')) === 'real' && (await v('payment', 'ir::pay-1')) === 'real');
    ok('…a project-less invoice → real (nothing to fence)', (await v('invoice', 'in')) === 'real');
    ok('…a row that cannot be read → unknown (refused, never pushed blind)',
      (await v('invoice', 'missing')) === 'unknown' && (await v('invoice', 'is', 'u1', 'projects')) === 'unknown'
        && (await v('invoice', 'is', 'u1', 'invoices')) === 'unknown' && (await v('payment', '::x')) === 'unknown');
    ok('…another user\'s invoice is not read as his', (await v('invoice', 'ic')) === 'unknown');
    reads.length = 0;
    const itemVerdict = await f.qboObjectOnSample(db, 'item', 'x', 'u1');
    ok('…kinds with no project (item) → real, with no read', itemVerdict === 'real' && reads.length === 0);
  }

  const sync = strip(read('supabase/functions/qbo-sync/index.ts'));
  const syncServe = sync.indexOf('serve(async');
  const syncFence = sync.indexOf('await qboObjectOnSample(svc(), body.kind, body.objectId, auth.userId)');
  const firstPush = sync.slice(syncServe).search(/await upsert(Customer|Invoice|PaymentForInvoice|Item)\(/);
  ok('qbo-sync: the fence runs in the handler BEFORE any upsert',
    syncServe > 0 && syncFence > syncServe && firstPush > 0 && syncFence < syncServe + firstPush, `fence ${syncFence} push ${syncServe + firstPush}`);
  ok("qbo-sync: a sample answers success + skipped 'sample_project'; an unreadable row is refused (500)",
    /if \(onSample === 'sample'\) return json\(\{ success: true, skipped: 'sample_project' \}\);/.test(sync)
      && /if \(onSample === 'unknown'\) return json\(\{ success: false, error: [^}]+\}, 500\);/.test(sync));

  const rec = strip(read('supabase/functions/qbo-reconciler/index.ts'));
  const idsAt = rec.indexOf('const sampleProjectIds = await sampleProjectIdsFor(s, row.user_id);');
  const step1 = rec.indexOf('.or(QBO_PUSH_OWED_FILTER)');
  const step1Loop = rec.indexOf('for (const p of (pending ?? [])');
  const step1b = rec.indexOf('.select("id,number,qbo_id,payments,tax_amount")');
  const step1bRange = rec.indexOf('.range(from, from + PAGE - 1)');
  const EXCL = '.or(notOnSampleProjectsFilter(sampleProjectIds))';
  const at1 = rec.indexOf(EXCL, step1);
  const at1b = rec.indexOf(EXCL, step1b);
  ok('qbo-reconciler: reads his sample projects before step 1', idsAt > 0 && idsAt < step1);
  ok('qbo-reconciler step 1 (the owed-invoice push) leaves sample rows out of its query', at1 > step1 && at1 < step1Loop, `${step1} ${at1} ${step1Loop}`);
  ok('qbo-reconciler step 1b (the payment push) leaves them out too', at1b > step1b && at1b < step1bRange, `${step1b} ${at1b} ${step1bRange}`);
  const status = strip(read('supabase/functions/qbo-connect-status/index.ts'));
  ok('qbo-connect-status: the Pending count leaves them out (never "1 pending" forever)',
    /\.or\(QBO_PENDING_COUNT_FILTER\)\s*\.or\(notOnSampleProjectsFilter\(sampleProjectIds\)\)/.test(status)
      && /sampleProjectIds = await sampleProjectIdsFor\(s, auth\.userId\)/.test(status));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n3. analytics — is_sample and in_tutorial on every event');
{
  G.noteSampleScope([{ id: 'p-s', name: DEMO_FLAVORS.small.name }, { id: 'p-r', name: 'Maple' }], []);
  RUN.setActiveTutorialId(null);
  const input = { project_id: 'p-s', type: 'progress' };
  const out = A.withFunnelContext(input)!;
  ok('an event naming a sample project_id gets is_sample: true', out.is_sample === true);
  ok('…without mutating the caller\'s object', !('is_sample' in input));
  ok('a real project_id → is_sample: false', A.withFunnelContext({ project_id: 'p-r' })!.is_sample === false);
  ok('an explicit is_sample wins (addProject knows before the registry does)', A.withFunnelContext({ project_id: 'p-r', is_sample: true })!.is_sample === true);
  ok('no project_id → no is_sample key (not every event is about a job)', !('is_sample' in (A.withFunnelContext({ tier: 'free' }) ?? {})));
  ok('no run → no in_tutorial', !('in_tutorial' in (A.withFunnelContext({ a: 1 }) ?? {})));
  RUN.setActiveTutorialId('daily-report-voice');
  const during = A.withFunnelContext({ a: 1 })!;
  ok('during a run every event carries in_tutorial + tutorial_id', during.in_tutorial === true && during.tutorial_id === 'daily-report-voice' && during.a === 1);
  ok('…even an event with no properties', A.withFunnelContext(undefined)?.in_tutorial === true);
  RUN.setActiveTutorialId(null);
  G.noteSampleScope([], []);

  // track() routes through it.
  const seen: { e: string; p?: Record<string, unknown> }[] = [];
  A.setAnalyticsProvider({ track: (e, p) => { seen.push({ e, p }); } });
  RUN.setActiveTutorialId('punch-walk');
  A.track('x', { project_id: 'nope' });
  RUN.setActiveTutorialId(null);
  ok('track() sends the enriched properties to the provider', seen[0]?.p?.in_tutorial === true && seen[0]?.p?.is_sample === false, JSON.stringify(seen[0]));

  const ev = A.AnalyticsEvents as Record<string, string>;
  const wanted = ['tutorial_offered', 'tutorial_started', 'tutorial_step_completed', 'tutorial_stuck', 'tutorial_assist_used',
    'tutorial_target_missing', 'tutorial_exited', 'tutorial_completed', 'tutorial_handoff_clicked'];
  ok('the 9 tutorial_* events are defined', wanted.every(w => Object.values(ev).includes(w)), wanted.filter(w => !Object.values(ev).includes(w)).join(', '));
  ok('analytics reads the run through activeRun (no cycle through the store)',
    /from '@\/utils\/tutorial\/activeRun'/.test(read('utils/analytics.ts')) && !/tutorial\/store/.test(read('utils/analytics.ts')));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n4. ProjectContext — the seed\'s events, the aha event, QuickBooks');
const CTX = read('contexts/ProjectContext.tsx');
const CODE = strip(CTX);
function extract(name: string): string {
  const decl = `const ${name} = useCallback(`;
  const i = CTX.indexOf(decl);
  if (i < 0) throw new Error(`not found: ${decl}`);
  const rest = CTX.slice(i + decl.length);
  const end = /\n {2}\}, \[[^\n]*\]\);/.exec(rest);
  if (!end) throw new Error(`no end for ${name}`);
  return rest.slice(0, end.index + end[0].length - 2);
}
type Scope = Record<string, unknown>;
function compile<T>(name: string, scope: Scope): T {
  const text = extract(name).replace(/import\('@\/utils\/qboSync'\)/g, '__qbo()');
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`var __r = __cb(${text});`);
  scope.__cb = (fn: unknown) => fn;
  const proxy = new Proxy(scope, {
    has: (_t, k) => typeof k === 'string' && (k in scope || !(k in globalThis)),
    get: (_t, k) => (typeof k === 'string' && k in scope ? scope[k] : () => undefined),
  });
  return new Function('__scope', `with (__scope) { ${js}\n return __r; }`)(proxy) as T;
}
{
  G.noteSampleScope([], []);
  const events: { e: string; p: Record<string, unknown> }[] = [];
  const qbo: string[] = [];
  const track = (e: string, p?: Record<string, unknown>) => { events.push({ e, p: (A.withFunnelContext(p as never) ?? {}) as Record<string, unknown> }); };
  const lists: Record<string, unknown[]> = { projects: [], reports: [], punch: [] };
  const common: Scope = {
    track, AnalyticsEvents: A.AnalyticsEvents,
    isSampleProject: G.isSampleProject, isKnownSampleProjectId: G.isKnownSampleProjectId, noteSampleProject: G.noteSampleProject,
    __qbo: () => Promise.resolve({ triggerQboSync: (k: string, _o: string, id: string) => { qbo.push(`${k}:${id}`); } }),
    canSync: true, userId: 'u1',
    claimProjectForUser: (p: Record<string, unknown>) => ({ ...p, ownerUserId: 'u1' }),
    buildCostDatabase: () => ({}), estimateGroundingProps: () => ({}), commitments: [],
    setProjects: (l: unknown[]) => { lists.projects = l; }, saveProjectsMutation: { mutate: () => {} },
    syncProjectToSupabase: () => {}, geocodeIfNeeded: () => {},
    projectCreateWritesRef: { current: new Map() },
    stageDfrPhotos: (r: unknown) => r, initialPortalState: () => ({ status: 'draft' }),
    dailyReportsRef: { current: [] }, setDailyReports: () => {}, saveDailyReportsMutation: { mutate: () => {} },
    propagateProgressFromDFR: () => {}, touchedWrite: () => Promise.resolve('synced'), proDocWriteTouchRef: { current: new Map() },
    supabaseWrite: () => Promise.resolve(true),
    stagePunchPhoto: (p: unknown) => p, stampPunchCreator: (p: unknown) => p, punchItemsRef: { current: [] },
    setPunchItems: () => {}, savePunchItemsMutation: { mutate: () => {} }, punchItemToRow: (p: unknown) => p,
  };
  const scope: Scope = { ...common, get projects() { return lists.projects; } };
  const addProject = compile<(p: Record<string, unknown>) => unknown>('addProject', scope);
  const addDailyReport = compile<(r: Record<string, unknown>) => void>('addDailyReport', scope);
  const addPunchItem = compile<(p: Record<string, unknown>) => void>('addPunchItem', scope);
  const addPunchItems = compile<(p: Record<string, unknown>[]) => void>('addPunchItems', scope);
  const addNoop = () => {};

  // Seed the real small sample through the compiled context functions.
  const { projectId } = await seedDemoProject({
    addProject: p => { addProject(p as never); }, addInvoice: addNoop,
    addDailyReport: r => addDailyReport(r as never), addPunchItem: p => addPunchItem(p as never),
    addProjectPhoto: addNoop, addRFI: addNoop, addChangeOrder: addNoop, flavor: 'small',
  });
  await new Promise(r => setTimeout(r, 0));
  const created = events.filter(e => e.e === 'project_created');
  ok('the seed fires PROJECT_CREATED with is_sample: true', created.length === 1 && created[0].p.is_sample === true, JSON.stringify(created[0]?.p));
  ok('…and NO estimate_generated (nobody generated the sample\'s estimate — the aha stays real)', !events.some(e => e.e === 'estimate_generated'));
  const dfr = events.filter(e => e.e === 'daily_report_created');
  const punch = events.filter(e => e.e === 'punch_item_created');
  ok('DAILY_REPORT_CREATED now fires — once per seeded report (4), each is_sample: true', dfr.length === 4 && dfr.every(e => e.p.is_sample === true && e.p.project_id === projectId), `${dfr.length}`);
  ok('PUNCH_ITEM_CREATED now fires — once per seeded item (6), each is_sample: true', punch.length === 6 && punch.every(e => e.p.is_sample === true), `${punch.length}`);
  ok('no QuickBooks push for the sample project', !qbo.some(q => q.startsWith('project:')), qbo.join());

  events.length = 0; qbo.length = 0;
  addProject({ id: 'real-1', name: 'Maple St', type: 'renovation', status: 'estimated', linkedEstimate: { grandTotal: 1, items: [] } });
  await new Promise(r => setTimeout(r, 0));
  const realCreated = events.find(e => e.e === 'project_created');
  ok('a real job: PROJECT_CREATED is_sample: false, the aha event still fires, QuickBooks still pushes',
    realCreated?.p.is_sample === false && events.some(e => e.e === 'estimate_generated') && qbo.includes('project:real-1'), JSON.stringify({ realCreated, qbo }));
  // The Activation funnel filters project_created on is_first_project. The
  // sample is seeded BEFORE any real job, so a raw count tagged the sample
  // first and his real first job not (round-3 review).
  ok('is_first_project: never on the sample', created[0]?.p.is_first_project === false, JSON.stringify(created[0]?.p));
  ok('…and TRUE on his first real job even with the sample already on the phone',
    realCreated?.p.is_first_project === true && (lists.projects as unknown[]).length === 2, JSON.stringify({ realCreated, n: lists.projects.length }));
  events.length = 0;
  addProject({ id: 'real-2', name: 'Oak Ave', type: 'renovation', status: 'estimated' });
  await new Promise(r => setTimeout(r, 0));
  ok('…and false on the second real job', events.find(e => e.e === 'project_created')?.p.is_first_project === false);
  events.length = 0;
  addPunchItems([{ id: 'a', projectId: 'real-1' }, { id: 'b', projectId: 'real-1', planSheetId: 's1' }]);
  const batch = events.filter(e => e.e === 'punch_item_created');
  ok('addPunchItems fires one event per item (a batched walk is N items)', batch.length === 2 && batch[1].p.pinned === true && batch.every(e => e.p.is_sample === false));
  G.noteSampleScope([], []);

  // Static placement checks for the call sites that are not run above.
  const addInv = extract('addInvoice');
  ok('addInvoice: INVOICE_CREATED names project_id (track derives is_sample)', /track\(AnalyticsEvents\.INVOICE_CREATED, \{[\s\S]*?project_id: finalInvoice\.projectId,[\s\S]*?\}\);/.test(addInv));
  // addInvoice / recordInvoicePayment / updateInvoice are compiled by
  // validate-invoice-send-integrity (and others) against a FIXED parameter
  // scope: a new identifier in them is a ReferenceError there (watched: the
  // first build of this lane broke it that way). Their pushes are fenced at the
  // utils/qboSync choke point instead (section 8), so they stay byte-identical.
  ok('addInvoice: the QuickBooks push line is untouched (fenced at the qboSync choke point)',
    /if \(!isDraft\) \{\s*void insert\.then\(o => \{\s*if \(o === 'synced'\) void import\('@\/utils\/qboSync'\)/.test(addInv));
  const rip = extract('recordInvoicePayment');
  ok('recordInvoicePayment: the QuickBooks push line is untouched (same choke point)',
    /if \(before\?\.status !== 'draft'\) \{\s*void import\('@\/utils\/qboSync'\)/.test(rip));
  ok('no sample identifier leaks into a callback other validators compile with a fixed scope',
    ['addInvoice', 'recordInvoicePayment', 'updateInvoice'].every(n => !/isKnownSampleProjectId|isSampleProject|noteSample/.test(extract(n))));
  ok('ProjectContext keeps the registry current (effect over projects + invoices)',
    /useEffect\(\(\) => \{ noteSampleScope\(projects, invoices\); \}, \[projects, invoices\]\);/.test(CODE));
  const addP = extract('addProject');
  ok('addProject notes the sample BEFORE its create event (the seed\'s children fire in the same tick)',
    addP.indexOf('noteSampleProject(project)') > 0 && addP.indexOf('noteSampleProject(project)') < addP.indexOf('track(AnalyticsEvents.PROJECT_CREATED'));
  // Every QuickBooks call site in the context is fenced: addProject's here,
  // the five invoice / payment pushes by the utils/qboSync choke point.
  const sites = [...CODE.matchAll(/triggerQboSync\('(project|invoice|payment)'/g)].length;
  ok('the QuickBooks call sites are the known 6 (a new one must be fenced too)', sites === 6, `found ${sites}`);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n5. utils/demoSeed — the small sample bills real lines');
{
  let proj: Record<string, unknown> | null = null;
  const noop = () => {};
  await seedDemoProject({ addProject: p => { proj = p as never; }, addInvoice: noop, addDailyReport: noop, addPunchItem: noop, addProjectPhoto: noop, addRFI: noop, addChangeOrder: noop, flavor: 'small' });
  const le = (proj as unknown as { linkedEstimate?: { items: { lineTotal: number }[]; grandTotal: number; baseTotal: number; markupTotal: number } } | null)?.linkedEstimate;
  ok('the small seed carries a linkedEstimate of 8 lines', !!le && le.items.length === 8);
  ok('…footing to DEMO_FLAVORS.small.total ($422,400), base + markup = grand', !!le && le.grandTotal === DEMO_FLAVORS.small.total
    && le.items.reduce((s, l) => s + l.lineTotal, 0) === 422_400 && le.baseTotal + le.markupTotal === le.grandTotal);
  ok('…with NO fabricated bulkSavingsTotal (demoSeed rule)', !!le && !('bulkSavingsTotal' in le) && !/bulkSavingsTotal\s*:/.test(strip(read('utils/demoSeed.ts'))));
  ok('15 % of it is the $63,360 the invoice tutorial quotes', (le?.grandTotal ?? 0) * FX.SAMPLE_PROGRESS_PCT / 100 === 63_360);
  let med: Record<string, unknown> | null = null;
  await seedDemoProject({ addProject: p => { med = p as never; }, addInvoice: noop, addDailyReport: noop, addPunchItem: noop, addProjectPhoto: noop, addRFI: noop, addChangeOrder: noop, flavor: 'medium' });
  ok('the other flavors are untouched (no linkedEstimate added)', !!med && !(med as Record<string, unknown>).linkedEstimate);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n6. utils/tutorial/sandbox — seed, reuse, top-ups, the plan');
{
  const NAME = DEMO_FLAVORS.small.name;
  // Each world starts a minute after the last, so the sandbox's brief "just
  // seeded" memory never carries from one scenario into the next.
  let clock = Date.parse('2026-09-23T12:00:00Z');
  const makeWorld = (projects: Record<string, unknown>[] = [], planSheets: Record<string, unknown>[] = [], opts: { renders?: boolean } = {}) => {
    clock += 60_000;
    const w = { projects, planSheets, userId: 'u1' as string | null, seeds: 0, updates: [] as { id: string; u: Record<string, unknown> }[], outcome: 'synced' as string };
    const actions = {
      // Like React state: the new project shows up in the world a tick LATER,
      // so a second start in the same frame still sees no sample.
      addProject: (p: Record<string, unknown>) => {
        w.seeds += 1;
        if (opts.renders !== false) setTimeout(() => { w.projects = [{ ...p, ownerUserId: 'u1' }, ...w.projects]; }, 0);
        return Promise.resolve(w.outcome);
      },
      addInvoice: () => {}, addDailyReport: () => {}, addPunchItem: () => {}, addProjectPhoto: () => {}, addRFI: () => {}, addChangeOrder: () => {},
      updateProject: (id: string, u: Record<string, unknown>) => { w.updates.push({ id, u }); },
      addPlanSheet: (s: Record<string, unknown>) => { const sheet = { ...s, id: 'sheet-new' }; w.planSheets = [sheet, ...w.planSheets]; return sheet; },
      updatePlanSheet: () => {},
    };
    const deps = { getWorld: () => ({ projects: w.projects, planSheets: w.planSheets, userId: w.userId }), getActions: () => actions, planBudgetMs: 80, now: () => clock } as never;
    return { w, deps };
  };
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  // No sample → seeds one; two starts in one frame → still one.
  fp.calls.length = 0; fp.answer = 'ok';
  {
    const { w, deps } = makeWorld();
    const [a, b] = await Promise.all([SB.ensureTutorialSample(['estimateLines'], deps), SB.ensureTutorialSample(['estimateLines'], deps)]);
    ok('no sample → seeds "Sample — Sarah\'s Place" (one seed for two concurrent starts)', w.seeds === 1 && a.ok && b.ok && a.ok && b.ok
      && (a as { sandboxProjectId: string }).sandboxProjectId === (b as { sandboxProjectId: string }).sandboxProjectId, `seeds ${w.seeds}`);
    ok('…a fresh seed needs no estimate patch', w.updates.length === 0);
  }
  // Existing, owned sample → reused.
  {
    const own = { id: uuid(1), name: NAME, ownerUserId: 'u1', createdAt: '2026-09-01T00:00:00Z' };
    const { w, deps } = makeWorld([own]);
    const r = await SB.ensureTutorialSample([], deps);
    ok('his existing sample is reused, nothing seeded', r.ok && (r as { sandboxProjectId: string }).sandboxProjectId === own.id && !(r as { seeded: boolean }).seeded && w.seeds === 0);
  }
  // Never a renamed sample, another contractor's sample, or a job shared with him.
  {
    const { w, deps } = makeWorld([
      { id: uuid(2), name: "Sarah's Place", ownerUserId: 'u1' },
      { id: uuid(3), name: NAME, ownerUserId: 'someone-else' },
      { id: uuid(4), name: NAME, ownerUserId: 'gc', myRole: 'field' },
    ]);
    const r = await SB.ensureTutorialSample([], deps);
    ok('a renamed sample, another contractor\'s sample and the GC\'s shared job are never the sandbox — a fresh one is seeded',
      r.ok && w.seeds === 1 && ![uuid(2), uuid(3), uuid(4)].includes((r as { sandboxProjectId: string }).sandboxProjectId));
  }
  // estimateLines top-up.
  {
    const old = { id: uuid(5), name: NAME, ownerUserId: 'u1', linkedEstimate: null };
    const { w, deps } = makeWorld([old]);
    await SB.ensureTutorialSample(['estimateLines'], deps);
    // Two separate top-ups ride on 'estimateLines': the lines, and the job's
    // retainage term (without it /invoice opens the retainage ask on mount).
    const est = w.updates.filter(x => 'linkedEstimate' in x.u);
    const ret = w.updates.filter(x => 'retainagePercent' in x.u);
    const patch = est[0]?.u.linkedEstimate as { items: { lineTotal: number }[]; grandTotal: number } | undefined;
    ok('an older sample with no lines gets the 8 lines patched on (and only linkedEstimate)',
      est.length === 1 && est[0].id === old.id && Object.keys(est[0].u).join() === 'linkedEstimate' && patch?.grandTotal === 422_400);
    ok('…and its missing retainage term recorded as 0 %, his answer (only those two fields)',
      ret.length === 1 && ret[0].id === old.id && Object.keys(ret[0].u).sort().join() === 'retainagePercent,retainagePercentAssumed'
        && ret[0].u.retainagePercent === 0 && ret[0].u.retainagePercentAssumed === false && w.updates.length === 2);
    const withLines = { id: uuid(6), name: NAME, ownerUserId: 'u1', linkedEstimate: { items: [{ lineTotal: 5 }] }, retainagePercent: 10 };
    const x = makeWorld([withLines]);
    await SB.ensureTutorialSample(['estimateLines'], x.deps);
    ok('an estimate that has lines, and a recorded retainage rate, are never overwritten', x.w.updates.length === 0);
  }
  // The plan.
  {
    const s = { id: uuid(7), name: NAME, ownerUserId: 'u1' };
    const durable = { id: 'sheet-1', projectId: uuid(7), name: FX.SAMPLE_PLAN.name, sheetNumber: 'A-101', storagePath: `${uuid(7)}/img.png` };
    fp.calls.length = 0;
    const reuse = makeWorld([s], [durable]);
    const r1 = await SB.ensureTutorialSample(['plan'], reuse.deps);
    ok('a durable A-101 already on the sample is reused (no second upload)', r1.ok && (r1 as { flags: { samplePlan: boolean } }).flags.samplePlan && fp.calls.length === 0);

    fp.calls.length = 0; fp.answer = 'ok'; fs.downloads.length = 0; fs.exists.clear();
    const fresh = makeWorld([s], [{ ...durable, storagePath: undefined }]);
    const r2 = await SB.ensureTutorialSample(['plan'], fresh.deps);
    const call = fp.calls[0];
    ok('otherwise the bundled plan goes through the REAL addFloorPlan as A-101, a PNG, on the sample',
      r2.ok && (r2 as { flags: { samplePlan: boolean } }).flags.samplePlan && fp.calls.length === 1 && call.projectId === uuid(7)
        && call.sheetNumber === 'A-101' && call.name === FX.SAMPLE_PLAN.name && call.mimeType === 'image/png', JSON.stringify(call));
    ok('…read from a cache file (a dev-server asset is downloaded first)', /^file:\/\/\/cache\/tutorial-[0-9a-z]+-sample-plan-a101\.png$/.test(call?.uri ?? '') && fs.downloads.length === 1, call?.uri);

    fp.calls.length = 0; fp.answer = 'fail';
    const failing = makeWorld([s]);
    const r3 = await SB.ensureTutorialSample(['plan'], failing.deps);
    ok('an upload failure → samplePlan: false with the reason (the pin steps auto-skip)',
      r3.ok && !(r3 as { flags: { samplePlan: boolean } }).flags.samplePlan && /signal/.test((r3 as { planReason?: string }).planReason ?? ''));

    fp.calls.length = 0; fp.answer = 'ok';
    const offline = makeWorld([]);
    offline.w.outcome = 'queued';
    const r5 = await SB.ensureTutorialSample(['plan'], offline.deps);
    ok('offline: a freshly seeded sample that only QUEUED gets no upload, samplePlan: false, honest reason',
      r5.ok && !(r5 as { flags: { samplePlan: boolean } }).flags.samplePlan && fp.calls.length === 0 && /offline/.test((r5 as { planReason?: string }).planReason ?? ''));
    // LAST in this block: in a broken build the hung run stays in flight.
    fp.calls.length = 0; fp.answer = 'hang';
    const slow = makeWorld([s]);
    const t0 = Date.now();
    // Raced against our own clock, so a sandbox that ignores its budget fails
    // here instead of hanging the validator.
    const r4 = await Promise.race([
      SB.ensureTutorialSample(['plan'], slow.deps),
      new Promise<{ ok: false; hung: true }>(res => setTimeout(() => res({ ok: false, hung: true }), 1500)),
    ]);
    ok('a hung upload is cut off at the budget → samplePlan: false', r4.ok && !(r4 as { flags: { samplePlan: boolean } }).flags.samplePlan && Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
    ok('the real budget is 8 s', SB.SAMPLE_PLAN_BUDGET_MS === 8000);

  }
  // Concurrent starts with DIFFERENT needs: only the seed is shared.
  {
    fp.calls.length = 0; fp.answer = 'ok';
    const s8 = { id: uuid(8), name: NAME, ownerUserId: 'u1' };
    const mixed = makeWorld([s8]);
    const [dfr, punch] = await Promise.all([SB.ensureTutorialSample([], mixed.deps), SB.ensureTutorialSample(['plan'], mixed.deps)]);
    ok('a punch-walk start during a daily-report boot still gets ITS plan (the top-ups are per caller)',
      dfr.ok && punch.ok && (punch as { flags: { samplePlan: boolean } }).flags.samplePlan && fp.calls.length === 1 && fp.calls[0].projectId === uuid(8), `uploads ${fp.calls.length}`);

    fp.calls.length = 0;
    const none = makeWorld([]);
    const [a, b] = await Promise.all([SB.ensureTutorialSample([], none.deps), SB.ensureTutorialSample(['plan'], none.deps)]);
    ok('…and with no sample yet: one seed, the plan uploaded once onto it',
      a.ok && b.ok && none.w.seeds === 1 && fp.calls.length === 1
        && (a as { sandboxProjectId: string }).sandboxProjectId === (b as { sandboxProjectId: string }).sandboxProjectId
        && fp.calls[0].projectId === (b as { sandboxProjectId: string }).sandboxProjectId, `seeds ${none.w.seeds} uploads ${fp.calls.length}`);

    const old9 = { id: uuid(9), name: NAME, ownerUserId: 'u1', linkedEstimate: null };
    const twice = makeWorld([old9]);
    await Promise.all([SB.ensureTutorialSample(['estimateLines'], twice.deps), SB.ensureTutorialSample(['estimateLines'], twice.deps)]);
    const twiceEst = twice.w.updates.filter(x => 'linkedEstimate' in x.u).length;
    const twiceRet = twice.w.updates.filter(x => 'retainagePercent' in x.u).length;
    ok('two starts on an old sample patch its estimate ONCE (not two estimate ids) and its retainage once',
      twiceEst === 1 && twiceRet === 1, `estimate patches ${twiceEst}, retainage patches ${twiceRet}`);
  }
  // A seed that has not rendered yet is not seeded again.
  {
    const lag = makeWorld([], [], { renders: false });
    const r1 = await SB.ensureTutorialSample([], lag.deps);
    const r2 = await SB.ensureTutorialSample([], lag.deps);
    ok('a start right after a seed (before it renders) reuses that sample, no second seed',
      r1.ok && r2.ok && lag.w.seeds === 1 && (r1 as { sandboxProjectId: string }).sandboxProjectId === (r2 as { sandboxProjectId: string }).sandboxProjectId, `seeds ${lag.w.seeds}`);
    clock += 60_000;
    const r3 = await SB.ensureTutorialSample([], lag.deps);
    ok('…but only briefly: later the world is the truth (a deleted sample is seeded fresh)',
      r3.ok && lag.w.seeds === 2 && (r3 as { sandboxProjectId: string }).sandboxProjectId !== (r1 as { sandboxProjectId: string }).sandboxProjectId);
  }
  // A timed-out upload that is still running is joined, not repeated.
  {
    fp.calls.length = 0; fp.answer = 'held';
    const s10 = { id: uuid(10), name: NAME, ownerUserId: 'u1' };
    const slowWorld = makeWorld([s10]);
    const first = await SB.ensureTutorialSample(['plan'], slowWorld.deps);
    ok('a slow upload misses the budget → samplePlan: false (the upload keeps going)',
      first.ok && !(first as { flags: { samplePlan: boolean } }).flags.samplePlan && fp.calls.length === 1);
    const replay = SB.ensureTutorialSample(['plan'], slowWorld.deps);
    await new Promise(res => setTimeout(res, 10));
    fp.release();
    const second = await replay;
    ok('a replay while it is still running joins it: no second A-101 on the sample, and it gets the landed sheet',
      fp.calls.length === 1 && second.ok && (second as { flags: { samplePlan: boolean } }).flags.samplePlan, `uploads ${fp.calls.length}`);
    fp.answer = 'ok';
    const third = await SB.ensureTutorialSample(['plan'], slowWorld.deps);
    ok('…and after it lands, the durable sheet is reused', third.ok && (third as { flags: { samplePlan: boolean } }).flags.samplePlan && fp.calls.length === 1);
  }
  // The sample photo helper (for the punch walk's chip).
  {
    fs.exists.clear(); fs.copies.length = 0;
    resolvedAssetUri = 'file:///bundle/assets/tutorial/sample-outlet.jpg';
    const img = await SB.samplePhotoImage();
    ok('samplePhotoImage: an embedded / OTA asset is copied to the cache as a JPEG',
      /^file:\/\/\/cache\/tutorial-[0-9a-z]+-sample-outlet\.jpg$/.test(img?.uri ?? '') && img?.mimeType === 'image/jpeg' && fs.copies.length === 1, img?.uri);
    const again = await SB.samplePhotoImage();
    ok('…the same asset is served from that cache file (no second copy)', again?.uri === img?.uri && fs.copies.length === 1);
    resolvedAssetUri = 'file:///bundle/.expo-internal/ota-2/sample-outlet.9f2c.jpg';
    const ota = await SB.samplePhotoImage();
    ok('…an OTA that changes the bundled photo gets a NEW cache file, not the old bytes', !!ota && ota.uri !== img?.uri && fs.copies.length === 2, `${img?.uri} → ${ota?.uri}`);

    // Android release: resolveAssetSource hands back a resource name.
    resolvedAssetUri = 'assets_tutorial_sample_outlet';
    fs.exists.clear(); fs.copies.length = 0;
    assetLocalUri = 'file:///data/user/0/app/cache/ExponentAsset-4b1d.jpg';
    const android = await SB.samplePhotoImage();
    ok('…an Android resource name goes through expo-asset to a local file, then the cache',
      !!android && /^file:\/\/\/cache\/tutorial-[0-9a-z]+-sample-outlet\.jpg$/.test(android.uri) && fs.copies[0] === assetLocalUri, JSON.stringify({ android, copies: fs.copies }));
    assetLocalUri = null;
    fs.exists.clear();
    ok('…a resource nothing can read → null (the chip hides; never a broken upload)', (await SB.samplePhotoImage()) === null);
  }
  const src = strip(read('utils/tutorial/sandbox.ts'));
  ok('sandbox picks the sandbox through sandboxCore.pickSandboxProject (never by name alone)', /pickSandboxProject\(world\.projects, world\.userId, name\)/.test(src));
  ok('sandbox seeds only the small flavor', /flavor: 'small'/.test(src) && !/flavor: '(medium|large)'/.test(src));
  ok('the plan goes through utils/addFloorPlan (the real, durable path)', /from '@\/utils\/addFloorPlan'/.test(src) && /await addFloorPlan\(/.test(src));
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\n7. bundled assets');
{
  const png = 'assets/tutorial/sample-plan-a101.png';
  const jpg = 'assets/tutorial/sample-outlet.jpg';
  ok('the A-101 plan exists and is under 1 MB', existsSync(join(ROOT, png)) && statSync(join(ROOT, png)).size < 1_000_000);
  ok('the outlet illustration exists and is under 200 KB', existsSync(join(ROOT, jpg)) && statSync(join(ROOT, jpg)).size < 200_000);
  const buf = readFileSync(join(ROOT, png));
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  ok('the plan PNG is 1600 × 1100 — the size SAMPLE_PLAN.rooms is normalized against',
    buf.slice(1, 4).toString() === 'PNG' && w === FX.SAMPLE_PLAN.imageSize.w && h === FX.SAMPLE_PLAN.imageSize.h, `${w} × ${h}`);
  const j = readFileSync(join(ROOT, jpg));
  ok('the outlet file is a real JPEG', j[0] === 0xff && j[1] === 0xd8);
}

// ════════════════════════════════════════════════════════════════════════════
if (!LANE_A) {
  console.log('\n8. the screens consult the guard (full mode)');
  const region = (src: string, decl: string) => {
    const i = src.indexOf(decl);
    if (i < 0) return '';
    const rest = src.slice(i);
    const end = /\n {2}\}, \[[^\n]*\]\);/.exec(rest);
    return end ? rest.slice(0, end.index) : rest.slice(0, 4000);
  };
  const GUARD = /\b(isSampleProject|sampleSendPlan|sampleSendAllowed|sampleRecipient)\(/;
  const inv = strip(read('app/invoice.tsx'));
  ok('app/invoice.tsx imports utils/sampleGuard', /from '@\/utils\/sampleGuard'/.test(inv));
  const mint = region(inv, 'const mintPayLinkFor = useCallback(');
  ok("invoice: mintPayLinkFor refuses a sample ({ ok: false, reason: 'sample' }) before calling the server",
    GUARD.test(mint) && /reason: (SAMPLE_PAY_LINK_REFUSAL|'sample')/.test(mint));
  ok('invoice: the send (runConfirmSend) consults the guard', GUARD.test(region(inv, 'const runConfirmSend = useCallback(')));
  ok('invoice: Send reminder consults the guard', GUARD.test(region(inv, 'const handleSendReminder = useCallback(')));
  const gen = region(inv, 'const handleGeneratePayLink = useCallback(');
  ok('invoice: Generate payment link consults the guard (or goes through mintPayLinkFor)', GUARD.test(gen) || /mintPayLinkFor\(/.test(gen));
  const dfr = strip(read('app/daily-report.tsx'));
  ok('app/daily-report.tsx: Submit (handleConfirmSend) consults the guard', GUARD.test(region(dfr, 'const handleConfirmSend = useCallback(')));
  // A sample is a real synced row any Pro owner can open /change-order on
  // (the practice pass no longer does), so its send is fenced like the
  // invoice and DFR sends: nothing from a sample reaches a client or a sub.
  const co = strip(read('app/change-order.tsx'));
  const coSend = region(co, 'const handleConfirmSend = useCallback(');
  ok('app/change-order.tsx: the send (handleConfirmSend) refuses any recipient but his own on a sample, before anything is written',
    /if \(!sampleSendAllowed\(project \?\? '', sendRecipientEmail, authEmailRef\.current\)\) \{[\s\S]{0,300}?return;/.test(coSend)
      && coSend.indexOf('sampleSendAllowed(') < coSend.indexOf('persistCO(') && coSend.indexOf('sampleSendAllowed(') < coSend.indexOf('sendEmail('));
  // ai-punch no longer sees the practice pass at all: the pass is opt-in on
  // punch-walk / invoice / the hub only (validate-tutorial-field-screens pins
  // that allowlist), so useProjectAccess there is back to tier-or-invite and
  // `granted && !ownTier` is exactly "invited" again.
  const aip = strip(read('app/ai-punch.tsx'));
  ok('app/ai-punch.tsx: never reads the practice pass (so it can never pass for an invite)',
    !/useTutorialPractice|tutorialPractice/.test(aip)
      && /const collaboratorGranted =\s*canAccessOnProject\('punch_list_closeout'\) && !canAccessOwnTier\('punch_list_closeout'\);/.test(aip));
  const qbo = strip(read('utils/qboSync.ts'));
  const trig = qbo.slice(qbo.indexOf('export async function triggerQboSync('), qbo.indexOf('export async function triggerQboSync(') + 600);
  ok('utils/qboSync.triggerQboSync is the choke point: it refuses a sample object (covers updateInvoice\'s pinned chains)',
    /isSampleQboObject\(kind, objectId\)/.test(trig));
} else {
  console.log('\n8. (skipped: --lane-a — the screen lanes and the qboSync join land these)');
}

console.log(`\n${pass} passed, ${fail} failed${LANE_A ? ' (lane-a mode)' : ''}`);
if (fail > 0) process.exit(1);
