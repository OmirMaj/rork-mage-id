// handover — the macro closeout flow. A single screen the GC walks
// through with the client on handover day. Every box that needs to
// be ticked before keys change hands lives here, with status computed
// live from existing project data:
//
//  - Selections: every category has a chosen option
//  - Punch list: zero open items
//  - Warranties: at least one on file
//  - Closeout binder: status === 'sent'
//  - Final invoice: the WHOLE job's invoices (utils/handoverWaivers
//    jobInvoiceHandoverState) — done only when nothing is outstanding, no
//    draft is left unsent and no retention is still held (#139). It used to
//    read only the highest-numbered invoice, so a paid #5 ticked the row over
//    an overdue #4.
//  - Lien waivers: an UNCONDITIONAL FINAL waiver per active commitment (#49) —
//    a conditional final is progress, a progress waiver covers nothing here.
//  - Permits & final inspection (#50): from the job's permits — a failed or
//    denied or expired permit blocks, a missing Certificate of Occupancy on a
//    building permit keeps it partial. A job with NO permits gets a manual
//    "No permits required on this job" confirm instead of a hard block.
//  - Final walk-through and Keys & access: manually-checked items
//
// Nine items. Seven are read straight off the job — MAGE ticks those itself,
// which is what the footer line on the screen tells the GC — and the permits
// row turns into a manual confirm only when the job has no permits at all.
// What the screen refuses is a vacuous tick: a job with no selection
// categories, no punch items, no commitments reads 'open', not 'done', so
// "Ready to hand over" cannot come from an empty project.
//
// It also refuses a tick — or an instruction — from a read that FAILED (#52).
// Selections, the binder and the waivers come from Supabase; offline, those
// reads used to answer [] / null, and the rows read "No allowance categories
// yet" and "Compile and deliver the binder" on a job where both were done. A
// failed read now renders a neutral "Couldn't load" row that is never counted
// as done, and the reads re-run whenever the screen regains focus, so coming
// back from /selections or /closeout-binder shows what he just changed.
//
// Selections, warranties, the binder, invoices and lien waivers live on the
// PROJECT OWNER's account (owner-only RLS: selcat_gc_*, warranties_owner_all,
// cb_gc_all, invoices_select, lw_gc_select). For an invited PM or foreman those
// lists come back EMPTY, not failed — so for a non-owner those rows read
// "Managed by the project owner" (#53) instead of an open status computed from
// nothing, with no Add / Compile CTA.
//
// The two manual items are the ceremony half — the GC confirms those
// standing next to the client, and the date is saved on the project.

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator,
 Platform } from 'react-native';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, CheckCircle2, Circle, AlertCircle, ChevronRight,
  ShoppingCart, CheckSquare, ShieldCheck, BookOpen, Receipt,
  ScrollText, Footprints, Send, CloudOff, Lock, Landmark,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import { FeatureHeader } from '@/components/FeatureHeader';
import { ToolHeader, ToolProjectPicker } from '@/components/ToolScreenChrome';
import type { InvoiceStatus, LienWaiver, Permit, Project, SelectionCategory } from '@/types';
import { loadSelectionsChecked } from '@/utils/selectionsEngine';
import { loadCloseoutBinderChecked, type CloseoutBinder } from '@/utils/closeoutBinderEngine';
import { loadLienWaiversChecked } from '@/utils/lienWaiverEngine';
import {
  lienWaiverCoverage, lienWaiverDetail, jobInvoiceHandoverState, permitsHandoverState,
} from '@/utils/handoverWaivers';
import { todayCalendarDay } from '@/utils/calendarDate';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';

interface HandoverItem {
  key: string;
  label: string;
  detail: string;
  icon: React.ComponentType<{ size?: number; color?: string }>;
  /**
   * 'unknown' = the read behind this row FAILED (offline); 'managed' = the row's
   * records live on the project owner's account and this user can't read them.
   * Neither is ever counted as done, and neither shows an Add / Compile CTA.
   */
  status: 'done' | 'partial' | 'open' | 'unknown' | 'managed';
  /** Optional CTA route if not done — taps on the item route to that screen. */
  cta?: string;
  ctaParams?: Record<string, string>;
  ctaLabel?: string;
  /** Manually-checked item? */
  manual?: boolean;
}

const HANDOVER_MANUAL_KEYS = ['walkthrough', 'keys', 'permits_na'] as const;
type ManualKey = typeof HANDOVER_MANUAL_KEYS[number];

/** One failure-aware read: pending until it answers, then the value or why not. */
type Read<T> = { state: 'pending' } | { state: 'ok'; value: T } | { state: 'error'; error: string };
const PENDING = { state: 'pending' } as const;

export const HANDOVER_LOAD_FAILED = "Couldn't load — check your signal. Tap to retry.";
export const HANDOVER_MANAGED_BY_OWNER = "Managed by the project owner — these records are kept on their account.";

// Re-exported so the smoke suite can pin the whole-job invoice row next to the
// single-invoice ladder below (__tests__/smoke/polish-copy-honesty.test.tsx).
export { jobInvoiceHandoverState };

/**
 * The single-invoice ladder — no longer what the row renders (it reads the
 * whole job through jobInvoiceHandoverState since wave 5, #139), kept exported
 * because the smoke suite pins it and describes the five statuses.
 *
 * Originally: the "Final invoice paid" row, from the highest-numbered invoice on the job.
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

  const projectPermits: Permit[] = useMemo(
    () => projectId ? ctx.getPermitsForProject(projectId) : [],
    [projectId, ctx],
  );

  // #53: who is looking. Selections, warranties, the binder, invoices and lien
  // waivers are owner-only in RLS, so for an invitee they read EMPTY — the
  // rows must say so rather than compute "open" from nothing. The resolved role
  // wins; while it is still resolving (or offline and unknown) the project's
  // own ownerUserId stamp decides — a job with no stamp, or his stamp, is his.
  const { user } = useAuth();
  const roleState = useProjectRoleState(project ? projectId : undefined);
  const ownedByStamp = !project?.ownerUserId || project.ownerUserId === user?.id;
  const isOwnerView = roleState.role ? roleState.role === 'owner' : ownedByStamp;

  const [selRead, setSelRead] = useState<Read<SelectionCategory[]>>(PENDING);
  const [binderRead, setBinderRead] = useState<Read<CloseoutBinder | null>>(PENDING);
  const [waiverRead, setWaiverRead] = useState<Read<LienWaiver[]>>(PENDING);
  const [loading, setLoading] = useState(true);
  // Out-of-order guard: a re-focus read that lands after a newer one (or after
  // the picker moved to another project) is dropped, not painted.
  const requestRef = useRef(0);
  // The project whose reads are on screen — a re-read of the SAME project
  // refreshes quietly (no spinner, no flash); a new project starts clean.
  const shownForRef = useRef<string | null>(null);

  // Manual checkboxes — saved on the project itself so the state
  // survives re-opens. The shape is { [manualKey]: ISO timestamp }.
  const manualChecks = useMemo<Record<string, string>>(
    () => (project?.handoverChecklist as Record<string, string> | undefined) ?? {},
    [project],
  );

  const load = useCallback(() => {
    const req = ++requestRef.current;
    if (!projectId) { setLoading(false); return; }
    if (shownForRef.current !== projectId) {
      // Picking a project re-runs this with the previous project's rows on
      // screen; without the reset the checklist paints them against the new
      // job's name before the fetch lands.
      setSelRead(PENDING);
      setBinderRead(PENDING);
      setWaiverRead(PENDING);
      setLoading(true);
    }
    void (async () => {
      const [sel, b, w] = await Promise.all([
        loadSelectionsChecked(projectId),
        loadCloseoutBinderChecked(projectId),
        loadLienWaiversChecked(projectId),
      ]);
      if (req !== requestRef.current) return;
      setSelRead(sel.ok ? { state: 'ok', value: sel.value } : { state: 'error', error: sel.error });
      setBinderRead(b.ok ? { state: 'ok', value: b.value } : { state: 'error', error: b.error });
      setWaiverRead(w.ok ? { state: 'ok', value: w.waivers } : { state: 'error', error: w.error });
      shownForRef.current = projectId;
      setLoading(false);
    })();
  }, [projectId]);

  // Re-read on every focus, not only on mount: coming back from /selections,
  // /closeout-binder or /lien-waivers after fixing something must show it.
  useFocusEffect(load);

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
    const managedRow = (key: string, label: string, icon: HandoverItem['icon']): HandoverItem => ({
      key, label, icon, status: 'managed', detail: HANDOVER_MANAGED_BY_OWNER,
    });
    const failedRow = (key: string, label: string, icon: HandoverItem['icon']): HandoverItem => ({
      key, label, icon, status: 'unknown', detail: HANDOVER_LOAD_FAILED,
    });
    const pendingRow = (key: string, label: string, icon: HandoverItem['icon']): HandoverItem => ({
      key, label, icon, status: 'unknown', detail: 'Loading…',
    });

    // Selections — every category has a chosen option.
    let selectionsRow: HandoverItem;
    if (!isOwnerView) selectionsRow = managedRow('selections', 'Selections confirmed', ShoppingCart);
    else if (selRead.state === 'error') selectionsRow = failedRow('selections', 'Selections confirmed', ShoppingCart);
    else if (selRead.state === 'pending') selectionsRow = pendingRow('selections', 'Selections confirmed', ShoppingCart);
    else {
      const cats = selRead.value;
      const totalCats = cats.length;
      const chosenCats = cats.filter(c => (c.options ?? []).some(o => o.isChosen)).length;
      const selStatus: HandoverItem['status'] =
        totalCats === 0 ? 'open'
        : chosenCats === totalCats ? 'done'
        : 'partial';
      selectionsRow = {
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
      };
    }

    // Punch list — zero open items. punch_items is collaborator-readable, so
    // this row is real for an invitee too.
    const openPunch = projectPunch.filter((p: any) => p.status !== 'closed').length;
    const punchStatus: HandoverItem['status'] = openPunch === 0 && projectPunch.length > 0 ? 'done' : (openPunch > 0 ? 'partial' : 'open');

    // Warranties — at least one on file (from ProjectContext, owner-only rows).
    const warrantyStatus: HandoverItem['status'] = projectWarranties.length > 0 ? 'done' : 'open';
    const warrantiesRow: HandoverItem = !isOwnerView
      ? managedRow('warranties', 'Warranties on file', ShieldCheck)
      : {
        key: 'warranties',
        label: 'Warranties on file',
        detail: projectWarranties.length === 0
          ? 'Add manufacturer + workmanship warranties so the client has them.'
          : `${projectWarranties.length} warrant${projectWarranties.length === 1 ? 'y' : 'ies'} recorded`,
        icon: ShieldCheck,
        status: warrantyStatus,
        cta: '/warranties',
        ctaParams: { projectId: project.id },
        ctaLabel: warrantyStatus === 'done' ? 'Review' : 'Add warranties',
      };

    // Closeout binder — must be sent.
    let binderRow: HandoverItem;
    if (!isOwnerView) binderRow = managedRow('binder', 'Closeout binder delivered', BookOpen);
    else if (binderRead.state === 'error') binderRow = failedRow('binder', 'Closeout binder delivered', BookOpen);
    else if (binderRead.state === 'pending') binderRow = pendingRow('binder', 'Closeout binder delivered', BookOpen);
    else {
      const binder = binderRead.value;
      const binderStatus: HandoverItem['status'] = binder?.status === 'sent' ? 'done' : binder?.status === 'finalized' ? 'partial' : 'open';
      binderRow = {
        key: 'binder',
        label: 'Closeout binder delivered',
        detail: !binder
          ? 'Compile and deliver the binder so the client has finishes, warranties, and contacts in one place.'
          : binder.status === 'sent'
            ? `Delivered ${binder.sentAt ? new Date(binder.sentAt).toLocaleDateString() : ''}`
            : binder.status === 'finalized'
              ? 'Finalized — tap to deliver to client'
              : 'Draft only — finalize and deliver',
        icon: BookOpen,
        status: binderStatus,
        cta: '/closeout-binder',
        ctaParams: { projectId: project.id },
        ctaLabel: binderStatus === 'done' ? 'Re-deliver' : 'Open binder',
      };
    }

    // Final invoice — the whole job, not the top invoice (#139).
    const today = todayCalendarDay();
    let invoiceRow: HandoverItem;
    if (!isOwnerView) invoiceRow = managedRow('invoice', 'Final invoice paid', Receipt);
    else {
      const inv = jobInvoiceHandoverState(projectInvoices, today);
      invoiceRow = {
        key: 'invoice',
        label: 'Final invoice paid',
        detail: inv.detail,
        icon: Receipt,
        status: inv.status,
        cta: '/invoice',
        ctaParams: ({
          projectId: project.id,
          ...(inv.targetInvoiceId ? { invoiceId: inv.targetInvoiceId } : {}),
        }) as Record<string, string>,
        ctaLabel: inv.status === 'done' ? 'Review' : 'Open invoice',
      };
    }

    // Lien waivers — an unconditional final per active commitment, matched by
    // the ids the app writes (commitmentId, then sub id, then name). It used to
    // key on a Commitment.companyId that does not exist (audit round 2, #22),
    // and then counted any signed waiver, progress ones included (#49) — see
    // utils/handoverWaivers.
    let waiverRow: HandoverItem;
    if (!isOwnerView) waiverRow = managedRow('waivers', 'Lien waivers collected', ScrollText);
    else if (waiverRead.state === 'error') waiverRow = failedRow('waivers', 'Lien waivers collected', ScrollText);
    else if (waiverRead.state === 'pending') waiverRow = pendingRow('waivers', 'Lien waivers collected', ScrollText);
    else {
      const waivers = waiverRead.value;
      const waiverCov = lienWaiverCoverage(projectCommitments, waivers);
      waiverRow = {
        key: 'waivers',
        label: 'Lien waivers collected',
        detail: lienWaiverDetail(waiverCov),
        icon: ScrollText,
        status: waiverCov.status,
        cta: '/lien-waivers',
        ctaParams: { projectId: project.id },
        ctaLabel: 'Open lien waivers',
      };
    }

    // Permits & final inspection (#50). permits is collaborator-readable
    // (permits_collab_select), so it is computed for everyone. Zero permits is
    // not a block — it is the GC's call, confirmed by tap and dated.
    const permitState = permitsHandoverState(projectPermits, today);
    const permitsRow: HandoverItem = permitState.status === 'none'
      ? {
        key: 'permits_na',
        label: 'Permits & final inspection',
        detail: manualChecks['permits_na']
          ? `No permits required on this job — confirmed ${new Date(manualChecks['permits_na']).toLocaleDateString()}`
          : 'No permits logged. Tap to confirm this job needed none — or log them on the Permits screen.',
        icon: Landmark,
        status: manualChecks['permits_na'] ? 'done' : 'open',
        manual: true,
      }
      : {
        key: 'permits',
        label: 'Permits & final inspection',
        detail: permitState.detail,
        icon: Landmark,
        status: permitState.status,
        cta: '/permits',
        ctaParams: { projectId: project.id },
        ctaLabel: permitState.status === 'done' ? 'Review' : 'Open permits',
      };

    return [
      selectionsRow,
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
      warrantiesRow,
      binderRow,
      invoiceRow,
      waiverRow,
      permitsRow,
      {
        key: 'walkthrough',
        label: 'Final walk-through completed',
        detail: manualChecks['walkthrough']
          ? `Confirmed ${new Date(manualChecks['walkthrough']).toLocaleDateString()}`
          : 'Walk every space with the client. Note any last items.',
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
  }, [project, isOwnerView, selRead, projectPunch, projectWarranties, binderRead, projectInvoices, projectCommitments, waiverRead, projectPermits, manualChecks]);

  const doneCount = items.filter(i => i.status === 'done').length;
  const partialCount = items.filter(i => i.status === 'partial').length;
  const openCount = items.filter(i => i.status === 'open').length;
  const unknownCount = items.filter(i => i.status === 'unknown').length;
  const managedCount = items.filter(i => i.status === 'managed').length;
  const total = items.length;
  // Only a real tick counts: a row that couldn't load, or that lives on the
  // owner's account, can never make "Ready to hand over" true.
  const allDone = doneCount === total && total > 0;
  const heroParts: string[] = [];
  if (partialCount > 0) heroParts.push(`${partialCount} in progress`);
  if (openCount > 0) heroParts.push(`${openCount} not started`);
  if (unknownCount > 0) heroParts.push(`${unknownCount} couldn't load`);
  if (managedCount > 0) heroParts.push(`${managedCount} kept by the project owner`);

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
          definition: 'Handover is the day you walk the client through the finished project, demonstrate every system (HVAC, controls, life safety, access), confirm every selection, walk the punch list, and collect signatures on the certificate of substantial completion. Skipping a step here is how warranty disputes start six months later.',
          whenToUse: [
            'Day-of project completion, before the client takes occupancy',
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
                : `${heroParts.join(', ')}.`}
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
                // A row whose read failed retries; a row kept on the owner's
                // account has nothing to open.
                if (item.status === 'unknown') { load(); return; }
                if (item.status === 'managed' || !item.cta) return;
                router.push({ pathname: item.cta as any, params: item.ctaParams ?? {} });
              }}
            />
          ))}

          <Text style={styles.fineprint}>
            MAGE ticks what it can read from this job. Walk-through and keys — and &quot;no permits required&quot; on a job with none logged — are yours to tick; we save the date you do it.
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
    if (item.status === 'unknown') return { Comp: CloudOff, color: themeColors.textMuted };
    if (item.status === 'managed') return { Comp: Lock, color: themeColors.textMuted };
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
        {item.ctaLabel && !item.manual && item.status !== 'done' && item.status !== 'unknown' && item.status !== 'managed' && (
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
