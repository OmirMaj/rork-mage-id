import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import { useRouter, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { ChevronLeft, ChevronRight, HardHat, Inbox, Lock, Building2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubSubmittedInvoices } from '@/hooks/useSubSubmittedInvoices';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface PairRow {
  key: string;
  projectId: string;
  projectName: string;
  subId: string;
  subName: string;
  trade: string;
  totalCommitment: number;
}

export default function SubPortalsListScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const { canAccess } = useTierAccess();
  // Sub portals are a Business feature. We keep this list visible as a teaser
  // (rather than hard-gating the whole screen) but every locked row routes to
  // the paywall instead of the setup screen — so the gate is expected, not a
  // bait-and-switch dead-end. Live invoice-count badges are hidden for locked
  // tiers since they can't open a portal to act on them.
  const isUnlocked = canAccess('subcontractor_management');
  const [paywallOpen, setPaywallOpen] = useState(false);
  const {
    projects, subcontractors, commitments,
  } = useProjects();

  // Build a list of (project, sub) pairs that have at least one commitment.
  const pairs = useMemo<PairRow[]>(() => {
    const map = new Map<string, PairRow>();
    for (const c of commitments) {
      if (!c.subcontractorId) continue;
      const project = projects.find(p => p.id === c.projectId);
      const sub = subcontractors.find(s => s.id === c.subcontractorId);
      if (!project || !sub) continue;
      const key = `${project.id}::${sub.id}`;
      const existing = map.get(key);
      const value = c.amount + (c.changeAmount ?? 0);
      if (existing) {
        existing.totalCommitment += value;
      } else {
        map.set(key, {
          key,
          projectId: project.id,
          projectName: project.name,
          subId: sub.id,
          subName: sub.companyName,
          trade: sub.trade,
          totalCommitment: value,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalCommitment - a.totalCommitment);
  }, [projects, subcontractors, commitments]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen
        options={{
          title: 'Sub Portals',
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 4 }} accessibilityRole="button" accessibilityLabel="Back">
              <ChevronLeft size={24} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          ),
        }}
      />
      <View style={styles.headerWrap}>
        <Text style={styles.title}>Sub portals</Text>
        <Text style={styles.subtitle}>
          One self-serve link per sub per project — they review scope, submit invoices, and track payment without asking you for updates.
        </Text>
      </View>

      {!isUnlocked && (
        <TouchableOpacity
          style={styles.upgradeBanner}
          onPress={() => setPaywallOpen(true)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Upgrade to Business to unlock sub portals"
        >
          <View style={styles.upgradeBannerIcon}>
            <Building2 size={18} color={themeColors.accent} strokeWidth={1.75} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.upgradeBannerTitle}>Sub portals are a Business feature</Text>
            <Text style={styles.upgradeBannerBody}>Upgrade to send self-serve links and collect invoices from your subs.</Text>
          </View>
          <ChevronRight size={18} color={themeColors.accent} strokeWidth={1.75} />
        </TouchableOpacity>
      )}

      <FlatList
        {...fabScroll}
        data={pairs}
        keyExtractor={p => p.key}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Inbox size={32} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No commitments yet</Text>
            <Text style={styles.emptyBody}>Add a sub commitment to a project — that&apos;s the link between a sub and a project, and what powers their portal.</Text>
          </View>
        }
        renderItem={({ item }) => <PairRowItem item={item} locked={!isUnlocked} onPress={() =>
          isUnlocked
            ? router.push({ pathname: '/sub-portal-setup', params: { projectId: item.projectId, subId: item.subId } } as never)
            : setPaywallOpen(true)
        } />}
      />

      <Paywall
        visible={paywallOpen}
        feature="Subcontractor Portals"
        requiredTier="business"
        onClose={() => setPaywallOpen(false)}
      />
    </View>
  );
}

function PairRowItem({ item, locked, onPress }: { item: PairRow; locked: boolean; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const submitted = useSubSubmittedInvoices({ projectId: item.projectId });
  const pendingForThisSub = useMemo(() =>
    submitted.pending.filter(i => i.subcontractorId === item.subId),
    [submitted.pending, item.subId]);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowIcon}>
        <HardHat size={20} color={themeColors.accent} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.subName}</Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {item.trade} · {item.projectName}
        </Text>
        <View style={styles.rowFoot}>
          <Text style={styles.rowAmount}>{formatMoney(item.totalCommitment)}</Text>
          {locked ? (
            // Show the gate on the row itself so tapping into a paywall is
            // expected. Hide the live invoice-count badge — a locked tier
            // can't open the portal to act on it.
            <View style={styles.lockBadge}>
              <Lock size={11} color={themeColors.textSecondary} strokeWidth={2} />
              <Text style={styles.lockBadgeText}>Business</Text>
            </View>
          ) : pendingForThisSub.length > 0 ? (
            <View style={styles.pendingBadge}>
              <Text style={styles.pendingBadgeText}>{pendingForThisSub.length} new invoice{pendingForThisSub.length === 1 ? '' : 's'}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <ChevronRight size={18} color={themeColors.textMuted} strokeWidth={1.75} />
    </TouchableOpacity>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  headerWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 18 },
  title: { fontSize: Type.title1.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.5 },
  subtitle: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, marginTop: 6, lineHeight: 20 },

  empty: {
    alignItems: 'center', padding: 36, marginTop: 32,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line, borderStyle: 'dashed',
    gap: 8,
  },
  emptyTitle: { fontSize: Type.callout.fontSize, fontWeight: '700', color: t.text },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 18 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 14, marginBottom: 10,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg,
    borderWidth: 1, borderColor: t.line,
  },
  rowIcon: {
    width: 42, height: 42, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '15',
    alignItems: 'center', justifyContent: 'center',
  },
  rowTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  rowMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  rowAmount: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  pendingBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: t.accent + '18',
  },
  pendingBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent },
  lockBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
  },
  lockBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary },

  upgradeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    marginHorizontal: 16, marginBottom: 14, padding: 14,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.accent + '10',
    borderWidth: 1, borderColor: t.accent + '25',
  },
  upgradeBannerIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.card,
    backgroundColor: t.accent + '18',
    alignItems: 'center', justifyContent: 'center',
  },
  upgradeBannerTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  upgradeBannerBody: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2, lineHeight: 16 },
});
