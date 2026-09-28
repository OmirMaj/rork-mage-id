// validate-ux-portal-ready — can the homeowner actually receive it? (UX wave, Lane 0)
//
// WHAT IT PROVES. portalDeliveryState (utils/portalReady.ts) is lifted from
// the four branches app/contract.tsx ran AFTER flipping a contract to 'sent'.
// C1 now asks it BEFORE the flip, so it must give the same answer contract.tsx
// gave, in the same order, plus 'collaborator' first. It also pins
// contract.tsx to it, and proves C1's local delivery marker is tenant-safe.
//
// Run: bun run scripts/validate-ux-portal-ready.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  portalDeliveryState, portalDeliveryFacts, portalRecipients, portalOwnershipOf,
  CONTRACT_DELIVERY_KEY_PREFIX, contractDeliveryKey, stampContractDelivery, readContractDelivery,
  type PortalDeliveryState,
} from '../utils/portalReady';
import { portalShareUrl } from '../utils/portalSnapshot';
import { isAppStorageKey, APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';
import type { ClientPortalSettings, ClientPortalInvite } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS  ' + name); return; }
  fail++;
  console.error('  FAIL  ' + name + (detail ? `\n        ${detail}` : ''));
}
function eq<T>(name: string, actual: T, expected: T) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  ok(name, a === e, `expected ${e}, got ${a}`);
}

const inv = (email: string): ClientPortalInvite => ({ id: email, email, name: 'Amy Reyes', invitedAt: '2026-09-01T00:00:00Z', status: 'pending' });
const portal = (o: Partial<ClientPortalSettings>): ClientPortalSettings => ({
  enabled: true, portalId: 'p1', accessToken: 'tok_' + 'a'.repeat(44), showSchedule: true, showChangeOrders: true, showInvoices: true,
  showPhotos: true, showBudgetSummary: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false,
  invites: [inv('amy@home.com')], ...o,
});
const OWNER = 'u-owner';
const job = (cp?: ClientPortalSettings, ownerUserId: string | undefined = OWNER) => ({ clientPortal: cp, ownerUserId });

/** contract.tsx's branches as they stood at 2859f55b, transcribed — the
 *  reference the helper must agree with (collaborator aside). */
function legacy(project: ReturnType<typeof job> | null): PortalDeliveryState {
  const portalSettings = project?.clientPortal;
  const recipients = (portalSettings?.invites ?? []).filter(i => (i.email ?? '').trim().includes('@'));
  const portalUrl = project ? portalShareUrl(portalSettings) : null;
  if (project && portalUrl && recipients.length > 0) return 'ready';
  if (recipients.length === 0) return 'no_email';
  if (portalSettings?.enabled && portalSettings.portalId) return 'no_signing_key';
  return 'portal_off';
}

console.log('\nux portal-ready validation:');

console.log('\n1. the five states');
eq('portal on, token, invitee → ready', portalDeliveryState(job(portal({})), OWNER), 'ready');
eq('no invitee email → no_email', portalDeliveryState(job(portal({ invites: [inv('n/a')] })), OWNER), 'no_email');
eq('on, no token → no_signing_key', portalDeliveryState(job(portal({ accessToken: undefined })), OWNER), 'no_signing_key');
eq('off → portal_off', portalDeliveryState(job(portal({ enabled: false })), OWNER), 'portal_off');
eq('never set up (no portal at all, no invitee) → no_email, as contract.tsx said', portalDeliveryState(job(undefined), OWNER), 'no_email');
eq('not the owner → collaborator, even when everything else is ready', portalDeliveryState(job(portal({}), 'someone-else'), OWNER), 'collaborator');
eq('no project → no_email', portalDeliveryState(null, OWNER), 'no_email');

console.log('\n2. same answer as contract.tsx\'s old branches');
{
  const variants: (ClientPortalSettings | undefined)[] = [];
  for (const enabled of [true, false]) for (const portalId of ['p1', '']) for (const accessToken of ['tok_x', undefined, '  '])
    for (const invites of [[inv('amy@home.com')], [inv('nope')], [], [inv(' b@x.com ')]]) variants.push(portal({ enabled, portalId, accessToken, invites }));
  variants.push(undefined);
  const bad = variants.filter(v => portalDeliveryState(job(v), OWNER) !== legacy(job(v)));
  ok(`all ${variants.length} portal shapes agree with the transcribed branches`, bad.length === 0, JSON.stringify(bad[0]));
  const unknownOwner = variants.filter(v => portalDeliveryState(job(v, undefined), OWNER) !== legacy(job(v)));
  ok('an unknown owner (cache before ownerUserId) is NOT a collaborator — same answers', unknownOwner.length === 0);
}

console.log('\n3. facts, ownership, recipients');
eq('facts for "no email, portal off" — C1 asks both in one sheet', portalDeliveryFacts(job(portal({ enabled: false, invites: [] })), OWNER),
  { isCollaborator: false, hasEmail: false, portalOn: false, hasSigningLink: false });
eq('ownership', [portalOwnershipOf('a', 'a'), portalOwnershipOf('a', 'b'), portalOwnershipOf(undefined, 'b'), portalOwnershipOf('a', null)], ['owner', 'collaborator', 'unknown', 'unknown']);
eq('recipients: trimmed, only those with an @', portalRecipients(portal({ invites: [inv(' amy@home.com '), inv('nope'), inv('')] })), [{ email: 'amy@home.com', name: 'Amy Reyes' }]);
eq('recipients of nothing', portalRecipients(undefined), []);

console.log('\n4. C1\'s local delivery marker');
{
  ok('the key sits under a swept prefix (tenant switch removes it)', isAppStorageKey(contractDeliveryKey('c1')) && APP_STORAGE_PREFIXES.some(p => CONTRACT_DELIVERY_KEY_PREFIX.startsWith(p)));
  const nd = stampContractDelivery('u1', { state: 'not_delivered', at: '2026-09-27T12:00:00Z', reason: 'send_failed' });
  eq('round-trips for the same user', readContractDelivery(nd, 'u1'), { state: 'not_delivered', at: '2026-09-27T12:00:00Z', reason: 'send_failed' });
  eq('another user reads nothing', readContractDelivery(nd, 'u2'), null);
  eq('no user reads nothing', readContractDelivery(nd, null), null);
  eq('malformed JSON reads nothing', readContractDelivery('{oops', 'u1'), null);
  eq('an unknown reason reads nothing', readContractDelivery(JSON.stringify({ uid: 'u1', state: 'not_delivered', at: 'x', reason: 'weird' }), 'u1'), null);
  eq('"delivered" needs a positive count', readContractDelivery(JSON.stringify({ uid: 'u1', state: 'delivered', at: 'x', count: 0 }), 'u1'), null);
  eq('delivered round-trips', readContractDelivery(stampContractDelivery('u1', { state: 'delivered', at: 'x', count: 2 }), 'u1'), { state: 'delivered', at: 'x', count: 2 });
}

console.log('\n5. contract.tsx asks the helper');
{
  const c = read('app/contract.tsx');
  ok('imports portalDeliveryState and portalRecipients', /import \{ portalDeliveryState, portalRecipients \} from '@\/utils\/portalReady';/.test(c));
  ok('recipients come from portalRecipients (one filter)', /const recipients = portalRecipients\(portalSettings\);/.test(c) && !/\.filter\(i => \(i\.email \?\? ''\)\.trim\(\)\.includes\('@'\)\)/.test(c));
  ok('the ready check is unchanged (validate-portal-owner pins it too)', /if \(project && portalUrl && recipients\.length > 0\)/.test(c));
  ok('the not-sent note is chosen by portalDeliveryState, with the owner id', /switch \(portalDeliveryState\(project, user\?\.id \?\? null\)\)/.test(c));
  // W2 MOMSIGN: the notes are now the signing letter's back-face line
  // (utils/moments/sites/signingCopy.ts, one function per sentence). They
  // survive verbatim where docs/VOICE.md allows; the no-key note lost its
  // "Note:" prefix and its em dash, never its meaning.
  const copy = read('utils/moments/sites/signingCopy.ts');
  for (const [fn, note] of [
    ['contractNotSentNoEmail', 'No client email on file. Share the portal link so the client can sign.'],
    ['contractNotSentNoSigningKey', 'This portal has no secure signing key yet, so nothing was emailed. Open Client portal, tap Save, then share the link from there.'],
    ['contractNotSentPortalOff', 'The client portal is off, so nothing was emailed. Turn it on in Client portal so the client can sign.'],
  ] as const) {
    ok(`the old note survives verbatim: "${note.slice(0, 40)}…"`, copy.includes(`'${note}'`) && new RegExp(`signingCopy\\.${fn}\\(\\)`).test(c));
  }
  ok('a collaborator is told the truth (only the owner can send), not "tap Save"',
    /case 'collaborator':\s*\n\s*notSentReason = signingCopy\.contractNotSentCollaborator\(\);/.test(c)
    && copy.includes(`"Only the project owner holds this portal's signing link, so nothing was emailed. Ask them to share it from the client portal."`));
  const helper = read('utils/portalReady.ts').replace(/\/\/.*$/gm, '');
  ok('the helper is pure', !/from 'react(-native)?'|AsyncStorage|supabase/.test(helper));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('ALL PASS');
