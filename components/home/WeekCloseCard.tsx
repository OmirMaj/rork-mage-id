// components/home/WeekCloseCard.tsx — Friday Close entry card on home.
//
// Visible Friday through Sunday when the week-close modal has not been
// opened/dismissed yet this week (mageid_week_close_last_seen key).
// Compact leg counts let the GC gauge what needs doing without opening.
//
// ARM-TIME PREDICATE (G10, plan §F2): the Friday 15:00 nudge is armed only
// when ≥1 active project had activity in the trailing 14 days AND the
// notification_preferences.weekClose.push toggle is not off. Checked on
// mount + every app foreground, same pattern as MorningBriefCard.tsx:78-83
// (its digestEnabled gate is the consent precedent).
//
// Business+ only (G6): same 'brain_accuracy' proxy as the morning brief.
// Renders nothing when gated or when outside Friday–Sunday window or when
// already seen this week.

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, AppState } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { CalendarCheck, ChevronRight, X } from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useWeekClose } from '@/hooks/useWeekClose';
import { WEEK_CLOSE_LAST_SEEN_KEY, weekCloseTodayISO } from '@/utils/weekClose/types';
import { armWeekCloseNudge, disarmWeekCloseNudge } from '@/utils/weekClose/nudge';
import { projectIsActive } from '@/utils/weekClose/composeWeekClose';
import { useLeakCoDrafts } from '@/hooks/useLeakCoDrafts';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** True when the current local day-of-week is Friday (5), Saturday (6), or Sunday (0). */
function isFridayWindow(): boolean {
  const dow = new Date().getDay();
  return dow === 5 || dow === 6 || dow === 0;
}

/** ISO week string (YYYY-Www) for a given date — used to compare "same week". */
function isoWeek(dateISO: string): string {
  // Compute ISO week number: week 1 = the week containing the first Thursday.
  const d = new Date(dateISO + 'T12:00:00');
  const day = d.getDay() === 0 ? 7 : d.getDay(); // make Sunday=7
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function WeekCloseCard() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { projects, invoices, dailyReports } = useProjects();
  const { user } = useAuth();
  const gated = canAccess('brain_accuracy');
  const { close } = useWeekClose({ enabled: gated && isFridayWindow() });

  // F3: once-per-session catch-up sweep — auto-drafts COs from priced leak
  // scans when the autonomy gate and preference allow. Gated internally;
  // renders no UI. Runs on every mount of WeekCloseCard (home render).
  useLeakCoDrafts();

  // null = still reading storage (render nothing, no flicker).
  const [seenThisWeek, setSeenThisWeek] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      AsyncStorage.getItem(WEEK_CLOSE_LAST_SEEN_KEY)
        .then(v => {
          if (cancelled) return;
          if (!v) { setSeenThisWeek(false); return; }
          setSeenThisWeek(isoWeek(v) === isoWeek(weekCloseTodayISO()));
        })
        .catch(() => { if (!cancelled) setSeenThisWeek(false); });
      return () => { cancelled = true; };
    }, []),
  );

  // Nudge re-arm: mount + foreground. (G10) Only armed when ≥1 active project
  // had activity in the last 14 days AND the user has not turned the nudge
  // off in notification settings (profiles.notification_preferences
  // .weekClose.push — the same path notifications-settings.tsx writes).
  // Hardcoding enabled:true here would silently override the settings toggle
  // on every mount/foreground — a consent violation.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;

    const syncNudge = async () => {
      const hasActivity = projects.some(
        p => projectIsActive(p, invoices, dailyReports, new Date()),
      );
      if (!gated || !hasActivity) {
        void disarmWeekCloseNudge();
        return;
      }
      // Consent gate. Absent pref = ON (the documented default); an explicit
      // false = OFF. If the pref cannot be read (offline / transient error)
      // we do NOTHING — never re-arm against a toggle we could not verify,
      // and never disarm a consented nudge on a network blip.
      let weekClosePushOn: boolean | null = user?.id ? null : true;
      if (user?.id) {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('notification_preferences')
            .eq('id', user.id)
            .single();
          if (!error && data) {
            const prefs = (data.notification_preferences ?? {}) as { weekClose?: { push?: boolean } };
            weekClosePushOn = prefs.weekClose?.push !== false;
          }
        } catch {
          // Unknown → leave weekClosePushOn null (no-op below).
        }
      }
      if (cancelled || weekClosePushOn == null) return;
      if (!weekClosePushOn) {
        // Explicitly off (possibly toggled on another device) → disarm here.
        void disarmWeekCloseNudge();
        return;
      }
      void armWeekCloseNudge({ enabled: weekClosePushOn });
    };

    void syncNudge();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void syncNudge();
    });
    return () => { cancelled = true; sub.remove(); };
  }, [gated, projects, invoices, dailyReports, user?.id]);

  const markSeen = useCallback(() => {
    setSeenThisWeek(true);
    AsyncStorage.setItem(WEEK_CLOSE_LAST_SEEN_KEY, weekCloseTodayISO()).catch(() => {});
  }, []);

  const openClose = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    markSeen();
    router.push('/week-close' as never);
  }, [markSeen, router]);

  // Render nothing when: not gated, outside Fri-Sun, storage not yet read, or
  // already seen this week.
  if (!gated || !isFridayWindow() || seenThisWeek !== false) return null;

  // Informational lines (reminders/notices) are not open work — count only
  // legs with actionable items, mirroring composeWeekClose's allQuiet rule.
  const openLegs = close?.legs.filter(l => l.items.some(i => !i.informational)).length ?? 0;
  const allQuiet = close?.allQuiet ?? false;

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.main}
        onPress={openClose}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityLabel="Open Friday close"
        testID="week-close-card"
      >
        <View style={styles.icon}>
          <CalendarCheck size={16} color={t.accent} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Friday close</Text>
          <Text style={styles.summary} numberOfLines={1}>
            {allQuiet
              ? 'Clean close — nothing left on the table.'
              : openLegs > 0
                ? `${openLegs} leg${openLegs === 1 ? '' : 's'} to close out`
                : 'Review your week'}
          </Text>
        </View>
        <ChevronRight size={16} color={t.textMuted} strokeWidth={2} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.dismiss}
        onPress={markSeen}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="Dismiss Friday close for this week"
        testID="week-close-dismiss"
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
