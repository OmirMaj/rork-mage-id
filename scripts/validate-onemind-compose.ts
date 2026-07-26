// scripts/validate-onemind-compose.ts — validator for One Mind's fact
// assemblers (utils/oneMind/factBlocks.ts) and fused prompt builder
// (utils/oneMind/composePrompt.ts).
//
// Covers the plan's required cases: block caps, citation-ref round-trip,
// no-margin-basis honesty, and additive failure (a failing assembler skips
// its block instead of killing the answer).
import {
  buildRecordsBlock,
  buildMarginBlock,
  buildRiskBlock,
  buildScheduleBlock,
  buildPaceBlock,
  buildRfiBlock,
  buildMemoryBlock,
  buildCashBlock,
  buildBrainWatchBlock,
  buildAccuracyBlock,
  buildLeaksBlock,
  buildPortfolioBlocks,
  isColdStart,
  assembleFactBlocks,
  type FactBlock,
  type OneMindBundle,
} from '../utils/oneMind/factBlocks';
import {
  composeOneMindPrompt,
  parseCitations,
  ONE_MIND_TOTAL_CAP,
} from '../utils/oneMind/composePrompt';
import type { LivingEstimateSnapshot } from '../utils/livingEstimate';
import type { MarginRiskScore } from '../utils/marginRiskScore';
import type { PaceBook } from '../utils/pace/paceBook';
import type { AttentionItem } from '../utils/brainWatch';
import type { AccuracyReport } from '../utils/brain/accuracyReport';
import type { CashFlowSummary } from '../utils/cashFlowEngine';
import type { Project, RFI } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean, extra = '') {
  if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n, extra ? `\n   ${extra}` : ''); }
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const marginBasis: LivingEstimateSnapshot = {
  hasMarginBasis: true,
  original: { revenue: 100_000, cost: 78_000, margin: 22_000, marginPct: 0.22 },
  projected: { revenue: 108_000, cost: 88_500, margin: 19_500, marginPct: 0.1806 },
  marginErosionPoints: -3.9,
  marginErosionDollars: -2_500,
  drivers: [
    { key: 'cost_growth', label: 'Cost growth', marginImpact: -4_100, detail: 'Committed + actual costs $4,100 over budget' },
    { key: 'change_orders', label: 'Approved change orders', marginImpact: 1_600, detail: '22% margin on $8,000 of approved COs' },
  ],
  approvedChangeOrders: 8_000,
  pendingChangeOrders: 3_000,
  untracedCommitments: 1,
  health: 'watch',
  asOf: '2026-07-25T00:00:00Z',
};

const noBasis: LivingEstimateSnapshot = {
  ...marginBasis,
  hasMarginBasis: false,
  drivers: [],
};

const risk: MarginRiskScore = {
  score: 62,
  band: 'elevated',
  factors: [],
  topFactors: [
    { key: 'erosion', label: 'Margin eroding', risk: 0.7, weight: 1.5, contribution: 0.4, detail: 'Projected margin down 3.9 pts from bid', recommendation: 'Trace the biggest variance in Job Costing and recover it now.' },
    { key: 'buyout_exposure', label: 'Unbought-out scope', risk: 0.5, weight: 1.0, contribution: 0.3, detail: '40% of budget locked by signed subs/POs', recommendation: 'Lock remaining trades before prices move against you.' },
  ],
  hasBasis: true,
};

function mkProject(over: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Henderson Remodel',
    type: 'renovation',
    location: '12 Main St',
    squareFootage: 2400,
    quality: 'standard',
    description: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    estimate: null,
    status: 'in_progress',
    ...over,
  } as Project;
}

function mkSchedule(healthScore: number | undefined, tasks: { done?: boolean; startDay?: number; durationDays?: number }[]): NonNullable<Project['schedule']> {
  return {
    id: 's1', name: 'Sched', projectId: 'p1', workingDaysPerWeek: 5, bufferDays: 0,
    startDate: '2026-07-01',
    tasks: tasks.map((t, i) => ({
      id: `t${i}`, title: `Task ${i}`, phase: 'Phase', durationDays: t.durationDays ?? 5,
      startDay: t.startDay ?? (i * 5 + 1), progress: t.done ? 100 : 0, crew: '',
      dependencies: [], status: t.done ? 'done' : 'pending',
    })),
    totalDurationDays: 30, aiGenerated: false, riskItems: [], healthScore,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  } as unknown as NonNullable<Project['schedule']>;
}

// ─── buildMarginBlock ────────────────────────────────────────────────────────

{
  const b = buildMarginBlock('p1', 'Henderson Remodel', marginBasis);
  ok('margin ref = MARGIN', b.ref === 'MARGIN');
  ok('margin facts mention bid + projected pct', b.facts.some(f => f.includes('22')) && b.facts.some(f => f.includes('18')));
  ok('margin facts carry erosion', b.facts.some(f => /eros|down/i.test(f)));
  ok('margin facts carry top driver', b.facts.some(f => f.includes('over budget')));
  ok('margin drillIn → living-estimate', b.drillIn?.pathname === '/living-estimate' && b.drillIn?.params?.projectId === 'p1');
}
{
  const b = buildMarginBlock('p1', 'Henderson Remodel', noBasis);
  ok('no-basis honesty line present', b.facts.some(f => f.includes('No margin basis')));
  ok('no-basis emits no numeric margin claims', !b.facts.some(f => /projected margin/i.test(f)));
}

// ─── buildRiskBlock ──────────────────────────────────────────────────────────

{
  const b = buildRiskBlock('p1', risk);
  ok('risk block built when hasBasis', !!b && b.ref === 'RISK');
  ok('risk facts carry score + band', !!b && b.facts.some(f => f.includes('62') && f.includes('elevated')));
  ok('risk facts carry top factor detail', !!b && b.facts.some(f => f.includes('3.9 pts')));
}
{
  const b = buildRiskBlock('p1', { ...risk, hasBasis: false });
  ok('risk block null without basis', b === null);
}

// ─── buildScheduleBlock ──────────────────────────────────────────────────────

{
  const p = mkProject({ schedule: mkSchedule(55, [{ done: true }, {}, {}]) });
  const b = buildScheduleBlock(p, new Date('2026-07-10T12:00:00Z'));
  ok('schedule ref = SCHEDULE', b.ref === 'SCHEDULE');
  ok('schedule facts carry health', b.facts.some(f => f.includes('55')));
  ok('schedule facts carry done/total', b.facts.some(f => f.includes('1 of 3')));
  ok('schedule drillIn → schedule-pro', b.drillIn?.pathname === '/schedule-pro');
}
{
  const b = buildScheduleBlock(mkProject(), new Date());
  ok('no schedule → honest line', b.facts.some(f => /no schedule/i.test(f)));
}

// ─── buildPaceBlock ──────────────────────────────────────────────────────────

{
  const book: PaceBook = {
    entries: [
      { key: 'framing|medium', trade: 'framing', sqftBucket: 'medium', sampleCount: 6, jobCount: 4, plannedMean: 5, actualMean: 6.2, variability: 0.2, bias: 0.24, confidence: 'high', samples: [] },
      { key: 'framing|all', trade: 'framing', sqftBucket: 'all', sampleCount: 8, jobCount: 5, plannedMean: 5, actualMean: 6.0, variability: 0.25, bias: 0.2, confidence: 'high', samples: [] },
    ],
    jobsAnalyzed: 5, tradesTracked: 1, asOf: '2026-07-25T00:00:00Z',
  };
  const p = mkProject({ schedule: mkSchedule(80, [{}, {}]) });
  // Give the tasks framing-ish titles so tradeKeyForTask resolves the trade.
  p.schedule!.tasks[0].title = 'Framing walls';
  p.schedule!.tasks[1].title = 'Frame roof';
  const b = buildPaceBlock(p, book);
  ok('pace block built for known trade', !!b && b.ref === 'PACE');
  ok('pace facts carry actual vs planned', !!b && b.facts.some(f => f.includes('6.2') && f.includes('5')));
  const empty = buildPaceBlock(mkProject(), { entries: [], jobsAnalyzed: 0, tradesTracked: 0, asOf: '' });
  ok('pace block null with empty book', empty === null);
}

// ─── buildRfiBlock ───────────────────────────────────────────────────────────

{
  const rfis = [
    { id: 'r1', projectId: 'p1', number: 1, subject: 'Beam size', status: 'open', dateSubmitted: '2026-07-01', dateRequired: '2026-07-05' },
    { id: 'r2', projectId: 'p1', number: 2, subject: 'Window spec', status: 'answered', dateSubmitted: '2026-06-01', dateResponded: '2026-06-08' },
    { id: 'r3', projectId: 'p1', number: 3, subject: 'Footing depth', status: 'answered', dateSubmitted: '2026-06-10', dateResponded: '2026-06-14' },
  ] as unknown as RFI[];
  const b = buildRfiBlock('p1', rfis);
  ok('rfi block built', !!b && b.ref === 'RFI');
  ok('rfi facts carry open count', !!b && b.facts.some(f => f.includes('1 open')));
  ok('rfi facts carry latency fact line', !!b && b.facts.some(f => /day.*per RFI response/i.test(f)));
  ok('rfi block null with no RFIs', buildRfiBlock('p1', []) === null);
}

// ─── buildMemoryBlock ────────────────────────────────────────────────────────

{
  const b = buildMemoryBlock('p1', [
    { ref: 'RFI #12', date: '2026-05-01T00:00:00Z', text: 'Beam size confirmed as W12x26 by engineer.' },
    { ref: 'CO #4', date: '2026-05-10T00:00:00Z', text: 'Owner added heat pump, $8,000.' },
  ]);
  ok('memory block built', !!b && b.ref === 'MEMORY');
  ok('memory facts carry record refs', !!b && b.facts.some(f => f.includes('RFI #12')) && b.facts.some(f => f.includes('CO #4')));
  ok('memory block null with no docs', buildMemoryBlock('p1', []) === null);
}

// ─── buildCashBlock ──────────────────────────────────────────────────────────

{
  const summary: CashFlowSummary = {
    totalIncome: 90_000, totalExpenses: 84_000, netProfit: 6_000,
    lowestBalance: -4_200, lowestBalanceWeek: 6, highestBalance: 30_000, highestBalanceWeek: 11,
    dangerWeeks: [
      { weekNumber: 6, weekDate: '2026-08-31', balance: -4_200 },
      { weekNumber: 7, weekDate: '2026-09-07', balance: -1_100 },
    ],
  };
  const b = buildCashBlock(summary, true, 12);
  ok('cash ref = CASH', b.ref === 'CASH');
  ok('cash facts carry danger weeks', b.facts.some(f => f.includes('2026-08-31')));
  ok('cash facts carry lowest balance', b.facts.some(f => /lowest/i.test(f)));
  const unset = buildCashBlock(null, false, 12);
  ok('cash not-set-up honesty', unset.facts.some(f => /not set up/i.test(f)));
}

// ─── buildBrainWatchBlock ────────────────────────────────────────────────────

{
  const items: AttentionItem[] = Array.from({ length: 9 }, (_, i) => ({
    id: `a${i}`, projectId: 'p1', projectName: 'Henderson',
    kind: 'invoice', severity: i === 0 ? 'critical' : 'medium',
    message: `Henderson: invoice #${i} is ${20 + i}d overdue`,
    route: { pathname: '/invoice', params: { projectId: 'p1', invoiceId: `i${i}` } },
  }));
  const b = buildBrainWatchBlock(items);
  ok('watch block built', !!b && b.ref === 'WATCH');
  ok('watch capped at 6', !!b && b.facts.length === 6);
  ok('watch facts carry severity tag', !!b && b.facts[0].includes('critical'));
  ok('watch drillIn = top item route', !!b && b.drillIn?.pathname === '/invoice');
  ok('watch block null when clear', buildBrainWatchBlock([]) === null);
}

// ─── buildAccuracyBlock ──────────────────────────────────────────────────────

{
  const report: AccuracyReport = {
    rows: [
      { kind: 'pace_suggestion_applied', label: 'Pace suggestions', n: 12, headline: 'Pace calls beat the AI 9 of 12 times (1 ties)', detail: 'x', rate: 0.75 },
    ],
    totalGraded: 12,
    hasEnoughData: true,
  };
  const b = buildAccuracyBlock(report);
  ok('accuracy block built', !!b && b.ref === 'ACCURACY');
  ok('accuracy facts carry headline', !!b && b.facts.some(f => f.includes('9 of 12')));
  ok('accuracy gated when thin', buildAccuracyBlock({ rows: [], totalGraded: 1, hasEnoughData: false }) === null);
}

// ─── buildLeaksBlock ─────────────────────────────────────────────────────────

{
  const b = buildLeaksBlock(3, 4_200);
  ok('leaks block built', !!b && b.ref === 'LEAKS');
  ok('leaks facts carry count', !!b && b.facts.some(f => f.includes('3')));
  ok('leaks block null at zero', buildLeaksBlock(0, 0) === null);
}

// ─── buildRecordsBlock / buildPortfolioBlocks ───────────────────────────────

{
  const b = buildRecordsBlock('TODAY: 2026-07-25\n\nMONEY: 3 invoices · $12,000 outstanding');
  ok('records ref = RECORDS', b.ref === 'RECORDS');
  ok('records facts split lines, no empties', b.facts.length === 2 && b.facts.every(f => f.trim().length > 0));
}
{
  const blocks = buildPortfolioBlocks([
    { domain: 'PIPELINE & CAPACITY', ref: 'PIPELINE', facts: ['CRM pipeline: 2 leads.'] },
    { domain: 'CLIENT BOOK', ref: 'CLIENTS', facts: ['1 repeat client.'] },
  ]);
  ok('portfolio blocks pass through refs', blocks.map(b => b.ref).join(',') === 'PIPELINE,CLIENTS');
  ok('portfolio drillIn → /business', blocks.every(b => b.drillIn?.pathname === '/business'));
}

// ─── isColdStart ─────────────────────────────────────────────────────────────

function mkBundle(over: Partial<OneMindBundle> = {}): OneMindBundle {
  return {
    projects: [], commitments: [], changeOrders: [], invoices: [],
    rfis: [], leads: [], dailyReports: [], permits: [],
    submittals: [], punchItems: [], expiringCertifications: [], bidResponses: [],
    ...over,
  } as OneMindBundle;
}

ok('cold start when nothing logged', isColdStart(mkBundle()));
ok('not cold start with a project', !isColdStart(mkBundle({ projects: [mkProject()] })));
ok('not cold start with leads only', !isColdStart(mkBundle({ leads: [{ id: 'l1' }] as never })));

// ─── composeOneMindPrompt ────────────────────────────────────────────────────

const sampleBlocks: FactBlock[] = [
  { domain: 'LIVE MARGIN', ref: 'MARGIN', facts: ['Bid margin 22.0%.', 'Projected 18.1%.'] },
  { domain: 'BRAIN WATCH', ref: 'WATCH', facts: ['Henderson: invoice #4 is 21d overdue ($5,000)'] },
];

{
  const prompt = composeOneMindPrompt({
    question: 'Is Henderson making money?',
    turns: [],
    blocks: sampleBlocks,
  });
  ok('prompt contains block refs', prompt.includes('[MARGIN]') && prompt.includes('[WATCH]'));
  ok('prompt contains discipline (ONLY the fact blocks)', /ONLY the fact blocks/i.test(prompt));
  ok('prompt prefers honesty over invention', /not in your data/i.test(prompt));
  ok('prompt instructs citations', /square brackets/i.test(prompt));
  ok('question comes last', prompt.trim().endsWith('Is Henderson making money?'));
}

{
  // Turn cap: last 6 of 8
  const turns = Array.from({ length: 8 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    text: `turn-${i}`,
  }));
  const prompt = composeOneMindPrompt({ question: 'q', turns, blocks: sampleBlocks });
  ok('turns capped at last 6', !prompt.includes('turn-0') && !prompt.includes('turn-1') && prompt.includes('turn-2') && prompt.includes('turn-7'));
}

{
  // Per-block char cap: one giant fact must be truncated
  const giant: FactBlock = { domain: 'RECORDS', ref: 'RECORDS', facts: [('x'.repeat(9000))] };
  const prompt = composeOneMindPrompt({ question: 'q', turns: [], blocks: [giant] });
  ok('per-block cap enforced', prompt.length < 7000, `len=${prompt.length}`);
}

{
  // Total cap ~12k over many blocks
  const many: FactBlock[] = Array.from({ length: 30 }, (_, i) => ({
    domain: `D${i}`, ref: `D${i}`, facts: ['y'.repeat(900)],
  }));
  const prompt = composeOneMindPrompt({ question: 'q', turns: [], blocks: many });
  ok(`total cap ≈ ${ONE_MIND_TOTAL_CAP}`, prompt.length < ONE_MIND_TOTAL_CAP + 2500, `len=${prompt.length}`);
}

// ─── parseCitations ──────────────────────────────────────────────────────────

{
  const blocks: FactBlock[] = [
    { domain: 'LIVE MARGIN', ref: 'MARGIN', facts: [] },
    { domain: 'BRAIN WATCH', ref: 'WATCH', facts: [] },
    { domain: 'CASH FLOW', ref: 'CASH', facts: [] },
  ];
  const refs = parseCitations('Margin is down 3.9 pts [MARGIN]. Chase invoice #4 [WATCH·Henderson]. [MARGIN] again. [BOGUS] ignored.', blocks);
  ok('citations round-trip in order', refs.join(',') === 'MARGIN,WATCH');
  ok('unknown refs ignored', !refs.includes('BOGUS'));
  ok('no citations → empty', parseCitations('plain answer', blocks).length === 0);
}

// ─── assembleFactBlocks (additive integration) ──────────────────────────────

const estimateProject = mkProject({
  schedule: mkSchedule(45, [{ done: true }, {}, {}]),
  linkedEstimate: {
    id: 'e1', name: 'Est', items: [], baseTotal: 78_000, grandTotal: 100_000,
    markupPct: 22, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  } as never,
});

await (async () => {
  // Project scope: pure engine blocks must land even when impure assemblers
  // (records/memory/cash/ledger — RN/storage imports) fail under Bun.
  const bundle = mkBundle({
    projects: [estimateProject],
    rfis: [
      { id: 'r1', projectId: 'p1', number: 1, subject: 'Beam', status: 'open', dateSubmitted: '2026-07-01' },
    ] as never,
  });
  const blocks = await assembleFactBlocks({ scope: 'project', projectId: 'p1' }, 'is henderson making money', bundle);
  const refs = blocks.map(b => b.ref);
  ok('project scope assembles MARGIN', refs.includes('MARGIN'));
  ok('project scope assembles SCHEDULE', refs.includes('SCHEDULE'));
  ok('project scope assembles RFI', refs.includes('RFI'));
  ok('no duplicate refs', new Set(refs).size === refs.length);
  ok('every block well-formed', blocks.every(b => b.domain && b.ref && Array.isArray(b.facts)));

  // Business scope: portfolio engines are pure and must always land.
  const bizBlocks = await assembleFactBlocks({ scope: 'business' }, 'how is my business doing', bundle);
  const bizRefs = bizBlocks.map(b => b.ref);
  ok('business scope assembles portfolio blocks', ['TYPEPROFIT', 'PIPELINE', 'CLIENTS', 'SEASON'].every(r => bizRefs.includes(r)));
  ok('business scope has no project-only blocks', !bizRefs.includes('MARGIN') && !bizRefs.includes('PACE'));
})();

// ─── Footer ──────────────────────────────────────────────────────────────────

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
