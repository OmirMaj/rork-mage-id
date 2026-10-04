export type StationId = 'scope' | 'checks' | 'drawings' | 'filing' | 'review' | 'issued' | 'work' | 'signoff';
export const STATION_ORDER: readonly StationId[] = ['scope','checks','drawings','filing','review','issued','work','signoff'];

export type Party =
  | 'owner' | 'gc' | 'design_pro' | 'licensed_plumber' | 'licensed_electrician'
  | 'asbestos_investigator' | 'expediter' | 'department' | 'lpc';

export type Family = 'nyc' | 'ny_town' | 'ny_village' | 'ny_city' | 'elsewhere' | 'unresolved';

/** 'NYC' | PermitOffice.key ('NY:<geoid>', 'NJ:<code>', 'CT:<id>', 'MD:<fips>') | 'UNRESOLVED'. */
export type JurisdictionKey = string;

export interface SourceRef { label: string; url: string; checkedOn: string /* YYYY-MM-DD */ }

/** Where a line's claim comes from. 'verified' requires `source`. */
export type Certainty = 'verified' | 'department_said' | 'your_records' | 'measured' | 'your_answer' | 'ai_draft' | 'unknown';

export interface DeptAnswerRef { id: string; answeredOn: string; saidBy: string | null; channel: string; sourceUrl: string | null }

export interface RouteItem {
  id: string;                    // stable: 'nyc.acp5', 'li.survey'
  station: StationId;
  kind: 'need' | 'document' | 'who' | 'fact';
  text: string;                  // plain English, sentence case, no banned words
  who: readonly Party[];
  certainty: Certainty;
  source: SourceRef | null;      // non-null iff certainty === 'verified'
  answer: DeptAnswerRef | null;  // non-null iff certainty === 'department_said'
  askQuestionId: string | null;  // non-null iff certainty === 'unknown' (feeds PPASK)
  readiness: boolean;            // appears in the pre-filing check
}

export type DurationKind = 'measured' | 'your_records' | 'department_said' | 'stated_max' | 'unknown';
export interface Duration {
  kind: DurationKind;
  label: string;                 // exact chip text
  detail: string | null;         // e.g. 'Approved filings only · last 12 months'
  source: SourceRef | null;
  answer: DeptAnswerRef | null;
}

export type StationState = 'done' | 'current' | 'ahead' | 'not_needed' | 'unknown';
export interface Station {
  id: StationId; title: string; state: StationState; summary: string;
  items: RouteItem[]; duration: Duration; unknownCount: number;
  notNeededBecause: string | null; confirmLine: string;
}

// Question packs are DATA. Predicates are data, not functions, so validators can walk them.
export type Predicate =
  | { q: string; is: string | readonly string[] }   // answer equals / is one of
  | { q: string; answered: boolean }
  | { family: readonly Family[] }
  | { county: readonly string[] }                    // county FIPS: '36059' | '36103'
  | { all: readonly Predicate[] } | { any: readonly Predicate[] } | { not: Predicate };

export interface Question {
  id: string;                    // 'nyc.landmark'
  text: string;
  help: string | null;
  kind: 'yes_no_unsure' | 'choice' | 'multi' | 'year';
  choices: readonly { id: string; label: string }[] | null;
  askIf: Predicate | null;
  prefill: 'pluto_landmark' | 'building_year' | 'permit_office' | 'scope_trades' | null;
  source: SourceRef | null;      // when the question itself rests on a verified rule
}

export interface ItemTemplate extends Omit<RouteItem, 'answer'> { when: Predicate | null }
export interface SkipRule { station: StationId; when: Predicate; because: string; source: SourceRef | null }

/** A question MAGE cannot answer for this jurisdiction: the department must. */
export interface DeptQuestion { id: string; station: StationId; text: string; askIf: Predicate | null }

export interface QuestionPack {
  id: 'base' | 'nyc' | 'li_common' | 'nassau' | 'suffolk' | 'li_village';
  appliesTo: Predicate;
  questions: readonly Question[];
  items: readonly ItemTemplate[];
  skips: readonly SkipRule[];
  deptQuestions: readonly DeptQuestion[];
}

export interface InterviewAnswer { value: string | string[] | number; from: 'gc' | 'prefill_confirmed'; prefillNote: string | null; at: string }
export type InterviewAnswers = Readonly<Record<string, InterviewAnswer>>;

export interface ReadinessMark { state: 'have' | 'missing' | 'n_a'; evidence: { kind: 'attested' | 'permit' | 'document'; ref: string | null } | null; at: string }
export type ReadinessMarks = Readonly<Record<string, ReadinessMark>>;

export interface PermitRoute {
  projectId: string;
  jurisdiction: { key: JurisdictionKey; family: Family; name: string; officeTitle: string | null; headline: string | null; cautions: readonly string[]; countyFips: string | null };
  stations: Station[];
  unknownCount: number;
  openDeptQuestions: DeptQuestion[];
  readiness: { have: number; missing: number; unknown: number; total: number };
  inputsKey: string;             // stable hash of every input; same inputs → same route
}
