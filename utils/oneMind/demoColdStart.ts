// utils/oneMind/demoColdStart.ts — canned answers for a brand-new (no data) account.
//
// When isColdStart(bundle) is true, askOneMind short-circuits to a flat "go
// create data" message — a dead end on the highest-stakes day-one screen.
// Instead, the ask screen shows the ONBOARDING_STARTERS and, when one is tapped,
// injects the matching answer below directly into the thread: no model call, no
// metering, no network. It gives a fresh install a real feel for what MAGE does
// before they've logged a single job. Keys MUST match ONBOARDING_STARTERS.

import type { OneMindCitation } from './answer';

export interface DemoAnswer {
  answer: string;
  citations: OneMindCitation[];
}

// Citations here have no drillIn (there's no data to open yet), so they render
// as non-tappable labels — purely illustrative of the "every claim is sourced"
// promise.
export const DEMO_ANSWERS: Record<string, DemoAnswer> = {
  'What can you do?': {
    answer:
      "I read everything you log — estimates, schedules, invoices, RFIs, daily reports — and answer plain questions across all of it in one place.\n\nAsk me things like \"how much am I owed?\", \"which job is losing money?\", or \"what's slipping this week?\" and I'll give you one straight answer, with a tap-through to the exact screen behind every number.\n\nAdd a project and try me.",
    citations: [],
  },
  'How do you track my margin?': {
    answer:
      "For every job I compare what you estimated against what it's actually costing — labor, materials, subs, change orders — and surface the projected final margin as the numbers move.\n\nWhen a job starts bleeding, I flag it early with the reason (labor over, a missed change order, slow buyout) so you can fix it while it still matters — not at closeout.\n\nOnce you've got a project going, ask \"which job is over budget?\" and you'll see it live.",
    citations: [{ ref: 'MARGIN', domain: 'LIVE MARGIN' }],
  },
  'Show me a sample answer': {
    answer:
      "Here's the kind of answer you'll get once a job is running:\n\n\"Maple St. Reno is tracking 4% under margin — labor is 6% over while materials came in under. At today's pace it finishes about 3 days late. You're owed $22,400 on invoice #INV-104, now 18 days out and overdue.\"\n\nEvery figure links to the screen behind it. Add a project and I'll answer like this from your real numbers.",
    citations: [
      { ref: 'MARGIN', domain: 'LIVE MARGIN' },
      { ref: 'PACE', domain: 'YOUR PACE' },
      { ref: 'CASH', domain: 'CASH FLOW' },
    ],
  },
};
