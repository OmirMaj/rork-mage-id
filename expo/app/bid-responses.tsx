import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert, Platform,
} from 'react-native';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Star, MapPin, DollarSign, Clock, MessageCircle, UserCheck, ChevronRight, TrendingDown, TrendingUp, BarChart3 } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Colors } from '@/constants/colors';
import { getCategoryLabel, getCategoryIcon } from '@/constants/projectCategories';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';

interface BidResponse {
  id: string;
  user_id: string;
  bid_id: string;
  company_name: string;
  bid_amount: number;
  duration_estimate: string;
  scope_description: string;
  availability_date: string | null;
  proposal_uri: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

function formatCurrency(amount: number): string {
  if (amount >= 1000000) return `$${(amount / 1000000).toFixed(1)}M`;
  if (amount >= 1000) return `$${amount.toLocaleString()}`;
  return `$${amount}`;
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return 'recently';
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}

function ResponseCard({ response, onMessage, onHire, onViewProfile }: {
  response: BidResponse;
  onMessage: () => void;
  onHire: () => void;
  onViewProfile: () => void;
}) {
  const statusColor = response.status === 'hired' ? Colors.success
    : response.status === 'shortlisted' ? Colors.accent
    : response.status === 'declined' ? Colors.error
    : Colors.textSecondary;

  return (
    <View style={styles.responseCard}>
      <View style={styles.responseHeader}>
        <View style={styles.avatarCircle}>
          <Text style={styles.avatarText}>{(response.company_name ?? 'C')[0].toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.companyName}>{response.company_name || 'Contractor'}</Text>
          <Text style={styles.responseTime}>{getTimeAgo(response.created_at)}</Text>
        </View>
        {response.status !== 'submitted' && (
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '15' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {response.status.charAt(0).toUpperCase() + response.status.slice(1)}
            </Text>
          </View>
        )}
      </View>

      <View style={styles.bidDetails}>
        <View style={styles.bidDetailItem}>
          <DollarSign size={16} color={Colors.primary} />
          <Text style={styles.bidAmountText}>{formatCurrency(response.bid_amount)}</Text>
        </View>
        <View style={styles.bidDetailItem}>
          <Clock size={14} color={Colors.textSecondary} />
          <Text style={styles.bidDetailText}>{response.duration_estimate || 'TBD'}</Text>
        </View>
        {response.availability_date && (
          <View style={styles.bidDetailItem}>
            <Text style={styles.bidDetailText}>Start: {response.availability_date}</Text>
          </View>
        )}
      </View>

      <Text style={styles.scopeLabel}>What's included:</Text>
      <Text style={styles.scopeText} numberOfLines={4}>{response.scope_description}</Text>

      <View style={styles.responseActions}>
        <TouchableOpacity style={styles.viewProfileBtn} onPress={onViewProfile} activeOpacity={0.7}>
          <Text style={styles.viewProfileBtnText}>View Profile</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.messageBtn} onPress={onMessage} activeOpacity={0.7}>
          <MessageCircle size={14} color={Colors.primary} />
          <Text style={styles.messageBtnText}>Message</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.hireBtn} onPress={onHire} activeOpacity={0.7}>
          <UserCheck size={14} color="#FFF" />
          <Text style={styles.hireBtnText}>Hire</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function BidResponsesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ bidId: string }>();
  const { user } = useAuth();

  const { data: projectData } = useQuery({
    queryKey: ['bid_detail', params.bidId],
    queryFn: async () => {
      const [cachedRes, publicRes] = await Promise.all([
        supabase.from('cached_bids').select('*').eq('id', params.bidId).maybeSingle(),
        supabase.from('public_bids').select('*').eq('id', params.bidId).maybeSingle(),
      ]);
      return (publicRes.data ?? cachedRes.data) as Record<string, unknown> | null;
    },
    enabled: !!params.bidId,
  });

  const { data: responses, isLoading } = useQuery({
    queryKey: ['bid_responses', params.bidId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bid_responses')
        .select('*')
        .eq('bid_id', params.bidId)
        .order('created_at', { ascending: false });
      if (error) {
        console.log('[BidResponses] Query error:', error.message);
        return [];
      }
      return (data ?? []) as BidResponse[];
    },
    enabled: !!params.bidId,
  });

  const hireMutation = useMutation({
    mutationFn: async (responseId: string) => {
      const { error } = await supabase
        .from('bid_responses')
        .update({ status: 'hired', updated_at: new Date().toISOString() })
        .eq('id', responseId);
      if (error) throw new Error(error.message);

      await supabase
        .from('public_bids')
        .update({ status: 'closed' })
        .eq('id', params.bidId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bid_responses', params.bidId] });
      queryClient.invalidateQueries({ queryKey: ['marketplace_bids'] });
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert('Contractor Hired!', 'You can now coordinate directly through messaging.');
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const handleHire = useCallback((response: BidResponse) => {
    Alert.alert(
      'Hire Contractor',
      `Hire ${response.company_name} for ${formatCurrency(response.bid_amount)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Hire', onPress: () => hireMutation.mutate(response.id) },
      ],
    );
  }, [hireMutation]);

  const handleMessage = useCallback((response: BidResponse) => {
    router.push({ pathname: '/messages', params: { recipientId: response.user_id, recipientName: response.company_name } });
  }, [router]);

  const stats = useMemo(() => {
    if (!responses || responses.length === 0) return null;
    const amounts = responses.map(r => r.bid_amount).filter(a => a > 0);
    if (amounts.length === 0) return null;
    return {
      count: responses.length,
      lowest: Math.min(...amounts),
      highest: Math.max(...amounts),
      average: Math.round(amounts.reduce((a, b) => a + b, 0) / amounts.length),
    };
  }, [responses]);

  const meta = (projectData?.metadata ?? {}) as Record<string, unknown>;
  const categoryId = projectData?.category as string | undefined;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <ArrowLeft size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.headerTitle}>Bids Received</Text>
          <Text style={styles.headerSubtitle}>
            {getCategoryIcon(categoryId ?? '')} {projectData?.title as string ?? getCategoryLabel(categoryId ?? 'other')}
          </Text>
        </View>
      </View>

      {stats && (
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <BarChart3 size={14} color={Colors.textMuted} />
            <Text style={styles.statLabel}>{stats.count} bid{stats.count !== 1 ? 's' : ''}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <TrendingDown size={14} color={Colors.success} />
            <Text style={styles.statValue}>{formatCurrency(stats.lowest)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <TrendingUp size={14} color={Colors.error} />
            <Text style={styles.statValue}>{formatCurrency(stats.highest)}</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Avg</Text>
            <Text style={styles.statValue}>{formatCurrency(stats.average)}</Text>
          </View>
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading responses...</Text>
        </View>
      ) : (
        <FlatList
          data={responses ?? []}
          renderItem={({ item }) => (
            <ResponseCard
              response={item}
              onMessage={() => handleMessage(item)}
              onHire={() => handleHire(item)}
              onViewProfile={() => router.push({ pathname: '/profile-view', params: { userId: item.user_id } })}
            />
          )}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📭</Text>
              <Text style={styles.emptyTitle}>No bids yet</Text>
              <Text style={styles.emptySubtitle}>
                Contractors in your area will see your project and submit their bids. Check back soon!
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: Colors.surface, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  headerTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  headerSubtitle: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  statsBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', backgroundColor: Colors.surface, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statLabel: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' as const },
  statValue: { fontSize: 13, color: Colors.text, fontWeight: '700' as const },
  statDivider: { width: 1, height: 16, backgroundColor: Colors.borderLight },
  list: { padding: 16, paddingBottom: 40 },
  responseCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 },
  responseHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  avatarCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primaryLight, alignItems: 'center' as const, justifyContent: 'center' as const },
  avatarText: { fontSize: 16, fontWeight: '700' as const, color: Colors.primary },
  companyName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  responseTime: { fontSize: 12, color: Colors.textMuted, marginTop: 1 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700' as const },
  bidDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: Colors.borderLight },
  bidDetailItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bidAmountText: { fontSize: 18, fontWeight: '800' as const, color: Colors.primary },
  bidDetailText: { fontSize: 13, color: Colors.textSecondary },
  scopeLabel: { fontSize: 12, fontWeight: '600' as const, color: Colors.textMuted, marginBottom: 4 },
  scopeText: { fontSize: 13, color: Colors.text, lineHeight: 19, marginBottom: 12 },
  responseActions: { flexDirection: 'row', gap: 8, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: Colors.borderLight },
  viewProfileBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.fillTertiary, alignItems: 'center' as const },
  viewProfileBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.textSecondary },
  messageBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primaryLight },
  messageBtnText: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },
  hireBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary },
  hireBtnText: { fontSize: 13, fontWeight: '700' as const, color: '#FFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { fontSize: 14, color: Colors.textSecondary },
  emptyContainer: { alignItems: 'center', paddingTop: 80, gap: 8, paddingHorizontal: 32 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyTitle: { fontSize: 20, fontWeight: '700' as const, color: Colors.text },
  emptySubtitle: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
});

