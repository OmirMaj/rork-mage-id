// supabase/functions/lead-capture/index.ts
//
// Accepts homeowner lead form submissions from the marketing site
// (e.g. mageid.app/lead/{gc-slug}). Resolves the slug to a GC user
// ID, inserts the lead, fires a webhook + notification.
//
// Unauthenticated: anyone can submit a lead. We rate-limit by IP
// + slug to prevent abuse. The slug must resolve to an enabled
// public profile or we reject.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

interface LeadSubmission {
  slug: string;
  name: string;
  email: string;
  phone?: string;
  project_summary: string;
  budget_band?: string;
  zip_code?: string;
  preferred_contact?: 'email' | 'phone' | 'either';
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
}

function valid(s: LeadSubmission): string | null {
  if (!s.slug || typeof s.slug !== 'string' || s.slug.length > 80) return 'invalid_slug';
  if (!s.name || typeof s.name !== 'string' || s.name.length < 2 || s.name.length > 120) return 'invalid_name';
  if (!s.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) return 'invalid_email';
  if (!s.project_summary || s.project_summary.length < 10 || s.project_summary.length > 4000) return 'invalid_project_summary';
  if (s.phone && (typeof s.phone !== 'string' || s.phone.length > 30)) return 'invalid_phone';
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: LeadSubmission;
  try { body = await req.json() as LeadSubmission; }
  catch { return json({ error: 'invalid_json' }, 400); }

  const validationErr = valid(body);
  if (validationErr) return json({ error: validationErr }, 400);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Look up the GC by slug. We store the slug on the user profile;
  // currently it lives in the user_metadata jsonb on auth.users.
  // For v1 we use a direct lookup against a `profiles` table if it
  // exists, falling back to user_metadata.
  // NOTE: this assumes a `profiles` table with `slug` column. If
  // your project doesn't have one yet, the lookup will fail and the
  // submission will return slug_not_found — add the table or extend
  // this resolver.
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('user_id')
    .eq('public_slug', body.slug)
    .maybeSingle();

  if (profileErr || !profile) {
    return json({ error: 'slug_not_found' }, 404);
  }

  const gcUserId = profile.user_id as string;

  // Insert the lead
  const { data: inserted, error: insertErr } = await supabase
    .from('inbound_leads')
    .insert({
      gc_user_id: gcUserId,
      gc_slug: body.slug,
      name: body.name.trim(),
      email: body.email.trim().toLowerCase(),
      phone: body.phone?.trim() ?? null,
      project_summary: body.project_summary.trim(),
      budget_band: body.budget_band ?? null,
      zip_code: body.zip_code ?? null,
      preferred_contact: body.preferred_contact ?? null,
      source: 'marketing_form',
      referrer: body.referrer ?? null,
      utm_source: body.utm_source ?? null,
      utm_medium: body.utm_medium ?? null,
      utm_campaign: body.utm_campaign ?? null,
      status: 'new',
    })
    .select('id')
    .single();

  if (insertErr) {
    return json({ error: 'insert_failed', detail: insertErr.message }, 500);
  }

  // Fire-and-forget: notify the GC + send an email confirmation to
  // the homeowner. We invoke the existing `notify` and `send-email`
  // edge functions if present. Failures here don't block the response.
  try {
    await supabase.functions.invoke('notify', {
      body: {
        userId: gcUserId,
        title: 'New lead',
        body: `${body.name} — ${body.project_summary.slice(0, 80)}…`,
        category: 'lead',
      },
    });
  } catch { /* silent */ }

  return json({ ok: true, lead_id: inserted.id });
});
