// utils/copilot/scheduleBuilder/questions.ts — the AI Schedule Builder intake.
//
// A research-backed, ORDERED, ADAPTIVE question set (see the deep-research
// reference): ask only what materially changes the schedule, ground a sensible
// default for everything else, and skip questions the project already answers.
// Pure (types + specs + the adaptive filter + defaults) so a validator drives
// it. Ordering follows dependency-of-computation: scope → start → deadline →
// size → site → crew → calendar → procurement → weather → risk.
import type { Project } from '@/types';

export interface ScheduleBuilderAnswers {
  scope: string;                 // free-text — the seed for the activity list
  startDate: string | null;      // ISO — CPM anchor
  deadline: string | null;       // ISO — Substantial Completion target (soft unless set)
  sizeSqft: number | null;       // scales durations
  occupancy: 'vacant' | 'occupied' | null;
  crewSize: number | null;       // parallelism / duration scaling
  workDaysPerWeek: number | null;
  longLead: string | null;       // free-text list, or null = nothing unusual
  weather: 'handle' | 'interior' | null;
  knownRisks: string | null;     // free-text — targeted contingency
  buffer: 'tight' | 'standard' | 'padded' | null;
}

export type AnswerKind = 'text' | 'date' | 'number' | 'choice';

export interface QuestionSpec {
  field: keyof ScheduleBuilderAnswers;
  eyebrow: string;               // JetBrains-mono label
  question: string;              // the Fraunces headline
  subtext: string;               // WHY it matters (grounds the ask)
  kind: AnswerKind;
  placeholder?: string;
  choices?: { label: string; value: unknown; recommended?: boolean }[];
  /** Label for the "skip / use the default" action. */
  skipLabel: string;
  /** Skip this question entirely when the project/answers already resolve it. */
  skipIf?: (project: Project | null) => boolean;
}

export const QUESTIONS: QuestionSpec[] = [
  {
    field: 'scope', eyebrow: 'THE PROJECT', question: 'What are we building?',
    subtext: 'The scope is the seed for every task. Rooms, trades, the work — in your words.',
    kind: 'text', placeholder: 'e.g. Full kitchen gut + a bath remodel, move some plumbing', skipLabel: 'Skip',
  },
  {
    field: 'startDate', eyebrow: 'THE START', question: 'When do you break ground?',
    subtext: 'Everything is dated forward from here — and it sets your weather window.',
    kind: 'date', skipLabel: 'Use next Monday',
  },
  {
    field: 'deadline', eyebrow: 'THE DEADLINE', question: 'Any hard deadline?',
    subtext: 'A contract or must-finish date. I’ll flag anything that puts you behind it.',
    kind: 'date', skipLabel: 'No fixed deadline',
  },
  {
    field: 'sizeSqft', eyebrow: 'THE SIZE', question: 'Roughly how big is the work?',
    subtext: 'Square footage scales the durations.',
    kind: 'number', placeholder: 'e.g. 350', skipLabel: 'Let MAGE estimate it',
    skipIf: (p) => !!p?.squareFootage && p.squareFootage > 0,
  },
  {
    field: 'occupancy', eyebrow: 'THE SITE', question: 'Occupied or vacant?',
    subtext: 'Occupied means phasing, off-hours, and slower progress — it reshapes the sequence.',
    kind: 'choice', skipLabel: 'Assume vacant',
    choices: [{ label: 'Vacant', value: 'vacant', recommended: true }, { label: 'Occupied', value: 'occupied' }],
  },
  {
    field: 'crewSize', eyebrow: 'THE CREW', question: 'How many can you run at once?',
    subtext: 'Crew size sets what can happen in parallel and how fast each task goes.',
    kind: 'number', placeholder: 'e.g. 4', skipLabel: 'Assume a small crew',
  },
  {
    field: 'workDaysPerWeek', eyebrow: 'THE CALENDAR', question: 'How many days a week?',
    subtext: 'The working calendar is what turns durations into real dates.',
    kind: 'choice', skipLabel: 'Assume 5-day',
    choices: [{ label: '5 (Mon–Fri)', value: 5, recommended: true }, { label: '6 (Mon–Sat)', value: 6 }, { label: '7', value: 7 }],
  },
  {
    field: 'longLead', eyebrow: 'PROCUREMENT', question: 'Any long-lead items?',
    subtext: 'Cabinets, windows, steel, HVAC equipment — I’ll add procurement milestones so install isn’t left waiting.',
    kind: 'text', placeholder: 'e.g. custom cabinets (6 wk), windows', skipLabel: 'Nothing unusual',
  },
  {
    field: 'weather', eyebrow: 'THE WEATHER', question: 'Much weather-exposed work?',
    subtext: 'Excavation, foundations, roofing, exterior — I’ll buffer those for the season you’re in.',
    kind: 'choice', skipLabel: 'Handle it automatically',
    choices: [{ label: 'Yes — buffer it', value: 'handle', recommended: true }, { label: 'Mostly interior', value: 'interior' }],
  },
  {
    field: 'knownRisks', eyebrow: 'THE RISKS', question: 'Anything that could bite you?',
    subtext: 'Scope still changing, slow owner decisions, a sub who’s stretched — I’ll target the contingency at it.',
    kind: 'text', placeholder: 'e.g. finishes not selected yet; slow approvals', skipLabel: 'Nothing flagged',
  },
  {
    field: 'buffer', eyebrow: 'THE BUFFER', question: 'Run it tight, or leave some cushion?',
    subtext: '70% of jobs run long. A little buffer on the critical path is realism, not padding.',
    kind: 'choice', skipLabel: 'Standard cushion',
    choices: [{ label: 'Tight', value: 'tight' }, { label: 'Standard', value: 'standard', recommended: true }, { label: 'Padded', value: 'padded' }],
  },
];

/** The questions to actually ASK for this project — drops any a project field
 *  already resolves (adaptive intake: only what materially changes the plan). */
export function visibleQuestions(project: Project | null): QuestionSpec[] {
  return QUESTIONS.filter((q) => !(q.skipIf && q.skipIf(project)));
}

/** Grounded defaults — used when the contractor skips a question. */
export function defaultAnswers(project: Project | null): ScheduleBuilderAnswers {
  return {
    scope: project?.description ?? '',
    startDate: null,             // never auto-stamp a start date (jump-bug guard)
    deadline: null,
    sizeSqft: project?.squareFootage && project.squareFootage > 0 ? project.squareFootage : null,
    occupancy: 'vacant',
    crewSize: 3,
    workDaysPerWeek: 5,
    longLead: null,
    weather: 'handle',
    knownRisks: null,
    buffer: 'standard',
  };
}
