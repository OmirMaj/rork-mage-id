// scripts/validate-leakco-draft.ts
//
// F3 validator: priced/unpriced split, dedupe against processed set AND
// marker, number sequencing, description format, gate-closed → empty plan.
// Pure — no React, no network, no AsyncStorage.
// Exits non-zero on any assertion failure.

import {
  collectDraftableLeaks, buildDraftCO, AUTO_DRAFT_ACTION, isAutoLeakDraft,
  formatReportDayLocal, guardSnippetsForReportDate,
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

// ─── Test 12: same-project multi-candidate sweep — strictly increasing
//     numbers when drafts are accumulated (the hook's loop contract) ───────

console.log('\nbuildDraftCO — same-project accumulation numbering');

{
  const repA = makeReport({
    id: 'r-acc-a', projectId: 'p1', date: '2026-07-21',
    pricedItems: [{ description: 'Tuesday extras', estimatedPrice: 900 }],
  });
  const repB = makeReport({
    id: 'r-acc-b', projectId: 'p1', date: '2026-07-23',
    pricedItems: [{ description: 'Thursday extras', estimatedPrice: 1500 }],
  });
  const accCandidates = collectDraftableLeaks({
    dailyReports: [repA, repB], projects: [proj1], changeOrders: [],
    processedReportIds: new Set(), now: NOW,
  });
  assert(accCandidates.length === 2, 'two same-project candidates collected');

  // Mirror hooks/useLeakCoDrafts: accumulate drafts into the existing list
  // fed to the next buildDraftCO call.
  const drafted: ChangeOrder[] = [];
  for (const c of accCandidates) {
    const projectCOs = drafted.filter(d => d.projectId === c.project.id);
    const draft = buildDraftCO(c, projectCOs, '2026-07-26');
    drafted.push(draft);
  }
  assert(drafted.length === 2, 'both candidates drafted');
  assert(
    drafted[0]!.number === 1 && drafted[1]!.number === 2,
    `same-project drafts get strictly increasing numbers (got ${drafted[0]!.number}, ${drafted[1]!.number})`,
  );

  // Regression pin: feeding the SAME (stale) list to both calls collides —
  // the accumulation is load-bearing.
  const stale1 = buildDraftCO(accCandidates[0]!, [], '2026-07-26');
  const stale2 = buildDraftCO(accCandidates[1]!, [], '2026-07-26');
  assert(
    stale1.number === stale2.number,
    'stale-snapshot sequencing collides (documents why accumulation is required)',
  );
}

// ─── Test 13: local-day parity — timestamped report dates ─────────────────

console.log('\nformatReportDayLocal + manual guard — UTC/local parity');

{
  // A timestamp: the LOCAL rendition must match the manual path exactly.
  const eveningTs = '2026-07-27T02:00:00.000Z'; // ~7pm Jul 26 in US-Pacific
  const manualWhen = new Date(eveningTs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  assert(
    formatReportDayLocal(eveningTs) === manualWhen,
    `formatReportDayLocal matches manual toLocaleDateString rendering (${manualWhen})`,
  );

  // Date-only strings stay plain calendar dates (no timezone shifting).
  assert(formatReportDayLocal('2026-07-24') === 'Jul 24', 'date-only string renders as-is');

  // The guard catches a manual CO drafted the manual way from a timestamp.
  const tsReport = makeReport({
    id: 'r-ts', projectId: 'p1', date: eveningTs,
    pricedItems: [{ description: 'Evening extras', estimatedPrice: 2000 }],
  });
  const manualFromTs: ChangeOrder = {
    ...manualCO,
    id: 'co-manual-ts',
    description: `Out-of-scope work from daily report ${manualWhen}: Evening extras (~$2,000)`,
  };
  const parityCandidates = collectDraftableLeaks({
    dailyReports: [tsReport], projects: [proj1], changeOrders: [manualFromTs],
    processedReportIds: new Set(), now: NOW,
  });
  assert(parityCandidates.length === 0, 'manual guard catches local-day CO from timestamped report');

  // Builder description uses the local day too (round-trips with the guard).
  const builtFromTs = buildDraftCO(
    collectDraftableLeaks({
      dailyReports: [tsReport], projects: [proj1], changeOrders: [],
      processedReportIds: new Set(), now: NOW,
    })[0]!,
    [], '2026-07-26',
  );
  assert(
    builtFromTs.description.includes(`from daily report ${manualWhen}`),
    'builder description uses the LOCAL calendar day',
  );

  // ±1 day tolerance: a manual CO whose rendered day is off by one (legacy
  // UTC-sliced draft) is still caught.
  const snippets = guardSnippetsForReportDate('2026-07-24');
  assert(
    snippets.includes('from daily report Jul 24') &&
    snippets.includes('from daily report Jul 23') &&
    snippets.includes('from daily report Jul 25'),
    'guard snippets cover the report day ±1',
  );
  const offByOneCO: ChangeOrder = {
    ...manualCO,
    id: 'co-manual-off1',
    description: 'Out-of-scope work from daily report Jul 25: Extra framing (~$1,200)',
  };
  const tolCandidates = collectDraftableLeaks({
    dailyReports: [rep1], projects: [proj1], changeOrders: [offByOneCO],
    processedReportIds: new Set(), now: NOW,
  });
  assert(tolCandidates.length === 0, 'manual guard tolerates ±1 day (off-by-one CO still blocks)');
}

// ─── Test 14: id-based dedupe is action-independent ───────────────────────

console.log('\ncollectDraftableLeaks — auditTrail report.id dedupe (any action)');

{
  const otherActionCO: ChangeOrder = {
    ...markedCO,
    id: 'co-other-action',
    auditTrail: [{ id: 'a2', action: 'created', actor: 'GC', timestamp: '', detail: 'r1' }],
  };
  const idDedupe = collectDraftableLeaks({
    dailyReports: [rep1], projects: [proj1], changeOrders: [otherActionCO],
    processedReportIds: new Set(), now: NOW,
  });
  assert(idDedupe.length === 0, 'any auditTrail entry with detail=report.id blocks re-draft');
}

// ─── Summary ──────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('leakco-draft validator FAILED');
  process.exit(1);
}
console.log('leakco-draft validator PASSED');
