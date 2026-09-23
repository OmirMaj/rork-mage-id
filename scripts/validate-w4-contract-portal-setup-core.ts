// validate-w4-contract-portal-setup-core.ts — wave 4, lane contract-portal-setup.
//
// Executes the pure rules this lane added, then pins the screens to them:
//   #67  a homeowner signature recorded in person / on paper (contractSignatureCore)
//   #69  the contract seeds from the split the homeowner was shown (paymentTerms)
//   #68  an unsaved (possibly already-sent) estimate is confirmed before it is lost
//   #110 no "fixed-price" claim on the proposal link or its preview
//   #12  every contract / selections / closeout write asks for a portal republish
//   #15  the AIA screen stops promising the portal; a pending bank payment locks it
//   #16 / #18 / #19  Client Portal setup publishes only the SAVED settings, only
//        from server-read lists, only from the owner — and says why when it holds
//   #134 a disabled portal gets no digest; Disable Portal turns the recap off
//
// Run: bun run scripts/validate-w4-contract-portal-setup-core.ts

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  recordSignatureBlockReason, buildRecordedHomeownerSignature, recordHomeownerSignatureWith,
  recordSignatureOutcomeMessage, homeownerSignatureMethodLabel, type RecordSignatureIO,
} from '../utils/contractSignatureCore';
import { jobProposalSplit, quotedSplitOf, resolvePaymentSplit } from '../utils/paymentTerms';
import { portalSettingsDiffer } from '../utils/portalLiteSync';
import { digestPortalGate } from '../supabase/functions/homeowner-weekly-digest/clientVisible';
import type { ClientPortalSettings, ContractStatus } from '../types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
/** The body of `const <name> = useCallback(` up to its deps array. */
function callbackBody(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useCallback(`);
  if (at < 0) return '';
  const end = src.indexOf('\n  }, [', at);
  return end > at ? src.slice(at, end) : '';
}

async function main() {
  // ── #67 ──────────────────────────────────────────────────────────────────
  console.log('\n#67 — a homeowner signature given outside the portal');
  const today = '2026-09-19';
  ok('no name → blocked with the reason', recordSignatureBlockReason({ method: 'in_person', name: ' ', signaturePaths: ['M0'] }, today) !== null);
  ok('in person needs the pad', /sign in the box/.test(recordSignatureBlockReason({ method: 'in_person', name: 'Pat Doe', signaturePaths: [] }, today) ?? ''));
  ok('in person with pad + name → allowed', recordSignatureBlockReason({ method: 'in_person', name: 'Pat Doe', signaturePaths: ['M0 0'] }, today) === null);
  ok('paper needs a day', /day/.test(recordSignatureBlockReason({ method: 'paper', name: 'Pat Doe', hasPagePhoto: true }, today) ?? ''));
  ok('paper never a future day', /future/.test(recordSignatureBlockReason({ method: 'paper', name: 'Pat Doe', signedDay: '2026-09-20', hasPagePhoto: true }, today) ?? ''));
  ok('paper REQUIRES the photo of the signed page', /photo/.test(recordSignatureBlockReason({ method: 'paper', name: 'Pat Doe', signedDay: '2026-09-18' }, today) ?? ''));
  ok('paper with day + photo → allowed', recordSignatureBlockReason({ method: 'paper', name: 'Pat Doe', signedDay: '2026-09-18', hasPagePhoto: true }, today) === null);
  const paperSig = buildRecordedHomeownerSignature({ method: 'paper', name: ' Pat Doe ', signedDay: '2026-09-18' }, { nowIso: '2026-09-19T15:00:00.000Z', evidencePath: 'u1/c1-signed-page-1.jpg' });
  ok('paper signature: role homeowner, method paper, the evidence path, dated to its calendar day',
    paperSig.role === 'homeowner' && paperSig.method === 'paper' && paperSig.evidencePath === 'u1/c1-signed-page-1.jpg'
    && paperSig.signedAt === '2026-09-18T12:00:00.000Z' && paperSig.name === 'Pat Doe', JSON.stringify(paperSig));
  const padSig = buildRecordedHomeownerSignature({ method: 'in_person', name: 'Pat', signaturePaths: ['M1'] }, { nowIso: '2026-09-19T15:00:00.000Z' });
  ok('in-person signature: method in_person, the pad paths, signed now', padSig.method === 'in_person' && padSig.signaturePaths?.[0] === 'M1' && padSig.signedAt === '2026-09-19T15:00:00.000Z');
  ok('the record never passes for a portal e-signature', homeownerSignatureMethodLabel(paperSig)!.includes('paper') && homeownerSignatureMethodLabel(padSig)!.includes('in person'));

  const makeIo = (rows: Array<{ status: ContractStatus; homeownerSigned: boolean } | null>, written: number, opts: { throwOn?: 'read' | 'write'; err?: unknown } = {}) => {
    const calls = { reads: 0, writes: 0 };
    const io: RecordSignatureIO = {
      async readState() { calls.reads++; if (opts.throwOn === 'read') throw opts.err; return rows[Math.min(calls.reads - 1, rows.length - 1)]; },
      async flipIfStillSent() { calls.writes++; if (opts.throwOn === 'write') throw opts.err; return written; },
    };
    return { io, calls };
  };
  {
    const { io, calls } = makeIo([{ status: 'sent', homeownerSigned: false }], 1);
    const o = await recordHomeownerSignatureWith(io, 'c1', paperSig);
    ok('a sent, unsigned contract flips to signed', o.kind === 'signed' && calls.writes === 1);
  }
  {
    const { io, calls } = makeIo([{ status: 'signed', homeownerSigned: true }], 1);
    const o = await recordHomeownerSignatureWith(io, 'c1', paperSig);
    ok('already signed in the portal → NOT overwritten, says so', o.kind === 'not_sent' && calls.writes === 0 && /Already signed/.test(recordSignatureOutcomeMessage(o)!.title));
  }
  {
    const { io, calls } = makeIo([{ status: 'draft', homeownerSigned: false }], 1);
    const o = await recordHomeownerSignatureWith(io, 'c1', paperSig);
    ok('a draft / void contract is refused (only a SENT one can be counter-signed)', o.kind === 'not_sent' && calls.writes === 0);
  }
  {
    const { io } = makeIo([{ status: 'sent', homeownerSigned: false }, { status: 'signed', homeownerSigned: true }], 0);
    const o = await recordHomeownerSignatureWith(io, 'c1', paperSig);
    ok('lost the race (the conditional update wrote 0 rows) → re-read, "already signed"', o.kind === 'not_sent' && o.homeownerSigned);
  }
  {
    const { io } = makeIo([{ status: 'sent', homeownerSigned: false }], 1, { throwOn: 'read', err: new TypeError('Network request failed') });
    const o = await recordHomeownerSignatureWith(io, 'c1', paperSig);
    ok('no signal refuses with the reason (nothing half-written)', o.kind === 'offline' && /No connection/.test(recordSignatureOutcomeMessage(o)!.title));
  }
  {
    const { io } = makeIo([{ status: 'sent', homeownerSigned: false }], 1, { throwOn: 'write', err: { message: 'permission denied for table project_contracts', code: '42501' } });
    const o = await recordHomeownerSignatureWith(io, 'c1', paperSig);
    ok('a server refusal is "failed", not "offline"', o.kind === 'failed');
  }
  const engine = strip(read('utils/contractEngine.ts'));
  ok('the IO flips ONLY while still sent and unsigned', /\.eq\('status', 'sent'\)\s*\.is\('homeowner_signature', null\)/.test(engine));
  ok('the page photo goes to the owner-scoped secure-contracts bucket, never replaced',
    /from\('secure-contracts'\)\s*\.upload\(path, bytes, \{ contentType: 'image\/jpeg', upsert: false \}\)/.test(engine) && /`\$\{userId\}\/\$\{contractId\}-signed-page-/.test(engine));
  const contract = strip(read('app/contract.tsx'));
  const rec = callbackBody(contract, 'handleRecordSignature');
  ok('contract: "Record homeowner signature" shows on a SENT contract', /contract\.status === 'sent' && \(\s*<Button\s+label="Record homeowner signature"/.test(contract));
  ok('contract: paper uploads the photo BEFORE the write, and a failed upload records nothing',
    rec.indexOf('uploadSignedPageEvidence(') > 0 && rec.indexOf('uploadSignedPageEvidence(') < rec.indexOf('recordHomeownerSignature(') && /return;\s*\}\s*\}\s*const sig/.test(rec));
  ok('contract: after the record, the contract is re-read and the portal republished',
    /loadActiveContract\(c\.projectId\)[\s\S]*requestPortalPublish\(c\.projectId\)/.test(rec));
  ok('contract: the confirm is disabled with the reason printed', /disabled=\{recording \|\| !!blockReason\}/.test(contract) && /testID="contract-record-block-reason"/.test(read('app/contract.tsx')));

  // ── #69 ──────────────────────────────────────────────────────────────────
  console.log('\n#69 — the contract seeds from what the homeowner was shown');
  const q = { depositPct: 25, progressPct: 65, finalPct: 10, sharedAt: '2026-09-01T15:00:00.000Z' };
  const stamp = { depositPct: 30, progressPct: 60, finalPct: 10, stampedAt: 'x' };
  ok('portal stamp wins', jobProposalSplit({ portalStamp: stamp, quoted: q })?.from === 'portal');
  const jq = jobProposalSplit({ quoted: q });
  ok('…then the split on the shared PDF, with its day', jq?.from === 'quoted' && jq.split.depositPct === 25 && (jq as { sharedAt: string }).sharedAt === q.sharedAt);
  ok('…then nothing (the contract falls back to the profile)', jobProposalSplit({}) === null);
  ok('quotedSplitOf reads project.estimate, else the linked estimate (wizard jobs carry estimate: null)',
    quotedSplitOf({ estimate: null, linkedEstimate: { quotedPaymentSplit: q } })?.depositPct === 25
    && quotedSplitOf({ estimate: { quotedPaymentSplit: q } as never })?.depositPct === 25
    && quotedSplitOf({ estimate: null, linkedEstimate: { quotedPaymentSplit: { depositPct: 'x' } } }) === null);
  const profile = { paymentSplit: { depositPct: 10, progressPct: 80, finalPct: 10 } };
  ok('a profile change after the PDF does NOT change the seeded deposit',
    resolvePaymentSplit({ record: jobProposalSplit({ quoted: q })?.split, settings: profile }).split!.depositPct === 25);
  ok('contract seeding: stamp, then quoted, then profile',
    /const fromStamp = resolvePaymentSplit\(\{ record: p\.clientPortal\?\.proposalPaymentTerms, settings: s \}\);\s*const quoted = quotedSplitOf\(p\);\s*const resolved = fromStamp\.source !== 'record' && quoted/.test(contract));
  ok('contract: a schedule that is not the shown split says so (mismatch notice)', /testID="contract-terms-mismatch"/.test(read('app/contract.tsx')) && /!scheduleCarriesSplit\(contract\.paymentSchedule, contract\.contractValue, stampSplit\)/.test(contract));
  const wiz = strip(read('app/estimate-wizard.tsx'));
  const gen = callbackBody(wiz, 'generateAndSharePdf');
  ok('wizard: a successful share records the printed split and stamps an attached job',
    gen.indexOf('await shareQuickEstimatePDF(') < gen.indexOf('lastShareRef.current = quoted') && /if \(alreadyAttached\) writeQuotedSplit\(alreadyAttached, quoted\);/.test(gen));
  ok('wizard: a later save carries it (persistNewProject / attachAt)',
    /withQuotedSplit\(buildQuickLinkedEstimate\(costResult, pct, generateUUID\)\)/.test(callbackBody(wiz, 'persistNewProject'))
    && /withQuotedSplit\(buildQuickLinkedEstimate\(costResult, pct, generateUUID\)\)/.test(callbackBody(wiz, 'attachAt')));
  ok('wizard: the write goes through updateProject (the offline queue)', /updateProject\(id, \{ (estimate|linkedEstimate):/.test(callbackBody(wiz, 'writeQuotedSplit')));
  ok('wizard: jobStamp falls back to the quoted split', /\?\? \(projectId \? resolvePaymentSplit\(\{ record: quotedSplitOf\(scopedProject\) \}\)\.split : null\)/.test(wiz));

  // ── #68 ──────────────────────────────────────────────────────────────────
  console.log('\n#68 — an unsaved estimate is confirmed before it is lost (interim: no auto-save)');
  ok('Start a new estimate asks first when the result is not on a project',
    /if \(!unsavedRef\.current \|\| attachedIdRef\.current\) \{ doReset\(\); return; \}\s*confirmDiscard\(doReset\);/.test(callbackBody(wiz, 'reset')));
  ok('leaving the screen asks too (beforeRemove)', /navigation\.addListener\('beforeRemove'[\s\S]{0,400}e\.preventDefault\(\);\s*confirmDiscard\(/.test(wiz));
  const confirm = callbackBody(wiz, 'confirmDiscard');
  ok('the confirm offers Save to a project / Discard / Cancel and says when it was already sent',
    /'Cancel'/.test(confirm) && /'Discard'/.test(confirm) && /'Save to a project'/.test(confirm) && /You sent this estimate but haven/.test(confirm));
  ok('the onboarding share\'s own save cannot trip the guard (attachedIdRef set synchronously)', /attachedIdRef\.current = id;/.test(callbackBody(wiz, 'persistNewProject')));

  // ── #110 ─────────────────────────────────────────────────────────────────
  console.log('\n#110 — no "fixed-price" claim the PDF contradicts');
  for (const f of ['app/shared-estimate.tsx', 'components/estimate/EstimateClientView.tsx', 'utils/clientEstimateView.ts', 'components/brain/brainFabState.ts']) {
    ok(`${f}: no "fixed-price" / "fixed price"`, !/fixed[- ]price/i.test(read(f)));
  }
  ok('the link reads "Proposal · valid through"', /Proposal · valid through \{formatCalendarDay\(payload\.valid\)\}/.test(read('app/shared-estimate.tsx')));
  ok('the preview reads "Proposal · {projectName}"', /Proposal · \{projectName\}/.test(read('components/estimate/EstimateClientView.tsx')));

  // ── #12 ──────────────────────────────────────────────────────────────────
  console.log('\n#12 — every write the portal reads only at publish time asks for a publish');
  const send = callbackBody(contract, 'handleSignAndSend');
  const flipAt = send.indexOf("setContractStatus(saved.id, 'sent'");
  const pubAt = send.indexOf('requestPortalPublish(saved.projectId)');
  ok('contract: the publish is requested AFTER the status flip succeeded', flipAt > 0 && pubAt > flipAt && send.indexOf('if (!ok)') < pubAt);
  ok('contract: the alert no longer promises signing "in their portal" right now',
    !/'The homeowner can review and counter-sign in their portal\./.test(send) && /Your client portal is being updated with the contract/.test(send));
  ok('contract email (#64 carry): no "read the full agreement" / "ask questions" promise', !/read the full agreement/.test(send) && !/ask questions inside the portal/.test(send));
  const sel = strip(read('app/selections.tsx'));
  ok('selections: every save handler republishes', (sel.match(/publishPortal\(\);/g) ?? []).length >= 6, String((sel.match(/publishPortal\(\);/g) ?? []).length));
  const cob = strip(read('app/closeout-binder.tsx'));
  ok('closeout binder: every successful binder save republishes', /if \(saved\) \(requestPortalPublish as \(id: string\) => void\)\(projectId\);/.test(callbackBody(cob, 'persistBinder')));

  // ── #15 (AIA side) + CARRY #83 ───────────────────────────────────────────
  console.log('\n#15 / #83 — the AIA screen');
  const aia = strip(read('app/aia-pay-app.tsx'));
  ok('the bottom bar no longer promises the portal on save', !/Saved pay applications appear in your client portal/.test(aia));
  ok('a pending bank payment locks the period', /const isLocked = !!savedForThisAppNumber\?\.payLinkUrl \|\| !!savedPaidAt \|\| !!pendingBankPayment;/.test(aia));
  ok('…and no new pay link is minted while it settles', /if \(!pendingBankPayment\)\s*if \(!payLinkUrl && due > 0/.test(aia));
  ok('…and the banner says "Bank payment of $X processing since <day>"', /Bank payment\$\{known \? ` of \$\{formatMoney\(amount as number, 2\)\}` : ''\} processing since/.test(aia) && /paymentPendingHolds\(since, Date\.now\(\)\)/.test(aia));

  // ── #16 / #18 / #19 ──────────────────────────────────────────────────────
  console.log('\n#16 / #18 / #19 — Client Portal setup publishes the saved settings, gated');
  const saved = { enabled: true, portalId: 'p', showSchedule: true, showBudgetSummary: false, showInvoices: true, showChangeOrders: true, showPhotos: true, showDailyReports: false, showPunchList: false, showRFIs: false, showDocuments: false, invites: [{ id: 'i1', name: 'Pat', email: 'p@x.com' }] } as unknown as ClientPortalSettings;
  ok('same settings → no unsaved changes', !portalSettingsDiffer({ ...saved, accessToken: 'tok', linkExpiresAt: 'x' } as ClientPortalSettings, saved));
  ok('a flipped section switch → unsaved', portalSettingsDiffer({ ...saved, showBudgetSummary: true }, saved));
  ok('Require passcode turned on → unsaved', portalSettingsDiffer({ ...saved, requirePasscode: true }, saved));
  ok('an added invite → unsaved', portalSettingsDiffer({ ...saved, invites: [...(saved.invites ?? []), { id: 'i2', name: 'Sam', email: 's@x.com' } as never] }, saved));
  ok('missing vs false is the same setting', !portalSettingsDiffer({ ...saved, clientCanSetBudget: false }, saved));
  const setup = strip(read('app/client-portal-setup.tsx'));
  const persistAt = setup.indexOf('const hasPersistedRef = useRef(false);');
  const persist = persistAt > 0 ? setup.slice(persistAt, setup.indexOf('}, [publishedSnapshot', persistAt)) : '';
  ok('the rich publish requires server-read lists, a loaded profile and the owner',
    /if \(!portalListsServerRead \|\| !settingsLoaded \|\| !isOwner\) \{ setPublishState\('held'\); return; \}/.test(persist));
  ok('…re-checked when the timer fires (a foreground mid-delay cancels it)',
    /const g = publishGateRef\.current;\s*if \(!g\.portalListsServerRead \|\| !g\.settingsLoaded \|\| !isOwnerRef\.current\)/.test(persist));
  ok('…and it publishes the SAVED portal, not the local switches',
    /const portal = publishPortal;/.test(persist) && /snapshot: publishedSnapshot as unknown as Record<string, unknown>/.test(persist) && !/snapshot: snapshot as/.test(persist));
  ok('the published portal is built from project.clientPortal', /const savedPortal = project\?\.clientPortal;/.test(setup) && /\.\.\.savedPortal,\s*invites: savedPortal\.invites \?\? \[\]/.test(setup));
  ok('a refused upsert is shown as "not published"', /setPublishState\('refused'\)/.test(persist) && /Not published — the server refused this update/.test(read('app/client-portal-setup.tsx')));
  ok('the hold is said on screen', /Portal will update when your lists finish syncing\./.test(read('app/client-portal-setup.tsx')));
  ok('hash / invite links: the SAVED snapshot, short link while lists are not server-read',
    /if \(!publishedSnapshot \|\| !portalListsServerRead\) return portalLink;/.test(setup) && /if \(!portalListsServerRead\) return buildShortPortalUrl\(/.test(setup));
  ok('Generate new link persists ONLY the link keys onto the saved portal',
    /updateProject\(id, \{ clientPortal: \{ \.\.\.base, linkDurationDays: durationChoice, linkExpiresAt: nextExpiry \?\? undefined, linkGeneratedAt: next\.linkGeneratedAt \} \}\)/.test(setup));
  ok('leaving with unsaved switches asks first', /'Discard portal changes\?'/.test(setup));
  ok('#19: the owner-only reason, in the link controls\' words', /'Only the project owner can change what the client sees on the portal\.'/.test(setup));
  ok('#19: Save refuses for a non-owner instead of "Saved"', /if \(ownerOnlyReason\) \{ showAlert\('Not saved', ownerOnlyReason\); return; \}/.test(callbackBody(setup, 'handleSave')));
  ok('#19: the header Save is disabled for a non-owner', /disabled=\{isSaving \|\| !!ownerOnlyReason\}/.test(setup));
  const switches = (setup.match(/<Switch\b/g) ?? []).length;
  const gated = (setup.match(/<Switch\s+disabled=\{!!ownerOnlyReason\}/g) ?? []).length;
  ok('#19: every settings switch but the proposal one (gated in its handler) is disabled for a non-owner', gated === switches - 1, `${gated}/${switches}`);
  ok('#19: the proposal switch handler refuses a non-owner', /if \(ownerOnlyReason\) \{ showAlert\('Not changed', ownerOnlyReason\); return; \}/.test(callbackBody(setup, 'handleProposalSwitch')));
  ok('#19: "unknown" ownership falls back to the lite writer\'s rule (never a Save that never unlocks)',
    /\|\| \(ownership === 'unknown' && !!project && isPortalOwner\(project, userId\)\)/.test(setup));

  // ── #134 ─────────────────────────────────────────────────────────────────
  console.log('\n#134 — a disabled portal gets no digest');
  ok('enabled === false → portal_disabled', digestPortalGate({ enabled: false }) === 'portal_disabled');
  ok('enabled, or a legacy row with no flag → sends', digestPortalGate({ enabled: true }) === null && digestPortalGate({}) === null && digestPortalGate(null) === null);
  const digest = strip(read('supabase/functions/homeowner-weekly-digest/index.ts'));
  const sfp = digest.slice(digest.indexOf('async function sendForProject('), digest.indexOf('async function sendForProject(') + 1200);
  ok('sendForProject refuses FIRST (cron and preview), before any read',
    sfp.indexOf('digestPortalGate(portal)') > 0 && sfp.indexOf('digestPortalGate(portal)') < sfp.indexOf("from('portal_snapshots')"));
  ok('the cron run drops disabled portals before any work', /\.filter\(p => !digestPortalGate\(p\.client_portal\)\)/.test(digest));
  const disable = callbackBody(setup, 'handleDisablePortal');
  ok('Disable Portal also turns the weekly recap off', /enabled: false,\s*\.\.\.\(base\.weeklyDigest \? \{ weeklyDigest: \{ \.\.\.base\.weeklyDigest, enabled: false \} \} : \{\}\)/.test(disable));
  ok('the preview maps portal_disabled to its own reason', /errs\.includes\('portal_disabled'\)[\s\S]{0,200}Turn the portal on to email your client/.test(setup));

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

void main();
