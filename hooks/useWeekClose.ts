// hooks/useWeekClose.ts — assembles the Friday Close inputs and runs the
// pure composeWeekClose composer.
//
// Mirrors useMorningBrief's additive pattern: each async source loads in
// its own try/catch so a failing source degrades to an honest fallback
// rather than blanking the close.
//
// Sync inputs come from ProjectContext. Async inputs:
//   - payment predictions (predictInvoicePaymentsCached) — a react-query query
//     keyed on the unpaid-invoice fingerprint, NOT part of the effect below
//     (#116; see the query for why)
//   - WWP commitments + PPC (the Last Planner store, via hooks/useLastPlanner's
//     shared loader so it refills from the cloud on a fresh device)
//   - lookahead constraint-clear count (totalTasks − constrainedCount)
//
// F3: autoDraftedCOs are filtered from changeOrders by the auditTrail
// marker inside the useMemo that feeds composeWeekClose.

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProjects } from '@/contexts/ProjectContext';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import {
  composeWeekClose,
  type ComposeWeekCloseInput,
  type WeekCloseWipRow,
} from '@/utils/weekClose/composeWeekClose';
import {
  computeWipRow, deriveOriginalContract, deriveEstimatedCost,
  suggestBilledToDate, suggestCostToDate, sumApprovedChangeOrders,
  normalizeWipEtcMap, wipEtcStorageKey, wipEtcValueMap,
  isWipReportableProject, wipEvidenceFor,
  wipCostOverridesKey, normalizeWipCostOverrides, wipCostOverrideInForce, type WipCostOverride,
} from '@/utils/wip';
import {
  paymentForecastFingerprint, hasOverdueUnpaidInvoice, type PaymentPredictionResult,
} from '@/utils/paymentPrediction';
import { todayCalendarDay } from '@/utils/calendarDate';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchLastPlannerStore } from '@/hooks/useLastPlanner';
import type { WeekClose } from '@/utils/weekClose/types';

interface AsyncInputs {
  wwp: ComposeWeekCloseInput['wwp'];
  lookaheadReadyCount: number | undefined;
  unsentClientItemCount: number | undefined;
  qboPendingCount: number | undefined;
}

const EMPTY_ASYNC: AsyncInputs = {
  wwp: null,
  lookaheadReadyCount: undefined,
  unsentClientItemCount: undefined,
  qboPendingCount: 0,
};

export function useWeekClose(opts: { enabled?: boolean } = {}): {
  close: WeekClose | null;
  loading: boolean;
  refresh: () => void;
} {
  const enabled = opts.enabled !== false;
  const {
    projects, invoices, changeOrders, dailyReports, commitments, aiaPayApps,
    // The self-perform cost sources (#37) — the same ones /wip-report and
    // /reports price into cost to date. See the WIP rows below.
    equipment, permits,
  } = useProjects();
  const { receipts } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, overtimeRule } = useLaborRates();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  // THE COST-TO-COMPLETE MAP, so the week-close's cost at completion is the
  // same one both WIP schedules use. Same AsyncStorage key, same parser, both
  // out of utils/wip — a key only one screen knows how to build is a second
  // definition of the number it holds.
  const [etcByProject, setEtcByProject] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    setEtcByProject({});
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(wipEtcStorageKey(user?.id));
        if (cancelled) return;
        setEtcByProject(raw ? wipEtcValueMap(normalizeWipEtcMap(JSON.parse(raw))) : {});
      } catch { /* no map → the derived forecast stands, exactly as before */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // THE COST-TO-DATE OVERRIDE (#37), from the same device cache /wip-report
  // keeps in front of public.wip_cost_overrides — same key builder, same
  // parser, same tombstone rule, all out of utils/wip. A GC who typed his
  // $340,000 of self-performed labour over the automatic figure on the WIP
  // screen was otherwise told a smaller "unbilled" here. Read-only: the WIP
  // screen owns the server read-through and every write.
  const [costOverrides, setCostOverrides] = useState<Record<string, WipCostOverride>>({});
  useEffect(() => {
    let cancelled = false;
    setCostOverrides({});
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(wipCostOverridesKey(user?.id));
        if (cancelled) return;
        setCostOverrides(raw ? normalizeWipCostOverrides(JSON.parse(raw)) : {});
      } catch { /* no cache → the automatic figure stands */ }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const [asyncInputs, setAsyncInputs] = useState<AsyncInputs>(EMPTY_ASYNC);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const next: AsyncInputs = { ...EMPTY_ASYNC };

      // QBO staged-cost count — leg 1's "N QBO costs need review" line (F6).
      // fetchQboPendingCount fails soft to 0, so no try/catch dance needed,
      // but keep the additive wrapper for symmetry with the other sources.
      try {
        const { fetchQboPendingCount } = await import('@/hooks/useQboCostLines');
        next.qboPendingCount = await fetchQboPendingCount();
      } catch { /* additive */ }

      // WWP commitments + lookahead count — for the close/commit legs.
      // Read through useLastPlanner's shared loader, NOT the raw storage key:
      // the raw key is empty on a fresh device or after a sign-out until the
      // cloud copy is merged in, and this card must not report "no
      // commitments" for a week that has them on the server.
      try {
        const { computePpc, buildLookahead, currentWeekStart } = await import('@/utils/lastPlanner');

        const store = await fetchLastPlannerStore(queryClient, userId);

        // Aggregate commitments across all projects.
        const allCommitments = Object.values(store).flatMap(b => b?.commitments ?? []);

        // PPC for the current (ending) week, on the SAME week key the Last
        // Planner screen writes commitments under (currentWeekStart). Caveat:
        // composeWeekClose.buildCloseLeg recomputes PPC on a LOCAL-time Monday,
        // while currentWeekStart is a UTC Monday; on a US Sunday evening the two
        // keys differ and compose falls back to this value (handed off).
        const ppcRecord = computePpc(allCommitments, currentWeekStart());
        next.wwp = {
          commitments: allCommitments,
          ppc: ppcRecord.committed > 0 ? ppcRecord.ppc : null,
        };

        // Lookahead: constraint-clear tasks across all active projects.
        let readyCount = 0;
        for (const project of projects) {
          if (project.status !== 'in_progress') continue;
          const tasks = project.schedule?.tasks ?? [];
          if (tasks.length === 0) continue;
          const constraints = store[project.id]?.constraints ?? [];
          const result = buildLookahead(tasks, project.schedule?.startDate ?? null, constraints, { weeks: 2 });
          readyCount += result.totalTasks - result.constrainedCount;
        }
        next.lookaheadReadyCount = readyCount > 0 ? readyCount : undefined;
      } catch { /* additive */ }

      if (!cancelled) {
        setAsyncInputs(next);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // `projects` feeds the lookahead count. Invoices and change orders no
    // longer trigger this effect: nothing in it reads them since the payment
    // forecast moved to its own query below.
  }, [enabled, projects, refreshKey, queryClient, userId]);

  // ── Payment predictions — the chase leg's landing-date lines (#116) ────────
  //
  // This was a smart-tier AI call INSIDE the effect above, re-run on every new
  // invoices / changeOrders / projects array identity — a sync tick, a tab
  // switch back to Home, a pull-to-refresh — each charged to his monthly AI
  // allowance on the server, none counted by the app's own meter, and each
  // free to return a different forecast for the same invoices. Now:
  //  - ONE query per A/R state: keyed on the fingerprint of exactly what the
  //    prompt would say (utils/paymentPrediction.paymentForecastFingerprint —
  //    the unpaid set, the day, the account), shared by the Home card and
  //    /week-close, fresh for 12 h;
  //  - the same fingerprint is mageAI's cacheKey, so a cold start later that
  //    day is answered from the stored forecast, not a new call;
  //  - no call at all unless some invoice is PAST DUE — the chase leg prints a
  //    landing date on overdue invoices only, so any other forecast decorates
  //    nothing;
  //  - a fresh (uncached) call is recorded on the app's AI meter.
  // The Home card additionally enables this hook only while the card is
  // actually on screen (components/home/WeekCloseCard.tsx).
  const forecastDay = todayCalendarDay();
  const projectsById = useMemo(() => {
    const out: Record<string, typeof projects[number]> = {};
    for (const p of projects) out[p.id] = p;
    return out;
  }, [projects]);
  // Both are computed AS OF the local day, so a new day is a new question even
  // when nothing else changed (local midnight of that day reads back as it).
  // Local midnight of today — the day the forecast is AS OF. (Not a schedule
  // anchor; built directly so no "?? new Date()" fallback is needed: today's
  // calendar day always parses.)
  const forecastAt = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
    // forecastDay is the key: a new local day is a new "as of".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastDay]);
  const forecastKey = useMemo(
    () => paymentForecastFingerprint(invoices, projectsById, userId, forecastAt),
    [invoices, projectsById, userId, forecastAt],
  );
  const hasOverdue = useMemo(
    () => hasOverdueUnpaidInvoice(invoices, forecastAt),
    [invoices, forecastAt],
  );
  // The query function reads the inputs the key was computed from through a
  // ref, so a new array identity with the same content is not a new call.
  // The plan is read through a ref too: a plan change is not a new forecast.
  const { tier: subscriptionTier } = useSubscription();
  const forecastInputsRef = useRef({ invoices, projectsById, subscriptionTier });
  forecastInputsRef.current = { invoices, projectsById, subscriptionTier };
  const forecastQuery = useQuery<PaymentPredictionResult | null>({
    queryKey: ['weekClosePaymentForecast', userId, forecastKey],
    queryFn: async () => {
      const [{ predictInvoicePaymentsWithinAllowance }, { recordAIUsage, checkAILimit }, { hasCachedMageAIResult }] = await Promise.all([
        import('@/utils/paymentPrediction'),
        import('@/utils/aiRateLimiter'),
        import('@/utils/mageAI'),
      ]);
      const { invoices: inv, projectsById: byId, subscriptionTier: tierNow } = forecastInputsRef.current;
      // CHECK THE ALLOWANCE BEFORE A FRESH CALL (integration review, wave 5).
      // This runs in the background on Home, and each fresh call counts
      // against the user's ADVANCED daily allowance. A cached answer is free
      // and always served; a fresh one only when checkAILimit allows it, and
      // is then recorded. Refused → null: the close renders without payment
      // dates. The key carries the local day, so tomorrow asks again.
      return predictInvoicePaymentsWithinAllowance(inv, byId, {
        cacheKey: `week_close_forecast_${forecastKey}`,
        cacheHours: 12,
      }, {
        isCached: hasCachedMageAIResult,
        allowFresh: async () => (await checkAILimit(tierNow, 'smart', 'invoicePrediction')).allowed,
        record: () => recordAIUsage('smart', 'invoicePrediction'),
      });
    },
    enabled: enabled && forecastKey !== null && hasOverdue,
    staleTime: 12 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    // A retried AI call is another charge; the close renders without dates.
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const paymentPredictions: ComposeWeekCloseInput['paymentPredictions'] =
    enabled && hasOverdue ? (forecastQuery.data ?? null) : null;

  // Auto-drafted leak COs: COs with status 'draft' that carry the
  // auto_drafted_from_leak auditTrail marker (written by F3's sweep).
  const autoDraftedCOs = useMemo(
    () => changeOrders.filter(
      co => co.status === 'draft' &&
        (co.auditTrail ?? []).some(e => e.action === 'auto_drafted_from_leak'),
    ),
    [changeOrders],
  );

  // WIP rows for the bill leg — computed synchronously with the REAL WIP
  // engine (utils/wip computeWipRow, cost-basis earned value), the same math
  // the WIP Report screen shows, so the close's "$X unbilled" agrees with the
  // screen the GC checks. Two deliberate departures from what was here before:
  //  - static typed imports, not a require-with-cast (the old wiring called a
  //    4-arg function with 2 args and the wrong return shape; the throw was
  //    swallowed to [] on every render, leaving the flagship leg dead);
  //  - financialReports.computeWIPReport is NOT usable here even correctly
  //    wired: its percent basis is billed/revised, making earned ≡ billed and
  //    unbilled structurally 0.
  const wipRows = useMemo<WeekCloseWipRow[]>(() => {
    try {
      return projects
        .map(p => {
          const projectCOs = changeOrders.filter(co => co.projectId === p.id);
          const projectPayApps = aiaPayApps.filter(a => a.projectId === p.id);
          const projectCommitments = commitments.filter(c => c.projectId === p.id);
          const projectInvoices = invoices.filter(i => i.projectId === p.id);
          // EVERY COST SOURCE THE WIP SCHEDULES PRICE (#37, audit 2026-09-22).
          // This was subs + receipts only, so on a self-perform job — $0 of
          // sub payments, some receipts, 400 clocked crew hours — the percent
          // complete here was a fraction of the WIP screen's and "$X unbilled"
          // fell toward $0: the bill leg read clean and he did not invoice
          // earned work. Same third argument app/wip-report.tsx passes;
          // `projectId` is required because the equipment and permit lists are
          // account-wide.
          const auto = suggestCostToDate(
            projectCommitments,
            receipts.filter(r => r.projectId === p.id),
            { projectId: p.id, timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits },
          );
          // …and his typed override, when one is in force — never a tombstone.
          const override = wipCostOverrideInForce(costOverrides, p.id);
          const costToDate = override ? override.value : auto;
          return { p, projectCOs, projectPayApps, projectCommitments, projectInvoices, auto, costToDate };
        })
        // THE SAME POPULATION AS /wip-report (#37): open, own-company, signed
        // work — not `status === 'in_progress'`, which dropped a completed job
        // still carrying unbilled revenue and a live job still reading
        // `estimated` because it was billed by pay app. Evidence is built from
        // the AUTOMATIC cost to date, exactly as the WIP screen builds it, so
        // a typed override cannot put a job on one list and not the other.
        .filter(({ p, projectCOs, projectPayApps, projectCommitments, projectInvoices, auto }) =>
          isWipReportableProject(p, {
            userId,
            evidence: wipEvidenceFor(p, {
              invoices: projectInvoices,
              payApps: projectPayApps,
              changeOrders: projectCOs,
              commitments: projectCommitments,
              costToDate: auto,
            }),
          }))
        .map(({ p, projectCOs, projectPayApps, projectCommitments, projectInvoices, costToDate }) => {
          const out = computeWipRow({
            originalContract: deriveOriginalContract(p, projectCOs, projectPayApps),
            approvedChangeOrders: sumApprovedChangeOrders(projectCOs),
            // CO cost must track CO revenue — see deriveEstimatedCost. This
            // path runs unattended in the week-close, with no human to notice
            // an inflated margin.
            totalEstimatedCost: deriveEstimatedCost(p, projectCommitments, {
              approvedChangeOrders: sumApprovedChangeOrders(projectCOs),
              originalContract: deriveOriginalContract(p, projectCOs, projectPayApps),
              // THE TWO ARGUMENTS THIS CALL SITE WAS MISSING (adversarial
              // review 2026-09-11). Both WIP schedules pass them; this one
              // built its row by hand and passed neither, so on an overrun job
              // it produced a THIRD cost at completion and the close's
              // "$X unbilled" stopped agreeing with the WIP screen it was
              // explicitly built to agree with.
              //
              // `costIncurred` is the hard floor: a job cannot finish for less
              // than what it has already cost. Without it, a job that has burned
              // past its estimate reports the estimate.
              costIncurred: costToDate,
              // …and the GC's own revised forecast outranks all of it.
              estimatedCostToComplete: etcByProject[p.id],
            }),
            costToDate,
            billedToDate: suggestBilledToDate(projectInvoices, projectPayApps),
            // computeWipRow applies the SAME entry a second time (it is the row
            // engine's own parameter), which is not a double count — both
            // resolve to costToDate + ETC — but passing it here is what makes
            // `out.costToComplete` and the percent complete match the screen.
            estimatedCostToComplete: etcByProject[p.id],
          });
          return {
            projectId: p.id,
            projectName: p.name,
            unbilled: out.underbilling,
            percentComplete: out.percentComplete * 100,
          };
        });
    } catch {
      return [];
    }
  }, [
    projects, invoices, changeOrders, commitments, aiaPayApps, receipts, etcByProject,
    timeEntries, laborRates, overtimeMultiplier, overtimeRule, equipment, permits,
    costOverrides, userId,
  ]);

  const close = useMemo<WeekClose | null>(() => {
    if (!enabled) return null;
    return composeWeekClose({
      projects,
      invoices,
      changeOrders,
      dailyReports,
      wipRows,
      paymentPredictions,
      wwp: asyncInputs.wwp,
      lookaheadReadyCount: asyncInputs.lookaheadReadyCount,
      unsentClientItemCount: asyncInputs.unsentClientItemCount,
      qboPendingCount: asyncInputs.qboPendingCount,
      autoDraftedCOs,
    });
  }, [
    enabled, projects, invoices, changeOrders, dailyReports, wipRows,
    asyncInputs, paymentPredictions, autoDraftedCOs,
  ]);

  return { close, loading, refresh };
}
