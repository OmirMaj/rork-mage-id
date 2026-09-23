// scripts/validate-w5-desktop-web-pdf.ts — handing him a PDF actually hands
// him a PDF, or says why not (audit 2026-09-23 #56 and #147).
//
//   #56 'Download sealed PDF' on a signed contract:
//       NATIVE — expo-sharing only shares a readable LOCAL file, and the code
//       handed it the https signed URL, so every iPhone tap ended in "You don't
//       have access to the provided file". The PDF is now downloaded into the
//       cache and the local copy is shared; a failed download or a missing
//       share sheet throws a sentence instead of doing nothing.
//       WEB — the tab was opened AFTER the createSignedUrl await (Safari's
//       pop-up blocker swallows it) with 'noopener' (so window.open returned
//       null either way and the code could not tell). The blank tab now opens
//       in the tap, a null window throws, and the tab is pointed at storage
//       once the URL exists (or closed if minting it fails).
//   #147 the WIP and purchase-order PDFs on the web: a blocked pop-up used to
//       return normally (the screen said nothing, reports fired the success
//       haptic) and print() ran before images loaded. Both now go through
//       utils/platformFile's openPrintWindowOrThrow, the WIP window opening
//       before any await.
//
// react-native, expo-print, expo-sharing, expo-file-system, expo-crypto and
// the heavy pdfGenerator are replaced with stand-ins BEFORE the modules load
// (bun cannot parse react-native), so the real functions run end to end.
//
// Run via: bun run scripts/validate-w5-desktop-web-pdf.ts

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
const events: string[] = [];
let sharingAvailable = true;
const shared: { uri: string; opts: Record<string, unknown> }[] = [];
let downloadStatus = 200;
let downloadThrows = false;
const downloads: { url: string; to: string }[] = [];
let printed = 0;

mock.module('react-native', () => ({ Platform }));
mock.module('expo-print', () => ({
  printToFileAsync: async () => { events.push('printToFile'); return { uri: 'file:///cache/print.pdf' }; },
  printAsync: async () => { printed++; },
}));
mock.module('expo-sharing', () => ({
  isAvailableAsync: async () => { events.push('isAvailable'); return sharingAvailable; },
  shareAsync: async (uri: string, opts: Record<string, unknown>) => { events.push('share'); shared.push({ uri, opts }); },
}));
mock.module('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///var/mobile/Containers/Data/Caches/',
  documentDirectory: 'file:///var/mobile/Containers/Data/Documents/',
  downloadAsync: async (url: string, to: string) => {
    events.push('download'); downloads.push({ url, to });
    if (downloadThrows) throw new Error('The Internet connection appears to be offline.');
    return { uri: to, status: downloadStatus, headers: {}, mimeType: 'application/pdf' };
  },
  readAsStringAsync: async () => '',
  writeAsStringAsync: async () => {},
}));
mock.module('expo-crypto', () => ({ digestStringAsync: async () => '', CryptoDigestAlgorithm: {}, CryptoEncoding: {} }));
mock.module('../utils/pdfGenerator', () => ({ generateContractPDFUri: async () => null }));

const sealing = await import('../utils/contractSealing');
const { PRINT_WINDOW_BLOCKED_MESSAGE, pdfFailureMessage } = await import('../utils/platformFile');
const { shareWipPeriodPdf } = await import('../utils/wipExport');
const { computeWipPortfolio } = await import('../utils/wip');
const po = await import('../utils/purchaseOrderPdf');
const { sharePurchaseOrderPDF } = po;
import type { ProjectContract, Commitment, Project, CompanyBranding } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const code = (p: string) => read(p).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

// ── a stand-in browser window ────────────────────────────────────────────────
type FakeWin = {
  document: { write: (h: string) => void; open: () => void; close: () => void; images: { complete: boolean }[] };
  focus: () => void; print: () => void; close: () => void;
  opener: unknown; location: { href: string };
  written: string[]; closed: boolean; printed: boolean;
};
const openCalls: unknown[][] = [];
let nextWindow: FakeWin | null = null;
const makeWin = (): FakeWin => {
  const w: FakeWin = {
    written: [], closed: false, printed: false, opener: { parent: true }, location: { href: 'about:blank' },
    document: { write: (h: string) => { w.written.push(h); }, open: () => {}, close: () => {}, images: [] },
    focus: () => {}, print: () => { w.printed = true; }, close: () => { w.closed = true; },
  };
  return w;
};
(globalThis as unknown as { window: unknown }).window = {
  open: (...args: unknown[]) => { events.push('window.open'); openCalls.push(args); return nextWindow; },
};
const reset = () => {
  events.length = 0; shared.length = 0; downloads.length = 0; openCalls.length = 0;
  sharingAvailable = true; downloadStatus = 200; downloadThrows = false; nextWindow = null; printed = 0;
};

// ── a stand-in supabase storage client ───────────────────────────────────────
let signError: string | null = null;
const signCalls: { path: string; ttl: number }[] = [];
const supabase = {
  storage: {
    from: (bucket: string) => ({
      createSignedUrl: async (path: string, ttl: number) => {
        events.push('createSignedUrl'); signCalls.push({ path, ttl });
        if (bucket !== 'secure-contracts') return { data: null, error: { message: 'wrong bucket' } };
        return signError
          ? { data: null, error: { message: signError } }
          : { data: { signedUrl: `https://x.supabase.co/storage/v1/object/sign/secure-contracts/${path}?token=abc` }, error: null };
      },
    }),
  },
} as unknown as SupabaseClient;

const CONTRACT = { id: 'ctr/9 x', signedPdfUrl: 'u1/ctr/9 x.pdf' } as unknown as ProjectContract;
const catchMsg = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof Error ? e.message : String(e); } };

// ═════ #56 native ════════════════════════════════════════════════════════════
console.log('\n#56 native: the sealed PDF is downloaded, then the LOCAL copy is shared:');
{
  reset(); signError = null; signCalls.length = 0; Platform.OS = 'ios';
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('it resolves', err === null, String(err));
  ok('the signed URL is downloaded into the cache directory',
    downloads.length === 1 && downloads[0].url.startsWith('https://')
    && downloads[0].to.startsWith('file:///var/mobile/Containers/Data/Caches/'), JSON.stringify(downloads));
  ok('the cache file name is the sanitised contract id (no path separator or space leaks in)',
    downloads[0]?.to.endsWith('/contract-ctr_9_x.pdf'), downloads[0]?.to);
  ok('shareAsync is handed the LOCAL file, never an http(s) URL',
    shared.length === 1 && !/^https?:/i.test(shared[0].uri) && shared[0].uri === downloads[0]?.to, JSON.stringify(shared));
  ok('…as a PDF (mimeType + UTI)', shared[0]?.opts.mimeType === 'application/pdf' && shared[0]?.opts.UTI === 'com.adobe.pdf');
  ok('the order is: check sharing → mint URL → download → share',
    events.join(',') === 'isAvailable,createSignedUrl,download,share', events.join(','));
  ok(`the signed URL lives long enough for a slow jobsite download (${signCalls[0]?.ttl}s, 5-10 min)`,
    (signCalls[0]?.ttl ?? 0) >= 300 && (signCalls[0]?.ttl ?? 0) <= 600);
  ok('the owner-prefixed storage path is used as stored', signCalls[0]?.path === 'u1/ctr/9 x.pdf');
}
{
  reset(); signError = null; Platform.OS = 'ios'; downloadStatus = 403;
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('a non-200 download throws the plain sentence', err === sealing.SEALED_PDF_DOWNLOAD_FAILED_MESSAGE, String(err));
  ok('…and the error body on disk is never shared as a PDF', shared.length === 0);
}
{
  reset(); signError = null; Platform.OS = 'ios'; downloadThrows = true;
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('no signal (download rejects) throws the same sentence', err === sealing.SEALED_PDF_DOWNLOAD_FAILED_MESSAGE, String(err));
}
{
  reset(); signError = null; Platform.OS = 'ios'; sharingAvailable = false;
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('no share sheet THROWS a sentence (it used to return silently)', !!err && /Sharing isn't available/.test(err), String(err));
  ok('…before anything is downloaded', downloads.length === 0);
}
{
  reset(); signError = 'Object not found'; Platform.OS = 'ios';
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('a failed signed-URL mint is reported', !!err && /Failed to create a download link: Object not found/.test(err), String(err));
  signError = null;
}

// ═════ #56 web ═══════════════════════════════════════════════════════════════
console.log('\n#56 web: the tab opens in the tap, a block is said out loud:');
{
  reset(); Platform.OS = 'web'; nextWindow = makeWin();
  const w = nextWindow;
  const p = sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase });
  ok('window.open ran SYNCHRONOUSLY, before the first await (still inside the tap)',
    openCalls.length === 1 && events[0] === 'window.open', events.join(','));
  const err = await catchMsg(p);
  ok('it resolves', err === null, String(err));
  ok("the window is opened blank WITHOUT 'noopener' (so a block is detectable)",
    openCalls[0]?.[0] === '' && openCalls[0]?.[1] === '_blank' && openCalls[0]?.length === 2, JSON.stringify(openCalls[0]));
  ok('the URL is minted AFTER the window opened', events.indexOf('window.open') < events.indexOf('createSignedUrl'));
  ok('the tab is cut loose from this page (opener = null) and pointed at the signed URL',
    w.opener === null && /^https:\/\/x\.supabase\.co\/storage\/v1\/object\/sign\/secure-contracts\//.test(w.location.href), w.location.href);
  ok('expo-sharing is not used on web', shared.length === 0 && !events.includes('isAvailable'));
}
{
  reset(); Platform.OS = 'web'; nextWindow = null;
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('a blocked pop-up (window.open → null) THROWS the allow-pop-ups sentence',
    err === sealing.SEALED_PDF_WINDOW_BLOCKED_MESSAGE, String(err));
  ok('…which pdfFailureMessage passes through', pdfFailureMessage(new Error(String(err)), 'x') === err);
  ok('…and no URL was minted for a tab that never opened', !events.includes('createSignedUrl'));
}
{
  reset(); Platform.OS = 'web'; nextWindow = makeWin(); signError = 'JWT expired';
  const w = nextWindow;
  const err = await catchMsg(sealing.downloadSealedContractPdf({ contract: CONTRACT, userId: 'u1', supabase }));
  ok('a failed mint rethrows', !!err && /JWT expired/.test(err), String(err));
  ok('…and closes the blank tab instead of leaving it hanging', w.closed === true);
  signError = null;
}

// ═════ #147 WIP ══════════════════════════════════════════════════════════════
console.log('\n#147 the WIP PDF on the web:');
const PERIOD = { id: 'p', periodEndDate: '2026-09-30', createdAt: '2026-09-30T00:00:00.000Z', rows: [], portfolioTotals: computeWipPortfolio([]) };
{
  reset(); Platform.OS = 'web'; nextWindow = null;
  const p = shareWipPeriodPdf(PERIOD as never, 'Ridge Builders', '2026-09-23');
  ok('window.open ran synchronously, before any await (no lazy import first)',
    openCalls.length === 1, `${openCalls.length} opens before the first await`);
  const err = await catchMsg(p);
  ok('a blocked pop-up rejects with PRINT_WINDOW_BLOCKED_MESSAGE', err === PRINT_WINDOW_BLOCKED_MESSAGE, String(err));
  ok('…and expo-print was never reached on web', !events.includes('printToFile'));
}
{
  reset(); Platform.OS = 'web'; nextWindow = makeWin();
  const w = nextWindow;
  const err = await catchMsg(shareWipPeriodPdf(PERIOD as never, 'Ridge Builders', '2026-09-23'));
  ok('an open window gets the WIP document', err === null && w.written.some(h => /Work-In-Progress|WIP/i.test(h) && h.includes('Ridge Builders')), String(err));
  ok('print waits (it is scheduled, not called straight after close)', w.printed === false);
  await new Promise(r => setTimeout(r, 400));
  ok('…and runs once the images have settled', w.printed === true);
}
{
  reset(); Platform.OS = 'ios';
  const err = await catchMsg(shareWipPeriodPdf(PERIOD as never, 'Ridge Builders'));
  ok('native still renders and shares the PDF file', err === null && events.includes('printToFile') && shared[0]?.uri === 'file:///cache/print.pdf', String(err));
  ok('…and never opens a browser window', openCalls.length === 0);
}

// ═════ #147 PO ═══════════════════════════════════════════════════════════════
console.log('\n#147 the purchase order on the web:');
const PO = {
  id: 'c1', projectId: 'p1', number: 'PO-7', type: 'purchase_order', description: 'Windows',
  amount: 18_000, paidToDate: 0, signedDate: '2026-09-01', phase: 'Build', status: 'active', vendorName: 'Glass Co',
} as unknown as Commitment;
const PROJ = { id: 'p1', name: 'Hale Residence', location: '12 Oak St', status: 'in_progress', createdAt: '2026-01-01', updatedAt: '2026-01-01' } as unknown as Project;
const BRAND = { companyName: 'Ridge Builders', contactName: '', phone: '', email: '', address: '', licenseNumber: '', tagline: '' } as CompanyBranding;
{
  reset(); Platform.OS = 'web'; nextWindow = null;
  const err = await catchMsg(sharePurchaseOrderPDF(PO, PROJ, BRAND, [], []));
  // Job Costing shows the sentence as-is, and its control is the PO row's
  // download icon, so the generic "tap Share again" would misdirect him.
  const poMsg = String(po.PO_PDF_WINDOW_BLOCKED_MESSAGE ?? '');
  ok("a blocked pop-up rejects with the PO's own sentence (names the download icon, not 'Share')",
    err !== null && err === poMsg && /download icon/.test(poMsg) && !/tap Share/.test(poMsg), String(err));
  ok('…which pdfFailureMessage passes through (starts like PRINT_WINDOW_BLOCKED_MESSAGE)',
    err !== null && pdfFailureMessage(new Error(err), 'fallback') === err);
}
{
  reset(); Platform.OS = 'web'; nextWindow = makeWin();
  const w = nextWindow;
  const err = await catchMsg(sharePurchaseOrderPDF(PO, PROJ, BRAND, [], []));
  ok('an open window gets the PO', err === null && w.written.some(h => h.includes('PO-7')), String(err));
  ok('print is not fired straight after close', w.printed === false);
  await new Promise(r => setTimeout(r, 400));
  ok('…it fires once images settle', w.printed === true);
}

// ═════ source guards ═════════════════════════════════════════════════════════
console.log('\nsource guards:');
{
  const wip = code('utils/wipExport.ts');
  const fnBody = wip.slice(wip.indexOf('export async function shareWipPeriodPdf('), wip.indexOf('export function csvHandoverOutcome('));
  ok('shareWipPeriodPdf builds the HTML and opens the window before its first await',
    fnBody.indexOf('openPrintWindowOrThrow(html)') > 0 && fnBody.indexOf('openPrintWindowOrThrow(html)') < fnBody.indexOf('await '));
  ok('wipExport still has no top-level react-native / platformFile import (bun validators import its builders)',
    !/^import .*(react-native|platformFile|expo-)/m.test(read('utils/wipExport.ts')));
  for (const f of ['utils/wipExport.ts', 'utils/purchaseOrderPdf.ts', 'utils/contractSealing.ts']) {
    const src = code(f);
    ok(`${f}: no hand-rolled print window (window.open('', '_blank') … print())`,
      !/window\.open\(\s*''\s*,\s*'_blank'\s*\)[\s\S]{0,200}\.print\(\)/.test(src));
    ok(`${f}: no 'noopener' (it makes window.open return null, hiding a block)`, !/noopener/.test(src));
  }
  const cs = code('utils/contractSealing.ts');
  ok('contractSealing: native shares only the downloaded local uri', /Sharing\.shareAsync\(localUri,/.test(cs) && !/shareAsync\(data\.signedUrl/.test(cs));
  ok("contractSealing: the download comes from 'expo-file-system/legacy'", /from 'expo-file-system\/legacy'/.test(cs));
  ok('the blocked-window sentence starts like PRINT_WINDOW_BLOCKED_MESSAGE',
    String(sealing.SEALED_PDF_WINDOW_BLOCKED_MESSAGE ?? '').startsWith('Your browser blocked the PDF window.'));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} validate-w5-desktop-web-pdf: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
