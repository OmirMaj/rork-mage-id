#!/usr/bin/env bun
// scripts/validate-digest-preview-reasons.ts
//
// Leftovers review, 2026-09-18 — two "a blocked control says why" defects on
// the Notifications screen's morning digest:
//   1. The Email switch's turn-ON goes through rpc('resume_my_digest_email')
//      (migration 20260918170000). Before that migration, PostgREST answers
//      PGRST202 and the alert blamed his connection — the switch could never
//      turn on. A missing function now falls back to writing the setting; a
//      refusal is worded as a refusal.
//   2. The preview read every sent:false as "No projects to digest", even for
//      an unsubscribed address or an Email switch that was off.
// Executes the real pure helpers (the function's digestGate.ts and the app's
// utils/digestSettingsCopy.ts) and pins the wiring.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestNotSentReason, sendDigestUnlessUnsubscribed } from '../supabase/functions/morning-digest/digestGate';
import { resumeDigestErrorKind, resumeRefusedCopy, RESUME_NETWORK_COPY, morningPreviewCopy } from '../utils/digestSettingsCopy';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fail++; console.log(`  ✗ ${label} ${detail}`); }
}

console.log('morning-digest reports why it did not email');
{
  const base = { emailChannelOn: true, hasEmail: true, nothingToSay: false };
  ok('sent → no reason', digestNotSentReason({ ...base, emailStatus: 'sent' }) === null);
  ok('Email switch off → email_off', digestNotSentReason({ ...base, emailChannelOn: false, emailStatus: null }) === 'email_off');
  ok('no address → no_email', digestNotSentReason({ ...base, hasEmail: false, emailStatus: null }) === 'no_email');
  ok('nothing to say → nothing_to_report', digestNotSentReason({ ...base, nothingToSay: true, emailStatus: 'skipped_nothing_to_report' }) === 'nothing_to_report');
  ok('unsubscribed → suppressed_unsubscribed', digestNotSentReason({ ...base, emailStatus: 'suppressed_unsubscribed' }) === 'suppressed_unsubscribed');
  ok('the send failed → send_failed', digestNotSentReason({ ...base, emailStatus: 'failed' }) === 'send_failed');
}

// End to end through the real gate: an unsubscribed address is never sent to,
// and the reason the preview gets is "unsubscribed", not "no projects".
{
  let sends = 0;
  const status = await sendDigestUnlessUnsubscribed({ isUnsubscribed: async () => true, send: async () => { sends++; return true; } });
  const reason = digestNotSentReason({ emailChannelOn: true, hasEmail: true, nothingToSay: false, emailStatus: status });
  const copy = morningPreviewCopy({ sent: false, reason });
  ok('unsubscribed GC preview: nothing sent, and the alert says he unsubscribed (not "No projects to digest")',
    sends === 0 && copy.title === 'Your address unsubscribed' && !/projects/i.test(copy.title), JSON.stringify(copy));
}

console.log('\nthe preview alert names each reason');
{
  ok('sent → Preview sent', morningPreviewCopy({ sent: true }).title === 'Preview sent');
  ok('email_off → Email is off', morningPreviewCopy({ sent: false, reason: 'email_off' }).title === 'Email is off');
  ok('no_email → No email address', morningPreviewCopy({ sent: false, reason: 'no_email' }).title === 'No email address');
  ok('send_failed → Preview not sent', morningPreviewCopy({ sent: false, reason: 'send_failed' }).title === 'Preview not sent');
  ok('nothing_to_report → No projects to digest', morningPreviewCopy({ sent: false, reason: 'nothing_to_report' }).title === 'No projects to digest');
  ok('only nothing_to_report (or an older function with no reason) blames his projects',
    (['email_off', 'no_email', 'send_failed', 'suppressed_unsubscribed'] as const).every(r => !/project/i.test(morningPreviewCopy({ sent: false, reason: r }).title)));
}

console.log('\nthe Email switch turn-ON is order-proof against the migration');
{
  ok('PGRST202 → missing_function', resumeDigestErrorKind({ code: 'PGRST202', message: 'Could not find the function public.resume_my_digest_email without parameters in the schema cache' }) === 'missing_function');
  ok('a 404 → missing_function', resumeDigestErrorKind({ status: 404, message: 'Not Found' }) === 'missing_function');
  ok('Failed to fetch (no code) → network', resumeDigestErrorKind({ message: 'TypeError: Failed to fetch' }) === 'network');
  ok('a Postgres refusal (42501) → refused', resumeDigestErrorKind({ code: '42501', message: 'permission denied for function resume_my_digest_email' }) === 'refused');
  ok('an raise in the function (P0001) → refused', resumeDigestErrorKind({ code: 'P0001', message: 'not signed in' }) === 'refused');
  const refused = resumeRefusedCopy({ code: '42501', message: 'permission denied' });
  ok('a refusal is worded as a refusal, never as a connection problem',
    /refused/.test(refused.message) && !/connection|reach the server/i.test(refused.message) && /connection/.test(RESUME_NETWORK_COPY.message));

  const ns = strip(read('app/notifications-settings.tsx'));
  ok('setDigestEmail: a missing function falls back to writing the setting (pre-migration behaviour)',
    /const kind = resumeDigestErrorKind\(error as RpcErrorLike\);\s*if \(kind === 'missing_function'\) \{\s*updateDigest\(\{ channels: \{ email: true, in_app: digestInAppOn \} \}\);\s*return;\s*\}/.test(ns));
  ok('…network and refusal get their own words',
    /const copy = kind === 'network' \? RESUME_NETWORK_COPY : resumeRefusedCopy\(error as RpcErrorLike\);\s*showAlert\(copy\.title, copy\.message\);/.test(ns)
      && !/'We could not reach the server\. Check your connection and try again\.'/.test(ns));
  ok('the preview alert comes from morningPreviewCopy, not a sent/no-projects ternary',
    /const copy = morningPreviewCopy\(data as \{ sent\?: unknown; reason\?: unknown \} \| null(?:, [^)]*)?\);\s*showAlert\(copy\.title, copy\.message\);/.test(ns)
      && !/sent \? 'Preview sent' : 'No projects to digest'/.test(ns));
  const md = strip(read('supabase/functions/morning-digest/index.ts'));
  ok('morning-digest returns the reason with sent:false',
    /const reason = digestNotSentReason\(\{\s*emailChannelOn: channels\.email !== false,\s*hasEmail: !!profile\.email,\s*nothingToSay: hasNothingToSay,\s*emailStatus,\s*\}\);\s*return \{ ok: true, sent, pushed: pushStatus === 'sent', \.\.\.\(reason \? \{ reason \} : \{\}\) \};/.test(md));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
