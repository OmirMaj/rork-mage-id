// scripts/validate-w4-portal-page-dom.ts — wave 4, lane portal-page.
//
// Boots the REAL homeowner portal (marketing/portal/index.html) in jsdom on a
// snapshot the REAL builder (utils/portalSnapshot.buildPortalSnapshot) made,
// with the network stubbed, and walks the flows this lane changed:
//   - the page renders at all with a schedule on it. The 2026-09-15 screen
//     audit deleted `todayOffset` but kept its uses, so every portal with
//     schedule tasks threw in renderSchedule and stayed blank — a regex guard
//     could not see that; only running the page can.
//   - #64 the contract card carries its terms above a sign box; #44 a credit
//     CO's tax row; #14 photos signed by id, no file:// in the DOM, no
//     passcode sent to signed-media-urls;
//   - #137 a Pay tap reads "Checking your payment…", a return that finds the
//     invoice unpaid never shows Paid, the webhook landing does; re-renders
//     never stack the hero progress bar.
//
// Run: bun run scripts/validate-w4-portal-page-dom.ts
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM, VirtualConsole } from 'jsdom';
import { buildPortalSnapshot } from '../utils/portalSnapshot';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'marketing/portal/index.html'), 'utf8').replace('<script src="/motion.js" defer></script>', '');
const contract: any = {
  id: 'c-1', projectId: 'p1', userId: 'gc-1', version: 1, title: 'Construction Agreement', contractValue: 100000.5,
  scopeText: 'Kitchen remodel per plans.', termsText: 'Terms.', warrantyText: 'One year.', startDate: '2026-10-05', durationDays: 90,
  paymentSchedule: [{ id: 'm1', label: 'Deposit', trigger: 'on_signing', amount: 25000.13, status: 'pending' }],
  allowances: [], status: 'sent', createdAt: 'x', updatedAt: 'x',
};
const snap: any = buildPortalSnapshot({
  project: { id: 'p1', name: 'Maple St', status: 'in_progress', updatedAt: 'x', schedule: { startDate: '2026-05-01', workingDaysPerWeek: 5, totalDurationDays: 10, tasks: [{ id: 't', title: 'Frame', phase: 'S', durationDays: 5, startDay: 1, progress: 50, status: 'in_progress' }] } },
  portal: { portalId: 'pid', enabled: true, showInvoices: true, showPhotos: true, showChangeOrders: true, showSchedule: true, coApprovalEnabled: true },
  contract,
  invoices: [{ id: 'inv-1', number: 7, projectId: 'p1', type: 'progress', issueDate: '2026-09-01', dueDate: '2099-10-01', paymentTerms: 'net_30', notes: '', lineItems: [], subtotal: 4200, taxRate: 0, taxAmount: 0, totalDue: 4200, amountPaid: 0, status: 'sent', payments: [], payLinkUrl: 'https://buy.stripe.com/x', payLinkAmount: 4200 }],
  photos: [{ id: '11111111-1111-4111-8111-111111111111', projectId: 'p1', uri: 'file:///x.jpg', storagePath: 'gc/p1/1.jpg', timestamp: '2026-09-20T00:00:00Z' }],
  changeOrders: [{ id: 'co1', projectId: 'p1', number: 2, description: 'Credit', reason: '', date: '2026-09-01', status: 'submitted', changeAmount: -1000, taxAmount: -80, totalWithTax: -1080, lineItems: [] }],
  supabaseUrl: 'https://nteoqhcswappxxjlpvap.supabase.co', supabaseAnonKey: 'anon',
} as any);
const b64 = Buffer.from(JSON.stringify(snap)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const errors: string[] = [];
let pass = 0; let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(String(e && (e as any).message || e)));
vc.on('error', (e) => errors.push(String(e)));
let serverSnap: any = JSON.parse(JSON.stringify(snap));
const calls: string[] = [];
const dom = new JSDOM(html, {
  url: `https://mageid.app/portal/pid?t=tok#d=${b64}`, runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
  beforeParse(w: any) {
    w.IntersectionObserver = class { observe() {} disconnect() {} };
    w.open = () => null;
    w.fetch = async (url: string, init: any) => {
      calls.push(url + ' ' + (init && init.body ? init.body.slice(0, 160) : ''));
      const json = (b: any, status = 200) => ({ ok: status < 300, status, json: async () => b, text: async () => JSON.stringify(b) });
      if (url.includes('portal_get_snapshot_v2')) return json({ status: 'ok', snapshot: serverSnap });
      if (url.includes('signed-media-urls')) return json({ urls: { '11111111-1111-4111-8111-111111111111': 'https://signed.example/1.jpg' } });
      return json({});
    };
  },
});
const w: any = dom.window;
const d = w.document;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(400);
  ok('the portal renders (no uncaught error, portal shown) with a schedule on it', errors.length === 0 && d.getElementById('portal').style.display === 'block' && d.getElementById('sections').innerHTML.length > 1000, JSON.stringify(errors.slice(0, 3)));
  const secs = d.getElementById('sections').innerHTML as string;
  ok('#64 the contract card shows the payment schedule to the cent and the scope', secs.includes('Payment schedule') && secs.includes('$25,000.13') && secs.includes('Kitchen remodel'));
  ok('#64 …with the sign box under complete terms', secs.includes('data-action="sign-contract"') && secs.indexOf('Payment schedule') < secs.indexOf('data-action="sign-contract"'));
  ok('#64 nothing on the page sends the homeowner to "the app"', !/in the app/.test(d.getElementById('portal').innerHTML));
  ok('#44 the credit CO row reads −$1,000.00 − $80.00 tax = −$1,080.00', /−\$1,000\.00 − \$80\.00 tax = −\$1,080\.00/.test(secs));
  ok('#14 the private photo (gallery and activity feed) is drawn from its signed url',
    d.querySelector('figure.photo img')?.getAttribute('src') === 'https://signed.example/1.jpg'
    && d.querySelector('img.activity-thumb')?.getAttribute('src') === 'https://signed.example/1.jpg');
  ok('#14 no file:// url anywhere in the rendered portal', !/file:\/\//.test(d.getElementById('portal').innerHTML));
  ok('one hero progress bar after the hash boot + server refresh', d.querySelectorAll('#hero-progress').length === 1);
  // re-boot twice
  serverSnap = { ...serverSnap, snapshotAt: 'changed-1' };
  const btn = d.querySelector('[data-pay]');
  ok('the invoice offers Pay', !!btn);
  if (!btn) { console.log(`\n${pass} passed, ${fail} failed`); process.exit(1); }
  btn.click();
  ok('#137 the tapped Pay button reads "Checking your payment…"', d.getElementById('sections').innerHTML.includes('Checking your payment'));
  // Tab returns; server still unpaid for the first polls
  Object.defineProperty(d, 'hidden', { configurable: true, get: () => false });
  d.dispatchEvent(new w.Event('visibilitychange'));
  await wait(300);
  ok('#137 back on the tab with the invoice still unpaid: still checking, never Paid', d.getElementById('sections').innerHTML.includes('Checking your payment') && !/invoice-card paid/.test(d.getElementById('sections').innerHTML));
  ok('#137 a re-render does not stack the hero progress bar', d.querySelectorAll('#hero-progress').length === 1);
  // the webhook lands
  serverSnap = JSON.parse(JSON.stringify(serverSnap));
  serverSnap.sections.invoices[0].balance = 0; serverSnap.sections.invoices[0].amountPaid = 4200; serverSnap.sections.invoices[0].effectiveStatus = 'paid'; delete serverSnap.sections.invoices[0].payLinkUrl;
  await wait(3300);
  const s2 = d.getElementById('sections').innerHTML;
  ok('#137 once the overlay says paid: Paid card, no checking, no Pay button', /invoice-card paid/.test(s2) && !s2.includes('Checking your payment') && !s2.includes('data-pay="'));
  ok('still one hero progress bar after every poll', d.querySelectorAll('#hero-progress').length === 1);
  const vcCount = calls.filter(c => c.includes('portal_get_snapshot_v2')).length;
  ok('#137 the return re-read the snapshot (polls ran)', vcCount >= 3, String(vcCount));
  ok('#14 signed-media-urls was called and never sent a passcode', calls.some(c => c.includes('signed-media')) && !calls.some(c => c.includes('signed-media') && /passcode/.test(c)));
  ok('no uncaught errors through the whole flow', errors.length === 0, JSON.stringify(errors.slice(0, 3)));
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
