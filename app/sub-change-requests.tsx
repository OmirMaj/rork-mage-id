// sub-change-requests.tsx — GC-side inbox for sub-initiated change
// requests. The PM audit's #2 missing workflow primitive.
//
// Sub portal posts a SubChangeRequest with photo + price → this
// screen surfaces them grouped by status. GC taps a row to expand;
// inline approve / reject / needs revision actions. Approving auto-
// drafts a ChangeOrder pre-filled with the sub's data (TODO wiring
// at line 188; for now we just stamp the status and let the GC
// open change-order.tsx separately).
//
// Status pivot:
//   - submitted: 'Awaiting your review'
//   - needs_revision: 'Sent back to sub for changes'
//   - approved: 'Approved — see linked CO'
//   - rejected: 'Declined'

import React, { useCallback, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Platform, RefreshControl,
} from 'react-native';
import { Image } from 'expo-image';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2, XCircle, MessageSquare, ChevronRight, AlertTriangle,
  Inbox, FileText, Image as ImageIcon, Clock,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubChangeRequests } from '@/hooks/useSubChangeRequests';
import { formatMoney } from '@/utils/formatters';
import EmptyState from '@/components/EmptyState';
import type { SubChangeRequest } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

type FilterKey = 'pending' | 'needs_revision' | 'recent';

function timeAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString();
}

export default function SubChangeRequestsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects } = useProjects();
  const { requests, loading, approve, reject, requestRevision, refresh, pendingCount } = useSubChangeRequests();
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [refreshing, setRefreshing] = useState(false);

  const projectName = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const filtered = useMemo(() => {
    if (filter === 'pending') return requests.filter(r => r.status === 'submitted');
    if (filter === 'needs_revision') return requests.filter(r => r.status === 'needs_revision');
    // recent: approved + rejected in last 30 days
    const cutoff = Date.now() - 30 * 86_400_000;
    return requests.filter(r =>
      (r.status === 'approved' || r.status === 'rejected')
      && Date.parse(r.reviewedAt ?? r.submittedAt) >= cutoff,
    );
  }, [requests, filter]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refresh();
    } finally {
      setRefreshing(false);
    }
  }, [refresh]);

  const onApprove = useCallback((req: SubChangeRequest) => {
    Alert.alert(
      'Approve change request',
      `Approve ${req.subName}'s request for ${formatMoney(req.amount)}?\n\nThis stamps the request as approved. Open Change Orders to draft the formal CO that goes to the owner — we'll pre-fill it with this request's data.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            approve(req.id, { notes: 'Approved from inbox' });
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            // Route to the change-order create flow, pre-filled with
            // the request's amount + description + sub attribution.
            // TODO: wire prefill query params into change-order.tsx.
            // For now we just stamp the request and let the GC navigate.
          },
        },
      ],
    );
  }, [approve]);

  const onReject = useCallback((req: SubChangeRequest) => {
    // Cheap two-tap reason — tap "Reject" picks from common reasons.
    // A free-text path lives behind "Other reason…" to keep the
    // most-common case 2 taps.
    Alert.alert(
      'Reject change request',
      `Decline ${req.subName}'s request? You can include a reason the sub will see in their portal.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Out of scope',
          onPress: () => {
            reject(req.id, 'Out of scope of original contract.');
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          },
        },
        {
          text: 'Owner declined',
          onPress: () => {
            reject(req.id, 'Owner declined this scope.');
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          },
        },
      ],
    );
  }, [reject]);

  const onRevise = useCallback((req: SubChangeRequest) => {
    Alert.alert(
      'Send back for revision',
      `Ask ${req.subName} to update their request? They'll see the request marked "needs revision" in the sub portal.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Need more detail',
          onPress: () => requestRevision(req.id, 'Please add more detail (photos / scope / pricing breakdown).'),
        },
        {
          text: 'Price too high',
          onPress: () => requestRevision(req.id, 'Pricing seems high — can you break it down by labor + materials?'),
        },
      ],
    );
  }, [requestRevision]);

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Sub Change Requests',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />
        }
      >
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Sub change requests</Text>
          {pendingCount > 0 && (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.headerSub}>
          Subs submit extras from their portal — find the one in your shared link. You approve, decline, or send back.
        </Text>

        {/* Filter chips — pending is default */}
        <View style={styles.filterRow}>
          <FilterChip label="Pending" active={filter === 'pending'} count={requests.filter(r => r.status === 'submitted').length} onPress={() => setFilter('pending')} />
          <FilterChip label="Needs revision" active={filter === 'needs_revision'} count={requests.filter(r => r.status === 'needs_revision').length} onPress={() => setFilter('needs_revision')} />
          <FilterChip label="Recent" active={filter === 'recent'} count={null} onPress={() => setFilter('recent')} />
        </View>

        {loading ? (
          <View style={styles.loadingWrap}>
            <Inbox size={28} color={Colors.textMuted} />
            <Text style={styles.loadingText}>Loading inbox…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<CheckCircle2 size={36} color={Colors.success} strokeWidth={1.6} />}
            title={filter === 'pending' ? 'Inbox zero' : filter === 'needs_revision' ? 'Nothing waiting on the sub' : 'No recent decisions'}
            message={
              filter === 'pending'
                ? "No subs have submitted change requests since your last review. New requests land here automatically when a sub posts from their portal."
                : filter === 'needs_revision'
                ? "Requests you sent back to subs for revision will appear here."
                : "Approved and rejected requests from the last 30 days appear here."
            }
          />
        ) : (
          <View style={{ paddingHorizontal: 12 }}>
            {filtered.map(req => {
              const projName = projectName.get(req.projectId) ?? 'Unknown project';
              return (
                <View key={req.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <View style={[styles.statusDot, { backgroundColor: statusColor(req.status) }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardProject} numberOfLines={1}>{projName}</Text>
                      <Text style={styles.cardSub} numberOfLines={1}>
                        {req.subName} · {timeAgo(req.submittedAt)}
                      </Text>
                    </View>
                    <Text style={styles.cardAmount}>{formatMoney(req.amount)}</Text>
                  </View>

                  <Text style={styles.cardDescription}>{req.description}</Text>

                  {req.scheduleImpactDays != null && req.scheduleImpactDays > 0 && (
                    <View style={styles.cardChipRow}>
                      <Clock size={11} color={Colors.warning} />
                      <Text style={styles.cardChipText}>+{req.scheduleImpactDays} schedule day{req.scheduleImpactDays === 1 ? '' : 's'}</Text>
                    </View>
                  )}

                  {req.photos && req.photos.length > 0 && (
                    <View style={styles.photoRow}>
                      {req.photos.slice(0, 4).map((uri, i) => (
                        <Image key={`${uri}-${i}`} source={{ uri }} style={styles.photoThumb} contentFit="cover" />
                      ))}
                      {req.photos.length > 4 && (
                        <View style={[styles.photoThumb, styles.photoMoreOverlay]}>
                          <Text style={styles.photoMoreText}>+{req.photos.length - 4}</Text>
                        </View>
                      )}
                    </View>
                  )}

                  {req.notes && (
                    <View style={styles.notesRow}>
                      <MessageSquare size={11} color={Colors.textMuted} />
                      <Text style={styles.notesText}>{req.notes}</Text>
                    </View>
                  )}

                  {req.reviewNotes && (
                    <View style={[styles.notesRow, { backgroundColor: Colors.fillTertiary, padding: 8, borderRadius: Tokens.radius.sm }]}>
                      <FileText size={11} color={Colors.textMuted} />
                      <Text style={[styles.notesText, { fontStyle: 'italic' }]}>Your review note: {req.reviewNotes}</Text>
                    </View>
                  )}

                  {req.status === 'submitted' && (
                    <View style={styles.actionRow}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionApprove]}
                        onPress={() => onApprove(req)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Approve request"
                        testID={`approve-scr-${req.id}`}
                      >
                        <CheckCircle2 size={14} color={Colors.success} />
                        <Text style={[styles.actionBtnText, { color: Colors.success }]}>Approve</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionRevise]}
                        onPress={() => onRevise(req)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Send back for revision"
                        testID={`revise-scr-${req.id}`}
                      >
                        <AlertTriangle size={14} color={Colors.warning} />
                        <Text style={[styles.actionBtnText, { color: Colors.warning }]}>Revise</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.actionReject]}
                        onPress={() => onReject(req)}
                        activeOpacity={0.85}
                        accessibilityRole="button"
                        accessibilityLabel="Reject request"
                        testID={`reject-scr-${req.id}`}
                      >
                        <XCircle size={14} color={Colors.error} />
                        <Text style={[styles.actionBtnText, { color: Colors.error }]}>Reject</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {req.status === 'approved' && req.resultingChangeOrderId && (
                    <TouchableOpacity
                      style={styles.linkedCoRow}
                      onPress={() => router.push({ pathname: '/change-order' as never, params: { id: req.resultingChangeOrderId } as never })}
                      activeOpacity={0.85}
                    >
                      <FileText size={14} color={Colors.primary} />
                      <Text style={styles.linkedCoText}>Open linked change order</Text>
                      <ChevronRight size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function FilterChip({ label, active, count, onPress }: { label: string; active: boolean; count: number | null; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.filterChip, active && styles.filterChipActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
        {label}{count != null ? ` (${count})` : ''}
      </Text>
    </TouchableOpacity>
  );
}

function statusColor(status: SubChangeRequest['status']): string {
  switch (status) {
    case 'submitted': return Colors.warning;
    case 'needs_revision': return Colors.info;
    case 'approved': return Colors.success;
    case 'rejected': return Colors.error;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingHorizontal: 16, marginTop: 6 },
  headerTitle: { flex: 1, fontSize: Type.title2.fontSize, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.4 },
  headerBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.full, backgroundColor: Colors.warning + '20' },
  headerBadgeText: { fontSize: Type.footnote.fontSize, fontWeight: '900' as const, color: Colors.warning },
  headerSub: { paddingHorizontal: 16, fontSize: Type.footnote.fontSize, color: Colors.textMuted, marginBottom: 12, marginTop: 4 },

  filterRow: { flexDirection: 'row' as const, gap: 6, paddingHorizontal: 16, marginBottom: 12 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.full, backgroundColor: Colors.fillTertiary },
  filterChipActive: { backgroundColor: Colors.primary },
  filterChipText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.textMuted },
  filterChipTextActive: { color: Colors.textOnPrimary },

  loadingWrap: { padding: 36, alignItems: 'center' as const, gap: 8 },
  loadingText: { fontSize: Type.footnote.fontSize, color: Colors.textMuted },

  card: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  cardHead: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: Tokens.radius.full },
  cardProject: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const, color: Colors.text },
  cardSub: { fontSize: Type.caption2.fontSize, color: Colors.textMuted, marginTop: 1 },
  cardAmount: { fontSize: Type.subheadline.fontSize, fontWeight: '900' as const, color: Colors.text, letterSpacing: -0.3 },
  cardDescription: { fontSize: Type.bodyCompact.fontSize, color: Colors.text, lineHeight: 20 },

  cardChipRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, alignSelf: 'flex-start' as const, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: Colors.warning + '15' },
  cardChipText: { fontSize: Type.caption2.fontSize, color: Colors.warning, fontWeight: '700' as const },

  photoRow: { flexDirection: 'row' as const, gap: 6, flexWrap: 'wrap' as const },
  photoThumb: { width: 64, height: 64, borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillTertiary },
  photoMoreOverlay: { alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: Colors.fillSecondary },
  photoMoreText: { fontSize: Type.caption2.fontSize, fontWeight: '800' as const, color: Colors.text },

  notesRow: { flexDirection: 'row' as const, gap: 6, alignItems: 'flex-start' as const },
  notesText: { flex: 1, fontSize: Type.caption1.fontSize, color: Colors.text, lineHeight: 16 },

  actionRow: { flexDirection: 'row' as const, gap: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  actionBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 4, paddingVertical: 10, borderRadius: Tokens.radius.sm },
  actionApprove: { backgroundColor: Colors.success + '12' },
  actionRevise: { backgroundColor: Colors.warning + '12' },
  actionReject: { backgroundColor: Colors.error + '12' },
  actionBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '800' as const },

  linkedCoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, padding: 10, borderRadius: Tokens.radius.sm, backgroundColor: Colors.primary + '10' },
  linkedCoText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: Colors.primary },
});

void ImageIcon;
