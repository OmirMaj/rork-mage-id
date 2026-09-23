// scripts/validate-w5-push-unsub-copy.ts — wave 5, lane push-unsub:
// the push ask promises only what "Notify me" turns on; the digest copy says
// where the digest goes.
//
//   #132  The one push-permission ask promised "a short brief each morning".
//         Tapping "Notify me" only registers the device token; the brief is
//         morning-digest, which runs only for profiles.digest_enabled = true —
//         default false, set by nothing in this flow — so it never came. The
//         same body also promised a push when "an invoice goes past due", and
//         no sender pushes that (invoice-dunning emails the client).
//         Rule enforced here: every notification PUSH_ASK_COPY names is a
//         PUSH_ASK_CLAIMS entry, and every claim is a notify event pushed to
//         the GC and ON BY DEFAULT (prefAllows is true until he mutes it) —
//         because the confirm action turns nothing on but the token.
//   #130  (copy half) the digest settings copy names the sign-in address the
//         digests now go to.
//
// Run: bun run scripts/validate-w5-push-unsub-copy.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PUSH_ASK_COPY, PUSH_ASK_CLAIMS, PUSH_ASK_BRIEF_NOTE, PUSH_ASK_OTHERS_NOTE, PUSH_ASK_MOMENTS, pushAskCopy,
} from '../utils/pushPermissionAsk';
import { digestRecipientLine, morningPreviewCopy } from '../utils/digestSettingsCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.info('  ✓', name); }
  else { fail++; console.error('  ✗', name, detail ? `— ${detail}` : ''); }
}

// ── 1. the confirm action turns on the token and nothing else ────────────────
// (NotificationContext is read, never edited, by this lane.) If a later change
// makes "Notify me" also switch the brief on, this check is where the claim
// list may grow to include it — and not before.
const nc = read('contexts/NotificationContext.tsx');
ok('"Notify me" calls enablePush() and nothing else',
  /\{ text: copy\.confirm, onPress: \(\) => \{ void enablePush\(\); \} \}/.test(nc));
ok('enablePush does not switch the morning digest on', !/digest[^\n]{0,40}enabled:\s*true/.test(
  nc.slice(nc.indexOf('const enablePush = useCallback'), nc.indexOf('const enablePush = useCallback') + 3000)));

// ── 2. every body names exactly the claims, plus the honest brief note ───────
const oxford = (xs: readonly string[]) =>
  xs.length <= 1 ? xs.join('') : xs.length === 2 ? `${xs[0]} or ${xs[1]}` : `${xs.slice(0, -1).join(', ')}, or ${xs[xs.length - 1]}`;
const expectedBody = `MAGE can notify you when a client ${oxford(PUSH_ASK_CLAIMS.map((c) => c.phrase))}. ${PUSH_ASK_OTHERS_NOTE} ${PUSH_ASK_BRIEF_NOTE}`;
for (const m of PUSH_ASK_MOMENTS) {
  const body = pushAskCopy(m).body;
  ok(`${m}: the body is built from PUSH_ASK_CLAIMS, the other-alerts note and the brief note, nothing more`, body === expectedBody, body);
  const claimsPart = body.replace(PUSH_ASK_BRIEF_NOTE, '');
  ok(`${m}: the claims never promise a brief, a digest or a past-due push`,
    !/morning|brief|digest|past due|overdue/i.test(claimsPart), claimsPart);
  // Review of #132: "Nothing else." followed the three claims, and notify
  // pushes the GC for a dozen more events by default. The claims are examples;
  // no sentence may say they are the whole list.
  ok(`${m}: no exhaustiveness claim ("Nothing else", "only", "just these")`,
    !/nothing else|\bonly\b|just these|that'?s all/i.test(body), body);
}
ok('both moments still have their own entry (the fallback is not how a moment gets copy)',
  PUSH_ASK_MOMENTS.every((m) => Object.prototype.hasOwnProperty.call(PUSH_ASK_COPY, m)));
ok('the brief note says the brief is OFF until he turns it on, and where',
  /off unless you turn it on/i.test(PUSH_ASK_BRIEF_NOTE) && /Push & email preferences/.test(PUSH_ASK_BRIEF_NOTE));
ok('…and that place exists: the Settings row and the digest card',
  /Push & email preferences/.test(read('app/(tabs)/settings/index.tsx'))
  && /AI morning digest/.test(read('app/notifications-settings.tsx')));
const ask = read('utils/pushPermissionAsk.ts');
ok('the doc comment no longer lists morning-digest / invoice-dunning as senders this ask turns on',
  !/the past-due nudge from invoice-dunning, the morning brief from\s+\/\/?\s*\*?\s*morning-digest/.test(ask)
  && !/past-due nudge from invoice-dunning/.test(ask));

// ── 3. every claim is a GC push that is on by default ────────────────────────
const notify = stripComments(read('supabase/functions/notify/index.ts'));
// Case segments: label → next label. A fall-through label (empty segment)
// extends into the next one, so a grouped `case 'a': case 'b': { … }` belongs
// to every label in the group.
const labelRe = /case '([a-z_]+)':/g;
const labels = [...notify.matchAll(labelRe)].map((m) => ({ ev: m[1], at: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
function segmentsFor(ev: string): string[] {
  const out: string[] = [];
  labels.forEach((l, i) => {
    if (l.ev !== ev) return;
    let j = i + 1;
    let seg = notify.slice(l.end, labels[j]?.at ?? notify.length);
    while (!seg.trim() && j < labels.length) { j++; seg = notify.slice(labels[j - 1].end, labels[j]?.at ?? notify.length); }
    out.push(seg);
  });
  return out;
}
for (const c of PUSH_ASK_CLAIMS) {
  const segs = segmentsFor(c.event);
  ok(`claim "${c.phrase}": notify handles '${c.event}'`, segs.length > 0);
  const keyed = segs.some((s) => new RegExp(`prefKey: '${c.prefKey}'`).test(s));
  ok(`claim "${c.phrase}": under prefKey '${c.prefKey}'`, keyed);
  ok(`claim "${c.phrase}": pushed to the GC's device token`,
    segs.some((s) => /dispatchOne\('gc', \{/.test(s) && /pushToken: gc\.push_token/.test(s)));
}
// prefAllows, lifted and executed: no stored preference means ON.
{
  const src = notify.slice(notify.indexOf('function prefAllows('));
  const body = src.slice(src.indexOf('{') + 1, src.indexOf('\n}\n'));
  const js = body.replace(/ as Record<string, Record<string, unknown>>/g, '').replace(/ as Record<string, unknown>/g, '');
   
  const prefAllows = new Function('prefs', 'key', 'channel', js) as (p: unknown, k: string, c: string) => boolean;
  for (const c of PUSH_ASK_CLAIMS) {
    ok(`'${c.prefKey}' push is on by default (no prefs, no entry, entry without push)`,
      prefAllows(null, c.prefKey, 'push') === true
      && prefAllows({}, c.prefKey, 'push') === true
      && prefAllows({ [c.prefKey]: { email: false } }, c.prefKey, 'push') === true);
    ok(`'${c.prefKey}' push can still be muted`, prefAllows({ [c.prefKey]: { push: false } }, c.prefKey, 'push') === false);
  }
}
// The other-alerts note is true: notify pushes the GC, on by default, for
// events beyond the three claims (and each is mutable — prefAllows above).
{
  const claimed = new Set<string>(PUSH_ASK_CLAIMS.map((c) => c.prefKey));
  const gcPushKeys = new Set<string>();
  for (const l of labels) {
    for (const seg of segmentsFor(l.ev)) {
      if (!/dispatchOne\('gc', \{/.test(seg) || !/pushToken: gc\.push_token/.test(seg)) continue;
      for (const m of seg.matchAll(/prefKey: '([a-z_]+)'/g)) gcPushKeys.add(m[1]);
    }
  }
  const others = [...gcPushKeys].filter((k) => !claimed.has(k));
  ok('the other-alerts note is true: notify pushes the GC for events beyond the three claims',
    others.length >= 3, others.join(', '));
  ok('…and says where they are muted', /mute/i.test(PUSH_ASK_OTHERS_NOTE) && /Push & email preferences/.test(PUSH_ASK_OTHERS_NOTE));
}
// The brief really is off by default, which is why it can't be a claim.
ok('morning-digest only runs for digest_enabled = true', /\.eq\('digest_enabled', true\)/.test(read('supabase/functions/morning-digest/index.ts')));

// ── 4. #130: the digest copy names the sign-in address ───────────────────────
ok('digestRecipientLine names the sign-in address', digestRecipientLine(' gc@builder.com ') === 'Sent to your sign-in address, gc@builder.com.');
ok('digestRecipientLine says nothing without an address', digestRecipientLine('') === null && digestRecipientLine(null) === null && digestRecipientLine(undefined) === null);
const sent = morningPreviewCopy({ sent: true }, 'gc@builder.com');
ok('a sent preview says which inbox', sent.title === 'Preview sent' && sent.message.startsWith('Sent to your sign-in address, gc@builder.com. Check your inbox'), sent.message);
ok('an older caller (no address) still gets the plain sent copy', morningPreviewCopy({ sent: true }).message.startsWith('Check your inbox'));
const noEmail = morningPreviewCopy({ sent: false, reason: 'no_email' });
const unknownCopy = morningPreviewCopy({ sent: false, reason: 'recipient_unknown' });
ok('recipient_unknown (lookup failed) says try again — never "no address" or "no projects"',
  unknownCopy.title === 'Preview not sent' && /Try again/.test(unknownCopy.message) && !/project/i.test(unknownCopy.title + unknownCopy.message), unknownCopy.message);
ok('no_email now describes an account signed in without an address', /signed in without an email address/.test(noEmail.message) && noEmail.title === 'No email address', noEmail.message);

console.info(`\n${fail === 0 ? `validate-w5-push-unsub-copy: ${pass} checks passed` : `${fail} of ${pass + fail} checks FAILED`}\n`);
process.exit(fail === 0 ? 0 : 1);
