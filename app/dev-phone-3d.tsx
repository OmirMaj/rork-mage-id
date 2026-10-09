// app/dev-phone-3d.tsx — the phone's 3D view, on a sample job, with no sign-in.
//
// THIS IS NOT A FEATURE. It exists so the phone's 3D view (lane PHONE3D,
// components/livingModel/JobReplay3D.tsx) can be opened in the iOS Simulator
// by a build made on a Mac, where nobody can sign in. It is how the 3D view
// was proven to draw before a cloud build was spent (docs/phone-3d-build-notes.md).
//
// IT IS OFF IN EVERY BUILD ANYONE INSTALLS. The route draws only when
// EXPO_PUBLIC_PHONE3D_SPIKE is "1", and Metro writes that value into the
// bundle when the bundle is made. The variable is set in ONE place: the shell
// of the person making a simulator build. It is not in eas.json, not in
// app.json and not in any committed .env file, so in a cloud build and in an
// over-the-air update it is not set, and this route sends everyone Home and
// mounts nothing. scripts/validate-phone-3d.ts fails if the name appears in
// eas.json, app.json or a committed env file, or if the redirect is removed.
//
// The sample is the seven-room apartment and the ten-week schedule the Living
// Model's own checks use, and a forty-room grid for timing
// (utils/livingModel/phoneSpikeSample.ts). Nothing is read from or written to an account.
//
// The address takes: week (1 to 10), rooms (7 or 40), dx and dy (turn the
// view, in points of finger travel), zoom (a factor), planned (1 for the
// planned reading), spin (time this many frames and print the result).
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { usePhone3DCopy } from '@/hooks/usePhone3DCopy';
import { JobReplay3D } from '@/components/livingModel/JobReplay3D';
import { phone3DEngineError, phone3DEngineInBuild } from '@/components/livingModel/phone3d/engine';
import { HonestyLines } from '@/components/livingModel/HonestyLines';
import { ReplayControls, StageLegend, useReplayState, useRoomMoments, useRoomTasks } from '@/components/livingModel/replayShared';
import { makeLivingModelStyles } from '@/components/livingModel/styles';
import { spikeFortyRoomJob, spikeSevenRoomJob, spikeTenWeekSchedule } from '@/utils/livingModel/phoneSpikeSample';
import { offsetOfWeek, weekCount, weekOf } from '@/utils/livingModel/replayCore';
import type { ReplayInput } from '@/utils/livingModel/replayInput';

/** True only in a bundle made with the variable set in the builder's own shell. */
export const PHONE3D_SPIKE_ON = process.env.EXPO_PUBLIC_PHONE3D_SPIKE === '1';

const num = (v: string | string[] | undefined): number | undefined => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : undefined;
};

export default function DevPhone3DRoute() {
  if (!PHONE3D_SPIKE_ON) return <Redirect href="/(tabs)/(home)" />;
  return <Spike />;
}

function Spike() {
  const insets = useSafeAreaInsets();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const phoneCopy = usePhone3DCopy();
  const params = useLocalSearchParams<{ week?: string; rooms?: string; dx?: string; dy?: string; zoom?: string; planned?: string; spin?: string }>();
  const big = num(params.rooms) === 40;
  const model = useMemo(() => (big ? spikeFortyRoomJob() : spikeSevenRoomJob()), [big]);
  const input = useMemo<ReplayInput>(() => {
    const s = spikeTenWeekSchedule();
    return { tasks: s.tasks, linkTasks: [], points: s.points, clock: s.clock, startDate: null };
  }, []);
  const state = useReplayState(input);
  const roomTasks = useRoomTasks(model, input);
  const moments = useRoomMoments(roomTasks, input, state.offset, state.mode);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [spin, setSpin] = useState<string | null>(null);
  const [spinToken, setSpinToken] = useState(0);
  const [threw, setThrew] = useState<string | null>(null);

  const week = num(params.week);
  const planned = num(params.planned) === 1;
  const { setOffset, setMode } = state;
  useEffect(() => { if (week != null) setOffset(offsetOfWeek(Math.max(0, Math.min(weekCount(input.clock), week)), input.clock)); }, [week, setOffset, input.clock]);
  useEffect(() => { setMode(planned ? 'planned' : 'reported'); }, [planned, setMode]);
  const spinFrames = num(params.spin);
  useEffect(() => {
    if (!spinFrames) return;
    // Give the first frame time to land before timing starts.
    const id = setTimeout(() => setSpinToken((n) => n + 1), 2500);
    return () => clearTimeout(id);
  }, [spinFrames, big]);

  const debug = useMemo(() => ({
    orbitDx: num(params.dx),
    orbitDy: num(params.dy),
    zoom: num(params.zoom),
    spinToken,
    spinFrames: spinFrames ?? 120,
    onError: (what: string) => { console.info(`[phone3d] threw: ${what}`); setThrew(what); },
    onSpin: (r: { frames: number; medianMs: number; p95Ms: number; worstMs: number; medianGapMs: number; p95GapMs: number }) => {
      const line = `${model.rooms.length} rooms, ${r.frames} frames. Drawn in ${r.medianMs.toFixed(1)} ms (middle), ${r.p95Ms.toFixed(1)} ms (slow end), ${r.worstMs.toFixed(1)} ms (worst). Frame to frame ${r.medianGapMs.toFixed(1)} ms (middle), ${r.p95GapMs.toFixed(1)} ms (slow end).`;
      console.info(`[phone3d] ${line}`);
      setSpin(line);
    },
  }), [params.dx, params.dy, params.zoom, spinToken, spinFrames, model.rooms.length]);

  const weekLine = copy.weekLabel(weekOf(state.offset, input.clock), weekCount(input.clock));
  const atToday = Math.abs(state.offset - input.clock.todayOffset) < 0.26;
  const past = state.offset > input.clock.todayOffset + 1e-6;
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.screen, { paddingTop: insets.top }]} testID="dev-phone-3d">
        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={styles.headerName} accessibilityRole="header">Phone 3D Check</Text>
          <Text style={styles.note}>Sample job. Nothing here is saved.</Text>
          <JobReplay3D
            model={model}
            level={0}
            moments={moments}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUnavailable={() => {}}
            weekLine={weekLine}
            atToday={atToday}
            height={380}
            compact
            debug={debug}
          />
          <StageLegend />
          <Text style={styles.note}>{phoneCopy.touchHelpSub}</Text>
          {spin ? <Text style={styles.para} testID="dev-phone-3d-timing">{spin}</Text> : null}
          <Text style={styles.note} testID="dev-phone-3d-engine">{`Engine in this build: ${phone3DEngineInBuild() ? 'yes' : 'no'}.${threw ? ` Threw: ${threw}` : ''}${phone3DEngineError() ? ` Load: ${phone3DEngineError()}` : ''}`}</Text>
          <ReplayControls input={input} state={state} />
          <HonestyLines ghost={past} />
        </ScrollView>
      </View>
    </>
  );
}
