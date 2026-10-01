// money-sites.ts: the money moments' own rules (wave-next W2, lane MOMMONEY).
//
// Loaded by scripts/validate-moments.ts (auto-discovered). Every rule is a
// pure function over source text, proven RED on a planted defect first, then
// run over the real tree.
//
//   M1  utils/moments/sites/moneyCopy.ts runs for real: every exported
//       sentence lints clean (lintMomentCopy) for sample data, the sentences
//       the spec names read exactly as named, a credit reads "-$500.00",
//       certOffline() is offlineLegalReason('certifying') byte for byte, and
//       no payment sentence says "Not saved".
//   M2  no fireConfetti / Confetti import in the money sites (the capsule's
//       check is the success, plan rule 4).
//   M3  CO approve goes through approveChangeOrder (never updateChangeOrder)
//       in both entry points: the approve sheet and the reflow preview's
//       slide; change-order.tsx confirmApprove only opens the sheet; the job
//       page lost its confirm Alert, its "Approved" Alert and its bare
//       updateChangeOrder(…'approved') approve.
//   M4  AIA certify: the commit handler (and the local functions it calls, one
//       hop) makes no queue-backed write (supabaseWrite*, addToOfflineQueue,
//       enqueue*, addAIAPayApp, handleSave) and writes through
//       saveAIAPayAppOnline; its slide passes legal: true AND offline; the PDF
//       opens in onDone, never in the write; the ShieldAlert hex is gone.
//   M5  invoice record payment: the payment id is minted ONCE per sheet
//       session (openRecordPayment's fresh branch; a lazy mint only when
//       none exists) and the commit reuses it; the id is cleared only when
//       the session ends; the old overpayment / refuse / result Alerts and
//       the recordingPaymentRef lock are gone; the unsent-changes reason is
//       payEarlierChangeReason().

import type { MomentsCtx } from '../validate-moments';
import { lintMomentCopy } from '../../utils/moments/copy';
import { offlineLegalReason } from '../../utils/moments/commitResult';
import * as money from '../../utils/moments/sites/moneyCopy';
import { closeOf, definitionBody, jsxElements } from './rules';

type Fails = string[];

/**
 * The whole block body of `const NAME = useCallback(async (…): T => { … }` (or
 * a plain arrow / function). rules.ts definitionBody reads a block-bodied
 * arrow whose `=>` is followed by a space as an expression body and stops at
 * the first statement, so these rules read the block themselves.
 */
export function blockBody(code: string, name: string): string | null {
  const decl = new RegExp(`(?:const|let|var)\\s+${name}\\b[^=\\n]*=\\s*|function\\s+${name}\\s*\\(`).exec(code);
  if (!decl) return null;
  const from = decl.index + decl[0].length;
  // A function declaration: its body is the first `{` after the parameter
  // list (the return types these rules read carry no brace). An arrow: the
  // first `{` after its `=>`.
  const isDecl = /^function\s/.test(decl[0]);
  const paramsEnd = isDecl ? closeOf(code, from - 1) : -1;
  const arrow = isDecl ? -1 : code.indexOf('=>', from);
  const brace = code.indexOf('{', isDecl ? Math.max(paramsEnd, from) : (arrow < 0 ? from : arrow));
  if (brace < 0) return null;
  const end = closeOf(code, brace);
  return end < 0 ? null : code.slice(brace, end);
}

/** A handler's block, plus one hop into the local functions it calls (their blocks too). */
export function handlerBlocks(code: string, name: string): string {
  const first = blockBody(code, name) ?? '';
  let text = first;
  const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(first))) {
    const n = m[1];
    if (seen.has(n) || n === name) continue;
    seen.add(n);
    if (!new RegExp(`(?:const|let|var)\\s+${n}\\s*=\\s*(?:useCallback\\(\\s*)?(?:async\\s*)?\\(|function\\s+${n}\\s*\\(`).test(code)) continue;
    const b = blockBody(code, n);
    if (b) text += `\n${b}`;
  }
  return text;
}

const COPY_FILE = 'utils/moments/sites/moneyCopy.ts';
const SHEET = 'components/moments-sites/COApproveSheet.tsx';
const REFLOW = 'components/schedule/COScheduleReflowPreviewModal.tsx';
const CO = 'app/change-order.tsx';
const HUB = 'app/project-detail.tsx';
const INV = 'app/invoice.tsx';
const AIA = 'app/aia-pay-app.tsx';
const MONEY_SITES = [SHEET, REFLOW, CO, HUB, INV, AIA];

// ─────────────────────────────────────────────────────────────────────────────
// M1: the copy, executed
// ─────────────────────────────────────────────────────────────────────────────

type Fn = (...a: unknown[]) => unknown;

/** Sample arguments by parameter count: numbers for data (a CO number, cents), a date string for coFinishMoves. */
function sampleArgs(name: string, arity: number): unknown[] {
  if (name === 'coFinishMoves') return ['Nov 14, 2026'];
  return [4, 420000, 315000].slice(0, arity);
}

export function checkCopyModule(mod: Record<string, unknown>): Fails {
  const f: Fails = [];
  for (const [name, v] of Object.entries(mod)) {
    if (typeof v !== 'function') continue;
    const out = (v as Fn)(...sampleArgs(name, (v as Fn).length));
    if (typeof out !== 'string' || !out.trim()) { f.push(`M1 ${name}() returns no sentence`); continue; }
    const lint = lintMomentCopy(out);
    if (lint.length) f.push(`M1 ${name}() "${out}": ${lint.join(', ')}`);
    if (/^pay/.test(name) && /Not saved/.test(out)) f.push(`M1 ${name}() says "Not saved" (the link is "Review unsent changes")`);
    if (/\b(he|his|him|she|her)\b/i.test(out)) f.push(`M1 ${name}() "${out}": a he/his/she/her for a user`);
  }
  return f;
}

export function checkNamedSentences(m: typeof money): Fails {
  const f: Fails = [];
  const eq = (label: string, got: string, want: string) => { if (got !== want) f.push(`M1 ${label}: "${got}" is not "${want}"`); };
  eq('coSlideLabel', m.coSlideLabel(420000), 'Slide to approve · +$4,200.00');
  eq('coSlideLabel credit', m.coSlideLabel(-50000), 'Slide to approve · -$500.00');
  eq('coSlideLabelWithSchedule', m.coSlideLabelWithSchedule(420000), 'Slide to approve and shift the schedule · +$4,200.00');
  eq('coApproved', m.coApproved(4, 5240000), 'CO #4 approved · contract $52,400.00');
  eq('coApprovedNoTotal', m.coApprovedNoTotal(4, 420000), 'CO #4 approved · +$4,200.00');
  eq('coFinishMoves', m.coFinishMoves('Nov 14, 2026'), 'Finish moves to Nov 14, 2026');
  eq('coQueued', m.coQueued(), 'Approved on this phone · sends when online');
  eq('coRefused', m.coRefused(), 'Not approved. Something went wrong on our side.');
  eq('coTimeout', m.coTimeout(4), 'No answer yet. Check CO #4 before trying again.');
  eq('paySlideLabel', m.paySlideLabel(420000), 'Slide to record $4,200.00');
  eq('paySlideLabelOver', m.paySlideLabelOver(500000, 80000), 'Slide to record $5,000.00 · $800.00 over the balance');
  eq('payAmountEmpty', m.payAmountEmpty(), 'Type the amount received to record a payment.');
  eq('payAmountUnreadable', m.payAmountUnreadable(), "Couldn't read that amount. Type it like 12500.00 or 12,500.00.");
  eq('payAmountNotAboveZero', m.payAmountNotAboveZero(), 'Enter an amount above $0.00 to record a payment.');
  eq('payEarlierChangeReason', m.payEarlierChangeReason(), "An earlier change to this invoice hasn't sent yet. Review unsent changes first.");
  eq('payReviewUnsentLink', m.payReviewUnsentLink(), 'Review unsent changes');
  eq('payPaidInFull', m.payPaidInFull(), 'Paid in full · Balance $0.00');
  eq('payRecorded', m.payRecorded(420000, 315000), 'Recorded $4,200.00 · Balance $3,150.00');
  eq('payQueued', m.payQueued(), 'Recorded on this phone · sends when online');
  eq('payRefused', m.payRefused(), 'Not recorded. The server said no, so nothing was saved.');
  eq('payTimeout', m.payTimeout(12), 'No answer yet. Check invoice #12 before trying again.');
  eq('certSlideLabel', m.certSlideLabel(8631000), 'Slide to certify · $86,310.00');
  eq('certConfirmed', m.certConfirmed(6, 8631000), 'Pay app #6 certified · $86,310.00');
  eq('certNextPdf', m.certNextPdf(), 'Opening the PDF to share.');
  eq('certNoPayButton', m.certNoPayButton(), 'No Pay button yet. Connect Stripe to add one.');
  eq('certRefused', m.certRefused(), 'Not certified. Something went wrong on our side.');
  eq('certTimeout', m.certTimeout(6), 'No answer yet. Check pay app #6 before trying again.');
  eq('certLegalQueued', m.certLegalQueued(), 'Not certified. Certifying needs a connection, so nothing was certified.');
  eq('certOffline = offlineLegalReason(certifying)', m.certOffline(), offlineLegalReason('certifying'));
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// M2 to M5: source rules (text in, failures out)
// ─────────────────────────────────────────────────────────────────────────────

export function checkNoConfetti(path: string, code: string): Fails {
  return /\bfireConfetti\b|\bConfetti\b/.test(code) ? [`M2 ${path}: confetti (the capsule's check is the success)`] : [];
}

/** The onCommit handler of every <SlideToConfirm> in `code`, one hop deep. */
function slideHandlers(code: string): string[] {
  return jsxElements(code, 'SlideToConfirm').map((el) => handlerBlocks(code, el.attrs.get('onCommit') ?? ''));
}

export function checkCoApprove(files: { sheet: string; reflow: string; co: string; hub: string }): Fails {
  const f: Fails = [];
  for (const [path, code] of [[SHEET, files.sheet], [REFLOW, files.reflow]] as const) {
    const hs = slideHandlers(code);
    if (hs.length !== 1) { f.push(`M3 ${path}: expected one approve slide, found ${hs.length}`); continue; }
    if (!/\bapproveChangeOrder\(/.test(hs[0])) f.push(`M3 ${path}: the slide does not approve through approveChangeOrder(`);
    if (/\bupdateChangeOrder\(/.test(hs[0])) f.push(`M3 ${path}: the slide approves through updateChangeOrder(`);
  }
  if (!/approveChangeOrder\(changeOrder\.id, \{ anchorTaskId, \.\.\.\(frozen \? \{ frozen \} : \{\}\) \}\)/.test(files.reflow)) f.push(`M3 ${REFLOW}: the reflow slide does not pass the anchor it previewed (and the freeze an unsigned approve carries)`);
  // The confirmed contract figure is the SIGNED contract plus approved COs
  // (resolveContractSum, MONEY-CONTRACT-1), and an unread contract names the
  // CO's own amount instead of a guess.
  const after = blockBody(files.sheet, 'contractAfterApprovalCents') ?? '';
  if (!/if \(contract === undefined\) return null;/.test(after) || !/resolveContractSum\(project, contract\)\.value/.test(after) || /getContractValue/.test(files.sheet)) f.push(`M3 ${SHEET}: the contract after approval is not the signed contract (resolveContractSum) plus approved COs, or it guesses when the contract is unread`);
  for (const [path, code] of [[SHEET, files.sheet], [REFLOW, files.reflow]] as const) {
    if (!/title: unsigned \? coApprovedUnsignedTitle\(coNumber, amountCents, contractAfterCents\) : coApprovedTitle\(coNumber, amountCents, contractAfterCents\)/.test(code) || /\bcoApproved\(/.test(code.replace(/export function coApprovedTitle[\s\S]*?\n\}/, ''))) f.push(`M3 ${path}: the confirmed title does not go through coApprovedTitle / coApprovedUnsignedTitle (the unread-contract fallback)`);
  }
  for (const [path, code] of [[CO, files.co], [HUB, files.hub]] as const) {
    const calls = code.match(/contractAfterApprovalCents\([^)]*\)/g) ?? [];
    if (calls.length !== 2 || !calls.every((c) => /, approvalContract\)$/.test(c)) || !/const approvalContract = useApprovalContract\(project\?\.id, /.test(code)) f.push(`M3 ${path}: the approve title is not computed from the active contract read (approvalContract)`);
    if (/from '@\/app\//.test(code) && path === HUB) f.push(`M3 ${HUB}: the job page imports a route module`);
  }
  const confirm = blockBody(files.co, 'confirmApprove') ?? '';
  if (!/setApproveSheetCO\(co\)/.test(confirm)) f.push(`M3 ${CO}: confirmApprove does not open the approve sheet`);
  if (/\bupdateChangeOrder\(|\bshowAlert\(|\bnailIt\(/.test(confirm)) f.push(`M3 ${CO}: confirmApprove still writes, asks or toasts itself`);
  if (!/<COApproveSheet\b/.test(files.co)) f.push(`M3 ${CO}: no approve sheet rendered`);
  if (!/approveSlide=\{\{/.test(files.co)) f.push(`M3 ${CO}: the approve preview does not slide`);
  // W2 integration (critic 2, issue 8): "Client approved without signing" is
  // the same slide (the approve sheet, or the reflow preview's slide) through
  // approveChangeOrder with its #131 freeze in the approval's own write, and
  // the confirmed words say "unsigned". Nothing approves on a tap, and no
  // toast plays before the write is confirmed.
  const unsignedBody = blockBody(files.co, 'approveWithoutSigning') ?? '';
  if (!unsignedBody) f.push(`M3 ${CO}: approveWithoutSigning is missing`);
  if (/\bupdateChangeOrder\(|\bnailIt\(|coApproveConfirmCopy/.test(unsignedBody)) f.push(`M3 ${CO}: approveWithoutSigning approves, confirms or toasts on the tap (it must open the slide: the approve sheet or the reflow preview)`);
  if (!/setApproveUnsigned\(\{ frozen: freeze \}\);/.test(unsignedBody) || !/setApproveSheetCO\(co\);/.test(unsignedBody) || !/setReflowPreviewCO\(co\);/.test(unsignedBody) || !/coTaxFreeze\(/.test(unsignedBody)) {
    f.push(`M3 ${CO}: approveWithoutSigning opens the slide marked unsigned with its tax freeze (setApproveUnsigned, then the approve sheet or the reflow preview)`);
  }
  const unsignedPass = files.co.match(/\.\.\.\(approveUnsigned \? \{ unsigned: true, frozen: approveUnsigned\.frozen \} : \{\}\)/g) ?? [];
  if (unsignedPass.length !== 2) f.push(`M3 ${CO}: both approve surfaces (the sheet and the reflow slide) carry unsigned + the freeze (found ${unsignedPass.length})`);
  for (const el of files.co.match(/<COScheduleReflowPreviewModal\b[\s\S]*?\/>/g) ?? []) {
    if (!/approveSlide=/.test(el)) continue;
    const confirm = /onConfirm=\{([\s\S]*?)\}\s*\/>/.exec(el)?.[1] ?? el;
    if (/\bupdateChangeOrder\(|\bnailIt\(/.test(confirm)) f.push(`M3 ${CO}: the approve preview's tap path (onConfirm) approves or toasts on a tap`);
  }
  if (!/await \(frozen \? approveChangeOrder\(changeOrder\.id, \{ frozen \}\) : approveChangeOrder\(changeOrder\.id\)\)/.test(files.sheet)) f.push(`M3 ${SHEET}: the approve sheet does not pass the freeze an unsigned approve carries`);
  // The slide says its result in the toast (sayCommitResult) with the confirmed
  // title, which names an unsigned approval ("CO #4 approved, unsigned · …"),
  // so a late or after-close answer still says "unsigned". A site toast of its
  // own would say it twice; opting out (say={false}) would say it never.
  for (const [path, code] of [[SHEET, files.sheet], [REFLOW, files.reflow]] as const) {
    if (/\bnailIt\(|\boops\(/.test(code) || /\ssay=\{false\}/.test(code)) f.push(`M3 ${path}: a late unsigned approval must still say "unsigned" (the slide says its own confirmed title; no site toast, no say={false})`);
  }
  // From release until the answer is in (and through a stored answer's hold)
  // the approve sheet and the reflow modal cannot be closed.
  if (!/setBusy\(true\);\s*const outcome = await/.test(files.sheet) || !/\sdismissible=\{!busy\}/.test(files.sheet)) f.push(`M3 ${SHEET}: the approve sheet must hold (busy from the write, dismissible={!busy})`);
  if (!/onBusy\(true\);\s*const outcome = await/.test(files.reflow) || !/onRequestClose=\{close\}/.test(files.reflow) || !/const close = useCallback\(\(\) => \{ if \(!slideBusy\) onClose\(\); \}/.test(files.reflow)) f.push(`M3 ${REFLOW}: the reflow modal must hold while its slide's write is in flight (onBusy from the write, close gated on slideBusy)`);
  if (!/<COApproveSheet\b/.test(files.hub)) f.push(`M3 ${HUB}: no approve sheet rendered`);
  if (!/approveSlide=\{coReflowPreview\.status === 'approved' \? undefined : \{/.test(files.hub)) f.push(`M3 ${HUB}: the reflow preview's approve does not slide`);
  if (/updateChangeOrder\([^)]*status: 'approved'/.test(files.hub)) f.push(`M3 ${HUB}: an approve still goes through updateChangeOrder`);
  if (/showAlert\(\s*'Approved'/.test(files.hub) || /`Approve CO #\$\{co\.number\}\?`/.test(files.hub)) f.push(`M3 ${HUB}: the confirm / "Approved" Alerts are back`);
  return f;
}

const CERT_QUEUE_BACKED = /\b(supabaseWrite|supabaseWriteDetailed|supabaseRpcDetailed|addToOfflineQueue|enqueue\w*|addAIAPayApp|handleSave)\s*\(/;

export function checkAiaCertify(code: string): Fails {
  const f: Fails = [];
  const els = jsxElements(code, 'SlideToConfirm').filter((el) => el.attrs.get('onCommit') === 'certify');
  if (els.length !== 1) return [`M4 ${AIA}: expected one certify slide (onCommit={certify}), found ${els.length}`];
  const el = els[0];
  const h = handlerBlocks(code, 'certify');
  const q = CERT_QUEUE_BACKED.exec(h);
  if (q) f.push(`M4 ${AIA}: the certify write calls ${q[1]}( (queue-backed): a certification is never queued`);
  if (!/\bsaveAIAPayAppOnline\(/.test(h)) f.push(`M4 ${AIA}: the certify write does not go through saveAIAPayAppOnline(`);
  if (/\bgenerateAIAPayAppPDF\(/.test(h)) f.push(`M4 ${AIA}: the PDF is made inside the write (it opens in onDone, after the certify is stored)`);
  const wo = definitionBody(code, el.attrs.get('writeOptions') ?? '') ?? el.attrs.get('writeOptions') ?? '';
  if (!/\blegal:\s*true\b/.test(wo)) f.push(`M4 ${AIA}: the certify slide is not legal: true`);
  if (!/\bidempotent:\s*false\b/.test(wo)) f.push(`M4 ${AIA}: the certify slide is not idempotent: false`);
  if (!/offline:\s*certOffline\(\)/.test(wo)) f.push(`M4 ${AIA}: the offline reason is not certOffline() ("You're offline. Certifying needs a connection.")`);
  if (el.attrs.get('offline') !== 'offline' || !/const offline = useOffline\(\);/.test(code)) f.push(`M4 ${AIA}: the certify slide does not pass offline={useOffline()}`);
  if (el.attrs.get('onDone') !== 'handleGenerate' || !/generateAIAPayAppPDF\(/.test(blockBody(code, 'handleGenerate') ?? '')) f.push(`M4 ${AIA}: the PDF does not open in onDone`);
  if (/#C26A00/i.test(code)) f.push(`M4 ${AIA}: the ShieldAlert hex is back (use the warning token)`);
  // One certificate per draft: the id is pinned when "Ready to certify?" opens
  // and every attempt reuses it (a retry after a timeout upserts the same row).
  if (!/const rec = built \? \{ \.\.\.built, id: pinCertifyRecordId\(built\.id\) \} : null;/.test(blockBody(code, 'certify') ?? '')) f.push(`M4 ${AIA}: a certify attempt does not reuse the pinned record id`);
  if (!/pinCertifyRecordId\(generateUUID\(\)\);\s*setShowPreExportConfirm\(true\);/.test(blockBody(code, 'requestGenerate') ?? '')) f.push(`M4 ${AIA}: the record id is not pinned when "Ready to certify?" opens`);
  const pin = blockBody(code, 'pinCertifyRecordId') ?? '';
  if (!/if \(savedForThisInvoice\) \{/.test(pin) || !/else if \(!certifyRecIdRef\.current \|\| certifyRecIdRef\.current\.invoiceId !== invoice\?\.id\)/.test(pin) || (code.match(/certifyRecIdRef\.current = /g) ?? []).length !== 2) f.push(`M4 ${AIA}: the pinned certify id can be re-minted inside one draft`);
  return f;
}

export function checkInvoicePayment(code: string): Fails {
  const f: Fails = [];
  const open = code.slice(code.indexOf('const openRecordPayment = '), code.indexOf('const openRecordPayment = ') + 2500);
  const fresh = open.slice(open.indexOf('if (resumePaymentSheetRef.current)'));
  const resumeBranch = fresh.slice(0, fresh.indexOf('return;'));
  if (/createId\('pay'\)/.test(resumeBranch)) f.push(`M5 ${INV}: resuming the same sheet session mints a new payment id`);
  if (!/paymentIdRef\.current = createId\('pay'\);/.test(fresh.slice(fresh.indexOf('return;')))) f.push(`M5 ${INV}: a fresh sheet session does not mint its payment id when it opens`);
  const commit = blockBody(code, 'recordPayment') ?? '';
  if (!/if \(!paymentIdRef\.current\) paymentIdRef\.current = createId\('pay'\);/.test(commit)) f.push(`M5 ${INV}: the commit does not mint only when no id exists`);
  if (!/id: paymentIdRef\.current,/.test(commit)) f.push(`M5 ${INV}: the commit does not send the session's payment id`);
  const mints = (code.match(/createId\('pay'\)/g) ?? []).length;
  if (mints !== 2) f.push(`M5 ${INV}: ${mints} places mint a payment id (want 2: the sheet opening and the lazy guard)`);
  const clears = (code.match(/paymentIdRef\.current = null/g) ?? []).length;
  const done = blockBody(code, 'onPaymentDone') ?? '';
  if (clears !== 1 || !/paymentIdRef\.current = null/.test(done)) f.push(`M5 ${INV}: the payment id is cleared somewhere other than the end of the session (onPaymentDone)`);
  if (/\bshowAlert\(/.test(commit.replace(/const flipFailed = \(\) => showAlert\(/, ''))) f.push(`M5 ${INV}: the record write still answers with an Alert (outcomes are the slide's result and reason lines)`);
  if (/recordingPaymentRef|handleMarkPaid|recordUnderLock|commitPaymentPastUnsaved/.test(code)) f.push(`M5 ${INV}: the old tap-and-Alert chain (recordingPaymentRef / handleMarkPaid) is back`);
  if (/text: 'Record it'/.test(code)) f.push(`M5 ${INV}: the overpayment Alert is back`);
  if (!/: paymentChain\.held \? payEarlierChangeReason\(\) : null;/.test(code)) f.push(`M5 ${INV}: the unsent-changes check is not the slide's disabled reason`);
  if ((code.match(/payEarlierChangeReason\(\)/g) ?? []).length !== 1) f.push(`M5 ${INV}: the unsent-changes sentence is said twice (the track reads it; the row below holds only the link)`);
  if (!/paymentDecision\.kind === 'refuse'\s*\? paymentAmountReason\(paymentAmount\)/.test(code) || /paymentDecision\.message/.test(code)) f.push(`M5 ${INV}: a refused amount is not one whole sentence that says why (paymentAmountReason)`);
  const why = blockBody(code, 'paymentAmountReason') ?? '';
  if (!/payAmountEmpty\(\)/.test(why) || !/payAmountUnreadable\(\)/.test(why) || !/payAmountNotAboveZero\(\)/.test(why)) f.push(`M5 ${INV}: paymentAmountReason does not name every refusal (empty, unreadable, not above $0.00)`);
  if (!/disabledReason=\{paymentDisabledReason\}/.test(code)) f.push(`M5 ${INV}: the slide does not take the disabled reason`);
  if (/editable=\{!paymentAwaitingAnswer\}/.test(code) === false) f.push(`M5 ${INV}: the fields do not lock after a timeout (a retry must be the same payment)`);
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────

/** A planted edit. One that finds nothing throws, so its proof fails instead of passing on a no-op. */
function mutate(src: string, find: string | RegExp, replace: string): string {
  const out = src.replace(find, replace);
  if (out === src) throw new Error(`planted edit found nothing: ${String(find).slice(0, 60)}`);
  return out;
}

/** True when the planted check reports a failure; false when it passes or the plant could not be made. */
function red(check: () => Fails): boolean {
  try { return check().length > 0; } catch { return false; }
}

export default function run(ctx: MomentsCtx): void {
  const { ok, read, stripComments } = ctx;
  const code = (p: string) => stripComments(read(p));
  const files = { sheet: code(SHEET), reflow: code(REFLOW), co: code(CO), hub: code(HUB) };
  const inv = code(INV);
  const aia = code(AIA);

  // M1
  const m1 = [...checkCopyModule(money as unknown as Record<string, unknown>), ...checkNamedSentences(money)];
  ok(`M1 ${COPY_FILE}: every sentence lints clean and the named ones read exactly (${Object.keys(money).length} sentences)`, m1.length === 0, m1.join('\n'));
  ok('M1 red on planted: an amount without cents', red(() => checkCopyModule({ bad: () => 'Recorded $4,200 · Balance $0.00' })));
  ok('M1 red on planted: "Not saved" in a payment sentence', red(() => checkCopyModule({ payBad: () => 'Retry it from Not saved first.' })));
  ok('M1 red on planted: a named sentence drifts', red(() => checkNamedSentences({ ...money, coTimeout: () => 'Timed out.' })));

  // M2
  const m2 = MONEY_SITES.flatMap((p) => checkNoConfetti(p, code(p)));
  ok(`M2 no confetti in the ${MONEY_SITES.length} money site files`, m2.length === 0, m2.join('\n'));
  ok('M2 red on planted: fireConfetti({ count: 35 })', red(() => checkNoConfetti(HUB, `${files.hub}\nfireConfetti({ count: 35 });`)));

  // M3
  const m3 = checkCoApprove(files);
  ok('M3 CO approve goes through approveChangeOrder in the sheet and the reflow slide; confirmApprove only opens the sheet; the job page lost its Alerts', m3.length === 0, m3.join('\n'));
  ok('M3 red on planted: a site toast of its own beside the slide\'s',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'setBusy(false);\n    if (r.status', "setBusy(false); nailIt('CO approved');\n    if (r.status") })));
  ok('M3 red on planted: the approve sheet dismissible while the write runs',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'dismissible={!busy}', '') })));
  ok('M3 red on planted: the reflow modal closes mid-write',
    red(() => checkCoApprove({ ...files, reflow: mutate(files.reflow, 'onRequestClose={close}', 'onRequestClose={props.onClose}') })));
  ok('M3 red on planted: the sheet approves through updateChangeOrder',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'await (frozen ? approveChangeOrder(changeOrder.id, { frozen }) : approveChangeOrder(changeOrder.id))', "await updateChangeOrder(changeOrder.id, { status: 'approved' })") })));
  ok('M3 red on planted: the reflow slide drops the anchor',
    red(() => checkCoApprove({ ...files, reflow: mutate(files.reflow, 'approveChangeOrder(changeOrder.id, { anchorTaskId, ...(frozen ? { frozen } : {}) })', 'approveChangeOrder(changeOrder.id)') })));
  ok('M3 red on planted: confirmApprove writes on the tap',
    red(() => checkCoApprove({ ...files, co: mutate(files.co, 'setApproveSheetCO(co);', "updateChangeOrder(co.id, { status: 'approved' });") })));
  ok('M3 red on planted: the contract figure from the estimate again (getContractValue)',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'const base = resolveContractSum(project, contract).value;', 'const base = getContractValue(project, []);') })));
  ok('M3 red on planted: an unread contract guessed as the estimate',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'if (contract === undefined) return null;', '') })));
  ok('M3 red on planted: the reflow title skips the unread fallback',
    red(() => checkCoApprove({ ...files, reflow: mutate(files.reflow, ': coApprovedTitle(coNumber, amountCents, contractAfterCents)', ': coApproved(coNumber, contractAfterCents ?? 0)') })));
  ok('M3 red on planted: "Client approved without signing" approves and toasts on the tap again',
    red(() => checkCoApprove({ ...files, co: mutate(files.co, 'setApproveUnsigned({ frozen: freeze });', "updateChangeOrder(co.id, { status: 'approved', ...freeze }); nailIt(`CO #${co.number} approved, unsigned`); setApproveUnsigned({ frozen: freeze });") })));
  ok('M3 red on planted: the approve preview\'s tap approves again',
    red(() => checkCoApprove({ ...files, co: mutate(files.co, /onConfirm=\{\(\) => \{ setApproveUnsigned\(null\); setReflowPreviewCO\(null\); \}\}/, "onConfirm={(anchorTaskId) => { updateChangeOrder(reflowPreviewCO.id, { status: 'approved' }, { anchorTaskId }); nailIt('approved'); }}") })));
  ok('M3 red on planted: the unsigned approval loses its freeze',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'await (frozen ? approveChangeOrder(changeOrder.id, { frozen }) : approveChangeOrder(changeOrder.id))', 'await approveChangeOrder(changeOrder.id)') })));
  ok('M3 red on planted: an unsigned approval confirmed as signed',
    red(() => checkCoApprove({ ...files, sheet: mutate(files.sheet, 'title: unsigned ? coApprovedUnsignedTitle(', 'title: false ? coApprovedUnsignedTitle(') })));
  ok('M3 red on planted: the sheet opened unmarked from "Client approved without signing"',
    red(() => checkCoApprove({ ...files, co: mutate(files.co, 'setApproveUnsigned({ frozen: freeze });', '') })));
  ok('M3 red on planted: the job page imports the change-order route again',
    red(() => checkCoApprove({ ...files, hub: `import { coTaxNote } from '@/app/change-order';\n${files.hub}` })));
  ok('M3 red on planted: the job page approves with updateChangeOrder again',
    red(() => checkCoApprove({ ...files, hub: `${files.hub}\nupdateChangeOrder(co.id, { status: 'approved' });` })));

  // M4
  const m4 = checkAiaCertify(aia);
  ok('M4 AIA certify: online-only write, legal + offline, PDF in onDone, no hex', m4.length === 0, m4.join('\n'));
  ok('M4 red on planted: the certify write queues (addAIAPayApp)',
    red(() => checkAiaCertify(mutate(aia, 'const stored = await saveAIAPayAppOnline(rec);', 'addAIAPayApp(rec); const stored = await saveAIAPayAppOnline(rec);'))));
  ok('M4 red on planted: the certify slide without offline',
    red(() => checkAiaCertify(mutate(aia, 'offline={offline}', ''))));
  ok('M4 red on planted: legal: true dropped',
    red(() => checkAiaCertify(mutate(aia, /legal: true,/, ''))));
  ok('M4 red on planted: the PDF made inside the write',
    red(() => checkAiaCertify(mutate(aia, 'const stored = await saveAIAPayAppOnline(rec);', 'await generateAIAPayAppPDF(app, b); const stored = await saveAIAPayAppOnline(rec);'))));
  ok('M4 red on planted: a certify attempt mints its own id',
    red(() => checkAiaCertify(mutate(aia, 'id: pinCertifyRecordId(built.id)', 'id: built.id'))));
  ok('M4 red on planted: the id is not pinned when the attestation opens',
    red(() => checkAiaCertify(mutate(aia, 'pinCertifyRecordId(generateUUID());', ''))));
  ok('M4 red on planted: the pin re-mints on every call',
    red(() => checkAiaCertify(mutate(aia, "} else if (!certifyRecIdRef.current || certifyRecIdRef.current.invoiceId !== invoice?.id) {", '} else {'))));
  ok('M4 red on planted: the ShieldAlert hex returns',
    red(() => checkAiaCertify(mutate(aia, 'color={themeColors.warningLabel}', 'color="#C26A00"'))));

  // M5
  const m5 = checkInvoicePayment(inv);
  ok('M5 invoice payment: one id per sheet session, reused on retry; no Alert chain; the unsent-changes reason is the disabled reason', m5.length === 0, m5.join('\n'));
  ok('M5 red on planted: every attempt mints a new id',
    red(() => checkInvoicePayment(mutate(inv, 'if (!paymentIdRef.current) paymentIdRef.current = createId(\'pay\');', 'paymentIdRef.current = createId(\'pay\');'))));
  ok('M5 red on planted: a refused attempt clears the id',
    red(() => checkInvoicePayment(mutate(inv, "return { status: 'refused', reason: held ? payHeld() : payRefused() };", "paymentIdRef.current = null; return { status: 'refused', reason: held ? payHeld() : payRefused() };"))));
  ok('M5 red on planted: the resumed session mints a new id',
    red(() => checkInvoicePayment(mutate(inv, '      resumePaymentSheetRef.current = false;\n      setShowPaymentModal(true);', "      resumePaymentSheetRef.current = false;\n      paymentIdRef.current = createId('pay');\n      setShowPaymentModal(true);"))));
  ok('M5 red on planted: an Alert answers the record',
    red(() => checkInvoicePayment(mutate(inv, "    if (outcome === 'queued') {\n      return {", "    showAlert('Payment recorded', 'x');\n    if (outcome === 'queued') {\n      return {"))));
  ok('M5 red on planted: the held row repeats the sentence',
    red(() => checkInvoicePayment(mutate(inv, 'testID="record-payment-held">', 'testID="record-payment-held"><Text>{payEarlierChangeReason()}</Text>'))));
  ok('M5 red on planted: a refused amount reads only the example',
    red(() => checkInvoicePayment(mutate(inv, '? paymentAmountReason(paymentAmount)', '? paymentDecision.message'))));
  ok('M5 red on planted: the empty amount has no reason of its own',
    red(() => checkInvoicePayment(mutate(inv, 'if (!typed.trim()) return payAmountEmpty();', ''))));
  ok('M5 red on planted: the unsent-changes check is not the reason',
    red(() => checkInvoicePayment(mutate(inv, ': paymentChain.held ? payEarlierChangeReason() : null;', ': null;'))));
}
