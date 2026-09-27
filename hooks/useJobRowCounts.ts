// hooks/useJobRowCounts.ts — the THIS JOB row counts for the desktop sidebar
// (wave 6d, d6r lane K3; contract D16). The arithmetic is utils/sidebarCounts
// (pure, validated); this hook only gathers its inputs and loading signals.
//
// Called from a CHILD of DesktopSidebar (the THIS JOB section), so it only
// runs where those rows render — and the sidebar itself never renders on a
// phone (the tabs layout's shellEligible gate).
//
// Loading signals (contract D9): the RFI and submittal logs wait on
// useCollectionSettled (RfiLog / SubmittalLog use exactly this), change orders
// and punch items on their context `…Loaded` flags. The two collection reads
// are LATCHED (utils/sidebarCounts latchLoaded): once a read has settled
// without failing the row stays counted through background refetches — opening
// the RFI log refetches ['rfis'], and a fresh `settled && !failed` would blink
// the count off and on under the founder's click. A failed read unlatches; a
// different signed-in user starts over.

import { useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useDocsData, useFieldData, useFinancialsData } from '@/contexts/ProjectContext';
import { useCollectionSettled } from '@/hooks/useCollectionSettled';
import { jobRowCounts, latchLoaded, type CollectionRead, type CountedRow, type RowCount } from '@/utils/sidebarCounts';

/** latchLoaded held across renders, restarted (false) when the user changes.
 *  Stored in state and corrected during render (React's "adjust state when a
 *  prop changes" pattern), so the value returned is always this render's. */
function useLoadedLatch(read: CollectionRead, userId: string | null): boolean {
  const [latch, setLatch] = useState<{ userId: string | null; loaded: boolean }>({ userId, loaded: false });
  const loaded = latchLoaded(latch.userId === userId ? latch.loaded : false, read);
  if (latch.userId !== userId || latch.loaded !== loaded) setLatch({ userId, loaded });
  return loaded;
}

export function useJobRowCounts(jobId: string | null | undefined): Partial<Record<CountedRow, RowCount>> {
  const { rfis, submittals } = useDocsData();
  const rfiRead = useCollectionSettled('rfis', undefined);
  const submittalRead = useCollectionSettled('submittals', undefined);
  const { changeOrders, changeOrdersLoaded } = useFinancialsData();
  const { punchItems, punchItemsLoaded } = useFieldData();
  const userId = useAuth().user?.id ?? null;
  const rfisLoaded = useLoadedLatch(rfiRead, userId);
  const submittalsLoaded = useLoadedLatch(submittalRead, userId);
  // Overdue / late are calendar-day facts: the counts recompute on the next
  // render after midnight (the sidebar re-renders on every navigation), not on
  // a timer.
  const day = new Date().toDateString();
  return useMemo(
    () => jobRowCounts({
      projectId: jobId,
      loaded: { rfis: rfisLoaded, submittals: submittalsLoaded, co: changeOrdersLoaded, punch: punchItemsLoaded },
      rfis,
      submittals,
      changeOrders,
      punchItems,
      now: new Date(),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobId, rfisLoaded, submittalsLoaded, changeOrdersLoaded, punchItemsLoaded, rfis, submittals, changeOrders, punchItems, day],
  );
}
