// MarginAlertManager — the always-on evaluator behind Margin Alerts.
//
// app/margin-alerts is the inbox you open. This is the part that taps you on the
// shoulder when you DON'T. Mounted once at the root (under NotificationProvider,
// inside ProjectProvider so it can read the portfolio), it re-runs the margin
// engines whenever project/CO/commitment/invoice data — or a receipt, a logged
// shift, a labor rate — changes and fires a local
// notification for any job that has freshly crossed into high or critical margin
// risk since the user last acknowledged.
//
// It deliberately does NOT touch the acknowledged baseline (the inbox owns that,
// via "Mark all read"), so opening the inbox stays the single place that clears
// alerts. It tracks its own "already notified" set so a given crossing pushes
// exactly once. Native only — expo-notifications is a no-op on web.
//
// Pure-reduction cost: computeCurrentBaselines runs the Living Estimate + Margin
// Risk engines over active jobs only, synchronously, the same work the Margin
// Board already does in a memo. For real portfolios that's negligible.

import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
import { useMaterialReceipts } from '@/hooks/useMaterialReceipts';
import { useLaborRates, useTimeEntriesMirror } from '@/hooks/useLaborRates';
import { TIME_ENTRIES_MIRROR_QUERY_KEY } from '@/hooks/useTimeEntries';
import type { JobCostActualSources } from '@/utils/jobCostEngine';
import { sendLocalNotification } from '@/utils/notifications';
import { recordDidForYou } from '@/utils/brain/didForYou';
import {
  computeCurrentBaselines, computeAlerts, selectNotifiable,
  MARGIN_ALERTS_BASELINE_KEY, MARGIN_ALERTS_NOTIFIED_KEY,
  type BaselineMap,
} from '@/utils/marginAlerts';

export default function MarginAlertManager() {
  const { isAuthenticated } = useAuth();
  const { canAccess } = useTierAccess();
  const {
    projects, changeOrders, commitments, invoices, equipment, permits, subcontractors,
  } = useProjects();
  const running = useRef(false);

  // The same cost streams app/job-costing.tsx prices (audit round 2, #16).
  // Without them every self-perform job read 'healthy' here and this push —
  // the one that exists to warn about margin fade — never fired on crew
  // overtime or material overruns. They are all react-query reads under the
  // root QueryClientProvider, so a root-mounted component reaches them fine.
  const { receipts, isLoading: receiptsLoading } = useMaterialReceipts();
  const timeEntries = useTimeEntriesMirror();
  const { rates: laborRates, overtimeMultiplier, isLoading: ratesLoading } = useLaborRates();
  const costSources = useMemo<JobCostActualSources>(() => ({
    receipts, timeEntries, laborRates, overtimeMultiplier, equipment, permits, subcontractors,
  }), [receipts, timeEntries, laborRates, overtimeMultiplier, equipment, permits, subcontractors]);
  // Hold evaluation until those local stores have loaded. Evaluating on the
  // empty defaults would read the job subs-only for one pass, and that pass is
  // not harmless: it prunes a still-standing alert out of the notified set, so
  // the next (full) pass pushes the same crossing a second time — and the
  // `running` guard below can drop that full pass entirely if it lands while
  // the partial one is in flight. The mirror hook exposes no loading flag, so
  // read its cache entry — by the EXPORTED key, not a copied literal, so a
  // rename in hooks/useTimeEntries.ts cannot leave this gate reading an entry
  // that never fills (which would hold the push forever); this component
  // re-renders when the mirror resolves because it subscribes.
  const queryClient = useQueryClient();
  const mirrorLoaded = queryClient.getQueryState(TIME_ENTRIES_MIRROR_QUERY_KEY)?.data !== undefined;
  const costSourcesReady = !receiptsLoading && !ratesLoading && mirrorLoaded;

  // Web has no OS notifications; free tier can't open the inbox anyway.
  const enabled = isAuthenticated && Platform.OS !== 'web' && canAccess('job_costing');

  useEffect(() => {
    if (!enabled || !costSourcesReady) return;
    if (running.current) return;
    running.current = true;

    void (async () => {
      try {
        const [baseRaw, notifiedRaw] = await Promise.all([
          AsyncStorage.getItem(MARGIN_ALERTS_BASELINE_KEY),
          AsyncStorage.getItem(MARGIN_ALERTS_NOTIFIED_KEY),
        ]);
        const acknowledged: BaselineMap = baseRaw ? JSON.parse(baseRaw) : {};
        const notified: string[] = notifiedRaw ? JSON.parse(notifiedRaw) : [];

        const { baselines, names } = computeCurrentBaselines({
          projects, changeOrders, commitments, invoices, costSources,
        });
        const alerts = computeAlerts(baselines, names, acknowledged);
        const notifiable = selectNotifiable(alerts);
        const fresh = notifiable.filter(a => !notified.includes(a.id));

        // Tapping a margin alert opens MAGE already answering "why is this
        // slipping and what do I do?" (kind: 'ask_seed'), instead of dumping the
        // GC on a raw risk table — the answer cites the margin block, which
        // drills to /margin-risk anyway. The seed names the project so Ask
        // scopes to it.
        const askData = (a: (typeof fresh)[number]): Record<string, unknown> => ({
          kind: 'ask_seed',
          screen: 'margin',
          seed: `Why is ${names[a.projectId ?? ''] ?? 'this job'}'s margin slipping, and what should I do about it?`,
          ...(a.projectId ? { projectId: a.projectId } : {}),
        });

        if (fresh.length === 1) {
          const a = fresh[0];
          await sendLocalNotification(a.title, a.detail, askData(a));
        } else if (fresh.length > 1 && fresh.length <= 3) {
          for (const a of fresh) {
            await sendLocalNotification(a.title, a.detail, askData(a));
          }
        } else if (fresh.length > 3) {
          await sendLocalNotification(
            `${fresh.length} jobs need margin attention`,
            'Margin risk stepped up on several active jobs — ask MAGE what to do first.',
            { kind: 'ask_seed', screen: 'margin', seed: 'Which jobs are losing margin right now, and what should I do about it?' },
          );
        }

        // Morning-brief ledger: every fire batch is a did-for-you moment
        // (recordDidForYou is fire-and-forget and never throws — G4).
        if (fresh.length > 0) {
          recordDidForYou(
            fresh.length === 1
              ? `Flagged rising margin risk: ${fresh[0].title}`
              : `Flagged rising margin risk on ${fresh.length} jobs`,
            fresh.length === 1 ? fresh[0].projectId : undefined,
          );
        }

        // Persist the notified-set, pruned to alerts that still stand so it
        // can't grow without bound — and so a job that recovers and later
        // re-crosses gets a fresh notification.
        const liveIds = new Set(notifiable.map(a => a.id));
        const nextNotified = Array.from(
          new Set([...notified.filter(id => liveIds.has(id)), ...fresh.map(a => a.id)]),
        );
        if (nextNotified.length !== notified.length || fresh.length > 0) {
          await AsyncStorage.setItem(MARGIN_ALERTS_NOTIFIED_KEY, JSON.stringify(nextNotified));
        }
      } catch (err) {
        console.warn('[MarginAlerts] evaluation failed:', err);
      } finally {
        running.current = false;
      }
    })();
  }, [enabled, costSourcesReady, projects, changeOrders, commitments, invoices, costSources]);

  return null;
}
