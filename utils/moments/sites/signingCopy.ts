// signingCopy.ts: every word the signing moments say (wave-next W2, lane MOMSIGN).
//
// The sites: the contract's GC sign & send and "sign together now"
// (app/contract.tsx SignatureModal), the client signing in person on this
// phone (the hand-off turn and the ceremony), the paper signature and the
// seal slide (same file), the field ticket signature (app/field-ticket.tsx)
// and the change order approval a client signs on the client view
// (app/client-view.tsx).
//
// THE MOMENT-COPY RULE (docs/I18N.md §3.5, scripts/moments-checks/rules.ts R3/R4):
//   - One exported function per sentence, returning ONE whole sentence (or one
//     whole label). Data (a name, a CO number, an amount already formatted
//     with cents, a date label) enters only as a placeholder argument; never a
//     verb, a noun or a subject phrase passed into a frame.
//   - The screens pass these as writeOptions.copy.refused / timeout /
//     legalQueued, as the ceremony's labels and as the confirmed title /
//     detail / next. They never inline a moment string and never join two of
//     these with `+` or inside a template.
//   - W3 lane ESTICKET translates the field ticket functions sentence by
//     sentence. ticketAttestation() is LEGAL text: it stays English (W3 keys
//     it as field.ticket.legal.attestation with no Spanish).
//   - docs/VOICE.md: sentence case, no exclamation marks, no em dash, never a
//     pronoun for a user ("they" for a client), project not job, client not
//     homeowner in the contractor's chrome. On the contract document the
//     parties are "Contractor" and "Owner" (VOICE §10), the labels the
//     contract PDF prints on its signature blocks.
//   - VOICE §8: the contract signing is the one celebratory moment. The seal
//     may celebrate; these words stay plain and specific.
//
// Pure: its one import (i18n/core, itself pure) reads the language at call
// time, so bun loads this too. scripts/moments-checks/signing-sites.ts calls
// every export. The field-ticket functions (A5) are keyed field.ticket.*
// (W3 lane ESTICKET); the contract and client-view functions stay English
// until Phase 2/3.

import { t } from '@/i18n/core';

// ─────────────────────────────────────────────────────────────────────────────
// Shared: the contract on the ceremony's top panel
// ─────────────────────────────────────────────────────────────────────────────

/** The document title on the ceremony: the contract's own title, else this. */
export function contractDocTitle(title: string): string {
  const t = title.trim();
  return t || 'Construction contract';
}

/** Top panel row label: the contract value (the value itself always carries cents). */
export function contractValueRowLabel(): string {
  return 'Contract value';
}

/** Top panel row label: the timeline. */
export function contractTimelineRowLabel(): string {
  return 'Timeline';
}

/** Top panel row value: "Oct 1, 2026 to Dec 15, 2026". Both dates come in already formatted. */
export function contractTimelineValue(startLabel: string, completionLabel: string): string {
  return `${startLabel} to ${completionLabel}`;
}

/** "Kitchen remodel · $84,500.00": the project and the contract value (cents), one specific line. */
export function contractSummaryLine(projectName: string, amount: string): string {
  return `${projectName} · ${amount}`;
}

/** The disabled reason when the payment schedule is empty (a blocked control says why). */
export function contractTermsReason(): string {
  return 'Set your payment terms before signing.';
}

/** The disabled reason when the warranty section has no period yet. */
export function contractWarrantyReason(): string {
  return 'Set your warranty period before signing.';
}

/** The outcome for a contract that answered neither yes nor no in time. */
export function contractTimeout(): string {
  return 'No answer yet. Check the contract before trying again.';
}

// ─────────────────────────────────────────────────────────────────────────────
// A1: the contractor signs and sends (or signs first, to sign together now)
// ─────────────────────────────────────────────────────────────────────────────

/** The name field's label on the contractor's ceremony. */
export function contractGcNameLabel(): string {
  return 'Your full legal name';
}

/** The slide label: sign and send. */
export function contractSignSendLabel(): string {
  return 'Slide along the line to sign and send';
}

/** The slide label when the client signs next on this phone (nothing is emailed). */
export function contractSignFirstLabel(): string {
  return 'Slide along the line to sign';
}

/** Screen reader: the line as one button (sign and send). */
export function contractSignSendSrLabel(): string {
  return 'Sign and send the contract';
}

/** Screen reader: the confirm segment (sign and send). */
export function contractSignSendSrConfirm(): string {
  return 'Confirm sign and send';
}

/** Screen reader: the line as one button (sign first, client next). */
export function contractSignFirstSrLabel(): string {
  return 'Sign the contract';
}

/** Screen reader: the confirm segment (sign first). */
export function contractSignFirstSrConfirm(): string {
  return 'Confirm your signature';
}

/** Announced when the seal lands on the contractor's signature (the email result is announced by the fold). */
export function contractGcSealedAnnounce(): string {
  return 'Your signature is on the contract.';
}

/** Confirmed, and the email went out: the result title and the fold's back face title. */
export function contractSentTitle(clientName: string): string {
  return `Signed and sent to ${clientName}`;
}

/** Confirmed and sent, when no client name is on file. */
export function contractSentTitleNoName(): string {
  return 'Signed and sent to your client';
}

/** The back face under "Signed and sent": what happens next. */
export function contractSentBody(): string {
  return 'They counter-sign from their portal link. The contract is binding when they sign.';
}

/** Announced when the fold lands and the email went out. */
export function contractSentAnnounce(clientName: string): string {
  return `Contract signed and sent to ${clientName}.`;
}

/** Announced when the fold lands and the email went out, no client name on file. */
export function contractSentAnnounceNoName(): string {
  return 'Contract signed and sent to your client.';
}

/** Confirmed, but the email did not go out: the result title and the back face title. Never "sent". */
export function contractNotSentTitle(): string {
  return 'Signed. Not sent yet.';
}

/** The back face line when the email service did not accept the email. */
export function contractNotSentEmailFailed(): string {
  return 'The email did not go out. Copy the signing link and share it with your client.';
}

/** The back face line when a collaborator (not the project owner) signed: the owner holds the signing link. */
export function contractNotSentCollaborator(): string {
  return "Only the project owner holds this portal's signing link, so nothing was emailed. Ask them to share it from the client portal.";
}

/** The back face line when no client email is on file. */
export function contractNotSentNoEmail(): string {
  return 'No client email on file. Share the portal link so the client can sign.';
}

/** The back face line when the portal has no signing key yet. */
export function contractNotSentNoSigningKey(): string {
  return 'This portal has no secure signing key yet, so nothing was emailed. Open Client portal, tap Save, then share the link from there.';
}

/** The back face line when the client portal is off. */
export function contractNotSentPortalOff(): string {
  return 'The client portal is off, so nothing was emailed. Turn it on in Client portal so the client can sign.';
}

/** The back face's "To" row when no email is on file. */
export function contractNoEmailOnFile(): string {
  return 'No email on file';
}

/** Confirmed when the contractor signed first and the client signs next on this phone. */
export function contractSignedFirstTitle(): string {
  return 'Signed by you';
}

/** What happens next after signing first. */
export function contractSignedFirstNext(): string {
  return 'Next, your client signs on this phone.';
}

/** Refused: a second contract would have been created. The sheet shows the one on file once closed. */
export function contractDuplicate(): string {
  return 'Not signed. This project already has a contract. Close this to see it.';
}

/** Refused: the save or the status write said no. */
export function contractRefused(): string {
  return 'Not signed. Something went wrong on our side. Your signature is kept.';
}

/** A legal write answered "queued" (it never can): nothing was signed. */
export function contractLegalQueued(): string {
  return 'Not signed. Signing needs a connection, so nothing was signed.';
}

// ─────────────────────────────────────────────────────────────────────────────
// A2: the client signs in person on this phone (the hand-off turn)
// ─────────────────────────────────────────────────────────────────────────────

/** The hand-off card, with the client's name. */
export function handoffBody(clientName: string): string {
  return `Hand the phone to ${clientName}. They review, agree and sign themselves. You can't sign for them.`;
}

/** The hand-off card when no client name is on file. */
export function handoffBodyNoName(): string {
  return "Hand the phone to your client. They review, agree and sign themselves. You can't sign for them.";
}

/** The hand-off button, with the client's first name. */
export function handoffButton(firstName: string): string {
  return `Hand to ${firstName}`;
}

/** The hand-off button when no client name is on file. */
export function handoffButtonNoName(): string {
  return 'Hand the phone over';
}

/** Announced when the card turns to face the client. */
export function handoffTurnAnnounce(): string {
  return 'Review the contract, then sign on the line.';
}

/** The name field's label on the client's ceremony (the client reads it). */
export function inPersonNameLabel(): string {
  return 'Your full legal name';
}

/** The client's slide label. */
export function inPersonLabel(): string {
  return 'Slide along the line to sign';
}

/** Screen reader: the line as one button. */
export function inPersonSrLabel(): string {
  return 'Sign the contract';
}

/** Screen reader: the confirm segment. */
export function inPersonSrConfirm(): string {
  return 'Confirm your signature';
}

/** Announced when the seal lands: the one celebratory moment, in plain words. */
export function inPersonSealedAnnounce(): string {
  return 'Signed. The contract is binding.';
}

/** Confirmed: the client's signature closed the contract. */
export function inPersonSignedTitle(): string {
  return 'Signed. The contract is binding.';
}

/** Confirmed, neutral: the contract was already signed elsewhere, so this signature was not stored. */
export function alreadySignedTitle(): string {
  return 'Already signed on the portal or another phone. Nothing was changed.';
}

/** Refused: the contract is still a draft (one whole sentence per state, never a status word in a frame). */
export function recordNotSentDraft(): string {
  return 'Not recorded. This contract is still a draft, not sent.';
}

/** Refused: the contract was voided. */
export function recordNotSentVoid(): string {
  return 'Not recorded. This contract was voided, so nothing was changed.';
}

/** Paper, refused: the client already signed on the portal or another phone, so this paper record was not stored. */
export function paperAlreadySigned(): string {
  return 'Not recorded. The client already signed on the portal or another phone, so nothing was changed.';
}

/** Refused: the contract is no longer on file. */
export function recordNotOnFile(): string {
  return 'Not recorded. This contract is no longer on file.';
}

/** Refused: the server said no. */
export function recordRefused(): string {
  return 'Not recorded. Something went wrong on our side. The contract is still sent.';
}

/** A legal write answered "queued" (it never can). */
export function recordLegalQueued(): string {
  return 'Not recorded. Signing needs a connection, so nothing was recorded.';
}

/** The hand-back button, with the contractor's first name. */
export function handBackButton(gcFirstName: string): string {
  return `Done. Hand the phone back to ${gcFirstName}`;
}

/** The hand-back button when the contractor's name is unknown. */
export function handBackButtonNoName(): string {
  return 'Done. Hand the phone back to your contractor';
}

/** Announced when the card turns back to the contractor. */
export function handBackAnnounce(): string {
  return 'The contract is back with you.';
}

/** The contractor's record card after the turn back. */
export function recordCardTitle(): string {
  return 'Client signature recorded';
}

/** The contractor's record card after "sign together now". */
export function recordCardTogetherTitle(): string {
  return 'Signed by both of you';
}

/** The record card's line: who signed, in person. */
export function recordCardSignedBy(clientName: string): string {
  return `Signed in person by ${clientName}`;
}

/** The record card's line when the contract was already signed elsewhere. */
export function recordCardAlreadySigned(): string {
  return 'Your client had already signed. The contract shows who signed and when.';
}

/** The record card while the signed PDF is being sealed. */
export function autoSealRunning(): string {
  return 'Sealing the signed PDF…';
}

/** The seal evidence, printed only after the seal returned a real hash. */
export function sealEvidence(hash12: string): string {
  return `SEALED · ${hash12}`;
}

/** The record card when the automatic seal did not finish. */
export function autoSealFailed(): string {
  return 'The signed PDF is not sealed yet. Seal it from the contract page.';
}

/** The record card's close button. */
export function recordCardDone(): string {
  return 'Done';
}

// ─────────────────────────────────────────────────────────────────────────────
// A3: a paper signature (no ceremony)
// ─────────────────────────────────────────────────────────────────────────────

/** The slide label. */
export function paperLabel(): string {
  return 'Slide to record paper signature';
}

/** The busy label. */
export function paperBusyLabel(): string {
  return 'Recording…';
}

/** Screen reader: the track as one button. */
export function paperSrLabel(): string {
  return 'Record the paper signature';
}

/** Screen reader: the confirm segment. */
export function paperSrConfirm(): string {
  return 'Confirm paper signature';
}

/** The disabled reason offline (recording needs the live row). */
export function paperOffline(): string {
  return "You're offline. Recording needs a connection.";
}

/** Refused before anything was written: the page photo did not upload. */
export function paperUploadRefused(): string {
  return 'Not recorded. The page photo did not upload, so nothing was saved.';
}

/** Confirmed: the neutral pill. */
export function paperRecordedTitle(): string {
  return 'Recorded · paper signature, photo on file';
}

/** What happens next, shown only when a deposit milestone is due and unbilled. */
export function paperRecordedNext(): string {
  return 'The contract is binding. The deposit invoice can go out.';
}

/** What happens next when no deposit is due. */
export function paperRecordedNextNoDeposit(): string {
  return 'The contract is binding.';
}

// ─────────────────────────────────────────────────────────────────────────────
// A4: seal the signed contract (portal and paper signatures)
// ─────────────────────────────────────────────────────────────────────────────

/** The slide label. */
export function sealLabel(): string {
  return 'Slide to seal the signed contract';
}

/** The busy label. */
export function sealBusyLabel(): string {
  return 'Sealing…';
}

/** Screen reader: the track as one button. */
export function sealSrLabel(): string {
  return 'Seal the signed contract';
}

/** Screen reader: the confirm segment. */
export function sealSrConfirm(): string {
  return 'Confirm seal';
}

/** The disabled reason offline. */
export function sealOffline(): string {
  return "You're offline. Sealing needs a connection.";
}

/** Confirmed: the seal returned its hash (first 12 characters). */
export function sealedTitle(hash12: string): string {
  return `Sealed · ${hash12}`;
}

/** What happens next after the seal. */
export function sealedNext(): string {
  return 'The signed PDF is ready to download.';
}

/** Confirmed: the contract was sealed before (the one-shot seal refused a second one). */
export function alreadySealedTitle(): string {
  return 'Already sealed';
}

/** Refused: the seal failed with no sentence of its own. */
export function sealRefused(): string {
  return 'Not sealed. Something went wrong on our side.';
}

/** A legal write answered "queued" (it never can). */
export function sealLegalQueued(): string {
  return 'Not sealed. Sealing needs a connection, so nothing was sealed.';
}

// ─────────────────────────────────────────────────────────────────────────────
// A5: the field ticket signature (the client's rep or owner signs on site)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * LEGAL, VERBATIM: the attestation the signer agrees to, exactly as the
 * screen has shown it (founder decision D-5 keeps the screen and PDF wording
 * as they are). Keyed field.ticket.legal.attestation: a `.legal.` key is
 * extracted for display and carries NO Spanish until a human legal
 * translator supplies it, so Spanish shows this English.
 */
export function ticketAttestation(): string {
  return t('field.ticket.legal.attestation', "By signing you confirm this work was performed and the hours and quantities shown are accurate. Pricing is billed under the contract's T&M rates.");
}

/** Top panel row label: the work. */
export function ticketWorkRowLabel(): string {
  return t('field.ticket.sign.workRow', 'Work');
}

/** Top panel row label: the day the work was done. */
export function ticketDateRowLabel(): string {
  return t('field.ticket.sign.dateRow', 'Date');
}

/** Top panel row label: the amount (never shown to a role blinded from money). */
export function ticketAmountRowLabel(): string {
  return t('field.ticket.sign.amountRow', 'Amount');
}

/** The name field's label. */
export function ticketNameLabel(): string {
  return t('field.ticket.sign.fullName', 'Full name');
}

/** The slide label with the amount (cents). */
export function ticketSignLabel(amount: string): string {
  return t('field.ticket.sign.slideAmount', 'Slide along the line to sign · {amount}', { amount });
}

/** The slide label for a role blinded from money. */
export function ticketSignLabelNoAmount(): string {
  return t('field.ticket.sign.slide', 'Slide along the line to sign');
}

/** Screen reader: the line as one button. */
export function ticketSrLabel(): string {
  return t('field.ticket.sign.srLabel', 'Sign the field ticket');
}

/** Screen reader: the confirm segment. */
export function ticketSrConfirm(): string {
  return t('field.ticket.sign.srConfirm', 'Confirm signature');
}

/** Announced when the seal lands. */
export function ticketSealedAnnounce(ticketLabel: string): string {
  return t('field.ticket.sign.sealedAnnounce', '{ticketLabel} signed and locked.', { ticketLabel });
}

/** Confirmed, with the amount: "FT-12 signed · $1,240.00". */
export function ticketSignedTitle(ticketLabel: string, amount: string): string {
  return t('field.ticket.sign.signedTitle', '{ticketLabel} signed · {amount}', { ticketLabel, amount });
}

/** Confirmed, for a role blinded from money. */
export function ticketSignedTitleNoAmount(ticketLabel: string): string {
  return t('field.ticket.sign.signedTitleNoAmount', '{ticketLabel} signed', { ticketLabel });
}

/** Confirmed detail. */
export function ticketLockedDetail(): string {
  return t('field.ticket.sign.locked', 'Locked');
}

/** What happens next. */
export function ticketLockedNext(): string {
  return t('field.ticket.sign.lockedNext', 'Hours and quantities are locked. Rates can still change.');
}

/** Refused: the server said no. Nothing was signed. */
export function ticketRefused(ticketLabel: string): string {
  return t('field.ticket.sign.refused', 'Not signed. {ticketLabel} could not be saved. Nothing was signed.', { ticketLabel });
}

/** Refused: the ticket was already signed, so its content cannot change. */
export function ticketAlreadySigned(ticketLabel: string): string {
  return t('field.ticket.sign.alreadySigned', 'Not signed. {ticketLabel} was already signed, so nothing was changed.', { ticketLabel });
}

/** Refused: no account is signed in on this phone. */
export function ticketNoAccount(): string {
  return t('field.ticket.sign.noAccount', 'Not signed. Sign in to your account to sign field tickets.');
}

/** Timeout: the signature may still have landed. */
export function ticketTimeout(ticketLabel: string): string {
  return t('field.ticket.sign.timeout', 'No answer yet. Check {ticketLabel} before trying again.', { ticketLabel });
}

/** A legal write answered "queued" (it never can). */
export function ticketLegalQueued(): string {
  return t('field.ticket.sign.legalQueued', 'Not signed. Signing needs a connection, so nothing was signed.');
}

// ─────────────────────────────────────────────────────────────────────────────
// A6: the client approves a change order on the client view (the client reads it)
// ─────────────────────────────────────────────────────────────────────────────

/** Top panel title: "Change order #4". */
export function clientCoDocTitle(coNumber: number): string {
  return `Change order #${coNumber}`;
}

/** Top panel row label. */
export function clientCoChangeRowLabel(): string {
  return 'Change amount';
}

/** Top panel row label. */
export function clientCoNewTotalRowLabel(): string {
  return 'New contract total';
}

/** The name field's label. */
export function clientCoNameLabel(): string {
  return 'Your full legal name';
}

/** The name field's placeholder. */
export function clientCoNamePlaceholder(): string {
  return 'Full legal name, as on the contract';
}

/** The slide label with the signed change amount: "Slide along the line to approve · +$4,200.00". */
export function clientCoSignLabel(signedAmount: string): string {
  return `Slide along the line to approve · ${signedAmount}`;
}

/** Screen reader: the line as one button. */
export function clientCoSrLabel(): string {
  return 'Approve and sign the change order';
}

/** Screen reader: the confirm segment. */
export function clientCoSrConfirm(): string {
  return 'Confirm approval';
}

/** Announced when the seal lands. */
export function clientCoSealedAnnounce(coNumber: number): string {
  return `Change order #${coNumber} approved.`;
}

/** Confirmed: "Approved · CO #4 · +$4,200.00". */
export function clientCoApprovedTitle(coNumber: number, signedAmount: string): string {
  return `Approved · CO #${coNumber} · ${signedAmount}`;
}

/** What happens next: true, the approval lands on the contractor's dashboard. No push is sent, so never "notified". */
export function clientCoApprovedNext(): string {
  return 'Your contractor sees it on their dashboard.';
}

/** Refused: the insert said no. */
export function clientCoRefused(): string {
  return 'Not approved. Something went wrong on our side. Your signature is kept.';
}

/** Timeout: the approval may still have landed. */
export function clientCoTimeout(coNumber: number): string {
  return `No answer yet. Check CO #${coNumber} with your contractor before trying again.`;
}

/** Refused: a decision for this send of the change order is already on file (not this approval), so nothing was changed. */
export function clientCoAlreadyDecided(coNumber: number): string {
  return `Not approved. CO #${coNumber} already has a decision on file, so nothing was changed.`;
}

/** A legal write answered "queued" (it never can). */
export function clientCoLegalQueued(): string {
  return 'Not approved. Approving needs a connection, so nothing was approved.';
}

/** Shown instead of the slide when this view cannot record an approval (a preview, no portal id, no server). */
export function clientCoPreviewReason(): string {
  return "This preview can't record an approval.";
}

/**
 * CONSENT, VERBATIM: the "I agree" line the client view has always shown next
 * to its box. Its answer is stored as consent_accepted under
 * ESIGN_DISCLOSURE_VERSION, so the box is allowed (plan rule 11).
 */
export function clientCoConsentLine(): string {
  return 'I agree to sign this change order electronically, and I approve the scope and the change to my contract total shown above.';
}
