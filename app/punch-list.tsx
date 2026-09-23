import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, Modal, KeyboardAvoidingView, Image,
  FlatList, Keyboard, type ListRenderItemInfo, RefreshControl, ActivityIndicator, useWindowDimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, useBrainFabLift, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, X, CheckCircle, Clock, Eye, MessageSquare,
  Trash2, Link2, ChevronDown, ListChecks, ChevronRight, Filter, MapPin,
  Camera, Square, SquareCheck, Users, Send, Layers, List, ArrowUpDown,
  ArrowLeftRight, EyeOff, Wrench, CalendarClock, MapPinned, MapPinPlus, Images,
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
import { useProjectRoleState } from '@/hooks/useProjectRole';
import {
  punchStatusPatch, punchRejectionBox, punchLocationText, invitedPunchProjects, latestRejectedAt,
  punchGateAnswer, punchFocusStep, punchItemFromQueryCache, punchItemsQueryKey, type PunchFocusApplied, isPunchReject, PUNCH_NO_ROOM_TEXT,
} from '@/utils/punchGcCore';
import Paywall from '@/components/Paywall';
import EmptyState from '@/components/EmptyState';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import { PunchExportHeaderButton, PunchExportSheet } from '@/components/punch/PunchExportSheet';
import type { PunchItem, PunchItemStatus, PunchItemPriority, PunchListType, SubTrade } from '@/types';
import { punchListTypeOf, SUB_TRADES } from '@/types';
import {
  PhotoMarkupOverlay, ContainedPhotoMarkupOverlay, markupForSource, sourcePhotoIdOf,
} from '@/components/PhotoMarkupOverlay';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor } from '@/utils/workflowPipelines';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { cardSurface, Button, EyebrowLabel } from '@/components/ui';
// Pin items (after the photo), Pin first (before it) and the edit sheet's pin
// controls — founder, 2026-09-18: "pin the location of each item before and
// after taking photos". The decisions are pure (utils/punchPinQueue); every
// write goes through hooks/usePunchPinWriter. Guard: validate-punch-pin-items.
import PlanPinStep from '@/components/punch/PlanPinStep';
import { usePunchPinWriter } from '@/hooks/usePunchPinWriter';
import { punchItemNumbers } from '@/utils/punchExportCore';
import { pinSheetLabel, punchPinFields, sheetAspectRatio, type WalkPin } from '@/utils/punchPlanPin';
// Web ≥ 900 px: the add/edit sheet is a centred 75 / 25 panel — the form, and
// the photo large beside it (founder, 2026-09-22). Guard:
// scripts/validate-w4-punch-web-edit-layout.ts.
import {
  punchEditLayout, punchEditPanelSize, punchPhotoActionBlocked, punchPhotoPatch, punchReplacementUpload,
  PUNCH_EDIT_FORM_FLEX, PUNCH_EDIT_PHOTO_FLEX, type PunchPhotoEdit, type PunchReplacementUpload,
} from '@/utils/punchEditLayout';
import { queuePhotoUpload } from '@/utils/photoUploadQueue';
import { PunchEditPhotoPane, type PunchEditPinThumb } from '@/components/punch/PunchEditPanes';
import PunchPhotoViewer from '@/components/punch/PunchPhotoViewer';
import {
  CLEAR_PIN_PATCH, pinRefOf, pinSeedFor, pinWriteBlockedReason, planPinStats, removePinConfirmCopy, sheetsByIdOf,
} from '@/utils/punchPinQueue';
import { stashPinQueueIds } from '@/utils/pinQueueHandoff';
import { generateUUID } from '@/utils/generateId';
import { getPunchTemplatesByTrade, type PunchTemplate } from '@/constants/punchTemplates';
import { showAlert } from '@/utils/alert';
import { formatCalendarDay, daysUntilCalendarDay, calendarDayOf, parseCalendarDay } from '@/utils/calendarDate';
import { resolvePunchSub, scopePunchForSub, punchIsOnSub } from '@/utils/subPortalSnapshot';
import DatePickerModal from '@/components/DatePickerModal';
import { useAuth } from '@/contexts/AuthContext';
// The subs this user may assign on THIS job: his directory when he owns it,
// the owner's subs on the job when he is a collaborator (#110).
import { useProjectSubcontractors } from '@/hooks/useProjectSubcontractors';
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

/**
 * Who may delete a punch item (#111). The server's delete policy
 * (punch_items_collab_delete) admits the item's CREATOR or the PROJECT OWNER —
 * narrower than update, which any field/editor collaborator passes. A delete
 * outside that matched 0 rows, counted as synced, and the item came back on
 * the next load. So the control says who may delete, instead of pretending.
 * A missing createdByUserId (a row loaded before the creator was mapped) is
 * "not yours" unless he owns the project. Founder decision #111 pending: if
 * collaborators may delete others' items, one migration aligns the policy
 * with update and this gate goes.
 */
function punchDeleteAllowed(item: Pick<PunchItem, 'createdByUserId'>, userId: string | undefined, ownsProject: boolean): boolean {
  if (ownsProject) return true;
  return !!userId && item.createdByUserId === userId;
}
const PUNCH_DELETE_BLOCKED_REASON = 'Only the person who added this item or the project owner can delete it.';

/**
 * A sub column holding a bare TRADE word ("Electrical", "General") that no
 * directory sub is named — written by older walks and templates when no sub
 * was found. It is not an assignment and must not read like one (#20).
 */
function isTradeWordOnly(name: string | undefined, subNames: ReadonlySet<string>): boolean {
  const n = (name ?? '').trim();
  if (!n) return false;
  if (subNames.has(n.toLowerCase())) return false;
  return (SUB_TRADES as readonly string[]).some(t => t.toLowerCase() === n.toLowerCase());
}

/** A stored due date that is not a calendar day (typed "9/25", "Fri"): it is
 *  never tracked as overdue, so it must not print like a real date (#113). */
function dueDateUnreadable(due: string | undefined): boolean {
  const v = (due ?? '').trim();
  return !!v && !parseCalendarDay(v.slice(0, 10));
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
      /** Pinned by the export's verdict (pinRefOf), the same rule as the "On
       *  the plan" count and Pin items. A sheet with no spot, or a deleted
       *  sheet, is NOT on the plan — the chip used to say it was and opened a
       *  sheet with no marker on it (or none at all). */
      onPlan: boolean;
      /** punchDeleteAllowed for this user — the trash says why when false. */
      canDelete: boolean;
      /** The sub column is a bare trade word, not a sub (isTradeWordOnly). */
      subIsTradeWord: boolean;
      /** The item a "ready for review" notification opened (#51). */
      focused: boolean;
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
  /** Tapped the trash on an item he may not delete: says why. */
  onDeleteBlocked: () => void;
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
  const { item, selected, selectMode, photoFailed, variant, onPlan, canDelete, subIsTradeWord, focused } = row;
  const dueUnreadable = dueDateUnreadable(item.dueDate);
  const sc = getStatusConfig(themeColors, item.status);
  const pc = getPriorityConfig(themeColors, item.priority);
  const formal = variant === 'punch';
  const dueIn = daysUntilDue(item);
  const overdue = dueIn !== null && dueIn < 0;
  const moveTo = otherList(variant);
  const locationText = punchLocationText(item.location);
  const rejection = punchRejectionBox(item);
  return (
    <View style={[
      styles.punchCard,
      // Formal items carry a left rule — red once they are late, so a scroll
      // down a 100-item list shows the late ones without reading a word. Crew
      // items drop the border and sit on the quieter ground.
      formal ? styles.punchCardFormal : styles.punchCardCrew,
      formal && overdue && styles.punchCardFormalOverdue,
      selected && styles.punchCardSelected,
      focused && styles.punchCardFocused,
    ]} testID={focused ? 'punch-focused-item' : undefined}>
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
            {/* #56: '' (and the legacy 'Unspecified' walk placeholder) is "no
                room given", worded here at render time — never saved. */}
            {locationText
              ? <Text style={styles.punchLocation}>{locationText}</Text>
              : <Text style={[styles.punchLocation, styles.punchLocationNone]}>{PUNCH_NO_ROOM_TEXT}</Text>}
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
          {onPlan ? (
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
      {item.dueDate && dueUnreadable ? (
        // Typed free text ("Fri", "9/25") — not a date, so not tracked. Said,
        // never printed like a deadline he believes is being watched.
        <View style={[styles.dueChip, styles.dueChipSoon]}>
          <CalendarClock size={12} color={themeColors.warningLabel} strokeWidth={1.75} />
          <Text style={[styles.dueChipText, { color: themeColors.warningLabel }]}>
            Due “{item.dueDate}” — not a date, not tracked. Edit to pick one.
          </Text>
        </View>
      ) : formal && item.dueDate ? (
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
        {item.assignedSub ? (
          subIsTradeWord
            ? <Text style={styles.punchMetaText}>Trade: {item.assignedSub} · no sub assigned</Text>
            : <Text style={styles.punchMetaText}>Sub: {item.assignedSub}</Text>
        ) : null}
        {/* dueDate is declared 'YYYY-MM-DD' but Supabase-synced rows
            carry a full ISO timestamp — openEditForm already slices
            for exactly that reason. This printed the raw field, so one
            item read "Due: 2026-08-30" locally and
            "Due: 2026-08-30T00:00:00.000Z" after a sync.

            CREW: the date stays in the quiet meta line. Late is still SAID —
            hiding it would be its own lie — but in secondary ink, no fill. */}
        {!formal && item.dueDate && !dueUnreadable ? (
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

      {/* What the sub wrote when he marked it fixed from his portal
          (punch_items.sub_note) — his words, labelled as his. */}
      {item.subNote ? (
        <View style={styles.subNoteBox}>
          <MessageSquare size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
          <Text style={styles.subNoteText}>Sub’s note: {item.subNote}</Text>
        </View>
      ) : null}

      {/* Red only while the item is back on the sub (Open / In progress). Once
          he marks it fixed again the old reason is history, shown muted —
          not a live send-back sitting over his new note. */}
      {rejection ? (
        rejection.tone === 'active' ? (
          <View style={styles.rejectionBox}>
            <MessageSquare size={12} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={styles.rejectionText}>{rejection.text}</Text>
          </View>
        ) : (
          <View style={styles.rejectionHistory} testID={`punch-previously-returned-${item.id}`}>
            <MessageSquare size={12} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.rejectionHistoryText}>{rejection.text}</Text>
          </View>
        )
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
            style={[styles.punchDeleteBtn, !canDelete && styles.punchDeleteBtnBlocked]}
            // Blocked, not hidden: the tap says who may delete it.
            onPress={() => (canDelete ? actions.onDelete(item) : actions.onDeleteBlocked())}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canDelete }}
            accessibilityLabel={canDelete ? 'Delete' : 'Delete unavailable'}
            accessibilityHint={canDelete ? undefined : PUNCH_DELETE_BLOCKED_REASON}
            testID={`punch-delete-${item.id}`}
          >
            <Trash2 size={14} color={canDelete ? themeColors.dangerLabel : themeColors.textMuted} strokeWidth={1.75} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

/** The edit sheet's pin step has no walk session. Module-level so it is one array. */
const NO_SESSION_IDS: readonly string[] = [];

export default function PunchListScreen() {
  const router = useRouter();
  // Read the project from params here (not just in Inner) so the gate can
  // ask 'were they invited to THIS project?' before paywalling.
  const { projectId: rawGateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const gateProjectId = rawGateProjectId || undefined;
  const { canAccess, canAccessOwnTier, requiredTierFor } = useProjectAccess(gateProjectId);
  const roleState = useProjectRoleState(gateProjectId);
  const { projects } = useProjects();
  // #127: the same gate as Safety and RFIs. Tools and the web sidebar open
  // this screen with NO project, where useProjectAccess(undefined) can only
  // answer with his own tier — so an invited free-plan foreman got the Business
  // paywall over the job he was invited to. With no project he gets in when he
  // is an accepted collaborator on any cached job (the picker lists only
  // those); with a project he waits for, or retries, the role read instead of
  // being paywalled while it is in flight.
  const invited = useMemo(() => invitedPunchProjects(projects), [projects]);
  const ownTier = canAccessOwnTier('punch_list_closeout');
  if (!canAccess('punch_list_closeout')) {
    const answer = punchGateAnswer({
      projectId: gateProjectId,
      ownTier,
      projectAllowed: false,
      invitedCount: invited.length,
      role: roleState.role,
      isLoading: roleState.isLoading,
      isError: roleState.isError,
      isPaused: roleState.isPaused,
      reason: roleState.reason,
    });
    if (answer === 'allow') return <PunchListScreenInner ownTier={ownTier} />;
    if (answer === 'paywall') {
      return (
        <Paywall
          visible={true}
          feature="Punch List & Closeout"
          // Derived from featureTiers.ts, never typed: the price on the wall is
          // the price on the door.
          requiredTier={requiredTierFor('punch_list_closeout')}
          onClose={() => router.back()}
        />
      );
    }
    return <PunchGateView state={answer} reason={roleState.reason} onRetry={() => { void roleState.refetch(); }} />;
  }
  return <PunchListScreenInner ownTier={ownTier} />;
}

/** The access wall's non-paywall answers (#127): checking, couldn't check,
 *  offline with no role on this phone, not on this job. Never a spinner that
 *  cannot end, never a paywall over a job he was invited to. */
function PunchGateView({ state, reason, onRetry }: {
  state: 'loading' | 'error' | 'paused' | 'missing';
  reason?: string;
  onRetry: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const copy = state === 'error'
    ? { title: 'Could not check your access to this job', body: 'MAGE could not load who is on this project, so it cannot tell whether you were invited to its punch list. Check your connection and try again.' }
    : state === 'paused'
      ? { title: 'Waiting for signal', body: reason ?? 'This job is not saved on this phone yet. It opens once there is signal.' }
      : { title: 'Not on this job', body: 'You don\'t have access to this project\'s punch list. Ask the project owner to invite you.' };
  return (
    <View style={[styles.gateWrap, { backgroundColor: themeColors.bg }]} testID={`punch-gate-${state}`}>
      <Stack.Screen options={{ title: 'Punch List' }} />
      {state === 'loading' ? (
        <>
          <ActivityIndicator color={themeColors.accent} />
          <Text style={styles.gateText}>Checking your access to this job…</Text>
        </>
      ) : (
        <>
          <Text style={styles.gateTitle}>{copy.title}</Text>
          <Text style={styles.gateText}>{copy.body}</Text>
          {state === 'missing' ? null : (
            <Button label="Try again" variant="secondary" onPress={onRetry} testID="punch-gate-retry" />
          )}
        </>
      )}
    </View>
  );
}

function PunchListScreenInner({ ownTier }: { ownTier: boolean }) {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { projectId: paramProjectId, prefillPhotoUri, prefillPhotoId, itemId: focusItemId } = useLocalSearchParams<{
    projectId: string;
    prefillPhotoUri?: string;
    prefillPhotoId?: string;
    /** #51/#54: the item a "ready for review" notification is about. */
    itemId?: string;
  }>();
  const queryClient = useQueryClient();
  const { projects, getProject, getPunchItemsForProject, addPunchItem, addPunchItems, updatePunchItem, updatePunchItems, deletePunchItem, deletePunchItems, updateProject, subcontractors, projectPhotos, getPlanSheetsForProject, drawingPins, punchItemsLoaded, planSheetsLoaded } = useProjects();
  const { user } = useAuth();

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const pickableProjects = useMemo(() => (ownTier ? projects : invitedPunchProjects(projects)), [ownTier, projects]);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  // The sub chips (edit sheet, bulk assign). On his own job: his directory. On
  // someone else's: the OWNER's subs on this job — never his own directory,
  // whose ids no GC portal will ever match (#110).
  const projectSubs = useProjectSubcontractors(projectId || undefined);
  const pickerSubs = projectSubs.subs;
  const ownsThisProject = projectSubs.isOwner;
  const pickerSubNames = useMemo(
    () => new Set(pickerSubs.map(s => (s.companyName ?? '').trim().toLowerCase())),
    [pickerSubs],
  );
  const canDeleteItem = useCallback(
    (item: PunchItem) => punchDeleteAllowed(item, user?.id, ownsThisProject),
    [user?.id, ownsThisProject],
  );
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  /** Both lists. Closeout ("is every item done?") and selection resolution
   *  read this — a crew touch-up left open is still work left on the job. */
  // The legacy 'Unspecified' placeholder punch-walk used to SAVE (#56) is read
  // here as what it always meant — no room — so it joins the one unplaced
  // group, never shows up as a room chip, and an edit saves '' over it. Items
  // with a real room keep their identity (no copy).
  const allItems = useMemo(
    () => getPunchItemsForProject(projectId ?? '').map(i => (
      i.location && punchLocationText(i.location) === null ? { ...i, location: '' } : i
    )),
    [projectId, getPunchItemsForProject],
  );

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
  /** The subcontractor record behind `assignedSub`, kept in step with it: set
   *  when a sub chip is tapped, cleared when the name is typed. The sheet used
   *  to write only the name, so reassigning an item left the old sub's id on
   *  it — and that sub's portal (utils/subPortalSnapshot) kept the item. */
  const [formSubId, setFormSubId] = useState<string | undefined>(undefined);
  const [dueDate, setDueDate] = useState('');
  const [showDuePicker, setShowDuePicker] = useState(false);
  /** "Other…" — a sub name that is not one of the chips (typed once). */
  const [subOther, setSubOther] = useState(false);
  const [priority, setPriority] = useState<PunchItemPriority>('medium');
  /** The add/edit sheet's own list choice. Seeded from the list showing (new)
   *  or the item (edit); he can flip it explicitly in the sheet. */
  const [formListType, setFormListType] = useState<PunchListType>('punch');
  const [linkedTaskId, setLinkedTaskId] = useState<string>('');
  // Optional photo URI to attach when creating a new item — comes from
  // the photo annotator's "Add to Punch List" flow. Surfaces in the
  // form as a thumbnail badge so the GC sees what they're attaching.
  const [attachedPhotoUri, setAttachedPhotoUri] = useState<string | undefined>(undefined);
  // The gallery photo that URI was copied from. The URI alone only finds the
  // markup on the device that took the photo: once the item syncs, its photo
  // comes back to every other device as a signed URL for the `punch-<id>`
  // upload, which never matches the source photo. The id is what lets the
  // office, web and the sub still see the circle (audit #12, review 2).
  const [attachedSourcePhotoId, setAttachedSourcePhotoId] = useState<string | undefined>(undefined);
  // ── Where it is on the plan (the sheet's "On the plan" block) ─────────────
  // A NEW item carries its pin here until Add Item; an existing item's pin is
  // written the moment he places or removes it (the StatusPipeline precedent
  // in the same sheet), so the sheet's X can never lose it. "· saved" in the
  // row says so — a toast would render UNDER this Modal on iOS.
  const [formPin, setFormPin] = useState<WalkPin | null>(null);
  const [formPinOpen, setFormPinOpen] = useState(false);
  const [pinSavedInSheet, setPinSavedInSheet] = useState(false);
  // ── The web panel's photo pane ────────────────────────────────────────────
  // An EXISTING item's photo change is held here and written on Update (it is
  // a field of the form, like the description — Cancel throws it away). A new
  // item's photo is `attachedPhotoUri`, as it always was.
  const [photoEdit, setPhotoEdit] = useState<PunchPhotoEdit>({ kind: 'keep' });
  const [paneViewerOpen, setPaneViewerOpen] = useState(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const editLayout = punchEditLayout(windowWidth, Platform.OS);

  // Photo walk — the burst-capture path. `walkShots` is a staging area, not the
  // punch list: nothing here exists as an item until it has a description.
  const [walkShots, setWalkShots] = useState<WalkShot[]>([]);
  const [showWalk, setShowWalk] = useState(false);

  // When arriving from photo-annotator with a prefill, open the new-item
  // form auto-attached to that photo. Only fires once per mount.
  useEffect(() => {
    if (prefillPhotoUri || prefillPhotoId) {
      setAttachedPhotoUri(prefillPhotoUri);
      setAttachedSourcePhotoId(prefillPhotoId || undefined);
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The photo row the prefill points at. `prefillPhotoId` used to be a truthy
  // check and nothing else, so everything the photo already knew was thrown
  // away here: the room it was taken in, the task it belongs to, and the markup
  // the GC drew on it. A sub then got a location-less item with an unmarked
  // photo and could not tell which scratch he was being back-charged for
  // (audit 2026-09-17 #12).
  const prefillPhoto = useMemo(
    () => (prefillPhotoId ? (projectPhotos ?? []).find(p => p.id === prefillPhotoId) : undefined),
    [prefillPhotoId, projectPhotos],
  );
  // Applied when the photo RESOLVES, not on mount: the photo cache can hydrate
  // a beat after this screen opens, and a once-on-mount read would silently
  // find nothing. Latched so it fills the form exactly once and can never
  // overwrite something he has since typed.
  //
  // `editingItem` is part of that guard, not decoration: the photo can resolve
  // in the window where he has already opened an EXISTING item to edit, and an
  // existing item with no room and no linked task leaves both fields '' —
  // falsy — so an unrelated photo's room would be written into that item and
  // saved with it.
  const prefillPulled = useRef(false);
  useEffect(() => {
    if (!prefillPhoto || editingItem || prefillPulled.current) return;
    prefillPulled.current = true;
    setAttachedPhotoUri(prev => prev ?? prefillPhoto.uri);
    setAttachedSourcePhotoId(prev => prev ?? prefillPhoto.id);
    setLocation(prev => (prev.trim() ? prev : prefillPhoto.location ?? ''));
    setLinkedTaskId(prev => prev || (prefillPhoto.linkedTaskId ?? ''));
  }, [prefillPhoto, editingItem]);
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
        // Unassigned, never the trade word: "Sub: Electrical" read as an
        // assignment on the list, the filter and the export (#20).
        assignedSub: '',
        dueDate: '',
        priority: item.priority,
        status: 'open',
        ...(user?.id ? { createdByUserId: user.id } : {}),
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
  }, [projectId, addPunchItem, activeList, user?.id]);
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
    setDescription(''); setLocation(''); setAssignedSub(''); setFormSubId(undefined); setSubOther(false);
    setDueDate(''); setPriority('medium'); setEditingItem(null);
    setLinkedTaskId('');
    // A new item lands on the list he is looking at.
    setFormListType(activeList);
    // Clear any attached photo so a cancelled form doesn't silently carry
    // it into the next new item.
    setAttachedPhotoUri(undefined);
    setAttachedSourcePhotoId(undefined);
    setFormPin(null);
    setPinSavedInSheet(false);
    setPhotoEdit({ kind: 'keep' });
    setPaneViewerOpen(false);
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
    // Seed the id from the record the NAME points at: an id left behind by an
    // older reassignment (the name says Rivera, the id says ABC) is dropped on
    // this save instead of being carried forward.
    const seededSub = resolvePunchSub(item.assignedSub ?? '', [item.assignedSubId], pickerSubs);
    // A collaborator whose list cannot see the item's sub (the owner's list is
    // still loading, failed, or the sub is not on this job) cannot tell a stale
    // id from a good one — so an untouched save keeps the id the item already
    // has rather than wiping the GC's assignment. Only a list that CAN see the
    // id may call it stale.
    const cannotJudgeId = !ownsThisProject && !!item.assignedSubId && !pickerSubs.some(s => s.id === item.assignedSubId);
    setFormSubId(seededSub?.id ?? (cannotJudgeId ? item.assignedSubId : undefined));
    // A name that is not one of the chips opens in the "Other…" box, so he can
    // see and clear it.
    setSubOther(!!(item.assignedSub ?? '').trim() && !seededSub);
    // The field is declared YYYY-MM-DD; Supabase-synced items can carry a full
    // ISO timestamp. Slice to the form's own format (same as permits) rather
    // than seeding the input with a value it doesn't accept.
    setDueDate((item.dueDate ?? '').slice(0, 10));
    setPriority(item.priority);
    setFormListType(punchListTypeOf(item));
    setLinkedTaskId(item.linkedTaskId ?? '');
    // The phone sheet has no photo control for an existing item — only a
    // preview for the annotator's "Add to Punch List" prefill. Clearing avoids
    // showing a previous prefill's photo on top of someone else's item. The web
    // panel edits the item's OWN photo through `photoEdit`, which starts at
    // 'keep' so an untouched Update writes the photo exactly as before.
    setAttachedPhotoUri(undefined);
    setAttachedSourcePhotoId(undefined);
    setFormPin(null);
    setPinSavedInSheet(false);
    setPhotoEdit({ kind: 'keep' });
    setPaneViewerOpen(false);
    setShowForm(true);
  }, [pickerSubs, ownsThisProject]);

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
      // A bare trade word is not a sub (#20) — not offered as one to filter by.
      if (s && !isTradeWordOnly(s, pickerSubNames)) set.add(s);
    }
    return Array.from(set).sort();
  }, [items, pickerSubNames]);

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
    if (filterLocationKey === UNPLACED_LOCATION_GROUP) return PUNCH_NO_ROOM_TEXT;
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

  /** Set once a notification's item has picked the list (see the focus block). */
  const focusListLockRef = useRef(false);

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
        // A notification's item already chose the list it is on (#51) — the
        // remembered list must not land late and hide it again.
        if (!focusListLockRef.current) setActiveList(stored.list);
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

  // ── Opened from a "ready for review" notification (#51 / #54) ─────────────
  // The list in memory was read at launch. A tap on the push (or the inbox
  // row) used to land on it as-is: the item still said Open with Start, no
  // sub's note, one row among a hundred on whatever list he last used. So:
  // re-read the list first and SAY it is refreshing until the read settles,
  // then switch to the item's own list, filter to its status, scroll to it
  // and mark it. Offline, the read cannot settle — that is said too, and the
  // focus is applied to the list on the phone, then re-aimed once the read
  // comes back (punchFocusStep).
  //
  // The status is taken from the query CACHE when the read settles, never
  // from `allItems`: the provider copies the fresh rows into its state one
  // render later, so `allItems` at that moment is still the launch copy — the
  // old code filtered to Open and the item, Ready for Review a render later,
  // vanished from the filter chosen to show it (punchItemFromQueryCache).
  //
  // Only the signed-in user's query is read, refetched and pause-checked
  // (punchItemsQueryKey): a launch-time ['punchItems', null] entry lingers in
  // the cache un-refetched and used to answer first. The key is in the deps,
  // so when auth resolves after a cold-start tap the whole focus runs again
  // against the real account's query.
  //
  // KNOWN LIMIT (tied to #126's native build): on iPhone react-query never
  // pauses (its onlineManager is not wired to NetInfo), and the provider's
  // loader answers a failed SELECT with the phone's copy — so with no signal
  // the read "settles" and 'No signal' only ever shows on web. The query data
  // does not say which source it came from; only ProjectContext knows.
  const punchKey = useMemo(() => punchItemsQueryKey(user?.id), [user?.id]);
  const [refreshState, setRefreshState] = useState<'idle' | 'refreshing' | 'offline' | 'done'>(focusItemId ? 'refreshing' : 'idle');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusMissing, setFocusMissing] = useState(false);
  const [freshFocus, setFreshFocus] = useState<{ known: boolean; item?: PunchItem } | null>(null);
  /** Bumped by the banner's Refresh / Try again: runs the whole focus again. */
  const [focusNonce, setFocusNonce] = useState(0);
  const focusAppliedRef = useRef<PunchFocusApplied>(null);
  const focusScrolledRef = useRef(false);
  useEffect(() => {
    if (!focusItemId) return;
    let live = true;
    focusAppliedRef.current = null;
    focusScrolledRef.current = false;
    setFocusMissing(false);
    setFreshFocus(null);
    setRefreshState('refreshing');
    const pausedNow = () => queryClient.getQueryCache().findAll({ queryKey: punchKey, exact: true })
      .some(q => q.state.fetchStatus === 'paused');
    const unsub = queryClient.getQueryCache().subscribe(() => {
      if (live && pausedNow()) setRefreshState(prev => (prev === 'refreshing' ? 'offline' : prev));
    });
    void queryClient.invalidateQueries({ queryKey: punchKey, exact: true })
      .catch(() => { /* the loader already falls back to the phone's copy */ })
      .finally(() => {
        if (!live) return;
        setFreshFocus(punchItemFromQueryCache(queryClient.getQueryData(punchKey), focusItemId, projectId ?? ''));
        setRefreshState('done');
      });
    return () => { live = false; unsub(); };
  }, [focusItemId, queryClient, projectId, focusNonce, punchKey]);

  useEffect(() => {
    if (!focusItemId) return;
    const step = punchFocusStep({
      phase: refreshState,
      loaded: punchItemsLoaded,
      applied: focusAppliedRef.current,
      view: { list: activeList, status: filterStatus },
      fresh: freshFocus,
      phoneItem: allItems.find(i => i.id === focusItemId),
    });
    if (step.kind === 'none') return;
    if (step.kind === 'settle') {
      const prev = focusAppliedRef.current;
      if (prev) focusAppliedRef.current = { ...prev, from: 'fresh' };
      return;
    }
    if (step.kind === 'missing') {
      focusAppliedRef.current = { from: step.from, missing: true };
      setFocusedId(null);
      setFocusMissing(true);
      return;
    }
    focusAppliedRef.current = { from: step.from, list: step.list, status: step.status };
    focusListLockRef.current = true;
    setFocusMissing(false);
    setSelectedIds({});
    setSelectMode(false);
    setActiveList(step.list);
    // Only its status; any other filter could hide the very item he tapped.
    setFilterStatus(step.status);
    setFilterSub('');
    setFilterPriority('all');
    setFilterLocationKey('');
    setCollapsed({});
    if (focusedId !== step.itemId) focusScrolledRef.current = false;
    setFocusedId(step.itemId);
  }, [focusItemId, refreshState, punchItemsLoaded, allItems, freshFocus, activeList, filterStatus, focusedId]);
  const retryFocus = useCallback(() => setFocusNonce(n => n + 1), []);

  // Pull to refresh — also his way back when the tap-refresh found nothing.
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const onPullRefresh = useCallback(() => {
    setPullRefreshing(true);
    void queryClient.invalidateQueries({ queryKey: ['punchItems'] })
      .catch(() => { /* the loader already falls back to the phone's copy */ })
      .finally(() => setPullRefreshing(false));
  }, [queryClient]);

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

  const planSheets = useMemo(() => getPlanSheetsForProject(projectId ?? ''), [getPlanSheetsForProject, projectId]);
  const sheetsById = useMemo(() => sheetsByIdOf(planSheets), [planSheets]);

  const rows = useMemo<PunchRowData[]>(() => {
    const out: PunchRowData[] = [];
    const itemRow = (item: PunchItem): PunchRowData => ({
      kind: 'item',
      key: item.id,
      item,
      onPlan: pinRefOf(item, sheetsById).state === 'pinned',
      selected: !!selectedIds[item.id],
      selectMode,
      photoFailed: !!(item.photoUri && failedPhotoUris[item.photoUri]),
      variant: activeList,
      canDelete: canDeleteItem(item),
      subIsTradeWord: isTradeWordOnly(item.assignedSub, pickerSubNames),
      focused: item.id === focusedId,
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
        // One wording for "no room" on this screen (#56): the row, this
        // header, the chip and the filter summary all say PUNCH_NO_ROOM_TEXT.
        // (Legacy 'Unspecified' items were folded into this group above.)
        label: section.isUnplaced ? PUNCH_NO_ROOM_TEXT : section.label,
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
  }, [grouped, filteredItems, sections, collapsed, selectedIds, selectMode, failedPhotoUris, onPlanKeys, activeList, sheetsById, canDeleteItem, pickerSubNames, focusedId]);

  // Scroll the notification's item into view once its row exists (#51).
  const listRef = useRef<FlatList<PunchRowData>>(null);
  useEffect(() => {
    if (!focusedId || focusScrolledRef.current) return;
    const index = rows.findIndex(r => r.kind === 'item' && r.key === focusedId);
    if (index < 0) return;
    focusScrolledRef.current = true;
    const t = setTimeout(() => {
      try { listRef.current?.scrollToIndex({ index, viewPosition: 0.2, animated: true }); } catch { /* onScrollToIndexFailed retries */ }
    }, 250);
    return () => clearTimeout(t);
  }, [focusedId, rows]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    // Rows past the first render window have no measured position yet: jump
    // near it by the average, then aim again once those rows have mounted.
    listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
    setTimeout(() => {
      try { listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.2, animated: true }); } catch { /* best effort */ }
    }, 300);
  }, []);

  const handleSave = useCallback(() => {
    const desc = description.trim();
    if (!desc) {
      showAlert('Missing Description', 'Please describe the punch item.');
      return;
    }
    // The picker stores a calendar day; this refuses anything else (an old
    // free-text value he left in place), with the reason — a date that is not
    // a date would never go overdue (#113).
    if (dueDate.trim() && !parseCalendarDay(dueDate.trim().slice(0, 10))) {
      showAlert('Due date not understood', `“${dueDate.trim()}” is not a date, so it would never be tracked as overdue. Pick a date, or clear it.`);
      return;
    }
    const linkedTaskName = linkedTask?.title;
    const commit = () => {
      if (editingItem) {
        // A replaced photo uploads under its OWN new key, queued here on
        // Update (Cancel never uploads). Under the item's `punch-<id>` key the
        // upload would collide with the old photo's object, be dropped as
        // "already uploaded", and leave every other device on the old picture
        // — see punchReplacementUpload.
        let replacementUpload: PunchReplacementUpload | null = null;
        if (photoEdit.kind === 'replace') {
          replacementUpload = punchReplacementUpload({
            userId: user?.id, projectId: editingItem.projectId, itemId: editingItem.id,
            uri: photoEdit.uri, mimeType: photoEdit.mimeType, nowMs: Date.now(),
          });
          if (replacementUpload && user?.id) {
            void queuePhotoUpload({
              photoId: replacementUpload.photoId, userId: user.id, projectId: editingItem.projectId,
              localUri: photoEdit.uri, storagePath: replacementUpload.storagePath, contentType: replacementUpload.contentType,
            });
          }
        }
        updatePunchItem(editingItem.id, {
          description: desc, location: location.trim(), assignedSub: assignedSub.trim(),
          // Always sent, so the name and the id change together — undefined
          // CLEARS a stale id (the reassigned-to name has no sub record).
          assignedSubId: assignedSub.trim() ? formSubId : undefined,
          dueDate, priority,
          listType: formListType,
          linkedTaskId: linkedTaskId || undefined,
          linkedTaskName: linkedTaskName || undefined,
          // Only the web panel can change it; 'keep' adds no keys at all.
          ...punchPhotoPatch(photoEdit, replacementUpload),
        });
      } else {
        const item: PunchItem = {
          id: createId('punch'), projectId: projectId ?? '', description: desc,
          location: location.trim(), assignedSub: assignedSub.trim(),
          ...(assignedSub.trim() && formSubId ? { assignedSubId: formSubId } : {}),
          dueDate,
          priority, status: 'open',
          // Who raised it — the delete check (#111) reads this.
          ...(user?.id ? { createdByUserId: user.id } : {}),
          listType: formListType,
          linkedTaskId: linkedTaskId || undefined,
          linkedTaskName: linkedTaskName || undefined,
          photoUri: attachedPhotoUri,
          // PunchItem.sourcePhotoId (punch_items.source_photo_id) is how every
          // other device finds the markup. Only kept while the photo it points
          // at is still the one attached.
          ...(attachedPhotoUri && attachedSourcePhotoId ? { sourcePhotoId: attachedSourcePhotoId } : {}),
          // The spot he picked in the sheet's pin step; nothing at all when he
          // didn't, so an unpinned item saves exactly as before.
          ...punchPinFields(formPin ?? undefined),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        addPunchItem(item);
      }
      setShowForm(false);
      setAttachedPhotoUri(undefined);
      setAttachedSourcePhotoId(undefined);
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
  }, [description, location, assignedSub, formSubId, dueDate, priority, formListType, activeList, clientSeesPunch, linkedTaskId, linkedTask, editingItem, projectId, addPunchItem, updatePunchItem, resetForm, attachedPhotoUri, attachedSourcePhotoId, formPin, user?.id, photoEdit]);

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

  // `thenPin`: "Add N and pin them" — file, then open Pin items on exactly
  // this batch (the photo walk never pins; this is the step after it).
  const fileWalkShots = useCallback((opts?: { thenPin?: boolean }) => {
    if (describedWalkShots.length === 0) return;
    if (filingWalkRef.current) return;
    filingWalkRef.current = true;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    // addPunchItems, not a loop of addPunchItem: the batch path prepends all N
    // rows in ONE setState and ONE AsyncStorage write. Looping the single-add
    // serialises the entire punch list once per photo — forty writes of a
    // growing array on the phone that just finished a forty-frame walk.
    //
    // createdAt is staggered 1 ms per shot IN CAPTURE ORDER (walkShots is
    // appended as he shoots and the filter keeps that order). One shared stamp
    // for the whole batch left the punch-list export — which numbers items by
    // createdAt — ordering a walk by random UUID instead of by the route he
    // walked. Forty shots span 40 ms, so nothing else can read it as a
    // different moment.
    const filedItems: PunchItem[] = describedWalkShots.map((shot, i) => ({
      id: createId('punch'),
      projectId: projectId ?? '',
      description: shot.description.trim(),
      location: shot.location.trim(),
      assignedSub: '',
      dueDate: '',
      priority: 'medium' as const,
      status: 'open' as const,
      ...(user?.id ? { createdByUserId: user.id } : {}),
      // The walk files onto the list that is showing, like every other add.
      listType: activeList,
      photoUri: shot.uri,
      createdAt: new Date(nowMs + i).toISOString(),
      updatedAt: now,
    }));
    addPunchItems(filedItems);
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
    if (opts?.thenPin) {
      // The ids ride in memory, not the URL (up to 40 of them); a web reload
      // loses the batch and Pin items falls back to every unpinned item.
      const batch = stashPinQueueIds(filedItems.map(i => i.id));
      setShowWalk(false);
      // iOS: let the walk sheet finish sliding away before the push.
      setTimeout(() => router.push({ pathname: '/punch-pin' as never, params: { projectId: projectId ?? '', list: activeList, batch } as never }), Platform.OS === 'ios' ? 400 : 0);
    }
  }, [describedWalkShots, walkShots, addPunchItems, projectId, activeList, router, user?.id]);

  // Released only once the filed shots have actually LEFT `walkShots`. Clearing
  // it at the end of fileWalkShots would make the latch useless — the second
  // tap arrives in a later task, by which time the ref is false again and the
  // closure it fires may still be the pre-commit one.
  useEffect(() => { filingWalkRef.current = false; }, [walkShots]);

  const handleStatusChange = useCallback((item: PunchItem, newStatus: PunchItemStatus) => {
    // punchStatusPatch: the status named explicitly, closedAt on a close, and
    // rejectedAt + the note on any move back out of Review (CONTRACT 12 — the
    // server neutralises an un-review that carries no later rejected_at).
    updatePunchItem(item.id, punchStatusPatch(item, newStatus, new Date().toISOString()));
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
    // A real reject (CONTRACT 12): rejectedAt is stamped now, so the server
    // tells this send-back from a stale queued write even when the note text
    // is the same as last round's — which the old note-only write could not.
    const item = allItems.find(i => i.id === itemId);
    updatePunchItem(itemId, punchStatusPatch({ status: item?.status ?? 'ready_for_review', rejectedAt: item?.rejectedAt }, 'open', new Date().toISOString(), rejectionNote));
    setShowRejectModal(null);
    setRejectionNote('');
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [rejectionNote, updatePunchItem, allItems]);

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
      // The id travels WITH the name, always: a bulk assign to a typed trade
      // name (no sub record) must clear the previous sub's id, or that sub's
      // portal keeps these items and the portal shortcut still opens his.
      { assignedSub: companyName, assignedSubId: subId },
      `assigned to ${companyName}`,
    );
  }, [selectedIdList, runBulkUpdate]);

  const bulkSetStatus = useCallback((next: PunchItemStatus) => {
    if (selectedIdList.length === 0) return;
    setShowBulkStatusPicker(false);
    const cfg = getStatusConfig(themeColors, next);
    // Stamped once for the whole batch: these were closed in one gesture, and
    // thirty closedAt values a millisecond apart is noise in the closeout.
    const nowIso = new Date().toISOString();
    // Items waiting in Review that this move sends back to work are REJECTS
    // (CONTRACT 12): they carry rejectedAt + a note, or the server keeps them
    // in Review. The rest get the plain move. Two batch writes, one gesture.
    const rejectItems = selectedItems.filter(i => isPunchReject(i.status, next));
    const rejects = rejectItems.map(i => i.id);
    const rest = selectedIdList.filter(id => !rejects.includes(id));
    const run = () => {
      // One stamp later than every selected item's previous reject, so a phone
      // clock behind an earlier reject's stamp cannot neutralise this one.
      if (rejects.length > 0) updatePunchItems(rejects, punchStatusPatch({ status: 'ready_for_review', rejectedAt: latestRejectedAt(rejectItems) }, next, nowIso));
      if (rest.length > 0) updatePunchItems(rest, punchStatusPatch({ status: 'open' }, next, nowIso));
      finishBulk(selectedIdList.length, `moved to ${cfg.label}`);
    };
    if (rejects.length === 0) { run(); return; }
    // Sending a sub's marked-fixed work back is a verdict on it — said first,
    // with the count, and that the sub sees it with no reason given.
    const n = rejects.length;
    showAlert(
      `Send ${n} item${n === 1 ? '' : 's'} back to the sub?`,
      `${n} of these ${n === 1 ? 'is' : 'are'} waiting for your review. Moving ${n === 1 ? 'it' : 'them'} to ${cfg.label} sends ${n === 1 ? 'it' : 'them'} back as not done, with no reason given. To say why, use Reject on the item instead.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Send back', style: 'destructive', onPress: run },
      ],
    );
  }, [selectedIdList, selectedItems, themeColors, updatePunchItems, finishBulk]);

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
    // Only the rows he may delete (#111). The rest would "delete" on screen,
    // match 0 rows on the server and come back on the next load — so they are
    // left out, and the dialog says how many and why.
    const ids = selectedItems.filter(canDeleteItem).map(i => i.id);
    const kept = selectedIdList.length - ids.length;
    const n = ids.length;
    if (n === 0) {
      showAlert('Can’t delete these items', PUNCH_DELETE_BLOCKED_REASON);
      return;
    }
    const keptLine = kept > 0
      ? ` ${kept} other selected item${kept === 1 ? ' was' : 's were'} added by someone else and will stay: ${PUNCH_DELETE_BLOCKED_REASON.charAt(0).toLowerCase()}${PUNCH_DELETE_BLOCKED_REASON.slice(1)}`
      : '';
    // The one irreversible verb on this bar, so it says the number out loud.
    showAlert(
      `Delete ${n} punch item${n === 1 ? '' : 's'}?`,
      `They are removed from this project and from the closeout packet. This cannot be undone.${keptLine}`,
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
  }, [selectedIdList, selectedItems, canDeleteItem, deletePunchItems, finishBulk]);

  // ── Handing a sub their list ─────────────────────────────────────────────
  // The sub portal already exists and already scopes punch items to one sub
  // (utils/subPortalSnapshot.ts). Nothing on this screen mentioned it, so the
  // one built-in way to hand a sub his share was invisible at the exact moment
  // he wanted it. Offered when the view is about EXACTLY one sub — the list is
  // filtered to them, or every selected item is theirs.
  const portalTarget = useMemo(() => {
    // The sub portal is the owner's (his subs, his link). A collaborator's own
    // directory would resolve the GC's sub name to a stranger's record.
    if (!ownsThisProject) return null;
    const pool = selectedCount > 0 ? selectedItems : (filterSub ? filteredItems : []);
    if (pool.length === 0) return null;
    const names = new Set<string>();
    const ids: (string | undefined)[] = [];
    for (const i of pool) {
      const n = (i.assignedSub ?? '').trim();
      if (!n) return null;                 // one unassigned item means "not one sub"
      names.add(n.toLowerCase());
      ids.push(i.assignedSubId);
    }
    if (names.size !== 1) return null;
    const name = (pool[0].assignedSub ?? '').trim();
    // The NAME decides which sub this is — it is what every row shows. An id
    // only breaks a tie between two records sharing that name; an id whose
    // sub has a different name is a leftover from a reassignment and would
    // open the wrong sub's portal setup (one stale ABC id among 20 Rivera
    // items used to route "Hand Rivera Drywall their 20 items" to ABC).
    const sub = resolvePunchSub(name, ids, subcontractors);
    // The number the sub will SEE as still on him: counted by the portal's own
    // scoping function (scopePunchForSub — the same rows, same rule, the server
    // read applies it in SQL), not the pool, which counted closed and
    // ready-for-review items too (#109). No sub record: the pool's open items.
    const count = sub
      ? scopePunchForSub(allItems, sub, projectId ?? '').filter(punchIsOnSub).length
      : pool.filter(punchIsOnSub).length;
    return { name, sub, count };
  }, [ownsThisProject, selectedCount, selectedItems, filterSub, filteredItems, subcontractors, allItems, projectId]);

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
    onDeleteBlocked: () => showAlert('Can’t delete this item', PUNCH_DELETE_BLOCKED_REASON),
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

  // ── Export (PDF / spreadsheet) ─────────────────────────────────────────
  // In the header so it is reachable from either list, even an empty one.
  // headerRight and the options object are memoised: an inline
  // `options={{ headerRight: () => … }}` resets the options every render — the
  // "Maximum update depth exceeded" loop project-detail hit (Sentry RN-1).
  // ── On the plan: counts, numbers, and the one pin write path ─────────────
  // (planSheets / sheetsById are declared above the row builder, which needs them.)
  // "Pinned" is judged against the sheet list, so a count before the sheets
  // land says "0 of 63" about items that are pinned (a second device, a cold
  // start). No number until both are in.
  const pinCountsReady = punchItemsLoaded && planSheetsLoaded;
  // For the list that is showing — "0 of 63 pinned" is about these 63.
  const pinStats = useMemo(() => planPinStats(items, sheetsById), [items, sheetsById]);
  // The export's numbers (whole project list) — the edit sheet's "#14".
  const itemNumbers = useMemo(() => punchItemNumbers(allItems), [allItems]);
  const { writePin, removalFor, role: pinRole } = usePunchPinWriter(projectId ?? '');
  const pinBlocked = pinWriteBlockedReason(pinRole);
  const editingPinSeed = useMemo(
    () => (editingItem ? pinSeedFor(editingItem, sheetsById, drawingPins) : { initialPin: formPin, initialSheetId: null }),
    [editingItem, sheetsById, drawingPins, formPin],
  );
  const editingHideIds = useMemo(() => (editingItem ? [editingItem.id] : []), [editingItem]);
  const openFormPinStep = useCallback(() => {
    if (pinBlocked) return;
    Keyboard.dismiss();
    setFormPinOpen(true);
  }, [pinBlocked]);
  const handleFormPinNext = useCallback((pin: WalkPin) => {
    setFormPinOpen(false);
    if (editingItem) {
      const w = writePin(editingItem, pin);
      if (w) {
        setEditingItem({ ...editingItem, ...punchPinFields(pin) });
        setPinSavedInSheet(true);
      }
    } else {
      setFormPin(pin);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [editingItem, writePin]);
  const handleFormPinRemove = useCallback(() => {
    if (!editingItem) { setFormPin(null); return; }
    const item = editingItem;
    const c = removePinConfirmCopy(removalFor(item), itemNumbers.get(item.id) ?? 0);
    showAlert(c.title, c.body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: c.confirmLabel,
        style: 'destructive',
        onPress: () => {
          writePin(item, null);
          setEditingItem({ ...item, ...CLEAR_PIN_PATCH });
          setPinSavedInSheet(true);
        },
      },
    ]);
  }, [editingItem, removalFor, itemNumbers, writePin]);

  // ── The web panel's photo pane (split layout only) ─────────────────────────
  // What is in front of him: the photo he just chose, nothing (removed in this
  // sheet), or the saved one. For a new item, the attached / prefilled photo.
  const paneShowingSaved = !!editingItem && photoEdit.kind === 'keep';
  const panePhotoUri = editingItem
    ? (photoEdit.kind === 'replace' ? photoEdit.uri : photoEdit.kind === 'remove' ? undefined : editingItem.photoUri)
    : attachedPhotoUri;
  const paneMarkup = useMemo(() => {
    if (editingItem) {
      // A photo chosen here is a fresh file: no markup belongs to it.
      return photoEdit.kind === 'keep' ? markupForSource(projectPhotos, sourcePhotoIdOf(editingItem), editingItem.photoUri) : [];
    }
    return markupForSource(projectPhotos, attachedSourcePhotoId, attachedPhotoUri);
  }, [editingItem, photoEdit.kind, projectPhotos, attachedSourcePhotoId, attachedPhotoUri]);
  const paneBlocked = (action: 'add' | 'replace' | 'remove') => punchPhotoActionBlocked({
    action,
    editing: !!editingItem,
    linkedSourcePhotoId: editingItem?.sourcePhotoId,
    showingSavedPhoto: paneShowingSaved,
  });
  const attachNewItemPhoto = useCallback((uri: string | undefined, sourcePhotoId: string | undefined) => {
    setAttachedPhotoUri(uri);
    setAttachedSourcePhotoId(sourcePhotoId);
  }, []);
  const pickPanePhoto = useCallback(async () => {
    // On web this is the browser's file chooser (expo-image-picker's web
    // build); the result is a blob: URL (session-scoped: it dies with the tab,
    // so the upload must drain before he closes it — the queue tries within
    // seconds while online). A new item's photo is staged by ProjectContext's
    // stagePunchPhoto; a replacement is queued by handleSave under a new key.
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
    } catch {
      showAlert('Couldn’t open your files', 'The browser didn’t open the file chooser. Try again.');
      return;
    }
    const asset = !result.canceled ? result.assets?.[0] : undefined;
    const uri = asset?.uri;
    if (!uri) return;
    if (editingItem) {
      setPhotoEdit({ kind: 'replace', uri, mimeType: asset?.mimeType ?? null });
    } else {
      // The photo and its gallery link move together: a chosen file is not
      // the gallery photo the prefill came from, so that photo's markup must
      // not be drawn over it (nor its id saved onto the new item).
      attachNewItemPhoto(uri, undefined);
    }
  }, [editingItem, attachNewItemPhoto]);
  const removePanePhoto = useCallback(() => {
    if (editingItem) {
      // Nothing saved had a photo and he removes the one he just chose: back
      // to keep, not a remove of a photo that never existed.
      setPhotoEdit(editingItem.photoUri ? { kind: 'remove' } : { kind: 'keep' });
    } else {
      setAttachedPhotoUri(undefined);
      setAttachedSourcePhotoId(undefined);
    }
  }, [editingItem]);
  const panePendingNote = editingItem
    ? photoEdit.kind === 'replace'
      ? 'New photo — saved when you tap Update.'
      : photoEdit.kind === 'remove'
        ? 'The photo is removed when you tap Update.'
        : null
    : attachedPhotoUri && paneMarkup.length > 0
      // Same caveat the phone sheet prints under a marked-up prefill.
      ? 'Your markup shows here only. The sub portal shows the description, location and plan sheet, not the photo or the mark — describe the mark in the description.'
      : null;
  const panePin = useMemo((): PunchEditPinThumb | null => {
    const ref = editingItem ? pinRefOf(editingItem, sheetsById) : null;
    const spot = ref?.state === 'pinned'
      ? { sheetId: ref.sheetId, x: ref.x, y: ref.y }
      : !editingItem && formPin ? formPin : null;
    if (!spot) return null;
    const sheet = sheetsById.get(spot.sheetId);
    if (!sheet?.imageUri) return null;
    const n = editingItem ? itemNumbers.get(editingItem.id) ?? null : null;
    return {
      imageUri: sheet.imageUri,
      storedAspect: sheetAspectRatio(sheet),
      x: spot.x,
      y: spot.y,
      number: n,
      label: `${pinSheetLabel(sheet)}${sheet.superseded ? ' · older revision' : ''}${n !== null ? ` — pin ${n}` : ''}${editingItem ? '' : ' · pinned when you add it'}`,
    };
  }, [editingItem, sheetsById, formPin, itemNumbers]);

  const [showExport, setShowExport] = useState(false);
  const openExport = useCallback(() => setShowExport(true), []);
  const closeExport = useCallback(() => setShowExport(false), []);
  const exportHeaderRight = useCallback(
    () => <PunchExportHeaderButton onPress={openExport} />,
    [openExport],
  );
  const exportProjectName = project?.name;
  const stackOptions = useMemo(
    () => ({
      title: exportProjectName !== undefined ? `Punch List — ${exportProjectName}` : 'Punch List',
      headerRight: exportProjectName !== undefined ? exportHeaderRight : undefined,
    }),
    [exportProjectName, exportHeaderRight],
  );

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={stackOptions} />
        <ToolProjectPicker
          toolName="Punch List"
          message={ownTier
            ? 'Punch lists are tied to a project so each item links to its trade and location.'
            // #127: in on an invite, not his own plan — only the jobs whose
            // invite opens the punch list, or a pick would open a Business
            // feature on one of his own free-plan jobs.
            : 'Your plan does not include the punch list, but your GC invited you to the jobs below. Pick the one you are on.'}
          projects={pickableProjects}
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
      {/* #54: while a notification's re-read is in flight the rows below are
          the copy from launch — said, not passed off as current. */}
      {refreshState === 'refreshing' || refreshState === 'offline' || focusMissing ? (
        <View style={styles.refreshBanner} testID={`punch-focus-${refreshState === 'refreshing' ? 'refreshing' : refreshState === 'offline' ? 'offline' : 'missing'}`}>
          {refreshState === 'refreshing' ? <ActivityIndicator size="small" color={themeColors.accent} /> : null}
          <Text style={styles.refreshBannerText}>
            {refreshState === 'refreshing'
              ? 'Refreshing… loading the sub’s latest mark. Statuses below may be out of date until this finishes.'
              : refreshState === 'offline'
                ? 'No signal — this is the list saved on this phone, so the sub’s latest mark may not be on it yet.'
                : 'That item isn’t on this punch list. It may have been deleted, or it isn’t shared with you.'}
          </Text>
          {/* A real control, not "pull down": pull-to-refresh does nothing on
              the web app, and this re-runs the whole focus, not just a read. */}
          {refreshState !== 'refreshing' ? (
            <Button
              label={refreshState === 'offline' ? 'Try again' : 'Refresh'}
              variant="secondary"
              size="sm"
              onPress={retryFocus}
              testID="punch-focus-retry"
            />
          ) : null}
        </View>
      ) : null}
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

      {/* ── On the plan ──────────────────────────────────────────────────
          "Where is that ability?" — answered at the top, not under 63 rows.
          Only once the list has hydrated: "0 of 0 pinned" on an empty cache
          would be a claim about nothing. */}
      {punchItemsLoaded && items.length > 0 && (
        <View style={[cardSurface(themeColors, { radius: 'md', pad: 12 }), styles.planCard]} testID="punch-plan-card">
          <View style={styles.planCardHead}>
            <EyebrowLabel tone="neutral">On the plan</EyebrowLabel>
            <Text style={[styles.planCardCount, pinCountsReady && pinStats.unpinned === 0 && { color: themeColors.successLabel }]}>
              {!pinCountsReady
                ? 'Checking the plan sheets…'
                : pinStats.unpinned === 0 ? `All ${pinStats.total} pinned` : `${pinStats.pinned} of ${pinStats.total} pinned`}
            </Text>
          </View>
          <View style={styles.planCardActions}>
            {/* 48pt (md), not 36: the site entry points, tapped with gloves. */}
            {pinCountsReady && pinStats.unpinned > 0 && (
              <Button
                size="md"
                label={`Pin ${pinStats.unpinned} item${pinStats.unpinned === 1 ? '' : 's'}`}
                onPress={() => router.push({ pathname: '/punch-pin' as never, params: { projectId: projectId ?? '', list: activeList } as never })}
                disabled={!!pinBlocked}
                iconLeft={<MapPinned size={14} color={Colors.textOnAccent} strokeWidth={2} />}
                testID="punch-pin-items"
              />
            )}
            <Button
              size="md"
              variant="secondary"
              label="Pin first"
              onPress={() => router.push({ pathname: '/punch-walk' as never, params: { projectId: projectId ?? '', list: activeList, start: 'pin' } as never })}
              disabled={!!pinBlocked}
              iconLeft={<MapPinPlus size={14} color={themeColors.text} strokeWidth={2} />}
              testID="punch-pin-first"
            />
          </View>
          {pinBlocked ? <Text style={styles.planCardNote}>{pinBlocked}</Text> : null}
        </View>
      )}

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
              Hand {portalTarget.name} their {portalTarget.count} open item{portalTarget.count === 1 ? '' : 's'} — open their portal link
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

  const renderWalkRow = (r: {
    icon: React.ReactNode; title: string; sub: string; a11y: string; testID: string;
    onPress: () => void; disabled?: boolean; count?: string; last?: boolean;
  }) => (
    <TouchableOpacity
      key={r.testID}
      style={[styles.walkRow2, !r.last && styles.walkRow2Divider, r.disabled && styles.walkRow2Off]}
      onPress={r.onPress}
      disabled={r.disabled}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={r.a11y}
      accessibilityHint={r.sub}
      accessibilityState={{ disabled: !!r.disabled }}
      testID={r.testID}
    >
      <View style={styles.walkRowIcon}>{r.icon}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.walkRowTitle} numberOfLines={2}>{r.title}</Text>
        <Text style={styles.walkRowSub} numberOfLines={2}>{r.sub}</Text>
      </View>
      {r.count ? (
        <View style={styles.walkRowCount}>
          <Text style={styles.walkRowCountText}>{r.count}</Text>
        </View>
      ) : null}
      <ChevronRight size={16} color={themeColors.textMuted} strokeWidth={1.75} />
    </TouchableOpacity>
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

      {/* ── Walk the job ──────────────────────────────────────────────────
          Every way to capture on site, each saying what it does and whether
          it pins. Walk Mode was labelled "voice capture" — the thing it is
          for (photo → pin → describe) was invisible from here. */}
      <View style={styles.walkGroupWrap}>
        <EyebrowLabel tone="neutral">Walk the job</EyebrowLabel>
        <View style={[cardSurface(themeColors, { radius: 'md', pad: 'none' }), styles.walkGroup]}>
          {renderWalkRow({
            icon: <Camera size={18} color={themeColors.accentLabel} strokeWidth={1.75} />,
            title: 'Walk Mode: photo → pin → describe',
            sub: 'Photo, then tap where it is on the plan, then say what’s wrong.',
            a11y: 'Walk mode: take a photo, pin it on the plan, then describe it',
            testID: 'open-punch-walk',
            // `list` hands Walk Mode the list that is showing, so a walk
            // started from the crew list files crew items.
            onPress: () => router.push({ pathname: '/punch-walk' as never, params: { projectId: projectId ?? '', list: activeList } as never }),
          })}
          {renderWalkRow({
            icon: <MapPinPlus size={18} color={themeColors.accentLabel} strokeWidth={1.75} />,
            title: 'Pin first: pin → photo → describe',
            sub: pinBlocked ?? 'Tap the spot on the plan, then take the photo.',
            a11y: 'Pin first: tap the spot on the plan, then take the photo, then describe it',
            testID: 'open-punch-pin-first',
            disabled: !!pinBlocked,
            onPress: () => router.push({ pathname: '/punch-walk' as never, params: { projectId: projectId ?? '', list: activeList, start: 'pin' } as never }),
          })}
          {renderWalkRow({
            icon: <MapPinned size={18} color={themeColors.accentLabel} strokeWidth={1.75} />,
            title: 'Pin items on the plan',
            sub: pinBlocked
              ?? (!pinCountsReady
                ? 'Loading the punch list and plans…'
                : pinStats.unpinned === 0 ? 'Every item on this list is pinned.' : 'One at a time: see the photo, tap the spot.'),
            count: pinCountsReady && pinStats.unpinned > 0 ? `${pinStats.unpinned} not pinned` : undefined,
            a11y: pinCountsReady && pinStats.unpinned > 0
              ? `Pin items on the plan, ${pinStats.unpinned} not pinned`
              : 'Pin items on the plan',
            testID: 'open-punch-pin-items',
            disabled: !!pinBlocked || !pinCountsReady || pinStats.unpinned === 0,
            onPress: () => router.push({ pathname: '/punch-pin' as never, params: { projectId: projectId ?? '', list: activeList } as never }),
          })}
          {renderWalkRow({
            icon: <Images size={18} color={themeColors.accentLabel} strokeWidth={1.75} />,
            title: walkShots.length > 0
              ? `Photo walk: ${walkShots.length} waiting for a line`
              : 'Photo walk: shoot now, describe later',
            sub: 'No pins — pin them after with Pin items.',
            a11y: 'Start a photo walk',
            testID: 'start-photo-walk',
            last: true,
            onPress: () => { void startPhotoWalk(); },
          })}
        </View>
      </View>

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

  // ── The add/edit sheet, in pieces ──────────────────────────────────────────
  // The same pieces compose two shapes (utils/punchEditLayout): the phone's
  // bottom sheet — header, stage, photo preview, fields, actions, in exactly
  // the order and markup it always had — and, on a wide web window, the
  // centred 75 / 25 panel: header, stage and fields in a scrolling left
  // column with the actions pinned under it, the photo pane on the right.
  const formHeaderEl = (
    <>
      <View style={styles.formHeader}>
        <Text style={styles.formTitle}>
          {editingItem ? 'Edit Item' : formListType === 'punch' ? 'New Punch Item' : 'New Crew List Item'}
        </Text>
        <TouchableOpacity onPress={() => { setShowForm(false); resetForm(); }} accessibilityRole="button" accessibilityLabel="Close">
          <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
        </TouchableOpacity>
      </View>
    </>
  );
  const formPipelineEl = (
    <>
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
              const nowIso = new Date().toISOString();
              // Stamp closedAt exactly as handleStatusChange does. This
              // path used to close an item with no close date, so the
              // export's Closed / Days Open columns and the closeout
              // packet had nothing to print for it.
              const patch: Partial<PunchItem> = {
                ...punchStatusPatch(editingItem, next as PunchItem['status'], nowIso),
                updatedAt: nowIso,
              };
              updatePunchItem(editingItem.id, patch);
              setEditingItem({ ...editingItem, ...patch });
            }}
          />
        </View>
      )}
    </>
  );
  const formPhotoPreviewEl = (
    <>
      {attachedPhotoUri ? (
        <View style={styles.photoPreview}>
          <View style={styles.photoImgWrap}>
            <Image source={{ uri: attachedPhotoUri }} style={styles.photoImg} resizeMode="cover" />
            {/* The circle he drew round the defect, drawn over the
                photo on THIS screen. It is stored beside the photo,
                not burned into it, and the sub portal shows neither
                the photo nor the mark yet (only the description,
                location, due date and plan sheet) — so the note
                below says so. */}
            <PhotoMarkupOverlay markup={markupForSource(projectPhotos, attachedSourcePhotoId, attachedPhotoUri)} />
          </View>
          <TouchableOpacity
            style={styles.photoRemove}
            onPress={() => { setAttachedPhotoUri(undefined); setAttachedSourcePhotoId(undefined); }}
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
      {attachedPhotoUri && markupForSource(projectPhotos, attachedSourcePhotoId, attachedPhotoUri).length > 0 ? (
        // The sub's portal does not draw the photo yet (it is in a
        // private bucket and needs a signed link), let alone the mark,
        // so he must describe it in words.
        <Text style={styles.formListNote}>
          Your markup shows here only. The sub portal shows the description, location and plan sheet, not the photo or the mark — describe the mark in the description.
        </Text>
      ) : null}
    </>
  );
  const formFieldsEl = (
    <>
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
          {/* A picker, not a text box: a typed "9/25" saved, never
              went overdue and printed raw (#113). Stored as the
              calendar day picked (utils/calendarDate), never a UTC
              slice. Optional, so it can be cleared. */}
          <TouchableOpacity
            style={[styles.input, styles.dueField]}
            onPress={() => setShowDuePicker(true)}
            accessibilityRole="button"
            accessibilityLabel={dueDate ? `Due date ${dueDate}. Change` : 'Pick a due date'}
            testID="punch-due-field"
          >
            <CalendarClock size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text
              style={[styles.dueFieldText, !dueDate && { color: themeColors.textMuted }, dueDate && !parseCalendarDay(dueDate.slice(0, 10)) && { color: themeColors.warningLabel }]}
              numberOfLines={1}
            >
              {!dueDate
                ? 'No due date'
                : parseCalendarDay(dueDate.slice(0, 10))
                  ? formatCalendarDay(dueDate.slice(0, 10))
                  : `“${dueDate}” — not a date`}
            </Text>
          </TouchableOpacity>
          {dueDate ? (
            <TouchableOpacity onPress={() => setDueDate('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear due date" testID="punch-due-clear">
              <Text style={styles.dueClear}>Clear</Text>
            </TouchableOpacity>
          ) : null}
          <DatePickerModal
            visible={showDuePicker}
            value={dueDate && parseCalendarDay(dueDate.slice(0, 10)) ? (parseCalendarDay(dueDate.slice(0, 10))?.toISOString() ?? '') : ''}
            allowFuture
            title="Due date"
            onClose={() => setShowDuePicker(false)}
            // The picker hands back noon-UTC of the day he picked;
            // calendarDayOf keeps that local calendar day as YYYY-MM-DD.
            onChange={(iso) => setDueDate(calendarDayOf(iso) ?? '')}
          />
        </View>
      </View>

      {/* Where it is on the plan. The row says the export's verdict
          in words; an existing item's pin is saved the moment it is
          placed or removed. */}
      <Text style={styles.fieldLabel}>On the plan</Text>
      {(() => {
        const ref = editingItem ? pinRefOf(editingItem, sheetsById) : null;
        const formSheet = formPin ? sheetsById.get(formPin.sheetId) : undefined;
        const saved = pinSavedInSheet ? ' · saved' : '';
        const pinnedHere = editingItem ? ref?.state === 'pinned' : !!formPin;
        const rowText = editingItem
          ? ref?.state === 'pinned'
            ? `Pinned on ${ref.sheetLabel}${sheetsById.get(ref.sheetId)?.superseded ? ' · older revision' : ''}${saved}`
            : ref?.state === 'no-position'
              ? `On ${ref.sheetLabel}, but its spot is missing${saved}`
              : ref?.state === 'sheet-missing'
                ? `Its plan sheet is no longer on this job${saved}`
                : `Not pinned — the export lists it as not pinned${saved}`
          : formPin
            ? `Will be pinned on ${formSheet ? pinSheetLabel(formSheet) : 'the plan'} when you add it`
            : 'Not pinned yet';
        return (
          <View style={styles.formPinBlock} testID="punch-form-pin">
            <View style={styles.formPinRow}>
              <MapPin size={14} color={pinnedHere ? themeColors.accentLabel : themeColors.textMuted} strokeWidth={2} />
              <Text style={styles.formPinText} testID="punch-form-pin-state">{rowText}</Text>
            </View>
            <View style={styles.formPinActions}>
              {pinnedHere ? (
                <>
                  <Button size="md" variant="secondary" label="Move pin" onPress={openFormPinStep} disabled={!!pinBlocked} testID="punch-form-pin-move" />
                  <Button size="md" variant="ghost" label="Remove pin" onPress={handleFormPinRemove} disabled={!!pinBlocked} testID="punch-form-pin-remove" />
                </>
              ) : (
                <Button
                  size="md"
                  variant="secondary"
                  label="Pin on plan"
                  onPress={openFormPinStep}
                  disabled={!!pinBlocked}
                  iconLeft={<MapPinPlus size={14} color={themeColors.text} strokeWidth={2} />}
                  testID="punch-form-pin-open"
                />
              )}
            </View>
            {pinBlocked ? <Text style={styles.formListNote}>{pinBlocked}</Text> : null}
          </View>
        );
      })()}

      <Text style={styles.fieldLabel}>Assigned Sub</Text>
      {/* Unassigned, the subs, and Other…. Tapping the active chip
          also clears it. Every choice sets the name AND the id
          together: a chip gives its sub's id; Unassigned and Other…
          clear it (the update sends null — see punchItemToUpdateRow),
          so no earlier sub's portal keeps the item (#18/#19). */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
        <TouchableOpacity
          style={[styles.subChip, !assignedSub.trim() && !subOther && styles.subChipActive]}
          onPress={() => { setAssignedSub(''); setFormSubId(undefined); setSubOther(false); }}
          accessibilityRole="button"
          accessibilityState={{ selected: !assignedSub.trim() && !subOther }}
          testID="punch-sub-unassigned"
        >
          <Text style={[styles.subChipText, !assignedSub.trim() && !subOther && styles.subChipTextActive]}>Unassigned</Text>
        </TouchableOpacity>
        {pickerSubs.map(s => {
          const on = !subOther && assignedSub === s.companyName;
          return (
            <TouchableOpacity
              key={s.id}
              style={[styles.subChip, on && styles.subChipActive]}
              onPress={() => {
                setSubOther(false);
                if (on) { setAssignedSub(''); setFormSubId(undefined); return; }
                setAssignedSub(s.companyName); setFormSubId(s.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityHint={on ? 'Tap again to unassign' : undefined}
            >
              <Text style={[styles.subChipText, on && styles.subChipTextActive]}>{s.companyName}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={[styles.subChip, subOther && styles.subChipActive]}
          onPress={() => { setSubOther(true); setAssignedSub(''); setFormSubId(undefined); }}
          accessibilityRole="button"
          accessibilityState={{ selected: subOther }}
          testID="punch-sub-other"
        >
          <Text style={[styles.subChipText, subOther && styles.subChipTextActive]}>Other…</Text>
        </TouchableOpacity>
      </ScrollView>
      {subOther ? (
        <TextInput
          style={[styles.input, { marginTop: 8 }]}
          value={assignedSub}
          onChangeText={t => { setAssignedSub(t); setFormSubId(undefined); }}
          placeholder="Company name"
          placeholderTextColor={themeColors.textMuted}
          autoFocus
          testID="punch-sub-other-input"
        />
      ) : null}
      {!projectSubs.isOwner && (projectSubs.isLoading || projectSubs.isError || pickerSubs.length === 0) ? (
        <Text style={styles.formListNote}>
          {projectSubs.isLoading
            ? 'Loading your GC’s subs on this job…'
            : projectSubs.isError
              ? 'Couldn’t load your GC’s subs on this job. Leave it unassigned and your GC assigns it.'
              : 'Your GC has no subs on this job yet. Leave it unassigned and your GC assigns it.'}
        </Text>
      ) : null}
      {editingItem?.subNote ? (
        <Text style={styles.formListNote}>Sub’s note from the portal: {editingItem.subNote}</Text>
      ) : null}

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
    </>
  );
  const formActionsEl = (
    <>
      <View style={styles.formActions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => { setShowForm(false); resetForm(); }}>
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} testID="save-punch-item">
          <Text style={styles.saveBtnText}>{editingItem ? 'Update' : 'Add Item'}</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      <Stack.Screen options={stackOptions} />
      <FlatList
        {...fabScroll}
        ref={listRef}
        onScrollToIndexFailed={onScrollToIndexFailed}
        // #54: pull down to re-read the list (the sub's latest marks).
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={onPullRefresh} tintColor={themeColors.accent} />}
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

      <PunchExportSheet
        visible={showExport}
        onClose={closeExport}
        projectId={projectId}
        allItems={allItems}
        filteredItems={filteredItems}
        selectedIds={selectMode ? selectedIdList : []}
        activeList={activeList}
        filterStatus={filterStatus}
        filterSub={filterSub}
        filterPriority={filterPriority}
        filterLocationKey={filterLocationKey}
        filterLocationLabel={filterLocationLabel}
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
                onPress={() => fileWalkShots()}
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
              {/* The photo walk never pins. This files the batch and goes
                  straight to Pin items on exactly these items. */}
              {describedWalkShots.length > 0 && !pinBlocked ? (
                <Button
                  label={`Add ${describedWalkShots.length} and pin them on the plan`}
                  variant="secondary"
                  onPress={() => fileWalkShots({ thenPin: true })}
                  iconLeft={<MapPinned size={16} color={themeColors.text} strokeWidth={2} />}
                  fullWidth
                  style={{ marginTop: 8 }}
                  testID="file-walk-items-and-pin"
                />
              ) : null}
              {walkShots.length > describedWalkShots.length ? (
                <Text style={styles.walkPending}>
                  {walkShots.length - describedWalkShots.length} photo{walkShots.length - describedWalkShots.length === 1 ? '' : 's'} still without a line — they stay here until you write one.
                </Text>
              ) : null}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showForm} transparent animationType={editLayout === 'split' ? 'fade' : 'slide'} onRequestClose={() => { setShowForm(false); resetForm(); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {editLayout === 'split' ? (
            <View style={[styles.modalOverlay, styles.splitOverlay]} testID="punch-edit-split">
              <View style={[styles.splitPanel, punchEditPanelSize(windowWidth, windowHeight)]}>
                <View style={[styles.splitForm, { flex: PUNCH_EDIT_FORM_FLEX }]}>
                  <View style={styles.splitFormHead}>{formHeaderEl}</View>
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.splitFormBody} keyboardShouldPersistTaps="handled">
                    {formPipelineEl}
                    {formFieldsEl}
                  </ScrollView>
                  <View style={styles.splitFormFoot}>{formActionsEl}</View>
                </View>
                <View style={[styles.splitPhoto, { flex: PUNCH_EDIT_PHOTO_FLEX }]}>
                  <PunchEditPhotoPane
                    photoUri={panePhotoUri}
                    markup={paneMarkup}
                    pendingNote={panePendingNote}
                    onOpenPhoto={() => setPaneViewerOpen(true)}
                    onPickPhoto={() => { void pickPanePhoto(); }}
                    onRemovePhoto={removePanePhoto}
                    addBlocked={paneBlocked('add')}
                    replaceBlocked={paneBlocked('replace')}
                    removeBlocked={paneBlocked('remove')}
                    pin={panePin}
                    pinText={editingItem ? 'Not pinned — the export lists it as not pinned.' : 'Not pinned yet — use Pin on plan in the form.'}
                    onOpenPin={openFormPinStep}
                    pinBlocked={pinBlocked || null}
                  />
                </View>
              </View>
            </View>
          ) : (
            <View style={styles.modalOverlay}>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end' as const }} keyboardShouldPersistTaps="handled">
                <View style={[styles.formCard, { paddingBottom: insets.bottom + 20 }]}>
                  {formHeaderEl}
                  {formPipelineEl}
                  {formPhotoPreviewEl}
                  {formFieldsEl}
                  {formActionsEl}
                </View>
              </ScrollView>
            </View>
          )}
        </KeyboardAvoidingView>
        {/* Nested INSIDE the sheet's Modal: iOS only presents a second Modal
            from within the first one's tree. No PDF import from here —
            leaving would throw away the sheet's unsaved fields. */}
        <PlanPinStep
          visible={formPinOpen}
          projectId={projectId ?? ''}
          title={editingItem ? `Where is #${itemNumbers.get(editingItem.id) ?? ''}?` : 'Where is this?'}
          nextLabel="Use this spot"
          skipLabel="Cancel"
          skipHint="Cancel to keep it as it was"
          closeLabel="Back to the item"
          photoUri={editingItem?.photoUri ?? attachedPhotoUri}
          initialPin={editingPinSeed.initialPin}
          initialSheetId={editingPinSeed.initialSheetId}
          hideItemIds={editingHideIds}
          sessionItemIds={NO_SESSION_IDS}
          sessionSheetId={null}
          onNext={handleFormPinNext}
          onSkip={() => setFormPinOpen(false)}
          onClose={() => setFormPinOpen(false)}
        />
        {/* The pane's photo, full size — nested for the same iOS reason. */}
        <PunchPhotoViewer
          visible={paneViewerOpen && editLayout === 'split'}
          uri={panePhotoUri}
          markup={paneMarkup}
          caption={[description.trim(), location.trim()].filter(Boolean).join('  ·  ')}
          onClose={() => setPaneViewerOpen(false)}
        />
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
            // The overlay has to share this box exactly, so the image and the
            // marks are siblings in one relative wrapper rather than the
            // overlay sitting over the whole backdrop (which includes the
            // header, and would shift every mark up by the caption's height).
            <View style={styles.viewerImageWrap}>
              <Image
                source={{ uri: viewerPhotoUri }}
                style={styles.viewerImage}
                resizeMode="contain"
                // A URL that only fails at full size (expired between the
                // thumbnail load and the tap) closes rather than holding the
                // user on a black rectangle; the row drops its thumbnail too.
                onError={() => { markPhotoFailed(viewerPhotoUri); setViewerItem(null); }}
              />
              {/* This is the view the sub argues over, so it is the one the
                  markup matters most on. It needs the CONTAINED variant: the
                  annotator normalized its marks against a square cover crop,
                  and this viewer letterboxes the whole photo, so a plain
                  overlay would put the circle beside the defect. */}
              <ContainedPhotoMarkupOverlay
                // By the source photo's id first: on any device but the one
                // that shot it, viewerPhotoUri is a signed `punch-<id>` URL
                // that matches no gallery photo.
                markup={markupForSource(projectPhotos, sourcePhotoIdOf(viewerItem), viewerPhotoUri)}
                uri={viewerPhotoUri}
              />
            </View>
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
                      accessibilityLabel={`${PUNCH_NO_ROOM_TEXT}, ${unplacedCount} items`}
                      testID="punch-loc-unplaced"
                    >
                      <Text style={[
                        styles.filterDrawerChipText,
                        filterLocationKey === UNPLACED_LOCATION_GROUP && styles.filterDrawerChipTextActive,
                      ]}>
                        {PUNCH_NO_ROOM_TEXT} ({unplacedCount})
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
          Assign only — there is no bulk "unassign" verb; to clear one item's
          sub, open it and tap Unassigned (or the active chip) in its edit
          sheet. Every assign sends the id with the name (undefined for a name
          with no sub record), and the update writes a missing id as NULL
          (assigned_sub_id is a nullable TEXT column), so a reassigned item
          never keeps the previous sub's id. */}
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
              {pickerSubs.map(s => (
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
                .filter(name => !pickerSubs.some(s => (s.companyName ?? '').trim().toLowerCase() === name.toLowerCase()))
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
              {pickerSubs.length === 0 && subsInList.length === 0 ? (
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
  gateWrap: { flex: 1, padding: 24, justifyContent: 'center' as const, alignItems: 'center' as const, gap: 12 },
  gateTitle: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: themeColors.text, textAlign: 'center' as const },
  gateText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, textAlign: 'center' as const, lineHeight: 20 },
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
  // #51/#54: the item a "ready for review" notification opened.
  punchCardFocused: { borderColor: themeColors.accent, borderWidth: 2 },
  refreshBanner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginHorizontal: 20, marginTop: 12, padding: 10, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accentSoft },
  refreshBannerText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
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
  punchLocationNone: { color: themeColors.textMuted, fontStyle: 'italic' as const },
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
  rejectionHistory: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 10, paddingVertical: 4, marginLeft: 18 },
  rejectionHistoryText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17 },
  punchActions: { flexDirection: 'row', gap: 8, paddingLeft: 18, flexWrap: 'wrap' },
  punchActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.line },
  punchActionText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const },
  punchDeleteBtnBlocked: { opacity: 0.55 },
  subNoteBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8,
    padding: 8, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.surfaceAlt,
  },
  subNoteText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.text, lineHeight: 17 },
  dueField: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dueFieldText: { flex: 1, fontSize: Type.subhead.fontSize, color: themeColors.text },
  dueClear: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: themeColors.accentLabel, marginTop: 6 },
  punchDeleteBtn: { width: 32, height: 32, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.dangerSoft, alignItems: 'center', justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 8 },
  emptyTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: themeColors.text },
  emptyDesc: { fontSize: Type.bodyCompact.fontSize, color: themeColors.textSecondary },
  addItemBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 8, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '12', borderWidth: 1, borderColor: themeColors.accent + '20' },
  addItemBtnText: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  planCard: { marginHorizontal: 20, marginBottom: 16, gap: 10 },
  planCardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  planCardCount: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  planCardActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  planCardNote: { fontSize: Type.caption1.fontSize, color: themeColors.warningLabel, lineHeight: 17 },
  walkGroupWrap: { marginHorizontal: 20, marginTop: 18, gap: 8 },
  walkGroup: { overflow: 'hidden' },
  walkRow2: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 12, minHeight: 60 },
  walkRow2Divider: { borderBottomWidth: 1, borderBottomColor: themeColors.line },
  walkRow2Off: { opacity: 0.55 },
  walkRowIcon: {
    width: 36, height: 36, borderRadius: Tokens.radius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: themeColors.accentSoft,
  },
  walkRowTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  walkRowSub: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: 2, lineHeight: 16 },
  walkRowCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, backgroundColor: themeColors.warningSoft },
  walkRowCountText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: themeColors.warningLabel },
  formPinBlock: { gap: 8 },
  formPinRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  formPinText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  formPinActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  closeProjectBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 16, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.success },
  closeProjectBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: '#fff' },
  projectClosedNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 20, marginTop: 16, paddingVertical: 14, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.successSoft },
  projectClosedNoteText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.success },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  formCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  // Web ≥ 900 px: the centred 75 / 25 panel (utils/punchEditLayout).
  splitOverlay: { justifyContent: 'center', alignItems: 'center' },
  splitPanel: { ...cardSurface(themeColors, { radius: 'panel', pad: 'none' }), flexDirection: 'row', overflow: 'hidden' },
  splitForm: { minWidth: 0 },
  splitFormHead: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 4 },
  splitFormBody: { paddingHorizontal: 24, paddingBottom: 12, gap: 8 },
  splitFormFoot: { paddingHorizontal: 24, paddingBottom: 18, borderTopWidth: 1, borderTopColor: themeColors.line },
  splitPhoto: { minWidth: 0 },
  formHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  formTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  photoPreview: { position: 'relative' as const, alignSelf: 'flex-start' as const, marginBottom: 4, borderRadius: Tokens.radius.md, overflow: 'hidden' as const },
  // SQUARE, and the image inside it covers. That is the exact frame
  // photo-annotator draws on (styles.canvas, aspectRatio 1 + contentFit cover),
  // and the markup's 0..1 coordinates only mean anything against it — a 4:3
  // preview would put the circle beside the defect.
  photoImgWrap: { width: 112, height: 112, borderRadius: Tokens.radius.md, overflow: 'hidden' as const },
  photoImg: { width: 112, height: 112, borderRadius: Tokens.radius.md },
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
  // The image and its markup overlay share this box, so the overlay can work
  // out where the letterboxed photo actually landed inside it.
  viewerImageWrap: { flex: 1, width: '100%', position: 'relative' as const },
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
