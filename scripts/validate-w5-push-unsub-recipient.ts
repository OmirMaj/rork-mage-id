// scripts/validate-w5-push-unsub-recipient.ts — wave 5, lane push-unsub:
// one address per digest, one account per phone.
//
//   #130  Both GC digests mailed profiles.email — the Company Profile address
//         he can set to office@… — while the app's digest switch reads and
//         lifts suppression on his SIGN-IN address. Once they differed, an
//         unsubscribe from the office inbox could never be undone in the app.
//         Both digests now resolve the sign-in address (auth admin API) and
//         use that ONE address for the send, the unsubscribe check, the link
//         and the outbox row; the unsubscribe→preferences sync trigger matches
//         the same address (20260923241000).
//   #44   A phone's push token stayed on every account that ever signed in on
//         it (production: 3 profiles, 1 token). 20260923240000 repairs the
//         duplicates, adds a partial unique index and a SECURITY DEFINER
//         trigger that moves a token to the account that registered it last;
//         morning-digest also never briefs one token twice in a run.
//         (The migrations are executed twice in PGlite by the lane's scratch
//         test; here their shape is pinned so an edit can't quietly drop a
//         part.)
//
// Run: bun run scripts/validate-w5-push-unsub-recipient.ts

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const stripSqlComments = (src: string) => src.replace(/--.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.error('  ✗', name, detail ? `— ${detail}` : ''); }
}

type Lookup = { ok: true; email: string | null } | { ok: false };
// Typed by hand: `typeof import(...)` would pull the Deno module into the app's
// tsc program (it has no Deno types).
type EmailMod = {
  pickDigestRecipient(l: Lookup, profileEmail: string | null | undefined): { email: string | null; source: string };
  fetchSignInEmail(url: string, key: string, userId: string): Promise<Lookup>;
  digestPreviewReason(reason: string | null | undefined, recipientLookupFailed: boolean): string | null | undefined;
};

(globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (k: string) => (k === 'UNSUB_SECRET' ? 'x' : undefined) } };
const emailModPath = '../supabase/functions/_shared/email';
const mod = await import(emailModPath) as EmailMod;

// ── #130 the preview's reason after a failed lookup, executed ────────────────
// Only 'no_email' (the empty address the failed lookup produced) becomes
// 'recipient_unknown'; the Email switch being off, or nothing to report, is a
// truer answer and passes through (review of #130).
{
  const r = mod.digestPreviewReason;
  ok('lookup failed + no_email → recipient_unknown', r('no_email', true) === 'recipient_unknown');
  ok('lookup failed + email_off stays email_off (the switch is the real reason)', r('email_off', true) === 'email_off');
  ok('lookup failed + nothing_to_report stays nothing_to_report', r('nothing_to_report', true) === 'nothing_to_report');
  ok('lookup failed + sent (no reason) stays undefined', r(undefined, true) === undefined);
  ok('lookup fine + no_email stays no_email', r('no_email', false) === 'no_email');
}

// ── #130 the recipient rule, executed ────────────────────────────────────────
{
  const p = mod.pickDigestRecipient;
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  ok('sign-in address wins over a different company address',
    eq(p({ ok: true, email: 'gc@home.com' }, 'office@firm.com'), { email: 'gc@home.com', source: 'sign_in' }));
  ok('company address only when auth has NO address',
    eq(p({ ok: true, email: null }, ' office@firm.com '), { email: 'office@firm.com', source: 'company_profile' }));
  ok('neither → no recipient', eq(p({ ok: true, email: null }, ''), { email: null, source: 'none' }));
  ok('a failed lookup never falls back to the company address',
    eq(p({ ok: false }, 'office@firm.com'), { email: null, source: 'lookup_failed' }));

  const calls: { url: string; headers: Record<string, string> }[] = [];
  const realFetch = globalThis.fetch;
  const respond = async (res: Response | Error) => {
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      if (res instanceof Error) throw res;
      return res;
    }) as typeof fetch;
    return mod.fetchSignInEmail('https://proj.supabase.co', 'svc-key', 'user-1');
  };
  try {
    const a = await respond(new Response(JSON.stringify({ id: 'user-1', email: 'GC@Home.com' }), { status: 200 }));
    ok('200 → the sign-in address', a.ok === true && (a as { email: string | null }).email === 'GC@Home.com', JSON.stringify(a));
    ok('it asks the auth admin API for that user, with the service role',
      calls[0]?.url === 'https://proj.supabase.co/auth/v1/admin/users/user-1'
      && calls[0]?.headers.Authorization === 'Bearer svc-key' && calls[0]?.headers.apikey === 'svc-key', JSON.stringify(calls[0]));
    const b = await respond(new Response('{}', { status: 404 }));
    ok('404 (user gone) → known, no address', b.ok === true && (b as { email: string | null }).email === null);
    const c = await respond(new Response('{}', { status: 200 }));
    ok('200 with no email (anonymous account) → known, no address', c.ok === true && (c as { email: string | null }).email === null);
    const d = await respond(new Response('boom', { status: 500 }));
    ok('500 → unknown, not "no address"', d.ok === false);
    const e = await respond(new Error('network'));
    ok('a thrown fetch → unknown', e.ok === false);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── #130 morning-digest uses the one address everywhere ─────────────────────
{
  const src = stripComments(read('supabase/functions/morning-digest/index.ts'));
  ok('morning-digest resolves the recipient through fetchSignInEmail + pickDigestRecipient',
    /async function withDigestRecipient\(profile: ProfileRow\): Promise<ProfileRow> \{\s*const lookup = await fetchSignInEmail\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, profile\.id\);\s*const recipient = pickDigestRecipient\(lookup, profile\.email\);/.test(src));
  ok('…and swaps it into profile.email (the field the send, the gate, the footer and the outbox read)',
    /email: recipient\.email \?\? '',/.test(src));
  const calls = [...src.matchAll(/buildDigestForUser\(admin, ([^,)]+)/g)].map((m) => m[1].trim());
  ok('every buildDigestForUser call (preview AND cron) goes through withDigestRecipient',
    calls.length === 2
    && calls.includes('resolved') && /const resolved = await withDigestRecipient\(profile as ProfileRow\);/.test(src)
    && calls.includes('await withDigestRecipient(p'), calls.join(' | '));
  ok('the send, the unsubscribe check, the footer link and the outbox all read profile.email',
    /const email = profile\.email;/.test(src)
    && /isEmailUnsubscribed\(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, email, GC_DIGEST_EVENT_KEY\)/.test(src)
    && /recipientEmail: profile\.email \?\? '',/.test(src)
    && /recipient_email: profile\.email \|\| null,/.test(src));
  ok('a failed lookup is recorded, and the preview says "try again", not "no email address"',
    /emailStatus = 'failed_recipient_lookup';/.test(src)
    && /return jsonResponse\(\{ \.\.\.result, reason: digestPreviewReason\(result\.reason, !!resolved\.recipient_lookup_failed\) \}\);/.test(src));
  ok('no profiles.email-based send path is left (one sendDigestEmail call, inside the gate)',
    (src.match(/sendDigestEmail\(/g) ?? []).length === 2);
}

// ── #130 daily-digest uses the one address everywhere ───────────────────────
{
  const src = stripComments(read('supabase/functions/daily-digest/index.ts'));
  ok('daily-digest no longer filters opted-in GCs on the company email column', !/email=not\.is\.null/.test(src));
  ok('processGc resolves the sign-in address first',
    /const recipient = pickDigestRecipient\(await fetchSignInEmail\(SUPABASE_URL, SERVICE_ROLE_KEY, gc\.id\), gc\.email\);/.test(src)
    && /if \(recipient\.source === 'lookup_failed'\) return \{ id: gc\.id, status: 'failed', reason: 'recipient_lookup_failed' \};/.test(src)
    && /const to = recipient\.email;/.test(src));
  const body = src.slice(src.indexOf('async function processGc('), src.indexOf('serve(async'));
  ok('after resolving, processGc never reads gc.email again',
    (body.match(/gc\.email/g) ?? []).length === 1, String((body.match(/gc\.email/g) ?? []).length));
  ok('the footer link, the gate, the send and the outbox all use `to`',
    /email: to,/.test(body) && /isEmailUnsubscribed\(SUPABASE_URL, SERVICE_ROLE_KEY, to, GC_DIGEST_EVENT_KEY\)/.test(body)
    && /unsubscribe: \{ recipientEmail: to, eventKey: GC_DIGEST_EVENT_KEY, enabled: true \}/.test(body)
    && /recipient_email: to,/.test(body));
}

// ── #130 the sync trigger matches the same address ──────────────────────────
{
  const mig = stripSqlComments(read('supabase/migrations/20260923241000_digest_unsubscribe_sync_signin.sql'));
  ok('(A) matches through auth.users: the sign-in address',
    /from auth\.users u\s+where u\.id = p\.id/.test(mig) && /lower\(u\.email\) = lower\(new\.email\)/.test(mig));
  ok('(A) falls back to profiles.email only when there is no sign-in address (the digests\' own rule)',
    /coalesce\(btrim\(u\.email\), ''\) = '' and lower\(p\.email\) = lower\(new\.email\)/.test(mig)
    && !/where lower\(p\.email\) = lower\(new\.email\);/.test(mig));
  ok('(A) keeps SECURITY DEFINER, its search_path and the revoke',
    /security definer\s+set search_path = pg_catalog, public/.test(mig)
    && /revoke execute on function public\.email_unsubscribes_sync_digest_prefs\(\) from public, anon, authenticated;/.test(mig));
  ok('(A) keeps its trigger shape',
    /create trigger email_unsubscribes_sync_digest_prefs\s+after insert or update of email, event_key on public\.email_unsubscribes\s+for each row/.test(mig));
}

// ── #44 one account per phone ───────────────────────────────────────────────
{
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => /^2026092324\d+_.*\.sql$/.test(f));
  ok('the lane\'s migrations sit in slot 2026092324', files.includes('20260923240000_push_token_single_owner.sql') && files.includes('20260923241000_digest_unsubscribe_sync_signin.sql'), files.join(', '));
  const mig = stripSqlComments(read('supabase/migrations/20260923240000_push_token_single_owner.sql'));
  const repairAt = mig.indexOf('row_number() over');
  const indexAt = mig.indexOf('create unique index if not exists profiles_push_token_uniq');
  ok('the repair keeps each token on its most recent holder by coalesce(push_token_updated_at, updated_at), ties broken',
    repairAt > 0 && /partition by push_token\s+order by coalesce\(push_token_updated_at, updated_at\) desc nulls last, id desc/.test(mig)
    && /r\.rn > 1/.test(mig));
  ok('the repair clears token, platform and stamp and prints its count',
    /set push_token = null,\s+push_token_platform = null,\s+push_token_updated_at = null\s+from ranked r/.test(mig)
    && /raise notice/.test(mig));
  ok('the partial unique index comes AFTER the repair', indexAt > repairAt && /where push_token is not null;/.test(mig.slice(indexAt)));
  ok('profiles_claim_push_token is SECURITY DEFINER with a pinned search_path and clears every OTHER holder',
    /create or replace function public\.profiles_claim_push_token\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+set search_path = pg_catalog, public/.test(mig)
    && /where push_token = new\.push_token\s+and id <> new\.id;/.test(mig));
  ok('EXECUTE revoked from anon and authenticated',
    /revoke execute on function public\.profiles_claim_push_token\(\) from public, anon, authenticated;/.test(mig));
  ok('BEFORE UPDATE OF push_token, only when it becomes a new non-null value (no recursion)',
    /create trigger profiles_claim_push_token\s+before update of push_token on public\.profiles\s+for each row\s+when \(new\.push_token is not null and new\.push_token is distinct from old\.push_token\)/.test(mig));
  ok('INSERT is covered (a profile can be created with a token)',
    /create trigger profiles_claim_push_token_on_insert\s+before insert on public\.profiles\s+for each row\s+when \(new\.push_token is not null\)/.test(mig));
  ok('the claim never raises (a raise would permanently fail a replayed queue write)', !/\braise\s+exception\b/i.test(mig));

  const md = stripComments(read('supabase/functions/morning-digest/index.ts'));
  ok('the cron fan-out shares one per-run token set', /const pushedTokens = new Set<string>\(\);/.test(md)
    && /buildDigestForUser\(admin, await withDigestRecipient\(p\), pushedTokens\)/.test(md));
  const hasAt = md.indexOf('pushedTokens?.has(profile.push_token)');
  const addAt = md.indexOf('pushedTokens?.add(profile.push_token)');
  ok('a token already briefed this run is skipped and logged',
    hasAt > 0 && /pushStatus = 'skipped_duplicate_token';/.test(md) && /already briefed this run/.test(md)
    && /profile\.push_token && !hasNothingToSay && !tokenAlreadyBriefed/.test(md));
  ok('the token is claimed before any await (the parallel fan-out cannot double-send)',
    addAt > hasAt && !/\bawait\b/.test(md.slice(hasAt, addAt)));
}

console.info(`\n${fail === 0 ? `validate-w5-push-unsub-recipient: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
