// validate-team-invites-nav.ts — invite / first-run navigation and the team
// roster, fix wave 3's team-invites lane.
//
//   #70  onboarding-paywall's exits (decline, purchase, restore) replaced the
//        only root-stack entry with /project-detail — no back, no tab bar.
//   #94  accept-invite's "Open the project" did the same.
//   #93 / #156  a brand-new invitee was walked through the GC's onboarding and
//        the estimate wizard; the project id was dropped at the first gate; the
//        replay and the onboarding exit raced; the persona gate could bounce an
//        invite sign-in off /login; a homeowner invitee had no pending-invites
//        card.
//  #172  a used/invalid invite offered only "Try again", which cannot work.
//   #95  the roster's trash icon revoked on touch, silently failing offline.
//  #177  the invite email's outcome was swallowed; the copy-link fallback died
//        with the screen; the email said neither who invited him nor as what,
//        and interpolated the project name as raw HTML.
//  #176  the Field role promised "no costs or margins" that only the app keeps.
//
// Pure pieces (canRetryInvite, the invite email sender) are extracted and RUN;
// the navigation wiring is pinned in source, ordered where order is the fix.
//
// Run: bun run scripts/validate-team-invites-nav.ts

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

declare const Bun: { Transpiler: new (o: { loader: 'ts' }) => { transformSync(code: string): string } };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Line comments out, so a pin cannot be satisfied by the comment explaining it. */
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const tr = (c: string) => new Bun.Transpiler({ loader: 'ts' }).transformSync(c);

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  PASS ', name); }
  else { fail++; console.log('  FAIL ', name, detail ? `\n        ${detail}` : ''); }
}
/** Index of `needle` in `hay`, or Infinity when absent (so ordering checks fail). */
const at = (hay: string, needle: string | RegExp, from = 0) => {
  if (typeof needle === 'string') { const i = hay.indexOf(needle, from); return i < 0 ? Infinity : i; }
  const m = new RegExp(needle.source, needle.flags.replace('g', '')).exec(hay.slice(from));
  return m ? from + m.index : Infinity;
};
const BARE_REPLACE_PD = /router\.replace\(\s*\{\s*pathname:\s*['"]\/project-detail['"]/;
const HOME_THEN_PUSH = /router\.replace\('\/\(tabs\)\/\(home\)' as never\);\s*router\.push\(\{ pathname: '\/project-detail', params: \{ id: (\w+) \} \} as never\);/;
// #111 (wave 4): an invitee lands on the project WITH justJoined, so the hub
// shows its loader while the list re-reads instead of "project not found".
const HOME_THEN_PUSH_JOINED = /router\.replace\('\/\(tabs\)\/\(home\)' as never\);\s*router\.push\(\{ pathname: '\/project-detail', params: \{ id: (\w+), justJoined: '1' \} \} as never\);/;

// ── #70 onboarding-paywall ───────────────────────────────────────────────────
console.log('\n#70 onboarding-paywall exits land on the project WITH Home underneath:');
{
  const src = code(read('app/onboarding-paywall.tsx'));
  ok('no bare replace to /project-detail anywhere in the file', !BARE_REPLACE_PD.test(src));
  const fnStart = at(src, 'const leaveToNextScreen = useCallback(');
  const fnEnd = at(src, '}, [router, projectId', fnStart);
  const fn = src.slice(fnStart, fnEnd);
  ok('leaveToNextScreen located', Number.isFinite(fnStart) && Number.isFinite(fnEnd));
  ok('leaveToNextScreen replaces onto (tabs)/(home) and PUSHES the project', HOME_THEN_PUSH.test(fn));
  ok('onboarding is completed before the exit navigates', at(fn, 'await completeOnboarding()') < at(fn, 'router.replace('));
  const exits = [...src.matchAll(/void leaveToNextScreen\(\);/g)].length;
  ok('all three exits (decline, purchase, restore) go through it', exits === 3, `found ${exits}`);
}

// ── #94 / #93 / #172 accept-invite ───────────────────────────────────────────
console.log('\n#94 / #93 / #172 accept-invite:');
{
  const raw = read('app/accept-invite.tsx');
  const src = code(raw);
  ok('no bare replace to /project-detail', !BARE_REPLACE_PD.test(src));
  const open = src.slice(at(src, 'const openProject = useCallback('), at(src, 'const goHome = useCallback('));
  const pushes = [...open.matchAll(new RegExp(HOME_THEN_PUSH_JOINED.source, 'g'))].length;
  ok('openProject: both set-up branches replace Home then push the project', pushes === 2, `found ${pushes}`);
  ok('a persona-less account goes to persona-select WITH invitedProject (persona still asked, never guessed)',
    /router\.replace\(\{ pathname: '\/persona-select', params: \{ invitedProject: projectId \} \} as never\)/.test(open)
    && !/setUserRole\(/.test(src));
  ok('the onboarding-only branch TAKES the stash before completeOnboarding (one navigation wins)',
    at(open, 'await takePendingDeepLink()') < at(open, 'await completeOnboarding()'));
  ok('the safety-net stash is set only while first-run is unfinished',
    /if \(userRole !== null && hasSeenOnboarding === true\) return;\s*void setPendingDeepLink\(`\/project-detail\?id=\$\{encodeURIComponent\(projectId\)\}&justJoined=1`\)/.test(src));
  ok("the button reads 'Setting up your account…' while the writes run", /\{opening \|\| !firstRunKnown \? \([\s\S]{0,200}Setting up your account…/.test(src));
  ok('nothing decides on userRole until first-run state has loaded (null while loading ≠ never picked)',
    /if \(opening \|\| !firstRunKnown\) return;/.test(src) && /if \(status !== 'done' \|\| !projectId \|\| !firstRunKnown\) return;/.test(src));
  ok('the old one-line replace onPress is gone', !/onPress=\{\(\) => \(projectId \? router\.replace/.test(src));

  // canRetryInvite, run.
  const m = /function canRetryInvite\(errCode: string \| null\): boolean \{[\s\S]*?\n\}/.exec(raw);
  ok('canRetryInvite located', !!m);
  if (m) {
    const canRetry = new Function(tr(`${m[0]}\nreturn canRetryInvite;`))() as (c: string | null) => boolean;
    ok('no retry for invalid_or_used', canRetry('invalid_or_used') === false);
    ok('no retry for email_mismatch', canRetry('email_mismatch') === false);
    ok('no retry for a missing token', canRetry('missing_token') === false);
    ok('retry for a transient failure (no code)', canRetry(null) === true);
  }
  ok('"Try again" renders only behind canRetryInvite(errCode)', /\{canRetryInvite\(errCode\) \? \(\s*<TouchableOpacity[\s\S]{0,300}Try again/.test(src));
  ok('a missing token records errCode missing_token', /setErrCode\('missing_token'\)/.test(src));
  ok('the error state always offers Home (or sign-in when signed out)',
    /onPress=\{goHome\}/.test(src) && /router\.replace\(\(isAuthenticated \? '\/\(tabs\)\/\(home\)' : '\/login'\) as never\)/.test(src));
  ok('invalid_or_used removes the stale mageid_pending_invite', /if \(code === 'invalid_or_used'\) await AsyncStorage\.removeItem\(PENDING_KEY\);/.test(src));
}

// ── #93 persona-select / onboarding / _layout / ClientHome ───────────────────
console.log('\n#93 / #156 an invitee reaches the job, exactly once:');
{
  const ps = code(read('app/persona-select.tsx'));
  const commit = ps.slice(at(ps, 'const commitRole = useCallback('), at(ps, 'const handlePick = useCallback('));
  const inv = commit.slice(at(commit, 'if (invitedProject) {'), at(commit, 'return;', at(commit, 'if (invitedProject) {')));
  ok('persona-select has an invitedProject branch', inv.length > 0 && Number.isFinite(at(commit, 'if (invitedProject) {')));
  ok('…which takes the stash BEFORE setUserRole and completeOnboarding',
    at(inv, 'await takePendingDeepLink()') < at(inv, 'await setUserRole(role)') && at(inv, 'await setUserRole(role)') < at(inv, 'await completeOnboarding()'));
  ok('…skips the GC onboarding (no /onboarding in the branch)', !/'\/onboarding'/.test(inv));
  ok('…and opens the job with Home underneath', /router\.replace\('\/\(tabs\)\/\(home\)' as never\);\s*router\.push\(\{ pathname: '\/project-detail', params: \{ id: invitedProject \} \} as never\);/.test(inv));
  ok('invitedProject is sanitized before it becomes a route', /\/\^\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(rawInvited\)/.test(ps));

  const ob = code(read('app/onboarding.tsx'));
  for (const [label, startNeedle, endNeedle] of [
    ['sample tour', 'const replayTarget = await takeReplayTarget();\n    try {', "router.push((replayTarget ??"],
    ['price your first bid', 'const goPriceFirstBid = useCallback(', "router.replace('/estimate-wizard?onboarding=1' as never);"],
    ['top-bar Skip', 'const handleSkip = useCallback(', '}, [router, completeOnboarding]);'],
  ] as const) {
    const s0 = at(ob, startNeedle);
    const body = ob.slice(s0, at(ob, endNeedle, s0) + endNeedle.length);
    ok(`onboarding ${label}: stash taken before completeOnboarding`,
      Number.isFinite(s0) && at(body, 'await takeReplayTarget()') < at(body, 'await completeOnboarding()'), body.slice(0, 120));
  }
  ok('funnel routes are never a replay target', /FUNNEL_ROUTES\.has\(route\) \? null : pending/.test(ob));

  const lay = code(read('app/_layout.tsx'));
  const gateInvite = at(lay, 'if (isAuthenticated && inAuth && sanitizeInviteToken(globalParamsRef.current[INVITE_PARAM])) return;');
  const personaGate = at(lay, "router.replace('/persona-select' as never);");
  ok('the root gate leaves an authenticated invite sign-in to login/signup, BEFORE the persona gate', gateInvite < personaGate);
  ok('the replay lands Home first and PUSHES the stashed screen (#94)',
    /router\.replace\('\/\(tabs\)\/\(home\)' as any\);\s*const route = pending[\s\S]{0,160}router\.push\(pending as any\)/.test(lay)
    && !/router\.replace\(pending as any\)/.test(lay));
  ok('wave-2 handoff kept: the unauthenticated stash still carries the query string',
    /setPendingDeepLink\(pathname \+ pendingLinkQuery\(segments as string\[\], globalParamsRef\.current\)\)/.test(lay));

  for (const f of ['app/login.tsx', 'app/signup.tsx']) {
    const s = code(read(f));
    ok(`${f}: a session restored onto an invite-bearing screen is sent on, once`,
      /if \(authLoading \|\| restoredCheckedRef\.current\) return;\s*restoredCheckedRef\.current = true;\s*if \(isAuthenticated && sanitizeInviteToken\(inviteToken\)\)/.test(s));
  }

  const ch = code(read('components/ClientHome.tsx'));
  ok('ClientHome mounts PendingInvitesCard (homeowner invitees)', /<PendingInvitesCard \/>/.test(ch) && /import PendingInvitesCard from '@\/components\/collaborators\/PendingInvitesCard';/.test(ch));
}

// ── #95 / #177 / #176 the roster ─────────────────────────────────────────────
console.log('\n#95 / #177 / #176 the team roster:');
{
  const cm = code(read('components/collaborators/CollaboratorsManager.tsx'));
  ok('no revoke fired straight from a tap', !/onPress=\{\(\) => revoke\.mutate/.test(cm));
  const rr = cm.slice(at(cm, 'const requestRevoke = useCallback('), at(cm, 'const copyRowLink = useCallback('));
  ok('requestRevoke confirms first (Cancel + destructive Remove)',
    /showAlert\(\s*`Remove \$\{c\.email\} from this job\?`/.test(rr) && /\{ text: 'Cancel', style: 'cancel' \}/.test(rr) && /text: 'Remove',\s*style: 'destructive'/.test(rr));
  ok('…and the revoke runs only from the dialog', at(rr, "text: 'Remove'") < at(rr, 'revoke.mutate('));
  ok('a failed revoke says they STILL have access', /onError:[\s\S]{0,200}They still have access to this job\./.test(rr));
  ok('the trash button is labelled "Remove <email>", has hitSlop and a testID',
    /accessibilityLabel=\{`Remove \$\{c\.email\}`\}/.test(cm) && /onPress=\{\(\) => requestRevoke\(c\)\}[\s\S]{0,120}hitSlop=\{10\}/.test(cm) && /testID=\{`collab-revoke-\$\{c\.id\}`\}/.test(cm));
  ok('the row shows a spinner while ITS revoke is pending, and disables the others',
    /revoke\.isPending && revoke\.variables === c\.id \? \(\s*<View[\s\S]{0,160}<ActivityIndicator/.test(cm) && /disabled=\{revoke\.isPending\}/.test(cm));
  ok('revoke stays off the offline queue (server-authoritative)', !/supabaseWrite|offlineQueue/.test(cm.replace(/utils\/offlineQueue/g, '')));
  ok('the invite reports the email outcome ("Emailed to" / "Email not sent")',
    /setLastSend\(\{ email: typed, sent: typeof data\?\.emailSent === 'boolean' \? data\.emailSent : null \}\)/.test(cm)
    && /`Emailed to \$\{lastSend\.email\}\.`/.test(cm) && /`Email not sent to \$\{lastSend\.email\}/.test(cm));
  ok('a pending row can copy its CURRENT link (getLink, no re-send)',
    /isOwner && c\.status === 'pending' \? \(\s*<TouchableOpacity\s*onPress=\{\(\) => copyRowLink\(c\)\}/.test(cm) && /getLink\.mutate\(c\.id/.test(cm));
  ok('the onInvite paywall gate is untouched', (cm.match(/if \(isBillableSeat\(inviteRole\) && !canAccess\('schedule_collaboration'\)\) \{ router\.push\('\/paywall'\); return; \}/g) ?? []).length === 1);
  ok('the Field choice carries the honest scope note (#176)', /inviteRole === 'field' \? \(\s*<Text[^>]*testID="field-scope-note">\{FIELD_ROLE_SCOPE_NOTE\}/.test(cm));

  const rb = read('utils/roleBlinding.ts');
  const descBlock = rb.slice(rb.indexOf('export const ROLE_DESCRIPTIONS'));
  const fieldDesc = /\n\s*field: '([^']*)',/.exec(code(descBlock))?.[1] ?? '';
  ok('the field description no longer promises "no costs or margins" flat', !/no costs or margins/i.test(fieldDesc) && /hidden in the app/i.test(fieldDesc), fieldDesc);
  ok('FIELD_ROLE_SCOPE_NOTE says the server does not yet withhold it', /FIELD_ROLE_SCOPE_NOTE =\s*'[^']*not yet withheld by the server/.test(rb));

  const hook = code(read('hooks/useProjectCollaborators.ts'));
  ok('the hook reads a non-2xx body back (FunctionsHttpError context)', /await ctx\.json\(\)\.catch\(\(\) => null\)/.test(hook));
  ok("the hook exposes getLink → project-invite {action:'getLink'}", /body: \{ action: 'getLink', collaboratorId \}/.test(hook) && /\n\s*getLink,\n\s*\};/.test(hook));
}

// ── #177 project-invite, run ─────────────────────────────────────────────────
console.log('\n#177 project-invite reports the email and never rotates on getLink:');
{
  const fn = read('supabase/functions/project-invite/index.ts');
  const grab = (re: RegExp) => re.exec(fn)?.[0] ?? '';
  const pieces = [
    grab(/function escapeHtml\(v: string\): string \{[\s\S]*?\n\}/),
    grab(/function plainLine\(v: string, max = 80\): string \{[\s\S]*?\n\}/),
    grab(/const ROLE_WORD: Record<string, string> = \{[^\n]*\};/),
    grab(/const ROLE_LINE: Record<string, string> = \{[\s\S]*?\n\};/),
    grab(/async function sendInviteEmail\([\s\S]*?\n\}/),
  ];
  ok('escapeHtml / plainLine / ROLE_* / sendInviteEmail located', pieces.every((p) => p.length > 0));
  if (pieces.every((p) => p.length > 0)) {
    type Send = (to: string, link: string, projectName: string, inviter: string, role: string) => Promise<{ sent: boolean; reason?: string }>;
    const make = (key: string, fetchImpl: (u: string, i: { body: string }) => Promise<unknown>) =>
      new Function('RESEND_API_KEY', 'FROM_EMAIL', 'fetch', 'console', tr(`${pieces.join('\n')}\nreturn sendInviteEmail;`))(
        key, 'MAGE ID <noreply@mageid.app>', fetchImpl, { error: () => {}, log: () => {} },
      ) as Send;
    const r0 = await make('', async () => { throw new Error('must not be called'); })('a@b.co', 'https://x/accept-invite?token=t', 'Job', 'Mike Co', 'field');
    ok('no RESEND_API_KEY → { sent:false, reason:not_configured }', r0.sent === false && r0.reason === 'not_configured');
    const r1 = await make('k', async () => ({ ok: false, status: 422, text: async () => 'invalid to' }))('a@b.co', 'l', 'Job', 'Mike Co', 'field');
    ok('Resend refuses → { sent:false, reason:rejected }', r1.sent === false && r1.reason === 'rejected');
    const r2 = await make('k', async () => { throw new Error('offline'); })('a@b.co', 'l', 'Job', 'Mike Co', 'field');
    ok('the call throws → { sent:false, reason:network }', r2.sent === false && r2.reason === 'network');
    let sentBody: { subject: string; html: string } | null = null;
    const r3 = await make('k', async (_u, init) => { sentBody = JSON.parse(init.body); return { ok: true, status: 200 }; })(
      'a@b.co', 'https://app.mageid.app/accept-invite?token=t', 'Henderson <a href="evil">Remodel</a>', "Mike's Construction", 'field');
    ok('a 2xx → { sent:true }', r3.sent === true);
    const b = sentBody as { subject: string; html: string } | null;
    ok('the subject names who invited him and as what', !!b && /Mike's Construction invited you to Henderson/.test(b.subject) && / as Field/.test(b.subject), b?.subject);
    ok('the project name is HTML-escaped in the body', !!b && !/<a href="evil">/.test(b.html) && /&lt;a href=&quot;evil&quot;&gt;/.test(b.html));
    ok('the body names the inviter and the role', !!b && /<b>Mike&#39;s Construction<\/b> invited you/.test(b.html) && /as <b>Field<\/b>/.test(b.html));
  }
  const inviteBranch = fn.slice(at(fn, 'if (action === "invite") {'), at(fn, '// ── getLink'));
  ok('invite answers with emailSent + emailReason', /emailSent: mail\.sent, emailReason: mail\.reason \?\? null/.test(inviteBranch));
  const getLink = fn.slice(at(fn, 'if (action === "getLink") {'), at(fn, '// ── leave'));
  ok('getLink is owner-only', /ownsCollaboratorsProject\(collaboratorId, caller\.sub\)/.test(getLink) && /403/.test(getLink));
  ok('getLink never mints or writes a token', !/newToken\(|method: "PATCH"|method: "POST"/.test(getLink));
  ok('getLink serves only a still-pending row', /row\.status !== "pending" \|\| !row\.invite_token/.test(getLink));
  const leave = fn.slice(at(fn, 'if (action === "leave") {'), at(fn, '// ── accept'));
  ok("leave (project hub carry) refuses the owner and revokes only the caller's own row",
    /callerOwnsProject\(projectId, caller\.sub\)/.test(leave) && /&user_id=eq\.\$\{encodeURIComponent\(caller\.sub\)\}/.test(leave) && /status: "revoked"/.test(leave));
  ok('leave builds no or=(…) splice from the email', !/or=\(/.test(code(leave)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
