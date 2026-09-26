// hooks/useScopeCostBook.ts — the learned price book, built exactly as
// app/(tabs)/estimate/review.tsx builds it (closed jobs, commitments, receipts,
// clocked labor samples and seeds). Scope Code Gaps and the RFI scope check
// both price through this + utils/scopePricing.scopeRateFor.
import { useMemo } from 'react';
import { buildCostDatabase, type CostDatabase } from '@/utils/costDatabase';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborCostSamples } from '@/hooks/useLaborRates';
import { useCostSeeds } from '@/hooks/useCostSeeds';

export function useScopeCostBook(): CostDatabase {
  const { projects, commitments } = useProjects();
  const { receipts } = useMaterialReceipts();
  const laborSamples = useLaborCostSamples();
  const { seeds } = useCostSeeds();
  return useMemo(
    () => buildCostDatabase(projects, commitments, receipts, laborSamples, seeds),
    [projects, commitments, receipts, laborSamples, seeds],
  );
}
