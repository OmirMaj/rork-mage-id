// rfp-responses-review — homeowner sees every bid on a single RFP, sorts
// + shortlists, then picks a winner. Awarding fires the award-rfp edge
// function which atomically:
//   1. Sets the chosen bid_response.status='awarded'
//   2. Marks all other responses on this RFP 'declined'
//   3. Closes the public_bid (status='closed', awarded_response_id, awarded_at)
//   4. Creates a project in the awarded contractor's account, populated
//      with the homeowner's title/scope/photos/drawings/address
//   5. Spins up the contractor's client_portal record with the homeowner
//      as the client. Notifies both sides.
//
// The award action is irreversible from the UI; we confirm twice.

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, RefreshControl, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Trophy, MessageSquare, Eye, ShieldCheck, Star,
  Phone, Mail, Inbox, ChevronRight, AlertTriangle, Building2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface ResponseRow {
  id: string;
  bid_id: string;
  user_id: string;
  proposer_company_id: string | null;
  company_name: string | null;
  proposer_email: string | null;
  proposer_phone: string | null;
  bid_amount: number | null;
  estimate_summary: string | null;
  scope_description: string | null;  // the message
  view_site_requested: boolean;
  status: 'submitted' | 'shortlisted' | 'awarded' | 'declined' | 'withdrawn';
  created_at: string;
  responded_at: string | null;
}

interface RfpHeader {
  id: string;
  user_id: string;
  title: string;
  status: string;
  awarded_response_id: string | null;
}

type SortMode = 'recent' | 'low' | 'high';

export default function RfpResponsesReviewScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { bidId } = useLocalSearchParams<{ bidId: string }>();

  const [sort, setSort] = useState<SortMode>('recent');
  const [filter, setFilter] = useState<'all' | 'shortlist'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const enabled = !!bidId && !!user?.id && isSupabaseConfigured;

  const { data: rfp } = useQuery({
    queryKey: ['rfp-header', bidId],
    enabled,
    queryFn: async (): Promise<RfpHeader | null> => {
      const { data } = await supabase
        .from('public_bids')
        .select('id,user_id,title,status,awarded_response_id')
        .eq('id', bidId)
        .single();
      return data;
    },
  });

  const { data: responses, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['rfp-responses', bidId],
    enabled,
    queryFn: async (): Promise<ResponseRow[]> => {
      const { data, error } = await supabase
        .from('bid_responses')
        .select('id,bid_id,user_id,proposer_company_id,company_name,proposer_email,proposer_phone,bid_amount,estimate_summary,scope_description,view_site_requested,status,created_at,responded_at')
        .eq('bid_id', bidId)
        .order('created_at', { ascending: false });
      if (error) {
        console.warn('[rfp-responses-review] fetch error', error);
        return [];
      }
      return (data ?? []) as ResponseRow[];
    },
    refetchInterval: 30_000,
  });

  const sortedResponses = useMemo(() => {
    let list = responses ?? [];
    if (filter === 'shortlist') list = list.filter(r => r.status === 'shortlisted' || r.status === 'awarded');
    if (sort === 'low')    list = [...list].sort((a, b) => (a.bid_amount ?? Infinity) - (b.bid_amount ?? Infinity));
    if (sort === 'high')   list = [...list].sort((a, b) => (b.bid_amount ?? -Infinity) - (a.bid_amount ?? -Infinity));
    if (sort === 'recent') list = [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    // Always pin awarded to top.
    return list.sort((a, b) => (a.status === 'awarded' ? -1 : 0) - (b.status === 'awarded' ? -1 : 0));
  }, [responses, sort, filter]);

  const isOwner = !!rfp && !!user?.id && rfp.user_id === user.id;
  const isAwarded = !!rfp?.awarded_response_id;

  const updateStatus = useCallback(async (responseId: string, nextStatus: ResponseRow['status']) => {
    setBusyId(responseId);
    try {
      const { error } = await supabase
        .from('bid_responses')
        .update({ status: nextStatus, responded_at: new Date().toISOString() })
        .eq('id', responseId);
      if (error) throw error;
      void queryClient.invalidateQueries({ queryKey: ['rfp-responses', bidId] });
    } catch (e) {
      Alert.alert('Could not update', String((e as Error).message ?? e));
    } finally {
      setBusyId(null);
    }
  }, [queryClient, bidId]);

  const handleAward = useCallback((response: ResponseRow) => {
    Alert.alert(
      'Award this contractor?',
      `${response.company_name ?? 'This contractor'} will be notified, the project will be set up in their MAGE ID account, and your client portal will be created. All other bidders will be politely declined.\n\nThis can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Award',
          style: 'default',
          onPress: async () => {
            setBusyId(response.id);
            try {
              const { data, error } = await supabase.functions.invoke('award-rfp', {
                body: { bidId, responseId: response.id },
              });
              if (error) throw new Error(error.message);
              if (!data?.success) throw new Error(data?.error ?? 'Award failed.');
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Alert.alert(
                'Awarded!',
                'The contractor has been notified and the project + client portal are set up. They\'ll reach out to schedule kickoff.',
                [{ text: 'OK', onPress: () => { void queryClient.invalidateQueries({ queryKey: ['rfp-responses', bidId] }); void queryClient.invalidateQueries({ queryKey: ['rfp-header', bidId] }); } }],
              );
            } catch (e) {
              if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
              Alert.alert('Could not award', String((e as Error).message ?? e));
            } finally {
              setBusyId(null);
            }
          },
        },
      ],
    );
  }, [bidId, queryClient]);

  if (!isOwner) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <AlertTriangle size={28} color={Colors.warning} />
        <Text style={styles.emptyTitle}>Not your project</Text>
        <Text style={styles.emptyBody}>Only the homeowner who posted this RFP can review bids.</Text>
        <TouchableOpacity style={styles.backCta} onPress={() => router.back()}>
          <Text style={styles.backCtaText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>Bids received</Text>
          <Text style={styles.title} numberOfLines={2}>{rfp?.title ?? 'Loading…'}</Text>
        </View>
      </View>

      {/* Filter / sort controls */}
      <View style={styles.controls}>
        <View style={styles.tabRow}>
          <TouchableOpacity style={[styles.tab, filter === 'all' && styles.tabActive]} onPress={() => setFilter('all')}>
            <Text style={[styles.tabText, filter === 'all' && styles.tabTextActive]}>
              All ({responses?.length ?? 0})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, filter === 'shortlist' && styles.tabActive]} onPress={() => setFilter('shortlist')}>
            <Text style={[styles.tabText, filter === 'shortlist' && styles.tabTextActive]}>
              Shortlist ({(responses ?? []).filter(r => r.status === 'shortlisted' || r.status === 'awarded').length})
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.sortRow}>
          {(['recent', 'low', 'high'] as SortMode[]).map(mode => (
            <TouchableOpacity key={mode} style={[styles.sortChip, sort === mode && styles.sortChipActive]} onPress={() => setSort(mode)}>
              <Text style={[styles.sortChipText, sort === mode && styles.sortChipTextActive]}>
                {mode === 'recent' ? 'Newest' : mode === 'low' ? 'Lowest $' : 'Highest $'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Tokens.spacing.md, paddingBottom: insets.bottom + 80 }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={Colors.primary} />}
      >
        {isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={Colors.primary} />
          </View>
        )}

        {!isLoading && sortedResponses.length === 0 && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No bids yet</Text>
            <Text style={styles.emptyBody}>
              Contractors near you will see your project and start submitting bids. New bids show up here automatically.
            </Text>
          </View>
        )}

        {sortedResponses.map(r => {
          const isAwardedRow = r.status === 'awarded';
          const isShortlist  = r.status === 'shortlisted';
          const isDeclined   = r.status === 'declined';
          const isBusy       = busyId === r.id;
          return (
            <View
              key={r.id}
              style={[
                styles.card,
                isAwardedRow && styles.cardAwarded,
                isDeclined   && styles.cardDeclined,
              ]}
            >
              <View style={styles.cardHead}>
                <View style={styles.identityWrap}>
                  <View style={styles.identityIcon}>
                    <Building2 size={16} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.identityName} numberOfLines={1}>{r.company_name ?? 'Anonymous contractor'}</Text>
                    <Text style={styles.identityMeta}>
                      Submitted {new Date(r.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
                {isAwardedRow && (
                  <View style={styles.awardedPill}>
                    <Trophy size={10} color={Colors.success} />
                    <Text style={styles.awardedPillText}>AWARDED</Text>
                  </View>
                )}
                {isShortlist && (
                  <View style={styles.shortlistPill}>
                    <Star size={10} color={Colors.warning} />
                    <Text style={styles.shortlistPillText}>SHORTLIST</Text>
                  </View>
                )}
                {isDeclined && (
                  <View style={styles.declinedPill}>
                    <Text style={styles.declinedPillText}>DECLINED</Text>
                  </View>
                )}
              </View>

              {r.view_site_requested ? (
                <View style={styles.siteVisitRow}>
                  <Eye size={12} color={Colors.warning} />
                  <Text style={styles.siteVisitText}>Wants a site visit before quoting</Text>
                </View>
              ) : (
                <View style={styles.amountWrap}>
                  <Text style={styles.amountValue}>
                    {r.bid_amount != null ? formatMoney(r.bid_amount) : 'No estimate'}
                  </Text>
                  {r.estimate_summary && <Text style={styles.amountSummary}>{r.estimate_summary}</Text>}
                </View>
              )}

              {r.scope_description && (
                <View style={styles.messageBox}>
                  <MessageSquare size={12} color={Colors.textMuted} />
                  <Text style={styles.messageText} numberOfLines={6}>{r.scope_description}</Text>
                </View>
              )}

              <View style={styles.contactRow}>
                {r.proposer_email && (
                  <View style={styles.contactItem}>
                    <Mail size={11} color={Colors.textMuted} />
                    <Text style={styles.contactText}>{r.proposer_email}</Text>
                  </View>
                )}
                {r.proposer_phone && (
                  <View style={styles.contactItem}>
                    <Phone size={11} color={Colors.textMuted} />
                    <Text style={styles.contactText}>{r.proposer_phone}</Text>
                  </View>
                )}
              </View>

              {!isAwarded && !isDeclined && !isAwardedRow && (
                <View style={styles.actionRow}>
                  {!isShortlist && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.shortlistBtn]}
                      onPress={() => updateStatus(r.id, 'shortlisted')}
                      disabled={isBusy}
                    >
                      {isBusy ? <ActivityIndicator size="small" color={Colors.warning} />
                        : (<><Star size={13} color={Colors.warning} /><Text style={[styles.actionBtnText, { color: Colors.warning }]}>Shortlist</Text></>)}
                    </TouchableOpacity>
                  )}
                  {isShortlist && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.unshortBtn]}
                      onPress={() => updateStatus(r.id, 'submitted')}
                      disabled={isBusy}
                    >
                      <Star size={13} color={Colors.textMuted} />
                      <Text style={[styles.actionBtnText, { color: Colors.textMuted }]}>Remove from shortlist</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.declineBtn]}
                    onPress={() => updateStatus(r.id, 'declined')}
                    disabled={isBusy}
                  >
                    <Text style={[styles.actionBtnText, { color: Colors.error }]}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.awardBtn]}
                    onPress={() => handleAward(r)}
                    disabled={isBusy}
                  >
                    {isBusy ? <ActivityIndicator size="small" color="#FFF" />
                      : (<><Trophy size={13} color="#FFF" /><Text style={[styles.actionBtnText, { color: '#FFF' }]}>Award</Text><ChevronRight size={11} color="#FFF" /></>)}
                  </TouchableOpacity>
                </View>
              )}

              {isDeclined && (
                <TouchableOpacity style={styles.undeclineRow} onPress={() => updateStatus(r.id, 'submitted')}>
                  <Text style={styles.undeclineText}>Restore this bid</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: 'center', justifyContent: 'center', padding: Tokens.spacing.xl },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: Tokens.spacing.md, paddingTop: 14, paddingBottom: Tokens.spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: Tokens.spacing.xxs },

  controls: {
    paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.sm, paddingBottom: Tokens.spacing.xs,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    gap: Tokens.spacing.xs,
  },
  tabRow: { flexDirection: 'row', gap: Tokens.spacing.xs },
  tab: { paddingHorizontal: Tokens.spacing.sm, paddingVertical: 7, borderRadius: 9, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  tabActive: { backgroundColor: Colors.text, borderColor: Colors.text },
  tabText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: Colors.text },
  tabTextActive: { color: '#FFF' },
  sortRow: { flexDirection: 'row', gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  sortChipActive: { backgroundColor: Colors.primary + '15', borderColor: Colors.primary },
  sortChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: Colors.textMuted },
  sortChipTextActive: { color: Colors.primary },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: Tokens.spacing.xs, marginTop: 22,
    borderWidth: 1, borderColor: Colors.border,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: Colors.text, marginTop: Tokens.spacing.xxs, textAlign: 'center' },
  emptyBody: { fontSize: Type.footnote.fontSize, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: Tokens.spacing.sm, gap: Tokens.spacing.xs,
  },
  cardAwarded:  { borderColor: Colors.success, borderWidth: 2, backgroundColor: Colors.success + '08' },
  cardDeclined: { opacity: 0.65 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
  identityWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  identityIcon: { width: 36, height: 36, borderRadius: Tokens.radius.md, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  identityName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: Colors.text },
  identityMeta: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline },

  awardedPill:    { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full, backgroundColor: Colors.success + '20' },
  awardedPillText:{ fontSize: 9, fontWeight: '800', color: Colors.success, letterSpacing: 0.6 },
  shortlistPill:  { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full, backgroundColor: Colors.warning + '20' },
  shortlistPillText:{ fontSize: 9, fontWeight: '800', color: Colors.warning, letterSpacing: 0.6 },
  declinedPill:   { paddingHorizontal: Tokens.spacing.xs, paddingVertical: Tokens.spacing.xxs, borderRadius: Tokens.radius.full, backgroundColor: Colors.error + '15' },
  declinedPillText:{ fontSize: 9, fontWeight: '800', color: Colors.error, letterSpacing: 0.6 },

  siteVisitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: Colors.warning + '0D', borderWidth: 1, borderColor: Colors.warning + '30' },
  siteVisitText: { fontSize: Type.caption1.fontSize, color: Colors.warning, fontWeight: '700' },

  amountWrap: { paddingVertical: Tokens.spacing.xxs },
  amountValue: { fontSize: 26, fontWeight: '800', color: Colors.text, letterSpacing: -0.6 },
  amountSummary: { fontSize: Type.caption1.fontSize, color: Colors.textMuted, marginTop: Tokens.spacing.hairline, lineHeight: 17 },

  messageBox: { flexDirection: 'row', alignItems: 'flex-start', gap: Tokens.spacing.xs, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  messageText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 17 },

  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs },
  contactText: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, fontWeight: '600' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Tokens.spacing.xxs },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, paddingHorizontal: 10, paddingVertical: Tokens.spacing.xs, borderRadius: 9, borderWidth: 1 },
  shortlistBtn: { backgroundColor: Colors.warning + '08', borderColor: Colors.warning + '40' },
  unshortBtn:   { backgroundColor: Colors.background, borderColor: Colors.border },
  declineBtn:   { backgroundColor: Colors.background, borderColor: Colors.error + '40' },
  awardBtn:     { backgroundColor: Colors.primary, borderColor: Colors.primary, marginLeft: 'auto' },
  actionBtnText:{ fontSize: Type.caption1.fontSize, fontWeight: '700' },

  undeclineRow: { paddingTop: 6, alignSelf: 'flex-start' },
  undeclineText: { fontSize: Type.caption1.fontSize, color: Colors.primary, fontWeight: '700' },

  backCta: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: Tokens.radius.md, backgroundColor: Colors.primary, marginTop: Tokens.spacing.sm },
  backCtaText: { color: '#FFF', fontWeight: '700' },
});
