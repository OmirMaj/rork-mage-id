// useOwnerSuppliedItems — offline-first hook for OFCI / OFOI items.
//
// PM audit's #1 missing primitive vs. Procore + Buildertrend. The
// homeowner is sourcing the appliances / fixtures / specialty
// items; the GC doesn't bill them but needs the schedule-aware
// receipt-side ("when does this need to be on site?") plus
// closeout-binder finishes ("what brand/model is the dishwasher?").
//
// Same offline-first pattern as useDeliveryReceipts /
// useDrawPeriods / useSubChangeRequests.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import type { OwnerSuppliedItem, OwnerSuppliedMode, OwnerSuppliedStatus } from '@/types';

const STORAGE_KEY = 'tertiary_owner_supplied_items';

interface DBRow {
  id: string;
  user_id: string;
  project_id: string;
  mode: OwnerSuppliedMode;
  status: OwnerSuppliedStatus;
  description: string;
  brand: string | null;
  model: string | null;
  sku: string | null;
  vendor: string | null;
  cost_basis: number | null;
  need_by: string | null;
  delivery_at: string | null;
  installed_at: string | null;
  linked_task_id: string | null;
  linked_selection_id: string | null;
  photos: string[] | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): OwnerSuppliedItem {
  return {
    id: r.id,
    projectId: r.project_id,
    mode: r.mode,
    status: r.status,
    description: r.description,
    brand: r.brand ?? undefined,
    model: r.model ?? undefined,
    sku: r.sku ?? undefined,
    vendor: r.vendor ?? undefined,
    costBasis: r.cost_basis ?? undefined,
    needBy: r.need_by ?? undefined,
    deliveryAt: r.delivery_at ?? undefined,
    installedAt: r.installed_at ?? undefined,
    linkedTaskId: r.linked_task_id ?? undefined,
    linkedSelectionId: r.linked_selection_id ?? undefined,
    photos: Array.isArray(r.photos) ? r.photos : undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseOwnerSuppliedItemsResult {
  items: OwnerSuppliedItem[];
  itemsForProject: (projectId: string) => OwnerSuppliedItem[];
  loading: boolean;
  addItem: (input: Omit<OwnerSuppliedItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => OwnerSuppliedItem;
  updateItem: (id: string, patch: Partial<OwnerSuppliedItem>) => void;
  deleteItem: (id: string) => void;
}

export function useOwnerSuppliedItems(): UseOwnerSuppliedItemsResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [items, setItems] = useState<OwnerSuppliedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  // Hydrate from local cache on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setItems(parsed as OwnerSuppliedItem[]);
        }
      } catch (err) {
        console.log('[useOwnerSuppliedItems] local load failed', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Server pull on auth.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('owner_supplied_items')
          .select('*')
          .eq('user_id', userId)
          .order('updated_at', { ascending: false });
        if (cancelled) return;
        if (error) {
          console.log('[useOwnerSuppliedItems] server pull failed', error.message);
          return;
        }
        const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
        setItems(list);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ok */ }
      } catch (err) {
        console.log('[useOwnerSuppliedItems] server pull error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback((next: OwnerSuppliedItem[]) => {
    setItems(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  const addItem = useCallback<UseOwnerSuppliedItemsResult['addItem']>((input) => {
    const now = new Date().toISOString();
    const item: OwnerSuppliedItem = {
      id: input.id ?? generateUUID(),
      projectId: input.projectId,
      mode: input.mode,
      status: input.status,
      description: input.description,
      brand: input.brand,
      model: input.model,
      sku: input.sku,
      vendor: input.vendor,
      costBasis: input.costBasis,
      needBy: input.needBy,
      deliveryAt: input.deliveryAt,
      installedAt: input.installedAt,
      linkedTaskId: input.linkedTaskId,
      linkedSelectionId: input.linkedSelectionId,
      photos: input.photos,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    const next = [item, ...items];
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('owner_supplied_items', 'insert', {
        id: item.id,
        user_id: userId,
        project_id: item.projectId,
        mode: item.mode,
        status: item.status,
        description: item.description,
        brand: item.brand ?? null,
        model: item.model ?? null,
        sku: item.sku ?? null,
        vendor: item.vendor ?? null,
        cost_basis: item.costBasis ?? null,
        need_by: item.needBy ?? null,
        delivery_at: item.deliveryAt ?? null,
        installed_at: item.installedAt ?? null,
        linked_task_id: item.linkedTaskId ?? null,
        linked_selection_id: item.linkedSelectionId ?? null,
        photos: item.photos ?? [],
        notes: item.notes ?? null,
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      });
    }
    return item;
  }, [items, persist, userId]);

  const updateItem = useCallback<UseOwnerSuppliedItemsResult['updateItem']>((id, patch) => {
    const now = new Date().toISOString();
    const next = items.map(i => i.id === id ? { ...i, ...patch, updatedAt: now } : i);
    persist(next);
    if (userId && isSupabaseConfigured) {
      const item = next.find(x => x.id === id);
      if (item) {
        void supabaseWrite('owner_supplied_items', 'update', {
          id,
          mode: item.mode,
          status: item.status,
          description: item.description,
          brand: item.brand ?? null,
          model: item.model ?? null,
          sku: item.sku ?? null,
          vendor: item.vendor ?? null,
          cost_basis: item.costBasis ?? null,
          need_by: item.needBy ?? null,
          delivery_at: item.deliveryAt ?? null,
          installed_at: item.installedAt ?? null,
          linked_task_id: item.linkedTaskId ?? null,
          linked_selection_id: item.linkedSelectionId ?? null,
          photos: item.photos ?? [],
          notes: item.notes ?? null,
          updated_at: now,
        });
      }
    }
  }, [items, persist, userId]);

  const deleteItem = useCallback<UseOwnerSuppliedItemsResult['deleteItem']>((id) => {
    const next = items.filter(i => i.id !== id);
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('owner_supplied_items', 'delete', { id });
    }
  }, [items, persist, userId]);

  const itemsForProject = useCallback(
    (projectId: string) => items.filter(i => i.projectId === projectId),
    [items],
  );

  return useMemo(() => ({
    items, itemsForProject, loading, addItem, updateItem, deleteItem,
  }), [items, itemsForProject, loading, addItem, updateItem, deleteItem]);
}
