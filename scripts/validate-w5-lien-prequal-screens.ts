// validate-w5-lien-prequal-screens.ts — wave 5, lane lien-prequal, client half.
//
//   #30  a failed waiver read is never "No waivers yet"; the last good list is
//        cached per project; failed void / received / delete say so
//   #31  paper record is conditional on the ROW being unsigned; status changes
//        write status only; Void sits behind a destructive confirm; the screen
//        re-reads on focus / foreground / pull
//   #29  non-owners see the owner-only reason, never the list or its controls
//   #147 (carry) web PDF export throws on a blocked pop-up (CONTRACT 25)
//   #24  prequal decisions write the FRESH packet with only review fields over it
//   #32  a decided / lapsed packet can be renewed (new token, cleared decision)
//   #111 the sub sees the GC's decision + note; the GC's decision opens an email
//   #113 no cross-contractor promise; signed-out subs are offered sign-up
//   #114 the form keeps sending the criteria it loaded (never null)
//
// The engine is EXECUTED against a scripted Supabase fake and in-memory
// storage; prequal-manager's pure block is transpiled and executed; the rest is
// pinned on the screens' live code (comments stripped).
//
// Run: bun run scripts/validate-w5-lien-prequal-screens.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Comment-stripped source: a commented-out line is not wired code. */
const live = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

// ─────────────────────────────────────────────────────────────────────
// A. The engine, executed
// ─────────────────────────────────────────────────────────────────────
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: {
  plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void;
  Transpiler: new (o: { loader: 'ts' | 'tsx' }) => { transformSync: (src: string) => string };
} | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-w5-lien-prequal-screens must run under bun (Bun.plugin / Bun.Transpiler)\n');
  process.exit(1);
}

/** Every call the engine makes against the fake, and the answer queue. */
interface Call { table: string; ops: [string, unknown[]][] }
const calls: Call[] = [];
let answers: { data: unknown; error: unknown }[] = [];
function builder(table: string) {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const b: Record<string, unknown> = {};
  for (const op of ['select', 'eq', 'order', 'delete', 'update', 'insert', 'upsert', 'is', 'neq', 'maybeSingle', 'single']) {
    b[op] = (...args: unknown[]) => { call.ops.push([op, args]); return b; };
  }
  b.then = (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
    const a = answers.shift() ?? { data: null, error: null };
    return Promise.resolve(a).then(resolve, reject);
  };
  return b;
}
const fakeSupabase = {
  from: (t: string) => builder(t),
  auth: { getSession: async () => ({ data: { session: { user: { id: 'gc-1' } } } }) },
};
const storage = new Map<string, string>();
let popupBlocked = false;
(globalThis as Record<string, unknown>).window = { open: () => (popupBlocked ? null : { document: { write() {}, close() {}, images: [] }, focus() {}, print() {} }) };

Bun.plugin({
  name: 'w5-lien-prequal-stubs',
  setup(build) {
    const obj = (exports: Record<string, unknown>): VirtualModule => ({ exports, loader: 'object' });
    build.module('react-native', () => obj({ Platform: { OS: 'web' } }));
    build.module('expo-print', () => obj({}));
    build.module('expo-sharing', () => obj({}));
    build.module('expo-mail-composer', () => obj({}));
    build.module('expo-file-system/legacy', () => obj({}));
    build.module('@/lib/supabase', () => obj({ supabase: fakeSupabase, isSupabaseConfigured: true }));
    build.module('@react-native-async-storage/async-storage', () => obj({
      default: {
        getItem: async (k: string) => storage.get(k) ?? null,
        setItem: async (k: string, v: string) => { storage.set(k, v); },
      },
    }));
  },
});
const engine = await import('../utils/lienWaiverEngine');

console.log('\n#30 a failed read is a failure, and the last good list is kept:');
const ROW = {
  id: 'w1', project_id: 'p1', user_id: 'gc-1', commitment_id: null, invoice_id: null, waiver_type: 'conditional_final',
  sub_company_id: null, sub_name: 'Volt Electric', sub_email: 'v@x.test', through_date: '2026-09-01', paid_amount: 18400.5,
  status: 'signed', sub_signature: { name: 'Jordan Reyes', role: 'sub', signedAt: '2026-09-02T09:00:00Z' },
  signed_at: '2026-09-02T09:00:00Z', signed_pdf_url: null, notes: '', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-02T09:00:00Z',
};
answers = [{ data: [ROW], error: null }];
const good = await engine.loadLienWaiversChecked('p1');
ok('a good read answers ok with the waivers', good.ok === true && good.ok && good.waivers.length === 1 && good.waivers[0].subName === 'Volt Electric');
ok('the cache key is under the mageid_ prefix the tenant sweep removes',
  engine.LIEN_WAIVER_CACHE_PREFIX.startsWith('mageid_') && storage.has('mageid_lien_waivers_p1'));
answers = [{ data: null, error: { message: 'Network request failed' } }];
const bad = await engine.loadLienWaiversChecked('p1');
ok('a failed read answers ok:false with the reason — not an empty list', bad.ok === false && !bad.ok && /Network request failed/.test(bad.error));
const cached = await engine.readLienWaiverCache('p1');
ok('the cached copy survives the failed read, with when it was read',
  !!cached && cached.waivers.length === 1 && cached.waivers[0].id === 'w1' && !Number.isNaN(Date.parse(cached.savedAt)));
storage.set('mageid_lien_waivers_p2', '{not json');
ok('an unreadable cache is "nothing cached", not a crash', (await engine.readLienWaiverCache('p2')) === null);
ok('fetchLienWaiversForProject keeps its signature (four wave-4 screens import it)',
  /export async function fetchLienWaiversForProject\(projectId: string\): Promise<LienWaiver\[\]>/.test(read('utils/lienWaiverEngine.ts')));

console.log('\n#30 a delete that removed nothing is not a delete:');
calls.length = 0;
answers = [{ data: [], error: null }];
ok('0 rows back → false', (await engine.deleteLienWaiver('w1')) === false);
ok('…because the delete reads back what it removed', calls[0]?.ops.some(([op, a]) => op === 'select' && a[0] === 'id') === true);
answers = [{ data: [{ id: 'w1' }], error: null }];
ok('1 row back → true', (await engine.deleteLienWaiver('w1')) === true);

console.log('\n#31 status changes write the status and nothing else:');
calls.length = 0;
answers = [{ data: { ...ROW, status: 'voided' }, error: null }];
const st = await engine.updateLienWaiverStatus('w1', 'voided');
const upd = calls[0]?.ops.find(([op]) => op === 'update')?.[1][0] as Record<string, unknown> | undefined;
ok('the update payload is exactly { status, updated_at }', !!upd && JSON.stringify(Object.keys(upd).sort()) === '["status","updated_at"]', JSON.stringify(upd));
ok('…addressed by id, read back', calls[0]?.ops.some(([op, a]) => op === 'eq' && a[0] === 'id' && a[1] === 'w1') === true
  && calls[0]?.ops.some(([op]) => op === 'select') === true);
ok('…and returns the row as the server now has it', st.ok === true && st.ok && st.waiver?.status === 'voided');
answers = [{ data: null, error: null }];
const gone = await engine.updateLienWaiverStatus('w1', 'received');
ok('no row matched → ok with waiver null (the screen says it is gone)', gone.ok === true && gone.ok && gone.waiver === null);
answers = [{ data: null, error: { message: 'Failed to fetch' } }];
const off = await engine.updateLienWaiverStatus('w1', 'received');
ok('a failed write answers ok:false with the reason', off.ok === false && !off.ok && /Failed to fetch/.test(off.error));

console.log('\n#31 a paper record only lands on an unsigned row:');
calls.length = 0;
answers = [{ data: { ...ROW, status: 'signed', sub_signature: { name: 'P', role: 'gc', signedAt: 'x' } }, error: null }];
const paper = await engine.recordPaperLienWaiver('w1', 'Paper Plumbing');
const pUpd = calls[0]?.ops.find(([op]) => op === 'update')?.[1][0] as Record<string, unknown> | undefined;
ok('the write is an UPDATE, never an upsert of the card', calls[0]?.ops.some(([op]) => op === 'upsert') === false && !!pUpd);
ok('…filtered on signed_at IS NULL on the row itself', calls[0]?.ops.some(([op, a]) => op === 'is' && a[0] === 'signed_at' && a[1] === null) === true);
ok('…recording the GC\'s role, never the sub\'s', (pUpd?.sub_signature as { role?: string } | undefined)?.role === 'gc');
ok('a landed paper record answers ok', paper.ok === true);
calls.length = 0;
answers = [{ data: null, error: null }, { data: ROW, error: null }];
const lost = await engine.recordPaperLienWaiver('w1', 'Paper Plumbing');
ok('no row matched + the row is signed → already_signed with the live row',
  lost.ok === false && !lost.ok && lost.reason === 'already_signed' && lost.waiver?.subSignature?.role === 'sub');
ok('…found by re-reading that one row', calls.length === 2 && calls[1].ops.some(([op, a]) => op === 'eq' && a[1] === 'w1'));

console.log('\n#29 the access gate:');
const g = engine.lienWaiverAccessGate;
const base = { isLoading: false, isError: false };
ok('owner → allow', g({ role: 'owner', ...base }).kind === 'allow');
for (const role of ['editor', 'viewer', 'field'] as const) {
  const r = g({ role, ...base });
  ok(`${role} → blocked with the owner-only reason`, r.kind === 'blocked' && r.message === engine.LIEN_WAIVER_OWNER_ONLY_MESSAGE);
}
ok('a known owner company is named', (() => { const r = g({ role: 'editor', ...base }, 'Hallway Homes LLC'); return r.kind === 'blocked' && r.message.includes('(Hallway Homes LLC)'); })());
ok('still resolving → loading (never the paywall, never a refusal)', g({ role: null, isLoading: true, isError: false }).kind === 'loading');
ok('a failed role read → error (retryable)', g({ role: null, isLoading: false, isError: true }).kind === 'error');
ok('paused offline → the hook\'s own reason', (() => { const r = g({ role: null, ...base, isPaused: true, reason: 'offline reason' }); return r.kind === 'blocked' && r.message === 'offline reason'; })());
ok('settled null (not on the job) → blocked, not allowed', g({ role: null, ...base }).kind === 'blocked');

console.log('\n#147 carry — a blocked pop-up is an error on web (CONTRACT 25):');
popupBlocked = true;
let threw: unknown = null;
answers = [{ data: [ROW], error: null }];
const loadedForPdf = await engine.loadLienWaiversChecked('p1');
const pdfWaiver = loadedForPdf.ok ? loadedForPdf.waivers[0] : null;
const BRANDING = { companyName: 'Hallway Homes LLC', contactName: '', phone: '', email: '', address: '', licenseNumber: '', tagline: '' };
ok('a waiver to print was loaded', !!pdfWaiver);
try {
  if (pdfWaiver) await engine.shareLienWaiverPDF(pdfWaiver, BRANDING, engine.lienWaiverDocContext(undefined));
} catch (e) { threw = e; }
ok('shareLienWaiverPDF throws the blocked-window sentence', threw instanceof Error && /blocked the PDF window/.test((threw as Error).message), String(threw));
popupBlocked = false;
threw = null;
try {
  if (pdfWaiver) await engine.shareLienWaiverPDF(pdfWaiver, BRANDING, engine.lienWaiverDocContext(undefined));
} catch (e) { threw = e; }
ok('an open window does not throw', threw === null, String(threw));

// ─────────────────────────────────────────────────────────────────────
// B. app/lien-waivers.tsx
// ─────────────────────────────────────────────────────────────────────
console.log('\napp/lien-waivers.tsx:');
const lw = live('app/lien-waivers.tsx');
const screenFn = lw.slice(lw.indexOf('export default function LienWaiversScreen'), lw.indexOf('function LienWaiverGateView'));
ok('#29 the role is resolved before the tier check',
  /useProjectRoleState\(/.test(screenFn) && screenFn.indexOf('lienWaiverAccessGate(') > 0
  && screenFn.indexOf('lienWaiverAccessGate(') < screenFn.indexOf("canAccess('lien_waiver_manager')"));
// The gate must run for EVERY job the screen can open — the only condition in
// front of it is "a job was named" (no job = the "lives inside a project"
// empty state, which shows no waivers). A disabled or narrowed condition here
// is the whole #29 hole again, however the regexes below read.
ok('#29 the gate runs whenever a projectId is present, under no other condition',
  /\n  if \(gateProjectId\) \{\n(?:\s*\/\/[^\n]*\n)*\s*const gate = lienWaiverAccessGate\(\{/.test(screenFn)
  && (screenFn.match(/lienWaiverAccessGate\(/g) ?? []).length === 1
  && /useProjectRoleState\(gateProjectId \|\| undefined\)/.test(screenFn)
  && /useLocalSearchParams<\{ projectId\?: string \}>\(\)/.test(screenFn));
ok('#29 every non-allow gate returns before the list mounts',
  /gate\.kind === 'loading'\) return/.test(screenFn) && /gate\.kind === 'blocked'\) return/.test(screenFn) && /gate\.kind === 'error'\)/.test(screenFn));
const gateView = lw.slice(lw.indexOf('function LienWaiverGateView'), lw.indexOf('function LienWaiversScreenInner'));
ok('#29 the gate view offers no write control',
  !/New waiver|Request signature|Record paper|Mark received|Void|Delete|setAddModal/.test(gateView));
ok('#30 the screen reads through loadLienWaiversChecked, never the []-on-error fetch',
  /await loadLienWaiversChecked\(projectId\)/.test(lw) && !/fetchLienWaiversForProject/.test(lw));
ok('#30 a failed read falls back to the cached copy', /readLienWaiverCache\(projectId\)/.test(lw) && /setSeenAt\(cached\.savedAt\)/.test(lw));
ok('#30 "No waivers yet" renders only when the read did NOT fail',
  /\{!loading && !loadError && waivers\.length === 0 && \(/.test(lw)
  && (lw.match(/No waivers yet/g) ?? []).length === 1);
ok('#30 the failed-read states say what the phone last saw / check your signal',
  /Offline — showing what this phone last saw at \$\{seenAtLabel\(seenAt\)\}/.test(lw)
  && /Couldn&apos;t load waivers — check your signal/.test(lw));
{
  const failCard = lw.slice(lw.indexOf('lien-waivers-load-failed'), lw.indexOf('{!loading && !loadError && waivers.length === 0'));
  ok('#30 the failed-read card offers Retry and no New button', /Retry/.test(failCard) && !/setAddModal/.test(failCard));
}
ok('#30 handleStatusChange reports failure and has an in-flight guard',
  /if \(writeInFlight\.current\) return;/.test(lw)
  && /Couldn’t \$\{verb\}/.test(lw) && /Not saved\. Check your signal and try again\./.test(lw));
ok('#30 handleDelete reports a delete that did not happen', /showAlert\('Couldn’t delete'/.test(lw));
ok('#30 handleCreate says when the phone is offline', /createLienWaiverChecked\(/.test(lw) && /isOfflineError\(res\.error\)[\s\S]{0,200}offline/.test(lw));
ok('#31 status changes never upsert the stale card',
  /await updateLienWaiverStatus\(w\.id, status\)/.test(lw) && !/saveLienWaiver\(\{ \.\.\.w, id: w\.id, status \}\)/.test(lw));
ok('#31 the paper record goes through the conditional write', /await recordPaperLienWaiver\(w\.id, name\)/.test(lw)
  && /already e-signed this/.test(lw) && /their electronic signature is on file/.test(lw));
ok('#31 Void opens a destructive confirm, re-reading the row first',
  /onMarkVoid=\{\(\) => \{ void handleVoid\(w\); \}\}/.test(lw)
  && /const handleVoid = useCallback\(async \(w: LienWaiver\) => \{\s*const fresh = await fetchLienWaiverChecked\(w\.id\);/.test(lw)
  && /text: 'Void', style: 'destructive'/.test(lw)
  && /signed release[\s\S]{0,200}will be marked VOID/.test(lw));
ok('#31 the screen re-reads on focus, on foreground and on pull',
  /useFocusEffect\(useCallback\(/.test(lw) && /AppState\.addEventListener\('change'/.test(lw) && /next === 'active'\) void refresh\(\)/.test(lw)
  && /refreshControl=\{<RefreshControl/.test(lw));
ok('#31 stale reads cannot overwrite a newer one', /const seq = \+\+readSeq\.current;/.test(lw) && /if \(seq !== readSeq\.current\) return;/.test(lw));
ok('#30 Request signature says why it is unavailable offline',
  /disabled=\{requesting \|\| offline \|\| busy\}/.test(lw) && /Sending a signing link needs signal/.test(lw));
ok('#147 carry: export failures go through pdfFailureMessage', /pdfFailureMessage\(e, /.test(lw));
ok('validate-handover-waivers\' pin holds: no commit.companyId read', !/commit\.companyId/.test(lw));

// ─────────────────────────────────────────────────────────────────────
// C. app/prequal-manager.tsx — the pure block, executed
// ─────────────────────────────────────────────────────────────────────
console.log('\napp/prequal-manager.tsx (pure block executed):');
const pmRaw = read('app/prequal-manager.tsx');
const start = pmRaw.indexOf('// ── pure: review + renewal');
const end = pmRaw.indexOf('// ── end pure ──');
ok('the pure block is delimited', start > 0 && end > start);
const block = pmRaw.slice(start, end);
ok('the pure block imports nothing and touches no React / Supabase', !/\bimport\b|useState|supabase|React\./.test(block));
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(block);
const mod = new Function(`${js}\nreturn { rowToPrequalPacket, applyPrequalReview, canSendPrequalRenewal, buildPrequalRenewal };`)() as {
  rowToPrequalPacket: (r: Record<string, unknown>) => Record<string, unknown>;
  applyPrequalReview: (p: Record<string, unknown>, patch: Record<string, unknown>) => Record<string, unknown>;
  canSendPrequalRenewal: (s: string, b: string | null) => boolean;
  buildPrequalRenewal: (p: Record<string, unknown>, token: string, email: string, now: string) => Record<string, unknown>;
};
const FRESH = mod.rowToPrequalPacket({
  id: 'pk1', subcontractor_id: 's1', status: 'submitted', criteria: { minCglPerOccurrence: 1000000 },
  financials: { yearsInBusiness: 8 }, safety: { writtenSafetyProgram: true }, insurance: { cglPerOccurrence: 2000000, coiExpiry: '2027-03-01' },
  licenses: [{ id: 'l1' }], w9_on_file: true, w9_doc_path: 'w9.pdf', invite_token: 'tok', invite_email: 'sub@x.test',
  submitted_at: '2026-09-20T10:00:00Z', reviewed_at: null, reviewer_notes: null, expires_at: null,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-20T10:00:00Z',
});
ok('the row mapper reads the sub\'s answers', (FRESH.financials as { yearsInBusiness?: number }).yearsInBusiness === 8 && FRESH.w9OnFile === true && FRESH.submittedAt === '2026-09-20T10:00:00Z');
const reviewed = mod.applyPrequalReview(FRESH, { status: 'needs_changes', reviewerNotes: 'Need CG 20 10', reviewedAt: 'NOW', updatedAt: 'NOW' });
ok('#24 a decision keeps every sub-authored field of the fresh packet',
  JSON.stringify([reviewed.financials, reviewed.safety, reviewed.insurance, reviewed.licenses, reviewed.w9OnFile, reviewed.w9DocPath, reviewed.submittedAt, reviewed.criteria])
  === JSON.stringify([FRESH.financials, FRESH.safety, FRESH.insurance, FRESH.licenses, FRESH.w9OnFile, FRESH.w9DocPath, FRESH.submittedAt, FRESH.criteria]));
ok('#24 …and lays the review fields over it', reviewed.status === 'needs_changes' && reviewed.reviewerNotes === 'Need CG 20 10' && reviewed.reviewedAt === 'NOW');
const onlyStatus = mod.applyPrequalReview({ ...FRESH, reviewerNotes: 'keep me' }, { status: 'approved', updatedAt: 'NOW' });
ok('#24 a field the patch does not name is left as the server has it', onlyStatus.reviewerNotes === 'keep me');
for (const [s, b, want] of [
  ['approved', 'ok', true], ['expired', null, true], ['rejected', null, true], ['needs_changes', null, true],
  ['submitted', '30d', true], ['submitted', 'ok', false], ['submitted', null, false],
  ['invited', 'expired', false], ['draft', null, false], ['in_progress', '7d', false],
] as const) {
  ok(`#32 canSendPrequalRenewal(${s}, ${b}) = ${want}`, mod.canSendPrequalRenewal(s, b) === want);
}
const renewed = mod.buildPrequalRenewal({ ...FRESH, status: 'approved', reviewedAt: 'R', reviewerNotes: 'n', expiresAt: '2026-09-01', autoReviewFindings: [{}] }, 'NEWTOK', 'sub@x.test', 'NOW');
ok('#32 a renewal mints the new token and re-invites', renewed.inviteToken === 'NEWTOK' && renewed.status === 'invited' && renewed.inviteSentAt === 'NOW' && renewed.inviteEmail === 'sub@x.test');
ok('#32 …clears expiresAt (else the new link is refused) and submittedAt (else last year\'s date sticks)',
  renewed.expiresAt === undefined && renewed.submittedAt === undefined);
ok('#32 …clears the old decision', renewed.reviewedAt === undefined && renewed.reviewerNotes === undefined && renewed.autoReviewFindings === undefined);
ok('#32 …and keeps the answers and criteria as the starting point',
  JSON.stringify([renewed.financials, renewed.insurance, renewed.licenses, renewed.criteria]) === JSON.stringify([FRESH.financials, FRESH.insurance, FRESH.licenses, FRESH.criteria]));

console.log('\napp/prequal-manager.tsx (wiring):');
const pm = live('app/prequal-manager.tsx');
for (const h of ['handleApprove', 'handleNeedsChanges', 'handleReject']) {
  const body = pm.slice(pm.indexOf(`const ${h} = useCallback(`), pm.indexOf('}, [', pm.indexOf(`const ${h} = useCallback(`)));
  ok(`#24 ${h} writes applyPrequalReview(fresh, …), never a spread of the stale copy`,
    /applyPrequalReview\(packet, \{/.test(body) && !/\.\.\.packet,/.test(body), body.slice(0, 120));
}
ok('#24 opening the review re-reads that packet by id', /from\('prequal_packets'\)\.select\('\*'\)\.eq\('id', packet\.id\)\.maybeSingle\(\)/.test(pm)
  && /setReviewingPacketState\(rowToPrequalPacket\(data as Record<string, unknown>\)\)/.test(pm));
ok('#24 every decision button waits for the re-read',
  ['onReject(packet', 'onNeedsChanges(packet', 'onApprove(packet'].every(call =>
    new RegExp(`onPress=\\{\\(\\) => ${call.replace('(', '\\(')}[^}]*\\)\\}\\s*disabled=\\{checking\\}`).test(pm))
  && /Checking for the sub\{"\\u2019"\}s latest answers…/.test(pm));
ok('#24 the pipeline advance waits too', /checking \|\| isSideBranch\('prequal', packet\.status\) \|\| packet\.status === 'submitted'/.test(pm));
ok('#24 offline, the cached copy is labelled', /this may be out of date\{cachedReadAt \? ` \(last read \$\{cachedReadAt\}\)` : ''\}/.test(pm));
ok('#32 the review modal offers Send renewal', /canSendPrequalRenewal\(packet\.status/.test(pm) && />Send renewal</.test(pm));
ok('#32 each Renewals-needed row opens the renewal', /onPress=\{\(\) => \{ if \(r\.packet\) setRenewing\(\{ packet: r\.packet, sub: r\.sub \}\); \}\}/.test(pm));
ok('#32 the renewal is confirmed and says what it costs',
  /'Send a renewal\?'/.test(pm) && /The old link stops working/.test(pm) && /leaves "approved" until they resubmit/.test(pm)
  && /upsertPrequalPacket\(buildPrequalRenewal\(packet, token, email, now\)\)/.test(pm));
ok('#32 ?inviteSubId opens the renewal for an approved / lapsed packet', /if \(existing && \(lapsed \|\| existing\.status === 'approved'\)\) setRenewing/.test(pm));
ok('#111 Needs changes / Reject open an email with the note and the sub\'s link',
  /void emailDecision\(updated, 'needs_changes', note\)/.test(pm) && /void emailDecision\(updated, 'rejected', note\)/.test(pm)
  && /prequalInviteUrl\(packet\.inviteToken\)/.test(pm) && /mailto:\$\{to\}\?subject=/.test(pm));
ok('#111 the GC is told what actually went out', /It is not sent until you tap Send there/.test(pm) && /Status saved — no email went out/.test(pm)
  && /Saved — but the sub has not been told/.test(pm));
ok('#111 the note can be resent', />Resend note to the sub</.test(pm) && /onResendNote=\{handleResendNote\}/.test(pm));
ok('the list re-reads on focus and on pull', /useFocusEffect\(useCallback\(/.test(pm) && /invalidateQueries\(\{ queryKey: \['prequalPackets', user\?\.id\] \}\)/.test(pm)
  && /refreshControl=\{<RefreshControl/.test(pm));

// ─────────────────────────────────────────────────────────────────────
// D. app/prequal-form.tsx + app/sub-profile.tsx
// ─────────────────────────────────────────────────────────────────────
console.log('\napp/prequal-form.tsx:');
const pf = live('app/prequal-form.tsx');
ok('#111 the GC\'s decision and note are shown to the sub',
  /\{needsChanges \? 'The GC asked for changes' : 'Not approved'\}/.test(pf) && /<Text style=\{styles\.decisionNote\}>\{packet\.reviewerNotes\}<\/Text>/.test(pf));
ok('#111 a needs-changes packet is resubmitted with a Resubmit button', /needsChanges \? 'Resubmit'/.test(pf));
ok('#111 a rejected packet has no Submit button, and the copy matches the server',
  /\) : rejected \? \(/.test(pf) && /can’t be resubmitted from this link/.test(pf));
ok('#113 no cross-contractor promise remains', !/across every contractor/i.test(read('app/prequal-form.tsx')));
ok('#113 a signed-out sub is offered sign-up, not the login-walled profile',
  /\{isAuthenticated \? \(/.test(pf) && /router\.push\('\/signup'\)/.test(pf) && /Create your free MAGE ID account/.test(pf));
ok('#114 the form keeps sending the criteria it loaded (never null)', /p_criteria: next\.criteria,/.test(pf) && !/p_criteria:\s*null/.test(pf));

console.log('\napp/sub-profile.tsx:');
const sp = live('app/sub-profile.tsx');
ok('#113 the profile says it covers this workspace only', /Built from this workspace only/.test(sp));
ok('#113 an empty profile explains why, instead of zeros', /\{profile\.isEmpty \? \(/.test(sp) && /No work history in this workspace yet/.test(sp));
ok('#113 sub-profile is not made public', !/'sub-profile'/.test(read('app/_layout.tsx').match(/PUBLIC[\s\S]{0,400}/)?.[0] ?? ''));

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-w5-lien-prequal-screens: ${pass} passed, ${fail} failed\n`);
if (fail) process.exit(1);
