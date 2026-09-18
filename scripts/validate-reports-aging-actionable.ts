// validate-reports-aging-actionable.ts — the A/R Aging list is a worklist, so
// every row must open the invoice it describes.
//
// WHY (2026-09-18 audit #35). /reports is where "who owes me" lands — the
// Summary tab's Outstanding tile and the Tools sheet both push it. The A/R
// Aging tab drew each overdue invoice as a plain <View>: no onPress, although
// every ARAgingRow carries invoiceId + projectId. To record the check or send
// the pay link on the 61–90 day invoice she was looking at, the bookkeeper had
// to leave the report and find the invoice again by hand. The invoice screen
// already holds Mark Paid / pay link / Send, so the fix is the tap, not a second
// copy of those buttons.
//
// Also pinned: `/reports?tab=aging` opens straight on the aging tab, so the
// Outstanding tile can land on the list instead of on WIP/Profit.
//
// Source checks over app/reports.tsx (the screen imports react-native and
// cannot run under bun). Comments are stripped first so the WHY prose above a
// fix can quote the old code without tripping the check.
//
// Run via: bun run scripts/validate-reports-aging-actionable.ts
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const src = strip(readFileSync(join(ROOT, 'app/reports.tsx'), 'utf8'));

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

console.log('\nA/R aging rows are actionable:');

const a = src.indexOf('function AgingView(');
const b = src.indexOf('\nfunction ', a + 1);
const aging = a >= 0 ? src.slice(a, b > a ? b : undefined) : '';
ok('AgingView found', aging.length > 0, 'the aging view moved — re-point this check');

// The row itself: the element keyed by invoiceId must be pressable and must
// hand the row to the open-invoice callback.
const rowEl = /<(\w+)\s+key=\{r\.invoiceId\}[\s\S]{0,600}?testID=/.exec(aging);
ok('each aging row is a TouchableOpacity, not a static View',
  rowEl?.[1] === 'TouchableOpacity', `row element is <${rowEl?.[1] ?? '?'}>`);
ok('the row press opens that row\'s invoice',
  /onPress=\{\(\) => onOpenInvoice\(r\)\}/.test(rowEl?.[0] ?? ''));
ok('the row announces itself as a button', /accessibilityRole="button"/.test(rowEl?.[0] ?? ''));
ok('the row shows a chevron (it looks like it goes somewhere)', /<ChevronRight\b/.test(aging));

// The navigation: /invoice with BOTH ids — the invoice screen resolves the job
// from projectId and the document from invoiceId (payment-predictions.tsx:148).
ok('onOpenInvoice pushes /invoice with projectId + invoiceId',
  /onOpenInvoice=\{\(r\) => router\.push\(\{\s*pathname: '\/invoice'[\s\S]{0,120}?params: \{ projectId: r\.projectId, invoiceId: r\.invoiceId \}/.test(src));

// No inline Record payment / Resend: the invoice screen owns those actions.
ok('no duplicated inline payment actions on the aging rows',
  !/Record payment|Resend/.test(aging));

// Deep link to the tab.
ok('/reports reads a ?tab= param', /useLocalSearchParams<\{ tab\?: string \}>\(\)/.test(src));
ok('?tab=aging opens on the A/R Aging tab',
  /requestedTab === 'aging'[\s\S]{0,80}?return requestedTab/.test(src));
ok('a requested WIP tab cannot bypass the Business gate',
  !/requestedTab === 'wip'/.test(src));
// The Summary "who owes me" tile is the entry that promised the aging list;
// it has to ask for it, or it lands on Profit.
const summary = strip(readFileSync(join(ROOT, 'app/(tabs)/summary/index.tsx'), 'utf8'));
ok('the Summary outstanding tile opens /reports on the aging tab',
  /onPressOutstanding=\{\(\) => router\.push\(\{ pathname: '\/reports', params: \{ tab: 'aging' \} \}/.test(summary));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
