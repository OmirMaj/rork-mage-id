// hooks/useSupplierLinkCopy.ts — every word of the Supplier Link section (lane
// DELIVERIES-2). Every string goes through t('office.deliverySupplierLink.*',
// english, vars), surface 'office.delivery-supplier-link'. There is no Spanish
// yet (the surface is 'migrated', not 'complete').
//
// WORDING (docs/VOICE.md): `Label` is a name or an action in Title Case with no
// period. `Body` is whole sentences in sentence case. `Sub` is a caption with a
// capital first letter and no period. No em dashes, no "and" sign.
//
// THE HARD RULES OF THIS LANE (scripts/validate-delivery-supplier-link.ts reads
// this file for them):
//   - The app sends nothing. The person sends the link.
//   - An answer is what someone typed into the link. MAGE ID does not know who.
//   - Nothing says a delivery "will" arrive, and nothing calls an answer
//     confirmed, verified, guaranteed or a promise.
//   - Using a date does not move the schedule.
//
// Never call t() at module scope: the object is rebuilt when the language changes.
import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';

export interface SupplierLinkCopy {
  sectionLabel: string;
  ownerPreviewLabel: string;
  introBody: string;
  showsLabel: string;
  showNeededLabel: string;
  askedByLabel: string;
  whatLabel: string;
  supplierLabel: string;
  neededByLabel: string;
  notShownSub: string;
  theContractorSub: string;
  companyFromSub: string;
  neededTodaySub: string;
  neededAsMadeSub: string;
  neededOffSub: string;
  noCompanyBody: string;
  showsNothingElseBody: string;
  makeLabel: string;
  copyLabel: string;
  copyMessageLabel: string;
  shareLabel: string;
  copiedBody: string;
  turnOffLabel: string;
  turnOffBody: string;
  cancelLabel: string;
  anyoneBody: string;
  madeSub: (day: string) => string;
  noAnswerBody: string;
  checkLabel: string;
  answerLabel: string;
  newSub: string;
  dateLabel: string;
  noDateGivenSub: string;
  trackingLabel: string;
  typedByLabel: string;
  answerSourceBody: (name: string, when: string) => string;
  useDateLabel: string;
  useDateBody: (day: string) => string;
  sameDateBody: string;
  markSeenLabel: string;
  copyTrackingLabel: string;
  trackingCopiedBody: string;
  tripLabel: string;
  stepLoadedLabel: string;
  stepOnTheWayLabel: string;
  stepArrivedLabel: string;
  notYetSub: string;
  tripNoneBody: string;
  tripSourceBody: (name: string) => string;
  tripArrivedBody: string;
  failBody: string;
  refusedBody: string;
  noteFor: (name: string) => string;
  messageAsk: (what: string) => string;
  messageSign: (company: string) => string;
}

export function useSupplierLinkCopy(): SupplierLinkCopy {
  const { t } = useT();
  return useMemo<SupplierLinkCopy>(() => ({
    sectionLabel: t('office.deliverySupplierLink.sectionLabel', 'Supplier Link'),
    ownerPreviewLabel: t('office.deliverySupplierLink.ownerPreviewLabel', 'Owner Preview'),
    introBody: t('office.deliverySupplierLink.introBody', 'Make a link the supplier opens with no account, to give a delivery date and a tracking number. You send the link yourself. MAGE ID sends nothing.'),
    showsLabel: t('office.deliverySupplierLink.showsLabel', 'What the Link Shows'),
    showNeededLabel: t('office.deliverySupplierLink.showNeededLabel', 'Show Needed on Site By'),
    askedByLabel: t('office.deliverySupplierLink.askedByLabel', 'Asked By'),
    whatLabel: t('office.deliverySupplierLink.whatLabel', 'What Is Coming'),
    supplierLabel: t('office.deliverySupplierLink.supplierLabel', 'Supplier'),
    neededByLabel: t('office.deliverySupplierLink.neededByLabel', 'Needed on Site By'),
    notShownSub: t('office.deliverySupplierLink.notShownSub', 'Not shown'),
    theContractorSub: t('office.deliverySupplierLink.theContractorSub', 'The contractor'),
    companyFromSub: t('office.deliverySupplierLink.companyFromSub', 'Your company name, from Settings'),
    neededTodaySub: t('office.deliverySupplierLink.neededTodaySub', 'From your schedule as it stands today'),
    neededAsMadeSub: t('office.deliverySupplierLink.neededAsMadeSub', 'As it stood when the link was made'),
    neededOffSub: t('office.deliverySupplierLink.neededOffSub', 'The supplier does not see a needed-by date'),
    noCompanyBody: t('office.deliverySupplierLink.noCompanyBody', 'Your company name is blank, so the page says "the contractor". You can add it in Settings.'),
    showsNothingElseBody: t('office.deliverySupplierLink.showsNothingElseBody', 'The link shows nothing else: no price, no client, no address and no other delivery.'),
    makeLabel: t('office.deliverySupplierLink.makeLabel', 'Make Link'),
    copyLabel: t('office.deliverySupplierLink.copyLabel', 'Copy Link'),
    copyMessageLabel: t('office.deliverySupplierLink.copyMessageLabel', 'Copy Link With a Message'),
    shareLabel: t('office.deliverySupplierLink.shareLabel', 'Share Link'),
    copiedBody: t('office.deliverySupplierLink.copiedBody', 'Copied. Paste it into a text or an email to the supplier.'),
    turnOffLabel: t('office.deliverySupplierLink.turnOffLabel', 'Turn Off Link'),
    turnOffBody: t('office.deliverySupplierLink.turnOffBody', 'The link stops working and its answer is removed from this screen. A date you already used stays on the delivery.'),
    cancelLabel: t('office.deliverySupplierLink.cancelLabel', 'Cancel'),
    anyoneBody: t('office.deliverySupplierLink.anyoneBody', 'Anyone who has the link can answer. MAGE ID does not know who opened it.'),
    madeSub: (day) => t('office.deliverySupplierLink.madeSub', 'Link made {day}', { day }),
    noAnswerBody: t('office.deliverySupplierLink.noAnswerBody', 'No answer yet. An answer shows here the next time this screen loads. MAGE ID does not notify you.'),
    checkLabel: t('office.deliverySupplierLink.checkLabel', 'Check for an Answer'),
    answerLabel: t('office.deliverySupplierLink.answerLabel', 'Answer Through the Link'),
    newSub: t('office.deliverySupplierLink.newSub', 'New'),
    dateLabel: t('office.deliverySupplierLink.dateLabel', 'Delivery Date Given'),
    noDateGivenSub: t('office.deliverySupplierLink.noDateGivenSub', 'No date given'),
    trackingLabel: t('office.deliverySupplierLink.trackingLabel', 'Tracking Number'),
    typedByLabel: t('office.deliverySupplierLink.typedByLabel', 'Typed By'),
    answerSourceBody: (name, when) => t('office.deliverySupplierLink.answerSourceBody', 'Typed into the link by someone who gave the name {name}, {when}. MAGE ID does not know who they are or whether the date is right.', { name, when }),
    useDateLabel: t('office.deliverySupplierLink.useDateLabel', 'Use This Date'),
    useDateBody: (day) => t('office.deliverySupplierLink.useDateBody', 'Use This Date sets the supplier date to {day} and keeps the record of where it came from. It does not move your schedule.', { day }),
    sameDateBody: t('office.deliverySupplierLink.sameDateBody', 'This is already the supplier date on the delivery.'),
    markSeenLabel: t('office.deliverySupplierLink.markSeenLabel', 'Mark as Seen'),
    copyTrackingLabel: t('office.deliverySupplierLink.copyTrackingLabel', 'Copy Tracking Number'),
    trackingCopiedBody: t('office.deliverySupplierLink.trackingCopiedBody', 'Copied. Paste it into the carrier\'s own tracking page.'),
    tripLabel: t('office.deliverySupplierLink.tripLabel', 'Where the Load Is'),
    stepLoadedLabel: t('office.deliverySupplierLink.stepLoadedLabel', 'Loaded'),
    stepOnTheWayLabel: t('office.deliverySupplierLink.stepOnTheWayLabel', 'On the Way'),
    stepArrivedLabel: t('office.deliverySupplierLink.stepArrivedLabel', 'At Your Job'),
    notYetSub: t('office.deliverySupplierLink.notYetSub', 'Not yet'),
    tripNoneBody: t('office.deliverySupplierLink.tripNoneBody', 'Nobody has tapped a step on the link yet. The supplier can tap Loaded, On The Way and Arrived there.'),
    tripSourceBody: (name) => t('office.deliverySupplierLink.tripSourceBody', 'Tapped on the link by someone who gave the name {name}. MAGE ID does not know where the truck is.', { name }),
    tripArrivedBody: t('office.deliverySupplierLink.tripArrivedBody', 'A tap of Arrived does not mark this delivery as received. Press Received once you have looked at the load.'),
    failBody: t('office.deliverySupplierLink.failBody', 'That did not go through. Check your connection and try again.'),
    refusedBody: t('office.deliverySupplierLink.refusedBody', 'That was not saved. You may not have the right to do this on this job, or this delivery has not reached the server yet. Try again in a minute.'),
    noteFor: (name) => t('office.deliverySupplierLink.noteFor', 'through the supplier link, typed by {name}', { name }),
    messageAsk: (what) => t('office.deliverySupplierLink.messageAsk', 'Please open this link and give the delivery date and tracking number for: {what}', { what }),
    messageSign: (company) => t('office.deliverySupplierLink.messageSign', 'Thank you, {company}', { company }),
  }), [t]);
}

export default useSupplierLinkCopy;
