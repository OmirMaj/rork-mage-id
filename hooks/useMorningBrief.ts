// hooks/useMorningBrief.ts — assembles the Morning Brief's inputs and runs
// the pure composer. Shared by the pinned home card and the /brief screen so
// the two surfaces can never disagree about what the morning looks like.
//
// Sync inputs come straight from the contexts. The four async sources —
// open leak flags (prediction ledger), the cash-flow forecast, yesterday's
// did-for-you ledger entries, and the graded accuracy report — each load in
// their own try/catch (factBlocks' additive pattern): a failing source
// degrades to its honest fallback instead of blanking the brief.

import { useEffect, useMemo, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProjects, useFinancialsData } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSafety } from '@/contexts/SafetyContext';
import {
  composeBrief, localDateISO, type MorningBrief, type OpenLeakSummary,
} from '@/utils/brief/composeBrief';
import { DID_FOR_YOU_KEY, parseDidForYouEntries, type DidForYouEntry } from '@/utils/brain/didForYou';
import type { CashFlowSummary } from '@/utils/cashFlowEngine';
import type { AccuracyReport } from '@/utils/brain/accuracyReport';

interface AsyncInputs {
  openLeakFlags: OpenLeakSummary | null;
  cashSummary: CashFlowSummary | null;
  didForYouEntries: DidForYouEntry[];
  accuracyReport: AccuracyReport | null;
}

const EMPTY_ASYNC: AsyncInputs = {
  openLeakFlags: null,
  cashSummary: null,
  didForYouEntries: [],
  accuracyReport: null,
};

export function useMorningBrief(opts: { enabled?: boolean } = {}): {
  brief: MorningBrief;
  loading: boolean;
  refresh: () => void;
} {
  const enabled = opts.enabled !== false;
  // rfis + submittals (#117, audit 2026-09-22): composeBrief has always had an
  // overdue-RFI and a stuck-submittal check, and this — its only caller — never
  // handed it either list, so an RFI past its required date with the architect
  // holding the ball never reached the brief. Passed straight through, no
  // `?? []`: the context always provides arrays, and an empty one means
  // "checked, none found", which is what briefScope then says.
  const {
    projects, invoices, changeOrders, punchItems, permits, dailyReports, deliveries,
    buildingAccessRules, accessReservations, rfis, submittals,
  } = useProjects();
  const safety = useSafety();
  // Signed subcontracts and POs, and the user id for the SERVER cash-flow row —
  // see the cash forecast below.
  const { commitments } = useFinancialsData();
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [asyncInputs, setAsyncInputs] = useState<AsyncInputs>(EMPTY_ASYNC);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const next: AsyncInputs = { ...EMPTY_ASYNC };

      // Open leak flags — deduped unresolved rows; null on failure lets the
      // composer's pure 14-day report-scan fallback take over.
      //
      // The comment above was not true until #122 (audit 2026-09-22): the
      // ledger read swallowed a failure to [] (and cached it), so offline this
      // set { count: 0 } — "checked, no flags" — the fallback never ran and the
      // "$X of flagged extra work" line vanished. The Result read says which it
      // was; only a read that WORKED may state a count.
      try {
        const { fetchOpenPredictionsDedupedResult } = await import('@/utils/brain/predictionLedger');
        const res = await fetchOpenPredictionsDedupedResult(['leak_flag']);
        if (res.ok) {
          let estTotal = 0;
          for (const row of res.rows) {
            const items = (row.payload as { items?: { estPrice?: number | null }[] }).items ?? [];
            for (const item of items) estTotal += item.estPrice ?? 0;
          }
          next.openLeakFlags = { count: res.rows.length, estTotal };
        }
      } catch { /* additive */ }

      // Cash forecast — only when the user finished cash-flow setup. The SAME
      // forecast as the Summary tile and /cash-flow (buildForecastInputs): it
      // used to read the device cache only (no user id — so on the web or a
      // second phone it acted as if cash flow was never set up) and leave out
      // signed subcontracts and POs, so a subcontract draw that overdraws the
      // account showed red on the tile and never reached "Cash dips to …".
      try {
        const [{ loadCashFlowSettings }, engine] = await Promise.all([
          import('@/utils/cashFlowStorage'),
          import('@/utils/cashFlowEngine'),
        ]);
        const settings = await loadCashFlowSettings(userId);
        if (settings.setupComplete) {
          const inputs = engine.buildForecastInputs({
            cashData: settings.data, invoices, commitments, projects, changeOrders,
          });
          next.cashSummary = engine.calculateSummary(engine.forecastFromInputs(inputs, 12));
        }
      } catch { /* additive */ }

      // Yesterday's did-for-you ledger entries.
      try {
        const raw = await AsyncStorage.getItem(DID_FOR_YOU_KEY);
        next.didForYouEntries = parseDidForYouEntries(raw);
      } catch { /* additive */ }

      // Accuracy report — the self-correction line source.
      // A failed read leaves it null (no line), never a report built from zero
      // rows.
      try {
        const [{ fetchResolvedPredictionsResult }, { buildAccuracyReport }] = await Promise.all([
          import('@/utils/brain/predictionLedger'),
          import('@/utils/brain/accuracyReport'),
        ]);
        const res = await fetchResolvedPredictionsResult();
        if (res.ok) next.accuracyReport = buildAccuracyReport(res.rows);
      } catch { /* additive */ }

      if (!cancelled) {
        setAsyncInputs(next);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // invoices/changeOrders/commitments/projects/userId feed the cash
    // forecast; refreshKey is the manual re-pull. The other sync inputs only
    // affect the pure compose below.
  }, [enabled, invoices, changeOrders, commitments, projects, userId, refreshKey]);

  const brief = useMemo<MorningBrief>(() => {
    // Local calendar day for the cert-expiry cutoff — toISOString() is UTC
    // and flips the date for evening hours west of Greenwich, breaking the
    // brief's own local-day discipline (composeBrief.localDateISO).
    const todayISO = localDateISO(new Date());
    return composeBrief({
      projects, invoices, changeOrders, punchItems, permits, dailyReports, deliveries,
      buildingAccessRules, accessReservations, rfis, submittals,
      expiringCertifications: safety.expiringCertifications(todayISO) as Parameters<typeof composeBrief>[0]['expiringCertifications'],
      openLeakFlags: asyncInputs.openLeakFlags,
      cashSummary: asyncInputs.cashSummary,
      didForYouEntries: asyncInputs.didForYouEntries,
      accuracyReport: asyncInputs.accuracyReport,
    });
  }, [projects, invoices, changeOrders, punchItems, permits, dailyReports, deliveries,
      buildingAccessRules, accessReservations, rfis, submittals, safety, asyncInputs]);

  return { brief, loading, refresh };
}
