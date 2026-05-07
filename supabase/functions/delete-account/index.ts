// delete-account — permanently delete the authenticated user and all
// of their data. Required by Apple App Store Review Guideline 5.1.1(v):
// any app that creates an account MUST allow the user to delete it
// from inside the app. Failing this gets the binary rejected.
//
// What this function deletes:
//   1. Every row in every project-scoped table where user_id = caller.
//      (RLS would block other users from doing this; service role
//      below bypasses RLS but only for the authenticated caller's id.)
//   2. The Supabase auth.users row (which cascades to subscriptions,
//      profiles, and any other auth-FK'd table).
//   3. The user's storage objects in pdf-uploads, plan-sheets,
//      project-documents (best-effort — orphans cost cents per month
//      but don't affect correctness).
//
// What we do NOT delete:
//   - RevenueCat subscriptions. The user must cancel through Apple/
//     Play before deleting the account; we surface a hard warning in
//     the UI. (Stripe Connect platform commissions also require
//     keeping payment records — those are 7-year IRS retention.)
//   - Anonymized aggregate analytics. None collected; we use Sentry
//     for crash reports only, no event logging tool.
//
// Security: the function calls requireTier with ['free',...] so any
// signed-in user can delete THEIR OWN account (not anyone else's).
// We pull userId from the JWT, never from the request body.

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireTier } from '../_shared/auth.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Tables we own. Order doesn't matter much because we delete by user_id
// not by FK chain — service role bypasses RLS so we can hit any table.
// New tables added in the future need to be added here too; missing one
// just means orphan rows (no functional break).
const USER_SCOPED_TABLES = [
  'projects', 'change_orders', 'invoices', 'daily_reports',
  'subcontractors', 'punch_items', 'photos', 'price_alerts',
  'contacts', 'comm_events', 'rfis', 'submittals', 'oac_meetings',
  'cois', 'equipment', 'warranties', 'portal_messages',
  'commitments', 'prequal_packets', 'drawing_pins',
  'plan_calibrations', 'plan_sheets', 'plan_markups', 'permits',
  'aia_pay_apps', 'sub_portal_links', 'leads', 'bid_packages',
  'bid_package_bids', 'time_entries', 'subscriptions',
  'ai_usage_counters',
];

// Storage buckets we own. We list + remove the user's prefix from each.
const STORAGE_PREFIXES: Array<{ bucket: string; prefix: (userId: string) => string }> = [
  { bucket: 'pdf-uploads', prefix: (uid) => `${uid}/` },
  // plan-sheets and project-documents are project-scoped, not user-
  // scoped, so we delete by walking the user's projects (above) and
  // removing those project prefixes after the row delete.
];

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ success: false, error: 'method not allowed' }, 405);

  try {
    const auth = await requireTier(req, ['free', 'pro', 'business', 'enterprise'], 'delete_account');
    if (!auth.ok) return json(auth.body, auth.status);

    const userId = auth.userId;
    if (!userId) return json({ success: false, error: 'no user id on token' }, 401);

    const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Walk the user's projects so we can clean up project-scoped
    //    storage in step 3. We do this BEFORE the row delete because
    //    we need the projectIds.
    const { data: projects } = await sb
      .from('projects')
      .select('id')
      .eq('user_id', userId);
    const projectIds: string[] = (projects ?? []).map(p => p.id);

    // 2. Delete all user-scoped table rows. We loop one table at a time
    //    so a single-table failure doesn't abort the rest — we'd rather
    //    leave orphan rows in one table than refuse the deletion entirely.
    const tableErrors: string[] = [];
    for (const table of USER_SCOPED_TABLES) {
      const { error } = await sb.from(table).delete().eq('user_id', userId);
      if (error) {
        // 'relation does not exist' is benign — means the table was
        // dropped or renamed. Skip silently.
        if (!/relation .* does not exist/i.test(error.message)) {
          tableErrors.push(`${table}: ${error.message}`);
        }
      }
    }

    // 3. Storage cleanup. List + delete in chunks because remove() is
    //    capped at ~1000 paths per call.
    const removePrefix = async (bucket: string, prefix: string) => {
      try {
        const { data: list } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
        if (!list || list.length === 0) return;
        const paths = list.map(o => `${prefix}${o.name}`);
        await sb.storage.from(bucket).remove(paths);
      } catch (err) {
        console.log(`[delete-account] storage cleanup ${bucket}/${prefix} failed:`, err);
      }
    };

    for (const { bucket, prefix } of STORAGE_PREFIXES) {
      await removePrefix(bucket, prefix(userId));
    }
    for (const projectId of projectIds) {
      await removePrefix('plan-sheets', `${projectId}/`);
      await removePrefix('project-documents', `${projectId}/`);
    }

    // 4. Delete the auth.users row LAST. Once this row is gone the
    //    user's JWT is invalid and any subsequent retry would 401, so
    //    if we crash earlier the user can re-attempt and the prior
    //    table-delete pass picks up where we left off.
    const { error: authErr } = await sb.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error('[delete-account] auth.users delete failed:', authErr);
      return json({
        success: false,
        error: `Could not delete the account record: ${authErr.message}. Your data was removed but the login still exists. Email support@mageid.app to finish removal.`,
      }, 500);
    }

    return json({
      success: true,
      tablesCleared: USER_SCOPED_TABLES.length - tableErrors.length,
      tableErrors,
    });
  } catch (err) {
    console.error('[delete-account] fatal:', err);
    return json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, 500);
  }
});
