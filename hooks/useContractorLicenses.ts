// useContractorLicenses — offline-first hook for the GC's licenses.
// Vision-doc #19 extension. Same pattern as useDeliveryReceipts /
// useDrawPeriods.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { supabaseWrite } from '@/utils/offlineQueue';
import { generateUUID } from '@/utils/generateId';

const STORAGE_KEY = 'tertiary_contractor_licenses';

export type LicenseType =
  | 'gc'                  // General contractor — DCWP, state contractor's license
  | 'electrical'           // Master electrician
  | 'plumbing'             // Master plumber
  | 'mechanical'           // HVAC / mechanical
  | 'lipa'                 // LIPA registration (LI electrical work)
  | 'state_contractor'     // State-level contractor's license (CA CSLB, FL CILB, etc.)
  | 'home_improvement'     // Home Improvement Contractor (NY HIC, etc.)
  | 'asbestos'             // Asbestos handler / inspector
  | 'lead_paint'           // EPA RRP lead paint cert
  | 'other';

export interface ContractorLicense {
  id: string;
  name: string;                  // "NYC DCWP General Contractor"
  licenseNumber?: string;
  licenseType: LicenseType;
  jurisdiction: string;          // "NYC", "NY State", "Suffolk County"
  issuedDate?: string;           // ISO
  expiresDate: string;           // ISO — required
  documentUri?: string;
  subcontractorId?: string;      // Optional: license owned by a sub
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface DBRow {
  id: string;
  user_id: string;
  name: string;
  license_number: string | null;
  license_type: LicenseType;
  jurisdiction: string;
  issued_date: string | null;
  expires_date: string;
  document_uri: string | null;
  subcontractor_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function fromDB(r: DBRow): ContractorLicense {
  return {
    id: r.id,
    name: r.name,
    licenseNumber: r.license_number ?? undefined,
    licenseType: r.license_type,
    jurisdiction: r.jurisdiction,
    issuedDate: r.issued_date ?? undefined,
    expiresDate: r.expires_date,
    documentUri: r.document_uri ?? undefined,
    subcontractorId: r.subcontractor_id ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseContractorLicensesResult {
  licenses: ContractorLicense[];
  loading: boolean;
  expiringSoon: (withinDays?: number) => ContractorLicense[];
  addLicense: (input: Omit<ContractorLicense, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) => ContractorLicense;
  updateLicense: (id: string, patch: Partial<ContractorLicense>) => void;
  deleteLicense: (id: string) => void;
}

export function useContractorLicenses(): UseContractorLicensesResult {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [licenses, setLicenses] = useState<ContractorLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const hydratedRef = useRef(false);

  // Hydrate cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setLicenses(parsed as ContractorLicense[]);
        }
      } catch (err) {
        console.warn('[useContractorLicenses] local load failed', err);
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
          .from('contractor_licenses')
          .select('*')
          .eq('user_id', userId)
          .order('expires_date', { ascending: true });
        if (cancelled) return;
        if (error) {
          console.warn('[useContractorLicenses] server pull failed', error.message);
          return;
        }
        const list = (data as DBRow[] | null)?.map(fromDB) ?? [];
        setLicenses(list);
        try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ok */ }
      } catch (err) {
        console.warn('[useContractorLicenses] server pull error', err);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const persist = useCallback((next: ContractorLicense[]) => {
    setLicenses(next);
    void (async () => {
      try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ok */ }
    })();
  }, []);

  const addLicense = useCallback<UseContractorLicensesResult['addLicense']>((input) => {
    const now = new Date().toISOString();
    const lic: ContractorLicense = {
      id: input.id ?? generateUUID(),
      name: input.name,
      licenseNumber: input.licenseNumber,
      licenseType: input.licenseType,
      jurisdiction: input.jurisdiction,
      issuedDate: input.issuedDate,
      expiresDate: input.expiresDate,
      documentUri: input.documentUri,
      subcontractorId: input.subcontractorId,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...licenses, lic].sort((a, b) =>
      Date.parse(a.expiresDate) - Date.parse(b.expiresDate),
    );
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('contractor_licenses', 'insert', {
        id: lic.id, user_id: userId, name: lic.name,
        license_number: lic.licenseNumber ?? null, license_type: lic.licenseType,
        jurisdiction: lic.jurisdiction, issued_date: lic.issuedDate ?? null,
        expires_date: lic.expiresDate, document_uri: lic.documentUri ?? null,
        subcontractor_id: lic.subcontractorId ?? null, notes: lic.notes ?? null,
        created_at: lic.createdAt, updated_at: lic.updatedAt,
      });
    }
    return lic;
  }, [licenses, persist, userId]);

  const updateLicense = useCallback<UseContractorLicensesResult['updateLicense']>((id, patch) => {
    const now = new Date().toISOString();
    const next = licenses.map(l => l.id === id ? { ...l, ...patch, updatedAt: now } : l);
    persist(next);
    if (userId && isSupabaseConfigured) {
      const lic = next.find(x => x.id === id);
      if (lic) {
        void supabaseWrite('contractor_licenses', 'update', {
          id, name: lic.name, license_number: lic.licenseNumber ?? null,
          license_type: lic.licenseType, jurisdiction: lic.jurisdiction,
          issued_date: lic.issuedDate ?? null, expires_date: lic.expiresDate,
          document_uri: lic.documentUri ?? null,
          subcontractor_id: lic.subcontractorId ?? null,
          notes: lic.notes ?? null, updated_at: now,
        });
      }
    }
  }, [licenses, persist, userId]);

  const deleteLicense = useCallback<UseContractorLicensesResult['deleteLicense']>((id) => {
    const next = licenses.filter(l => l.id !== id);
    persist(next);
    if (userId && isSupabaseConfigured) {
      void supabaseWrite('contractor_licenses', 'delete', { id });
    }
  }, [licenses, persist, userId]);

  const expiringSoon = useCallback<UseContractorLicensesResult['expiringSoon']>(
    (withinDays = 60) => {
      const cutoff = Date.now() + withinDays * 86_400_000;
      return licenses.filter(l => {
        const t = Date.parse(l.expiresDate);
        return Number.isFinite(t) && t <= cutoff;
      });
    },
    [licenses],
  );

  return useMemo(() => ({
    licenses, loading, expiringSoon, addLicense, updateLicense, deleteLicense,
  }), [licenses, loading, expiringSoon, addLicense, updateLicense, deleteLicense]);
}
