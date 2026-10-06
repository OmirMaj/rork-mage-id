// scripts/validate-money-copy.ts — the money / estimating / subs / PDF copy pass
// (docs/VOICE.md) stays done.
//
// The copy lane rewrote the words on the money screens and the PDF builders a
// client, lender or sub reads. Three regressions are cheap to reintroduce and
// invisible in review, so this guard pins them:
//
//   1. A status printed from the raw enum (`s.replace(/_/g, ' ')` or
//      `charAt(0).toUpperCase() + s.slice(1)`) prints Title Case and whatever the
//      row holds. Every status on these surfaces comes from a label map, and each
//      map must cover every value of the union it labels, in sentence case.
//   2. "(s)" plurals ("3 day(s)") on a screen or document.
//   3. The specific tells this pass removed (a gendered sub, ALL CAPS emphasis in
//      the WIP save alert, "Generate & Share"), which drift back when someone
//      copies an old block.
//
// Legal / statutory form wording is out of scope on purpose: the AIA G714 line
// "the following change(s)" is the form's own text (utils/aiaForms.ts), and CSV
// column headers are a data contract with the CPA's importer.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTitleCase } from './copy-title-case';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
/** Source with block and line comments removed, so prose about a pattern never trips it. */
const code = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

let passes = 0;
let failures = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) { passes++; return; }
  failures++;
  console.error(`  ✗ ${name}${detail !== undefined ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
}

// ── 1. Label maps, not humanized enums ──────────────────────────────────────
const LABELLED_SURFACES = [
  'utils/pdfGenerator.ts',
  'utils/closeoutPacketGenerator.ts',
  'app/job-costing.tsx',
  'app/(tabs)/subs/index.tsx',
  'app/prequal-manager.tsx',
  'app/payment-predictions.tsx',
  'app/reports.tsx',
  'app/wip-report.tsx',
  'app/retention.tsx',
  'app/buyout-package.tsx',
  'app/bid-leveling.tsx',
];
const HUMANIZE = /\.replace\(\/_\/g,\s*' '\)|charAt\(0\)\.toUpperCase\(\)\s*\+/;
for (const rel of LABELLED_SURFACES) {
  const src = code(rel);
  const hit = src.split('\n').find((l) => HUMANIZE.test(l));
  ok(`${rel}: no status is humanized from the raw enum`, !hit, hit?.trim());
}

/** The string members of `export type Name = 'a' | 'b' ...` in types/index.ts. */
function unionOf(name: string): string[] {
  const types = read('types/index.ts');
  const m = types.match(new RegExp(`export type ${name} =([^;]+);`));
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_0-9]+)'/g)].map((x) => x[1]);
}
/** The { key: 'Label' } pairs of `const NAME: Record<string, string> = { ... };` in a file. */
function mapOf(rel: string, name: string): Record<string, string> {
  const src = read(rel);
  const at = src.indexOf(`const ${name}`);
  if (at < 0) return {};
  const open = src.indexOf('{', src.indexOf('=', at));
  const close = src.indexOf('};', open);
  const body = src.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const p of body.matchAll(/([a-z_0-9]+):\s*'([^']*)'/g)) out[p[1]] = p[2];
  return out;
}
/** Sentence case: a capital first letter, and no other capital except in an acronym or a number unit. */
const ACRONYM_OK = /\b(RFI|CO|AIA|COI|W-9|GC|PDF)\b/;
function sentenceCase(label: string): boolean {
  if (!/^[A-Z0-9]/.test(label)) return false;
  const rest = label.slice(1).replace(ACRONYM_OK, '');
  return !/\b[A-Z][a-z]/.test(rest);
}

const CONVERTED_FILES = new Set<string>(JSON.parse(readFileSync(join(ROOT, 'scripts', 'copy-style-converted.json'), 'utf8')).paths);

const COVERAGE: [string, string, string][] = [
  // [file, map constant, union in types/index.ts]
  ['utils/pdfGenerator.ts', 'CO_STATUS_PDF_LABEL', 'ChangeOrderStatus'],
  ['utils/pdfGenerator.ts', 'PAYMENT_TERMS_PDF_LABEL', 'PaymentTerms'],
  ['utils/pdfGenerator.ts', 'INCIDENT_SEVERITY_PDF_LABEL', 'IncidentSeverity'],
  ['utils/pdfGenerator.ts', 'RFI_STATUS_PDF_LABEL', 'RFIStatus'],
  ['utils/pdfGenerator.ts', 'RFI_PRIORITY_PDF_LABEL', 'RFIPriority'],
  ['utils/pdfGenerator.ts', 'SUBMITTAL_STATUS_PDF_LABEL', 'SubmittalStatus'],
  ['utils/closeoutPacketGenerator.ts', 'INVOICE_STATUS_LABEL', 'InvoiceStatus'],
  ['utils/closeoutPacketGenerator.ts', 'PUNCH_STATUS_LABEL', 'PunchItemStatus'],
  ['utils/closeoutPacketGenerator.ts', 'QUALITY_LABEL', 'QualityTier'],
  ['app/job-costing.tsx', 'PERMIT_TYPE_LABEL', 'PermitType'],
  ['app/prequal-manager.tsx', 'PREQUAL_STATUS_LABEL', 'PrequalStatus'],
];
for (const [rel, name, union] of COVERAGE) {
  const values = unionOf(union);
  const map = mapOf(rel, name);
  ok(`${union} has values to label (types/index.ts)`, values.length > 0, union);
  const missing = values.filter((v) => !(v in map));
  ok(`${rel} ${name} labels every ${union} value`, missing.length === 0, missing);
  // docs/VOICE.md section 3 (2026-10-05): a file on the converted list
  // (scripts/copy-style-converted.json) prints its labels in Title Case; a file
  // not yet converted keeps sentence case until its lane lands.
  const converted = CONVERTED_FILES.has(rel);
  const bad = Object.values(map).filter((l) => !(converted ? isTitleCase(l) : sentenceCase(l)));
  ok(`${rel} ${name} labels are ${converted ? 'Title Case' : 'sentence case'}`, bad.length === 0, bad);
}
// The wiring, not only the maps: each document actually reads its map.
const pdf = code('utils/pdfGenerator.ts');
ok('the change order PDF prints its status from the map', /pdfCoStatusLabel\(co\.status\)/.test(pdf));
ok('the invoice PDF prints its terms from the map', /const termsLabel = pdfPaymentTermsLabel\(inv\.paymentTerms\);/.test(pdf));
ok('the RFI log prints status and priority from maps',
  /pdfRfiStatusLabel\(r\.status\)/.test(pdf) && /pdfRfiPriorityLabel\(r\.priority\)/.test(pdf));
ok('the daily report prints incident severity from the map', /pdfIncidentSeverityLabel\(inc\.severity\)/.test(pdf));
const closeout = code('utils/closeoutPacketGenerator.ts');
ok('the closeout packet labels project, invoice and punch status from maps',
  /labelOf\(PROJECT_STATUS_LABEL, project\.status\)/.test(closeout)
  && /labelOf\(INVOICE_STATUS_LABEL, inv\.status\)/.test(closeout)
  && /labelOf\(PUNCH_STATUS_LABEL, p\.status\)/.test(closeout));
ok('the subs detail labels a bid outcome from a map', /BID_OUTCOME_LABEL\[bid\.outcome\]/.test(code('app/(tabs)/subs/index.tsx')));

// ── 2. No "(s)" plurals ─────────────────────────────────────────────────────
const PLURAL_SURFACES = [
  ...LABELLED_SURFACES,
  'utils/subBillCheck.ts',
  'utils/subCompliance.ts',
  'utils/wip.ts',
  'utils/wipExport.ts',
  'utils/financialReportPdf.ts',
  'app/budget-dashboard.tsx',
  'components/PDFPreSendSheet.tsx',
];
// A plural word is a bare lowercase word glued to "(s)" ("day(s)", "invoice(s)").
// Code never looks like that: a call is `.test(s)`, `camelCase(s)` or `fn(s)`
// after a capital, so the look-behind rules those out.
const PAREN_PLURAL = /(?<![A-Za-z.$_])[a-z]{2,}\(s\)/;
for (const rel of PLURAL_SURFACES) {
  const hit = code(rel).split('\n').find((l) => PAREN_PLURAL.test(l));
  ok(`${rel}: real plurals, never "(s)"`, !hit, hit?.trim());
}

// ── 3. The removed tells stay removed ───────────────────────────────────────
const GONE: [string, RegExp, string][] = [
  ['utils/subCompliance.ts', /Expiring soon|typed on his record|before he starts|his insurance/, 'Title Case status label (converted file) and no gendered sub'],
  ['app/(tabs)/subs/index.tsx', /couldn't check his portal|keep him so/, 'no gendered sub in the delete alert'],
  ['app/buyout-package.tsx', /tell him to phone|what he is pricing|to his record|AI PICK/, 'no gendered sub, no hard-coded caps badge'],
  ['app/wip-report.tsx', /AS THEY STAND TODAY|will not invent|LOSS JOB/, 'the save alert reads VOICE #18, the loss tag is words'],
  ['components/PDFPreSendSheet.tsx', /Generate & Share|Send via Email|FILE NAME|INCLUDE IN PDF/, 'buttons name the action; labels uppercase by style'],
  ['app/payment-predictions.tsx', /err\?\.message|On Track|At Risk'/, 'no raw error text; sentence-case risk labels'],
  ['app/reports.tsx', />no cost basis</, 'VOICE #17: "No cost basis"'],
  ['utils/pdfGenerator.ts', /Please find attached|Please review the|⚠/, 'no "Please", no emoji on documents'],
];
for (const [rel, re, why] of GONE) {
  const hit = code(rel).split('\n').find((l) => re.test(l));
  ok(`${rel}: ${why}`, !hit, hit?.trim());
}
// The VOICE #18 wording is present, not only the old wording absent.
ok('the WIP save alert says figures are as of today and unpriced trades count as $0',
  /Figures are as of today, labelled with this period end\./.test(read('app/wip-report.tsx'))
  && /count as \$0 until you add one/.test(read('app/wip-report.tsx')));

if (failures > 0) {
  console.error(`\n✗ validate-money-copy: ${passes} passed, ${failures} failed`);
  process.exit(1);
}
console.log(`✓ validate-money-copy: ${passes} passed, 0 failed`);
