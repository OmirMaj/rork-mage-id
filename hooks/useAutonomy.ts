// hooks/useAutonomy.ts
//
// Autonomy preferences + earned-trust gate state for the Brain v3 autonomy ladder.
// Mirrors useTierAccess pattern for the preference/gate API surface.
//
// Sources:
//   - profiles.autonomy_preferences (jsonb — migration 20260726120000)
//   - brain_predictions resolved rows (fetchResolvedPredictions)
//   - mageid_autonomy_gate_state (AsyncStorage — demotion/promotion transition detection)
//
// G4: all recordDidForYou calls are fire-and-forget.
// G12: mageid_autonomy_gate_state is registered in LOCAL_USER_CACHE_KEYS (F0 AuthContext edit).
// G13: demotion is LOUD in receipts (didForYou line) but silent in behavior (falls
//      back to suggest). Promotion also gets a line.

import { useEffect, useCallback, useState, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { fetchResolvedPredictions } from '@/utils/brain/predictionLedger';
import {
  computeAutonomyGates,
  type TradeGateResult,
  type LeakGateResult,
} from '@/utils/brain/autonomyGate';
import { recordDidForYou } from '@/utils/brain/didForYou';
import { useAuth } from '@/contexts/AuthContext';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape of profiles.autonomy_preferences v1.
 *  Absent keys = ON (both are draft-level, zero-blast-radius; the gate is the
 *  real lock). Future domains add keys without migration. */
export interface AutonomyPreferences {
  pace_preapply?: boolean;
  leak_draft_co?: boolean;
}

/** Persisted gate pass-state for transition detection (demotion/promotion receipts). */
interface PersistedGateState {
  /** Trades that were passing on last check — we detect pass→fail transitions. */
  passingTrades: string[];
  /** Whether the leak gate was passing on last check. */
  leakPassed: boolean;
}

export const AUTONOMY_GATE_STATE_KEY = 'mageid_autonomy_gate_state';

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseAutonomyResult {
  /** Per-trade pace gates. Map keyed by trade string. Empty while loading. */
  paceTradeGates: Map<string, TradeGateResult>;
  /** Leak precision gate. */
  leakGate: LeakGateResult;
  /** Loaded preferences from profiles.autonomy_preferences. */
  prefs: AutonomyPreferences;
  /** Update one or more preference keys (optimistic + durable via offline queue). */
  setPref: (patch: Partial<AutonomyPreferences>) => void;
  /** True while the initial fetch is in-flight. */
  loading: boolean;
}

export function useAutonomy(): UseAutonomyResult {
  const { user } = useAuth();

  const [paceTradeGates, setPaceTradeGates] = useState<Map<string, TradeGateResult>>(new Map());
  const [leakGate, setLeakGate] = useState<LeakGateResult>({ n: 0, billedRate: 0, passed: false });
  const [prefs, setPrefs] = useState<AutonomyPreferences>({});
  const [loading, setLoading] = useState(true);

  // Stable ref for the transition detector so it doesn't re-run effects.
  const prevStateRef = useRef<PersistedGateState | null>(null);

  // ── Initial load: prefs + resolved predictions ──────────────────────────

  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setLoading(false);
      return;
    }

    (async () => {
      try {
        // Load prefs from profiles.
        const { data: profileData } = await supabase
          .from('profiles')
          .select('autonomy_preferences')
          .eq('id', user.id)
          .single();
        if (!cancelled && profileData) {
          setPrefs((profileData.autonomy_preferences as AutonomyPreferences) ?? {});
        }

        // Load resolved predictions for gate computation.
        const resolved = await fetchResolvedPredictions([
          'pace_suggestion_applied',
          'leak_flag',
        ]);
        if (cancelled) return;

        const gates = computeAutonomyGates(resolved);
        setPaceTradeGates(gates.paceTradeGates);
        setLeakGate(gates.leakGate);

        // ── Transition detection ───────────────────────────────────────────
        const stored = await AsyncStorage.getItem(AUTONOMY_GATE_STATE_KEY);
        if (cancelled) return;
        const prev = safeJsonParse<PersistedGateState | null>(stored, null);
        prevStateRef.current = prev;

        // Detect pace trade transitions.
        const nowPassingTrades: string[] = [];
        for (const [trade, result] of gates.paceTradeGates) {
          if (result.passed) nowPassingTrades.push(trade);

          if (prev) {
            const wasPassing = prev.passingTrades.includes(trade);
            if (wasPassing && !result.passed) {
              // Demotion — loud receipt, G13.
              const pct = Math.round(result.rate * 100);
              recordDidForYou(
                `My pace calls for ${trade} slipped to ${pct}% — I've gone back to asking first`,
              );
            } else if (!wasPassing && result.passed) {
              // Promotion — receipt.
              const pct = Math.round(result.rate * 100);
              recordDidForYou(
                `${trade} pace unlocked — ${result.n} jobs, ${pct}%+`,
              );
            }
          }
        }

        // Detect leak gate transitions.
        if (prev) {
          const leakPassed = gates.leakGate.passed;
          if (prev.leakPassed && !leakPassed) {
            const pct = Math.round(gates.leakGate.billedRate * 100);
            recordDidForYou(
              `Leak precision dropped to ${pct}% — CO drafting is back to one-tap`,
            );
          } else if (!prev.leakPassed && leakPassed) {
            const pct = Math.round(gates.leakGate.billedRate * 100);
            recordDidForYou(
              `Leak precision reached ${pct}% (${gates.leakGate.n} scans) — CO drafting unlocked`,
            );
          }
        }

        // Persist new state for next-session transition detection.
        const next: PersistedGateState = {
          passingTrades: nowPassingTrades,
          leakPassed: gates.leakGate.passed,
        };
        await AsyncStorage.setItem(AUTONOMY_GATE_STATE_KEY, JSON.stringify(next));
      } catch (err) {
        // G4: gate failures must never surface to the user.
        console.log('[useAutonomy] load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  // ── setPref: optimistic + durable ────────────────────────────────────────

  const setPref = useCallback(
    (patch: Partial<AutonomyPreferences>) => {
      if (!user?.id) return;
      const next = { ...prefs, ...patch };
      setPrefs(next);
      // Durable write via offline queue (G3).
      void supabaseWrite('profiles', 'update', {
        id: user.id,
        autonomy_preferences: next,
      });
    },
    [prefs, user?.id],
  );

  return useMemo(
    () => ({ paceTradeGates, leakGate, prefs, setPref, loading }),
    [paceTradeGates, leakGate, prefs, setPref, loading],
  );
}
