// validate-w5-xray-client-leak.ts — #9 end to end: a Cost X-Ray finding the GC
// kept GC-only never reaches the homeowner, on ANY path, and its money still
// does.
//
// WHY THIS EXISTS. Wave 5 taught the estimate view, the estimate PDF and the
// email to fold GC-only X-Ray lines (xray.clientVisible === false) into one
// 'Contingency' row, and app/cost-xray.tsx told the GC "the client's proposal
// shows only their total … never the finding". Two paths still carried the
// tell text verbatim, found by the integration review:
//
//   1. Create Proposal (utils/contractEngine.buildProposalFromRevision) built
//      the proposal's scope from EVERY revision line name — so
//      "• Possible knob-and-tube behind panel — 1 ea" was published to the
//      portal's 'Scope of work' and printed on the contract PDF.
//   2. Every accepted tell also makes a field-verify punch item
//      ('Verify before demo/order: <tell>', xray.clientVisible false, no
//      listType → a formal punch item), and the client portal's punch list and
//      the closeout packet handed over at the end both published it.
//
// HOW IT CHECKS. The real builders are EXECUTED (native edges stubbed): the
// proposal draft from a revision holding one GC-only line, the portal
// snapshot with that proposal as its contract plus the verify task on the
// punch list, and the closeout packet HTML. The tell text must appear in none
// of them; the proposal price must equal the revision total to the cent; a
// normal punch item and a normal estimate line must still appear (the filter
// may not over-reach).
//
// Run: bun run scripts/validate-w5-xray-client-leak.ts

const printed: string[] = [];
type VirtualModule = { exports: Record<string, unknown>; loader: 'object' };
type BunPluginBuilder = { module: (specifier: string, cb: () => VirtualModule) => void };
declare const Bun: { plugin: (p: { name: string; setup: (build: BunPluginBuilder) => void }) => void } | undefined;
if (typeof Bun === 'undefined') {
  console.error('validate-w5-xray-client-leak must run under bun (Bun.plugin stubs native modules)');
  process.exit(1);
}
Bun.plugin({
  name: 'w5-xray-client-leak-stubs',
  setup(build) {
    build.module('react-native', () => ({ exports: { Platform: { OS: 'ios' } }, loader: 'object' }));
    // printToFileAsync captures the HTML it is handed, so section 4 can read
    // the REAL estimate PDF the GC shares (buildEstimateHtml is not exported).
    build.module('expo-print', () => ({ exports: { printToFileAsync: async ({ html }: { html: string }) => { printed.push(html); return { uri: 'file://x.pdf' }; }, printAsync: async () => {} }, loader: 'object' }));
    build.module('expo-sharing', () => ({ exports: { isAvailableAsync: async () => false, shareAsync: async () => {} }, loader: 'object' }));
    build.module('expo-file-system/legacy', () => ({ exports: {}, loader: 'object' }));
    build.module('expo-mail-composer', () => ({ exports: {}, loader: 'object' }));
    build.module('@/lib/supabase', () => ({ exports: { supabase: {}, isSupabaseConfigured: false }, loader: 'object' }));
  },
});

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); } else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}

const { buildProposalFromRevision } = await import('../utils/contractEngine');
const { buildPortalSnapshot } = await import('../utils/portalSnapshot');
const { buildCloseoutHtml } = await import('../utils/closeoutPacketGenerator');
type Rev = Parameters<typeof buildProposalFromRevision>[1];
type Proj = Parameters<typeof buildProposalFromRevision>[0];
type SnapOpts = Parameters<typeof buildPortalSnapshot>[0];
type PacketData = Parameters<typeof buildCloseoutHtml>[0];

const TELL = 'Possible knob-and-tube behind panel';
const TELL2 = 'Cast-iron drain likely cracked under slab';
const stamp = { createdAt: '2026-09-10T17:00:00Z', updatedAt: '2026-09-10T17:00:00Z' };
const xrayMeta = (tell: string) => ({
  sourcePhotoId: 'ph1', bbox: null, tell, category: 'electrical', confidence: 0.6, band: 'mid', clientVisible: false,
});
const line = (p: Record<string, unknown>) => ({
  materialId: 'm', category: 'general', supplier: '', unitPrice: 0, markup: 0, usesBulk: false, ...p,
});

const items = [
  line({ name: 'Kitchen cabinets', category: 'casework', quantity: 12, unit: 'lf', unitPrice: 400, lineTotal: 4800 }),
  line({ name: TELL, category: 'Hidden Conditions', quantity: 1, unit: 'ea', unitPrice: 1250.25, lineTotal: 1250.25, isAllowance: true, xray: xrayMeta(TELL) }),
  line({ name: TELL2, category: 'Hidden Conditions', quantity: 40, unit: 'lf', unitPrice: 30, lineTotal: 1200, isAllowance: true, xray: xrayMeta(TELL2) }),
];
const grandTotal = 7250.25;
const project = {
  id: 'p1', name: 'Maple St Reno', type: 'renovation', status: 'in_progress', location: '12 Maple St',
  description: 'Kitchen remodel', ...stamp,
} as unknown as Proj;
const revision = {
  id: 'rev1', projectId: 'p1', revNumber: 2, grandTotal,
  snapshot: { items, baseTotal: grandTotal, grandTotal, globalMarkup: 0 },
  ...stamp,
} as unknown as Rev;

// ── 1. the proposal draft ────────────────────────────────────────────────────
console.log('\nCreate Proposal — scope built from the client rows');
const draft = buildProposalFromRevision(project, revision, { split: null, warrantyMonths: null });
ok('the proposal scope names no GC-only finding',
  !draft.scopeText.includes(TELL) && !draft.scopeText.includes(TELL2),
  draft.scopeText);
ok('the GC-only lines fold into ONE lump-sum Contingency bullet',
  (draft.scopeText.match(/• Contingency — lump sum/g) ?? []).length === 1, draft.scopeText);
ok('the contingency bullet carries no quantity (a quantity could hint at the finding)',
  !/• Contingency — \d/.test(draft.scopeText) && !/40 lf/.test(draft.scopeText), draft.scopeText);
ok('a client-visible line is still listed with its quantity',
  draft.scopeText.includes('• Kitchen cabinets — 12 lf'), draft.scopeText);
ok('the proposal price is the revision total, to the cent (nothing moved)',
  draft.contractValue === grandTotal, `contractValue ${draft.contractValue}, want ${grandTotal}`);

// ── 2. the portal snapshot: contract scope + punch list ──────────────────────
console.log('\nclient portal snapshot — no tell text anywhere');
const portal = {
  portalId: 'portal-abc', enabled: true,
  showSchedule: false, showBudgetSummary: false, showInvoices: false, showChangeOrders: false,
  showPhotos: false, showDailyReports: false, showPunchList: true, showRFIs: false, showDocuments: false,
} as unknown as SnapOpts['portal'];
const punchBase = {
  projectId: 'p1', location: '', assignedSub: '', dueDate: '', priority: 'medium', status: 'open', ...stamp,
};
const verifyTask = { ...punchBase, id: 'verify1', description: 'Verify before demo/order: ' + TELL, xray: xrayMeta(TELL) };
const normalPunch = { ...punchBase, id: 'punch1', description: 'Grout missing at tub surround' };
const contract = {
  ...draft, id: 'c1', userId: 'u1', ...stamp, status: 'sent', kind: 'proposal',
} as unknown as NonNullable<SnapOpts['contract']>;
const snap = buildPortalSnapshot({
  project: project as unknown as SnapOpts['project'], portal,
  punchItems: [verifyTask, normalPunch] as unknown as SnapOpts['punchItems'],
  contract,
});
const json = JSON.stringify(snap);
ok('the snapshot really publishes the proposal scope (so the check below can see a leak)',
  json.includes('Kitchen cabinets') && json.includes('Contingency — lump sum'),
  'the contract block is missing from the snapshot — this fixture no longer exercises the scope path');
ok('the serialized portal snapshot carries neither tell', !json.includes(TELL) && !json.includes(TELL2),
  'a GC-only Cost X-Ray finding reached the homeowner payload');
const shown = (snap.sections.punchList ?? []).map(p => p.id);
ok('the Cost X-Ray verify task is kept off the client punch list', !shown.includes('verify1'), JSON.stringify(shown));
ok('an ordinary punch item is still on the client punch list (the filter does not over-reach)',
  shown.includes('punch1'), JSON.stringify(shown));

// ── 3. the closeout packet handed over at the end ────────────────────────────
console.log('\ncloseout packet — no tell text');
const html = buildCloseoutHtml({
  project: { ...project, estimate: { grandTotal } } as unknown as PacketData['project'],
  branding: {} as PacketData['branding'],
  changeOrders: [], invoices: [], dailyReports: [], warranties: [], photos: [],
  punchItems: [verifyTask, normalPunch] as unknown as PacketData['punchItems'],
} as unknown as PacketData);
ok('the closeout packet does not print the verify task', !html.includes(TELL), 'the tell is in the handover packet');
ok('the closeout packet still prints an ordinary punch item', html.includes('Grout missing at tub surround'));

// ── 3b. after the first server re-read (the integration review's repro) ─────
// `xray` lives only in memory: punch_items has no column for it, so the
// loader rebuilds the task WITHOUT it and every `xray?.clientVisible !==
// false` filter above lets it through. Sections 2-3 keep `xray` in memory and
// could never see that. The rule that survives the round trip is the list:
// cost-xray.tsx files the verify task on the internal crew list, list_type is
// persisted, and every client surface drops crew items. The listType below is
// READ out of the shipped addPunchItem call, not assumed.
console.log('\nafter a server re-read — the verify task has lost `xray` and must still stay off');
{
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { mergeLocalOnly } = await import('../utils/projectContextPure');
  const { punchListTypeOf } = await import('../types');
  const src = readFileSync(join(process.cwd(), 'app', 'cost-xray.tsx'), 'utf8');
  const call = src.slice(src.indexOf("description: 'Verify before demo/order: '"));
  const block = call.slice(0, call.indexOf('});'));
  const listType = /\blistType:\s*'(crew|punch)'/.exec(block)?.[1] as 'crew' | 'punch' | undefined;
  ok("cost-xray files its verify task on the crew list (listType: 'crew' in the addPunchItem call)",
    listType === 'crew', block);
  const created = { ...verifyTask, listType };
  // The write path (ProjectContext addPunchItem) sends list_type =
  // punchListTypeOf(item) and no xray; the loader maps it back the same way.
  const serverRow = (() => {
    const { xray: _dropped, ...rest } = created;
    void _dropped;
    return { ...rest, listType: punchListTypeOf({ listType: punchListTypeOf(created) }) };
  })();
  const reread = mergeLocalOnly([serverRow, normalPunch], [created, normalPunch], new Set<string>());
  const rereadTask = reread.find(p => p.id === 'verify1') as Record<string, unknown> | undefined;
  ok('the re-read row really has no `xray` (this case exercises the stripped shape)',
    !!rereadTask && !('xray' in rereadTask), JSON.stringify(rereadTask));
  const snap2 = buildPortalSnapshot({
    project: project as unknown as SnapOpts['project'], portal,
    punchItems: reread as unknown as SnapOpts['punchItems'],
  });
  const shown2 = (snap2.sections.punchList ?? []).map(p => p.id);
  ok('after the re-read the verify task is still off the client punch list', !shown2.includes('verify1'), JSON.stringify(shown2));
  ok('after the re-read the portal payload carries no tell', !JSON.stringify(snap2).includes(TELL));
  ok('after the re-read an ordinary punch item is still on the client punch list', shown2.includes('punch1'));
  const html2 = buildCloseoutHtml({
    project: { ...project, estimate: { grandTotal } } as unknown as PacketData['project'],
    branding: {} as PacketData['branding'],
    changeOrders: [], invoices: [], dailyReports: [], warranties: [], photos: [],
    punchItems: reread as unknown as PacketData['punchItems'],
  } as unknown as PacketData);
  ok('after the re-read the closeout packet does not print the verify task', !html2.includes(TELL));
  ok('after the re-read the closeout packet still prints an ordinary punch item', html2.includes('Grout missing at tub surround'));
}

// ── 4. the estimate PDF and its email text: sell basis only ─────────────────
// The document the GC attaches for the homeowner printed each line's COST
// unit price, its markup %, then "Base Cost" and "Markup (X%)" (integration
// review, wave 5 — #55's rule, which the Full Estimator's mail draft already
// followed). Fixture: $400/lf cabinets at 25% markup → sell line $6,000.
console.log('\nestimate PDF + email text — quantity and SELL total only');
const { generateEstimatePDFUri, buildEstimateTextForEmail } = await import('../utils/pdfGenerator');
const estItems = [
  line({ name: 'Kitchen cabinets', category: 'casework', quantity: 12, unit: 'lf', unitPrice: 400, markup: 25, lineTotal: 6000 }),
  line({ name: 'Tile backsplash', category: 'finishes', quantity: 3, unit: 'sf', unitPrice: 11.11, markup: 25, lineTotal: 41.67 }),
  line({ name: TELL, category: 'Hidden Conditions', quantity: 1, unit: 'ea', unitPrice: 1000.2, markup: 25, lineTotal: 1250.25, isAllowance: true, xray: xrayMeta(TELL) }),
];
const estGrand = 7291.92;
const estProject = {
  ...(project as unknown as Record<string, unknown>), squareFootage: 0,
  linkedEstimate: { items: estItems, baseTotal: 5833.54, markupTotal: 1458.38, globalMarkup: 25, grandTotal: estGrand },
} as unknown as Parameters<typeof buildEstimateTextForEmail>[0];
printed.length = 0;
await generateEstimatePDFUri(estProject, { companyName: 'Acme GC' } as Parameters<typeof buildEstimateTextForEmail>[1]);
const pdfHtml = printed[0] ?? '';
const mail = buildEstimateTextForEmail(estProject, { companyName: 'Acme GC' } as Parameters<typeof buildEstimateTextForEmail>[1]);
ok('the estimate PDF was actually rendered', pdfHtml.includes('Kitchen cabinets'), 'no HTML captured');
for (const [label, doc] of [['PDF', pdfHtml], ['email', mail]] as const) {
  ok(`${label}: no cost unit price ($400.00 / $11.11 / $1,000.20)`,
    !doc.includes('$400.00') && !doc.includes('$11.11') && !doc.includes('$1,000.20'));
  ok(`${label}: no markup % and no Base Cost / Markup rows`,
    !/25%/.test(doc) && !/Base Cost/i.test(doc) && !/Markup/i.test(doc), label);
  ok(`${label}: the sell line totals and the grand total are printed`,
    doc.includes('$6,000.00') && doc.includes('$41.67') && doc.includes('$1,250.25') && doc.includes('$7,291.92'));
  ok(`${label}: the GC-only finding is not named`, !doc.includes(TELL));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
