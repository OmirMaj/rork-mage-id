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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Pressable, Platform, TextInput, Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Mic, ChevronRight, AlertTriangle, CheckCircle2,
  Clock, TrendingUp, TrendingDown, Package, X, Save, Check, Calendar,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { CSIDivisionPicker } from '@/components/CSIDivisionPicker';
import DatePickerModal from '@/components/DatePickerModal';
import { FeatureHeader } from '@/components/FeatureHeader';
import {
  BID_PACKAGE_STATUSES, BID_PACKAGE_STATUS_LABELS,
  type BidPackage, type BidPackageStatus,
} from '@/types';
import { formatCalendarDay } from '@/utils/calendarDate';
import { formatMoney } from '@/utils/formatters';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { cardSurface } from '@/components/ui';
import { estimateItemsToScope } from '@/utils/estimateItemsToScope';
import { fetchBidInvitesForProject } from '@/utils/bidInvites';
import { bidDueLabel, bidDueState, inviteCoverage, type BidInviteRecord } from '@/utils/bidInviteCore';

const STATUS_COLORS: Record<BidPackageStatus, string> = {
  open: '#FF6A1A',
  leveling: '#0D6CB1',
  awarded: '#16A34A',
  cancelled: '#9CA3AF',
};

// REMOVED: a private 19-entry CSI list.
//
// It carried the comment "we surface a residential-relevant subset (the full
// 50-division list would overwhelm a phone picker)", and it was rendered as a
// horizontal chip strip with no search — so choosing division 26 meant swiping
// past fifteen chips. The reasoning was sound for a strip and wrong for the
// app: components/CSIDivisionPicker.tsx already renders all fifty from the
// shared utils/csiMasterFormat.ts catalog, in a searchable modal, with an
// auto-suggest driven by the package name. That is strictly easier to use than
// nineteen chips, not harder.
//
// What the subset actually cost: a commercial bid package could not be filed
// under 13 Special Construction, 14 Conveying Equipment (the elevator sub on
// every mid-rise), 25 Integrated Automation, 28 Electronic Safety and
// Security, 41 Material Processing, or 48 Electrical Power Generation. Those
// are not exotic divisions — 14 and 28 are on most occupied-building jobs. The
// package could still be created, it just could not carry the address the
// project manual gives it, which is the entire reason the field exists.

export default function BuyoutScreen() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
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
    // OVERDUE now reads `dueDate`, the field the create sheet below actually
    // writes. It used to read `requiredByDate`, which has no writer anywhere in
    // the repo — so the badge and this count could never render, on a screen
    // whose whole job is telling him which packages are late.
    const now = Date.now();
    const overdue = packages.filter(p =>
      p.status !== 'awarded' && p.status !== 'cancelled' &&
      bidDueState(p.dueDate, now) === 'overdue'
    );
    const undated = packages.filter(p =>
      p.status !== 'awarded' && p.status !== 'cancelled' && !p.dueDate
    );
    return {
      total, awarded, open, leveling, totalBudget, committedBudget, pctBoughtOut, savingsToDate,
      overdue: overdue.length, undated: undated.length,
    };
  }, [packages]);

  // ── Who still owes him a number, across every package ───────────────────
  // ONE project-scoped read, not one per card: finding out who had gone quiet
  // used to mean opening eight packages, each firing its own fetch.
  //
  // `null` from the fetch means the read FAILED, which is not the same as "no
  // invites" — a card that says "nobody invited" over a dropped read sends him
  // to re-invite subs who are already holding a live link. So the coverage line
  // is simply omitted when we could not read, rather than rendered as zero.
  const [invites, setInvites] = useState<BidInviteRecord[]>([]);
  const [invitesLoaded, setInvitesLoaded] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const projectId = project?.id;
    if (!projectId) { setInvites([]); setInvitesLoaded(false); return; }
    setInvitesLoaded(false);
    void fetchBidInvitesForProject(projectId).then(rows => {
      if (cancelled) return;
      if (rows === null) { setInvitesLoaded(false); return; }
      setInvites(rows);
      setInvitesLoaded(true);
    });
    return () => { cancelled = true; };
  }, [project?.id]);

  const invitesByPackage = useMemo(() => {
    const map = new Map<string, BidInviteRecord[]>();
    for (const inv of invites) {
      const list = map.get(inv.packageId);
      if (list) list.push(inv); else map.set(inv.packageId, [inv]);
    }
    return map;
  }, [invites]);

  // ── New package modal ───────────────────────────────────────────
  const [showNewPkg, setShowNewPkg] = useState(false);
  const [newPkgName, setNewPkgName] = useState('');
  const [newPkgPhase, setNewPkgPhase] = useState('');
  const [newPkgCsi, setNewPkgCsi] = useState('');
  const [newPkgBudget, setNewPkgBudget] = useState('');
  const [newPkgPickedItemIds, setNewPkgPickedItemIds] = useState<string[]>([]);
  // The one thing on this screen that genuinely needs new capture. Everything
  // else here is derived from the estimate; nobody anywhere in the app has ever
  // been asked when the bids are wanted, which is why the invite email could
  // only offer the link's 30-day expiry as a date.
  const [newPkgDueDate, setNewPkgDueDate] = useState('');
  const [showDuePicker, setShowDuePicker] = useState(false);

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
  const lastAutoBudgetRef = useRef<string>('');
  useEffect(() => {
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
      showAlert('Pick a project first');
      return;
    }
    if (!newPkgName.trim()) {
      showAlert('Name required', 'Give the package a name like "Plumbing rough-in".');
      return;
    }
    const budget = Number(newPkgBudget) || 0;
    // Seed the scope from the line items he just ticked. `scopeDescription` is
    // the only description of the work the bidder ever sees — it is what the
    // invite email prints and what `bid_invite_get` hands the sub-facing page —
    // and until now nothing in the app wrote it for a hand-made package, so the
    // sub was asked to price a package NAME at an address. Quantities and units
    // only; the carry stays on this side of the wall.
    //
    // Persisted here rather than composed at send time because the sub's page
    // reads `bid_packages.scope_description` server-side: a scope that only
    // existed inside the send call would reach the email and never the page.
    // It is a seed — the package screen edits it.
    const pickedItems = projectEstimateItems.filter(i => newPkgPickedItemIds.includes(i.materialId));
    const seededScope = estimateItemsToScope(pickedItems);
    const newPkg = addBidPackage({
      projectId: project.id,
      name: newPkgName.trim(),
      phase: newPkgPhase.trim() || undefined,
      csiDivision: newPkgCsi.trim() || undefined,
      scopeDescription: seededScope || undefined,
      linkedEstimateItemIds: newPkgPickedItemIds,
      estimateBudget: budget,
      dueDate: newPkgDueDate || undefined,
      status: 'open',
    });
    setShowNewPkg(false);
    setNewPkgName('');
    setNewPkgPhase('');
    setNewPkgCsi('');
    setNewPkgBudget('');
    setNewPkgPickedItemIds([]);
    setNewPkgDueDate('');
    lastAutoBudgetRef.current = '';
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.push({ pathname: '/buyout-package' as never, params: { packageId: newPkg.id } as never });
  }, [project, newPkgName, newPkgPhase, newPkgCsi, newPkgBudget, newPkgPickedItemIds, newPkgDueDate, projectEstimateItems, addBidPackage, router]);

  return (
    <>
      <Stack.Screen options={{ title: 'Buyout', headerLargeTitle: false }} />
      {/* Native iOS header already accounts for the safe area (notch/
          dynamic island). Manual `insets.top + 8` was double-counting
          and producing a tall blank gap above the project chip row. */}
      <View style={[styles.root, { backgroundColor: themeColors.bg, paddingTop: 8 }]}>
        <FeatureHeader
          eyebrow="Subcontractor Awards"
          title="Get your subs to bid"
          subtitle="Take your estimate, send it for bids, lock in the lowest. We track every dollar saved between estimate and what you actually pay."
          explainer={{
            term: 'Buyout',
            definition: 'In construction, "buyout" is the process of taking the bids you got from subcontractors and converting the lowest acceptable one into a signed contract. The savings between your original estimate and the awarded price is your "buyout savings" — straight to the bottom line.',
            whenToUse: [
              'After your estimate is approved, you\'re ready to start awarding work',
              'You want to track how much you saved (or overspent) by trade',
              'You need to issue contracts to subs in a structured way',
            ],
          }}
        />

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
            <Package size={48} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.emptyTitle}>No project selected</Text>
            <Text style={styles.emptyDesc}>Pick a project above to see its buyout dashboard.</Text>
          </View>
        ) : (
          <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
            {/* ── KPI band ─────────────────────────────────────── */}
            <View style={styles.kpiBand}>
              <View style={styles.kpiTile}>
                <View style={styles.kpiTileTopRow}>
                  <Text style={styles.kpiLabel}>Bought out</Text>
                  {kpi.overdue > 0 && (
                    <View style={styles.kpiAlert}>
                      <AlertTriangle size={11} color="#FFF" strokeWidth={1.75} />
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
                  <Text style={styles.kpiLabel} numberOfLines={1}>{kpi.savingsToDate >= 0 ? 'Savings' : 'Overrun'}</Text>
                  {kpi.savingsToDate >= 0
                    ? <TrendingUp size={14} color={themeColors.success} strokeWidth={1.75} />
                    : <TrendingDown size={14} color={themeColors.danger} strokeWidth={1.75} />}
                </View>
                <Text style={[styles.kpiNum, { color: kpi.savingsToDate >= 0 ? themeColors.success : themeColors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
                  {kpi.savingsToDate >= 0 ? '+' : ''}{formatMoney(kpi.savingsToDate)}
                </Text>
                <Text style={styles.kpiSub} numberOfLines={2}>vs. estimate</Text>
              </View>

              <View style={styles.kpiTile}>
                <View style={styles.kpiTileTopRow}>
                  <Text style={styles.kpiLabel} numberOfLines={1}>Packages</Text>
                </View>
                <Text style={styles.kpiNum}>{kpi.awarded}<Text style={styles.kpiNumSecondary}> / {kpi.total}</Text></Text>
                <View style={styles.kpiPaceRow}>
                  <View style={[styles.pacePill, { backgroundColor: '#FF6A1A22' }]}>
                    <Text style={[styles.pacePillText, { color: themeColors.accent }]} numberOfLines={1}>{kpi.open} open</Text>
                  </View>
                  <View style={[styles.pacePill, { backgroundColor: '#0D6CB122' }]}>
                    <Text style={[styles.pacePillText, { color: '#0D6CB1' }]} numberOfLines={1}>{kpi.leveling} lvl</Text>
                  </View>
                </View>
              </View>
            </View>

            {/* ── Packages list ────────────────────────────────── */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Scope packages</Text>
                {/* Naming the undated packages is the honest half of the
                    OVERDUE badge: "nothing is late" and "nothing has a date to
                    be late against" look identical otherwise. */}
                <Text style={styles.sectionSub}>
                  {packages.length === 0
                    ? 'No packages yet'
                    : `${packages.length} package${packages.length === 1 ? '' : 's'}${kpi.undated > 0 ? ` · ${kpi.undated} with no bid date` : ''}`}
                </Text>
              </View>

              {packages.length === 0 ? (
                <View style={styles.emptyPackages}>
                  <Package size={32} color={themeColors.textMuted} strokeWidth={1.75} />
                  <Text style={styles.emptyPackagesText}>
                    Create a scope package — Plumbing rough-in, Drywall, MEP, etc. Send it out for bid, log the responses, and let MAGE ID level them.
                  </Text>
                </View>
              ) : (
                packages.map(pkg => {
                  const bids = getBidsForPackage(pkg.id);
                  const lowest = bids.length > 0 ? bids.reduce((m, b) => b.amount < m ? b.amount : m, bids[0].amount) : 0;
                  const live = pkg.status !== 'awarded' && pkg.status !== 'cancelled';
                  const dueState = bidDueState(pkg.dueDate, Date.now());
                  const overdue = live && dueState === 'overdue';
                  // Only rendered when the invite read actually succeeded —
                  // "0 invited" over a dropped read is a claim we cannot make.
                  const pkgInvites = invitesLoaded ? (invitesByPackage.get(pkg.id) ?? []) : null;
                  const cover = pkgInvites ? inviteCoverage(pkgInvites, Date.now()) : null;
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
                                <Text style={[styles.pkgMeta, { color: themeColors.danger, fontWeight: '700' }]}>OVERDUE</Text>
                              </>
                            )}
                          </View>
                          {/* The chase line: when the number is wanted, and who
                              still owes him one. Both were invisible from this
                              screen — finding out meant opening every package. */}
                          {live && (
                            <View style={styles.pkgChaseRow}>
                              <Clock
                                size={Type.caption2.fontSize}
                                color={dueState === 'overdue' ? themeColors.danger
                                  : dueState === 'none' ? themeColors.textMuted : themeColors.accent}
                                strokeWidth={2}
                              />
                              <Text
                                style={[
                                  styles.pkgChaseText,
                                  dueState === 'overdue' && { color: themeColors.danger, fontWeight: '700' },
                                ]}
                                numberOfLines={1}
                              >
                                {bidDueLabel(pkg.dueDate, Date.now())}
                                {cover && cover.invited > 0
                                  ? ` · ${cover.responded} of ${cover.invited} answered${cover.awaiting > 0 ? ` · ${cover.awaiting} to chase` : ''}`
                                  : ''}
                              </Text>
                            </View>
                          )}
                        </View>
                        <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      </View>

                      <View style={styles.pkgBudgetRow}>
                        <View style={styles.pkgBudgetCell}>
                          <Text style={styles.pkgBudgetLabel}>Budget</Text>
                          <Text style={styles.pkgBudgetValue}>{formatMoney(pkg.estimateBudget)}</Text>
                        </View>
                        {pkg.status === 'awarded' && pkg.buyoutSavings != null ? (
                          <View style={styles.pkgBudgetCell}>
                            <Text style={styles.pkgBudgetLabel}>Buyout {pkg.buyoutSavings >= 0 ? 'savings' : 'overrun'}</Text>
                            <Text style={[styles.pkgBudgetValue, { color: pkg.buyoutSavings >= 0 ? themeColors.success : themeColors.danger }]}>
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
              <Plus size={18} color="#FFF" strokeWidth={1.75} />
              <Text style={styles.fabPrimaryText}>New scope package</Text>
              <MageAIMark size={12} color="#FFF" />
            </TouchableOpacity>
          </View>
        )}

        {/* New-package modal */}
        <Modal visible={showNewPkg} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowNewPkg(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: themeColors.bg }}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>New scope package</Text>
              <TouchableOpacity onPress={() => setShowNewPkg(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 20 }}>
              <Text style={styles.fieldLabel}>Name *</Text>
              <TextInput style={styles.input} value={newPkgName} onChangeText={setNewPkgName} placeholder='e.g. "Plumbing rough-in"' placeholderTextColor={themeColors.textMuted} autoFocus />

              <Text style={styles.fieldLabel}>Phase</Text>
              <TextInput style={styles.input} value={newPkgPhase} onChangeText={setNewPkgPhase} placeholder='e.g. "Rough-in", "Finishes"' placeholderTextColor={themeColors.textMuted} />

              <Text style={styles.fieldLabel}>CSI Division</Text>
              {/* All fifty divisions, searchable, with a suggestion derived
                  from what he has already typed — the package name is usually
                  the trade, so the right division is normally one tap. */}
              <View style={styles.csiRow}>
                <CSIDivisionPicker
                  value={newPkgCsi || undefined}
                  onChange={next => setNewPkgCsi(next ?? '')}
                  suggestFromText={`${newPkgName} ${newPkgPhase}`.trim()}
                  testID="buyout-csi-division"
                />
              </View>

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
                            {picked && <Check size={Type.footnote.fontSize} color="#FFF" strokeWidth={2.5} />}
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
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 5 }}>
                          <AlertTriangle size={Type.caption1.fontSize} color={themeColors.accent} strokeWidth={2} />
                          <Text style={[styles.allowanceNote, { flex: 1 }]}>
                            {allowanceCount} allowance item{allowanceCount === 1 ? '' : 's'} included — awarding will lock to firm price.
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              <Text style={styles.fieldLabel}>Estimate budget (carry)</Text>
              <TextInput style={styles.input} value={newPkgBudget} onChangeText={setNewPkgBudget} placeholder='Auto-fills from selected items, or type manually' placeholderTextColor={themeColors.textMuted} keyboardType="numeric" />

              {/* Bids due. The invite could only ever tell a sub "this link
                  stops working in 30 days" — the link's expiry, not a
                  deadline — because no screen in the app asked when the number
                  was wanted. A sub who has a busy week reads thirty days and
                  files it. */}
              <Text style={styles.fieldLabel}>Bids due</Text>
              <TouchableOpacity
                style={styles.dueField}
                onPress={() => setShowDuePicker(true)}
                activeOpacity={0.8}
                testID="buyout-due-date"
                accessibilityRole="button"
                accessibilityLabel={newPkgDueDate ? `Bids due ${formatCalendarDay(newPkgDueDate)}. Change` : 'Set the date bids are due'}
              >
                <Calendar size={16} color={newPkgDueDate ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
                <Text style={[styles.dueFieldText, !newPkgDueDate && { color: themeColors.textMuted }]}>
                  {newPkgDueDate
                    ? formatCalendarDay(newPkgDueDate, { weekday: 'short', month: 'short', day: 'numeric' })
                    : 'Pick a date'}
                </Text>
                {!!newPkgDueDate && (
                  <Text style={styles.dueFieldHint}>{bidDueLabel(newPkgDueDate, Date.now())}</Text>
                )}
              </TouchableOpacity>
              <View style={styles.dueChipRow}>
                {[
                  { label: 'In 1 week', days: 7 },
                  { label: 'In 2 weeks', days: 14 },
                  { label: 'In 3 weeks', days: 21 },
                ].map(chip => (
                  <TouchableOpacity
                    key={chip.days}
                    style={styles.dueChip}
                    onPress={() => {
                      // Noon, same as DatePickerModal writes, so the stored
                      // instant lands on the intended calendar day in every
                      // device zone rather than shifting a day at midnight.
                      const d = new Date();
                      d.setDate(d.getDate() + chip.days);
                      d.setHours(12, 0, 0, 0);
                      setNewPkgDueDate(d.toISOString());
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.dueChipText}>{chip.label}</Text>
                  </TouchableOpacity>
                ))}
                {!!newPkgDueDate && (
                  <TouchableOpacity style={styles.dueChip} onPress={() => setNewPkgDueDate('')} activeOpacity={0.8}>
                    <Text style={[styles.dueChipText, { color: themeColors.textMuted }]}>Clear</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.fieldHint}>
                {newPkgDueDate
                  ? 'This is the date this screen chases from — packages past it show OVERDUE, and the package screen can re-send to whoever has not answered.'
                  : 'Optional, but without it nothing can tell you a package is late: the invite only says the link expires in 30 days, which is not a deadline.'}
              </Text>

              <Text style={styles.tip}>You'll add bids on the next screen — by voice or by hand.</Text>
            </ScrollView>
            <View style={[styles.modalFoot, { paddingBottom: insets.bottom + 12 }]}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreatePackage} activeOpacity={0.85}>
                <Save size={16} color="#FFF" strokeWidth={1.75} />
                <Text style={styles.saveBtnText}>Create package</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
          {/* allowFuture: a bid deadline is always ahead of today, and the
              picker blocks future dates unless told otherwise. */}
          <DatePickerModal
            visible={showDuePicker}
            value={newPkgDueDate}
            onClose={() => setShowDuePicker(false)}
            onChange={iso => { setNewPkgDueDate(iso); setShowDuePicker(false); }}
            title="When are bids due?"
            allowFuture
          />
        </Modal>
      </View>
    </>
  );
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },
  projectChipsRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10, gap: 8, alignItems: 'center', flexDirection: 'row' as const },
  projectChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: t.surface, borderWidth: 1, borderColor: t.line, maxWidth: 220 },
  projectChipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  projectChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.text },
  projectChipTextActive: { color: '#FFF' },
  emptyChipText: { fontSize: Type.footnote.fontSize, color: t.textMuted, paddingHorizontal: 4 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: t.textMuted, textAlign: 'center' },

  kpiBand: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingTop: 6 },
  kpiTile: { flex: 1, minWidth: 0, backgroundColor: t.surface, borderRadius: Tokens.radius.panel, padding: 12, borderWidth: 1, borderColor: t.line, gap: 6 },
  kpiTileTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 18 },
  kpiLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase' },
  kpiNum: { fontSize: Type.title1.fontSize, fontWeight: '800' as const, color: t.text, letterSpacing: -0.5 },
  kpiNumSecondary: { color: t.textMuted, fontSize: Type.subheadline.fontSize, fontWeight: '600' as const },
  kpiSub: { fontSize: Type.caption2.fontSize, color: t.textMuted },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: t.line, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: t.accent, borderRadius: 2 },
  kpiAlert: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: t.danger, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.sm },
  kpiAlertText: { fontSize: 10, fontWeight: '700' as const, color: '#FFF', textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiPaceRow: { flexDirection: 'row', gap: 4, marginTop: 2, flexWrap: 'wrap' as const },
  pacePill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: Tokens.radius.sm, flexShrink: 0 },
  pacePillText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },

  section: { padding: 16, paddingBottom: 8 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text, letterSpacing: -0.3 },
  sectionSub: { fontSize: Type.caption1.fontSize, color: t.textMuted },

  emptyPackages: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 22, gap: 10, alignItems: 'center', borderWidth: 1, borderColor: t.line },
  emptyPackagesText: { fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center', lineHeight: 19 },

  pkgCard: { backgroundColor: t.surface, borderRadius: Tokens.radius.lg, padding: 14, borderWidth: 1, borderColor: t.line, marginBottom: 10, gap: 12 },
  pkgHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  pkgName: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  pkgMetaRow: { flexDirection: 'row', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  pkgMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  pkgChaseRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 },
  pkgChaseText: { flex: 1, fontSize: Type.caption2.fontSize, color: t.textMuted, fontWeight: '600' as const },
  pkgBudgetRow: { flexDirection: 'row', gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  pkgBudgetCell: { flex: 1 },
  pkgBudgetLabel: { fontSize: 10, fontWeight: '700' as const, color: t.textMuted, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  pkgBudgetValue: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: t.text },
  pkgBudgetValueMuted: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.accent },

  fabRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 8 },
  fabPrimary: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.lg, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 5 },
  fabPrimaryText: { color: '#FFF', fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },

  modalHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 18, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textMuted, marginTop: 14, marginBottom: 6 },
  fieldHint: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: -2, marginBottom: 8, lineHeight: 16 },
  input: { backgroundColor: t.surface, paddingHorizontal: 14, paddingVertical: 12, borderRadius: Tokens.radius.card, borderWidth: 1, borderColor: t.line, fontSize: Type.subhead.fontSize, color: t.text },
  tip: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 18, fontStyle: 'italic', textAlign: 'center' },
  dueField: { ...cardSurface(t, { radius: 'card', pad: 'none' }), flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  dueFieldText: { fontSize: Type.subhead.fontSize, color: t.text, fontWeight: '600' as const },
  dueFieldHint: { flex: 1, textAlign: 'right', fontSize: Type.caption1.fontSize, color: t.textMuted },
  dueChipRow: { flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  dueChip: { ...cardSurface(t, { radius: 'full', pad: 'none' }), paddingHorizontal: 10, paddingVertical: 6 },
  dueChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.text },
  // csiChip* styles deleted with the 19-chip strip they dressed — the shared
  // CSIDivisionPicker brings its own.
  csiRow: { flexDirection: 'row', paddingBottom: 4 },
  itemsList: { gap: 6, marginTop: 4, marginBottom: 4 },
  itemRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: t.surface, padding: 12, borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line },
  itemRowPicked: { backgroundColor: t.accent + '0F', borderColor: t.accent + '60' },
  itemCheck: { width: 22, height: 22, borderRadius: Tokens.radius.xs, borderWidth: 2, borderColor: t.line, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, marginTop: 1 },
  itemCheckActive: { backgroundColor: t.accent, borderColor: t.accent },
  itemCheckMark: { color: '#FFF', fontWeight: '800' as const, fontSize: Type.footnote.fontSize },
  itemTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  itemName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: t.text, flex: 1 },
  itemMeta: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },
  allowanceBadge: { backgroundColor: t.accentFill, paddingHorizontal: 6, paddingVertical: 2, borderRadius: Tokens.radius.xs },
  allowanceBadgeText: { fontSize: 9, fontWeight: '800' as const, color: '#FFF', letterSpacing: 0.5 },
  pickedSummary: { padding: 12, backgroundColor: t.accent + '10', borderRadius: Tokens.radius.md, marginTop: 8, gap: 4 },
  pickedSummaryText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accent },
  allowanceNote: { fontSize: Type.caption1.fontSize, color: t.accent, fontWeight: '600' as const },
  modalFoot: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: t.accentFill, paddingVertical: 14, borderRadius: Tokens.radius.card },
  saveBtnText: { color: '#FFF', fontSize: Type.subhead.fontSize, fontWeight: '700' as const },
});
