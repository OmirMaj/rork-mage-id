// NextStepHero — the answer to "where do I start?"
//
// The recurring user pain across three audits (pre-TestFlight UX,
// strategic, voice-of-customer) was "I don't know where to start."
// MAGE has ~30 destinations across the tab bar + Discover; on any given
// day the user only needs one of them. This component reads the
// project + invoice + portal + COI state, picks the single most-
// relevant action, and renders it as a one-tap CTA at the top of
// home, project-detail, and summary.
//
// Three-layer scaffolding strategy:
//   1. OnboardingChecklist (first week — already shipped) handles
//      the activation funnel: company info → project → estimate →
//      Stripe → invoice.
//   2. NextStepHero (this file) handles forever-after: each day,
//      what's the one thing the user should do?
//   3. Tutorial (separate, trimmed) is a 60-sec optional orientation.
//
// State priority — first match wins. Higher = more urgent / earlier:
//   - Past-due invoices > 30 days  ($X owed)
//   - Expiring COIs in next 7 days (compliance + lawsuit risk)
//   - Open RFIs > 7 days (architect blocking the schedule)
//   - Project with no scope yet
//   - Project with no estimate yet
//   - Project with no invoice ever sent
//   - All caught up → render nothing (don't be noise)
//
// Each card is one-tap: tap routes you to the action's screen. No
// modal-in-the-way pattern. No "learn more" — the action IS the
// instruction.

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Receipt, ShieldAlert, MessageSquareWarning,
  ClipboardEdit, Calculator, Send, ChevronRight,
  type LucideIcon,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { Project, Invoice, RFI, PrequalPacket, Subcontractor } from '@/types';
import { getEffectiveInvoiceStatus, getDaysPastDue } from '@/utils/projectFinancials';

export interface NextStepHeroProps {
  /** All projects the user owns. */
  projects: Project[];
  /** All invoices across all projects. */
  invoices: Invoice[];
  /** All RFIs across all projects. */
  rfis?: RFI[];
  /** All subs + their prequal packets (for COI expiry warnings). */
  subs?: Subcontractor[];
  prequalPackets?: PrequalPacket[];
  /**
   * Optional override — when rendered inside a single project (project-
   * detail), scope the suggestion to just that one. Falls back to
   * portfolio-wide otherwise.
   */
  scopeToProjectId?: string;
  /** Optional testID prefix for automation. */
  testID?: string;
}

interface NextStep {
  /** Stable id so AsyncStorage dismissal could dedupe (not yet used). */
  kind: string;
  /** Lead icon. */
  icon: LucideIcon;
  /** Tone — drives color (warn = orange, danger = red, info = blue, accent = orange). */
  tone: 'warn' | 'danger' | 'info' | 'accent' | 'success';
  /** Bold one-liner. */
  title: string;
  /** Smaller subtitle / reason. */
  body: string;
  /** CTA label. */
  cta: string;
  /** Tap → router.push this path (or an object with params). */
  href: string | { pathname: string; params?: Record<string, string | number | undefined> };
}

/** Compute the next step from current state. Returns null if all clear. */
function chooseNextStep(input: NextStepHeroProps): NextStep | null {
  const { projects, invoices, rfis = [], subs = [], prequalPackets = [], scopeToProjectId } = input;

  // Exclude the auto-seeded "Sample — …" demo projects from portfolio-wide
  // guidance. Pre-fix the very first thing a new user saw was "Add scope to
  // Sample — Sarah's Place" — the most-guided action aimed at throwaway
  // data. When scoped to one project (project-detail) we don't filter:
  // if you're on a sample's detail, its next step is legitimately useful.
  const sampleIds = new Set(
    projects.filter(p => p.name.startsWith('Sample — ')).map(p => p.id),
  );
  const realProjects = projects.filter(p => !sampleIds.has(p.id));
  const projScope = scopeToProjectId ? projects.filter(p => p.id === scopeToProjectId) : realProjects;
  const invScope = scopeToProjectId ? invoices.filter(i => i.projectId === scopeToProjectId) : invoices.filter(i => !sampleIds.has(i.projectId));
  const rfiScope = scopeToProjectId ? rfis.filter(r => r.projectId === scopeToProjectId) : rfis.filter(r => !sampleIds.has(r.projectId));

  // 1. Past-due invoices (>30 days). Highest urgency — actual revenue
  //    waiting for a tap on "send reminder".
  const overdueInvoices = invScope.filter(inv => {
    const eff = getEffectiveInvoiceStatus(inv);
    if (eff !== 'overdue') return false;
    const days = getDaysPastDue(inv);
    return days > 30;
  });
  if (overdueInvoices.length > 0) {
    const totalDue = overdueInvoices.reduce((acc, inv) => acc + (inv.totalDue - (inv.amountPaid ?? 0)), 0);
    const usd = totalDue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
    const first = overdueInvoices.sort((a, b) => getDaysPastDue(b) - getDaysPastDue(a))[0];
    return {
      kind: 'overdue_invoices',
      icon: Receipt,
      tone: 'danger',
      title: `${usd} past due across ${overdueInvoices.length} invoice${overdueInvoices.length === 1 ? '' : 's'}`,
      body: 'Send a friendly reminder — most owners pay within 48 hours of a nudge.',
      cta: 'Open the invoice',
      // invoice.tsx resolves the project via projectId (getProject), so
      // both params are required — invoiceId alone left the screen blank.
      href: { pathname: '/invoice', params: { projectId: first.projectId, invoiceId: first.id } },
    };
  }

  // 2. Expiring COIs (next 7 days). OSHA Multi-Employer Citation Policy
  //    treats the GC as a controlling employer; expired COIs can cost
  //    $16,550 per incident.
  if (subs.length > 0 && prequalPackets.length > 0) {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const expiringSoon = prequalPackets.filter(p => {
      if (!p.insurance?.coiExpiry) return false;
      const exp = new Date(p.insurance.coiExpiry).getTime();
      return !isNaN(exp) && exp - now > 0 && exp - now < sevenDaysMs;
    });
    if (expiringSoon.length > 0) {
      return {
        kind: 'coi_expiring',
        icon: ShieldAlert,
        tone: 'warn',
        title: `${expiringSoon.length} sub COI${expiringSoon.length === 1 ? '' : 's'} expire this week`,
        body: 'Expired COIs can cost $16,550 per OSHA citation. Send a renewal request now.',
        cta: 'Open prequal',
        href: '/prequal-manager',
      };
    }
  }

  // 3. Open RFIs awaiting response > 7 days. Schedule killers.
  const now = Date.now();
  const staleRfis = rfiScope.filter(r => {
    if (r.status === 'closed' || r.status === 'answered') return false;
    const created = new Date(r.dateSubmitted ?? Date.now()).getTime();
    return !isNaN(created) && now - created > 7 * 24 * 60 * 60 * 1000;
  });
  if (staleRfis.length > 0) {
    return {
      kind: 'stale_rfis',
      icon: MessageSquareWarning,
      tone: 'warn',
      title: `${staleRfis.length} RFI${staleRfis.length === 1 ? '' : 's'} waiting for an answer`,
      body: 'Stale RFIs delay the schedule. Auto-escalate to the architect with one tap.',
      cta: 'Review RFIs',
      // Deep-link straight to the project's RFI section via the new
      // ?tile= param — not the tile grid. Portfolio-wide falls back to
      // the RFI screen (its no-param state is the cross-project list).
      // Pre-fix this was '/rfi-log' — a route with no file, so the most
      // visible "where do I start" card dead-ended on not-found.
      href: scopeToProjectId
        ? { pathname: '/project-detail', params: { id: scopeToProjectId, tile: 'rfis' } }
        : '/rfi',
    };
  }

  // 4. Project with no scope yet. Fresh-project guidance — without a scope,
  //    the AI estimator + client portal can't produce useful output.
  const projectNoScope = projScope.find(p => !p.scope || (p.scope.scope ?? '').trim().length === 0);
  if (projectNoScope) {
    return {
      kind: 'project_no_scope',
      icon: ClipboardEdit,
      tone: 'accent',
      title: `Add scope to ${projectNoScope.name}`,
      body: 'A short scope unlocks AI estimates + client-portal copy. 2 minutes of typing saves an hour later.',
      cta: 'Add scope now',
      href: { pathname: '/project-scope', params: { id: projectNoScope.id } },
    };
  }

  // 5. Project with no estimate yet. Pre-revenue blocker.
  const projectNoEstimate = projScope.find(p => {
    const items = p.linkedEstimate?.items ?? [];
    return items.length === 0;
  });
  if (projectNoEstimate) {
    return {
      kind: 'project_no_estimate',
      icon: Calculator,
      tone: 'accent',
      title: `Build an estimate for ${projectNoEstimate.name}`,
      body: 'AI drafts a full line-item estimate from your scope. You edit, you send. Done in minutes.',
      cta: 'Open estimator',
      // Route to the project-aware estimate wizard so the new estimate
      // is linked to this project automatically.
      href: { pathname: '/estimate-wizard', params: { projectId: projectNoEstimate.id } },
    };
  }

  // 6. Project with no invoice yet. Revenue moment.
  const projectNoInvoice = projScope.find(p => {
    const projectInvoices = invoices.filter(i => i.projectId === p.id);
    return projectInvoices.length === 0;
  });
  if (projectNoInvoice) {
    return {
      kind: 'project_no_invoice',
      icon: Send,
      tone: 'success',
      title: `Send your first invoice for ${projectNoInvoice.name}`,
      body: 'Drop a deposit invoice or a progress bill. Pay button is auto-attached via Stripe.',
      cta: 'Create invoice',
      // invoice.tsx with just projectId opens the new-invoice screen for
      // this project directly — the actual next action.
      href: { pathname: '/invoice', params: { projectId: projectNoInvoice.id } },
    };
  }

  // 7. All caught up. Don't render — the calm view IS the reward. The
  //    home tab's project list takes over.
  return null;
}

export function NextStepHero(props: NextStepHeroProps) {
  const styles = useThemedStyles(makeStyles);
  const { colors } = useTheme();
  const router = useRouter();
  const step = useMemo(() => chooseNextStep(props), [props]);

  if (!step) return null;

  const toneToColor: Record<NextStep['tone'], string> = {
    danger: colors.danger,
    warn: Colors.warning,
    info: colors.info,
    accent: colors.accent,
    success: colors.success,
  };
  const accent = toneToColor[step.tone];
  const Icon = step.icon;

  const onPress = () => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (typeof step.href === 'string') {
      router.push(step.href as never);
    } else {
      router.push(step.href as never);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.root, { borderLeftColor: accent }]}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${step.title}. ${step.body}. ${step.cta}.`}
      testID={props.testID ?? `next-step-${step.kind}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: accent + '14' }]}>
        <Icon size={20} color={accent} />
      </View>
      <View style={styles.body}>
        <View style={styles.headerRow}>
          <View style={[styles.eyebrowDot, { backgroundColor: accent }]} />
          <Text style={[styles.eyebrow, { color: accent }]}>NEXT STEP</Text>
        </View>
        <Text style={styles.title} numberOfLines={2}>{step.title}</Text>
        <Text style={styles.bodyText} numberOfLines={3}>{step.body}</Text>
        <View style={styles.ctaRow}>
          <Text style={[styles.ctaText, { color: accent }]}>{step.cta}</Text>
          <ChevronRight size={14} color={accent} strokeWidth={1.75} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default NextStepHero;

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  root: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    paddingRight: 16,
    borderRadius: Tokens.radius.md,
    backgroundColor: c.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: c.line,
    borderLeftWidth: 3,
    marginHorizontal: 16,
    marginVertical: 12,
    // Subtle elevation so it visibly hovers above the project list
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 2,
  },
  body: { flex: 1, gap: 4 },
  headerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    marginBottom: 2,
  },
  eyebrowDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  eyebrow: {
    ...Type.caption2,
    fontWeight: '800' as const,
    letterSpacing: 0.8,
  },
  title: {
    ...Type.bodyCompactEmphasized,
    color: c.text,
  },
  bodyText: {
    ...Type.caption1,
    color: c.textSecondary,
    lineHeight: 17,
  },
  ctaRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 4,
  },
  ctaText: {
    ...Type.caption1,
    fontWeight: '700' as const,
  },
  // 'success' tone fallback — using `c.success` ensures dark-mode contrast.
  _placeholder: { color: c.success },
});
