// hooks/useBackcharges.ts — the backcharge list, device-local.
//
// Stored under BACKCHARGES_KEY (a mageid_ key), so the sign-out sweep clears
// it; every surface that shows it says "Saved on this device until you sign
// out". Every read and write is wrapped — storage can throw (private window,
// blocked site data) and the screen must still work (the
// hooks/useInspectionPrepState.ts pattern).
//
// One shared in-memory copy: the section and every invoice's deduction card
// mount this hook, and "Apply to this bill" on a card must move the item in
// the section on the same frame.

import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BACKCHARGES_KEY, markApplied, parseBackcharges, type Backcharge } from '@/utils/backcharges';

let shared: Backcharge[] = [];
let sharedLoaded = false;
const listeners = new Set<() => void>();

function publish(next: Backcharge[]) {
  shared = next;
  sharedLoaded = true;
  listeners.forEach(l => l());
}

/** null when storage threw — the caller keeps the in-memory list rather than
 *  wiping this session's edits. */
async function readAll(): Promise<Backcharge[] | null> {
  try {
    return parseBackcharges(await AsyncStorage.getItem(BACKCHARGES_KEY));
  } catch {
    return null;
  }
}

async function writeAll(list: Backcharge[]): Promise<void> {
  try {
    await AsyncStorage.setItem(BACKCHARGES_KEY, JSON.stringify(list));
  } catch {
    // Device-local; the in-memory list still shows what he did this session.
  }
}

function commit(next: Backcharge[]) {
  publish(next);
  void writeAll(next);
}

export function useBackcharges(): {
  list: Backcharge[];
  loaded: boolean;
  add: (b: Backcharge) => void;
  update: (id: string, patch: Partial<Backcharge>) => void;
  applyToInvoice: (ids: string[], invoiceId: string) => void;
  voidOne: (id: string) => void;
} {
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const l = () => { if (alive) setTick(t => t + 1); };
    listeners.add(l);
    void readAll().then(list => { if (alive && list) publish(list); else if (alive && !sharedLoaded) publish(shared); });
    return () => { alive = false; listeners.delete(l); };
  }, []);

  const add = useCallback((b: Backcharge) => {
    commit([...shared.filter(x => x.id !== b.id), b]);
  }, []);
  const update = useCallback((id: string, patch: Partial<Backcharge>) => {
    commit(shared.map(b => (b.id === id ? { ...b, ...patch, id: b.id } : b)));
  }, []);
  const applyToInvoice = useCallback((ids: string[], invoiceId: string) => {
    commit(markApplied(shared, ids, invoiceId, new Date().toISOString()));
  }, []);
  const voidOne = useCallback((id: string) => {
    commit(shared.map(b => (b.id === id && b.status === 'open' ? { ...b, status: 'void' as const } : b)));
  }, []);

  return { list: shared, loaded: sharedLoaded, add, update, applyToInvoice, voidOne };
}
