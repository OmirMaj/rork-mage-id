// components/roomScan/ScanFactsPanel.tsx — the owner's view of what a scan
// actually returned. Drawn only for the owner (utils/roomScan/allowed
// scanRoomOwnerTools); the flow decides, this file only draws.
//
// Three counts of the same room side by side: what the iPhone counted in Swift,
// what the JSON file's own lists hold, and what the app's parser understood. A
// difference between them is the first thing to look at after a first scan.
// Below them: the first wall on the iPhone and in the app, the raw size, the
// top-level keys, the real error text when there is one, and the button that
// shares the raw file.
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '@/components/ui';
import type { RoomScanCopy } from '@/hooks/useRoomScanCopy';
import type { ScanFactsReport } from '@/utils/roomScan/scanDebugCore';
import { formatFeetInches } from '@/utils/roomScan/units';
import type { RoomScanStyles } from './styles';

export type RawShareState = { outcome: 'shared' | 'unavailable' | 'failed'; file: string; error: string } | null;

export interface ScanFactsPanelProps {
  facts: ScanFactsReport;
  copy: RoomScanCopy;
  styles: RoomScanStyles;
  /** False when the phone could not write the raw data to its storage. */
  rawKept: boolean;
  sharing: boolean;
  shareState: RawShareState;
  onShare: () => void;
}

export function ScanFactsPanel({ facts, copy, styles, rawKept, sharing, shareState, onShare }: ScanFactsPanelProps) {
  const num = (n: number | null) => (n === null ? copy.notKnownLabel : String(n));
  const fw = facts.firstWall;
  return (
    <View style={styles.card} testID="scan-facts">
      <Text style={styles.cardHeading}>{copy.factsHeadingLabel}</Text>
      <Text style={styles.note}>{copy.ownerOnlySub}</Text>
      <View style={[styles.row, styles.rowFirst]}>
        <Text style={styles.rowLabel}>{copy.factIosLabel}</Text>
        <Text style={styles.rowSub} testID="scan-facts-ios">{facts.osVersion || copy.notKnownLabel}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{copy.factDeviceLabel}</Text>
        <Text style={styles.rowSub} testID="scan-facts-device">{facts.deviceModel || copy.notKnownLabel}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{copy.factDurationLabel}</Text>
        <Text style={styles.rowSub} testID="scan-facts-duration">{facts.durationSeconds === null ? copy.notKnownLabel : copy.durationValue(facts.durationSeconds)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel}>{copy.rawSizeLabel}</Text>
        <Text style={styles.rowSub} testID="scan-facts-raw-size">{copy.rawSizeValue(facts.rawLength)}</Text>
      </View>
      <View style={styles.row}>
        <View style={styles.rowMain}>
          <Text style={styles.rowLabel}>{copy.topKeysLabel}</Text>
          <Text style={styles.rowSub} testID="scan-facts-keys">{facts.topLevelKeys.length ? facts.topLevelKeys.join(', ') : copy.noneFoundSub}</Text>
        </View>
      </View>

      <Text style={styles.cardHeading}>{copy.countsHeadingLabel}</Text>
      <View style={[styles.row, styles.rowFirst]}>
        <Text style={[styles.eyebrow, { flex: 2 }]}> </Text>
        <Text style={[styles.eyebrow, { flex: 1 }]}>{copy.countSourceLabel('phone')}</Text>
        <Text style={[styles.eyebrow, { flex: 1 }]}>{copy.countSourceLabel('file')}</Text>
        <Text style={[styles.eyebrow, { flex: 1 }]}>{copy.countSourceLabel('app')}</Text>
      </View>
      {facts.counts.map((c) => (
        <View key={c.key} style={styles.row} testID={`scan-facts-count-${c.key}`}>
          <Text style={[styles.rowLabel, { flex: 2 }, !c.match && styles.factCheck]}>{copy.countName(c.key)}</Text>
          <Text style={[styles.rowSub, { flex: 1 }]}>{num(c.phone)}</Text>
          <Text style={[styles.rowSub, { flex: 1 }]}>{num(c.file)}</Text>
          <Text style={[styles.rowSub, { flex: 1 }]}>{num(c.app)}</Text>
        </View>
      ))}
      <Text style={facts.mismatch ? styles.errorText : styles.okText} testID={facts.mismatch ? 'scan-facts-mismatch' : 'scan-facts-match'}>
        {facts.mismatch ? copy.countsMismatchBody : copy.countsMatchBody}
      </Text>

      {(fw.phoneDimensions || fw.appWidthM !== null) && (
        <>
          <Text style={styles.cardHeading}>{copy.firstWallLabel}</Text>
          {fw.phoneDimensions && (
            <Text style={styles.note} testID="scan-facts-wall-phone">{copy.firstWallSub('phone', formatFeetInches(fw.phoneDimensions[0] ?? 0), formatFeetInches(fw.phoneDimensions[1] ?? 0))}</Text>
          )}
          {fw.appWidthM !== null && (
            <Text style={styles.note} testID="scan-facts-wall-app">{copy.firstWallSub('app', formatFeetInches(fw.appWidthM), formatFeetInches(fw.appHeightM ?? 0))}</Text>
          )}
          {fw.match !== null && <Text style={fw.match ? styles.okText : styles.errorText}>{copy.firstWallMatchBody(fw.match)}</Text>}
        </>
      )}

      {!!facts.errorText && (
        <View style={styles.rowMain}>
          <Text style={styles.cardHeading}>{copy.errorLabel}</Text>
          <Text style={styles.errorText} selectable testID="scan-facts-error">{facts.errorText}</Text>
        </View>
      )}

      {!rawKept && <Text style={styles.errorText}>{copy.rawKeepFailedBody}</Text>}
      <Text style={styles.note}>{copy.shareRawBody}</Text>
      <Button label={copy.shareRawLabel} variant="secondary" onPress={onShare} loading={sharing} testID="scan-share-raw" />
      {shareState && (
        <Text style={shareState.outcome === 'shared' ? styles.okText : styles.errorText} testID={`scan-share-raw-${shareState.outcome}`}>
          {copy.shareRawResultBody(shareState.outcome, shareState.file)}
        </Text>
      )}
      {shareState?.outcome === 'failed' && !!shareState.error && <Text style={styles.errorText} selectable testID="scan-share-raw-error">{shareState.error}</Text>}
    </View>
  );
}
