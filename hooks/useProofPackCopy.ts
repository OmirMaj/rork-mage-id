// hooks/useProofPackCopy.ts — the ONLY place the Pay Period Record SCREEN
// strings live (Big Bets, Bet 3, Phase 1). Every string goes through
// t('office.proofPack.*', english, vars), so the i18n registry stays in one
// file (surface 'office.proof-pack', Spanish in
// i18n/catalog/es/office/proofPack.ts). components/proofPack/* and
// app/proof-pack.tsx import this and add no t() keys of their own.
//
// The words the DOCUMENT prints are not here: they live in
// utils/proofPack/docCopy.ts, in both languages, because the document is
// printed in the language the contractor picks for its reader, which need not
// be the app's language.
//
// WORDING (docs/VOICE.md): a key ending in `Label` is a name or an action in
// Title Case. A key ending in `Body` is one or more whole sentences in sentence
// case. No em dashes, no "and" sign, no "e.g.", no arrows.
//
// WHAT THIS SURFACE MAY SAY. It says what the document lists and how each record
// is kept. It never says the work was done, never says who signed, and makes no
// promise about a bank, a lender, a surety or an insurer. The lane's first name
// ("proof of work") is banned here too. scripts/validate-proof-pack.ts reads
// the English shard and the Spanish file and fails on a banned word in either.
//
// Never call t() at module scope: the object is rebuilt when the language changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import type { ProofItemKind, ProofStrength } from '@/utils/proofPack/core';
import type { ProofCheck } from '@/utils/proofPack/fingerprint';

export interface ProofPackCopy {
  // ── the entry row ──
  entryLabel: string;
  entryOwnerPreviewLabel: string;
  entryBody: string;
  // ── the review screen ──
  screenTitleLabel: string;
  backLabel: string;
  whatThisIsBody: string;
  whatThisIsNotBody: string;
  periodHeadingLabel: string;
  periodRangeBody: (from: string, to: string) => string;
  periodOpenBody: (to: string) => string;
  payAppLabel: (n: number) => string;
  invoiceLabel: (n: number) => string;
  billedLabel: string;
  countsHeadingLabel: string;
  strengthLabel: (s: ProofStrength) => string;
  strengthBody: (s: ProofStrength) => string;
  kindLabel: (k: ProofItemKind) => string;
  includeA11yLabel: (name: string) => string;
  includedCountBody: (included: number, total: number) => string;
  leftOutBody: (n: number) => string;
  nothingLeftOutBody: string;
  leftOutCountLabel: (n: number) => string;
  emptyKindBody: string;
  photoStampBody: (place: 'phone_gps' | 'typed' | 'none') => string;
  openHeadingLabel: string;
  openCountBody: (n: number) => string;
  languageHeadingLabel: string;
  languageEnglishLabel: string;
  languageSpanishLabel: string;
  privacyHeadingLabel: string;
  privacyBody: string;
  serverGetsBody: string;
  freeTextBody: string;
  peopleBody: string;
  coordsLabel: string;
  coordsBody: string;
  noticeHeadingLabel: string;
  noticeIntroBody: string;
  noticeBody: string;
  notOnFileLabel: string;
  checkingServerBody: string;
  serverNotReadBody: string;
  createLabel: string;
  creatingLabel: string;
  // ── results ──
  madeOnFileBody: (code: string) => string;
  madeNotOnFileBody: string;
  notKeptBody: string;
  failedBody: string;
  missingPayBody: string;
  missingPeriodBody: string;
  seatBody: string;
  roleErrorBody: string;
  retryLabel: string;
  loadingBody: string;
  waiversNotReadBody: string;
  // ── packages already made ──
  savedHeadingLabel: string;
  savedEmptyBody: string;
  savedRowLabel: (code: string) => string;
  checkAgainLabel: string;
  checkFileLabel: string;
  checkCodeLabel: string;
  fingerprintLabel: string;
  checkCodeNoteBody: string;
  fingerprintLimitsBody: string;
  checkBody: (c: ProofCheck) => string;
  fileCheckBody: (c: ProofCheck) => string;
  fileCheckNativeBody: string;
}

export function useProofPackCopy(): ProofPackCopy {
  const { t } = useT();
  return useMemo<ProofPackCopy>(() => {
    const strengthLabels: Record<ProofStrength, string> = {
      sealed: t('office.proofPack.strength.sealedLabel', 'Sealed'),
      signed: t('office.proofPack.strength.signedLabel', 'Signed'),
      locked: t('office.proofPack.strength.lockedLabel', 'Locked'),
      recorded: t('office.proofPack.strength.recordedLabel', 'Recorded'),
      stated: t('office.proofPack.strength.statedLabel', 'Stated'),
    };
    const strengthBodies: Record<ProofStrength, string> = {
      sealed: t('office.proofPack.strength.sealedBody', 'The server set the time, stored a fingerprint of the record, and the database refuses every later change.'),
      signed: t('office.proofPack.strength.signedBody', 'A person signed on a page the contractor’s account cannot write through, the server set the signing time, and the database keeps the signature as it was signed. MAGE ID does not check who signed.'),
      locked: t('office.proofPack.strength.lockedBody', 'The database refuses edits to the content of the record after a set point. No server-timed signature and no fingerprint is kept, and the account that owns the record is able to delete it and save another.'),
      recorded: t('office.proofPack.strength.recordedBody', 'Saved in the app. The account that made it can change it later, and no history of changes is kept.'),
      stated: t('office.proofPack.strength.statedBody', 'Typed in by the contractor, with nothing else behind it.'),
    };
    const kindLabels: Record<ProofItemKind, string> = {
      daily_report: t('office.proofPack.kind.dailyReportLabel', 'Daily Reports'),
      photo: t('office.proofPack.kind.photoLabel', 'Photos'),
      change_order: t('office.proofPack.kind.changeOrderLabel', 'Change Orders'),
      punch_seal: t('office.proofPack.kind.punchSealLabel', 'Sealed Final Punch'),
      punch_item: t('office.proofPack.kind.punchItemLabel', 'Punch Items'),
      inspection: t('office.proofPack.kind.inspectionLabel', 'Inspection Results'),
      lien_waiver: t('office.proofPack.kind.lienWaiverLabel', 'Lien Waivers'),
      field_ticket: t('office.proofPack.kind.fieldTicketLabel', 'Signed Field Tickets'),
    };
    const checkBodies: Record<ProofCheck, string> = {
      match: t('office.proofPack.check.matchBody', 'The copy on this device gives the same fingerprint the server has on file.'),
      changed: t('office.proofPack.check.changedBody', 'The copy on this device gives a different fingerprint from the one on file. It is not the document that was put on file.'),
      not_on_file: t('office.proofPack.check.notOnFileBody', 'No fingerprint is on file for this document, so it cannot be checked.'),
      not_checked: t('office.proofPack.check.notCheckedBody', 'The server could not be reached, so this document was not checked. Try again when you have signal.'),
    };
    const fileCheckBodies: Record<ProofCheck, string> = {
      match: t('office.proofPack.fileCheck.matchBody', 'This file is the one MAGE ID fingerprinted. Not one byte differs.'),
      changed: t('office.proofPack.fileCheck.changedBody', 'This file is not the one MAGE ID fingerprinted. It was changed, saved again by another program, or it is a different file.'),
      not_on_file: t('office.proofPack.fileCheck.notOnFileBody', 'No file fingerprint is on file for this document. One is taken only when the document is made in the phone app.'),
      not_checked: t('office.proofPack.fileCheck.notCheckedBody', 'The server could not be reached, so this file was not checked. Try again when you have signal.'),
    };
    const stampBodies = {
      phone_gps: t('office.proofPack.photo.gpsBody', 'Time from the phone’s clock, place from the phone’s GPS.'),
      typed: t('office.proofPack.photo.typedBody', 'Time from the phone’s clock, place typed in.'),
      none: t('office.proofPack.photo.noneBody', 'Time from the phone’s clock, no place recorded.'),
    };
    return {
      entryLabel: t('office.proofPack.entry.label', 'Build Pay Period Record'),
      entryOwnerPreviewLabel: t('office.proofPack.entry.ownerPreviewLabel', 'Owner Preview'),
      entryBody: t('office.proofPack.entry.body', 'One document for this pay period: what was billed and the records MAGE ID holds for it.'),
      screenTitleLabel: t('office.proofPack.screen.titleLabel', 'Pay Period Record'),
      backLabel: t('office.proofPack.screen.backLabel', 'Back'),
      whatThisIsBody: t('office.proofPack.screen.whatThisIsBody', 'This is a record of what MAGE ID holds for this pay period.'),
      whatThisIsNotBody: t('office.proofPack.screen.whatThisIsNotBody', 'It is not an inspection, an appraisal or a certification of the work.'),
      periodHeadingLabel: t('office.proofPack.period.headingLabel', 'Pay Period'),
      periodRangeBody: (from, to) => t('office.proofPack.period.rangeBody', '{from} to {to}', { from, to }),
      periodOpenBody: (to) => t('office.proofPack.period.openBody', 'Up to {to}. No earlier pay document is on file, so the period has no first day.', { to }),
      payAppLabel: (n) => t('office.proofPack.pay.payAppLabel', 'Pay Application {n}', { n }),
      invoiceLabel: (n) => t('office.proofPack.pay.invoiceLabel', 'Invoice {n}', { n }),
      billedLabel: t('office.proofPack.pay.billedLabel', 'Billed This Period'),
      countsHeadingLabel: t('office.proofPack.counts.headingLabel', 'Records by How They Are Kept'),
      strengthLabel: (s) => strengthLabels[s],
      strengthBody: (s) => strengthBodies[s],
      kindLabel: (k) => kindLabels[k],
      includeA11yLabel: (name) => t('office.proofPack.item.includeA11yLabel', 'Include {name}', { name }),
      includedCountBody: (included, total) => t('office.proofPack.item.includedCountBody', '{included} of {total} included.', { included, total }),
      leftOutBody: (n) => (n === 1
        ? t('office.proofPack.leftOut.oneBody', 'You left 1 item out. The document will say 1 item was left out by the contractor, under its label and by kind.')
        : t('office.proofPack.leftOut.manyBody', 'You left {n} items out. The document will say {n} items were left out by the contractor, under each label and by kind.', { n })),
      nothingLeftOutBody: t('office.proofPack.leftOut.noneBody', 'Everything is included. Switch an item off to leave it out. The document says how many were left out under each label.'),
      leftOutCountLabel: (n) => t('office.proofPack.leftOut.countLabel', '{n} Left Out', { n }),
      emptyKindBody: t('office.proofPack.item.emptyKindBody', 'None on file for this period. The document says so.'),
      photoStampBody: (place) => stampBodies[place],
      openHeadingLabel: t('office.proofPack.open.headingLabel', 'Open Items'),
      openCountBody: (n) => (n === 1
        ? t('office.proofPack.open.oneBody', 'The document lists 1 thing a reader may ask about that MAGE ID does not hold or did not check.')
        : t('office.proofPack.open.manyBody', 'The document lists {n} things a reader may ask about that MAGE ID does not hold or did not check.', { n })),
      languageHeadingLabel: t('office.proofPack.language.headingLabel', 'Document Language'),
      languageEnglishLabel: t('office.proofPack.language.englishLabel', 'English'),
      languageSpanishLabel: t('office.proofPack.language.spanishLabel', 'Spanish'),
      privacyHeadingLabel: t('office.proofPack.privacy.headingLabel', 'What Leaves This Device'),
      privacyBody: t('office.proofPack.privacy.body', 'The document has your client’s name, the address, the amounts and photos of the property. It goes only where you send it. Nothing is sent to an AI model.'),
      serverGetsBody: t('office.proofPack.privacy.serverGetsBody', 'MAGE ID’s server receives one fingerprint record: the project’s id, the pay document’s id, the first letter of the project name, the city, how many records are listed and how many were left out, and the fingerprint. In the phone app the fingerprint of the file follows. No amount, no name and no street address is sent.'),
      freeTextBody: t('office.proofPack.privacy.freeTextBody', 'Work performed, issues and delays, and punch, ticket and change order descriptions print exactly as they were typed, and they may name people. Read them before you share.'),
      peopleBody: t('office.proofPack.privacy.peopleBody', 'Workers are shown as trades and head counts. No worker’s name, phone number, ID or pay rate is taken from a worker field. A signature keeps the signer’s name as it was entered. A lien waiver names the subcontractor or supplier that gave it.'),
      coordsLabel: t('office.proofPack.privacy.coordsLabel', 'Print Photo Coordinates'),
      coordsBody: t('office.proofPack.privacy.coordsBody', 'Off, a photo says its place came from the phone’s GPS and no coordinates print. On, the coordinates print, and they show where the property is.'),
      noticeHeadingLabel: t('office.proofPack.notice.headingLabel', 'Notice to Recipients'),
      noticeIntroBody: t('office.proofPack.notice.introBody', 'The document prints this notice on its first page and at the foot of every page.'),
      noticeBody: t('office.proofPack.notice.body', 'This record was prepared by the contractor named above using MAGE ID. MAGE ID did not inspect the work and makes no statement to the reader about the work, the amounts or the people named. Do not rely on this record as an inspection, an appraisal or a certification.'),
      notOnFileLabel: t('office.proofPack.pay.notOnFileLabel', 'Not on File'),
      checkingServerBody: t('office.proofPack.server.checkingBody', 'Checking the records against the server.'),
      serverNotReadBody: t('office.proofPack.server.notReadBody', 'Part of the server could not be read. A record that needs a server check is listed as Recorded, and the document says that part was not checked.'),
      createLabel: t('office.proofPack.create.label', 'Create and Share'),
      creatingLabel: t('office.proofPack.create.creatingLabel', 'Making the Document'),
      madeOnFileBody: (code) => t('office.proofPack.result.onFileBody', 'Document made. Its fingerprint is on file. Check code {code}.', { code }),
      madeNotOnFileBody: t('office.proofPack.result.notOnFileBody', 'Document made, but its fingerprint could not be put on file. The document says it cannot be checked later.'),
      notKeptBody: t('office.proofPack.result.notKeptBody', 'The copy could not be kept on this device, so this document cannot be checked again here.'),
      failedBody: t('office.proofPack.result.failedBody', 'The document could not be made. Try again.'),
      missingPayBody: t('office.proofPack.missing.payBody', 'That pay document is not on this device. Open it from the project and try again.'),
      missingPeriodBody: t('office.proofPack.missing.periodBody', 'This pay document has no end date, so MAGE ID cannot tell which records belong to it. Add the date and try again.'),
      seatBody: t('office.proofPack.missing.seatBody', 'Only the project owner can make a Pay Period Record. It carries the client’s name, the address and the amounts.'),
      roleErrorBody: t('office.proofPack.missing.roleErrorBody', 'Your access to this project could not be checked. Check your signal and try again.'),
      retryLabel: t('office.proofPack.missing.retryLabel', 'Try Again'),
      loadingBody: t('office.proofPack.missing.loadingBody', 'Reading the records for this period.'),
      waiversNotReadBody: t('office.proofPack.missing.waiversBody', 'Lien waivers could not be read. The document will say that part was not checked.'),
      savedHeadingLabel: t('office.proofPack.saved.headingLabel', 'Pay Period Records Made on This Device'),
      savedEmptyBody: t('office.proofPack.saved.emptyBody', 'No Pay Period Record has been made on this device for this project.'),
      savedRowLabel: (code) => t('office.proofPack.saved.rowLabel', 'Check Code {code}', { code }),
      checkAgainLabel: t('office.proofPack.saved.checkAgainLabel', 'Check Fingerprint'),
      checkFileLabel: t('office.proofPack.saved.checkFileLabel', 'Check a File'),
      checkCodeLabel: t('office.proofPack.saved.checkCodeLabel', 'Check Code'),
      fingerprintLabel: t('office.proofPack.saved.fingerprintLabel', 'Fingerprint'),
      checkCodeNoteBody: t('office.proofPack.saved.checkCodeNoteBody', 'The check code is a short name for the fingerprint. Compare the full fingerprint.'),
      fingerprintLimitsBody: t('office.proofPack.saved.fingerprintLimitsBody', 'The fingerprint shows this document has not changed since that time. It does not show that the records in it are true or that they match MAGE ID’s database.'),
      checkBody: (c) => checkBodies[c],
      fileCheckBody: (c) => fileCheckBodies[c],
      fileCheckNativeBody: t('office.proofPack.fileCheck.nativeBody', 'Checking a file works in the phone app.'),
    };
  }, [t]);
}
