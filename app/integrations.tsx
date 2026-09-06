import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, Linking, ActivityIndicator,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  Plug, Check, Clock, Lock, ExternalLink, ChevronRight,
  Wifi, WifiOff, Search, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { MOCK_INTEGRATIONS, INTEGRATION_CATEGORIES } from '@/mocks/integrations';
import type { Integration, IntegrationCategory } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { useAuth } from '@/contexts/AuthContext';
import { isOwner } from '@/utils/owner';

function IntegrationCard({ item, onConnect }: { item: Integration; onConnect: (item: Integration) => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const statusConfig = useMemo(() => {
    switch (item.status) {
      case 'connected':
        return { label: 'Connected', color: Colors.successDark, bgColor: Colors.successLight, icon: Check };
      case 'disconnected':
        return { label: item.tier === 'link' ? 'Open' : 'Connect', color: themeColors.accent, bgColor: themeColors.accent + '14', icon: Plug };
      case 'coming_soon':
        return { label: 'Coming Soon', color: '#9E9E9E', bgColor: '#F5F5F5', icon: Lock };
      case 'error':
        return { label: 'Error', color: Colors.errorDark, bgColor: Colors.errorLight, icon: WifiOff };
      default:
        return { label: 'Connect', color: themeColors.accent, bgColor: themeColors.accent + '14', icon: Plug };
    }
  }, [item.status, item.tier]);

  const StatusIcon = statusConfig.icon;

  return (
    <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={() => onConnect(item)}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.cardInner}
        disabled={item.status === 'coming_soon'}
      >
        <View style={[styles.cardIcon, { backgroundColor: item.iconBg }]}>
          <Text style={[styles.cardIconLetter, { color: item.iconColor }]}>
            {item.name.charAt(0)}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <View style={styles.cardNameRow}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            {item.tier === 'link' && (
              <ExternalLink size={12} color={themeColors.textMuted} style={{ marginLeft: 4 }} strokeWidth={1.75} />
            )}
          </View>
          <Text style={styles.cardDesc} numberOfLines={2}>{item.description}</Text>
          {item.connectedAt && (
            <Text style={styles.cardConnectedDate}>
              Since {new Date(item.connectedAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </Text>
          )}
        </View>
        <View style={[styles.statusBadge, { backgroundColor: statusConfig.bgColor }]}>
          <StatusIcon size={12} color={statusConfig.color} />
          <Text style={[styles.statusText, { color: statusConfig.color }]}>{statusConfig.label}</Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function IntegrationsScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { user, isLoading: authLoading } = useAuth();
  const ownerOk = isOwner(user?.email);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [integrations, setIntegrations] = useState<Integration[]>(MOCK_INTEGRATIONS);
  const [paywallFeature, setPaywallFeature] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let result = integrations;
    if (selectedCategory !== 'all') {
      result = result.filter(i => i.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(i =>
        i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)
      );
    }
    return result;
  }, [integrations, selectedCategory, searchQuery]);

  const connectedCount = useMemo(() => integrations.filter(i => i.status === 'connected').length, [integrations]);
  const availableCount = useMemo(() => integrations.filter(i => i.status !== 'coming_soon').length, [integrations]);

  const handleConnect = useCallback((item: Integration) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Deep integrations (accounting/CRM sync like QuickBooks) WERE
    // Business-tier-gated via the 'quickbooks_sync' FeatureKey. The audit
    // (May 2026) removed that key because no real OAuth flow exists —
    // the entire Integrations screen is preview-only (MOCK_INTEGRATIONS).
    // The whole screen now wears a "PREVIEW" banner. Restoring this gate
    // is a follow-up when real integrations ship.

    if (item.status === 'connected') {
      showAlert(
        `Disconnect ${item.name}?`,
        'This will remove the connection. You can reconnect anytime.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: () => {
              setIntegrations(prev =>
                prev.map(i => i.id === item.id ? { ...i, status: 'disconnected' as const, connectedAt: undefined } : i)
              );
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            },
          },
        ]
      );
      return;
    }

    if (item.externalUrl) {
      Linking.openURL(item.externalUrl).catch(() => {
        showAlert('Error', 'Could not open the link.');
      });
      return;
    }

    if (item.tier === 'deep') {
      // Pre-audit (May 2026) this fake-Connected the integration via local
      // state and showed a misleading "Connected!" alert. We've removed
      // the dishonest path — until real OAuth flows ship for QuickBooks /
      // Sage / Foundation / etc., tapping a Connect button surfaces the
      // honest "join the waitlist" message. The screen-level Preview
      // banner reinforces that nothing here actually transacts.
      showAlert(
        `${item.name} not yet available`,
        'Direct integration is in development. Want to be notified when it ships? We can email you at the address on your account.',
        [
          { text: 'Maybe later', style: 'cancel' },
          {
            text: 'Notify me',
            onPress: () => {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              showAlert('Got it', `We'll email you when ${item.name} sync goes live.`);
            },
          },
        ]
      );
    }
  }, [canAccess]);

  // PRODUCT-F2: this screen is a PREVIEW — MOCK_INTEGRATIONS and a Connect
  // button that flips local state and never OAuths. It stays reachable for the
  // owner (demo/dev); everyone else is pointed at the real QuickBooks Online
  // setup instead of a fake "Connected" badge. An in-place gate rather than a
  // <Redirect> so the route still mounts on its own (the smoke walker asserts
  // the landing pathname) and the /integrations/qbo callback segment that
  // app/_layout.tsx exempts from the auth wall keeps its parent.
  //
  // B4 review A6: the session hydrates asynchronously, so `user` is null for
  // the first render(s) after a cold start — the owner saw the denial flash
  // (and, on a slow restore, stayed on it) before the gate re-evaluated. Wait
  // for AuthContext.isLoading first; only then judge ownership.
  if (authLoading) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Integrations', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text } }} />
        <View style={styles.gateWrap} testID="integrations-auth-loading">
          <ActivityIndicator color={themeColors.accent} />
        </View>
      </View>
    );
  }
  if (!ownerOk) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Integrations', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text } }} />
        <View style={styles.gateWrap} testID="integrations-owner-gate">
          <Plug size={26} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.gateTitle}>QuickBooks Online lives in Settings</Text>
          <Text style={styles.gateText}>
            The integrations catalog is a preview and does not connect anything yet. Your accounting sync is set up from the QuickBooks screen.
          </Text>
          <TouchableOpacity style={styles.gateBtn} onPress={() => router.push('/qbo-setup')} accessibilityRole="button" testID="integrations-open-qbo">
            <Text style={styles.gateBtnText}>Open QuickBooks setup</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Integrations', headerStyle: { backgroundColor: themeColors.bg }, headerTintColor: themeColors.accent, headerTitleStyle: { fontWeight: '700' as const, color: themeColors.text } }} />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* Preview banner — added during May 2026 launch audit. The screen
            uses MOCK_INTEGRATIONS and does NOT actually OAuth into any
            external service yet. Users who hit this via deep link or
            tile grid need to know the Connect buttons are demos. */}
        <View style={{
          marginHorizontal: 16, marginTop: 12, padding: 12,
          backgroundColor: Colors.warning + '15', borderRadius: 12,
          borderWidth: 1, borderColor: Colors.warning + '40',
        }}>
          <Text style={{ fontSize: 12, fontWeight: '800' as const, color: Colors.warning, letterSpacing: 0.5 }}>
            PREVIEW
          </Text>
          <Text style={{ fontSize: 13, color: themeColors.text, marginTop: 4, lineHeight: 18 }}>
            This is a preview of the Integrations Hub. Connect buttons aren&apos;t live yet — your data won&apos;t actually sync. We&apos;ll email you when each integration ships.
          </Text>
        </View>
        <View style={styles.heroSection}>
          <View style={styles.heroIconWrap}>
            <Wifi size={28} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroTitle}>Integrations Hub</Text>
          <Text style={styles.heroSubtitle}>QuickBooks, plans, and payments — wired into your jobs.</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: themeColors.accent }]}>{connectedCount}</Text>
              <Text style={styles.heroStatLabel}>Connected</Text>
            </View>
            <View style={[styles.heroStatDivider]} />
            <View style={styles.heroStat}>
              <Text style={styles.heroStatValue}>{availableCount}</Text>
              <Text style={styles.heroStatLabel}>Available</Text>
            </View>
            <View style={[styles.heroStatDivider]} />
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: '#9E9E9E' }]}>
                {integrations.filter(i => i.status === 'coming_soon').length}
              </Text>
              <Text style={styles.heroStatLabel}>Coming Soon</Text>
            </View>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryRow}
        >
          {INTEGRATION_CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[styles.categoryChip, selectedCategory === cat.id && styles.categoryChipActive]}
              onPress={() => {
                setSelectedCategory(cat.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.categoryChipText, selectedCategory === cat.id && styles.categoryChipTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Search size={32} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No integrations found</Text>
            <Text style={styles.emptyDesc}>Try a different category or search term</Text>
          </View>
        ) : (
          <View style={styles.listSection}>
            {filtered.filter(i => i.status === 'connected').length > 0 && (
              <>
                <Text style={styles.sectionLabel}>ACTIVE CONNECTIONS</Text>
                {filtered.filter(i => i.status === 'connected').map(item => (
                  <IntegrationCard key={item.id} item={item} onConnect={handleConnect} />
                ))}
              </>
            )}

            {filtered.filter(i => i.status === 'disconnected' || i.status === 'error').length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>AVAILABLE</Text>
                {filtered.filter(i => i.status === 'disconnected' || i.status === 'error').map(item => (
                  <IntegrationCard key={item.id} item={item} onConnect={handleConnect} />
                ))}
              </>
            )}

            {filtered.filter(i => i.status === 'coming_soon').length > 0 && (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 12 }]}>COMING SOON</Text>
                {filtered.filter(i => i.status === 'coming_soon').map(item => (
                  <IntegrationCard key={item.id} item={item} onConnect={handleConnect} />
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
      {paywallFeature ? (
        <Paywall
          visible={true}
          feature={`${paywallFeature} Sync`}
          requiredTier="business"
          onClose={() => setPaywallFeature(null)}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // Owner gate (PRODUCT-F2)
  gateWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  gateTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, textAlign: 'center' },
  gateText: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19 },
  gateBtn: {
    marginTop: 6, paddingHorizontal: 18, paddingVertical: 11, minHeight: 42, justifyContent: 'center',
    borderRadius: Tokens.radius.md, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line,
  },
  gateBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accent },
  heroSection: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    gap: 6,
  },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: t.accent + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: t.text,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: Type.subhead.fontSize,
    color: t.textSecondary,
  },
  heroStats: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    paddingVertical: 14,
    paddingHorizontal: 20,
    gap: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroStat: { alignItems: 'center', flex: 1 },
  heroStatValue: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: t.text },
  heroStatLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  heroStatDivider: { width: 1, backgroundColor: t.line },
  categoryRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  categoryChipActive: {
    backgroundColor: t.accentFill,
    borderColor: t.accent,
  },
  categoryChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: t.textSecondary,
  },
  categoryChipTextActive: {
    color: '#fff',
  },
  listSection: {
    paddingHorizontal: 16,
  },
  sectionLabel: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: t.textMuted,
    letterSpacing: 0.6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    marginBottom: 8,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: Tokens.radius.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconLetter: {
    fontSize: Type.title3.fontSize,
    fontWeight: '700' as const,
  },
  cardInfo: { flex: 1, gap: 2 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center' },
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  cardDesc: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 16 },
  cardConnectedDate: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '500' as const, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
  },
  statusText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary },
});
