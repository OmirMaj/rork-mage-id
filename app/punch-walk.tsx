// app/punch-walk.tsx — Walk Mode for punch-list capture.
//
// The user flow this is optimized for: a super walking the job with a
// clipboard app open, dictating "hallway 2, outlet cover missing" over
// and over. Traditional punch-list UIs require 6 taps per item — picking
// a location, a sub, a priority, writing a description. In walk mode we
// cut that to: press → talk → release → saved.
//
// Mechanics:
//   • Voice-first, but text + camera fallbacks for noisy jobsites.
//   • Trade auto-routing via `inferTradeFromText` — no manual picker
//     unless the GC wants to override. One tap on the trade chip cycles
//     through alternatives.
//   • Location is free-text — we remember the last entry and stick it
//     in the next item, because supers say "hall 2, hall 2, hall 2" as
//     they walk the corridor. ONE TAP to change it: the rooms this
//     project already has (utils/punchLocations) plus the rooms Plan
//     Intelligence read off the drawings (hooks/usePlanRooms) render as
//     chips above the input. Typing "Unit 4B — master bath" with gloves
//     on was the slowest thing in the flow; the input stays as the
//     escape hatch for a room that is on neither list.
//   • The location banner says HOW the current location got there. On a
//     finishing walk the worst outcome is not a missing field, it is
//     twenty items filed to the corridor he left ten minutes ago — so a
//     location that merely carried forward is labelled as carried, and
//     the count of items filed there THIS walk sits next to it.
//   • Everything is captured locally first; `addPunchItem` is called on
//     every save so the offline queue can flush when we're back online.
//   • Every item is filed to ONE of two lists, chosen on the card above the
//     location: the formal PUNCH list (what the owner/architect walks, and
//     what the client portal renders) or the internal CREW list (touch-ups,
//     cleanup — never shown to the client). Like the location, the choice
//     sticks between saves, because he walks a stretch of chores and then a
//     stretch of formal items. And like the location, the active list is
//     painted loud: twenty formal items filed to the crew list vanish from the
//     client's view, twenty chores filed to the punch list land in front of it.
//   • Session roll-up at the bottom: "captured 7 items this walk" with
//     undo. The list clears when the user leaves the screen.
//   • PHOTO, THEN PIN, THEN DESCRIPTION (founder, 2026-09-17, on a real walk).
//     The moment the camera returns, components/punch/PlanPinStep opens full
//     screen on the job's plan: he taps where he is standing, Next, and he is
//     back on this form with the pin attached ("Pinned on A-101") and the mic
//     under his thumb. Skip saves the item exactly as it saved before the step
//     existed. The pin rides on the draft beside the photo, independent of it —
//     removing the photo does not quietly drop where the defect is.
//   • PIN FIRST (founder, 2026-09-18: "pin the location of each item before and
//     after taking photos"). Opened with `start=pin` (or the toggle), the plan
//     comes up FIRST: tap the spot → the camera opens → describe → Save → the
//     plan reopens for the next spot. It is this same screen on purpose — the
//     same camera call, GPS stamp, late-stamp update and addPunchItem save, not
//     a second copy of them. `pinDecidedRef` records that he has answered
//     "where is this item" for the current draft (Next, Skip pin or Remove), so
//     a photo taken after that never reopens the plan to ask again.

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform, Modal, Image, KeyboardAvoidingView, Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { punchLocationText, PUNCH_NO_ROOM_TEXT } from '@/utils/punchGcCore';
import { Stack, useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, Mic, Check, X, Undo2, MapPin, MapPinPlus,
  AlertTriangle, ChevronRight, Plus, Flag, Eye, EyeOff,
  // Aliased: a bare `Map` import would shadow the global Map constructor for
  // the whole module, which is the kind of thing nobody notices until someone
  // adds a lookup table here two months from now.
  Map as PlanRoomIcon,
} from 'lucide-react-native';
import { MageAIMark } from '@/components/icons';
import { Colors } from '@/constants/colors';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useProjects } from '@/contexts/ProjectContext';
// Project-scoped gate: an invited collaborator may do the work they were
// invited to do, even though their own tier is free. See
// utils/collaboratorAccess.
import { useProjectAccess } from '@/hooks/useProjectAccess';
import Paywall from '@/components/Paywall';
import { generateUUID } from '@/utils/generateId';
import VoiceRecorder from '@/components/VoiceRecorder';
import { inferTradeFromText, walkProposedSub, type WalkSubChoice } from '@/utils/tradeInference';
// The ONE answer to "what locations exist on this project?" — shared with
// app/punch-list.tsx so the chips he taps here and the rooms he filters by
// there cannot drift into two different spellings of one corridor.
import {
  buildPunchLocationOptions, normalizeLocation,
  type PunchLocationOption,
} from '@/utils/punchLocations';
// Rooms Plan Intelligence already read off this project's drawings. A bonus,
// never a requirement: most projects have no analysed plans, and that is the
// normal case rather than an error state.
import { usePlanRooms } from '@/hooks/usePlanRooms';
import { parsePunchFromTranscript, sentenceCase, titleCase } from '@/utils/voiceFormParsers';
import { stampPhotoLocation, type PhotoGeoStamp } from '@/utils/photoGeoStamp';
import type { PunchItem, PunchItemPriority, PunchListType, SubTrade } from '@/types';
import { SUB_TRADES } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { neutralInk, labelOn } from '@/components/ui/ink';
import { segmentedDesktop, useIsDesktop, useSheetFrame } from '@/components/ui';
import { showAlert } from '@/utils/alert';
// LS-5: a viewer seat cannot file punch items (RLS needs 'field').
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { projectRecordWriteBlock } from '@/utils/collaboratorAccess';
import { addCalendarDays, toCalendarDayString } from '@/utils/calendarDate';
import PlanPinStep from '@/components/punch/PlanPinStep';
import {
  durablePinSheetCount, pdfImportBlockedReason, punchPinFields, shouldAutoOpenPinStep, shouldOpenCameraAfterPin,
  walkStartFromParam, type WalkStart, type WalkPin,
} from '@/utils/punchPlanPin';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useAuth } from '@/contexts/AuthContext';
// The subs an item on THIS job may go to: his own directory when he owns the
// job, the owner's subs on the job when he is a collaborator — never his own
// directory on someone else's job (#110).
import { useProjectSubcontractors, type ProjectSubcontractorsState } from '@/hooks/useProjectSubcontractors';
// Learn-by-doing tutorials (utils/tutorial, tutorial 'punch-walk'): the coach
// spotlights these REAL controls and advances only on the signals this screen
// emits at its real success points. Idle cost: a View and a Map write each.
import { TutorialTarget } from '@/components/tutorial/TutorialTarget';
import { TutorialScrollAnchor } from '@/components/tutorial/TutorialScrollAnchor';
import { TutorialOfferChip } from '@/components/tutorial/TutorialOfferChip';
import {
  isTutorialActive, tutorialSignal, useTutorialAssist, useTutorialPractice, useTutorialRun, useTutorialSandboxId, useTutorialStepActive,
} from '@/utils/tutorial/store';
import type { RunState } from '@/utils/tutorial/types';

/** The sandbox of a live tutorial run whose sample plan did NOT load, else
 *  null. Module-level so useTutorialRun's selector is stable. */
const selectNoSamplePlanSandbox = (s: RunState): string | null =>
  s.status === 'running' && s.flags?.samplePlan === false ? s.sandboxProjectId : null;
import { PUNCH_SAMPLE } from '@/utils/tutorial/fixtures';
import { samplePhotoImage } from '@/utils/tutorial/sandbox';
import { useT } from '@/contexts/LanguageContext';
import { t, tn } from '@/i18n/core';

// Map the loose AI-trade string to the strict SubTrade enum used in
// the data model. Anything not recognized falls back to 'General'.
function aiTradeToSubTrade(aiTrade: string): SubTrade {
  const t = (aiTrade || '').toLowerCase();
  if (t.includes('electrical')) return 'Electrical';
  if (t.includes('plumb')) return 'Plumbing';
  if (t.includes('hvac') || t.includes('mechanical')) return 'HVAC';
  if (t.includes('drywall')) return 'Drywall';
  if (t.includes('paint')) return 'Painting';
  if (t.includes('tile')) return 'Flooring';
  if (t.includes('floor')) return 'Flooring';
  if (t.includes('roof')) return 'Roofing';
  if (t.includes('concrete') || t.includes('masonry')) return 'Concrete';
  if (t.includes('frame') || t.includes('framing')) return 'Framing';
  if (t.includes('landscap')) return 'Landscaping';
  if (t.includes('trim') || t.includes('carpentry') || t.includes('door')
      || t.includes('cabinet') || t.includes('insulation') || t.includes('cleanup')) return 'Other';
  return 'General';
}

const TRADE_ORDER: SubTrade[] = SUB_TRADES;

/** A SubTrade's label in the app's language. The VALUE (the enum) is what is
 *  saved and matched on; only the label is translated. */
function subTradeLabel(trade: SubTrade): string {
  switch (trade) {
    case 'General': return t('field.punchWalk.trade.general', 'General');
    case 'Demolition': return t('field.punchWalk.trade.demolition', 'Demolition');
    case 'Framing': return t('field.punchWalk.trade.framing', 'Framing');
    case 'Concrete': return t('field.punchWalk.trade.concrete', 'Concrete');
    case 'Electrical': return t('field.punchWalk.trade.electrical', 'Electrical');
    case 'Plumbing': return t('field.punchWalk.trade.plumbing', 'Plumbing');
    case 'HVAC': return t('field.punchWalk.trade.hvac', 'HVAC');
    case 'Controls / BMS': return t('field.punchWalk.trade.controls', 'Controls / BMS');
    case 'Fire Protection': return t('field.punchWalk.trade.fireProtection', 'Fire Protection');
    case 'Fire Alarm': return t('field.punchWalk.trade.fireAlarm', 'Fire Alarm');
    case 'Low Voltage / Cabling': return t('field.punchWalk.trade.lowVoltage', 'Low Voltage / Cabling');
    // i18n-keep-english: acronym (audio-visual), the same in Spanish
    case 'AV': return 'AV';
    case 'Security': return t('field.punchWalk.trade.security', 'Security');
    case 'Roofing': return t('field.punchWalk.trade.roofing', 'Roofing');
    case 'Drywall': return t('field.punchWalk.trade.drywall', 'Drywall');
    case 'Acoustical Ceilings': return t('field.punchWalk.trade.acousticalCeilings', 'Acoustical Ceilings');
    case 'Millwork': return t('field.punchWalk.trade.millwork', 'Millwork');
    case 'Glazing': return t('field.punchWalk.trade.glazing', 'Glazing');
    case 'Doors & Hardware': return t('field.punchWalk.trade.doorsHardware', 'Doors & Hardware');
    case 'Painting': return t('field.punchWalk.trade.painting', 'Painting');
    case 'Flooring': return t('field.punchWalk.trade.flooring', 'Flooring');
    case 'Landscaping': return t('field.punchWalk.trade.landscaping', 'Landscaping');
    case 'Other': return t('field.punchWalk.trade.other', 'Other');
  }
  return trade;
}

/** A punch priority's label (lowercase, as the enum printed before). */
function priorityLabel(p: PunchItemPriority): string {
  if (p === 'high') return t('field.punchWalk.priority.high', 'high');
  if (p === 'low') return t('field.punchWalk.priority.low', 'low');
  return t('field.punchWalk.priority.medium', 'medium');
}


/**
 * How many location chips sit in the inline rail before the rest move behind
 * "All rooms". A finishing job has thirty-plus rooms; a rail that long is a
 * scroll hunt with one gloved thumb, and the rail is recency-ordered so the
 * rooms he is actually walking are the ones that stay in it.
 */
const LOCATION_CHIP_LIMIT = 10;

// How long the iOS camera's dismiss animation runs after launchCameraAsync has
// already resolved (expo-image-picker resolves, THEN calls dismiss(animated:)).
// The pin step's full-screen Modal is presented after it, so UIKit never sees a
// second presentation while the first is still animating out.
const CAMERA_DISMISS_MS = 450;

// Pin first on iOS: the camera is launched from the pin step Modal's onDismiss
// (UIKit drops a presentation made while another is still dismissing). This
// fallback runs it once if onDismiss never comes — only while the step is
// still closed. ≥ 3 × CAMERA_DISMISS_MS.
const PIN_STEP_DISMISS_FALLBACK_MS = 1500;
// Pin first opens the plan when the push of this screen has finished
// animating (UIKit can drop a modal presented mid-transition, and he would
// see the walk form instead of the plan). The native stack's transitionEnd is
// the signal; this is the fallback if it never comes (no animation at all).
const PIN_FIRST_MOUNT_FALLBACK_MS = 700;

/**
 * Ink for text and icons sitting ON `accentFill`. Not a theme token on
 * purpose: `accentFill` is derived per theme specifically to clear 4.6:1
 * against WHITE (see constants/colors), so an inverting token here would
 * break the one pairing the fill was computed for.
 */
const ON_ACCENT_INK = '#FFFFFF';

/**
 * How the location currently on the draft got there.
 *
 * WHY THIS IS TRACKED. Carrying the last location forward is the single
 * biggest speed win on this screen and also its single biggest failure mode:
 * he files five items in Hall 2, walks into Unit 4B, and the next twenty items
 * land in Hall 2 because the field never changed and nothing on screen said
 * so. The banner reads this to label a carried-forward room AS carried
 * forward, rather than showing it identically to one he just chose.
 *
 *   'none'    — empty; the item saves with NO location ('') — #56
 *   'picked'  — he tapped a chip or a row in the All-rooms sheet
 *   'typed'   — he typed it into the input
 *   'voice'   — the transcript parser pulled it out of his dictation
 *   'gps'     — seeded from the photo's GPS label, because nothing else was set
 *   'carried' — held over from the item he just saved; HE HAS NOT CONFIRMED IT
 */
type LocationOrigin = 'none' | 'picked' | 'typed' | 'voice' | 'gps' | 'carried';

/**
 * Read the list a caller asked walk mode to start on. The punch list screen
 * passes `list` when it opens walk mode while its Crew view is showing, so he
 * does not have to re-pick the list he was just looking at.
 *
 * Only an explicit 'crew' starts on crew. Anything else — no param, a typo, an
 * old deep link — starts on 'punch', the same default punchListTypeOf applies
 * to stored items: a mis-filed item then stays VISIBLE to the client rather
 * than silently missing from the portal.
 */
function listFromParam(raw: string | string[] | undefined): PunchListType {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === 'crew' ? 'crew' : 'punch';
}

// ─────────────────────────────────────────────────────────────

export default function PunchWalkScreen() {
  const router = useRouter();
  // Read the project from params here (not just in Inner) so the gate can
  // ask 'were they invited to THIS project?' before paywalling.
  const { projectId: gateProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const { canAccess } = useProjectAccess(gateProjectId);
  // The founder's practice pass (utils/tutorial/practicePass): during the
  // punch-walk tutorial, and only on its SAMPLE job, a Free or Pro user may
  // walk. Opt-in HERE rather than in useProjectAccess, so it opens this screen
  // and no other; walk mode writes only to this same URL projectId (it takes
  // no record id), so the pass cannot reach a real job. Empty when idle.
  const practice = useTutorialPractice(gateProjectId);
  // Walk Mode builds the same punch list the Punch List screen gates behind
  // Business — gate the capture surface too, or a free/Pro user could dictate
  // and save a full list here and only hit the paywall on the read/manage view.
  if (!canAccess('punch_list_closeout') && !practice.has('punch_list_closeout')) {
    return (
      <Paywall
        visible={true}
        feature="Punch List & Closeout"
        requiredTier="business"
        onClose={() => router.back()}
        // "Try it free on a sample job first": the punch-walk tutorial runs on
        // the sample under the practice pass, so the wall becomes feel-then-buy.
        practiceTutorialId="punch-walk"
        source="punch_walk_gate"
      />
    );
  }
  return <PunchWalkScreenInner />;
}

function PunchWalkScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; list?: string; listType?: string; start?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  // `listType` accepted as an alias so a caller spelling it after the field
  // name still lands on the right list.
  const initialList = listFromParam(params.list ?? params.listType);
  // `start=pin` opens the walk in pin-first mode (plan, then photo).
  const initialStart = walkStartFromParam(params.start);
  const { projects, getProject, addPunchItem, deletePunchItem } = useProjects();
  const projectSubs = useProjectSubcontractors(projectId);
  const { user } = useAuth();

  // If no projectId was passed, show a project picker. Walk mode is
  // always bound to one project — you can't mix items across jobs.
  const project = projectId ? getProject(projectId) : null;

  if (!projectId || !project) {
    // Carry the list through the picker, or opening walk mode from the Crew
    // view without a project would quietly restart him on the punch list.
    return <ProjectPicker projects={projects} onPick={(p) => router.replace({ pathname: '/punch-walk' as never, params: { projectId: p, list: initialList, start: initialStart } as never })} onBack={() => router.back()} />;
  }

  return (
    <WalkInner
      projectName={project.name}
      projectId={projectId}
      initialList={initialList}
      initialStart={initialStart}
      projectSubs={projectSubs}
      userId={user?.id}
      onAdd={addPunchItem}
      onDelete={deletePunchItem}
      onBack={() => router.back()}
    />
  );
}

// ─────────────────────────────────────────────────────────────

interface SessionCapture {
  id: string;
  description: string;
  location: string;
  trade: SubTrade;
  priority: PunchItemPriority;
  listType: PunchListType;
  photoUri?: string;
  /** "A-101 · Level 2" when the item was pinned, for the roll-up line. */
  pinLabel?: string;
  capturedAt: string;
}

function WalkInner({ projectName, projectId, initialList, initialStart, projectSubs, userId, onAdd, onDelete, onBack }: {
  projectName: string;
  projectId: string;
  initialList: PunchListType;
  initialStart: WalkStart;
  projectSubs: ProjectSubcontractorsState;
  /** Stamped as createdByUserId: who may delete the item later (#111). */
  userId: string | undefined;
  onAdd: (item: PunchItem) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const { t, tn } = useT();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  // So the tutorial coach can scroll a target (Save) into view.
  const walkScrollRef = useRef<ScrollView>(null);
  const router = useRouter();
  const navigation = useNavigation();
  // Look up the project for AI-context (description -> location/trade/priority).
  // The voice parser needs the project; `punchItems` feeds the location chips.
  const { getProject, punchItems, getPlanSheetsForProject, updatePunchItemPin } = useProjects();
  const project = getProject(projectId);
  // LS-5: punch_items_collab_insert needs a field/editor/owner seat. A
  // viewer's walk would save optimistically and then be refused, item by
  // item, so Save is off for him and says why. Shares the role query cache.
  const writeSeat = useProjectRoleState(projectId);
  const writeBlock = projectRecordWriteBlock(writeSeat.role);

  // Draft — what the user is building right now. Each save clears it
  // back to an empty draft seeded with the last location (see persist).
  const [draft, setDraft] = useState<{
    description: string;
    location: string;
    trade: SubTrade;
    matchedKeyword?: string;
    priority: PunchItemPriority;
    photoUri?: string;
    /** GPS stamp from when the photo was captured. Stored on the draft so a
     *  subsequent edit doesn't drop it on save. */
    photoStamp?: PhotoGeoStamp;
    /** Drives the banner. See LocationOrigin — a carried-forward room must
     *  never look the same as one he chose for this item. */
    locationOrigin: LocationOrigin;
    /** Where on the plan this item is, from the pin step. Undefined = not
     *  pinned (skipped, or no plan) — handleSave then writes no plan fields. */
    pin?: WalkPin;
    /** The sheet's label at the moment he pinned, for the "Pinned on" chip. */
    pinLabel?: string;
  }>({ description: '', location: '', trade: 'General', priority: 'medium', locationOrigin: 'none' });

  // The list each saved item is filed to. Deliberately NOT part of the draft:
  // the draft is rebuilt on every save, and the list has to survive that the
  // same way the location does — he captures a stretch of crew chores, then a
  // stretch of formal punch, and re-picking it per item is how items get
  // mis-filed. It only changes when he taps the toggle.
  const [listType, setListType] = useState<PunchListType>(initialList);

  // Session history — everything saved in this walk, in reverse-chron.
  // Kept on-screen so the user can undo a mistaken save.
  const [session, setSession] = useState<SessionCapture[]>([]);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [showTradeOverride, setShowTradeOverride] = useState(false);
  const [showSubPicker, setShowSubPicker] = useState(false);
  const [subChoice, setSubChoice] = useState<WalkSubChoice>({ mode: 'auto' });
  // A trade change re-proposes: 'picked' was a choice for the OLD trade.
  const lastTradeRef = useRef<SubTrade>(draft.trade);
  useEffect(() => {
    if (lastTradeRef.current !== draft.trade) {
      lastTradeRef.current = draft.trade;
      setSubChoice(c => (c.mode === 'auto' ? c : { mode: 'auto' }));
    }
  }, [draft.trade]);
  const subs = projectSubs.subs;
  const proposedSub = walkProposedSub(subChoice, draft.trade, subs, projectId);
  /** Subs on THIS job, for the picker: the sheet never offers an off-job sub. */
  const subsOnJob = useMemo(
    () => subs.filter(s => (s.assignedProjects ?? []).includes(projectId)),
    [subs, projectId],
  );
  const [showAllLocations, setShowAllLocations] = useState(false);

  // ── Pin step ─────────────────────────────────────────────────────────────
  // `pinStepOpen` is the full-screen "Where is this?" step. `lastPinSheetId`
  // lives OUTSIDE the draft for the same reason the list does: he walks one
  // floor at a time, so the next photo should open on the sheet he just used,
  // and the draft is rebuilt on every save.
  const [pinStepOpen, setPinStepOpen] = useState(false);
  const [lastPinSheetId, setLastPinSheetId] = useState<string | null>(null);
  // Set when he skips the "no plan on this job" screen. See
  // shouldAutoOpenPinStep: that screen is shown once a walk, not once a photo.
  const [dismissedNoPlan, setDismissedNoPlan] = useState(false);
  // A tutorial run on THIS sample whose plan didn't load (offline, slow upload,
  // unsynced sample) has already auto-skipped its pin steps. The photo must
  // not then open the "Add your floor plan" screen: the planPin layer would
  // hide the coach until he closed it himself. Treat that screen as already
  // seen this walk — the same state his own Skip leaves.
  const noSamplePlanSandbox = useTutorialRun(selectNoSamplePlanSandbox);
  useEffect(() => {
    if (noSamplePlanSandbox && noSamplePlanSandbox === projectId) setDismissedNoPlan(true);
  }, [noSamplePlanSandbox, projectId]);
  // DURABLE sheets, not merely listed or locally renderable ones: a sheet with
  // no image saved (IMG_1668 on any other device) has nothing to pin on, and a
  // device-only one (IMG_1668 on the phone that imported it) must be saved
  // before it takes a pin. Counting either re-opened the step after every
  // photo with no way to mute it; as "no plan", the first photo offers the
  // add/save and one Skip mutes it for the walk.
  const planSheetCount = durablePinSheetCount(getPlanSheetsForProject(projectId), projectId);
  // The iOS camera resolves BEFORE its dismiss animation finishes; presenting
  // the pin step's full-screen Modal inside that animation can be dropped by
  // UIKit ("presentation in progress"), leaving pinStepOpen true and nothing on
  // screen. The open waits out the dismiss, and is cancelled on unmount.
  const pinOpenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (pinOpenTimerRef.current) clearTimeout(pinOpenTimerRef.current); }, []);
  // If UIKit drops the presentation anyway, pinStepOpen is already true and a
  // plain setPinStepOpen(true) is a no-op — the step could never be reopened.
  // Closing first and reopening on the next frame always presents it.
  const openPinStep = useCallback(() => {
    setPinStepOpen(false);
    requestAnimationFrame(() => setPinStepOpen(true));
  }, []);

  // ── Pin first ────────────────────────────────────────────────────────────
  const [pinFirst, setPinFirst] = useState(initialStart === 'pin');
  // Read by callbacks that outlive their render (the parked camera call, the
  // camera handler after its await): refs, synced every render.
  const pinFirstRef = useRef(pinFirst);
  pinFirstRef.current = pinFirst;
  const draftPhotoRef = useRef<string | undefined>(draft.photoUri);
  draftPhotoRef.current = draft.photoUri;
  const pinStepOpenRef = useRef(pinStepOpen);
  pinStepOpenRef.current = pinStepOpen;
  // He has answered "where is this item" for the current draft (Next, Skip
  // pin or Remove). Cleared by Save. A photo taken after it never reopens the
  // plan — not even from a stale closure, because it is a ref.
  const pinDecidedRef = useRef(false);
  const handleCameraRef = useRef<() => Promise<void>>(async () => {});
  // The role gate (editor+ to store a plan) is PlanPinStep's own; this is the
  // tier gate of the Plans screen the PDF import opens.
  const tier = useTierAccess();
  const pdfBlocked = pdfImportBlockedReason(tier.canAccess('plan_markup'));

  // The next step after the pin step closes (pin first: the camera). Timing
  // per platform: web runs it synchronously inside the Next click — the
  // browser only opens a file picker on a user gesture; Android has no
  // Modal onDismiss, so the next frame; iOS waits for onDismiss (a camera
  // presented while the step is still sliding away is dropped by UIKit), with
  // a once-only fallback that fires only if the step is still closed.
  const afterPinStepRef = useRef<(() => void) | null>(null);
  const afterPinStepTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (afterPinStepTimerRef.current) clearTimeout(afterPinStepTimerRef.current); }, []);
  const runAfterPinStep = useCallback((fn: () => void) => {
    if (Platform.OS === 'web') { fn(); return; }
    if (Platform.OS === 'android') { requestAnimationFrame(fn); return; }
    afterPinStepRef.current = fn;
    if (afterPinStepTimerRef.current) clearTimeout(afterPinStepTimerRef.current);
    afterPinStepTimerRef.current = setTimeout(() => {
      afterPinStepTimerRef.current = null;
      const parked = afterPinStepRef.current;
      afterPinStepRef.current = null;
      if (parked && !pinStepOpenRef.current) parked();
    }, PIN_STEP_DISMISS_FALLBACK_MS);
  }, []);
  const handlePinStepDismissed = useCallback(() => {
    const parked = afterPinStepRef.current;
    afterPinStepRef.current = null;
    if (afterPinStepTimerRef.current) { clearTimeout(afterPinStepTimerRef.current); afterPinStepTimerRef.current = null; }
    if (parked) parked();
  }, []);

  // The GPS fix for the photo on the draft. It no longer blocks the shutter,
  // so a fast save can land before it; handleSave then writes the stamp onto
  // the saved item when it arrives, instead of dropping it.
  const pendingStampRef = useRef<{ shotUri: string; promise: Promise<PhotoGeoStamp | null> } | null>(null);

  // ── Locations ────────────────────────────────────────────────────────────
  // Two sources, merged and deduped by utils/punchLocations: rooms already
  // used on this project's punch items (always available — no plans, no AI, no
  // signal, which is the whole point on a jobsite) and rooms Plan Intelligence
  // confirmed off the drawings. `getSession` returns null for a project that
  // was never analysed, and every function downstream is correct when it does.
  const { getSession: getPlanRoomSession } = usePlanRooms();
  const planRooms = getPlanRoomSession(projectId)?.rooms;

  // Filter from the raw `punchItems` array rather than calling
  // getPunchItemsForProject(): that helper builds a fresh sorted array on every
  // call, so it would invalidate the memo below on every keystroke.
  const projectItems = useMemo(
    () => punchItems.filter(i => i.projectId === projectId),
    [punchItems, projectId],
  );

  // Recomputed as he saves, so the room he is standing in stays first in the
  // rail without him doing anything. `onAdd` writes straight into the context,
  // so this reorders on the save that just happened, not on the next refresh.
  const locationOptions = useMemo(
    () => buildPunchLocationOptions(projectItems, planRooms),
    [projectItems, planRooms],
  );

  const activeLocationKey = normalizeLocation(draft.location);

  // The rail is the first LOCATION_CHIP_LIMIT options — EXCEPT that the room
  // currently on the draft is always in it. Without that, picking a room from
  // the All-rooms sheet could leave the rail showing ten chips, none of them
  // the one that is actually selected, which reads as "nothing is selected".
  const railOptions = useMemo(() => {
    const head = locationOptions.slice(0, LOCATION_CHIP_LIMIT);
    if (!activeLocationKey || head.some(o => o.key === activeLocationKey)) return head;
    const active = locationOptions.find(o => o.key === activeLocationKey);
    return active ? [active, ...head.slice(0, LOCATION_CHIP_LIMIT - 1)] : head;
  }, [locationOptions, activeLocationKey]);

  // The anti-drift number. Not "items at this location on the project" — items
  // filed here during THIS walk. A climbing count next to a room name he is no
  // longer standing in is the thing that catches the mistake.
  const filedHereThisWalk = useMemo(() => {
    if (!activeLocationKey) return 0;
    return session.filter(c => normalizeLocation(c.location) === activeLocationKey).length;
  }, [session, activeLocationKey]);

  /**
   * One tap to move rooms.
   *
   * Sets the location and NOTHING ELSE. In particular the room name is never
   * run through `inferTradeFromText`: that matcher works on bare substrings,
   * so "Roof Deck" would route the item to Roofing and "Panel Room" to
   * Electrical, silently overwriting a trade he set by hand. The trade on the
   * draft is left exactly as it was — the description is the only thing that
   * has ever been allowed to move it.
   *
   * `label` is the user's own spelling from the option list, so his
   * capitalisation survives onto the saved item.
   */
  const handlePickLocation = useCallback((label: string) => {
    setDraft(d => ({ ...d, location: label, locationOrigin: 'picked' }));
    setShowAllLocations(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const handlePickList = useCallback((next: PunchListType) => {
    setListType(prev => {
      // A real change gets a heavier tap than a room change: moving an item
      // between client-facing and internal is the consequential switch here.
      if (prev !== next && Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return next;
    });
  }, []);

  const handleClearLocation = useCallback(() => {
    setDraft(d => ({ ...d, location: '', locationOrigin: 'none' }));
    setShowAllLocations(false);
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // Auto-infer trade whenever description changes. Doesn't fire on
  // every keystroke — the inference is stable and cheap, but we want
  // the UI to feel like the chip settles only when you pause typing.
  const inferenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draft.description) return;
    if (inferenceTimer.current) clearTimeout(inferenceTimer.current);
    inferenceTimer.current = setTimeout(() => {
      const result = inferTradeFromText(draft.description);
      // Only auto-update if the user hasn't manually overridden.
      setDraft(d => d.trade !== 'General' && d.trade !== result.trade
        ? d // user picked something explicit, don't clobber
        : { ...d, trade: result.trade, matchedKeyword: result.matchedKeyword });
    }, 300);
    return () => { if (inferenceTimer.current) clearTimeout(inferenceTimer.current); };
  }, [draft.description]);

  // Voice transcript handler — runs the AI parser to split the
  // dictation into description / location / trade / priority and merges
  // into the current draft. Falls back to plain append if the parser
  // can't get anything useful (offline, AI down, etc.) so a
  // disconnected GC still gets text into the description.
  const handleTranscript = useCallback(async (text: string) => {
    setIsTranscribing(true);
    try {
      const parsed = await parsePunchFromTranscript(text, project ?? null);
      // Title-case so "master bath" -> "Master Bath". Computed once so the
      // location and its origin below cannot disagree about whether the
      // dictation actually contained a room.
      const spokenLocation = titleCase(parsed.location || '');
      setDraft(d => ({
        ...d,
        // Description: append so multiple dictations stack (e.g.
        // "hallway 2" + "outlet cover missing" become one item). Run
        // through sentenceCase so the saved punch reads like a short
        // title — "Light fixture loose" not "light fixture loose".
        description: parsed.description
          ? (d.description ? `${d.description} ${sentenceCase(parsed.description)}`.trim() : sentenceCase(parsed.description))
          : (d.description ? `${d.description} ${sentenceCase(text)}`.trim() : sentenceCase(text.trim())),
        // Location: only fill if the user hasn't already typed one.
        location: d.location || spokenLocation,
        // A room he SAID counts as set for this item — it stops reading as
        // "carried forward" the moment his own dictation names it.
        locationOrigin: d.location
          ? d.locationOrigin
          : (spokenLocation ? 'voice' : d.locationOrigin),
        // Trade: only overwrite when AI gives us something specific
        // and the user hasn't manually picked.
        trade: (parsed.trade && parsed.trade !== 'General' && d.trade === 'General')
          ? aiTradeToSubTrade(parsed.trade)
          : d.trade,
        // Priority: AI returns 'low' | 'medium' | 'high' which matches
        // PunchItemPriority. Overwrite only if AI was confident enough
        // to set non-default 'medium'.
        priority: (parsed.priority && parsed.priority !== 'medium') ? parsed.priority : d.priority,
      }));
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      console.warn('[punch-walk] voice parse failed, falling back to append:', err);
      setDraft(d => ({
        ...d,
        description: d.description ? `${d.description} ${text}`.trim() : text.trim(),
      }));
    } finally {
      setIsTranscribing(false);
    }
  }, [project]);

  const handleCamera = useCallback(async () => {
    let result: ImagePicker.ImagePickerResult;
    if (Platform.OS === 'web') {
      // Camera capture is not supported on web — use image library instead.
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsEditing: false });
    } else {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        showAlert(t('field.punchWalk.cameraAccessNeeded', 'Camera access needed'), t('field.punchWalk.grantCameraPermissionIn', 'Grant camera permission in Settings to attach punch photos.'));
        return;
      }
      result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    }
    if (!result.canceled && result.assets[0]) {
      const shotUri = result.assets[0].uri;
      // The photo lands on the draft NOW and the pin step opens NOW; the GPS
      // stamp (up to 3s on a cold fix) follows in the background. Awaiting it
      // first put seconds between the shutter and the plan on every item of a
      // sixty-item walk.
      setDraft(d => ({ ...d, photoUri: result.assets[0].uri, photoStamp: undefined }));
      // Tutorial success point: a real photo is on the draft. (Web's Photo is
      // a file picker, so it reports as a library pick.)
      tutorialSignal('punch.photo.added', { projectId, source: Platform.OS === 'web' ? 'library' : 'camera' });
      const stampPromise = stampPhotoLocation();
      pendingStampRef.current = { shotUri, promise: stampPromise };
      void stampPromise.then(stamp => {
        if (!stamp) return;
        setDraft(d => {
          // He retook or removed the photo while the fix was coming in: this
          // stamp belongs to a picture that is no longer on the draft.
          if (d.photoUri !== shotUri) return d;
          return {
            ...d,
            photoStamp: stamp,
            // If the user hasn't typed a location yet, seed it with the geo
            // label so the punch still has SOMETHING for the closeout report.
            location: d.location || stamp.label || '',
            // Say where that came from. A reverse-geocoded street label is not a
            // room he chose, and the banner labels it "from photo GPS" rather than
            // letting it pass as one.
            locationOrigin: d.location
              ? d.locationOrigin
              : (stamp.label ? 'gps' : d.locationOrigin),
          };
        });
      }).catch(() => { /* no fix — the item saves without a stamp, as before */ });
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      // Photo, THEN pin, then description: the plan comes up before the form
      // so he pins while he is still standing on the spot.
      if (shouldAutoOpenPinStep({ pinnableSheetCount: planSheetCount, dismissedNoPlanThisWalk: dismissedNoPlan, pinDecided: pinDecidedRef.current })) {
        if (pinOpenTimerRef.current) clearTimeout(pinOpenTimerRef.current);
        pinOpenTimerRef.current = setTimeout(() => {
          pinOpenTimerRef.current = null;
          setPinStepOpen(true);
        }, Platform.OS === 'ios' ? CAMERA_DISMISS_MS : 0);
      }
    }
  }, [planSheetCount, dismissedNoPlan, projectId, t]);
  handleCameraRef.current = handleCamera;

  const handlePinNext = useCallback((pin: WalkPin, sheetLabel: string) => {
    // Location is left exactly as it is: a point on a drawing is not a room
    // name, and inventing one from coordinates would be a guess he never made.
    setDraft(d => ({ ...d, pin, pinLabel: sheetLabel }));
    setLastPinSheetId(pin.sheetId);
    pinDecidedRef.current = true;
    setPinStepOpen(false);
    // Tutorial success point: he answered "where is this" with a pin.
    tutorialSignal('punch.pin.decided', { projectId, pinned: true });
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Pin first: the spot is set, now the photo.
    if (shouldOpenCameraAfterPin({ pinFirst: pinFirstRef.current, draftHasPhoto: !!draftPhotoRef.current })) {
      runAfterPinStep(() => { void handleCameraRef.current(); });
    }
  }, [runAfterPinStep, projectId]);

  const handlePinSkip = useCallback(({ hadPlan }: { hadPlan: boolean }) => {
    // Skip means "no pin for this item" — including clearing one he placed
    // earlier and came back to change.
    setDraft(d => ({ ...d, pin: undefined, pinLabel: undefined }));
    if (!hadPlan) setDismissedNoPlan(true);
    // Answered: the photo that follows (pin first) must not bring the plan back.
    pinDecidedRef.current = true;
    setPinStepOpen(false);
    // Tutorial: Skip is an answer too — the walk moves on without a pin.
    tutorialSignal('punch.pin.decided', { projectId, pinned: false });
    if (shouldOpenCameraAfterPin({ pinFirst: pinFirstRef.current, draftHasPhoto: !!draftPhotoRef.current })) {
      runAfterPinStep(() => { void handleCameraRef.current(); });
    }
  }, [runAfterPinStep, projectId]);


  const handleRemovePin = useCallback(() => {
    setDraft(d => ({ ...d, pin: undefined, pinLabel: undefined }));
    // Removing is an answer too: a retake must not re-ask.
    pinDecidedRef.current = true;
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // ── Tutorial: the sample photo (punch-walk, step punch-photo) ────────────
  // The bundled illustration (assets/tutorial/sample-outlet.jpg) lands on the
  // draft and runs the camera's own continuation — photo on the draft, THEN
  // the pin step — so the walk he practises is the walk he gets, with no
  // camera-permission prompt mid-tour and a path on the simulator and web.
  // Not a call into handleCamera: that body is the camera's, pinned line by
  // line (validate-punch-plan-pin), and it does two things a sample must not:
  // wait out an iOS camera dismiss that never happened, and GPS-stamp the
  // photo with where he is standing — a stamp on an illustration taken
  // nowhere would be a lie about the picture.
  const [samplePhotoBusy, setSamplePhotoBusy] = useState(false);
  const acceptSamplePhoto = useCallback(async () => {
    if (samplePhotoBusy) return;
    setSamplePhotoBusy(true);
    try {
      const img = await samplePhotoImage();
      if (!img) {
        showAlert(t('field.punchWalk.samplePhotoUnavailable', 'Sample photo unavailable'), t('field.punchWalk.usePhotoToTake', 'Use Photo to take one instead.'));
        return;
      }
      setDraft(d => ({ ...d, photoUri: img.uri, photoStamp: undefined }));
      pendingStampRef.current = null;
      tutorialSignal('punch.photo.added', { projectId, source: 'sample' });
      if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (shouldAutoOpenPinStep({ pinnableSheetCount: planSheetCount, dismissedNoPlanThisWalk: dismissedNoPlan, pinDecided: pinDecidedRef.current })) {
        openPinStep();
      }
    } finally {
      setSamplePhotoBusy(false);
    }
  }, [samplePhotoBusy, projectId, planSheetCount, dismissedNoPlan, openPinStep, t]);

  // Opened with start=pin: the plan first. With no plan the step IS the
  // "Add your floor plan" screen, and it latches a sheet that hydrates late.
  useEffect(() => {
    if (initialStart !== 'pin') return;
    if (Platform.OS !== 'ios') { openPinStep(); return; }
    let opened = false;
    const open = () => { if (opened) return; opened = true; openPinStep(); };
    const unsubscribe = (navigation as unknown as {
      addListener: (event: 'transitionEnd', cb: () => void) => () => void;
    }).addListener('transitionEnd', open);
    const timer = setTimeout(open, PIN_FIRST_MOUNT_FALLBACK_MS);
    return () => { opened = true; unsubscribe(); clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sessionItemIds = useMemo(() => session.map(c => c.id), [session]);

  const cycleTrade = useCallback(() => {
    setDraft(d => {
      const idx = TRADE_ORDER.indexOf(d.trade);
      const next = TRADE_ORDER[(idx + 1) % TRADE_ORDER.length];
      return { ...d, trade: next, matchedKeyword: undefined }; // user overrode
    });
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  const cyclePriority = useCallback(() => {
    setDraft(d => ({
      ...d,
      priority: d.priority === 'low' ? 'medium' : d.priority === 'medium' ? 'high' : 'low',
    }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);

  // ── Tutorial wiring (idle: a sandbox read and a step read, nothing else) ──
  const tutorialSandboxId = useTutorialSandboxId();
  const onTutorialSample = tutorialSandboxId === projectId;
  const samplePhotoStepLive = useTutorialStepActive('punch-photo');
  const sampleLineStepLive = useTutorialStepActive('punch-describe');
  const showSamplePhoto = onTutorialSample && samplePhotoStepLive;
  const showSampleLine = onTutorialSample && sampleLineStepLive;

  // 'Use the sample line': the description a super would say, and the room
  // when none is set. The trade is NOT set here — the existing inference
  // effect above picks Electrical from 'outlet', deterministically, with no AI
  // call, exactly as it would from his own words.
  const applySampleLine = useCallback(() => {
    setDraft(d => ({
      ...d,
      description: PUNCH_SAMPLE.line,
      location: d.location.trim() ? d.location : PUNCH_SAMPLE.room,
      locationOrigin: d.location.trim() ? d.locationOrigin : 'picked',
    }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
  }, []);
  // 'Do it for me' fills inputs and picks the bundled media; it never presses
  // Save — the save stays his (utils/tutorial/store useTutorialAssist).
  useTutorialAssist('punch.useSamplePhoto', () => { if (onTutorialSample) void acceptSamplePhoto(); });
  useTutorialAssist('punch.useSampleLine', () => { if (onTutorialSample) applySampleLine(); });

  // Tutorial success point for the describe step: the description has
  // settled at 3+ characters (typed, dictated or the sample line). Debounced
  // so it reports a pause, not every keystroke; no timer at all when no
  // tutorial is running.
  useEffect(() => {
    const chars = draft.description.trim().length;
    if (chars < 3 || !isTutorialActive()) return;
    const t = setTimeout(() => tutorialSignal('punch.description.filled', { projectId, chars }), 600);
    return () => clearTimeout(t);
  }, [draft.description, projectId]);

  const handleSave = useCallback(() => {
    // LS-5: belt and braces — the button is off for a viewer, and so is this.
    if (writeBlock) {
      showAlert(t('field.punchWalk.cantSave', "Can't save"), writeBlock);
      return;
    }
    if (!draft.description.trim()) {
      showAlert(t('field.punchWalk.nothingToSave', 'Nothing to save'), t('field.punchWalk.dictateOrTypeA', 'Dictate or type a description first.'));
      return;
    }
    // A new draft: the next item's "where is this" is unanswered.
    pinDecidedRef.current = false;
    const now = new Date().toISOString();
    // Local calendar day, not a UTC slice — an evening walk would otherwise
    // date every item a day late (utils/calendarDate).
    const due = toCalendarDayString(addCalendarDays(new Date(), 7));
    // Exactly the sub the card showed — never a second, unseen guess.
    const sub = walkProposedSub(subChoice, draft.trade, subs, projectId);
    const id = generateUUID();

    const item: PunchItem = {
      id,
      projectId,
      description: draft.description.trim(),
      // '' when no room was given — never the word 'Unspecified' (#56). A
      // placeholder saved into the data reached the export, the filters and
      // the sub's portal as if it were a room; the punch list words an empty
      // location as "No room given" at render time instead.
      location: draft.location.trim(),
      // '' when no sub on this job, never the trade word: "Sub: Electrical"
      // read as an assignment on the list, the filter and the export.
      assignedSub: sub?.companyName ?? '',
      assignedSubId: sub?.id,
      // Who raised it — the delete check (#111) reads this.
      ...(userId ? { createdByUserId: userId } : {}),
      dueDate: due,
      priority: draft.priority,
      status: 'open',
      listType,
      photoUri: draft.photoUri,
      ...(draft.photoStamp ? {
        photoLatitude: draft.photoStamp.latitude,
        photoLongitude: draft.photoStamp.longitude,
        photoLocationAccuracyMeters: draft.photoStamp.accuracyMeters,
        photoLocationLabel: draft.photoStamp.label,
      } : null),
      // planSheetId / pinX / pinY from the pin step; nothing at all when he
      // skipped it, so an unpinned item saves exactly as it always has.
      ...punchPinFields(draft.pin),
      createdAt: now,
      updatedAt: now,
    };
    onAdd(item);
    // Tutorial success point — the real save, right after onAdd. `sheet` is
    // the plan's sheet number when pinned ("pinned on A-101" on the stamp).
    tutorialSignal('punch.saved', {
      projectId,
      itemId: id,
      location: item.location,
      trade: draft.trade,
      pinned: !!item.planSheetId,
      sheet: item.planSheetId
        ? (getPlanSheetsForProject(projectId).find(sh => sh.id === item.planSheetId)?.sheetNumber || draft.pinLabel)
        : undefined,
    });
    const pendingStamp = pendingStampRef.current;
    if (!draft.photoStamp && draft.photoUri && pendingStamp && pendingStamp.shotUri === draft.photoUri) {
      // Saved before the fix arrived: attach the location to THIS item when it
      // comes in. The room he typed stays as saved — a late street label must
      // not overwrite it.
      void pendingStamp.promise.then(stamp => {
        if (!stamp) return;
        // GPS columns only (updatePunchItemPin): the fix can arrive after he
        // has already edited the item, and a whole-row write from this
        // closure's copy would put his edit back.
        updatePunchItemPin(id, {
          photoLatitude: stamp.latitude,
          photoLongitude: stamp.longitude,
          photoLocationAccuracyMeters: stamp.accuracyMeters,
          photoLocationLabel: stamp.label,
        });
      }).catch(() => { /* no fix — saved without a stamp, as before */ });
    }
    pendingStampRef.current = null;

    setSession(s => [{
      id,
      description: item.description,
      location: item.location,
      trade: draft.trade,
      priority: item.priority,
      listType,
      photoUri: item.photoUri,
      pinLabel: item.planSheetId ? draft.pinLabel : undefined,
      capturedAt: now,
    }, ...s]);

    // Reset draft but KEEP the location. The whole point of walk mode
    // is the super stays in one room and captures 5 items before moving.
    // photoStamp is dropped \u2014 next photo gets its own fresh fix. So is the
    // pin: the next defect is somewhere else on the plan, and lastPinSheetId
    // (outside the draft) is what brings the next pin step back to this sheet.
    //
    // The origin drops to 'carried': the room survives, his confirmation of it
    // does not. That is what the banner reads to stop the next item inheriting
    // a corridor he has already walked out of.
    setDraft({
      description: '',
      location: draft.location,
      trade: 'General',
      priority: 'medium',
      locationOrigin: draft.location.trim() ? 'carried' : 'none',
    });
    setSubChoice({ mode: 'auto' });

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Pin first: straight back to the plan for the next spot (the sheet he
    // just used, via lastPinSheetId). A job with no plan he already skipped
    // stays quiet, the same rule as a photo.
    if (pinFirst && shouldAutoOpenPinStep({ pinnableSheetCount: planSheetCount, dismissedNoPlanThisWalk: dismissedNoPlan })) {
      Keyboard.dismiss();
      openPinStep();
    }
  }, [draft, listType, subChoice, subs, userId, projectId, onAdd, updatePunchItemPin, pinFirst, planSheetCount, dismissedNoPlan, openPinStep, getPlanSheetsForProject, writeBlock, t]);

  const handleUndo = useCallback((id: string) => {
    onDelete(id);
    setSession(s => s.filter(c => c.id !== id));
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [onDelete]);

  // ── The active list, stated as facts the app can back ────────────────────
  // "Your client sees this list" is only TRUE when this project's portal is on
  // AND shows the punch list (utils/portalSnapshot renders open formal items
  // only under both). When it is off we say the list is the client-facing one
  // but is not being shown right now — never a claim about payment or
  // retainage, which nothing here gates on punch closure.
  const portal = project?.clientPortal;
  const clientSeesPunch = !!portal?.enabled && !!portal?.showPunchList;
  const isPunch = listType === 'punch';
  const listInk = isPunch ? themeColors.dangerLabel : themeColors.textSecondary;
  const crewFill = neutralInk(themeColors);
  const listStake = isPunch
    ? (clientSeesPunch
        ? t('field.punchWalk.stake.clientSees', 'Your client sees this list in their portal.')
        : t('field.punchWalk.stake.formalNotShown', 'The formal list your client walks. This project’s client portal doesn’t show the punch list.'))
    : t('field.punchWalk.stake.internal', 'Internal. Never shown to your client.');
  const sessionPunchCount = session.filter(c => c.listType === 'punch').length;
  const sessionCrewCount = session.length - sessionPunchCount;

  const priorityColor =
    draft.priority === 'high' ? themeColors.danger :
    draft.priority === 'low' ? themeColors.textSecondary : Colors.warning;

  // The banner states a FACT about where this location came from — it never
  // guesses. 'carried' and 'none' both get the amber label ink: one means he
  // has not confirmed the room for this item, the other means there is no room
  // to confirm. Everything he actually chose reads in accent.
  const locationIsSet = draft.location.trim().length > 0;
  const locationNeedsAttention = !locationIsSet || draft.locationOrigin === 'carried';
  const locationTone = locationNeedsAttention ? themeColors.warningLabel : themeColors.accent;
  // Kept SHORT on purpose. The eyebrow renders uppercase at 1.4 letter-spacing
  // and shares its row with the count; a longer sentence truncates on a 320pt
  // phone, and "CARRIED FROM LAST IT…" is worse than no warning at all.
  const locationEyebrow =
    !locationIsSet ? t('field.punchWalk.location.none', 'No location set')
    : draft.locationOrigin === 'carried' ? t('field.punchWalk.location.carried', 'Carried from last item')
    : draft.locationOrigin === 'gps' ? t('field.punchWalk.location.gps', 'From photo GPS')
    : t('field.punchWalk.location.label', 'Location');

  // Desktop sheets (wave 6c). The punch.modalUp sentinel below still lists
  // exactly these three flags; nothing here adds a Modal.
  const isDesktop = useIsDesktop();
  const fTrade = useSheetFrame('dialog', { visible: showTradeOverride, animationType: 'slide' });
  const fSub = useSheetFrame('dialog', { visible: showSubPicker, animationType: 'slide' });
  const fRooms = useSheetFrame('form', { visible: showAllLocations, animationType: 'slide' });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        {/* backTarget grows the wrapper by 8 on every side and pulls it back
            with a negative margin: the flow size stays 36, but the wrapper is
            now 52 x 52. On iOS (Fabric) a touch outside a parent's bounds never
            reaches the child, so an exact-size wrapper cut the button's
            hitSlop off and shrank its touch area below 44 pt on every walk. */}
        <TutorialTarget id="punch.back" style={styles.backTarget}>
          <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.back', 'Back')}><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        </TutorialTarget>
        <View style={{ flex: 1 }}>
          {/* The eyebrow names the ACTIVE list, in its own ink, so the list is
              readable even with the card scrolled off screen. */}
          <Text style={[styles.headerEyebrow, { color: listInk }]}>
            {pinFirst
              ? (isPunch ? t('field.punchWalk.eyebrow.pinFirstPunch', 'Walk mode · Pin first · Punch list') : t('field.punchWalk.eyebrow.pinFirstCrew', 'Walk mode · Pin first · Crew list'))
              : (isPunch ? t('field.punchWalk.eyebrow.punch', 'Walk mode · Punch list') : t('field.punchWalk.eyebrow.crew', 'Walk mode · Crew list'))}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{projectName}</Text>
        </View>
        {session.length > 0 && (
          <TutorialTarget id="punch.sessionCount">
            <View style={styles.sessionChip}>
              <Text style={styles.sessionChipText}>{session.length}</Text>
            </View>
          </TutorialTarget>
        )}
      </View>

      {/* The contextual tutorial offer (spec entry point 3). WalkInner renders
          only past the Business gate, so a paywalled user gets the Paywall's
          'Try it on a sample first' instead. Quiet once he has started an item
          or saved one this walk; every other rule is in utils/tutorial/offers. */}
      <TutorialOfferChip
        tutorialId="punch-walk"
        projectId={projectId}
        midDraft={!!draft.description.trim() || !!draft.photoUri || session.length > 0}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView ref={walkScrollRef} {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} keyboardShouldPersistTaps="handled">
          <TutorialScrollAnchor scrollRef={walkScrollRef}>

          {/* List — which list this item is filed to. Above the location
              because it is the more expensive mistake: a wrong room is
              findable, a formal item on the internal list is invisible to the
              person who will hold him to it. The card itself changes weight
              with the list: a red edge and tint for the watched punch list, a
              plain card for the crew's working checklist. */}
          <View
            style={[styles.listCard, isPunch ? styles.listCardPunch : styles.listCardCrew]}
            testID={`walk-list-card-${listType}`}
          >
            <View style={styles.listToggle} accessibilityRole="tablist">
              {(['punch', 'crew'] as const).map(l => {
                const active = listType === l;
                const fill = l === 'punch' ? themeColors.danger : crewFill;
                const ink = active ? labelOn(fill) : themeColors.text;
                const Icon = l === 'punch' ? Eye : EyeOff;
                return (
                  <TouchableOpacity
                    key={l}
                    style={[styles.listSeg, isDesktop && segmentedDesktop.segment, active && { backgroundColor: fill }]}
                    onPress={() => handlePickList(l)}
                    activeOpacity={0.85}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={l === 'punch'
                      ? (clientSeesPunch ? t('field.punchWalk.tab.punchClientSees', 'Punch list, your client sees this list') : t('field.punchWalk.tab.punchClientFacing', 'Punch list, client-facing'))
                      : t('field.punchWalk.crewListInternalNever', 'Crew list, internal, never shown to your client')}
                    testID={`walk-list-${l}`}
                  >
                    <Icon size={14} color={active ? ink : themeColors.textMuted} strokeWidth={2} />
                    <Text style={[styles.listSegText, { color: ink }]}>
                      {l === 'punch' ? t('field.punchWalk.punchList', 'Punch list') : t('field.punchWalk.crewList', 'Crew list')}
                    </Text>
                    {active && <Check size={13} color={ink} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </View>
            <Text style={[styles.listStake, { color: listInk }]} numberOfLines={2}>
              {listStake}
            </Text>
          </View>

          {/* Location — the context bar he files every item against.
              Three parts, top to bottom: what room this is and how it got
              here, one-tap chips for the rooms this job already has, and the
              free-text input as the escape hatch for one it doesn't. */}
          <View style={[styles.locationCard, locationNeedsAttention && styles.locationCardAttention]}>
            <View style={styles.locationHeadRow}>
              {locationIsSet
                ? <MapPin size={13} color={locationTone} strokeWidth={2} />
                : <AlertTriangle size={13} color={locationTone} strokeWidth={2} />}
              <Text style={[styles.locationEyebrow, { color: locationTone }]} numberOfLines={1}>
                {locationEyebrow}
              </Text>
              {filedHereThisWalk > 0 && (
                <Text style={styles.locationCount}>
                  {t('field.punchWalk.thisWalk', '{n} this walk', { n: filedHereThisWalk })}
                </Text>
              )}
            </View>

            {/* Chips. Recency-ordered by utils/punchLocations, so the room he
                is standing in stays leftmost as he saves. */}
            {railOptions.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                // Without this a chip tap while the keyboard is open only
                // dismisses the keyboard — the first tap of two, with gloves on.
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.chipRail}
              >
                {railOptions.map(o => {
                  const isActive = o.key === activeLocationKey;
                  return (
                    <TouchableOpacity
                      key={o.key}
                      style={[styles.locChip, isActive && styles.locChipActive]}
                      onPress={() => handlePickLocation(o.label)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isActive }}
                      accessibilityLabel={o.source === 'plan'
                        ? t('field.punchWalk.fromYourPlansNo', '{label}, from your plans, no punch items yet', { label: o.label })
                        : tn('field.punchWalk.punchItems', o.count, { one: '{label}, {count} punch item', other: '{label}, {count} punch items' }, { label: o.label })}
                      testID={`walk-location-chip-${o.key}`}
                    >
                      {/* A plan room has no count to show — the icon says why
                          the number is missing instead of printing a bare 0. */}
                      {o.source === 'plan' && (
                        <PlanRoomIcon
                          size={11}
                          color={isActive ? ON_ACCENT_INK : themeColors.textMuted}
                          strokeWidth={2}
                        />
                      )}
                      <Text style={[styles.locChipText, isActive && styles.locChipTextActive]} numberOfLines={1}>
                        {o.label}
                      </Text>
                      {o.count > 0 && (
                        <Text style={[styles.locChipCount, isActive && styles.locChipTextActive]}>
                          {o.count}
                        </Text>
                      )}
                      {isActive && <Check size={11} color={ON_ACCENT_INK} strokeWidth={2.5} />}
                    </TouchableOpacity>
                  );
                })}
                {locationOptions.length > railOptions.length && (
                  <TouchableOpacity
                    style={styles.locChipAll}
                    onPress={() => setShowAllLocations(true)}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t('field.punchWalk.showAllRoomsOn', 'Show all {length} rooms on this project', { length: locationOptions.length })}
                    testID="walk-location-all"
                  >
                    <Text style={styles.locChipAllText}>{t('field.punchWalk.all', 'All {length}', { length: locationOptions.length })}</Text>
                    <ChevronRight size={11} color={themeColors.accent} strokeWidth={2} />
                  </TouchableOpacity>
                )}
              </ScrollView>
            ) : (
              // No punch items yet and no analysed plans. Say what will fix it
              // rather than showing an empty strip that looks broken.
              <Text style={styles.chipRailEmpty}>
                {t('field.punchWalk.noRoomsOnThis', 'No rooms on this project yet — type one below and it becomes a one-tap chip.')}
              </Text>
            )}

            <View style={styles.locationInputRow}>
              <TextInput
                style={styles.locationInput}
                value={draft.location}
                onChangeText={(v) => setDraft(d => ({
                  ...d,
                  location: v,
                  // Typing is him setting the room for THIS item, so it stops
                  // reading as carried forward the moment he touches it.
                  locationOrigin: v.trim() ? 'typed' : 'none',
                }))}
                placeholder={t('field.punchWalk.typeARoomE', 'Type a room (e.g. Hall 2, Unit 204, Kitchen)')}
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="words"
                testID="walk-location"
              />
              {draft.location.length > 0 && (
                <TouchableOpacity onPress={handleClearLocation} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.clearLocation', 'Clear location')}>
                  <X size={15} color={themeColors.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>

            {!locationIsSet && (
              <Text style={styles.locationWarnNote}>
                {t('field.punchWalk.noRoomGivenIt', 'No room given — it won’t group with a room on the punch list or in a sub’s handoff, and a sub’s portal will say “No room given”.')}
              </Text>
            )}
          </View>

          {/* Description — the big centerpiece */}
          <View style={styles.descCard}>
            <TutorialTarget id="punch.description">
            <TextInput
              style={styles.descInput}
              value={draft.description}
              onChangeText={(v) => setDraft(d => ({ ...d, description: v }))}
              placeholder={t('field.punchWalk.whatsTheIssueTap', 'What’s the issue?\nTap mic and talk, or type here.')}
              placeholderTextColor={themeColors.textMuted}
              multiline
              autoCapitalize="sentences"
              testID="walk-description"
            />
            {/* The tutorial's sample line — only while its step is live on the
                sample job. Deterministic: no AI call, no credits. */}
            {showSampleLine ? (
              <TouchableOpacity
                style={styles.sampleChip}
                onPress={applySampleLine}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('field.punchWalk.useTheSampleLine', 'Use the sample line: {line}', { line: PUNCH_SAMPLE.line })}
                testID="walk-sample-line"
              >
                <Text style={styles.sampleChipLabel}>{t('field.punchWalk.sampleLine', 'Sample line')}</Text>
                <Text style={styles.sampleChipText} numberOfLines={2}>{'“'}{PUNCH_SAMPLE.line}{'”'}</Text>
              </TouchableOpacity>
            ) : null}
            </TutorialTarget>

            {/* Inferred-trade + priority badges */}
            <View style={styles.metaRow}>
              <TouchableOpacity style={styles.metaChip} onPress={cycleTrade}>
                <View style={[styles.metaDot, { backgroundColor: tradeColor(draft.trade, themeColors) }]} />
                <Text style={styles.metaChipText}>{subTradeLabel(draft.trade)}</Text>
                {draft.matchedKeyword && (
                  <Text style={styles.metaChipHint}>· {draft.matchedKeyword}</Text>
                )}
                <ChevronRight size={10} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.metaChip, { backgroundColor: `${priorityColor}18` }]} onPress={cyclePriority}>
                <Flag size={11} color={priorityColor} strokeWidth={1.75} />
                <Text style={[styles.metaChipText, { color: priorityColor }]}>{priorityLabel(draft.priority).toUpperCase()}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.metaChipGhost} onPress={() => setShowTradeOverride(true)}>
                <Text style={styles.metaChipGhostText}>{t('field.punchWalk.pickTrade', 'Pick trade')}</Text>
              </TouchableOpacity>
            </View>

            {/* Who it goes to — shown BEFORE save, so what is saved is what he
                saw. Only subs on this job are ever proposed; tap to change or
                clear. On someone else's job the list is the owner's subs. */}
            <TouchableOpacity
              style={styles.subLine}
              onPress={() => {
                if (projectSubs.isError) { projectSubs.refetch(); return; }
                setShowSubPicker(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={proposedSub ? t('field.punchWalk.assignedToChangeOr', 'Assigned to {companyName}. Change or clear', { companyName: proposedSub.companyName }) : t('field.punchWalk.noSubAssignedPick', 'No sub assigned. Pick one')}
              testID="walk-sub-line"
            >
              <Text style={[styles.subLineText, !proposedSub && styles.subLineMuted]} numberOfLines={2}>
                {projectSubs.isLoading
                  ? (projectSubs.isOwner ? t('field.punchWalk.checkingYourSubs', 'Checking your subs…') : t('field.punchWalk.loadingYourGcsSubs', 'Loading your GC’s subs on this project…'))
                  : projectSubs.isError
                    ? t('field.punchWalk.couldntLoadSubsTap', 'Couldn’t load subs. Tap to retry. The item saves unassigned.')
                    : proposedSub
                      ? t('field.punchWalk.onThisProject', '→ {companyName} (on this project)', { companyName: proposedSub.companyName })
                      : subChoice.mode === 'none'
                        ? t('field.punchWalk.noSubSavesUnassigned', 'No sub · Saves unassigned')
                        : projectSubs.isOwner
                          ? (draft.trade === 'General'
                            ? t('field.punchWalk.sub.noneOnProject', 'No sub on this project')
                            : t('field.punchWalk.sub.noTradeOnProject', 'No {trade} sub on this project', { trade: subTradeLabel(draft.trade) }))
                          : t('field.punchWalk.tradeGcToAssign', 'Trade: {trade} — GC to assign', { trade: subTradeLabel(draft.trade) })}
              </Text>
              {!projectSubs.isLoading && !projectSubs.isError ? (
                <Text style={styles.subLineAction}>{proposedSub ? t('field.punchWalk.change', 'Change') : t('field.punchWalk.pick', 'Pick')}</Text>
              ) : null}
            </TouchableOpacity>

            {/* Preview photo */}
            {draft.photoUri && (
              <View style={styles.photoPreview}>
                <Image source={{ uri: draft.photoUri }} style={styles.photoImg} />
                <TouchableOpacity style={styles.photoRemove} onPress={() => setDraft(d => ({ ...d, photoUri: undefined }))} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.close', 'Close')}>
                  <X size={12} color="#fff" strokeWidth={1.75} />
                </TouchableOpacity>
              </View>
            )}

            {/* The pin. Tapping the chip re-opens the step on the same sheet
                with the pin where he left it, so a wrong spot is fixed without
                retaking the photo. Unpinned-with-a-photo offers the step back
                (after a Skip, or on a job where it did not open by itself). */}
            {draft.pin ? (
              <View style={styles.pinRow}>
                <TouchableOpacity
                  style={styles.pinChip}
                  onPress={openPinStep}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={draft.pinLabel
                    ? t('field.punchWalk.pin.chipA11y', 'Pinned on {sheet}. Change the pin', { sheet: draft.pinLabel })
                    : t('field.punchWalk.pin.chipA11yNoSheet', 'Pinned on plan. Change the pin')}
                  testID="walk-pin-chip"
                >
                  <MapPin size={12} color={ON_ACCENT_INK} strokeWidth={2.5} />
                  <Text style={styles.pinChipText} numberOfLines={1}>{draft.pinLabel
                    ? sentenceParts(t('field.punchWalk.pin.chip', 'Pinned on {sheet}', { sheet: '{sheet}' }), { sheet: draft.pinLabel })
                    : t('field.punchWalk.pin.chipNoSheet', 'Pinned on plan')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRemovePin}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={t('field.punchWalk.removeThePin', 'Remove the pin')}
                  testID="walk-pin-remove"
                >
                  <X size={15} color={themeColors.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            ) : draft.photoUri ? (
              <TouchableOpacity
                style={styles.pinAdd}
                onPress={openPinStep}
                accessibilityRole="button"
                accessibilityLabel={t('field.punchWalk.pinThisItemOn', 'Pin this item on the plan')}
                testID="walk-pin-open"
              >
                <MapPin size={12} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.pinAddText}>{t('field.punchWalk.notPinnedPinOn', 'Not pinned · Pin on plan')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Action bar */}
          <View style={styles.actionRow}>
            <View style={styles.voiceWrap}>
              <VoiceRecorder
                onTranscriptReady={handleTranscript}
                isLoading={isTranscribing}
                title={t('field.punchWalk.captureAPunchItem', 'Capture a punch item')}
                contextLine={projectName ? t('field.punchWalk.voice.forProject', 'for {projectName}', { projectName }) : undefined}
                suggestions={[
                  t('field.punchWalk.voice.example1', 'Master bath, light fixture loose'),
                  t('field.punchWalk.voice.example2', 'Hallway 2, paint touch-up near the door frame'),
                  t('field.punchWalk.voice.example3', 'Kitchen, GFCI outlet not working'),
                  t('field.punchWalk.voice.example4', 'Front door, weather strip torn — replace before final walk'),
                ]}
              />
            </View>
            {/* Pin first, before the spot is set: the plan is the next thing. */}
            {pinFirst && !draft.pin && !draft.photoUri && (
              <TouchableOpacity
                style={styles.cameraBtn}
                onPress={openPinStep}
                accessibilityRole="button"
                accessibilityLabel={t('field.punchWalk.pinTheNextItem', 'Pin the next item on the plan, then take its photo')}
                testID="walk-pin-first-open"
              >
                <MapPinPlus size={18} color={themeColors.text} strokeWidth={1.75} />
                <Text style={styles.cameraBtnText}>{t('field.punchWalk.pinNextItem', 'Pin next item')}</Text>
              </TouchableOpacity>
            )}
            {/* Pinned first, no photo yet: the photo is the next action (and the
                way back if the camera never came up). */}
            <TutorialTarget id="punch.camera">
            {pinFirst && draft.pin && !draft.photoUri ? (
              <TouchableOpacity
                style={[styles.cameraBtn, styles.cameraBtnEmphasis]}
                onPress={handleCamera}
                accessibilityRole="button"
                accessibilityLabel={Platform.OS === 'web' ? t('field.punchWalk.addThePhotoFor', 'Add the photo for this item') : t('field.punchWalk.takeThePhotoFor', 'Take the photo for this item')}
                testID="walk-camera"
              >
                <Camera size={18} color={Colors.textOnAccent} strokeWidth={2} />
                {/* Web opens a file picker, not a camera — don't promise one. */}
                <Text style={[styles.cameraBtnText, styles.cameraBtnTextEmphasis]}>{Platform.OS === 'web' ? t('field.punchWalk.addPhoto', 'Add photo') : t('field.punchWalk.takePhoto', 'Take photo')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.takeAPhotoThen', 'Take a photo, then pin it on the plan')} testID="walk-camera">
                <Camera size={18} color={themeColors.text} strokeWidth={1.75} />
                <Text style={styles.cameraBtnText}>{t('field.punchWalk.photo', 'Photo')}</Text>
              </TouchableOpacity>
            )}
            {/* The tutorial's sample photo — only while its step is live on the
                sample job. An illustration, labelled as one. */}
            {showSamplePhoto ? (
              <TouchableOpacity
                style={styles.sampleChip}
                onPress={() => { void acceptSamplePhoto(); }}
                disabled={samplePhotoBusy}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={t('field.punchWalk.useTheSamplePhoto', 'Use the sample photo, an illustration of an outlet with no cover')}
                testID="walk-sample-photo"
              >
                <Text style={styles.sampleChipText}>{samplePhotoBusy ? t('field.punchWalk.loading', 'Loading…') : t('field.punchWalk.useSamplePhoto', 'Use sample photo')}</Text>
              </TouchableOpacity>
            ) : null}
            </TutorialTarget>
          </View>

          {/* Which comes first. Pin first puts the plan up before the camera
              and brings it back after every save. */}
          <TouchableOpacity
            style={styles.pinFirstToggle}
            onPress={() => setPinFirst(v => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: pinFirst }}
            accessibilityLabel={pinFirst ? t('field.punchWalk.pinFirstIsOn', 'Pin first is on: tap the plan before the photo') : t('field.punchWalk.pinFirstIsOff', 'Pin first is off: photo, then pin')}
            testID="walk-pin-first-toggle"
          >
            <MapPinPlus size={14} color={pinFirst ? themeColors.accentLabel : themeColors.textMuted} strokeWidth={2} />
            <Text style={[styles.pinFirstToggleText, pinFirst && { color: themeColors.accentLabel }]}>
              {pinFirst ? t('field.punchWalk.pinFirstIsOn', 'Pin first is on: tap the plan before the photo') : t('field.punchWalk.pinFirstIsOff', 'Pin first is off: photo, then pin')}
            </Text>
          </TouchableOpacity>

          {/* AI Punch from Photos — turns a walkthrough into a punch
              list in one tap. Pick photos → AI returns items → review
              + bulk save. Sits below the manual draft so the GC sees
              it as an alternate path, not a replacement. */}
          <TouchableOpacity
            style={styles.aiPunchBtn}
            onPress={() => router.push({ pathname: '/ai-punch' as never, params: { projectId } as never })}
            activeOpacity={0.85}
          >
            <MageAIMark size={16} color={themeColors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.aiPunchBtnTitle}>{t('field.punchWalk.punchFromPhotos', 'Punch from photos')}</Text>
              <Text style={styles.aiPunchBtnSub}>{t('field.punchWalk.takeAFewPhotos', 'Take a few photos. MAGE drafts the punch items.')}</Text>
            </View>
            <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>

          {/* Photo Triage — broader sibling that doesn't assume the
              user is in punch-list mode. AI sorts each photo across
              punch / RFI / DFR / progress / noise so a single batch
              from a site walk lands records in the right places. */}
          <TouchableOpacity
            style={styles.aiPunchBtn}
            onPress={() => router.push({ pathname: '/photo-triage' as never, params: { projectId } as never })}
            activeOpacity={0.85}
          >
            <MageAIMark size={16} color={themeColors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.aiPunchBtnTitle}>{t('field.punchWalk.photoTriage', 'Photo triage')}</Text>
              <Text style={styles.aiPunchBtnSub}>{t('field.punchWalk.mixedBatchSortsTo', 'Mixed batch — sorts to punch, RFI, daily report, progress')}</Text>
            </View>
            <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>

          <TutorialTarget id="punch.save">
          <TouchableOpacity
            style={[styles.saveBtn, (!draft.description.trim() || !!writeBlock) && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!draft.description.trim() || !!writeBlock}
            activeOpacity={0.85}
            testID="walk-save"
          >
            <Check size={18} color={'#FFFFFF'} strokeWidth={1.75} />
            {/* Names the list, so the last thing he reads before the tap is
                where the item is going. */}
            <Text style={styles.saveBtnText}>{isPunch ? t('field.punchWalk.saveToPunch', 'Save to punch list') : t('field.punchWalk.saveToCrew', 'Save to crew list')}</Text>
          </TouchableOpacity>
          </TutorialTarget>
          {/* LS-5: a viewer seat cannot file — the control says why. */}
          {writeBlock ? <Text style={styles.hint} testID="walk-viewer-block">{writeBlock}</Text> : null}

          {pinFirst && (
            <Text style={styles.hint}>
              {t('field.punchWalk.pinFirstTapThe', 'Pin first: tap the spot, the camera opens, then say what’s wrong. Save opens the plan for the next one.')}
            </Text>
          )}
          <Text style={styles.hint}>
            {t('field.punchWalk.theListAndThe', 'The list and the room stay between saves; the room is labelled “carried” until you confirm it — tap a chip when you move, X to clear. Mic appends to the description so you can keep dictating.')}
          </Text>

          {/* Session roll-up */}
          {session.length > 0 && (
            <View style={styles.sessionCard}>
              <Text style={styles.sessionTitle}>
                {t('field.punchWalk.capturedThisWalkPunch', 'Captured this walk · {p} punch · {c} crew', { p: sessionPunchCount, c: sessionCrewCount })}
              </Text>
              {session.map(c => (
                <View key={c.id} style={styles.sessionRow}>
                  <View style={[styles.sessionDot, { backgroundColor: tradeColor(c.trade, themeColors) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionDesc} numberOfLines={2}>{c.description}</Text>
                    <Text style={styles.sessionMeta}>
                      <Text style={{ color: c.listType === 'punch' ? themeColors.dangerLabel : themeColors.textSecondary, fontWeight: '700' }}>
                        {c.listType === 'punch' ? t('field.punchWalk.punch', 'Punch') : t('field.punchWalk.crew', 'Crew')}
                      </Text>
                      {' · '}{punchLocationText(c.location) ?? PUNCH_NO_ROOM_TEXT} · {subTradeLabel(c.trade)} · {priorityLabel(c.priority)}
                      {c.pinLabel ? t('field.punchWalk.session.pinnedOnFact', ' · pinned on {sheet}', { sheet: c.pinLabel }) : ''}
                    </Text>
                  </View>
                  <TouchableOpacity onPress={() => handleUndo(c.id)} hitSlop={12}>
                    <Undo2 size={14} color={themeColors.textMuted} strokeWidth={1.75} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {session.length === 0 && (
            <View style={styles.emptyCard}>
              <Mic size={18} color={themeColors.textMuted} strokeWidth={1.75} />
              <Text style={styles.emptyText}>
                {pinFirst
                  ? t('field.punchWalk.empty.pinFirstIntro', 'Tap where the item is on the plan, take its photo, then say what\u2019s wrong. Save and the plan comes back for the next one. ')
                  : ''}
                {t('field.punchWalk.empty.micHint', 'Tap the mic below and say what you see. Fix the trade or priority later from the punch list.')}
              </Text>
            </View>
          )}
          </TutorialScrollAnchor>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Pin step — photo, then pin, then description. */}
      <PlanPinStep
        visible={pinStepOpen}
        projectId={projectId}
        photoUri={draft.photoUri}
        initialPin={draft.pin ?? null}
        sessionSheetId={lastPinSheetId}
        sessionItemIds={sessionItemIds}
        onNext={handlePinNext}
        onSkip={handlePinSkip}
        onClose={() => setPinStepOpen(false)}
        onDismissed={handlePinStepDismissed}
        onImportPdf={() => {
          setPinStepOpen(false);
          runAfterPinStep(() => router.push({ pathname: '/plans' as never, params: { projectId } as never }));
        }}
        importPdfBlockedReason={pdfBlocked}
        {...(pinFirst && !draft.photoUri ? {
          title: t('field.punchWalk.pinFirst.title', 'Where’s the next item?'),
          nextLabel: Platform.OS === 'web' ? t('field.punchWalk.pinFirst.nextWeb', 'Next: add the photo') : t('field.punchWalk.pinFirst.next', 'Next: take the photo'),
          skipLabel: t('field.punchWalk.pinFirst.skip', 'Skip pin'),
          skipHint: Platform.OS === 'web' ? t('field.punchWalk.pinFirst.skipHintWeb', 'Skip pin to add the photo without a pin') : t('field.punchWalk.pinFirst.skipHint', 'Skip pin to take the photo without a pin'),
          closeLabel: t('field.punchWalk.pinFirst.close', 'Back to the walk'),
        } : {})}
      />

      {/* Trade override sheet */}
      <Modal visible={showTradeOverride} animationType={fTrade.animationType} transparent onRequestClose={() => setShowTradeOverride(false)}>
        <View style={[styles.modalOverlay, fTrade.overlay]}>
          <View style={[styles.modalSheet, fTrade.card]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('field.punchWalk.pickTrade', 'Pick trade')}</Text>
              <TouchableOpacity onPress={() => setShowTradeOverride(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.close', 'Close')}>
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }}>
              {TRADE_ORDER.map(tr => (
                <TouchableOpacity
                  key={tr}
                  style={[styles.tradeOption, draft.trade === tr && styles.tradeOptionActive]}
                  onPress={() => {
                    setDraft(d => ({ ...d, trade: tr, matchedKeyword: undefined }));
                    setShowTradeOverride(false);
                  }}
                >
                  <View style={[styles.metaDot, { backgroundColor: tradeColor(tr, themeColors) }]} />
                  <Text style={styles.tradeOptionText}>{subTradeLabel(tr)}</Text>
                  {draft.trade === tr && <Check size={14} color={themeColors.accent} strokeWidth={1.75} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Sub picker — only subs on this job, plus "no sub". */}
      <Modal visible={showSubPicker} animationType={fSub.animationType} transparent onRequestClose={() => setShowSubPicker(false)}>
        <View style={[styles.modalOverlay, fSub.overlay]}>
          <View style={[styles.modalSheet, fSub.card]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('field.punchWalk.whoFixesThis', 'Who fixes this?')}</Text>
              <TouchableOpacity onPress={() => setShowSubPicker(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.close', 'Close')}>
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }}>
              <TouchableOpacity
                style={[styles.tradeOption, !proposedSub && styles.tradeOptionActive]}
                onPress={() => { setSubChoice({ mode: 'none' }); setShowSubPicker(false); }}
                testID="walk-sub-none"
              >
                <Text style={styles.tradeOptionText}>{projectSubs.isOwner ? t('field.punchWalk.noSubLeaveUnassigned', 'No sub (leave unassigned)') : t('field.punchWalk.noSubYourGc', 'No sub (your GC assigns it)')}</Text>
                {!proposedSub && <Check size={14} color={themeColors.accent} strokeWidth={1.75} />}
              </TouchableOpacity>
              {subsOnJob.map(s => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.tradeOption, proposedSub?.id === s.id && styles.tradeOptionActive]}
                  onPress={() => { setSubChoice({ mode: 'picked', sub: s }); setShowSubPicker(false); }}
                >
                  <Text style={styles.tradeOptionText}>{s.companyName}</Text>
                  <Text style={styles.subOptionTrade}>{s.trade}</Text>
                  {proposedSub?.id === s.id && <Check size={14} color={themeColors.accent} strokeWidth={1.75} />}
                </TouchableOpacity>
              ))}
              {subsOnJob.length === 0 ? (
                <Text style={styles.subPickerEmpty}>
                  {projectSubs.isOwner
                    ? t('field.punchWalk.noSubsAreAssigned', 'No subs are assigned to this project yet. Add them under Subs, then they show here.')
                    : t('field.punchWalk.yourGcHasNo', 'Your GC has no subs assigned to this project yet. The item saves unassigned and your GC assigns it.')}
                </Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* All-rooms sheet — the overflow behind the chip rail. Every location
          this job has, in the same order, with the counts spelled out so he
          can tell a room he has already worked from one he hasn't. */}
      <Modal visible={showAllLocations} animationType={fRooms.animationType} transparent onRequestClose={() => setShowAllLocations(false)}>
        <View style={[styles.modalOverlay, fRooms.overlay]}>
          <View style={[styles.modalSheet, fRooms.card]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('field.punchWalk.roomsOnThisProject', 'Rooms on this project')}</Text>
              <TouchableOpacity onPress={() => setShowAllLocations(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.close', 'Close')}>
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
              {locationIsSet && (
                <TouchableOpacity
                  style={styles.locRow}
                  onPress={handleClearLocation}
                  accessibilityRole="button"
                  accessibilityLabel={t('field.punchWalk.clearTheLocationOn', 'Clear the location on this item')}
                >
                  <X size={14} color={themeColors.textMuted} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.locRowTitle}>{t('field.punchWalk.noLocation', 'No location')}</Text>
                    <Text style={styles.locRowSub}>{t('field.punchWalk.savesWithNoRoom', 'Saves with no room given')}</Text>
                  </View>
                </TouchableOpacity>
              )}
              {locationOptions.map(o => {
                const isActive = o.key === activeLocationKey;
                return (
                  <TouchableOpacity
                    key={o.key}
                    style={[styles.locRow, isActive && styles.locRowActive]}
                    onPress={() => handlePickLocation(o.label)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={o.label}
                  >
                    {o.source === 'plan'
                      ? <PlanRoomIcon size={14} color={themeColors.textMuted} strokeWidth={2} />
                      : <MapPin size={14} color={themeColors.accent} strokeWidth={2} />}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.locRowTitle} numberOfLines={1}>{o.label}</Text>
                      <Text style={styles.locRowSub}>{describeLocationOption(o)}</Text>
                    </View>
                    {isActive && <Check size={14} color={themeColors.accent} strokeWidth={2.5} />}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      {/* Tutorial blocker: these sheets have no tutorial layer and draw ABOVE
          the root one on iOS, so while any is up the coach draws nothing
          rather than a dim and a card behind the sheet. (PlanPinStep is not
          here: it hosts its own planPin layer.) Zero-size, inert. */}
      {(showTradeOverride || showSubPicker || showAllLocations) ? <TutorialTarget id="punch.modalUp" /> : null}
    </View>
  );
}

/**
 * A translated sentence as React children, split at its {placeholders}: one
 * child per value and per run of words, exactly as the pre-i18n JSX rendered
 * (the phone goldens record one line per string child). The sentence is still
 * ONE key. (Same helper as components/home/DailyLogCard.tsx.)
 */
function sentenceParts(template: string, values: Record<string, string | number>): (string | number)[] {
  const out: (string | number)[] = [];
  let last = 0;
  template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m: string, name: string, at: number) => {
    if (at > last) out.push(template.slice(last, at));
    out.push(Object.prototype.hasOwnProperty.call(values, name) ? values[name] : m);
    last = at + m.length;
    return m;
  });
  if (last < template.length) out.push(template.slice(last));
  return out;
}

/**
 * The sub-line under a room in the All-rooms sheet. Only counts that exist —
 * a plan room genuinely has no items, and printing "0 items" for it would read
 * as a finished room rather than an untouched one.
 */
function describeLocationOption(o: PunchLocationOption): string {
  if (o.source === 'plan') return t('field.punchWalk.rooms.fromPlans', 'From your plans · nothing filed here yet');
  // A list of facts joined by ' · ', never one sentence: each fact is its own key.
  const facts = [
    tn('field.punchWalk.rooms.items', o.count, { one: '{count} item', other: '{count} items' }),
    o.openCount > 0
      ? tn('field.punchWalk.rooms.open', o.openCount, { one: '{count} open', other: '{count} open' })
      : t('field.punchWalk.rooms.allClosed', 'all closed'),
    ...(o.onPlan ? [t('field.punchWalk.rooms.onPlans', 'on your plans')] : []),
  ];
  return facts.join(' · ');
}

// ─────────────────────────────────────────────────────────────
// Project picker (when opened without a projectId)

function ProjectPicker({ projects, onPick, onBack }: {
  projects: { id: string; name: string; status?: string }[];
  onPick: (projectId: string) => void;
  onBack: () => void;
}) {
  const { t } = useT();
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('field.punchWalk.back', 'Back')}><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>{t('field.punchWalk.walkModePunch', 'Walk mode · Punch')}</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{t('field.punchWalk.pickAProject', 'Pick a project')}</Text>
        </View>
      </View>
      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertTriangle size={18} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.emptyText}>{t('field.punchWalk.noProjectsOnFile', 'No projects on file. Create one first, then come back to walk punch items.')}</Text>
          </View>
        ) : (
          projects.map(p => (
            <TouchableOpacity key={p.id} style={styles.pickerRow} onPress={() => onPick(p.id)}>
              <Plus size={14} color={themeColors.accent} strokeWidth={1.75} />
              <View style={{ flex: 1 }}>
                <Text style={styles.pickerRowTitle}>{p.name}</Text>
                {p.status && <Text style={styles.pickerRowSub}>{p.status}</Text>}
              </View>
              <ChevronRight size={14} color={themeColors.textMuted} strokeWidth={1.75} />
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────

function tradeColor(trade: SubTrade, t: ThemeColors): string {
  switch (trade) {
    case 'Electrical': return '#F59E0B';
    case 'Plumbing':   return '#3B82F6';
    case 'HVAC':       return '#06B6D4';
    case 'Roofing':    return '#5B6470';
    case 'Drywall':    return '#8A8170';
    case 'Painting':   return '#2F6B6B';
    case 'Flooring':   return '#10B981';
    case 'Concrete':   return '#6B7280';
    case 'Framing':    return '#92400E';
    case 'Landscaping': return '#16A34A';
    case 'General':
    case 'Other':
    // neutralInk, not the dark theme's textSecondary this returned: it is a
    // trade DOT, and at #9AA3AD on a light card it was 2.55:1 — under the 3:1
    // floor a non-text indicator has to clear to be seen at all.
    default:           return neutralInk(t);
  }
}

// ─────────────────────────────────────────────────────────────
// Styles

const makeStyles = (t: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: t.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, gap: 8,
    borderBottomWidth: 1, borderBottomColor: t.line,
  },
  headerBtn: {
    width: 36, height: 36, borderRadius: Tokens.radius.xl, alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.surfaceAlt,
  },
  // The punch.back tutorial wrapper: +8 hit area on each side, net flow size
  // unchanged (see the header). 36 + 2*8 = 52 >= Tokens.touchTarget.comfortable.
  backTarget: { margin: -8, padding: 8 },
  headerEyebrow: { fontSize: 10, color: t.accent, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase' },
  headerTitle: { ...Type.serifHeadline, color: t.text },
  sessionChip: {
    minWidth: 28, height: 28, borderRadius: Tokens.radius.lg, paddingHorizontal: 8,
    backgroundColor: t.accentFill, alignItems: 'center', justifyContent: 'center',
  },
  sessionChipText: { color: '#FFFFFF', fontWeight: '800', fontSize: Type.caption1.fontSize },

  // The list card. Punch gets the danger edge and tint — it is the list
  // somebody else is checking. Crew is a plain hairline card on purpose: the
  // point of the split is that chores stop reading as urgent.
  listCard: {
    marginHorizontal: 14, marginTop: 14,
    borderRadius: Tokens.radius.card, padding: 8, gap: 8,
  },
  listCardPunch: { backgroundColor: t.dangerSoft, borderWidth: 1.5, borderColor: t.danger },
  listCardCrew: { backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line },
  listToggle: { flexDirection: 'row', gap: 6 },
  // 44pt tall: this is tapped with a gloved thumb mid-walk.
  listSeg: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, borderRadius: Tokens.radius.md, backgroundColor: Colors.fillSecondary,
  },
  listSegText: { fontSize: Type.footnote.fontSize, fontWeight: '700' },
  listStake: { fontSize: Type.caption1.fontSize, fontWeight: '600', paddingHorizontal: 4, lineHeight: 16 },

  // The location card. A 1.5pt accent edge, not a hairline: this is the field
  // that decides whether a sub can find the defect, and on a bright jobsite
  // screen a hairline border is not a signal at all.
  locationCard: {
    marginHorizontal: 14, marginTop: 14,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card,
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    borderWidth: 1.5, borderColor: t.accent,
  },
  // Carried-forward, or not set at all. Same card, amber edge — he has not
  // confirmed the room for this item.
  locationCardAttention: { borderColor: t.warningLabel },
  locationHeadRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  locationEyebrow: { ...Type.eyebrow, flexShrink: 1 },
  // The anti-drift count, pushed right so it reads as a separate fact from the
  // room name rather than part of the label.
  locationCount: {
    marginLeft: 'auto', fontSize: Type.caption2.fontSize, color: t.textSecondary, fontWeight: '600',
  },

  chipRail: { gap: 6, paddingRight: 4 },
  locChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 9,
    borderRadius: Tokens.radius.full, backgroundColor: Colors.fillSecondary,
    maxWidth: 190,
  },
  locChipActive: { backgroundColor: t.accentFill },
  locChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text, flexShrink: 1 },
  locChipTextActive: { color: ON_ACCENT_INK },
  locChipCount: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textMuted },
  locChipAll: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 11, paddingVertical: 9,
    borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.accent,
  },
  locChipAllText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.accent },
  chipRailEmpty: { fontSize: Type.caption2.fontSize, color: t.textMuted, lineHeight: 15 },

  locationInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: t.line, paddingTop: 8,
  },
  // Bigger and heavier than the old row: the room name is the thing he has to
  // be able to read at a glance between items.
  locationInput: {
    flex: 1, fontSize: Type.subheadline.fontSize, fontWeight: '700', color: t.text,
    paddingVertical: 2,
  },
  locationWarnNote: { fontSize: Type.caption2.fontSize, color: t.warningLabel, lineHeight: 15 },

  locRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: Tokens.radius.md,
  },
  locRowActive: { backgroundColor: `${t.accent}15` },
  locRowTitle: { fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '700' },
  locRowSub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },

  descCard: {
    backgroundColor: Colors.card, borderRadius: Tokens.radius.lg, padding: 16, marginHorizontal: 14, marginTop: 12,
    borderWidth: 1, borderColor: t.line,
  },
  descInput: {
    minHeight: 110, fontSize: Type.subheadline.fontSize, color: t.text, textAlignVertical: 'top',
    lineHeight: 24, fontWeight: '500',
  },

  metaRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  subLine: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
    paddingVertical: 10, paddingHorizontal: 12, minHeight: 44,
    borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt,
  },
  subLineText: { flex: 1, fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  subLineMuted: { color: t.textSecondary, fontWeight: '500' },
  subLineAction: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.accentLabel },
  subOptionTrade: { fontSize: Type.caption1.fontSize, color: t.textSecondary },
  subPickerEmpty: { fontSize: Type.footnote.fontSize, color: t.textSecondary, padding: 14, lineHeight: 19 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: Tokens.radius.sm, backgroundColor: Colors.fillSecondary,
  },
  metaDot: { width: 8, height: 8, borderRadius: 4 },
  metaChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: t.text },
  metaChipHint: { fontSize: 10, color: t.textMuted },
  metaChipGhost: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6 },
  metaChipGhostText: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '600' },

  photoPreview: {
    marginTop: 12, position: 'relative', alignSelf: 'flex-start',
    borderRadius: Tokens.radius.md, overflow: 'hidden',
  },
  photoImg: { width: 110, height: 82, borderRadius: Tokens.radius.md },
  photoRemove: {
    position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center',
  },

  pinRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  pinChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1,
    paddingHorizontal: 11, paddingVertical: 8,
    borderRadius: Tokens.radius.full, backgroundColor: t.accentFill,
  },
  pinChipText: { fontSize: Type.caption1.fontSize, fontWeight: '700', color: ON_ACCENT_INK, flexShrink: 1 },
  pinAdd: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10, alignSelf: 'flex-start', paddingVertical: 6 },
  pinAddText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.accent },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, marginTop: 14 },
  voiceWrap: { flex: 1, alignItems: 'center' },
  cameraBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: Tokens.radius.card, backgroundColor: Colors.fillSecondary,
  },
  cameraBtnText: { fontSize: Type.footnote.fontSize, fontWeight: '700', color: t.text },
  // accentFill is derived to clear contrast against white (constants/colors).
  cameraBtnEmphasis: { backgroundColor: t.accentFill },
  cameraBtnTextEmphasis: { color: Colors.textOnAccent },
  pinFirstToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44,
  },
  pinFirstToggleText: { fontSize: Type.caption1.fontSize, fontWeight: '600', color: t.textSecondary },
  aiPunchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: t.accent + '0F',
    borderRadius: Tokens.radius.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: t.accent + '40',
    marginTop: 10,
  },
  aiPunchBtnTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700' as const, color: t.accent },
  aiPunchBtnSub: { fontSize: Type.caption1.fontSize, color: t.textMuted, marginTop: 2 },

  // The tutorial's sample chips (sample photo, sample line): a plain surface
  // chip — the accent is never the background. Shown only while their step is
  // live on the sample job.
  sampleChip: {
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 8, gap: 2,
    borderRadius: Tokens.radius.md, backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.line,
  },
  sampleChipLabel: { fontSize: Type.caption2.fontSize, fontWeight: '700', color: t.textSecondary, letterSpacing: 0.3 },
  sampleChipText: { fontSize: Type.footnote.fontSize, fontWeight: '600', color: t.text },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginHorizontal: 14, marginTop: 14, paddingVertical: 16, borderRadius: Tokens.radius.lg,
    backgroundColor: t.accentFill,
  },
  saveBtnDisabled: { backgroundColor: t.textMuted },
  saveBtnText: { color: '#FFFFFF', fontWeight: '800', fontSize: Type.subhead.fontSize },

  hint: { fontSize: Type.caption2.fontSize, color: t.textMuted, textAlign: 'center', marginHorizontal: 20, marginTop: 10, lineHeight: 15 },

  sessionCard: {
    marginHorizontal: 14, marginTop: 20, padding: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: t.line,
  },
  sessionTitle: { fontSize: Type.caption2.fontSize, color: t.accent, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1, marginBottom: 10 },
  sessionRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 8, borderTopWidth: 1, borderTopColor: t.line },
  sessionDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  sessionDesc: { fontSize: Type.footnote.fontSize, color: t.text, fontWeight: '600' },
  sessionMeta: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },

  emptyCard: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start',
    marginHorizontal: 14, marginTop: 20, padding: 14, borderRadius: Tokens.radius.lg,
    backgroundColor: Colors.fillSecondary,
  },
  emptyText: { flex: 1, fontSize: Type.caption1.fontSize, color: t.textSecondary, lineHeight: 17 },

  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: Colors.overlay },
  modalSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: t.line },
  modalTitle: { fontSize: Type.subhead.fontSize, fontWeight: '700', color: t.text },
  tradeOption: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: Tokens.radius.md },
  tradeOptionActive: { backgroundColor: `${t.accent}15` },
  tradeOptionText: { flex: 1, fontSize: Type.bodyCompact.fontSize, color: t.text, fontWeight: '600' },

  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
    backgroundColor: Colors.card, borderRadius: Tokens.radius.card, marginBottom: 8,
    borderWidth: 1, borderColor: t.line,
  },
  pickerRowTitle: { fontSize: Type.bodyCompact.fontSize, fontWeight: '700', color: t.text },
  pickerRowSub: { fontSize: Type.caption2.fontSize, color: t.textSecondary, marginTop: 2 },
});
