// utils/nyHomeImprovement.ts — the New York home improvement contract
// checklist (General Business Law Article 36-A, § 770 and § 771).
//
// A CHECKLIST, never a verdict. Before a contractor signs and sends a contract
// for a New York home improvement job, the contract screen lists what § 771(1)
// asks a home improvement contract to contain and marks each item:
//   'found'   — the app can see it (a profile field the contract header
//               prints, a start date plus a duration, a scope, a price, a
//               payment schedule);
//   'missing' — the app cannot see it;
//   'check'   — wording that looks like the item is there, or an item the app
//               cannot read from text at all. A keyword match is NOT proof the
//               notice is the one the law asks for, so the four notices
//               (lien, escrow, three-day cancel, insurance) are never 'found'.
// It never blocks Sign & send, never edits the contract text and never says
// the contract is compliant. The exact wording each notice must use, the bold
// and type-size rules and local licence rules are TO BE CONFIRMED BY COUNSEL
// (counselConfirm on the row). Founder decision 2026-10-01: no statutory
// notice text is inserted anywhere until a New York lawyer approves it.
//
// Same discipline as DEPOSIT_CAP_RULES (utils/clientDocumentAsk.ts): every row
// carries its citation, the page it was read from and the day it was read.
// The requirement strings are OUR plain paraphrase, not quotes: the tool that
// read the statute returned a summary, so the item names and citations are
// verified and the wording is not.
//
// Pure: no react, react-native, supabase or storage import (bun-executable;
// scripts/validate-ny-home-improvement.ts runs it). Money is integer cents.

import type { CompanyBranding, PaymentMilestone, Project, ProjectContract } from '@/types';
import { jobsiteAddressForProject, normalizeState } from '@/utils/codeJurisdiction';
import { bidLicenceStateSource } from '@/utils/bidDocumentIdentity';

export type NyCheckId =
  | 'a-name' | 'a-address' | 'a-phone' | 'a-licence'
  | 'b-dates' | 'b-contingencies'
  | 'c-scope' | 'c-materials' | 'c-price'
  | 'd-lien' | 'e-escrow' | 'f-schedule' | 'h-cancel' | 'i-insurance';

export interface NyHicRule {
  id: NyCheckId;
  citation: string;
  /** Our short plain-English paraphrase of what the paragraph asks. Not a quote. */
  requirement: string;
  sourceUrl: string;
  checkedOn: string;
  /** The exact wording, format or applicability needs a New York lawyer. */
  counselConfirm: boolean;
}

export const NY_HIC_SOURCE_771 = 'https://www.nysenate.gov/legislation/laws/GBS/771';
export const NY_HIC_SOURCE_770 = 'https://www.nysenate.gov/legislation/laws/GBS/770';
export const NY_HIC_CHECKED_ON = '2026-10-01';

/** § 770: a home improvement contract is one whose aggregate price is MORE than $500. */
export const NY_HIC_THRESHOLD_CENTS = 50000;

const row = (id: NyCheckId, citation: string, requirement: string, counselConfirm: boolean): NyHicRule => ({
  id, citation, requirement, sourceUrl: NY_HIC_SOURCE_771, checkedOn: NY_HIC_CHECKED_ON, counselConfirm,
});

export const NY_HIC_RULES: readonly NyHicRule[] = [
  row('a-name', 'GBL § 771(1)(a)', 'The contractor’s name.', false),
  row('a-address', 'GBL § 771(1)(a)', 'The contractor’s address.', false),
  row('a-phone', 'GBL § 771(1)(a)', 'The contractor’s telephone number.', false),
  row('a-licence', 'GBL § 771(1)(a)', 'The contractor’s license number, if a license applies.', true),
  row('b-dates', 'GBL § 771(1)(b)', 'An approximate start date and substantial completion date.', false),
  row('b-contingencies', 'GBL § 771(1)(b)', 'The contingencies that would change the completion date.', true),
  row('c-scope', 'GBL § 771(1)(c)', 'A description of the work.', false),
  row('c-materials', 'GBL § 771(1)(c)', 'The materials, with make, model or other identifying information.', true),
  row('c-price', 'GBL § 771(1)(c)', 'The agreed price.', false),
  row('d-lien', 'GBL § 771(1)(d)', 'A notice to the owner about mechanic’s liens.', true),
  row('e-escrow', 'GBL § 771(1)(e)', 'How payments received before substantial completion are held (escrow, or a bond or letter of credit instead).', true),
  row('f-schedule', 'GBL § 771(1)(f)', 'A progress payment schedule, where progress payments are used.', false),
  row('h-cancel', 'GBL § 771(1)(h)', 'A notice of the owner’s right to cancel until midnight of the third business day after signing.', true),
  row('i-insurance', 'GBL § 771(1)(i)', 'An insurance disclosure.', true),
];

// ─── Does the checklist apply? ──────────────────────────────────────────────

export type NyApplies = 'yes' | 'maybe' | 'no';
/** Why the answer is 'maybe' (the card prints one line per reason), or why 'no' / 'yes'. */
export type NyAppliesReason = 'ny' | 'not-ny' | 'no-state' | 'commercial' | 'new-home' | 'amount';

export interface NyAppliesInput {
  project: Pick<Project, 'structuredAddress' | 'location' | 'type'> | null | undefined;
  branding?: Partial<CompanyBranding> | null;
  /** The contract price in integer cents: Math.round(contractValue * 100). */
  contractValueCents: number;
}

/**
 * 'yes' — the jobsite is in New York, a residential project over $500.
 * 'maybe' — it might be: the jobsite has no state but the contractor is in New
 *   York; or the project is a new home (§ 770 excludes building a new home);
 *   or the price is $500.00 or less (§ 770 counts the AGGREGATE of the
 *   contracts with the owner, which this one contract cannot see).
 * 'no' — the jobsite is in another state, or nothing says New York, or the
 *   project is commercial.
 * The reason is the FIRST reason that decided the answer.
 */
export function nyHomeImprovementApplies(input: NyAppliesInput): { applies: NyApplies; reason: NyAppliesReason } {
  const project = input.project ?? null;
  const jobState = normalizeState(jobsiteAddressForProject(project).state);
  if (jobState && jobState !== 'NY') return { applies: 'no', reason: 'not-ny' };
  if (!jobState) {
    const contractorState = bidLicenceStateSource(input.branding ?? null).state;
    if (contractorState !== 'NY') return { applies: 'no', reason: 'not-ny' };
  }
  if (project?.type === 'commercial') return { applies: 'no', reason: 'commercial' };
  if (!jobState) return { applies: 'maybe', reason: 'no-state' };
  if (project?.type === 'new_build') return { applies: 'maybe', reason: 'new-home' };
  const cents = Number.isFinite(input.contractValueCents) ? Math.round(input.contractValueCents) : 0;
  if (cents <= NY_HIC_THRESHOLD_CENTS) return { applies: 'maybe', reason: 'amount' };
  return { applies: 'yes', reason: 'ny' };
}

// ─── The checklist ──────────────────────────────────────────────────────────

export type NyCheckStatus = 'found' | 'missing' | 'check';

export interface NyCheckItem {
  id: NyCheckId;
  label: string;
  status: NyCheckStatus;
  detail: string;
  citation: string;
  sourceUrl: string;
  counselConfirm: boolean;
  /** The item is a company-profile field: the card can offer "Open company profile". */
  profileField: boolean;
  /** The item is a notice the app does not write: the card hints where it goes. */
  noticeHint: boolean;
}

export interface NyCheckInput {
  contract: Pick<ProjectContract, 'startDate' | 'durationDays' | 'scopeText' | 'termsText' | 'warrantyText' | 'paymentSchedule' | 'contractValue'>;
  branding: Partial<CompanyBranding> | null | undefined;
}

export interface NyCheckResult {
  items: NyCheckItem[];
  missing: number;
  toCheck: number;
}

/** Item names and details. Legal paraphrase: plain English data, never routed through t(). */
const LABELS: Record<NyCheckId, { label: string; detail: string }> = {
  'a-name': { label: 'Your Company Name', detail: 'Printed from your company profile.' },
  'a-address': { label: 'Your Business Address', detail: 'Printed from your company profile.' },
  'a-phone': { label: 'Your Phone Number', detail: 'Printed from your company profile.' },
  'a-licence': { label: 'Your License Number, If One Is Required', detail: 'New York City and some counties license home improvement contractors.' },
  'b-dates': { label: 'Start Date and Substantial Completion Date', detail: 'Set a start date and a duration on this contract.' },
  'b-contingencies': { label: 'What Could Change the Completion Date', detail: 'Say what could delay the work.' },
  'c-scope': { label: 'A Description of the Work', detail: 'Write the scope above.' },
  'c-materials': { label: 'Materials, with Make and Model', detail: 'Name the make and model of materials you supply.' },
  'c-price': { label: 'The Agreed Price', detail: 'Set the contract value.' },
  'd-lien': { label: 'Mechanic’s Lien Notice', detail: 'A notice to the owner about liens if subs or suppliers go unpaid.' },
  'e-escrow': { label: 'Escrow Notice for Payments Before Completion', detail: 'How payments received before the work is done are held.' },
  'f-schedule': { label: 'Progress Payment Schedule', detail: 'Amounts tied to stages of the work.' },
  'h-cancel': { label: 'Three-Day Right to Cancel', detail: 'The owner may cancel until midnight of the third business day after signing.' },
  'i-insurance': { label: 'Insurance Disclosure', detail: 'Your insurance details, as the law asks.' },
};

const PROFILE_MISSING = 'Add it in your company profile.';
const NOTICE_HINT = 'Add this notice in your contract terms.';
const FOUND_WORDING = 'Found wording. Check it with your counsel.';
const SCHEDULE_INCOMPLETE = 'A payment has no label or no amount.';

const PROFILE_FIELDS: ReadonlySet<NyCheckId> = new Set(['a-name', 'a-address', 'a-phone', 'a-licence']);
/** The four notices: a keyword match is never proof, so these are never 'found'. */
export const NY_NOTICE_IDS: readonly NyCheckId[] = ['d-lien', 'e-escrow', 'h-cancel', 'i-insurance'];
const NOTICE_HINT_IDS: ReadonlySet<NyCheckId> = new Set(['d-lien', 'e-escrow', 'h-cancel']);

const filled = (s: string | null | undefined): boolean => (s ?? '').trim().length > 0;

function milestoneComplete(m: PaymentMilestone): boolean {
  const amount = typeof m.amount === 'number' && Number.isFinite(m.amount) && m.amount > 0;
  const percent = typeof m.percent === 'number' && Number.isFinite(m.percent) && m.percent > 0;
  return filled(m.label) && (amount || percent);
}

export function checkNyHomeImprovementContract(input: NyCheckInput): NyCheckResult {
  const c = input.contract;
  const b = input.branding ?? {};
  const terms = `${c.termsText ?? ''}\n${c.warrantyText ?? ''}`;
  const schedule = Array.isArray(c.paymentSchedule) ? c.paymentSchedule : [];

  const status: Record<NyCheckId, NyCheckStatus> = {
    'a-name': filled(b.companyName) ? 'found' : 'missing',
    'a-address': filled(b.address) ? 'found' : 'missing',
    'a-phone': filled(b.phone) ? 'found' : 'missing',
    // "if applicable": a blank licence is not proof one is required.
    'a-licence': filled(b.licenseNumber) ? 'found' : 'check',
    'b-dates': filled(c.startDate) && typeof c.durationDays === 'number' && c.durationDays > 0 ? 'found' : 'missing',
    'b-contingencies': /delay|contingenc|weather|unforeseen/i.test(terms) ? 'check' : 'missing',
    'c-scope': (c.scopeText ?? '').trim().length >= 20 ? 'found' : 'missing',
    'c-materials': 'check',
    'c-price': typeof c.contractValue === 'number' && c.contractValue > 0 ? 'found' : 'missing',
    'd-lien': /lien/i.test(terms) && /(subcontract|supplier|material)/i.test(terms) ? 'check' : 'missing',
    'e-escrow': /escrow|bond|letter of credit/i.test(terms) ? 'check' : 'missing',
    // One payment needs no progress schedule; two or more must each say what and how much.
    'f-schedule': schedule.length === 0 ? 'missing' : schedule.length === 1 || schedule.every(milestoneComplete) ? 'found' : 'check',
    'h-cancel': /cancel/i.test(terms) && /(third|3rd|three) business day/i.test(terms) ? 'check' : 'missing',
    'i-insurance': /insurance/i.test(terms) ? 'check' : 'missing',
  };

  const items: NyCheckItem[] = NY_HIC_RULES.map((rule) => {
    const s = status[rule.id];
    const base = LABELS[rule.id];
    const profileField = PROFILE_FIELDS.has(rule.id);
    const noticeHint = NOTICE_HINT_IDS.has(rule.id);
    let detail = base.detail;
    if (profileField && s === 'missing') detail = PROFILE_MISSING;
    else if (noticeHint && s === 'missing') detail = `${base.detail} ${NOTICE_HINT}`;
    else if (NY_NOTICE_IDS.includes(rule.id) && s === 'check') detail = `${base.detail} ${FOUND_WORDING}`;
    else if (rule.id === 'f-schedule' && s === 'check') detail = SCHEDULE_INCOMPLETE;
    return {
      id: rule.id,
      label: base.label,
      status: s,
      detail,
      citation: rule.citation,
      sourceUrl: rule.sourceUrl,
      counselConfirm: rule.counselConfirm,
      profileField,
      noticeHint,
    };
  });

  return {
    items,
    missing: items.filter((i) => i.status === 'missing').length,
    toCheck: items.filter((i) => i.status === 'check').length,
  };
}

/**
 * The sign gate's one number: how many checklist items are missing, or 0 when
 * the checklist does not apply. Only 'missing' counts: a list of items to
 * check never interrupts Sign & send.
 */
export function nyMissingBeforeSign(input: {
  project: Pick<Project, 'structuredAddress' | 'location' | 'type'> | null | undefined;
  contract: NyCheckInput['contract'];
  branding: Partial<CompanyBranding> | null | undefined;
}): number {
  const cents = Math.round((input.contract.contractValue ?? 0) * 100);
  if (nyHomeImprovementApplies({ project: input.project, branding: input.branding, contractValueCents: cents }).applies === 'no') return 0;
  return checkNyHomeImprovementContract({ contract: input.contract, branding: input.branding }).missing;
}
