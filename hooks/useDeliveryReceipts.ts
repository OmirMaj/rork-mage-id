// useDeliveryReceipts — offline-first hook for the structured
// delivery-receipt feature. Mirrors the useTimeEntries / useWorkers
// pattern: AsyncStorage source-of-truth, server pull on auth, writes
// queued via supabaseWrite.
//
// Pre-fix material deliveries lived as `materialsDelivered: string[]`
// on each Daily Field Report. The super audit flagged this as a
// discovery deal-breaker for material-heavy residential GCs vs.
// Procore / Buildertrend / Raken. Now: structured records with
// supplier, line items, BOL photo, signature, damage flag.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import type { DeliveryReceipt } from '@/types';

const STORAGE_KEY = 'tertiary_delivery_receipts';

interface DBRow {
  id: string;
  user_id: string;
  project_id: string;
  date: string;
  supplier: string;
  po_number: string | null;
  commitment_id: string | null;
  items: DeliveryReceipt['items'];
  bol_photo_uri: string | null;
  signature_photo_uri: string | null;
  has_damage: boolean;
  damage_notes: string | null;
  received_at: string;
  received_by: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): DeliveryReceipt {
  return {
    id: r.id,
    projectId: r.project_id,
    date: r.date,
    supplier: r.supplier,
    poNumber: r.po_number ?? undefined,
    commitmentId: r.commitment_id ?? undefined,
    items: Array.isArray(r.items) ? r.items : [],
    bolPhotoUri: r.bol_photo_uri ?? undefined,
    signaturePhotoUri: r.signature_photo_uri ?? undefined,
    hasDamage: !!r.has_damage,
    damageNotes: r.damage_notes ?? undefined,
    receivedAt: r.received_at,
    receivedBy: r.received_by,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseDeliveryReceiptsResult {
  receipts: DeliveryReceipt[];
  receiptsForProject: (projectId: string) => DeliveryReceipt[];
  loading: boolean;
  addReceipt: (input: Omit<DeliveryReceipt, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => DeliveryReceipt;
  updateReceipt: (id: string, patch: Partial<DeliveryReceipt>) => void;
  deleteReceipt: (id: string) => void;
}

export function useDeliveryReceipts(): UseDeliveryReceiptsResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [receipts, setReceipts] = useState<DeliveryReceipt[]>([]);
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
          if (Array.isArray(parsed)) setReceipts(parsed as DeliveryReceipt[]);
        }
      } catch (err) {
        console.log('[useDeliveryReceipts] local load failed', err);
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
          .from('delivery_receipts')
          .select('*')
          .eq('user_id', userId)
          .order('date', { ascending: false });
        if (cancelled) return;
        if (error) {
          console.log('[useDeliveryReceipts] server pull failed', error.message);
          return;
        }
        const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
        setReceipts(list);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ok */ }
      } catch (err) {
        console.log('[useDeliveryReceipts] server pull error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback((next: DeliveryReceipt[]) => {
    setReceipts(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  const addReceipt = useCallback<UseDeliveryReceiptsResult['addReceipt']>((input) => {
    const now = new Date().toISOString();
    const r: DeliveryReceipt = {
      id: input.id ?? generateUUID(),
      projectId: input.projectId,
      date: input.date,
      supplier: input.supplier,
      poNumber: input.poNumber,
      commitmentId: input.commitmentId,
      items: input.items ?? [],
      bolPhotoUri: input.bolPhotoUri,
      signaturePhotoUri: input.signaturePhotoUri,
      hasDamage: !!input.hasDamage,
      damageNotes: input.damageNotes,
      receivedAt: input.receivedAt,
      receivedBy: input.receivedBy,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    const next = [r, ...receipts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('delivery_receipts', 'insert', {
        id: r.id,
        user_id: userId,
        project_id: r.projectId,
        date: r.date,
        supplier: r.supplier,
        po_number: r.poNumber ?? null,
        commitment_id: r.commitmentId ?? null,
        items: r.items,
        bol_photo_uri: r.bolPhotoUri ?? null,
        signature_photo_uri: r.signaturePhotoUri ?? null,
        has_damage: r.hasDamage,
        damage_notes: r.damageNotes ?? null,
        received_at: r.receivedAt,
        received_by: r.receivedBy,
        notes: r.notes ?? null,
        created_at: r.createdAt,
        updated_at: r.updatedAt,
      });
    }
    return r;
  }, [receipts, persist, userId]);

  const updateReceipt = useCallback<UseDeliveryReceiptsResult['updateReceipt']>((id, patch) => {
    const now = new Date().toISOString();
    const next = receipts.map(r => r.id === id ? { ...r, ...patch, updatedAt: now } : r);
    persist(next);
    if (userId && isSupabaseConfigured) {
      const r = next.find(x => x.id === id);
      if (r) {
        void supabaseWrite('delivery_receipts', 'update', {
          id,
          supplier: r.supplier,
          po_number: r.poNumber ?? null,
          items: r.items,
          bol_photo_uri: r.bolPhotoUri ?? null,
          signature_photo_uri: r.signaturePhotoUri ?? null,
          has_damage: r.hasDamage,
          damage_notes: r.damageNotes ?? null,
          notes: r.notes ?? null,
          updated_at: now,
        });
      }
    }
  }, [receipts, persist, userId]);

  const deleteReceipt = useCallback<UseDeliveryReceiptsResult['deleteReceipt']>((id) => {
    const next = receipts.filter(r => r.id !== id);
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('delivery_receipts', 'delete', { id });
    }
  }, [receipts, persist, userId]);

  const receiptsForProject = useCallback(
    (projectId: string) => receipts.filter(r => r.projectId === projectId),
    [receipts],
  );

  return useMemo(() => ({
    receipts, receiptsForProject, loading,
    addReceipt, updateReceipt, deleteReceipt,
  }), [receipts, receiptsForProject, loading, addReceipt, updateReceipt, deleteReceipt]);
}
