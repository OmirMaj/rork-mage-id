// scripts/validate-w4-auth-invite-fixes.ts — wave 4, lane auth-invite (chain D).
//
// Guards, per finding:
//   #7    the root navigator is not torn down on a sign-in (loader overlay
//         after first boot, teardown only for a switch between two accounts);
//         post-sign-in navigation can never reach a sign-in error handler.
//   #9    the material cart / labor / markup store follows the signed-in
//         account (EXECUTED: the provider's reset/hydrate effect, extracted).
//   #10   covered in validate-storage-hygiene (executed tenant switch).
//   #11   cancelling Google's native sheet is a quiet false, and a native
//         failure never opens the supabase.co redirect (EXECUTED).
//   #107 / #131  the invite rides the account (user_metadata.invite_token):
//         signup stores it, the root gate routes a persona-less account to it
//         before persona/onboarding, accept-invite waits for auth and clears
//         it, persona-select falls back to listPending, the confirm modal says
//         the invite waits.
//   #108  signup/login react to a session arriving from another tab — and
//         stand down when the account carries the same token, because the
//         tab the link opened accepts it (EXECUTED: two tabs, one token, one
//         accept call, in both orders).
//   #109  OAuth sign-up falls back to Home; onboarding sends a finished user
//         home (mount-time only).
//   #126  the root react-query retry predicate stops on transport errors.
//   #112  the plan-sheet signed-URL cache is cleared on every tenant wipe.
//
// Run: bun run scripts/validate-w4-auth-invite-fixes.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  signupMetadata, inviteTokenFromMetadata, metadataInviteRedirect, markInviteTokenHandled,
  isInviteTokenHandled, rootNavPresentation, ROOT_NAV_INITIAL, INVITE_METADATA_FIELD,
  type RootNavState,
} from '../utils/deepLinksInvite';
import { isTransportError } from '../utils/networkErrors';
import { markupDecidedFromStorage } from '../utils/estimateMarkup';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Comment-stripped source: prose must not satisfy (or trip) a pin. */
// Full-line // comments go FIRST: a line comment that mentions a glob such as
// `/integrations/*` would otherwise open a "block comment" for the regex below.
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const tr = (src: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(src);

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}
const at = (s: string, needle: string, from = 0) => { const i = s.indexOf(needle, from); return i < 0 ? Number.POSITIVE_INFINITY : i; };
function extractCallback(src: string, name: string): string | null {
  const head = src.indexOf(`const ${name} = useCallback(`);
  if (head < 0) return null;
  const start = head + `const ${name} = useCallback(`.length;
  const end = src.indexOf('\n  }, [', start);
  if (end < 0) return null;
  return src.slice(start, end + 4);
}

const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
const TOKEN2 = 'c'.repeat(64);

const LAYOUT_RAW = read('app/_layout.tsx');
const LAYOUT = code(LAYOUT_RAW);
const AUTH_RAW = read('contexts/AuthContext.tsx');
const AUTH = code(AUTH_RAW);
const SIGNUP = code(read('app/signup.tsx'));
const LOGIN = code(read('app/login.tsx'));
const ACCEPT = code(read('app/accept-invite.tsx'));
const PERSONA = code(read('app/persona-select.tsx'));
const ONBOARDING = code(read('app/onboarding.tsx'));
const CART_RAW = read('contexts/MaterialCartContext.tsx');
const CART = code(CART_RAW);
const MODAL = code(read('components/ConfirmEmailModal.tsx'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#7 the root navigator survives a sign-in:');
{
  const step = (s: RootNavState, bootstrapping: boolean, userId: string | null) => rootNavPresentation(s, { bootstrapping, userId });
  // First boot, signed out.
  let r = step(ROOT_NAV_INITIAL, true, null);
  ok('first boot while loading → the loader alone', r.mode === 'loader');
  r = step(r.next, false, null);
  ok('first boot settled → the Stack', r.mode === 'stack' && r.next.booted);
  // The invitee signs in on /login?invite=… — the boot queries reload.
  const beforeSignIn = r.next;
  r = step(beforeSignIn, true, 'user-b');
  ok('a sign-in from signed out → the Stack STAYS mounted with the loader over it', r.mode === 'stack+overlay');
  ok('…under the same key (no remount)', r.next.generation === beforeSignIn.generation);
  r = step(r.next, false, 'user-b');
  ok('…and settles to the plain Stack, owned by the new user', r.mode === 'stack' && r.next.stackOwner === 'user-b' && r.next.generation === beforeSignIn.generation);
  // Sign-out: the Stack stays mounted (the gate's replace('/login') must work).
  const signedIn = r.next;
  r = step(signedIn, true, null);
  ok('a sign-out → overlay, not a teardown', r.mode === 'stack+overlay' && r.next.generation === signedIn.generation);
  ok('…the owner is remembered while the sign-out is still loading', r.next.stackOwner === 'user-b');
  // A DIFFERENT user inside that window: the previous tenant's screens go.
  const loading = r.next;
  let sw = step(loading, true, 'user-c');
  ok('a different account where another one\'s screens were mounted → the loader REPLACES the Stack', sw.mode === 'loader');
  sw = step(sw.next, false, 'user-c');
  ok('…and the Stack comes back under a NEW key, owned by the new account', sw.mode === 'stack' && sw.next.generation === signedIn.generation + 1 && sw.next.stackOwner === 'user-c');
  // Integration round 1: once the sign-out SETTLES, the previous account's
  // screens are remounted away (no stale screen under /login, none behind a
  // browser Back), and the owner is cleared.
  r = step(loading, false, null);
  ok('a settled sign-out remounts the Stack (new key) and clears the owner', r.mode === 'stack' && r.next.generation === signedIn.generation + 1 && r.next.stackOwner === null);
  const afterOut = r.next;
  ok('…once: staying signed out does not remount again', step(afterOut, false, null).next.generation === afterOut.generation);
  // The same user comes back (session expired): the fresh Stack stays.
  const back = step(afterOut, true, 'user-b');
  ok('the same user signing back in → overlay, same key', back.mode === 'stack+overlay' && back.next.generation === afterOut.generation);
  // A DIFFERENT user after a settled sign-out: already fresh, no second teardown.
  const other = step(afterOut, true, 'user-c');
  ok('a different account after a settled sign-out → overlay on the already-fresh Stack', other.mode === 'stack+overlay' && other.next.generation === afterOut.generation);
  // A switch with no reload at all still remounts, through the key.
  const noReload = step({ booted: true, stackOwner: 'user-a', generation: 3 }, false, 'user-d');
  ok('a switch that needs no reload still remounts (key bumped)', noReload.mode === 'stack' && noReload.next.generation === 4);
  // Cold start already signed in.
  let cold = step(ROOT_NAV_INITIAL, true, 'user-a');
  cold = step(cold.next, false, 'user-a');
  ok('a cold start signed in owns the Stack from the first boot', cold.next.stackOwner === 'user-a');

  ok('_layout renders the loader alone ONLY in loader mode (no bare `if (bootstrapping) return`)',
    /if \(navMode === 'loader'\) \{\s*return <CraneLoader label="MAGE ID" \/>;\s*\}/.test(LAYOUT)
    && !/if \(bootstrapping\) \{\s*return <CraneLoader/.test(LAYOUT));
  ok('…computes the mode from rootNavPresentation(prev, { bootstrapping, userId })',
    /rootNavPresentation\(navStateRef\.current, \{\s*bootstrapping,\s*userId: user\?\.id \?\? null,\s*\}\)/.test(LAYOUT)
    && /navStateRef\.current = navNext;/.test(LAYOUT));
  // Slick round 3: the overlay lives in components/launch/ReloadVeil (a grace
  // before it shows, a fade out). Same meaning: rendered in the Stack's own
  // return (not instead of it), absoluteFill at zIndex 1000, the crane loader,
  // and it blocks input while the reload runs.
  ok('…draws the loader OVER the mounted Stack while reloading',
    /<\/Stack>[\s\S]{0,600}<ReloadVeil active=\{navMode === 'stack\+overlay'\} \/>\s*<\/View>\s*\);/.test(LAYOUT)
    && ((veil: string) => /StyleSheet\.absoluteFill, \{ zIndex: 1000 \}\]/.test(veil)
      && /<CraneLoader label="MAGE ID" \/>/.test(veil)
      && /pointerEvents=\{active \? 'auto' : 'none'\}/.test(veil))(code(read('components/launch/ReloadVeil.tsx'))));
  ok('…and keys the Stack container by the account generation',
    /<View style=\{\{ flex: 1 \}\} key=\{`stack-\$\{navNext\.generation\}`\}>\s*<Stack /.test(LAYOUT));
  ok('the gate still waits while the boot queries load (nothing routes under the overlay)',
    /useEffect\(\(\) => \{\s*if \(authLoading \|\| projectLoading \|\| hasSeenOnboarding === null\) return;/.test(LAYOUT));
  ok('a redirect to /login right after a session ended does not stash that screen for the next account',
    /const sessionJustEnded = lastSettledAuthRef\.current === true && !isAuthenticated;\s*lastSettledAuthRef\.current = isAuthenticated;/.test(LAYOUT)
    && /if \(pathname !== '\/login' && !PUBLIC_PATHS\.has\(firstSeg\) && !sessionJustEnded\) \{\s*void setPendingDeepLink\(/.test(LAYOUT));

  // Post-sign-in navigation cannot reach the sign-in error handler.
  const goLogin = LOGIN.slice(at(LOGIN, 'const goAfterSignIn = useCallback('), at(LOGIN, '}, [router, inviteToken]);'));
  ok('login.goAfterSignIn wraps its replace in its own try/catch',
    /try \{\s*router\.replace\(postSignInHref\(inviteToken, '\/\(tabs\)\/summary'\) as never\);\s*\} catch \(navErr\) \{/.test(goLogin));
  const goSignup = SIGNUP.slice(at(SIGNUP, 'const goAfterOAuth = useCallback('), at(SIGNUP, '}, [router, inviteToken]);', at(SIGNUP, 'const goAfterOAuth')));
  ok('signup.goAfterOAuth wraps its replace in its own try/catch',
    /try \{\s*router\.replace\(postSignInHref\(inviteToken, '\/\(tabs\)\/\(home\)'\) as never\);\s*\} catch \(navErr\) \{/.test(goSignup));
  const oauthNav = [...SIGNUP.matchAll(/const signedIn = await signInWith(Google|Apple)\(\);[\s\S]*?goAfterOAuth\(\);/g)].length;
  ok('both OAuth sign-ups navigate only through goAfterOAuth', oauthNav === 2, `found ${oauthNav}`);
  ok('no bare post-sign-in router.replace left in signup\'s OAuth handlers',
    !/Haptics\.NotificationFeedbackType\.Success\);\s*\}\s*router\.replace\(/.test(SIGNUP));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#107 / #131 the invite rides the account:');
{
  ok('signupMetadata carries a real token', JSON.stringify(signupMetadata('Mike', TOKEN)) === JSON.stringify({ name: 'Mike', [INVITE_METADATA_FIELD]: TOKEN }));
  ok('…upper-case / padded input is normalised', signupMetadata('Mike', `  ${TOKEN.toUpperCase()} `)[INVITE_METADATA_FIELD] === TOKEN);
  ok('…and a junk token is dropped, not spliced into the account', JSON.stringify(signupMetadata('Mike', 'x<script>')) === JSON.stringify({ name: 'Mike' })
    && JSON.stringify(signupMetadata('Mike', undefined)) === JSON.stringify({ name: 'Mike' }));
  ok('the metadata field is invite_token (CONTRACT 13)', INVITE_METADATA_FIELD === 'invite_token');
  ok('inviteTokenFromMetadata reads it back', inviteTokenFromMetadata({ name: 'x', invite_token: TOKEN }) === TOKEN);
  ok('…and treats null / cleared / junk as none', inviteTokenFromMetadata(null) === null && inviteTokenFromMetadata({ invite_token: null }) === null && inviteTokenFromMetadata({ invite_token: 'nope' }) === null);

  ok('a persona-less account with a live token is sent to the invite',
    metadataInviteRedirect({ userRole: null, meta: { invite_token: TOKEN } }) === `/accept-invite?token=${TOKEN}`);
  ok('…a set-up account is NOT yanked off what he opened', metadataInviteRedirect({ userRole: 'contractor', meta: { invite_token: TOKEN } }) === null);
  ok('…no token, no redirect', metadataInviteRedirect({ userRole: null, meta: { name: 'x' } }) === null);
  markInviteTokenHandled(TOKEN2);
  ok('…a token already handled this launch does not loop him back', metadataInviteRedirect({ userRole: null, meta: { invite_token: TOKEN2 } }) === null && isInviteTokenHandled(TOKEN2));

  const signupCb = extractCallback(AUTH_RAW, 'signup') ?? '';
  ok('AuthContext.signup takes opts?: { inviteToken } (CONTRACT 13)',
    /^async \(email: string, password: string, name: string, opts\?: \{ inviteToken\?: string \| null \}\) =>/.test(signupCb.trim()));
  ok('…and writes signupMetadata(name, opts?.inviteToken) as the account metadata',
    /options: \{\s*data: signupMetadata\(name, opts\?\.inviteToken\),\s*emailRedirectTo,/.test(signupCb));
  ok('…emailRedirectTo is left on the allow-listed root (a non-allow-listed URL falls back to the marketing site)',
    /const emailRedirectTo = Platform\.OS === 'web'\s*\? 'https:\/\/app\.mageid\.app\/'\s*: PRIMARY_SCHEME;/.test(signupCb));
  ok('signup.tsx passes the sanitized route token to signup()',
    /await signup\(email\.trim\(\), password, name\.trim\(\), \{ inviteToken: sanitizeInviteToken\(inviteToken\) \}\);/.test(SIGNUP));

  const gate93 = at(LAYOUT, 'if (isAuthenticated && inAuth && sanitizeInviteToken(globalParamsRef.current[INVITE_PARAM])) return;');
  const gateMeta = at(LAYOUT, 'if (isAuthenticated && accountInviteHref) {');
  const gatePersona = at(LAYOUT, "router.replace('/persona-select' as never);");
  const gateOnb = at(LAYOUT, "router.replace('/onboarding');");
  ok('the root gate routes an account-carried invite AFTER the #93 screen deferral and BEFORE the persona / onboarding gates',
    Number.isFinite(gateMeta) && gate93 < gateMeta && gateMeta < gatePersona && gateMeta < gateOnb);
  ok('…computing the href from metadataInviteRedirect({ userRole, meta }) over the session\'s metadata',
    /const accountInviteToken = sanitizeInviteToken\(session\?\.user\?\.user_metadata\?\.invite_token\);/.test(LAYOUT)
    && /const accountInviteHref = metadataInviteRedirect\(\{ userRole, meta: \{ invite_token: accountInviteToken \} \}\);/.test(LAYOUT));
  ok('…marking the token handled before it navigates (once per launch)',
    /if \(isAuthenticated && accountInviteHref\) \{\s*markInviteTokenHandled\(accountInviteToken\);[\s\S]{0,200}router\.replace\(accountInviteHref as never\);\s*return;/.test(LAYOUT));
  ok('…and the gate re-runs when the token changes (dependency)', /pathname, accountInviteHref, accountInviteToken\]\);/.test(LAYOUT));

  const autoAccept = ACCEPT.slice(at(ACCEPT, 'useEffect(() => {\n    if (authLoading) return;'), at(ACCEPT, 'return (\n'));
  ok('accept-invite waits for auth to settle before deciding "signed out"',
    /useEffect\(\(\) => \{\s*if \(authLoading\) return;\s*if \(isAuthenticated && user\?\.id && status === 'idle'\) void accept\(\);\s*else if \(!isAuthenticated && status === 'idle'\) setStatus\('signin'\);\s*\}, \[authLoading, isAuthenticated, user\?\.id, status, accept\]\);/.test(ACCEPT),
    autoAccept.slice(0, 200));
  const acceptFn = ACCEPT.slice(at(ACCEPT, 'const accept = useCallback('), at(ACCEPT, '}, [params.token, queryClient, user?.id, clearInviteToken]);'));
  ok('accept-invite clears the account token on a definitive failure only', /if \(!canRetryInvite\(code\)\) void clearInviteToken\(token\);\s*return;/.test(acceptFn));
  ok('…and after a successful accept (before it reports done)', /void clearInviteToken\(token\);\s*setProjectId\(body\.projectId \?\? null\);\s*setStatus\('done'\);/.test(acceptFn));
  const clearCb = extractCallback(AUTH_RAW, 'clearInviteToken') ?? '';
  ok('AuthContext.clearInviteToken marks it handled first, then clears ONLY the token actually on the account',
    at(clearCb, 'markInviteTokenHandled(t);') < at(clearCb, 'supabase.auth.updateUser(')
    && /if \(inviteTokenFromMetadata\(data\.session\?\.user\?\.user_metadata\) !== t\) return;/.test(clearCb)
    && /supabase\.auth\.updateUser\(\{ data: \{ \[INVITE_METADATA_FIELD\]: null \} \}\)/.test(clearCb));
  ok('…and it is on the context value', /\n\s*clearInviteToken,\n\s*\}\), \[/.test(AUTH_RAW));

  // EXECUTED: clearInviteToken against a stubbed supabase.
  if (clearCb) {
    const run = async (onAccount: string | null, token: string) => {
      const calls: string[] = [];
      const deps: Record<string, unknown> = {
        sanitizeInviteToken: (v: unknown) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : null),
        markInviteTokenHandled: (t: string) => calls.push(`handled:${t.slice(0, 4)}`),
        inviteTokenFromMetadata,
        INVITE_METADATA_FIELD,
        supabase: { auth: {
          getSession: async () => ({ data: { session: { user: { user_metadata: onAccount ? { invite_token: onAccount } : {} } } } }),
          updateUser: async (a: { data: Record<string, unknown> }) => { calls.push(`update:${JSON.stringify(a.data)}`); return { error: null }; },
        } },
      };
      const names = Object.keys(deps);
      const fn = new Function(...names, tr(`return ${clearCb};`))(...names.map((n) => deps[n])) as (t: string) => Promise<void>;
      await fn(token);
      return calls;
    };
    const same = await run(TOKEN, TOKEN);
    ok('EXECUTED: the token on the account is removed', same.includes('update:{"invite_token":null}') && same[0].startsWith('handled:'), same.join(','));
    const other = await run(TOKEN2, TOKEN);
    ok('EXECUTED: a DIFFERENT token on the account is left alone', !other.some((c) => c.startsWith('update:')), other.join(','));
  }

  // persona-select safety net.
  ok('persona-select asks listPending for a NEW account with no invitedProject',
    /const lookForInvites = !invitedProject && hasSeenOnboarding === false && !!userId && isSupabaseConfigured;/.test(PERSONA)
    && /action: 'listPending'/.test(PERSONA) && /queryKey: pendingInvitesQueryKey,\s*enabled: lookForInvites,/.test(PERSONA));
  ok('…sharing PendingInvitesCard\'s react-query entry', /useMemo\(\(\) => \['pending-invites', userId\] as const, \[userId\]\)/.test(PERSONA));
  const commit = PERSONA.slice(at(PERSONA, 'const commitRole = useCallback('), at(PERSONA, 'const handlePick = useCallback('));
  const invBranch = at(commit, 'if (invited && !hasSeenOnboarding) {');
  ok('…and with an invite waiting, skips the GC onboarding and lands Home (where the card accepts it)',
    Number.isFinite(invBranch) && invBranch < at(commit, "router.replace('/onboarding' as never);")
    && /if \(invited && !hasSeenOnboarding\) \{\s*await completeOnboarding\(\);\s*router\.replace\('\/\(tabs\)\/\(home\)' as never\);\s*return;\s*\}/.test(commit));
  ok('…waiting for a lookup still in flight, bounded', /await settleWithin\(\s*queryClient\.fetchQuery\(/.test(commit) && /,\s*4000,\s*\);/.test(commit));
  ok('…and nothing is accepted on his behalf (no acceptPending on persona-select)', !/acceptPending/.test(PERSONA));
  ok('…the lede names the waiting invite from the server\'s own fields', /\$\{pendingInviteHeadline\(waitingInvite\)\}/.test(PERSONA));

  ok('ConfirmEmailModal says the invite waits when he signed up from one', /inviteWaiting\?: boolean;/.test(MODAL)
    && /inviteWaiting\s*\? "[^"]*your invite opens first[^"]*"/.test(MODAL));
  ok('signup.tsx tells the modal', /inviteWaiting=\{!!sanitizeInviteToken\(inviteToken\)\}/.test(SIGNUP));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#108 a session from another tab moves the tab that holds the token:');
for (const [file, src, nav] of [
  ['app/signup.tsx', SIGNUP, "router.replace(postSignInHref(inviteToken, '/(tabs)/(home)') as never);"],
  ['app/login.tsx', LOGIN, 'goAfterSignIn();'],
] as const) {
  const watcher = src.slice(at(src, 'const prevAuthRef = useRef<boolean | null>(null);'), at(src, '}, [authLoading, isAuthenticated, inviteToken,', at(src, 'const prevAuthRef')));
  ok(`${file}: a false→true flip after the first settled read, with a token and no local sign-in in flight, navigates`,
    /if \(authLoading\) return;\s*const was = prevAuthRef\.current;\s*prevAuthRef\.current = isAuthenticated;\s*if \(was !== false \|\| !isAuthenticated \|\| localSignInRef\.current\) return;/.test(watcher)
    && watcher.includes(nav), watcher.slice(0, 300));
  const handlers = [...src.matchAll(/localSignInRef\.current = true;/g)].length;
  const releases = [...src.matchAll(/finally \{\s*localSignInRef\.current = false;/g)].length;
  ok(`${file}: every sign-in handler marks itself in flight and releases in a finally`, handlers >= 3 && handlers === releases, `set ${handlers}, released ${releases}`);
  ok(`${file}: the #93 restored-session check is kept verbatim`,
    /if \(authLoading \|\| restoredCheckedRef\.current\) return;\s*restoredCheckedRef\.current = true;\s*if \(isAuthenticated && sanitizeInviteToken\(inviteToken\)\)/.test(src));
}
ok('signup\'s watcher closes the confirm modal before navigating',
  /markInviteTokenHandled\(inviteToken\);\s*if \(action === 'opened_in_other_tab'\) \{[\s\S]*?return;\s*\}\s*setShowConfirmModal\(false\);\s*try \{\s*router\.replace\(/.test(SIGNUP));

// Reviewer (round 1): both web tabs accepted one token. Tab A (this screen,
// the session broadcast back to it) and tab B (the confirmation link's fresh
// boot, whose root gate follows user_metadata.invite_token) each called
// accept; project-invite matches status=pending and nulls the token, so the
// loser — usually the foreground tab — showed invalid_or_used. EXECUTED here
// with two separate module instances (two JS processes), the real watcher
// bodies extracted from signup.tsx / login.tsx, and the real gate helper.
{
  // A query string gives Bun a separate module instance — a separate process's
  // handledInviteTokens. Built at runtime so tsc does not try to resolve it.
  const freshInstance = async (tag: string) => await import(`../utils/deepLinksInvite.ts?${tag}`) as typeof import('../utils/deepLinksInvite');
  const tabA = await freshInstance('w4-tab-a');
  const tabBGate = async () => await freshInstance(`w4-tab-b-${Math.random()}`);
  const watcherBody = (src: string) => {
    const from = at(src, 'const prevAuthRef = useRef<boolean | null>(null);');
    const open = src.indexOf('useEffect(() => {', from);
    const close = src.indexOf('\n  }, [authLoading, isAuthenticated, inviteToken,', open);
    return open < 0 || close < 0 ? null : src.slice(open + 'useEffect(() => {'.length, close);
  };
  for (const [file, src] of [['app/signup.tsx', SIGNUP], ['app/login.tsx', LOGIN]] as const) {
    const body = watcherBody(src);
    ok(`${file}: #108 watcher body located`, !!body);
    if (!body) continue;
    ok(`${file}: the watcher decides through signInElsewhereAction with the arriving session's metadata, web = shared tabs`,
      /signInElsewhereAction\(\{\s*routeToken: inviteToken,\s*accountMeta: session\?\.user\?\.user_metadata,\s*sharedOriginTabs: Platform\.OS === 'web',\s*\}\)/.test(body));
    /** One run of this tab's watcher after a false→true flip; returns the accept navigations it made. */
    const runTabA = (mod: typeof tabA, a: { meta: unknown; os: string; route: string }) => {
      const navs: string[] = []; const ui: string[] = [];
      const deps: Record<string, unknown> = {
        authLoading: false, isAuthenticated: true,
        prevAuthRef: { current: false }, localSignInRef: { current: false },
        inviteToken: a.route, session: { user: { user_metadata: a.meta } },
        Platform: { OS: a.os },
        signInElsewhereAction: mod.signInElsewhereAction, markInviteTokenHandled: mod.markInviteTokenHandled,
        sanitizeInviteToken: mod.sanitizeInviteToken, postSignInHref: mod.postSignInHref,
        router: { replace: (h: string) => navs.push(h) },
        goAfterSignIn: () => navs.push(mod.postSignInHref(a.route, '/(tabs)/summary')),
        setShowConfirmModal: (v: boolean) => ui.push(`modal=${v}`),
        setConfirmedElsewhere: (v: boolean) => ui.push(`elsewhere=${v}`),
        setElsewhereNotice: (v: string) => ui.push(`notice=${v ? 'set' : ''}`),
        LOGIN_INVITE_OPENED_ELSEWHERE: 'x',
        console: { log: () => {} },
      };
      const names = Object.keys(deps);
      new Function(...names, tr(body))(...names.map((n) => deps[n]));
      return { accepts: navs.filter((h) => h.startsWith('/accept-invite?token=')).length, ui };
    };
    /** Tab B's root gate: a fresh process, a persona-less account. */
    const runTabB = async (meta: unknown) => {
      const mod = await tabBGate();
      const href = mod.metadataInviteRedirect({ userRole: null, meta });
      if (href) mod.markInviteTokenHandled(mod.inviteTokenFromMetadata(meta));
      return href ? 1 : 0;
    };
    const meta = signupMetadata('Foreman', TOKEN);
    // Order 1: tab A hears the broadcast first, then tab B finishes booting.
    const a1 = await freshInstance(`w4-a1-${file}`);
    const r1 = runTabA(a1, { meta, os: 'web', route: TOKEN });
    const total1 = r1.accepts + await runTabB(meta);
    ok(`EXECUTED ${file}: two web tabs, one token on the account — exactly ONE accept (broadcast first)`, total1 === 1, `accepts=${total1} ui=${r1.ui.join(',')}`);
    ok(`EXECUTED ${file}: …and it is the link's tab that accepts; this tab says where the invite went`,
      r1.accepts === 0 && (file === 'app/signup.tsx' ? r1.ui.includes('elsewhere=true') && r1.ui.includes('modal=true') : r1.ui.includes('notice=set')), r1.ui.join(','));
    // Order 2: tab B's gate runs first.
    const a2 = await freshInstance(`w4-a2-${file}`);
    const b2 = await runTabB(meta);
    const total2 = b2 + runTabA(a2, { meta, os: 'web', route: TOKEN }).accepts;
    ok(`EXECUTED ${file}: …and exactly ONE accept when the link's tab gets there first`, total2 === 1, `accepts=${total2}`);
    // Once stood down, this tab's own gate never opens it either.
    ok(`EXECUTED ${file}: the standing-down tab marks the token handled, so its own gate cannot open it`,
      a1.metadataInviteRedirect({ userRole: null, meta }) === null);
    // An account WITHOUT the token (signed in to an existing account elsewhere):
    // the other tab's gate has nothing to follow, so this tab — the one holding
    // the token — still opens it. Still one accept.
    const a3 = await freshInstance(`w4-a3-${file}`);
    const plain = { name: 'Existing' };
    const total3 = runTabA(a3, { meta: plain, os: 'web', route: TOKEN }).accepts + await runTabB(plain);
    ok(`EXECUTED ${file}: an account without the token → this tab opens it, one accept`, total3 === 1, `accepts=${total3}`);
    // Native: no second tab exists; the session came through this process.
    const a4 = await freshInstance(`w4-a4-${file}`);
    ok(`EXECUTED ${file}: native keeps navigating (no other tab to open it)`, runTabA(a4, { meta, os: 'ios', route: TOKEN }).accepts === 1);
    // Same process already routed it (the gate won the effect order): no second navigation.
    const a5 = await freshInstance(`w4-a5-${file}`);
    a5.markInviteTokenHandled(TOKEN);
    ok(`EXECUTED ${file}: a token this process already routed is not navigated again`, runTabA(a5, { meta, os: 'ios', route: TOKEN }).accepts === 0);
  }
  ok('signInElsewhereAction: no route token → none', tabA.signInElsewhereAction({ routeToken: 'nope', accountMeta: {}, sharedOriginTabs: true }) === 'none');
  ok('the confirm modal has the "confirmed elsewhere" state and signup passes it',
    /if \(confirmedElsewhere\) \{[\s\S]*?Email confirmed[\s\S]*?Your invite opened in the tab the confirmation link opened/.test(MODAL)
    && /confirmedElsewhere=\{confirmedElsewhere\}/.test(SIGNUP));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#109 a returning OAuth user is never sent back through first-run:');
{
  ok('signup.tsx never targets /onboarding', !/'\/onboarding'/.test(SIGNUP));
  ok('onboarding sends a finished user home — decided once, on the first known value',
    /useEffect\(\(\) => \{\s*if \(hasSeenOnboarding === null \|\| firstKnownOnboardingRef\.current !== null\) return;\s*firstKnownOnboardingRef\.current = hasSeenOnboarding;\s*if \(hasSeenOnboarding === true\) router\.replace\('\/\(tabs\)\/\(home\)' as never\);\s*\}, \[hasSeenOnboarding, router\]\);/.test(ONBOARDING));
  // Executed: the mount-time rule.
  const decide = (seq: (boolean | null)[]) => {
    let first: boolean | null = null; const out: string[] = [];
    for (const v of seq) { if (v === null || first !== null) continue; first = v; if (v === true) out.push('home'); }
    return out;
  };
  ok('…a user finished before the screen mounted is sent home', decide([null, true]).join() === 'home');
  ok('…a user who FINISHES here (tour / first bid flip it mid-flow) is not raced', decide([null, false, true]).length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#9 the material cart follows the signed-in account:');
{
  ok('MaterialCartProvider reads the signed-in user id', /const userId = useAuth\(\)\?\.user\?\.id \?\? null;/.test(CART));
  const effects = [...CART.matchAll(/useEffect\(\(\) => \{/g)].map((m) => m.index ?? 0);
  const resetAt = at(CART, 'const generation = ++generationRef.current;');
  const persistAt = at(CART, 'void saveLocal(CART_KEY, cart);');
  ok('the reset/hydrate effect is declared ABOVE every persist effect', resetAt < persistAt && effects.filter((i) => i < resetAt).length === 1
    && ['CART_KEY, cart', 'MARKUP_KEY, globalMarkup', 'LABOR_KEY, laborCart', 'ASSEMBLY_KEY, assemblyCart'].every((k) => at(CART, `void saveLocal(${k});`) > resetAt));
  ok('…keyed on the user id', /hydratedRef\.current = true;\s*\}\)\(\);[\s\S]{0,200}\}, \[userId\]\);/.test(CART));
  ok('every persist effect is still disarmed until hydrated', (CART.match(/if \(!hydratedRef\.current\) return;\s*void saveLocal\(/g) ?? []).length === 4);
  ok('the provider is NOT keyed in _layout (that would remount the navigator)', !/<MaterialCartProvider key=/.test(LAYOUT));

  // EXECUTED: the effect, extracted and run against controllable storage.
  const effStart = CART_RAW.indexOf('useEffect(() => {\n    const generation = ++generationRef.current;');
  const effEnd = CART_RAW.indexOf('}, [userId]);', effStart);
  const effSrc = effStart < 0 || effEnd < 0 ? '' : CART_RAW.slice(effStart + 'useEffect('.length, effEnd + 1);
  ok('reset/hydrate effect located', effSrc.length > 0);
  if (effSrc) {
    type Store = Record<string, string | null>;
    const make = () => {
      const state: Record<string, unknown> = {};
      const writes: string[] = [];
      const pending: Array<() => void> = [];
      const generationRef = { current: 0 };
      const hydratedRef = { current: false };
      let store: Store = {};
      // A read sees the disk AS IT WAS WHEN IT STARTED (that is what a slow
      // read of the previous account's keys returns), and resolves only when
      // the test flushes it.
      const later = <T,>(v: () => T) => { const value = v(); return new Promise<T>((res) => pending.push(() => res(value))); };
      const deps: Record<string, unknown> = {
        generationRef, hydratedRef,
        setCart: (v: unknown) => { state.cart = v; }, setLaborCart: (v: unknown) => { state.labor = v; },
        setAssemblyCart: (v: unknown) => { state.assembly = v; }, setGlobalMarkupState: (v: unknown) => { state.markup = v; },
        setMarkupDecided: (v: unknown) => { state.decided = v; },
        DEFAULT_MARKUP: 15,
        CART_KEY: 'c', MARKUP_KEY: 'm', LABOR_KEY: 'l', ASSEMBLY_KEY: 'a', MARKUP_DECIDED_KEY: 'd',
        loadLocal: (k: string, fb: unknown) => later(() => { const v = store[k]; return v ? JSON.parse(v) : fb; }),
        loadRaw: (k: string) => later(() => store[k] ?? null),
        parseNumber: (raw: string | null) => (raw == null ? null : Number(JSON.parse(raw))),
        markupDecidedFromStorage,
        saveLocal: async (k: string, v: unknown) => { writes.push(`${k}=${JSON.stringify(v)}`); },
      };
      const names = [...Object.keys(deps), 'userId'];
      const factory = new Function(...names, tr(`return (${effSrc});`));
      const effect = (uid: string | null) => factory(...Object.keys(deps).map((n) => deps[n]), uid)() as (() => void) | undefined;
      // lifo: the NEWER account's reads answer first and the old account's slow
      // reads land last — the ordering a generation guard exists for.
      const flush = async (lifo = false) => {
        while (pending.length) (lifo ? pending.pop()! : pending.shift()!)();
        await new Promise((r) => setTimeout(r, 0));
      };
      return { state, writes, hydratedRef, effect, flush, setStore: (s: Store) => { store = s; } };
    };
    const A_CART = JSON.stringify([{ material: { id: 'mat-a' }, quantity: 3, markup: 22 }]);

    // A is signed in with a cart and a decided 22% markup.
    const h = make();
    h.setStore({ c: A_CART, m: '22', d: '1', l: '[]', a: '[]' });
    let cleanup = h.effect('user-a');
    await h.flush();
    ok('EXECUTED: account A hydrates his own cart and markup', Array.isArray(h.state.cart) && (h.state.cart as unknown[]).length === 1 && h.state.markup === 22 && h.state.decided === true && h.hydratedRef.current);
    // A signs out: the store empties and nothing is read.
    cleanup?.();
    h.setStore({ c: A_CART, m: '22', d: '1' }); // the sign-out wipe has not finished yet
    cleanup = h.effect(null);
    await h.flush();
    ok('EXECUTED: sign-out empties the in-memory store (cart, markup, decided=null)', (h.state.cart as unknown[]).length === 0 && h.state.markup === 15 && h.state.decided === null);
    ok('EXECUTED: …reads nothing while signed out (the wipe may still be running) and stays disarmed', !h.hydratedRef.current);
    // B signs in on the same tab; storage is wiped for the new tenant.
    cleanup?.();
    h.setStore({});
    cleanup = h.effect('user-b');
    await h.flush();
    ok('EXECUTED: account B starts with an empty cart and an UNDECIDED markup (no inherited 22%)',
      (h.state.cart as unknown[]).length === 0 && h.state.markup === 15 && h.state.decided === false, JSON.stringify(h.state));

    // A slow load for A must not land after a switch to B.
    const s = make();
    s.setStore({ c: A_CART, m: '22', d: '1' });
    const cA = s.effect('user-a');     // A's reads start against A's disk
    cA?.();
    s.setStore({});                    // the handoff wiped it for B
    s.effect('user-b');                // switch before A's reads resolve
    await s.flush(true);               // B answers first; A's slow reads land last
    ok('EXECUTED: a load started for the previous account never lands after the switch',
      (s.state.cart as unknown[]).length === 0 && s.state.markup === 15 && s.state.decided === false, JSON.stringify(s.state));
    ok('EXECUTED: …and its markup seed write is dropped with it', !s.writes.some((w) => w.startsWith('d=')), s.writes.join(','));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#11 cancelling Google is a quiet false, and a native failure never opens supabase.co:');
{
  const src = extractCallback(AUTH_RAW, 'signInWithGoogle');
  ok('signInWithGoogle located', !!src);
  ok('the cancel check sits right after GoogleSignin.signIn(), before the idToken read',
    !!src && at(src, 'const result = await GoogleSignin.signIn();') < at(src, 'if (result && isCancelledResponse(result)) {')
    && at(src, 'if (result && isCancelledResponse(result)) {') < at(src, 'const idToken ='));
  if (src) {
    const run = async (google: { signIn?: () => Promise<unknown>; configureThrows?: string; os?: string }) => {
      const calls: string[] = [];
      const deps: Record<string, unknown> = {
        Platform: { OS: google.os ?? 'ios' },
        __googleStub: async () => ({
          GoogleSignin: {
            configure: () => { if (google.configureThrows) throw new Error(google.configureThrows); },
            hasPlayServices: async () => true,
            signIn: google.signIn ?? (async () => ({ type: 'cancelled', data: null })),
          },
          isCancelledResponse: (r: { type?: string }) => r.type === 'cancelled',
        }),
        beginSignIn: async () => { calls.push('beginSignIn'); return { sameUser: true, last: null }; },
        wipeLocalUserCache: async () => { calls.push('wipe'); },
        PRE_SESSION_WIPE: {},
        decodeJwtClaims: () => ({ email: 'x@y.z' }),
        completeSignIn: async () => { calls.push('completeSignIn'); },
        promptGoogleIdentityServices: async () => null,
        makeRedirectUri: () => 'mageid://',
        WebBrowser: { openAuthSessionAsync: async () => { calls.push('openAuthSession'); return { type: 'dismiss' }; } },
        supabase: { auth: {
          signInWithIdToken: async () => { calls.push('signInWithIdToken'); return { data: { user: { id: 'u' } }, error: null }; },
          signInWithOAuth: async () => { calls.push('signInWithOAuth'); return { data: { url: 'https://x.supabase.co/auth' }, error: null }; },
          setSession: async () => ({ data: {}, error: null }),
        } },
        showAlert: () => { calls.push('alert'); },
      };
      const names = Object.keys(deps);
      const body = src.replace(/await import\('@react-native-google-signin\/google-signin'\)/, 'await __googleStub()');
      const fn = new Function(...names, tr(`return ${body};`))(...names.map((n) => deps[n])) as () => Promise<boolean>;
      const origWarn = console.warn, origErr = console.error, origLog = console.log;
      console.warn = () => {}; console.error = () => {}; console.log = () => {};
      let result: boolean | 'threw';
      try { result = await fn(); } catch { result = 'threw'; }
      console.warn = origWarn; console.error = origErr; console.log = origLog;
      return { result, calls };
    };
    const cancelled = await run({});
    ok('EXECUTED: a resolved { type: "cancelled" } → false, no supabase.co redirect, no alert',
      cancelled.result === false && !cancelled.calls.includes('signInWithOAuth') && !cancelled.calls.includes('alert'), JSON.stringify(cancelled));
    const noToken = await run({ signIn: async () => ({ type: 'success', data: { idToken: null } }) });
    ok('EXECUTED: a native success with no ID token → "Sign In Failed", NOT the redirect',
      noToken.result === 'threw' && noToken.calls.includes('alert') && !noToken.calls.includes('signInWithOAuth'), JSON.stringify(noToken));
    const legacyCancel = await run({ signIn: async () => { throw Object.assign(new Error('cancel'), { code: 'SIGN_IN_CANCELLED' }); } });
    ok('EXECUTED: the older thrown-cancel shape is still a quiet false', legacyCancel.result === false && !legacyCancel.calls.includes('signInWithOAuth'));
    const oldBinary = await run({ configureThrows: 'RNGoogleSignin native module is null' });
    ok('EXECUTED: a binary WITHOUT the native module still falls back to the web redirect',
      oldBinary.calls.includes('signInWithOAuth'), JSON.stringify(oldBinary));
    const good = await run({ signIn: async () => ({ type: 'success', data: { idToken: 'h.eyJlbWFpbCI6InhAeS56In0.s' } }) });
    ok('EXECUTED: a real native sign-in still completes (true after completeSignIn)', good.result === true && good.calls.includes('completeSignIn'));
    // Reviewer (round 1): the no-redirect rule is iPhone-only. Android has no
    // native OAuth client registered (configure passes iOS + web ids only), so
    // DEVELOPER_ERROR there must still be rescued by the web path.
    const androidDevErr = await run({ os: 'android', signIn: async () => { throw Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' }); } });
    ok('EXECUTED: Android — a native failure (DEVELOPER_ERROR) still falls back to the web redirect',
      androidDevErr.calls.includes('signInWithOAuth') && !androidDevErr.calls.includes('alert'), JSON.stringify(androidDevErr));
    const androidNoToken = await run({ os: 'android', signIn: async () => ({ type: 'success', data: { idToken: null } }) });
    ok('EXECUTED: Android — no ID token also falls back (as before wave 4)', androidNoToken.calls.includes('signInWithOAuth'), JSON.stringify(androidNoToken));
    const androidCancel = await run({ os: 'android' });
    ok('EXECUTED: Android — a resolved cancel is still a quiet false, no redirect',
      androidCancel.result === false && !androidCancel.calls.includes('signInWithOAuth'), JSON.stringify(androidCancel));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#126 the root retry predicate stops on transport errors:');
{
  const m = /retry: \(failureCount, error\) => \{\s*if \(isTransportError\(error\)\) return false;\s*return failureCount < 2;\s*\},/.exec(LAYOUT);
  ok('the predicate is isTransportError-first (CONTRACT 15)', !!m);
  ok('…and the old browser-only string match is gone', !/error\.message === 'Failed to fetch'/.test(LAYOUT));
  ok('…and isTransportError is imported from utils/networkErrors', /import \{ isTransportError \} from '@\/utils\/networkErrors';/.test(LAYOUT_RAW));
  if (m) {
    const retry = (n: number, e: unknown) => (isTransportError(e) ? false : n < 2);
    ok('EXECUTED: RN\'s "Network request failed" is not retried', retry(0, new TypeError('Network request failed')) === false);
    ok('EXECUTED: a 57014 statement timeout (a server answer) still retries', retry(0, { code: '57014', message: 'canceling statement due to statement timeout' }) === true);
    ok('EXECUTED: an RLS refusal still retries twice, then stops', retry(1, { code: '42501', message: 'permission denied' }) === true && retry(2, { code: '42501' }) === false);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n#112 the plan-sheet signed-URL cache is cleared at the tenant boundary:');
{
  const wipe = AUTH.slice(at(AUTH, 'async function wipeLocalUserCache('), at(AUTH, 'await AsyncStorage.multiRemove(LOCAL_USER_CACHE_KEYS'));
  ok('wipeLocalUserCache calls clearPlanSheetUrlCache() on EVERY wipe (not only under dropOfflineQueue)',
    /clearPlanSheetUrlCache\(\);\s*if \(dropOfflineQueue\) \{/.test(wipe));
  ok('…imported from utils/planSheetUrls (CONTRACT 14)', /import \{ clearPlanSheetUrlCache \} from '@\/utils\/planSheetUrls';/.test(AUTH_RAW));
  // Every sign-out / tenant-switch path reaches a wipe.
  const logout = AUTH.slice(at(AUTH, 'const logout = useCallback('), at(AUTH, 'const deleteAccount = useCallback('));
  ok('…and logout reaches it', /await wipeLocalUserCache\(\);/.test(logout));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
