// components/codeCard/EvidenceMeter.tsx — four bars, one per rung of
// utils/codeAmendments.ts (amended, named, edition, unresolved), and the words
// that say which rung this section stands on.
//
// Recall keeps its label in the same place at the same size on every card;
// its tone is neutral grey, not amber (founder decision). The two government
// rungs fill teal. The badge and the detail sentence are codeAmendments' own.
//
// A PARENT MATCH IS RECALL (utils/codeCard/evidence.ts): grey bars and the
// recall label first, in the same place; the parent badge goes UNDER it on the
// opened card, never in its place.

import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CitationEvidence } from '@/utils/codeAmendments';
import { badgeSentence, evidenceView } from '@/utils/codeCard/evidence';
import { useCodeCardPalette, type CodeCardPalette } from './palette';

const BAR_HEIGHTS = [4, 6, 8.5, 11] as const;

export interface EvidenceMeterProps {
  evidence: CitationEvidence | null | undefined;
  /** compact: bars + short label (card meta line). full: bars + badge + detail (opened card). */
  variant?: 'compact' | 'full';
  sunlight?: boolean;
  testID?: string;
}

export function EvidenceBars({ evidence, sunlight }: { evidence: CitationEvidence | null | undefined; sunlight?: boolean }) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const v = evidenceView(evidence);
  const on = v.tone === 'government' ? P.success : P.barOn;
  return (
    <View style={styles.bars}>
      {BAR_HEIGHTS.map((h, i) => (
        <View key={h} style={[styles.bar, { height: h, backgroundColor: i < v.bars ? on : P.barOff }]} />
      ))}
    </View>
  );
}

export function EvidenceMeter({ evidence, variant = 'compact', sunlight, testID }: EvidenceMeterProps) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const v = evidenceView(evidence);
  const a11y = `Evidence ${v.bars} of 4: ${v.parent ? `${v.short}. ` : ''}${badgeSentence(v.badge)}. ${v.detail}`;

  if (variant === 'full') {
    return (
      <View style={styles.full} testID={testID} accessible accessibilityLabel={a11y}>
        <View style={styles.row}>
          <EvidenceBars evidence={evidence} sunlight={sunlight} />
          <Text style={styles.badge}>{v.parent ? v.short : badgeSentence(v.badge)}</Text>
        </View>
        {v.parent ? <Text style={styles.badge}>{badgeSentence(v.badge)}</Text> : null}
        <Text style={styles.detail}>{v.detail}</Text>
      </View>
    );
  }
  return (
    <View style={styles.row} testID={testID} accessible accessibilityLabel={a11y}>
      <EvidenceBars evidence={evidence} sunlight={sunlight} />
      <Text style={styles.short} numberOfLines={1}>{v.short}</Text>
    </View>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 11 },
    bar: { width: 3, borderRadius: 1 },
    row: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
    short: { fontSize: 12.5 + P.bump / 2, fontWeight: '500', color: P.ink2, lineHeight: 14 + P.bump / 2 },
    full: { gap: 4 },
    badge: { fontSize: 12.5 + P.bump / 2, fontWeight: '600', color: P.ink2, lineHeight: 14 + P.bump / 2 },
    detail: { fontSize: 12.5 + P.bump / 2, lineHeight: 17 + P.bump / 2, color: P.ink2 },
  });
