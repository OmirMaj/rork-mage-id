// components/demoJob/DemoJobScreen.tsx — the owner's Demo Job builder.
//
// One screen, three states read from the account itself (never from a note on
// the device): no demo job, a demo job that is part way, a complete one. It
// creates, finishes and removes the job through utils/demoJob/writer, which
// only ever calls the app's own add and delete functions (the ports).
//
// NOTHING IS OFFERED UNTIL THE APP HAS READ ITS PROJECT LIST (`ready`): before
// that an empty list is not "no demo job", and Create would make a second one.
// A second tap is stopped by a ref, not by state: two taps in one frame both
// see the same render. Remove names the job or jobs it will delete, and how
// many, and deletes exactly those.
//
// The route (app/demo-job.tsx) does the owner check; this component is handed
// its ports so the smoke test can run it against a stand-in app.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { Button } from '@/components/ui';
import { makeDemoJobStyles } from '@/components/demoJob/styles';
import { useTheme } from '@/contexts/ThemeContext';
import { useThemedStyles } from '@/hooks/useThemedStyles';
import type { DemoJobCopy } from '@/hooks/useDemoJobCopy';
import { buildDemoJob, type DemoJob } from '@/utils/demoJob/build';
import { demoSeedDayFromStart } from '@/utils/demoJob/clock';
import { noteDemoProjectId } from '@/utils/demoJob/marker';
import {
  createDemoJob, demoStatus, existingDemoProjects, removeDemoJob,
  type AreaKey, type AreaStatus, type DemoFailure, type DemoPorts, type DemoState,
} from '@/utils/demoJob/writer';

export interface DemoJobScreenProps {
  ports: DemoPorts;
  copy: DemoJobCopy;
  userId: string;
  contractorName: string;
  /** The device's local day, 'YYYY-MM-DD' (utils/calendarDate.todayCalendarDay). */
  today: string;
  /** A fresh project id for a job that does not exist yet. */
  newProjectId: () => string;
  offline: boolean;
  /** True once the app has read its project list (ProjectContext.projectsLoaded). */
  ready: boolean;
  topInset: number;
  onBack: () => void;
  onOpenJob: (projectId: string) => void;
  /** The schedule start date of a demo project that already exists, to rebuild the same calendar. */
  startDateOf: (projectId: string) => string | null;
}

type Phase = 'checking' | 'idle' | 'working' | 'removing';

export function DemoJobScreen(props: DemoJobScreenProps) {
  const { ports, copy, userId, contractorName, today, newProjectId, offline, ready, topInset, onBack, onOpenJob, startDateOf } = props;
  const styles = useThemedStyles(makeDemoJobStyles);
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>('checking');
  const [state, setState] = useState<DemoState>('none');
  const [areas, setAreas] = useState<AreaStatus[]>([]);
  const [failures, setFailures] = useState<DemoFailure[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  /** The jobs the open confirmation names. Remove deletes these and no others. */
  const [confirmJobs, setConfirmJobs] = useState<{ id: string; name: string }[] | null>(null);
  const [demoCount, setDemoCount] = useState(0);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [taskCount, setTaskCount] = useState(1);
  const freshId = useRef<string | null>(null);
  /** One create or remove at a time. A ref, so a second tap in the same frame is stopped too. */
  const running = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /** The job as it is, or as it would be made: an existing demo keeps its own id and its own dates. */
  const jobNow = useCallback((): DemoJob => {
    const existing = existingDemoProjects(ports.world())[0];
    if (!existing && !freshId.current) freshId.current = newProjectId();
    const projectId = existing?.id ?? (freshId.current as string);
    const seedDay = (existing ? demoSeedDayFromStart(startDateOf(existing.id)) : null) ?? today;
    return buildDemoJob({ userId, projectId, today: seedDay, contractorName });
  }, [ports, newProjectId, startDateOf, today, userId, contractorName]);

  const refresh = useCallback(async () => {
    const job = jobNow();
    const res = await demoStatus(job, ports);
    if (!alive.current) return;
    const found = existingDemoProjects(ports.world());
    setDemoCount(found.length);
    setProjectId(found[0]?.id ?? null);
    setTaskCount(job.project.schedule?.tasks.length ?? 1);
    setState(res.state);
    setAreas(res.areas);
  }, [jobNow, ports]);

  useEffect(() => {
    // Until the project list is read the screen keeps saying it is checking and offers nothing.
    if (!ready) return;
    void refresh().finally(() => { if (alive.current) setPhase((p) => (p === 'checking' ? 'idle' : p)); });
  }, [refresh, ready]);

  const create = useCallback(async () => {
    if (!ready || running.current) return;
    running.current = true;
    try {
      setPhase('working');
      setMessage(null);
      setFailures([]);
      const job = jobNow();
      // Known to analytics before the first write, so not one event of the demo is sent.
      noteDemoProjectId(job.project.id);
      const res = await createDemoJob(job, ports, (p) => {
        if (!alive.current) return;
        setAreas((prev) => {
          const next = prev.length ? [...prev] : [];
          const i = next.findIndex((a) => a.key === p.key);
          const row: AreaStatus = { key: p.key, present: p.done, total: p.total, needsConnection: i >= 0 ? next[i].needsConnection : false };
          if (i >= 0) next[i] = row; else next.push(row);
          return next;
        });
      });
      if (!alive.current) return;
      if (res.refused === 'queue_full') setMessage(copy.queueFullBody);
      if (res.refused === 'exists_elsewhere') setMessage(copy.twoJobsBody);
      setFailures(res.failures);
      await refresh();
      if (alive.current) setPhase('idle');
    } finally {
      running.current = false;
    }
  }, [ready, jobNow, ports, copy, refresh]);

  const askRemove = useCallback(() => {
    if (running.current) return;
    setConfirmJobs(existingDemoProjects(ports.world()));
  }, [ports]);

  const remove = useCallback(async () => {
    const named = confirmJobs;
    if (!ready || !named || named.length === 0 || running.current) return;
    running.current = true;
    try {
      setConfirmJobs(null);
      setPhase('removing');
      setMessage(null);
      setFailures([]);
      let refused: string | null = null;
      // Exactly the jobs the confirmation named, each only while it still carries the builder's stamp.
      const still = new Set(existingDemoProjects(ports.world()).map((p) => p.id));
      for (const p of named) {
        if (!still.has(p.id)) continue;
        const res = await removeDemoJob(p.id, ports);
        if (!res.ok) { refused = res.reason ?? ''; break; }
      }
      if (!alive.current) return;
      // A job made after this one must not reuse its id.
      freshId.current = null;
      await refresh();
      if (!alive.current) return;
      setMessage(refused !== null ? copy.removeRefusedBody(refused) : copy.removedBody);
      setPhase('idle');
    } finally {
      running.current = false;
    }
  }, [ready, confirmJobs, ports, copy, refresh]);

  const busy = phase !== 'idle';
  const tooMany = demoCount > 1;
  const failed = useMemo(() => new Map(failures.map((f) => [f.key, f] as const)), [failures]);
  const stateBody = phase === 'checking' ? copy.checkingBody
    : phase === 'working' ? copy.workingBody
    : phase === 'removing' ? copy.removingBody
    : tooMany ? copy.twoJobsBody
    : state === 'none' ? copy.noneBody
    : state === 'partial' ? copy.partialBody
    : copy.completeBody;

  // The project area is one record; it is shown as its schedule's task count ("Schedule Tasks: 120 of 120").
  const shown = (a: AreaStatus): { done: number; total: number } =>
    (a.key === ('project' as AreaKey) ? { done: a.present * taskCount, total: a.total * taskCount } : { done: a.present, total: a.total });

  return (
    <View style={[styles.screen, { paddingTop: topInset }]} testID="demo-job-screen">
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel={copy.backLabel} testID="demo-job-back">
          <ChevronLeft size={22} color={colors.text} strokeWidth={1.75} />
        </TouchableOpacity>
        <View style={styles.headerMain}>
          <Text style={styles.headerName}>{copy.titleLabel}</Text>
          <Text style={styles.headerSub}>{copy.ownerPreviewSub}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.narrow}>
          <View style={styles.panel}>
            <Text style={styles.para} testID="demo-job-intro">{copy.introBody}</Text>
            <Text style={styles.note}>{copy.whatBody}</Text>
            <Text style={styles.note}>{copy.limitsBody}</Text>
            <Text style={styles.note}>{copy.modelBody}</Text>
            <Text style={styles.note}>{copy.briefBody}</Text>
            {offline ? <Text style={styles.warn} testID="demo-job-offline">{copy.offlineBody}</Text> : null}
          </View>

          <View style={styles.panel}>
            <Text style={styles.noteStrong} testID="demo-job-state">{stateBody}</Text>
            {message ? <Text style={styles.warn} testID="demo-job-message">{message}</Text> : null}
            {confirmJobs ? (
              <View style={styles.stack}>
                <Text style={styles.para} testID="demo-job-remove-names">{copy.confirmRemoveBody(confirmJobs.length, confirmJobs.map((j) => j.name).join(', '))}</Text>
                <View style={styles.toolbar}>
                  <Button label={copy.confirmRemoveLabel} variant="destructive" onPress={() => { void remove(); }} disabled={busy} testID="demo-job-remove-confirm" />
                  <Button label={copy.keepLabel} variant="secondary" onPress={() => setConfirmJobs(null)} disabled={busy} testID="demo-job-remove-cancel" />
                </View>
              </View>
            ) : phase === 'checking' ? null : (
              <View style={styles.toolbar}>
                {state === 'none' && !tooMany ? (
                  <Button label={copy.createLabel} variant="primary" onPress={() => { void create(); }} disabled={busy} loading={phase === 'working'} testID="demo-job-create" />
                ) : null}
                {state === 'partial' && !tooMany ? (
                  <Button label={copy.finishLabel} variant="primary" onPress={() => { void create(); }} disabled={busy} loading={phase === 'working'} testID="demo-job-finish" />
                ) : null}
                {state === 'complete' && projectId && !tooMany ? (
                  <Button label={copy.openJobLabel} variant="primary" onPress={() => onOpenJob(projectId)} disabled={busy} testID="demo-job-open" />
                ) : null}
                {state !== 'none' || tooMany ? (
                  <Button label={copy.removeLabel} variant="secondary" onPress={askRemove} disabled={busy} loading={phase === 'removing'} testID="demo-job-remove" />
                ) : null}
              </View>
            )}
          </View>

          {areas.length > 0 && (state !== 'none' || phase === 'working') ? (
            <View style={styles.panel} testID="demo-job-areas">
              <Text style={styles.eyebrow}>{copy.progressLabel}</Text>
              {areas.map((a, i) => {
                const n = shown(a);
                const f = failed.get(a.key);
                return (
                  <View key={a.key} style={[styles.row, i === 0 ? styles.rowFirst : null]}>
                    <View style={styles.rowMain}>
                      <Text style={styles.rowLabel} testID={`demo-job-area-${a.key}`}>{copy.countLine(copy.areaLabel(a.key), n.done, n.total)}</Text>
                      {f ? <Text style={styles.warn} testID={`demo-job-failed-${a.key}`}>{`${copy.failedLabel}. ${f.message}`}</Text>
                        : a.needsConnection && n.done < n.total ? <Text style={styles.rowSub}>{copy.needsConnectionSub}</Text> : null}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
