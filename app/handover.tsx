// handover — the macro closeout flow. A single screen the GC walks
// through with the homeowner on handover day. Every box that needs to
// be ticked before keys change hands lives here, with status computed
// live from existing project data:
//
//  - Selections: every category has a chosen option
//  - Punch list: zero open items
//  - Warranties: at least one on file
//  - Closeout binder: status === 'sent'
//  - Final invoice: the highest-numbered invoice on the job — 'paid' is
//    done, 'draft' is not started, everything in between is in progress.
//  - Lien waivers: at least one signed waiver per active commitment
//  - Final walk-through and Keys & access: manually-checked items
//
// Eight items, six of them read straight off the job — MAGE ticks those
// itself, which is what the footer line on the screen tells the GC.
// (This comment used to claim "we deliberately don't auto-mark anything
// as done", which the six computed statuses and their green ticks have
// never matched.) What the screen does refuse is a vacuous tick: a job
// with no selection categories, no punch items, no commitments reads
// 'open', not 'done', so "Ready to hand over" cannot come from an empty
// project.
//
// The two manual items are the ceremony half — the GC confirms those
// standing next to the homeowner, and the date is saved on the project.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
 Platform } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, CheckCircle2, Circle, AlertCircle, ChevronRight,
  ShoppingCart, CheckSquare, ShieldCheck, BookOpen, Receipt,
  ScrollText, Footprints, Send,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import type { InvoiceStatus, Project } from '@/types';
import { fetchSelectionsForProject } from '@/utils/selectionsEngine';
import { fetchCloseoutBinder } from '@/utils/closeoutBinderEngine';
import { fetchLienWaiversForProject } from '@/utils/lienWaiverEngine';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

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

/**
 * The "Final invoice paid" row, from the highest-numbered invoice on the job.
 *
 * InvoiceStatus has FIVE members (types/index.ts:1520) and this ladder used to
 * handle two: 'overdue' and 'partially_paid' both fell into the else and the
 * row read "Most recent invoice is still draft". An overdue final invoice is
 * the single most likely state on handover day — it went out weeks ago and the
 * money has not landed — and the GC was being told it had never left his desk,
 * which is false and points him at the wrong action. Only 'paid' counts as
 * done, before and after, so "Ready to hand over" is unchanged.
 *
 * Exported pure because the smoke fixture seeds no invoices (both dumps render
 * "No invoices yet"), so four of these five branches cannot be reached by
 * mounting the screen.
 */
export function finalInvoiceState(
  inv: { number: number; status: InvoiceStatus } | undefined,
): { status: HandoverItem['status']; detail: string } {
  if (!inv) {
    return {
      status: 'open',
      detail: 'No invoices yet. Issue the final invoice for the remaining balance.',
    };
  }
  switch (inv.status) {
    case 'paid':
      return { status: 'done', detail: `Invoice #${inv.number} paid in full` };
    case 'overdue':
      return {
        status: 'partial',
        detail: `Invoice #${inv.number} is overdue — chase it before you hand over the keys`,
      };
    case 'partially_paid':
      return {
        status: 'partial',
        detail: `Invoice #${inv.number} part-paid — there is still a balance out`,
      };
    case 'sent':
      return { status: 'partial', detail: `Invoice #${inv.number} sent — awaiting payment` };
    case 'draft':
      return { status: 'open', detail: `Invoice #${inv.number} is still a draft — send it` };
  }
}

export default function HandoverScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // Opened from the Tools hub, the desktop sidebar or universal search there is
  // NO projectId — and the Tools row is `needsProjects: true`, so the only
  // people who could see that entry point were the ones this screen then told
  // "Project not found". ToolProjectPicker resolves the id locally instead,
  // the same way field-ticket does (the reference call site).
  //
  // The pick has to outrank the param, never the other way round: the param is
  // whatever link opened the screen and it can be dead (deleted project, a URL
  // shared last month), while pickedProjectId is the row the user tapped a
  // second ago from a list of projects that exist. `paramProjectId ?? picked`
  // leaves the picker inert on a dead link because the bad id keeps winning.
  const { projectId: paramProjectId } = useLocalSearchParams<{ projectId: string }>();
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const ctx = useProjects() as any;
  const projects: Project[] = ctx.projects ?? [];
  const project = projectId ? ctx.getProject(projectId) : undefined;
  /** The URL named a project that no longer exists — not the same as "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;

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
      // Picking a project in the picker re-runs this effect with `loading`
      // already false, so without this the checklist paints "0 of 8 done"
      // from the previous project's empty selections/binder/waivers before
      // the fetch lands — a wrong status on a screen whose whole point is
      // what is genuinely outstanding on handover day.
      setLoading(true);
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
    const openPunch = projectPunch.filter((p: any) => p.status !== 'closed').length;
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
    const invoiceRow = finalInvoiceState(finalInv);

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
        detail: invoiceRow.detail,
        icon: Receipt,
        status: invoiceRow.status,
        cta: '/invoice',
        ctaParams: ({
          projectId: project.id,
          ...(finalInv?.id ? { invoiceId: finalInv.id } : {}),
        }) as Record<string, string>,
        ctaLabel: invoiceRow.status === 'done' ? 'Review' : 'Open invoice',
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

  if (!projectId || !project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ToolHeader eyebrow="HANDOVER · MAGE ID" title="Walkthrough day checklist" />
        <ToolProjectPicker
          toolName="Handover"
          message="The walkthrough checklist reads one job — its selections, punch list, warranties, binder and final invoice."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<Footprints size={36} color={themeColors.accent} strokeWidth={1.6} />}
        />
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
          <Text style={styles.eyebrow}>{project.name}</Text>
          <Text style={styles.title}>Walkthrough day checklist</Text>
        </View>
      </View>
      <FeatureHeader
        eyebrow="Handover"
        title="Don&apos;t leave anything unchecked"
        subtitle="The walkthrough-day flow most GCs improvise. Every spec confirmed, every signature collected, every key handed over — captured in one place."
        explainer={{
          term: 'Handover Checklist',
          definition: 'Handover is the day you walk the homeowner through the finished project, demonstrate every system (HVAC, smart lock, irrigation), confirm every selection, walk the punch list, and collect signatures on the certificate of substantial completion. Skipping a step here is how warranty disputes start six months later.',
          whenToUse: [
            'Day-of project completion, before the homeowner moves in',
            'Anytime your contract requires "substantial completion" sign-off',
            'When you want a paper trail of what you demonstrated and what they accepted',
          ],
        }}
      />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={themeColors.accent} />
          <Text style={styles.loadingText}>Computing your status…</Text>
        </View>
      ) : (
        <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
          {/* Progress hero */}
          <View style={[styles.heroCard, allDone && styles.heroCardDone]}>
            <View style={styles.heroHead}>
              {allDone ? <MageAIMark size={16} color={Colors.successDark} /> : <AlertCircle size={16} color={themeColors.accent} strokeWidth={1.75} />}
              <Text style={[styles.heroTitle, allDone && { color: Colors.successDark }]}>
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
                  backgroundColor: allDone ? themeColors.success : themeColors.accent,
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
            MAGE ticks what it can read from this job. Walk-through and keys are yours to tick — we save the date you do it.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

function ChecklistRow({ item, onPressItem }: { item: HandoverItem; onPressItem: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const Icon = item.icon;
  const Status = (() => {
    if (item.status === 'done') return { Comp: CheckCircle2, color: Colors.successDark };
    if (item.status === 'partial') return { Comp: AlertCircle, color: '#C26A00' };
    return { Comp: Circle, color: themeColors.textMuted };
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
            <ChevronRight size={13} color={themeColors.accent} strokeWidth={1.75} />
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

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  loading: { padding: 30, alignItems: 'center', gap: 10 },
  loadingText: { fontSize: Type.footnote.fontSize, color: t.textMuted },

  header: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  eyebrow: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.accent, letterSpacing: 1.4, textTransform: 'uppercase' },
  title:   { fontSize: Type.title3.fontSize, fontWeight: '800', color: t.text, letterSpacing: -0.4, marginTop: 4 },

  heroCard: {
    backgroundColor: t.accent + '0D', borderWidth: 1, borderColor: t.accent + '30',
    borderRadius: Tokens.radius.lg, padding: 16, marginBottom: 16,
  },
  heroCardDone: {
    backgroundColor: 'rgba(30,142,74,0.08)', borderColor: 'rgba(30,142,74,0.35)',
  },
  heroHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  heroTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800', color: t.accent, letterSpacing: -0.2 },
  heroBody: { fontSize: Type.footnote.fontSize, color: t.text, lineHeight: 18, marginBottom: 12 },
  progressTrack: { height: 6, backgroundColor: t.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 4 },

  listLabel: { fontSize: Type.caption2.fontSize, fontWeight: '800', color: t.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginLeft: 2 },

  row: {
    flexDirection: 'row', gap: 12, padding: 14,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
    borderRadius: Tokens.radius.card, marginBottom: 8,
  },
  rowDone: { opacity: 0.85 },
  rowIcon: { width: 36, height: 36, borderRadius: Tokens.radius.md, alignItems: 'center', justifyContent: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowLabel: { flex: 1, fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text, letterSpacing: -0.2 },
  rowDetail: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 4 },
  rowCta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 8 },
  rowCtaText: { fontSize: Type.caption1.fontSize, fontWeight: '800', color: t.accent },
  rowCtaManual: { color: t.textMuted, fontWeight: '700' },

  fineprint: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 16, marginTop: 14, fontStyle: 'italic' },
});
