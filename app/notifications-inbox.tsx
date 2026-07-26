import React, { useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, Alert,
} from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronLeft, Bell, MessageSquare, HandCoins, CheckCircle2, Inbox,
  Trash2, X, CheckCheck, Settings,
  PenTool, ShoppingCart, Hammer, HelpCircle, Trophy, Package, Sunrise, CalendarCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useNotificationFeed, type NotificationFeedItem } from '@/hooks/useNotificationFeed';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

// Friendly metadata for every event that can land in the inbox. Keep
// the eyebrow labels SHORT (≤16 chars) so they fit on narrow screens
// without truncating. Tints are pale-pastel so they read as a tag,
// not a button.
const EVENT_META: Record<string, { icon: React.ReactNode; tint: string; label: string }> = {
  // Client → GC
  portal_message:        { icon: <MessageSquare size={16} color={"#1565C0"} strokeWidth={1.75} />, tint: '#E7F0FA', label: 'Client message' },
  budget_proposal:       { icon: <HandCoins   size={16} color={Colors.orange} strokeWidth={1.75} />, tint: '#FFF1E6', label: 'Budget proposal' },
  co_approval:           { icon: <CheckCircle2 size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Change order' },
  contract_signed:       { icon: <PenTool     size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Contract signed' },
  selection_chosen:      { icon: <ShoppingCart size={16} color={Colors.orange} strokeWidth={1.75} />, tint: '#FFF1E6', label: 'Selection picked' },
  closeout_binder_sent:  { icon: <Package     size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Closeout delivered' },

  // Sub → GC
  sub_invoice_submitted: { icon: <Inbox       size={16} color="#AF52DE" strokeWidth={1.75} />, tint: '#F4ECFA', label: 'Sub invoice' },
  sub_invoice_reviewed:  { icon: <Inbox       size={16} color="#AF52DE" strokeWidth={1.75} />, tint: '#F4ECFA', label: 'Invoice update' },

  // Marketplace
  nearby_rfp_posted:     { icon: <Hammer      size={16} color={Colors.purple} strokeWidth={1.75} />, tint: '#EFEFFA', label: 'New project nearby' },
  rfp_awarded:           { icon: <Trophy      size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'You won the bid' },
  bid_question_asked:    { icon: <HelpCircle  size={16} color={Colors.purple} strokeWidth={1.75} />, tint: '#EFEFFA', label: 'Pre-bid question' },
  bid_question_answered: { icon: <HelpCircle  size={16} color={Colors.purple} strokeWidth={1.75} />, tint: '#EFEFFA', label: 'Bid Q&A' },

  // Brain
  morning_brief:         { icon: <Sunrise       size={16} color={Colors.orange} strokeWidth={1.75} />, tint: '#FFF1E6', label: 'Morning Brief' },
  week_close:            { icon: <CalendarCheck size={16} color={Colors.orange} strokeWidth={1.75} />, tint: '#FFF1E6', label: 'Friday Close' },
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

// Format a number as a clean "$1,234" or "$4.2M" string. Money values
// shown in notification bodies prefer compact form so they don't wrap.
function fmtMoney(raw: unknown): string {
  const n = typeof raw === 'string' ? parseFloat(raw) : Number(raw ?? 0);
  if (!isFinite(n) || n <= 0) return '';
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n.toLocaleString('en-US')}`;
}

function summarize(item: NotificationFeedItem): { title: string; body: string } {
  const p = item.payload as Record<string, unknown>;
  const projectName = (p.project_name as string) || (p.projectName as string) || 'your project';

  switch (item.eventType) {
    case 'portal_message': {
      const author = (p.author_name as string) || 'A client';
      return {
        title: `${author} sent a message`,
        body: String(p.body || '').slice(0, 160),
      };
    }
    case 'budget_proposal': {
      const proposer = (p.proposer_name as string) || 'A client';
      const amount = fmtMoney(p.amount);
      return {
        title: `${proposer} proposed ${amount || 'a target budget'}`,
        body: amount
          ? `${projectName}${p.note ? ` — "${String(p.note).slice(0, 80)}"` : ''}`
          : projectName,
      };
    }
    case 'co_approval': {
      const decision = String(p.decision || 'updated');
      const signer = (p.signer_name as string) || 'your client';
      const verb = decision === 'approved' ? 'approved' : decision === 'declined' ? 'declined' : 'reviewed';
      const coNum = (p.co_number as string) || '';
      const amount = fmtMoney(p.co_amount);
      return {
        title: coNum
          ? `${signer} ${verb} CO #${coNum}`
          : `${signer} ${verb} a change order`,
        body: amount
          ? `${amount} change · ${projectName}`
          : `Synced to your CO record automatically.`,
      };
    }
    case 'contract_signed': {
      const signer = (p.signer_name as string) || 'Your client';
      const amount = fmtMoney(p.contract_value);
      return {
        title: `${signer} signed the contract`,
        body: amount
          ? `${amount} · ${projectName}. Pull the signed PDF in MAGE ID.`
          : `${projectName}. Pull the signed PDF in MAGE ID.`,
      };
    }
    case 'selection_chosen': {
      const product = (p.product_name as string) || 'an option';
      const category = (p.category as string) || '';
      const brand = (p.brand as string) || '';
      const cost = fmtMoney(p.total_cost);
      const overBudget = !!p.over_budget;
      return {
        title: category
          ? `Picked ${product} for ${category}`
          : `Selection picked: ${product}`,
        body: [
          brand,
          cost ? (overBudget ? `${cost} · over allowance` : cost) : '',
          projectName,
        ].filter(Boolean).join(' · '),
      };
    }
    case 'closeout_binder_sent': {
      const homeowner = (p.homeowner_name as string) || 'your client';
      return {
        title: `Closeout binder delivered`,
        body: `${homeowner === 'there' ? 'The homeowner' : homeowner} now has the full closeout for ${projectName}.`,
      };
    }
    case 'sub_invoice_submitted': {
      const submitter = (p.submitted_by_name as string) || 'A sub';
      const num = (p.invoice_number as string) || '';
      const amount = fmtMoney(p.amount);
      return {
        title: num
          ? `${submitter} submitted invoice #${num}`
          : `${submitter} submitted an invoice`,
        body: amount ? `${amount} — pending your review` : 'Pending your review.',
      };
    }
    case 'sub_invoice_reviewed': {
      const num = (p.invoice_number as string) || '';
      const status = String(p.status || 'updated');
      return {
        title: num
          ? `Invoice #${num} ${status}`
          : `Invoice ${status}`,
        body: 'Sub has been notified by email.',
      };
    }
    case 'nearby_rfp_posted': {
      const rfpTitle = (p.title as string) || 'A new project';
      const city = (p.city as string) || '';
      const state = (p.state as string) || '';
      const loc = [city, state].filter(Boolean).join(', ');
      const minB = fmtMoney(p.budget_min);
      const maxB = fmtMoney(p.budget_max);
      const budgetLine = (minB || maxB) ? `${minB || '—'} – ${maxB || '—'}` : '';
      return {
        title: rfpTitle,
        body: [loc, budgetLine].filter(Boolean).join(' · ') || 'New nearby project posted.',
      };
    }
    case 'rfp_awarded': {
      const winnerProject = (p.project_name as string) || 'a project';
      const value = fmtMoney(p.contract_value);
      return {
        title: `You won the bid for ${winnerProject}`,
        body: value ? `${value} contract value` : `Open the project to see drawings and start the kickoff.`,
      };
    }
    case 'bid_question_asked': {
      const asker = (p.asker_name as string) || 'A bidder';
      const q = String(p.question || '').slice(0, 140);
      return {
        title: `${asker} asked a question on your RFP`,
        body: q ? `"${q}"` : 'Tap to answer — every bidder will see it.',
      };
    }
    case 'bid_question_answered': {
      const rfpTitle = (p.rfp_title as string) || 'an RFP you bid on';
      return {
        title: `Answer posted on ${rfpTitle}`,
        body: 'Re-read the scope and update your bid before the deadline.',
      };
    }
    default:
      // Unknown / new event type — fall back to a humanized version of
      // the event_type so the user never sees "selection_chosen" raw.
      return {
        title: item.eventType
          .replace(/_/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase()),
        body: '',
      };
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
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={26} color={"#FF6A1A"} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Notifications</Text>
          {feed.unreadCount > 0 && (
            <Text style={styles.subtitle}>{feed.unreadCount} unread</Text>
          )}
        </View>
        {feed.items.length > 0 && (
          <TouchableOpacity style={styles.headerAction} onPress={feed.markAllRead}>
            <CheckCheck size={16} color={themeColors.text} strokeWidth={1.75} />
            <Text style={styles.headerActionText}>Mark all read</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.headerIconBtn}
          onPress={() => router.push('/notifications-settings' as never)}
          hitSlop={6} accessibilityRole="button" accessibilityLabel="Settings">
          <Settings size={18} color={"#9AA3AD"} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={feed.items}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32, paddingHorizontal: 16, paddingTop: 8 }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Bell size={40} color={"#9AA3AD"} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
            <Text style={styles.emptyBody}>
              When clients send messages, propose budgets, approve change orders, or subs submit invoices, you&apos;ll see the history here.
            </Text>
          </View>
        }
        ListFooterComponent={
          feed.items.length > 0 ? (
            <TouchableOpacity style={styles.clearAll} onPress={handleClearAll}>
              <Trash2 size={14} color={"#C84038"} strokeWidth={1.75} />
              <Text style={styles.clearAllText}>Clear all</Text>
            </TouchableOpacity>
          ) : null
        }
        renderItem={({ item }) => {
          const meta = EVENT_META[item.eventType] ?? { icon: <Bell size={16} color={themeColors.text} strokeWidth={1.75} />, tint: themeColors.bg, label: item.eventType };
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
                hitSlop={6} accessibilityRole="button" accessibilityLabel="Close">
                <X size={14} color={"#9AA3AD"} strokeWidth={1.75} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  title: { fontSize: Type.title2.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4 },
  subtitle: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '700', marginTop: 2 },
  headerAction: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: t.line,
  },
  headerActionText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  headerIconBtn: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: Colors.card,
    borderWidth: 1, borderColor: t.line,
    alignItems: 'center', justifyContent: 'center',
  },

  row: {
    flexDirection: 'row', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, marginVertical: 4,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line,
  },
  rowUnread: { borderColor: t.accent + '40', backgroundColor: '#FFF7EE' },
  iconWrap: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', position: 'relative',
  },
  unreadDot: {
    position: 'absolute', top: 0, right: 0,
    width: 9, height: 9, borderRadius: 5,
    backgroundColor: t.accent,
    borderWidth: 2, borderColor: Colors.card,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  rowEyebrow: { fontSize: 10, fontWeight: '700', color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.6 },
  rowTime: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' },
  rowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  rowBody: { fontSize: Type.footnote.fontSize, color: t.text, marginTop: 3, lineHeight: 18 },
  dismissBtn: {
    width: 28, height: 28, borderRadius: Tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'flex-start',
  },

  empty: {
    alignItems: 'center', padding: 40, marginTop: 40,
    gap: 10,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text, marginTop: 4 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19, maxWidth: 280 },

  clearAll: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
    paddingVertical: 16, marginTop: 6,
  },
  clearAllText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.danger },
});
