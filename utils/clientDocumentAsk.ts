// utils/clientDocumentAsk.ts — what the "ask when it matters" sheet asks, in
// what order, in what words, and what each answer does.
//
// WHY THIS EXISTS. Direction B has no setup form: a GC's payment terms and
// warranty are asked the first time a client-facing document is about to print
// them, one question per step, and never again. That only reads as respectful
// if the ask is short, names the document in his hand, and keeps its promises —
// so every word of it lives here, where scripts/validate-payment-terms.ts can
// hold it to: the terms title is the founder's "What deposit do you take?", no
// reason tells a history lesson ("MAGE used to…") or quotes a percent he never
// chose, and every toast fits the 80-character NailItToast without truncating.
//
// Pure: no React, no react-native, no storage. hooks/useClientDocumentGate.ts
// drives it; components/ClientDocumentAskSheet.tsx renders it.

import type { AppSettings, CompanyBranding, PaymentSplit, ProjectType } from '@/types';
import { bidIdentityGap, bidLicenceStateSource, mergedBidBranding, type BidIdentityGap } from '@/utils/bidDocumentIdentity';
import {
  splitLabel,
  stageAmounts,
  validatePaymentSplit,
  validateWarrantyMonths,
  warrantySentence,
  warrantyShortLabel,
} from '@/utils/paymentTerms';

export type AskQuestion = 'identity' | 'terms' | 'warranty';
export type AskPurpose = 'proposal_pdf' | 'proposal_link' | 'portal_proposal' | 'contract' | 'edit';
/** The document a "Just this …" answer lives on. */
export type AskDocumentNoun = 'contract' | 'proposal';
/** Where an answer is saved: his profile ("Use on every job"), or only the
 *  document in hand ("Just this contract"). */
export type AskScope = 'profile' | 'this_job';

export const ASK_TERMS_TITLE = 'What deposit do you take?';
export const ASK_WARRANTY_TITLE = 'How long do you warrant your work?';

export interface AskNeeds {
  /** The document prints a letterhead (company name, and a licence number in
   *  the states that require one). Asked only when bidIdentityGap blocks. */
  identity?: boolean;
  /** The document prints a payment schedule. */
  terms?: boolean;
  /** The document states a warranty period (contracts). */
  warranty?: boolean;
  /** This job's own split (a portal stamp, a contract draft's schedule). When
   *  valid it answers `terms` and nothing is asked. */
  record?: PaymentSplit | null;
  /** This job's own warranty months (a contract already carrying a period). */
  recordWarrantyMonths?: number | null;
}

export type AskProfile = Pick<AppSettings, 'branding' | 'location' | 'paymentSplit' | 'warrantyMonths'>;

/**
 * The questions to ask, in order: identity, terms, warranty. A question the
 * profile or the job's own record already answers is not asked.
 */
export function missingQuestions(needs: AskNeeds, profile: AskProfile): AskQuestion[] {
  const out: AskQuestion[] = [];
  if (needs.identity && bidIdentityGap(profile.branding, profile.location).blocking) out.push('identity');
  if (needs.terms && !validSplit(needs.record) && !validSplit(profile.paymentSplit)) out.push('terms');
  if (needs.warranty && !validMonths(needs.recordWarrantyMonths) && !validMonths(profile.warrantyMonths)) out.push('warranty');
  return out;
}

function validSplit(s: PaymentSplit | null | undefined): s is PaymentSplit {
  return !!s && validatePaymentSplit({ deposit: s.depositPct, progress: s.progressPct, final: s.finalPct }).ok;
}
function validMonths(m: number | null | undefined): m is number {
  return m != null && validateWarrantyMonths(m).ok;
}

// ─── Copy ────────────────────────────────────────────────────────────────────

/** Why the terms are being asked, by the document in his hand. Talks about that
 *  document and about staying consistent from now on — never about the past. */
export const TERMS_REASON: Record<AskPurpose, string> = {
  proposal_pdf: 'This proposal prints your payment schedule. Your client portal and contract will say the same.',
  proposal_link: 'The proposal link prints your payment schedule. Your client portal and contract will say the same.',
  portal_proposal: 'Your client reads the payment schedule before accepting in the portal. Your proposals and contract will say the same.',
  contract: 'Your construction agreement prints the payment schedule your client signs. Your proposals will say the same.',
  edit: 'Your proposals, client portal and contracts print this payment schedule. Anything already sent keeps the terms it went out with.',
};

/** The contract screen also holds proposal-kind rows ("Just this proposal"),
 *  and the construction-agreement wording under a proposal button contradicts
 *  itself. The reason follows the document noun, as the buttons do. */
export const CONTRACT_PROPOSAL_TERMS_REASON =
  'This proposal prints the payment schedule your client accepts. Your client portal and contract will say the same.';

export const WARRANTY_REASON: Record<'ask' | 'edit', string> = {
  ask: 'Your construction agreement states how long you warrant your workmanship. New contracts will say the same.',
  edit: 'Your construction agreement states how long you warrant your workmanship. Contracts already sent keep theirs.',
};

export const TERMS_FOOTNOTE = 'Saved as your terms. Change them any time in Settings or Company Profile.';
export const WARRANTY_FOOTNOTE = 'Saved as your warranty. Change it any time in Settings or Company Profile.';
export const IDENTITY_FOOTNOTE = 'Saved to your company profile — the next bid goes straight out.';
export const THIS_JOB_FOOTNOTE: Record<AskDocumentNoun, string> = {
  contract: '“Just this contract” saves the answer on this contract only.',
  proposal: '“Just this proposal” saves the answer on this proposal only.',
};

export interface AskStepCopy {
  title: string;
  reason: string;
  primaryLabel: string;
  /** Present only where a per-job answer is allowed (contract purpose). */
  secondaryLabel?: string;
  footnote: string;
  /** '1 of 2' when there is more than one step. */
  stepLabel?: string;
}

export function askStepCopy(
  question: AskQuestion,
  purpose: AskPurpose,
  ctx: {
    documentNoun?: AskDocumentNoun;
    stepIndex: number;
    stepCount: number;
    /** Offer "Just this contract/proposal". Ignored for identity and edit. */
    justThisJob?: boolean;
    /** The gap computed from the SAVED branding — its title and reason are the
     *  identity step's copy (bidDocumentIdentity is the one wording of it). */
    identityGap?: BidIdentityGap;
  },
): AskStepCopy {
  const isLast = ctx.stepIndex >= ctx.stepCount - 1;
  const stepLabel = ctx.stepCount > 1 ? `${ctx.stepIndex + 1} of ${ctx.stepCount}` : undefined;
  const noun: AskDocumentNoun = ctx.documentNoun ?? (purpose === 'contract' ? 'contract' : 'proposal');
  const secondaryLabel = purpose !== 'edit' && ctx.justThisJob ? `Just this ${noun}` : undefined;

  if (question === 'identity') {
    const gap = ctx.identityGap;
    return {
      title: gap?.title ?? 'This prints on the homeowner’s copy',
      reason: gap?.reason ?? '',
      primaryLabel: isLast ? 'Save and send' : 'Next',
      footnote: IDENTITY_FOOTNOTE,
      stepLabel,
    };
  }
  if (question === 'terms') {
    return {
      title: ASK_TERMS_TITLE,
      reason: purpose === 'contract' && noun === 'proposal' ? CONTRACT_PROPOSAL_TERMS_REASON : TERMS_REASON[purpose],
      primaryLabel: purpose === 'edit' ? 'Save' : 'Use on every job',
      secondaryLabel,
      footnote: purpose === 'edit' ? '' : secondaryLabel ? `${TERMS_FOOTNOTE} ${THIS_JOB_FOOTNOTE[noun]}` : TERMS_FOOTNOTE,
      stepLabel,
    };
  }
  return {
    title: ASK_WARRANTY_TITLE,
    reason: purpose === 'edit' ? WARRANTY_REASON.edit : WARRANTY_REASON.ask,
    primaryLabel: purpose === 'edit' ? 'Save' : 'Use on every job',
    secondaryLabel,
    footnote: purpose === 'edit' ? '' : secondaryLabel ? `${WARRANTY_FOOTNOTE} ${THIS_JOB_FOOTNOTE[noun]}` : WARRANTY_FOOTNOTE,
    stepLabel,
  };
}

// ─── Live lines under the fields ─────────────────────────────────────────────

/** Whole dollars with thousands separators; cents only when there are some.
 *  Hand-rolled so the string is identical on Hermes, web and bun. */
export function formatDollars(n: number): string {
  const cents = Math.round(Math.max(0, n) * 100);
  const whole = Math.floor(cents / 100);
  const frac = cents % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac === 0 ? `$${grouped}` : `$${grouped}.${String(frac).padStart(2, '0')}`;
}

/**
 * The line under the three percent fields: the validator's reason once he has
 * typed something, or what the split means on this job. Empty while all three
 * fields are empty — a form that scolds before anything is typed is noise.
 */
export function termsLiveLine(
  input: { deposit: string; progress: string; final: string },
  total?: number | null,
): { kind: 'empty' | 'hint' | 'amounts'; text: string } {
  if (!input.deposit.trim() && !input.progress.trim() && !input.final.trim()) return { kind: 'empty', text: '' };
  const v = validatePaymentSplit(input);
  if (!v.ok) return { kind: 'hint', text: v.reason };
  if (total == null || !Number.isFinite(total) || total <= 0) {
    return { kind: 'amounts', text: `${splitLabel(v.split)} — deposit / progress / final` };
  }
  const a = stageAmounts(total, v.split);
  return {
    kind: 'amounts',
    text: `On this ${formatDollars(total)} job: ${formatDollars(a.deposit)} deposit · ${formatDollars(a.progress)} progress · ${formatDollars(a.final)} final`,
  };
}

export function warrantyLiveLine(raw: string): { kind: 'empty' | 'hint' | 'sentence'; text: string } {
  if (!raw.trim()) return { kind: 'empty', text: '' };
  const v = validateWarrantyMonths(raw);
  return v.ok ? { kind: 'sentence', text: warrantySentence(v.months) } : { kind: 'hint', text: v.reason };
}

// ─── California down-payment note (founder decision 2026-09-17) ─────────────
//
// A NOTE, never a block. Shown under the deposit field only when the GC's
// licensing state resolves to California (bidLicenceStateSource: licence state
// > address > market — the same precedence the bid licence gate uses) and the
// job is residential or unknown. A 'commercial' project gets no note: §7159.5
// governs home improvement contracts.
//
// Same discipline as BID_LICENCE_RULES in utils/bidDocumentIdentity.ts: the
// requirement below was read off the statute text at sourceUrl on checkedOn and
// is quoted, not recalled. No other state has a row, and an absent row means
// "no note", never a guess at a neighbouring state's law.

export interface DepositCapRule {
  state: string;
  authority: string;
  citation: string;
  /** The statute's own words, quoted. */
  requirement: string;
  /** The dollar ceiling and the percent-of-contract ceiling; the LOWER applies. */
  capDollars: number;
  capPercent: number;
  checkedOn: string;
  sourceUrl: string;
}

export const DEPOSIT_CAP_RULES: readonly DepositCapRule[] = [
  {
    state: 'CA',
    authority: 'CSLB',
    citation: 'Business and Professions Code § 7159.5(a)(3)',
    requirement: 'If a downpayment will be charged, the downpayment shall not exceed one thousand dollars ($1,000) or 10 percent of the contract amount, whichever amount is less.',
    capDollars: 1000,
    capPercent: 10,
    checkedOn: '2026-09-17',
    sourceUrl: 'https://california.public.law/codes/business_and_professions_code_section_7159.5',
  },
];

/**
 * The note under the deposit field, or null.
 *
 * `projectType` undefined means "no job" (the edit sheet) or an unknown type —
 * both get the note, worded for home-improvement contracts generally. With a
 * job total the note names that job's dollar cap; without one it states the
 * rule. It never says his deposit is illegal — whether a given job is a home
 * improvement contract is his call, not the app's.
 */
export function depositCapNote(input: {
  branding: Partial<CompanyBranding> | null | undefined;
  location: string | null | undefined;
  projectType?: ProjectType | null;
  total?: number | null;
}): { rule: DepositCapRule; text: string } | null {
  const { state } = bidLicenceStateSource(input.branding, input.location);
  const rule = DEPOSIT_CAP_RULES.find((r) => r.state === state);
  if (!rule) return null;
  if (input.projectType === 'commercial') return null;
  const base = `California: on a home improvement contract the down payment can’t be more than ${formatDollars(rule.capDollars)} or ${rule.capPercent}% of the contract amount, whichever is less (${rule.citation}).`;
  const total = input.total;
  if (total == null || !Number.isFinite(total) || total <= 0) return { rule, text: base };
  const cap = Math.min(rule.capDollars, Math.round(total * rule.capPercent) / 100);
  return { rule, text: `${base} On this ${formatDollars(total)} job that is ${formatDollars(cap)}.` };
}

// ─── Submitting a step ───────────────────────────────────────────────────────

export type AskEffect = 'save_branding' | 'save_terms' | 'save_warranty';

export interface AskAnswers {
  branding?: CompanyBranding;
  split?: PaymentSplit;
  warrantyMonths?: number;
  /** How each was answered — the two are independent ("Use on every job" for
   *  the split, "Just this contract" for the warranty is a real answer). */
  termsScope?: AskScope;
  warrantyScope?: AskScope;
}

export type AskStepInput =
  | { question: 'identity'; companyName: string; licenseNumber: string }
  | { question: 'terms'; deposit: string; progress: string; final: string; scope: AskScope }
  | { question: 'warranty'; months: string; scope: AskScope };

export interface AskFlowState {
  stepIndex: number;
  stepCount: number;
  /** The saved profile the identity answer merges onto. */
  profile: AskProfile;
  /** Answers from earlier steps of this sheet. */
  answers: AskAnswers;
}

/**
 * One press of a step's button. Either a hint (nothing saved, stay on the
 * step) or the effects to perform and the answers so far. `this_job` answers
 * have NO save effect — they live on the document the caller fills in.
 */
export function submitAskStep(
  state: AskFlowState,
  input: AskStepInput,
): { hint: string } | { effects: AskEffect[]; answers: AskAnswers; done: boolean } {
  const done = state.stepIndex >= state.stepCount - 1;
  if (input.question === 'identity') {
    const merged = mergedBidBranding(state.profile.branding, {
      companyName: input.companyName,
      licenseNumber: input.licenseNumber,
    });
    const gap = bidIdentityGap(merged, state.profile.location);
    if (gap.blocking) return { hint: gap.reason };
    return { effects: ['save_branding'], answers: { ...state.answers, branding: merged }, done };
  }
  if (input.question === 'terms') {
    const v = validatePaymentSplit(input);
    if (!v.ok) return { hint: v.reason };
    return {
      effects: input.scope === 'profile' ? ['save_terms'] : [],
      answers: { ...state.answers, split: v.split, termsScope: input.scope },
      done,
    };
  }
  const v = validateWarrantyMonths(input.months);
  if (!v.ok) return { hint: v.reason };
  return {
    effects: input.scope === 'profile' ? ['save_warranty'] : [],
    answers: { ...state.answers, warrantyMonths: v.months, warrantyScope: input.scope },
    done,
  };
}

// ─── Confirmation toast ──────────────────────────────────────────────────────

export const TOAST_MAX = 80;

/**
 * The toast after the last step. At most 80 characters (NailItToast truncates
 * past that). The founder's "proposal, portal and contract now all say …" is
 * shown ONLY when it is true — when no owned portal is still left without
 * terms.
 */
export function confirmationFor(input: {
  question: AskQuestion;
  scope: AskScope;
  /** The profile had no answer to this question before this press. */
  firstTime: boolean;
  split?: PaymentSplit;
  months?: number;
  unconfirmedPortalCount: number;
  documentNoun: AskDocumentNoun;
}): string {
  const { question, scope, firstTime, split, months, unconfirmedPortalCount, documentNoun } = input;
  if (question === 'identity') return 'Saved to your company profile';
  if (scope === 'this_job') return `On this ${documentNoun} only — your next job will ask again`;
  if (question === 'terms') {
    if (!split) return 'Saved as your terms';
    const label = splitLabel(split);
    if (!firstTime) return `Saved — new proposals and contracts say ${label}; sent ones keep theirs`;
    return unconfirmedPortalCount === 0
      ? `Saved as your terms — proposal, portal and contract now all say ${label}`
      : `Saved as your terms — new proposals and contracts say ${label}`;
  }
  if (months == null) return 'Saved as your warranty';
  return `Saved — new contracts warrant your work for ${warrantyShortLabel(months)}`;
}

/** What ONE step of the sheet did, recorded by the hook at the press that
 *  answered it — never re-derived from settings at the last press, where a
 *  terms answer saved a step earlier already reads as "not the first time". */
export interface AskedTermsFact {
  scope: AskScope;
  /** The profile had no split when THIS step was pressed. */
  firstTime: boolean;
  split: PaymentSplit;
  /** Owned portals still without terms when THIS step was pressed. */
  unconfirmedPortalCount: number;
}
export interface AskedWarrantyFact {
  scope: AskScope;
  firstTime: boolean;
  months: number;
}
export interface AskedSheetFacts {
  identity?: boolean;
  terms?: AskedTermsFact;
  warranty?: AskedWarrantyFact;
}

/**
 * The toast for a whole sheet. One answered question → confirmationFor, word
 * for word. Terms AND warranty in one sheet (the contract flow) → one line
 * that names both and never calls a profile-saved answer "only this job"
 * (and never calls a this-job answer saved). Identity alongside terms or
 * warranty is not named: the document in his hand shows it. ≤ TOAST_MAX.
 */
export function confirmationForSheet(facts: AskedSheetFacts, documentNoun: AskDocumentNoun): string {
  const { terms, warranty } = facts;
  if (terms && !warranty) {
    return confirmationFor({ question: 'terms', scope: terms.scope, firstTime: terms.firstTime, split: terms.split, unconfirmedPortalCount: terms.unconfirmedPortalCount, documentNoun });
  }
  if (warranty && !terms) {
    return confirmationFor({ question: 'warranty', scope: warranty.scope, firstTime: warranty.firstTime, months: warranty.months, unconfirmedPortalCount: 0, documentNoun });
  }
  if (!terms || !warranty) return confirmationFor({ question: 'identity', scope: 'profile', firstTime: true, unconfirmedPortalCount: 0, documentNoun });
  const label = splitLabel(terms.split);
  // Adjective form — "a 2-year warranty", not "a 2 years warranty".
  const period = warranty.months % 12 === 0 ? `${warranty.months / 12}-year` : `${warranty.months}-month`;
  if (terms.scope === 'this_job' && warranty.scope === 'this_job') {
    return `On this ${documentNoun} only — your next job will ask again`;
  }
  if (terms.scope === 'this_job') return `Terms on this ${documentNoun} only · ${period} warranty saved as yours`;
  if (warranty.scope === 'this_job') return `Saved your terms (${label}) · warranty on this ${documentNoun} only`;
  // Both saved. A changed answer never reaches documents already sent.
  return terms.firstTime && warranty.firstTime
    ? `Saved as yours — ${label} and a ${period} warranty on new documents`
    : `Saved — new documents: ${label}, ${period} warranty; sent ones keep theirs`;
}
