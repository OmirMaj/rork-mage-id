// usePermitTemplates — offline-first hook for the filing reuse engine.
// Vision-doc feature P9.
//
// Same shape as useDeliveryReceipts / useDrawPeriods: AsyncStorage
// cache, Supabase pull on auth, queued writes via supabaseWrite.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';
import type { PermitType, SpecialInspectionCategory } from '@/types';

const STORAGE_KEY = 'tertiary_permit_templates';

export interface PermitTemplate {
  id: string;
  name: string;
  type: PermitType;
  jurisdiction: string;
  scopeTemplate?: string;
  typicalFee?: number;
  phase?: string;
  specialInspectionCategory?: SpecialInspectionCategory;
  notes?: string;
  useCount: number;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

interface DBRow {
  id: string;
  user_id: string;
  name: string;
  type: PermitType;
  jurisdiction: string;
  scope_template: string | null;
  typical_fee: number | null;
  phase: string | null;
  special_inspection_category: SpecialInspectionCategory | null;
  notes: string | null;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): PermitTemplate {
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    jurisdiction: r.jurisdiction,
    scopeTemplate: r.scope_template ?? undefined,
    typicalFee: r.typical_fee ?? undefined,
    phase: r.phase ?? undefined,
    specialInspectionCategory: r.special_inspection_category ?? undefined,
    notes: r.notes ?? undefined,
    useCount: r.use_count,
    lastUsedAt: r.last_used_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UsePermitTemplatesResult {
  templates: PermitTemplate[];
  loading: boolean;
  addTemplate: (input: Omit<PermitTemplate, 'id' | 'useCount' | 'createdAt' | 'updatedAt'> & { id?: string }) => PermitTemplate;
  updateTemplate: (id: string, patch: Partial<PermitTemplate>) => void;
  deleteTemplate: (id: string) => void;
  /** Increments useCount + sets lastUsedAt. Called by the permit-create
   *  flow when a permit is instantiated from this template. */
  recordUse: (id: string) => void;
}

export function usePermitTemplates(): UsePermitTemplatesResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [templates, setTemplates] = useState<PermitTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  // Hydrate from cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setTemplates(parsed as PermitTemplate[]);
        }
      } catch (err) {
        console.warn('[usePermitTemplates] local load failed', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          hydratedRef.current = true;
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Server pull.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('permit_templates')
          .select('*')
          .eq('user_id', userId)
          .order('last_used_at', { ascending: false, nullsFirst: false });
        if (cancelled) return;
        if (error) {
          console.warn('[usePermitTemplates] server pull failed', error.message);
          return;
        }
        const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
        setTemplates(list);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ok */ }
      } catch (err) {
        console.warn('[usePermitTemplates] server pull error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback((next: PermitTemplate[]) => {
    setTemplates(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  const addTemplate = useCallback<UsePermitTemplatesResult['addTemplate']>((input) => {
    const now = new Date().toISOString();
    const t: PermitTemplate = {
      id: input.id ?? generateUUID(),
      name: input.name,
      type: input.type,
      jurisdiction: input.jurisdiction,
      scopeTemplate: input.scopeTemplate,
      typicalFee: input.typicalFee,
      phase: input.phase,
      specialInspectionCategory: input.specialInspectionCategory,
      notes: input.notes,
      useCount: 0,
      lastUsedAt: input.lastUsedAt,
      createdAt: now,
      updatedAt: now,
    };
    const next = [t, ...templates];
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('permit_templates', 'insert', {
        id: t.id, user_id: userId, name: t.name, type: t.type,
        jurisdiction: t.jurisdiction, scope_template: t.scopeTemplate ?? null,
        typical_fee: t.typicalFee ?? null, phase: t.phase ?? null,
        special_inspection_category: t.specialInspectionCategory ?? null,
        notes: t.notes ?? null, use_count: 0,
        last_used_at: t.lastUsedAt ?? null,
        created_at: t.createdAt, updated_at: t.updatedAt,
      });
    }
    return t;
  }, [templates, persist, userId]);

  const updateTemplate = useCallback<UsePermitTemplatesResult['updateTemplate']>((id, patch) => {
    const now = new Date().toISOString();
    const next = templates.map(t => t.id === id ? { ...t, ...patch, updatedAt: now } : t);
    persist(next);
    if (userId && isSupabaseConfigured) {
      const t = next.find(x => x.id === id);
      if (t) {
        void supabaseWrite('permit_templates', 'update', {
          id, name: t.name, type: t.type, jurisdiction: t.jurisdiction,
          scope_template: t.scopeTemplate ?? null,
          typical_fee: t.typicalFee ?? null, phase: t.phase ?? null,
          special_inspection_category: t.specialInspectionCategory ?? null,
          notes: t.notes ?? null, use_count: t.useCount,
          last_used_at: t.lastUsedAt ?? null, updated_at: now,
        });
      }
    }
  }, [templates, persist, userId]);

  const deleteTemplate = useCallback<UsePermitTemplatesResult['deleteTemplate']>((id) => {
    const next = templates.filter(t => t.id !== id);
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('permit_templates', 'delete', { id });
    }
  }, [templates, persist, userId]);

  const recordUse = useCallback<UsePermitTemplatesResult['recordUse']>((id) => {
    const now = new Date().toISOString();
    const next = templates.map(t => t.id === id
      ? { ...t, useCount: t.useCount + 1, lastUsedAt: now, updatedAt: now }
      : t,
    );
    persist(next);
    if (userId && isSupabaseConfigured) {
      const t = next.find(x => x.id === id);
      if (t) {
        void supabaseWrite('permit_templates', 'update', {
          id, use_count: t.useCount, last_used_at: now, updated_at: now,
        });
      }
    }
  }, [templates, persist, userId]);

  return useMemo(() => ({
    templates, loading, addTemplate, updateTemplate, deleteTemplate, recordUse,
  }), [templates, loading, addTemplate, updateTemplate, deleteTemplate, recordUse]);
}
