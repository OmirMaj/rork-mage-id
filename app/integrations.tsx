import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert, Linking,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plug, Check, Clock, Lock, ExternalLink, ChevronRight,
  Wifi, WifiOff, Search, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_INTEGRATIONS, INTEGRATION_CATEGORIES } from '@/mocks/integrations';
import type { Integration, IntegrationCategory } from '@/types';
import { recordIntegrationRequest } from '@/utils/integrationRequests';
import { useAuth } from '@/contexts/AuthContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

function IntegrationCard({ item, onConnect }: { item: Integration; onConnect: (item: Integration) => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const statusConfig = useMemo(() => {
    switch (item.status) {
      case 'connected':
        return { label: 'Connected', color: Colors.successDark, bgColor: Colors.successLight, icon: Check };
      case 'disconnected':
        return { label: item.tier === 'link' ? 'Open' : 'Connect', color: Colors.primary, bgColor: Colors.primary + '14', icon: Plug };
      case 'coming_soon':
        return { label: 'Coming Soon', color: '#9E9E9E', bgColor: '#F5F5F5', icon: Lock };
      case 'error':
        return { label: 'Error', color: Colors.errorDark, bgColor: Colors.errorLight, icon: WifiOff };
      default:
        return { label: 'Connect', color: Colors.primary, bgColor: Colors.primary + '14', icon: Plug };
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
              <ExternalLink size={12} color={Colors.textMuted} style={{ marginLeft: 4 }} />
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { user } = useAuth();
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
      Alert.alert(
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
        Alert.alert('Error', 'Could not open the link.');
      });
      return;
    }

    if (item.tier === 'deep') {
      // Pre-audit (May 2026) this fake-Connected the integration via local
      // state and showed a misleading "Connected!" alert. The audit
      // honest-rewrite then made it pop a Notify-me toast that
      // dropped the request on the floor. Now: every "Notify me" tap
      // upserts a real row into integration_requests so we can
      // prioritize the roadmap by COUNT(*). Re-tapping bumps the
      // count + last_requested_at.
      Alert.alert(
        `${item.name} not yet available`,
        'Direct integration is in development. Tap "Notify me" to add your vote — the integrations our customers ask for most ship first.',
        [
          { text: 'Maybe later', style: 'cancel' },
          {
            text: 'Notify me',
            onPress: async () => {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              if (!user?.id) {
                Alert.alert('Sign in to vote', 'We need an account to track which integrations matter to you. Sign in and try again.');
                return;
              }
              const result = await recordIntegrationRequest({
                userId: user.id,
                integrationId: item.id,
              });
              if (result.ok) {
                Alert.alert(
                  result.isRepeat ? 'Vote bumped' : 'Got it',
                  result.isRepeat
                    ? `We've recorded another vote from you for ${item.name}. We'll email you when it ships.`
                    : `Vote recorded — we'll email you when ${item.name} ships. The integrations with the most votes ship first.`,
                );
              } else {
                Alert.alert(
                  'Could not record vote',
                  `We saved your interest locally but the server didn't confirm it. Check your connection and try again.`,
                );
              }
            },
          },
        ]
      );
    }
  }, [canAccess, user]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Integrations', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Banner — honest framing of the integrations roadmap. Pre-fix
            this said "PREVIEW · this is a preview, your data won't
            actually sync." That was correct but fatalistic — users
            assumed nothing here would ever ship. Now: tapping Notify
            me records a real demand-signal row in
            integration_requests. The integrations the most users ask
            for ship first; the screen reinforces that. */}
        <View style={{
          marginHorizontal: 16, marginTop: 12, padding: 12,
          backgroundColor: Colors.primary + '12', borderRadius: 12,
          borderWidth: 1, borderColor: Colors.primary + '30',
        }}>
          <Text style={{ fontSize: 12, fontWeight: '800' as const, color: Colors.primary, letterSpacing: 0.5 }}>
            VOTE FOR YOUR INTEGRATIONS
          </Text>
          <Text style={{ fontSize: 13, color: Colors.text, marginTop: 4, lineHeight: 18 }}>
            Tap any integration to add your vote — the ones our customers ask for most ship first. We&apos;ll email you when yours goes live. (Stripe payments, email send, and push are already live.)
          </Text>
        </View>
        <View style={styles.heroSection}>
          <View style={styles.heroIconWrap}>
            <Wifi size={28} color={Colors.primary} />
          </View>
          <Text style={styles.heroTitle}>Integrations Hub</Text>
          <Text style={styles.heroSubtitle}>Connect your favorite tools and services</Text>
          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text style={[styles.heroStatValue, { color: Colors.primary }]}>{connectedCount}</Text>
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
            <Search size={32} color={Colors.textMuted} />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
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
    backgroundColor: Colors.primary + '14',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heroTitle: {
    fontSize: 24,
    fontWeight: '700' as const,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  heroSubtitle: {
    fontSize: Type.subhead.fontSize,
    color: Colors.textSecondary,
  },
  heroStats: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: Colors.surface,
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
  heroStatValue: { fontSize: Type.title2.fontSize, fontWeight: '700' as const, color: Colors.text },
  heroStatLabel: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 2 },
  heroStatDivider: { width: 1, backgroundColor: Colors.borderLight },
  categoryRow: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  categoryChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  categoryChipText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
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
    color: Colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    marginBottom: 8,
    borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.surface,
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
  cardName: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: Colors.text },
  cardDesc: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, lineHeight: 16 },
  cardConnectedDate: { fontSize: Type.caption2.fontSize, color: Colors.primary, fontWeight: '500' as const, marginTop: 2 },
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
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: Colors.textSecondary },
});
