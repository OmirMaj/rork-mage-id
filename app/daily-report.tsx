import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Platform, KeyboardAvoidingView, Modal, Image, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { useLocalSearchParams, useRouter, Stack, useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  Plus, Trash2, X, Send, Cloud, Wind, Thermometer, Camera, Users,
  HardHat, Package, AlertTriangle, Image as ImageIcon, BookUser, User,
  Home as HomeIcon, RefreshCw, Copy, CheckCircle2,
  CalendarDays, ChevronLeft, Tractor, Wrench, ChartBar, BarChart3, ClipboardList,
  ScanSearch,
  CalendarClock, ChevronDown, Link2, Minus, ShieldAlert, PenLine,
} from 'lucide-react-native';
import { MageAIMark, MageDailyReport } from '@/components/icons';
import { ToolProjectPicker } from '@/components/ToolScreenChrome';
import DatePickerModal from '@/components/DatePickerModal';
import { Colors } from '@/constants/colors';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { ThemeColors } from '@/constants/colors';
import { useResponsiveLayout } from '@/utils/useResponsiveLayout';
import { Button } from '@/components/ui/Button';
import { cardSurface, desktopCta, desktopToggle, useIsDesktopWeb, useSheetFrame, useSheetPrimaryHotkey } from '@/components/ui';
import { usePrimaryAction } from '@/hooks/useHotkeys';
import { DailyReportLog } from '@/components/logs/DailyReportLog';
import { dfrManHours, dfrScreenMode } from '@/utils/dailyReportLog';
import { useSafeBack } from '@/hooks/useSafeBack';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import ContactPickerModal from '@/components/ContactPickerModal';
import { saveDailyReportToProjectFiles, resolveDfrPhotosForDocument, DFR_FILED_PDF_LINK_DAYS } from '@/utils/projectDocuments';
import { buildDFRHtml, dfrPrintablePhotoSplit, generateDFRPDF } from '@/utils/pdfGenerator';
import { openPrintWindowAfterOrThrow } from '@/utils/platformFile';
import { FolderOpen, FileSignature, ChevronRight } from 'lucide-react-native';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { sendEmail, buildDailyReportEmailHtml } from '@/utils/emailService';
import { useTierAccess } from '@/hooks/useTierAccess';
import VoiceRecorder from '@/components/VoiceRecorder';
// Learn-by-doing tutorials (utils/tutorial): the coach spotlights REAL
// controls through these wrappers and advances only on the signals this
// screen emits at its real success points. Idle cost: a View and a Map write.
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { TutorialScrollAnchor } from '@/components/tutorial/TutorialScrollAnchor';
import { TutorialOfferChip } from '@/components/tutorial/TutorialOfferChip';
import { tutorialSignal, useTutorialAssist, useTutorialSandboxId, useTutorialStepActive } from '@/utils/tutorial/store';
import { DFR_SAMPLE_NOTE, SAMPLE_NO_CREDITS_LABEL } from '@/utils/tutorial/fixtures';
import { sampleSendAllowed, sampleSendPlan } from '@/utils/sampleGuard';
import { parseDFRFromTranscript } from '@/utils/voiceDFRParser';
import AIDailyReportGen from '@/components/AIDailyReportGen';
import AIDFRFromPhotos from '@/components/AIDFRFromPhotos';
import type { ManpowerEntry, DFRPhoto, DailyFieldReport, DFRWeather, IncidentReport, IncidentSeverity, DFRWorkProgress, LeakScanRecord, SafetyIncident, ScheduleTask } from '@/types';
import { PHASE_COLORS, buildScheduleFromTasks } from '@/utils/scheduleEngine';
import { scheduleDayNumberFor } from '@/utils/scheduleOps';
import { parseCalendarDay, calendarDayOf, daysUntilCalendarDay, formatCalendarDay, todayCalendarDay, dayOrInstantDate } from '@/utils/calendarDate';
import { stampPhotoLocation } from '@/utils/photoGeoStamp';
import { burstSummary, captureBurst, pickPhotoBatch } from '@/components/PhotoCapture';
import type { DailyReportGenResult } from '@/utils/aiService';
import { generateHomeownerSummary } from '@/utils/aiService';
import { nailIt, oops } from '@/components/animations/NailItToast';
import { Type } from '@/constants/typography';
import { Layout, Tokens } from '@/constants/designTokens';
import { generateUUID } from '@/utils/generateId';
import { PortalStatusPill } from '@/components/PortalStatusPill';
import { SendToClientButton } from '@/components/SendToClientButton';
import { checkAILimit, recordAIUsage, type LimitCheck } from '@/utils/aiRateLimiter';
import UpgradeSheet from '@/components/UpgradeSheet';
import { buildCostDatabase } from '@/utils/costDatabase';
import { buildScopeSummary } from '@/utils/profitLeak/scopeSummary';
import { buildLeakPrompt, coerceLeakResult, hashLeakText, LEAK_SCHEMA_HINT } from '@/utils/profitLeak/leakPrompt';
import { priceLeakItems } from '@/utils/profitLeak/priceLeakItems';
import ScheduleDiffView from '@/components/copilot/ScheduleDiffView';
import type { CopilotContext } from '@/utils/copilot/types';
import type { EditOp } from '@/utils/copilot/scheduleEdit/editOps';
import { interpretScheduleOps, applyEditEffects } from '@/utils/copilot/scheduleEdit/interpretOps';
import { applyToProjectSchedule } from '@/utils/copilot/scheduleEdit/applyToProjectSchedule';
import { runCpm } from '@/utils/cpm';
import { buildDelayPrompt, coerceDelayResult, hashDelayText, DELAY_SCHEMA_HINT, MAX_DELTA_DAYS } from '@/utils/delayScan/delayPrompt';
import { matchTaskByTitle } from '@/utils/delayScan/matchTask';
import { DELAY_APPLIED_STORE_KEY, parseAppliedDelayMap, withAppliedDelay } from '@/utils/delayScan/appliedDelays';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { mageAI } from '@/utils/mageAI';
import { recordPrediction } from '@/utils/brain/predictionLedger';
import { recordDidForYou } from '@/utils/brain/didForYou';
import { showAlert } from '@/utils/alert';
import { useSafety } from '@/contexts/SafetyContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTimeEntries } from '@/contexts/TimeEntriesContext';
import { mergeTimeEntriesMirror } from '@/hooks/useTimeEntries';
import { addClockRowsToRoster, carryForwardManpower, clockCrewForDay, clockCrewSourceLine, clockRosterGapLine, clockRowsMissingFromRoster, liveClockHoursWarning, seedRowIds } from '@/utils/dfrClockCrew';
import { receiptLinesForDay, mergeReceiptLines, carryIssuesText } from '@/utils/deliverySchedule';
import { scheduleWritePathForRole } from '@/utils/fieldScheduleUpdate';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { useProjectAccess } from '@/hooks/useProjectAccess';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { buildPhotoStoragePath, contentTypeForExt, isDeviceLocalUri, photoExtFromUri } from '@/utils/photoUploadCore';
import { queuePhotoUpload } from '@/utils/photoUploadQueue';
import {
  buildSafetyIncidentFromDfr, describeRecordability, hasRestriction, safetyIncidentIdForReport,
  DFR_INCIDENT_TYPE_LABEL, DFR_TREATMENT_LABEL,
  type IncidentClassInput, type IncidentType, type Treatment,
} from '@/utils/safety/osha';
import { isRecordableCase } from '@/utils/safety/oshaLog';
import { useLaborRates } from '@/hooks/useLaborRates';
import {
  backfilledWeatherNotice, canReadLiveWeatherFor, weatherProvenanceLine,
} from '@/utils/weatherService';

function createId(_prefix: string): string {
  return generateUUID();
}

/** One confirm row of the delay scan: the AI's quote + proposal, the user's
 *  confirmed task + days. taskId null = unmatched, user must pick. */
type DelayRow = { quote: string; deltaDays: number; taskId: string | null };

// --- BEGIN appliedDelayRecord ---
// scripts/validate-delay-rfi.ts extracts everything between these sentinels,
// transpiles it and runs the REAL functions. This file is an Expo Router route
// and cannot be imported outside Metro, so the sentinels are the guard's only
// handle on the shipped code — moving or renaming them fails that guard loudly
// rather than silently unpinning the double-apply guard. Same pattern as the
// dfrDraft and carrySourceDayLabel regions above.
//
// DFR-DELAY-RECARRY (screen audit 2026-09-15). The applied-ripple marker used
// to be keyed on the REPORT: `{ [reportId]: hash }`. A delay ripple is a set of
// RELATIVE moves, so applying the same one twice slides the same tasks twice —
// and "Copy from yesterday" copies `issuesAndDelays` verbatim into a report
// whose id is a brand-new UUID. Monday: "inspector no-show, framing pushed 2
// days" → scan → apply → framing moves 2 days, marker stored against Monday's
// id. Tuesday: copy forward, scan the identical sentence, and the guard looks
// up TUESDAY's id, finds nothing, and cheerfully moves framing another 2 days.
// Once per carried-forward day, with no event and no trace except a finish date
// that no longer matches the job — the number he orders materials and schedules
// subs against.
//
// So the key is now (project + text hash): a delay note that has already moved
// THIS project's schedule is recognised wherever it is sitting. The escape
// hatch for a genuinely recurring delay — the same sentence on a real second
// lost day — is the Re-arm control that already exists beside the notice, and
// the notice now names the day the first apply came from so the super can tell
// the two cases apart himself.
//
// The value carries that provenance. AppliedDelayMap (utils/delayScan/
// appliedDelays.ts) is Record<string, string>, so the record travels as JSON in
// the value slot; a legacy bare-hash value simply fails to decode and reads as
// "not applied", which is the safe direction (it offers the ripple again rather
// than silently refusing a real one).

/** What one applied ripple remembers about itself. `deltaDays`/`taskIds` are
 *  here for the delay-register handoff below, which would otherwise have to
 *  re-derive them from rows that handleApplyRipple has already cleared. */
interface AppliedDelayRecord {
  /** hashDelayText of the issues text the applied scan was run on. */
  hash: string;
  /** The report the apply happened on — may not be the report reading it. */
  reportId: string;
  /** That report's date, so the notice can name a day instead of a sentence. */
  reportDate: string;
  /** The largest single slip that was applied, in days. */
  deltaDays: number;
  /** The schedule tasks the applied ops moved. */
  taskIds: string[];
}

/** Store key for one applied ripple. Project-scoped, so the same sentence on
 *  two different jobs is two different delays. */
export function appliedDelayKey(projectId: string, hash: string): string {
  return `${projectId}:${hash}`;
}

export function encodeAppliedDelay(rec: AppliedDelayRecord): string {
  return JSON.stringify(rec);
}

/** Tolerant read. Anything that is not a full record — junk, a legacy bare
 *  hash string, a half-written entry — returns null rather than throwing, and
 *  null means "not applied". */
export function decodeAppliedDelay(value: string | null | undefined): AppliedDelayRecord | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r.hash !== 'string' || !r.hash) return null;
    if (typeof r.reportId !== 'string' || !r.reportId) return null;
    const deltaDays = typeof r.deltaDays === 'number' && Number.isFinite(r.deltaDays) ? r.deltaDays : 0;
    return {
      hash: r.hash,
      reportId: r.reportId,
      reportDate: typeof r.reportDate === 'string' ? r.reportDate : '',
      deltaDays: Math.max(0, Math.round(deltaDays)),
      taskIds: Array.isArray(r.taskIds) ? r.taskIds.filter((t): t is string => typeof t === 'string' && !!t) : [],
    };
  } catch {
    return null;
  }
}

/**
 * The delay CAUSE this report's own text plainly states, or null.
 *
 * The register defaults every event to 'other' and asks. Carrying a cause over
 * is only honest when the super already wrote the word: 'rain, no pour' is
 * weather because he said so, not because MAGE inferred it. Everything else
 * arrives unset and he picks — types/index.ts is explicit that the app may
 * suggest from a cause and may never decide one, and the register shows the
 * picked cause in its own selector before anything is saved.
 */
export function inferDelayCauseFromText(text: string): 'weather' | null {
  return /\b(rain|rained|raining|snow|snowed|storm|storms|stormed|lightning|hail|sleet|ice|iced|icy|frozen|freeze|freezing|wind|winds|windy|weather|downpour|washout)\b/i
    .test(text)
    ? 'weather'
    : null;
}
// --- END appliedDelayRecord ---

/** Photos one DFR can carry. Named because three separate places check it. */
const MAX_DFR_PHOTOS = 10;

/** The weather block a brand-new report starts with. Shared with the draft
 *  baseline below so "untouched" means the same thing in both places. */
const EMPTY_DFR_WEATHER: DFRWeather = { temperature: '', conditions: '', wind: '', isManual: true };

/** Ditto for the incident block. */
const EMPTY_DFR_INCIDENT: IncidentReport = {
  hasIncident: false,
  severity: undefined,
  description: '',
  peopleInvolved: '',
  injuriesReported: false,
  medicalTreatment: false,
  oshaRecordable: false,
  correctiveAction: '',
  reportedBy: '',
};

/**
 * The OSHA determination inputs the DFR never asked for.
 *
 * DFR-OSHA-BRIDGE. The block used to ask the super to self-certify "OSHA
 * recordable" with a checkbox — a determination that turns on days away,
 * restricted duty, loss of consciousness and medical-beyond-first-aid, and the
 * one thing on this screen the app is better placed to answer than he is
 * (utils/safety/osha.ts has been the 1904 classifier all along, unit-tested,
 * two imports away, and unused). These are what that classifier needs.
 *
 * `type` matters more than the four toggles: isOshaRecordable branches on it
 * FIRST, and the DFR's single five-value `severity` cannot supply it — the
 * register's `type` and `severity` are orthogonal and share only the literal
 * 'critical'. Inferring it would quietly mark genuine near-misses as candidate
 * 300 cases.
 *
 * Day counts are held as strings because they are TextInputs; the classifier
 * gets parsed numbers.
 */
interface DfrIncidentClass {
  type: IncidentType;
  treatment: Treatment;
  daysAway: string;
  /** OSHA 300 column L — calendar days on restriction/transfer. Distinct from
   *  the restrictedDuty flag, which only records that a restriction happened. */
  daysRestricted: string;
  restrictedDuty: boolean;
  lostConsciousness: boolean;
  fatality: boolean;
}

const EMPTY_DFR_INCIDENT_CLASS: DfrIncidentClass = {
  type: 'injury',
  treatment: 'none',
  daysAway: '',
  daysRestricted: '',
  restrictedDuty: false,
  lostConsciousness: false,
  fatality: false,
};

// --- BEGIN dfrDraft ---
// scripts/validate-field-capture.ts extracts everything between these
// sentinels, transpiles it and runs the REAL functions. This file is an Expo
// Router route and cannot be imported outside Metro, so the sentinels are the
// guard's only handle on the shipped code — moving or renaming them fails that
// guard loudly rather than silently unpinning the draft. Same pattern as the
// carrySourceDayLabel region below.
//
// WHY A DRAFT EXISTS AT ALL (audit 2026-09-07 "worth doing" #9). Every field on
// this screen lives in component useState, `headerShown` is false, and the back
// chevron was a bare `router.back()`. A super who spends twenty minutes on a
// report in a basement and fat-fingers the chevron — or swipes, since the
// gesture was unguarded too — loses the day with no prompt and no trace. The
// debounced copy below means the worst case is now the last few seconds of
// typing, and it survives the app being killed, not just a mis-tap.

/** The DFR fields a user would be furious to lose. Everything else on the
 *  screen is either derived (totals, day-of-project) or a transient UI mode. */
interface DfrDraftContent {
  reportDate: string;
  weather: DFRWeather;
  manpower: ManpowerEntry[];
  workPerformed: string;
  workProgress: DFRWorkProgress[];
  materialsDelivered: string[];
  issuesAndDelays: string;
  photos: DFRPhoto[];
  incident: IncidentReport;
  /** OPTIONAL so a draft written before DFR-OSHA-BRIDGE shipped still restores
   *  instead of being discarded by the `v` check — an old draft simply has no
   *  determination inputs yet, which is the same as not having answered them. */
  incidentClass?: DfrIncidentClass;
  homeownerSummary: string;
  /** #22: the publish flag is unsaved work too — toggling it and backing out
   *  used to leave nothing on disk and ask nothing. OPTIONAL so a draft
   *  written before it existed still restores (as not published). */
  hsPublished?: boolean;
}

/**
 * A DFR photo with the #87 incident mark. The mark rides on the photo object
 * (the photos column is jsonb and both ProjectContext mappers spread the
 * object through), so it survives the local store and the server round trip.
 * DFRPhoto.incidentPhoto is a pending additive field in types/index.ts; this
 * alias keeps the screen compiling without it.
 */
type DfrPhotoWithFlag = DFRPhoto & { incidentPhoto?: boolean };
function withIncidentMark(p: DFRPhoto, on: boolean): DFRPhoto {
  return Object.assign({}, p, { incidentPhoto: on }) as DFRPhoto;
}
/** app/safety-incidents.tsx's own MAX_INCIDENT_PHOTOS (not exported there). */
const MAX_INCIDENT_PHOTOS = 8;

/** A persisted draft. `v` is checked on read so a future shape change discards
 *  old drafts instead of restoring half a report. */
interface DfrDraft extends DfrDraftContent {
  v: 1;
  savedAt: string;
}

/**
 * Where one report's draft lives.
 *
 * `mageid_` prefix is load-bearing, not decorative: utils/localCacheKeys.ts
 * sweeps local storage BY PREFIX on a tenant switch, so a key under a new
 * prefix would survive sign-out and hand the next contractor on a shared
 * site-office iPad someone else's half-written report. bun run
 * test:storage-hygiene fails the build if this drifts.
 *
 * Scoped by report as well as project because a super can have yesterday's
 * draft open and start today's — two live drafts on one job, and one key would
 * have them overwrite each other. A brand-new report has no id yet, so it uses
 * the project's single 'new' slot.
 */
function dfrDraftKey(projectId: string, reportId: string | null | undefined): string {
  return `mageid_dfr_draft::${projectId}::${reportId ?? 'new'}`;
}

/**
 * A stable string for "what is in this report right now".
 *
 * Explicitly ordered rather than JSON.stringify of the whole object: key order
 * in a spread-built object is an implementation detail, and a signature that
 * changes when a geo-stamp patch reorders a photo's keys would report a report
 * as dirty that nobody touched — which turns the leave-guard into a dialog the
 * user learns to dismiss. Photos compare on id + uri only, so the GPS
 * coordinates landing a few seconds after the shot do not, on their own, count
 * as an edit.
 */
function dfrDraftSignature(c: DfrDraftContent): string {
  return JSON.stringify([
    c.reportDate,
    [c.weather.temperature ?? '', c.weather.conditions ?? '', c.weather.wind ?? ''],
    (c.manpower ?? []).map(m => [m.trade, m.company ?? '', m.headcount, m.hoursWorked]),
    (c.workPerformed ?? '').trim(),
    (c.workProgress ?? []).map(w => [w.taskId, w.pct]),
    c.materialsDelivered ?? [],
    (c.issuesAndDelays ?? '').trim(),
    // The incident-photo mark (#87) is his answer about the photo, so it counts.
    (c.photos ?? []).map(p => [p.id, p.uri, (p as DfrPhotoWithFlag).incidentPhoto ? 1 : 0]),
    [
      c.incident?.hasIncident ?? false,
      c.incident?.severity ?? '',
      (c.incident?.description ?? '').trim(),
      (c.incident?.peopleInvolved ?? '').trim(),
      c.incident?.injuriesReported ?? false,
      c.incident?.medicalTreatment ?? false,
      c.incident?.oshaRecordable ?? false,
      (c.incident?.correctiveAction ?? '').trim(),
      (c.incident?.reportedBy ?? '').trim(),
    ],
    // The OSHA determination inputs are unsaved work like anything else — a
    // super who ticks "lost consciousness" and drops his phone must not get the
    // report back with that answer missing.
    [
      c.incidentClass?.type ?? '',
      c.incidentClass?.treatment ?? '',
      (c.incidentClass?.daysAway ?? '').trim(),
      (c.incidentClass?.daysRestricted ?? '').trim(),
      c.incidentClass?.restrictedDuty ?? false,
      c.incidentClass?.lostConsciousness ?? false,
      c.incidentClass?.fatality ?? false,
    ],
    (c.homeownerSummary ?? '').trim(),
    c.hsPublished ?? false,
  ]);
}

/** True when the form has diverged from what is actually saved. */
function isDfrDirty(current: DfrDraftContent, baselineSignature: string): boolean {
  return dfrDraftSignature(current) !== baselineSignature;
}

/**
 * What the restore prompt says a draft is. Names the clock time when the draft
 * is from today and the calendar day when it is older, because "2 hours ago"
 * on a draft found the next morning is the same class of lie DFR-CARRY-LABEL
 * was: a relative phrase computed from an instant, read as a day.
 */
function dfrDraftAgeLabel(savedAt: string, now: Date): string {
  const t = Date.parse(savedAt);
  if (!Number.isFinite(t)) return 'earlier';
  const then = new Date(t);
  const sameDay = then.getFullYear() === now.getFullYear()
    && then.getMonth() === now.getMonth()
    && then.getDate() === now.getDate();
  return sameDay
    ? `at ${then.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
    : `on ${then.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
// --- END dfrDraft ---

/** How long the form has to go quiet before the draft is written. Long enough
 *  that a sentence of typing is one write, short enough that a dropped phone
 *  costs a few words. */
const DFR_DRAFT_DEBOUNCE_MS = 900;

// --- BEGIN carrySourceDayLabel ---
// scripts/validate-calendar-date.ts extracts everything between these
// sentinels, transpiles it and runs the REAL functions under three timezones.
// This file is an Expo Router route and cannot be imported outside Metro, so
// the sentinels are the guard's only handle on the shipped code — moving or
// renaming them fails that guard loudly rather than silently unpinning the
// day arithmetic. Same pattern as app/sub-portal-setup.tsx.
/** The absolute label for a DFR's day in the CURRENT year — 'Mon, Sep 1'. */
const CARRY_DATE_OPTS: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
/** The same label for a day in any OTHER year — 'Mon, Sep 8, 2025'. */
const CARRY_DATE_OPTS_WITH_YEAR: Intl.DateTimeFormatOptions = { ...CARRY_DATE_OPTS, year: 'numeric' };
/** What the button says when the source report's date is unreadable. Naming no
 *  day at all is honest; naming the wrong one is not. */
const CARRY_UNKNOWN_DAY = 'the last report';

/**
 * Which of the two option sets names `day` unambiguously, given `now`.
 *
 * The bare 'Mon, Sep 8' reads as THIS year, always. A job stalls, the last DFR
 * on it is 2025-09-08, the super reopens the screen on 2026-09-07: without a
 * year the button says "Copy from Mon, Sep 8" for a report that is a year old,
 * and the toast confirms the same wrong day after the copy lands. That is the
 * same defect as DFR-CARRY-LABEL itself — the label naming a day that is not
 * the day — reached by a rarer input. (It predates the fix rather than coming
 * from it: the code this replaced dropped the year too.)
 *
 * The test is the calendar YEAR, not a distance in days. A ">180 days ago"
 * threshold still lets "Fri, Dec 12" mean last December when read in early
 * June, which is the whole failure this is here to prevent; comparing years is
 * exact, and it keeps the short form for every label a working GC actually
 * sees, since a carry-forward source is nearly always days old. Both sides are
 * LOCAL calendar days, so neither can drift into a neighbouring year by
 * timezone.
 */
function carryDateOpts(day: string, now: Date): Intl.DateTimeFormatOptions {
  return day.slice(0, 4) === todayCalendarDay(now).slice(0, 4)
    ? CARRY_DATE_OPTS
    : CARRY_DATE_OPTS_WITH_YEAR;
}

/**
 * DFR-CARRY-LABEL — name the day "Copy from …" actually copies from, in
 * CALENDAR days.
 *
 * This used to be `Math.round((today.getTime() - d.getTime()) / 86400000)`,
 * which measures the gap between two INSTANTS and then calls the answer a
 * number of days. Two ways that lies:
 *   • a report filed at 9 pm and opened at 8 am the next morning is 11 hours
 *     old, rounds to 0, and the button read "Copy from earlier today" — for
 *     yesterday's crew counts and work-performed text;
 *   • a report filed at 8 am reads "yesterday" until 8 am the following day
 *     and "2 days ago" after it, so the same record is named two different
 *     days depending on the hour the super opens the screen.
 * Crossing a DST boundary adds an hour of error on top of that.
 *
 * daysUntilCalendarDay counts whole days on the calendar grid, so the label
 * changes at midnight and only at midnight. DFR.date is a full ISO instant
 * from this screen and a noon-UTC instant from DatePickerModal, but arrives
 * bare 'YYYY-MM-DD' from other writers — calendarDayOf resolves either shape
 * to the local day the report is FOR. A future-dated report (the GC filed
 * tomorrow's) gets its absolute date rather than "-1 days ago".
 */
export function carrySourceDayLabel(dateValue: string | null | undefined, now: Date = new Date()): string {
  const day = calendarDayOf(dateValue);
  if (!day) return CARRY_UNKNOWN_DAY;
  const until = daysUntilCalendarDay(day, now);
  if (until === null) return CARRY_UNKNOWN_DAY;
  const daysAgo = -until;
  if (daysAgo === 0) return 'earlier today';
  if (daysAgo === 1) return 'yesterday';
  if (daysAgo > 1 && daysAgo < 7) return `${daysAgo} days ago`;
  return formatCalendarDay(day, carryDateOpts(day, now)) || CARRY_UNKNOWN_DAY;
}

/** The absolute day a carry-forward came from, for the confirmation toast —
 *  'Mon, Sep 1', or 'Mon, Sep 8, 2025' when that day is not in this year;
 *  never the UTC-shifted `new Date(bareDay)` reading. */
export function carrySourceDayAbsolute(dateValue: string | null | undefined, now: Date = new Date()): string {
  const day = calendarDayOf(dateValue);
  if (!day) return CARRY_UNKNOWN_DAY;
  return formatCalendarDay(day, carryDateOpts(day, now)) || CARRY_UNKNOWN_DAY;
}
// --- END carrySourceDayLabel ---

// >>> dfr-open-gate (pure; scripts/validate-records-open-before-load.ts evaluates this block)
/**
 * What a link naming a daily report should show.
 *
 * Every field of the editor is seeded ONCE, at mount, from the saved report.
 * ProjectContext starts `dailyReports` as [] and fills it a beat later, so a
 * report opened by id before that (a web refresh on /daily-report?reportId=,
 * a cold start from a push) mounted a BLANK form under a "Saved" hero — and
 * Save, Submit or the leave prompt's "Save draft" then wrote that blank form
 * over the day's real record, locally and on the server. So the editor does
 * not mount for a named report until the report list has loaded: 'loading'
 * while it is still arriving, 'missing' once it has loaded without it (a
 * deleted id must say so, never spin forever or fall back to a new report).
 * A URL naming a project waits for the project list for the same reason —
 * before it lands the editor shows the "that project is gone" picker.
 */
export function dfrOpenState(o: {
  reportId: string | null;
  found: boolean;
  reportsLoaded: boolean;
  projectPending: boolean;
}): 'editor' | 'loading' | 'missing' {
  if (o.projectPending) return 'loading';
  if (!o.reportId) return 'editor';
  // `found` must NOT short-circuit the wait. On a cold start ProjectContext's
  // signed-out pass fills dailyReports from this device's cache before the
  // account's rows land, so the report can be "found" as an hours-old copy;
  // the editor seeds once from it, never re-seeds when the server's newer
  // version arrives under the same id, and Save wrote the old copy over it.
  // `reportsLoaded` is keyed by account, so it only turns true once THIS
  // account's read has committed (the read falls back to the device copy when
  // offline, so it always settles).
  if (!o.reportsLoaded) return 'loading';
  return o.found ? 'editor' : 'missing';
}
// <<< dfr-open-gate

// >>> dfr-screen-pure (pure; scripts/validate-dfr-screen-wave3.ts evaluates this block — no imports in here)
/**
 * What the AI generators are told about the weather when none was recorded.
 *
 * #28: both generator call sites used to send `|| 'Clear'`, so a report with no
 * weather told the model it was a clear day, and the draft it wrote said so.
 * An empty weather card is a fact about the record ("nobody wrote it down"),
 * not about the sky. utils/aiService's prompt reads this exact phrase as
 * "unknown — don't describe it".
 */
export const DFR_WEATHER_NOT_RECORDED = 'Not recorded';
export function dfrAiWeatherStr(parts: (string | null | undefined)[]): string {
  const s = parts.map(p => (p ?? '').trim()).filter(Boolean).join(' · ');
  return s || DFR_WEATHER_NOT_RECORDED;
}

/** The divider the schedule generator writes under, so what came from the
 *  schedule is visibly separate from what he typed. */
export const DFR_FROM_SCHEDULE_DIVIDER = '— From schedule —';
/**
 * #28: the schedule "generate report" button REPLACED work performed and
 * issues with '[Completed] …' lines — on a new, unsaved report, with no undo,
 * so two typed paragraphs were gone for good. Now it never replaces: an empty
 * field takes the generated lines; a field with text keeps every character he
 * typed and gets the generated lines appended under a divider. (Skipping a
 * non-empty field instead would make the button do nothing without saying why.)
 */
export function dfrAppendGenerated(typed: string, generated: string): string {
  const gen = (generated ?? '').trim();
  if (!gen) return typed;
  if (!(typed ?? '').trim()) return gen;
  return `${typed.replace(/\s+$/, '')}\n\n${DFR_FROM_SCHEDULE_DIVIDER}\n${gen}`;
}

/**
 * The homeowner-update publish control, stated against what is SAVED.
 *
 * #22: tapping "Publish to portal" flipped local state only — the pill read
 * PUBLISHED and the button "Showing in portal" while nothing was written, and
 * backing out asked nothing. The flag is now unsaved work like any field (see
 * dfrDraftSignature), and this names the pending change in both directions:
 * unpublishing is where the homeowner keeps reading something the GC thinks
 * he pulled.
 */
export function dfrPublishControl(saved: boolean, local: boolean): {
  label: string; pill: boolean; pending: 'publish' | 'remove' | null;
} {
  if (saved && local) return { label: 'Published — tap to take it down', pill: true, pending: null };
  if (!saved && local) return { label: 'Publishes when you save', pill: false, pending: 'publish' };
  // The homeowner still sees it until the save lands, so the pill stays.
  if (saved && !local) return { label: 'Removed when you save', pill: true, pending: 'remove' };
  return { label: 'Publish to portal', pill: false, pending: null };
}

/**
 * The owner test every seat rule on this screen uses, offline-safe: the
 * loader's ownerUserId stamp first (it survives an offline launch), then the
 * collaborator read's role. Same rule as change-order.tsx's coOwnedLocally.
 */
export function dfrIsProjectOwner(ownerUserId: string | null | undefined, userId: string | null | undefined, role: string | null | undefined): boolean {
  if (ownerUserId && userId && ownerUserId === userId) return true;
  return role === 'owner';
}

/** #41 (founder decision pending — interim): only the project owner writes
 *  change orders. */
export const DFR_GC_CREATES_COS = 'Your GC creates change orders \u2014 this goes to them as a field issue in this report.';
export const DFR_OWNER_DECIDES_HOMEOWNER = 'The project owner decides what the homeowner sees.';
/**
 * #116 (founder decision pending — interim): only the owner or an editor may
 * publish a homeowner update or send this report to the client portal. Field
 * and viewer seats see the controls disabled with the reason. The server
 * enforces the same tier (migration 20260919140000, daily_reports_portal_owner).
 * `role` is the live collaborator read, `myRole` the loader's stamp (kept
 * offline); a collaborator whose role is still unknown is held, not let through.
 */
export function dfrPublishAccess(o: {
  ownerUserId?: string | null; userId?: string | null; role?: string | null; myRole?: string | null; roleLoading?: boolean;
}): { allowed: boolean; reason: string | null } {
  if (dfrIsProjectOwner(o.ownerUserId, o.userId, o.role)) return { allowed: true, reason: null };
  const r = o.role ?? o.myRole ?? null;
  if (r === 'editor') return { allowed: true, reason: null };
  if (r === 'field' || r === 'viewer') return { allowed: false, reason: DFR_OWNER_DECIDES_HOMEOWNER };
  // No stamp on either side: an owned project from a cache that predates the
  // ownerUserId stamp — the owner's own job.
  if (!o.ownerUserId && !o.myRole && !o.roleLoading) return { allowed: true, reason: null };
  return { allowed: false, reason: o.roleLoading ? 'Checking your role on this job…' : DFR_OWNER_DECIDES_HOMEOWNER };
}

/**
 * #114: another report already on this calendar day. Several reports a day are
 * legitimate (one per crew or shift), so the screen offers — never redirects.
 * Days compare through the caller's calendarDayOf on BOTH sides: reportDate is
 * an ISO instant and a raw prefix names tomorrow after ~5-8 pm in the US.
 */
export function dfrSameDayReports<T extends { id: string; date: string }>(
  reports: T[], day: string | null, excludeId: string | null, dayOf: (v: string) => string | null,
): T[] {
  if (!day) return [];
  return reports.filter(r => r.id !== excludeId && dayOf(r.date) === day);
}

/**
 * #87: which DFR photos go on the incident, and as what.
 *
 * Only photos he marked as incident photos — a delivery or progress shot is not
 * injury evidence. Each resolves to a DURABLE value: the storage path it
 * already has, else the path staging gives it (deterministic per photo id, the
 * same object the report's own staging uploads), else — signed out, no cloud —
 * the device URI, which is what SafetyContext keeps locally anyway. Capped at
 * the incident form's own limit.
 */
export function dfrIncidentPhotoUrls(
  photos: { id: string; uri: string; storagePath?: string; incidentPhoto?: boolean }[],
  stage: (p: { id: string; uri: string }) => string | null,
  cap: number,
): string[] {
  const out: string[] = [];
  for (const p of photos) {
    if (!p.incidentPhoto) continue;
    const v = p.storagePath || stage(p) || p.uri;
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * #115: a homeowner summary names the day it was written for. After a re-date
 * that day is wrong, so the summary is flagged stale and can't be published
 * until it is re-generated or edited.
 */
export function dfrSummaryIsStale(summary: string, writtenForDay: string | null, reportDay: string | null): boolean {
  return !!summary.trim() && !!writtenForDay && !!reportDay && writtenForDay !== reportDay;
}

/** #82: where an incident filed from this report ends up, said truthfully to
 *  a collaborator — his report is not "your safety record" and he does not
 *  keep the OSHA 300 (migration 20260919130000: he and the owner see it). */
export function dfrIncidentFileNote(isOwner: boolean): string {
  return isOwner
    ? 'Saving this report files it on the safety record too, so it reaches the OSHA 300 without you typing it a second time.'
    : 'Filed with this report. Only you and the job’s owner can see it; the owner keeps the OSHA 300.';
}
// <<< dfr-screen-pure

// >>> dfr-document-pure (pure; scripts/validate-dfr-document-wave3.ts evaluates this block — no imports in here)
/** Why the project-files switch is off on web (#27). Kept word-for-word with
 *  utils/projectDocuments.PROJECT_FILES_NEEDS_APP; the validator pins both. */
export const DFR_FILES_NEEDS_APP = 'Saving a PDF to project files needs the mobile app — use Print to keep a copy.';

/**
 * #27: the project-files copy needs PDF BYTES, and on web expo-print has none
 * to give (its web module is `window.print()` and returns undefined). The
 * switch used to default ON everywhere, so every web Submit either failed to
 * file or popped a print tab plus a failure alert. Web starts it off and
 * disabled; the send path ignores it there regardless of state.
 */
export function dfrProjectFilesAvailable(os: string): boolean {
  return os !== 'web';
}

/** What a tap on Send will do, decided before anything is written. */
export function dfrSendPlan(o: { email: string; saveToggle: boolean; os: string }): {
  wantsEmail: boolean;
  fileCopy: boolean;
  blocker: { title: string; message: string } | null;
} {
  const wantsEmail = o.email.trim().length > 0;
  const filesAvailable = dfrProjectFilesAvailable(o.os);
  const fileCopy = filesAvailable && o.saveToggle;
  if (!wantsEmail && !fileCopy) {
    return {
      wantsEmail, fileCopy,
      blocker: filesAvailable
        ? { title: 'Pick a destination', message: 'Enter a recipient email, turn on "Save copy to project files", or both.' }
        : { title: 'Enter an email', message: 'Saving a PDF to project files needs the mobile app, so on the web a report goes out by email. Enter a recipient, or use Print to keep a copy.' },
    };
  }
  return { wantsEmail, fileCopy, blocker: null };
}

/**
 * Whether the report may be stamped 'sent'. Only on something that actually
 * left the device: the email when he asked for one (a filed copy alone is not
 * the delivery he asked for), otherwise the project-files upload.
 */
export function dfrDelivered(o: { wantsEmail: boolean; emailSent: boolean; fileSaved: boolean }): boolean {
  return o.wantsEmail ? o.emailSent : o.fileSaved;
}

/**
 * #25 — what tapping a DFR photo does. The annotator draws on the GALLERY copy
 * of a photo, found by id, and the report mirrors each photo into the gallery
 * under the SAME id when it saves. Before that first save there is nothing for
 * the annotator to open (it would say "this photo isn't on this device"), so
 * the tap says why instead of opening a dead screen.
 */
export const DFR_SENT_MARKUP_NOTE =
  'Markup you draw now changes the project copy of this photo, not the report that went out. A re-print of this report would show it.';
export function dfrPhotoMarkupTarget(o: { photoId: string; galleryIds: readonly string[]; reportSent?: boolean }):
  { action: 'annotate'; photoId: string; lockedNote?: string } | { action: 'blocked'; reason: string } {
  if (!o.galleryIds.includes(o.photoId)) {
    return { action: 'blocked', reason: 'Save the report first. Markup is drawn on the project copy of this photo, which saving the report creates.' };
  }
  return o.reportSent
    ? { action: 'annotate', photoId: o.photoId, lockedNote: DFR_SENT_MARKUP_NOTE }
    : { action: 'annotate', photoId: o.photoId };
}
// <<< dfr-document-pure

// >>> dfr-w4-pure (pure; scripts/validate-w4-dfr-fixes.ts evaluates this block — no imports in here)
/**
 * #59/#133 (founder decision pending — this is the interim he was offered): a
 * field or viewer seat's report, and the photos it mirrors into the gallery,
 * land as a DRAFT the GC reviews — whatever the owner's auto-share says. The
 * server forces the same (migration 20260920140000); passing it here keeps
 * the foreman's own copy and the offline-queued insert agreeing with the
 * server, so his phone never shows "Shared" for a row the server holds back.
 * A publisher (owner / editor) gets undefined → the context's auto-share
 * default, exactly as before.
 */
export function dfrNewPortalState(canPublish: boolean): { status: 'draft' } | undefined {
  return canPublish ? undefined : { status: 'draft' };
}

/**
 * #65 (CONTRACT 18) — the capture-time GPS stamp a DFR photo carries, in the
 * gallery's shape. Empty when the photo was never stamped (no permission, no
 * fix in time), so the mirror never writes a guessed location. Exported so the
 * join validator can check the mapping without mounting the screen.
 */
export function dfrPhotoGeo(p: Pick<DFRPhoto, 'latitude' | 'longitude' | 'locationAccuracyMeters' | 'locationLabel'>): {
  latitude?: number; longitude?: number; locationAccuracyMeters?: number; locationLabel?: string;
} {
  if (p.latitude == null || p.longitude == null) return {};
  return {
    latitude: p.latitude,
    longitude: p.longitude,
    ...(p.locationAccuracyMeters != null ? { locationAccuracyMeters: p.locationAccuracyMeters } : {}),
    ...(p.locationLabel ? { locationLabel: p.locationLabel } : {}),
  };
}

/**
 * #17/#59 — what a field or viewer seat is told about the homeowner. Every
 * branch is what is true for HIS row: a job with no portal says so; a row
 * the GC already shared says so; anything else waits on the GC. Null for a
 * publisher (his SendToClientButton states it).
 */
export function dfrPortalSeatNote(o: { canPublish: boolean; portalEnabled: boolean; status?: string | null; isNew: boolean }): string | null {
  if (o.canPublish) return null;
  if (!o.portalEnabled) return 'This job has no homeowner portal, so nothing in this report reaches the homeowner.';
  if (!o.isNew && o.status === 'sent') return 'Shared in the homeowner’s portal by your GC. The project owner decides what the homeowner sees.';
  return 'Your GC reviews this report and its photos before anything reaches the homeowner.';
}

/**
 * #63 — who filed a report, said only from what this device knows. The id
 * comes off the row (daily_reports.user_id → filedByUserId). A collaborator
 * sees only his own collaborator row, so the owner is named by role ("the
 * project owner"), a collaborator by the name or invited email the owner's
 * list holds, and anyone else is "a team member" — never a guessed name.
 *   hero       — "Filed by …" on the report (null when it is his own)
 *   banner     — for the same-day banner ("by you" on his own)
 *   document   — the PDF's "Filed by" value
 *   possessive — "<who>'s", for "This case is in <who>'s injury log"
 * No id at all (a row from before the mapping) → all null / neutral.
 */
export function dfrFiledBy(o: {
  filedByUserId?: string | null; viewerId?: string | null; viewerName?: string | null;
  ownerUserId?: string | null; people?: { userId?: string | null; name?: string | null; email?: string | null }[];
}): { hero: string | null; banner: string | null; document: string | null; possessive: string } {
  const id = o.filedByUserId ?? null;
  if (!id) return { hero: null, banner: null, document: null, possessive: 'the report author’s' };
  if (o.viewerId && id === o.viewerId) {
    return { hero: null, banner: 'by you', document: (o.viewerName ?? '').trim() || 'A team member', possessive: 'your' };
  }
  if (o.ownerUserId && id === o.ownerUserId) {
    return { hero: 'Filed by the project owner', banner: 'by the project owner', document: 'The project owner', possessive: 'the project owner’s' };
  }
  const p = (o.people ?? []).find(x => x.userId && x.userId === id);
  const who = (p?.name ?? '').trim() || (p?.email ?? '').trim();
  if (who) return { hero: `Filed by ${who}`, banner: `by ${who}`, document: who, possessive: `${who}’s` };
  return { hero: 'Filed by a team member', banner: 'by a team member', document: 'A team member', possessive: 'the report author’s' };
}

/**
 * #122 (founder decision pending — interim): a foreman re-saving a report
 * someone else wrote cannot see that author's injury case (own-row SELECT on
 * safety_incidents), so the screen used to insert a blank-classified case
 * under the same id — a pkey duplicate the queue counted as success — and
 * his treatment / days-away change vanished while his phone showed it filed.
 * Now: the case is not visible, the report is not his, and he is not the
 * owner → the classification is blocked with this reason and no case is
 * written. The report's own incident fields still save. Null = go ahead.
 *
 * `savedHadIncident`: the case under the derived id is only ever written when
 * a save carried an incident, so if the SAVED report never had one there is
 * no case to collide with — the foreman adding an injury to the GC's clean
 * report classifies and files it as before (his insert is allowed by the
 * safety RLS). Locking there lost the injury from Incidents / OSHA 300 behind
 * false "it's in the GC's log" copy. Left open: the author saved an incident
 * and then unticked it — that case exists; a duplicate insert then falls to
 * the queue's not_visible_conflict drop (sync-queue), not a silent success.
 */
export function dfrCaseNotYoursReason(o: {
  caseVisible: boolean; caseDeleted: boolean; isOwner: boolean; savedHadIncident: boolean;
  filedByUserId?: string | null; viewerId?: string | null; authorPossessive: string;
}): string | null {
  if (o.caseVisible || o.caseDeleted || o.isOwner) return null;
  if (!o.savedHadIncident) return null;
  if (!o.filedByUserId || !o.viewerId || o.filedByUserId === o.viewerId) return null;
  return `This case is in ${o.authorPossessive} injury log — tell the GC. Treatment and days away changed here won’t reach it, so they are locked.`;
}

/**
 * #122 (integration round 1): true while "this report's case is not on this
 * phone" can only mean "the injury log has not loaded yet". Only a SAVED
 * report with an incident can have a case under its derived id, so a new
 * report never waits. While true the classification shows as loading (not
 * locked) and the case write is held (SafetyContext.fileCaseWhenHydrated).
 */
export function dfrCaseLogLoading(o: { incidentsHydrated: boolean; caseVisible: boolean; savedHadIncident: boolean }): boolean {
  return !o.incidentsHydrated && !o.caseVisible && o.savedHadIncident;
}

/** The classification a filed case already holds, as the DFR's builder input. */
export function dfrClassOfCase(c: Pick<SafetyIncident, 'type' | 'treatment' | 'daysAway' | 'daysRestricted' | 'restrictedDuty' | 'lostConsciousness' | 'fatality' | 'oshaIllnessType'>): IncidentClassInput {
  return {
    type: c.type, treatment: c.treatment, daysAway: c.daysAway, daysRestricted: c.daysRestricted,
    restrictedDuty: c.restrictedDuty, lostConsciousness: c.lostConsciousness, fatality: c.fatality,
    ...(c.oshaIllnessType ? { oshaIllnessType: c.oshaIllnessType } : {}),
  };
}

/**
 * #61 — the report "Copy from" offers: the newest report on a calendar day
 * STRICTLY before this report's day. Newest-of-all copied Wednesday's work,
 * sub crews and delay note back into a missed Monday opened from Home. Same-
 * day reports are the same-day banner's business, never a carry source.
 */
export function dfrCopySource<T extends { id: string; date: string }>(
  reports: readonly T[], day: string | null, excludeId: string | null, dayOf: (v: string) => string | null,
): T | undefined {
  if (!day) return undefined;
  let best: { r: T; d: string } | undefined;
  for (const r of reports) {
    if (r.id === excludeId) continue;
    const d = dayOf(r.date);
    if (!d || d >= day) continue;
    // Same day: the later stamp wins (ISO strings of one shape order as text).
    if (!best || d > best.d || (d === best.d && r.date > best.r.date)) best = { r, d };
  }
  return best?.r;
}

/** #61 — the project photos taken on the REPORT's calendar day (they fed the
 *  photo draft and the voice parser from today, whatever day was open). */
export function dfrReportDayPhotos<T extends { timestamp?: string | null }>(
  photos: readonly T[], day: string | null, dayOf: (v: string) => string | null,
): T[] {
  if (!day) return [];
  return photos.filter(p => !!p.timestamp && dayOf(p.timestamp) === day);
}

/**
 * #58 — the homeowner update on a SUBMITTED report is its own decision: an
 * owner or editor can still write, publish or take it down. What "Save
 * update" would change, compared with what is saved.
 */
export function dfrHomeownerUpdateDirty(o: { summary: string; savedSummary?: string | null; published: boolean; savedPublished: boolean }): boolean {
  return o.summary.trim() !== (o.savedSummary ?? '').trim() || o.published !== o.savedPublished;
}

/**
 * #76 — the Draft-CO handoff. The description the CLIENT reads is a neutral
 * scope sentence (no "~$" AI guesses, no quotes from the internal report, no
 * "NEEDS PRICE"); each flagged item is its own line (CONTRACT 9 prefillLines),
 * tagged with where its price came from so the CO screen refuses to send an
 * unpriced line and asks him to confirm an AI estimate.
 */
export function dfrLeakCoPrefill(
  items: readonly { description: string; estimatedPrice?: number | null }[],
  whenLabel: string,
): { prefillDescription: string; prefillLines: string; unpricedCount: number } {
  const lines = items.filter(it => (it.description ?? '').trim()).map(it => {
    const priced = typeof it.estimatedPrice === 'number' && Number.isFinite(it.estimatedPrice) && it.estimatedPrice > 0;
    return {
      name: it.description.trim().slice(0, 120),
      description: '',
      quantity: 1,
      unit: 'ls',
      unitPrice: priced ? Math.round((it.estimatedPrice as number) * 100) / 100 : 0,
      priceSource: priced ? 'ai_estimated' as const : 'needs_price' as const,
    };
  });
  return {
    prefillDescription: `Additional work outside the original scope, observed ${whenLabel}.`,
    prefillLines: JSON.stringify(lines),
    unpricedCount: lines.filter(l => l.priceSource === 'needs_price').length,
  };
}
// <<< dfr-w4-pure

export default function DailyReportScreen() {
  // Safe back, not router.back(): this gate is exactly what a push cold start
  // or a fresh web tab lands on, where there is nothing to pop (UX-F18).
  const goBack = useSafeBack();
  const insets = useSafeAreaInsets();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // `id` is accepted as an alias: the Client Outbox linked here with `?id=`
  // for months, which opened a fresh report for today instead of the one it
  // listed. The outbox now sends `reportId`; the alias stops any other stray
  // `id=` link from silently becoming a new report again.
  const params = useLocalSearchParams<{ projectId?: string; reportId?: string; id?: string; date?: string; fieldIssue?: string; new?: string }>();
  const reportId = params.reportId ?? params.id ?? null;
  const { dailyReports, dailyReportsLoaded, projectsLoaded, retryRemoteReads, sourceFailed, getProject } = useProjects();
  // Desktop WEB only (a native tablet at >= 1024 is isDesktop too, and keeps
  // the editor): a bare ?projectId= opens the job's report LOG — every report
  // filed, the open one read beside it (wave 6c, utils/dailyReportLog).
  const desktopWeb = useIsDesktopWeb();
  const found = useMemo(
    () => (reportId ? dailyReports.find(r => r.id === reportId) ?? null : null),
    [reportId, dailyReports],
  );
  const state = dfrOpenState({
    reportId,
    found: !!found,
    reportsLoaded: dailyReportsLoaded,
    projectPending: !!params.projectId && !projectsLoaded,
  });
  if (state !== 'loading' && dfrScreenMode({
    desktopWeb,
    projectId: params.projectId,
    projectExists: !!(params.projectId && getProject(params.projectId)),
    reportId,
    date: params.date,
    fieldIssue: params.fieldIssue,
    isNew: params.new === '1',
  }) === 'log') {
    return <DailyReportLogRoute projectId={params.projectId!} />;
  }
  if (state === 'editor') {
    // Keyed on the report so the editor re-mounts — and re-seeds every field
    // from the record — if the link changes underneath it. The report's own
    // project wins over the URL's, so a mismatched projectId cannot hide it.
    return <DailyReportInner key={found?.id ?? 'new'} reportId={found?.id} projectIdOverride={found?.projectId} />;
  }
  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg, paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.openGateBody} testID={`dfr-open-${state}`}>
        {state === 'loading' ? (
          <>
            <Text style={styles.openGateText}>Loading this daily report…</Text>
            <Button label="Go back" variant="secondary" onPress={goBack} testID="dfr-open-loading-back" />
          </>
        ) : (
          <>
            <AlertTriangle size={22} color={themeColors.textMuted} strokeWidth={1.75} />
            <Text style={styles.openGateTitle}>This daily report isn&apos;t on this device</Text>
            <Text style={styles.openGateText}>
              {sourceFailed
                ? "MAGE couldn't be reached, so the report may just not have synced yet. Nothing was opened in its place."
                : 'The link names a report that was deleted or hasn\'t synced here. Nothing was opened in its place, so nothing was overwritten.'}
            </Text>
            <Button label="Try again" variant="primary" onPress={retryRemoteReads} testID="dfr-open-retry" />
            <Button label="Go back" variant="secondary" onPress={goBack} testID="dfr-open-back" />
          </>
        )}
      </View>
    </View>
  );
}

/**
 * The log's author column says who filed each report exactly as the editor
 * does (dfrFiledBy `.document`). Desktop web only — mounted by the gate above.
 */
function DailyReportLogRoute({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { getProject } = useProjects();
  const ownerUserId = getProject(projectId)?.ownerUserId;
  const { collaborators: people } = useProjectCollaborators(projectId);
  const filedBy = useCallback((r: DailyFieldReport) => dfrFiledBy({
    filedByUserId: r.filedByUserId, viewerId: user?.id, viewerName: user?.name, ownerUserId, people,
  }).document, [user?.id, user?.name, ownerUserId, people]);
  return <DailyReportLog projectId={projectId} filedBy={filedBy} />;
}

function DailyReportInner({ reportId, projectIdOverride }: { reportId?: string; projectIdOverride?: string }) {
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // Every exit below leaves through the safe back: a push or web-refresh cold
  // start of /daily-report?reportId= has nothing to pop, so a bare
  // router.back() after Save/Submit left the form up with a dead chevron.
  const goBack = useSafeBack();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { isDesktop } = useResponsiveLayout();
  // Structural web-only switches (the job-picker hand-off to the log) — a
  // native tablet at >= 1024 is isDesktop too and keeps today's editor.
  const desktopWeb = useIsDesktopWeb();
  const hsStyles = useThemedStyles(makeHsStyles);
  const voiceStyles = useThemedStyles(makeVoiceStyles);
  const leakStyles = useThemedStyles(makeLeakStyles);
  const dcStyles = useThemedStyles(makeDcStyles);
  // reportId comes from the gate above (which also accepts the `id` alias):
  // this editor only mounts for a named report once that report is loaded.
  // `date` (a bare YYYY-MM-DD) starts a NEW report on that day — Home's
  // daily-log card sends the missing day it lists (#114). `fieldIssue` is the
  // scope a collaborator tried to write as a change order; the CO screen sends
  // it here so it reaches the owner in this report instead of vanishing.
  const { projectId: paramProjectId, date: paramDate, fieldIssue: paramFieldIssue } =
    useLocalSearchParams<{ projectId: string; date?: string; fieldIssue?: string }>();
  const {
    getProject, getDailyReportsForProject, addDailyReport, updateDailyReport, contacts, settings, addProjectPhoto,
    getPhotosForProject, projects, commitments, getChangeOrdersForProject, updateProject,
    // Company suggestions for the crew editor — the sub roster the GC already
    // typed once. Trade suggestions come from the schedule and from this
    // project's own prior reports (see tradeSuggestions below), NOT from
    // Subcontractor.trade, which is a four-value coarse enum.
    subcontractors,
    // Receiving log (field-ops #11): a load signed for on the Deliveries screen
    // is filled into this report's materials, and a damaged one into issues.
    deliveries, deliveryReceipts,
  } = useProjects();
  // The time clock's shifts (field-ops #10) — the crew roster's first source.
  // Own shifts PLUS the crew's (#28): on a job a foreman runs, the GC's own
  // `entries` hold nobody, so the roster fell back to the schedule plan and
  // guessed 8-hour days for a crew the clock had measured. Read-only merge
  // (mergeTimeEntriesMirror) — this screen never writes a time entry.
  // shiftAlertHours (#41, time-labor handoff): the GC's "still on the clock"
  // alert window. A shift left open past it is a missed clock-out, not hours
  // worked, so the roster keeps it out of totals and overtime.
  const { entries: ownTimeEntries, teamEntries, refresh: refreshTimeEntries, shiftAlertHours } = useTimeEntries();
  const timeEntries = useMemo(() => mergeTimeEntriesMirror(ownTimeEntries, teamEntries), [ownTimeEntries, teamEntries]);
  // DFR-OSHA-BRIDGE — an injury written on the daily report has to land on the
  // safety register, or it never reaches the OSHA 300 that gets pulled months
  // later for an insurance renewal or a prequal.
  const { incidents: safetyIncidents, addIncident, updateIncident, isIncidentDeleted, clearIncidentTombstone, incidentsHydrated, fileCaseWhenHydrated } = useSafety();
  const { user } = useAuth();
  /** Who filed it. The register requires a reporter; SafetyContext defaults
   *  this on insert but not on update, so resolve it here for both paths. */
  const incidentAuthor = ((user?.name && user.name.trim()) || user?.email || '').trim();

  // Reached from the sidebar, universal search or a deep link there is no
  // projectId, so ToolProjectPicker sets one locally (field-ticket pattern).
  // A pick outranks the param so a STALE id in the URL — deleted project,
  // shared link — can't make the picker inert.
  // The record's own project seeds the pick (the gate keys this editor on the
  // record, so it seeds once per record): a link may carry only the record id,
  // or a projectId that isn't the record's, and the record's job must win.
  const [pickedProjectId, setPickedProjectId] = useState<string | null>(projectIdOverride ?? null);
  const projectId = pickedProjectId ?? paramProjectId ?? '';
  const { receipts } = useMaterialReceipts();
  // Cold-start seeds — the Profit Leak scan prices out-of-scope work off the
  // cost book. Without them a seeded contractor gets "No price history" on
  // every flagged item and the leak-CO draft goes out with blanks.
  const { seeds } = useCostSeeds();
  const { tier } = useSubscription();
  // The Incidents log and the OSHA 300 are Business surfaces, but the case a
  // super files from this screen is written at ANY tier (SafetyContext is not
  // gated). So the chip below has to tell the truth in both directions — the
  // record is safe, the VIEW of it is not free (canAccessOnProject, below).
  const { isFree } = useTierAccess();
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [showVoiceBanner, setShowVoiceBanner] = useState(false);
  const [voiceLimit, setVoiceLimit] = useState<LimitCheck | null>(null);
  const [upgradeLimit, setUpgradeLimit] = useState<LimitCheck | null>(null);
  const [gateRefresh, setGateRefresh] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void checkAILimit(tier, 'fast', 'voiceCapture').then(l => { if (!cancelled) setVoiceLimit(l); });
    return () => { cancelled = true; };
  }, [tier, gateRefresh]);

  const voiceBlocked = voiceLimit ? !voiceLimit.allowed : false;
  const openVoiceUpgrade = useCallback(() => { setUpgradeLimit(voiceLimit); }, [voiceLimit]);
  // Tracks which fields the AI populated in the most recent voice
  // pass. We use this to render a "here's what I heard" preview card
  // so the GC can verify before saving — no more silent auto-fill.
  const [voiceParsed, setVoiceParsed] = useState<{
    weather?: { temperature?: string; conditions?: string };
    crewSummary?: string;          // "4 framers, 2 electricians"
    workPerformed?: string;
    materialsDelivered?: string[];
    issuesAndDelays?: string;
  } | null>(null);

  const project = useMemo(() => getProject(projectId ?? ''), [projectId, getProject]);
  /** The URL named a project that doesn't exist — different from "no id". */
  const staleProjectId = !project && paramProjectId ? paramProjectId : undefined;
  // Seat rules (#116, #41, #82). The collaborator read is the live answer; the
  // loader's ownerUserId / myRole stamps keep an offline launch honest.
  const roleState = useProjectRoleState(projectId || undefined);
  const isProjectOwner = dfrIsProjectOwner(project?.ownerUserId, user?.id, roleState.role);
  // The Incidents register is opened through the SAME project-aware gate the
  // Incidents screen uses (tier OR the collaborator grant on this job). The
  // chip below only links the OWNER there — a collaborator's case reaches the
  // owner (20260919130000) but is not his record, so he gets the #82 note.
  const { canAccess: canAccessOnProject } = useProjectAccess(projectId || undefined);
  const publishAccess = useMemo(() => dfrPublishAccess({
    ownerUserId: project?.ownerUserId, userId: user?.id, role: roleState.role,
    myRole: project?.myRole, roleLoading: roleState.isLoading,
  }), [project?.ownerUserId, project?.myRole, user?.id, roleState.role, roleState.isLoading]);
  const existingReports = useMemo(() => getDailyReportsForProject(projectId ?? ''), [projectId, getDailyReportsForProject]);

  const existingReport = useMemo(() => reportId ? existingReports.find(r => r.id === reportId) : null, [reportId, existingReports]);

  const [weather, setWeather] = useState<DFRWeather>(
    existingReport?.weather ?? EMPTY_DFR_WEATHER
  );
  const [manpower, setManpower] = useState<ManpowerEntry[]>(existingReport?.manpower ?? []);
  // Signature of the roster the schedule prefill last wrote, so a date change
  // can tell an untouched auto-seed from crews the GC typed (see the prefill effect).
  const autoSeedRef = useRef<string | null>(null);
  // Same idea for the receiving-log fill (field-ops #11): the materials list and
  // the issues text the Deliveries receipts last wrote, so a date change swaps
  // an untouched fill but never overwrites lines the super typed.
  const materialsSeedRef = useRef<string | null>(null);
  const issuesSeedRef = useRef<string | null>(null);
  /**
   * What the SCREEN filled in by itself, as opposed to what the super typed.
   *
   * DFR-DIRTY-AUTOFILL (review 2026-09-08). Two effects below write fields with
   * no user action on a brand-new report: the weather auto-fetch (any project
   * with a location) and the schedule crew prefill (any project with a task
   * live today). The unsaved-work baseline started out comparing against the
   * EMPTY report, so within a second of opening a DFR nobody had touched, the
   * screen was "dirty" — the iOS edge-swipe was disabled, the back chevron
   * raised "Leave without saving?", and a draft of the app's own guesses was
   * written to disk and offered back the next morning as "you left this report
   * part-written", with yesterday's date and yesterday's crew on it. That is
   * the cry-wolf prompt the draft was built to avoid, plus a restore that hands
   * back a report the super never wrote.
   *
   * So the baseline is "saved report, or failing that whatever the app filled
   * in on its own". Only what a human changed after that reads as unsaved work.
   */
  const [autoFilled, setAutoFilled] = useState<{
    weather?: DFRWeather; manpower?: ManpowerEntry[]; materialsDelivered?: string[]; issuesAndDelays?: string;
  }>({});
  const [workPerformed, setWorkPerformed] = useState(existingReport?.workPerformed ?? '');
  // Structured per-task progress chips. Each entry pins a task from the
  // project schedule + a percent-complete the GC observed today.
  const [workProgress, setWorkProgress] = useState<DFRWorkProgress[]>(existingReport?.workProgress ?? []);
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const [materialsDelivered, setMaterialsDelivered] = useState<string[]>(
    existingReport?.materialsDelivered ?? []
  );
  const [newMaterial, setNewMaterial] = useState('');
  const [issuesAndDelays, setIssuesAndDelays] = useState(() => {
    if (existingReport) return existingReport.issuesAndDelays ?? '';
    // Change-order handoff: a collaborator can't write a CO on the GC's job, so
    // the scope he tried to write arrives here as a field issue for the GC.
    const fi = typeof paramFieldIssue === 'string' ? paramFieldIssue.trim() : '';
    return fi ? `For the GC \u2014 possible change order: ${fi}` : '';
  });
  // Homeowner-friendly summary — AI-generated from the technical fields,
  // GC reviews / edits, then publishes to the portal as the "Latest update".
  const [homeownerSummary, setHomeownerSummary] = useState<string>(existingReport?.homeownerSummary ?? '');
  const [hsHighlights, setHsHighlights] = useState<string[]>([]);
  const [hsLookingAhead, setHsLookingAhead] = useState<string>('');
  const [hsPublished, setHsPublished] = useState<boolean>(existingReport?.homeownerSummaryPublished ?? false);
  /** What the homeowner portal holds right now for this report (#22) — the
   *  label and pill read this, not the local toggle. */
  const hsPublishedSaved = existingReport?.homeownerSummaryPublished ?? false;
  /** The calendar day the summary text was written for (#115). A saved summary
   *  was written for the report's saved day; a generated one for the day it
   *  was generated on. */
  const [hsWrittenForDay, setHsWrittenForDay] = useState<string | null>(
    existingReport?.homeownerSummary ? calendarDayOf(existingReport.date) : null,
  );
  const [hsGenerating, setHsGenerating] = useState<boolean>(false);
  const [hsGeneratedAt, setHsGeneratedAt] = useState<string | undefined>(existingReport?.homeownerSummaryGeneratedAt);
  const [leakScan, setLeakScan] = useState<LeakScanRecord | null>(existingReport?.leakScan ?? null);
  const [leakScanning, setLeakScanning] = useState<boolean>(false);
  // ─── Delay cascade (Schedule impact) ───
  const [delayRows, setDelayRows] = useState<DelayRow[] | null>(null); // null = not scanned yet
  const [delayScanning, setDelayScanning] = useState<boolean>(false);
  const [delayPreviewOps, setDelayPreviewOps] = useState<EditOp[] | null>(null);
  const [delayTaskPickerIdx, setDelayTaskPickerIdx] = useState<number | null>(null);
  const [delayApplied, setDelayApplied] = useState<boolean>(false);
  // Hash of the issues text at scan time — the rows are only valid for THIS
  // text; when the live text diverges the preview is disabled (stale guard).
  const [delayScannedHash, setDelayScannedHash] = useState<string | null>(null);
  // Persisted applied-markers (mageid_delay_applied store), decoded, keyed by
  // appliedDelayKey(projectId, textHash). Guards against re-applying the same
  // relative move ops across sessions AND across reports — see the
  // DFR-DELAY-RECARRY note on the appliedDelayRecord region above.
  const [appliedDelays, setAppliedDelays] = useState<Record<string, AppliedDelayRecord>>({});
  // Explicit user override: "yes, apply this same delay text again".
  const [delayReArmed, setDelayReArmed] = useState<boolean>(false);
  // Synchronous re-entry guard — state alone can't stop a double tap during
  // the checkAILimit network round-trip (two paid scans for one action).
  const delayScanBusyRef = useRef<boolean>(false);
  const [photos, setPhotos] = useState<DFRPhoto[]>(existingReport?.photos ?? []);
  const [incident, setIncident] = useState<IncidentReport>(existingReport?.incident ?? EMPTY_DFR_INCIDENT);
  const [incidentClass, setIncidentClass] = useState<DfrIncidentClass>(EMPTY_DFR_INCIDENT_CLASS);
  // True once the determination inputs have been seeded from somewhere (the
  // register case this report already filed, or a restored draft), so a later
  // context re-render cannot overwrite what the super has since typed.
  const incidentClassSeededRef = useRef(false);
  const [showManpowerModal, setShowManpowerModal] = useState(false);
  // Which crew row the modal is EDITING. null = the modal is adding a new one.
  // Before this existed, correcting "4 framers" to 3 meant trash → confirm
  // dialog → + → retype trade, company, headcount and hours: eight taps and
  // four keyboard fields to change one digit, on the most-corrected block of
  // the screen (the roster is seeded from the schedule, so nearly every row
  // starts slightly wrong by design).
  const [mpEditingId, setMpEditingId] = useState<string | null>(null);
  const [mpTrade, setMpTrade] = useState('');
  const [mpCompany, setMpCompany] = useState('');
  const [mpHeadcount, setMpHeadcount] = useState('');
  const [mpHours, setMpHours] = useState('8');
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [showSendRecipient, setShowSendRecipient] = useState(false);
  const [sendRecipientName, setSendRecipientName] = useState('');
  const [sendRecipientEmail, setSendRecipientEmail] = useState('');
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contactPicked, setContactPicked] = useState(false);
  // Date selection — Procore-style. The DFR's `date` field already
  // exists on the persisted record but the UI used to hardcode "now"
  // every render, making it impossible to log a report for yesterday
  // (the most common GC backfill case after a long Saturday). Tap
  // the date in the top bar to open DatePickerModal.
  const [reportDate, setReportDate] = useState<string>(() => {
    // A new report asked for a specific day (#114: the daily-log card's gap
    // row). Local noon of that day, so the instant can't read as the day
    // before or after in any US zone. Anything unparseable falls back to now.
    const asked = !reportId && typeof paramDate === 'string' ? parseCalendarDay(paramDate) : null;
    if (asked) { asked.setHours(12, 0, 0, 0); return asked.toISOString(); }
    // Today's report is stamped at local noon too, not the filing instant.
    // The "filed the report for <day>" push (#60) reads this instant in the
    // GC's digest zone, not the foreman's: a 9:30 pm Pacific filing was
    // 00:30 Eastern and named TOMORROW. Local noon is the same calendar day
    // in every US zone. Gives up: same-day reports no longer order by filing
    // time on `date` — nothing reads the hour ('last saved' uses updatedAt,
    // and backdated / picked days were already noon).
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today.toISOString();
  });
  // The date a BRAND-NEW report starts on. The unsaved-work baseline below
  // needs it: `reportDate` is seeded from the clock, so without a fixed
  // reference a new report would compare its own mount-time date against
  // nothing and read as edited before the user typed a character.
  const initialReportDateRef = useRef(reportDate);
  const [showDatePicker, setShowDatePicker] = useState(false);
  // When loading an existing draft, hydrate reportDate from the persisted
  // record. We use a layout-effect pattern via useEffect on the existing
  // report so re-opening yesterday's draft surfaces yesterday's date.
  // Key on existingReport?.id (not the full object) so this only runs once per
  // loaded report, not on every field update (e.g. a mid-edit leakScan write
  // creates a new object identity, which would silently revert an unsaved date).
  useEffect(() => {
    if (existingReport?.date) setReportDate(existingReport.date);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingReport?.id]);
  // The report's LOCAL calendar day. reportDate starts life as an ISO instant,
  // and a raw prefix match on it names tomorrow after ~5–8 pm in the US — the
  // receipts and clocked shifts below are joined on this instead.
  const reportCalendarDay = useMemo(() => calendarDayOf(reportDate), [reportDate]);
  // Photos taken on the calendar day this DFR is FOR (#61). They feed the
  // voice parser and "Generate from photos"; keyed on the report's day, so a
  // missed Monday opened from Home on Wednesday is drafted from Monday's
  // pictures — the old test used today for every new report — and a date
  // change re-picks them.
  const todaysProjectPhotos = useMemo(
    () => dfrReportDayPhotos(getPhotosForProject(projectId ?? ''), reportCalendarDay, v => calendarDayOf(v)),
    [projectId, getPhotosForProject, reportCalendarDay],
  );
  // This day's receipts from the Deliveries screen, as report lines
  // (field-ops #11). Matched on the REPORT's day, so a Friday report filled in
  // on Monday picks up Friday's loads.
  const receiptLines = useMemo(
    () => receiptLinesForDay(deliveryReceipts, deliveries, projectId ?? '', reportCalendarDay),
    [deliveryReceipts, deliveries, projectId, reportCalendarDay],
  );
  const receiptLinesSig = useMemo(() => JSON.stringify(receiptLines), [receiptLines]);
  // Fill a NEW report's materials (and a damaged load into issues) from the
  // day's receipts. Re-runs when the date or the receipts change, and only
  // replaces a field that is empty or still exactly what this fill wrote.
  useEffect(() => {
    if (existingReport) return;
    const matsUntouched = materialsDelivered.length === 0 || JSON.stringify(materialsDelivered) === materialsSeedRef.current;
    if (matsUntouched) {
      const next = receiptLines.materials;
      materialsSeedRef.current = next.length > 0 ? JSON.stringify(next) : null;
      setMaterialsDelivered(next);
      setAutoFilled(p => ({ ...p, materialsDelivered: next }));
    }
    const issuesUntouched = !issuesAndDelays.trim() || issuesAndDelays === issuesSeedRef.current;
    if (issuesUntouched) {
      const next = receiptLines.damage.join('\n');
      issuesSeedRef.current = next || null;
      setIssuesAndDelays(next);
      setAutoFilled(p => ({ ...p, issuesAndDelays: next }));
    }
    // A fill the app wrote is not the super's work — see DFR-DIRTY-AUTOFILL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receiptLinesSig]);
  /** Receipt lines this report does not carry yet — a saved report, a list
   *  the super edited, or a load received after the report was started. */
  const missingReceiptLines = useMemo(
    () => receiptLines.materials.filter(l => !materialsDelivered.includes(l)),
    [receiptLines, materialsDelivered],
  );
  const handleAddReceiptLines = useCallback(() => {
    setMaterialsDelivered(prev => mergeReceiptLines(prev, receiptLines.materials));
    setIssuesAndDelays(prev => {
      const missing = receiptLines.damage.filter(l => !prev.includes(l));
      return missing.length === 0 ? prev : [prev.trim(), ...missing].filter(Boolean).join('\n');
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [receiptLines]);
  // Stable report id — used both for saving the DFR record and for
  // naming the PDF in the `project-documents` bucket. We derive it
  // once per existingReport identity so the same report always lands
  // at the same bucket path (overwrites in place rather than
  // littering the bucket with copies).
  const stableReportId = useMemo(
    () => existingReport?.id ?? generateUUID(),
    [existingReport?.id],
  );
  // Where this report's unsaved-work draft lives. Declared up here (not down
  // with the rest of the draft machinery) because handleSave has to be able to
  // clear it: a save navigates away immediately, which cancels the debounced
  // write's cleanup, so a draft that isn't removed explicitly outlives the
  // record it was a draft OF — and on the shared 'new' slot it would then be
  // offered back on top of the next brand-new report.
  const draftKey = useMemo(
    () => dfrDraftKey(projectId ?? '', existingReport?.id),
    [projectId, existingReport?.id],
  );
  // ─── DFR-OSHA-BRIDGE ──────────────────────────────────────────────────
  // The safety register case this report owns.
  //
  // The id is DERIVED from the report's id rather than stored on it, because
  // IncidentReport has nowhere to put a foreign key and adding one would mean
  // two copies of the OSHA determination inputs drifting apart. Deriving it
  // buys three things: re-saving the report UPDATES its case instead of filing
  // a duplicate on every tap of Save, closing and reopening the report finds
  // the case again, and the register stays the single home for the fields the
  // DFR type cannot carry (treatment, day counts, restriction, consciousness,
  // fatality) — which is where they belong, since that is what the OSHA 300
  // reads. See safetyIncidentIdForReport for why the derivation is collision-free.
  const dfrCaseId = useMemo(() => safetyIncidentIdForReport(stableReportId), [stableReportId]);
  const linkedIncident = useMemo(
    () => safetyIncidents.find(i => i.id === dfrCaseId) ?? null,
    [safetyIncidents, dfrCaseId],
  );
  /** #89: the owner deleted this report's case in Incidents (tombstoned). */
  const caseDeletedInLog = !linkedIncident && isIncidentDeleted(dfrCaseId);
  // #63: who filed this report. The collaborator read shares its cache with
  // useProjectRoleState's (same query key), so this costs no extra request.
  // A new report is the viewer's own.
  const { collaborators: projectPeople } = useProjectCollaborators(projectId || undefined);
  const filedBy = useMemo(() => dfrFiledBy({
    filedByUserId: existingReport ? existingReport.filedByUserId : user?.id,
    viewerId: user?.id, viewerName: user?.name, ownerUserId: project?.ownerUserId, people: projectPeople,
  }), [existingReport, user?.id, user?.name, project?.ownerUserId, projectPeople]);
  const savedHadIncident = existingReport?.incident?.hasIncident === true;
  // #122 (integration round 1): before the injury log has loaded on this
  // phone (cold start, second device) a saved report's case is "not loaded
  // yet", not "not visible" — the lock below used to fire in that window,
  // telling the foreman his OWN case was in the GC's log and skipping his
  // classification change on save. Until it loads: the classification shows
  // as loading (not locked) and the case write is held, not skipped.
  const caseLogLoading = dfrCaseLogLoading({ incidentsHydrated, caseVisible: !!linkedIncident, savedHadIncident });
  // #122 (interim): someone else's report whose case this seat cannot see —
  // the classification is locked with the reason and no case is written.
  const caseNotYoursReason = caseLogLoading ? null : dfrCaseNotYoursReason({
    caseVisible: !!linkedIncident, caseDeleted: caseDeletedInLog, isOwner: isProjectOwner,
    savedHadIncident,
    filedByUserId: existingReport?.filedByUserId, viewerId: user?.id, authorPossessive: filedBy.possessive,
  });
  /** The 1904 determination on screen is only a fact when it came from inputs
   *  this seat could see; otherwise the saved report's flags stand. */
  const classificationKnown = !caseNotYoursReason && !caseLogLoading;
  /**
   * #87: the storage path a DFR photo will have, staged now. Same helper
   * inputs as ProjectContext's stageDfrPhotos (signed-in user, project, photo
   * id → one deterministic object), and the upload queue dedupes on that path,
   * so the bytes still upload once and the report and the incident name the
   * same object. Null when there is nothing to stage (signed out, or already
   * remote).
   */
  const stageIncidentPhoto = useCallback((p: { id: string; uri: string }): string | null => {
    const uid = user?.id;
    if (!uid || !projectId || !p.id || !p.uri || !isDeviceLocalUri(p.uri)) return null;
    const ext = photoExtFromUri(p.uri);
    const storagePath = buildPhotoStoragePath(uid, projectId, p.id, ext);
    void queuePhotoUpload({ photoId: p.id, userId: uid, projectId, localUri: p.uri, storagePath, contentType: contentTypeForExt(ext) });
    return storagePath;
  }, [user?.id, projectId]);
  const toggleIncidentPhoto = useCallback((id: string) => {
    setPhotos(prev => prev.map(p => (p.id === id ? withIncidentMark(p, !(p as DfrPhotoWithFlag).incidentPhoto) : p)));
  }, []);
  const refileDeletedCase = useCallback(() => {
    showAlert(
      'File the case again?',
      'The owner deleted this case in Incidents. Filing it again puts it back on the safety record when you save this report.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'File it again', onPress: () => clearIncidentTombstone(dfrCaseId) },
      ],
    );
  }, [clearIncidentTombstone, dfrCaseId]);
  // Seed the determination inputs from the case this report already filed.
  // Guarded by a ref rather than by a dependency list because SafetyContext
  // re-renders on every write in the app, and without the guard a save would
  // immediately reset the pickers the super had just moved.
  useEffect(() => {
    if (incidentClassSeededRef.current || !linkedIncident) return;
    incidentClassSeededRef.current = true;
    setIncidentClass({
      type: linkedIncident.type,
      treatment: linkedIncident.treatment,
      daysAway: linkedIncident.daysAway > 0 ? String(linkedIncident.daysAway) : '',
      daysRestricted: linkedIncident.daysRestricted > 0 ? String(linkedIncident.daysRestricted) : '',
      restrictedDuty: linkedIncident.restrictedDuty,
      lostConsciousness: linkedIncident.lostConsciousness,
      fatality: linkedIncident.fatality,
    });
  }, [linkedIncident]);

  /** What the 1904 classifier actually gets. Day counts are floored at 0 —
   *  a typed "-2" is a typo, not two negative days away. */
  const incidentClassInput = useMemo<IncidentClassInput>(() => ({
    type: incidentClass.type,
    treatment: incidentClass.treatment,
    daysAway: Math.max(0, parseInt(incidentClass.daysAway, 10) || 0),
    // The live verdict has to read the day count too (safety-compliance #1):
    // "5 days restricted" with the toggle off is a restricted-work case, and
    // leaving this out showed "Not recordable" directly under the 5.
    daysRestricted: Math.max(0, parseInt(incidentClass.daysRestricted, 10) || 0),
    restrictedDuty: incidentClass.restrictedDuty,
    lostConsciousness: incidentClass.lostConsciousness,
    fatality: incidentClass.fatality,
  }), [incidentClass]);
  /** The computed answer, with the criterion that decided it. Replaces the
   *  self-ticked "OSHA recordable" checkbox — the app shows its work instead
   *  of asking him to certify a determination he has no reference for. */
  const recordability = useMemo(() => describeRecordability(incidentClassInput), [incidentClassInput]);
  /** The restricted box as the case will be filed — on whenever days are
   *  counted, same as the incident screen (buildSafetyIncidentFromDfr folds
   *  the day count in on save). */
  const restrictedShownOn = hasRestriction(incidentClassInput);
  const toggleRestrictedDuty = useCallback(() => {
    // Blocked, and says why: unticking while days are counted would show a box
    // that is off for a case that is filed as restricted anyway.
    const days = incidentClassInput.daysRestricted ?? 0;
    if (days > 0) {
      showAlert(
        'Restricted days are counted',
        `${days} day${days === 1 ? '' : 's'} of restriction are entered, which makes this a restricted-work case. Clear the day count to untick it.`,
      );
      return;
    }
    setIncidentClass(p => ({ ...p, restrictedDuty: !p.restrictedDuty }));
  }, [incidentClassInput.daysRestricted]);

  // "Save copy to project files" toggle in the Send modal — when on,
  // the rendered HTML report is uploaded as a PDF to the project's
  // documents bucket so it shows up in the shared-drive view.
  // #27: off (and disabled in the modal) on web, where there are no PDF bytes
  // to upload — see dfrProjectFilesAvailable.
  const [saveToProjectFiles, setSaveToProjectFiles] = useState(() => dfrProjectFilesAvailable(Platform.OS));

  // The hero card date must reflect the report being viewed/edited — i.e.
  // the user-picked `reportDate` (which hydrates from an existing draft and
  // is editable via the date picker), NOT an unconditional "today". Pre-fix
  // this was hardcoded to `new Date()`, so opening a backfilled report
  // showed the correct date in the top bar but "today" in the hero card —
  // two different dates on the same screen. Bound to `reportDate` now so
  // both stay in sync.
  const reportDateStr = useMemo(() => {
    return dayOrInstantDate(reportDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }, [reportDate]);

  // "Day 35 of 103" — the project's calendar day relative to the schedule's
  // start date and total planned duration. Surfacing this on every DFR
  // hero card builds confidence that the app understands the project's
  // calendar, and gives the GC a constant pacing signal.
  const projectDayInfo = useMemo(() => {
    const sched = project?.schedule;
    const start = sched?.startDate;
    const total = sched?.totalDurationDays;
    if (!sched || !start || !total || total <= 0) return null;
    // UX-F1: day 1 is the schedule's start CALENDAR DAY and the count is in
    // WORKING days (scheduleEngine.addWorkingDays / getTaskDateRange) — not
    // raw elapsed milliseconds from a UTC-midnight parse, which ran a day
    // ahead west of Greenwich and counted weekends as worked days. Anchored
    // on the report's own date so a backfilled Friday report says Friday's day.
    const startDay = parseCalendarDay(start);
    if (!startDay) return null;
    const reportDay = dayOrInstantDate(reportDate); // an instant, or a bare day from an older voice report
    if (!Number.isFinite(reportDay.getTime())) return null;
    const day = Math.max(1, Math.min(total,
      scheduleDayNumberFor(startDay, reportDay, sched.workingDaysPerWeek, sched.nonWorkingDates)));
    return { day, total };
  }, [project?.schedule, reportDate]);

  // The most recent saved report, excluding the one being edited (if any).
  // Drives the "Copy from yesterday" carry-forward affordance — the single
  // most-requested feature in DFR app reviews. Most reports repeat 80% of
  // yesterday's content (same subs, similar work areas, same crew sizes);
  // making the user re-type all of it every day is the #1 friction point
  // contractors cite in Raken / Procore reviews.
  // Excludes THIS report by its stable id rather than by the route's reportId.
  // Identical for a saved report (stableReportId is its id), but a brand-new
  // report now also excludes itself once it has been written to disk — which
  // happens without navigating away when the delay-event handoff below saves
  // silently. Keyed on reportId, the screen would offer "Copy from earlier
  // today" for the report currently open.
  // #61: only a report on a day STRICTLY before this one — the newest of all
  // copied a later day's work, crews and delay note back into an earlier day.
  const lastReport = useMemo(
    () => dfrCopySource(existingReports, reportCalendarDay, stableReportId, v => calendarDayOf(v)),
    [existingReports, stableReportId, reportCalendarDay],
  );

  const [carryFormFromId, setCarryFormFromId] = useState<string | null>(null);

  const handleCarryForward = useCallback(() => {
    if (!lastReport) return;
    // Copy the fields most likely to repeat day-to-day. We DON'T copy
    // weather (auto-fetched today is more accurate) or photos (different
    // photos today) or the incident block (must be re-attested per day).
    //
    // `issuesAndDelays` IS copied, deliberately — a delay rarely ends at
    // midnight, and making him retype it is how a two-day slip gets logged as
    // one. What used to make that dangerous is that a carried-forward note
    // could ripple the schedule a second time: the applied-marker was keyed on
    // the report id, and this report's id is new. That guard is now keyed on
    // (project + text hash), so the copy arrives already showing APPLIED and
    // the ripple is blocked with the day it was applied on named — with Re-arm
    // beside it for the genuinely recurring delay ("rain again"). See the
    // DFR-DELAY-RECARRY note at the top of this file.
    // Today's time-clock rows stay; yesterday's sub/plan rows carry
    // (utils/dfrClockCrew.carryForwardManpower) — a plain copy put yesterday's
    // crew and hours on today's signed report.
    setManpower(prev => carryForwardManpower(lastReport.manpower ?? [], prev));
    if (lastReport.workPerformed) setWorkPerformed(lastReport.workPerformed);
    // Yesterday's materials minus the lines yesterday's RECEIPTS wrote, plus
    // this day's receipts: yesterday's loads must not stand in for today's on
    // a record that gets pulled in a late-material claim (field-ops #11).
    const lastDayReceipts = receiptLinesForDay(deliveryReceipts, deliveries, projectId ?? '', calendarDayOf(lastReport.date));
    const carriedMaterials = mergeReceiptLines(lastReport.materialsDelivered ?? [], receiptLines.materials, lastDayReceipts.materials);
    setMaterialsDelivered(carriedMaterials);
    materialsSeedRef.current = null; // the copy is his choice now, not an untouched fill
    if (lastReport.issuesAndDelays) {
      // The delay note itself carries forward — that is the point of the
      // button, and validate-delay-rfi pins this line (the double-ripple fix
      // was the applied-marker guard, not dropping the field).
      setIssuesAndDelays(lastReport.issuesAndDelays);
      // Then, in the same batch: drop the "Damaged delivery: …" lines that
      // YESTERDAY's receipts wrote (that load was damaged yesterday, and on
      // today's dated record it reads as a second damaged load) and add
      // today's. Materials get the same treatment above.
      setIssuesAndDelays(prev => carryIssuesText(prev, receiptLines.damage, lastDayReceipts.damage));
      issuesSeedRef.current = null;
    }
    setCarryFormFromId(lastReport.id);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    nailIt(`Copied from ${carrySourceDayAbsolute(lastReport.date)}. Edit anything that's different.`);
  }, [lastReport, deliveryReceipts, deliveries, projectId, receiptLines]);

  // "earlier today" / "yesterday" are relative to a `now` that has to be read
  // again when it changes, or the button keeps naming the day it was mounted
  // on. A super leaves this screen open on a truck dash overnight and comes
  // back to it: the memo below never re-ran, so it still says "Copy from
  // earlier today" for what is now yesterday's report — DFR-CARRY-LABEL again,
  // from staleness rather than from arithmetic. Re-reading the day on focus
  // covers the real path (backgrounding the app and returning blurs and
  // re-focuses the screen). Held as the 'YYYY-MM-DD' string, not a Date, so
  // the common re-focus sets identical state and React bails out of the
  // re-render; only an actual midnight crossing costs anything.
  const [carryLabelDay, setCarryLabelDay] = useState(() => todayCalendarDay());
  useFocusEffect(useCallback(() => { setCarryLabelDay(todayCalendarDay()); }, []));

  // #61: relative words ("yesterday") only on today's report, where they mean
  // what they say; a backdated report names the source day ("Fri, Sep 12"),
  // never "2 days ago" measured from today.
  const lastReportRelativeLabel = useMemo(() => {
    if (!lastReport) return '';
    return carrySourceDayLabel(lastReport.date, parseCalendarDay(carryLabelDay) ?? new Date());
  }, [lastReport, carryLabelDay]);
  const lastReportLabel = lastReport && reportCalendarDay && reportCalendarDay !== carryLabelDay
    ? carrySourceDayAbsolute(lastReport.date)
    : lastReportRelativeLabel;

  // ─── DFR-WEATHER-DAY ──────────────────────────────────────────────────
  // "Is this report's date today?" — the one question the weather path never
  // asked. Keyed on `carryLabelDay` rather than on a fresh `new Date()` so the
  // answer is re-read when the screen refocuses (a phone left on a truck dash
  // overnight crosses midnight without re-rendering), which is the same
  // staleness DFR-CARRY-LABEL was bitten by.
  const reportIsToday = useMemo(
    () => canReadLiveWeatherFor(calendarDayOf(reportDate), carryLabelDay),
    [reportDate, carryLabelDay],
  );
  /** "Mon, Sep 14" — the day the notice and the alert name. */
  const reportDayLabel = useMemo(
    () => formatCalendarDay(calendarDayOf(reportDate) ?? '', { weekday: 'short', month: 'short', day: 'numeric' })
      || 'that day',
    [reportDate],
  );
  /** Live value of reportDate for the in-flight fetch's re-check — state read
   *  inside an awaited callback is the value from the render that started it. */
  const reportDateRef = useRef(reportDate);
  useEffect(() => { reportDateRef.current = reportDate; }, [reportDate]);
  /** When the reading in the block was taken, if it was taken in this session. */
  const [weatherReadAt, setWeatherReadAt] = useState<Date | null>(null);

  // Progress meter — "X of 5 sections filled". Five tracked items because
  // five is what a contractor can hold in their head: weather, crew, work
  // performed, materials, photos. Issues + incident don't count toward
  // completion (they're "fill if relevant"). Drives a pill at the top so
  // the GC knows at a glance how close they are to a sendable report.
  const progressMeta = useMemo(() => {
    const filled = [
      (weather.temperature?.length ?? 0) > 0 || (weather.conditions?.length ?? 0) > 0,
      manpower.length > 0,
      workPerformed.trim().length > 0,
      materialsDelivered.length > 0,
      photos.length > 0,
    ];
    const done = filled.filter(Boolean).length;
    const total = filled.length;
    return { done, total, isReady: done >= 3 };
  }, [weather, manpower, workPerformed, materialsDelivered, photos]);

  // `opts.auto` marks the on-mount fetch — a forecast the screen went and got
  // by itself. The "Auto-fetch" button below passes nothing, because a tap IS
  // the user's work and must read as an edit. Never wire this straight to
  // onPress: the press event would arrive as `opts` and `opts.auto` would be
  // undefined by luck rather than by design.
  const fetchWeather = useCallback(async (opts?: { auto?: boolean }) => {
    if (!project?.location) return;
    // DFR-WEATHER-DAY. wttr.in answers `current_condition` — the sky RIGHT NOW.
    // Nothing in this path used to look at the report's date, so a Monday report
    // filed Tuesday morning carried Tuesday's sky stamped `isManual: false`, the
    // flag that means "fetched, not typed". Weather is the first thing anyone
    // checks when a delay is argued and the one field trivially falsifiable
    // against public records, so a wrong-day reading does not just lose that
    // day — it invites the other side to question the whole binder.
    //
    // The guard lives HERE rather than on the date picker's onChange because the
    // picker is not the only path to a wrong day: the mount effect below is
    // gated only on `!existingReport`, so an unsaved draft started Monday and
    // reopened Wednesday would re-fetch Wednesday's sky with no user action at
    // all, and the Auto-fetch button takes this same path.
    //
    // Calendar days, not instants: reportDate is seeded as an ISO instant and
    // this file twice annotates that it is not a calendar day. A naive
    // comparison misclassifies an evening-filed report near midnight, which is
    // the bug wearing a different hat.
    const requestedDay = calendarDayOf(reportDate);
    if (!canReadLiveWeatherFor(requestedDay, todayCalendarDay())) {
      if (opts?.auto !== true) {
        showAlert('No past weather', backfilledWeatherNotice(reportDayLabel));
      }
      return;
    }
    setWeatherLoading(true);
    try {
      const location = encodeURIComponent(project.location);
      const response = await fetch(
        `https://wttr.in/${location}?format=j1`
      );
      if (response.ok) {
        const data = await response.json();
        const current = data?.current_condition?.[0];
        // The date can move while the request is in flight — the mount fetch
        // fires before the super has touched anything, and backfilling is the
        // first thing he does. Re-check against the day this read was FOR, or
        // the answer lands on a report it was never asked for.
        if (current && calendarDayOf(reportDateRef.current) === requestedDay) {
          const fetched: DFRWeather = {
            temperature: `${current.temp_F}°F / ${current.temp_C}°C`,
            conditions: current.weatherDesc?.[0]?.value ?? 'Unknown',
            wind: `${current.windspeedMiles} mph ${current.winddir16Point}`,
            isManual: false,
          };
          setWeather(fetched);
          // The clock time of the read, so the provenance chip can say when.
          // Session-only: DFRWeather has no room for it and inventing a
          // persisted timestamp for a reading restored from disk would be the
          // same class of lie this guard exists to stop.
          setWeatherReadAt(new Date());
          // Fold an unattended fetch into the unsaved-work baseline, or the
          // screen reports itself as edited before the super has typed a word.
          if (opts?.auto === true) setAutoFilled(p => ({ ...p, weather: fetched }));
          console.log('[DFR] Weather fetched successfully');
        }
      }
    } catch (err) {
      console.log('[DFR] Weather fetch failed:', err);
      // Only shout about a fetch he ASKED for. The mount effect below fires
      // fetchWeather({ auto: true }) on every entry to this screen, so an
      // offline jobsite — the normal condition — greeted the super with a
      // modal about something he never tapped, before he had typed a word.
      // The deliberate button keeps the alert; the unattended fetch degrades
      // to the toast slot. This function already branches on opts?.auto a few
      // lines above, and utils/location.ts:1-15 is this repo's own written
      // rule against exactly this.
      if (opts?.auto === true) {
        oops('Weather unavailable — enter it manually.');
      } else {
        showAlert('Weather Unavailable', 'Could not fetch weather data. Please enter manually.');
      }
    } finally {
      setWeatherLoading(false);
    }
  }, [project?.location, reportDate, reportDayLabel]);

  useEffect(() => {
    if (!existingReport && project?.location) {
      void fetchWeather({ auto: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // DFR-WEATHER-DAY, second half. Backfilling is a DATE CHANGE on a report that
  // already auto-filled with today's sky, so blocking the fetch is not enough —
  // the wrong reading is already in the block. Clear it and let the notice below
  // say why, rather than leaving this morning's 72°F sitting under last Monday's
  // date with the "fetched" flag on it.
  //
  // Only ever clears a reading the SCREEN fetched (`isManual === false`) on a
  // report that is not yet saved. Typed weather is the super's own answer about
  // that day and is never touched, and a saved record is not rewritten on open:
  // wiping stored evidence because the app now knows better is destructive, so a
  // legacy report gets the caveat in its provenance line instead.
  useEffect(() => {
    if (reportIsToday || existingReport) return;
    if (weather.isManual) return;
    if (!weather.temperature && !weather.conditions && !weather.wind) return;
    setWeather(EMPTY_DFR_WEATHER);
    setWeatherReadAt(null);
    // Keep the unsaved-work baseline in step, or clearing the app's own guess
    // reads as the super having edited the report.
    setAutoFilled(p => ({ ...p, weather: EMPTY_DFR_WEATHER }));
  }, [reportIsToday, existingReport, weather.isManual, weather.temperature, weather.conditions, weather.wind]);

  /** The honesty chip under the weather block. `isManual` was WRITE-ONLY before
   *  this — nothing in the repo read it — so flipping the flag alone changed
   *  nothing anyone could see. */
  const weatherProvenance = useMemo(() => weatherProvenanceLine({
    isManual: weather.isManual,
    reportIsToday,
    hasValue: Boolean(weather.temperature || weather.conditions || weather.wind),
    // Printed verbatim: project.location legitimately defaults to the literal
    // "United States" on projects created through the estimate wizard, and a
    // chip reading 'read for United States' exposes that rather than hiding it
    // behind three confident-looking values.
    location: project?.location ?? '',
    readAtLabel: weatherReadAt
      ? weatherReadAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : undefined,
  }), [weather, reportIsToday, project?.location, weatherReadAt]);

  // Pre-fill manpower for the report's day. Two sources, in order of truth:
  //
  //   1. THE TIME CLOCK (field-ops #10). Who actually clocked in on this job
  //      that calendar day, and for how long — see utils/dfrClockCrew for which
  //      shifts count and why the day comes from clockIn, not TimeEntry.date.
  //      A report that says "Framing × 4, 8 hrs" while payroll says 3 framers +
  //      1 laborer × 9 h is two contradicting records from one app.
  //   2. THE SCHEDULE PLAN. Who is assigned (`assignedSubName` / `crew`) and
  //      roughly how many (`crewSize`) on today's live tasks. Used for every
  //      row when nobody clocked in, and for SUB crews (a task with an assigned
  //      company) either way, because a sub's crew never clocks into this app.
  //
  // Idempotent — seeds a fresh DFR's empty roster, and re-seeds when the report
  // DATE or the clocked shifts change as long as the roster is still the
  // untouched auto-seed (B4 review A7: a Friday report backfilled on Monday
  // used to keep Monday's crews). Rows the GC typed are never overwritten.
  // An open shift's hours are "so far", read at `liveNowMs`. That instant is
  // re-read each minute while anyone is still on the clock, so an untouched
  // roster keeps counting instead of freezing at the hours from when the
  // screen opened (the seed below re-runs on the changed signature).
  // Pull the crew's clock-ins when the report opens (and on a project
  // switch). The team rows otherwise refresh only at launch, on Time Tracking
  // and on a foreground 5+ minutes after the last — so a foreman's 7:00
  // clock-in on his own phone could be missing from the roster the super
  // signs at 16:00.
  useEffect(() => { refreshTimeEntries(); }, [projectId, refreshTimeEntries]);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());
  // #65 · Overtime is computed from the whole week under the GC's rule (federal
  // weekly >40 by default, optional daily >8) — the same rule Job Costing and
  // the payroll CSV use, so the DFR chip never names overtime the ledger won't.
  // gc_labor_settings is owner-only, so an invited foreman's phone reads its own
  // (default weekly-40) rule; the GC's own report carries his setting.
  const { overtimeRule } = useLaborRates();
  const clockCrew = useMemo(
    () => (project && reportCalendarDay
      ? clockCrewForDay(timeEntries, project.id, reportCalendarDay, settings?.branding?.companyName, liveNowMs, overtimeRule, shiftAlertHours)
      : null),
    [timeEntries, project, reportCalendarDay, settings?.branding?.companyName, liveNowMs, overtimeRule, shiftAlertHours],
  );
  const hasLiveShifts = (clockCrew?.liveCount ?? 0) > 0;
  useEffect(() => {
    if (!hasLiveShifts) return;
    const id = setInterval(() => setLiveNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [hasLiveShifts]);
  // A string, so the effect below re-runs when the clocked crew actually
  // changes (someone clocks out) and not on every store re-render.
  const clockCrewSig = useMemo(
    () => (clockCrew ? JSON.stringify(clockCrew.rows.map(r => [r.trade, r.company, r.headcount, r.hoursWorked, r.liveCount])) : ''),
    [clockCrew],
  );
  const [crewSource, setCrewSource] = useState<{ kind: 'clock' | 'schedule'; line: string } | null>(null);
  useEffect(() => {
    if (existingReport) return;
    if (manpower.length > 0 && JSON.stringify(manpower) !== autoSeedRef.current) return;

    // Schedule-plan rows for the report's day (may be empty).
    const planned: { trade: string; company: string; headcount: number }[] = [];
    if (project?.schedule && project.schedule.tasks?.length) {
      const baseIso = project.schedule.startDate || project.createdAt;
      // UX-F1: same 1-indexed working-day anchor as the hero above and the
      // Home/Summary "today on site" strips (day 1 = the start calendar day).
      const base = parseCalendarDay(baseIso) ?? new Date(baseIso);
      // B4 review A7: anchored on the report's own date like the hero above.
      const reportDay = dayOrInstantDate(reportDate); // an instant, or a bare day from an older voice report
      if (Number.isFinite(base.getTime()) && Number.isFinite(reportDay.getTime())) {
        const todayDay = scheduleDayNumberFor(base, reportDay, project.schedule.workingDaysPerWeek, project.schedule.nonWorkingDates);
        // Today's live tasks — started but not finished, not done.
        const liveTasks = project.schedule.tasks.filter(t => {
          if (t.status === 'done') return false;
          if (t.isMilestone) return false; // milestones aren't crew assignments
          if (t.isLevelOfEffort || t.isSummary) return false;
          const start = Math.max(1, t.startDay ?? 1);
          const dur = Math.max(0, t.durationDays ?? 0);
          // Inclusive last active day = start + dur - 1 (matches getTaskDateRange).
          return todayDay >= start && todayDay <= start + dur - 1;
        });
        const groups = new Map<string, { trade: string; company: string; headcount: number }>();
        for (const t of liveTasks) {
          // The phase is the third fallback, ahead of the literal 'Crew'. A
          // generated schedule fills `phase` and leaves `crew` blank, and
          // normalizeTradeKey only lowercases, so every trade folded into one
          // anonymous 'Crew' bucket and crewPresence had nothing to chase.
          const trade = (t.crew || t.assignedSubName || t.phase || 'Crew').trim() || 'Crew';
          const company = (t.assignedSubName || '').trim();
          const key = `${trade.toLowerCase()}|${company.toLowerCase()}`;
          const headcount = Math.max(1, t.crewSize ?? 1);
          const prev = groups.get(key);
          if (prev) prev.headcount += headcount;
          else groups.set(key, { trade, company, headcount });
        }
        planned.push(...groups.values());
      }
    }

    // Ids come from each row's own key (utils/dfrClockCrew.seedRowIds), never
    // Date.now(): this effect re-runs every minute while someone is on the
    // clock, and a fresh id orphaned the row the super was correcting.
    let seeded: ManpowerEntry[];
    let source: { kind: 'clock' | 'schedule'; line: string } | null;
    if (clockCrew) {
      // The clock is the self-perform crew. Keep only the plan's SUB rows (a
      // task with an assigned company other than the GC's own) — a plan row
      // with no company was the planner's guess at this same self-perform crew,
      // and keeping it would count the trade twice.
      const own = (settings?.branding?.companyName ?? '').trim().toLowerCase();
      const subRows = planned.filter(g => g.company && g.company.toLowerCase() !== own);
      const clockIds = seedRowIds('clock', clockCrew.rows);
      const subIds = seedRowIds('sub', subRows);
      seeded = [
        ...clockCrew.rows.map((r, i) => ({
          id: clockIds[i], trade: r.trade, company: r.company, headcount: r.headcount, hoursWorked: r.hoursWorked,
        })),
        ...subRows.map((g, i) => ({
          id: subIds[i], trade: g.trade, company: g.company, headcount: g.headcount, hoursWorked: 8,
        })),
      ];
      source = { kind: 'clock', line: clockCrewSourceLine(clockCrew, subRows.length) };
    } else if (planned.length > 0) {
      const planIds = seedRowIds('plan', planned);
      seeded = planned.map((g, i) => ({
        id: planIds[i], trade: g.trade, company: g.company, headcount: g.headcount, hoursWorked: 8,
      }));
      source = {
        kind: 'schedule',
        // What this phone knows, not a fact about the site: it holds its own
        // clock-ins and the crew's rows it has pulled, and a pull can be
        // minutes old (integration round 1).
        line: 'From the schedule plan: no clock-ins for this job and day have reached this phone. Counts came from today\u2019s schedule and assume an 8-hour day — tap a row to correct it.',
      };
    } else {
      seeded = [];
      source = null;
    }

    // Nothing for this day: clear an untouched seed from the previous date
    // rather than leave another day's crew standing on this report.
    if (seeded.length === 0 && manpower.length === 0) return;
    autoSeedRef.current = seeded.length > 0 ? JSON.stringify(seeded) : null;
    setManpower(seeded);
    setAutoFilled(p => ({ ...p, manpower: seeded }));
    setCrewSource(source);
    // A roster the app wrote is not the super's work — see DFR-DIRTY-AUTOFILL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportDate, clockCrewSig]);

  /** Open the crew modal — blank to add, or loaded with a row to correct it. */
  const openManpowerEditor = useCallback((entry?: ManpowerEntry) => {
    setMpEditingId(entry?.id ?? null);
    setMpTrade(entry?.trade ?? '');
    setMpCompany(entry?.company ?? '');
    setMpHeadcount(entry ? String(entry.headcount) : '');
    setMpHours(entry ? String(entry.hoursWorked) : '8');
    setShowManpowerModal(true);
  }, []);

  const handleSaveManpower = useCallback(() => {
    const trade = mpTrade.trim();
    if (!trade) {
      showAlert('Missing Trade', 'Please enter a trade name.');
      return;
    }
    const fields = {
      trade,
      company: mpCompany.trim(),
      headcount: parseInt(mpHeadcount) || 1,
      hoursWorked: parseFloat(mpHours) || 8,
    };
    // Edit keeps the row's id and its position in the list: headcount ×
    // hoursWorked is what the owner reads on the portal and what the week's
    // man-hours are summed from, so a correction has to land ON the row it
    // corrects, not as a new row beside it.
    setManpower(prev => mpEditingId
      ? prev.map(m => (m.id === mpEditingId ? { ...m, ...fields } : m))
      : [...prev, { id: createId('mp'), ...fields }]);
    setMpEditingId(null);
    setMpTrade('');
    setMpCompany('');
    setMpHeadcount('');
    setMpHours('8');
    setShowManpowerModal(false);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [mpTrade, mpCompany, mpHeadcount, mpHours, mpEditingId]);

  const handleRemoveManpower = useCallback((id: string) => {
    const entry = manpower.find(m => m.id === id);
    const label = entry ? `${entry.headcount} ${entry.trade}${entry.company ? ' · ' + entry.company : ''}` : 'this entry';
    showAlert(
      'Remove crew entry?',
      `Remove ${label} from today's report?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setManpower(prev => prev.filter(m => m.id !== id));
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        } },
      ],
    );
  }, [manpower]);

  /**
   * ±1 on a crew row's headcount, from the row itself.
   *
   * The single most common correction on this screen — the roster is seeded
   * from the schedule's `crewSize`, which is a planning number, so "4 framers"
   * is regularly 3 who actually showed. One thumb tap, no keyboard, no dialog;
   * the modal is still there for trade, company and hours.
   *
   * Stepping BELOW one is not 0 workers on site — it is "this trade wasn't
   * here", which is the delete. Routed through the same confirm rather than
   * disabled, so the minus never becomes a dead control the super taps twice
   * wondering why nothing happened.
   */
  const adjustHeadcount = useCallback((id: string, delta: number) => {
    const entry = manpower.find(m => m.id === id);
    if (!entry) return;
    if (delta < 0 && entry.headcount <= 1) {
      handleRemoveManpower(id);
      return;
    }
    setManpower(prev => prev.map(m => (m.id === id ? { ...m, headcount: Math.max(1, m.headcount + delta) } : m)));
    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
  }, [manpower, handleRemoveManpower]);

  /**
   * Trade names this project has actually used, newest first — the schedule's
   * own `crew` / `assignedSubName` / phase labels plus every trade on a prior
   * report for this job.
   *
   * Free text is still allowed (the field is a TextInput; these are chips above
   * it), but a tap is what keeps the string CANONICAL. normalizeTradeKey
   * (utils/brain/laborSamples.ts) only lowercases, so "Framer", "framing" and
   * "Rough carpentry" are three different subs to everything downstream —
   * crewPresence's went-quiet chase, the labor samples the cost book learns
   * from, the man-hours rollup. Deliberately NOT sourced from
   * Subcontractor.trade: that field is a four-value coarse enum (HVAC /
   * Electrical / General / Other) and would seed a vocabulary the schedule
   * never uses.
   */
  const tradeSuggestions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string | undefined | null) => {
      const v = (raw ?? '').trim();
      if (!v || seen.size >= 10) return;
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
    };
    for (const t of project?.schedule?.tasks ?? []) add(t.crew || t.assignedSubName || t.phase);
    for (const r of existingReports) for (const m of r.manpower ?? []) add(m.trade);
    return Array.from(seen.values());
  }, [project?.schedule?.tasks, existingReports]);

  /** Company names already on this account — the sub roster plus whoever the
   *  schedule says is assigned here. Same reason: one spelling per sub. */
  const companySuggestions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string | undefined | null) => {
      const v = (raw ?? '').trim();
      if (!v || seen.size >= 10) return;
      const key = v.toLowerCase();
      if (!seen.has(key)) seen.set(key, v);
    };
    for (const t of project?.schedule?.tasks ?? []) add(t.assignedSubName);
    for (const s of subcontractors) add(s.companyName);
    return Array.from(seen.values());
  }, [project?.schedule?.tasks, subcontractors]);

  /** True while the roster is still exactly what the schedule seeded — nobody
   *  has corrected a number yet, so the block is showing the app's assumption
   *  and has to say so. */
  const manpowerIsUntouchedSeed = useMemo(
    () => manpower.length > 0 && autoSeedRef.current != null && JSON.stringify(manpower) === autoSeedRef.current,
    [manpower],
  );
  // Shown whether or not he has touched the roster, and repeated at save and
  // send: the "hours so far" caveat must not live only in the source chip,
  // which disappears on the first edit and never reaches the PDF or portal.
  const liveHoursWarning = useMemo(() => liveClockHoursWarning(clockCrew, manpower), [clockCrew, manpower]);
  // The clock's crew the roster does not carry. After a morning "Copy from
  // yesterday" (or any edit, or on reopen) the seed above stands down for
  // good, so people who clocked in later never reached the roster and the
  // signed report could contradict payroll silently. Said here, with a
  // one-tap add; never added over his count by itself.
  const clockGapLine = useMemo(() => clockRosterGapLine(clockRowsMissingFromRoster(clockCrew, manpower)), [clockCrew, manpower]);
  const addMissingClockRows = useCallback(() => {
    if (!clockCrew) return;
    setManpower(prev => addClockRowsToRoster(prev, clockCrew, settings?.branding?.companyName, r => r));
  }, [clockCrew, settings?.branding?.companyName]);

  const handleAddMaterial = useCallback(() => {
    const mat = newMaterial.trim();
    if (!mat) return;
    setMaterialsDelivered(prev => [...prev, mat]);
    setNewMaterial('');
  }, [newMaterial]);

  const handleRemoveMaterial = useCallback((idx: number) => {
    const item = materialsDelivered[idx];
    showAlert(
      'Remove material?',
      item ? `Remove "${item}" from today's deliveries?` : 'Remove this material?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          setMaterialsDelivered(prev => prev.filter((_, i) => i !== idx));
          if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
        } },
      ],
    );
  }, [materialsDelivered]);

  const handlePickPhoto = useCallback(async () => {
    const remaining = MAX_DFR_PHOTOS - photos.length;
    if (remaining <= 0) {
      showAlert('Limit Reached', `Maximum ${MAX_DFR_PHOTOS} photos per report.`);
      return;
    }
    // One dialog, N photos. `allowsMultipleSelection: false` used to make a GC
    // re-open the library once per shot for pictures he had already taken.
    const picked = await pickPhotoBatch({ remaining });
    if (picked.length === 0) return;
    // Library photos may have been taken anywhere / any time — we don't
    // pretend the *current* GPS reading represents where the picture was
    // taken. Geo-stamp only on camera capture, where "now" is correct.
    const takenAt = new Date().toISOString();
    setPhotos(prev => [...prev, ...picked.map((a): DFRPhoto => ({
      id: createId('photo'),
      uri: a.uri,
      timestamp: takenAt,
    }))]);
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [photos.length]);

  /**
   * Attach GPS to a photo that is ALREADY on screen.
   *
   * DFR-PHOTO-BLOCK (audit 2026-09-07 "worth doing" #10): this used to be
   * `const stamp = await stampPhotoLocation();` on the line directly beneath a
   * comment claiming the stamp ran in parallel "so it never blocks the photo".
   * It blocked. Worst case is ~4.5 s of nothing per shot — a 3 s fix race plus
   * a 1.5 s reverse-geocode — and that worst case is the NORMAL case in the
   * below-grade parking structure the super is standing in, because that is
   * exactly where the fix never lands and both timeouts run to the end. No
   * spinner, no photo, four and a half seconds, per shot, times twenty.
   *
   * Now the photo goes into state first and the coordinates are patched onto
   * it by id whenever (if ever) they arrive. A photo the user deleted while the
   * fix was still running is simply not found by the map, so a late stamp can
   * never resurrect it. A report submitted inside those few seconds saves
   * without coordinates — the same outcome as a fix that times out, which is
   * already the documented contract of stampPhotoLocation.
   */
  const stampPhotoById = useCallback((photoId: string) => {
    void stampPhotoLocation()
      .then(stamp => {
        if (!stamp) return;
        setPhotos(prev => prev.map(p => p.id === photoId ? {
          ...p,
          latitude: stamp.latitude,
          longitude: stamp.longitude,
          locationAccuracyMeters: stamp.accuracyMeters,
          locationLabel: stamp.label,
        } : p));
      })
      .catch(() => {/* stampPhotoLocation already swallows; belt and braces */});
  }, []);

  const handleTakePhoto = useCallback(async () => {
    const remaining = MAX_DFR_PHOTOS - photos.length;
    if (remaining <= 0) {
      showAlert('Limit Reached', `Maximum ${MAX_DFR_PHOTOS} photos per report.`);
      return;
    }
    // Burst: the camera re-opens after every shot until the super backs out or
    // the report is full. Each frame lands in the report the moment it is
    // taken, so a dropped phone mid-walk costs one photo, not the walk.
    const outcome = await captureBurst({
      remaining,
      onCaptured: ({ uri }) => {
        const photoId = createId('photo');
        setPhotos(prev => [...prev, { id: photoId, uri, timestamp: new Date().toISOString() }]);
        stampPhotoById(photoId);
      },
    });
    const note = burstSummary(outcome.captured, outcome.stoppedBy, `${MAX_DFR_PHOTOS}-photo`);
    if (note) {
      // Something the super did not choose ended the run — say so. A toast
      // when frames landed, a dialog when none did and the reason is fixable.
      if (outcome.captured > 0) nailIt(note);
      else showAlert('Camera', note);
    }
  }, [photos.length, stampPhotoById]);

  const handleRemovePhoto = useCallback((id: string) => {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }, []);

  // ─── Homeowner summary generation ───
  const handleGenerateHomeownerSummary = useCallback(async () => {
    if (!project) return;
    if (!workPerformed.trim() && !manpower.length && !issuesAndDelays.trim()) {
      showAlert(
        'Not enough to summarize yet',
        'Fill in at least the work performed, crew, or any issues — then I can write a homeowner-friendly version.',
      );
      return;
    }
    setHsGenerating(true);
    try {
      const ownerName = project.clientPortal?.invites?.[0]?.name?.split(' ')[0];
      const result = await generateHomeownerSummary({
        id: existingReport?.id ?? 'draft',
        projectId: project.id,
        // #115: the day this report is FOR (he may have re-dated it), not the
        // saved date or "now" — the prompt prints it as the update's day.
        date: reportDate,
        weather, manpower,
        workPerformed,
        materialsDelivered,
        issuesAndDelays,
        photos,
        status: 'draft',
        createdAt: existingReport?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, {
        projectName: project.name,
        companyName: settings?.branding?.companyName ?? 'Your contractor',
        ownerFirstName: ownerName,
        language: project.clientPortal?.homeownerLanguage,
      });
      setHomeownerSummary(result.summary);
      setHsHighlights(result.highlights ?? []);
      setHsLookingAhead(result.lookingAhead ?? '');
      setHsGeneratedAt(new Date().toISOString());
      setHsWrittenForDay(calendarDayOf(reportDate));
      // Generating overrides any prior published flag — GC must re-review.
      // (#22: that is an unsaved change like any other — the flag is in the
      // draft signature, so leaving now asks first.)
      setHsPublished(false);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      showAlert('Could not generate', e instanceof Error ? e.message : 'Try again in a moment.');
    } finally {
      setHsGenerating(false);
    }
  }, [project, workPerformed, manpower, materialsDelivered, issuesAndDelays, photos, weather, existingReport, settings, reportDate]);

  // ─── Profit Leak scan ───
  // Hash all three inputs the prompt scans so a materials-only change correctly
  // invalidates cached results and shows the 'Notes changed — re-scan' badge.
  const currentLeakHash = useMemo(
    () => hashLeakText(workPerformed, issuesAndDelays, materialsDelivered),
    [workPerformed, issuesAndDelays, materialsDelivered],
  );
  const leakIsStale = !!leakScan && leakScan.textHash !== currentLeakHash;

  const handleLeakScan = useCallback(async () => {
    if (!project) return;
    if (!project.linkedEstimate?.items?.length) {
      showAlert('No estimate to compare against', 'The scan flags work outside your estimate scope. Link an estimate to this project first.');
      return;
    }
    if (!workPerformed.trim() && !issuesAndDelays.trim()) {
      showAlert('Nothing to scan yet', "Fill in the work performed (or issues) first — that's the text the scan reads.");
      return;
    }
    // Set scanning state synchronously before any await so a double-tap finds
    // the button already disabled and cannot fire a second paid AI call.
    setLeakScanning(true);
    const limit = await checkAILimit(tier, 'fast', 'profitLeak');
    if (!limit.allowed) { setLeakScanning(false); setUpgradeLimit(limit); return; }

    try {
      const scope = buildScopeSummary(project, getChangeOrdersForProject(project.id));
      const hash = hashLeakText(workPerformed, issuesAndDelays, materialsDelivered);
      // Include a hash of the scope summary in the cacheKey so estimate / CO
      // changes also invalidate the 720h relay cache (not just text changes).
      const scopeHash = hashLeakText(scope, '', []);
      const res = await mageAI({
        prompt: buildLeakPrompt(scope, { workPerformed, issuesAndDelays, materialsDelivered }),
        tier: 'fast',
        maxTokens: 1200,
        feature: 'profitLeak',
        schemaHint: LEAK_SCHEMA_HINT,
        cacheKey: `leak_${stableReportId}_${hash}_${scopeHash}`,
        cacheHours: 720,
      });
      if (!res.success) {
        showAlert('Scan failed', res.error ?? 'Try again in a moment.');
        return;
      }
      const items = coerceLeakResult(res.data);
      const costDb = buildCostDatabase(projects, commitments, receipts, [], seeds);
      const record: LeakScanRecord = {
        items: priceLeakItems(items, costDb),
        scannedAt: new Date().toISOString(),
        textHash: hash,
      };
      setLeakScan(record);
      if (existingReport) updateDailyReport(existingReport.id, { leakScan: record });
      // G4: fire-and-forget capture — ledger failure must never break report save
      if (record.items.length > 0) {
        try {
          recordPrediction(
            'leak_flag',
            stableReportId,
            {
              reportId: stableReportId,
              items: record.items.slice(0, 12).map(it => ({
                category: it.trade,
                description: it.description,
                estPrice: it.estimatedPrice ?? null,
              })),
            },
            project?.id ?? null,
          );
        } catch { /* G4 */ }
      }
      if (!res.fromCache) void recordAIUsage('fast', 'profitLeak');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      setLeakScanning(false);
    }
  }, [project, workPerformed, issuesAndDelays, materialsDelivered, tier, projects, commitments, receipts, seeds, getChangeOrdersForProject, existingReport, updateDailyReport, stableReportId]);

  const handleDraftLeakCO = useCallback(() => {
    if (!projectId || !leakScan || leakScan.items.length === 0) return;
    // Guarded here too, not just on the button (#41): only the owner writes COs.
    if (!isProjectOwner) { showAlert('Change orders', DFR_GC_CREATES_COS); return; }

    // #76: the description the CLIENT reads is a neutral scope sentence; each
    // flagged item is its own line tagged with where its price came from
    // (CONTRACT 9). The internal quotes, the "~$" AI guesses and the "NEEDS
    // PRICE" notes used to go into the description — and so to the client.
    const when = dayOrInstantDate(reportDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const prefill = dfrLeakCoPrefill(leakScan.items, when);
    const doNavigate = () => router.push({
      pathname: '/change-order' as any,
      params: {
        projectId,
        prefillReason: 'out_of_scope',
        prefillDescription: prefill.prefillDescription,
        prefillLines: prefill.prefillLines,
      },
    });

    // Warn the GC when any flagged item has no learned price: it arrives as a
    // $0 line the change order refuses to send until it is priced.
    if (prefill.unpricedCount > 0) {
      showAlert(
        `${prefill.unpricedCount} flagged item${prefill.unpricedCount === 1 ? '' : 's'} have no learned price`,
        'Each one is a $0 line marked "needs price" in the change order. It can\u2019t go to your client until you price it. The priced lines are AI estimates you confirm before sending.',
        [
          { text: 'Review anyway', onPress: doNavigate },
          { text: 'Cancel', style: 'cancel' },
        ],
      );
    } else {
      doNavigate();
    }
  }, [projectId, leakScan, reportDate, router, isProjectOwner]);
  // ─── Delay cascade scan ───
  const scheduleTasks = useMemo<ScheduleTask[]>(() => project?.schedule?.tasks ?? [], [project]);

  // Mirrors app/(tabs)/schedule/index.tsx:283-287 — the schedule's own CPM options.
  const delayCpmOptions = useMemo(() => ({
    scheduleStartDate: project?.schedule?.startDate,
    workingDaysPerWeek: project?.schedule?.workingDaysPerWeek,
    nonWorkingDates: project?.schedule?.nonWorkingDates,
  }), [project?.schedule?.startDate, project?.schedule?.workingDaysPerWeek, project?.schedule?.nonWorkingDates]);

  // ScheduleDiffView reads exactly ctx.currentTasks + ctx.cpmOptions; the rest
  // satisfies the CopilotContext required fields (ctx is `any` by design).
  const diffCtx = useMemo<CopilotContext>(() => ({
    project: project ?? null,
    projectId: project?.id ?? '',
    ctx: null,
    tier,
    currentTasks: scheduleTasks,
    cpmOptions: delayCpmOptions,
  }), [project, tier, scheduleTasks, delayCpmOptions]);

  // Hydrate the persisted applied-delay markers. Cross-session guard: without
  // it, reopening the report and re-running the (cached) scan would re-offer
  // the already-applied delay with no memory of the apply. The whole map is
  // decoded rather than one report's entry, because the lookup is now by
  // (project + text hash) — a delay carried forward into a different report is
  // the same delay (DFR-DELAY-RECARRY, see the region at the top of the file).
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DELAY_APPLIED_STORE_KEY)
      .then(raw => {
        if (cancelled) return;
        const decoded: Record<string, AppliedDelayRecord> = {};
        for (const [k, v] of Object.entries(parseAppliedDelayMap(raw))) {
          const rec = decodeAppliedDelay(v);
          if (rec) decoded[k] = rec;
        }
        setAppliedDelays(decoded);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const liveDelayHash = useMemo(() => hashDelayText(issuesAndDelays), [issuesAndDelays]);
  // Rows were scanned from different text than what's on screen now.
  const delayRowsStale = delayScannedHash != null && delayScannedHash !== liveDelayHash;
  /** The applied ripple, if any, that this exact note already produced on this
   *  project — whichever report it was applied from. */
  const appliedForLiveText = useMemo(
    () => (projectId && issuesAndDelays.trim().length > 0
      ? appliedDelays[appliedDelayKey(projectId, liveDelayHash)] ?? null
      : null),
    [appliedDelays, projectId, liveDelayHash, issuesAndDelays],
  );
  /** Same lookup for the text the open rows were SCANNED from. */
  const appliedForScannedText = useMemo(
    () => (projectId && delayScannedHash ? appliedDelays[appliedDelayKey(projectId, delayScannedHash)] ?? null : null),
    [appliedDelays, projectId, delayScannedHash],
  );
  // This scan's text is exactly what was already applied to the schedule.
  const delayAlreadyApplied = appliedForScannedText != null && !delayReArmed;
  // APPLIED pill: applied this session, or a persisted marker matches the
  // live text (report reopened after an apply, or the note was carried
  // forward from the report the ripple was applied on).
  const showAppliedPill = delayApplied || appliedForLiveText != null;
  /**
   * Why the ripple is blocked, in the super's words.
   *
   * The generic "Already applied to the schedule." is right when he is looking
   * at the report he applied it on. When the note arrived by "Copy from
   * yesterday" it is not — he has no reason to believe today's report ever
   * moved anything, so the block has to name the day it came from before the
   * Re-arm button beside it means anything.
   */
  const appliedNoticeText = useMemo(() => {
    const rec = appliedForScannedText;
    if (!rec) return 'Already applied to the schedule.';
    if (rec.reportId === stableReportId) return 'Already applied to the schedule.';
    const day = carrySourceDayAbsolute(rec.reportDate);
    const n = rec.taskIds.length;
    const what = n === 0 ? 'the same tasks' : n === 1 ? 'that task' : `those ${n} tasks`;
    return `Already applied to the schedule from ${day} — applying it again would move ${what} a second time.`;
  }, [appliedForScannedText, stableReportId]);

  // Editing the issues text invalidates an open ripple preview — its ops were
  // built from rows that no longer describe the text.
  useEffect(() => {
    if (delayScannedHash != null && hashDelayText(issuesAndDelays) !== delayScannedHash) {
      setDelayPreviewOps(null);
    }
  }, [issuesAndDelays, delayScannedHash]);

  const handleDelayScan = useCallback(async () => {
    if (!project?.schedule || scheduleTasks.length === 0) return;
    if (!issuesAndDelays.trim()) {
      showAlert('Nothing to scan yet', "Note the delay under Issues & Delays first — that's the text the scan reads.");
      return;
    }
    // Re-entry guard + busy state BEFORE the first await: checkAILimit is a
    // network round-trip, and a double tap in that window used to fire two
    // paid scans (and bump the daily counter twice) for one user action.
    if (delayScanBusyRef.current) return;
    delayScanBusyRef.current = true;
    setDelayScanning(true);
    setDelayPreviewOps(null);
    try {
      const limit = await checkAILimit(tier, 'fast', 'delayScan');
      if (!limit.allowed) { setUpgradeLimit(limit); return; }
      const res = await mageAI({
        prompt: buildDelayPrompt(issuesAndDelays, scheduleTasks.map(t => t.title)),
        tier: 'fast',
        maxTokens: 800,
        feature: 'delayScan',
        schemaHint: DELAY_SCHEMA_HINT,
        cacheKey: `delay_${stableReportId}_${hashDelayText(issuesAndDelays)}`,
      });
      if (!res.success) {
        // Keep the previous rows AND the applied indication intact — a failed
        // re-scan must not present an un-applied state for an applied ripple.
        showAlert('Scan failed', res.error ?? 'Try again in a moment.');
        return;
      }
      const scannedHash = hashDelayText(issuesAndDelays);
      const { hits } = coerceDelayResult(res.data);
      setDelayRows(hits.map(h => ({
        quote: h.quote,
        deltaDays: h.deltaDays,
        taskId: matchTaskByTitle(h.taskTitleGuess, scheduleTasks)?.id ?? null,
      })));
      setDelayScannedHash(scannedHash);
      setDelayReArmed(false);
      // Re-scanning unchanged, already-applied text keeps the applied flag;
      // new/changed text clears it. (Lives in the SUCCESS path so a failed
      // scan can't wipe the APPLIED pill.)
      setDelayApplied(appliedDelays[appliedDelayKey(projectId, scannedHash)] != null);
      if (!res.fromCache) void recordAIUsage('fast', 'delayScan');
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } finally {
      delayScanBusyRef.current = false;
      setDelayScanning(false);
    }
  }, [project, projectId, scheduleTasks, issuesAndDelays, tier, stableReportId, appliedDelays]);

  const confirmableRows = useMemo(
    () => (delayRows ?? []).filter((r): r is DelayRow & { taskId: string } => !!r.taskId && r.deltaDays > 0),
    [delayRows],
  );

  /**
   * Why this user cannot move the schedule from here, or null when they can.
   *
   * A ripple moves task DATES, and it goes out as a PATCH of the projects row,
   * which projects_update admits only for the owner or an editor. For a field
   * or viewer collaborator PostgREST refused it with 200 + 0 rows: the preview
   * said "applied", the finish date never moved, and a delay claim had no
   * schedule record behind it (#25). Field access writes progress through its
   * own server function, and that function deliberately refuses dates — so the
   * ripple is blocked for those roles, and the button says why.
   */
  const delayRippleBlockedReason = useMemo(() => {
    const path = scheduleWritePathForRole(project?.myRole);
    if (path === 'row') return null;
    return path === 'field_rpc'
      ? 'Field access can\u2019t move schedule dates. The delay stays on this report — ask the project owner or an editor to apply the ripple.'
      : 'View-only access can\u2019t move schedule dates. Ask the project owner to apply the ripple.';
  }, [project?.myRole]);

  const handlePreviewRipple = useCallback(() => {
    // Guarded in the handler too (not just the disabled prop): stale rows
    // describe text that changed since the scan, and an already-applied scan
    // must be explicitly re-armed before it can move the schedule again.
    if (confirmableRows.length === 0 || delayRowsStale || delayAlreadyApplied || delayRippleBlockedReason) return;
    setDelayPreviewOps(confirmableRows.map(r => ({ op: 'move' as const, task: r.taskId, deltaDays: r.deltaDays })));
  }, [confirmableRows, delayRowsStale, delayAlreadyApplied, delayRippleBlockedReason]);

  const handleApplyRipple = useCallback(() => {
    const schedule = project?.schedule;
    if (!project || !schedule || !delayPreviewOps) return;
    // Same gate as the preview button: never report a ripple the database
    // will refuse for this role.
    if (delayRippleBlockedReason) {
      showAlert('Schedule not changed', delayRippleBlockedReason);
      setDelayPreviewOps(null);
      return;
    }
    // Recompute exactly what ScheduleDiffView previewed (it computes internally
    // from ops + ctx; onApply hands us nothing).
    const { nextTasks } = interpretScheduleOps(delayPreviewOps, schedule.tasks, delayCpmOptions);
    const edited = applyEditEffects(delayPreviewOps, nextTasks, delayCpmOptions);
    // persistEditedTasks pattern (app/(tabs)/schedule/index.tsx:447-473):
    // reflow startDays via CPM, re-derive the scalar fields, merge over a
    // spread of the schedule so sidecar fields (startDate, calendars,
    // scenarios, baseline, …) survive. NEVER touch schedule.startDate.
    const reflowed = applyToProjectSchedule(schedule, edited, delayCpmOptions).tasks;
    const cpmResult = runCpm(reflowed, delayCpmOptions);
    const built = buildScheduleFromTasks(
      schedule.name ?? project.name ?? 'Schedule',
      project.id,
      reflowed,
      schedule.baseline ?? null,
      { criticalPathDays: cpmResult.projectFinish },
    );
    updateProject(project.id, {
      schedule: {
        ...schedule,
        tasks: reflowed,
        totalDurationDays: built.totalDurationDays,
        criticalPathDays: built.criticalPathDays,
        healthScore: built.healthScore,
        laborAlignmentScore: built.laborAlignmentScore,
        riskItems: built.riskItems,
        updatedAt: new Date().toISOString(),
      },
    });
    setDelayPreviewOps(null);
    // Disarm the confirm rows — the ops are RELATIVE moves, so a re-tap
    // through preview→apply would shift the same tasks again.
    setDelayRows(null);
    setDelayApplied(true);
    setDelayReArmed(false);
    // Persist the applied marker (separate mageid_delay_applied store — NOT a
    // report field, which sync rehydration would wipe) so re-scanning the same
    // text renders "already applied" instead of re-offering the same ripple —
    // in this report, and in any report the note is carried forward into.
    //
    // The record also carries what was applied. handleApplyRipple clears
    // delayRows two lines above (the ops are relative moves, so live rows are
    // a loaded gun), which means the moment "already applied" is true the days
    // and the task ids are gone from state — and those are exactly the two
    // facts the delay register asks for. Storing them here is what lets the
    // handoff below stay enriched after the apply, and across a reopen.
    const appliedHash = delayScannedHash ?? hashDelayText(issuesAndDelays);
    const appliedMoves = delayPreviewOps.filter((op): op is EditOp & { op: 'move'; task: string; deltaDays?: number } => op.op === 'move');
    const appliedRecord: AppliedDelayRecord = {
      hash: appliedHash,
      reportId: stableReportId,
      reportDate,
      // The largest single slip, not the sum: the moves are parallel task
      // shifts, so adding them up would claim more days than the schedule
      // actually lost.
      deltaDays: appliedMoves.reduce((max, op) => Math.max(max, op.deltaDays ?? 0), 0),
      taskIds: appliedMoves.map(op => op.task),
    };
    const storeKey = appliedDelayKey(project.id, appliedHash);
    setAppliedDelays(prev => ({ ...prev, [storeKey]: appliedRecord }));
    AsyncStorage.getItem(DELAY_APPLIED_STORE_KEY)
      .then(raw => AsyncStorage.setItem(
        DELAY_APPLIED_STORE_KEY,
        // withAppliedDelay is a plain immutable upsert into a
        // Record<string, string> — the key is ours, the value is the encoded
        // record (see decodeAppliedDelay for what tolerates the legacy shape).
        JSON.stringify(withAppliedDelay(parseAppliedDelayMap(raw), storeKey, encodeAppliedDelay(appliedRecord))),
      ))
      .catch(() => {});
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    // G4: fire-and-forget capture — ledger failure must never break ripple apply
    try {
      const hits = delayPreviewOps
        .filter((op): op is { op: 'move'; task: string; deltaDays?: number; toStartDay?: number } => op.op === 'move')
        .map(op => {
          // preApplyEndDay: the task's planned end in the PRE-apply schedule
          // (`schedule` is captured before the reflow above). Additive payload
          // field — gradeDelayRipple uses it to grade the predicted shift
          // itself; without it the grader falls back to post-apply semantics.
          const preTask = schedule.tasks.find(t => t.id === op.task);
          return {
            taskId: op.task,
            deltaDays: op.deltaDays ?? 0,
            ...(preTask
              ? { preApplyEndDay: preTask.startDay + Math.max(0, preTask.durationDays - 1) }
              : {}),
          };
        });
      recordPrediction(
        'delay_ripple_applied',
        stableReportId,
        {
          reportId: stableReportId,
          hits,
          predictedFinishDay: cpmResult.projectFinish,
        },
        project.id,
      );
    } catch { /* G4 */ }
    // Wave 6 did-for-you: one line per ripple apply
    try {
      const hitCount = delayPreviewOps.length;
      recordDidForYou(
        `Rippled ${hitCount} task${hitCount === 1 ? '' : 's'} from your delay note`,
        project.id,
      );
    } catch { /* G4 */ }
  }, [project, delayPreviewOps, delayCpmOptions, updateProject, delayScannedHash, issuesAndDelays, stableReportId, reportDate, delayRippleBlockedReason]);

  const totalManpower = useMemo(() => {
    return manpower.reduce((sum, m) => sum + m.headcount, 0);
  }, [manpower]);

  // Workforce role rollup — bucket each manpower entry's `trade` into one of
  // four high-level roles (Supervisors / Skilled Labor / Operators / Other),
  // then sum headcount per bucket. Surfaces as 4 tiles above the manpower
  // entries so the GC sees the day's labor mix at a glance — the mock's
  // "premium DFR" pattern.
  const workforceByRole = useMemo(() => {
    const buckets = { supervisors: 0, skilled: 0, operators: 0, other: 0 };
    for (const m of manpower) {
      const t = (m.trade ?? '').toLowerCase();
      if (/super(visor|intend|visor)|foreman|pm|project manager|site manager/.test(t)) {
        buckets.supervisors += m.headcount;
      } else if (/operator|driver|crane|excav|loader|forklift|dozer/.test(t)) {
        buckets.operators += m.headcount;
      } else if (/laborer|helper|cleaner|generic|misc/.test(t)) {
        buckets.other += m.headcount;
      } else {
        // Default trades (Carpentry, Electrical, Plumbing, HVAC, Concrete,
        // Masonry, Roofing, Drywall, Painting, Framer, etc.) → skilled.
        buckets.skilled += m.headcount;
      }
    }
    return buckets;
  }, [manpower]);

  const totalManHours = useMemo(() => dfrManHours(manpower), [manpower]);

  /**
   * This screen's own record, once it exists — even when the route never
   * carried a reportId.
   *
   * A brand-new report is saved under `stableReportId`, and `existingReport`
   * only ever looks up the route param, so after a silent save (the
   * delay-event handoff below) the screen still believed it had never been
   * written. The next Save would take the CREATE branch again and
   * addDailyReport would push a second row with the same id — a duplicate day
   * locally and a primary-key collision on sync. Looking the id up in the live
   * list answers the question directly.
   */
  const persistedSelf = useMemo(
    () => existingReports.find(r => r.id === stableReportId) ?? null,
    [existingReports, stableReportId],
  );

  // `silent` writes the record and nothing else — no haptic, no toast, no
  // navigation. handleConfirmSend uses it to get the day on disk BEFORE it
  // tries to deliver anything, and owns the outcome message itself.
  /**
   * The voice fill, shared by the mic and the tutorial's sample note. One body
   * so the sample can never fill the form differently from the real thing —
   * the tutorial would otherwise teach a screen that does not exist.
   *
   * `metered` is the only difference: the mic path spent an AI call
   * (parseDFRFromTranscript), so it is counted against his voiceCapture
   * allowance exactly as before; the sample note is a canned parse
   * (utils/tutorial/fixtures DFR_SAMPLE_NOTE) that made no AI call, so it
   * costs nothing and the meter does not move. Every field only fills when it
   * is empty — anything he already typed is never overwritten.
   */
  const applyParsedDfr = useCallback(async (
    parsed: Partial<DailyFieldReport>,
    opts: { metered: boolean; source: 'mic' | 'sample' },
  ) => {
    // Track what was filled this round — used to build the
    // preview card so the GC can verify before saving.
    const populated: typeof voiceParsed = {};
    // Which sections this note actually wrote — the tutorial's stat says
    // "3 sections from one note" from this list, never from a guess.
    const fields: string[] = [];
    if (parsed.weather && !weather.temperature) {
      // isManual TRUE: dictated weather is the super's own account
      // of the day, not a reading from a weather service. The
      // parser defaults it to false (utils/voiceDFRParser.ts), which
      // would put the "fetched" flag on a sentence he spoke —
      // DFR-WEATHER-DAY's lie by a different route.
      setWeather({ ...parsed.weather, isManual: true });
      populated.weather = { temperature: parsed.weather.temperature, conditions: parsed.weather.conditions };
      fields.push('weather');
    }
    if (parsed.manpower && manpower.length === 0) {
      setManpower(parsed.manpower);
      const total = parsed.manpower.reduce((s, m) => s + (m.headcount ?? 0), 0);
      const trades = parsed.manpower.map(m => `${m.headcount ?? 0} ${m.trade?.toLowerCase() ?? 'workers'}`).join(', ');
      populated.crewSummary = total > 0 ? trades : undefined;
      fields.push('manpower');
    }
    if (parsed.workPerformed && !workPerformed) {
      setWorkPerformed(parsed.workPerformed);
      populated.workPerformed = parsed.workPerformed;
      fields.push('workPerformed');
    }
    if (parsed.materialsDelivered && materialsDelivered.length === 0) {
      setMaterialsDelivered(parsed.materialsDelivered);
      populated.materialsDelivered = parsed.materialsDelivered;
      fields.push('materialsDelivered');
    }
    if (parsed.issuesAndDelays && !issuesAndDelays) {
      setIssuesAndDelays(parsed.issuesAndDelays);
      populated.issuesAndDelays = parsed.issuesAndDelays;
      fields.push('issuesAndDelays');
    }
    setVoiceParsed(Object.keys(populated).length > 0 ? populated : null);
    setShowVoiceBanner(true);
    if (opts.metered) {
      await recordAIUsage('fast', 'voiceCapture');
      setGateRefresh(n => n + 1);
    }
    // The tutorial's real success point for the voice step. Only when the
    // note actually filled something: the next card says "one note filled
    // crew, work done and the delay", and a note that filled nothing must not
    // be told it did. A no-op when no tutorial runs (and ignored off the sample).
    if (projectId && fields.length > 0) tutorialSignal('dfr.voice.applied', { projectId, fields, source: opts.source });
  }, [weather.temperature, manpower.length, workPerformed, materialsDelivered.length, issuesAndDelays, projectId]);

  // ── Tutorial: the sample voice note (daily-report-voice, step dfr-voice) ──
  // Rendered ONLY while that step is live on the tutorial's sample job, beside
  // the real mic (one spotlight hole covers both). It is the web path — the
  // web VoiceRecorder is disabled — and on iPhone it spares a first-run user a
  // microphone prompt. The mic stays live and metered.
  const tutorialSandboxId = useTutorialSandboxId();
  const onTutorialSample = !!projectId && tutorialSandboxId === projectId;
  const sampleNoteStepLive = useTutorialStepActive('dfr-voice');
  const showSampleNote = onTutorialSample && sampleNoteStepLive;
  const applySampleNote = useCallback(() => {
    if (!onTutorialSample) return;
    // Fresh row ids: a replay on the same sample must not reuse the fixture's.
    const parsed: Partial<DailyFieldReport> = {
      ...DFR_SAMPLE_NOTE.parsed,
      manpower: (DFR_SAMPLE_NOTE.parsed.manpower ?? []).map(m => ({ ...m, id: createId('mp') })),
    };
    void applyParsedDfr(parsed, { metered: false, source: 'sample' });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [onTutorialSample, applyParsedDfr]);
  // 'Do it for me' on the voice step: the same fill the chip does. Never saves.
  useTutorialAssist('dfr.useSampleNote', applySampleNote);
  // The form's ScrollView, so the coach can scroll a target into view
  // (TutorialScrollAnchor wraps its content).
  const dfrScrollRef = useRef<ScrollView>(null);

  const handleSave = useCallback((status: 'draft' | 'sent', recipientName?: string, recipientEmail?: string, opts?: { silent?: boolean }) => {
    if (!projectId) return;
    const silent = opts?.silent === true;
    // The record to UPDATE, if there is one. See persistedSelf above: a report
    // this screen already wrote silently is an update, not a second insert.
    const savedRecord = existingReport ?? persistedSelf;
    // Never write a form that does not hold the saved report. The gate above
    // only mounts this editor once a named report has loaded, but if it has
    // since vanished from state (deleted on another device, an account swap
    // mid-screen) these fields are no longer its content — saving them would
    // write a blank or foreign day over it, or file a duplicate.
    if (reportId && !existingReport) {
      showAlert('Not saved', "This report isn't loaded on this device any more, so saving now could overwrite it with an empty form. Go back and open it again.");
      return;
    }
    // A submitted report is locked. Saving it as a draft would put this form
    // over the sent record AND downgrade it to a draft the client portal no
    // longer shows; the only draft save on a sent report is a mistake. (The
    // silent pre-send write is exempt: a re-send flips it back to 'sent' once
    // delivery succeeds — see sentFlip below.)
    if (status === 'draft' && !silent && savedRecord?.status === 'sent') {
      showAlert('Already submitted', 'This report was submitted, so it is locked. Nothing was changed.');
      return;
    }

    const now = new Date().toISOString();
    // #116: a field or viewer seat never changes what the homeowner sees. The
    // controls are disabled for him; this is the write-side half, and it is
    // exactly what the server trigger (20260919140000) keeps: the saved flag,
    // and the saved text while it is published. His own unpublished draft of a
    // summary is still saved for the GC to review.
    const savedPublished = savedRecord?.homeownerSummaryPublished ?? false;
    const hsPublishedOut = publishAccess.allowed ? hsPublished : savedPublished;
    const hsSummaryOut = !publishAccess.allowed && savedPublished
      ? savedRecord?.homeownerSummary
      : (homeownerSummary.trim() || undefined);
    const recipientInfo = recipientName ? ` to ${recipientName}${recipientEmail ? ` (${recipientEmail})` : ''}` : '';

    const incidentPayload: IncidentReport | undefined = incident.hasIncident
      ? {
          ...incident,
          description: (incident.description ?? '').trim(),
          peopleInvolved: (incident.peopleInvolved ?? '').trim(),
          correctiveAction: (incident.correctiveAction ?? '').trim(),
          reportedBy: (incident.reportedBy ?? '').trim(),
          reportedAt: incident.reportedAt ?? now,
          // Derived, never self-certified. The three booleans on IncidentReport
          // are now outputs of the classifier rather than checkboxes: the super
          // answers what happened (type, treatment, days, restriction) and the
          // app answers whether 1904 records it.
          // #122: with the classification locked (someone else's case) the
          // blank pickers decide nothing — the saved report's flags stand.
          ...(classificationKnown
            ? {
                injuriesReported: incidentClassInput.type === 'injury',
                medicalTreatment: incidentClassInput.treatment === 'medical_beyond_first_aid',
                oshaRecordable: recordability.recordable,
              }
            : {
                injuriesReported: savedRecord?.incident?.injuriesReported,
                medicalTreatment: savedRecord?.incident?.medicalTreatment,
                oshaRecordable: savedRecord?.incident?.oshaRecordable,
              }),
        }
      : undefined;

    // DFR-OSHA-BRIDGE. The register case, written alongside the report — one
    // record, two views, no re-entry. Before this, `DailyFieldReport.incident`
    // had exactly one consumer in the whole repo (utils/oacEngine.ts, which
    // turns it into a meeting talking point), so an injury written here was
    // invisible to app/safety-incidents.tsx and to buildOsha300Log, and the
    // OSHA 300 screen's own empty state told him to go type it a second time
    // from memory.
    //
    // The case is written on EVERY save, draft included: a draft daily report is
    // still a contemporaneous record of an injury, and holding the case back
    // until he taps Send is how it goes missing. The write goes through
    // SafetyContext (and therefore through supabaseWrite / the offline queue),
    // which is not tier-gated — the record he typed is his at any tier, even
    // though the Incidents log and the OSHA 300 export are Business surfaces.
    // #89: the owner deleted this report's case in Incidents. Re-saving the
    // report must not quietly file it again (addIncident refuses a tombstoned
    // id anyway); the Safety block says so and offers "File it again".
    // #122: never a blind insert under another author's case id — the pkey
    // duplicate was counted as success and his change vanished.
    if (incident.hasIncident && projectId && !caseDeletedInLog && !caseNotYoursReason) {
      const buildCase = (linked: SafetyIncident | null, classification: IncidentClassInput, daysRestricted: number) => buildSafetyIncidentFromDfr({
        reportId: stableReportId,
        projectId,
        // The day the report is FOR, not "now" — a backfilled report must not
        // file its case against today, or the 300 carries the wrong date and
        // the year filter drops it into the wrong log year.
        occurredOn: calendarDayOf(reportDate) ?? reportDate.slice(0, 10),
        severity: incident.severity,
        description: (incident.description ?? '').trim(),
        peopleInvolved: (incident.peopleInvolved ?? '').trim(),
        correctiveAction: (incident.correctiveAction ?? '').trim(),
        reportedBy: (incident.reportedBy ?? '').trim(),
        // SafetyIncident.location is required and the DFR has no location field.
        // The project's own site address stands in; an empty one stays empty
        // rather than being invented.
        location: project?.location ?? '',
        // #87: only the photos he marked as incident photos, each as a DURABLE
        // storage path (never a file:// the office can't open). The builder
        // merges them into what the case already holds (#83).
        photoUrls: dfrIncidentPhotoUrls(photos as DfrPhotoWithFlag[], stageIncidentPhoto, MAX_INCIDENT_PHOTOS),
        classification,
        daysRestricted,
        author: incidentAuthor,
        now,
        existingCreatedAt: linked?.createdAt,
        // A case the safety manager has already moved to 'investigating' must
        // not snap back to 'open' because the super fixed a typo in the report.
        existingStatus: linked?.status,
      // #83: merge INTO the case the log already holds — people, actions,
      // photos and the illness column the safety manager added survive a
      // re-save of the report.
      }, linked);
      if (caseLogLoading) {
        // #122: held until the log loads, then decided with the case in hand
        // — never an insert over a case this phone simply hasn't read yet.
        // The pickers were loading (not editable), so a case the log holds
        // keeps its own classification; the report's text, photos and status
        // are what this save changes.
        const isOwner = isProjectOwner;
        const filedByUserId = existingReport?.filedByUserId;
        const viewerId = user?.id;
        const authorPossessive = filedBy.possessive;
        const screenClass = incidentClassInput;
        const screenDaysRestricted = Math.max(0, parseInt(incidentClass.daysRestricted, 10) || 0);
        fileCaseWhenHydrated(dfrCaseId, (linked) => {
          if (dfrCaseNotYoursReason({ caseVisible: !!linked, caseDeleted: false, isOwner, savedHadIncident, filedByUserId, viewerId, authorPossessive })) return null;
          return linked
            ? buildCase(linked, dfrClassOfCase(linked), linked.daysRestricted)
            : buildCase(null, screenClass, screenDaysRestricted);
        });
      } else {
        const caseRecord = buildCase(linkedIncident, incidentClassInput, Math.max(0, parseInt(incidentClass.daysRestricted, 10) || 0));
        if (linkedIncident) updateIncident(caseRecord.id, caseRecord);
        else addIncident(caseRecord);
      }
    }

    if (savedRecord) {
      updateDailyReport(savedRecord.id, {
        date: reportDate,  // honor the user-picked date on edit too
        weather,
        manpower,
        workPerformed: workPerformed.trim(),
        workProgress: workProgress.length > 0 ? workProgress : undefined,
        materialsDelivered,
        issuesAndDelays: issuesAndDelays.trim(),
        photos,
        status,
        incident: incidentPayload,
        homeownerSummary: hsSummaryOut,
        homeownerSummaryGeneratedAt: hsGeneratedAt,
        homeownerSummaryPublished: hsPublishedOut,
        leakScan: leakScan ?? undefined,
      });
      // Mirror NEW photos into the project gallery on edit too — previously
      // this only happened in the create branch, so photos added while
      // editing an existing report never reached the gallery. Diff against
      // the report's already-saved photo ids so we don't re-add (duplicate)
      // photos that were mirrored on the original save. Same payload shape
      // as the create branch below.
      const alreadyMirrored = new Set((savedRecord.photos ?? []).map(p => p.id));
      for (const p of photos) {
        if (alreadyMirrored.has(p.id)) continue;
        addProjectPhoto({
          id: p.id,
          projectId,
          uri: p.uri,
          timestamp: p.timestamp,
          tag: 'Daily Report',
          createdAt: p.timestamp,
          // #59: a field/viewer seat's photos wait for the GC's review too.
          portalState: dfrNewPortalState(publishAccess.allowed),
          // #65 (CONTRACT 18): carry the capture-time GPS stamp into the
          // gallery row — photos.latitude/… are synced columns now, so the
          // map and "where was this taken" survive a reload.
          ...dfrPhotoGeo(p),
        });
      }
      if (!silent) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showAlert('Updated', `Daily report has been ${status === 'sent' ? `sent${recipientInfo}` : 'saved to project'}.`);
        // Tutorial success point (a re-save during a replay lands here).
        // Emitted before goBack() below so the coach never flashes "paused".
        tutorialSignal('dfr.saved', {
          projectId, reportId: savedRecord.id, status, date: reportDate,
          crew: manpower.reduce((n, m) => n + (m.headcount ?? 0), 0),
        });
      }
    } else {
      const report: DailyFieldReport = {
        id: stableReportId,  // stable id — also used as the PDF filename
                             // in the project-documents bucket so re-saves
                             // overwrite in place
        projectId,
        date: reportDate,  // user-picked date instead of "now" — pre-fix
                           // a report typed on Tuesday for Monday's work
                           // was misfiled as Tuesday's record
        weather,
        manpower,
        workPerformed: workPerformed.trim(),
        workProgress: workProgress.length > 0 ? workProgress : undefined,
        materialsDelivered,
        issuesAndDelays: issuesAndDelays.trim(),
        photos,
        status,
        incident: incidentPayload,
        homeownerSummary: hsSummaryOut,
        homeownerSummaryGeneratedAt: hsGeneratedAt,
        homeownerSummaryPublished: hsPublishedOut,
        leakScan: leakScan ?? undefined,
        createdAt: now,
        updatedAt: now,
        // #59/#133 (interim): a field/viewer seat's report lands as a draft the
        // GC reviews — the server forces the same (20260920140000).
        portalState: dfrNewPortalState(publishAccess.allowed),
      };
      addDailyReport(report);
      // Sync DFR photos into project photo gallery
      for (const p of photos) {
        addProjectPhoto({
          id: p.id,
          projectId,
          uri: p.uri,
          timestamp: p.timestamp,
          tag: 'Daily Report',
          createdAt: p.timestamp,
          portalState: dfrNewPortalState(publishAccess.allowed),
          ...dfrPhotoGeo(p),
        });
      }
      if (!silent) {
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // The hammer-strike toast confirms without blocking the back nav.
        nailIt(status === 'sent' ? `Daily report sent${recipientInfo}` : 'Daily report saved.');
        // Tutorial success point — the real save, right after addDailyReport,
        // on the non-silent path only (the pre-send write is silent and is
        // not the user's Save). Before goBack() so the coach's next card is
        // the hub, not a one-frame "paused". A no-op when no tutorial runs.
        tutorialSignal('dfr.saved', {
          projectId, reportId: report.id, status, date: reportDate,
          crew: manpower.reduce((n, m) => n + (m.headcount ?? 0), 0),
        });
      }
    }
    if (!silent && liveHoursWarning) showAlert('Saved with hours so far', liveHoursWarning);
    // The record is on disk, so the unsaved-work draft has nothing left to
    // protect. Cleared here rather than left to the debounced effect below,
    // whose timer is cancelled by the navigation on the next line.
    void AsyncStorage.removeItem(draftKey).catch(() => {});
    if (!silent) goBack();
  }, [projectId, reportId, weather, manpower, workPerformed, workProgress, materialsDelivered, issuesAndDelays, photos, incident, existingReport, persistedSelf, homeownerSummary, hsGeneratedAt, hsPublished, publishAccess.allowed, leakScan, addDailyReport, updateDailyReport, addProjectPhoto, goBack, reportDate, stableReportId, draftKey,
      incidentClassInput, incidentClass.daysRestricted, recordability.recordable, linkedIncident,
      addIncident, updateIncident, incidentAuthor, project?.location, liveHoursWarning,
      caseDeletedInLog, stageIncidentPhoto, caseNotYoursReason, classificationKnown,
      caseLogLoading, fileCaseWhenHydrated, dfrCaseId, savedHadIncident, isProjectOwner, user?.id, filedBy.possessive]);

  /**
   * "Log this as a delay event" — hand the register what this screen already
   * worked out.
   *
   * The register opened blank: four params (project, date, the note, and an
   * evidence pointer only when the report happened to be saved already). So it
   * asked him how many days and which activities — the two numbers the screen
   * directly above it had just calculated and, in the applied case, already
   * moved his schedule by. He types a round number from memory or skips the
   * field, and the register built to win the argument carries a weaker version
   * of a fact the app had exactly right an hour earlier.
   *
   * Three things ride along now:
   *   • claimedDays / impactedTaskIds — from the APPLIED record when there is
   *     one (it survives the apply clearing the rows, and a reopen), otherwise
   *     from the live confirmed rows. Nothing is sent when neither exists;
   *     an empty field he fills in is honest, an invented number is not.
   *   • cause — only when his own text names weather (inferDelayCauseFromText).
   *   • evidence — always, by saving the report first. It used to be dropped
   *     silently on an unsaved report, which is precisely the common case: he
   *     writes the delay and logs it before he ever taps Save.
   */
  const handleLogDelayEvent = useCallback(() => {
    const text = issuesAndDelays.trim();
    if (!text) return;
    if (!projectId) {
      // Reached from the sidebar or a deep link with no project picked. Saying
      // so beats a button that looks live and does nothing — the register
      // itself refuses the same way ("A delay event has to belong to a job").
      showAlert('Pick a project first', 'A delay event has to belong to a job — choose one at the top of this report.');
      return;
    }
    // `silent` writes the record without a toast or a nav — the screen stays
    // where it is and the evidence pointer below is real rather than hopeful.
    if (!existingReport && !persistedSelf) handleSave('draft', undefined, undefined, { silent: true });
    const claimedDays = appliedForLiveText
      ? appliedForLiveText.deltaDays
      : confirmableRows.reduce((max, r) => Math.max(max, r.deltaDays), 0);
    const taskIds = appliedForLiveText ? appliedForLiveText.taskIds : confirmableRows.map(r => r.taskId);
    const cause = inferDelayCauseFromText(text);
    router.push({
      pathname: '/delay-events',
      params: {
        projectId,
        autoLog: '1',
        firstObservedDate: reportDate,
        description: text,
        ...(cause ? { cause } : null),
        ...(claimedDays > 0 ? { claimedDays: String(claimedDays) } : null),
        // The one param the register does not read yet — its log form still
        // writes impactedTaskIds: []. The ids are only knowable on this side,
        // an unrecognised param is inert on arrival, and the reading half
        // (plus a manual task multi-select for the events that don't come from
        // a scan) belongs to app/delay-events.tsx.
        ...(taskIds.length > 0 ? { impactedTaskIds: taskIds.join(',') } : null),
        evidenceKind: 'daily_report',
        evidenceId: stableReportId,
        evidenceAt: reportDate,
      },
    });
  }, [projectId, issuesAndDelays, reportDate, stableReportId, existingReport, persistedSelf, handleSave, appliedForLiveText, confirmableRows, router]);

  /** What the delay-event button says it is carrying. Naming the numbers is
   *  the difference between a button he trusts and one he re-checks. */
  const delayEventBtnLabel = useMemo(() => {
    if (appliedForLiveText) {
      const n = appliedForLiveText.taskIds.length;
      const d = appliedForLiveText.deltaDays;
      const parts = [
        d > 0 ? `${d} day${d === 1 ? '' : 's'}` : null,
        n > 0 ? `${n} task${n === 1 ? '' : 's'}` : null,
      ].filter(Boolean).join(', ');
      return parts
        ? `Log as a delay event — ${parts}, already applied to the schedule`
        : 'Log as a delay event — already applied to the schedule';
    }
    if (confirmableRows.length > 0) {
      const d = confirmableRows.reduce((max, r) => Math.max(max, r.deltaDays), 0);
      const n = confirmableRows.length;
      return `Log as a delay event — ${d} day${d === 1 ? '' : 's'}, ${n} task${n === 1 ? '' : 's'}`;
    }
    return 'Log this as a delay event';
  }, [appliedForLiveText, confirmableRows]);

  // ─── The record lands before anything is delivered ───────────────────────
  //
  // handleSave used to run LAST in handleConfirmSend, after the email. A
  // cancelled iOS Mail composer returned silently and a Resend failure alerted
  // "Report saved but email could not be sent" — while nothing had been
  // written at all. A super who spent twenty minutes on a DFR in a basement,
  // hit the failure and backed out lost the whole day and read the word
  // "saved" doing it (audit 2026-09-07 "Do now" #2). The day's work is now on
  // disk before a single delivery is attempted.
  //
  // It lands as a DRAFT and only becomes 'sent' once something actually went
  // out, and that second write cannot ride the send handler's own closure:
  // updateDailyReport captures the report list of the render that built it, so
  // calling it there — after addDailyReport has already added a row — would
  // write back a list that predates the row and delete the report we just
  // saved. The flip is queued in state here and applied by the effect below,
  // which runs on a later commit with a fresh callback and a list that
  // contains the row.
  const [sentFlip, setSentFlip] = useState<{ reportId: string; toast: string } | null>(null);
  useEffect(() => {
    if (!sentFlip) return;
    setSentFlip(null);
    // Belt and braces on the ordering argument above (adversarial review):
    // updateDailyReport MAPS over the list it captured and writes the whole
    // thing back, so if this commit's list somehow does not carry the row
    // yet, the stamp would persist a list without it and delete the report
    // outright. `existingReports` comes off the same render's dailyReports,
    // so it answers exactly that question. A report left labelled "Saved"
    // instead of "Sent" costs nothing next to losing the day.
    if (existingReports.some(r => r.id === sentFlip.reportId)) {
      updateDailyReport(sentFlip.reportId, { status: 'sent' });
    }
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nailIt(sentFlip.toast);
    goBack();
  }, [sentFlip, existingReports, updateDailyReport, goBack]);

  // ─── "Nothing happened today" — one tap, no invented content ───────────
  //
  // A superintendent who only logs eventful days ends up with a record full of
  // holes, and the holes are the days nobody can reconstruct later.
  //
  // So filing a dead day has to be as fast as skipping it. These are the
  // reasons a super actually writes; nothing here fabricates crew, quantities,
  // or progress, and the saved report carries zero manpower and zero photos so
  // it reads as exactly what it is: a day with no work on site.
  const NO_WORK_REASONS: { label: string; text: string }[] = [
    { label: 'Weather', text: 'No work on site — weather.' },
    { label: 'No crew scheduled', text: 'No work on site — no crew scheduled.' },
    { label: 'Holiday / closure', text: 'No work on site — holiday or site closure.' },
    { label: 'Waiting on inspection', text: 'No work on site — waiting on inspection.' },
    { label: 'Waiting on materials', text: 'No work on site — waiting on materials.' },
    { label: 'Waiting on an answer', text: 'No work on site — waiting on an answer from the design team.' },
  ];

  const handleFileNoWorkDay = useCallback((text: string) => {
    if (!projectId) return;
    const now = new Date().toISOString();
    const report: DailyFieldReport = {
      id: stableReportId,
      projectId,
      date: reportDate,
      weather,
      manpower: [],
      workPerformed: text,
      materialsDelivered: [],
      issuesAndDelays: '',
      photos: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      portalState: dfrNewPortalState(publishAccess.allowed),
    };
    addDailyReport(report);
    void AsyncStorage.removeItem(draftKey).catch(() => {});
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    nailIt('Logged as a no-work day. The record has no gap.');
    goBack();
  }, [projectId, reportDate, weather, stableReportId, addDailyReport, goBack, draftKey, publishAccess.allowed]);

  // Only offer it on a brand-new report the user has not started filling in —
  // once anything is entered, the day plainly had something on it.
  const showNoWorkShortcut = !existingReport
    && manpower.length === 0
    && workProgress.length === 0
    && materialsDelivered.length === 0
    && photos.length === 0
    && workPerformed.trim().length === 0
    && issuesAndDelays.trim().length === 0
    && !incident.hasIncident;

  const handleSendPress = useCallback(() => {
    // A sample job's report goes to its owner and nobody else
    // (utils/sampleGuard): the sheet opens locked to his own address.
    const samplePlan = sampleSendPlan(project, user?.email);
    if (samplePlan.sample) {
      setSendRecipientName('');
      setSendRecipientEmail(samplePlan.to ?? '');
      setContactPicked(false);
    }
    // Sending puts the hours in front of the owner as the day's record — ask
    // first while shifts it counted are still open.
    if (liveHoursWarning) {
      showAlert('Crew still on the clock', liveHoursWarning, [
        { text: 'Wait', style: 'cancel' },
        { text: 'Send anyway', onPress: () => setShowSendRecipient(true) },
      ]);
      return;
    }
    setShowSendRecipient(true);
  }, [liveHoursWarning, project, user?.email]);

  // #25: the gallery copies of this project's photos — where the annotator
  // draws markup, keyed by the same id the report's photos carry.
  const galleryPhotos = useMemo(
    () => (projectId ? getPhotosForProject(projectId) : []),
    [projectId, getPhotosForProject],
  );
  const galleryPhotoIds = useMemo(() => galleryPhotos.map(g => g.id), [galleryPhotos]);
  const markedUpPhotoIds = useMemo(
    () => new Set(galleryPhotos.filter(g => (g.markup?.length ?? 0) > 0).map(g => g.id)),
    [galleryPhotos],
  );
  // Same test as isLocked below (declared later in this component).
  const reportIsSent = existingReport?.status === 'sent';
  const handlePhotoTap = useCallback((photoId: string) => {
    const target = dfrPhotoMarkupTarget({ photoId, galleryIds: galleryPhotoIds, reportSent: reportIsSent });
    if (target.action === 'blocked') {
      showAlert('Mark up this photo', target.reason);
      return;
    }
    const open = () => router.push({ pathname: '/photo-annotator', params: { photoId: target.photoId } });
    // A sent report is locked, but its photos' markup lives on the gallery
    // copy — drawing now would show up on a later re-print of a report the
    // recipient already has. Say so before opening, rather than silently.
    if (target.lockedNote) {
      showAlert('This report was already sent', target.lockedNote, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark up anyway', onPress: open },
      ]);
      return;
    }
    open();
  }, [galleryPhotoIds, router, reportIsSent]);

  /** #25 — the report as it stands on screen, for the filed PDF / Print.
   *  The incident flags are the classifier's outputs, the same ones handleSave
   *  writes, so the document never shows a self-certified determination. */
  const documentReport = useCallback((): DailyFieldReport => {
    const now = new Date().toISOString();
    return {
      id: stableReportId,
      projectId: projectId ?? '',
      date: reportDate,
      weather,
      manpower,
      workPerformed: workPerformed.trim(),
      workProgress: workProgress.length > 0 ? workProgress : undefined,
      materialsDelivered,
      issuesAndDelays: issuesAndDelays.trim(),
      photos,
      // #62: a submitted report's copy is the submitted report (buildDFRHtml
      // prints no status, but the record handed to it should not lie).
      status: existingReport?.status === 'sent' ? 'sent' : 'draft',
      incident: incident.hasIncident
        ? {
            ...incident,
            ...(classificationKnown
              ? {
                  injuriesReported: incidentClassInput.type === 'injury',
                  medicalTreatment: incidentClassInput.treatment === 'medical_beyond_first_aid',
                  oshaRecordable: recordability.recordable,
                }
              : {
                  injuriesReported: existingReport?.incident?.injuriesReported,
                  medicalTreatment: existingReport?.incident?.medicalTreatment,
                  oshaRecordable: existingReport?.incident?.oshaRecordable,
                }),
          }
        : undefined,
      createdAt: existingReport?.createdAt ?? now,
      updatedAt: now,
      filedByUserId: existingReport?.filedByUserId,
    };
  }, [stableReportId, projectId, reportDate, weather, manpower, workPerformed, workProgress, materialsDelivered,
      issuesAndDelays, photos, incident, incidentClassInput, recordability.recordable, existingReport?.createdAt,
      existingReport?.status, existingReport?.incident, existingReport?.filedByUserId, classificationKnown]);

  /** What the document prints as the 1904 determination — only a computed
   *  verdict this seat could actually see the inputs of (#122). */
  const documentClassification = incident.hasIncident && classificationKnown ? recordability.reason : undefined;

  const brandingOrBlank = useCallback(
    () => settings.branding ?? { companyName: '', contactName: '', email: '', phone: '', address: '', licenseNumber: '', tagline: '' },
    [settings],
  );

  /** #27 — on web the only way to keep a PDF: the document in a print tab,
   *  opened synchronously inside this tap (after an await the browser would
   *  block it), and a blocked window says so instead of doing nothing. */
  const handlePrintCopy = useCallback(() => {
    if (!project) return;
    const doc = documentReport();
    // The tab opens NOW (inside the tap); the photo URLs are signed fresh from
    // storage afterwards, so a screen left open past a URL's lifetime still
    // prints its photos.
    openPrintWindowAfterOrThrow(async () => buildDFRHtml(doc, project, brandingOrBlank(), {
      photos: await resolveDfrPhotosForDocument(doc.photos, galleryPhotos),
      incidentClassification: documentClassification,
      filedByName: filedBy.document ?? undefined,
    })).catch((e: unknown) => {
      showAlert('Print did not open', (e as Error).message);
    });
  }, [project, documentReport, brandingOrBlank, galleryPhotos, documentClassification, filedBy.document]);

  /**
   * #62 — a SUBMITTED report can be printed or shared again. The only Print
   * lived in the Send sheet, which a sent report can no longer open, and
   * generateDFRPDF had no caller — so the PDF the owner's rep asks for a week
   * later existed nowhere. Web prints (a synchronous tab, handlePrintCopy);
   * the phone builds the same document the send path files — documentReport()
   * plus the resolved photos and the classification — and opens the share
   * sheet. Nothing is saved and the status is untouched.
   */
  const [sharingPdf, setSharingPdf] = useState(false);
  const handlePrintOrShareLocked = useCallback(() => {
    if (Platform.OS === 'web') { handlePrintCopy(); return; }
    if (!project || sharingPdf) return;
    const doc = documentReport();
    setSharingPdf(true);
    void (async () => {
      try {
        await generateDFRPDF(doc, project, brandingOrBlank(), {
          photos: await resolveDfrPhotosForDocument(doc.photos, galleryPhotos),
          incidentClassification: documentClassification,
          filedByName: filedBy.document ?? undefined,
        });
      } catch (e) {
        showAlert('Could not make the PDF', e instanceof Error && e.message ? e.message : 'Try again.');
      } finally {
        setSharingPdf(false);
      }
    })();
  }, [handlePrintCopy, project, sharingPdf, documentReport, brandingOrBlank, galleryPhotos, documentClassification, filedBy.document]);

  const handleConfirmSend = useCallback(async () => {
    // A sample job never emails a client or a sub — only its owner. The sheet
    // is locked to his address on a sample; this refuses anything else that
    // reaches here (a stale sheet, a pasted address). The project-files copy
    // with no email sends nothing, so it stays allowed.
    if (sendRecipientEmail.trim() && !sampleSendAllowed(project, sendRecipientEmail, user?.email)) {
      showAlert('Sample job', 'A sample job sends only to you. Nothing was sent.');
      return;
    }
    // Email is optional when the project-files copy is on — a GC who just
    // wants the PDF in the shared drive can skip the recipient. On web there
    // is no project-files copy (#27), so there an email is the destination.
    const plan = dfrSendPlan({ email: sendRecipientEmail, saveToggle: saveToProjectFiles, os: Platform.OS });
    if (plan.blocker) {
      showAlert(plan.blocker.title, plan.blocker.message);
      return;
    }
    const { wantsEmail, fileCopy } = plan;
    setShowSendRecipient(false);

    // Persist FIRST — see "The record lands before anything is delivered"
    // above. Everything below this line can fail without costing the super
    // his day.
    handleSave('draft', sendRecipientName, sendRecipientEmail, { silent: true });
    const recipientInfo = sendRecipientName
      ? ` to ${sendRecipientName}${sendRecipientEmail.trim() ? ` (${sendRecipientEmail.trim()})` : ''}`
      : '';
    const branding = brandingOrBlank();
    const doc = documentReport();
    const incidentClassification = documentClassification;

    // The project-files copy goes FIRST, so the email can link the filed
    // record (#25) — the full document with the crew table, materials, the
    // incident and the photos. A copy lives at
    // project-documents/<projectId>/daily-reports/<reportId>.pdf; stableReportId
    // (not existingReport.id) lets a brand-new DFR file on its first send.
    let fileSaved = false;
    let fileError: string | null = null;
    let filedLink: string | null = null;
    if (fileCopy && projectId) {
      try {
        if (!project) throw new Error('This project is not loaded on this device.');
        const docPhotos = await resolveDfrPhotosForDocument(doc.photos, galleryPhotos);
        const html = buildDFRHtml(doc, project, branding, { photos: docPhotos, incidentClassification, filedByName: filedBy.document ?? undefined });
        const dateLabel = calendarDayOf(reportDate) ?? todayCalendarDay(); // the LOCAL day, not the UTC one
        const saved = await saveDailyReportToProjectFiles({
          projectId,
          reportId: stableReportId,
          html,
          fileName: `Daily Report — ${dateLabel}.pdf`,
        });
        fileSaved = true;
        filedLink = saved.linkUrl;
        if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (err) {
        // Not fatal — the structured DFR record is already saved (above).
        console.warn('[DailyReport] Save to project files failed:', err);
        fileError = (err as Error).message;
      }
    }

    let emailSent = false;
    if (wantsEmail) {
      // #25: a summary — crew, materials and the incident inline, a link to the
      // filed PDF for the photos. #26: the weather strings as recorded.
      const html = buildDailyReportEmailHtml({
        companyName: branding.companyName,
        recipientName: sendRecipientName,
        projectName: project?.name ?? 'Project',
        date: reportDate,  // honor the user-picked date in the email body
        weather: { conditions: String(weather.conditions ?? ''), temperature: String(weather.temperature ?? ''), wind: String(weather.wind ?? '') },
        totalManpower,
        totalManHours,
        workPerformed: workPerformed.trim(),
        issuesAndDelays: issuesAndDelays.trim(),
        manpower,
        materialsDelivered,
        incident: doc.incident?.hasIncident
          ? {
              severity: doc.incident.severity,
              description: doc.incident.description,
              classification: incidentClassification,
              injuriesReported: doc.incident.injuriesReported,
              correctiveAction: doc.incident.correctiveAction,
            }
          : undefined,
        // Incident evidence is not in the filed PDF, so the email doesn't count it.
        photoCount: dfrPrintablePhotoSplit(photos as DfrPhotoWithFlag[]).printable.length,
        filedPdfUrl: filedLink ?? undefined,
        filedPdfLinkDays: filedLink ? DFR_FILED_PDF_LINK_DAYS : undefined,
        contactName: branding.contactName,
        contactEmail: branding.email,
        growthBadge: isFree,
      });

      const result = await sendEmail({
        to: sendRecipientEmail.trim(),
        subject: `Daily report · ${dayOrInstantDate(reportDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${project?.name ?? 'Project'}`,
        html,
        replyTo: branding.email || undefined,
        fromCompanyName: branding.companyName || undefined,
        unsubscribe: { recipientEmail: sendRecipientEmail.trim(), eventKey: 'daily_report', enabled: true },
      });

      if (!result.success) {
        // Both exits below are honest: the report IS saved, as a draft, and
        // the screen says where to find it and how to try again.
        const filedNote = fileSaved ? ' A PDF copy is in project files.' : '';
        if (result.error === 'cancelled') {
          showAlert(
            'Saved as a draft',
            `You backed out of the mail composer, so nothing was emailed. The report is saved on this project — open it from Daily Reports to send it again.${filedNote}`,
          );
          goBack();
          return;
        }
        console.warn('[DailyReport] Email send failed:', result.error);
        showAlert(
          'Saved — the email did not send',
          `The report is saved on this project as a draft. The email failed: ${result.error}${filedNote}`,
        );
        goBack();
        return;
      }
      emailSent = true;
    }

    if (fileError) {
      showAlert(
        'Project files notice',
        `${emailSent ? 'Emailed' : 'Saved as a draft'}, but the project-files copy didn't land: ${fileError}`,
      );
    }

    // Stamped 'sent' only on what actually left the device (dfrDelivered).
    if (!dfrDelivered({ wantsEmail, emailSent, fileSaved })) {
      goBack();
      return;
    }
    setSentFlip({ reportId: stableReportId, toast: `Daily report sent${recipientInfo}` });
  // `existingReport` is not listed: this handler never reads it (handleSave,
  // which does, is the dep that carries it; documentReport carries createdAt).
  }, [handleSave, sendRecipientName, sendRecipientEmail, project, weather, totalManpower, totalManHours, workPerformed, issuesAndDelays,
      manpower, materialsDelivered, photos, reportDate, saveToProjectFiles, projectId, isFree, goBack, stableReportId,
      brandingOrBlank, documentReport, galleryPhotos, documentClassification, filedBy.document, user?.email]);


  // ─── Unsaved-work guard: a dirty check and a debounced draft ──────────────
  //
  // DFR-BACK-LOSS (audit 2026-09-07 "worth doing" #9). Every field on this
  // screen lives in component useState and `headerShown` is false, so the back
  // chevron was a bare router.back() and the iOS edge-swipe had nothing in
  // front of it either. Twenty minutes of work in a basement, one fat-fingered
  // tap, gone — silently, with no prompt and nothing on disk to go back to.
  //
  // Two independent protections, because they fail differently: the prompt
  // catches a mis-tap, and the draft catches everything the prompt can't (the
  // app being killed in the background, a crash, a battery death).

  /** The report as it exists RIGHT NOW in the form. */
  const draftContent = useMemo<DfrDraftContent>(() => ({
    reportDate, weather, manpower, workPerformed, workProgress,
    materialsDelivered, issuesAndDelays, photos, incident, incidentClass, homeownerSummary, hsPublished,
  }), [reportDate, weather, manpower, workPerformed, workProgress,
    materialsDelivered, issuesAndDelays, photos, incident, incidentClass, homeownerSummary, hsPublished]);

  /**
   * The report as it exists on disk. Derived from `existingReport` rather than
   * snapshotted from state at mount: the reportDate hydration effect runs AFTER
   * the first render, so a mount-time snapshot would compare an empty date
   * against a hydrated one and report every saved report as dirty the instant
   * it opened. A save updates existingReport, which re-derives this, which is
   * what makes the form clean again.
   *
   * `autoFilled` is the second fallback for the two fields the screen writes on
   * its own (weather auto-fetch, schedule crew prefill) — see DFR-DIRTY-AUTOFILL
   * above. Without it a brand-new report is dirty a second after it opens, with
   * nobody having touched it.
   */
  const savedSignature = useMemo(() => dfrDraftSignature({
    reportDate: existingReport?.date ?? initialReportDateRef.current,
    weather: existingReport?.weather ?? autoFilled.weather ?? EMPTY_DFR_WEATHER,
    manpower: existingReport?.manpower ?? autoFilled.manpower ?? [],
    workPerformed: existingReport?.workPerformed ?? '',
    workProgress: existingReport?.workProgress ?? [],
    materialsDelivered: existingReport?.materialsDelivered ?? autoFilled.materialsDelivered ?? [],
    issuesAndDelays: existingReport?.issuesAndDelays ?? autoFilled.issuesAndDelays ?? '',
    photos: existingReport?.photos ?? [],
    incident: existingReport?.incident ?? EMPTY_DFR_INCIDENT,
    // The determination inputs live on the register case, not on the report, so
    // the saved baseline is whatever the case says — otherwise opening a report
    // that already filed a case reads as dirty the moment the pickers hydrate
    // from it, which is the cry-wolf prompt DFR-DIRTY-AUTOFILL exists to avoid.
    incidentClass: linkedIncident ? {
      type: linkedIncident.type,
      treatment: linkedIncident.treatment,
      daysAway: linkedIncident.daysAway > 0 ? String(linkedIncident.daysAway) : '',
      daysRestricted: linkedIncident.daysRestricted > 0 ? String(linkedIncident.daysRestricted) : '',
      restrictedDuty: linkedIncident.restrictedDuty,
      lostConsciousness: linkedIncident.lostConsciousness,
      fatality: linkedIncident.fatality,
    } : EMPTY_DFR_INCIDENT_CLASS,
    homeownerSummary: existingReport?.homeownerSummary ?? '',
    // #22: what the portal holds. A toggle either way is an unsaved edit.
    hsPublished: existingReport?.homeownerSummaryPublished ?? false,
  }), [existingReport, autoFilled, linkedIncident]);

  const isDirty = useMemo(
    () => isDfrDirty(draftContent, savedSignature),
    [draftContent, savedSignature],
  );

  // ─── Same-day report (#114) ───
  // A new report (no reportId) on a day that already has one — the foreman
  // filed it, or a morning draft was saved. Offered, never forced: two crews
  // filing separate reports for one day is legitimate. Re-evaluated whenever
  // the date picker moves this report, and on the report list landing late.
  const sameDayReports = useMemo(
    () => (reportId ? [] : dfrSameDayReports(existingReports, reportCalendarDay, stableReportId, v => calendarDayOf(v))),
    [reportId, existingReports, reportCalendarDay, stableReportId],
  );
  const openSameDayReport = useCallback((otherId: string) => {
    const go = () => router.replace({ pathname: '/daily-report', params: { projectId, reportId: otherId } } as never);
    if (!isDirty) { go(); return; }
    // No leave guard catches a replace, so keep what he typed as this job's
    // new-report draft (restorable next time he starts one) before going.
    showAlert(
      'Open the other report?',
      'What you typed here is kept as a draft — start a new report on this job to pick it back up.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Open it',
          onPress: () => {
            const draft: DfrDraft = { v: 1, savedAt: new Date().toISOString(), ...draftContent };
            void AsyncStorage.setItem(draftKey, JSON.stringify(draft)).catch(() => {}).finally(go);
          },
        },
      ],
    );
  }, [router, projectId, isDirty, draftContent, draftKey]);

  // ─── Homeowner-update control state (#22, #115, #116) ───
  const hsControl = dfrPublishControl(hsPublishedSaved, hsPublished);
  const hsStale = dfrSummaryIsStale(homeownerSummary, hsWrittenForDay, reportCalendarDay);
  /** Why the publish toggle is disabled, or null. Taking a stale update DOWN
   *  stays allowed; putting one up is not. */
  const hsPublishBlockedReason: string | null = !publishAccess.allowed
    ? publishAccess.reason
    : (hsStale && !hsPublished ? 'Written for a different day \u2014 re-generate or edit it first.' : null);
  /** A field/viewer seat may draft a summary for the GC, but not touch one the
   *  owner already put in front of the homeowner (the server keeps it too). */
  const hsTextLockedReason: string | null = !publishAccess.allowed && hsPublishedSaved
    ? `This update is live in the homeowner\u2019s portal. ${DFR_OWNER_DECIDES_HOMEOWNER}`
    : null;

  // ─── #58: the homeowner update on a SUBMITTED report ───
  // Submitting locks the technical record (intended), but the homeowner update
  // is its own decision: the GC opening his foreman's report from the "Review
  // it" push had no way to publish the update the foreman drafted, fix it, or
  // take a live one down. An owner/editor keeps the block and gets its own
  // "Save update", which writes ONLY the three homeowner fields — never
  // handleSave, which rewrites the form and refuses a draft save on a sent
  // report. The server trigger lets owner/editor change these columns.
  const hsEditableWhenLocked = reportIsSent && publishAccess.allowed;
  const hsUpdateDirty = hsEditableWhenLocked && dfrHomeownerUpdateDirty({
    summary: homeownerSummary, savedSummary: existingReport?.homeownerSummary,
    published: hsPublished, savedPublished: hsPublishedSaved,
  });
  const handleSaveHomeownerUpdate = useCallback((after?: () => void) => {
    if (!existingReport || existingReport.status !== 'sent' || !publishAccess.allowed) return;
    const text = homeownerSummary.trim();
    // Nothing to show → nothing published, whatever the toggle said.
    const publish = hsPublished && text.length > 0;
    updateDailyReport(existingReport.id, {
      homeownerSummary: text || undefined,
      homeownerSummaryGeneratedAt: hsGeneratedAt,
      homeownerSummaryPublished: publish,
    });
    if (hsPublished !== publish) setHsPublished(publish);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    nailIt(publish
      ? 'Homeowner update saved \u2014 the portal shows it once the report has synced.'
      : hsPublishedSaved ? 'Homeowner update taken down.' : 'Homeowner update saved.');
    after?.();
  }, [existingReport, publishAccess.allowed, homeownerSummary, hsPublished, hsGeneratedAt, hsPublishedSaved, updateDailyReport]);

  /**
   * Whether the screen knows enough about what is SAVED to judge what is
   * unsaved.
   *
   * ProjectContext hydrates from AsyncStorage through react-query, so there is
   * a window on a cold start where `projectId` is set and the report list is
   * still empty. Drafting through that window is actively harmful: the form
   * fields are seeded from `existingReport` at mount and do not re-seed, so a
   * report arriving late would leave a BLANK form sitting against a populated
   * baseline — reported as dirty, autosaved as an empty draft over the real
   * one, and offered back on the next open. Waiting costs nothing; the window
   * is milliseconds and nobody has typed yet.
   *
   * A `reportId` naming a report that no longer exists never becomes ready, so
   * that screen behaves exactly as it did before this shipped.
   */
  const draftReady = !!project && (!reportId || !!existingReport);

  // Debounced write. Clean form → the draft is REMOVED, so a saved report never
  // leaves a stale restore offer behind for the next person to open it.
  useEffect(() => {
    if (!projectId || !draftReady) return;
    if (existingReport?.status === 'sent') return; // locked; nothing to draft
    const t = setTimeout(() => {
      if (isDirty) {
        const draft: DfrDraft = { v: 1, savedAt: new Date().toISOString(), ...draftContent };
        void AsyncStorage.setItem(draftKey, JSON.stringify(draft)).catch(err => {
          console.warn('[DFR] draft write failed:', err);
        });
      } else {
        void AsyncStorage.removeItem(draftKey).catch(() => {});
      }
    }, DFR_DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draftKey, isDirty, draftContent, projectId, draftReady, existingReport?.status]);

  // Offer a recovered draft, once per report. Held in a ref rather than state
  // so a re-render mid-prompt cannot ask twice.
  const draftOfferedForRef = useRef<string | null>(null);
  const savedSignatureRef = useRef(savedSignature);
  savedSignatureRef.current = savedSignature;
  useEffect(() => {
    if (!projectId || !draftReady) return;
    if (draftOfferedForRef.current === draftKey) return;
    draftOfferedForRef.current = draftKey;
    let cancelled = false;
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (!raw || cancelled) return;
        const draft = JSON.parse(raw) as DfrDraft;
        // A draft written by an older shape is discarded, not half-restored.
        if (!draft || draft.v !== 1) { void AsyncStorage.removeItem(draftKey).catch(() => {}); return; }
        // A draft that matches what is already saved is not a recovery, it is
        // noise — drop it silently rather than making the user answer for it.
        if (dfrDraftSignature(draft) === savedSignatureRef.current) {
          void AsyncStorage.removeItem(draftKey).catch(() => {});
          return;
        }
        showAlert(
          'Unsaved report found',
          `You left this report part-written ${dfrDraftAgeLabel(draft.savedAt, new Date())}. Pick it back up, or start fresh?`,
          [
            {
              text: 'Start fresh',
              style: 'destructive',
              onPress: () => { void AsyncStorage.removeItem(draftKey).catch(() => {}); },
            },
            {
              text: 'Restore',
              onPress: () => {
                setReportDate(draft.reportDate);
                setWeather(draft.weather);
                setManpower(draft.manpower ?? []);
                setWorkPerformed(draft.workPerformed ?? '');
                setWorkProgress(draft.workProgress ?? []);
                setMaterialsDelivered(draft.materialsDelivered ?? []);
                setIssuesAndDelays(draft.issuesAndDelays ?? '');
                setPhotos(draft.photos ?? []);
                setIncident(draft.incident ?? EMPTY_DFR_INCIDENT);
                // Mark seeded either way: a restore is the super's answer about
                // this report, and the register-case effect must not overwrite it.
                incidentClassSeededRef.current = true;
                setIncidentClass(draft.incidentClass ?? EMPTY_DFR_INCIDENT_CLASS);
                setHomeownerSummary(draft.homeownerSummary ?? '');
                // #22: an older draft has no flag — it restores as not published.
                setHsPublished(draft.hsPublished ?? false);
                setHsWrittenForDay(draft.homeownerSummary ? calendarDayOf(draft.reportDate) : null);
                nailIt('Restored your unsaved report.');
              },
            },
          ],
        );
      } catch (err) {
        // A draft we cannot read is one we cannot honestly offer.
        console.warn('[DFR] draft read failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [draftKey, projectId, draftReady]);

  /**
   * The guarded exit. Three options and no default destruction: "Keep editing"
   * is the cancel, "Save draft" is what the super almost always means, and
   * "Discard" is the only path that throws work away and it says so.
   */
  const handleBack = useCallback(() => {
    // #58: an unsaved homeowner update on a SUBMITTED report is the one edit a
    // sent report can hold — asked about with its own save, never "Save draft".
    if (hsUpdateDirty) {
      showAlert(
        'Leave without saving the homeowner update?',
        'Your changes to the homeowner update aren\u2019t saved. The submitted report itself is unchanged.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: goBack },
          { text: 'Save update', onPress: () => handleSaveHomeownerUpdate(goBack) },
        ],
      );
      return;
    }
    // A submitted report is read-only: there is nothing to save, and offering
    // "Save draft" there would downgrade the sent record (see handleSave).
    if (!isDirty || existingReport?.status === 'sent') { goBack(); return; }
    showAlert(
      'Leave without saving?',
      "This report isn't on the project yet. Save it as a draft and you can finish it from Daily Reports whenever you're back at a desk.",
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void AsyncStorage.removeItem(draftKey).catch(() => {});
            goBack();
          },
        },
        {
          text: 'Save draft',
          onPress: () => {
            void AsyncStorage.removeItem(draftKey).catch(() => {});
            handleSave('draft');
          },
        },
      ],
    );
  }, [isDirty, existingReport?.status, draftKey, goBack, handleSave, hsUpdateDirty, handleSaveHomeownerUpdate]);

  // Desktop sheets (wave 6c): each Modal below keeps its phone styles; on
  // desktop web the frame centres a capped card in the content column.
  const fSend = useSheetFrame('form', { visible: showSendRecipient, animationType: 'slide' });
  // Sends email: Cmd+Enter only, never Cmd+S (components/ui/Sheet saveKey).
  useSheetPrimaryHotkey(showSendRecipient, handleConfirmSend, { saveKey: false });
  const fTask = useSheetFrame('form', { visible: showTaskPicker, animationType: 'slide' });
  const fCrew = useSheetFrame('form', { visible: showManpowerModal, animationType: 'slide' });
  useSheetPrimaryHotkey(showManpowerModal, handleSaveManpower);
  const fDelay = useSheetFrame('dialog', { visible: delayTaskPickerIdx !== null, animationType: 'fade' });
  // Cmd/Ctrl+S and Cmd/Ctrl+Enter save a DRAFT — never Submit, which sends.
  usePrimaryAction(() => handleSave('draft'), {
    label: 'Save draft',
    disabled: existingReport?.status === 'sent',
    reason: 'This report was submitted — it is read-only.',
    enabled: !!project,
  });

  if (!project) {
    return (
      <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
        <Stack.Screen options={{ title: 'Daily Report' }} />
        <ToolProjectPicker
          toolName="Daily Reports"
          message="Daily field reports (DFRs) log weather, manpower, and progress on one specific project."
          projects={projects}
          onPick={(id) => {
            // Desktop web: the pick goes into the URL, so the screen's gate
            // re-renders into that job's report log (?projectId=).
            if (desktopWeb) { router.setParams({ projectId: id }); return; }
            setPickedProjectId(id);
          }}
          staleProjectId={staleProjectId}
          icon={<MageDailyReport size={36} color={themeColors.accent} />}
          steps={[
            'Open or create a project from the Projects tab.',
            'Tap Daily Report inside the project tile grid.',
            'Voice-dictate the day or fill weather, crew, and progress fields, then submit.',
          ]}
        />
      </View>
    );
  }

  const isLocked = existingReport?.status === 'sent';
  /** A sample job's Submit is locked to his own address (utils/sampleGuard). */
  const sendIsSample = sampleSendPlan(project, user?.email).sample;
  /** The homeowner-update controls: an open report, or (#58) a submitted one
   *  for an owner/editor. A field/viewer seat on a submitted report reads it. */
  const hsEditable = !isLocked || hsEditableWhenLocked;
  // #17/#59: a field/viewer seat is told what is true of HIS report (and the
  // photos it mirrors): the GC reviews it first, or it is already shared, or
  // this job has no portal. A publisher's state is his SendToClientButton.
  const portalSeatNote = dfrPortalSeatNote({
    canPublish: publishAccess.allowed,
    portalEnabled: project.clientPortal?.enabled === true,
    status: existingReport?.portalState?.status ?? null,
    isNew: !existingReport,
  });
  const sameDayFiledBy = sameDayReports.length > 0
    ? dfrFiledBy({
        filedByUserId: sameDayReports[0].filedByUserId, viewerId: user?.id, viewerName: user?.name,
        ownerUserId: project.ownerUserId, people: projectPeople,
      }).banner
    : null;

  return (
    <View style={[styles.container, { backgroundColor: themeColors.bg }]}>
      {/* gestureEnabled tracks the dirty flag: with no header, the iOS
          edge-swipe is a second unguarded exit, and it dismisses the screen
          without ever reaching the back handler below. Disabling it while
          there is unsaved work routes every exit through the one prompt. */}
      <Stack.Screen options={{ headerShown: false, gestureEnabled: !isDirty }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Custom top bar: back arrow on the left, "Daily Report" + date
            stacked in the middle, Save Draft (text link) + Submit Report
            (filled primary) on the right. Matches the mock's top-right
            CTA pattern — "save vs submit" intent is explicit instead of
            buried in two buttons of similar weight at the bottom. */}
        <View style={[styles.topBar, isDesktop && styles.topBarDesktop, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity
            onPress={handleBack}
            style={styles.topBarBack}
            accessibilityRole="button"
            accessibilityLabel={isDirty ? 'Back — this report has unsaved changes' : 'Back'}
            hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
            testID="dfr-back"
          >
            <ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.topBarTitleCol}
            onPress={() => setShowDatePicker(true)}
            activeOpacity={0.7}
            disabled={isLocked}
            accessibilityRole="button"
            accessibilityLabel="Change report date"
          >
            <Text style={styles.topBarTitle}>Daily Report</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Text style={styles.topBarDate}>
                {dayOrInstantDate(reportDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </Text>
              {!isLocked && <CalendarDays size={11} color={themeColors.textMuted} strokeWidth={1.75} />}
            </View>
          </TouchableOpacity>
          {!isLocked ? (
            <View style={styles.topBarActions}>
              <TutorialTarget id="dfr.saveDraft">
              <Button
                label="Save Draft"
                onPress={() => handleSave('draft')}
                variant="secondary"
                size="sm"
                testID="save-draft-btn"
              />
              </TutorialTarget>
              <Button
                label="Submit"
                onPress={handleSendPress}
                size="sm"
                testID="submit-report-btn"
              />
            </View>
          ) : (
            <View style={styles.topBarActions}>
              <View style={[styles.statusBadge, { backgroundColor: themeColors.successSoft, marginTop: 0 }]}>
                <Text style={[styles.statusText, { color: themeColors.success }]}>Sent</Text>
              </View>
              {/* #62: the submitted report's PDF, again — print on web, the
                  share sheet on the phone. Nothing is saved or re-stamped. */}
              <Button
                label={sharingPdf ? 'Making PDF…' : 'Print / Share PDF'}
                onPress={handlePrintOrShareLocked}
                variant="secondary"
                size="sm"
                disabled={sharingPdf}
                testID="dfr-locked-print-share"
              />
            </View>
          )}
        </View>

        {/* The contextual tutorial offer (spec entry point 3): one dismissible
            line, the first open on a REAL job only. Every quiet rule (once, ×
            forever, one a day, never on a sample / mid-draft / during a run)
            lives in utils/tutorial/offers.ts. A submitted report is read-only,
            so there is nothing to practise from it. */}
        <TutorialOfferChip tutorialId="daily-report-voice" projectId={projectId} screenOpened={!isLocked} midDraft={isDirty} />
        <ScrollView
          ref={dfrScrollRef}
          {...fabScroll}
          contentContainerStyle={[{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }, isDesktop && styles.contentDesktop]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <TutorialScrollAnchor scrollRef={dfrScrollRef}>
          <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
            <TutorialTarget id="dfr.voice">
            <VoiceRecorder
              onTranscriptReady={async (transcript) => {
                setVoiceLoading(true);
                try {
                  const parsed = await parseDFRFromTranscript(transcript, projectId ?? '', todaysProjectPhotos);
                  // The shared fill (applyParsedDfr, above): same fields, same
                  // never-overwrite rule, and metered — this path made an AI call.
                  await applyParsedDfr(parsed, { metered: true, source: 'mic' });
                  if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
                  console.log('[DFR] Voice auto-fill complete');
                } catch (err) {
                  console.log('[DFR] Voice parse error:', err);
                  showAlert(
                    'Could not understand the recording',
                    'The transcription service may be slow or down. Try recording again, or fill in the report by hand.',
                  );
                } finally {
                  setVoiceLoading(false);
                }
              }}
              isLoading={voiceLoading}
              isLocked={voiceBlocked}
              onLockedPress={openVoiceUpgrade}
              title="Dictate today's report"
              contextLine={project?.name ? `for ${project.name}` : undefined}
              suggestions={[
                'Crew arrived at 7:30, framed the back wall, finished around 4 PM',
                "Joe's Plumbing on site for rough-in — three guys, three hours",
                'Concrete pour delayed thirty minutes due to rain',
                'Inspector signed off on electrical rough-in this morning',
                'Delivered ten sheets of drywall and two doors',
              ]}
              // Numbered topic checklist — visible to the GC while
              // dictating so they cover every section in one pass.
              // The voice parser will route each topic to the right
              // field automatically; this is just to prevent skipped
              // sections in long dictations.
              topicChecklist={[
                { label: 'Weather on site', hint: 'temp, conditions, wind — e.g. "55 and clear, light wind"' },
                { label: 'Crew on site', hint: 'who showed up, how many, what trade — e.g. "4 framers from Smith Construction"' },
                { label: 'Work performed today', hint: 'concrete tasks completed — be specific' },
                { label: 'Materials delivered', hint: 'what arrived, from whom — e.g. "20 sheets of drywall from ABC Supply"' },
                { label: 'Issues, delays, or RFIs', hint: 'anything blocking work or needing attention' },
                { label: 'Safety incidents', hint: 'only if any — say "no incidents" if clean day' },
                { label: "Tomorrow's plan", hint: 'what crews and tasks are scheduled (optional)' },
              ]}
            />
            {/* The tutorial's sample note — only while its step is live on the
                sample job. Labelled as a sample; it makes no AI call. */}
            {showSampleNote && !isLocked ? (
              <TouchableOpacity
                style={voiceStyles.sampleChip}
                onPress={applySampleNote}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`Use the sample voice note. ${SAMPLE_NO_CREDITS_LABEL}.`}
                testID="dfr-sample-note"
              >
                <Text style={voiceStyles.sampleChipLabel}>{SAMPLE_NO_CREDITS_LABEL}</Text>
                <Text style={voiceStyles.sampleChipQuote} numberOfLines={3}>{'“'}{DFR_SAMPLE_NOTE.transcript}{'”'}</Text>
              </TouchableOpacity>
            ) : null}
            </TutorialTarget>
          </View>

          {showVoiceBanner && voiceParsed && (
            <TutorialTarget id="dfr.voicePreview">
            <View style={voiceStyles.previewCard}>
              <View style={voiceStyles.previewHead}>
                <MageAIMark size={14} color={themeColors.accent} />
                <Text style={voiceStyles.previewTitle}>Here&apos;s what I heard</Text>
                <TouchableOpacity onPress={() => { setShowVoiceBanner(false); setVoiceParsed(null); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <Text style={voiceStyles.previewHelper}>
                Review each row below — tap any field in the form to edit. Anything you had already typed wasn&apos;t overwritten.
              </Text>
              <View style={voiceStyles.previewList}>
                {voiceParsed.weather && (
                  <VoiceRow label="Weather" value={[voiceParsed.weather.conditions, voiceParsed.weather.temperature].filter(Boolean).join(' · ') || '—'} />
                )}
                {voiceParsed.crewSummary && (
                  <VoiceRow label="Crew" value={voiceParsed.crewSummary} />
                )}
                {voiceParsed.workPerformed && (
                  <VoiceRow label="Work performed" value={voiceParsed.workPerformed.length > 90 ? voiceParsed.workPerformed.slice(0, 90) + '…' : voiceParsed.workPerformed} />
                )}
                {voiceParsed.materialsDelivered && voiceParsed.materialsDelivered.length > 0 && (
                  <VoiceRow label="Materials" value={voiceParsed.materialsDelivered.join(', ')} />
                )}
                {voiceParsed.issuesAndDelays && (
                  <VoiceRow label="Issues" value={voiceParsed.issuesAndDelays.length > 90 ? voiceParsed.issuesAndDelays.slice(0, 90) + '…' : voiceParsed.issuesAndDelays} valueColor={themeColors.danger} />
                )}
              </View>
            </View>
            </TutorialTarget>
          )}

          {showVoiceBanner && !voiceParsed && (
            <TouchableOpacity
              style={{ marginHorizontal: 16, marginBottom: 8, backgroundColor: themeColors.info, borderRadius: Tokens.radius.md, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}
              onPress={() => setShowVoiceBanner(false)}
              activeOpacity={0.7}
            >
              <Text style={{ flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.info }}>Nothing new picked up — the fields you already had stay as-is.</Text>
              <X size={14} color={themeColors.info} strokeWidth={1.75} />
            </TouchableOpacity>
          )}

          {!existingReport && todaysProjectPhotos.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
              <AIDFRFromPhotos
                projectName={project.name}
                weatherStr={dfrAiWeatherStr([weather.conditions, weather.temperature])}
                photos={todaysProjectPhotos}
                isLocked={voiceBlocked}
                onLockedPress={openVoiceUpgrade}
                onGenerated={(parsed) => {
                  // Inferred from photos, never read from a weather service —
                  // so it is not a fetched reading. See DFR-WEATHER-DAY.
                  if (parsed.weather && !weather.temperature) setWeather({ ...parsed.weather, isManual: true });
                  if (parsed.manpower && manpower.length === 0) setManpower(parsed.manpower);
                  if (parsed.workPerformed && !workPerformed) setWorkPerformed(parsed.workPerformed);
                  if (parsed.materialsDelivered && materialsDelivered.length === 0) setMaterialsDelivered(parsed.materialsDelivered);
                  if (parsed.issuesAndDelays && !issuesAndDelays) setIssuesAndDelays(parsed.issuesAndDelays);
                  setShowVoiceBanner(true);
                  recordAIUsage('fast', 'voiceCapture').then(() => setGateRefresh(n => n + 1));
                }}
              />
            </View>
          )}

          {!existingReport && project.schedule && project.schedule.tasks.length > 0 && (
            <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
              <AIDailyReportGen
                projectName={project.name}
                tasks={project.schedule.tasks}
                reportDay={reportCalendarDay}
                weatherStr={dfrAiWeatherStr([weather.conditions, weather.temperature])}
                isLocked={voiceBlocked}
                onLockedPress={openVoiceUpgrade}
                onGenerated={(result: DailyReportGenResult) => {
                  // #28: never replace what he typed — an empty field takes the
                  // generated lines, a filled one gets them appended under
                  // "— From schedule —" (functional updates, so a keystroke that
                  // lands while the AI call is in flight is kept too).
                  if (result.workCompleted.length > 0 || result.workInProgress.length > 0) {
                    const workText = [
                      ...result.workCompleted.map(w => `[Completed] ${w}`),
                      ...result.workInProgress.map(w => `[In Progress] ${w}`),
                    ].join('\n');
                    setWorkPerformed(prev => dfrAppendGenerated(prev, workText));
                  }
                  if (result.issuesAndDelays.length > 0) {
                    setIssuesAndDelays(prev => dfrAppendGenerated(prev, result.issuesAndDelays.join('\n')));
                  }
                  if (result.crewsOnSite.length > 0 && manpower.length === 0) {
                    const entries: ManpowerEntry[] = result.crewsOnSite.map((c, idx) => ({
                      id: createId('mp'),
                      trade: c.trade,
                      company: '',
                      headcount: c.count,
                      hoursWorked: 8,
                    }));
                    setManpower(entries);
                  }
                  setShowVoiceBanner(true);
                }}
              />
            </View>
          )}

          {sameDayReports.length > 0 && (
            <View style={styles.sameDayBanner} testID="dfr-same-day-banner">
              <Text style={styles.sameDayText}>
                This day already has {sameDayReports.length === 1 ? 'a report' : `${sameDayReports.length} reports`} (
                {sameDayReports[0].status === 'sent' ? 'submitted' : 'draft'}
                {sameDayFiledBy ? `, ${sameDayFiledBy}` : ''}, last saved{' '}
                {dayOrInstantDate(sameDayReports[0].updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}).
                {' '}Several reports a day are fine — one per crew or shift.
              </Text>
              <TouchableOpacity
                onPress={() => openSameDayReport(sameDayReports[0].id)}
                accessibilityRole="button"
                testID="dfr-same-day-open"
              >
                <Text style={styles.sameDayLink}>Open it</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.heroCard}>
            <Text style={styles.heroLabel}>Daily Field Report</Text>
            <Text style={styles.heroProject}>{project.name}</Text>
            <Text style={styles.heroDate}>{reportDateStr}</Text>
            {filedBy.hero && (
              <View style={styles.heroDayRow} testID="dfr-filed-by">
                <User size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.heroDayText}>{filedBy.hero}</Text>
              </View>
            )}
            {projectDayInfo && (
              <View style={styles.heroDayRow}>
                <CalendarDays size={13} color={themeColors.textMuted} strokeWidth={1.75} />
                <Text style={styles.heroDayText}>
                  Day {projectDayInfo.day} of {projectDayInfo.total}
                </Text>
              </View>
            )}
            {existingReport && (
              <View style={[styles.statusBadge, { backgroundColor: existingReport.status === 'sent' ? themeColors.successSoft : themeColors.line }]}>
                <Text style={[styles.statusText, { color: existingReport.status === 'sent' ? themeColors.success : themeColors.textSecondary }]}>
                  {existingReport.status === 'sent' ? 'Sent' : 'Saved'}
                </Text>
              </View>
            )}
          </View>

          {existingReport && (
            <View style={{ paddingHorizontal: 16 }}>
              <PortalStatusPill portalState={existingReport.portalState} itemUpdatedAt={existingReport.updatedAt} />
            </View>
          )}

          {/* Progress + carry-forward toolbar — sits between the hero and
              the section forms. Progress pill on the left tells the GC how
              close they are to a sendable report; "Copy from <last>" pill
              on the right loads the last report's manpower / work / mats
              / issues so the user only has to edit the deltas. The single
              most-requested DFR feature in user reviews. */}
          <View style={styles.dfrToolbar}>
            <View style={[
              styles.progressPill,
              progressMeta.isReady ? styles.progressPillReady : null,
            ]}>
              {progressMeta.isReady ? (
                <CheckCircle2 size={14} color={themeColors.success} strokeWidth={2.2} />
              ) : null}
              <Text style={[
                styles.progressPillText,
                progressMeta.isReady ? { color: themeColors.success } : null,
              ]}>
                {progressMeta.done} of {progressMeta.total} filled
                {progressMeta.isReady ? ' · ready to send' : ''}
              </Text>
            </View>
            {!isLocked && lastReport && !carryFormFromId && (
              <TouchableOpacity
                style={styles.carryBtn}
                onPress={handleCarryForward}
                activeOpacity={0.7}
                testID="carry-forward-btn"
              >
                <Copy size={14} color={themeColors.accent} strokeWidth={2.2} />
                <Text style={styles.carryBtnText}>Copy from {lastReportLabel}</Text>
              </TouchableOpacity>
            )}
            {carryFormFromId && (
              <View style={styles.carriedBadge}>
                <CheckCircle2 size={12} color={themeColors.accent} strokeWidth={2.4} />
                <Text style={styles.carriedBadgeText}>Carried forward</Text>
              </View>
            )}
          </View>

          {/* Nothing happened today. Filing that is the point — a dead day
              filed in one tap is worth more than a detailed report on the days
              that were busy anyway. Nothing here invents crew, quantities, or
              progress. */}
          {showNoWorkShortcut && (
            <View style={styles.noWorkCard} testID="no-work-day-card">
              <Text style={styles.noWorkTitle}>Nothing happened on site today</Text>
              <Text style={styles.noWorkBody}>
                File it anyway. A day logged as no work keeps the record unbroken. Pick a reason
                and this is saved with no crew and no photos.
              </Text>
              <View style={styles.noWorkChips}>
                {NO_WORK_REASONS.map(r => (
                  <TouchableOpacity
                    key={r.label}
                    style={styles.noWorkChip}
                    onPress={() => handleFileNoWorkDay(r.text)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={`File today as no work on site: ${r.label}`}
                    testID={`no-work-chip-${r.label}`}
                  >
                    <Text style={styles.noWorkChipText}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Cloud size={18} color={themeColors.info} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Weather</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={[styles.refreshBtn, (weatherLoading || !reportIsToday) && styles.refreshBtnDisabled]}
                  onPress={() => { void fetchWeather(); }}
                  activeOpacity={0.7}
                  disabled={weatherLoading || !reportIsToday}
                  testID="dfr-weather-fetch"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: weatherLoading || !reportIsToday, busy: weatherLoading }}
                  accessibilityLabel={reportIsToday
                    ? 'Auto-fetch the weather for today'
                    : `Auto-fetch is off — MAGE cannot read the weather for ${reportDayLabel}`}
                >
                  <Text style={[styles.refreshBtnText, (weatherLoading || !reportIsToday) && styles.refreshBtnTextDisabled]}>
                    {weatherLoading ? 'Loading...' : 'Auto-fetch'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            {/* A blocked control says why. There is no historical-weather source
                in this repo (OpenWeather's free tier is forecast-only, wttr.in
                answers "now"), so the honest move on a backfilled report is to
                say so and let him type what he saw — the same line the schedule
                already holds when it refuses to log a delay day off simulated
                weather. */}
            {!isLocked && !reportIsToday && (
              <Text style={styles.weatherNotice} testID="dfr-weather-backfill-notice">
                {backfilledWeatherNotice(reportDayLabel)}
              </Text>
            )}
            <View style={[styles.weatherGrid, isDesktop && styles.weatherGridDesktop]}>
              <View style={[styles.weatherItem, isDesktop && styles.weatherItemDesktop]}>
                <Thermometer size={14} color={themeColors.accent} strokeWidth={1.75} />
                {!isLocked ? (
                  <TextInput
                    style={[styles.weatherInput, isDesktop && styles.weatherInputXsDesktop]}
                    value={weather.temperature}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, temperature: v, isManual: true }))}
                    placeholder="72°F"
                    placeholderTextColor={themeColors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.temperature || 'N/A'}</Text>
                )}
              </View>
              <View style={[styles.weatherItem, isDesktop && styles.weatherItemDesktop]}>
                <Cloud size={14} color={themeColors.info} strokeWidth={1.75} />
                {!isLocked ? (
                  <TextInput
                    style={[styles.weatherInput, isDesktop && styles.weatherInputSmDesktop]}
                    value={weather.conditions}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, conditions: v, isManual: true }))}
                    placeholder="Sunny, Cloudy..."
                    placeholderTextColor={themeColors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.conditions || 'N/A'}</Text>
                )}
              </View>
              <View style={[styles.weatherItem, isDesktop && styles.weatherItemDesktop]}>
                <Wind size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                {!isLocked ? (
                  <TextInput
                    style={[styles.weatherInput, isDesktop && styles.weatherInputSmDesktop]}
                    value={weather.wind}
                    onChangeText={(v) => setWeather(prev => ({ ...prev, wind: v, isManual: true }))}
                    placeholder="5 mph NW"
                    placeholderTextColor={themeColors.textMuted}
                  />
                ) : (
                  <Text style={styles.weatherValue}>{weather.wind || 'N/A'}</Text>
                )}
              </View>
            </View>
            {weatherProvenance ? (
              <Text style={styles.weatherProvenance} testID="dfr-weather-provenance">{weatherProvenance}</Text>
            ) : null}
          </View>

          {/* Work Progress — structured per-task percent-complete chips.
              Lets the GC log "Concrete Pour 100%, Steel Erection 60%" as
              data, not free-text. Pulls candidate tasks from the project
              schedule; falls back to a helper note if no schedule exists.
              The schedule rollup + portal both consume the chips so the
              data flows downstream without re-entry. */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <BarChart3 size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Work Progress</Text>
              <Text style={styles.sectionTotal}>{workProgress.length > 0 ? `${workProgress.length} task${workProgress.length === 1 ? '' : 's'}` : 'What was completed today?'}</Text>
              {!isLocked && (project.schedule?.tasks?.length ?? 0) > 0 && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => setShowTaskPicker(true)}
                  activeOpacity={0.7}
                  testID="add-work-progress-btn" accessibilityRole="button" accessibilityLabel="Add work">
                  <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            {(project.schedule?.tasks?.length ?? 0) === 0 ? (
              <Text style={styles.emptyText}>
                Build a project schedule first — Work Progress chips pull from your task list.
              </Text>
            ) : workProgress.length === 0 ? (
              <Text style={styles.emptyText}>
                No tasks logged yet — tap + to mark which schedule tasks made progress today.
              </Text>
            ) : (
              <View style={styles.progressChipGrid}>
                {workProgress.map(p => {
                  const phaseColor = PHASE_COLORS[p.phase] ?? PHASE_COLORS.General;
                  return (
                    <View key={p.taskId} style={styles.progressChip}>
                      <View style={[styles.progressChipDot, { backgroundColor: phaseColor }]} />
                      <Text style={styles.progressChipName} numberOfLines={1}>{p.taskName}</Text>
                      <View style={[styles.progressChipPctPill, { backgroundColor: phaseColor + '1A' }]}>
                        <Text style={[styles.progressChipPctText, { color: phaseColor }]}>{p.pct}%</Text>
                      </View>
                      {!isLocked && (
                        <TouchableOpacity
                          onPress={() => setWorkProgress(prev => prev.filter(x => x.taskId !== p.taskId))}
                          hitSlop={{ top: 8, right: 8, bottom: 8, left: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel="Remove"
                        >
                          <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Users size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Workforce</Text>
              <Text style={styles.sectionTotal}>Total · {totalManpower}</Text>
              {!isLocked && (
                <TouchableOpacity
                  style={styles.addSmallBtn}
                  onPress={() => openManpowerEditor()}
                  activeOpacity={0.7}
                  testID="add-manpower-btn" accessibilityRole="button" accessibilityLabel="Add">
                  <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
                </TouchableOpacity>
              )}
            </View>

            {/* 4-tile role rollup. Tiles render even when empty (count=0)
                so the layout doesn't shift as the GC adds entries — Apple
                pattern: skeleton stays put, the numbers fill in. */}
            <View style={styles.roleTileGrid}>
              <RoleTile icon={User} label="Supervisors" count={workforceByRole.supervisors} color="#3B82F6" />
              <RoleTile icon={HardHat} label="Skilled" count={workforceByRole.skilled} color="#10B981" />
              <RoleTile icon={Tractor} label="Operators" count={workforceByRole.operators} color="#5B6470" />
              <RoleTile icon={Users} label="Other" count={workforceByRole.other} color="#F59E0B" />
            </View>

            {totalManHours > 0 && (
              <Text style={styles.workforceTotalLine}>{totalManHours} man-hours today</Text>
            )}

            {manpower.length === 0 && (
              <Text style={styles.emptyText}>No manpower entries yet — tap + to add a crew.</Text>
            )}
            {/* Say where an untouched roster came from — the time clock (what
                was witnessed) or the schedule plan (crewSize is what was
                PLANNED and the 8-hour day is a flat assumption) — because both
                get read later as man-hours on the owner's portal and he is the
                one signing it. The chip goes away the moment he corrects a
                number, because then it is his count. */}
            {manpowerIsUntouchedSeed && !isLocked && (
              <Text style={styles.mpSeedNote} testID="dfr-crew-source">
                {crewSource?.line ?? 'Counts came from today\u2019s schedule and assume an 8-hour day — tap a row to correct it.'}
              </Text>
            )}
            {liveHoursWarning && !isLocked && (
              <Text style={styles.mpSeedNote} testID="dfr-live-hours-warning">{liveHoursWarning}</Text>
            )}
            {clockGapLine && !isLocked && !manpowerIsUntouchedSeed && (
              <View style={styles.mpClockGap} testID="dfr-clock-gap">
                <Text style={styles.mpClockGapText}>{clockGapLine}</Text>
                <TouchableOpacity
                  onPress={addMissingClockRows}
                  accessibilityRole="button"
                  accessibilityLabel="Add the clocked crew to this roster"
                  hitSlop={8}
                  testID="dfr-clock-gap-add"
                >
                  <Text style={styles.mpClockGapAdd}>Add them</Text>
                </TouchableOpacity>
              </View>
            )}
            {manpower.map((entry) => (
              <View key={entry.id} style={styles.mpRow}>
                {/* The row IS the edit control. Correcting four framers to
                    three used to mean trash → confirm → + → four keyboard
                    fields; the steppers below make the common case one thumb
                    tap with gloves on, and this opens the rest. */}
                <TouchableOpacity
                  style={styles.mpInfo}
                  onPress={() => openManpowerEditor(entry)}
                  disabled={isLocked}
                  activeOpacity={0.7}
                  testID={`mp-edit-${entry.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${entry.trade}${entry.company ? `, ${entry.company}` : ''}, ${entry.headcount} workers, ${entry.hoursWorked} hours each`}
                >
                  <Text style={styles.mpTrade}>{entry.trade}</Text>
                  <Text style={styles.mpMeta}>
                    {entry.company ? `${entry.company} · ` : ''}{entry.headcount} workers · {entry.hoursWorked}h each
                  </Text>
                </TouchableOpacity>
                {!isLocked && (
                  <View style={styles.mpStepperRow}>
                    <TouchableOpacity
                      style={styles.mpStepBtn}
                      onPress={() => adjustHeadcount(entry.id, -1)}
                      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                      testID={`mp-minus-${entry.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={entry.headcount <= 1 ? `Remove ${entry.trade}` : `One fewer ${entry.trade}`}
                      accessibilityHint={entry.headcount <= 1 ? 'Below one worker is no crew — this asks to remove the row' : undefined}
                    >
                      <Minus size={14} color={themeColors.text} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.mpStepValue}>{entry.headcount}</Text>
                    <TouchableOpacity
                      style={styles.mpStepBtn}
                      onPress={() => adjustHeadcount(entry.id, 1)}
                      hitSlop={{ top: 6, right: 6, bottom: 6, left: 6 }}
                      testID={`mp-plus-${entry.id}`}
                      accessibilityRole="button"
                      accessibilityLabel={`One more ${entry.trade}`}
                    >
                      <Plus size={14} color={themeColors.text} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                )}
                {!isLocked && (
                  <TouchableOpacity onPress={() => handleRemoveManpower(entry.id)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Delete">
                    <Trash2 size={14} color={themeColors.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Work Performed</Text>
            </View>
            {!isLocked ? (
              <TutorialTarget id="dfr.workPerformed">
              <TextInput
                style={styles.textArea}
                value={workPerformed}
                onChangeText={setWorkPerformed}
                placeholder="Describe work completed today..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                testID="work-performed-input"
              />
              </TutorialTarget>
            ) : (
              <Text style={styles.readOnlyText}>{workPerformed || 'No notes.'}</Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <Package size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Materials Delivered</Text>
            </View>
            {!isLocked && (
              <View style={styles.addMaterialRow}>
                <TextInput
                  style={[styles.materialInput, isDesktop && styles.inputMdDesktop]}
                  value={newMaterial}
                  onChangeText={setNewMaterial}
                  placeholder="Material received..."
                  placeholderTextColor={themeColors.textMuted}
                  onSubmitEditing={handleAddMaterial}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addMaterialBtn} onPress={handleAddMaterial} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Add"><Plus size={16} color={themeColors.accent} strokeWidth={1.75} /></TouchableOpacity>
              </View>
            )}
            {materialsDelivered.length === 0 && (
              <Text style={styles.emptyText}>No materials delivered today.</Text>
            )}
            {/* Loads signed for on the Deliveries screen for this report's day
                that this report does not list yet. One tap adds them, and a
                damaged one also goes into Issues & Delays. */}
            {!isLocked && missingReceiptLines.length > 0 && (
              <Button
                label={`Add ${missingReceiptLines.length} ${missingReceiptLines.length === 1 ? 'load' : 'loads'} received on Deliveries`}
                onPress={handleAddReceiptLines}
                variant="secondary"
                size="sm"
                style={{ marginTop: 8, alignSelf: 'flex-start' as const }}
                testID="dfr-add-receipt-lines"
              />
            )}
            {!isLocked && materialsDelivered.length > 0 && materialsSeedRef.current != null
              && JSON.stringify(materialsDelivered) === materialsSeedRef.current && (
              <Text style={styles.mpSeedNote} testID="dfr-materials-source">
                From receipts on the Deliveries screen for this day — who signed and any damage noted at the tailgate.
              </Text>
            )}
            {materialsDelivered.map((mat, idx) => (
              <View key={idx} style={styles.materialRow}>
                <View style={styles.materialDot} />
                <Text style={styles.materialText}>{mat}</Text>
                {!isLocked && (
                  <TouchableOpacity onPress={() => handleRemoveMaterial(idx)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={14} color={themeColors.danger} strokeWidth={1.75} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <AlertTriangle size={18} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Issues & Delays</Text>
            </View>
            {!isLocked ? (
              <TextInput
                style={styles.textArea}
                value={issuesAndDelays}
                onChangeText={setIssuesAndDelays}
                placeholder="Note any problems or delays..."
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
              />
            ) : (
              <Text style={styles.readOnlyText}>{issuesAndDelays || 'No issues reported.'}</Text>
            )}

            {/* A note typed here is a record of the day, but nothing counts
                down from it. This is the one tap from "I wrote it down" to "the
                date is being tracked." The report's own date is the date the GC
                first knew, which is what the countdown runs from. */}
            {issuesAndDelays.trim().length > 0 && (
              <TouchableOpacity
                style={styles.delayEventBtn}
                onPress={handleLogDelayEvent}
                testID="dfr-log-delay-event"
                accessibilityRole="button"
                accessibilityLabel="Log this as a delay event and start the notice countdown"
              >
                <CalendarClock size={14} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.delayEventBtnText}>{delayEventBtnLabel}</Text>
              </TouchableOpacity>
            )}
            {issuesAndDelays.trim().length > 0 && (
              <Text style={styles.delayEventHint}>
                Starts the countdown against the notice window you set for this job. Saves this
                report first so it can be linked as the evidence for the day you first knew.
              </Text>
            )}
          </View>

          {/* Profit Leak — scan today's notes against the estimate scope for
              unbilled out-of-scope work. AI identifies; the cost book prices. */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ScanSearch size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Profit Leak</Text>
              {leakScan && !leakIsStale && (
                <View style={[leakStyles.badge, leakScan.items.length > 0 ? leakStyles.badgeFlags : leakStyles.badgeClean]}>
                  <Text style={[leakStyles.badgeText, leakScan.items.length > 0 ? leakStyles.badgeTextFlags : leakStyles.badgeTextClean]}>
                    {leakScan.items.length > 0 ? `${leakScan.items.length} ${leakScan.items.length === 1 ? 'FLAG' : 'FLAGS'}` : 'SCANNED'}
                  </Text>
                </View>
              )}
            </View>
            <Text style={leakStyles.helperText}>
              Scans today&apos;s notes against the estimate scope and prior change orders. Flags work you haven&apos;t billed — priced from your own cost history.
            </Text>

            {/* The only persistent door to /profit-leak-history in the product.
                Every other entry is conditional — universal search, a Brain
                drill-in, and a Morning Brief row that appears only when an
                unconverted flag already exists — so the screen that answers
                "did any of these flags ever turn into money" was unreachable
                from the screen that CREATES the flags (audit 2026-09-07,
                built-but-unreachable #12). */}
            <TouchableOpacity
              style={leakStyles.historyLink}
              onPress={() => router.push('/profit-leak-history')}
              testID="leak-history-link"
              accessibilityRole="link"
              accessibilityLabel="See every past leak flag and whether it became a change order"
            >
              <Text style={leakStyles.historyLinkText}>Past flags — what became a change order</Text>
              <ChevronRight size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[leakStyles.scanBtn, isDesktop && desktopCta, leakScanning && leakStyles.scanBtnDisabled]}
              onPress={handleLeakScan}
              disabled={leakScanning}
              testID="leak-scan"
              accessibilityRole="button"
              accessibilityLabel={leakScan ? (leakIsStale ? 'Notes changed — re-scan for unbilled work' : 'Re-scan for unbilled work') : 'Scan for unbilled work'}
              accessibilityState={{ disabled: leakScanning, busy: leakScanning }}
            >
              {leakScanning ? (
                <>
                  <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={leakStyles.scanBtnText}>Reading today&apos;s report…</Text>
                </>
              ) : (
                <>
                  <MageAIMark size={14} color={themeColors.accent} />
                  <Text style={leakStyles.scanBtnText}>
                    {leakScan ? (leakIsStale ? 'Notes changed — re-scan' : 'Re-scan for unbilled work') : 'Scan for unbilled work'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* The FIELD answer to out-of-scope work, always available — not
                only after a scan. A draft change order is the office move and
                the owner can still argue it at closeout; a T&M ticket signed
                on site while the work is visible is what makes it stick. */}
            <TouchableOpacity
              style={[leakStyles.scanBtn, isDesktop && desktopCta]}
              onPress={() => router.push({
                pathname: '/field-ticket',
                params: {
                  projectId,
                  start: '1',
                  ...(reportId ? { sourceDailyReportId: reportId } : null),
                  ...(issuesAndDelays.trim() ? { prefillWork: issuesAndDelays.trim() } : null),
                },
              })}
              testID="dfr-field-ticket"
              accessibilityRole="button"
              accessibilityLabel="Write a T and M field ticket and get it signed on site"
            >
              <FileSignature size={14} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={leakStyles.scanBtnText}>Write a T&amp;M ticket — get it signed on site</Text>
            </TouchableOpacity>

            {leakScan && leakScan.items.length === 0 && (
              <View style={leakStyles.cleanRow}>
                <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
                <Text style={leakStyles.cleanText}>Nothing out of scope detected in this report.</Text>
              </View>
            )}

            {leakScan && leakScan.items.length > 0 && (
              <View style={leakStyles.resultBlock}>
                {leakIsStale && (
                  <Text style={leakStyles.staleHint}>Notes changed since this scan — re-scan for fresh results.</Text>
                )}
                {leakScan.items.map((item, i) => (
                  <View key={i} style={[leakStyles.itemRow, leakIsStale && leakStyles.itemRowStale]}>
                    <AlertTriangle size={14} color={leakIsStale ? themeColors.textMuted : Colors.warning} strokeWidth={1.75} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={[leakStyles.itemDesc, leakIsStale && leakStyles.itemDescStale]}>{item.description}</Text>
                      {!!item.reportQuote && <Text style={leakStyles.itemQuote}>&ldquo;{item.reportQuote}&rdquo;</Text>}
                      <Text style={leakStyles.itemMeta}>
                        {/* A seeded rate is the GC's own number, not history —
                            caption it as what it is. */}
                        {item.trade} · {item.estimatedPrice !== null
                          ? `~$${item.estimatedPrice.toLocaleString('en-US')} ${item.rateProvenance === 'seeded' ? 'from the rate you set' : 'from your cost history'}`
                          : 'No price history — price it yourself'} · {item.confidence} confidence
                      </Text>
                    </View>
                  </View>
                ))}
                {/* Disable Draft-CO when scan is stale — text has changed since scan.
                    And for anyone but the owner (#41, interim): migration
                    20260919110000 refuses a CO insert from a collaborator, so
                    the draft could never reach the server — the scope stays in
                    this report, which goes to the GC as a field issue. */}
                {!isProjectOwner && (
                  <Text style={leakStyles.draftCoBlockedNote} testID="leak-draft-co-blocked">
                    {DFR_GC_CREATES_COS}
                  </Text>
                )}
                <TouchableOpacity
                  style={[leakStyles.draftCoBtn, (leakIsStale || !isProjectOwner) && leakStyles.draftCoBtnDisabled]}
                  onPress={leakIsStale || !isProjectOwner ? undefined : handleDraftLeakCO}
                  disabled={leakIsStale || !isProjectOwner}
                  testID="leak-draft-co"
                  accessibilityRole="button"
                  accessibilityLabel={(() => {
                    if (!isProjectOwner) return DFR_GC_CREATES_COS;
                    if (leakIsStale) return 'Re-scan first — notes changed';
                    const t = leakScan.items.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);
                    return t > 0 ? `Draft change order for approximately $${t.toLocaleString('en-US')}` : 'Draft change order';
                  })()}
                  accessibilityState={{ disabled: leakIsStale || !isProjectOwner }}
                >
                  <Text style={[leakStyles.draftCoBtnText, leakIsStale && leakStyles.draftCoBtnTextDisabled]}>
                    {leakIsStale ? 'Re-scan first — notes changed' : (() => {
                      const t = leakScan.items.reduce((s, it) => s + (it.estimatedPrice ?? 0), 0);
                      return t > 0 ? `Draft change order · ~$${t.toLocaleString('en-US')}` : 'Draft change order';
                    })()}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          {/* Delay cascade — one tap turns the delay noted above into the downstream
              schedule ripple. AI reads the text; the user confirms task + days; the
              CPM engine computes every number. */}
          {scheduleTasks.length > 0 && issuesAndDelays.trim().length > 0 && (
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeader}>
                <CalendarClock size={18} color={themeColors.accent} strokeWidth={1.75} />
                <Text style={styles.sectionTitle}>Schedule impact</Text>
                {showAppliedPill && (
                  <View style={dcStyles.appliedPill}>
                    <Text style={dcStyles.appliedPillText}>APPLIED</Text>
                  </View>
                )}
              </View>
              <Text style={dcStyles.helperText}>
                Reads the delays above, maps them to schedule tasks, and shows the downstream ripple — what slides, what turns critical, how the finish moves. Nothing changes until you apply it.
              </Text>

              <TouchableOpacity
                style={[dcStyles.aiBtn, isDesktop && desktopCta, delayScanning && dcStyles.aiBtnDisabled]}
                onPress={handleDelayScan}
                disabled={delayScanning}
                testID="delay-scan"
                accessibilityRole="button"
                accessibilityLabel={delayRows ? 'Re-check schedule impact' : 'Check schedule impact'}
                accessibilityState={{ disabled: delayScanning, busy: delayScanning }}
              >
                {delayScanning ? (
                  <>
                    <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={dcStyles.aiBtnText}>Reading the delays…</Text>
                  </>
                ) : (
                  <>
                    <MageAIMark size={14} color={themeColors.accent} />
                    <Text style={dcStyles.aiBtnText}>{delayRows ? 'Re-check schedule impact' : 'Check schedule impact'}</Text>
                  </>
                )}
              </TouchableOpacity>

              {delayRows && delayRows.length === 0 && (
                <View style={dcStyles.cleanRow}>
                  <CheckCircle2 size={16} color={themeColors.success} strokeWidth={1.75} />
                  <Text style={dcStyles.cleanText}>No delay language detected in this report.</Text>
                </View>
              )}

              {delayRows && delayRows.length > 0 && !delayPreviewOps && (
                <View style={dcStyles.rowsBlock}>
                  {delayRows.map((row, i) => {
                    const rowTask = scheduleTasks.find(t => t.id === row.taskId);
                    return (
                      <View key={i} style={[dcStyles.hitRow, delayAlreadyApplied && dcStyles.hitRowApplied]}>
                        <View style={dcStyles.hitQuoteRow}>
                          <Text style={[dcStyles.hitQuote, { flex: 1 }]}>&ldquo;{row.quote}&rdquo;</Text>
                          <TouchableOpacity
                            style={dcStyles.hitDismissBtn}
                            onPress={() => setDelayRows(rs => (rs ?? []).filter((_, j) => j !== i))}
                            disabled={delayAlreadyApplied}
                            hitSlop={8}
                            testID={`delay-dismiss-${i}`}
                            accessibilityRole="button"
                            accessibilityLabel="Dismiss this delay"
                            accessibilityState={{ disabled: delayAlreadyApplied }}
                          >
                            <X size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                          </TouchableOpacity>
                        </View>
                        <View style={dcStyles.hitControls}>
                          <TouchableOpacity
                            style={dcStyles.taskPickBtn}
                            onPress={() => setDelayTaskPickerIdx(i)}
                            disabled={delayAlreadyApplied}
                            activeOpacity={0.7}
                            testID={`delay-task-${i}`}
                            accessibilityRole="button"
                            accessibilityLabel={rowTask ? `Delayed task: ${rowTask.title}` : 'Delayed task: none picked'}
                            accessibilityState={{ disabled: delayAlreadyApplied }}
                          >
                            <Link2 size={14} color={rowTask ? themeColors.accent : themeColors.textMuted} strokeWidth={1.75} />
                            <Text style={[dcStyles.taskPickText, !rowTask && { color: themeColors.textMuted }]} numberOfLines={1}>
                              {rowTask ? rowTask.title : 'Pick the delayed task'}
                            </Text>
                            <ChevronDown size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                          </TouchableOpacity>
                          <View style={dcStyles.stepperRow}>
                            <TouchableOpacity
                              style={dcStyles.stepBtn}
                              onPress={() => setDelayRows(rs => (rs ?? []).map((r, j) => j === i ? { ...r, deltaDays: Math.max(1, r.deltaDays - 1) } : r))}
                              disabled={delayAlreadyApplied}
                              accessibilityRole="button" accessibilityLabel="One day less"
                              accessibilityState={{ disabled: delayAlreadyApplied }}
                            >
                              <Minus size={14} color={themeColors.text} strokeWidth={2} />
                            </TouchableOpacity>
                            <Text style={dcStyles.stepValue}>{row.deltaDays}d</Text>
                            <TouchableOpacity
                              style={dcStyles.stepBtn}
                              onPress={() => setDelayRows(rs => (rs ?? []).map((r, j) => j === i ? { ...r, deltaDays: Math.min(MAX_DELTA_DAYS, r.deltaDays + 1) } : r))}
                              disabled={delayAlreadyApplied}
                              accessibilityRole="button" accessibilityLabel="One day more"
                              accessibilityState={{ disabled: delayAlreadyApplied }}
                            >
                              <Plus size={14} color={themeColors.text} strokeWidth={2} />
                            </TouchableOpacity>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                  {delayAlreadyApplied ? (
                    // This exact delay text was already applied to the schedule —
                    // re-applying would double-shift the same tasks. Explicit
                    // re-arm required to run it again.
                    <View style={dcStyles.appliedNotice}>
                      <CheckCircle2 size={15} color={themeColors.success} strokeWidth={1.75} />
                      <Text style={dcStyles.appliedNoticeText}>{appliedNoticeText}</Text>
                      <TouchableOpacity
                        style={dcStyles.reArmBtn}
                        onPress={() => setDelayReArmed(true)}
                        activeOpacity={0.7}
                        testID="delay-rearm"
                        accessibilityRole="button"
                        accessibilityLabel="Re-arm to apply this delay again"
                      >
                        <Text style={dcStyles.reArmBtnText}>Re-arm</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      {delayRowsStale && (
                        <Text style={dcStyles.staleNoticeText}>Report text changed — re-check schedule impact.</Text>
                      )}
                      {delayRippleBlockedReason && (
                        <Text style={dcStyles.staleNoticeText} testID="delay-ripple-blocked">{delayRippleBlockedReason}</Text>
                      )}
                      <TouchableOpacity
                        style={[dcStyles.previewBtn, (confirmableRows.length === 0 || delayRowsStale || !!delayRippleBlockedReason) && dcStyles.previewBtnOff]}
                        onPress={handlePreviewRipple}
                        disabled={confirmableRows.length === 0 || delayRowsStale || !!delayRippleBlockedReason}
                        activeOpacity={0.85}
                        testID="delay-preview"
                        accessibilityRole="button"
                        accessibilityLabel="Preview the ripple"
                        accessibilityState={{ disabled: confirmableRows.length === 0 || delayRowsStale || !!delayRippleBlockedReason }}
                      >
                        <Text style={dcStyles.previewBtnText}>
                          {delayRippleBlockedReason
                            ? 'Ripple needs editor access'
                            : delayRowsStale
                            ? 'Re-check schedule impact first'
                            : confirmableRows.length === 0
                              ? 'Pick a task to preview the ripple'
                              : `Preview the ripple (${confirmableRows.length} ${confirmableRows.length === 1 ? 'delay' : 'delays'})`}
                        </Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
              )}

              {delayPreviewOps && (
                <View style={dcStyles.diffWrap}>
                  <ScheduleDiffView
                    ops={delayPreviewOps}
                    ctx={diffCtx}
                    onApply={handleApplyRipple}
                    onDiscard={() => setDelayPreviewOps(null)}
                  />
                </View>
              )}
            </View>
          )}

          {/* Homeowner-friendly summary — AI generates from technical fields,
              GC reviews + edits, then publishes to the portal as the daily
              "Latest update" panel. The toggle for what shows in portal is
              the published flag (independent of the technical DFR being sent
              by email). */}
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HomeIcon size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Homeowner update</Text>
              {/* #22: the pill says what the portal HOLDS (the saved flag), not
                  what the local toggle hopes. */}
              {hsControl.pill && (
                <View style={hsStyles.publishedPill}>
                  <Text style={hsStyles.publishedPillText}>PUBLISHED</Text>
                </View>
              )}
            </View>
            <Text style={hsStyles.helperText}>
              A short, jargon-free summary of today for the homeowner&apos;s portal. AI writes a draft from your notes above — review, edit, then publish.
            </Text>

            {hsEditable && hsTextLockedReason && (
              <Text style={hsStyles.blockedNote} testID="hs-text-locked">{hsTextLockedReason}</Text>
            )}

            {hsEditable && !hsTextLockedReason && (
              <TouchableOpacity
                style={[hsStyles.aiBtn, isDesktop && desktopCta, hsGenerating && hsStyles.aiBtnDisabled]}
                onPress={handleGenerateHomeownerSummary}
                disabled={hsGenerating}
                testID="hs-generate"
              >
                {hsGenerating ? (
                  <>
                    <RefreshCw size={14} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={hsStyles.aiBtnText}>Writing the homeowner version…</Text>
                  </>
                ) : (
                  <>
                    <MageAIMark size={14} color={themeColors.accent} />
                    <Text style={hsStyles.aiBtnText}>{homeownerSummary ? 'Re-generate from notes' : 'Generate from today\'s notes'}</Text>
                  </>
                )}
              </TouchableOpacity>
            )}

            {hsEditable && !hsTextLockedReason ? (
              <TextInput
                style={[styles.textArea, { marginTop: 10 }]}
                value={homeownerSummary}
                onChangeText={(v) => {
                  setHomeownerSummary(v);
                  // An edit written for the report's current day is no longer stale (#115).
                  setHsWrittenForDay(v.trim() ? reportCalendarDay : null);
                  if (hsPublished) setHsPublished(false);  // edit invalidates the published copy
                }}
                placeholder='AI draft will appear here. Or write your own — "Hi Sarah, big day on site today…"'
                placeholderTextColor={themeColors.textMuted}
                multiline
                textAlignVertical="top"
                editable={!hsGenerating}
              />
            ) : (
              <Text style={styles.readOnlyText}>{homeownerSummary || 'No homeowner summary.'}</Text>
            )}

            {hsHighlights.length > 0 && (
              <View style={hsStyles.highlightsBlock}>
                <Text style={hsStyles.highlightsLabel}>Suggested bullet points</Text>
                {hsHighlights.map((h, i) => (
                  <View key={i} style={hsStyles.highlightRow}>
                    <View style={hsStyles.highlightDot} />
                    <Text style={hsStyles.highlightText}>{h}</Text>
                  </View>
                ))}
              </View>
            )}

            {hsLookingAhead && (
              <Text style={hsStyles.lookingAhead}>
                Looking ahead: {hsLookingAhead}
              </Text>
            )}

            {hsStale && (
              <Text style={hsStyles.staleNote} testID="hs-stale">
                Written for {formatCalendarDay(hsWrittenForDay ?? '', { weekday: 'short', month: 'short', day: 'numeric' })}, but this report is now dated {formatCalendarDay(reportCalendarDay ?? '', { weekday: 'short', month: 'short', day: 'numeric' })}. Re-generate or edit it before it goes to the homeowner.
              </Text>
            )}

            {hsEditable && homeownerSummary.trim().length > 0 && (
              <>
                <TouchableOpacity
                  style={[
                    hsStyles.publishBtn,
                    hsControl.pill && !hsControl.pending && hsStyles.publishBtnPublished,
                    hsPublishBlockedReason && hsStyles.publishBtnDisabled,
                  ]}
                  onPress={() => {
                    if (hsPublishBlockedReason) return;
                    setHsPublished(p => !p);
                    if (Platform.OS !== 'web') void Haptics.selectionAsync().catch(() => {});
                  }}
                  disabled={!!hsPublishBlockedReason}
                  accessibilityRole="button"
                  accessibilityLabel={hsPublishBlockedReason ?? hsControl.label}
                  accessibilityState={{ disabled: !!hsPublishBlockedReason }}
                  testID="hs-publish-toggle"
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    {hsControl.pill && !hsControl.pending && <CheckCircle2 size={Type.footnote.fontSize} color={themeColors.success} strokeWidth={2} />}
                    <Text style={[hsStyles.publishBtnText, hsControl.pill && !hsControl.pending && hsStyles.publishBtnTextPublished]}>
                      {hsControl.label}
                    </Text>
                  </View>
                </TouchableOpacity>
                {hsPublishBlockedReason ? (
                  <Text style={hsStyles.blockedNote} testID="hs-publish-blocked">{hsPublishBlockedReason}</Text>
                ) : hsControl.pill && !hsControl.pending ? (
                  // #23: only what the paths actually do — the portal reads the
                  // newest published update from this report once it has synced
                  // (the server overlay), whoever's phone is open.
                  <Text style={hsStyles.blockedNote} testID="hs-published-note">
                    The homeowner&apos;s portal shows this update once the report has synced.
                  </Text>
                ) : null}
              </>
            )}

            {/* #58: a submitted report's homeowner update saves on its own —
                only these three fields, never the locked report. */}
            {hsEditableWhenLocked && hsUpdateDirty && (
              <View style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                <Button
                  label={hsPublishedSaved && !hsPublished ? 'Save — take it down' : 'Save update'}
                  onPress={() => handleSaveHomeownerUpdate()}
                  size="sm"
                  testID="hs-save-update"
                />
              </View>
            )}
            {isLocked && !publishAccess.allowed && (
              <Text style={hsStyles.blockedNote} testID="hs-locked-owner-decides">
                {publishAccess.reason ?? DFR_OWNER_DECIDES_HOMEOWNER}
              </Text>
            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <HardHat size={18} color={themeColors.danger} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Safety & Incident</Text>
            </View>
            {!isLocked ? (
              <>
                <TouchableOpacity
                  style={[styles.incidentToggle, isDesktop && desktopToggle, incident.hasIncident && styles.incidentToggleActive]}
                  onPress={() => setIncident(p => ({ ...p, hasIncident: !p.hasIncident }))}
                  activeOpacity={0.85}
                >
                  <View style={[styles.incidentToggleDot, incident.hasIncident && styles.incidentToggleDotActive]} />
                  <Text style={[styles.incidentToggleText, incident.hasIncident && { color: themeColors.danger }]}>
                    {incident.hasIncident ? 'Incident occurred today' : 'No incidents today'}
                  </Text>
                </TouchableOpacity>

                {/* Unticking the toggle does NOT retract a case already on the
                    safety register. Deleting an OSHA record is a deliberate act
                    with a five-year retention rule behind it, not a side effect
                    of a mis-tap on a daily report — so say where it went instead
                    of quietly dropping it. */}
                {!incident.hasIncident && linkedIncident && (
                  <Text style={styles.incidentRegisterNote} testID="dfr-incident-orphan-note">
                    An incident from this report is already on the safety record. Unticking here does not remove it —
                    delete it in the Incidents log if it was filed in error.
                  </Text>
                )}

                {incident.hasIncident && (
                  <View style={styles.incidentBlock}>
                    {/* What KIND of event. isOshaRecordable branches on this
                        first — anything other than an injury is never recordable
                        absent a fatality — and the DFR's single five-value
                        severity cannot supply it. Inferring it from a severity
                        of 'near_miss' is exactly how a genuine near-miss ends up
                        a candidate 300 case. */}
                    {/* #122 (interim): someone else's report whose case this
                        seat cannot see — the classification is locked with
                        the reason and saving writes no case. */}
                    {caseNotYoursReason && (
                      <Text style={styles.incidentRegisterNote} testID="dfr-incident-case-not-yours">{caseNotYoursReason}</Text>
                    )}
                    {caseLogLoading && (
                      <Text style={styles.incidentRegisterNote} testID="dfr-incident-case-loading">Loading the injury log on this phone — the classification unlocks when it has loaded. Saving now files the case once it has.</Text>
                    )}
                    <Text style={styles.incidentLabel}>What kind of incident?</Text>
                    <View
                      style={[styles.severityRow, !classificationKnown && { opacity: 0.5 }]}
                      pointerEvents={classificationKnown ? 'auto' : 'none'}
                      accessibilityState={{ disabled: !classificationKnown }}
                    >
                      {(['injury', 'near_miss', 'property', 'environmental'] as IncidentType[]).map(t => {
                        const active = incidentClass.type === t;
                        return (
                          <TouchableOpacity
                            key={t}
                            style={[styles.severityChip, active && styles.severityChipActive]}
                            onPress={() => setIncidentClass(p => ({
                              ...p,
                              type: t,
                              // Leaving injury clears the medical answers with it.
                              // They are hidden for a non-injury event, and a
                              // hidden `fatality: true` left over from a mis-tap
                              // would short-circuit the classifier into
                              // "Recordable — fatality" on a property-damage
                              // event, with no control on screen to untick.
                              // Nothing the super cannot see gets to decide this.
                              ...(t === 'injury' ? null : {
                                treatment: 'none' as Treatment,
                                daysAway: '',
                                daysRestricted: '',
                                restrictedDuty: false,
                                lostConsciousness: false,
                                fatality: false,
                              }),
                            }))}
                            testID={`dfr-incident-type-${t}`}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                          >
                            <Text style={[styles.severityChipText, active && styles.severityChipTextActive]}>
                              {DFR_INCIDENT_TYPE_LABEL[t]}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.incidentLabel}>Severity</Text>
                    <View style={styles.severityRow}>
                      {(['near_miss','minor','moderate','major','critical'] as IncidentSeverity[]).map(sev => {
                        const active = incident.severity === sev;
                        const labels: Record<IncidentSeverity, string> = {
                          near_miss: 'Near Miss', minor: 'Minor', moderate: 'Moderate', major: 'Major', critical: 'Critical',
                        };
                        return (
                          <TouchableOpacity
                            key={sev}
                            style={[styles.severityChip, active && styles.severityChipActive]}
                            onPress={() => setIncident(p => ({ ...p, severity: sev }))}
                          >
                            <Text style={[styles.severityChipText, active && styles.severityChipTextActive]}>{labels[sev]}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <Text style={styles.incidentLabel}>What happened?</Text>
                    <TextInput
                      style={styles.textArea}
                      value={incident.description ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, description: val }))}
                      placeholder="Describe the incident..."
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>People involved</Text>
                    <TextInput
                      style={[styles.textInput, isDesktop && styles.inputMdDesktop]}
                      value={incident.peopleInvolved ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, peopleInvolved: val }))}
                      placeholder="Names or roles"
                      placeholderTextColor={themeColors.textMuted}
                    />

                    {/* DFR-OSHA-BRIDGE. The three checkboxes that used to sit
                        here — Injuries, Medical treatment, and a self-ticked
                        "OSHA recordable" — asked the super to certify a 1904
                        determination from memory while the app's own classifier
                        sat unused. What he can actually answer is below; the
                        determination is computed and shown with its reason. */}
                    {incidentClass.type === 'injury' && (
                      <View
                        style={!classificationKnown ? { opacity: 0.5 } : undefined}
                        pointerEvents={classificationKnown ? 'auto' : 'none'}
                        accessibilityState={{ disabled: !classificationKnown }}
                        testID="dfr-incident-classification"
                      >
                        <Text style={styles.incidentLabel}>Treatment given</Text>
                        <View style={styles.severityRow}>
                          {(['none', 'first_aid', 'medical_beyond_first_aid'] as Treatment[]).map(tr => {
                            const active = incidentClass.treatment === tr;
                            return (
                              <TouchableOpacity
                                key={tr}
                                style={[styles.severityChip, active && styles.severityChipActive]}
                                onPress={() => setIncidentClass(p => ({ ...p, treatment: tr }))}
                                testID={`dfr-incident-treatment-${tr}`}
                                accessibilityRole="button"
                                accessibilityState={{ selected: active }}
                              >
                                <Text style={[styles.severityChipText, active && styles.severityChipTextActive]}>
                                  {DFR_TREATMENT_LABEL[tr]}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>

                        <View style={styles.oshaDaysRow}>
                          <View style={styles.oshaDaysItem}>
                            <Text style={styles.incidentLabel}>Days away from work</Text>
                            <TextInput
                              style={[styles.textInput, isDesktop && styles.inputXsDesktop]}
                              value={incidentClass.daysAway}
                              onChangeText={val => setIncidentClass(p => ({ ...p, daysAway: val.replace(/[^0-9]/g, '') }))}
                              placeholder="0"
                              placeholderTextColor={themeColors.textMuted}
                              keyboardType="number-pad"
                              editable={classificationKnown}
                              testID="dfr-incident-days-away"
                            />
                          </View>
                          <View style={styles.oshaDaysItem}>
                            <Text style={styles.incidentLabel}>Days on restricted duty</Text>
                            <TextInput
                              style={[styles.textInput, isDesktop && styles.inputXsDesktop]}
                              value={incidentClass.daysRestricted}
                              onChangeText={val => setIncidentClass(p => ({ ...p, daysRestricted: val.replace(/[^0-9]/g, '') }))}
                              placeholder="0"
                              placeholderTextColor={themeColors.textMuted}
                              keyboardType="number-pad"
                              editable={classificationKnown}
                              testID="dfr-incident-days-restricted"
                            />
                          </View>
                        </View>

                        <View style={styles.checkboxRow}>
                          <TouchableOpacity
                            style={styles.checkboxItem}
                            onPress={toggleRestrictedDuty}
                            testID="dfr-incident-restricted"
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: restrictedShownOn }}
                          >
                            <View style={[styles.checkbox, restrictedShownOn && styles.checkboxActive]} />
                            <Text style={styles.checkboxLabel}>
                              Restricted work / transfer{incidentClassInput.daysRestricted ? ` (${incidentClassInput.daysRestricted} day${incidentClassInput.daysRestricted === 1 ? '' : 's'} entered)` : ''}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.checkboxItem}
                            onPress={() => setIncidentClass(p => ({ ...p, lostConsciousness: !p.lostConsciousness }))}
                            testID="dfr-incident-unconscious"
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: incidentClass.lostConsciousness }}
                          >
                            <View style={[styles.checkbox, incidentClass.lostConsciousness && styles.checkboxActive]} />
                            <Text style={styles.checkboxLabel}>Lost consciousness</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.checkboxItem}
                            onPress={() => setIncidentClass(p => ({ ...p, fatality: !p.fatality }))}
                            testID="dfr-incident-fatality"
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: incidentClass.fatality }}
                          >
                            <View style={[styles.checkbox, incidentClass.fatality && styles.checkboxActive]} />
                            <Text style={styles.checkboxLabel}>Fatality</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* The determination, shown rather than asked for. Grounded
                        (it names the 1904 criterion that decided it) and honest
                        (it is the same value stored on the case, taken from the
                        classifier, not re-derived here). */}
                    {classificationKnown && (
                    <View
                      style={[styles.oshaVerdict, recordability.recordable && styles.oshaVerdictHot]}
                      testID="dfr-incident-recordability"
                    >
                      {recordability.recordable
                        ? <AlertTriangle size={14} color={themeColors.danger} strokeWidth={2} />
                        : <CheckCircle2 size={14} color={themeColors.textSecondary} strokeWidth={1.75} />}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.oshaVerdictText, recordability.recordable && styles.oshaVerdictTextHot]}>
                          {recordability.reason}
                        </Text>
                        <Text style={styles.oshaVerdictSub}>
                          Worked out from OSHA 1904 recording criteria and what you answered above — verify against
                          your recordkeeping before posting the 300.
                        </Text>
                      </View>
                    </View>
                    )}

                    <Text style={styles.incidentLabel}>Corrective action</Text>
                    <TextInput
                      style={styles.textArea}
                      value={incident.correctiveAction ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, correctiveAction: val }))}
                      placeholder="Immediate fixes, training, policy changes..."
                      placeholderTextColor={themeColors.textMuted}
                      multiline
                      textAlignVertical="top"
                    />

                    <Text style={styles.incidentLabel}>Reported by</Text>
                    <TextInput
                      style={[styles.textInput, isDesktop && styles.inputMdDesktop]}
                      value={incident.reportedBy ?? ''}
                      onChangeText={val => setIncident(p => ({ ...p, reportedBy: val }))}
                      placeholder="Your name / role"
                      placeholderTextColor={themeColors.textMuted}
                    />

                    {/* #87: which photos are evidence of THIS incident. None by
                        default — a delivery or progress shot is not injury
                        evidence — and each one marked goes on the case as a
                        synced storage path, never a phone-only file. */}
                    {photos.length > 0 && classificationKnown && (
                      <>
                        <Text style={styles.incidentLabel}>Incident photos</Text>
                        <View style={styles.incidentPhotoRow}>
                          {photos.map((photo, i) => {
                            const on = !!(photo as DfrPhotoWithFlag).incidentPhoto;
                            return (
                              <TouchableOpacity
                                key={photo.id}
                                style={[styles.incidentPhotoThumb, on && styles.incidentPhotoThumbOn]}
                                onPress={() => toggleIncidentPhoto(photo.id)}
                                accessibilityRole="checkbox"
                                accessibilityState={{ checked: on }}
                                accessibilityLabel={`Photo ${i + 1}: ${on ? 'attached to the incident' : 'not attached to the incident'}`}
                                testID={`dfr-incident-photo-${photo.id}`}
                              >
                                <Image source={{ uri: photo.uri }} style={styles.incidentPhotoImg} />
                                {on && (
                                  <View style={styles.incidentPhotoCheck}>
                                    <CheckCircle2 size={14} color={themeColors.success} strokeWidth={2} />
                                  </View>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <Text style={styles.incidentRegisterNote}>
                          Tap the photos that show the incident — only those go on the case (up to {MAX_INCIDENT_PHOTOS}). Unmarking one here doesn&apos;t take it off a case already filed; remove it in Incidents.
                        </Text>
                      </>
                    )}

                    {/* #89: the owner deleted this report's case in Incidents. */}
                    {caseDeletedInLog && (
                      <View testID="dfr-incident-case-deleted">
                        <Text style={styles.incidentRegisterNote}>
                          The case from this report was deleted in Incidents, so saving will not file it again.
                        </Text>
                        <TouchableOpacity onPress={refileDeletedCase} accessibilityRole="button" testID="dfr-incident-refile">
                          <Text style={styles.incidentRefileText}>File it again</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {/* Where this ends up. Two states, both honest: filed
                        already, or filed on save. Neither claims the OSHA 300
                        will list it — only a recordable case reaches the 300,
                        and the verdict above says whether this one is. */}
                    {caseDeletedInLog || caseNotYoursReason ? null : linkedIncident && isProjectOwner && canAccessOnProject('safety_management') ? (
                      <TouchableOpacity
                        style={styles.incidentRegisterChip}
                        onPress={() => router.push({ pathname: '/safety-incidents', params: { projectId } })}
                        testID="dfr-incident-open-case"
                        accessibilityRole="link"
                        accessibilityLabel="Open this incident on the safety record"
                      >
                        <ShieldAlert size={14} color={themeColors.accent} strokeWidth={1.75} />
                        <Text style={styles.incidentRegisterChipText}>
                          {/* #83: the case is the record now; the report only
                              adds to it on re-save. */}
                          Case filed — edit people, actions and photos in Incidents{isRecordableCase(linkedIncident) ? ' · counted on the OSHA 300' : ''}
                        </Text>
                        <ChevronRight size={14} color={themeColors.textSecondary} strokeWidth={1.75} />
                      </TouchableOpacity>
                    ) : linkedIncident && !isProjectOwner ? (
                      // #82: a collaborator's case reaches the owner (20260919130000)
                      // but is not "his" safety record, and he keeps no OSHA 300.
                      <Text style={styles.incidentRegisterNote} testID="dfr-incident-case-collab">
                        {dfrIncidentFileNote(false)}
                      </Text>
                    ) : linkedIncident ? (
                      // Don't send him into a paywall from a chip that reads like
                      // a link. The case IS filed — that is the part that matters
                      // months later — so say that plainly and name what the tier
                      // actually buys, rather than a blocked door with no reason.
                      <Text style={styles.incidentRegisterNote} testID="dfr-incident-case-locked">
                        Filed on your safety record{isRecordableCase(linkedIncident) ? ' as an OSHA-recordable case' : ''}.
                        The Incidents log and the OSHA 300 export open on Business — the record is kept either way.
                      </Text>
                    ) : (
                      <Text style={styles.incidentRegisterNote} testID="dfr-incident-will-file">
                        {dfrIncidentFileNote(isProjectOwner)}
                      </Text>
                    )}
                  </View>
                )}
              </>
            ) : (
              <>
                <Text style={styles.readOnlyText}>
                  {incident.hasIncident
                    ? `${incident.severity?.replace('_', ' ').toUpperCase()} — ${incident.description || 'No description.'}`
                    : 'No incidents reported.'}
                </Text>
                {/* A sent report is the version anyone else reads, so it has to
                    carry the determination too — not just the description. */}
                {incident.hasIncident && classificationKnown && (
                  <Text style={styles.incidentRegisterNote}>{recordability.reason}</Text>
                )}
              </>

            )}
          </View>

          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <ImageIcon size={18} color={themeColors.accent} strokeWidth={1.75} />
              <Text style={styles.sectionTitle}>Photos ({photos.length}/10)</Text>
            </View>
            {!isLocked && (
              <View style={styles.photoActions}>
                {Platform.OS !== 'web' && (
                  <TouchableOpacity style={styles.photoBtn} onPress={handleTakePhoto} activeOpacity={0.7}>
                    <Camera size={16} color={themeColors.accent} strokeWidth={1.75} />
                    <Text style={styles.photoBtnText}>Take Photo</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.photoBtn} onPress={handlePickPhoto} activeOpacity={0.7}>
                  <ImageIcon size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <Text style={styles.photoBtnText}>From Library</Text>
                </TouchableOpacity>
              </View>
            )}
            {photos.length === 0 && (
              <Text style={styles.emptyText}>No photos attached.</Text>
            )}
            {photos.length > 0 && (
              <View style={styles.photoGrid}>
                {photos.map((photo) => (
                  <View key={photo.id} style={styles.photoCard}>
                    {/* Render the actual captured/library photo. photoCard is a
                        fixed 80x80 with overflow:hidden, so cover-fit fills the
                        tile. The capture time sits in a small overlay caption
                        at the bottom so the GC can still read it at a glance.
                        #25: a tap opens the markup tool on the photo's project
                        copy (same id); the filed PDF prints what he draws. */}
                    <TouchableOpacity
                      onPress={() => handlePhotoTap(photo.id)}
                      activeOpacity={0.8}
                      accessibilityRole="button"
                      accessibilityLabel={markedUpPhotoIds.has(photo.id) ? 'Edit markup on this photo' : 'Mark up this photo'}
                      testID={`dfr-photo-markup-${photo.id}`}
                    >
                      <Image
                        source={{ uri: photo.uri }}
                        style={styles.photoImage}
                        resizeMode="cover"
                      />
                    </TouchableOpacity>
                    {markedUpPhotoIds.has(photo.id) && (
                      <View style={{ position: 'absolute', top: 4, left: 4, borderRadius: Tokens.radius.full, backgroundColor: themeColors.surface, padding: 3 }} pointerEvents="none">
                        <PenLine size={11} color={themeColors.accent} strokeWidth={2} />
                      </View>
                    )}
                    <View style={styles.photoTimestampOverlay} pointerEvents="none">
                      <Text style={styles.photoTimestampOverlayText} numberOfLines={1}>
                        {new Date(photo.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                      </Text>
                    </View>
                    {!isLocked && (
                      <TouchableOpacity
                        style={styles.photoRemoveBtn}
                        onPress={() => handleRemovePhoto(photo.id)}
                        activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Close">
                        <X size={12} color={themeColors.danger} strokeWidth={1.75} />
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>

          {existingReport && publishAccess.allowed && (
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              <SendToClientButton
                kind="daily_report"
                itemId={existingReport.id}
                projectId={existingReport.projectId}
                portalState={existingReport.portalState}
                itemUpdatedAt={existingReport.updatedAt}
                canSend={workPerformed.trim().length > 0 || manpower.length > 0}
                canSendReason={workPerformed.trim().length === 0 && manpower.length === 0 ? 'Add work performed or crew before sending.' : undefined}
              />
            </View>
          )}
          {/* #116: a field or viewer seat does not decide what reaches the
              homeowner. Not a disabled SendToClientButton — its Recall ignores
              canSend — but a plain statement of where the report stands: with
              the owner's auto-share on it is already shared, with it off,
              sending is the owner's call (the server keeps portal_state too). */}
          {portalSeatNote && (
            <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
              <Text style={hsStyles.blockedNote} testID="dfr-portal-owner-decides">
                {portalSeatNote}
              </Text>
            </View>
          )}
          </TutorialScrollAnchor>
        </ScrollView>

        {/* Bottom save bar removed — Save Draft + Submit now live in the
            top bar where the Apple-style mock places them. */}
      </KeyboardAvoidingView>

      <Modal visible={showSendRecipient} transparent animationType={fSend.animationType} onRequestClose={() => setShowSendRecipient(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalOverlay, fSend.overlay]}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }, fSend.card]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Send Report To</Text>
                <TouchableOpacity onPress={() => setShowSendRecipient(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>

              {contactPicked ? (
                <View style={styles.selectedRecipientCard}>
                  <User size={16} color={themeColors.accent} strokeWidth={1.75} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.selectedRecipientName}>{sendRecipientName}</Text>
                    {sendRecipientEmail ? <Text style={styles.selectedRecipientEmail}>{sendRecipientEmail}</Text> : null}
                  </View>
                  <TouchableOpacity onPress={() => { setSendRecipientName(''); setSendRecipientEmail(''); setContactPicked(false); }} style={styles.clearRecipientBtn} accessibilityRole="button" accessibilityLabel="Close">
                    <X size={12} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalFieldLabel}>Recipient Name</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientName}
                    onChangeText={setSendRecipientName}
                    placeholder="Enter name or pick from contacts"
                    placeholderTextColor={themeColors.textMuted}
                  />
                  <Text style={styles.modalFieldLabel}>Email</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={sendRecipientEmail}
                    onChangeText={setSendRecipientEmail}
                    placeholder="email@example.com"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    // A sample job sends only to its owner: the address is his, read-only.
                    editable={!sendIsSample}
                  />
                  {sendIsSample && (
                    <Text style={styles.modalFieldLabel} testID="dfr-sample-send-note">
                      Sample job {'—'} this goes to you, not a client.
                    </Text>
                  )}
                  {contacts.length > 0 && !sendIsSample && (
                    <TouchableOpacity
                      style={styles.pickContactBtn}
                      onPress={() => { setShowSendRecipient(false); setTimeout(() => setShowContactPicker(true), 350); }}
                      activeOpacity={0.7}
                    >
                      <BookUser size={14} color={themeColors.accent} strokeWidth={1.75} />
                      <Text style={styles.pickContactText}>Pick from Contacts</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Save-to-project-files toggle — Procore-style "drop a
                  copy in the project drive" path. On by default on the phone
                  so a GC who hits Send always has a project-side copy
                  regardless of whether the email lands. Tapping the whole
                  row flips the toggle (bigger touch target than the switch
                  alone). #27: on web there are no PDF bytes to upload, so the
                  row is disabled with the reason, and Print is the copy. */}
              {dfrProjectFilesAvailable(Platform.OS) ? (
                <TouchableOpacity
                  style={styles.toggleRow}
                  onPress={() => setSaveToProjectFiles(v => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: saveToProjectFiles }}
                >
                  <View style={styles.toggleIconWrap}>
                    <FolderOpen size={16} color={themeColors.accent} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.toggleTitle}>Save copy to project files</Text>
                    <Text style={styles.toggleSub}>
                      Drops a PDF into {project?.name ?? 'this project'}&apos;s shared drive at
                      {' '}<Text style={{ fontWeight: '600' as const }}>Daily Reports / {(calendarDayOf(reportDate) ?? todayCalendarDay())}.pdf</Text>
                    </Text>
                  </View>
                  <View style={[styles.toggleSwitch, saveToProjectFiles && styles.toggleSwitchOn]}>
                    <View style={[styles.toggleKnob, saveToProjectFiles && styles.toggleKnobOn]} />
                  </View>
                </TouchableOpacity>
              ) : (
                <View
                  style={[styles.toggleRow, { opacity: 0.85 }]}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: false, disabled: true }}
                  testID="dfr-project-files-web-disabled"
                >
                  <View style={styles.toggleIconWrap}>
                    <FolderOpen size={16} color={themeColors.textMuted} strokeWidth={1.75} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.toggleTitle, { color: themeColors.textMuted }]}>Save copy to project files</Text>
                    <Text style={styles.toggleSub}>{DFR_FILES_NEEDS_APP}</Text>
                    <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                      <Button label="Print a copy" variant="secondary" size="sm" onPress={handlePrintCopy} testID="dfr-print-copy" />
                    </View>
                  </View>
                  <View style={styles.toggleSwitch}>
                    <View style={styles.toggleKnob} />
                  </View>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                <TouchableOpacity style={styles.saveDraftBtn} onPress={() => setShowSendRecipient(false)} activeOpacity={0.7}>
                  <Text style={styles.saveDraftBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.sendBtn} onPress={handleConfirmSend} activeOpacity={0.7}>
                  <Send size={16} color={"#FFFFFF"} strokeWidth={1.75} />
                  <Text style={styles.sendBtnText}>
                    {sendRecipientEmail.trim() ? 'Send' : (saveToProjectFiles && dfrProjectFilesAvailable(Platform.OS) ? 'Save' : 'Send')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Date picker — opened from the top-bar title row. Defaults to
          today, blocks future dates, lets the GC backfill any day in
          the past 5 years. */}
      <DatePickerModal
        visible={showDatePicker}
        value={reportDate}
        onClose={() => setShowDatePicker(false)}
        onChange={setReportDate}
        title="Report date"
      />

      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => { setShowContactPicker(false); setTimeout(() => setShowSendRecipient(true), 350); }}
        contacts={contacts}
        title="Select Recipient"
        onSelect={(contact) => {
          const name = `${contact.firstName} ${contact.lastName}`.trim() || contact.companyName;
          setSendRecipientName(name);
          setSendRecipientEmail(contact.email);
          setContactPicked(true);
          setShowContactPicker(false);
          setTimeout(() => setShowSendRecipient(true), 350);
        }}
      />

      {/* Task picker for Work Progress chips. Lists every task in the
          project schedule that isn't already on the DFR; tapping one
          adds a chip seeded at the task's current progress. The user
          can adjust pct via a quick-step row (0/25/50/75/100). */}
      <Modal visible={showTaskPicker} transparent animationType={fTask.animationType} onRequestClose={() => setShowTaskPicker(false)}>
        <View style={[styles.modalOverlay, fTask.overlay]}>
          <View style={[styles.modalCard, fTask.card]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Work Progress</Text>
              <TouchableOpacity onPress={() => setShowTaskPicker(false)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHelper}>Pick a task and the percent complete you observed today.</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator={false}>
              {(project?.schedule?.tasks ?? [])
                .filter(t => !workProgress.some(p => p.taskId === t.id))
                .map(t => {
                  const phaseColor = PHASE_COLORS[t.phase] ?? PHASE_COLORS.General;
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={styles.pickerRow}
                      onPress={() => {
                        const fresh: DFRWorkProgress = {
                          taskId: t.id,
                          taskName: t.title || 'Untitled',
                          phase: t.phase,
                          pct: t.progress ?? 0,
                        };
                        setWorkProgress(prev => [...prev, fresh]);
                        setShowTaskPicker(false);
                      }}
                      activeOpacity={0.85}
                    >
                      <View style={[styles.pickerDot, { backgroundColor: phaseColor }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.pickerTitle} numberOfLines={1}>{t.title || 'Untitled'}</Text>
                        <Text style={styles.pickerMeta}>{t.phase} · {(t.progress ?? 0)}%</Text>
                      </View>
                      <Plus size={16} color={themeColors.accent} strokeWidth={1.75} />
                    </TouchableOpacity>
                  );
                })}
              {(project?.schedule?.tasks ?? []).filter(t => !workProgress.some(p => p.taskId === t.id)).length === 0 && (
                <Text style={styles.emptyText}>Every scheduled task is already logged.</Text>
              )}
            </ScrollView>
            {workProgress.length > 0 && (
              <>
                <Text style={[styles.modalHelper, { marginTop: 14 }]}>Adjust an existing chip&apos;s percent:</Text>
                <ScrollView style={{ maxHeight: 200 }} contentContainerStyle={{ gap: 6 }}>
                  {workProgress.map(p => {
                    const phaseColor = PHASE_COLORS[p.phase] ?? PHASE_COLORS.General;
                    return (
                      <View key={p.taskId} style={styles.pickerRow}>
                        <View style={[styles.pickerDot, { backgroundColor: phaseColor }]} />
                        <Text style={[styles.pickerTitle, { flex: 1 }]} numberOfLines={1}>{p.taskName}</Text>
                        <View style={styles.pctStepperRow}>
                          {[0, 25, 50, 75, 100].map(v => (
                            <TouchableOpacity
                              key={v}
                              onPress={() => setWorkProgress(prev => prev.map(x => x.taskId === p.taskId ? { ...x, pct: v } : x))}
                              style={[styles.pctStepBtn, p.pct === v && { backgroundColor: phaseColor, borderColor: phaseColor }]}
                            >
                              <Text style={[styles.pctStepBtnText, p.pct === v && { color: '#fff' }]}>{v}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </>
            )}
            <TouchableOpacity style={styles.modalDoneBtn} onPress={() => setShowTaskPicker(false)} activeOpacity={0.85}>
              <Text style={styles.modalDoneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={showManpowerModal} transparent animationType={fCrew.animationType} onRequestClose={() => setShowManpowerModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={[styles.modalOverlay, fCrew.overlay]}>
            <View style={[styles.modalCard, { paddingBottom: insets.bottom + 16 }, fCrew.card]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{mpEditingId ? 'Edit Crew' : 'Add Manpower'}</Text>
                <TouchableOpacity onPress={() => setShowManpowerModal(false)} accessibilityRole="button" accessibilityLabel="Close">
                  <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalFieldLabel}>Trade</Text>
              <TextInput
                style={styles.modalInput}
                value={mpTrade}
                onChangeText={setMpTrade}
                placeholder="e.g. Electrician, Plumber..."
                placeholderTextColor={themeColors.textMuted}
              />
              {/* Free text still wins — these are the spellings this job has
                  already used. Tapping one keeps "Framing" from becoming
                  "Framer" tomorrow, which is what fragments the same sub
                  across the presence history and the labor samples. */}
              {tradeSuggestions.length > 0 && (
                <View style={styles.mpChipRow}>
                  {tradeSuggestions.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.mpChip, mpTrade.trim().toLowerCase() === s.toLowerCase() && styles.mpChipActive]}
                      onPress={() => setMpTrade(s)}
                      activeOpacity={0.7}
                      testID={`mp-trade-suggest-${s}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Trade: ${s}`}
                      accessibilityState={{ selected: mpTrade.trim().toLowerCase() === s.toLowerCase() }}
                    >
                      <Text style={styles.mpChipText} numberOfLines={1}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={styles.modalFieldLabel}>Company / Sub</Text>
              <TextInput
                style={styles.modalInput}
                value={mpCompany}
                onChangeText={setMpCompany}
                placeholder="Company name (optional)"
                placeholderTextColor={themeColors.textMuted}
              />
              {companySuggestions.length > 0 && (
                <View style={styles.mpChipRow}>
                  {companySuggestions.map(s => (
                    <TouchableOpacity
                      key={s}
                      style={[styles.mpChip, mpCompany.trim().toLowerCase() === s.toLowerCase() && styles.mpChipActive]}
                      onPress={() => setMpCompany(s)}
                      activeOpacity={0.7}
                      testID={`mp-company-suggest-${s}`}
                      accessibilityRole="button"
                      accessibilityLabel={`Company: ${s}`}
                      accessibilityState={{ selected: mpCompany.trim().toLowerCase() === s.toLowerCase() }}
                    >
                      <Text style={styles.mpChipText} numberOfLines={1}>{s}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={styles.modalRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Headcount</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHeadcount}
                    onChangeText={setMpHeadcount}
                    placeholder="1"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalFieldLabel}>Hours Worked</Text>
                  <TextInput
                    style={styles.modalInput}
                    value={mpHours}
                    onChangeText={setMpHours}
                    placeholder="8"
                    placeholderTextColor={themeColors.textMuted}
                    keyboardType="numeric"
                  />
                </View>
              </View>
              <TouchableOpacity
                style={styles.modalAddBtn}
                onPress={handleSaveManpower}
                activeOpacity={0.85}
                testID="mp-save-btn"
                accessibilityRole="button"
                accessibilityLabel={mpEditingId ? 'Save changes' : 'Add entry'}
              >
                <Text style={styles.modalAddBtnText}>{mpEditingId ? 'Save changes' : 'Add Entry'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Delay-row task picker */}
      <Modal visible={delayTaskPickerIdx !== null} transparent animationType={fDelay.animationType} onRequestClose={() => setDelayTaskPickerIdx(null)}>
        <Pressable style={[dcStyles.modalOverlay, fDelay.overlay]} onPress={() => setDelayTaskPickerIdx(null)}>
          <Pressable style={[dcStyles.taskPickerCard, fDelay.card]} onPress={() => undefined}>
            <View style={dcStyles.taskPickerHeader}>
              <Text style={dcStyles.taskPickerTitle}>Which task slipped?</Text>
              <TouchableOpacity onPress={() => setDelayTaskPickerIdx(null)} accessibilityRole="button" accessibilityLabel="Close">
                <X size={20} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 360 }}>
              {scheduleTasks.map(t => {
                const active = delayTaskPickerIdx !== null && delayRows?.[delayTaskPickerIdx]?.taskId === t.id;
                return (
                  <TouchableOpacity
                    key={t.id}
                    style={[dcStyles.taskOption, active && dcStyles.taskOptionActive]}
                    onPress={() => {
                      setDelayRows(rs => (rs ?? []).map((r, j) => j === delayTaskPickerIdx ? { ...r, taskId: t.id } : r));
                      setDelayTaskPickerIdx(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={t.title}
                    accessibilityState={{ selected: active }}
                  >
                    {active && <CheckCircle2 size={14} color={themeColors.accent} strokeWidth={1.75} />}
                    <View style={{ flex: 1 }}>
                      <Text style={[dcStyles.taskOptionText, active && dcStyles.taskOptionTextActive]} numberOfLines={1}>{t.title}</Text>
                      <Text style={dcStyles.taskOptionMeta}>{t.phase} · {t.durationDays}d · day {t.startDay}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
      <UpgradeSheet
        visible={!!upgradeLimit}
        limit={upgradeLimit}
        featureLabel="Voice Capture"
        onClose={() => setUpgradeLimit(null)}
      />
      {/* Tutorial blocker: these modals have no tutorial layer and draw ABOVE
          the root one on iOS, so while any is up the coach draws nothing
          rather than a dim and a card behind the sheet. Zero-size, inert. */}
      {(showSendRecipient || showTaskPicker || showManpowerModal || delayTaskPickerIdx !== null || showDatePicker || showContactPicker || !!upgradeLimit)
        ? <TutorialTarget id="dfr.modalUp" />
        : null}
    </View>
  );
}

function VoiceRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const voiceStyles = useThemedStyles(makeVoiceStyles);
  return (
    <View style={voiceStyles.row}>
      <Text style={voiceStyles.rowLabel}>{label}</Text>
      <Text style={[voiceStyles.rowValue, valueColor ? { color: valueColor } : null]} numberOfLines={3}>{value}</Text>
    </View>
  );
}

// Single role tile for the Workforce rollup — colored icon chip on the left,
// role label + count stacked on the right. Stays visually consistent across
// the 4 buckets so the eye reads them as a group.
function RoleTile(props: {
  icon: React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;
  label: string;
  count: number;
  color: string;
}) {
  const { icon: Icon, label, count, color } = props;
  const dim = count === 0;
  const roleTileStyles = useThemedStyles(makeRoleTileStyles);
  return (
    <View style={[roleTileStyles.tile, dim && { opacity: 0.55 }]}>
      <View style={[roleTileStyles.iconChip, { backgroundColor: color + '1A' }]}>
        <Icon size={16} color={color} strokeWidth={2} />
      </View>
      <Text style={roleTileStyles.label} numberOfLines={1} adjustsFontSizeToFit>{label}</Text>
      <Text style={roleTileStyles.count}>{count}</Text>
    </View>
  );
}

const makeRoleTileStyles = (themeColors: ThemeColors) => StyleSheet.create({
  // Vertical-stacked tile so the role label has room to breathe — narrow
  // 4-up grid on phone width truncates a horizontal layout to "Sup...".
  tile: {
    alignItems: 'flex-start' as const,
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
    flex: 1,
    minWidth: 0,
  },
  iconChip: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 4,
  },
  label: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    fontWeight: '600' as const,
  },
  count: {
    fontSize: Type.headline.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: -0.3,
  },
});

const makeVoiceStyles = (themeColors: ThemeColors) => StyleSheet.create({
  previewCard: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: themeColors.accent + '0D',
    borderWidth: 1, borderColor: themeColors.accent + '30',
    borderRadius: Tokens.radius.card, padding: 14, gap: 8,
  },
  previewHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  previewTitle: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '800', color: themeColors.accent, letterSpacing: -0.2 },
  previewHelper: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15 },
  previewList: { gap: 6, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  rowLabel: { width: 90, fontSize: Type.caption2.fontSize, fontWeight: '800', color: themeColors.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingTop: 1 },
  rowValue: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
  // The tutorial's sample-note chip: a plain surface card (the accent is never
  // the background), under the mic, inside the same spotlight hole.
  sampleChip: {
    marginBottom: 12, padding: 12, gap: 4,
    backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.md,
    borderWidth: 1, borderColor: themeColors.line,
  },
  sampleChipLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: themeColors.textSecondary, letterSpacing: 0.3 },
  sampleChipQuote: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 18 },
});

const makeLeakStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, marginLeft: 'auto' },
  badgeClean: { backgroundColor: 'rgba(30,142,74,0.12)' },
  badgeFlags: { backgroundColor: 'rgba(233,168,38,0.16)' },
  badgeText: { fontSize: 9, fontWeight: '800' as const, letterSpacing: 0.6 },
  badgeTextClean: { color: themeColors.success },
  badgeTextFlags: { color: Colors.warningLabel },
  scanBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  scanBtnDisabled: { opacity: 0.7 },
  scanBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  cleanRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 12 },
  cleanText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  resultBlock: { marginTop: 12, gap: 10 },
  itemRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  itemDesc: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.text },
  itemQuote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontStyle: 'italic' as const, marginTop: 2 },
  itemMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 2 },
  draftCoBlockedNote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: 4, lineHeight: 17 },
  draftCoBtn: { marginTop: 4, paddingVertical: 11, borderRadius: 11, alignItems: 'center' as const, backgroundColor: themeColors.accentFill },
  draftCoBtnDisabled: { backgroundColor: themeColors.textMuted, opacity: 0.6 },
  draftCoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  draftCoBtnTextDisabled: { color: '#FFFFFF' },
  staleHint: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, marginBottom: 4 },
  itemRowStale: { opacity: 0.5 },
  itemDescStale: { color: themeColors.textMuted },
  historyLink: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    paddingVertical: 8, marginBottom: 6,
  },
  historyLinkText: { flex: 1, minWidth: 0, fontSize: Type.footnote.fontSize, color: themeColors.textSecondary },
});

const makeDcStyles = (themeColors: ThemeColors) => StyleSheet.create({
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  appliedPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Tokens.radius.full, marginLeft: 'auto' as const, backgroundColor: 'rgba(30,142,74,0.12)' },
  appliedPillText: { fontSize: 9, fontWeight: '800' as const, color: themeColors.success, letterSpacing: 0.6 },
  aiBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  aiBtnDisabled: { opacity: 0.7 },
  aiBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  cleanRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 12 },
  cleanText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  rowsBlock: { marginTop: 12, gap: 12 },
  hitRow: { gap: 8 },
  hitRowApplied: { opacity: 0.55 },
  hitQuoteRow: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8 },
  hitQuote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, fontStyle: 'italic' as const },
  hitDismissBtn: { padding: 2 },
  hitControls: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  appliedNotice: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 2 },
  appliedNoticeText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  reArmBtn: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: Tokens.radius.md,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  reArmBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  staleNoticeText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const },
  taskPickBtn: {
    flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    borderRadius: Tokens.radius.md, paddingHorizontal: 10, paddingVertical: 9,
  },
  taskPickText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text },
  stepperRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  stepBtn: {
    width: 30, height: 30, borderRadius: Tokens.radius.md, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  stepValue: { minWidth: 34, textAlign: 'center' as const, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  previewBtn: { marginTop: 2, paddingVertical: 12, borderRadius: 11, alignItems: 'center' as const, backgroundColor: themeColors.accentFill },
  previewBtnOff: { opacity: 0.4 },
  previewBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: '#FFFFFF' },
  diffWrap: { marginTop: 12 },
  modalOverlay: { flex: 1, backgroundColor: '#00000060', justifyContent: 'center' as const, alignItems: 'center' as const, padding: 24 },
  taskPickerCard: { backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, width: '100%' as const, overflow: 'hidden' as const },
  taskPickerHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, padding: 16, borderBottomWidth: 1, borderBottomColor: themeColors.line },
  taskPickerTitle: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: themeColors.text },
  taskOption: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, padding: 12, borderBottomWidth: 1, borderBottomColor: themeColors.line + '80' },
  taskOptionActive: { backgroundColor: themeColors.accent + '10' },
  taskOptionText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '500' as const, color: themeColors.text },
  taskOptionTextActive: { fontWeight: '700' as const, color: themeColors.accent },
  taskOptionMeta: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, marginTop: 1 },
});

const makeHsStyles = (themeColors: ThemeColors) => StyleSheet.create({
  publishBtnDisabled: { opacity: 0.55 },
  blockedNote: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: 6, lineHeight: 17 },
  staleNote: { fontSize: Type.caption1.fontSize, color: themeColors.warningLabel, marginTop: 8, lineHeight: 17 },
  helperText: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginBottom: 10, lineHeight: 17 },
  publishedPill: {
    backgroundColor: 'rgba(30,142,74,0.12)', paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: Tokens.radius.full, marginLeft: 'auto',
  },
  publishedPillText: { fontSize: 9, fontWeight: '800', color: themeColors.success, letterSpacing: 0.6 },
  aiBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.accent + '0F', borderWidth: 1, borderColor: themeColors.accent + '40',
  },
  aiBtnDisabled: { opacity: 0.7 },
  aiBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.accent },
  highlightsBlock: { marginTop: 10, gap: 4 },
  highlightsLabel: { fontSize: 10, fontWeight: '800', color: themeColors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 },
  highlightRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 2 },
  highlightDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: themeColors.accent, marginTop: 7 },
  highlightText: { flex: 1, fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  lookingAhead: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, marginTop: 8, fontStyle: 'italic' },
  publishBtn: {
    marginTop: 12, paddingVertical: 11, borderRadius: 11,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
    alignItems: 'center',
  },
  publishBtnPublished: { backgroundColor: 'rgba(30,142,74,0.10)', borderColor: '#1E8E4A' },
  publishBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: themeColors.text },
  publishBtnTextPublished: { color: themeColors.success },
});

const makeStyles = (themeColors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: themeColors.bg },
  openGateBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Tokens.spacing.sm, padding: Tokens.spacing.lg },
  openGateTitle: { ...Type.headline, color: themeColors.text, textAlign: 'center' },
  openGateText: { ...Type.subhead, color: themeColors.textSecondary, textAlign: 'center', maxWidth: 420 },
  // Long form + photo grid: widen for desktop but keep a cap so inputs and
  // labels don't drift apart across a 27" monitor.
  contentDesktop: { width: '100%', maxWidth: Layout.page.form, alignSelf: 'center' as const },
  topBarDesktop: { width: '100%', maxWidth: Layout.page.form, alignSelf: 'center' as const },
  center: { alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: Type.subheadline.fontSize, color: themeColors.textSecondary, marginBottom: 16 },

  // Custom top bar — replaces the default Stack header so Save Draft +
  // Submit can sit at the top right (matches the mock).
  topBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10,
    backgroundColor: themeColors.bg,
    borderBottomWidth: 1,
    borderBottomColor: themeColors.line,
  },
  topBarBack: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: themeColors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1, borderColor: themeColors.line,
  },
  topBarTitleCol: {
    flex: 1,
    minWidth: 0,
  },
  topBarTitle: {
    fontSize: Type.title3.fontSize,
    fontWeight: '800' as const,
    color: themeColors.text,
    letterSpacing: -0.4,
  },
  topBarDate: {
    fontSize: Type.caption1.fontSize,
    color: themeColors.textMuted,
    marginTop: 1,
  },
  topBarActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  topBarDraftBtn: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  topBarDraftText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.accent,
  },
  topBarSubmitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.accentFill,
  },
  topBarSubmitText: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '800' as const,
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  backBtn: { backgroundColor: themeColors.accentFill, paddingHorizontal: 24, paddingVertical: 12, borderRadius: Tokens.radius.md },
  backBtnText: { color: "#FFFFFF", fontSize: Type.subhead.fontSize, fontWeight: '600' as const },
  heroCard: { backgroundColor: themeColors.accentFill, marginHorizontal: 20, marginTop: 12, borderRadius: Tokens.radius.panel, padding: 20, gap: 4 },
  heroLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroProject: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  heroDate: { fontSize: Type.bodyCompact.fontSize, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  heroDayRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  heroDayText: {
    fontSize: Type.caption1.fontSize,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600' as const,
  },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: Tokens.radius.sm, marginTop: 6 },
  statusText: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const },
  sectionCard: { marginHorizontal: 20, marginTop: 16, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.panel, padding: 18, borderWidth: 1, borderColor: themeColors.line },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  // "Nothing happened today" one-tap filing. Deliberately plain — this is
  // the boring path and it should look like the boring path.
  noWorkCard: {
    marginHorizontal: 20, marginTop: 4, padding: 16,
    backgroundColor: themeColors.surfaceAlt, borderRadius: Tokens.radius.panel,
    borderWidth: 1, borderColor: themeColors.line, gap: 8,
  },
  noWorkTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700' as const, color: themeColors.text },
  noWorkBody: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, lineHeight: 17 },
  noWorkChips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 2 },
  noWorkChip: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999,
    backgroundColor: themeColors.surface, borderWidth: 1, borderColor: themeColors.line,
  },
  noWorkChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.text },
  sectionTotal: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontWeight: '600' as const },
  roleTileGrid: {
    flexDirection: 'row' as const,
    gap: 8,
    marginBottom: 12,
  },
  workforceTotalLine: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    marginBottom: 8,
  },
  // fg === bg: the "Auto-fetch" weather button was `info` text on an `info`
  // fill — a solid blue rectangle. Soft fill + saturated label, as elsewhere.
  refreshBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.info + '1F' },
  refreshBtnText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.info },
  refreshBtnDisabled: { backgroundColor: themeColors.surfaceAlt },
  refreshBtnTextDisabled: { color: themeColors.textMuted },
  // DFR-WEATHER-DAY — the reason a backfilled report will not fill itself in,
  // and the provenance of whatever is in the block.
  weatherNotice: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17, marginBottom: 10 },
  weatherProvenance: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 10 },
  weatherGrid: { gap: 10 },
  weatherGridDesktop: { flexDirection: 'row', flexWrap: 'wrap', columnGap: Layout.groupGap },
  weatherItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weatherItemDesktop: { flexGrow: 0 },
  // One row of Temperature / Conditions / Wind (~620 px) instead of three
  // 1,000 px inputs. The longhands beat weatherInput's flex:1 (basis 0%).
  weatherInputXsDesktop: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: Layout.field.xs },
  weatherInputSmDesktop: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: Layout.field.sm },
  // Single-line inputs on desktop web: no one-line field fills the 760 column.
  inputMdDesktop: { flexGrow: 0, flexShrink: 1, flexBasis: 'auto', width: Layout.field.md },
  inputXsDesktop: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto', width: Layout.field.xs },
  weatherInput: { flex: 1, minHeight: 38, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  weatherValue: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  addSmallBtn: { width: 32, height: 32, borderRadius: Tokens.radius.panel, backgroundColor: themeColors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: Type.footnote.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const },
  mpRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: themeColors.line, gap: 10 },
  mpInfo: { flex: 1, gap: 2 },
  mpTrade: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  mpMeta: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  mpSeedNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, fontStyle: 'italic' as const, marginTop: 8, lineHeight: 17 },
  mpClockGap: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10, marginTop: 8 },
  mpClockGapText: { flex: 1, fontSize: Type.caption1.fontSize, color: themeColors.warningLabel, lineHeight: 17 },
  mpClockGapAdd: { fontSize: Type.caption1.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  mpStepperRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4 },
  // 30pt touch targets with hitSlop — the same size the delay steppers use,
  // sized for a gloved thumb rather than a cursor.
  mpStepBtn: {
    width: 30, height: 30, borderRadius: Tokens.radius.md, alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.bg, borderWidth: 1, borderColor: themeColors.line,
  },
  mpStepValue: { minWidth: 26, textAlign: 'center' as const, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.text },
  mpChipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 6, marginTop: 8 },
  mpChip: {
    maxWidth: 180, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line,
  },
  mpChipActive: { backgroundColor: themeColors.accent + '15', borderColor: themeColors.accent + '55' },
  mpChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.text },
  textArea: { minHeight: 80, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, paddingTop: 12, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  textInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 14, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  readOnlyText: { fontSize: Type.bodyCompact.fontSize, color: themeColors.text, lineHeight: 20 },
  delayEventBtn: {
    flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 6,
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 11, borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.accentSoft,
  },
  delayEventBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  delayEventHint: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary, marginTop: 6, lineHeight: 16 },
  incidentToggle: { flexDirection: 'row', alignItems: 'center' as const, gap: 10, paddingVertical: 12, paddingHorizontal: 12, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, borderWidth: 1, borderColor: themeColors.line },
  incidentToggleActive: { backgroundColor: themeColors.danger, borderColor: themeColors.danger + '40' },
  incidentToggleDot: { width: 16, height: 16, borderRadius: Tokens.radius.sm, borderWidth: 2, borderColor: themeColors.line },
  incidentToggleDotActive: { backgroundColor: themeColors.danger, borderColor: themeColors.danger },
  incidentToggleText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  incidentBlock: { marginTop: 10, gap: 6 },
  // DFR-OSHA-BRIDGE — the determination inputs and the computed verdict.
  oshaDaysRow: { flexDirection: 'row' as const, gap: 10, marginTop: 2 },
  oshaDaysItem: { flex: 1 },
  oshaVerdict: {
    flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 8,
    marginTop: 12, padding: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1, borderColor: themeColors.line,
  },
  oshaVerdictHot: { backgroundColor: themeColors.dangerSoft, borderColor: themeColors.danger + '40' },
  oshaVerdictText: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.textSecondary },
  oshaVerdictTextHot: { color: themeColors.danger },
  oshaVerdictSub: { fontSize: Type.caption2.fontSize, color: themeColors.textMuted, lineHeight: 15, marginTop: 3 },
  incidentRegisterNote: { fontSize: Type.caption1.fontSize, color: themeColors.textMuted, lineHeight: 17, marginTop: 10 },
  sameDayBanner: { ...cardSurface(themeColors, { radius: 'md', pad: 12 }), marginHorizontal: 16, marginBottom: 8, gap: 6 },
  sameDayText: { fontSize: Type.footnote.fontSize, color: themeColors.text, lineHeight: 19 },
  sameDayLink: { fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  incidentRefileText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent, marginTop: 6 },
  incidentPhotoRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginTop: 4 },
  incidentPhotoThumb: { width: 56, height: 56, borderRadius: Tokens.radius.sm, overflow: 'hidden' as const, borderWidth: 2, borderColor: 'transparent' },
  incidentPhotoThumbOn: { borderColor: themeColors.accent },
  incidentPhotoImg: { width: '100%' as const, height: '100%' as const },
  incidentPhotoCheck: { position: 'absolute' as const, top: 2, right: 2, backgroundColor: themeColors.surface, borderRadius: Tokens.radius.full },
  incidentRegisterChip: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
    marginTop: 12, paddingVertical: 10, paddingHorizontal: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1, borderColor: themeColors.accent + '22',
  },
  incidentRegisterChipText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  incidentLabel: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 8 },
  severityRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 6 },
  severityChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Tokens.radius.md, backgroundColor: themeColors.line },
  severityChipActive: { backgroundColor: themeColors.danger },
  severityChipText: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary },
  severityChipTextActive: { color: '#FFF' },
  checkboxRow: { flexDirection: 'row', flexWrap: 'wrap' as const, gap: 12, marginTop: 8 },
  checkboxItem: { flexDirection: 'row', alignItems: 'center' as const, gap: 6 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 2, borderColor: themeColors.line },
  checkboxActive: { backgroundColor: themeColors.danger, borderColor: themeColors.danger },
  checkboxLabel: { fontSize: Type.footnote.fontSize, color: themeColors.text, fontWeight: '500' as const },
  addMaterialRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  materialInput: { flex: 1, minHeight: 40, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  addMaterialBtn: { width: 40, height: 40, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '15', alignItems: 'center', justifyContent: 'center' },
  materialRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  materialDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: themeColors.accent },
  materialText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: themeColors.text },
  photoActions: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: Tokens.radius.md, backgroundColor: themeColors.accent + '10', borderWidth: 1, borderColor: themeColors.accent + '20' },
  photoBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  photoCard: { width: 80, height: 80, borderRadius: Tokens.radius.md, backgroundColor: themeColors.surfaceAlt, overflow: 'hidden' as const, position: 'relative' as const },
  photoImage: { width: '100%' as const, height: '100%' as const },
  photoTimestampOverlay: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, backgroundColor: Colors.overlay, paddingHorizontal: 4, paddingVertical: 2 },
  photoTimestampOverlayText: { fontSize: 9, color: '#FFFFFF', fontWeight: '600' as const },
  photoRemoveBtn: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: Tokens.radius.md, backgroundColor: themeColors.danger, alignItems: 'center', justifyContent: 'center' },
  toggleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: themeColors.surfaceAlt,
    borderRadius: Tokens.radius.md,
    marginTop: 12,
  },
  toggleIconWrap: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center' as const, justifyContent: 'center' as const,
    backgroundColor: themeColors.accent + '14',
  },
  toggleTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  toggleSub: { fontSize: Type.caption2.fontSize, color: themeColors.textSecondary, marginTop: 2 },
  toggleSwitch: {
    width: 38, height: 22, borderRadius: 11,
    backgroundColor: themeColors.line,
    padding: 2,
    justifyContent: 'center' as const,
  },
  toggleSwitchOn: { backgroundColor: themeColors.accent },
  toggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: themeColors.surface },
  toggleKnobOn: { transform: [{ translateX: 16 }] },
  saveDraftBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  saveDraftBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.text },
  saveProjectBtn: { flex: 1, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accent + '15', borderWidth: 1.5, borderColor: themeColors.accent, alignItems: 'center', justifyContent: 'center' },
  saveProjectBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: themeColors.accent },
  sendBtn: { flex: 1.2, minHeight: 48, borderRadius: Tokens.radius.lg, backgroundColor: themeColors.accentFill, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  sendBtnText: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },
  selectedRecipientCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: themeColors.accent + '10', borderRadius: Tokens.radius.card, paddingHorizontal: 12, paddingVertical: 10, gap: 10, borderWidth: 1, borderColor: themeColors.accent + '25' },
  selectedRecipientName: { fontSize: Type.bodyCompact.fontSize, fontWeight: '600' as const, color: themeColors.text },
  selectedRecipientEmail: { fontSize: Type.caption1.fontSize, color: themeColors.textSecondary },
  clearRecipientBtn: { width: 24, height: 24, borderRadius: Tokens.radius.card, backgroundColor: themeColors.line, alignItems: 'center', justifyContent: 'center' },
  pickContactBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: Tokens.radius.sm, backgroundColor: themeColors.accent + '10' },
  pickContactText: { fontSize: Type.footnote.fontSize, fontWeight: '600' as const, color: themeColors.accent },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: 'flex-end' },
  modalCard: { backgroundColor: themeColors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, gap: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  modalTitle: { fontSize: Type.title3.fontSize, fontWeight: '700' as const, color: themeColors.text },
  modalFieldLabel: { fontSize: Type.caption1.fontSize, fontWeight: '600' as const, color: themeColors.textSecondary, marginTop: 4 },
  modalInput: { minHeight: 44, borderRadius: Tokens.radius.card, backgroundColor: themeColors.surfaceAlt, paddingHorizontal: 12, fontSize: Type.subhead.fontSize, color: themeColors.text },
  modalRow: { flexDirection: 'row', gap: 10 },
  modalAddBtn: { backgroundColor: themeColors.accentFill, borderRadius: Tokens.radius.lg, paddingVertical: 14, alignItems: 'center', marginTop: 8 },
  modalAddBtnText: { fontSize: Type.callout.fontSize, fontWeight: '700' as const, color: "#FFFFFF" },

  modalHelper: {
    fontSize: Type.footnote.fontSize,
    color: themeColors.textMuted,
    marginBottom: 4,
  },
  modalDoneBtn: {
    backgroundColor: themeColors.accentFill,
    borderRadius: Tokens.radius.lg,
    paddingVertical: 14,
    alignItems: 'center' as const,
    marginTop: 12,
  },
  modalDoneBtnText: {
    fontSize: Type.callout.fontSize,
    fontWeight: '700' as const,
    color: "#FFFFFF",
  },
  pickerRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Tokens.radius.card,
    backgroundColor: themeColors.surfaceAlt,
  },
  pickerDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  pickerTitle: {
    fontSize: Type.bodyCompact.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
  },
  pickerMeta: {
    fontSize: Type.caption2.fontSize,
    color: themeColors.textMuted,
    marginTop: 2,
  },
  pctStepperRow: {
    flexDirection: 'row' as const,
    gap: 4,
  },
  pctStepBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Tokens.radius.sm,
    borderWidth: 1,
    borderColor: themeColors.line,
    backgroundColor: themeColors.surface,
  },
  pctStepBtnText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.text,
  },

  // Work Progress chips on the DFR section card.
  progressChipGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  progressChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: Tokens.radius.full,
    backgroundColor: themeColors.surfaceAlt,
    borderWidth: 1,
    borderColor: themeColors.line,
    maxWidth: '100%',
  },
  progressChipDot: {
    width: 8, height: 8, borderRadius: 4,
  },
  progressChipName: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.text,
    maxWidth: 140,
  },
  progressChipPctPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: Tokens.radius.full,
  },
  progressChipPctText: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },

  // Toolbar between the hero card and the section forms — holds the
  // progress pill and the carry-forward "Copy from <last>" affordance.
  dfrToolbar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    paddingHorizontal: 16,
    // Sits cleanly BELOW the hero card. The hero card has no bottom
    // margin, so this positive top margin is the only gap between them.
    // (Was -6, which pulled the progress pill / "Copy from…" button up
    // over the card's rounded bottom corners and the Saved badge.)
    marginTop: 12,
    marginBottom: 12,
  },
  progressPill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: themeColors.line,
    borderWidth: 1,
    borderColor: themeColors.line,
  },
  progressPillReady: {
    backgroundColor: themeColors.successSoft,
    borderColor: themeColors.success + '40',
  },
  progressPillText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '600' as const,
    color: themeColors.textSecondary,
    letterSpacing: 0.1,
  },
  carryBtn: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: themeColors.accent + '12',
    borderWidth: 1,
    borderColor: themeColors.accent + '40',
  },
  carryBtnText: {
    fontSize: Type.caption1.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
    letterSpacing: 0.1,
  },
  carriedBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: themeColors.accent + '14',
  },
  carriedBadgeText: {
    fontSize: Type.caption2.fontSize,
    fontWeight: '700' as const,
    color: themeColors.accent,
    letterSpacing: 0.2,
  },
});
