// components/livingModel/SyncStatus.tsx — where the job model is saved, said
// in one line that is true at that moment, and the questions saving to the
// account can raise (lane LIVINGSYNC):
//   "Saved on this device only for now. It will not appear on your other devices."
//   "Saved to your account." with the time
//   "Waiting to send. It is saved on this device."
//   "Could not save to your account. It is saved on this device."
//   "You can view this model. Only the owner and editors can change it."
// The rules are utils/livingModel/syncCore; hooks/useLivingModelSync runs them.
//
// THE SCAN QUESTION. A room dropped in from a phone scan carries that scan's
// sizes, and the phone tells people a scan's measurements stay on the phone.
// So before such a room is sent for the first time the person is asked, in
// plain words that name what is sent and which rooms, and nothing is sent
// until he taps Save to My Account. A room scanned and added later is asked
// about again. Keep on This Phone stops every send from this phone and takes
// a waiting save back; if a copy may already be in the account the panel says
// so and offers Remove It From My Account, which asks once more before it
// deletes the account's copy. The model on the phone is never touched by it.
//
// THE BOTH-CHANGED QUESTION. When this device and the account have both
// changed, or this device's model is empty and the account's is not, neither
// is replaced. He chooses; the one he does not keep stays on the device until
// he removes it. When a TEAMMATE's save takes this device's place, the copy
// that was here is kept the same way and the panel says so.
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy, type LivingModelCopy } from '@/hooks/useLivingModelCopy';
import type { LivingModelSync } from '@/hooks/useLivingModelSync';
import { Button } from '@/components/ui';
import { makeLivingModelStyles } from './styles';

/** "3:42 PM" today, "Oct 9, 3:42 PM" on another day. '' for a time that cannot be read. */
export function whenText(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** The second sentence of the saved line: who saved the account's copy and when. */
export function savedDetail(copy: LivingModelCopy, sync: Pick<LivingModelSync, 'savedAt' | 'lastChange'>, nameOf: (userId: string | null) => string | null): string {
  const c = sync.lastChange;
  if (c) {
    const t = whenText(c.at);
    if (!t) return '';
    if (c.byMe) return copy.changedByYouBody(t);
    const name = nameOf(c.userId);
    return name ? copy.changedByNameBody(name, t) : copy.changedByTeammateBody(t);
  }
  const t = whenText(sync.savedAt);
  return t ? copy.savedAtBody(t) : '';
}

export function SyncStatus({ sync, deviceRooms, hasScanRoom, nameOf, roomNameOf }: {
  sync: LivingModelSync;
  /** How many rooms the model on this device has (for the both-changed question). */
  deviceRooms: number;
  /** True when the model on this device has a room that came from a scan. */
  hasScanRoom: boolean;
  nameOf: (userId: string | null) => string | null;
  /** The name of a room of the model on screen, or null when it is not in it. */
  roomNameOf: (roomId: string) => string | null;
}) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const { status, conflict, kept } = sync;
  const detail = savedDetail(copy, sync, nameOf);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const names = (ids: readonly string[]): string => ids.map(roomNameOf).filter((n): n is string => !!n).join(', ');
  const askNames = names(sync.scanAskRoomIds);
  const accountScanNames = names(sync.accountScanRoomIds);

  return (
    <View style={styles.stack} testID="lm-sync">
      {status === 'device' ? (
        <Text style={styles.note} testID="lm-saved-local">{`${copy.savedLocalBody} ${copy.otherDevicesBody}`}</Text>
      ) : null}
      {status === 'checking' ? <Text style={styles.note} testID="lm-sync-checking">{copy.syncCheckingBody}</Text> : null}
      {status === 'retrying' ? <Text style={styles.note} testID="lm-sync-retrying">{copy.retryingBody}</Text> : null}
      {status === 'saved' ? <Text style={styles.note} testID="lm-sync-saved">{detail ? `${copy.savedAccountBody} ${detail}` : copy.savedAccountBody}</Text> : null}
      {status === 'waiting' ? <Text style={styles.note} testID="lm-sync-waiting">{copy.syncWaitingBody}</Text> : null}
      {status === 'failed' ? <Text style={styles.warn} testID="lm-sync-failed">{copy.syncFailedBody}</Text> : null}
      {status === 'view_only' ? <Text style={styles.note} testID="lm-sync-view-only">{copy.viewOnlyBody}</Text> : null}
      {status === 'account_newer' ? <Text style={styles.warn} testID="lm-sync-account-newer">{copy.accountNewerBody}</Text> : null}
      {status === 'account_too_large' ? <Text style={styles.warn} testID="lm-sync-account-too-large">{copy.accountTooLargeBody}</Text> : null}
      {status === 'account_removed' ? (
        <View style={styles.panel} testID="lm-account-removed">
          <Text style={styles.para}>{copy.accountRemovedBody}</Text>
          <Button label={copy.saveToAccountLabel} variant="secondary" onPress={sync.saveAgain} testID="lm-account-removed-save" />
        </View>
      ) : null}
      {accountScanNames && (status === 'saved' || status === 'waiting') ? <Text style={styles.note} testID="lm-account-scan-rooms">{copy.accountScanRoomsBody(accountScanNames)}</Text> : null}

      {status === 'scan_ask' ? (
        <View style={styles.panel} testID="lm-scan-ask">
          <Text style={styles.panelHeading}>{copy.scanAskTitleBody}</Text>
          <Text style={styles.para}>{copy.scanAskBody}</Text>
          {askNames ? <Text style={styles.para} testID="lm-scan-ask-rooms">{copy.scanAskRoomsBody(askNames)}</Text> : null}
          <Text style={styles.note} testID="lm-sync-scan-not-sent">{copy.scanNotSentBody}</Text>
          <Button label={copy.saveToAccountLabel} variant="primary" onPress={() => sync.answerScan('account')} testID="lm-scan-ask-account" />
          <Button label={copy.keepOnPhoneLabel} variant="secondary" onPress={() => sync.answerScan('device')} testID="lm-scan-ask-device" />
        </View>
      ) : null}
      {status === 'kept_on_device' ? (
        <View style={styles.panel} testID="lm-kept-on-phone">
          <Text style={styles.para}>{sync.accountMayHold ? `${copy.keptOnPhoneStoppedBody} ${copy.keptOnPhoneMayBody}` : copy.keptOnPhoneBody}</Text>
          {sync.removeState === 'removed' ? <Text style={styles.note} testID="lm-account-copy-removed">{copy.removedBody}</Text> : null}
          {sync.removeState === 'failed' ? <Text style={styles.warn} testID="lm-account-copy-not-removed">{copy.removeFailedBody}</Text> : null}
          {sync.scanAskRoomIds.length > 0 ? <Text style={styles.note}>{copy.scanAskBody}</Text> : null}
          {sync.scanAskRoomIds.length > 0 && askNames ? <Text style={styles.note}>{copy.scanAskRoomsBody(askNames)}</Text> : null}
          <Button label={copy.saveToAccountLabel} variant="secondary" onPress={() => sync.answerScan('account')} testID="lm-kept-on-phone-change" />
          {sync.accountMayHold && !confirmRemove ? (
            <Button label={copy.removeFromAccountLabel} variant="ghost" size="sm" onPress={() => setConfirmRemove(true)} disabled={sync.busy} testID="lm-remove-from-account" />
          ) : null}
          {sync.accountMayHold && confirmRemove ? (
            <View style={styles.stack} testID="lm-remove-confirm">
              <Text style={styles.warn}>{copy.removeConfirmBody}</Text>
              <Button label={copy.removeConfirmLabel} variant="destructive" onPress={() => { setConfirmRemove(false); sync.removeFromAccount(); }} disabled={sync.busy} testID="lm-remove-from-account-yes" />
              <Button label={copy.cancelLabel} variant="secondary" onPress={() => setConfirmRemove(false)} testID="lm-remove-from-account-cancel" />
            </View>
          ) : null}
        </View>
      ) : null}
      {sync.scanChoice === 'account' && hasScanRoom && status !== 'conflict' ? (
        <Button label={copy.keepOnPhoneLabel} variant="ghost" size="sm" onPress={() => sync.answerScan('device')} testID="lm-scan-change-device" />
      ) : null}

      {kept ? (
        <View style={styles.panel} testID="lm-kept">
          <Text style={styles.para} testID={kept.why === 'teammate' ? 'lm-kept-teammate' : undefined}>{kept.why === 'teammate' ? copy.teammateKeptBody : kept.from === 'account' ? copy.keptFromAccountBody : copy.keptFromDeviceBody}</Text>
          {conflict ? <Text style={styles.warn} testID="lm-kept-first">{`${copy.conflictTitleBody} ${copy.keptFirstBody}`}</Text> : null}
          {conflict ? null : <Button label={copy.useKeptLabel} variant="secondary" onPress={sync.bringBackKept} disabled={sync.busy} testID="lm-kept-use" />}
          <Button label={copy.removeKeptLabel} variant="secondary" onPress={sync.removeKept} disabled={sync.busy} testID="lm-kept-remove" />
        </View>
      ) : null}
      {conflict && !kept ? (
        <View style={styles.panel} testID="lm-conflict">
          <Text style={styles.panelHeading}>{conflict.deviceEmpty ? copy.conflictEmptyTitleBody : copy.conflictTitleBody}</Text>
          <Text style={styles.para}>{conflict.deviceEmpty ? copy.conflictEmptyBody : copy.conflictBody}</Text>
          <Text style={styles.note}>{copy.conflictDeviceSub(deviceRooms)}</Text>
          <Text style={styles.note}>{detail ? `${copy.conflictAccountSub(conflict.account.rooms.length)}. ${detail}` : copy.conflictAccountSub(conflict.account.rooms.length)}</Text>
          <Button label={copy.keepDeviceLabel} variant="secondary" onPress={sync.keepThisDevice} disabled={sync.busy} testID="lm-conflict-keep-device" />
          <Button label={copy.useAccountLabel} variant="secondary" onPress={sync.takeAccountModel} disabled={sync.busy} testID="lm-conflict-use-account" />
        </View>
      ) : null}
      {sync.choiceFailed ? <Text style={styles.warn} testID="lm-choice-failed">{copy.choiceFailedBody}</Text> : null}
    </View>
  );
}
