// components/home/MorningBriefCard.tsx — the pinned "Your morning brief"
// entry card at the top of home.
//
// Behavior: pinned above BrainWatchCard until the brief is opened or the
// card is dismissed — either stamps BRIEF_LAST_SEEN_KEY with today's local
// date and the card stays hidden until tomorrow. (The /brief screen stamps
// the same key on mount, so arriving via the nudge tap also clears the pin.)
//
// This component also owns the nudge re-arm loop: on mount and on every
// app foreground it re-schedules the next local nudge (today if the digest
// hour is still ahead, else tomorrow) from the digest setting (prompt:false
// — the permission ask only ever happens on the digest toggle in
// notifications-settings). It DISARMS instead when the Business gate is
// lost, the digest is off, or the server morning-digest push covers the
// doorbell (push token registered + in-app channel on).
//
// Business+ only (G6): the brief is an intelligence surface; below the
// gate this renders nothing — no daily paywall bait on the home screen.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, AppState } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { Sunrise, ChevronRight, X } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useMorningBrief } from '@/hooks/useMorningBrief';
import {
  BRIEF_LAST_SEEN_KEY, briefSummaryLine, localDateISO,
} from '@/utils/brief/composeBrief';
import { armDailyBriefNudge, disarmDailyBriefNudge } from '@/utils/brief/nudge';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

export default function MorningBriefCard() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { settings } = useProjects();
  const { pushToken } = useNotifications();
  const gated = canAccess('brain_accuracy');
  const { brief } = useMorningBrief({ enabled: gated });

  // null = still reading storage (render nothing, no flicker).
  const [seenToday, setSeenToday] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(BRIEF_LAST_SEEN_KEY)
        .then(v => { if (!cancelled) setSeenToday(v === localDateISO(new Date())); })
        .catch(() => { if (!cancelled) setSeenToday(false); });
      return () => { cancelled = true; };
    }, []),
  );

  // Nudge re-arm: mount + foreground, driven by the digest setting.
  const digestEnabled = !!settings.digest?.enabled;
  const digestHour = settings.digest?.hour ?? 6;
  // The morning-digest edge fn pushes when a token is registered and the
  // digest's in-app channel is on — exactly its send condition. When the
  // server doorbell will ring, the local one must stay silent, or Business
  // users get two notifications for the same brief.
  const digestInAppOn = settings.digest?.channels?.in_app !== false;
  const serverPushCovers = !!pushToken && digestInAppOn;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (!gated || !digestEnabled || serverPushCovers) {
      // Cancel any queued nudge: a scheduled one outlives a downgrade
      // (Business gate lost → 6:30am ring into a paywall) or a push-token
      // registration. Idempotent no-op when nothing is scheduled.
      void disarmDailyBriefNudge();
      return;
    }
    void armDailyBriefNudge({ hour: digestHour });
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void armDailyBriefNudge({ hour: digestHour });
    });
    return () => sub.remove();
  }, [gated, digestEnabled, digestHour, serverPushCovers]);

  const markSeen = useCallback(() => {
    setSeenToday(true);
    AsyncStorage.setItem(BRIEF_LAST_SEEN_KEY, localDateISO(new Date())).catch(() => {});
  }, []);

  const openBrief = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    markSeen();
    router.push('/brief' as never);
  }, [markSeen, router]);

  if (!gated || seenToday !== false) return null;

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.main}
        onPress={openBrief}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Open your morning brief"
        testID="morning-brief-card"
      >
        <View style={styles.icon}>
          <Sunrise size={16} color={t.accent} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Your morning brief</Text>
          <Text style={styles.summary} numberOfLines={1}>{briefSummaryLine(brief)}</Text>
        </View>
        <ChevronRight size={16} color={t.textMuted} strokeWidth={2} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismiss}
        onPress={markSeen}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss the morning brief for today"
        testID="morning-brief-dismiss"
      >
        <X size={14} color={t.textMuted} strokeWidth={2} />
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: t.line,
    marginHorizontal: Tokens.spacing.md,
    marginTop: Tokens.spacing.sm,
    paddingRight: Tokens.spacing.sm,
  },
  main: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
    paddingVertical: Tokens.spacing.sm, paddingLeft: Tokens.spacing.md,
  },
  icon: {
    width: 30, height: 30, borderRadius: Tokens.radius.md,
    backgroundColor: t.accent + '14',
    alignItems: 'center', justifyContent: 'center',
  },
  title: { ...Type.subheadEmphasized, color: t.text },
  summary: { ...Type.caption1, color: t.textSecondary, marginTop: 1 },
  dismiss: { padding: Tokens.spacing.xs },
});
