// hooks/useProjectSubcontractors.ts
//
// WHICH SUBS CAN A PUNCH ITEM ON THIS JOB BE ASSIGNED TO?
//
// The owner's answer is his own directory (useProjects().subcontractors). A
// collaborator's answer used to be the same expression — which, because
// subcontractors RLS is owner-only, was HIS OWN directory: usually empty (so
// the walk saved a trade word), sometimes his own subs (so the walk
// confidently assigned the GC's item to a company the GC never hired, with an
// id no GC portal will ever match). Both are a guess shown as fact.
//
// For a project the user does not own this reads the OWNER's subs assigned to
// that project through the project_subcontractors RPC (migration
// 20260919200000: SECURITY DEFINER, gated by can_access_project(.., 'field'),
// id / company_name / trade / assigned_projects only — never contact, licence
// or COI). It NEVER falls back to the collaborator's own directory: an empty
// or failed read means "no sub on file for this job — the GC assigns", and the
// screens say exactly that.

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useProjects } from '@/contexts/ProjectContext';
import { useProjectRoleState } from '@/hooks/useProjectRole';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { Subcontractor } from '@/types';

/** What a sub picker needs, and all a collaborator is allowed to see. */
export type PickerSub = Pick<Subcontractor, 'id' | 'companyName' | 'trade' | 'assignedProjects'>;

export interface ProjectSubcontractorsState {
  /** The subs this user may assign on this project. */
  subs: PickerSub[];
  /** true = his own directory; false = the owner's subs on this job. */
  isOwner: boolean;
  /** Still deciding (role or the owner's list is loading). */
  isLoading: boolean;
  /** The owner's list could not be read — say so and offer retry. */
  isError: boolean;
  refetch: () => void;
}

/**
 * Whether this user owns the project. The project row's ownerUserId is the
 * server's answer; a cache predating that field falls back to the role
 * derivation (roleForUser reports 'owner' when he is not a collaborator).
 * Pure so it can be checked without React.
 */
export function ownsProjectForPicker(
  project: { ownerUserId?: string } | null | undefined,
  userId: string | null | undefined,
  role: string | null,
): boolean | null {
  if (!project || !userId) return null;
  if (project.ownerUserId) return project.ownerUserId === userId;
  return role === null ? null : role === 'owner';
}

/** Map an RPC row. Tolerant of a missing assigned_projects (never trust shape). */
export function pickerSubFromRow(r: Record<string, unknown>): PickerSub | null {
  const id = typeof r.id === 'string' ? r.id : null;
  const companyName = typeof r.company_name === 'string' ? r.company_name : '';
  if (!id || !companyName.trim()) return null;
  return {
    id,
    companyName,
    trade: (typeof r.trade === 'string' ? r.trade : 'General') as Subcontractor['trade'],
    assignedProjects: Array.isArray(r.assigned_projects)
      ? (r.assigned_projects as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
  };
}

export function useProjectSubcontractors(projectId: string | undefined): ProjectSubcontractorsState {
  const { user } = useAuth();
  const { getProject, subcontractors } = useProjects();
  const project = projectId ? getProject(projectId) : undefined;
  const roleState = useProjectRoleState(projectId);
  const owns = ownsProjectForPicker(project ?? null, user?.id, roleState.role);
  const needOwnerList = owns === false && !!projectId && isSupabaseConfigured;

  const q = useQuery({
    queryKey: ['project_subcontractors', projectId, user?.id],
    enabled: needOwnerList,
    staleTime: 60_000,
    queryFn: async (): Promise<PickerSub[]> => {
      const { data, error } = await supabase.rpc('project_subcontractors', { p_project_id: projectId });
      if (error) throw new Error(error.message);
      return ((data ?? []) as Record<string, unknown>[])
        .map(pickerSubFromRow)
        .filter((s): s is PickerSub => !!s);
    },
  });

  if (owns === true) {
    return { subs: subcontractors, isOwner: true, isLoading: false, isError: false, refetch: () => {} };
  }
  if (owns === null) {
    // Role unresolved (or its read failed). Never hand out his own directory
    // on a maybe: an empty list is the honest "not known yet".
    return {
      subs: [], isOwner: false,
      isLoading: roleState.isLoading, isError: roleState.isError,
      refetch: roleState.refetch,
    };
  }
  return {
    subs: q.data ?? [],
    isOwner: false,
    isLoading: needOwnerList && q.isLoading,
    isError: !isSupabaseConfigured || q.isError,
    refetch: () => { void q.refetch(); },
  };
}
