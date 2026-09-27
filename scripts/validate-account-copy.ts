// scripts/validate-account-copy.ts — the words on the paywall, the team
// manager, the client-facing screens and the emails stay in docs/VOICE.md.
//
// WHY THIS EXISTS. The founder, 2026-09-27: "throughout the entire app
// there's a lot of vibe coded wording, lower case wording, things like that
// that clearly show this app is vibe coded". The copy pass (lane ACCOUNT)
// fixed the first words a paying GC reads and the words his client reads. A
// few of those fixes live in shared tables that one careless edit reverts for
// every screen at once, so this guard pins the tables, not individual screens:
//
//   1. The purchase alerts say "You're on Pro", never "Welcome to Pro!".
//   2. Every Title Case feature string a caller hands components/Paywall has a
//      sentence-case heading in FEATURE_TITLE (the key itself stays, callers
//      and FEATURE_PITCH match on it).
//   3. The team-size messages a GC reads (utils/seatModel) never say "seat"
//      and print plan names capitalised.
//   4. AI limit messages (utils/aiRateLimiterCore) name features in sentence
//      case and never say "unlock".
//   5. No emoji in email subjects or push titles: supabase/functions/_shared
//      /email.ts no longer exports the EMOJI map and notify/index.ts uses none.
//   6. The English client portal bundle (utils/portalLanguages.ts `en`) has no
//      hard-coded ALL CAPS label and no emoji; the portal page's English
//      fallback agrees with it key for key.
//   7. A server error reaches the sign-in link and team-invite screens only
//      when it reads as a sentence written for a person (readerSentence, one
//      copy in app/login.tsx and one in CollaboratorsManager, kept identical).
//      "Invalid email.", "Could not create invite (502)" and supabase-js's
//      "non-2xx status code" get describeError copy instead (VOICE rule 7).
//   8. No `\u2019`-style escape sits in bare JSX text on these screens: JSX
//      text is not a string literal, so the reader sees the backslash.
//
// Pure: reads source text and imports two pure modules. Run:
//   bun run scripts/validate-account-copy.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FEATURE_CONFIG } from '../utils/aiRateLimiterCore';
import { previewSeat, countSeats } from '../utils/seatModel';
import { PORTAL_UI_STRINGS } from '../utils/portalLanguages';

// tsc checks scripts/ against the app's react-native lib set, which has no Bun
// global; the one API section 7 uses is declared rather than pulling in @types/bun.
declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync(code: string): string };
};

const ROOT = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); return; }
  fail++;
  console.log(`  ✗ ${name}${detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
// Proper nouns, named features (VOICE.md section 3), plan names and acronyms
// are removed first; what is left may not capitalise a word after the first.
const PROPER = /Cost X-Ray|Schedule Pro|Home Passport|Ask MAGE|Ask Your Home|Last Planner|MAGE ID|MAGE|QuickBooks|Gantt|\b(Free|Pro|Business|Enterprise|AI|ID|CO|RFIs?|COI|PDF|WIP|CPM|EVM|GMP|OSHA|JHAs?|T&M|G702\/G703|AIA|OAC)\b/g;
const isTitleCase = (s: string) => /\s\(?[A-Z][a-z]+/.test(s.replace(PROPER, 'x'));

// ── 1. purchase alerts ──────────────────────────────────────────────────────
console.log('\n1. purchase alerts');
for (const f of ['app/paywall.tsx', 'components/Paywall.tsx', 'app/onboarding-paywall.tsx']) {
  const src = read(f);
  ok(`${f}: no "Welcome to …!"`, !/Welcome to [^'"`]*!/.test(src));
  ok(`${f}: no "Purchase Failed" / "Please try again."`, !/Purchase Failed|Please try again\./.test(src));
}
ok('app/paywall.tsx: the Pro alert says "You\'re on Pro"', /showAlert\("You're on Pro", 'Every Pro feature is on for your account\.'\)/.test(read('app/paywall.tsx')));

// ── 2. Paywall headings ─────────────────────────────────────────────────────
console.log('\n2. Paywall headings for Title Case feature strings');
{
  const src = read('components/Paywall.tsx');
  const pitchBlock = src.slice(src.indexOf('const FEATURE_PITCH'), src.indexOf('\n};', src.indexOf('const FEATURE_PITCH')));
  const titleBlock = src.slice(src.indexOf('const FEATURE_TITLE'), src.indexOf('\n};', src.indexOf('const FEATURE_TITLE')));
  ok('FEATURE_PITCH and FEATURE_TITLE were found', pitchBlock.length > 100 && titleBlock.length > 100);
  const pitchKeys = [...pitchBlock.matchAll(/^\s{2}'([^']+)':/gm)].map((m) => m[1]);
  const titles = new Map([...titleBlock.matchAll(/^\s{2}(?:'([^']+)'|(\w+)):\s*'([^']+)'/gm)].map((m) => [m[1] ?? m[2], m[3]]));
  // A key needs a heading when it reads as Title Case (a second capitalised
  // ordinary word). Named features (Cost X-Ray, Last Planner, Construction AI)
  // and plain words ("Invoicing", "Contracts") print as they are.
  const needsHeading = pitchKeys.filter(isTitleCase);
  const missing = needsHeading.filter((k) => !titles.has(k));
  ok('every Title Case pitch key has a sentence-case heading', missing.length === 0, missing);
  const titleCaseHeadings = [...titles.values()].filter(isTitleCase);
  ok('no heading is itself Title Case', titleCaseHeadings.length === 0, titleCaseHeadings);
  ok('the heading is what renders (FEATURE_TITLE[feature] ?? feature)', /const featureTitle = FEATURE_TITLE\[feature\] \?\? feature;/.test(src));
  ok('no pitch says "kept honest" or "not a guess"', !/kept honest|not a guess/.test(pitchBlock));
}

// ── 3. team-size messages ───────────────────────────────────────────────────
console.log('\n3. team-size messages (utils/seatModel)');
{
  const none = countSeats([]);
  const row = (email: string, role: 'editor' | 'viewer' | 'field') => ({ email, role, status: 'accepted' }) as never;
  const two = countSeats([row('a@x.com', 'editor'), row('b@x.com', 'editor')]);
  const msgs = [
    previewSeat('pro', none, 'field').message,
    previewSeat('free', none, 'editor').message,
    previewSeat('pro', none, 'editor').message,
    previewSeat('pro', two, 'editor').message,
    previewSeat('pro', two, 'editor', 'a@x.com').message,
  ];
  const seat = msgs.filter((m) => /\bseats?\b/i.test(m));
  ok('no message says "seat"', seat.length === 0, seat);
  const lowerPlan = msgs.filter((m) => /\b(on|your) (pro|business|enterprise|free)\b/.test(m));
  ok('plan names are capitalised', lowerPlan.length === 0, lowerPlan);
  ok('the inside-allowance message names Pro', /left on Pro\./.test(msgs[2]), msgs[2]);
}

// ── 4. AI limit messages ────────────────────────────────────────────────────
console.log('\n4. AI limit display names and messages (utils/aiRateLimiterCore)');
{
  const names = Object.values(FEATURE_CONFIG).map((c) => c.displayName ?? '');
  const bad = names.filter(isTitleCase);
  ok('every displayName is sentence case (named features excepted)', bad.length === 0, bad);
  const src = read('utils/aiRateLimiterCore.ts');
  ok('no "unlock" in a limit message', !/`[^`]*unlock[^`]*`/i.test(src));
  ok('a Pro-only feature reads "is on the Pro plan"', /is on the Pro plan\. \$\{proAllowanceSentence/.test(src));
}

// ── 5. email subjects and push titles ───────────────────────────────────────
console.log('\n5. email subjects and push titles');
{
  const shared = read('supabase/functions/_shared/email.ts');
  ok('_shared/email.ts no longer exports EMOJI', !/export const EMOJI\b/.test(shared));
  const notify = read('supabase/functions/notify/index.ts');
  ok('notify/index.ts imports no EMOJI', !/\bEMOJI\b/.test(notify));
  const lines = notify.split('\n').filter((l) => /(emailSubject|pushTitle|subject)\s*:/.test(l));
  const emoji = lines.filter((l) => EMOJI.test(l));
  ok('no subject or push title carries an emoji', emoji.length === 0, emoji.map((l) => l.trim()));
  ok('the closeout email subject is "Closeout binder ready · <project>"', /subject: `Closeout binder ready · \$\{projectName\}`/.test(notify));
  ok('the award push title is "Bid won · <project>"', /pushTitle: `Bid won · \$\{projectName\}`/.test(notify));
}

// ── 6. client portal English bundle ─────────────────────────────────────────
console.log('\n6. client portal English strings');
{
  const en = PORTAL_UI_STRINGS.en as unknown as Record<string, string>;
  const caps = Object.entries(en).filter(([, v]) => /^[^a-z]*[A-Z]{3,}[^a-z]*$/.test(v));
  ok('no ALL CAPS label in the English bundle', caps.length === 0, caps);
  const emoji = Object.entries(en).filter(([, v]) => EMOJI.test(v));
  ok('no emoji in the English bundle', emoji.length === 0, emoji);
  const page = read('marketing/portal/index.html');
  const block = page.slice(page.indexOf('var FALLBACK_STRINGS = {'), page.indexOf('\n  };', page.indexOf('var FALLBACK_STRINGS = {')));
  const fallback = new Map([...block.matchAll(/^\s{4}(\w+): '((?:[^'\\]|\\.)*)',/gm)].map((m) => [m[1], m[2].replace(/\\'/g, "'")]));
  const drift = Object.entries(en).filter(([k, v]) => fallback.has(k) && k !== 'closeoutPrint' && fallback.get(k) !== v).map(([k]) => k);
  ok('the page fallback matches the English bundle key for key', drift.length === 0, drift);
}

// ── 7. server sentences on the sign-in link and invite screens ─────────────
console.log('\n7. server sentences pass through only when written for a person');
{
  const grab = (f: string) => {
    const src = read(f);
    const a = src.indexOf('// reader-sentence:start');
    const b = src.indexOf('// reader-sentence:end');
    return a >= 0 && b > a ? src.slice(a, b) : '';
  };
  const login = grab('app/login.tsx');
  const collab = grab('components/collaborators/CollaboratorsManager.tsx');
  ok('app/login.tsx has the readerSentence block', login.includes('function readerSentence('));
  ok('CollaboratorsManager has the same readerSentence block', login !== '' && login === collab);
  ok('login shows the magic-link error only through readerSentence', /readerSentence\(rawErrorMessage\(err\)\)/.test(read('app/login.tsx')) && !/\?\s*rawErrorMessage\(err\)/.test(read('app/login.tsx')));
  ok('the invite error shows only through readerSentence', /readerSentence\(rawErrorMessage\(invite\.error\)\)/.test(read('components/collaborators/CollaboratorsManager.tsx')) && !/\?\s*rawErrorMessage\(invite\.error\)/.test(read('components/collaborators/CollaboratorsManager.tsx')));
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(login);
  const readerSentence = new Function(`${js}; return readerSentence;`)() as (raw: string) => string | null;
  const shown = [
    'Too many sign-in requests. Wait a few minutes and try again.',
    "Couldn't create the sign-in link. Try again.",
    'Couldn’t send the sign-in email. Try again.',
    'That email address looks off. Check it and try again.',
    "dana.smith@x.com is already on this job. To change what they can see, use the role buttons on their row.",
    'Your plan includes 2 team seats and 2 are in use. Upgrade for more, or invite them as Field — field access is always free.',
  ];
  const hidden = [
    'Invalid email.',
    'Unknown purpose.',
    'Server not configured.',
    'Invalid JSON body.',
    'Unauthenticated',
    'Method not allowed',
    'Only the project owner can invite collaborators',
    'Could not create invite (502)',
    'Could not check this invite (502). Try again.',
    "Couldn't send the sign-in link. Try again. (HTTP 500)",
    'projectId, a valid email, and role (editor|viewer|field) are required',
    'Edge Function returned a non-2xx status code',
    'Failed to fetch',
    'TypeError: Network request failed.',
    "Cannot read properties of undefined (reading 'id').",
    '{"code":"PGRST301"}',
  ];
  const wrongHidden = shown.filter((t) => readerSentence(t) !== t);
  const wrongShown = hidden.filter((t) => readerSentence(t) !== null);
  ok('every sentence written for the reader is shown as is', wrongHidden.length === 0, wrongHidden);
  ok('every terse or technical message falls back to describeError', wrongShown.length === 0, wrongShown);
  // The magic-link function's own static answers: the terse ones (no period
  // or under four words) must fall back; the rest are sentences.
  const fn = read('supabase/functions/auth-magic-link/index.ts');
  const literals = [...fn.matchAll(/error: (['"])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
  ok('auth-magic-link still answers with static error sentences', literals.length >= 6, literals.length);
  const leaks = literals.filter((t) => readerSentence(t) !== null && (t.split(/\s+/).length < 4 || !t.endsWith('.')));
  ok('no auth-magic-link terse note passes through', leaks.length === 0, leaks);
}

// ── 8. no escape sequences in bare JSX text ─────────────────────────────────
console.log('\n8. no \\uXXXX escape in bare JSX text');
{
  const files = [
    'app/(tabs)/settings/_layout.tsx', 'app/(tabs)/settings/appearance.tsx', 'app/(tabs)/settings/index.tsx',
    'app/accept-invite.tsx', 'app/client-outbox.tsx', 'app/client-portal-setup.tsx', 'app/client-update.tsx',
    'app/closeout-binder.tsx', 'app/handover.tsx', 'app/home-passport.tsx', 'app/login.tsx',
    'app/onboarding-paywall.tsx', 'app/onboarding.tsx', 'app/paywall.tsx', 'app/persona-select.tsx',
    'app/reset-password.tsx', 'app/selections.tsx', 'app/shared-estimate.tsx', 'app/signup.tsx',
    'app/warranty-walk.tsx', 'components/ClientHome.tsx', 'components/Paywall.tsx',
    'components/QboSuccessCheckmark.tsx', 'components/SendPortalLinkModal.tsx', 'components/SignaturePad.tsx',
    'components/WarrantyWalkBanner.tsx', 'components/collaborators/CollaboratorsManager.tsx',
    'components/collaborators/PendingInvitesCard.tsx', 'components/passport/HomePassportCard.tsx',
    'components/passport/PassportSection.tsx', 'components/settings/SettingsPanes.tsx',
  ];
  const hits: string[] = [];
  for (const f of files) {
    read(f).split('\n').forEach((line, i) => {
      // A line with no quote, backtick or regex slash on it is JSX text.
      if (/\\u[0-9a-fA-F]{4}/.test(line) && !/['"`\/]/.test(line)) hits.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  ok('no bare JSX text line carries a \\uXXXX escape', hits.length === 0, hits);
  ok('the Settings danger note reads "can’t be undone" with a real apostrophe', /Deleting your account can&apos;t be undone\./.test(read('app/(tabs)/settings/index.tsx')));
}

// ── 9. closeout binder failures say what is true ────────────────────────────
console.log('\n9. closeout binder failures say what is true');
{
  const src = read('app/closeout-binder.tsx');
  // saveCloseoutBinder upserts straight to Supabase: nothing is kept on the
  // device, so the failure may not borrow describeError's "still on this
  // device" line. The edits survive only while the screen stays open.
  ok('the binder save failure makes no on-device claim', !/action: 'save the binder', keptLocally: true/.test(src));
  ok('the binder save failure says the edits are still on this screen', /Your edits are still on this screen\. Try again before you leave\./.test(src));
  // The button reads "Rebuild Home Passport" once one exists, so the alert
  // names no button.
  ok('the Home Passport failure names no button', !/tap Create again/.test(src));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
