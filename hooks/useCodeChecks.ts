/**
 * useCodeChecks — the saved code checks for one job (CONTRACT C8).
 *
 * The device copy (mageid_code_checks, erased on sign-out by the mageid_*
 * sweep) loads first. Then, once this seat on the job is known, the account
 * copy (public.code_checks) is read and merged in ONCE per mount per job
 * (utils/codeThread/cloudSync syncCodeChecksForProject); the merge lands in
 * the store, whose listener reloads the list here. When the seat later goes
 * from unknown (a role read that failed or went offline) or read-only back to
 * writable, setCodeCheckSeat re-runs that sync once (codeCheckResyncOwed), so
 * the caption never sticks on "couldn't reach your account" after the role
 * read recovers.
 *
 * `syncState` says where the checks are (ProjectCodeChecksCard
 * CODE_CHECKS_CAPTION): 'synced' only after the account read and every push
 * succeeded. 'failed' STATUS means the stored blob couldn't be read — show
 * "couldn't read saved checks", never "none".
 *
 * The seat: effectivePlanRole(useProjectRoleState(projectId).role, project,
 * user) — the owner fallback while the role read is pending or offline —
 * registered with setCodeCheckSeat so every push (including the store's
 * push after a save from the Code Check screen) uses the same gate.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCodeChecks, subscribeCodeChecks } from '@/utils/codeThread/store';
import {
  getCodeCheckSyncState, setCodeCheckSeat, syncCodeChecksForProject, type CodeCheckSyncState,
} from '@/utils/codeThread/cloudSync';
import type { CodeCheckRecord } from '@/utils/codeThread/types';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { effectivePlanRole } from '@/utils/plans/revisionActions';
import { isSampleProject } from '@/utils/sampleGuard';
import { seatReadStatus } from '@/utils/syncSeat';

/** The job's sync state, re-read on every store notification. Triggers nothing. */
export function useCodeCheckSyncState(projectId: string | null | undefined): CodeCheckSyncState {
  const [state, setState] = useState<CodeCheckSyncState>(() => getCodeCheckSyncState(projectId));
  useEffect(() => {
    setState(getCodeCheckSyncState(projectId));
    return subscribeCodeChecks(() => setState(getCodeCheckSyncState(projectId)));
  }, [projectId]);
  return state;
}

export function useCodeChecks(projectId: string | null | undefined): {
  status: 'loading' | 'ready' | 'failed';
  checks: CodeCheckRecord[];
  reload: () => void;
  syncState: CodeCheckSyncState;
} {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(projectId ? 'loading' : 'ready');
  const [checks, setChecks] = useState<CodeCheckRecord[]>([]);
  // Only the newest load may land (a fast job switch must not show the old job's checks).
  const seq = useRef(0);

  const { user } = useAuth();
  const { getProject } = useProjects();
  const project = projectId ? getProject(projectId) : null;
  const roleState = useProjectRoleState(projectId ?? undefined);
  const role = effectivePlanRole(roleState.role, project, user?.id);
  // #90: WHY the seat is unknown when it is — a failed or offline read, or a
  // settled null (not on this job) — so the caption never sits on "checking…".
  const readStatus = role === null
    ? seatReadStatus({ isLoading: roleState.isLoading, isError: roleState.isError, isPaused: roleState.isPaused })
    : 'none';
  const sample = !!project && isSampleProject(project);
  const syncState = useCodeCheckSyncState(projectId);

  const reload = useCallback(() => {
    const mine = ++seq.current;
    if (!projectId) {
      setChecks([]);
      setStatus('ready');
      return;
    }
    void loadCodeChecks(projectId).then((r) => {
      if (mine !== seq.current) return;
      if (r.ok) {
        setChecks(r.checks);
        setStatus('ready');
      } else {
        setStatus('failed');
      }
    });
  }, [projectId]);

  useEffect(() => {
    setStatus(projectId ? 'loading' : 'ready');
    reload();
    const unsub = subscribeCodeChecks(reload);
    const counter = seq;
    return () => {
      unsub();
      // Invalidate any load still in flight for this job.
      counter.current++;
    };
  }, [projectId, reload]);

  // Register this seat for the job whenever it changes. A recovery to a
  // writable seat after this mount's sync re-syncs inside setCodeCheckSeat.
  useEffect(() => {
    if (projectId) setCodeCheckSeat(projectId, role, { sample, readStatus });
  }, [projectId, role, sample, readStatus]);

  // The account merge: once per mount per job, after the local load and once
  // the seat is known. A job switch cancels the stale one's follow-up reload.
  const syncedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!projectId || status === 'loading' || role === null) return;
    if (syncedFor.current === projectId) return;
    syncedFor.current = projectId;
    let cancelled = false;
    void syncCodeChecksForProject(projectId).then(() => {
      if (!cancelled) reload();
    }, () => { /* the state says why */ });
    return () => { cancelled = true; };
  }, [projectId, status, role, reload]);

  return { status, checks, reload, syncState };
}
