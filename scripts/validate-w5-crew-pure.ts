// scripts/validate-w5-crew-pure.ts — the crew lane's pure decisions after
// audit wave 5 (2026-09-23):
//   #165 an ID's own expiry turns "ID Verified" into "ID expired <date>"
//        (local calendar day; an unreadable expiry stays verified, raw text);
//   #166 the marketplace mapper uses the badge, not the raw flag;
//   #167 a cert expiry that is present but unreadable reads "Check date";
//   #73  the claim link's auth error is read from the fragment or the query,
//        and claim-crew's refusal is told apart from a dropped signal;
//   #72  sendClaimInvite asks for the crew_claim email with the member id;
//   #124 (carried) a scan refusal keeps the server's sentence and its code.
//
// utils/crewScan imports lib/supabase (react-native, AsyncStorage) at module
// scope, which bun cannot load, so it is replaced BEFORE the import with a
// stand-in whose functions.invoke is scripted per case.
//
// Run via: bun run scripts/validate-w5-crew-pure.ts

// `bun:test` has no type declarations in this repo's tsc program, so it is
// reached through a variable specifier; bun resolves it at runtime.
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};

type InvokeResult = { data: unknown; error: unknown };
let nextInvoke: (name: string, opts: { body: Record<string, unknown> }) => InvokeResult = () => ({ data: null, error: null });
const calls: { name: string; body: Record<string, unknown> }[] = [];
const fakeSupabase = {
  functions: {
    invoke: async (name: string, opts: { body: Record<string, unknown> }) => {
      calls.push({ name, body: opts.body });
      return nextInvoke(name, opts);
    },
  },
};
mock.module('@/lib/supabase', () => ({ supabase: fakeSupabase, isSupabaseConfigured: true }));

const {
  verifiedBadge, isIdExpired, idExpiredLabel, crewCertRowStatus,
} = await import('../utils/crew/verifiedBadge');
const { certExpiryStatus } = await import('../utils/crew/certExpiry');
const { crewMemberToWorkerProfile } = await import('../utils/crew/surfacing');
const crewScan = await import('../utils/crewScan');
const { edgeErrorCode } = await import('../utils/edgeError');
import type { CrewMember } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}

/** A FunctionsHttpError as supabase-js builds it: a generic message and the
 *  Response on .context. */
function httpError(status: number, body: unknown) {
  return {
    message: 'Edge Function returned a non-2xx status code',
    context: new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  };
}

console.log('\n#165 verifiedBadge reads the ID\'s own expiry');
{
  const v = { idVerified: true, idMaskedLast4: '4567' };
  ok('no expiry → id_verified', verifiedBadge(v, '2026-09-23') === 'id_verified');
  ok('expiry before today → id_expired', verifiedBadge({ ...v, idExpiry: '2026-09-22' }, '2026-09-23') === 'id_expired');
  ok('last valid day is NOT expired', verifiedBadge({ ...v, idExpiry: '2026-09-23' }, '2026-09-23') === 'id_verified');
  ok('future expiry → id_verified', verifiedBadge({ ...v, idExpiry: '2030-01-01' }, '2026-09-23') === 'id_verified');
  ok('unparseable expiry stays id_verified (raw text shown)', verifiedBadge({ ...v, idExpiry: '12/2020' }, '2026-09-23') === 'id_verified');
  ok('an ISO instant expiry reads by its day part', verifiedBadge({ ...v, idExpiry: '2020-01-01T00:00:00Z' }, '2026-09-23') === 'id_expired');
  ok('flag with no masked number is unverified, expired or not',
    verifiedBadge({ idVerified: true, idMaskedLast4: '', idExpiry: '2020-01-01' }, '2026-09-23') === 'unverified');
  ok('not verified → unverified', verifiedBadge({ idVerified: false, idMaskedLast4: '4567' }, '2026-09-23') === 'unverified');
  ok('isIdExpired: blank / junk today is never expired', !isIdExpired('2020-01-01', '') && !isIdExpired('', '2026-09-23'));
  ok('label names the day', idExpiredLabel('2026-09-22') === 'ID expired Sep 22, 2026', idExpiredLabel('2026-09-22'));
  ok('label keeps a raw value it cannot format', idExpiredLabel('12/2020') === 'ID expired 12/2020');
  // Default `today` is the LOCAL day: an ID that expired yesterday is expired now.
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yDay = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  ok('default today = the local calendar day', verifiedBadge({ ...v, idExpiry: yDay }) === 'id_expired');
}

console.log('\n#165/#166 the marketplace listing uses the badge, not the raw flag');
{
  const base: CrewMember = {
    id: 'cm1', companyUserId: 'gc1', createdAt: '2026-07-08T00:00:00Z', updatedAt: '2026-07-08T00:00:00Z',
    fullName: 'Jane Framer', trades: ['Carpenter'], status: 'active', idVerified: true, idMaskedLast4: '4567',
    isPublic: true, projectIds: [], claimedByUserId: 'w1',
  };
  ok('verified → "ID Verified" license', JSON.stringify(crewMemberToWorkerProfile(base).licenses) === '["ID Verified"]');
  ok('flag set but no masked number → no badge', crewMemberToWorkerProfile({ ...base, idMaskedLast4: undefined }).licenses.length === 0);
  ok('expired ID → no badge', crewMemberToWorkerProfile({ ...base, idExpiry: '2001-01-01' }).licenses.length === 0);
}

console.log('\n#167 a cert expiry that is there but unreadable is "Check date"');
{
  const today = '2026-09-23';
  ok('missing expiry → none ("No expiry")', crewCertRowStatus(undefined, certExpiryStatus(undefined, today)) === 'none');
  ok('blank expiry → none', crewCertRowStatus('  ', certExpiryStatus('  ', today)) === 'none');
  ok('junk expiry → check_date', crewCertRowStatus('not a date', certExpiryStatus('not a date', today)) === 'check_date');
  ok('real expired date stays expired', crewCertRowStatus('2026-09-01', certExpiryStatus('2026-09-01', today)) === 'expired');
  ok('last valid day (local today) is expiring, not expired',
    crewCertRowStatus('2026-09-22', certExpiryStatus('2026-09-22', '2026-09-22')) === 'expiring');
}

console.log('\n#73 the claim link\'s auth error');
{
  const P = crewScan.parseAuthLinkError;
  const hash = P('https://app.mageid.app/claim-crew?token=crew_x#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired');
  ok('fragment otp_expired is read', hash?.code === 'otp_expired', JSON.stringify(hash));
  ok('description decoded', hash?.description === 'Email link is invalid or has expired', JSON.stringify(hash));
  const q = P('https://app.mageid.app/claim-crew?token=crew_x&error=access_denied&error_description=Link+used');
  ok('query-string error is read too', q?.code === 'access_denied', JSON.stringify(q));
  ok('native deep link with fragment', P('mageid://claim-crew?token=crew_x#error_code=otp_expired')?.code === 'otp_expired');
  ok('a clean link → null', P('https://app.mageid.app/claim-crew?token=crew_abc') === null);
  ok('a success fragment → null', P('https://app.mageid.app/claim-crew?token=t#access_token=a&refresh_token=b') === null);
  ok('null / empty → null', P(null) === null && P('') === null);

  const C = crewScan.classifyClaimFailure;
  ok('no code (never reached the server) → retry', C('') === 'retry');
  ok('http_502 → retry', C('http_502') === 'retry');
  ok('already_claimed → already_claimed', C('already_claimed') === 'already_claimed');
  ok('invalid_token → invalid', C('invalid_token') === 'invalid');
  ok('http_404 → invalid', C('http_404') === 'invalid');
  ok('unauthenticated → sign_in', C('unauthenticated') === 'sign_in');
}

console.log('\n#73 redeemCrewClaim keeps the server code');
{
  const codeOf = async (r: InvokeResult) => {
    nextInvoke = () => r;
    try { await crewScan.redeemCrewClaim('crew_11111111-2222-4333-8444-555555555555'); return 'resolved'; }
    catch (e) { return edgeErrorCode(e); }
  };
  ok('404 invalid_token → invalid_token', (await codeOf({ data: null, error: httpError(404, { success: false, error: 'This invite link is invalid.', code: 'invalid_token' }) })) === 'invalid_token');
  ok('409 already_claimed → already_claimed', (await codeOf({ data: null, error: httpError(409, { success: false, error: 'used', code: 'already_claimed' }) })) === 'already_claimed');
  ok('502 with no code → "" (retry)', crewScan.classifyClaimFailure(await codeOf({ data: null, error: httpError(502, { success: false, error: 'Could not verify the invite.' }) })) === 'retry');
  ok('transport error (no context) → "" (retry)', (await codeOf({ data: null, error: { message: 'Failed to send a request to the Edge Function' } })) === '');
  ok('200 success:false → invalid', crewScan.classifyClaimFailure(await codeOf({ data: { success: false }, error: null })) === 'invalid');
  nextInvoke = () => ({ data: { success: true, memberId: 'm1' }, error: null });
  ok('success resolves the member id', (await crewScan.redeemCrewClaim('crew_x')) === 'm1');
}

console.log('\n#72 sendClaimInvite asks for the crew_claim email');
{
  calls.length = 0;
  nextInvoke = () => ({ data: { ok: true, companyName: 'Ridge Builders' }, error: null });
  const r = await crewScan.sendClaimInvite('maria@x.com', 'crew_11111111-2222-4333-8444-555555555555', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1');
  const b = calls[0]?.body ?? {};
  ok('calls auth-magic-link', calls[0]?.name === 'auth-magic-link');
  ok('purpose crew_claim + memberId + claimToken', b.purpose === 'crew_claim' && b.memberId === 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1' && b.claimToken === 'crew_11111111-2222-4333-8444-555555555555', JSON.stringify(b));
  ok('no company name in the body (the server reads it)', !('companyName' in b) && !('fromCompanyName' in b));
  ok('redirect is the https claim route', String(b.redirectTo).endsWith('/claim-crew?token=crew_11111111-2222-4333-8444-555555555555') && String(b.redirectTo).startsWith('https://'), String(b.redirectTo));
  ok('returns the name the server sent it under', r.companyName === 'Ridge Builders');
  nextInvoke = () => ({ data: null, error: httpError(409, { error: "That email isn't saved on this crew member yet.", code: 'email_mismatch' }) });
  let msg = '', code = '';
  try { await crewScan.sendClaimInvite('a@b.co', 'crew_11111111-2222-4333-8444-555555555555', 'x'); } catch (e) { msg = (e as Error).message; code = edgeErrorCode(e); }
  ok('a refusal surfaces the server sentence and code', /isn't saved/.test(msg) && code === 'email_mismatch', `${msg} ${code}`);

  calls.length = 0;
  nextInvoke = () => ({ data: { ok: true }, error: null });
  await crewScan.requestFreshClaimLink(' maria@x.com ', 'crew_11111111-2222-4333-8444-555555555555');
  const f = calls[0]?.body ?? {};
  ok('the replay path is the claim address minus the host',
    crewScan.claimAppPath('crew_11111111-2222-4333-8444-555555555555') === '/claim-crew?token=crew_11111111-2222-4333-8444-555555555555',
    crewScan.claimAppPath('crew_11111111-2222-4333-8444-555555555555'));
  ok('a fresh link is a plain sign-in link back to the claim page', f.purpose === undefined && f.email === 'maria@x.com' && String(f.redirectTo).includes('/claim-crew?token='), JSON.stringify(f));
}

console.log('\n#124 (carried) a scan refusal keeps the server sentence and code');
{
  nextInvoke = () => ({ data: null, error: httpError(429, { error: 'Monthly credential-scan limit reached (20 on pro). Resets Sep 30, 8:00 PM.', code: 'monthly_cap_reached' }) });
  let msg = '', code = '';
  try { await crewScan.scanGovernmentId('b64'); } catch (e) { msg = (e as Error).message; code = edgeErrorCode(e); }
  ok('ID scan: the server sentence, not "non-2xx"', msg.startsWith('Monthly credential-scan limit reached'), msg);
  ok('ID scan: the code survives', code === 'monthly_cap_reached', code);
  nextInvoke = () => ({ data: null, error: httpError(403, { error: 'Credential scan is on Pro.', code: 'tier_required' }) });
  msg = ''; code = '';
  try { await crewScan.scanCertification('b64'); } catch (e) { msg = (e as Error).message; code = edgeErrorCode(e); }
  ok('cert scan: tier_required kept', code === 'tier_required' && msg === 'Credential scan is on Pro.', `${msg} ${code}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
