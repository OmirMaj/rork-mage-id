import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated,
  Platform, Alert, Linking,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Plug, Check, Clock, Lock, ExternalLink, ChevronRight,
  Wifi, WifiOff, Search, X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { MOCK_INTEGRATIONS, INTEGRATION_CATEGORIES } from '@/mocks/integrations';
import type { Integration, IntegrationCategory } from '@/types';

function IntegrationCard({ item, onConnect }: { item: Integration; onConnect: (item: Integration) => void }) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const statusConfig = useMemo(() => {
    switch (item.status) {
      case 'connected':
        return { label: 'Connected', color: '#2E7D32', bgColor: '#E8F5E9', icon: Check };
      case 'disconnected':
        return { label: item.tier === 'link' ? 'Open' : 'Connect', color: Colors.primary, bgColor: Colors.primary + '14', icon: Plug };
      case 'coming_soon':
        return { label: 'Coming Soon', color: '#9E9E9E', bgColor: '#F5F5F5', icon: Lock };
      case 'error':
        return { label: 'Error', color: '#C62828', bgColor: '#FFEBEE', icon: WifiOff };
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
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [integrations, setIntegrations] = useState<Integration[]>(MOCK_INTEGRATIONS);

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
      Alert.alert(
        `Connect ${item.name}`,
        'This will open a secure authentication flow. Once connected, data will sync automatically.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Connect',
            onPress: () => {
              setIntegrations(prev =>
                prev.map(i => i.id === item.id ? { ...i, status: 'connected' as const, connectedAt: new Date().toISOString() } : i)
              );
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert('Connected!', `${item.name} has been connected successfully.`);
            },
          },
        ]
      );
    }
  }, []);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Integrations', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
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
    fontSize: 15,
    color: Colors.textSecondary,
  },
  heroStats: {
    flexDirection: 'row',
    marginTop: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
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
  heroStatValue: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  heroStatLabel: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
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
    fontSize: 13,
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
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textMuted,
    letterSpacing: 0.6,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  card: {
    marginBottom: 8,
    borderRadius: 14,
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
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconLetter: {
    fontSize: 20,
    fontWeight: '700' as const,
  },
  cardInfo: { flex: 1, gap: 2 },
  cardNameRow: { flexDirection: 'row', alignItems: 'center' },
  cardName: { fontSize: 15, fontWeight: '600' as const, color: Colors.text },
  cardDesc: { fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  cardConnectedDate: { fontSize: 11, color: Colors.primary, fontWeight: '500' as const, marginTop: 2 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  statusText: { fontSize: 11, fontWeight: '600' as const },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 8,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textSecondary },
});
