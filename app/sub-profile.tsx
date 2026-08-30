// app/sub-profile.tsx — the subcontractor's own profile.
//
// Subs are free on MAGE, but until now an invited sub got nothing of their own:
// they did the GC's paperwork and left. This is theirs — work history across
// every GC who hired them, reliability they earned, a shareable credential, and
// a referral they can hand their OTHER GCs. That's the supply-side loop:
// Procore/Buildertrend charge subs, so subs never pull GCs onto them.
//
// Boundary: utils/subNetwork emits no money field at all, and a GC's records
// are only ever read from that GC's own ledger. Enforced by its tests.

import React, { useMemo } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, HardHat } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { shareText } from '@/utils/shareText';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { useAuth } from '@/contexts/AuthContext';
import { useCoreData, useFinancialsData, useFieldData, usePreconData } from '@/contexts/ProjectContext';
import { SubNetworkProfileView } from '@/components/subs';
import { buildSubNetworkProfile } from '@/utils/subNetwork';
import { showAlert } from '@/utils/alert';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function SubProfileScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { isDesktop } = useResponsiveLayout();
  const { user } = useAuth();
  const { projects, settings } = useCoreData();
  const { commitments } = useFinancialsData();
  const { punchItems } = useFieldData();
  const { subcontractors } = usePreconData();

  // One ledger today (this workspace). The engine already takes an array, so a
  // cross-GC server fan-out slots in without changing this screen.
  const profile = useMemo(() => {
    const gcName = settings?.branding?.companyName?.trim() || 'This contractor';
    return buildSubNetworkProfile({
      identity: { email: (user as { email?: string } | null)?.email },
      ledgers: [{
        gcId: 'workspace',
        gcName,
        subcontractors: subcontractors ?? [],
        commitments: commitments ?? [],
        projects: projects ?? [],
        punchItems: punchItems ?? [],
      }],
      nowMs: Date.now(),
    });
  }, [user, settings, subcontractors, commitments, projects, punchItems]);

  const share = async (text: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    try {
      await shareText({ message: text });
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
          <HardHat size={15} color={t.accent} strokeWidth={2} />
          <Text style={styles.headerTitle} numberOfLines={1}>Your work profile</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <ScrollView
        {...fabScroll}
        contentContainerStyle={[styles.scroll, isDesktop && styles.scrollDesktop, { paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }]}
        showsVerticalScrollIndicator={false}
      >
        <SubNetworkProfileView
          profile={profile}
          onShareCredential={(text) => void share(text)}
          onSendReferral={(text) => void share(text)}
        />
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
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, flexShrink: 1 },
    headerTitle: { ...Type.serifHeadline, color: t.text, flexShrink: 1 },
    scroll: { paddingVertical: Tokens.spacing.md, paddingBottom: 40 },
    scrollDesktop: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 24 },
  });
