/**
 * useCodeChecks — the saved code checks for one job (CONTRACT C8).
 *
 * Local only: these records live on this device and are erased when he signs
 * out (the wipeLocalUserCache mageid_* sweep). Every surface that lists them
 * says 'on this device until you sign out'. 'failed' means the stored blob
 * couldn't be read — show "couldn't read saved checks", never "none".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadCodeChecks, subscribeCodeChecks } from '@/utils/codeThread/store';
import type { CodeCheckRecord } from '@/utils/codeThread/types';

export function useCodeChecks(projectId: string | null | undefined): {
  status: 'loading' | 'ready' | 'failed';
  checks: CodeCheckRecord[];
  reload: () => void;
} {
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>(projectId ? 'loading' : 'ready');
  const [checks, setChecks] = useState<CodeCheckRecord[]>([]);
  // Only the newest load may land (a fast job switch must not show the old job's checks).
  const seq = useRef(0);

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

  return { status, checks, reload };
}
