// PropertyContext — portfolio data for the Property Manager persona:
// managed properties + the work orders logged against them.
//
// Why a dedicated context (rather than folding into ProjectContext): this
// is a brand-new persona surface with its own collections. Keeping it
// isolated means the giant ProjectContext stays untouched, and the PM
// feature can evolve (and, later, get its own server sync) without risking
// the contractor core. Follows the same createContextHook + AsyncStorage
// pattern as MaterialCartContext.
//
// v1 is local-first — persisted under the `mageid_*` namespace, no
// Supabase sync yet (documented intentional; mirrors how OAC meetings
// shipped local-first first). The work-order → contractor bridge lives in
// the UI (app/work-order.tsx), which consumes both this context and
// useProjects().addLead so the two contexts stay decoupled.

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { generateUUID } from '@/utils/generateId';
import type { ManagedProperty, WorkOrder } from '@/types';

const PROPERTIES_KEY = 'mageid_managed_properties';
const WORK_ORDERS_KEY = 'mageid_work_orders';

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function saveLocal(key: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.warn('[Property] Local save failed for', key, err);
  }
}

export const [PropertyProvider, useProperties] = createContextHook(() => {
  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  // Don't write the empty initial state back over persisted data before
  // the first hydrate completes (same guard MaterialCartContext uses).
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [props, wos] = await Promise.all([
        loadLocal<ManagedProperty[]>(PROPERTIES_KEY, []),
        loadLocal<WorkOrder[]>(WORK_ORDERS_KEY, []),
      ]);
      if (cancelled) return;
      if (Array.isArray(props)) setProperties(props.filter(p => p && typeof p.id === 'string'));
      if (Array.isArray(wos)) setWorkOrders(wos.filter(w => w && typeof w.id === 'string'));
      hydratedRef.current = true;
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveLocal(PROPERTIES_KEY, properties);
  }, [properties]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    void saveLocal(WORK_ORDERS_KEY, workOrders);
  }, [workOrders]);

  // ── Properties ──────────────────────────────────────────────────────
  const addProperty = useCallback((
    input: Omit<ManagedProperty, 'id' | 'createdAt' | 'updatedAt'>,
  ): ManagedProperty => {
    const now = new Date().toISOString();
    const property: ManagedProperty = { ...input, id: generateUUID(), createdAt: now, updatedAt: now };
    setProperties(prev => [property, ...prev]);
    return property;
  }, []);

  const updateProperty = useCallback((id: string, updates: Partial<ManagedProperty>) => {
    const now = new Date().toISOString();
    setProperties(prev => prev.map(p => p.id === id ? { ...p, ...updates, updatedAt: now } : p));
  }, []);

  const deleteProperty = useCallback((id: string) => {
    setProperties(prev => prev.filter(p => p.id !== id));
    // Cascade — a property's work orders have no meaning without it.
    setWorkOrders(prev => prev.filter(w => w.propertyId !== id));
  }, []);

  const getProperty = useCallback(
    (id: string) => properties.find(p => p.id === id) ?? null,
    [properties],
  );

  // ── Work orders ─────────────────────────────────────────────────────
  const addWorkOrder = useCallback((
    input: Omit<WorkOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: WorkOrder['status'] },
  ): WorkOrder => {
    const now = new Date().toISOString();
    const wo: WorkOrder = {
      ...input,
      status: input.status ?? 'open',
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    setWorkOrders(prev => [wo, ...prev]);
    return wo;
  }, []);

  const updateWorkOrder = useCallback((id: string, updates: Partial<WorkOrder>) => {
    const now = new Date().toISOString();
    setWorkOrders(prev => prev.map(w => w.id === id ? { ...w, ...updates, updatedAt: now } : w));
  }, []);

  const deleteWorkOrder = useCallback((id: string) => {
    setWorkOrders(prev => prev.filter(w => w.id !== id));
  }, []);

  const getWorkOrder = useCallback(
    (id: string) => workOrders.find(w => w.id === id) ?? null,
    [workOrders],
  );

  const getWorkOrdersForProperty = useCallback(
    (propertyId: string) => workOrders.filter(w => w.propertyId === propertyId),
    [workOrders],
  );

  /** Count of work orders still needing attention (not done/cancelled),
   *  used for the portfolio badge on the hub. */
  const getOpenWorkOrderCount = useCallback(
    (propertyId?: string) => workOrders.filter(w =>
      (propertyId ? w.propertyId === propertyId : true) &&
      w.status !== 'done' && w.status !== 'cancelled',
    ).length,
    [workOrders],
  );

  return {
    properties,
    workOrders,
    addProperty,
    updateProperty,
    deleteProperty,
    getProperty,
    addWorkOrder,
    updateWorkOrder,
    deleteWorkOrder,
    getWorkOrder,
    getWorkOrdersForProperty,
    getOpenWorkOrderCount,
  };
});
