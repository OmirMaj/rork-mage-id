// lienWaiverForms — the statutory lien-waiver forms for the five states that
// prescribe one, filled from a MAGE ID waiver record.
//
// WHY THIS FILE EXISTS. utils/lienWaiverEngine.ts used to print ONE generic
// waiver for every job, and printed a warning inside its own PDF saying that
// in California, Texas, Florida, Georgia and Arizona that generic form "may
// render the waiver void or unenforceable". It was right. Each of those five
// states writes the words of the waiver into its code, and a release that
// departs from the prescribed wording is the release a court throws out — in
// Georgia the statute says so on the face of the form itself. Shipping a
// document that warns you not to use it is not a feature.
//
// So: where a state prescribes the form, we print THAT state's form, verbatim,
// with the record's values dropped into the statutory blanks. Where it does
// not, we keep the general form and keep the warning.
//
// TWO RULES THAT ARE NOT NEGOTIABLE.
//
//   1. The statutory body is never edited to fit our layout. Every state
//      below prescribes wording; a "cleaned up" paragraph is a departure and a
//      departure is the defect. Fill the blanks, change nothing else. Georgia's
//      own notice paragraph spells out the consequence: omit it and the form is
//      "unenforceable and invalid as a waiver and release".
//
//   2. The document says which statute it follows and as of when, and tells
//      the reader to confirm the current text with counsel. This app cannot
//      know whether a legislature amended a form last session. A silent claim
//      of legal sufficiency would be worse than the honest warning the old
//      generic form printed, because the user would have no reason to check.
//
// STATUTE_TEXT_AS_OF is the date the wording below was last checked against
// the published code. It is printed on every statutory form. Anyone editing a
// form's text must move that date, and scripts/validate-lien-waivers.ts fails
// the build if a required notice goes missing from a form.
//
// Pure module: no React, no network, no storage — so the validator can drive
// it directly under bun.

import type { LienWaiverType } from '@/types';

/** The five states whose codes prescribe the words of a lien waiver. */
export type WaiverStateCode = 'CA' | 'TX' | 'FL' | 'GA' | 'AZ';

export const STATUTORY_WAIVER_STATES: readonly WaiverStateCode[] = ['CA', 'TX', 'FL', 'GA', 'AZ'] as const;

const STATE_NAMES: Record<WaiverStateCode, string> = {
  CA: 'California', TX: 'Texas', FL: 'Florida', GA: 'Georgia', AZ: 'Arizona',
};

/**
 * The date the statutory wording in this file was last read against the
 * published code. Printed on every statutory form, next to the citation, so a
 * sub signing in 2027 can see how old our copy is. Move it when you re-check
 * a form; do not move it because you touched the layout.
 */
export const STATUTE_TEXT_AS_OF = '2026-05-01';

/**
 * The sentence that goes on every statutory form. The point is that we are
 * reproducing a legislature's text, not certifying it — we cannot know about
 * an amendment passed after the date above.
 */
export const STATUTE_VERIFY_LINE =
  'MAGE ID reproduces this form from the statute cited above as published on the "text as of" date shown. '
  + 'Statutes are amended. Confirm the current text with an attorney licensed in this state before relying on this document.';

/**
 * The warning the generic form has always carried, kept for every state that
 * does NOT prescribe a form. Exported so the PDF builder and the guard read
 * the same string.
 */
export const GENERIC_FORM_WARNING =
  'This is a general-form waiver, not a statutory form. California, Texas, Florida, Georgia and Arizona '
  + 'prescribe the wording of a lien waiver by statute, and a form that departs from it may be void or '
  + 'unenforceable in those states. Consult an attorney licensed in your state.';

/** A blank in a statutory form. The form's blanks are part of the form. */
const BLANK = '________________';

function fill(value: string | undefined | null): string {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : BLANK;
}

/** Money renders as the statute writes it: a plain dollar figure in a blank. */
function fillMoney(amount: number | undefined | null): string {
  if (amount == null || !isFinite(amount) || amount <= 0) return BLANK;
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Everything a statutory blank can want. Anything the app does not hold comes
 * through empty and prints as a blank line for the signer to complete — which
 * is what a blank in a statutory form is for. We never invent a value.
 *
 * `amount` is money flowing OUT of the GC to the subcontractor: a cost on the
 * GC's books and the consideration the release is given for.
 */
export interface WaiverFill {
  /** The subcontractor or supplier giving up lien rights. */
  claimantName: string;
  /** Who the claimant contracted with — normally the GC's company. */
  customerName: string;
  /** The property owner. */
  ownerName: string;
  /** The jobsite address. */
  jobLocation: string;
  /** What the claimant furnished ("Electrical rough-in, 1st floor"). */
  jobDescription: string;
  /** Project name, used where a statute asks for the project or job title. */
  projectName: string;
  /**
   * The calendar day the release runs through, ALREADY FORMATTED for print by
   * the caller (utils/lienWaiverDocument.ts uses formatCalendarDay). A day, not
   * an instant, and never re-parsed here: this file only ever drops it into a
   * statutory blank, and a raw 'YYYY-MM-DD' in that blank had the same document
   * naming its release date twice in two different formats.
   */
  throughDate: string;
  /** Amount paid / to be paid, in dollars. */
  amount: number;
  /** Maker of the check, where the statute asks. Normally the GC. */
  checkMaker: string;
  /** Payee of the check, where the statute asks. Normally the claimant. */
  checkPayee: string;
}

/** One rendered piece of a statutory form. */
export type WaiverBlock =
  /** A sub-heading the statute itself prints ("Identifying Information"). */
  | { kind: 'subheading'; text: string }
  /** A paragraph of statutory body text. */
  | { kind: 'para'; text: string }
  /** Statutory all-caps notice. Rendered boxed and bold — Georgia and the
   *  unconditional forms in CA/TX/AZ require it on the face of the document. */
  | { kind: 'notice'; text: string }
  /** Label/value rows the statute lays out as a list of identifying fields. */
  | { kind: 'fields'; rows: { label: string; value: string }[] };

export interface StatutoryWaiverForm {
  state: WaiverStateCode;
  stateName: string;
  /** Statutory heading, verbatim — this is the form's own title. */
  heading: string;
  /** e.g. "Cal. Civ. Code § 8132". Printed on the document. */
  citation: string;
  /** The all-caps notice this form must carry, or '' when it prescribes none.
   *  Also appears inside `blocks`; kept separately so the guard can pin it. */
  notice: string;
  blocks: WaiverBlock[];
  /**
   * Set when the state's code has no form for the conditional/unconditional
   * split the user asked for and we are serving the nearest statutory form
   * instead. Printed on the document — a sub is entitled to know the form is
   * not the one the app's own type picker named.
   */
  substitution?: string;
}

// ─────────────────────────────────────────────────────────────────────
// The notices, as separate constants
//
// Each of these is prescribed text that has to appear on the face of the
// document. Georgia's says outright that leaving it off invalidates the
// waiver; the unconditional forms carry theirs because the whole point of an
// unconditional release is that the signer is warned it binds them whether or
// not the money arrives. scripts/validate-lien-waivers.ts asserts each one
// survives into the form it belongs to.
// ─────────────────────────────────────────────────────────────────────

export const NOTICE_CA_CONDITIONAL =
  'NOTICE: THIS DOCUMENT WAIVES THE CLAIMANT\'S LIEN, STOP PAYMENT NOTICE, AND PAYMENT BOND RIGHTS '
  + 'EFFECTIVE ON RECEIPT OF PAYMENT. A PERSON SHOULD NOT RELY ON THIS DOCUMENT UNLESS SATISFIED THAT '
  + 'THE CLAIMANT HAS RECEIVED PAYMENT.';

export const NOTICE_CA_UNCONDITIONAL =
  'NOTICE TO CLAIMANT: THIS DOCUMENT WAIVES AND RELEASES LIEN, STOP PAYMENT NOTICE, AND PAYMENT BOND '
  + 'RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID FOR GIVING UP THOSE RIGHTS. THIS DOCUMENT '
  + 'IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU HAVE NOT BEEN PAID. IF YOU HAVE NOT BEEN '
  + 'PAID, USE A CONDITIONAL WAIVER AND RELEASE FORM.';

export const NOTICE_TX_UNCONDITIONAL_PROGRESS =
  'NOTICE: THIS DOCUMENT WAIVES RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID FOR GIVING UP '
  + 'THOSE RIGHTS. IT IS PROHIBITED FOR A PERSON TO REQUIRE YOU TO SIGN THIS DOCUMENT IF YOU HAVE NOT BEEN '
  + 'PAID THE PAYMENT AMOUNT SET FORTH BELOW. IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL RELEASE FORM.';

export const NOTICE_TX_UNCONDITIONAL_FINAL =
  'NOTICE: THIS DOCUMENT WAIVES RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID FOR GIVING UP '
  + 'THOSE RIGHTS. THIS DOCUMENT IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU HAVE NOT BEEN PAID. '
  + 'IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL RELEASE FORM.';

export const NOTICE_AZ_UNCONDITIONAL =
  'NOTICE: THIS DOCUMENT WAIVES RIGHTS UNCONDITIONALLY AND STATES THAT YOU HAVE BEEN PAID FOR GIVING UP '
  + 'THOSE RIGHTS. THIS DOCUMENT IS ENFORCEABLE AGAINST YOU IF YOU SIGN IT, EVEN IF YOU HAVE NOT BEEN PAID. '
  + 'IF YOU HAVE NOT BEEN PAID, USE A CONDITIONAL RELEASE FORM.';

/**
 * Georgia's is the one the statute itself defends: the last sentence says that
 * dropping this paragraph renders the waiver unenforceable and invalid. It is
 * the strongest single argument for this whole module, and the first thing the
 * guard checks.
 */
export const NOTICE_GA =
  'NOTICE: WHEN YOU EXECUTE AND SUBMIT THIS DOCUMENT, YOU SHALL BE CONCLUSIVELY DEEMED TO HAVE BEEN PAID '
  + 'IN FULL THE AMOUNT STATED ABOVE, EVEN IF YOU HAVE NOT ACTUALLY RECEIVED SUCH PAYMENT, 60 DAYS AFTER '
  + 'THE DATE STATED ABOVE UNLESS YOU FILE EITHER AN AFFIDAVIT OF NONPAYMENT OR A CLAIM OF LIEN PRIOR TO '
  + 'THE EXPIRATION OF SUCH 60 DAY PERIOD. THE FAILURE TO INCLUDE THIS NOTICE LANGUAGE ON THE FACE OF THE '
  + 'FORM SHALL RENDER THE FORM UNENFORCEABLE AND INVALID AS A WAIVER AND RELEASE UNDER O.C.G.A. CODE '
  + 'SECTION 44-14-366.';

// ─────────────────────────────────────────────────────────────────────
// California — Civ. Code §§ 8132, 8134, 8136, 8138
// ─────────────────────────────────────────────────────────────────────

function caIdentifyingRows(f: WaiverFill, withThroughDate: boolean): { label: string; value: string }[] {
  const rows = [
    { label: 'Name of Claimant', value: fill(f.claimantName) },
    { label: 'Name of Customer', value: fill(f.customerName) },
    { label: 'Job Location', value: fill(f.jobLocation) },
    { label: 'Owner', value: fill(f.ownerName) },
  ];
  // §§ 8132 and 8134 (progress) run through a date; §§ 8136 and 8138 (final)
  // do not — a final release is not bounded by a day.
  if (withThroughDate) rows.push({ label: 'Through Date', value: fill(f.throughDate) });
  return rows;
}

function caCheckRows(f: WaiverFill): { label: string; value: string }[] {
  return [
    { label: 'Maker of Check', value: fill(f.checkMaker) },
    { label: 'Amount of Check', value: `$${fillMoney(f.amount)}` },
    { label: 'Check Payable to', value: fill(f.checkPayee) },
  ];
}

const CA_RELEASE_SCOPE_PROGRESS =
  'This document waives and releases lien, stop payment notice, and payment bond rights the claimant has '
  + 'for labor and service provided, and equipment and material delivered, to the customer on this job through '
  + 'the Through Date of this document. Rights based upon labor or service provided, or equipment or material '
  + 'delivered, pursuant to a written change order that has been fully executed by the parties prior to the date '
  + 'that this document is signed by the claimant, are waived and released by this document, unless listed as an '
  + 'Exception below.';

const CA_RELEASE_SCOPE_FINAL =
  'This document waives and releases lien, stop payment notice, and payment bond rights the claimant has '
  + 'for labor and service provided, and equipment and material delivered, to the customer on this job. Rights '
  + 'based upon labor or service provided, or equipment or material delivered, pursuant to a written change order '
  + 'that has been fully executed by the parties prior to the date that this document is signed by the claimant, '
  + 'are waived and released by this document, unless listed as an Exception below.';

const CA_CONDITION_ON_CHECK =
  'This document is effective only on the claimant\'s receipt of payment from the financial institution on '
  + 'which the following check is drawn:';

function formCA8132(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'CA', stateName: 'California',
    heading: 'CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    citation: 'Cal. Civ. Code § 8132',
    notice: NOTICE_CA_CONDITIONAL,
    blocks: [
      { kind: 'notice', text: NOTICE_CA_CONDITIONAL },
      { kind: 'subheading', text: 'Identifying Information' },
      { kind: 'fields', rows: caIdentifyingRows(f, true) },
      { kind: 'subheading', text: 'Conditional Waiver and Release' },
      { kind: 'para', text: `${CA_RELEASE_SCOPE_PROGRESS} ${CA_CONDITION_ON_CHECK}` },
      { kind: 'fields', rows: caCheckRows(f) },
      { kind: 'subheading', text: 'Exceptions' },
      { kind: 'para', text: 'This document does not affect any of the following:' },
      { kind: 'para', text: '(1) Retentions.' },
      { kind: 'para', text: '(2) Extras for which the claimant has not received payment.' },
      {
        kind: 'para',
        text: '(3) The following progress payments for which the claimant has previously given a conditional '
          + `waiver and release but has not received payment: Date(s) of waiver and release ${BLANK} `
          + `Amount(s) of unpaid progress payment(s) $${BLANK}`,
      },
      {
        kind: 'para',
        text: '(4) Contract rights, including (A) a right based on rescission, abandonment, or breach of contract, '
          + 'and (B) the right to recover compensation for work not compensated by the payment.',
      },
    ],
  };
}

function formCA8134(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'CA', stateName: 'California',
    heading: 'UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    citation: 'Cal. Civ. Code § 8134',
    notice: NOTICE_CA_UNCONDITIONAL,
    blocks: [
      { kind: 'notice', text: NOTICE_CA_UNCONDITIONAL },
      { kind: 'subheading', text: 'Identifying Information' },
      { kind: 'fields', rows: caIdentifyingRows(f, true) },
      { kind: 'subheading', text: 'Unconditional Waiver and Release' },
      {
        kind: 'para',
        text: `${CA_RELEASE_SCOPE_PROGRESS} The claimant has received the following progress payment: $${fillMoney(f.amount)}`,
      },
      { kind: 'subheading', text: 'Exceptions' },
      { kind: 'para', text: 'This document does not affect any of the following:' },
      { kind: 'para', text: '(1) Retentions.' },
      { kind: 'para', text: '(2) Extras for which the claimant has not received payment.' },
      {
        kind: 'para',
        text: '(3) Contract rights, including (A) a right based on rescission, abandonment, or breach of contract, '
          + 'and (B) the right to recover compensation for work not compensated by the payment.',
      },
    ],
  };
}

function formCA8136(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'CA', stateName: 'California',
    heading: 'CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    citation: 'Cal. Civ. Code § 8136',
    notice: NOTICE_CA_CONDITIONAL,
    blocks: [
      { kind: 'notice', text: NOTICE_CA_CONDITIONAL },
      { kind: 'subheading', text: 'Identifying Information' },
      { kind: 'fields', rows: caIdentifyingRows(f, false) },
      { kind: 'subheading', text: 'Conditional Waiver and Release' },
      { kind: 'para', text: `${CA_RELEASE_SCOPE_FINAL} ${CA_CONDITION_ON_CHECK}` },
      { kind: 'fields', rows: caCheckRows(f) },
      { kind: 'subheading', text: 'Exceptions' },
      { kind: 'para', text: `This document does not affect any of the following: Disputed claims for extras in the amount of $${BLANK}` },
    ],
  };
}

function formCA8138(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'CA', stateName: 'California',
    heading: 'UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    citation: 'Cal. Civ. Code § 8138',
    notice: NOTICE_CA_UNCONDITIONAL,
    blocks: [
      { kind: 'notice', text: NOTICE_CA_UNCONDITIONAL },
      { kind: 'subheading', text: 'Identifying Information' },
      { kind: 'fields', rows: caIdentifyingRows(f, false) },
      { kind: 'subheading', text: 'Unconditional Waiver and Release' },
      { kind: 'para', text: `${CA_RELEASE_SCOPE_FINAL} The claimant has been paid in full.` },
      { kind: 'subheading', text: 'Exceptions' },
      { kind: 'para', text: `This document does not affect the following: Disputed claims for extras in the amount of $${BLANK}` },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Texas — Prop. Code § 53.284 (four forms)
// ─────────────────────────────────────────────────────────────────────

const TX_RIGHTS_RELEASED =
  'any mechanic\'s lien right, any right arising from a payment bond that complies with a state or federal '
  + 'statute, any common law payment bond right, any claim for payment, and any rights under any similar '
  + 'ordinance, rule, or statute related to claim or payment rights for persons in the signer\'s position';

const TX_PROGRESS_COVERAGE =
  'This release covers a progress payment for all labor, services, equipment, or materials furnished to the '
  + 'property or to {customer} as indicated in the attached statement(s) or progress payment request(s), except '
  + 'for unpaid retention, pending modifications and changes, or other items furnished.';

const TX_VERIFY_LINE =
  'Before any recipient of this document relies on this document, the recipient should verify evidence of '
  + 'payment to the signer.';

function txWarranty(kind: 'progress' | 'final'): string {
  return 'The signer warrants that the signer has already paid or will use the funds received from this '
    + `${kind} payment to promptly pay in full all of the signer's laborers, subcontractors, materialmen, and `
    + 'suppliers for all work, materials, equipment, or services provided for or to the above referenced project '
    + `in regard to the attached statement(s) or ${kind} payment request(s).`;
}

function txProjectRows(f: WaiverFill): { label: string; value: string }[] {
  return [
    { label: 'Project', value: fill(f.projectName) },
    { label: 'Job No.', value: BLANK },
  ];
}

function formTXConditionalProgress(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'TX', stateName: 'Texas',
    heading: 'CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    citation: 'Tex. Prop. Code § 53.284',
    notice: '',
    blocks: [
      { kind: 'fields', rows: txProjectRows(f) },
      {
        kind: 'para',
        text: `On receipt by the signer of this document of a check from ${fill(f.checkMaker)} (maker of check) in `
          + `the sum of $${fillMoney(f.amount)} payable to ${fill(f.checkPayee)} (payee or payees of check) and when `
          + 'the check has been properly endorsed and has been paid by the bank on which it is drawn, this document '
          + `becomes effective to release ${TX_RIGHTS_RELEASED} that the signer has on the property of `
          + `${fill(f.ownerName)} (owner) located at ${fill(f.jobLocation)} (location) to the following extent: `
          + `${fill(f.jobDescription)} (job description).`,
      },
      { kind: 'para', text: TX_PROGRESS_COVERAGE.replace('{customer}', `${fill(f.customerName)} (person with whom signer contracted)`) },
      { kind: 'para', text: TX_VERIFY_LINE },
      { kind: 'para', text: txWarranty('progress') },
    ],
  };
}

function formTXUnconditionalProgress(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'TX', stateName: 'Texas',
    heading: 'UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    citation: 'Tex. Prop. Code § 53.284',
    notice: NOTICE_TX_UNCONDITIONAL_PROGRESS,
    blocks: [
      { kind: 'fields', rows: txProjectRows(f) },
      { kind: 'notice', text: NOTICE_TX_UNCONDITIONAL_PROGRESS },
      {
        kind: 'para',
        text: `The signer of this document has been paid and has received a progress payment in the sum of `
          + `$${fillMoney(f.amount)} for all labor, services, equipment, or materials furnished to the property or to `
          + `${fill(f.customerName)} (person with whom signer contracted) on the property of ${fill(f.ownerName)} `
          + `(owner) located at ${fill(f.jobLocation)} (location) to the following extent: ${fill(f.jobDescription)} `
          + `(job description). The signer therefore waives and releases ${TX_RIGHTS_RELEASED} that the signer has on `
          + 'the above referenced project to the following extent:',
      },
      { kind: 'para', text: TX_PROGRESS_COVERAGE.replace('{customer}', `${fill(f.customerName)} (person with whom signer contracted)`) },
      { kind: 'para', text: txWarranty('progress') },
    ],
  };
}

function formTXConditionalFinal(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'TX', stateName: 'Texas',
    heading: 'CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    citation: 'Tex. Prop. Code § 53.284',
    notice: '',
    blocks: [
      { kind: 'fields', rows: txProjectRows(f) },
      {
        kind: 'para',
        text: `On receipt by the signer of this document of a check from ${fill(f.checkMaker)} (maker of check) in `
          + `the sum of $${fillMoney(f.amount)} payable to ${fill(f.checkPayee)} (payee or payees of check) and when `
          + 'the check has been properly endorsed and has been paid by the bank on which it is drawn, this document '
          + `becomes effective to release ${TX_RIGHTS_RELEASED} that the signer has on the property of `
          + `${fill(f.ownerName)} (owner) located at ${fill(f.jobLocation)} (location) to the following extent: `
          + `${fill(f.jobDescription)} (job description).`,
      },
      {
        kind: 'para',
        text: 'This release covers the final payment to the signer for all labor, services, equipment, or materials '
          + `furnished to the property or to ${fill(f.customerName)} (person with whom signer contracted).`,
      },
      { kind: 'para', text: TX_VERIFY_LINE },
      { kind: 'para', text: txWarranty('final') },
    ],
  };
}

function formTXUnconditionalFinal(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'TX', stateName: 'Texas',
    heading: 'UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    citation: 'Tex. Prop. Code § 53.284',
    notice: NOTICE_TX_UNCONDITIONAL_FINAL,
    blocks: [
      { kind: 'fields', rows: txProjectRows(f) },
      { kind: 'notice', text: NOTICE_TX_UNCONDITIONAL_FINAL },
      {
        kind: 'para',
        text: 'The signer of this document has been paid in full for all labor, services, equipment, or materials '
          + `furnished to the property or to ${fill(f.customerName)} (person with whom signer contracted) on the `
          + `property of ${fill(f.ownerName)} (owner) located at ${fill(f.jobLocation)} (location) to the following `
          + `extent: ${fill(f.jobDescription)} (job description). The signer therefore waives and releases `
          + `${TX_RIGHTS_RELEASED} that the signer has on the owner's property.`,
      },
      { kind: 'para', text: txWarranty('final') },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Florida — Stat. § 713.20
//
// Florida prescribes exactly TWO forms: one on progress payment, one on final
// payment. It does not publish a conditional variant. Rather than invent one —
// which is precisely the departure that voids a waiver — we print the
// statutory form unchanged and say on the document that Florida has no
// conditional statutory form, so a conditional release is this same form held
// until the check clears. `substitution` carries that sentence.
// ─────────────────────────────────────────────────────────────────────

const FL_NO_CONDITIONAL_FORM =
  'Florida Statutes § 713.20 prescribes only the progress-payment and final-payment forms; it publishes no '
  + 'conditional variant. This is the statutory form, unaltered. To make the release conditional, deliver it '
  + 'only after the payment has cleared — do not edit the wording above.';

function formFLProgress(f: WaiverFill, conditionalRequested: boolean): StatutoryWaiverForm {
  return {
    state: 'FL', stateName: 'Florida',
    heading: 'WAIVER AND RELEASE OF LIEN UPON PROGRESS PAYMENT',
    citation: 'Fla. Stat. § 713.20',
    notice: '',
    substitution: conditionalRequested ? FL_NO_CONDITIONAL_FORM : undefined,
    blocks: [
      {
        kind: 'para',
        text: `The undersigned lienor, in consideration of the sum of $${fillMoney(f.amount)}, hereby waives and `
          + 'releases its lien and right to claim a lien for labor, services, or materials furnished through '
          + `${fill(f.throughDate)} to ${fill(f.customerName)} on the job of ${fill(f.ownerName)} to the following `
          + 'described property:',
      },
      { kind: 'para', text: fill(f.jobLocation) },
      {
        kind: 'para',
        text: 'This waiver and release does not cover any retention or labor, services, or materials furnished '
          + 'after the date specified.',
      },
    ],
  };
}

function formFLFinal(f: WaiverFill, conditionalRequested: boolean): StatutoryWaiverForm {
  return {
    state: 'FL', stateName: 'Florida',
    heading: 'WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT',
    citation: 'Fla. Stat. § 713.20',
    notice: '',
    substitution: conditionalRequested ? FL_NO_CONDITIONAL_FORM : undefined,
    blocks: [
      {
        kind: 'para',
        text: `The undersigned lienor, in consideration of the final payment in the amount of $${fillMoney(f.amount)}, `
          + 'hereby waives and releases its lien and right to claim a lien for labor, services, or materials furnished '
          + `to ${fill(f.customerName)} on the job of ${fill(f.ownerName)} to the following described property:`,
      },
      { kind: 'para', text: fill(f.jobLocation) },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Georgia — O.C.G.A. § 44-14-366
//
// Georgia has an interim form and a final form and no conditional/
// unconditional split at all: every Georgia waiver is "upon receipt of the sum
// of $X", with the 60-day affidavit-of-nonpayment backstop the notice
// describes. So a MAGE ID "conditional" and "unconditional" progress waiver
// both resolve to the interim form, and the document says so.
// ─────────────────────────────────────────────────────────────────────

const GA_NO_CONDITIONAL_SPLIT =
  'Georgia prescribes an interim form and a final form and no conditional/unconditional variants. This is the '
  + 'statutory form for the payment stage selected. Under O.C.G.A. § 44-14-366 the signer is deemed paid 60 days '
  + 'after the date below unless an affidavit of nonpayment or a claim of lien is filed first — see the notice.';

function gaEmploymentBlock(f: WaiverFill): WaiverBlock {
  return {
    kind: 'para',
    text: `The undersigned mechanic and/or materialman has been employed by ${fill(f.customerName)} (name of `
      + `contractor) to furnish ${fill(f.jobDescription)} (describe materials and/or labor) for the construction of `
      + `improvements known as ${fill(f.projectName)} (title of the project or building) which is located at `
      + `${fill(f.jobLocation)} and is owned by ${fill(f.ownerName)} (name of owner) and more particularly described `
      + 'as follows:',
  };
}

function formGAInterim(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'GA', stateName: 'Georgia',
    heading: 'INTERIM WAIVER AND RELEASE UPON PAYMENT',
    citation: 'O.C.G.A. § 44-14-366',
    notice: NOTICE_GA,
    substitution: GA_NO_CONDITIONAL_SPLIT,
    blocks: [
      { kind: 'fields', rows: [{ label: 'State of Georgia, County of', value: BLANK }] },
      gaEmploymentBlock(f),
      { kind: 'para', text: fill(f.jobLocation) },
      {
        kind: 'para',
        text: `Upon the receipt of the sum of $${fillMoney(f.amount)}, the mechanic and/or materialman waives and `
          + 'releases any and all liens or claims of liens or any right against any labor and/or material bond that '
          + 'the undersigned has upon the foregoing described property or any rights against any labor and/or material '
          + `bond through the date of ${fill(f.throughDate)} and excepting those rights and liens that the mechanic `
          + 'and/or materialman might have in any retained amounts, on account of labor or materials, or both, '
          + 'furnished by the undersigned to or on account of said contractor for said building or premises.',
      },
      { kind: 'notice', text: NOTICE_GA },
    ],
  };
}

function formGAFinal(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'GA', stateName: 'Georgia',
    heading: 'WAIVER AND RELEASE UPON FINAL PAYMENT',
    citation: 'O.C.G.A. § 44-14-366',
    notice: NOTICE_GA,
    substitution: GA_NO_CONDITIONAL_SPLIT,
    blocks: [
      { kind: 'fields', rows: [{ label: 'State of Georgia, County of', value: BLANK }] },
      gaEmploymentBlock(f),
      { kind: 'para', text: fill(f.jobLocation) },
      {
        kind: 'para',
        text: `Upon the receipt of the sum of $${fillMoney(f.amount)}, the mechanic and/or materialman waives and `
          + 'releases any and all liens or claims of liens or any right against any labor and/or material bond the '
          + 'undersigned has upon the foregoing described property or any rights against any labor and/or material bond.',
      },
      { kind: 'notice', text: NOTICE_GA },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Arizona — A.R.S. § 33-1008 (four forms)
// ─────────────────────────────────────────────────────────────────────

const AZ_RIGHTS_RELEASED =
  'any mechanic\'s lien, any state or federal statutory bond right, any private bond right, any claim for '
  + 'payment and any rights under any similar ordinance, rule or statute related to claim or payment rights for '
  + 'persons in the signer\'s position';

const AZ_PROGRESS_COVERAGE =
  'This release covers a progress payment for all labor, services, equipment or materials furnished to the '
  + 'property or to {customer} as indicated in the attached statement(s) or progress payment request(s), except '
  + 'for the retention, pending modifications and changes or other items furnished.';

const AZ_VERIFY_LINE =
  'Before any recipient of this document relies on it, that person should verify evidence of payment to the signer.';

function azWarranty(kind: 'progress' | 'final'): string {
  return 'The signer warrants that the signer has already paid or will use the funds received from this '
    + `${kind} payment to promptly pay in full all of the signer's laborers, subcontractors, materialmen and `
    + 'suppliers for all work, materials, equipment or services provided for or to the above referenced project in '
    + `regard to the attached statement(s) or ${kind} payment request(s).`;
}

function azProjectRows(f: WaiverFill): { label: string; value: string }[] {
  return [
    { label: 'Project', value: fill(f.projectName) },
    { label: 'Job No.', value: BLANK },
  ];
}

function formAZConditionalProgress(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'AZ', stateName: 'Arizona',
    heading: 'CONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    citation: 'A.R.S. § 33-1008',
    notice: '',
    blocks: [
      { kind: 'fields', rows: azProjectRows(f) },
      {
        kind: 'para',
        text: `On receipt by the signer of this document of a check from ${fill(f.checkMaker)} (maker of check) in `
          + `the sum of $${fillMoney(f.amount)} payable to ${fill(f.checkPayee)} (payee or payees of check) and when `
          + 'the check has been properly endorsed and has been paid by the bank on which it is drawn, this document '
          + `becomes effective to release ${AZ_RIGHTS_RELEASED} that the signer has on the property of `
          + `${fill(f.ownerName)} (owner) located at ${fill(f.jobLocation)} (location) to the following extent:`,
      },
      { kind: 'para', text: AZ_PROGRESS_COVERAGE.replace('{customer}', `${fill(f.customerName)} (person with whom signer contracted)`) },
      { kind: 'para', text: AZ_VERIFY_LINE },
      { kind: 'para', text: azWarranty('progress') },
    ],
  };
}

function formAZUnconditionalProgress(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'AZ', stateName: 'Arizona',
    heading: 'UNCONDITIONAL WAIVER AND RELEASE ON PROGRESS PAYMENT',
    citation: 'A.R.S. § 33-1008',
    notice: NOTICE_AZ_UNCONDITIONAL,
    blocks: [
      { kind: 'fields', rows: azProjectRows(f) },
      { kind: 'notice', text: NOTICE_AZ_UNCONDITIONAL },
      {
        kind: 'para',
        text: 'The signer of this document has been paid and has received a progress payment in the sum of '
          + `$${fillMoney(f.amount)} for all labor, services, equipment or materials furnished to the property or to `
          + `${fill(f.customerName)} (person with whom signer contracted) on the property of ${fill(f.ownerName)} `
          + `(owner) located at ${fill(f.jobLocation)} (location) to the following extent:`,
      },
      { kind: 'para', text: AZ_PROGRESS_COVERAGE.replace('{customer}', `${fill(f.customerName)} (person with whom signer contracted)`) },
      { kind: 'para', text: azWarranty('progress') },
    ],
  };
}

function formAZConditionalFinal(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'AZ', stateName: 'Arizona',
    heading: 'CONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    citation: 'A.R.S. § 33-1008',
    notice: '',
    blocks: [
      { kind: 'fields', rows: azProjectRows(f) },
      {
        kind: 'para',
        text: `On receipt by the signer of this document of a check from ${fill(f.checkMaker)} (maker of check) in `
          + `the sum of $${fillMoney(f.amount)} payable to ${fill(f.checkPayee)} (payee or payees of check) and when `
          + 'the check has been properly endorsed and has been paid by the bank on which it is drawn, this document '
          + `becomes effective to release ${AZ_RIGHTS_RELEASED} that the signer has on the property of `
          + `${fill(f.ownerName)} (owner) located at ${fill(f.jobLocation)} (location) to the following extent:`,
      },
      {
        kind: 'para',
        text: 'This release covers the final payment to the signer for all labor, services, equipment or materials '
          + `furnished to the property or to ${fill(f.customerName)} (person with whom signer contracted).`,
      },
      { kind: 'para', text: AZ_VERIFY_LINE },
      { kind: 'para', text: azWarranty('final') },
    ],
  };
}

function formAZUnconditionalFinal(f: WaiverFill): StatutoryWaiverForm {
  return {
    state: 'AZ', stateName: 'Arizona',
    heading: 'UNCONDITIONAL WAIVER AND RELEASE ON FINAL PAYMENT',
    citation: 'A.R.S. § 33-1008',
    notice: NOTICE_AZ_UNCONDITIONAL,
    blocks: [
      { kind: 'fields', rows: azProjectRows(f) },
      { kind: 'notice', text: NOTICE_AZ_UNCONDITIONAL },
      {
        kind: 'para',
        text: 'The signer has been paid in full for all labor, services, equipment or materials furnished to the '
          + `property or to ${fill(f.customerName)} (person with whom signer contracted) on the property of `
          + `${fill(f.ownerName)} (owner) located at ${fill(f.jobLocation)} (location) and does hereby waive and `
          + `release ${AZ_RIGHTS_RELEASED}.`,
      },
      { kind: 'para', text: azWarranty('final') },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lookup
// ─────────────────────────────────────────────────────────────────────

/**
 * The statutory form for this state and waiver type, or null when the state
 * does not prescribe one — in which case the caller prints the general form
 * and keeps GENERIC_FORM_WARNING on it.
 *
 * `state` is a two-letter code; anything else (including an unresolvable
 * jobsite address) returns null rather than guessing a state's form onto a job
 * in some other state.
 */
export function statutoryFormFor(
  state: string | null | undefined,
  waiverType: LienWaiverType,
  fillValues: WaiverFill,
): StatutoryWaiverForm | null {
  const code = (state ?? '').trim().toUpperCase();
  if (!isStatutoryWaiverState(code)) return null;

  const isFinal = waiverType === 'conditional_final' || waiverType === 'unconditional_final';
  const isConditional = waiverType === 'conditional_partial' || waiverType === 'conditional_final';

  switch (code) {
    case 'CA':
      return isFinal
        ? (isConditional ? formCA8136(fillValues) : formCA8138(fillValues))
        : (isConditional ? formCA8132(fillValues) : formCA8134(fillValues));
    case 'TX':
      return isFinal
        ? (isConditional ? formTXConditionalFinal(fillValues) : formTXUnconditionalFinal(fillValues))
        : (isConditional ? formTXConditionalProgress(fillValues) : formTXUnconditionalProgress(fillValues));
    case 'AZ':
      return isFinal
        ? (isConditional ? formAZConditionalFinal(fillValues) : formAZUnconditionalFinal(fillValues))
        : (isConditional ? formAZConditionalProgress(fillValues) : formAZUnconditionalProgress(fillValues));
    case 'FL':
      return isFinal ? formFLFinal(fillValues, isConditional) : formFLProgress(fillValues, isConditional);
    case 'GA':
      return isFinal ? formGAFinal(fillValues) : formGAInterim(fillValues);
  }
}

export function isStatutoryWaiverState(state: string | null | undefined): state is WaiverStateCode {
  const code = (state ?? '').trim().toUpperCase();
  return (STATUTORY_WAIVER_STATES as readonly string[]).includes(code);
}

/**
 * "California" for anything that means CA.
 *
 * TOTAL on purpose, and normalising on purpose. `isStatutoryWaiverState`
 * uppercases before it compares, so it says `true` for the 'ca' a GC typed into
 * the project's address form — while a bare `STATE_NAMES[state]` lookup on that
 * same value returned undefined and the Lien Waivers banner rendered the words
 * "This jobsite is in undefined." Unknown input comes back as the trimmed,
 * uppercased code rather than as nothing, because a two-letter code on screen
 * is still a fact and `undefined` never is.
 */
export function statutoryStateName(state: string | null | undefined): string {
  const code = (state ?? '').trim().toUpperCase();
  return isStatutoryWaiverState(code) ? STATE_NAMES[code] : code;
}
