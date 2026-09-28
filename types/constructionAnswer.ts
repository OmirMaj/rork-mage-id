/** The jobsite's hand-verified adoption record, as construction-answer's
 *  jurisdictionBlockFor reads it. Built from resolveCodeJurisdiction. */
export interface ConstructionAnswerJurisdiction {
  authority: string;
  codesInForce: string;
  checkedOn: string;
  sourceUrl: string;
  place: string;
  scope: 'city' | 'state';
}

/** The linked job's public building record, as construction-answer's
 *  buildingRecordBlockFor reads it. Sent only when the contractor has loaded
 *  the record on the job's Building record card (Ask never starts a lookup). */
export interface ConstructionAnswerBuildingRecord {
  /** Where the record came from, e.g. "DOB's public records". */
  source: string;
  /** The record's as-of day (YYYY-MM-DD), or null when not published. */
  asOf: string | null;
  /** The summary's promptBlock: header, headline, fact lines, RULES. */
  block: string;
}

export interface ConstructionAnswerRequest {
  question: string;
  projectId?: string | null;
  jurisdiction?: ConstructionAnswerJurisdiction | null;
  buildingRecord?: ConstructionAnswerBuildingRecord | null;
}

export interface AnswerCitation {
  label: string;
  kind: 'web' | 'plan' | 'rfi' | 'rate';
  url?: string;
  ref?: string;
}

export interface ConstructionCalc {
  expression: string;
  value: number;
  note?: string;
}

export interface ConstructionAnswerResult {
  answer: string;
  citations: AnswerCitation[];
  calc?: ConstructionCalc | null;
  verified: boolean;
  disclaimer?: string | null;
  usedAI: boolean;
}
