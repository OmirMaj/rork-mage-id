// utils/codeCard/types.ts — the shared code-card contract (lanes CCKIT, CCWIRE,
// CCSERVER). Written verbatim from the code-cards PLAN.md; every lane imports
// it. Pure types only: no runtime code lives here.
//
// THE RULE these shapes carry (copyright + honesty): a card never holds the
// wording of a model code. `summary`, `why` and `whatToBuild` are MAGE's own
// plain-English words (summaryEchoCheck in ./echoCheck.ts rejects code-shaped
// text); the section number and the adopted edition point at the official
// text, which opens in ICC's free viewer at volume level only.
import type { CitationEvidence } from '@/utils/codeAmendments';
export type CodeVerdict = 'required' | 'limit' | 'not_required';
export type CodeStage = 'footing' | 'foundation' | 'framing' | 'rough' | 'insulation' | 'final' | 'other';
export type CodeCardStatus = 'fix' | 'ask' | 'ok';            // plan-check rows; Ask cards leave it undefined
export interface CodeTrigger { value: number; unit: 'in' | 'ft' | 'psf' | 'deg' | 'count'; comparison: '>' | '>=' | '<' | '<=' }
export interface CodeJobValue { value: number; unit: CodeTrigger['unit']; source: 'sheet' | 'measured' | 'job'; sourceLabel: string }
export interface CodeCardItem {
  id: string;
  verdict: CodeVerdict;
  summary: string;                // OUR words, <= 140 chars, passes summaryEchoCheck
  why?: string;                   // why it applies to THIS job, <= 160 chars
  section: string;                // 'R312.1'
  citedEdition?: string;          // '2025 RCNYS'
  evidence: CitationEvidence | null; // from codeAmendments; null = model recall, unresolved
  stage?: CodeStage;              // AI guess
  stageIsGuess: boolean;
  status?: CodeCardStatus;
  observed?: string;              // plan-check: 'Drawn 4½ in.'
  location?: string;              // plan-check: 'Detail 3/A-2'
  question?: string;              // plan-check: question for the architect
  jobValue?: CodeJobValue;        // tape + re-check render ONLY when jobValue AND trigger are structured
  trigger?: CodeTrigger;          // labelled as recall unless evidence is a government rung
  calc?: { expression: string; value: string; note?: string }; // MAGE calculator, labelled as such
  trade?: string;                 // for the sub picker
  whatToBuild?: string[];         // our words, each <= 100 chars
}
export interface CodeJurisdictionInfo {
  editionLabel: string | null; editionSourceUrl: string | null; editionCheckedOn: string | null;   // codeJurisdiction.ts
  permitOfficeTitle: string | null; permitOfficeSourceUrl: string | null; permitOfficeCheckedOn: string | null; // permitOfficeFor()
  viewerUrl: string | null; viewerLabel: string | null;
}
export interface CodePin { id: string; projectId: string; stage: CodeStage; item: CodeCardItem; pinnedAt: string }
