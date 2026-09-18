// utils/proposalAcceptances.ts — has the homeowner already accepted this
// project's proposal? Read fresh, at the moment a stamp would be replaced.
//
// WHY A FRESH READ. The portal-setup screen's acceptance list is a cached query
// that used to turn every error into []. "Use my current terms" on a proposal
// replaces the payment schedule the homeowner was shown; doing that on a stale
// or failed read is exactly how signed text would change under a signature. So
// the handler awaits this read itself, and utils/paymentTerms.
// acceptanceStateFromRead turns a failure into 'unknown', which blocks.
//
// A MISSING TABLE IS 'none'. proposal_approvals lives in a held migration
// (supabase/migrations/held/20260913120000_portal_proposal_acceptance.sql);
// until it is applied no acceptance can exist, and PostgREST answers PGRST205.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { acceptanceStateFromRead, type AcceptanceState } from '@/utils/paymentTerms';

export async function fetchProposalAcceptanceState(projectId: string): Promise<AcceptanceState> {
  // Without a backend nothing can be checked — and "can't check" must block a
  // replacement, never read as "nobody accepted".
  if (!isSupabaseConfigured || !projectId) return 'unknown';
  try {
    const { data, error } = await supabase
      .from('proposal_approvals')
      .select('decision')
      .eq('project_id', projectId)
      .eq('decision', 'accepted')
      .limit(1);
    return acceptanceStateFromRead({ data, error });
  } catch {
    return 'unknown';
  }
}
