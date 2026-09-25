// app/dev-ar-measure.tsx — the AR measurement harness. Owner-only, dev-only.
//
// THIS IS NOT A FEATURE. The founder asked for floor-plan geolocation
// ("calibrate once so a punch is already pinned") and then chose a MEASURED
// TRIAL first: nothing drawn on screen, just how far off an auto-placed pin
// would land on his own floor.
//
// ── THE ONE RULE THIS SCREEN EXISTS TO KEEP ────────────────────────────────
//
// IT NEVER SHOWS A PREDICTION. Not a suggested pin, not a miss, not an "off by
// 1.2 m" chip — not before his tap is committed, not after. If he could see
// where the app thinks he is, he would anchor his tap to it, and the ground
// truth would become a measurement of his agreeableness. Alignment, misses and
// drift rates are all solved OFFLINE from the exported file, which is also why
// one 15-minute walk answers short-baseline vs long-baseline vs best-fit
// instead of costing him a walk each.
//
// What is on screen during a walk: elapsed, distance walked, tracking state in
// plain words, station count, and whether the session is still worth trusting.
// Nothing else.
//
// ── WHY THERE IS NO AR VIEW ─────────────────────────────────────────────────
//
// No ARSCNView, no camera preview, no anchors. The native module owns a bare
// ARSession and hands back poses. A renderer would be the first thing to
// contaminate the trial and the first thing to burn battery in a 15-minute
// walk we are trying to measure the battery cost of.
//
// ── WHAT THIS BUILD CANNOT MEASURE, STATED RATHER THAN FAKED ───────────────
//
// Thermal state and battery level need native modules this app does not carry
// (expo-device / expo-battery are not dependencies). They are exported as
// `null`, the screen says so, and `sessionTrustVerdict` skips those two rules
// instead of inventing a reading. See the handoff note in the AR spike report.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Platform,
  TextInput, type LayoutChangeEvent, type GestureResponderEvent,
} from 'react-native';
import { Stack, Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import * as Linking from 'expo-linking';
import Constants from 'expo-constants';
import {
  ChevronLeft, Crosshair, Play, Square, MapPin, Share2, SkipForward,
  Target, AlertTriangle, CircleCheck, Radar,
} from 'lucide-react-native';

import { Type } from '@/constants/typography';
import { Tokens } from '@/constants/designTokens';
import type { ThemeColors } from '@/constants/colors';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { isOwner } from '@/utils/owner';
import { useHideBrainFab } from '@/components/brain/brainFabState';
import { generateUUID } from '@/utils/generateId';
import { showAlert } from '@/utils/alert';
import { Button, Card, cardSurface, useIsDesktop } from '@/components/ui';
import { SUPABASE_URL } from '@/lib/supabase';
import { containImageRect, normalizeTapToImage, pinStepImageSource, sheetAspectRatio, isPinnableSheet } from '@/utils/punchPlanPin';
import { feetPerPixel } from '@/utils/takeoffGeometry';

import * as ArNative from '@/utils/arTrack/native';
import { arAvailability, captureBlockedReason, depthBlockedReason } from '@/utils/arTrack/availability';
import {
  SPIKE_SCHEMA_VERSION, buildExportCsv, buildExportPayload,
  exportFileBase, protocolFor, sessionTrustVerdict, type StationPlan,
} from '@/utils/arTrack/session';
import type {
  ArPose, ArStatusEvent, ArTrackSummary, SpikeSample, SpikeSessionHeader,
} from '@/utils/arTrack/types';

/**
 * 8x, not the pin step's 4x. His thumb is the ruler: a ~59pt reliable target on
 * a 60 m plate at fit-to-screen is about 9 m of floor, ~2.3 m at 4x. Measuring
 * a sub-metre AR miss with a 2 m ruler measures the ruler. The zoom at
 * placement is recorded on every sample so the analysis can see which ruler
 * each tap used.
 */
const MAX_PLAN_ZOOM = 8;

type Phase = 'setup' | 'running' | 'done';

interface PendingMark {
  station: StationPlan;
  pose: ArPose;
  raycast: SpikeSample['raycast'];
  promptedAt: number;
  retaps: number;
}

export default function DevArMeasureScreen() {
  const { colors: t } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { projects, planSheets, getCalibrationForPlan } = useProjects();
  // Desktop: the primary CTA hugs Layout.button.fullWidthMax instead of the
  // window (change-order / invoice precedent). false on a phone = the default.
  const isDesktop = useIsDesktop();

  // The Brain FAB is suppressed rather than padded around. On a jobsite the
  // controls on this screen are pressed one-handed while standing on the
  // station being measured; a floating AI button parked over "Mark station"
  // would cost a mis-press at the exact moment a pose is supposed to be taken,
  // and an AI assistant has nothing to offer a measurement harness anyway.
  useHideBrainFab();

  // ── availability ──────────────────────────────────────────────────────────
  const [caps, setCaps] = useState(() => ArNative.getCapabilities());
  const avail = useMemo(() => arAvailability(caps), [caps]);

  // ── setup ─────────────────────────────────────────────────────────────────
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [planSource, setPlanSource] = useState<'pdf' | 'photo' | 'unknown'>('unknown');
  const [floorLabel, setFloorLabel] = useState('');
  const [floorNote, setFloorNote] = useState('');
  const [variant, setVariant] = useState<'full' | 'short'>('full');
  const [wantDepth, setWantDepth] = useState(false);

  // ── session ───────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>('setup');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null);
  const [stationIndex, setStationIndex] = useState(0);
  const [samples, setSamples] = useState<SpikeSample[]>([]);
  const [status, setStatus] = useState<ArStatusEvent | null>(null);
  const [live, setLive] = useState<{ t: number; pathLengthM: number } | null>(null);
  const [track, setTrack] = useState<ArTrackSummary | null>(null);
  const [originSetAtS, setOriginSetAtS] = useState<number | null>(null);
  /** Breaks in tracking only matter AFTER the origin — see sessionTrustVerdict. */
  const [originEpoch, setOriginEpoch] = useState<number | null>(null);
  const [lastConfirmAtS, setLastConfirmAtS] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingMark | null>(null);
  const [exportedUris, setExportedUris] = useState<string[]>([]);
  const [rawTrackUri, setRawTrackUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** When tracking first stopped being `tracked`, so "degraded for N s" is real. */
  const degradedSinceRef = useRef<number | null>(null);
  /**
   * The latest elapsed seconds, in a REF as well as in state.
   *
   * The status listener is subscribed once and would otherwise close over the
   * `live` from the first render — which is `null`, so "degraded since" would be
   * stamped as 0 and every brief `limited` moment after the first ten seconds
   * would read as "lost for the whole session" and stop him marking. The
   * alternative, re-subscribing whenever `live` changes, would tear down and
   * rebuild a native listener five times a second.
   */
  const elapsedRef = useRef(0);

  const sheets = useMemo(
    () => planSheets.filter((s) => s.projectId === projectId && isPinnableSheet(s)),
    [planSheets, projectId],
  );
  const sheet = useMemo(() => sheets.find((s) => s.id === sheetId) ?? null, [sheets, sheetId]);
  const calibration = useMemo(
    () => (sheetId ? getCalibrationForPlan(sheetId) ?? null : null),
    [sheetId, getCalibrationForPlan],
  );
  const ftPerPx = useMemo(() => {
    if (!calibration || !sheet?.width || !sheet?.height) return null;
    return feetPerPixel(calibration, sheet.width, sheet.height);
  }, [calibration, sheet]);

  const stations = useMemo(() => protocolFor(variant), [variant]);
  const station = stations[stationIndex] ?? null;

  const trust = useMemo(() => {
    const degradedForS = degradedSinceRef.current === null || !live
      ? 0
      : Math.max(0, live.t - degradedSinceRef.current);
    return sessionTrustVerdict({
      running: phase === 'running',
      elapsedS: live?.t ?? 0,
      pathLengthM: live?.pathLengthM ?? 0,
      degradedForS,
      epochs: track?.epochs ?? [],
      originEpoch,
      trackingNow: status?.trackingState ?? null,
      // Not measured in this build — see the header comment. Null, never a guess.
      thermalState: null,
      batteryLevel: null,
    });
  }, [phase, live, track, originEpoch, status]);

  // ── native events ─────────────────────────────────────────────────────────
  useEffect(() => {
    const s1 = ArNative.onStatusChange((e) => {
      setStatus(e);
      if (e.trackingState !== 'tracked') {
        if (degradedSinceRef.current === null) degradedSinceRef.current = elapsedRef.current;
      } else {
        degradedSinceRef.current = null;
      }
    });
    const s2 = ArNative.onSample((p) => {
      elapsedRef.current = p.t;
      setLive({ t: p.t, pathLengthM: p.pathLengthM ?? 0 });
    });
    const s3 = ArNative.onError((e) => showAlert('AR error', `${e.code}: ${e.message}`));
    return () => { s1.remove(); s2.remove(); s3.remove(); };
  }, []);

  /** Poll the track summary for the epoch list — events do not carry it. */
  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => { void ArNative.getTrack().then((s) => { if (s) setTrack(s); }); }, 2000);
    return () => clearInterval(id);
  }, [phase]);

  /** Leaving the screen must stop the camera. A session left running is a battery bug. */
  useEffect(() => () => { void ArNative.stop(); }, []);

  /**
   * Why "Start the walk" is blocked, or null. Memoised so `startSession` can
   * depend on it honestly instead of on the six values behind it — a dependency
   * list copied by hand is a dependency list that goes stale.
   */
  const setupBlockedReason = useCallback((): string | null => {
    if (!avail.available) return avail.message;
    if (!projectId) return 'Pick the project this floor belongs to.';
    if (!sheet) return 'Pick the floor plan sheet you will be tapping on. It has to be one with a stored image.';
    if (!calibration) return 'This sheet has no two-point calibration, so a tap cannot be converted into feet. Calibrate it in the plan viewer first.';
    if (ftPerPx === null) return 'The calibration on this sheet is degenerate (its two points are on top of each other). Recalibrate it.';
    if (planSource === 'unknown') return 'Say whether this sheet came from a PDF or a phone photo. A photographed sheet is perspective-skewed, and metres off it are indicative only.';
    return null;
  }, [avail.available, avail.message, projectId, sheet, calibration, ftPerPx, planSource]);

  // ── actions ───────────────────────────────────────────────────────────────

  const requestCamera = useCallback(async () => {
    // The module deliberately does not raise this prompt: two code paths asking
    // for the same TCC key is how permission bugs are born. expo-image-picker
    // already owns this app's camera permission story.
    const res = await ImagePicker.requestCameraPermissionsAsync();
    if (!res.granted) {
      showAlert('Camera still off', 'AR tracking cannot start without the camera. Turn it on in Settings → MAGE ID → Camera.');
    }
    setCaps(ArNative.refreshCapabilities());
  }, []);

  const startSession = useCallback(async () => {
    const blocked = setupBlockedReason();
    if (blocked) { showAlert('Not ready', blocked); return; }
    setBusy(true);
    try {
      await ArNative.start({ hz: 5, sceneDepth: wantDepth && avail.hasLidar, highResCapture: false });
      setSessionId(generateUUID());
      setStartedAtIso(new Date().toISOString());
      setSamples([]);
      setStationIndex(0);
      setOriginSetAtS(null);
      setOriginEpoch(null);
      setLastConfirmAtS(null);
      setExportedUris([]);
      setRawTrackUri(null);
      degradedSinceRef.current = null;
      elapsedRef.current = 0;
      setPhase('running');
    } catch (e) {
      showAlert('Could not start', describeError(e));
    } finally {
      setBusy(false);
    }
  }, [wantDepth, avail.hasLidar, setupBlockedReason]);

  const setOrigin = useCallback(async () => {
    setBusy(true);
    try {
      const o = await ArNative.setOrigin();
      setOriginSetAtS(o.atS);
      setOriginEpoch(o.epoch);
      setLastConfirmAtS(o.atS);
    } catch (e) {
      showAlert('Origin not set', describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Capture the pose FIRST, then open the plan. The pose has to be the one at
   * the moment he pressed the button, not the one after he spent twenty seconds
   * pinching a drawing — that delay is itself drift.
   */
  const markStation = useCallback(async (withRaycast: boolean) => {
    if (!station) return;
    setBusy(true);
    try {
      const pose = await ArNative.markPoint(station.id);
      let rc: SpikeSample['raycast'] = null;
      if (withRaycast) rc = await ArNative.raycast({ x: 0.5, y: 0.5 });
      setPending({ station, pose, raycast: rc, promptedAt: Date.now(), retaps: 0 });
    } catch (e) {
      showAlert('Nothing to mark', describeError(e));
    } finally {
      setBusy(false);
    }
  }, [station]);

  const commitTap = useCallback((x: number, y: number, zoomScale: number) => {
    if (!pending || !sheet) return;
    const now = live?.t ?? pending.pose.t;
    const sample: SpikeSample = {
      id: generateUUID(),
      stationId: pending.station.id,
      stationType: pending.station.type,
      label: pending.station.label,
      atIso: new Date().toISOString(),
      atMonotonicMs: Math.round(pending.pose.t * 1000),
      timeSinceOriginSec: originSetAtS === null ? 0 : pending.pose.t - originSetAtS,
      timeSinceLastConfirmSec: lastConfirmAtS === null ? 0 : pending.pose.t - lastConfirmAtS,
      pose: pending.pose,
      poseUnavailableReason: null,
      pathLengthM: pending.pose.pathLengthM ?? live?.pathLengthM ?? 0,
      straightLineFromOriginM: pending.pose.local
        ? Math.hypot(pending.pose.local.x, pending.pose.local.z)
        : 0,
      tap: {
        sheetId: sheet.id,
        x, y,
        zoomScale,
        msFromPromptToTap: Date.now() - pending.promptedAt,
        retapCount: pending.retaps,
      },
      raycast: pending.raycast,
      thermalState: null,
      batteryLevel: null,
      noteChips: [],
      skipReason: null,
    };
    setSamples((prev) => [...prev, sample]);
    // An anchor and a return are CONFIRMATIONS — they reset "time since last
    // confirm", which is the axis the whole drift question is asked along.
    if (pending.station.type === 'anchor' || pending.station.type === 'return') setLastConfirmAtS(now);
    setPending(null);
    setStationIndex((i) => Math.min(i + 1, stations.length));
  }, [pending, sheet, live, originSetAtS, lastConfirmAtS, stations.length]);

  /** A station he cannot reach is recorded WITH a reason. Never silently dropped. */
  const skipStation = useCallback((reason: string) => {
    if (!station) return;
    setSamples((prev) => [...prev, {
      id: generateUUID(),
      stationId: station.id,
      stationType: 'skipped',
      label: station.label,
      atIso: new Date().toISOString(),
      atMonotonicMs: Math.round((live?.t ?? 0) * 1000),
      timeSinceOriginSec: 0,
      timeSinceLastConfirmSec: 0,
      pose: null,
      poseUnavailableReason: 'skipped',
      pathLengthM: live?.pathLengthM ?? 0,
      straightLineFromOriginM: 0,
      tap: null,
      raycast: null,
      thermalState: null,
      batteryLevel: null,
      noteChips: [],
      skipReason: reason,
    }]);
    setStationIndex((i) => Math.min(i + 1, stations.length));
  }, [station, live, stations.length]);

  const finishAndExport = useCallback(async () => {
    if (!sessionId || !startedAtIso) return;
    setBusy(true);
    try {
      const summary = await ArNative.getTrack();
      const raw = await ArNative.exportTrack();
      await ArNative.stop();
      setTrack(summary);
      setRawTrackUri(raw?.uri ?? null);

      const header: SpikeSessionHeader = {
        sessionId,
        schemaVersion: SPIKE_SCHEMA_VERSION,
        startedAtIso,
        appVersion: String(Constants.expoConfig?.version ?? 'unknown'),
        // `runtimeVersion` is either a literal string or a POLICY OBJECT
        // ({ policy: 'appVersion' }), and this repo uses the object form.
        // String()-ing it would put "[object Object]" in the header of a file
        // whose whole point is knowing which binary produced the numbers.
        runtimeVersion: typeof Constants.expoConfig?.runtimeVersion === 'string'
          ? Constants.expoConfig.runtimeVersion
          : JSON.stringify(Constants.expoConfig?.runtimeVersion ?? null),
        deviceModel: avail.deviceModel ?? 'unknown',
        osVersion: avail.osVersion ?? 'unknown',
        hasLidar: avail.hasLidar,
        arConfig: {
          worldAlignment: 'gravity',
          planeDetection: ['horizontal', 'vertical'],
          sceneDepth: wantDepth && avail.hasLidar,
          highResCapture: false,
        },
        projectId,
        sheetId: sheet?.id ?? null,
        sheetPixelWidth: sheet?.width ?? null,
        sheetPixelHeight: sheet?.height ?? null,
        calibration: calibration
          ? { p1: calibration.p1, p2: calibration.p2, realDistanceFt: calibration.realDistanceFt }
          : null,
        planSource,
        floorLabel: floorLabel.trim() || null,
        protocol: variant,
        floorNote: floorNote.trim(),
      };

      const payload = buildExportPayload({
        header,
        samples,
        track: summary,
        rawTrackUri: raw?.uri ?? null,
        feetPerPixel: ftPerPx,
        trust,
        generatedAtIso: new Date().toISOString(),
      });

      const base = exportFileBase(sessionId);
      const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
      const jsonUri = `${dir}${base}.json`;
      const csvUri = `${dir}${base}.csv`;
      await FileSystem.writeAsStringAsync(jsonUri, JSON.stringify(payload, null, 2));
      await FileSystem.writeAsStringAsync(csvUri, buildExportCsv(samples));
      setExportedUris([jsonUri, csvUri, ...(raw?.uri ? [raw.uri] : [])]);
      setPhase('done');
    } catch (e) {
      showAlert('Export failed', describeError(e));
    } finally {
      setBusy(false);
    }
  }, [sessionId, startedAtIso, avail, wantDepth, projectId, sheet, calibration, planSource,
      floorLabel, variant, floorNote, samples, ftPerPx, trust]);

  const shareFile = useCallback(async (uri: string) => {
    if (Platform.OS === 'web') { showAlert('Not on web', 'Run the walk on the iPhone — the files are written to the app on the phone.'); return; }
    if (!(await Sharing.isAvailableAsync())) { showAlert('Sharing unavailable', 'This device has no share sheet.'); return; }
    await Sharing.shareAsync(uri, {
      mimeType: uri.endsWith('.csv') ? 'text/csv' : 'application/json',
      dialogTitle: 'AR spike results',
    });
  }, []);

  // ── gates ─────────────────────────────────────────────────────────────────
  //
  // BELOW every hook, deliberately. An early return above them would change the
  // hook order between an owner and everyone else, which React forbids and
  // eslint's rules-of-hooks catches. The AR session is never started for a
  // non-owner regardless: `startSession` is the only thing that calls into the
  // native module, and this redirect fires before anything can press it.
  if (!isOwner(user?.email)) return <Redirect href="/" />;

  // ── render ────────────────────────────────────────────────────────────────

  const blocked = setupBlockedReason();
  const marked = samples.filter((s) => s.stationType !== 'skipped').length;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, { paddingTop: insets.top + Tokens.spacing.sm }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <ChevronLeft size={Tokens.iconSize.large.size} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>DEV · MEASUREMENT TRIAL</Text>
          <Text style={styles.title}>AR Measure</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Tokens.spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        {/* WHAT THIS IS. Stated first, because the temptation to read it as a
            feature preview is exactly what would wreck the numbers. */}
        <Card style={styles.block}>
          <Card.Label>What this is</Card.Label>
          <Text style={styles.body}>
            A measurement harness, not a feature. It records where the phone thinks it is and
            where you say it is, and nothing else. It never shows you a suggested pin — if it
            did, you would tap towards it and the result would measure agreement, not accuracy.
            The answers come out of the exported file afterwards.
          </Text>
        </Card>

        {/* AVAILABILITY — five different sentences, five different next steps. */}
        {!avail.available && (
          <Card style={styles.block}>
            <View style={styles.rowIcon}>
              <AlertTriangle size={Tokens.iconSize.default.size} color={t.warningLabel} />
              <Text style={styles.blockTitle}>Nothing to measure here</Text>
            </View>
            <Text style={styles.body}>{avail.message}</Text>
            {avail.action === 'requestCamera' && (
              <Button label="Allow the camera" onPress={() => void requestCamera()} style={styles.btn} />
            )}
            {avail.action === 'openSettings' && (
              <Button label="Open Settings" variant="secondary" onPress={() => void Linking.openSettings()} style={styles.btn} />
            )}
          </Card>
        )}

        {phase === 'setup' && (
          <SetupBlock
            styles={styles} t={t}
            projects={projects.map((p) => ({ id: p.id, name: p.name }))}
            projectId={projectId} onProject={(id) => { setProjectId(id); setSheetId(null); }}
            sheets={sheets.map((s) => ({ id: s.id, name: s.name, sheetNumber: s.sheetNumber }))}
            sheetId={sheetId} onSheet={setSheetId}
            planSource={planSource} onPlanSource={setPlanSource}
            floorLabel={floorLabel} onFloorLabel={setFloorLabel}
            floorNote={floorNote} onFloorNote={setFloorNote}
            variant={variant} onVariant={setVariant}
            wantDepth={wantDepth} onWantDepth={setWantDepth}
            depthBlocked={depthBlockedReason(avail)}
            captureBlocked={captureBlockedReason(avail)}
            ftPerPx={ftPerPx}
            blocked={blocked}
            busy={busy}
            onStart={() => void startSession()}
          />
        )}

        {phase === 'running' && (
          <>
            <LiveStrip styles={styles} t={t} status={status} live={live} marked={marked} total={stations.length} trust={trust} />

            {originSetAtS === null ? (
              <Card style={styles.block}>
                <Card.Label>Step one</Card.Label>
                <Text style={styles.blockTitle}>Stand at A1 and set the origin</Text>
                <Text style={styles.body}>
                  Put the phone against the feature you picked — a door jamb corner, a column face.
                  Everything after this is measured from here and from the way you are facing.
                </Text>
                <Button
                  label="Set origin here"
                  onPress={() => void setOrigin()}
                  disabled={busy || status?.trackingState !== 'tracked'}
                  iconLeft={<Crosshair size={16} color={t.bg} />}
                  style={styles.btn}
                />
                {status?.trackingState !== 'tracked' && (
                  <Text style={styles.why}>
                    Waiting for ARKit to settle — move the phone slowly and point it at something with detail.
                  </Text>
                )}
              </Card>
            ) : station ? (
              <Card style={styles.block}>
                <Card.Label>{`Station ${stationIndex + 1} of ${stations.length} · ${station.id}`}</Card.Label>
                <Text style={styles.blockTitle}>{station.label}</Text>
                <Text style={styles.body}>{station.why}</Text>

                <Button
                  label={station.type === 'defect' ? 'Aim at it, then mark' : 'Mark station'}
                  onPress={() => void markStation(station.type === 'defect')}
                  disabled={busy || !trust.trusted || status?.trackingState !== 'tracked'}
                  iconLeft={station.type === 'defect'
                    ? <Target size={16} color={t.bg} />
                    : <MapPin size={16} color={t.bg} />}
                  style={styles.btn}
                />
                {/* A blocked control says WHY. */}
                {!trust.trusted && <Text style={styles.why}>{trust.reason}</Text>}
                {trust.trusted && status?.trackingState !== 'tracked' && (
                  <Text style={styles.why}>
                    {status?.trackingState === 'limited'
                      ? `Tracking is limited right now (${status.reason ?? 'settling'}), so a position taken here would not be a measurement.`
                      : 'Tracking is lost — nothing to mark until it comes back.'}
                  </Text>
                )}

                <Button
                  label="Can't reach this one"
                  variant="ghost"
                  onPress={() => promptSkip(skipStation)}
                  iconLeft={<SkipForward size={16} color={t.textSecondary} />}
                  style={styles.btn}
                />
              </Card>
            ) : (
              <Card style={styles.block}>
                <View style={styles.rowIcon}>
                  <CircleCheck size={Tokens.iconSize.default.size} color={t.successLabel} />
                  <Text style={styles.blockTitle}>Every station is done</Text>
                </View>
                <Text style={styles.body}>Export the file and send it off the phone.</Text>
              </Card>
            )}

            <Button
              label="Finish and export"
              variant="secondary"
              onPress={() => void finishAndExport()}
              disabled={busy || samples.length === 0}
              iconLeft={<Square size={16} color={t.text} />}
              style={styles.block}
              fullWidth={isDesktop}
            />
            {samples.length === 0 && (
              <Text style={styles.why}>Nothing has been marked yet, so there is nothing to export.</Text>
            )}
          </>
        )}

        {phase === 'done' && (
          <Card style={styles.block}>
            <Card.Label>Done</Card.Label>
            <Text style={styles.blockTitle}>{`${marked} station${marked === 1 ? '' : 's'} recorded`}</Text>
            <Text style={styles.body}>
              The .json is the record. The .csv is a convenience — the analysis recomputes every
              number from the json. The .ndjson is the raw ARKit path, which is what lets the same
              walk be re-solved with a different alignment later.
            </Text>
            {track && (
              <Text style={styles.meta}>
                {`${fmtMin(track.elapsedS)} · ${track.pathLengthM.toFixed(1)} m walked · tracked ${pct(track.normalS, track.elapsedS)} of the time · ${track.epochs.length - 1} tracking break${track.epochs.length - 1 === 1 ? '' : 's'}`}
                {track.pathDownsampled ? ' · raw path downsampled' : ''}
              </Text>
            )}
            {exportedUris.map((uri) => (
              <Button
                key={uri}
                label={`Send ${uri.split('/').pop() ?? 'file'}`}
                variant="secondary"
                onPress={() => void shareFile(uri)}
                iconLeft={<Share2 size={16} color={t.text} />}
                style={styles.btn}
              />
            ))}
            {rawTrackUri === null && (
              <Text style={styles.why}>The raw path file could not be written, so only the marks survive.</Text>
            )}
            <Button label="New session" onPress={() => setPhase('setup')} style={styles.btn} />
            <Text style={styles.meta}>
              These files sit in the app&rsquo;s own storage until the app is deleted, and this
              screen does not list past sessions. Send them now.
            </Text>
          </Card>
        )}
      </ScrollView>

      {/* THE PLAN TAP. Nothing is drawn on it except the pin he has just placed.
          No predicted point, no ring, no previous stations. */}
      <Modal visible={pending !== null} animationType="slide" onRequestClose={() => setPending(null)}>
        <PlanTapStep
          styles={styles} t={t}
          sheet={sheet}
          station={pending?.station ?? null}
          onCancel={() => setPending(null)}
          onCommit={commitTap}
          onRetap={() => setPending((p) => (p ? { ...p, retaps: p.retaps + 1 } : p))}
        />
      </Modal>
    </View>
  );
}

// ── setup ───────────────────────────────────────────────────────────────────

interface SetupProps {
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  projects: { id: string; name: string }[];
  projectId: string | null;
  onProject: (id: string) => void;
  sheets: { id: string; name: string; sheetNumber?: string }[];
  sheetId: string | null;
  onSheet: (id: string) => void;
  planSource: 'pdf' | 'photo' | 'unknown';
  onPlanSource: (v: 'pdf' | 'photo') => void;
  floorLabel: string;
  onFloorLabel: (v: string) => void;
  floorNote: string;
  onFloorNote: (v: string) => void;
  variant: 'full' | 'short';
  onVariant: (v: 'full' | 'short') => void;
  wantDepth: boolean;
  onWantDepth: (v: boolean) => void;
  depthBlocked: string | null;
  captureBlocked: string | null;
  ftPerPx: number | null;
  blocked: string | null;
  busy: boolean;
  onStart: () => void;
}

function SetupBlock(p: SetupProps) {
  const { styles, t } = p;
  const isDesktop = useIsDesktop();
  return (
    <>
      <Card style={styles.block}>
        <Card.Label>Project</Card.Label>
        <ChipRow
          styles={styles}
          options={p.projects.map((x) => ({ id: x.id, label: x.name }))}
          selected={p.projectId}
          onSelect={p.onProject}
          empty="No projects on this phone."
        />
      </Card>

      <Card style={styles.block}>
        <Card.Label>Sheet</Card.Label>
        <ChipRow
          styles={styles}
          options={p.sheets.map((x) => ({ id: x.id, label: x.sheetNumber ? `${x.sheetNumber} — ${x.name}` : x.name }))}
          selected={p.sheetId}
          onSelect={p.onSheet}
          empty="This project has no plan sheet with a stored image. Upload one first — a sheet whose image never uploaded cannot be tapped on."
        />
        {p.ftPerPx !== null && (
          <Text style={styles.meta}>{`Calibrated: ${(p.ftPerPx * 1000).toFixed(2)} ft per 1000 px.`}</Text>
        )}
      </Card>

      <Card style={styles.block}>
        <Card.Label>Where the sheet came from</Card.Label>
        <ChipRow
          styles={styles}
          options={[{ id: 'pdf', label: 'PDF sheet' }, { id: 'photo', label: 'Phone photo of a sheet' }]}
          selected={p.planSource === 'unknown' ? null : p.planSource}
          onSelect={(v) => p.onPlanSource(v as 'pdf' | 'photo')}
        />
        {p.planSource === 'photo' && (
          // Never show a guess as fact: a photographed sheet is
          // perspective-skewed, and the residual cannot be attributed to ARKit.
          <Text style={styles.why}>
            A photographed sheet is perspective-skewed, so distances off it are not uniform.
            This run will be tagged as indicative — the miss in metres will not be quotable.
          </Text>
        )}
      </Card>

      <Card style={styles.block}>
        <Card.Label>Protocol</Card.Label>
        <ChipRow
          styles={styles}
          options={[{ id: 'full', label: 'Full (about 14 min)' }, { id: 'short', label: 'Short (about 5 min)' }]}
          selected={p.variant}
          onSelect={(v) => p.onVariant(v as 'full' | 'short')}
        />
        <Text style={styles.meta}>
          Two runs on different days beat one careful run — the spread between runs is what decides this.
        </Text>
      </Card>

      <Card style={styles.block}>
        <Card.Label>Floor</Card.Label>
        <TextInput
          style={styles.input}
          value={p.floorLabel}
          onChangeText={p.onFloorLabel}
          placeholder="e.g. Level 9"
          placeholderTextColor={t.textMuted}
        />
        <Text style={styles.meta}>What the floor looks like — bare drywall, glazed, dark, occupied.</Text>
        <TextInput
          style={[styles.input, styles.inputTall]}
          value={p.floorNote}
          onChangeText={p.onFloorNote}
          placeholder="Bare drywall, no ceiling grid, north half dark"
          placeholderTextColor={t.textMuted}
          multiline
        />
      </Card>

      <Card style={styles.block}>
        <Card.Label>Options</Card.Label>
        <Toggle
          styles={styles}
          label="Use the LiDAR depth sensor"
          value={p.wantDepth}
          onChange={p.onWantDepth}
          blockedReason={p.depthBlocked}
        />
        {p.captureBlocked && <Text style={styles.why}>{p.captureBlocked}</Text>}
        <Text style={styles.meta}>
          Battery and heat are not readable in this build, so they are exported as blank rather
          than guessed. Watch the battery percentage yourself and write it down.
        </Text>
      </Card>

      <Button
        label="Start the walk"
        onPress={p.onStart}
        disabled={p.busy || p.blocked !== null}
        iconLeft={<Play size={16} color={t.bg} />}
        style={styles.block}
        fullWidth={isDesktop}
      />
      {p.blocked && <Text style={styles.why}>{p.blocked}</Text>}
    </>
  );
}

// ── live strip ──────────────────────────────────────────────────────────────

function LiveStrip(props: {
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  status: ArStatusEvent | null;
  live: { t: number; pathLengthM: number } | null;
  marked: number;
  total: number;
  trust: ReturnType<typeof sessionTrustVerdict>;
}) {
  const { styles, t, status, live, marked, total, trust } = props;
  const label = trackingSentence(status);
  return (
    <View style={styles.strip}>
      <View style={styles.rowIcon}>
        <Radar size={Tokens.iconSize.default.size} color={trust.trusted ? t.successLabel : t.warningLabel} />
        <Text style={styles.stripState}>{label}</Text>
      </View>
      <Text style={styles.stripMeta}>
        {`${fmtMin(live?.t ?? 0)} · ${(live?.pathLengthM ?? 0).toFixed(1)} m walked · ${marked}/${total} marked`}
      </Text>
      {!trust.trusted && <Text style={styles.why}>{trust.reason}</Text>}
    </View>
  );
}

/** Apple's three states, in words a person on a jobsite can act on. */
function trackingSentence(s: ArStatusEvent | null): string {
  if (!s) return 'Starting up';
  if (s.interrupted) return 'Interrupted — the camera stopped feeding ARKit';
  switch (s.trackingState) {
    case 'tracked': return 'Tracking well';
    case 'limited':
      switch (s.reason) {
        case 'initializing': return 'Settling — move slowly for a moment';
        case 'excessiveMotion': return 'Moving too fast for the camera';
        case 'insufficientFeatures': return 'Not enough detail in view — point at a corner or a door';
        case 'relocalizing': return 'Finding the room again';
        default: return 'Tracking is limited';
      }
    default: return 'Tracking lost';
  }
}

// ── plan tap ────────────────────────────────────────────────────────────────

function PlanTapStep(props: {
  styles: ReturnType<typeof makeStyles>;
  t: ThemeColors;
  sheet: { id: string; name: string; imageUri?: string | null; storagePath?: string | null; width?: number | null; height?: number | null } | null;
  station: StationPlan | null;
  onCancel: () => void;
  onCommit: (x: number, y: number, zoom: number) => void;
  onRetap: () => void;
}) {
  const { styles, t, sheet, station } = props;
  const [container, setContainer] = useState<{ w: number; h: number } | null>(null);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  // A fresh station is a fresh tap. Carrying the last pin over would let a
  // distracted press file the previous room's position under this station.
  useEffect(() => { setPin(null); setZoom(1); }, [station?.id]);

  const ratio = sheetAspectRatio(sheet);
  const box = useMemo(() => containImageRect(container, ratio), [container, ratio]);
  const source = useMemo(
    () => pinStepImageSource(sheet, { publicBaseUrl: SUPABASE_URL }),
    [sheet],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainer({ w: width, h: height });
  }, []);

  const onTap = useCallback((e: GestureResponderEvent) => {
    const p = normalizeTapToImage(e.nativeEvent.locationX, e.nativeEvent.locationY, box);
    if (!p) return;
    if (pin) props.onRetap();
    setPin(p);
  }, [box, pin, props]);

  return (
    <View style={styles.modalRoot}>
      <View style={styles.modalHeader}>
        <TouchableOpacity onPress={props.onCancel} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Cancel this mark">
          <ChevronLeft size={Tokens.iconSize.large.size} color={t.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>{sheet?.name ?? 'No sheet'}</Text>
          <Text style={styles.modalTitle}>{station ? `Tap where you are standing — ${station.id}` : 'Tap where you are standing'}</Text>
        </View>
      </View>

      <ScrollView
        style={styles.planScroll}
        contentContainerStyle={styles.planContent}
        maximumZoomScale={MAX_PLAN_ZOOM}
        minimumZoomScale={1}
        bouncesZoom
        onScroll={(e) => setZoom(e.nativeEvent.zoomScale ?? 1)}
        scrollEventThrottle={64}
      >
        <View style={styles.planBox} onLayout={onLayout}>
          {source && box ? (
            <View
              style={{ position: 'absolute', left: box.left, top: box.top, width: box.w, height: box.h }}
              onStartShouldSetResponder={() => true}
              onResponderRelease={onTap}
            >
              <Image source={source} style={styles.planImage} contentFit="contain" />
              {pin && (
                <View
                  pointerEvents="none"
                  style={[styles.pin, { left: pin.x * box.w - 14, top: pin.y * box.h - 28 }]}
                >
                  <MapPin size={28} color={t.danger} />
                </View>
              )}
            </View>
          ) : (
            <Text style={styles.body}>This sheet has no image to tap on.</Text>
          )}
        </View>
      </ScrollView>

      <View style={styles.modalFooter}>
        <Text style={styles.meta}>
          {`Zoom in before you tap — the zoom is recorded (currently ${zoom.toFixed(1)}x, up to ${MAX_PLAN_ZOOM}x).`}
        </Text>
        <Button
          label="This is where I am"
          onPress={() => { if (pin) props.onCommit(pin.x, pin.y, zoom); }}
          disabled={!pin}
          style={styles.btn}
        />
        {!pin && <Text style={styles.why}>Tap the plan first — nothing is recorded until you do.</Text>}
      </View>
    </View>
  );
}

// ── small parts ─────────────────────────────────────────────────────────────

function ChipRow(props: {
  styles: ReturnType<typeof makeStyles>;
  options: { id: string; label: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
  empty?: string;
}) {
  const { styles } = props;
  if (props.options.length === 0) {
    return <Text style={styles.why}>{props.empty ?? 'Nothing to pick.'}</Text>;
  }
  return (
    <View style={styles.chipRow}>
      {props.options.map((o) => {
        const on = o.id === props.selected;
        return (
          <TouchableOpacity
            key={o.id}
            onPress={() => props.onSelect(o.id)}
            style={[styles.chip, on && styles.chipOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Toggle(props: {
  styles: ReturnType<typeof makeStyles>;
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  blockedReason: string | null;
}) {
  const { styles } = props;
  const disabled = props.blockedReason !== null;
  return (
    <View>
      <TouchableOpacity
        onPress={() => !disabled && props.onChange(!props.value)}
        style={[styles.chip, props.value && !disabled && styles.chipOn, disabled && styles.chipOff]}
        accessibilityRole="switch"
        accessibilityState={{ checked: props.value, disabled }}
      >
        <Text style={[styles.chipText, props.value && !disabled && styles.chipTextOn]}>{props.label}</Text>
      </TouchableOpacity>
      {/* A disabled control says why. */}
      {disabled && <Text style={styles.why}>{props.blockedReason}</Text>}
    </View>
  );
}

function promptSkip(onSkip: (reason: string) => void) {
  showAlert(
    'Why are you skipping it?',
    'A skipped station is recorded with its reason. A station that just vanishes makes the whole run look better than it was.',
    [
      { text: 'Locked / no access', onPress: () => onSkip('locked or no access') },
      { text: 'Feature not there', onPress: () => onSkip('feature does not exist on site') },
      { text: 'Tracking was lost', onPress: () => onSkip('tracking lost at this station') },
      { text: 'Cancel', style: 'cancel' },
    ],
  );
}

function describeError(e: unknown): string {
  const code = ArNative.arErrorCode(e);
  const msg = e instanceof Error ? e.message : String(e);
  return code ? `${msg}\n\n(${code})` : msg;
}

function fmtMin(s: number): string {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}m ${String(r).padStart(2, '0')}s`;
}

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return '—';
  return `${Math.round((part / whole) * 100)}%`;
}

const makeStyles = (t: ThemeColors) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
      paddingHorizontal: Tokens.spacing.md, paddingBottom: Tokens.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
    },
    backBtn: {
      width: Tokens.touchTarget.min, height: Tokens.touchTarget.min,
      alignItems: 'center', justifyContent: 'center',
    },
    headerText: { flex: 1 },
    eyebrow: { ...Type.eyebrow, color: t.textMuted },
    title: { ...Type.serifHeadline, color: t.text },
    scroll: { padding: Tokens.spacing.md, gap: Tokens.spacing.md },
    block: { marginBottom: Tokens.spacing.md },
    blockTitle: { ...Type.headline, color: t.text, marginTop: Tokens.spacing.xs },
    body: { ...Type.body, color: t.textSecondary, marginTop: Tokens.spacing.xs },
    meta: { ...Type.footnote, color: t.textMuted, marginTop: Tokens.spacing.xs },
    /** Every "why" on this screen: blocked controls, refused readings, caveats. */
    why: { ...Type.footnote, color: t.warningLabel, marginTop: Tokens.spacing.xs },
    btn: { marginTop: Tokens.spacing.sm },
    rowIcon: { flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.xs },
    strip: {
      ...cardSurface(t, { radius: 'md', pad: Tokens.spacing.sm }),
      marginBottom: Tokens.spacing.md,
    },
    stripState: { ...Type.subhead, color: t.text },
    stripMeta: { ...Type.footnote, color: t.textSecondary, marginTop: 2 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Tokens.spacing.xs, marginTop: Tokens.spacing.xs },
    chip: {
      paddingHorizontal: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xs,
      borderRadius: Tokens.radius.full, borderWidth: 1, borderColor: t.line,
      backgroundColor: t.surfaceAlt, maxWidth: '100%',
    },
    chipOn: { backgroundColor: t.accentFill, borderColor: t.accent },
    chipOff: { opacity: 0.45 },
    chipText: { ...Type.footnote, color: t.textSecondary },
    chipTextOn: { color: t.accentLabel },
    input: {
      ...Type.body, color: t.text, backgroundColor: t.surfaceAlt,
      borderRadius: Tokens.radius.md, borderWidth: 1, borderColor: t.line,
      paddingHorizontal: Tokens.spacing.sm, paddingVertical: Tokens.spacing.xs,
      marginTop: Tokens.spacing.xs, minHeight: Tokens.touchTarget.min,
    },
    inputTall: { minHeight: 72, textAlignVertical: 'top' },
    modalRoot: { flex: 1, backgroundColor: t.bg },
    modalHeader: {
      flexDirection: 'row', alignItems: 'center', gap: Tokens.spacing.sm,
      paddingHorizontal: Tokens.spacing.md, paddingTop: Tokens.spacing.xl, paddingBottom: Tokens.spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line,
    },
    modalTitle: { ...Type.headline, color: t.text },
    modalFooter: {
      padding: Tokens.spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.line,
    },
    planScroll: { flex: 1, backgroundColor: t.neutralSoft },
    planContent: { flexGrow: 1 },
    planBox: { flex: 1, minHeight: 320 },
    planImage: { width: '100%', height: '100%' },
    pin: { position: 'absolute', width: 28, height: 28 },
  });
