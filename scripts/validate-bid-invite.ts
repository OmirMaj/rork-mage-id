// validate-bid-invite.ts — invitation to bid, checked against the contract
// rather than against itself.
//
// WHY THIS EXISTS (audit 2026-09-07, worth-doing #24). `bid_package_bids` is
// owner-scoped (`user_id = auth.uid()`), so a subcontractor — no account, no
// JWT — could never write one, and every competing bid in the buyout matrix was
// typed by the GC. The fix is a random token on an owner-owned row plus two
// SECURITY DEFINER RPCs (supabase/migrations/20260908120000_bid_package_invites.sql).
// Three ways that fix can be broken silently, each of which this file fails on:
//
//   1. THE CLIENT MINTS A SHORT TOKEN. Both RPCs open with
//      `if p_token is null or length(p_token) < 16 then raise 'bid_invite_denied'`.
//      A client that mints fewer characters emails a link that is dead on
//      arrival, and dead in the one way the sub cannot distinguish from "the GC
//      withdrew it" — every failure raises the same sentinel. Nothing in the app
//      would log; the GC just never gets a bid back.
//
//   2. THE INVITE WRITE BYPASSES THE OFFLINE QUEUE. Every write in this app goes
//      through utils/offlineQueue.ts. A direct `supabase.from(...).insert` on a
//      basement job with no bars throws, the screen says "sent", and the link in
//      the sub's inbox points at a row that does not exist.
//
//   3. THE SUB PAGE READS A FIELD THE RPC DOES NOT RETURN. bid_invite_get hands
//      back scope and nothing else — deliberately NOT estimate_budget, because
//      the GC's own number in front of the people bidding against it anchors
//      every bid just under it. A `SCOPE.estimate_budget` on the page renders
//      `undefined` today and becomes a real leak the day someone widens the RPC
//      "to fix the blank". The allowlist below is read out of the migration, so
//      it cannot drift from what the function actually returns.
//
//   4. THE APP SAYS THE EMAIL WENT WHEN IT DID NOT. `notify` answers an event
//      its switch does not recognise with `{ok:false, reason:'unknown_event'}`
//      and no httpStatus, and the serve wrapper turns that into HTTP 200. A
//      client that reads only `Response.ok` therefore reports "sent" for mail
//      it never composed — which is what shipped, and which is invisible from
//      both ends: the GC waits for bids, the subs never heard from anyone.
//      Section G is the check; the notify branch itself is still missing.
//
//   5. ONE BIDDER GETS TWO LIVE TOKENS. `bid_invite_submit` blocks a second
//      submit per INVITE, not per bidder, so re-inviting an address that
//      already holds a live link lets one company file two bids — and the
//      coverage warning ("3+ qualified bids") then reads as satisfied by a
//      bidder that does not exist. Sections H (the split) and the ref latch.
//
//   6. THE PASTED ADDRESS IS NOT AN ADDRESS. `Joe Smith <joe@ace.com>`,
//      `mailto:joe@ace.com` and a trailing full stop each used to be filed
//      verbatim: the row exists, the screen counts it as invited, and no mail
//      service will ever accept it. Section I runs the parser on real pastes.
//
//   7. THE INVITATION DESCRIBES NOTHING. `scope_description` is rendered by the
//      notify branch and returned by `bid_invite_get`, and for a package the GC
//      made by hand NOTHING wrote it — so the sub was asked to price a package
//      NAME at an address, and the landing page's fallback copy told him to
//      email the contractor instead. Section L.
//
//   8. THE DEADLINE IS A FIELD NOBODY WRITES. `dueDate` and `requiredByDate`
//      both had zero writers, and the OVERDUE badge compared the second one —
//      unreachable code on the screen whose job is saying which packages are
//      late. Section M, which also pins that a chase re-uses the invite's own
//      token rather than minting a second one.
//
//   9. THE BID IS FROM NOBODY. `subcontractorId` was never set by any path, so
//      the bid, the commitment and the subcontract named a company and
//      referenced no record: no compliance check, no scorecard, and
//      app/sub-portals.tsx could not give the awarded sub a portal at all.
//      Section N.
//
// The contract values (the 16, the returned keys, the submit parameters) are
// PARSED FROM THE MIGRATION, never restated here. A guard that hard-codes the
// number it is checking passes the day someone changes the number.
//
// Mutation-tested 2026-09-10 (adversarial review): 26 mutations were applied to
// the real files one at a time — each of the six defects above reintroduced in
// its original form, plus the redirect removed, the URL base moved, the expiry
// turned into a calendar day, the latch deleted, the noscript deleted and the
// raw sentinel rendered — and every one of them exited this script 1, with the
// files restored byte-identically (sha256) after each. One mutation initially
// passed: moving `await r.text()` back inside the `if (!r.ok)` branch left every
// notify check matching, so section G now asserts the ORDER of that read.
//
// Sections L/M/N mutation-tested 2026-09-16 the same way — 10 mutations, each
// the original defect put back one at a time (scope not written at creation,
// the invite button un-gated, the badge reading `requiredByDate` again, the due
// date never captured, the sub id dropped from the send, an ambiguous company
// name resolved anyway, a unit price leaking into the scope text, a missing
// prequal packet pushed as a blocker again, a reminder minting a second token,
// and expired invites being chased). All 10 exited this script 1; every file
// restored byte-identically (sha256) after each.
//
// Run via: bun run scripts/validate-bid-invite.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BID_INVITE_MIN_TOKEN_CHARS,
  BID_INVITE_TOKEN_BYTES,
  BID_INVITE_URL_BASE,
  attachRosterIds,
  bidDueState,
  daysUntilDue,
  inviteExpiryFrom,
  parseInviteEmails,
  remindableInvites,
  resolveBidSubcontractor,
  splitAlreadyInvited,
  tokenFromBytes,
} from '../utils/bidInviteCore';
import { canGenerateScope, estimateItemsToScope } from '../utils/estimateItemsToScope';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const MIGRATION = 'supabase/migrations/20260908120000_bid_package_invites.sql';
const CLIENT = 'utils/bidInvites.ts';
const SCREEN = 'app/buyout-package.tsx';
const LIST = 'app/buyout.tsx';
const PAGE = 'marketing/bid-invite/index.html';
const NOTIFY_CLIENT = 'utils/notifyClient.ts';
const REDIRECTS = 'marketing/_redirects';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

/**
 * Comments describe the bug; code causes it. Every scan below runs on source
 * with block comments and whole-line `//` comments removed — a header that
 * quotes the defect it prevents must not read as the defect.
 * Only whole-line `//` comments are dropped, so the `https://` inside string
 * literals survives.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter(l => !l.trim().startsWith('//'))
    .join('\n');
}

/** Split `a, b(c, d), e` on the commas at depth 0. */
function splitTopLevel(src: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '', quote = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      cur += c;
      if (c === quote) quote = '';
      continue;
    }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** The text between the balanced parentheses that start at `openIdx`. */
function balanced(src: string, openIdx: number): string {
  let depth = 0, quote = '';
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return src.slice(openIdx + 1, i); }
  }
  return '';
}

// ── A. the contract, read out of the migration ──────────────────────────────
console.log('\nA. the contract (parsed from the migration, never restated)');

const sql = read(MIGRATION);

const getStart = sql.indexOf('function public.bid_invite_get');
const submitStart = sql.indexOf('function public.bid_invite_submit');
ok('the migration declares bid_invite_get', getStart > -1);
ok('the migration declares bid_invite_submit', submitStart > -1);
if (getStart < 0 || submitStart < 0) {
  console.log('\n✗ validate-bid-invite: cannot read the contract\n');
  process.exit(1);
}

const getBody = sql.slice(getStart, submitStart);
const submitBody = sql.slice(submitStart);

/** The `< N` in `length(p_token) < N`, per function. */
function tokenFloorIn(body: string, label: string): number | null {
  const m = body.match(/length\s*\(\s*p_token\s*\)\s*<\s*(\d+)/);
  if (!m) { ok(`${label} guards the token length`, false, 'no `length(p_token) < N` found'); return null; }
  return Number(m[1]);
}
const getFloor = tokenFloorIn(getBody, 'bid_invite_get');
const submitFloor = tokenFloorIn(submitBody, 'bid_invite_submit');
ok('both RPCs enforce the same token floor', getFloor != null && getFloor === submitFloor,
  `get: ${getFloor}, submit: ${submitFloor}`);
const TOKEN_FLOOR = Math.max(getFloor ?? 0, submitFloor ?? 0);
ok('the token floor parsed as a positive number', TOKEN_FLOOR > 0, String(TOKEN_FLOOR));

// The keys bid_invite_get actually returns. Odd positions in jsonb_build_object
// are values, so only the even ones are field names.
const jbIdx = getBody.indexOf('jsonb_build_object');
const returnedKeys = (() => {
  if (jbIdx < 0) return [] as string[];
  const args = splitTopLevel(balanced(getBody, getBody.indexOf('(', jbIdx)));
  const keys: string[] = [];
  for (let i = 0; i < args.length; i += 2) {
    const m = args[i].match(/^'([a-z0-9_]+)'$/i);
    if (m) keys.push(m[1]);
  }
  return keys;
})();
ok('bid_invite_get returns a parseable set of fields', returnedKeys.length >= 5, returnedKeys.join(', '));
ok('and estimate_budget is NOT one of them (the anchoring guard the migration argues for)',
  !returnedKeys.includes('estimate_budget'), returnedKeys.join(', '));

// The submit signature, in the order PostgREST will name them.
const submitParams = splitTopLevel(balanced(submitBody, submitBody.indexOf('(')))
  .map(p => (p.trim().split(/\s+/)[0] || '').trim())
  .filter(p => p.startsWith('p_'));
ok('bid_invite_submit exposes a parseable parameter list', submitParams.length === 7, submitParams.join(', '));

// ── B. the client cannot mint a token the RPC will refuse ───────────────────
console.log('\nB. the token clears the floor the RPC enforces');

eq('the client constant equals the migration floor', BID_INVITE_MIN_TOKEN_CHARS, TOKEN_FLOOR);

// Executed, not read: this is the check that a comment cannot satisfy. A
// generator that now refuses its own byte count is a FAILED check here, not a
// crashed script — a stack trace reads like a broken guard rather than a
// caught defect, and the next person deletes it.
let sample = '';
let sampleErr = '';
try {
  sample = tokenFromBytes(new Uint8Array(BID_INVITE_TOKEN_BYTES).fill(0xab));
} catch (e) {
  sampleErr = e instanceof Error ? e.message : String(e);
}
ok(`a real token is at least ${TOKEN_FLOOR} chars (got ${sample.length})`, sample.length >= TOKEN_FLOOR,
  sampleErr || `BID_INVITE_TOKEN_BYTES=${BID_INVITE_TOKEN_BYTES} hex-encodes to ${sample.length} chars — the RPC denies anything under ${TOKEN_FLOOR}`);
ok('a real token is hex only (no encoding that could shorten under the floor)',
  sample.length > 0 && /^[0-9a-f]+$/.test(sample), sample || sampleErr);

let threw = false;
try { tokenFromBytes(new Uint8Array(2)); } catch { threw = true; }
ok('tokenFromBytes refuses a byte count under the floor rather than returning it', threw,
  'a short token would produce an invite whose link the RPC denies forever');

const clientSrc = stripComments(read(CLIENT));
ok('the token comes from expo-crypto, sized by BID_INVITE_TOKEN_BYTES',
  /Crypto\.getRandomBytesAsync\(\s*BID_INVITE_TOKEN_BYTES\s*\)/.test(clientSrc),
  'the invite token is the only credential between a stranger and a write into the GC\'s bid table — it may not come from Math.random');
ok('and it is hex-encoded through tokenFromBytes (the function that enforces the floor)',
  /tokenFromBytes\(/.test(clientSrc));
ok('no Math.random anywhere in the invite path', !/Math\.random/.test(clientSrc));
ok('the row\'s invite_token is the minted token, not an id',
  /invite_token:\s*token\b/.test(clientSrc),
  'generateUUID() is fine for the row id and is not a credential');

// ── C. the invite write goes through the offline queue ──────────────────────
console.log('\nC. the invite write goes through utils/offlineQueue.ts');

const screenSrc = stripComments(read(SCREEN));

ok('utils/bidInvites.ts files the invite through supabaseWrite(Detailed)',
  /supabaseWriteDetailed\(\s*'bid_package_invites'\s*,\s*'insert'/.test(clientSrc),
  'a direct insert is lost the moment the GC has no signal, and the emailed link then points at nothing');

for (const [label, src] of [[CLIENT, clientSrc], [SCREEN, screenSrc]] as const) {
  const writes: string[] = [];
  const re = /supabase\s*\n?\s*\.from\(\s*['"]bid_package_invites['"]\s*\)([\s\S]{0,240})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    // A select is how the screen reads invite state and is fine; anything that
    // MUTATES has to be queued.
    const opMatch = m[1].match(/\.\s*(insert|update|upsert|delete)\s*\(/);
    if (opMatch) writes.push(opMatch[1]);
  }
  ok(`${label} never writes bid_package_invites directly`, writes.length === 0,
    `found direct ${writes.join(', ')} — route it through supabaseWrite so an offline invite is queued, not dropped`);
}

// ── D. invite state is on the screen the audit named ────────────────────────
console.log('\nD. the buyout screen shows who was invited and who went quiet');

ok('app/buyout-package.tsx loads the package\'s invites', /fetchBidInvites\(/.test(screenSrc));
ok('and renders each invite\'s state (invited / responded / expired)',
  /inviteState\(/.test(screenSrc) && /inviteStateLabel\(/.test(screenSrc));
ok('and sends invites through utils/bidInvites.ts', /sendBidInvites\(/.test(screenSrc));
ok('the coverage warning now offers the send it used to only ask for',
  /coverage-invite-subs/.test(screenSrc),
  '"Send the RFQ to more subs" was printed on a screen with no send');

// A dropped read rendered as "Nobody invited yet" sends the GC to re-invite
// subs who are already holding a live link (2026-09-07 honesty gap).
ok('a failed invite read is distinguishable from an empty one',
  /Promise<BidInviteRecord\[\] \| null>/.test(clientSrc) && /return null;/.test(clientSrc),
  'fetchBidInvites must answer null when it could not read, [] only when there is nothing to read');
ok('and the screen renders that difference rather than an empty state',
  /rows === null/.test(screenSrc) && /invitesFailed/.test(screenSrc));

// One outbound mail path. A second one is invisible: it does not appear in
// notification_outbox, is not suppressed by an unsubscribe, and nobody knows
// it exists until a sub says they never got anything.
ok('the invite email leaves through the notify edge function',
  /notifyEvent\(\s*'bid_invite_sent'/.test(clientSrc));
ok('and the email carries no budget figure (same anchoring reason the RPC withholds it)',
  !/budget/i.test(clientSrc), 'the GC\'s own number must not travel to the bidder');

// ── E. the sub page reads only what the RPC returns ─────────────────────────
console.log('\nE. the sub page reads only the fields bid_invite_get returns');

const pageRaw = read(PAGE);
const pageSrc = stripComments(pageRaw);

const scopeReads = [...new Set(
  [...pageSrc.matchAll(/\bSCOPE\.([A-Za-z_][A-Za-z0-9_]*)/g)].map(m => m[1]),
)].sort();
ok('the page actually reads the RPC result through SCOPE', scopeReads.length > 0);

const unknown = scopeReads.filter(f => !returnedKeys.includes(f));
ok('every field the page reads is one bid_invite_get returns', unknown.length === 0,
  `unknown: ${unknown.join(', ')}\n      returned: ${returnedKeys.join(', ')}`);

ok('the page never reaches SCOPE by a computed key (which would walk around the check above)',
  !/\bSCOPE\s*\[/.test(pageSrc));
ok('SCOPE is assigned from the bid_invite_get result and nothing else',
  /SCOPE\s*=\s*data\b/.test(pageSrc) && (pageSrc.match(/\bSCOPE\s*=\s*/g) || []).length === 2,
  'expected exactly the `var SCOPE = null` declaration and one assignment from the RPC result');
ok('estimate_budget appears nowhere on the bidder\'s page',
  !/estimate_budget/.test(pageSrc),
  'the GC\'s own number in front of the people bidding against it anchors every bid just under it');

// The submit call has to name the RPC's parameters exactly: PostgREST resolves
// an overload by argument NAMES, so one typo is a 404 the bidder reads as
// "that did not send" forever.
const submitCallIdx = pageSrc.indexOf("rpc('bid_invite_submit'");
ok('the page calls bid_invite_submit', submitCallIdx > -1);
const submitCallArgs = submitCallIdx > -1
  ? [...new Set([...balanced(pageSrc, pageSrc.indexOf('(', submitCallIdx))
      .matchAll(/(p_[a-z_]+)\s*:/g)].map(m => m[1]))].sort()
  : [];
eq('and passes exactly the parameters the function declares', submitCallArgs, [...submitParams].sort());

const getCallIdx = pageSrc.indexOf("rpc('bid_invite_get'");
ok('the page calls bid_invite_get with p_token', getCallIdx > -1 && /p_token:\s*TOKEN/.test(pageSrc));

const rpcNames = [...new Set([...pageSrc.matchAll(/rpc\(\s*'([a-z_]+)'/g)].map(m => m[1]))].sort();
eq('and calls no other RPC', rpcNames, ['bid_invite_get', 'bid_invite_submit']);

// ── F. every failure the bidder can hit has a sentence they can act on ──────
console.log('\nF. the bidder never sees a raw error');

ok('a missing token is handled', /if\s*\(!TOKEN\)/.test(pageSrc));
ok('bid_invite_denied is handled', /bid_invite_denied/.test(pageSrc));
ok('bid_invite_already_submitted is handled', /bid_invite_already_submitted/.test(pageSrc));
ok('an unreachable server is handled separately from a dead link',
  /showUnreachable\(/.test(pageSrc),
  '"check your connection" and "ask for a new link" are different instructions');

// The sentinel is a routing key, not copy. If it reaches the DOM the bidder is
// reading 'bid_invite_denied' and has no idea what to do next.
const rendersRawError = /(innerHTML|textContent)\s*=\s*[^;]*\b(err|error)\b\s*\.\s*(message|sentinel)/.test(pageSrc)
  || /showState\([^)]*\b(err|error)\s*\.\s*(message|sentinel)/.test(pageSrc);
ok('no raw sentinel or error message is rendered to the bidder', !rendersRawError);

// Every user-facing state ends in a full sentence with an instruction — the
// three failures the task named plus the two successes.
for (const [label, needle] of [
  ['dead / expired link', 'Ask them to send a fresh link'],
  ['already responded', 'This link files one bid and one only'],
  ['submit failed', 'email your bid to the contractor directly'],
] as const) {
  ok(`${label} tells the bidder what to do next`, pageRaw.includes(needle), `expected the copy to contain "${needle}"`);
}

// ── G. what the GC is told about the email is what happened ─────────────────
// The defect this replaces shipped green through every check above. `notify`
// answers an event its switch does not know with
// `{ok:false, reason:'unknown_event'}` and NO httpStatus, which the serve
// wrapper returns as HTTP 200 `{"success":true,"result":{"ok":false,…}}`.
// notifyEvent read only `Response.ok`, so it returned true, sendBidInvite set
// `emailed: true`, and the buyout screen told the GC five subs had been emailed
// while nothing left the building. He then waits for bids from people who were
// never contacted — the exact silence a missing invite produces, so nothing on
// either side ever surfaces it.
console.log('\nG. a 200 that says "I did not handle this" is not a send');

const notifySrc = read(NOTIFY_CLIENT);
const parseIdx = notifySrc.indexOf('JSON.parse(text)');
ok('notifyEvent parses the response envelope', parseIdx > -1,
  'a 2xx alone does not mean the dispatcher composed anything');
// Mutation-tested: moving `await r.text()` back inside the `if (!r.ok)` block
// leaves every other check here matching, so the ORDER is the invariant — the
// body has to be read on the SUCCESS path, which is the only path where an
// `{ok:false}` envelope can hide.
const textIdx = notifySrc.indexOf('await r.text()');
const notOkIdx = notifySrc.indexOf('if (!r.ok)');
ok('and reads the body on the 2xx path, not only on the error path',
  textIdx > -1 && notOkIdx > -1 && textIdx < notOkIdx && parseIdx > notOkIdx,
  `r.text() at ${textIdx}, !r.ok at ${notOkIdx}, JSON.parse at ${parseIdx}`);
ok('and treats a dispatcher-level refusal as a failure',
  /result\?\.ok\s*!==\s*false/.test(notifySrc) && /success\s*!==\s*false/.test(notifySrc),
  'unknown_event / no_gc_resolved / no_gc_profile all ride inside a 200');
const returnTrues = [...notifySrc.matchAll(/return true;/g)].map(m => m.index ?? -1);
ok('and no path returns success before that envelope is read',
  returnTrues.length > 0 && parseIdx > -1 && returnTrues.every(i => i > parseIdx),
  `return true at ${returnTrues.join(', ')}; envelope parsed at ${parseIdx}`);

ok('the screen picks its wording from whether the mail actually handed off',
  /mailed\.length\s*===\s*synced\.length/.test(screenSrc) && /r\.emailed/.test(screenSrc),
  '"5 invites sent" over an email that never composed is the whole defect');
ok('and when nothing was emailed it tells the GC to send the link himself',
  /copy each link/i.test(screenSrc),
  'the link is live either way — he just has to be told he is the one carrying it');

// A queued row is not on the server, so its link answers bid_invite_denied,
// which the sub page can only render as "this invitation is no longer open".
ok('the one-tap copy only fires for a row that actually reached the server',
  /synced\.length === 1/.test(screenSrc) && !/results\[0\]\.outcome !== 'failed'/.test(screenSrc),
  'copying a queued invite hands the sub a link that reads as a withdrawal');

// ── H. one bidder cannot be minted two live tokens ──────────────────────────
// bid_invite_submit blocks a second submit per INVITE, not per bidder. Two
// invites to one address therefore let one company file two bids, and the
// levelling matrix shows that as two competing subs — a fake third bid is worse
// than two real ones, because it satisfies the coverage warning.
console.log('\nH. a second live invite to the same sub is refused, not minted');

const NOW = Date.parse('2026-03-10T00:00:00.000Z');
const liveInvite = [{ subEmail: 'Joe@Ace.com', respondedAt: null, expiresAt: '2026-03-20T00:00:00.000Z' }];
const dup = splitAlreadyInvited([{ email: 'joe@ace.com' }, { email: 'new@bpl.com' }], liveInvite, NOW);
eq('an address already holding a live link is held back', dup.alreadyLive, ['joe@ace.com']);
eq('and the new address still goes', dup.fresh.map(r => r.email), ['new@bpl.com']);
const lapsed = splitAlreadyInvited([{ email: 'joe@ace.com' }], [
  { subEmail: 'joe@ace.com', respondedAt: null, expiresAt: '2026-03-01T00:00:00.000Z' },
], NOW);
eq('an EXPIRED invite is re-sendable — that is a deliberate re-invitation', lapsed.alreadyLive, []);
ok('the screen runs that check before sending', /splitAlreadyInvited\(/.test(screenSrc));
ok('and holds a synchronous latch so a double tap cannot file two rounds',
  /invitingRef/.test(screenSrc) && /invitingRef\.current\s*=\s*true/.test(screenSrc),
  'the disabled prop lands a frame late; a ref is true on the second tap');

// ── I. the address the GC pasted is the address we mail ─────────────────────
// Executed, not read. Each of these used to file an invite row whose sub_email
// no mail service will accept, while the screen counted it as invited.
console.log('\nI. a real paste survives (executed)');

const paste = parseInviteEmails('Joe Smith <joe@ace.com>');
eq('a mail-client paste yields the bare address', paste.recipients.map(r => r.email), ['joe@ace.com']);
eq('and keeps the display name for the bidder\'s greeting', paste.recipients[0]?.name, 'Joe Smith');
eq('a copied mailto: link is an address', parseInviteEmails('mailto:joe@ace.com').recipients.map(r => r.email), ['joe@ace.com']);
eq('a sentence\'s full stop is not part of the address', parseInviteEmails('joe@ace.com.').recipients.map(r => r.email), ['joe@ace.com']);
eq('the same sub typed twice is one invite', parseInviteEmails('joe@ace.com, JOE@ACE.COM').recipients.length, 1);
eq('a genuinely wrong address is still reported, not swallowed', parseInviteEmails('joeace.com').rejected, ['joeace.com']);
eq('and the leftover half of "Smith, Joe <joe@ace.com>" is not reported as a dropped sub',
  parseInviteEmails('Smith, Joe <joe@ace.com>').rejected, []);
ok('the screen consumes the parsed recipients (not a stale `emails` field)',
  /parseInviteEmails\(/.test(screenSrc) && /recipients/.test(screenSrc) && !/\{\s*emails,\s*rejected\s*\}/.test(screenSrc));

// ── J. the link the GC hands out actually resolves ──────────────────────────
// marketing/_redirects ends in `/*  /404.html  404`. A sub who lands there has
// no other way in, and cannot tell a routing 404 from a withdrawn invitation.
console.log('\nJ. the emailed URL has a route');

const invitePath = new URL(BID_INVITE_URL_BASE).pathname.replace(/\/$/, '');
const redirects = read(REDIRECTS)
  .split('\n')
  .map(l => l.trim())
  .filter(l => l && !l.startsWith('#'));
ok(`marketing/_redirects routes ${invitePath}`,
  redirects.some(l => {
    const [from, to, status] = l.split(/\s+/);
    return (from === invitePath || from === `${invitePath}/*`) && to === `${invitePath}/index.html` && status === '200';
  }),
  `the client mints ${BID_INVITE_URL_BASE} — rules present: ${redirects.join(' | ')}`);
ok('and that route is declared before the catch-all 404',
  redirects.findIndex(l => l.startsWith(invitePath)) < redirects.findIndex(l => l.startsWith('/*')),
  'Netlify takes the first matching rule');
ok('the page it points at exists', pageRaw.length > 0);
ok('the page still works for someone with JavaScript off',
  /<noscript>/.test(pageRaw) && /email your price/i.test(pageRaw),
  'every other failure on this page already looks like a withdrawn invitation; a blank one must not join them');

// ── K. expiry is an instant, not a calendar day ─────────────────────────────
// `expires_at` is timestamptz and the RPC compares it with now(). A calendar-day
// string would land at UTC midnight and lapse the link hours early for anyone
// west of Greenwich.
console.log('\nK. the expiry the client writes is the thing the RPC compares');
const expIso = inviteExpiryFrom(Date.parse('2026-03-06T23:00:00.000Z'));
eq('30 days is 30 x 86400s of instant, across a DST boundary', expIso, '2026-04-05T23:00:00.000Z');
ok('and it carries a time of day, not a bare date', /T\d{2}:\d{2}:\d{2}/.test(expIso), expIso);

// ── L. the invitation actually describes the work ───────────────────────────
// Screen audit 2026-09-16. `scope_description` was plumbed the whole way — the
// notify branch renders it, `bid_invite_get` returns it — and NOTHING wrote it
// for a package made by hand. `handleCreatePackage` passed name, phase, CSI,
// linked items and budget, and no scope. So the sub got an email headed
// "You're invited to bid on Plumbing rough-in", a CSI number and a button, and
// the landing page's own fallback copy then told him to email the contractor
// for his price — the phone call this feature exists to replace.
console.log('\nL. the sub is told what he is pricing');

const listSrc = stripComments(read(LIST));

// Executed. The formatter is the contract: quantities and units, never money.
const SAMPLE_ITEMS = [
  { name: '3/4" PEX supply', quantity: 420, unit: 'LF', unitPrice: 3.1, lineTotal: 1302 },
  { name: 'Fixture rough-in', quantity: 11, unit: 'EA', unitPrice: 240, lineTotal: 2640, isAllowance: true },
  { name: 'Trench and backfill', quantity: 0, unit: '', unitPrice: 0, lineTotal: 0 },
];
const scope = estimateItemsToScope(SAMPLE_ITEMS);
ok('every picked line item reaches the scope', /3\/4" PEX supply/.test(scope) && /Fixture rough-in/.test(scope) && /Trench and backfill/.test(scope), scope);
ok('with its quantity and unit', /420 LF/.test(scope) && /11 EA/.test(scope), scope);
ok('an item with no usable quantity is named without one rather than printed as "0"',
  /Trench and backfill(?! —)/.test(scope) && !/Trench and backfill — 0/.test(scope),
  '"— 0 EA" reads as "none of this work", which is a wrong fact rather than a missing one');
ok('allowance lines are flagged, because awarding firms them',
  /Fixture rough-in[^\n]*allowance/i.test(scope), scope);
// The same reason bid_invite_get withholds estimate_budget, applied line by
// line: the GC's own number in front of the people bidding against it anchors
// every bid just under it.
ok('and no price, total or markup travels with the scope',
  !/\$/.test(scope) && !/3\.1\b/.test(scope) && !/1302|2640|240\b/.test(scope), scope);
eq('nothing to say yields an empty scope, not a fabricated one', estimateItemsToScope([]), '');
eq('and canGenerateScope agrees with it', canGenerateScope([]), false);

ok('app/buyout.tsx writes the scope when the package is created',
  /estimateItemsToScope\(/.test(listSrc) && /scopeDescription:\s*seededScope/.test(listSrc),
  'a scope composed at SEND time would reach the email and never the sub-facing page, which reads bid_packages.scope_description server-side');

// A blocked control says why. Sending a scope-less invite is worse than not
// sending one: the sub is told to phone.
ok('the package screen can write and edit the scope',
  /updateBidPackage\(\s*pkg\.id,\s*\{\s*scopeDescription/.test(screenSrc));
const inviteOpeners = [...screenSrc.matchAll(/setShowInvite\(true\)/g)].length;
const scopeGuards = [...screenSrc.matchAll(/if\s*\(scopeText\)\s*setShowInvite\(true\)/g)].length;
ok('EVERY door into the invite sheet is gated on the scope existing',
  inviteOpeners > 0 && scopeGuards === inviteOpeners,
  `${inviteOpeners} openers, ${scopeGuards} gated — the coverage warning is a second door and must not walk around the check`);
ok('and the disabled button says what is missing and what unblocks it',
  /No scope written yet/.test(screenSrc) && /disabled=\{!scopeText\}/.test(screenSrc));
ok('the send path refuses a scope-less package even if a button slips through',
  /if\s*\(!scopeText\)/.test(screenSrc) && /No scope to send/.test(screenSrc));

// ── M. a date the GC can chase, on the field that has a writer ──────────────
// `BidPackage.dueDate` and `requiredByDate` both existed with NO writer
// anywhere in the repo, and the buyout list's OVERDUE badge compared
// `requiredByDate` — so the badge was unreachable code on the screen whose job
// is telling him which packages are late. The invite meanwhile offered the
// sub one date and it was the link's 30-day expiry.
console.log('\nM. bids due: one field, written and read by the same name');

const DUE_NOW = Date.parse('2026-03-10T09:00:00.000Z');
eq('a package due later today is not overdue', bidDueState('2026-03-10T23:30:00.000Z', DUE_NOW), 'due-today');
eq('yesterday is', bidDueState('2026-03-09T12:00:00.000Z', DUE_NOW), 'overdue');
eq('three days out reads as due soon', bidDueState('2026-03-13T12:00:00.000Z', DUE_NOW), 'due-soon');
eq('no date is no claim', bidDueState(undefined, DUE_NOW), 'none');
eq('and an unparseable one is no claim either', daysUntilDue('next Tuesday', DUE_NOW), null);

ok('the create sheet captures it', /dueDate:\s*newPkgDueDate/.test(listSrc),
  'this is the one thing here that needs new capture, and it is one field');
ok('and the overdue predicate reads dueDate through the shared function',
  /bidDueState\(p\.dueDate/.test(listSrc) && /bidDueState\(pkg\.dueDate/.test(listSrc));
ok('nothing on the buyout list reads requiredByDate as a fact',
  !/requiredByDate/.test(listSrc),
  'it has no writer, so a badge driven by it can never render — that was the bug');
ok('the package screen shows the date it chases from', /bidDueLabel\(/.test(screenSrc));

// Chasing. `bid_invite_submit` blocks a second submit per INVITE, not per
// bidder, so a "reminder" routed through the send path would hand one company
// two live tokens and therefore two rows in the levelling matrix.
const REM_NOW = Date.parse('2026-03-10T00:00:00.000Z');
const remindable = remindableInvites([
  { respondedAt: null, expiresAt: '2026-03-20T00:00:00.000Z' },
  { respondedAt: '2026-03-08T00:00:00.000Z', expiresAt: '2026-03-20T00:00:00.000Z' },
  { respondedAt: null, expiresAt: '2026-03-01T00:00:00.000Z' },
], REM_NOW);
eq('only the ones still waiting are chased', remindable.length, 1);
ok('a sub who already bid is not chased', !remindable.some(r => r.respondedAt));
ok('and an expired link is not re-sent — that token is dead and reads as a withdrawal',
  !remindable.some(r => r.expiresAt === '2026-03-01T00:00:00.000Z'));

const remindBody = clientSrc.slice(clientSrc.indexOf('export async function remindBidInvites'));
ok('utils/bidInvites.ts exposes a reminder', remindBody.length > 0);
ok('and it re-uses the invite\'s existing token rather than minting a second one',
  /bidInviteUrl\(inv\.inviteToken\)/.test(remindBody)
  && !/newInviteToken|supabaseWriteDetailed/.test(remindBody),
  'a second token lets one company file two bids, which the matrix shows as two competing subs');
ok('the screen chases through that path, not through sendBidInvites',
  /remindBidInvites\(/.test(screenSrc) && /remindableInvites\(/.test(screenSrc));

// ── N. the bid knows which sub it came from ─────────────────────────────────
// `bid.subcontractorId` was undefined for 100% of bids: the invite sheet was
// one free-text box and `sendBidInvites` set `subcontractor_id: null` on every
// row, the submit RPC copied that onto the bid, and `awardBidPackage` copied it
// again onto the commitment. Four things then failed silently — the award
// compliance lookup, the scorecard link, commitment attribution, and
// app/sub-portals.tsx (`if (!c.subcontractorId) continue`), which means the sub
// the GC just awarded $40k to could not be given a portal at all.
console.log('\nN. every bid arrives attached to a record, not just a name');

const ROSTER = [
  { id: 'sub-ace', companyName: 'Ace Mechanical', email: 'Joe@AceMech.com' },
  { id: 'sub-bpl', companyName: 'BPL Electric', email: 'maria@bpl-electric.com' },
  // Two records for the same outfit — a real roster grows these (an old entry
  // and a re-added one), and both matchers have to refuse rather than pick.
  { id: 'sub-dup', companyName: 'Dup Drywall', email: 'shared@dup.com' },
  { id: 'sub-dup2', companyName: 'Dup Drywall', email: 'shared@dup.com' },
];
const attached = attachRosterIds(
  [{ email: 'joe@acemech.com' }, { email: 'stranger@nowhere.com' }, { email: 'shared@dup.com' }],
  ROSTER,
);
eq('an address typed from memory is matched to the sub on file', attached[0].subcontractorId, 'sub-ace');
eq('and carries his company name into the invite greeting', attached[0].name, 'Ace Mechanical');
eq('a stranger stays a stranger — no guess', attached[1].subcontractorId, undefined);
eq('two subs sharing an address is a refusal, not a coin flip', attached[2].subcontractorId, undefined);

const INVITES = [{ bidId: 'bid-1', subEmail: 'maria@bpl-electric.com' }, { bidId: 'bid-2', subEmail: 'nobody@else.com' }];
eq('a bid filed through an invite is linked by the address the GC chose',
  resolveBidSubcontractor({ id: 'bid-1' }, INVITES, ROSTER)?.subId, 'sub-bpl');
eq('an invited address that is not on the roster stays unlinked',
  resolveBidSubcontractor({ id: 'bid-2', vendorName: 'Ace Mechanical' }, INVITES, ROSTER), null);
eq('a hand-typed bid matches on an exact, unique company name',
  resolveBidSubcontractor({ id: 'bid-9', vendorName: 'ace mechanical' }, [], ROSTER)?.subId, 'sub-ace');
eq('and refuses when two companies carry that name',
  resolveBidSubcontractor({ id: 'bid-9', vendorName: 'Dup Drywall' }, [], ROSTER), null);
ok('a link always carries the sentence explaining it',
  (resolveBidSubcontractor({ id: 'bid-1' }, INVITES, ROSTER)?.reason ?? '').length > 20,
  'a join key the app fills in silently is how the wrong sub ends up on a signed subcontract');

ok('the id rides PER RECIPIENT through sendBidInvites',
  /subcontractorId:\s*r\.subcontractorId/.test(clientSrc),
  'it used to sit on the shared base, where nothing ever set it');
ok('and the invite row is written with it', /subcontractor_id:\s*args\.subcontractorId/.test(clientSrc));
ok('the invite sheet can see the roster and picks carry their id',
  /pickedSubIds/.test(screenSrc) && /subcontractorId:\s*s\.id/.test(screenSrc));
ok('a typed address that matches a sub on file is attached automatically',
  /attachRosterIds\(/.test(screenSrc));
ok('bids already in the matrix are recovered from the invite that produced them',
  /resolveBidSubcontractor\(/.test(screenSrc) && /updateBidPackageBid\([^)]*subcontractorId/.test(screenSrc));
ok('and the ones that cannot be resolved get a control instead of a shrug',
  /setLinkTargetBidId\(/.test(screenSrc) && /Link this bid to a sub/.test(screenSrc));

// The gate has to stay readable. It pushed a blocker for ANY bid with no
// prequal packet, and prequal_packets is empty in production, so every award
// went through the red "Award & accept risk" screen — which a GC stops reading
// in a month, and that is when the genuinely lapsed COI goes through.
const awardBody = screenSrc.slice(screenSrc.indexOf('const handleAward'), screenSrc.indexOf('const handleGenerateSubcontract'));
ok('the award gate reads the COI/licence dates the app actually keeps',
  /getComplianceStatus\(/.test(awardBody));
ok('a missing prequal packet on a compliant sub is a NOTE, not a blocker',
  /notes\.push\([^)]*No prequal packet/.test(awardBody)
  && !/blockers\.push\([^)]*No prequal packet/.test(awardBody),
  'the destructive double-confirm is reserved for an expired or absent COI/licence');
ok('an expired document IS a blocker', /blockers\.push\([^)]*expired/.test(awardBody));
ok('and an unlinked bid is a blocker with a one-tap fix rather than a dead sentence',
  /Pick the sub/.test(awardBody));

console.log(`\n${fail === 0 ? `bid invite: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
