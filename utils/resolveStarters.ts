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
const BY_SCREEN: Record<string, Starter[]> = {
  'project-detail': [
    { q: "What's the status of this job?", icon: 'gauge' },
    { q: "What's overdue on this job?", icon: 'clock' },
    { q: 'Is this project over budget?', icon: 'alert' },
    { q: 'Which invoices here are still unpaid?', icon: 'dollar' },
  ],
  schedule: [
    { q: "What's slipping on this schedule?", icon: 'calendar' },
    { q: "What's on the critical path?", icon: 'alert' },
    { q: 'Am I ready for next week?', icon: 'clock' },
    { q: 'Where am I over-allocating crew?', icon: 'users' },
  ],
  'schedule-pro': [
    { q: "What's slipping on this schedule?", icon: 'calendar' },
    { q: "What's on the critical path?", icon: 'alert' },
    { q: 'Am I ready for next week?', icon: 'clock' },
    { q: 'Where am I over-allocating crew?', icon: 'users' },
  ],
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
 * items; unknown or missing screen yields the business-wide default.
 */
export function resolveStarters(screen?: string): Starter[] {
  const key = (screen ?? '').toLowerCase();
  return BY_SCREEN[key] ?? DEFAULT_STARTERS;
}
