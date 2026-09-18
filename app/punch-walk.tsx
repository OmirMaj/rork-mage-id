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

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Platform, Modal, Image, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBrainFabScroll, BRAIN_FAB_CLEARANCE } from '@/components/brain/brainFabState';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from 'expo-haptics';
import {
  ChevronLeft, Camera, Mic, Check, X, Undo2, MapPin,
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
import { inferTradeFromText, pickSubForTrade } from '@/utils/tradeInference';
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
import type { PunchItem, PunchItemPriority, PunchListType, SubTrade, Subcontractor } from '@/types';
import { SUB_TRADES } from '@/types';
import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import { neutralInk, labelOn } from '@/components/ui/ink';
import { showAlert } from '@/utils/alert';
import { addCalendarDays, toCalendarDayString } from '@/utils/calendarDate';
import PlanPinStep from '@/components/punch/PlanPinStep';
import {
  durablePinSheetCount, punchPinFields, shouldAutoOpenPinStep, type WalkPin,
} from '@/utils/punchPlanPin';

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
 *   'none'    — empty; the item will save as "Unspecified"
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
  // Walk Mode builds the same punch list the Punch List screen gates behind
  // Business — gate the capture surface too, or a free/Pro user could dictate
  // and save a full list here and only hit the paywall on the read/manage view.
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
  return <PunchWalkScreenInner />;
}

function PunchWalkScreenInner() {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string; list?: string; listType?: string }>();
  const projectId = typeof params.projectId === 'string' ? params.projectId : undefined;
  // `listType` accepted as an alias so a caller spelling it after the field
  // name still lands on the right list.
  const initialList = listFromParam(params.list ?? params.listType);
  const { projects, getProject, subcontractors, addPunchItem, deletePunchItem } = useProjects();

  // If no projectId was passed, show a project picker. Walk mode is
  // always bound to one project — you can't mix items across jobs.
  const project = projectId ? getProject(projectId) : null;

  if (!projectId || !project) {
    // Carry the list through the picker, or opening walk mode from the Crew
    // view without a project would quietly restart him on the punch list.
    return <ProjectPicker projects={projects} onPick={(p) => router.replace({ pathname: '/punch-walk' as never, params: { projectId: p, list: initialList } as never })} onBack={() => router.back()} />;
  }

  return (
    <WalkInner
      projectName={project.name}
      projectId={projectId}
      initialList={initialList}
      subcontractors={subcontractors}
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

function WalkInner({ projectName, projectId, initialList, subcontractors, onAdd, onDelete, onBack }: {
  projectName: string;
  projectId: string;
  initialList: PunchListType;
  subcontractors: Subcontractor[];
  onAdd: (item: PunchItem) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
}) {
  const { colors: themeColors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  // Scrolling down slides the global Brain FAB away so it stops covering
  // row content (iOS visual audit 2026-08-16, defect #5).
  const fabScroll = useBrainFabScroll();
  const router = useRouter();
  // Look up the project for AI-context (description -> location/trade/priority).
  // The voice parser needs the project; `punchItems` feeds the location chips.
  const { getProject, punchItems, getPlanSheetsForProject, updatePunchItem } = useProjects();
  const project = getProject(projectId);

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
        showAlert('Camera access needed', 'Grant camera permission in Settings to attach punch photos.');
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
      if (shouldAutoOpenPinStep({ pinnableSheetCount: planSheetCount, dismissedNoPlanThisWalk: dismissedNoPlan })) {
        if (pinOpenTimerRef.current) clearTimeout(pinOpenTimerRef.current);
        pinOpenTimerRef.current = setTimeout(() => {
          pinOpenTimerRef.current = null;
          setPinStepOpen(true);
        }, Platform.OS === 'ios' ? CAMERA_DISMISS_MS : 0);
      }
    }
  }, [planSheetCount, dismissedNoPlan]);

  const handlePinNext = useCallback((pin: WalkPin, sheetLabel: string) => {
    // Location is left exactly as it is: a point on a drawing is not a room
    // name, and inventing one from coordinates would be a guess he never made.
    setDraft(d => ({ ...d, pin, pinLabel: sheetLabel }));
    setLastPinSheetId(pin.sheetId);
    setPinStepOpen(false);
    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const handlePinSkip = useCallback(({ hadPlan }: { hadPlan: boolean }) => {
    // Skip means "no pin for this item" — including clearing one he placed
    // earlier and came back to change.
    setDraft(d => ({ ...d, pin: undefined, pinLabel: undefined }));
    if (!hadPlan) setDismissedNoPlan(true);
    setPinStepOpen(false);
  }, []);

  const handleRemovePin = useCallback(() => {
    setDraft(d => ({ ...d, pin: undefined, pinLabel: undefined }));
    if (Platform.OS !== 'web') void Haptics.selectionAsync();
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

  const handleSave = useCallback(() => {
    if (!draft.description.trim()) {
      showAlert('Nothing to save', 'Dictate or type a description first.');
      return;
    }
    const now = new Date().toISOString();
    // Local calendar day, not a UTC slice — an evening walk would otherwise
    // date every item a day late (utils/calendarDate).
    const due = toCalendarDayString(addCalendarDays(new Date(), 7));
    const sub = pickSubForTrade(draft.trade, subcontractors, projectId);
    const id = generateUUID();

    const item: PunchItem = {
      id,
      projectId,
      description: draft.description.trim(),
      location: draft.location.trim() || 'Unspecified',
      assignedSub: sub?.companyName ?? draft.trade,
      assignedSubId: sub?.id,
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
    const pendingStamp = pendingStampRef.current;
    if (!draft.photoStamp && draft.photoUri && pendingStamp && pendingStamp.shotUri === draft.photoUri) {
      // Saved before the fix arrived: attach the location to THIS item when it
      // comes in. The room he typed stays as saved — a late street label must
      // not overwrite it.
      void pendingStamp.promise.then(stamp => {
        if (!stamp) return;
        updatePunchItem(id, {
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

    if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [draft, listType, subcontractors, projectId, onAdd, updatePunchItem]);

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
        ? 'Your client sees this list in their portal.'
        : 'The formal list your client walks. Their portal punch list is off for this job.')
    : 'Internal. Never shown to your client.';
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
    !locationIsSet ? 'No location set'
    : draft.locationOrigin === 'carried' ? 'Carried from last item'
    : draft.locationOrigin === 'gps' ? 'From photo GPS'
    : 'Location';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          {/* The eyebrow names the ACTIVE list, in its own ink, so the list is
              readable even with the card scrolled off screen. */}
          <Text style={[styles.headerEyebrow, { color: listInk }]}>
            Walk Mode · {isPunch ? 'Punch list' : 'Crew list'}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>{projectName}</Text>
        </View>
        {session.length > 0 && (
          <View style={styles.sessionChip}>
            <Text style={styles.sessionChipText}>{session.length}</Text>
          </View>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView {...fabScroll} contentContainerStyle={{ paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }} keyboardShouldPersistTaps="handled">

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
                    style={[styles.listSeg, active && { backgroundColor: fill }]}
                    onPress={() => handlePickList(l)}
                    activeOpacity={0.85}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={l === 'punch'
                      ? `Punch list${clientSeesPunch ? ', your client sees this list' : ', client-facing'}`
                      : 'Crew list, internal, never shown to your client'}
                    testID={`walk-list-${l}`}
                  >
                    <Icon size={14} color={active ? ink : themeColors.textMuted} strokeWidth={2} />
                    <Text style={[styles.listSegText, { color: ink }]}>
                      {l === 'punch' ? 'Punch list' : 'Crew list'}
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
                  {filedHereThisWalk} this walk
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
                        ? `${o.label}, from your plans, no punch items yet`
                        : `${o.label}, ${o.count} punch item${o.count === 1 ? '' : 's'}`}
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
                    accessibilityLabel={`Show all ${locationOptions.length} rooms on this job`}
                    testID="walk-location-all"
                  >
                    <Text style={styles.locChipAllText}>All {locationOptions.length}</Text>
                    <ChevronRight size={11} color={themeColors.accent} strokeWidth={2} />
                  </TouchableOpacity>
                )}
              </ScrollView>
            ) : (
              // No punch items yet and no analysed plans. Say what will fix it
              // rather than showing an empty strip that looks broken.
              <Text style={styles.chipRailEmpty}>
                No rooms on this job yet {'—'} type one below and it becomes a one-tap chip.
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
                placeholder="Type a room (e.g. Hall 2, Unit 204, Kitchen)"
                placeholderTextColor={themeColors.textMuted}
                autoCapitalize="words"
                testID="walk-location"
              />
              {draft.location.length > 0 && (
                <TouchableOpacity onPress={handleClearLocation} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear location">
                  <X size={15} color={themeColors.textMuted} strokeWidth={2} />
                </TouchableOpacity>
              )}
            </View>

            {!locationIsSet && (
              <Text style={styles.locationWarnNote}>
                This item files under {'“'}Unspecified{'”'} {'—'} it won{'’'}t group with a room on the punch list or in a sub{'’'}s handoff.
              </Text>
            )}
          </View>

          {/* Description — the big centerpiece */}
          <View style={styles.descCard}>
            <TextInput
              style={styles.descInput}
              value={draft.description}
              onChangeText={(v) => setDraft(d => ({ ...d, description: v }))}
              placeholder={'What\u2019s the issue?\nTap mic and talk, or type here.'}
              placeholderTextColor={themeColors.textMuted}
              multiline
              autoCapitalize="sentences"
              testID="walk-description"
            />

            {/* Inferred-trade + priority badges */}
            <View style={styles.metaRow}>
              <TouchableOpacity style={styles.metaChip} onPress={cycleTrade}>
                <View style={[styles.metaDot, { backgroundColor: tradeColor(draft.trade, themeColors) }]} />
                <Text style={styles.metaChipText}>{draft.trade}</Text>
                {draft.matchedKeyword && (
                  <Text style={styles.metaChipHint}>· {draft.matchedKeyword}</Text>
                )}
                <ChevronRight size={10} color={themeColors.textMuted} strokeWidth={1.75} />
              </TouchableOpacity>

              <TouchableOpacity style={[styles.metaChip, { backgroundColor: `${priorityColor}18` }]} onPress={cyclePriority}>
                <Flag size={11} color={priorityColor} strokeWidth={1.75} />
                <Text style={[styles.metaChipText, { color: priorityColor }]}>{draft.priority.toUpperCase()}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.metaChipGhost} onPress={() => setShowTradeOverride(true)}>
                <Text style={styles.metaChipGhostText}>Pick trade</Text>
              </TouchableOpacity>
            </View>

            {/* Preview photo */}
            {draft.photoUri && (
              <View style={styles.photoPreview}>
                <Image source={{ uri: draft.photoUri }} style={styles.photoImg} />
                <TouchableOpacity style={styles.photoRemove} onPress={() => setDraft(d => ({ ...d, photoUri: undefined }))} accessibilityRole="button" accessibilityLabel="Close">
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
                  accessibilityLabel={`Pinned on ${draft.pinLabel ?? 'plan'}. Change the pin`}
                  testID="walk-pin-chip"
                >
                  <MapPin size={12} color={ON_ACCENT_INK} strokeWidth={2.5} />
                  <Text style={styles.pinChipText} numberOfLines={1}>Pinned on {draft.pinLabel ?? 'plan'}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleRemovePin}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Remove the pin"
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
                accessibilityLabel="Pin this item on the plan"
                testID="walk-pin-open"
              >
                <MapPin size={12} color={themeColors.accent} strokeWidth={2} />
                <Text style={styles.pinAddText}>Not pinned {'·'} Pin on plan</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/* Action bar */}
          <View style={styles.actionRow}>
            <View style={styles.voiceWrap}>
              <VoiceRecorder
                onTranscriptReady={handleTranscript}
                isLoading={isTranscribing}
                title="Capture a punch item"
                contextLine={projectName ? `for ${projectName}` : undefined}
                suggestions={[
                  'Master bath, light fixture loose',
                  'Hallway 2, paint touch-up near the door frame',
                  'Kitchen, GFCI outlet not working',
                  'Front door, weather strip torn — replace before final walk',
                ]}
              />
            </View>
            <TouchableOpacity style={styles.cameraBtn} onPress={handleCamera} accessibilityRole="button" accessibilityLabel="Take a photo, then pin it on the plan" testID="walk-camera">
              <Camera size={18} color={themeColors.text} strokeWidth={1.75} />
              <Text style={styles.cameraBtnText}>Photo</Text>
            </TouchableOpacity>
          </View>

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
              <Text style={styles.aiPunchBtnTitle}>AI Punch from Photos</Text>
              <Text style={styles.aiPunchBtnSub}>Take a few photos, AI builds the punch list</Text>
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
              <Text style={styles.aiPunchBtnTitle}>AI Photo Triage</Text>
              <Text style={styles.aiPunchBtnSub}>Mixed batch — sorts to punch, RFI, daily report, progress</Text>
            </View>
            <ChevronRight size={16} color={themeColors.accent} strokeWidth={1.75} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.saveBtn, !draft.description.trim() && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={!draft.description.trim()}
            activeOpacity={0.85}
            testID="walk-save"
          >
            <Check size={18} color={'#FFFFFF'} strokeWidth={1.75} />
            {/* Names the list, so the last thing he reads before the tap is
                where the item is going. */}
            <Text style={styles.saveBtnText}>Save to {isPunch ? 'punch list' : 'crew list'}</Text>
          </TouchableOpacity>

          <Text style={styles.hint}>
            The list and the room stay between saves; the room is labelled {'“'}carried{'”'} until you confirm it {'—'} tap a chip when you move, X to clear. Mic appends to the description so you can keep dictating.
          </Text>

          {/* Session roll-up */}
          {session.length > 0 && (
            <View style={styles.sessionCard}>
              <Text style={styles.sessionTitle}>
                Captured this walk · {sessionPunchCount} punch · {sessionCrewCount} crew
              </Text>
              {session.map(c => (
                <View key={c.id} style={styles.sessionRow}>
                  <View style={[styles.sessionDot, { backgroundColor: tradeColor(c.trade, themeColors) }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sessionDesc} numberOfLines={2}>{c.description}</Text>
                    <Text style={styles.sessionMeta}>
                      <Text style={{ color: c.listType === 'punch' ? themeColors.dangerLabel : themeColors.textSecondary, fontWeight: '700' }}>
                        {c.listType === 'punch' ? 'Punch' : 'Crew'}
                      </Text>
                      {' · '}{c.location} · {c.trade} · {c.priority}
                      {c.pinLabel ? ` · pinned on ${c.pinLabel}` : ''}
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
                Tap the mic below and say what you see. Walk mode is built for capturing 30 items in 10 minutes — don{'\u2019'}t worry about getting the trade or priority right, you can fix them later from the punch list screen.
              </Text>
            </View>
          )}
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
      />

      {/* Trade override sheet */}
      <Modal visible={showTradeOverride} animationType="slide" transparent onRequestClose={() => setShowTradeOverride(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Pick trade</Text>
              <TouchableOpacity onPress={() => setShowTradeOverride(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }}>
              {TRADE_ORDER.map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.tradeOption, draft.trade === t && styles.tradeOptionActive]}
                  onPress={() => {
                    setDraft(d => ({ ...d, trade: t, matchedKeyword: undefined }));
                    setShowTradeOverride(false);
                  }}
                >
                  <View style={[styles.metaDot, { backgroundColor: tradeColor(t, themeColors) }]} />
                  <Text style={styles.tradeOptionText}>{t}</Text>
                  {draft.trade === t && <Check size={14} color={themeColors.accent} strokeWidth={1.75} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* All-rooms sheet — the overflow behind the chip rail. Every location
          this job has, in the same order, with the counts spelled out so he
          can tell a room he has already worked from one he hasn't. */}
      <Modal visible={showAllLocations} animationType="slide" transparent onRequestClose={() => setShowAllLocations(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Rooms on this job</Text>
              <TouchableOpacity onPress={() => setShowAllLocations(false)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
                <X size={18} color={themeColors.text} strokeWidth={1.75} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 12 }} keyboardShouldPersistTaps="handled">
              {locationIsSet && (
                <TouchableOpacity
                  style={styles.locRow}
                  onPress={handleClearLocation}
                  accessibilityRole="button"
                  accessibilityLabel="Clear the location on this item"
                >
                  <X size={14} color={themeColors.textMuted} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.locRowTitle}>No location</Text>
                    <Text style={styles.locRowSub}>Files under {'“'}Unspecified{'”'}</Text>
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
    </View>
  );
}

/**
 * The sub-line under a room in the All-rooms sheet. Only counts that exist —
 * a plan room genuinely has no items, and printing "0 items" for it would read
 * as a finished room rather than an untouched one.
 */
function describeLocationOption(o: PunchLocationOption): string {
  if (o.source === 'plan') return 'From your plans · nothing filed here yet';
  const items = `${o.count} item${o.count === 1 ? '' : 's'}`;
  const open = o.openCount > 0 ? `${o.openCount} open` : 'all closed';
  return o.onPlan ? `${items} · ${open} · on your plans` : `${items} · ${open}`;
}

// ─────────────────────────────────────────────────────────────
// Project picker (when opened without a projectId)

function ProjectPicker({ projects, onPick, onBack }: {
  projects: { id: string; name: string; status?: string }[];
  onPick: (projectId: string) => void;
  onBack: () => void;
}) {
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
        <TouchableOpacity onPress={onBack} style={styles.headerBtn} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back"><ChevronLeft size={22} color={themeColors.text} strokeWidth={1.75} /></TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerEyebrow}>Walk Mode · Punch</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Pick a project</Text>
        </View>
      </View>
      <ScrollView {...fabScroll} contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + BRAIN_FAB_CLEARANCE }}>
        {projects.length === 0 ? (
          <View style={styles.emptyCard}>
            <AlertTriangle size={18} color={Colors.warningLabel} strokeWidth={1.75} />
            <Text style={styles.emptyText}>No projects on file. Create one first, then come back to walk punch items.</Text>
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
