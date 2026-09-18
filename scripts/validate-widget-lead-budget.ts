// validate-widget-lead-budget.ts — audit round 2, #24: the website widget's
// national price range was saved as the homeowner's own budget.
//
// widget-estimate wrote its published-U.S.-range ballpark into
// leads.budget_min / budget_max. The lead screen called it "Budget (theirs)",
// Instant Bid skipped asking the GC for his ballpark and blended toward it, and
// Convert made its top end Project.targetBudget "set by you" — the contract
// value the portal and WIP use until an estimate exists.
//
// Executes utils/widgetLeadCore (what convertLeadToProject, lead-detail and
// InstantBidProposalModal call) and pins the edge function + screens by source.
//
// Run: bun run scripts/validate-widget-lead-budget.ts
import { readFileSync } from 'node:fs';
import {
  WIDGET_TYPE_TO_PROJECT_TYPE, isWidgetLead, projectTypeForLead, scopeWithoutBallpark,
  statedBudgetOf, targetBudgetSeedForLead, widgetBallparkOf,
} from '../utils/widgetLeadCore';
import { QUOTE_LINE } from '../utils/leadQuoteCore';
import { WIDGET_PROJECT_TYPES } from '../utils/widgetEstimate';
import { buildPipelineHorizon } from '../utils/portfolio/pipelineHorizon';
import type { Lead, LeadTouch } from '../types';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, detail ? `\n      ${detail}` : ''); }
}
const read = (p: string) => readFileSync(p, 'utf8');
const NOW = '2026-09-17T12:00:00.000Z';

// Exactly what widget-estimate writes to `scope` (" · "-joined).
const WIDGET_SCOPE = [
  'Kitchen remodel', '~180 sq ft', 'premium finishes', 'zip 30301',
  'Instant Estimate shown: $60,000–$95,000', 'Island with a sink', '(from widget on https://acme.build)',
].join(' · ');
const lead = (over: Partial<Lead>): Lead => ({
  id: 'l1', name: 'Pat', source: 'website', stage: 'new', receivedAt: NOW, ...over,
} as Lead);

console.log('\nwidget ballpark is not the homeowner’s budget (audit round 2, #24):');

// 1. A pre-fix widget lead: range stored in budget_min/max too.
{
  const legacy = lead({ scope: WIDGET_SCOPE, projectType: 'Kitchen remodel', budgetMin: 60000, budgetMax: 95000 });
  ok('recognised as a widget lead', isWidgetLead(legacy));
  const b = widgetBallparkOf(legacy);
  ok('its ballpark reads back from the scope', !!b && b.low === 60000 && b.high === 95000, JSON.stringify(b));
  const stated = statedBudgetOf(legacy);
  ok('the stored range is NOT treated as their budget', stated.min === undefined && stated.max === undefined, JSON.stringify(stated));
  ok('Convert seeds NO target budget from it', targetBudgetSeedForLead(legacy, NOW) === undefined);
  ok('Convert carries the widget scope as a project type', projectTypeForLead(legacy) === 'remodel');
  ok('the AI prompt scope drops the range but keeps the homeowner’s words',
    !/60,000/.test(scopeWithoutBallpark(legacy.scope) ?? '') && /Island with a sink/.test(scopeWithoutBallpark(legacy.scope) ?? ''));
}

// 2. The GC's own quote wins; a budget he typed that differs from the range is kept.
{
  const quoted: LeadTouch = { id: 't', kind: 'email', occurredAt: NOW, body: `Sent Instant Bid proposal — Better tier.\n${QUOTE_LINE} $72,500` } as LeadTouch;
  const withQuote = lead({ scope: WIDGET_SCOPE, budgetMin: 60000, budgetMax: 95000, touches: [quoted] });
  ok('the GC’s latest quote seeds the target budget', targetBudgetSeedForLead(withQuote, NOW)?.amount === 72500);
  const typed = lead({ scope: WIDGET_SCOPE, budgetMin: 50000, budgetMax: 70000 });
  ok('a budget the GC typed (not the range) stays theirs', targetBudgetSeedForLead(typed, NOW)?.amount === 70000);
  const manual = lead({ source: 'referral', budgetMin: 40000, budgetMax: 55000 });
  ok('a non-widget lead keeps its stated budget exactly as before', targetBudgetSeedForLead(manual, NOW)?.amount === 55000
    && !isWidgetLead(manual) && widgetBallparkOf(manual) === null);
}

// 3. Type map: every mapped id exists in the widget, and the edge function agrees.
{
  const ids = new Set(WIDGET_PROJECT_TYPES.map(t => t.id));
  ok('every mapped widget scope exists', Object.keys(WIDGET_TYPE_TO_PROJECT_TYPE).every(id => ids.has(id)));
  const src = read('supabase/functions/widget-estimate/index.ts');
  const block = /const WIDGET_TYPE_TO_PROJECT_TYPE[^{]*\{([\s\S]*?)\};/.exec(src)?.[1] ?? '';
  const edge: Record<string, string> = {};
  for (const m of block.matchAll(/(\w+):\s*"(\w+)"/g)) edge[m[1]] = m[2];
  ok('edge-function type map matches utils/widgetLeadCore',
    JSON.stringify(Object.entries(edge).sort()) === JSON.stringify(Object.entries(WIDGET_TYPE_TO_PROJECT_TYPE).sort()),
    JSON.stringify(edge));

  // 4. The server fix itself: the range never reaches the budget columns.
  const insert = /sbInsert\("leads", \{([\s\S]*?)\n\s*\}\);/.exec(src)?.[1] ?? '';
  ok('lead insert found', insert.length > 0);
  ok('widget-estimate does NOT write budget_min / budget_max', !/budget_min\s*:/.test(insert) && !/budget_max\s*:/.test(insert));
  ok('…keeps the range in the labelled scope text', /Instant Estimate shown: \$/.test(src));
  ok('…and writes project_type_mapped', /project_type_mapped:\s*estimate\.projectTypeId/.test(insert));
}

// 5. Screens.
{
  const ctx = read('contexts/ProjectContext.tsx');
  const conv = ctx.slice(ctx.indexOf('const convertLeadToProject = useCallback'), ctx.indexOf('// Buyout — Bid Packages'));
  ok('convertLeadToProject seeds targetBudget through targetBudgetSeedForLead',
    /targetBudget: targetBudgetSeedForLead\(lead, now\)/.test(conv) && !/amount: lead\.budgetMax/.test(conv));
  const setup = read('app/widget-setup.tsx');
  ok('widget-setup no longer claims the widget prices from his numbers',
    !/priced from your\s+numbers\. Every/.test(setup) && /not your prices/.test(setup));
  const detail = read('app/lead-detail.tsx');
  ok('lead-detail labels the range "Widget ballpark shown to them"', /Widget ballpark shown to them/.test(detail));
  // The pipeline list card printed budgetMax || budgetMin raw — the ballpark
  // as "their" budget on every pre-fix widget lead (integration round 3).
  const list = read('app/leads.tsx').replace(/^\s*\/\/.*$/gm, '');
  ok('the Leads list card reads the budget through statedBudgetOf',
    /const stated = statedBudgetOf\(lead\);/.test(list) && !/lead\.budgetMax \|\| lead\.budgetMin/.test(list));
  ok('…and starts the budget fields from statedBudgetOf, not the raw columns',
    /useState<string>\(statedBudget\.min/.test(detail) && !/useState<string>\(existing\?\.budgetMin/.test(detail));
  const modal = read('components/InstantBidProposalModal.tsx');
  ok('Instant Bid never passes the raw lead budget to the AI',
    !/lead\.budgetMin \?\? undefined/.test(modal) && /budgetHint \?\? stated\.min/.test(modal));
  ok('…decides whether to ask for his ballpark from the stated budget',
    /const hasBudget = stated\.min != null \|\| stated\.max != null;/.test(modal));
  ok('…and shows the widget range under its own label', /Widget ballpark shown to them/.test(modal));
}

// 5. The deferred readers (integration round 1, money-accounts): the portfolio
//    pipeline horizon and the MAGE agent's PIPELINE block summed the raw
//    columns, so a pre-fix widget lead's ballpark counted as pipeline money.
{
  const legacy = lead({ id: 'w', stage: 'proposal', scope: WIDGET_SCOPE, budgetMin: 60000, budgetMax: 95000 });
  const typed = lead({ id: 'g', stage: 'proposal', source: 'referral', budgetMin: 40000, budgetMax: 60000 } as Partial<Lead>);
  const h = buildPipelineHorizon({
    leads: [legacy, typed], projects: [], invoices: [], changeOrders: [], commitments: [], bidResponses: [], now: new Date(NOW),
  } as Parameters<typeof buildPipelineHorizon>[0]);
  ok('pipeline horizon counts only the stated budget (the widget ballpark adds $0)', h.leadPipeline$ === 50000, String(h.leadPipeline$));
  const agent = read('utils/mageAgent.ts').replace(/^\s*\/\/.*$/gm, '');
  ok('the MAGE agent reads lead budgets through statedBudgetOf',
    /const statedAmount = \(l: Lead\) => \{ const b = statedBudgetOf\(l\);/.test(agent)
    && !/l\.budgetMax \?\? l\.budgetMin/.test(agent));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
