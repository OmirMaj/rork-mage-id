import React, { useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import {
  Calculator, Package, CalendarDays, ChevronRight, ShoppingCart,
  TrendingDown, Clock, Layers, BarChart3, Zap,
  Plug, CreditCard, FileText, ClipboardCheck, Users,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

function ToolCard({
  icon: Icon,
  iconColor,
  iconBg,
  title,
  subtitle,
  detail,
  onPress,
}: {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  detail?: string;
  onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  return (
    <Animated.View style={[styles.toolCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.toolCardInner}
      >
        <View style={[styles.toolIconWrap, { backgroundColor: iconBg }]}>
          <Icon size={24} color={iconColor} />
        </View>
        <View style={styles.toolInfo}>
          <Text style={styles.toolTitle}>{title}</Text>
          <Text style={styles.toolSubtitle}>{subtitle}</Text>
          {detail ? <Text style={styles.toolDetail}>{detail}</Text> : null}
        </View>
        <ChevronRight size={20} color={Colors.textMuted} />
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function ToolsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projects } = useProjects();

  const stats = useMemo(() => {
    const estimatedCount = projects.filter(p => p.linkedEstimate || p.estimate).length;
    const scheduledCount = projects.filter(p => p.schedule).length;
    const totalValue = projects.reduce((sum, p) => {
      if (p.linkedEstimate) return sum + p.linkedEstimate.grandTotal;
      if (p.estimate) return sum + p.estimate.grandTotal;
      return sum;
    }, 0);
    return { estimatedCount, scheduledCount, totalValue };
  }, [projects]);

  const formatMoney = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 10000) return `${(n / 1000).toFixed(0)}K`;
    return n.toLocaleString();
  };

  const navigateTo = useCallback((path: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(path as any);
  }, [router]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top, paddingBottom: insets.bottom + 100 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Text style={styles.largeTitle}>Tools</Text>
          <Text style={styles.headerSubtitle}>Estimate, price & schedule</Text>
        </View>

        {(stats.estimatedCount > 0 || stats.scheduledCount > 0) && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.primary + '12' }]}>
                <BarChart3 size={16} color={Colors.primary} />
              </View>
              <Text style={styles.statValue}>{stats.estimatedCount}</Text>
              <Text style={styles.statLabel}>Estimated</Text>
            </View>
            <View style={styles.statCard}>
              <View style={[styles.statIconWrap, { backgroundColor: Colors.info + '12' }]}>
                <CalendarDays size={16} color={Colors.info} />
              </View>
              <Text style={styles.statValue}>{stats.scheduledCount}</Text>
              <Text style={styles.statLabel}>Scheduled</Text>
            </View>
            {stats.totalValue > 0 && (
              <View style={styles.statCard}>
                <View style={[styles.statIconWrap, { backgroundColor: Colors.accent + '12' }]}>
                  <TrendingDown size={16} color={Colors.accent} />
                </View>
                <Text style={styles.statValue}>{formatMoney(stats.totalValue)}</Text>
                <Text style={styles.statLabel}>Total Value</Text>
              </View>
            )}
          </View>
        )}

        <Text style={styles.sectionLabel}>PROJECT TOOLS</Text>

        <ToolCard
          icon={Calculator}
          iconColor="#0A84FF"
          iconBg="#0A84FF12"
          title="Estimate Builder"
          subtitle="Search materials, build cost estimates with markup"
          detail={stats.estimatedCount > 0 ? `${stats.estimatedCount} project${stats.estimatedCount > 1 ? 's' : ''} estimated` : undefined}
          onPress={() => navigateTo('/(tabs)/tools/estimate')}
        />

        <ToolCard
          icon={Package}
          iconColor="#30D158"
          iconBg="#30D15812"
          title="Materials Pricing"
          subtitle="Live regional prices, bulk discounts & alerts"
          detail="Location-adjusted pricing"
          onPress={() => navigateTo('/(tabs)/tools/materials')}
        />

        <ToolCard
          icon={CalendarDays}
          iconColor="#FF9F0A"
          iconBg="#FF9F0A12"
          title="Schedule Planner"
          subtitle="Gantt charts, dependencies, AI generation"
          detail={stats.scheduledCount > 0 ? `${stats.scheduledCount} active schedule${stats.scheduledCount > 1 ? 's' : ''}` : undefined}
          onPress={() => navigateTo('/(tabs)/tools/schedule')}
        />

        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>BUSINESS TOOLS</Text>

        <ToolCard
          icon={Plug}
          iconColor="#635BFF"
          iconBg="#635BFF12"
          title="Integrations Hub"
          subtitle="Connect QuickBooks, Stripe, DocuSign & more"
          detail="23 integrations available"
          onPress={() => navigateTo('/integrations')}
        />

        <ToolCard
          icon={CreditCard}
          iconColor="#2E7D32"
          iconBg="#2E7D3212"
          title="Payments"
          subtitle="Accept payments, track invoices & send requests"
          onPress={() => navigateTo('/payments')}
        />

        <ToolCard
          icon={Users}
          iconColor="#E65100"
          iconBg="#E6510012"
          title="Time Tracking"
          subtitle="Crew clock-in/out, GPS verification, overtime"
          onPress={() => navigateTo('/time-tracking')}
        />

        <ToolCard
          icon={FileText}
          iconColor="#6A1B9A"
          iconBg="#6A1B9A12"
          title="Document Center"
          subtitle="Lien waivers, COIs, contracts & proposals"
          onPress={() => navigateTo('/documents')}
        />

        <ToolCard
          icon={ClipboardCheck}
          iconColor="#1565C0"
          iconBg="#1565C012"
          title="Permit Tracker"
          subtitle="Track permits, inspections & compliance"
          onPress={() => navigateTo('/permits')}
        />

        <Text style={[styles.sectionLabel, { marginTop: 8 }]}>QUICK ACTIONS</Text>

        <View style={styles.quickGrid}>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => navigateTo('/(tabs)/tools/estimate')}
            activeOpacity={0.7}
          >
            <ShoppingCart size={20} color={Colors.primary} />
            <Text style={styles.quickLabel}>New Estimate</Text>
            <Text style={styles.quickDesc}>Search & price materials</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => navigateTo('/(tabs)/tools/schedule')}
            activeOpacity={0.7}
          >
            <Zap size={20} color="#FF9F0A" />
            <Text style={styles.quickLabel}>AI Schedule</Text>
            <Text style={styles.quickDesc}>Generate with AI</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => navigateTo('/time-tracking')}
            activeOpacity={0.7}
          >
            <Clock size={20} color="#E65100" />
            <Text style={styles.quickLabel}>Clock In</Text>
            <Text style={styles.quickDesc}>Track crew hours</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.quickCard}
            onPress={() => navigateTo('/payments')}
            activeOpacity={0.7}
          >
            <CreditCard size={20} color="#2E7D32" />
            <Text style={styles.quickLabel}>Send Invoice</Text>
            <Text style={styles.quickDesc}>Request payment</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 20, paddingTop: 12, marginBottom: 16 },
  largeTitle: { fontSize: 34, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 15, color: Colors.textSecondary, marginTop: 2 },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statValue: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3, marginBottom: 2 },
  statLabel: { fontSize: 11, color: Colors.textSecondary },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    letterSpacing: 0.6,
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  toolCard: {
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 3,
  },
  toolCardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
  },
  toolIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolInfo: { flex: 1, gap: 2 },
  toolTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  toolSubtitle: { fontSize: 13, color: Colors.textSecondary, lineHeight: 17 },
  toolDetail: { fontSize: 12, color: Colors.primary, fontWeight: '500' as const, marginTop: 2 },
  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 20,
  },
  quickCard: {
    width: '47.5%' as any,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  quickLabel: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  quickDesc: { fontSize: 12, color: Colors.textSecondary },
});

