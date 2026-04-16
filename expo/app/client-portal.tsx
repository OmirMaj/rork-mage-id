import React, { useState, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Eye, CalendarDays, Camera, MessageCircle, FileText, ChevronRight,
  Clock, CheckCircle, TrendingUp, Shield,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';

type PortalTab = 'overview' | 'photos' | 'schedule' | 'messages' | 'documents';

export default function ClientPortalScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getProject, getPhotosForProject, getChangeOrdersForProject, getInvoicesForProject } = useProjects();

  const project = useMemo(() => getProject(id ?? ''), [id, getProject]);
  const photos = useMemo(() => getPhotosForProject(id ?? ''), [id, getPhotosForProject]);
  const changeOrders = useMemo(() => getChangeOrdersForProject(id ?? ''), [id, getChangeOrdersForProject]);
  const invoices = useMemo(() => getInvoicesForProject(id ?? ''), [id, getInvoicesForProject]);

  const [activeTab, setActiveTab] = useState<PortalTab>('overview');

  const tabs: { key: PortalTab; label: string; icon: React.ElementType }[] = [
    { key: 'overview', label: 'Overview', icon: Eye },
    { key: 'photos', label: 'Photos', icon: Camera },
    { key: 'schedule', label: 'Schedule', icon: CalendarDays },
    { key: 'messages', label: 'Messages', icon: MessageCircle },
    { key: 'documents', label: 'Docs', icon: FileText },
  ];

  const handleTabChange = useCallback((tab: PortalTab) => {
    setActiveTab(tab);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  if (!project) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <Stack.Screen options={{ title: 'Client Portal' }} />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Project not found</Text>
        </View>
      </View>
    );
  }

  const progressPercent = project.schedule
    ? Math.round(project.schedule.tasks.reduce((sum, t) => sum + t.progress, 0) / Math.max(project.schedule.tasks.length, 1))
    : project.status === 'completed' ? 100 : project.status === 'in_progress' ? 45 : 0;

  const currentPhase = project.schedule?.tasks.find(t => t.status === 'in_progress')?.phase ?? 'Planning';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Client Portal' }} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.portalHeader}>
          <View style={styles.portalBadge}>
            <Shield size={12} color={Colors.primary} />
            <Text style={styles.portalBadgeText}>Client View</Text>
          </View>
          <Text style={styles.portalProjectName}>{project.name}</Text>
          <Text style={styles.portalProjectMeta}>
            {project.location} · {project.type.replace(/_/g, ' ')}
          </Text>
          <View style={[styles.statusBadge, {
            backgroundColor: project.status === 'completed' ? Colors.successLight
              : project.status === 'in_progress' ? Colors.primaryLight
              : Colors.warningLight,
          }]}>
            <Text style={[styles.statusBadgeText, {
              color: project.status === 'completed' ? Colors.success
                : project.status === 'in_progress' ? Colors.primary
                : Colors.warning,
            }]}>
              {project.status.replace(/_/g, ' ').toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={styles.tabBar}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tabItem, activeTab === tab.key && styles.tabItemActive]}
              onPress={() => handleTabChange(tab.key)}
              activeOpacity={0.7}
            >
              <tab.icon size={16} color={activeTab === tab.key ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {activeTab === 'overview' && (
          <View style={styles.tabContent}>
            <View style={styles.progressCard}>
              <Text style={styles.progressLabel}>PROJECT PROGRESS</Text>
              <View style={styles.progressCircleWrap}>
                <View style={styles.progressCircle}>
                  <Text style={styles.progressPercent}>{progressPercent}%</Text>
                </View>
              </View>
              <View style={styles.progressBar}>
                <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
              </View>
              <Text style={styles.progressPhase}>Current Phase: {currentPhase}</Text>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <TrendingUp size={18} color={Colors.primary} />
                <Text style={styles.statValue}>{project.schedule?.tasks.length ?? 0}</Text>
                <Text style={styles.statLabel}>Tasks</Text>
              </View>
              <View style={styles.statCard}>
                <Camera size={18} color={Colors.accent} />
                <Text style={styles.statValue}>{photos.length}</Text>
                <Text style={styles.statLabel}>Photos</Text>
              </View>
              <View style={styles.statCard}>
                <FileText size={18} color={Colors.info} />
                <Text style={styles.statValue}>{changeOrders.length + invoices.length}</Text>
                <Text style={styles.statLabel}>Documents</Text>
              </View>
            </View>

            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {[
              { icon: CheckCircle, text: `Project status: ${project.status.replace(/_/g, ' ')}`, time: 'Latest', color: Colors.success },
              { icon: Camera, text: `${photos.length} photos documented`, time: 'Ongoing', color: Colors.accent },
              { icon: FileText, text: `${changeOrders.length} change orders`, time: 'To date', color: Colors.info },
            ].map((item, i) => (
              <View key={i} style={styles.activityItem}>
                <View style={[styles.activityIcon, { backgroundColor: item.color + '15' }]}>
                  <item.icon size={14} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityText}>{item.text}</Text>
                  <Text style={styles.activityTime}>{item.time}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {activeTab === 'photos' && (
          <View style={styles.tabContent}>
            {photos.length === 0 ? (
              <View style={styles.emptyTab}>
                <Camera size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTabTitle}>No Photos Yet</Text>
                <Text style={styles.emptyTabSub}>Project photos will appear here as work progresses</Text>
              </View>
            ) : (
              <View style={styles.photoGrid}>
                {photos.map(photo => (
                  <View key={photo.id} style={styles.photoThumb}>
                    <Camera size={20} color={Colors.textMuted} />
                    <Text style={styles.photoDate}>
                      {new Date(photo.timestamp).toLocaleDateString()}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {activeTab === 'schedule' && (
          <View style={styles.tabContent}>
            {project.schedule?.tasks && project.schedule.tasks.length > 0 ? (
              project.schedule.tasks.slice(0, 10).map(task => (
                <View key={task.id} style={styles.scheduleItem}>
                  <View style={[styles.schedulePhaseBar, {
                    backgroundColor: task.status === 'done' ? Colors.success
                      : task.status === 'in_progress' ? Colors.primary
                      : Colors.borderLight,
                  }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.scheduleTaskTitle}>{task.title}</Text>
                    <Text style={styles.scheduleTaskMeta}>{task.phase} · {task.durationDays}d</Text>
                    <View style={styles.scheduleProgress}>
                      <View style={[styles.scheduleProgressFill, { width: `${task.progress}%` }]} />
                    </View>
                  </View>
                  <Text style={styles.schedulePercent}>{task.progress}%</Text>
                </View>
              ))
            ) : (
              <View style={styles.emptyTab}>
                <CalendarDays size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTabTitle}>Schedule Coming Soon</Text>
                <Text style={styles.emptyTabSub}>The project timeline will be visible here</Text>
              </View>
            )}
          </View>
        )}

        {activeTab === 'messages' && (
          <View style={styles.tabContent}>
            <View style={styles.emptyTab}>
              <MessageCircle size={40} color={Colors.textMuted} />
              <Text style={styles.emptyTabTitle}>Messages</Text>
              <Text style={styles.emptyTabSub}>Direct communication with your contractor will appear here</Text>
            </View>
          </View>
        )}

        {activeTab === 'documents' && (
          <View style={styles.tabContent}>
            {invoices.length === 0 && changeOrders.length === 0 ? (
              <View style={styles.emptyTab}>
                <FileText size={40} color={Colors.textMuted} />
                <Text style={styles.emptyTabTitle}>No Documents</Text>
                <Text style={styles.emptyTabSub}>Invoices and change orders will appear here</Text>
              </View>
            ) : (
              <>
                {invoices.map(inv => (
                  <View key={inv.id} style={styles.docItem}>
                    <View style={[styles.docIconWrap, { backgroundColor: Colors.infoLight }]}>
                      <FileText size={16} color={Colors.info} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docTitle}>Invoice #{inv.number}</Text>
                      <Text style={styles.docMeta}>${inv.totalDue.toLocaleString()} · {inv.status}</Text>
                    </View>
                    <View style={[styles.docStatusBadge, {
                      backgroundColor: inv.status === 'paid' ? Colors.successLight : Colors.warningLight,
                    }]}>
                      <Text style={[styles.docStatusText, {
                        color: inv.status === 'paid' ? Colors.success : Colors.warning,
                      }]}>{inv.status.toUpperCase()}</Text>
                    </View>
                  </View>
                ))}
                {changeOrders.map(co => (
                  <View key={co.id} style={styles.docItem}>
                    <View style={[styles.docIconWrap, { backgroundColor: Colors.accentLight }]}>
                      <FileText size={16} color={Colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.docTitle}>CO #{co.number}: {co.description}</Text>
                      <Text style={styles.docMeta}>${Math.abs(co.changeAmount).toLocaleString()} · {co.status}</Text>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 16, color: Colors.textSecondary },
  portalHeader: {
    backgroundColor: Colors.surface,
    padding: 20,
    paddingBottom: 16,
    alignItems: 'center',
    gap: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  portalBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginBottom: 4,
  },
  portalBadgeText: { fontSize: 11, fontWeight: '700' as const, color: Colors.primary },
  portalProjectName: { fontSize: 22, fontWeight: '700' as const, color: Colors.text },
  portalProjectMeta: { fontSize: 14, color: Colors.textSecondary },
  statusBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 4 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' as const },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.borderLight,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    gap: 4,
    borderRadius: 10,
  },
  tabItemActive: { backgroundColor: Colors.primaryLight },
  tabLabel: { fontSize: 11, fontWeight: '600' as const, color: Colors.textMuted },
  tabLabelActive: { color: Colors.primary },
  tabContent: { padding: 16 },
  progressCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  progressLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.8 },
  progressCircleWrap: { marginVertical: 8 },
  progressCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 6,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primaryLight,
  },
  progressPercent: { fontSize: 22, fontWeight: '800' as const, color: Colors.primary },
  progressBar: { height: 6, backgroundColor: Colors.fillTertiary, borderRadius: 3, width: '100%' },
  progressFill: { height: 6, backgroundColor: Colors.primary, borderRadius: 3 },
  progressPhase: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' as const },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  statValue: { fontSize: 20, fontWeight: '800' as const, color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600' as const },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 12,
    marginTop: 4,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  activityIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  activityText: { fontSize: 14, fontWeight: '500' as const, color: Colors.text },
  activityTime: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  emptyTab: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyTabTitle: { fontSize: 17, fontWeight: '600' as const, color: Colors.text },
  emptyTabSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', maxWidth: 260, lineHeight: 19 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  photoThumb: {
    width: '31%' as any,
    aspectRatio: 1,
    backgroundColor: Colors.fillTertiary,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  photoDate: { fontSize: 9, color: Colors.textMuted },
  scheduleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  schedulePhaseBar: { width: 4, height: 40, borderRadius: 2 },
  scheduleTaskTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  scheduleTaskMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  scheduleProgress: { height: 4, backgroundColor: Colors.fillTertiary, borderRadius: 2, marginTop: 6 },
  scheduleProgressFill: { height: 4, backgroundColor: Colors.primary, borderRadius: 2 },
  schedulePercent: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  docItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  docIconWrap: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  docTitle: { fontSize: 14, fontWeight: '600' as const, color: Colors.text },
  docMeta: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  docStatusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  docStatusText: { fontSize: 10, fontWeight: '700' as const },
});

