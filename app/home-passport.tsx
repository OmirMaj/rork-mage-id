// app/home-passport.tsx — the Home Passport.
//
// The homeowner's permanent record of their home: every job, warranty, permit,
// installed model number, maintenance date, and the contractors who did the
// work. It belongs to the OWNER and survives across contractors — which is the
// growth wedge: an owner who keeps this asks their next contractor for MAGE.
//
// Homes are grouped by address (utils/passport groups on project.location), so
// this screen picks the home to show when a user has jobs at more than one.
//
// Client-safe by construction: consumerPassport can never emit the GC's cost,
// markup or margin — enforced by its own tests.

import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Share, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, House } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useCoreData, useFinancialsData, useDocsData } from '@/contexts/ProjectContext';
import { HomePassportCard } from '@/components/passport/HomePassportCard';
import {
  buildConsumerPassport, buildPassportHandoff,
  type PassportJobInput,
} from '@/utils/passport/consumerPassport';
import { showAlert } from '@/utils/alert';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

/** Group key for "one home" — address string, normalized. */
function homeKey(location?: string): string {
  return (location ?? '').trim().toLowerCase() || 'unknown';
}

export default function HomePassportScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();
  const { projects } = useCoreData();
  const { invoices, commitments } = useFinancialsData();
  const { warranties, permits } = useDocsData();

  // Homes = distinct project addresses, most jobs first.
  const homes = useMemo(() => {
    const byKey = new Map<string, { label: string; jobs: typeof projects }>();
    for (const p of projects ?? []) {
      const k = homeKey(p.location);
      const entry = byKey.get(k) ?? { label: p.location?.trim() || 'Unknown address', jobs: [] };
      entry.jobs.push(p);
      byKey.set(k, entry);
    }
    return [...byKey.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.jobs.length - a.jobs.length);
  }, [projects]);

  const [selected, setSelected] = useState<string | null>(null);
  const active = homes.find((h) => h.key === selected) ?? homes[0] ?? null;

  const passport = useMemo(() => {
    if (!active) return null;
    const jobs: PassportJobInput[] = active.jobs.map((p) => ({
      id: p.id,
      name: p.name,
      location: p.location,
      type: String(p.type ?? ''),
      status: String(p.status ?? ''),
      createdAt: p.createdAt,
      squareFootage: p.squareFootage,
    }));
    return buildConsumerPassport({
      projects: jobs,
      warranties: warranties ?? [],
      permits: permits ?? [],
      commitments: commitments ?? [],
      invoices: invoices ?? [],
      nowMs: Date.now(),
    });
  }, [active, warranties, permits, commitments, invoices]);

  const onShare = async () => {
    if (!passport) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await Share.share({ message: buildPassportHandoff(passport) });
    } catch {
      showAlert('Could not share', 'Please try again.');
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.headerBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={t.text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={styles.headerTitleWrap}>
          <House size={15} color={t.accent} strokeWidth={2} />
          <Text style={styles.headerTitle}>Home Passport</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Address switcher — only when there's more than one home on record. */}
        {homes.length > 1 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.homeRow}
          >
            {homes.map((h) => {
              const on = h.key === active?.key;
              return (
                <TouchableOpacity
                  key={h.key}
                  style={[styles.homeChip, on && styles.homeChipOn]}
                  onPress={() => setSelected(h.key)}
                  accessibilityRole="button"
                  accessibilityLabel={`Show ${h.label}`}
                >
                  <Text style={[styles.homeChipText, on && styles.homeChipTextOn]} numberOfLines={1}>
                    {h.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {passport ? (
          <HomePassportCard
            passport={passport}
            onShare={() => void onShare()}
            onPressProject={(projectId) =>
              router.push({ pathname: '/project-detail', params: { projectId } } as never)
            }
          />
        ) : (
          <View style={styles.empty}>
            <House size={20} color={t.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>Nothing on record yet</Text>
            <Text style={styles.emptyText}>
              As jobs are completed, this becomes the permanent record of the home — every warranty,
              permit, model number and maintenance date, yours to keep.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    headerBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Tokens.spacing.sm,
      paddingVertical: Tokens.spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.line,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    headerTitle: { ...Type.headline, color: t.text },
    scroll: { paddingVertical: Tokens.spacing.md, paddingBottom: 40 },
    scrollDesktop: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 24 },
    homeRow: { gap: Tokens.spacing.xs, paddingHorizontal: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm },
    homeChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: Tokens.radius.full,
      borderWidth: 1,
      borderColor: t.line,
      backgroundColor: t.surface,
      maxWidth: 240,
    },
    homeChipOn: { backgroundColor: t.accentFill, borderColor: t.accent },
    homeChipText: { ...Type.caption1, color: t.textSecondary, fontWeight: '600' },
    homeChipTextOn: { color: '#FFFFFF' },
    empty: {
      alignItems: 'center',
      gap: 8,
      marginHorizontal: Tokens.spacing.md,
      padding: Tokens.spacing.lg,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
    },
    emptyTitle: { ...Type.subheadEmphasized, color: t.text },
    emptyText: { ...Type.footnote, color: t.textSecondary, textAlign: 'center', lineHeight: 19 },
  });
