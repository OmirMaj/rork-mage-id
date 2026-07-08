import { useState, useEffect, useCallback, useMemo } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import createContextHook from '@nkzw/create-context-hook';
import type { CrewMember } from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { supabaseWrite } from '@/utils/offlineQueue';
import { deleteStorageFile } from '@/utils/storage';
import { generateUUID } from '@/utils/generateId';
import { generateClaimToken } from '@/utils/crew';
import { HIRE_ENABLED } from '@/contexts/HireContext';
import { shouldSurfaceToMarketplace, crewMemberToWorkerProfile } from '@/utils/crew';

const CREW_KEY = 'tertiary_crew_members';

/** Tenant-safe local key: namespace the roster by the owning user so a second
 *  account on the same device can never read the previous user's cached crew
 *  (this feature caches government-ID-derived fields). */
function crewKeyFor(userId: string | null): string {
  return userId ? `${CREW_KEY}_${userId}` : CREW_KEY;
}

async function loadLocal<T>(key: string, fallback: T): Promise<T> {
  try {
    const stored = await AsyncStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : fallback;
  } catch {
    return fallback;
  }
}
async function saveLocal(key: string, data: unknown): Promise<void> {
  try { await AsyncStorage.setItem(key, JSON.stringify(data)); }
  catch (err) { console.log('[CrewContext] Local save failed for', key, err); }
}

/** Row → CrewMember (snake_case → camelCase). */
function mapRow(r: Record<string, unknown>): CrewMember {
  return {
    id: r.id as string,
    companyUserId: r.user_id as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
    fullName: (r.full_name as string) ?? '',
    trades: (r.trades as string[]) ?? [],
    phone: (r.phone as string | null) ?? undefined,
    email: (r.email as string | null) ?? undefined,
    photoUrl: (r.photo_url as string | null) ?? undefined,
    status: (r.status as CrewMember['status']) ?? 'active',
    idVerified: !!r.id_verified,
    idType: (r.id_type as CrewMember['idType']) ?? undefined,
    idMaskedLast4: (r.id_masked_last4 as string | null) ?? undefined,
    idExpiry: (r.id_expiry as string | null) ?? undefined,
    idIssuer: (r.id_issuer as string | null) ?? undefined,
    idScannedAt: (r.id_scanned_at as string | null) ?? undefined,
    idImagePath: (r.id_image_path as string | null) ?? undefined,
    claimToken: (r.claim_token as string | null) ?? undefined,
    claimedByUserId: (r.claimed_by_user_id as string | null) ?? undefined,
    claimedAt: (r.claimed_at as string | null) ?? undefined,
    isPublic: !!r.is_public,
    marketplaceProfileId: (r.marketplace_profile_id as string | null) ?? undefined,
    projectIds: (r.project_ids as string[]) ?? [],
  };
}

/** CrewMember → row (camelCase → snake_case) for supabaseWrite. */
function toRow(m: CrewMember): Record<string, unknown> {
  return {
    id: m.id, user_id: m.companyUserId, full_name: m.fullName, trades: m.trades,
    phone: m.phone ?? null, email: m.email ?? null, photo_url: m.photoUrl ?? null,
    status: m.status, id_verified: m.idVerified, id_type: m.idType ?? null,
    id_masked_last4: m.idMaskedLast4 ?? null, id_expiry: m.idExpiry ?? null,
    id_issuer: m.idIssuer ?? null, id_scanned_at: m.idScannedAt ?? null,
    id_image_path: m.idImagePath ?? null, claim_token: m.claimToken ?? null,
    claimed_by_user_id: m.claimedByUserId ?? null, claimed_at: m.claimedAt ?? null,
    is_public: m.isPublic, marketplace_profile_id: m.marketplaceProfileId ?? null,
    project_ids: m.projectIds, created_at: m.createdAt, updated_at: m.updatedAt,
  };
}

export const [CrewProvider, useCrew] = createContextHook(() => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const canSync = !!userId && isSupabaseConfigured;
  const storageKey = useMemo(() => crewKeyFor(userId), [userId]);

  const [crewMembers, setCrewMembers] = useState<CrewMember[]>([]);

  // Tenant-safety: drop any in-memory roster the instant the auth user changes
  // so a new account never briefly sees the previous user's crew before the
  // query re-hydrates for the new (namespaced) key.
  useEffect(() => { setCrewMembers([]); }, [userId]);

  const crewQuery = useQuery({
    queryKey: ['crew_members', userId],
    queryFn: async () => {
      if (canSync) {
        try {
          // Owner rows OR rows the current user has claimed (RLS enforces).
          const { data, error } = await supabase.from('crew_members').select('*').order('created_at', { ascending: false });
          if (!error && data && data.length > 0) {
            const mapped = data.map((r: Record<string, unknown>) => mapRow(r));
            await saveLocal(storageKey, mapped);
            return mapped;
          }
        } catch (err) { console.log('[CrewContext] fetch failed, using local:', err); }
      }
      return loadLocal<CrewMember[]>(storageKey, []);
    },
    enabled: !!userId,
  });

  useEffect(() => { if (crewQuery.data) setCrewMembers(crewQuery.data); }, [crewQuery.data]);

  const addCrewMember = useCallback((m: CrewMember) => {
    // The roster screen has no userId — it passes companyUserId: '' as a
    // placeholder. Stamp the owning user here so toRow/user_id (and RLS
    // ownership) are always correct and tenant-safe.
    const stamped: CrewMember = { ...m, companyUserId: userId ?? m.companyUserId };
    const updated = [stamped, ...crewMembers];
    setCrewMembers(updated);
    void saveLocal(storageKey, updated);
    if (canSync) void supabaseWrite('crew_members', 'insert', toRow(stamped));
  }, [crewMembers, canSync, storageKey, userId]);

  const updateCrewMember = useCallback((id: string, changes: Partial<CrewMember>) => {
    let next: CrewMember | undefined;
    const updated = crewMembers.map(m => {
      if (m.id !== id) return m;
      next = { ...m, ...changes, updatedAt: new Date().toISOString() };
      return next;
    });
    setCrewMembers(updated);
    void saveLocal(storageKey, updated);
    if (canSync && next) void supabaseWrite('crew_members', 'update', toRow(next));
  }, [crewMembers, canSync, storageKey]);

  const deleteCrewMember = useCallback((id: string) => {
    const target = crewMembers.find(m => m.id === id);
    const updated = crewMembers.filter(m => m.id !== id);
    setCrewMembers(updated);
    void saveLocal(storageKey, updated);
    // Retention/deletion: purge any retained raw ID image from private storage.
    if (target?.idImagePath) void deleteStorageFile('worker-ids', target.idImagePath);
    if (canSync) void supabaseWrite('crew_members', 'delete', { id });
  }, [crewMembers, canSync, storageKey]);

  const getCrewMember = useCallback((id: string) => crewMembers.find(m => m.id === id) ?? null, [crewMembers]);

  const getCrewForProject = useCallback(
    (projectId: string) => crewMembers.filter(m => m.projectIds.includes(projectId)),
    [crewMembers],
  );

  /** Mint a single-use claim token onto a member (idempotent — keeps an
   *  existing unclaimed token). Returns the token. Sending the magic-link
   *  invite is done by the screen via utils/crewScan → auth-magic-link. */
  const startClaimInvite = useCallback((id: string): string | null => {
    const member = crewMembers.find(m => m.id === id);
    if (!member) return null;
    if (member.claimedByUserId) return member.claimToken ?? null; // already claimed
    const token = member.claimToken ?? generateClaimToken(generateUUID());
    if (!member.claimToken) updateCrewMember(id, { claimToken: token });
    return token;
  }, [crewMembers, updateCrewMember]);

  // Claim redemption is NOT done here. The claiming worker is a different auth
  // user than the owning GC, and crew_members RLS makes the unclaimed row
  // invisible + un-writable to them (crewMembers.find(...) is always undefined
  // under the worker's JWT, and the UPDATE is RLS-blocked). Redemption runs
  // server-side with the service role via the claim-crew edge function —
  // see utils/crewScan.redeemCrewClaim, called by app/claim-crew.tsx.

  // Marketplace surfacing — WRITTEN BUT GATED. Returns the mapped WorkerProfile
  // only when the member is public + claimed AND HIRE_ENABLED is on. Today
  // HIRE_ENABLED is false, so this always returns null. When the flag flips,
  // callers (a future Hire wiring) get a ready marketplace listing with the
  // ID-verified trust badge — no rebuild needed.
  const surfaceToMarketplace = useCallback((id: string) => {
    const member = crewMembers.find(m => m.id === id);
    if (!member) return null;
    if (!shouldSurfaceToMarketplace(member, HIRE_ENABLED)) return null;
    return crewMemberToWorkerProfile(member);
  }, [crewMembers]);

  return useMemo(() => ({
    crewMembers,
    isLoading: crewQuery.isLoading,
    addCrewMember,
    updateCrewMember,
    deleteCrewMember,
    getCrewMember,
    getCrewForProject,
    startClaimInvite,
    surfaceToMarketplace,
  }), [crewMembers, crewQuery.isLoading, addCrewMember, updateCrewMember, deleteCrewMember, getCrewMember, getCrewForProject, startClaimInvite, surfaceToMarketplace]);
});
