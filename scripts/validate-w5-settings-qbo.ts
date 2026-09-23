// validate-w5-settings-qbo.ts — audit wave 5, lane settings, #103.
//
// fetchQboStatus turned EVERY failed status call into { status: 'disconnected' }
// so a connected GC with no signal (or a 5xx) was shown the "Connect
// QuickBooks" pitch and button, and a tap started a second OAuth over a live
// connection. This executes the real fetchQboStatus against a stubbed
// supabase.functions.invoke and pins the qbo-setup / Settings handling of the
// new 'unknown' status.
//
// Run: bun run scripts/validate-w5-settings-qbo.ts

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (spec: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-w5-settings-qbo must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}

// The next invoke result (or a thrown error) the stub hands back.
let next: (() => Promise<{ data: unknown; error: unknown }>) = async () => ({ data: null, error: null });
Bun.plugin({
  name: 'w5-settings-qbo-stubs',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: { supabase: { functions: { invoke: () => next() } }, isSupabaseConfigured: true },
      loader: 'object',
    }));
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
    build.module('expo-web-browser', () => ({ exports: { openAuthSessionAsync: async () => ({ type: 'cancel' }) }, loader: 'object' }));
  },
});

const { fetchQboStatus, qboStatusFailureReason } = await import('../utils/qboSync');

class FakeFunctionsError extends Error {
  context: unknown;
  constructor(message: string, name: string, context?: unknown) { super(message); this.name = name; this.context = context; }
}
const httpErr = (status: number) => new FakeFunctionsError('Edge Function returned a non-2xx status code', 'FunctionsHttpError', { status });

console.log('\n── fetchQboStatus: only a real answer can say "disconnected" ──');
const cases: [string, () => Promise<{ data: unknown; error: unknown }>, string, string | undefined][] = [
  ['no signal (FunctionsFetchError) -> unknown/offline',
    async () => ({ data: null, error: new FakeFunctionsError('Failed to send a request', 'FunctionsFetchError', new TypeError('Network request failed')) }), 'unknown', 'offline'],
  ['403 (requireTier refused the plan) -> unknown/tier', async () => ({ data: null, error: httpErr(403) }), 'unknown', 'tier'],
  ['500 -> unknown/server', async () => ({ data: null, error: httpErr(500) }), 'unknown', 'server'],
  ['relay error -> unknown/server', async () => ({ data: null, error: new FakeFunctionsError('Relay', 'FunctionsRelayError', {}) }), 'unknown', 'server'],
  ['2xx with no body -> unknown/server', async () => ({ data: null, error: null }), 'unknown', 'server'],
  ['success:false -> unknown/server', async () => ({ data: { success: false, status: 'disconnected' }, error: null }), 'unknown', 'server'],
  ['unrecognised status -> unknown/server', async () => ({ data: { success: true, status: 'weird' }, error: null }), 'unknown', 'server'],
  ['invoke throws a TypeError -> unknown/offline', async () => { throw new TypeError('Failed to fetch'); }, 'unknown', 'offline'],
  ['a successful "disconnected" answer -> disconnected', async () => ({ data: { success: true, status: 'disconnected' }, error: null }), 'disconnected', undefined],
  ['a successful "connected" answer -> connected', async () => ({ data: { success: true, status: 'connected', companyName: 'Acme' }, error: null }), 'connected', undefined],
  ['a successful "reauth_required" answer -> reauth_required', async () => ({ data: { success: true, status: 'reauth_required' }, error: null }), 'reauth_required', undefined],
];
for (const [name, fn, status, reason] of cases) {
  next = fn;
  const r = await fetchQboStatus();
  ok(name, r.status === status && r.reason === reason, JSON.stringify(r));
}
ok('qboStatusFailureReason: 403 context is tier', qboStatusFailureReason(httpErr(403)) === 'tier');

console.log('\n── app/qbo-setup.tsx ──');
const screen = read('app/qbo-setup.tsx');
const unknownAt = screen.indexOf("status?.status === 'unknown' ? (");
const heroAt = screen.indexOf("(!status || status.status === 'disconnected') ? (");
ok('an "unknown" branch renders BEFORE the disconnected Connect hero', unknownAt > -1 && heroAt > unknownAt, `${unknownAt} / ${heroAt}`);
const unknownBranch = unknownAt > -1 ? screen.slice(unknownAt, heroAt) : '';
ok('…it says it could not check, offers Retry (onRefreshStatus), and has no Connect button',
  /Couldn&apos;t check your QuickBooks connection/.test(unknownBranch)
  && /onPress=\{onRefreshStatus\}/.test(unknownBranch)
  && !/onConnect|testID="qbo-connect"|Connect QuickBooks/.test(unknownBranch), unknownBranch.slice(0, 400));
ok('a failed re-check keeps the last good status within the visit',
  /if \(s\.status === 'unknown'\) \{\s*setCheckFailed\(s\);\s*setStatus\(\(prev\) => \(prev && prev\.status !== 'unknown' \? prev : s\)\);/.test(screen));
ok('the celebration effect leaves prevStatusRef alone on unknown',
  /const cur = status\?\.status \?\? null;[\s\S]{0,300}if \(cur === 'unknown'\) return;\s*if \(cur === 'connected' && prevStatusRef\.current/.test(screen));
ok("onConnect's poll skips unknown", /const s = await fetchQboStatus\(\);[\s\S]{0,120}if \(s\.status === 'unknown'\) continue;/.test(screen));
ok('refresh routes every answer through applyStatus', /applyStatus\(await fetchQboStatus\(\)\)/.test(screen) && !/setStatus\(await fetchQboStatus\(\)\)/.test(screen));

console.log('\n── Settings row ──');
const settings = read('app/(tabs)/settings/index.tsx');
ok('Settings shows "Status unavailable" for an unknown check', /qboUnknown \? \([\s\S]{0,300}Status unavailable/.test(settings));
ok('…and never "Connect QuickBooks" for it', /\{qboConnected \|\| qboUnknown \? 'QuickBooks Online'/.test(settings));
ok('a plan refusal below Business still reads "Requires Business"',
  /const qboUnknown = qboStatus\?\.status === 'unknown'\s*&& !\(qboStatus\.reason === 'tier' && tier !== 'business' && tier !== 'enterprise'\);/.test(settings));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
