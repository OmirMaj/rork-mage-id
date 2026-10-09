# Consent and attestation texts, for counsel

Written 2026-10-09 with lane PROTECT-TEXT. Every sentence a person agrees to,
attests to or acknowledges in MAGE ID, exactly as it stands in the code today,
with where it lives and whether a copy is kept with each signature.

**None of these was changed by PROTECT-TEXT.** The lane reworded commentary
around them. It first rewrote the lien waiver consent (item 1) and that rewrite
was reverted before landing: whether to change a consent sentence is the
attorney's decision. The lane's wording is kept below only as a suggestion.

Line numbers are as of the commit that added this file. Search for the quoted
text if they have moved.

---

## 1. Lien waiver: the subcontractor's e-signature consent

- Where: `marketing/lien-waiver/index.html:214-218` (`CONSENT_VERSION`, `CONSENT_TEXT`).
  The version is mirrored in `utils/lienWaiverEngine.ts:486` (`LIEN_WAIVER_CONSENT_VERSION`).
- Version: `2026-09-esign-v1`
- Text, as shown beside the checkbox:

> I agree to sign this lien waiver electronically. I understand my electronic signature is legally binding, the same as signing on paper, under the federal E-SIGN Act and my state’s Uniform Electronic Transactions Act. I have read the document above and I am the person named as the claimant, or I am authorised to sign for them.

- Stored per signature: **yes, with its version.** The page posts a consent
  record (version, waiver id, signer, title, time, user agent, the full text)
  and the version to `lien_waiver_submit_signature`, which keeps both in the
  waiver's signature record (`consentRecord`, `consentVersion`;
  `supabase/migrations/20260923130000_lien_prequal_hardening.sql:320-321`).
- The document signed is the HTML stored when the contractor sent the request
  (`lien_waivers.sign_document_html`). It is not rebuilt when the page opens.
- Pinned byte for byte by `scripts/validate-lien-slide.ts` (LS6).

**Suggested alternative (PROTECT-TEXT's proposal, NOT in the product):**

> I agree to sign this lien waiver electronically. I intend this to be my signature. I have read the document above and I am the person named as the claimant, or I am authorised to sign for them.

Why the lane proposed it: the current sentence states a legal conclusion
("legally binding ... under the federal E-SIGN Act and my state's Uniform
Electronic Transactions Act") in words MAGE ID wrote, to a signer in any state.
Why it was not shipped: the current sentence also has the signer acknowledge
that an electronic signature has the same effect as one on paper. Removing
that acknowledgement could weaken the waiver for the contractor who relies on
it. If the wording changes, the version must change with it
(for example `2026-10-esign-v2`) in both files and in the LS6 pin.

Related, for the same review:

- The warning above the consent on that page (`marketing/lien-waiver/index.html:140-144`)
  is page commentary. It is not part of the consent record and not part of the
  stored document. PROTECT-TEXT changed its middle sentence from "An
  *unconditional* waiver is enforceable against you even if the money never
  arrives." to "An *unconditional* waiver says you give up those rights whether
  or not the money has arrived."
- Waivers sent after this lane carry the Notice To Recipients as the last
  block of the stored document, after the signature block and the footer
  ("Prepared by {company} using MAGE ID software. MAGE ID did not prepare,
  review or check this document and makes no statement to the reader about its
  contents."). It sits outside the statutory form wording. Counsel should
  confirm that a trailing notice is acceptable on the statutory forms.

## 2. Change order: the client's e-signature disclosure

- Where: `utils/portalOwnerCore.ts:699-705` (`ESIGN_DISCLOSURE_VERSION`,
  `ESIGN_DISCLOSURE_TEXT`), mirrored byte for byte in
  `marketing/portal/index.html:7232-7237`.
- Version: `co-esign-2`
- Text:

> By typing your legal name, drawing your signature, and selecting "I agree", you consent to sign this change order electronically. You are approving the scope described above and the resulting change to your contract total. You may decline instead, or ask for a paper copy at no charge, by messaging your contractor. A copy of this record is retained by your contractor and is available to you on request.

- The checkbox label (`marketing/portal/index.html:2955` and `:7728`;
  `utils/moments/sites/signingCopy.ts:659`):

> I agree to sign this change order electronically, and I approve the scope and the change to my contract total shown above.

- Stored per signature: **yes, with its version.** The consent record
  (`buildCOConsentRecord`, `utils/portalOwnerCore.ts:746`) carries the version,
  the change order's scope and amounts, the signer, the time and the disclosure
  text. Its SHA-256 is stored as the record hash.

## 3. Proposal: the client's acceptance disclosure

- Where: `utils/portalSnapshot.ts:882-892` (`PROPOSAL_ESIGN_VERSION`,
  `PROPOSAL_DISCLOSURE_TEXT`), mirrored in `marketing/portal/index.html:7905-7910`.
- Version: `proposal-esign-2`
- Text:

> By typing your legal name, drawing your signature, and selecting "I agree", you consent to accept this proposal electronically. You are accepting the scope and the fixed price shown above as the basis of the work your contractor will do. You may decline instead, or ask for a paper copy at no charge, by messaging your contractor. A copy of this record is retained by your contractor and is available to you on request.

- The checkbox label (`marketing/portal/index.html:8121`):

> I agree to accept this proposal electronically, and I accept the scope and the fixed price shown above.

- The note beside the button (`utils/portalSnapshot.ts:898-900`):

> Accepting tells your contractor to go ahead and prepare your construction agreement. That agreement is a separate document you will review and sign.

- Stored per signature: **yes, with its version.** The record carries the
  SHA-256 of the proposal's canonical text (`buildProposalDocumentText`,
  `utils/portalSnapshot.ts:992`: project, contractor, total, scope lines,
  allowances, payment lines), which the server recomputes from its own copy.

## 4. Contract: the client's counter-signature

- Where: `marketing/portal/index.html:3062` (`contractFinePrint`) and `:3103`
  (`contractFinePrintSlide`); the published language packs in
  `utils/portalLanguages.ts:211` (English), `:299` (Spanish), `:388`
  (Portuguese), `:449` (Chinese), `:510` (Vietnamese), `:571` (French).
- Version: **none.**
- Text (tap to sign):

> By typing your name and tapping Sign, you accept the agreement as legally binding. Your contractor keeps the sealed signed copy and can send it to you.

- Text (slide to sign):

> By typing your name and sliding along the line, you accept the agreement as legally binding. Your contractor keeps the sealed signed copy and can send it to you.

- Stored per signature: **no.** `portal_sign_contract` keeps the typed name and
  the time. It keeps no copy of this sentence and no version, so there is no
  record of which wording a given signer saw. This is the weakest of the
  signing records and the one most worth counsel's time: the sentence states a
  legal conclusion ("legally binding"), it exists in six languages nobody with
  a legal background has read, and nothing ties a signature to a version.
- PROTECT-TEXT left it word for word (`scripts/validate-protections.ts`
  `BAN_EXEMPT`; `scripts/moments-checks/portal.ts` pins it). Changing it should
  come with a version stored on the signature.
- The contract itself: clause text comes from `utils/contractEngine.ts` and the
  contractor's edits. One template clause reads "accept this proposal as the
  binding agreement". The lane did not touch clause text.
- The sealed PDF is rendered once on the contractor's phone when both parties
  have signed, stored write-once, and hashed by the server
  (`utils/contractSealing.ts`, `supabase/functions/seal-document`).

## 5. Final punch: the client's in-person acceptance

- Where: `supabase/functions/_shared/punchSealManifest.ts:18` and `:25-26`
  (`PUNCH_SEAL_CONSENT_VERSION`, `PUNCH_SEAL_ACCEPTANCE_TEXT`).
- Version: `punch-accept-1`
- Text:

> By signing you confirm you walked this project with the contractor and the items listed were closed on the date shown, each with an after photo. This record is not a warranty and does not change your contract or its warranty terms. A copy is kept by your contractor and is available to you on request.

- Stored per signature: **yes, with its version**, inside the sealed manifest
  (`statement: { version, text }`), which the server hashes.
- The printed record adds its own statement (`utils/punchSealHtml.ts:21-22`):
  "This record certifies that the punch items below were closed, each with an
  after photo, as of {day}. It is not a warranty, not a lien release, and it
  does not release retainage or any payment." The word "certifies" is MAGE
  ID's template wording on the contractor's record; counsel may want to read it.
- The sealed punch PDF carries no Notice To Recipients and never names MAGE ID.
  PROTECT-TEXT left its template exactly as it was.

## 6. AI features: consent to send data to outside AI services

- Where: `utils/aiConsentCore.ts:300-338` (`AI_CONSENT_COPY`), question version
  at `:67` (`AI_CONSENT_QUESTION_VERSION = 2`).
- Text (the question, assembled by `aiConsentAlertMessage`):

> **Use AI features?**
> MAGE ID’s AI features send your request to outside AI services to get you an answer.
> Who receives it: Google Gemini (writing, estimates, schedules, photo and plan reading) · Anthropic Claude (construction answers and takeoff) · A speech-to-text service provided through Rork (turning voice notes into text)
> What is sent: What you type or say to an AI feature · The project details you include, like scope, line items and schedule tasks · Photos, plan pages and documents you choose to analyze · Voice recordings you make for transcription
> Sent automatically, with no tap from you, to Google Gemini: For a weekly client recap you switch on for a job: that job’s name and location, the week’s daily report text and completed task names · For Ask Your Home in the client portal: your client’s typed questions and the Home Passport records that match them
> It is used only to answer that request or write that recap. Nothing is sent from this app until you allow it, and you can turn AI features off any time in Settings → AI features.
> Buttons: "Allow AI features" / "Not now"

- A second, account-wide question for the two server features
  (`utils/aiConsentCore.ts:396-407`, `AI_ACCOUNT_CONSENT_COPY`): "Use AI for the
  weekly recap and Ask Your Home?" with buttons "Allow" / "Not now".
- Stored: the answer and the question version, on the device
  (`mageid_ai_consent_v2`) and on the account. The text itself is not stored
  with the answer; the version number stands for it.
- On the web app the gate always answers yes: the question is not asked there.

## 7. Code answers: the one-time acknowledgement

- Where: `utils/codeAckCore.ts:28` and `:34-36` (`CODE_ACK_VERSION = 1`, `CODE_ACK_COPY`).
- Text:

> **Before you rely on a code answer**
> Code requirements, dimensions and figures shown by MAGE ID may be wrong, out of date, or not the edition your town adopted. The adopted code and your building department govern. Check every requirement before you build.
> Button: "I understand"

- The line under each result (`utils/codeAckCore.ts:42`): "Not a substitute for
  the adopted code. Confirm with your building department."
- Stored: the tap, the account, the time and the version, **on the device
  only** (`mageid_code_answer_ack`). Nothing is kept on the server, so MAGE ID
  cannot later show that a given contractor acknowledged it.

## 8. Room scan: the accuracy notice

- Where: `i18n/catalog/en/office.scan-clearance.generated.ts:87`, shown by
  `components/roomScan/ClearanceView.tsx:82`.
- Text:

> A phone scan can be off by an inch or more, and several of these figures are a matter of an inch. Tape anything that matters before you build to it.

- Stored: **no.** It is a notice on the screen. Nobody taps to accept it.

## 9. Crew ID scan: the contractor's attestation

- Where: `app/crew.tsx:1055`.
- Text (a checkbox the contractor ticks before scanning a worker's ID):

> I have this person's consent to scan and store their ID information.

- Stored: I found no record of the tick being kept with the scan. Counsel
  should treat it as not stored unless engineering confirms otherwise.

## 10. Account creation: the agreement sentence (added by PROTECT-TEXT)

- Where: `components/ProtectNotices.tsx` (`AgreementNotice`), shown on Log In,
  Sign Up, Accept Invite and Claim Crew above the buttons.
- Text:

> By continuing you agree to our Terms of Service and Privacy Policy.

- Sign Up also keeps its older line under the Create Account button
  (`app/signup.tsx:579-596`): "By creating an account you agree to our Terms of
  Service and Privacy Policy."
- Stored: **no.** Text only. Nothing records that a given user saw or accepted
  a given version of the Terms.

## 11. The Notice To Recipients (added by PROTECT-TEXT)

Not a consent, but the one sentence MAGE ID now says to third parties on
documents, emails sent in a contractor's name and the six no-account pages.
One wording, in `utils/recipientNotice.ts`:

> Prepared by {company} using MAGE ID software. MAGE ID did not prepare, review or check this document and makes no statement to the reader about its contents.

With no company name on file it reads "Prepared by the sender using ...". The
Spanish wording in the same file has not been read by a legal translator.

---

## Questions for counsel, in order of weight

1. Contract counter-signature (item 4): replacement wording, and whether a
   stored version is needed before it changes.
2. Lien waiver consent (item 1): keep, or adopt the suggested alternative or
   another wording, with a new version.
3. Account creation (item 10) and code answers (item 7): whether acceptance
   should be recorded on the server.
4. Whether the trailing Notice To Recipients is acceptable on statutory lien
   waiver forms and AIA-style forms (items 1 and 11).
5. "This record certifies" on the sealed punch record (item 5).
6. On the web, a paid plan is cancelled by emailing help@mageid.app. There is
   no self-serve cancel on the web. Some states' automatic-renewal laws expect
   an online cancel for a plan bought online.
