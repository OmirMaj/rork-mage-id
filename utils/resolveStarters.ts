// utils/resolveStarters.ts — screen-aware starter prompts for the ask screen.
//
// The Brain FAB passes the screen the user opened Ask from (?screen=<route>).
// We return a small, curated set of starter questions tuned to that context, so
// opening Ask from the invoices tab offers "Which invoice is most overdue?"
// instead of the same four generic prompts everywhere. Unknown / missing screen
// falls back to the business-wide set (identical to the old default — no
// regression). Each starter carries an icon KEY (not a component) so this stays
// a pure, dependency-free data module; the ask screen maps the key to a Lucide
// icon at render.

export type StarterIcon =
  | 'clock' | 'dollar' | 'alert' | 'calendar'
  | 'gauge' | 'users' | 'wallet' | 'trending' | 'sparkle';

export interface Starter {
  q: string;
  icon: StarterIcon;
}

// Business-wide default — matches what the ask screen showed before this existed.
const DEFAULT_STARTERS: Starter[] = [
  { q: "What's overdue right now?", icon: 'clock' },
  { q: 'How much is unpaid across all jobs?', icon: 'dollar' },
  { q: 'Which project is over budget?', icon: 'alert' },
  { q: "What's slipping on my schedules?", icon: 'calendar' },
];

// Onboarding set for a brand-new account with no data yet. These map to canned,
// no-data demo answers (see utils/oneMind/demoColdStart.ts) so a fresh install
// gets a real feel for the assistant before logging anything. The strings MUST
// match the DEMO_ANSWERS keys exactly.
export const ONBOARDING_STARTERS: Starter[] = [
  { q: 'What can you do?', icon: 'sparkle' },
  { q: 'How do you track my margin?', icon: 'gauge' },
  { q: 'Show me a sample answer', icon: 'trending' },
];

// Keyed by the cleaned innermost route segment the FAB passes.
//
// The job screens' starters are BUILT from the anchored job's name (audit #36).
// They used to say "this job" / "here" / "this schedule" — but Ask had no idea
// which job "this" was, answered business-wide, and listed every job's invoices
// for "Which invoices here are still unpaid?". Now the FAB forwards the job
// and the starters name it, so the question reads true on its own (and in the
// saved-thread strip, where "this job" would mean nothing). Without an anchor
// those screens fall back to the business-wide set rather than say "this".
type ProjectStarterBuilder = (job: string) => Starter[];

const PROJECT_STARTERS: ProjectStarterBuilder = (job) => [
  { q: `What's the status of ${job}?`, icon: 'gauge' },
  { q: `What's overdue on ${job}?`, icon: 'clock' },
  { q: `Is ${job} over budget?`, icon: 'alert' },
  { q: `Which invoices on ${job} are still unpaid?`, icon: 'dollar' },
];

const SCHEDULE_STARTERS: ProjectStarterBuilder = (job) => [
  { q: `What's slipping on ${job}'s schedule?`, icon: 'calendar' },
  { q: `What's on ${job}'s critical path?`, icon: 'alert' },
  { q: `Is ${job} ready for next week?`, icon: 'clock' },
  { q: `Where am I over-allocating crew on ${job}?`, icon: 'users' },
];

// Not the Schedule tab (`schedule`): see PROJECT_PARAM_BY_SCREEN — it has no
// job anchor, so it keeps the business-wide set.
const BY_PROJECT_SCREEN: Record<string, ProjectStarterBuilder> = {
  'project-detail': PROJECT_STARTERS,
  'schedule-pro': SCHEDULE_STARTERS,
};

/** Screens whose starters are about ONE job, so they need an anchor. */
export function isProjectScopedScreen(screen?: string): boolean {
  return (screen ?? '').toLowerCase() in BY_PROJECT_SCREEN;
}

const BY_SCREEN: Record<string, Starter[]> = {
  invoices: [
    { q: 'How much is unpaid across all jobs?', icon: 'dollar' },
    { q: 'Which invoice is most overdue?', icon: 'clock' },
    { q: "What's my cash position?", icon: 'wallet' },
    { q: 'Who owes me the most?', icon: 'trending' },
  ],
  leads: [
    { q: 'Which leads should I follow up on?', icon: 'users' },
    { q: "What's my pipeline value?", icon: 'trending' },
    { q: "What's my win rate?", icon: 'gauge' },
    { q: 'Which lead is going cold?', icon: 'clock' },
  ],
};

/**
 * Resolve the starter prompts for a given screen. Always returns at least four
 * items; unknown or missing screen yields the business-wide default. A job
 * screen with no anchored job name also yields the default — its own starters
 * only make sense about a named job.
 */
export function resolveStarters(screen?: string, anchorName?: string | null): Starter[] {
  const key = (screen ?? '').toLowerCase();
  const job = anchorName?.trim();
  const build = BY_PROJECT_SCREEN[key];
  if (build) return job ? build(job) : DEFAULT_STARTERS;
  return BY_SCREEN[key] ?? DEFAULT_STARTERS;
}

// Screens that are about ONE job, and the route param each keys that job by
// (project-detail uses `id`, Schedule Pro `projectId`). The Brain FAB
// forwards that id to Ask as the conversation's anchor. Only these screens: a
// bare `id` elsewhere can be an invoice's, an RFI's or a sub's, and anchoring
// on it would be a guess.
//
// The Schedule TAB (`schedule`) is deliberately absent. Its `projectId` param
// is only an entry nonce: the tab reads it once, then the job on screen is
// local state (selectedProjectId) that the picker changes without touching the
// URL, and tab params are sticky. Forwarding it would anchor Ask on the job
// the GC arrived with, not the one he switched to — "Answering for Henderson"
// over Maple St's schedule. Re-add it only once both schedule pickers call
// router.setParams({ projectId }) so the param follows the screen.
const PROJECT_PARAM_BY_SCREEN: Readonly<Record<string, 'id' | 'projectId'>> = {
  'project-detail': 'id',
  'schedule-pro': 'projectId',
};

/** The job the user is looking at, when the screen is a job screen. */
export function anchorProjectIdFor(
  screen: string | undefined,
  params: Record<string, string | string[] | undefined>,
): string | undefined {
  const key = screen ? PROJECT_PARAM_BY_SCREEN[screen.toLowerCase()] : undefined;
  if (!key) return undefined;
  const raw = params[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
