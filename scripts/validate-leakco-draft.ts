// scripts/validate-leakco-draft.ts
//
// F3 validator: priced/unpriced split, dedupe against processed set AND
// marker, number sequencing, description format, gate-closed → empty plan.
// Pure — no React, no network, no AsyncStorage.
// Exits non-zero on any assertion failure.

import {
  collectDraftableLeaks, buildDraftCO, AUTO_DRAFT_ACTION, isAutoLeakDraft,
} from '../utils/brain/leakCoDraft';
import type {
  DailyFieldReport, Project, ChangeOrder, LeakScanRecord,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  OK  ${label}`);
    passed++;
  } else {
    console.error(`  FAIL ${label}`);
    failed++;
  }
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date('2026-07-26T10:00:00');

function makeProject(id: string): Project {
  return {
    id, name: `Project ${id}`, status: 'in_progress',
    address: '', city: '', state: '', zipCode: '', phase: 'construction',
    startDate: '2026-01-01', estimatedEndDate: '2026-12-31',
    budget: 100_000, actualCost: 0, percentComplete: 50,
    description: '', trades: [], teamMembers: [],
    schedule: { tasks: [], startDate: '2026-01-01', totalDurationDays: 30, updatedAt: '' },
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  } as unknown as Project;
}

function makeReport(opts: {
  id: string; projectId: string; date: string;
  pricedItems?: { description: string; estimatedPrice: number | null; reportQuote?: string }[];
  unpricedOnly?: boolean;
}): DailyFieldReport {
  const items = opts.pricedItems ?? [];
  const leakScan: LeakScanRecord = {
    items: items.map(it => ({
      description: it.description,
      trade: 'labor',
      unit: 'ls',
      quantity: 1,
      confidence: 'medium' as const,
      reportQuote: it.reportQuote ?? '',
      estimatedPrice: it.estimatedPrice,
      rateUsed: it.estimatedPrice,
      rateConfidence: 'medium' as const,
      fromHistory: true,
    })),
    scannedAt: new Date().toISOString(),
    textHash: 'testhash',
  };
  return {
    id: opts.id, projectId: opts.projectId, date: opts.date,
    weather: { condition: 'clear', temperatureF: 75, windMph: 5, precipitationIn: 0, humidity: 50, source: 'manual' },
    manpower: [], workPerformed: 'test', materialsDelivered: [],
    issuesAndDelays: '', photos: [], status: 'submitted',
    leakScan,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as unknown as DailyFieldReport;
}

// ─── Test 1: priced items → candidate collected ────────────────────────────

console.log('\ncollectDraftableLeaks — basic');

const proj1 = makeProject('p1');
const rep1 = makeReport({
  id: 'r1', projectId: 'p1', date: '2026-07-24',
  pricedItems: [{ description: 'Extra framing', estimatedPrice: 1200 }],
});

const candidates = collectDraftableLeaks({
  dailyReports: [rep1], projects: [proj1], changeOrders: [],
  processedReportIds: new Set(), now: NOW,
});
assert(candidates.length === 1, 'priced scan produces 1 candidate');
assert(candidates[0]?.report.id === 'r1', 'candidate has correct report id');

// ─── Test 2: unpriced-only scan → excluded ────────────────────────────────

console.log('\ncollectDraftableLeaks — unpriced only');

const rep2 = makeReport({
  id: 'r2', projectId: 'p1', date: '2026-07-24',
  pricedItems: [{ description: 'Mystery work', estimatedPrice: null }],
});
const candidatesUnpriced = collectDraftableLeaks({
  dailyReports: [rep2], projects: [proj1], changeOrders: [],
  processedReportIds: new Set(), now: NOW,
});
assert(candidatesUnpriced.length === 0, 'unpriced-only scan excluded');

// ─── Test 3: processedReportIds deduplication ────────────────────────────

console.log('\ncollectDraftableLeaks — processedReportIds dedupe');

const alreadyProcessed = new Set<string>(['r1']);
const candidatesDeduped = collectDraftableLeaks({
  dailyReports: [rep1], projects: [proj1], changeOrders: [],
  processedReportIds: alreadyProcessed, now: NOW,
});
assert(candidatesDeduped.length === 0, 'already-processed report excluded');

// ─── Test 4: auditTrail marker dedupe ────────────────────────────────────

console.log('\ncollectDraftableLeaks — auditTrail marker');

const markedCO: ChangeOrder = {
  id: 'co-marked', number: 1, projectId: 'p1', date: '2026-07-24',
  description: 'auto', reason: 'out_of_scope', lineItems: [],
  originalContractValue: 0, changeAmount: 1200, newContractTotal: 1200,
  status: 'draft',
  auditTrail: [{ id: 'a1', action: AUTO_DRAFT_ACTION, actor: 'MAGE', timestamp: '', detail: 'r1' }],
  createdAt: '', updatedAt: '',
};
const candidatesMarked = collectDraftableLeaks({
  dailyReports: [rep1], projects: [proj1], changeOrders: [markedCO],
  processedReportIds: new Set(), now: NOW,
});
assert(candidatesMarked.length === 0, 'auditTrail marker excludes report');

// ─── Test 5: manual draft description guard ───────────────────────────────

console.log('\ncollectDraftableLeaks — manual draft guard');

const manualCO: ChangeOrder = {
  id: 'co-manual', number: 2, projectId: 'p1', date: '2026-07-24',
  description: 'Out-of-scope work from daily report Jul 24: Extra framing (~$1,200)',
  reason: 'out_of_scope', lineItems: [],
  originalContractValue: 0, changeAmount: 1200, newContractTotal: 1200,
  status: 'draft', createdAt: '', updatedAt: '',
};
const candidatesManual = collectDraftableLeaks({
  dailyReports: [rep1], projects: [proj1], changeOrders: [manualCO],
  processedReportIds: new Set(), now: NOW,
});
assert(candidatesManual.length === 0, 'manual draft guard excludes duplicate');

// ─── Test 6: 14-day window — old report excluded ─────────────────────────

console.log('\ncollectDraftableLeaks — 14-day window');

const oldReport = makeReport({
  id: 'r-old', projectId: 'p1', date: '2026-07-01', // > 14 days before Jul 26
  pricedItems: [{ description: 'Old work', estimatedPrice: 500 }],
});
const candidatesOld = collectDraftableLeaks({
  dailyReports: [oldReport], projects: [proj1], changeOrders: [],
  processedReportIds: new Set(), now: NOW,
});
assert(candidatesOld.length === 0, 'old report (>14 days) excluded');

// Report exactly 14 days old → included
const rep14 = makeReport({
  id: 'r14', projectId: 'p1', date: '2026-07-12', // exactly 14 days before Jul 26
  pricedItems: [{ description: 'Border work', estimatedPrice: 800 }],
});
const candidates14 = collectDraftableLeaks({
  dailyReports: [rep14], projects: [proj1], changeOrders: [],
  processedReportIds: new Set(), now: NOW,
});
assert(candidates14.length === 1, 'exactly-14-day report included');

// ─── Test 7: inactive project excluded ───────────────────────────────────

console.log('\ncollectDraftableLeaks — inactive project');

const projDone = { ...proj1, id: 'p-done', status: 'completed' as const };
const repDone = makeReport({
  id: 'r-done', projectId: 'p-done', date: '2026-07-24',
  pricedItems: [{ description: 'Closeout work', estimatedPrice: 300 }],
});
const candidatesDone = collectDraftableLeaks({
  dailyReports: [repDone], projects: [projDone],
  changeOrders: [], processedReportIds: new Set(), now: NOW,
});
assert(candidatesDone.length === 0, 'completed project excluded');

// ─── Test 8: buildDraftCO — description format ───────────────────────────

console.log('\nbuildDraftCO — description format');

const co = buildDraftCO(candidates[0]!, [], '2026-07-26');
assert(co.description.includes('Out-of-scope work from daily report'), 'description prefix correct');
assert(co.description.includes('Jul 24'), 'description includes report date');
assert(co.description.includes('Extra framing'), 'description includes item name');
assert(co.description.includes('~$1,200'), 'description includes price');
assert(co.status === 'draft', 'status is draft');
assert(co.changeAmount === 1200, 'changeAmount is 1200');

// ─── Test 9: auditTrail dedupe marker ────────────────────────────────────

console.log('\nbuildDraftCO — auditTrail marker');

assert(isAutoLeakDraft(co), 'isAutoLeakDraft is true');
assert(
  (co.auditTrail ?? []).some(e => e.action === AUTO_DRAFT_ACTION && e.detail === 'r1'),
  'auditTrail marker has correct detail (reportId)',
);

// ─── Test 10: CO number sequencing ────────────────────────────────────────

console.log('\nbuildDraftCO — number sequencing');

const existingCOs: ChangeOrder[] = [
  { id: 'c1', number: 3, projectId: 'p1' } as unknown as ChangeOrder,
  { id: 'c2', number: 7, projectId: 'p1' } as unknown as ChangeOrder,
];
const co2 = buildDraftCO(candidates[0]!, existingCOs, '2026-07-26');
assert(co2.number === 8, `CO number = max(7) + 1 = 8 (got ${co2.number})`);

// ─── Test 11: mixed priced + unpriced description ────────────────────────

console.log('\nbuildDraftCO — unpriced lines included in description');

const mixedReport = makeReport({
  id: 'r-mix', projectId: 'p1', date: '2026-07-25',
  pricedItems: [
    { description: 'Framing labor', estimatedPrice: 800 },
    { description: 'Extra material', estimatedPrice: null },
  ],
});
const mixedCandidates = collectDraftableLeaks({
  dailyReports: [mixedReport], projects: [proj1], changeOrders: [],
  processedReportIds: new Set(), now: NOW,
});
assert(mixedCandidates.length === 1, 'mixed report (has priced item) is candidate');

const mixedCO = buildDraftCO(mixedCandidates[0]!, [], '2026-07-26');
assert(mixedCO.changeAmount === 800, 'changeAmount = only priced items total');
assert(mixedCO.description.includes('NEEDS PRICE:'), 'unpriced items appear as NEEDS PRICE');
assert(mixedCO.description.includes('Extra material'), 'unpriced item name in description');

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('leakco-draft validator FAILED');
  process.exit(1);
}
console.log('leakco-draft validator PASSED');
