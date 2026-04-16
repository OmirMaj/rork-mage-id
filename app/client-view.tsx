import React, { useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image,
  ActivityIndicator, Dimensions,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Globe, CalendarDays, DollarSign, FileText, Image as ImageIcon,
  ClipboardList, CheckCircle2, MessageSquare, ChevronDown, ChevronUp,
  TrendingUp, Clock, AlertTriangle, BarChart3, Flag, GitBranch,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { formatMoney } from '@/utils/formatters';
import type { ScheduleTask } from '@/types';
import { getStatusColor, getStatusLabel, getPhaseColor } from '@/utils/scheduleEngine';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

type SectionKey = 'schedule' | 'budget' | 'invoices' | 'changeOrders' | 'photos' | 'dailyReports' | 'punchList' | 'rfis' | 'documents';

function SectionHeader({ title, icon, count, expanded, onToggle }: {
  title: string; icon: React.ReactNode; count?: number; expanded: boolean; onToggle: () => void;
}) {
  return (
    <TouchableOpacity style={styles.sectionHeader} onPress={onToggle} activeOpacity={0.7}>
      {icon}
      <Text style={styles.sectionTitle}>{title}</Text>
      {count !== undefined && (
        <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
      )}
      {expanded ? <ChevronUp size={16} color={Colors.textMuted} /> : <ChevronDown size={16} color={Colors.textMuted} />}
    </TouchableOpacity>
  );
}

function TaskRow({ task }: { task: ScheduleTask }) {
  const statusColor = getStatusColor(task.status);
  const phaseColor = getPhaseColor(task.phase);
  return (
    <View style={styles.taskRow}>
      <View style={[styles.taskPhaseBar, { backgroundColor: phaseColor }]} />
      <View style={styles.taskContent}>
        <View style={styles.taskTitleRow}>
          {task.isMilestone && <Flag size={11} color="#FF9500" />}
          {task.isCriticalPath && <GitBranch size={11} color={Colors.error} />}
          <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
        </View>
        <Text style={styles.taskMeta}>{task.phase} · {task.durationDays}d</Text>
        <View style={styles.taskProgressRow}>
          <View style={styles.taskProgressBar}>
            <View style={[styles.taskProgressFill, { width: `${task.progress}%` as any, backgroundColor: statusColor }]} />
          </View>
          <Text style={[styles.taskProgressPct, { color: statusColor }]}>{task.progress}%</Text>
        </View>
      </View>
      <View style={[styles.taskStatusBadge, { backgroundColor: statusColor + '20' }]}>
        <Text style={[styles.taskStatusText, { color: statusColor }]}>{getStatusLabel(task.status)}</Text>
      </View>
    </View>
  );
}

export default function ClientViewScreen() {
  const insets = useSafeAreaInsets();
  const { portalId } = useLocalSearchParams<{ portalId: string }>();
  const { projects, getChangeOrdersForProject, getInvoicesForProject, getDailyReportsForProject, getPunchItemsForProject, getPhotosForProject, getRFIsForProject } = useProjects();

  // Find project by portalId
  const project = useMemo(() =>
    projects.find(p => p.clientPortal?.portalId === portalId && p.clientPortal?.enabled),
    [projects, portalId]
  );

  const portal = project?.clientPortal;

  const changeOrders = useMemo(() => project ? getChangeOrdersForProject(project.id) : [], [project, getChangeOrdersForProject]);
  const invoices = useMemo(() => project ? getInvoicesForProject(project.id) : [], [project, getInvoicesForProject]);
  const dailyReports = useMemo(() => project ? getDailyReportsForProject(project.id) : [], [project, getDailyReportsForProject]);
  const punchItems = useMemo(() => project ? getPunchItemsForProject(project.id) : [], [project, getPunchItemsForProject]);
  const photos = useMemo(() => project ? getPhotosForProject(project.id) : [], [project, getPhotosForProject]);
  const rfis = useMemo(() => project ? getRFIsForProject(project.id) : [], [project, getRFIsForProject]);

  const [expanded, setExpanded] = useState<Record<SectionKey, boolean>>({
    schedule: true, budget: true, invoices: true, changeOrders: false,
    photos: true, dailyReports: false, punchList: false, rfis: false, documents: false,
  });

  const toggleSection = (key: SectionKey) => setExpanded(p => ({ ...p, [key]: !p[key] }));

  // Budget metrics
  const contractValue = project?.estimate?.grandTotal ?? 0;
  const invoicedTotal = invoices.reduce((s, i) => s + i.totalDue, 0);
  const paidTotal = invoices.reduce((s, i) => s + i.amountPaid, 0);
  const coTotal = changeOrders.filter(c => c.status === 'approved').reduce((s, c) => s + c.changeAmount, 0);
  const revisedContract = contractValue + coTotal;

  // Schedule metrics
  const tasks = project?.schedule?.tasks ?? [];
  const doneTasks = tasks.filter(t => t.status === 'done').length;
  const scheduleProgress = tasks.length > 0 ? Math.round((doneTasks / tasks.length) * 100) : 0;
  const healthScore = project?.schedule?.healthScore ?? 0;

  if (!project || !portal) {
    return (
      <View style={styles.notFoundContainer}>
        <Stack.Screen options={{ title: 'Client Portal', headerShown: false }} />
        <Globe size={48} color={Colors.textMuted} />
        <Text style={styles.notFoundTitle}>Portal Not Found</Text>
        <Text style={styles.notFoundSubtitle}>This portal link may be expired or invalid.</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <View style={styles.headerBrand}>
            <Globe size={22} color="#FFF" />
            <Text style={styles.headerBrandText}>Client Portal</Text>
          </View>
          <Text style={styles.headerProjectName}>{project.name}</Text>
          <Text style={styles.headerLocation}>{project.location}</Text>
          <View style={[styles.statusBadge, { backgroundColor: project.status === 'in_progress' ? '#34C75940' : '#FF950040' }]}>
            <Text style={[styles.statusBadgeText, { color: project.status === 'in_progress' ? '#34C759' : '#FF9500' }]}>
              {project.status === 'in_progress' ? 'In Progress' : project.status === 'completed' ? 'Completed' : 'Active'}
            </Text>
          </View>
        </View>

        {/* Welcome message */}
        {!!portal.welcomeMessage && (
          <View style={styles.welcomeCard}>
            <MessageSquare size={16} color={Colors.primary} />
            <Text style={styles.welcomeText}>{portal.welcomeMessage}</Text>
          </View>
        )}

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Schedule</Text>
            <Text style={[styles.statValue, { color: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error }]}>
              {scheduleProgress}%
            </Text>
            <Text style={styles.statSub}>complete</Text>
          </View>
          {portal.showBudgetSummary && (
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Invoiced</Text>
              <Text style={styles.statValue}>{formatMoney(invoicedTotal)}</Text>
              <Text style={styles.statSub}>of {formatMoney(revisedContract)}</Text>
            </View>
          )}
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Punch List</Text>
            <Text style={[styles.statValue, { color: punchItems.filter(p => p.status !== 'closed').length > 0 ? '#FF9500' : '#34C759' }]}>
              {punchItems.filter(p => p.status !== 'closed').length}
            </Text>
            <Text style={styles.statSub}>open items</Text>
          </View>
        </View>

        {/* Schedule Section */}
        {portal.showSchedule && tasks.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Project Schedule"
              icon={<CalendarDays size={18} color="#007AFF" />}
              count={tasks.length}
              expanded={expanded.schedule}
              onToggle={() => toggleSection('schedule')}
            />
            {expanded.schedule && (
              <View style={styles.sectionBody}>
                {/* Health bar */}
                <View style={styles.healthRow}>
                  <Text style={styles.healthLabel}>Schedule Health</Text>
                  <View style={styles.healthBar}>
                    <View style={[styles.healthFill, {
                      width: `${healthScore}%` as any,
                      backgroundColor: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error,
                    }]} />
                  </View>
                  <Text style={[styles.healthPct, {
                    color: healthScore >= 80 ? '#34C759' : healthScore >= 60 ? '#FF9500' : Colors.error,
                  }]}>{healthScore}%</Text>
                </View>
                {/* Tasks by phase */}
                {tasks.map(task => <TaskRow key={task.id} task={task} />)}
              </View>
            )}
          </View>
        )}

        {/* Budget Summary */}
        {portal.showBudgetSummary && (
          <View style={styles.section}>
            <SectionHeader
              title="Budget Summary"
              icon={<BarChart3 size={18} color="#34C759" />}
              expanded={expanded.budget}
              onToggle={() => toggleSection('budget')}
            />
            {expanded.budget && (
              <View style={styles.sectionBody}>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Original Contract</Text>
                  <Text style={styles.budgetValue}>{formatMoney(contractValue)}</Text>
                </View>
                {coTotal !== 0 && (
                  <View style={styles.budgetRow}>
                    <Text style={styles.budgetLabel}>Approved Change Orders</Text>
                    <Text style={[styles.budgetValue, { color: coTotal > 0 ? Colors.error : '#34C759' }]}>
                      {coTotal > 0 ? '+' : ''}{formatMoney(coTotal)}
                    </Text>
                  </View>
                )}
                <View style={[styles.budgetRow, styles.budgetRowTotal]}>
                  <Text style={styles.budgetLabelTotal}>Revised Contract</Text>
                  <Text style={styles.budgetValueTotal}>{formatMoney(revisedContract)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Invoiced</Text>
                  <Text style={styles.budgetValue}>{formatMoney(invoicedTotal)}</Text>
                </View>
                <View style={styles.budgetRow}>
                  <Text style={styles.budgetLabel}>Total Paid</Text>
                  <Text style={[styles.budgetValue, { color: '#34C759' }]}>{formatMoney(paidTotal)}</Text>
                </View>
                {/* Invoice progress bar */}
                <View style={styles.invoiceProgressRow}>
                  <View style={styles.invoiceProgressBar}>
                    <View style={[styles.invoiceProgressFill, { width: revisedContract > 0 ? `${Math.min(100, (paidTotal / revisedContract) * 100)}%` as any : '0%' }]} />
                  </View>
                  <Text style={styles.invoiceProgressPct}>
                    {revisedContract > 0 ? Math.round((paidTotal / revisedContract) * 100) : 0}% paid
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}

        {/* Invoices */}
        {portal.showInvoices && invoices.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Invoices"
              icon={<DollarSign size={18} color="#FF9500" />}
              count={invoices.length}
              expanded={expanded.invoices}
              onToggle={() => toggleSection('invoices')}
            />
            {expanded.invoices && (
              <View style={styles.sectionBody}>
                {invoices.map(inv => {
                  const statusColor = inv.status === 'paid' ? '#34C759' : inv.status === 'overdue' ? Colors.error : '#FF9500';
                  return (
                    <View key={inv.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle}>Invoice #{inv.number}</Text>
                        <Text style={styles.listRowMeta}>Due {new Date(inv.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                      </View>
                      <View style={styles.listRowRight}>
                        <Text style={styles.listRowAmount}>{formatMoney(inv.totalDue)}</Text>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {inv.status === 'paid' ? 'Paid' : inv.status === 'overdue' ? 'Overdue' : inv.status === 'partially_paid' ? 'Partial' : 'Sent'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Change Orders */}
        {portal.showChangeOrders && changeOrders.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Change Orders"
              icon={<FileText size={18} color="#FF3B30" />}
              count={changeOrders.length}
              expanded={expanded.changeOrders}
              onToggle={() => toggleSection('changeOrders')}
            />
            {expanded.changeOrders && (
              <View style={styles.sectionBody}>
                {changeOrders.map(co => {
                  const statusColor = co.status === 'approved' ? '#34C759' : co.status === 'rejected' ? Colors.error : '#FF9500';
                  return (
                    <View key={co.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle}>CO #{co.number} — {co.description}</Text>
                        <Text style={styles.listRowMeta}>{new Date(co.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                      </View>
                      <View style={styles.listRowRight}>
                        <Text style={[styles.listRowAmount, { color: co.changeAmount > 0 ? Colors.error : '#34C759' }]}>
                          {co.changeAmount > 0 ? '+' : ''}{formatMoney(co.changeAmount)}
                        </Text>
                        <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                          <Text style={[styles.listStatusText, { color: statusColor }]}>
                            {co.status.charAt(0).toUpperCase() + co.status.slice(1).replace('_', ' ')}
                          </Text>
                        </View>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Site Photos */}
        {portal.showPhotos && photos.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Site Photos"
              icon={<ImageIcon size={18} color="#5856D6" />}
              count={photos.length}
              expanded={expanded.photos}
              onToggle={() => toggleSection('photos')}
            />
            {expanded.photos && (
              <View style={styles.photoGrid}>
                {photos.slice(0, 9).map(photo => (
                  <View key={photo.id} style={styles.photoThumb}>
                    <Image source={{ uri: photo.uri }} style={styles.photoImg} resizeMode="cover" />
                    {photo.tag && (
                      <View style={styles.photoTag}><Text style={styles.photoTagText}>{photo.tag}</Text></View>
                    )}
                  </View>
                ))}
                {photos.length > 9 && (
                  <View style={[styles.photoThumb, styles.photoMoreOverlay]}>
                    <Text style={styles.photoMoreText}>+{photos.length - 9}</Text>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Daily Reports */}
        {portal.showDailyReports && dailyReports.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Daily Reports"
              icon={<ClipboardList size={18} color="#32ADE6" />}
              count={dailyReports.length}
              expanded={expanded.dailyReports}
              onToggle={() => toggleSection('dailyReports')}
            />
            {expanded.dailyReports && (
              <View style={styles.sectionBody}>
                {dailyReports.slice(0, 5).map(report => (
                  <View key={report.id} style={styles.listRow}>
                    <View style={styles.listRowLeft}>
                      <Text style={styles.listRowTitle}>{new Date(report.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                      <Text style={styles.listRowMeta} numberOfLines={2}>{report.workPerformed || 'No summary provided'}</Text>
                    </View>
                    <View style={styles.listRowRight}>
                      <Text style={styles.listRowAmount}>{report.weather.conditions}</Text>
                      <Text style={styles.listStatusText}>{report.weather.temperature}</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Punch List */}
        {portal.showPunchList && punchItems.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="Punch List"
              icon={<CheckCircle2 size={18} color="#34C759" />}
              count={punchItems.filter(p => p.status !== 'closed').length}
              expanded={expanded.punchList}
              onToggle={() => toggleSection('punchList')}
            />
            {expanded.punchList && (
              <View style={styles.sectionBody}>
                {punchItems.map(item => {
                  const statusColor = item.status === 'closed' ? '#34C759' : item.status === 'in_progress' ? '#007AFF' : '#FF9500';
                  return (
                    <View key={item.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle} numberOfLines={1}>{item.description}</Text>
                        <Text style={styles.listRowMeta}>{item.location} · {item.assignedSub}</Text>
                      </View>
                      <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.listStatusText, { color: statusColor }]}>
                          {item.status === 'closed' ? 'Closed' : item.status === 'in_progress' ? 'In Progress' : 'Open'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* RFIs */}
        {portal.showRFIs && rfis.length > 0 && (
          <View style={styles.section}>
            <SectionHeader
              title="RFIs"
              icon={<MessageSquare size={18} color="#FF9500" />}
              count={rfis.filter(r => r.status === 'open').length}
              expanded={expanded.rfis}
              onToggle={() => toggleSection('rfis')}
            />
            {expanded.rfis && (
              <View style={styles.sectionBody}>
                {rfis.map(rfi => {
                  const statusColor = rfi.status === 'answered' ? '#34C759' : rfi.status === 'closed' ? Colors.textMuted : '#FF9500';
                  return (
                    <View key={rfi.id} style={styles.listRow}>
                      <View style={styles.listRowLeft}>
                        <Text style={styles.listRowTitle} numberOfLines={1}>RFI #{rfi.number} — {rfi.subject}</Text>
                        <Text style={styles.listRowMeta}>Due {new Date(rfi.dateRequired).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text>
                      </View>
                      <View style={[styles.listStatusBadge, { backgroundColor: statusColor + '20' }]}>
                        <Text style={[styles.listStatusText, { color: statusColor }]}>
                          {rfi.status.charAt(0).toUpperCase() + rfi.status.slice(1)}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          <Globe size={14} color={Colors.textMuted} />
          <Text style={styles.footerText}>Powered by MAGE ID · Read-only view</Text>
        </View>
      </ScrollView>
    </>
  );
}

const PHOTO_SIZE = (SCREEN_WIDTH - 32 - 8) / 3;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  notFoundContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  notFoundTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  notFoundSubtitle: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  header: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingBottom: 24,
    alignItems: 'flex-start',
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12, opacity: 0.8 },
  headerBrandText: { fontSize: 12, fontWeight: '600', color: '#FFF', letterSpacing: 1 },
  headerProjectName: { fontSize: 24, fontWeight: '800', color: '#FFF', marginBottom: 4 },
  headerLocation: { fontSize: 13, color: '#FFFFFF99', marginBottom: 12 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },

  welcomeCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    margin: 16, backgroundColor: Colors.primary + '10',
    borderRadius: 12, padding: 14,
    borderLeftWidth: 3, borderLeftColor: Colors.primary,
  },
  welcomeText: { flex: 1, fontSize: 14, color: Colors.text, lineHeight: 20 },

  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard: {
    flex: 1, backgroundColor: Colors.card,
    borderRadius: 12, padding: 12, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  statLabel: { fontSize: 11, color: Colors.textMuted, fontWeight: '600', marginBottom: 4 },
  statValue: { fontSize: 20, fontWeight: '800', color: Colors.text },
  statSub: { fontSize: 10, color: Colors.textMuted, marginTop: 2 },

  section: {
    marginHorizontal: 16, marginBottom: 12,
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 14, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  badge: { backgroundColor: Colors.primary + '20', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  badgeText: { fontSize: 11, fontWeight: '700', color: Colors.primary },

  sectionBody: { padding: 12, gap: 8 },

  // Health bar
  healthRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  healthLabel: { fontSize: 12, color: Colors.textMuted, width: 100 },
  healthBar: { flex: 1, height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  healthFill: { height: '100%', borderRadius: 3 },
  healthPct: { fontSize: 12, fontWeight: '700', width: 34, textAlign: 'right' },

  // Task rows
  taskRow: { flexDirection: 'row', backgroundColor: Colors.background, borderRadius: 8, overflow: 'hidden', marginBottom: 4 },
  taskPhaseBar: { width: 3 },
  taskContent: { flex: 1, padding: 10 },
  taskTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  taskTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, flex: 1 },
  taskMeta: { fontSize: 11, color: Colors.textMuted, marginBottom: 6 },
  taskProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  taskProgressBar: { flex: 1, height: 4, backgroundColor: Colors.border, borderRadius: 2, overflow: 'hidden' },
  taskProgressFill: { height: '100%', borderRadius: 2 },
  taskProgressPct: { fontSize: 11, fontWeight: '600', width: 28, textAlign: 'right' },
  taskStatusBadge: { margin: 10, alignSelf: 'center', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  taskStatusText: { fontSize: 10, fontWeight: '700' },

  // Budget
  budgetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  budgetRowTotal: { borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4, paddingTop: 10 },
  budgetLabel: { fontSize: 13, color: Colors.textMuted },
  budgetValue: { fontSize: 14, fontWeight: '600', color: Colors.text },
  budgetLabelTotal: { fontSize: 14, fontWeight: '700', color: Colors.text },
  budgetValueTotal: { fontSize: 16, fontWeight: '800', color: Colors.text },
  invoiceProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  invoiceProgressBar: { flex: 1, height: 8, backgroundColor: Colors.border, borderRadius: 4, overflow: 'hidden' },
  invoiceProgressFill: { height: '100%', backgroundColor: '#34C759', borderRadius: 4 },
  invoiceProgressPct: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },

  // List rows (invoices, COs, RFIs, punch)
  listRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 8, padding: 10, marginBottom: 4 },
  listRowLeft: { flex: 1, marginRight: 10 },
  listRowTitle: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  listRowMeta: { fontSize: 11, color: Colors.textMuted },
  listRowRight: { alignItems: 'flex-end', gap: 4 },
  listRowAmount: { fontSize: 14, fontWeight: '700', color: Colors.text },
  listStatusBadge: { borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  listStatusText: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },

  // Photos
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 4 },
  photoThumb: { width: PHOTO_SIZE, height: PHOTO_SIZE, borderRadius: 8, overflow: 'hidden', backgroundColor: Colors.border },
  photoImg: { width: '100%', height: '100%' },
  photoTag: { position: 'absolute', bottom: 4, left: 4, backgroundColor: '#00000080', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 },
  photoTagText: { fontSize: 9, color: '#FFF', fontWeight: '600' },
  photoMoreOverlay: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#00000060' },
  photoMoreText: { fontSize: 20, fontWeight: '800', color: '#FFF' },

  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8 },
  footerText: { fontSize: 12, color: Colors.textMuted },
});
