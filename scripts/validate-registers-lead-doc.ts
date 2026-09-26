// validate-registers-lead-doc.ts — the desktop-web Pipeline, Deliveries and
// Documents registers (wave 6d, lane R3).
//
// WHY. On the founder's 1512 px MacBook the Leads board was 1,472 px of fixed
// 280 px columns in a 1,272 px column (the Lost column could not be reached
// with a mouse), Deliveries hid its late loads below a horizon control, and
// Documents was ~3 screens of cards whose rows were not links. Desktop web now
// shows a board that fits (or a list), two delivery tables with Late above the
// horizon, and a Documents table of real links. The iPhone must not change by
// one node (the goldens in __tests__/smoke/w6d-r3-phone.test.tsx prove the
// tree; this proves the rules and pins the wiring).
//
// This EXECUTES the pure rules and pins the wiring:
//
//   1. leadsBoardLayout: 1224 → 235, 1078 → 206, 992 → 188 (fits), 900 → does
//      not fit; the fit line is 5·180 + 4·12 = 948; the cap is 360; the
//      numbers equal constants/designTokens.ts Layout.register.
//   2. leadRows: the budget is statedBudgetOf only (blank → null); the waiting
//      clock is LeadCard's floor-of-hours; the KPI win rate is '—' + a reason
//      with nothing closed (never "0%"), avg first reply '—' with no reply,
//      and every cell is '—' + 'Loading…' before the leads load (D9).
//   3. deliveryRows: the phone Row's flag, words and tone; the first building
//      conflict and its severity.
//   4. documentRows: where each row links (a COI keeps its sub), the chips'
//      counts, the 30-day expiring rule.
//   5. The CSV columns: an unknown value is an EMPTY cell, never '—' or 0.
//   6. Source pins: each screen mounts its register only in `isDesktopWeb ?`;
//      the phone literals survive in the phone arm; the disabled reasons; the
//      Board/List key in try/catch; VoiceCaptureModal in both arms; the
//      deliveries sheets framed; no new casts; the register files have no
//      hand-rolled surface card and no sans title key.
//
// Run via: bun run test:registers-lead-doc

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rowsToCsv } from '../utils/dataTable';
import {
  LEADS_BOARD, LEAD_CSV_COLUMNS, leadChipCounts, leadFirstReplyCell, leadKpiCells, leadRegisterRow, leadsBoardLayout,
} from '../utils/registers/leadRows';
import { DELIVERY_CSV_COLUMNS, deliveryRegisterRow, deliveryTone } from '../utils/registers/deliveryRows';
import {
  DOCUMENT_CHIPS, DOCUMENT_CSV_COLUMNS, documentChipCounts, documentChipMatches, documentExpiringSoon, documentRoute,
  documentTypeLabel, type DocumentRegisterRow,
} from '../utils/registers/documentRows';
import { classifyDelivery, type Delivery } from '../utils/deliverySchedule';
import type { AccessConflict } from '../utils/buildingAccess';
import type { Lead } from '../types';

const ROOT = join(__dirname, '..');
let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`); }
}
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

/** Comments blanked (strings kept), so a pin never passes on a comment. */
function stripComments(src: string): string {
  const out = src.split('');
  let i = 0;
  type Mode = 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  const blank = (at: number) => { if (out[at] !== '\n') out[at] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; blank(i); blank(i + 1); i += 2; continue; }
      if (two === '/*') { mode = 'block'; blank(i); blank(i + 1); i += 2; continue; }
      if (src[i] === "'") mode = 'sq';
      else if (src[i] === '"') mode = 'dq';
      else if (src[i] === '`') mode = 'tpl';
      i++; continue;
    }
    if (mode === 'line') { if (src[i] === '\n') mode = 'code'; else blank(i); i++; continue; }
    if (mode === 'block') {
      if (two === '*/') { mode = 'code'; blank(i); blank(i + 1); i += 2; continue; }
      blank(i); i++; continue;
    }
    if (src[i] === '\\') { i += 2; continue; }
    if ((mode === 'sq' && src[i] === "'") || (mode === 'dq' && src[i] === '"') || (mode === 'tpl' && src[i] === '`')) mode = 'code';
    i++;
  }
  return out.join('');
}
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
/** Lines carrying a cast — the unit the lane baselines were measured in. */
const castLines = (s: string, cast: 'never' | 'any') => s.split('\n').filter((l) => new RegExp(`\\bas ${cast}\\b`).test(l)).length;
const HOUR = 3_600_000;
const DAY = 86_400_000;

// ── 1. leadsBoardLayout ────────────────────────────────────────────────────
console.log('\n1. leadsBoardLayout — five columns that fit the column');
{
  const at = (w: number) => leadsBoardLayout(w);
  check('1224 (the 1512 column) → 235 wide, fits', at(1224).colWidth === 235 && at(1224).fits, JSON.stringify(at(1224)));
  check('1078 (1366) → 206, fits', at(1078).colWidth === 206 && at(1078).fits, JSON.stringify(at(1078)));
  check('992 (1280) → 188, fits', at(992).colWidth === 188 && at(992).fits, JSON.stringify(at(992)));
  check('900 → does not fit (the row scrolls, with a scrollbar)', at(900).fits === false, JSON.stringify(at(900)));
  check('the fit line is 5·180 + 4·12 = 948 (948 fits, 947 does not)', at(948).fits && !at(947).fits && at(948).colWidth === 180);
  check('1552 (the 1600 cap at 2560) → 300', at(1552).colWidth === 300, JSON.stringify(at(1552)));
  check('never wider than 360', at(4000).colWidth === 360);
  check('never narrower than 180 (a scrolled row keeps readable cards)', at(500).colWidth === 180);
  check('0 / NaN → the minimum, not fitting', at(0).colWidth === 180 && !at(0).fits && at(NaN).colWidth === 180 && !at(NaN).fits);
  const five = at(1224);
  check('five columns and four gaps stay inside the width', 5 * five.colWidth + 4 * LEADS_BOARD.gap <= 1224);
  const tokens = read('constants/designTokens.ts');
  const reg = tokens.match(/\bregister:\s*\{\s*aside:\s*(\d+),\s*boardColMin:\s*(\d+),\s*boardColMax:\s*(\d+),\s*boardGap:\s*(\d+)\s*\}/);
  check('LEADS_BOARD equals Layout.register (boardColMin / boardColMax / boardGap)',
    !!reg && Number(reg[2]) === LEADS_BOARD.colMin && Number(reg[3]) === LEADS_BOARD.colMax && Number(reg[4]) === LEADS_BOARD.gap,
    reg?.[0] ?? 'Layout.register missing');
}

// ── 2. leadRows ────────────────────────────────────────────────────────────
console.log('\n2. leadRows — the phone\'s numbers, honest when unknown');
const NOW = Date.UTC(2026, 8, 25, 16, 0, 0);
function lead(over: Partial<Lead>): Lead {
  return {
    id: 'l', name: 'Rosa', source: 'houzz', stage: 'new', receivedAt: new Date(NOW - 5.5 * HOUR).toISOString(),
    touches: [], createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', ...over,
  } as Lead;
}
{
  check('a blank budget → null (never $0)', leadRegisterRow(lead({}), NOW).budget === null);
  check('0 / 0 budget → null', leadRegisterRow(lead({ budgetMin: 0, budgetMax: 0 }), NOW).budget === null);
  check('the stated max wins', leadRegisterRow(lead({ budgetMin: 60000, budgetMax: 80000 }), NOW).budget === 80000);
  check('min only → min', leadRegisterRow(lead({ budgetMin: 25000 }), NOW).budget === 25000);
  const waiting = leadRegisterRow(lead({}), NOW);
  check('new, never replied → waiting 5h (floor, LeadCard\'s clock)', waiting.waitingHours === 5 && waiting.firstReplyHours === null, JSON.stringify(waiting));
  const replied = leadRegisterRow(lead({ stage: 'qualified', receivedAt: new Date(NOW - 10 * HOUR).toISOString(), firstRespondedAt: new Date(NOW - 8 * HOUR).toISOString() }), NOW);
  check('replied → first reply 2h, not waiting', replied.firstReplyHours === 2 && replied.waitingHours === null);
  check('a lost lead never waits', leadRegisterRow(lead({ stage: 'lost' }), NOW).waitingHours === null);
  check('stageIndex is pipeline order (new 0 … lost 4)', leadRegisterRow(lead({}), NOW).stageIndex === 0 && leadRegisterRow(lead({ stage: 'lost' }), NOW).stageIndex === 4);
  check("the source reads its label ('Houzz')", waiting.source === 'Houzz');
  check('First reply cell: waiting ≥ 1h is danger', JSON.stringify(leadFirstReplyCell(waiting)) === JSON.stringify({ text: 'waiting 5h', tone: 'danger' }));
  check("First reply cell: under an hour is 'just now'", leadFirstReplyCell({ waitingHours: 0, firstReplyHours: null })?.text === 'just now');
  check("First reply cell: replied is 'Nh'", leadFirstReplyCell(replied)?.text === '2h' && leadFirstReplyCell(replied)?.tone === null);
  check('First reply cell: unknown is null (—)', leadFirstReplyCell({ waitingHours: null, firstReplyHours: null }) === null);

  const base = { total: 3, outstanding: 1, avgResponseHours: null, wonCount: 0, lostCount: 0 };
  const cells = leadKpiCells(base);
  const win = cells.find((c) => c.key === 'win');
  const avg = cells.find((c) => c.key === 'avg');
  check('winRate null at 0 closed, with its reason (never "0%")', !!win && win.value === null && win.blockedReason === 'No won or lost leads yet', JSON.stringify(win));
  check('avg first reply null with no reply, with its reason', !!avg && avg.value === null && avg.blockedReason === 'No replies logged yet');
  check('Awaiting reply warns when > 0', cells.find((c) => c.key === 'awaiting')?.tone === 'warn');
  check('Awaiting reply is quiet at 0', leadKpiCells({ ...base, outstanding: 0 }).find((c) => c.key === 'awaiting')?.tone === undefined);
  const closed = leadKpiCells({ ...base, avgResponseHours: 3, wonCount: 1, lostCount: 2 });
  check('1 won of 3 closed → 33% (the phone formula)', closed.find((c) => c.key === 'win')?.value === '33%');
  check("avg 3 → '3h'", closed.find((c) => c.key === 'avg')?.value === '3h');
  const loading = leadKpiCells({ ...base, wonCount: 2 }, false);
  check('D9: before the leads load every cell is — + Loading…', loading.length === 4 && loading.every((c) => c.value === null && c.blockedReason === 'Loading…'), JSON.stringify(loading));
  const chips = leadChipCounts([{ stage: 'new' }, { stage: 'new' }, { stage: 'won' }]);
  check('chip counts: all 3, new 2, won 1, lost 0', chips.all === 3 && chips.new === 2 && chips.won === 1 && chips.lost === 0);
}

// ── 3. deliveryRows ────────────────────────────────────────────────────────
console.log('\n3. deliveryRows — the phone Row\'s flag, words and colour');
function delivery(over: Partial<Delivery>): Delivery {
  return {
    id: 'd', projectId: 'p', description: '14 windows', supplier: 'Pella', expectedDate: '2026-09-20', status: 'scheduled',
    createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z', ...over,
  };
}
{
  const now = new Date(2026, 8, 25, 10).getTime();
  const late = deliveryRegisterRow(classifyDelivery(delivery({}), now), []);
  check("late → tone danger, '5 days late'", late.tone === 'danger' && late.flag === 'late' && late.flagLabel === '5 days late', JSON.stringify(late));
  const soon = deliveryRegisterRow(classifyDelivery(delivery({ expectedDate: '2026-09-27' }), now), []);
  check('unconfirmed inside the window → accent', soon.tone === 'accent' && soon.flag === 'unconfirmed');
  const conf = deliveryRegisterRow(classifyDelivery(delivery({ expectedDate: '2026-09-27', status: 'confirmed' }), now), []);
  check('confirmed → quiet, and the row offers no Confirm', conf.tone === 'neutral' && conf.confirmed === true);
  check('deliveryTone(ok) is quiet', deliveryTone('ok') === 'neutral' && deliveryTone('due_soon') === 'neutral');
  const conflicts: AccessConflict[] = [
    { kind: 'no_reservation', severity: 'blocking', deliveryId: 'd', message: 'No freight elevator booked', action: 'Book it' },
    { kind: 'unconfirmed_reservation', severity: 'warning', deliveryId: 'd', message: 'Outside receiving hours', action: 'Move it' },
  ];
  const withC = deliveryRegisterRow(classifyDelivery(delivery({}), now), conflicts);
  check('the first conflict and its severity, with the count', withC.firstConflict?.message === 'No freight elevator booked' && withC.firstConflict.severity === 'blocking' && withC.conflictCount === 2);
  check('blank window / PO → null (—), never ""', late.window === null && late.po === null);
  check('a PO and a window pass through', deliveryRegisterRow(classifyDelivery(delivery({ poNumber: ' PO-9 ', window: '07:00-11:00' }), now), []).po === 'PO-9');
}

// ── 4. documentRows ────────────────────────────────────────────────────────
console.log('\n4. documentRows — every row links where it lives');
function doc(over: Partial<DocumentRegisterRow>): DocumentRegisterRow {
  return {
    id: 'x', projectId: 'p1', projectName: 'Henderson', type: 'other', title: 'T',
    status: { bucket: 'awaiting', label: 'Pending', tone: 'warning' }, createdAt: '2026-09-01T00:00:00.000Z', ...over,
  };
}
{
  const cois = [{ id: 'c1', subcontractorId: 's9' }];
  const pay = [{ id: 'a1', invoiceId: 'inv7' }, { id: 'a2', invoiceId: undefined }];
  const r = (d: DocumentRegisterRow) => JSON.stringify(documentRoute(d, cois, pay));
  check('coi → /coi-vault { subId } (the sub opens beside the vault)', r(doc({ id: 'coi-c1', type: 'coi' })) === JSON.stringify({ pathname: '/coi-vault', params: { subId: 's9' } }), r(doc({ id: 'coi-c1', type: 'coi' })));
  check('an orphaned coi → bare /coi-vault', r(doc({ id: 'coi-gone', type: 'coi' })) === JSON.stringify({ pathname: '/coi-vault' }));
  check('permit → /permits', r(doc({ id: 'permit-1', type: 'permit' })) === JSON.stringify({ pathname: '/permits' }));
  check('aia → /aia-pay-app { invoiceId }', r(doc({ id: 'aia-a1', type: 'aia_billing' })) === JSON.stringify({ pathname: '/aia-pay-app', params: { invoiceId: 'inv7' } }));
  check('an aia with no invoice → /project-detail { id }', r(doc({ id: 'aia-a2', type: 'aia_billing' })) === JSON.stringify({ pathname: '/project-detail', params: { id: 'p1' } }));
  check('submittal → /submittal { projectId, submittalId } (6c\'s split)', r(doc({ id: 'submittal-s5' })) === JSON.stringify({ pathname: '/submittal', params: { projectId: 'p1', submittalId: 's5' } }));
  check('anything else → /project-detail { id: projectId }', r(doc({ id: 'misc-1', type: 'contract' })) === JSON.stringify({ pathname: '/project-detail', params: { id: 'p1' } }));

  const rows = [
    doc({ status: { bucket: 'at_risk', label: 'Failed check', tone: 'danger' } }),
    doc({ status: { bucket: 'done', label: 'Approved', tone: 'success' } }),
    doc({ status: { bucket: 'done', label: 'Paid', tone: 'success' } }),
    doc({ status: { bucket: 'void', label: 'Denied', tone: 'muted' } }),
  ];
  const c = documentChipCounts(rows);
  check('chip counts: all 4 (void included), at risk 1, done 2', c.all === 4 && c.at_risk === 1 && c.done === 2 && c.expired === 0, JSON.stringify(c));
  check('chips are the phone\'s six, in its words', DOCUMENT_CHIPS.map((x) => x.label).join('|') === 'All|At risk|Waiting|Saved|Done|Expired');
  check("'all' matches void; a bucket only its own", documentChipMatches(rows[3], 'all') && !documentChipMatches(rows[3], 'done') && documentChipMatches(rows[1], 'done'));
  const nowMs = Date.UTC(2026, 8, 25);
  check('expiring in 10 days → soon', documentExpiringSoon(doc({ expiresAt: new Date(nowMs + 10 * DAY).toISOString() }), nowMs));
  check('expiring in 31 days → not soon (the line is 30)', !documentExpiringSoon(doc({ expiresAt: new Date(nowMs + 31 * DAY).toISOString() }), nowMs));
  check('expiring in 29 days → soon', documentExpiringSoon(doc({ expiresAt: new Date(nowMs + 29 * DAY).toISOString() }), nowMs));
  check('already past → not soon', !documentExpiringSoon(doc({ expiresAt: new Date(nowMs - DAY).toISOString() }), nowMs));
  check('an expired or void row never warns', !documentExpiringSoon(doc({ expiresAt: new Date(nowMs + 5 * DAY).toISOString(), status: { bucket: 'expired', label: 'Expired', tone: 'danger' } }), nowMs));
  check("Type: a submittal says 'Submittal', a pay app the phone tag 'AIA Billing'", documentTypeLabel(doc({ id: 'submittal-1' })) === 'Submittal' && documentTypeLabel(doc({ type: 'aia_billing' })) === 'AIA Billing');
}

// ── 5. CSV — unknown is an empty cell ──────────────────────────────────────
console.log('\n5. CSV — unknown is an EMPTY cell, never — or 0');
{
  const bareLead = leadRegisterRow(lead({ stage: 'qualified', source: undefined as unknown as Lead['source'] }), NOW);
  const lCsv = rowsToCsv(LEAD_CSV_COLUMNS, [bareLead]).split('\r\n')[1].split(',');
  const lKeys = LEAD_CSV_COLUMNS.map((c) => c.key);
  const lUnknown = ['score', 'budget', 'waiting', 'firstReply', 'projectType', 'source', 'phone', 'email'];
  check('leads: every unknown is an empty cell', lUnknown.every((k) => lCsv[lKeys.indexOf(k)] === ''), lCsv.join(','));
  const dRow = deliveryRegisterRow(classifyDelivery(delivery({ supplier: ' ' }), Date.UTC(2026, 8, 25)), []);
  const dCsv = rowsToCsv(DELIVERY_CSV_COLUMNS, [dRow]).split('\r\n')[1].split(',');
  const dKeys = DELIVERY_CSV_COLUMNS.map((c) => c.key);
  check('deliveries: supplier / window / PO / building unknown → empty', ['supplier', 'window', 'po', 'building'].every((k) => dCsv[dKeys.indexOf(k)] === ''), dCsv.join(','));
  const oCsv = rowsToCsv(DOCUMENT_CSV_COLUMNS, [doc({})]).split('\r\n')[1].split(',');
  const oKeys = DOCUMENT_CSV_COLUMNS.map((c) => c.key);
  check('documents: expires / notes unknown → empty', ['expires', 'notes'].every((k) => oCsv[oKeys.indexOf(k)] === ''), oCsv.join(','));
  const all = [...lCsv, ...dCsv, ...oCsv];
  check('no CSV cell is — or a bare 0 for an unknown', !all.includes('—') && !all.includes('0'), all.join(','));
}

// ── 6. Source pins ─────────────────────────────────────────────────────────
console.log('\n6. Source pins — desktop web only, the phone arm untouched');
/** The text of the phone arm: after the `) : (` that closes `isDesktopWeb ? (`. */
function phoneArm(src: string, opener: RegExp): string {
  const m = opener.exec(src);
  if (!m) return '';
  const rest = src.slice(m.index);
  const at = rest.indexOf(') : (');
  return at < 0 ? '' : rest.slice(at);
}
{
  const leads = stripComments(read('app/leads.tsx'));
  const open = /isDesktopWeb\s*\?\s*\(\s*<>\s*<RegisterShell\b/;
  check('leads: imports RegisterShell and LeadsTable', /from '@\/components\/registers\/RegisterShell'/.test(leads) && /from '@\/components\/registers\/LeadsTable'/.test(leads));
  check('leads: RegisterShell mounts only in `isDesktopWeb ? (`', open.test(leads) && count(leads, /<RegisterShell\b/g) === 1);
  const phone = phoneArm(leads, open);
  check('leads: the phone board literal survives in the phone arm', phone.includes('grouped[stage].map((l) =>'));
  check('leads: the phone board keeps its hidden-scrollbar row and the fabRow', /horizontal\s+showsHorizontalScrollIndicator=\{false\}/.test(phone) && phone.includes('styles.fabRow'));
  check('leads: the phone KPI bar keeps "{kpi.winRate}%"', phone.includes('{kpi.winRate}%'));
  check('leads: LeadCard keeps `const stated = statedBudgetOf(lead);`', /function LeadCard[\s\S]*const stated = statedBudgetOf\(lead\);/.test(leads));
  check('leads: the desktop board sizes its columns from leadsBoardLayout', /const board = leadsBoardLayout\(boardWidth\);/.test(leads) && /isDesktopWeb && \{ width: board\.colWidth \}/.test(leads));
  check('leads: the board scrolls sideways only when it does not fit, with a visible scrollbar', /board\.fits \? boardRow : \(\s*<ScrollView horizontal showsHorizontalScrollIndicator>/.test(leads));
  check('leads: VoiceCaptureModal is mounted in both arms', count(leads, /\{voiceModal\}/g) === 2 && count(leads, /<VoiceCaptureModal\b/g) === 1);
  check("leads: mageid_leads_view is read and written inside try", /const LEADS_VIEW_KEY = 'mageid_leads_view';/.test(leads)
    && /try \{\s*const stored = await AsyncStorage\.getItem\(LEADS_VIEW_KEY\);/.test(leads)
    && /try \{ await AsyncStorage\.setItem\(LEADS_VIEW_KEY, next\); \}/.test(leads));
  check('leads: D9 — leadsLoaded gates the KPI strip, the board, the empty banner and ReactivationBanner',
    /const \{ leads, leadsLoaded, addLead, getLeadsByStage \} = useProjects\(\);/.test(leads)
    && /leadKpiCells\(kpi, leadsLoaded\)/.test(leads)
    && /\{leadsLoaded && leads\.length === 0 \? \(/.test(leads)
    && /\{leadsLoaded \? <ReactivationBanner \/> : null\}/.test(leads)
    && /!leadsLoaded \? \(\s*<EmptyState/.test(leads)
    && /loaded=\{leadsLoaded\}/.test(leads));
  check("leads: 'n' / Add by hand PUSH /lead-detail?mode=new (no ?new=1)",
    /const onNew = useCallback\(\(\) => router\.push\(routeHref\('\/lead-detail', \{ mode: 'new' \}\)\), \[router\]\);/.test(leads) && !/\bnew\s*:\s*'1'/.test(leads));
  check("leads: New lead by voice is disabled while adding, and says why", /disabled: creating, disabledReason: creating \? 'Adding the last lead…' : null/.test(leads));
  check('leads: cast lines at or under the baseline (5 as never, 0 as any)', castLines(leads, 'never') <= 5 && castLines(leads, 'any') === 0, `${castLines(leads, 'never')} / ${castLines(leads, 'any')}`);
  check('leads: no `as never` in the desktop arm', !/as never/.test(leads.slice(leads.indexOf('const desktopActions'), leads.search(open))));

  const table = stripComments(read('components/registers/LeadsTable.tsx'));
  check("LeadsTable: every row links to /lead-detail?leadId=, no split", /getRowHref=\{\(r\) => routeHref\('\/lead-detail', \{ leadId: r\.id \}\)\}/.test(table) && !/onRowOpen=/.test(table));
  check('LeadsTable: D9 — no rows and "Loading…" before the load', /loaded \? leadListRows\(grouped, Date\.now\(\)\) : \[\]/.test(table) && /title="Loading…"/.test(table));

  const del = stripComments(read('app/deliveries.tsx'));
  const dOpen = /isDesktopWeb\s*\?\s*\(\s*<DeliveriesRegister\b/;
  check('deliveries: DeliveriesRegister mounts only in `isDesktopWeb ? (`', dOpen.test(del) && count(del, /<DeliveriesRegister\b/g) === 1);
  const dPhone = phoneArm(del, dOpen);
  check('deliveries: the phone rows survive in the phone arm', dPhone.includes('look.upcoming.map(v =>') && dPhone.includes('look.late.map(v =>') && dPhone.includes('testID={`deliveries-horizon-${d}`}'));
  check('deliveries: the root drops its top inset on desktop web only', /style=\{\[styles\.root, \{ paddingTop: insets\.top \|\| 16 \}, isDesktopWeb && styles\.rootDesktop\]\}/.test(del));
  const receive = del.slice(del.indexOf('function ReceiveSheet('), del.indexOf('function AddDeliverySheet('));
  check('deliveries: ReceiveSheet frames its sheet BEFORE the early return', /const f = useSheetFrame\('form', \{ visible: !!delivery, animationType: 'slide' \}\);/.test(receive)
    && receive.indexOf('useSheetFrame(') < receive.indexOf('if (!delivery) return null'));
  check('deliveries: ReceiveSheet binds Cmd+Enter to Mark received', /useSheetPrimaryHotkey\(!!delivery, save\);/.test(receive) && receive.indexOf('useSheetPrimaryHotkey(') < receive.indexOf('if (!delivery) return null'));
  check('deliveries: AddDeliverySheet framed, Cmd+Enter only while valid', /useSheetFrame\('form', \{ visible, animationType: 'slide' \}\)/.test(del) && /useSheetPrimaryHotkey\(visible && valid, save\);/.test(del));
  check('deliveries: both Modals consume their frame', count(del, /animationType=\{f\.animationType\}/g) === 2);
  check('deliveries: date and window get the sm field on desktop', count(del, /\[styles\.input, isDesktop && \(desktopField\('sm'\) as TextStyle\)\]/g) === 2);
  check('deliveries: no casts (0 / 0)', castLines(del, 'never') === 0 && castLines(del, 'any') === 0);

  const dReg = stripComments(read('components/registers/DeliveriesRegister.tsx'));
  check("deliveries register: bulk Mark received is off, with its reason",
    /export const DELIVERY_BULK_RECEIVE_REASON = 'Receive each load on its own — the damage question is asked for every delivery\.';/.test(dReg)
    && /label: 'Mark received', run: \(\) => \{\}, disabledReason: DELIVERY_BULK_RECEIVE_REASON/.test(dReg));
  check('deliveries register: bulk Confirm runs one delivery per render', /useOneAtATime\(/.test(dReg) && /run: confirmSelected/.test(dReg));
  check('deliveries register: Late sits above the horizon (above: late table, then the control)', dReg.indexOf("tableId=\"reg-deliveries-late\"") > 0
    && dReg.indexOf("tableId=\"reg-deliveries-late\"") < dReg.indexOf('<SegmentedControl') && /hotkeys=\{false\}/.test(dReg));
  {
    // Late is unbounded: in the shell's fixed `above` slot it would push the
    // Upcoming table to 0 px. It must scroll with the body (renderTable).
    const aboveSrc = dReg.slice(dReg.indexOf('const above ='), dReg.indexOf('const lead ='));
    const tableSrc = dReg.slice(dReg.indexOf('renderTable={'));
    check('deliveries register: `above` holds only the notices (no Late table, no horizon)',
      dReg.indexOf('const above =') > 0 && dReg.indexOf('const lead =') > dReg.indexOf('const above =')
      && aboveSrc.includes('<NoticeStrip') && !aboveSrc.includes('reg-deliveries-late') && !aboveSrc.includes('<SegmentedControl'));
    check('deliveries register: Late + horizon scroll in the body, before the Upcoming table',
      /renderTable=\{\(\) => \(\s*<View style=\{styles\.body\} testID="deliveries-register-body">\s*\{lead\}\s*<DataTable<DeliveryRegisterRow>\s*tableId="reg-deliveries-upcoming"/.test(tableSrc)
      && dReg.slice(dReg.indexOf('const lead ='), dReg.indexOf('renderTable={')).includes('tableId="reg-deliveries-late"'));
  }
  check('deliveries register: the breadcrumb is the job', /leadingCrumbs=\{\[\{ label: projectName, href: routeHref\('\/project-detail', \{ id: projectId \}\) \}\]\}/.test(dReg));
  check('deliveries register: keeps the phone header off on exit (restoreHeaderOnExit false)', /restoreHeaderOnExit=\{false\}/.test(dReg));

  const docs = stripComments(read('app/documents.tsx'));
  const oOpen = /isDesktopWeb\s*\?\s*\(\s*<DocumentsRegister\b/;
  check('documents: DocumentsRegister mounts only in `isDesktopWeb ? (`', oOpen.test(docs) && count(docs, /<DocumentsRegister\b/g) === 1);
  const oPhone = phoneArm(docs, oOpen);
  check('documents: the phone feed survives in the phone arm', oPhone.includes('filtered.map(doc =>') && oPhone.includes('<Text style={styles.docsHeroSub}>'));
  check('documents: nothing added between `type DocBucket =` and `// Themed per-tone chip styling`', (() => {
    const raw = read('app/documents.tsx');
    const span = raw.slice(raw.indexOf('type DocBucket ='), raw.indexOf('// Themed per-tone chip styling'));
    return span.length > 0 && !/isDesktop|Register|documentRoute/.test(span);
  })());
  check('documents: cast lines at or under the baseline (10 as never, 0 as any)', castLines(docs, 'never') <= 10 && castLines(docs, 'any') === 0, `${castLines(docs, 'never')}`);
  const oReg = read('components/registers/DocumentsRegister.tsx');
  const meta = /export const DOCUMENTS_REGISTER_META = '([^']*)';/.exec(oReg)?.[1] ?? '';
  check('documents register: the one-line meta names the four kinds and no contracts', meta.length > 0 && !/contract/i.test(meta) && /COIs, permits, submittals and AIA pay apps/.test(meta), meta);
  check('documents register: rows link through documentRoute (no onRowOpen)', /const r = documentRoute\(d, cois, aiaPayApps\);\s*return routeHref\(r\.pathname, r\.params\);/.test(oReg) && !/onRowOpen=/.test(stripComments(oReg)));
  check('documents register: no Folder / By / Size columns (no data behind them)', !/key: '(folder|by|size)'/.test(oReg));

  for (const f of ['components/registers/LeadsTable.tsx', 'components/registers/DeliveriesRegister.tsx', 'components/registers/DocumentsRegister.tsx']) {
    const src = stripComments(read(f));
    const styles = src.slice(src.indexOf('StyleSheet.create('));
    check(`${f}: zero casts (as never / as any / as unknown)`, !/\bas (never|any|unknown)\b/.test(src));
    check(`${f}: no hand-rolled surface (backgroundColor: t.surface)`, !/backgroundColor:\s*t\.surface\b/.test(src));
    check(`${f}: no title / headerTitle / pageTitle / screenTitle style key`, !/^\s*(title|headerTitle|pageTitle|screenTitle)\s*:/m.test(styles));
  }
  for (const f of ['utils/registers/leadRows.ts', 'utils/registers/deliveryRows.ts', 'utils/registers/documentRows.ts']) {
    const src = stripComments(read(f));
    check(`${f}: pure (no react / react-native import)`, !/from 'react(-native)?'/.test(src) && !/from '@\/components\//.test(src));
  }
}

console.log(`\nvalidate-registers-lead-doc: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
