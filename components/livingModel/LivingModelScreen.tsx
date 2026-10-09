// components/livingModel/LivingModelScreen.tsx — the Living Model for one job.
//
// The Living Model, Phase 1 (dark behind LIVING_MODEL_ENABLED, owner preview).
// Three views of one job model:
//   Rooms       the Room Editor: make the model from typed sizes and saved scans.
//   Tasks       tick which schedule tasks happen in each room.
//   Job Replay  play the job from start to finish, planned against reported.
//               In 3D on the web; drawn flat on the phone, which says so.
//
// The model is SAVED ON THIS DEVICE ONLY FOR NOW (utils/livingModel/storeCore)
// and the Room Editor says so. Every change is the person's: this screen
// writes the model after he changes it and never changes it itself.
//
// NOT IN THIS PHASE, and not built: a money lens, open items, a client view,
// sharing a replay, reading rooms from an uploaded plan, cloud sync. The seams
// are the model (JobModel), the per-room moment (replayCore.roomMoment) and the
// 3D view's `looks`; nothing here depends on how those later features are made.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { SegmentedControl } from '@/components/ui';
import { useIsDesktop } from '@/components/ui/desktop';
import { canRedo, canUndo, historyOf, historyPush, historyRedo, historyUndo, type History } from '@/utils/livingModel/historyCore';
import { modelLevels } from '@/utils/livingModel/modelCore';
import { weekCount, weekOf } from '@/utils/livingModel/replayCore';
import { buildReplayInput } from '@/utils/livingModel/replayInput';
import { loadJobModel, saveJobModel } from '@/utils/livingModel/store';
import type { JobModel } from '@/utils/livingModel/types';
import { FlatReplay } from './FlatReplay';
import { HonestyLines } from './HonestyLines';
import { JOB_REPLAY_3D_ON_THIS_PLATFORM, JobReplay3D } from './JobReplay3D';
import { RoomEditor } from './RoomEditor';
import { TaskLinks } from './TaskLinks';
import { ReplayControls, ReplayRoomList, RoomCardPanel, StageLegend, useReplayState, useRoomMoments, useRoomTasks } from './replayShared';
import { makeLivingModelStyles } from './styles';

type Tab = 'rooms' | 'tasks' | 'replay';

export function LivingModelScreen({ projectId, userId }: { projectId: string; userId: string | null }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const wide = useIsDesktop();
  const { getProject, getDailyReportsForProject } = useProjects();
  const project = getProject(projectId);
  const [history, setHistory] = useState<History<JobModel> | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('rooms');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [now] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    setHistory(null);
    void loadJobModel(userId, projectId).then((m) => {
      if (!alive) return;
      setHistory(historyOf(m));
      const levels = modelLevels(m);
      setLevel(levels.includes(0) || levels.length === 0 ? 0 : levels[0]);
    });
    return () => { alive = false; };
  }, [userId, projectId]);

  const persist = useCallback((m: JobModel) => {
    void saveJobModel(userId, m, new Date().toISOString()).then((ok) => setSaveFailed(!ok));
  }, [userId]);

  const onChange = useCallback((next: JobModel) => {
    setHistory((h) => {
      if (!h) return h;
      const pushed = historyPush(h, next);
      if (pushed !== h) persist(pushed.present);
      return pushed;
    });
  }, [persist]);
  const onUndo = useCallback(() => setHistory((h) => { if (!h || !canUndo(h)) return h; const u = historyUndo(h); persist(u.present); return u; }), [persist]);
  const onRedo = useCallback(() => setHistory((h) => { if (!h || !canRedo(h)) return h; const r = historyRedo(h); persist(r.present); return r; }), [persist]);

  const model = history?.present ?? null;
  const reports = useMemo(() => getDailyReportsForProject(projectId), [getDailyReportsForProject, projectId]);
  const input = useMemo(() => buildReplayInput(project?.schedule ?? null, reports, now), [project?.schedule, reports, now]);

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="living-model-screen">
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={copy.backLabel} testID="living-model-back">
          <ChevronLeft size={24} color={colors.text} />
        </Pressable>
        <View style={styles.rowMain}>
          <Text style={styles.headerName} numberOfLines={1} accessibilityRole="header">{copy.titleLabel}</Text>
          {project?.name ? <Text style={styles.headerSub} numberOfLines={1}>{project.name}</Text> : null}
        </View>
      </View>
      <View style={styles.tabs}>
        <SegmentedControl<Tab>
          options={[{ value: 'rooms', label: copy.roomsTabLabel }, { value: 'tasks', label: copy.tasksTabLabel }, { value: 'replay', label: copy.replayTabLabel }]}
          value={tab}
          onChange={setTab}
          accessibilityLabel={copy.tabsA11yLabel}
          testID="living-model-tabs"
        />
      </View>
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 32 }]} keyboardShouldPersistTaps="handled">
        {saveFailed ? <Text style={styles.warn} testID="lm-save-failed">{copy.saveFailedBody}</Text> : null}
        {!model ? <Text style={styles.note}>{copy.loadingBody}</Text> : null}
        {model && tab === 'rooms' ? (
          <>
            <RoomEditor
              projectId={projectId}
              model={model}
              onChange={onChange}
              onUndo={onUndo}
              onRedo={onRedo}
              canUndo={!!history && canUndo(history)}
              canRedo={!!history && canRedo(history)}
              selectedId={selectedId}
              onSelect={setSelectedId}
              level={level}
              onLevel={setLevel}
              wide={wide}
              footer={<HonestyLines testID="lm-honesty-rooms" />}
            />
          </>
        ) : null}
        {model && tab === 'tasks' ? (
          <TaskLinks model={model} input={input} roomId={selectedId} onRoom={setSelectedId} onChange={onChange} />
        ) : null}
        {model && tab === 'replay' ? (
          <ReplayTab model={model} input={input} level={level} onLevel={setLevel} selectedId={selectedId} onSelect={setSelectedId} wide={wide} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReplayTab({ model, input, level, onLevel, selectedId, onSelect, wide }: {
  model: JobModel;
  input: ReturnType<typeof buildReplayInput>;
  level: number;
  onLevel: (l: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wide: boolean;
}) {
  const styles = useThemedStyles(makeLivingModelStyles);
  const copy = useLivingModelCopy();
  const state = useReplayState(input);
  const roomTasks = useRoomTasks(model, input);
  const moments = useRoomMoments(roomTasks, input, state.offset, state.mode);
  const [no3d, setNo3d] = useState(false);
  const levels = useMemo(() => modelLevels(model), [model]);
  const selected = model.rooms.find((r) => r.id === selectedId && r.level === level) ?? null;
  const anyTicked = useMemo(() => Array.from(roomTasks.values()).some((t) => t.length > 0), [roomTasks]);
  const past = input.clock.hasStartDate ? state.offset > input.clock.todayOffset + 1e-6 : true;
  const atToday = input.clock.hasStartDate && Math.abs(state.offset - input.clock.todayOffset) < 0.26;
  const weekLine = copy.weekLabel(weekOf(state.offset, input.clock), weekCount(input.clock));
  const threeD = JOB_REPLAY_3D_ON_THIS_PLATFORM && !no3d;

  if (model.rooms.length === 0) {
    return (
      <View style={styles.panel}>
        <Text style={styles.para} testID="lm-replay-no-rooms">{copy.noRoomsBody}</Text>
        <HonestyLines />
      </View>
    );
  }

  const view = (
    <View style={wide ? styles.colMain : styles.stack}>
      {levels.length > 1 ? (
        <View style={styles.chips} accessibilityRole="tablist">
          {levels.map((l) => (
            <Pressable key={l} style={[styles.chip, l === level && styles.chipOn]} onPress={() => onLevel(l)} accessibilityRole="tab" accessibilityState={{ selected: l === level }} accessibilityLabel={copy.levelName(l)} testID={`lm-replay-level-${l}`}>
              <Text style={[styles.chipText, l === level && styles.chipTextOn]}>{copy.levelName(l)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {threeD ? (
        <>
          <JobReplay3D model={model} level={level} moments={moments} selectedId={selectedId} onSelect={onSelect} onUnavailable={() => setNo3d(true)} weekLine={weekLine} atToday={atToday} height={wide ? 560 : 380} compact={!wide} />
          {wide ? null : <StageLegend />}
          <Text style={styles.note}>{copy.orbitHelpSub}</Text>
        </>
      ) : (
        <>
          <View style={styles.panel} testID={JOB_REPLAY_3D_ON_THIS_PLATFORM ? 'lm-no-webgl' : 'lm-phone-note'}>
            {JOB_REPLAY_3D_ON_THIS_PLATFORM ? <Text style={styles.para}>{copy.noWebglBody}</Text> : (
              <>
                <Text style={styles.panelHeading}>{copy.phoneNoteTitleBody}</Text>
                <Text style={styles.para}>{copy.phoneNoteBody}</Text>
              </>
            )}
          </View>
          <FlatReplay model={model} level={level} moments={moments} selectedId={selectedId} onSelect={onSelect} />
          <StageLegend />
        </>
      )}
      <ReplayControls input={input} state={state} />
      {!anyTicked ? <Text style={styles.warn} testID="lm-nothing-ticked">{copy.nothingTickedBody}</Text> : null}
      <HonestyLines ghost={past} testID={threeD ? 'lm-honesty-3d' : 'lm-honesty-flat'} />
    </View>
  );
  const side = (
    <View style={wide ? styles.colSide : styles.stack}>
      {selected ? <RoomCardPanel room={selected} tasks={roomTasks.get(selected.id) ?? []} input={input} mode={state.mode} onClose={() => onSelect(null)} /> : null}
      <ReplayRoomList model={model} level={level} moments={moments} selectedId={selectedId} onSelect={onSelect} />
    </View>
  );
  return <View style={wide ? styles.bodyWide : styles.stack} testID="living-model-replay">{view}{side}</View>;
}
