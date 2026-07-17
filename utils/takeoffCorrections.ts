// takeoffCorrections — local capture of AI takeoff corrections (the
// diff between what the AI returned and what the user kept). Becomes the
// labeled dataset for future prompt fine-tuning + accuracy publishing.
//
// Stays on-device for now. The "Help improve MAGE" button on
// TakeoffAccuracyPanel will eventually push these to a backend table —
// when it does, this module is the single touch-point. Until then,
// they're locally observable so the user can see their own pattern
// (e.g. "I always raise the door count by 2 — the AI under-counts
// barn doors").
//
// Storage layout:
//   mageid_takeoff_corrections   → TakeoffCorrection[]
// Capped at 500 entries (FIFO eviction) so a heavy user doesn't blow
// AsyncStorage. 500 corrections is ~150 takeoffs of edit-heavy work.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'mageid_takeoff_corrections';
const MAX_ENTRIES = 500;

export type CorrectionKind = 'override' | 'reject' | 'restore';

export interface TakeoffCorrection {
  id: string;
  /** "${section}:${id}" — the row key. */
  rowKey: string;
  /** Section name parsed off the row key for grouping (walls, doors, …). */
  section: string;
  /** What the AI originally returned. */
  aiValue: number;
  /** What the user changed it to. For "reject" this matches aiValue but
   *  kind is set to 'reject' so downstream training knows to drop the
   *  row entirely. */
  userValue: number;
  /** Did the user override (number change), reject (drop the row), or
   *  restore (un-reject)? */
  kind: CorrectionKind;
  /** AI's self-reported confidence at the time of the correction. */
  confidence: 'high' | 'medium' | 'low';
  /** Which Gemini model produced the original quantity. Lets us split
   *  flash vs. pro accuracy later. */
  model?: string;
  /** Source-page numbers the AI cited. */
  sourcePages: number[];
  /** Project context if available. Optional. */
  projectId?: string;
  /** ISO timestamp. */
  capturedAt: string;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadCorrections(): Promise<TakeoffCorrection[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as TakeoffCorrection[]) : [];
  } catch {
    return [];
  }
}

export async function recordCorrection(c: Omit<TakeoffCorrection, 'id' | 'capturedAt' | 'section'>): Promise<void> {
  try {
    const existing = await loadCorrections();
    const section = c.rowKey.split(':')[0] ?? 'unknown';
    const entry: TakeoffCorrection = {
      ...c,
      id: generateId(),
      section,
      capturedAt: new Date().toISOString(),
    };
    // Newest-first ring buffer.
    const next = [entry, ...existing].slice(0, MAX_ENTRIES);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.log('[takeoffCorrections] record failed', e);
  }
}

export async function clearCorrections(): Promise<void> {
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch {}
}

/** Roll-up stats for the accuracy panel + future "your own metrics" page. */
export interface CorrectionsRollup {
  total: number;
  bySection: Record<string, { count: number; avgPctError: number }>;
  byKind: Record<CorrectionKind, number>;
  byConfidence: Record<'high' | 'medium' | 'low', number>;
}

export function rollUpCorrections(items: TakeoffCorrection[]): CorrectionsRollup {
  const bySection: Record<string, { count: number; sumPctErr: number }> = {};
  const byKind: Record<CorrectionKind, number> = { override: 0, reject: 0, restore: 0 };
  const byConfidence: Record<'high' | 'medium' | 'low', number> = { high: 0, medium: 0, low: 0 };

  for (const c of items) {
    if (!bySection[c.section]) bySection[c.section] = { count: 0, sumPctErr: 0 };
    const sec = bySection[c.section];
    sec.count++;
    if (c.kind === 'override' && c.aiValue !== 0) {
      sec.sumPctErr += (c.userValue - c.aiValue) / c.aiValue;
    }
    byKind[c.kind]++;
    byConfidence[c.confidence]++;
  }

  const out: CorrectionsRollup = {
    total: items.length,
    bySection: {},
    byKind,
    byConfidence,
  };
  for (const [k, v] of Object.entries(bySection)) {
    out.bySection[k] = {
      count: v.count,
      avgPctError: v.count > 0 ? v.sumPctErr / v.count : 0,
    };
  }
  return out;
}
