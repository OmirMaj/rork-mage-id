// components/livingModel/LivingModelScreen.tsx — the Living Model for one job.
//
// The Living Model, Phase 1 (dark behind LIVING_MODEL_ENABLED, owner preview).
// Three views of one job model:
//   Rooms       the Room Editor: make the model from typed sizes and saved scans.
//   Tasks       tick which schedule tasks happen in each room.
//   Job Replay  play the job from start to finish, planned against reported.
//               In 3D on the web; drawn flat on the phone, which says so.
//
// The model is SAVED ON THIS DEVICE FIRST (utils/livingModel/storeCore), at
// every change, and then to the person's account when it can be
// (hooks/useLivingModelSync; the rules are utils/livingModel/syncCore). One
// line under the tabs says where it is saved, and is true at that moment
// (SyncStatus). Every change is the person's: this screen writes the model
// after he changes it. The one time the model on screen is replaced without a
// tap is when the account holds a later save and this device has no changes of
// its own; when BOTH have changed he is asked, and nothing is replaced first.
//
// A SAVED MODEL THAT CANNOT BE READ IS KEPT. When text is stored for this job
// and it is not a sound model, the screen says so in a plain sentence, the text
// stays where it is with a copy under a backup key (utils/livingModel/store),
// and NOTHING IS SAVED OVER IT until the person taps Start a New Model. Until
// then the tabs are not drawn at all, so there is nothing to edit.
//
// NOT IN THIS PHASE, and not built: a money lens, open items, a client view,
// sharing a replay, reading rooms from an uploaded plan, syncing the scan list
// (a scan stays on the phone that made it; only a room placed in the model is
// sent, and only after he says yes). The seams
// are the model (JobModel), the per-room moment (replayCore.roomMoment) and the
// 3D view's `looks`; nothing here depends on how those later features are made.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useProjects } from '@/contexts/ProjectContext';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import { useLivingModelCopy } from '@/hooks/useLivingModelCopy';
import { useLivingModelSync } from '@/hooks/useLivingModelSync';
import { useProjectCollaborators } from '@/hooks/useProjectCollaborators';
import { Button, SegmentedControl } from '@/components/ui';
import { useIsDesktop } from '@/components/ui/desktop';
import { canRedo, canUndo, historyOf, historyPush, historyRedo, historyUndo, type History } from '@/utils/livingModel/historyCore';
import { emptyJobModel, modelLevels } from '@/utils/livingModel/modelCore';
import { cardWhen, weekCount, weekOf } from '@/utils/livingModel/replayCore';
import { buildReplayInput } from '@/utils/livingModel/replayInput';
import { loadJobModel, saveJobModel } from '@/utils/livingModel/store';
import { mayWriteModel, type LoadState } from '@/utils/livingModel/storeCore';
import { scanRoomIds } from '@/utils/livingModel/syncCore';
import type { JobModel } from '@/utils/livingModel/types';
import { FlatReplay } from './FlatReplay';
import { HonestyLines } from './HonestyLines';
import { JOB_REPLAY_3D_ON_THIS_PLATFORM, JobReplay3D } from './JobReplay3D';
import { RoomEditor } from './RoomEditor';
import { SyncStatus } from './SyncStatus';
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
  const [loadState, setLoadState] = useState<LoadState>('ready');
  const loadStateRef = useRef<LoadState>('ready');
  const [tab, setTab] = useState<Tab>('rooms');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [now] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    setHistory(null);
    loadStateRef.current = 'ready';
    setLoadState('ready');
    // loadJobModel never rejects and never throws on what the device holds; the catch is a last guard so the screen cannot sit on "Reading" for ever.
    void loadJobModel(userId, projectId).then((loaded) => {
      if (!alive) return;
      loadStateRef.current = loaded.state;
      setLoadState(loaded.state);
      setHistory(historyOf(loaded.model));
      const levels = modelLevels(loaded.model);
      setLevel(levels.includes(0) || levels.length === 0 ? 0 : levels[0]);
    }).catch(() => {
      if (!alive) return;
      loadStateRef.current = 'unreadable';
      setLoadState('unreadable');
      setHistory(historyOf(emptyJobModel(projectId)));
    });
    return () => { alive = false; };
  }, [userId, projectId]);

  const persist = useCallback((m: JobModel) => {
    // Never over text that could not be read: the store refuses too.
    if (!mayWriteModel(loadStateRef.current)) return;
    void saveJobModel(userId, m, new Date().toISOString(), loadStateRef.current).then((ok) => setSaveFailed(!ok));
  }, [userId]);

  /** The person's own choice, from the button: leave the unread model in its backup and begin again. */
  const onStartNew = useCallback(() => {
    loadStateRef.current = 'started_new';
    setLoadState('started_new');
  }, []);

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
  /** The device's model was replaced by the account's, or by one he had set aside: show it. The undo list starts again. */
  const onAdopt = useCallback((m: JobModel) => {
    setHistory(historyOf(m));
    setSelectedId(null);
    const levels = modelLevels(m);
    setLevel((l) => (levels.length === 0 || levels.includes(l) ? l : levels[0]));
  }, []);
  const sync = useLivingModelSync({ projectId, userId, project, model, loadState, onAdopt });
  const { collaborators } = useProjectCollaborators(projectId);
  const nameOf = useCallback((id: string | null): string | null => {
    if (!id) return null;
    const c = collaborators.find((x) => x.userId === id);
    return c ? (c.name || c.email || null) : null;
  }, [collaborators]);
  const hasScanRoom = useMemo(() => (model ? scanRoomIds(model).length > 0 : false), [model]);
  const reports = useMemo(() => getDailyReportsForProject(projectId), [getDailyReportsForProject, projectId]);
  const chosenStages = model?.stages;
  const input = useMemo(() => buildReplayInput(project?.schedule ?? null, reports, now, chosenStages), [project?.schedule, reports, now, chosenStages]);
  const blocked = loadState === 'unreadable';
  const onSetStartDate = useCallback(() => router.push({ pathname: '/schedule-pro', params: { projectId } }), [router, projectId]);

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
        {model && blocked ? (
          <View style={styles.panel} testID="lm-unreadable">
            <Text style={styles.panelHeading}>{copy.unreadableTitleBody}</Text>
            <Text style={styles.para}>{copy.unreadableBody}</Text>
            <Button label={copy.startNewLabel} variant="secondary" onPress={onStartNew} testID="lm-start-new" />
          </View>
        ) : null}
        {model && loadState === 'started_new' ? <Text style={styles.note} testID="lm-started-new">{copy.startedNewBody}</Text> : null}
        {model && !blocked ? <SyncStatus sync={sync} deviceRooms={model.rooms.length} hasScanRoom={hasScanRoom} nameOf={nameOf} /> : null}
        {model && !blocked && tab === 'rooms' ? (
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
        {model && !blocked && tab === 'tasks' ? (
          <TaskLinks model={model} input={input} roomId={selectedId} onRoom={setSelectedId} onChange={onChange} />
        ) : null}
        {model && !blocked && tab === 'replay' ? (
          <ReplayTab model={model} input={input} level={level} onLevel={setLevel} selectedId={selectedId} onSelect={setSelectedId} wide={wide} onSetStartDate={onSetStartDate} />
        ) : null}
      </ScrollView>
    </View>
  );
}

function ReplayTab({ model, input, level, onLevel, selectedId, onSelect, wide, onSetStartDate }: {
  model: JobModel;
  input: ReturnType<typeof buildReplayInput>;
  level: number;
  onLevel: (l: number) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  wide: boolean;
  onSetStartDate: () => void;
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
  const atToday = cardWhen(state.offset, input.clock) === 'today';
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
          <Text style={styles.note} testID="lm-3d-hint">{wide ? copy.orbitHelpSub : copy.touchHelpSub}</Text>
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
      <ReplayControls input={input} state={state} onSetStartDate={onSetStartDate} />
      {!anyTicked ? <Text style={styles.warn} testID="lm-nothing-ticked">{copy.nothingTickedBody}</Text> : null}
      <HonestyLines ghost={past} testID={threeD ? 'lm-honesty-3d' : 'lm-honesty-flat'} />
    </View>
  );
  const side = (
    <View style={wide ? styles.colSide : styles.stack}>
      {selected ? <RoomCardPanel room={selected} tasks={roomTasks.get(selected.id) ?? []} input={input} mode={state.mode} offset={state.offset} onClose={() => onSelect(null)} /> : null}
      <ReplayRoomList model={model} level={level} moments={moments} selectedId={selectedId} onSelect={onSelect} />
    </View>
  );
  return <View style={wide ? styles.bodyWide : styles.stack} testID="living-model-replay">{view}{side}</View>;
}
