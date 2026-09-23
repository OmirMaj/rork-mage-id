// validate-w5-closeout-packet.ts — wave 5, lane closeout: the Closeout Packet
// (utils/closeoutPacketGenerator.ts, #140) and the web print path of both
// closeout documents (#147, CONTRACT 25).
//
// #140: the packet HANDED to the client rounded every figure to whole dollars,
// counted unsent drafts as invoiced, printed bare warranty / CO days a day early
// west of UTC, and dropped any warranty with a logged claim. #147: on web a
// blocked pop-up returned as if the document had been shared.
//
// The real HTML builder is rendered with the native edges stubbed, in
// America/Los_Angeles so the day-early bug is visible.
//
// Run: bun run scripts/validate-w5-closeout-packet.ts

process.env.TZ = 'America/Los_Angeles';

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail); }
}

type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('validate-w5-closeout-packet must run under bun (Bun.plugin stubs native modules)');
  process.exit(1);
}
const Platform = { OS: 'ios' as string };
let printed = 0;
Bun.plugin({
  name: 'w5-closeout-packet-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform }, loader: 'object' }));
    build.module('expo-print', () => ({ exports: { printToFileAsync: async () => { printed++; return { uri: 'file://x.pdf' }; }, printAsync: async () => {} }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
  },
});

const { buildCloseoutHtml, generateAndShareCloseoutPacket, warrantyInForce } = await import('../utils/closeoutPacketGenerator');
const { shareCloseoutBinderPDF } = await import('../utils/closeoutBinderEngine');
const { PRINT_WINDOW_BLOCKED_MESSAGE } = await import('../utils/platformFile');
const { todayCalendarDay } = await import('../utils/calendarDate');
type PacketData = Parameters<typeof buildCloseoutHtml>[0];

const stamp = { createdAt: '2026-01-10T17:00:00Z', updatedAt: '2026-01-10T17:00:00Z' };
const project = {
  id: 'p1', name: 'Harlow Residence', location: '12 Elm St', type: 'renovation', quality: 'premium',
  status: 'in_progress', squareFootage: 2400, ...stamp,
  estimate: { grandTotal: 250_000.37 },
} as unknown as PacketData['project'];
const invoice = (p: Record<string, unknown>) => ({
  projectId: 'p1', type: 'progress', issueDate: '2026-03-05', dueDate: '2026-04-04', subtotal: 0, taxRate: 0, taxAmount: 0,
  lineItems: [], payments: [], paymentTerms: 'net_30', notes: '', ...stamp, ...p,
});
const warranty = (p: Record<string, unknown>) => ({
  projectId: 'p1', projectName: 'Harlow', category: 'roofing', provider: 'GAF', durationMonths: 12,
  coverageDetails: 'Shingles', claims: [], ...stamp, ...p,
});
const data: PacketData = {
  project,
  branding: { companyName: 'Acme GC' } as unknown as PacketData['branding'],
  changeOrders: [
    { id: 'co1', projectId: 'p1', number: 1, date: '2026-04-01', description: 'Upgrade', reason: 'Owner upgrade',
      lineItems: [], originalContractValue: 0, changeAmount: 1_234.56, newContractTotal: 0, status: 'approved', ...stamp },
    { id: 'co2', projectId: 'p1', number: 2, date: '2026-04-02', description: 'Credit', reason: 'Deleted scope',
      lineItems: [], originalContractValue: 0, changeAmount: -500.1, newContractTotal: 0, status: 'approved', ...stamp },
  ] as unknown as PacketData['changeOrders'],
  invoices: [
    invoice({ id: 'i1', number: 1, status: 'paid', totalDue: 10_000.25, amountPaid: 10_000.25 }),
    invoice({ id: 'i2', number: 2, status: 'draft', totalDue: 12_480.37, amountPaid: 0 }),
  ] as unknown as PacketData['invoices'],
  dailyReports: [],
  punchItems: [],
  warranties: [
    warranty({ id: 'w1', title: 'Roof warranty', startDate: '2026-06-15', endDate: '2027-06-15', status: 'claimed',
      claims: [{ id: 'cl1', date: '2026-08-01', description: 'Leak' }] }),
    warranty({ id: 'w2', title: 'Expired pump', startDate: '2024-01-01', endDate: '2025-01-01', status: 'active' }),
    warranty({ id: 'w3', title: 'Voided hood', startDate: '2026-01-01', endDate: '2030-01-01', status: 'void' }),
  ] as unknown as PacketData['warranties'],
};
const html = buildCloseoutHtml(data);
const section = (title: string) => {
  const at = html.indexOf(`<h3>${title}`);
  if (at < 0) return '';
  const end = html.indexOf('</section>', at);
  return html.slice(at, end < 0 ? undefined : end);
};

console.log('\n#140 money to the cent:');
const fin = section('Financial Summary');
ok('the original contract prints cents', fin.includes('$250,000.37'), fin.slice(0, 400));
ok('a positive CO total prints +$x.xx and a credit nets exactly (1,234.56 − 500.10)', fin.includes('+$734.46'), fin);
ok('the final contract value foots to the cent', fin.includes('$250,734.83'));
ok('no whole-dollar rounding anywhere in the summary', !/\$\d{1,3}(,\d{3})*<\/td>/.test(fin), fin);
const coSec = section('Approved Change Orders');
ok('a negative CO prints as -$500.10', coSec.includes('-$500.10'), coSec);

console.log('\n#140 billed = non-draft invoices:');
ok('Total Invoiced counts only billed invoices "(1)" and excludes the draft',
  fin.includes('Total Invoiced (1)') && fin.includes('$10,000.25') && !fin.includes('12,480'), fin);
const reg = section('Invoice Register');
ok('the register leaves the draft out', reg.length > 0 && !reg.includes('pill-draft') && !reg.includes('12,480.37'), reg);

console.log('\n#140 calendar days print as the day they name:');
ok('a bare CO date 2026-04-01 prints Apr 1, not Mar 31', coSec.includes('Apr 1, 2026') && !coSec.includes('Mar 31, 2026'), coSec);
ok('a bare issue date 2026-03-05 prints Mar 5', reg.includes('Mar 5, 2026') && !reg.includes('Mar 4, 2026'));
const warr = section('Active Warranties');
ok('warranty start / end print their own days', warr.includes('Jun 15, 2026') && warr.includes('Jun 15, 2027') && !warr.includes('Jun 14'), warr);

console.log('\n#140 warranties in force by date, claims included:');
ok('a warranty with a logged claim is still listed as in force', warr.includes('Roof warranty'));
ok('…noted "Claim open" while the claim is unresolved', warr.includes('Claim open'));
ok('an expired warranty stored as "active" is left out', !warr.includes('Expired pump'));
ok('a void warranty is left out', !warr.includes('Voided hood'));
const today = todayCalendarDay();
ok('warrantyInForce: end day today is still in force', warrantyInForce({ status: 'active', endDate: today }, today));
ok('warrantyInForce: no readable end day is not claimed in force', !warrantyInForce({ status: 'active', endDate: '' }, today));

console.log('\n#147 a blocked print window throws on web:');
Platform.OS = 'web';
(globalThis as unknown as { window: unknown }).window = { open: () => null };
let packetErr: unknown = null;
let packetResult: unknown;
try { packetResult = await generateAndShareCloseoutPacket(data); } catch (e) { packetErr = e; }
ok('generateAndShareCloseoutPacket rejects with the blocked-window message (no "true")',
  packetErr instanceof Error && packetErr.message === PRINT_WINDOW_BLOCKED_MESSAGE && packetResult === undefined, String(packetErr));
let binderErr: unknown = null;
try {
  await shareCloseoutBinderPDF({
    project: { id: 'p1', name: 'Harlow', ...stamp } as never,
    branding: { companyName: 'Acme' } as never,
    binder: { id: 'b1', projectId: 'p1', userId: 'u', maintenanceSchedule: [], notes: '', status: 'draft', ...stamp },
    commitments: [], photos: [], selections: [], warranties: [], rfis: [], submittals: [], lienWaivers: [], subcontractors: [],
  });
} catch (e) { binderErr = e; }
ok('shareCloseoutBinderPDF rejects with the blocked-window message', binderErr instanceof Error && binderErr.message === PRINT_WINDOW_BLOCKED_MESSAGE, String(binderErr));
const written: string[] = [];
(globalThis as unknown as { window: unknown }).window = {
  open: () => ({ document: { write: (h: string) => written.push(h), close: () => {}, images: [] }, focus: () => {}, print: () => {} }),
};
ok('an open window still resolves true', (await generateAndShareCloseoutPacket(data)) === true && written.length === 1);
Platform.OS = 'ios';
ok('native still prints through expo-print', (await generateAndShareCloseoutPacket(data)) === true && printed > 0);

const src = readFileSync(join(ROOT, 'utils/closeoutPacketGenerator.ts'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
ok('no Math.round whole-dollar formatter left', !/Math\.round\(n\)\.toLocaleString/.test(src));
ok('no `new Date(iso).toLocaleDateString` day parse left', !/new Date\(iso\)/.test(src));
ok('the stored-status warranty filter is gone', !/w\.status === 'active' \|\| w\.status === 'expiring_soon'/.test(src));

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
