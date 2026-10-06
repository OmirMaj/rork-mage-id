// components/codeCard/JurisdictionBlock.tsx — said ONCE per answer: the code in
// force at this address and the office that issues the permit, each with its
// own source and its own check date.
//
// Both facts come from hand-verified tables (utils/codeJurisdiction.ts and
// utils/permitOffices.ts permitOfficeFor()) through codeJurisdictionInfoFor.
// A missing fact says it is missing; nothing is filled from recall.

import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Building2, Landmark } from 'lucide-react-native';
import { Card } from '@/components/ui';
import type { CodeJurisdictionInfo } from '@/utils/codeCard/types';
import { sourceLine } from '@/utils/codeCard/jurisdiction';
import { useCodeCardPalette, type CodeCardPalette } from './palette';

export interface JurisdictionBlockProps {
  info: CodeJurisdictionInfo;
  sunlight?: boolean;
  testID?: string;
}

export const EDITION_MISSING = 'Not Confirmed for This Address';
export const EDITION_MISSING_LINE = 'MAGE has no verified adoption record here. Ask your building department which edition applies.';
export const OFFICE_MISSING = 'Not Found for This Address';
export const OFFICE_UNVERIFIED = 'Contact details not verified by MAGE';

function openSource(url: string | null) {
  if (!url) return;
  Linking.openURL(url).catch(() => { /* the line stays readable */ });
}

export function JurisdictionBlock({ info, sunlight, testID }: JurisdictionBlockProps) {
  const P = useCodeCardPalette(sunlight);
  const styles = useMemo(() => makeStyles(P), [P]);
  const editionSrc = info.editionLabel ? sourceLine(info.editionSourceUrl, info.editionCheckedOn) : null;
  const officeSrc = info.permitOfficeTitle ? sourceLine(info.permitOfficeSourceUrl, info.permitOfficeCheckedOn) : null;

  const src = (text: string | null, url: string | null, fallback: string, label: string) => {
    if (!text) {
      return (
        <View style={styles.srcRow}>
          <View style={[styles.dot, styles.dotOff]} />
          <Text style={styles.srcOff}>{fallback}</Text>
        </View>
      );
    }
    return (
      <Pressable
        onPress={() => openSource(url)}
        disabled={!url}
        accessibilityRole="link"
        accessibilityLabel={`${label} source: ${text}`}
        style={styles.srcRow}
        hitSlop={6}
      >
        <View style={styles.dot} />
        <Text style={styles.srcText}>{text}</Text>
      </Pressable>
    );
  };

  return (
    <Card pad="none" radius="lg" style={[styles.card, P.sunlight && styles.cardSun]} testID={testID}>
      <View style={styles.row}>
        <View style={styles.icon}><Landmark size={17} color={P.ink} strokeWidth={1.9} /></View>
        <View style={styles.text}>
          <Text style={styles.eyebrow}>Code in Force</Text>
          <Text style={styles.value}>{info.editionLabel ?? EDITION_MISSING}</Text>
          {info.editionLabel
            ? src(editionSrc, info.editionSourceUrl, 'Source Not on File', 'Code')
            : <Text style={styles.srcOff}>{EDITION_MISSING_LINE}</Text>}
        </View>
      </View>
      <View style={[styles.row, styles.rowRule]}>
        <View style={styles.icon}><Building2 size={17} color={P.ink} strokeWidth={1.9} /></View>
        <View style={styles.text}>
          <Text style={styles.eyebrow}>Permit Office</Text>
          <Text style={styles.value}>{info.permitOfficeTitle ?? OFFICE_MISSING}</Text>
          {info.permitOfficeTitle ? src(officeSrc, info.permitOfficeSourceUrl, OFFICE_UNVERIFIED, 'Permit Office') : null}
        </View>
      </View>
    </Card>
  );
}

const makeStyles = (P: CodeCardPalette) =>
  StyleSheet.create({
    card: { marginVertical: 16 },
    cardSun: { borderWidth: 2, borderColor: P.line, backgroundColor: P.surface },
    row: { flexDirection: 'row', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
    rowRule: { borderTopWidth: P.rule, borderTopColor: P.line },
    icon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: P.soft },
    text: { flex: 1 },
    eyebrow: { fontSize: 10.5 + P.bump / 2, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: P.ink3 },
    value: { fontSize: 15 + P.bump, lineHeight: 19 + P.bump, fontWeight: '600', color: P.ink, marginTop: 2 },
    srcRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, minHeight: 20 },
    dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: P.success },
    dotOff: { backgroundColor: P.barOff },
    srcText: { flex: 1, fontSize: 12.5 + P.bump / 2, fontWeight: '500', color: P.successLabel },
    srcOff: { flex: 1, fontSize: 12.5 + P.bump / 2, lineHeight: 17 + P.bump / 2, color: P.ink2, marginTop: 4 },
  });
