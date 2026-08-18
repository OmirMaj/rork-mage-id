import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, X, CheckCircle, Clock, Eye, MessageSquare,
  Trash2, Link2, ChevronDown, Mic, ListChecks, ChevronRight, Filter, MapPin,
} from 'lucide-react-native';
import { MagePunch } from '@/components/icons';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import type { PunchItem, PunchItemStatus, PunchItemPriority, SubTrade } from '@/types';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor } from '@/utils/workflowPipelines';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { getPunchTemplatesByTrade, type PunchTemplate } from '@/constants/punchTemplates';
import { showAlert } from '@/utils/alert';

// Top-level row IDs (punch items) become Supabase PKs and MUST be UUIDs —
// the punch_items.id column rejects anything else with "invalid input syntax
// for type uuid", which is silently swallowed by supabaseWrite. Prefix is
// kept as a debugging hint but the ID itself is always a real UUID.
function createId(_prefix: string): string {
  return generateUUID();
}

function getStatusConfig(t: ThemeColors, status: PunchItemStatus): { label: string; color: string; bg: string } {
  switch (status) {
    // Soft fill + label/saturated foreground, matching the two cases below.
    // These badges are tappable to advance status, so the label and its "›"
    // have to stay readable — fg === bg rendered them as solid colour blobs.
    // There is no `infoSoft` token, so in-progress uses the repo-wide
    // `info + '1F'` soft fill (payments.tsx, warranties.tsx, ui/Badge.tsx).
    case 'open': return { label: 'Open', color: t.dangerLabel, bg: t.dangerSoft };
    case 'in_progress': return { label: 'In Progress', color: t.info, bg: t.info + '1F' };
    case 'ready_for_review': return { label: 'Review', color: t.accent, bg: t.accentSoft };
    case 'closed': return { label: 'Closed', color: t.success, bg: t.successSoft };
  }
}

function getPriorityConfig(t: ThemeColors, p: PunchItemPriority): { label: string; color: string } {
  switch (p) {
    case 'low': return { label: 'Low', color: t.textMuted };
    case 'medium': return { label: 'Medium', color: t.accent };
    case 'high': return { label: 'High', color: t.danger };
  }
}

export default function PunchListScreen() {
  const router = useRouter();
  const { canAccess } = useTierAccess();
  const { colors: themeColors } = useTheme();
  if (!canAccess('punch_list_closeout')) {
    return (
      <Paywall
        visible={true}
        feature="Punch List & Closeout"
        requiredTier="business"
        onClose={() => router.back()}
      />
    );
  }
  return <PunchListScreenInner />;
}

function PunchListScreenInner() {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId: paramProjectId, prefillPhotoUri, prefillPhotoId } = useLocalSearchParams<{
    projectId: string;
    prefillPhotoUri?: string;
    prefillPhotoId?: string;
  }>();
  const { projects, getProject, getPunchItemsForProject, addPunchItem, updatePunchItem, deletePunchItem, updateProject, subcontractors } = useProjects();

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  const items = useMemo(() => getPunchItemsForProject(projectId ?? ''), [projectId, getPunchItemsForProject]);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PunchItem | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [assignedSub, setAssignedSub] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<PunchItemPriority>('medium');
  const [linkedTaskId, setLinkedTaskId] = useState<string>('');
  // Optional photo URI to attach when creating a new item — comes from
  // the photo annotator's "Add to Punch List" flow. Surfaces in the
  // form as a thumbnail badge so the GC sees what they're attaching.
  const [attachedPhotoUri, setAttachedPhotoUri] = useState<string | undefined>(undefined);

  // When arriving from photo-annotator with a prefill, open the new-item
  // form auto-attached to that photo. Only fires once per mount.
  useEffect(() => {
    if (prefillPhotoUri || prefillPhotoId) {
      setAttachedPhotoUri(prefillPhotoUri);
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showTaskPicker, setShowTaskPicker] = useState(false);

  // ── Trade-specific templates ─────────────────────────────────
  // Pre-built checklists for common trade walks (electrical rough-in,
  // plumbing trim, drywall finish, etc.). The picker lets the GC drop
  // 8-12 known items in one tap; they edit / discard from there. Saves
  // 5+ minutes per trade walk vs. typing each item by hand.
  const [showTemplates, setShowTemplates] = useState(false);
  const templateGroups = useMemo(() => getPunchTemplatesByTrade(), []);

  const handleApplyTemplate = useCallback((template: PunchTemplate) => {
    if (!projectId) return;
    let added = 0;
    const now = new Date().toISOString();
    for (const item of template.items) {
      const punch: PunchItem = {
        id: generateUUID(),
        projectId,
        description: item.description,
        location: '',
        assignedSub: template.trade === 'General' || template.trade === 'Other' ? '' : template.trade,
        dueDate: '',
        priority: item.priority,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      addPunchItem(punch);
      added += 1;
    }
    setShowTemplates(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showAlert(
      'Template applied',
      `Added ${added} item${added === 1 ? '' : 's'} from "${template.label}". Edit or remove any that don't apply to this project.`,
    );
  }, [projectId, addPunchItem]);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PunchItemStatus | 'all'>('all');
  // Multi-axis filters layered on top of status. Each filter is an
  // OR within its axis but AND across axes so the GC can drill down
  // ("show me all open electrical items assigned to Acme that are
  // high or critical priority"). Empty string = "any" for that axis.
  const [filterSub, setFilterSub] = useState<string>('');         // matches PunchItem.assignedSub
  const [filterPriority, setFilterPriority] = useState<PunchItemPriority | 'all'>('all');
  const [filterLocation, setFilterLocation] = useState<string>(''); // free-text contains
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const resetForm = useCallback(() => {
    setDescription(''); setLocation(''); setAssignedSub('');
    setDueDate(''); setPriority('medium'); setEditingItem(null);
    setLinkedTaskId('');
    // Clear any attached photo so a cancelled form doesn't silently carry
    // it into the next new item.
    setAttachedPhotoUri(undefined);
  }, []);

  // The only path that puts a REAL item in `editingItem`. Before this every
  // route into the sheet ran resetForm() first, which meant `editingItem` was
  // never anything but null — so the status breadcrumb gated on it was dead
  // code and the sheet could only ever create. Mirrors openEditForm in
  // app/permits.tsx: hydrate the form from the record, then open.
  const openEditForm = useCallback((item: PunchItem) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingItem(item);
    setDescription(item.description);
    setLocation(item.location ?? '');
    setAssignedSub(item.assignedSub ?? '');
    // The field is declared YYYY-MM-DD; Supabase-synced items can carry a full
    // ISO timestamp. Slice to the form's own format (same as permits) rather
    // than seeding the input with a value it doesn't accept.
    setDueDate((item.dueDate ?? '').slice(0, 10));
    setPriority(item.priority);
    setLinkedTaskId(item.linkedTaskId ?? '');
    // The sheet has no photo control — only a preview for the annotator's
    // "Add to Punch List" prefill — and handleSave's update branch does not
    // touch photoUri. Clearing avoids showing a previous prefill's photo (with
    // a remove button that would do nothing) on top of someone else's item.
    setAttachedPhotoUri(undefined);
    setShowForm(true);
  }, []);

  const closedCount = items.filter(i => i.status === 'closed').length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0;
  const allClosed = totalCount > 0 && closedCount === totalCount;

  const filteredItems = useMemo(() => {
    let out = items;
    if (filterStatus !== 'all') out = out.filter(i => i.status === filterStatus);
    if (filterSub) out = out.filter(i => (i.assignedSub ?? '').toLowerCase() === filterSub.toLowerCase());
    if (filterPriority !== 'all') out = out.filter(i => i.priority === filterPriority);
    if (filterLocation) {
      const needle = filterLocation.toLowerCase();
      out = out.filter(i => (i.location ?? '').toLowerCase().includes(needle));
    }
    return out;
  }, [items, filterStatus, filterSub, filterPriority, filterLocation]);

  // Distinct values for the filter chip rows. Drawn live from the items
  // so as the GC adds new subs / priorities, the filter row picks them
  // up without code changes.
  const subsInList = useMemo(() => {
    const set = new Set<string>();
    for (const i of items) {
      const s = (i.assignedSub ?? '').trim();
      if (s) set.add(s);
    }
    return Array.from(set).sort();
  }, [items]);

  const activeFilterCount = useMemo(() => {
    return (filterStatus !== 'all' ? 1 : 0)
      + (filterSub ? 1 : 0)
      + (filterPriority !== 'all' ? 1 : 0)
      + (filterLocation ? 1 : 0);
  }, [filterStatus, filterSub, filterPriority, filterLocation]);

  const clearAllFilters = useCallback(() => {
    setFilterStatus('all');
    setFilterSub('');
    setFilterPriority('all');
    setFilterLocation('');
  }, []);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) {
      showAlert('Missing Description', 'Please describe the punch item.');
      return;
    }
    const linkedTaskName = linkedTask?.title;
    if (editingItem) {
      updatePunchItem(editingItem.id, {
        description: desc, location: location.trim(), assignedSub: assignedSub.trim(),
        dueDate, priority,
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskName: linkedTaskName || undefined,
      });
    } else {
      const item: PunchItem = {
        id: createId('punch'), projectId: projectId ?? '', description: desc,
        location: location.trim(), assignedSub: assignedSub.trim(), dueDate,
        priority, status: 'open',
        linkedTaskId: linkedTaskId || undefined,
        linkedTaskName: linkedTaskName || undefined,
        photoUri: attachedPhotoUri,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addPunchItem(item);
    }
    setShowForm(false);
    setAttachedPhotoUri(undefined);
    resetForm();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [description, location, assignedSub, dueDate, priority, linkedTaskId, linkedTask, editingItem, projectId, addPunchItem, updatePunchItem, resetForm, attachedPhotoUri]);

  const handleStatusChange = useCallback((item: PunchItem, newStatus: PunchItemStatus) => {
    const updates: Partial<PunchItem> = { status: newStatus };
    if (newStatus === 'closed') updates.closedAt = new Date().toISOString();
    updatePunchItem(item.id, updates);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();

    // Auto-suggest project closeout when this close zeros out the open
    // count. Pre-fix the GC could close every punch item and the
    // project would stay 'in_progress' indefinitely. Now we prompt right
    // when they hit the milestone, while the closeout intent is fresh.
    if (newStatus === 'closed' && projectId && project) {
      const others = items.filter((p: PunchItem) => p.projectId === projectId && p.id !== item.id);
      const allOthersClosed = others.length > 0 && others.every((p: PunchItem) => p.status === 'closed');
      const wasLastOpen = others.length === 0 || allOthersClosed;
      if (wasLastOpen && project.status === 'in_progress') {
        // Defer past the current render so the badge animation doesn't
        // fight the alert pop-in.
        setTimeout(() => {
          showAlert(
            'All punch items closed',
            `Nice — ${project.name}'s punch list is wrapped. Close the project so it stops showing in your active list?`,
            [
              { text: 'Not yet', style: 'cancel' },
              {
                text: 'Close Project',
                onPress: () => {
                  // Land in the SAME terminal state the Close Project button
                  // sets — 'closed' + closedAt — so both paths agree instead
                  // of one leaving the project 'completed' and the other 'closed'.
                  updateProject(project.id, { status: 'closed', closedAt: new Date().toISOString() });
                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                },
              },
            ],
          );
        }, 250);
      }
    }
  }, [updatePunchItem, projectId, project, items, updateProject]);

  // Tap-the-badge quick toggle: advance to the next stage in the linear flow.
  // open → in_progress → ready_for_review → closed. Closed is terminal.
  const advanceStatus = useCallback((item: PunchItem) => {
    const nextByStatus: Record<PunchItemStatus, PunchItemStatus | null> = {
      open: 'in_progress',
      in_progress: 'ready_for_review',
      ready_for_review: 'closed',
      closed: null,
    };
    const next = nextByStatus[item.status];
    if (!next) return;
    handleStatusChange(item, next);
  }, [handleStatusChange]);

  const handleReject = useCallback((itemId: string) => {
    const note = rejectionNote.trim();
    updatePunchItem(itemId, { status: 'open', rejectionNote: note || 'Rejected — needs rework' });
    setShowRejectModal(null);
    setRejectionNote('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rejectionNote, updatePunchItem]);

  const handleCloseProject = useCallback(() => {
    if (!allClosed) {
      showAlert('Cannot Close', 'All punch items must be resolved before closing the project.');
      return;
    }
    showAlert('Close Project', 'Mark this project as closed? This will archive it.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close Project',
        onPress: () => {
          updateProject(projectId ?? '', { status: 'closed', closedAt: new Date().toISOString() });
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showAlert('Project Closed', 'This project has been archived.');
          router.back();
        },
      },
    ]);
  }, [allClosed, projectId, updateProject, router]);

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Punch List' }} />
        <ToolProjectPicker
          toolName="Punch List"
          message="Punch lists are tied to a project so each item links to its trade and location."
          projects={projects}
          onPick={setPickedProjectId}
          staleProjectId={staleProjectId}
          icon={<MagePunch size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Punch List inside the project tile grid.',
            'Hit + to add the first item, or run an AI walk-through to seed it from photos.',
          ]}
        />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `Punch List — ${project.name}` }} />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.progressSection}>
          <View style={styles.progressHeader}>
            <Text style={styles.progressTitle}>Completion</Text>
            <Text style={styles.progressPercent}>{progressPercent}%</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
          </View>
          <Text style={styles.progressSub}>{closedCount} of {totalCount} items closed</Text>
        </View>

        <View style={styles.filterBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {(['all', 'open', 'in_progress', 'ready_for_review', 'closed'] as const).map(s => {
              const count = s === 'all' ? items.length : items.filter(i => i.status === s).length;
              const config = s === 'all' ? { label: 'All', color: themeColors.text, bg: themeColors.line } : getStatusConfig(themeColors, s);
              return (
                <TouchableOpacity
                  key={s}
                  style={[styles.filterChip, filterStatus === s && { backgroundColor: config.color }]}
                  onPress={() => setFilterStatus(s)}
                >
                  <Text style={[styles.filterChipText, filterStatus === s && { color: '#fff' }]}>
                    {s === 'all' ? 'All' : config.label} ({count})
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {/* "More filters" trigger — opens a drawer with sub /
              priority / location filters. Badge shows the count of
              non-status active filters so the GC sees at a glance
              that their list is filtered. */}
          <TouchableOpacity
            style={[styles.moreFiltersBtn, activeFilterCount > 0 && { borderColor: themeColors.accent }]}
            onPress={() => setShowFilterDrawer(true)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="More filters"
          >
            <Filter size={14} color={activeFilterCount > 0 ? themeColors.accent : themeColors.textSecondary} strokeWidth={1.75} />
            {activeFilterCount > 0 && (
              <View style={styles.moreFiltersBadge}>
                <Text style={styles.moreFiltersBadgeText}>{activeFilterCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Active-filter summary row — when any non-status filter is on,
            show pills the GC can tap to remove. Saves a trip into the
            drawer for the common "I forgot what I'm filtering on" case. */}
        {(filterSub || filterPriority !== 'all' || filterLocation) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersRow}>
            {filterSub && (
              <TouchableOpacity style={styles.activeFilterPill} onPress={() => setFilterSub('')}>
                <Text style={styles.activeFilterPillText}>Sub: {filterSub}</Text>
                <X size={11} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
            )}
            {filterPriority !== 'all' && (
              <TouchableOpacity style={styles.activeFilterPill} onPress={() => setFilterPriority('all')}>
                <Text style={styles.activeFilterPillText}>Priority: {filterPriority}</Text>
                <X size={11} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
            )}
            {filterLocation && (
              <TouchableOpacity style={styles.activeFilterPill} onPress={() => setFilterLocation('')}>
                <Text style={styles.activeFilterPillText}>Location: {filterLocation}</Text>
                <X size={11} color={themeColors.accent} strokeWidth={1.75} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={clearAllFilters} style={[styles.activeFilterPill, { backgroundColor: themeColors.line }]}>
              <Text style={[styles.activeFilterPillText, { color: themeColors.textSecondary }]}>Clear all</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {filteredItems.map(item => {
          const sc = getStatusConfig(themeColors, item.status);
          const pc = getPriorityConfig(themeColors, item.priority);
          return (
            <View key={item.id} style={styles.punchCard}>
              <View style={styles.punchCardTop}>
                <View style={[styles.priorityDot, { backgroundColor: pc.color }]} />
                <View style={{ flex: 1 }}>
                  {/* Tapping the item's own text opens it for editing. This is
                      the affordance the row was missing — without it nothing
                      ever put a real item in `editingItem`, so the edit sheet
                      could only create and its status breadcrumb was dead code.
                      Same gesture app/permits.tsx uses on its cards.

                      Scoped to the description + location deliberately. Wrapping
                      the whole card would make it one accessibility element on
                      iOS and swallow the status badge ("tap to advance") and the
                      "On plan" chip, which are their own affordances. They stay
                      siblings; the action row below stays outside too. */}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => openEditForm(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit punch item: ${item.description}`}
                    accessibilityHint="Opens this item for editing"
                    testID={`punch-item-${item.id}`}
                  >
                    <Text style={styles.punchDesc}>{item.description}</Text>
                    {item.location ? <Text style={styles.punchLocation}>{item.location}</Text> : null}
                  </TouchableOpacity>
                  {item.planSheetId ? (
                    <TouchableOpacity
                      style={styles.onPlanChip}
                      onPress={() => router.push({ pathname: '/plan-viewer' as never, params: { sheetId: item.planSheetId!, punchId: item.id } as never })}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="View this item on the plan"
                      testID="punch-on-plan"
                    >
                      <MapPin size={11} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.onPlanChipText}>On plan</Text>
                      <ChevronRight size={11} color={themeColors.accent} strokeWidth={1.75} />
                    </TouchableOpacity>
                  ) : null}
                </View>
                <TouchableOpacity
                  style={[styles.punchBadge, { backgroundColor: sc.bg }, item.status !== 'closed' && styles.punchBadgeTappable]}
                  onPress={() => advanceStatus(item)}
                  disabled={item.status === 'closed'}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={item.status === 'closed' ? `Status: ${sc.label}` : `Status: ${sc.label}, tap to advance`}
                  accessibilityHint={item.status === 'closed' ? undefined : 'Advances status one step'}
                >
                  <Text style={[styles.punchBadgeText, { color: sc.color }]}>{sc.label}</Text>
                  {item.status !== 'closed' && (
                    <Text style={[styles.punchBadgeChevron, { color: sc.color }]}>›</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.punchMeta}>
                {item.assignedSub ? <Text style={styles.punchMetaText}>Sub: {item.assignedSub}</Text> : null}
                {item.dueDate ? <Text style={styles.punchMetaText}>Due: {item.dueDate}</Text> : null}
                <Text style={[styles.punchMetaText, { color: pc.color }]}>{pc.label} Priority</Text>
              </View>

              {item.linkedTaskName ? (
                <View style={styles.linkedTaskBadge}>
                  <Link2 size={11} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.linkedTaskBadgeText} numberOfLines={1}>Task: {item.linkedTaskName}</Text>
                </View>
              ) : null}

              {item.rejectionNote ? (
                <View style={styles.rejectionBox}>
                  <MessageSquare size={12} color={themeColors.dangerLabel} strokeWidth={1.75} />
                  <Text style={styles.rejectionText}>{item.rejectionNote}</Text>
                </View>
              ) : null}

              <View style={styles.punchActions}>
                {item.status === 'open' && (
                  <TouchableOpacity style={styles.punchActionBtn} onPress={() => handleStatusChange(item, 'in_progress')}>
                    <Clock size={14} color={themeColors.info} strokeWidth={1.75} />
                    <Text style={[styles.punchActionText, { color: themeColors.info }]}>Start</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'in_progress' && (
                  <TouchableOpacity style={styles.punchActionBtn} onPress={() => handleStatusChange(item, 'ready_for_review')}>
                    <Eye size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={[styles.punchActionText, { color: themeColors.accent }]}>Submit for Review</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'ready_for_review' && (
                  <>
                    <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: themeColors.successSoft }]} onPress={() => handleStatusChange(item, 'closed')}>
                      <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={[styles.punchActionText, { color: themeColors.success }]}>Close</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: themeColors.dangerSoft }]} onPress={() => { setShowRejectModal(item.id); setRejectionNote(''); }}>
                      <X size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                      <Text style={[styles.punchActionText, { color: themeColors.dangerLabel }]}>Reject</Text>
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.punchDeleteBtn} onPress={() => {
                  showAlert('Delete', 'Delete this punch item?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deletePunchItem(item.id) },
                  ]);
                }} accessibilityRole="button" accessibilityLabel="Delete">
                  <Trash2 size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {filteredItems.length === 0 && (
          <View style={{ minHeight: 360 }}>
            <EmptyState
              icon={<CheckCircle size={36} color={themeColors.accent} strokeWidth={1.75} />}
              title={filterStatus !== 'all' ? 'Nothing matches that filter' : 'No punch items yet'}
              message={filterStatus !== 'all'
                ? `No items currently sit in "${filterStatus.replace(/_/g, ' ')}". Switch filters above to see the rest.`
                : 'Walk the project, snap photos of anything that needs touch-up, and add the items here. They\'ll roll into your closeout packet automatically.'}
              actionLabel={filterStatus === 'all' ? 'Add first punch item' : undefined}
              onAction={filterStatus === 'all' ? () => { resetForm(); setShowForm(true); } : undefined}
            />
          </View>
        )}

        <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-punch-item">
          <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
          <Text style={styles.addItemBtnText}>Add Punch Item</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.addItemBtn}
          onPress={() => setShowTemplates(true)}
          activeOpacity={0.7}
          testID="apply-punch-template"
        >
          <MagePunch size={16} color={themeColors.accent} />
          <Text style={styles.addItemBtnText}>Apply trade template</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.walkBtn}
          onPress={() => router.push({ pathname: '/punch-walk' as never, params: { projectId: projectId ?? '' } as never })}
          activeOpacity={0.85}
          testID="open-punch-walk"
        >
          <Mic size={16} color={"#FFFFFF"} strokeWidth={1.75} />
          <Text style={styles.walkBtnText}>Walk Mode — voice capture</Text>
        </TouchableOpacity>

        {allClosed && totalCount > 0 && project.status !== 'completed' && project.status !== 'closed' && (
          <TouchableOpacity style={styles.closeProjectBtn} onPress={handleCloseProject} activeOpacity={0.85}>
            <CheckCircle size={18} color="#fff" strokeWidth={1.75} />
            <Text style={styles.closeProjectBtnText}>Close Project</Text>
          </TouchableOpacity>
        )}

        {(project.status === 'completed' || project.status === 'closed') && (
          <View style={styles.projectClosedNote}>
            <CheckCircle size={16} color={themeColors.success} strokeWidth={1.75} />
            <Text style={styles.projectClosedNoteText}>Project closed — punch list is archived.</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>{editingItem ? 'Edit Item' : 'New Punch Item'}</Text>
                  <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>

                {/* Only when EDITING an existing item — a new one has no lifecycle
                    to show yet, and the list cards already carry a status badge
                    plus the Start / Submit / Close actions. Same gate
                    app/permits.tsx uses (`editingPermit &&`): the breadcrumb
                    belongs in single-item context, not once per row. */}
                {editingItem && (
                  <View style={{ marginBottom: 14 }}>
                    <StatusPipeline
                      stages={stagesFor('punch')}
                      current={visualStageFor('punch', editingItem.status)}
                      startedAt={editingItem.createdAt}
                      dueAt={editingItem.dueDate || undefined}
                      onAdvance={(next) => {
                        updatePunchItem(editingItem.id, {
                          status: next as PunchItem['status'],
                          updatedAt: new Date().toISOString(),
                        });
                        setEditingItem({ ...editingItem, status: next as PunchItem['status'] });
                      }}
                    />
                  </View>
                )}

                {attachedPhotoUri ? (
                  <View style={styles.photoPreview}>
                    <Image source={{ uri: attachedPhotoUri }} style={styles.photoImg} />
                    <TouchableOpacity
                      style={styles.photoRemove}
                      onPress={() => setAttachedPhotoUri(undefined)}
                      accessibilityRole="button"
                      accessibilityLabel="Remove attached photo"
                      testID="punch-remove-photo"
                    >
                      <X size={12} color="#fff" strokeWidth={1.75} />
                    </TouchableOpacity>
                    <View style={styles.photoBadge}>
                      <Text style={styles.photoBadgeText}>Photo attached</Text>
                    </View>
                  </View>
                ) : null}

                <Text style={styles.fieldLabel}>Description *</Text>
                <TextInput style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]} value={description} onChangeText={setDescription} placeholder="What needs to be done..." placeholderTextColor={themeColors.textMuted} multiline testID="punch-desc-input" />

                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Location/Area</Text>
                    <TextInput style={styles.input} value={location} onChangeText={setLocation} placeholder="e.g. Kitchen, Room 3B" placeholderTextColor={themeColors.textMuted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.fieldLabel}>Due Date</Text>
                    <TextInput style={styles.input} value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" placeholderTextColor={themeColors.textMuted} />
                  </View>
                </View>

                <Text style={styles.fieldLabel}>Assigned Sub</Text>
                {subcontractors.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                    {subcontractors.map(s => (
                      <TouchableOpacity
                        key={s.id}
                        style={[styles.subChip, assignedSub === s.companyName && styles.subChipActive]}
                        onPress={() => setAssignedSub(s.companyName)}
                      >
                        <Text style={[styles.subChipText, assignedSub === s.companyName && styles.subChipTextActive]}>{s.companyName}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <TextInput style={styles.input} value={assignedSub} onChangeText={setAssignedSub} placeholder="Sub name" placeholderTextColor={themeColors.textMuted} />
                )}

                <Text style={styles.fieldLabel}>Priority</Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {(['low', 'medium', 'high'] as PunchItemPriority[]).map(p => {
                    const pc = getPriorityConfig(themeColors, p);
                    return (
                      <TouchableOpacity
                        key={p}
                        style={[styles.priorityBtn, priority === p && { backgroundColor: pc.color }]}
                        onPress={() => setPriority(p)}
                      >
                        <Text style={[styles.priorityBtnText, priority === p && { color: '#fff' }]}>{pc.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {scheduleTasks.length > 0 ? (
                  <>
                    <Text style={styles.fieldLabel}>Link to Schedule Task (optional)</Text>
                    <TouchableOpacity style={styles.pickerBtn} onPress={() => setShowTaskPicker(true)} activeOpacity={0.7}>
                      <Link2 size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={[styles.pickerBtnText, !linkedTask && { color: themeColors.textMuted }]} numberOfLines={1}>
                        {linkedTask ? linkedTask.title : 'No task linked'}
                      </Text>
                      {linkedTask ? (
                        <TouchableOpacity onPress={() => setLinkedTaskId('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                          <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                        </TouchableOpacity>
                      ) : (
                        <ChevronDown size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                      )}
                    </TouchableOpacity>
                  </>
                ) : null}

                <View style={styles.formActions}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-punch-item">
                    <Text style={styles.saveBtnText}>{editingItem ? 'Update' : 'Add Item'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showTaskPicker} transparent animationType="fade" onRequestClose={() => setShowTaskPicker(false)}>
        <View style={styles.rejectOverlay}>
          <View style={[styles.rejectCard, { maxHeight: '70%' as const }]}>
            <View style={styles.formHeader}>
              <Text style={styles.rejectTitle}>Link to Task</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }}>
              {scheduleTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.subChip, { marginVertical: 4, alignSelf: 'stretch' as const }, linkedTaskId === t.id && styles.subChipActive]}
                  onPress={() => { setLinkedTaskId(t.id); setShowTaskPicker(false); }}
                >
                  <Text style={[styles.subChipText, linkedTaskId === t.id && styles.subChipTextActive]} numberOfLines={1}>
                    {t.title} {t.phase ? `— ${t.phase}` : ''}
                  </Text>
                </TouchableOpacity>
              ))}
              {scheduleTasks.length === 0 ? (
                <Text style={[styles.rejectDesc, { textAlign: 'center' as const, padding: 20 }]}>No tasks in the schedule yet.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showRejectModal !== null} transparent animationType="fade" onRequestClose={() => setShowRejectModal(null)}>
        <View style={styles.rejectOverlay}>
          <View style={styles.rejectCard}>
            <Text style={styles.rejectTitle}>Reject Item</Text>
            <Text style={styles.rejectDesc}>Provide a reason for rejection:</Text>
            <TextInput
              style={[styles.input, { minHeight: 80, paddingTop: 12, textAlignVertical: 'top' as const }]}
              value={rejectionNote}
              onChangeText={setRejectionNote}
              placeholder="Reason for rejection..."
              placeholderTextColor={themeColors.textMuted}
              multiline
            />
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowRejectModal(null)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.saveBtn, { backgroundColor: themeColors.danger }]} onPress={() => showRejectModal && handleReject(showRejectModal)} activeOpacity={0.85}>
                <Text style={styles.saveBtnText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Trade-template picker. Modal-style overlay listing each
          template grouped by trade. Tapping a template applies it
          immediately — the GC then edits / removes from the punch
          list. We don't show item-level previews here because the
          contextual notes are short and the GC will see them all
          on the punch row regardless. */}
      <Modal visible={showTemplates} transparent animationType="slide" onRequestClose={() => setShowTemplates(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.formCard, { paddingBottom: insets.bottom + 20, maxHeight: '85%' }]}>
            <View style={styles.formHeader}>
              <Text style={styles.formTitle}>Apply trade template</Text>
              <TouchableOpacity onPress={() => setShowTemplates(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={22} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 14, lineHeight: 17 }}>
              Drop a curated checklist into this punch list. Edit / remove items that don&apos;t apply to this project — the template is a starting point, not a contract.
            </Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 12 }}>
              {templateGroups.map(group => (
                <View key={group.trade} style={{ marginBottom: 16 }}>
                  <Text style={{
                    fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.textMuted,
                    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
                  }}>
                    {group.trade}
                  </Text>
                  {group.templates.map(t => (
                    <TouchableOpacity
                      key={t.id}
                      onPress={() => handleApplyTemplate(t)}
                      activeOpacity={0.85}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 10,
                        padding: 12, borderRadius: Tokens.radius.md,
                        backgroundColor: themeColors.surface,
                        borderWidth: 1, borderColor: themeColors.line,
                        marginBottom: 6,
                      }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: themeColors.text }}>
                          {t.label}
                        </Text>
                        <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 }}>
                          {t.context} · {t.items.length} items
                        </Text>
                      </View>
                      <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* More-filters drawer — adds sub / priority / location to the
          status filter chips above. Drawn live from items so it picks
          up new subs without code changes. */}
      <Modal visible={showFilterDrawer} transparent animationType="slide" onRequestClose={() => setShowFilterDrawer(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' as const }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Filters</Text>
              <TouchableOpacity onPress={() => setShowFilterDrawer(false)} style={{ padding: 4 }}>
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingBottom: 8, gap: 16 }}>
              {/* Sub filter */}
              <View>
                <Text style={styles.filterSectionLabel}>Assigned to</Text>
                <View style={styles.filterChipsWrap}>
                  <TouchableOpacity
                    style={[styles.filterDrawerChip, !filterSub && styles.filterDrawerChipActive]}
                    onPress={() => setFilterSub('')}
                  >
                    <Text style={[styles.filterDrawerChipText, !filterSub && styles.filterDrawerChipTextActive]}>Any</Text>
                  </TouchableOpacity>
                  {subsInList.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.filterDrawerChip, filterSub === s && styles.filterDrawerChipActive]}
                      onPress={() => setFilterSub(s)}
                    >
                      <Text style={[styles.filterDrawerChipText, filterSub === s && styles.filterDrawerChipTextActive]}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  {subsInList.length === 0 && (
                    <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textMuted, padding: 4 }}>
                      No subs assigned yet on any item.
                    </Text>
                  )}
                </View>
              </View>

              {/* Priority filter */}
              <View>
                <Text style={styles.filterSectionLabel}>Priority</Text>
                <View style={styles.filterChipsWrap}>
                  {(['all', 'low', 'medium', 'high'] as const).map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[styles.filterDrawerChip, filterPriority === p && styles.filterDrawerChipActive]}
                      onPress={() => setFilterPriority(p)}
                    >
                      <Text style={[styles.filterDrawerChipText, filterPriority === p && styles.filterDrawerChipTextActive]}>
                        {p === 'all' ? 'Any' : p.charAt(0).toUpperCase() + p.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Location free-text filter */}
              <View>
                <Text style={styles.filterSectionLabel}>Location contains</Text>
                <TextInput
                  style={styles.filterDrawerInput}
                  value={filterLocation}
                  onChangeText={setFilterLocation}
                  placeholder="e.g. Kitchen, 2nd floor, Master bath"
                  placeholderTextColor={themeColors.textMuted}
                />
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: themeColors.line }}>
              <TouchableOpacity style={[styles.filterDrawerBtn, { backgroundColor: themeColors.line }]} onPress={clearAllFilters}>
                <Text style={[styles.filterDrawerBtnText, { color: themeColors.text }]}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterDrawerBtn, { backgroundColor: themeColors.accent, flex: 1.4 }]} onPress={() => setShowFilterDrawer(false)}>
                <Text style={[styles.filterDrawerBtnText, { color: "#FFFFFF" }]}>
                  Show {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, textAlign: 'center' as const, marginTop: 60 },
  progressSection: { marginHorizontal: 20, marginTop: 16, marginBottom: 16 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  progressPercent: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.accent },
  progressTrack: { height: 8, backgroundColor: themeColors.line, borderRadius: 4, overflow: 'hidden' as const },
  progressFill: { height: 8, backgroundColor: themeColors.accent, borderRadius: 4 },
  progressSub: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 4 },
  filterRow: { paddingHorizontal: 20, gap: 6, marginBottom: 16 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: themeColors.line },
  filterChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  filterBar: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingRight: 16 },
  moreFiltersBtn: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.surface,
    borderWidth: 1, borderColor: themeColors.line,
    position: 'relative' as const,
    marginRight: 4,
  },
  moreFiltersBadge: {
    position: 'absolute' as const, top: -4, right: -4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    backgroundColor: themeColors.accent,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  moreFiltersBadgeText: { fontSize: 9, fontWeight: '800' as const, color: themeColors.surface, lineHeight: 11 },
  activeFiltersRow: { paddingHorizontal: 20, gap: 6, paddingBottom: 12 },
  activeFilterPill: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: themeColors.accent + '14',
  },
  activeFilterPillText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  filterSectionLabel: {
    fontSize: 11, fontWeight: '800' as const, color: themeColors.textMuted,
    letterSpacing: 0.4, textTransform: 'uppercase' as const, marginBottom: 8,
  },
  filterChipsWrap: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6 },
  filterDrawerChip: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: themeColors.line,
  },
  filterDrawerChipActive: { backgroundColor: themeColors.accent },
  filterDrawerChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  filterDrawerChipTextActive: { color: themeColors.surface },
  filterDrawerInput: {
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 0.5, borderColor: themeColors.line,
    fontSize: Type.bodyCompact.fontSize,
    color: themeColors.text,
  },
  filterDrawerBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  filterDrawerBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const },
  // Modal scaffolding for the filter drawer — slide-up sheet shape
  // matching the existing item-edit modal in this file.
  modalCard: {
    backgroundColor: themeColors.surface,
    borderTopLeftRadius: Tokens.radius.panel,
    borderTopRightRadius: Tokens.radius.panel,
    padding: 20,
    paddingBottom: 32,
  },
  modalHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    marginBottom: 16,
  },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '800' as const, color: themeColors.text, letterSpacing: -0.3 },
  punchCard: { marginHorizontal: 20, marginBottom: 10, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  punchCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  punchDesc: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.text, lineHeight: 21 },
  punchLocation: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  onPlanChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 3,
    alignSelf: 'flex-start' as const, marginTop: 6,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    backgroundColor: themeColors.accent + '14',
  },
  onPlanChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  punchBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
  },
  punchBadgeTappable: {
    paddingRight: 8,
  },
  punchBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  punchBadgeChevron: { fontSize: (Type.caption2.fontSize ?? 11) + 2, fontWeight: '900' as const, marginTop: -1, opacity: 0.85 },
  punchMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingLeft: 18 },
  punchMetaText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted },
  rejectionBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: themeColors.dangerSoft, borderRadius: Tokens.radius.sm, padding: 10, marginLeft: 18 },
  rejectionText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.dangerLabel, lineHeight: 17 },
  punchActions: { flexDirection: 'row', gap: 8, paddingLeft: 18, flexWrap: 'wrap' },
  punchActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  punchActionText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  punchDeleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 8, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  walkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 10, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent },
  walkBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  closeProjectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 16, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.success },
  closeProjectBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
  projectClosedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.successSoft },
  projectClosedNoteText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.success },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  photoPreview: { position: 'relative' as const, alignSelf: 'flex-start' as const, marginBottom: 4, borderRadius: Tokens.radius.md, overflow: 'hidden' as const },
  photoImg: { width: 120, height: 90, borderRadius: Tokens.radius.md },
  photoRemove: { position: 'absolute' as const, top: 4, right: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: "rgba(0,0,0,0.7)", alignItems: 'center' as const, justifyContent: 'center' as const },
  photoBadge: { position: 'absolute' as const, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 6, paddingVertical: 3 },
  photoBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: '#fff' },
  fieldLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  input: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.subhead.fontSize, color: themeColors.text },
  subChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  subChipActive: { backgroundColor: themeColors.accent },
  subChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  subChipTextActive: { color: '#fff' },
  priorityBtn: { flex: 1, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line, alignItems: 'center' },
  priorityBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
  rejectOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'center', padding: 20 },
  rejectCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius["2xl"], padding: 22, gap: 12, maxWidth: 400, width: '100%', alignSelf: 'center' as const },
  rejectTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.danger },
  rejectDesc: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  pickerBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt },
  pickerBtnText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  linkedTaskBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '12', alignSelf: 'flex-start', marginLeft: 18 },
  linkedTaskBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const, color: themeColors.accent, flex: 1 },
  pickerOption: { paddingVertical: 14, paddingHorizontal: 16, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, marginBottom: 8 },
  pickerOptionActive: { backgroundColor: themeColors.accent + '15', borderWidth: 1, borderColor: themeColors.accent },
  pickerOptionText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  pickerOptionMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
});
