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
    };
  }, [t, tn]);
}
