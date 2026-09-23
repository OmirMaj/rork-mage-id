// app/sub-profile.tsx — the subcontractor's own profile.
//
// Subs are free on MAGE, but until now an invited sub got nothing of their own:
// they did the GC's paperwork and left. This is theirs — reliability they
// earned, a shareable credential, and a referral they can hand their OTHER GCs.
// That's the supply-side loop: Procore/Buildertrend charge subs, so subs never
// pull GCs onto them.
//
// SCOPE, SAID ON SCREEN (#113). Today the history is built from ONE ledger —
// this signed-in workspace. Each GC's records about a sub live in that GC's
// workspace, behind that GC's RLS, and no server fan-out reads across them yet.
// So the screen says "this workspace" and, with nothing in it, says why, rather
// than promising history "across every contractor" or showing zeros that read
// like a real record.
//
// Boundary: utils/subNetwork emits no money field at all, and a GC's records
// are only ever read from that GC's own ledger. Enforced by its tests.

import React, { useMemo } from 'react';
import {View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import { ChevronLeft, HardHat, Info } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { cardSurface } from '@/components/ui';
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
        {profile.isEmpty ? (
          <View style={styles.emptyCard} testID="sub-profile-empty">
            <HardHat size={28} color={t.accent} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No work history in this workspace yet</Text>
            <Text style={styles.emptyBody}>
              This page reads only this MAGE ID workspace. A contractor{"\u2019"}s records about your work
              live in their own account, so jobs you did for other contractors do not show up here — MAGE
              ID cannot read across contractors{"\u2019"} accounts yet.
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.scopeNote} testID="sub-profile-scope">
              <Info size={14} color={t.textMuted} strokeWidth={1.75} />
              <Text style={styles.scopeNoteText}>
                Built from this workspace only. Jobs you did for contractors in their own MAGE ID accounts are not included.
              </Text>
            </View>
            <SubNetworkProfileView
              profile={profile}
              onShareCredential={(text) => void share(text)}
              onSendReferral={(text) => void share(text)}
            />
          </>
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
    headerTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs, flexShrink: 1 },
    headerTitle: { ...Type.serifHeadline, color: t.text, flexShrink: 1 },
    scroll: { paddingVertical: Tokens.spacing.md, paddingBottom: 40 },
    scrollDesktop: { width: '100%', maxWidth: 1100, alignSelf: 'center', paddingHorizontal: 24 },
    emptyCard: {
      ...cardSurface(t, { radius: 'lg', pad: 24 }),
      margin: Tokens.spacing.md, alignItems: 'center', gap: 10,
    },
    emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, textAlign: 'center' },
    emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 360 },
    scopeNote: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      marginHorizontal: Tokens.spacing.md, marginBottom: Tokens.spacing.sm,
    },
    scopeNoteText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16 },
  });
