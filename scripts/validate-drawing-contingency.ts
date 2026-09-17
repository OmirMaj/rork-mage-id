// validate-drawing-contingency.ts — three small "the number/field he set is the
// one that goes out" guards from the 2026-09-16 screen-audit open items.
//
//   A. DRAWING ANALYZER CONTINGENCY. supabase/functions/analyze-drawings told
//      the model "Apply a contingency of 8-12%" for every contractor, while the
//      estimate wizard beside it honoured Settings -> Estimate Defaults. Now the
//      app sends settings.contingencyRate, the function validates it (finite,
//      0-50) and names it in the prompt, and utils/drawingAnalyzer.ts recomputes
//      contingency from the subtotal at that rate — the model's arithmetic is
//      not trusted, same as app/estimate-wizard.tsx — and the result screen says
//      whose rate it was.
//
//   B. BID INVITATION EMAIL. `bid_invite_sent` carried `bids_due_at` and the
//      notify branch never printed it, so the only date a sub saw was the link
//      expiry ("30 days from today" — false on every chase). The scope printed
//      as one run-on line (HTML collapses newlines). The due day must be a
//      CALENDAR day: '2026-09-18' may not print the 17th in any zone, so the
//      label checks run re-spawned under three TZs.
//
//   C. PUNCH listType IN EXPORT / IMPORT. 'punch' | 'crew' (crew items are
//      internal and never reach a client). The JSON export spreads the whole
//      item; the CSV had no column, so a crew item became indistinguishable
//      from formal punch once handed on. Import must settle a missing or junk
//      value to 'punch' through punchListTypeOf.
//
// The pure helpers inside the edge functions cannot be imported under bun (they
// sit beside Deno `serve` imports), so each lives between `>>> name` / `<<< name`
// marker comments and this script transpiles and evaluates THAT block — the
// real code, not a copy. A missing marker fails the run.

import { readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const ROOT = join(__dirname, '..');
const SELF = join(__dirname, 'validate-drawing-contingency.ts');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

/** Evaluate the marked block of `file`, handing it `deps`, returning `names`. */
function evalBlock<T>(file: string, marker: string, names: string[], deps: Record<string, unknown> = {}): T | null {
  const src = read(file);
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const block = src.slice(start, end).replace(/^export /gm, '');
  const js = new Transpiler({ loader: 'ts' }).transformSync(block);
  const depNames = Object.keys(deps);
  return new Function(...depNames, `${js}\nreturn { ${names.join(', ')} };`)(...depNames.map(k => deps[k])) as T;
}

// ─── Child mode: TZ-sensitive due-day checks only ─────────────────────
const NOTIFY = 'supabase/functions/notify/index.ts';

async function loadNotifyHelpers() {
  // _shared/email.ts reads Deno.env at module top; a stub lets bun import the
  // REAL escapeHtml rather than a restatement of it.
  (globalThis as unknown as { Deno?: unknown }).Deno ??= { env: { get: () => undefined } };
  // A variable specifier: tsc refuses a literal '.ts' import path, bun does not care.
  const EMAIL = '../supabase/functions/_shared/email.ts';
  const email = await import(EMAIL) as { escapeHtml: (t: string) => string };
  return evalBlock<{
    bidDueDayLabel: (v: unknown) => string | null;
    bidScopeHtml: (s: string) => string;
    bidInviteExpiryText: (e: unknown, now: number) => string;
  }>(NOTIFY, 'bid-invite-format', ['bidDueDayLabel', 'bidScopeHtml', 'bidInviteExpiryText'], { escapeHtml: email.escapeHtml });
}

if (process.env.DRAWING_CONTINGENCY_TZ_CHILD) {
  const h = await loadNotifyHelpers();
  if (h) {
    const tz = process.env.TZ;
    const a = h.bidDueDayLabel('2026-09-18');
    ok(`[${tz}] '2026-09-18' prints Friday the 18th, not the 17th`, a === 'Friday, September 18, 2026', String(a));
    const b = h.bidDueDayLabel('2026-09-18T00:00:00.000Z');
    ok(`[${tz}] a synced ISO timestamp names the same day`, b === 'Friday, September 18, 2026', String(b));
    const c = h.bidDueDayLabel('2027-01-01');
    ok(`[${tz}] New Year's Day does not slip into the previous year`, c === 'Friday, January 1, 2027', String(c));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

// ─── A. analyze-drawings contingency ──────────────────────────────────
console.log('\nA. drawing analyzer contingency');
const FN = 'supabase/functions/analyze-drawings/index.ts';
const fnSrc = read(FN);
const edge = evalBlock<{
  usableContingencyRate: (v: unknown) => number | null;
  contingencyInstruction: (r: number | null) => string;
}>(FN, 'contingency-rate', ['usableContingencyRate', 'contingencyInstruction']);
if (edge) {
  ok('function accepts 0, 8 and 50', edge.usableContingencyRate(0) === 0 && edge.usableContingencyRate(8) === 8 && edge.usableContingencyRate(50) === 50);
  ok('function refuses -1, 50.5, NaN, Infinity',
    [-1, 50.5, NaN, Infinity].every(v => edge.usableContingencyRate(v) === null));
  ok('function refuses a string and null (no coercion to 0)',
    edge.usableContingencyRate('8') === null && edge.usableContingencyRate(null) === null && edge.usableContingencyRate(undefined) === null);
  const own = edge.contingencyInstruction(6.5);
  ok('a valid rate is named as the contractor’s own', own.includes('6.5%') && own.includes("this contractor's own rate") && !own.includes('8-12'), own);
  ok('no rate keeps the 8-12% instruction', edge.contingencyInstruction(null).includes('8-12%'));
}
// The prompt must actually USE the helpers — a helper nobody calls is the bug
// with extra steps.
const promptStart = fnSrc.indexOf('function buildPrompt(');
const promptBody = promptStart > -1 ? fnSrc.slice(promptStart, fnSrc.indexOf('\n}\n', promptStart)) : '';
ok('buildPrompt routes step 5 through contingencyInstruction(usableContingencyRate(req.contingencyRate))',
  /contingencyInstruction\(\s*usableContingencyRate\(\s*req\.contingencyRate\s*\)\s*\)/.test(promptBody));
ok('buildPrompt no longer hardcodes the 8-12% line', !/Apply a contingency of 8-12%/.test(promptBody));
ok('the category list no longer invites a Contingency line item (it would double with totals)',
  !/Permits & Fees \/ Contingency/.test(promptBody));

const CLIENT = 'utils/drawingAnalyzer.ts';
const cli = evalBlock<{
  usableContingencyRate: (v: unknown) => number | null;
  settleDrawingTotals: (r: unknown, rate: number | null) => { result: { totals: { subtotal: number; contingencyPercent: number; contingencyAmount: number; grandTotal: number } }; contingencyRateUsed: number | null };
}>(CLIENT, 'drawing-contingency', ['usableContingencyRate', 'settleDrawingTotals']);
if (cli) {
  ok('client refuses null (Number(null) would be a 0% nobody set)', cli.usableContingencyRate(null) === null);
  ok('client refuses 51 and accepts 0', cli.usableContingencyRate(51) === null && cli.usableContingencyRate(0) === 0);
  // The model said 12% and got the arithmetic wrong; his rate is 7.
  const aiResult = { lineItems: [], totals: { subtotal: 100000, contingencyPercent: 12, contingencyAmount: 9999, grandTotal: 123456 } };
  const settled = cli.settleDrawingTotals(aiResult, 7);
  ok('his rate replaces the model’s percentage', settled.result.totals.contingencyPercent === 7);
  ok('contingency is recomputed from the subtotal (100000 × 7% = 7000)', settled.result.totals.contingencyAmount === 7000, String(settled.result.totals.contingencyAmount));
  ok('grand total = subtotal + contingency, not the model’s figure', settled.result.totals.grandTotal === 107000, String(settled.result.totals.grandTotal));
  ok('the result reports the rate it used', settled.contingencyRateUsed === 7);
  const cents = cli.settleDrawingTotals({ totals: { subtotal: 1234.56, contingencyPercent: 10, contingencyAmount: 0, grandTotal: 0 } }, 7.5);
  ok('money rounds to the cent (1234.56 × 7.5% = 92.59)', cents.result.totals.contingencyAmount === 92.59 && cents.result.totals.grandTotal === 1327.15,
    JSON.stringify(cents.result.totals));
  // The lines disagree with the model's subtotal (and one line's own total is
  // wrong). The subtotal must be Σ qty × unit, the number "Use as estimate"
  // saves as baseTotal — not the model's 100000.
  const li = (category: string, quantity: number, unitPrice: number, total: number) =>
    ({ category, name: category, description: '', quantity, unitPrice, total, sourcePages: [1], confidence: 'medium', reasoning: '' });
  const lines = cli.settleDrawingTotals({
    lineItems: [li('Framing', 10, 250, 9999), li('Drywall', 3, 333.34, 1000)],
    totals: { subtotal: 100000, contingencyPercent: 12, contingencyAmount: 12000, grandTotal: 112000 },
  }, 10) as unknown as { result: { lineItems: { total: number }[]; totals: { subtotal: number; contingencyAmount: number; grandTotal: number } } };
  ok('line totals are recomputed as qty × unit price (10 × 250 = 2500; 3 × 333.34 = 1000.02)',
    lines.result.lineItems[0]?.total === 2500 && lines.result.lineItems[1]?.total === 1000.02, JSON.stringify(lines.result.lineItems.map(l => l.total)));
  ok('the subtotal is Σ recomputed lines (3500.02), not the model’s 100000', lines.result.totals.subtotal === 3500.02, String(lines.result.totals.subtotal));
  ok('contingency and grand total follow the line-item subtotal (350 / 3850.02)',
    lines.result.totals.contingencyAmount === 350 && lines.result.totals.grandTotal === 3850.02, JSON.stringify(lines.result.totals));
  // An old deployed prompt still offers "Contingency" as a line category.
  const doubled = cli.settleDrawingTotals({
    lineItems: [li('Framing', 1, 10000, 10000), li('Permits & Fees / Contingency', 1, 1000, 1000), li('contingency', 1, 500, 500)],
    totals: { subtotal: 11500, contingencyPercent: 10, contingencyAmount: 1150, grandTotal: 12650 },
  }, 10) as unknown as { result: { lineItems: { category: string }[]; totals: { subtotal: number; contingencyAmount: number; grandTotal: number } } };
  ok('a Contingency-category line is dropped, so contingency is not charged twice',
    doubled.result.lineItems.length === 1 && doubled.result.totals.subtotal === 10000
    && doubled.result.totals.contingencyAmount === 1000 && doubled.result.totals.grandTotal === 11000, JSON.stringify(doubled.result.totals));
  const none = cli.settleDrawingTotals(aiResult, null);
  ok('without a rate the model’s figures stand and are reported as NOT his', none.result === aiResult && none.contingencyRateUsed === null);
}
const clientSrc = read(CLIENT);
ok('analyzeDrawings settles the totals it returns at the validated rate',
  /settleDrawingTotals\(\s*data\.data\s*,\s*rate\s*\)/.test(clientSrc) && /const rate = usableContingencyRate\(\s*opts\.contingencyRate\s*\)/.test(clientSrc));
const screen = read('app/drawing-analyzer.tsx');
ok('the screen sends settings.contingencyRate', /contingencyRate:\s*settings\?\.contingencyRate/.test(screen));
ok('the screen keeps contingencyRateUsed from the response and labels the source',
  /contingencyRateUsed:\s*rateUsed/.test(screen) && /setContingencyRateUsed\(rateUsed\)/.test(screen)
  && /testID="drawing-contingency-source"/.test(screen) && /the default in Settings/.test(screen) && !/your rate in Settings/.test(screen) && /picked by the AI/.test(screen));

// ─── B. bid invitation email ──────────────────────────────────────────
console.log('\nB. bid invitation email');
const notifySrc = read(NOTIFY);
const h = await loadNotifyHelpers();
if (h) {
  ok('no due date → no row', h.bidDueDayLabel('') === null && h.bidDueDayLabel(undefined) === null && h.bidDueDayLabel('  ') === null);
  ok('a rolled-over day is shown as written, never as a different real day', h.bidDueDayLabel('2026-02-31') === '2026-02-31');
  ok('a non-date is shown as written, not dropped', h.bidDueDayLabel('end of month') === 'end of month');
  const scope = h.bidScopeHtml('Demo existing <cabinets>\r\nFrame & hang\nTape "level 4"');
  ok('scope is escaped', scope.includes('&lt;cabinets&gt;') && scope.includes('Frame &amp; hang') && scope.includes('&quot;level 4&quot;') && !scope.includes('<cabinets>'), scope);
  ok('scope line breaks survive (CRLF and LF) as <br>', scope === 'Demo existing &lt;cabinets&gt;<br>Frame &amp; hang<br>Tape &quot;level 4&quot;', scope);
  ok('a <br> typed into the scope is escaped, not rendered', h.bidScopeHtml('a<br>b') === 'a&lt;br&gt;b');
  const now = Date.parse('2026-09-16T12:00:00Z');
  ok('a chase names the time actually left on the token', h.bidInviteExpiryText('2026-09-26T12:00:00Z', now) === 'It stops working in 10 days.');
  ok('no expiry on the payload does not claim "30 days from today"', !/from today/.test(h.bidInviteExpiryText('', now)));
}
const caseStart = notifySrc.indexOf("case 'bid_invite_sent':");
const caseBody = caseStart > -1 ? notifySrc.slice(caseStart, notifySrc.indexOf('default:', caseStart)) : '';
ok('notify has the bid_invite_sent branch', caseBody.length > 0);
ok('the branch reads bids_due_at through bidDueDayLabel', /bidDueDayLabel\(\s*payload\.bids_due_at\s*\)/.test(caseBody));
ok('the stat card prints a "Bids due" row', /emailStatRow\('Bids due',\s*escapeHtml\(dueLabel\)/.test(caseBody));
ok('the scope renders through bidScopeHtml (escaped + line breaks)', /bidScopeHtml\(scope\)/.test(caseBody) && !/escapeHtml\(scope\)/.test(caseBody));
ok('the expiry sentence comes from the payload, not "30 days from today"',
  /bidInviteExpiryText\(\s*payload\.expires_at/.test(caseBody) && !/30 days from today/.test(caseBody));
ok('title/subtitle are passed raw (wrapEmailHtml escapes them; double-escaping printed &amp;amp;)',
  !/title: `[^`]*escapeHtml\(/.test(caseBody) && !/subtitle: `[^`]*escapeHtml\(/.test(caseBody));
// The app actually sends the fields this branch reads.
const invites = read('utils/bidInvites.ts');
ok('the app sends bids_due_at, scope_description and expires_at on bid_invite_sent',
  (invites.match(/bids_due_at:/g) ?? []).length >= 2 && (invites.match(/scope_description:/g) ?? []).length >= 2
  && (invites.match(/expires_at:/g) ?? []).length >= 2);

// Calendar day under three zones: west of Greenwich is where a UTC-midnight
// parse prints yesterday, so the child run is what catches a regression.
for (const tz of ['Pacific/Honolulu', 'UTC', 'Asia/Tokyo']) {
  const r = spawnSync(process.execPath, [SELF], {
    env: { ...process.env, TZ: tz, DRAWING_CONTINGENCY_TZ_CHILD: '1' }, encoding: 'utf8',
  });
  process.stdout.write(r.stdout.split('\n').filter(l => /[✓✗]/.test(l)).map(l => l + '\n').join(''));
  ok(`due-day checks pass under TZ=${tz}`, r.status === 0, r.stderr.slice(0, 300));
}

// ─── C. punch listType in export / import ─────────────────────────────
console.log('\nC. punch listType through export and import');
const { parseMageExport } = await import('../utils/dataImport');
const exportFile = JSON.stringify({
  exportedBy: 'MAGE ID', schemaVersion: 1,
  punchItems: [
    { id: 'old', projectId: 'p', description: 'pre-listType export' },
    { id: 'crew', projectId: 'p', description: 'crew', listType: 'crew' },
    { id: 'punch', projectId: 'p', description: 'punch', listType: 'punch' },
    { id: 'junk', projectId: 'p', description: 'hand-edited', listType: 'CREW' },
  ],
});
const parsed = parseMageExport(exportFile);
ok('the export parses', parsed.ok);
if (parsed.ok) {
  const byId = new Map((parsed.result.data.punchItems ?? []).map(pi => [pi.id, pi]));
  ok('an old export without listType defaults to punch', byId.get('old')?.listType === 'punch');
  ok('a crew item round-trips as crew', byId.get('crew')?.listType === 'crew');
  ok('a punch item round-trips as punch', byId.get('punch')?.listType === 'punch');
  ok('an unrecognised value settles to punch (the visible side)', byId.get('junk')?.listType === 'punch');
  ok('the rest of the item survives', byId.get('crew')?.description === 'crew' && byId.get('crew')?.projectId === 'p');
}
const exportSrc = read('utils/dataExport.ts');
const csvStart = exportSrc.indexOf('csvs.punchItems = toCsv(');
const csvBlock = csvStart > -1 ? exportSrc.slice(csvStart, exportSrc.indexOf(');', csvStart)) : '';
const headerMatch = /\[([^\]]*)\]/.exec(csvBlock);
const headers = headerMatch ? headerMatch[1].split(',').map(s => s.trim().replace(/'/g, '')) : [];
const rowMatch = /pi => \[([\s\S]*?)\]\)/.exec(csvBlock);
const cells = rowMatch ? rowMatch[1].split(',').map(s => s.trim()).filter(Boolean) : [];
ok('the punch CSV has a listType column', headers.includes('listType'), headers.join(','));
ok('the listType cell is punchListTypeOf(pi), in the same position as its header',
  headers.length === cells.length && cells[headers.indexOf('listType')] === 'punchListTypeOf(pi)', cells.join(' | '));
ok('the JSON export spreads the whole payload (listType rides along as stored)', /\.\.\.payload,/.test(exportSrc));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
