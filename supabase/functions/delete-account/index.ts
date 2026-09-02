// delete-account — permanently delete the authenticated user and all
// of their data. Required by Apple App Store Review Guideline 5.1.1(v):
// any app that creates an account MUST allow the user to delete it
// from inside the app. Failing this gets the binary rejected.
//
// What this function deletes:
//   1. Every row in every project-scoped table where user_id = caller,
//      INCLUDING the public-directory tables (public_bids / companies /
//      worker_profiles / job_listings) whose FK to auth.users is
//      ON DELETE SET NULL and therefore survives the auth delete.
//      (RLS would block other users from doing this; service role
//      below bypasses RLS but only for the authenticated caller's id.)
//   2. The Supabase auth.users row (which cascades to subscriptions,
//      profiles, and any other auth-FK'd table).
//   3. The user's storage objects in all eleven buckets, walked
//      RECURSIVELY, plus the objects their now-deleted rows pointed at.
//
// What we do NOT delete:
//   - RevenueCat subscriptions. The user must cancel through Apple/
//     Play before deleting the account; we surface a hard warning in
//     the UI. (Stripe Connect platform commissions also require
//     keeping payment records — those are 7-year IRS retention.)
//   - Anonymized aggregate analytics. None collected; we use Sentry
//     for crash reports only, no event logging tool.
//   - crew_members rows the caller merely CLAIMED. Those belong to the
//     GC who created them, so we release the claim instead (step 2b).
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
//
// THE COMMENT HERE USED TO SAY a missing table "just means orphan rows (no
// functional break)". That is false for any FK to auth.users declared
// ON DELETE NO ACTION: the leftover row makes step 4's auth.admin.deleteUser
// raise 23503, and steps 2 and 3 have ALREADY destroyed the user's rows and
// storage objects by then, in separate non-transactional calls with no
// rollback. The user ends up with everything deleted, a 500, and an account
// they are still signed in to. Apple exercises account deletion during review
// (5.1.1(v)), so that path is also a rejection.
//
// project_collaborators is the live instance and is handled explicitly below.
// scripts/validate-account-deletion.ts enumerates NO ACTION FKs to auth.users
// and fails if a new one appears that nothing here clears.
//
// It is ALSO false for the five FKs declared ON DELETE SET NULL (confdeltype
// 'n', verified against production 2026-09-02): public_bids, companies,
// worker_profiles, job_listings and crew_members.claimed_by_user_id. Those do
// not block the auth delete — they NULL the owner column, and every DELETE
// policy on those tables is `USING (auth.uid() = user_id)`, which can never
// match NULL. The row becomes permanently undeletable through the API while
// SELECT stays open to everyone (public_bids_select / companies_select are
// `USING true`). A homeowner's RFP — street address, GPS coordinates, contact
// email and interior photos of their house — therefore stayed live and
// browsable forever after they deleted their account. The first four are now
// deleted here; crew_members is released in step 2b.
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
  // Public directory. FK to auth.users is ON DELETE SET NULL, so these
  // outlive the account unless we delete them here. public_bids carries the
  // homeowner RFP (address_line, latitude, longitude, contact_email,
  // photo_urls, drawing_urls); scraped government bids have user_id NULL and
  // are untouched by the .eq('user_id', ...) filter.
  'public_bids', 'companies', 'worker_profiles', 'job_listings',
];

// Storage buckets, grouped by what the FIRST path segment is. All eleven
// buckets in production are listed — verified against storage.buckets and
// against every upload call site on 2026-09-02.
//
// THE OLD LIST HAD ONE ENTRY (pdf-uploads) plus a hardcoded pair of project
// prefixes, and its comment claimed orphans "cost cents per month but don't
// affect correctness". Both halves were wrong. The buckets it never touched
// hold the user's face (profiles/<uid>/avatar_*.jpg, a PUBLIC bucket), their
// government-ID scans (worker-ids), their signed contracts (secure-contracts),
// their jobsite photos (project-photos) and their homeowner-RFP photos of the
// inside of their house (rfp-attachments, also PUBLIC — an unauthenticated,
// permanent, indexable URL). That is a GDPR/CCPA erasure failure and an Apple
// 5.1.1(v) failure, not a storage bill.
const USER_KEYED_BUCKETS = [
  'pdf-uploads',       // <uid>/<uuid>-<name>.pdf          (pdfRenderClient)
  'project-photos',    // <uid>/<projectId>/<photoId>.jpg  (photoUploadCore)
  'profiles',          // <uid>/avatar_<ts>.jpg            (PUBLIC bucket)
  'branding',          // <uid>/logo_<ts>.png
  'documents',         // <uid>/<ts>_<name>.pdf
  'secure-contracts',  // <uid>/<contractId>.pdf
  'worker-ids',        // <uid>/<crewMemberId>/<ts>.jpg
  'rfp-attachments',   // <uid>/<rfpId>/<ts>_<name>        (PUBLIC bucket)
];

// Keyed by project id, so we have to walk the user's projects first.
const PROJECT_KEYED_BUCKETS = ['plan-sheets', 'project-documents'];

// sub-documents is keyed by SUBCONTRACTOR id — neither the user nor a
// project appears anywhere in the path (`<subId>/w9-<ts>.pdf`). Its RLS uses
// storage.objects.owner instead, which the Storage list API cannot filter on,
// so the only way to find these is to collect the caller's subcontractor ids
// before their rows are deleted. A W-9 is a name, address and TIN.
const SUBCONTRACTOR_KEYED_BUCKETS = ['sub-documents'];

// Depth guard for the recursive walk. Real paths are at most 3 segments
// (<uid>/<projectId>/<file>); this only exists so a pathological bucket
// cannot spin the function until the runtime's wall clock kills it.
const MAX_STORAGE_DEPTH = 5;

// Storage list() and remove() are both capped at 1000 entries per call, and
// PostgREST caps a select at db-max-rows (1000). Everything below pages.
const PAGE = 1000;

/**
 * Turn a stored URL into a bucket-relative storage path.
 *
 * Rows persist a mix of shapes: public_bids.photo_urls / drawing_urls hold
 * full public URLs (utils/storage.ts uploadRfpAttachment returns
 * getPublicUrl), plan_sheets.image_uri holds a public URL from
 * convert-pdf-to-images, and newer writers persist the bare path. Accept all
 * three; return null for anything that is not ours (an http URL pointing at
 * some other host, or a file:// URI that never uploaded).
 */
function storagePathFromUrl(raw: unknown, bucket: string): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const clean = raw.split('?')[0].split('#')[0];
  const marker = '/storage/v1/object/';
  const at = clean.indexOf(marker);
  if (at === -1) {
    // Not a Storage URL. A bare relative path is a valid stored shape; an
    // absolute URL to anywhere else is not.
    if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
    const bare = clean.replace(/^\/+/, '');
    return bare.length > 0 ? bare : null;
  }
  // .../object/public/<bucket>/<path>, .../object/sign/<bucket>/<path>
  // and .../object/authenticated/<bucket>/<path> all appear in the wild.
  const rest = clean.slice(at + marker.length).replace(/^(public|sign|authenticated)\//, '');
  const prefix = `${bucket}/`;
  if (!rest.startsWith(prefix)) return null;
  const path = rest.slice(prefix.length);
  if (path.length === 0) return null;
  try { return decodeURIComponent(path); } catch { return path; }
}

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

    /** Paged select — a 40-project account has well over 1000 plan sheets. */
    const selectAllByUser = async (
      table: string,
      columns: string,
    ): Promise<Record<string, unknown>[]> => {
      const rows: Record<string, unknown>[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from(table).select(columns).eq('user_id', userId).range(from, from + PAGE - 1);
        if (error || !data || data.length === 0) break;
        rows.push(...(data as unknown as Record<string, unknown>[]));
        if (data.length < PAGE) break;
      }
      return rows;
    };

    // ── 1. Collect every storage key BEFORE any row is deleted. ────────────
    //    Once the rows are gone the paths are unrecoverable and the objects
    //    are orphaned for good, so this pass has to run first.
    const projectIds: string[] = (await selectAllByUser('projects', 'id'))
      .map(r => String(r.id ?? '')).filter(Boolean);

    // sub-documents is keyed by subcontractor id, not by user or project.
    const subcontractorIds: string[] = (await selectAllByUser('subcontractors', 'id'))
      .map(r => String(r.id ?? '')).filter(Boolean);

    // Objects whose path does NOT start with a prefix we can walk:
    //  - plan-sheets renders made before a project was picked land under the
    //    SHARED `tmp/` folder (app/takeoff.tsx passes projectId ?? 'tmp'), so
    //    a prefix walk would either miss them or delete other users' sheets.
    //    plan_sheets.image_uri is the only record of which ones are ours.
    //  - RFP attachments are under <uid>/, but reading photo_urls/drawing_urls
    //    also catches any row whose attachments were uploaded under a
    //    different prefix, which is the exact data (interior photos of a home)
    //    the audit found surviving deletion.
    //
    // BOTH columns are client-writable (app/post-rfp.tsx inserts photo_urls
    // verbatim; plan_sheets.image_uri likewise), so a URL read out of a row is
    // NOT proof of ownership. Someone could point their own row at a stranger's
    // object and then delete their account to destroy it. Every derived path is
    // therefore re-checked against a prefix this caller could legitimately own
    // before it is queued for removal.
    const firstSegment = (p: string) => p.split('/')[0];
    const ownedPlanPrefixes = new Set<string>([
      ...projectIds,
      // Renders made before a project was picked share this folder. We cannot
      // prove ownership inside it, only that the row claiming the object is
      // ours — accepted because the alternative is leaving the departing
      // user's drawings in a public bucket permanently.
      'tmp',
    ]);
    const explicitObjects: Array<{ bucket: string; path: string }> = [];
    for (const row of await selectAllByUser('plan_sheets', 'image_uri')) {
      const path = storagePathFromUrl(row.image_uri, 'plan-sheets');
      if (path && ownedPlanPrefixes.has(firstSegment(path))) {
        explicitObjects.push({ bucket: 'plan-sheets', path });
      }
    }
    for (const row of await selectAllByUser('public_bids', 'photo_urls,drawing_urls')) {
      for (const key of ['photo_urls', 'drawing_urls'] as const) {
        const urls = row[key];
        if (!Array.isArray(urls)) continue;
        for (const url of urls) {
          const path = storagePathFromUrl(url, 'rfp-attachments');
          // uploadRfpAttachment always writes <uid>/<rfpId>/<file>, and the
          // bucket's RLS requires folder[1] = auth.uid(), so anything else in
          // this column was hand-written and is not ours to delete.
          if (path && firstSegment(path) === userId) {
            explicitObjects.push({ bucket: 'rfp-attachments', path });
          }
        }
      }
    }

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

    // 2b. Release, do not delete, crew_members the caller CLAIMED.
    //
    //     crew_members.user_id is the GC who created the worker record; the
    //     caller is only the person who redeemed the claim link, so deleting
    //     the row would destroy someone else's crew roster. The FK is
    //     ON DELETE SET NULL, so auth.admin.deleteUser would null
    //     claimed_by_user_id on its own — but it leaves claimed_at set, which
    //     renders the worker as "claimed" by nobody and gives the GC no way to
    //     re-issue the invite. Clearing both returns the row to unclaimed.
    //
    //     crew_freeze_ownership_columns (BEFORE UPDATE) would normally pin
    //     these columns, but its guard is `auth.uid() IS NOT NULL` and the
    //     service role has no auth.uid(), so this update lands.
    const { error: claimErr } = await sb
      .from('crew_members')
      .update({ claimed_by_user_id: null, claimed_at: null })
      .eq('claimed_by_user_id', userId);
    if (claimErr) tableErrors.push(`crew_members(claim): ${claimErr.message}`);

    // 3. Storage cleanup.
    //
    //    RECURSION IS THE WHOLE POINT. Storage list() returns only immediate
    //    children, with sub-folders as entries whose `id` is null. The old
    //    code listed `<projectId>/` in project-documents and passed the
    //    resulting names straight to remove() — but every real object there is
    //    `<projectId>/daily-reports/<uuid>.pdf`, so what it actually sent was
    //    remove(['<projectId>/daily-reports']), which matches no object and
    //    which Storage answers 200-with-nothing-deleted. Every filed daily
    //    report PDF, and every jobsite photo (project-photos is two levels
    //    deep too), survived deletion with no error logged anywhere.
    let storageObjectsRemoved = 0;

    const listPathsRecursive = async (
      bucket: string,
      prefix: string,
      depth = 0,
    ): Promise<string[]> => {
      if (depth > MAX_STORAGE_DEPTH) return [];
      const found: string[] = [];
      for (let offset = 0; ; offset += PAGE) {
        const { data: list, error } = await sb.storage
          .from(bucket).list(prefix, { limit: PAGE, offset });
        if (error || !list || list.length === 0) break;
        for (const entry of list) {
          const name = (entry as { name?: string }).name;
          if (!name) continue;
          const full = `${prefix}${name}`;
          // Folders come back with a null id (and null metadata); files do not.
          const isFolder = (entry as { id?: string | null }).id == null;
          if (isFolder) {
            found.push(...await listPathsRecursive(bucket, `${full}/`, depth + 1));
          } else {
            found.push(full);
          }
        }
        if (list.length < PAGE) break;
      }
      return found;
    };

    const removePaths = async (bucket: string, paths: string[]) => {
      const unique = [...new Set(paths.filter(p => p.length > 0))];
      for (let i = 0; i < unique.length; i += PAGE) {
        const chunk = unique.slice(i, i + PAGE);
        const { data, error } = await sb.storage.from(bucket).remove(chunk);
        if (error) {
          console.error(`[delete-account] storage remove ${bucket} failed:`, error.message);
          continue;
        }
        storageObjectsRemoved += Array.isArray(data) ? data.length : 0;
      }
    };

    const removePrefix = async (bucket: string, prefix: string) => {
      try {
        await removePaths(bucket, await listPathsRecursive(bucket, prefix));
      } catch (err) {
        // Best-effort per prefix: one unreachable bucket must not stop the
        // other ten, and must not stop step 4.
        console.error(`[delete-account] storage cleanup ${bucket}/${prefix} failed:`, err);
      }
    };

    for (const bucket of USER_KEYED_BUCKETS) {
      await removePrefix(bucket, `${userId}/`);
    }
    for (const bucket of PROJECT_KEYED_BUCKETS) {
      for (const projectId of projectIds) await removePrefix(bucket, `${projectId}/`);
    }
    for (const bucket of SUBCONTRACTOR_KEYED_BUCKETS) {
      for (const subId of subcontractorIds) await removePrefix(bucket, `${subId}/`);
    }
    // Anything the deleted rows pointed at that no prefix walk would reach.
    const byBucket = new Map<string, string[]>();
    for (const { bucket, path } of explicitObjects) {
      const acc = byBucket.get(bucket);
      if (acc) acc.push(path); else byBucket.set(bucket, [path]);
    }
    for (const [bucket, paths] of byBucket) {
      try {
        await removePaths(bucket, paths);
      } catch (err) {
        console.error(`[delete-account] storage cleanup ${bucket} (by url) failed:`, err);
      }
    }

    // 3b. Clear the rows that BLOCK the auth delete.
    //
    // project_collaborators has two FKs to auth.users declared ON DELETE
    // NO ACTION (project_collaborators_user_id_fkey and _invited_by_fkey —
    // verified against production). Its only cascade path is via project_id,
    // which fires solely for projects this user OWNS. So a Project Manager or
    // Expeditor invited onto someone ELSE's job still has a referencing row
    // when step 4 runs, and the delete raises 23503 after their data is gone.
    //
    // invited_by is NOT NULL, so the row must be DELETED, not nulled. Removing
    // rows this user invited is the same outcome the ON DELETE CASCADE backstop
    // migration produces, so the two paths agree.
    for (const column of ['user_id', 'invited_by'] as const) {
      const { error: collabErr } = await sb
        .from('project_collaborators').delete().eq(column, userId);
      if (collabErr) {
        // Fail BEFORE destroying anything else is pointless here (rows are
        // already gone), but surfacing the real reason beats a 23503 the
        // caller cannot interpret.
        console.error(`[delete-account] project_collaborators.${column} clear failed:`, collabErr);
        return json({
          success: false,
          error: `Could not release project invitations (${column}): ${collabErr.message}. Nothing further was deleted. Email support@mageid.app.`,
        }, 500);
      }
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
      storageObjectsRemoved,
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
