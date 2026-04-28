import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft, Bell, MessageSquare, HandCoins, CheckCircle2, Inbox,
  Trash2, X, CheckCheck, Settings,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useNotificationFeed, type NotificationFeedItem } from '@/hooks/useNotificationFeed';

const EVENT_META: Record<string, { icon: React.ReactNode; tint: string; label: string }> = {
  portal_message: { icon: <MessageSquare size={16} color="#007AFF" />, tint: '#E7F0FA', label: 'Client message' },
  budget_proposal: { icon: <HandCoins size={16} color="#FF6A1A" />, tint: '#FFF1E6', label: 'Budget proposal' },
  co_approval: { icon: <CheckCircle2 size={16} color="#1E8E4A" />, tint: '#E8F5ED', label: 'CO decision' },
  sub_invoice_submitted: { icon: <Inbox size={16} color="#AF52DE" />, tint: '#F4ECFA', label: 'Sub invoice' },
  sub_invoice_reviewed: { icon: <Inbox size={16} color="#AF52DE" />, tint: '#F4ECFA', label: 'Sub invoice update' },
};

function fmtAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function summarize(item: NotificationFeedItem): { title: string; body: string } {
  const p = item.payload as Record<string, unknown>;
  const projectName = (p.project_name as string) || 'project';
  switch (item.eventType) {
    case 'portal_message':
      return {
        title: `${(p.author_name as string) || 'Client'} sent a message`,
        body: String(p.body || '').slice(0, 160),
      };
    case 'budget_proposal':
      return {
        title: `${(p.proposer_name as string) || 'Client'} proposed a budget`,
        body: `$${Number(p.amount || 0).toLocaleString()} for ${projectName}${p.note ? ` — "${String(p.note).slice(0, 80)}"` : ''}`,
      };
    case 'co_approval': {
      const decision = String(p.decision || 'updated');
      return {
        title: `Change order ${decision} by ${(p.signer_name as string) || 'client'}`,
        body: `Synced to your CO record automatically.`,
      };
    }
    case 'sub_invoice_submitted':
      return {
        title: `${(p.submitted_by_name as string) || 'Sub'} submitted invoice #${p.invoice_number}`,
        body: `$${Number(p.amount || 0).toLocaleString()} — pending your review`,
      };
    case 'sub_invoice_reviewed':
      return {
        title: `Invoice #${p.invoice_number} ${String(p.status || 'updated')}`,
        body: `Sub has been notified by email.`,
      };
    default:
      return { title: item.eventType, body: '' };
  }
}

function deepLinkFor(item: NotificationFeedItem): string | null {
  const p = item.payload as Record<string, unknown>;
  const projectId = (p.project_id as string | undefined) ?? (p.projectId as string | undefined);
  switch (item.eventType) {
    case 'portal_message':
      // Open the portal-setup screen (which surfaces messages in-line).
      return projectId ? `/client-portal-setup?id=${projectId}` : null;
    case 'budget_proposal':
      // Same screen — proposals show up there for review/accept.
      return projectId ? `/client-portal-setup?id=${projectId}` : null;
    case 'co_approval': {
      // Route directly to the change order, not the portal setup screen.
      // Falls back to project-detail if we don't have a CO id.
      const coId = (p.change_order_id as string | undefined) ?? (p.changeOrderId as string | undefined);
      if (projectId && coId) return `/change-order?projectId=${projectId}&coId=${coId}`;
      if (projectId) return `/project-detail?id=${projectId}`;
      return null;
    }
    case 'contract_signed':
      // Contract just got countersigned — route straight to the contract.
      return projectId ? `/contract?projectId=${projectId}` : null;
    case 'selection_chosen':
      // Homeowner picked a selection — route to selections so the GC can
      // see the new pick + flag if it's over allowance.
      return projectId ? `/selections?projectId=${projectId}` : null;
    case 'closeout_binder_sent':
      return projectId ? `/closeout-binder?projectId=${projectId}` : null;
    case 'bid_question_asked':
    case 'bid_question_answered': {
      const rfpId = (p.rfp_id as string | undefined) ?? (p.bid_id as string | undefined);
      return rfpId ? `/rfp-detail?bidId=${rfpId}` : null;
    }
    case 'sub_invoice_submitted':
    case 'sub_invoice_reviewed': {
      // If we know the project + sub portal, route to that specific sub
      // portal setup screen so the GC can review the invoice.
      const subId = (p.sub_id as string | undefined) ?? (p.subId as string | undefined);
      if (projectId && subId) return `/sub-portal-setup?projectId=${projectId}&subId=${subId}`;
      return '/sub-portals';
    }
    case 'rfp_awarded':
      return projectId ? `/project-detail?id=${projectId}` : null;
    case 'nearby_rfp_posted': {
      const rfpId = (p.rfp_id as string | undefined) ?? (p.bid_id as string | undefined);
      return rfpId ? `/rfp-detail?bidId=${rfpId}` : null;
    }
    default:
      return null;
  }
}

export default function NotificationsInboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const feed = useNotificationFeed();

  const handleTap = useCallback((item: NotificationFeedItem) => {
    if (!item.readAt) feed.markRead(item.id);
    const link = deepLinkFor(item);
    if (link) router.push(link as never);
  }, [feed, router]);

  const handleClearAll = useCallback(() => {
    Alert.alert(
      'Clear all notifications?',
      'This will dismiss every notification in your inbox. Push and email history is unaffected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear all',
          style: 'destructive',
          onPress: () => {
            feed.items.forEach(i => feed.dismiss(i.id));
          },
        },
      ],
    );
  }, [feed]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notifications</Text>
          {feed.unreadCount > 0 && (
            <Text style={styles.subtitle}>{feed.unreadCount} unread</Text>
          )}
        </View>
        {feed.items.length > 0 && (
          <TouchableOpacity style={styles.headerAction} onPress={feed.markAllRead}>
            <CheckCheck size={16} color={Colors.text} />
            <Text style={styles.headerActionText}>Mark all read</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => router.push('/notifications-settings' as never)}
          hitSlop={6}
        >
          <Settings size={18} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={feed.items}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 16, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Bell size={40} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
            <Text style={styles.emptyBody}>
              When clients send messages, propose budgets, approve change orders, or subs submit invoices, you&apos;ll see the history here.
            </Text>
          </View>
        }
        ListFooterComponent={
          feed.items.length > 0 ? (
            <TouchableOpacity style={styles.clearAll} onPress={handleClearAll}>
              <Trash2 size={14} color={Colors.error} />
              <Text style={styles.clearAllText}>Clear all</Text>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          const meta = EVENT_META[item.eventType] ?? { icon: <Bell size={16} color={Colors.text} />, tint: Colors.background, label: item.eventType };
          const summary = summarize(item);
          const isUnread = !item.readAt;
          return (
            <TouchableOpacity
              style={[styles.row, isUnread && styles.rowUnread]}
              onPress={() => handleTap(item)}
              activeOpacity={0.7}
            >
              <View style={[styles.iconWrap, { backgroundColor: meta.tint }]}>
                {meta.icon}
                {isUnread && <View style={styles.unreadDot} />}
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.rowHead}>
                  <Text style={styles.rowEyebrow}>{meta.label}</Text>
                  <Text style={styles.rowTime}>{fmtAgo(item.createdAt)}</Text>
                </View>
                <Text style={styles.rowTitle} numberOfLines={1}>{summary.title}</Text>
                {summary.body ? (
                  <Text style={styles.rowBody} numberOfLines={2}>{summary.body}</Text>
                ) : null}
              </View>
              <TouchableOpacity
                style={styles.dismissBtn}
                onPress={(e) => { e.stopPropagation(); feed.dismiss(item.id); }}
                hitSlop={6}
              >
                <X size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 12, color: Colors.primary, fontWeight: '700', marginTop: 2 },
  headerAction: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  headerActionText: { fontSize: 12, fontWeight: '700', color: Colors.text },
  headerIconBtn: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },

  row: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, marginVertical: 4,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
  },
  rowUnread: { borderColor: Colors.primary + '40', backgroundColor: '#FFF7EE' },
  iconWrap: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  unreadDot: {
    position: 'absolute', top: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: Colors.primary,
    borderWidth: 2, borderColor: Colors.card,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  rowEyebrow: { fontSize: 10, fontWeight: '700', color: Colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  rowTime: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' },
  rowTitle: { fontSize: 14, fontWeight: '700', color: Colors.text },
  rowBody: { fontSize: 13, color: Colors.text, marginTop: 3, lineHeight: 18 },
  dismissBtn: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  empty: {
    alignItems: 'center', padding: 40, marginTop: 40,
    gap: 10,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, marginTop: 4 },
  emptyBody: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 280 },

  clearAll: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
    paddingVertical: 16, marginTop: 6,
  },
  clearAllText: { fontSize: 13, fontWeight: '600', color: Colors.error },
});
