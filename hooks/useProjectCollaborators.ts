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

/** Throws if the edge function returned a transport error or a `{ error }` body. */
function unwrap<T>(res: { data: unknown; error: unknown }): T {
  if (res.error) throw res.error instanceof Error ? res.error : new Error(String(res.error));
  const data = res.data as { error?: string } | null;
  if (data?.error) throw new Error(data.error);
  return res.data as T;
}

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
      unwrap<{ link: string; collaborator: Row | null }>(
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
    invite,
    revoke,
    changeRole,
  };
}
