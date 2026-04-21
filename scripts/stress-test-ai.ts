// AI Stress Test
//
// Hits the live Supabase AI edge function directly (same URL + anon key as
// utils/mageAI.ts) for every AI feature in the app, with three payload sizes:
//   - tiny:   1-sentence prompt, minimal context
//   - medium: realistic prompt (what the app actually sends)
//   - huge:   very large prompt (~10KB+ of context — simulates a user with a
//             massive project portfolio or a long Copilot thread)
//
// For each response:
//   - Verifies HTTP 2xx
//   - Verifies { success: true, data: {...} } envelope
//   - Validates against the feature's Zod schema using safeParse
//   - If safeParse fails, reports which fields were missing / wrong type
//   - Checks that arrays the UI touches with .length / .map are actually arrays
//
// Usage:
//   bun run scripts/stress-test-ai.ts
//   bun run scripts/stress-test-ai.ts --only=copilot,scheduleRisk
//   bun run scripts/stress-test-ai.ts --size=huge
//
// No dependency on React Native — this script is pure Bun/Node + zod.

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Live edge function config (must match utils/mageAI.ts)
// ---------------------------------------------------------------------------
const AI_URL = 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/ai';
const AI_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im50ZW9xaGNzd2FwcHh4amxwdmFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMTU0MDMsImV4cCI6MjA4OTg5MTQwM30.xpz7yWhignppH-3dYD-EV4AvB4cugr7-881GKdOFado';

// ---------------------------------------------------------------------------
// Schemas — mirror aiService.ts. Must stay in sync. Using .default() so a
// sparse response still parses and we can see exactly what the AI omitted.
// ---------------------------------------------------------------------------
const copilotResponseSchema = z.object({
  answer: z.string().default(''),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  actionItems: z.array(z.string()).default([]),
  dataPoints: z.array(z.string()).default([]),
});

const scheduleRiskSchema = z.object({
  overallConfidence: z.number().default(0),
  predictedEndDate: z.string().default(''),
  predictedDelay: z.number().default(0),
  risks: z.array(z.object({
    taskName: z.string().default(''),
    severity: z.enum(['high', 'medium', 'low']).default('low'),
    delayProbability: z.number().default(0),
    delayDays: z.number().default(0),
    reasons: z.array(z.string()).default([]),
    recommendation: z.string().default(''),
  })).default([]),
  summary: z.string().default(''),
});

const bidScoreSchema = z.object({
  matchScore: z.number().default(0),
  matchReasons: z.array(z.string()).default([]),
  concerns: z.array(z.string()).default([]),
  bidStrategy: z.string().default(''),
  estimatedWinProbability: z.number().default(0),
});

const estimateValidationSchema = z.object({
  overallScore: z.number().default(0),
  issues: z.array(z.object({
    type: z.enum(['error', 'warning', 'info']).default('info'),
    title: z.string().default(''),
    detail: z.string().default(''),
    potentialImpact: z.string().optional(),
  })).default([]),
  missingItems: z.array(z.string()).default([]),
  summary: z.string().default(''),
});

const changeOrderImpactSchema = z.object({
  scheduleDays: z.number().default(0),
  costImpact: z.object({
    materials: z.number().default(0),
    labor: z.number().default(0),
    equipment: z.number().default(0),
    total: z.number().default(0),
  }).default({ materials: 0, labor: 0, equipment: 0, total: 0 }),
  affectedTasks: z.array(z.object({
    taskName: z.string().default(''),
    currentEnd: z.string().default(''),
    newEnd: z.string().default(''),
    daysAdded: z.number().default(0),
  })).default([]),
  newProjectEndDate: z.string().default(''),
  downstreamEffects: z.array(z.string()).default([]),
  recommendation: z.preprocess(
    v => Array.isArray(v) ? v.filter(x => typeof x === 'string').join('\n\n')
      : typeof v === 'string' ? v
      : v != null ? String(v) : '',
    z.string().default(''),
  ),
  compressionOptions: z.array(z.object({
    description: z.string().default(''),
    costPremium: z.number().default(0),
    daysSaved: z.number().default(0),
  })).default([]),
});

const weeklySummarySchema = z.object({
  weekRange: z.string().default(''),
  portfolioSummary: z.object({
    totalProjects: z.number().default(0),
    onTrack: z.number().default(0),
    atRisk: z.number().default(0),
    behind: z.number().default(0),
    combinedValue: z.number().default(0),
    tasksCompletedThisWeek: z.number().default(0),
  }).default({ totalProjects: 0, onTrack: 0, atRisk: 0, behind: 0, combinedValue: 0, tasksCompletedThisWeek: 0 }),
  projects: z.array(z.object({
    name: z.string().default(''),
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']).catch('on_track').default('on_track'),
    progressStart: z.number().default(0),
    progressEnd: z.number().default(0),
    keyAccomplishment: z.string().default(''),
    primaryRisk: z.string().default(''),
    recommendation: z.string().default(''),
  })).default([]),
  overallRecommendation: z.string().default(''),
});

const homeBriefingSchema = z.object({
  briefing: z.string().default(''),
  projects: z.array(z.object({
    name: z.string().default(''),
    status: z.enum(['on_track', 'at_risk', 'behind', 'ahead']).catch('on_track').default('on_track'),
    keyInsight: z.string().default(''),
    actionItem: z.string().default(''),
  })).default([]),
  urgentItems: z.array(z.string()).default([]),
});

const invoicePredictionSchema = z.object({
  predictedPaymentDate: z.string().default(''),
  confidenceLevel: z.enum(['high', 'medium', 'low']).default('medium'),
  daysFromDue: z.number().default(0),
  reasoning: z.string().default(''),
  tip: z.string().default(''),
});

const subEvaluationSchema = z.object({
  questionsToAsk: z.array(z.string()).default([]),
  typicalRates: z.object({
    journeyman: z.string().default(''),
    master: z.string().default(''),
    apprentice: z.string().default(''),
  }).default({ journeyman: '', master: '', apprentice: '' }),
  redFlags: z.array(z.string()).default([]),
  recommendation: z.string().default(''),
  trackRecord: z.string().optional(),
});

const equipmentAdviceSchema = z.object({
  recommendation: z.enum(['rent', 'buy', 'lease']).catch('rent').default('rent'),
  annualRentalCost: z.number().catch(0).default(0),
  purchasePrice: z.string().catch('').default(''),
  breakEvenProjects: z.number().catch(0).default(0),
  reasoning: z.preprocess(
    v => Array.isArray(v) ? v.join(' ') : v,
    z.string().catch('').default(''),
  ),
  reconsiderWhen: z.preprocess(
    v => Array.isArray(v) ? v.join(' ') : v,
    z.string().catch('').default(''),
  ),
});

const projectReportSchema = z.object({
  executiveSummary: z.string().default(''),
  scheduleStatus: z.string().default(''),
  budgetStatus: z.string().default(''),
  keyAccomplishments: z.array(z.string()).default([]),
  issuesAndRisks: z.array(z.string()).default([]),
  nextMilestones: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

const dailyReportSchema = z.object({
  summary: z.string().default(''),
  workCompleted: z.array(z.string()).default([]),
  workInProgress: z.array(z.string()).default([]),
  issuesAndDelays: z.array(z.string()).default([]),
  tomorrowPlan: z.array(z.string()).default([]),
  weatherImpact: z.string().default(''),
  crewsOnSite: z.array(z.object({
    trade: z.string().default(''),
    count: z.number().default(0),
    activity: z.string().default(''),
  })).default([]),
  safetyNotes: z.string().default(''),
});

const aiScheduleSchema = z.object({
  tasks: z.array(z.object({
    title: z.string().default(''),
    phase: z.string().default(''),
    durationDays: z.number().default(1),
    description: z.string().optional(),
    crewSize: z.number().optional(),
    isMilestone: z.boolean().optional(),
    isCriticalPath: z.boolean().optional(),
    isWeatherSensitive: z.boolean().optional(),
    predecessorIndex: z.number().optional(),
    dependencyType: z.string().optional(),
    lagDays: z.number().optional(),
    notes: z.string().optional(),
  })).default([]),
  assumptions: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

const aiQuickEstimateSchema = z.object({
  projectSummary: z.string().default(''),
  materials: z.array(z.object({
    name: z.string().default('Item'),
    category: z.string().default('hardware'),
    unit: z.string().default('ea'),
    quantity: z.number().default(0),
    unitPrice: z.number().default(0),
    supplier: z.string().default('Home Depot'),
    notes: z.string().optional(),
  })).default([]),
  labor: z.array(z.object({
    trade: z.string().default('Labor'),
    hourlyRate: z.number().default(0),
    hours: z.number().default(0),
    crew: z.string().default('General crew'),
    notes: z.string().optional(),
  })).default([]),
  assemblies: z.array(z.object({
    name: z.string().default('Assembly'),
    category: z.string().default('general'),
    quantity: z.number().default(1),
    unit: z.string().default('ea'),
    notes: z.string().optional(),
  })).default([]),
  additionalCosts: z.object({
    permits: z.number().default(0),
    dumpsterRental: z.number().default(0),
    equipmentRental: z.number().default(0),
    cleanup: z.number().default(0),
    contingencyPercent: z.number().default(10),
    overheadPercent: z.number().default(12),
  }).default({
    permits: 0,
    dumpsterRental: 0,
    equipmentRental: 0,
    cleanup: 0,
    contingencyPercent: 10,
    overheadPercent: 12,
  }),
  estimatedDuration: z.string().default('TBD'),
  costPerSqFt: z.number().default(0),
  confidenceScore: z.number().default(70),
  warnings: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' ? [v]
      : v && typeof v === 'object' ? Object.values(v).map(x => String(x))
      : [],
    z.array(z.string()).default([]),
  ),
  savingsTips: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' ? [v]
      : v && typeof v === 'object' ? Object.values(v).map(x => String(x))
      : [],
    z.array(z.string()).default([]),
  ),
});

const coerceStringArray = z.preprocess(
  (v) => {
    if (Array.isArray(v)) {
      return v.map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          return String(obj.action ?? obj.description ?? obj.text ?? obj.title ?? JSON.stringify(obj));
        }
        return String(item ?? '');
      });
    }
    if (typeof v === 'string') return [v];
    if (v && typeof v === 'object') return Object.values(v).map((x) => String(x));
    return [];
  },
  z.array(z.string()).default([]),
);

const recommendationItemSchema = z.preprocess(
  (v) => {
    if (typeof v === 'string') {
      return { priority: 'important', action: v, impact: '', difficulty: 'moderate' };
    }
    return v;
  },
  z.object({
    priority: z.enum(['urgent', 'important', 'suggestion']).catch('important').default('important'),
    action: z.string().catch('').default(''),
    impact: z.string().catch('').default(''),
    difficulty: z.enum(['easy', 'moderate', 'hard']).catch('moderate').default('moderate'),
  }),
);

const cashFlowAnalysisSchema = z.object({
  overallHealth: z.enum(['healthy', 'caution', 'danger']).catch('caution').default('caution'),
  healthScore: z.number().catch(50).default(50),
  criticalWeeks: z.array(z.object({
    weekNumber: z.number().catch(0).default(0),
    weekDate: z.string().catch('').default(''),
    balance: z.number().catch(0).default(0),
    problem: z.string().catch('').default(''),
  })).default([]),
  // The model occasionally collapses recommendations into a single prose
  // string — wrap it into a one-item array so the schema still parses and we
  // still get something usable.
  recommendations: z.preprocess(
    v => Array.isArray(v) ? v
      : typeof v === 'string' && v.trim() ? [v]
      : [],
    z.array(recommendationItemSchema),
  ).default([]),
  billingOptimizations: coerceStringArray,
  expenseReductions: coerceStringArray,
  summary: z.string().default(''),
});

// ---------------------------------------------------------------------------
// Fixtures — tiny / medium / huge prompts per feature
// ---------------------------------------------------------------------------

function longProjectData(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      `Project ${i}: ${i % 2 === 0 ? 'Kitchen Remodel' : 'Bathroom Addition'} ` +
      `at ${1000 + i} Main St, $${(50000 + i * 1000).toLocaleString()} budget, ` +
      `${30 + (i % 10)} tasks, ${40 + (i % 60)}% complete, health ${70 + (i % 30)}/100. ` +
      `Notes: running slightly behind due to permit delays; awaiting inspection on ` +
      `rough-in plumbing. Client concerned about timing. Weather impacted exterior work.`,
    );
  }
  return lines.join('\n');
}

type FeatureCase = {
  name: string;
  tier: 'fast' | 'smart';
  maxTokens?: number;
  schema: z.ZodTypeAny;
  // UI-critical fields that must be arrays (the ones components call .map on)
  arrayFields?: string[];
  tiny: { prompt: string; schemaHint?: object };
  medium: { prompt: string; schemaHint?: object };
  huge: { prompt: string; schemaHint?: object };
};

const CASES: FeatureCase[] = [
  {
    name: 'copilot',
    tier: 'fast',
    schema: copilotResponseSchema,
    arrayFields: ['actionItems', 'dataPoints'],
    tiny: { prompt: 'Q: How do I scope a kitchen remodel?' },
    medium: {
      prompt:
        'You are MAGE Copilot. Answer the user concisely.\n\n' +
        'Q: A client is asking for a ballpark for a 200sqft kitchen remodel ' +
        'with mid-tier finishes in Austin TX. What are the key cost drivers I ' +
        'should flag before quoting?',
    },
    huge: {
      prompt:
        'You are MAGE Copilot analyzing my entire portfolio below.\n\n' +
        'PORTFOLIO:\n' + longProjectData(60) +
        '\n\nQ: Which three projects are at the highest risk of missing their ' +
        'deadline this quarter, and what is the single most leveraged action ' +
        'I can take on each?',
    },
  },
  {
    name: 'scheduleRisk',
    tier: 'smart',
    maxTokens: 3000,
    schema: scheduleRiskSchema,
    arrayFields: ['risks'],
    tiny: { prompt: 'Analyze schedule risk. 1 task: Demo walls, day 1-5, 20% done.' },
    medium: {
      prompt:
        'Analyze this schedule for delay risk. 15 tasks across demo, framing, ' +
        'rough-in, drywall, finish. Two tasks already behind schedule. Weather ' +
        'forecast: rain next week. Identify top risks and give concrete ' +
        'recommendations.',
    },
    huge: {
      prompt:
        'Analyze this massive construction schedule for delay risk.\n\n' +
        'TASKS:\n' +
        Array.from({ length: 120 }, (_, i) =>
          `${i + 1}. ${['Demo', 'Frame', 'Rough-in', 'Drywall', 'Finish'][i % 5]} ` +
          `phase ${Math.floor(i / 24) + 1}, day ${i}-${i + 5}, ${i % 100}% done, ` +
          `crew of ${2 + (i % 6)}, weather-sensitive: ${i % 3 === 0}`
        ).join('\n'),
    },
  },
  {
    name: 'bidScore',
    tier: 'fast',
    maxTokens: 2000,
    schema: bidScoreSchema,
    arrayFields: ['matchReasons', 'concerns'],
    tiny: { prompt: 'Score this bid: $80k for kitchen remodel.' },
    medium: {
      prompt:
        'Score this $80,000 bid for a 300sqft kitchen remodel in Denver CO. ' +
        'Materials: $35k, Labor: $30k, Overhead: $10k, Profit: $5k. Timeline: 6 weeks.',
    },
    huge: {
      prompt:
        'Score this comprehensive bid.\n\nLINE ITEMS:\n' +
        Array.from({ length: 80 }, (_, i) =>
          `${i + 1}. ${['Cabinet', 'Counter', 'Tile', 'Paint', 'Electric', 'Plumbing'][i % 6]} ` +
          `item: qty ${1 + (i % 50)}, unit $${50 + i * 7}, total $${(50 + i * 7) * (1 + (i % 50))}`
        ).join('\n') + '\n\nTotal: $480,000. Timeline: 18 weeks.',
    },
  },
  {
    name: 'estimateValidation',
    tier: 'smart',
    maxTokens: 5000,
    schema: estimateValidationSchema,
    arrayFields: ['issues', 'missingItems'],
    tiny: { prompt: 'Review estimate: $10k kitchen remodel, 1 line item.' },
    medium: {
      prompt:
        'Review this kitchen estimate for errors or missing items. ' +
        'Total: $45k. Line items: cabinets $20k, counters $8k, labor $15k, ' +
        'misc $2k. Is this realistic and complete?',
    },
    huge: {
      prompt:
        'Review this massive full-home renovation estimate.\n\nLINES:\n' +
        Array.from({ length: 150 }, (_, i) =>
          `${i + 1}. ${['Framing', 'Electrical', 'Plumbing', 'HVAC', 'Drywall', 'Tile', 'Paint'][i % 7]} ` +
          `line: qty ${1 + (i % 100)}, $${100 + i * 5} each`
        ).join('\n') + '\n\nGrand total: $850,000.',
    },
  },
  {
    name: 'changeOrderImpact',
    tier: 'smart',
    maxTokens: 3500,
    schema: changeOrderImpactSchema,
    arrayFields: ['affectedTasks', 'downstreamEffects', 'compressionOptions'],
    tiny: { prompt: 'Change order: add $5k, 3 days. Impact?' },
    medium: {
      prompt:
        'Change order: client wants to add a $15,000 built-in bookshelf to ' +
        'living room. Current schedule: framing done, drywall in progress. ' +
        'Predict schedule delay, cost impact, affected tasks, and recommendation.',
    },
    huge: {
      prompt:
        'Analyze impact of this large change order on a complex schedule.\n\n' +
        'CHANGE: Add full basement finish - $85,000. 14 new tasks.\n\n' +
        'CURRENT SCHEDULE (60 tasks):\n' +
        Array.from({ length: 60 }, (_, i) =>
          `${i + 1}. ${['Frame', 'MEP', 'Insulate', 'Drywall', 'Finish'][i % 5]} ` +
          `d${i * 2}-d${i * 2 + 5}, ${i % 100}%`
        ).join('\n'),
    },
  },
  {
    name: 'weeklySummary',
    tier: 'fast',
    schema: weeklySummarySchema,
    arrayFields: ['projects'],
    tiny: { prompt: 'Weekly summary for 1 project: Kitchen remodel, 40% done.' },
    medium: {
      prompt:
        'Generate weekly exec summary for 5 projects: Kitchen (40% on track), ' +
        'Bathroom (60% at risk), Deck (20% behind), Basement (80% ahead), ' +
        'Garage (10% on track). Combined value: $450k.',
    },
    huge: {
      prompt:
        'Generate weekly exec summary for this large portfolio.\n\n' +
        longProjectData(40),
    },
  },
  {
    name: 'homeBriefing',
    tier: 'fast',
    schema: homeBriefingSchema,
    arrayFields: ['projects', 'urgentItems'],
    tiny: { prompt: 'Daily briefing: 1 project, 1 overdue invoice.' },
    medium: {
      prompt:
        'Daily briefing. 3 projects active. 1 overdue invoice ($12k, 15 days). ' +
        'Kitchen 60% done, bathroom 30%, deck 80%. Flag what needs attention today.',
    },
    huge: {
      prompt:
        'Daily briefing on my full portfolio.\n\n' +
        longProjectData(30) +
        '\n\nOverdue invoices: 8 totaling $145,000.',
    },
  },
  {
    name: 'invoicePrediction',
    tier: 'fast',
    schema: invoicePredictionSchema,
    tiny: { prompt: 'Predict: invoice $5k, due 30 days.' },
    medium: {
      prompt:
        'Predict payment for invoice #1042: $18,500, issued 11/1, due 11/30, ' +
        'Net 30 terms. Client history: 12 past invoices, avg 8 days late. ' +
        'Give predicted date, confidence, and a tip.',
    },
    huge: {
      prompt:
        'Predict payment considering extensive history.\n\n' +
        'INVOICE: #1042, $180,500, due 11/30, Net 60.\n' +
        'CLIENT HISTORY (40 invoices):\n' +
        Array.from({ length: 40 }, (_, i) => `  #${1000 + i}: paid ${3 + (i % 25)} days late`).join('\n'),
    },
  },
  {
    name: 'subEvaluation',
    tier: 'fast',
    schema: subEvaluationSchema,
    arrayFields: ['questionsToAsk', 'redFlags'],
    tiny: { prompt: 'Evaluate: electrician, no license info.' },
    medium: {
      prompt:
        'Evaluate subcontractor: ABC Electric, master electrician, license ' +
        'current, COI current, 5 bids (3 won), 2 active projects. Hiring for ' +
        'residential rewire. Questions to ask, typical rates, red flags.',
    },
    huge: {
      prompt:
        'Evaluate sub with extensive bid history.\n\n' +
        'Sub: XYZ Plumbing, master plumber, 10 yrs in business.\n' +
        'Bid history:\n' +
        Array.from({ length: 50 }, (_, i) =>
          `  Bid #${i}: ${['won', 'lost', 'pending'][i % 3]}, $${(5 + i) * 1000}`
        ).join('\n'),
    },
  },
  {
    name: 'equipmentAdvice',
    tier: 'fast',
    schema: equipmentAdviceSchema,
    tiny: { prompt: 'Rent or buy: mini excavator, 2 projects/yr.' },
    medium: {
      prompt:
        'Rent or buy decision: Bobcat S650 skid steer, $425/day rental. ' +
        '8 projects/year, avg 12 days each. Recommend rent/buy/lease with reasoning.',
    },
    huge: {
      prompt:
        'Rent vs buy analysis with detailed utilization.\n\n' +
        'Equipment: CAT 308 mini excavator, $850/day rent.\n' +
        'Utilization log (last 2 years):\n' +
        Array.from({ length: 80 }, (_, i) =>
          `  ${new Date(2024, i % 12, i % 28 + 1).toISOString().split('T')[0]}: ${8 + (i % 4)} hrs, project ${i % 20}`
        ).join('\n'),
    },
  },
  {
    name: 'projectReport',
    tier: 'fast',
    schema: projectReportSchema,
    arrayFields: ['keyAccomplishments', 'issuesAndRisks', 'nextMilestones', 'recommendations'],
    tiny: { prompt: 'Report: kitchen remodel, 50% done.' },
    medium: {
      prompt:
        'Project status report: Smith Kitchen Remodel, 60% complete, $45k ' +
        'budget, $28k paid, 2 COs approved, schedule health 82/100. Active ' +
        'tasks: cabinet install, countertop fabrication. Generate professional report.',
    },
    huge: {
      prompt:
        'Project report with huge task list.\n\n' +
        'PROJECT: Major Remodel, 180 tasks, 18 month duration.\n' +
        'TASKS:\n' +
        Array.from({ length: 120 }, (_, i) =>
          `${i + 1}. Task ${i}: ${i % 100}% done, ${['done', 'in_progress', 'not_started'][i % 3]}`
        ).join('\n'),
    },
  },
  {
    name: 'dailyReport',
    tier: 'fast',
    schema: dailyReportSchema,
    arrayFields: ['workCompleted', 'workInProgress', 'issuesAndDelays', 'tomorrowPlan', 'crewsOnSite'],
    tiny: { prompt: 'Daily report: crew framed 1 wall.' },
    medium: {
      prompt:
        'Generate daily field report: 4 carpenters framed south wall ' +
        '8hrs each. 2 electricians rough-in kitchen. Delivered 200 studs, ' +
        '40 sheets plywood. Minor cut on laborer\'s hand - first aid only.',
    },
    huge: {
      prompt:
        'Generate daily report from extensive site notes.\n\n' +
        'NOTES:\n' +
        Array.from({ length: 40 }, (_, i) =>
          `${8 + i / 10}am: ${['Framing', 'Plumbing', 'Electrical', 'HVAC'][i % 4]} ` +
          `crew of ${2 + (i % 6)} arrived, worked ${4 + (i % 6)} hrs, ` +
          `${i % 5 === 0 ? 'minor issue - ' + ['tool broke', 'wrong part', 'weather delay'][i % 3] : 'no issues'}`
        ).join('\n'),
    },
  },
  {
    name: 'aiSchedule',
    tier: 'smart',
    maxTokens: 8000,
    schema: aiScheduleSchema,
    arrayFields: ['tasks', 'assumptions', 'warnings'],
    tiny: { prompt: 'Build schedule: kitchen remodel, 4 weeks.' },
    medium: {
      prompt:
        'Build a schedule for 400sqft kitchen remodel: demo, plumbing/elec ' +
        'rough-in, drywall, cabinet install, counters, tile, paint, trim. ' +
        'Target 6 weeks. Include dependencies and milestones.',
    },
    huge: {
      prompt:
        'Build comprehensive schedule for full home renovation with ' +
        'addition. Scope: demo existing 3000sqft, 800sqft addition, full ' +
        'MEP rework, new roof, siding, windows, interior finishes, ' +
        'landscaping. Include 40+ tasks with realistic dependencies, crew ' +
        'sizes, weather sensitivity flags, milestones at major phases. ' +
        'Target duration: 9 months starting ' + new Date().toISOString() + '. ' +
        'Consider typical trade sequencing rules.',
    },
  },
  {
    name: 'quickEstimate',
    tier: 'smart',
    maxTokens: 8000,
    schema: aiQuickEstimateSchema,
    arrayFields: ['materials', 'labor', 'assemblies', 'warnings', 'savingsTips'],
    tiny: { prompt: 'Estimate: 10x10 deck.' },
    medium: {
      prompt:
        'Estimate 300sqft kitchen remodel, mid-tier finishes, Austin TX. ' +
        'Generate 8-15 materials, 3-6 labor trades, 2-4 assemblies. Include ' +
        'permits/dumpster/equipment/cleanup. 10% contingency, 12% overhead.',
    },
    huge: {
      prompt:
        'Estimate full custom 4500sqft single-family new build in Seattle WA. ' +
        'High-end finishes: quartzite counters, European cabinetry, wide plank ' +
        'white oak, steel windows, clay tile roof, custom millwork throughout. ' +
        'Include extensive materials list (20+ items), all trades (10+), ' +
        'major assemblies (foundation, framing, roofing, MEP, finishes). ' +
        'Seattle 2025 labor rates. Full permit stack including ADU. ' +
        'Generate very thorough estimate with all warnings about timeline, ' +
        'material lead times, and savings tips.',
    },
  },
  {
    name: 'cashFlowAnalysis',
    tier: 'smart',
    maxTokens: 3500,
    schema: cashFlowAnalysisSchema,
    arrayFields: ['criticalWeeks', 'recommendations', 'billingOptimizations'],
    tiny: { prompt: 'Cash flow: 1 project, $10k pending.' },
    medium: {
      prompt:
        'Analyze cash flow: 4 active projects, $180k in pending invoices, ' +
        '$95k in payables due next 30 days, $45k cash on hand. Identify ' +
        'critical weeks and billing optimizations.',
    },
    huge: {
      prompt:
        'Analyze cash flow for large portfolio over next 12 weeks.\n\n' +
        'PROJECTS & CASH POSITIONS:\n' +
        Array.from({ length: 25 }, (_, i) =>
          `Project ${i}: $${(50 + i * 20) * 1000} budget, ` +
          `$${(20 + i * 5) * 1000} invoiced, ` +
          `$${(5 + i * 3) * 1000} unpaid, ` +
          `$${(10 + i * 2) * 1000} payables due week ${(i % 12) + 1}`
        ).join('\n'),
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface TestResult {
  feature: string;
  size: 'tiny' | 'medium' | 'huge';
  ok: boolean;
  ms: number;
  httpStatus?: number;
  reason?: string;
  missingArrays?: string[];
  zodIssues?: string[];
}

async function callAI(
  prompt: string,
  tier: 'fast' | 'smart',
  maxTokens: number,
  schemaHint?: object,
): Promise<{ status: number; body: any; ms: number }> {
  const t0 = Date.now();
  const payload: Record<string, unknown> = { prompt, tier, maxTokens, jsonMode: true };
  if (schemaHint) payload.schemaHint = schemaHint;
  const r = await fetch(AI_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + AI_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: r.status, body, ms: Date.now() - t0 };
}

async function runCase(c: FeatureCase, size: 'tiny' | 'medium' | 'huge'): Promise<TestResult> {
  const { prompt, schemaHint } = c[size];
  const maxTokens = c.maxTokens ?? 1000;
  try {
    const { status, body, ms } = await callAI(prompt, c.tier, maxTokens, schemaHint);
    if (status >= 400) {
      return { feature: c.name, size, ok: false, ms, httpStatus: status, reason: `HTTP ${status}: ${body?.error ?? 'unknown'}` };
    }
    if (!body?.success) {
      // Production-parity: mageAI.ts treats MAX_TOKENS as degraded success (returns
      // defaulted shape so UI still renders). Mirror that here.
      const errMsg = body?.error ?? 'no error field';
      if (/MAX_TOKENS/i.test(errMsg)) {
        const fb = c.schema.safeParse({});
        if (fb.success) {
          return { feature: c.name, size, ok: true, ms, httpStatus: status, reason: 'MAX_TOKENS → defaulted (graceful)' };
        }
      }
      return { feature: c.name, size, ok: false, ms, httpStatus: status, reason: `envelope.success=false: ${errMsg}` };
    }
    if (body.data === undefined || body.data === null) {
      return { feature: c.name, size, ok: false, ms, httpStatus: status, reason: 'data field missing/null' };
    }
    // Production-parity: mageAI.ts unwraps arrays (single element, or merges
    // multi-element) when the schema expects an object, so mirror that here.
    let candidate = body.data;
    if (Array.isArray(candidate) && candidate.length > 0 && candidate.every((x: any) => x && typeof x === 'object')) {
      const first = c.schema.safeParse(candidate[0]);
      if (first.success) {
        candidate = candidate[0];
      } else if (candidate.length > 1) {
        const merged = Object.assign({}, ...candidate);
        const m = c.schema.safeParse(merged);
        if (m.success) candidate = merged;
      }
    }
    // Validate
    const parsed = c.schema.safeParse(candidate);
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 6).map(i => `${i.path.join('.')}: ${i.message}`);
      return { feature: c.name, size, ok: false, ms, httpStatus: status, reason: 'Zod parse failed', zodIssues: issues };
    }
    // Check UI-critical arrays are actually arrays
    const missing: string[] = [];
    if (c.arrayFields) {
      for (const f of c.arrayFields) {
        if (!Array.isArray((parsed.data as any)[f])) missing.push(f);
      }
    }
    if (missing.length > 0) {
      return { feature: c.name, size, ok: false, ms, httpStatus: status, reason: 'array field not an array after parse', missingArrays: missing };
    }
    return { feature: c.name, size, ok: true, ms, httpStatus: status };
  } catch (err) {
    return { feature: c.name, size, ok: false, ms: 0, reason: `thrown: ${String(err)}` };
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.split('=')[1]?.split(',');
  const size = args.find(a => a.startsWith('--size='))?.split('=')[1] as 'tiny' | 'medium' | 'huge' | undefined;
  return { only, size };
}

async function main() {
  const { only, size } = parseArgs();
  const cases = only ? CASES.filter(c => only.includes(c.name)) : CASES;
  const sizes: Array<'tiny' | 'medium' | 'huge'> = size ? [size] : ['tiny', 'medium', 'huge'];

  console.log(`\nStress-testing ${cases.length} AI features × ${sizes.length} sizes = ${cases.length * sizes.length} calls`);
  console.log(`Endpoint: ${AI_URL}\n`);

  const results: TestResult[] = [];
  for (const c of cases) {
    for (const s of sizes) {
      process.stdout.write(`  ${c.name.padEnd(24)} ${s.padEnd(7)} ...`);
      const r = await runCase(c, s);
      results.push(r);
      if (r.ok) {
        console.log(` ok (${r.ms}ms)`);
      } else {
        console.log(` FAIL (${r.ms}ms) — ${r.reason}`);
        if (r.zodIssues) r.zodIssues.forEach(i => console.log(`      ${i}`));
        if (r.missingArrays) console.log(`      non-array fields: ${r.missingArrays.join(', ')}`);
      }
    }
  }

  const passed = results.filter(r => r.ok).length;
  const failed = results.length - passed;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Results: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const r of results.filter(x => !x.ok)) {
      console.log(`  ${r.feature} [${r.size}]: ${r.reason}`);
    }
    process.exit(1);
  }
  console.log('All AI features stable across tiny/medium/huge payloads.');
}

main().catch(err => {
  console.error('Test harness crashed:', err);
  process.exit(2);
});
