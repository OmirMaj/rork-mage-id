// hooks/useProjectCollaborators.ts
//
// Loads + mutates the collaborators for one project (Live Schedule Collaboration
// Phase 1). Reads are RLS-scoped (owner sees all rows; a collaborator sees only
// their own). All writes go through the service-role `project-invite` edge
// function, which enforces ownership / token / email before touching the table.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { ProjectCollaborator } from '@/types';

type Row = {
  id: string;
  project_id: string;
  invited_email: string;
  user_id: string | null;
  role: 'owner' | 'editor' | 'viewer' | 'field';
  status: 'pending' | 'accepted' | 'revoked';
  invited_at: string;
  accepted_at: string | null;
};

function mapRow(r: Row): ProjectCollaborator {
  return {
    id: r.id,
    email: r.invited_email,
    name: '',
    role: r.role,
    status: r.status,
    invitedAt: r.invited_at,
    projectId: r.project_id,
    userId: r.user_id,
    acceptedAt: r.accepted_at,
  };
}

/**
 * Throws if the edge function returned a transport error or a `{ error }` body.
 *
 * supabase.functions.invoke drops the body of a non-2xx reply, so the owner's
 * "Only the project owner can revoke" (403) or the seat-limit text (402) used
 * to arrive as "Edge Function returned a non-2xx status code". The server's own
 * sentence is read back out of the FunctionsHttpError when there is one (#95).
 */
async function unwrap<T>(res: { data: unknown; error: unknown }): Promise<T> {
  if (res.error) {
    const ctx = (res.error as { context?: { json?: () => Promise<unknown> } }).context;
    const body = ctx && typeof ctx.json === 'function'
      ? await ctx.json().catch(() => null) as { error?: unknown } | null
      : null;
    if (typeof body?.error === 'string' && body.error.trim()) throw new Error(body.error.trim());
    throw res.error instanceof Error ? res.error : new Error(String(res.error));
  }
  const data = res.data as { error?: string } | null;
  if (data?.error) throw new Error(data.error);
  return res.data as T;
}

/** project-invite `invite`'s reply. emailSent is false when the send failed or
 *  email is not configured — the screen must then say so (#177). Absent on a
 *  function deployed before #177: treated as "unknown", never as "sent". */
export type InviteResult = {
  link: string;
  collaborator: Row | null;
  emailSent?: boolean;
  emailReason?: 'not_configured' | 'rejected' | 'network' | null;
};

export function useProjectCollaborators(projectId: string | undefined) {
  const qc = useQueryClient();
  const queryKey = ['project_collaborators', projectId] as const;

  const query = useQuery({
    queryKey,
    enabled: !!projectId,
    queryFn: async (): Promise<ProjectCollaborator[]> => {
      const { data, error } = await supabase
        .from('project_collaborators')
        .select('*')
        .eq('project_id', projectId as string)
        .neq('status', 'revoked')
        .order('invited_at', { ascending: true });
      if (error) throw error;
      return ((data ?? []) as Row[]).map(mapRow);
    },
  });

  const invalidate = () => { void qc.invalidateQueries({ queryKey }); };

  const invite = useMutation({
    mutationFn: async (vars: { email: string; role: 'editor' | 'viewer' | 'field' }) =>
      unwrap<InviteResult>(
        await supabase.functions.invoke('project-invite', {
          body: { action: 'invite', projectId, email: vars.email, role: vars.role },
        }),
      ),
    onSuccess: invalidate,
  });

  const revoke = useMutation({
    mutationFn: async (collaboratorId: string) =>
      unwrap<{ success: true }>(
        await supabase.functions.invoke('project-invite', {
          body: { action: 'revoke', collaboratorId },
        }),
      ),
    onSuccess: invalidate,
  });

  // #177: the current link of a still-pending invite, without rotating its
  // token (re-sending would kill a link the GC may already have texted).
  const getLink = useMutation({
    mutationFn: async (collaboratorId: string) =>
      unwrap<{ link: string }>(
        await supabase.functions.invoke('project-invite', {
          body: { action: 'getLink', collaboratorId },
        }),
      ),
  });

  const changeRole = useMutation({
    mutationFn: async (vars: { collaboratorId: string; role: 'editor' | 'viewer' | 'field' }) =>
      unwrap<{ success: true }>(
        await supabase.functions.invoke('project-invite', {
          body: { action: 'changeRole', collaboratorId: vars.collaboratorId, role: vars.role },
        }),
      ),
    onSuccess: invalidate,
  });

  return {
    collaborators: query.data ?? [],
    isLoading: query.isLoading,
    /**
     * MUST be surfaced. `collaborators` collapses a FAILED query and a genuinely
     * empty list into the same `[]`, and utils/projectRole.roleForUser treats
     * "not in the list" as OWNER — correct for a real owner, catastrophic for a
     * network blip. Without this flag every field/viewer gate silently unlocked,
     * including the financial blinding, on any transient error.
     */
    isError: query.isError,
    /** Re-run the collaborator read (the "Retry" behind a failed role lookup, audit RT-R2). */
    refetch: () => { void query.refetch(); },
    invite,
    revoke,
    changeRole,
    getLink,
  };
}
