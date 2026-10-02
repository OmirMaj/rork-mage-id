// validate-sample-send-fence.ts — SAMPLEGUARD: the SERVER refuses to deliver a
// contract or a closeout binder from a sample job.
//
// "Nothing on a sample job reaches anyone but the user" (utils/sampleGuard)
// held only in the client for these two deliveries. A stale build, a replayed
// deep link or a hand-made request now gets 409 sample_project from the server,
// the same answer create-payment-link gives.
//
//   F1  _shared/sampleFence sampleSendRefusal — EXECUTED: a sample may send
//       only to the caller's own verified address (trimmed, lowercased); no
//       caller address refuses; a hyphen look-alike and a real job pass.
//   F2  send-email — the projectId branch sits after requireTier( and before
//       the rate buckets spend and before any Resend call; owner check before
//       the sample check; the sample check reads the GoTrue address only.
//   F3  notify — the sample return sits after the EDGE-F4 block and before the
//       first email, push or outbox call; the rule and the event list are
//       imported from the shared fence, never restated.
//   F4  utils/emailService — outcome 'refused' returns before the composer:
//       (a) static order; (b) sendEmail EXECUTED against a stubbed
//       supabase.functions.invoke answering 409 sample_project, on native and
//       on web: no MailComposer, no mailto anchor, no openURL. A positive
//       control (a 500) proves the stubs do see a composer.
//   F5  app/contract.tsx — emailContractLink's sendEmail call carries projectId.
//
// MUTATION PROOF: set SAMPLE_SEND_FENCE_MUT_DIR to a directory that mirrors
// repo-relative paths; any file present there is read (and executed) instead
// of the repo's. Planted: the comparison without lowercase; the notify block
// moved after the email send; the composer reached on 'refused'. Each fails.
//
// Run: bun run scripts/validate-sample-send-fence.ts

import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// @types/bun is not installed; only the sliver used here is declared.
type BunLoadResult = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => BunLoadResult) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MUT = process.env.SAMPLE_SEND_FENCE_MUT_DIR;
const srcPath = (rel: string) => (MUT && existsSync(join(MUT, rel)) ? join(MUT, rel) : join(ROOT, rel));
const read = (rel: string) => readFileSync(srcPath(rel), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.error(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
if (MUT) console.log(`(mutation dir: ${MUT})`);

const PREFIX = 'Sample \u2014 ';

// ════════════════════════════════════════════════════════════════════════════
console.log('\nF1. sampleSendRefusal (executed)');
{
  type Refusal = (a: { projectName: string | null | undefined; recipients: string[]; callerEmail: string | null }) => 'sample_project' | null;
  let refuse: Refusal | null = null;
  let events: readonly string[] = [];
  try {
    const mod = await import(srcPath('supabase/functions/_shared/sampleFence.ts')) as { sampleSendRefusal?: Refusal; SAMPLE_REFUSED_NOTIFY_EVENTS?: readonly string[] };
    refuse = typeof mod.sampleSendRefusal === 'function' ? mod.sampleSendRefusal : null;
    events = mod.SAMPLE_REFUSED_NOTIFY_EVENTS ?? [];
  } catch (e) { ok('the shared fence imports', false, String(e)); }
  ok('sampleSendRefusal is exported', !!refuse);
  ok("SAMPLE_REFUSED_NOTIFY_EVENTS is ['closeout_binder_sent']", events.length === 1 && events[0] === 'closeout_binder_sent', JSON.stringify(events));
  if (refuse) {
    const r = refuse;
    const sample = `${PREFIX}Sarah's Place`;
    const self = 'gc@example.com';
    ok('sample + self → null', r({ projectName: sample, recipients: [self], callerEmail: self }) === null);
    ok('sample + self in another case / with whitespace → null',
      r({ projectName: sample, recipients: ['  GC@Example.COM '], callerEmail: ' gc@EXAMPLE.com' }) === null);
    ok("sample + [self, client] → 'sample_project'", r({ projectName: sample, recipients: [self, 'client@example.com'], callerEmail: self }) === 'sample_project');
    ok("sample + client → 'sample_project'", r({ projectName: sample, recipients: ['client@example.com'], callerEmail: self }) === 'sample_project');
    ok("sample + no callerEmail → 'sample_project'", r({ projectName: sample, recipients: [self], callerEmail: null }) === 'sample_project');
    ok("sample + empty callerEmail → 'sample_project'", r({ projectName: sample, recipients: [''], callerEmail: '  ' }) === 'sample_project');
    ok("sample + no recipients → 'sample_project'", r({ projectName: sample, recipients: [], callerEmail: self }) === 'sample_project');
    ok("'Sample - x' (hyphen, not em dash) + client → null", r({ projectName: 'Sample - x', recipients: ['client@example.com'], callerEmail: self }) === null);
    ok('real job + client → null', r({ projectName: 'Henderson Kitchen', recipients: ['client@example.com'], callerEmail: self }) === null);
    ok('no project name + client → null', r({ projectName: null, recipients: ['client@example.com'], callerEmail: null }) === null);
  }
  // The fenced block validate-sample-guard pins keeps its markers; the new
  // exports live below it.
  const shared = read('supabase/functions/_shared/sampleFence.ts');
  const endFence = shared.indexOf('// <<< sample-project-fence');
  ok('the new exports sit below the fenced block',
    endFence > 0 && shared.indexOf('export function sampleSendRefusal') > endFence && shared.indexOf('export const SAMPLE_REFUSED_NOTIFY_EVENTS') > endFence);
  ok('sampleSendRefusal uses the fenced rule (no second prefix)',
    (shared.match(/"Sample — "/g) ?? []).length === 1);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nF2. send-email: owner + sample check before buckets and Resend');
{
  const raw = strip(read('supabase/functions/send-email/index.ts'));
  const h = raw.indexOf('serve(async');
  const s = h >= 0 ? raw.slice(h) : '';
  const tierAt = s.indexOf('await requireTier(');
  const branchAt = s.indexOf('if (typeof body.projectId === "string")');
  const bucketAt = s.indexOf('rateLimitCount(');
  const resendAt = s.indexOf('resendSend(');
  const attachAt = s.indexOf('sendWithAttachments(');
  const ownerAt = s.indexOf('projectRow.user_id !== callerSub');
  const refuseAt = s.indexOf('sampleSendRefusal(');
  ok('imports sampleSendRefusal from the shared fence', /import \{ sampleSendRefusal \} from "\.\.\/_shared\/sampleFence\.ts";/.test(raw));
  ok('SendEmailBody carries projectId?: string', /interface SendEmailBody \{[\s\S]*?projectId\?: string;[\s\S]*?\n\}/.test(raw));
  ok('a present, non-UUID projectId is a 400', /body\.projectId !== undefined[\s\S]{0,200}?UUID_RE\.test\(body\.projectId\)\)\)\s*\{\s*return jsonResponse\(\{[^}]*\}, 400\)/.test(s));
  ok('the projectId branch comes after requireTier(', tierAt > 0 && branchAt > tierAt, `tier ${tierAt} branch ${branchAt}`);
  ok('…and before the rate buckets spend', bucketAt > branchAt, `branch ${branchAt} bucket ${bucketAt}`);
  ok('…and before any Resend call', resendAt > branchAt && attachAt > branchAt, `resend ${resendAt} attach ${attachAt}`);
  const branch = branchAt >= 0 ? s.slice(branchAt, bucketAt > branchAt ? bucketAt : undefined) : '';
  ok('reads only user_id,name, by id, with the service role',
    /rest\/v1\/projects\?id=eq\.\$\{encodeURIComponent\(body\.projectId\)\}&select=user_id,name/.test(branch) && /Bearer \$\{SUPABASE_SERVICE_ROLE_KEY\}/.test(branch));
  ok('no row → 404', /if \(!projectRow\) \{\s*return jsonResponse\(\{[^}]*\}, 404\)/.test(branch));
  ok("not the owner → 403 not_your_project", /projectRow\.user_id !== callerSub\) \{\s*return jsonResponse\(\{ success: false, error: "not_your_project" \}, 403\)/.test(branch));
  ok('the owner check comes before the sample check', ownerAt > branchAt && refuseAt > ownerAt, `owner ${ownerAt} sample ${refuseAt}`);
  ok('the sample check reads the GoTrue-verified address, not the profile fallback',
    /sampleSendRefusal\(\{ projectName: projectRow\.name, recipients, callerEmail: auth\.email \?\? null \}\)/.test(branch));
  ok('a refusal is 409 { success:false, error: refusal }', /if \(refusal\) \{\s*return jsonResponse\(\{ success: false, error: refusal \}, 409\)/.test(branch));
  ok('recipients are parsed before the branch reads them', s.indexOf('const recipients =') > 0 && s.indexOf('const recipients =') < branchAt);
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nF3. notify: closeout_binder_sent on a sample → 409, nothing sent');
{
  const raw = strip(read('supabase/functions/notify/index.ts'));
  ok('imports the rule and the event list from the shared fence',
    /import \{ isSampleProjectName, SAMPLE_REFUSED_NOTIFY_EVENTS \} from "\.\.\/_shared\/sampleFence\.ts";/.test(raw));
  ok('the prefix is not restated', !/Sample — |Sample \\u2014|SAMPLE_PROJECT_PREFIX/.test(raw));
  const d = raw.indexOf('async function dispatch(');
  const s = d >= 0 ? raw.slice(d) : '';
  const f4At = s.indexOf('userMayAddress(');
  const userRateAt = s.indexOf('`notify:user:${caller.id}`');
  const sampleAt = s.indexOf("reason: 'sample_project'");
  ok('the sample return is guarded by the imported list and the project name read server-side',
    /if \(\(SAMPLE_REFUSED_NOTIFY_EVENTS as readonly string\[\]\)\.includes\(event\) && isSampleProjectName\(projectCtx\.name\)\) \{\s*return \{ ok: false, reason: 'sample_project', event, httpStatus: 409 \};/.test(s));
  ok('the sample return comes after the EDGE-F4 block', f4At > 0 && userRateAt > f4At && sampleAt > userRateAt, `f4 ${f4At} rate ${userRateAt} sample ${sampleAt}`);
  const firstSend = Math.min(...['sbInsert(', 'sendIfNotSuppressed(', 'resendSend(', 'sendPush(', 'dispatchOne(', 'getProfile(gcUserId)']
    .map(m => { const i = s.indexOf(m); return i < 0 ? Infinity : i; }));
  ok('…and before the first email, push or outbox call', sampleAt > 0 && sampleAt < firstSend, `sample ${sampleAt} first send ${firstSend}`);
  ok("…and before the closeout_binder_sent case", sampleAt < s.indexOf("case 'closeout_binder_sent':"));
  ok('dispatch maps httpStatus >= 400 to the response', /if \(httpStatus && httpStatus >= 400\) return jsonResponse\(\{ success: false, \.\.\.rest \}, httpStatus\);/.test(raw));
}

// ════════════════════════════════════════════════════════════════════════════
console.log("\nF4. emailService: 'refused' never reaches the composer");
const EMAIL_REL = 'utils/emailService.ts';
const emailSrc = read(EMAIL_REL);
{
  const s = strip(emailSrc);
  ok("SendEmailOutcome names 'refused'", /export type SendEmailOutcome[\s\S]*?\| 'refused';/.test(s));
  ok('SendEmailParams carries projectId?: string', /export interface SendEmailParams \{[\s\S]*?projectId\?: string;[\s\S]*?\n\}/.test(s));
  ok('the invoke body carries projectId', /functions\.invoke\('send-email', \{\s*body: \{[\s\S]*?projectId: params\.projectId,[\s\S]*?\},\s*\}\)/.test(s));
  ok('a 409 sample_project maps to outcome refused with SAMPLE_DOC_NOT_SENT',
    /edgeErrorStatus\(error\) === 409[\s\S]{0,300}?'sample_project'[\s\S]{0,200}?outcome: 'refused', error: SAMPLE_DOC_NOT_SENT/.test(s));
  const se = s.slice(s.indexOf('export async function sendEmail('));
  const refusedAt = se.indexOf("if (resendResult.outcome === 'refused') return resendResult;");
  const composerAt = Math.min(...['openMailtoWeb(', 'MailComposer.'].map(m => { const i = se.indexOf(m); return i < 0 ? Infinity : i; }));
  ok("(a) sendEmail returns on 'refused' before the composer path", refusedAt > 0 && refusedAt < composerAt, `refused ${refusedAt} composer ${composerAt}`);
}
{
  // (b) EXECUTE sendEmail with every RN / expo edge stubbed.
  type InvokeAnswer = { data: unknown; error: unknown };
  const st = {
    os: 'ios' as 'ios' | 'web',
    answer: { data: { success: true, id: 'm1' }, error: null } as InvokeAnswer,
    invokes: [] as { name: string; body: Record<string, unknown> }[],
    composer: [] as string[],
  };
  Bun.plugin({
    name: 'sample-send-fence-stubs',
    setup(build) {
      build.module('react-native', () => ({
        exports: {
          Platform: { get OS() { return st.os; }, select: (o: Record<string, unknown>) => o[st.os] ?? o.default },
          Linking: { openURL: async (u: string) => { st.composer.push(`openURL:${u}`); } },
        },
        loader: 'object',
      }));
      build.module('expo-mail-composer', () => ({
        exports: {
          isAvailableAsync: async () => { st.composer.push('isAvailableAsync'); return true; },
          composeAsync: async () => { st.composer.push('composeAsync'); return { status: 'sent' }; },
          MailComposerStatus: { CANCELLED: 'cancelled', SAVED: 'saved', SENT: 'sent', UNDETERMINED: 'undetermined' },
        },
        loader: 'object',
      }));
      build.module('expo-file-system/legacy', () => ({
        exports: { cacheDirectory: 'file:///cache/', EncodingType: { Base64: 'base64' }, readAsStringAsync: async () => '', downloadAsync: async () => ({ status: 200, uri: '' }) },
        loader: 'object',
      }));
      build.module('@/lib/supabase', () => ({
        exports: {
          isSupabaseConfigured: true,
          supabase: { functions: { invoke: async (name: string, opts: { body: Record<string, unknown> }) => { st.invokes.push({ name, body: opts.body }); return st.answer; } } },
        },
        loader: 'object',
      }));
    },
  });
  // A web composer is a mailto anchor click; record it.
  const g = globalThis as Record<string, unknown>;
  g.window = g.window ?? {};
  g.document = {
    body: { appendChild: () => {}, removeChild: () => {} },
    createElement: () => { st.composer.push('createElement'); return { click: () => st.composer.push('anchor.click'), remove: () => {}, style: {} }; },
  };
  (g.window as Record<string, unknown>).location = (g.window as Record<string, unknown>).location ?? { href: '' };

  // Load the (possibly mutated) source from a temp file: '@/utils/*' imports
  // are pinned to the repo so it resolves outside the project tree.
  const dir = mkdtempSync(join(tmpdir(), 'sample-send-fence-'));
  const file = join(dir, 'emailService.ts');
  writeFileSync(file, emailSrc.replace(/from '@\/utils\//g, `from '${ROOT}/utils/`));
  type Send = (p: Record<string, unknown>) => Promise<{ success: boolean; outcome: string; error?: string }>;
  let sendEmail: Send | null = null;
  let docNotSent = '';
  try {
    sendEmail = (await import(file) as { sendEmail: Send }).sendEmail;
    docNotSent = (await import(join(ROOT, 'utils/sampleGuard.ts')) as { SAMPLE_DOC_NOT_SENT: string }).SAMPLE_DOC_NOT_SENT;
  } catch (e) { ok('emailService loads under stubs', false, String(e)); }
  finally { rmSync(dir, { recursive: true, force: true }); }

  const httpError = (status: number, body: unknown) => ({
    data: null,
    error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: { status, json: async () => body } },
  });
  if (sendEmail) {
    const raw = sendEmail;
    // The service logs every failure; keep the validator's output to the checks.
    const send: Send = async (p) => {
      const saved = [console.log, console.warn, console.error] as const;
      console.log = console.warn = console.error = () => {};
      try { return await raw(p); } finally { [console.log, console.warn, console.error] = saved; }
    };
    const params = { to: 'client@example.com', subject: 'Contract', html: '<p>hi</p>', projectId: '11111111-2222-4333-8444-555555555555' };
    for (const os of ['ios', 'web'] as const) {
      st.os = os; st.invokes = []; st.composer = [];
      st.answer = httpError(409, { success: false, error: 'sample_project' });
      const r = await send(params);
      ok(`(b) ${os}: 409 sample_project → outcome 'refused', success false, SAMPLE_DOC_NOT_SENT`,
        r.outcome === 'refused' && r.success === false && r.error === docNotSent && docNotSent.length > 0, JSON.stringify(r));
      ok(`(b) ${os}: no composer, no mailto, no openURL`, st.composer.length === 0, st.composer.join(','));
      ok(`(b) ${os}: the invoke body carried projectId`, st.invokes.length === 1 && st.invokes[0].name === 'send-email' && st.invokes[0].body.projectId === params.projectId);
    }
    // Positive controls: the stubs DO see a composer on a real failure, and a
    // 409 with some other reason is not mistaken for a refusal.
    st.os = 'ios'; st.composer = [];
    st.answer = httpError(500, { success: false, error: 'boom' });
    const r500 = await send(params);
    ok('control: a 500 still falls back to the composer (the stubs see it)', r500.outcome !== 'refused' && st.composer.includes('composeAsync'), `${r500.outcome} ${st.composer.join(',')}`);
    st.os = 'web'; st.composer = [];
    st.answer = httpError(409, { success: false, error: 'something_else' });
    const r409 = await send(params);
    ok('control: a 409 with another reason is not a refusal', r409.outcome !== 'refused' && st.composer.length > 0, `${r409.outcome} ${st.composer.join(',')}`);
    st.os = 'ios'; st.composer = [];
    st.answer = { data: { success: true, id: 'm1' }, error: null };
    const rOk = await send(params);
    ok('control: a 200 send is outcome sent, no composer', rOk.success && rOk.outcome === 'sent' && st.composer.length === 0);
  }
}

// ════════════════════════════════════════════════════════════════════════════
console.log('\nF5. contract.tsx: emailContractLink passes projectId');
{
  const s = strip(read('app/contract.tsx'));
  const at = s.indexOf('const emailContractLink = useCallback(');
  const end = at >= 0 ? s.indexOf('}, [settings', at) : -1;
  const body = at >= 0 && end > at ? s.slice(at, end) : '';
  ok('emailContractLink found', body.length > 0);
  ok("its sendEmail call carries projectId: project.id", /sendEmail\(\{[^}]*\bprojectId: project\.id,?[^}]*\}\)/.test(body));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
