// scripts/validate-w4-portal-page-fixes.ts — wave 4, lane portal-page.
//
// The homeowner portal (marketing/portal/index.html), the snapshot builder
// behind it (utils/portalSnapshot.ts), the owner-decision list
// (utils/portalOwnerCore.ts) and the GC-side reconciler
// (hooks/usePortalApprovalReconciler.ts). EXECUTED where it can be: the
// builder and the core are imported, the reconciler's pure planner and the
// page's own functions are lifted out of their files and run.
//
//   #64  the contract's terms reach the signer; no sign box without them
//   #70  no promise that the portal will deliver the sealed PDF; client-view
//        opens signed_pdf_url through the signed-URL helper
//   #44  a credit CO's tax prints "− $80.00", never "$-80.00"
//   #136 owed / approved amounts to the cent; a taxed CO's decision amount
//        is its tax-inclusive total (builder and page byte-aligned)
//   #137 after a Pay tap: one module-scope handler, polls, "Checking your
//        payment…", never "Paid" before the overlay says so; idempotent render
//   carry #72 / portal-server handoffs: the reconciler's conflict rule and the
//        Client approver stamp; photos {id, path, url?}; heroPhotoId; timeZone;
//        signed-media-urls with no passcode; CO recorded:false copy
//
// Run: bun run scripts/validate-w4-portal-page-fixes.ts

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPortalSnapshot, buildPortalContractContent, portalContractTermsMissing,
  portalPhotoSource, PORTAL_SNAPSHOT_VERSION,
} from '../utils/portalSnapshot';
import { buildOwnerDecisions } from '../utils/portalOwnerCore';
import type { Project, ClientPortalSettings, ProjectContract, ProjectPhoto, COAuditEntry, COApprover } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function expect<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// ── Lifting helpers (string/comment aware brace matching) ──────────────────
function matchBrace(src: string, open: number): number {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    // An escape outside a string can only be inside a regex literal: skip the
    // escaped char, so /^https?:\/\//i is not read as a line comment.
    if (ch === '\\') { i++; continue; }
    if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) return -1; continue; }
    if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
/** A top-level `function name(...) {...}` from a JS/TS source. */
function liftFn(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) throw new Error(`function ${name} not found`);
  let paren = 0, i = at + `function ${name}`.length;
  for (; i < src.length; i++) {
    if (src[i] === '(') paren++;
    else if (src[i] === ')') { paren--; if (paren === 0) break; }
  }
  // Body brace: the first `{` at angle/brace depth 0 after the params that is
  // not part of a `: {…}` return type.
  let j = i + 1;
  for (; j < src.length; j++) {
    if (src[j] === '{') {
      const before = src.slice(i + 1, j).trim();
      if (/:\s*$/.test(before) || /[|&<,]\s*$/.test(before)) { j = matchBrace(src, j); continue; }
      break;
    }
  }
  const end = matchBrace(src, j);
  return src.slice(at, end + 1);
}
/** A top-level `var NAME = …;` whose value is an object/array literal or a scalar. */
function liftVar(src: string, name: string): string {
  const at = src.indexOf(`var ${name} =`);
  if (at < 0) throw new Error(`var ${name} not found`);
  const eq = src.indexOf('=', at);
  let k = eq + 1;
  while (src[k] === ' ') k++;
  if (src[k] === '{' || src[k] === '[') {
    const close = src[k] === '{' ? matchBrace(src, k) : src.indexOf('];', k);
    return src.slice(at, close + 1) + ';';
  }
  return src.slice(at, src.indexOf(';', k) + 1);
}
function runJs<T>(code: string, expose: string): T {
  const BunRt = (globalThis as unknown as { Bun: { Transpiler: new (o: { loader: string }) => { transformSync(s: string): string } } }).Bun;
  const js = new BunRt.Transpiler({ loader: 'ts' }).transformSync(`${code}\nexport { ${expose} };`);
  return new Function(`${js.replace(/export \{[^}]*\};?/g, '')}\nreturn ${expose};`)() as T;
}

const html = read('marketing/portal/index.html');
const snapSrc = read('utils/portalSnapshot.ts');
const hook = read('hooks/usePortalApprovalReconciler.ts');
const view = read('app/client-view.tsx');
const hydrate = read('utils/portalSnapshotHydrate.ts');

// ═══ #64 — the contract's terms, built on the GC's device ═══════════════════
console.log('\n#64 — the builder publishes the contract terms');
const contract = {
  id: 'c-1', projectId: 'p1', userId: 'gc-1', version: 1, title: 'Construction Agreement',
  contractValue: 100_000.5,
  scopeText: 'Kitchen remodel per plans A1-A4.', termsText: 'Standard terms.', warrantyText: 'One year workmanship.',
  startDate: '2026-10-05', durationDays: 90,
  paymentSchedule: [
    { id: 'm1', label: 'Deposit', trigger: 'on_signing', amount: 25_000.13, status: 'pending' },
    { id: 'm2', label: 'Progress', trigger: 'on_invoice', percent: 65, status: 'pending' },
    { id: 'm3', label: 'Final', trigger: 'on_final', amount: 9_999.99, status: 'pending' },
  ],
  allowances: [{ id: 'a1', category: 'Fixtures', amount: 3500.456, description: 'Faucets' }],
  status: 'sent', sentAt: '2026-09-20T10:00:00Z', createdAt: '2026-09-19T00:00:00Z', updatedAt: '2026-09-20T10:00:00Z',
  gcSignature: { name: 'GC', role: 'gc', signedAt: '2026-09-20T10:00:00Z' },
} as unknown as ProjectContract;
const content = buildPortalContractContent(contract, 'Project description');
expect('the stored milestone amounts, to the cent; a percent row resolved on the device',
  content.paymentSchedule.map(l => l.amount), [25_000.13, 65_000.33, 9_999.99]);
expect('…with the words the sealed PDF prints for "when"', content.paymentSchedule.map(l => l.label), ['Deposit', 'Progress', 'Final']);
ok('…dueText from milestoneDueText (signing / progress / final)',
  /signing/i.test(content.paymentSchedule[0].dueText) && content.paymentSchedule[1].dueText.length > 0 && content.paymentSchedule[2].dueText.length > 0,
  JSON.stringify(content.paymentSchedule));
const dated = buildPortalContractContent({ ...contract, paymentSchedule: [{ id: 'd', label: 'Rough-in', trigger: 'on_date', triggerDate: '2026-11-01', amount: 1, status: 'invoiced' }] } as unknown as ProjectContract);
expect('a dated row reads its calendar day (as the PDF prints it), whatever its billing status', dated.paymentSchedule[0].dueText, 'Due Nov 1, 2026');
expect('scope / terms / warranty ride along whole', [content.scopeText, content.termsText, content.warrantyText],
  ['Kitchen remodel per plans A1-A4.', 'Standard terms.', 'One year workmanship.']);
expect('the timeline is stated only when both halves resolve (inclusive end)',
  [content.startDate, content.durationDays, content.completionDate], ['2026-10-05', 90, '2027-01-02']);
expect('allowances to the cent', content.allowances, [{ category: 'Fixtures', amount: 3500.46, description: 'Faucets' }]);
const noStart = buildPortalContractContent({ ...contract, startDate: undefined } as ProjectContract);
ok('no start date → no timeline at all (never a completion day derived from a blank)',
  noStart.startDate === undefined && noStart.durationDays === undefined && noStart.completionDate === undefined);
expect('an empty scope falls back to the project description, as the PDF does',
  buildPortalContractContent({ ...contract, scopeText: '  ' } as ProjectContract, 'Project description').scopeText, 'Project description');
const unpriced = buildPortalContractContent({ ...contract, paymentSchedule: [{ id: 'x', label: 'Deposit', trigger: 'on_signing', status: 'pending' }] } as unknown as ProjectContract);
expect('a milestone with no amount and no percent is published as null — never $0', unpriced.paymentSchedule[0].amount, null);

expect('termsMissing: complete terms sign', portalContractTermsMissing(content), null);
expect('termsMissing: no content', portalContractTermsMissing(undefined), 'no_content');
expect('termsMissing: no schedule', portalContractTermsMissing({ ...content, paymentSchedule: [] }), 'no_schedule');
expect('termsMissing: an unpriced milestone', portalContractTermsMissing(unpriced), 'unpriced_milestone');
expect('termsMissing: no scope', portalContractTermsMissing({ ...content, scopeText: ' ' }), 'no_scope');
expect('termsMissing: the warranty placeholder',
  portalContractTermsMissing({ ...content, warrantyText: 'for [warranty period — set before signing] from…' }), 'warranty_placeholder');

const project = {
  id: 'p1', name: 'Maple', status: 'in_progress', description: 'Kitchen', updatedAt: '2026-09-20T00:00:00Z',
} as unknown as Project;
const portal = {
  portalId: 'portal-1', enabled: true, showPhotos: true, showChangeOrders: true, coApprovalEnabled: true,
  showSchedule: false, showBudgetSummary: false, showInvoices: false, showDailyReports: false,
  showPunchList: false, showRFIs: false, showDocuments: false,
} as unknown as ClientPortalSettings;
const photos = [
  { id: '11111111-1111-4111-8111-111111111111', projectId: 'p1', uri: 'file:///var/mobile/IMG_1.jpg', storagePath: 'gc-1/p1/11111111-1111-4111-8111-111111111111.jpg', timestamp: '2026-09-20T12:00:00Z' },
  { id: '22222222-2222-4222-8222-222222222222', projectId: 'p1', uri: 'https://cdn.example.com/legacy.jpg', timestamp: '2026-09-19T12:00:00Z' },
  { id: '33333333-3333-4333-8333-333333333333', projectId: 'p1', uri: 'blob:https://x/abc', timestamp: '2026-09-18T12:00:00Z' },
] as unknown as ProjectPhoto[];
const snap = buildPortalSnapshot({ project, portal, contract, photos, changeOrders: [] } as unknown as Parameters<typeof buildPortalSnapshot>[0]);
ok('snapshot version bumped to 13 for the new keys', PORTAL_SNAPSHOT_VERSION === 13 && snap.v === 13);
expect('snapshot.contract.content is exactly the builder\'s block on the live contract id',
  [snap.contract?.id, JSON.stringify(snap.contract?.content)], ['c-1', JSON.stringify(content)]);
ok('the contract is "waiting on you" when its terms can be signed',
  (snap.ownerDecisions ?? []).some(d => d.kind === 'contract'));
const snapUnpriced = buildPortalSnapshot({ project, portal, contract: { ...contract, paymentSchedule: [] }, photos: [], changeOrders: [] } as unknown as Parameters<typeof buildPortalSnapshot>[0]);
ok('…and not while they cannot (no row pointing at a card with nothing to do)',
  !(snapUnpriced.ownerDecisions ?? []).some(d => d.kind === 'contract'));
ok('the lite writer passes the same contract row into the same builder (one block, both writers)',
  /contract: contract\.value \?\? undefined/.test(read('utils/portalLiteSync.ts')));
ok('the false "full row is fetched" comment is gone', !/full contract row is fetched from Supabase/.test(snapSrc));

// ═══ #14 (portal-server handoff) — photos, hero, time zone ══════════════════
console.log('\nphotos {id, path, url?}, heroPhotoId, timeZone');
const ph = snap.sections.photos ?? [];
ok('no published photo carries a file:, blob: or data: url',
  ph.every(p => p.url === undefined || /^https?:\/\//i.test(p.url)), JSON.stringify(ph));
ok('a private photo is published by id + path (the page signs it)',
  ph.some(p => p.id === '11111111-1111-4111-8111-111111111111' && p.path === 'gc-1/p1/11111111-1111-4111-8111-111111111111.jpg' && !p.url));
ok('a legacy public link keeps its http(s) url', ph.some(p => p.url === 'https://cdn.example.com/legacy.jpg'));
expect('portalPhotoSource: a bare key in uri is the path', portalPhotoSource({ uri: 'u/p/x.jpg' }), { path: 'u/p/x.jpg' });
expect('portalPhotoSource: data: is dropped', portalPhotoSource({ uri: 'data:image/png;base64,AAA' }), {});
ok('the hero is named by id, and heroPhotoUrl is never the file:// original',
  snap.project.heroPhotoId === '11111111-1111-4111-8111-111111111111' && snap.project.heroPhotoUrl === undefined);
ok('top-level timeZone is the device zone', typeof snap.timeZone === 'string' && snap.timeZone.length > 0);
ok('client-view\'s snapshot mode never hands <Image> a non-http uri',
  /\.filter\(p => typeof p\.url === 'string' && \/\^https\?:\\\/\\\/\/i\.test\(p\.url\)\)/.test(hydrate));

// ═══ #136 — the CO decision amount includes the frozen tax ══════════════════
console.log('\n#136 — decision amounts');
const taxedCO = { id: 'co1', number: 3, status: 'submitted', changeAmount: 12_000, taxAmount: 960, totalWithTax: 12_960, dateSubmitted: '2026-09-01', description: 'Deck' };
const creditCO = { id: 'co2', number: 4, status: 'submitted', changeAmount: -1000, taxAmount: -80, totalWithTax: -1080, dateSubmitted: '2026-09-02', description: 'Credit' };
const plainCO = { id: 'co3', number: 5, status: 'submitted', changeAmount: 500, dateSubmitted: '2026-09-03', description: 'Plain' };
const dec = buildOwnerDecisions({ today: '2026-09-20', coApprovalEnabled: true, changeOrders: [taxedCO, creditCO, plainCO] });
expect('buildOwnerDecisions: taxed CO → totalWithTax; untaxed → changeAmount',
  ['co1', 'co2', 'co3'].map(id => dec.find(d => d.id === id)?.amount), [12_960, -1080, 500]);

// The page's legacy mirror, EXECUTED, must agree.
const pageHelpers = [
  'fmtMoney', 'fmtSigned', 'coHasTax', 'esc',
].map(n => liftFn(html, n)).join('\n');
const legacy = runJs<(data: unknown, sections: unknown) => { id: string; amount?: number }[]>(
  `${pageHelpers}\nfunction contractSignable(){ return false; }\n${liftFn(html, 'legacyOwnerDecisions')}`, 'legacyOwnerDecisions');
const legacyOut = legacy({ coApprovalEnabled: true, selections: [] }, { changeOrders: [taxedCO, creditCO, plainCO], invoices: [] });
expect('legacyOwnerDecisions (page) gives the same amounts', ['co1', 'co2', 'co3'].map(id => legacyOut.find(d => d.id === id)?.amount), [12_960, -1080, 500]);

const fmt = runJs<{ fmtMoney: (n: number, o?: { dec: number }) => string; fmtSigned: (n: number) => string }>(
  `${pageHelpers}\nconst api = { fmtMoney, fmtSigned };`, 'api');
expect('#44 fmtSigned(-80) is "−$80.00"', fmt.fmtSigned(-80), '−$80.00');
expect('#44 fmtSigned(12960) is "$12,960.00"', fmt.fmtSigned(12960), '$12,960.00');
ok('#44 the CO row puts the operator next to the sign',
  html.includes(`(coHasTax(c) ? ' '+(c.taxAmount < 0 ? '− ' : '+ ')+fmtMoney(Math.abs(c.taxAmount), {dec:2})+' tax = '+fmtSigned(c.totalWithTax) : '')`)
  && !/' \+ '\+fmtMoney\(c\.taxAmount/.test(html));
ok('#44 the e-sign sheet\'s Sales tax line is signed', /esign-delta-value small">' \+ fmtSigned\(c\.taxAmount\)/.test(html)
  && !/fmtMoney\(c\.taxAmount, \{ dec: 2 \}\)/.test(html));
ok('#44 open-book deltas no longer print "$-…"', !/\+ fmtMoney\(capDelta\)/.test(html) && !/\+ fmtMoney\(p\.variance\)/.test(html));

ok('#136 Outstanding / Balance / Invoiced / Paid tiles to the cent, count-up included',
  /label: 'Outstanding',\s+value: fmtMoney\(budget\.outstanding, \{dec:2\}\)[^\n]*cents: true/.test(html)
  && /label: 'Balance', value: fmtMoney\(bal, \{dec:2\}\)[^\n]*cents: true/.test(html)
  && /if \(fmt === 'money2'\) return fmtMoney\(v, \{dec:2\}\);/.test(html)
  && /s\.cents \? 'money2' : 'money'/.test(html));
ok('#136 the spend bar (headline, Paid, Due now, Retention held) to the cent',
  /Due now <strong>' \+ fmtMoney\(outstanding, \{dec:2\}\)/.test(html)
  && /Retention held <strong>' \+ fmtMoney\(retHeld, \{dec:2\}\)/.test(html)
  && /fmtMoney\(paid, \{dec:2\}\) \+ ' <span class="spend-of">of<\/span> ' \+ fmtMoney\(billed, \{dec:2\}\)/.test(html));
ok('#136 the decision row to the cent, a credit CO signed',
  /\? \(d\.amount > 0 \? '\+' : ''\) \+ fmtSigned\(d\.amount\)\s*: fmtMoney\(d\.amount, \{dec:2\}\)/.test(html));
ok('#136 proposal total, scope and payment milestones to the cent',
  !/fmtMoney\(p\.total, \{ dec: 0 \}\)/.test(html) && !/fmtMoney\(scope\[i\]\.total, \{ dec: 0 \}\)/.test(html)
  && /fmtMoney\(payment\[m\]\.amount, \{ dec: 2 \}\)/.test(html));
ok('#136 the fmtMoney default is still whole dollars (charts untouched)', /var dec = opts && opts\.dec \? opts\.dec : 0;/.test(html));

// ═══ #64 / #70 — the page ═══════════════════════════════════════════════════
console.log('\n#64 / #70 — the contract card');
const cardCode = [
  pageHelpers,
  liftFn(html, 'fmtDate'), liftVar(html, 'CAL_MONTHS'), liftFn(html, 'fmtDateShort'), liftFn(html, 'fmtCalendarDate'),
  liftVar(html, 'CONTRACT_COPY'), liftVar(html, 'WARRANTY_PLACEHOLDER_MARK'), liftVar(html, 'CONTRACT_MISSING_COPY'),
  liftFn(html, 'contractCopy'), liftFn(html, 'contractTermsMissing'), liftFn(html, 'contractSignable'),
  liftFn(html, 'renderContractTerms'), liftFn(html, 'contractSignedLine'), liftFn(html, 'renderContractCard'),
  'var window = { __portalData: { language: "en" } };',
  'function t(k) { return ({ contractTitleLabel: "Title", contractValueLabel: "Contract value", contractStatusSigned: "Signed by both parties", contractSignedDisclaimer: "Keep it", contractSignNamePlaceholder: "Name", contractSignButton: "Sign & make binding" })[k] || k; }',
  'const api = { card: renderContractCard, missing: contractTermsMissing, signable: contractSignable, win: window };',
].join('\n');
const page = runJs<{
  card: (c: unknown) => string; missing: (c: unknown) => string | null; signable: (c: unknown) => boolean;
  win: { __portalData: { language: string } };
}>(cardCode, 'api');
const block = { id: 'c-1', status: 'sent', contractValue: 100_000.5, title: 'Agreement', needsSignature: true, content };
const sentHtml = page.card(block);
const at = (needle: string) => sentHtml.indexOf(needle);
ok('the payment schedule, each amount to the cent, is on the card', sentHtml.includes('$25,000.13') && sentHtml.includes('$65,000.33') && sentHtml.includes('Payment schedule'));
ok('scope, warranty, terms, allowances and the timeline are on the card',
  sentHtml.includes('Kitchen remodel per plans A1-A4.') && sentHtml.includes('One year workmanship.')
  && sentHtml.includes('Standard terms.') && sentHtml.includes('Fixtures') && sentHtml.includes('90 calendar days'));
ok('…ABOVE the name box', at('Payment schedule') >= 0 && at('Scope of work') < at('data-action="sign-contract"') && at('Payment schedule') < at('contract-name-'));
ok('the contract value to the cent', sentHtml.includes('$100,000.50'));
ok('the explainer no longer sends a homeowner to "the app"', !/in the app/i.test(sentHtml) && /Read the scope, payment schedule/.test(sentHtml));
ok('#70 the fine print promises only what is true', sentHtml.includes('Your contractor keeps the sealed signed copy and can send it to you.')
  && !/available in this portal and emailed/.test(sentHtml));
const evil = page.card({ ...block, content: { ...content, scopeText: '<img src=x onerror=alert(1)>', paymentSchedule: [{ label: '<b>x</b>', dueText: '"q"', amount: 1 }] } });
ok('everything on the card is escaped', !evil.includes('<img src=x') && evil.includes('&lt;img') && evil.includes('&lt;b&gt;x&lt;/b&gt;'));
const noBox = (c: unknown) => !page.card(c).includes('data-action="sign-contract"');
ok('no sign box when contentPending (even with needsSignature:true from an old overlay)', noBox({ ...block, contentPending: true }));
ok('no sign box without content (a pre-v13 snapshot)', noBox({ ...block, content: undefined }));
ok('no sign box without a payment schedule', noBox({ ...block, content: { ...content, paymentSchedule: [] } }));
ok('no sign box under an unpriced milestone', noBox({ ...block, content: unpriced }) && page.card({ ...block, content: unpriced }).includes('Amount not set'));
ok('no sign box without scope', noBox({ ...block, content: { ...content, scopeText: '' } }));
ok('…and the card says why', /data-contract-terms-pending="no_content"/.test(page.card({ ...block, contentPending: true })));
ok('the page rule and the builder rule agree',
  [undefined, content, unpriced, { ...content, paymentSchedule: [] }, { ...content, scopeText: '' }]
    .every(c => page.missing(c) === portalContractTermsMissing(c as never)));
ok('contractSignable: only a sent, unsigned, published, complete contract',
  page.signable(block) && !page.signable({ ...block, status: 'signed' }) && !page.signable({ ...block, needsSignature: false })
  && !page.signable({ ...block, contentPending: true }));
const signedHtml = page.card({ ...block, status: 'signed', needsSignature: false, homeownerSignerName: 'Dana', homeownerSignedAt: '2026-09-21T15:00:00Z', homeownerSignatureMethod: 'paper' });
ok('after signing the terms stay on the card as the homeowner\'s record', signedHtml.includes('Payment schedule') && signedHtml.includes('Kitchen remodel'));
ok('a paper signature reads "Signed on paper", never an online e-signature', signedHtml.includes('Signed on paper by Dana') && !/Signed online/.test(signedHtml));
ok('an in-person signature reads "Signed in person"',
  page.card({ ...block, status: 'signed', homeownerSignerName: 'Dana', homeownerSignatureMethod: 'in_person' }).includes('Signed in person by Dana'));
ok('the evidence path is never rendered', !page.card({ ...block, status: 'signed', evidencePath: 'gc/secret.jpg' }).includes('secret'));
page.win.__portalData.language = 'es';
ok('the corrected copy is translated (and not read from a stale uiStrings bundle)',
  page.card(block).includes('Lea abajo el alcance') && !/en la app/.test(page.card(block)));
ok('no locale block in the page still says "in the app" / "emailed to you"',
  !/in the app, then enter your full legal name/.test(html) && !/The signed PDF will be available in this portal/.test(html));
ok('the section, the legacy list and the published list all ask contractSignable',
  /data\.contract\.status === 'sent' && contractSignable\(data\.contract\)/.test(html)
  && /if \(contractSignable\(data\.contract\)\) \{\s*out\.push\(\{\s*id: 'contract'/.test(html)
  && /d\.kind !== 'contract' \|\| contractSignable\(data && data\.contract\)/.test(html));

console.log('\ncontract signing answers (portal-server handoff)');
const signHandler = html.slice(html.indexOf("var target = ev.target.closest('[data-action=\"sign-contract\"]');"), html.indexOf('function showContractSignNote('));
ok('{ok, already:true} reads "Already signed" — no confetti, no reload loop',
  /res && res\.already === true\) \{\s*showContractSignNote\(target, 'Already signed[^']*'\);\s*refreshPortalSnapshot\(\);\s*return;/.test(signHandler));
ok('a new signature re-reads the portal instead of window.location.reload()', !/window\.location\.reload\(\)/.test(signHandler) && /refreshPortalSnapshot\(\)/.test(signHandler));
ok('sign_denied on a contract the fresh snapshot shows signed reads "This contract is already signed"',
  /fc\.id === contractId && fc\.status === 'signed'\) \{\s*alert\('This contract is already signed\.'\)/.test(signHandler));

console.log('\n#70 — client-view opens the sealed PDF through the signed-URL helper');
ok('the contract row routes through downloadSealedContractPdf (contract.userId folder)',
  /downloadSealedContractPdf\(\{ contract, userId: contract\.userId, supabase \}\)/.test(view)
  && /onPress=\{\(\) => \{ void openDocument\(doc\); \}\}/.test(view) && !/Linking\.openURL\(doc\.fileUrl!\)/.test(view));
ok('client-view\'s in-person CO decision carries the send stamp portal_co_send_stamp computes',
  /send_stamp: approvalCO\.portalState\s*\? `\$\{approvalCO\.portalState\.sentVersion \?\? 0\}@\$\{approvalCO\.portalState\.sentAt \?\? ''\}`\s*: 'unsent'/.test(view));

// ═══ #137 — after a Pay tap ═════════════════════════════════════════════════
console.log('\n#137 — the Pay return');
const renderStart = html.indexOf('  function render(data) {');
const renderEnd = html.indexOf('\n  }\n', renderStart);
const renderBody = html.slice(renderStart, renderEnd);
const moduleOnly = html.slice(0, renderStart) + html.slice(renderEnd);
ok('ONE module-scope visibilitychange/pageshow handler (not inside render)',
  /document\.addEventListener\('visibilitychange', onPayReturn\);/.test(moduleOnly)
  && /window\.addEventListener\('pageshow', onPayReturn\);/.test(moduleOnly)
  && !/onPayReturn/.test(renderBody.replace(/startPayPolls/g, '')));
ok('render() adds no raw document listeners; survivors go through onRender and are torn down first',
  !/document\.addEventListener\(/.test(renderBody) && /runRenderCleanups\(\);/.test(renderBody.slice(0, 200))
  && /renderCleanups\.push\(function \(\) \{ clearInterval\(liveTimer\); \}\);/.test(renderBody));
ok('the hero progress bar is replaced, not stacked, on a re-render',
  /var oldProgress = document\.getElementById\('hero-progress'\);\s*if \(oldProgress\) oldProgress\.remove\(\);/.test(renderBody));
expect('polls at ~0 / 3 / 8 / 20 s', /var PAY_POLL_DELAYS_MS = (\[[^\]]*\]);/.exec(html)?.[1], '[0, 3000, 8000, 20000]');
ok('both Pay buttons (invoice and AIA) remember the tap and show "Checking your payment…"',
  (html.match(/notePayTap\('invoice', btn\.getAttribute\('data-pay-id'\)\);\s*btn\.outerHTML = payCheckingHtml\(\);/g) ?? []).length === 1
  && (html.match(/notePayTap\('aia', btn\.getAttribute\('data-pay-id'\)\);\s*btn\.outerHTML = payCheckingHtml\(\);/g) ?? []).length === 1);
const payCode = [
  liftVar(html, 'PAY_RETURN_WINDOW_MS'),
  'var pendingPay = null; var payNotSeen = {};',
  liftFn(html, 'payChecking'), liftFn(html, 'paySettledIn'),
  'const api = { payChecking, paySettledIn, set: function (p) { pendingPay = p; }, notSeen: payNotSeen };',
].join('\n');
const pay = runJs<{
  payChecking: (k: string, id: string) => boolean; paySettledIn: (s: unknown, p: unknown) => boolean;
  set: (p: unknown) => void; notSeen: Record<string, boolean>;
}>(payCode, 'api');
pay.set({ kind: 'invoice', id: 'inv-1', at: Date.now() });
ok('payChecking: the tapped card waits', pay.payChecking('invoice', 'inv-1') && !pay.payChecking('invoice', 'inv-2') && !pay.payChecking('aia', 'inv-1'));
pay.notSeen['inv-1'] = true;
ok('…until the last poll saw nothing (the button comes back)', !pay.payChecking('invoice', 'inv-1'));
const tap = { kind: 'invoice', id: 'inv-1' };
ok('still owing → NOT settled (never "Paid" on a guess)',
  !pay.paySettledIn({ sections: { invoices: [{ id: 'inv-1', balance: 4200, status: 'sent' }] } }, tap));
ok('the overlay says paid / balance 0 / bank processing → settled',
  pay.paySettledIn({ sections: { invoices: [{ id: 'inv-1', balance: 0, effectiveStatus: 'paid' }] } }, tap)
  && pay.paySettledIn({ sections: { invoices: [{ id: 'inv-1', balance: 4200, paymentProcessing: { since: 'x', amount: 4200 } }] } }, tap));
ok('AIA: paidAt or processing settles; otherwise it waits',
  pay.paySettledIn({ sections: { aiaPayApps: [{ id: 'a1', paidAt: '2026-09-21' }] } }, { kind: 'aia', id: 'a1' })
  && !pay.paySettledIn({ sections: { aiaPayApps: [{ id: 'a1' }] } }, { kind: 'aia', id: 'a1' }));
ok('the page never writes "Paid" from the tap itself (only the overlay\'s status drives it)',
  !/pendingPay[^\n]*Paid/.test(html) && !/payChecking[^\n]*'Paid'/.test(html));
ok('#83/#135 a bank payment in flight reads "Bank payment of $X processing since <date>" and offers no Pay',
  /'Bank payment' \+ \(amt \? ' of ' \+ amt : ''\) \+ ' processing' \+ \(pp\.since \? ' since ' \+ fmtDate\(pp\.since\) : ''\)/.test(html)
  && /var canPay = i\.payLinkUrl && !isPaid && balance > 0 && !processing;/.test(html)
  && /var canPay = aiaCanPay\(a\) && !aiaProcessing;/.test(html));

// ═══ portal-server handoff (5) — signed-media-urls ══════════════════════════
console.log('\nphotos through signed-media-urls');
const signFn = liftFn(html, 'refreshSignedPhotoUrls');
ok('the page POSTs {kind:\'portal_photos\', portalId, token, photoIds} — and NO passcode',
  /\/functions\/v1\/signed-media-urls/.test(signFn)
  && /JSON\.stringify\(\{ kind: 'portal_photos', portalId: portalId, token: token, photoIds: ids \}\)/.test(signFn)
  && !/passcode/i.test(signFn));
ok('a 401 or a missing id hides the image (after the call answers)',
  /if \(r\.status === 401\) \{ signedPhotoUrls = \{\}; return null; \}/.test(signFn)
  && /if \(photoSignSettled\) hidePhotoEl\(img\);/.test(html));
const photoCode = [
  liftFn(html, 'esc'), 'var signedPhotoUrls = {};',
  liftFn(html, 'legacyPhotoUrl'), liftFn(html, 'photoSrc'), liftFn(html, 'photoImgAttrs'),
  'const api = { photoSrc, photoImgAttrs, urls: function (u) { signedPhotoUrls = u; } };',
].join('\n');
const photo = runJs<{ photoSrc: (p: unknown) => string; photoImgAttrs: (p: unknown) => string; urls: (u: Record<string, string>) => void }>(photoCode, 'api');
expect('photoSrc never returns a file: url', photo.photoSrc({ id: 'X', url: 'file:///var/IMG.jpg' }), '');
photo.urls({ x: 'https://signed/x' });
expect('photoSrc prefers the signed url by id (case-insensitive)', photo.photoSrc({ id: 'X', url: 'https://old/x' }), 'https://signed/x');
ok('every photo <img> is drawn through photoImgAttrs (renderPhotos, activity, lightbox, ask-refs)',
  /'<img loading="lazy"'\+photoImgAttrs\(p\)/.test(html) && /photoImgAttrs\(e\.thumbPhoto\)/.test(html)
  && /lbImg\.src = photoSrc\(p\);/.test(html) && /return photoSrc\(photos\[i\]\);/.test(html)
  && !/src="'\+esc\(p\.url\)/.test(html) && !/thumbUrl: p\.url/.test(html));
ok('the hero is set from heroPhotoId / an http url only', /photoSrc\(\{ id: proj\.heroPhotoId, url: proj\.heroPhotoUrl \}\)/.test(html)
  && !/'url\(' \+ project\.heroPhotoUrl \+ '\)'/.test(html));

// ═══ CO decisions (portal-server handoff 2) ═════════════════════════════════
console.log('\nCO decisions render from the snapshot');
ok('renderChangeOrders reads the overlay\'s clientDecision (localStorage only supplies this device\'s hash)',
  /var decided = coDecisionFor\(c\);/.test(html) && /var cd = c\.clientDecision;/.test(html) && !/var locallyDecided = loadCODecision\(c\.id\);/.test(html));
ok('recorded:false reads "Already decided on another device: <decision> by <signer>", no confetti',
  /'Already decided on another device: ' \+ word \+ \(d\.signer \? ' by ' \+ d\.signer : ''\)/.test(html)
  && /if \(res\.recorded === false\) \{[\s\S]{0,700}refreshPortalSnapshot\(\);\s*return;\s*\}/.test(html));
ok('the legacy RPC\'s answer is passed through too', /if \(legacyRes && legacyRes\.recorded === false\) return legacyRes;/.test(html));

// ═══ carry #72 + portal-server — the reconciler ═════════════════════════════
console.log('\ncarry #72 — the reconciler: conflict rule + Client approver stamp');
type Plan = (row: Record<string, unknown>, status: string | undefined, trail: COAuditEntry[], co?: { approvers?: COApprover[]; sentAt?: string }) =>
  { entry: COAuditEntry | null; status: string | null; approvers: COApprover[] | null };
const plan = runJs<Plan>(liftFn(hook, 'planPortalApproval'), 'planPortalApproval');
const rowA = { id: 'aaaaaaaa-0000-0000-0000-000000000001', decision: 'approved', signer_name: 'Jane', signer_email: null, note: null, created_at: '2026-09-20T12:00:00Z' };
const rowB = { id: 'bbbbbbbb-0000-0000-0000-000000000002', decision: 'declined', signer_name: 'Joe', signer_email: null, note: 'Too much', created_at: '2026-09-20T12:05:00Z' };
const sealA: COAuditEntry = { id: rowA.id, action: 'client_signed_via_portal', actor: 'Jane', timestamp: '2026-09-20T12:00:00Z', detail: 'record SHA-256 ab' };
const sealB: COAuditEntry = { id: rowB.id, action: 'client_declined_via_portal', actor: 'Joe', timestamp: '2026-09-20T12:05:00Z' };
const approvers: COApprover[] = [
  { id: 'ap1', name: 'Client', email: 'c@x', role: 'Client', required: true, order: 1, status: 'pending' },
  { id: 'ap2', name: 'Arch', email: 'a@x', role: 'Architect', required: false, order: 2, status: 'pending' },
];
const sent = { approvers, sentAt: '2026-09-20T09:00:00Z' };
const pA = plan(rowA, 'submitted', [sealA], sent);
ok('own sealed entry → not a conflict: status flips, portal_decision_applied', pA.status === 'approved' && pA.entry?.action === 'portal_decision_applied'
  && /^Status set to Approved/.test(pA.entry?.detail ?? ''));
ok('#72 the pending Client approver is stamped in the same plan (status, signer, responseDate)',
  pA.approvers?.[0].status === 'approved' && pA.approvers?.[0].name === 'Jane' && pA.approvers?.[0].responseDate === rowA.created_at
  && pA.approvers?.[1].status === 'pending');
const pB = plan(rowB, 'approved', [sealA, sealB, pA.entry!], sent);
ok('another row\'s sealed decision for THIS send → portal_decision_conflict, no flip, no approver stamp',
  pB.entry?.action === 'portal_decision_conflict' && pB.status === null && pB.approvers === null
  && pB.entry?.id === 'audit-portal-bbbbbbbb' && /confirm with your client/.test(pB.entry?.detail ?? ''));
const pB2 = plan(rowB, 'approved', [sealB, { id: 'audit-portal-aaaaaaaa', action: 'approved_via_portal', actor: 'Jane', timestamp: '2026-09-20T12:00:00Z' }], sent);
ok('another row\'s applied key (legacy path) is a conflict too', pB2.entry?.action === 'portal_decision_conflict' && pB2.status === null);
const resent = plan(rowB, 'submitted', [sealA, sealB], { approvers, sentAt: '2026-09-20T12:02:00Z' });
ok('an answer to an EARLIER send (a revised, re-sent CO) is not a conflict', resent.entry?.action === 'portal_decision_applied' && resent.status === 'rejected');
ok('a decline stamps rejectionReason with the note', resent.approvers?.[0].status === 'rejected' && resent.approvers?.[0].rejectionReason === 'Too much');
ok('the reconciler writes the approvers in the SAME updateChangeOrder patch, deferReflow kept',
  /updateChangeOrder\(co\.id, \{ status: wantedStatus, auditTrail, approvers \}, \{ deferReflow: true \}\)/.test(hook)
  && /updateChangeOrder\(co\.id, \{ status: wantedStatus, auditTrail \}, \{ deferReflow: true \}\)/.test(hook)
  && /sentAt: co\.portalState\?\.sentAt/.test(hook));
ok('CONTRACT 7 audit strings unchanged', /action: 'portal_decision_applied'/.test(hook)
  && /`Status set to \$\{statusWord\} from the client's signed portal decision\.`/.test(hook)
  && /'approved_via_portal' : 'declined_via_portal'/.test(hook) && /action: 'portal_decision_conflict'/.test(hook));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
