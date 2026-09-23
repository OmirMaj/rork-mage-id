// validate-email-honesty.ts — pins the two places MAGE told a GC an email went
// out when it did not, and stops the boolean-that-lies from growing back.
//
// WHY THIS EXISTS (findings #9 and #25, docs/audits/2026-08-31-medium-sweep.md).
//
// #9 — utils/emailService.ts. When Resend was unreachable the web fallback ran
//      window.open('mailto:…&body=Please view the attached document.') and
//      returned `{ success: true }`. Every caller reads `success` as "the client
//      has it": app/invoice.tsx flipped the invoice to 'sent', which is what
//      starts A/R aging and dunning. So the GC saw "Email Sent", the client
//      received one sentence with no line items, no amount, no Stripe pay link
//      and no PDF — and if the browser blocked the popup, nothing at all.
//
// #25 — app/invoice.tsx. generateInvoicePDFUri is a hard
//      `if (Platform.OS === 'web') return null` (utils/pdfGenerator.ts:1407).
//      handleSendPDF passed `attachments: pdfUri ? [pdfUri] : undefined` and
//      then showed "Email Sent" regardless, so the entire "Email PDF" flow on
//      web sent an invoice email with no invoice attached, silently.
//
// The fix in both cases follows utils/shareText.ts: a discriminated outcome
// instead of a boolean, and `success` reserved for a real delivery.
//
// Run via: bun run scripts/validate-email-honesty.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want),
    `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}

const SERVICE = 'utils/emailService.ts';
const SCREEN = 'app/invoice.tsx';
const serviceSrc = read(SERVICE);
const screenSrc = read(SCREEN);

// ── load the shipped pure helpers ───────────────────────────────────────────
// emailService.ts imports react-native / expo-mail-composer, neither of which
// loads outside Metro, so the import-free helper region is extracted between
// its sentinels and executed. Same technique as validate-sub-overpayment.ts.
const BEGIN = '// --- BEGIN mailto plain-text helpers ---';
const END = '// --- END mailto plain-text helpers ---';
const from = serviceSrc.indexOf(BEGIN);
const to = serviceSrc.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`\n  ✗ could not find the mailto helper sentinels in ${SERVICE}.`);
  console.error('    Restore them, or the mailto body goes unpinned and can silently');
  console.error('    regress to the "Please view the attached document." stub.');
  process.exit(1);
}
// `Bun` is a runtime global with no ambient types here — @types/bun is not a
// dependency, so a bare `new Bun.Transpiler(...)` is a tsc error (TS2867) even
// though it runs fine. Reach it through globalThis instead of `declare const
// Bun`, which would collide the day those types do land.
const { Transpiler } = (globalThis as unknown as {
  Bun: { Transpiler: new (o: { loader: string }) => { transformSync(src: string): string } };
}).Bun;
const js = new Transpiler({ loader: 'ts' })
  .transformSync(serviceSrc.slice(from, to))
  .replace(/\bexport\s+function\b/g, 'function');
const { htmlToPlainText, buildMailtoUrl } = new Function(
  `${js}\nreturn { htmlToPlainText, buildMailtoUrl };`,
)() as {
  htmlToPlainText: (html: string) => string;
  buildMailtoUrl: (o: { to: string; subject: string; body: string }) => string;
};

console.log('\nEmail honesty:');

// ── htmlToPlainText: the mailto body must carry the real email ──────────────
// A realistic slice of what wrapEmailHtml/buildInvoiceEmailHtml produces: the
// hidden preheader + zero-width spacer, a stat table, and the Stripe pay CTA.
const INVOICE_HTML = `<!DOCTYPE html><html><head><title>Invoice</title>
<style>a { color: red }</style></head><body>
<div style="display:none;max-height:0;overflow:hidden;">Invoice #12 for Maple St — $8,400.00 due March 3, 2026.</div>
<div style="display:none;max-height:0;overflow:hidden;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<p>Hi Dana,</p>
<table><tr><td>Amount due</td><td>$8,400.00</td></tr>
<tr><td>Terms</td><td>Net 30</td></tr></table>
<a href="https://pay.stripe.com/xyz" style="color:#fff">Pay securely &middot; $8,400.00</a>
<p>Questions? <a href="mailto:jo@acme.com">jo@acme.com</a></p>
</body></html>`;

const plain = htmlToPlainText(INVOICE_HTML);

ok('keeps the money the client owes', plain.includes('$8,400.00'));
ok('keeps the payment terms', plain.includes('Net 30'));
ok('keeps the Stripe pay LINK, not just its label',
  plain.includes('Pay securely · $8,400.00: https://pay.stripe.com/xyz'),
  plain);
ok('mailto: links keep their label without a redundant URL',
  plain.includes('jo@acme.com') && !plain.includes('jo@acme.com: mailto:'));
ok('drops the hidden preheader block',
  !plain.includes('Invoice #12 for Maple St'), plain);
ok('drops the &zwnj; spacer run', !plain.includes('zwnj') && !plain.includes('‌'), plain);
ok('drops <style> CSS', !plain.includes('color: red'));
ok('leaves no HTML tags behind', !/<[a-z/][^>]*>/i.test(plain), plain);
ok('leaves no undecoded named entities', !/&[a-z]+;/i.test(plain), plain);
ok('does not collapse into one run-on line', plain.split('\n').length >= 4, plain);
eq('empty html → empty string', htmlToPlainText(''), '');

// The exact stub the old code shipped. If this string is ever the body again,
// the regression is back. Comments are stripped first — the fix's own WHY
// comment quotes the stub, and a guard that trips on its own documentation
// teaches people to delete the documentation.
const serviceCode = serviceSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
ok('the body is no longer the "Please view the attached document." stub',
  !serviceCode.includes('Please view the attached document.'));

// ── buildMailtoUrl: length ceiling ──────────────────────────────────────────
// Windows' ShellExecute hard-fails past ~2048 chars and Outlook truncates, both
// of which turn "we opened a draft" back into a lie.
const longUrl = buildMailtoUrl({ to: 'a@b.com', subject: 'Invoice #12', body: 'x'.repeat(50_000) });
ok('a huge body is trimmed, not shipped whole', longUrl.length < 2048, `len=${longUrl.length}`);
ok('a trimmed body says so', decodeURIComponent(longUrl).includes('trimmed'));
const shortUrl = buildMailtoUrl({ to: 'a@b.com', subject: 'Hi', body: 'Short body' });
ok('a short body is left alone', decodeURIComponent(shortUrl).includes('body=Short body'));
ok('recipient and subject are encoded',
  buildMailtoUrl({ to: 'a b@c.com', subject: 'A & B', body: '' }).startsWith('mailto:a%20b%40c.com?subject=A%20%26%20B'));

// ── end-to-end: a REAL wrapEmailHtml invoice must survive the round trip ────
// utils/emailLayout.ts has zero imports, so the actual shipped scaffolding can
// be exercised here rather than a hand-written approximation of it. This is the
// case that matters: 8 KB of nested tables in, a mailto: the user's mail client
// will actually accept out, with the money and the pay link still in it.
const {
  wrapEmailHtml, emailStatRow, emailStatCard, emailQuote, fmtMoney,
} = await import('../utils/emailLayout');

const realHtml = wrapEmailHtml({
  preheader: 'Invoice #12 for Maple St Kitchen — $8,400.00 due March 3, 2026.',
  eyebrow: 'Invoice #12',
  title: '$8,400.00 due',
  subtitle: 'Invoice #12 for Maple St Kitchen.',
  bodyHtml:
    `<p style="margin:0 0 14px;">Hi Dana,</p>` +
    emailQuote('Second progress billing, 60% complete.') +
    emailStatCard(
      emailStatRow('Project', 'Maple St Kitchen') +
      emailStatRow('Due date', 'March 3, 2026') +
      emailStatRow('Terms', 'Net 30') +
      emailStatRow('Amount due', fmtMoney(8400), { emphasize: true }),
    ),
  cta: { label: 'Pay securely · $8,400.00', href: 'https://pay.stripe.com/abc123' },
  companyName: 'Acme Builders',
  project: { name: 'Maple St Kitchen' },
  contactName: 'Jo Acme', contactEmail: 'jo@acme.com', contactPhone: '555-0100',
  unsubscribe: { recipientEmail: 'dana@x.com', eventKey: 'invoice', enabled: true },
});
const realMailto = decodeURIComponent(
  buildMailtoUrl({ to: 'dana@x.com', subject: 'Invoice #12', body: htmlToPlainText(realHtml) }),
);
ok('a real invoice email fits in a mailto: without being trimmed',
  !realMailto.includes('trimmed'), `${realMailto.length} chars`);
ok('the real draft still carries the amount due', realMailto.includes('Amount due'));
ok('the real draft still carries the Stripe pay link',
  realMailto.includes('https://pay.stripe.com/abc123'), realMailto);
ok('the real draft still carries the payment terms', realMailto.includes('Net 30'));
ok('the real draft does not open with the hidden preheader',
  !realMailto.includes('Invoice #12 for Maple St Kitchen — $8,400.00 due March 3, 2026.'));

// ── the outcome discriminator ───────────────────────────────────────────────
ok('SendEmailOutcome exists and names composer_opened',
  /export type SendEmailOutcome/.test(serviceSrc) && /'composer_opened'/.test(serviceSrc));
ok('SendEmailResponse carries outcome', /outcome:\s*SendEmailOutcome/.test(serviceSrc));

// The heart of #9: the web fallback opens a DRAFT, and a draft is not a send.
// Bounded at the native arm, or the slice runs on into MailComposer's own
// composer_opened branch and the web assertions pass on the native code.
const webBranch = (() => {
  const fn = serviceSrc.indexOf('export async function sendEmail(');
  const i = serviceSrc.indexOf("if (Platform.OS === 'web') {", fn);
  const j = serviceSrc.indexOf('await MailComposer.isAvailableAsync()', i);
  return i < 0 || j < 0 ? '' : serviceSrc.slice(i, j);
})();
ok('found the sendEmail web fallback branch', webBranch.length > 0);
ok('the web fallback never returns success: true',
  webBranch.length > 0 && !/success:\s*true/.test(webBranch),
  webBranch.slice(0, 400));
ok('the web fallback reports composer_opened',
  /outcome:\s*'composer_opened'/.test(webBranch));
ok('the web fallback warns that attachments were not included',
  /could NOT be included/.test(webBranch));
ok('the web fallback does not use window.open (popup-blocked after the await)',
  !/window\.open/.test(webBranch));

// ── app/invoice.tsx: no "Email Sent" over a missing PDF ─────────────────────
ok('handleSendPDF still asks generateInvoicePDFUri for a URI',
  screenSrc.includes('const pdfUri = await generateInvoicePDFUri('));
ok('a null pdfUri is confirmed with the user before sending',
  /if \(!pdfUri\) \{[\s\S]{0,400}?PDF could not be attached/.test(screenSrc),
  'the send must stop and ask, not quietly drop the document');
ok('the confirmation resolves on dismiss (or the await never settles)',
  /if \(!pdfUri\) \{[\s\S]{0,1600}?onDismiss: \(\) => resolve\(false\)/.test(screenSrc));
ok('a dropped attachment changes the success copy',
  /const pdfMissing = !pdfUri \|\| \(result\.attachmentsDropped \?\? 0\) > 0/.test(screenSrc));
ok('the flat "Email Sent" toast is now conditional on the PDF being attached',
  /pdfMissing \? '[^']*without the PDF' : 'Email Sent'/.test(screenSrc));
ok('composer_opened is not reported as a send',
  /result\.outcome === 'composer_opened'/.test(screenSrc));
ok('sendViaResend counts attachments it could not encode',
  /attachmentsDropped = encoded\.length - attachments\.length/.test(serviceSrc));

// ── app/(tabs)/estimate/full.tsx: the same guard, on the estimate ──────────
//
// 2026-09-18 audit #32. The invoice fix above was never carried to the only
// other PDFPreSendSheet caller. generateEstimatePDFUri has the same hard web
// `return null`, and the laptop's "Email estimate" sent a homeowner an email
// whose first line was "Estimate attached." with nothing attached, then told
// the GC "Email Sent". When Resend failed on web it said "could not send" and
// offered a Share PDF button that did nothing — while a draft sat open in his
// mail app. Every half of the invoice guard is pinned again here, on this file.
const ESTIMATE_SCREEN = 'app/(tabs)/estimate/full.tsx';
const estimateSrc = stripCommentsEarly(read(ESTIMATE_SCREEN));
function stripCommentsEarly(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}
const estSend = (() => {
  const a = estimateSrc.indexOf('const handlePDFSend = useCallback(');
  const b = estimateSrc.indexOf('const handleShareEmail = useCallback(');
  return a >= 0 && b > a ? estimateSrc.slice(a, b) : '';
})();
ok('estimate: handlePDFSend found', estSend.length > 0, 'the estimate send handler moved — re-point this check');
ok('estimate: the PDF is generated BEFORE the email body is built',
  estSend.indexOf('await generateEstimatePDFUri(') >= 0
  && estSend.indexOf('await generateEstimatePDFUri(') < estSend.indexOf('buildEstimateEmailHtml('),
  'the body\'s first line depends on whether there is a PDF, so the PDF must exist first');
ok('estimate: a null pdfUri is confirmed with the user before sending',
  /if \(!pdfUri\) \{[\s\S]{0,400}?PDF could not be attached/.test(estSend));
ok('estimate: the confirmation resolves on dismiss',
  /if \(!pdfUri\) \{[\s\S]{0,1600}?onDismiss: \(\) => resolve\(false\)/.test(estSend));
ok('estimate: the body is told whether a PDF is attached',
  /hasAttachment: !!pdfUri/.test(estSend),
  'without it the no-PDF email still opens with "Estimate attached."');
ok('estimate: a dropped attachment changes the success copy',
  /const pdfMissing = !pdfUri \|\| \(result\.attachmentsDropped \?\? 0\) > 0/.test(estSend));
ok('estimate: the flat "Email Sent" toast is conditional on the PDF',
  /pdfMissing \? '[^']*without the PDF' : 'Email Sent'/.test(estSend)
  && !/showAlert\('Email Sent'/.test(estSend));
ok('estimate: composer_opened says the draft is not sent',
  /result\.outcome === 'composer_opened'[\s\S]{0,400}?Draft opened — not sent yet/.test(estSend));
ok('estimate: Share PDF is only offered when there is a PDF to share',
  !/pdfUri \?\? await generateEstimatePDFUri/.test(estSend)
  && /pdfUri\s*\?\s*\[[\s\S]{0,200}?'Share PDF'/.test(estSend),
  'on web pdfUri is null and Sharing is unavailable — the button did nothing');

// buildEstimateEmailHtml's opening line, executed for real. Its template calls
// module-local helpers, so the function body is extracted and run against
// stubs of those helpers — the only thing under test is the attachment line.
{
  const a = serviceSrc.indexOf('export function buildEstimateEmailHtml(');
  const b = serviceSrc.indexOf('export function buildGenericDocumentEmailHtml(');
  const fnSrc = a >= 0 && b > a ? serviceSrc.slice(a, b) : '';
  ok('estimate: buildEstimateEmailHtml found', fnSrc.length > 0);
  const fnJs = new Transpiler({ loader: 'ts' }).transformSync(fnSrc).replace(/\bexport\s+function\b/g, 'function');
  const build = new Function(
    'emailQuote', 'emailStatCard', 'emailStatRow', 'fmtMoney', 'wrapEmailHtml',
    `${fnJs}\nreturn buildEstimateEmailHtml;`,
  )(
    (m: string) => `<q>${m}</q>`, (x: string) => x, (k: string, v: string) => `${k}:${v}`,
    (n: number) => `$${n}`, (o: { bodyHtml: string }) => o.bodyHtml,
  ) as (o: Record<string, unknown>) => string;
  const base = { companyName: 'Acme', recipientName: '', projectName: 'Maple', grandTotal: 48000, itemCount: 12 };
  ok('estimate email WITH a PDF still says it is attached',
    build({ ...base }).includes('Estimate attached.'));
  ok('estimate email WITHOUT a PDF never says "attached"',
    !/attached/i.test(build({ ...base, hasAttachment: false })),
    build({ ...base, hasAttachment: false }));
  ok('estimate email without a PDF still carries the total',
    build({ ...base, hasAttachment: false }).includes('$48000'));
}

// ── daily-digest: never send an email with nothing in it ───────────────────
//
// Reported from a real inbox on 2026-09-08: a giant serif "Quiet day." over one
// sentence of nothing. The send was deliberate — the function's own header
// argued the cadence was reassuring on weekdays — and it is exactly backwards.
// An email that is empty most mornings teaches the reader to archive the
// subject line on sight, so the mornings that DO carry an unanswered client
// message get archived with them.
//
// Two things are pinned here. The empty send itself, and the SELF-ADDRESSED
// footer: wrapEmailHtml's `sender` block renders "Sent by <name> · <email> ·
// <phone>. Replies go to them, not us." That copy is for a homeowner reading a
// contractor's email. On this digest, which goes to the GC himself, it printed
// his own name, address and phone back at him and told him replies would reach
// himself.
// Comments stripped before matching. The fix's own comments QUOTE the strings
// being banned, to explain why they went — a check that cannot tell code from
// prose fires on its own documentation and teaches people to delete the
// explanation rather than keep the fix.
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const digestSrc = stripComments(readFileSync(join(ROOT, 'supabase/functions/daily-digest/index.ts'), 'utf8'));

ok('daily-digest returns before building an email when there are no events',
  /if \(totalEvents === 0\) \{[\s\S]{0,200}?return \{[^}]*status: 'skipped_already'/.test(digestSrc),
  'a digest with zero events must not be sent at all — see this check\'s comment');
ok('no quiet-day body template survives to be re-enabled',
  !/No events to report/.test(digestSrc) && !/isQuiet/.test(digestSrc),
  'a rendered empty-digest template is one `if` away from shipping again');
ok('the subject line no longer has an empty-digest form',
  !/Quiet day on your jobs/.test(digestSrc));
ok('daily-digest passes no `sender` block (it is addressed to the GC himself)',
  !/^\s*sender:\s*\{/m.test(digestSrc),
  'the sender footer says "Replies go to them, not us" — on a self-addressed digest that is the reader');

// ── morning-digest: the same two rules ─────────────────────────────────────
const morningSrc = stripComments(readFileSync(join(ROOT, 'supabase/functions/morning-digest/index.ts'), 'utf8'));

ok('morning-digest suppresses email + push when there is nothing to report',
  /const hasNothingToSay = /.test(morningSrc)
  && /channels\.email !== false && profile\.email && !hasNothingToSay/.test(morningSrc)
  && /profile\.push_token && !hasNothingToSay/.test(morningSrc),
  '"No active projects today. Enjoy the quiet." is the same empty send daily-digest was making');
ok('…but the in-app inbox row still writes on a quiet day',
  /if \(channels\.in_app !== false\) \{[\s\S]{0,200}?notification_outbox/.test(morningSrc),
  'the inbox row is pulled, not pushed — suppressing it would hide the cadence from someone who goes looking');
ok('the morning briefing body carries a working unsubscribe link',
  /unsubscribe: \{ recipientEmail, eventKey: 'daily_digest'/.test(morningSrc),
  'buildUnsubscribeUrl returns null without recipientEmail, so the visible link and the ' +
  'preferences link vanish from a recurring opt-in email');

// ── the unsubscribe link stops the email it is in (audit 2026-09-18 #15) ────
//
// Both GC digests put an unsubscribe link in the footer and a List-Unsubscribe
// header on the message; clicking either writes an email_unsubscribes row and
// the page says "You're unsubscribed." Neither digest read that row, so the
// same email arrived the next morning. The rule is executed here, not grepped:
// sendDigestUnlessUnsubscribed is run against a suppressed and a subscribed
// address, and must never call send() for the first.
{
  const { sendDigestUnlessUnsubscribed, GC_DIGEST_EVENT_KEY } =
    await import('../supabase/functions/morning-digest/digestGate');
  let sends = 0;
  const send = async () => { sends++; return true; };
  const suppressed = await sendDigestUnlessUnsubscribed({ isUnsubscribed: async () => true, send });
  ok('an unsubscribed address is never sent to', suppressed === 'suppressed_unsubscribed' && sends === 0,
    `outcome ${suppressed}, send() called ${sends}x`);
  const live = await sendDigestUnlessUnsubscribed({ isUnsubscribed: async () => false, send });
  ok('a subscribed address is sent to', live === 'sent' && sends === 1);
  const failed = await sendDigestUnlessUnsubscribed({ isUnsubscribed: async () => false, send: async () => false });
  ok('a failed send is recorded as failed, not sent', failed === 'failed');
  ok('the gate checks the same key the links carry', GC_DIGEST_EVENT_KEY === 'daily_digest');

  // Both digests send ONLY through the gate, with the real suppression check.
  const gateCall = /sendDigestUnlessUnsubscribed\(\{\s*isUnsubscribed: \(\) => isEmailUnsubscribed\(SUPABASE_URL, (?:SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY), [a-z]+, GC_DIGEST_EVENT_KEY\),\s*send:/;
  ok('morning-digest emails only through the gate', gateCall.test(morningSrc)
    && (morningSrc.match(/sendDigestEmail\(/g) ?? []).length === 2, // the definition + the one call inside the gate
    'a second sendDigestEmail( call is a send path that skips the unsubscribe check');
  ok('morning-digest records a suppression in the outbox', /emailStatus = await sendDigestUnlessUnsubscribed\(/.test(morningSrc));
  ok('daily-digest emails only through the gate', gateCall.test(digestSrc)
    && (digestSrc.match(/resendSend\(/g) ?? []).length === 1
    && /send: async \(\) => \{\s*const r = await resendSend\(/.test(digestSrc));
  ok('daily-digest records the outcome (incl. suppressed_unsubscribed) in the outbox', /email_status: outcome,/.test(digestSrc));

  // Sweep: every edge function that mails a recurring digest key checks that
  // key's suppression before sending. A new digest cannot ship without it.
  const { readdirSync, existsSync } = await import('node:fs');
  const fnDir = join(ROOT, 'supabase/functions');
  for (const fn of readdirSync(fnDir)) {
    const file = join(fnDir, fn, 'index.ts');
    if (!existsSync(file)) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    for (const key of ['daily_digest', 'weekly_digest']) {
      const mails = new RegExp(`eventKey: (?:'${key}'|opts\\.eventKey \\?\\? '${key}'${key === 'daily_digest' ? '|GC_DIGEST_EVENT_KEY' : ''})`).test(src);
      if (!mails) continue;
      const checks = new RegExp(`isEmailUnsubscribed\\([^)]*(?:'${key}'${key === 'daily_digest' ? '|GC_DIGEST_EVENT_KEY' : ''})\\)`).test(src);
      ok(`${fn}: mails '${key}' and checks its unsubscribe first`, checks,
        'the link in the email must stop the email — call isEmailUnsubscribed with the same key before resendSend');
    }
  }

  // The in-app switch shows the suppression and can lift it.
  const settingsSrc = stripComments(read('app/notifications-settings.tsx'));
  ok('settings reads the suppression state', /supabase\.rpc\('my_digest_email_suppression'\)/.test(settingsSrc));
  ok('the Email switch shows what will happen, not what was stored',
    /const digestEmailOn = digestEmailStored && !digestEmailSuppressed/.test(settingsSrc));
  ok('turning it back on clears the suppression first', /supabase\.rpc\('resume_my_digest_email'\)/.test(settingsSrc));
  // Post-ship review: after "Turn email back on" on the prefs page suppression
  // reads 'none', and only the RPC restores daily_digest.email — so every
  // turn-ON must take it, not only the suppressed case.
  ok('every turn-ON goes through the resume RPC (not only while suppressed)',
    /const setDigestEmail = useCallback\(async \(v: boolean\) => \{[\s\S]*?if \(!v\) \{\s*updateDigest\(\{ channels: \{ email: false/.test(settingsSrc)
      && !/if \(!v \|\| !digestEmailSuppressed\)/.test(settingsSrc));
  ok('a switch held off by an unsubscribe says why', /Off because you unsubscribed/.test(settingsSrc));
  const mig = read('supabase/migrations/20260918170000_digest_unsubscribe_sync.sql');
  ok('the resume RPC keys on the sign-in address, never profiles.email',
    /from auth\.users u where u\.id = auth\.uid\(\)/.test(mig) && !/delete from public\.email_unsubscribes[\s\S]{0,120}profiles/.test(mig));
  // Integration review 2026-09-18: the unsubscribe trigger also turns
  // notification_preferences.daily_digest.email off and nothing turned it back
  // on; and the "all email is off" alert pointed at a control that did not
  // exist. PGlite replay: scratchpad/pgtest/digest_unsub_resume.mjs.
  ok('resume turns notification_preferences.daily_digest.email back on (caller\'s row, only when nothing still suppresses)',
    /if v_state = 'none' then\s+update public\.profiles p\s+set notification_preferences =\s+jsonb_set\(p\.notification_preferences, '\{daily_digest,email\}', 'true'::jsonb\)\s+where p\.id = auth\.uid\(\)/.test(mig));
  const prefsPage = read('marketing/preferences/index.html');
  ok('the preferences page can lift a global unsubscribe (resubscribe with event_key null)',
    /id="resubAll"/.test(prefsPage) && /callApi\('resubscribe', null\)/.test(prefsPage));
  ok('the app\'s "all email is off" alert names that control', /tap "Turn email back on"/.test(settingsSrc) && /turn email back on/i.test(prefsPage));
  // Wave 5 (push-unsub): the preferences page no longer carries its own key
  // list — it fetches marketing/email-event-keys.json, the one list the
  // unsubscribe page reads too. The row is in that JSON; the page must fetch it.
  const eventKeys = JSON.parse(read('marketing/email-event-keys.json')) as { groups: { items: { key: string }[] }[] };
  ok('website leads can be managed: an app category and a preferences-page row',
    /key: 'lead_received'/.test(settingsSrc)
      && eventKeys.groups.some((g) => g.items.some((i) => i.key === 'lead_received'))
      && /fetch\(KEYS_URL/.test(prefsPage));
  ok('digestGate names a validator that exists', !/validate-digest-unsubscribe\.ts/.test(read('supabase/functions/morning-digest/digestGate.ts')));
}

// ── the shared shell: one brand per header ─────────────────────────────────
// The right-hand "MAGE ID" pill means "sent THROUGH MAGE ID" and only makes
// sense opposite a contractor's own name. It used to render unconditionally, so
// every email with no companyName showed the wordmark twice.
const shellSrc = stripComments(readFileSync(join(ROOT, 'supabase/functions/_shared/email.ts'), 'utf8'));
ok('the MAGE ID header pill renders only when the email is co-branded',
  /\$\{isCobranded \? `<span[^`]*MAGE&nbsp;ID<\/span>` : ''\}/.test(shellSrc),
  'an un-co-branded email prints the wordmark on the left and the same wordmark in a pill on the right');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
