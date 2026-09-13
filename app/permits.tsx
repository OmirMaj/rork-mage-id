// Permits screen
//
// Lists every permit across every project. The marketing site claims
// "track permits and inspections" — this is the screen that delivers it.
//
// Architecture notes:
//   - Source of truth is ProjectContext.permits (local AsyncStorage,
//     keyed `mageid_permits`). No Supabase table yet — when we add one,
//     mirror the rfis pattern in ProjectContext.
//   - Phase tagging is a free-text field. We considered a fixed enum
//     (Foundation / Rough-in / Final / Closeout) but every jurisdiction
//     names phases differently and I'd rather not paint users into a
//     corner. The chip filter in the header is built from whatever phases
//     actually exist in the data.
//   - Attachment uri is a local file:// — when we wire Supabase Storage
//     for permit scans, swap to a remote URL but keep the field name.
//
// Stat cards on top, filter row, then a card per permit. Tap a card to
// edit. The tile-grid + modal pattern matches project-detail per CLAUDE.md.

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Platform, Modal, Pressable, TextInput, KeyboardAvoidingView,
  useWindowDimensions,
} from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import * as Haptics from 'expo-haptics';
import {
  ClipboardCheck, Calendar, AlertTriangle, Check,
  Clock, Plus, X, Save, Camera, FileText, Trash2, ChevronDown, CalendarDays,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { PERMIT_TYPE_INFO, PERMIT_STATUS_INFO, SPECIAL_INSPECTION_LABELS } from '@/mocks/permits';
import { StatusPipeline } from '@/components/StatusPipeline';
import { stagesFor, visualStageFor, isSideBranch, pipelinePositionFor, advanceTargetFor } from '@/utils/workflowPipelines';
import DatePickerModal from '@/components/DatePickerModal';
import type { Permit, PermitInspection, PermitInspectionResult, PermitStatus, PermitType, SpecialInspectionCategory } from '@/types';
import { generateUUID } from '@/utils/generateId';
import { useAuth } from '@/contexts/AuthContext';
import { PhotoThumbGrid, burstSummary, captureBurst, pickPhotoBatch } from '@/components/PhotoCapture';
import { queuePhotoUpload } from '@/utils/photoUploadQueue';
import {
  buildPhotoStoragePath, contentTypeForExt, isDeviceLocalUri, photoExtFromUri,
} from '@/utils/photoUploadCore';
import { isSupabaseConfigured } from '@/lib/supabase';
import { formatMoney } from '@/utils/formatters';
import { useProjects } from '@/contexts/ProjectContext';
import { parseCalendarDay, formatCalendarDay, todayCalendarDay, daysUntilCalendarDay } from '@/utils/calendarDate';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useTierAccess } from '@/hooks/useTierAccess';
import Paywall from '@/components/Paywall';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { showAlert } from '@/utils/alert';
import { NATIVE_HEADER_TITLE_FACE } from '@/constants/navigation';

// --- BEGIN permitInspectionCodec ---
// scripts/validate-field-capture.ts extracts everything between these
// sentinels, transpiles it and runs the REAL functions. This file is an Expo
// Router route and cannot be imported outside Metro, so the sentinels are the
// guard's only handle on the shipped code — moving or renaming them fails that
// guard loudly rather than silently unpinning the inspection history. Same
// technique as the carrySourceDayLabel region in app/daily-report.tsx.
//
// WHY THE HISTORY LIVES IN A TEXT COLUMN (audit 2026-09-07 "worth doing" #14).
// A permit had ONE inspectionDate and ONE inspectionNotes, so booking the
// framing inspection overwrote the footing's result and the correction note
// that came with it. On a job with 8–15 inspections the failed rough-electrical
// — one of the most common causes of a two-week slip — was the first thing the
// app forgot, and closeout could not assemble a history that was never kept.
//
// `public.permits` has no jsonb column (supabase/schema.sql:1234) and a client
// release cannot add one. The alternatives were both worse: a local-only
// AsyncStorage collection dies on the next device, and writing an unmapped
// field is DATA LOSS — ProjectContext's permits query overwrites the local copy
// with the server's rows on the next launch, so the history would vanish on any
// synced account. So the rows ride inside `inspection_notes`, which round-trips
// verbatim through the existing column mapping, behind a sentinel block that
// the encoder puts on and the decoder takes off. When the column lands, the
// migration reads the block out and this whole region goes with it.
//
// The invariant that makes it safe: NOTHING may display `inspectionNotes` raw.
// Every read goes through decodePermitInspectionNotes first.
//
// The one place that used to break it was universal search:
// hooks/useUniversalSearch.ts put `p.inspectionNotes` in the permit haystack
// and rendered `matchSnippet` as a window into that same raw string, so a
// search landing inside the block printed JSON at the GC. Closed 2026-09-08 —
// that file now reads through `permitInspectionSearchText`, which decodes the
// block AND additionally truncates at machine-text SHAPE (a `{"` object
// opener, or a `[[word:` namespaced sentinel). The shape test is what makes
// this invariant hold across files: renaming the sentinel constant here can no
// longer silently restore the leak, because the reader does not depend on
// knowing its value. Nothing else in the repo reads the column —
// mocks/permits.ts and the two dev seeders only WRITE plain notes, which the
// decoder handles as plain notes with an empty history.

const PERMIT_INSPECTIONS_OPEN = '[[mage:inspections]]';
const PERMIT_INSPECTIONS_CLOSE = '[[/mage:inspections]]';

const PERMIT_INSPECTION_RESULTS: PermitInspectionResult[] = ['scheduled', 'passed', 'failed', 'cancelled'];

/** A row survives the round-trip only if it still has the fields the UI reads.
 *  Anything else is dropped rather than rendered as a half-inspection. */
function isPermitInspectionRow(v: unknown): v is PermitInspection {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && r.id.length > 0
    && typeof r.name === 'string'
    && typeof r.scheduledFor === 'string'
    && typeof r.result === 'string'
    && (PERMIT_INSPECTION_RESULTS as string[]).includes(r.result);
}

/** Newest first: by calendar day, then by when the row was written, so two
 *  inspections called on the same morning keep the order they were logged. */
function sortPermitInspections(rows: PermitInspection[]): PermitInspection[] {
  return [...rows].sort((a, b) => {
    if (a.scheduledFor !== b.scheduledFor) return a.scheduledFor < b.scheduledFor ? 1 : -1;
    return (b.recordedAt ?? '') < (a.recordedAt ?? '') ? -1 : 1;
  });
}

/**
 * Split a stored `inspectionNotes` into the notes a human wrote and the
 * inspection history riding behind them.
 *
 * A permit written before this shipped — or by the seeders, or by hand in the
 * Supabase console — has no sentinel and comes back as plain notes with an
 * empty history, which is exactly right. A sentinel with unreadable JSON drops
 * the history rather than showing the user a block of machine text: losing a
 * history we cannot parse is bad, but printing `[[mage:inspections]]` into the
 * failed-inspection alert on the permit card is worse and is the failure the
 * user would actually see.
 */
function decodePermitInspectionNotes(raw: string | undefined | null): { notes: string; inspections: PermitInspection[] } {
  const text = typeof raw === 'string' ? raw : '';
  const open = text.indexOf(PERMIT_INSPECTIONS_OPEN);
  if (open < 0) return { notes: text.trim(), inspections: [] };
  const notes = text.slice(0, open).trim();
  const close = text.indexOf(PERMIT_INSPECTIONS_CLOSE, open);
  if (close < 0) return { notes, inspections: [] };
  const json = text.slice(open + PERMIT_INSPECTIONS_OPEN.length, close);
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return { notes, inspections: [] };
    return { notes, inspections: sortPermitInspections(parsed.filter(isPermitInspectionRow)) };
  } catch {
    return { notes, inspections: [] };
  }
}

/**
 * The value to store in `inspectionNotes`. `undefined` when there is neither a
 * note nor a history — the column is nullable and an empty sentinel block is
 * just noise waiting to confuse the next reader.
 */
function encodePermitInspectionNotes(notes: string, inspections: PermitInspection[]): string | undefined {
  const clean = (notes ?? '').trim();
  if (inspections.length === 0) return clean || undefined;
  const block = `${PERMIT_INSPECTIONS_OPEN}${JSON.stringify(sortPermitInspections(inspections))}${PERMIT_INSPECTIONS_CLOSE}`;
  return clean ? `${clean}\n\n${block}` : block;
}

/** The status values that mean the permit's single inspection fields describe
 *  a real inspection, and which result each one records. */
function inspectionResultForStatus(status: PermitStatus): PermitInspectionResult | null {
  if (status === 'inspection_scheduled') return 'scheduled';
  if (status === 'inspection_passed') return 'passed';
  if (status === 'inspection_failed') return 'failed';
  return null;
}

/**
 * Fold the permit's single "current inspection" fields into the history, so
 * that booking the next one cannot erase the last one.
 *
 * This is the half that fixes the bug without asking the GC to do extra work:
 * he schedules and resolves inspections exactly the way he already does, and
 * the act of doing it leaves a row behind. It has to be idempotent, because it
 * runs on every save of the permit form:
 *
 *   - same day, same result already recorded  → nothing (a re-save is not a
 *     second inspection)
 *   - same day, previously 'scheduled', now passed/failed → the SAME row is
 *     resolved in place; a called inspection is one inspection, not two
 *   - a new day → a new row
 *
 * `name` comes from the permit's phase ("Foundation", "Rough-in", "Final") when
 * the GC has set one, because that is the only name the record actually has.
 * Never invented from the permit type — "Electrical inspection" on a plumbing
 * rough-in is the kind of confident wrong label that gets a record distrusted.
 */
function foldCurrentInspection(args: {
  inspections: PermitInspection[];
  status: PermitStatus;
  /** Calendar day 'YYYY-MM-DD'. Empty = nothing to fold. */
  inspectionDate: string;
  inspectionNotes: string;
  phase?: string;
  inspectorName?: string;
  now: string;
  /** Injected so the guard can pin ids; the screen passes generateUUID. */
  newId: () => string;
}): PermitInspection[] {
  const { inspections, status, inspectionDate, inspectionNotes, phase, inspectorName, now, newId } = args;
  const day = (inspectionDate ?? '').slice(0, 10);
  if (!day) return inspections;
  const result = inspectionResultForStatus(status);
  if (!result) return inspections;

  const notes = (inspectionNotes ?? '').trim() || undefined;
  const name = (phase ?? '').trim() || 'Inspection';
  // Which row, if any, this head actually describes.
  //
  // Matching on the DAY alone was the finding's own bug narrowed to a day
  // (review 2026-09-08). Two inspections on one permit on one calendar day is
  // ordinary — a re-inspection called the morning a new trade is booked, a
  // combined permit with rough plumbing and rough mechanical on the same
  // Thursday, or any row the GC logged by hand in the history editor below —
  // and a bare day match folded the head onto whichever one it found, quietly
  // replacing that inspection's result and its correction notes.
  //
  // A row still `scheduled` has no verdict to lose, so the head resolving it in
  // place is exactly the intended behaviour. A row that has already been CALLED
  // is a verdict, and the head only lands on it when this is plainly the same
  // inspection being re-saved or corrected — same day, same name. Everything
  // else gets its own row: a duplicate row is something the GC can delete, an
  // erased failed footing is not something he can get back.
  const existingIdx = inspections.findIndex(i => {
    if (i.scheduledFor.slice(0, 10) !== day) return false;
    if (i.result === 'scheduled') return true;
    return (i.name || 'Inspection') === name;
  });

  if (existingIdx >= 0) {
    const existing = inspections[existingIdx];
    // Nothing new happened — same day, same verdict, same note.
    if (existing.result === result && (existing.notes ?? undefined) === notes) return inspections;
    // A scheduled visit that has now been called resolves in place. A verdict
    // that CHANGES (passed → failed) also lands on the same row: it is a
    // correction of one inspection, not a second one on the same day.
    const next = [...inspections];
    next[existingIdx] = {
      ...existing,
      result,
      notes: notes ?? existing.notes,
      name: existing.name || name,
      inspectorName: inspectorName?.trim() || existing.inspectorName,
      recordedAt: now,
    };
    return sortPermitInspections(next);
  }

  return sortPermitInspections([
    ...inspections,
    {
      id: newId(),
      name,
      scheduledFor: day,
      result,
      notes,
      inspectorName: inspectorName?.trim() || undefined,
      recordedAt: now,
    },
  ]);
}

/** What the history says happened, in one line, for the permit card. */
function inspectionHistorySummary(rows: PermitInspection[]): string | null {
  if (rows.length === 0) return null;
  const failed = rows.filter(r => r.result === 'failed').length;
  const passed = rows.filter(r => r.result === 'passed').length;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  const called = passed + failed;
  if (called === 0) return `${rows.length} inspection${rows.length === 1 ? '' : 's'} scheduled`;
  return `${called} inspection${called === 1 ? '' : 's'} called — ${parts.join(', ')}`;
}
// --- END permitInspectionCodec ---

const PERMIT_TYPES: PermitType[] = ['building', 'electrical', 'plumbing', 'mechanical', 'demolition', 'grading', 'fire', 'occupancy', 'special_inspection', 'other'];

/**
 * The permit is issued but its inspection cycle has not begun. The inspection
 * breadcrumb is then correctly all-empty — nothing has been scheduled — and
 * this is what keeps "Schedule inspection" reachable anyway.
 *
 * Both halves come from the model so the screen cannot drift from it:
 * `pipelinePositionFor` says the status belongs to the application path, and
 * `advanceTargetFor` refuses unless that path has actually FINISHED, so a
 * permit still `under_review` is not offered an inspection.
 */
function inspectionNotStarted(status: PermitStatus): boolean {
  return pipelinePositionFor('permitInspection', status) === 'not_started'
    && advanceTargetFor('permitInspection', status) !== null;
}

// IBC Ch.17 categories ordered the way they typically appear on a project
const SPECIAL_INSPECTION_TYPES: SpecialInspectionCategory[] = [
  'soils', 'concrete', 'masonry', 'structural_steel', 'cold_formed_steel',
  'wood', 'fire_resistive', 'sprayed_fireproof', 'smoke_control', 'special_cases',
];
const PERMIT_STATUSES: PermitStatus[] = ['applied', 'under_review', 'approved', 'denied', 'expired', 'inspection_scheduled', 'inspection_passed', 'inspection_failed'];

/**
 * The drop-down body for every picker on the permit form.
 *
 * It exists because `maxHeight` on a plain `<View>` does not mean "scroll
 * after this" — it means "clip here", and clipped rows are unreachable. The
 * lists are longer than the box: 8 statuses, 10 permit types, 10 IBC Ch.17
 * categories, and however many projects the account has. At ~38px a row
 * (paddingVertical 10 + a 17px line) only ~5.8 rows fit in 220px, so the tail
 * of every list was untappable — including `inspection_scheduled` /
 * `inspection_passed` / `inspection_failed`, the three statuses the permit
 * inspection pipeline exists to drive.
 *
 * `maxHeight` is deliberately NOT a whole number of rows: the half-row peeking
 * out of the bottom edge is the affordance that says there is more below.
 * Every picker renders through here so a new one cannot re-acquire the bug.
 */
function PickerOptions({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <ScrollView
      style={styles.pickerOptions}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

/**
 * A permit can legitimately carry NO issuing authority.
 *
 * The Construction AI roadmap's "Add to Permits" writes
 * `jurisdiction: roadmapAuthority ?? ''`, and `roadmapAuthority` is null
 * whenever utils/codeJurisdiction could not verify which building department
 * governs the jobsite — it refuses to guess, and the roadmap says so before
 * the tap ("saved with a blank issuing jurisdiction — fill it in on the
 * Permits screen"). This screen has to keep the other half of that promise:
 * the card rendered the empty string raw, so the permit arrived with a blank
 * line where the authority goes — indistinguishable from a layout bug, and
 * silent about the one field the manual form refuses to save without.
 *
 * Name the gap and point at the fix. Returns null when there is nothing real
 * to print, so each caller decides how to say it.
 */
const JURISDICTION_UNSET = 'Issuing jurisdiction not set';

function jurisdictionOrNull(value: string | null | undefined): string | null {
  const v = (value ?? '').trim();
  return v.length > 0 ? v : null;
}

function PermitCard({ permit, onPress }: { permit: Permit; onPress: () => void }) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const typeInfo = PERMIT_TYPE_INFO[permit.type] ?? PERMIT_TYPE_INFO.other;
  const statusInfo = PERMIT_STATUS_INFO[permit.status] ?? PERMIT_STATUS_INFO.applied;

  // UX-F4: inspectionDate is a CALENDAR DAY — bare 'YYYY-MM-DD' once it has
  // round-tripped through the Postgres `date` column, a full ISO before. new
  // Date() of the bare form is UTC midnight, so the countdown ran a day early
  // west of Greenwich and the same permit changed date after a sync. Whole
  // local days: 0 = today, which the old `> Date.now()` test could never reach.
  const daysToInspection = permit.status === 'inspection_scheduled'
    ? daysUntilCalendarDay(permit.inspectionDate)
    : null;
  const isInspectionUpcoming = daysToInspection !== null && daysToInspection >= 0;
  const daysUntilInspection = isInspectionUpcoming ? daysToInspection : 0;

  // `inspectionNotes` carries the inspection history behind a sentinel block
  // (see the codec at the top of this file), so it is NOT display text on its
  // own. Every read of it on this screen goes through the decoder.
  const decoded = useMemo(() => decodePermitInspectionNotes(permit.inspectionNotes), [permit.inspectionNotes]);
  const historySummary = useMemo(() => inspectionHistorySummary(decoded.inspections), [decoded.inspections]);

  return (
    <Animated.View style={[styles.permitCard, { transform: [{ scale: scaleAnim }] }]}>
      <TouchableOpacity
        onPress={onPress}
        onPressIn={() => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        activeOpacity={1}
        style={styles.permitCardInner}
        testID={`permit-${permit.id}`}
      >
        <View style={styles.permitHeader}>
          <View style={[styles.permitTypeDot, { backgroundColor: typeInfo.color }]} />
          <Text style={styles.permitType}>{typeInfo.label} Permit</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusInfo.bgColor }]}>
            <Text style={[styles.statusBadgeText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
          </View>
        </View>

        {/* Descriptive name — first line of notes. Roadmap "Add to Permits"
            stores the permit's specific name here (the tracker has no title
            column), so cards show e.g. "200A panel upgrade" not just "Electrical". */}
        {(() => {
          const name = (permit.notes ?? '').split('\n')[0].trim();
          return name ? <Text style={styles.permitName} numberOfLines={2}>{name}</Text> : null;
        })()}

        {permit.permitNumber && (
          <Text style={styles.permitNumber}>#{permit.permitNumber}</Text>
        )}

        {/* IBC Ch.17 category chip — only renders for special inspections,
            making them visually distinct from regular permits in the list. */}
        {permit.type === 'special_inspection' && permit.specialInspectionCategory && (
          <View style={styles.specialCategoryChip}>
            <Text style={styles.specialCategoryText}>
              {SPECIAL_INSPECTION_LABELS[permit.specialInspectionCategory] ?? permit.specialInspectionCategory}
            </Text>
          </View>
        )}

        <Text style={styles.permitProject}>{permit.projectName}</Text>
        {/* Tapping anywhere on this card opens the edit form, where
            jurisdiction is a required field — so "tap to add" is the literal
            next step, not a slogan. */}
        {(() => {
          const jurisdiction = jurisdictionOrNull(permit.jurisdiction);
          return jurisdiction ? (
            <Text style={styles.permitJurisdiction}>{jurisdiction}</Text>
          ) : (
            <Text style={styles.permitJurisdictionUnset} testID={`permit-jurisdiction-unset-${permit.id}`}>
              {JURISDICTION_UNSET} — tap to add
            </Text>
          );
        })()}
        {permit.type === 'special_inspection' && permit.inspectorName && (
          <Text style={styles.specialInspectorLine}>Inspector: {permit.inspectorName}</Text>
        )}

        {permit.phase && (
          <View style={styles.phaseTag}>
            <Text style={styles.phaseTagText}>{permit.phase}</Text>
          </View>
        )}

        {isInspectionUpcoming && (
          <View style={styles.inspectionAlert}>
            <Calendar size={13} color={Colors.purple} strokeWidth={1.75} />
            <Text style={styles.inspectionAlertText}>
              Inspection in {daysUntilInspection} day{daysUntilInspection !== 1 ? 's' : ''} — {formatCalendarDay(permit.inspectionDate, { weekday: 'short', month: 'short', day: 'numeric' })}
            </Text>
          </View>
        )}

        {permit.status === 'inspection_failed' && decoded.notes ? (
          <View style={styles.failedAlert}>
            <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={1.75} />
            <Text style={styles.failedAlertText} numberOfLines={2}>{decoded.notes}</Text>
          </View>
        ) : null}

        {/* The history the single inspectionDate/Notes pair used to overwrite.
            One line on the card; the rows themselves are in the edit sheet. */}
        {historySummary ? (
          <View style={styles.attachRow}>
            <ClipboardCheck size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.attachText}>{historySummary}</Text>
          </View>
        ) : null}

        {permit.attachmentUri && (
          <View style={styles.attachRow}>
            <FileText size={12} color={themeColors.textSecondary} strokeWidth={1.75} />
            <Text style={styles.attachText}>Permit document attached</Text>
          </View>
        )}

        <View style={styles.permitFooter}>
          <Text style={styles.permitFee}>{formatMoney(permit.fee)}</Text>
          <Text style={styles.permitDate}>
            Applied {formatCalendarDay(permit.appliedDate, { month: 'short', day: 'numeric' })}
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}


interface PermitFormState {
  projectId: string;
  type: PermitType;
  permitNumber: string;
  jurisdiction: string;
  status: PermitStatus;
  appliedDate: string;
  inspectionDate: string;
  inspectionNotes: string;
  fee: string;
  phase: string;
  notes: string;
  attachmentUri?: string;
  // IBC Ch.17 special-inspection extras — populated only when type === 'special_inspection'.
  specialInspectionCategory?: SpecialInspectionCategory;
  inspectorName?: string;
  lastReportSummary?: string;
  lastReportDate?: string;
}

/** The inline "log an inspection" row, before it becomes a PermitInspection. */
interface InspectionDraft {
  name: string;
  scheduledFor: string;
  result: PermitInspectionResult;
  notes: string;
}

const EMPTY_INSPECTION_DRAFT: InspectionDraft = {
  name: '', scheduledFor: '', result: 'scheduled', notes: '',
};

const INSPECTION_RESULT_LABELS: Record<PermitInspectionResult, string> = {
  scheduled: 'Scheduled',
  passed: 'Passed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

const EMPTY_FORM: PermitFormState = {
  projectId: '',
  type: 'building',
  permitNumber: '',
  jurisdiction: '',
  status: 'applied',
  appliedDate: todayCalendarDay(), // UX-F4: local day (refreshed again in openNewForm)
  inspectionDate: '',
  inspectionNotes: '',
  fee: '',
  phase: '',
  notes: '',
};

export default function PermitsScreen() {
  const { canAccess } = useTierAccess();
  const goBack = useSafeBack(); // UX-F18: cold-start safe
  // Permit + inspection tracking is a Pro-tier field-PM capability — it rolls
  // up fees and drives the inspection countdown, matching the paid siblings in
  // this cluster (material-receipt is also 'job_costing'/Pro). Pre-fix the
  // screen had NO gate at all while every sibling gated, which read as an
  // oversight + a monetization leak. Gated on the closest existing FeatureKey;
  // see FLAG note — a dedicated 'permits_inspections' key would be cleaner but
  // lives in the shared useTierAccess hook.
  if (!canAccess('job_costing')) {
    return (
      <Paywall
        visible
        feature="Permits & Inspections"
        requiredTier="pro"
        onClose={goBack}
      />
    );
  }
  return <PermitsScreenInner />;
}

function PermitsScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const insetTopWeb = (insets.top || 16) + 4;
  const { height: windowHeight } = useWindowDimensions();
  // The edit sheet is a bottom sheet (`justifyContent: 'flex-end'`), so a card
  // taller than its container overflows off the TOP — which is how the title
  // ended up drawn over the status-bar clock and, on a tall special-inspection
  // permit, put the X close button entirely off-screen. Cap the card at the
  // screen minus the top safe-area inset (plus a small gap) so it can never
  // reach the notch / Dynamic Island. `flexShrink` on the card and its scroll
  // body then absorbs any further squeeze from the keyboard.
  const maxSheetHeight = Math.max(320, windowHeight - insets.top - 8);
  const { projects, permits, addPermit, updatePermit, deletePermit } = useProjects();
  const [selectedFilter, setSelectedFilter] = useState<string>('all');
  const [editingPermit, setEditingPermit] = useState<Permit | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [form, setForm] = useState<PermitFormState>(EMPTY_FORM);
  // The permit's inspection history, decoded out of `inspectionNotes`.
  const [inspections, setInspections] = useState<PermitInspection[]>([]);
  const [logOpen, setLogOpen] = useState(false);
  const [logDraft, setLogDraft] = useState<InspectionDraft>(EMPTY_INSPECTION_DRAFT);
  // The just-picked scan, so the form can say what it attached without asking
  // Storage to sign a path whose bytes may still be sitting in the queue.
  const [attachmentPreview, setAttachmentPreview] = useState<string | undefined>(undefined);
  const { user } = useAuth();
  const [pickerOpen, setPickerOpen] = useState<'project' | 'type' | 'status' | 'specialCategory' | null>(null);
  // Which date field the DatePickerModal is currently editing (null = closed).
  const [dateField, setDateField] = useState<'appliedDate' | 'inspectionDate' | 'lastReportDate' | 'logInspection' | null>(null);

  const filters = [
    { id: 'all', label: 'All' },
    { id: 'active', label: 'Active' },
    { id: 'inspections', label: 'Inspections' },
    { id: 'pending', label: 'Pending' },
  ];

  const phaseFilters = useMemo(() => {
    const phases = new Set<string>();
    permits.forEach(p => { if (p.phase?.trim()) phases.add(p.phase.trim()); });
    return Array.from(phases).slice(0, 8);
  }, [permits]);

  const filtered = useMemo(() => {
    let list = permits;
    if (selectedFilter === 'active') list = list.filter(p => ['approved', 'inspection_scheduled', 'inspection_passed'].includes(p.status));
    else if (selectedFilter === 'inspections') list = list.filter(p => p.status.startsWith('inspection'));
    else if (selectedFilter === 'pending') list = list.filter(p => ['applied', 'under_review'].includes(p.status));
    else if (selectedFilter.startsWith('phase:')) {
      const phase = selectedFilter.slice('phase:'.length);
      list = list.filter(p => p.phase === phase);
    }
    return list;
  }, [permits, selectedFilter]);

  const stats = useMemo(() => {
    const totalFees = permits.reduce((s, p) => s + p.fee, 0);
    const upcomingInspections = permits.filter(p =>
      p.status === 'inspection_scheduled' && (daysUntilCalendarDay(p.inspectionDate) ?? -1) >= 0 // UX-F4
    ).length;
    const pending = permits.filter(p => ['applied', 'under_review'].includes(p.status)).length;
    const passed = permits.filter(p => ['approved', 'inspection_passed'].includes(p.status)).length;
    const failed = permits.filter(p => p.status === 'inspection_failed').length;
    const denied = permits.filter(p => p.status === 'denied').length;
    return { totalFees, upcomingInspections, pending, passed, failed, denied };
  }, [permits]);

  // Surface the very next inspection so the GC sees it without scrolling.
  // Sorted by inspectionDate ascending so we always show the closest one.
  // Anything "scheduled in the past" is excluded (those need a status fix).
  const nextInspection = useMemo(() => {
    // UX-F4: local calendar days; an inspection scheduled for today still counts.
    const dayMs = (p: Permit) => parseCalendarDay(p.inspectionDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const upcoming = permits
      .filter(p => p.status === 'inspection_scheduled' && (daysUntilCalendarDay(p.inspectionDate) ?? -1) >= 0)
      .sort((a, b) => dayMs(a) - dayMs(b));
    return upcoming[0] ?? null;
  }, [permits]);

  // Failed-inspection alerts — these block work until reinspection so the
  // GC needs to see them prominently. Same logic for denied permits.
  const blockers = useMemo(() => {
    return permits.filter(p => p.status === 'inspection_failed' || p.status === 'denied');
  }, [permits]);

  const openNewForm = useCallback(() => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditingPermit(null);
    setForm({
      ...EMPTY_FORM,
      appliedDate: todayCalendarDay(),
      projectId: projects[0]?.id ?? '',
    });
    setInspections([]);
    setAttachmentPreview(undefined);
    setLogOpen(false);
    setLogDraft(EMPTY_INSPECTION_DRAFT);
    setShowForm(true);
  }, [projects]);

  const openEditForm = useCallback((permit: Permit) => {
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // The stored column is notes + an encoded history block; split it before
    // anything touches the form. `permit.inspections` is deliberately NOT
    // trusted here — it is absent on every row that came back from Supabase
    // (there is no column for it), so the encoded block is the one source.
    const decoded = decodePermitInspectionNotes(permit.inspectionNotes);
    setEditingPermit(permit);
    setInspections(decoded.inspections);
    setAttachmentPreview(undefined);
    setLogOpen(false);
    setLogDraft(EMPTY_INSPECTION_DRAFT);
    setForm({
      projectId: permit.projectId,
      type: permit.type,
      permitNumber: permit.permitNumber ?? '',
      jurisdiction: permit.jurisdiction,
      status: permit.status,
      appliedDate: permit.appliedDate.slice(0, 10),
      inspectionDate: permit.inspectionDate?.slice(0, 10) ?? '',
      // Only the human half. The encoded history behind it goes to `inspections`.
      inspectionNotes: decoded.notes,
      fee: String(permit.fee),
      phase: permit.phase ?? '',
      notes: permit.notes ?? '',
      attachmentUri: permit.attachmentUri,
      specialInspectionCategory: permit.specialInspectionCategory,
      inspectorName: permit.inspectorName ?? '',
      lastReportSummary: permit.lastReportSummary ?? '',
      lastReportDate: permit.lastReportDate?.slice(0, 10) ?? '',
    });
    setShowForm(true);
  }, []);

  const closeForm = useCallback(() => {
    setShowForm(false);
    setPickerOpen(null);
  }, []);

  /**
   * Stage a permit scan for upload and return the value the record should hold.
   *
   * PERMIT-ATTACH-LOCAL (audit 2026-09-07 "worth doing" #14, second half): this
   * used to write `result.assets[0].uri` straight onto the permit — a `file://`
   * path that means nothing on the office desktop, in the client portal, or on
   * this phone after a reinstall. A permit scan is the document you produce
   * when an inspector asks, and it was device-local the whole time. Same
   * staging path the project gallery and punch list already use.
   */
  const stagePermitScan = useCallback((localUri: string, projectId: string): string => {
    const userId = user?.id;
    if (!userId || !projectId || !isSupabaseConfigured || !isDeviceLocalUri(localUri)) return localUri;
    const ext = photoExtFromUri(localUri);
    // Keyed on a fresh id rather than the permit's, because a brand-new permit
    // has no id until ProjectContext.addPermit mints one — and the object key
    // has to be fixed BEFORE the bytes are queued so every retry writes the
    // same object. Replacing a scan therefore orphans the old object, which is
    // the cheaper of the two failure modes (the alternative is a live record
    // pointing at bytes a retry has moved). Namespaced by record kind so a
    // permit scan cannot collide with a punch or incident photo.
    const recordId = `permit-${generateUUID()}`;
    const storagePath = buildPhotoStoragePath(userId, projectId, recordId, ext);
    void queuePhotoUpload({
      photoId: recordId, userId, projectId, localUri, storagePath,
      contentType: contentTypeForExt(ext),
    });
    return storagePath;
  }, [user?.id]);

  const handleAttach = useCallback(async (source: 'camera' | 'library') => {
    const picked = source === 'library'
      ? await pickPhotoBatch({ remaining: 1, quality: 0.8 })
      : await (async () => {
          const shots: { uri: string }[] = [];
          const outcome = await captureBurst({
            remaining: 1, quality: 0.8, onCaptured: (a) => { shots.push(a); },
          });
          const note = burstSummary(outcome.captured, outcome.stoppedBy, 'one-scan');
          if (note && outcome.captured === 0) showAlert('Camera', note);
          return shots;
        })();
    if (picked.length === 0) return;
    const durable = stagePermitScan(picked[0].uri, form.projectId);
    setAttachmentPreview(picked[0].uri);
    setForm(f => ({ ...f, attachmentUri: durable }));
  }, [form.projectId, stagePermitScan]);

  const handleSave = useCallback(() => {
    if (!form.projectId) {
      showAlert('Pick a project', 'Permits are tracked per project — pick which one this belongs to.');
      return;
    }
    if (!form.jurisdiction.trim()) {
      showAlert('Missing jurisdiction', 'Add the issuing jurisdiction (e.g. "City of Phoenix, AZ").');
      return;
    }
    const project = projects.find(p => p.id === form.projectId);
    if (!project) {
      showAlert('Project not found', 'Pick a project from the list.');
      return;
    }
    const fee = Number(form.fee.replace(/[^0-9.]/g, '')) || 0;
    const foldedInspections = foldCurrentInspection({
      inspections,
      status: form.status,
      inspectionDate: form.inspectionDate,
      inspectionNotes: form.inspectionNotes,
      phase: form.phase,
      inspectorName: form.inspectorName,
      now: new Date().toISOString(),
      newId: generateUUID,
    });
    const payload: Omit<Permit, 'id' | 'createdAt' | 'updatedAt'> = {
      projectId: form.projectId,
      projectName: project.name,
      type: form.type,
      permitNumber: form.permitNumber.trim() || undefined,
      jurisdiction: form.jurisdiction.trim(),
      status: form.status,
      // UX-F4: stored as bare calendar days — exactly what the `date` columns
      // hand back after a sync, so a local row and its synced twin render alike.
      appliedDate: form.appliedDate || todayCalendarDay(),
      inspectionDate: form.inspectionDate || undefined,
      // The single inspectionDate/Notes pair is folded into the history FIRST,
      // so the act of booking the next inspection can no longer erase the last
      // one's result. Then the history is encoded back into the same column —
      // see the codec at the top of this file for why it rides there.
      inspectionNotes: encodePermitInspectionNotes(form.inspectionNotes, foldedInspections),
      inspections: foldedInspections.length > 0 ? foldedInspections : undefined,
      fee,
      phase: form.phase.trim() || undefined,
      notes: form.notes.trim() || undefined,
      attachmentUri: form.attachmentUri,
      // IBC Ch.17 fields — only saved when type === 'special_inspection'
      // so we don't pollute regular permits with empty placeholders.
      specialInspectionCategory: form.type === 'special_inspection' ? form.specialInspectionCategory : undefined,
      inspectorName:    form.type === 'special_inspection' ? (form.inspectorName?.trim() || undefined)    : undefined,
      lastReportSummary: form.type === 'special_inspection' ? (form.lastReportSummary?.trim() || undefined) : undefined,
      lastReportDate:    form.type === 'special_inspection' && form.lastReportDate ? form.lastReportDate : undefined,
    };

    if (editingPermit) {
      updatePermit(editingPermit.id, payload);
    } else {
      addPermit(payload);
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    closeForm();
  }, [form, inspections, projects, editingPermit, addPermit, updatePermit, closeForm]);

  // ── Inspection history editor ────────────────────────────────────────────
  //
  // The GC can log an inspection directly — the footing that already happened,
  // the re-inspection booked for Thursday — instead of only ever describing
  // "the" inspection in the single pair of fields above.
  const addLoggedInspection = useCallback(() => {
    const day = logDraft.scheduledFor.slice(0, 10);
    if (!day) {
      showAlert('Pick a date', 'An inspection needs the day it was called or booked for.');
      return;
    }
    const row: PermitInspection = {
      id: generateUUID(),
      name: logDraft.name.trim() || 'Inspection',
      scheduledFor: day,
      result: logDraft.result,
      notes: logDraft.notes.trim() || undefined,
      inspectorName: form.inspectorName?.trim() || undefined,
      recordedAt: new Date().toISOString(),
    };
    setInspections(prev => sortPermitInspections([...prev, row]));
    setLogDraft(EMPTY_INSPECTION_DRAFT);
    setLogOpen(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, [logDraft, form.inspectorName]);

  const removeLoggedInspection = useCallback((id: string) => {
    const row = inspections.find(i => i.id === id);
    showAlert(
      'Remove this inspection?',
      row
        ? `"${row.name}" on ${formatCalendarDay(row.scheduledFor, { month: 'short', day: 'numeric' })} — ${INSPECTION_RESULT_LABELS[row.result].toLowerCase()}${row.notes ? ' — and its notes' : ''}. This is the record of what the inspector said; it cannot be undone.`
        : 'This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => setInspections(prev => prev.filter(i => i.id !== id)) },
      ],
    );
  }, [inspections]);


  const handleDelete = useCallback(() => {
    if (!editingPermit) return;
    // Named by what it IS, not by an authority it may not have: with a blank
    // jurisdiction the old string read "This will remove  permit  from this
    // project" — a confirmation dialog that cannot say what it is deleting.
    const jurisdiction = jurisdictionOrNull(editingPermit.jurisdiction);
    const typeLabel = (PERMIT_TYPE_INFO[editingPermit.type] ?? PERMIT_TYPE_INFO.other).label;
    showAlert(
      'Delete permit?',
      `This will remove the ${typeLabel} permit${editingPermit.permitNumber ? ` #${editingPermit.permitNumber}` : ''}${jurisdiction ? ` issued by ${jurisdiction}` : ''} from this project. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          deletePermit(editingPermit.id);
          if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          closeForm();
        } },
      ],
    );
  }, [editingPermit, deletePermit, closeForm]);

  const selectedProjectName = projects.find(p => p.id === form.projectId)?.name ?? 'Pick a project';

  return (
    <View style={styles.container}>
      <Stack.Screen options={{
        title: 'Permits',
        headerStyle: { backgroundColor: themeColors.bg },
        headerTintColor: themeColors.accent,
        headerTitleStyle: { ...NATIVE_HEADER_TITLE_FACE, color: themeColors.text },
        headerRight: () => (
          <TouchableOpacity onPress={openNewForm} style={{ paddingHorizontal: 12, paddingVertical: 6 }} testID="new-permit-btn" accessibilityRole="button" accessibilityLabel="Add"><Plus size={22} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
        ),
      }} />
      <ScrollView
        {...fabScroll}
        contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}
        showsVerticalScrollIndicator={false}
      >
        {/* Next-inspection hero — biggest visual on screen when there
            is one. Calculates days countdown live so "tomorrow" shows
            up amber. Tap to jump to the permit detail. */}
        {nextInspection && (() => {
          const days = daysUntilCalendarDay(nextInspection.inspectionDate) ?? 0; // UX-F4: whole local days
          const dayLabel = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;
          const urgent = days <= 1;
          const typeInfo = PERMIT_TYPE_INFO[nextInspection.type] ?? PERMIT_TYPE_INFO.other;
          return (
            <TouchableOpacity
              style={[styles.nextInspectionCard, urgent && styles.nextInspectionUrgent]}
              onPress={() => openEditForm(nextInspection)}
              activeOpacity={0.85}
              testID="next-inspection-hero"
            >
              <View style={styles.nextInspectionTop}>
                <View style={[styles.nextInspectionBadge, { backgroundColor: urgent ? themeColors.dangerSoft : '#F3E5F5' }]}>
                  <Calendar size={14} color={urgent ? themeColors.dangerLabel : Colors.purple} strokeWidth={1.75} />
                  <Text style={[styles.nextInspectionBadgeText, { color: urgent ? themeColors.dangerLabel : Colors.purple }]}>
                    Next inspection · {dayLabel}
                  </Text>
                </View>
                <Text style={styles.nextInspectionDate}>
                  {formatCalendarDay(nextInspection.inspectionDate, { weekday: 'long', month: 'long', day: 'numeric' })}
                </Text>
              </View>
              <Text style={styles.nextInspectionType}>{typeInfo.label} Inspection</Text>
              <Text style={styles.nextInspectionProject} numberOfLines={1}>
                {nextInspection.projectName} &middot; {jurisdictionOrNull(nextInspection.jurisdiction) ?? JURISDICTION_UNSET}
              </Text>
              {nextInspection.permitNumber ? (
                <Text style={styles.nextInspectionPermitNum}>Permit #{nextInspection.permitNumber}</Text>
              ) : null}
            </TouchableOpacity>
          );
        })()}

        {/* Blockers — failed inspections + denied permits. These stop
            work entirely so they go above stats. Each one is tappable
            for fast follow-up. */}
        {blockers.length > 0 && (
          <View style={styles.blockersCard}>
            <View style={styles.blockersHeader}>
              <AlertTriangle size={14} color={themeColors.dangerLabel} strokeWidth={1.75} />
              <Text style={styles.blockersTitle}>
                {blockers.length} permit{blockers.length === 1 ? '' : 's'} blocking work
              </Text>
            </View>
            {blockers.map(b => (
              <TouchableOpacity key={b.id} style={styles.blockerRow} onPress={() => openEditForm(b)} activeOpacity={0.7}>
                <Text style={styles.blockerName}>
                  {(PERMIT_TYPE_INFO[b.type]?.label ?? b.type)} · {b.projectName}
                </Text>
                <Text style={styles.blockerStatus}>
                  {b.status === 'inspection_failed' ? 'Failed inspection' : 'Permit denied'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.accent + '14' }]}>
              <ClipboardCheck size={16} color={themeColors.accent} strokeWidth={1.75} />
            </View>
            <Text style={styles.statValue}>{permits.length}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: '#F3E5F5' }]}>
              <Calendar size={16} color={Colors.purple} strokeWidth={1.75} />
            </View>
            <Text style={[styles.statValue, { color: Colors.purple }]}>{stats.upcomingInspections}</Text>
            <Text style={styles.statLabel}>Upcoming</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.warningSoft }]}>
              <Clock size={16} color={Colors.warningDark} strokeWidth={1.75} />
            </View>
            <Text style={[styles.statValue, { color: themeColors.warningLabel }]}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statCard}>
            <View style={[styles.statIconWrap, { backgroundColor: themeColors.successSoft }]}>
              <Check size={16} color={Colors.successDark} strokeWidth={1.75} />
            </View>
            <Text style={[styles.statValue, { color: themeColors.success }]}>{stats.passed}</Text>
            <Text style={styles.statLabel}>Passed</Text>
          </View>
        </View>

        <View style={styles.feeCard}>
          <Text style={styles.feeLabel}>Total Permit Fees</Text>
          <Text style={styles.feeValue}>{formatMoney(stats.totalFees)}</Text>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {filters.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterChip, selectedFilter === f.id && styles.filterChipActive]}
              onPress={() => {
                setSelectedFilter(f.id);
                if (Platform.OS !== 'web') void Haptics.selectionAsync();
              }}
              activeOpacity={0.7}
            >
              <Text style={[styles.filterChipText, selectedFilter === f.id && styles.filterChipTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
          {phaseFilters.map(phase => {
            const id = `phase:${phase}`;
            return (
              <TouchableOpacity
                key={id}
                style={[styles.filterChip, selectedFilter === id && styles.filterChipActive]}
                onPress={() => {
                  setSelectedFilter(id);
                  if (Platform.OS !== 'web') void Haptics.selectionAsync();
                }}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterChipText, selectedFilter === id && styles.filterChipTextActive]}>
                  {phase}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.listSection}>
          {filtered.length === 0 ? (
            <View style={styles.emptyState}>
              <ClipboardCheck size={32} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyTitle}>No permits yet</Text>
              <Text style={styles.emptySub}>Tap + above to log your first permit. We&apos;ll track inspections and renewal dates from there.</Text>
              <TouchableOpacity style={styles.emptyCta} onPress={openNewForm}>
                <Plus size={16} color="#fff" strokeWidth={1.75} />
                <Text style={styles.emptyCtaText}>New Permit</Text>
              </TouchableOpacity>
            </View>
          ) : (
            filtered.map(permit => (
              <PermitCard key={permit.id} permit={permit} onPress={() => openEditForm(permit)} />
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={showForm} transparent animationType="slide" onRequestClose={closeForm}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* The overlay itself is inset from the top so that `flex-end` has
              nowhere above the safe area to push the card into — this is what
              keeps the header on screen when the keyboard shrinks the
              available height below `maxSheetHeight`. */}
          <Pressable style={[styles.modalOverlay, { paddingTop: insets.top + 8 }]} onPress={closeForm}>
            <Pressable
              style={[styles.modalCard, { paddingTop: Platform.OS === 'web' ? insetTopWeb : 16, maxHeight: maxSheetHeight }]}
              onPress={() => undefined}
            >
              {/* Header and the save/delete row stay PINNED; everything between
                  them scrolls. Both pipelines used to sit outside the scroll
                  body, so tall permits pushed this header off the top of the
                  screen. */}
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editingPermit ? 'Edit Permit' : 'New Permit'}</Text>
                <TouchableOpacity onPress={closeForm} accessibilityRole="button" accessibilityLabel="Close"><X size={22} color={themeColors.textMuted} strokeWidth={1.75} /></TouchableOpacity>
              </View>

              <ScrollView style={{ flexShrink: 1 }} keyboardShouldPersistTaps="handled">
                {editingPermit && (
                  <View style={{ marginBottom: 12 }}>
                    {/* A side branch has no position in either sequence, so the
                        breadcrumb anchors it at the first stage. Without this badge
                        the screen would claim an EXPIRED permit is "Applied" —
                        quieter than the old bug that called it "Approved", but still
                        wrong. The badge carries the real state; the breadcrumb just
                        stays rendered instead of collapsing. */}
                    {(isSideBranch('permit', form.status) || isSideBranch('permitInspection', form.status)) && (
                      <View style={styles.permitSideBranchBadge}>
                        <AlertTriangle size={13} color={themeColors.dangerLabel} strokeWidth={2} />
                        <Text style={styles.permitSideBranchText}>
                          {(PERMIT_STATUS_INFO[form.status]?.label) ?? form.status} — not on the normal path
                        </Text>
                      </View>
                    )}
                    {/* The application path. Ends at Approved — the permit is issued.
                        Inspections are a SEPARATE cycle below, not a continuation: a permit
                        does not pass through `denied` on the way to an inspection, and
                        collapsing them onto one line is what made `expired` and
                        `inspection_failed` both render as "Approved". */}
                    <StatusPipeline
                      stages={stagesFor('permit')}
                      current={visualStageFor('permit', form.status)}
                      startedAt={form.appliedDate || undefined}
                      onAdvance={isSideBranch('permit', form.status) ? undefined : (next) => {
                        setForm(f => ({ ...f, status: next as PermitStatus }));
                      }}
                      advanceLabel={
                        form.status === 'applied' ? 'Move to review'
                        : form.status === 'under_review' ? 'Mark approved'
                        : undefined
                      }
                    />

                    {/* The second loop, shown once the permit is issued. inspection_failed is a
                        side branch of THIS pipeline — a failed inspection gets rescheduled, so
                        it anchors back at Scheduled rather than pretending to be Passed.
                        On a freshly `approved` permit both dots are empty because no
                        inspection has happened; `notStarted` is what still offers the
                        way in. */}
                    {(form.status === 'approved' || form.status.startsWith('inspection_')) && (
                      <StatusPipeline
                        stages={stagesFor('permitInspection')}
                        current={visualStageFor('permitInspection', form.status)}
                        dueAt={form.inspectionDate || undefined}
                        notStarted={inspectionNotStarted(form.status)}
                        onAdvance={isSideBranch('permitInspection', form.status) ? undefined : (next) => {
                          setForm(f => ({ ...f, status: next as PermitStatus }));
                        }}
                        advanceLabel={
                          form.status === 'approved' ? 'Schedule inspection'
                          : form.status === 'inspection_scheduled' ? 'Mark inspection passed'
                          : undefined
                        }
                      />
                    )}
                  </View>
                )}

                <Text style={styles.formLabel}>Project *</Text>
                <TouchableOpacity style={styles.formPicker} onPress={() => setPickerOpen(pickerOpen === 'project' ? null : 'project')}>
                  <Text style={styles.formPickerText}>{selectedProjectName}</Text>
                  <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                {pickerOpen === 'project' && (
                  <PickerOptions testID="permit-project-options">
                    {projects.length === 0 ? (
                      <Text style={styles.pickerEmpty}>No projects yet — create one first.</Text>
                    ) : projects.map(p => (
                      <TouchableOpacity
                        key={p.id}
                        style={[styles.pickerRow, form.projectId === p.id && styles.pickerRowActive]}
                        onPress={() => { setForm(f => ({ ...f, projectId: p.id })); setPickerOpen(null); }}
                      >
                        <Text style={[styles.pickerRowText, form.projectId === p.id && styles.pickerRowTextActive]}>{p.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </PickerOptions>
                )}

                <Text style={styles.formLabel}>Type</Text>
                <TouchableOpacity style={styles.formPicker} onPress={() => setPickerOpen(pickerOpen === 'type' ? null : 'type')}>
                  <Text style={styles.formPickerText}>{(PERMIT_TYPE_INFO[form.type]?.label) ?? form.type}</Text>
                  <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                {pickerOpen === 'type' && (
                  <PickerOptions testID="permit-type-options">
                    {PERMIT_TYPES.map(t => (
                      <TouchableOpacity
                        key={t}
                        style={[styles.pickerRow, form.type === t && styles.pickerRowActive]}
                        onPress={() => { setForm(f => ({ ...f, type: t })); setPickerOpen(null); }}
                      >
                        <Text style={[styles.pickerRowText, form.type === t && styles.pickerRowTextActive]}>{PERMIT_TYPE_INFO[t]?.label ?? t}</Text>
                      </TouchableOpacity>
                    ))}
                  </PickerOptions>
                )}

                {/* IBC Ch.17 sub-fields — only render when the user
                    picked Special Inspection. Keeps the form short for
                    regular permit types so it doesn't feel cluttered. */}
                {form.type === 'special_inspection' && (
                  <>
                    <Text style={styles.formLabel}>IBC Ch.17 category</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => setPickerOpen(pickerOpen === 'specialCategory' ? null : 'specialCategory')}
                      testID="permit-special-category-picker"
                    >
                      <Text style={styles.formPickerText}>
                        {form.specialInspectionCategory ? SPECIAL_INSPECTION_LABELS[form.specialInspectionCategory] : 'Pick a category'}
                      </Text>
                      <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                    </TouchableOpacity>
                    {pickerOpen === 'specialCategory' && (
                      <PickerOptions testID="permit-special-category-options">
                        {SPECIAL_INSPECTION_TYPES.map(c => (
                          <TouchableOpacity
                            key={c}
                            style={[styles.pickerRow, form.specialInspectionCategory === c && styles.pickerRowActive]}
                            onPress={() => { setForm(f => ({ ...f, specialInspectionCategory: c })); setPickerOpen(null); }}
                          >
                            <Text style={[styles.pickerRowText, form.specialInspectionCategory === c && styles.pickerRowTextActive]}>
                              {SPECIAL_INSPECTION_LABELS[c]}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </PickerOptions>
                    )}

                    <Text style={styles.formLabel}>Inspector / agency</Text>
                    <TextInput
                      style={styles.formInput}
                      value={form.inspectorName ?? ''}
                      onChangeText={t => setForm(f => ({ ...f, inspectorName: t }))}
                      placeholder='e.g. "Geotek Engineering — Lic. STX-4112"'
                      placeholderTextColor={themeColors.textMuted}
                    />

                    <Text style={styles.formLabel}>Last report date</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('lastReportDate'); }}
                      testID="permit-last-report-date"
                    >
                      <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !form.lastReportDate && { color: themeColors.textMuted }]}>
                        {form.lastReportDate ? formatDateLabel(form.lastReportDate) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>

                    <Text style={styles.formLabel}>Last report summary</Text>
                    <TextInput
                      style={[styles.formInput, { minHeight: 60, textAlignVertical: 'top' as const }]}
                      value={form.lastReportSummary ?? ''}
                      onChangeText={t => setForm(f => ({ ...f, lastReportSummary: t }))}
                      placeholder="One-line summary of findings, e.g. 'Concrete sample 4-day compressive 4180 psi — passing'"
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                    />
                  </>
                )}

                <Text style={styles.formLabel}>Status</Text>
                <TouchableOpacity style={styles.formPicker} onPress={() => setPickerOpen(pickerOpen === 'status' ? null : 'status')}>
                  <Text style={styles.formPickerText}>{(PERMIT_STATUS_INFO[form.status]?.label) ?? form.status}</Text>
                  <ChevronDown size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
                {pickerOpen === 'status' && (
                  <PickerOptions testID="permit-status-options">
                    {PERMIT_STATUSES.map(s => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.pickerRow, form.status === s && styles.pickerRowActive]}
                        onPress={() => { setForm(f => ({ ...f, status: s })); setPickerOpen(null); }}
                      >
                        <Text style={[styles.pickerRowText, form.status === s && styles.pickerRowTextActive]}>{PERMIT_STATUS_INFO[s]?.label ?? s}</Text>
                      </TouchableOpacity>
                    ))}
                  </PickerOptions>
                )}

                <Text style={styles.formLabel}>Permit Number</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.permitNumber}
                  onChangeText={t => setForm(f => ({ ...f, permitNumber: t }))}
                  placeholder="e.g. BP-2026-04521"
                  placeholderTextColor={themeColors.textMuted}
                />

                <Text style={styles.formLabel}>Jurisdiction *</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.jurisdiction}
                  onChangeText={t => setForm(f => ({ ...f, jurisdiction: t }))}
                  placeholder="City of Phoenix, AZ"
                  placeholderTextColor={themeColors.textMuted}
                />

                <Text style={styles.formLabel}>Phase Tag</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.phase}
                  onChangeText={t => setForm(f => ({ ...f, phase: t }))}
                  placeholder="e.g. Foundation, Rough-in, Final"
                  placeholderTextColor={themeColors.textMuted}
                />

                <View style={styles.formRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Applied Date</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('appliedDate'); }}
                      testID="permit-applied-date"
                    >
                      <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !form.appliedDate && { color: themeColors.textMuted }]}>
                        {form.appliedDate ? formatDateLabel(form.appliedDate) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formLabel}>Inspection Date</Text>
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('inspectionDate'); }}
                      testID="permit-inspection-date"
                    >
                      <CalendarDays size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !form.inspectionDate && { color: themeColors.textMuted }]}>
                        {form.inspectionDate ? formatDateLabel(form.inspectionDate) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.formLabel}>Fee ($)</Text>
                <TextInput
                  style={styles.formInput}
                  value={form.fee}
                  onChangeText={t => setForm(f => ({ ...f, fee: t.replace(/[^0-9.]/g, '') }))}
                  placeholder="0.00"
                  keyboardType="decimal-pad"
                  placeholderTextColor={themeColors.textMuted}
                />

                <Text style={styles.formLabel}>Inspection Notes</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={form.inspectionNotes}
                  onChangeText={t => setForm(f => ({ ...f, inspectionNotes: t }))}
                  placeholder="Any inspector notes / required corrections"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                {/* ── Inspection history ──────────────────────────────────
                    A job runs 8-15 of these. The single date + notes above
                    describe the CURRENT one and are folded into this list on
                    save, so booking the next inspection can no longer erase
                    the last one's result or its correction note. */}
                <View style={styles.historyHeader}>
                  <Text style={styles.formLabel}>Inspection history</Text>
                  <TouchableOpacity
                    onPress={() => setLogOpen(v => !v)}
                    style={styles.historyAddBtn}
                    accessibilityRole="button"
                    accessibilityLabel={logOpen ? 'Close inspection form' : 'Log an inspection'}
                    testID="permit-log-inspection"
                  >
                    <Plus size={14} color={themeColors.accentLabel} strokeWidth={1.75} />
                    <Text style={styles.historyAddText}>{logOpen ? 'Close' : 'Log one'}</Text>
                  </TouchableOpacity>
                </View>

                {inspections.length === 0 && !logOpen ? (
                  <Text style={styles.historyEmpty}>
                    Nothing recorded yet. Saving with a status of scheduled, passed or failed files the inspection above into this list.
                  </Text>
                ) : null}

                {inspections.map(row => (
                  <View key={row.id} style={styles.historyRow}>
                    <View style={styles.historyRowTop}>
                      <Text style={styles.historyRowName} numberOfLines={1}>{row.name}</Text>
                      <View style={[styles.historyChip, { backgroundColor: inspectionResultFill(themeColors, row.result).bg }]}>
                        <Text style={[styles.historyChipText, { color: inspectionResultFill(themeColors, row.result).fg }]}>
                          {INSPECTION_RESULT_LABELS[row.result]}
                        </Text>
                      </View>
                      <TouchableOpacity
                        onPress={() => removeLoggedInspection(row.id)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove the ${row.name} inspection`}
                      >
                        <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    </View>
                    <Text style={styles.historyRowDay}>
                      {formatCalendarDay(row.scheduledFor, { weekday: 'short', month: 'short', day: 'numeric' })}
                      {row.inspectorName ? ` — ${row.inspectorName}` : ''}
                    </Text>
                    {row.notes ? <Text style={styles.historyRowNotes}>{row.notes}</Text> : null}
                  </View>
                ))}

                {logOpen ? (
                  <View style={styles.historyDraft}>
                    <TextInput
                      style={styles.formInput}
                      value={logDraft.name}
                      onChangeText={t => setLogDraft(d => ({ ...d, name: t }))}
                      placeholder="What was inspected — e.g. Rough electrical"
                      placeholderTextColor={themeColors.textMuted}
                    />
                    <TouchableOpacity
                      style={styles.formPicker}
                      onPress={() => { setPickerOpen(null); setDateField('logInspection'); }}
                      accessibilityRole="button"
                      accessibilityLabel="Pick the inspection date"
                    >
                      <CalendarDays size={16} color={themeColors.textSecondary} strokeWidth={1.75} />
                      <Text style={[styles.formPickerText, { marginLeft: 8 }, !logDraft.scheduledFor && { color: themeColors.textMuted }]}>
                        {logDraft.scheduledFor ? formatDateLabel(logDraft.scheduledFor) : 'Pick a date'}
                      </Text>
                    </TouchableOpacity>
                    <View style={styles.historyResultRow}>
                      {(Object.keys(INSPECTION_RESULT_LABELS) as PermitInspectionResult[]).map(r => (
                        <TouchableOpacity
                          key={r}
                          style={[styles.historyResultBtn, logDraft.result === r ? styles.historyResultBtnOn : null]}
                          onPress={() => setLogDraft(d => ({ ...d, result: r }))}
                          accessibilityRole="button"
                          accessibilityState={{ selected: logDraft.result === r }}
                          accessibilityLabel={INSPECTION_RESULT_LABELS[r]}
                        >
                          <Text style={[styles.historyResultText, logDraft.result === r ? styles.historyResultTextOn : null]}>
                            {INSPECTION_RESULT_LABELS[r]}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TextInput
                      style={[styles.formInput, { minHeight: 60, textAlignVertical: 'top' }]}
                      value={logDraft.notes}
                      onChangeText={t => setLogDraft(d => ({ ...d, notes: t }))}
                      placeholder={logDraft.result === 'failed' ? 'What has to be corrected before re-inspection' : 'Anything the inspector said'}
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                    />
                    <TouchableOpacity
                      style={[styles.historySaveBtn, !logDraft.scheduledFor ? styles.historySaveBtnOff : null]}
                      onPress={addLoggedInspection}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      testID="permit-add-inspection"
                    >
                      <Text style={styles.historySaveBtnText}>
                        {logDraft.scheduledFor ? 'Add to history' : 'Pick a date to add it'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : null}

                <Text style={styles.formLabel}>General Notes</Text>
                <TextInput
                  style={[styles.formInput, { minHeight: 70, textAlignVertical: 'top' }]}
                  value={form.notes}
                  onChangeText={t => setForm(f => ({ ...f, notes: t }))}
                  placeholder="Internal notes (not on the permit itself)"
                  placeholderTextColor={themeColors.textMuted}
                  multiline
                />

                <Text style={styles.formLabel}>Permit Document</Text>
                <View style={styles.attachRowBtns}>
                  <TouchableOpacity style={styles.attachBtn} onPress={() => { void handleAttach('camera'); }} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Photograph the permit" testID="permit-attach-camera">
                    <Camera size={16} color={themeColors.accentLabel} strokeWidth={1.75} />
                    <Text style={styles.attachBtnText}>
                      {form.attachmentUri ? 'Re-shoot' : 'Photograph it'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.attachBtn} onPress={() => { void handleAttach('library'); }} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Attach a permit scan from the library" testID="permit-attach-library">
                    <FileText size={16} color={themeColors.accentLabel} strokeWidth={1.75} />
                    <Text style={styles.attachBtnText}>From library</Text>
                  </TouchableOpacity>
                </View>
                {/* The raw value used to be printed here — a `file://` path,
                    which told the GC nothing and was the bug. Say what it IS,
                    and say plainly when it is device-local. */}
                {/* What you just attached, at a size you can judge in daylight.
                    Only the local original is shown: the bucket copy may still
                    be queued, and signing a path whose bytes have not landed
                    yet would render an empty frame. */}
                <PhotoThumbGrid uris={attachmentPreview ? [attachmentPreview] : []} size={96} testIDPrefix="permit-scan" />
                {form.attachmentUri ? (
                  <Text style={styles.attachHint} numberOfLines={2}>
                    {isDeviceLocalUri(form.attachmentUri)
                      ? 'Scan attached — stored on this device only. Sign in to have it upload.'
                      : 'Scan attached. It uploads on its own as soon as you have signal.'}
                  </Text>
                ) : null}
              </ScrollView>

              <View style={styles.formActions}>
                {editingPermit && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete} accessibilityRole="button" accessibilityLabel="Delete"><Trash2 size={16} color={themeColors.danger} strokeWidth={1.75} /></TouchableOpacity>
                )}
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave} testID="permit-save-btn">
                  <Save size={16} color="#fff" strokeWidth={1.75} />
                  <Text style={styles.saveBtnText}>{editingPermit ? 'Update' : 'Create Permit'}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Shared date picker for the permit form's three date fields. Applied
          + last-report dates are "today or earlier"; the inspection date can
          be scheduled in the future (it drives the countdown hero), so we
          allow future picks only for that field. */}
      <DatePickerModal
        visible={dateField !== null}
        // UX-F4: the form holds bare calendar days; the picker parses its
        // `value` with new Date(), so hand it LOCAL midnight as an instant or
        // it opens on the previous day west of Greenwich.
        value={
          dateField === 'logInspection'
            ? (parseCalendarDay(logDraft.scheduledFor)?.toISOString() ?? '')
            : dateField ? (parseCalendarDay(form[dateField])?.toISOString() ?? '') : ''
        }
        // A logged inspection can be either — the booked re-inspection is next
        // Thursday, the footing that failed was three weeks ago.
        allowFuture={dateField === 'inspectionDate' || dateField === 'logInspection'}
        title={
          dateField === 'appliedDate' ? 'Applied date'
          : dateField === 'inspectionDate' ? 'Inspection date'
          : dateField === 'logInspection' ? 'When was it called?'
          : 'Last report date'
        }
        onClose={() => setDateField(null)}
        onChange={(iso) => {
          const field = dateField;
          // DatePickerModal emits noon-UTC of the picked day, so the date part
          // IS the picked calendar day in every timezone.
          if (field === 'logInspection') setLogDraft(d => ({ ...d, scheduledFor: iso.slice(0, 10) }));
          else if (field) setForm(f => ({ ...f, [field]: iso.slice(0, 10) }));
        }}
      />
    </View>
  );
}

/**
 * Fill + foreground for an inspection-result chip.
 *
 * Soft fill with the SATURATED-label foreground in every case, never white on
 * the brand orange (#FF6A1A behind white is 2.87:1 and fails AA). `dangerLabel`
 * / `accentLabel` are the tokens that exist precisely so coloured text on a
 * light wash clears the ratio.
 */
function inspectionResultFill(t: ThemeColors, result: PermitInspectionResult): { bg: string; fg: string } {
  switch (result) {
    case 'passed': return { bg: t.successSoft, fg: t.success };
    case 'failed': return { bg: t.dangerSoft, fg: t.dangerLabel };
    case 'cancelled': return { bg: t.surfaceAlt, fg: t.textSecondary };
    case 'scheduled': return { bg: t.accentSoft, fg: t.accentLabel };
  }
}

// Formats a stored date (either a 'YYYY-MM-DD' slice or a full ISO string)
// into a short, human label for the permit date-picker buttons.
function formatDateLabel(value: string): string {
  // UX-F4: a calendar day, not an instant — unparseable input echoes back.
  return formatCalendarDay(value);
}

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: t.bg },
  // ── Next-inspection hero ──
  nextInspectionCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.panel,
    padding: 16,
    borderWidth: 1.5,
    borderColor: '#6A1B9A' + '30',
    shadowColor: '#6A1B9A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  nextInspectionUrgent: {
    borderColor: '#C62828' + '40',
    shadowColor: '#C62828',
    shadowOpacity: 0.12,
  },
  nextInspectionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    flexWrap: 'wrap',
    gap: 6,
  },
  nextInspectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Tokens.radius.full,
  },
  nextInspectionBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '800' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
  nextInspectionDate: {
    fontSize: Type.caption1.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },
  nextInspectionType: {
    fontSize: Type.title2.fontSize,
    fontWeight: '800' as const,
    color: t.text,
    letterSpacing: -0.4,
    marginBottom: 4,
  },
  nextInspectionProject: {
    fontSize: Type.footnote.fontSize,
    color: t.textSecondary,
    fontWeight: '600' as const,
  },
  nextInspectionPermitNum: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    fontWeight: '600' as const,
    marginTop: 4,
    fontVariant: ['tabular-nums'],
  },
  // ── Blockers (failed/denied) ──
  blockersCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: t.dangerSoft,
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.dangerLabel + '30',
    gap: 8,
  },
  blockersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  blockersTitle: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '800' as const,
    color: t.dangerLabel,
    letterSpacing: 0.3,
    textTransform: 'uppercase' as const,
  },
  blockerRow: {
    // t.surface, NOT white — in dark theme a white row under t.text (cream)
    // rendered the blocked-permit names at ~1.08:1 (invisible).
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  blockerName: {
    flex: 1,
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: t.text,
  },
  blockerStatus: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: t.dangerLabel,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
    paddingTop: 16,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.card,
    padding: 12,
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: t.line,
  },
  statIconWrap: { width: 30, height: 30, borderRadius: Tokens.radius.sm, alignItems: 'center', justifyContent: 'center' },
  statValue: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  statLabel: { fontSize: Type.caption2.fontSize, color: t.textSecondary },
  feeCard: {
    marginHorizontal: 16,
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.lg,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: t.line,
  },
  feeLabel: { fontSize: Type.bodyCompact.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  feeValue: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: t.text },
  filterRow: { paddingHorizontal: 16, gap: 8, paddingBottom: 16 },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: t.surface,
    borderWidth: 1,
    borderColor: t.line,
  },
  filterChipActive: { backgroundColor: t.accentFill, borderColor: t.accent },
  filterChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  filterChipTextActive: { color: '#fff' },
  listSection: { paddingHorizontal: 16 },
  permitCard: {
    marginBottom: 10,
    borderRadius: Tokens.radius.lg,
    backgroundColor: t.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  permitCardInner: { padding: 14, gap: 4 },
  permitName: { fontSize: Type.headline.fontSize, fontWeight: '700' as const, color: t.text, marginBottom: 2 },
  permitHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  permitTypeDot: { width: 8, height: 8, borderRadius: 4 },
  permitType: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: t.textSecondary, flex: 1 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Tokens.radius.sm },
  statusBadgeText: { fontSize: Type.caption2.fontSize, fontWeight: '600' as const },
  permitNumber: { fontSize: Type.footnote.fontSize, fontWeight: '500' as const, color: t.textMuted },
  permitProject: { fontSize: Type.subhead.fontSize, fontWeight: '600' as const, color: t.text },
  permitJurisdiction: { fontSize: Type.footnote.fontSize, color: t.textSecondary },
  // Italic + muted: an absent fact, visibly not a value. Never styled like a
  // real jurisdiction, and never blank.
  permitJurisdictionUnset: { fontSize: Type.footnote.fontSize, color: t.textMuted, fontStyle: 'italic' as const },
  // IBC Ch.17 category chip — sits between permit number and project name
  // on Special Inspection cards. Color tied to PERMIT_TYPE_INFO.special_inspection.
  specialCategoryChip: {
    alignSelf: 'flex-start' as const,
    backgroundColor: '#3949AB' + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
    marginTop: 4,
  },
  specialCategoryText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: '#3949AB',
    letterSpacing: 0.2,
  },
  specialInspectorLine: {
    fontSize: Type.caption2.fontSize,
    color: t.textMuted,
    marginTop: 2,
    fontStyle: 'italic' as const,
  },
  phaseTag: {
    alignSelf: 'flex-start',
    backgroundColor: t.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: Tokens.radius.xs,
    marginTop: 4,
  },
  phaseTagText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const, color: t.textSecondary, letterSpacing: 0.4 },
  inspectionAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3E5F5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  inspectionAlertText: { fontSize: Type.caption1.fontSize, fontWeight: '500' as const, color: Colors.purple },
  failedAlert: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: t.dangerSoft,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Tokens.radius.sm,
    marginTop: 4,
  },
  failedAlertText: { fontSize: Type.caption1.fontSize, color: t.dangerLabel, flex: 1 },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  attachText: { fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '500' as const },
  permitFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 },
  permitFee: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.text },
  permitDate: { fontSize: Type.caption1.fontSize, color: t.textMuted },
  emptyState: { alignItems: 'center', paddingVertical: 56, gap: 8 },
  emptyTitle: { fontSize: Type.body.fontSize, fontWeight: '600' as const, color: t.text },
  emptySub: { fontSize: Type.footnote.fontSize, color: t.textSecondary, textAlign: 'center', paddingHorizontal: 40, lineHeight: 18 },
  emptyCta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 12,
    paddingHorizontal: 18, paddingVertical: 10, borderRadius: Tokens.radius.full,
    backgroundColor: t.accentFill,
  },
  emptyCtaText: { color: '#fff', fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize },

  modalOverlay: { flex: 1, backgroundColor: '#00000080', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: t.bg,
    borderTopLeftRadius: 22, borderTopRightRadius: 22,
    paddingHorizontal: 16, paddingBottom: 24,
    // Lets the card shrink when KeyboardAvoidingView squeezes the overlay
    // below `maxSheetHeight`. Without it a bottom sheet taller than its
    // container overflows off the TOP, which is what hid the header.
    flexShrink: 1,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12 },
  modalTitle: { fontSize: Type.subheadline.fontSize, fontWeight: '700' as const, color: t.text },
  formLabel: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: t.textSecondary, marginTop: 12, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  formInput: {
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 10,
    color: t.text, fontSize: Type.subhead.fontSize,
    borderWidth: 1, borderColor: t.line,
  },
  formRow: { flexDirection: 'row', gap: 10 },
  formPicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: t.surface,
    borderRadius: Tokens.radius.md,
    paddingHorizontal: 12, paddingVertical: 12,
    borderWidth: 1, borderColor: t.line,
  },
  formPickerText: { fontSize: Type.subhead.fontSize, color: t.text, flex: 1 },
  permitSideBranchBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    alignSelf: 'flex-start', marginBottom: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.full,
    backgroundColor: t.surfaceAlt,
    borderWidth: 1, borderColor: t.dangerLabel,
  },
  permitSideBranchText: {
    fontSize: Type.caption1.fontSize, color: t.dangerLabel, fontWeight: '700' as const,
  },
  // maxHeight only bounds the box — the scrolling comes from <PickerOptions>,
  // which is the ONLY thing this style may be applied to. 220 is ~5.8 rows on
  // purpose: the clipped row is the "there is more" affordance.
  pickerOptions: { backgroundColor: t.surface, borderRadius: Tokens.radius.md, marginTop: 6, borderWidth: 1, borderColor: t.line, maxHeight: 220 },
  pickerRow: { paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.line + '60' },
  pickerRowActive: { backgroundColor: t.accent + '14' },
  pickerRowText: { fontSize: Type.bodyCompact.fontSize, color: t.text },
  pickerRowTextActive: { color: t.accent, fontWeight: '700' as const },
  pickerEmpty: { padding: 14, fontSize: Type.footnote.fontSize, color: t.textMuted, textAlign: 'center' },
  attachRowBtns: { flexDirection: 'row' as const, gap: 8 },
  attachBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center' as const, gap: 8,
    backgroundColor: t.accent + '14',
    borderRadius: Tokens.radius.md,
    minHeight: 44,
    paddingHorizontal: 12, paddingVertical: 12,
  },
  // accentLabel, not accent: this is coloured TEXT on a pale wash, and the raw
  // brand orange is the tone tuned for fills, not for labels.
  attachBtnText: { color: t.accentLabel, fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize },

  // ── Inspection history ────────────────────────────────────────────────
  historyHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const },
  historyAddBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4,
    minHeight: 32, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: t.accentSoft,
  },
  historyAddText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: t.accentLabel },
  historyEmpty: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 6, lineHeight: 17 },
  historyRow: {
    marginTop: 8, padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, gap: 4,
  },
  historyRowTop: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  historyRowName: { flex: 1, fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: t.text },
  historyChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.sm },
  historyChipText: { fontSize: Type.caption2.fontSize, fontWeight: '700' as const },
  historyRowDay: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  historyRowNotes: { fontSize: Type.caption1.fontSize, color: t.text, lineHeight: 18 },
  historyDraft: {
    marginTop: 10, padding: 12, borderRadius: Tokens.radius.md,
    backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line, gap: 8,
  },
  historyResultRow: { flexDirection: 'row' as const, gap: 6, flexWrap: 'wrap' as const },
  historyResultBtn: {
    flexGrow: 1, minHeight: 38, alignItems: 'center' as const, justifyContent: 'center' as const,
    paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: t.surface,
    borderWidth: 1, borderColor: t.line,
  },
  historyResultBtnOn: { backgroundColor: t.accentSoft, borderColor: t.accentLabel },
  historyResultText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: t.textSecondary },
  historyResultTextOn: { color: t.accentLabel, fontWeight: '700' as const },
  // accentFill (#BC440C at 5.29:1) is the ONE accent tone white text may sit
  // on. t.accent behind #fff is 2.87:1.
  historySaveBtn: {
    minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const,
    borderRadius: Tokens.radius.md, backgroundColor: t.accentFill,
  },
  // Disabled, and the label says WHY rather than going grey and silent.
  historySaveBtnOff: { backgroundColor: t.textMuted },
  historySaveBtnText: { color: '#FFFFFF', fontWeight: '700' as const, fontSize: Type.bodyCompact.fontSize },
  attachHint: { fontSize: Type.caption2.fontSize, color: t.textMuted, marginTop: 4, paddingHorizontal: 4 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  saveBtn: {
    flex: 1,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: t.accentFill,
    borderRadius: Tokens.radius.card,
    paddingVertical: 14,
  },
  saveBtnText: { color: '#fff', fontWeight: '700' as const, fontSize: Type.subhead.fontSize },
  deleteBtn: {
    width: 50, height: 50,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.danger + '14',
    borderRadius: Tokens.radius.card,
  },
});
