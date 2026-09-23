// validate-change-orders-wave3.ts — the change-order screen's wave-3 fixes
// (2026-09 workflow audit, change-orders lane: #35 #36 #38 #41 #125 #126 #127
// #128 #129 #130 #131, and the app side of #33).
//
// bun cannot import a .tsx screen, so the decisions live in one pure marker
// block (`// >>> co-wave3`) that this script transpiles and EXECUTES; the
// wiring around them is pinned structurally. Every structural pin is anchored
// on the new shape AND forbids the old one, so reverting a fix turns it red
// (each was mutation-tested against the pre-fix code).
//
// The ProjectContext round trip of the new columns (tax_rate_pct, tax_amount,
// total_with_tax, prior_approved_changes_total) belongs to the context lane's
// validator, not this one; the migration is executed in PGlite by the lane.

import { readFileSync } from 'fs';
import { join } from 'path';

// Bun's transpiler, reached through globalThis so tsc (which has no bun types
// in this repo) still type-checks this file — same as validate-notification-routes.
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

/** Body of `const name = useCallback(...)` up to its dependency array. */
function callbackBody(src: string, name: string): string {
  const i = src.indexOf(`const ${name} = useCallback(`);
  if (i < 0) return '';
  const rest = src.slice(i);
  const end = rest.search(/\n {2}\}, \[[^\]]*\]\);/);
  return end < 0 ? rest : rest.slice(0, end + rest.slice(end).indexOf(');') + 2);
}

type Status = 'draft' | 'submitted' | 'under_review' | 'approved' | 'rejected' | 'revised' | 'void';
type Line = { name: string; quantity: number; unitPrice: number; total: number };
const B = evalBlock<{
  coRoundCents: (n: number) => number;
  coRoleGate: (o: { hasProject: boolean; role: string | null; isLoading: boolean; isError: boolean; stampedRole?: string | null; ownedLocally?: boolean }) => string;
  coOwnedLocally: (owner: string | null | undefined, user: string | null | undefined) => boolean;
  coEmptyLineDraftBlocker: (d: Record<string, { qty?: string; price?: string } | undefined>, items: { id: string; name: string }[]) => { title: string; message: string } | null;
  coRoleBlockedCopy: (g: string, r: string | null) => { title: string; body: string; canFileReport: boolean };
  coPlainSaveStatus: (req: Status, ex: Status | undefined) => Status;
  coIsOutForApproval: (s: Status | undefined) => boolean;
  coPricedEditChanged: (a: { changeAmount: number; lineItems: Line[] }, b: { changeAmount: number; lineItems: Line[] }) => boolean;
  coSaveMessage: (o: { number: number; isUpdate: boolean; requested: Status; next: Status; recipientInfo: string; pricedEditOnSentCO: boolean }) => { title: string; message: string };
  coDeclineLine: (co: unknown) => { who: string; when: string | null; reason: string | null } | null;
  coLineDraftAccepts: (s: string) => boolean;
  coParseLineDraft: (s: string) => number | null;
  coCommitLineItems: (items: Line[]) => Line[];
  coEstimatePickBasis: (i: { unitCost: number; unitSell: number | null; markupPct: number | null }, seed: number | null, m: (n: number) => string) => string;
  coPriorApprovedChanges: (cos: { id: string; number: number; status: string; changeAmount: number }[], n: number, id: string | null) => number;
  coTaxFreeze: (amt: number, rate: number) => { taxRatePct: number; taxAmount: number; totalWithTax: number };
  coParseImpactDays: (s: string) => number | undefined;
  coImpactDaysNeedsConfirm: (o: { source: string | null; value: string }) => number | null;
  coImpactDaysHelper: (src: string | null, v: string) => string | null;
  coPortalShare: (o: { shareUrl: string | null; showChangeOrders: boolean | undefined; requirePasscode: boolean | undefined; snapshotFits: boolean }) => { portalUrl: string; portalNeedsPasscode: boolean } | null;
}>('app/change-order.tsx', 'co-wave3', [
  'coRoundCents', 'coRoleGate', 'coRoleBlockedCopy', 'coPlainSaveStatus', 'coIsOutForApproval', 'coPricedEditChanged',
  'coSaveMessage', 'coDeclineLine', 'coLineDraftAccepts', 'coParseLineDraft', 'coCommitLineItems', 'coEstimatePickBasis',
  'coPriorApprovedChanges', 'coTaxFreeze', 'coParseImpactDays', 'coImpactDaysNeedsConfirm', 'coImpactDaysHelper', 'coPortalShare',
  'coOwnedLocally', 'coEmptyLineDraftBlocker',
]);

const SRC = read('app/change-order.tsx');
const CODE = stripComments(SRC);
const money = (n: number) => `$${n.toFixed(2)}`;

// ── #41 only the project owner writes change orders ────────────────────────
console.log('\n#41 collaborators see why, before any paywall');
if (B) {
  const g = (o: Partial<{ hasProject: boolean; role: string | null; isLoading: boolean; isError: boolean; stampedRole: string | null; ownedLocally: boolean }>) =>
    B.coRoleGate({ hasProject: true, role: 'owner', isLoading: false, isError: false, ...o });
  ok('owner → the editor', g({}) === 'open');
  ok('field / editor / viewer → blocked as a collaborator', ['field', 'editor', 'viewer'].every(r => g({ role: r }) === 'collaborator'));
  ok('role still loading → loading (a spinner only while loading)', g({ role: null, isLoading: true }) === 'loading');
  ok('role read failed → error (retry), never the editor', g({ role: null, isError: true }) === 'error');
  ok('null role, not loading, no error → NO ACCESS, never a spinner', g({ role: null }) === 'no_access');
  ok('no job yet (sidebar entry) → open; the picker re-gates on the picked job', g({ hasProject: false, role: null, isLoading: true }) === 'open');
  ok('the project list\'s collaborator stamp blocks without waiting on (or despite a failed) role read',
    g({ role: null, isLoading: true, stampedRole: 'field' }) === 'collaborator' && g({ role: null, isError: true, stampedRole: 'editor' }) === 'collaborator');
  ok('…but a missing stamp never opens anything by itself', g({ role: null, isError: true, stampedRole: undefined }) === 'error');
  // Review fix: the OWNER must open offline — the role read fails (native) or
  // pauses (web) with no signal, and the device copy carries ownerUserId.
  ok('owned locally + role read failed (offline, native) → the editor', g({ role: null, isError: true, ownedLocally: true }) === 'open');
  ok('owned locally + role read paused (offline, web) → the editor, never a spinner', g({ role: null, isLoading: true, ownedLocally: true }) === 'open');
  ok('NOT owned locally + role read failed → still error (retry)', g({ role: null, isError: true, ownedLocally: false }) === 'error');
  ok('a collaborator stamp still blocks even if ownership were claimed', g({ role: null, isError: true, stampedRole: 'editor', ownedLocally: true }) === 'collaborator');
  ok('coOwnedLocally needs BOTH ids and a match', B.coOwnedLocally('u1', 'u1') && !B.coOwnedLocally(undefined, 'u1') && !B.coOwnedLocally('u1', undefined) && !B.coOwnedLocally('u1', 'u2') && !B.coOwnedLocally('', ''));
  const field = B.coRoleBlockedCopy('collaborator', 'field');
  ok('a field seat is told the GC writes COs, and to send it as a field issue', /Your GC creates change orders/.test(field.title) && /field issue/.test(field.body) && field.canFileReport);
  ok('…a viewer is told the seat is view-only, with no daily-report action', !B.coRoleBlockedCopy('collaborator', 'viewer').canFileReport);
  ok('the error and no-access states say why', /try again/i.test(B.coRoleBlockedCopy('error', null).body) && /not shared/.test(B.coRoleBlockedCopy('no_access', null).body));
}
{
  const screen = CODE.slice(CODE.indexOf('export default function ChangeOrderScreen'), CODE.indexOf('function CoRoleBlocked'));
  const gateAt = screen.indexOf('coRoleGate(');
  const payAt = screen.indexOf("canAccess('change_orders_invoicing')");
  ok('the role gate runs BEFORE the tier paywall', gateAt > 0 && payAt > gateAt);
  ok('…and the tier check is project-scoped (useProjectAccess), not the bare tier', /useProjectAccess\(gateProjectId\)/.test(screen) && !/useTierAccess\(\)/.test(CODE));
  ok('…with the useProjectRoleState(projectId) call shape the gating contract pins', /useProjectRoleState\(gateProjectId\)/.test(screen));
  ok('the editor re-gates on the job it resolved (picked job / CO-only link)',
    /useProjectRoleState\(project \? projectId : undefined\)/.test(CODE) && /if \(project && innerRoleGate !== 'open'\)/.test(CODE));
  ok('the blocked view routes the extra work to a daily report the owner reads, carrying the description',
    /pathname: '\/daily-report'/.test(CODE) && /params: prefillDescription \? \{ projectId, fieldIssue: prefillDescription \} : \{ projectId \}/.test(CODE) && /testID="co-collab-daily-report"/.test(CODE));
  ok('BOTH gates feed the device-stored owner into coRoleGate (offline owner)',
    (CODE.match(/ownedLocally: coOwnedLocally\(/g) ?? []).length === 2 && /ownerUserId : undefined, authUser\?\.id\)/.test(CODE) && /coOwnedLocally\(project\?\.ownerUserId, authUser\?\.id\)/.test(CODE));
}

// ── #38 a plain save keeps a sent CO's status ──────────────────────────────
console.log('\n#38 Save to Project never drops a sent CO back to draft');
if (B) {
  for (const s of ['submitted', 'under_review', 'revised'] as Status[]) {
    ok(`a plain save keeps ${s}`, B.coPlainSaveStatus('draft', s) === s);
  }
  ok('a draft stays a draft; a new CO takes what was asked', B.coPlainSaveStatus('draft', 'draft') === 'draft' && B.coPlainSaveStatus('draft', undefined) === 'draft' && B.coPlainSaveStatus('submitted', undefined) === 'submitted');
  ok('a real submission still submits', B.coPlainSaveStatus('submitted', 'draft') === 'submitted');
  const L = (p: number): Line[] => [{ name: 'Outlet', quantity: 2, unitPrice: p, total: 2 * p }];
  ok('a typo fix is not a priced edit', !B.coPricedEditChanged({ changeAmount: 100, lineItems: L(50) }, { changeAmount: 100, lineItems: L(50) }));
  ok('a price change is', B.coPricedEditChanged({ changeAmount: 100, lineItems: L(50) }, { changeAmount: 110, lineItems: L(55) }));
  const kept = B.coSaveMessage({ number: 4, isUpdate: true, requested: 'draft', next: 'submitted', recipientInfo: '', pricedEditOnSentCO: false });
  ok('the message says it is still awaiting approval, not "saved to project"', /still awaiting approval/.test(kept.message) && !/saved to (the )?project/.test(kept.message), kept.message);
  const priced = B.coSaveMessage({ number: 4, isUpdate: true, requested: 'draft', next: 'under_review', recipientInfo: '', pricedEditOnSentCO: true });
  ok('a priced edit on a sent CO warns that the client sees the old numbers until he re-sends', /still sees the numbers you sent until you re-send/.test(priced.message));
}
{
  const persist = callbackBody(CODE, 'persistCO');
  const upd = persist.slice(persist.indexOf('updateChangeOrder(existingCO.id'), persist.indexOf('return { id: existingCO.id'));
  ok('the update writes status only when it changes', /\.\.\.\(nextStatus !== existingCO\.status \? \{ status: nextStatus \} : \{\}\)/.test(upd));
  ok('…and never the requested status unconditionally (the old `status,`)', !/\n\s*status,\n/.test(upd), upd.slice(0, 400));
  ok('handleSave shows coSaveMessage for an update', /coSaveMessage\(\{/.test(callbackBody(CODE, 'handleSave')));
}

// ── #125 the client's decline is shown ─────────────────────────────────────
console.log('\n#125 a declined CO says who, when and why');
if (B) {
  const viaApprover = B.coDeclineLine({
    status: 'rejected',
    approvers: [
      { role: 'Client', status: 'rejected', name: 'Dana Ruiz', responseDate: '2026-09-10T15:00:00Z', rejectionReason: 'Too expensive' },
      { role: 'Architect', status: 'approved', name: 'A' },
    ],
  });
  ok('from the rejected Client approver', viaApprover?.who === 'Dana Ruiz' && viaApprover?.reason === 'Too expensive' && viaApprover?.when === '2026-09-10T15:00:00Z');
  const viaTrail = B.coDeclineLine({
    status: 'rejected',
    auditTrail: [
      { action: 'declined_via_portal', actor: 'Old', timestamp: '2026-09-01T00:00:00Z', detail: 'Note: first' },
      { action: 'declined_via_portal', actor: 'Dana', timestamp: '2026-09-12T00:00:00Z', detail: 'Note: Wait for spring' },
      { action: 'viewed', actor: 'Dana', timestamp: '2026-09-13T00:00:00Z' },
    ],
  });
  ok('else from the newest portal decline, with "Note: " stripped', viaTrail?.who === 'Dana' && viaTrail?.reason === 'Wait for spring');
  ok('no reason → null reason (the card says "No reason given")', B.coDeclineLine({ status: 'rejected', auditTrail: [{ action: 'declined_via_portal', actor: 'D', timestamp: 't' }] })?.reason === null);
  ok('not rejected → nothing', B.coDeclineLine({ status: 'approved', approvers: [{ role: 'Client', status: 'rejected' }] }) === null);
  ok('the card renders it with a calendar-day date, and his own field is "Reason for change"',
    /Declined by \{declineLine\.who\}/.test(CODE) && /formatCalendarDay\(calendarDayOf\(declineLine\.when\)/.test(CODE) && /No reason given\./.test(CODE)
    && /Reason for change: \{existingCO\.reason\}/.test(CODE) && !/>Reason: \{existingCO\.reason\}/.test(CODE));
}

// ── #126 cents and credits can be typed ────────────────────────────────────
console.log('\n#126 Qty / Price take cents, a minus, and round to the cent');
if (B) {
  ok('partial numbers are accepted while typing', ['45.', '-', '.5', '-12.50', '', '2.5'].every(B.coLineDraftAccepts));
  ok('letters and a second point are refused', !['4a', '1.2.3', '--1', '$5'].some(B.coLineDraftAccepts));
  ok('an empty / "-" / "." draft holds no number (never snapped to 0)', B.coParseLineDraft('') === null && B.coParseLineDraft('-') === null && B.coParseLineDraft('.') === null);
  ok('"45." is 45 and "-12.5" is -12.5', B.coParseLineDraft('45.') === 45 && B.coParseLineDraft('-12.5') === -12.5);
  const c = B.coCommitLineItems([{ name: 'x', quantity: 3, unitPrice: 45.123456789, total: 0 }])[0];
  ok('commit rounds the price and the total to cents', c.unitPrice === 45.12 && c.total === 135.36, JSON.stringify(c));
  ok('a credit line commits negative', B.coCommitLineItems([{ name: 'x', quantity: 1, unitPrice: -250.005, total: 0 }])[0].total === -250.01 || B.coCommitLineItems([{ name: 'x', quantity: 1, unitPrice: -250.005, total: 0 }])[0].total === -250);
}
{
  const qty = callbackBody(CODE, 'handleUpdateItemQty');
  const price = callbackBody(CODE, 'handleUpdateItemPrice');
  ok('the handlers no longer parseFloat(...) || 0 every keystroke', !/parseFloat\((qty|price)Str\) \|\| 0/.test(qty + price));
  ok('the boxes render the draft, not the number', /value=\{lineDrafts\[item\.id\]\?\.price \?\? item\.unitPrice\.toFixed\(2\)\}/.test(CODE) && !/value=\{item\.unitPrice\.toString\(\)\}/.test(CODE) && !/value=\{item\.quantity\.toString\(\)\}/.test(CODE));
  ok('…and commit to cents on blur', /onBlur=\{\(\) => commitLineDraft\(item\.id, 'price'\)\}/.test(CODE));
  ok('the save commits every line to cents', /const committedLines = coCommitLineItems\(lineItems\)/.test(CODE) && /lineItems: committedLines/.test(CODE));
  const lines = [{ id: 'a', name: 'Drywall' }, { id: 'b', name: '' }];
  if (B) {
  ok('an emptied price box refuses the save, naming the line', /Drywall has no price/.test(B.coEmptyLineDraftBlocker({ a: { price: '' } }, lines)?.title ?? ''));
  ok('"-" / "." in qty refuses too; an unnamed line is "Line N"', /Line 2 has no quantity/.test(B.coEmptyLineDraftBlocker({ b: { qty: '-' } }, lines)?.title ?? '') && !!B.coEmptyLineDraftBlocker({ a: { qty: '.' } }, lines));
  ok('a draft holding a number (or no draft) never blocks', B.coEmptyLineDraftBlocker({ a: { price: '45.' }, b: { qty: '2' } }, lines) === null && B.coEmptyLineDraftBlocker({}, lines) === null);
  }
  ok('Save/Send & Save refuse an emptied box BEFORE any write or email',
    (CODE.match(/\?\? coEmptyLineDraftBlocker\(lineDrafts, lineItems\)/g) ?? []).length === 2);
  ok('…and so does Issue as CCD', /coEmptyLineDraftBlocker\(lineDrafts, lineItems\)/.test(callbackBody(CODE, 'handleIssueAsCcd')));
  ok('Materials-added prices are rounded to cents', /const finalPrice = coRoundCents\(price \* \(1 \+ markup \/ 100\)\);/.test(callbackBody(CODE, 'handleAddFromMaterials')));
}

// ── #127 the picker's basis text tells the truth ───────────────────────────
console.log('\n#127 "+ your N% markup" only where it is applied');
if (B) {
  const atCost = B.coEstimatePickBasis({ unitCost: 80, unitSell: 80, markupPct: 0 }, 20, money);
  ok('an at-cost line (unitSell set, markup 0) never claims his markup', !/your 20% markup/.test(atCost) && /at your cost — no markup on the signed estimate/.test(atCost), atCost);
  ok('…nor with a null per-line markup', !/markup —/.test(B.coEstimatePickBasis({ unitCost: 80, unitSell: 80, markupPct: null }, 20, money)));
  ok('a signed-rate line keeps its text', /\+ 25% — the rate on the signed estimate/.test(B.coEstimatePickBasis({ unitCost: 80, unitSell: 100, markupPct: 25 }, 20, money)));
  ok('a legacy cost-only line (unitSell null) says his markup, where it IS applied', /your 20% markup/.test(B.coEstimatePickBasis({ unitCost: 80, unitSell: null, markupPct: null }, 20, money)));
  ok('the picker renders coEstimatePickBasis', /coEstimatePickBasis\(item, /.test(CODE));
}

// ── #128 an AI / voice schedule impact is confirmed before it goes out ─────
console.log('\n#128 a guessed schedule impact is marked and confirmed');
if (B) {
  ok('an untouched AI fill needs confirming', B.coImpactDaysNeedsConfirm({ source: 'ai', value: '3' }) === 3);
  ok('…so does a voice fill', B.coImpactDaysNeedsConfirm({ source: 'voice', value: '2' }) === 2);
  ok('his own number (or a seeded one) does not', B.coImpactDaysNeedsConfirm({ source: 'user', value: '3' }) === null && B.coImpactDaysNeedsConfirm({ source: null, value: '3' }) === null);
  ok('an empty box needs nothing', B.coImpactDaysNeedsConfirm({ source: 'ai', value: '' }) === null);
  ok('the helper names the source', /^AI estimate: \+3 days/.test(B.coImpactDaysHelper('ai', '3') ?? '') && /^Heard: \+2 days/.test(B.coImpactDaysHelper('voice', '2') ?? '') && B.coImpactDaysHelper('user', '2') === null);
}
{
  ok('neither fill writes the box unmarked any more', !/setScheduleImpactDays\(prev => prev \|\|/.test(CODE)
    && /fillImpactDaysIfEmpty\(res\.scheduleDays, 'ai'\)/.test(CODE) && /fillImpactDaysIfEmpty\(partial\.scheduleImpactDays, 'voice'\)/.test(CODE));
  ok('typing marks it his', /onChangeText=\{onImpactDaysTyped\}/.test(CODE));
  ok('Save, Send & Save and the G714 all confirm first',
    /onPress=\{\(\) => withConfirmedImpactDays\(\(\) => handleSave\('draft'\)\)\}/.test(CODE)
    && /withConfirmedImpactDays\(\(\) => setShowSendRecipient\(true\)\)/.test(CODE)
    && /withConfirmedImpactDays\(\(\) => showAlert\(\s*'Issue as Construction Change Directive\?'/.test(CODE));
  ok('the confirm asks "The client signs +N days — keep it?"', /The client signs \+\$\{days\} day\$\{plural\} — keep it\?/.test(CODE));
}

// ── #129 the contract rows are the AIA G701 rows ───────────────────────────
console.log('\n#129 Original contract sum / prior approved COs / contract prior to this CO');
if (B) {
  const cos = [
    { id: 'a', number: 1, status: 'approved', changeAmount: 5000 },
    { id: 'b', number: 2, status: 'approved', changeAmount: 3000 },
    { id: 'c', number: 3, status: 'submitted', changeAmount: 900 },
  ];
  ok('CO #3 counts the approved COs below it', B.coPriorApprovedChanges(cos, 3, 'c') === 8000);
  ok('reopening CO #1 does NOT pull in the later CO #2', B.coPriorApprovedChanges(cos, 1, 'a') === 0);
  ok('a new CO (next number) counts all approved', B.coPriorApprovedChanges(cos, 4, null) === 8000);
}
{
  ok('the card labels are the G701 rows, not "Original Contract"',
    /Original contract sum/.test(CODE) && /Net change by prior approved COs/.test(CODE) && /Contract sum prior to this CO/.test(CODE)
    && !/>Original Contract</.test(CODE));
  ok('the old "every other approved CO" filter is gone', !/c\.status === 'approved' && c\.id !== coId\)/.test(CODE)
    // wave 4 #141: computed against the server-confirmed number once known.
    && /coPriorApprovedChanges\(existingCOs, baseNumber, coId\)/.test(CODE)
    && /const baseNumber = confirmedNumber \?\? nextCoNumber;/.test(CODE));
  ok('originalContractValue keeps its stored meaning (contract before this CO)', /coRoundCents\(originalContractSum \+ priorApprovedChanges\)/.test(CODE));
}

// ── #130 the G714 carries his days ─────────────────────────────────────────
console.log('\n#130 the CCD prints the schedule days he entered');
if (B) {
  ok('one parse: 4 → 4, "" / 0 / junk → undefined (to be determined)', B.coParseImpactDays('4') === 4 && B.coParseImpactDays('') === undefined && B.coParseImpactDays('0') === undefined && B.coParseImpactDays('x') === undefined);
}
{
  const ccd = callbackBody(CODE, 'generateCcd');
  ok('generateCcd passes the parsed days', /estimatedTimeAdjustmentDays: parsedImpactDays/.test(ccd) && !/estimatedTimeAdjustmentDays: undefined/.test(ccd));
  ok('…and re-creates when they change (no stale value)', /\}, \[project, settings, description, lineItems, nextCoNumber, parsedImpactDays\]\);/.test(CODE));
  ok('the CCD action reads the CURRENT generateCcd', /\}, \[project, description, lineDrafts, lineItems, withConfirmedImpactDays, generateCcd\]\);/.test(CODE)
    && CODE.indexOf('const generateCcd = useCallback(') < CODE.indexOf('const handleIssueAsCcd = useCallback('));
  ok('the save uses the same parse', /const impactDays = parsedImpactDays;/.test(CODE));
}

// ── #131 the tax is frozen on send ─────────────────────────────────────────
console.log('\n#131 tax frozen on the CO when it goes out');
if (B) {
  const t = B.coTaxFreeze(5000, 8.25);
  ok('$5,000 at 8.25% → $412.50 tax, $5,412.50 total', t.taxAmount === 412.5 && t.totalWithTax === 5412.5 && t.taxRatePct === 8.25);
  const cr = B.coTaxFreeze(-1000.1, 7);
  ok('a credit CO is sign-aware, to the cent', cr.taxAmount === -70.01 && cr.totalWithTax === -1070.11, JSON.stringify(cr));
  ok('no rate → no tax, total = amount', B.coTaxFreeze(1234.565, 0).taxAmount === 0 && B.coTaxFreeze(1234.56, 0).totalWithTax === 1234.56);
  ok('odd cents round to whole cents', B.coTaxFreeze(99.99, 6.625).taxAmount === 6.62);
}
{
  const persist = callbackBody(CODE, 'persistCO');
  ok('persistCO freezes the tax for any non-draft save, at the frozen rate first',
    /nextStatus !== 'draft'\s*\?\s*coTaxFreeze\(committedAmount, existingFrozenTaxRate \?\? liveTaxRatePct\)/.test(persist));
  ok('…and writes it on both the update and the new CO', (persist.match(/\.\.\.frozen,/g) ?? []).length === 2);
  ok('"Mark submitted" freezes it too', /next === 'submitted' && existingFrozenTaxRate == null\s*\?\s*coTaxFreeze\(existingCO\.changeAmount, liveTaxRatePct\)/.test(CODE));
  ok('the screen reads the frozen rate over live settings', /const taxRatePct = existingFrozenTaxRate \?\? liveTaxRatePct;/.test(CODE));
  ok('the note no longer promises an approved total the email never showed', !/shown here so the total you approve matches what gets invoiced/.test(CODE));
  ok('the email options carry the frozen tax', /taxAmount: sendTax\.taxAmount,/.test(CODE) && /totalWithTax: sendTax\.totalWithTax,/.test(CODE));
  // Integration critic money-portal: no invoice path reads the frozen rate (an
  // invoice carries ONE rate, from Settings when it is created), so the note
  // may not promise that the approved incl.-tax total is what gets billed.
  ok('the note does not promise the approved total is what gets invoiced', !/is the one that gets invoiced/.test(CODE) && !/total your client approve[sd]? is the one/.test(CODE));
  ok('…it says the bill is taxed at the Settings rate on the day he bills it', (CODE.match(/at your Settings rate on that day/g) ?? []).length === 2);
  const bill = stripComments(read('app/bill-from-estimate.tsx'));
  ok('Bill from estimate: subtotal, tax and total are to the cent',
    /const subtotal = useMemo\(\(\) => roundCents\(Object\.values\(amountsByKey\)/.test(bill)
    && /const taxAmount = roundCents\(subtotal \* \(taxRate \/ 100\)\);/.test(bill)
    && /const totalDue = roundCents\(subtotal \+ taxAmount\);/.test(bill));
}

// ── money-portal critic: leak auto-drafts are the OWNER's (#41 rule) ──────
console.log('\nmoney-portal critic — the leak sweep drafts only on his own jobs');
{
  const leak = read('utils/brain/leakCoDraft.ts');
  ok('collectDraftableLeaks requires the user and skips a job he does not own',
    /userId: string \| null \| undefined;/.test(leak) && /if \(!userId\) return \[\];/.test(leak) && /if \(!isLeakDraftOwner\(project, userId\)\) continue;/.test(leak));
  ok('the sweep hook passes the signed-in user', /userId: user\?\.id,/.test(read('hooks/useLeakCoDrafts.ts')));
}

// ── #35 Send & Save shares the CO to the portal it names ───────────────────
console.log('\n#35 Send & Save puts the CO on the portal the email names');
if (B) {
  const base = { shareUrl: 'https://mageid.app/portal/p?t=x', showChangeOrders: true as boolean | undefined, requirePasscode: false, snapshotFits: true };
  ok('portal on + link + CO section → the link', B.coPortalShare(base)?.portalUrl === base.shareUrl);
  ok('no working link → reply-by-email only', B.coPortalShare({ ...base, shareUrl: null }) === null);
  ok('CO section hidden (or unset) → reply-by-email only', B.coPortalShare({ ...base, showChangeOrders: false }) === null && B.coPortalShare({ ...base, showChangeOrders: undefined }) === null);
  ok('a CO too large to freeze → reply-by-email only', B.coPortalShare({ ...base, snapshotFits: false }) === null);
  ok('a passcode portal is flagged for the email', B.coPortalShare({ ...base, requirePasscode: true })?.portalNeedsPasscode === true);
}
{
  const send = callbackBody(CODE, 'handleConfirmSend');
  const emailAt = send.indexOf('await sendEmail(');
  const eligAt = send.indexOf('coPortalShare({');
  const raceAt = send.indexOf('await Promise.race');
  const shareAt = send.indexOf('shareSavedCOToPortal(saved.id');
  const reportAt = send.indexOf('coSendReport({');
  ok('portal eligibility is decided BEFORE the email goes out', eligAt > 0 && eligAt < emailAt);
  ok('the share runs after the write, before the report', shareAt > raceAt && reportAt > shareAt);
  ok('…only for a real send MAGE did not refuse', /sent && portal && saved\.status === 'submitted' && write !== 'failed'/.test(send));
  ok('the email gets the portal link only through that decision', /portalUrl: portal\?\.portalUrl,/.test(send));
  ok('the report says whether the portal share happened', /portal: portalOutcome,/.test(send));
  const share = callbackBody(CODE, 'shareSavedCOToPortal');
  ok('the share waits for a render holding THIS write, then calls the fresh closure',
    /c\.updatedAt !== priorUpdatedAt/.test(share) && /sendToPortalRef\.current\(\{ kind: 'change_order', itemId: id, projectId \}\)/.test(share));
}

// ── #36 the portal send is reachable ───────────────────────────────────────
console.log('\n#36 the portal send sits above Save / Send & Save, not under them');
{
  const dockAt = CODE.indexOf('<View style={styles.bottomDock} onLayout={onBottomBarLayout}>');
  const sendInDock = CODE.indexOf('<SendToClientButton', dockAt);
  const saveAt = CODE.indexOf('testID="save-co-draft"');
  const billAt = CODE.indexOf('testID="bill-change-order-btn"');
  ok('one measured absolute dock holds the portal send, then Save / Send & Save and the bill bar',
    dockAt > 0 && sendInDock > dockAt && saveAt > sendInDock && billAt > sendInDock);
  ok('the bars inside it are no longer absolute themselves',
    /bottomBar: \{ backgroundColor/.test(CODE) && /coBillBar: \{ backgroundColor/.test(CODE) && /bottomDock: \{ position: 'absolute', bottom: 0/.test(CODE));
  ok('only the dock is measured (one onLayout for the bar height)', (CODE.match(/onLayout=\{onBottomBarLayout\}/g) ?? []).length === 1);
  ok('the CCD row sits on the measured dock, not a fixed 76', /style=\{\[styles\.ccdRow, \{ bottom: bottomBarH \}\]\}/.test(CODE) && !/bottom: 76/.test(CODE));
  ok('rejected / void keep the in-flow portal control', /existingCO\.status === 'rejected' \|\| existingCO\.status === 'void'\) && \(\s*<SendToClientButton/.test(CODE));
}

// ── #33 (app side) no portal send of a draft ───────────────────────────────
console.log('\n#33 the portal send waits for a submitted CO');
// wave 4 #73: the gate moved into the pure coPortalSendGate (co-w4 block),
// which also refuses rejected/void — the draft rule is unchanged.
ok('a draft cannot be sent to the portal, with the reason', /if \(o\.status === 'draft'\) \{\s*return \{ canSend: false, reason: 'Submit this change order for approval first/.test(CODE)
  && /return coPortalSendGate\(\{/.test(CODE)
  && (CODE.match(/canSend=\{portalSendGate\.canSend\}/g) ?? []).length === 2);

// ── the migration ──────────────────────────────────────────────────────────
console.log('\nmigration 20260919110000');
{
  const mig = read('supabase/migrations/20260919110000_change_orders_owner_insert_and_tax_freeze.sql');
  ok('BOTH permissive insert policies are replaced with the owner check',
    /drop policy if exists change_orders_insert/.test(mig) && /drop policy if exists co_insert_own/.test(mig)
    && (mig.match(/p\.user_id = auth\.uid\(\)/g) ?? []).length === 2);
  ok('the four frozen columns, money at numeric(12,2)',
    /add column if not exists tax_rate_pct numeric;/.test(mig)
    && ['tax_amount', 'total_with_tax', 'prior_approved_changes_total'].every(c => new RegExp(`add column if not exists ${c} numeric\\(12,2\\);`).test(mig)));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
