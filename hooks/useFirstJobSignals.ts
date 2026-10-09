// hooks/useFirstJobSignals.ts — reads the account's REAL data and turns it
// into the seven done / not done / not known signals of "Your First Job"
// (utils/firstJobPath.signalsFromData). Nothing in here can be set by a tap on
// the card: a step turns done only because the work exists.
//
// Counts are over owned, non-sample projects (utils/projectCap), the same set
// Home's free-plan cap and the old card count. A sample job ticks nothing, and
// neither does work on a job another contractor shared with him.
//
// WHERE EACH SIGNAL COMES FROM
//   company   settings.branding.companyName
//   prices    hooks/useCostSeeds (live seeded rates)
//   estimate  estimateCount, computed by Home exactly as before
//   send      any of: the stamp the estimate wizard writes on the project when
//             its PDF is shared (quotedPaymentSplit.sharedAt); a proposal or
//             contract row out of draft (project_contracts sent / signed); the
//             local mark the other shares write (utils/firstJobStore)
//   schedule  project.schedule.tasks
//   daily     dailyReports
//   invoice   invoiceCount, computed by Home exactly as before
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useCostSeeds } from '@/hooks/useCostSeeds';
import { countsTowardFreeCap } from '@/utils/projectCap';
import { quotedSplitOf } from '@/utils/paymentTerms';
import { effectiveEstimateTotal } from '@/utils/estimateCommit';
import {
  signalsFromData, type FirstJobData, type FirstJobProject, type FirstJobSignals,
} from '@/utils/firstJobPath';
import { fetchSentContractProjectIds, readEstimateSent, subscribeEstimateSent } from '@/utils/firstJobStore';

export interface FirstJobSignalsResult {
  signals: FirstJobSignals;
  /** His real projects, reduced to what the card needs to pick a target. */
  projects: FirstJobProject[];
}

const SENT_RECHECK_MS = 60 * 1000;

function stamp(p: { updatedAt?: string; createdAt?: string }): number {
  const t = Date.parse(p.updatedAt ?? '') || Date.parse(p.createdAt ?? '') || 0;
  return Number.isFinite(t) ? t : 0;
}

export function useFirstJobSignals(a: {
  /** False until he is on the path (the question is answered): no proposal read is made before that. */
  active: boolean;
  estimateCount: number;
  invoiceCount: number;
  realProjectCount: number;
}): FirstJobSignalsResult {
  const {
    projects, settings, dailyReports, projectsLoaded, settingsLoaded, invoicesLoaded, dailyReportsLoaded,
  } = useProjects();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { seeds, isLoading: seedsLoading } = useCostSeeds();

  const real = useMemo(() => projects.filter((p) => countsTowardFreeCap(p, userId)), [projects, userId]);
  const realIds = useMemo(() => new Set(real.map((p) => p.id)), [real]);

  const reduced = useMemo<FirstJobProject[]>(() => real.map((p) => ({
    id: p.id,
    hasEstimate: (p.linkedEstimate?.items?.length ?? 0) > 0
      || (p.estimate?.materials?.length ?? 0) > 0
      || effectiveEstimateTotal(p) > 0,
    hasSchedule: (p.schedule?.tasks?.length ?? 0) > 0,
    updatedAt: stamp(p),
  })), [real]);

  const sharedEstimateCount = useMemo(() => real.filter((p) => !!quotedSplitOf(p)?.sharedAt).length, [real]);
  const scheduleCount = useMemo(() => reduced.filter((p) => p.hasSchedule).length, [reduced]);
  const dailyReportCount = useMemo(
    () => dailyReports.filter((r) => realIds.has(r.projectId)).length,
    [dailyReports, realIds],
  );

  // The local "an estimate left this phone" mark. Re-read when Home comes back
  // into view and when a share writes it.
  const [sentMarker, setSentMarker] = useState<boolean | undefined>(undefined);
  const readMarker = useCallback(() => {
    if (!userId) { setSentMarker(false); return; }
    let cancelled = false;
    void readEstimateSent(userId).then((v) => { if (!cancelled) setSentMarker(v); });
    return () => { cancelled = true; };
  }, [userId]);
  useEffect(() => { setSentMarker(undefined); }, [userId]);
  useFocusEffect(readMarker);
  useEffect(() => subscribeEstimateSent(() => { readMarker(); }), [readMarker]);

  // Proposals and contracts out of draft. Only asked while the card is on
  // screen and nothing else has already answered the step. A failed read is
  // "could not check", never "not sent".
  const sentElsewhere = sharedEstimateCount > 0 || sentMarker === true;
  const contractsEnabled = a.active && !!userId && projectsLoaded && real.length > 0 && !sentElsewhere;
  const contractsQ = useQuery({
    queryKey: ['firstJobSentContracts', userId],
    enabled: contractsEnabled,
    staleTime: SENT_RECHECK_MS,
    queryFn: () => fetchSentContractProjectIds(userId as string),
  });
  // Asked again when Home comes back into view (he may have just sent one),
  // but not more than once a minute, counted from the last ANSWER of either
  // kind: with the network down there is no success to count from, and every
  // return to Home would otherwise ask again with its retries. A read already
  // on its way is left alone, never cancelled and restarted.
  const refetchContracts = contractsQ.refetch;
  const contractsAt = Math.max(contractsQ.dataUpdatedAt || 0, contractsQ.errorUpdatedAt || 0);
  const contractsFetching = contractsQ.isFetching;
  useFocusEffect(useCallback(() => {
    if (!contractsEnabled || contractsFetching) return;
    if (Date.now() - contractsAt > SENT_RECHECK_MS) void refetchContracts({ cancelRefetch: false });
  }, [contractsEnabled, contractsFetching, contractsAt, refetchContracts]));
  const sentContractCount = useMemo(
    () => (contractsQ.data ?? []).filter((id) => realIds.has(id)).length,
    [contractsQ.data, realIds],
  );
  // With no real project there is nothing a proposal could hang on: that is a
  // real "none", not an unread list.
  const contractsRead: FirstJobData['contractsRead'] = projectsLoaded && real.length === 0 ? 'ok'
    : contractsQ.data !== undefined ? 'ok'
    : contractsQ.isError && !contractsQ.isFetching ? 'failed'
    : 'loading';

  const signals = useMemo(() => signalsFromData({
    settingsLoaded,
    companyName: settings?.branding?.companyName,
    pricesLoaded: !seedsLoading,
    priceCount: seeds.length,
    projectsLoaded,
    realProjectCount: a.realProjectCount,
    estimateCount: a.estimateCount,
    sharedEstimateCount,
    contractsRead,
    sentContractCount,
    sentMarker,
    scheduleCount,
    dailyReportsLoaded,
    dailyReportCount,
    invoicesLoaded,
    invoiceCount: a.invoiceCount,
  }), [
    settingsLoaded, settings?.branding?.companyName, seedsLoading, seeds.length, projectsLoaded,
    a.realProjectCount, a.estimateCount, sharedEstimateCount, contractsRead, sentContractCount, sentMarker,
    scheduleCount, dailyReportsLoaded, dailyReportCount, invoicesLoaded, a.invoiceCount,
  ]);

  return useMemo(() => ({ signals, projects: reduced }), [signals, reduced]);
}
