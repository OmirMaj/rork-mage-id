// utils/askHistory.ts — persistent ask threads for the "Recent" strip.
//
// The ask screen keeps its conversation in component state, so dismissing the
// sheet used to lose every Q&A. We persist completed threads to AsyncStorage so
// a past answer is one tap away and re-renders for FREE (no model call, no
// metering) — the habit loop that makes the assistant worth returning to.
//
// Key is under the `mage_` prefix, so wipeLocalUserCache (contexts/AuthContext)
// sweeps it on logout by prefix — same tenant-boundary guarantee as
// mage_voice_history. Threads are transient UI state, not pending writes, so
// they wipe cleanly (not in OFFLINE_WRITE_QUEUE_KEYS).

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OneMindCitation } from '@/utils/oneMind/answer';

export const ASK_HISTORY_KEY = 'mage_ask_history';
const MAX_THREADS = 15;

export interface AskThreadTurn {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
  citations?: OneMindCitation[];
}

export interface AskThread {
  id: string;
  ts: number;
  turns: AskThreadTurn[];
}

/** All saved threads, newest first. Never throws — returns [] on any error. */
export async function loadAskThreads(): Promise<AskThread[]> {
  try {
    const raw = await AsyncStorage.getItem(ASK_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AskThread[]) : [];
  } catch {
    return [];
  }
}

/**
 * Upsert the current session's thread (keyed by a stable session id), newest
 * first, capped at MAX_THREADS. Empty threads are ignored. Returns the updated
 * list so the caller can refresh the Recent strip. Never throws.
 */
export async function saveAskThread(id: string, turns: AskThreadTurn[], ts: number): Promise<AskThread[]> {
  try {
    if (!turns.length) return await loadAskThreads();
    const existing = await loadAskThreads();
    const rest = existing.filter((t) => t.id !== id);
    const next: AskThread[] = [{ id, ts, turns }, ...rest].slice(0, MAX_THREADS);
    await AsyncStorage.setItem(ASK_HISTORY_KEY, JSON.stringify(next));
    return next;
  } catch {
    return await loadAskThreads();
  }
}
