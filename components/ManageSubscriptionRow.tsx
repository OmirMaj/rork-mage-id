// components/ManageSubscriptionRow.tsx — the one Manage Subscription row
// (WEBCANCEL, 2026-10-09). Settings shows it in the plan section; the paywall
// shows the same row to someone who already has a plan.
//
// What it does: it opens the place where a plan is changed or cancelled
// (utils/manageSubscription decides which place), and when the customer comes
// back it re-reads the customer info from RevenueCat so the plan and the date
// are current. It cancels nothing itself and never says anything was
// cancelled. The date under the row is the one RevenueCat reports.
//
// The voice-of-customer audit (2026-05-14) named "couldn't cancel" as the
// trap competitors set (Houzz Pro, Contractor Foreman). #176: that only holds
// if the route is real. A store subscriber goes to the store page, a web
// subscriber to the billing page RevenueCat reports, and only a plan with no
// page behind it is sent to help@mageid.app.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { AppState, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { ChevronRight, ExternalLink, Wallet } from 'lucide-react-native';

import { cardSurface } from '@/components/ui';
import type { ThemeColors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useManageSubscriptionCopy, type ManageSubscriptionLines } from '@/hooks/useManageSubscriptionCopy';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { showAlert } from '@/utils/alert';
import {
  manageSubscriptionRoute, renewalFact, type ManageRoute, type ManageTier,
} from '@/utils/manageSubscription';
import { isOwner } from '@/utils/owner';

/** The route and the words for this account, for the row and for the Switch to Free alert. */
export function useManageSubscription(): { route: ManageRoute; lines: ManageSubscriptionLines; renewalLine: string | null; tier: ManageTier } {
  const { user } = useAuth();
  const sub = useSubscription();
  const copy = useManageSubscriptionCopy();
  const tier = (sub.tier ?? 'free') as ManageTier;
  const store = sub.planStore ?? null;
  const managementURL = sub.managementURL ?? null;
  const owner = isOwner(user?.email);
  const route = useMemo(
    () => manageSubscriptionRoute({ os: Platform.OS, tier, store, managementURL, isOwner: owner }),
    [tier, store, managementURL, owner],
  );
  const lines = useMemo(() => copy.lines(route.kind, Platform.OS, tier), [copy, route.kind, tier]);
  // A date is printed only for a plan that has a purchase behind it.
  const renewalLine = route.kind === 'none' ? null : copy.renewal(renewalFact(sub.planRenewal ?? null));
  return { route, lines, renewalLine, tier };
}

export function ManageSubscriptionRow({ variant = 'settings', testID = 'manage-subscription' }: {
  /** 'settings': always drawn, for every account. 'paywall': drawn only when there is somewhere to manage a plan. */
  variant?: 'settings' | 'paywall';
  testID?: string;
}): React.ReactElement | null {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { refreshCustomerInfo, showStoreManageSheet } = useSubscription();
  const { route, lines, renewalLine } = useManageSubscription();

  // Set when the row sends the customer out; cleared by the refresh on return.
  const awaitingReturn = useRef(false);
  const refresh = useCallback(() => {
    awaitingReturn.current = false;
    if (typeof refreshCustomerInfo === 'function') {
      void refreshCustomerInfo().catch(() => { /* offline: the plan shown stays the last one read */ });
    }
  }, [refreshCustomerInfo]);

  useEffect(() => {
    // The app (or the browser tab) is in front again: read the plan again.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && awaitingReturn.current) refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const open = useCallback(async () => {
    const url = route.url;
    if (!url) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    if (Platform.OS === 'ios' && route.kind === 'store-here' && typeof showStoreManageSheet === 'function') {
      // Apple's sheet opens over the app; when it closes, read the plan again.
      if (await showStoreManageSheet()) { refresh(); return; }
    }
    awaitingReturn.current = true;
    // On the web Linking.openURL opens a new tab, so the app stays open behind it.
    Linking.openURL(url).catch(() => {
      awaitingReturn.current = false;
      showAlert(lines.label, lines.fallback);
    });
  }, [route.url, route.kind, showStoreManageSheet, refresh, lines.label, lines.fallback]);

  // The paywall offers the row to someone with a plan to manage. A plan with
  // nothing behind it ('plan-line') is already marked Current on its card.
  if (variant === 'paywall' && (route.kind === 'none' || route.kind === 'plan-line')) return null;

  const body = (
    <>
      <View style={styles.iconWrap}>
        <Wallet size={14} color={colors.textSecondary} strokeWidth={1.75} />
      </View>
      <View style={styles.words}>
        <Text style={styles.label} testID={`${testID}-label`}>{lines.label}</Text>
        {lines.subtitle ? <Text style={styles.sub} testID={`${testID}-where`}>{lines.subtitle}</Text> : null}
        {renewalLine ? <Text style={styles.sub} testID={`${testID}-renewal`}>{renewalLine}</Text> : null}
      </View>
    </>
  );

  if (!route.url) {
    // Nothing to open: a plain line, not a button.
    return (
      <View style={[styles.group, variant === 'paywall' && styles.groupPaywall]}>
        <View style={styles.row} testID={`${testID}-line`}>{body}</View>
      </View>
    );
  }
  const leavesTheApp = Platform.OS === 'web' && route.selfServe;
  return (
    <View style={[styles.group, variant === 'paywall' && styles.groupPaywall]}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => { void open(); }}
        activeOpacity={0.6}
        testID={`${testID}-link`}
        accessibilityRole={leavesTheApp ? 'link' : 'button'}
        accessibilityLabel={lines.label}
        accessibilityHint={lines.subtitle ?? undefined}
      >
        {body}
        {leavesTheApp
          ? <ExternalLink size={16} color={colors.textMuted} strokeWidth={1.75} />
          : <ChevronRight size={16} color={colors.textMuted} strokeWidth={1.75} />}
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  group: {
    ...cardSurface(t, { radius: 'card', pad: 'none' }),
    marginHorizontal: 16,
    overflow: 'hidden' as const,
    marginBottom: 20,
  },
  groupPaywall: {
    marginHorizontal: 0,
    marginTop: 16,
    marginBottom: 0,
    alignSelf: 'stretch' as const,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    minHeight: 52,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 7,
    backgroundColor: t.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { flex: 1 },
  label: {
    fontSize: Type.callout.fontSize,
    fontWeight: '400' as const,
    color: t.text,
  },
  sub: {
    fontSize: Type.caption1.fontSize,
    color: t.textMuted,
    marginTop: 2,
  },
});
