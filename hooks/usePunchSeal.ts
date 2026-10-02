/**
 * usePunchSeal — the sealed final punch, read from the server (lane SEAL).
 *
 * SELECT only. punch_seals has no client write path at all (the seal-punch
 * edge function is its only writer), so this hook never writes, never caches
 * a seal on the device and never guesses one: a seal is shown only when the
 * server returned the row.
 *
 *   usePunchSeal(projectId)      the seal for one project, plus the server's
 *                                own punch rows for it (the readiness the
 *                                screen shows comes from these, not from the
 *                                phone's copy).
 *   usePunchSealsByProject()     every seal of the signed-in user by project id
 *                                (the retention screen's punch fact).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { PunchSeal } from '@/types';
import type { PunchSealReadinessItem, PunchSealRow } from '@/supabase/functions/_shared/punchSealManifest';

export const PUNCH_SEAL_COLUMNS =
  'id,user_id,project_id,sealed_at,item_count,manifest,manifest_hash,signer_name,signer_role,method,signature_paths,consent_version,pdf_path,pdf_hash';

/** A punch_seals row as the app reads it. Null for anything that is not a whole row. */
export function punchSealFromRow(r: unknown): PunchSeal | null {
  const row = r as Partial<PunchSealRow> | null;
  if (!row || typeof row.id !== 'string' || typeof row.project_id !== 'string' || typeof row.sealed_at !== 'string'
    || typeof row.manifest_hash !== 'string' || !row.manifest || typeof row.signer_name !== 'string') return null;
  return {
    id: row.id,
    projectId: row.project_id,
    sealedAt: row.sealed_at,
    itemCount: Number(row.item_count) || 0,
    manifest: row.manifest,
    manifestHash: row.manifest_hash,
    signerName: row.signer_name,
    signerRole: typeof row.signer_role === 'string' ? row.signer_role : '',
    method: 'in_person',
    signaturePaths: Array.isArray(row.signature_paths) ? row.signature_paths.filter((p): p is string => typeof p === 'string') : [],
    consentVersion: typeof row.consent_version === 'string' ? row.consent_version : '',
    pdfPath: typeof row.pdf_path === 'string' && row.pdf_path ? row.pdf_path : undefined,
    pdfHash: typeof row.pdf_hash === 'string' && row.pdf_hash ? row.pdf_hash : undefined,
  };
}

/** The server's punch row, as readiness and the blocker list read it. */
export interface ServerPunchRow extends PunchSealReadinessItem {
  description: string;
  location: string;
  sealId?: string;
}

export const punchSealKey = (userId: string | undefined, projectId: string | undefined) => ['punch-seal', userId ?? '', projectId ?? ''] as const;

export function usePunchSeal(projectId: string | undefined): {
  status: 'loading' | 'ready' | 'failed';
  seal: PunchSeal | null;
  serverItems: ServerPunchRow[];
  refetch: () => Promise<void>;
} {
  const { user } = useAuth();
  const userId = user?.id;
  const enabled = !!userId && !!projectId;
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: punchSealKey(userId, projectId),
    enabled,
    staleTime: 0,
    queryFn: async () => {
      const sealRes = await supabase.from('punch_seals').select(PUNCH_SEAL_COLUMNS).eq('project_id', projectId as string).maybeSingle();
      if (sealRes.error) throw new Error(sealRes.error.message);
      const itemsRes = await supabase
        .from('punch_items')
        .select('id,description,location,status,list_type,after_photo_uri,seal_id')
        .eq('project_id', projectId as string);
      if (itemsRes.error) throw new Error(itemsRes.error.message);
      const serverItems: ServerPunchRow[] = ((itemsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: String(r.id),
        description: typeof r.description === 'string' ? r.description : '',
        location: typeof r.location === 'string' ? r.location : '',
        status: typeof r.status === 'string' ? r.status : null,
        listType: typeof r.list_type === 'string' ? r.list_type : null,
        afterPhotoUri: typeof r.after_photo_uri === 'string' ? r.after_photo_uri : null,
        sealId: typeof r.seal_id === 'string' ? r.seal_id : undefined,
      }));
      return { seal: punchSealFromRow(sealRes.data), serverItems };
    },
  });
  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: punchSealKey(userId, projectId) });
  }, [queryClient, userId, projectId]);
  const status: 'loading' | 'ready' | 'failed' = !enabled ? 'ready' : q.isError ? 'failed' : q.data ? 'ready' : 'loading';
  return { status, seal: q.data?.seal ?? null, serverItems: q.data?.serverItems ?? [], refetch };
}

/** Every seal of the signed-in user, by project id. An empty map while loading or on a failed read. */
export function usePunchSealsByProject(): ReadonlyMap<string, PunchSeal> {
  const { user } = useAuth();
  const userId = user?.id;
  const q = useQuery({
    queryKey: ['punch-seals-all', userId ?? ''],
    enabled: !!userId,
    queryFn: async () => {
      const res = await supabase.from('punch_seals').select(PUNCH_SEAL_COLUMNS);
      if (res.error) throw new Error(res.error.message);
      const map = new Map<string, PunchSeal>();
      for (const r of (Array.isArray(res.data) ? res.data : [])) {
        const s = punchSealFromRow(r);
        if (s) map.set(s.projectId, s);
      }
      return map;
    },
  });
  return q.data ?? EMPTY;
}

const EMPTY: ReadonlyMap<string, PunchSeal> = new Map();
