import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useRouter, Stack, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import {
  ChevronLeft, Bell, MessageSquare, HandCoins, CheckCircle2, Inbox,
  Trash2, X, CheckCheck, Settings,
  PenTool, ShoppingCart, Hammer, HelpCircle, Trophy, Package, Sunrise, CalendarCheck, UserPlus,
  Banknote, AlertTriangle, FileText, ListChecks, ShieldAlert, Gavel, ClipboardCheck,
} from 'lucide-react-native';
import { WAIVER_LABELS } from '@/utils/lienWaiverEngine';
import { formatCalendarDay, calendarDayOf } from '@/utils/calendarDate';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useNotificationFeed, type NotificationFeedItem } from '@/hooks/useNotificationFeed';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { useNotifications } from '@/contexts/NotificationContext';
import { useProjectActions } from '@/contexts/ProjectContext';
import { useQueryClient } from '@tanstack/react-query';
// #82 · the one "this notice makes that list stale" table, shared with the
// push tap / received listeners and the outbox realtime callback.
import { refreshThenOpen, fieldReportNoticeBody } from '@/utils/notificationTapRefresh';
// The one event -> screen table, shared with the push-tap handler and the
// notify edge function's email buttons (audit round 2, #12).
import { notificationRoute, routeHref } from '@/supabase/functions/notify/routes';

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
  // Wave 5 (CONTRACT 8): sub-side trigger events — a bid through an invite
  // link, a signed lien waiver, a submitted prequalification packet.
  bid_invite_received:   { icon: <Gavel       size={16} color="#AF52DE" strokeWidth={1.75} />, tint: '#F4ECFA', label: 'Bid received' },
  lien_waiver_signed:    { icon: <PenTool     size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Waiver signed' },
  prequal_submitted:     { icon: <ClipboardCheck size={16} color="#AF52DE" strokeWidth={1.75} />, tint: '#F4ECFA', label: 'Prequal packet' },

  // Money in (#48) — a client paying through Stripe, or a bank payment bouncing.
  client_invoice_paid:   { icon: <Banknote    size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Client paid' },
  client_payment_failed: { icon: <AlertTriangle size={16} color={Colors.orange} strokeWidth={1.75} />, tint: '#FFF1E6', label: 'Payment failed' },

  // Field / design team → GC
  field_report_filed:    { icon: <FileText    size={16} color={"#1565C0"} strokeWidth={1.75} />, tint: '#E7F0FA', label: 'Daily report' },
  pro_response_received: { icon: <HelpCircle  size={16} color={"#1565C0"} strokeWidth={1.75} />, tint: '#E7F0FA', label: 'Design response' },
  punch_marked_ready:    { icon: <ListChecks  size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Punch ready' },
  safety_incident_filed: { icon: <ShieldAlert size={16} color={Colors.orange} strokeWidth={1.75} />, tint: '#FFF1E6', label: 'Incident report' },

  // Website → GC
  lead_received:         { icon: <UserPlus    size={16} color={Colors.successDark} strokeWidth={1.75} />, tint: Colors.successLight, label: 'Website lead' },

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

/** Exact money for a change order ("$4,812.50") — a CO is reconciled to the
 *  cent, unlike the compact "$45K" a budget headline can afford. */
function fmtMoneyExact(raw: unknown): string {
  const n = typeof raw === 'string' ? parseFloat(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n === 0) return '';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
      // notify writes co_number / co_amount / project_name into the stored
      // payload from the change_orders row (audit round 2, #13). co_number is
      // stringified there; accept a number too for rows written in between.
      const coNum = /^\d+$/.test(String(p.co_number ?? '')) ? String(p.co_number) : '';
      const amount = fmtMoneyExact(p.co_amount);
      // A decline carries the homeowner's reason — the one line that saves the
      // phone call. Before, the inbox dropped it and said "Synced…".
      const note = decision === 'declined' && typeof p.note === 'string' && p.note.trim()
        ? `"${p.note.trim().slice(0, 120)}"`
        : '';
      return {
        title: coNum
          ? `${signer} ${verb} CO #${coNum}`
          : `${signer} ${verb} a change order`,
        body: [note, amount ? `${amount} change` : '', projectName].filter(Boolean).join(' · '),
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
    // Wave 5 (CONTRACT 8). notify stores the facts it re-read from the source
    // row with the service role (nothing the anonymous sub typed is trusted
    // beyond a flattened name). Amounts exact to the cent.
    case 'bid_invite_received': {
      const clip = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
      const who = clip(p.vendor_name) || clip(p.sub_name) || 'A subcontractor';
      const pkg = clip(p.package_name) || 'your bid package';
      const amt = fmtMoneyExact(p.amount);
      return {
        title: amt ? `${who} bid ${amt}` : `${who} filed a bid`,
        body: [`On ${pkg}, through your invite link`, projectName].filter(Boolean).join(' · '),
      };
    }
    case 'lien_waiver_signed': {
      const clip = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
      const who = clip(p.sub_company) || clip(p.signer_name) || 'A subcontractor';
      const typeKey = typeof p.waiver_type === 'string' ? p.waiver_type : '';
      const type = (WAIVER_LABELS as Record<string, { short: string } | undefined>)[typeKey]?.short ?? '';
      const day = calendarDayOf(typeof p.through_date === 'string' ? p.through_date : null);
      const amt = fmtMoneyExact(p.paid_amount);
      return {
        title: `${who} signed their ${type ? `${type.toLowerCase()} ` : ''}lien waiver`,
        body: [
          amt ? `${amt}` : '',
          day ? `through ${formatCalendarDay(day, { month: 'short', day: 'numeric', year: 'numeric' })}` : '',
          projectName,
        ].filter(Boolean).join(' · '),
      };
    }
    case 'prequal_submitted': {
      const who = (typeof p.sub_name === 'string' && p.sub_name.trim()) ? p.sub_name.trim().slice(0, 80) : 'A subcontractor';
      return { title: `${who} submitted their prequalification packet`, body: 'Review it before you award them work.' };
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
    case 'lead_received': {
      const who = (p.name as string) || 'A homeowner';
      const kind = (p.project_type as string) || 'a project';
      const phone = (p.phone as string) || '';
      return {
        title: `${who} asked for a price`,
        body: [kind, phone].filter(Boolean).join(' · '),
      };
    }
    case 'client_invoice_paid': {
      // Exact to the cent: he reconciles this against his bank.
      const num = /^\d+$/.test(String(p.number ?? '')) ? `#${p.number}` : '';
      const paid = fmtMoneyExact(p.amount_paid);
      const bal = fmtMoneyExact(p.balance);
      return {
        title: `Client paid ${paid || 'an invoice'}${num ? ` on Invoice ${num}` : ''}`,
        body: [p.paid_in_full === true ? 'Paid in full' : bal ? `${bal} still due` : '', projectName].filter(Boolean).join(' · '),
      };
    }
    case 'client_payment_failed': {
      const num = /^\d+$/.test(String(p.number ?? '')) ? `#${p.number}` : '';
      const amt = fmtMoneyExact(p.amount);
      return {
        title: `${amt ? `A ${amt} payment` : 'A payment'} failed${num ? ` on Invoice ${num}` : ''}`,
        body: `Nothing was credited — the invoice is still open. ${projectName}`,
      };
    }
    case 'field_report_filed': {
      // #133 (CONTRACT 10): the payload carries the report's portal_status.
      // A report already on the portal must not be described as waiting for
      // review — that told the GC nothing had reached the homeowner when it had.
      const who = (p.author_name as string) || 'Your field team';
      return { title: `${who} filed a daily report`, body: `${projectName} · ${fieldReportNoticeBody(p)}` };
    }
    case 'pro_response_received': {
      const kind = p.kind === 'submittal' ? 'Submittal' : 'RFI';
      const num = /^\d+$/.test(String(p.number ?? '')) ? ` #${p.number}` : '';
      const who = (p.responder_name as string) || 'The design team';
      const code = typeof p.action_code === 'string' && p.action_code.trim() ? ` — ${p.action_code.trim()}` : '';
      return { title: `${who} responded to ${kind}${num}`, body: `${projectName}${code}` };
    }
    case 'punch_marked_ready': {
      // Wave 4 (#51): the trigger now names the item — what, where, and the
      // sub's own note — so the row says which item without opening it.
      // location is null when no room was given (never 'Unspecified').
      const who = (p.sub_name as string) || 'A subcontractor';
      const what = typeof p.description === 'string' && p.description.trim() ? p.description.trim() : '';
      const where = typeof p.location === 'string' && p.location.trim() ? p.location.trim() : '';
      const note = typeof p.sub_note === 'string' && p.sub_note.trim() ? `"${p.sub_note.trim()}"` : '';
      return {
        title: `${who} marked ${what ? `"${what.slice(0, 80)}"` : 'a punch item'} ready`,
        body: [where, projectName, note.slice(0, 160)].filter(Boolean).join(' · '),
      };
    }
    case 'safety_incident_filed': {
      // Nothing about how bad it was or anything clinical — the row sits on a lock
      // screen and in a shared inbox; the case itself is behind its screen.
      const who = (p.author_name as string) || 'Someone on your team';
      return { title: `${who} filed an incident report`, body: projectName };
    }
    case 'morning_brief':
    case 'week_close':
      // morning-digest writes its own title/body into the payload; the row was
      // blank because this switch never read them.
      return {
        title: (typeof p.title === 'string' && p.title.trim()) || EVENT_META[item.eventType].label,
        body: typeof p.body === 'string' ? p.body.slice(0, 160) : '',
      };
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

/** Where a row opens — the shared table (supabase/functions/notify/routes.ts),
 *  so the inbox, the push tap and the email button for one event agree. */
function deepLinkFor(item: NotificationFeedItem): string | null {
  const route = notificationRoute(item.eventType, item.payload);
  return route ? routeHref(route) : null;
}

// Route-level recovery (audit 2026-09-07, "Worth doing" #8). summarize() runs
// over server-shaped payloads; one malformed row used to take out the bundle.
export { RouteErrorFallback as ErrorBoundary } from '@/components/ErrorBoundary';

export default function NotificationsInboxScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const feed = useNotificationFeed();
  // "Check again" re-runs a query that has already settled, so `feed.isLoading`
  // stays FALSE for the whole round trip (react-query 5: isLoading === isPending
  // && isFetching, and a settled query is not pending). If the inbox is still
  // empty afterwards, nothing on screen changes — the tap read as dead, which
  // is the one thing a "the read may have failed" affordance cannot afford to
  // look like (review fix, 2026-09-07). Track the refetch locally and say so.
  const [rechecking, setRechecking] = useState(false);
  const handleRecheck = useCallback(() => {
    if (rechecking) return;
    setRechecking(true);
    void feed.refetch().finally(() => setRechecking(false));
  }, [feed, rechecking]);

  // The app-icon badge follows the inbox: whenever the unread count here moves
  // (a tap, Mark all read, Clear all, a new row), re-read the server count —
  // the feed itself stops at 80 rows, the server count does not (#17).
  const { syncBadge } = useNotifications();
  useEffect(() => {
    if (feed.isLoading) return;
    void syncBadge();
  }, [feed.unreadCount, feed.isLoading, syncBadge]);

  // #82: the inbox routes on its own (deepLinkFor), not through the push
  // handler, so it re-reads what the notice makes stale itself — a "Client
  // paid" row opened an invoice still showing the full balance. The money
  // kinds go through the guarded refetchInvoicesNow, never a raw invalidate.
  const queryClient = useQueryClient();
  const { refetchInvoicesNow } = useProjectActions();
  // The row being opened while its money re-read runs (bounded, see
  // TAP_REFRESH_WAIT_MS) — so the wait reads as "checking", not a dead tap.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const handleTap = useCallback((item: NotificationFeedItem) => {
    if (!item.readAt) feed.markRead(item.id);
    setOpeningId(item.id);
    const link = deepLinkFor(item);
    // Every pathname in the table is checked against app/ by
    // scripts/validate-notification-routes.ts.
    void refreshThenOpen(item.eventType, item.payload, {
      invalidate: (queryKey) => queryClient.invalidateQueries({ queryKey }),
      refetchInvoicesNow,
    }, () => {
      setOpeningId(null);
      if (link) router.push(link as Href);
    });
  }, [feed, router, queryClient, refetchInvoicesNow]);

  const handleClearAll = useCallback(() => {
    showAlert(
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
          <Settings size={18} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>

      <FlatList
        {...fabScroll}
        data={feed.items}
        extraData={openingId}
        keyExtractor={i => i.id}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE, paddingHorizontal: 16, paddingTop: 8 }}
        ListEmptyComponent={
          // "You're all caught up" is an absolute claim, and it was being made
          // before the outbox read had returned — on every cold open, for as
          // long as the fetch took (audit 2026-09-07, the site batch 1 could
          // not reach). Say what is actually true while it is in flight.
          feed.isLoading ? (
            <View style={styles.empty} testID="notifications-loading">
              <ActivityIndicator size="small" color={themeColors.accent} />
              <Text style={styles.emptyTitle}>Checking your inbox…</Text>
            </View>
          ) : (
            <View style={styles.empty} testID="notifications-empty">
              <Bell size={40} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
              <Text style={styles.emptyBody}>
                When clients send messages, propose budgets, approve change orders, or subs submit invoices, you&apos;ll see the history here.
              </Text>
              {/* useNotificationFeed's queryFn catches its own fetch error and
                  returns [], so a dead session is indistinguishable from a
                  quiet inbox from out here. Until that hook surfaces the
                  failure, this is the honest affordance: a way to ask again. */}
              <TouchableOpacity
                onPress={handleRecheck}
                disabled={rechecking}
                style={styles.emptyAction}
                accessibilityRole="button"
                accessibilityState={{ disabled: rechecking, busy: rechecking }}
                accessibilityLabel={rechecking ? 'Checking' : 'Check again'}
                testID="notifications-recheck"
              >
                <Text style={styles.emptyActionText}>
                  {rechecking ? 'Checking…' : 'Check again'}
                </Text>
              </TouchableOpacity>
            </View>
          )
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
                  {openingId === item.id ? (
                    <Text style={styles.rowTime}>Checking for the latest…</Text>
                  ) : (
                    <Text style={styles.rowTime}>{fmtAgo(item.createdAt)}</Text>
                  )}
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
                <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
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
  // Unread highlight must be theme-aware: the hardcoded cream '#FFF7EE' left
  // light dark-theme text on a light card — unreadable. accentSoft is a soft
  // accent wash tuned for contrast in both themes.
  rowUnread: { borderColor: t.accent + '40', backgroundColor: t.accentSoft },
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
  emptyAction: { marginTop: 6, paddingVertical: 8, paddingHorizontal: 16 },
  // accentLabel, not accent: this is text, and #FF6A1A is 2.87:1.
  emptyActionText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accentLabel },

  clearAll: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6,
    paddingVertical: 16, marginTop: 6,
  },
  clearAllText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.danger },
});
