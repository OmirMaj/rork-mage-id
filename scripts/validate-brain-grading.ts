// scripts/validate-brain-grading.ts
// Run: bun scripts/validate-brain-grading.ts
//
// Tests pure graders with synthetic fixtures for every gradeable kind.
// Covers: resolvable, not-yet-resolvable, and eaten-leak cases.
// No React, no Supabase — imports from gradePredictions (pure) only.

import {
  gradePace,
  gradeDelayRipple,
  gradeLeak,
  gradeEstimateSnapshot,
  gradeJudges,
  gradeInstantBid,
  gradeBidScore,
  type GradingCtx,
  type TrackedBidRecord,
} from '@/utils/brain/gradePredictions';
import type { BrainPredictionReadRow } from '@/utils/brain/types';
import { computeResolvableOutcomes } from '@/utils/brain/resolveOutcomes';
import type { Project, ChangeOrder, Commitment } from '@/types';

let failures = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failures++; }
  else { console.log(`PASS: ${msg}`); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRow(
  kind: BrainPredictionReadRow['kind'],
  subjectId: string,
  payload: Record<string, unknown>,
  projectId?: string | null,
): BrainPredictionReadRow {
  return {
    id: `row_${kind}_${subjectId}`,
    user_id: 'user-1',
    kind,
    subject_id: subjectId,
    payload,
    project_id: projectId ?? null,
    predicted_at: '2026-01-01T00:00:00Z',
    resolved_at: null,
    outcome: null,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'Test Project',
    type: 'residential_remodel' as any,
    status: 'in_progress',
    address: '123 Main St',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as Project;
}

function makeClosedProject(overrides: Partial<Project> = {}): Project {
  return makeProject({
    status: 'completed',
    linkedEstimate: {
      id: 'est-1',
      grandTotal: 100000,
      items: [
        {
          materialId: 'mat-1',
          category: 'Framing',
          lineTotal: 30000,
          name: 'Framing',
          quantity: 1,
          unit: 'ls',
          unitCost: 30000,
          markup: 0,
          markupAmount: 0,
          total: 30000,
        } as any,
      ],
      totalCost: 80000,
      markup: 25,
      subtotal: 80000,
      version: 1,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    } as any,
    ...overrides,
  });
}

function makeCommitment(projectId: string, paidToDate: number): Commitment {
  return {
    id: 'comm-1',
    projectId,
    number: 'C-001',
    vendorName: 'Ace Framing',
    description: 'Framing scope',
    amount: 75000,
    paidToDate,
    status: 'active',
    type: 'subcontract',
    signedDate: '2026-01-01',
    linkedEstimateItems: ['mat-1'],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  } as Commitment;
}

function makeCtx(overrides: Partial<GradingCtx> = {}): GradingCtx {
  return {
    projects: [],
    changeOrders: [],
    commitments: [],
    ...overrides,
  };
}

// ─── gradePace ────────────────────────────────────────────────────────────────

{
  const project = makeProject({
    schedule: {
      id: 'sched-1',
      startDate: '2026-01-01',
      workingDaysPerWeek: 5,
      tasks: [
        {
          id: 'task-1',
          title: 'Framing',
          phase: 'Structure',
          durationDays: 8,
          startDay: 1,
          progress: 100,
          crew: 'Framing',
          dependencies: [],
          notes: '',
          status: 'done',
          actualStartDay: 1,
          actualEndDay: 12, // 5 working days in a 7-day window? Let's compute manually
        } as any,
      ],
    } as any,
  });
  const row = makeRow('pace_suggestion_applied', 'task-1', {
    taskId: 'task-1',
    trade: 'framing',
    aiOriginalDays: 8,
    paceDays: 6,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradePace(row, ctx);
  assert(outcome !== null, 'gradePace: resolvable when task has actuals');
  if (outcome) {
    assert(outcome.taskId === 'task-1', 'gradePace: taskId preserved');
    assert(typeof outcome.actualDays === 'number' && outcome.actualDays >= 1, 'gradePace: actualDays ≥ 1');
    assert(typeof outcome.paceBeatAi === 'boolean', 'gradePace: paceBeatAi is boolean');
    assert(typeof outcome.tie === 'boolean', 'gradePace: tie is boolean');
    assert(typeof outcome.paceErrVsAi === 'number', 'gradePace: paceErrVsAi is number');
  }
}

// Not resolvable: task missing actuals
{
  const project = makeProject({
    schedule: {
      id: 'sched-1',
      startDate: '2026-01-01',
      workingDaysPerWeek: 5,
      tasks: [
        {
          id: 'task-2',
          title: 'Framing',
          phase: 'Structure',
          durationDays: 8,
          startDay: 1,
          progress: 0,
          crew: 'Framing',
          dependencies: [],
          notes: '',
          status: 'in_progress',
          // no actualStartDay / actualEndDay
        } as any,
      ],
    } as any,
  });
  const row = makeRow('pace_suggestion_applied', 'task-2', {
    taskId: 'task-2',
    trade: 'framing',
    aiOriginalDays: 8,
    paceDays: 6,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradePace(row, ctx);
  assert(outcome === null, 'gradePace: null when task has no actuals');
}

// paceBeatAi tie window (exact 0.5d boundary)
{
  const project = makeProject({
    schedule: {
      id: 'sched-1',
      startDate: '2026-01-01',
      workingDaysPerWeek: 7, // calendar days for simplicity
      tasks: [
        {
          id: 'task-3',
          title: 'Foundation',
          phase: 'Site',
          durationDays: 10,
          startDay: 1,
          progress: 100,
          crew: 'Excavation',
          dependencies: [],
          notes: '',
          status: 'done',
          actualStartDay: 1,
          actualEndDay: 7, // 7 working days
        } as any,
      ],
    } as any,
  });
  // aiOriginal=10, pace=7, actual=7 → paceErr=0, aiErr=3 → diff=-3 < -0.5 → paceBeatAi=true
  const row = makeRow('pace_suggestion_applied', 'task-3', {
    taskId: 'task-3',
    trade: 'excavation',
    aiOriginalDays: 10,
    paceDays: 7,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradePace(row, ctx);
  assert(outcome !== null, 'gradePace tie window: resolvable');
  if (outcome) {
    assert(outcome.paceBeatAi === true, 'gradePace tie window: pace beat ai');
    assert(outcome.tie === false, 'gradePace tie window: not a tie when diff=3');
  }
}

// ─── gradeDelayRipple ─────────────────────────────────────────────────────────

{
  const project = makeProject({
    id: 'proj-1',
    schedule: {
      id: 'sched-1',
      startDate: '2026-01-01',
      workingDaysPerWeek: 5,
      tasks: [
        {
          id: 'task-a',
          title: 'Electrical',
          phase: 'Rough',
          durationDays: 5,
          startDay: 10,
          progress: 100,
          crew: 'Electrical',
          dependencies: [],
          notes: '',
          status: 'done',
          actualEndDay: 17, // planned end = 10+5-1=14, actual=17, delta=3
        } as any,
      ],
    } as any,
  });
  const row = makeRow('delay_ripple_applied', 'report-1', {
    reportId: 'report-1',
    hits: [{ taskId: 'task-a', deltaDays: 3 }],
    predictedFinishDay: 17,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradeDelayRipple(row, ctx);
  assert(outcome !== null, 'gradeDelayRipple: resolvable when all tasks have actuals');
  if (outcome) {
    assert(outcome.perTask.length === 1, 'gradeDelayRipple: perTask has 1 entry');
    assert(outcome.allResolved === true, 'gradeDelayRipple: allResolved=true');
  }
}

// CORRECTED (tribunal): applying the ripple REBASELINES the plan, so the
// post-apply schedule already carries deltaDays. A prediction whose rippled
// plan held exactly must grade errDays = |actualDelta| = 0 — the old
// |actualDelta − deltaDays| scored a perfect ripple wrong by its own delta.
{
  const project = makeProject({
    id: 'proj-1',
    schedule: {
      id: 'sched-1',
      startDate: '2026-01-01',
      workingDaysPerWeek: 5,
      tasks: [
        {
          id: 'task-p',
          title: 'Electrical',
          phase: 'Rough',
          durationDays: 8, // POST-apply duration (5 + the 3-day ripple)
          startDay: 10,    // planned end = 10+8-1 = 17
          progress: 100,
          crew: 'Electrical',
          dependencies: [],
          notes: '',
          status: 'done',
          actualEndDay: 17, // landed exactly on the rippled plan
        } as any,
      ],
    } as any,
  });
  const ctx = makeCtx({ projects: [project] });

  const noPre = gradeDelayRipple(makeRow('delay_ripple_applied', 'report-p', {
    reportId: 'report-p',
    hits: [{ taskId: 'task-p', deltaDays: 3 }], // legacy payload: no preApplyEndDay
    predictedFinishDay: 17,
  }, 'proj-1'), ctx);
  assert(noPre !== null, 'gradeDelayRipple post-apply: resolvable');
  if (noPre) {
    assert(noPre.perTask[0].actualDelta === 0, 'gradeDelayRipple post-apply: perfect ripple → actualDelta 0');
    assert(noPre.perTask[0].errDays === 0,
      `gradeDelayRipple post-apply: perfect ripple → errDays 0, not |0−deltaDays| (got ${noPre.perTask[0].errDays})`);
    assert(noPre.perTask[0].predictedDelta === 3, 'gradeDelayRipple post-apply: predictedDelta kept informational');
    assert(noPre.finishErrDays === 0, 'gradeDelayRipple post-apply: finish landed on prediction');
  }

  // Richer grading when the capture recorded preApplyEndDay (additive field):
  // err grades the predicted SHIFT — |(actual − preApplyEnd) − deltaDays|.
  const withPre = gradeDelayRipple(makeRow('delay_ripple_applied', 'report-q', {
    reportId: 'report-q',
    hits: [{ taskId: 'task-p', deltaDays: 3, preApplyEndDay: 14 }],
    predictedFinishDay: 17,
  }, 'proj-1'), ctx);
  assert(withPre !== null && withPre.perTask[0].errDays === 0,
    'gradeDelayRipple preApplyEndDay: predicted +3 off end 14, actual 17 → errDays 0');

  const withPreMiss = gradeDelayRipple(makeRow('delay_ripple_applied', 'report-r', {
    reportId: 'report-r',
    hits: [{ taskId: 'task-p', deltaDays: 5, preApplyEndDay: 14 }],
    predictedFinishDay: 19,
  }, 'proj-1'), ctx);
  assert(withPreMiss !== null && withPreMiss.perTask[0].errDays === 2,
    `gradeDelayRipple preApplyEndDay: predicted +5, actual shifted +3 → errDays 2 (got ${withPreMiss?.perTask[0].errDays})`);
}

// Not all tasks resolved
{
  const project = makeProject({
    id: 'proj-1',
    schedule: {
      id: 'sched-1',
      startDate: '2026-01-01',
      workingDaysPerWeek: 5,
      tasks: [
        {
          id: 'task-b',
          title: 'Drywall',
          phase: 'Interior',
          durationDays: 5,
          startDay: 20,
          progress: 50,
          crew: 'Drywall',
          dependencies: [],
          notes: '',
          status: 'in_progress',
          // no actualEndDay
        } as any,
      ],
    } as any,
  });
  const row = makeRow('delay_ripple_applied', 'report-2', {
    reportId: 'report-2',
    hits: [{ taskId: 'task-b', deltaDays: 2 }],
    predictedFinishDay: 30,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradeDelayRipple(row, ctx);
  assert(outcome === null, 'gradeDelayRipple: null when tasks missing actuals');
}

// ─── gradeLeak ────────────────────────────────────────────────────────────────

// Match via price window
{
  const project = makeProject({ id: 'proj-1', status: 'in_progress' });
  const co: ChangeOrder = {
    id: 'co-1',
    number: 1,
    projectId: 'proj-1',
    date: '2026-01-20T00:00:00Z',
    description: 'Extra concrete pour',
    reason: 'Unforeseen',
    lineItems: [],
    originalContractValue: 100000,
    changeAmount: 4000, // within 0.5x–2x of estPrice=3000
    newContractTotal: 104000,
    status: 'approved',
    createdAt: '2026-01-20T00:00:00Z',
    updatedAt: '2026-01-20T00:00:00Z',
  };
  const row = makeRow('leak_flag', 'report-3', {
    reportId: 'report-3',
    items: [{ category: 'Concrete', description: 'extra pour', estPrice: 3000 }],
  }, 'proj-1');
  // Ensure predicted_at is before co.date so window includes it
  row.predicted_at = '2026-01-10T00:00:00Z';
  const ctx = makeCtx({ projects: [project], changeOrders: [co] });
  const outcome = gradeLeak(row, ctx);
  assert(outcome !== null, 'gradeLeak: resolvable when CO within window');
  if (outcome) {
    assert(outcome.itemsBilled === 1, 'gradeLeak: itemsBilled=1 on price match');
    assert(outcome.itemsEaten === 0, 'gradeLeak: itemsEaten=0');
  }
}

// Token match
{
  const project = makeProject({ id: 'proj-2', status: 'in_progress' });
  const co: ChangeOrder = {
    id: 'co-2',
    number: 2,
    projectId: 'proj-2',
    date: '2026-01-25T00:00:00Z',
    description: 'Waterproofing basement membrane install',
    reason: 'Owner request',
    lineItems: [],
    originalContractValue: 50000,
    changeAmount: 1500,
    newContractTotal: 51500,
    status: 'approved',
    createdAt: '2026-01-25T00:00:00Z',
    updatedAt: '2026-01-25T00:00:00Z',
  };
  const row = makeRow('leak_flag', 'report-4', {
    reportId: 'report-4',
    items: [{ category: 'Waterproofing', description: 'waterproofing membrane', estPrice: 500 }],
  }, 'proj-2');
  row.predicted_at = '2026-01-15T00:00:00Z';
  const ctx = makeCtx({ projects: [project], changeOrders: [co] });
  const outcome = gradeLeak(row, ctx);
  assert(outcome !== null, 'gradeLeak: resolvable via token match (waterproofing)');
  if (outcome) {
    assert(outcome.itemsBilled === 1, 'gradeLeak: itemsBilled=1 on token match');
  }
}

// Closed project with no match = eaten
{
  const project = makeProject({ id: 'proj-3', status: 'completed' });
  const row = makeRow('leak_flag', 'report-5', {
    reportId: 'report-5',
    items: [{ category: 'Roofing', description: 'extra flashing', estPrice: 800 }],
  }, 'proj-3');
  row.predicted_at = '2026-01-01T00:00:00Z';
  const ctx = makeCtx({ projects: [project], changeOrders: [] });
  const outcome = gradeLeak(row, ctx);
  assert(outcome !== null, 'gradeLeak: resolvable on closed project (eaten)');
  if (outcome) {
    assert(outcome.closedNoMatch === true, 'gradeLeak: closedNoMatch=true when closed+no CO');
    assert(outcome.itemsEaten >= 1, 'gradeLeak: itemsEaten≥1 on eaten');
  }
}

// Within window, open project, no match yet → null
{
  const project = makeProject({ id: 'proj-4', status: 'in_progress' });
  const row = makeRow('leak_flag', 'report-6', {
    reportId: 'report-6',
    items: [{ category: 'Plumbing', description: 'leak in wall', estPrice: 2000 }],
  }, 'proj-4');
  row.predicted_at = new Date().toISOString(); // just now → within 60-day window
  const ctx = makeCtx({ projects: [project], changeOrders: [] });
  const outcome = gradeLeak(row, ctx);
  assert(outcome === null, 'gradeLeak: null when open project + within window + no match');
}

// ─── gradeEstimateSnapshot ────────────────────────────────────────────────────

{
  const project = makeClosedProject();
  const commitment = makeCommitment('proj-1', 82000); // slight overrun
  const row = makeRow('estimate_confidence_snapshot', 'est-1', {
    estimateId: 'est-1',
    grandTotal: 100000,
    lines: [{ id: 'mat-1', category: 'Framing', total: 30000, confidenceBand: 'high' }],
    coveragePct: 90,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project], commitments: [commitment] });
  const outcome = gradeEstimateSnapshot(row, ctx);
  assert(outcome !== null, 'gradeEstimateSnapshot: resolvable for closed project with actuals');
  if (outcome) {
    assert(outcome.estimateId === 'est-1', 'gradeEstimateSnapshot: estimateId preserved');
    assert(typeof outcome.overallBiasPct === 'number', 'gradeEstimateSnapshot: overallBiasPct is number');
    assert(Array.isArray(outcome.byBand), 'gradeEstimateSnapshot: byBand is array');
  }
}

// Not yet closed → null
{
  const project = makeProject({ status: 'in_progress' });
  const row = makeRow('estimate_confidence_snapshot', 'est-2', {
    estimateId: 'est-2',
    grandTotal: 50000,
    lines: [{ id: 'mat-2', category: 'Roofing', total: 50000, confidenceBand: 'medium' }],
    coveragePct: 60,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradeEstimateSnapshot(row, ctx);
  assert(outcome === null, 'gradeEstimateSnapshot: null for open project');
}

// ─── gradeJudges ──────────────────────────────────────────────────────────────
// PAYLOAD CONTRACT: capture (app/judges.tsx) writes targetMarginPct as a
// PERCENT (targetMargin * 100). Fixtures here mirror the real capture.

// pick-mode, closed project, target met
{
  const project = makeClosedProject({ id: 'proj-1' });
  const commitment = makeCommitment('proj-1', 70000);
  const row = makeRow('judges_verdict', 'proj-1', {
    mode: 'pick',
    verdict: 'proceed',
    targetMarginPct: 15, // percent, as captured
    flagCount: 0,
    estimateTotal: 100000,
    projectId: 'proj-1',
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project], commitments: [commitment] });
  const outcome = gradeJudges(row, ctx);
  assert(outcome !== null, 'gradeJudges pick-mode: resolvable for closed project');
  if (outcome) {
    assert(outcome.realizedMarginPct !== null, 'gradeJudges: realizedMarginPct is not null');
    assert(typeof outcome.verdictWasRight === 'boolean', 'gradeJudges: verdictWasRight is boolean');
  }
}

// CORRECTED (tribunal): the capture writes PERCENT (20), the realized margin
// is a FRACTION (0.25) — the un-normalized comparison graded every verdict
// wrong. Pin: percent target normalized to a fraction, outcome fields all
// fractions, verdict judged in one unit system.
{
  const project = makeClosedProject({ id: 'proj-1' });
  // commitment amount 75000 ≥ paidToDate → cost 75000 on 100000 revenue
  // → realized margin fraction 0.25.
  const commitment = makeCommitment('proj-1', 70000);
  const ctx = makeCtx({ projects: [project], commitments: [commitment] });

  const hit = gradeJudges(makeRow('judges_verdict', 'proj-1', {
    mode: 'pick', verdict: 'proceed', targetMarginPct: 20, // percent (app writes ×100)
    flagCount: 0, estimateTotal: 100000, projectId: 'proj-1',
  }, 'proj-1'), ctx);
  assert(hit !== null, 'gradeJudges units: resolvable');
  if (hit) {
    assert(hit.realizedMarginPct !== null && Math.abs(hit.realizedMarginPct - 0.25) < 1e-9,
      `gradeJudges units: realized margin fraction 0.25 (got ${hit.realizedMarginPct})`);
    assert(hit.verdictWasRight === true,
      'gradeJudges units: 25% realized ≥ 20% target → verdict RIGHT (percent payload normalized)');
    assert(Math.abs((hit.targetMarginPct ?? 0) - 0.20) < 1e-9,
      'gradeJudges units: outcome targetMarginPct is the fraction 0.20');
    assert(hit.marginDeltaPct !== null && Math.abs(hit.marginDeltaPct - 0.05) < 1e-9,
      `gradeJudges units: marginDeltaPct is the fraction 0.05 (got ${hit.marginDeltaPct})`);
  }

  const miss = gradeJudges(makeRow('judges_verdict', 'proj-1', {
    mode: 'pick', verdict: 'proceed', targetMarginPct: 30, // percent
    flagCount: 0, estimateTotal: 100000, projectId: 'proj-1',
  }, 'proj-1'), ctx);
  assert(miss !== null && miss.verdictWasRight === false,
    'gradeJudges units: 25% realized < 30% target → verdict WRONG');
  assert(miss !== null && miss.marginDeltaPct !== null && Math.abs(miss.marginDeltaPct - (-0.05)) < 1e-9,
    'gradeJudges units: negative delta is a fraction (-0.05)');
}

// describe-mode → always null
{
  const project = makeClosedProject({ id: 'proj-1' });
  const row = makeRow('judges_verdict', 'some-uuid', {
    mode: 'describe',
    verdict: 'caution',
    targetMarginPct: 20,
    flagCount: 2,
    estimateTotal: 80000,
  }, null);
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradeJudges(row, ctx);
  assert(outcome === null, 'gradeJudges: null for describe-mode (ungradeable v1)');
}

// open project → null
{
  const project = makeProject({ id: 'proj-1', status: 'in_progress' });
  const row = makeRow('judges_verdict', 'proj-1', {
    mode: 'pick',
    verdict: 'proceed',
    targetMarginPct: 20,
    flagCount: 1,
    estimateTotal: 60000,
    projectId: 'proj-1',
  }, 'proj-1');
  const ctx = makeCtx({ projects: [project] });
  const outcome = gradeJudges(row, ctx);
  assert(outcome === null, 'gradeJudges: null for open project');
}

// ─── gradeInstantBid ──────────────────────────────────────────────────────────

{
  const bidResponses = [
    { id: 'resp-1', bidId: 'bid-1', proposerUserId: 'u1', proposerName: 'MAGE GC',
      estimateAmount: 45000, viewSiteRequested: false, status: 'awarded', submittedAt: '2026-01-01T00:00:00Z' } as any,
    { id: 'resp-2', bidId: 'bid-2', proposerUserId: 'u1', proposerName: 'MAGE GC',
      estimateAmount: 30000, viewSiteRequested: false, status: 'declined', submittedAt: '2026-01-01T00:00:00Z' } as any,
    { id: 'resp-3', bidId: 'bid-3', proposerUserId: 'u1', proposerName: 'MAGE GC',
      estimateAmount: 20000, viewSiteRequested: false, status: 'submitted', submittedAt: '2026-01-01T00:00:00Z' } as any,
  ];

  const rowAwarded = makeRow('instant_bid_sent', 'resp-1', { responseId: 'resp-1', basis: 'ai', groundingRateCount: 3, tierAmounts: {} });
  const ctxAwarded = makeCtx({ bidResponses });
  const outcomeAwarded = gradeInstantBid(rowAwarded, ctxAwarded);
  assert(outcomeAwarded !== null, 'gradeInstantBid: resolvable for awarded');
  assert(outcomeAwarded?.won === true, 'gradeInstantBid: won=true for awarded');

  const rowDeclined = makeRow('instant_bid_sent', 'resp-2', { responseId: 'resp-2', basis: 'ai', groundingRateCount: 2, tierAmounts: {} });
  const outcomeDeclined = gradeInstantBid(rowDeclined, ctxAwarded);
  assert(outcomeDeclined !== null, 'gradeInstantBid: resolvable for declined');
  assert(outcomeDeclined?.won === false, 'gradeInstantBid: won=false for declined');

  // Still submitted → null
  const rowPending = makeRow('instant_bid_sent', 'resp-3', { responseId: 'resp-3', basis: 'ai', groundingRateCount: 1, tierAmounts: {} });
  const outcomePending = gradeInstantBid(rowPending, ctxAwarded);
  assert(outcomePending === null, 'gradeInstantBid: null when still submitted');
}

// ─── gradeBidScore ────────────────────────────────────────────────────────────

{
  const trackedBids: TrackedBidRecord[] = [
    { bidId: 'bid-A', status: 'won', notes: '', proposalAmount: null, savedAt: '2026-01-01T00:00:00Z' },
    { bidId: 'bid-B', status: 'lost', notes: '', proposalAmount: null, savedAt: '2026-01-01T00:00:00Z' },
    { bidId: 'bid-C', status: 'submitted', notes: '', proposalAmount: null, savedAt: '2026-01-01T00:00:00Z' },
  ];
  const rowWon = makeRow('bid_score', 'bid-A', { bidId: 'bid-A', matchScore: 82, estimatedWinProbability: 0.7, decidedCount: 5 });
  const ctxBids = makeCtx({ trackedBids });
  const outcomeWon = gradeBidScore(rowWon, ctxBids);
  assert(outcomeWon !== null, 'gradeBidScore: resolvable for won bid');
  assert(outcomeWon?.won === true, 'gradeBidScore: won=true');

  const rowLost = makeRow('bid_score', 'bid-B', { bidId: 'bid-B', matchScore: 45, estimatedWinProbability: 0.3, decidedCount: 5 });
  const outcomeLost = gradeBidScore(rowLost, ctxBids);
  assert(outcomeLost !== null, 'gradeBidScore: resolvable for lost bid');
  assert(outcomeLost?.won === false, 'gradeBidScore: won=false');

  // Still submitted → null
  const rowSubmitted = makeRow('bid_score', 'bid-C', { bidId: 'bid-C', matchScore: 60, estimatedWinProbability: 0.5, decidedCount: 3 });
  const outcomePending = gradeBidScore(rowSubmitted, ctxBids);
  assert(outcomePending === null, 'gradeBidScore: null when still submitted');
}

// ─── leveling_adjustment: never graded ───────────────────────────────────────

{
  const row = makeRow('leveling_adjustment', 'sched-1', { someField: true }, 'proj-1');
  const ctx = makeCtx({ projects: [makeProject()] });
  const resolved = computeResolvableOutcomes([row], ctx);
  assert(resolved.length === 0, 'leveling_adjustment: never graded (ungradeable v1)');
}

// ─── computeResolvableOutcomes sweep ─────────────────────────────────────────

{
  // Mix of resolvable and not-yet-resolvable rows
  const project = makeClosedProject({ id: 'proj-1' });
  const commitment = makeCommitment('proj-1', 78000);

  const rows: BrainPredictionReadRow[] = [
    // Gradeable: estimate snapshot on closed project
    makeRow('estimate_confidence_snapshot', 'est-1', {
      estimateId: 'est-1',
      grandTotal: 100000,
      lines: [{ id: 'mat-1', category: 'Framing', total: 30000, confidenceBand: 'high' }],
      coveragePct: 75,
    }, 'proj-1'),
    // Not gradeable: judges describe-mode
    makeRow('judges_verdict', 'uuid-1', {
      mode: 'describe',
      verdict: 'proceed',
      targetMarginPct: 20,
      flagCount: 0,
      estimateTotal: 100000,
    }, null),
    // Not gradeable: leveling_adjustment
    makeRow('leveling_adjustment', 'sched-1', { bump: 2 }, 'proj-1'),
  ];

  const ctx = makeCtx({ projects: [project], commitments: [commitment] });
  const outcomes = computeResolvableOutcomes(rows, ctx);
  assert(outcomes.length === 1, 'computeResolvableOutcomes: only 1 resolvable (estimate snapshot)');
  assert(outcomes[0].id === rows[0].id, 'computeResolvableOutcomes: correct row resolved');
}

// ─── G4: grader errors don't propagate ───────────────────────────────────────

{
  // Malformed payload — grader must return null, not throw
  const row = makeRow('pace_suggestion_applied', 'bad', {
    // Missing all expected fields
    garbage: true,
  }, 'proj-1');
  const ctx = makeCtx({ projects: [] });
  let threw = false;
  try {
    const outcome = gradePace(row, ctx);
    assert(outcome === null, 'G4: malformed pace payload returns null');
  } catch {
    threw = true;
  }
  assert(!threw, 'G4: gradePace does not throw on malformed payload');
}

// ─── Summary ─────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} test(s) FAILED`);
  process.exit(1);
} else {
  console.log('\nAll brain grading tests passed.');
}
