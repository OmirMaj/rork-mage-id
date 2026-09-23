// validate-w5-join-screens-print-window.ts — wave 5, join lane w5-join-screens.
//
// CONTRACT 25 (#147), the repo-wide guard. On web every "Share PDF" / print
// opens a blank window synchronously inside the tap and writes the document
// into it. When the browser blocks that window, window.open returns null —
// and the hand-rolled copies of this in utils/ skipped the write (or opened a
// blob: tab that was blocked just the same) and resolved as if the PDF had
// opened: the screen played its success haptic and said "shared" with nothing
// on screen. There is now ONE path, utils/platformFile openPrintWindowOrThrow,
// which THROWS PRINT_WINDOW_BLOCKED_MESSAGE; callers show
// pdfFailureMessage(err, fallback) and no success feedback on failure.
//
//   1. no `window.open('', '_blank')` in utils/ outside platformFile.ts, except
//      the allow-listed handles below (each with its reason, each re-checked);
//   2. no 'noopener' in a window.open whose return value is used (it makes
//      window.open return null in every browser, hiding a block);
//   3. the wave-4 screens routed here catch their PDF failure through
//      pdfFailureMessage and never play the success haptic in the catch.
//
// Run: bun run scripts/validate-w5-join-screens-print-window.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.W5JS_ROOT ?? join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function walk(dir: string, out: string[] = []): string[] {
  let names: string[] = [];
  try { names = readdirSync(join(ROOT, dir)); } catch { return out; }
  for (const n of names) {
    if (n === 'node_modules' || n.startsWith('.')) continue;
    const rel = join(dir, n);
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(rel);
  }
  return out;
}
/** Source with comments removed, so an explanatory comment never matches. */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const BLANK_OPEN = /window\.open\(\s*(['"])\1\s*,\s*['"]_blank['"]\s*\)/g;

/** Blank windows that are NOT print windows, or that carry their own null
 *  handling — each re-checked for the property that justifies it. */
const ALLOWED: { file: string; why: string; proof: RegExp }[] = [
  {
    file: 'utils/contractSealing.ts',
    why: 'a DOWNLOAD tab (#56): opened in the tap, then pointed at the signed PDF URL; no document.write, no print, throws on a null window',
    proof: /if \(!w\) throw new Error\(SEALED_PDF_WINDOW_BLOCKED_MESSAGE\)[\s\S]*location\.href/,
  },
  {
    file: 'utils/punchExportDelivery.ts',
    why: "the punch export's placeholder-then-report handle: reports `blocked` to its caller, which says so",
    proof: /blocked:\s*!w/,
  },
];

console.log('\n1. one print-window path in utils/:');
{
  const files = walk('utils').filter(f => f !== 'utils/platformFile.ts');
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const f of files) {
    const src = code(read(f));
    const n = [...src.matchAll(BLANK_OPEN)].length;
    if (n === 0) continue;
    const allow = ALLOWED.find(a => a.file === f);
    if (allow) { seen.add(f); continue; }
    hits.push(`${f} (${n})`);
  }
  ok("no hand-rolled window.open('', '_blank') outside utils/platformFile.ts (use openPrintWindowOrThrow)", hits.length === 0, hits.join(', '));
  for (const a of ALLOWED) {
    const src = read(a.file);
    ok(`allow-listed ${a.file} still opens one and still justifies it: ${a.why}`, seen.has(a.file) && a.proof.test(src));
  }
  const pf = read('utils/platformFile.ts');
  ok('openPrintWindowOrThrow throws the blocked sentence on a null window',
    /export function openPrintWindowOrThrow\(html: string\): void \{[\s\S]{0,200}if \(!w\) throw new Error\(PRINT_WINDOW_BLOCKED_MESSAGE\);/.test(pf));
  ok('pdfFailureMessage passes the blocked sentence through and nothing else',
    /return err instanceof Error && err\.message\.startsWith\('Your browser blocked the PDF window\.'\) \? err\.message : fallback;/.test(pf));
  for (const f of ['utils/aiaBilling.ts', 'utils/exportSchedulePdf.ts', 'utils/scheduleReportExport.ts', 'utils/safety/oshaExport.ts']) {
    ok(`${f} prints on web through openPrintWindowOrThrow`, /openPrintWindowOrThrow\(html\);/.test(code(read(f))));
  }
}

console.log("\n2. no 'noopener' on a window.open whose result is used:");
{
  const bad: string[] = [];
  for (const f of ['utils', 'app', 'components', 'hooks'].flatMap(d => walk(d))) {
    const src = code(read(f));
    for (const m of src.matchAll(/(=|\(|!|return)\s*(?:typeof window[^?]*\?\s*)?window\.open\([^)]*noopener[^)]*\)/g)) {
      bad.push(`${f}:${src.slice(0, m.index ?? 0).split('\n').length}`);
    }
  }
  ok("window.open(…, 'noopener') is only ever fire-and-forget", bad.length === 0, bad.join(', '));
}

console.log('\n3. the routed callers say what happened:');
{
  // [file, the awaited PDF call, the fallback sentence the catch must use]
  const CALLERS: [string, RegExp][] = [
    ['app/closeout-binder.tsx', /await shareCloseoutBinderPDF\(/],
    ['app/closeout-binder.tsx', /await generateG707PDF\(/],
    ['app/job-costing.tsx', /await sharePurchaseOrderPDF\(/],
    ['app/project-detail.tsx', /await generateAndShareCloseoutPacket\(/],
    ['app/change-order.tsx', /await generateG714PDF\(/],
    ['app/change-order.tsx', /await generateChangeOrderPDF\(/],
    ['app/aia-pay-app.tsx', /await generateAIAPayAppPDF\(/],
    ['app/contract.tsx', /await downloadSealedContractPdf\(/],
    ['app/safety-osha.tsx', /await exportOsha300Pdf\(/],
  ];
  for (const [f, call] of CALLERS) {
    const src = read(f);
    const found = [...src.matchAll(new RegExp(call.source, 'g'))];
    ok(`${f}: ${call.source.replace(/\\/g, '')} is present`, found.length > 0);
    for (const m of found) {
      const after = src.slice(m.index ?? 0);
      const c = /\}\s*catch\s*\((\w+)\)\s*\{([\s\S]*?)\n\s*\}\s*(?:finally|\n)/.exec(after);
      const body = c?.[2] ?? '';
      ok(`${f}: its catch shows pdfFailureMessage(${c?.[1] ?? 'err'}, …)`, new RegExp(`pdfFailureMessage\\(${c?.[1] ?? 'err'}, `).test(body), body.trim().slice(0, 140));
      ok(`${f}: …and plays no success haptic / toast there`, !/NotificationFeedbackType\.Success|nailIt\(/.test(body));
    }
  }
  ok("project-detail's closeout toast only follows a returned success", /if \(ok\) \{[\s\S]{0,200}nailIt\('Closeout packet built and shared\.'\);/.test(read('app/project-detail.tsx')));
}

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-w5-join-screens-print-window: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
