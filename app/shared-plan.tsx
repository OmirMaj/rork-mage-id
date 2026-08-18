// /shared-plan?t=<token>
//
// The homeowner's Living Floor Plan. Read-only, unauthenticated — the token in
// the URL is the entire credential, same magic-link idiom as /shared-photos
// and /shared-schedule. A client drags the timeline and watches their own
// floor plan fill in room by room, with the site photos that existed by that
// date. That answers "what is happening to my house" without a phone call.
//
// CLIENT-FACING FIREWALL. Everything this screen can render came out of
// buildPlanSharePayload (utils/planShareToken.ts), which is a strict allowlist
// — rooms, trades, planned dates, photo URLs. There is no cost, markup,
// margin, unit price or supplier in the payload, so there is none on the
// screen; and there are no task titles, sub names, notes, float or
// critical-path flags either, so a homeowner cannot work out which sub is
// behind. LivingFloorPlan is handed `clientMode`, which drops the zone editor
// and the linked-task list. scripts/validate-plan-share.ts pins all of it,
// including a source-level scan of THIS file.
//
// The MAGE AI FAB is suppressed here via BrainFab's HIDDEN_ROOTS — a viewer
// with no account must not get an assistant wired to the GC's data.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AlertCircle, Lock } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { LivingFloorPlan } from '@/components/schedule/mobile/LivingFloorPlan';
import {
  decodePlanShareToken, hydratePlanShare, SHARE_PLAN_SHEET_ID,
  type PlanSharePayload,
} from '@/utils/planShareToken';

export default function SharedPlanScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { t } = useLocalSearchParams<{ t?: string }>();

  const payload: PlanSharePayload | null = useMemo(
    () => (t ? decodePlanShareToken(String(t)) : null),
    [t],
  );

  // Re-inflate into the shapes LivingFloorPlan already consumes, so this
  // screen renders the REAL component rather than a client-side lookalike
  // that could drift away from the GC-facing one.
  const hydrated = useMemo(() => (payload ? hydratePlanShare(payload) : null), [payload]);

  if (!t) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + 32 }]} testID="shared-plan-no-token">
        <Stack.Screen options={{ title: 'Floor plan', headerShown: false }} />
        <AlertCircle size={28} color={Colors.warning} strokeWidth={1.75} />
        <Text style={styles.errorTitle}>No share token</Text>
        <Text style={styles.errorBody}>This link is missing the data it needs. Ask your contractor for a fresh link.</Text>
      </View>
    );
  }

  if (!payload || !hydrated) {
    return (
      <View style={[styles.errorRoot, { paddingTop: insets.top + 32 }]} testID="shared-plan-bad-token">
        <Stack.Screen options={{ title: 'Floor plan', headerShown: false }} />
        <View style={styles.errorChip}>
          <AlertCircle size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
          <Text style={styles.errorChipText}>Bad link</Text>
        </View>
        <Text style={styles.errorTitle}>Couldn&apos;t open this link</Text>
        <Text style={styles.errorBody}>
          The share data is corrupted or this link is from an older version of MAGE ID. Ask your contractor for a fresh link.
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]} testID="shared-plan-view">
      <Stack.Screen options={{ title: 'Floor plan', headerShown: false }} />
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.projectName} numberOfLines={1}>{payload.n}</Text>
          <Text style={styles.sheetName} numberOfLines={1}>
            {payload.sn ? `${payload.sn} · ` : ''}Shared by {payload.gc ?? 'your contractor'}
          </Text>
        </View>
        <View style={styles.readOnlyChip}>
          <Lock size={12} color={themeColors.textMuted} strokeWidth={1.75} />
          <Text style={styles.readOnlyText}>Read-only</Text>
        </View>
      </View>

      <View style={{ flex: 1 }}>
        <LivingFloorPlan
          clientMode
          tasks={hydrated.tasks}
          scheduleStartDate={payload.sd}
          planSheetId={SHARE_PLAN_SHEET_ID}
          zones={hydrated.zones}
          pins={hydrated.pins}
          photoById={hydrated.photoById}
          imageUri={payload.img}
          imageW={payload.iw}
          imageH={payload.ih}
        />
      </View>

      <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
        <Text style={styles.footNote}>
          Rooms are shaded by the trade that&apos;s scheduled to be working in them. This is the plan, not a bill —
          talk to {payload.gc ?? 'your contractor'} about anything you see here.
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10,
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  projectName: { ...Type.title3, fontWeight: '800' as const, color: t.text, letterSpacing: -0.4 },
  sheetName: { ...Type.caption1, fontWeight: '600' as const, color: t.textMuted, marginTop: 1 },
  readOnlyChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Tokens.radius.full, backgroundColor: t.surfaceAlt,
  },
  readOnlyText: { ...Type.caption2, fontWeight: '700' as const, color: t.textMuted },
  footer: { paddingHorizontal: 16, paddingTop: 10 },
  footNote: { ...Type.caption1, fontWeight: '500' as const, color: t.textMuted, lineHeight: 17 },
  // Error states
  errorRoot: { flex: 1, alignItems: 'center' as const, paddingHorizontal: 32, gap: 10, backgroundColor: t.bg },
  errorChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Tokens.radius.full, backgroundColor: t.dangerSoft,
  },
  errorChipText: { ...Type.caption2, fontWeight: '700' as const, color: t.dangerLabel },
  errorTitle: { ...Type.headline, fontWeight: '800' as const, color: t.text, textAlign: 'center' as const },
  errorBody: {
    ...Type.footnote, fontWeight: '500' as const, color: t.textMuted,
    textAlign: 'center' as const, maxWidth: 340,
    // Web viewers land here in a browser tab; keep the copy readable there too.
    ...(Platform.OS === 'web' ? { lineHeight: 20 } : null),
  },
});
