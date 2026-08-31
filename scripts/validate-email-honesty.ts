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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
