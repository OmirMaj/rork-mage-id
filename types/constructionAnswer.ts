export interface ConstructionAnswerRequest {
  question: string;
  projectId?: string | null;
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
