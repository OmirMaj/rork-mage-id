// components/roomScan/TapeFactsPanel.tsx — What Your Tape Says.
//
// Facts from the walls this person taped on this phone (utils/roomScan/
// learnCore): how many, how many within an inch, the typical difference and
// the largest. Counts and inches. There is no score here and no sentence about
// a wall he did not check; with too few walls it says there is not enough to
// tell and shows no difference at all.
//
// A SUGGESTION IS A CARD WITH TWO BUTTONS. It says why, and it does nothing
// until he taps to add it. Not Now leaves the list as it is.
import React from 'react';
import { Text, View } from 'react-native';
import { Ruler } from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Button } from '@/components/ui';
import type { ScanOrderCopy } from '@/hooks/useScanOrderCopy';
import type { LongWallSuggestion, TapeFacts } from '@/utils/roomScan/learnCore';
import { makeRoomScanStyles } from './styles';

export interface WasteOffer { trade: string; tradeWord: string; jobCount: number; pct: number }

export interface TapeFactsPanelProps {
  facts: TapeFacts;
  /** The suggestion his history supports, or null. */
  suggestion: LongWallSuggestion | null;
  /** Inches already added by an accepted suggestion. 0 = none. */
  acceptedIn: number;
  ignored: boolean;
  copy: ScanOrderCopy;
  onAccept: (addIn: number) => void;
  onIgnore: () => void;
  onRemove: () => void;
  /** "Bought versus scanned" offers. Empty in this lane: the app holds no bought quantities to make one from. */
  wasteOffers?: WasteOffer[];
  onAcceptWaste?: (offer: WasteOffer) => void;
}

export function TapeFactsPanel(p: TapeFactsPanelProps) {
  const { facts, copy } = p;
  const { colors } = useTheme();
  const styles = useThemedStyles(makeRoomScanStyles);
  return (
    <View style={styles.card} testID="scan-tape-facts">
      <View style={styles.legendRow}>
        <Ruler size={16} color={colors.textMuted} />
        <Text style={styles.cardHeading}>{copy.tapeHeadingLabel}</Text>
      </View>
      <Text style={styles.para} testID={facts.enough ? 'scan-tape-facts-body' : 'scan-tape-facts-not-enough'}>{copy.tapeFactsBody(facts)}</Text>
      {facts.farCount > 0 && <Text style={styles.note} testID="scan-tape-far">{copy.tapeFarNote(facts.farCount)}</Text>}
      <Text style={styles.note}>{copy.tapeScopeNote}</Text>
      {p.acceptedIn > 0 ? (
        <View style={styles.blocked} testID="scan-tape-accepted">
          <Text style={styles.blockedText}>{copy.suggestAcceptedNote(copy.inchesText(p.acceptedIn))}</Text>
          <View style={styles.sheetActions}>
            <Button label={copy.suggestRemoveLabel} variant="ghost" size="sm" onPress={p.onRemove} testID="scan-tape-remove" />
          </View>
        </View>
      ) : p.suggestion && !p.ignored ? (
        <View style={styles.blocked} testID="scan-tape-suggestion">
          <Text style={styles.blockedText}>{copy.suggestBody(p.suggestion)}</Text>
          <View style={styles.sheetActions}>
            <Button label={copy.suggestIgnoreLabel} variant="ghost" size="sm" onPress={p.onIgnore} testID="scan-tape-ignore" />
            <Button label={copy.suggestAcceptLabel(copy.inchesText(p.suggestion.addIn))} variant="secondary" size="sm" onPress={() => p.onAccept((p.suggestion as LongWallSuggestion).addIn)} testID="scan-tape-accept" />
          </View>
        </View>
      ) : null}
      {(p.wasteOffers ?? []).map((offer) => (
        <View key={offer.trade} style={styles.blocked} testID={`scan-waste-offer-${offer.trade}`}>
          <Text style={styles.blockedText}>{copy.wasteOfferBody(offer.tradeWord, offer.jobCount, offer.pct)}</Text>
          <View style={styles.sheetActions}>
            <Button label={copy.wasteOfferAcceptLabel(offer.pct)} variant="secondary" size="sm" onPress={() => p.onAcceptWaste?.(offer)} testID={`scan-waste-accept-${offer.trade}`} />
          </View>
        </View>
      ))}
    </View>
  );
}
