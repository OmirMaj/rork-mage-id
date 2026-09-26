// validate-registers-sub-coi.ts — the Subs and COI Vault desktop-web REGISTERS
// (wave 6d, lane R2).
//
// WHY. Subs and the COI Vault are the compliance registers a GC lives in; on
// his 1512 px MacBook they were card stacks, the COI detail replaced the whole
// list, and a sub's expiring COI was three taps deep. Desktop web now shows a
// sortable table with the record opened beside it; the iPhone must not change
// by one node (the goldens in __tests__/smoke/w6d-r2-phone.test.tsx prove the
// tree; this proves the rules and pins the wiring).
//
// This EXECUTES the pure rules and pins the wiring:
//
//   1. coiRows: the check's four words equal statusToVisuals' labels in
//      app/coi-vault.tsx (by text); no certificate → policyCount null (never
//      0), check 'none'; a record-typed expiry reports expirySource 'record';
//      the LATEST certificate by upload is the one read; issues count
//      critical + warning only; coiSummary equals the phone's
//      complianceSummary re-implemented here; the chips partition by it;
//      coverageHasContent is coi-vault's rowHasContent, same expression.
//   2. subRows: subStatusCounts equals the phone's stats memo re-implemented
//      over getComplianceStatus; complianceTone; open commitments are this
//      sub's ACTIVE ones only; no scorecard → grade/score null; trade chips
//      only count trades that exist, in SUB_TRADES order.
//   3. CSV: an unknown value is an EMPTY cell — never '—' and never 0.
//   4. Source pins: each screen mounts its register only in `isDesktopWeb ?`;
//      the phone literals survive in the phone arm; the split params; the two
//      disabledReason strings; the subs detail body hoisted once (the
//      nav-coverage order kept); the cast baselines (subs 3/1, coi-vault 0/1).
//
// Run via: bun run test:registers-sub-coi

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rowsToCsv } from '../utils/dataTable';
import {
  COI_CHECK_LABEL, COI_CSV_COLUMNS, coiAttentionCount, coiChipMatches, coiRegisterRow, coiSummary, coverageHasContent,
  type CoiChip,
} from '../utils/registers/coiRows';
import {
  SUB_CSV_COLUMNS, complianceTone, subChipMatches, subRegisterRow, subStatusCounts, subTradeCounts, subsByUpdated,
} from '../utils/registers/subRows';
import { getComplianceStatus, vaultCoiExpiry, vaultCoiStatus } from '../utils/subCompliance';
import { SUB_TRADES, type CertificateOfInsurance, type Commitment, type Subcontractor } from '../types';

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

// ── Fixtures ───────────────────────────────────────────────────────────────
// Noon local on 2026-08-15: every calendar-day read is unambiguous.
const NOW = new Date(2026, 7, 15, 12, 0, 0);
const NOW_MS = NOW.getTime();

function sub(id: string, over: Partial<Subcontractor> = {}): Subcontractor {
  return {
    id, companyName: `Co ${id}`, contactName: '', phone: '', email: '', address: '', trade: 'General',
    licenseNumber: '', licenseExpiry: '', coiExpiry: '', w9OnFile: false, bidHistory: [], assignedProjects: [], notes: '',
    createdAt: '2026-07-01T12:00:00.000Z', updatedAt: '2026-07-01T12:00:00.000Z', ...over,
  };
}
function coi(id: string, subId: string, over: Partial<CertificateOfInsurance> = {}): CertificateOfInsurance {
  return { id, subcontractorId: subId, fileUri: '', uploadedAt: '2026-08-01T12:00:00.000Z', ...over };
}

const SUBS: Subcontractor[] = [
  sub('a', { companyName: 'Alpha Electric', trade: 'Electrical', licenseExpiry: '2027-06-30', coiExpiry: '2027-03-31', updatedAt: '2026-08-10T12:00:00.000Z' }),
  sub('b', { companyName: 'Bravo HVAC', trade: 'HVAC', licenseExpiry: '2027-01-15', coiExpiry: '2026-08-25', updatedAt: '2026-08-12T12:00:00.000Z' }),
  sub('c', { companyName: 'Charlie Masonry', trade: 'Concrete' }),
  sub('d', { companyName: 'Delta Roof', trade: 'Roofing', licenseExpiry: '2027-01-01', coiExpiry: '2026-07-01' }),
  sub('e', { companyName: 'Echo Glass', trade: 'Glazing', licenseExpiry: 'next year', coiExpiry: '2027-02-01' }),
  sub('f', { companyName: 'Foxtrot Paint', trade: 'Painting', coiExpiry: '2026-09-01' }),
  sub('g', { companyName: 'Golf Electric', trade: 'Electrical', coiExpiry: 'soon-ish' }),
];
const COIS: CertificateOfInsurance[] = [
  // a: an OLD passing cert, then the latest one FAILED — the latest is read.
  coi('a-old', 'a', { uploadedAt: '2026-01-01T12:00:00.000Z', validation: { validatedAt: '2026-01-01', overallStatus: 'pass', issues: [] }, coverages: [{ type: 'general_liability', expiresAt: '2026-12-31' }] }),
  coi('a-new', 'a', {
    uploadedAt: '2026-08-01T12:00:00.000Z',
    validation: {
      validatedAt: '2026-08-01', overallStatus: 'fail', confidence: 80,
      issues: [
        { code: 'info_only', severity: 'info', message: 'FYI' },
        { code: 'additional_insured_missing', severity: 'critical', message: 'No additional insured.' },
        { code: 'waiver', severity: 'warning', message: 'No waiver.' },
      ],
    },
    coverages: [
      { type: 'general_liability', policyNumber: 'GL-1', expiresAt: '2027-03-31' },
      { type: 'workers_comp', carrierName: '  ' }, // no content → not a policy
      { type: 'auto', expiresAt: '2027-02-28' },
    ],
  }),
  // b: never checked, typed coverage.
  coi('b1', 'b', { coverages: [{ type: 'general_liability', expiresAt: '2026-08-25' }] }),
  // d: a certificate with NO coverage dates → the record's typed (expired) date.
  coi('d1', 'd', { validation: { validatedAt: '2026-06-01', overallStatus: 'pass', issues: [] }, coverages: [] }),
];

// ── 1. coiRows ─────────────────────────────────────────────────────────────
console.log('\n1. coiRows — the phone vault\'s own facts');
{
  const vault = stripComments(read('app/coi-vault.tsx'));
  const fn = vault.slice(vault.indexOf('function statusToVisuals('), vault.indexOf('const makeStyles'));
  const labelOf = (k: string) => {
    const m = fn.match(new RegExp(`case '${k}':[^\\n]*label: '([^']+)'`));
    return m ? m[1] : null;
  };
  for (const k of ['pass', 'warn', 'fail'] as const) {
    check(`COI_CHECK_LABEL.${k} === statusToVisuals('${k}').label ('${labelOf(k)}')`, labelOf(k) !== null && COI_CHECK_LABEL[k] === labelOf(k));
  }
  const none = fn.match(/default:[^\n]*label: '([^']+)'/);
  check(`COI_CHECK_LABEL.none === statusToVisuals('none').label ('${none?.[1]}')`, !!none && /case 'none':\s*default:/.test(fn) && COI_CHECK_LABEL.none === none[1]);

  const rh = vault.match(/function rowHasContent\(c: COICoverage\): boolean \{\s*return ([^;]+);/);
  const mine = stripComments(read('utils/registers/coiRows.ts')).match(/export function coverageHasContent\(c: COICoverage\): boolean \{\s*return ([^;]+);/);
  check('coverageHasContent is coi-vault\'s rowHasContent, same expression', !!rh && !!mine && rh[1].trim() === mine[1].trim(), `${rh?.[1]} vs ${mine?.[1]}`);
  check('coverageHasContent: a blank carrier is not a policy; a typed expiry is', !coverageHasContent({ type: 'other', carrierName: '  ' }) && coverageHasContent({ type: 'other', expiresAt: '2027-01-01' }));

  const rows = SUBS.map((s) => coiRegisterRow(s, COIS, NOW));
  const by = (id: string) => rows.find((r) => r.id === id)!;
  const a = by('a');
  check('the LATEST certificate by upload is read (a: fail, not the old pass)', a.check === 'fail' && a.lastUploadAt === '2026-08-01T12:00:00.000Z');
  check('certCount counts every certificate on file (a: 2)', a.certCount === 2);
  check('policyCount counts content rows on the latest certificate only (a: 2 of 3)', a.policyCount === 2, String(a.policyCount));
  check('issues count critical + warning only, first issue named (a: 2 · "No additional insured.")', a.issueCount === 2 && a.firstIssue === 'No additional insured.');
  check('the expiry is the certificate\'s earliest coverage day (a: 2027-02-28, certificate)', a.expiryDay === '2027-02-28' && a.expirySource === 'certificate');
  const b = by('b');
  check('an unchecked certificate reads "Review needed" (warn) with no issue count (null)', b.check === 'warn' && b.issueCount === null && b.firstIssue === null);
  check('b expires in 10 days: daysLeft 10, statusKey expiring', b.daysLeft === 10 && b.statusKey === 'expiring', `${b.daysLeft} ${b.statusKey}`);
  const c = by('c');
  check('no certificate: policyCount null (never 0), check none, issueCount null, certCount 0', c.policyCount === null && c.check === 'none' && c.issueCount === null && c.certCount === 0);
  check('no certificate and no typed date: expiry unknown (null, source none, daysLeft null)', c.expiryDay === null && c.expirySource === 'none' && c.daysLeft === null && c.statusKey === 'unknown');
  const d = by('d');
  check('a certificate with no coverage dates falls back to the record: expirySource "record"', d.expirySource === 'record' && d.expiryDay === '2026-07-01' && d.statusKey === 'expired' && d.daysLeft !== null && d.daysLeft < 0);
  check('a record-typed expiry with NO certificate also reports "record" (f)', by('f').expirySource === 'record' && by('f').certCount === 0);
  check('status equals vaultCoiStatus(vaultCoiExpiry(latest, sub), now) on every row',
    rows.every((r) => {
      const s = SUBS.find((x) => x.id === r.id)!;
      const mineC = COIS.filter((x) => x.subcontractorId === s.id);
      const latest = mineC.length ? mineC.slice().sort((p, q) => new Date(q.uploadedAt).getTime() - new Date(p.uploadedAt).getTime())[0] : undefined;
      const st = vaultCoiStatus(vaultCoiExpiry(latest, s), NOW);
      return st.key === r.statusKey && st.label === r.statusLabel && st.tone === r.tone;
    }));

  // The phone's complianceSummary, re-implemented verbatim.
  let expired = 0; let expiringSoon = 0; let missing = 0;
  for (const s of SUBS) {
    const subC = COIS.filter((x) => x.subcontractorId === s.id);
    if (subC.length === 0) { missing += 1; continue; }
    const latest = [...subC].sort((p, q) => new Date(q.uploadedAt).getTime() - new Date(p.uploadedAt).getTime())[0];
    const st = vaultCoiStatus(vaultCoiExpiry(latest, s), NOW);
    if (st.key === 'expired') expired += 1;
    else if (st.key === 'expiring') expiringSoon += 1;
  }
  const sum = coiSummary(rows);
  check(`coiSummary equals the phone's complianceSummary (${expired}/${expiringSoon}/${missing})`, sum.expired === expired && sum.expiringSoon === expiringSoon && sum.missing === missing, JSON.stringify(sum));
  check('the fixture exercises every bucket', expired > 0 && expiringSoon > 0 && missing > 0);
  check('coiAttentionCount = expired + expiring + missing', coiAttentionCount(rows) === expired + expiringSoon + missing);
  const chipN = (ch: CoiChip) => rows.filter((r) => coiChipMatches(r, ch)).length;
  check('each chip holds exactly the rows its count names', chipN('all') === rows.length && chipN('expired') === sum.expired && chipN('expiring') === sum.expiringSoon && chipN('missing') === sum.missing);
}

// ── 2. subRows ─────────────────────────────────────────────────────────────
console.log('\n2. subRows — the phone Subs tab\'s own rule');
{
  // The phone's stats memo, re-implemented verbatim.
  const compliant = SUBS.filter((s) => getComplianceStatus(s, NOW_MS) === 'compliant').length;
  const expiring = SUBS.filter((s) => getComplianceStatus(s, NOW_MS) === 'expiring_soon').length;
  const expired = SUBS.filter((s) => getComplianceStatus(s, NOW_MS) === 'expired').length;
  const unknown = SUBS.filter((s) => getComplianceStatus(s, NOW_MS) === 'unknown').length;
  const got = subStatusCounts(SUBS, NOW_MS);
  check(`subStatusCounts equals the phone's stats memo (${compliant}/${expiring}/${expired}/${unknown} of ${SUBS.length})`,
    got.compliant === compliant && got.expiring === expiring && got.expired === expired && got.unknown === unknown && got.total === SUBS.length,
    JSON.stringify(got));
  check('the fixture exercises every state', compliant > 0 && expiring > 0 && expired > 0 && unknown > 0);
  check('complianceTone: compliant success, expiring warning, expired error, unknown neutral',
    complianceTone('compliant') === 'success' && complianceTone('expiring_soon') === 'warning' && complianceTone('expired') === 'error' && complianceTone('unknown') === 'neutral');

  const commitments: Pick<Commitment, 'subcontractorId' | 'status' | 'amount' | 'changeAmount'>[] = [
    { subcontractorId: 'a', status: 'active', amount: 1000.1, changeAmount: 250.25 },
    { subcontractorId: 'a', status: 'active', amount: 500 },
    { subcontractorId: 'a', status: 'closed', amount: 9999 },
    { subcontractorId: 'a', status: 'draft', amount: 7777 },
    { subcontractorId: 'b', status: 'active', amount: 42 },
  ];
  const a = subRegisterRow(SUBS[0], commitments, { grade: 'B', score: 81 }, NOW_MS);
  check('open commitments: this sub\'s ACTIVE ones only (a: 2)', a.openCommitments === 2);
  check('open committed: Σ amount + changeAmount over them, to the cent (a: 1750.35)', Math.round(a.openCommitted * 100) === 175035, String(a.openCommitted));
  check('the grade and score are the card\'s', a.grade === 'B' && a.score === 81);
  check('the label is complianceLabel (a: Compliant)', a.compliance === 'compliant' && a.complianceLabel === 'Compliant');
  const c = subRegisterRow(SUBS[2], commitments, null, NOW_MS);
  check('no scorecard: grade and score null (never 0)', c.grade === null && c.score === null);
  check("no COI date: coiDay and coiDaysLeft null; the label names the gap ('No docs')", c.coiDay === null && c.coiDaysLeft === null && c.complianceLabel === 'No docs');
  check("an unreadable COI date is unknown, not a day (g: 'soon-ish')", subRegisterRow(SUBS[6], [], null, NOW_MS).coiDay === null);
  const b = subRegisterRow(SUBS[1], commitments, null, NOW_MS);
  check('b: COI in 10 days (coiDaysLeft 10), Expiring Soon', b.coiDay === '2026-08-25' && b.coiDaysLeft === 10 && b.complianceLabel === 'Expiring Soon');
  const order = subsByUpdated(SUBS.map((s) => subRegisterRow(s, [], null, NOW_MS))).map((r) => r.id);
  check('rows keep the phone\'s order: updatedAt, newest first', order[0] === 'b' && order[1] === 'a', order.join(','));
  check('subsByUpdated sorts a COPY (the context array is not touched)', SUBS[0].id === 'a' && SUBS[1].id === 'b');
  const trades = subTradeCounts(SUBS, SUB_TRADES);
  const elec = trades.find((t) => t.trade === 'Electrical');
  check('trade chips: only trades with subs, counted, in SUB_TRADES order',
    trades.length === 6 && elec?.count === 2 && trades.every((t) => t.count > 0)
    && trades.map((t) => SUB_TRADES.indexOf(t.trade)).every((v, i, arr) => i === 0 || arr[i - 1] < v));
  const rowsAll = SUBS.map((s) => subRegisterRow(s, [], null, NOW_MS));
  check('the compliance chips hold exactly the phone\'s stat-card counts',
    rowsAll.filter((r) => subChipMatches(r, 'compliant')).length === compliant
    && rowsAll.filter((r) => subChipMatches(r, 'expiring')).length === expiring
    && rowsAll.filter((r) => subChipMatches(r, 'expired')).length === expired
    && rowsAll.filter((r) => subChipMatches(r, 'unknown')).length === unknown);
  check('a trade chip holds that trade only', rowsAll.filter((r) => subChipMatches(r, 'trade:Electrical')).length === 2);
}

// ── 3. CSV ─────────────────────────────────────────────────────────────────
console.log('\n3. CSV — unknown is an empty cell');
{
  const unknownCoi = coiRegisterRow(sub('z', { companyName: 'Zulu', trade: 'Other' }), [], NOW);
  const coiCsv = rowsToCsv(COI_CSV_COLUMNS, [unknownCoi]).split('\n')[1].split(',');
  const at = (cols: readonly { key: string }[], k: string) => cols.findIndex((c) => c.key === k);
  for (const k of ['expiry', 'source', 'daysLeft', 'policies', 'issues', 'firstIssue', 'lastUpload']) {
    check(`COI CSV: unknown ${k} is an empty cell`, coiCsv[at(COI_CSV_COLUMNS, k)] === '', JSON.stringify(coiCsv[at(COI_CSV_COLUMNS, k)]));
  }
  check('COI CSV: no cell reads — ', !coiCsv.some((v) => v.includes('—')));
  check('COI CSV: certificates is a KNOWN 0 (no certificate on file)', coiCsv[at(COI_CSV_COLUMNS, 'certs')] === '0');
  const unknownSub = subRegisterRow(sub('z'), [], null, NOW_MS);
  const subCsv = rowsToCsv(SUB_CSV_COLUMNS, [unknownSub]).split('\n')[1].split(',');
  for (const k of ['trade', 'coiExpiry', 'coiDaysLeft', 'grade', 'score', 'contact', 'phone', 'email', 'license']) {
    const v = subCsv[at(SUB_CSV_COLUMNS, k)];
    check(`Subs CSV: unknown ${k} is an empty cell`, k === 'trade' ? v === 'General' : v === '', JSON.stringify(v));
  }
  check('Subs CSV: no cell reads — ', !subCsv.some((v) => v.includes('—')));
}

// ── 4. Source pins ─────────────────────────────────────────────────────────
console.log('\n4. Source pins — the phone arm, the splits, the reasons');
{
  const SCREENS = [
    { file: 'app/(tabs)/subs/index.tsx', register: 'SubsRegister', phone: ['renderItem={renderSub}', 'testID="subs-search"', 'testID="open-coi-vault"'], never: 3, any: 1 },
    { file: 'app/coi-vault.tsx', register: 'CoiVaultRegister', phone: ['subcontractors.map(sub =>', "<Stack.Screen options={{ title: 'Sub Insurance' }} />", 'eyebrow="COI Tracker"'], never: 0, any: 1 },
  ];
  for (const s of SCREENS) {
    const src = stripComments(read(s.file));
    check(`${s.file}: imports ${s.register}`, new RegExp(`import \\{ ${s.register} \\} from '@/components/registers/${s.register}'`).test(src));
    check(`${s.file}: mounts <${s.register}> only as \`isDesktopWeb ? (<${s.register}\``, count(src, new RegExp(`<${s.register}\\b`, 'g')) === 1 && new RegExp(`isDesktopWeb\\s*\\?\\s*\\(?\\s*<${s.register}\\b`).test(src));
    check(`${s.file}: the gate is useIsDesktopWeb()`, /const isDesktopWeb = useIsDesktopWeb\(\);/.test(src));
    const reg = src.indexOf(`<${s.register}`);
    const armOpen = src.indexOf(') : (<>', reg);
    const armClose = src.indexOf('</>)}', armOpen);
    check(`${s.file}: the phone arm follows the register`, reg > 0 && armOpen > reg && armClose > armOpen);
    for (const lit of s.phone) {
      const at = src.indexOf(lit);
      check(`${s.file}: phone literal survives in the phone arm — ${lit}`, at > armOpen && at < armClose && count(src, new RegExp(lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) === 1);
    }
    check(`${s.file}: useSplitRecord({ param: 'subId' })`, src.includes("useSplitRecord({ param: 'subId' })"));
    const nv = count(src, /\bas never\b/g);
    const an = count(src, /\bas any\b/g);
    check(`${s.file}: as never ≤ ${s.never}, as any ≤ ${s.any} (baseline)`, nv <= s.never && an <= s.any, `${nv}/${an}`);
  }
  const subs = stripComments(read('app/(tabs)/subs/index.tsx'));
  check('subs: showDetail is the split on desktop web, the sheet state elsewhere',
    subs.includes('const showDetail = isDesktopWeb ? (subcontractors.find(s => s.id === split.openId) ?? null) : detailState;'));
  check('subs: setShowDetail is stable (deps []) and reads the live gate through a ref',
    /const setShowDetail = useCallback\(\(s: Subcontractor \| null\) => \{\s*const \{ isDesktopWeb: dw, split: sp \} = liveRef\.current;\s*if \(dw\) \{ if \(s\) sp\.open\(s\.id\); else sp\.close\(\); \} else setDetailState\(s\);\s*\}, \[\]\);/.test(subs)
    && subs.includes('liveRef.current = { isDesktopWeb, split };'));
  check('subs: the detail sheet never opens on desktop web (the record is in the pane)', subs.includes('visible={!isDesktopWeb && showDetail !== null}'));
  check('subs: Edit keeps the desktop record open under the sheet', /if \(!liveRef\.current\.isDesktopWeb\) setShowDetail\(null\);/.test(subs));
  check('subs: the detail body is hoisted ONCE and used by the sheet', count(subs, /const subDetailBody = showDetail \?/g) === 1 && count(subs, /\{subDetailBody\}/g) === 1 && /showDetail \? subDetailBody :/.test(subs));
  const sc = subs.indexOf('testID="sub-detail-scorecard"');
  const ev = subs.indexOf('<AISubEvaluator');
  const row = subs.indexOf('styles.scorecardRow');
  const push = subs.indexOf("pathname: '/sub-scorecard'");
  const close = subs.indexOf('setShowDetail(null)', row);
  check('subs: one scorecard, one AISubEvaluator, scorecard ABOVE it (nav-coverage order)',
    count(subs, /testID="sub-detail-scorecard"/g) === 1 && count(subs, /<AISubEvaluator\b/g) === 1 && sc > 0 && ev > sc);
  check("subs: setShowDetail(null) sits between the scorecard row and the /sub-scorecard push", row > 0 && close > row && close < push);
  check('subs: 2 sheets, 2 frames; Cmd+Enter saves the form',
    count(subs, /<Modal\b/g) === 2 && count(subs, /useSheetFrame\(/g) === 2 && subs.includes('useSheetPrimaryHotkey(showForm, handleSave)'));
  check("subs: the detail frame repeats the Modal's visible expression",
    subs.includes("useSheetFrame('form', { visible: !isDesktopWeb && showDetail !== null, animationType: 'slide' })"));

  const vault = stripComments(read('app/coi-vault.tsx'));
  check('coi-vault: the open sub is the split on desktop web, activeSubId elsewhere',
    vault.includes('subcontractors.find(s => s.id === (isDesktopWeb ? split.openId : activeSubId))')
    && vault.includes('cois.filter(c => c.subcontractorId === activeSub?.id)'));
  check('coi-vault: the full-screen detail is the phone\'s only', vault.includes('if (activeSub && !isDesktopWeb) {'));
  check('coi-vault: the upload button and detail body are hoisted once, used by both',
    count(vault, /const uploadButton = \(/g) === 1 && count(vault, /const coiDetailBody = activeSub \?/g) === 1
    && count(vault, /(?<!=)\{uploadButton\}/g) === 1 && count(vault, /(?<!=)\{coiDetailBody\}/g) === 1
    && /uploadButton=\{uploadButton\}/.test(vault) && /detailBody=\{coiDetailBody\}/.test(vault));
  check('coi-vault: testID="coi-upload" exists exactly once', count(vault, /testID="coi-upload"/g) === 1);
  check("coi-vault: each COICard reports unsaved coverage rows", /const \[dirty, setDirty\] = useState\(false\);[\s\S]{0,200}useRegisterRecordDirty\(\(\) => dirty\);/.test(vault));
  const card = vault.slice(vault.indexOf('function COICard('), vault.indexOf('function statusToVisuals('));
  check('coi-vault: the coverage-type rail is ChipRail (no hidden-scrollbar ScrollView left in COICard)',
    /<ChipRail contentContainerStyle=\{\{ gap: 6 \}\}>/.test(card) && !/<ScrollView horizontal/.test(card));
  const ingest = vault.indexOf('const ingest = useCallback');
  const pick = vault.indexOf('const pickFrom = useCallback');
  const between = vault.slice(ingest, pick);
  check('coi-vault: nothing new between ingest and pickFrom', ingest > 0 && pick > ingest && !/isDesktopWeb|split\.|uploadButton|coiDetailBody/.test(between));

  const subsReg = stripComments(read('components/registers/SubsRegister.tsx'));
  const coiReg = stripComments(read('components/registers/CoiVaultRegister.tsx'));
  check('subs register: bulk Delete is disabled with its reason',
    subsReg.includes("'Delete subs one at a time — each is checked for payments on record so the 1099 export keeps his TIN and address.'")
    && /disabledReason: SUBS_BULK_DELETE_REASON/.test(subsReg));
  check('coi register: bulk Request renewal is disabled with its reason',
    coiReg.includes("'MAGE ID can’t send a renewal request to a sub yet — you get an email 30, 14 and 7 days before a COI lapses, and on the day it does. Call or email the sub from Subs.'")
    && /disabledReason: COI_RENEWAL_REASON/.test(coiReg));
  check('coi register: the renewal reason matches coi-expiry-watch THRESHOLDS [30, 14, 7, 0]',
    /const THRESHOLDS = \[30, 14, 7, 0\] as const;/.test(read('supabase/functions/coi-expiry-watch/index.ts')));
  check("subs register: the record lives at /(tabs)/subs?subId=", /record=\{\{ split, param: 'subId', pathname: '\/\(tabs\)\/subs'/.test(subsReg));
  check("coi register: the record lives at /coi-vault?subId=", /record=\{\{ split, param: 'subId', pathname: '\/coi-vault'/.test(coiReg));
  check('coi register: default sort is Days left, soonest first', /defaultSort=\{\{ key: 'daysLeft', dir: 'asc' \}\}/.test(coiReg));
  check('coi register: no New (an upload needs a chosen sub)', !/onNew=/.test(coiReg));
  check('subs register: the phone header stays hidden on exit (the subs Stack hides it)', /restoreHeaderOnExit=\{false\}/.test(subsReg));
  check('subs register: the chips are subStatusCounts (the phone stat cards)', /subStatusCounts\(subcontractors, nowMs\)/.test(subsReg) && /if \(counts\.unknown > 0\)/.test(subsReg));
  for (const [file, src] of [['SubsRegister', subsReg], ['CoiVaultRegister', coiReg]] as const) {
    check(`${file}: 36 px rows (density="compact"), a reg-* table id`, /density="compact"/.test(src) && /tableId="reg-/.test(src));
    check(`${file}: every row is a link (getRowHref)`, /getRowHref=\{\(r\) => getRowHref\(r\.id\)\}/.test(src));
    check(`${file}: zero casts, no hand-rolled surface`, !/\bas (never|any|unknown)\b/.test(src) && !/backgroundColor:\s*t\.surface\b/.test(src));
  }
}

console.log(`\nvalidate-registers-sub-coi: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
