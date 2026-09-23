// scripts/validate-client-portal-lane.ts — the homeowner portal shows the
// truth, and nothing the GC did not send (wave 3, lane client-portal).
//
// WHAT IT GUARDS (post-ship workflow audit, 2026-09-18):
//   #4 / #34  A sent invoice / CO reaches the portal in the PORTAL shape (the
//             serializer runs over the frozen copy) — numeric total / balance /
//             effectiveStatus and a gated Pay link; a CO's unitCost, approvers
//             and audit trail never reach the client's browser.
//   #33       A sent CO's status is read LIVE, so a CO sent while draft becomes
//             signable once he submits it.
//   #131      A CO's frozen tax reaches the portal card and the e-sign record.
//   #29       A proposal is published read-only (acceptanceLive=false) while
//             the acceptance RPC is not in production; the page requires it;
//             the setup switch is disabled with the reason.
//   #133      The portal prints the day a payment was RECEIVED, as a local day.
//   #135      Every Pay button and balance on the portal is to the cent.
//   #44       The lite writer carries forward only the sections it never
//             builds — a recalled CO leaves the portal.
//   #122      A failed contract / selections / closeout read never publishes.
//   #23       The lite sync is one shared, owner-only, idempotent function.
//   #40/#125  The reconciler merges the SERVER audit trail (the sealed
//             signature entry survives), records every decision once, and
//             never duplicates the seal.
//   #37       Portal approvals defer the schedule reflow.
//
// Run via: bun run scripts/validate-client-portal-lane.ts
process.env.TZ = 'America/Chicago';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Invoice, ChangeOrder, Project, ClientPortalSettings, COAuditEntry, Permit, SelectionCategory, SavedAIAPayApp } from '../types';
import { freezeForPortal } from '../utils/portalFreeze';
import {
  buildPortalSnapshot, buildPortalProposal, latestPaymentDate, coTaxForPortal,
  PORTAL_PROPOSAL_ACCEPTANCE_LIVE, type PortalSnapshot,
} from '../utils/portalSnapshot';
import {
  mergeLiteSnapshot, syncPortalSnapshotLite, sameSnapshot, isPortalOwner, LITE_CARRIED_SECTIONS, readSelectionsChecked,
  type PortalLiteSyncIO, type PortalLiteSyncInput,
} from '../utils/portalLiteSync';
import { buildCOConsentRecord } from '../utils/portalOwnerCore';

declare const Bun: {
  Transpiler: new (opts: { loader: 'ts' }) => { transformSync: (code: string) => string };
};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let failures = 0;
let passes = 0;
function check(label: string, cond: boolean, detail?: string) {
  if (cond) { passes++; console.log('  ✓', label); }
  else { failures++; console.error('  ✗', label, detail ? `\n      ${detail}` : ''); }
}

/** Lift `function NAME(...) {...}` (or `export function`) by brace matching. */
function lift(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`function ${name} not found`);
  // Skip the parameter list (it may contain `{ ... }` type literals).
  let i = at + `function ${name}(`.length, paren = 1;
  for (; i < src.length && paren > 0; i++) {
    if (src[i] === '(') paren++;
    else if (src[i] === ')') paren--;
  }
  // Skip a return-type annotation up to the body's opening brace at depth 0.
  let depthAngle = 0;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{' && depthAngle === 0) {
      // A `: { ... }` return type is itself braced; the body follows `)` / `>`
      // then optional type then `{`. Detect a type literal by the colon before.
      const before = src.slice(at, i).replace(/\s+$/, '');
      if (/:\s*$/.test(before) || /[|&]\s*$/.test(before)) {
        // skip the braced type literal
        let d = 0;
        for (; i < src.length; i++) {
          if (src[i] === '{') d++;
          else if (src[i] === '}' && --d === 0) break;
        }
        continue;
      }
      break;
    }
    if (ch === '<') depthAngle++;
    else if (ch === '>') depthAngle = Math.max(0, depthAngle - 1);
  }
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(at, j + 1);
  }
  throw new Error(`function ${name} unbalanced`);
}
function runTs<T>(code: string, expose: string): T {
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(`${code}\nexport { ${expose} };`);
  return new Function(`${js.replace(/export \{[^}]*\};?/g, '')}\nreturn ${expose};`)() as T;
}

const project = { id: 'p1', name: 'Maple', status: 'in_progress', ownerUserId: 'gc-1' } as unknown as Project;
const portal = {
  portalId: 'portal-1', enabled: true, showInvoices: true, showChangeOrders: true, showPhotos: true,
  showSchedule: false, showBudgetSummary: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false,
} as unknown as ClientPortalSettings;

async function main() {
  // ── #4 / #34 / #33 ──────────────────────────────────────────────────────────
  console.log('\n#4 / #34 / #33 — a sent record reaches the portal in the portal shape, never raw');
  const inv = {
    id: 'inv-1', number: 7, projectId: 'p1', status: 'sent', totalDue: 77_484.88, subtotal: 77_484.88, amountPaid: 0,
    lineItems: [{ id: 'l1', name: 'Framing', description: '', quantity: 1, unit: 'ls', unitPrice: 77_484.88, total: 77_484.88 }],
    payLinkUrl: 'https://buy/x', payLinkAmount: 77_484.88, notes: '', payments: [],
    issueDate: '2026-09-10', dueDate: '2099-10-10',
  } as unknown as Invoice;
  const invSent = { ...inv, portalState: { status: 'sent' as const, sentAt: '2026-09-10T00:00:00Z', lastSentSnapshot: freezeForPortal('invoice', inv)! } };
  const pi = (buildPortalSnapshot({ project, portal, invoices: [invSent] }).sections.invoices ?? [])[0] as Record<string, unknown>;
  check('sent invoice: numeric total, balance and an effectiveStatus',
    typeof pi?.total === 'number' && pi.balance === 77_484.88 && typeof pi.effectiveStatus === 'string', JSON.stringify(pi));
  check('…and the gated Pay link (minted for exactly the balance)', pi?.payLinkUrl === 'https://buy/x');
  const paidLater = { ...invSent, amountPaid: 1_000 } as Invoice;
  const pl = (buildPortalSnapshot({ project, portal, invoices: [paidLater] }).sections.invoices ?? [])[0] as Record<string, unknown>;
  check('…a payment after send gates the stale link off', pl?.payLinkUrl === undefined && pl?.balance === 76_484.88);

  const co = {
    id: 'co1', projectId: 'p1', number: 3, description: 'Add outlet', reason: 'Owner request', changeAmount: 450,
    newContractTotal: 10_450, status: 'draft', date: '2026-09-10',
    lineItems: [{ id: 'x', name: 'Outlet', quantity: 1, unit: 'ea', unitCost: 120, unitPrice: 450, total: 450 }],
    approvers: [{ name: 'Jane', email: 'jane@example.com', role: 'Client', status: 'pending' }],
    auditTrail: [{ id: 'a1', action: 'created', actor: 'GC', timestamp: '2026-09-10T00:00:00Z' }],
    taxAmount: 36, totalWithTax: 486, taxRatePct: 8,
    createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z',
  } as unknown as ChangeOrder;
  const coState = { status: 'sent' as const, sentAt: '2026-09-10T00:00:00Z', lastSentSnapshot: freezeForPortal('change_order', co)! };
  const snapCO = buildPortalSnapshot({ project, portal, changeOrders: [{ ...co, status: 'submitted', portalState: coState } as ChangeOrder] });
  const pco = (snapCO.sections.changeOrders ?? [])[0] as Record<string, unknown>;
  const pcoJson = JSON.stringify(pco);
  check('sent CO: no unitCost reaches the client (#34)', !pcoJson.includes('unitCost') && !pcoJson.includes('120'), pcoJson);
  check('…no approver emails, no audit trail, no line items', !pcoJson.includes('jane@example.com') && !('auditTrail' in pco) && !('approvers' in pco) && !('lineItems' in pco));
  check('…status read LIVE: sent while draft, signable once submitted (#33)', pco?.status === 'submitted');

  // ── #131 ───────────────────────────────────────────────────────────────────
  console.log('\n#131 — the CO\'s frozen tax reaches the portal card and the signed record');
  check('the portal CO carries taxAmount and totalWithTax', pco?.taxAmount === 36 && pco?.totalWithTax === 486, pcoJson);
  check('no tax → neither field (never a figure worked out from a rate)', JSON.stringify(coTaxForPortal({ taxAmount: 0, totalWithTax: 450 })) === '{}' && JSON.stringify(coTaxForPortal({})) === '{}');
  const html = read('marketing/portal/index.html');
  const esignVars = html.slice(html.indexOf("var ESIGN_DISCLOSURE_VERSION"), html.indexOf('function sha256Hex('));
  const portalRecord = new Function(
    `${lift(html, 'esignTidy')}\n${esignVars}\n${lift(html, 'buildCOConsentRecord')}\nreturn buildCOConsentRecord;`,
  )() as (f: Record<string, unknown>) => string;
  const baseArgs = {
    decision: 'approved', portalId: 'portal-1', changeOrderId: 'co1', changeOrderNumber: 3, description: 'Add outlet',
    changeAmount: 450, newContractTotal: 10_450, signerName: 'Jane Doe', signedAt: '2026-09-18T12:00:00.000Z',
    timezoneOffsetMinutes: -300, signatureHash: 'abc', signatureStrokeCount: 4, userAgent: 'UA',
  };
  const withTax = portalRecord({ ...baseArgs, taxAmount: 36, totalWithTax: 486 });
  check('the signed record names the tax-inclusive change amount', /\nsales_tax_usd: 36\.00\nchange_amount_incl_tax_usd: 486\.00\n/.test(withTax), withTax.slice(0, 400));
  check('a no-tax record stays byte-identical to the app\'s (portalOwnerCore)',
    portalRecord(baseArgs) === buildCOConsentRecord(baseArgs as unknown as Parameters<typeof buildCOConsentRecord>[0]));
  check('the handler passes the CO\'s tax into the record',
    /taxAmount: coHasTax\(c\) \? c\.taxAmount : undefined,\s*totalWithTax: coHasTax\(c\) \? c\.totalWithTax : undefined,/.test(html));
  check('the CO card and the sign sheet show the tax', /' tax = '/.test(html) && /This change incl\. tax/.test(html));

  // ── #29 ────────────────────────────────────────────────────────────────────
  console.log('\n#29 — no signature is collected that nothing can record');
  const propProject = {
    ...project, status: 'estimated',
    linkedEstimate: {
      id: 'est-77', createdAt: '2026-05-02T00:00:00.000Z', globalMarkup: 25, baseTotal: 9120, markupTotal: 2280, grandTotal: 11400,
      items: [{ materialId: 'm1', name: 'Slab on grade', category: 'concrete', unit: 'sf', quantity: 1200, unitPrice: 9.5, bulkPrice: 9, markup: 25, usesBulk: false, lineTotal: 11400, supplier: 'Ferguson', csiDivision: '03' }],
    },
  } as unknown as Project;
  const stamped = { ...portal, proposalApprovalEnabled: true, proposalPaymentTerms: { depositPct: 25, progressPct: 65, finalPct: 10, confirmedAt: '2026-09-17T12:00:00.000Z' } } as unknown as ClientPortalSettings;
  const prop = buildPortalProposal({ project: propProject, portal: stamped, contractorName: 'Acme' });
  check('production has no acceptance RPC → the flag is off', PORTAL_PROPOSAL_ACCEPTANCE_LIVE === false);
  check('a published, otherwise-acceptable proposal carries acceptanceLive=false', !!prop && !prop.paymentTermsPending && prop.acceptanceLive === false, JSON.stringify(prop)?.slice(0, 120));
  check('the page draws Accept only on acceptanceLive === true',
    /var proposalCanDecide = !!data\.portalApi[\s\S]{0,200}&& data\.proposal\.acceptanceLive === true;/.test(html));
  check('…and says why a proposal is read-only', /data-proposal-read-only="1"/.test(html));
  const setup = read('app/client-portal-setup.tsx');
  check('the setup switch cannot be turned ON while acceptance is off, and says why',
    /disabled=\{!canProposeToClient \|\| \(!PORTAL_PROPOSAL_ACCEPTANCE_LIVE && !portal\.proposalApprovalEnabled\)( \|\| !!ownerOnlyReason)?\}/.test(setup)
    && /PROPOSAL_ACCEPTANCE_OFF_REASON/.test(setup)
    && /if \(!PORTAL_PROPOSAL_ACCEPTANCE_LIVE\) return;/.test(setup));

  // ── #133 / #135 ────────────────────────────────────────────────────────────
  console.log('\n#133 / #135 — payment days and pay amounts are what the bank sees');
  const dayInv = {
    payments: [
      { id: 'p1', date: '2026-09-15T01:00:00.000Z', amount: 1, method: 'check', receivedDate: '2026-09-11' },
      { id: 'p2', date: '2026-09-02T15:00:00.000Z', amount: 1, method: 'check' },
    ],
  } as unknown as Invoice;
  check('latestPaymentDate prints the RECEIVED day, not the tap instant', latestPaymentDate(dayInv) === '2026-09-11', String(latestPaymentDate(dayInv)));
  const fmtDate = new Function(`${lift(html, 'fmtDate')}\nreturn fmtDate;`)() as (s: string) => string;
  check('the portal reads a bare day as that LOCAL day (Chicago)', fmtDate('2026-09-11') === 'Sep 11, 2026', fmtDate('2026-09-11'));
  const payLines = html.split('\n').filter(l => /Pay '\s*\+\s*fmtMoney\(|'Pay '\+fmtMoney\(|amountDisplay = /.test(l));
  check('every Pay button / card amount passes dec:2', payLines.length >= 5 && payLines.every(l => /fmtMoney\([^)]*\{\s*dec:\s*2\s*\}\)/.test(l)), payLines.join('\n'));

  // ── #44 ────────────────────────────────────────────────────────────────────
  console.log('\n#44 — a missing section means gone');
  const prev = {
    v: 12, snapshotAt: 'a', company: { name: 'Acme Builders' },
    messages: [{ id: 'm1', authorType: 'client', body: 'hi', createdAt: 'x' }],
    sections: { changeOrders: [{ id: 'co1' }], aiaPayApps: [{ id: 'aia1' }], photos: [{ url: 'u' }] },
  } as unknown as PortalSnapshot;
  const fresh = { v: 12, snapshotAt: 'b', company: { name: 'MAGE ID' }, project: {}, sections: {} } as unknown as PortalSnapshot;
  const portalProject = { ...project, clientPortal: portal } as Project;
  const merged = mergeLiteSnapshot(fresh, prev, portalProject, { hasCompanyName: false, hasPassport: false });
  check('the recalled (last shared) CO is NOT carried forward', !('changeOrders' in merged.sections));
  check('…nor a section the fresh build no longer emits (photos)', !('photos' in merged.sections));
  check('the pay apps the lite writer never builds ARE carried', Array.isArray((merged.sections as Record<string, unknown>).aiaPayApps) && LITE_CARRIED_SECTIONS.length === 1);
  check('messages carried; a defaulted company name never overwrites a real one (#104)',
    merged.messages?.length === 1 && merged.company.name === 'Acme Builders');
  const realName = mergeLiteSnapshot({ ...fresh, company: { name: 'New Name' } } as PortalSnapshot, prev, portalProject, { hasCompanyName: true, hasPassport: false });
  check('…a real new name does publish', realName.company.name === 'New Name');
  const invoicesOff = { ...project, clientPortal: { ...portal, showInvoices: false } } as Project;
  const offMerged = mergeLiteSnapshot(fresh, prev, invoicesOff, { hasCompanyName: false, hasPassport: false });
  check('invoices switched off: the carried pay apps (and their Pay link) leave too', !('aiaPayApps' in offMerged.sections));
  // wave-4 #15: a caller that PASSES the AIA list builds the section fresh —
  // the published pay apps are no longer carried, so a recalled one leaves
  // and (below, end to end) a newly sent one appears.
  const freshAia = mergeLiteSnapshot(fresh, prev, portalProject, { hasCompanyName: false, hasPassport: false, aiaBuiltFresh: true });
  check('#15: AIA list passed → the published pay apps are NOT carried (fresh build is authoritative)', !('aiaPayApps' in freshAia.sections));

  // ── #122 / #23 ─────────────────────────────────────────────────────────────
  console.log('\n#122 / #23 — the shared lite sync');
  const upserts: Record<string, unknown>[] = [];
  let published: PortalSnapshot | null = null;
  let contractOk = true;
  let selectionsOk = true;
  let gate: Promise<void> | null = null;
  const io: PortalLiteSyncIO = {
    async loadContract() {
      if (gate) await gate;
      return contractOk ? { ok: true, value: null } : { ok: false, error: 'network' };
    },
    async loadSelections() { return selectionsOk ? { ok: true, value: [] } : { ok: false, error: 'network' }; },
    async loadCloseoutBinder() { return { ok: true, value: null }; },
    async loadPassport() { return null; },
    async readPublished() { return { ok: true, value: published }; },
    async upsert(row) { upserts.push(row); published = row.snapshot as unknown as PortalSnapshot; return { error: null }; },
    supabaseUrl: 'https://x', supabaseAnonKey: 'k',
  };
  const baseInput: PortalLiteSyncInput = {
    project: { ...project, clientPortal: portal } as Project, userId: 'gc-1',
    settings: { branding: { companyName: 'Acme Builders' } } as unknown as PortalLiteSyncInput['settings'],
    settingsLoaded: true, invoices: [invSent, { ...invSent, id: 'other-proj', projectId: 'p2' } as Invoice],
    changeOrders: [], dailyReports: [], punchItems: [], photos: [], rfis: [], warranties: [], permits: [],
  };
  contractOk = false;
  check('a FAILED contract read skips the push (#122)', await syncPortalSnapshotLite('p1', baseInput, io) === 'read_failed' && upserts.length === 0);
  contractOk = true; selectionsOk = false;
  check('a failed selections read skips it too', await syncPortalSnapshotLite('p1', baseInput, io) === 'read_failed' && upserts.length === 0);
  selectionsOk = true;
  check('a collaborator\'s device never publishes (owner-only RLS)', await syncPortalSnapshotLite('p1', { ...baseInput, userId: 'foreman' }, io) === 'not_owner');
  check('…and a pre-ownerUserId cache with a role is not the owner', !isPortalOwner({ myRole: 'field' } as Project, 'foreman') && isPortalOwner({} as Project, 'gc-1'));
  check('an unloaded profile never publishes (#104)', await syncPortalSnapshotLite('p1', { ...baseInput, settingsLoaded: false }, io) === 'settings_not_loaded');
  check('a good run publishes', await syncPortalSnapshotLite('p1', baseInput, io) === 'published' && upserts.length === 1);
  const upRow = upserts[0];
  check('…with no expires_at / link_duration_days (the link lifetime is not the lite writer\'s)', !('expires_at' in upRow) && !('link_duration_days' in upRow));
  const pubInv = ((upRow.snapshot as unknown as PortalSnapshot).sections.invoices ?? []);
  check('…only THIS project\'s records (tenant-wide inputs are filtered)', pubInv.length === 1 && pubInv[0].id === 'inv-1');
  check('the same state again is NOT re-upserted (no double publish)', await syncPortalSnapshotLite('p1', baseInput, io) === 'unchanged' && upserts.length === 1);
  check('sameSnapshot ignores the build timestamp and key order', sameSnapshot({ a: 1, b: { c: 2 }, snapshotAt: 'x' } as unknown as PortalSnapshot, { b: { c: 2 }, a: 1, snapshotAt: 'y' } as unknown as PortalSnapshot));
  // Coalescing: a call while one is in flight folds into ONE re-run with the newest input.
  let release!: () => void;
  gate = new Promise<void>(r => { release = r; });
  const changed = { ...baseInput, invoices: [{ ...invSent, amountPaid: 500 } as Invoice] };
  const first = syncPortalSnapshotLite('p1', baseInput, io);
  const second = await syncPortalSnapshotLite('p1', changed, io);
  const third = await syncPortalSnapshotLite('p1', changed, io);
  gate = null; release();
  const firstOutcome = await first;
  check('calls during a run are coalesced, not run concurrently', second === 'coalesced' && third === 'coalesced');
  check('…and the newest input is published once after the run', firstOutcome === 'published' && upserts.length === 2
    && ((upserts[1].snapshot as unknown as PortalSnapshot).sections.invoices ?? [])[0]?.amountPaid === 500);

  // Review round 1: the lite writer must BUILD the permit rows of Documents.
  // Documents is not carried (a recalled warranty would stay), so a lite push
  // that doesn't pass permits wiped the permits the rich writer published.
  const permit = { id: 'pm1', projectId: 'p1', projectName: 'Maple', type: 'building', permitNumber: '123', jurisdiction: 'Travis County', status: 'approved', appliedDate: '2026-08-01', approvedDate: '2026-08-20' } as unknown as Permit;
  const otherPermit = { ...permit, id: 'pm2', projectId: 'p2', permitNumber: '999' } as Permit;
  published = {
    ...(published as unknown as PortalSnapshot),
    sections: { ...(published as unknown as PortalSnapshot).sections, documents: [{ name: 'Building permit #123' }] },
  } as unknown as PortalSnapshot;
  const docsInput: PortalLiteSyncInput = {
    ...baseInput, invoices: [{ ...invSent, amountPaid: 500 } as Invoice], permits: [permit, otherPermit],
    project: { ...project, clientPortal: { ...portal, showDocuments: true } } as Project,
  };
  const docsOutcome = await syncPortalSnapshotLite('p1', docsInput, io);
  const docs = ((published as unknown as PortalSnapshot).sections.documents ?? []) as { name: string }[];
  check('a lite push keeps the permit row in Documents (built fresh from the project\'s permits)',
    (docsOutcome === 'published' || docsOutcome === 'unchanged') && docs.length === 1 && /#123/.test(docs[0]?.name ?? ''), JSON.stringify(docs));

  // wave-4 #15, end to end: a pay app SENT to the client (portalState shared)
  // is published by a lite push that carries the device's AIA list; recalled,
  // it leaves on the next push; a caller without the list carries the row.
  const aiaApp = {
    id: 'aia-3', projectId: 'p1', applicationNumber: 3, periodTo: '2026-09-15', portalState: { status: 'sent', sentAt: '2026-09-15T12:00:00Z' },
    applicationDate: '2026-09-15', ownerName: 'Pat', contractorName: 'Acme', projectName: 'Maple',
    originalContractSum: 100000, netChangeByCO: 0, contractSumToDate: 100000, retainagePercent: 10, lessPreviousCertificates: 0,
    lines: [], totals: { totalScheduledValue: 100000, totalCompletedAndStored: 20000, totalRetainage: 2000, totalEarnedLessRetainage: 18000, currentPaymentDue: 18000, balanceToFinish: 82000, percentComplete: 20 },
    createdAt: '2026-09-15T12:00:00.000Z',
  } as unknown as SavedAIAPayApp;
  const otherAia = { ...aiaApp, id: 'aia-x', projectId: 'p2' } as SavedAIAPayApp;
  const aiaProject = { ...project, clientPortal: { ...portal, showInvoices: true } } as Project;
  const aiaInput: PortalLiteSyncInput = { ...docsInput, project: aiaProject, aiaPayApps: [aiaApp, otherAia] };
  const aiaOutcome = await syncPortalSnapshotLite('p1', aiaInput, io);
  const pubAia = (((published as unknown as PortalSnapshot).sections as Record<string, unknown>).aiaPayApps ?? []) as { id: string }[];
  check('#15: a pay app sent to the client reaches the portal on a lite push (only THIS project\'s)',
    aiaOutcome === 'published' && pubAia.length === 1 && pubAia[0].id === 'aia-3', `${aiaOutcome} ${JSON.stringify(pubAia.map(a => a.id))}`);
  await syncPortalSnapshotLite('p1', { ...aiaInput, aiaPayApps: [{ ...aiaApp, portalState: { status: 'recalled' } } as unknown as SavedAIAPayApp] }, io);
  check('#15: recalled, it leaves on the next push (not carried)', !((published as unknown as PortalSnapshot).sections as Record<string, unknown>).aiaPayApps);
  await syncPortalSnapshotLite('p1', aiaInput, io);
  const beforeCarry = JSON.stringify(((published as unknown as PortalSnapshot).sections as Record<string, unknown>).aiaPayApps);
  await syncPortalSnapshotLite('p1', { ...aiaInput, aiaPayApps: undefined }, io);
  check('#15: a caller WITHOUT the list carries the published pay apps unchanged',
    JSON.stringify(((published as unknown as PortalSnapshot).sections as Record<string, unknown>).aiaPayApps) === beforeCarry && beforeCarry !== undefined);

  // Review round 1: a selections read that lost its OPTIONS is a failed read.
  const cat = (id: string, n: number) => ({ id, options: Array.from({ length: n }, (_, i) => ({ id: `${id}-o${i}` })) }) as unknown as SelectionCategory;
  const sel = (cats: number, rows: SelectionCategory[] | null, opts: number | null) => readSelectionsChecked({
    countCategories: async () => cats,
    fetchSelections: async () => { if (!rows) throw new Error('x'); return rows; },
    countOptions: async () => opts,
  });
  check('selections: categories in the table but none came back = FAILED', !(await sel(2, [], 0)).ok);
  check('selections: categories back but their options swallowed = FAILED', !(await sel(2, [cat('c1', 0), cat('c2', 0)], 5)).ok);
  check('selections: a partial options read = FAILED', !(await sel(2, [cat('c1', 2), cat('c2', 0)], 5)).ok);
  check('selections: an options count that failed = FAILED', !(await sel(1, [cat('c1', 2)], null)).ok);
  check('selections: every option back = ok', (await sel(2, [cat('c1', 2), cat('c2', 3)], 5)).ok);
  check('selections: categories with no options at all = ok', (await sel(1, [cat('c1', 0)], 0)).ok);
  check('selections: none on the project = ok, empty', (await sel(0, null, null)).ok);

  const setupSrc = read('app/client-portal-setup.tsx');
  check('setup: the rich publish waits for all three reads to SUCCEED (#122)',
    /if \(!richReadsReady\) return;/.test(setupSrc) && /const richReadsReady = contractQ\.isSuccess && selectionsQ\.isSuccess && closeoutQ\.isSuccess;/.test(setupSrc));
  check('setup: the contract read reports failure (loadActiveContract, throws on !ok)',
    /const r = await loadActiveContract\(id\);\s*if \(!r\.ok\) throw new Error\(r\.error\);/.test(setupSrc) && !/fetchActiveContract\(/.test(setupSrc));
  const view = read('app/client-view.tsx');
  check('client-view: a failed contract read is not "checked, none"',
    /contractWasChecked = !isSnapshotMode && !!localProject\?\.id && contractQ\.isSuccess;/.test(view) && !/fetchActiveContract\(/.test(view));

  // ── #40 / #125 / #37 ───────────────────────────────────────────────────────
  console.log('\n#40 / #125 / #37 — the reconciler');
  const hook = read('hooks/usePortalApprovalReconciler.ts');
  const merge = runTs<(s: COAuditEntry[], l: COAuditEntry[]) => COAuditEntry[]>(lift(hook, 'mergeAuditTrails'), 'mergeAuditTrails');
  const plan = runTs<(row: Record<string, unknown>, status: string | undefined, trail: COAuditEntry[]) => { entry: COAuditEntry | null; status: string | null }>(
    `type COAuditEntry = { id: string; action: string; actor: string; timestamp: string; detail?: string };\n${lift(hook, 'planPortalApproval')}`, 'planPortalApproval');
  const approvalId = '58f6f0d3-127c-4f04-8b61-293b6d94acca';
  const seal: COAuditEntry = { id: approvalId, action: 'client_signed_via_portal', actor: 'Jane', timestamp: 't' };
  const local: COAuditEntry[] = [{ id: 'a1', action: 'created', actor: 'GC', timestamp: 't0' }];
  const m = merge([local[0], seal], local);
  check('the merged trail keeps the server\'s sealed signature entry', m.some(e => e.id === approvalId) && m.length === 2);
  const row = { id: approvalId, decision: 'approved', signer_name: 'Jane', signer_email: null, note: null, created_at: 't' };
  const p1 = plan(row, 'submitted', m);
  check('with a seal: status flips, and our entry is NOT a second copy of the decision',
    p1.status === 'approved' && p1.entry?.action === 'portal_decision_applied' && p1.entry?.id === 'audit-portal-58f6f0d3');
  check('a second pass for the same row is a no-op (a GC revert is not re-flipped)',
    plan(row, 'submitted', [...m, p1.entry!]).entry === null);
  const decline = { ...row, id: 'deadbeef-0000-0000-0000-000000000000', decision: 'declined', note: 'Too pricey' };
  const p2 = plan(decline, 'rejected', local);
  check('a decline on an ALREADY-rejected CO still records the reason (#125)',
    p2.status === null && p2.entry?.action === 'declined_via_portal' && p2.entry?.detail === 'Note: Too pricey');
  check('the reconciler reads the CO\'s trail from the SERVER before writing',
    /\.from\('change_orders'\)\s*\.select\('audit_trail'\)/.test(hook) && /mergeAuditTrails\(serverTrail, co\.auditTrail \?\? \[\]\)/.test(hook));
  check('…a failed read skips the row WITHOUT stamping it', /if \(freshErr \|\| !fresh\) \{[\s\S]{0,200}continue;/.test(hook));
  check('…and pulls the server copy into the app after a pass', /invalidateQueries\(\{ queryKey: \['changeOrders'\] \}\)/.test(hook));
  check('portal approvals defer the schedule reflow (#37)', /\{ deferReflow: true \}/.test(hook));

  // ── Integration critic money-portal (round 1): a recall is live on read ──
  // Executed end to end in PGlite (scratchpad pgtest/overlay_recall_live.mjs —
  // the repo has no Postgres harness); these pins hold the SQL to that run.
  console.log('\nmoney-portal critic — recall from any device is live; a refund reopens the pill');
  const ov = read('supabase/migrations/20260919030000_client_portal_live_overlay.sql');
  const ovFn = ov.slice(ov.indexOf('create or replace function public.portal_overlay_live'), ov.indexOf('revoke all on function public.portal_overlay_live'));
  check('one isShared rule on the server (portal_state_is_shared), not callable by clients',
    /create or replace function public\.portal_state_is_shared\(p_ps jsonb\)[\s\S]{0,300}p_ps is null or jsonb_typeof\(p_ps\) = 'null' or coalesce\(p_ps->>'status', ''\) = 'sent'/.test(ov)
    && /revoke all on function public\.portal_state_is_shared\(jsonb\) from public, anon, authenticated;/.test(ov));
  const sectionGate = (section: string, table: string) => {
    const at = ovFn.indexOf(`jsonb_array_elements(v_secs->'${section}')`);
    const block = at < 0 ? '' : ovFn.slice(at, at + 1400);
    return new RegExp(`from public\\.${table} \\w+`).test(block) && /not public\.portal_state_is_shared\(v_ps\)/.test(block);
  };
  check('a recalled daily report leaves on read (by id)', sectionGate('dailyReports', 'daily_reports'));
  check('a recalled RFI leaves on read', sectionGate('rfis', 'rfis'));
  check('a recalled AIA pay app leaves on read', sectionGate('aiaPayApps', 'aia_pay_apps'));
  check('a recalled change order leaves on read', sectionGate('changeOrders', 'change_orders'));
  check('a recalled invoice card leaves on read, with its share of the budget',
    /if not public\.portal_state_is_shared\(v_ps\) then\s*v_dropped := v_dropped \|\| \(v_el->>'id'\);[\s\S]{0,500}v_dbal := v_dbal - v_snap_bal;[\s\S]{0,120}v_dinv := v_dinv - v_total;/.test(ovFn));
  check('a recalled selection leaves on read',
    /jsonb_array_elements\(v_snap->'selections'\)[\s\S]{0,500}from public\.selection_categories s[\s\S]{0,200}not public\.portal_state_is_shared\(v_ps\)/.test(ovFn));
  check('photos: by id, else by url; dropped only when a row exists and none is shared',
    /where ph\.id::text = v_el->>'id' and ph\.project_id = p_pid;/.test(ovFn)
    && /where ph\.uri = v_el->>'url' and ph\.project_id = p_pid;/.test(ovFn)
    && /if v_any and not v_shared then continue; end if;/.test(ovFn));
  check('the hero photo is never one recalled since', /v_hero := v_snap->'project'->>'heroPhotoUrl';[\s\S]{0,400}if v_any and not v_shared then/.test(ovFn));
  check('punch: a closed / crew item leaves; status read live',
    /coalesce\(v_status, ''\) not in \('open', 'in_progress', 'ready_for_review'\)\s*or coalesce\(v_ltype, 'punch'\) <> 'punch'/.test(ovFn));
  check('ownerDecisions drop a withdrawn item and a settled invoice',
    /not \(coalesce\(e\.value->>'id', ''\) = any\(v_dropped\)\)/.test(ovFn) && /'invoice' and coalesce\(e\.value->>'id', ''\) = any\(v_settled\)/.test(ovFn));
  // Integration critic server (round 1): the headline card is corrected by
  // the same live rows as the sections (PGlite: pgtest/client_portal_overlay.mjs).
  {
    const core = read('utils/portalOwnerCore.ts');
    const tsSet = (core.match(/PENDING_CO_STATUSES = new Set\(\[([^\]]*)\]\)/)?.[1] ?? '')
      .split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean).sort().join(',');
    const sqlSet = (ovFn.match(/lower\(v_status\) not in \(([^)]*)\) then\s*v_co_closed := v_co_closed \|\| \(v_el->>'id'\);/)?.[1] ?? '')
      .split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean).sort().join(',');
    check('a CO signed / declined / voided live stops being an owner decision (same set as PENDING_CO_STATUSES)',
      tsSet.length > 0 && tsSet === sqlSet
      && /'change_order' and coalesce\(e\.value->>'id', ''\) = any\(v_co_closed\)/.test(ovFn), `${tsSet} vs ${sqlSet}`);
    check('an invoice decision carries the LIVE balance, and leaves at <= 0.01',
      /v_inv_bal := v_inv_bal \|\| jsonb_build_object\(v_el->>'id', v_bal\);/.test(ovFn)
      && /then e\.value \|\| jsonb_build_object\('amount', v_inv_bal->\(e\.value->>'id'\)\)/.test(ovFn)
      && /\(v_inv_bal->>\(e\.value->>'id'\)\)::numeric <= 0\.01\)/.test(ovFn));
  }
  check('a refund reopens the pill: snapshot paid / partially_paid with nothing paid live loses effectiveStatus',
    /elsif coalesce\(v_el->>'effectiveStatus', ''\) in \('paid', 'partially_paid'\) then[\s\S]{0,400}v_el := v_el - 'effectiveStatus';/.test(ovFn)
    && /v_bal > 0\.01 and v_paid <= 0\s*and v_status in \('paid', 'partially_paid'\) then\s*v_status := 'sent';/.test(ovFn));
  const snapSrc = read('utils/portalSnapshot.ts');
  check('the snapshot carries each photo\'s live row id (the overlay finds its row)',
    /sections\.photos = \(sorted\.slice\(0, maxPhotos\)\.map\(p => renderSerialized\('photo', p, \(photo\) => \(\{\s*id: p\.id,/.test(snapSrc));
  const btn = read('components/SendToClientButton.tsx');
  check('an editor\'s send says it waits for the GC\'s app; a recall says it is immediate',
    /if \(!isOwner\) showAlert\('Sent to the client portal', EDITOR_SEND_NOTE\);/.test(btn) && /A recall takes effect right away/.test(btn)
    && /comes off the client\\u2019s portal right away/.test(btn));
  const ctx = read('contexts/ProjectContext.tsx');
  check('no comment claims the owner\'s republish carries an editor\'s send', !/the owner's\s*(?:\/\/\s*)?republish carries it/.test(ctx));

  console.log(`\n${passes} passed, ${failures} failed`);
  finished = true;
  if (failures) process.exit(1);
}

// A run that never settles (a coalescing regression deadlocks the gated
// fake IO) would otherwise let bun exit 0 with the checks unreported.
let finished = false;
process.on('exit', () => {
  if (!finished) { console.error('  ✗ the validator did not finish — a sync call never settled'); process.exitCode = 1; }
});
void main().then(() => { finished = true; });
