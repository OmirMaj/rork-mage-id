// scripts/validate-w5-reports-pdf.ts — the bank documents and the ledgers
// after audit wave 5 (2026-09-22):
//   #106 fmtMoney signs outside the dollar ("-$250,000", never "$-250,000"),
//        so a loss on the WIP / Profit PDFs prints "-$250,000";
//   #102 the A/R aging tab and PDF carry retainage (row, total, tile, footer);
//   #147 (carried) the reports PDF on the web throws when the pop-up is
//        blocked instead of doing nothing, and the screens say so;
//   #109 the Payments ledger is to the cent.
//
// utils/financialReportPdf.ts imports react-native / expo-print / expo-sharing
// at module scope, which bun cannot load, so those three (and the file-system
// module utils/platformFile pulls in) are replaced with inert stand-ins BEFORE
// the module is imported. `Platform.OS` is a mutable stand-in so the web branch
// can be driven.
//
// Run via: bun run scripts/validate-w5-reports-pdf.ts

// `bun:test` has no type declarations in this repo's tsc program, so it is
// reached through a variable specifier; bun resolves it at runtime.
const BUN_TEST = 'bun:test';
const { mock } = (await import(BUN_TEST)) as {
  mock: { module: (specifier: string, factory: () => Record<string, unknown>) => void };
};
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const Platform = { OS: 'ios' as string };
mock.module('react-native', () => ({ Platform }));
mock.module('expo-print', () => ({}));
mock.module('expo-sharing', () => ({}));
mock.module('expo-file-system/legacy', () => ({}));

const { fmtMoney } = await import('../utils/pdfDesign');
const pdf = await import('../utils/financialReportPdf');
const { computeARAgingReport, computeWIPReport } = await import('../utils/financialReports');
const { PRINT_WINDOW_BLOCKED_MESSAGE, pdfFailureMessage } = await import('../utils/platformFile');
import type { Invoice, Project, CompanyBranding, Commitment } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const BRANDING: CompanyBranding = {
  companyName: 'Ridge Builders', contactName: '', phone: '', email: '', address: '', licenseNumber: '', tagline: '',
} as CompanyBranding;

// ── #106 fmtMoney ────────────────────────────────────────────────────────────
console.log('\n#106 fmtMoney signs outside the dollar:');
ok("fmtMoney(-250000) === '-$250,000'", fmtMoney(-250000) === '-$250,000', fmtMoney(-250000));
ok("fmtMoney(-0.4) === '$0' (rounded first — no signed zero)", fmtMoney(-0.4) === '$0', fmtMoney(-0.4));
ok("fmtMoney(-0.004, { decimals: 2 }) === '$0.00'", fmtMoney(-0.004, { decimals: 2 }) === '$0.00', fmtMoney(-0.004, { decimals: 2 }));
ok("fmtMoney(1234.5, { decimals: 2 }) === '$1,234.50'", fmtMoney(1234.5, { decimals: 2 }) === '$1,234.50');
ok("fmtMoney(-1234.56, { decimals: 2 }) === '-$1,234.56'", fmtMoney(-1234.56, { decimals: 2 }) === '-$1,234.56', fmtMoney(-1234.56, { decimals: 2 }));
ok("null / NaN still print '—'", fmtMoney(null) === '—' && fmtMoney(undefined) === '—' && fmtMoney(NaN) === '—');
ok("{ negative: 'paren' } prints '($250,000)'", fmtMoney(-250000, { negative: 'paren' }) === '($250,000)');
ok("…and leaves a positive figure alone", fmtMoney(250000, { negative: 'paren' }) === '$250,000');
ok('no output ever contains "$-"', [-1, -0.5, -250000, -1e9].every(n => !fmtMoney(n).includes('$-')));

// ── A losing job on the WIP and Profit PDFs ──────────────────────────────────
const captured: string[] = [];
let windowToReturn: unknown = null;
(globalThis as unknown as { window: unknown }).window = { open: () => windowToReturn };
const fakeWindow = () => ({
  document: { write: (h: string) => { captured.push(h); }, close: () => {}, images: [] },
  focus: () => {}, print: () => {},
});

const LOSER: Project = {
  id: 'p1', name: 'Underwater Job', status: 'in_progress', estimate: null, ownerUserId: 'u1',
  linkedEstimate: { id: 'e1', items: [], globalMarkup: 10, baseTotal: 400_000, markupTotal: 40_000, grandTotal: 440_000, createdAt: '2026-01-01' },
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as unknown as Project;
// $690,000 signed against a $440,000 contract → a $250,000 loss.
const OVERRUN: Commitment = {
  id: 'c1', projectId: 'p1', number: 'SC-1', type: 'subcontract', description: 'Everything',
  amount: 690_000, paidToDate: 100_000, signedDate: '2026-01-01', phase: 'Build', status: 'active',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
} as unknown as Commitment;

Platform.OS = 'web';
console.log('\n#106 on the bank documents:');
{
  const wip = computeWIPReport([LOSER], [], [], [OVERRUN]);
  ok('fixture: the job projects a $250,000 loss', Math.round(wip.rows[0]?.projectedProfit ?? 0) === -250_000, String(wip.rows[0]?.projectedProfit));
  windowToReturn = fakeWindow();
  captured.length = 0;
  await pdf.shareWIPReport(wip, BRANDING);
  const html = captured.join('');
  // The minus form, not parentheses: scripts/validate-money-basis-parity.ts
  // (run-only for this lane) pins these four cells as plain fmtMoney(...)
  // calls. `{ negative: 'paren' }` exists for a later switch — see the handoff.
  ok('the WIP PDF prints the loss as -$250,000', html.includes('-$250,000'), html.slice(0, 200));
  ok('…and never as $-250,000', !html.includes('$-'));
  captured.length = 0;
  await pdf.shareProfitReport([{
    projectId: 'p1', projectName: 'Underwater Job', status: 'in_progress', revenue: 440_000, costToDate: 100_000,
    estimatedFinalCost: 690_000, projectedProfit: -250_000, projectedMargin: -56.8, health: 'red',
  }], 440_000, -250_000, -56.8, BRANDING);
  const profitHtml = captured.join('');
  ok('the Profit PDF prints the row and the portfolio loss as -$250,000',
    (profitHtml.match(/-\$250,000/g) ?? []).length >= 2, String((profitHtml.match(/-\$250,000/g) ?? []).length));
  ok('…and never as $-250,000', !profitHtml.includes('$-'));
}

// ── #147 carried: a blocked pop-up is an error, not silence ─────────────────
console.log('\n#147 a blocked PDF window throws (web):');
{
  windowToReturn = null;
  let threw: unknown = null;
  try { await pdf.shareARAgingReport(computeARAgingReport([], []), BRANDING); } catch (e) { threw = e; }
  ok('shareARAgingReport rejects with the pop-up sentence when window.open returns null',
    threw instanceof Error && threw.message === PRINT_WINDOW_BLOCKED_MESSAGE, String(threw));
  ok('…which pdfFailureMessage lets through to the screen', pdfFailureMessage(threw, 'fallback') === PRINT_WINDOW_BLOCKED_MESSAGE);
  const src = read('utils/financialReportPdf.ts');
  ok('the web branch routes through openPrintWindowOrThrow (lazily — validate-wip pins no static platformFile import)',
    /const \{ openPrintWindowOrThrow \} = await import\('@\/utils\/platformFile'\);\s*openPrintWindowOrThrow\(html\);/.test(src)
    && !/^import .*platformFile/m.test(src));
  ok("…and the old silent `if (newWindow)` branch is gone", !/window\.open\('', '_blank'\)/.test(src));
  const reports = read('app/reports.tsx');
  ok('/reports shows pdfFailureMessage on a failed share',
    /showAlert\('PDF failed', pdfFailureMessage\(err, 'Could not generate the PDF\.'\)\)/.test(reports));
  const shareAt = reports.indexOf('const handleSharePdf = useCallback(async () => {');
  const shareBody = reports.slice(shareAt, reports.indexOf('}, [tab, wip, profit, aging', shareAt));
  ok('…and its success haptic is only reached after the share resolved (inside try, after the await, before catch)',
    shareBody.indexOf('await shareARAgingReport') < shareBody.indexOf('Haptics.notificationAsync')
    && shareBody.indexOf('Haptics.notificationAsync') < shareBody.indexOf('} catch (err) {'));
  const wipScreen = read('app/wip-report.tsx');
  ok('/wip-report shows pdfFailureMessage on a failed WIP PDF',
    /catch \(err\) \{ showAlert\('Export failed', pdfFailureMessage\(err, 'Could not generate the WIP PDF\.'\)\); \}/.test(wipScreen));
}

// ── #102 A/R aging carries retainage ─────────────────────────────────────────
console.log('\n#102 retainage on the A/R aging PDF and tab:');
{
  Platform.OS = 'ios';
  const inv = {
    id: 'i1', number: 7, projectId: 'p1', type: 'progress', issueDate: '2026-08-01', dueDate: '2099-12-31',
    paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 110_000, taxRate: 0, taxAmount: 0,
    totalDue: 110_000, amountPaid: 99_000, retentionPercent: 10, status: 'partially_paid', payments: [],
    createdAt: '2026-08-01', updatedAt: '2026-08-01',
  } as unknown as Invoice;
  const report = computeARAgingReport([inv], [LOSER]);
  ok('fixture: $110,000 / 10% / $99,000 paid → $11,000 held, $0 collectible',
    report.rows.length === 1 && Math.round(report.rows[0].retainageHeld) === 11_000 && report.rows[0].outstanding <= 0.5,
    JSON.stringify(report.rows[0]));
  const html = pdf.buildARAgingHtml(report, BRANDING);
  ok('the PDF prints the retainage figure 11,000.00', html.includes('11,000.00'));
  // ON THE INVOICE'S OWN ROW, between Paid and Outstanding — not only in the
  // tile and the total, which would still read 11,000.00 with the column gone.
  const invoiceRow = html.slice(html.indexOf('#7'), html.indexOf('TOTAL'));
  ok('…on the invoice row itself: Paid 99,000.00 → Retainage 11,000.00 → Outstanding $0.00',
    /99,000\.00[\s\S]*?11,000\.00[\s\S]*?\$0\.00/.test(invoiceRow), invoiceRow.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 300));
  ok("…under a 'Retainage Held' column", html.includes('Retainage Held'));
  ok("…with a 'Retainage held (not aged)' tile", html.includes('Retainage held (not aged)'));
  ok("…a TOTAL row that foots (110,000.00 / 99,000.00 / 11,000.00 / 0.00)",
    /TOTAL[\s\S]*110,000\.00[\s\S]*99,000\.00[\s\S]*11,000\.00[\s\S]*\$0\.00/.test(html));
  ok("…the bucket reads 'Retainage' for a retainage-only row", />Retainage<\/span>/.test(html));
  ok('…the footer says retainage is a receivable that is not aged', /Retainage is held by the owner until closeout; it is a receivable and is not aged\./.test(html));
  ok("…and the 'Open invoices' meta counts collectible rows only (0 here)", /Open invoices[\s\S]{0,300}?>0</.test(html));
  const empty = pdf.buildARAgingHtml(computeARAgingReport([], []), BRANDING);
  ok('the empty state no longer says "Nice work"', !/Nice work/.test(empty) && /no retainage is held/.test(empty));

  const reports = read('app/reports.tsx');
  ok('the tab adds a Retainage held KV per row',
    /<KV k="Retainage held" v=\{formatMoney\(r\.retainageHeld\)\} muted=\{r\.retainageHeld <= 0\.5\} \/>/.test(reports));
  ok('…Outstanding is danger-toned only when late and collectible',
    /const outstandingLate = r\.outstanding > 0\.5 && r\.bucket !== 'current';/.test(reports)
    && /tone=\{outstandingLate \? 'bad' : undefined\}/.test(reports) && !/<KV k="Outstanding"[^>]*tone="bad"/.test(reports));
  ok("…a retainage-only row wears a 'Retainage only' pill", /isRetainageOnly \? 'Retainage only'/.test(reports));
  ok('…the hero adds the held retainage as a receivable, not aged',
    /Plus \$\{formatMoney\(report\.totals\.retainageHeld\)\} retainage held until closeout — a receivable, not aged\./.test(reports));
  ok('…the eyebrow counts collectible rows', /OUTSTANDING — \{collectible\} invoice/.test(reports));
  ok('…and VoiceOver hears the held retainage', /retainage held to closeout`/.test(reports) && /\$\{heldSpoken\}/.test(reports));
}

// ── #109 the Payments ledger is to the cent ─────────────────────────────────
console.log('\n#109 Payments is a ledger — to the cent:');
{
  const src = read('app/payments.tsx');
  const calls = [...src.matchAll(/formatMoney\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].map(m => m[1]);
  const whole = calls.filter(a => !/,\s*2\s*$/.test(a));
  ok('every formatMoney call on the screen passes 2 decimals', calls.length >= 8 && whole.length === 0, JSON.stringify(whole));
  ok('the row amount, the Received and Pending heroes, the retention note, the a11y label and the detail alert',
    /\{formatMoney\(payment\.amount, 2\)\}/.test(src) && /formatMoney\(stats\.received, 2\)/.test(src)
    && /formatMoney\(stats\.pending, 2\)/.test(src) && /formatMoney\(stats\.pendingRetentionHeld, 2\)/.test(src)
    && /\$\{formatMoney\(payment\.amount, 2\)\}\$\{feeSpoken\}/.test(src)
    && /`\$\{formatMoney\(payment\.amount, 2\)\} • \$\{providerLabel/.test(src));
  ok('the heroes shrink to fit rather than round', (src.match(/adjustsFontSizeToFit/g) ?? []).length >= 2);
}

console.log(`\nvalidate-w5-reports-pdf: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
process.exit(0);
