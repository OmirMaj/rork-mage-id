// MarginAlertManager — the always-on evaluator behind Margin Alerts.
//
// app/margin-alerts is the inbox you open. This is the part that taps you on the
// shoulder when you DON'T. Mounted once at the root (under NotificationProvider,
// inside ProjectProvider so it can read the portfolio), it re-runs the margin
// engines whenever project/CO/commitment/invoice data changes and fires a local
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

import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useTierAccess } from '@/hooks/useTierAccess';
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
  const { projects, changeOrders, commitments, invoices } = useProjects();
  const running = useRef(false);

  // Web has no OS notifications; free tier can't open the inbox anyway.
  const enabled = isAuthenticated && Platform.OS !== 'web' && canAccess('job_costing');

  useEffect(() => {
    if (!enabled) return;
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
          projects, changeOrders, commitments, invoices,
        });
        const alerts = computeAlerts(baselines, names, acknowledged);
        const notifiable = selectNotifiable(alerts);
        const fresh = notifiable.filter(a => !notified.includes(a.id));

        if (fresh.length === 1) {
          const a = fresh[0];
          await sendLocalNotification(a.title, a.detail, { kind: 'margin_alert', projectId: a.projectId });
        } else if (fresh.length > 1 && fresh.length <= 3) {
          for (const a of fresh) {
            await sendLocalNotification(a.title, a.detail, { kind: 'margin_alert', projectId: a.projectId });
          }
        } else if (fresh.length > 3) {
          await sendLocalNotification(
            `${fresh.length} jobs need margin attention`,
            'Margin risk stepped up on several active jobs. Open Margin Alerts to triage.',
            { kind: 'margin_alert' },
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
  }, [enabled, projects, changeOrders, commitments, invoices]);

  return null;
}
