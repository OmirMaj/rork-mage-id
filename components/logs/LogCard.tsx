// components/logs/LogCard.tsx — the card DataTable requires as `renderCard`
// (wave 6c, lane G).
//
// DataTable draws renderCard only below the desktop gate. The logs mount only
// on desktop web (utils/logs/logRoutes.logRouteMode), so on the iPhone this is
// unreachable — the phone keeps each screen's own form, as today. It exists so
// the type is honest and a narrow desktop window still has something to draw.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Layout, Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';

export function LogCard({ title, meta, testID }: { title: string; meta?: string | null; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.card} testID={testID}>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      {meta ? <Text style={styles.meta} numberOfLines={1}>{meta}</Text> : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    paddingHorizontal: Layout.cardPad,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: t.line,
    borderRadius: Tokens.radius.sm,
    gap: 2,
  },
  title: { ...Type.bodyCompact, color: t.text },
  meta: { ...Type.footnote, color: t.textSecondary },
});

export default LogCard;
