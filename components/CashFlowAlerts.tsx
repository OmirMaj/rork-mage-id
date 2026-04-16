import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { AlertTriangle, TrendingUp, Clock, X, ChevronRight } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useRouter } from 'expo-router';
import type { CashFlowWeek } from '@/utils/cashFlowEngine';
import { formatCurrency } from '@/utils/cashFlowEngine';
import type { Invoice } from '@/types';

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

const ALERT_CONFIG: Record<CashFlowAlert['type'], { bg: string; border: string; iconColor: string; icon: typeof AlertTriangle }> = {
  critical: { bg: Colors.errorLight, border: Colors.error + '40', iconColor: Colors.error, icon: AlertTriangle },
  warning: { bg: Colors.warningLight, border: Colors.warning + '40', iconColor: Colors.warning, icon: AlertTriangle },
  positive: { bg: Colors.successLight, border: Colors.success + '40', iconColor: Colors.success, icon: TrendingUp },
  payment_due: { bg: Colors.infoLight, border: Colors.info + '40', iconColor: Colors.info, icon: Clock },
  overdue: { bg: Colors.errorLight, border: Colors.error + '40', iconColor: Colors.error, icon: Clock },
};

const AlertCard = React.memo(function AlertCard({
  alert,
  onDismiss,
  onAction,
}: {
  alert: CashFlowAlert;
  onDismiss: (id: string) => void;
  onAction: () => void;
}) {
  const config = ALERT_CONFIG[alert.type];
  const IconComponent = config.icon;

  return (
    <View style={[styles.alertCard, { backgroundColor: config.bg, borderColor: config.border }]}>
      <View style={styles.alertTop}>
        <IconComponent size={18} color={config.iconColor} />
        <Text style={[styles.alertTitle, { color: config.iconColor }]} numberOfLines={1}>
          {alert.title}
        </Text>
        <TouchableOpacity onPress={() => onDismiss(alert.id)} style={styles.dismissBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
      <Text style={styles.alertMessage} numberOfLines={2}>{alert.message}</Text>
      {alert.actionLabel && (
        <TouchableOpacity style={styles.alertAction} onPress={onAction} activeOpacity={0.7}>
          <Text style={[styles.alertActionText, { color: config.iconColor }]}>{alert.actionLabel}</Text>
          <ChevronRight size={14} color={config.iconColor} />
        </TouchableOpacity>
      )}
    </View>
  );
});

export default function CashFlowAlerts({ forecast, invoices }: CashFlowAlertsProps) {
  const router = useRouter();
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
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  alertCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    gap: 6,
  },
  alertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  alertTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertMessage: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    paddingLeft: 26,
  },
  alertAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 26,
    marginTop: 2,
  },
  alertActionText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },
});
