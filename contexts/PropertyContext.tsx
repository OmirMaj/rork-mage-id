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
//   - every change goes to managed_properties / work_orders through
//     utils/offlineQueue, so an offline edit sits in the queue the sign-out
//     prompt counts. A create or a delete is a whole-row upsert; an EDIT is a
//     per-field 'update' (propertyMirror.workOrderPatch / propertyPatch): only
//     the columns it changed, plus updated_at;
//   - the device copy is merged with the server copy on every signed-in load
//     AND on refresh(), which runs on app foreground, on focus of the three PM
//     screens and on pull-to-refresh (utils/propertyMirror.mergeMirror: the
//     server copy wins, except for a record this device has a write for that
//     has not landed yet; tombstones delete; device-only records upload; and
//     nothing the server has is ever pushed whole), so a sign-out, a new phone
//     or the web app all come back to the same portfolio;
//   - deletes are tombstones (deleted_at), so another device drops its copy
//     instead of uploading it back.
//
// WHY PATCHES + REFRESH (Phase 0, PM two-device fix). The server was read only
// at sign-in and every edit upserted the whole row with a fresh updatedAt, so
// the newest whole row won: a laptop left open put a work order the phone had
// marked Done back to Open the moment the PM fixed a typo on it, and nulled
// the assignee an RFP award had PATCHed in. Now the laptop's typo fix sends
// the description and nothing else, and the laptop re-reads the server the
// next time it comes to the front.
// The device cache is keyed per user (propertyCacheKeys) and still under
// `mageid_`, so the sweep removes a cache, never the record.

import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import createContextHook from '@nkzw/create-context-hook';
import { generateUUID } from '@/utils/generateId';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite, getOwnOfflineQueueDetailed, type OfflineMutation } from '@/utils/offlineQueue';
import {
  PROPERTY_TABLES, LEGACY_PROPERTIES_KEY, LEGACY_WORK_ORDERS_KEY, propertyCacheKeys,
  propertyToRow, propertyFromRow, workOrderToRow, workOrderFromRow, mergeMirror,
  workOrderPatch, propertyPatch, queuedRecordIds, type WorkOrderRecord,
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

  // ── Writes this device has not seen land ────────────────────────────────
  // The merge shows the device copy of a record ONLY while this device has a
  // write for it that the server may not have yet (see mergeMirror for why
  // this replaced comparing updatedAt clocks). Three places such a write can
  // be, all keyed `${table}:${id}`:
  //   - on the wire: supabaseWrite has not resolved (inFlightRef);
  //   - sent after the server read began (lastWriteRef seq > the read's start);
  //   - in the offline queue (read before AND after the server read, so one
  //     that drains while the read is out still counts).
  const inFlightRef = useRef(new Map<string, number>());
  const writeSeqRef = useRef(0);
  const lastWriteRef = useRef(new Map<string, number>());

  const send = useCallback((table: string, op: 'upsert' | 'update', row: Record<string, unknown>) => {
    const key = `${table}:${String(row.id)}`;
    writeSeqRef.current += 1;
    lastWriteRef.current.set(key, writeSeqRef.current);
    inFlightRef.current.set(key, (inFlightRef.current.get(key) ?? 0) + 1);
    // Resolves once the write has landed OR sits in the queue: either way the
    // queue read (or the server read) now covers it.
    void supabaseWrite(table, op, row).catch(() => false).finally(() => {
      const n = (inFlightRef.current.get(key) ?? 1) - 1;
      if (n > 0) inFlightRef.current.set(key, n); else inFlightRef.current.delete(key);
    });
  }, []);

  const pushProperty = useCallback((p: ManagedProperty, deletedAt: string | null = null) => {
    const uid = ownerRef.current?.userId;
    if (!uid || !isSupabaseConfigured) return;
    send(PROPERTY_TABLES.properties, 'upsert', propertyToRow(p, uid, deletedAt));
  }, [send]);

  const pushWorkOrder = useCallback((w: WorkOrderRecord, deletedAt: string | null = null) => {
    const uid = ownerRef.current?.userId;
    if (!uid || !isSupabaseConfigured) return;
    send(PROPERTY_TABLES.workOrders, 'upsert', workOrderToRow(w, uid, deletedAt));
  }, [send]);

  // ── Read the server copy and merge it in ────────────────────────────────
  // One read per user at a time: foreground, focus and pull can all fire
  // together, and they share the read already running. Keyed by user so a read
  // still running for the previous account is never handed to the next one.
  // 'merged' = the server copy is in; 'failed' = it could not be read;
  // 'stale' = it was read for a session that has since been reset.
  type PullResult = 'merged' | 'failed' | 'stale';
  const pullRef = useRef<{ userId: string; run: Promise<PullResult> } | null>(null);
  const pullServer = useCallback((uid: string): Promise<PullResult> => {
    if (pullRef.current?.userId === uid) return pullRef.current.run;
    // Registered BEFORE the read starts, so the finally below (which can run
    // synchronously if the client throws) always clears its own entry.
    const entry = { userId: uid } as { userId: string; run: Promise<PullResult> };
    pullRef.current = entry;
    entry.run = (async (): Promise<PullResult> => {
      // Anything sent from here on is newer than what this read can return.
      const seq0 = writeSeqRef.current;
      // Writes on the wire when the read begins may commit after the SELECT's
      // snapshot and resolve before the merge; they count as pending too.
      const onWireAtStart = [...inFlightRef.current.keys()];
      const readQueue = (): Promise<OfflineMutation[] | null> =>
        getOwnOfflineQueueDetailed().then(r => (r.readFailed ? null : r.entries)).catch(() => null);
      try {
        const queuedBefore = await readQueue();
        const [p, w] = await Promise.all([
          supabase.from(PROPERTY_TABLES.properties).select('*').eq('user_id', uid),
          supabase.from(PROPERTY_TABLES.workOrders).select('*').eq('user_id', uid),
        ]);
        // Covers "table not migrated yet": keep working from the device.
        if (p.error) throw p.error;
        if (w.error) throw w.error;
        const queuedAfter = await readQueue();
        // Signed out or switched account while the read was out: not ours.
        if (ownerRef.current?.userId !== uid) return 'stale';
        // The records whose device copy the server may not have yet.
        const pendingFor = (table: string, local: readonly { id: string }[]): Set<string> => {
          // Could not read the queue: we cannot tell, so keep every device
          // copy this time rather than drop an edit still waiting to go (and
          // re-send no create: the next readable refresh sends any that never
          // went).
          const ids = !queuedBefore || !queuedAfter
            ? new Set(local.map(x => x.id))
            : new Set([...queuedRecordIds(table, queuedBefore), ...queuedRecordIds(table, queuedAfter)]);
          const prefix = `${table}:`;
          for (const key of onWireAtStart) if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
          for (const key of inFlightRef.current.keys()) if (key.startsWith(prefix)) ids.add(key.slice(prefix.length));
          for (const [key, seq] of lastWriteRef.current) if (seq > seq0 && key.startsWith(prefix)) ids.add(key.slice(prefix.length));
          return ids;
        };
        // Merge against the CURRENT memory, not a snapshot: an edit made while
        // the request was in flight is in `pending`, and its copy stays.
        const mp = mergeMirror(propsRef.current, (p.data ?? []) as Record<string, unknown>[], propertyFromRow,
          pendingFor(PROPERTY_TABLES.properties, propsRef.current));
        const mw = mergeMirror(wosRef.current, (w.data ?? []) as Record<string, unknown>[], workOrderFromRow,
          pendingFor(PROPERTY_TABLES.workOrders, wosRef.current));
        // Writes sent before this read began are the queue's business now;
        // reads run one at a time, so no later read needs them.
        for (const [key, seq] of lastWriteRef.current) if (seq <= seq0) lastWriteRef.current.delete(key);
        commit(mp.merged, mw.merged);
        // Only records the server has never seen (creates) come back here.
        for (const x of mp.push) pushProperty(x);
        for (const x of mw.push) pushWorkOrder(x);
        setSyncState('synced');
        return 'merged';
      } catch (err) {
        console.warn('[Property] Server copy unavailable; using this device only:', err);
        if (ownerRef.current?.userId === uid) setSyncState(s => (s === 'synced' ? s : 'local'));
        return 'failed';
      } finally {
        if (pullRef.current === entry) pullRef.current = null;
      }
    })();
    return entry.run;
  }, [commit, pushProperty, pushWorkOrder]);

  /** Re-read the server copy now. Resolves true when the portfolio on screen
   *  is the merged server copy, false when it could not be read (offline,
   *  signed out, not configured) and the device copy stays as it was. */
  const refresh = useCallback(async (): Promise<boolean> => {
    const uid = ownerRef.current?.userId;
    if (!uid || !isSupabaseConfigured) return false;
    return (await pullServer(uid)) === 'merged';
  }, [pullServer]);

  // Coming back to the app is when the other device's edits are most likely
  // waiting (the phone marked it Done while the laptop tab sat in the
  // background). Screens add focus and pull-to-refresh on top of this.
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

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
      // The same read refresh() uses; it drops its result if the user changed.
      // 'stale' = it joined a read started before this load reset the
      // session (same user, auth re-emitted), so read once more for this one.
      if ((await pullServer(userId)) === 'stale' && !cancelled && ownerRef.current?.userId === userId) {
        await pullServer(userId);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, authLoading, commit, pushProperty, pushWorkOrder, pullServer]);

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

  // An edit sends ONLY what it changed (see the header). The patch is diffed
  // against this device's copy before the edit, so fields the PM did not touch
  // are never written, however stale this device's copy of them is.
  const updateProperty = useCallback((id: string, updates: Partial<ManagedProperty>) => {
    const before = propsRef.current.find(p => p.id === id);
    if (!before) return;
    const after: ManagedProperty = { ...before, ...updates, id: before.id, updatedAt: new Date().toISOString() };
    const uid = ownerRef.current?.userId ?? null;
    // Nothing changed: no write, and no fresh updatedAt to outrank the server.
    const patch = propertyPatch(before, after, uid ?? '');
    if (!patch) return;
    commit(propsRef.current.map(p => (p.id === id ? after : p)), null);
    if (uid && isSupabaseConfigured) send(PROPERTY_TABLES.properties, 'update', patch);
  }, [commit, send]);

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
    const before = wosRef.current.find(w => w.id === id);
    if (!before) return;
    const after: WorkOrderRecord = { ...before, ...updates, id: before.id, updatedAt: new Date().toISOString() };
    const uid = ownerRef.current?.userId ?? null;
    const patch = workOrderPatch(before, after, uid ?? '');
    if (!patch) return;
    commit(null, wosRef.current.map(w => (w.id === id ? after : w)));
    if (uid && isSupabaseConfigured) send(PROPERTY_TABLES.workOrders, 'update', patch);
  }, [commit, send]);

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
    /** Re-read the server copy (foreground runs it; PM screens call it on
     *  focus and pull-to-refresh). */
    refresh,
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
