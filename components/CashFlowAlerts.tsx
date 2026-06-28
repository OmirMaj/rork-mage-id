import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { AlertTriangle, TrendingUp, Clock, X, ChevronRight } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatCurrency } from '@/utils/cashFlowEngine';
import type { Invoice } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';

export interface CashFlowAlert {
  id: string;
  type: 'critical' | 'warning' | 'positive' | 'payment_due' | 'overdue';
  title: string;
  message: string;
  actionLabel?: string;
}

interface CashFlowAlertsProps {
  forecast: CashFlowWeek[] | null;
  invoices: Invoice[];
}

function generateAlerts(forecast: CashFlowWeek[] | null, invoices: Invoice[]): CashFlowAlert[] {
  const alerts: CashFlowAlert[] = [];
  const now = new Date();

  if (forecast && forecast.length > 0) {
    const negativeWeeks = forecast.filter((w, i) => w.runningBalance < 0 && i < 6);
    if (negativeWeeks.length > 0) {
      const first = negativeWeeks[0];
      const weekIdx = forecast.indexOf(first);
      const weeksAway = weekIdx + 1;
      alerts.push({
        id: `critical-${first.weekStart}`,
        type: 'critical',
        title: `Balance goes negative in ${weeksAway} week${weeksAway > 1 ? 's' : ''}`,
        message: `Projected ${formatCurrency(first.runningBalance)} on ${new Date(first.weekStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}. Open Cash Flow to see solutions.`,
        actionLabel: 'View Forecast',
      });
    }

    const lowWeeks = forecast.filter((w, i) => w.runningBalance > 0 && w.runningBalance < 5000 && i < 8);
    if (lowWeeks.length > 0 && negativeWeeks.length === 0) {
      const first = lowWeeks[0];
      const weekIdx = forecast.indexOf(first);
      alerts.push({
        id: `warning-${first.weekStart}`,
        type: 'warning',
        title: `Low balance in ${weekIdx + 1} weeks`,
        message: `Balance will drop to ${formatCurrency(first.runningBalance)}. Consider invoicing early.`,
        actionLabel: 'View Forecast',
      });
    }

    const allPositive = forecast.slice(0, 4).every(w => w.runningBalance > 10000);
    if (allPositive && forecast.length > 0) {
      alerts.push({
        id: 'positive-outlook',
        type: 'positive',
        title: 'Strong cash position',
        message: 'Good time to invest in materials or take on new projects.',
      });
    }
  }

  invoices.forEach(inv => {
    if (inv.status === 'paid') return;
    const due = new Date(inv.dueDate);
    const remaining = inv.totalDue - inv.amountPaid;
    if (remaining <= 0) return;

    const diffDays = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays > 0) {
      alerts.push({
        id: `overdue-${inv.id}`,
        type: 'overdue',
        title: `Invoice #${inv.number} is ${diffDays} days overdue`,
        message: `${formatCurrency(remaining)} outstanding. Send a reminder.`,
        actionLabel: 'View Invoice',
      });
    } else if (diffDays >= -1 && diffDays <= 0) {
      alerts.push({
        id: `due-${inv.id}`,
        type: 'payment_due',
        title: `Invoice #${inv.number} due today`,
        message: `${formatCurrency(remaining)} payment expected. Follow up with client.`,
      });
    }
  });

  return alerts.slice(0, 3);
}

function getAlertConfig(t: ThemeColors, type: CashFlowAlert['type']) {
  switch (type) {
    case 'critical':
    case 'overdue':
      return { bg: t.danger + '1F', border: t.danger + '40', iconColor: t.danger, icon: type === 'overdue' ? Clock : AlertTriangle };
    case 'warning':
      return { bg: t.accentSoft, border: t.accent + '40', iconColor: t.accentLabel, icon: AlertTriangle };
    case 'positive':
      return { bg: t.successSoft, border: t.success + '40', iconColor: t.success, icon: TrendingUp };
    case 'payment_due':
      return { bg: t.info + '1F', border: t.info + '40', iconColor: t.info, icon: Clock };
  }
}

interface AlertCardProps {
  alert: CashFlowAlert;
  onDismiss: (id: string) => void;
  onAction: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

const AlertCard = React.memo(function AlertCard({
  alert, onDismiss, onAction, styles, colors,
}: AlertCardProps) {
  const config = getAlertConfig(colors, alert.type);
  const IconComponent = config.icon;

  return (
    <View style={[styles.alertCard, { backgroundColor: config.bg, borderColor: config.border }]}>
      <View style={styles.alertTop}>
        <IconComponent size={18} color={config.iconColor} />
        <Text style={[styles.alertTitle, { color: config.iconColor }]} numberOfLines={1}>
          {alert.title}
        </Text>
        <TouchableOpacity onPress={() => onDismiss(alert.id)} style={styles.dismissBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityRole="button" accessibilityLabel="Close">
          <X size={14} color={colors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
      <Text style={styles.alertMessage} numberOfLines={2}>{alert.message}</Text>
      {alert.actionLabel && (
        <TouchableOpacity style={styles.alertAction} onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.alertActionText, { color: config.iconColor }]}>{alert.actionLabel}</Text>
          <ChevronRight size={14} color={config.iconColor} strokeWidth={1.75} />
        </TouchableOpacity>
      )}
    </View>
  );
});

export default function CashFlowAlerts({ forecast, invoices }: CashFlowAlertsProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const alerts = useMemo(() => generateAlerts(forecast, invoices), [forecast, invoices]);
  const visibleAlerts = useMemo(() => alerts.filter(a => !dismissed.has(a.id)), [alerts, dismissed]);

  const handleDismiss = useCallback((id: string) => {
    setDismissed(prev => new Set(prev).add(id));
  }, []);

  const handleAction = useCallback(() => {
    router.push('/cash-flow' as any);
  }, [router]);

  if (visibleAlerts.length === 0) return null;

  return (
    <View style={styles.container}>
      {visibleAlerts.map(alert => (
        <AlertCard
          key={alert.id}
          alert={alert}
          onDismiss={handleDismiss}
          onAction={handleAction}
          styles={styles}
          colors={colors}
        />
      ))}
    </View>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  alertCard: {
    borderRadius: Tokens.radius.lg,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  alertTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  alertTitle: {
    flex: 1,
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '700' as const,
  },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: Tokens.radius.card,
    backgroundColor: t.line,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  alertMessage: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    lineHeight: 18,
    paddingLeft: 26,
  },
  alertAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingLeft: 26,
    marginTop: 2,
  },
  alertActionText: {
    fontSize: Type.footnote.fontSize,
    fontWeight: '600' as const,
  },
});
