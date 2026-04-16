import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { ContractorProfile, TradeCategory } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { generateUUID } from '@/utils/generateId';

const PROFILE_KEY = 'mageid_contractor_profile';
const PROFILES_CACHE_KEY = 'mageid_profiles_directory';

export const [ProfileProvider, useProfile] = createContextHook(() => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const isGuest = user?.isGuest ?? true;
  const canSync = !isGuest && !!userId && isSupabaseConfigured;

  const [myProfile, setMyProfile] = useState<ContractorProfile | null>(null);
  const [directoryProfiles, setDirectoryProfiles] = useState<ContractorProfile[]>([]);

  const profileQuery = useQuery({
    queryKey: ['my_profile', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          const { data, error } = await supabase
            .from('worker_profiles')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
          if (!error && data) {
            const mapped = mapDbToProfile(data);
            await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[ProfileContext] Supabase profile fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(PROFILE_KEY);
      if (stored) {
        try {
          return JSON.parse(stored) as ContractorProfile;
        } catch { return null; }
      }
      return null;
    },
    enabled: !!userId,
  });

  const directoryQuery = useQuery({
    queryKey: ['profiles_directory'],
    queryFn: async () => {
      if (isSupabaseConfigured) {
        try {
          const { data, error } = await supabase
            .from('worker_profiles')
            .select('*')
            .not('availability', 'is', null)
            .order('created_at', { ascending: false })
            .limit(100);
          if (!error && data && data.length > 0) {
            const mapped = (data || []).map(mapDbToProfile);
            await AsyncStorage.setItem(PROFILES_CACHE_KEY, JSON.stringify(mapped));
            return mapped;
          }
        } catch (err) {
          console.log('[ProfileContext] Directory fetch failed:', err);
        }
      }
      const stored = await AsyncStorage.getItem(PROFILES_CACHE_KEY);
      if (stored) {
        try { return JSON.parse(stored) as ContractorProfile[]; } catch { return []; }
      }
      return [];
    },
  });

  useEffect(() => {
    if (profileQuery.data !== undefined) setMyProfile(profileQuery.data);
  }, [profileQuery.data]);

  useEffect(() => {
    if (directoryQuery.data) setDirectoryProfiles(directoryQuery.data);
  }, [directoryQuery.data]);

  const saveProfileMutation = useMutation({
    mutationFn: async (profile: ContractorProfile) => {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      if (canSync) {
        const dbData = mapProfileToDb(profile, userId!);
        const { error } = await supabase
          .from('worker_profiles')
          .upsert(dbData, { onConflict: 'id' });
        if (error) {
          console.log('[ProfileContext] Supabase upsert error:', error.message);
        } else {
          console.log('[ProfileContext] Profile synced to Supabase');
        }
      }
      return profile;
    },
    onSuccess: (data) => {
      setMyProfile(data);
      queryClient.setQueryData(['my_profile', userId], data);
      void queryClient.invalidateQueries({ queryKey: ['profiles_directory'] });
    },
  });

  const saveProfile = useCallback((profile: ContractorProfile) => {
    saveProfileMutation.mutate(profile);
  }, [saveProfileMutation]);

  const createProfile = useCallback((partial: Partial<ContractorProfile>): ContractorProfile => {
    const now = new Date().toISOString();
    return {
      id: generateUUID(),
      userId: userId ?? 'local',
      name: partial.name ?? '',
      headline: partial.headline ?? '',
      companyName: partial.companyName ?? '',
      city: partial.city ?? '',
      state: partial.state ?? '',
      availability: partial.availability ?? 'available',
      profilePhotoUri: partial.profilePhotoUri,
      bio: partial.bio ?? '',
      skills: partial.skills ?? [],
      tradeCategory: partial.tradeCategory ?? 'general_laborer',
      yearsExperience: partial.yearsExperience ?? 0,
      hourlyRate: partial.hourlyRate ?? 0,
      licenses: partial.licenses ?? [],
      experience: partial.experience ?? [],
      portfolio: partial.portfolio ?? [],
      yearFounded: partial.yearFounded,
      employeeRange: partial.employeeRange,
      revenueRange: partial.revenueRange,
      bondCapacity: partial.bondCapacity,
      insuranceCoverage: partial.insuranceCoverage,
      serviceArea: partial.serviceArea,
      website: partial.website,
      businessCertifications: partial.businessCertifications ?? [],
      contactEmail: partial.contactEmail ?? '',
      phone: partial.phone ?? '',
      contactVisibility: partial.contactVisibility ?? 'public',
      rating: 0,
      reviewCount: 0,
      createdAt: now,
      updatedAt: now,
    };
  }, [userId]);

  return useMemo(() => ({
    myProfile,
    directoryProfiles,
    saveProfile,
    createProfile,
    isLoading: profileQuery.isLoading,
    isSaving: saveProfileMutation.isPending,
    isDirectoryLoading: directoryQuery.isLoading,
    refetchDirectory: directoryQuery.refetch,
  }), [myProfile, directoryProfiles, saveProfile, createProfile, profileQuery.isLoading, saveProfileMutation.isPending, directoryQuery.isLoading, directoryQuery.refetch]);
});

function mapDbToProfile(r: Record<string, unknown>): ContractorProfile {
  const profileData = (r.profile_data as Record<string, unknown>) ?? {};
  const companyDetails = (r.company_details as Record<string, unknown>) ?? {};
  return {
    id: r.id as string,
    userId: (r.user_id as string) ?? '',
    name: (r.name as string) ?? '',
    headline: (r.headline as string) ?? '',
    companyName: (companyDetails.companyName as string) ?? '',
    city: (r.city as string) ?? '',
    state: (r.state as string) ?? '',
    availability: ((r.availability_status as string) ?? (r.availability as string) ?? 'available') as ContractorProfile['availability'],
    profilePhotoUri: (r.profile_photo_uri as string) ?? undefined,
    bio: (r.bio as string) ?? '',
    skills: (r.skills as string[]) ?? (profileData.skills as string[]) ?? [],
    tradeCategory: (r.trade_category as ContractorProfile['tradeCategory']) ?? 'general_laborer',
    yearsExperience: Number(r.years_experience) || 0,
    hourlyRate: Number(r.hourly_rate) || 0,
    licenses: (r.certifications_list as ContractorProfile['licenses']) ?? (profileData.licenses as ContractorProfile['licenses']) ?? [],
    experience: (r.experience as ContractorProfile['experience']) ?? (profileData.experience as ContractorProfile['experience']) ?? [],
    portfolio: (r.portfolio as ContractorProfile['portfolio']) ?? (profileData.portfolio as ContractorProfile['portfolio']) ?? [],
    yearFounded: (companyDetails.yearFounded as number) ?? undefined,
    employeeRange: (companyDetails.employeeRange as string) ?? undefined,
    revenueRange: (companyDetails.revenueRange as string) ?? undefined,
    bondCapacity: (companyDetails.bondCapacity as number) ?? undefined,
    insuranceCoverage: (companyDetails.insuranceCoverage as string) ?? undefined,
    serviceArea: (companyDetails.serviceArea as string) ?? undefined,
    website: (companyDetails.website as string) ?? undefined,
    businessCertifications: (companyDetails.businessCertifications as string[]) ?? [],
    contactEmail: (r.contact_email as string) ?? '',
    phone: (r.phone as string) ?? '',
    contactVisibility: ((r.contact_visibility as string) ?? 'public') as ContractorProfile['contactVisibility'],
    rating: Number(r.rating) || 0,
    reviewCount: Number(r.review_count) || 0,
    createdAt: (r.created_at as string) ?? new Date().toISOString(),
    updatedAt: (r.updated_at as string) ?? new Date().toISOString(),
  };
}

function mapProfileToDb(p: ContractorProfile, dbUserId: string): Record<string, unknown> {
  return {
    id: p.id,
    user_id: dbUserId,
    name: p.name,
    headline: p.headline,
    trade_category: p.tradeCategory,
    years_experience: p.yearsExperience,
    licenses: (p.licenses || []).map(l => l.name),
    city: p.city,
    state: p.state,
    availability: p.availability,
    availability_status: p.availability,
    hourly_rate: p.hourlyRate,
    bio: p.bio,
    past_projects: (p.portfolio || []).map(po => po.projectName),
    contact_email: p.contactEmail,
    phone: p.phone,
    profile_photo_uri: p.profilePhotoUri ?? null,
    contact_visibility: p.contactVisibility,
    rating: p.rating,
    review_count: p.reviewCount,
    skills: p.skills,
    certifications_list: p.licenses,
    experience: p.experience,
    portfolio: p.portfolio,
    company_details: {
      companyName: p.companyName,
      yearFounded: p.yearFounded,
      employeeRange: p.employeeRange,
      revenueRange: p.revenueRange,
      bondCapacity: p.bondCapacity,
      insuranceCoverage: p.insuranceCoverage,
      serviceArea: p.serviceArea,
      website: p.website,
      businessCertifications: p.businessCertifications,
    },
    profile_data: {
      skills: p.skills,
      licenses: p.licenses,
      experience: p.experience,
      portfolio: p.portfolio,
    },
    updated_at: new Date().toISOString(),
  };
}

export function useFilteredDirectory(filters: {
  search?: string;
  trade?: string;
  state?: string;
  availability?: string;
}) {
  const { directoryProfiles } = useProfile();
  return useMemo(() => {
    let filtered = [...directoryProfiles];
    if (filters.search) {
      const q = filters.search.toLowerCase();
      filtered = filtered.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.companyName.toLowerCase().includes(q) ||
        p.headline.toLowerCase().includes(q) ||
        (p.skills || []).some(s => s.toLowerCase().includes(q))
      );
    }
    if (filters.trade) {
      filtered = filtered.filter(p => p.tradeCategory === filters.trade);
    }
    if (filters.state) {
      filtered = filtered.filter(p => p.state === filters.state);
    }
    if (filters.availability) {
      filtered = filtered.filter(p => p.availability === filters.availability);
    }
    return filtered;
  }, [directoryProfiles, filters.search, filters.trade, filters.state, filters.availability]);
}
