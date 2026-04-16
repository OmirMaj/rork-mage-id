import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { CompanyProfile, CertificationType, BidCategory } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';

const COMPANIES_KEY = 'mageid_companies';

export const [CompaniesProvider, useCompanies] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isGuest = user?.isGuest ?? true;
  const canSync = !isGuest && !!userId && isSupabaseConfigured;
  const [companies, setCompanies] = useState<CompanyProfile[]>([]);

  const companiesQuery = useQuery({
    queryKey: ['companies'],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('companies')
            .select('*')
            .order('fetched_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => ({
              id: r.id as string, companyName: (r.company_name as string) ?? '',
              city: (r.city as string) ?? '', state: (r.state as string) ?? '',
              primaryCategory: (r.primary_category as BidCategory) ?? 'construction',
              bondCapacity: Number(r.bond_capacity) || 0, completedProjects: Number(r.completed_projects) || 0,
              rating: Number(r.rating) || 0, contactEmail: (r.contact_email as string) ?? '',
              phone: (r.phone as string) ?? '', description: (r.description as string) ?? '',
              certifications: (r.certifications as CertificationType[]) ?? [],
              website: r.website as string | undefined, yearEstablished: r.year_established as number | undefined,
              employeeCount: r.employee_count as number | undefined, createdAt: r.created_at as string,
            })) as CompanyProfile[];
            await AsyncStorage.setItem(COMPANIES_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[CompaniesContext] Supabase fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(COMPANIES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CompanyProfile[];
        if (parsed.length > 0) return parsed;
      }
      return [];
    },
  });

  useEffect(() => { if (companiesQuery.data) setCompanies(companiesQuery.data); }, [companiesQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (updated: CompanyProfile[]) => { await AsyncStorage.setItem(COMPANIES_KEY, JSON.stringify(updated)); return updated; },
    onSuccess: (data) => { queryClient.setQueryData(['companies'], data); },
  });

  const addCompany = useCallback((company: CompanyProfile) => {
    const updated = [company, ...companies];
    setCompanies(updated);
    saveMutation.mutate(updated);
    if (canSync) {
      void supabaseWrite('companies', 'insert', {
        id: company.id, user_id: userId, company_name: company.companyName,
        city: company.city, state: company.state, primary_category: company.primaryCategory,
        bond_capacity: company.bondCapacity, completed_projects: company.completedProjects,
        rating: company.rating, contact_email: company.contactEmail, phone: company.phone,
        description: company.description, certifications: company.certifications,
        website: company.website, year_established: company.yearEstablished, employee_count: company.employeeCount,
      });
    }
  }, [companies, saveMutation, canSync, userId]);

  const updateCompany = useCallback((id: string, changes: Partial<CompanyProfile>) => {
    const updated = companies.map(c => c.id === id ? { ...c, ...changes } : c);
    setCompanies(updated);
    saveMutation.mutate(updated);
  }, [companies, saveMutation]);

  return useMemo(() => ({
    companies, addCompany, updateCompany, isLoading: companiesQuery.isLoading,
  }), [companies, addCompany, updateCompany, companiesQuery.isLoading]);
});

export function useFilteredCompanies(filters: {
  search?: string; state?: string; certification?: CertificationType; category?: BidCategory; minBondCapacity?: number;
}) {
  const { companies } = useCompanies();
  return useMemo(() => {
    let filtered = [...companies];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(c => c.companyName.toLowerCase().includes(q) || c.city.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    if (filters.state) filtered = filtered.filter(c => c.state === filters.state);
    if (filters.certification) filtered = filtered.filter(c => c.certifications.includes(filters.certification!));
    if (filters.category) filtered = filtered.filter(c => c.primaryCategory === filters.category);
    if (filters.minBondCapacity) filtered = filtered.filter(c => c.bondCapacity >= filters.minBondCapacity!);
    return filtered;
  }, [companies, filters.search, filters.state, filters.certification, filters.category, filters.minBondCapacity]);
}
