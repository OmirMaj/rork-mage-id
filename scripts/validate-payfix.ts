// scripts/validate-payfix.ts — lane PAYFIX: legal/money document correctness
// and AIA copyright, before MAGE ID's first App Store build.
//
//   1. The G702 certificate carries no AIA-verbatim sentence: the closing
//      clause, the architect's paragraph, the initial-the-changed-figures note
//      and the change-order summary rows are MAGE's own plain words, and still
//      say the same thing (payable only to the named contractor, cannot be
//      signed over, no rights given up).
//   2. In-app labels say "AIA-style" — never imply an official AIA document.
//      Owned files are clean; every other file with an unhedged label is on a
//      named, counted list (reported for the lanes that own them) so a NEW one
//      fails here.
//   3. The CO copilot never turns "field condition" (or anything it did not
//      hear as one) into "client request"; the CO screen labels field
//      condition as itself.
//   4. G702 line 1 and the change order's "Original contract sum" read the
//      SIGNED contract; the estimate is the fallback only when nothing is
//      signed, and it is labelled "Estimate (no signed contract yet)".
//   5. The G702 header (owner name, contract date, architect) carries forward
//      from the previous period, or comes from the contract / project on a
//      first period.
//
// Run: bun run scripts/validate-payfix.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import {
  buildAIAPayAppHtml,
  seedAIAPayApplicationFromInvoice,
  mergeRefreshedContract,
  payAppContractSumSource,
  seedPayAppHeader,
  PAY_APP_CONTRACT_SUM_LABEL,
} from '../utils/aiaBilling';
import { contractSumBasis, CONTRACT_SUM_BASIS_LABEL, resolveContractSum } from '../utils/projectFinancials';
import { coReasonCode, changeOrderCapability } from '../utils/copilot/changeOrder/coCapability';
import type { Invoice, Project } from '../types';

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
const signed = {
  status: 'signed', contractValue: 92_500, signedAt: '2026-04-02T15:30:00.000Z',
  homeownerSignature: { name: 'Dana R. Henderson', signedAt: '2026-04-02T15:30:00.000Z' },
};

// ── 1. No AIA-verbatim document text ────────────────────────────────────────
console.log('\n1. The certificate is in MAGE’s own words');
{
  const app = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed });
  const html = buildAIAPayAppHtml({ ...app, amountCertified: 18_000 }, branding);
  const src = read('utils/aiaBilling.ts');
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
    ok(`…nor does utils/aiaBilling.ts anywhere`, !re.test(src));
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
  const UNHEDGED = /AIA (G70[23]|pay ?apps?\b|Pay ?Apps?\b|pay applications?|Pay Applications?|billing|Billing)/;
  const userFacingHits = (text: string): string[] => text.split('\n')
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter(l => UNHEDGED.test(l.replace(/AIA-style|AIA-Style/g, '')))
    .filter(l => !/styled after AIA/.test(l));
  for (const f of ['app/invoice.tsx', 'app/documents.tsx']) {
    const hits = userFacingHits(read(f));
    ok(`${f}: every AIA label says "AIA-style"`, hits.length === 0, hits.join(' | '));
  }
  ok('the invoice CTA reads "Generate AIA-style G702/G703"', /Generate AIA-style G702\/G703/.test(read('app/invoice.tsx')));
  ok('…and no longer promises a "lender- and architect-ready" document', !/lender- and architect-ready/.test(read('app/invoice.tsx')));
  ok('the documents feed titles a pay app "AIA-style G702 · App #N"', /AIA-style G702 · App #\$\{a\.applicationNumber\}/.test(read('app/documents.tsx')));

  // The ratchet. Files outside this lane that still carry an unhedged label,
  // with their counts — reported in the lane handoff. Lowering a count is
  // fine (update it); a new file or a higher count fails.
  const KNOWN_OUT_OF_LANE: Record<string, number> = {
    'app/paywall.tsx': 1, // APPFIX lane
    'components/Paywall.tsx': 2, // APPFIX lane (feature-name map key)
    'app/aia-pay-app.tsx': 5, // paywall feature key ×2, header eyebrow, subtitle and glossary term (owned for item 5 only)
    'components/CreateMenu.tsx': 1,
    'components/registers/DocumentsRegister.tsx': 1,
    'constants/glossary.ts': 1,
    'utils/onboardingProfile.ts': 1,
    'utils/wip.ts': 1,
    'utils/dataExport.ts': 2,
    'utils/registers/documentRows.ts': 1,
    'contexts/ProjectContext.tsx': 1,
    'app/data-export.tsx': 1,
    'app/dev-seeder.tsx': 2, // dev-only screen
    'app/dev-flagship-seeder.tsx': 1, // dev-only screen
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
  const files = ['app', 'components', 'utils', 'constants', 'hooks', 'contexts'].flatMap(d => walk(d));
  const over: string[] = [];
  for (const f of files) {
    const n = userFacingHits(read(f)).length;
    if (n === 0) continue;
    const allowed = KNOWN_OUT_OF_LANE[f];
    if (allowed == null || n > allowed) over.push(`${f} (${n}${allowed != null ? ` > ${allowed}` : ', new'})`);
  }
  ok('no NEW unhedged AIA label anywhere in the app (ratchet over the known out-of-lane list)', over.length === 0, over.join(', '));
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
  eq('an unknown paraphrase is NOT client request', coReasonCode('owner changed mind maybe'), '');
  const ctx = { project, projectId: 'p1' } as never;
  void (async () => {
    const field = await changeOrderCapability.apply(
      { description: 'Extra footing at the addition', reason: 'field_condition', changeAmount: 1800, scheduleImpactDays: 2 }, ctx);
    eq('the copilot hands the CO screen field_condition for a field condition', field.params.prefillReason, 'field_condition');
    const other = await changeOrderCapability.apply(
      { description: 'Something', reason: 'other', changeAmount: null, scheduleImpactDays: null }, ctx);
    ok('…and never client_request for anything it did not hear as one', other.params.prefillReason !== 'client_request');
    finishAsync();
  })();
  const co = read('app/change-order.tsx');
  ok('the CO screen labels field_condition as "Field condition"',
    /prefillReason === 'field_condition' \? 'Field condition'/.test(co));
  const cap = read('utils/copilot/changeOrder/coCapability.ts');
  ok('the copilot’s apply() maps through coReasonCode, with no client_request default',
    /const reason = coReasonCode\(draft\.reason\);/.test(cap) && !/:\s*'client_request';/.test(cap));
}

// ── 4. Line 1 / CO original sum read the signed contract ────────────────────
console.log('\n4. The signed contract is the contract sum');
{
  const withSigned = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: signed });
  eq('G702 line 1 is the SIGNED contract, not the estimate', withSigned.originalContractSum, 92_500);
  eq('…and its source says so', withSigned.originalContractSumSource, 'signed_contract');
  const htmlSigned = buildAIAPayAppHtml(withSigned, branding);
  ok('…the PDF prints no fallback note beside a signed line 1',
    /1\. Original Contract Sum<\/td>/.test(htmlSigned) && /\$ 92,500\.00/.test(htmlSigned));

  const none = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: null });
  eq('no contract on file → the estimate', none.originalContractSum, 100_000);
  eq('…labelled as the estimate', none.originalContractSumSource, 'estimate');
  ok('…and the PDF says "Estimate (no signed contract yet)" beside line 1',
    /1\. Original Contract Sum <span[^>]*>&mdash; Estimate \(no signed contract yet\)<\/span><\/td>/.test(buildAIAPayAppHtml(none, branding)));

  const draft = seedAIAPayApplicationFromInvoice(invoice, project, [], branding,
    { contract: { ...signed, status: 'sent' } });
  eq('a SENT (unsigned) contract is not the contract sum', draft.originalContractSum, 100_000);
  eq('…it is labelled the estimate', draft.originalContractSumSource, 'estimate');

  const unread = seedAIAPayApplicationFromInvoice(invoice, project, [], branding, { contract: undefined });
  eq('a failed contract read → the estimate', unread.originalContractSum, 100_000);
  eq('…labelled "not checked", never "no signed contract"', unread.originalContractSumSource, 'estimate_unread');
  eq('the not-checked words', PAY_APP_CONTRACT_SUM_LABEL.estimate_unread, 'Estimate (signed contract not checked)');

  // A reopened record (frozen before the fix) whose line 1 is the estimate
  // while a different signed contract now exists.
  eq('a saved estimate line 1 under a different signed contract says it differs',
    payAppContractSumSource(100_000, project, signed), 'estimate_not_contract');
  eq('an unprovable figure gets no label at all', payAppContractSumSource(77_777, project, signed), undefined);
  eq('a matching signed figure is the signed contract', payAppContractSumSource(92_500, project, signed), 'signed_contract');

  // Refresh carries the source with the figure.
  const refreshed = mergeRefreshedContract(none, withSigned);
  eq('refresh moves line 1 to the signed figure', refreshed.originalContractSum, 92_500);
  eq('…and its label with it', refreshed.originalContractSumSource, 'signed_contract');

  // The shared helper the CO screen uses.
  eq('contractSumBasis: signed', contractSumBasis(project, signed), { value: 92_500, basis: 'signed_contract', estimateTotal: 100_000 });
  eq('contractSumBasis: none on file', contractSumBasis(project, null), { value: 100_000, basis: 'estimate', estimateTotal: 100_000 });
  eq('contractSumBasis: read failed', contractSumBasis(project, undefined), { value: 100_000, basis: 'estimate_unread', estimateTotal: 100_000 });
  eq('the estimate caption, word for word', CONTRACT_SUM_BASIS_LABEL.estimate, 'Estimate (no signed contract yet)');
  eq('resolveContractSum itself is unchanged (signed wins)', resolveContractSum(project, signed).value, 92_500);

  const co = read('app/change-order.tsx');
  ok('the CO screen no longer reads the estimate grand total for "Original contract sum"',
    !/return project\.linkedEstimate\?\.grandTotal \?\? project\.estimate\?\.grandTotal \?\? 0;/.test(co));
  ok('…it reads contractSumBasis over the active contract',
    /contractSumBasis\(project, coContractSettled \? coContractRead\?\.contract : undefined\)/.test(co)
    && /const originalContractSum = project \? contractSum\.value : 0;/.test(co));
  ok('…and captions the row with the basis label',
    /CONTRACT_SUM_BASIS_LABEL\[contractSum\.basis\]/.test(co) && /testID="co-contract-sum-source"/.test(co));

  const pay = read('app/aia-pay-app.tsx');
  ok('the pay-app screen passes the active contract into the seeder',
    /contract: activeContract,/.test(pay));
  ok('…waits for the contract read to settle before seeding a NEW period',
    /if \(!savedForThisInvoice && !contractSettled\) return;/.test(pay));
  ok('…bounds that wait so a dead network cannot hold the screen',
    /CONTRACT_READ_TIMEOUT_MS/.test(pay) && /clearTimeout\(timer\)/.test(pay));
  ok('…and prints line 1’s source on the screen and into the PDF',
    /testID="aia-line1-source"/.test(pay)
    && (pay.match(/originalContractSumSource: lineOneSource/g) ?? []).length === 2);
}

// ── 5. Header carry-forward ─────────────────────────────────────────────────
console.log('\n5. The G702 header carries forward');
{
  const prior = { ownerName: 'Dana & Chris Henderson', contractDate: '2026-03-28', architectName: 'Lee Studio' };
  eq('the previous period’s header wins', seedPayAppHeader(prior, signed, project),
    { ownerName: 'Dana & Chris Henderson', contractDate: '2026-03-28', architectName: 'Lee Studio' });
  const first = seedPayAppHeader(null, signed, project);
  eq('first period: owner from the homeowner’s signing name', first.ownerName, 'Dana R. Henderson');
  ok('first period: contract date is the LOCAL day the contract was signed',
    first.contractDate === (() => { const d = new Date(signed.signedAt); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })(),
    String(first.contractDate));
  eq('no contract: owner from the project’s primary contact', seedPayAppHeader(null, null, project).ownerName, 'Dana Henderson');
  eq('no contract: no invented contract date', seedPayAppHeader(null, null, project).contractDate, undefined);
  eq('an UNSIGNED contract supplies neither owner nor date',
    seedPayAppHeader(null, { ...signed, status: 'sent' }, project), { ownerName: 'Dana Henderson', contractDate: undefined, architectName: undefined });
  eq('a blank prior owner falls through to the contract',
    seedPayAppHeader({ ownerName: '  ', contractDate: undefined }, signed, project).ownerName, 'Dana R. Henderson');

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
  const pay = read('app/aia-pay-app.tsx');
  ok('the pay-app screen hands the previous period to the seeder as the header source',
    /priorHeader: priorAIA,/.test(pay));
}

// The capability's apply() is async; the summary waits for it.
let asyncDone = false;
function finishAsync() { asyncDone = true; summary(); }
function summary() {
  if (!asyncDone) return;
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
summary();
