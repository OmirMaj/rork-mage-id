// hooks/useInspectionPrepState.ts — device-local prep state for one upcoming
// inspection: which lines are N/A, which punch item each line spawned, which
// have proof attached, the follow-up answers, and the last recall answer.
//
// Device-local BY DESIGN. Nothing here is a record: the punch items and the
// permit write go through ProjectContext (and so the offline queue); this is
// only the checklist's memory of what the GC ticked. A lost write here costs a
// re-tick, never data. Every read and write is wrapped — storage can throw
// (private window, blocked site data) and the sheet must still work.

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PREP_STORAGE_KEY, type PrepItem, type RecallAnswer } from '@/utils/inspectionPrep';

export interface InspectionPrepEntry {
  na: string[];
  punchByItem: Record<string, string>;
  proofByItem: Record<string, true>;
  answers: Record<string, string>;
  recall?: RecallAnswer;
  recallAt?: string;
  /** Lines added from a Photo Code Look (group 'verify'; stable ids). */
  extras?: PrepItem[];
}

const EXTRAS_CAP = 10;

type PrepMap = Record<string, InspectionPrepEntry>;

export const EMPTY_PREP_ENTRY: InspectionPrepEntry = { na: [], punchByItem: {}, proofByItem: {}, answers: {} };

async function readMap(): Promise<PrepMap> {
  try {
    const raw = await AsyncStorage.getItem(PREP_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PrepMap) : {};
  } catch {
    return {};
  }
}

async function writeEntry(key: string, entry: InspectionPrepEntry): Promise<void> {
  try {
    const map = await readMap();
    map[key] = entry;
    await AsyncStorage.setItem(PREP_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Device-local convenience only — see the header.
  }
}

function normalise(e: Partial<InspectionPrepEntry> | undefined): InspectionPrepEntry {
  return {
    na: Array.isArray(e?.na) ? e!.na.filter((x) => typeof x === 'string') : [],
    punchByItem: e?.punchByItem && typeof e.punchByItem === 'object' ? { ...e.punchByItem } : {},
    proofByItem: e?.proofByItem && typeof e.proofByItem === 'object' ? { ...e.proofByItem } : {},
    answers: e?.answers && typeof e.answers === 'object' ? { ...e.answers } : {},
    ...(e?.recall ? { recall: e.recall } : {}),
    ...(e?.recallAt ? { recallAt: e.recallAt } : {}),
    ...(extrasOf(e).length > 0 ? { extras: extrasOf(e) } : {}),
  };
}

function extrasOf(e: Partial<InspectionPrepEntry> | undefined): PrepItem[] {
  if (!Array.isArray(e?.extras)) return [];
  const seen = new Set<string>();
  const out: PrepItem[] = [];
  for (const x of e!.extras) {
    if (out.length >= EXTRAS_CAP) break;
    if (!x || typeof x !== 'object') continue;
    if (typeof x.id !== 'string' || typeof x.text !== 'string' || x.group !== 'verify') continue;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

/**
 * Add one line to an inspection's "From your Code look" group, outside the
 * sheet (the Code look opened from a photo viewer). Device-local like the rest
 * of this file: read, normalise, dedupe by id, write — never throws.
 */
export async function appendPrepExtra(key: string, item: PrepItem): Promise<boolean> {
  try {
    const map = await readMap();
    const cur = normalise(map[key]);
    const next = normalise({ ...cur, extras: [...(cur.extras ?? []), item] });
    await writeEntry(key, next);
    // false when the list was already full (the cap drops it) — the caller
    // must not say "Added" for a line that did not land.
    return (next.extras ?? []).some((x) => x.id === item.id);
  } catch {
    // Device-local convenience only — see the header.
    return false;
  }
}

/**
 * The prep entry for `key` (null = nothing to load, e.g. the sheet is closed).
 * `update` applies a pure patch function to the latest entry and persists it.
 */
export function useInspectionPrepState(key: string | null) {
  const [entry, setEntry] = useState<InspectionPrepEntry>(EMPTY_PREP_ENTRY);
  const [loaded, setLoaded] = useState(false);
  const latest = useRef<InspectionPrepEntry>(EMPTY_PREP_ENTRY);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    latest.current = EMPTY_PREP_ENTRY;
    setEntry(EMPTY_PREP_ENTRY);
    if (!key) return () => { alive = false; };
    void readMap().then((map) => {
      if (!alive) return;
      const e = normalise(map[key]);
      latest.current = e;
      setEntry(e);
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [key]);

  const update = useCallback((patch: (prev: InspectionPrepEntry) => InspectionPrepEntry) => {
    if (!key) return;
    const next = normalise(patch(latest.current));
    latest.current = next;
    setEntry(next);
    void writeEntry(key, next);
  }, [key]);

  return { entry, loaded, update };
}
