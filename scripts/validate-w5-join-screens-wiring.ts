// validate-w5-join-screens-wiring.ts — wave 5, join lane w5-join-screens.
//
// The join landed the chain lanes' handoffs on the wave-4 screens. Each check
// here pins one of them — executed where the code is pure (the client
// estimate view, the leak grader, the email footer, the DFR geo mirror), by
// source shape where it is a screen:
//
//   #9   a GC-only Cost X-Ray line never reaches the client by name; its money
//        is one neutral 'Contingency' scope line, so the total still ties.
//   #22  gradeLeak counts an open job's unmatched items' DOLLARS as eaten.
//   #45  a contractor's own document to his client offers no unsubscribe link.
//   #65  the DFR gallery mirror carries the capture-time GPS stamp.
//   #82  Client Portal setup reads the key through portal_get_owner_token.
//   #61  Delete refuses a job with injury / near-miss records, offers Mark closed.
//   #24  prequal decisions write the review columns only; ?packetId opens one.
//   #57 / #156  every create path asks useProjectCapGate first.
//   #74  a claimed crew worker reaches /crew and reads "My Profile".
//   #169 schedule presence names the profile, never the email.
//   #180 Finance this project carries the portal key, or is hidden.
//   #137 / #48  selections say where a write landed; exceeded from the total.
//   #115 the sub evaluator no longer sends untracked bid history.
//   #123 the RFI AI refusal names the real reset time.
//   #20  the first send of a draft invoice is its issue date.
//   #30  a failed lien-waiver read is never shown as none.
//
// Run: bun run scripts/validate-w5-join-screens-wiring.ts

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.env.W5JS_ROOT ?? join(__dirname, '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
}

// ── #9 the client estimate view ───────────────────────────────────────────
console.log('\n#9 — GC-only Cost X-Ray lines in the client view:');
{
  const cev = await import(join(ROOT, 'utils/clientEstimateView.ts')) as Partial<typeof import('../utils/clientEstimateView')>;
  ok('clientEstimateView exports the GC-only helpers', typeof cev.isGcOnlyEstimateLine === 'function' && cev.CLIENT_CONTINGENCY_LABEL === 'Contingency');
  const toClientEstimateView = cev.toClientEstimateView!;
  const isGcOnlyEstimateLine = cev.isGcOnlyEstimateLine ?? (() => false);
  const CLIENT_CONTINGENCY_LABEL = cev.CLIENT_CONTINGENCY_LABEL ?? 'Contingency';
  const TELL = 'Possible knob-and-tube behind panel';
  const item = (o: Record<string, unknown>) => ({
    materialId: String(o.name), name: String(o.name), category: String(o.category ?? 'Framing'), unit: 'ea',
    quantity: 1, unitPrice: Number(o.lineTotal), bulkPrice: Number(o.lineTotal), markup: 0, usesBulk: false,
    lineTotal: Number(o.lineTotal), supplier: '', ...o,
  });
  const est = {
    id: 'e1', globalMarkup: 0, baseTotal: 13_450, markupTotal: 0, grandTotal: 13_450, createdAt: '2026-09-01',
    items: [
      item({ name: 'Framing package', category: 'Framing', lineTotal: 10_000 }),
      item({ name: 'Tile allowance', category: 'Flooring', lineTotal: 2_000, isAllowance: true }),
      item({ name: TELL, category: 'Hidden Conditions', lineTotal: 1_450.55, isAllowance: true,
        xray: { tell: TELL, category: 'electrical', confidence: 0.7, band: 'likely', clientVisible: false } }),
    ],
  };
  est.grandTotal = 13_450.55;
  const view = toClientEstimateView(est as never);
  const json = JSON.stringify(view);
  ok('the tell text appears nowhere in the client view', !json.includes(TELL) && !json.includes('knob'), json.slice(0, 200));
  ok('the GC-only line is not an allowance', view.allowances.length === 1 && view.allowances[0].name === 'Tile allowance', JSON.stringify(view.allowances));
  const cont = view.scopeGroups.find(g => g.key === 'contingency');
  ok(`its money is one neutral '${CLIENT_CONTINGENCY_LABEL}' scope line, to the cent`, !!cont && cont.label === 'Contingency' && cont.total === 1_450.55, JSON.stringify(view.scopeGroups));
  const sum = Math.round(view.scopeGroups.reduce((s, g) => s + g.total * 100, 0));
  ok('projectTotal is unchanged and the groups still tie to it', view.projectTotal === 13_450.55 && sum === 1_345_055, `${view.projectTotal} / ${sum}`);
  const plain = toClientEstimateView({ ...est, items: est.items.slice(0, 2), grandTotal: 12_000 } as never);
  ok('an estimate with no GC-only line has no Contingency group', !plain.scopeGroups.some(g => g.key === 'contingency'));
  ok('isGcOnlyEstimateLine reads xray.clientVisible === false only',
    isGcOnlyEstimateLine({ xray: { clientVisible: false } } as never) && !isGcOnlyEstimateLine({} as never)
    && !isGcOnlyEstimateLine({ xray: { clientVisible: true } } as never));
  // The per-line documents (estimate PDF, plain-text email): GC-only lines fold
  // into ONE lump-sum Contingency row — no finding, no qty / unit / price.
  const clientEstimateLineRows = cev.clientEstimateLineRows;
  ok('clientEstimateView exports clientEstimateLineRows', typeof clientEstimateLineRows === 'function');
  if (clientEstimateLineRows) {
    const tell2 = item({ name: 'Suspected rot at sill plate', category: 'Hidden Conditions', lineTotal: 0.1, quantity: 200, unit: 'LF',
      xray: { tell: 'rot', category: 'structural', confidence: 0.5, band: 'possible', clientVisible: false } });
    const rows = clientEstimateLineRows([...est.items, tell2] as never);
    const rj = JSON.stringify(rows);
    ok('per-line rows carry no tell text, qty or unit of a GC-only line', !rj.includes(TELL) && !rj.includes('sill') && !rj.includes('"LF"') && !rj.includes('"quantity":200'), rj);
    const cRows = rows.filter(r => r.name === 'Contingency');
    ok('…as ONE lump-sum Contingency row summed on the cent grid (1450.55 + 0.10)',
      cRows.length === 1 && cRows[0].lineTotal === 1_450.65 && cRows[0].quantity === null && cRows[0].unitPrice === null && cRows[0].markup === null, JSON.stringify(cRows));
    const foot = Math.round(rows.reduce((t, r) => t + r.lineTotal * 100, 0));
    ok('…and the rows still foot to Σ lineTotal', foot === 1_345_065, String(foot));
    ok('visible lines keep their own qty / unit / price', rows.filter(r => r.name !== 'Contingency').every(r => r.quantity === 1 && r.unit === 'ea' && r.unitPrice !== null));
  }
  const pdf = read('utils/pdfGenerator.ts');
  ok('the estimate PDF and the email text print clientEstimateLineRows, not est.items',
    (pdf.match(/clientEstimateLineRows\(est\.items\)/g) ?? []).length === 2 && !/est\.items\.map\(\(item, i\) =>/.test(pdf) && !/est\.items\.forEach\(\(item, i\) =>/.test(pdf));

  // Bill from Estimate → the client's invoice (PDF, email, portal).
  const bfe = read('app/bill-from-estimate.tsx');
  ok('Bill from Estimate bills a GC-only line as a lump-sum Contingency (name, category, LS, qty 1)',
    /const gcOnly = isGcOnlyEstimateLine\(item\);/.test(bfe)
    && /name: gcOnly \? CLIENT_CONTINGENCY_LABEL : item\.name,/.test(bfe)
    && /category: gcOnly \? CLIENT_CONTINGENCY_LABEL : item\.category,/.test(bfe)
    && /unit: gcOnly \? 'LS' : item\.unit,/.test(bfe)
    && /quantity: gcOnly \? 1 : item\.quantity,/.test(bfe));
  ok('…while its match key stays the real materialId / name', /const key = item\.materialId \|\| item\.name;/.test(bfe) && /: li\.name === item\.name\)/.test(bfe));

  // The native invoice editor's prefill → the client's invoice. A NEW full /
  // progress invoice (home hero "Send your first invoice", the voice path with
  // no parsed lines) seeds one line per linked-estimate item. The GC-only gate
  // must come BEFORE the by-name mapping, and the Contingency line is keyed so
  // Bill from Estimate and the G703 still count it as billed.
  const invSrc = read('app/invoice.tsx');
  const lbStart = invSrc.indexOf('const linked = project.linkedEstimate;');
  const lbEnd = invSrc.indexOf('const legacy = project.estimate;', lbStart);
  const linkedBranch = lbStart >= 0 && lbEnd > lbStart ? invSrc.slice(lbStart, lbEnd) : '';
  const gateAt = linkedBranch.indexOf('if (isGcOnlyEstimateLine(item)) {');
  const byNameAt = linkedBranch.indexOf('name: item.name,');
  const gcBranch = gateAt >= 0 ? linkedBranch.slice(gateAt, byNameAt > gateAt ? byNameAt : undefined) : '';
  ok('the invoice editor\'s estimate prefill gates GC-only lines before it maps item.name',
    linkedBranch.length > 0 && gateAt >= 0 && byNameAt > gateAt
    && (linkedBranch.match(/name: item\.name,/g) ?? []).length === 1,
    `branch ${linkedBranch.length} chars, gate@${gateAt}, byName@${byNameAt}`);
  ok('…and seeds it as a keyed lump-sum Contingency line (no name, category, qty or unit of the finding)',
    /name: CLIENT_CONTINGENCY_LABEL,/.test(gcBranch) && /description: CLIENT_CONTINGENCY_LABEL,/.test(gcBranch)
    && /quantity: 1,/.test(gcBranch) && /unit: 'LS',/.test(gcBranch)
    && /sourceEstimateItemId: item\.materialId \|\| item\.name,/.test(gcBranch)
    && !/item\.(category|unit|quantity)\b/.test(gcBranch)
    && /import \{ isGcOnlyEstimateLine, CLIENT_CONTINGENCY_LABEL \} from '@\/utils\/clientEstimateView';/.test(invSrc));
  // That key is what keeps billed-through right: executed against the G703's
  // matcher below (a keyed 'Contingency' line lands on the hidden row).

  // The Scope Sheet (attached to proposals, shared from app/scope-sheet.tsx).
  // Executed: the heuristic sheet never names the finding, even though the
  // line is an allowance. mageAI / AsyncStorage are stubbed — the heuristic
  // path touches neither.
  {
    const BUN_TEST = 'bun:test';
    const { mock } = (await import(BUN_TEST)) as { mock: { module: (s: string, f: () => Record<string, unknown>) => void } };
    mock.module('@/utils/mageAI', () => ({ mageAI: async () => ({ success: false }) }));
    mock.module('@react-native-async-storage/async-storage', () => ({ default: { getItem: async () => null, setItem: async () => {} } }));
    const ss = await import(join(ROOT, 'utils/scopeSheet.ts')) as typeof import('../utils/scopeSheet');
    const sheet = ss.heuristicScopeSheet({ id: 'p1', name: 'Job', type: 'renovation', linkedEstimate: est } as never);
    const sj = JSON.stringify(sheet);
    ok('the Scope Sheet never names a GC-only line (heuristic allowances + trades)',
      !sj.includes('knob') && !sj.includes('Hidden Conditions') && sj.includes('Tile allowance'), sj.slice(0, 300));
    const scopeSrc = read('utils/scopeSheet.ts');
    ok('…and the AI prompt digest reads the same filtered list', /le\.items\.filter\(\(i\) => !isGcOnlyEstimateLine\(i\)\)/.test(scopeSrc)
      && !/le\.items\.(map|forEach)\(/.test(scopeSrc));
  }

  // The G703 schedule of values → the owner / architect. Executed.
  const aia = await import(join(ROOT, 'utils/aiaBilling.ts')) as typeof import('../utils/aiaBilling');
  const inv = {
    id: 'i1', projectId: 'p1', number: 1, type: 'progress', status: 'sent', issueDate: '2026-09-01', dueDate: '2026-10-01',
    paymentTerms: 'net_30', subtotal: 435.17, taxRate: 0, taxAmount: 0, totalDue: 435.17, amountPaid: 0, payments: [],
    retentionPercent: 0, lineItems: [
      { id: 'l1', name: 'Contingency', description: '', quantity: 0.3, unit: 'LS', unitPrice: 1_450.55, total: 435.17,
        sourceEstimateItemId: 'xray_1', billedPercent: 30 },
    ],
  };
  // Cost X-Ray writes each line with its own createId('xray') materialId
  // (app/cost-xray.tsx), so the SOV row id never carries the tell either.
  const aiaEst = { ...est, items: est.items.map(it => ((it as { xray?: unknown }).xray ? { ...it, materialId: 'xray_1' } : it)) };
  const { lines } = aia.buildAIASovLines(inv as never, { linkedEstimate: aiaEst as never }, [], 10);
  const lj = JSON.stringify(lines);
  ok('the G703 never names the finding', !lj.includes('knob') && lines.some(l => l.description === 'Contingency'), lj.slice(0, 300));
  const contLine = lines.find(l => l.description === 'Contingency');
  ok('…and still attributes this period to the hidden line by its key', !!contLine && contLine.scheduledValue === 1_450.55 && contLine.thisPeriod === 435.17, JSON.stringify(contLine));
  ok('…with no off-contract row added for it', lines.length === 3, String(lines.length));
}

// ── #22 gradeLeak ─────────────────────────────────────────────────────────
console.log('\n#22 — gradeLeak dollars:');
{
  const { gradeLeak } = await import(join(ROOT, 'utils/brain/gradePredictions.ts')) as typeof import('../utils/brain/gradePredictions');
  const longAgo = new Date(Date.now() - 200 * 86400000).toISOString();
  const outcome = gradeLeak({
    id: 'p1', project_id: 'job1', predicted_at: longAgo, kind: 'leak_scan',
    payload: { reportId: 'r1', items: [
      { category: 'drywall', description: 'extra drywall patch', estPrice: 1_200 },
      { category: 'paint', description: 'touch-up', estPrice: 350.25 },
    ] },
  } as never, { projects: [{ id: 'job1', status: 'in_progress' }], changeOrders: [], commitments: [], bidResponses: [] } as never);
  ok('an open job past the window: unmatched items are eaten, count AND dollars',
    !!outcome && outcome.itemsEaten === 2 && Math.round(outcome.dollarsEaten * 100) === 155_025, JSON.stringify(outcome));
}

// ── #45 the email footer ──────────────────────────────────────────────────
console.log('\n#45 — no unsubscribe on a contractor\'s own document:');
{
  const layoutMod = await import(join(ROOT, 'utils/emailLayout.ts')) as Partial<typeof import('../utils/emailLayout')>;
  ok('emailLayout exports TRANSACTIONAL_DOCUMENT_KEYS', Array.isArray(layoutMod.TRANSACTIONAL_DOCUMENT_KEYS));
  const layout = { ...layoutMod, TRANSACTIONAL_DOCUMENT_KEYS: layoutMod.TRANSACTIONAL_DOCUMENT_KEYS ?? (['estimate', 'invoice', 'daily_report', 'weekly_update', 'submittal', 'lien_waiver'] as const) } as typeof import('../utils/emailLayout');
  const shared = read('supabase/functions/_shared/email.ts');
  const serverList = /export const TRANSACTIONAL_DOCUMENT_KEYS = \[([^\]]*)\]/.exec(shared)?.[1] ?? '';
  const serverKeys = [...serverList.matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
  ok('the client list equals _shared/email.ts TRANSACTIONAL_DOCUMENT_KEYS',
    serverKeys.length === 6 && JSON.stringify([...layout.TRANSACTIONAL_DOCUMENT_KEYS]) === JSON.stringify(serverKeys),
    `${serverKeys.join(',')} vs ${layout.TRANSACTIONAL_DOCUMENT_KEYS.join(',')}`);
  const wrap = (eventKey: string) => layout.wrapEmailHtml({
    title: 'T', body: '<p>x</p>',
    unsubscribe: { recipientEmail: 'client@example.com', eventKey, enabled: true },
  } as never);
  for (const key of layout.TRANSACTIONAL_DOCUMENT_KEYS) {
    const html = wrap(key);
    ok(`'${key}': no "Unsubscribe" link, the preferences link stays`, !/Unsubscribe from these notifications/.test(html) && /Manage email preferences/.test(html));
  }
  ok('a notification key still carries the unsubscribe link', /Unsubscribe from these notifications/.test(wrap('co_approval')));
}

// ── #65 DFR gallery geo ───────────────────────────────────────────────────
console.log('\n#65 — the DFR gallery mirror carries the GPS stamp:');
{
  const dfr = read('app/daily-report.tsx');
  ok('both mirror sites spread dfrPhotoGeo(p)', (dfr.match(/\.\.\.dfrPhotoGeo\(p\),/g) ?? []).length === 2);
  const body = dfr.slice(dfr.indexOf('export function dfrPhotoGeo('), dfr.indexOf('\n}\n', dfr.indexOf('export function dfrPhotoGeo(')));
  ok('an unstamped photo gets no location (never a guessed one)', /if \(p\.latitude == null \|\| p\.longitude == null\) return \{\};/.test(body));
  ok('a stamped photo maps latitude, longitude, accuracy and label', /latitude: p\.latitude/.test(body) && /longitude: p\.longitude/.test(body)
    && /locationAccuracyMeters: p\.locationAccuracyMeters/.test(body) && /locationLabel: p\.locationLabel/.test(body));
}

// ── #82 portal key read ───────────────────────────────────────────────────
console.log('\n#82 — Client Portal setup reads the key through the owner getter:');
{
  const cps = read('app/client-portal-setup.tsx');
  ok("readServerPortalToken calls rpc('portal_get_owner_token', { p_project_id })",
    /supabase\.rpc\('portal_get_owner_token', \{ p_project_id: projectId \}\)/.test(cps) && !/\.select\('client_portal'\)/.test(cps));
}

// ── #61 delete with safety records ────────────────────────────────────────
console.log('\n#61 — Delete and the OSHA log:');
{
  const pd = read('app/project-detail.tsx');
  ok('the confirm lists the safety records that go (JHAs, toolbox talks, hazards)', /its safety records \(JHAs, toolbox talks, hazards\)/.test(pd));
  ok('a job with incidents is refused up front, with Mark closed', /if \(deleteSafety\.refusal\) \{ showDeleteRefusal\(deleteSafety\.refusal, true\); return; \}/.test(pd)
    && /\{ text: 'Mark closed', onPress: markJobClosed \}/.test(pd));
  ok('deleteProject gets the hydrated incident count and its refusal is shown', /await deleteProject\(id, knownIncidents !== undefined && knownIncidents > 0 \? \{ safetyIncidentCount: knownIncidents \} : undefined\)/.test(pd)
    && /showDeleteRefusal\(res\.reason, res\.action === DELETE_SAFETY_ACTION\)/.test(pd));
  ok('the count is passed only once the safety log has hydrated', /const knownIncidents = jobSafety\.hydrated \? jobSafety\.incidents : undefined;/.test(pd));
  ok('router.back() only after a delete that went through', /if \(!res\.ok\) \{[\s\S]{0,200}return;\s*\}[\s\S]{0,300}router\.back\(\);/.test(pd));
}

// ── #24 prequal ───────────────────────────────────────────────────────────
console.log('\n#24 — prequal review writes:');
{
  const pm = read('app/prequal-manager.tsx');
  ok('decisions call the context\'s narrow reviewPrequalPacket', (pm.match(/writePrequalReview\(packet\.id, prequalReviewPatchOf\(updated\)\)/g) ?? []).length === 3);
  ok('the renewal still writes the full row', /upsertPrequalPacket\(buildPrequalRenewal\(packet, token, email, now\)\)/.test(pm));
}

// ── #57 / #156 cap gates ──────────────────────────────────────────────────
console.log('\n#57 / #156 — every create path asks the cap gate:');
{
  const sites: [string, RegExp][] = [
    ['app/estimate-wizard.tsx', /if \(!capGate\.canCreate\(newProjectName\)\) \{ setShowSaveModal\(false\); capGate\.explainAndOfferUpgrade\(\); return; \}/],
    ['app/(tabs)/schedule/index.tsx', /if \(!capGate\.canCreate\('Schedule Project'\)\) \{ capGate\.explainAndOfferUpgrade\(\); return(?: false)?; \}/],
    ['components/UniversalMicButton.tsx', /if \(!capGate\.canCreate\(voiceName\)\) \{[\s\S]{0,80}capGate\.explainAndOfferUpgrade\(\);/],
    ['app/copilot.tsx', /canCreateProject: capGate\.canCreate, addProject: gatedAddProject, markupDecided, markup: globalMarkup, receipts, laborSamples, seeds \}/],
    ['utils/copilot/newProject/newProjectCapability.ts', /if \(typeof canCreate === 'function' && !canCreate\(project\.name\)\) throw projectCapError\(\);\s*ctx\.ctx\?\.addProject\?\.\(project\);/],
    ['app/project-detail.tsx', /isSampleProjectName\(project\.name\) && !isSampleProjectName\(name\) && !capGate\.canCreate\(name\)\) \{\s*setEditName\(project\.name\);\s*capGate\.explainAndOfferUpgrade\(\);/],
  ];
  for (const [f, re] of sites) ok(`${f}`, re.test(read(f)));
  const hook = read('hooks/useCopilotConversation.ts');
  const shell = read('components/copilot/CopilotShell.tsx');
  ok('the Copilot names a cap refusal (project_cap) and offers See plans, not a retry',
    /capRefused \? 'project_cap'/.test(hook) && /FREE COVERS ONE JOB/.test(shell) && /\(limitError \|\| capError\) &&/.test(shell) && /!limitError && !applyError && !capError/.test(shell));
}

// ── #74 claimed crew worker ───────────────────────────────────────────────
console.log('\n#74 — a claimed crew worker:');
{
  const layout = read('app/_layout.tsx');
  ok('the persona gate lets him stay on /crew', /if \(isAuthenticated && userRole === null && inCrew && claimedCrewWorker\) return;/.test(layout)
    && layout.indexOf('inCrew && claimedCrewWorker') < layout.indexOf("router.replace('/persona-select' as never)"));
  ok('a stashed /claim-crew is replayed before the persona question', /if \(route === 'claim-crew'\) \{ router\.replace\(pending as never\); return; \}/.test(layout)
    && /await setPendingDeepLink\(pending\);/.test(layout) && /if \(authLoading \|\| projectLoading \|\| !isAuthenticated \|\| userRole !== null \|\| claimReplayRef\.current\) return;/.test(layout));
  ok('Tools and the sidebar read "My Profile" (no chip / lock) for him',
    /crewAsProfile\(row\) \? 'My Profile' : row\.title/.test(read('app/(tabs)/discover/tools.tsx'))
    && /if \(crewAsProfile\(row\)\) return undefined;/.test(read('app/(tabs)/discover/tools.tsx'))
    && /const label = asProfile \? 'My Profile' : item\.label;/.test(read('components/DesktopSidebar.tsx'))
    && /const locked = !asProfile && /.test(read('components/DesktopSidebar.tsx')));
}

// ── #169, #180, #115, #123, #20 ───────────────────────────────────────────
console.log('\n#169 / #180 / #115 / #123 / #20:');
{
  const sp = read('app/schedule-pro.tsx');
  ok('#169 presence name is the profile name, never an email', /name: presenceName/.test(sp) && !/\.email\) \?\? 'Collaborator'/.test(sp)
    && /if \(t && !t\.includes\('@'\)\) return t;/.test(sp));
  const cv = read('app/client-view.tsx');
  ok('#180 the financing link carries portal + t, and the button needs both',
    /&src=portal&portal=\$\{encodeURIComponent\(portalId\)\}&t=\$\{encodeURIComponent\(accessTokenParam\)\}/.test(cv)
    && /typeof accessTokenParam === 'string' && accessTokenParam\.length > 0 && \(/.test(cv));
  const ai = read('utils/aiService.ts');
  const ev = ai.slice(ai.indexOf('export async function evaluateSubcontractor('), ai.indexOf('export const equipmentAdviceSchema'));
  ok('#115 the evaluator sends no untracked bid history / assigned projects', !/Bid history:/.test(ev) && !/Assigned projects:/.test(ev)
    && /ONLY from the scorecard facts in CONTEXT/.test(ev));
  ok('#123 the RFI refusal names the real reset', /\$\{nextAiResetLabel\(\)\.daily\}/.test(read('app/rfi.tsx')) && !/Try again tomorrow/.test(read('app/rfi.tsx')));
  const inv = read('app/invoice.tsx');
  ok('#20 a draft\'s first send (Send and Mark sent) stamps the issue date',
    /\.\.\.\(existingInvoice\.status === 'draft' \? \{ issueDate: new Date\(\)\.toISOString\(\) \} : \{\}\)/.test(inv)
    && /status: 'sent',\s*issueDate: sentAt,\s*dueDate: getDueDate\(sentAt, existingInvoice\.paymentTerms\)/.test(inv));
}

// ── #137 / #48 selections ─────────────────────────────────────────────────
console.log('\n#137 / #48 — selections:');
{
  const sel = read('app/selections.tsx');
  ok('the screen writes through the *Detailed engine calls only', /saveSelectionCategoryDetailed\(/.test(sel) && /deleteSelectionCategoryDetailed\(/.test(sel)
    && /saveSelectionOptionDetailed\(/.test(sel) && /chooseSelectionOptionDetailed\(/.test(sel)
    && !/\bsaveSelectionOption\(/.test(sel) && !/\bchooseSelectionOption\(/.test(sel) && !/\bdeleteSelectionCategory\(/.test(sel));
  ok('the photo edit sends no unitPrice (it cannot un-choose or re-total)',
    /saveSelectionOptionDetailed\(\{ id: option\.id, categoryId: option\.categoryId, productName: option\.productName, productUrl: url\.trim\(\), imageUrl \}\)/.test(sel));
  ok('queued and failed are said', /'Saved offline'/.test(sel) && /showAlert\('Not chosen', res\.message\)/.test(sel));
  ok('exceeded / decided also read the chosen total', /chosen\.total > category\.budget/.test(sel) && /opts\.some\(o => o\.isChosen\)/.test(sel));
}

// ── #30 checked waiver reads ──────────────────────────────────────────────
console.log('\n#30 — a failed waiver read is never "none":');
for (const f of ['app/closeout-binder.tsx', 'app/project-detail.tsx', 'app/sub-portal-setup.tsx']) {
  const src = read(f);
  ok(`${f} reads through loadLienWaiversChecked`, /loadLienWaiversChecked\(/.test(src) && !/fetchLienWaiversForProject\(/.test(src));
}
ok('the binder refuses to print an empty waiver section off a failed read', /if \(waiverReadError\) \{[\s\S]{0,300}'Lien waivers not loaded'/.test(read('app/closeout-binder.tsx')));
ok('sub-portal setup says it could not check instead of offering a second release',
  /releasesReadFailed \? 'Couldn\\u2019t check lien releases/.test(read('app/sub-portal-setup.tsx'))
  && /\(!shown \|\| needsUnconditional\) && !releasesReadFailed \?/.test(read('app/sub-portal-setup.tsx')));

console.log(`\n${failed === 0 ? '✓' : '✗'} validate-w5-join-screens-wiring: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
