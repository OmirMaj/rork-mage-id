import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, Modal, TextInput,
  KeyboardAvoidingView, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useRouter, useLocalSearchParams, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Lock, Unlock, FolderOpen, ChevronRight, AlertCircle, CheckCircle2,
  TrendingUp, Receipt, ArrowLeft, HelpCircle, BellRing, X, Scale, ExternalLink,
} from 'lucide-react-native';
import { FeatureExplainerSheet } from '@/components/FeatureExplainerSheet';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
import type { Invoice, Project } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney } from '@/utils/formatters';
import { effectiveRetentionHeld, pendingRetentionHeld } from '@/utils/invoiceBilling';
import {
  summarizeProjectRetainage,
  planRetainageRelease,
  planRetainageReduction,
  buildProjectRetainageRelease,
  nextRetainageWrite,
  retainageReadiness,
  dueDateForTerms,
  RETAINAGE_SOURCES,
  RETAINAGE_LEGAL_DISCLAIMER,
  type ProjectRetainageSummary,
  type RetainageReleasePlan,
  type RetainageReleaseOutcome,
  type RetainageReadinessSignal,
} from '@/utils/retainage';
import { generateUUID } from '@/utils/generateId';
import { parseMoneyInput, MONEY_FORMAT_HINT } from '@/utils/cashFlowEngine';
import { showAlert } from '@/utils/alert';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

/**
 * Why a percentage target released nothing — read off the plan's own skips, not
 * assumed. "Every invoice is already at or below it" is false when the rows were
 * skipped for having no percentage basis to step, and this screen may not state
 * a reason the plan did not give.
 */
function emptyPercentReason(plan: RetainageReleasePlan): string {
  const noBasis = plan.skipped.filter(s => s.reason === 'no_percentage_basis').length;
  const noWork = plan.skipped.filter(s => s.reason === 'no_work_value').length;
  const atTarget = plan.skipped.filter(s => s.reason === 'already_at_or_below_target').length;
  if (noBasis + noWork > 0 && atTarget === 0) {
    return `${noBasis + noWork} invoice(s) hold a dollar figure a percentage target cannot step. Use the $ amount mode.`;
  }
  if (noBasis + noWork > 0) {
    return `${atTarget} invoice(s) are already at or below it, and ${noBasis + noWork} hold a dollar figure a percentage target cannot step.`;
  }
  return 'Every invoice on this job is already at or below it.';
}

// HEALTH-F5: sign-correct money via the one formatter — no local Math.abs copies.
const formatCurrency = (n: number): string => formatMoney(n);
const formatCurrencyPrecise = (n: number): string => formatMoney(n, 2);

interface ProjectRetention {
  project: Project;
  totalContract: number;
  retentionHeld: number;
  retentionReleased: number;
  retentionPending: number;
  invoicesWithRetention: Invoice[];
  summary: ProjectRetainageSummary;
  readiness: RetainageReadinessSignal;
}

type ReleaseMode = 'amount' | 'percent';

export default function RetentionScreen() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { projectId: scopeProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, invoices, updateInvoice, getPunchItemsForProject } = useProjects();
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(scopeProjectId ?? null);
  const [explainerOpen, setExplainerOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // Project-level release state. `releaseProjectId` doubles as the modal gate.
  const [releaseProjectId, setReleaseProjectId] = useState<string | null>(null);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>('percent');
  const [releaseAmountInput, setReleaseAmountInput] = useState('');
  const [releasePercentInput, setReleasePercentInput] = useState('');
  const [releaseNote, setReleaseNote] = useState('');
  // The release WRITE queue — drained one invoice per commit. See
  // utils/retainage.nextRetainageWrite: ProjectContext.updateInvoice closes over
  // the render-time invoices array, so N calls in one tick keep only the last.
  const [writeQueue, setWriteQueue] = useState<{
    pending: RetainageReleaseOutcome[];
    lines: string[];
  } | null>(null);

  const projectRetention = useMemo<ProjectRetention[]>(() => {
    // Audit 2026-09-07 ("Worth doing" #27). This filtered on the STORED
    // `retentionPercent` column, so an invoice that is genuinely holding money
    // — a legacy row with a retentionAmount but no percent, or one whose
    // percent was cleared after the fact — was missing from the Retention
    // screen entirely while the money stayed withheld. The population is now
    // the same helper that decides the amount: if effectiveRetentionHeld says
    // this invoice holds a dollar, this screen shows it.
    const relevantInvoices = invoices.filter(inv => effectiveRetentionHeld(inv) > 0);
    const byProject: Record<string, Invoice[]> = {};
    relevantInvoices.forEach(inv => {
      if (!byProject[inv.projectId]) byProject[inv.projectId] = [];
      byProject[inv.projectId].push(inv);
    });
    const now = new Date();
    const list: ProjectRetention[] = [];
    Object.entries(byProject).forEach(([pid, invs]) => {
      const project = projects.find(p => p.id === pid);
      if (!project) return;
      if (scopeProjectId && pid !== scopeProjectId) return;
      const totalContract = invs.reduce((s, i) => s + (i.totalDue ?? 0), 0);
      // MONEY-05: the withholding is the shared helper's (percentage of work
      // value), not the stored column — this screen caps how much a GC can
      // release, so a stale stored figure stranded $283.48 as permanently
      // "pending" on the founder's Houston invoice while the invoice screen
      // capped the release at the smaller, correct number.
      // RETAINAGE-1: and it is now the SAME summarizer the release path plans
      // against, so the figure on the card is the figure being released.
      const summary = summarizeProjectRetainage(pid, invoices);
      const punch = getPunchItemsForProject(pid);
      const lastRetainageInvoiceIso = summary.invoices.length > 0
        ? summary.invoices[summary.invoices.length - 1].invoice.issueDate
        : undefined;
      list.push({
        project,
        totalContract,
        retentionHeld: summary.held,
        retentionReleased: summary.released,
        retentionPending: summary.pending,
        invoicesWithRetention: invs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        summary,
        readiness: retainageReadiness({
          pending: summary.pending,
          projectStatus: project.status,
          substantialCompletionDate: project.substantialCompletionDate,
          punchTotal: punch.length,
          punchOpen: punch.filter(pi => pi.status !== 'closed').length,
          lastRetainageInvoiceIso,
          now,
        }),
      });
    });
    return list.sort((a, b) => b.retentionPending - a.retentionPending);
  }, [projects, invoices, scopeProjectId, getPunchItemsForProject]);

  const totals = useMemo(() => {
    const totalHeld = projectRetention.reduce((s, p) => s + p.retentionHeld, 0);
    const totalReleased = projectRetention.reduce((s, p) => s + p.retentionReleased, 0);
    const totalPending = projectRetention.reduce((s, p) => s + p.retentionPending, 0);
    const projectsWithRetention = projectRetention.length;
    const fullyReleased = projectRetention.filter(p => p.retentionPending < 0.01 && p.retentionReleased > 0).length;
    const readyToRelease = projectRetention.filter(p => p.readiness.level === 'due').length;
    return { totalHeld, totalReleased, totalPending, projectsWithRetention, fullyReleased, readyToRelease };
  }, [projectRetention]);

  const toggleExpand = (pid: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setExpandedProjectId(prev => (prev === pid ? null : pid));
  };

  const openInvoice = (inv: Invoice) => {
    router.push({ pathname: '/invoice', params: { projectId: inv.projectId, invoiceId: inv.id } } as any);
  };

  // ── Project-level release ────────────────────────────────────────────────
  const releaseRow = releaseProjectId
    ? projectRetention.find(p => p.project.id === releaseProjectId) ?? null
    : null;

  const openRelease = useCallback((row: ProjectRetention) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setReleaseProjectId(row.project.id);
    setReleaseMode('percent');
    setReleaseAmountInput('');
    setReleasePercentInput('');
    setReleaseNote('');
  }, []);

  const closeRelease = useCallback(() => {
    setReleaseProjectId(null);
    setReleaseAmountInput('');
    setReleasePercentInput('');
    setReleaseNote('');
  }, []);

  // The preview. Recomputed from `invoices` on every render, so what is drawn
  // is what will be written — and buildProjectRetainageRelease re-checks each
  // allocation against the live row anyway before anything is patched.
  const plan = useMemo<RetainageReleasePlan | null>(() => {
    if (!releaseRow) return null;
    if (releaseMode === 'amount') {
      // parseMoneyInput, not parseFloat (#148): parseFloat('12,500') is 12, so
      // a GC on a laptop typing a normal dollar figure previewed and released
      // $12. It reads US grouping and refuses anything ambiguous ('3200,50'),
      // and the box then says what shape to type (amountUnreadable below).
      const amt = parseMoneyInput(releaseAmountInput);
      if (amt === null || !Number.isFinite(amt) || amt <= 0) return null;
      return planRetainageRelease(releaseRow.summary, amt);
    }
    const pct = parseFloat(releasePercentInput);
    if (!Number.isFinite(pct) || pct < 0) return null;
    return planRetainageReduction(releaseRow.summary, pct);
  }, [releaseRow, releaseMode, releaseAmountInput, releasePercentInput]);

  // Typed but not a dollar amount — the reason the Release button is dead,
  // said under the box rather than left for the GC to guess (#148).
  const amountUnreadable = releaseMode === 'amount'
    && releaseAmountInput.trim().length > 0
    && parseMoneyInput(releaseAmountInput) === null;

  const applyRelease = useCallback(() => {
    if (!releaseRow || !plan) return;
    // A drain in flight means `invoices` is mid-update; planning a second
    // release against it is how the same dollar leaves twice.
    if (writeQueue != null) return;
    if (plan.allocations.length === 0) {
      showAlert(
        'Nothing to Release',
        releaseMode === 'percent'
          ? `${emptyPercentReason(plan)} Enter a lower target, or release a dollar figure instead.`
          : 'Enter an amount above zero. There must be retainage still held to release it.',
      );
      return;
    }
    const result = buildProjectRetainageRelease(plan, invoices, {
      now: new Date().toISOString(),
      makeId: () => generateUUID(),
      dueDateFor: dueDateForTerms,
      note: releaseNote,
    });
    if (result.outcomes.length === 0) {
      showAlert(
        'Nothing Released',
        'These invoices changed since this preview was drawn — none of the amounts still fit inside what is held. Reopen the release and try again.',
      );
      return;
    }
    const reopened = result.outcomes.filter(o => o.reopened).length;
    const needRemint = result.outcomes.filter(o => o.needsPayLinkRemint);
    const lines: string[] = [
      `${formatCurrencyPrecise(result.released)} across ${result.outcomes.length} invoice${result.outcomes.length === 1 ? '' : 's'} is now collectible.`,
    ];
    if (reopened > 0) {
      lines.push(`${reopened} settled invoice${reopened === 1 ? ' was' : 's were'} reopened, with the payment clock restarted from today.`);
    }
    if (needRemint.length > 0) {
      lines.push(
        `${needRemint.length} invoice${needRemint.length === 1 ? ' had a' : 's had'} payment link${needRemint.length === 1 ? '' : 's'} for the old balance `
        + `(#${needRemint.map(o => o.invoiceNumber).join(', #')}). Those links no longer match what is owed, so the client cannot use them — `
        + `open the invoice and regenerate to bill the released money by link.`,
      );
    }
    if (result.refused.length > 0) {
      lines.push(`${result.refused.length} invoice${result.refused.length === 1 ? '' : 's'} changed since the preview and released nothing.`);
    }
    lines.push('Record each payment when it arrives.');

    // Queue the writes rather than looping them here. The alert is deliberately
    // deferred until the last one has committed, so it can never state a figure
    // the screen behind it does not show.
    closeRelease();
    setWriteQueue({ pending: result.outcomes, lines });
  }, [releaseRow, plan, releaseMode, releaseNote, invoices, writeQueue, closeRelease]);

  // Drain: ONE updateInvoice per commit. Each commit hands this effect a fresh
  // `updateInvoice` closed over a list that already carries the previous patch,
  // which is the only way all N releases survive a non-functional updater.
  // Re-entrant safely: the patches are absolute, so re-applying the head writes
  // the identical row (same release id) rather than releasing twice.
  useEffect(() => {
    if (!writeQueue) return;
    const { write, remaining } = nextRetainageWrite(writeQueue.pending);
    if (!write) {
      const { lines } = writeQueue;
      setWriteQueue(null);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert('Retainage Released', lines.join('\n\n'));
      return;
    }
    updateInvoice(write.invoiceId, write.patch);
    setWriteQueue({ pending: remaining, lines: writeQueue.lines });
  }, [writeQueue, updateInvoice]);

  const scopedProject = scopeProjectId ? projects.find(p => p.id === scopeProjectId) : null;

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: scopedProject ? `${scopedProject.name} · Retention` : 'Retention',
          headerStyle: { backgroundColor: themeColors.bg },
          headerTintColor: themeColors.accent,
          headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
          // Audit 2026-09-07 ("Worth doing" #22/#27): "retention" is a term a
          // residential GC may never have met, and nothing on this screen said
          // what the percentage is taken OF.
          headerRight: () => (
            <TouchableOpacity
              onPress={() => setExplainerOpen(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="What is retention?"
              testID="retention-explainer-chip"
            >
              <HelpCircle size={20} color={themeColors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          ),
        }}
      />

      <FeatureExplainerSheet
        visible={explainerOpen}
        onClose={() => setExplainerOpen(false)}
        term="Retention (Retainage)"
        definition={
          'Retention is a slice of every progress payment the client keeps back — commonly 5% or 10% — '
          + 'until the job is substantially complete and the punch list is cleared. It is your money; '
          + 'it is just being held. MAGE computes it on the WORK VALUE — the invoice subtotal, before '
          + 'sales tax — because you remit that tax to the state whether or not the client holds '
          + 'retention, so withholding against it would hold back money you have already paid out. '
          + 'It does not have to come back all at once: you can step the withholding down (10% to 5%, '
          + 'say) and release the rest at closeout.'
        }
        whenToUse={[
          'When a contract says the owner holds 5% or 10% until substantial completion',
          'At closeout, to see exactly what is still owed to you across every job',
          'Mid-job, when the contract steps the withholding down — release part of it and leave the rest',
          'Before you release retention to a sub — hold yours until yours is released',
        ]}
      />

      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <View style={styles.heroIconWrap}>
            <Lock size={28} color={Colors.warningLabel} strokeWidth={1.75} />
          </View>
          <Text style={styles.heroAmount}>{formatCurrencyPrecise(totals.totalPending)}</Text>
          <Text style={styles.heroLabel}>Retention Pending Release</Text>
          {totals.projectsWithRetention > 0 && (
            <Text style={styles.heroMeta}>
              Across {totals.projectsWithRetention} project{totals.projectsWithRetention === 1 ? '' : 's'}
              {totals.fullyReleased > 0 ? ` · ${totals.fullyReleased} fully released` : ''}
            </Text>
          )}
          {totals.readyToRelease > 0 && (
            <View style={styles.heroFlag} testID="retention-ready-flag">
              <BellRing size={13} color={Colors.warningLabel} strokeWidth={2} />
              <Text style={styles.heroFlagText}>
                {totals.readyToRelease} job{totals.readyToRelease === 1 ? '' : 's'} read{totals.readyToRelease === 1 ? 's' : ''} as
                finished with retainage still held
              </Text>
            </View>
          )}
        </View>

        {/* Metrics */}
        <View style={styles.metricsRow}>
          <View style={[styles.metricCard, { borderColor: Colors.warning + '40' }]}>
            <Lock size={14} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalHeld)}</Text>
            <Text style={styles.metricLabel}>Total Held</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: themeColors.success + '40' }]}>
            <Unlock size={14} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalReleased)}</Text>
            <Text style={styles.metricLabel}>Released</Text>
          </View>
          <View style={[styles.metricCard, { borderColor: themeColors.danger + '40' }]}>
            <AlertCircle size={14} color={themeColors.danger} strokeWidth={1.75} />
            <Text style={styles.metricValue}>{formatCurrency(totals.totalPending)}</Text>
            <Text style={styles.metricLabel}>Pending</Text>
          </View>
        </View>

        {/* THE BASIS, stated where the figures are (audit 2026-09-07,
            "Worth doing" #27). The arithmetic has been right since MISS-04 —
            retainage is computed on the subtotal — but only app/invoice.tsx
            ever said so, so a client reading "Retention held (5%)" next to a
            tax-inclusive total multiplied it on his phone, got a different
            number, and called. */}
        {projectRetention.length > 0 && (
          <Text style={styles.basisNote} testID="retention-basis-note">
            Held on the work value — the invoice subtotal, before sales tax. Multiplying the percentage by
            an invoice total that includes tax gives a larger number; that is not what is being held.
          </Text>
        )}

        {/* Explainer */}
        {projectRetention.length === 0 && (
          <View style={styles.emptyState}>
            <Lock size={36} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No Retention Held Yet</Text>
            <Text style={styles.emptyBody}>
              When you set a Retention % on an invoice (e.g. 10%), that amount is held back by the client until punch list is cleared or substantial completion. It will appear here so you can track and release it.
            </Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => router.back()} activeOpacity={0.8}>
              <ArrowLeft size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.emptyBtnText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Per-project */}
        {projectRetention.map(pr => {
          const expanded = expandedProjectId === pr.project.id;
          const releasePct = pr.retentionHeld > 0 ? Math.round((pr.retentionReleased / pr.retentionHeld) * 100) : 0;
          const isComplete = pr.retentionPending < 0.01 && pr.retentionReleased > 0;
          const readiness = pr.readiness;
          const flagged = readiness.level !== 'none' && pr.retentionPending > 0.005;
          return (
            <View key={pr.project.id} style={styles.projectCard}>
              <TouchableOpacity
                style={styles.projectHeader}
                onPress={() => toggleExpand(pr.project.id)}
                activeOpacity={0.75}
              >
                <View style={styles.projectIconWrap}>
                  {isComplete ? (
                    <CheckCircle2 size={18} color={themeColors.success} strokeWidth={1.75} />
                  ) : (
                    <FolderOpen size={18} color={themeColors.accent} strokeWidth={1.75} />
                  )}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.projectName} numberOfLines={1}>{pr.project.name}</Text>
                  <Text style={styles.projectMeta}>
                    {pr.invoicesWithRetention.length} invoice{pr.invoicesWithRetention.length === 1 ? '' : 's'} with retention
                    {isComplete ? ' · Fully released' : ''}
                    {pr.summary.pendingPercent != null && pr.retentionPending > 0.005
                      // The JOB rate — all withholding ÷ all work value. A
                      // percentage target is applied per invoice, so this
                      // average is NOT what a "step to 5%" lands on; the
                      // release preview prints the resulting job rate for
                      // exactly that reason.
                      ? ` · holding ${pr.summary.pendingPercent.toFixed(pr.summary.pendingPercent < 10 ? 1 : 0)}% of work value across the job`
                      : ''}
                  </Text>
                </View>
                <View style={styles.projectAmountWrap}>
                  <Text style={[styles.projectAmount, isComplete && { color: themeColors.success }]}>
                    {formatCurrency(pr.retentionPending)}
                  </Text>
                  <Text style={styles.projectAmountLabel}>{isComplete ? 'complete' : 'pending'}</Text>
                </View>
                <ChevronRight
                  size={18}
                  color={themeColors.textMuted}
                  style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }} strokeWidth={1.75}
                />
              </TouchableOpacity>

              {/* THE REMINDER. Every line under it is a fact this app already
                  holds — a substantial-completion date the GC stamped, the
                  punch list, the project status. Nothing here reads a statute
                  or claims the money is due; see utils/retainage. */}
              {flagged && (
                <View
                  style={[
                    styles.readinessCard,
                    readiness.level === 'due'
                      ? { backgroundColor: Colors.warning + '14', borderColor: Colors.warning + '55' }
                      : { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.line },
                  ]}
                  testID={`retention-readiness-${pr.project.id}`}
                >
                  <BellRing
                    size={14}
                    color={readiness.level === 'due' ? Colors.warningLabel : themeColors.textSecondary}
                    strokeWidth={2}
                  />
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={styles.readinessHeadline}>{readiness.headline}</Text>
                    {readiness.reasons.map((r, i) => (
                      <Text key={i} style={styles.readinessReason}>· {r}</Text>
                    ))}
                  </View>
                </View>
              )}

              {/* Progress bar */}
              <View style={styles.progressBarWrap}>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(releasePct, 100)}%`, backgroundColor: isComplete ? themeColors.success : Colors.warning }]} />
                </View>
                <Text style={styles.progressBarText}>{releasePct}% released</Text>
              </View>

              {/* THE PROJECT-LEVEL RELEASE — the whole point of this change.
                  Fourteen progress invoices used to mean fourteen taps. */}
              {pr.retentionPending > 0.005 && (
                <TouchableOpacity
                  style={styles.releaseBtn}
                  onPress={() => openRelease(pr)}
                  // A release still being written to the invoices is state a
                  // second release would plan against half-finished. It takes a
                  // handful of frames; the door is shut for those frames.
                  disabled={writeQueue != null}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Release retainage on ${pr.project.name}`}
                  testID={`retention-release-${pr.project.id}`}
                >
                  <Unlock size={15} color={themeColors.accent} strokeWidth={2} />
                  <Text style={styles.releaseBtnText}>
                    {writeQueue != null
                      ? 'Recording release…'
                      : `Release retainage across ${pr.summary.pendingCount} invoice${pr.summary.pendingCount === 1 ? '' : 's'}`}
                  </Text>
                  <ChevronRight size={15} color={themeColors.accent} strokeWidth={2} />
                </TouchableOpacity>
              )}

              {expanded && (
                <View style={styles.expandedSection}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Contract Billed</Text>
                    <Text style={styles.detailValue}>{formatCurrencyPrecise(pr.totalContract)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: Colors.warningLabel }]}>Retention Held</Text>
                    <Text style={[styles.detailValue, { color: Colors.warningLabel }]}>{formatCurrencyPrecise(pr.retentionHeld)}</Text>
                  </View>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: themeColors.success }]}>Released</Text>
                    <Text style={[styles.detailValue, { color: themeColors.success }]}>{formatCurrencyPrecise(pr.retentionReleased)}</Text>
                  </View>
                  <View style={[styles.detailRow, { borderTopWidth: 1, borderTopColor: themeColors.line, paddingTop: 8, marginTop: 4 }]}>
                    <Text style={styles.detailLabelBold}>Pending Release</Text>
                    <Text style={[styles.detailValueBold, { color: isComplete ? themeColors.success : themeColors.danger }]}>
                      {formatCurrencyPrecise(pr.retentionPending)}
                    </Text>
                  </View>

                  <Text style={styles.invoicesSectionLabel}>Invoices</Text>
                  {pr.invoicesWithRetention.map(inv => {
                    const invPending = pendingRetentionHeld(inv);
                    const invDone = invPending < 0.01 && (inv.retentionReleased ?? 0) > 0;
                    return (
                      <TouchableOpacity
                        key={inv.id}
                        style={styles.invoiceRow}
                        onPress={() => openInvoice(inv)}
                        activeOpacity={0.7}
                      >
                        <View style={styles.invoiceIconWrap}>
                          <Receipt size={14} color={themeColors.accent} strokeWidth={1.75} />
                        </View>
                        <View style={{ flex: 1 }}>
                          {/* A row can now reach this screen on a stored
                              retainage amount with no percent on file (see the
                              effectiveRetentionHeld filter above), so the
                              percent is only printed when there is one. */}
                          <Text style={styles.invoiceTitle}>
                            Invoice #{inv.number}
                            {(inv.retentionPercent ?? 0) > 0
                              ? ` · ${inv.retentionPercent}% of work value`
                              : ' · retainage on file'}
                          </Text>
                          <Text style={styles.invoiceMeta}>
                            {new Date(inv.issueDate).toLocaleDateString()}
                            {' · '}
                            {formatCurrency(inv.totalDue)} total
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' as const, gap: 2 }}>
                          <Text style={[styles.invoiceRetention, { color: invDone ? themeColors.success : Colors.warning }]}>
                            {formatCurrency(invPending)}
                          </Text>
                          <Text style={styles.invoiceRetentionLabel}>
                            {invDone ? 'released' : 'pending'}
                          </Text>
                        </View>
                        <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          );
        })}

        {projectRetention.length > 0 && (
          <View style={styles.tipCard}>
            <TrendingUp size={16} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.tipText}>
              Release every invoice on a job from the button on its card, or open a single invoice to release
              just that one. Retainage does not have to come back in one piece — step the withholding down
              now and release the balance at closeout.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ── Project-level release ────────────────────────────────────────── */}
      <Modal
        visible={releaseRow != null}
        transparent
        animationType="slide"
        onRequestClose={closeRelease}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle} numberOfLines={1}>
                  Release Retainage{releaseRow ? ` · ${releaseRow.project.name}` : ''}
                </Text>
                <TouchableOpacity onPress={closeRelease} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {releaseRow && (
                <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
                  <Text style={styles.modalMeta}>
                    Held <Text style={styles.modalMetaStrong}>{formatCurrencyPrecise(releaseRow.summary.pending)}</Text>
                    {releaseRow.summary.pendingPercent != null
                      ? ` — ${releaseRow.summary.pendingPercent.toFixed(2)}% of ${formatCurrency(releaseRow.summary.workValue)} of work value`
                      : ''}
                    {releaseRow.summary.released > 0
                      ? `  ·  ${formatCurrencyPrecise(releaseRow.summary.released)} already released`
                      : ''}
                  </Text>

                  {/* Mode */}
                  <View style={styles.modeRow}>
                    {(['percent', 'amount'] as ReleaseMode[]).map(m => (
                      <TouchableOpacity
                        key={m}
                        style={[styles.modeChip, releaseMode === m && styles.modeChipOn]}
                        onPress={() => setReleaseMode(m)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        testID={`retention-mode-${m}`}
                      >
                        <Text style={[styles.modeChipText, releaseMode === m && styles.modeChipTextOn]}>
                          {m === 'percent' ? 'Step down to a %' : 'Release a $ amount'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {releaseMode === 'percent' ? (
                    <>
                      <Text style={styles.modalFieldLabel}>Hold this much going forward</Text>
                      <View style={styles.inputRow}>
                        <TextInput
                          style={[styles.modalInput, { flex: 1 }]}
                          value={releasePercentInput}
                          onChangeText={setReleasePercentInput}
                          keyboardType="decimal-pad"
                          placeholder="e.g. 5"
                          placeholderTextColor={themeColors.textMuted}
                          testID="retention-percent-input"
                        />
                        <Text style={styles.inputSuffix}>% of work value</Text>
                      </View>
                      <View style={styles.quickRow}>
                        {['5', '2.5', '0'].map(q => (
                          <TouchableOpacity
                            key={q}
                            style={styles.quickChip}
                            onPress={() => setReleasePercentInput(q)}
                            activeOpacity={0.75}
                          >
                            <Text style={styles.quickChipText}>{q}%</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <Text style={styles.modalHint}>
                        Each invoice drops to this percentage of its own work value. Invoices already at or
                        below it are left alone, so you can do this again later without releasing anything twice.
                      </Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.modalFieldLabel}>Amount to release</Text>
                      <View style={styles.inputRow}>
                        <TextInput
                          style={[styles.modalInput, { flex: 1 }]}
                          value={releaseAmountInput}
                          onChangeText={setReleaseAmountInput}
                          keyboardType="decimal-pad"
                          placeholder="0.00"
                          placeholderTextColor={themeColors.textMuted}
                          testID="retention-amount-input"
                        />
                        <TouchableOpacity
                          style={styles.fullBtn}
                          onPress={() => setReleaseAmountInput(releaseRow.summary.pending.toFixed(2))}
                          activeOpacity={0.75}
                        >
                          <Text style={styles.fullBtnText}>All</Text>
                        </TouchableOpacity>
                      </View>
                      {amountUnreadable && (
                        <Text style={styles.previewWarn} testID="retention-amount-unreadable">
                          {MONEY_FORMAT_HINT}
                        </Text>
                      )}
                      <Text style={styles.modalHint}>
                        Applied to the oldest invoice first, then the next, until the amount is used up.
                      </Text>
                    </>
                  )}

                  {/* Preview */}
                  {plan && plan.allocations.length > 0 && (
                    <View style={styles.previewBox} testID="retention-release-preview">
                      <Text style={styles.previewTitle}>
                        {formatCurrencyPrecise(plan.allocated)} from {plan.allocations.length} invoice
                        {plan.allocations.length === 1 ? '' : 's'}
                      </Text>
                      {plan.allocations.map(a => (
                        <View key={a.invoiceId} style={styles.previewRow}>
                          <Text style={styles.previewLabel}>Invoice #{a.invoiceNumber}</Text>
                          <Text style={styles.previewValue}>
                            {formatCurrencyPrecise(a.pendingBefore)} → {formatCurrencyPrecise(a.pendingAfter)}
                          </Text>
                        </View>
                      ))}
                      <View style={[styles.previewRow, styles.previewTotalRow]}>
                        <Text style={styles.previewLabelBold}>Still held after</Text>
                        <Text style={styles.previewValueBold}>
                          {formatCurrencyPrecise(plan.pendingAfter)}
                          {plan.pendingPercentAfter != null
                            ? ` · ${plan.pendingPercentAfter.toFixed(2)}%`
                            : ''}
                        </Text>
                      </View>
                      {/* The two denominators, reconciled before the money
                          moves: a per-invoice target does not step the JOB rate
                          to the same number. */}
                      {plan.pendingPercentAfter != null && (
                        <Text style={styles.previewFoot}>
                          The job is holding{' '}
                          {releaseRow.summary.pendingPercent != null
                            ? `${releaseRow.summary.pendingPercent.toFixed(2)}%`
                            : '—'} of work value now and {plan.pendingPercentAfter.toFixed(2)}% after this
                          release. {releaseMode === 'percent'
                            ? 'A percentage target is applied to each invoice separately, so the job figure does not land on the number you typed.'
                            : 'Both figures are the whole job: what is still held divided by all the work value billed.'}
                        </Text>
                      )}
                      {plan.unallocated > 0.005 && (
                        <Text style={styles.previewWarn}>
                          {formatCurrencyPrecise(plan.unallocated)} of what you typed cannot be released — that
                          is more than this job is holding.
                        </Text>
                      )}
                      {plan.skipped.some(s => s.reason === 'no_work_value') && (
                        <Text style={styles.previewWarn}>
                          {plan.skipped.filter(s => s.reason === 'no_work_value').length} invoice(s) hold a
                          retainage dollar figure with no work value to take a percentage of, so a percentage
                          target cannot touch them. Use the $ amount mode, or release them from the invoice.
                        </Text>
                      )}
                      {plan.skipped.some(s => s.reason === 'no_percentage_basis') && (
                        <Text style={styles.previewWarn}>
                          {plan.skipped.filter(s => s.reason === 'no_percentage_basis').length} invoice(s)
                          hold a fixed dollar amount rather than a percentage, so MAGE does not know what
                          percentage that was ever meant to be and will not step it against a guess. Use the
                          $ amount mode, or release them from the invoice.
                        </Text>
                      )}
                    </View>
                  )}

                  {plan && plan.allocations.length === 0 && (
                    <Text style={styles.previewWarn} testID="retention-release-nothing">
                      Nothing to release at that {releaseMode === 'percent' ? 'percentage' : 'amount'}.
                      {releaseMode === 'percent' ? ` ${emptyPercentReason(plan)}` : ''}
                    </Text>
                  )}

                  <Text style={styles.modalFieldLabel}>Note (optional)</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={releaseNote}
                    onChangeText={setReleaseNote}
                    placeholder="e.g. Substantial completion, punch list cleared"
                    placeholderTextColor={themeColors.textMuted}
                  />

                  <Text style={styles.modalHint}>
                    Releasing makes the money collectible — it does not record a payment. Settled invoices
                    reopen with the payment clock restarted from today.
                  </Text>

                  <TouchableOpacity
                    style={styles.sourcesLink}
                    onPress={() => setSourcesOpen(true)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    testID="retention-sources-link"
                  >
                    <Scale size={13} color={themeColors.textSecondary} strokeWidth={2} />
                    <Text style={styles.sourcesLinkText}>Why can I release only part of it?</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}

              <TouchableOpacity
                style={[styles.modalSaveBtn, (!plan || plan.allocations.length === 0) && styles.modalSaveBtnOff]}
                onPress={applyRelease}
                disabled={!plan || plan.allocations.length === 0}
                activeOpacity={0.85}
                accessibilityRole="button"
                testID="retention-release-apply"
              >
                <Unlock size={18} color={Colors.textOnAccent} strokeWidth={1.75} />
                <Text style={styles.modalSaveBtnText}>
                  {plan && plan.allocations.length > 0
                    ? `Release ${formatCurrencyPrecise(plan.allocated)}`
                    : 'Release'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── The citations. Everything legal this screen says lives in
             utils/retainage.RETAINAGE_SOURCES with a URL and the date it was
             read; nothing is stated from recall, and nothing here is applied
             to the job automatically. ───────────────────────────────────── */}
      <Modal visible={sourcesOpen} transparent animationType="slide" onRequestClose={() => setSourcesOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Retainage is not one event</Text>
              <TouchableOpacity onPress={() => setSourcesOpen(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 440 }}>
              <Text style={styles.sourcesIntro}>
                Retainage does not have to come back in one piece, which is why this screen can release part
                of it. What decides that is your contract. Of the two pages below, one (Illinois) is a
                statute that steps the withholding down during the job; the other (California) sets a
                deadline for paying it after completion. These are the pages MAGE ID read, and when.
              </Text>
              {RETAINAGE_SOURCES.map(src => (
                <View key={src.url} style={styles.sourceCard}>
                  <Text style={styles.sourceAuthority}>{src.authority}</Text>
                  <Text style={styles.sourceSays}>{src.says}</Text>
                  <TouchableOpacity
                    style={styles.sourceLinkRow}
                    onPress={() => void Linking.openURL(src.url)}
                    activeOpacity={0.7}
                    accessibilityRole="link"
                  >
                    <ExternalLink size={12} color={themeColors.accent} strokeWidth={2} />
                    <Text style={styles.sourceLinkText} numberOfLines={2}>{src.url}</Text>
                  </TouchableOpacity>
                  <Text style={styles.sourceMeta}>
                    {src.kind === 'primary' ? 'Primary source' : 'Secondary source'} · read {src.readOn}
                  </Text>
                </View>
              ))}
              <Text style={styles.sourcesDisclaimer}>{RETAINAGE_LEGAL_DISCLAIMER}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  hero: { alignItems: 'center' as const, paddingVertical: 28, paddingHorizontal: 20, gap: 6 },
  heroIconWrap: { width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.warning + '15', alignItems: 'center' as const, justifyContent: 'center' as const, marginBottom: 8 },
  heroAmount: { fontSize: 36, fontWeight: '800' as const, color: t.text, letterSpacing: -1.2 },
  heroLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  heroMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 4 },
  heroFlag: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 8,
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Tokens.radius.md,
    backgroundColor: Colors.warning + '15', borderWidth: 1, borderColor: Colors.warning + '40',
  },
  heroFlagText: { fontSize: Type.caption1.fontSize, color: Colors.warningLabel, fontWeight: '600' as const },

  metricsRow: { flexDirection: 'row' as const, gap: 10, paddingHorizontal: 16, marginBottom: 20 },
  metricCard: { flex: 1, backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 12, borderWidth: 1, gap: 4, alignItems: 'flex-start' as const },
  metricValue: { fontSize: Type.subheadline.fontSize, fontWeight: '800' as const, color: t.text, marginTop: 4 },
  metricLabel: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },

  basisNote: {
    marginHorizontal: 16, marginTop: -8, marginBottom: 16,
    fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17,
  },

  emptyState: { margin: 16, padding: 28, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, alignItems: 'center' as const, gap: 10 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text, marginTop: 6 },
  emptyBody: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center' as const, lineHeight: 19 },
  emptyBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, paddingVertical: 10, paddingHorizontal: 16, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '15', marginTop: 6 },
  emptyBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },

  projectCard: { marginHorizontal: 16, marginBottom: 12, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, borderWidth: 1, borderColor: t.line, overflow: 'hidden' as const },
  projectHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 14 },
  projectIconWrap: { width: 36, height: 36, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt, alignItems: 'center' as const, justifyContent: 'center' as const },
  projectName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  projectMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  projectAmountWrap: { alignItems: 'flex-end' as const },
  projectAmount: { fontSize: Type.callout.fontSize, fontWeight: '800' as const, color: Colors.warningLabel },
  projectAmountLabel: { fontSize: 10, color: t.textMuted, fontWeight: '600' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },

  readinessCard: {
    marginHorizontal: 14, marginBottom: 10, padding: 11, borderRadius: Tokens.radius.card,
    borderWidth: 1, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 9,
  },
  readinessHeadline: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  readinessReason: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  progressBarWrap: { paddingHorizontal: 14, paddingBottom: 12, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  progressBarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.fillSecondary, overflow: 'hidden' as const },
  progressBarFill: { height: '100%' as const, borderRadius: 3 },
  progressBarText: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const, minWidth: 70, textAlign: 'right' as const },

  releaseBtn: {
    marginHorizontal: 14, marginBottom: 12, paddingVertical: 11, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md, backgroundColor: t.accent + '12',
    borderWidth: 1, borderColor: t.accent + '35',
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
  },
  releaseBtnText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },

  expandedSection: { borderTopWidth: 1, borderTopColor: t.line, padding: 14, gap: 6 },
  detailRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 3 },
  detailLabel: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  detailValue: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' as const },
  detailLabelBold: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '700' as const },
  detailValueBold: { fontSize: Type.bodyCompact.fontSize, fontWeight: '800' as const },

  invoicesSectionLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.6, marginTop: 10, marginBottom: 4 },
  invoiceRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 8 },
  invoiceIconWrap: { width: 28, height: 28, borderRadius: Tokens.radius.sm, backgroundColor: t.accent + '12', alignItems: 'center' as const, justifyContent: 'center' as const },
  invoiceTitle: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  invoiceMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 2 },
  invoiceRetention: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  invoiceRetentionLabel: { fontSize: 10, color: t.textMuted, fontWeight: '600' as const },

  tipCard: { marginHorizontal: 16, marginTop: 8, padding: 14, backgroundColor: t.accent + '10', borderRadius: Tokens.radius.card, flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  tipText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.accent, lineHeight: 17, fontWeight: '500' as const },

  // ── Modals ───────────────────────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' as const },
  modalCard: {
    backgroundColor: t.surface, borderTopLeftRadius: Tokens.radius.panel, borderTopRightRadius: Tokens.radius.panel,
    padding: 20, gap: 10,
  },
  modalHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, gap: 12 },
  modalTitle: { flex: 1, fontSize: Type.body.fontSize, fontWeight: '700' as const, color: t.text },
  modalMeta: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19 },
  modalMetaStrong: { color: Colors.warningLabel, fontWeight: '700' as const },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.5, marginTop: 10 },
  modalInput: {
    backgroundColor: t.surfaceAlt, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: Type.body.fontSize, color: t.text,
  },
  modalHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 6 },
  inputRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 6 },
  inputSuffix: { fontSize: Type.footnote.fontSize, color: t.textSecondary, fontWeight: '600' as const },
  quickRow: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  quickChip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: Tokens.radius.sm, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line },
  quickChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  fullBtn: { paddingVertical: 11, paddingHorizontal: 16, borderRadius: Tokens.radius.md, backgroundColor: t.accent + '15' },
  fullBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },

  modeRow: { flexDirection: 'row' as const, gap: 8, marginTop: 12 },
  modeChip: { flex: 1, paddingVertical: 9, borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, alignItems: 'center' as const },
  modeChipOn: { backgroundColor: t.accent + '15', borderColor: t.accent + '55' },
  modeChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary },
  modeChipTextOn: { color: t.accent },

  previewBox: { marginTop: 14, padding: 12, borderRadius: Tokens.radius.card, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, gap: 4 },
  previewTitle: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 4 },
  previewRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 2, gap: 10 },
  previewLabel: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  previewValue: { fontSize: Type.caption1.fontSize, color: t.text, fontWeight: '600' as const },
  previewTotalRow: { borderTopWidth: 1, borderTopColor: t.line, marginTop: 6, paddingTop: 8 },
  previewLabelBold: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '700' as const },
  previewValueBold: { fontSize: Type.footnote.fontSize, color: Colors.warningLabel, fontWeight: '700' as const },
  previewWarn: { fontSize: Type.caption1.fontSize, color: Colors.warningLabel, lineHeight: 17, marginTop: 8 },
  previewFoot: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17, marginTop: 8 },

  modalSaveBtn: {
    // accentFill, not accent: white on the raw accent measures 2.87:1 and the
    // contrast guard fails the build on it (WCAG AA wants 4.5:1 for the label).
    marginTop: 14, paddingVertical: 14, borderRadius: Tokens.radius.md, backgroundColor: t.accentFill,
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
  },
  modalSaveBtnOff: { opacity: 0.45 },
  modalSaveBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: Colors.textOnAccent },

  sourcesLink: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 14, paddingVertical: 4 },
  sourcesLinkText: { fontSize: Type.caption1.fontSize, color: t.textSecondary, fontWeight: '600' as const, textDecorationLine: 'underline' as const },
  sourcesIntro: { fontSize: Type.footnote.fontSize, color: t.textSecondary, lineHeight: 19, marginBottom: 12 },
  sourceCard: { padding: 12, borderRadius: Tokens.radius.card, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, gap: 6, marginBottom: 10 },
  sourceAuthority: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.text },
  sourceSays: { fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },
  sourceLinkRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  sourceLinkText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.accent },
  sourceMeta: { fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },
  sourcesDisclaimer: { fontSize: Type.caption1.fontSize, color: t.textMuted, lineHeight: 17, marginTop: 4, marginBottom: 8 },
});
