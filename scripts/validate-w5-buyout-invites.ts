// scripts/validate-w5-buyout-invites.ts — wave 5, lane buyout: invitations to bid.
//
//   #14  an invite filed OFFLINE is emailed once it uploads — through the SAME
//        token — and until then it is in the list and in splitAlreadyInvited,
//        so a second offline send cannot mint a second link.
//   #94  "sent" means notify SAID it handled the event; the reason a mail did
//        not go (unsubscribed, refused, unreachable) rides back to the screen.
//   #15  a sub filing his number fires bid_invite_received from an AFTER
//        trigger (CONTRACT 8), and both buyout screens re-read on focus.
//   #99  the bid page prints the due DAY from bid_invite_get's bids_due_on.
//   #178 the bid page's confirmation prints the filed price to the cent.
//
// Executed where it can be: utils/bidInvites.ts and utils/notifyClient.ts run
// here against stubbed storage, queue and fetch (Bun.plugin), and the bid
// page's own dueDay()/money() are lifted out of the HTML and called.
//
// Run: bun run scripts/validate-w5-buyout-invites.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPendingDelivery,
  isRetryableNotifyReason,
  mergeInvitesWithPending,
  parsePendingBidInvites,
  planPendingDelivery,
  notEmailedSentence,
  PENDING_BID_INVITES_KEY,
  type PendingBidInvite,
} from '../utils/bidInvitePending';
import { splitAlreadyInvited, type BidInviteRecord } from '../utils/bidInviteCore';
import { APP_STORAGE_PREFIXES } from '../utils/localCacheKeys';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.info('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}

const NOW = Date.parse('2026-09-23T15:00:00.000Z');
const LATER = '2026-10-23T15:00:00.000Z';
const PAST = '2026-09-01T00:00:00.000Z';
function inv(id: string, over: Partial<BidInviteRecord> = {}): BidInviteRecord {
  return {
    id, packageId: 'pkg-1', projectId: 'proj-1', subName: null, subEmail: `${id}@sub.com`,
    subcontractorId: null, inviteToken: `tok-${id}-${'x'.repeat(40)}`, status: 'sent',
    expiresAt: LATER, respondedAt: null, bidId: null, createdAt: '2026-09-23T14:00:00.000Z', ...over,
  };
}
const BASE = { userId: 'gc-1', packageId: 'pkg-1', projectId: 'proj-1', packageName: 'Plumbing', projectName: 'Henderson' };
function pend(id: string, over: Partial<PendingBidInvite> = {}): PendingBidInvite {
  return { invite: inv(id), base: BASE, queuedAt: '2026-09-23T14:00:00.000Z', attempts: 0, ...over };
}

// ── A. the pending arithmetic (pure) ────────────────────────────────────────
console.info('\nA. offline invites: list, dedupe, deliver, clear (#14)');

ok('the pending key is swept by the tenant wipe (a mageid_ prefix)',
  APP_STORAGE_PREFIXES.some(p => PENDING_BID_INVITES_KEY.startsWith(p)), PENDING_BID_INVITES_KEY);
eq('damaged storage is an empty list, not a throw', parsePendingBidInvites('{nope'), []);
eq('a non-array is an empty list', parsePendingBidInvites('{"a":1}'), []);
eq('an entry missing its token is dropped', parsePendingBidInvites(JSON.stringify([{ invite: { id: 'a' }, base: BASE }])), []);
eq('a good entry round-trips', parsePendingBidInvites(JSON.stringify([pend('a')])).map(p => p.invite.id), ['a']);

const merged = mergeInvitesWithPending([inv('s1')], [pend('p1'), pend('s1', { gaveUp: true, lastReason: 'suppressed_unsubscribed' })], 'pkg-1', NOW);
eq('a pending invite the server does not have yet is IN the list, marked localOnly',
  merged.filter(r => r.localOnly).map(r => r.id), ['p1']);
eq('a server row is never duplicated by its pending entry', merged.filter(r => r.id === 's1').length, 1);
eq('a refused delivery rides onto its server row as notEmailedReason',
  merged.find(r => r.id === 's1')?.notEmailedReason, 'suppressed_unsubscribed');
eq('another package\'s pending invites stay out', mergeInvitesWithPending([], [pend('p1')], 'pkg-2', NOW).length, 0);
eq('a pending invite whose link lapsed is not shown', mergeInvitesWithPending([], [pend('p1', { invite: inv('p1', { expiresAt: PAST }) })], 'pkg-1', NOW).length, 0);

// The whole point of listing them: a second offline send to the same sub is
// held back, not minted a second live token.
const dup = splitAlreadyInvited([{ email: 'p1@sub.com' }, { email: 'new@sub.com' }], merged, NOW);
eq('splitAlreadyInvited sees the pending invite as a live link', dup.alreadyLive, ['p1@sub.com']);
eq('…and the new address still goes', dup.fresh.map(r => r.email), ['new@sub.com']);

const plan = planPendingDelivery(
  [pend('up'), pend('notyet'), pend('answered'), pend('lapsed'), pend('refused', { gaveUp: true }), { ...pend('other'), base: { ...BASE, packageId: 'pkg-9' } }],
  [inv('up'), inv('answered', { respondedAt: '2026-09-23T14:30:00Z' }), inv('lapsed', { expiresAt: PAST }), inv('refused'), inv('other')],
  new Set(['pkg-1']),
  NOW,
);
eq('uploaded + unanswered + live → deliver', plan.deliver.map(d => d.row.id), ['up']);
eq('answered or lapsed → dropped (a dead token is never mailed)', plan.drop.sort(), ['answered', 'lapsed']);
ok('not uploaded yet → kept, neither sent nor dropped', !plan.deliver.some(d => d.row.id === 'notyet') && !plan.drop.includes('notyet'));
ok('a refused entry is not re-sent on every focus', !plan.deliver.some(d => d.row.id === 'refused'));
ok('an entry for a package the read did not cover is left alone', !plan.deliver.some(d => d.row.id === 'other') && !plan.drop.includes('other'));

eq('emailed → cleared', applyPendingDelivery([pend('a'), pend('b')], 'a', { emailed: true }).map(p => p.invite.id), ['b']);
const refused = applyPendingDelivery([pend('a')], 'a', { emailed: false, reason: 'suppressed_unsubscribed' })[0];
ok('refused (unsubscribed) → kept, gaveUp, reason recorded', refused.gaveUp === true && refused.lastReason === 'suppressed_unsubscribed' && refused.attempts === 1);
const flaky = applyPendingDelivery([pend('a')], 'a', { emailed: false, reason: 'unreachable' })[0];
ok('unreachable → kept for the next flush, not given up', flaky.gaveUp === false && flaky.attempts === 1);
ok('a 5xx is retryable; a refusal is not', isRetryableNotifyReason('http_503') && !isRetryableNotifyReason('email_send_failed') && !isRetryableNotifyReason('unknown_event'));
ok('the unsubscribed sentence names the address and the fix',
  /x@y\.com unsubscribed from invitation emails — text them the link/.test(notEmailedSentence('x@y.com', 'suppressed_unsubscribed')));
ok('any other refusal says to copy the link', /Could not hand the email off .*copy the link/.test(notEmailedSentence('x@y.com', 'email_send_failed')));

// ── B. executed: bidInvites + notifyClient against stubs ─────────────────────
console.info('\nB. executed: the send, the upload, the email (stubbed storage / queue / fetch)');

const store = new Map<string, string>();
let writeOutcome: 'synced' | 'queued' | 'failed' = 'queued';
const writes: Record<string, unknown>[] = [];
type NotifyCall = { event: string; payload: Record<string, unknown> };
const notifyCalls: NotifyCall[] = [];
let notifyReply: () => { status: number; body: string } = () => ({ status: 200, body: '{"success":true,"result":{"ok":true}}' });

interface VirtualModuleBuilder {
  module(specifier: string, cb: () => { exports: Record<string, unknown>; loader: 'object' }): void;
}
interface BunGlobal { plugin(def: { name: string; setup: (build: VirtualModuleBuilder) => void }): void }
const bun = (globalThis as unknown as { Bun?: BunGlobal }).Bun;
if (!bun) { console.error('\n✗ must run under bun (Bun.plugin stubs the native modules)\n'); process.exit(1); }
const asyncStorage = {
  getItem: async (k: string) => store.get(k) ?? null,
  setItem: async (k: string, v: string) => { store.set(k, v); },
  removeItem: async (k: string) => { store.delete(k); },
};
bun.plugin({
  name: 'stub-native-for-bid-invites',
  setup(build) {
    build.module('@/lib/supabase', () => ({
      exports: {
        supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
        isSupabaseConfigured: true, SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon',
      },
      loader: 'object',
    }));
    build.module('expo-crypto', () => ({
      exports: { getRandomBytesAsync: async (n: number) => new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255) },
      loader: 'object',
    }));
    build.module('@react-native-async-storage/async-storage', () => ({
      exports: { default: asyncStorage, ...asyncStorage }, loader: 'object',
    }));
    build.module('@/utils/offlineQueue', () => ({
      exports: {
        supabaseWriteDetailed: async (_t: string, _op: string, row: Record<string, unknown>) => { writes.push(row); return writeOutcome; },
        onQueueFlushed: () => () => {},
      },
      loader: 'object',
    }));
  },
});
(globalThis as unknown as { fetch: unknown }).fetch = async (_url: string, init: { body: string }) => {
  const b = JSON.parse(init.body) as NotifyCall;
  notifyCalls.push(b);
  const r = notifyReply();
  return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => r.body };
};

const { sendBidInvite, deliverPendingBidInvites, loadPendingBidInvites, remindBidInvites } = await import('../utils/bidInvites');
const { notifyEventDetailed, notifyEvent } = await import('../utils/notifyClient');

const ARGS = { ...BASE, subEmail: 'joe@ace.com', subName: 'Joe', scopeDescription: 'PEX 420 LF', bidsDueAt: '2026-09-25T16:00:00.000Z' };

// B1. offline send: queued, remembered, NOT mailed
writeOutcome = 'queued';
const q = await sendBidInvite(ARGS);
eq('an offline invite comes back queued', q.outcome, 'queued');
ok('…and is not reported emailed', q.emailed === false);
eq('…and nothing was mailed yet (a link ahead of its row reads as withdrawn)', notifyCalls.length, 0);
let pending = await loadPendingBidInvites();
eq('…and it is remembered on this phone', pending.map(p => p.invite.id), [q.inviteId]);
ok('…with the SAME token the queued row carries', pending[0]?.invite.inviteToken === writes[0]?.invite_token);

// B2. upload + a transport failure: kept
const serverRow = inv(q.inviteId, { inviteToken: String(writes[0]?.invite_token), subEmail: 'joe@ace.com', packageId: 'pkg-1' });
notifyReply = () => ({ status: 503, body: 'down' });
let delivered = await deliverPendingBidInvites([serverRow], new Set(['pkg-1']), NOW);
ok('uploaded → one delivery attempt', notifyCalls.length === 1 && delivered.length === 1);
ok('a 503 is not a send, and says why', delivered[0]?.emailed === false && delivered[0]?.reason === 'http_503');
pending = await loadPendingBidInvites();
ok('…so the entry is kept for the next flush', pending.length === 1 && pending[0].gaveUp === false);

// B3. upload + handled: mailed with the SAME token, then cleared
notifyReply = () => ({ status: 200, body: '{"success":true,"result":{"ok":true}}' });
delivered = await deliverPendingBidInvites([serverRow], new Set(['pkg-1']), NOW);
const mail = notifyCalls[notifyCalls.length - 1];
eq('the upload fires bid_invite_sent', mail?.event, 'bid_invite_sent');
ok('…to the invited address', mail?.payload.sub_email === 'joe@ace.com');
ok('…with a link on the EXISTING token — no second link minted',
  String(mail?.payload.invite_url ?? '').includes(String(writes[0]?.invite_token)) && writes.length === 1, String(mail?.payload.invite_url));
ok('…and the bid due date rides along', mail?.payload.bids_due_at === ARGS.bidsDueAt);
ok('…and nothing about the GC\'s own number', !Object.keys(mail?.payload ?? {}).some(k => /budget/i.test(k)));
ok('handled → reported emailed', delivered[0]?.emailed === true);
eq('handled → the entry is cleared', (await loadPendingBidInvites()).length, 0);
const callsBefore = notifyCalls.length;
await deliverPendingBidInvites([serverRow], new Set(['pkg-1']), NOW);
eq('a second pass mails nobody', notifyCalls.length, callsBefore);

// B4. unsubscribed: 200 envelope refusal → not emailed, reason carried, given up
writeOutcome = 'queued';
const q2 = await sendBidInvite({ ...ARGS, subEmail: 'sam@x.com' });
notifyReply = () => ({ status: 200, body: '{"success":true,"result":{"ok":false,"reason":"suppressed_unsubscribed","event":"bid_invite_sent"}}' });
const row2 = inv(q2.inviteId, { inviteToken: String(writes[writes.length - 1]?.invite_token), subEmail: 'sam@x.com' });
delivered = await deliverPendingBidInvites([row2], new Set(['pkg-1']), NOW);
ok('an unsubscribed sub is NOT reported emailed (#94)', delivered[0]?.emailed === false && delivered[0]?.reason === 'suppressed_unsubscribed');
pending = await loadPendingBidInvites();
ok('…the entry is kept with gaveUp, so the row can say why', pending.length === 1 && pending[0].gaveUp === true);
const c3 = notifyCalls.length;
await deliverPendingBidInvites([row2], new Set(['pkg-1']), NOW);
eq('…and it is not re-mailed on every focus', notifyCalls.length, c3);
// the sub answers anyway (the GC texted the link) → nothing left to say
await deliverPendingBidInvites([{ ...row2, respondedAt: '2026-09-23T16:00:00Z' }], new Set(['pkg-1']), NOW);
eq('…and it is dropped once the sub has answered', (await loadPendingBidInvites()).length, 0);

// B5. an online send reads the envelope, not the status code (#94)
writeOutcome = 'synced';
notifyReply = () => ({ status: 200, body: '{"success":true,"result":{"ok":false,"reason":"email_send_failed","event":"bid_invite_sent"}}' });
const s1 = await sendBidInvite(ARGS);
ok('a synced send notify refused is not "emailed" and says why', s1.emailed === false && s1.reason === 'email_send_failed');
notifyReply = () => ({ status: 200, body: '{"success":true,"result":{"ok":true}}' });
const s2 = await sendBidInvite(ARGS);
ok('a synced, handled send is emailed with no reason', s2.emailed === true && s2.reason === undefined);
eq('a synced send leaves nothing pending', (await loadPendingBidInvites()).length, 0);

// B6. a chase reports the reason too
notifyReply = () => ({ status: 200, body: '{"success":true,"result":{"ok":false,"reason":"suppressed_unsubscribed"}}' });
const chase = await remindBidInvites(BASE, [inv('c1')]);
ok('a chase to an unsubscribed sub reports the reason', chase[0]?.emailed === false && chase[0]?.reason === 'suppressed_unsubscribed');

// B7. notifyEventDetailed itself
notifyReply = () => ({ status: 200, body: '' });
eq('an unreadable 2xx is treated as handled (no invented failure)', await notifyEventDetailed('bid_invite_sent', {}), { handled: true });
notifyReply = () => ({ status: 200, body: '{"success":false,"error":"boom"}' });
eq('success:false is not handled, with the error as reason', await notifyEventDetailed('bid_invite_sent', {}), { handled: false, reason: 'boom' });
notifyReply = () => { throw new Error('offline'); };
eq('a thrown fetch is unreachable, never a throw', await notifyEventDetailed('bid_invite_sent', {}), { handled: false, reason: 'unreachable' });
notifyReply = () => ({ status: 200, body: '{"success":true,"result":{"ok":false,"reason":"unknown_event"}}' });
ok('notifyEvent stays the boolean wrapper', (await notifyEvent('bid_invite_sent', {})) === false);

// ── C. source wiring the executed tests cannot see ──────────────────────────
console.info('\nC. wiring');
const client = stripComments(read('utils/bidInvites.ts'));
ok('bidInvites mails through notifyEventDetailed (the reason-carrying call)',
  (client.match(/notifyEventDetailed\(\s*'bid_invite_sent'/g) ?? []).length === 2);
ok('bidInvites no longer uses the boolean notifyEvent', !/\bnotifyEvent\(/.test(client));
ok('the stale "notify has no bid_invite_sent branch yet" comment is gone',
  !/has no `bid_invite_sent` branch yet/.test(read('utils/bidInvites.ts')));
const pkgScreen = stripComments(read('app/buyout-package.tsx'));
ok('buyout-package re-reads invites on FOCUS, not only on mount (#15)',
  /useFocusEffect\(useCallback\(\(\) => \{ void loadInvites\(\); \}, \[loadInvites\]\)\)/.test(pkgScreen)
  && !/useEffect\(\(\) => \{ void loadInvites\(\); \}, \[loadInvites\]\);/.test(pkgScreen));
ok('buyout-package reloads (and so delivers) when the queue uploads invites',
  /onQueueFlushed\(tables => \{\s*if \(tables\.has\('bid_package_invites'\)\) void loadInvites\(\);/.test(pkgScreen));
ok('loadInvites delivers pending invites for this package', /deliverPendingBidInvites\(rows, new Set\(\[packageId\]\)\)/.test(pkgScreen));
ok('the list is the server rows merged with the pending ones', /mergeInvitesWithPending\(serverInvites, pendingInvites/.test(pkgScreen));
ok('splitAlreadyInvited runs on the merged list', /splitAlreadyInvited\(recipients, invites, Date\.now\(\)\)/.test(pkgScreen));
ok('a pending invite is not chased and has no copy button (its link is dead until upload)',
  (pkgScreen.match(/remindableInvites\(invites\.filter\(i => !i\.localOnly\)/g) ?? []).length === 2
  && /state !== 'responded' && !inv\.localOnly &&/.test(pkgScreen));
ok('the row says it is on this phone', /On this phone — will email when it uploads/.test(pkgScreen));
ok('the queued alert says the email goes out once it uploads', /The email goes out once/.test(pkgScreen));
ok('an unsubscribed sub is named in the send and chase alerts', (pkgScreen.match(/notEmailedSentence\(/g) ?? []).length >= 2);
ok('the not-emailed row marker is shown', /NOT_EMAILED_ROW/.test(pkgScreen));
const list = stripComments(read('app/buyout.tsx'));
ok('buyout.tsx re-reads project invites on FOCUS (#15)', /useFocusEffect\(useCallback\(\(\) => \{[\s\S]{0,200}fetchBidInvitesForProject\(projectId\)/.test(list));
ok('…and delivers pending invites for the project\'s packages', /deliverPendingBidInvites\(rows, new Set\(/.test(list));

// ── D. the migration (read; PGlite executes it — scratchpad w5bo_pg) ─────────
console.info('\nD. migration 20260923220000');
const mig = read('supabase/migrations/20260923220000_bid_invite_due_and_received.sql');
const migCode = mig.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
ok('bid_invite_get returns bids_due_on as the UTC calendar day',
  /'bids_due_on',\s*to_char\(v_pkg\.due_date at time zone 'UTC', 'YYYY-MM-DD'\)/.test(migCode));
ok('…and still no estimate_budget', !/estimate_budget/.test(migCode));
ok('…SECURITY DEFINER, search_path public, anon + authenticated only',
  /function public\.bid_invite_get\(p_token text\)[\s\S]{0,80}security definer\s+set search_path to 'public'/.test(migCode)
  && /grant execute on function public\.bid_invite_get\(text\) to anon, authenticated;/.test(migCode));
ok('the notify trigger is AFTER UPDATE OF responded_at, NULL → NOT NULL (CONTRACT 8)',
  /create trigger trg_notify_bid_invite_received\s+after update of responded_at on public\.bid_package_invites\s+for each row\s+when \(old\.responded_at is null and new\.responded_at is not null\)/.test(migCode));
ok('…calling fire_notify with ids only',
  /perform public\.fire_notify\(\s*'bid_invite_received',\s*'bid_package_invites',\s*new\.id::text,\s*jsonb_build_object\(\s*'user_id',\s*new\.user_id,\s*'package_id',\s*new\.package_id,\s*'invite_id',\s*new\.id,\s*'bid_id',\s*new\.bid_id\s*\)/.test(migCode));
ok('…inside an exception block, so a failed notify never fails the sub\'s submit',
  /begin\s+perform public\.fire_notify[\s\S]*?exception when others then/.test(migCode));
ok('fire_notify is called from trigger functions only (never an RPC body)',
  (migCode.match(/fire_notify\(/g) ?? []).length === 1 && /returns trigger[\s\S]*?fire_notify/.test(migCode));
ok('a deleted bid releases its invite without reopening the link',
  /after delete on public\.bid_package_bids/.test(migCode) && /set bid_id = null, status = 'bid_deleted'/.test(migCode) && !/responded_at\s*=\s*null/.test(migCode));

// ── E. the sub's page, executed (#99, #178) ──────────────────────────────────
console.info('\nE. the bid page: due day and money, executed');
const page = read('marketing/bid-invite/index.html');
function lift(name: string): string {
  const start = page.indexOf(`function ${name}(`);
  if (start < 0) return '';
  let depth = 0;
  for (let i = page.indexOf('{', start); i < page.length; i++) {
    if (page[i] === '{') depth++;
    else if (page[i] === '}') { depth--; if (depth === 0) return page.slice(start, i + 1); }
  }
  return '';
}
const pageFns = new Function(`${lift('cents')}\n${lift('money')}\n${lift('dueDay')}\nreturn { cents, money, dueDay };`)() as {
  cents: (n: number) => number; money: (n: unknown) => string; dueDay: (v: unknown) => { label: string; past: boolean } | null;
};
eq('#178 a $12,345.50 bid reads back as $12,345.50, not $12,346', pageFns.money(12345.5), '$12,345.50');
eq('#178 whole dollars still show cents', pageFns.money(4800), '$4,800.00');
eq('#178 a float artefact is rounded to the cent', pageFns.money(0.1 + 0.2), '$0.30');
eq('#178 the RPC gets the same cent value the page shows', pageFns.cents(12345.499999), 12345.5);
ok('#178 the grouping is pinned to en-US (not the viewer\'s locale under a hard "$")', /toLocaleString\('en-US'/.test(lift('money')));
ok('#178 the submitted amount goes through cents() before the RPC and the confirmation',
  /var amount = cents\(parseAmount\(/.test(page) && /p_amount: amount/.test(page) && /money\(amount\)/.test(page));
const y = new Date().getFullYear();
const future = `${y + 1}-09-25`;
const d1 = pageFns.dueDay(future);
ok('#99 a due day renders as a weekday + month + day', !!d1 && /^[A-Z][a-z]+day, September 25/.test(d1.label), JSON.stringify(d1));
ok('#99 …in the named day, never shifted (Sept 25 stays Sept 25)', !!d1 && /September 25/.test(d1.label));
ok('#99 a future day is not past due', d1?.past === false);
ok('#99 a past day IS marked past due', pageFns.dueDay('2020-01-06')?.past === true);
eq('#99 no date → no row (never the link\'s expiry)', pageFns.dueDay(null), null);
eq('#99 a rolled-over day is refused', pageFns.dueDay('2026-02-31'), null);
ok('#99 the page reads bids_due_on through SCOPE and puts it in the hero',
  /dueDay\(SCOPE\.bids_due_on\)/.test(page) && /dueHtml \+\s*'<\/div><\/header>'/.test(page));
ok('#99 the page shows "Bids due …"', /'Bids due ' \+ esc\(due\.label\)/.test(page));

console.info(`\n${fail === 0 ? `validate-w5-buyout-invites: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
