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
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, Platform,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Trophy, MessageSquare, Eye, ShieldCheck, Star,
  Phone, Mail, Inbox, ChevronRight, AlertTriangle, Building2,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';

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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
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
    const respondedAt = new Date().toISOString();
    // Optimistically reflect the shortlist/decline/restore in the cache so
    // the card updates immediately even on flaky jobsite connectivity.
    queryClient.setQueryData<ResponseRow[]>(['rfp-responses', bidId], (prev) =>
      (prev ?? []).map(r => r.id === responseId ? { ...r, status: nextStatus, responded_at: respondedAt } : r),
    );
    try {
      // Route through the offline queue (supabaseWrite) so a write that
      // can't reach the server right now is re-tried on reconnect instead
      // of silently lost — matching the rest of the app. supabaseWrite
      // toasts non-network failures itself; we surface network drops as a
      // queued write rather than an error.
      await supabaseWrite('bid_responses', 'update', {
        id: responseId, status: nextStatus, responded_at: respondedAt,
      });
      void queryClient.invalidateQueries({ queryKey: ['rfp-responses', bidId] });
    } finally {
      setBusyId(null);
    }
  }, [queryClient, bidId]);

  const runAward = useCallback(async (response: ResponseRow) => {
    setBusyId(response.id);
    try {
      const { data, error } = await supabase.functions.invoke('award-rfp', {
        body: { bidId, responseId: response.id },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error ?? 'Award failed.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        'Awarded!',
        'The contractor has been notified and the project + client portal are set up. They\'ll reach out to schedule kickoff.',
        [{ text: 'OK', onPress: () => { void queryClient.invalidateQueries({ queryKey: ['rfp-responses', bidId] }); void queryClient.invalidateQueries({ queryKey: ['rfp-header', bidId] }); } }],
      );
    } catch (e) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Could not award', String((e as Error).message ?? e));
    } finally {
      setBusyId(null);
    }
  }, [bidId, queryClient]);

  // The award is irreversible (declines every other bidder, closes the RFP,
  // creates the contractor's project + your client portal), so we confirm
  // TWICE: step 1 explains the blast radius, step 2 makes the committed
  // amount + company explicit on the final button.
  const handleAward = useCallback((response: ResponseRow) => {
    const companyName = response.company_name ?? 'this contractor';
    const amountText = response.bid_amount != null ? formatMoney(response.bid_amount) : null;
    showAlert(
      'Award this contractor?',
      `${response.company_name ?? 'This contractor'} will be notified, the project will be set up in their MAGE ID account, and your client portal will be created. All other bidders will be politely declined.\n\nThis can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          style: 'default',
          onPress: () => {
            // Second, distinct confirmation naming the exact commitment.
            showAlert(
              'Confirm award',
              amountText
                ? `Award this project to ${companyName} for ${amountText}? Every other bid will be declined and this cannot be undone.`
                : `Award this project to ${companyName}? Every other bid will be declined and this cannot be undone.`,
              [
                { text: 'Go back', style: 'cancel' },
                {
                  text: amountText ? `Award ${amountText}` : 'Award',
                  style: 'destructive',
                  onPress: () => { void runAward(response); },
                },
              ],
            );
          },
        },
      ],
    );
  }, [runAward]);

  if (!isOwner) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <AlertTriangle size={28} color={Colors.warning} strokeWidth={1.75} />
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
          <ChevronLeft size={26} color={themeColors.accent} strokeWidth={1.75} />
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
        {...fabScroll}
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { void refetch(); }} tintColor={themeColors.accent} />}
      >
        {isLoading && (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={themeColors.accent} />
          </View>
        )}

        {!isLoading && sortedResponses.length === 0 && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={themeColors.textMuted} strokeWidth={1.75} />
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
                    <Building2 size={16} color={themeColors.accent} strokeWidth={1.75} />
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
                    <Trophy size={10} color={themeColors.success} strokeWidth={1.75} />
                    <Text style={styles.awardedPillText}>AWARDED</Text>
                  </View>
                )}
                {isShortlist && (
                  <View style={styles.shortlistPill}>
                    <Star size={10} color={Colors.warning} strokeWidth={1.75} />
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
                  <Eye size={12} color={Colors.warning} strokeWidth={1.75} />
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
                  <MessageSquare size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.messageText} numberOfLines={6}>{r.scope_description}</Text>
                </View>
              )}

              <View style={styles.contactRow}>
                {r.proposer_email && (
                  <View style={styles.contactItem}>
                    <Mail size={11} color={themeColors.textMuted} strokeWidth={1.75} />
                    <Text style={styles.contactText}>{r.proposer_email}</Text>
                  </View>
                )}
                {r.proposer_phone && (
                  <View style={styles.contactItem}>
                    <Phone size={11} color={themeColors.textMuted} strokeWidth={1.75} />
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
                        : (<><Star size={13} color={Colors.warning} strokeWidth={1.75} /><Text style={[styles.actionBtnText, { color: Colors.warning }]}>Shortlist</Text></>)}
                    </TouchableOpacity>
                  )}
                  {isShortlist && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.unshortBtn]}
                      onPress={() => updateStatus(r.id, 'submitted')}
                      disabled={isBusy}
                    >
                      <Star size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.actionBtnText, { color: themeColors.textMuted }]}>Remove from shortlist</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.declineBtn]}
                    onPress={() => updateStatus(r.id, 'declined')}
                    disabled={isBusy}
                  >
                    <Text style={[styles.actionBtnText, { color: themeColors.danger }]}>Decline</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.awardBtn]}
                    onPress={() => handleAward(r)}
                    disabled={isBusy}
                  >
                    {isBusy ? <ActivityIndicator size="small" color="#FFF" />
                      : (<><Trophy size={13} color="#FFF" strokeWidth={1.75} /><Text style={[styles.actionBtnText, { color: '#FFF' }]}>Award</Text><ChevronRight size={11} color="#FFF" strokeWidth={1.75} /></>)}
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  controls: {
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
    gap: 8,
  },
  tabRow: { flexDirection: 'row', gap: 8 },
  tab: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 9, backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  tabActive: { backgroundColor: t.text, borderColor: t.text },
  tabText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  tabTextActive: { color: '#FFF' },
  sortRow: { flexDirection: 'row', gap: 6 },
  sortChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  sortChipActive: { backgroundColor: t.accent + '15', borderColor: t.accent },
  sortChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted },
  sortChipTextActive: { color: t.accent },

  loading: { padding: 30, alignItems: 'center' },
  emptyCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 28,
    alignItems: 'center', gap: 8, marginTop: 22,
    borderWidth: 1, borderColor: t.line,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '800', color: t.text, marginTop: 4, textAlign: 'center' },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 320 },

  card: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 14,
    borderWidth: 1, borderColor: t.line, marginBottom: 12, gap: 8,
  },
  cardAwarded:  { borderColor: t.success, borderWidth: 2, backgroundColor: t.success + '08' },
  cardDeclined: { opacity: 0.65 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  identityWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  identityIcon: { width: 36, height: 36, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '15', alignItems: 'center', justifyContent: 'center' },
  identityName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  identityMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },

  awardedPill:    { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: t.success + '20' },
  awardedPillText:{ fontSize: 9, fontWeight: '800', color: t.success, letterSpacing: 0.6 },
  shortlistPill:  { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: Colors.warning + '20' },
  shortlistPillText:{ fontSize: 9, fontWeight: '800', color: Colors.warning, letterSpacing: 0.6 },
  declinedPill:   { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: t.danger + '15' },
  declinedPillText:{ fontSize: 9, fontWeight: '800', color: t.danger, letterSpacing: 0.6 },

  siteVisitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: Colors.warning + '0D', borderWidth: 1, borderColor: Colors.warning + '30' },
  siteVisitText: { fontSize: Type.caption1.fontSize, color: Colors.warning, fontWeight: '700' },

  amountWrap: { paddingVertical: 4 },
  amountValue: { fontSize: 26, fontWeight: '800', color: t.text, letterSpacing: -0.6 },
  amountSummary: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 17 },

  messageBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: t.bg, borderWidth: 1, borderColor: t.line },
  messageText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 17 },

  contactRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  contactItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  contactText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },

  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 9, borderWidth: 1 },
  shortlistBtn: { backgroundColor: Colors.warning + '08', borderColor: Colors.warning + '40' },
  unshortBtn:   { backgroundColor: t.bg, borderColor: t.line },
  declineBtn:   { backgroundColor: t.bg, borderColor: t.danger + '40' },
  awardBtn:     { backgroundColor: t.accent, borderColor: t.accent, marginLeft: 'auto' },
  actionBtnText:{ fontSize: Type.caption1.fontSize, fontWeight: '700' },

  undeclineRow: { paddingTop: 6, alignSelf: 'flex-start' },
  undeclineText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },

  backCta: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: Tokens.radius.md, backgroundColor: t.accent, marginTop: 12 },
  backCtaText: { color: '#FFF', fontWeight: '700' },
});
