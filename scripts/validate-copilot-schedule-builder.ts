// scripts/validate-copilot-schedule-builder.ts — pure-fn validator for the AI
// Schedule Builder intake: adaptive question filtering, grounded defaults, and
// the generation prompt carrying the answers + the research-backed rules.
import { QUESTIONS, visibleQuestions, defaultAnswers, type ScheduleBuilderAnswers } from '../utils/copilot/scheduleBuilder/questions';
import { buildAnswersPrompt } from '../utils/copilot/scheduleBuilder/buildAnswersPrompt';
import type { Project } from '../types';

let pass = 0, fail = 0;
function ok(n: string, cond: boolean) { if (cond) { pass++; console.log('  ✓', n); } else { fail++; console.log('  ✗', n); } }

const proj = (over: Partial<Project> = {}): Project => ({
  id: 'p1', name: 'Test', type: 'renovation', location: 'United States', squareFootage: 0,
  quality: 'standard', description: '', createdAt: '', updatedAt: '', estimate: null, schedule: null, status: 'draft', ...over,
} as Project);

// --- structure ---
ok('scope is the first question', QUESTIONS[0].field === 'scope');
ok('start date is asked before the deadline', QUESTIONS.findIndex(q => q.field === 'startDate') < QUESTIONS.findIndex(q => q.field === 'deadline'));
ok('every question has an eyebrow, question, subtext, skipLabel', QUESTIONS.every(q => q.eyebrow && q.question && q.subtext && q.skipLabel));
ok('choice questions carry choices', QUESTIONS.filter(q => q.kind === 'choice').every(q => (q.choices?.length ?? 0) >= 2));

// --- adaptive filtering ---
ok('size question shown when project has no sqft', visibleQuestions(proj({ squareFootage: 0 })).some(q => q.field === 'sizeSqft'));
ok('size question skipped when project already has sqft', !visibleQuestions(proj({ squareFootage: 1800 })).some(q => q.field === 'sizeSqft'));

// --- grounded defaults ---
{
  const d = defaultAnswers(proj({ squareFootage: 1800, description: 'kitchen reno' }));
  ok('default start date is null (never auto-stamp)', d.startDate === null);
  ok('default seeds scope from project description', d.scope === 'kitchen reno');
  ok('default sizeSqft comes from the project', d.sizeSqft === 1800);
  ok('default calendar is 5-day', d.workDaysPerWeek === 5);
  ok('default buffer is standard', d.buffer === 'standard');
}

// --- prompt carries the answers + the doctrine ---
{
  const a: ScheduleBuilderAnswers = {
    scope: 'Kitchen gut + bath', startDate: '2026-08-03', deadline: '2026-11-01', sizeSqft: 350,
    occupancy: 'occupied', crewSize: 4, workDaysPerWeek: 6, longLead: 'custom cabinets 6wk',
    weather: 'handle', knownRisks: 'finishes not selected', buffer: 'padded',
  };
  const p = buildAnswersPrompt(a, proj(), ['Site Work', 'Framing', 'Finishes']);
  ok('prompt includes the scope', p.includes('Kitchen gut + bath'));
  ok('prompt includes the start date', p.includes('2026-08-03'));
  ok('prompt flags the hard deadline', p.includes('2026-11-01') && /deadline/i.test(p));
  ok('prompt carries the long-lead item + procurement rule', p.includes('custom cabinets') && /procurement/i.test(p));
  ok('prompt notes occupied → phasing', /occupied/i.test(p));
  ok('prompt demands FS-dominant complete logic', /finish-to-start/i.test(p) && /no task may/i.test(p));
  ok('prompt targets Substantial Completion (not 100%)', /substantial completion/i.test(p));
  ok('prompt reflects the padded buffer', /generous cushion/i.test(p));
}
// empty-ish answers still produce a valid prompt (defaults path)
ok('handles all-null answers', buildAnswersPrompt(defaultAnswers(proj()), proj(), ['Framing']).length > 100);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
