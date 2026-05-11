// Tools tab — every cross-project workflow that used to clutter Summary.
//
// Summary is now ONLY a summary (portfolio KPIs + cash flow + reports CTA).
// The tools card that grew to 16 rows lives here, broken into themed
// sections with per-row semantic color so the screen has a pulse instead
// of being a wall of grey icons.
//
// Section order is intent-based, not alphabetical:
//   1. AI Hub        — the marquee features (Construction AI, Permit Q&A)
//   2. Decisions     — what's waiting on the GC to approve
//   3. Field & supply— what crews + suppliers + owners are doing
//   4. Money         — cash, draws, taxes, sales pipeline
//   5. Permits       — code, calendars, templates, expeditors, insurance
//   6. Reports       — daily field-report inbox

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Sparkles, Gavel, ShieldCheck, ListChecks, MessageSquare,
  Truck, Package, Banknote, Wallet, FileDown, UserPlus,
  FileWarning, Calendar, Building, Bookmark, Trophy, Users, Inbox,
  Wrench, HardHat, ClipboardCheck,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { NavRow, Card, Section, EmptyState } from '@/components/ui';
import { useProjects } from '@/contexts/ProjectContext';
import { useSubChangeRequests } from '@/hooks/useSubChangeRequests';
import { useDeliveryReceipts } from '@/hooks/useDeliveryReceipts';
import { useDrawPeriods } from '@/hooks/useDrawPeriods';
import { useOwnerSuppliedItems } from '@/hooks/useOwnerSuppliedItems';
import { useContractorLicenses } from '@/hooks/useContractorLicenses';
import { aggregateOpenActionItems } from '@/utils/oacActionItems';

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, changeOrders, rfis, oacMeetings, cois, permits } = useProjects();
  const { pendingCount: pendingSubChangeRequests } = useSubChangeRequests();
  const { receipts: deliveryReceipts } = useDeliveryReceipts();
  const { draws } = useDrawPeriods();
  const { items: ownerSuppliedItems } = useOwnerSuppliedItems();
  const { licenses } = useContractorLicenses();

  const hasProjects = projects.length > 0;

  const pendingApprovalCount = useMemo(() => {
    const co = changeOrders.filter(c =>
      c.status === 'submitted' || c.status === 'under_review' || c.status === 'revised',
    ).length;
    const openRfis = rfis.filter(r => r.status !== 'closed' && r.status !== 'answered').length;
    return co + openRfis;
  }, [changeOrders, rfis]);

  const openOACActionCount = useMemo(
    () => aggregateOpenActionItems({ meetings: oacMeetings, projects }).length,
    [oacMeetings, projects],
  );

  const recentDamagedDeliveries = useMemo(() => {
    const cutoff = Date.now() - 14 * 86_400_000;
    return deliveryReceipts.filter(r => {
      const t = Date.parse(r.date);
      return r.hasDamage && Number.isFinite(t) && t >= cutoff;
    }).length;
  }, [deliveryReceipts]);

  const activeDrawCount = useMemo(
    () => draws.filter(d => d.status === 'open' || d.status === 'submitted' || d.status === 'approved').length,
    [draws],
  );

  const atRiskOfciCount = useMemo(() => {
    const cutoff = Date.now() + 7 * 86_400_000;
    return ownerSuppliedItems.filter(i => {
      if (!i.needBy) return false;
      if (i.status === 'on_site' || i.status === 'installed' || i.status === 'cancelled') return false;
      const t = Date.parse(i.needBy);
      return Number.isFinite(t) && t <= cutoff;
    }).length;
  }, [ownerSuppliedItems]);

  const complianceAlertCount = useMemo(() => {
    const cutoff = Date.now() + 60 * 86_400_000;
    let count = 0;
    for (const coi of cois) {
      const expiries = (coi.coverages ?? [])
        .map(c => c.expiresAt)
        .filter((d): d is string => !!d)
        .map(d => Date.parse(d))
        .filter(t => Number.isFinite(t));
      if (expiries.length === 0) continue;
      const earliest = Math.min(...expiries);
      if (earliest <= cutoff) count++;
    }
    for (const p of permits) {
      if (p.status === 'inspection_passed' || p.status === 'expired') continue;
      if (p.status === 'denied' || p.status === 'inspection_failed') { count++; continue; }
      if (p.status === 'inspection_scheduled' && p.inspectionDate) {
        const t = Date.parse(p.inspectionDate);
        if (Number.isFinite(t) && t <= cutoff) { count++; continue; }
      }
      if (p.expiresDate) {
        const t = Date.parse(p.expiresDate);
        if (Number.isFinite(t) && t <= cutoff) count++;
      }
    }
    for (const lic of licenses) {
      const t = Date.parse(lic.expiresDate);
      if (Number.isFinite(t) && t <= cutoff) count++;
    }
    return count;
  }, [cois, permits, licenses]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.heading}>Tools</Text>
        <Text style={styles.subheading}>
          Every cross-project workflow in one place
        </Text>

        {/* AI Hub — the marquee features. Lives at the top so users
            tapping into Tools see what's new first. Construction AI is
            the home for the DOB code check + Permit Q&A; both share the
            violet tone so the AI category reads as one. */}
        <Section eyebrow="AI HUB" style={styles.sectionWrap}>
          <Card variant="flat" padding="none">
            <NavRow
              Icon={Sparkles}
              title="Construction AI"
              subtitle="DOB / building code check — describe a scope, see codes, permits & violations"
              tone="violet"
              onPress={() => router.push('/(tabs)/construction-ai' as never)}
              testID="tools-construction-ai"
            />
            <Divider />
            <NavRow
              Icon={Gavel}
              title="Permit Q&A agent"
              subtitle="172 sections · 8 metros · ask the code in plain English"
              badge="NEW"
              tone="amber"
              onPress={() => router.push('/permit-qa' as never)}
              testID="tools-permit-qa"
            />
          </Card>
        </Section>

        {/* Decisions — what's waiting for the GC to act on. Approvals
            first because it sits at the top of the decision-loop closer
            chain. */}
        {hasProjects && (
          <Section eyebrow="DECISIONS" style={styles.sectionWrap}>
            <Card variant="flat" padding="none">
              <NavRow
                Icon={ShieldCheck}
                title="Approvals"
                subtitle={pendingApprovalCount > 0
                  ? `${pendingApprovalCount} change order${pendingApprovalCount === 1 ? '' : 's'} / RFI${pendingApprovalCount === 1 ? '' : 's'} need a decision`
                  : 'Change orders, RFIs, bid awards across all projects'}
                tone="success"
                badge={pendingApprovalCount > 0 ? String(pendingApprovalCount) : undefined}
                onPress={() => router.push('/approvals' as never)}
                testID="tools-approvals"
              />
              <Divider />
              <NavRow
                Icon={ListChecks}
                title="OAC actions"
                subtitle={openOACActionCount > 0
                  ? `${openOACActionCount} open action item${openOACActionCount === 1 ? '' : 's'} from owner-architect meetings`
                  : 'Owner-architect meeting follow-ups'}
                tone="info"
                badge={openOACActionCount > 0 ? String(openOACActionCount) : undefined}
                onPress={() => router.push('/oac-actions' as never)}
                testID="tools-oac-actions"
              />
              <Divider />
              <NavRow
                Icon={MessageSquare}
                title="Sub change requests"
                subtitle={pendingSubChangeRequests > 0
                  ? `${pendingSubChangeRequests} request${pendingSubChangeRequests === 1 ? '' : 's'} from subs awaiting your review`
                  : 'Field-discovered scope from subcontractors'}
                tone="warning"
                badge={pendingSubChangeRequests > 0 ? String(pendingSubChangeRequests) : undefined}
                onPress={() => router.push('/sub-change-requests' as never)}
                testID="tools-sub-change-requests"
              />
            </Card>
          </Section>
        )}

        {/* Field & supply — what crews + suppliers + owners are doing. */}
        {hasProjects && (
          <Section eyebrow="FIELD & SUPPLY CHAIN" style={styles.sectionWrap}>
            <Card variant="flat" padding="none">
              <NavRow
                Icon={Truck}
                title="Deliveries"
                subtitle={recentDamagedDeliveries > 0
                  ? `${recentDamagedDeliveries} delivery${recentDamagedDeliveries === 1 ? '' : ' deliveries'} flagged for damage in last 14 days`
                  : `${deliveryReceipts.length} delivery receipt${deliveryReceipts.length === 1 ? '' : 's'} on file`}
                tone="teal"
                onPress={() => router.push('/delivery-receipts' as never)}
                testID="tools-deliveries"
              />
              <Divider />
              <NavRow
                Icon={Package}
                title="OFCI / OFOI"
                subtitle={atRiskOfciCount > 0
                  ? `${atRiskOfciCount} owner-supplied item${atRiskOfciCount === 1 ? '' : 's'} at risk this week`
                  : 'Track appliances, fixtures, and specialty items the homeowner sources'}
                tone="rose"
                badge={atRiskOfciCount > 0 ? String(atRiskOfciCount) : undefined}
                onPress={() => router.push('/owner-supplied' as never)}
                testID="tools-owner-supplied"
              />
            </Card>
          </Section>
        )}

        {/* Money — every cash-related workflow. Tones lean green/emerald
            so the category reads as "$" at a glance. */}
        <Section eyebrow="MONEY" style={styles.sectionWrap}>
          <Card variant="flat" padding="none">
            {hasProjects && (
              <>
                <NavRow
                  Icon={Banknote}
                  title="Draw periods"
                  subtitle={activeDrawCount > 0
                    ? `${activeDrawCount} draw${activeDrawCount === 1 ? '' : 's'} active or awaiting funding`
                    : 'Lender-facing rollup — invoices, lien waivers, AIA pay app'}
                  tone="emerald"
                  onPress={() => router.push('/draw-periods' as never)}
                  testID="tools-draw-periods"
                />
                <Divider />
                <NavRow
                  Icon={Wallet}
                  title="Cash flow"
                  subtitle="Multi-week forecast across all projects"
                  tone="primary"
                  onPress={() => router.push('/cash-flow' as never)}
                  testID="tools-cash-flow"
                />
                <Divider />
              </>
            )}
            <NavRow
              Icon={UserPlus}
              title="Pipeline"
              subtitle="Inquiries → qualified → proposal → won"
              tone="accent"
              onPress={() => router.push('/leads' as never)}
              testID="tools-pipeline"
            />
            <Divider />
            <NavRow
              Icon={Gavel}
              title="Buyout"
              subtitle="Sub package builder + bid award flow"
              tone="info"
              onPress={() => router.push('/buyout' as never)}
              testID="tools-buyout"
            />
            <Divider />
            <NavRow
              Icon={Trophy}
              title="Bid analytics"
              subtitle="Win rate, avg amounts, project-size breakdowns"
              tone="violet"
              onPress={() => router.push('/bid-analytics' as never)}
              testID="tools-bid-analytics"
            />
            <Divider />
            <NavRow
              Icon={FileDown}
              title="1099-NEC export"
              subtitle="Year-end CSV for your CPA — flags subs paid ≥ $600"
              tone="emerald"
              onPress={() => router.push('/tax-1099-export' as never)}
              testID="tools-tax-1099"
            />
          </Card>
        </Section>

        {/* Safety & QC — OSHA defensibility + preventive trade
            checks. Sits above Permits because these are the daily
            workflows; permits are upstream of execution. */}
        <Section eyebrow="SAFETY & QC" style={styles.sectionWrap}>
          <Card variant="flat" padding="none">
            <NavRow
              Icon={HardHat}
              title="Safety"
              subtitle="Toolbox talks · incident log · OSHA 300A summary"
              tone="warning"
              onPress={() => router.push('/safety' as never)}
              testID="tools-safety"
            />
            <Divider />
            <NavRow
              Icon={ClipboardCheck}
              title="QC Checklists"
              subtitle="Pre-pour, pre-rock, rough electrical & more — templated"
              tone="amber"
              onPress={() => router.push('/qc-checklists' as never)}
              testID="tools-qc"
            />
          </Card>
        </Section>

        {/* Permits & compliance — the regulatory side. Amber dominates
            (code/permits) with red for compliance risk and indigo for
            insurance, rose for the people directory. */}
        <Section eyebrow="PERMITS & COMPLIANCE" style={styles.sectionWrap}>
          <Card variant="flat" padding="none">
            {hasProjects && (
              <>
                <NavRow
                  Icon={FileWarning}
                  title="Compliance hub"
                  subtitle={complianceAlertCount > 0
                    ? `${complianceAlertCount} alert${complianceAlertCount === 1 ? '' : 's'} — COI / permit / license expiry`
                    : 'Insurance, permits, licenses — all current'}
                  tone={complianceAlertCount > 0 ? 'error' : 'success'}
                  badge={complianceAlertCount > 0 ? String(complianceAlertCount) : undefined}
                  onPress={() => router.push('/compliance-hub' as never)}
                  testID="tools-compliance-hub"
                />
                <Divider />
                <NavRow
                  Icon={Calendar}
                  title="Permit calendar"
                  subtitle="Every regulatory deadline across every project"
                  tone="amber"
                  onPress={() => router.push('/permit-calendar' as never)}
                  testID="tools-permit-calendar"
                />
                <Divider />
              </>
            )}
            <NavRow
              Icon={Building}
              title="Permit leads"
              subtitle="Public bids and permit filings near you"
              tone="sky"
              onPress={() => router.push('/permit-leads' as never)}
              testID="tools-permit-leads"
            />
            {hasProjects && (
              <>
                <Divider />
                <NavRow
                  Icon={Bookmark}
                  title="Permit templates"
                  subtitle="Reusable filing patterns — file in 30 min instead of 6 hours"
                  tone="amber"
                  onPress={() => router.push('/permit-templates' as never)}
                  testID="tools-permit-templates"
                />
                <Divider />
                <NavRow
                  Icon={ShieldCheck}
                  title="Insurance claim package"
                  subtitle="Bundle photos + DFRs + punch items for an adjuster in one click"
                  tone="indigo"
                  onPress={() => router.push('/insurance-claim' as never)}
                  testID="tools-insurance-claim"
                />
              </>
            )}
            <Divider />
            <NavRow
              Icon={Users}
              title="Expeditors / PEs / RAs"
              subtitle="Verified directory with one-tap quote requests"
              tone="rose"
              onPress={() => router.push('/expeditor-directory' as never)}
              testID="tools-expeditor-directory"
            />
          </Card>
        </Section>

        {/* Reporting — the daily field-report inbox. Future home for
            other "what came in today" digests too. */}
        {hasProjects && (
          <Section eyebrow="REPORTING" style={styles.sectionWrap}>
            <Card variant="flat" padding="none">
              <NavRow
                Icon={Inbox}
                title="Reports inbox"
                subtitle="Daily field reports waiting for review"
                tone="info"
                onPress={() => router.push('/report-inbox' as never)}
                testID="tools-reports-inbox"
              />
            </Card>
          </Section>
        )}

        {!hasProjects && (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon={<Wrench size={32} color={Colors.primary} />}
              title="More tools unlock with projects"
              message="A handful of project-aware tools (Approvals, Compliance hub, Deliveries, Permit calendar) light up once you create your first project."
              actionLabel="Open Projects"
              onAction={() => router.push('/(tabs)/(home)' as never)}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// Divider — thin hairline between NavRows inside a Card. iOS-Settings
// style: indented from the left so it doesn't run under the icon column.
function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  heading: {
    ...Type.display,
    color: Colors.ink,
    paddingHorizontal: Tokens.spacing.lg,
    marginBottom: Tokens.spacing.xxs,
  },
  subheading: {
    ...Type.subhead,
    color: Colors.textSecondary,
    paddingHorizontal: Tokens.spacing.lg,
    marginBottom: Tokens.spacing.md,
  },
  // Outer wrap around each <Section> — provides the top gap + horizontal
  // gutter. Section primitive doesn't own outer spacing on purpose.
  sectionWrap: {
    marginTop: Tokens.spacing.sm,
    paddingHorizontal: Tokens.spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.borderLight,
    marginLeft: Tokens.spacing['4xl'], // align with NavRow text (after icon column)
  },
  emptyWrap: {
    marginTop: Tokens.spacing.md,
    paddingHorizontal: Tokens.spacing.md,
  },
});
