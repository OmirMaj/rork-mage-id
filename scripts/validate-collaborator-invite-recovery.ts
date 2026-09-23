// validate-collaborator-invite-recovery.ts — an invite opened before sign-in
// survives the sign-in, and one that got lost is still findable (#29).
//
// WHY (audit round 2 #29). accept-invite stashed the token under
// 'mageid_pending_invite' and pushed '/login'. Nothing read the key back:
// login went to Summary, signup to onboarding, the _layout replay reads a
// different key, and a new account's pre-session wipe sweeps every 'mageid_'
// key anyway. On iPhone the https link opens Safari (no associatedDomains), so
// an account created in the app never saw the token at all. A first-time
// foreman — the exact person the field role is for — finished onboarding into
// an empty app, and an email mismatch (Apple's hidden relay) was a dead end
// whose 403 body never even reached the screen.
//
// What this pins:
//   1. the token rides the ROUTE (utils/deepLinksInvite, run for real here):
//      accept-invite → /login?invite= → (signup?invite=) → /accept-invite?token=;
//   2. no login success path still hard-routes to Summary;
//   3. Home lists invites waiting for the verified email and accepts by id,
//      even with zero projects;
//   4. the server's listPending / acceptPending authorise on the verified email
//      and a pending status, and the mismatch answer reaches the screen (2xx +
//      code) naming the signed-in address.
//
// Run via: bun run scripts/validate-collaborator-invite-recovery.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  sanitizeInviteToken, loginHrefForInvite, signupHrefForInvite, postSignInHref,
  pendingInviteHeadline, parsePendingInvites,
} from '../utils/deepLinksInvite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const read = (...p: string[]) => strip(readFileSync(join(ROOT, ...p), 'utf8'));

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, why?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, why ? `\n      ${why}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const TOKEN = 'a'.repeat(32) + '0123456789abcdef'.repeat(2);

console.log('\nthe token rides the route (#29):');
expect('a real token (64 hex) is kept', sanitizeInviteToken(TOKEN), TOKEN);
expect('expo-router array params take the first', sanitizeInviteToken([TOKEN, 'x']), TOKEN);
expect('anything else is dropped, never spliced into a route', sanitizeInviteToken('abc&next=/paywall'), null);
expect('login carries it', loginHrefForInvite(TOKEN), `/login?invite=${TOKEN}`);
expect('…and without one is plain /login', loginHrefForInvite(undefined), '/login');
expect('signup carries it', signupHrefForInvite(TOKEN), `/signup?invite=${TOKEN}`);
expect('a sign-in with a token lands back on the invite', postSignInHref(TOKEN, '/(tabs)/summary'), `/accept-invite?token=${TOKEN}`);
expect('…and without one goes where it always went', postSignInHref(undefined, '/(tabs)/summary'), '/(tabs)/summary');

const accept = read('app', 'accept-invite.tsx');
ok('accept-invite sends him to sign in WITH the token', /router\.push\(loginHrefForInvite\(params\.token\)/.test(accept)
  && !/router\.push\('\/login'\)/.test(accept));
ok('accept-invite shows and copies the signed-in address on an email mismatch',
  /code === 'email_mismatch'/.test(accept) && /Clipboard\.setStringAsync\(signedInAs\)/.test(accept));

const login = read('app', 'login.tsx');
ok('no login success path hard-routes to Summary any more', !/router\.replace\('\/\(tabs\)\/summary'/.test(login));
ok('login routes every success through postSignInHref(inviteToken, …)',
  /router\.replace\(postSignInHref\(inviteToken, '\/\(tabs\)\/summary'\)/.test(login) && (login.match(/goAfterSignIn\(\);/g) ?? []).length >= 4);
ok('login hands the token to signup', /router\.push\(signupHrefForInvite\(inviteToken\)/.test(login));
const signup = read('app', 'signup.tsx');
// #109 (wave 4): the OAuth fallback is Home, not /onboarding (the persona /
// onboarding gates route a genuinely new account on from there). Both OAuth
// handlers go through ONE goAfterOAuth, which carries the invite token.
{
  const goFn = /const goAfterOAuth = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[/.exec(signup)?.[0] ?? '';
  ok('signup (OAuth, live session) lands back on the invite', /router\.replace\(postSignInHref\(inviteToken, '\/\(tabs\)\/\(home\)'\) as never\)/.test(goFn)
    && (signup.match(/\n\s+goAfterOAuth\(\);/g) ?? []).length === 2
    && !/'\/onboarding'/.test(signup.replace(/\/\/.*$/gm, '')));
}

console.log('\nHome finds invites the link lost (#29):');
expect('headline names who / what / role', pendingInviteHeadline({ invitedBy: "Mike's Construction", projectName: 'Henderson Remodel', role: 'field' }),
  "Mike's Construction invited you to Henderson Remodel as Field");
expect('a missing name is not guessed', pendingInviteHeadline({ invitedBy: '', projectName: '', role: 'owner' }), 'A contractor invited you to a project');
expect('malformed rows are dropped', parsePendingInvites({ invites: [{ collaboratorId: 'c1', projectId: 'p1', role: 'field' }, { projectId: 'p2' }, null] }).map(i => i.collaboratorId), ['c1']);
expect('a non-list reply is empty, not a crash', parsePendingInvites({ error: 'x' }), []);

const home = read('app', '(tabs)', '(home)', 'index.tsx');
const at = home.indexOf('<PendingInvitesCard />');
ok('Home mounts the pending-invite card', at !== -1);
ok('…outside any "has projects" condition (zero projects is the case it is for)',
  at !== -1 && !/projects\.length\s*>\s*0\s*&&\s*$/.test(home.slice(Math.max(0, at - 60), at).trimEnd()));
const card = read('components', 'collaborators', 'PendingInvitesCard.tsx');
ok('the card lists through listPending and accepts through acceptPending by id',
  /action: 'listPending'/.test(card) && /action: 'acceptPending', collaboratorId: inv\.collaboratorId/.test(card));

console.log('\nproject-invite authorises by the verified email (#29):');
const fn = read('supabase', 'functions', 'project-invite', 'index.ts');
const block = (name: string) => {
  const a = fn.indexOf(`if (action === "${name}")`);
  return a === -1 ? '' : fn.slice(a, fn.indexOf('\n  if (action ===', a + 10));
};
const list = block('listPending');
ok('listPending matches the caller\'s verified email and pending status only',
  /invited_email=eq\.\$\{encodeURIComponent\(caller\.email\)\}&status=eq\.pending/.test(list));
ok('…and answers empty for an account with no email', /if \(!caller\.email\) return json\(\{ success: true, invites: \[\] \}\)/.test(list));
const acc = block('acceptPending');
ok('acceptPending re-checks the email against the row and requires pending',
  /status=eq\.pending/.test(acc) && /row\.invited_email\.toLowerCase\(\) !== caller\.email/.test(acc));
ok('both accept paths write through markAccepted (pending-only PATCH)',
  /markAccepted\(row\.id, caller\.sub\)/.test(acc) && /markAccepted\(row\.id, caller\.sub\)/.test(block('accept'))
  && /project_collaborators\?id=eq\.\$\{encodeURIComponent\(collaboratorId\)\}&status=eq\.pending/.test(fn));
const acceptBlock = block('accept');
ok('an email mismatch reaches the screen: 2xx + code, naming the signed-in address',
  /code: "email_mismatch"/.test(acceptBlock) && /signedInAs: caller\.email/.test(acceptBlock) && !/different email address\." \}, 403\)/.test(acceptBlock));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
