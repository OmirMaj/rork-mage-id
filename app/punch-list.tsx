import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, Image,
  FlatList, type ListRenderItemInfo,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, useBrainFabLift, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, X, CheckCircle, Clock, Eye, MessageSquare,
  Trash2, Link2, ChevronDown, Mic, ListChecks, ChevronRight, Filter, MapPin,
  Camera, Square, SquareCheck, Users, Send, Layers, List, ArrowUpDown,
  ArrowLeftRight, EyeOff, Wrench, CalendarClock,
} from 'lucide-react-native';
import { MagePunch } from '@/components/icons';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useProjects } from '@/contexts/ProjectContext';
// Project-scoped gate: an invited collaborator may do the work they were
// invited to do, even though their own tier is free. See
// utils/collaboratorAccess.
import { useProjectAccess } from '@/hooks/useProjectAccess';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import type { PunchItem, PunchItemStatus, PunchItemPriority, PunchListType, SubTrade } from '@/types';
import { punchListTypeOf } from '@/types';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor } from '@/utils/workflowPipelines';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface } from '@/components/ui';
import { generateUUID } from '@/utils/generateId';
import { getPunchTemplatesByTrade, type PunchTemplate } from '@/constants/punchTemplates';
import { showAlert } from '@/utils/alert';
import { formatCalendarDay, daysUntilCalendarDay } from '@/utils/calendarDate';
import { burstSummary, captureBurst } from '@/components/PhotoCapture';
import { nailIt } from '@/components/animations/NailItToast';
import { usePlanRooms } from '@/hooks/usePlanRooms';
import {
  buildPunchLocationOptions,
  groupPunchItemsByLocation,
  filterByLocationKey,
  normalizeLocation,
  UNPLACED_LOCATION_GROUP,
  type PunchLocationOption,
} from '@/utils/punchLocations';

// Top-level row IDs (punch items) become Supabase PKs and MUST be UUIDs —
// the punch_items.id column rejects anything else with "invalid input syntax
// for type uuid", which is silently swallowed by supabaseWrite. Prefix is
// kept as a debugging hint but the ID itself is always a real UUID.
function createId(_prefix: string): string {
  return generateUUID();
}

/**
 * One frame from a photo walk, waiting for a sentence.
 *
 * PUNCH-BURST (audit 2026-09-07 "worth doing" #35). Every camera call in this
 * app is one-shot, so a twenty-defect walk was twenty round trips through the
 * app between shots — roughly eighty interactions with a phone in a gloved hand
 * in direct sun. The super's actual workaround is the phone's own camera roll,
 * and those photos never reach the punch list.
 *
 * The walk splits the job the way it is really done: SHOOT everything in one
 * pass (the camera re-opens itself after each frame), then stand in the shade
 * and type one line per photo. Nothing is written to the punch list until a
 * line exists — a punch item with no description is a row nobody can action.
 */
interface WalkShot {
  id: string;
  uri: string;
  description: string;
  location: string;
}

/** Frames one walk can hold. Past this the review sheet is a scroll, not a list,
 *  and the right move is to file these and start another walk. */
const MAX_WALK_SHOTS = 40;

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

// ───────────────────────────────────────────────────────────────────────────
// Two lists, one table
// ───────────────────────────────────────────────────────────────────────────
//
// Every punch item is on exactly one of two lists (PunchListType):
//   PUNCH     — the formal list the owner / architect walks. Its open items are
//               what the client portal renders (utils/portalSnapshot.ts), so it
//               is written to read as watched: due dates up front, overdue red.
//   CREW LIST — touch-ups, cleanup, "while you're in there". Internal; the
//               client portal filters it out. Written to read as a calm working
//               checklist: overdue still shown, but in ink, not alarm.
// Same rows, same data, same bulk verbs — the difference is weight, and weight
// is the whole request.
//
// What the copy may claim: "your client sees this" is only TRUE when the
// project's client portal is on AND its punch-list section is on, so every
// line that says so is gated on that (see `clientSeesPunch`). Nothing here
// says an item blocks payment or holds retainage — this screen has no such
// gate to point at, and a claim the app cannot back is worse than no claim.

const LIST_LABEL: Record<PunchListType, string> = { punch: 'Punch', crew: 'Crew list' };

function otherList(list: PunchListType): PunchListType {
  return list === 'punch' ? 'crew' : 'punch';
}

/** Whole days until the item is due (negative = past), or null when it has no
 *  due date or is already closed — a closed item is not late. dueDate is
 *  declared 'YYYY-MM-DD' but synced rows carry a full ISO timestamp, so it is
 *  sliced to the day first (same reason openEditForm slices). */
function daysUntilDue(item: PunchItem): number | null {
  if (item.status === 'closed' || !item.dueDate) return null;
  return daysUntilCalendarDay(item.dueDate.slice(0, 10));
}

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * The confirmation for moving items between lists. The two directions are
 * NOT symmetric in consequence, so the copy isn't either: onto the punch list
 * puts an item in front of the client; onto the crew list takes it away. Both
 * are confirmed — a formal item quietly vanishing from the owner's view is as
 * much a surprise as a chore appearing on it.
 */
function moveConfirmCopy(
  target: PunchListType,
  count: number,
  clientSeesPunch: boolean,
): { title: string; message: string; confirm: string } {
  const noun = count === 1 ? 'this item' : `${count} items`;
  const them = count === 1 ? 'It' : 'They';
  if (target === 'punch') {
    return {
      title: `Put ${noun} on the punch list?`,
      message: clientSeesPunch
        ? `Your client will be able to see ${count === 1 ? 'it' : 'them'} — the client portal shows every punch item that is not closed.`
        : `${them} join the formal punch list. Punch list sharing is off in this project's client portal, so your client won't see ${count === 1 ? 'it' : 'them'} until that is turned on.`,
      confirm: 'Move to punch',
    };
  }
  return {
    title: `Move ${noun} to the crew list?`,
    message: clientSeesPunch
      ? `${them} come${count === 1 ? 's' : ''} off the punch list and out of your client's portal. Crew list items are never shown to the client.`
      : `${them} come${count === 1 ? 's' : ''} off the formal punch list. Crew list items are never shown in the client portal.`,
    confirm: 'Move to crew list',
  };
}

// ───────────────────────────────────────────────────────────────────────────
// How the list is laid out, remembered between visits
// ───────────────────────────────────────────────────────────────────────────
//
// A punch walk is not one sitting. He captures 100+ items on Thursday morning
// and closes them out over the next two weeks, reopening this screen a dozen
// times. Making him re-pick "group by room" on every entry is the same tax as
// re-typing the room — so the choice is stored.
//
// DEVICE-scoped, not project-scoped: it is a way of reading a list, not a fact
// about a job. `mageid_` prefix so utils/localCacheKeys.ts's prefix sweep wipes
// it on a tenant switch without anybody having to remember it exists.
const PUNCH_VIEW_PREF_KEY = 'mageid_punch_list_view';

type PunchGroupOrder = 'recent' | 'alpha';

interface PunchViewPref {
  grouped: boolean;
  order: PunchGroupOrder;
  /** Which of the two lists was showing. Rides in the same blob (and so the
   *  same `mageid_` key the tenant sweep already covers) rather than a second
   *  key: it is the same kind of fact — how he last read this screen. Absent
   *  on a blob written before the split, which reads as 'punch'. */
  list: PunchListType;
}

/** Narrow whatever is on disk. A half-written or older blob must not crash the
 *  screen he is standing in a building to use — it just falls back. */
function parseViewPref(raw: string | null): PunchViewPref | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PunchViewPref>;
    if (typeof v?.grouped !== 'boolean') return null;
    return {
      grouped: v.grouped,
      order: v.order === 'alpha' ? 'alpha' : 'recent',
      // Through the one default in types/index.ts — anything unrecognised is
      // the formal list, the list whose items someone is watching.
      list: punchListTypeOf({ listType: v.list }),
    };
  } catch {
    return null;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Rows
// ───────────────────────────────────────────────────────────────────────────
//
// The list used to be `filteredItems.map(...)` inside a ScrollView: every punch
// card — a thumbnail, five Texts, a status badge and up to three action buttons
// — mounted before the first frame. That is fine at 12 items and it is the
// whole screen at 200, which is the size of the walk this was rebuilt for.
//
// Section headers and item cards are flattened into ONE stream so a FlatList
// can own the scroll axis. A VirtualizedList nested inside a same-axis
// ScrollView gets unbounded height and mounts everything anyway — the same
// lesson components/schedule/mobile/MobileScheduleList.tsx learned.

type PunchRowData =
  | {
      kind: 'section';
      /** FlatList key — namespaced so it can never collide with an item id. */
      key: string;
      /** The NORMALISED location key, which is what collapse + select-all
       *  address. Kept separate from `key` so the two can't drift. */
      sectionKey: string;
      label: string;
      /** The name also appears on the analysed plans. A fact, not a guess. */
      onPlan: boolean;
      openCount: number;
      total: number;
      collapsed: boolean;
      /** Every item in this room is already selected — drives the checkbox. */
      allSelected: boolean;
      itemCount: number;
    }
  | {
      kind: 'item';
      key: string;
      item: PunchItem;
      selected: boolean;
      selectMode: boolean;
      /** Its photo URL already failed to load once this session. */
      photoFailed: boolean;
      /** Which list is showing — decides how loud the row is, not what it holds. */
      variant: PunchListType;
    };

type PunchStyles = ReturnType<typeof makeStyles>;

/** Stable across renders (built once from refs) so React.memo on the rows
 *  actually holds — a changing callback identity makes memo a no-op. */
interface PunchRowActions {
  onEdit: (item: PunchItem) => void;
  onAdvance: (item: PunchItem) => void;
  onStatus: (item: PunchItem, next: PunchItemStatus) => void;
  onReject: (item: PunchItem) => void;
  onDelete: (item: PunchItem) => void;
  onOpenPhoto: (item: PunchItem) => void;
  onPhotoFailed: (uri: string) => void;
  onOpenPlan: (item: PunchItem) => void;
  onToggleSelect: (id: string) => void;
  onStartSelecting: (id: string) => void;
  onMove: (item: PunchItem) => void;
}

interface PunchSectionActions {
  onToggleCollapse: (key: string) => void;
  onToggleSectionSelect: (key: string) => void;
}

const LocationSectionHeader = React.memo(function LocationSectionHeader({
  row, styles, themeColors, actions, selectMode,
}: {
  row: Extract<PunchRowData, { kind: 'section' }>;
  styles: PunchStyles;
  themeColors: ThemeColors;
  actions: PunchSectionActions;
  selectMode: boolean;
}) {
  const done = row.openCount === 0 && row.total > 0;
  return (
    <View style={styles.sectionHeader}>
      <TouchableOpacity
        style={styles.sectionHeaderMain}
        onPress={() => actions.onToggleCollapse(row.sectionKey)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded: !row.collapsed }}
        accessibilityLabel={`${row.label}, ${row.openCount} open of ${row.total}`}
        accessibilityHint={row.collapsed ? 'Expands this location' : 'Collapses this location'}
        testID={`punch-section-${row.key}`}
      >
        {row.collapsed
          ? <ChevronRight size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
          : <ChevronDown size={16} color={themeColors.textSecondary} strokeWidth={1.75} />}
        <Text style={styles.sectionHeaderLabel} numberOfLines={1}>{row.label}</Text>
        {/* Only shown when the room name is genuinely on the analysed plans —
            usePlanRooms says so or it is not drawn. */}
        {row.onPlan ? <MapPin size={11} color={themeColors.accent} strokeWidth={1.75} /> : null}
        <View style={{ flex: 1 }} />
        <Text style={[styles.sectionHeaderCount, done && { color: themeColors.success }]}>
          {done ? `all ${row.total} closed` : `${row.openCount} open / ${row.total}`}
        </Text>
      </TouchableOpacity>
      {/* "This whole room is done" in one tap — the reason grouping exists. */}
      <TouchableOpacity
        style={styles.sectionSelectBtn}
        onPress={() => actions.onToggleSectionSelect(row.sectionKey)}
        hitSlop={8}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.allSelected }}
        accessibilityLabel={row.allSelected
          ? `Deselect all ${row.itemCount} items in ${row.label}`
          : `Select all ${row.itemCount} items in ${row.label}`}
        testID={`punch-section-select-${row.key}`}
      >
        {row.allSelected
          ? <SquareCheck size={18} color={themeColors.accent} strokeWidth={1.75} />
          : <Square size={18} color={selectMode ? themeColors.textSecondary : themeColors.textMuted} strokeWidth={1.75} />}
      </TouchableOpacity>
    </View>
  );
});

const PunchRow = React.memo(function PunchRow({
  row, styles, themeColors, actions,
}: {
  row: Extract<PunchRowData, { kind: 'item' }>;
  styles: PunchStyles;
  themeColors: ThemeColors;
  actions: PunchRowActions;
}) {
  const { item, selected, selectMode, photoFailed, variant } = row;
  const sc = getStatusConfig(themeColors, item.status);
  const pc = getPriorityConfig(themeColors, item.priority);
  const formal = variant === 'punch';
  const dueIn = daysUntilDue(item);
  const overdue = dueIn !== null && dueIn < 0;
  const moveTo = otherList(variant);
  return (
    <View style={[
      styles.punchCard,
      // Formal items carry a left rule — red once they are late, so a scroll
      // down a 100-item list shows the late ones without reading a word. Crew
      // items drop the border and sit on the quieter ground.
      formal ? styles.punchCardFormal : styles.punchCardCrew,
      formal && overdue && styles.punchCardFormalOverdue,
      selected && styles.punchCardSelected,
    ]}>
      <View style={styles.punchCardTop}>
        {/* In selection mode the checkbox replaces the priority dot rather than
            crowding beside it — one hand, gloves, and the dot is decoration
            while the box is the thing being aimed at. */}
        {selectMode ? (
          <TouchableOpacity
            onPress={() => actions.onToggleSelect(item.id)}
            hitSlop={10}
            style={styles.rowCheckbox}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${selected ? 'Deselect' : 'Select'}: ${item.description}`}
            testID={`punch-select-${item.id}`}
          >
            {selected
              ? <SquareCheck size={20} color={themeColors.accent} strokeWidth={1.75} />
              : <Square size={20} color={themeColors.textMuted} strokeWidth={1.75} />}
          </TouchableOpacity>
        ) : (
          <View style={[styles.priorityDot, { backgroundColor: pc.color }]} />
        )}
        {/* The deficiency's evidence. A local `file://` still sitting
            in the upload queue is rendered too — it is valid on this
            device, and waiting for the round-trip would blank the
            thumbnail on exactly the walk that just shot it. */}
        {item.photoUri && !photoFailed ? (
          <TouchableOpacity
            onPress={() => actions.onOpenPhoto(item)}
            activeOpacity={0.8}
            accessibilityRole="imagebutton"
            accessibilityLabel={`Photo for ${item.description}`}
            accessibilityHint="Opens the photo full screen"
            testID={`punch-photo-${item.id}`}
          >
            <Image
              source={{ uri: item.photoUri }}
              style={styles.punchThumb}
              onError={() => item.photoUri && actions.onPhotoFailed(item.photoUri)}
            />
          </TouchableOpacity>
        ) : null}
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
              siblings; the action row below stays outside too.

              While selecting, the same tap toggles the checkbox: opening an
              edit sheet mid-selection is how a 30-item selection gets lost.
              A long press starts selecting from any row — the one-handed way
              in, with no mode switch to find first. */}
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => (selectMode ? actions.onToggleSelect(item.id) : actions.onEdit(item))}
            onLongPress={() => actions.onStartSelecting(item.id)}
            delayLongPress={350}
            accessibilityRole="button"
            accessibilityLabel={selectMode
              ? `${selected ? 'Deselect' : 'Select'}: ${item.description}`
              : `Edit punch item: ${item.description}`}
            accessibilityHint={selectMode ? undefined : 'Opens this item for editing. Long press to start selecting.'}
            testID={`punch-item-${item.id}`}
          >
            <Text style={[styles.punchDesc, !formal && styles.punchDescCrew]}>{item.description}</Text>
            {item.location ? <Text style={styles.punchLocation}>{item.location}</Text> : null}
          </TouchableOpacity>
          {/* Where the PHONE was when the photo was taken — written by
              punch-walk and ai-punch on every stamped capture and, until now,
              rendered on no screen at all. Labelled as GPS rather than merged
              into the location line: it is a street address or a lat/lng, not
              the room he typed, and showing one as the other is a guess. */}
          {item.photoLocationLabel ? (
            <View style={styles.geoChip}>
              <MapPin size={10} color={themeColors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.geoChipText} numberOfLines={1}>
                Photo GPS · {item.photoLocationLabel}
              </Text>
            </View>
          ) : null}
          {item.planSheetId ? (
            <TouchableOpacity
              style={styles.onPlanChip}
              onPress={() => actions.onOpenPlan(item)}
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
          onPress={() => actions.onAdvance(item)}
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

      {/* PUNCH: the due date is the headline of the meta line, as a chip —
          red and counted when late, amber inside two days. Someone is holding
          the builder to these dates, so they are the first thing read. */}
      {formal && item.dueDate ? (
        <View style={[
          styles.dueChip,
          overdue ? styles.dueChipOverdue : (dueIn !== null && dueIn <= 2 ? styles.dueChipSoon : null),
        ]}>
          <CalendarClock
            size={12}
            color={overdue ? themeColors.dangerLabel : (dueIn !== null && dueIn <= 2 ? themeColors.warningLabel : themeColors.textSecondary)}
            strokeWidth={1.75}
          />
          <Text style={[
            styles.dueChipText,
            overdue ? { color: themeColors.dangerLabel } : (dueIn !== null && dueIn <= 2 ? { color: themeColors.warningLabel } : null),
          ]}>
            {overdue
              ? `Overdue ${pluralDays(-(dueIn as number))} · was due ${formatCalendarDay(item.dueDate)}`
              : dueIn === 0
                ? `Due today · ${formatCalendarDay(item.dueDate)}`
                : `Due ${formatCalendarDay(item.dueDate)}`}
          </Text>
        </View>
      ) : null}

      <View style={styles.punchMeta}>
        {item.assignedSub ? <Text style={styles.punchMetaText}>Sub: {item.assignedSub}</Text> : null}
        {/* dueDate is declared 'YYYY-MM-DD' but Supabase-synced rows
            carry a full ISO timestamp — openEditForm already slices
            for exactly that reason. This printed the raw field, so one
            item read "Due: 2026-08-30" locally and
            "Due: 2026-08-30T00:00:00.000Z" after a sync.

            CREW: the date stays in the quiet meta line. Late is still SAID —
            hiding it would be its own lie — but in secondary ink, no fill. */}
        {!formal && item.dueDate ? (
          <Text style={[styles.punchMetaText, overdue && styles.punchMetaTextLate]}>
            Due {formatCalendarDay(item.dueDate)}{overdue ? ` · ${pluralDays(-(dueIn as number))} past` : ''}
          </Text>
        ) : null}
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

      {/* The per-row action rail is hidden while selecting. Fourteen small
          targets competing with a checkbox is how the wrong item gets closed
          on a bright screen; the bulk bar owns the verbs in that mode. */}
      {selectMode ? null : (
        <View style={styles.punchActions}>
          {item.status === 'open' && (
            <TouchableOpacity style={styles.punchActionBtn} onPress={() => actions.onStatus(item, 'in_progress')}>
              <Clock size={14} color={themeColors.info} strokeWidth={1.75} />
              <Text style={[styles.punchActionText, { color: themeColors.info }]}>Start</Text>
            </TouchableOpacity>
          )}
          {item.status === 'in_progress' && (
            <TouchableOpacity style={styles.punchActionBtn} onPress={() => actions.onStatus(item, 'ready_for_review')}>
              <Eye size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={[styles.punchActionText, { color: themeColors.accent }]}>Submit for Review</Text>
            </TouchableOpacity>
          )}
          {item.status === 'ready_for_review' && (
            <>
              <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: themeColors.successSoft }]} onPress={() => actions.onStatus(item, 'closed')}>
                <CheckCircle size={14} color={themeColors.success} strokeWidth={1.75} />
                <Text style={[styles.punchActionText, { color: themeColors.success }]}>Close</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.punchActionBtn, { backgroundColor: themeColors.dangerSoft }]} onPress={() => actions.onReject(item)}>
                <X size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                <Text style={[styles.punchActionText, { color: themeColors.dangerLabel }]}>Reject</Text>
              </TouchableOpacity>
            </>
          )}
          {/* One tap to the other list. Confirmed in onMove, because the move
              changes what the client can see. */}
          <TouchableOpacity
            style={styles.punchActionBtn}
            onPress={() => actions.onMove(item)}
            accessibilityRole="button"
            accessibilityLabel={moveTo === 'punch'
              ? `Move to the punch list: ${item.description}`
              : `Move to the crew list: ${item.description}`}
            accessibilityHint={moveTo === 'punch'
              ? 'Asks first. Punch items can be shown in the client portal.'
              : 'Asks first. Crew list items are never shown in the client portal.'}
            testID={`punch-move-${item.id}`}
          >
            <ArrowLeftRight size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.punchActionText, { color: themeColors.textSecondary }]}>
              {moveTo === 'punch' ? 'To punch' : 'To crew'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.punchDeleteBtn}
            onPress={() => actions.onDelete(item)}
            accessibilityRole="button"
            accessibilityLabel="Delete"
          >
            <Trash2 size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

export default function PunchListScreen() {
  const router = useRouter();
  // Read the project from params here (not just in Inner) so the gate can
  // ask 'were they invited to THIS project?' before paywalling.
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useProjectAccess(gateProjectId);
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
  const { projects, getProject, getPunchItemsForProject, addPunchItem, addPunchItems, updatePunchItem, updatePunchItems, deletePunchItem, deletePunchItems, updateProject, subcontractors } = useProjects();

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  /** Both lists. Closeout ("is every item done?") and selection resolution
   *  read this — a crew touch-up left open is still work left on the job. */
  const allItems = useMemo(() => getPunchItemsForProject(projectId ?? ''), [projectId, getPunchItemsForProject]);

  // ── Which list is showing ────────────────────────────────────────────────
  // Defaults to the formal punch list: it is the list with consequences, and
  // the one every pre-split item is on. The stored choice is restored below
  // alongside the grouping preference.
  const [activeList, setActiveList] = useState<PunchListType>('punch');
  /** The list on screen. Everything list-shaped below — counts, filters,
   *  location chips, sections, progress — reads THIS, so the two lists never
   *  bleed into each other's numbers. */
  const items = useMemo(
    () => allItems.filter(i => punchListTypeOf(i) === activeList),
    [allItems, activeList],
  );
  /** Open (not closed) and overdue counts for both lists, for the switch and
   *  the header. One pass, not one per chip. */
  const listStats = useMemo(() => {
    const out: Record<PunchListType, { open: number; overdue: number; total: number }> = {
      punch: { open: 0, overdue: 0, total: 0 },
      crew: { open: 0, overdue: 0, total: 0 },
    };
    for (const i of allItems) {
      const s = out[punchListTypeOf(i)];
      s.total += 1;
      if (i.status !== 'closed') s.open += 1;
      const due = daysUntilDue(i);
      if (due !== null && due < 0) s.overdue += 1;
    }
    return out;
  }, [allItems]);
  /** "Your client sees this list" is only true when the portal is on AND its
   *  punch-list section is on — the same two flags buildPortalSnapshot and
   *  client-view gate the section on. Every client-facing line reads this. */
  const clientSeesPunch = !!(project?.clientPortal?.enabled && project.clientPortal.showPunchList);

  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<PunchItem | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [assignedSub, setAssignedSub] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<PunchItemPriority>('medium');
  /** The add/edit sheet's own list choice. Seeded from the list showing (new)
   *  or the item (edit); he can flip it explicitly in the sheet. */
  const [formListType, setFormListType] = useState<PunchListType>('punch');
  const [linkedTaskId, setLinkedTaskId] = useState<string>('');
  // Optional photo URI to attach when creating a new item — comes from
  // the photo annotator's "Add to Punch List" flow. Surfaces in the
  // form as a thumbnail badge so the GC sees what they're attaching.
  const [attachedPhotoUri, setAttachedPhotoUri] = useState<string | undefined>(undefined);

  // Photo walk — the burst-capture path. `walkShots` is a staging area, not the
  // punch list: nothing here exists as an item until it has a description.
  const [walkShots, setWalkShots] = useState<WalkShot[]>([]);
  const [showWalk, setShowWalk] = useState(false);

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
        // Onto whichever list he applied it from — a trade checklist dropped
        // into the crew list must not surface on the client's portal.
        listType: activeList,
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
      `Added ${added} item${added === 1 ? '' : 's'} from "${template.label}" to the ${activeList === 'punch' ? 'punch list' : 'crew list'}. Edit or remove any that don't apply to this project.`,
    );
  }, [projectId, addPunchItem, activeList]);
  const [rejectionNote, setRejectionNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PunchItemStatus | 'all'>('all');
  // Multi-axis filters layered on top of status. Each filter is an
  // OR within its axis but AND across axes so the GC can drill down
  // ("show me all open electrical items assigned to Acme that are
  // high or critical priority"). Empty string = "any" for that axis.
  const [filterSub, setFilterSub] = useState<string>('');         // matches PunchItem.assignedSub
  const [filterPriority, setFilterPriority] = useState<PunchItemPriority | 'all'>('all');
  // Was a free-text "location contains" box. A substring match is what made
  // "hall" also return "Hall bath" — on a 100+ item list that silently hands a
  // sub the wrong room's work. This now holds a NORMALISED location key from
  // utils/punchLocations (or UNPLACED_LOCATION_GROUP), picked from a chip, and
  // matched exactly.
  const [filterLocationKey, setFilterLocationKey] = useState<string>('');
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);

  // The saved item's own photo, opened full-screen from its row thumbnail.
  // Until now a punch photo was write-only: captured, uploaded, and never
  // rendered again once the item existed. `photoUri` is already the
  // best-URL-right-now (ProjectContext signs a bucket path on load and prefers
  // this device's local original), so it renders directly.
  const [viewerItem, setViewerItem] = useState<PunchItem | null>(null);
  // Hoisted so the <Image> onError closure keeps the narrowed string — TS
  // drops property narrowing inside callbacks, and a `!` here would be a lie
  // waiting to become a crash.
  const viewerPhotoUri = viewerItem?.photoUri;
  // A signed URL expires, and legacy rows can still hold another device's
  // `file://`. Either way <Image> resolves to nothing and leaves an empty
  // frame that reads as "the photo is gone" — showing no thumbnail is the
  // honest result. Keyed by URI, not item id, so a re-signed URL or a
  // replaced photo gets a fresh attempt instead of staying blank all session.
  const [failedPhotoUris, setFailedPhotoUris] = useState<Record<string, true>>({});
  const markPhotoFailed = useCallback((uri: string) => {
    setFailedPhotoUris(prev => (prev[uri] ? prev : { ...prev, [uri]: true }));
  }, []);

  // The screen can open (prefilled from the photo annotator) before the stored
  // list choice has loaded. Follow the list until he is editing a real item,
  // so a new item still lands on the list he ends up looking at.
  useEffect(() => {
    if (!editingItem) setFormListType(activeList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeList]);

  const scheduleTasks = useMemo(() => project?.schedule?.tasks ?? [], [project]);
  const linkedTask = useMemo(() => scheduleTasks.find(t => t.id === linkedTaskId), [scheduleTasks, linkedTaskId]);

  const resetForm = useCallback(() => {
    setDescription(''); setLocation(''); setAssignedSub('');
    setDueDate(''); setPriority('medium'); setEditingItem(null);
    setLinkedTaskId('');
    // A new item lands on the list he is looking at.
    setFormListType(activeList);
    // Clear any attached photo so a cancelled form doesn't silently carry
    // it into the next new item.
    setAttachedPhotoUri(undefined);
  }, [activeList]);

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
    setFormListType(punchListTypeOf(item));
    setLinkedTaskId(item.linkedTaskId ?? '');
    // The sheet has no photo control — only a preview for the annotator's
    // "Add to Punch List" prefill — and handleSave's update branch does not
    // touch photoUri. Clearing avoids showing a previous prefill's photo (with
    // a remove button that would do nothing) on top of someone else's item.
    setAttachedPhotoUri(undefined);
    setShowForm(true);
  }, []);

  // Progress is per list — "18 of 40 punch items closed" is the number that
  // means something on the punch list; blending in crew chores would dilute it.
  const closedCount = items.filter(i => i.status === 'closed').length;
  const totalCount = items.length;
  const progressPercent = totalCount > 0 ? Math.round((closedCount / totalCount) * 100) : 0;
  // Closing the PROJECT is across both lists: an open crew item is still work.
  const allClosed = allItems.length > 0 && allItems.every(i => i.status === 'closed');

  const filteredItems = useMemo(() => {
    let out = items;
    if (filterStatus !== 'all') out = out.filter(i => i.status === filterStatus);
    if (filterSub) out = out.filter(i => (i.assignedSub ?? '').toLowerCase() === filterSub.toLowerCase());
    if (filterPriority !== 'all') out = out.filter(i => i.priority === filterPriority);
    // Exact, normalised match through the shared module — see filterLocationKey.
    if (filterLocationKey) out = filterByLocationKey(out, filterLocationKey);
    return out;
  }, [items, filterStatus, filterSub, filterPriority, filterLocationKey]);

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

  // ── Locations ────────────────────────────────────────────────────────────
  // One source for every location on this project: the rooms already on punch
  // items (always available — no plans, no AI, no signal), merged with the room
  // names from the saved Plan Intelligence session when the project has one.
  // A project with no analysed plans is the normal case, not an error state.
  const { getSession: getPlanRoomSession } = usePlanRooms();
  const planRooms = useMemo(
    () => (projectId ? getPlanRoomSession(projectId)?.rooms : undefined),
    [projectId, getPlanRoomSession],
  );
  const locationOptions = useMemo(
    () => buildPunchLocationOptions(items, planRooms),
    [items, planRooms],
  );
  /** Only rooms that actually hold items can be filtered TO — a chip that
   *  always yields an empty list is a trap, not a filter. Plan rooms with no
   *  punch items stay out; `onPlan` on the ones that do have items is how the
   *  plans still show up. */
  const filterableLocations = useMemo(
    () => locationOptions.filter(o => o.count > 0),
    [locationOptions],
  );
  const filterLocationLabel = useMemo(() => {
    if (!filterLocationKey) return '';
    if (filterLocationKey === UNPLACED_LOCATION_GROUP) return 'No location given';
    return filterableLocations.find(o => o.key === filterLocationKey)?.label ?? filterLocationKey;
  }, [filterLocationKey, filterableLocations]);
  /** Items captured with no location at all — they get their own filter chip
   *  and their own trailing group, because they are the ones that get lost. */
  const unplacedCount = useMemo(
    () => items.filter(i => normalizeLocation(i.location) === '').length,
    [items],
  );
  /** Which of the used rooms are also on the plans, for the section headers. */
  const onPlanKeys = useMemo(() => {
    const set = new Set<string>();
    for (const o of locationOptions) if (o.onPlan) set.add(o.key);
    return set;
  }, [locationOptions]);

  const activeFilterCount = useMemo(() => {
    return (filterStatus !== 'all' ? 1 : 0)
      + (filterSub ? 1 : 0)
      + (filterPriority !== 'all' ? 1 : 0)
      + (filterLocationKey ? 1 : 0);
  }, [filterStatus, filterSub, filterPriority, filterLocationKey]);

  const clearAllFilters = useCallback(() => {
    setFilterStatus('all');
    setFilterSub('');
    setFilterPriority('all');
    setFilterLocationKey('');
  }, []);

  // ── Grouped vs flat, remembered ──────────────────────────────────────────
  // Defaults to GROUPED. On the walk this was rebuilt for, a flat list of 100+
  // items cannot be closed out room by room, which is the only order a building
  // is actually walked in. The flat list is one tap away and the choice sticks.
  const [grouped, setGrouped] = useState(true);
  const [groupOrder, setGroupOrder] = useState<PunchGroupOrder>('recent');
  /** Nothing is written back until the stored value has been read (or the user
   *  has overruled it), so mounting the screen cannot persist the defaults over
   *  what he chose last time. */
  const viewPrefSettled = useRef(false);
  /** He tapped a view control. AsyncStorage is async, and on a cold start the
   *  read can land AFTER a fast first tap — without this the disk would quietly
   *  undo the choice he just made and watched happen. */
  const viewPrefTouched = useRef(false);

  const chooseGrouped = useCallback((next: boolean) => {
    viewPrefTouched.current = true;
    viewPrefSettled.current = true;
    setGrouped(next);
  }, []);

  const toggleGroupOrder = useCallback(() => {
    viewPrefTouched.current = true;
    viewPrefSettled.current = true;
    setGroupOrder(o => (o === 'recent' ? 'alpha' : 'recent'));
  }, []);

  // chooseList is declared below the selection block — switching lists has to
  // drop the selection, and that state lives there.

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let stored: PunchViewPref | null = null;
      try {
        stored = parseViewPref(await AsyncStorage.getItem(PUNCH_VIEW_PREF_KEY));
      } catch {
        // Storage unavailable (private browsing on web, a wedged disk). The
        // default view is a perfectly good screen — never block the list on it.
        stored = null;
      }
      if (cancelled || viewPrefTouched.current) return;
      if (stored) {
        setGrouped(stored.grouped);
        setGroupOrder(stored.order);
        setActiveList(stored.list);
      }
      viewPrefSettled.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!viewPrefSettled.current) return;
    void AsyncStorage.setItem(
      PUNCH_VIEW_PREF_KEY,
      JSON.stringify({ grouped, order: groupOrder, list: activeList } satisfies PunchViewPref),
    ).catch(() => { /* a remembered preference is not worth an error toast */ });
  }, [grouped, groupOrder, activeList]);

  /** Collapsed location sections, by normalised key. Session-scoped on purpose:
   *  collapsing a room is a "I'm done looking at this right now" gesture, and
   *  reopening the screen tomorrow to a list of closed accordions would hide
   *  work. */
  const [collapsed, setCollapsed] = useState<Record<string, true>>({});
  const toggleCollapse = useCallback((key: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setCollapsed(prev => {
      const next = { ...prev };
      if (next[key]) delete next[key]; else next[key] = true;
      return next;
    });
  }, []);

  // ── Selection ────────────────────────────────────────────────────────────
  // Assigning 30 items to a drywaller one row at a time is 30 round trips
  // through an edit sheet. Selection is the whole point of this screen at 100+
  // items, so it is reachable two ways: the Select button in the header, and a
  // long press on any row (one hand, no mode hunt).
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Record<string, true>>({});
  const selectedIdList = useMemo(() => Object.keys(selectedIds), [selectedIds]);
  const selectedCount = selectedIdList.length;
  /** Resolved against ALL items, not the filtered view: a bulk status change
   *  can push an item out of the current filter mid-run, and the run must still
   *  finish the work it was asked to do. */
  const selectedItems = useMemo(
    () => allItems.filter(i => selectedIds[i.id]),
    [allItems, selectedIds],
  );

  const toggleSelect = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    setSelectedIds(prev => {
      const next = { ...prev };
      if (next[id]) delete next[id]; else next[id] = true;
      return next;
    });
  }, []);

  const startSelecting = useCallback((id: string) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectMode(true);
    setSelectedIds(prev => (prev[id] ? prev : { ...prev, [id]: true }));
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedIds({});
    setSelectMode(false);
  }, []);

  /** Switch lists. The selection is dropped: a selection made on the punch
   *  list, still live but invisible behind the crew list, is how a bulk verb
   *  lands on items he can no longer see. */
  const chooseList = useCallback((next: PunchListType) => {
    if (next === activeList) return;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
    viewPrefTouched.current = true;
    viewPrefSettled.current = true;
    setSelectedIds({});
    setSelectMode(false);
    setActiveList(next);
  }, [activeList]);

  // ── The rows ─────────────────────────────────────────────────────────────
  // Grouping is done by the shared module so this screen and punch-walk can
  // never disagree about which items belong to which room.
  const sections = useMemo(
    () => (grouped ? groupPunchItemsByLocation(filteredItems, { order: groupOrder }) : []),
    [grouped, groupOrder, filteredItems],
  );

  const selectAllInSection = useCallback((key: string) => {
    const section = sections.find(s => s.key === key);
    if (!section) return;
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const allSelected = section.items.every(i => selectedIds[i.id]);
    setSelectMode(true);
    setSelectedIds(prev => {
      const next = { ...prev };
      for (const i of section.items) {
        if (allSelected) delete next[i.id]; else next[i.id] = true;
      }
      return next;
    });
  }, [sections, selectedIds]);

  const rows = useMemo<PunchRowData[]>(() => {
    const out: PunchRowData[] = [];
    const itemRow = (item: PunchItem): PunchRowData => ({
      kind: 'item',
      key: item.id,
      item,
      selected: !!selectedIds[item.id],
      selectMode,
      photoFailed: !!(item.photoUri && failedPhotoUris[item.photoUri]),
      variant: activeList,
    });

    if (!grouped) {
      for (const item of filteredItems) out.push(itemRow(item));
      return out;
    }

    for (const section of sections) {
      out.push({
        kind: 'section',
        key: `section:${section.key}`,
        sectionKey: section.key,
        label: section.label,
        onPlan: !section.isUnplaced && onPlanKeys.has(section.key),
        openCount: section.openCount,
        total: section.total,
        collapsed: !!collapsed[section.key],
        allSelected: section.items.length > 0 && section.items.every(i => selectedIds[i.id]),
        itemCount: section.items.length,
      });
      if (collapsed[section.key]) continue;   // a collapsed room costs one row
      for (const item of section.items) out.push(itemRow(item));
    }
    return out;
  }, [grouped, filteredItems, sections, collapsed, selectedIds, selectMode, failedPhotoUris, onPlanKeys, activeList]);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) {
      showAlert('Missing Description', 'Please describe the punch item.');
      return;
    }
    const linkedTaskName = linkedTask?.title;
    const commit = () => {
      if (editingItem) {
        updatePunchItem(editingItem.id, {
          description: desc, location: location.trim(), assignedSub: assignedSub.trim(),
          dueDate, priority,
          listType: formListType,
          linkedTaskId: linkedTaskId || undefined,
          linkedTaskName: linkedTaskName || undefined,
        });
      } else {
        const item: PunchItem = {
          id: createId('punch'), projectId: projectId ?? '', description: desc,
          location: location.trim(), assignedSub: assignedSub.trim(), dueDate,
          priority, status: 'open',
          listType: formListType,
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
      // A new item filed onto the OTHER list vanishes from the screen he is
      // on the instant it saves. Say where it went instead of letting it
      // look lost.
      if (formListType !== activeList) {
        nailIt(`Saved to the ${formListType === 'punch' ? 'punch list' : 'crew list'}.`);
      }
    };
    // Changing an EXISTING item's list in the sheet is a move, and a move
    // changes what the client can see — same confirmation as the row action.
    // A new item needs none: the sheet's list picker already says it in words
    // right under the choice, before anything exists to be exposed.
    if (editingItem && punchListTypeOf(editingItem) !== formListType) {
      const copy = moveConfirmCopy(formListType, 1, clientSeesPunch);
      showAlert(copy.title, copy.message, [
        { text: 'Cancel', style: 'cancel' },
        { text: copy.confirm, onPress: commit },
      ]);
      return;
    }
    commit();
  }, [description, location, assignedSub, dueDate, priority, formListType, activeList, clientSeesPunch, linkedTaskId, linkedTask, editingItem, projectId, addPunchItem, updatePunchItem, resetForm, attachedPhotoUri]);

  // ── Photo walk ───────────────────────────────────────────────────────────

  const startPhotoWalk = useCallback(async () => {
    const remaining = MAX_WALK_SHOTS - walkShots.length;
    if (remaining <= 0) {
      showAlert(
        'That is a full walk',
        `You have ${MAX_WALK_SHOTS} photos waiting for a description. File those first, then start another walk.`,
      );
      setShowWalk(true);
      return;
    }
    // The sheet opens FIRST so the frames are visibly landing behind the
    // camera and a walk interrupted by a phone call is not a blank screen.
    setShowWalk(true);
    const outcome = await captureBurst({
      remaining,
      onCaptured: ({ uri }) => {
        setWalkShots(prev => [...prev, {
          id: createId('walk'),
          uri,
          description: '',
          // Defects cluster by room, so each frame starts where the last one
          // was. It is a default the GC can overwrite, never an assertion.
          location: prev[prev.length - 1]?.location ?? '',
        }]);
      },
    });
    const note = burstSummary(outcome.captured, outcome.stoppedBy, `${MAX_WALK_SHOTS}-photo`);
    if (note) {
      if (outcome.captured > 0) nailIt(note);
      else showAlert('Camera', note);
    }
  }, [walkShots.length]);

  const updateWalkShot = useCallback((id: string, field: 'description' | 'location', value: string) => {
    setWalkShots(prev => prev.map(w => w.id === id ? { ...w, [field]: value } : w));
  }, []);

  const discardWalkShot = useCallback((id: string) => {
    showAlert('Discard this photo?', 'It has not been added to the punch list, so nothing else will remember it.', [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => setWalkShots(prev => prev.filter(w => w.id !== id)) },
    ]);
  }, []);

  /** The shots that are ready to become punch items. */
  const describedWalkShots = useMemo(
    () => walkShots.filter(w => w.description.trim().length > 0),
    [walkShots],
  );

  // A walk files in one gesture, and a gesture on a cold phone can register
  // twice. The filed rows leave `walkShots` on the next render, not in this
  // tick, so a second tap inside the same frame would re-read the same
  // `describedWalkShots` and file every defect a second time — twenty duplicate
  // punch items, each with its own row in Supabase. Held in a ref because
  // state cannot stop a double tap it has not re-rendered for yet.
  const filingWalkRef = useRef(false);

  const fileWalkShots = useCallback(() => {
    if (describedWalkShots.length === 0) return;
    if (filingWalkRef.current) return;
    filingWalkRef.current = true;
    const now = new Date().toISOString();
    // addPunchItems, not a loop of addPunchItem: the batch path prepends all N
    // rows in ONE setState and ONE AsyncStorage write. Looping the single-add
    // serialises the entire punch list once per photo — forty writes of a
    // growing array on the phone that just finished a forty-frame walk.
    addPunchItems(describedWalkShots.map(shot => ({
      id: createId('punch'),
      projectId: projectId ?? '',
      description: shot.description.trim(),
      location: shot.location.trim(),
      assignedSub: '',
      dueDate: '',
      priority: 'medium' as const,
      status: 'open' as const,
      // The walk files onto the list that is showing, like every other add.
      listType: activeList,
      photoUri: shot.uri,
      createdAt: now,
      updatedAt: now,
    })));
    const filed = describedWalkShots.length;
    // Only the filed ones leave the sheet. Anything still without a sentence
    // stays exactly where it is — dropping a photo the GC took to make the
    // count tidy is the one outcome this whole flow exists to prevent.
    const filedIds = new Set(describedWalkShots.map(w => w.id));
    const leftover = walkShots.filter(w => !filedIds.has(w.id));
    setWalkShots(leftover);
    if (leftover.length === 0) setShowWalk(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nailIt(leftover.length === 0
      ? `${filed} punch item${filed === 1 ? '' : 's'} added.`
      : `${filed} added. ${leftover.length} photo${leftover.length === 1 ? '' : 's'} still need a line.`);
  }, [describedWalkShots, walkShots, addPunchItems, projectId, activeList]);

  // Released only once the filed shots have actually LEFT `walkShots`. Clearing
  // it at the end of fileWalkShots would make the latch useless — the second
  // tap arrives in a later task, by which time the ref is false again and the
  // closure it fires may still be the pre-commit one.
  useEffect(() => { filingWalkRef.current = false; }, [walkShots]);

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
      // Across BOTH lists — the project is not done while a crew item is open.
      const others = allItems.filter((p: PunchItem) => p.projectId === projectId && p.id !== item.id);
      const allOthersClosed = others.length > 0 && others.every((p: PunchItem) => p.status === 'closed');
      const wasLastOpen = others.length === 0 || allOthersClosed;
      if (wasLastOpen && project.status === 'in_progress') {
        // Defer past the current render so the badge animation doesn't
        // fight the alert pop-in.
        setTimeout(() => {
          showAlert(
            'All punch items closed',
            `Nice — every punch and crew list item on ${project.name} is closed. Close the project so it stops showing in your active list?`,
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
  }, [updatePunchItem, projectId, project, allItems, updateProject]);

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

  // ── Bulk writes ──────────────────────────────────────────────────────────
  //
  // ONE context call per gesture, never a loop of the single-item action.
  // `updatePunchItems` / `deletePunchItems` (contexts/ProjectContext.tsx) apply
  // the whole selection in one state update and one AsyncStorage save, then
  // queue one Supabase write per row — so utils/offlineQueue still replays
  // each item independently on bad signal. The loop they replace cost 100
  // full-collection saves and 100 re-renders for a 100-item close, and an app
  // killed halfway left half the selection changed. Because the write is now
  // synchronous and all-or-nothing, there is no "saving 12 of 30" state for the
  // bar to lock against.
  const finishBulk = useCallback((n: number, label: string) => {
    clearSelection();
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nailIt(`${n} item${n === 1 ? '' : 's'} ${label}.`);
  }, [clearSelection]);

  const runBulkUpdate = useCallback((ids: string[], updates: Partial<PunchItem>, label: string) => {
    if (ids.length === 0) return;
    updatePunchItems(ids, updates);
    finishBulk(ids.length, label);
  }, [updatePunchItems, finishBulk]);

  const [showBulkSubPicker, setShowBulkSubPicker] = useState(false);
  const [showBulkStatusPicker, setShowBulkStatusPicker] = useState(false);

  const bulkAssignTo = useCallback((companyName: string, subId?: string) => {
    if (selectedIdList.length === 0) return;
    setShowBulkSubPicker(false);
    runBulkUpdate(
      [...selectedIdList],
      { assignedSub: companyName, ...(subId ? { assignedSubId: subId } : {}) },
      `assigned to ${companyName}`,
    );
  }, [selectedIdList, runBulkUpdate]);

  const bulkSetStatus = useCallback((next: PunchItemStatus) => {
    if (selectedIdList.length === 0) return;
    setShowBulkStatusPicker(false);
    const cfg = getStatusConfig(themeColors, next);
    runBulkUpdate(
      [...selectedIdList],
      // Stamped once for the whole batch: these were closed in one gesture, and
      // thirty closedAt values a millisecond apart is noise in the closeout.
      { status: next, ...(next === 'closed' ? { closedAt: new Date().toISOString() } : {}) },
      `moved to ${cfg.label}`,
    );
  }, [selectedIdList, themeColors, runBulkUpdate]);

  /** Move every selected item to the OTHER list in one batch write, like every
   *  other bulk verb — never a loop of updatePunchItem. Confirmed first, with
   *  the client consequence spelled out. */
  const bulkMove = useCallback(() => {
    if (selectedIdList.length === 0) return;
    const target = otherList(activeList);
    // Only the items not already there — a no-op write is still a queued
    // Supabase round trip on a phone with one bar.
    const ids = selectedItems.filter(i => punchListTypeOf(i) !== target).map(i => i.id);
    if (ids.length === 0) return;
    const copy = moveConfirmCopy(target, ids.length, clientSeesPunch);
    showAlert(copy.title, copy.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: copy.confirm,
        onPress: () => runBulkUpdate(
          ids,
          { listType: target },
          target === 'punch' ? 'moved to the punch list' : 'moved to the crew list',
        ),
      },
    ]);
  }, [selectedIdList, selectedItems, activeList, clientSeesPunch, runBulkUpdate]);

  /** Single-item move from the row rail. Same confirmation as the bulk verb. */
  const moveItem = useCallback((item: PunchItem) => {
    const target = otherList(punchListTypeOf(item));
    const copy = moveConfirmCopy(target, 1, clientSeesPunch);
    showAlert(copy.title, copy.message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: copy.confirm,
        onPress: () => {
          updatePunchItem(item.id, { listType: target });
          if (Platform.OS !== 'web') void Haptics.selectionAsync();
          // The row leaves this list the moment it saves; say where it went.
          nailIt(`Moved to the ${target === 'punch' ? 'punch list' : 'crew list'}.`);
        },
      },
    ]);
  }, [clientSeesPunch, updatePunchItem]);

  const bulkDelete = useCallback(() => {
    if (selectedIdList.length === 0) return;
    const ids = [...selectedIdList];
    const n = ids.length;
    // The one irreversible verb on this bar, so it says the number out loud.
    showAlert(
      `Delete ${n} punch item${n === 1 ? '' : 's'}?`,
      'They are removed from this project and from the closeout packet. This cannot be undone.',
      [
        { text: 'Keep them', style: 'cancel' },
        {
          text: `Delete ${n}`,
          style: 'destructive',
          onPress: () => {
            deletePunchItems(ids);
            finishBulk(n, 'deleted');
          },
        },
      ],
    );
  }, [selectedIdList, deletePunchItems, finishBulk]);

  // ── Handing a sub their list ─────────────────────────────────────────────
  // The sub portal already exists and already scopes punch items to one sub
  // (utils/subPortalSnapshot.ts). Nothing on this screen mentioned it, so the
  // one built-in way to hand a sub his share was invisible at the exact moment
  // he wanted it. Offered when the view is about EXACTLY one sub — the list is
  // filtered to them, or every selected item is theirs.
  const portalTarget = useMemo(() => {
    const pool = selectedCount > 0 ? selectedItems : (filterSub ? filteredItems : []);
    if (pool.length === 0) return null;
    const names = new Set<string>();
    let assignedId: string | undefined;
    for (const i of pool) {
      const n = (i.assignedSub ?? '').trim();
      if (!n) return null;                 // one unassigned item means "not one sub"
      names.add(n.toLowerCase());
      if (i.assignedSubId) assignedId = i.assignedSubId;
    }
    if (names.size !== 1) return null;
    const name = (pool[0].assignedSub ?? '').trim();
    // Prefer the id already on the item; fall back to matching the free-text
    // company name, which is what templates and older rows carry.
    const sub = subcontractors.find(s => s.id === assignedId)
      ?? subcontractors.find(s => (s.companyName ?? '').trim().toLowerCase() === name.toLowerCase());
    return { name, sub, count: pool.length };
  }, [selectedCount, selectedItems, filterSub, filteredItems, subcontractors]);

  const openSubPortal = useCallback(() => {
    if (!portalTarget?.sub || !projectId) return;
    router.push({
      pathname: '/sub-portal-setup' as never,
      params: { projectId, subId: portalTarget.sub.id } as never,
    });
  }, [portalTarget, projectId, router]);

  // ── Stable row callbacks ─────────────────────────────────────────────────
  // Every handler above closes over state that changes on nearly every render,
  // so passing them straight to a memoized row would make React.memo a no-op —
  // 200 cards re-rendering on each checkbox tap. The latest-ref indirection
  // gives the rows ONE object identity for the life of the screen.
  const latestActions = useRef({
    openEditForm, advanceStatus, handleStatusChange, deletePunchItem,
    setViewerItem, markPhotoFailed, toggleSelect, startSelecting,
    setShowRejectModal, setRejectionNote, router, moveItem,
  });
  latestActions.current = {
    openEditForm, advanceStatus, handleStatusChange, deletePunchItem,
    setViewerItem, markPhotoFailed, toggleSelect, startSelecting,
    setShowRejectModal, setRejectionNote, router, moveItem,
  };

  const rowActions = useMemo<PunchRowActions>(() => ({
    onEdit: item => latestActions.current.openEditForm(item),
    onAdvance: item => latestActions.current.advanceStatus(item),
    onStatus: (item, next) => latestActions.current.handleStatusChange(item, next),
    onReject: item => {
      latestActions.current.setShowRejectModal(item.id);
      latestActions.current.setRejectionNote('');
    },
    onDelete: item => {
      showAlert('Delete', 'Delete this punch item?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => latestActions.current.deletePunchItem(item.id) },
      ]);
    },
    onOpenPhoto: item => latestActions.current.setViewerItem(item),
    onPhotoFailed: uri => latestActions.current.markPhotoFailed(uri),
    onOpenPlan: item => latestActions.current.router.push({
      pathname: '/plan-viewer' as never,
      params: { sheetId: item.planSheetId ?? '', punchId: item.id } as never,
    }),
    onToggleSelect: id => latestActions.current.toggleSelect(id),
    onStartSelecting: id => latestActions.current.startSelecting(id),
    onMove: item => latestActions.current.moveItem(item),
  }), []);

  const latestSectionActions = useRef({ toggleCollapse, selectAllInSection });
  latestSectionActions.current = { toggleCollapse, selectAllInSection };
  const sectionActions = useMemo<PunchSectionActions>(() => ({
    onToggleCollapse: key => latestSectionActions.current.toggleCollapse(key),
    onToggleSectionSelect: key => latestSectionActions.current.selectAllInSection(key),
  }), []);

  const renderRow = useCallback(({ item: row }: ListRenderItemInfo<PunchRowData>) => (
    row.kind === 'section'
      ? (
        <LocationSectionHeader
          row={row}
          styles={styles}
          themeColors={themeColors}
          actions={sectionActions}
          selectMode={selectMode}
        />
      )
      : (
        <PunchRow row={row} styles={styles} themeColors={themeColors} actions={rowActions} />
      )
  ), [styles, themeColors, sectionActions, rowActions, selectMode]);

  const keyExtractor = useCallback((row: PunchRowData) => row.key, []);

  /** Measured, so the Brain FAB rides above the bulk bar instead of sitting on
   *  its buttons — no per-screen magic number. */
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const fabLift = selectMode ? bulkBarHeight : 0;
  useBrainFabLift(fabLift);

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

  // The list chrome, as ELEMENTS rather than components. FlatList renders a
  // passed element in place, so it reconciles like any other child — passing an
  // inline function component instead would remount the whole header on every
  // render and drop focus / scroll position inside it.
  const punchStats = listStats.punch;
  const crewStats = listStats.crew;
  const listHeader = (
    <View>
      {/* ── Punch | Crew list ────────────────────────────────────────────
          The first thing on the screen, because it decides what every number
          below it means. Each side carries its open count so he can see the
          other list has work without switching to it. */}
      <View style={styles.listSwitch} accessibilityRole="tablist">
        {(['punch', 'crew'] as const).map(list => {
          const on = activeList === list;
          const stats = list === 'punch' ? punchStats : crewStats;
          return (
            <TouchableOpacity
              key={list}
              style={[
                styles.listSwitchSeg,
                on && (list === 'punch' ? styles.listSwitchSegPunchOn : styles.listSwitchSegCrewOn),
              ]}
              onPress={() => chooseList(list)}
              activeOpacity={0.8}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${LIST_LABEL[list]}, ${stats.open} open`}
              testID={`punch-list-switch-${list}`}
            >
              <Text style={[styles.listSwitchLabel, on && styles.listSwitchLabelOn]}>{LIST_LABEL[list]}</Text>
              <View style={[
                styles.listSwitchCount,
                on && list === 'punch' && stats.overdue > 0 && styles.listSwitchCountAlarm,
              ]}>
                <Text style={[
                  styles.listSwitchCountText,
                  on && list === 'punch' && stats.overdue > 0 && { color: themeColors.dangerLabel },
                ]}>
                  {stats.open} open
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── What this list IS ────────────────────────────────────────────
          PUNCH: consequential, and only as consequential as is TRUE — the
          client line appears only when the portal actually shows this list.
          CREW: calm, and explicit that it stays internal. */}
      {activeList === 'punch' ? (
        <View style={styles.listBannerPunch} testID="punch-list-banner-punch">
          <View style={styles.listBannerRow}>
            <Eye size={15} color={themeColors.text} strokeWidth={2} />
            <Text style={styles.listBannerPunchTitle}>
              {clientSeesPunch ? 'Your client sees this list' : 'Formal punch list'}
            </Text>
          </View>
          <Text style={styles.listBannerPunchBody}>
            {clientSeesPunch
              ? 'Every item here that is not closed shows in their client portal, with its status. These are the items you are being held to.'
              : 'What the owner walks and holds you to. Punch list sharing is off in this project\'s client portal, so your client does not see it yet.'}
          </Text>
          {punchStats.open > 0 ? (
            <Text style={styles.listBannerPunchStats}>
              {punchStats.open} open
              {punchStats.overdue > 0 ? (
                <Text style={styles.listBannerOverdue}>{`  ·  ${punchStats.overdue} overdue`}</Text>
              ) : null}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.listBannerCrew} testID="punch-list-banner-crew">
          <EyeOff size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.listBannerCrewText}>
            Internal working list for your crew and subs — never shown in the client portal. A sub still sees the items assigned to them in their own sub portal.
          </Text>
        </View>
      )}

      <View style={styles.progressSection}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressTitle}>{activeList === 'punch' ? 'Punch list completion' : 'Crew list completion'}</Text>
          <Text style={styles.progressPercent}>{progressPercent}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progressPercent}%` }]} />
        </View>
        <Text style={styles.progressSub}>
          {closedCount} of {totalCount} {activeList === 'punch' ? 'punch' : 'crew list'} items closed
        </Text>
      </View>

      <View style={styles.filterBar}>
        {/* styles.filterScroll is load-bearing — see the note on the style
            itself. Without it this ScrollView sizes to the full intrinsic
            width of the five status chips and shoves the "More filters"
            button off the row. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterRow}
        >
          {(['all', 'open', 'in_progress', 'ready_for_review', 'closed'] as const).map(s => {
            const count = s === 'all' ? items.length : items.filter(i => i.status === s).length;
            const config = s === 'all' ? { label: 'All', color: themeColors.text, bg: themeColors.line } : getStatusConfig(themeColors, s);
            return (
              <TouchableOpacity
                key={s}
                style={[styles.filterChip, filterStatus === s && { backgroundColor: config.color }]}
                onPress={() => setFilterStatus(s)}
                accessibilityRole="button"
                accessibilityState={{ selected: filterStatus === s }}
                accessibilityLabel={`${s === 'all' ? 'All' : config.label}, ${count} items`}
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
      {(filterSub || filterPriority !== 'all' || filterLocationKey) && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activeFiltersRow}>
          {filterSub && (
            <TouchableOpacity style={styles.activeFilterPill} onPress={() => setFilterSub('')} accessibilityRole="button" accessibilityLabel={`Remove the ${filterSub} filter`}>
              <Text style={styles.activeFilterPillText}>Sub: {filterSub}</Text>
              <X size={11} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
          {filterPriority !== 'all' && (
            <TouchableOpacity style={styles.activeFilterPill} onPress={() => setFilterPriority('all')} accessibilityRole="button" accessibilityLabel="Remove the priority filter">
              <Text style={styles.activeFilterPillText}>Priority: {filterPriority}</Text>
              <X size={11} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
          {filterLocationKey && (
            <TouchableOpacity style={styles.activeFilterPill} onPress={() => setFilterLocationKey('')} accessibilityRole="button" accessibilityLabel="Remove the location filter">
              <Text style={styles.activeFilterPillText}>Location: {filterLocationLabel}</Text>
              <X size={11} color={themeColors.accent} strokeWidth={1.75} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={clearAllFilters} style={[styles.activeFilterPill, { backgroundColor: themeColors.line }]} accessibilityRole="button" accessibilityLabel="Clear all filters">
            <Text style={[styles.activeFilterPillText, { color: themeColors.textSecondary }]}>Clear all</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* ── How the list reads ───────────────────────────────────────────
          Grouped by location is the default because a building is walked
          room by room; the flat list is one tap away and the choice is
          remembered for the next visit. */}
      {items.length > 0 ? (
        <View style={styles.viewBar}>
          <TouchableOpacity
            style={[styles.viewChip, grouped && styles.viewChipActive]}
            onPress={() => chooseGrouped(true)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: grouped }}
            accessibilityLabel="Group the list by location"
            testID="punch-view-grouped"
          >
            <Layers size={13} color={grouped ? themeColors.accentLabel : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.viewChipText, grouped && styles.viewChipTextActive]}>By location</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.viewChip, !grouped && styles.viewChipActive]}
            onPress={() => chooseGrouped(false)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{ selected: !grouped }}
            accessibilityLabel="Show one flat list"
            testID="punch-view-flat"
          >
            <List size={13} color={!grouped ? themeColors.accentLabel : themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={[styles.viewChipText, !grouped && styles.viewChipTextActive]}>Flat</Text>
          </TouchableOpacity>
          {grouped ? (
            <TouchableOpacity
              style={styles.viewChip}
              onPress={toggleGroupOrder}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={groupOrder === 'recent'
                ? 'Rooms are ordered most recent first. Switch to A to Z.'
                : 'Rooms are ordered A to Z. Switch to most recent first.'}
              testID="punch-group-order"
            >
              <ArrowUpDown size={13} color={themeColors.textSecondary} strokeWidth={1.75} />
              <Text style={styles.viewChipText}>{groupOrder === 'recent' ? 'Recent' : 'A–Z'}</Text>
            </TouchableOpacity>
          ) : null}
          <View style={{ flex: 1 }} />
          {filteredItems.length > 0 ? (
            <TouchableOpacity
              style={[styles.viewChip, selectMode && styles.viewChipActive]}
              onPress={() => (selectMode ? clearSelection() : setSelectMode(true))}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityState={{ selected: selectMode }}
              accessibilityLabel={selectMode ? 'Stop selecting' : 'Select several items'}
              testID="punch-select-mode"
            >
              <SquareCheck size={13} color={selectMode ? themeColors.accentLabel : themeColors.textSecondary} strokeWidth={1.75} />
              <Text style={[styles.viewChipText, selectMode && styles.viewChipTextActive]}>
                {selectMode ? 'Done' : 'Select'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* ── Hand this sub their list ─────────────────────────────────────
          Only when the view is about exactly one sub. The portal itself
          already exists and already scopes punch items to them; this is the
          door to it, at the moment he wants it. */}
      {!selectMode && portalTarget ? (
        portalTarget.sub ? (
          <TouchableOpacity
            style={styles.portalBanner}
            onPress={openSubPortal}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Build the sub portal link for ${portalTarget.name}`}
            testID="punch-sub-portal"
          >
            <Send size={14} color={themeColors.accent} strokeWidth={1.75} />
            <Text style={styles.portalBannerText} numberOfLines={2}>
              Hand {portalTarget.name} their {portalTarget.count} item{portalTarget.count === 1 ? '' : 's'} — open their portal link
            </Text>
            <ChevronRight size={14} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>
        ) : (
          // Blocked, and it says why: the portal is keyed to a subcontractor
          // record, and this name only exists as free text on the items.
          <View style={styles.portalBannerOff}>
            <Send size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.portalBannerOffText}>
              No portal for &quot;{portalTarget.name}&quot; — that name is typed on the items but isn&apos;t in your subcontractor list. Add them under Subs and reassign to build a link.
            </Text>
          </View>
        )
      ) : null}
    </View>
  );

  const listEmpty = (
    <View style={{ minHeight: 360 }}>
      <EmptyState
        icon={<CheckCircle size={36} color={themeColors.accent} strokeWidth={1.75} />}
        title={activeFilterCount > 0
          ? 'Nothing matches those filters'
          : activeList === 'punch' ? 'No punch items yet' : 'Nothing on the crew list'}
        message={activeFilterCount > 0
          ? 'Nothing is left after the filters above. Clear one to see the rest of the list.'
          : activeList === 'punch'
            ? 'Walk the project, snap photos of anything that needs touch-up, and add the items here. They\'ll roll into your closeout packet automatically.'
            : 'Touch-ups, cleanup and "while you\'re in there" fixes for your own crew and subs. Nothing added here is shown to your client.'}
        actionLabel={activeFilterCount > 0
          ? 'Clear all filters'
          : activeList === 'punch' ? 'Add first punch item' : 'Add first crew item'}
        onAction={activeFilterCount > 0 ? clearAllFilters : () => { resetForm(); setShowForm(true); }}
      />
    </View>
  );

  const listFooter = (
    <View>
      <TouchableOpacity style={styles.addItemBtn} onPress={() => { resetForm(); setShowForm(true); }} activeOpacity={0.7} testID="add-punch-item" accessibilityRole="button" accessibilityLabel={activeList === 'punch' ? 'Add punch item' : 'Add crew list item'}>
        <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
        <Text style={styles.addItemBtnText}>{activeList === 'punch' ? 'Add Punch Item' : 'Add Crew List Item'}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.addItemBtn}
        onPress={() => setShowTemplates(true)}
        activeOpacity={0.7}
        testID="apply-punch-template"
        accessibilityRole="button"
        accessibilityLabel="Apply a trade template"
      >
        <MagePunch size={16} color={themeColors.accent} />
        <Text style={styles.addItemBtnText}>Apply trade template</Text>
      </TouchableOpacity>

      {/* Burst capture. Sits above voice Walk Mode because a photo walk is
          what a super does first — he shoots the floor, then describes it. */}
      <TouchableOpacity
        style={styles.walkBtn}
        onPress={() => { void startPhotoWalk(); }}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel="Start a photo walk"
        testID="start-photo-walk"
      >
        <Camera size={16} color={"#FFFFFF"} strokeWidth={1.75} />
        <Text style={styles.walkBtnText}>
          {walkShots.length > 0
            ? `Photo walk — ${walkShots.length} waiting for a line`
            : 'Photo walk — shoot the whole floor'}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.walkBtn}
        // `list` hands Walk Mode the list that is showing, so a voice walk
        // started from the crew list files crew items (app/punch-walk.tsx
        // reads it; an absent value starts on 'punch').
        onPress={() => router.push({ pathname: '/punch-walk' as never, params: { projectId: projectId ?? '', list: activeList } as never })}
        activeOpacity={0.85}
        testID="open-punch-walk"
        accessibilityRole="button"
        accessibilityLabel="Walk mode, voice capture"
      >
        <Mic size={16} color={"#FFFFFF"} strokeWidth={1.75} />
        <Text style={styles.walkBtnText}>Walk Mode — voice capture</Text>
      </TouchableOpacity>

      {allClosed && totalCount > 0 && project.status !== 'completed' && project.status !== 'closed' && (
        <TouchableOpacity style={styles.closeProjectBtn} onPress={handleCloseProject} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Close project">
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
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={{ title: `Punch List — ${project.name}` }} />
      <FlatList
        {...fabScroll}
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        // The FlatList OWNS the scroll axis. Nesting it in a ScrollView would
        // give it unbounded height and mount all 200 cards anyway — the header
        // and footer ride along as list chrome instead.
        ListHeaderComponent={listHeader}
        ListFooterComponent={listFooter}
        ListEmptyComponent={listEmpty}
        contentContainerStyle={{
          paddingBottom: insets.bottom + fabLift + BRAIN_FAB_CLEARANCE,
        }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        // A punch card is a fixed-ish height block with no swipeable and no
        // text input, so clipping off-screen ones is free. Not on web, where
        // RN-web implements it as overflow trickery that can blank rows.
        removeClippedSubviews={Platform.OS !== 'web'}
        keyboardShouldPersistTaps="handled"
        testID="punch-list"
      />

      {/* ── Bulk action bar ──────────────────────────────────────────────
          Fixed to the bottom because the selection it acts on is spread over
          a list he is scrolling: a bar that scrolls away with the header means
          scrolling back up after every room. */}
      {selectMode ? (
        <View
          style={[styles.bulkBar, { paddingBottom: insets.bottom + 12 }]}
          onLayout={e => setBulkBarHeight(e.nativeEvent.layout.height)}
        >
          <View style={styles.bulkBarTop}>
            <Text style={styles.bulkBarCount}>{`${selectedCount} selected`}</Text>
            <TouchableOpacity
              onPress={clearSelection}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Done selecting"
              testID="punch-bulk-done"
            >
              <Text style={styles.bulkBarDone}>Done</Text>
            </TouchableOpacity>
          </View>

          {/* Nothing selected yet: say what the bar is for instead of showing
              four dead buttons. */}
          {selectedCount === 0 ? (
            <Text style={styles.bulkBarHint}>
              Tap items to select them, or use a location&apos;s checkbox to take a whole room at once.
            </Text>
          ) : (
            <View style={styles.bulkBarActions}>
              <TouchableOpacity
                style={styles.bulkBtn}
                onPress={() => setShowBulkSubPicker(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Assign ${selectedCount} items to a sub`}
                testID="punch-bulk-assign"
              >
                <Users size={14} color={themeColors.accentLabel} strokeWidth={1.75} />
                <Text style={styles.bulkBtnText}>Assign</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.bulkBtn}
                onPress={() => setShowBulkStatusPicker(true)}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Set status on ${selectedCount} items`}
                testID="punch-bulk-status"
              >
                <ListChecks size={14} color={themeColors.accentLabel} strokeWidth={1.75} />
                <Text style={styles.bulkBtnText}>Status</Text>
              </TouchableOpacity>

              {/* To the other list. The confirmation (bulkMove) says what the
                  client will or won't see before anything is written. */}
              <TouchableOpacity
                style={styles.bulkBtn}
                onPress={bulkMove}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Move ${selectedCount} items to the ${activeList === 'punch' ? 'crew list' : 'punch list'}`}
                testID="punch-bulk-move"
              >
                <ArrowLeftRight size={14} color={themeColors.accentLabel} strokeWidth={1.75} />
                <Text style={styles.bulkBtnText} numberOfLines={1}>
                  {activeList === 'punch' ? 'To crew' : 'To punch'}
                </Text>
              </TouchableOpacity>

              {/* Only when every selected item belongs to the same sub AND that
                  sub exists as a record — otherwise there is no portal to open
                  and a button here would be a dead end. */}
              {portalTarget?.sub ? (
                <TouchableOpacity
                  style={styles.bulkBtn}
                  onPress={openSubPortal}
                    activeOpacity={0.85}
                  accessibilityRole="button"
                    accessibilityLabel={`Open the sub portal for ${portalTarget.name}`}
                  testID="punch-bulk-portal"
                >
                  <Send size={14} color={themeColors.accentLabel} strokeWidth={1.75} />
                  <Text style={styles.bulkBtnText} numberOfLines={1}>Portal</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={styles.bulkBtnDanger}
                onPress={bulkDelete}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${selectedCount} items`}
                testID="punch-bulk-delete"
              >
                <Trash2 size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
                <Text style={[styles.bulkBtnText, { color: themeColors.dangerLabel }]}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      ) : null}

      {/* ── Photo-walk review ────────────────────────────────────────────
          One row per frame: the photo, one line of what is wrong, and where.
          Priority, sub and due date are deliberately absent — they are desk
          decisions, and asking for them here is what turns a five-minute walk
          back into an hour. Every item files as open / medium and gets sorted
          later from the list. */}
      <Modal visible={showWalk} transparent animationType="slide" onRequestClose={() => setShowWalk(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <View style={[styles.formCard, { paddingBottom: insets.bottom + 20, maxHeight: '92%' }]}>
              <View style={styles.formHeader}>
                <Text style={styles.formTitle}>Photo walk</Text>
                <TouchableOpacity onPress={() => setShowWalk(false)} accessibilityRole="button" accessibilityLabel="Close photo walk" testID="close-photo-walk">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {walkShots.length === 0 ? (
                  <Text style={styles.walkEmpty}>
                    No frames yet. Tap Shoot more — the camera stays open, so you can walk the whole floor before you type anything.
                  </Text>
                ) : null}

                {walkShots.map((shot, idx) => (
                  <View key={shot.id} style={styles.walkRow}>
                    <View style={styles.walkRowTop}>
                      <Image source={{ uri: shot.uri }} style={styles.walkThumb} resizeMode="cover" />
                      <View style={{ flex: 1, gap: 6 }}>
                        <View style={styles.walkRowHeader}>
                          <Text style={styles.walkRowNum}>Photo {idx + 1}</Text>
                          <TouchableOpacity
                            onPress={() => discardWalkShot(shot.id)}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`Discard photo ${idx + 1}`}
                          >
                            <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                          </TouchableOpacity>
                        </View>
                        <TextInput
                          style={styles.input}
                          value={shot.description}
                          onChangeText={v => updateWalkShot(shot.id, 'description', v)}
                          placeholder="What's wrong here?"
                          placeholderTextColor={themeColors.textMuted}
                          testID={`walk-desc-${idx}`}
                        />
                        <TextInput
                          style={styles.input}
                          value={shot.location}
                          onChangeText={v => updateWalkShot(shot.id, 'location', v)}
                          placeholder="Where — e.g. Unit 4B bath"
                          placeholderTextColor={themeColors.textMuted}
                        />
                      </View>
                    </View>
                  </View>
                ))}
              </ScrollView>

              <TouchableOpacity style={styles.walkShootBtn} onPress={() => { void startPhotoWalk(); }} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Shoot more photos" testID="walk-shoot-more">
                <Camera size={16} color={themeColors.accentLabel} strokeWidth={1.75} />
                <Text style={styles.walkShootBtnText}>Shoot more</Text>
              </TouchableOpacity>

              {/* A blocked control says WHY. With nothing described the button
                  names the one thing standing between the walk and the list. */}
              <TouchableOpacity
                style={[styles.walkFileBtn, describedWalkShots.length === 0 ? styles.walkFileBtnOff : null]}
                onPress={fileWalkShots}
                disabled={describedWalkShots.length === 0}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityState={{ disabled: describedWalkShots.length === 0 }}
                accessibilityLabel={describedWalkShots.length === 0
                  ? 'Add a line to a photo before it can be filed'
                  : `Add ${describedWalkShots.length} punch items`}
                testID="file-walk-items"
              >
                <Text style={styles.walkFileBtnText}>
                  {describedWalkShots.length === 0
                    ? 'Add a line to a photo to file it'
                    : `Add ${describedWalkShots.length} punch item${describedWalkShots.length === 1 ? '' : 's'}`}
                </Text>
              </TouchableOpacity>
              {walkShots.length > describedWalkShots.length ? (
                <Text style={styles.walkPending}>
                  {walkShots.length - describedWalkShots.length} photo{walkShots.length - describedWalkShots.length === 1 ? '' : 's'} still without a line — they stay here until you write one.
                </Text>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
              <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                <View style={styles.formHeader}>
                  <Text style={styles.formTitle}>
                    {editingItem ? 'Edit Item' : formListType === 'punch' ? 'New Punch Item' : 'New Crew List Item'}
                  </Text>
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

                {/* Which list — chosen explicitly, seeded from the list showing.
                    The line under it says the consequence in words, so the
                    choice is never a silent one. */}
                <Text style={styles.fieldLabel}>List</Text>
                <View style={styles.formListRow} accessibilityRole="radiogroup">
                  {(['punch', 'crew'] as const).map(list => {
                    const on = formListType === list;
                    return (
                      <TouchableOpacity
                        key={list}
                        style={[styles.formListBtn, on && styles.formListBtnOn]}
                        onPress={() => setFormListType(list)}
                        activeOpacity={0.8}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={LIST_LABEL[list]}
                        testID={`punch-form-list-${list}`}
                      >
                        {list === 'punch'
                          ? <Eye size={14} color={on ? themeColors.accentLabel : themeColors.textSecondary} strokeWidth={1.75} />
                          : <Wrench size={14} color={on ? themeColors.accentLabel : themeColors.textSecondary} strokeWidth={1.75} />}
                        <Text style={[styles.formListBtnText, on && styles.formListBtnTextOn]}>{LIST_LABEL[list]}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={styles.formListNote}>
                  {formListType === 'crew'
                    ? 'Internal — never shown in the client portal.'
                    : clientSeesPunch
                      ? 'Shown to your client in their portal until it is closed.'
                      : 'Formal punch list. Punch list sharing is off in the client portal, so your client does not see it yet.'}
                </Text>

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

      {/* Full-screen punch photo. A 44pt thumbnail is not enough to judge a
          deficiency by — the sub arguing "that's not my scope" needs the whole
          frame. Caption carries description + location so the photo stays
          attached to what it is evidence of. */}
      <Modal visible={viewerItem !== null} transparent animationType="fade" onRequestClose={() => setViewerItem(null)}>
        <View style={styles.viewerBackdrop}>
          <View style={[styles.viewerHeader, { paddingTop: insets.top + 12 }]}>
            <TouchableOpacity
              onPress={() => setViewerItem(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityRole="button"
              accessibilityLabel="Close photo"
              testID="punch-photo-close"
            >
              <X size={22} color="#fff" strokeWidth={1.75} />
            </TouchableOpacity>
            <Text style={styles.viewerCaption} numberOfLines={2}>
              {[viewerItem?.description, viewerItem?.location].filter(Boolean).join('  ·  ')}
            </Text>
          </View>
          {viewerPhotoUri ? (
            <Image
              source={{ uri: viewerPhotoUri }}
              style={styles.viewerImage}
              resizeMode="contain"
              // A URL that only fails at full size (expired between the
              // thumbnail load and the tap) closes rather than holding the
              // user on a black rectangle; the row drops its thumbnail too.
              onError={() => { markPhotoFailed(viewerPhotoUri); setViewerItem(null); }}
            />
          ) : null}
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

              {/* Location filter — a tap, not a typed substring.
                  Every chip is a room that actually holds items on THIS
                  project, ordered the way utils/punchLocations orders them
                  (most recently worked first), with its open/total count so he
                  can see which room still has work before he opens it. */}
              <View>
                <Text style={styles.filterSectionLabel}>Location</Text>
                <View style={styles.filterChipsWrap}>
                  <TouchableOpacity
                    style={[styles.filterDrawerChip, !filterLocationKey && styles.filterDrawerChipActive]}
                    onPress={() => setFilterLocationKey('')}
                    accessibilityRole="button"
                    accessibilityState={{ selected: !filterLocationKey }}
                    accessibilityLabel="Any location"
                  >
                    <Text style={[styles.filterDrawerChipText, !filterLocationKey && styles.filterDrawerChipTextActive]}>Any</Text>
                  </TouchableOpacity>
                  {filterableLocations.map((opt: PunchLocationOption) => {
                    const on = filterLocationKey === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[styles.filterDrawerChip, on && styles.filterDrawerChipActive]}
                        onPress={() => setFilterLocationKey(on ? '' : opt.key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={`${opt.label}, ${opt.openCount} open of ${opt.count}`}
                        testID={`punch-loc-${opt.key}`}
                      >
                        {/* "on plan" is drawn only when the saved Plan
                            Intelligence session actually names this room. */}
                        {opt.onPlan ? (
                          <MapPin size={10} color={on ? themeColors.surface : themeColors.textMuted} strokeWidth={1.75} />
                        ) : null}
                        <Text style={[styles.filterDrawerChipText, on && styles.filterDrawerChipTextActive]}>
                          {opt.label} ({opt.openCount}/{opt.count})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                  {unplacedCount > 0 ? (
                    <TouchableOpacity
                      style={[styles.filterDrawerChip, filterLocationKey === UNPLACED_LOCATION_GROUP && styles.filterDrawerChipActive]}
                      onPress={() => setFilterLocationKey(
                        filterLocationKey === UNPLACED_LOCATION_GROUP ? '' : UNPLACED_LOCATION_GROUP,
                      )}
                      accessibilityRole="button"
                      accessibilityState={{ selected: filterLocationKey === UNPLACED_LOCATION_GROUP }}
                      accessibilityLabel={`No location given, ${unplacedCount} items`}
                      testID="punch-loc-unplaced"
                    >
                      <Text style={[
                        styles.filterDrawerChipText,
                        filterLocationKey === UNPLACED_LOCATION_GROUP && styles.filterDrawerChipTextActive,
                      ]}>
                        No location ({unplacedCount})
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                  {filterableLocations.length === 0 && unplacedCount === 0 && (
                    <Text style={{ fontSize: Type.caption1.fontSize, color: themeColors.textMuted, padding: 4 }}>
                      No locations on any item yet. Walk Mode fills these in as you capture.
                    </Text>
                  )}
                </View>
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 8, paddingTop: 12, borderTopWidth: 0.5, borderTopColor: themeColors.line }}>
              <TouchableOpacity style={[styles.filterDrawerBtn, { backgroundColor: themeColors.line }]} onPress={clearAllFilters}>
                <Text style={[styles.filterDrawerBtnText, { color: themeColors.text }]}>Clear all</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.filterDrawerBtn, { backgroundColor: themeColors.accentFill, flex: 1.4 }]} onPress={() => setShowFilterDrawer(false)}>
                <Text style={[styles.filterDrawerBtnText, { color: "#FFFFFF" }]}>
                  Show {filteredItems.length} {filteredItems.length === 1 ? 'item' : 'items'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Bulk: assign to a sub ────────────────────────────────────────
          Assign only. There is deliberately no bulk "unassign": clearing
          `assignedSubId` would send an empty value at a uuid column, and a
          write that fails quietly in the offline queue is worse than a verb
          that isn't offered. Clear one on the item's own edit sheet. */}
      <Modal visible={showBulkSubPicker} transparent animationType="slide" onRequestClose={() => setShowBulkSubPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxHeight: '80%' as const, paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Assign {selectedCount} item{selectedCount === 1 ? '' : 's'}</Text>
              <TouchableOpacity onPress={() => setShowBulkSubPicker(false)} style={{ padding: 4 }} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ paddingBottom: 8 }}>
              {subcontractors.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={styles.pickerOption}
                  onPress={() => bulkAssignTo(s.companyName, s.id)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Assign to ${s.companyName}`}
                  testID={`punch-bulk-sub-${s.id}`}
                >
                  <Text style={styles.pickerOptionText}>{s.companyName}</Text>
                  {s.trade ? <Text style={styles.pickerOptionMeta}>{s.trade}</Text> : null}
                </TouchableOpacity>
              ))}
              {/* Trades already typed on items but with no subcontractor record
                  — templates write these. Offered so a bulk assign still works
                  before the address book is filled in. */}
              {subsInList
                .filter(name => !subcontractors.some(s => (s.companyName ?? '').trim().toLowerCase() === name.toLowerCase()))
                .map(name => (
                  <TouchableOpacity
                    key={`free-${name}`}
                    style={styles.pickerOption}
                    onPress={() => bulkAssignTo(name)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Assign to ${name}`}
                  >
                    <Text style={styles.pickerOptionText}>{name}</Text>
                    <Text style={styles.pickerOptionMeta}>Typed on items — not in your subs list</Text>
                  </TouchableOpacity>
                ))}
              {subcontractors.length === 0 && subsInList.length === 0 ? (
                <Text style={[styles.rejectDesc, { padding: 20, textAlign: 'center' as const }]}>
                  No subcontractors yet. Add one under Subs, then come back and assign the whole room at once.
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Bulk: set status ─────────────────────────────────────────────── */}
      <Modal visible={showBulkStatusPicker} transparent animationType="slide" onRequestClose={() => setShowBulkStatusPicker(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { paddingBottom: insets.bottom + 20 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Move {selectedCount} item{selectedCount === 1 ? '' : 's'} to</Text>
              <TouchableOpacity onPress={() => setShowBulkStatusPicker(false)} style={{ padding: 4 }} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            {(['open', 'in_progress', 'ready_for_review', 'closed'] as const).map(s => {
              const cfg = getStatusConfig(themeColors, s);
              return (
                <TouchableOpacity
                  key={s}
                  style={styles.pickerOption}
                  onPress={() => bulkSetStatus(s)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`Move ${selectedCount} items to ${cfg.label}`}
                  testID={`punch-bulk-status-${s}`}
                >
                  <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 }}>
                    <View style={[styles.statusSwatch, { backgroundColor: cfg.color }]} />
                    <Text style={styles.pickerOptionText}>{cfg.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
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
  // The status-chip rail shares filterBar's row with the "More filters"
  // button. Left alone it takes the whole row: Yoga's DefaultFlexShrink is
  // 0.0f on native (WebDefaultFlexShrink is 1.0f — this is one of the places
  // RN deliberately differs from CSS, see yoga/style/Style.h), so a sibling
  // sized from its own content cannot give the space back, and the chips end
  // up clipped under the button.
  //
  // `flex: 1` is the fix on both platforms. On native it works via flexBasis,
  // NOT shrink: Yoga's processFlexBasis resolves a positive `flex` with auto
  // basis to points(0), so the rail starts at zero width and flexGrow: 1 grows
  // it into exactly what is left after the 36pt button, the 8pt gap and
  // filterBar's 16pt paddingRight. (resolveFlexShrink only derives shrink from
  // a NEGATIVE flex, so `flex: 1` leaves flexShrink at 0 — the basis does the
  // work.) On react-native-web the same flexBasis: 0 keeps the ScrollView from
  // sizing to its intrinsic content width.
  //
  // minWidth: 0 here is redundant, kept only as defensive intent: it does NOT
  // guard against a `min-width: auto` floor, because react-native-web already
  // hardcodes `minWidth: 0` on the base style of EVERY View (view$raw in
  // exports/View/index.js), and a horizontal ScrollView renders its scrollable
  // element through that View — so `min-width: auto` never applies to begin
  // with. flex: 1 is the load-bearing declaration; verified in headless tests
  // only, so the on-device row layout still needs a simulator eye-check.
  filterScroll: { flex: 1, minWidth: 0 },
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
    backgroundColor: themeColors.accentFill,
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
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: themeColors.line,
  },
  filterDrawerChipActive: { backgroundColor: themeColors.accentFill },
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
  // ── Grouping / selection / bulk ────────────────────────────────────────
  viewBar: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingHorizontal: 20, paddingBottom: 12,
  },
  viewChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: Tokens.radius.panel,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 0.5, borderColor: themeColors.line,
  },
  // accentSoft + accentLabel is the pairing that stays readable in both themes;
  // accent behind white fails AA (see walkFileBtn's note).
  viewChipActive: { backgroundColor: themeColors.accentSoft, borderColor: themeColors.accent },
  viewChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  viewChipTextActive: { color: themeColors.accentLabel },
  sectionHeader: {
    flexDirection: 'row' as const, alignItems: 'center' as const,
    marginHorizontal: 20, marginTop: 6, marginBottom: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
  },
  sectionHeaderMain: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minHeight: 24 },
  sectionHeaderLabel: {
    fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text,
    flexShrink: 1,
  },
  sectionHeaderCount: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  sectionSelectBtn: { paddingLeft: 12, paddingVertical: 2 },
  rowCheckbox: { marginTop: 1 },
  punchCardSelected: { borderColor: themeColors.accent, backgroundColor: themeColors.accentSoft },
  geoChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    alignSelf: 'flex-start' as const, marginTop: 4,
  },
  geoChipText: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, flexShrink: 1 },
  portalBanner: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    marginHorizontal: 20, marginBottom: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accentSoft,
    borderWidth: 1, borderColor: themeColors.accent + '33',
  },
  portalBannerText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accentLabel, lineHeight: 18 },
  portalBannerOff: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    marginHorizontal: 20, marginBottom: 12,
    paddingHorizontal: 12, paddingVertical: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
  },
  portalBannerOffText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  bulkBar: {
    position: 'absolute' as const, left: 0, right: 0, bottom: 0,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: themeColors.surface,
    borderTopWidth: 0.5, borderTopColor: themeColors.line,
    gap: 10,
  },
  bulkBarTop: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  bulkBarCount: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  bulkBarDone: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  bulkBarHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17 },
  bulkBarActions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
  bulkBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    flexGrow: 1, justifyContent: 'center' as const,
    minHeight: 44, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.accentSoft,
  },
  bulkBtnDanger: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    flexGrow: 1, justifyContent: 'center' as const,
    minHeight: 44, paddingHorizontal: 12,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.dangerSoft,
  },
  bulkBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accentLabel },
  statusSwatch: { width: 10, height: 10, borderRadius: Tokens.radius.full },

  punchCard: { marginHorizontal: 20, marginBottom: 10, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.lg, padding: 16, borderWidth: 1, borderColor: themeColors.line, gap: 10 },
  // ── Two lists, two weights ─────────────────────────────────────────────
  // Formal: a solid left rule in body ink — the card reads as a record.
  punchCardFormal: { borderLeftWidth: 3, borderLeftColor: themeColors.text },
  // Late on the formal list: the rule turns danger and the border follows.
  punchCardFormalOverdue: { borderLeftColor: themeColors.danger, borderColor: themeColors.danger },
  // Crew: no border, quieter ground, tighter — a checklist line, not a record.
  punchCardCrew: { backgroundColor: themeColors.surfaceAlt, borderColor: themeColors.surfaceAlt, padding: 14, marginBottom: 8, gap: 8 },
  punchDescCrew: { fontWeight: '500' as const },
  dueChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5,
    alignSelf: 'flex-start' as const, marginLeft: 18,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
    backgroundColor: themeColors.neutralSoft,
  },
  dueChipSoon: { backgroundColor: themeColors.warningSoft },
  dueChipOverdue: { backgroundColor: themeColors.dangerSoft },
  dueChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  punchMetaTextLate: { color: themeColors.textSecondary },
  listSwitch: {
    flexDirection: 'row' as const, gap: 6,
    marginHorizontal: 20, marginTop: 16, padding: 4,
    borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.surfaceAlt,
  },
  listSwitchSeg: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    minHeight: 44, paddingHorizontal: 10,
    borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.surfaceAlt,
  },
  listSwitchSegPunchOn: { backgroundColor: themeColors.surface, borderColor: themeColors.text },
  listSwitchSegCrewOn: { backgroundColor: themeColors.surface, borderColor: themeColors.line },
  listSwitchLabel: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  listSwitchLabelOn: { color: themeColors.text, fontWeight: '700' as const },
  listSwitchCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Tokens.radius.full, backgroundColor: themeColors.neutralSoft },
  listSwitchCountAlarm: { backgroundColor: themeColors.dangerSoft },
  listSwitchCountText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  listBannerPunch: {
    ...cardSurface(themeColors, { radius: 'md', pad: 'none' }),
    marginHorizontal: 20, marginTop: 12, gap: 4,
    paddingHorizontal: 14, paddingVertical: 12,
    borderLeftWidth: 3, borderLeftColor: themeColors.text,
  },
  listBannerRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  listBannerPunchTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  listBannerPunchBody: { fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 18 },
  listBannerPunchStats: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text, marginTop: 2 },
  listBannerOverdue: { color: themeColors.dangerLabel },
  listBannerCrew: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    marginHorizontal: 20, marginTop: 12,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.surfaceAlt,
  },
  listBannerCrewText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.textSecondary, lineHeight: 18 },
  formListRow: { flexDirection: 'row' as const, gap: 8 },
  formListBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    minHeight: 44, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line,
  },
  formListBtnOn: { backgroundColor: themeColors.accentSoft, borderWidth: 1, borderColor: themeColors.accent },
  formListBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  formListBtnTextOn: { color: themeColors.accentLabel },
  formListNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 16 },
  punchCardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  // surfaceAlt backs the frame so a slow-loading remote photo shows a neutral
  // tile rather than punching a hole in the card.
  punchThumb: { width: 44, height: 44, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt },
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
  walkBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 10, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill },
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
  subChipActive: { backgroundColor: themeColors.accentFill },
  subChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  subChipTextActive: { color: '#fff' },
  priorityBtn: { flex: 1, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line, alignItems: 'center' },
  priorityBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  cancelBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveBtn: { flex: 2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center' },

  // ── Photo walk ─────────────────────────────────────────────────────────
  walkEmpty: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, lineHeight: 19, paddingVertical: 12 },
  walkRow: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  walkRowTop: { flexDirection: 'row' as const, gap: 12 },
  // 96pt: big enough to tell a scuff from a crack without opening it, small
  // enough that four rows fit above the keyboard.
  walkThumb: { width: 96, height: 96, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt },
  walkRowHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  walkRowNum: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  walkShootBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8,
    minHeight: 46, marginTop: 8, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentSoft,
  },
  walkShootBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.accentLabel },
  // accentFill (#BC440C, 5.29:1) is the accent tone white text may sit on;
  // themeColors.accent behind #fff is 2.87:1 and fails AA.
  walkFileBtn: {
    minHeight: 48, marginTop: 8, borderRadius: Tokens.radius.lg,
    backgroundColor: themeColors.accentFill, alignItems: 'center' as const, justifyContent: 'center' as const,
  },
  walkFileBtnOff: { backgroundColor: themeColors.textMuted },
  walkFileBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
  walkPending: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 8, lineHeight: 17 },
  saveBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: '#fff' },
  // Near-opaque, not the 0.45 sheet scrim — a photo judged against a
  // half-lit punch list behind it is a photo judged wrong.
  viewerBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)" },
  viewerHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingHorizontal: 16, paddingBottom: 12 },
  viewerCaption: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: '#fff' },
  viewerImage: { flex: 1, width: '100%' },
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
