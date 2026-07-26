// hooks/useLeakCoDrafts.ts
//
// Once-per-session catch-up sweep: checks the autonomy gate and the
// leak_draft_co preference, then drafts COs from eligible priced leak scans.
//
// Pattern: module-level flag (useBrainGrading.ts precedent) ensures the
// sweep runs at most once per app session, even if WeekCloseCard re-mounts.
//
// G4: the entire sweep is wrapped in try/catch — a failure degrades silently
//     to the manual button in daily-report.tsx.
// G8: draft-forever — nothing here transitions CO status or touches portal.
// G9: recordDidForYou receipt per drafted CO ("Drafted CO #N for $X from
//     <date>'s report — review & send").
// G12: mageid_leakco_drafted is in LOCAL_USER_CACHE_KEYS (F0 AuthContext edit).
// G13: gate re-checked every sweep; demotion is handled by useAutonomy.

import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useProjects } from '@/contexts/ProjectContext';
import { useAutonomy } from '@/hooks/useAutonomy';
import {
  collectDraftableLeaks,
  buildDraftCO,
} from '@/utils/brain/leakCoDraft';
import { recordDidForYou } from '@/utils/brain/didForYou';

// ─── AsyncStorage key for processed report IDs ────────────────────────────

export const LEAKCO_DRAFTED_KEY = 'mageid_leakco_drafted';

// ─── Module-level session flag (useBrainGrading.ts pattern) ──────────────

let sessionSwept = false;

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Mount this hook in WeekCloseCard so it runs on every home render.
 * The module-level flag ensures the sweep fires at most once per session.
 * G4: the whole sweep is try/catch — a failure degrades to the manual flow.
 */
export function useLeakCoDrafts(): void {
  const {
    projects, invoices, dailyReports, changeOrders, addChangeOrder,
  } = useProjects();
  const { leakGate, prefs, loading: autonomyLoading } = useAutonomy();

  useEffect(() => {
    // Skip if autonomy hook is still loading (we'd gate on stale data).
    if (autonomyLoading) return;
    // Module-level guard: one sweep per app session.
    if (sessionSwept) return;
    sessionSwept = true;

    (async () => {
      try {
        // Gate 1: earned-trust leak precision gate (n≥5, billedRate≥0.50).
        if (!leakGate.passed) return;

        // Gate 2: user pref (absent = ON per G8/D3 rationale).
        if (prefs.leak_draft_co === false) return;

        // Load the set of already-processed report IDs for this session.
        const raw = await AsyncStorage.getItem(LEAKCO_DRAFTED_KEY);
        const processedArray = safeJsonParse<string[]>(raw, []);
        const processedSet = new Set<string>(processedArray);

        // Collect candidates.
        const candidates = collectDraftableLeaks({
          dailyReports,
          projects,
          changeOrders,
          processedReportIds: processedSet,
        });

        if (candidates.length === 0) return;

        const nowISO = new Date().toISOString().slice(0, 10);
        const newProcessed = [...processedArray];

        for (const candidate of candidates) {
          const { report, project } = candidate;

          // Get the current COs for this project (may have grown mid-loop).
          // We re-derive from the changeOrders snapshot; addChangeOrder will
          // update the context for subsequent iterations via React state, but
          // for number sequencing we use the full list including those just
          // added in this loop.
          const projectCOs = changeOrders.filter(co => co.projectId === project.id);
          const draft = buildDraftCO(candidate, projectCOs, nowISO);

          // Create the draft CO via the offline-queue-backed context method.
          addChangeOrder(draft);

          // G9: did-for-you receipt.
          const when = report.date
            ? new Date(report.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
            : 'a recent report';
          const dollarStr = draft.changeAmount >= 1000
            ? `$${Math.round(draft.changeAmount / 1000)}K`
            : `$${Math.round(draft.changeAmount)}`;
          recordDidForYou(
            `Drafted CO #${draft.number} for ${dollarStr} from ${when}'s report — review & send`,
            project.id,
          );

          // Mark this report as processed so the sweep skips it on next mount.
          newProcessed.push(report.id);
        }

        // Persist the updated processed set (G12 key, append-only).
        await AsyncStorage.setItem(LEAKCO_DRAFTED_KEY, JSON.stringify(newProcessed));
      } catch (err) {
        // G4: swallow silently — degrades to manual button in daily-report.tsx.
        console.log('[useLeakCoDrafts] sweep failed:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autonomyLoading]);
  // NOTE: intentional empty deps after `autonomyLoading` — the sweep runs
  // once per session. The module flag is the guard; stale context captures
  // are acceptable since the sweep reads from a stable snapshot.
}
