#!/usr/bin/env bun
// scripts/validate-portfolio-typeprofit.ts
// Pinned validator for buildTypeProfitability.
// Covers: basic profit row, gating (jobCount<2), coverage, no-linkedEstimate project.
//
// Margin computation path (plan spec: use realizedMarginPct VERBATIM):
//   realizedMarginPct → computeEstimateActuals → requires linkedEstimate.items ≥ 1
//   and status !== 'draft'. Commitments with no linkedEstimateItems go to
//   untracedCommitted, which still contributes to totalCommitted.

import { buildTypeProfitability } from '../utils/portfolio/typeProfitability';
import type { Project, Commitment, LinkedEstimateItem } from '../types';

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ': ' + detail : ''}`);
    failed++;
  }
}

// ── Fixture helpers ────────────────────────────────────────────────────────

/** Minimal LinkedEstimateItem so computeEstimateActuals returns hasEstimate:true */
function makeItem(id: string, lineTotal: number): LinkedEstimateItem {
  return {
    materialId: id,
    name: 'Labor',
    category: 'Labor',
    unit: 'ls',
    quantity: 1,
    unitPrice: lineTotal,
    bulkPrice: lineTotal,
    markup: 0,
    usesBulk: false,
    lineTotal,
    supplier: '',
  };
}

/** Base project with a proper linkedEstimate (one item so hasEstimate=true) */
function makeProject(id: string, type: Project['type'], grandTotal: number, status: Project['status'] = 'completed'): Project {
  return {
    id,
    name: `Project ${id}`,
    type,
    location: 'Denver',
    squareFootage: 2000,
    quality: 'standard',
    description: '',
    status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    estimate: null,
    linkedEstimate: {
      id: `e${id}`,
      grandTotal,
      items: [makeItem(`item-${id}`, grandTotal)],
      globalMarkup: 0,
      baseTotal: grandTotal,
      markupTotal: 0,
      createdAt: new Date().toISOString(),
    },
  } as Project;
}

/** Commitment (untraced — no linkedEstimateItems → goes to untracedCommitted) */
function makeCommitment(id: string, projectId: string, amount: number): Commitment {
  return {
    id,
    projectId,
    number: id,
    type: 'subcontract',
    description: 'Scope',
    amount,
    paidToDate: 0,
    signedDate: new Date().toISOString(),
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } as Commitment;
}

// ── Test 1: basic profitability row ────────────────────────────────────────

console.log('\nTest 1: Basic two-project profitability row');
{
  // p1: revenue 100K, committed 80K → margin 20%
  // p2: revenue 100K, committed 60K → margin 40%
  const p1 = makeProject('p1', 'renovation', 100_000);
  const p2 = makeProject('p2', 'renovation', 100_000);
  const c1 = makeCommitment('c1', 'p1', 80_000);
  const c2 = makeCommitment('c2', 'p2', 60_000);

  const result = buildTypeProfitability([p1, p2], [c1, c2]);
  const row = result.rows.find(r => r.type === 'renovation')!;
  assert('renovation row exists', !!row);
  assert('jobCount = 2', row.jobCount === 2, `got ${row.jobCount}`);
  assert('gated = false (2 jobs)', !row.gated, `gated=${row.gated}`);
  // avg = (20% + 40%) / 2 = 30%
  assert('avgMarginPct ≈ 30%', Math.abs((row.avgMarginPct ?? -1) - 0.3) < 0.001, `got ${row.avgMarginPct}`);
  assert('totalRevenue = 200K', row.totalRevenue === 200_000, `got ${row.totalRevenue}`);
  assert('definitionNote present', result.definitionNote.length > 0);
  assert('coverage closedWithBasis = 2', result.coverage.closedWithBasis === 2, `got ${result.coverage.closedWithBasis}`);
}

// ── Test 2: gating — only 1 job, margin suppressed ────────────────────────

console.log('\nTest 2: Gating — single job suppresses margin');
{
  const p1 = makeProject('p1', 'roofing', 100_000);
  const c1 = makeCommitment('c1', 'p1', 40_000);
  const result = buildTypeProfitability([p1], [c1]);
  const row = result.rows.find(r => r.type === 'roofing')!;
  assert('gated = true (1 job)', row.gated, `gated=${row.gated}`);
  assert('avgMarginPct = null when gated', row.avgMarginPct === null);
}

// ── Test 3: no-linkedEstimate closed project — coverage line ──────────────

console.log('\nTest 3: Closed project with no estimate → in closedTotal but not closedWithBasis');
{
  const p1 = {
    ...makeProject('p1', 'new_build', 100_000),
    linkedEstimate: null,
  } as Project;
  const result = buildTypeProfitability([p1], []);
  assert('closedTotal = 1', result.coverage.closedTotal === 1);
  assert('closedWithBasis = 0 (no estimate)', result.coverage.closedWithBasis === 0, `got ${result.coverage.closedWithBasis}`);
  const row = result.rows.find(r => r.type === 'new_build')!;
  assert('jobCount = 0 (no margin basis)', row.jobCount === 0);
}

// ── Test 4: never throws on empty input ───────────────────────────────────

console.log('\nTest 4: Empty input — never throws');
{
  let threw = false;
  try {
    const result = buildTypeProfitability([], []);
    assert('returns 12 rows for all project types', result.rows.length === 12);
    assert('all rows gated (no data)', result.rows.every(r => r.gated));
  } catch {
    threw = true;
  }
  assert('did not throw', !threw);
}

// ── Test 5: revenue-weighted margin differs from simple average ───────────

console.log('\nTest 5: Revenue-weighted margin vs simple average');
{
  // Large: revenue 1M, committed 850K → margin 15%
  // Small: revenue 100K, committed 50K → margin 50%
  const pLarge = makeProject('pL', 'commercial', 1_000_000);
  const pSmall = makeProject('pS', 'commercial', 100_000);
  const cL = makeCommitment('cL', 'pL', 850_000);
  const cS = makeCommitment('cS', 'pS', 50_000);

  const result = buildTypeProfitability([pLarge, pSmall], [cL, cS]);
  const row = result.rows.find(r => r.type === 'commercial')!;
  assert('commercial row not gated', !row.gated, `gated=${row.gated}`);
  // Simple avg = (0.15 + 0.50) / 2 = 0.325
  // Revenue-weighted = (0.15×1M + 0.50×100K) / 1.1M ≈ 0.182
  const simpleAvg = row.avgMarginPct ?? 0;
  const weighted = row.revenueWeightedMarginPct ?? 0;
  assert('simple avg ≈ 32.5%', Math.abs(simpleAvg - 0.325) < 0.001, `got ${simpleAvg}`);
  assert('weighted margin < simple avg (large low-margin dominates)', weighted < simpleAvg, `weighted=${weighted}`);
}

// ── Summary ────────────────────────────────────────────────────────────────

console.log(`\nportfolio-typeprofit: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
