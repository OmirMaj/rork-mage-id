// delete-account — permanently delete the authenticated user and all
// of their data. Required by Apple App Store Review Guideline 5.1.1(v):
// any app that creates an account MUST allow the user to delete it
// from inside the app. Failing this gets the binary rejected.
//
// What this function does, in order:
//   1. READS every id and storage key it will need — the caller's project,
//      subcontractor, portal and sub-portal ids, and the object paths that
//      only exist inside rows about to be deleted. Nothing is deleted until
//      this pass has SUCCEEDED (see FAILURE CONTRACT).
//   2. Deletes every row in every project-scoped table where user_id = caller,
//      INCLUDING the public-directory tables (public_bids / companies /
//      worker_profiles / job_listings). Their FK to auth.users was ON DELETE
//      SET NULL until 20260902150000_public_directory_fk_cascade; schema.sql
//      now shows CASCADE, and they stay in the list so the erasure does not
//      depend on which migrations a given database has.
//      (RLS would block other users from doing this; service role
//      below bypasses RLS but only for the authenticated caller's id.)
//      Also every row in the tenant-keyed tables that have NO user_id — client
//      portal messages, e-signed change-order approvals, budget proposals,
//      the portal decision audit, sub-portal invoices, the notification
//      outbox — matched on the project / portal / sub-portal ids the caller
//      owns (TENANT_SCOPED_DELETES). Audit DB-F7 / AUTH-F1. A portal id is
//      only a string in the caller's own JSON, so every one is RESOLVED back
//      to the projects that carry it before it is used as a key (review
//      2026-09-05, third round — see resolvePortalIds). And an id that is
//      provably the caller's can STILL be a splice: postgrest-js quotes an
//      `.in()` value without escaping it, so every id is charset-gated before
//      it is used as a filter value at all, and the two text-keyed deletes are
//      issued one `.eq` at a time (review 2026-09-06 — see SAFE_DELETE_KEY).
//   3. Removes the user's storage objects in all eleven buckets, walked
//      RECURSIVELY, plus the objects their now-deleted rows pointed at.
//   4. Deletes the Supabase auth.users row (which cascades to subscriptions,
//      profiles, and any other auth-FK'd table).
//
// FAILURE CONTRACT (review 2026-09-05). The four steps are separate,
// non-transactional calls with no rollback, so the order of the exits is the
// whole design:
//   • a read failure in step 1 → 500, NOTHING deleted; the user retries;
//   • a row-delete failure in step 2 → 500, login KEPT and storage UNTOUCHED
//     (the abort in 2f runs before step 3), so a retry re-runs the same
//     row pass against the same ids;
//   • a storage failure in step 3 is logged and does not stop step 4: the
//     uid-keyed prefixes can be re-swept by support with nothing but the
//     uid, whereas the row-derived keys cannot be re-derived once step 2 has
//     run, so stopping here would not make a retry more complete;
//   • a failure in step 4 → 500 naming the auth error; the data is gone but
//     the login exists, and support finishes the removal.
//   Success is reported only when every row delete succeeded AND the login
//   is gone. The old code broke the second bullet twice: it swallowed read
//   errors in step 1 (an empty list looks exactly like an account that owns
//   nothing) and it ran storage removal BEFORE the row-delete abort, so a
//   kept login came with its files already destroyed.
//
// What we do NOT delete:
//   - RevenueCat subscriptions. The user must cancel through Apple/
//     Play before deleting the account; we surface a hard warning in
//     the UI. (Stripe Connect platform commissions also require
//     keeping payment records — those are 7-year IRS retention.)
//   - Product analytics. PostHog IS live (utils/posthog.ts) — events are
//     keyed by the Supabase uid only, with no email or other PII on them —
//     and this function does not call PostHog's person-deletion API, so the
//     uid-keyed event history stays there until it is purged in PostHog.
//     Sentry receives crash reports only (sendDefaultPii: false). An
//     earlier version of this comment claimed "no event logging tool";
//     audit AUTH-F3 caught it.
//   - crew_members rows the caller merely CLAIMED. Those belong to the
//     GC who created them, so we release the claim instead (step 2d).
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
// project_collaborators WAS the live instance (both of its FKs were NO ACTION
// until 20260902120000_collaborator_fk_cascade; schema.sql now shows CASCADE
// on both) and is still cleared explicitly below, so step 4 is safe on a
// database where that migration has not landed. scripts/validate-account-
// deletion.ts enumerates NO ACTION FKs to auth.users and fails if a new one
// appears that nothing here clears.
//
// It was ALSO false for the five FKs that were ON DELETE SET NULL on
// 2026-09-02: public_bids, companies, worker_profiles, job_listings and
// crew_members.claimed_by_user_id. SET NULL does not block the auth delete —
// it NULLs the owner column, and every DELETE policy on those tables is
// `USING (auth.uid() = user_id)`, which can never match NULL. The row becomes
// permanently undeletable through the API while SELECT stays open to everyone
// (public_bids_select / companies_select are `USING true`). A homeowner's RFP
// — street address, GPS coordinates, contact email and interior photos of
// their house — therefore stayed live and browsable forever after they deleted
// their account. 20260902150000_public_directory_fk_cascade moved the first
// four to ON DELETE CASCADE (that is what schema.sql shows today); they are
// still deleted here so the erasure does not depend on the FK, and
// crew_members.claimed_by_user_id — the one that is still SET NULL — is
// released in step 2d.
const USER_SCOPED_TABLES = [
  'projects', 'change_orders', 'invoices', 'daily_reports',
  'subcontractors', 'punch_items', 'photos', 'price_alerts',
  'contacts', 'comm_events', 'rfis', 'submittals', 'oac_meetings',
  'cois', 'equipment', 'warranties',
  'commitments', 'prequal_packets', 'drawing_pins',
  'plan_calibrations', 'plan_sheets', 'plan_markups', 'permits',
  'aia_pay_apps', 'sub_portal_links', 'leads', 'bid_packages',
  'bid_package_bids', 'time_entries', 'subscriptions',
  'ai_usage_counters',
  // Public directory. FK to auth.users was ON DELETE SET NULL (CASCADE since
  // 20260902150000), so on an older database these outlive the account
  // unless we delete them here. public_bids carries the homeowner RFP
  // (address_line, latitude, longitude, contact_email, photo_urls,
  // drawing_urls); scraped government bids have user_id NULL and are
  // untouched by the .eq('user_id', ...) filter.
  'public_bids', 'companies', 'worker_profiles', 'job_listings',
  // DB-F7 / AUTH-F1 (2026-09-03): user-keyed tables that had NO foreign key
  // to auth.users at all, so the auth delete never reached them.
  // 20260904100700_account_deletion_fks.sql adds ON DELETE CASCADE; they are
  // deleted here too so this function is correct whether or not that
  // migration has been applied yet.
  'memory_embeddings', 'rate_overrides', 'ai_daily_usage',
];

// 'portal_messages' USED TO BE IN THE LIST ABOVE. The table has no user_id
// column — it is keyed by portal_id / project_id — so `.eq('user_id', …)`
// answered 42703 on every run, the message did not match the "relation does
// not exist" tolerance below, and the response still said success: true.
// Ten rows in production, two already orphaned (audit DB-F7 / AUTH-F1). It
// and the other tenant-keyed tables are handled by TENANT_SCOPED_DELETES;
// scripts/validate-account-deletion.ts checks that every entry in
// USER_SCOPED_TABLES actually has a user_id column, and that every table in
// schema.sql has SOME deletion path.

// Tables that hold the caller's tenant data but carry no user_id: they are
// keyed by the ids of things the caller owns. The ids are resolved in step 1
// (before any row is deleted, because they come from rows this function
// deletes) and applied in step 2a. `key` names which id list the column is
// matched against:
//   project   → projects.id            (text or uuid column — PostgREST casts)
//   portal    → projects.client_portal->>'portalId', AFTER resolvePortalIds
//               has confirmed each id resolves only to the caller's projects
//               (the column is client-written; a string in it proves nothing)
//   subPortal → sub_portal_links.id    (the table's PRIMARY KEY, read from
//               rows whose user_id is the caller — no resolution needed, see
//               collectTenantKeys)
//   user      → the caller's uid
// A table may appear twice (portal_id AND project_id) because the portal
// tables were written by different code paths over time and either column
// may be the only one populated on a given row.
type TenantKey = 'project' | 'portal' | 'subPortal' | 'user';
const TENANT_SCOPED_DELETES: ReadonlyArray<{ table: string; column: string; key: TenantKey }> = [
  { table: 'portal_messages',         column: 'portal_id',         key: 'portal' },
  { table: 'portal_messages',         column: 'project_id',        key: 'project' },
  { table: 'change_order_approvals',  column: 'portal_id',         key: 'portal' },
  { table: 'change_order_approvals',  column: 'project_id',        key: 'project' },
  { table: 'portal_budget_proposals', column: 'portal_id',         key: 'portal' },
  { table: 'portal_budget_proposals', column: 'project_id',        key: 'project' },
  { table: 'portal_decision_audit',   column: 'portal_id',         key: 'portal' },
  { table: 'portal_decision_audit',   column: 'project_id',        key: 'project' },
  // Belt-and-braces: these two also cascade from projects, but only through
  // a NULLABLE project_id.
  { table: 'portal_snapshots',        column: 'portal_id',         key: 'portal' },
  { table: 'sub_portal_snapshots',    column: 'sub_portal_id',     key: 'subPortal' },
  { table: 'sub_submitted_invoices',  column: 'sub_portal_id',     key: 'subPortal' },
  { table: 'sub_submitted_invoices',  column: 'project_id',        key: 'project' },
  { table: 'notification_outbox',     column: 'recipient_user_id', key: 'user' },
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

// The id list rides in the query string, so keep each request short.
const IN_CHUNK = 100;

// ── THE DELETE-KEY CHARSET GATE (review 2026-09-06) ─────────────────────────
//
// `.in()` IS A STRING SPLICE. postgrest-js builds the filter by wrapping any
// value that contains a PostgREST reserved character in double quotes and
// escaping NOTHING inside them (PostgrestFilterBuilder.ts, unchanged from
// 2.39.7 — the version this function pins — through 2.103.3):
//
//     const PostgrestReservedCharsRegexp = new RegExp('[,()]')
//     …
//     if (typeof s === 'string' && PostgrestReservedCharsRegexp.test(s)) return `"${s}"`
//
// PostgREST then splits `in.(…)` on the commas BETWEEN quoted items and
// un-escapes `\"` INSIDE them. So ONE array element can become TWO filter
// values, and a `\",\"` element collapses back into one. Probed live against
// production on 2026-09-06 with the public anon key, against city_coords:
//
//   state=in.("TX","CA")       → 200, TX rows AND CA rows  (one value split in two)
//   latitude=in.("AA\",\"BB")  → 400 `invalid input syntax … "AA","BB"`  (two → one)
//   state=in.("TX\",\"CA",CA)  → 200, CA rows      (escaped and plain items coexist)
//   state=eq.TX","CA           → 200, []           (eq does NOT split — it appends
//                                                   `eq.${value}` verbatim, no quoting)
//
// Under the SERVICE ROLE, in a DELETE, a split is a cross-tenant erase. Two
// live paths reached it here, and NEITHER needed a database bug:
//
//   (a) sub_portal_links.id is client-minted `text NOT NULL` with NO default,
//       and the INSERT policy ("gc writes own sub portal links") checks only
//       `user_id = auth.uid()` — nothing constrains the id. An attacker
//       inserts a row of their own whose id is `x","<victim sub_portal_id>`.
//       selectAllByUser hands it back verbatim, and the sub-portal deletes
//       emitted `sub_portal_id=in.("x","<victim id>")`, which splits: the
//       victim's sub_submitted_invoices and sub_portal_snapshots are deleted.
//       The old comment further down called these ids safe "because id is the
//       PRIMARY KEY". A PK guarantees IDENTITY — no two rows share a value —
//       and says nothing about ENCODING. The split does not need two rows to
//       share an id; it needs ONE id that contains `","`.
//
//   (b) resolvePortalIds was defeated the same way. The attacker owns two
//       projects: A carrying P = `x","<victim portalId>` and B carrying
//       C = `x\",\"<victim portalId>`. The resolver's own `.in()` sends both;
//       C is quoted to `"x\",\"…"` and un-escapes to P, so A comes back and
//       resolvesTo[P] = {A} — every project owned — and P is KEPT. The delete
//       then splits it. Migration 20260904100950 blocks neither: P and C are
//       distinct strings so the unique index is satisfied, and the freeze
//       trigger only fires for a NON-owner.
//
// So: no id becomes a delete key, or a filter value of any kind, until it has
// matched this. Real ids are app-minted uuids (`projects.id`,
// `subcontractors.id` — both `uuid` columns), `portal-<8 hex>-<base36 ms>`
// (app/client-portal-setup.tsx:255, app/project-detail.tsx:3895,
// app/dev-seeder.tsx:265 which ends `-demo`) and
// `sub-portal-<6>-<6>-<base36 ms>` (app/sub-portal-setup.tsx:175). Every one
// of those matches; nothing legitimate is lost. Verified against production
// on 2026-09-06: 0 of 3 live portalIds and 0 of 0 sub_portal_links.id
// violate it (longest live portalId is 24 chars).
//
// `$` in a JavaScript RegExp without /m matches only at the very end of the
// input — there is no trailing-newline leniency to smuggle a second line
// through — and the class excludes `,` `(` `)` `"` `\` and whitespace, which
// is every character the splice needs.
const SAFE_DELETE_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

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

/** Everything step 1 reads and steps 2–3 consume. */
interface Collected {
  projectIds: string[];
  subcontractorIds: string[];
  /** Portal ids that resolve ONLY to the caller's projects (resolvePortalIds). */
  portalIds: string[];
  /** Claimed portal ids that also resolved to another tenant's project — dropped, counted. */
  portalCollisions: number;
  subPortalIds: string[];
  /** Ids that failed SAFE_DELETE_KEY and were dropped before becoming a key — dropped, counted. */
  malformedIds: number;
  explicitObjects: Array<{ bucket: string; path: string }>;
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

    /**
     * Paged select — a 40-project account has well over 1000 plan sheets.
     *
     * THROWS on any error. It used to `break` on error and hand back whatever
     * it had, so a transient failure on the first page of projects /
     * sub_portal_links / plan_sheets / public_bids came back as an EMPTY
     * list. projectIds / portalIds / subPortalIds were then empty, every
     * TENANT_SCOPED_DELETES entry and every keyed storage walk was skipped
     * without a word, step 2 cascaded projects, and step 4 removed the login
     * with success: true — leaving portal_messages, change_order_approvals,
     * portal_budget_proposals, portal_decision_audit and
     * sub_submitted_invoices (no FK path to auth.users) behind for good.
     * Review 2026-09-05. Step 1 turns the throw into a 500 while nothing has
     * been deleted yet.
     */
    const selectAllByUser = async (
      table: string,
      columns: string,
    ): Promise<Record<string, unknown>[]> => {
      const rows: Record<string, unknown>[] = [];
      // Page until an EMPTY page, advancing by what actually came back. The
      // old loop stepped by PAGE and stopped on a short page, which assumed
      // db-max-rows is at least 1000: under a lower cap every page is short,
      // so it returned the first cap-sized slice and called it complete —
      // and stepping by PAGE would have skipped everything between the cap
      // and 1000 on the next page anyway. ORDER BY id keeps the pages stable.
      for (let from = 0; ; ) {
        const { data, error } = await sb
          .from(table).select(columns).eq('user_id', userId).order('id').range(from, from + PAGE - 1);
        if (error) throw new Error(`${table} read failed: ${error.message}`);
        if (!data || data.length === 0) break;
        rows.push(...(data as unknown as Record<string, unknown>[]));
        from += data.length;
      }
      return rows;
    };

    /**
     * A portal id is a CLAIM, not proof of ownership.
     *
     * projects.client_portal is client-written jsonb (the owner upsert in
     * contexts/ProjectContext.tsx sends the whole blob) and the portalId is
     * in every homeowner link, so anyone who has seen a link can PATCH that
     * id into their own project and then call this function: step 2a would
     * delete the OTHER tenant's portal_messages, e-signed
     * change_order_approvals, portal_budget_proposals, portal_decision_audit
     * and portal_snapshots under the service role and answer success: true
     * (review 2026-09-05, third round). 20260904100950_portal_id_unique_and_
     * frozen.sql makes the spoof unwritable at the database (unique partial
     * index; freeze trigger); this resolver is the half that holds on a
     * database where that file is not applied yet, and turns "should be
     * impossible" into "checked on every run".
     *
     * Each claimed id is resolved back to the projects that carry it — with
     * the service role, so RLS cannot hide a row — and is KEPT only if it
     * resolves to at least one project and EVERY project it resolves to is
     * the caller's. An id that also resolves to someone else's project is a
     * collision: logged as a count (the id would name the victim's link) and
     * dropped, so the portal-keyed deletes run on the resolved set alone. The
     * project-keyed entries still cover the caller's own rows either way.
     */
    const resolvePortalIds = async (
      claimed: string[],
      ownedProjectIds: string[],
    ): Promise<{ portalIds: string[]; portalCollisions: number }> => {
      // Every candidate has already passed SAFE_DELETE_KEY at its read site,
      // so the `.in()` below cannot be spliced (that is exploit (b), and it
      // targeted THIS query first). Re-assert it rather than trust the caller:
      // a filter value is a filter value whether the statement reads or writes.
      const candidates = [...new Set(claimed)].filter(id => SAFE_DELETE_KEY.test(id));
      if (candidates.length === 0) return { portalIds: [], portalCollisions: 0 };
      const owned = new Set(ownedProjectIds);
      const resolvesTo = new Map<string, Set<string>>();
      for (let i = 0; i < candidates.length; i += IN_CHUNK) {
        const chunk = candidates.slice(i, i + IN_CHUNK);
        for (let from = 0; ; ) {
          const { data, error } = await sb
            .from('projects')
            .select('id, portal_id:client_portal->>portalId')
            .in('client_portal->>portalId', chunk)
            .order('id')
            .range(from, from + PAGE - 1);
          if (error) throw new Error(`portal id resolution failed: ${error.message}`);
          if (!data || data.length === 0) break;
          for (const row of data as unknown as Array<{ id?: unknown; portal_id?: unknown }>) {
            const portalId = String(row.portal_id ?? '');
            const projectId = String(row.id ?? '');
            if (!portalId || !projectId) continue;
            const acc = resolvesTo.get(portalId);
            if (acc) acc.add(projectId); else resolvesTo.set(portalId, new Set([projectId]));
          }
          from += data.length;
        }
      }
      const portalIds: string[] = [];
      let portalCollisions = 0;
      let unresolved = 0;
      for (const portalId of candidates) {
        const projects = resolvesTo.get(portalId);
        if (!projects || projects.size === 0) {
          // The caller's row changed between the two reads (deleted on another
          // device). Not provably theirs any more, so not used as a key; rows
          // that carry a project_id are still covered by the project entries.
          unresolved++;
          continue;
        }
        if ([...projects].every(id => owned.has(id))) portalIds.push(portalId);
        else portalCollisions++;
      }
      if (portalCollisions > 0) {
        // Count only. Naming the id would name the victim's link.
        console.error(`[delete-account] ${portalCollisions} portal ids on this account also resolve to another account's project and were dropped from the portal-keyed deletes`);
      }
      if (unresolved > 0) {
        console.warn(`[delete-account] ${unresolved} portal ids no longer resolve to any project and were skipped`);
      }
      return { portalIds, portalCollisions };
    };

    // ── 1. Collect every tenant id and storage key BEFORE any row is deleted.
    //    Once the rows are gone the paths are unrecoverable and the objects
    //    are orphaned for good, so this pass has to run first — and it has to
    //    SUCCEED. An id list that is empty because a read failed looks exactly
    //    like an account that owns nothing, and everything keyed on it would
    //    be skipped silently. So the whole pass is one unit: any failure is
    //    answered with a 500 while nothing has been deleted, and the user
    //    simply retries.
    const collectTenantKeys = async (): Promise<Collected> => {
      // Every id list passes through this before it is used for ANYTHING —
      // a PostgREST filter value or a storage prefix. See SAFE_DELETE_KEY.
      // The `label` is a literal from this file, never the value: an id that
      // fails the gate IS the attack payload and carries the victim's id, so
      // it is counted and never logged, echoed or returned.
      let malformedIds = 0;
      const gate = (label: string, ids: string[]): string[] => {
        const safe = ids.filter(id => SAFE_DELETE_KEY.test(id));
        const dropped = ids.length - safe.length;
        if (dropped > 0) {
          malformedIds += dropped;
          console.error(`[delete-account] ${dropped} ${label} id(s) are not a legal id and were dropped before they could become a delete key`);
        }
        return safe;
      };

      // projects.id and subcontractors.id are `uuid` columns, so PostgREST can
      // only ever hand back canonical uuids and the gate is an assertion, not
      // a filter. It stays because the guarantee is the COLUMN TYPE, and a
      // column type is one migration away from being a guarantee about
      // something else — as sub_portal_links.id (`text`, client-minted) shows.
      const projectIds: string[] = gate('project', (await selectAllByUser('projects', 'id'))
        .map(r => String(r.id ?? '')).filter(Boolean));

      // sub-documents is keyed by subcontractor id, not by user or project.
      // Gated too: it is interpolated into a storage prefix (`${subId}/`).
      const subcontractorIds: string[] = gate('subcontractor', (await selectAllByUser('subcontractors', 'id'))
        .map(r => String(r.id ?? '')).filter(Boolean));

      // Portal and sub-portal ids: the keys of the tenant-scoped tables (client
      // messages, e-signed CO approvals, budget proposals, decision audit, sub
      // invoices). projects and sub_portal_links are deleted in step 2, so
      // these MUST be read now.
      //
      // The portal ids are CLAIMED, not owned: they come out of a jsonb the
      // caller writes. resolvePortalIds turns them into the set that is
      // provably the caller's; only that set keys the portal deletes.
      //
      // `.filter(Boolean)` first so the '' placeholder DEFAULT_PORTAL carries
      // (app/client-portal-setup.tsx:135) is dropped as absent rather than
      // counted as malformed; the gate then takes the rest.
      const claimedPortalIds: string[] = gate('portal', (await selectAllByUser('projects', 'client_portal'))
        .map(r => {
          const cp = r.client_portal;
          return cp && typeof cp === 'object'
            ? String((cp as { portalId?: unknown }).portalId ?? '')
            : '';
        })
        .filter(Boolean));
      const { portalIds, portalCollisions } = await resolvePortalIds(claimedPortalIds, projectIds);

      // Sub-portal ids need no OWNERSHIP resolution. They are read from the
      // sub_portal_links TABLE, not from a JSON blob: `id` is that table's
      // PRIMARY KEY (sub_portal_links_pkey), so no other tenant's row can hold
      // the same value, and the INSERT / UPDATE policies both pin
      // user_id = auth.uid(), so the rows selected here are the caller's.
      //
      // THAT PARAGRAPH USED TO END "a caller can only ever put THEIR OWN link
      // ids in this list", and treated it as proof the ids were safe to use as
      // delete keys. It is not. A primary key constrains IDENTITY — no two
      // rows share a value — and says nothing about ENCODING, which is the
      // property `.in()` depends on. `id` is `text NOT NULL` with NO default,
      // minted on the client (contexts/ProjectContext.tsx writes
      // `id: resolved.id` straight through), and the INSERT policy checks only
      // `user_id = auth.uid()`. So a caller could insert a row of their OWN,
      // with a unique id they own outright, whose VALUE is
      // `x","<victim sub_portal_id>` — and the `.in()` below spliced it into
      // two filter values under the service role. See SAFE_DELETE_KEY: the
      // gate is what makes this list safe, not the PK, and the deletes it
      // keys are issued one `.eq` at a time (step 2a) as well.
      const subPortalIds: string[] = gate('sub-portal', (await selectAllByUser('sub_portal_links', 'id'))
        .map(r => String(r.id ?? '')).filter(Boolean));

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
      return { projectIds, subcontractorIds, portalIds, portalCollisions, subPortalIds, malformedIds, explicitObjects };
    };

    let collected: Collected | null = null;
    let collectErr: unknown = null;
    try {
      collected = await collectTenantKeys();
    } catch (err) {
      collectErr = err;
    }
    if (!collected) {
      const reason = collectErr instanceof Error ? collectErr.message : String(collectErr);
      console.error('[delete-account] could not enumerate the account; nothing was deleted:', reason);
      return json({
        success: false,
        error: `Could not read your data (${reason}). Nothing was deleted — please try again in a moment.`,
      }, 500);
    }
    const { projectIds, subcontractorIds, portalIds, portalCollisions, subPortalIds, malformedIds, explicitObjects } = collected;

    // ── 2. Row deletes. One statement at a time, so a single failure does
    //    not abort the rest; every failure is RECORDED, and 2f refuses to go
    //    any further while one exists — reporting success over orphaned rows
    //    is the bug this pass exists to fix.
    const tableErrors: string[] = [];
    // 'relation does not exist' is benign — the table was dropped or renamed.
    // Anything else (a column that does not exist, a constraint, a timeout)
    // is a real failure and is reported.
    const isMissingRelation = (message: string) => /relation .* does not exist/i.test(message);

    // 2a. Tenant-scoped rows — the tables with no user_id (DB-F7 / AUTH-F1).
    //     Keyed by the project / portal / sub-portal ids collected above —
    //     the portal list is the RESOLVED one, never the raw jsonb read, and
    //     every list has passed SAFE_DELETE_KEY.
    //     `.in()` with an empty list is a PostgREST parse error, not a no-op,
    //     so an empty id list skips the statement.
    //
    //     HOW THE STATEMENT IS SHAPED, and why it differs per key:
    //
    //     • portal / subPortal → ONE `.eq(column, id)` PER ID. Both columns
    //       are `text` and both id sets are, at root, values the CALLER
    //       minted, so these are the two that carried the `.in()` splice
    //       (SAFE_DELETE_KEY). The gate already makes them safe; `.eq` is the
    //       belt to its braces, and it is safe for a different reason —
    //       postgrest-js appends `eq.${value}` VERBATIM, with no quoting, so
    //       there is no quoted context for a `","` to escape out of. Probed
    //       live 2026-09-06: `state=eq.TX","CA` → 200 with an empty body,
    //       where `state=in.("TX","CA")` returned both states' rows.
    //
    //     • project → `.in()`, CHUNKED. projects.id is a `uuid` column, so
    //       PostgREST cannot return a value that contains `,`, `(`, `)` or a
    //       quote, and the splice has no material to work with. Keeping the
    //       set form here is worth it: it is 1 request per chunk of 100
    //       instead of 1 per project, across 5 tables. (The chunking is new —
    //       the old call put every project id in one query string.)
    //
    //     • user → `.eq` on the uid from the JWT, as before.
    //
    //     WORST CASE, in requests: 5 × ceil(projects/100) for the project
    //     entries + 5 × portalIds + 2 × subPortalIds + 1. Production on
    //     2026-09-06 is 7 projects / 3 portal ids / 0 sub-portal links → 21
    //     requests. It grows linearly with portal-enabled projects and
    //     sub-portal links: a 200-portal, 500-sub-link account would issue
    //     ~3000 tiny DELETEs. If that ever becomes the binding constraint the
    //     fix is a SECURITY DEFINER RPC taking the ids as a `text[]` argument
    //     — a JSON body parameter, which is bound rather than spliced into a
    //     query string — NOT a return to `.in()` on a text column.
    const tenantIds: Record<TenantKey, string[]> = {
      project: projectIds,
      portal: portalIds,
      subPortal: subPortalIds,
      user: [userId],
    };
    // The keys whose column is `text` and whose values the caller minted.
    const TEXT_KEYED_TENANT_KEYS: ReadonlyArray<TenantKey> = ['portal', 'subPortal'];
    // One entry per table.column however many statements it took, so a
    // per-id loop cannot flood the response (and the abort below reads the
    // same list it always did).
    const recordTableError = (label: string, message: string) => {
      if (isMissingRelation(message)) return;
      if (tableErrors.some(e => e.startsWith(`${label}: `))) return;
      tableErrors.push(`${label}: ${message}`);
    };
    for (const { table, column, key } of TENANT_SCOPED_DELETES) {
      const ids = tenantIds[key];
      if (ids.length === 0) continue;
      const label = `${table}.${column}`;
      if (TEXT_KEYED_TENANT_KEYS.includes(key)) {
        for (const id of ids) {
          const { error } = await sb.from(table).delete().eq(column, id);
          if (error) recordTableError(label, error.message);
        }
      } else if (key === 'user') {
        const { error } = await sb.from(table).delete().eq(column, userId);
        if (error) recordTableError(label, error.message);
      } else {
        for (let i = 0; i < ids.length; i += IN_CHUNK) {
          const { error } = await sb.from(table).delete().in(column, ids.slice(i, i + IN_CHUNK));
          if (error) recordTableError(label, error.message);
        }
      }
    }

    // 2b. conversations is keyed by a jsonb ARRAY of participant uids (the
    //     Hire feature, currently gated off). The caller's participant row
    //     and their messages cascade from auth.users; the container row —
    //     participant names and the last message text — does not, so remove
    //     every thread the caller was part of. `cs.` with a JSON string is
    //     the jsonb containment form PostgREST expects.
    //
    //     Deleting the container row cascades EVERY message in the thread
    //     through messages_conversation_id_fkey (ON DELETE CASCADE, verified
    //     live 2026-09-05) — the COUNTERPART's messages included, not only the
    //     caller's. By design: a Hire thread is one two-party exchange, and
    //     the other party's replies to a deleted account are part of what the
    //     account asked to have erased; they do not survive as a headless
    //     thread with one participant.
    {
      const { error: convErr } = await sb
        .from('conversations').delete()
        .contains('participant_ids', JSON.stringify([userId]));
      if (convErr && !isMissingRelation(convErr.message)) {
        tableErrors.push(`conversations.participant_ids: ${convErr.message}`);
      }
    }

    // 2c. Every user-scoped table.
    for (const table of USER_SCOPED_TABLES) {
      const { error } = await sb.from(table).delete().eq('user_id', userId);
      if (error && !isMissingRelation(error.message)) {
        tableErrors.push(`${table}: ${error.message}`);
      }
    }

    // 2d. Release, do not delete, crew_members the caller CLAIMED.
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

    // 2e. Clear the rows that BLOCK the auth delete.
    //
    //     project_collaborators had two FKs to auth.users declared ON DELETE
    //     NO ACTION (project_collaborators_user_id_fkey and _invited_by_fkey)
    //     until 20260902120000_collaborator_fk_cascade; schema.sql now shows
    //     both as ON DELETE CASCADE. Its only OTHER cascade path is via
    //     project_id, which fires solely for projects this user OWNS. So on a
    //     database without that migration a Project Manager or Expeditor
    //     invited onto someone ELSE's job still has a referencing row when
    //     step 4 runs, and the delete raises 23503 after their data is gone.
    //     The explicit delete stays so this function is correct on either
    //     schema state.
    //
    //     invited_by is NOT NULL, so the row must be DELETED, not nulled.
    //     Removing rows this user invited is the same outcome the ON DELETE
    //     CASCADE migration produces, so the two paths agree. A failure here
    //     is a row-delete failure like any other and goes through the same
    //     abort below.
    for (const column of ['user_id', 'invited_by'] as const) {
      const { error: collabErr } = await sb
        .from('project_collaborators').delete().eq(column, userId);
      if (collabErr) tableErrors.push(`project_collaborators.${column}: ${collabErr.message}`);
    }

    // 2f. Refuse to go any further while any row delete failed.
    //
    //     This runs BEFORE storage removal on purpose: the old code removed
    //     the storage objects first and only then checked tableErrors, so an
    //     abort kept the login but the user's files were already gone —
    //     "try again" with nothing left to try against. Stopping HERE keeps
    //     the JWT valid AND the bytes in place, so the user (or support) can
    //     re-run once the table is fixed, and the response names the exact
    //     table instead of a 23503 nobody can interpret. The old code also
    //     pushed the error into tableErrors, deleted the auth row anyway and
    //     answered success: true — which is how the dead portal_messages
    //     entry hid for a month.
    if (tableErrors.length > 0) {
      console.error('[delete-account] row deletion incomplete; login kept and storage untouched so the run can be retried:', tableErrors);
      return json({
        success: false,
        error: `Some of your data could not be deleted (${tableErrors.map(e => e.split(':')[0]).join(', ')}). Your login was kept so you can try again; contact support if it happens twice.`,
        tableErrors,
      }, 500);
    }

    // ── 3. Storage cleanup — only now, with every row delete known to have
    //    succeeded.
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
    // A list() that FAILS is not an empty folder. It used to be treated as
    // one — `if (error || !list …) break` — so an unreachable prefix was
    // silently left in place and the response counted nothing. Every failed
    // list is now logged and counted; the FAILURE CONTRACT keeps the pass
    // best-effort (support re-sweeps the uid-keyed prefixes by uid).
    let storageListErrors = 0;
    // A remove() that FAILS leaves the objects in place. It was logged and
    // then dropped: `storageObjectsRemoved` simply did not go up, which is
    // indistinguishable in the response from a prefix that held nothing. The
    // response is the only thing support and the caller ever see, so a failed
    // remove is counted beside a failed list (review 2026-09-06).
    let storageRemoveErrors = 0;

    const listPathsRecursive = async (
      bucket: string,
      prefix: string,
      depth = 0,
    ): Promise<string[]> => {
      if (depth > MAX_STORAGE_DEPTH) return [];
      const found: string[] = [];
      // Same paging rule as selectAllByUser: until an empty page, stepping by
      // what came back, so a server-side cap below PAGE cannot truncate.
      for (let offset = 0; ; ) {
        const { data: list, error } = await sb.storage
          .from(bucket).list(prefix, { limit: PAGE, offset });
        if (error) {
          console.error(`[delete-account] storage list ${bucket}/${prefix} (offset ${offset}) failed; objects under it may remain:`, error.message);
          storageListErrors++;
          break;
        }
        if (!list || list.length === 0) break;
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
        offset += list.length;
      }
      return found;
    };

    const removePaths = async (bucket: string, paths: string[]) => {
      const unique = [...new Set(paths.filter(p => p.length > 0))];
      for (let i = 0; i < unique.length; i += PAGE) {
        const chunk = unique.slice(i, i + PAGE);
        const { data, error } = await sb.storage.from(bucket).remove(chunk);
        if (error) {
          console.error(`[delete-account] storage remove ${bucket} failed; ${chunk.length} object(s) may remain:`, error.message);
          storageRemoveErrors++;
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
        // other ten, and must not stop step 4 (see FAILURE CONTRACT).
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

    // ── 4. Delete the auth.users row LAST. Once this row is gone the user's
    //    JWT is invalid and any subsequent retry would 401, so every earlier
    //    exit leaves the login in place for a re-attempt.
    const { error: authErr } = await sb.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error('[delete-account] auth.users delete failed:', authErr);
      return json({
        success: false,
        error: `Could not delete the account record: ${authErr.message}. Your data was removed but the login still exists. Contact support to finish removal.`,
      }, 500);
    }

    return json({
      success: true,
      tablesCleared: USER_SCOPED_TABLES.length + TENANT_SCOPED_DELETES.length,
      storageObjectsRemoved,
      // Prefixes whose list() failed (their objects may remain; support can
      // re-sweep by uid). Counts only — no path, no id, ever.
      storageListErrors,
      // remove() batches that failed (their objects are still there).
      storageRemoveErrors,
      // Claimed portal ids that also resolved to another tenant's project and
      // were therefore NOT used as delete keys. Non-zero means someone wrote a
      // foreign portal id into this account's client_portal.
      portalCollisions,
      // Ids that did not match SAFE_DELETE_KEY and were dropped before they
      // could become a filter value. Non-zero on a real account means someone
      // hand-wrote a `.in()` splice payload into a portal id or a
      // sub_portal_links.id. The VALUE is never logged or returned — it
      // carries the victim's id.
      malformedIds,
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
