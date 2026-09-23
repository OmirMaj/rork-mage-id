// scripts/validate-w4-plans-fixes.ts — wave 4, lane plans (chain D).
//
// Behaviour first (the real modules executed under bun, with the Supabase
// client and mageAI stubbed), source pins only where the subject is a screen
// no bun process can mount.
//
//   #93/#113 RFI drawings stored as signed URLs died 24 h after they were
//            minted — on the GC's own RFI and on the architect's reply page.
//   #94      A pin RFI raised offline (or on a photo-library sheet) carried no
//            sheet, yet the email promised the pin "circled on the sheet".
//   #95      An RFI raised elsewhere could never be put on a plan pin.
//   #112     Every Plans / viewer focus re-signed every sheet → a fresh URL →
//            every drawing downloaded again.
//   #114     An editor could file a revision but not re-index the plans.
//   #115     Accepting title-block numbers was silent and re-spent plan reads.
//   #116     Compare printed the phone's guessed RFI number.
//   #117     A failed answer step printed "couldn't reach the plan brain".
//   #118     An editor could not delete the sheets he imported by mistake.
//
// Run: bun run scripts/validate-w4-plans-fixes.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments stripped — a rule about CODE is not satisfied by prose. */
const code = (p: string) => read(p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').filter(l => !/^\s*(\/\/|\*)/.test(l)).join('\n');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// ── stubs ───────────────────────────────────────────────────────────────────
const HOST = 'https://nteoqhcswappxxjlpvap.supabase.co';
const PROJECT = '11111111-2222-3333-4444-555555555555';
const KEY = `${PROJECT}/sheet-a-page-1.png`;
const SIGNED = (p: string, tok = 'tok') => `${HOST}/storage/v1/object/sign/plan-sheets/${p}?token=${tok}`;
const PUBLIC = (p: string) => `${HOST}/storage/v1/object/public/plan-sheets/${p}`;

let signCalls = 0;
let signTok = 'tok';
let signOk = true;
let signHold: Promise<void> | null = null;
let invokeHandler: (fn: string, body: Record<string, unknown>) => { data: unknown; error: unknown } =
  () => ({ data: null, error: null });
let mageResult: Record<string, unknown> = { success: true, data: 'A-201 shows the header.' };

const supabaseStub = {
  storage: {
    from: () => ({
      createSignedUrls: async (paths: string[]) => {
        signCalls++;
        const tok = signTok;
        if (signHold) await signHold;
        if (!signOk) return { data: null, error: { message: 'offline' } };
        return { data: paths.map(p => ({ path: p, signedUrl: SIGNED(p, tok), error: null })), error: null };
      },
    }),
  },
  functions: { invoke: async (fn: string, opts: { body: Record<string, unknown> }) => invokeHandler(fn, opts.body) },
};

interface BunGlobal {
  plugin(def: { name: string; setup: (build: { module(s: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void }) => void }): void;
}
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) { console.error('must run under bun'); process.exit(1); }
bun.plugin({
  name: 'w4-plans-stubs',
  setup(build) {
    build.module('@/lib/supabase', () => ({ exports: { supabase: supabaseStub, isSupabaseConfigured: true }, loader: 'object' }));
    build.module('@/utils/mageAI', () => ({ exports: { mageAI: async () => mageResult }, loader: 'object' }));
    build.module('@/utils/planCodeReviewer', () => ({ exports: { imageUriToBase64: async () => ({ base64: '', mimeType: 'image/png' }) }, loader: 'object' }));
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
  },
});

const urls = await import('../utils/planSheetUrls');
const RA = await import('../utils/plans/revisionActions');
const MI = await import('../utils/plans/memoryIndexCore');
const AYP = await import('../utils/plans/askYourPlans');

// ── #93 / #113 / #94: what an RFI stores for a drawing ──────────────────────
console.log('\n#93/#113 an RFI keeps the durable key, never a signed URL');
{
  const a = RA.attachableSheetUri;
  ok('a signed URL is reduced to its key', a(SIGNED(KEY)) === KEY, a(SIGNED(KEY)));
  ok('a legacy public URL is reduced to its key', a(PUBLIC(KEY)) === KEY);
  ok('a bare project-scoped key is kept (the offline cache holds one — #94)', a(KEY) === KEY);
  ok('a bare key under the shared tmp/ prefix is dropped (no policy can sign it)', a('tmp/x.png') === '');
  ok('a legacy tmp/ URL keeps its URL (there is no signable key)', a(PUBLIC('tmp/x.png')) === PUBLIC('tmp/x.png'));
  ok('a device-local file is dropped', a('file:///var/a.png') === '');
  ok('a foreign https image is kept as it is', a('https://example.com/a.png') === 'https://example.com/a.png');
  const inputs = [SIGNED(KEY), PUBLIC(KEY), KEY, `/${KEY}`, 'file:///a', '', `${HOST}/storage/v1/object/plan-sheets/${KEY}`, 'https://example.com/x', `${HOST}/storage/v1/object/public/project-photos/x.jpg`, SIGNED(`${PROJECT}/a%20b.png`)];
  ok('the pure key reader agrees with planSheetUrls.planSheetStoragePath on every input',
    inputs.every(i => RA.planSheetKeyOf(i) === urls.planSheetStoragePath(i)),
    inputs.filter(i => RA.planSheetKeyOf(i) !== urls.planSheetStoragePath(i)).join(' | '));
  ok('sheetAttachmentFor prefers storagePath', RA.sheetAttachmentFor({ storagePath: KEY, imageUri: SIGNED('other') }) === KEY);
  ok('sheetAttachmentFor recovers the key from a cached bare imageUri (offline)', RA.sheetAttachmentFor({ imageUri: KEY }) === KEY);
  ok('a photo-library sheet (no upload) attaches nothing', RA.sheetAttachmentFor({ imageUri: '' }) === '' && RA.sheetAttachmentFor({ imageUri: 'file:///x.jpg' }) === '');

  const now = new Date(2026, 8, 19, 12);
  const offline = RA.rfiFromPin({ projectId: PROJECT, sheetNumber: 'A-101', name: 'A-101' }, { x: 0.4, y: 0.6 }, now, { sheetImageUri: KEY });
  ok('#94 a pin RFI raised offline (bare key) carries the sheet', offline.attachments.includes(KEY) && /A-101 is attached/.test(offline.question));
  const signed = RA.rfiFromPin({ projectId: PROJECT, name: 'A-101' }, { x: 0.4, y: 0.6 }, now, { sheetImageUri: SIGNED(KEY), photo: { id: 'p1', uri: 'https://x/p.jpg' } });
  ok('a signed sheet URL is stored as its key; the photo stays first', signed.attachments[0] === 'https://x/p.jpg' && signed.attachments[1] === KEY);
  const cand = RA.rfiFromCandidate({ subject: 's', question: 'q' }, { projectId: PROJECT, name: 'A-101' }, null, now, { sheetImages: [SIGNED(KEY), SIGNED(`${PROJECT}/new.png`)] });
  ok('#113 a Compare RFI stores both drawings as keys', cand.attachments.join(',') === `${KEY},${PROJECT}/new.png`, cand.attachments.join(','));
  ok('no RFI builder stores a token-bearing URL', ![...offline.attachments, ...signed.attachments, ...cand.attachments].some(u => /token=/.test(u)));

  ok('attachmentsHaveSheet matches a legacy signed URL to the key', RA.attachmentsHaveSheet([SIGNED(KEY)], KEY));
  ok('…and not a different sheet', !RA.attachmentsHaveSheet([SIGNED(`${PROJECT}/b.png`)], KEY));
  const circled = RA.pinLocationLine({ sheetName: 'A-101', x: 0.4, y: 0.6, circledAtReplyLink: true });
  const words = RA.pinLocationLine({ sheetName: 'A-101', x: 0.4, y: 0.6, circledAtReplyLink: false });
  ok('#94 the circle is promised only when the pin\'s sheet tile was signed', /circled on the sheet at the reply link/.test(circled) && !/circled/.test(words));
  ok('…otherwise the email says the location is given in words', /location is given here in words/.test(words) && /40% across and 60% down/.test(words));
}

// ── #112: the signature cache ───────────────────────────────────────────────
console.log('\n#112 a still-fresh signature is reused, so the image cache hits');
{
  urls.clearPlanSheetUrlCache();
  signCalls = 0; signTok = 't1'; signOk = true;
  const first = await urls.resolvePlanSheetUrls([KEY]);
  signTok = 't2';
  const second = await urls.resolvePlanSheetUrls([KEY, PUBLIC(KEY)]);
  ok('the second read signs nothing', signCalls === 1, `calls=${signCalls}`);
  ok('…and hands back the SAME url (no image-cache miss)', second.get(KEY) === first.get(KEY) && first.get(KEY) === SIGNED(KEY, 't1'));
  ok('…keyed by what each caller holds (a legacy URL too)', second.get(PUBLIC(KEY)) === SIGNED(KEY, 't1'));
  // Near expiry: jump the clock to 23.5 h later — less than an hour left.
  const realNow = Date.now;
  Date.now = () => realNow() + (23.5 * 3600 * 1000);
  const late = await urls.resolvePlanSheetUrls([KEY]);
  Date.now = realNow;
  ok('a signature with under an hour left is re-signed', signCalls === 2 && late.get(KEY) === SIGNED(KEY, 't2'), `calls=${signCalls}`);
  urls.clearPlanSheetUrlCache();
  signTok = 't3';
  const afterClear = await urls.resolvePlanSheetUrls([KEY]);
  ok('clearPlanSheetUrlCache (sign-out / tenant wipe) forces a fresh signature', afterClear.get(KEY) === SIGNED(KEY, 't3'));
  // A wipe while a batch is in flight must not let the old account's url back in.
  urls.clearPlanSheetUrlCache();
  let release: () => void = () => undefined;
  signHold = new Promise<void>(r => { release = r; });
  signTok = 'old-account';
  const inflight = urls.resolvePlanSheetUrls([KEY]);
  urls.clearPlanSheetUrlCache();
  release();
  await inflight;
  signHold = null;
  signTok = 'new-account';
  const fresh = await urls.resolvePlanSheetUrls([KEY]);
  ok('a batch in flight across a wipe is not cached', fresh.get(KEY) === SIGNED(KEY, 'new-account'), fresh.get(KEY));
  urls.clearPlanSheetUrlCache();
  signOk = false;
  const refused = await urls.resolvePlanSheetUrls([KEY]);
  ok('a refused signing still leaves the entry absent (caller keeps its value)', refused.size === 0);
  signOk = true;
  const src = code('utils/planSheetUrls.ts');
  ok('the cache is memory only (never AsyncStorage)', !/AsyncStorage/.test(src));
  ok('the TTL was not lengthened', urls.PLAN_SHEET_URL_TTL_SECONDS === 60 * 60 * 24);
}

// ── #114 / #118: who may index and delete ───────────────────────────────────
console.log('\n#114 an editor indexes; #118 an editor deletes the sheets he added');
{
  ok('editor indexes', RA.planControlBlock('editor', 'index') === null);
  ok('viewer / field are refused in the server\'s words',
    RA.planControlBlock('viewer', 'index') === RA.PLAN_INDEX_REFUSAL && RA.planControlBlock('field', 'index') === RA.PLAN_INDEX_REFUSAL);
  for (const fn of ['supabase/functions/plan-extract/index.ts', 'supabase/functions/project-memory-embed/index.ts']) {
    ok(`${fn.split('/')[2]} refuses with the same sentence`, read(fn).includes(RA.PLAN_INDEX_REFUSAL.replace('\u2014', '—')));
  }
  ok('a viewer / field seat is never told to "tap Index"',
    !/tap Index/i.test(RA.staleMatchesNote(2, true, false) ?? '') && !/Tap Index/.test(RA.staleMatchesNote(2, false, false) ?? '')
    && /owner or an editor/.test(RA.staleMatchesNote(2, true, false) ?? ''));
  ok('a seat that can index still is', /tap Index/.test(RA.staleMatchesNote(2, true, true) ?? ''));
  const panel = code('components/plans/AskPlansPanel.tsx');
  ok('the panel passes canIndex from its own index block', /staleMatchesNote\(staleDropped, !!answer, indexBlock === null\)/.test(panel));

  ok('owner deletes any sheet', RA.sheetDeleteBlock('owner', {}, 'u1') === null);
  ok('an editor deletes a sheet he added', RA.sheetDeleteBlock('editor', { userId: 'u1' }, 'u1') === null);
  ok('…not someone else\'s', /someone else added this one/.test(RA.sheetDeleteBlock('editor', { userId: 'u2' }, 'u1') ?? ''));
  ok('…nor a legacy sheet with no uploader', RA.sheetDeleteBlock('editor', {}, 'u1') !== null);
  ok('a field / viewer seat never deletes', RA.sheetDeleteBlock('field', { userId: 'u1' }, 'u1') !== null && RA.sheetDeleteBlock('viewer', { userId: 'u1' }, 'u1') !== null);
  ok('an unresolved role says why', /Checking/.test(RA.sheetDeleteBlock(null, { userId: 'u1' }, 'u1') ?? ''));
  const ra = read('utils/plans/revisionActions.ts');
  ok('the comment names the live policy', /plan_sheets_collab_delete/.test(ra) && !/plan_sheets_all_own/.test(ra));
  const plans = code('app/plans.tsx');
  ok('Plans decides delete per sheet, for the alert AND the row icon',
    /const block = deleteBlockFor\(sheet\);/.test(plans) && /deleteBlockFor\(s\) \? \{ opacity: 0\.4 \}/.test(plans) && /accessibilityHint=\{deleteBlockFor\(s\) \?\? undefined\}/.test(plans)
    && !/planControlBlock\(seatRole, 'delete'/.test(plans));
  ok('a fresh PDF import carries its uploader locally', /userId: authUser\?\.id,/.test(plans));
}

// ── #115: accepting title-block numbers ─────────────────────────────────────
console.log('\n#115 renumbering re-embeds from the text already read, and says so');
{
  const sheets = [
    { id: 's1', name: 'Set p1' }, { id: 's2', name: 'Set p2' }, { id: 'old', name: 'A-201 IFC', sheetNumber: 'A-201', createdAt: '2026-01-01' },
  ];
  const patches = [
    { id: 's1', updates: { sheetNumber: 'A-101' } },
    { id: 's2', updates: { sheetNumber: 'A-201', superseded: true } },
    { id: 'old', updates: { revision: 2 } },
  ];
  const plan = MI.renumberReembedPlan(patches, sheets, { s1: 'text one', s2: 'text two' });
  ok('a renumbered live sheet is re-embedded under its NEW number', plan.reembed.length === 1 && plan.reembed[0].sheet.id === 's1' && plan.reembed[0].sheet.sheetNumber === 'A-101');
  ok('a sheet the renumber superseded is left out', !plan.reembed.some(r => r.sheet.id === 's2') && !plan.missingText.some(s => s.id === 's2'));
  ok('a chain-only patch (revision) is not a renumber', !plan.reembed.some(r => r.sheet.id === 'old'));
  const noText = MI.renumberReembedPlan([{ id: 's1', updates: { sheetNumber: 'A-101' } }], sheets, {});
  ok('a sheet whose text this run does not hold is reported, not silently re-read', noText.reembed.length === 0 && noText.missingText.length === 1);
  const msg = MI.renumberSavedMessage(2, ['Set p2: A newer copy of A-201 is already in the set, so this sheet is now marked superseded.'], { reembedded: 1, failed: null, missingText: 1 });
  ok('the alert names the superseded sheet (plan.messages)', /now marked superseded/.test(msg));
  ok('…the re-embed, and the read the next Index will spend', /no extra plan reads/.test(msg) && /next Index re-reads it \(1 plan read\)/.test(msg));

  let embedBodies: Record<string, unknown>[] = [];
  invokeHandler = (fn, body) => { if (fn === 'project-memory-embed') embedBodies.push(body); return { data: { success: true }, error: null }; };
  const sheet = { id: 's1', projectId: PROJECT, name: 'Set p1', sheetNumber: 'A-101', storagePath: KEY, imageUri: '', createdAt: '', updatedAt: '' };
  const out = await AYP.reembedRenumberedSheets(PROJECT, [{ sheet, text: 'GRID C/4 HEADER W12x26' }]);
  const docs = (embedBodies[0]?.docs ?? []) as { ref: string; content_hash: string }[];
  ok('the re-embed spends embeddings only (no plan-extract call)', out.reembedded === 1 && embedBodies.length === 1);
  ok('…citing the new number with the new fingerprint', docs[0]?.ref === 'A-101' && docs[0]?.content_hash === MI.planSheetFingerprint(sheet));
  embedBodies = [];
  invokeHandler = () => ({ data: { success: false, error: 'Embedding upstream failed.' }, error: null });
  const bad = await AYP.reembedRenumberedSheets(PROJECT, [{ sheet, text: 'x' }]);
  ok('a failed re-embed says why', bad.reembedded === 0 && bad.failed === 'Embedding upstream failed');

  const panel = code('components/plans/AskPlansPanel.tsx');
  const apply = panel.slice(panel.indexOf('const applyTitleNumbers'), panel.indexOf('const jumpToSheet'));
  ok('the panel shows the saved alert, clears the stale summary and re-embeds',
    /showAlert\('Sheet numbers saved', renumberSavedMessage\(/.test(apply) && /setIndexState\('idle'\)/.test(apply) && /setIndexResult\(null\)/.test(apply)
    && /reembedRenumberedSheets\(projectId, reembed\)/.test(apply));
  ok('the run returns its transcriptions for that', /result\.extractedText\[sheet\.id\] = text/.test(code('utils/plans/askYourPlans.ts')));
}

// ── #117: a failed answer step ──────────────────────────────────────────────
console.log('\n#117 a failed answer is said as itself, not as an answer');
{
  const sheet = { id: 's1', projectId: PROJECT, name: 'A-101', sheetNumber: 'A-101', imageUri: '', createdAt: '', updatedAt: '' };
  invokeHandler = (fn) => (fn === 'project-memory-search'
    ? { data: { success: true, matches: [{ doc_id: 'plan-sheet:s1', source: 'Plan Sheet', ref: 'A-101', content: 'HEADER', similarity: 0.9 }] }, error: null }
    : { data: null, error: null });
  mageResult = { success: false, data: null, error: 'You\u2019ve used this month\u2019s AI allowance.', errorKind: 'monthly_cap' };
  const capped = await AYP.askPlans(PROJECT, 'header?', [sheet]);
  ok('a cap refusal is answerFailed with its own words, no answer text', capped.answer === '' && capped.answerFailed === 'You\u2019ve used this month\u2019s AI allowance' && capped.searchFailed === null);
  ok('…and is final (no "try again" that charges the owner again)', capped.answerFailedKind === 'final');
  mageResult = { success: false, data: null, error: 'Request timed out.', errorKind: 'timeout' };
  const slow = await AYP.askPlans(PROJECT, 'header?', [sheet]);
  ok('a timeout may be retried', slow.answerFailedKind === 'retry');
  mageResult = { success: true, data: 'A-101 shows a W12x26 header.' };
  const good = await AYP.askPlans(PROJECT, 'header?', [sheet]);
  ok('a real answer is unchanged', good.answer.startsWith('A-101') && good.answerFailed === null);
  ok('the old fixed sentence is gone', !/plan brain/.test(code('utils/plans/askYourPlans.ts')));
  const panel = read('components/plans/AskPlansPanel.tsx');
  ok('the panel words it as a found-but-unwritten answer, retry only when it helps',
    /Found matching sheets, but couldn&apos;t write the answer — \{answerFailed\.reason\}\.\{answerFailed\.retry \? ' Try again in a moment\.' : ''\}/.test(panel));
}

// ── #116: Compare's RFI number ──────────────────────────────────────────────
console.log('\n#116 Compare shows the server\'s RFI number, never its own guess');
{
  const cd = code('app/compare-drawings.tsx');
  ok('the maps keep the id only', /useState<Record<number, \{ id: string \}>>/.test(cd) && !/number: rfi\.number/.test(cd));
  ok('no line prints a stored RFI number', !/(rfiByIndex|changeRfi)\[i\]\.number/.test(cd));
  ok('the label reads useServerRecordNumber per row', /useServerRecordNumber\('rfis', id, undefined\)/.test(cd) && /recordNumberLabel\('RFI', info\.state, info\.number, undefined\)/.test(cd));
  ok('both displays use it', (cd.match(/<CompareRfiLabel/g) ?? []).length === 2);
  ok('#113 Compare attaches the durable keys', /sheetAttachmentFor\(oldSheet\)/.test(cd) && !/\[oldSheet\?\.imageUri, pairNew \? pairNew\.imageUri : newPageUrl\]/.test(cd));
}

// ── #95: linking an existing RFI to a pin ───────────────────────────────────
console.log('\n#95 a pin can take an RFI raised elsewhere');
{
  const pv = code('app/plan-viewer.tsx');
  const link = pv.slice(pv.indexOf('const handleLinkRfi'), pv.indexOf('const openLinkedRfi'));
  ok('the pick links the pin both ways through the queued pin write', /updateDrawingPin\(selectedPin\.id, \{ linkedRfiId: rfiId, kind: 'rfi' \}\)/.test(link));
  ok('an unsent RFI gets the sheet key; a sent one is not rewritten',
    /const sent = \(rfi\.handoffs \?\? \[\]\)\.some\(h => h\.toParty === 'architect'\)/.test(link) && /!sent && sheetValue && !attachmentsHaveSheet/.test(link) && /updateRFI\(rfi\.id, updates\)/.test(link));
  ok('only open RFIs no pin carries are offered',
    /r\.status !== 'closed' && r\.status !== 'void' && !pinned\.has\(r\.id\)/.test(pv));
  ok('the entry is shown next to Raise RFI, and says when there is nothing to link',
    /testID="pin-link-existing-rfi"/.test(pv) && /none open without a pin/.test(pv) && /No open RFIs to link/.test(pv));
  ok('the viewer raises pin RFIs with the durable sheet key', /sheetImageUri: sheetAttachmentFor\(sheet\)/.test(pv) && !/attachableSheetUri\(sheet\.imageUri\)/.test(pv));
  ok('a viewer seat is refused before linking', /onLinkRfi=\{\(id\) => \{ if \(refuseMarkup\(\)\) return; handleLinkRfi\(id\); \}\}/.test(pv));
}

// ── #93 / #94: the RFI screen ───────────────────────────────────────────────
console.log('\n#93/#94 the RFI screen signs drawings when it draws them');
{
  const rfi = code('app/rfi.tsx');
  ok('a signing effect keyed on the plan-sheet attachments', /void resolvePlanSheetUrls\(sheetRefsKey\.split\('\\n'\)\)/.test(rfi) && /\}, \[sheetRefsKey\]\);/.test(rfi));
  ok('the tile renders the fresh signature', /const signed = signedSheets\.map\.get\(uri\);\s*if \(signed\) return \{ uri: signed,/.test(rfi));
  ok('unsigned → a placeholder that says why, never a blank image',
    /sheet === 'loading' \|\| sheet === 'unavailable'/.test(rfi) && /Drawing loads when you\\u2019re online/.test(rfi));
  const send = rfi.slice(rfi.indexOf('const handleSendToPro'), rfi.indexOf('// ─── MAGE suggests'));
  ok('the send never stores a minted url', !/attachments: minted/.test(send) && /\.\.\.\(durableChanged \? \{ attachments: durable \} : \{\}\)/.test(send));
  ok('#94 the send adds a missing pinned sheet', /pinSheetValue && !attachmentsHaveSheet\(reduced, pinSheetValue\)/.test(send));
  ok('#94 the circle is promised only for a signed tile of the pin\'s sheet',
    /circledAtReplyLink: !!replyPortalUrl && !!pinKey\s*&& durable\.some\(u => planSheetStoragePath\(u\) === pinKey && minted\.has\(u\)\)/.test(send));
  ok('#94 the screen note has three honest cases', /isn\\u2019t uploaded, so the architect gets the pin\\u2019s location in words only/.test(rfi)
    && /The pinned sheet is attached when you send/.test(rfi) && /The pin is circled on the sheet at the architect\\u2019s reply link/.test(rfi));
  // Execute the durable reducer and the sheet predicate as written.
  const helpers = read('app/rfi.tsx');
  const a = helpers.indexOf('function isPlanSheetAttachment');
  const b = helpers.indexOf('const RFI_PIPELINE_STAGES');
  const js = helpers.slice(a, b).replace(/\(u: string\): boolean/g, '(u)').replace(/\(u: string\): string/g, '(u)');
  const ctx: Record<string, unknown> = { planSheetStoragePath: urls.planSheetStoragePath, isProjectScopedPlanSheetPath: urls.isProjectScopedPlanSheetPath };
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  const durable = ctx.durableAttachment as (u: string) => string;
  const isSheet = ctx.isPlanSheetAttachment as (u: string) => boolean;
  ok('an old row\'s signed URL is reduced to the key on send', durable(SIGNED(KEY)) === KEY);
  ok('a device photo and a photo URL are left alone', durable('file:///a.jpg') === 'file:///a.jpg' && durable(`${HOST}/storage/v1/object/sign/project-photos/p.jpg?token=x`).includes('project-photos'));
  ok('a bare non-project string is not a drawing (no false "unavailable" tile)', !isSheet('x') && isSheet(KEY) && isSheet(SIGNED('tmp/x.png')));
}

// ── #93: the architect's reply page ─────────────────────────────────────────
console.log('\n#93 the reply page signs the drawings on every open');
{
  const html = read('marketing/architect/index.html');
  const src = html.slice(html.indexOf('function viewableAttachments'), html.indexOf('function renderRFI'));
  const ctx: Record<string, unknown> = { SUPABASE_URL: HOST, escHtml: (s: string) => String(s), TOKEN: 'tok' };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const view = ctx.viewableAttachments as (l: unknown, s?: unknown) => { src: string; key: string }[];
  const keys = ctx.sheetKeysOf as (l: unknown) => string[];
  const block = ctx.attachmentBlock as (l: unknown, p: unknown, s?: unknown) => string;
  const fresh = SIGNED(KEY, 'fresh');
  ok('a bare key is a tile, drawn from the freshly signed url', view([KEY], { [KEY]: fresh })[0]?.src === fresh);
  ok('an old stored signed URL is re-signed by its key', view([SIGNED(KEY, 'dead')], { [KEY]: fresh })[0]?.src === fresh);
  ok('unsigned (function not live yet) falls back to the public address', view([KEY], {})[0]?.src === PUBLIC(KEY));
  ok('the keys sent to the function are object keys, deduplicated', keys([KEY, SIGNED(KEY), 'file:///a.jpg', 'x']).join(',') === KEY);
  ok('a bare non-project string is not treated as a drawing', view(['x'], {}).length === 0);
  ok('the pin is circled on a bare-key tile (pin_marks.sheet_path is the key)',
    /class="att-pin"/.test(block([KEY], [{ x: 0.4, y: 0.6, sheet_path: KEY }], { [KEY]: fresh })));
  ok('the page calls signed-media-urls with the share token (CONTRACT 14)',
    /\/functions\/v1\/signed-media-urls/.test(html) && /kind: 'rfi_sheets', shareToken: TOKEN, paths: keys/.test(html));
  ok('…before it renders the RFI', /return signSheets\(sheetKeysOf\(data\.attachments\)\)\.then\(function \(urls\) \{ renderRFI\(data, urls\); \}\);/.test(html));
  ok('a failed signing never breaks the page', /\.catch\(function \(\) \{ return \{\}; \}\)/.test(html));
  ok('rfi-core\'s closed-RFI handling is kept', /function rfiIsClosed\(rfi\)/.test(html) && /closed \? closedBlock\(\)/.test(html));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
