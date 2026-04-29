// Buyout dashboard — the centerpiece of MAGE ID's bid-management story.
//
// The screen most legacy GC platforms don't have: the buyout phase
// laid out as a single dashboard with a real-time savings KPI, a
// scope-coverage map of the estimate, and a list of bid packages
// with status chips. One tap on a package drills into the leveling
// matrix.
//
// Three KPIs at the top:
//   1. % bought out — committed dollars / estimate budget
//   2. Buyout savings to date — sum of awarded packages'
//      (estimateBudget - awardedAmount). Color-coded green/red.
//   3. Packages awarded / total — pace indicator, with a pulsing
//      red dot when any package is overdue (requiredByDate < today
//      and status !== 'awarded').
//
// Each package card shows: name + phase, scope budget, # bids in,
// status chip, days-til-required, and either "Lowest bid: $X" or
// "Awarded to Joe's at $X · saved $Y".

import React, { useCallback, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable,
  Alert, Platform, TextInput, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Mic, Sparkles, ChevronRight, AlertTriangle, CheckCircle2,
  Clock, TrendingUp, TrendingDown, Package, X, Save,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import {
  BID_PACKAGE_STATUSES, BID_PACKAGE_STATUS_LABELS,
  type BidPackage, type BidPackageStatus,
} from '@/types';
import { formatMoney } from '@/utils/formatters';

const STATUS_COLORS: Record<BidPackageStatus, string> = {
  open: '#FF6A1A',
  leveling: '#0D6CB1',
  awarded: '#16A34A',
  cancelled: '#9CA3AF',
};

// Condensed CSI MasterFormat divisions used in residential buyout.
// Industry-standard alignment so bid packages map to the same
// "address" the project manual / spec uses. We surface a residential-
// relevant subset (the full 50-division list would overwhelm a phone
// picker) but `csiDivision` accepts any string for power users who
// prefer a different code.
const CSI_DIVISIONS = [
  { code: '02', name: 'Existing Conditions' },
  { code: '03', name: 'Concrete' },
  { code: '04', name: 'Masonry' },
  { code: '05', name: 'Metals' },
  { code: '06', name: 'Wood / Carpentry' },
  { code: '07', name: 'Thermal / Moisture' },
  { code: '08', name: 'Openings (Doors/Windows)' },
  { code: '09', name: 'Finishes' },
  { code: '10', name: 'Specialties' },
  { code: '11', name: 'Equipment' },
  { code: '12', name: 'Furnishings' },
  { code: '21', name: 'Fire Suppression' },
  { code: '22', name: 'Plumbing' },
  { code: '23', name: 'HVAC' },
  { code: '26', name: 'Electrical' },
  { code: '27', name: 'Communications' },
  { code: '31', name: 'Earthwork' },
  { code: '32', name: 'Exterior Improvements' },
  { code: '33', name: 'Utilities' },
];

export default function BuyoutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const { projects, getProject, getBidPackagesForProject, getBidsForPackage, addBidPackage } = useProjects();

  const [pickedProjectId, setPickedProjectId] = useState<string | undefined>(projectId);
  const project = useMemo(() => {
    const id = pickedProjectId ?? projectId;
    if (id) return getProject(id);
    // Default to most-recently-updated active project.
    const active = projects.filter(p => p.status === 'in_progress' || p.status === 'estimated' || p.status === 'draft');
    return [...active].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0] ?? null;
  }, [projects, projectId, pickedProjectId, getProject]);

  const packages = useMemo(() => {
    if (!project) return [] as BidPackage[];
    return getBidPackagesForProject(project.id);
  }, [project, getBidPackagesForProject]);

  // ── KPIs ───────────────────────────────────────────────────────
  const kpi = useMemo(() => {
    const total = packages.length;
    const awarded = packages.filter(p => p.status === 'awarded').length;
    const open = packages.filter(p => p.status === 'open').length;
    const leveling = packages.filter(p => p.status === 'leveling').length;
    const totalBudget = packages.reduce((s, p) => s + p.estimateBudget, 0);
    const committedBudget = packages
      .filter(p => p.status === 'awarded')
      .reduce((s, p) => s + p.estimateBudget, 0);
    const pctBoughtOut = totalBudget > 0 ? Math.round((committedBudget / totalBudget) * 100) : 0;
    const savingsToDate = packages
      .filter(p => p.status === 'awarded')
      .reduce((s, p) => s + (p.buyoutSavings ?? 0), 0);
    const today = new Date();
    const overdue = packages.filter(p =>
      p.status !== 'awarded' && p.status !== 'cancelled' &&
      p.requiredByDate && new Date(p.requiredByDate) < today
    );
    return { total, awarded, open, leveling, totalBudget, committedBudget, pctBoughtOut, savingsToDate, overdue: overdue.length };
  }, [packages]);

  // ── New package modal ───────────────────────────────────────────
  const [showNewPkg, setShowNewPkg] = useState(false);
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgPhase, setNewPkgPhase] = useState('');
  const [newPkgCsi, setNewPkgCsi] = useState('');
  const [newPkgBudget, setNewPkgBudget] = useState('');
  const [newPkgPickedItemIds, setNewPkgPickedItemIds] = useState<string[]>([]);

  // Estimate items available to link from the active project's linked
  // estimate (the modern estimate format with stable ids). Sorted by
  // category so the GC can pick by trade.
  const projectEstimateItems = useMemo(() => {
    const items = project?.linkedEstimate?.items ?? [];
    return [...items].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }, [project]);

  // Auto-compute budget from the picked items (user can override).
  const computedBudget = useMemo(() => {
    if (newPkgPickedItemIds.length === 0) return 0;
    return projectEstimateItems
      .filter(i => newPkgPickedItemIds.includes(i.materialId))
      .reduce((s, i) => s + i.lineTotal, 0);
  }, [newPkgPickedItemIds, projectEstimateItems]);

  // Show allowance count among picked items.
  const allowanceCount = useMemo(() => {
    return projectEstimateItems
      .filter(i => newPkgPickedItemIds.includes(i.materialId) && i.isAllowance).length;
  }, [newPkgPickedItemIds, projectEstimateItems]);

  // Sync auto-computed budget into the visible field whenever picks
  // change — but only if the GC hasn't manually typed a different value
  // (we can tell by storing the last auto-computed value).
  const lastAutoBudgetRef = React.useRef<string>('');
  React.useEffect(() => {
    const auto = computedBudget > 0 ? String(Math.round(computedBudget)) : '';
    if (newPkgBudget === '' || newPkgBudget === lastAutoBudgetRef.current) {
      setNewPkgBudget(auto);
      lastAutoBudgetRef.current = auto;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedBudget]);

  const togglePickedItem = useCallback((materialId: string) => {
    setNewPkgPickedItemIds(prev =>
      prev.includes(materialId) ? prev.filter(id => id !== materialId) : [...prev, materialId]
    );
  }, []);

  const handleCreatePackage = useCallback(() => {
    if (!project) {
      Alert.alert('Pick a project first');
      return;
    }
    if (!newPkgName.trim()) {
      Alert.alert('Name required', 'Give the package a name like "Plumbing rough-in".');
      return;
    }
    const budget = Number(newPkgBudget) || 0;
    const newPkg = addBidPackage({
      projectId: project.id,
      name: newPkgName.trim(),
      phase: newPkgPhase.trim() || undefined,
      csiDivision: newPkgCsi.trim() || undefined,
      linkedEstimateItemIds: newPkgPickedItemIds,
      estimateBudget: budget,
      status: 'open',
    });
    setShowNewPkg(false);
    setNewPkgName('');
    setNewPkgPhase('');
    setNewPkgCsi('');
    setNewPkgBudget('');
    setNewPkgPickedItemIds([]);
    lastAutoBudgetRef.current = '';
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/buyout-package' as never, params: { packageId: newPkg.id } as never });
  }, [project, newPkgName, newPkgPhase, newPkgCsi, newPkgBudget, newPkgPickedItemIds, addBidPackage, router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Buyout', headerLargeTitle: false }} />
      <View style={[styles.root, { paddingTop: insets.top + 8 }]}>
        {/* Project chip row — matches the schedule tab pattern. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.projectChipsRow}
        >
          {projects.map(p => {
            const active = p.id === project?.id;
            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.projectChip, active && styles.projectChipActive]}
                onPress={() => setPickedProjectId(p.id)}
                activeOpacity={0.8}
              >
                <Text style={[styles.projectChipText, active && styles.projectChipTextActive]} numberOfLines={1}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            );
          })}
          {projects.length === 0 && (
            <Text style={styles.emptyChipText}>No projects yet — create one from the Home tab.</Text>
          )}
        </ScrollView>

        {!project ? (
          <View style={styles.emptyState}>
            <Package size={48} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No project selected</Text>
            <Text style={styles.emptyDesc}>Pick a project above to see its buyout dashboard.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}>
            {/* ── KPI band ─────────────────────────────────────── */}
            <View style={styles.kpiBand}>
              <View style={styles.kpiTile}>
                <View style={styles.kpiTileTopRow}>
                  <Text style={styles.kpiLabel}>Bought out</Text>
                  {kpi.overdue > 0 && (
                    <View style={styles.kpiAlert}>
                      <AlertTriangle size={11} color="#FFF" />
                      <Text style={styles.kpiAlertText}>{kpi.overdue} overdue</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.kpiNum}>{kpi.pctBoughtOut}%</Text>
                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${kpi.pctBoughtOut}%` as `${number}%` }]} />
                </View>
                <Text style={styles.kpiSub}>{formatMoney(kpi.committedBudget)} of {formatMoney(kpi.totalBudget)}</Text>
              </View>

              <View style={styles.kpiTile}>
                <View style={styles.kpiTileTopRow}>
                  <Text style={styles.kpiLabel}>Buyout {kpi.savingsToDate >= 0 ? 'savings' : 'overrun'}</Text>
                  {kpi.savingsToDate >= 0
                    ? <TrendingUp size={14} color={Colors.success} />
                    : <TrendingDown size={14} color={Colors.error} />}
                </View>
                <Text style={[styles.kpiNum, { color: kpi.savingsToDate >= 0 ? Colors.success : Colors.error }]}>
                  {kpi.savingsToDate >= 0 ? '+' : ''}{formatMoney(kpi.savingsToDate)}
                </Text>
                <Text style={styles.kpiSub}>vs. estimate carry across awarded packages</Text>
              </View>

              <View style={styles.kpiTile}>
                <View style={styles.kpiTileTopRow}>
                  <Text style={styles.kpiLabel}>Packages</Text>
                </View>
                <Text style={styles.kpiNum}>{kpi.awarded}<Text style={styles.kpiNumSecondary}> / {kpi.total}</Text></Text>
                <View style={styles.kpiPaceRow}>
                  <View style={[styles.pacePill, { backgroundColor: '#FF6A1A22' }]}>
                    <Text style={[styles.pacePillText, { color: '#FF6A1A' }]}>{kpi.open} open</Text>
                  </View>
                  <View style={[styles.pacePill, { backgroundColor: '#0D6CB122' }]}>
                    <Text style={[styles.pacePillText, { color: '#0D6CB1' }]}>{kpi.leveling} leveling</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* ── Packages list ────────────────────────────────── */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Scope packages</Text>
                <Text style={styles.sectionSub}>{packages.length === 0 ? 'No packages yet' : `${packages.length} package${packages.length === 1 ? '' : 's'}`}</Text>
              </View>

              {packages.length === 0 ? (
                <View style={styles.emptyPackages}>
                  <Package size={32} color={Colors.textMuted} />
                  <Text style={styles.emptyPackagesText}>
                    Create a scope package — Plumbing rough-in, Drywall, MEP, etc. Send it out for bid, log the responses, and let MAGE ID level them.
                  </Text>
                </View>
              ) : (
                packages.map(pkg => {
                  const bids = getBidsForPackage(pkg.id);
                  const lowest = bids.length > 0 ? bids.reduce((m, b) => b.amount < m ? b.amount : m, bids[0].amount) : 0;
                  const overdue = pkg.status !== 'awarded' && pkg.status !== 'cancelled'
                    && pkg.requiredByDate && new Date(pkg.requiredByDate) < new Date();
                  return (
                    <Pressable
                      key={pkg.id}
                      style={({ pressed }) => [styles.pkgCard, pressed && { opacity: 0.85 }]}
                      onPress={() => router.push({ pathname: '/buyout-package' as never, params: { packageId: pkg.id } as never })}
                    >
                      <View style={styles.pkgHead}>
                        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[pkg.status] }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.pkgName} numberOfLines={1}>{pkg.name}</Text>
                          <View style={styles.pkgMetaRow}>
                            {!!pkg.phase && <Text style={styles.pkgMeta}>{pkg.phase}</Text>}
                            <Text style={styles.pkgMeta}>·</Text>
                            <Text style={styles.pkgMeta}>{BID_PACKAGE_STATUS_LABELS[pkg.status]}</Text>
                            {overdue && (
                              <>
                                <Text style={styles.pkgMeta}>·</Text>
                                <Text style={[styles.pkgMeta, { color: Colors.error, fontWeight: '700' }]}>OVERDUE</Text>
                              </>
                            )}
                          </View>
                        </View>
                        <ChevronRight size={16} color={Colors.textMuted} />
                      </View>

                      <View style={styles.pkgBudgetRow}>
                        <View style={styles.pkgBudgetCell}>
                          <Text style={styles.pkgBudgetLabel}>Budget</Text>
                          <Text style={styles.pkgBudgetValue}>{formatMoney(pkg.estimateBudget)}</Text>
                        </View>
                        {pkg.status === 'awarded' && pkg.buyoutSavings != null ? (
                          <View style={styles.pkgBudgetCell}>
                            <Text style={styles.pkgBudgetLabel}>Buyout {pkg.buyoutSavings >= 0 ? 'savings' : 'overrun'}</Text>
                            <Text style={[styles.pkgBudgetValue, { color: pkg.buyoutSavings >= 0 ? Colors.success : Colors.error }]}>
                              {pkg.buyoutSavings >= 0 ? '+' : ''}{formatMoney(pkg.buyoutSavings)}
                            </Text>
                          </View>
                        ) : bids.length > 0 ? (
                          <View style={styles.pkgBudgetCell}>
                            <Text style={styles.pkgBudgetLabel}>Lowest bid · {bids.length} in</Text>
                            <Text style={styles.pkgBudgetValue}>{formatMoney(lowest)}</Text>
                          </View>
                        ) : (
                          <View style={styles.pkgBudgetCell}>
                            <Text style={styles.pkgBudgetLabel}>No bids yet</Text>
                            <Text style={styles.pkgBudgetValueMuted}>Send RFP →</Text>
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          </ScrollView>
        )}

        {/* New-package FAB row */}
        {project && (
          <View style={[styles.fabRow, { bottom: insets.bottom + 18 }]}>
            <TouchableOpacity
              style={styles.fabPrimary}
              onPress={() => setShowNewPkg(true)}
              activeOpacity={0.85}
            >
              <Plus size={18} color="#FFF" />
              <Text style={styles.fabPrimaryText}>New scope package</Text>
              <Sparkles size={12} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* New-package modal */}
        <Modal visible={showNewPkg} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewPkg(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: Colors.background }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>New scope package</Text>
              <TouchableOpacity onPress={() => setShowNewPkg(false)} hitSlop={12}>
                <X size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput style={styles.input} value={newPkgName} onChangeText={setNewPkgName} placeholder='e.g. "Plumbing rough-in"' placeholderTextColor={Colors.textMuted} autoFocus />

              <Text style={styles.fieldLabel}>Phase</Text>
              <TextInput style={styles.input} value={newPkgPhase} onChangeText={setNewPkgPhase} placeholder='e.g. "Rough-in", "Finishes"' placeholderTextColor={Colors.textMuted} />

              <Text style={styles.fieldLabel}>CSI Division</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.csiRow}>
                {CSI_DIVISIONS.map(d => (
                  <TouchableOpacity
                    key={d.code}
                    style={[styles.csiChip, newPkgCsi === d.code && styles.csiChipActive]}
                    onPress={() => setNewPkgCsi(d.code)}
                  >
                    <Text style={[styles.csiChipText, newPkgCsi === d.code && styles.csiChipTextActive]}>{d.code} · {d.name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Estimate item picker — links the package to specific
                  estimate line items so the budget rolls up automatically
                  and buyout savings are line-item accurate. */}
              {projectEstimateItems.length > 0 && (
                <>
                  <Text style={styles.fieldLabel}>Estimate items in this package</Text>
                  <Text style={styles.fieldHint}>Pick the line items this scope covers — budget auto-fills from the sum.</Text>
                  <View style={styles.itemsList}>
                    {projectEstimateItems.map(item => {
                      const picked = newPkgPickedItemIds.includes(item.materialId);
                      return (
                        <Pressable
                          key={item.materialId}
                          style={({ pressed }) => [
                            styles.itemRow,
                            picked && styles.itemRowPicked,
                            pressed && { opacity: 0.85 },
                          ]}
                          onPress={() => togglePickedItem(item.materialId)}
                        >
                          <View style={[styles.itemCheck, picked && styles.itemCheckActive]}>
                            {picked && <Text style={styles.itemCheckMark}>✓</Text>}
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={styles.itemTopRow}>
                              <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                              {item.isAllowance && (
                                <View style={styles.allowanceBadge}>
                                  <Text style={styles.allowanceBadgeText}>ALLOWANCE</Text>
                                </View>
                              )}
                            </View>
                            <Text style={styles.itemMeta}>{item.category} · {item.quantity} {item.unit} · ${Math.round(item.lineTotal).toLocaleString()}</Text>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                  {newPkgPickedItemIds.length > 0 && (
                    <View style={styles.pickedSummary}>
                      <Text style={styles.pickedSummaryText}>
                        {newPkgPickedItemIds.length} item{newPkgPickedItemIds.length === 1 ? '' : 's'} · ${Math.round(computedBudget).toLocaleString()} carry
                      </Text>
                      {allowanceCount > 0 && (
                        <Text style={styles.allowanceNote}>
                          ⚠️ {allowanceCount} allowance item{allowanceCount === 1 ? '' : 's'} included — awarding will lock to firm price.
                        </Text>
                      )}
                    </View>
                  )}
                </>
              )}

              <Text style={styles.fieldLabel}>Estimate budget (carry)</Text>
              <TextInput style={styles.input} value={newPkgBudget} onChangeText={setNewPkgBudget} placeholder='Auto-fills from selected items, or type manually' placeholderTextColor={Colors.textMuted} keyboardType="numeric" />

              <Text style={styles.tip}>You'll add bids on the next screen — by voice or by hand.</Text>
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreatePackage} activeOpacity={0.85}>
                <Save size={16} color="#FFF" />
                <Text style={styles.saveBtnText}>Create package</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  projectChipsRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 8, alignItems: 'center', flexDirection: 'row' as const },
  projectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder, maxWidth: 220 },
  projectChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  projectChipText: { fontSize: 13, fontWeight: '600' as const, color: Colors.text },
  projectChipTextActive: { color: '#FFF' },
  emptyChipText: { fontSize: 13, color: Colors.textMuted, paddingHorizontal: 4 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  emptyDesc: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  kpiBand: { flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingTop: 6 },
  kpiTile: { flex: 1, backgroundColor: Colors.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, gap: 6 },
  kpiTileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 18 },
  kpiLabel: { fontSize: 11, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  kpiNum: { fontSize: 28, fontWeight: '800' as const, color: Colors.text, letterSpacing: -0.5 },
  kpiNumSecondary: { color: Colors.textMuted, fontSize: 18, fontWeight: '600' as const },
  kpiSub: { fontSize: 11, color: Colors.textMuted },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: Colors.fillTertiary, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
  kpiAlert: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.error, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8 },
  kpiAlertText: { fontSize: 10, fontWeight: '700' as const, color: '#FFF', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiPaceRow: { flexDirection: 'row', gap: 6, marginTop: 2 },
  pacePill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  pacePillText: { fontSize: 11, fontWeight: '700' as const },

  section: { padding: 16, paddingBottom: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text, letterSpacing: -0.3 },
  sectionSub: { fontSize: 12, color: Colors.textMuted },

  emptyPackages: { backgroundColor: Colors.surface, borderRadius: 14, padding: 22, gap: 10, alignItems: 'center', borderWidth: 1, borderColor: Colors.cardBorder },
  emptyPackagesText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', lineHeight: 19 },

  pkgCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.cardBorder, marginBottom: 10, gap: 12 },
  pkgHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  pkgName: { fontSize: 15, fontWeight: '700' as const, color: Colors.text },
  pkgMetaRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  pkgMeta: { fontSize: 12, color: Colors.textMuted },
  pkgBudgetRow: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  pkgBudgetCell: { flex: 1 },
  pkgBudgetLabel: { fontSize: 10, fontWeight: '700' as const, color: Colors.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  pkgBudgetValue: { fontSize: 16, fontWeight: '700' as const, color: Colors.text },
  pkgBudgetValueMuted: { fontSize: 13, fontWeight: '600' as const, color: Colors.primary },

  fabRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 8 },
  fabPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 14, shadowColor: Colors.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  fabPrimaryText: { color: '#FFF', fontSize: 14, fontWeight: '700' as const },

  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  modalTitle: { fontSize: 18, fontWeight: '700' as const, color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600' as const, color: Colors.textMuted, marginTop: 14, marginBottom: 6 },
  fieldHint: { fontSize: 12, color: Colors.textMuted, marginTop: -2, marginBottom: 8, lineHeight: 16 },
  input: { backgroundColor: Colors.surface, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, fontSize: 15, color: Colors.text },
  tip: { fontSize: 12, color: Colors.textMuted, marginTop: 18, fontStyle: 'italic', textAlign: 'center' },
  csiRow: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  csiChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.cardBorder },
  csiChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  csiChipText: { fontSize: 12, fontWeight: '500' as const, color: Colors.text },
  csiChipTextActive: { color: '#FFF', fontWeight: '700' as const },
  itemsList: { gap: 6, marginTop: 4, marginBottom: 4 },
  itemRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: Colors.surface, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: Colors.cardBorder },
  itemRowPicked: { backgroundColor: Colors.primary + '0F', borderColor: Colors.primary + '60' },
  itemCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, marginTop: 1 },
  itemCheckActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  itemCheckMark: { color: '#FFF', fontWeight: '800' as const, fontSize: 13 },
  itemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  itemName: { fontSize: 14, fontWeight: '600' as const, color: Colors.text, flex: 1 },
  itemMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 2 },
  allowanceBadge: { backgroundColor: Colors.warning, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  allowanceBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },
  pickedSummary: { padding: 12, backgroundColor: Colors.primary + '10', borderRadius: 10, marginTop: 8, gap: 4 },
  pickedSummaryText: { fontSize: 13, fontWeight: '700' as const, color: Colors.primary },
  allowanceNote: { fontSize: 12, color: Colors.warning, fontWeight: '600' as const },
  modalFoot: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12 },
  saveBtnText: { color: '#FFF', fontSize: 15, fontWeight: '700' as const },
});
