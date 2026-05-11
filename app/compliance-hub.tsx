// compliance-hub.tsx — unified Compliance-as-a-Service rollup.
//
// Vision-doc feature #7. Pre-fix the GC had 4 separate screens:
//   - coi-vault (insurance)
//   - permits (DOB / building permits)
//   - tax-1099-export (year-end CPA prep)
//   - subs (where COI alerts hide on individual sub rows)
//
// One missed COI = $5K-$25K lawsuit exposure. One missed prevailing-
// wage filing = $50K+ DOL fine. Compliance failures are the #2
// reason small GCs go out of business (after cash flow). The
// existing screens cover the data model — what was missing is the
// aggregated "what's about to bite me" surface.
//
// This screen pulls from existing data sources (cois, permits) and
// composes a unified view:
//   - Header: "X compliance alerts" with health pill
//   - Insurance section: COIs whose earliest coverage.expiresAt is
//     within 60 days, sorted by closest to expiry
//   - Permits section: permits with expiresDate within 60 days OR
//     status in ('inspection_scheduled', 'inspection_failed', 'denied')
//   - 1099 export tile linking to existing screen
//
// Each row taps to the source detail screen so editing happens in
// the canonical place.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ShieldCheck, AlertTriangle, FileWarning, ChevronRight,
  CheckCircle2, FileText, Calendar, Clipboard, Building, FileBadge,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useContractorLicenses, type ContractorLicense } from '@/hooks/useContractorLicenses';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { CertificateOfInsurance, Permit, Subcontractor } from '@/types';

const SOON_DAYS = 60;
const URGENT_DAYS = 14;

interface COIAlert {
  coi: CertificateOfInsurance;
  sub: Subcontractor | undefined;
  earliestExpiresAt: string;
  daysUntil: number;
}

interface PermitAlert {
  permit: Permit;
  reason: 'expiring' | 'inspection_due' | 'inspection_failed' | 'denied';
  daysUntil?: number;
}

interface LicenseAlert {
  license: ContractorLicense;
  daysUntil: number;
}

function daysFromNow(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return Math.round((t - Date.now()) / 86_400_000);
}

function dateLabel(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ComplianceHubScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { cois, permits, subcontractors } = useProjects();
  const { licenses } = useContractorLicenses();

  const subById = useMemo(
    () => new Map(subcontractors.map(s => [s.id, s])),
    [subcontractors],
  );

  // Insurance alerts. A COI's effective expiry is the earliest
  // expiresAt across all its coverages — that's the date past which
  // the sub is uninsured for AT LEAST one line item.
  const coiAlerts = useMemo<COIAlert[]>(() => {
    const out: COIAlert[] = [];
    for (const coi of cois) {
      const expiries = (coi.coverages ?? [])
        .map(c => c.expiresAt)
        .filter((d): d is string => !!d);
      if (expiries.length === 0) continue;
      const earliest = expiries
        .map(d => Date.parse(d))
        .filter(t => Number.isFinite(t))
        .sort((a, b) => a - b)[0];
      if (!Number.isFinite(earliest)) continue;
      const daysUntil = Math.round((earliest - Date.now()) / 86_400_000);
      if (daysUntil > SOON_DAYS) continue;
      out.push({
        coi,
        sub: subById.get(coi.subcontractorId),
        earliestExpiresAt: new Date(earliest).toISOString(),
        daysUntil,
      });
    }
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [cois, subById]);

  // Permit alerts. Multiple reasons surface a permit:
  //   - expiresDate within 60 days
  //   - inspection_scheduled (the GC needs to be ready)
  //   - inspection_failed (re-inspection blocking work)
  //   - denied (filing rejected, needs response)
  const permitAlerts = useMemo<PermitAlert[]>(() => {
    const out: PermitAlert[] = [];
    for (const p of permits) {
      // Closed permits don't surface.
      if (p.status === 'inspection_passed' || p.status === 'expired') continue;
      if (p.status === 'denied') {
        out.push({ permit: p, reason: 'denied' });
        continue;
      }
      if (p.status === 'inspection_failed') {
        out.push({ permit: p, reason: 'inspection_failed' });
        continue;
      }
      if (p.status === 'inspection_scheduled' && p.inspectionDate) {
        const days = daysFromNow(p.inspectionDate);
        if (days <= SOON_DAYS) {
          out.push({ permit: p, reason: 'inspection_due', daysUntil: days });
          continue;
        }
      }
      if (p.expiresDate) {
        const days = daysFromNow(p.expiresDate);
        if (days <= SOON_DAYS) {
          out.push({ permit: p, reason: 'expiring', daysUntil: days });
        }
      }
    }
    return out.sort((a, b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999));
  }, [permits]);

  // License expiry alerts. Same SOON_DAYS / URGENT_DAYS thresholds.
  // Vision-doc #19: license expiry tracker. One missed renewal =
  // can't pull permits = entire schedule slips.
  const licenseAlerts = useMemo<LicenseAlert[]>(() => {
    const out: LicenseAlert[] = [];
    for (const lic of licenses) {
      const daysUntilExpiry = daysFromNow(lic.expiresDate);
      if (daysUntilExpiry > SOON_DAYS) continue;
      out.push({ license: lic, daysUntil: daysUntilExpiry });
    }
    return out.sort((a, b) => a.daysUntil - b.daysUntil);
  }, [licenses]);

  const totalAlerts = coiAlerts.length + permitAlerts.length + licenseAlerts.length;
  const urgentAlerts = coiAlerts.filter(a => a.daysUntil <= URGENT_DAYS).length
    + permitAlerts.filter(a => a.reason === 'denied' || a.reason === 'inspection_failed' || (a.daysUntil ?? 999) <= URGENT_DAYS).length
    + licenseAlerts.filter(a => a.daysUntil <= URGENT_DAYS).length;

  // Health pill: critical if anything is overdue or denied,
  // at-risk if any urgent (<=14d), good otherwise.
  const overdueCount = coiAlerts.filter(a => a.daysUntil < 0).length
    + permitAlerts.filter(a => a.reason === 'denied' || a.reason === 'inspection_failed').length
    + licenseAlerts.filter(a => a.daysUntil < 0).length;
  const health: 'good' | 'at_risk' | 'critical' =
    overdueCount > 0 ? 'critical'
    : urgentAlerts > 0 ? 'at_risk'
    : 'good';
  const healthColor =
    health === 'good' ? Colors.success
    : health === 'at_risk' ? Colors.warning
    : Colors.error;
  const healthLabel =
    health === 'good' ? 'Compliance healthy'
    : health === 'at_risk' ? 'Action needed soon'
    : 'Critical — overdue items';

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Compliance hub',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: Tokens.spacing.sm, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero — health pill + alert count */}
        <View style={styles.hero}>
          <View style={[styles.healthBadge, { backgroundColor: healthColor + '15', borderColor: healthColor }]}>
            {health === 'good'
              ? <CheckCircle2 size={14} color={healthColor} />
              : <AlertTriangle size={14} color={healthColor} />}
            <Text style={[styles.healthBadgeText, { color: healthColor }]}>
              {healthLabel}
            </Text>
          </View>
          <Text style={styles.heroCount}>
            {totalAlerts} alert{totalAlerts === 1 ? '' : 's'}
          </Text>
          <Text style={styles.heroSub}>
            {totalAlerts === 0
              ? 'Insurance, permits, and licenses are current. No action needed today.'
              : `${coiAlerts.length} insurance · ${permitAlerts.length} permit${permitAlerts.length === 1 ? '' : 's'} · ${licenseAlerts.length} license${licenseAlerts.length === 1 ? '' : 's'}`}
          </Text>
        </View>

        {/* Insurance */}
        <Text style={styles.sectionTitle}>Insurance (COIs)</Text>
        <Text style={styles.sectionDesc}>
          Sub COIs expiring in the next {SOON_DAYS} days. One uncovered claim = $5K-$25K exposure.
        </Text>
        <View style={styles.card}>
          {coiAlerts.length === 0 ? (
            <View style={styles.emptyRow}>
              <CheckCircle2 size={14} color={Colors.success} />
              <Text style={styles.emptyText}>All on file are current.</Text>
            </View>
          ) : (
            coiAlerts.map((alert, idx) => {
              const overdue = alert.daysUntil < 0;
              const urgent = alert.daysUntil <= URGENT_DAYS && alert.daysUntil >= 0;
              const tint = overdue ? Colors.error : urgent ? Colors.warning : Colors.info;
              return (
                <TouchableOpacity
                  key={alert.coi.id}
                  style={[styles.row, idx < coiAlerts.length - 1 && styles.rowBorder]}
                  onPress={() => router.push('/coi-vault' as never)}
                  activeOpacity={0.85}
                  testID={`coi-alert-${alert.coi.id}`}
                >
                  <View style={[styles.rowIconWrap, { backgroundColor: tint + '15' }]}>
                    <FileWarning size={14} color={tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {alert.sub?.companyName ?? 'Unknown sub'}
                    </Text>
                    <Text style={[styles.rowSub, { color: tint }]} numberOfLines={1}>
                      {overdue
                        ? `Expired ${Math.abs(alert.daysUntil)}d ago · ${dateLabel(alert.earliestExpiresAt)}`
                        : alert.daysUntil === 0
                        ? `Expires today · ${dateLabel(alert.earliestExpiresAt)}`
                        : `Expires in ${alert.daysUntil}d · ${dateLabel(alert.earliestExpiresAt)}`}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Permits */}
        <Text style={styles.sectionTitle}>Permits</Text>
        <Text style={styles.sectionDesc}>
          Permits expiring soon, denied filings, scheduled or failed inspections.
        </Text>
        <View style={styles.card}>
          {permitAlerts.length === 0 ? (
            <View style={styles.emptyRow}>
              <CheckCircle2 size={14} color={Colors.success} />
              <Text style={styles.emptyText}>No permit deadlines in the next 60 days.</Text>
            </View>
          ) : (
            permitAlerts.map((alert, idx) => {
              const reasonText =
                alert.reason === 'denied' ? 'Denied — needs response'
                : alert.reason === 'inspection_failed' ? 'Re-inspection needed'
                : alert.reason === 'inspection_due'
                ? alert.daysUntil != null && alert.daysUntil < 0
                  ? `Inspection ${Math.abs(alert.daysUntil)}d overdue`
                  : alert.daysUntil === 0
                  ? 'Inspection today'
                  : `Inspection in ${alert.daysUntil}d`
                : alert.daysUntil != null && alert.daysUntil < 0
                ? `Expired ${Math.abs(alert.daysUntil)}d ago`
                : alert.daysUntil === 0
                ? 'Expires today'
                : `Expires in ${alert.daysUntil}d`;
              const tint =
                alert.reason === 'denied' || alert.reason === 'inspection_failed'
                  ? Colors.error
                  : (alert.daysUntil ?? 999) <= URGENT_DAYS
                  ? Colors.warning
                  : Colors.info;
              const Icon =
                alert.reason === 'inspection_due' || alert.reason === 'inspection_failed'
                  ? Clipboard
                  : alert.reason === 'denied'
                  ? AlertTriangle
                  : Calendar;
              return (
                <TouchableOpacity
                  key={alert.permit.id}
                  style={[styles.row, idx < permitAlerts.length - 1 && styles.rowBorder]}
                  onPress={() => router.push({ pathname: '/permits' as never, params: { id: alert.permit.id } as never })}
                  activeOpacity={0.85}
                  testID={`permit-alert-${alert.permit.id}`}
                >
                  <View style={[styles.rowIconWrap, { backgroundColor: tint + '15' }]}>
                    <Icon size={14} color={tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {alert.permit.type.charAt(0).toUpperCase() + alert.permit.type.slice(1)} permit
                      {alert.permit.permitNumber ? ` · #${alert.permit.permitNumber}` : ''}
                    </Text>
                    <Text style={styles.rowSubMuted} numberOfLines={1}>
                      {alert.permit.projectName}
                    </Text>
                    <Text style={[styles.rowSub, { color: tint }]} numberOfLines={1}>
                      {reasonText}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Licenses — vision-doc #19. Same urgency model as COIs:
            overdue = error tint, urgent (<=14d) = warning, soon = info. */}
        <Text style={styles.sectionTitle}>Licenses</Text>
        <Text style={styles.sectionDesc}>
          Your DCWP, state contractor, electrical, plumbing licenses. One missed renewal = can't pull permits = schedule slip.
        </Text>
        <View style={styles.card}>
          {licenseAlerts.length === 0 ? (
            <TouchableOpacity
              style={styles.row}
              onPress={() => router.push('/licenses' as never)}
              activeOpacity={0.85}
            >
              <View style={[styles.rowIconWrap, { backgroundColor: Colors.success + '15' }]}>
                <CheckCircle2 size={14} color={Colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {licenses.length === 0 ? 'Add your first license' : 'All current'}
                </Text>
                <Text style={styles.rowSubMuted} numberOfLines={2}>
                  {licenses.length === 0
                    ? 'DCWP, state contractor, electrical, plumbing — track expiry here.'
                    : `${licenses.length} license${licenses.length === 1 ? '' : 's'} on file. None expiring in next 60 days.`}
                </Text>
              </View>
              <ChevronRight size={14} color={Colors.textMuted} />
            </TouchableOpacity>
          ) : (
            licenseAlerts.map((alert, idx) => {
              const overdue = alert.daysUntil < 0;
              const urgent = alert.daysUntil <= URGENT_DAYS && alert.daysUntil >= 0;
              const tint = overdue ? Colors.error : urgent ? Colors.warning : Colors.info;
              return (
                <TouchableOpacity
                  key={alert.license.id}
                  style={[styles.row, idx < licenseAlerts.length - 1 && styles.rowBorder]}
                  onPress={() => router.push('/licenses' as never)}
                  activeOpacity={0.85}
                  testID={`license-alert-${alert.license.id}`}
                >
                  <View style={[styles.rowIconWrap, { backgroundColor: tint + '15' }]}>
                    <FileBadge size={14} color={tint} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {alert.license.name}
                    </Text>
                    <Text style={styles.rowSubMuted} numberOfLines={1}>
                      {alert.license.jurisdiction}
                      {alert.license.licenseNumber ? ` · #${alert.license.licenseNumber}` : ''}
                    </Text>
                    <Text style={[styles.rowSub, { color: tint }]} numberOfLines={1}>
                      {overdue
                        ? `Expired ${Math.abs(alert.daysUntil)}d ago · ${dateLabel(alert.license.expiresDate)}`
                        : alert.daysUntil === 0
                        ? `Expires today · ${dateLabel(alert.license.expiresDate)}`
                        : `Expires in ${alert.daysUntil}d · ${dateLabel(alert.license.expiresDate)}`}
                    </Text>
                  </View>
                  <ChevronRight size={14} color={Colors.textMuted} />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* 1099 — link out to existing year-end export */}
        <Text style={styles.sectionTitle}>Year-end (1099-NEC)</Text>
        <Text style={styles.sectionDesc}>
          IRS requires Form 1099-NEC for any sub paid ≥ $600 in a calendar year.
        </Text>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push('/tax-1099-export' as never)}
            activeOpacity={0.85}
            testID="open-1099-export"
          >
            <View style={[styles.rowIconWrap, { backgroundColor: Colors.primary + '15' }]}>
              <FileText size={14} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Open 1099 export</Text>
              <Text style={styles.rowSubMuted} numberOfLines={2}>
                Year-end CSV ready for your CPA. Auto-flags subs paid ≥ $600 from your invoice + commitment data.
              </Text>
            </View>
            <ChevronRight size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Future-state hint — vision-doc framing */}
        <View style={styles.footerNote}>
          <ShieldCheck size={11} color={Colors.textMuted} />
          <Text style={styles.footerNoteText}>
            More compliance lanes (workers comp audit prep, prevailing wage, OSHA 300 log,
            license expiry tracking) come online in v1.1. The data is already in MAGE ID — surfacing them
            is the next pass.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  hero: {
    backgroundColor: Colors.surface,
    borderRadius: Tokens.radius.lg,
    marginHorizontal: Tokens.spacing.md,
    padding: Tokens.spacing.md,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    marginBottom: Tokens.spacing.xs,
  },
  healthBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.full,
    borderWidth: 1,
  },
  healthBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  heroCount: {
    fontSize: Type.title1.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.6,
    marginTop: 10,
  },
  heroSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textSecondary,
    marginTop: Tokens.spacing.xxs,
  },

  sectionTitle: {
    paddingHorizontal: Tokens.spacing.md,
    fontSize: Type.subheadline.fontSize,
    fontWeight: '800' as const,
    color: Colors.text,
    marginTop: 18,
    letterSpacing: -0.2,
  },
  sectionDesc: {
    paddingHorizontal: Tokens.spacing.md,
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginTop: Tokens.spacing.hairline,
    marginBottom: Tokens.spacing.xs,
    lineHeight: 17,
  },

  card: {
    backgroundColor: Colors.surface,
    marginHorizontal: Tokens.spacing.md,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: Tokens.spacing.sm,
    paddingHorizontal: 14,
    paddingVertical: Tokens.spacing.sm,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  rowIconWrap: {
    width: 30,
    height: 30,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginTop: 1,
  },
  rowTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  rowSub: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    marginTop: Tokens.spacing.hairline,
  },
  rowSubMuted: {
    fontSize: Type.caption1.fontSize,
    color: Colors.textMuted,
    marginTop: Tokens.spacing.hairline,
  },
  emptyRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: Tokens.spacing.xs,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  emptyText: {
    fontSize: Type.bodyCompact.fontSize,
    color: Colors.textSecondary,
  },

  footerNote: {
    flexDirection: 'row' as const,
    gap: Tokens.spacing.xs,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: Tokens.spacing.md,
    opacity: 0.7,
  },
  footerNoteText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});

void Building;
