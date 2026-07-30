// components/passport/HomePassportCard.tsx
//
// The homeowner's Home Passport — the permanent record of THEIR house.
// Presentational only: it renders a ConsumerPassport built by the pure engine
// at utils/passport/consumerPassport.ts (tested by
// scripts/validate-home-passport-consumer.ts).
//
// HOMEOWNER-FACING. The engine guarantees no contractor cost / markup / margin
// reaches this component, and this file must never reintroduce one. The only
// money it can render is the owner's own payment record — and even that is
// behind `showPayments` so a surface can hide it.

import React, { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  House, ShieldCheck, FileCheck2, Package, CalendarClock, HardHat, ScrollText,
  AlertTriangle, MapPin, BadgeCheck, Share2, Clock, Camera, type LucideIcon,
} from 'lucide-react-native';
import type { ThemeColors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { formatMoney } from '@/utils/formatters';
import { PassportSection, PassportRow } from '@/components/passport/PassportSection';
import type {
  ConsumerPassport, PassportAlert, PassportContractorRole, WarrantyState,
} from '@/utils/passport/consumerPassport';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-05-20" -> "May 20, 2026". Timezone-free: never re-parses through Date. */
function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return '';
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return '';
  return `${MONTHS[mi]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

function fmtYear(iso: string | null | undefined): string {
  const m = /^(\d{4})/.exec(iso ?? '');
  return m ? m[1] : '';
}

/** Human countdown for a signed day delta. */
function fmtDays(days: number | null): string {
  if (days == null) return 'Not scheduled';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Due today';
  if (days < 45) return `${days}d left`;
  if (days < 365) return `${Math.round(days / 30)}mo left`;
  return `${Math.floor(days / 365)}y left`;
}

const WARRANTY_TONE: Record<WarrantyState, 'good' | 'warn' | 'bad' | 'neutral'> = {
  active: 'good',
  expiring_soon: 'warn',
  expired: 'bad',
  unknown: 'neutral',
};

const ROLE_LABEL: Record<PassportContractorRole, string> = {
  general_contractor: 'General contractor',
  trade: 'Trade',
  supplier: 'Supplier',
};

function Stat({
  icon: Icon,
  value,
  label,
  styles,
  tint,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  styles: ReturnType<typeof makeStyles>;
  tint: string;
}) {
  return (
    <View style={styles.stat}>
      <Icon size={Tokens.iconSize.small.size} color={tint} strokeWidth={2} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
    </View>
  );
}

function AlertRow({
  alert,
  styles,
  colors: t,
}: {
  alert: PassportAlert;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}) {
  const high = alert.severity === 'high';
  const fg = high ? t.dangerLabel : t.warningLabel;
  const bg = high ? t.dangerSoft : t.warningSoft;
  return (
    <View style={[styles.alertRow, { backgroundColor: bg }]}>
      {high ? (
        <AlertTriangle size={Tokens.iconSize.small.size} color={fg} strokeWidth={2} />
      ) : (
        <Clock size={Tokens.iconSize.small.size} color={fg} strokeWidth={2} />
      )}
      <View style={styles.alertText}>
        <Text style={[styles.alertTitle, { color: fg }]} numberOfLines={1}>{alert.title}</Text>
        <Text style={styles.alertDetail} numberOfLines={1}>{alert.detail}</Text>
      </View>
      <Text style={[styles.alertDays, { color: fg }]}>{fmtDays(alert.daysOut)}</Text>
    </View>
  );
}

export function HomePassportCard({
  passport,
  maxPerSection = 4,
  maxAlerts = 3,
  showPayments = true,
  onShare,
  onPressProject,
}: {
  passport: ConsumerPassport;
  /** Rows rendered per section before the "+N more" trailer. */
  maxPerSection?: number;
  maxAlerts?: number;
  /** Hide the owner's own spend (e.g. a shared/printed copy). */
  showPayments?: boolean;
  /** Renders the "share with your next contractor" action when provided. */
  onShare?: () => void;
  onPressProject?: (projectId: string) => void;
}) {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { home, stats } = passport;

  const alerts = useMemo(() => passport.alerts.slice(0, maxAlerts), [passport.alerts, maxAlerts]);
  const more = (total: number) => (total > maxPerSection ? `+${total - maxPerSection} more on record` : undefined);

  return (
    <View style={styles.wrap}>
      {/* ── Identity: this is YOUR home ─────────────────────────────── */}
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <House size={Tokens.iconSize.large.size} color={t.accent} strokeWidth={2} />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.eyebrow}>Home Passport</Text>
          <Text style={styles.address} numberOfLines={2}>
            {home.address || 'Your home'}
          </Text>
          <View style={styles.heroMetaRow}>
            <MapPin size={Tokens.iconSize.micro.size} color={t.textMuted} strokeWidth={2} />
            <Text style={styles.heroMeta} numberOfLines={1}>
              {[
                home.onRecordSince ? `On record since ${fmtYear(home.onRecordSince)}` : null,
                `${stats.completedProjectCount} completed project${stats.completedProjectCount === 1 ? '' : 's'}`,
                `${stats.contractorCount} contractor${stats.contractorCount === 1 ? '' : 's'}`,
              ].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
        </View>
      </View>

      <Text style={styles.ownership}>
        This record belongs to you. It stays with the house no matter who does the next job.
      </Text>

      {/* ── Needs attention ─────────────────────────────────────────── */}
      {alerts.length > 0 ? (
        <View style={styles.alerts}>
          {alerts.map((a) => (
            <AlertRow key={a.id} alert={a} styles={styles} colors={t} />
          ))}
          {passport.alerts.length > alerts.length ? (
            <Text style={styles.alertMore}>
              +{passport.alerts.length - alerts.length} more need attention
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* ── At a glance ─────────────────────────────────────────────── */}
      <View style={styles.statGrid}>
        <Stat icon={ShieldCheck} value={String(stats.activeWarranties)} label="Warranties in force" styles={styles} tint={t.success} />
        <Stat icon={FileCheck2} value={`${stats.finaledPermits}/${stats.permitCount}`} label="Permits finaled" styles={styles} tint={t.accent} />
        <Stat icon={Package} value={String(stats.equipmentCount)} label="Equipment logged" styles={styles} tint={t.info} />
        <Stat icon={ScrollText} value={String(stats.documentCount)} label="Documents kept" styles={styles} tint={t.textSecondary} />
      </View>

      {/* ── Projects ────────────────────────────────────────────────── */}
      <PassportSection
        title="Work done on this home"
        icon={HardHat}
        count={passport.projects.length}
        emptyLabel="No projects on record yet."
        moreLabel={more(passport.projects.length)}
      >
        {passport.projects.slice(0, maxPerSection).map((p) => {
          const detail = [
            p.contractorName,
            p.completedOn ? `Completed ${fmtDate(p.completedOn)}` : 'In progress',
          ].filter(Boolean).join('  ·  ');
          const row = (
            <PassportRow
              label={p.name}
              detail={detail}
              trailing={showPayments && p.amountPaid > 0 ? `${formatMoney(p.amountPaid)} paid` : undefined}
              trailingTone="neutral"
            />
          );
          return onPressProject ? (
            <Pressable
              key={p.id}
              onPress={() => onPressProject(p.id)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${p.name}`}
              testID={`passport-project-${p.id}`}
              style={({ pressed }) => (pressed ? styles.pressed : undefined)}
            >
              {row}
            </Pressable>
          ) : (
            <View key={p.id}>{row}</View>
          );
        })}
      </PassportSection>

      {/* ── Warranties ──────────────────────────────────────────────── */}
      <PassportSection
        title="Warranties"
        icon={ShieldCheck}
        count={passport.warranties.length}
        emptyLabel="No warranties on record yet."
        moreLabel={more(passport.warranties.length)}
      >
        {passport.warranties.slice(0, maxPerSection).map((w) => (
          <PassportRow
            key={w.id}
            label={w.title}
            detail={[w.provider, w.endDate ? `Ends ${fmtDate(w.endDate)}` : null].filter(Boolean).join('  ·  ')}
            trailing={w.state === 'expired' ? 'Expired' : fmtDays(w.daysRemaining)}
            trailingTone={WARRANTY_TONE[w.state]}
          />
        ))}
      </PassportSection>

      {/* ── Equipment & appliances ──────────────────────────────────── */}
      <PassportSection
        title="Equipment & appliances"
        icon={Package}
        count={passport.equipment.length}
        emptyLabel="No equipment logged yet."
        moreLabel={more(passport.equipment.length)}
      >
        {passport.equipment.slice(0, maxPerSection).map((e) => (
          <PassportRow
            key={e.id}
            label={e.name}
            detail={[e.brand, e.location, e.installedOn ? `Installed ${fmtDate(e.installedOn)}` : null]
              .filter(Boolean).join('  ·  ')}
            trailing={e.modelNumber ? `Model ${e.modelNumber}` : undefined}
            trailingTone="neutral"
          />
        ))}
      </PassportSection>

      {/* ── Permits ─────────────────────────────────────────────────── */}
      <PassportSection
        title="Permits"
        icon={FileCheck2}
        count={passport.permits.length}
        emptyLabel="No permits on record yet."
        moreLabel={more(passport.permits.length)}
      >
        {passport.permits.slice(0, maxPerSection).map((p) => (
          <PassportRow
            key={p.id}
            label={[p.type, p.permitNumber].filter(Boolean).join(' ')}
            detail={[p.jurisdiction, p.approvedDate ? `Approved ${fmtDate(p.approvedDate)}` : null]
              .filter(Boolean).join('  ·  ')}
            trailing={p.isFinaled ? 'Finaled' : 'Open'}
            trailingTone={p.isFinaled ? 'good' : 'warn'}
            icon={p.isFinaled ? BadgeCheck : undefined}
          />
        ))}
      </PassportSection>

      {/* ── Maintenance ─────────────────────────────────────────────── */}
      <PassportSection
        title="Maintenance schedule"
        icon={CalendarClock}
        count={passport.maintenance.length}
        emptyLabel="No maintenance schedule yet."
        moreLabel={more(passport.maintenance.length)}
      >
        {passport.maintenance.slice(0, maxPerSection).map((m) => (
          <PassportRow
            key={m.id}
            label={m.task}
            detail={[m.frequency, m.nextDueDate ? `Next ${fmtDate(m.nextDueDate)}` : null]
              .filter(Boolean).join('  ·  ')}
            trailing={fmtDays(m.daysUntilDue)}
            trailingTone={m.state === 'overdue' ? 'bad' : m.state === 'due_soon' ? 'warn' : 'neutral'}
          />
        ))}
      </PassportSection>

      {/* ── Who did the work ────────────────────────────────────────── */}
      <PassportSection
        title="Who worked on this home"
        icon={HardHat}
        count={passport.contractors.length}
        emptyLabel="No contractors on record yet."
        moreLabel={more(passport.contractors.length)}
      >
        {passport.contractors.slice(0, maxPerSection).map((c) => (
          <PassportRow
            key={c.id}
            label={c.companyName}
            detail={[c.trade ?? ROLE_LABEL[c.role], c.phone, c.licenseNumber ? `Lic. ${c.licenseNumber}` : null]
              .filter(Boolean).join('  ·  ')}
            trailing={c.projectIds.length > 1 ? `${c.projectIds.length} jobs` : undefined}
            trailingTone="neutral"
          />
        ))}
      </PassportSection>

      {/* ── Documents & photos ──────────────────────────────────────── */}
      <PassportSection
        title="Documents & photos"
        icon={ScrollText}
        count={passport.documents.length}
        emptyLabel="No documents on record yet."
        moreLabel={more(passport.documents.length)}
      >
        {passport.documents.slice(0, maxPerSection).map((d) => (
          <PassportRow
            key={d.id}
            label={d.title}
            detail={[d.projectName, d.date ? fmtDate(d.date) : null].filter(Boolean).join('  ·  ')}
            icon={d.kind === 'photo' ? Camera : ScrollText}
          />
        ))}
      </PassportSection>

      {/* ── Owner's own record ──────────────────────────────────────── */}
      {showPayments && stats.totalPaid > 0 ? (
        <View style={styles.paidRow}>
          <Text style={styles.paidLabel}>Invested in this home to date</Text>
          <Text style={styles.paidValue}>{formatMoney(stats.totalPaid)}</Text>
        </View>
      ) : null}

      {/* ── The wedge ───────────────────────────────────────────────── */}
      {onShare ? (
        <Pressable
          onPress={onShare}
          accessibilityRole="button"
          accessibilityLabel="Share this home passport with a contractor"
          testID="passport-share"
          style={({ pressed }) => [styles.shareBtn, pressed ? styles.pressed : null]}
        >
          <Share2 size={Tokens.iconSize.small.size} color={t.accent} strokeWidth={2} />
          <Text style={styles.shareText}>Share with your next contractor</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: Tokens.spacing.md, paddingBottom: Tokens.spacing.lg },
    pressed: { opacity: 0.6 },

    hero: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.sm,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.panel,
      ...Tokens.continuousCorners,
      padding: Tokens.spacing.md,
    },
    heroIcon: {
      width: 48,
      height: 48,
      borderRadius: Tokens.radius.card,
      ...Tokens.continuousCorners,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.accentSoft,
    },
    heroText: { flex: 1, gap: 2 },
    eyebrow: {
      ...Type.caption2,
      color: t.accentLabel,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      fontWeight: '700',
    },
    address: { ...Type.title3, color: t.text },
    heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xxs, marginTop: 2 },
    heroMeta: { ...Type.caption1, color: t.textSecondary, flex: 1 },

    ownership: {
      ...Type.caption1,
      color: t.textSecondary,
      paddingHorizontal: Tokens.spacing.xxs,
      paddingVertical: Tokens.spacing.xs,
    },

    alerts: { gap: Tokens.spacing.xxs + 2, marginBottom: Tokens.spacing.sm },
    alertRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Tokens.spacing.xs,
      padding: Tokens.spacing.sm,
      borderRadius: Tokens.radius.md,
      ...Tokens.continuousCorners,
    },
    alertText: { flex: 1, gap: 1 },
    alertTitle: { ...Type.footnoteEmphasized },
    alertDetail: { ...Type.caption1, color: t.textSecondary },
    alertDays: { ...Type.caption2, fontWeight: '700' },
    alertMore: { ...Type.caption1, color: t.textMuted, paddingHorizontal: Tokens.spacing.xxs },

    statGrid: {
      flexDirection: 'row',
      gap: Tokens.spacing.xs,
      marginBottom: Tokens.spacing.sm,
    },
    stat: {
      flex: 1,
      gap: 2,
      alignItems: 'flex-start',
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.line,
      borderRadius: Tokens.radius.card,
      ...Tokens.continuousCorners,
      paddingVertical: Tokens.spacing.sm,
      paddingHorizontal: Tokens.spacing.xs,
    },
    statValue: { ...Type.title3, color: t.text, fontVariant: ['tabular-nums'] },
    statLabel: { ...Type.caption2, color: t.textSecondary },

    paidRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: t.surfaceAlt,
      borderRadius: Tokens.radius.md,
      ...Tokens.continuousCorners,
      paddingVertical: Tokens.spacing.sm,
      paddingHorizontal: Tokens.spacing.sm,
      marginBottom: Tokens.spacing.sm,
    },
    paidLabel: { ...Type.footnote, color: t.textSecondary },
    paidValue: { ...Type.subheadEmphasized, color: t.text, fontVariant: ['tabular-nums'] },

    shareBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Tokens.spacing.xs,
      minHeight: Tokens.touchTarget.min,
      paddingHorizontal: Tokens.spacing.md,
      borderRadius: Tokens.radius.md,
      ...Tokens.continuousCorners,
      borderWidth: 1,
      borderColor: t.accentSoft,
      backgroundColor: t.accentSoft,
    },
    shareText: { ...Type.footnoteEmphasized, color: t.accentLabel },
  });

export default HomePassportCard;
