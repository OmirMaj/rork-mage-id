// validate-portal-owner-optins.ts — supplier names and a sub's direct contact
// reach the owner ONLY when the GC switched them on for that job.
//
// WHY THIS EXISTS (Phase 0, founder decision 5, 2026-09-23). The portal's
// closeout block printed every finish's supplier and listed every purchase-
// order vendor as a "trade contact"; the Home Passport docs (which the owner's
// Ask Your Home box retrieves, and which the pre-answered FAQ is written from)
// carried "Supplier: …" and each sub's "Phone: … Email: …"; and the Home
// Passport the GC shares listed suppliers and trade phones. A supplier is the
// GC's pricing relationship; a sub's direct line is a sub he may not want
// poached. Brand, model and serial are the owner's and always show.
//
// The rule, pinned here by EXECUTING the real builders:
//   • two per-job switches on ClientPortalSettings — shareSupplierNames,
//     shareTradeContacts — read only through ownerSharingFor, strict === true;
//   • absent (every portal saved before this) = off;
//   • the portal snapshot, buildHomePassport and buildConsumerPassport all
//     honour them; baked FAQ prose ships only under settings at least as open
//     as the ones it was baked under;
//   • the closeout binder screen is where the switches live, feeds them to the
//     passport build and the binder PDF, and records them on the bake; the
//     passport puts supplier and sub-contact facts only in docs of their own
//     (passport:supplier:* / passport:contact:*), which portal-ask-home drops
//     at answer time unless the live switch is on (pinned, executed, in
//     validate-portal-ask-home-sources); a failed index keeps the old bake;
//   • the closeout binder PDF drops the Supplier column and the sub
//     Phone/Email cells unless the switch is on;
//   • the passcode copy in client-portal-setup does not call the passcode a
//     lock (the page loads the snapshot before it asks; the token is the key).
//
// Run: bun run scripts/validate-portal-owner-optins.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ownerSharingFor, bakedSharingAllowed, OWNER_SHARING_OFF } from '../utils/passport/ownerSharing';
import { buildPortalSnapshot, ownerSafeCloseoutCarry } from '../utils/portalSnapshot';
import { buildHomePassport } from '../utils/passport/buildHomePassport';
import { buildConsumerPassport, buildPassportHandoff } from '../utils/passport/consumerPassport';
import { passportJobsFromProjects, passportContractorFromBranding } from '../utils/passport/passportInputs';
import { mergeLiteSnapshot } from '../utils/portalLiteSync';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
/** Source with comments removed, so a comment quoting old copy never counts. */
const code = (src: string) => src
  .replace(/(^|[\s{(])\/\*[\s\S]*?\*\//g, '$1')
  .split('\n').map(l => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

type SnapOpts = Parameters<typeof buildPortalSnapshot>[0];

// ── the reader ──────────────────────────────────────────────────────────────
console.log('\nthe one reader — strict, off by default');
ok('no portal → nothing shared', JSON.stringify(ownerSharingFor(undefined)) === JSON.stringify(OWNER_SHARING_OFF));
ok('a portal saved before the switches (no keys) → nothing shared',
  JSON.stringify(ownerSharingFor({} as never)) === JSON.stringify({ supplierNames: false, tradeContacts: false }));
ok('a string "true" from a hand-edited row is NOT on',
  ownerSharingFor({ shareSupplierNames: 'true', shareTradeContacts: 1 } as never).supplierNames === false
  && ownerSharingFor({ shareSupplierNames: 'true', shareTradeContacts: 1 } as never).tradeContacts === false);
ok('each switch is read on its own',
  JSON.stringify(ownerSharingFor({ shareSupplierNames: true })) === JSON.stringify({ supplierNames: true, tradeContacts: false })
  && JSON.stringify(ownerSharingFor({ shareTradeContacts: true })) === JSON.stringify({ supplierNames: false, tradeContacts: true }));

const ON = { supplierNames: true, tradeContacts: true };
const OFF = { supplierNames: false, tradeContacts: false };
ok('a bake with no record (pre-switches) is held back while anything is off',
  !bakedSharingAllowed(undefined, OFF) && !bakedSharingAllowed(undefined, { supplierNames: true, tradeContacts: false }));
ok('a bake with no record ships once both are on', bakedSharingAllowed(undefined, ON));
ok('a bake made with suppliers on is held back once suppliers go off',
  !bakedSharingAllowed({ supplierNames: true, tradeContacts: false }, OFF));
ok('a bake made with everything off ships under any setting',
  bakedSharingAllowed(OFF, OFF) && bakedSharingAllowed(OFF, ON));

// ── fixtures ────────────────────────────────────────────────────────────────
const stamp = { createdAt: '2026-03-01T12:00:00Z', updatedAt: '2026-03-01T12:00:00Z' };
const SUPPLIER = 'Ferguson Bath Kitchen';
const PO_VENDOR = 'ABC Lumber Supply';
const SUB_PHONE = '555-0177';
const SUB_EMAIL = 'dan@sparkyelectric.test';
const SUB_CONTACT = 'Dan Sparks';
const PRODUCT_URL = 'https://www.fergusonbath.test/moen-7594srs';
const project = {
  id: 'p1', name: 'Kitchen remodel', location: '12 Oak Ln', type: 'renovation', status: 'closed',
  squareFootage: 0, closedAt: '2026-05-01', ...stamp,
};
const selections = [{
  id: 'cat1', projectId: 'p1', userId: 'u', category: 'Faucet', ...stamp,
  options: [{ id: 'o1', categoryId: 'cat1', productName: 'Kitchen faucet', brand: 'Moen', sku: '7594SRS', supplier: SUPPLIER, productUrl: PRODUCT_URL, unitPrice: 0, isChosen: true, ...stamp }],
}];
const commitments = [
  { id: 'c-sub', projectId: 'p1', type: 'subcontract', status: 'signed', vendorName: 'Sparky Electric', subcontractorId: 's1', description: 'Rough and finish electrical $12,400', phase: 'Rough-in', amount: 12400, ...stamp },
  { id: 'c-po', projectId: 'p1', type: 'purchase_order', status: 'signed', vendorName: PO_VENDOR, description: 'Framing lumber', amount: 3000, ...stamp },
];
const subcontractors = [{ id: 's1', companyName: 'Sparky Electric', contactName: SUB_CONTACT, phone: SUB_PHONE, email: SUB_EMAIL, trade: 'Electrical', licenseNumber: 'EL-42' }];
const binder = { id: 'b1', projectId: 'p1', userId: 'u', status: 'finalized', maintenanceSchedule: [], notes: '', ...stamp };
const basePortal = {
  portalId: 'portal-p1', enabled: true,
  showSchedule: false, showBudgetSummary: false, showInvoices: false, showChangeOrders: false,
  showPhotos: false, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false,
};
const bake = (sharing?: { supplierNames: boolean; tradeContacts: boolean }) => ({
  faq: [{ q: 'Who did the electrical work and how do I reach them?', a: `Sparky Electric — call ${SUB_PHONE}.`, refs: ['Trade — Sparky Electric'] }],
  summary: { finishes: 1, warranties: 0, trades: 2, maintenanceItems: 0, photos: 0, docCount: 3, generatedAt: '2026-05-01T00:00:00Z' },
  generatedAt: '2026-05-01T00:00:00Z',
  ...(sharing ? { sharing } : {}),
});
const snapWith = (portalExtra: Record<string, unknown>, homePassport: ReturnType<typeof bake> | null = bake()) => buildPortalSnapshot({
  project: project as unknown as SnapOpts['project'],
  portal: { ...basePortal, ...portalExtra } as unknown as SnapOpts['portal'],
  selections: selections as unknown as SnapOpts['selections'],
  commitments: commitments as unknown as SnapOpts['commitments'],
  subcontractors: subcontractors as unknown as SnapOpts['subcontractors'],
  closeoutBinder: binder as unknown as SnapOpts['closeoutBinder'],
  homePassport: homePassport as unknown as SnapOpts['homePassport'],
});

// ── the portal's closeout block ─────────────────────────────────────────────
console.log('\nportal closeout — default (a portal saved before the switches)');
{
  const snap = snapWith({});
  const c = snap.closeout;
  const json = JSON.stringify(c ?? null);
  ok('the closeout block is published (so the checks below can see a leak)', !!c && c.finishes.length === 1);
  ok('brand and model always ship', c?.finishes[0]?.brand === 'Moen' && c?.finishes[0]?.sku === '7594SRS', json);
  ok('no supplier on the finish', !json.includes(SUPPLIER), json);
  ok('no purchase-order vendor in trade contacts', !json.includes(PO_VENDOR), json);
  ok('the sub is still listed by company and what they did',
    !!c?.tradeContacts.some(t => t.company === 'Sparky Electric' && t.phase === 'Rough-in'), json);
  ok('no sub phone, email', !json.includes(SUB_PHONE) && !json.includes(SUB_EMAIL), json);
  ok('a dollar figure in the scope never ships', !json.includes('12,400'), json);
  ok('a pre-switch baked FAQ (which quotes a phone) is held back', c?.faq === undefined, JSON.stringify(c?.faq));
  ok('the passport summary counts still ship', c?.passport?.trades === 2);
  ok('the selections section is published too (the same finish, mid-job)',
    (snap.selections?.[0]?.options?.[0]?.brand) === 'Moen', JSON.stringify(snap.selections ?? null));
  ok('…and its option carries no supplier', snap.selections?.[0]?.options?.[0]?.supplier === undefined);
  ok('…and no product link (it points at the supplier\'s store)', snap.selections?.[0]?.options?.[0]?.productUrl === undefined
    && !JSON.stringify(snap).includes(PRODUCT_URL));
  ok('nothing anywhere in the snapshot carries the supplier or the phone',
    !JSON.stringify(snap).includes(SUPPLIER) && !JSON.stringify(snap).includes(SUB_PHONE));
}
console.log('\nportal closeout — both switched on');
{
  const c = snapWith({ shareSupplierNames: true, shareTradeContacts: true }).closeout;
  const json = JSON.stringify(c ?? null);
  ok('the finish carries its supplier', c?.finishes[0]?.supplier === SUPPLIER, json);
  ok('the purchase-order vendor is listed', !!c?.tradeContacts.some(t => t.company === PO_VENDOR), json);
  ok('the sub carries phone and email from the roster',
    !!c?.tradeContacts.some(t => t.company === 'Sparky Electric' && t.phone === SUB_PHONE && t.email === SUB_EMAIL), json);
  ok('the scope is still money-free when shared', !json.includes('12,400'), json);
  ok('the selection option carries its supplier when shared',
    snapWith({ shareSupplierNames: true }).selections?.[0]?.options?.[0]?.supplier === SUPPLIER);
  ok('the selection option carries its product link when shared',
    snapWith({ shareSupplierNames: true }).selections?.[0]?.options?.[0]?.productUrl === PRODUCT_URL);
  ok('the pre-switch FAQ ships once both are on', (c?.faq?.length ?? 0) === 1);
}
console.log('\nportal closeout — one switch at a time');
{
  const sup = JSON.stringify(snapWith({ shareSupplierNames: true }).closeout ?? null);
  ok('suppliers on, contacts off → supplier and PO vendor, no phone',
    sup.includes(SUPPLIER) && sup.includes(PO_VENDOR) && !sup.includes(SUB_PHONE), sup);
  const tr = JSON.stringify(snapWith({ shareTradeContacts: true }).closeout ?? null);
  ok('contacts on, suppliers off → phone, no supplier and no PO vendor',
    tr.includes(SUB_PHONE) && !tr.includes(SUPPLIER) && !tr.includes(PO_VENDOR), tr);
  const faqOff = snapWith({}, bake(OFF)).closeout?.faq;
  ok('a FAQ baked with everything off ships with everything off', (faqOff?.length ?? 0) === 1);
  const faqStale = snapWith({}, bake(ON)).closeout?.faq;
  ok('a FAQ baked with both on is held back once they go off', faqStale === undefined);
}

// ── what a CARRYING writer may keep (portalLiteSync's merge) ────────────────
// The lite writer passes no commitments and may lack the bake, so it carries
// the published trade contacts and FAQ. ownerSafeCloseoutCarry re-applies the
// switches to what it carries, and portalLiteSync's mergeLiteSnapshot calls it
// (run end to end below).
console.log('\ncarried closeout pieces follow the switches as they stand now');
{
  const published = snapWith({ shareSupplierNames: true, shareTradeContacts: true }, bake(ON)).closeout!;
  ok('the published rows carry a kind (so a carry can filter them)',
    published.tradeContacts.some(t => t.kind === 'supplier') && published.tradeContacts.some(t => t.kind === 'trade'));
  ok('the published FAQ records what it was baked under', JSON.stringify(published.faqSharing) === JSON.stringify(ON));
  const offCarry = ownerSafeCloseoutCarry(published, {});
  const offJson = JSON.stringify(offCarry);
  ok('switched off since: the carried list drops the supplier row and every phone/email',
    !offJson.includes(PO_VENDOR) && !offJson.includes(SUB_PHONE) && !offJson.includes(SUB_EMAIL)
    && offCarry.tradeContacts.some(t => t.company === 'Sparky Electric'), offJson);
  ok('switched off since: the FAQ baked with contacts on is not carried', offCarry.faq === undefined);
  const onCarry = ownerSafeCloseoutCarry(published, { shareSupplierNames: true, shareTradeContacts: true });
  ok('still on: the carry keeps everything', JSON.stringify(onCarry.tradeContacts) === JSON.stringify(published.tradeContacts) && (onCarry.faq?.length ?? 0) === 1);
  const legacy = { tradeContacts: [{ company: PO_VENDOR, scope: 'purchase_order' }, { company: 'Sparky Electric', scope: 'Electrical' }], faq: [{ q: 'q', a: `call ${SUB_PHONE}`, refs: [] }] };
  const legacyOff = ownerSafeCloseoutCarry(legacy, {});
  ok('a row published before kinds existed is not carried while suppliers are off (it might be one)',
    legacyOff.tradeContacts.length === 0, JSON.stringify(legacyOff));
  ok('an FAQ published before the switches is not carried while anything is off', legacyOff.faq === undefined);

  // The real carrying writer. The closeout binder's switch calls
  // requestPortalPublish, which runs this merge: a fresh LITE build (no
  // commitments, and a device that may not hold the bake) laid over the row
  // published while both switches were on.
  const liteFresh = (portalExtra: Record<string, unknown>) => buildPortalSnapshot({
    project: project as unknown as SnapOpts['project'],
    portal: { ...basePortal, ...portalExtra } as unknown as SnapOpts['portal'],
    selections: selections as unknown as SnapOpts['selections'],
    commitments: [] as unknown as SnapOpts['commitments'],
    subcontractors: subcontractors as unknown as SnapOpts['subcontractors'],
    closeoutBinder: binder as unknown as SnapOpts['closeoutBinder'],
    homePassport: null as unknown as SnapOpts['homePassport'],
  });
  const publishedRow = snapWith({ shareSupplierNames: true, shareTradeContacts: true }, bake(ON));
  const merge = (portalExtra: Record<string, unknown>) => mergeLiteSnapshot(
    liteFresh(portalExtra), publishedRow,
    { clientPortal: { ...basePortal, ...portalExtra } } as unknown as Parameters<typeof mergeLiteSnapshot>[2],
    { hasCompanyName: true, hasPassport: false },
  ).closeout;
  const offMerged = merge({});
  const offMergedJson = JSON.stringify(offMerged ?? null);
  ok('lite writer, both switched off since the publish: the fresh build still has a closeout to merge into', !!offMerged, offMergedJson);
  ok('lite writer, both switched off: the carried closeout holds no supplier, no phone, no email',
    !offMergedJson.includes(PO_VENDOR) && !offMergedJson.includes(SUB_PHONE) && !offMergedJson.includes(SUB_EMAIL)
    && !offMergedJson.includes(SUPPLIER), offMergedJson);
  ok('lite writer, both switched off: the FAQ baked with contacts on is not carried', !offMerged?.faq?.length && offMerged?.faqSharing === undefined, offMergedJson);
  ok('lite writer, both switched off: the trade itself (company + scope) is still carried',
    !!offMerged?.tradeContacts?.some(t => t.company === 'Sparky Electric'), offMergedJson);
  const onMerged = merge({ shareSupplierNames: true, shareTradeContacts: true });
  const onMergedJson = JSON.stringify(onMerged ?? null);
  ok('lite writer, still on: the carry keeps the supplier, the contacts and the FAQ',
    onMergedJson.includes(PO_VENDOR) && onMergedJson.includes(SUB_PHONE) && (onMerged?.faq?.length ?? 0) === 1, onMergedJson);
}

// ── the Home Passport docs (what Ask Your Home retrieves) ───────────────────
console.log('\nHome Passport docs — buildHomePassport');
const hpInput = {
  project: { id: 'p1', name: 'Kitchen remodel', location: '12 Oak Ln' },
  selections: selections as never, warranties: [], commitments: commitments as never,
  subcontractors: subcontractors as never, photos: [], maintenance: [], generatedAt: '2026-05-01T00:00:00Z',
};
{
  const off = buildHomePassport(hpInput);
  const text = off.docs.map(d => d.text + ' ' + d.ref).join('\n');
  ok('default: the finish doc keeps brand and model', /Brand: Moen/.test(text) && /SKU \/ model: 7594SRS/.test(text), text);
  ok('default: no "Supplier:" line', !text.includes(SUPPLIER), text);
  const poDoc = off.docs.find(d => d.docId === 'passport:trade:c-po');
  ok('default: the purchase-order doc keeps its id (a re-index overwrites the named copy) and names no supplier',
    !!poDoc && !text.includes(PO_VENDOR) && !/Framing lumber/.test(poDoc.text) && /from a supplier/.test(poDoc.text), JSON.stringify(poDoc));
  ok('the trade scope reaching Ask Your Home is money-free', !text.includes('12,400') && /Scope: Rough and finish electrical/.test(text), text);
  // The GC's relationships live only in docs of their own, which
  // portal-ask-home drops by prefix unless the live switch is on
  // (validate-portal-ask-home-sources runs that filter).
  ok('default: no supplier or contact doc is emitted at all',
    !off.docs.some(d => /^passport:(supplier|contact):/.test(d.docId)), off.docs.map(d => d.docId).join(', '));
  const onIds = buildHomePassport({ ...hpInput, sharing: ON }).docs.map(d => d.docId);
  ok('switched on: the supplier and contact facts come as their own docs',
    ['passport:supplier:cat1', 'passport:supplier:c-po', 'passport:contact:c-sub'].every(id => onIds.includes(id)), onIds.join(', '));
  ok('switched on or off, the finish and trade docs read the same (nothing of the GC\'s rides inside them)',
    ['passport:finish:cat1', 'passport:trade:c-sub', 'passport:trade:c-po'].every(id =>
      off.docs.find(d => d.docId === id)?.text === buildHomePassport({ ...hpInput, sharing: ON }).docs.find(d => d.docId === id)?.text));
  ok('default: the sub doc names the company, not the contact', /Sparky Electric worked on/.test(text)
    && !text.includes(SUB_PHONE) && !text.includes(SUB_EMAIL) && !text.includes(SUB_CONTACT), text);
  const on = buildHomePassport({ ...hpInput, sharing: ON });
  const t2 = on.docs.map(d => d.text).join('\n');
  ok('switched on: supplier, PO vendor, contact, phone and email are all there',
    t2.includes(SUPPLIER) && t2.includes(PO_VENDOR) && t2.includes(`Phone: ${SUB_PHONE}`)
    && t2.includes(`Email: ${SUB_EMAIL}`) && t2.includes(`Contact: ${SUB_CONTACT}`), t2);
}

// ── the consumer passport (the Home Passport screen + its shared copy) ──────
console.log('\nconsumer passport — per job, through passportJobsFromProjects');
{
  const gc = passportContractorFromBranding({ companyName: 'Oak Builders', phone: '555-0100', email: 'gc@oak.test' });
  const build = (cp?: Record<string, unknown>) => buildConsumerPassport({
    projects: passportJobsFromProjects([{ ...project, ...(cp ? { clientPortal: { ...basePortal, ...cp } } : {}) } as never], gc),
    selections: selections as never, commitments: commitments as never, subcontractors: subcontractors as never,
    nowMs: Date.parse('2026-09-23T12:00:00Z'),
  });
  const off = build();
  const offJson = JSON.stringify(off);
  ok('no portal: the equipment keeps brand and model', off.equipment.some(e => e.brand === 'Moen' && e.modelNumber === '7594SRS'));
  ok('no portal: no supplier on equipment and no supplier contractor',
    !offJson.includes(SUPPLIER) && !offJson.includes(PO_VENDOR) && !off.contractors.some(c => c.role === 'supplier'), offJson);
  ok('no portal: the trade is listed without contact, phone or email',
    off.contractors.some(c => c.role === 'trade' && c.companyName === 'Sparky Electric' && !c.phone && !c.email && !c.contactName));
  ok('no portal: the licence still shows', off.contractors.some(c => c.role === 'trade' && c.licenseNumber === 'EL-42'));
  ok('the GC\'s OWN contact always shows', off.contractors.some(c => c.role === 'general_contractor' && c.phone === '555-0100'));
  const on = build({ shareSupplierNames: true, shareTradeContacts: true });
  ok('switched on: supplier on equipment, the supplier contractor, and the trade\'s phone',
    on.equipment.some(e => e.supplier === SUPPLIER) && on.contractors.some(c => c.role === 'supplier' && c.companyName === PO_VENDOR)
    && on.contractors.some(c => c.role === 'trade' && c.phone === SUB_PHONE && c.email === SUB_EMAIL));
  const text = buildPassportHandoff(off);
  ok('the shared copy no longer claims the record belongs to the homeowner or travels with the home',
    !/belongs to the homeowner|travels with the home/i.test(text), text.split('\n').pop());
  ok('the shared copy says the contractor compiled it', /Compiled by your contractor/.test(text));
}

// ── wiring ──────────────────────────────────────────────────────────────────
console.log('\nwiring');
{
  const snapSrc = code(read('utils/portalSnapshot.ts'));
  ok('the snapshot reads the switches through ownerSharingFor(portal)', /const sharing = ownerSharingFor\(portal\);/.test(snapSrc));
  ok('the snapshot gates the finish supplier', /supplier: sharing\.supplierNames \?/.test(snapSrc));
  ok('the snapshot gates the baked FAQ', /bakedSharingAllowed\(hp\.sharing, sharing\)/.test(snapSrc) && /hp && faqAllowed &&/.test(snapSrc));

  const cb = code(read('app/closeout-binder.tsx'));
  ok('closeout binder: both switches exist, read through ownerSharingFor(project?.clientPortal)',
    /ownerSharingFor\(project\?\.clientPortal\)/.test(cb) && /key: 'supplierNames'/.test(cb) && /key: 'tradeContacts'/.test(cb)
    && /testID=\{`owner-sharing-\$\{row\.key\}`\}/.test(cb));
  ok('closeout binder: a flip writes shareSupplierNames / shareTradeContacts onto the job\'s portal settings',
    /'shareSupplierNames' : 'shareTradeContacts'/.test(cb) && /clientPortal: \{ \.\.\.cp, \[field\]: value \}/.test(cb));
  ok('closeout binder: with no portal the switches are disabled and say why',
    /disabled=\{!hasPortal \|\| passportBusy\}/.test(cb) && /Until then, neither is shared\./.test(cb));
  ok('closeout binder: the passport is built under the switches and the bake records them',
    /buildHomePassport\(\{[\s\S]*?sharing,\s*\}\)/.test(cb) && /generatedAt, sharing \}/.test(cb));
  ok('closeout binder: the passport index sync stays diff-only (the answer-time filter, not a prune, holds a switched-off fact back)',
    /const indexStatus = await syncMemoryEmbeddings\(project\.id, memoryDocs\)/.test(cb));
  {
    // The block from `if (!indexStatus.ok) {` to its own closing brace (six
    // spaces in, the try body's level) must alert and then RETURN, before
    // anything is baked.
    const at = cb.indexOf('if (!indexStatus.ok) {');
    const failBlock = at < 0 ? '' : cb.slice(at, cb.indexOf('\n      }\n', at));
    ok('closeout binder: a failed index keeps the previous bake and says so',
      /showAlert\(\s*'Ask Your Home not updated'/.test(failBlock) && /\n\s*return;\s*$/.test(failBlock)
      && at < cb.indexOf('await saveBakedPassport('), failBlock.slice(-120));
  }
  ok('closeout binder: the switch copy names only the surfaces each switch changes',
    /Covers the client portal, the Home Passport, Ask Your Home and the binder PDF\./.test(cb)
    && /in the Home Passport, Ask Your Home and the binder PDF\./.test(cb)
    && /The client portal never lists a sub\\u2019s phone or email\./.test(cb)
    && !/The PDF you export yourself lists everything/.test(cb));
  ok('closeout binder: the PDF export passes the job\'s switches',
    /shareCloseoutBinderPDF\(\{[\s\S]*?sharing: ownerSharingFor\(project\.clientPortal\),\s*\}\)/.test(cb));
  ok('closeout binder: the header no longer promises sub contacts',
    !/sub contacts/.test(cb) && !/Subcontractor contacts/.test(cb));

  // client-portal-setup keeps a copy of the portal settings taken when it
  // opened and writes it back on Save. The two switches live in the binder,
  // so that Save must take them from the SAVED row, or a stale screen turns a
  // switch the GC just turned off back on.
  const setupSave = code(read('app/client-portal-setup.tsx'));
  const saveBody = (setupSave.match(/const handleSave = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/) ?? [''])[0];
  ok('portal setup Save takes both switches from the saved row, not its opening copy',
    /shareSupplierNames: project\?\.clientPortal\?\.shareSupplierNames/.test(saveBody)
    && /shareTradeContacts: project\?\.clientPortal\?\.shareTradeContacts/.test(saveBody)
    && !/updateProject\(id, \{ clientPortal: portal \}\)/.test(saveBody), saveBody.slice(0, 200));
  ok('portal setup never edits the switches itself (the binder owns them)',
    !/setPortal\([^)]*shareSupplierNames|setPortal\([^)]*shareTradeContacts/.test(setupSave));

  const inputs = code(read('utils/passport/passportInputs.ts'));
  ok('passport inputs carry each job\'s switches', /share: ownerSharingFor\(p\.clientPortal\)/.test(inputs));
}

// ── the closeout binder PDF (the owner's handover document) ─────────────────
// The engine reaches react-native / expo / Supabase; the HTML builder touches
// none of them, so they are stubbed (the same stubs validate-closeout-binder
// uses) and the real buildBinderHtml is rendered with the switches off and on.
console.log('\ncloseout binder PDF — follows the switches');
{
  type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
  type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
  const B = (globalThis as unknown as { Bun?: { plugin: (p: { name: string; setup: (b: BunPluginBuilder) => void }) => void } }).Bun;
  if (!B) { ok('runs under bun (Bun.plugin stubs the native modules)', false); }
  else {
    B.plugin({
      name: 'owner-optins-binder-stubs',
      setup(build) {
        const inert: VirtualModule = { exports: { Platform: { OS: 'ios' }, supabase: {}, isSupabaseConfigured: false }, loader: 'object' };
        for (const spec of ['react-native', 'expo-print', 'expo-sharing', '@/lib/supabase', 'expo-mail-composer', 'expo-file-system/legacy']) {
          build.module(spec, () => inert);
        }
      },
    });
    const { buildBinderHtml } = await import('../utils/closeoutBinderEngine');
    type BinderInput = Parameters<typeof buildBinderHtml>[0];
    const render = (cp?: Record<string, unknown>) => buildBinderHtml({
      project: project as unknown as BinderInput['project'],
      branding: { companyName: 'Oak Builders', email: 'gc@oak.test', phone: '555-0100' } as unknown as BinderInput['branding'],
      binder: binder as unknown as BinderInput['binder'],
      commitments: commitments as unknown as BinderInput['commitments'],
      subcontractors: subcontractors as unknown as BinderInput['subcontractors'],
      selections: selections as unknown as BinderInput['selections'],
      photos: [], warranties: [], lienWaivers: [], rfis: [], submittals: [],
      // Exactly what the screen passes: the job's switches, read the one way.
      sharing: ownerSharingFor(cp ? { ...basePortal, ...cp } as never : undefined),
    });
    for (const [label, html] of [['no portal', render()], ['a portal saved before the switches', render({})],
      ['both switched off', render({ shareSupplierNames: false, shareTradeContacts: false })]] as const) {
      ok(`${label}: no supplier, sub phone, sub email or sub contact name in the PDF`,
        ![SUPPLIER, SUB_PHONE, SUB_EMAIL, SUB_CONTACT].some(x => html.includes(x)), label);
      ok(`${label}: brand, model and the trade still print`, html.includes('Moen') && html.includes('7594SRS') && html.includes('Sparky Electric'));
    }
    const on = render({ shareSupplierNames: true, shareTradeContacts: true });
    ok('both switched on: supplier, phone and email print', on.includes(SUPPLIER) && on.includes(SUB_PHONE) && on.includes(SUB_EMAIL));
    const supOnly = render({ shareSupplierNames: true });
    ok('suppliers on, contacts off: supplier prints, no phone or email',
      supOnly.includes(SUPPLIER) && !supOnly.includes(SUB_PHONE) && !supOnly.includes(SUB_EMAIL));
    const conOnly = render({ shareTradeContacts: true });
    ok('contacts on, suppliers off: phone and email print, no supplier',
      conOnly.includes(SUB_PHONE) && conOnly.includes(SUB_EMAIL) && !conOnly.includes(SUPPLIER));
  }
}

// ── the handover email (notify: closeout_binder_sent) ─────────────────────
// It is sent to the homeowner at handover. It promised "sub contact" (off by
// default since decision 5) and a portal that "doesn't expire" (the link
// closes 30 days after the job is closed — 20260916140000).
console.log('\nthe closeout-binder email promises only what is true');
{
  const n = read('supabase/functions/notify/index.ts');
  const block = n.slice(n.indexOf("case 'closeout_binder_sent': {"), n.indexOf('pushData:', n.indexOf("case 'closeout_binder_sent': {")));
  const said = code(block);
  ok('found the homeowner email block', said.includes('Open my portal'));
  ok('it no longer promises a sub contact', !/sub contact/i.test(said));
  ok('it no longer says the portal does not expire', !/doesn't expire|does not expire|never expires/i.test(said));
  ok('it states the real rule: open until 30 days after the job is closed out',
    /stays open until 30 days after \$\{escapeHtml\(company\)\} closes out the job, then it stops working\./.test(said));
}

// ── passcode copy (client-portal-setup) ─────────────────────────────────────
console.log('\npasscode copy says the link is the key');
{
  const setup = code(read('app/client-portal-setup.tsx'));
  ok('no "Portal is locked" / "Passcode Protection" / "passcode-protected"',
    !/Portal is locked|Passcode Protection|passcode-protected|disable passcode protection/.test(setup));
  ok('the section says the link is the key and the passcode is a light extra step',
    /The link is the key: anyone who has it can reach this project\./.test(setup) && /light extra step on the page, not a lock/.test(setup)
    && /Share the link only with your client/.test(setup));
  ok('a new passcode does not promise existing link-holders are cut off',
    !/Existing clients will need the new code before they can view the portal/.test(setup) && /It does not change the link/.test(setup));
}

console.log(fail ? `\n${fail} FAILED, ${pass} passed` : `\nALL PASS (${pass})`);
if (fail) process.exit(1);
