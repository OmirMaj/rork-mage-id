// hooks/useReviewBenchmark.ts — the measured NYC DOB review time for a job's
// borough, as a MeasuredReviewLead resolvePermitReviewLead can use.
//
// null unless the job is in New York City AND the contractor has confirmed its
// building (the borough comes from that confirmation, never from a guess at
// the address). Below MEASURED_LEAD_FLOOR filings it is null too: a thin
// benchmark is not a measurement worth a hard date.
//
// The number is the median days from filing to approval for STANDARD PLAN
// EXAMINATION alteration filings APPROVED in the last 12 months (NYC Open
// Data w9ak-ipjd). Filings still in review are not in it — which biases it
// short — so the detail says "approved filings only" every time it prints.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Project } from '@/types';
import type { ReviewBenchmark } from '@/utils/buildingRecord';
import { measuredLeadFromBenchmark, type MeasuredReviewLead } from '@/utils/automation/learnedLeadTime';
import { fetchReviewBenchmark } from '@/utils/buildingRecordClient';
import { useConfirmedBuilding } from '@/hooks/useBuildingRecord';

const DAY_MS = 24 * 60 * 60 * 1000;
export const REVIEW_BENCHMARK_STALE_MS = 7 * DAY_MS;

export function useReviewBenchmark(project: Project | null | undefined): MeasuredReviewLead | null {
  const { supported, confirmed } = useConfirmedBuilding(project);
  const borough = supported && confirmed ? confirmed.borough.trim().toUpperCase() : '';

  const q = useQuery({
    queryKey: ['review-benchmark', borough],
    enabled: supported && !!borough,
    staleTime: REVIEW_BENCHMARK_STALE_MS,
    retry: false,
    queryFn: async (): Promise<ReviewBenchmark | null> => {
      const res = await fetchReviewBenchmark(borough);
      return res.status === 'benchmark' ? res.benchmark : null;
    },
  });

  const data = supported && borough ? q.data ?? null : null;
  return useMemo(() => measuredLeadFromBenchmark(data), [data]);
}

export default useReviewBenchmark;
