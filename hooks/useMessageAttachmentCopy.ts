// hooks/useMessageAttachmentCopy.ts — every user-facing string of the client
// message attachments (track MSG, lane MSGAPP), through useT().
//
// The components and the screen call this hook; no other new file calls t(),
// so the i18n surface 'office.client-messages' maps one file (validate-i18n G8).
// Keys are literals; the seed action keys are reused with their exact English.
// A code with no line of its own (an unknown refusal or failure) gets the
// generic upload line.

import { useMemo } from 'react';
import { useT } from '@/contexts/LanguageContext';
import { formatBytes } from '@/utils/projectFiles';
import type { OutboxFailReason } from '@/utils/messageAttachments';
import type { PickRefusal } from '@/hooks/useAttachmentPicker';

export interface MessageAttachmentCopy {
  attachA11y: string;
  sheetTitle: string;
  takePhoto: string;
  choosePhotos: string;
  choosePdf: string;
  cancel: string;
  refusal(reason: PickRefusal | string, name: string, size?: number): string;
  trayRemoveA11y(name: string): string;
  uploading(done: number, count: number): string;
  waitingNetwork(web: boolean): string;
  sending: string;
  queued: string;
  notSent: string;
  failReason(reason: OutboxFailReason | string): string;
  retry: string;
  remove: string;
  removeTitle: string;
  removeBody: string;
  photoA11y(name: string): string;
  photoMore(count: number): string;
  photoLoadFailed: string;
  pdfMeta(size: number): string;
  pdfA11y(name: string, size: number): string;
  share: string;
  openFailed: string;
  popupBlocked: string;
  shareUnavailable: string;
  coPrefillFiles(names: string): string;
  close: string;
  open: string;
  download: string;
  size(bytes: number): string;
  /** "Read with MAGE" on a client's message (lane ATTPORTAL). The failure
   *  sentences and the "What I read" block come from useAskCopy().files. */
  ai: {
    read: string;
    readA11y: string;
    sheetTitle: string;
    willRead: string;
    notRead: string;
    notReadCount(count: number): string;
    notReadSize(mb: number): string;
    notReadTotal(mb: number): string;
    notReadPages(limit: number): string;
    notReadUnreadable: string;
    notReadMissing: string;
    noneReadable: string;
    goesTo: string;
    counts: string;
    start: string;
    reading: string;
    summary: string;
    asks: string;
    asksNone: string;
    draft: string;
    draftNote: string;
    draftNone: string;
    startCo: string;
    startRfi: string;
    startPunch: string;
    punchLocked: string;
    planLocked: string;
    seePlans: string;
    notSaved: string;
    notPosted: string;
    accountOff: string;
    accountUnknown: string;
    beforeNotice: string;
    moreNotRead(count: number): string;
  };
}

export function useMessageAttachmentCopy(): MessageAttachmentCopy {
  const { t, tn } = useT();
  return useMemo<MessageAttachmentCopy>(() => {
    const size = (bytes: number) => formatBytes(Math.max(0, Number(bytes) || 0));
    return {
      attachA11y: t('office.clientMessages.attach.a11y', 'Attach a photo or PDF'),
      sheetTitle: t('office.clientMessages.attach.sheetTitle', 'Attach'),
      takePhoto: t('office.clientMessages.attach.takePhoto', 'Take photo'),
      choosePhotos: t('office.clientMessages.attach.choosePhotos', 'Choose photos'),
      choosePdf: t('office.clientMessages.attach.choosePdf', 'Choose a PDF'),
      cancel: t('common.action.cancel', 'Cancel'),
      refusal(reason, name, bytes) {
        switch (reason) {
          case 'type': return t('office.clientMessages.refuse.type', "{name} can't be sent. Send a photo (JPG, PNG or WebP) or a PDF.", { name });
          case 'size': return t('office.clientMessages.refuse.size', '{name} is {size}. Files can be up to 20 MB.', { name, size: size(bytes ?? 0) });
          case 'empty': return t('office.clientMessages.refuse.empty', "{name} is empty, so it can't be sent.", { name });
          case 'count': return t('office.clientMessages.refuse.count', 'A message can carry up to 10 files.');
          case 'cameraDenied': return t('office.clientMessages.refuse.cameraDenied', 'MAGE ID needs camera access to take a photo. Turn it on in Settings.');
          case 'photosDenied': return t('office.clientMessages.refuse.photosDenied', 'MAGE ID needs photo access to attach a photo. Turn it on in Settings.');
          default: return t('office.clientMessages.fail.server', "The upload didn't finish. Retry when you have a good connection.");
        }
      },
      trayRemoveA11y: (name) => t('office.clientMessages.tray.remove.a11y', 'Remove {name}', { name }),
      uploading: (done, count) => tn('office.clientMessages.state.uploading', count, { one: 'Uploading…', other: 'Uploading {done} of {count}…' }, { done }),
      waitingNetwork: (web) => (web
        ? t('office.clientMessages.state.waitingNetworkWeb', "Waiting for a connection. Keep this page open and it sends when you're back online.")
        : t('office.clientMessages.state.waitingNetwork', "Waiting for a connection. It sends when you're back online.")),
      sending: t('office.clientMessages.state.sending', 'Sending…'),
      queued: t('office.clientMessages.state.queued', 'Waiting to send'),
      notSent: t('office.clientMessages.state.notSent', 'Not sent'),
      failReason(reason) {
        switch (reason) {
          case 'gone': return t('office.clientMessages.fail.gone', 'The file is no longer on this device. Remove the message and attach the file again.');
          case 'refused': return t('office.clientMessages.fail.refused', "The server didn't accept this file. Check that the client portal is on, then retry.");
          case 'type_mismatch': return t('office.clientMessages.fail.typeMismatch', "This file isn't the photo or PDF it says it is, so it wasn't sent.");
          case 'write_failed': return t('office.clientMessages.fail.writeFailed', "The files are uploaded but the message didn't send. Retry.");
          case 'server':
          default: return t('office.clientMessages.fail.server', "The upload didn't finish. Retry when you have a good connection.");
        }
      },
      retry: t('common.action.retry', 'Retry'),
      remove: t('common.action.remove', 'Remove'),
      removeTitle: t('office.clientMessages.remove.title', 'Remove this message?'),
      removeBody: t('office.clientMessages.remove.body', 'It was never sent. Its text and files are removed from this device.'),
      photoA11y: (name) => t('office.clientMessages.photo.a11y', 'Photo {name}. Opens full screen.', { name }),
      photoMore: (count) => t('office.clientMessages.photo.more', '+{count}', { count }),
      photoLoadFailed: t('office.clientMessages.photo.loadFailed', "Couldn't load this photo."),
      pdfMeta: (bytes) => t('office.clientMessages.pdf.meta', 'PDF · {size}', { size: size(bytes) }),
      pdfA11y: (name, bytes) => t('office.clientMessages.pdf.a11y', '{name}, PDF, {size}. Opens the file.', { name, size: size(bytes) }),
      share: t('office.clientMessages.share', 'Save or share'),
      openFailed: t('office.clientMessages.open.failed', "Couldn't open the file. Check your connection and try again."),
      popupBlocked: t('office.clientMessages.open.popupBlocked', 'Your browser blocked the new tab. Allow pop-ups for MAGE ID, then try again.'),
      shareUnavailable: t('office.clientMessages.share.unavailable', "Sharing isn't available on this device."),
      coPrefillFiles: (names) => t('office.clientMessages.coPrefill.files', 'Files: {names}', { names }),
      close: t('common.action.close', 'Close'),
      open: t('common.action.open', 'Open'),
      download: t('common.action.download', 'Download'),
      size,
      ai: {
        read: t('office.clientMessages.ai.read', 'Read with MAGE'),
        readA11y: t('office.clientMessages.ai.read.a11y', 'Have MAGE read the files on this message'),
        sheetTitle: t('office.clientMessages.ai.sheet.title', 'Read with MAGE'),
        willRead: t('office.clientMessages.ai.willRead', 'MAGE will read:'),
        notRead: t('office.clientMessages.ai.notRead', 'Not read:'),
        notReadCount: (count) => t('office.clientMessages.ai.notRead.count', 'more than {count} files', { count }),
        notReadSize: (mb) => t('office.clientMessages.ai.notRead.size', 'over {mb} MB', { mb }),
        notReadTotal: (mb) => t('office.clientMessages.ai.notRead.total', 'over {mb} MB together', { mb }),
        notReadPages: (limit) => t('office.clientMessages.ai.notRead.pages', 'more than {limit} pages', { limit }),
        notReadUnreadable: t('office.clientMessages.ai.notRead.unreadable', 'could not be opened'),
        notReadMissing: t('office.clientMessages.ai.notRead.missing', 'not available'),
        noneReadable: t('office.clientMessages.ai.noneReadable', "MAGE can't read any of the files on this message."),
        goesTo: t('office.clientMessages.ai.goesTo', 'The files and the message text go to Google Gemini to be read. Nothing is sent to your client.'),
        counts: t('office.clientMessages.ai.counts', 'Counts as one of your monthly photo analyses.'),
        start: t('office.clientMessages.ai.start', 'Read files'),
        reading: t('office.clientMessages.ai.reading', 'Reading the files'),
        summary: t('office.clientMessages.ai.summary', 'Summary'),
        asks: t('office.clientMessages.ai.asks', 'What the client is asking for'),
        asksNone: t('office.clientMessages.ai.asks.none', 'MAGE found no request in the message or the files it read.'),
        draft: t('office.clientMessages.ai.draft', 'Draft'),
        draftNote: t('office.clientMessages.ai.draft.note', "Drafted by MAGE from the client's message. Check it against the files before you save."),
        draftNone: t('office.clientMessages.ai.draft.none', 'No draft, because MAGE found no request.'),
        startCo: t('office.clientMessages.ai.startCo', 'Start a change order'),
        startRfi: t('office.clientMessages.ai.startRfi', 'Start an RFI'),
        startPunch: t('office.clientMessages.ai.startPunch', 'Start a punch item'),
        punchLocked: t('office.clientMessages.ai.punchLocked', 'Punch lists are on the Business plan.'),
        planLocked: t('office.clientMessages.ai.planLocked', 'Reading client files with MAGE is on the Pro plan.'),
        seePlans: t('office.clientMessages.ai.seePlans', 'See plans'),
        notSaved: t('office.clientMessages.ai.notSaved', 'This reading is not saved. Close it and it is gone.'),
        notPosted: t('office.clientMessages.ai.notPosted', 'Nothing here is posted to the thread or sent to your client.'),
        accountOff: t('office.clientMessages.ai.accountOff', 'Your account has not allowed AI features, so nothing was sent to Google. Check Settings → AI features, then try again.'),
        accountUnknown: t('office.clientMessages.ai.accountUnknown', "MAGE couldn't check your account's AI setting. Try again in a minute."),
        beforeNotice: t('office.clientMessages.ai.beforeNotice', 'This message was sent before your client was told about AI reading, so MAGE does not read it.'),
        moreNotRead: (count) => tn('office.clientMessages.ai.moreNotRead', count, { one: '(1 more not read)', other: '({count} more not read)' }),
      },
    };
  }, [t, tn]);
}
