// rfp-responses-review — homeowner sees every bid on a single RFP, sorts
// + shortlists, then picks a winner. Awarding fires the award-rfp edge
// function which atomically:
//   1. Sets the chosen bid_response.status='awarded'
//   2. Marks all other responses on this RFP 'declined'
//   3. Closes the public_bid (status='closed', awarded_response_id, awarded_at)
//   4. Creates a project in the awarded contractor's account, populated
//      with the homeowner's street address, the accepted price, photos,
//      drawings and contact (award_rfp, 20260918120000 — before that it
//      carried only title/scope/city and none of the rest)
//   5. Seeds the contractor's client_portal record with the homeowner's
//      email on the invite, and notifies the contractor. The portal opens
//      for the homeowner only once the contractor publishes it and sends
//      the link — so this screen promises the link, not the portal.
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
  Phone, Mail, Inbox, ChevronRight, AlertTriangle, Building2, RefreshCw, FileText,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { edgeFunctionError } from '@/utils/edgeError';
import { supabaseWrite } from '@/utils/offlineQueue';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { awardCarriedItems, joinItems } from '@/supabase/functions/award-rfp/carried';
import { prePostReachNotice } from '@/supabase/functions/notify-nearby-contractors/reach';
import { RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED } from '@/constants/featureFlags';
import { useProperties } from '@/contexts/PropertyContext';
import { workOrdersAssignedByAward } from '@/utils/propertyMirror';

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
  // Read so the award alerts name only what award_rfp actually carries. The
  // street address is NOT a public_bids column other accounts may read
  // (20260923101000); the poster gets it through get_rfp_private.
  address_line: string | null;
  photo_urls: unknown;
  drawing_urls: unknown;
}

type SortMode = 'recent' | 'low' | 'high';

// award_rfp sets a budget only for a positive bid (never $0), so the alerts
// name a price only then — to the cent, as award_rfp stores round(bid, 2):
// a $48,500.50 bid must not read "$48,501" on the award.
function priceTextFor(amount: number | null | undefined): string | null {
  return typeof amount === 'number' && amount > 0 ? formatMoney(amount, 2) : null;
}

/**
 * The poster's own street address, for the award alerts' "your street
 * address" line. Since 20260923101000 address_line is not a column other
 * accounts may read; get_rfp_private (20260923100000, applied before this
 * build ships) returns it to the poster. Throws on any failure: the alerts
 * must never guess "you gave no street address" off a read that didn't work.
 */
async function readOwnAddress(bidId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('get_rfp_private', { p_bid_id: bidId });
  if (error) throw new Error(error.message || 'Could not load this RFP.');
  const row = data as { address_line?: string | null } | null;
  return row?.address_line ?? null;
}

export default function RfpResponsesReviewScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { workOrders, updateWorkOrder } = useProperties();
  const { user, isLoading: authLoading } = useAuth();
  const { bidId } = useLocalSearchParams<{ bidId: string }>();

  const [sort, setSort] = useState<SortMode>('recent');
  const [filter, setFilter] = useState<'all' | 'shortlist'>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const enabled = !!bidId && !!user?.id && isSupabaseConfigured;

  // Audit wave 5, #97. This read used to swallow every failure into
  // `undefined`, and `isOwner` was false for undefined — so a homeowner on a
  // weak signal was told "Not your project" about her own post. The query now
  // THROWS on a real failure (react-query keeps it retryable and never caches
  // it as a success), and a genuine no-row comes back as null. The screen
  // below tells the four cases apart: loading, couldn't load, gone, not yours.
  const {
    data: rfp, isError: headerFailed, fetchStatus: headerFetch, refetch: refetchHeader, isFetching: headerFetching,
  } = useQuery({
    queryKey: ['rfp-header', bidId],
    enabled,
    queryFn: async (): Promise<RfpHeader | null> => {
      const { data, error } = await supabase
        .from('public_bids')
        .select('id,user_id,title,status,awarded_response_id,photo_urls,drawing_urls')
        .eq('id', bidId)
        .maybeSingle();
      if (error) throw new Error(error.message || 'Could not load this RFP.');
      if (!data) return null;
      // Not hers: nothing private to read, and the screen says so below.
      if (data.user_id !== user?.id) return { ...data, address_line: null };
      return { ...data, address_line: await readOwnAddress(bidId ?? '') };
    },
  });

  const {
    data: responses, isLoading, refetch, isRefetching, isError: responsesFailed, isFetching: responsesFetching,
  } = useQuery({
    queryKey: ['rfp-responses', bidId],
    enabled,
    queryFn: async (): Promise<ResponseRow[]> => {
      const { data, error } = await supabase
        .from('bid_responses')
        .select('id,bid_id,user_id,proposer_company_id,company_name,proposer_email,proposer_phone,bid_amount,estimate_summary,scope_description,view_site_requested,status,created_at,responded_at')
        .eq('bid_id', bidId)
        .order('created_at', { ascending: false });
      // Throw, never `return []`: an empty array is "No bids yet", which is a
      // claim about her post, not about the network (#97). A failed 30-second
      // poll keeps the bids already on screen — react-query holds the last
      // good data through an error — so the error card shows only when there
      // is nothing to show.
      if (error) throw new Error(error.message || 'Could not load the bids.');
      return (data ?? []) as ResponseRow[];
    },
    refetchInterval: 30_000,
  });
  const responsesLoadFailed = responses === undefined && responsesFailed;

  const sortedResponses = useMemo(() => {
    let list = responses ?? [];
    if (filter === 'shortlist') list = list.filter(r => r.status === 'shortlisted' || r.status === 'awarded');
    if (sort === 'low')    list = [...list].sort((a, b) => (a.bid_amount ?? Infinity) - (b.bid_amount ?? Infinity));
    if (sort === 'high')   list = [...list].sort((a, b) => (b.bid_amount ?? -Infinity) - (a.bid_amount ?? -Infinity));
    if (sort === 'recent') list = [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    // Always pin awarded to top.
    return list.sort((a, b) => (a.status === 'awarded' ? -1 : 0) - (b.status === 'awarded' ? -1 : 0));
  }, [responses, sort, filter]);

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
      // CONTRACT 26: award-rfp answers a withdrawn bid with a 409 and a plain
      // sentence — supabase-js hides it behind "non-2xx status code".
      if (error) throw await edgeFunctionError(error, 'Award failed.');
      if (!data?.success) throw new Error(data?.error ?? 'Award failed.');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // award-rfp moved the PM's work order posted as this RFP to 'assigned'
      // on the server, but this device only reads that copy at sign-in. Apply
      // the same change here, or his list says "Out for bids" until a restart
      // and his next edit upserts the stale row over the recorded assignee.
      const awardedCompany = typeof data.companyName === 'string' && data.companyName.trim()
        ? data.companyName.trim() : null;
      const nowIso = new Date().toISOString();
      for (const { id, updates } of workOrdersAssignedByAward(workOrders, bidId ?? '', awardedCompany, nowIso)) {
        updateWorkOrder(id, updates);
      }
      // Say exactly what happened. This used to promise "the project + client
      // portal are set up" — but the portal reads a snapshot the contractor
      // has to publish, the award returned no link, and the seeded invite had
      // no email (audit round 2, #7/#19). award_rfp now carries the address,
      // price, photos, drawings and this homeowner's email onto the
      // contractor's project, so the true sentence is: they have your details,
      // and they will send the portal link to this address.
      const company = (typeof data.companyName === 'string' && data.companyName.trim())
        || response.company_name || 'The contractor';
      const email = typeof data.homeownerEmail === 'string' && data.homeownerEmail.includes('@')
        ? data.homeownerEmail : null;
      const carried = joinItems(awardCarriedItems(rfp ?? {}, priceTextFor(response.bid_amount)));
      showAlert(
        'Awarded!',
        `${company} has been notified. ${carried.charAt(0).toUpperCase()}${carried.slice(1)} ${carried.includes(' and ') ? 'are' : 'is'} on their new project.\n\n`
          + (email
            ? `They'll set up your project portal and send the link to ${email}.`
            : 'They\'ll set up your project portal and send you the link.'),
        [{ text: 'OK', onPress: () => { void queryClient.invalidateQueries({ queryKey: ['rfp-responses', bidId] }); void queryClient.invalidateQueries({ queryKey: ['rfp-header', bidId] }); } }],
      );
    } catch (e) {
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showAlert('Could not award', String((e as Error).message ?? e));
    } finally {
      setBusyId(null);
    }
  }, [bidId, queryClient, rfp, workOrders, updateWorkOrder]);

  // The award is irreversible (declines every other bidder, closes the RFP,
  // creates the contractor's project), so we confirm
  // TWICE: step 1 explains the blast radius, step 2 makes the committed
  // amount + company explicit on the final button.
  const handleAward = useCallback((response: ResponseRow) => {
    const companyName = response.company_name ?? 'this contractor';
    const amountText = response.bid_amount != null ? formatMoney(response.bid_amount, 2) : null;
    showAlert(
      'Award this contractor?',
      `${response.company_name ?? 'This contractor'} will be notified and get a project in their MAGE ID account with ${joinItems(awardCarriedItems(rfp ?? {}, priceTextFor(response.bid_amount)).map(i => i.replace(/^the (.*) price$/, 'their $1 price')))}. They'll send you a link to your project portal once they've set it up. All other bidders will be politely declined.\n\nThis can't be undone.`,
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
  }, [runAward, rfp]);

  // ── Non-success states (#97) ──────────────────────────────────────────────
  // react-query runs networkMode 'offlineFirst' (app/_layout.tsx), so a read
  // with no network sits at fetchStatus 'paused' with no error: that is a
  // stalled read, not a loading one. `!rfp` is load-bearing (the
  // rfp-detail.tsx pattern): a failed background refetch must never replace a
  // post she is reading.
  const renderState = (title: string, body: string, opts: { retry?: boolean; tone?: 'warn' | 'muted' } = {}) => (
    <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
      <Stack.Screen options={{ headerShown: false }} />
      {opts.tone === 'muted'
        ? <FileText size={28} color={themeColors.textMuted} strokeWidth={1.75} />
        : <AlertTriangle size={28} color={Colors.warningLabel} strokeWidth={1.75} />}
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {opts.retry && (
        <TouchableOpacity
          style={[styles.retryCta, headerFetching && { opacity: 0.5 }]}
          onPress={() => { void refetchHeader(); void refetch(); }}
          disabled={headerFetching}
          accessibilityRole="button"
          testID="rfp-review-retry"
        >
          {headerFetching
            ? <ActivityIndicator size="small" color={themeColors.accent} />
            : (<><RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.retryCtaText}>Retry</Text></>)}
        </TouchableOpacity>
      )}
      <TouchableOpacity style={styles.backCta} onPress={() => router.back()} accessibilityRole="button">
        <Text style={styles.backCtaText}>Go back</Text>
      </TouchableOpacity>
    </View>
  );

  if (!bidId) {
    return renderState('We could not open that link', 'It is missing a project reference. Open the post again from My RFPs.');
  }
  if (!isSupabaseConfigured) {
    return renderState('Couldn\'t load this RFP', 'MAGE ID can\'t reach its server from this build, so the bids can\'t be loaded.');
  }
  if (!user?.id) {
    // Auth still restoring: wait. Signed out: say what's needed, not "not yours".
    if (authLoading) {
      return (
        <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
          <Stack.Screen options={{ headerShown: false }} />
          <ActivityIndicator size="small" color={themeColors.accent} />
        </View>
      );
    }
    return renderState('Sign in to review bids', 'Only the homeowner who posted this RFP can review its bids. Sign in with that account.');
  }
  if (!rfp && (headerFailed || headerFetch === 'paused')) {
    return renderState('Couldn\'t load this RFP — check your connection', 'Nothing was lost. Try again when you have signal.', { retry: true });
  }
  if (rfp === undefined) {
    return (
      <View style={[styles.container, styles.centered, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="small" color={themeColors.accent} />
        <Text style={styles.emptyBody}>Loading your post…</Text>
      </View>
    );
  }
  if (rfp === null) {
    return renderState('This RFP no longer exists', 'It may have been taken down. My RFPs lists every post you still have.', { tone: 'muted' });
  }
  // Only a LOADED row with another poster's id is "not yours".
  if (rfp.user_id !== user.id) {
    return renderState('Not your project', 'Only the homeowner who posted this RFP can review bids.');
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

        {responsesLoadFailed && (
          <View style={styles.emptyCard} testID="rfp-review-bids-error">
            <AlertTriangle size={28} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>Couldn&apos;t load the bids</Text>
            <Text style={styles.emptyBody}>Check your connection. Nothing was lost — any bid on this post is still here.</Text>
            <TouchableOpacity
              style={[styles.retryCta, responsesFetching && { opacity: 0.5 }]}
              onPress={() => { void refetch(); }}
              disabled={responsesFetching}
              accessibilityRole="button"
            >
              {responsesFetching
                ? <ActivityIndicator size="small" color={themeColors.accent} />
                : (<><RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} /><Text style={styles.retryCtaText}>Retry</Text></>)}
            </TouchableOpacity>
          </View>
        )}

        {!isLoading && !responsesLoadFailed && responses !== undefined && sortedResponses.length === 0 && (
          <View style={styles.emptyCard}>
            <Inbox size={28} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No bids yet</Text>
            <Text style={styles.emptyBody}>
              {/* Was "Contractors near you will see your project and start
                  submitting bids" — with browsing off and no contractor
                  service areas that could not happen (audit round 2, #8).
                  My RFPs shows how many were actually alerted. */}
              {!SERVICE_AREA_SETUP_ENABLED
                ? `${prePostReachNotice(RFP_BROWSE_ENABLED, SERVICE_AREA_SETUP_ENABLED) ?? ''} New bids show up here automatically.`
                : RFP_BROWSE_ENABLED
                ? 'We alerted MAGE ID contractors who cover your area, and your post is listed for contractors browsing nearby jobs. My RFPs shows how many were alerted. New bids show up here automatically.'
                : 'Only MAGE ID contractors who cover your area are alerted — browsing posted projects isn\'t open yet. My RFPs shows how many were alerted, including if that is none. New bids show up here automatically.'}
            </Text>
          </View>
        )}

        {sortedResponses.map(r => {
          const isAwardedRow = r.status === 'awarded';
          const isShortlist  = r.status === 'shortlisted';
          const isDeclined   = r.status === 'declined';
          // A withdrawn bid can't be shortlisted, declined or awarded (the
          // server refuses all three since 20260923100000).
          const isWithdrawn  = r.status === 'withdrawn';
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
                    <Star size={10} color={Colors.warningLabel} strokeWidth={1.75} />
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
                  <Eye size={12} color={Colors.warningLabel} strokeWidth={1.75} />
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

              {!isAwarded && !isDeclined && !isAwardedRow && !isWithdrawn && (
                <View style={styles.actionRow}>
                  {!isShortlist && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.shortlistBtn]}
                      onPress={() => updateStatus(r.id, 'shortlisted')}
                      disabled={isBusy}
                    >
                      {isBusy ? <ActivityIndicator size="small" color={Colors.warningLabel} />
                        : (<><Star size={13} color={Colors.warningLabel} strokeWidth={1.75} /><Text style={[styles.actionBtnText, { color: Colors.warningLabel }]}>Shortlist</Text></>)}
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

              {isWithdrawn && (
                <Text style={styles.withdrawnText}>The contractor withdrew this bid.</Text>
              )}

              {isDeclined && !isAwarded && (
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
  shortlistPillText:{ fontSize: 9, fontWeight: '800', color: Colors.warningLabel, letterSpacing: 0.6 },
  declinedPill:   { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: t.danger + '15' },
  declinedPillText:{ fontSize: 9, fontWeight: '800', color: t.danger, letterSpacing: 0.6 },

  siteVisitRow: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: Tokens.radius.md, backgroundColor: Colors.warning + '0D', borderWidth: 1, borderColor: Colors.warning + '30' },
  siteVisitText: { fontSize: Type.caption1.fontSize, color: Colors.warningLabel, fontWeight: '700' },

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
  awardBtn:     { backgroundColor: t.accentFill, borderColor: t.accent, marginLeft: 'auto' },
  actionBtnText:{ fontSize: Type.caption1.fontSize, fontWeight: '700' },

  undeclineRow: { paddingTop: 6, alignSelf: 'flex-start' },
  undeclineText: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700' },

  retryCta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.accent, marginTop: 12 },
  retryCtaText: { color: t.accent, fontWeight: '700' },
  withdrawnText: { fontSize: Type.caption1.fontSize, color: t.textMuted, fontWeight: '600' },
  backCta: { paddingHorizontal: 18, paddingVertical: 11, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill, marginTop: 12 },
  backCtaText: { color: '#FFF', fontWeight: '700' },
});
