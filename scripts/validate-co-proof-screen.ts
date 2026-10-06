// validate-co-proof-screen.ts — pins the change order proof packet's screen
// half: the "Proof packet" button on the CO screen, the share/print plumbing
// (utils/coProofPacketShare.ts) and the CO document body it shares with the
// CO PDF (utils/pdfGenerator.ts buildChangeOrderBodyHtml).
//
// WHY: the packet is what a GC hands an owner, a lender or a lawyer when a
// change order is disputed. Each rule below is one way the screen could
// quietly lie or fail:
//   - the packet's CO page drifting from the CO PDF (a different amount, tax
//     row or approval line) because the body was copied instead of shared;
//   - the web print tab opening AFTER an await, which the browser blocks;
//   - the packet printing the device's provisional CO number instead of the
//     server's (the coForPdf swap Share PDF uses);
//   - a "Packet shared" success shown when nothing was written or confirmed;
//   - the packet writing anything (it is read-only);
//   - copy that skips t().
// Planted mutations (each must turn a named check red; see the lane report):
//   1 `await Promise.resolve()` before openPrintWindowAfterOrThrow on web
//   2 nailIt('Packet shared') after share
//   3 co={existingCO} instead of co={coForPdf}
//   4 buildChangeOrderHtml inlines the body again (extraction gone)
//   5 a raw string label (t() bypassed)
//
// The modules are EXECUTED under bun; react-native / expo and the two I/O
// helpers (photo signing, the schedule audit log) are stubbed.
// Run: bun run scripts/validate-co-proof-screen.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { ChangeOrder, CompanyBranding, Project } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

/** Source with // and /* *\/ comments removed (string contents kept). */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}
/** The text of `function name(...): T { ... }` up to its matching closing brace.
 *  Only used on functions whose return type holds no braces. */
function fnBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*\\(`));
  if (start < 0) return '';
  let i = src.indexOf('{', src.indexOf(')', start)), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return src.slice(start);
}

// ── stubs ────────────────────────────────────────────────────────────────────
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('\n✗ validate-co-proof-screen must run under bun (needs Bun.plugin to stub native modules)\n');
  process.exit(1);
}
const Platform = { OS: 'ios' as string, select: (o: Record<string, unknown>) => o.ios ?? o.default };
const calls: string[] = [];
const printed: { html: string }[] = [];
let shareAvailable = true;
let shareArgs: { uri: string; opts: Record<string, unknown> } | null = null;
let auditThrows = false;
const writeTrap = new Proxy({}, { get: () => { calls.push('WRITE'); throw new Error('the proof packet must not write'); } });
Bun.plugin({
  name: 'co-proof-screen-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform }, loader: 'object' }));
    build.module('expo-print', () => ({
      exports: {
        printToFileAsync: async (o: { html: string }) => { calls.push('printToFile'); printed.push({ html: o.html }); return { uri: 'file:///packet.pdf' }; },
        printAsync: async () => { calls.push('printAsync'); },
      },
      loader: 'object',
    }));
    build.module('expo-sharing', () => ({
      exports: {
        isAvailableAsync: async () => shareAvailable,
        shareAsync: async (uri: string, opts: Record<string, unknown>) => { calls.push('shareAsync'); shareArgs = { uri, opts }; },
      },
      loader: 'object',
    }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: {}, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: writeTrap, isSupabaseConfigured: false }, loader: 'object' }));
    build.module('@/utils/scheduleAudit', () => ({
      exports: {
        loadScheduleAudit: async () => {
          calls.push('loadScheduleAudit');
          if (auditThrows) throw new Error('audit read failed');
          return { entries: [], source: 'local-only', truncated: false };
        },
      },
      loader: 'object',
    }));
    build.module('@/utils/projectDocuments', () => ({
      exports: {
        resolveDfrPhotosForDocument: async (photos: { id: string; timestamp: string; storagePath?: string }[]) => {
          calls.push('resolvePhotos');
          return photos.map(p => ({ id: p.id, src: `https://signed.example/${p.id}.jpg`, notUploaded: !p.storagePath, timestamp: p.timestamp }));
        },
      },
      loader: 'object',
    }));
  },
});

const G = await import('../utils/pdfGenerator');
const S = await import('../utils/coProofPacketShare');
const D = await import('../utils/pdfDesign');

// ── fixtures ─────────────────────────────────────────────────────────────────
const at = (day: string, hh = '12:00') => `${day}T${hh}:00Z`;
const as = <T,>(v: unknown) => v as T;
const branding: CompanyBranding = as<CompanyBranding>({
  companyName: 'Acme GC', contactName: 'Sam', email: 'sam@acme.example', phone: '555-0100', address: '1 Main St', licenseNumber: 'L-1', tagline: '',
});
const project: Project = as<Project>({ id: 'p1', name: 'Henderson remodel', location: 'Glen Ridge NJ', schedule: null });
/** Approved through a sealed portal e-signature, with frozen tax and prior approved COs. */
const coSigned: ChangeOrder = as<ChangeOrder>({
  id: 'co12', number: 12, projectId: 'p1', date: '2026-09-10',
  description: 'Add a steel beam over the kitchen opening', reason: 'Owner request',
  lineItems: [
    { id: 'li1', name: 'Steel beam', description: 'W8x18', quantity: 1, unit: 'ea', unitPrice: 1200.1, total: 1200.1, isNew: true },
    { id: 'li2', name: 'Labor', description: '', quantity: 8, unit: 'hr', unitPrice: 99.99, total: 799.92 },
  ],
  originalContractValue: 63000, priorApprovedChangesTotal: 13000,
  changeAmount: 2000.02, newContractTotal: 65000.02,
  taxRatePct: 8.875, taxAmount: 177.5, totalWithTax: 2177.52,
  scheduleImpactDays: 3, status: 'approved', approvers: [],
  auditTrail: [
    { id: 'au1', action: 'client_signed_via_portal', actor: 'Dana Client', timestamp: at('2026-09-15'), detail: 'Signed in the portal. record SHA-256 0123456789abcdef…' },
  ],
  createdAt: at('2026-09-10'), updatedAt: at('2026-09-15'),
});
const emptySources = {
  photos: [
    as<import('../types').ProjectPhoto>({ id: 'ph1', projectId: 'p1', uri: 'https://cdn.example/ph1.jpg', storagePath: 'u/p1/ph1.jpg', timestamp: at('2026-09-12'), createdAt: at('2026-09-12') }),
  ],
  photosLoaded: true,
  dailyReports: [], dailyReportsLoaded: true,
  rfis: [], portalMessages: [], commEvents: [], fieldTickets: [], delayEvents: [],
};
const args = { co: coSigned, project, branding, declineLine: null, sources: emptySources };

// ── M1: one CO body for the CO PDF and the packet ────────────────────────────
console.log('\nM1 the CO document body is extracted once and shared');
const GEN = stripComments(read('utils/pdfGenerator.ts'));
const bodyFn = fnBody(GEN, 'buildChangeOrderBodyHtml');
const htmlFn = fnBody(GEN, 'buildChangeOrderHtml');
ok('buildChangeOrderBodyHtml is exported with the contract signature',
  /export function buildChangeOrderBodyHtml\(co: ChangeOrder, project: Project, branding: CompanyBranding\): string/.test(GEN)
  && typeof (G as Record<string, unknown>).buildChangeOrderBodyHtml === 'function');
ok('the body function returns exactly title + badge + reason + table + totals + signature',
  /return titleHtml \+ statusBadge \+ reasonHtml \+ tableHtml \+ totalsBlock \+ sigBlock;/.test(bodyFn)
  && !/pdfShell|pdfHeader|pdfFooter/.test(bodyFn));
ok('buildChangeOrderHtml wraps pdfHeader + buildChangeOrderBodyHtml(...) + pdfFooter(...) and builds nothing itself',
  /bodyHtml:\s*D\.pdfHeader\(branding\) \+ buildChangeOrderBodyHtml\(co, project, branding\) \+\s*D\.pdfFooter\(branding, `Change order #\$\{co\.number\}`, D\.PDF_DISCLAIMERS\.changeOrder\)/.test(htmlFn)
  && !/titleHtml|sigBlock|totalsBlock|coApprovalLine/.test(htmlFn));
ok('the CO body is assembled in one place only', (GEN.match(/titleHtml \+ statusBadge/g) ?? []).length === 1);

const body = G.buildChangeOrderBodyHtml(coSigned, project, branding);
ok('the body carries the G701 rows', ['Original contract sum', 'Net change by prior approved COs', 'Contract sum prior to this CO', 'Sales tax (8.875%)', 'CO total incl. tax', 'New contract total'].every(s => body.includes(s)));
ok('the body carries the sealed approval line', body.includes('Electronically signed by Dana Client in the client portal') && body.includes('data-co-approval="client_signed"'));
ok('the body is body only (no <html, no letterhead, no footer disclaimer)',
  !body.includes('<html') && !body.includes(D.escHtml(D.PDF_DISCLAIMERS.changeOrder)) && !body.includes('Built with'));

// The CO PDF prints exactly that body, between the letterhead and the footer.
Platform.OS = 'ios'; printed.length = 0; calls.length = 0; shareAvailable = true;
await G.generateChangeOrderPDF(coSigned, project, branding);
const coPdfHtml = printed[0]?.html ?? '';
ok('the CO PDF is shell(pdfHeader + body + pdfFooter) byte for byte',
  coPdfHtml === D.pdfShell({
    title: `Change order #${coSigned.number} — ${project.name}`,
    branding,
    bodyHtml: D.pdfHeader(branding) + body + D.pdfFooter(branding, `Change order #${coSigned.number}`, D.PDF_DISCLAIMERS.changeOrder),
  }));

// ── M2: coProofPacketShare ───────────────────────────────────────────────────
console.log('\nM2 coProofPacketShare builds and shares, writes nothing');
const SHARE_SRC = read('utils/coProofPacketShare.ts');
const SHARE = stripComments(SHARE_SRC);
const shareFn = fnBody(SHARE, 'shareCoProofPacket');
const webIdx = shareFn.indexOf("Platform.OS === 'web'");
const openIdx = shareFn.indexOf('openPrintWindowAfterOrThrow(');
const firstAwait = shareFn.search(/\bawait\b/);
ok('web: openPrintWindowAfterOrThrow is called before any await in shareCoProofPacket',
  webIdx >= 0 && openIdx > webIdx && (firstAwait < 0 || openIdx < firstAwait),
  `web@${webIdx} open@${openIdx} firstAwait@${firstAwait}`);
ok("native: shares a PDF with mimeType 'application/pdf' and UTI 'com.adobe.pdf'",
  /mimeType: 'application\/pdf'/.test(shareFn) && /UTI: 'com\.adobe\.pdf'/.test(shareFn) && /printToFileAsync\(\{ html, base64: false \}\)/.test(shareFn));
ok('no write path is referenced (supabase, AsyncStorage, supabaseWrite, offlineQueue)',
  !/supabase|AsyncStorage|supabaseWrite|offlineQueue/i.test(SHARE));
ok('the packet CO page is buildChangeOrderBodyHtml (not a copy)',
  /coBodyHtml: buildChangeOrderBodyHtml\(co, project, branding\)/.test(SHARE));

// web: the tab opens synchronously inside the tap.
{
  Platform.OS = 'web'; calls.length = 0;
  const win = {
    closed: false, html: '',
    document: { images: [] as { complete: boolean }[], write(h: string) { win.html += h; }, open() { win.html = ''; }, close() {} },
    focus() {}, print() { calls.push('print'); }, close() { win.closed = true; calls.push('close'); },
  };
  (globalThis as unknown as { window: unknown }).window = { open: () => { calls.push('window.open'); return win; } };
  const p = S.shareCoProofPacket(args);
  const syncCalls = [...calls];
  const result = await p;
  ok('web: window.open runs synchronously in the tap, before anything is read', syncCalls[0] === 'window.open', JSON.stringify(syncCalls));
  ok("web: resolves 'web_print' and writes the packet into the tab", result === 'web_print' && win.html.includes('Proof packet') && win.html.includes(body));
  ok('web: nothing written', !calls.includes('WRITE'));

  // a failed build closes the tab and the error reaches the caller
  calls.length = 0; win.closed = false;
  const bad = { ...args, project: as<Project>(null) };
  let threw = false;
  try { await S.shareCoProofPacket(bad); } catch { threw = true; }
  ok('web: a failed build closes the tab and rethrows', threw && win.closed);

  // a blocked pop-up throws the blocked message, before anything is read
  (globalThis as unknown as { window: unknown }).window = { open: () => null };
  calls.length = 0;
  let blocked = '';
  try { await S.shareCoProofPacket(args); } catch (e) { blocked = e instanceof Error ? e.message : ''; }
  ok('web: a blocked pop-up says so and reads nothing', blocked.startsWith('Your browser blocked the PDF window.') && !calls.includes('loadScheduleAudit'));
  delete (globalThis as unknown as { window?: unknown }).window;
}

// native: share sheet, else print dialog.
{
  Platform.OS = 'ios'; calls.length = 0; printed.length = 0; shareAvailable = true; shareArgs = null;
  const r = await S.shareCoProofPacket(args);
  const sa = shareArgs as { uri: string; opts: Record<string, unknown> } | null;
  ok("native: share sheet with the PDF → 'shared'",
    r === 'shared' && sa?.uri === 'file:///packet.pdf' && sa?.opts.mimeType === 'application/pdf'
    && sa?.opts.UTI === 'com.adobe.pdf' && sa?.opts.dialogTitle === 'Henderson remodel · CO #12 proof packet');
  const html = printed[0]?.html ?? '';
  ok('native: the packet prints the exact CO PDF body', html.includes(body));
  ok('native: photos are resolved (signed fresh) before printing', calls.indexOf('resolvePhotos') >= 0 && calls.indexOf('resolvePhotos') < calls.indexOf('printToFile') && html.includes('https://signed.example/ph1.jpg'));
  ok('native: nothing written', !calls.includes('WRITE'));

  calls.length = 0; shareAvailable = false;
  const r2 = await S.shareCoProofPacket(args);
  ok("native: no share sheet → print dialog → 'printed'", r2 === 'printed' && calls.includes('printAsync') && !calls.includes('shareAsync'));
  shareAvailable = true;

  // S3: records that had not loaded still build; the packet says "not checked".
  calls.length = 0; printed.length = 0;
  const r3 = await S.shareCoProofPacket({ ...args, sources: { ...emptySources, dailyReportsLoaded: false } });
  ok('an unloaded daily-log source still shares and prints "not checked", never blocks',
    r3 === 'shared' && (printed[0]?.html ?? '').includes('Daily logs had not finished loading on this device, so they were not checked.'));

  auditThrows = true; calls.length = 0;
  const doc = await S.buildCoProofPacketDocument(args);
  ok('a throwing audit read still builds (audit = not read)', doc.html.includes(body) && doc.title === 'Henderson remodel · CO #12 proof packet');
  auditThrows = false;
}

// ── M3: the button ───────────────────────────────────────────────────────────
console.log('\nM3 the Proof packet button');
const BTN_SRC = read('components/changeOrders/COProofPacketButton.tsx');
const BTN = stripComments(BTN_SRC);
ok('testID "co-proof-packet"', /testID="co-proof-packet"/.test(BTN));
ok('gated by coProofPacketAction({ saved: true, dirty, numberHold, busy })', /coProofPacketAction\(\{ saved: true, dirty, numberHold, busy \}\)/.test(BTN) && /disabled=\{!action\.enabled\}/.test(BTN));
ok('a busy ref blocks a double tap', /if \(busyRef\.current\b[^)]*\) return;/.test(BTN) && /busyRef\.current = true;/.test(BTN) && /busyRef\.current = false;/.test(BTN));
{
  const onPress = BTN.slice(BTN.indexOf('const onPress'), BTN.indexOf('return (', BTN.indexOf('const onPress')));
  const afterGuard = onPress.slice(onPress.indexOf('busyRef.current = true;') + 'busyRef.current = true;'.length);
  const shareAt = afterGuard.indexOf('shareCoProofPacket(');
  ok('the tap calls shareCoProofPacket with nothing awaited before it', shareAt >= 0 && !/\bawait\b/.test(afterGuard.slice(0, shareAt)) && !/\bawait\b/.test(onPress.slice(0, onPress.indexOf('busyRef.current = true;'))));
}
ok('no success visual: no nailIt, toast, success haptic or done morph', !/nailIt|toast|Toast|haptic|Haptics|done=/.test(BTN));
ok('a failure shows pdfFailureMessage under the money.coProof copy', /showAlert\(\s*t\('money\.coProof\.failTitle'/.test(BTN) && /pdfFailureMessage\(err, t\('money\.coProof\.failBody'/.test(BTN));
ok('no second reason line (the row\'s pdfReason explains both buttons)', !/<Text\b/.test(BTN));
{
  const COPY: [string, string][] = [
    ['money.coProof.button', 'Proof Packet'],
    ['money.coProof.busy', 'Building the packet…'],
    ['money.coProof.failTitle', 'Could Not Make the Packet'],
    ['money.coProof.failBody', "Couldn't build the proof packet. Try again."],
  ];
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  ok('the exact copy, each through t() with its key',
    COPY.every(([k, en]) => new RegExp(`t\\('${esc(k)}', (['"])${esc(en)}\\1\\)`).test(BTN)));
  // every literal English string in the button sits inside a t() call
  const T_CALL = /\bt\(\s*'[^']*'\s*,\s*(?:'[^']*'|"[^"]*")\s*\)/g;
  const noT = BTN.replace(T_CALL, 'T');
  const label = (noT.match(/label=(\{[^\n]*\}|"[^"]*")/) ?? [])[1] ?? '';
  const alertArgs = noT.slice(noT.indexOf('showAlert('), noT.indexOf('.finally', noT.indexOf('showAlert(')));
  ok('every visible string goes through t() (label and failure alert)',
    label !== '' && !/['"`]/.test(label) && alertArgs !== '' && !/['"`]/.test(alertArgs)
    && !COPY.some(([, en]) => noT.includes(en)),
    `label=${label}`);
}

// ── M4: the CO screen ────────────────────────────────────────────────────────
console.log('\nM4 the CO screen renders it in the PDF row');
const CO = read('app/change-order.tsx');
{
  const rowStart = CO.indexOf('<View style={styles.pdfRow}>');
  const rowEnd = CO.indexOf('</View>', rowStart);
  const row = rowStart >= 0 ? CO.slice(rowStart, rowEnd) : '';
  ok('<COProofPacketButton> sits inside the pdfRow View, after Share PDF',
    /<COProofPacketButton\b/.test(row) && row.indexOf('testID="co-share-pdf"') < row.indexOf('<COProofPacketButton'));
  ok('it prints the server-numbered saved CO (co={coForPdf}) with the row\'s dirty / hold / decline',
    /<COProofPacketButton co=\{coForPdf\} project=\{project\} dirty=\{formDirty\} numberHold=\{numberHold\('pdf'\)\} declineLine=\{declineLine\} \/>/.test(row));
  ok('coForPdf is the confirmedNumber swap, and Share PDF uses it too',
    /const coForPdf = useMemo\(\s*\(\) => \(existingCO && confirmedNumber != null && confirmedNumber !== existingCO\.number \? \{ \.\.\.existingCO, number: confirmedNumber \} : existingCO\)/.test(CO)
    && /const co = coForPdf;\s*await generateChangeOrderPDF\(co, project, branding\);/.test(CO));
  ok('the w4 pins still hold (await generateChangeOrderPDF(co, project, branding), testID="co-share-pdf", pdfBusyRef guard)',
    /await generateChangeOrderPDF\(co, project, branding\)/.test(CO) && /testID="co-share-pdf"/.test(CO) && /pdfBusyRef\.current\) return/.test(CO) && /numberHold: numberHold\('pdf'\)/.test(CO));
  ok('the screen imports the button', /import COProofPacketButton from '@\/components\/changeOrders\/COProofPacketButton';/.test(CO));
}

// ── M5: i18n ────────────────────────────────────────────────────────────────
console.log('\nM5 the copy has an i18n owner');
const SURF = read('i18n/surfaces.ts');
const INDEX = read('i18n/catalog/en/index.ts');
ok("i18n/surfaces.ts: surface 'money.co-proof' owns 'money.coProof.'",
  /id: 'money\.co-proof'[^}]*keyPrefixes: \['money\.coProof\.'\][^}]*files: \['components\/changeOrders\/COProofPacketButton\.tsx'\]/.test(SURF));
ok('its shard is registered in EN_SHARDS',
  /import \{ EN as EN_MONEY_CO_PROOF \} from '\.\/money\.co-proof\.generated';/.test(INDEX) && /'money\.co-proof': EN_MONEY_CO_PROOF,/.test(INDEX));

console.log(`\nvalidate-co-proof-screen: ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
