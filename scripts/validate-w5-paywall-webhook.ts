// scripts/validate-w5-paywall-webhook.ts — what the RevenueCat webhook may
// write. Audit wave 5: #2 (blocker) and #43.
//
// #2. A plan the founder turns on by hand has no RevenueCat purchase behind
// it. The webhook wrote RevenueCat's tier over the row on ANY later event for
// that user — 'free' — so a hand grant lasted until the first sandbox
// purchase, alias or transfer. Now nothing is written below
// subscriptions.manual_tier (migration 20260923010000; its trigger floors it
// too — see the PGlite test).
//
// #43. When the RevenueCat REST read failed (key unset, API error), the
// handler fell back to tierFromEvent, which returned 'free' for CANCELLATION
// and SUBSCRIPTION_PAUSED while its own comment said "we simply make no
// change" — so turning off auto-renew cut a paying customer off mid-month.
// And TRANSFER (a purchase restored onto another account) carries no
// app_user_id, so it was acked as "ignored": the new account stayed Free on
// the server, the old one kept the plan forever.
//
// resolveWrite is EXTRACTED from the shipped Deno function between its
// sentinels and executed, so this cannot pass against a copy.
//
// Run: bun run scripts/validate-w5-paywall-webhook.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync: (c: string) => string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FN = 'supabase/functions/revenuecat-webhook/index.ts';
const src = readFileSync(join(ROOT, FN), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}

const BEGIN = '// --- BEGIN resolveWrite';
const END = '// --- END resolveWrite ---';
const from = src.indexOf(BEGIN), to = src.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the resolveWrite sentinels in ${FN}. Restore them — the write rules would go unpinned.`);
  process.exit(1);
}
const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(src.slice(from, to).replace(/^export /gm, ''));
type Tier = 'free' | 'pro' | 'business' | 'enterprise';
type Row = { tier: Tier | null; manual_tier: Tier | null } | null;
type Decision = { writes: { uid: string; tier: Tier }[] } | { retry: true; reason: string } | { ignore: string };
const resolveWrite = new Function(`${js}\nreturn resolveWrite;`)() as (
  ev: Record<string, unknown>, a: Record<string, Tier | null>, e: Record<string, Row>,
) => Decision;

const U = '9f2c1d3e-0000-4000-8000-000000000001';
const V = '9f2c1d3e-0000-4000-8000-000000000002';
const manual = (t: Tier): Row => ({ tier: t, manual_tier: t });
const plain = (t: Tier): Row => ({ tier: t, manual_tier: null });
const isRetry = (d: Decision) => 'retry' in d;

console.log('\n#43 — no RevenueCat read: decide only what the event alone can decide:');
ok('CANCELLATION + no read → retry (never free mid-period)', isRetry(resolveWrite({ type: 'CANCELLATION', app_user_id: U }, { [U]: null }, { [U]: plain('pro') })));
ok('SUBSCRIPTION_PAUSED + no read → retry', isRetry(resolveWrite({ type: 'SUBSCRIPTION_PAUSED', app_user_id: U }, { [U]: null }, { [U]: plain('pro') })));
eq('EXPIRATION + no read → free (access has actually ended)', resolveWrite({ type: 'EXPIRATION', app_user_id: U }, { [U]: null }, { [U]: plain('pro') }), { writes: [{ uid: U, tier: 'free' }] });
eq('EXPIRATION + no read on a hand grant → floored at the grant', resolveWrite({ type: 'EXPIRATION', app_user_id: U }, { [U]: null }, { [U]: manual('business') }), { writes: [{ uid: U, tier: 'business' }] });
eq('INITIAL_PURCHASE + no read → its entitlement_ids may raise', resolveWrite({ type: 'INITIAL_PURCHASE', app_user_id: U, entitlement_ids: ['pro'] }, { [U]: null }, { [U]: null }), { writes: [{ uid: U, tier: 'pro' }] });
ok('RENEWAL + no read + no entitlement_ids → retry, not a downgrade', isRetry(resolveWrite({ type: 'RENEWAL', app_user_id: U, entitlement_ids: [] }, { [U]: null }, { [U]: plain('pro') })));
ok('an unknown event type + no read → retry', isRetry(resolveWrite({ type: 'BILLING_ISSUE', app_user_id: U }, { [U]: null }, {})));

console.log('\n#43 — with a RevenueCat read, its answer decides:');
eq('CANCELLATION + read pro (still in the paid period) → pro', resolveWrite({ type: 'CANCELLATION', app_user_id: U }, { [U]: 'pro' }, { [U]: plain('pro') }), { writes: [{ uid: U, tier: 'pro' }] });
eq('EXPIRATION + read free → free', resolveWrite({ type: 'EXPIRATION', app_user_id: U }, { [U]: 'free' }, { [U]: plain('pro') }), { writes: [{ uid: U, tier: 'free' }] });

console.log('\n#2 — never below a hand grant:');
eq('manual business + RevenueCat free → business', resolveWrite({ type: 'INITIAL_PURCHASE', app_user_id: U }, { [U]: 'free' }, { [U]: manual('business') }), { writes: [{ uid: U, tier: 'business' }] });
eq('manual pro + RevenueCat enterprise → enterprise (a store upgrade still raises)', resolveWrite({ type: 'PRODUCT_CHANGE', app_user_id: U }, { [U]: 'enterprise' }, { [U]: manual('pro') }), { writes: [{ uid: U, tier: 'enterprise' }] });

console.log('\n#43 — TRANSFER moves the tier:');
eq('TRANSFER → a write for BOTH sides, each re-read',
  resolveWrite({ type: 'TRANSFER', transferred_from: [U], transferred_to: [V] }, { [U]: 'free', [V]: 'pro' }, { [U]: plain('pro'), [V]: null }),
  { writes: [{ uid: U, tier: 'free' }, { uid: V, tier: 'pro' }] });
ok('TRANSFER with any failed read → retry, never a guess',
  isRetry(resolveWrite({ type: 'TRANSFER', transferred_from: [U], transferred_to: [V] }, { [U]: 'free', [V]: null }, {})));
eq('TRANSFER away from a hand grant keeps the grant', resolveWrite({ type: 'TRANSFER', transferred_from: [U], transferred_to: [V] }, { [U]: 'free', [V]: 'pro' }, { [U]: manual('business'), [V]: null }),
  { writes: [{ uid: U, tier: 'business' }, { uid: V, tier: 'pro' }] });
ok('TRANSFER is handled before the app_user_id guard (it has none)',
  !('ignore' in resolveWrite({ type: 'TRANSFER', transferred_from: [U], transferred_to: [V] }, { [U]: 'free', [V]: 'pro' }, {})));

console.log('\nignored events:');
eq('TEST → ignored', resolveWrite({ type: 'TEST' }, {}, {}), { ignore: 'test' });
eq('no app_user_id (non-transfer) → ignored', resolveWrite({ type: 'RENEWAL' }, {}, {}), { ignore: 'no app_user_id' });

// One rule for sandbox (TestFlight) purchases on BOTH sides. Every iPhone user
// today is on TestFlight, where every purchase is a sandbox purchase. The phone
// counts a sandbox entitlement (tierFromCustomerInfo reads entitlements.active)
// and resolveTier takes the higher of the phone and the server — so a webhook
// that ignored sandbox events put a TestFlight buyer on Pro on the phone and
// Free on the server (edge functions answer tier_required, the second project
// passes the phone's cap and is refused by enforce_free_tier_project_cap), and
// froze any row a sandbox purchase had already raised. Whichever way the
// founder decides "does a TestFlight purchase grant a real tier?", the two
// sides must say the same thing.
console.log('\nsandbox — the webhook and the phone use one rule:');
const sandboxBuy = resolveWrite({ type: 'INITIAL_PURCHASE', app_user_id: U, environment: 'SANDBOX' }, { [U]: 'business' }, {});
const sandboxEnd = resolveWrite({ type: 'EXPIRATION', app_user_id: U, environment: 'SANDBOX' }, { [U]: 'free' }, { [U]: plain('business') });
const webhookIgnoresSandbox = 'ignore' in sandboxBuy;
const ctxSrc = readFileSync(join(ROOT, 'contexts/SubscriptionContext.tsx'), 'utf8');
const tfci = ctxSrc.slice(ctxSrc.indexOf('function tierFromCustomerInfo('), ctxSrc.indexOf('function tierFromCustomerInfo(') + 800);
ok('tierFromCustomerInfo found in SubscriptionContext', tfci.includes('entitlements.active'));
const clientIgnoresSandbox = /isSandbox/.test(tfci);
ok('webhook ignores sandbox ⇔ the phone ignores sandbox', webhookIgnoresSandbox === clientIgnoresSandbox,
  `webhook ${webhookIgnoresSandbox ? 'ignores' : 'counts'} sandbox, the phone ${clientIgnoresSandbox ? 'ignores' : 'counts'} it — the phone and the server would disagree about a TestFlight buyer`);
eq('SANDBOX purchase → written like the phone counts it', sandboxBuy, { writes: [{ uid: U, tier: 'business' }] });
eq('SANDBOX expiration → brought back down (a sandbox-raised row is never frozen)', sandboxEnd, { writes: [{ uid: U, tier: 'free' }] });
ok('no REVENUECAT_ALLOW_SANDBOX switch that would split the sides on one project', !/ALLOW_SANDBOX/.test(src));

console.log('\nwiring (shape of the shipped handler):');
const body = src.slice(src.indexOf('Deno.serve('));
ok('the handler decides through resolveWrite', /const decision = resolveWrite\(ev, authoritative, existing\)/.test(body));
ok('a retry decision answers 500', /if \("retry" in decision\) \{[\s\S]{0,300}status: 500/.test(body));
ok('the old event fallback (authoritative ?? tierFromEvent) is gone', !/tierFromEvent\(/.test(src));
ok('the existing row (manual_tier) is read before deciding', /from\("subscriptions"\)\.select\("\*"\)/.test(body));
ok('the anonymous-id path floors each row at its own manual_tier', /floorAtManual\(tier, r\.manual_tier\)/.test(body));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
