// scripts/validate-notify-authz.ts — unit tests for the pure authorization
// pieces of the `notify` edge function (supabase/functions/_shared/notifyGuards.ts)
// plus structural pins on notify / invoice-dunning / portal-link-expiry-notice
// and on the trigger-credential migration. Audit 2026-09-03 EDGE-F3/F4/F5/F6/F15.
//
// The edge function is I/O-bound (GoTrue, PostgREST, Resend, Expo), so the
// rules that decide WHO may notify WHOM live in a dependency-free module and
// are exercised here under bun; the pins below make sure notify actually calls
// them and that the dead-link / leaky-error patterns the audit found do not
// come back.
//
// Run via: bun run scripts/validate-notify-authz.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ANON_ALLOWED_EVENTS,
  ANON_HOURLY_CAP,
  CROSS_TENANT_EVENTS,
  MAX_BODY_BYTES,
  MAX_RECIPIENTS,
  RFP_EVENTS,
  USER_HOURLY_CAP,
  capRecipients,
  clientIpFrom,
  exceedsBodyLimit,
  isUuid,
  trustedSubPortalId,
  userMayAddress,
} from '../supabase/functions/_shared/notifyGuards';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = ''): void {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n    ${extra}` : ''); }
}
const read = (rel: string): string => { try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return ''; } };
const headers = (h: Record<string, string>) => ({ get: (n: string): string | null => h[n.toLowerCase()] ?? null });

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

// ── 1. constants the function is built around ───────────────────────────────
console.log('\nnotifyGuards — constants:');
ok('recipient cap is 50', MAX_RECIPIENTS === 50);
ok('body cap is 64 KB', MAX_BODY_BYTES === 64 * 1024);
ok('anon bucket is tighter than the user bucket', ANON_HOURLY_CAP < USER_HOURLY_CAP);
ok('rfp_awarded and nearby_rfp_posted are service-only', CROSS_TENANT_EVENTS.has('rfp_awarded') && CROSS_TENANT_EVENTS.has('nearby_rfp_posted'));
ok('anon may raise the two portal-page events', ANON_ALLOWED_EVENTS.has('contract_signed') && ANON_ALLOWED_EVENTS.has('selection_chosen'));
for (const evt of ['bid_question_asked', 'bid_question_answered', 'closeout_binder_sent', 'portal_message', 'co_approval', 'rfp_awarded', 'nearby_rfp_posted']) {
  ok(`anon may NOT raise ${evt}`, !ANON_ALLOWED_EVENTS.has(evt), 'these carried caller-chosen recipients or address another tenant (EDGE-F4/F5)');
}
ok('RFP events are the two Q&A events', RFP_EVENTS.has('bid_question_asked') && RFP_EVENTS.has('bid_question_answered') && RFP_EVENTS.size === 2);
ok('no event is both anon-allowed and cross-tenant', [...ANON_ALLOWED_EVENTS].every((e) => !CROSS_TENANT_EVENTS.has(e)));

// ── 2. isUuid ───────────────────────────────────────────────────────────────
console.log('\nisUuid:');
ok('accepts a canonical uuid', isUuid(A));
ok('accepts upper-case hex', isUuid(A.toUpperCase()));
ok('rejects a PostgREST filter injection', !isUuid(`${A}&select=*`));
ok('rejects non-strings', !isUuid(42) && !isUuid(null) && !isUuid(undefined) && !isUuid({}));
ok('rejects a bare 32-hex string', !isUuid(A.replace(/-/g, '')));

// ── 3. clientIpFrom — EDGE-F15 ──────────────────────────────────────────────
console.log('\nclientIpFrom:');
ok('cf-connecting-ip wins', clientIpFrom(headers({ 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })) === '9.9.9.9');
ok('x-real-ip is only a fallback — the proxy-appended xff hop outranks it', clientIpFrom(headers({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })) === '2.2.2.2');
ok('x-real-ip is used when there is no x-forwarded-for at all', clientIpFrom(headers({ 'x-real-ip': '8.8.8.8' })) === '8.8.8.8');
ok('a client-supplied x-real-ip cannot pick the bucket when a proxy appended a hop', clientIpFrom(headers({ 'x-real-ip': 'chosen', 'x-forwarded-for': 'also-chosen, 7.7.7.7' })) === '7.7.7.7');
ok('takes the LAST x-forwarded-for hop (the proxy-appended one)', clientIpFrom(headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' })) === '3.3.3.3');
ok('a spoofed first hop does not change the key', clientIpFrom(headers({ 'x-forwarded-for': 'evil, 3.3.3.3' })) === clientIpFrom(headers({ 'x-forwarded-for': '3.3.3.3' })));
ok('trims whitespace and empty hops', clientIpFrom(headers({ 'x-forwarded-for': ' 1.1.1.1 , 2.2.2.2 , ' })) === '2.2.2.2');
ok('single hop works', clientIpFrom(headers({ 'x-forwarded-for': '5.5.5.5' })) === '5.5.5.5');
ok('no headers → "unknown" (still a bucket, never a crash)', clientIpFrom(headers({})) === 'unknown');
ok('blank proxied header falls through to x-forwarded-for', clientIpFrom(headers({ 'cf-connecting-ip': '  ', 'x-forwarded-for': '4.4.4.4' })) === '4.4.4.4');

// ── 4. capRecipients / exceedsBodyLimit — EDGE-F4 ───────────────────────────
console.log('\ncapRecipients / exceedsBodyLimit:');
const sixty = Array.from({ length: 60 }, (_, i) => ({ email: `b${i}@x.test` }));
ok('60 recipients are cut to 50', capRecipients(sixty).length === MAX_RECIPIENTS);
ok('keeps the first 50 (deterministic)', capRecipients<{ email: string }>(sixty)[49].email === 'b49@x.test');
ok('short lists pass through', capRecipients([1, 2, 3]).length === 3);
ok('a non-array becomes []', capRecipients('not a list').length === 0 && capRecipients(null).length === 0 && capRecipients(undefined).length === 0 && capRecipients({ length: 5 }).length === 0);
ok('a custom cap is honoured', capRecipients(sixty, 3).length === 3);
ok('a negative cap yields []', capRecipients(sixty, -1).length === 0);
ok('64 KB exactly is allowed', !exceedsBodyLimit(MAX_BODY_BYTES));
ok('64 KB + 1 is refused', exceedsBodyLimit(MAX_BODY_BYTES + 1));
ok('NaN / Infinity are refused', exceedsBodyLimit(Number.NaN) && exceedsBodyLimit(Number.POSITIVE_INFINITY));
ok('0 bytes is allowed (the JSON check catches it)', !exceedsBodyLimit(0));

// ── 5. userMayAddress — EDGE-F4 ─────────────────────────────────────────────
console.log('\nuserMayAddress:');
ok('self, no project → allowed', userMayAddress({ callerId: A, gcUserId: A, projectOwnerId: null, isProjectMember: false }));
ok('someone else, no project → refused', !userMayAddress({ callerId: A, gcUserId: B, projectOwnerId: null, isProjectMember: false }));
ok('owner addressing themselves on their project → allowed', userMayAddress({ callerId: A, gcUserId: A, projectOwnerId: A, isProjectMember: true }));
ok('collaborator addressing the owner on a shared project → allowed', userMayAddress({ callerId: B, gcUserId: A, projectOwnerId: A, isProjectMember: true }));
ok('collaborator addressing themselves on a shared project → allowed', userMayAddress({ callerId: B, gcUserId: B, projectOwnerId: A, isProjectMember: true }));
ok('member addressing a THIRD user on the project → refused', !userMayAddress({ callerId: B, gcUserId: C, projectOwnerId: A, isProjectMember: true }));
ok('non-member naming themselves as GC on someone else\'s project → refused (portal token would leak)', !userMayAddress({ callerId: B, gcUserId: B, projectOwnerId: A, isProjectMember: false }));
ok('non-member addressing the owner → refused', !userMayAddress({ callerId: B, gcUserId: A, projectOwnerId: A, isProjectMember: false }));
ok('no caller id → refused', !userMayAddress({ callerId: '', gcUserId: A, projectOwnerId: null, isProjectMember: true }));
ok('no resolved GC → refused', !userMayAddress({ callerId: A, gcUserId: null, projectOwnerId: A, isProjectMember: true }));

// ── 5b. trustedSubPortalId — review 2026-09-04 blocking 1 ───────────────────
// sub_portal_id steers subPortalUrlFor() → the sub's ?t= token lands in the
// sub_invoice_reviewed CTA. A user JWT with gc_user_id = self and a victim's
// link id resolved no project, passed userMayAddress and got the token mailed.
console.log('\ntrustedSubPortalId:');
ok('service caller (fire_notify trigger / service key) may name a sub-portal link', trustedSubPortalId({ kind: 'service' }, ' link-1 ') === 'link-1');
ok('user caller never may — even when addressing themselves', trustedSubPortalId({ kind: 'user', id: A }, 'link-1') === null);
ok('anon caller never may', trustedSubPortalId({ kind: 'anon' }, 'link-1') === null);
ok('blank / non-string ids are dropped even for service', trustedSubPortalId({ kind: 'service' }, '   ') === null && trustedSubPortalId({ kind: 'service' }, 42) === null && trustedSubPortalId({ kind: 'service' }, undefined) === null);

// ── 6. notify/index.ts — the function actually uses the rules ───────────────
console.log('\nnotify/index.ts pins:');
const notify = read('supabase/functions/notify/index.ts');
ok('notify loaded', notify.length > 0);
ok('imports isValidCron (EDGE-F3)', /import \{ isValidCron \} from "\.\.\/_shared\/cronAuth\.ts"/.test(notify));
ok('a valid cron secret is a privileged (service) caller', /await isValidCron\(req\)/.test(notify) && /caller = \{ kind: 'service' \}/.test(notify));
ok('service-role key is still privileged', /isServiceRoleToken\(bearer\)/.test(notify) && /isServiceRoleToken\(apikey\)/.test(notify));
ok('user JWTs are GoTrue-verified, never decoded', /await verifyUser\(req\)/.test(notify) && !/decodeJwt|jwtHasRole/.test(notify));
ok('imports the guards module', /from "\.\.\/_shared\/notifyGuards\.ts"/.test(notify));
ok('no local ANON_ALLOWED_EVENTS definition (single source in notifyGuards)', !/const ANON_ALLOWED_EVENTS\s*=/.test(notify));
ok('cross-tenant events are refused for non-service callers with 403', /CROSS_TENANT_EVENTS\.has\(event\)/.test(notify) && /reason: 'cross_tenant_event'[^}]*httpStatus: 403/.test(notify));
ok('user callers get 403 not_your_project', /reason: 'not_your_project'[^}]*httpStatus: 403/.test(notify));
ok('authorization goes through userMayAddress', /userMayAddress\(\{/.test(notify));
ok('accepted collaborators count as members', /isAcceptedCollaborator\(/.test(notify) && /project_collaborators\?project_id=eq\./.test(notify));
ok('bidder fan-out is resolved server-side from bid_responses', /resolveBidders\(/.test(notify) && /bid_responses\?bid_id=eq\./.test(notify));
ok('only the RFP poster may answer (user path)', /rfp\.user_id !== caller\.id/.test(notify));
ok('caller-supplied bidder_recipients are stripped for non-service callers', /delete payload\.bidder_recipients/.test(notify));
ok('bidder list is capped with capRecipients', /capRecipients<BidderRecipient>\(payload\.bidder_recipients\)/.test(notify));
ok('body is bounded before JSON.parse (413)', /exceedsBodyLimit\(/.test(notify) && /payload_too_large/.test(notify) && /413/.test(notify));
ok('rate-limits verified users per caller', /exceedsRateLimit\(`notify:user:\$\{caller\.id\}`, USER_HOURLY_CAP\)/.test(notify));
ok('anon path is bucketed by the RESOLVED GC', /exceedsRateLimit\(`notify:gc:\$\{gcUserId\}`, ANON_HOURLY_CAP\)/.test(notify));
ok('anon path is bucketed by client IP', /exceedsRateLimit\(`notify:ip:\$\{clientIp\}`, ANON_HOURLY_CAP\)/.test(notify));
ok('client IP comes from clientIpFrom (last hop / proxy header)', /clientIpFrom\(req\.headers\)/.test(notify) && !/split\(','\)\[0\]/.test(notify));
ok('legacy per-portal bucket is kept', /exceedsRateLimit\(`portal:\$\{portalId\}`, ANON_HOURLY_CAP\)/.test(notify));
ok('anon callers without even the anon key get 401', /reason: 'event_not_anon_allowed'/.test(notify) && /error: 'unauthorized' \}, 401\)/.test(notify));
ok('portal CTA URLs come from portalUrlFor', /import \{ portalUrlFor, subPortalUrlFor, APP_BASE \} from "\.\.\/_shared\/portalLinks\.ts"/.test(notify) && /portalUrlFor\(projectCtx\.client_portal\)/.test(notify));
ok('sub-portal CTA URL comes from subPortalUrlFor', /subPortalUrlFor\(link\)/.test(notify));
ok('no token-less /portal/<id> literal remains', !/mageid\.app\/portal/.test(notify) && !/PORTAL_BASE\}\/\$\{portalId\}/.test(notify));
ok('project lookup selects client_portal (and user_id for ownership)', /select=id,name,location,user_id,client_portal/.test(notify));
ok('portal-first project lookup (no project/portal mismatch)', /projects\?client_portal->>portalId=eq\./.test(notify));
ok('secondary portal CTAs render only when a tokenized URL exists', (notify.match(/secondaryCta: portalUrl \?/g) ?? []).length >= 4 && !/secondaryCta: portalId \?/.test(notify));
ok('error responses never echo String(e)', !/jsonResponse\([^)]*String\(e\)/.test(notify) && /error: 'notify_failed' \}, 500\)/.test(notify));
ok('failure detail is still logged server-side', /console\.error\('\[notify\] dispatch failed', e\)/.test(notify));
// review 2026-09-04 — blocking 1 (sub-portal token leak) + advisory 3 (RFP poster spam)
ok('sub_portal_id is read only through trustedSubPortalId (service callers)', /const subPortalId = trustedSubPortalId\(caller, payload\.sub_portal_id\)/.test(notify));
ok('no caller-trusting read of payload.sub_portal_id remains', !/strOrNull\(payload\.sub_portal_id\)/.test(notify) && (notify.match(/payload\.sub_portal_id/g) ?? []).length === 1);
ok('sub-portal link is only fetched from that trusted id', /if \(subPortalId\) \{\s*const link = await getSubPortalLink\(subPortalId\)/.test(notify));
ok('bid_question_asked (user path) requires the caller\'s own bid_questions row on that RFP, else 403',
  /if \(event === 'bid_question_asked'\) \{[\s\S]{0,500}?const asked = caller\.kind === 'user' \? await newestBidQuestionBy\(rfp\.id, caller\.id\) : null;\s*if \(!asked\) return \{ ok: false, reason: 'no_bid_question', event, httpStatus: 403 \};/.test(notify));
ok('the bid_questions read keys on bid_id AND asker_user_id, newest row first (service-role read; RLS-written row)',
  /bid_questions\?bid_id=eq\.\$\{rfpId\}&asker_user_id=eq\.\$\{userId\}&select=id,question,asker_name,created_at&order=created_at\.desc&limit=1/.test(notify));
ok('the email carries the STORED question / asker_name, never the payload text (residual)', /payload\.question = asked\.question \?\? '';\s*payload\.asker_name = asked\.asker_name \?\? null;/.test(notify));
ok('newestBidQuestionBy refuses non-uuid ids before they reach a PostgREST filter', /async function newestBidQuestionBy\(rfpId: string, userId: string\)[\s\S]{0,140}?if \(!isUuid\(rfpId\) \|\| !isUuid\(userId\)\) return null;/.test(notify));

// review 2026-09-04 advisory 4 — anon callers prove portal possession
console.log('\nnotify/index.ts — anon portal proof (advisory 4):');
ok('header records the deploy order: page before function', /DEPLOY ORDER \(review 2026-09-04, advisory 4\): marketing\/portal\/index\.html must\n\/\/ be live BEFORE this function is deployed\./.test(notify));
ok('anon callers never resolve a project from a bare project_id', /let projectId: string \| null = \(isRfpEvent \|\| isAnonCaller\) \? null : uuidOrNull\(payload\.project_id\)/.test(notify));
ok('anon callers must send portal_id + access_token (403 portal_token_required)', /if \(!portalId \|\| !accessToken\) \{\s*return \{ ok: false, reason: 'portal_token_required', event, httpStatus: 403 \};/.test(notify));
ok('the pair is verified through the portal_project_for_token RPC (service role, two-argument signature)', /rest\/v1\/rpc\/portal_project_for_token/.test(notify) && /body: JSON\.stringify\(\{ p_portal_id: portalId, p_access_token: accessToken \}\)/.test(notify));
ok('a wrong token, or a project_id that disagrees with it, is 403 portal_token_invalid', /if \(!tokenProjectId \|\| \(claimedProjectId && claimedProjectId !== tokenProjectId\)\) \{\s*return \{ ok: false, reason: 'portal_token_invalid'[^}]*httpStatus: 403 \};/.test(notify));
ok('the anon project is the one the token proved (looked up by that id, not by portal id)', /projectId = tokenProjectId;/.test(notify) && /getProjectContext\(projectId, isAnonCaller \? null : effectivePortalId\)/.test(notify));
ok('the access token is stripped from the payload before it can reach the outbox', /const accessToken = strOrNull\(payload\.access_token\);\s*delete payload\.access_token;/.test(notify));
ok('anon per-portal and per-GC buckets are consumed only AFTER the token check', notify.indexOf('exceedsRateLimit(`portal:${portalId}`') > notify.indexOf("reason: 'portal_token_invalid'") && notify.indexOf('exceedsRateLimit(`notify:gc:${gcUserId}`') > notify.indexOf("reason: 'portal_token_invalid'"));
ok('the client-IP bucket is consumed before the RPC (invalid-token sprays cost the sender) and exactly once', notify.indexOf('exceedsRateLimit(`notify:ip:${clientIp}`') < notify.indexOf('await projectForPortalToken(portalId, accessToken)') && (notify.match(/exceedsRateLimit\(`notify:ip:/g) ?? []).length === 1);
ok('the RPC result is accepted only as a uuid', /const v = await r\.json\(\);\s*return isUuid\(v\) \? v : null;/.test(notify));

// review 2026-09-04 residual — sub_invoice_reviewed from a user JWT
console.log('\nnotify/index.ts — sub_invoice_reviewed user path (residual):');
ok('user path requires the invoice id (source_id, as the trigger sends it, or payload.invoice_id), else 403',
  /if \(caller\.kind === 'user' && event === 'sub_invoice_reviewed'\) \{\s*const invoiceId = uuidOrNull\(payload\.invoice_id\) \?\? uuidOrNull\(source_id\);\s*if \(!invoiceId\) return \{ ok: false, reason: 'invoice_id_required', event, httpStatus: 403 \};/.test(notify));
ok('the row must exist and its sub-portal link must belong to the caller, else 403',
  /const owned = await getOwnedSubInvoice\(invoiceId, caller\.id\);\s*if \(!owned\) return \{ ok: false, reason: 'not_your_invoice', event, httpStatus: 403 \};/.test(notify) && /if \(!link \|\| link\.user_id !== ownerId\) return null;/.test(notify));
ok('the invoice lookup selects the stored submitter columns', /sub_submitted_invoices\?id=eq\.\$\{invoiceId\}&select=id,sub_portal_id,project_id,invoice_number,amount,status,submitted_by_name,submitted_by_email,notes_from_gc&limit=1/.test(notify));
ok('the recipient and every shown field come from the row, never the payload', /payload\.submitted_by_email = owned\.invoice\.submitted_by_email;\s*payload\.submitted_by_name = owned\.invoice\.submitted_by_name;\s*payload\.invoice_number = owned\.invoice\.invoice_number;\s*payload\.amount = owned\.invoice\.amount;\s*payload\.status = owned\.invoice\.status;\s*payload\.notes_from_gc = owned\.invoice\.notes_from_gc;/.test(notify));
ok('the user-path sub-portal CTA comes only from the link proven owned', /else if \(ownedSubLink\) \{[\s\S]{0,200}?subPortalLink = subPortalUrlFor\(ownedSubLink\);/.test(notify));

// review 2026-09-04 advisory 4 — the page side: the anon caller sends the proof
console.log('\nmarketing/portal/index.html → notify:');
const portalPage = read('marketing/portal/index.html');
ok('portal page loaded', portalPage.length > 0);
const notifyPayloadOf = (evt: string): string => {
  const i = portalPage.indexOf(`notifyEvent('${evt}', {`);
  return i === -1 ? '' : portalPage.slice(i, portalPage.indexOf('});', i));
};
for (const evt of [...ANON_ALLOWED_EVENTS].sort()) {
  const body = notifyPayloadOf(evt);
  ok(`page's ${evt} payload carries portal_id + access_token (from ?t=)`, /portal_id: api\.portalId,/.test(body) && /access_token: getPortalToken\(\),/.test(body), body ? body.slice(0, 200) : 'call site not found');
}
ok('notifyEvent() and getPortalToken() are declared in the same (outer IIFE) scope', /^  function notifyEvent\(eventName, payload\) \{/m.test(portalPage) && /^  function getPortalToken\(\) \{/m.test(portalPage) && /URLSearchParams\(window\.location\.search\)\.get\('t'\)/.test(portalPage));
ok('the page does not send the token to the dead portal_reaction call (unchanged)', !/event: 'portal_reaction',[\s\S]{0,300}?access_token/.test(portalPage));

// ── 7. invoice-dunning + portal-link-expiry-notice — EDGE-F6 ────────────────
console.log('\nportal links in system emails:');
const dunning = read('supabase/functions/invoice-dunning/index.ts');
ok('invoice-dunning loaded', dunning.length > 0);
ok('dunning imports portalUrlFor', /import \{ portalUrlFor \} from '\.\.\/_shared\/portalLinks\.ts'/.test(dunning));
ok('dunning builds the link from client_portal', /const portalUrl = portalUrlFor\(project\.client_portal\)/.test(dunning));
ok('dunning no longer links /portal/<project.id>', !/mageid\.app\/portal\/\$\{project\.id\}/.test(dunning));
ok('dunning omits the button when there is no tokenized URL', /opts\.portalUrl \? emailButton\('View invoice', opts\.portalUrl\) : ''/.test(dunning));
ok('dunning still selects client_portal', /\.select\('id,user_id,name,client_portal'\)/.test(dunning));
const expiry = read('supabase/functions/portal-link-expiry-notice/index.ts');
ok('portal-link-expiry-notice loaded', expiry.length > 0);
ok('expiry notice imports portalUrlFor', /import \{ portalUrlFor \} from "\.\.\/_shared\/portalLinks\.ts"/.test(expiry));
ok('expiry notice selects client_portal', /select=user_id,name,client_portal/.test(expiry));
ok('expiry notice attaches the current link only while it still works', /kind === "portal_link_expiring" && portalUrl \? \{ portalUrl \} : \{\}/.test(expiry));
ok('expiry notice has no /portal/ literal', !/mageid\.app\/portal/.test(expiry));
// review 2026-09-04 advisory 6 — the Friday homeowner digest linked /portal/<project.id>
const digest = read('supabase/functions/homeowner-weekly-digest/index.ts');
ok('homeowner-weekly-digest loaded', digest.length > 0);
ok('digest imports portalUrlFor', /import \{ portalUrlFor \} from '\.\.\/_shared\/portalLinks\.ts'/.test(digest));
ok('digest builds the link from client_portal via the helper', /const portalUrl = portalUrlFor\(portal\) \?\? undefined/.test(digest) && /const portal = project\.client_portal/.test(digest));
ok('digest omits the CTA when there is no tokenized URL', /cta: opts\.portalUrl \? \{ label: 'View your portal', href: opts\.portalUrl \} : undefined/.test(digest));
ok('digest no longer links /portal/<project.id> (or any token-less portal path)', !/\/portal\/\$\{/.test(digest) && !/mageid\.app\/portal\//.test(digest));
ok('both digest project SELECTs include client_portal', (digest.match(/\.select\('id,user_id,name,status,location,client_portal,schedule'\)/g) ?? []).length === 2);

// ── 8. the trigger-credential migration — EDGE-F3 / DB-F1 / OPS-F2 ──────────
console.log('\nmigration 20260904100000_notify_trigger_cron_secret:');
const mig = read('supabase/migrations/20260904100000_notify_trigger_cron_secret.sql');
ok('migration present', mig.length > 0);
const fireBody = mig.slice(mig.indexOf('function public.fire_notify('), mig.indexOf('$function$;', mig.indexOf('function public.fire_notify(')));
ok('fire_notify sends x-cron-secret from private.cron_auth', /'x-cron-secret', v_secret/.test(fireBody) && /from private\.cron_auth/.test(fireBody));
ok('fire_notify no longer sends the empty bearer / notify_key', !/notify_key/.test(fireBody) && !/Authorization/.test(fireBody));
ok('fire_notify stays SECURITY DEFINER with a pinned search_path', /security definer/i.test(fireBody) && /set search_path/i.test(fireBody));
ok('fire_notify refuses direct (non-trigger) calls', /pg_trigger_depth\(\) = 0/.test(fireBody) && /raise exception/i.test(fireBody));
ok('notify_portal_message_fn is rewritten to go through fire_notify', /function public\.notify_portal_message_fn\(\)[\s\S]*?perform public\.fire_notify\(/.test(mig));
ok('portal_messages trigger switches to trg_notify_portal_message', /drop trigger if exists notify_portal_message on public\.portal_messages/i.test(mig) && /execute function public\.trg_notify_portal_message\(\)/i.test(mig));
ok('trg_notify_portal_message fires for client-authored rows only', /if NEW\.author_type = 'client' then[\s\S]*?perform public\.fire_notify\(\s*'portal_message'/.test(mig));
ok('anon loses EXECUTE on fire_notify; authenticated keeps it (SECURITY INVOKER triggers)', /revoke execute on function public\.fire_notify\(text, text, text, jsonb\) from public, anon/.test(mig) && /grant execute on function public\.fire_notify\(text, text, text, jsonb\) to authenticated, service_role/.test(mig));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
