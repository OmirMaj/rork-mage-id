// utils/copilot/scheduleBuilder/buildAnswersPrompt.ts — builds the mageAI
// generation prompt from the intake answers. Pure (no mageAI/RN) so a validator
// can assert it carries the answers + the research-backed scheduling rules.
import type { Project } from '@/types';
import type { ScheduleBuilderAnswers } from './questions';
import { paceFactsBlock } from './paceGrounding';

/** The scheduling doctrine the generator must follow (from the deep-research
 *  reference): FS-dominant complete logic, real milestones, procurement +
 *  permits + weather + targeted contingency, durations scaled to size + crew.
 *  `paceFacts` (buildPaceFacts) grounds durations in the contractor's OWN
 *  measured pace — when present, the model derives instead of guessing. */
export function buildAnswersPrompt(
  a: ScheduleBuilderAnswers,
  project: Project | null,
  phases: string[],
  paceFacts: string[] = [],
  rfiFactLine?: string | null,
  weatherFactLine?: string | null,
): string {
  const line = (label: string, v: unknown) => (v === null || v === undefined || v === '' ? null : `${label}: ${v}`);
  const facts = [
    line('PROJECT', project?.name),
    line('TYPE', project?.type),
    line('LOCATION', project?.location),
    line('SCOPE', a.scope),
    line('SIZE (sq ft)', a.sizeSqft ?? project?.squareFootage),
    // Wizard-captured project facts (finding #55): quality tier + special
    // requirements materially change sequencing and durations. scope.quality
    // (wizard) wins over the creation-time legacy field when both exist.
    line('QUALITY TIER', project?.scope?.quality ?? project?.quality),
    line('SPECIAL REQUIREMENTS', project?.scope?.specialRequirements),
    line('START DATE', a.startDate),
    line('HARD DEADLINE (Substantial Completion target)', a.deadline),
    line('SITE', a.occupancy === 'occupied' ? 'OCCUPIED — phase the work, expect off-hours + slower progress' : 'vacant'),
    line('CREW SIZE (parallelism)', a.crewSize),
    line('WORK WEEK (days)', a.workDaysPerWeek),
    line('LONG-LEAD ITEMS', a.longLead),
    a.weather === 'handle'
      ? `WEATHER: buffer exterior/earthwork/roofing${weatherFactLine ? ` — ${weatherFactLine}` : ' for the season implied by the start date'}`
      : (a.weather === 'interior' ? 'WEATHER: mostly interior — minimal weather exposure' : null),
    line('KNOWN RISKS', a.knownRisks),
    rfiFactLine ? `RFI LATENCY: ${rfiFactLine}` : null,
    line('BUFFER PREFERENCE', a.buffer),
  ].filter(Boolean);

  const pace = paceFactsBlock(paceFacts);

  return [
    'You are the best construction scheduler alive. Build a realistic, accurate',
    'construction schedule for this project from the contractor’s answers below.',
    '',
    ...facts,
    ...(pace ? ['', pace] : []),
    '',
    'RULES (construction scheduling best practice):',
    `1. Return JSON: { "tasks": [ ... ] }. Each task: id ("t1","t2"…), name, phase`,
    `   (one of: ${phases.join(', ')}), duration (WORKING days, integer), predecessorIds`,
    '   (array of task ids — the tasks that must finish first), isMilestone (bool),',
    '   isCriticalPath (bool), crewSize (int 1-8), wbs ("1.1","2.3"), rationale (ONE',
    '   sentence: why it sits here + how its duration was derived), assumption (bool —',
    '   true when you GUESSED rather than derived from the given inputs).',
    '2. Sequence with FINISH-TO-START logic (~90% FS). Link EVERY task — no task may',
    '   be left with no predecessor except the start milestone (dangling logic breaks',
    '   the critical path).',
    '3. Open with a "Project Start" milestone (duration 0) and end with a',
    '   "Substantial Completion" milestone (duration 0) — the owner-occupancy target,',
    '   NOT 100% punch-complete.',
    '4. For each LONG-LEAD item, add a PROCUREMENT/submittal task that must finish',
    '   before its install task, so install is never scheduled before material lands.',
    '5. Insert PERMIT and INSPECTION hold-point tasks where the trade sequence needs',
    '   them (e.g. rough-in inspection before cover, final before occupancy).',
    '6. Scale durations to the size + crew (bigger scope / smaller crew = longer).',
    a.deadline ? '7. There IS a hard deadline — if the natural finish blows past it, keep the logic honest (do NOT compress unrealistically); the review will surface the overrun.' : '7. No hard deadline — schedule to a realistic finish.',
    `8. ${a.buffer === 'tight' ? 'Run it tight — minimal buffer.' : a.buffer === 'padded' ? 'Leave generous cushion on the critical path.' : 'Leave a modest, realistic cushion on the critical path.'}${a.knownRisks ? ' Add extra buffer/attention around the stated risks.' : ''}`,
    '9. Generate 15-35 tasks scaled to scope. Realistic durations (most construction',
    '   activities run 1-20 working days).',
    '',
    'Return ONLY the JSON object.',
  ].join('\n');
}
