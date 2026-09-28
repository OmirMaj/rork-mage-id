// signing-sites.ts: the signing moments in the app (wave-next W2, lane MOMSIGN).
//
// Loaded by scripts/validate-moments.ts (every scripts/moments-checks/*.ts is
// discovered). The sites and what this file holds them to:
//
//   A1 app/contract.tsx SignatureModal -> handleSignAndSend: a SigningCeremony
//      (signer gc). The write is the save, then the ONLINE-ONLY status flip
//      (setContractStatusDetailed), then the email. The fold says "sent" only
//      when the email service accepted it.
//   A2 app/contract.tsx, in person: the hand-off turn and a SigningCeremony
//      (signer homeowner, method in_person, name never prefilled); the write
//      is recordHomeownerSignature (never queued); the seal evidence shows
//      only after sealSignedContract returned a hash.
//   A3 app/contract.tsx, paper: a SlideToConfirm (tone ink, lock), legal and
//      offline; the deposit line only when nextBillableMilestone says so.
//   A4 app/contract.tsx, seal: a SlideToConfirm (tone ink, lock), legal and offline.
//   A5 app/field-ticket.tsx SignatureModal -> handleSign: a SigningCeremony
//      (signer authorizer); the write is signFieldTicket (online only), never
//      addFieldTicket / updateFieldTicket; the attestation is VERBATIM.
//   A6 app/client-view.tsx: the CO approval SigningCeremony; the insert is
//      awaited and the local change order flips ONLY after it is confirmed.
//
// Plus: utils/moments/sites/signingCopy.ts (every export called for real,
// each one sentence that lints clean, no "homeowner", no "job", no pronoun
// for a user); no fireConfetti in the three screens; every legal site passes
// BOTH legal (a ceremony is legal by construction) and offline, and its
// commit write calls no queue-backed write (Step 0's rules helper, one hop).
//
// Every rule is proven red on a planted defect first (a rule that cannot see a
// planted defect proves nothing), then run over the real files.

import type { MomentsCtx } from '../validate-moments';
import { lintMomentCopy } from '../../utils/moments/copy';
import * as S from '../../utils/moments/sites/signingCopy';
import { checkSite, closeOf, countCalls, jsxElements } from './rules';

type Fails = string[];

const CONTRACT = 'app/contract.tsx';
const TICKET = 'app/field-ticket.tsx';
const CLIENT_VIEW = 'app/client-view.tsx';
const SCREENS = [CONTRACT, TICKET, CLIENT_VIEW] as const;

const QUEUE_BACKED = /\b(supabaseWrite|supabaseWriteDetailed|supabaseRpcDetailed|addToOfflineQueue|enqueue\w*)\s*\(/;

/** The on-screen attestation before this lane (app/field-ticket.tsx), verbatim. D-5: never changed here. */
const ATTESTATION =
  "By signing you confirm this work was performed and the hours and quantities shown are accurate. Pricing is billed under the contract's T&M rates.";

/** The consent line the client view showed next to its box before this lane, verbatim (stored under consent_version). */
const CONSENT_LINE =
  'I agree to sign this change order electronically, and I approve the scope and the change to my contract total shown above.';

// ─────────────────────────────────────────────────────────────────────────────
// scanning helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The whole text of `const NAME = useCallback(…)` (the balanced call) or
 * `function NAME(…) {…}`; '' when absent. A typed arrow
 * (`async (a: string): Promise<CommitResult> => {`) is read to its closing
 * paren, never cut at the first statement.
 */
export function bodyOf(code: string, name: string): string {
  const m = new RegExp(`(?:const\\s+${name}\\s*=\\s*|function\\s+${name}\\s*\\()`).exec(code);
  if (!m) return '';
  const from = m.index + m[0].length;
  if (/^use(?:Callback|Memo)\s*[<(]/.test(code.slice(from))) {
    const open = code.indexOf('(', from);
    const end = closeOf(code, open);
    return end < 0 ? '' : code.slice(m.index, end);
  }
  const open = code.indexOf('{', from);
  const end = open < 0 ? -1 : closeOf(code, open);
  return end < 0 ? '' : code.slice(m.index, end);
}

/** A handler's text plus one hop into the local handlers it calls (the rules R1 hop, on whole bodies). */
export function withOneHop(code: string, name: string): string {
  const first = bodyOf(code, name);
  let text = first;
  const seen = new Set<string>([name]);
  const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(first))) {
    const callee = m[1];
    if (seen.has(callee)) continue;
    seen.add(callee);
    if (!new RegExp(`(?:const|let|var)\\s+${callee}\\s*=\\s*(?:useCallback\\(\\s*)?(?:async\\s*)?\\(|function\\s+${callee}\\s*\\(`).test(code)) continue;
    text += `\n${bodyOf(code, callee)}`;
  }
  return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// the rules (pure, on file text with comments stripped)
// ─────────────────────────────────────────────────────────────────────────────

/** How many of each moment a screen must render (a lost site is a red gate, not a vacuous pass). */
const EXPECTED: Record<string, { ceremonies: number; slides: number }> = {
  [CONTRACT]: { ceremonies: 2, slides: 2 },
  [TICKET]: { ceremonies: 1, slides: 0 },
  [CLIENT_VIEW]: { ceremonies: 1, slides: 0 },
};

/** S1: the site count, the legal flag and `offline` on every moment of a screen. */
export function checkLegalSites(path: string, code: string): Fails {
  const f: Fails = [];
  const want = EXPECTED[path];
  const ceremonies = jsxElements(code, 'SigningCeremony');
  const slides = jsxElements(code, 'SlideToConfirm');
  if (want && ceremonies.length !== want.ceremonies) f.push(`${path}: S1 expected ${want.ceremonies} <SigningCeremony>, found ${ceremonies.length}`);
  if (want && slides.length !== want.slides) f.push(`${path}: S1 expected ${want.slides} <SlideToConfirm>, found ${slides.length}`);
  for (const el of [...ceremonies, ...slides]) {
    const off = el.attrs.get('offline');
    if (off === undefined || /^(false|undefined|null)$/.test(off.trim())) f.push(`${path} <${el.tag}> @${el.start}: S1 a legal moment must pass offline (useOffline())`);
    if (el.tag === 'SlideToConfirm' && !/\blegal\s*:\s*true\b/.test(el.attrs.get('writeOptions') ?? '')) {
      f.push(`${path} <SlideToConfirm> @${el.start}: S1 every slide on this screen records a signature or a seal: writeOptions.legal must be true`);
    }
  }
  // Step 0's rules (R1 legal + offline + no queue-backed commit write, R3 whole sentences).
  f.push(...checkSite(path, code));
  return f;
}

/** S2: the screen-level legal writes call no queue-backed write (one hop), and use the online-only write they must. */
const LEGAL_WRITES: Record<string, { name: string; must: RegExp; mustNot?: RegExp }[]> = {
  [CONTRACT]: [
    { name: 'handleSignAndSend', must: /\bsetContractStatusDetailed\(saved\.id, 'sent'/, mustNot: /\bsetContractStatus\(/ },
    { name: 'recordInPerson', must: /\brecordHomeownerSignature\(c\.id, sig\)/ },
    { name: 'recordPaper', must: /\buploadSignedPageEvidence\([\s\S]*\brecordHomeownerSignature\(c\.id, sig\)/ },
    { name: 'sealWrite', must: /\bsealSignedContract\(/ },
  ],
  [TICKET]: [
    { name: 'handleSign', must: /\bsignFieldTicket\(/, mustNot: /\b(addFieldTicket|updateFieldTicket)\(/ },
  ],
  [CLIENT_VIEW]: [
    { name: 'approveWrite', must: /\.from\('change_order_approvals'\)\s*\.insert\(/ },
  ],
};

export function checkLegalWrites(path: string, code: string): Fails {
  const f: Fails = [];
  for (const w of LEGAL_WRITES[path] ?? []) {
    const own = bodyOf(code, w.name);
    if (!own) { f.push(`${path}: S2 ${w.name} is missing`); continue; }
    const text = withOneHop(code, w.name);
    const q = QUEUE_BACKED.exec(text)?.[1];
    if (q) f.push(`${path}: S2 ${w.name} calls ${q}( (queue-backed): a signature is never queued`);
    if (!w.must.test(text)) f.push(`${path}: S2 ${w.name} must write through ${w.must.source.slice(0, 60)}`);
    if (w.mustNot?.test(own)) f.push(`${path}: S2 ${w.name} must not call ${w.mustNot.source}`);
  }
  return f;
}

/** S3: no confetti in the three screens (the seal is the celebration). */
export function checkNoConfetti(path: string, code: string): Fails {
  const f: Fails = [];
  if (countCalls(code, 'fireConfetti') > 0) f.push(`${path}: S3 fireConfetti( is retired (plan rule 4)`);
  if (/from '@\/components\/animations\/Confetti'/.test(code)) f.push(`${path}: S3 the Confetti import is retired`);
  return f;
}

/** S4 (A6): the local change order flips to approved ONLY after the insert is confirmed. */
export function checkApproveFlipsOnConfirmed(code: string): Fails {
  const f: Fails = [];
  const body = bodyOf(code, 'approveWrite') ?? '';
  if (!body) return ['app/client-view.tsx: S4 approveWrite is missing'];
  const flips = body.match(/\bupdateChangeOrder\(/g) ?? [];
  if (flips.length !== 1) f.push(`app/client-view.tsx: S4 approveWrite must flip the change order exactly once (found ${flips.length})`);
  const insertAt = body.indexOf('await insertCODecision(');
  const catchAt = body.search(/\}\s*catch\s*\(err\)\s*\{/);
  const catchEnd = catchAt < 0 ? -1 : body.indexOf('\n    }', catchAt + 1);
  const flipAt = body.indexOf('updateChangeOrder(');
  const confirmedAt = body.indexOf("status: 'confirmed'");
  if (insertAt < 0) f.push('app/client-view.tsx: S4 approveWrite must await the insert (insertCODecision) before anything else');
  if (catchAt < 0 || !/return \{ status: 'refused'/.test(body.slice(catchAt, catchEnd))) f.push('app/client-view.tsx: S4 a failed insert must return (refused / timeout) before the flip');
  if (!(flipAt > insertAt && flipAt > catchEnd && catchEnd > 0)) f.push('app/client-view.tsx: S4 updateChangeOrder( must come after the insert and after every failure return');
  if (!(confirmedAt > flipAt)) f.push("app/client-view.tsx: S4 the only status: 'confirmed' comes after the flip");
  if (/status: 'confirmed'/.test(body.slice(0, Math.max(0, flipAt)))) f.push("app/client-view.tsx: S4 a status: 'confirmed' before the insert");
  for (const helper of ['buildCODecision', 'insertCODecision']) {
    if (/\bupdateChangeOrder\(/.test(bodyOf(code, helper) ?? '')) f.push(`app/client-view.tsx: S4 ${helper} must not flip the change order`);
  }
  return f;
}

/** S5 (A1): the fold says "sent" only when the email service accepted it; the email is awaited in the write. */
export function checkFoldHonesty(code: string): Fails {
  const f: Fails = [];
  const body = bodyOf(code, 'handleSignAndSend') ?? '';
  if (!body) return ['app/contract.tsx: S5 handleSignAndSend is missing'];
  const sets = [...body.matchAll(/moment\.fold\.sent = true;/g)];
  if (sets.length !== 1) f.push(`app/contract.tsx: S5 fold.sent = true must be set exactly once (found ${sets.length})`);
  const gate = body.indexOf("const sent = deliveryMarker?.state === 'delivered';");
  const ifSent = body.indexOf('if (sent) {');
  const setAt = sets[0]?.index ?? -1;
  if (!(gate > 0 && ifSent > gate && setAt > ifSent)) f.push("app/contract.tsx: S5 fold.sent = true only inside if (sent), where sent = deliveryMarker?.state === 'delivered'");
  if (!/const sentCount = await emailContractLink\(/.test(body)) f.push('app/contract.tsx: S5 the email is awaited inside the write (resolve after the send call returns)');
  const flip = body.indexOf("setContractStatusDetailed(saved.id, 'sent'");
  const firstConfirmed = body.indexOf("status: 'confirmed'");
  if (!(flip > 0 && firstConfirmed > flip)) f.push("app/contract.tsx: S5 no status: 'confirmed' before the status write");
  if (!/if \(status !== 'synced'\) return \{ status: 'refused'/.test(body) || !/if \(status === 'unknown'\) return \{ status: 'timeout'/.test(body)) {
    f.push("app/contract.tsx: S5 the status write maps refused -> refused and unknown -> timeout");
  }
  return f;
}

/** S6 (A2/A3): evidence only after a real hash; the deposit line only when a deposit is due; the client's name never prefilled. */
export function checkRecordHonesty(code: string): Fails {
  const f: Fails = [];
  const ev = [...code.matchAll(/signingCopy\.sealEvidence\(([^)]*)\)/g)];
  if (ev.length === 0) f.push('app/contract.tsx: S6 the seal evidence line is missing');
  for (const m of ev) {
    const before = code.slice(Math.max(0, (m.index ?? 0) - 160), m.index);
    if (!/autoSeal\.state === 'sealed' && autoSeal\.hash/.test(before)) f.push('app/contract.tsx: S6 sealEvidence( only behind autoSeal.state === \'sealed\' && autoSeal.hash (a real hash)');
  }
  const paper = bodyOf(code, 'recordPaper') ?? '';
  const nextAt = paper.indexOf('signingCopy.paperRecordedNext()');
  if (nextAt < 0 || !/nextBillableMilestone\(\{ contract: fresh\.contract, invoices: projectInvoicesRef\.current \}\)\?\.kind === 'deposit'/.test(paper.slice(Math.max(0, nextAt - 260), nextAt))) {
    f.push('app/contract.tsx: S6 "The deposit invoice can go out" only when nextBillableMilestone returns a deposit');
  }
  // A3 never shows a success for a record that was not stored: when the
  // client already signed elsewhere, recordPaper refuses BEFORE the shared
  // outcome mapper (whose neutral confirmed only the in-person ceremony reads).
  const guard = /if \(wasSignedElsewhere\(outcome\)\) \{\s*void recheckLockedContract\(\);\s*return \{ status: 'refused', reason: signingCopy\.paperAlreadySigned\(\) \};\s*\}/.exec(paper);
  const mapAt = paper.indexOf("if (outcome.kind !== 'signed') return recordOutcomeResult(outcome);");
  const writeAt = paper.indexOf('await recordHomeownerSignature(');
  if (!guard || mapAt < 0 || writeAt < 0 || !(guard.index > writeAt && guard.index < mapAt)) {
    f.push('app/contract.tsx: S6 recordPaper refuses the signed-elsewhere outcome (signingCopy.paperAlreadySigned()) before recordOutcomeResult, never a confirmed paper record that was not stored');
  }
  const firstConfirmed = paper.indexOf("status: 'confirmed'");
  if (firstConfirmed >= 0 && firstConfirmed < mapAt) f.push("app/contract.tsx: S6 recordPaper returns status: 'confirmed' only after the record answered signed");
  const helper = bodyOf(code, 'wasSignedElsewhere') ?? '';
  if (!/outcome\.kind === 'not_sent' && \(outcome\.homeownerSigned \|\| outcome\.status === 'signed'\)/.test(helper)) {
    f.push("app/contract.tsx: S6 wasSignedElsewhere is the not_sent outcome with the client's signature on it (homeownerSigned or status signed)");
  }
  const inPerson = jsxElements(code, 'SigningCeremony').find((e) => e.attrs.get('method') === '"in_person"');
  if (!inPerson) f.push('app/contract.tsx: S6 the in-person ceremony is missing');
  else {
    if (inPerson.attrs.get('signer') !== '"homeowner"') f.push('app/contract.tsx: S6 the in-person ceremony signs as signer="homeowner" (its name is never prefilled)');
    if (!/^\{\s*value: name,/.test(inPerson.attrs.get('name') ?? '')) f.push('app/contract.tsx: S6 the in-person name field starts from the sheet\'s own empty state');
    if (inPerson.attrs.get('role') === '"Homeowner"') f.push('app/contract.tsx: S6 the party on the document is "Owner", never "Homeowner"');
  }
  return f;
}

/** S7 (A5): the attestation is the verbatim screen text; the amount is behind the money blind on both mounts. */
export function checkTicket(code: string): Fails {
  const f: Fails = [];
  if (S.ticketAttestation() !== ATTESTATION) f.push('utils/moments/sites/signingCopy.ts: S7 ticketAttestation() changed (D-5: the screen wording is the founder\'s decision)');
  const el = jsxElements(code, 'SigningCeremony')[0];
  if (!el || !/subtitle: signingCopy\.ticketAttestation\(\)/.test(el.attrs.get('top') ?? '')) f.push('app/field-ticket.tsx: S7 top.subtitle is the attestation (signingCopy.ticketAttestation())');
  const mounts = [...code.matchAll(/<SignatureModal\b[\s\S]*?\/>/g)].map((m) => m[0]);
  if (mounts.length !== 2) f.push(`app/field-ticket.tsx: S7 expected the two sign sheet mounts, found ${mounts.length}`);
  for (const m of mounts) if (!/amount=\{moneyBlinded \? null : /.test(m)) f.push('app/field-ticket.tsx: S7 every sign sheet takes amount={moneyBlinded ? null : …}');
  // A new ticket keeps one id and number per draft: a retry after a timed-out
  // insert that landed meets its own row, never a second signed ticket.
  const sign = bodyOf(code, 'handleSign') ?? '';
  if (!/if \(!existing && !newTicketPinRef\.current\) newTicketPinRef\.current = \{ id: generateUUID\(\), number: nextFieldTicketNumber\(tickets\) \};/.test(sign)
    || !/id: pin\?\.id \?\? generateUUID\(\),/.test(sign) || !/number: pin\?\.number \?\? nextFieldTicketNumber\(tickets\),/.test(sign)) {
    f.push('app/field-ticket.tsx: S7 handleSign signs a new ticket under the draft\'s pinned id and number (newTicketPinRef), the same on every retry');
  }
  const clears = [...code.matchAll(/newTicketPinRef\.current = null/g)];
  const reset = bodyOf(code, 'resetComposer') ?? '';
  if (clears.length !== 1 || !/newTicketPinRef\.current = null/.test(reset)) f.push('app/field-ticket.tsx: S7 the ticket pin clears only in resetComposer (a fresh draft), never between retries');
  return f;
}

/** S8 (A6): the consent box is the stored version and the verbatim line. */
export function checkConsent(code: string): Fails {
  const f: Fails = [];
  if (S.clientCoConsentLine() !== CONSENT_LINE) f.push('utils/moments/sites/signingCopy.ts: S8 clientCoConsentLine() changed (consent text is never rewritten)');
  const el = jsxElements(code, 'SigningCeremony')[0];
  const consent = el?.attrs.get('consent') ?? '';
  if (!/version: ESIGN_DISCLOSURE_VERSION/.test(consent) || !/checked: esignConsent/.test(consent)) f.push('app/client-view.tsx: S8 consent = { version: ESIGN_DISCLOSURE_VERSION, …, checked: esignConsent }');
  if (!/consent_accepted: mode === 'approve' \? esignConsent : true/.test(code)) f.push('app/client-view.tsx: S8 consent_accepted stores the box\'s answer');
  return f;
}

/** S9: every signingCopy export, called for real, is one clean sentence with no banned word. */
export function checkCopy(): Fails {
  const f: Fails = [];
  for (const [name, fn] of Object.entries(S)) {
    if (typeof fn !== 'function') continue;
    // Placeholder data: a one-word name first (a two-word name reads as Title Case to the lint), then an amount with cents (a number reads the same in a template).
    const args = Array.from({ length: fn.length }, (_, i) => (i === 0 ? 'Jane' : '$1,240.00'));
    const out = (fn as (...a: unknown[]) => string)(...args);
    if (typeof out !== 'string' || !out.trim()) { f.push(`S9 ${name}() returns no words`); continue; }
    for (const e of lintMomentCopy(out)) f.push(`S9 ${name}(): "${out}": ${e}`);
    if (/\bhomeowner/i.test(out)) f.push(`S9 ${name}(): "${out}" says homeowner (client in the contractor's chrome, Owner on the document)`);
    if (/\bjob\b/i.test(out)) f.push(`S9 ${name}(): "${out}" says job (project)`);
    if (/\b(he|him|his|she|her|hers)\b/i.test(out)) f.push(`S9 ${name}(): "${out}" uses a pronoun for a user`);
    if (/\bnotified\b/i.test(out)) f.push(`S9 ${name}(): "${out}" claims a notification nobody sends`);
  }
  // The exact sentences the spec names.
  const exact: [string, string][] = [
    [S.contractTimeout(), 'No answer yet. Check the contract before trying again.'],
    [S.contractDuplicate(), 'Not signed. This project already has a contract. Close this to see it.'],
    [S.ticketRefused('FT-12'), 'Not signed. FT-12 could not be saved. Nothing was signed.'],
    [S.clientCoLegalQueued(), 'Not approved. Approving needs a connection, so nothing was approved.'],
    [S.inPersonSignedTitle(), 'Signed. The contract is binding.'],
    [S.contractSentTitle('Jane Smith'), 'Signed and sent to Jane Smith'],
    [S.contractNotSentTitle(), 'Signed. Not sent yet.'],
    [S.ticketSignedTitle('FT-12', '$1,240.00'), 'FT-12 signed · $1,240.00'],
    [S.ticketLockedNext(), 'Hours and quantities are locked. Rates can still change.'],
    [S.clientCoApprovedTitle(4, '+$4,200.00'), 'Approved · CO #4 · +$4,200.00'],
    [S.clientCoApprovedNext(), 'Your contractor sees it on their dashboard.'],
    [S.clientCoPreviewReason(), "This preview can't record an approval."],
    [S.paperUploadRefused(), 'Not recorded. The page photo did not upload, so nothing was saved.'],
    [S.paperAlreadySigned(), 'Not recorded. The client already signed on the portal or another phone, so nothing was changed.'],
    [S.recordNotSentDraft(), 'Not recorded. This contract is still a draft, not sent.'],
    [S.sealedNext(), 'The signed PDF is ready to download.'],
  ];
  for (const [got, want] of exact) if (got !== want) f.push(`S9 expected "${want}", got "${got}"`);
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
// planted proofs (on mutated copies of the REAL files, never on disk)
// ─────────────────────────────────────────────────────────────────────────────

type Plant = [name: string, check: () => Fails, expect: RegExp];

function plants(code: Record<string, string>): Plant[] {
  const c = code[CONTRACT];
  const t = code[TICKET];
  const v = code[CLIENT_VIEW];
  const mutate = (src: string, from: string | RegExp, to: string): string => {
    const out = src.replace(from, to);
    return out === src ? `${src}\n/* PLANT DID NOT APPLY: ${String(from)} */ const __plantMissed = <SigningCeremony />;` : out;
  };
  return [
    ['S1 a ceremony with no offline', () => checkLegalSites(TICKET, mutate(t, /offline=\{offline\}(\s*)copy=\{copy\}/, 'copy={copy}')), /S1 a legal moment must pass offline/],
    ['S1 a ceremony with offline={false}', () => checkLegalSites(CLIENT_VIEW, mutate(v, /offline=\{offline\}(\s*)copy=\{\{/, 'offline={false}$1copy={{')), /S1 a legal moment must pass offline/],
    ['S1 a slide that is not legal', () => checkLegalSites(CONTRACT, mutate(c, /idempotent: false,\n(\s*)legal: true,(?=[\s\S]*paperOffline)/, 'idempotent: false,\n$1')), /S1 every slide on this screen records a signature/],
    ['S1 a lost ceremony', () => checkLegalSites(CLIENT_VIEW, mutate(v, '<SigningCeremony', '<View')), /S1 expected 1 <SigningCeremony>/],
    ['S2 the field ticket signed through the queue', () => checkLegalWrites(TICKET, mutate(t, 'result = await signFieldTicket({ ticket });', "supabaseWrite('field_tickets', 'insert', ticket); result = await signFieldTicket({ ticket });")), /S2 handleSign calls supabaseWrite/],
    ['S2 the field ticket signed with addFieldTicket', () => checkLegalWrites(TICKET, mutate(t, 'result = await signFieldTicket({ ticket });', 'addFieldTicket(ticket); result = await signFieldTicket({ ticket });')), /S2 handleSign must not call/],
    ['S2 the GC flip through the old queue-backed call', () => checkLegalWrites(CONTRACT, mutate(c, "setContractStatusDetailed(saved.id, 'sent'", "setContractStatus(saved.id, 'sent'")), /S2 handleSignAndSend/],
    ['S3 a confetti burst', () => checkNoConfetti(CONTRACT, mutate(c, 'requestPortalPublish(saved.projectId);', 'requestPortalPublish(saved.projectId); fireConfetti({ count: 50 });')), /S3 fireConfetti/],
    ['S4 the CO flips before the insert', () => checkApproveFlipsOnConfirmed(mutate(v, 'const d = await buildCODecision(co, \'approve\');', "const d = await buildCODecision(co, 'approve'); updateChangeOrder(co.id, { status: 'approved' });")), /S4/],
    ['S4 the CO flips on failure too', () => checkApproveFlipsOnConfirmed(mutate(v, "      return { status: 'refused', reason: signingCopy.clientCoRefused() };\n    }\n", "      updateChangeOrder(co.id, { status: 'approved' });\n      return { status: 'refused', reason: signingCopy.clientCoRefused() };\n    }\n")), /S4/],
    ['S5 "sent" without a delivered email', () => checkFoldHonesty(mutate(c, "const sent = deliveryMarker?.state === 'delivered';", 'const sent = true;')), /S5 fold\.sent = true only inside/],
    ['S5 a fold that always says sent', () => checkFoldHonesty(mutate(c, '    moment.fold.sent = false;\n    moment.fold.title = signingCopy.contractNotSentTitle();\n    moment.fold.body = notSentReason;', '    moment.fold.sent = true;\n    moment.fold.title = signingCopy.contractNotSentTitle();\n    moment.fold.body = notSentReason;')), /S5 fold\.sent = true must be set exactly once/],
    ['S6 evidence before a hash', () => checkRecordHonesty(mutate(c, "evidence={autoSeal.state === 'sealed' && autoSeal.hash ? ", 'evidence={true ? ')), /S6 sealEvidence/],
    ['S6 the deposit line without the milestone check', () => checkRecordHonesty(mutate(c, "let next = signingCopy.paperRecordedNextNoDeposit();", 'let next = signingCopy.paperRecordedNext();')), /S6 "The deposit invoice can go out"/],
    ['S6 paper success over a record signed elsewhere', () => checkRecordHonesty(mutate(c, /\n\s*if \(wasSignedElsewhere\(outcome\)\) \{\s*void recheckLockedContract\(\);\s*return \{ status: 'refused', reason: signingCopy\.paperAlreadySigned\(\) \};\s*\}/, '')), /S6 recordPaper refuses the signed-elsewhere outcome/],
    ['S6 paper already-signed as a confirmed', () => checkRecordHonesty(mutate(c, "return { status: 'refused', reason: signingCopy.paperAlreadySigned() };", "return { status: 'confirmed', title: signingCopy.alreadySignedTitle() };")), /S6 recordPaper/],
    ['S6 a narrowed signed-elsewhere check', () => checkRecordHonesty(mutate(c, "outcome.kind === 'not_sent' && (outcome.homeownerSigned || outcome.status === 'signed')", "outcome.kind === 'not_sent' && outcome.homeownerSigned")), /S6 wasSignedElsewhere/],
    ['S6 the client prefilled as the GC signer', () => checkRecordHonesty(mutate(c, /signer="homeowner"(\s+mode="drawn"\s+method="in_person")/, 'signer="gc"$1')), /S6 the in-person ceremony signs as signer="homeowner"/],
    ['S7 an amount shown to a blinded role', () => checkTicket(mutate(t, 'amount={moneyBlinded ? null : draftTotals.billableTotal}', 'amount={draftTotals.billableTotal}')), /S7 every sign sheet/],
    ['S7 a new ticket id per slide', () => checkTicket(mutate(t, 'id: pin?.id ?? generateUUID(),', 'id: generateUUID(),')), /S7 handleSign signs a new ticket under the draft's pinned id/],
    ['S7 a new ticket number per slide', () => checkTicket(mutate(t, 'number: pin?.number ?? nextFieldTicketNumber(tickets),', 'number: nextFieldTicketNumber(tickets),')), /S7 handleSign signs a new ticket under the draft's pinned id/],
    ['S7 the pin cleared on each slide', () => checkTicket(mutate(t, 'signedTicketRef.current = null;', 'signedTicketRef.current = null; newTicketPinRef.current = null;')), /S7 the ticket pin clears only in resetComposer/],
    ['S8 an unversioned consent box', () => checkConsent(mutate(v, 'version: ESIGN_DISCLOSURE_VERSION, text:', "version: '', text:")), /S8/],
  ];
}

// ─────────────────────────────────────────────────────────────────────────────

export default function run(ctx: MomentsCtx): void {
  const { ok, read, stripComments } = ctx;
  const code: Record<string, string> = {};
  for (const p of SCREENS) code[p] = stripComments(read(p));

  // Planted proofs first.
  for (const [name, check, expect] of plants(code)) {
    const fails = check();
    ok(`signing red on planted: ${name}`, fails.some((x) => expect.test(x)), fails.join(' | ') || 'no failure reported');
  }

  // The real files.
  for (const p of SCREENS) {
    const legal = checkLegalSites(p, code[p]);
    ok(`S1 ${p}: every signing moment passes offline, is legal, and takes whole sentences from utils/moments/sites/*`, legal.length === 0, legal.join('\n'));
    const writes = checkLegalWrites(p, code[p]);
    ok(`S2 ${p}: the legal writes are online only (no queue-backed call, one hop)`, writes.length === 0, writes.join('\n'));
    const confetti = checkNoConfetti(p, code[p]);
    ok(`S3 ${p}: no fireConfetti`, confetti.length === 0, confetti.join('\n'));
  }
  const s4 = checkApproveFlipsOnConfirmed(code[CLIENT_VIEW]);
  ok('S4 client-view flips the local change order only after the approval insert is confirmed', s4.length === 0, s4.join('\n'));
  const s5 = checkFoldHonesty(code[CONTRACT]);
  ok('S5 contract: the letter says sent only when the email service accepted it', s5.length === 0, s5.join('\n'));
  const s6 = checkRecordHonesty(code[CONTRACT]);
  ok('S6 contract: the seal evidence needs a real hash, the deposit line needs a due deposit, the client types their own name', s6.length === 0, s6.join('\n'));
  const s7 = checkTicket(code[TICKET]);
  ok('S7 field ticket: the attestation is verbatim and the amount stays behind the money blind', s7.length === 0, s7.join('\n'));
  const s8 = checkConsent(code[CLIENT_VIEW]);
  ok('S8 client-view: the consent box is the stored version with its verbatim line', s8.length === 0, s8.join('\n'));
  const s9 = checkCopy();
  ok(`S9 utils/moments/sites/signingCopy.ts: ${Object.values(S).filter((x) => typeof x === 'function').length} exports, each one clean sentence`, s9.length === 0, s9.join('\n'));
}
