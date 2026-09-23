// validate-w4-co-workflow-screen.ts — wave 4, lane co-workflow (chain A).
// Findings #42 #72 #73 #74 #75 #76 #78 #79 (and the screen side of #77/#141).
//
// bun cannot import a .tsx screen, so the decisions live in the pure
// `// >>> co-w4` block of app/change-order.tsx, which this script transpiles
// and EXECUTES; the wiring is pinned structurally (new shape required, old
// shape forbidden). utils/coApproval, utils/aiaBilling, utils/coNumbering and
// utils/brain/leakCoDraft are imported and executed directly. Every check was
// mutation-tested against the pre-fix code.

import { readFileSync } from 'fs';
import { join } from 'path';
import { coApprovalLine, CO_APPROVAL_ACTIONS } from '../utils/coApproval';
import { changeOrderApprovalDate, splitApprovedCOsByPeriod } from '../utils/aiaBilling';
import { nextChangeOrderNumber } from '../utils/coNumbering';

type TranspilerCtor = new (o: { loader: string }) => { transformSync(s: string): string };
const Transpiler = (globalThis as unknown as { Bun: { Transpiler: TranspilerCtor } }).Bun.Transpiler;

const ROOT = join(__dirname, '..');
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function ok(label: string, cond: unknown, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function evalBlock<T>(file: string, marker: string, names: string[]): T | null {
  const src = read(file);
  const start = src.indexOf(`// >>> ${marker}`);
  const end = src.indexOf(`// <<< ${marker}`);
  ok(`${file} carries the ${marker} marker block`, start > -1 && end > start);
  if (!(start > -1 && end > start)) return null;
  const js = new Transpiler({ loader: 'ts' }).transformSync(src.slice(start, end).replace(/^export /gm, ''));
  return new Function(`${js}\nreturn { ${names.join(', ')} };`)() as T;
}

type St = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'revised' | 'void';
type Line = { id: string; name: string; description?: string; quantity: number; unit?: string; unitPrice: number; total: number; priceSource?: 'ai_estimated' | 'needs_price' };
const money = (n: number) => `$${n.toFixed(2)}`;

const B = evalBlock<{
  coPipelineFor: (s: St) => { stages: { key: St; label: string; terminal?: boolean }[]; current: St; canAdvance: boolean };
  coApproveConfirmCopy: (n: number | null, amt: number, m: (n: number) => string) => { title: string; message: string };
  coTaxNote: (s: St | undefined, frozen: number | undefined, rate: number) => string;
  coPrefillLines: (raw: string | undefined, legacy: { amount?: string; reason?: string; description?: string }, id: () => string) => Line[] | null;
  coUnconfirmedPriceBlocker: (l: Line[], d: string, m: (n: number) => string) => { kind: 'refuse' | 'confirm'; title: string; message: string; lineIds?: string[] } | null;
  coRecordsRecipient: (o: { status: St; composerOpened: boolean; recipient: string; recipientAddr: string }) => boolean;
  coPortalSendGate: (o: { status: St | undefined; lineCount: number; numberHold: string | null; priceRefusal: string | null }) => { canSend: boolean; reason?: string };
  coPdfAction: (o: { saved: boolean; dirty: boolean; numberHold: string | null }) => { enabled: boolean; label: string; reason?: string };
  coFormDirty: (saved: { description: string; reason: string; scheduleImpactDays?: number; lineItems: Line[] } | null, form: { description: string; reason: string; scheduleImpactDays?: number; lineItems: Line[] }) => boolean;
  coStaleNumberHold: (local: number | undefined, confirmed: number | null) => string | null;
  coApprovalLineForViewer: <L extends { kind: string; who?: string; text: string }>(l: L, v: (string | null | undefined)[]) => L;
  coRevisionDraft: (src: { id: string; number: number; projectId: string; description: string; reason: string; lineItems: Line[]; scheduleImpactDays?: number; scheduleImpactTaskIds?: string[]; originalContractValue: number }, o: { id: string; number: number; nowIso: string; newId: () => string; actor: string }) => Record<string, unknown> & { lineItems: Line[]; changeAmount: number; status: string; revisesChangeOrderId: string; auditTrail: { action: string; detail?: string }[] };
}>('app/change-order.tsx', 'co-w4', [
  'coPipelineFor', 'coApproveConfirmCopy', 'coTaxNote', 'coPrefillLines', 'coUnconfirmedPriceBlocker',
  'coRecordsRecipient', 'coPortalSendGate', 'coPdfAction', 'coFormDirty', 'coRevisionDraft',
  'coStaleNumberHold', 'coApprovalLineForViewer',
]);
const CODE = stripComments(read('app/change-order.tsx'));

// ── #42 the tax note is keyed on status ────────────────────────────────────
console.log('\n#42 the tax note never claims an approval that did not happen');
if (B) {
  ok('approved: "Your client approved this change at 8%"', /^Your client approved this change at 8% sales tax/.test(B.coTaxNote('approved', 8, 8)));
  for (const s of ['submitted', 'under_review', 'revised'] as St[]) {
    const n = B.coTaxNote(s, 8, 8);
    ok(`${s}: "Sent at 8% — the rate your client is being asked to approve", no approval claim`, /^Sent at 8% sales tax — the rate your client is being asked to approve/.test(n) && !/approved this/.test(n), n);
  }
  for (const s of ['rejected', 'void'] as St[]) {
    const n = B.coTaxNote(s, 8, 8);
    ok(`${s}: says it was not approved, no "approved one" caveat`, /did not approve it/.test(n) && !/approved one/.test(n) && !/client approved this/.test(n), n);
  }
  ok('draft (no frozen rate): the recorded-when-sent fallback', /recorded on the change order when you send it/.test(B.coTaxNote('draft', undefined, 8)));
  ok('the screen renders coTaxNote(existingCO?.status, …) — not the frozen-rate ternary',
    /coTaxNote\(existingCO\?\.status, existingFrozenTaxRate, taxRatePct\)/.test(CODE) && !/existingFrozenTaxRate != null\s*\?\s*`Your client approved/.test(CODE));
}

// ── #72 who approved it ────────────────────────────────────────────────────
console.log('\n#72 the approved card says who signed, when, and the record hash');
{
  const base = { status: 'approved' as const, approvers: [] };
  const sealed = {
    ...base,
    auditTrail: [
      { id: 'x', action: 'portal_decision_applied', actor: 'MAGE ID', timestamp: '2026-03-30T18:00:00.000Z', detail: 'Status set to Approved from the client\'s signed portal decision.' },
      { id: 'a1', action: 'client_signed_via_portal', actor: 'Dana Homeowner', timestamp: '2026-03-30T17:59:00.000Z', detail: 'Electronically signed via the client portal (E-SIGN/UETA consent v2, record SHA-256 0123456789abcdef…).' },
    ],
  };
  const l = coApprovalLine(sealed);
  ok('sealed entry → client_signed, signer, calendar day, hash', l?.kind === 'client_signed' && l.who === 'Dana Homeowner' && l.hash === '0123456789abcdef' && /2026-03-3/.test(l.day ?? '') && /Dana Homeowner/.test(l.text) && /0123456789abcdef/.test(l.text), JSON.stringify(l));
  const portal = coApprovalLine({ ...base, auditTrail: [{ id: 'p', action: 'approved_via_portal', actor: 'Dana', timestamp: '2026-03-30T10:00:00Z' }] });
  ok('approved_via_portal → client_portal, says no drawn signature', portal?.kind === 'client_portal' && /No drawn signature/.test(portal.text));
  const appr = coApprovalLine({ ...base, approvers: [{ id: 'c', name: 'Dana', email: 'd@x', role: 'Client', required: true, order: 0, status: 'approved', responseDate: '2026-03-29' }], auditTrail: [] });
  ok('approved Client approver → approver line', appr?.kind === 'approver' && /Approved by Dana/.test(appr.text));
  const manual = coApprovalLine({ ...base, auditTrail: [] });
  ok('nothing from the client, no trail entry → "Marked approved in MAGE, no client signature on file." (never claims "you")', manual?.kind === 'manual' && manual.text === 'Marked approved in MAGE, no client signature on file.', manual?.text);
  const marked = coApprovalLine({ ...base, auditTrail: [{ id: 'm', action: 'marked_approved', actor: 'pm@acme.com', timestamp: '2026-03-30T15:00:00Z' }] });
  ok('a marked_approved entry names its actor and day', marked?.kind === 'manual' && marked.who === 'pm@acme.com' && /^Marked approved by pm@acme\.com on .+, no client signature on file\.$/.test(marked.text), marked?.text);
  if (B && marked) {
    ok('the viewer who marked it reads "by you"', /^Marked approved by you on /.test(B.coApprovalLineForViewer(marked, ['PM@acme.com', null]).text));
    ok('another viewer keeps the actor\'s name', /by pm@acme\.com/.test(B.coApprovalLineForViewer(marked, ['owner@acme.com']).text));
    ok('a signature line is never rewritten', B.coApprovalLineForViewer(l!, ['Dana Homeowner']).text === l!.text);
  }
  ok('the screen renders the viewer-aware line', /coApprovalLineForViewer\(l, \[authUser\?\.email, authUser\?\.name\]\)/.test(CODE));
  ok('a decline trail on an approved CO is not a signature', coApprovalLine({ ...base, auditTrail: [{ id: 'd', action: 'client_declined_via_portal', actor: 'Dana', timestamp: '2026-03-30T10:00:00Z' }] })?.kind === 'manual');
  ok('null unless approved', coApprovalLine({ status: 'submitted', auditTrail: sealed.auditTrail }) === null);
  ok('no PRE-STEP stub left in utils/coApproval.ts', !/PRE-STEP stub/.test(read('utils/coApproval.ts')));
  ok('the locked card renders the approval line', /coApprovalLine\(existingCO\)/.test(CODE) && /testID="co-approval-line"/.test(CODE) && /\{approvalLine\.text\}/.test(CODE));
}

// ── #75 the AIA period of a portal-signed CO ───────────────────────────────
console.log('\n#75 a portal-signed CO is dated by its signature, not its last edit');
{
  const co = {
    status: 'approved' as const, date: '2026-03-20', updatedAt: '2026-04-02T15:00:00.000Z', approvers: [],
    auditTrail: [
      { id: 'a1', action: 'client_signed_via_portal', actor: 'Dana', timestamp: '2026-03-30T17:59:00.000Z' },
      { id: 'k', action: 'portal_decision_applied', actor: 'MAGE ID', timestamp: '2026-03-30T18:00:00.000Z', detail: 'Status set to Approved' },
    ],
    changeAmount: 1000,
  };
  ok('dated 2026-03-30 (the sealed entry), not updatedAt 04-02', changeOrderApprovalDate(co) === '2026-03-30T17:59:00.000Z', String(changeOrderApprovalDate(co)));
  const split = splitApprovedCOsByPeriod([co], '2026-03-31');
  ok('sealed 03-30, updatedAt 04-02, period ending 03-31 → in period', split.inPeriod.length === 1 && split.afterPeriod.length === 0);
  const declinedOnly = { ...co, auditTrail: [{ id: 'd', action: 'client_declined_via_portal', actor: 'x', timestamp: '2026-03-01T00:00:00Z' }, { id: 'u', action: 'unapproved', actor: 'x', timestamp: '2026-03-02T00:00:00Z' }] };
  ok('declines / "unapproved" are never approval evidence (falls to updatedAt)', changeOrderApprovalDate(declinedOnly) === co.updatedAt);
  const applied = { ...co, auditTrail: [{ id: 'k', action: 'portal_decision_applied', actor: 'MAGE ID', timestamp: '2026-03-10T00:00:00Z', detail: 'Status set to Approved' }] };
  ok('portal_decision_applied alone is not used', changeOrderApprovalDate(applied) === co.updatedAt);
  const manual = { ...co, auditTrail: [{ id: 'm', action: 'marked_approved', actor: 'gc@x', timestamp: '2026-03-15T00:00:00Z' }] };
  ok('a manual marked_approved entry dates it', changeOrderApprovalDate(manual) === '2026-03-15T00:00:00Z');
  ok('the allow-list order: sealed, approved_via_portal, then manual', CO_APPROVAL_ACTIONS[0] === 'client_signed_via_portal' && CO_APPROVAL_ACTIONS[1] === 'approved_via_portal' && CO_APPROVAL_ACTIONS.includes('marked_approved'));
  ok('aiaBilling no longer matches /approve/i', !/\/approve\/i\.test\(e\.action\)/.test(stripComments(read('utils/aiaBilling.ts'))));
}

// ── #73 revise & re-issue, and no revival from Declined/Void ───────────────
console.log('\n#73 a declined CO has a way forward, and cannot be revived by one tap');
if (B) {
  for (const s of ['rejected', 'void'] as St[]) {
    const p = B.coPipelineFor(s);
    ok(`${s}: drawn as itself, no advance`, p.current === s && !p.canAdvance && p.stages.some(x => x.key === s && x.terminal));
  }
  const rev = B.coPipelineFor('revised');
  ok('revised: In Review, may advance (to Approved only)', rev.current === 'under_review' && rev.canAdvance);
  ok('the screen passes onAdvance only when canAdvance', /onAdvance=\{pipe\.canAdvance \?/.test(CODE) && !/function mapCOStatus/.test(CODE));
  const gate = (s: St) => B.coPortalSendGate({ status: s, lineCount: 1, numberHold: null, priceRefusal: null });
  ok('portal gate refuses rejected with the Revise & re-issue reason', !gate('rejected').canSend && /Revise & re-issue/.test(gate('rejected').reason ?? ''));
  ok('portal gate refuses void', !gate('void').canSend && /void/.test(gate('void').reason ?? ''));
  ok('portal gate still refuses a draft, allows a submitted CO', !gate('draft').canSend && gate('submitted').canSend);
  let k = 0;
  const draft = B.coRevisionDraft({
    id: 'co-5', number: 5, projectId: 'p', description: 'Heat pump', reason: 'Client request',
    lineItems: [{ id: 'l1', name: 'Unit', quantity: 1, unitPrice: 4500, total: 4500 }, { id: 'l2', name: 'Line set', quantity: 2, unitPrice: 12.345, total: 24.69 }],
    scheduleImpactDays: 2, originalContractValue: 100000,
  }, { id: 'co-9', number: 9, nowIso: '2026-09-19T12:00:00.000Z', newId: () => `n${++k}`, actor: 'gc@x' });
  ok('new draft, next number, linked back', draft.status === 'draft' && draft.number === 9 && draft.revisesChangeOrderId === 'co-5' && draft.id === 'co-9');
  ok('lines, days, description carried; new line ids', draft.lineItems.length === 2 && draft.lineItems.every(l => l.id.startsWith('n')) && draft.scheduleImpactDays === 2 && draft.description === 'Heat pump');
  ok('amount to the cent', draft.changeAmount === 4524.69 && draft.newContractTotal === 104524.69);
  ok('no frozen tax, portal state or approvers carried', !('taxRatePct' in draft) && !('portalState' in draft) && !('approvers' in draft) && !('priorApprovedChangesTotal' in draft));
  ok('the revision is in the new CO\'s own trail', draft.auditTrail.some(e => /Revises CO #5/.test(e.detail ?? '')));
  ok('the locked card offers Revise & re-issue on a rejected CO, through addChangeOrder', /testID="co-revise-reissue"/.test(CODE) && /coRevisionDraft\(existingCO,/.test(CODE) && /void addChangeOrder\(co\);/.test(CODE) && /number: nextChangeOrderNumber\(existingCOs\)/.test(CODE));
}

// ── #74 Share PDF ──────────────────────────────────────────────────────────
console.log('\n#74 the CO PDF can be shared from the screen');
if (B) {
  ok('unsaved → disabled, "Save the change order first"', !B.coPdfAction({ saved: false, dirty: false, numberHold: null }).enabled && /Save the change order first/.test(B.coPdfAction({ saved: false, dirty: false, numberHold: null }).reason ?? ''));
  ok('dirty → "PDF of last saved version"', B.coPdfAction({ saved: true, dirty: true, numberHold: null }).label === 'PDF of last saved version');
  ok('provisional number → disabled with the reason', !B.coPdfAction({ saved: true, dirty: false, numberHold: 'still reaching MAGE' }).enabled);
  ok('saved + confirmed → Share PDF', B.coPdfAction({ saved: true, dirty: false, numberHold: null }).enabled);
  const L = [{ id: 'a', name: 'A', quantity: 1, unitPrice: 10, total: 10 }];
  ok('coFormDirty: same → false, a price change → true',
    !B.coFormDirty({ description: 'd', reason: 'r', lineItems: L }, { description: 'd ', reason: 'r', lineItems: L })
    && B.coFormDirty({ description: 'd', reason: 'r', lineItems: L }, { description: 'd', reason: 'r', lineItems: [{ ...L[0], unitPrice: 11 }] }));
  ok('the screen calls generateChangeOrderPDF with the SAVED CO, behind a double-tap ref',
    /await generateChangeOrderPDF\(co, project, branding\)/.test(CODE) && /existingCO\b/.test(CODE) && /pdfBusyRef\.current\) return/.test(CODE) && /testID="co-share-pdf"/.test(CODE));
}

// ── #76 prices nobody confirmed ────────────────────────────────────────────
console.log('\n#76 a line with no price, or an unconfirmed AI price, cannot be sent');
if (B) {
  let k = 0;
  const lines = B.coPrefillLines(JSON.stringify([
    { name: 'Extra blocking', description: '', quantity: 1, unit: 'ls', unitPrice: 450, priceSource: 'ai_estimated' },
    { name: 'Relocate vent', quantity: 1, unit: 'ls', unitPrice: 0, priceSource: 'needs_price' },
    { nope: true },
  ]), {}, () => `l${++k}`) ?? [];
  ok('prefillLines → one line each (junk dropped), tags kept', lines.length === 2 && lines[0].priceSource === 'ai_estimated' && lines[0].total === 450 && lines[1].priceSource === 'needs_price');
  ok('legacy prefillAmount still honoured', (B.coPrefillLines(undefined, { amount: '1200', reason: 'out_of_scope' }, () => 'x') ?? [])[0]?.total === 1200);
  ok('an untagged $0 prefill line is needs_price', B.coPrefillLines(JSON.stringify([{ name: 'X', unitPrice: 0 }]), {}, () => 'x')?.[0]?.priceSource === 'needs_price');
  const refuse = B.coUnconfirmedPriceBlocker(lines, 'Additional work', money);
  ok('refuses, naming the first unpriced line', refuse?.kind === 'refuse' && /Relocate vent/.test(refuse.title));
  const conf = B.coUnconfirmedPriceBlocker([lines[0]], 'Additional work', money);
  ok('AI-estimated lines need a confirm, listed with their price', conf?.kind === 'confirm' && /Extra blocking \$450\.00/.test(conf.message) && conf.lineIds?.[0] === lines[0].id);
  ok('a description with NEEDS PRICE is refused', B.coUnconfirmedPriceBlocker([{ id: 'a', name: 'A', quantity: 1, unitPrice: 5, total: 5 }], 'Out-of-scope: NEEDS PRICE: vent', money)?.kind === 'refuse');
  ok('an untagged $0 line he typed (a time-extension-only CO) is NOT refused', B.coUnconfirmedPriceBlocker([{ id: 't', name: 'Time extension — no charge', quantity: 1, unitPrice: 0, total: 0 }], 'Five-day extension for the owner-supplied windows', money)?.kind !== 'refuse');
  ok('an untagged $0 line next to priced ones passes', B.coUnconfirmedPriceBlocker([{ id: 'a', name: 'A', quantity: 1, unitPrice: 5, total: 5 }, { id: 'n', name: 'No charge', quantity: 1, unitPrice: 0, total: 0 }], 'Scope', money) === null);
  ok('a $0 line still tagged needs_price is refused', B.coUnconfirmedPriceBlocker([{ id: 'n', name: 'Vent', quantity: 1, unitPrice: 0, total: 0, priceSource: 'needs_price' }], 'Scope', money)?.kind === 'refuse');
  ok('priced, confirmed lines pass (a credit line too)', B.coUnconfirmedPriceBlocker([{ id: 'a', name: 'A', quantity: 1, unitPrice: -50, total: -50 }], 'Credit', money) === null);
  ok('BOTH send paths run it (handleSendPress confirm, handleConfirmSend refusal)',
    /withConfirmedPrices\(\(\) => withConfirmedImpactDays\(\(\) => setShowSendRecipient\(true\)\)\)/.test(CODE)
    && /const unpriced = coUnconfirmedPriceBlocker\(lineItems, description, formatCurrency\);/.test(CODE));
  ok('typing a price clears the tag', /priceSource: undefined \} : item/.test(CODE));
  ok('the screen reads prefillLines', /coPrefillLines\(prefillLines,/.test(CODE));
}

// ── #78 the composer fallback keeps the recipient ──────────────────────────
console.log('\n#78 a send that fell back to the mail app keeps who and how long');
if (B) {
  ok('composer_opened on a draft records the recipient', B.coRecordsRecipient({ status: 'draft', composerOpened: true, recipient: 'Dave', recipientAddr: '' }));
  ok('a real send records it', B.coRecordsRecipient({ status: 'submitted', composerOpened: false, recipient: '', recipientAddr: 'd@x' }));
  ok('a plain draft save / failed send records nothing', !B.coRecordsRecipient({ status: 'draft', composerOpened: false, recipient: 'Dave', recipientAddr: 'd@x' }));
  ok('handleConfirmSend passes the recipient on composer_opened', /sent \|\| composerOpened \? sendRecipientName : undefined/.test(CODE) && /\{ recordRecipient: composerOpened \}/.test(CODE)
    && !/persistCO\(status, sent \? sendRecipientName : undefined, sent \? sendRecipientEmail : undefined\)/.test(CODE));
  ok('persistCO keys `sending` on coRecordsRecipient', /const sending = coRecordsRecipient\(/.test(CODE) && !/const sending = status === 'submitted' &&/.test(CODE));
  ok('the send sheet prefills from the pending Client approver', /useState\(pendingClient\?\.name \?\? ''\)/.test(CODE));
}

// ── #79 Mark approved asks first ───────────────────────────────────────────
console.log('\n#79 Mark approved confirms before it commits the money');
if (B) {
  const c = B.coApproveConfirmCopy(4, 5000, money);
  ok('"Approve CO #4?" / "This commits $5000.00 to the contract."', c.title === 'Approve CO #4?' && /This commits \$5000\.00 to the contract\./.test(c.message));
  ok('a credit says credits', /credits \$50\.00 back/.test(B.coApproveConfirmCopy(4, -50, money).message));
  const adv = CODE.slice(CODE.indexOf('onAdvance={pipe.canAdvance'), CODE.indexOf('advanceLabel={', CODE.indexOf('onAdvance={pipe.canAdvance')));
  ok('onAdvance: approved goes through confirmApprove, never a bare updateChangeOrder', /if \(next === 'approved'\) \{\s*confirmApprove\(existingCO\);\s*return;/.test(adv));
  ok('confirmApprove writes only inside the Approve handler', /text: 'Approve',\s*onPress: \(\) => \{\s*updateChangeOrder\(co\.id, \{ status: 'approved' \}\);/.test(CODE));
  ok('revised offers Mark approved (through the same confirm)', /existingCO\.status === 'under_review' \|\| existingCO\.status === 'revised' \? 'Mark approved'/.test(CODE));
}

// ── #77/#141 the screen never prints a guessed number ──────────────────────
console.log('\n#77/#141 the CO number is the server\'s before anything goes out');
{
  ok('one numbering helper', nextChangeOrderNumber([{ number: 3 }, { number: 7 }, { number: null }]) === 8 && nextChangeOrderNumber([]) === 1);
  ok('change-order.tsx, fieldTicketCore and leakCoDraft use it (no inline max+1)',
    /nextChangeOrderNumber\(existingCOs\)/.test(CODE)
    && /nextChangeOrderNumber\(existingCOs\)/.test(read('utils/fieldTicketCore.ts'))
    && /nextChangeOrderNumber\(existingCOs\)/.test(read('utils/brain/leakCoDraft.ts'))
    && ![CODE, read('utils/fieldTicketCore.ts'), read('utils/brain/leakCoDraft.ts')].some(f => /Math\.max\(max, c\.number \|\| 0\)/.test(f)));
  ok('the screen reads the server number', /useServerChangeOrderNumber\(existingCO\?\.id, existingCO\?\.number\)/.test(CODE));
  ok('the hero shows "(pending #…)" until confirmed', /Change Order \(pending #\$\{existingCO\.number\}\)/.test(CODE));
  ok('the email waits for the number (both entry points)', (CODE.match(/const hold = numberHold\('email'\);/g) ?? []).length === 2);
  ok('the email carries the confirmed number', /coNumber: confirmedNumber \?\? nextCoNumber,/.test(CODE) && !/coNumber: existingCO\?\.number \?\? nextCoNumber/.test(CODE));
  ok('a new CO\'s Send & Save saves first and reopens on it (sendNext)', /router\.setParams\(\{ coId: saved\.id, sendNext: '1' \}\)/.test(CODE));
  ok('the portal gate and the PDF wait too', /numberHold: numberHold\('portal'\)/.test(CODE) && /numberHold: numberHold\('pdf'\)/.test(CODE));
  if (B) {
    ok('stale provider number (device #4, server #5) holds the portal share, naming #5', /#5/.test(B.coStaleNumberHold(4, 5) ?? ''));
    ok('matching or unconfirmed numbers do not hold', B.coStaleNumberHold(5, 5) === null && B.coStaleNumberHold(4, null) === null);
  }
  ok('the portal gate also waits for the provider copy to carry the server number', /numberHold: numberHold\('portal'\) \?\? coStaleNumberHold\(existingCO\?\.number, confirmedNumber\)/.test(CODE));
  ok('persistCO stamps the server number on the local record when it differs', /\.\.\.\(confirmedNumber != null && confirmedNumber !== existingCO\.number \? \{ number: confirmedNumber \} : \{\}\)/.test(CODE)
    && /number: confirmedNumber \?\? existingCO\.number, isUpdate: true/.test(CODE));
  ok('sendNext is cleared once the sheet reopens (no reopen on remount)', /setShowSendRecipient\(true\);\s*router\.setParams\(\{ sendNext: undefined \}\);/.test(CODE));
  ok('the G701 prior-changes base uses the confirmed number', /const baseNumber = confirmedNumber \?\? nextCoNumber;/.test(CODE));
  ok('a renumber is said', /was already used on this job, so MAGE numbered it/.test(CODE));
  ok('field-ticket\'s toast no longer prints the provisional number', !/nailIt\(`CO #\$\{co\.number\} drafted/.test(read('app/field-ticket.tsx')));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
