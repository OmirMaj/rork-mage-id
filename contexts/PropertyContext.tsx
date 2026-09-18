// PropertyContext — portfolio data for the Property Manager persona:
// managed properties + the work orders logged against them.
//
// Why a dedicated context (rather than folding into ProjectContext): this
// is a brand-new persona surface with its own collections. Keeping it
// isolated means the giant ProjectContext stays untouched, and the PM
// feature can evolve without risking the contractor core. The work-order →
// contractor bridge lives in the UI (app/work-order.tsx).
//
// SERVER-BACKED (audit round 2, #20). v1 was local-only under `mageid_*`, and
// AuthContext.wipeLocalUserCache sweeps that prefix on every sign-out — so one
// sign-out erased a PM's whole portfolio, silently (the sign-out prompt counts
// the offline queue, and local-only records never entered it). Now, like the
// Last Planner (hooks/useLastPlanner.ts):
//   - every change is upserted to managed_properties / work_orders through
//     utils/offlineQueue, so an offline edit sits in the queue the sign-out
//     prompt counts;
//   - on every signed-in load the device copy is merged with the server copy
//     (utils/propertyMirror.mergeMirror — newer updatedAt wins, tombstones
//     delete, device-only records upload), so a sign-out, a new phone or the
//     web app all come back to the same portfolio;
//   - deletes are tombstones (deleted_at), so another device drops its copy
//     instead of uploading it back.
// The device cache is keyed per user (propertyCacheKeys) and still under
// `mageid_`, so the sweep removes a cache, never the record.

import { useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { generateUUID } from '@/utils/generateId';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import {
  PROPERTY_TABLES, LEGACY_PROPERTIES_KEY, LEGACY_WORK_ORDERS_KEY, propertyCacheKeys,
  propertyToRow, propertyFromRow, workOrderToRow, workOrderFromRow, mergeMirror,
  type WorkOrderRecord,
} from '@/utils/propertyMirror';
import type { ManagedProperty, WorkOrder } from '@/types';

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

const valid = <T extends { id?: unknown }>(xs: unknown): T[] =>
  Array.isArray(xs) ? (xs as T[]).filter(x => x && typeof x.id === 'string') : [];

export const [PropertyProvider, useProperties] = createContextHook(() => {
  const { user, isLoading: authLoading } = useAuth();
  const userId = user?.id ?? null;

  const [properties, setProperties] = useState<ManagedProperty[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRecord[]>([]);
  /** 'synced' = merged with the server this session; 'local' = device copy only. */
  const [syncState, setSyncState] = useState<'pending' | 'synced' | 'local'>('pending');
  // Mutators read and write these synchronously so each one knows exactly
  // which record it changed (that record — and only it — is pushed).
  const propsRef = useRef<ManagedProperty[]>([]);
  const wosRef = useRef<WorkOrderRecord[]>([]);
  // The user the in-memory copy belongs to. Writes are persisted under THIS
  // user's key and pushed as THIS user; null until the first hydrate lands, so
  // nothing writes the empty initial state over a persisted cache.
  const ownerRef = useRef<{ userId: string | null } | null>(null);

  const commit = useCallback((nextProps: ManagedProperty[] | null, nextWos: WorkOrderRecord[] | null) => {
    const owner = ownerRef.current;
    const keys = propertyCacheKeys(owner?.userId ?? null);
    if (nextProps) {
      propsRef.current = nextProps;
      setProperties(nextProps);
      if (owner) void saveLocal(keys.properties, nextProps);
    }
    if (nextWos) {
      wosRef.current = nextWos;
      setWorkOrders(nextWos);
      if (owner) void saveLocal(keys.workOrders, nextWos);
    }
  }, []);

  const pushProperty = useCallback((p: ManagedProperty, deletedAt: string | null = null) => {
    const uid = ownerRef.current?.userId;
    if (!uid || !isSupabaseConfigured) return;
    void supabaseWrite(PROPERTY_TABLES.properties, 'upsert', propertyToRow(p, uid, deletedAt));
  }, []);

  const pushWorkOrder = useCallback((w: WorkOrderRecord, deletedAt: string | null = null) => {
    const uid = ownerRef.current?.userId;
    if (!uid || !isSupabaseConfigured) return;
    void supabaseWrite(PROPERTY_TABLES.workOrders, 'upsert', workOrderToRow(w, uid, deletedAt));
  }, []);

  // ── Hydrate (device, then server) — re-run whenever the user changes ────
  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;
    // A different user (or sign-out) must never see, persist or push the
    // previous user's portfolio: drop it from memory before anything else.
    ownerRef.current = null;
    propsRef.current = [];
    wosRef.current = [];
    setProperties([]);
    setWorkOrders([]);
    setSyncState('pending');

    (async () => {
      const keys = propertyCacheKeys(userId);
      let [props, wos] = await Promise.all([
        loadLocal<unknown>(keys.properties, []).then(x => valid<ManagedProperty>(x)),
        loadLocal<unknown>(keys.workOrders, []).then(x => valid<WorkOrderRecord>(x)),
      ]);
      // v1 wrote un-scoped keys. Whatever is still there belongs to the
      // session that is open now (the tenant sweep removes them on every
      // sign-out and every new sign-in), so adopt it once, then remove it.
      if (userId) {
        const [legacyProps, legacyWos] = await Promise.all([
          loadLocal<unknown>(LEGACY_PROPERTIES_KEY, []).then(x => valid<ManagedProperty>(x)),
          loadLocal<unknown>(LEGACY_WORK_ORDERS_KEY, []).then(x => valid<WorkOrderRecord>(x)),
        ]);
        if (legacyProps.length || legacyWos.length) {
          const haveP = new Set(props.map(p => p.id));
          const haveW = new Set(wos.map(w => w.id));
          props = [...props, ...legacyProps.filter(p => !haveP.has(p.id))];
          wos = [...wos, ...legacyWos.filter(w => !haveW.has(w.id))];
          await saveLocal(keys.properties, props);
          await saveLocal(keys.workOrders, wos);
        }
        try { await AsyncStorage.multiRemove([LEGACY_PROPERTIES_KEY, LEGACY_WORK_ORDERS_KEY]); } catch { /* retried next load */ }
      }
      if (cancelled) return;
      // FOLD IN what he did before this landed. The reset above emptied the
      // refs, so anything in them now was added (or edited) in THIS session
      // while the device copy was still loading — commit() kept it in memory
      // but could neither persist nor push it (no owner yet), and committing
      // the device copy over it used to drop it without a word. Memory wins
      // on an id clash: it is the newer edit.
      const earlyProps = propsRef.current;
      const earlyWos = wosRef.current;
      const earlyP = new Set(earlyProps.map(p => p.id));
      const earlyW = new Set(earlyWos.map(w => w.id));
      ownerRef.current = { userId };
      commit([...earlyProps, ...props.filter(p => !earlyP.has(p.id))], [...earlyWos, ...wos.filter(w => !earlyW.has(w.id))]);
      for (const x of earlyProps) pushProperty(x);
      for (const x of earlyWos) pushWorkOrder(x);

      if (!userId || !isSupabaseConfigured) { setSyncState('local'); return; }
      try {
        const [p, w] = await Promise.all([
          supabase.from(PROPERTY_TABLES.properties).select('*').eq('user_id', userId),
          supabase.from(PROPERTY_TABLES.workOrders).select('*').eq('user_id', userId),
        ]);
        // Covers "table not migrated yet": keep working from the device.
        if (p.error) throw p.error;
        if (w.error) throw w.error;
        if (cancelled || ownerRef.current?.userId !== userId) return;
        // Merge against the CURRENT memory, not the snapshot above: an add
        // made while the request was in flight must survive the merge.
        const mp = mergeMirror(propsRef.current, (p.data ?? []) as Record<string, unknown>[], propertyFromRow);
        const mw = mergeMirror(wosRef.current, (w.data ?? []) as Record<string, unknown>[], workOrderFromRow);
        commit(mp.merged, mw.merged);
        for (const x of mp.push) pushProperty(x);
        for (const x of mw.push) pushWorkOrder(x);
        setSyncState('synced');
      } catch (err) {
        console.warn('[Property] Server copy unavailable; using this device only:', err);
        if (!cancelled) setSyncState('local');
      }
    })();
    return () => { cancelled = true; };
  }, [userId, authLoading, commit, pushProperty, pushWorkOrder]);

  // ── Properties ──────────────────────────────────────────────────────
  const addProperty = useCallback((
    input: Omit<ManagedProperty, 'id' | 'createdAt' | 'updatedAt'>,
  ): ManagedProperty => {
    const now = new Date().toISOString();
    const property: ManagedProperty = { ...input, id: generateUUID(), createdAt: now, updatedAt: now };
    commit([property, ...propsRef.current], null);
    pushProperty(property);
    return property;
  }, [commit, pushProperty]);

  const updateProperty = useCallback((id: string, updates: Partial<ManagedProperty>) => {
    const now = new Date().toISOString();
    let changed: ManagedProperty | null = null;
    const next = propsRef.current.map(p => {
      if (p.id !== id) return p;
      changed = { ...p, ...updates, id: p.id, updatedAt: now };
      return changed;
    });
    if (!changed) return;
    commit(next, null);
    pushProperty(changed);
  }, [commit, pushProperty]);

  const deleteProperty = useCallback((id: string) => {
    const now = new Date().toISOString();
    const gone = propsRef.current.find(p => p.id === id);
    // Cascade — a property's work orders have no meaning without it.
    const goneWos = wosRef.current.filter(w => w.propertyId === id);
    commit(propsRef.current.filter(p => p.id !== id), wosRef.current.filter(w => w.propertyId !== id));
    // Tombstones, stamped now, so every other device drops its copy.
    if (gone) pushProperty({ ...gone, updatedAt: now }, now);
    for (const w of goneWos) pushWorkOrder({ ...w, updatedAt: now }, now);
  }, [commit, pushProperty, pushWorkOrder]);

  const getProperty = useCallback(
    (id: string) => properties.find(p => p.id === id) ?? null,
    [properties],
  );

  // ── Work orders ─────────────────────────────────────────────────────
  const addWorkOrder = useCallback((
    input: Omit<WorkOrder, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: WorkOrder['status'] },
  ): WorkOrder => {
    const now = new Date().toISOString();
    const wo: WorkOrderRecord = {
      ...input,
      status: input.status ?? 'open',
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
    };
    commit(null, [wo, ...wosRef.current]);
    pushWorkOrder(wo);
    return wo;
  }, [commit, pushWorkOrder]);

  const updateWorkOrder = useCallback((id: string, updates: Partial<WorkOrderRecord>) => {
    const now = new Date().toISOString();
    let changed: WorkOrderRecord | null = null;
    const next = wosRef.current.map(w => {
      if (w.id !== id) return w;
      changed = { ...w, ...updates, id: w.id, updatedAt: now };
      return changed;
    });
    if (!changed) return;
    commit(null, next);
    pushWorkOrder(changed);
  }, [commit, pushWorkOrder]);

  const deleteWorkOrder = useCallback((id: string) => {
    const now = new Date().toISOString();
    const gone = wosRef.current.find(w => w.id === id);
    commit(null, wosRef.current.filter(w => w.id !== id));
    if (gone) pushWorkOrder({ ...gone, updatedAt: now }, now);
  }, [commit, pushWorkOrder]);

  const getWorkOrder = useCallback(
    (id: string): WorkOrderRecord | null => workOrders.find(w => w.id === id) ?? null,
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
    /** Whether this session's portfolio is backed by the server copy yet. */
    syncState,
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
