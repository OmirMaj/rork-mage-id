// CeremonyDocTop — the document summary in the TOP panel of the signing
// letter: what is being signed, by whom, for how much, and a way to read it
// all before signing. An optional `aside` (the ceremony's status chip) sits
// top-right.

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';

export interface CeremonyDocRow {
  label: string;
  value: string;
  mono?: boolean;
}

export interface CeremonyDocTopProps {
  docTitle: string;
  subtitle?: string;
  rows: CeremonyDocRow[];
  link?: { label: string; onPress: () => void };
  aside?: React.ReactNode;
  testID?: string;
}

export function CeremonyDocTop({ docTitle, subtitle, rows, link, aside, testID }: CeremonyDocTopProps) {
  const s = useThemedStyles(makeStyles);
  return (
    <View testID={testID}>
      <View style={s.head}>
        <Text style={s.docTitle} numberOfLines={1} accessibilityRole="header">
          {docTitle}
        </Text>
        {aside}
      </View>
      {subtitle ? (
        <Text style={s.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
      {rows.map((r) => (
        <View key={r.label} style={s.row}>
          <Text style={s.rowLabel} numberOfLines={1}>
            {r.label}
          </Text>
          <Text style={r.mono ? s.rowMono : s.rowValue} numberOfLines={1}>
            {r.value}
          </Text>
        </View>
      ))}
      {link ? (
        <Pressable onPress={link.onPress} accessibilityRole="link" hitSlop={8} style={s.linkWrap}>
          <Text style={s.link}>{link.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    head: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
    docTitle: { ...Type.title3, fontWeight: '700', color: t.text, flexShrink: 1 },
    subtitle: { ...Type.footnote, color: t.textSecondary, marginTop: 3, marginBottom: 12 },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 6,
      borderTopWidth: 1,
      borderTopColor: t.line,
    },
    rowLabel: { ...Type.footnote, color: t.textSecondary, flexShrink: 1 },
    rowValue: { ...Type.footnote, fontWeight: '600', color: t.text },
    rowMono: { ...Type.footnote, fontFamily: Type.monoCaption.fontFamily, fontWeight: '600', color: t.text },
    linkWrap: { marginTop: 10, alignSelf: 'flex-start' },
    link: { ...Type.footnoteEmphasized, color: t.accentLabel },
  });

export default CeremonyDocTop;
