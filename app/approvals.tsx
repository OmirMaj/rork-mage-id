// approvals.tsx — cross-project "needs your decision" dock.
//
// Pre-fix: a PM running 6 active projects had to open each project,
// expand its tile grid, find the changeOrders / RFIs sections, and
// approve one at a time. SmartInbox surfaced what was waiting; it
// didn't approve in-place.
//
// This screen aggregates everything actionable across every project
// and lets the GC act inline:
//   - Change orders with status 'submitted' or 'under_review'
//     (approve / reject / open detail)
//   - RFIs awaiting GC response  (open detail)
//   - Bid packages with bids returned but no award  (open detail)
//
// We deliberately keep it list-only — clicking a row routes to the
// dedicated detail screen for the message + history. The win is the
// CROSS-PROJECT view + the one-tap approve/reject for COs.

import React, { useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2, XCircle, ChevronRight, MessageSquare, Gavel, FileText, AlertTriangle,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import type { COAuditEntry } from '@/types';
import EmptyState from '@/components/EmptyState';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface PendingItem {
  kind: 'change_order' | 'rfi' | 'bid_package';
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  subtitle: string;
  amount?: number;
  age?: string;  // "submitted 3 days ago"
  /** Most-recent timestamp for sort order. */
  timestamp: string;
}

function timeAgo(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    projects,
    changeOrders,
    rfis,
    bidPackages,
    bidPackageBids,
    updateChangeOrder,
  } = useProjects();

  const projectName = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const items = useMemo<PendingItem[]>(() => {
    const out: PendingItem[] = [];

    // 1. Change orders awaiting GC sign-off. ChangeOrder has no
    //    `submittedAt` field — submission events live in auditTrail
    //    when present; otherwise we fall back to createdAt for sort.
    for (const co of changeOrders) {
      if (co.status !== 'submitted' && co.status !== 'under_review' && co.status !== 'revised') continue;
      const submittedEntry = co.auditTrail?.find(e => e.action === 'submitted');
      const ts = submittedEntry?.timestamp ?? co.createdAt ?? new Date().toISOString();
      out.push({
        kind: 'change_order',
        id: co.id,
        projectId: co.projectId,
        projectName: projectName.get(co.projectId) ?? 'Unknown project',
        title: `CO #${co.number} — ${co.description ?? '(no description)'}`,
        subtitle: co.status === 'submitted' ? 'Submitted, needs review'
          : co.status === 'under_review' ? 'Under review'
          : 'Revised, re-review',
        amount: co.changeAmount ?? 0,
        age: timeAgo(ts),
        timestamp: ts,
      });
    }

    // 2. Open RFIs not yet answered. RFIs with `dateRequired` past now
    //    sort to the top via the timestamp logic.
    for (const r of rfis) {
      if (r.status === 'closed' || r.status === 'answered') continue;
      out.push({
        kind: 'rfi',
        id: r.id,
        projectId: r.projectId,
        projectName: projectName.get(r.projectId) ?? 'Unknown project',
        title: `RFI #${r.number} — ${r.subject ?? r.question ?? '(no subject)'}`,
        subtitle: `Open${r.dateRequired ? ` · need by ${new Date(r.dateRequired).toLocaleDateString()}` : ''}`,
        age: timeAgo(r.dateSubmitted ?? r.createdAt ?? new Date().toISOString()),
        timestamp: r.dateSubmitted ?? r.createdAt ?? new Date().toISOString(),
      });
    }

    // 3. Bid packages with bids returned but no award yet. The
    //    package only surfaces when at least one bid is 'received' or
    //    'qualified' — i.e. a real decision is on the table. Pure
    //    'open' packages with no bids in are still collecting.
    for (const pkg of bidPackages) {
      if (pkg.status === 'awarded') continue;
      const bids = bidPackageBids.filter(b => b.packageId === pkg.id);
      if (bids.length === 0) continue;
      const decidable = bids.filter(b => b.status === 'received' || b.status === 'qualified');
      if (decidable.length === 0) continue;
      out.push({
        kind: 'bid_package',
        id: pkg.id,
        projectId: pkg.projectId,
        projectName: projectName.get(pkg.projectId) ?? 'Unknown project',
        title: pkg.name,
        subtitle: `${decidable.length} bid${decidable.length === 1 ? '' : 's'} received · pick a winner`,
        timestamp: pkg.dueDate ?? pkg.createdAt ?? new Date().toISOString(),
      });
    }

    // Sort newest first.
    out.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    return out;
  }, [changeOrders, rfis, bidPackages, bidPackageBids, projectName]);

  // Append an entry to a CO's auditTrail without mutating the original.
  // Mirrors the pattern used in app/change-order.tsx — every state
  // transition lands in auditTrail so the project-detail screen and
  // the portal both render a consistent history.
  const appendAudit = useCallback((existing: COAuditEntry[] | undefined, action: string, detail?: string): COAuditEntry[] => {
    const entry: COAuditEntry = {
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      actor: 'GC',
      timestamp: new Date().toISOString(),
      detail,
    };
    return [...(existing ?? []), entry];
  }, []);

  const handleApproveCO = useCallback((co: PendingItem) => {
    if (co.kind !== 'change_order') return;
    const fullCo = changeOrders.find(c => c.id === co.id);
    Alert.alert(
      'Approve change order',
      `Approve ${co.title} for ${formatMoney(co.amount ?? 0)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Approve',
          onPress: () => {
            updateChangeOrder(co.id, {
              status: 'approved',
              auditTrail: appendAudit(fullCo?.auditTrail, 'approved', 'Approved from cross-project Approvals dock'),
            });
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          },
        },
      ],
    );
  }, [updateChangeOrder, changeOrders, appendAudit]);

  const handleRejectCO = useCallback((co: PendingItem) => {
    if (co.kind !== 'change_order') return;
    const fullCo = changeOrders.find(c => c.id === co.id);
    Alert.alert(
      'Reject change order',
      `Reject ${co.title}? You can add a rejection reason on the detail screen.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: () => {
            updateChangeOrder(co.id, {
              status: 'rejected',
              auditTrail: appendAudit(fullCo?.auditTrail, 'rejected', 'Rejected from cross-project Approvals dock'),
            });
            if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          },
        },
      ],
    );
  }, [updateChangeOrder, changeOrders, appendAudit]);

  const openDetail = useCallback((it: PendingItem) => {
    if (it.kind === 'change_order') {
      router.push({ pathname: '/change-order' as never, params: { id: it.id } as never });
    } else if (it.kind === 'rfi') {
      router.push({ pathname: '/rfi-detail' as never, params: { id: it.id } as never });
    } else if (it.kind === 'bid_package') {
      router.push({ pathname: '/buyout-package' as never, params: { id: it.id } as never });
    }
  }, [router]);

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ title: 'Approvals' }} />
        <EmptyState
          icon={<CheckCircle2 size={36} color={Colors.success} strokeWidth={1.6} />}
          title="Nothing waiting on you"
          message="All change orders are signed, RFIs are answered, and bid packages are awarded. New items will surface here when subs or owners send something for your decision."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Approvals', headerStyle: { backgroundColor: Colors.background }, headerTintColor: Colors.primary, headerTitleStyle: { fontWeight: '700' as const, color: Colors.text } }} />
      <ScrollView contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Text style={styles.headerTitle}>Needs your decision</Text>
          <Text style={styles.headerCount}>{items.length}</Text>
        </View>
        <Text style={styles.headerSub}>Across {new Set(items.map(i => i.projectId)).size} project{new Set(items.map(i => i.projectId)).size === 1 ? '' : 's'}</Text>

        {items.map(it => {
          const Icon = it.kind === 'change_order' ? FileText : it.kind === 'rfi' ? MessageSquare : Gavel;
          const tint = it.kind === 'change_order' ? Colors.error : it.kind === 'rfi' ? Colors.info : Colors.warning;
          return (
            <View key={`${it.kind}-${it.id}`} style={styles.card}>
              <TouchableOpacity onPress={() => openDetail(it)} style={styles.cardBody} activeOpacity={0.85}>
                <View style={[styles.cardIconWrap, { backgroundColor: tint + '15' }]}>
                  <Icon size={16} color={tint} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardProject} numberOfLines={1}>{it.projectName}</Text>
                  <Text style={styles.cardTitle} numberOfLines={2}>{it.title}</Text>
                  <Text style={styles.cardSub} numberOfLines={1}>
                    {it.subtitle}
                    {it.age ? ` · ${it.age}` : ''}
                    {it.amount != null && it.amount > 0 ? ` · ${formatMoney(it.amount)}` : ''}
                  </Text>
                </View>
                <ChevronRight size={16} color={Colors.textMuted} />
              </TouchableOpacity>
              {it.kind === 'change_order' && (
                <View style={styles.cardActions}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionApprove]}
                    onPress={() => handleApproveCO(it)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Approve change order"
                    testID={`approve-${it.id}`}
                  >
                    <CheckCircle2 size={14} color={Colors.success} />
                    <Text style={[styles.actionBtnText, { color: Colors.success }]}>Approve</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionReject]}
                    onPress={() => handleRejectCO(it)}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Reject change order"
                    testID={`reject-${it.id}`}
                  >
                    <XCircle size={14} color={Colors.error} />
                    <Text style={[styles.actionBtnText, { color: Colors.error }]}>Reject</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.footer}>
          <AlertTriangle size={12} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Approving here is the same as approving from the project detail screen — the same audit trail is recorded. Use the row tap to open the full detail when you need to add notes.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  headerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, marginTop: 6 },
  headerTitle: { fontSize: Type.title2.fontSize, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.4 },
  headerCount: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: Colors.primary },
  headerSub: { paddingHorizontal: 16, fontSize: Type.footnote.fontSize, color: Colors.textMuted, marginBottom: 12 },

  card: { backgroundColor: Colors.surface, borderRadius: Tokens.radius.lg, marginHorizontal: 16, marginBottom: 10, borderWidth: 1, borderColor: Colors.borderLight, overflow: 'hidden' as const },
  cardBody: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 12 },
  cardIconWrap: { width: 32, height: 32, borderRadius: Tokens.radius.sm, alignItems: 'center' as const, justifyContent: 'center' as const },
  cardProject: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: Colors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  cardTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: Colors.text, marginTop: 2 },
  cardSub: { fontSize: Type.caption1.fontSize, color: Colors.textSecondary, marginTop: 2 },

  cardActions: { flexDirection: 'row' as const, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  actionBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6, paddingVertical: 12 },
  actionApprove: { borderRightWidth: 1, borderRightColor: Colors.borderLight },
  actionReject: {},
  actionBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },

  footer: { flexDirection: 'row' as const, gap: 8, alignItems: 'flex-start' as const, paddingHorizontal: 18, paddingVertical: 16, opacity: 0.7 },
  footerText: { flex: 1, fontSize: Type.caption2.fontSize, color: Colors.textMuted, lineHeight: 14 },
});
