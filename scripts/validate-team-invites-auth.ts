// validate-team-invites-auth.ts — the sign-up / OAuth / delete-account halves
// of fix wave 3's team-invites lane.
//
//   #72  "Create account" with an email that already has an account: Supabase
//        answers signUp with NO error and an obfuscated user (random id,
//        identities: []). signup() treated it as success — "Confirm your
//        email", no email ever sent — and completeSignIn saw the email match
//        the last-user marker with a different id, ran the FULL local wipe
//        (offline queue, photo + audio queues, local-only records) and wrote
//        the random id into the marker. The pre-session wipe also ran BEFORE
//        signUp, so even an errored sign-up cleared the previous user's caches.
//  #159  signInWithGoogle / signInWithApple returned normally on cancel; the
//        screens then fired a success haptic, a false USER_LOGGED_IN and a
//        navigation the root gate bounced to /login.
//  #175  deleteAccount surfaced "Edge Function returned a non-2xx status code"
//        for every server abort; the server's own sentence is now read back.
//
// signup(), completeSignIn(), beginSignIn() and deleteAccount() are EXTRACTED
// from contexts/AuthContext.tsx, transpiled and run against spies — the real
// code, not a re-implementation. The rest are source pins.
//
// Run: bun run scripts/validate-team-invites-auth.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createAuthEventHold, holdAuthEvents, offerAuthEvent, releaseAuthEvents } from '../utils/authEventHold';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const AUTH = read('contexts/AuthContext.tsx');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}

/** The arrow passed to `const NAME = useCallback(` — up to its closing `}`. */
function extractCallback(src: string, name: string): string | null {
  const head = src.indexOf(`const ${name} = useCallback(`);
  if (head < 0) return null;
  const start = head + `const ${name} = useCallback(`.length;
  const end = src.indexOf('\n  }, [', start);
  if (end < 0) return null;
  return src.slice(start, end + 4);
}

const tr = (code: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(code);

// ── #72: signup() against the obfuscated "already registered" reply ─────────
console.log('\n#72 signup() never touches local data for an existing address:');
{
  const signupSrc = extractCallback(AUTH, 'signup');
  const completeSrc = extractCallback(AUTH, 'completeSignIn');
  const beginSrc = extractCallback(AUTH, 'beginSignIn');
  ok('signup / completeSignIn / beginSignIn were located', !!signupSrc && !!completeSrc && !!beginSrc);
  if (signupSrc && completeSrc && beginSrc) {
    type Reply = { data: { user: unknown; session: unknown }; error: { message: string } | null };
    const run = async (reply: Reply, marker: { id: string; email: string } | null) => {
      const calls: string[] = [];
      const store = { marker };
      // data-session critic: supabase-js fires SIGNED_IN INSIDE signUp. The
      // stub does the same through the provider's hold; the app "sees" the
      // session only when applySession runs.
      const authHoldRef = { current: createAuthEventHold<unknown>() };
      const applyAuthSessionRef = { current: (s: unknown) => { calls.push(s ? 'applySession' : 'applyNoSession'); } };
      const deps: Record<string, unknown> = {
        authHoldRef, applyAuthSessionRef, holdAuthEvents, releaseAuthEvents,
        Platform: { OS: 'ios' },
        PRIMARY_SCHEME: 'mageid://',
        PRE_SESSION_WIPE: { dropOfflineQueue: false, keepLastUserMarker: true },
        supabase: { auth: { signUp: async () => {
          calls.push('signUp');
          if (reply.data.session) offerAuthEvent(authHoldRef.current, reply.data.session, applyAuthSessionRef.current);
          return reply;
        } } },
        wipeLocalUserCache: async (o?: unknown) => { calls.push(o ? 'wipe:pre' : 'wipe:full'); },
        clearOfflineQueue: async () => { calls.push('clearOfflineQueue'); },
        clearPhotoUploadQueue: async () => { calls.push('clearPhotoUploadQueue'); },
        clearAudioTranscribeQueue: async () => { calls.push('clearAudioTranscribeQueue'); },
        clearSyncFailures: async () => { calls.push('clearSyncFailures'); },
        readLastUser: async () => store.marker,
        writeLastUser: async (u: { id: string; email: string | null } | null) => {
          calls.push('writeLastUser');
          if (u) store.marker = { id: u.id, email: (u.email ?? '').toLowerCase() };
        },
        isSameUser: (last: { id: string; email: string } | null, inc: { id?: string; email?: string }) =>
          !!last && ((!!inc.id && inc.id === last.id) || (!!inc.email && inc.email.trim().toLowerCase() === last.email)),
        queryClient: { clear: () => { calls.push('queryClient.clear'); } },
        mapSupabaseUser: (u: unknown) => u,
        track: () => { calls.push('track'); },
        AnalyticsEvents: { USER_SIGNED_UP: 'user_signed_up' },
        __importStub: async () => { throw new Error('no email in the harness'); },
      };
      const names = Object.keys(deps);
      const body = `
        const beginSignIn = ${beginSrc};
        const completeSignIn = ${completeSrc};
        const signup = ${signupSrc.replace(/await import\([^)]*\)/g, 'await __importStub()')};
        return signup;`;
      const signup = new Function(...names, tr(body))(...names.map((n) => deps[n])) as
        (e: string, p: string, n: string) => Promise<unknown>;
      let thrown: string | null = null;
      try { await signup('Mike@Example.com', 'password1', 'Mike'); } catch (e) { thrown = (e as Error).message; }
      await new Promise((r) => setTimeout(r, 5));
      return { calls, thrown, marker: store.marker, holdDepth: authHoldRef.current.depth };
    };

    const MARK = { id: 'real-user-id', email: 'mike@example.com' };
    const dup = await run({ data: { user: { id: 'random-obfuscated', identities: [] }, session: null }, error: null }, { ...MARK });
    ok('identities [] + no session → "already exists — sign in" is thrown', /already exists/i.test(dup.thrown ?? '') && /sign in/i.test(dup.thrown ?? ''), `thrown: ${dup.thrown}`);
    const QUEUE = ['clearOfflineQueue', 'clearPhotoUploadQueue', 'clearAudioTranscribeQueue', 'clearSyncFailures'];
    ok('…and NO queue-clear runs', !dup.calls.some((c) => QUEUE.includes(c)), dup.calls.join(','));
    ok('…and no local wipe of any kind runs', !dup.calls.some((c) => c.startsWith('wipe')), dup.calls.join(','));
    ok('…and the last-user marker is unchanged (the random id is never written)', dup.marker?.id === MARK.id && !dup.calls.includes('writeLastUser'), JSON.stringify(dup.marker));

    const errored = await run({ data: { user: null, session: null }, error: { message: 'rate limited' } }, { id: 'prev', email: 'prev@x.com' });
    ok('a sign-up that ERRORS wipes nothing (the pre-session wipe no longer runs first)', !errored.calls.some((c) => c.startsWith('wipe') || QUEUE.includes(c)), errored.calls.join(','));

    const unconfirmed = await run({ data: { user: { id: 'new-id', identities: [{}] }, session: null }, error: null }, { id: 'prev', email: 'prev@x.com' });
    ok('a real sign-up awaiting confirmation (no session) succeeds', unconfirmed.thrown === null, `thrown: ${unconfirmed.thrown}`);
    ok('…without a hand-off: no wipe, no queue-clear, marker unchanged', !unconfirmed.calls.some((c) => c.startsWith('wipe') || QUEUE.includes(c)) && unconfirmed.marker?.id === 'prev', unconfirmed.calls.join(','));

    const live = await run({ data: { user: { id: 'new-id', email: 'mike@example.com', identities: [{}] }, session: { access_token: 'x' } }, error: null }, { id: 'prev', email: 'prev@x.com' });
    ok('a sign-up WITH a session still hands the device over (pre-wipe, queues dropped, marker = new user)',
      live.calls.includes('wipe:pre') && live.calls.includes('clearOfflineQueue') && live.marker?.id === 'new-id', live.calls.join(','));
    // data-session critic: the SIGNED_IN fired inside signUp reaches the app
    // only AFTER the hand-off (wipe, queue drop, marker) — never before it.
    const applyAt = live.calls.indexOf('applySession');
    ok('…and the app sees the new session only after the hand-off (held through signUp\'s SIGNED_IN)',
      applyAt > live.calls.indexOf('wipe:pre') && applyAt > live.calls.lastIndexOf('writeLastUser') && live.calls.filter(c => c === 'applySession').length === 1,
      live.calls.join(','));
    ok('…and no path leaves auth events held (errored, duplicate, unconfirmed, live)',
      [errored, dup, unconfirmed, live].every(r => r.holdDepth === 0), [errored, dup, unconfirmed, live].map(r => r.holdDepth).join());
  }
}

// ── #159: OAuth resolves true only after completeSignIn ─────────────────────
console.log('\n#159 signInWithGoogle / signInWithApple report whether a session exists:');
for (const name of ['signInWithGoogle', 'signInWithApple']) {
  const src = extractCallback(AUTH, name);
  ok(`${name} located`, !!src);
  if (!src) continue;
  ok(`${name} is typed Promise<boolean>`, /^async \(\): Promise<boolean> =>/.test(src.trim()));
  ok(`${name} has no bare \`return;\` (every quiet exit says false)`, !/\breturn;/.test(src));
  const trues = [...src.matchAll(/return true;/g)].length;
  const completes = [...src.matchAll(/await completeSignIn\(/g)].length;
  ok(`${name}: one \`return true\` per completeSignIn (${completes})`, trues === completes && trues > 0, `true=${trues} complete=${completes}`);
  const eachTrueFollowsComplete = [...src.matchAll(/return true;/g)].every((m) => {
    const before = src.slice(0, m.index).trimEnd().split('\n').slice(-1)[0];
    return /await completeSignIn\(/.test(before);
  });
  ok(`${name}: every \`return true\` sits right after completeSignIn`, eachTrueFollowsComplete);
  ok(`${name}: the dismissed-redirect fall-through returns false`, /\/\/ The redirect sheet was dismissed or came back without a token\.\s*return false;/.test(src));
}
for (const [file, provs] of [['app/login.tsx', ['Google', 'Apple']], ['app/signup.tsx', ['Google', 'Apple']]] as const) {
  const src = read(file);
  for (const p of provs) {
    const re = new RegExp(`const signedIn = await signInWith${p}\\(\\);\\s*if \\(!signedIn\\) return;\\s*if \\(Platform\\.OS !== 'web'\\) \\{\\s*void Haptics\\.notificationAsync\\(Haptics\\.NotificationFeedbackType\\.Success\\)`);
    ok(`${file}: ${p} — haptic/track/navigation only after a true result`, re.test(src));
    ok(`${file}: no un-checked \`await signInWith${p}();\``, !new RegExp(`\\n\\s*await signInWith${p}\\(\\);`).test(src));
  }
}

// ── #175: deleteAccount passes the server's own text through ────────────────
console.log('\n#175 deleteAccount shows what the server said:');
{
  const src = extractCallback(AUTH, 'deleteAccount');
  ok('deleteAccount located', !!src);
  if (src) {
    const make = (invokeReply: unknown) => {
      const deps: Record<string, unknown> = {
        supabase: {
          functions: { invoke: async () => invokeReply },
          auth: { signOut: async () => ({ error: null }) },
        },
        clearStoredCredentials: async () => {},
        setHasStoredCredentials: () => {},
        wipeLocalUserCache: async () => {},
        setSession: () => {}, setUser: () => {}, setIsAuthenticated: () => {},
        queryClient: { clear: () => {} },
      };
      const names = Object.keys(deps);
      return new Function(...names, tr(`return ${src};`))(...names.map((n) => deps[n])) as () => Promise<void>;
    };
    const msgOf = async (fn: () => Promise<void>) => { try { await fn(); return null; } catch (e) { return (e as Error).message; } };
    const httpErr = (body: unknown, throwsOnJson = false) => Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context: { json: async () => { if (throwsOnJson) throw new Error('not json'); return body; } },
    });
    const SERVER = 'Could not read your data (timeout). Nothing was deleted — please try again in a moment.';
    const m1 = await msgOf(make({ data: null, error: httpErr({ success: false, error: SERVER }) }));
    ok('a 500 with a body → the server sentence, verbatim', m1 === SERVER, `got: ${m1}`);
    const PARTIAL = 'Account deletion stopped partway (boom). Some of your data may already have been removed, and your login still exists — try again, or contact support to finish removal.';
    const m2 = await msgOf(make({ data: null, error: httpErr({ success: false, error: PARTIAL }) }));
    ok('the partial-delete text is passed through with nothing added', m2 === PARTIAL, `got: ${m2}`);
    const m3 = await msgOf(make({ data: null, error: httpErr(null, true) }));
    ok('an unreadable body falls back to the transport message', /Could not delete account: Edge Function returned a non-2xx/.test(m3 ?? ''), `got: ${m3}`);
    ok('the client never adds its own "Nothing was deleted"', !/Nothing was deleted/i.test(src.replace(/^\s*\/\/.*$/gm, '')));
  }
  const fn = read('supabase/functions/delete-account/index.ts');
  const flip = fn.indexOf('writesStarted = true;');
  const firstWrite = Math.min(...['.update({ user_id: ownerId })', '.delete()'].map((k) => { const i = fn.indexOf(k); return i < 0 ? Infinity : i; }));
  ok('delete-account flips writesStarted before its first write', flip > 0 && flip < firstWrite);
  ok('…and the catch-all words itself by it (no "nothing happened" after a write)',
    /error: writesStarted\s*\?\s*`Account deletion stopped partway/.test(fn) && /: `Could not delete your account \(\$\{reason\}\)\. Nothing was deleted/.test(fn));
  ok('…with the status codes unchanged (500 on the abort paths)', /Nothing was deleted — please try again in a moment\.`,\s*\}, 500\);/.test(fn));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
