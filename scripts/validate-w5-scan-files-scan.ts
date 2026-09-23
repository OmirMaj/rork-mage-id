// validate-w5-scan-files-scan.ts — Scan Anything files what it read (wave 5).
//
// Pins the pure halves app/scan.tsx runs, plus source guards for the wiring
// that cannot run under bun:
//   #64  every page is filed under one stem; success only when all land
//   #63  a scanned sub bill books against his subcontract (the vendor match),
//        and projectedFinal stays at the contract value
//   #33  the COI picker lists subs with an empty assignedProjects; a readable
//        expiry becomes a coverage so the sub's coi_expiry moves
//   #162 a permit / warranty creates its record; dates are never guessed
//   #163 the project is worked out at use time; the picker shows when empty
//   #66  records store the bare project-documents PATH, never the signed URL
//   #68  a too-large scan is refused before the call; cap codes → upgrade path
//
// Run: bun run scripts/validate-w5-scan-files-scan.ts
import { readFileSync } from 'node:fs';
import {
  resolveDestination, scanPageFileName, scanPayloadTooLarge, coiPickerSubs, scanCoiCoverages,
  coiCoverageType, buildScanPermit, buildScanWarranty, warrantyMonthsFromTerm, scanCalendarDay,
  buildScanReceipt, scanFiledMessage, recordKindPhrase, SCAN_MAX_BYTES_TOTAL, scanOwnerOnlyGate,
  materialReceiptOwnerGate,
} from '../utils/scanRouting';
import { linkableCommitments, autoLinkCommitment, commitmentCounterparty } from '../utils/commitmentLinking';
import { computeJobCost } from '../utils/jobCostEngine';
import type { Commitment, Project, Subcontractor } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
function eq<T>(name: string, got: T, want: T) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got:  ${JSON.stringify(got)}\n      want: ${JSON.stringify(want)}`);
}
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const SCAN = strip(readFileSync('app/scan.tsx', 'utf8'));

// ── #64 multi-page ──────────────────────────────────────────────────────────
console.log('\n#64 every page is filed:');
{
  const names = [0, 1, 2].map(i => scanPageFileName('COI — Northline Electric', 1700000000000, i, 'image/jpeg'));
  eq('pages share one stem and number in order', names,
    ['COI_Northline_Electric-1700000000000-p1.jpg', 'COI_Northline_Electric-1700000000000-p2.jpg', 'COI_Northline_Electric-1700000000000-p3.jpg']);
  ok('the extension follows the mime type', scanPageFileName('X', 1, 0, 'image/png').endsWith('-p1.png'));
  const long = scanPageFileName('COI — Northline Electric Company Incorporated of the Greater Denver Metro Area', 1700000000000, 5, 'image/jpeg');
  ok('a long title keeps the -pN suffix inside the 80-char storage cap', long.length <= 80 && long.endsWith('-p6.jpg'), long);
  ok('scan.tsx uploads EVERY capture, not captures[0]',
    /for \(let i = 0; i < captures\.length; i\+\+\)/.test(SCAN) && !/captures\[0\]/.test(SCAN));
  ok('…skips pages already landed on a retry', /if \(next\[i\]\) continue;/.test(SCAN));
  ok('…and succeeds only when every page landed', /if \(done < total\)/.test(SCAN) && /Filed \$\{done\} of \$\{total\} pages/.test(SCAN));
  ok('the captures are cleared only after the all-landed branch',
    SCAN.indexOf('setCaptures([]);', SCAN.indexOf('if (done < total)')) > SCAN.indexOf('if (done < total)'));
  ok('every page path is kept on the ScanRecord (fields._pages)', /_pages: pages\.map\(p => p\.path\)/.test(SCAN));
  // Integration round 1: after a partial filing, removing an unfiled page
  // cleared the result — a re-scan is another charged AI call that resets
  // `landed` and the stem, so the filed pages uploaded again (duplicates).
  {
    const rm = SCAN.slice(SCAN.indexOf('const removeCapture = useCallback('), SCAN.indexOf('const runScan = useCallback('));
    ok('removing a page is refused once any page landed (before result is cleared)',
      /if \(landedCount > 0\) \{[\s\S]*?showAlert\([\s\S]*?return;\s*\}/.test(rm)
      && rm.indexOf('if (landedCount > 0)') > -1 && rm.indexOf('if (landedCount > 0)') < rm.indexOf('setResult(null)'));
    ok('…and the Start over way out it names is rendered while pages sit filed',
      /\{!saved && landedCount > 0 && \([\s\S]*?onPress=\{scanAnother\}[\s\S]*?Start over/.test(SCAN));
  }
  // Review round 1: a 0-byte object a field seat can't delete holds the name
  // for good — the page moves to a new name instead of colliding forever.
  eq('a retry after an undeletable 0-byte landing moves that page to -pN-rA',
    [scanPageFileName('X', 7, 1, 'image/jpeg', 0), scanPageFileName('X', 7, 1, 'image/jpeg', 2)], ['X-7-p2.jpg', 'X-7-p2-r2.jpg']);
  ok('…still inside the 80-char storage cap', scanPageFileName('Y'.repeat(90), 1700000000000, 5, 'image/jpeg', 9).length <= 80);
  ok('scan.tsx bumps the page attempt only on a 0-byte copy that was NOT removed',
    /if \(e instanceof ProjectFileEmptyError && !e\.removed\) \{\s*pageAttemptRef\.current\[i\] = \(pageAttemptRef\.current\[i\] \?\? 0\) \+ 1;/.test(SCAN)
    && /scanPageFileName\(title, stamp, i, c\.mimeType, pageAttemptRef\.current\[i\] \?\? 0\)/.test(SCAN));
}

// ── #5 bytes (scan side; the byte guard itself is validate-pdf-bytes) ──────
console.log('\n#5 scan uploads real bytes:');
ok('scan.tsx reads the capture base64 (or readFileBytes), never fetch().blob()',
  /c\.base64 \? base64ToBytes\(c\.base64\) : await readFileBytes\(c\.uri\)/.test(SCAN) && !/\.blob\(\)/.test(SCAN));

// ── #66 carry: paths, not signed URLs ───────────────────────────────────────
console.log('\n#66 records keep the storage path:');
ok('the COI stores page 1 PATH in fileUri', /fileUri: first\?\.path \?\? ''/.test(SCAN));
ok('the receipt stores the path as imagePath', /imagePath: first\?\.path/.test(SCAN));
ok('scan.tsx never persists uploaded.publicUrl', !/publicUrl/.test(SCAN));

// ── #63 the bill books against the commitment ───────────────────────────────
console.log('\n#63 a scanned sub bill pays down the subcontract:');
{
  const subs = [{ id: 'sub-n', companyName: 'Northline Electric', assignedProjects: [] } as unknown as Subcontractor];
  const sc = {
    id: 'sc-ap', projectId: 'p4', number: 'SC-9', type: 'subcontract', subcontractorId: 'sub-n',
    description: 'Electrical', amount: 20_000, phase: 'Electrical', status: 'active',
    signedDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as unknown as Commitment;
  const draft = { ...sc, id: 'sc-draft', status: 'draft' } as Commitment;
  const other = { ...sc, id: 'sc-other', projectId: 'p9' } as Commitment;
  const linkable = linkableCommitments([sc, draft, other], 'p4');
  eq('drafts and other jobs are not linkable', linkable.map(c => c.id), ['sc-ap']);
  eq('a subcontract with no vendorName is named from the roster', commitmentCounterparty(sc, subs), 'Northline Electric');
  const fields = {
    vendor: 'Northline Electric', date: '2026-03-01', docNumber: 'INV-7',
    lines: [{ description: 'Rough-in', qty: 1, unit: 'ls', unitPrice: 6000, lineTotal: 6000 }],
    subtotal: 6000, tax: 0, total: 6000,
  };
  const auto = autoLinkCommitment(fields.vendor, linkable, subs);
  eq('an exact vendor match picks the subcontract', auto, 'sc-ap');
  const receipt = buildScanReceipt(fields, { projectId: 'p4', commitmentId: auto, imagePath: 'p4/financials/a-p1.jpg', linesShown: true });
  eq('the receipt lands with that commitmentId', receipt.commitmentId, 'sc-ap');
  eq('…and stores the path, not a URL', receipt.imageUri, 'p4/financials/a-p1.jpg');
  const proj = {
    id: 'p4', name: 'AP', status: 'in_progress',
    linkedEstimate: { id: 'e', items: [{
      materialId: 'x1', name: 'Electrical', category: 'Electrical', unit: 'ls', quantity: 1,
      unitPrice: 20_000, bulkPrice: 20_000, markup: 0, usesBulk: false, lineTotal: 20_000, supplier: '',
    }], globalMarkup: 0, baseTotal: 20_000, markupTotal: 0, grandTotal: 20_000, createdAt: '2026-01-01T00:00:00.000Z' },
  } as unknown as Project;
  const linked = computeJobCost({ project: proj, commitments: [sc], changeOrders: [], receipts: [receipt] });
  ok('projectedFinal stays at the $20,000 contract value', Math.abs(linked.projectedFinal - 20_000) < 0.005, String(linked.projectedFinal));
  const unlinkedReceipt = buildScanReceipt(fields, { projectId: 'p4', linesShown: true });
  const unlinked = computeJobCost({ project: proj, commitments: [sc], changeOrders: [], receipts: [unlinkedReceipt] });
  ok('(control) unlinked, the same bill double-counts to $26,000', Math.abs(unlinked.projectedFinal - 26_000) < 0.005, String(unlinked.projectedFinal));
  eq('a near-miss name does not claim the commitment', autoLinkCommitment('Northline Electric LLC', linkable, subs) ?? 'none', 'none');
  eq('lines shown → reviewed', receipt.status, 'reviewed');
  eq('lines never shown → stays extracted', buildScanReceipt(fields, { projectId: 'p4', linesShown: false }).status, 'extracted');
  ok('scan.tsx passes the chosen/auto commitment into the receipt',
    /commitmentId: effectiveCommitmentId/.test(SCAN) && /autoLinkCommitment\(str\(editedFields\.vendor\), linkable, subcontractors\)/.test(SCAN));
  ok('…labels the auto pick as a guess, with a None — direct cost chip',
    /matched by vendor name/.test(SCAN) && /None — direct cost/.test(SCAN));
  ok('scan.tsx no longer stamps reviewed by hand', !/receipt\.status = 'reviewed'/.test(SCAN));
}

// ── #33 COI → sub ───────────────────────────────────────────────────────────
console.log('\n#33 a scanned COI reaches the sub:');
{
  const S = (id: string, companyName: string, assignedProjects?: string[]) => ({ id, companyName, assignedProjects } as unknown as Subcontractor);
  const subs = [S('a', 'Zeta Framing', []), S('b', 'Northline Electric, LLC', undefined), S('c', 'Alder Mechanical', ['p1']), S('d', 'Other Job Co', ['p2'])];
  const pick = coiPickerSubs(subs, 'p1', 'NORTHLINE ELECTRIC');
  eq('subs with an empty assignedProjects are offered; other jobs\' subs are not', pick.subs.map(s => s.id), ['c', 'b', 'a']);
  eq('the insured name pre-selects its sub (legal suffix folded)', pick.matchId, 'b');
  eq('two subs with the same name pre-select nothing',
    coiPickerSubs([S('x', 'Dup Co'), S('y', 'Dup')], 'p1', 'Dup').matchId, '');
  eq('a scanned expiry becomes a coverage', scanCoiCoverages({
    insured: 'Northline', carrier: 'Acme Mutual', policyNumber: 'GL-1', coverageType: 'General Liability',
    effectiveDate: '2026-01-01', expiresDate: '2027-01-01',
  }), [{ type: 'general_liability', expiresAt: '2027-01-01', carrierName: 'Acme Mutual', policyNumber: 'GL-1', effectiveDate: '2026-01-01' }]);
  eq('a printed, unparsed expiry writes NO coverage', scanCoiCoverages({ expiresDate: '1/1/27' }), []);
  eq('an impossible day writes NO coverage', scanCoiCoverages({ expiresDate: '2027-02-30' }), []);
  eq('coverage types map', ['Workers Comp', 'Auto', 'Umbrella', 'Pollution'].map(coiCoverageType), ['workers_comp', 'auto', 'umbrella', 'other']);
  ok('scan.tsx writes the coverages onto the COI', /coverages: scanCoiCoverages\(fields\)/.test(SCAN));
  ok('scan.tsx no longer filters subs by assignedProjects.includes alone',
    !/subcontractors\.filter\(s => s\.assignedProjects\?\.includes\(projectId\)\)/.test(SCAN));
  ok('an empty sub list still shows the block, says why, and links to Subs',
    /No subs yet — add one in Subs to file this as compliance/.test(SCAN) && /\/\(tabs\)\/subs/.test(SCAN));
}

// ── #162 permit / warranty ──────────────────────────────────────────────────
console.log('\n#162 a scanned permit / warranty becomes a record:');
{
  const ctx = { projectId: 'p1', projectName: 'Maple', fileName: 'Permit_B-1-1-p1.jpg' };
  const issued = buildScanPermit({ permitNumber: 'B-1', type: 'Electrical', jurisdiction: 'Denver', issuedDate: '2026-04-02', expiresDate: '2027-04-02', address: '1 Main' }, ctx);
  // Review round 1: the card prints the ISSUE day, never when he applied —
  // appliedDate = issue day said "Applied <issue day>" and fed the learned
  // permit lead time a fake 0-day review.
  eq('an issued permit is approved on its issue day; the application date stays blank', [issued.status, issued.approvedDate, issued.appliedDate], ['approved', '2026-04-02', '']);
  eq('type / number / jurisdiction / expiry carried', [issued.type, issued.permitNumber, issued.jurisdiction, issued.expiresDate], ['electrical', 'B-1', 'Denver', '2027-04-02']);
  ok('the file is referenced in notes, not attachmentUri (a project-photos path field)',
    /Permits › Permit_B-1-1-p1\.jpg/.test(issued.notes ?? '') && !('attachmentUri' in issued));
  const unread = buildScanPermit({ permitNumber: 'B-2', issuedDate: 'April 2', expiresDate: 'n/a' }, ctx);
  eq('no readable issue date → applied, no dates invented', [unread.status, unread.appliedDate, unread.approvedDate ?? null, unread.expiresDate ?? null], ['applied', '', null, null]);
  eq('term parsing', [warrantyMonthsFromTerm('10 years'), warrantyMonthsFromTerm('18 months'), warrantyMonthsFromTerm('lifetime')], [120, 18, null]);
  const w = buildScanWarranty({ product: 'Asphalt shingle roof', provider: 'GAF', term: '10 years', startDate: '2026-01-31' }, ctx);
  ok('a warranty with a start + term is built', w.ok && w.warranty.endDate === '2036-01-31' && w.warranty.durationMonths === 120 && w.warranty.category === 'roofing',
    JSON.stringify(w));
  const noStart = buildScanWarranty({ product: 'Roof', term: '10 years' }, ctx);
  ok('no readable start date → no warranty, with the reason', !noStart.ok && /Start Date/.test(noStart.reason));
  const noEnd = buildScanWarranty({ product: 'Roof', startDate: '2026-01-01' }, ctx);
  ok('no end date and no term → no warranty', !noEnd.ok);
  eq('scanCalendarDay refuses a printed date', [scanCalendarDay('2026-09-22'), scanCalendarDay('9/22/26'), scanCalendarDay('2026-13-01')], ['2026-09-22', null, null]);
  ok('scan.tsx creates the permit and warranty',
    /addPermit\(buildScanPermit\(/.test(SCAN) && /addWarranty\(built\.warranty\)/.test(SCAN));
  eq('routing', [resolveDestination('permit').recordKind, resolveDestination('warranty').recordKind], ['permit', 'warranty']);
  eq('the destination line says what it creates', [recordKindPhrase('permit'), recordKindPhrase('file_only')], ['adds a permit to the Permits list', 'saves the image only']);
  eq('file_only says the fields are not kept', scanFiledMessage('file_only', 'photos', 1),
    'Saved the image to Project Files › Photos. The fields it read are not saved as a record.');
  eq('the banner names what was created — and what the scan did not read', scanFiledMessage('permit', 'permits', 2),
    "Saved all 2 pages to Project Files › Permits and added the permit to the Permits list. The scan doesn't read the fee or the application date — add them there.");
  ok('the old "record is logged" and "permit onto the project" promises are gone',
    !/the record is logged/.test(SCAN) && !/the permit onto the project/.test(SCAN));
}

// ── #53 interim: permits / warranties are owner-only ────────────────────────
console.log('\n#53 interim — a scan on a job he does not own never creates a permit / warranty:');
{
  const r = (role: string | null, isLoading = false, isError = false) => ({ role, isLoading, isError });
  eq('the owner creates both', [scanOwnerOnlyGate('warranty', r('owner')).state, scanOwnerOnlyGate('permit', r('owner')).state], ['open', 'open']);
  for (const role of ['editor', 'field', 'viewer']) {
    eq(`an invited ${role} is blocked for a warranty`, scanOwnerOnlyGate('warranty', r(role)).state, 'blocked');
    eq(`an invited ${role} is blocked for a permit`, scanOwnerOnlyGate('permit', r(role)).state, 'blocked');
  }
  const w = scanOwnerOnlyGate('warranty', r('editor'));
  ok('the warranty refusal says where it belongs', w.state === 'blocked' && /Warranties are kept on the project owner's account — ask them to log it/.test(w.reason));
  eq('a role still loading decides nothing', scanOwnerOnlyGate('warranty', r(null, true)).state, 'checking');
  eq('a failed / unknown role is not ownership', [scanOwnerOnlyGate('permit', r(null, false, true)).state, scanOwnerOnlyGate('permit', r(null)).state], ['blocked', 'blocked']);
  // Integration round 1: material_receipts and cois are owner-only by RLS —
  // an invitee's bill / COI landed on HIS account, invisible to the GC.
  eq('an invitee\'s bill and COI file as images only', [scanOwnerOnlyGate('cost', r('field')).state, scanOwnerOnlyGate('sub_compliance', r('editor')).state], ['blocked', 'blocked']);
  eq('the owner books the bill and files the COI', [scanOwnerOnlyGate('cost', r('owner')).state, scanOwnerOnlyGate('sub_compliance', r('owner')).state], ['open', 'open']);
  const cg = scanOwnerOnlyGate('cost', r('editor'));
  ok('the bill refusal says where bills are booked', cg.state === 'blocked' && /project owner's account/.test(cg.reason) && /image only/.test(cg.reason));
  eq('a contact (his own address book) is not gated', scanOwnerOnlyGate('contact', r('field')).state, 'open');
  ok('scan.tsx reads the role for the effective project',
    /const roleState = useProjectRoleState\(effectiveProjectId \|\| undefined\);/.test(SCAN)
    && /const ownerGate = scanOwnerOnlyGate\(destination\?\.recordKind, \{\s*role: roleState\.role, isLoading: roleState\.isLoading, isError: roleState\.isError,\s*\}\);/.test(SCAN));
  ok('…a blocked gate files the scan as an image only',
    /ownerGate\.state === 'blocked' \? 'file_only'/.test(SCAN));
  ok('…Save waits while the role is checking, and the card shows the reason',
    /disabled=\{saving \|\| ownerGate\.state === 'checking'\}/.test(SCAN)
    && /if \(ownerGate\.state === 'checking'\) return;/.test(SCAN)
    && /\{ownerGate\.state !== 'open' && \(/.test(SCAN));
  // Integration round 2: the blocked card said 'this scan files as an image
  // only' directly above 'Pays against … counts against that PO' / 'Link to
  // subcontractor (needed to file as compliance)'. Both pickers now render
  // only while the gate is open.
  ok('…the Pays-against and COI sub pickers render only while the gate is open',
    /\{destination\.recordKind === 'cost' && ownerGate\.state === 'open' && \(/.test(SCAN)
    && /\{destination\.recordKind === 'sub_compliance' && ownerGate\.state === 'open' && \(/.test(SCAN)
    && !/\{destination\.recordKind === '(cost|sub_compliance)' && \(/.test(SCAN));
}

// ── integration round 2: the same rule on the direct Material Receipt path ──
// Job Costing (open to editor / viewer invitees) links straight to Material
// Receipt; material_receipts is owner-only by RLS, so an invited PM's receipt
// landed on HIS account while the screen said it was saved. Save is blocked
// on a job he doesn't own and the card says why.
console.log('\nMaterial Receipt — a receipt on a job he does not own is not saved:');
{
  const r = (role: string | null, isLoading = false, isError = false) => ({ role, isLoading, isError });
  eq('the owner saves', materialReceiptOwnerGate('p1', r('owner')).state, 'open');
  eq('no project picked yet is not a refusal', materialReceiptOwnerGate('', r(null)).state, 'open');
  for (const role of ['editor', 'field', 'viewer']) {
    eq(`an invited ${role} is blocked`, materialReceiptOwnerGate('p1', r(role)).state, 'blocked');
  }
  eq('a role still loading waits', materialReceiptOwnerGate('p1', r(null, true)).state, 'checking');
  eq('a failed / unknown role is not ownership', [materialReceiptOwnerGate('p1', r(null, false, true)).state, materialReceiptOwnerGate('p1', r(null)).state], ['blocked', 'blocked']);
  const b = materialReceiptOwnerGate('p1', r('editor'));
  ok('the refusal names where bills are booked', b.state === 'blocked' && /project owner's account — job costing only counts theirs/.test(b.reason));
  const MR = strip(readFileSync('app/material-receipt.tsx', 'utf8'));
  ok('material-receipt reads the role for the picked project and gates on it',
    /const roleState = useProjectRoleState\(projectId \|\| undefined\);/.test(MR)
    && /materialReceiptOwnerGate\(projectId, \{/.test(MR));
  const save = MR.slice(MR.indexOf('const save = useCallback('), MR.indexOf('}, [draft, projectId, commitmentId, addReceipt, ownerGate]);'));
  ok('save() refuses before addReceipt when the gate is not open',
    /if \(ownerGate\.state !== 'open'\) \{ showAlert\([^;]*ownerGate\.reason\); return; \}/.test(save)
    && save.indexOf("ownerGate.state !== 'open'") < save.indexOf('addReceipt('));
  ok('the Save button is disabled and the reason is rendered',
    /disabled=\{ownerGate\.state !== 'open'\}/.test(MR) && /testID="receipt-owner-only"/.test(MR));
}

// ── review round 1: a pick never crosses jobs ───────────────────────────────
console.log('\nA sub / commitment pick belongs to one job:');
ok('an explicit commitment pick counts only while it is one of THIS job\'s commitments',
  /commitmentPick && linkable\.some\(c => c\.id === commitmentPick\) \? commitmentPick : undefined/.test(SCAN));
ok('an explicit sub pick counts only while it is in this job\'s list',
  /subPick && coiSubs\.subs\.some\(s => s\.id === subPick\) \? subPick : ''/.test(SCAN));
ok('switching project resets the picks, and is refused once a page landed',
  /onPress=\{\(\) => pickProject\(p\.id\)\}/.test(SCAN) && !/onPress=\{\(\) => setProjectId\(/.test(SCAN)
  && /if \(landedCount > 0\) \{/.test(SCAN)
  && /setProjectId\(id\);\s*setSubPick\(null\);\s*setCommitmentPick\(null\);/.test(SCAN));

// ── #163 project at use time ────────────────────────────────────────────────
console.log('\n#163 never "Pick a project" with nothing to pick:');
ok('effectiveProjectId falls back to the route and the only job',
  /const effectiveProjectId = projectId \|\| params\.projectId \|\| \(projects\.length === 1 \? projects\[0\]\.id : ''\);/.test(SCAN));
ok('the picker shows whenever nothing is selected',
  /const showProjectPicker = projects\.length > 1 \|\| \(!effectiveProjectId && projects\.length > 0\);/.test(SCAN));
ok('runScan / onSave read effectiveProjectId, not the seeded state',
  /if \(!effectiveProjectId\) \{ showAlert\('Pick a project'/.test(SCAN)
  && /!effectiveProjectId \|\| saving\) return;/.test(SCAN)
  && !/projectId: projectId\b/.test(SCAN));

// ── #68 / #124 carry ────────────────────────────────────────────────────────
console.log('\n#68 / #124 the scan says why it was refused:');
{
  const mb = (n: number) => 'x'.repeat(Math.round(n * 1024 * 1024));
  eq('a scan under the limits passes', scanPayloadTooLarge([{ base64: mb(1) }, { base64: mb(2) }]), null);
  ok('over 8 MB total is refused with the size and what to do',
    /Scan payload too large \(9\.0 MB\)\. Remove a page or retake/.test(scanPayloadTooLarge([{ base64: mb(4.5) }, { base64: mb(4.5) }]) ?? ''));
  ok('one image over 6 MB is refused', scanPayloadTooLarge([{ base64: mb(6.5) }]) !== null);
  ok('the total ceiling matches the server', SCAN_MAX_BYTES_TOTAL === 8 * 1024 * 1024);
  ok('scan.tsx checks the payload BEFORE invoking',
    SCAN.indexOf('scanPayloadTooLarge(captures)') > 0 && SCAN.indexOf('scanPayloadTooLarge(captures)') < SCAN.indexOf("invokeWithTimeout<ScanResponse>('scan-anything'"));
  ok('scan.tsx invokes through invokeWithTimeout, not supabase.functions.invoke',
    /invokeWithTimeout<ScanResponse>\('scan-anything'/.test(SCAN) && !/supabase\.functions\.invoke/.test(SCAN));
  ok('scan.tsx reads the server sentence', /throw await edgeFunctionError\(fnError, 'Scan failed'\)/.test(SCAN));
  ok('cap / tier codes go to the plans, hourly shows the server sentence',
    /code === 'monthly_cap_reached' \|\| code === 'tier_required'/.test(SCAN) && /'\/paywall'/.test(SCAN) && /code === 'hourly_limit'/.test(SCAN));
}

console.log(`\n${fail === 0 ? '✓' : '✗'} w5 scan-files (scan): ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
