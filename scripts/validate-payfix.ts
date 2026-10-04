// scripts/validate-payfix.ts — lane PAYFIX: legal/money document correctness
// and AIA copyright, before MAGE ID's first App Store build.
//
//   1. The G702 certificate carries no AIA-verbatim sentence: the closing
//      clause, the architect's paragraph, the initial-the-changed-figures note
//      and the change-order summary rows are MAGE's own plain words, and still
//      say the same thing (payable only to the named contractor, cannot be
//      signed over, no rights given up).
//   2. In-app labels say "AIA-style" — never imply an official AIA document or
//      promise what a lender accepts. Identifiers (the paywall feature key)
//      and the files other lanes own are on a named, counted list, so a NEW
//      unhedged label fails here.
//   3. The CO copilot never turns "field condition" (or anything it did not
//      hear as one) into "client request"; its example to the model offers no
//      reason; the CO screen labels field condition as itself.
//   4. G702 line 1 and the change order's "Original contract sum" read the
//      SIGNED contract; the estimate is the fallback only when nothing is
//      signed, and the SCREEN says so. The PDF prints no source note at all.
//   5. The G702 header (owner name, contract date, architect) carries forward
//      from the previous period, or comes from the contract / project on a
//      first period. A free-text contract date is carried verbatim.
//   6. THE UNANSWERED READ (fix round 1). A contract read that has not
//      answered (offline, failed, timed out, still loading) never changes a
//      figure already on the document and is never described as "no signed
//      contract". One pure rule (utils/projectFinancials contractSumBasis) and
//      one pure read (watchContractRead), used by both screens; both are
//      executed here, and the screens are pinned to them.
//   7. FIX ROUND 2. The step from a screen's read state to the value the rule
//      takes is one helper too (contractOfRead) — executed here, and the
//      pay-app screen is pinned to it, so "not read" cannot be turned into
//      "none on file" in a screen's own wiring. The change order's stamped base
//      has one source. A figure MAGE could not check is emailed to a client
//      only after the contractor is asked.
//
// Run: bun run scripts/validate-payfix.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  buildAIAPayAppHtml,
  seedAIAPayApplicationFromInvoice,
  mergeRefreshedContract,
  payAppContractSumSource,
  payAppLineOneView,
  applyContractAnswerToLineOne,
  refreshLineOneNotice,
  applicationFromSavedRecord,
  seedPayAppHeader,
  PAY_APP_CONTRACT_SUM_LABEL,
  PAY_APP_CONTRACT_SUM_SHORT,
  type PayAppContractSumSource,
} from '../utils/aiaBilling';
import {
  contractSumBasis, contractSumView, contractReadOutcome, nextContractRead, watchContractRead,
  contractOfRead, uncheckedContractSumSendNotice,
  savedChangeOrderOriginalSum, resolveContractSum,
  CONTRACT_SUM_BASIS_LABEL, CONTRACT_READ_TIMEOUT_MS, CONTRACT_READ_PENDING_REASON,
  type ContractSumBasis,
} from '../utils/projectFinancials';
import { coReasonCode, changeOrderCapability } from '../utils/copilot/changeOrder/coCapability';
import { PAY_APP_TYPE_TAG, documentTypeLabel } from '../utils/registers/documentRows';
import type { ChangeOrder, Invoice, Project, SavedAIAPayApp } from '../types';

// The header test needs a contract signed on one LOCAL day and the next UTC
// day: New York, set before any Date is formatted.
process.env.TZ = 'America/New_York';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
function eq<T>(name: string, got: T, want: T) {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  ok(name, g === w, `got ${g}, want ${w}`);
}
const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const count = (text: string, re: RegExp) => (text.match(re) ?? []).length;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ── Fixtures ────────────────────────────────────────────────────────────────
const project = {
  id: 'p1', name: 'Henderson Kitchen', status: 'in_progress', location: 'Huntington, NY',
  description: 'Kitchen remodel',
  linkedEstimate: { grandTotal: 100_000, items: [] },
  primaryContact: { name: 'Dana Henderson' },
} as unknown as Project;
const invoice = {
  id: 'inv-1', number: 1, projectId: 'p1', type: 'progress',
  issueDate: '2026-05-31', dueDate: '2026-06-30', paymentTerms: 'net_30', notes: '',
  lineItems: [{ id: 'l1', name: 'Demo', description: '', quantity: 1, unit: 'ls', unitPrice: 20_000, total: 20_000 }],
  subtotal: 20_000, taxRate: 0, taxAmount: 0, totalDue: 20_000, amountPaid: 0,
  status: 'sent', payments: [], retentionPercent: 10,
  createdAt: '2026-05-31', updatedAt: '2026-05-31',
} as unknown as Invoice;
const branding = { companyName: 'Majeed Builders' } as never;
// Signed at 10:30 pm New York time on April 1 — which is April 2 in UTC. A
// header date taken from the UTC slice of this instant is a day late.
const SIGNED_AT = '2026-04-02T02:30:00.000Z';
const signed = {
  status: 'signed', contractValue: 92_500, signedAt: SIGNED_AT,
  homeownerSignature: { name: 'Dana R. Henderson', signedAt: SIGNED_AT },
};
const approvedCO = { id: 'co-1', number: 1, status: 'approved', changeAmount: 4_000, approvedAt: '2026-05-10' } as unknown as ChangeOrder;

const src = {
  aia: read('utils/aiaBilling.ts'),
  fin: read('utils/projectFinancials.ts'),
  pay: read('app/aia-pay-app.tsx'),
  co: read('app/change-order.tsx'),
  cap: read('utils/copilot/changeOrder/coCapability.ts'),
};

// ── 1. No AIA-verbatim document text ────────────────────────────────────────
console.log('\n1. The certificate is in MAGE’s own words');
{
  const app = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed });
  const html = buildAIAPayAppHtml({ ...app, amountCertified: 18_000 }, branding);
  // Sentences (and near-verbatim paraphrases) of AIA's published G702.
  const AIA_VERBATIM: RegExp[] = [
    /This Certificate is not negotiable/i,
    /payable only to the Contractor named herein/i,
    /without prejudice to any rights of the Owner or Contractor/i,
    /Issuance, payment and acceptance of payment/i,
    /on the basis of (on-)?site observations/i,
    /data comprising (this|the) application/i,
    /certifies to the Owner that/i,
    /knowledge, information and belief/i,
    /Initial (all|every) figures? on this Application/i,
    /changed to (conform|match) (with )?the amount certified/i,
    /Attach (an )?explanation if (the )?amount certified differs/i,
    /Total changes approved in previous months by Owner/i,
    /Total approved this month/i,
    /has been completed in accordance with the Contract Documents/i,
    /all amounts have been paid by the Contractor/i,
  ];
  for (const re of AIA_VERBATIM) {
    ok(`the printed G702 does not carry /${re.source}/`, !re.test(html));
    ok(`…nor does utils/aiaBilling.ts anywhere`, !re.test(src.aia));
  }
  // The meaning survived the rewrite.
  ok('the closing clause: only the named contractor can be paid the AMOUNT CERTIFIED',
    /Only the Contractor named on this page can be paid the AMOUNT CERTIFIED/.test(html));
  ok('…the certificate cannot be signed over (the old "not negotiable")',
    /cannot be signed over or transferred to anyone else/.test(html));
  ok('…and issuing, paying or accepting it gives up no right of either party',
    /does not give up any right the Owner or the Contractor has under their contract/.test(html));
  ok('the architect’s paragraph is in the house style (“By signing below, the Architect…”)',
    /By signing below, the Architect tells the Owner/.test(html));
  ok('…still certifying progress, conformance and the AMOUNT CERTIFIED',
    /the work has reached the stage shown/.test(html) && /meets the Contract Documents/.test(html)
    && /should be paid the AMOUNT CERTIFIED/.test(html));
  ok('the change-the-figures note still asks for a reason and initials',
    /attach a note saying why/.test(html) && /put your initials beside each figure/.test(html));
  ok('the contractor’s paragraph (rewritten earlier) is untouched',
    /By signing below, the Contractor states that, so far as the Contractor knows and believes/.test(html));
  ok('the AIA trademark notice still prints', /registered trademarks of The American Institute of Architects/.test(html));
  ok('the form still names itself AIA-Style', /AIA-Style Document G702/.test(html) && /AIA-Style Document G703/.test(html));
}

// ── 2. Labels say AIA-style ─────────────────────────────────────────────────
console.log('\n2. Labels never imply an official AIA document');
{
  // "pay app", "payapp", "pay-app", any capitalisation: one hyphen used to be
  // enough to slip an unhedged label past this (fix round 2).
  const UNHEDGED = /AIA (G70[23]|[Pp][Aa][Yy][\s-]?[Aa][Pp][Pp][Ss]?\b|[Pp]ay [Aa]pplications?|billing|Billing)/;
  const SELF_TEST: [string, boolean][] = [
    ["label: 'AIA pay app'", true], ["label: 'AIA pay apps'", true], ["label: 'AIA payapp'", true],
    ["label: 'AIA pay-app'", true], ["label: 'AIA pay-apps'", true], ["label: 'AIA Pay-App cadence'", true],
    ["label: 'AIA PAY APP'", true], ["label: 'AIA Pay Application'", true], ["label: 'AIA G702'", true],
    ["label: 'AIA Billing'", true], ["label: 'AIA-style pay-app'", false], ["label: 'AIA-style G702/G703'", false],
    ["label: 'Pay app'", false], ["// AIA pay-app in a comment", false],
  ];
  const userFacingHits = (text: string): string[] => text.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter(l => UNHEDGED.test(l.replace(/AIA-style|AIA-Style|AIA-STYLE/g, '')))
    .filter(l => !/styled after AIA/.test(l));
  const wrong = SELF_TEST.filter(([line, hit]) => (userFacingHits(line).length === 1) !== hit).map(([line]) => line);
  ok('the label check sees every spelling of an unhedged pay app (spaced, joined, hyphenated, any case)', wrong.length === 0, wrong.join(' | '));

  // Every file this lane swept is clean, and says the hedged words.
  const SWEPT: [string, RegExp, string][] = [
    ['app/invoice.tsx', /Generate AIA-style G702\/G703/, 'the invoice CTA'],
    ['app/documents.tsx', /AIA-style G702 · App #\$\{a\.applicationNumber\}/, 'the documents feed title'],
    ['components/CreateMenu.tsx', /subtitle: 'Bill the next draw — AIA-style G702\/G703'/, 'the create-menu subtitle'],
    ['components/registers/DocumentsRegister.tsx', /submittals and AIA-style pay apps across your projects/, 'the desktop documents register meta'],
    ['constants/glossary.ts', /term: 'Pay app \(AIA-style G702\/G703\)'/, 'the glossary term'],
    ['utils/onboardingProfile.ts', /daily reports, AIA-style pay apps and AI takeoffs\./, 'the contractor role blurb'],
    ['utils/wip.ts', /LATEST saved AIA-style pay application/, 'the WIP provenance label'],
    ['utils/dataExport.ts', /aiaPayApps: 'AIA-style pay apps'/, 'the export file label'],
    ['utils/registers/documentRows.ts', /export const PAY_APP_TYPE_TAG = 'Pay app';/, 'the document type tag'],
    ['contexts/ProjectContext.tsx', /aia_pay_app: 'AIA-style pay application'/, 'the portal-send item label'],
    ['app/data-export.tsx', /label="AIA-style pay apps"/, 'the export summary line'],
  ];
  for (const [f, says, what] of SWEPT) {
    const text = read(f);
    const hits = userFacingHits(text);
    ok(`${f}: no unhedged AIA label`, hits.length === 0, hits.join(' | '));
    ok(`…and ${what} says the hedged words`, says.test(text));
  }
  ok('the invoice CTA no longer promises a "lender- and architect-ready" document', !/lender- and architect-ready/.test(read('app/invoice.tsx')));
  ok('the export README line needs no AIA word at all ("Pay apps:")',
    /lines\.push\(`  Pay apps:        \$\{payload\.aiaPayApps\.length\}`\);/.test(read('utils/dataExport.ts')));
  eq('the desktop Type column and the phone tag say "Pay app", never "AIA Billing"',
    [PAY_APP_TYPE_TAG, documentTypeLabel({ id: 'aia-1', type: 'aia_billing' } as never)], ['Pay app', 'Pay app']);
  ok('…the phone card prints that word over the mock table’s',
    /const typeLabel = doc\.type === 'aia_billing' \? PAY_APP_TYPE_TAG : typeInfo\.label;/.test(read('app/documents.tsx'))
    && /\{typeLabel\}<\/Text>/.test(read('app/documents.tsx')) && !/\{typeInfo\.label\}/.test(read('app/documents.tsx')));

  // The pay-app screen's own header: no official form, no lender promise.
  ok('the pay-app header eyebrow says "AIA-style G702 / G703"', /eyebrow="AIA-style G702 \/ G703"/.test(src.pay));
  ok('…its subtitle offers a DRAFT AIA-style pay application',
    /subtitle="Turn your % complete into a draft AIA-style pay application\./.test(src.pay));
  ok('…and no longer promises what "your client’s lender expects"',
    !/lender expects/.test(src.pay) && !/lender-ready|lender ready|bank-ready|architect-ready/i.test(src.pay));
  ok('…its glossary term is "AIA-style pay app", and says it is not the official AIA document',
    /term: 'AIA-style pay app',/.test(src.pay) && /It is not the official AIA document, and some lenders and architects require their own or the official forms\./.test(src.pay));
  // What is left in that file is the paywall feature KEY — an identifier that
  // has to keep matching components/Paywall.tsx (APPFIX renames both sides).
  const payHits = userFacingHits(src.pay);
  ok('the only unhedged AIA strings left in app/aia-pay-app.tsx are the paywall feature key (×2)',
    payHits.length === 2 && payHits.every(l => /feature="AIA G702\/G703 Pay Applications"/.test(l)), payHits.join(' | '));
  ok('…and that key is still a key of components/Paywall.tsx',
    count(read('components/Paywall.tsx'), /'AIA G702\/G703 Pay Applications':/g) === 2);

  // The ratchet. What is still unhedged, with counts — reported in the lane
  // handoff. Lowering a count is fine (update it); a new file or a higher
  // count fails.
  const KNOWN_NOT_SWEPT: Record<string, number> = {
    'app/paywall.tsx': 1, // APPFIX lane
    'components/Paywall.tsx': 2, // APPFIX lane (feature-name map key and its label)
    'app/aia-pay-app.tsx': 2, // the paywall feature key (identifier)
    'app/dev-seeder.tsx': 2, // dev-only screen
    'app/dev-flagship-seeder.tsx': 1, // dev-only screen
    'mocks/documents.ts': 2, // the tag table (app/documents.tsx prints PAY_APP_TYPE_TAG over it) and one mock document title
    // NOT in this lane's file list, and live: the "Try a sample project" picker's
    // blurb, "AIA pay-app cadence". Needs an owner (handed off in the report).
    'components/DemoSeedPickerModal.tsx': 1,
  };
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(join(__dirname, '..', dir))) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const rel = `${dir}/${name}`;
      const st = statSync(join(__dirname, '..', rel));
      if (st.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(rel);
    }
    return out;
  };
  const files = ['app', 'components', 'utils', 'constants', 'hooks', 'contexts', 'mocks', 'i18n'].flatMap(d => walk(d));
  const over: string[] = [];
  const seen: Record<string, number> = {};
  for (const f of files) {
    const n = userFacingHits(read(f)).length;
    if (n === 0) continue;
    seen[f] = n;
    const allowed = KNOWN_NOT_SWEPT[f];
    if (allowed == null || n > allowed) over.push(`${f} (${n}${allowed != null ? ` > ${allowed}` : ', new'})`);
  }
  ok('no NEW unhedged AIA label anywhere in the app (ratchet over the named list)', over.length === 0, over.join(', '));
  const byName = (r: Record<string, number>) => Object.entries(r).sort(([a], [b]) => a.localeCompare(b));
  eq('…and the named list is exact (a fixed file comes off it)', byName(seen), byName(KNOWN_NOT_SWEPT));
}

// ── 3. The CO reason the client signs is the reason that was given ─────────
console.log('\n3. Change-order reason');
{
  eq('field_condition stays field_condition', coReasonCode('field_condition'), 'field_condition');
  eq('"Field condition" (spaced, capitalised) is still field_condition', coReasonCode('Field condition'), 'field_condition');
  eq('client_request stays client_request', coReasonCode('client_request'), 'client_request');
  eq('allowance_overage stays allowance_overage', coReasonCode('allowance_overage'), 'allowance_overage');
  eq('"other" is NOT turned into client request — the box opens empty', coReasonCode('other'), '');
  eq('a missing reason is NOT client request', coReasonCode(null), '');
  eq('an empty reason is NOT client request', coReasonCode(''), '');
  eq('an unknown paraphrase is NOT client request', coReasonCode('owner changed mind maybe'), '');
  const ctx = { project, projectId: 'p1' } as never;
  const field = await changeOrderCapability.apply(
    { description: 'Extra footing at the addition', reason: 'field_condition', changeAmount: 1800, scheduleImpactDays: 2 }, ctx);
  eq('the copilot hands the CO screen field_condition for a field condition', field.params.prefillReason, 'field_condition');
  const other = await changeOrderCapability.apply(
    { description: 'Something', reason: 'other', changeAmount: null, scheduleImpactDays: null }, ctx);
  ok('…and never client_request for anything it did not hear as one', other.params.prefillReason !== 'client_request');
  ok('the CO screen labels field_condition as "Field condition"',
    /prefillReason === 'field_condition' \? 'Field condition'/.test(src.co));
  ok('the copilot’s apply() maps through coReasonCode, with no client_request default',
    /const reason = coReasonCode\(draft\.reason\);/.test(src.cap) && !/:\s*'client_request';/.test(src.cap));

  // The example the relay shows the model ("Match this exact JSON structure")
  // must not offer a reason the contractor did not give.
  const turn = changeOrderCapability.buildTurnPrompt({
    transcript: 'add a heat pump', draft: { description: null, reason: null, changeAmount: null, scheduleImpactDays: null },
    grounding: { facts: [] }, asking: null,
  } as never);
  const hint = turn.schemaHint as { reason?: unknown };
  eq('the schema example’s reason is empty — not client_request, not any reason', hint.reason, '');
  ok('…the prompt tells the model to leave the reason empty when none was given',
    /"" when they gave no reason/.test(turn.prompt) && /Never invent an\s+amount or a reason\./.test(turn.prompt.replace(/\n/g, ' ')));
  const draft = { description: 'Extra footing', reason: 'field_condition', changeAmount: null, scheduleImpactDays: null };
  eq('an empty reason from the model does not erase the reason he gave earlier',
    changeOrderCapability.mergeDraft(draft, { reason: '' }, undefined as never).reason, 'field_condition');
  eq('…a new reason still replaces it',
    changeOrderCapability.mergeDraft(draft, { reason: 'client_request' }, undefined as never).reason, 'client_request');
  eq('…and with no reason at all the draft carries none (the screen’s box opens empty)',
    coReasonCode(changeOrderCapability.mergeDraft({ ...draft, reason: null }, { reason: '' }, undefined as never).reason), '');
}

// ── 4. Line 1 / CO original sum read the signed contract ────────────────────
console.log('\n4. The signed contract is the contract sum');
{
  const withSigned = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed });
  eq('G702 line 1 is the SIGNED contract, not the estimate', withSigned.originalContractSum, 92_500);
  eq('…and its source says so', withSigned.originalContractSumSource, 'signed_contract');

  const none = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: null });
  eq('no contract on file → the estimate', none.originalContractSum, 100_000);
  eq('…labelled as the estimate', none.originalContractSumSource, 'estimate');
  eq('the estimate caption, word for word', CONTRACT_SUM_BASIS_LABEL.estimate, 'Estimate (no signed contract yet)');

  const sent = seedAIAPayApplicationFromInvoice(invoice, project, [], branding,
    { contract: { ...signed, status: 'sent' } });
  eq('a SENT (unsigned) contract is not the contract sum', sent.originalContractSum, 100_000);
  eq('…it is labelled the estimate', sent.originalContractSumSource, 'estimate');

  // A signed contract with no usable value: the estimate stands in, and the
  // caption does not claim there is no signed contract.
  for (const v of [0, -5, Number.NaN]) {
    const r = contractSumBasis(project, { status: 'signed', contractValue: v });
    eq(`a signed contract with value ${v} → the estimate, captioned "has no amount"`,
      [r.value, r.basis, CONTRACT_SUM_BASIS_LABEL[r.basis]], [100_000, 'estimate_signed_no_amount', 'Estimate (signed contract has no amount)']);
  }
  eq('…on the pay app too', payAppContractSumSource(100_000, project, { status: 'signed', contractValue: 0 }), 'estimate_signed_no_amount');

  // A reopened record (frozen before the fix) whose line 1 is the estimate
  // while a different signed contract now exists.
  eq('a saved estimate line 1 under a different signed contract says it differs',
    payAppContractSumSource(100_000, project, signed), 'estimate_not_contract');
  eq('an unprovable figure gets no label at all', payAppContractSumSource(77_777, project, signed), undefined);
  eq('a matching signed figure is the signed contract', payAppContractSumSource(92_500, project, signed), 'signed_contract');

  // An ANSWERED refresh carries the source with the figure.
  const refreshed = mergeRefreshedContract(none, withSigned);
  eq('refresh on an answered read moves line 1 to the signed figure', refreshed.originalContractSum, 92_500);
  eq('…and its label with it', refreshed.originalContractSumSource, 'signed_contract');

  eq('contractSumBasis: signed', contractSumBasis(project, signed), { value: 92_500, basis: 'signed_contract', estimateTotal: 100_000 });
  eq('contractSumBasis: none on file', contractSumBasis(project, null), { value: 100_000, basis: 'estimate', estimateTotal: 100_000 });
  eq('resolveContractSum itself is unchanged (signed wins)', resolveContractSum(project, signed).value, 92_500);

  // THE PDF PRINTS NO SOURCE NOTE — for any source, on any record.
  const everyLabel = [...new Set([...Object.values(PAY_APP_CONTRACT_SUM_LABEL), ...Object.values(PAY_APP_CONTRACT_SUM_SHORT)])];
  const sources = Object.keys(PAY_APP_CONTRACT_SUM_LABEL) as PayAppContractSumSource[];
  const leaks: string[] = [];
  for (const source of [undefined, ...sources]) {
    const html = buildAIAPayAppHtml({ ...none, originalContractSumSource: source, lineOneAwaitingContract: 100_000 }, branding);
    if (!/<td class="line-label" style="width:70%;">1\. Original Contract Sum<\/td>/.test(html)) leaks.push(`${source}: line 1 label is not bare`);
    for (const label of everyLabel) if (html.includes(label)) leaks.push(`${source}: prints "${label}"`);
    if (/no signed contract|not checked|As saved|Carried forward \(|differs from the signed/i.test(html)) leaks.push(`${source}: prints a source phrase`);
  }
  ok('the PDF prints a bare "1. Original Contract Sum" and no source words, whatever the source', leaks.length === 0, leaks.join(' | '));
  const builder = src.aia.slice(src.aia.indexOf('export function buildAIAPayAppHtml('));
  ok('…the PDF builder never reads the source or its labels',
    builder.length > 1000 && !/originalContractSumSource|lineOneAwaitingContract|PAY_APP_CONTRACT_SUM|CONTRACT_SUM_BASIS_LABEL/.test(builder));
  ok('…and the screen never hands a source to the PDF (or to anything else)',
    !/originalContractSumSource/.test(src.pay) && count(src.pay, /generateAIAPayAppPDF\(/g) === 2
    && count(src.pay, /\{ \.\.\.app, changeOrderSummary: printedCoSummary \},/g) === 2);

  ok('the CO screen no longer reads the estimate grand total for "Original contract sum"',
    !/return project\.linkedEstimate\?\.grandTotal \?\? project\.estimate\?\.grandTotal \?\? 0;/.test(src.co));
  ok('the pay-app screen passes the active contract into the seeder', /contract: activeContract,/.test(src.pay));
  ok('…and waits for the contract read to settle before seeding a NEW period',
    /if \(!savedForThisInvoice && !contractSettled\) return;/.test(src.pay));
}

// ── 5. Header carry-forward ─────────────────────────────────────────────────
console.log('\n5. The G702 header carries forward');
{
  const at = new Date(SIGNED_AT);
  ok('the fixture straddles midnight: April 1 in New York, April 2 in UTC',
    at.getDate() === 1 && at.getUTCDate() === 2, `local ${at.getDate()}, UTC ${at.getUTCDate()} (TZ ${process.env.TZ})`);
  const prior = { ownerName: 'Dana & Chris Henderson', contractDate: '2026-03-28', architectName: 'Lee Studio' };
  eq('the previous period’s header wins', seedPayAppHeader(prior, signed, project),
    { ownerName: 'Dana & Chris Henderson', contractDate: '2026-03-28', architectName: 'Lee Studio' });
  const first = seedPayAppHeader(null, signed, project);
  eq('first period: owner from the homeowner’s signing name', first.ownerName, 'Dana R. Henderson');
  eq('first period: contract date is the LOCAL day it was signed (April 1), not the UTC slice (April 2)',
    first.contractDate, '2026-04-01');
  eq('no contract: owner from the project’s primary contact', seedPayAppHeader(null, null, project).ownerName, 'Dana Henderson');
  eq('no contract: no invented contract date', seedPayAppHeader(null, null, project).contractDate, undefined);
  eq('an UNSIGNED contract supplies neither owner nor date',
    seedPayAppHeader(null, { ...signed, status: 'sent' }, project), { ownerName: 'Dana Henderson', contractDate: undefined, architectName: undefined });
  eq('a blank prior owner falls through to the contract',
    seedPayAppHeader({ ownerName: '  ', contractDate: undefined }, signed, project).ownerName, 'Dana R. Henderson');

  // The contract date is a free-text field. What he typed is what carries.
  for (const typed of ['March 28', '3/28/26', 'Mar 28, 2026', 'per contract']) {
    eq(`a free-text contract date "${typed}" is carried forward verbatim, never parsed into a date`,
      seedPayAppHeader({ ownerName: 'X', contractDate: typed }, signed, project).contractDate, typed);
  }
  eq('…a blank one falls through to the day the contract was signed',
    seedPayAppHeader({ ownerName: 'X', contractDate: '   ' }, signed, project).contractDate, '2026-04-01');

  const seeded = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed, priorHeader: prior });
  eq('the seeder carries the owner name forward', seeded.ownerName, 'Dana & Chris Henderson');
  eq('…the contract date', seeded.contractDate, '2026-03-28');
  eq('…and the architect', seeded.architectName, 'Lee Studio');
  const explicit = seedAIAPayApplicationFromInvoice(invoice, project, [], branding,
    { contract: signed, priorHeader: prior, ownerName: 'Typed Owner' });
  eq('an explicit ownerName still wins over the carry-forward', explicit.ownerName, 'Typed Owner');
  const blankStart = seedAIAPayApplicationFromInvoice(invoice, { ...project, primaryContact: undefined } as Project, [], branding);
  eq('with nothing to carry, the owner name is blank (not invented)', blankStart.ownerName, '');
  eq('…and the contract date undefined', blankStart.contractDate, undefined);
  ok('the pay-app screen hands the previous period to the seeder as the header source',
    /priorHeader: priorAIA,/.test(src.pay));
}

// ── 6. The unanswered read ──────────────────────────────────────────────────
console.log('\n6. A contract read that has not answered');
{
  const UNREAD_BASES: ContractSumBasis[] = ['estimate_unread', 'saved_unread'];

  // 6a. THE RULE (contractSumBasis): never changes a figure on the document,
  // never says "no signed contract".
  eq('nothing on the document → the estimate, "not checked"',
    contractSumBasis(project, undefined), { value: 100_000, basis: 'estimate_unread', estimateTotal: 100_000 });
  eq('a figure on the document stays, to the cent',
    contractSumBasis(project, undefined, 92_500), { value: 92_500, basis: 'saved_unread', estimateTotal: 100_000 });
  eq('…also when it equals the estimate (then it is captioned as the estimate)',
    contractSumBasis(project, undefined, 100_000), { value: 100_000, basis: 'estimate_unread', estimateTotal: 100_000 });
  const kept = [92_500, 100_000, 0.01, 250_000.55, 1_234_567.89].map(v => contractSumBasis(project, undefined, v).value);
  eq('whatever figure the document carries, an unanswered read returns exactly that figure', kept, [92_500, 100_000, 0.01, 250_000.55, 1_234_567.89]);
  const unreadBases = [undefined, null, 0, -1, Number.NaN, 92_500, 100_000, 5].map(v => contractSumBasis(project, undefined, v as number).basis);
  ok('an unanswered read is NEVER the basis "estimate" (the one captioned "no signed contract yet")',
    unreadBases.every(b => UNREAD_BASES.includes(b)), unreadBases.join(', '));
  ok('…and neither unread caption contains the words "no signed contract"',
    UNREAD_BASES.every(b => !/no signed contract/i.test(CONTRACT_SUM_BASIS_LABEL[b]) && /signed contract not checked/.test(CONTRACT_SUM_BASIS_LABEL[b])));
  eq('the unread captions, word for word', UNREAD_BASES.map(b => CONTRACT_SUM_BASIS_LABEL[b]),
    ['Estimate (signed contract not checked)', 'As saved (signed contract not checked)']);
  eq('an ANSWER outranks a stale figure: signed', contractSumBasis(project, signed, 55_000).value, 92_500);
  eq('…and "none on file" is the estimate, captioned as such', contractSumBasis(project, null, 55_000), { value: 100_000, basis: 'estimate', estimateTotal: 100_000 });

  // 6b. THE READ (contractReadOutcome / watchContractRead / nextContractRead).
  eq('outcome: a sample job has no server contract → null', contractReadOutcome({ kind: 'sample' }), null);
  eq('outcome: a row', contractReadOutcome({ kind: 'loaded', result: { ok: true, contract: signed } }), signed);
  eq('outcome: read ok, none on file → null', contractReadOutcome({ kind: 'loaded', result: { ok: true, contract: null } }), null);
  eq('outcome: a FAILED read is not "none" → undefined', contractReadOutcome({ kind: 'loaded', result: { ok: false } }), undefined);
  eq('…even when the failed result carries a null contract', contractReadOutcome({ kind: 'loaded', result: { ok: false, contract: null } }), undefined);
  eq('outcome: offline → undefined', contractReadOutcome({ kind: 'offline' }), undefined);
  eq('outcome: timeout → undefined', contractReadOutcome({ kind: 'timeout' }), undefined);
  eq('outcome: a thrown read → undefined', contractReadOutcome({ kind: 'threw' }), undefined);
  eq('the wait is bounded at 6 seconds', CONTRACT_READ_TIMEOUT_MS, 6000);

  type Row = typeof signed;
  const run = async (o: { sample?: boolean; offline?: boolean; load: () => Promise<{ ok: boolean; contract?: Row | null }>; timeoutMs?: number; waitMs?: number }) => {
    const settles: (Row | null | undefined)[] = [];
    let calls = 0;
    const cancel = watchContractRead<Row>({
      sample: !!o.sample, offline: !!o.offline, timeoutMs: o.timeoutMs,
      load: () => { calls++; return o.load(); },
      onSettle: c => settles.push(c),
    });
    await sleep(o.waitMs ?? 15);
    cancel();
    return { settles, calls };
  };
  eq('watch: a sample job settles null at once and never calls the loader',
    await run({ sample: true, load: async () => ({ ok: true, contract: signed }) }), { settles: [null], calls: 0 });
  const off = await run({ offline: true, load: async () => ({ ok: true, contract: signed }) });
  ok('watch: offline settles "not read" at once and never calls the loader',
    off.settles.length === 1 && off.settles[0] === undefined && off.calls === 0, JSON.stringify(off));
  eq('watch: a row', (await run({ load: async () => ({ ok: true, contract: signed }) })).settles, [signed]);
  eq('watch: none on file', (await run({ load: async () => ({ ok: true, contract: null }) })).settles, [null]);
  const failed = await run({ load: async () => ({ ok: false }) });
  ok('watch: a failed read settles "not read", never null', failed.settles.length === 1 && failed.settles[0] === undefined, JSON.stringify(failed));
  const rejected = await run({ load: () => Promise.reject(new Error('network')) });
  ok('watch: a rejected read settles "not read"', rejected.settles.length === 1 && rejected.settles[0] === undefined, JSON.stringify(rejected));
  const threw = await run({ load: () => { throw new Error('sync'); } });
  ok('watch: a loader that throws settles "not read"', threw.settles.length === 1 && threw.settles[0] === undefined, JSON.stringify(threw));
  const slow = await run({ timeoutMs: 20, waitMs: 120, load: () => sleep(60).then(() => ({ ok: true, contract: signed })) });
  ok('watch: no answer in time settles "not read" — and the LATE answer is still delivered',
    slow.settles.length === 2 && slow.settles[0] === undefined && slow.settles[1] === signed, JSON.stringify(slow));
  const hung = await run({ timeoutMs: 20, waitMs: 60, load: () => new Promise(() => {}) });
  ok('watch: a hung request settles "not read" at the timeout', hung.settles.length === 1 && hung.settles[0] === undefined, JSON.stringify(hung));
  const cancelled: unknown[] = [];
  watchContractRead<Row>({ sample: false, offline: false, timeoutMs: 20, load: () => sleep(30).then(() => ({ ok: true, contract: signed })), onSettle: c => cancelled.push(c) })();
  await sleep(60);
  eq('watch: a cancelled read reports nothing', cancelled, []);

  const answered = nextContractRead(null, 'p1', signed);
  ok('an answer already held is not replaced by "not read" (a device that drops offline keeps it)',
    nextContractRead(answered, 'p1', undefined) === answered);
  eq('…a "not read" is replaced by the answer', nextContractRead({ projectId: 'p1', contract: undefined }, 'p1', signed).contract, signed);
  eq('…and another project’s answer never stands in', nextContractRead(answered, 'p2', undefined), { projectId: 'p2', contract: undefined });

  // 6c. WHAT A SCREEN SHOWS (contractSumView): no caption, and not settled,
  // until the read for THIS project has reported.
  const loading = contractSumView(project, null, 'p1');
  eq('still loading: no caption, not settled', [loading.caption, loading.settled, loading.value], [null, false, 100_000]);
  const otherProject = contractSumView(project, { projectId: 'p2', contract: null }, 'p1');
  eq('another project’s read is not this project’s: no caption, not settled', [otherProject.caption, otherProject.settled], [null, false]);
  eq('still loading over a saved figure: the figure stays, uncaptioned', (r => [r.value, r.caption, r.settled])(contractSumView(project, null, 'p1', 92_500)), [92_500, null, false]);
  eq('settled, none on file', (r => [r.value, r.caption, r.settled])(contractSumView(project, { projectId: 'p1', contract: null }, 'p1')),
    [100_000, 'Estimate (no signed contract yet)', true]);
  eq('settled, signed', (r => [r.value, r.caption])(contractSumView(project, { projectId: 'p1', contract: signed }, 'p1', 100_000)),
    [92_500, 'Signed contract']);
  eq('settled, not read, new document', (r => [r.value, r.caption])(contractSumView(project, { projectId: 'p1', contract: undefined }, 'p1')),
    [100_000, 'Estimate (signed contract not checked)']);
  eq('settled, not read, saved document: the saved figure and "As saved"',
    (r => [r.value, r.caption])(contractSumView(project, { projectId: 'p1', contract: undefined }, 'p1', 92_500)),
    [92_500, 'As saved (signed contract not checked)']);
  ok('the Save / Send hold says why, in plain words',
    /still checking whether this job has a signed contract/.test(CONTRACT_READ_PENDING_REASON) && /Try again in a few seconds\./.test(CONTRACT_READ_PENDING_REASON));
  ok('…and does not speak as if a signed contract exists ("this job’s signed contract")', !/job’s signed contract|job's signed contract/.test(CONTRACT_READ_PENDING_REASON));

  // 6d. THE CHANGE ORDER. The figure a saved CO was built on.
  eq('saved CO: stored base less the approved changes frozen with it', savedChangeOrderOriginalSum({ originalContractValue: 96_500, priorApprovedChangesTotal: 4_000 }, 9_999), 92_500);
  eq('…the live prior changes for a record saved before they were frozen', savedChangeOrderOriginalSum({ originalContractValue: 96_500 }, 4_000), 92_500);
  eq('…a new CO has none', savedChangeOrderOriginalSum(null, 4_000), null);
  eq('…nor a record with no usable base', [savedChangeOrderOriginalSum({ originalContractValue: 0 }, 0), savedChangeOrderOriginalSum({ originalContractValue: Number.NaN }, 0)], [null, null]);
  eq('a saved CO built on the signed $92,500, reopened with no answer: the row stays $92,500',
    contractSumView(project, { projectId: 'p1', contract: undefined }, 'p1',
      savedChangeOrderOriginalSum({ originalContractValue: 96_500, priorApprovedChangesTotal: 4_000 }, 4_000)).value, 92_500);

  // 6e. THE PAY APP — a new period seeded with no answer.
  const prior = { ownerName: 'Dana', contractDate: '2026-03-28', originalContractSum: 92_500 };
  const unreadNoPrior = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: undefined });
  eq('no answer, first period → the estimate, "not checked", and marked as waiting',
    [unreadNoPrior.originalContractSum, unreadNoPrior.originalContractSumSource, unreadNoPrior.lineOneAwaitingContract],
    [100_000, 'estimate_unread', 100_000]);
  const unreadWithPrior = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: undefined, priorHeader: prior });
  eq('no answer, later period → the PREVIOUS period’s line 1, not the estimate',
    [unreadWithPrior.originalContractSum, unreadWithPrior.originalContractSumSource, unreadWithPrior.lineOneAwaitingContract, unreadWithPrior.contractSumToDate],
    [92_500, 'carried_unread', 92_500, 96_500]);
  eq('…captioned "Carried forward", not "As saved" — nothing on a new period has been saved',
    [PAY_APP_CONTRACT_SUM_LABEL.carried_unread, PAY_APP_CONTRACT_SUM_SHORT.carried_unread],
    ['Carried forward (signed contract not checked)', 'Not checked']);
  const answeredSeed = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: signed, priorHeader: { ...prior, originalContractSum: 80_000 } });
  eq('an ANSWERED seed takes the answer, not the previous period, and is not waiting',
    [answeredSeed.originalContractSum, answeredSeed.lineOneAwaitingContract], [92_500, undefined]);
  eq('…and so does "none on file"', (a => [a.originalContractSum, a.originalContractSumSource, a.lineOneAwaitingContract])(
    seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: null, priorHeader: prior })), [100_000, 'estimate', undefined]);
  ok('the screen hands the previous period (with its line 1) to the seeder',
    /priorHeader: priorAIA,/.test(src.pay) && /priorHeader\?: \{ ownerName\?: string; contractDate\?: string; architectName\?: string; originalContractSum\?: number \} \| null;/.test(src.aia));

  // …and the answer arrives late.
  const late = applyContractAnswerToLineOne(unreadNoPrior, project, signed);
  eq('the late answer corrects line 1, its source and the contract sum to date; the wait is over',
    [late.originalContractSum, late.originalContractSumSource, late.contractSumToDate, late.lineOneAwaitingContract],
    [92_500, 'signed_contract', 96_500, undefined]);
  const lateNone = applyContractAnswerToLineOne(unreadNoPrior, project, null);
  eq('a late "none on file" keeps the estimate and can now say so', [lateNone.originalContractSum, lateNone.originalContractSumSource, lateNone.lineOneAwaitingContract], [100_000, 'estimate', undefined]);
  ok('still no answer → the very same application object', applyContractAnswerToLineOne(unreadNoPrior, project, undefined) === unreadNoPrior);
  const edited = { ...unreadNoPrior, originalContractSum: 101_500, contractSumToDate: 105_500 };
  const lateEdited = applyContractAnswerToLineOne(edited, project, signed);
  eq('a line 1 changed since the seed is NOT overwritten by the late answer',
    [lateEdited.originalContractSum, lateEdited.contractSumToDate, lateEdited.lineOneAwaitingContract], [101_500, 105_500, undefined]);
  ok('a period seeded on an answer is never touched', applyContractAnswerToLineOne(answeredSeed, project, null) === answeredSeed);
  const savedRec = { id: 'a1', projectId: 'p1', invoiceId: 'inv-1', applicationNumber: 1, applicationDate: '2026-05-31', periodTo: '2026-05-31',
    ownerName: 'Dana', contractorName: 'Majeed Builders', projectName: 'Henderson Kitchen',
    originalContractSum: 100_000, netChangeByCO: 0, contractSumToDate: 100_000, retainagePercent: 10, lessPreviousCertificates: 0,
    lines: [], savedAt: '2026-05-31T12:00:00.000Z' } as unknown as SavedAIAPayApp;
  const hydrated = applicationFromSavedRecord(savedRec);
  ok('a SAVED certificate is never touched by a contract answer (it carries no waiting mark)',
    hydrated.lineOneAwaitingContract === undefined && applyContractAnswerToLineOne(hydrated, project, signed) === hydrated);
  ok('the screen applies a late answer only through that function',
    /setApp\(prev => \(prev \? applyContractAnswerToLineOne\(prev, lineOneProjectRef\.current, activeContract\) : prev\)\);/.test(src.pay));

  // 6f. THE PAY APP — Refresh on a saved draft with no answer.
  const savedSigned = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed });
  const freshUnread = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: undefined });
  const kept1 = mergeRefreshedContract(savedSigned, freshUnread);
  eq('refresh with no answer keeps the saved line 1 and its source, and recomputes the sum to date from it',
    [kept1.originalContractSum, kept1.originalContractSumSource, kept1.netChangeByCO, kept1.contractSumToDate],
    [92_500, 'signed_contract', 4_000, 96_500]);
  const freshUnreadPrior = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: undefined, priorHeader: { originalContractSum: 80_000 } });
  eq('…also when the refresh seed carries the previous period’s figure',
    mergeRefreshedContract(savedSigned, freshUnreadPrior).originalContractSum, 92_500);
  eq('…and a saved ESTIMATE line 1 stays the estimate, too',
    mergeRefreshedContract(seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: null }), freshUnreadPrior).originalContractSum, 100_000);
  const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  eq('the confirmation says so, plainly, before he taps',
    refreshLineOneNotice(savedSigned, freshUnread, money),
    'The signed contract could not be checked just now, so the original contract sum is left as it is. Tap Refresh again later to check it.');
  const none = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: null });
  eq('…on an answered refresh it names the move',
    refreshLineOneNotice(none, savedSigned, money),
    'The original contract sum changes from $100,000.00 to $92,500.00, the figure on the signed contract.');
  eq('…and says nothing when line 1 does not move', refreshLineOneNotice(savedSigned, savedSigned, money), '');
  ok('the screen’s Refresh shows that notice and merges through mergeRefreshedContract',
    /refreshLineOneNotice\(app, fresh, n => formatMoney\(n, 2\)\)/.test(src.pay)
    && /onPress: \(\) => setApp\(prev => \(prev \? mergeRefreshedContract\(prev, fresh\) : prev\)\),/.test(src.pay));

  // 6g. THE PAY APP — what the screen says under line 1.
  const view = (lineOne: number, contract: Row | null | undefined, settled = true) =>
    payAppLineOneView(lineOne, project, settled ? { projectId: 'p1', contract } : null, 'p1');
  eq('before the read settles: nothing is claimed', view(100_000, null, false), { source: undefined, caption: null, short: null });
  eq('another project’s read claims nothing', payAppLineOneView(100_000, project, { projectId: 'p2', contract: null }, 'p1').caption, null);
  eq('no answer, line 1 is the estimate', view(100_000, undefined).caption, 'Estimate (signed contract not checked)');
  eq('no answer, line 1 is a SAVED figure', view(92_500, undefined).caption, 'As saved (signed contract not checked)');
  const carriedView = (lineOne: number, contract: Row | null | undefined, awaiting: number | undefined) =>
    payAppLineOneView(lineOne, project, { projectId: 'p1', contract }, 'p1', awaiting);
  eq('no answer, line 1 was CARRIED from the previous period onto a never-saved one',
    carriedView(92_500, undefined, 92_500), { source: 'carried_unread', caption: 'Carried forward (signed contract not checked)', short: 'Not checked' });
  eq('…a never-saved period on the estimate still says "Estimate (signed contract not checked)"',
    carriedView(100_000, undefined, 100_000).caption, 'Estimate (signed contract not checked)');
  eq('…and once the read ANSWERS the waiting mark changes no caption',
    [carriedView(92_500, signed, 92_500).caption, carriedView(100_000, null, 100_000).caption], ['Signed contract', 'Estimate (no signed contract yet)']);
  ok('with no answer the caption never says "no signed contract", whatever line 1 is',
    [0, 1, 92_500, 100_000, 77_777].every(v => !/no signed contract/i.test(view(v, undefined).caption ?? '')));
  eq('answered: none on file', view(100_000, null).caption, 'Estimate (no signed contract yet)');
  eq('answered: signed', view(92_500, signed).caption, 'Signed contract');
  eq('answered: a saved estimate under a signed contract', view(100_000, signed).caption, 'Estimate (differs from the signed contract)');

  // The desktop KPI cell: one line, so the words must fit it.
  const tokens = read('constants/designTokens.ts');
  const strip = read('components/desktop/KpiStrip.tsx');
  const gap = Number(/kpi:\s*\{ min: \d+, maxCols: \d+, gap: (\d+) \}/.exec(tokens)?.[1]);
  const pad = Number(/cell: \{\s*\.\.\.cardSurface\(t, \{ radius: 'card', pad: (\d+) \}\)/.exec(strip)?.[1]);
  const wrapBelow = Number(/export const KPI_WRAP_BELOW = (\d+);/.exec(read('utils/splitViewLayout.ts'))?.[1]);
  const sidebar = Number(/sidebar: \{ full: (\d+), rail: \d+ \}/.exec(tokens)?.[1]);
  const stripAt = src.pay.indexOf('testID="aia-g702-strip"');
  const CELLS = count(src.pay.slice(stripAt, src.pay.indexOf(']}', stripAt)), /\bkey: '/g);
  const textWidth = (stripWidth: number) => Math.floor((stripWidth - gap * (CELLS - 1)) / CELLS) - 2 * pad;
  const atLaptop = textWidth(1512 - sidebar - 2 * 16); // the screen's kpiDesktop margin is 16 a side
  const atNarrowest = textWidth(wrapBelow); // below this the strip wraps to two rows of wider cells
  const PX_PER_CHAR = 6.2; // 12 px caption text, a generous average
  eq('the layout numbers: 8 cells, 12 px gap, 12 px padding, wrap below 900', [CELLS, gap, pad, wrapBelow, sidebar], [8, 12, 12, 900, 240]);
  eq('…so a cell holds 120 px of text at a 1512 px window and 78 px at its narrowest', [atLaptop, atNarrowest], [120, 78]);
  ok('KpiStrip prints `sub` on one line (which is why the words must fit)', /<Text style=\{styles\.sub\} numberOfLines=\{1\}>/.test(strip));
  const shorts = Object.entries(PAY_APP_CONTRACT_SUM_SHORT);
  const tooLong = shorts.filter(([, w]) => w.length * PX_PER_CHAR > atNarrowest).map(([k, w]) => `${k}: "${w}" (${w.length} chars)`);
  ok(`every KPI sub-label fits the narrowest cell (${Math.floor(atNarrowest / PX_PER_CHAR)} characters)`, tooLong.length === 0, tooLong.join(', '));
  ok('…the full caption does NOT (which is why the strip has its own short words)',
    Object.values(PAY_APP_CONTRACT_SUM_LABEL).some(w => w.length * PX_PER_CHAR > atLaptop));
  eq('the short words keep the hedge: an unread contract reads "Not checked", never a bare "Estimate"',
    [PAY_APP_CONTRACT_SUM_SHORT.estimate_unread, PAY_APP_CONTRACT_SUM_SHORT.saved_unread, PAY_APP_CONTRACT_SUM_SHORT.signed_contract, PAY_APP_CONTRACT_SUM_SHORT.estimate],
    ['Not checked', 'Not checked', 'Signed', 'Estimate']);
  eq('…and there is a short word for every source', shorts.map(([k]) => k).sort(), Object.keys(PAY_APP_CONTRACT_SUM_LABEL).sort());
  ok('the KPI cell shows the short words, the G702 card the full caption',
    /label: 'Original contract', value: formatMoney\(app\.originalContractSum, 2\), sub: lineOne\.short \?\? undefined \}/.test(src.pay)
    && /\{lineOne\.caption \? \(\s*<Text style=\{styles\.sovBasisNote\} testID="aia-line1-source">\{lineOne\.caption\}<\/Text>/.test(src.pay));

  // 6h. BOTH SCREENS go through the shared read and the shared rule — and
  // carry no copy of either.
  ok('pay app: the read is watchContractRead, folded with nextContractRead',
    /return watchContractRead<ProjectContract>\(\{\s*sample: sampleJob,\s*offline,\s*load: \(\) => loadActiveContract\(contractProjectId\),\s*onSettle: contract => setContractRead\(prev => nextContractRead\(prev, contractProjectId, contract\)\),\s*\}\);/.test(src.pay));
  ok('…re-run when the device comes back online', /\}, \[contractProjectId, sampleJob, offline\]\);/.test(src.pay) && /const offline = useOffline\(\);/.test(src.pay));
  ok('…with no second read and no hand-built read state',
    count(src.pay, /loadActiveContract\(/g) === 1 && count(src.pay, /setContractRead\(/g) === 1 && !/setTimeout\([^)]*contract/i.test(src.pay));
  ok('…and the caption comes only from payAppLineOneView over that read state',
    /const lineOne = payAppLineOneView\(app\?\.originalContractSum, project, contractRead, contractProjectId, app\?\.lineOneAwaitingContract\);/.test(src.pay)
    && !/PAY_APP_CONTRACT_SUM_|CONTRACT_SUM_BASIS_LABEL|payAppContractSumSource|contractSumBasis/.test(src.pay));
  ok('CO: the read is the same watchContractRead, folded with nextContractRead',
    /return watchContractRead<SignedContractLike>\(\{\s*sample: coContractSample,\s*offline: coOffline,\s*load: \(\) => loadActiveContract\(coContractProjectId\),\s*onSettle: contract => setCoContractRead\(prev => nextContractRead\(prev, coContractProjectId, contract\)\),\s*\}\);/.test(src.co));
  ok('…re-run when the device comes back online', /\}, \[coContractProjectId, coContractSample, coOffline\]\);/.test(src.co) && /const coOffline = useOffline\(\);/.test(src.co));
  ok('…with no second read and no hand-built read state',
    count(src.co, /loadActiveContract\(/g) === 1 && count(src.co, /setCoContractRead\(/g) === 1);
  ok('CO: the row is contractSumView over that read and the figure the saved CO was built on',
    /contractSumView\(project, coContractRead, coContractProjectId,\s*savedChangeOrderOriginalSum\(existingCO, priorApprovedChanges\)\)/.test(src.co)
    && /const originalContractSum = project \? contractSum\.value : 0;/.test(src.co));
  ok('…its caption is the view’s caption (nothing until settled), under the row',
    /const contractSumCaption = project \? contractSum\.caption : null;/.test(src.co)
    && /\{contractSumCaption \? \(\s*<Text style=\{styles\.coMarginNote\} testID="co-contract-sum-source">\{contractSumCaption\}<\/Text>/.test(src.co)
    && !/CONTRACT_SUM_BASIS_LABEL|contractSumBasis\(/.test(src.co));
  ok('…and Save / Send wait, with the reason, until the read has settled',
    /const contractSumHold = project && !contractSum\.settled \? CONTRACT_READ_PENDING_REASON : null;/.test(src.co));
  const persist = src.co.slice(src.co.indexOf('const persistCO = useCallback('), src.co.indexOf('const now = new Date().toISOString();', src.co.indexOf('const persistCO = useCallback(')));
  ok('…persistCO (every save and send writes through it) refuses before it stamps anything',
    /if \(contractSumHold\) \{\s*showAlert\('Checking the signed contract', contractSumHold\);\s*return null;\s*\}/.test(persist));
  ok('…and the send path refuses before the email is built',
    count(src.co, /if \(contractSumHold\) \{ showAlert\('Checking the signed contract', contractSumHold\); return; \}/g) === 2);
  ok('both screens use ONE rule: contractSumView and payAppContractSumSource both call contractSumBasis',
    /const r = contractSumBasis\(project, contract, onDocument\);/.test(src.fin)
    && /const r = contractSumBasis\(project, contract, lineOne\);/.test(src.aia)
    && /contractSumBasis\(project, opts\?\.contract, opts\?\.priorHeader\?\.originalContractSum\)\.value\)/.test(src.aia));
}

// ── 7. Fix round 2 ──────────────────────────────────────────────────────────
console.log('\n7. From the read state to the rule, and to the client');
{
  type Row = typeof signed;
  // 7a. contractOfRead: "not read" is `undefined` on every path, never `null`.
  const of = (read: { projectId: string; contract: Row | null | undefined } | null | undefined, id: string | null | undefined) => {
    const r = contractOfRead<Row>(read, id);
    return [r.settled, r.contract === undefined ? 'NOT READ' : r.contract === null ? 'NONE ON FILE' : 'ROW'];
  };
  eq('nothing has reported yet → not settled, NOT READ', of(null, 'p1'), [false, 'NOT READ']);
  eq('…undefined read state too', of(undefined, 'p1'), [false, 'NOT READ']);
  eq('another project’s answer → not settled, NOT READ (even though that project has none on file)',
    of({ projectId: 'p2', contract: null }, 'p1'), [false, 'NOT READ']);
  eq('…and another project’s signed row is not this project’s', of({ projectId: 'p2', contract: signed }, 'p1'), [false, 'NOT READ']);
  eq('no project → not settled, NOT READ', [of({ projectId: 'p1', contract: null }, undefined), of({ projectId: 'p1', contract: null }, null), of({ projectId: '', contract: null }, '')],
    [[false, 'NOT READ'], [false, 'NOT READ'], [false, 'NOT READ']]);
  eq('settled without an answer (offline, failed, timed out) → settled, and STILL NOT READ — never "none on file"',
    of({ projectId: 'p1', contract: undefined }, 'p1'), [true, 'NOT READ']);
  eq('settled, none on file → null', of({ projectId: 'p1', contract: null }, 'p1'), [true, 'NONE ON FILE']);
  eq('settled, a row → the row', of({ projectId: 'p1', contract: signed }, 'p1'), [true, 'ROW']);
  ok('…the very row it was handed', contractOfRead<Row>({ projectId: 'p1', contract: signed }, 'p1').contract === signed);

  // What the reviewer's mutation did, end to end on the pure functions: the
  // value contractOfRead gives for a dead network, handed to the seeder,
  // leaves a saved signed line 1 alone and never says "no signed contract".
  const deadNetwork = contractOfRead<Row>({ projectId: 'p1', contract: undefined }, 'p1').contract;
  const savedSigned = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed });
  const freshDead = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: deadNetwork });
  const money = (n: number) => `$${n}`;
  eq('a dead network through contractOfRead: Refresh keeps the signed 92,500 and the seed is marked as waiting',
    [mergeRefreshedContract(savedSigned, freshDead).originalContractSum, freshDead.lineOneAwaitingContract != null], [92_500, true]);
  ok('…and the Refresh notice never says "no signed contract on file"',
    !/no signed contract/i.test(refreshLineOneNotice(savedSigned, freshDead, money)) && /could not be checked/.test(refreshLineOneNotice(savedSigned, freshDead, money)));
  // The same seed handed `null` is the bug: this is what the pins below prevent.
  const freshNull = seedAIAPayApplicationFromInvoice(invoice, project, [approvedCO], branding, { contract: null });
  eq('(for the record: `null` for a dead network WOULD move line 1 to the estimate and say there is no signed contract)',
    [mergeRefreshedContract(savedSigned, freshNull).originalContractSum, /no signed contract on file/.test(refreshLineOneNotice(savedSigned, freshNull, money))], [100_000, true]);

  // 7b. THE PAY-APP SCREEN derives nothing from its read state by hand.
  // (Counted over code lines only, so a comment can name these freely.)
  const codeOf = (text: string) => text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const payCode = codeOf(src.pay);
  const coCode = codeOf(src.co);
  ok('pay app: `contractSettled` and `activeContract` come from contractOfRead, in one line',
    /\n  const \{ settled: contractSettled, contract: activeContract \} = contractOfRead\(contractRead, contractProjectId\);\n/.test(src.pay));
  ok('…and are declared or assigned nowhere else',
    count(payCode, /\bcontractSettled\b\s*[:=](?!=)/g) === 0 && count(payCode, /\bactiveContract\b\s*=(?!=)/g) === 0
    && count(payCode, /\b(const|let|var)\s+(contractSettled|activeContract)\b/g) === 0
    && count(payCode, /contract: activeContract \}/g) === 1);
  ok('…the screen never opens the read state itself, and never defaults a contract to null',
    !/contractRead\s*(\?\.|\.|!\.|\[)/.test(payCode) && !/activeContract\s*\)?\s*(\?\?|\|\|)/.test(payCode)
    // contractRead appears three times: its useState, contractOfRead, payAppLineOneView.
    && count(payCode, /\bcontractRead\b/g) === 3 && /const \[contractRead, setContractRead\] = useState</.test(payCode));
  ok('…the seeder gets `activeContract` as it is, and so does the late answer',
    count(src.pay, /contract: activeContract,\n/g) === 1
    && count(src.pay, /applyContractAnswerToLineOne\(prev, lineOneProjectRef\.current, activeContract\)/g) === 1
    // activeContract appears six times: the line above, the seeder option and
    // its dependency, and the late-answer effect (guard, call, dependency).
    && count(payCode, /\bactiveContract\b/g) === 6
    && /\n    if \(hasSavedRecord \|\| !contractSettled \|\| activeContract === undefined\) return;\n/.test(payCode));
  ok('the two views go through contractOfRead as well (no second copy of the rule in either file)',
    /const \{ settled, contract \} = contractOfRead\(read, projectId\);\n  const r = contractSumBasis\(project, contract, onDocument\);/.test(src.fin)
    && /const \{ settled, contract \} = contractOfRead\(read, projectId\);\n  const proven = settled && typeof lineOne === 'number'\n    \? payAppContractSumSource\(lineOne, project, contract\)/.test(src.aia)
    && count(src.fin, /read\.projectId === projectId/g) === 1 && !/read!?\.(projectId|contract)/.test(src.aia));

  // 7c. THE CHANGE ORDER's stamped base has one source.
  ok('CO: `originalContractValue` is the row’s figure plus the prior approved changes, and nothing else',
    /\n  const originalContractValue = useMemo\(\n    \(\) => coRoundCents\(originalContractSum \+ priorApprovedChanges\),\n    \[originalContractSum, priorApprovedChanges\],\n  \);\n/.test(src.co)
    && count(src.co, /\b(const|let|var)\s+originalContractValue\b/g) === 1 && count(src.co, /\b(const|let|var)\s+originalContractSum\b/g) === 1);
  ok('…the screen never reaches past the row for the estimate, and never opens its read state',
    !/contractSum\.estimateTotal|effectiveEstimateTotal\(|getBaseContractValue\(|getContractValue\(|linkedEstimate\?\.grandTotal/.test(coCode)
    && !/coContractRead\s*(\?\.|\.|!\.|\[)/.test(coCode)
    && count(coCode, /\bcontractSum\.(value|caption|settled|basis)\b/g) === count(coCode, /\bcontractSum\.\w+/g)
    && /\n  const originalContractSum = project \? contractSum\.value : 0;\n/.test(coCode));
  ok('…Save stamps that base and the total built on it',
    /const committedNewTotal = coRoundCents\(originalContractValue \+ committedAmount\);/.test(src.co)
    && count(src.co, /\n\s+originalContractValue,\n\s+changeAmount: committedAmount,\n\s+newContractTotal: committedNewTotal,\n/g) === 2);
  ok('…and the client email prints the same two figures',
    /newContractTotal: coRoundCents\(originalContractValue \+ sendAmount\),/.test(src.co)
    && /\n\s+originalContractSum,\n\s+priorApprovedChangesTotal: priorApprovedChanges,\n\s+\};\n\s+const html = buildChangeOrderEmailHtml\(emailOpts\);/.test(src.co));

  // 7d. A FIGURE MAGE COULD NOT CHECK is emailed only after he is asked.
  const usd = (n: number) => `$${n.toLocaleString('en-US')}`;
  eq('not read, the estimate stands in → ask, naming the figure',
    uncheckedContractSumSendNotice('estimate_unread', 100_000, usd),
    { title: 'Signed contract not checked', message: 'MAGE ID could not check the signed contract. This change order will show $100,000 as the original contract sum. Send anyway?' });
  eq('not read, a saved figure stands → ask, naming that figure',
    uncheckedContractSumSendNotice('saved_unread', 92_500, usd)?.message,
    'MAGE ID could not check the signed contract. This change order will show $92,500 as the original contract sum. Send anyway?');
  eq('an ANSWERED basis asks nothing', (['signed_contract', 'estimate', 'estimate_signed_no_amount'] as ContractSumBasis[]).map(b => uncheckedContractSumSendNotice(b, 100_000, usd)), [null, null, null]);
  const everyBasis = Object.keys(CONTRACT_SUM_BASIS_LABEL) as ContractSumBasis[];
  eq('it asks for exactly the bases whose caption says "not checked"',
    everyBasis.filter(b => uncheckedContractSumSendNotice(b, 1, usd) != null).sort(),
    everyBasis.filter(b => /not checked/.test(CONTRACT_SUM_BASIS_LABEL[b])).sort());
  const unreadView = contractSumView(project, { projectId: 'p1', contract: undefined }, 'p1', null);
  eq('the reviewer’s case: settled, not read, new change order → the send asks about $100,000',
    [unreadView.settled, unreadView.basis, uncheckedContractSumSendNotice(unreadView.basis, unreadView.value, usd)?.message.includes('$100,000')], [true, 'estimate_unread', true]);
  ok('CO: the notice is that function over the row’s own basis and figure',
    /\(\) => \(project \? uncheckedContractSumSendNotice\(contractSum\.basis, originalContractSum, formatCurrency\) : null\),\n    \[project, contractSum\.basis, originalContractSum\],/.test(src.co));
  const sendAt = src.co.indexOf('const handleConfirmSend = useCallback(async () => {');
  const send = src.co.slice(sendAt, src.co.indexOf('const html = buildChangeOrderEmailHtml(emailOpts);', sendAt));
  const askAt = send.indexOf('if (uncheckedSumNotice && uncheckedSumAcceptedRef.current !== originalContractSum) {');
  ok('…the send asks AFTER the settle hold and BEFORE it locks the controls or builds the email',
    sendAt > 0 && askAt > 0 && send.indexOf("if (contractSumHold) { showAlert('Checking the signed contract', contractSumHold); return; }") < askAt
    && send.indexOf('if (contractSumHold)') > 0 && askAt < send.indexOf('sendingRef.current = true;') && askAt < send.indexOf('const emailOpts'));
  ok('…Cancel sends nothing; "Send anyway" records the figure he accepted and runs the send again',
    /if \(uncheckedSumNotice && uncheckedSumAcceptedRef\.current !== originalContractSum\) \{\n\s+showAlert\(uncheckedSumNotice\.title, uncheckedSumNotice\.message, \[\n\s+\{ text: 'Cancel', style: 'cancel' \},\n\s+\{ text: 'Send anyway', onPress: \(\) => \{ uncheckedSumAcceptedRef\.current = originalContractSum; confirmSendRef\.current\(\); \} \},\n\s+\]\);\n\s+return;\n\s+\}/.test(send));
  ok('…he is asked once per figure: the acceptance is set only there, and the re-run is the same send',
    count(src.co, /uncheckedSumAcceptedRef\.current = /g) === 1 && count(src.co, /confirmSendRef\.current = /g) === 1
    && /\n  confirmSendRef\.current = \(\) => \{ void handleConfirmSend\(\); \};\n/.test(src.co));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
