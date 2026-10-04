// utils/permitPath/copy.ts — every user-facing string the Permit Path ENGINE
// writes. Fact text never lives here: it comes from the question packs or from
// a department's own answer, verbatim. One file, so the banned-words scan in
// scripts/validate-permit-path-engine.ts reads it whole.
//
// Voice (docs/VOICE.md): sentence case, numerals, no exclamation marks, at most
// one em dash per string.

import type { Party, StationId, StationState } from '@/utils/permitPath/types';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** 'YYYY-MM-DD' (or a longer ISO string) → 'Oct 2, 2026'. Pure string work, no
 *  Date. Anything unreadable is returned as given rather than guessed. */
export function ppDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return iso;
  return `${MONTHS[mi]} ${Number(m[3])}, ${m[1]}`;
}

const STATION_TITLES: Readonly<Record<StationId, string>> = {
  scope: 'Scope',
  checks: 'Checks',
  drawings: 'Drawings and who stamps them',
  filing: 'Filing',
  review: 'Plan review',
  issued: 'Permit issued',
  work: 'Work and inspections',
  signoff: 'Sign-off',
};

/** One neutral line under each station title. Describes the step, claims nothing. */
const STATION_SUMMARIES: Readonly<Record<StationId, string>> = {
  scope: 'What the job is, and which trades',
  checks: 'Landmark, zoning, asbestos and open violations',
  drawings: 'Who draws the plans, and who stamps them',
  filing: 'What goes in with the application',
  review: 'The department reviews the plans',
  issued: 'The permit is issued and posted',
  work: 'The work, and the inspections along the way',
  signoff: 'What closes the permit at the end',
};

const STATE_LABELS: Readonly<Record<StationState, string>> = {
  done: 'Done',
  current: 'You are here',
  ahead: 'Ahead',
  not_needed: 'Not needed',
  unknown: 'Not known yet',
};

const PARTY_LABELS: Readonly<Record<Party, string>> = {
  owner: 'Owner',
  gc: 'You (GC)',
  design_pro: 'Architect or engineer',
  licensed_plumber: 'Licensed plumber',
  licensed_electrician: 'Licensed electrician',
  asbestos_investigator: 'Asbestos investigator',
  expediter: 'Expediter',
  department: 'Building department',
  lpc: 'Landmarks (LPC)',
};

/** Stations up to and including review confirm "before you file"; later ones
 *  "before you build". */
const FILE_STAGE: readonly StationId[] = ['scope', 'checks', 'drawings', 'filing', 'review'];

export const PP_COPY = {
  stationTitle: (id: StationId): string => STATION_TITLES[id],
  stationSummary: (id: StationId): string => STATION_SUMMARIES[id],
  stateLabel: (s: StationState): string => STATE_LABELS[s],
  partyLabel: (p: Party): string => PARTY_LABELS[p],

  chips: {
    unknown: 'Not known yet · Ask',
    yourAnswer: 'Your answer',
    yourRecords: 'From your permits',
    measured: (asOf: string): string => `NYC DOB data · as of ${ppDay(asOf)}`,
    departmentSaid: (answeredOn: string, saidBy: string | null): string =>
      saidBy && saidBy.trim() ? `Department said · ${ppDay(answeredOn)} · ${saidBy.trim()}` : `Department said · ${ppDay(answeredOn)}`,
    aiDraft: 'AI draft',
    source: (label: string, checkedOn: string): string => `${label} · checked ${ppDay(checkedOn)}`,
  },

  confirmLine: (station: StationId, officeTitle: string | null): string => {
    const who = officeTitle && officeTitle.trim() ? officeTitle.trim() : 'your building department';
    return FILE_STAGE.includes(station) ? `Confirm with ${who} before you file.` : `Confirm with ${who} before you build.`;
  },

  durations: {
    unknown: 'Not known yet',
    departmentSaid: (answerText: string, answeredOn: string): string => `Department said ${answerText.trim()} · ${ppDay(answeredOn)}`,
    measured: (days: number, filings: number): string => `Median ${days} days · ${filings} filings`,
    measuredDetail: 'Approved filings only · last 12 months',
    yourRecords: (n: number): string => `From your ${n} permits here`,
    yourRecordsDetail: (median: number, min: number, max: number): string =>
      min === max ? `Median ${median} days` : `Median ${median} days · ${min} to ${max} days`,
    lpcStatedMax: "LPC's stated maximum: 20 to 90 working days",
    lpcStatedMaxDetail: 'Permit for Minor Work 20, Certificate of No Effect 30, Certificate of Appropriateness 90',
  },

  permitStatusLine: (status: 'denied' | 'expired', permitNumber: string | null): string =>
    `A permit on this job is ${status} · ${permitNumber && permitNumber.trim() ? permitNumber.trim() : 'no number on file'}`,

  /** A department question with the department's own answer under it. */
  deptAnswered: (question: string, answer: string): string => `${question.trim()} Answer: ${answer.trim()}`,
  /** Fills the scope into a department question ("The scope is: <scope>."). */
  scopeFallback: 'no estimate lines yet',
  zoningFact: (districts: readonly string[], version: string | null): string =>
    `PLUTO lists zoning ${districts.join(', ')} · PLUTO ${version ?? 'version not given'}.`,
  officeFact: (title: string, phone: string | null, hours: string | null): string =>
    [title, phone, hours].filter((x): x is string => !!x && !!x.trim()).join(' · '),

  prefill: {
    plutoLists: (name: string, version: string): string => `PLUTO lists ${name} (PLUTO ${version})`,
    plutoNone: "PLUTO lists none. LPC's own map is the record.",
    fromPin: 'from the map pin',
    fromEstimate: (line: string): string => `From your estimate: '${line}'`,
  },

  readiness: {
    title: 'Ready to file?',
    inHand: (n: number, m: number): string => `${n} of ${m} in hand`,
    notKnown: (k: number): string => `${k} not known yet`,
    missing: 'Missing',
    have: 'Have it',
    notNeeded: 'Not needed',
    unknown: 'Not known yet',
    footer: (company: string, day: string): string =>
      `Prepared in MAGE ID by ${company.trim() || 'your company'} on ${ppDay(day)}. Not reviewed by any building department.`,
  },

  explain: {
    added: (what: string): string => `Added: ${what}`,
    removed: (what: string): string => `Removed: ${what}`,
    notNeeded: (title: string, because: string): string => `Not needed: ${title} (${because})`,
    backOn: (title: string): string => `Back on the route: ${title}`,
  },

  jurisdiction: {
    nycName: 'New York City',
    nycOffice: 'NYC Department of Buildings',
    unresolvedName: 'Building department not known yet',
  },
} as const;
