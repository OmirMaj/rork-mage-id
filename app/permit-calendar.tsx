// permit-calendar.tsx — vision-doc feature P5.
//
// "A single calendar that owns every regulatory deadline across every
// project." Pre-fix the GC's permit deadlines lived as scattered fields
// on individual permit rows; missing one is a 4-12 week project delay.
// Compliance-hub already surfaces what's at-risk; this screen complements
// it with a CALENDAR (chronological timeline), not a LIST.
//
// Sources aggregated:
//   - Permit.expiresDate           (permit expires)
//   - Permit.inspectionDate        (inspection scheduled)
//   - Permit.appliedDate + 30d     (typical plan-examiner first-review window)
//   - DrawPeriod.periodEnd         (draw submission window closes)
//
// Grouped by month so the GC sees "12 deadlines in June, 4 in July."
// Each row taps to the source detail screen.
//
// Reminder escalation ladder (30d/14d/7d/3d/day-of) is a v1.1 follow-up
// — those need notify-edge-fn cron config + push token wiring. The
// substrate (notify edge fn, push_token in profiles) is already there.

import React, { useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Calendar, FileText, Clipboard, AlertTriangle, ChevronRight,
  CheckCircle2, Banknote, Building, ArrowDown,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useDrawPeriods } from '@/hooks/useDrawPeriods';
import EmptyState from '@/components/EmptyState';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { Permit, DrawPeriod } from '@/types';

type DeadlineKind = 'permit_expires' | 'permit_inspection' | 'permit_review_due' | 'draw_period_close';

interface Deadline {
  id: string;
  date: string;       // ISO
  kind: DeadlineKind;
  title: string;
  subtitle: string;
  projectId: string;
  projectName: string;
  /** Tap target — one of the existing detail routes. */
  routeTo: { pathname: string; params?: Record<string, string> };
  /** Hours of urgency: undefined = future, < 0 = past. */
  daysUntil: number;
}

const HORIZON_DAYS = 90;

function daysFromNow(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return Math.round((t - Date.now()) / 86_400_000);
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'Unknown';
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function deadlinesFromPermits(permits: Permit[]): Deadline[] {
  const out: Deadline[] = [];
  for (const p of permits) {
    if (p.status === 'inspection_passed' || p.status === 'expired') continue;

    if (p.inspectionDate && p.status === 'inspection_scheduled') {
      const days = daysFromNow(p.inspectionDate);
      if (days <= HORIZON_DAYS) {
        out.push({
          id: `${p.id}-inspection`,
          date: p.inspectionDate,
          kind: 'permit_inspection',
          title: `${p.type.charAt(0).toUpperCase() + p.type.slice(1)} inspection`,
          subtitle: p.permitNumber ? `Permit #${p.permitNumber}` : 'Inspection scheduled',
          projectId: p.projectId,
          projectName: p.projectName,
          routeTo: { pathname: '/permits', params: { id: p.id } },
          daysUntil: days,
        });
      }
    }

    if (p.expiresDate) {
      const days = daysFromNow(p.expiresDate);
      if (days <= HORIZON_DAYS && days >= -30) {
        out.push({
          id: `${p.id}-expires`,
          date: p.expiresDate,
          kind: 'permit_expires',
          title: `${p.type.charAt(0).toUpperCase() + p.type.slice(1)} permit expires`,
          subtitle: p.permitNumber ? `Permit #${p.permitNumber}` : 'Expires',
          projectId: p.projectId,
          projectName: p.projectName,
          routeTo: { pathname: '/permits', params: { id: p.id } },
          daysUntil: days,
        });
      }
    }

    // Plan-examiner first review typically lands ~30 days after `applied`.
    // Surface this as a soft milestone — gives the GC a "you should hear back
    // about this" expectation. Only for permits actively in review.
    if ((p.status === 'applied' || p.status === 'under_review') && p.appliedDate) {
      const reviewDue = new Date(Date.parse(p.appliedDate) + 30 * 86_400_000).toISOString();
      const days = daysFromNow(reviewDue);
      if (days <= HORIZON_DAYS && days >= -14) {
        out.push({
          id: `${p.id}-review-due`,
          date: reviewDue,
          kind: 'permit_review_due',
          title: `${p.type.charAt(0).toUpperCase() + p.type.slice(1)} review expected back`,
          subtitle: 'Plan examiner first-review window closes',
          projectId: p.projectId,
          projectName: p.projectName,
          routeTo: { pathname: '/permits', params: { id: p.id } },
          daysUntil: days,
        });
      }
    }
  }
  return out;
}

function deadlinesFromDraws(draws: DrawPeriod[]): Deadline[] {
  const out: Deadline[] = [];
  for (const d of draws) {
    if (d.status === 'closed' || d.status === 'funded') continue;
    if (!d.periodEnd) continue;
    const days = daysFromNow(d.periodEnd);
    if (days > HORIZON_DAYS || days < -7) continue;
    out.push({
      id: `${d.id}-draw-end`,
      date: d.periodEnd,
      kind: 'draw_period_close',
      title: `${d.label} — submit to lender`,
      subtitle: 'Draw period closes',
      projectId: d.projectId,
      projectName: '',
      routeTo: { pathname: '/draw-periods' },
      daysUntil: days,
    });
  }
  return out;
}

function tintFor(kind: DeadlineKind, daysUntil: number): string {
  if (daysUntil < 0) return Colors.error;
  if (daysUntil <= 3) return Colors.error;
  if (daysUntil <= 14) return Colors.warning;
  if (kind === 'draw_period_close') return Colors.success;
  return Colors.info;
}

function iconFor(kind: DeadlineKind) {
  if (kind === 'permit_inspection') return Clipboard;
  if (kind === 'permit_expires') return AlertTriangle;
  if (kind === 'permit_review_due') return FileText;
  if (kind === 'draw_period_close') return Banknote;
  return Calendar;
}

export default function PermitCalendarScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects, permits } = useProjects();
  const { draws } = useDrawPeriods();

  const projectName = useMemo(
    () => new Map(projects.map(p => [p.id, p.name])),
    [projects],
  );

  const allDeadlines = useMemo(() => {
    const fromPermits = deadlinesFromPermits(permits);
    const fromDraws = deadlinesFromDraws(draws).map(d => ({
      ...d,
      projectName: projectName.get(d.projectId) ?? '',
    }));
    const merged = [...fromPermits, ...fromDraws].sort(
      (a, b) => Date.parse(a.date) - Date.parse(b.date),
    );
    return merged;
  }, [permits, draws, projectName]);

  // Group by month for the timeline view.
  const grouped = useMemo(() => {
    const map = new Map<string, Deadline[]>();
    for (const d of allDeadlines) {
      const k = monthKey(d.date);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return Array.from(map.entries());
  }, [allDeadlines]);

  const overdueCount = useMemo(
    () => allDeadlines.filter(d => d.daysUntil < 0).length,
    [allDeadlines],
  );
  const next7DaysCount = useMemo(
    () => allDeadlines.filter(d => d.daysUntil >= 0 && d.daysUntil <= 7).length,
    [allDeadlines],
  );

  if (allDeadlines.length === 0) {
    return (
      <View style={styles.container}>
        <Stack.Screen
          options={{
            title: 'Permit calendar',
            headerStyle: { backgroundColor: Colors.background },
            headerTintColor: Colors.primary,
            headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
          }}
        />
        <EmptyState
          icon={<Calendar size={36} color={Colors.primary} strokeWidth={1.6} />}
          title="No regulatory deadlines on the loop"
          message="As you add permits and draw periods, every deadline lands on this calendar — inspections, plan-examiner returns, expiry dates, draw closes. Miss none of them."
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: 'Permit calendar',
          headerStyle: { backgroundColor: Colors.background },
          headerTintColor: Colors.primary,
          headerTitleStyle: { fontWeight: '700' as const, color: Colors.text },
        }}
      />
      <ScrollView
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>{allDeadlines.length} deadline{allDeadlines.length === 1 ? '' : 's'}</Text>
          <Text style={styles.heroSub}>
            Next {HORIZON_DAYS} days
            {overdueCount > 0 ? ` · ${overdueCount} overdue` : ''}
            {next7DaysCount > 0 ? ` · ${next7DaysCount} this week` : ''}
          </Text>
        </View>

        {/* Timeline by month */}
        {grouped.map(([month, deadlines]) => (
          <View key={month} style={styles.monthBlock}>
            <Text style={styles.monthHeader}>{month}</Text>
            <View style={styles.card}>
              {deadlines.map((d, idx) => {
                const tint = tintFor(d.kind, d.daysUntil);
                const Icon = iconFor(d.kind);
                const overdue = d.daysUntil < 0;
                const due = d.daysUntil <= 14 && d.daysUntil >= 0;
                return (
                  <TouchableOpacity
                    key={d.id}
                    style={[styles.row, idx < deadlines.length - 1 && styles.rowBorder]}
                    onPress={() => router.push({ pathname: d.routeTo.pathname as never, params: d.routeTo.params as never })}
                    activeOpacity={0.85}
                    testID={`deadline-${d.id}`}
                  >
                    <View style={styles.dateColumn}>
                      <Text style={[styles.dayName, overdue && { color: Colors.error }, due && { color: Colors.warning }]}>
                        {new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}
                      </Text>
                      <Text style={[styles.dayNumber, overdue && { color: Colors.error }, due && { color: Colors.warning }]}>
                        {new Date(d.date).getDate()}
                      </Text>
                    </View>
                    <View style={[styles.iconWrap, { backgroundColor: tint + '15' }]}>
                      <Icon size={14} color={tint} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle} numberOfLines={1}>{d.title}</Text>
                      <Text style={styles.rowSubMuted} numberOfLines={1}>
                        {d.projectName || 'Unknown project'}
                      </Text>
                      <Text style={[styles.rowStatus, { color: tint }]} numberOfLines={1}>
                        {overdue
                          ? `${Math.abs(d.daysUntil)}d overdue`
                          : d.daysUntil === 0 ? 'Today'
                          : d.daysUntil === 1 ? 'Tomorrow'
                          : `In ${d.daysUntil}d · ${dayLabel(d.date)}`}
                        {' · '}{d.subtitle}
                      </Text>
                    </View>
                    <ChevronRight size={14} color={Colors.textMuted} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        <View style={styles.footer}>
          <CheckCircle2 size={11} color={Colors.textMuted} />
          <Text style={styles.footerText}>
            Auto-escalating reminder ladder (30d/14d/7d/3d/day-of) lands in v1.1.
            Push tokens are already on file from your morning-digest setup.
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
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  heroTitle: {
    fontSize: Type.title2.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
  },
  heroSub: {
    fontSize: Type.footnote.fontSize,
    color: Colors.textMuted,
    marginTop: 4,
  },

  monthBlock: { marginBottom: 18 },
  monthHeader: {
    paddingHorizontal: 16,
    fontSize: Type.caption2.fontSize,
    fontWeight: '900' as const,
    color: Colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
    marginBottom: 8,
  },
  card: {
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    borderRadius: Tokens.radius.lg,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    overflow: 'hidden' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  dateColumn: {
    width: 36,
    alignItems: 'center' as const,
  },
  dayName: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: Colors.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  dayNumber: {
    fontSize: Type.title3.fontSize,
    fontWeight: '900' as const,
    color: Colors.text,
    letterSpacing: -0.4,
    marginTop: 1,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: Tokens.radius.sm,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rowTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  rowSubMuted: {
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    marginTop: 1,
  },
  rowStatus: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '600' as const,
    marginTop: 3,
  },

  footer: {
    flexDirection: 'row' as const,
    gap: 8,
    alignItems: 'flex-start' as const,
    paddingHorizontal: 18,
    paddingVertical: 16,
    opacity: 0.7,
  },
  footerText: {
    flex: 1,
    fontSize: Type.caption2.fontSize,
    color: Colors.textMuted,
    lineHeight: 14,
  },
});

void Building;
void ArrowDown;
