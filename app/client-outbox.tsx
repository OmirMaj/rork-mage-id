import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft, Send, FileText, DollarSign, Camera,
  Image as ImageIcon, ListChecks, ClipboardList,
} from 'lucide-react-native';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { Tokens } from '@/constants/designTokens';
import { Type } from '@/constants/typography';
import { useProjects } from '@/contexts/ProjectContext';
import type { PortalState, SendableItemKind } from '@/types';
import { showAlert } from '@/utils/alert';

type OutboxRow = {
  kind: SendableItemKind;
  itemId: string;
  title: string;
  subtitle: string;
  isUnsentEdit: boolean;
};

export default function ClientOutboxScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId } = useLocalSearchParams<{ projectId: string }>();

  const {
    getProject,
    batchSendToClientPortal,
    changeOrders,
    invoices,
    aiaPayApps,
    rfis,
    submittals,
    dailyReports,
    projectPhotos,
    warranties,
  } = useProjects();

  const [busy, setBusy] = useState(false);

  const project = projectId ? getProject(projectId) : null;

  const { drafts, unsent } = useMemo(() => {
    const out = { drafts: [] as OutboxRow[], unsent: [] as OutboxRow[] };

    function addItems<T extends { id: string; projectId: string; portalState?: PortalState }>(
      list: T[],
      kind: SendableItemKind,
      build: (i: T) => { title: string; subtitle: string },
      getUpdatedAt: (i: T) => string | undefined = () => undefined,
    ) {
      for (const i of list) {
        if (i.projectId !== projectId) continue;
        const ps = i.portalState;
        const { title, subtitle } = build(i);
        if (ps?.status === 'draft' || ps?.status === 'recalled') {
          out.drafts.push({ kind, itemId: i.id, title, subtitle, isUnsentEdit: false });
        } else if (ps?.status === 'sent' && ps.sentAt) {
          const updatedAt = getUpdatedAt(i);
          if (updatedAt && new Date(updatedAt).getTime() > new Date(ps.sentAt).getTime()) {
            out.unsent.push({ kind, itemId: i.id, title, subtitle, isUnsentEdit: true });
          }
        }
      }
    }

    addItems(
      changeOrders,
      'change_order',
      co => ({
        title: `Change Order #${co.number ?? '—'}`,
        subtitle: co.description || (typeof co.changeAmount === 'number' ? `${co.changeAmount >= 0 ? '+' : ''}$${co.changeAmount}` : ''),
      }),
      co => (co as { updatedAt?: string }).updatedAt,
    );

    addItems(
      invoices,
      'invoice',
      inv => ({
        title: `Invoice #${(inv as { number?: number }).number ?? '—'}`,
        subtitle: typeof (inv as { totalDue?: number }).totalDue === 'number'
          ? `$${(inv as { totalDue: number }).totalDue}`
          : '',
      }),
      inv => (inv as { updatedAt?: string }).updatedAt,
    );

    addItems(
      aiaPayApps,
      'aia_pay_app',
      ap => ({ title: `AIA Pay App #${ap.applicationNumber ?? '—'}`, subtitle: '' }),
      ap => ap.savedAt,
    );

    addItems(
      rfis,
      'rfi',
      rfi => ({
        title: `RFI #${(rfi as { number?: number }).number ?? '—'}`,
        subtitle: ((rfi as { question?: string }).question ?? '').slice(0, 80),
      }),
      rfi => (rfi as { updatedAt?: string }).updatedAt,
    );

    addItems(
      submittals,
      'submittal',
      sb => ({
        title: `Submittal${(sb as { number?: number }).number != null ? ' #' + (sb as { number: number }).number : ''}`,
        subtitle: ((sb as { title?: string }).title ?? '').slice(0, 80),
      }),
      sb => (sb as { updatedAt?: string }).updatedAt,
    );

    addItems(
      dailyReports,
      'daily_report',
      d => ({
        title: `Daily Report${d.date ? ' · ' + d.date : ''}`,
        subtitle: '',
      }),
      d => d.updatedAt,
    );

    addItems(
      projectPhotos,
      'photo',
      p => ({
        title: 'Photo',
        subtitle: p.location || p.tag || (p.timestamp ? new Date(p.timestamp).toLocaleDateString() : ''),
      }),
      p => (p as { timestamp?: string }).timestamp,
    );

    addItems(
      warranties,
      'warranty',
      w => ({
        title: (w as { title?: string }).title ?? 'Warranty',
        subtitle: '',
      }),
      w => (w as { updatedAt?: string }).updatedAt,
    );

    return out;
  }, [projectId, changeOrders, invoices, aiaPayApps, rfis, submittals, dailyReports, projectPhotos, warranties]);

  const onSendAll = useCallback(async () => {
    if (busy || !drafts.length || !projectId) return;
    setBusy(true);
    try {
      const { sent } = await batchSendToClientPortal({
        items: drafts.map(d => ({ kind: d.kind, itemId: d.itemId })),
        projectId,
      });
      showAlert('Sent', `${sent} item${sent === 1 ? '' : 's'} sent to your client.`);
    } catch (e) {
      showAlert('Send failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, drafts, projectId, batchSendToClientPortal]);

  const routeForKind = (k: SendableItemKind, id: string, pid: string): string => {
    switch (k) {
      case 'change_order': return `/change-order?id=${id}&projectId=${pid}`;
      case 'invoice':      return `/invoice?id=${id}&projectId=${pid}`;
      case 'aia_pay_app':  return `/aia-pay-app?id=${id}&projectId=${pid}`;
      case 'rfi':          return `/rfi?id=${id}&projectId=${pid}`;
      case 'submittal':    return `/submittal?id=${id}&projectId=${pid}`;
      case 'daily_report': return `/daily-report?id=${id}&projectId=${pid}`;
      case 'photo':        return `/project-detail?id=${pid}&tile=photos`;
      case 'selection':    return `/selections?projectId=${pid}`;
      case 'warranty':     return `/warranties?id=${id}&projectId=${pid}`;
    }
  };

  const iconForKind = (k: SendableItemKind) => {
    switch (k) {
      case 'change_order': return FileText;
      case 'invoice':      return DollarSign;
      case 'aia_pay_app':  return DollarSign;
      case 'rfi':          return ClipboardList;
      case 'submittal':    return ClipboardList;
      case 'daily_report': return ClipboardList;
      case 'photo':        return Camera;
      case 'selection':    return ImageIcon;
      case 'warranty':     return ListChecks;
    }
  };

  const projectName = project?.name;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          accessibilityLabel="Back"
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title} numberOfLines={1}>Client Outbox</Text>
          {projectName ? <Text style={styles.projectName} numberOfLines={1}>{projectName}</Text> : null}
        </View>
        <View style={{ width: 34 }} />
      </View>

      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        <Text style={styles.sectionLabel}>{`DRAFTS · ${drafts.length}`}</Text>
        {drafts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing in your Outbox</Text>
            <Text style={styles.emptySub}>
              {"New Change Orders, Invoices, RFIs, and Submittals start as Drafts. Drafts you haven't sent appear here."}
            </Text>
          </View>
        ) : (
          <>
            {drafts.map(d => {
              const Icon = iconForKind(d.kind);
              return (
                <TouchableOpacity
                  key={`${d.kind}-${d.itemId}`}
                  onPress={() => projectId && router.push(routeForKind(d.kind, d.itemId, projectId) as never)}
                  style={styles.itemRow}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconWrap, { backgroundColor: colors.accent + '22' }]}>
                    <Icon size={16} color={colors.accent} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{d.title}</Text>
                    {d.subtitle ? (
                      <Text style={styles.itemSub} numberOfLines={1}>{d.subtitle}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.statusInline, { color: colors.accent }]}>Draft</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity
              style={[styles.primary, busy && { opacity: 0.5 }]}
              onPress={onSendAll}
              disabled={busy}
              testID="outbox-send-all"
            >
              <Send size={16} color="#FFFFFF" strokeWidth={1.75} />
              <Text style={styles.primaryText}>
                {busy ? 'Sending…' : `Send all ${drafts.length} to client`}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {unsent.length > 0 ? (
          <>
            <Text style={[styles.sectionLabel, { marginTop: 24 }]}>
              {`UNSENT EDITS · ${unsent.length}`}
            </Text>
            {unsent.map(d => {
              const Icon = iconForKind(d.kind);
              return (
                <TouchableOpacity
                  key={`u-${d.kind}-${d.itemId}`}
                  onPress={() => projectId && router.push(routeForKind(d.kind, d.itemId, projectId) as never)}
                  style={styles.itemRow}
                  activeOpacity={0.7}
                >
                  <View style={[styles.iconWrap, { backgroundColor: '#F59E0B22' }]}>
                    <Icon size={16} color="#D97706" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{d.title}</Text>
                    {d.subtitle ? (
                      <Text style={styles.itemSub} numberOfLines={1}>{d.subtitle}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.statusInline, { color: '#D97706' }]}>Edited</Text>
                </TouchableOpacity>
              );
            })}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.bg,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  backBtn: {
    width: 34,
    height: 34,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: 17,
    backgroundColor: t.surfaceAlt,
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center' as const,
    paddingHorizontal: 8,
  },
  title: {
    ...Type.serifHeadline,
    color: t.text,
  },
  projectName: {
    fontSize: 12,
    color: t.textMuted,
    marginTop: 1,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: t.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
    marginBottom: 10,
  },
  emptyCard: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 20,
    alignItems: 'center' as const,
    gap: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: t.text,
  },
  emptySub: {
    fontSize: 13,
    color: t.textMuted,
    textAlign: 'center' as const,
    lineHeight: 19,
  },
  itemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    marginBottom: 8,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  itemTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: t.text,
  },
  itemSub: {
    fontSize: 13,
    color: t.textMuted,
    marginTop: 1,
  },
  statusInline: {
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5,
  },
  primary: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    marginTop: 12,
    paddingVertical: 13,
    borderRadius: Tokens.radius.md,
    backgroundColor: t.accentFill,
  },
  primaryText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800' as const,
  },
});
