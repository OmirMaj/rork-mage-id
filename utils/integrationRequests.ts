// integrationRequests — the tiny helper that turns the "Notify me" tap
// in app/integrations.tsx from a fake confirmation Alert into a real
// row in Supabase that the team can sort by demand.
//
// Pre-fix: tapping Notify me showed "Got it, we'll email you when X
// ships" and then did nothing. No record. No prioritization signal.
// Now: every tap upserts a row keyed by (user_id, integration_id).
// Re-tapping bumps last_requested_at + request_count so we know who
// keeps asking. Sort by request_count DESC server-side to drive the
// roadmap.

import { supabase, isSupabaseConfigured } from '@/lib/supabase';

export interface IntegrationRequestResult {
  ok: boolean;
  /** True when this user already had a row (we bumped count) — false
   *  when this was a brand-new request. The UI uses this to vary the
   *  "thanks" copy ("We'll prioritize" vs "We hear you, that's your
   *  3rd vote"). */
  isRepeat: boolean;
}

export async function recordIntegrationRequest(opts: {
  userId: string;
  integrationId: string;
  notes?: string;
}): Promise<IntegrationRequestResult> {
  const { userId, integrationId, notes } = opts;
  if (!userId || !integrationId || !isSupabaseConfigured) {
    return { ok: false, isRepeat: false };
  }
  try {
    // Check if a row already exists so we can bump count vs. insert.
    const { data: existing } = await supabase
      .from('integration_requests')
      .select('id, request_count')
      .eq('user_id', userId)
      .eq('integration_id', integrationId)
      .maybeSingle();

    if (existing?.id) {
      const { error } = await supabase
        .from('integration_requests')
        .update({
          request_count: (existing.request_count ?? 1) + 1,
          last_requested_at: new Date().toISOString(),
          notes: notes ?? null,
        })
        .eq('id', existing.id);
      if (error) {
        console.log('[integrationRequests] update failed', error.message);
        return { ok: false, isRepeat: true };
      }
      return { ok: true, isRepeat: true };
    }

    const { error } = await supabase
      .from('integration_requests')
      .insert({
        user_id: userId,
        integration_id: integrationId,
        notes: notes ?? null,
      });
    if (error) {
      console.log('[integrationRequests] insert failed', error.message);
      return { ok: false, isRepeat: false };
    }
    return { ok: true, isRepeat: false };
  } catch (err) {
    console.log('[integrationRequests] error', err);
    return { ok: false, isRepeat: false };
  }
}
