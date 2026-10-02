// utils/jobFacts/jobFactLinks.ts — the owner's reads and writes of his job
// facts link (lane FACTS, M5). Every call is a direct, awaited Supabase call
// under RLS (20261002161000_job_fact_links.sql: owner-only policies, column
// grants) that answers { ok, error } — the screen shows a link, a "Copied"
// chip or "Revoked" ONLY after one of these returns ok with the server's row.
//
// NOT QUEUED, ON PURPOSE. CLAUDE.md "Offline-first sync" routes Supabase
// writes through utils/offlineQueue.ts. These four are the exception, the
// shared-schedule-snapshot precedent: a queued publish is a link the GC has
// already pasted into a text that points at nothing until some later flush,
// and a queued revoke is a link he believes is dead that still works. So they
// run online only, the owner screen disables them offline and says why, and a
// failure is reported, never retried behind his back.
//
// The client never mints the code (public.job_fact_code(), server side) and
// never writes user_id, published_at or last_viewed_at (no column grant).

import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { isTransportError } from '@/utils/networkErrors';
import type { JobFactLink, JobFactSection, JobFactsPayload } from './types';

export type JobFactsResult<T> = { ok: true; value: T; error?: undefined } | { ok: false; error: string; value?: undefined };

/** The public page for a code. The page lives on the marketing site
 *  (marketing/facts/index.html), not in the app's shared-* routes. */
export function buildFactsUrl(code: string): string {
  return `https://mageid.app/facts/${encodeURIComponent(code)}`;
}

const COLUMNS = 'id, code, sections, payload, published_at, revoked_at, last_viewed_at';

interface LinkRow {
  id: string;
  code: string;
  sections: unknown;
  payload: unknown;
  published_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
}

function rowToLink(r: LinkRow): JobFactLink | null {
  if (!r || typeof r.id !== 'string' || typeof r.code !== 'string' || typeof r.published_at !== 'string') return null;
  return {
    id: r.id,
    code: r.code,
    sections: Array.isArray(r.sections) ? (r.sections as JobFactSection[]) : [],
    payload: r.payload as JobFactsPayload,
    publishedAt: r.published_at,
    revokedAt: r.revoked_at ?? null,
    lastViewedAt: r.last_viewed_at ?? null,
  };
}

function failure(e: unknown, what: string): { ok: false; error: string } {
  if (isTransportError(e)) return { ok: false, error: `Couldn't reach MAGE ID to ${what}. Check your connection and try again.` };
  const code = (e as { code?: string } | null)?.code;
  if (code === '23505') return { ok: false, error: 'This job already has a live link. Refresh it, or turn it off first.' };
  if (code === '42501') return { ok: false, error: `You can't ${what} for this job. Only the job's owner can.` };
  return { ok: false, error: `Couldn't ${what}. Try again in a minute.` };
}

const NOT_CONFIGURED = { ok: false as const, error: "Job facts links aren't available in this version of the app." };

/** The job's live link, or null when there is none. */
export async function fetchForProject(projectId: string): Promise<JobFactsResult<JobFactLink | null>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase
      .from('job_fact_links')
      .select(COLUMNS)
      .eq('project_id', projectId)
      .is('revoked_at', null)
      .maybeSingle();
    if (error) return failure(error, 'read this job’s link');
    return { ok: true, value: data ? rowToLink(data as LinkRow) : null };
  } catch (e) {
    return failure(e, 'read this job’s link');
  }
}

/** Mint a new link. Succeeds only when the insert returns the row WITH its server code. */
export async function publish(projectId: string, sections: JobFactSection[], payload: JobFactsPayload): Promise<JobFactsResult<JobFactLink>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase
      .from('job_fact_links')
      .insert({ project_id: projectId, sections, payload })
      .select(COLUMNS)
      .single();
    if (error) return failure(error, 'publish the link');
    const link = data ? rowToLink(data as LinkRow) : null;
    if (!link) return { ok: false, error: "The link was saved but didn't come back. Pull to refresh before you send it." };
    return { ok: true, value: link };
  } catch (e) {
    return failure(e, 'publish the link');
  }
}

/** Rewrite the same live row: the link stays the same, the server stamps a new
 *  published_at. Fails if the row was revoked meanwhile (0 rows back). */
export async function refresh(linkId: string, sections: JobFactSection[], payload: JobFactsPayload): Promise<JobFactsResult<JobFactLink>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase
      .from('job_fact_links')
      .update({ sections, payload })
      .eq('id', linkId)
      .is('revoked_at', null)
      .select(COLUMNS)
      .maybeSingle();
    if (error) return failure(error, 'refresh the facts');
    const link = data ? rowToLink(data as LinkRow) : null;
    if (!link) return { ok: false, error: 'This link was turned off. Publish a new one.' };
    return { ok: true, value: link };
  } catch (e) {
    return failure(e, 'refresh the facts');
  }
}

/** Turn the link off for everyone, at once. Final: it cannot be turned back on. */
export async function revoke(linkId: string): Promise<JobFactsResult<{ revokedAt: string }>> {
  if (!isSupabaseConfigured) return NOT_CONFIGURED;
  try {
    const { data, error } = await supabase
      .from('job_fact_links')
      // The trigger replaces this with the server's now(); it only has to be non-null.
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', linkId)
      .is('revoked_at', null)
      .select('revoked_at')
      .maybeSingle();
    if (error) return failure(error, 'turn off the link');
    const at = (data as { revoked_at?: string | null } | null)?.revoked_at;
    if (!at) return { ok: false, error: 'This link was already off, or it belongs to someone else.' };
    return { ok: true, value: { revokedAt: at } };
  } catch (e) {
    return failure(e, 'turn off the link');
  }
}
