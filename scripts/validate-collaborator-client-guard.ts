// validate-collaborator-client-guard.ts — the job's CLIENT can never be
// invited as a collaborator, in any role (Phase 0, lane B).
//
// WHY. A project_collaborators seat, even 'viewer', reads the job's costs by
// design (project-invite ROLE_LINE: "including its costs";
// 20260826140000_project_financials_split.sql), and 'field' reads the crew's
// daily reports and hours. So a GC who typed his homeowner's address into
// "Invite a collaborator" handed him margins, labour and markup. The client's
// door is the client portal, which shows only what the GC switches on.
//
// What this pins:
//   1. project-invite's pure matcher (run for real, extracted between the
//      CLIENT-GUARD markers) finds the client in all three places the job
//      records one — primary_contact.email, client_portal.invites[].email,
//      invoices.bill_to_email — trimmed, case-insensitive, multi-address
//      fields split; and does NOT match a real teammate or sub.
//   2. the refusal is 200 + { success:false, code:'is_client' } (invoke()
//      drops a non-2xx body) and carries the phrase the screen recognises.
//   3. in `invite`, the check runs after the ownership check and BEFORE the
//      already-member return, the seat check, the upsert and the email; a
//      failed lookup refuses (fail closed) instead of falling through.
//   4. `changeRole` cannot promote a (pre-guard) client row into a cost role.
//   4b. `accept` and `acceptPending` re-check right before markAccepted, so
//      inviting the homeowner FIRST and recording him as the client AFTER
//      does not get him a seat (review round 1).
//   5. CollaboratorsManager refuses first on the device, with the reason in
//      plain words, points to the client portal, dims Send, and recognises
//      a server refusal it could not foresee.
//
// Run via: bun run scripts/validate-collaborator-client-guard.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs under bun, but tsc checks scripts against the app's lib set, which has
// no Bun global — the one API used is declared (validate-ai-failure-copy does
// the same) rather than pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const fnRaw = raw('supabase', 'functions', 'project-invite', 'index.ts');
const fn = strip(fnRaw);
const uiRaw = raw('components', 'collaborators', 'CollaboratorsManager.tsx');
const ui = strip(uiRaw);

// ── 1. the matcher, run for real ─────────────────────────────────────────────
console.log('\nproject-invite finds the client in all three places (run for real):');
const begin = fnRaw.indexOf('// CLIENT-GUARD:BEGIN');
const end = fnRaw.indexOf('// CLIENT-GUARD:END');
ok('the CLIENT-GUARD block exists', begin !== -1 && end > begin);

type Source = 'primary_contact' | 'portal_invite' | 'bill_to' | null;
type Matcher = (email: string, project: { primary_contact?: unknown; client_portal?: unknown } | null, billTo: unknown[]) => Source;
type Refusal = (email: string, source: Exclude<Source, null>) => { success: boolean; code: string; source: string; error: string };
let clientEmailSource: Matcher = () => null;
let clientRefusal: Refusal = () => ({ success: true, code: '', source: '', error: '' });
let serverEmailsIn: (v: unknown) => string[] = () => [];
if (begin !== -1 && end > begin) {
  const block = fnRaw.slice(begin, end);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    `${block}\nmodule.exports = { clientEmailSource, clientRefusal, emailsIn };`,
  );
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  clientEmailSource = mod.exports.clientEmailSource as Matcher;
  clientRefusal = mod.exports.clientRefusal as Refusal;
  serverEmailsIn = mod.exports.emailsIn as (v: unknown) => string[];
}

const project = {
  primary_contact: { name: 'Dana Homeowner', email: '  Dana.Home@Example.com ' },
  client_portal: {
    enabled: true,
    invites: [
      { id: 'i1', name: 'Spouse', email: 'SPOUSE@example.com', status: 'pending' },
      null,
      { id: 'i2', name: 'no email' },
    ],
  },
};
const billTo = ['accounts@owner-llc.com, cfo@owner-llc.com', null, 42];

expect('primary contact, any case and spacing', clientEmailSource('dana.home@example.com', project, billTo), 'primary_contact');
expect('…typed with capitals and spaces too', clientEmailSource('  DANA.HOME@EXAMPLE.COM ', project, billTo), 'primary_contact');
expect('a client-portal invitee', clientEmailSource('spouse@example.com', project, billTo), 'portal_invite');
expect("an invoice's bill-to", clientEmailSource('accounts@owner-llc.com', project, billTo), 'bill_to');
expect('…including the second address in a multi-address bill-to', clientEmailSource('cfo@owner-llc.com', project, billTo), 'bill_to');
expect('a real teammate is NOT the client', clientEmailSource('super@mybuild.co', project, billTo), null);
expect('a sub is NOT the client', clientEmailSource('sparky@electric.com', project, billTo), null);
expect('a near-miss address is not a match (no substring matching)', clientEmailSource('home@example.com', project, billTo), null);
expect('no project row → only bill-to decides', clientEmailSource('cfo@owner-llc.com', null, billTo), 'bill_to');
expect('empty email never matches', clientEmailSource('', project, billTo), null);
expect('junk shapes do not throw or match',
  clientEmailSource('x@y.com', { primary_contact: 'x@y.com-as-string', client_portal: { invites: 'nope' } }, []), null);
expect('a display-name form "Dana <dana@x.com>" is still the client',
  clientEmailSource('dana@x.com', { primary_contact: { email: 'Dana <dana@x.com>' } }, []), 'primary_contact');
expect('…and a quoted / parenthesised bill-to too',
  clientEmailSource('ap@owner.com', null, ['"Owner LLC" (ap@owner.com)']), 'bill_to');
expect('a job with no client recorded refuses nobody', clientEmailSource('dana.home@example.com', { primary_contact: null, client_portal: null }, []), null);

// ── 2. the refusal ───────────────────────────────────────────────────────────
console.log('\nthe refusal is 200 + is_client, in plain words:');
const r = clientRefusal('dana.home@example.com', 'primary_contact');
expect('success:false, code is_client', { s: r.success, c: r.code }, { s: false, c: 'is_client' });
ok('it names the address and why', r.error.startsWith('dana.home@example.com is the client contact on this job'));
ok('it says what a collaborator sees', /costs, margins and labour/.test(r.error));
ok('it points to the client portal', /Share the client portal/.test(r.error));
ok('each source has its own line', new Set((['primary_contact', 'portal_invite', 'bill_to'] as const)
  .map((s) => clientRefusal('a@b.co', s).error)).size === 3);
const phrase = /const CLIENT_REFUSAL_PHRASE = "([^"]+)"/.exec(uiRaw)?.[1] ?? '';
ok('the screen recognises the server sentence by a phrase it really contains',
  phrase.length > 10 && (['primary_contact', 'portal_invite', 'bill_to'] as const).every((s) => clientRefusal('a@b.co', s).error.includes(phrase)),
  `phrase "${phrase}"`);

// ── 3. where the check runs in `invite` ──────────────────────────────────────
console.log('\nproject-invite `invite` refuses the client before anything is written:');
const inv = fn.slice(fn.indexOf('if (action === "invite")'), fn.indexOf('if (action === "getLink")'));
const ownAt = inv.indexOf('callerOwnsProject(');
const ctxAt = inv.indexOf('projectClientContext(projectId)');
const matchAt = inv.indexOf('clientEmailSource(email,');
const refuseAt = inv.search(/if \(source\) return json\(clientRefusal\(email, source\)\);/);
const memberAt = inv.indexOf('existing?.status === "accepted"');
const seatAt = inv.indexOf('seatCheck(');
const upsertAt = inv.indexOf('on_conflict=project_id,invited_email');
const mailAt = inv.indexOf('sendInviteEmail(');
ok('the ownership check runs first', ownAt !== -1 && ownAt < ctxAt, `own ${ownAt} ctx ${ctxAt}`);
ok('the client lookup and match run in invite', ctxAt !== -1 && matchAt > ctxAt);
ok('a match returns the refusal with no error status (200)', refuseAt > matchAt);
ok('…before the already-member return, the seat check, the upsert and the email',
  refuseAt !== -1 && refuseAt < memberAt && refuseAt < seatAt && refuseAt < upsertAt && refuseAt < mailAt,
  `refuse ${refuseAt} member ${memberAt} seat ${seatAt} upsert ${upsertAt} mail ${mailAt}`);
ok('a failed lookup refuses (fail closed), it does not fall through',
  /if \(!ctx\.ok\) return json\(\{ error: `Could not check who the client on this job is/.test(inv.slice(ctxAt, matchAt)));
// EVERY role is refused: nothing between the ownership refusal and the client
// refusal may branch on anything but the lookup result and the match. A gate
// written as `if (isBillableRole(role)) {`, `if (flag) {`, or a ternary on the
// match all show up here (review round 1, mutations M1/M2).
const guardFrom = inv.indexOf('Only the project owner can invite collaborators');
const guardTo = inv.indexOf('if (source) return json(clientRefusal(email, source));');
const guard = guardFrom !== -1 && guardTo > guardFrom ? inv.slice(guardFrom, guardTo) : '';
ok('the client guard slice exists', guard.length > 0);
ok('the check is not gated on the role (every role is refused)',
  guard.length > 0 && !/\brole\b|isBillableRole|\?|&&|\|\|/.test(guard), JSON.stringify(guard));
ok('…its only branch is the fail-closed lookup (no other `if` wraps it)',
  guard.length > 0 && (guard.match(/\bif \(/g) ?? []).length === 1 && /\bif \(!ctx\.ok\)/.test(guard), JSON.stringify(guard));
ok('…and the match is computed unconditionally, exactly',
  /\n\s*const source = clientEmailSource\(email, ctx\.project, ctx\.billTo\);\n/.test(guard + '\n'));
ok('a teammate still reaches the upsert (the refusal is conditional)',
  /if \(source\) return/.test(inv) && upsertAt > refuseAt);

const ctxFn = fn.slice(fn.indexOf('async function projectClientContext('), fn.indexOf('serve(async'));
ok('the lookup reads primary_contact and client_portal of THIS project',
  /projects\?id=eq\.\$\{encodeURIComponent\(projectId\)\}&select=primary_contact,client_portal/.test(ctxFn));
ok("…and this project's invoice bill-to addresses",
  /invoices\?project_id=eq\.\$\{encodeURIComponent\(projectId\)\}[^`]*select=bill_to_email/.test(ctxFn));
ok('…and reports a failed read instead of an empty answer',
  (ctxFn.match(/if \(!\w+\.ok\) return \{ ok: false/g) ?? []).length === 2);

// ── 4. changeRole ────────────────────────────────────────────────────────────
console.log('\nchangeRole cannot promote a client into a cost role:');
const cr = fn.slice(fn.indexOf('if (action === "changeRole")'));
const crMatch = cr.indexOf('clientEmailSource(target.invited_email');
const crPatch = cr.indexOf('method: "PATCH"');
ok('the client check runs before the role PATCH', crMatch !== -1 && crMatch < crPatch);
ok('…inside the promotion-to-a-cost-role branch', cr.indexOf('if (isBillableRole(role))') < crMatch);
ok('…and refuses with the same 200 answer', /if \(source\) return json\(clientRefusal\(target\.invited_email, source\)\);/.test(cr));
// Fail closed (integration review): with the roster read failed, `target` was
// undefined, both checks were skipped and the PATCH promoted the row anyway.
{
  const promo = cr.slice(cr.indexOf('if (isBillableRole(role))'), crPatch);
  const failAt = promo.indexOf('if (!cur.ok) return json({ error: `Could not check this seat (${cur.status}). Try again.` }, 502);');
  ok('a failed roster read refuses with 502 before any check or the PATCH',
    failAt !== -1 && failAt < promo.indexOf('clientEmailSource(') && failAt < promo.indexOf('seatCheck('));
  ok('…the row is read only after that (no `cur.ok ? … : []` fallback to an empty roster)',
    !/cur\.ok \?/.test(promo));
  ok('…a missing row and a missing project id refuse too',
    /if \(!target\) return json\([^;]*404\);/.test(promo) && /if \(!own\.projectId\) return json\([^;]*502\);/.test(promo));
  ok('…and neither the client check nor the seat check is gated on `target &&` any more',
    !/if \(target &&/.test(promo));
}

// ── 4b. accept / acceptPending ──────────────────────────────────────────────
console.log('\naccepting a seat re-checks the client (invite first, client later):');
const closedFn = fn.slice(fn.indexOf('async function clientSeatClosed('), fn.indexOf('serve(async'));
ok('clientSeatClosed reads this job\'s client context', /const ctx = await projectClientContext\(projectId\);/.test(closedFn));
ok('…fails closed on a failed lookup', /if \(!ctx\.ok\) return json\(\{ error: `[^`]*` \}, 502\);/.test(closedFn));
ok('…lets the seat through only when the invited address is not the client',
  /if \(!clientEmailSource\(invitedEmail, ctx\.project, ctx\.billTo\)\) return null;/.test(closedFn));
ok('…and otherwise answers 200 + is_client in words the invitee can act on',
  /return json\(\{\s*success: false,\s*code: "is_client",/.test(closedFn) && /client portal link/.test(closedFn)
  && !/json\(\{[\s\S]*is_client[\s\S]*\},\s*\d{3}\)/.test(closedFn));
for (const [label, from, to] of [
  ['accept', 'if (action === "accept")', 'if (action === "listPending")'],
  ['acceptPending', 'if (action === "acceptPending")', 'if (action === "revoke")'],
] as const) {
  const body = fn.slice(fn.indexOf(from), fn.indexOf(to));
  const emailAt = body.indexOf('!== caller.email');
  const closedAt = body.indexOf('const closed = await clientSeatClosed(row.project_id, row.invited_email);');
  const retAt = body.indexOf('if (closed) return closed;');
  const markAt = body.indexOf('markAccepted(');
  ok(`${label}: the client re-check runs after the email match and before markAccepted`,
    emailAt !== -1 && closedAt > emailAt && retAt > closedAt && markAt > retAt,
    `email ${emailAt} closed ${closedAt} ret ${retAt} mark ${markAt}`);
  // Ungated: it sits at the action block's own level (4 spaces, like
  // markAccepted), straight after the email-mismatch block closes, and only
  // `if (closed) return closed;` stands between it and markAccepted.
  const prevLine = body.slice(0, closedAt).trimEnd().split('\n').pop()?.trim() ?? '';
  ok(`${label}: nothing gates the re-check`,
    closedAt !== -1 && prevLine === '}' && /\n {4}const closed = await clientSeatClosed/.test(body)
    && /\n {4}const accepted = await markAccepted/.test(body)
    && body.slice(closedAt, markAt).replace(/\s+/g, ' ').trim()
      === 'const closed = await clientSeatClosed(row.project_id, row.invited_email); if (closed) return closed; const accepted = await',
    `prev line "${prevLine}"`);
}

// ── 5. the screen ────────────────────────────────────────────────────────────
console.log('\nCollaboratorsManager says why and points to the portal:');
const uiEmailsBody = /function emailsIn\(v: unknown\): string\[\] \{([\s\S]*?)\n\}/.exec(ui)?.[1] ?? '';
let uiEmailsIn: (v: unknown) => string[] = () => [];
if (uiEmailsBody) {
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`function emailsIn(v) {${uiEmailsBody}\n}\nmodule.exports = { emailsIn };`);
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  uiEmailsIn = mod.exports.emailsIn as (v: unknown) => string[];
}
for (const sample of [' A@B.co ', 'a@b.co, C@d.com;e@f.io', 'not an email', null, 'x@y.com\ny@z.com', 'Dana <Dana@X.com>', '"Owner" (ap@o.com)', "'q@r.io'"]) {
  expect(`device and server split ${JSON.stringify(sample)} the same way`, uiEmailsIn(sample), serverEmailsIn(sample));
}
const memo = ui.slice(ui.indexOf('const clientSourceFor = useCallback'), ui.indexOf('const clientReason'));
ok('the device checks the primary contact', /project\?\.primaryContact\?\.email/.test(memo));
ok('…the client-portal invites', /project\?\.clientPortal\?\.invites/.test(memo));
ok("…and this job's invoices' bill-to", /getInvoicesForProject\(projectId\)[\s\S]*billToEmail/.test(memo));
const onInvite = ui.slice(ui.indexOf('const onInvite = useCallback'), ui.indexOf('const requestRoleChange'));
const clientStop = onInvite.indexOf('if (clientReason) { showAlert(');
ok('onInvite stops on the client before the paywall, the seat dialog and the send',
  clientStop !== -1 && clientStop < onInvite.indexOf("router.push('/paywall')") && clientStop < onInvite.indexOf('invite.mutate('));
ok('Send is dimmed while the address is the client, and its hint is the reason',
  /\(!validEmail \|\| invite\.isPending \|\| !!inviteBlocked \|\| !!clientReason\) && \{ opacity: 0\.5 \}/.test(ui)
  && /accessibilityHint=\{inviteBlocked \?\? clientReason \?\? undefined\}/.test(ui));
ok('the reason is on screen, not only in a dialog', /testID="collab-client-refused"/.test(ui) && /\{clientReason\}<\/Text>/.test(ui));
ok('a server refusal the device could not foresee is recognised by the phrase',
  /\(invite\.error as Error\)\?\.message \?\? ''\)\.includes\(CLIENT_REFUSAL_PHRASE\)/.test(ui));
ok('both cases lead to the client portal',
  /\(clientReason \|\| serverClientRefusal\) \?/.test(ui) && /Open the client portal/.test(ui) && /Client Portal tile/.test(ui));
ok('editing the address clears a stale server refusal (it was about the address sent)',
  /onChangeText=\{onEmailChange\}/.test(ui)
  && /const onEmailChange = useCallback\(\(next: string\) => \{\s*if \(invite\.isError\) invite\.reset\(\);\s*setEmail\(next\);/.test(ui));
ok('the device copy matches the server copy for every source',
  /is the client contact on this job/.test(ui) && /is invited to this job's client portal/.test(ui)
  && /is the address this job's invoices are billed to/.test(ui)
  && ui.includes("Collaborators can see the job's costs, margins and labour, so a client can't be added here in any role. Share the client portal with them instead: it shows only the sections you switch on."));

// ── 6. a seat taken before the address became the client ─────────────────────
// The server guard runs at invite, accept and promotion only. Invite the
// homeowner, THEN add him to the portal or an invoice, and his accepted seat
// still reads costs. The roster runs the same matcher over every listed row.
console.log('\nthe roster flags a seat that belongs to the job\'s client:');
{
  ok('one matcher serves the typed address and the roster rows',
    /const clientSourceFor = useCallback\(\(address: string\)/.test(ui)
    && /const clientSource = useMemo\(\(\) => clientSourceFor\(email\)/.test(ui));
  const seatsMemo = ui.slice(ui.indexOf('const clientSeats = useMemo'), ui.indexOf('}, [collaborators, clientSourceFor]);'));
  ok('every listed row (pending or accepted, not the owner) is checked',
    /for \(const c of collaborators\)/.test(seatsMemo) && /if \(c\.role === 'owner'\) continue;/.test(seatsMemo)
    && !/status/.test(seatsMemo));
  const rowBlock = ui.slice(ui.indexOf('collaborators.map((c) => ('));
  ok('a flagged row says why, on screen, with the same source line',
    /isOwner && clientSeats\.has\(c\.id\)/.test(rowBlock) && /testID=\{`collab-client-seat-\$\{c\.id\}`\}/.test(rowBlock)
    && /CLIENT_SOURCE_LINES\[clientSeats\.get\(c\.id\)!\]/.test(rowBlock));
  ok('…and offers Remove through the confirming revoke flow',
    /onPress=\{\(\) => requestRevoke\(c\)\}[\s\S]{0,120}testID=\{`collab-client-seat-remove-\$\{c\.id\}`\}/.test(rowBlock));
}

// ── 7. the invitee's screen: 'is_client' is final ───────────────────────────
console.log('\naccept-invite treats is_client as final:');
{
  const ai = strip(raw('app', 'accept-invite.tsx'));
  const retryBody = /function canRetryInvite\(errCode: string \| null\): boolean \{([\s\S]*?)\n\}/.exec(ai)?.[1] ?? '';
  let canRetry: (c: string | null) => boolean = () => true;
  if (retryBody) {
    const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`function canRetryInvite(errCode) {${retryBody}\n}\nmodule.exports = { canRetryInvite };`);
    const mod: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', js)(mod, mod.exports);
    canRetry = mod.exports.canRetryInvite as (c: string | null) => boolean;
  }
  ok('no "Try again" on is_client (it can never work)', canRetry('is_client') === false);
  ok('…while a transient failure still offers it', canRetry(null) === true && canRetry('network') === true);
  ok('the pending token is dropped on is_client (no replay on the next visit)',
    /if \(code === 'invalid_or_used' \|\| code === 'is_client'\) await AsyncStorage\.removeItem\(PENDING_KEY\);/.test(ai));
  ok('…and cleared off the account through the final-answer path',
    /if \(!canRetryInvite\(code\)\) void clearInviteToken\(token\);/.test(ai));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
