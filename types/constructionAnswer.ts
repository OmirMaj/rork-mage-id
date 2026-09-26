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

export interface ConstructionAnswerRequest {
  question: string;
  projectId?: string | null;
  jurisdiction?: ConstructionAnswerJurisdiction | null;
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
