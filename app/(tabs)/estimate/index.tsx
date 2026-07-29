import React, { useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Calculator, Ruler, Grid, Layers, Gauge, TrendingUp, GitCompare, Activity, PieChart, ScanSearch,
  type LucideIcon,
} from 'lucide-react-native';
import { BrandBackdrop } from '@/components/BrandBackdrop';
import { Card } from '@/components/ui/Card';
import { IconWrapper } from '@/components/ui/IconWrapper';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { entriesForGroup, type HubEntry } from '@/utils/estimateHubEntries';

// iconKey → lucide component. Lives in the SCREEN so the entry list stays RN-free.
const ICONS: Record<string, LucideIcon> = {
  Calculator, Ruler, Grid, Layers, Gauge, TrendingUp, GitCompare, Activity, PieChart, ScanSearch,
};

export default function EstimateHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeStyles);

  const go = useCallback((entry: HubEntry) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    router.push(entry.route as never);
  }, [router]);

  const renderCard = (entry: HubEntry) => {
    const Icon = ICONS[entry.iconKey] ?? Calculator;
    return (
      <Card
        key={entry.id}
        pressable
        onPress={() => go(entry)}
        accessibilityLabel={entry.label}
        testID={`estimate-hub-${entry.id}`}
        style={styles.card}
      >
        <View style={styles.cardRow}>
          <IconWrapper icon={Icon} tone={entry.tone} size="md" />
          <View style={styles.cardText}>
            <Card.Title>{entry.label}</Card.Title>
            <Card.Meta>{entry.subtitle}</Card.Meta>
          </View>
        </View>
      </Card>
    );
  };

  return (
    <View style={styles.root}>
      {/* Branded hero band — BrandBackdrop is always ink+amber regardless of theme. */}
      <View style={[styles.hero, { paddingTop: insets.top + 20 }]}>
        <BrandBackdrop />
        <Text style={styles.heroEyebrow}>ESTIMATING</Text>
        <Text style={styles.heroTitle}>Estimate</Text>
        <Text style={styles.heroSubtitle}>Price the job, then learn from every bid.</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>CREATE</Text>
        {entriesForGroup('create').map(renderCard)}

        <Text style={[styles.sectionLabel, { marginTop: 20 }]}>INSIGHTS</Text>
        {entriesForGroup('insights').map(renderCard)}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  hero: {
    paddingHorizontal: 20,
    paddingBottom: 22,
    overflow: 'hidden',
  },
  heroEyebrow: {
    color: '#FF8533',
    fontSize: Type.caption2.fontSize,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  heroTitle: {
    color: '#F4EFE6',
    fontSize: Type.title1.fontSize,
    fontWeight: '800',
  },
  heroSubtitle: {
    color: '#C9C3B8',
    fontSize: Type.subhead.fontSize,
    marginTop: 4,
  },
  scroll: { flex: 1 },
  sectionLabel: {
    color: t.textMuted,
    fontSize: Type.caption2.fontSize,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 10,
  },
  card: { marginBottom: 10 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardText: { flex: 1 },
});
