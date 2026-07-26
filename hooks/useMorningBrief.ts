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
import { useProjects } from '@/contexts/ProjectContext';
import { useSafety } from '@/contexts/SafetyContext';
import {
  composeBrief, type MorningBrief, type OpenLeakSummary,
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
  const {
    projects, invoices, changeOrders, punchItems, permits, dailyReports,
  } = useProjects();
  const safety = useSafety();

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
      try {
        const { fetchOpenPredictionsDeduped } = await import('@/utils/brain/predictionLedger');
        const rows = await fetchOpenPredictionsDeduped(['leak_flag']);
        let estTotal = 0;
        for (const row of rows) {
          const items = (row.payload as { items?: { estPrice?: number | null }[] }).items ?? [];
          for (const item of items) estTotal += item.estPrice ?? 0;
        }
        next.openLeakFlags = { count: rows.length, estTotal };
      } catch { /* additive */ }

      // Cash forecast — only when the user finished cash-flow setup.
      try {
        const [{ loadCashFlowData, isSetupComplete }, engine] = await Promise.all([
          import('@/utils/cashFlowStorage'),
          import('@/utils/cashFlowEngine'),
        ]);
        if (await isSetupComplete()) {
          const data = await loadCashFlowData();
          const balance = engine.getEffectiveStartingBalance(data.startingBalance, data.balanceAsOf, invoices);
          const forecast = engine.generateForecast(
            balance, data.expenses, invoices, data.expectedPayments,
            12, data.defaultPaymentTerms, changeOrders,
          );
          next.cashSummary = engine.calculateSummary(forecast);
        }
      } catch { /* additive */ }

      // Yesterday's did-for-you ledger entries.
      try {
        const raw = await AsyncStorage.getItem(DID_FOR_YOU_KEY);
        next.didForYouEntries = parseDidForYouEntries(raw);
      } catch { /* additive */ }

      // Accuracy report — the self-correction line source.
      try {
        const [{ fetchResolvedPredictions }, { buildAccuracyReport }] = await Promise.all([
          import('@/utils/brain/predictionLedger'),
          import('@/utils/brain/accuracyReport'),
        ]);
        next.accuracyReport = buildAccuracyReport(await fetchResolvedPredictions());
      } catch { /* additive */ }

      if (!cancelled) {
        setAsyncInputs(next);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // invoices/changeOrders feed the cash forecast; refreshKey is the manual
    // re-pull. The other sync inputs only affect the pure compose below.
  }, [enabled, invoices, changeOrders, refreshKey]);

  const brief = useMemo<MorningBrief>(() => {
    const todayISO = new Date().toISOString().slice(0, 10);
    return composeBrief({
      projects, invoices, changeOrders, punchItems, permits, dailyReports,
      expiringCertifications: safety.expiringCertifications(todayISO) as Parameters<typeof composeBrief>[0]['expiringCertifications'],
      openLeakFlags: asyncInputs.openLeakFlags,
      cashSummary: asyncInputs.cashSummary,
      didForYouEntries: asyncInputs.didForYouEntries,
      accuracyReport: asyncInputs.accuracyReport,
    });
  }, [projects, invoices, changeOrders, punchItems, permits, dailyReports, safety, asyncInputs]);

  return { brief, loading, refresh };
}
