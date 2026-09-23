// hooks/useClaimedCrewProfile.ts — audit wave 5, #74.
//
// A worker who claimed his crew profile (app/claim-crew.tsx) is signed in, but
// he is not running a crew: the Crew screen is HIS profile, not a Business
// roster. The persona gate (app/_layout.tsx) lets him reach /crew before he
// has picked a persona, and the Tools / sidebar Crew rows read "My Profile"
// for him with no Business chip — the tap already works; only the label lied.
//
// CrewContext's roster already includes the rows he claimed
// (`user_id = me OR claimed_by_user_id = me`), so this is a read of that.
// Tolerates a missing provider (a screen mounted in isolation) by answering
// false — never a crash, never a false "yours".

import { useAuth } from '@/contexts/AuthContext';
import { useCrew } from '@/contexts/CrewContext';
import type { CrewMember } from '@/types';

/** True when `userId` has claimed at least one crew row in `members`. Pure. */
export function hasClaimedCrewRow(members: readonly Pick<CrewMember, 'claimedByUserId'>[] | null | undefined, userId: string | null | undefined): boolean {
  if (!userId) return false;
  return (members ?? []).some(m => m.claimedByUserId === userId);
}

/** True when the signed-in user has claimed a crew profile. */
export function useClaimedCrewProfile(): boolean {
  const { user } = useAuth();
  const crew = useCrew() as ReturnType<typeof useCrew> | undefined;
  return hasClaimedCrewRow(crew?.crewMembers, user?.id);
}
