// handover — the macro closeout flow. A single screen the GC walks
// through with the homeowner on handover day. Every box that needs to
// be ticked before keys change hands lives here, with status computed
// live from existing project data:
//
//  - Selections: every category has a chosen option
//  - Punch list: zero open items
//  - Warranties: at least one on file
//  - Closeout binder: status === 'sent'
//  - Final invoice: an invoice marked status='paid' or 'sent' for the
//    final draw (we look for the highest-numbered invoice).
//  - Lien waivers: at least one signed waiver per active commitment
//  - Final walk-through: a manually-checked completion item
//
// We deliberately don't auto-mark anything as "done." This is a
// signed-off ceremony, not a status board — the GC explicitly confirms
// each item, and the screen surfaces what's blocking before it
// becomes embarrassing on handover day.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, CheckCircle2, Circle, AlertCircle, ChevronRight,
  ShoppingCart, CheckSquare, ShieldCheck, BookOpen, Receipt,
  ScrollText, Footprints, Send, Sparkles,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { fetchCloseoutBinder } from '@/utils/closeoutBinderEngine';
import { fetchLienWaiversForProject } from '@/utils/lienWaiverEngine';
import { Platform } from 'react-native';

interface HandoverItem {
  key: string;
  label: string;
  detail: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  status: 'done' | 'partial' | 'open';
  /** Optional CTA route if not done — taps on the item route to that screen. */
  cta?: string;
  ctaParams?: Record<string, string>;
  ctaLabel?: string;
  /** Manually-checked item? */
  manual?: boolean;
}

const HANDOVER_MANUAL_KEYS = ['walkthrough', 'keys'] as const;
type ManualKey = typeof HANDOVER_MANUAL_KEYS[number];

export default function HandoverScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const ctx = useProjects() as any;
  const project = projectId ? ctx.getProject(projectId) : undefined;

  const projectInvoices = useMemo(
    () => projectId ? ctx.getInvoicesForProject(projectId) : [],
    [projectId, ctx],
  );
  const projectPunch = useMemo(
    () => projectId ? ctx.getPunchItemsForProject(projectId) : [],
    [projectId, ctx],
  );
  const projectWarranties = useMemo(
    () => projectId ? ctx.getWarrantiesForProject(projectId) : [],
    [projectId, ctx],
  );
  const projectCommitments = useMemo(
    () => projectId ? ctx.getCommitmentsForProject(projectId) : [],
    [projectId, ctx],
  );

  const [selectionsCats, setSelectionsCats] = useState<any[]>([]);
  const [binder, setBinder] = useState<any>(null);
  const [waivers, setWaivers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Manual checkboxes — saved on the project itself so the state
  // survives re-opens. The shape is { [manualKey]: ISO timestamp }.
  const manualChecks = useMemo<Record<string, string>>(
    () => (project?.handoverChecklist as Record<string, string> | undefined) ?? {},
    [project],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) { setLoading(false); return; }
      const [sel, b, w] = await Promise.all([
        fetchSelectionsForProject(projectId),
        fetchCloseoutBinder(projectId),
        fetchLienWaiversForProject(projectId),
      ]);
      if (cancelled) return;
      setSelectionsCats(sel);
      setBinder(b);
      setWaivers(w);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [projectId]);

  const toggleManual = useCallback((key: ManualKey) => {
    if (!projectId) return;
    const next = { ...manualChecks };
    if (next[key]) delete next[key];
    else next[key] = new Date().toISOString();
    ctx.updateProject(projectId, { handoverChecklist: next });
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [projectId, manualChecks, ctx]);

  const items: HandoverItem[] = useMemo(() => {
    if (!project) return [];
    // Selections — every category has a chosen option.
    const totalCats = selectionsCats.length;
    const chosenCats = selectionsCats.filter(c => (c.options ?? []).some((o: any) => o.isChosen)).length;
    const selStatus: HandoverItem['status'] =
      totalCats === 0 ? 'open'
      : chosenCats === totalCats ? 'done'
      : 'partial';

    // Punch list — zero open items.
    const openPunch = projectPunch.filter((p: any) => p.status !== 'completed' && p.status !== 'closed').length;
    const punchStatus: HandoverItem['status'] = openPunch === 0 && projectPunch.length > 0 ? 'done' : (openPunch > 0 ? 'partial' : 'open');

    // Warranties — at least one on file.
    const warrantyStatus: HandoverItem['status'] = projectWarranties.length > 0 ? 'done' : 'open';

    // Closeout binder — must be sent.
    const binderStatus: HandoverItem['status'] = binder?.status === 'sent' ? 'done' : binder?.status === 'finalized' ? 'partial' : 'open';

    // Final invoice — last invoice marked sent or paid.
    const sortedInvoices = [...projectInvoices].sort(
      (a: any, b: any) => Number(b.number ?? 0) - Number(a.number ?? 0),
    );
    const finalInv = sortedInvoices[0];
    const invoiceStatus: HandoverItem['status'] =
      !finalInv ? 'open'
      : finalInv.status === 'paid' ? 'done'
      : finalInv.status === 'sent' ? 'partial'
      : 'open';

    // Lien waivers — at least one signed waiver per active commitment.
    const activeCommitments = projectCommitments.filter((c: any) => c.status !== 'draft');
    const subsCovered = new Set(
      waivers
        .filter(w => w.status === 'signed' || w.status === 'received')
        .map(w => w.subCompanyId ?? w.subName)
        .filter(Boolean),
    );
    const allCovered = activeCommitments.length > 0
      && activeCommitments.every((c: any) => subsCovered.has(c.companyId) || subsCovered.has(c.vendorName));
    const waiverStatus: HandoverItem['status'] =
      activeCommitments.length === 0 ? 'open'
      : allCovered ? 'done'
      : (subsCovered.size > 0 ? 'partial' : 'open');

    return [
      {
        key: 'selections',
        label: 'Selections confirmed',
        detail: totalCats === 0
          ? 'No allowance categories yet. Add at least one before handover.'
          : selStatus === 'done'
            ? `All ${totalCats} categories have a chosen option`
            : `${chosenCats} of ${totalCats} categories picked`,
        icon: ShoppingCart,
        status: selStatus,
        cta: '/selections',
        ctaParams: { projectId: project.id },
        ctaLabel: selStatus === 'done' ? 'Review' : 'Open selections',
      },
      {
        key: 'punch',
        label: 'Punch list cleared',
        detail: projectPunch.length === 0
          ? 'No punch list yet. If the project is move-in-ready, mark it manually.'
          : openPunch === 0
            ? `All ${projectPunch.length} punch items closed`
            : `${openPunch} open · ${projectPunch.length - openPunch} closed`,
        icon: CheckSquare,
        status: punchStatus,
        cta: '/punch-list',
        ctaParams: { projectId: project.id },
        ctaLabel: punchStatus === 'done' ? 'Review' : 'Open punch list',
      },
      {
        key: 'warranties',
        label: 'Warranties on file',
        detail: projectWarranties.length === 0
          ? 'Add manufacturer + workmanship warranties so the homeowner has them.'
          : `${projectWarranties.length} warrant${projectWarranties.length === 1 ? 'y' : 'ies'} recorded`,
        icon: ShieldCheck,
        status: warrantyStatus,
        cta: '/warranties',
        ctaParams: { projectId: project.id },
        ctaLabel: warrantyStatus === 'done' ? 'Review' : 'Add warranties',
      },
      {
        key: 'binder',
        label: 'Closeout binder delivered',
        detail: !binder
          ? 'Compile and deliver the binder so the homeowner has finishes, warranties, and contacts in one place.'
          : binder.status === 'sent'
            ? `Delivered ${binder.sentAt ? new Date(binder.sentAt).toLocaleDateString() : ''}`
            : binder.status === 'finalized'
              ? 'Finalized — tap to deliver to homeowner'
              : 'Draft only — finalize and deliver',
        icon: BookOpen,
        status: binderStatus,
        cta: '/closeout-binder',
        ctaParams: { projectId: project.id },
        ctaLabel: binderStatus === 'done' ? 'Re-deliver' : 'Open binder',
      },
      {
        key: 'invoice',
        label: 'Final invoice paid',
        detail: !finalInv
          ? 'No invoices yet. Issue the final invoice for the remaining balance.'
          : finalInv.status === 'paid'
            ? `Invoice #${finalInv.number} paid in full`
            : finalInv.status === 'sent'
              ? `Invoice #${finalInv.number} sent — awaiting payment`
              : 'Most recent invoice is still draft',
        icon: Receipt,
        status: invoiceStatus,
        cta: '/invoice',
        ctaParams: ({
          projectId: project.id,
          ...(finalInv?.id ? { invoiceId: finalInv.id } : {}),
        }) as Record<string, string>,
        ctaLabel: invoiceStatus === 'done' ? 'Review' : 'Open invoice',
      },
      {
        key: 'waivers',
        label: 'Lien waivers collected',
        detail: activeCommitments.length === 0
          ? 'No subcontractor commitments on file. Add commitments to track lien waivers.'
          : allCovered
            ? `Signed waiver for every sub (${activeCommitments.length})`
            : `${subsCovered.size} of ${activeCommitments.length} subs have a signed waiver`,
        icon: ScrollText,
        status: waiverStatus,
        cta: '/lien-waivers',
        ctaParams: { projectId: project.id },
        ctaLabel: 'Open lien waivers',
      },
      {
        key: 'walkthrough',
        label: 'Final walk-through completed',
        detail: manualChecks['walkthrough']
          ? `Confirmed ${new Date(manualChecks['walkthrough']).toLocaleDateString()}`
          : 'Walk every room with the homeowner. Note any last items.',
        icon: Footprints,
        status: manualChecks['walkthrough'] ? 'done' : 'open',
        manual: true,
      },
      {
        key: 'keys',
        label: 'Keys & access transferred',
        detail: manualChecks['keys']
          ? `Confirmed ${new Date(manualChecks['keys']).toLocaleDateString()}`
          : 'Keys, garage remotes, alarm codes, smart-lock invites.',
        icon: Send,
        status: manualChecks['keys'] ? 'done' : 'open',
        manual: true,
      },
    ];
  }, [project, selectionsCats, projectPunch, projectWarranties, binder, projectInvoices, projectCommitments, waivers, manualChecks]);

  const doneCount = items.filter(i => i.status === 'done').length;
  const partialCount = items.filter(i => i.status === 'partial').length;
  const total = items.length;
  const allDone = doneCount === total && total > 0;

  if (!project) {
    return (
      <View style={[styles.container, styles.center, { paddingTop: insets.top + 24 }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.emptyTitle}>Project not found</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.emptyBack}>
          <Text style={styles.emptyBackText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <ChevronLeft size={26} color={Colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Handover Checklist</Text>
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.loadingText}>Computing your status…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40 }}>
          {/* Progress hero */}
          <View style={[styles.heroCard, allDone && styles.heroCardDone]}>
            <View style={styles.heroHead}>
              {allDone ? <Sparkles size={16} color={'#1E8E4A'} /> : <AlertCircle size={16} color={Colors.primary} />}
              <Text style={[styles.heroTitle, allDone && { color: '#1E8E4A' }]}>
                {allDone ? 'Ready to hand over' : `${doneCount} of ${total} done`}
              </Text>
            </View>
            <Text style={styles.heroBody}>
              {allDone
                ? 'Every box is ticked. Hand over the keys with confidence.'
                : partialCount > 0
                  ? `${partialCount} item${partialCount === 1 ? '' : 's'} in progress, ${total - doneCount - partialCount} not started.`
                  : `${total - doneCount} item${total - doneCount === 1 ? '' : 's'} still open.`}
            </Text>
            {/* Progress bar */}
            <View style={styles.progressTrack}>
              <View style={[
                styles.progressFill,
                {
                  width: `${Math.round((doneCount / Math.max(1, total)) * 100)}%`,
                  backgroundColor: allDone ? '#1E8E4A' : Colors.primary,
                },
              ]} />
            </View>
          </View>

          <Text style={styles.listLabel}>Closeout items</Text>

          {items.map(item => (
            <ChecklistRow
              key={item.key}
              item={item}
              onPressItem={() => {
                if (item.manual) {
                  toggleManual(item.key as ManualKey);
                  return;
                }
                if (!item.cta) return;
                router.push({ pathname: item.cta as any, params: item.ctaParams ?? {} });
              }}
            />
          ))}

          <Text style={styles.fineprint}>
            This checklist computes status from your project data. Items marked manually (walk-through, keys) save to the project so the timestamp survives re-opens.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function ChecklistRow({ item, onPressItem }: { item: HandoverItem; onPressItem: () => void }) {
  const Icon = item.icon;
  const Status = (() => {
    if (item.status === 'done') return { Comp: CheckCircle2, color: '#1E8E4A' };
    if (item.status === 'partial') return { Comp: AlertCircle, color: '#C26A00' };
    return { Comp: Circle, color: Colors.textMuted };
  })();
  const SC = Status.Comp;
  return (
    <TouchableOpacity
      style={[styles.row, item.status === 'done' && styles.rowDone]}
      onPress={onPressItem}
      activeOpacity={0.85}
    >
      <View style={[styles.rowIcon, { backgroundColor: Status.color + '15' }]}>
        <Icon size={18} color={Status.color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowHead}>
          <Text style={styles.rowLabel}>{item.label}</Text>
          <SC size={16} color={Status.color} />
        </View>
        <Text style={styles.rowDetail}>{item.detail}</Text>
        {item.ctaLabel && !item.manual && item.status !== 'done' && (
          <View style={styles.rowCta}>
            <Text style={styles.rowCtaText}>{item.ctaLabel}</Text>
            <ChevronRight size={13} color={Colors.primary} />
          </View>
        )}
        {item.manual && (
          <Text style={[styles.rowCta, styles.rowCtaManual]}>
            {item.status === 'done' ? 'Tap to mark not done' : 'Tap to mark done'}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: 13, color: Colors.textMuted },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  eyebrow: { fontSize: 11, fontWeight: '700', color: Colors.primary, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: 20, fontWeight: '800', color: Colors.text, letterSpacing: -0.4, marginTop: 4 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: Colors.text },
  emptyBack: { marginTop: 12, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, backgroundColor: Colors.primary },
  emptyBackText: { color: '#FFF', fontWeight: '800', fontSize: 13 },

  heroCard: {
    backgroundColor: Colors.primary + '0D', borderWidth: 1, borderColor: Colors.primary + '30',
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  heroCardDone: {
    backgroundColor: 'rgba(30,142,74,0.08)', borderColor: 'rgba(30,142,74,0.35)',
  },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  heroTitle: { fontSize: 14, fontWeight: '800', color: Colors.primary, letterSpacing: -0.2 },
  heroBody: { fontSize: 13, color: Colors.text, lineHeight: 18, marginBottom: 12 },
  progressTrack: { height: 6, backgroundColor: Colors.fillTertiary, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  listLabel: { fontSize: 11, fontWeight: '800', color: Colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },

  row: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, marginBottom: 8,
  },
  rowDone: { opacity: 0.85 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowLabel: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text, letterSpacing: -0.2 },
  rowDetail: { fontSize: 12, color: Colors.textMuted, lineHeight: 17, marginTop: 4 },
  rowCta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 },
  rowCtaText: { fontSize: 12, fontWeight: '800', color: Colors.primary },
  rowCtaManual: { color: Colors.textMuted, fontWeight: '700' },

  fineprint: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, marginTop: 14, fontStyle: 'italic' },
});
