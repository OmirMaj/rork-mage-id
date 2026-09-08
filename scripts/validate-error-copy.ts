// scripts/validate-error-copy.ts — a contractor never reads a stack trace, and
// a failed read is never drawn as an empty one.
//
// WHY THIS EXISTS. Two findings from the 2026-09-07 app-experience audit, both
// in the "errors that say something" family:
//
//   "Worth doing" #7 — 46 alerts printed the raw exception as the message body
//   and six did it with no fallback string at all. app/takeoff-estimate.tsx:518
//   and :554 were the named pair: `showAlert('Save failed', e instanceof Error
//   ? e.message : String(e))` after a GC had spent twenty minutes pricing a
//   takeoff. He got "Could not find the 'markup' column of 'estimates' in the
//   schema cache" and no answer to the only question he had — is my work gone?
//
//   "Worth doing" #8 — components/ErrorBoundary.tsx was the only boundary in
//   the repo and wrapped the whole tree, which is why its own comment has to
//   explain that recovery means restarting the JS bundle.
//
// …plus the four `sourceFailed` gates the first fix wave could not reach: the
// tab badge, the Home list's empty state, Report Inbox and Activity.
//
// THE ONE RULE THIS PINS, in both directions:
//
//   A FAILED READ IS AN ERROR STATE. AN EMPTY ACCOUNT IS AN EMPTY STATE.
//   Getting the second one wrong is worse than the bug it fixes — a brand-new
//   GC told "Couldn't reach MAGE" on his first launch has no way in — so every
//   ordering assertion below also asserts the friendly copy SURVIVED.
//
// The copy half is executable: utils/errorCopy.ts is pure by design (no
// react-native, no imports at all), so this guard runs the real classifier
// over the real error shapes instead of grepping for its silhouette.
//
// Run via: bun run test:error-copy

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { classifyError, describeError, errorCode, rawErrorMessage } from '../utils/errorCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); }
  else { fail++; console.log('  ✗', n, extra ? `\n     ${extra}` : ''); }
}

console.log('\nerror copy + failed-read honesty');

// ── 1. The classifier, over the shapes the app actually throws ──────────────
// Supabase hands back a PostgrestError ({message, code, details, hint}), edge
// functions throw with a `status`, fetch throws a bare TypeError, and plenty of
// call sites throw strings.
const SAMPLES: { label: string; err: unknown; kind: string }[] = [
  { label: 'PostgREST schema-cache miss (the takeoff save case)', kind: 'schema',
    err: { message: "Could not find the 'markup' column of 'estimates' in the schema cache", code: 'PGRST204' } },
  { label: 'PostgREST missing RPC', kind: 'schema', err: { message: 'function does not exist', code: 'PGRST202' } },
  // Mutation-testing note: the sample above is ALSO caught by the message-text
  // fallback ("schema cache"), so deleting the PGRST204 code branch left the
  // guard green. This one carries the code and nothing else, so the code path
  // is the only thing that can classify it.
  { label: 'PGRST204 with an opaque body', kind: 'schema', err: { message: 'Bad Request', code: 'PGRST204' } },
  { label: 'expired JWT', kind: 'session', err: { message: 'JWT expired', code: 'PGRST301' } },
  { label: 'bare 401 from an edge function', kind: 'session', err: { message: 'Unauthorized', status: 401 } },
  { label: 'RLS refusal', kind: 'permission', err: { message: 'new row violates row-level security policy', code: '42501' } },
  { label: '403', kind: 'permission', err: { message: 'Forbidden', status: 403 } },
  { label: 'duplicate key', kind: 'conflict', err: { message: 'duplicate key value violates unique constraint', code: '23505' } },
  { label: 'no rows (PGRST116)', kind: 'notFound', err: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } },
  { label: 'AI relay rate limit', kind: 'rateLimit', err: { message: 'Too Many Requests', status: 429 } },
  { label: 'RN fetch with no network', kind: 'offline', err: new TypeError('Network request failed') },
  { label: 'web fetch with no network', kind: 'offline', err: new TypeError('Failed to fetch') },
  { label: 'gateway timeout', kind: 'timeout', err: { message: 'upstream timed out', status: 504 } },
  { label: 'aborted request', kind: 'cancelled', err: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }) },
  { label: '500 from an edge function', kind: 'server', err: { message: 'Internal Server Error', status: 500 } },
  { label: 'something nobody predicted', kind: 'unknown', err: new Error('boom') },
];

for (const s of SAMPLES) {
  ok(`classify: ${s.label} → ${s.kind}`, classifyError(s.err) === s.kind, `got ${classifyError(s.err)}`);
}

// A new ErrorKind added without copy and without a sample here is a kind that
// falls through to whatever `sentence()` does with it. Cross-check the union in
// the source against the table above so it cannot happen quietly.
{
  const copySrc = src('utils/errorCopy.ts');
  const union = /export type ErrorKind =([\s\S]*?);/.exec(copySrc)?.[1] ?? '';
  const declared = [...union.matchAll(/'([a-zA-Z]+)'/g)].map(m => m[1]);
  const covered = new Set(SAMPLES.map(s => s.kind));
  ok('every ErrorKind in the union has a sample in this table',
    declared.length >= 11 && declared.every(k => covered.has(k)),
    `uncovered: ${declared.filter(k => !covered.has(k)).join(', ') || '(none)'}`);
}

// ── 2. The raw exception never reaches the body ─────────────────────────────
// This is the whole finding. Every sample, every context permutation.
{
  let leaked = '';
  for (const s of SAMPLES) {
    const raw = rawErrorMessage(s.err);
    for (const keptLocally of [true, false, undefined]) {
      const copy = describeError(s.err, { action: 'save this estimate', keptLocally });
      if (raw.length > 6 && copy.body.includes(raw)) leaked = `${s.label} (keptLocally=${String(keptLocally)})`;
      if (copy.title.includes(raw) && raw.length > 6) leaked = `${s.label} title`;
    }
  }
  ok('describeError never puts the thrown text in the title or body', leaked === '', leaked);

  // …and the specific string from the audit, which is what a GC actually saw.
  const audit = describeError(
    { message: "Could not find the 'markup' column of 'estimates' in the schema cache", code: 'PGRST204' },
    { action: 'save this estimate to the project', keptLocally: true },
  );
  ok('the audit\'s own example no longer prints the schema-cache sentence',
    !/schema cache|column of/.test(audit.body));
  ok('…it names what failed, in his words', audit.body.includes('save this estimate to the project'));
  ok('…it gives one concrete next step', /reopen it|try again/i.test(audit.body));
  ok('…it answers "is my work gone?"', /still on this device/.test(audit.body));
  ok('…and it carries the reference code support would ask for', audit.body.includes('PGRST204'));
}

// ── 3. Every body: what happened, what to do, and never "Error" as a title ──
{
  const NEXT_STEP = /try again|sign out|reopen|wait about|ask whoever|change it|refresh|start it again|check your signal/i;
  let bad = '';
  for (const s of SAMPLES) {
    const copy = describeError(s.err, { action: 'load your reports' });
    if (!NEXT_STEP.test(copy.body)) bad = `${s.label}: no next step`;
    if (!copy.body.includes('load your reports')) bad = `${s.label}: doesn't name the action`;
    if (/^error$/i.test(copy.title.trim())) bad = `${s.label}: bare "Error" title`;
    if (copy.body.length < 60) bad = `${s.label}: body too short to be a sentence with a step`;
  }
  ok('every classified error yields action + next step + a real title', bad === '', bad);

  // …and the next step never names a control this module cannot know is on
  // screen (review 2026-09-07). `describeError` formats modal ALERT bodies as
  // much as list states — its first three adopters are alerts on
  // app/takeoff-estimate.tsx, which has no pull-to-refresh — so "pull down to
  // refresh" sent a GC hunting for a gesture that does not exist on the screen
  // he was looking at. That is the same defect as the raw exception this
  // module replaced: copy pointing him at something that is not there.
  const PHANTOM_CONTROL = /pull (down|to refresh)|swipe (down|left|right)|tap the .{1,30} (button|icon|tab)|press the .{1,30} button|top[- ]right|bottom[- ]right/i;
  let phantom = '';
  for (const s3 of SAMPLES) {
    for (const keptLocally of [true, false, undefined]) {
      const body = describeError(s3.err, { action: 'load your reports', keptLocally }).body;
      if (PHANTOM_CONTROL.test(body)) phantom = `${s3.label}: ${body}`;
    }
  }
  ok('no generic body names a control that may not be on the screen showing it', phantom === '', phantom);
}

// ── 4. The work-survival sentence is the caller's call, never a guess ───────
{
  const err = { message: 'x', code: '23505' };
  const kept = describeError(err, { action: 'save this', keptLocally: true }).body;
  const lost = describeError(err, { action: 'save this', keptLocally: false }).body;
  const unknown = describeError(err, { action: 'save this' }).body;
  ok('keptLocally true says the work survived', /still on this device/.test(kept));
  ok('keptLocally false says it did not', /was not saved/.test(lost));
  ok('omitted says nothing either way — a guess about his work is worse than silence',
    !/still on this device/.test(unknown) && !/was not saved/.test(unknown));
}

// ── 5. Reference codes: only where the server actually spoke ────────────────
{
  const offline = describeError(new TypeError('Network request failed'), { action: 'save this' });
  ok('an offline failure carries no reference code (there was no server to give one)',
    !/Reference:/.test(offline.body) && offline.code === null);
  const cancelled = describeError(Object.assign(new Error('aborted'), { name: 'AbortError', status: 499 }), { action: 'save this' });
  ok('a cancel carries no reference code — it is not a fault', !/Reference:/.test(cancelled.body));
  ok('errorCode reads a bare HTTP status when there is no PostgREST code',
    errorCode({ status: 503 }) === 'HTTP 503' && errorCode({ message: 'x' }) === null);

  // …and the direction the first draft of this guard did NOT cover (review
  // 2026-09-07). Asserting that a code is PRESENT when the server gave one
  // says nothing about the case that actually shipped: `unknown` is the
  // DEFAULT bucket — every plain `new Error('…')` in the app lands there and
  // carries no code — and its body ended "send support the reference below"
  // with no reference printed anywhere. That is the same defect as the raw
  // exception it replaced: copy pointing a contractor at something that is
  // not on his screen. Never promise a reference that is not appended.
  {
    let promised = '';
    for (const s of [...SAMPLES,
      { label: 'bare Error, no code (the default bucket)', kind: 'unknown', err: new Error('boom') },
      { label: '500 recognised only by its text', kind: 'server', err: { message: 'internal server error' } },
      { label: 'a thrown string', kind: 'unknown', err: 'it broke' },
    ]) {
      for (const keptLocally of [true, false, undefined]) {
        const copy = describeError(s.err, { action: 'save this estimate', keptLocally });
        if (/reference below/i.test(copy.body) && !/\(Reference: /.test(copy.body)) {
          promised = `${s.label} (keptLocally=${String(keptLocally)}): ${copy.body}`;
        }
      }
    }
    ok('no body points at a "reference below" that is not printed below it', promised === '', promised);

    // The other half of the same promise, and the hole the FIRST version of
    // this guard left open (review 2026-09-07, mutation test): loosening the
    // `code !== null` gate to anything truthier prints a literal
    // "(Reference: null)" — the promise is technically kept and the assertion
    // above stays green while a contractor is told to quote "null" to
    // support. A reference is only a reference when it is one.
    let junk = '';
    for (const s2 of [...SAMPLES, { label: 'a thrown string', err: 'it broke' }]) {
      for (const keptLocally of [true, false, undefined]) {
        const body = describeError(s2.err, { action: 'save this estimate', keptLocally }).body;
        const ref = /\(Reference: ([^)]*)\)/.exec(body);
        // "null" and "undefined" are the two that actually ship — they are
        // what String(code) yields when the gate above lets a codeless error
        // through — and they are alphanumeric, so they pass a shape test.
        // Name them.
        if (ref && (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(ref[1]) || /^(null|undefined|NaN)$/i.test(ref[1].trim()))) {
          junk = `${s2.label}: ${body}`;
        }
      }
    }
    ok('a printed reference is always a real code — never "null", never blank', junk === '', junk);
  }
}

// ── 6. The shared primitive, lifted rather than rewritten ───────────────────
{
  const es = src('components/ErrorState.tsx');
  ok('ErrorState exists and is the default export', /export default function ErrorState/.test(es));
  ok('ErrorState carries the retry the load-failure sites need', /onRetry\?: \(\) => void/.test(es));
  ok('ErrorState keeps the prequal original\'s way out (onBack)', /onBack\?: \(\) => void/.test(es));
  // The standing accessibility rule: #FF6A1A is 2.87:1 and must never sit
  // behind white text. The prequal original already used accentFill.
  ok('ErrorState\'s white-label button is accentFill, never the raw accent',
    /primaryBtn:[^}]*backgroundColor: t\.accentFill/.test(es)
    && !/primaryBtn:[^}]*backgroundColor: t\.accent\b/.test(es));

  const pq = src('app/prequal-form.tsx');
  ok('prequal-form renders the shared ErrorState now', /import ErrorState from '@\/components\/ErrorState'/.test(pq));
  ok('prequal-form no longer defines its own copy of it', !/function ErrorState\(/.test(pq));
  ok('prequal-form\'s save failure no longer prints error.message as the body',
    !/showAlert\('Save failed', error\.message\)/.test(pq) && /describeError\(error, \{ action:/.test(pq));
  ok('prequal-form\'s load failure classifies rather than forwarding the raw message',
    !/setLoadError\(error\.message\)/.test(pq) && /setLoadError\(describeError\(/.test(pq));
  ok('prequal-form offers a retry on the load failure, not just Close',
    /onRetry=\{\(\) => \{ setLoadError\(null\)/.test(pq));
}

// ── 7. The two named alert sites ────────────────────────────────────────────
{
  const tk = src('app/takeoff-estimate.tsx');
  ok('takeoff-estimate: no alert body is the thrown text any more',
    !/showAlert\('Save failed', e instanceof Error \? e\.message : String\(e\)\)/.test(tk));
  ok('takeoff-estimate: both save paths classify (replace + append)',
    (tk.match(/describeError\(e, \{ action:/g) ?? []).length >= 2);
  ok('takeoff-estimate: the pricing banner classifies too — it had the same defect',
    !/setPricingError\(e instanceof Error \? e\.message : String\(e\)\)/.test(tk)
    && /setPricingError\(describeError\(/.test(tk));
  ok('takeoff-estimate: the raw text still reaches the log, where an engineer reads it',
    (tk.match(/rawErrorMessage\(e\)/g) ?? []).length >= 3);
}

// ── 8. Route-level boundaries ───────────────────────────────────────────────
{
  const eb = src('components/ErrorBoundary.tsx');
  ok('a route-level fallback exists beside the app-level one',
    /export function RouteErrorFallback/.test(eb));
  ok('the route fallback recovers INSIDE the router — no bundle restart',
    /router\.canGoBack\(\)/.test(eb)
    && !/RouteErrorFallback[\s\S]*?reloadAsync/.test(eb));
  ok('the route fallback reports to Sentry — expo-router\'s <Try> does not',
    /boundary: 'route'/.test(eb));
  ok('the app-level boundary still restarts the bundle (it is above the router, and must)',
    /reloadAsync/.test(eb));
  ok('the route fallback re-labels its primary button — "Restart at Home" is a lie one route down',
    /primaryLabel="Go Back"/.test(eb));
  // …but NOT its testID. validate-contrast Check 7 (MISS-03) proves the crash
  // card offers a route out by grepping this file for the literal JSX
  // attribute `testID="error-boundary-home"`. The first draft of this wave
  // routed it through a `primaryTestID` prop default, which left the string
  // present only in single quotes in a parameter list — the attribute was
  // gone, Check 7 went red, and with it the whole 231-guard ship-check
  // (review 2026-09-07). The two cards are told apart by the route card's
  // wrapper instead.
  ok('the crash card\'s exit keeps the literal testID validate-contrast pins',
    /accessibilityLabel=\{primaryLabel\}[\s\S]{0,700}?testID="error-boundary-home"/.test(eb)
    && !/primaryTestID/.test(eb));
  ok('…and the route card is still identifiable on its own',
    /testID="route-error-fallback"/.test(eb));
  // The dead-tap case (review 2026-09-07). <Try> keeps `error` in its OWN
  // component state, so navigation does not clear it. Home is the app's
  // initial route: canGoBack() is false there and the fallback's replace
  // target IS the route already on screen, so without a retry() on that path
  // the primary button on the most likely crash site did visibly nothing.
  //
  // Matched as a SPAN with nothing returning out of it, not as mere textual
  // adjacency (review 2026-09-07, mutation test): `router.replace(…); return;`
  // left `void retry()` sitting unreachable three lines below and the first
  // version of this assertion — a lazy `[\s\S]{0,900}?` between the two —
  // stayed green over a primary button that once again did visibly nothing.
  {
    const span = /router\.replace\('\/\(tabs\)\/\(home\)'\);([\s\S]{0,900}?)void retry\(\);/.exec(eb);
    ok('the route fallback clears the boundary when the replace may be a no-op',
      !!span && !/\breturn\b|\bthrow\b/.test(span[1]),
      span ? `unreachable — the span between them returns: ${JSON.stringify(span[1].slice(0, 120))}` : 'no retry() after the replace');
  }

  // expo-router wraps any route/layout module that exports `ErrorBoundary`.
  for (const rel of [
    'app/(tabs)/_layout.tsx',
    'app/(tabs)/(home)/index.tsx',
    'app/report-inbox.tsx',
    'app/activity-feed.tsx',
    'app/notifications-inbox.tsx',
    'app/takeoff-estimate.tsx',
    'app/prequal-form.tsx',
  ]) {
    ok(`${rel}: exports its own ErrorBoundary`,
      /export \{ RouteErrorFallback as ErrorBoundary \} from '@\/components\/ErrorBoundary';/.test(src(rel)));
  }
}

// ── 9. The four sourceFailed gates ──────────────────────────────────────────
// Each one asserts BOTH directions: the failed read reaches the error copy,
// AND the brand-new account still reaches the friendly one.
{
  const tabs = src('app/(tabs)/_layout.tsx');
  ok('tab layout: sourceFailed is no longer destructured away',
    /const \{ total: attentionCount, sourceFailed \} = useBrainWatch\(\)/.test(tabs));
  ok('tab layout: a failed read does not render as a clean, badge-free tab',
    /const attentionBadge = sourceFailed[\s\S]{0,40}\? '!'/.test(tabs));
  ok('tab layout: a real zero still shows no badge (calm is the reward for being caught up)',
    /: undefined;/.test(tabs));
  ok('tab layout: VoiceOver is told why the badge is there',
    /couldn't reach MAGE/.test(tabs));

  const home = src('app/(tabs)/(home)/index.tsx');
  ok('home: the list empty state reads sourceFailed', /sourceFailed, retryRemoteReads,/.test(home));
  // Mutation-testing note: `home.indexOf('sourceFailed ? (')` also matches
  // inside `!sourceFailed ? (`, so negating the condition — which shows a
  // brand-new GC "Couldn't reach MAGE" on his first launch, the worst possible
  // version of this — sailed straight past the first draft of this assertion.
  // Pin the CONSEQUENT of each arm, and that the condition is not negated.
  ok('home: the failed read is branched BEFORE the day-one onboarding card',
    /(^|[^!])sourceFailed \? \(\s*<ErrorState/m.test(home)
    && home.indexOf('sourceFailed ? (') < home.indexOf('title="Build something"'));
  // Gated on the BOOK, not on this list's emptiness (review 2026-09-07). The
  // first draft used `sourceFailed` alone, and this ListEmptyComponent fires
  // in two states that are not "he has nothing": the status chips narrow the
  // data to `filteredProjects`, and at tablet+ widths `data` is hard-wired to
  // `[]` (the rows render as a table in ListFooterComponent). So an offline GC
  // with twenty cached projects was told they "didn't come back" — on desktop,
  // printed directly above the table listing them. Same rule report-inbox got
  // right on `rows`.
  {
    // Pins the WHOLE condition, not a substring of it: every arm that reaches
    // <ErrorState> must be preceded by the `projects.length === 0 &&` gate.
    // Anything else — dropping it, or re-gating on `filteredProjects.length`
    // — leaves exactly one arm whose prefix does not match, and fails here.
    const arms = [...home.matchAll(/(.{0,30})sourceFailed \? \(\s*<ErrorState/g)];
    ok('home: the failure copy cannot fire while the GC still has projects',
      arms.length === 1 && arms[0][1].endsWith('projects.length === 0 && '),
      arms.map(a => JSON.stringify(a[1])).join(' | ') || '(no arm found)');
  }
  // At tablet+ widths the FlatList's `data` is `[]` by design (rows render as
  // a table in ListFooterComponent), so ListEmptyComponent fires for EVERY GC
  // on the web app — "Create your first project" printed above the table of
  // his twenty jobs. An empty state is a claim; do not make it over rows that
  // are on screen (review 2026-09-07).
  ok('home: the empty state stays silent when the desktop table has rows in it',
    /ListEmptyComponent=\{\s*(\/\/[^\n]*\n\s*)*useDenseRows && filteredProjects\.length > 0 \? null :/.test(home));
  ok('home: a brand-new account still gets "Build something" and its CTA',
    /\) : \(\s*<EmptyState/.test(home)
    && /title="Build something"/.test(home) && /actionLabel="Create your first project"/.test(home));
  ok('home: the failure state offers the retry, not project creation',
    /onRetry=\{retryRemoteReads\}/.test(home) && /testID="home-unreachable"/.test(home));

  const inbox = src('app/report-inbox.tsx');
  ok('report inbox: the failed read is told apart from an empty slice',
    /rows\.length === 0 && sourceFailed \? \(\s*<ErrorState/.test(inbox));
  ok('report inbox: it is gated on rows, not on `filtered` — a chip that matches nothing is not a failure',
    !/filtered\.length === 0 && sourceFailed/.test(inbox));
  ok('report inbox: the teaching empty state survived for a new account',
    /title="Nothing in this slice"/.test(inbox)
    && inbox.indexOf('rows.length === 0 && sourceFailed') < inbox.indexOf('title="Nothing in this slice"'));
  ok('report inbox: the failure offers a retry', /onRetry=\{retryRemoteReads\}/.test(inbox));

  const feed = src('app/activity-feed.tsx');
  ok('activity: the failed read is branched ahead of "No activity yet"',
    /items\.length === 0 && sourceFailed \? \(\s*<ErrorState/.test(feed)
    && feed.indexOf('items.length === 0 && sourceFailed') < feed.indexOf('title="No activity yet"'));
  ok('activity: a genuinely quiet project still gets the friendly copy',
    /title="No activity yet"/.test(feed));
  ok('activity: the header stops reporting "0 events" as a fact it does not have',
    /\? 'Not loaded'/.test(feed));

  const notif = src('app/notifications-inbox.tsx');
  // Matched on the JSX literal, not the prose — the comment above the branch
  // quotes the sentence too, and grepping for the quote found the comment.
  ok('notifications: "You\'re all caught up" is unreachable while the read is in flight',
    /feed\.isLoading \? \(\s*<View style=\{styles\.empty\} testID="notifications-loading">/.test(notif)
    && notif.indexOf('feed.isLoading ? (') < notif.indexOf('You&apos;re all caught up'));
  ok('notifications: the in-flight state says what is actually true',
    /Checking your inbox/.test(notif));
  ok('notifications: the empty state offers a way to ask again (the hook still swallows its error)',
    /testID="notifications-recheck"/.test(notif) && /feed\.refetch\(\)/.test(notif));
  // …and that asking again LOOKS like something happened. `feed.isLoading`
  // stays false across a refetch of a settled query, so on a still-empty
  // inbox the screen was byte-identical before and after the tap: a dead
  // control on the one affordance offered because the read may have failed
  // (review 2026-09-07).
  ok('notifications: the recheck reports that it is working, rather than reading as a dead tap',
    /const \[rechecking, setRechecking\] = useState\(false\)/.test(notif)
    && /disabled=\{rechecking\}/.test(notif)
    && /rechecking \? 'Checking…'/.test(notif));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
