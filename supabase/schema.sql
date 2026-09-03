-- =============================================================================
-- MAGE ID — public schema reference
-- =============================================================================
--
-- GENERATED on 2026-09-03 by introspecting the LIVE production Supabase
-- database, project ref `nteoqhcswappxxjlpvap`, schema `public`.
--
-- The security migrations applied directly to production on 2026-09-02 and the
-- feature migrations applied on 2026-09-03 are both reflected here (see the two
-- "WHAT CHANGED IN THE ... REGENERATION" blocks below).
--
-- WHAT THIS FILE IS
--   A reference artifact. It is a human- and tool-readable description of what
--   production actually looks like, produced from the system catalogs
--   (pg_class, pg_attribute, pg_constraint, pg_indexes, pg_policies,
--   pg_get_triggerdef, pg_get_functiondef).
--
-- WHAT THIS FILE IS *NOT*
--   It is NOT a restore script and must not be treated as one. It is not
--   ordered for dependency-safe replay, it does not create extensions, roles,
--   grants, ownership, sequences-as-standalone-objects, comments, publications,
--   or anything outside the `public` schema. Do not `psql -f` this at a
--   database and expect it to work.
--
-- CONTENTS
--   1. Tables            — 108  (columns, types, NOT NULL, DEFAULTs)
--   2. Constraints       — 356  (108 PK, 134 FK w/ ON DELETE, 16 UNIQUE, 98 CHECK)
--   3. Indexes           — 352 total in pg_indexes; 228 emitted here
--                          (124 are the implicit indexes backing the PK/UNIQUE
--                           constraints already emitted in section 2 and are
--                           deliberately skipped so the file does not duplicate)
--   4. Row Level Security — enabled on all 108 tables
--   5. RLS policies      — 337
--   6. Triggers          — 56
--   7. Functions         — 200 routines exist in `public`; 82 emitted here
--                          (full bodies, incl. 59 SECURITY DEFINER RPCs).
--                          The other 118 belong to the `vector` (pgvector)
--                          extension, which is installed into `public`:
--                          114 C functions + 4 aggregates. They are
--                          extension-owned, recreated by CREATE EXTENSION,
--                          and deliberately not reproduced. See section 7.
--
--   Deliberately excluded: row data; the `auth`, `storage`, `vault`,
--   `extensions`, `graphql` and all other non-`public` schemas.
--   Production has 0 views and 0 enum types in `public`.
--
-- NOTE ON TRIGGER COUNT
--   Count triggers with `pg_trigger` where NOT `tgisinternal`. That is 56, and
--   56 are emitted below. Do NOT count `information_schema.triggers`: it emits
--   one row per event, so a trigger declared `INSERT OR UPDATE` appears twice
--   and a `INSERT OR DELETE OR UPDATE` three times. It currently returns 60
--   rows for the same 56 distinct triggers. (Before the 2026-09-02 migrations
--   the numbers were 52 real / 56 information_schema rows, which is how an
--   earlier audit talked itself into a wrong tally.)
--
-- WHY THIS FILE IS REGENERATED
--   The previous committed version of `supabase/schema.sql` was stale and was
--   treated as authoritative. During an audit on 2026-08-31 two separate
--   verification agents read it and filed FALSE bug reports, concluding that
--   `plan_sheets.revision` / `previous_sheet_id` / `superseded` and
--   `companies.service_states` / `service_radius_miles` / `service_origin_lat`
--   / `service_origin_lng` did not exist. All of those columns do exist in
--   production. Only the agent that introspected the live database was right.
--   If you are about to conclude from this file that something is missing,
--   check the live database first, and if this file is wrong, regenerate it.
--
--   The 2026-09-02 regeneration was needed for the opposite reason: the file
--   was accurate on 2026-08-31, then a batch of security migrations was applied
--   directly to production on 2026-09-02 and the file did not move with it. It
--   was stale in the "production moved forward" direction. Two tools parse this
--   file (`scripts/validate-rls-write-leaks.ts`, `scripts/validate-account-
--   deletion.ts`), so a stale file makes them report yesterday's truth.
--
--   The 2026-09-03 regeneration is the same story one day later: the feature
--   batch (project_financials, deliveries, building_access_rules,
--   access_reservations, portal_get_snapshot_v2, nine columns, ten indexes)
--   was applied to production on 2026-09-03 and the file did not move with it.
--
-- WHAT CHANGED IN THE 2026-09-02 REGENERATION
--   Deltas vs the 2026-08-31 file. Sections 1, 2a, 3 and 4 are unchanged.
--     * 2b — `subscriptions_tier_check` now admits 'enterprise'.
--     * 2c — six FKs to `auth.users` retargeted to ON DELETE CASCADE:
--            `companies`, `job_listings`, `public_bids`, `worker_profiles`
--            (were ON DELETE SET NULL) and both `project_collaborators` FKs
--            (`user_id`, `invited_by`, which previously had no ON DELETE
--            action at all, i.e. NO ACTION).
--     * 5  — +1 policy (320 -> 321): new `gc stamps own CO approvals` on
--            `change_order_approvals`. Two existing UPDATE policies had their
--            WITH CHECK tightened to re-assert `auth.uid()` ownership rather
--            than only constraining `status`: `gc can update own proposals`
--            and `gc updates sub invoices for own portals`. Those two were the
--            RLS write leaks; they are closed in production as of this file.
--     * 6  — +4 triggers (52 -> 56): `projects_freeze_ownership`,
--            `sub_submitted_invoices_freeze`, `portal_budget_proposals_freeze`,
--            `change_order_approvals_freeze`.
--     * 7  — +4 functions (76 -> 80), the trigger functions backing those
--            triggers: `projects_freeze_ownership_columns`,
--            `sub_invoice_freeze_columns`, `portal_proposal_freeze_project`,
--            `co_approval_freeze_evidence`. `grant_rfp_post_credit` gained a
--            `service_role` guard that raises SQLSTATE 42501.
--   Formatting-only: six objects were missing the blank separator line before
--   them in the 2026-08-31 file — tables `cost_benchmark_samples`, `messages`,
--   `rate_overrides` and functions `fire_notify`, `notify_sub_invoice_fn`,
--   `resolve_sub_invoice_project`. Corrected here. No content changed.
--
-- WHAT CHANGED IN THE 2026-09-03 REGENERATION
--   Deltas vs the 2026-09-02 file: the feature batch applied to production on
--   2026-09-03 (see DEPLOY-VERIFIED-2026-09-02.md). Section 6 is unchanged;
--   every other section grew.
--     * 1  — +4 tables (104 -> 108): `access_reservations`,
--            `building_access_rules`, `deliveries`, `project_financials`.
--            +9 columns on existing tables: `delivery_receipts.delivery_id`;
--            `portal_snapshots.expires_at`, `.link_duration_days`;
--            `rfis.assigned_sub_id`, `.ball_in_court`, `.handoffs`;
--            `sub_submitted_invoices.payment_method`, `.payment_reference`,
--            `.paid_on`.
--     * 2a — +4 PRIMARY KEYs, one per new table (120 -> 124 rows).
--     * 2b — +6 CHECKs (92 -> 98): `access_reservations_kind_check`,
--            `access_reservations_status_check`,
--            `building_access_rules_badge_lead_time_days_check`,
--            `deliveries_status_check`,
--            `portal_snapshots_link_duration_days_positive`,
--            `sub_submitted_invoices_payment_method_check` (NOT VALID).
--     * 2c — +8 FKs (126 -> 134): each new table has `project_id ->
--            projects(id)` and `user_id -> auth.users(id)`, all ON DELETE
--            CASCADE, so validate-account-deletion stays green.
--     * 3  — +10 indexes (218 -> 228 emitted; 338 -> 352 in pg_indexes):
--            `access_reservations_delivery_idx`, `access_reservations_open_idx`,
--            `delay_events_open_notice_idx`, `deliveries_open_expected_idx`,
--            `deliveries_project_idx`, `delivery_receipts_delivery_idx`,
--            `portal_snapshots_expires_at_idx`, `project_financials_user_id_idx`,
--            `rfis_assigned_sub_id_idx`, `sub_submitted_invoices_paid_on_idx`.
--     * 4  — RLS enabled on the 4 new tables (104 -> 108).
--     * 5  — +16 policies (321 -> 337): four per new table (collab insert /
--            select / update + owner delete on `access_reservations`,
--            `building_access_rules`, `deliveries`; select / insert / update /
--            delete on `project_financials`).
--     * 7  — +2 functions (80 -> 82), both SECURITY DEFINER (57 -> 59):
--            `can_view_project_financials(uuid)` and
--            `portal_get_snapshot_v2(text, text)`.
--   NOT in production and therefore not here: `cost_seeds.deleted_at` (that
--   half of 20260826150000 was deliberately not applied), the
--   `portal_link_expiry_cron` job, and phase 2 of the project_financials split
--   (`projects.estimate` / `linked_estimate` / `estimate_versions` /
--   `target_budget` are still on `projects`, by design, until the OTA is live).
--
-- HOW THIS FILE WAS VERIFIED
--   Each section was rendered server-side from the catalog and MD5'd, and the
--   same MD5 was computed over the corresponding line range of this file. All
--   nine sections (1, 2a, 2b, 2c, 3, 4, 5, 6, 7) match byte-for-byte. So this
--   file is not merely "believed current" — it is a checked reproduction of
--   `public` as of 2026-09-03. Re-verify the same way after any change.
--   Three things the 2026-09-03 re-run learned, so the next one does not:
--     * hash the section BODY only (first object line to last), joined with
--       the generator's separators — a blank line between tables and between
--       functions, none between one-line objects — not the commented headers.
--     * the server's length() counts characters; section 7 carries non-ASCII
--       in function comments, so its byte length on disk is a few bytes more
--       than the length the server reports. Only the MD5 is the verdict.
--     * new objects go where the server's ORDER BY puts them. The first pass
--       slotted `portal_get_snapshot_v2` after `portal_project_for_token`; all
--       82 function blocks matched individually while the section did not.
--
-- ORDERING
--   Every section is sorted alphabetically so that future regenerations
--   produce readable diffs.
--
-- =============================================================================


-- =============================================================================
-- SECTION 1 — TABLES (108)
-- =============================================================================

CREATE TABLE public.access_reservations (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    kind text NOT NULL,
    date date NOT NULL,
    reservation_window text,
    status text DEFAULT 'requested'::text NOT NULL,
    confirmation_ref text,
    delivery_id uuid,
    requested_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ai_daily_usage (
    user_id uuid NOT NULL,
    usage_date date NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    smart_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.ai_usage_counters (
    user_id uuid NOT NULL,
    month_bucket date NOT NULL,
    feature text NOT NULL,
    count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.aia_pay_apps (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    invoice_id text,
    application_number integer DEFAULT 1 NOT NULL,
    application_date date,
    period_to date,
    contract_date date,
    owner_name text,
    contractor_name text,
    architect_name text,
    project_name text,
    project_location text,
    contract_for_description text,
    original_contract_sum numeric DEFAULT 0 NOT NULL,
    net_change_by_co numeric DEFAULT 0 NOT NULL,
    contract_sum_to_date numeric DEFAULT 0 NOT NULL,
    retainage_percent numeric DEFAULT 10 NOT NULL,
    less_previous_certificates numeric DEFAULT 0 NOT NULL,
    lines jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    snapshot_totals jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    portal_state jsonb,
    paid_at timestamp with time zone,
    payment_intent_id text,
    certified_at timestamp with time zone
);

CREATE TABLE public.app_config (
    key text NOT NULL,
    value text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.assemblies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    description text,
    unit text NOT NULL,
    materials jsonb DEFAULT '[]'::jsonb NOT NULL,
    labor jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    is_system boolean DEFAULT false,
    is_custom boolean DEFAULT false,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.bid_package_bids (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    package_id uuid NOT NULL,
    subcontractor_id uuid,
    vendor_name text,
    amount numeric DEFAULT 0 NOT NULL,
    includes text,
    excludes text,
    terms text,
    source text,
    status text DEFAULT 'received'::text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    normalized_adjustment numeric,
    normalized_adjustment_reason text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bid_packages (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    csi_division text,
    phase text,
    scope_description text,
    linked_estimate_item_ids jsonb DEFAULT '[]'::jsonb,
    estimate_budget numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    due_date timestamp with time zone,
    required_by_date timestamp with time zone,
    awarded_bid_id uuid,
    awarded_commitment_id uuid,
    buyout_savings numeric,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bid_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bid_id uuid NOT NULL,
    asker_user_id uuid NOT NULL,
    asker_name text,
    question text NOT NULL,
    answer text,
    answered_at timestamp with time zone,
    is_public boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.bid_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    bid_id uuid NOT NULL,
    company_name text,
    bid_amount numeric,
    duration_estimate text,
    scope_description text,
    availability_date text,
    proposal_uri text,
    status text DEFAULT 'submitted'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    proposer_company_id uuid,
    proposer_email text,
    proposer_phone text,
    estimate_summary text,
    estimate_breakdown jsonb DEFAULT '[]'::jsonb,
    view_site_requested boolean DEFAULT false,
    responded_at timestamp with time zone,
    awarded_project_id uuid
);

CREATE TABLE public.brain_predictions (
    id uuid NOT NULL,
    user_id uuid DEFAULT auth.uid() NOT NULL,
    project_id text,
    kind text NOT NULL,
    subject_id text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    predicted_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    outcome jsonb
);

CREATE TABLE public.building_access_rules (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    building_contact text,
    building_phone text,
    requires_freight_elevator boolean DEFAULT false NOT NULL,
    requires_dock_reservation boolean DEFAULT false NOT NULL,
    requires_coi_on_file boolean DEFAULT false NOT NULL,
    coi_on_file_at date,
    requires_badging boolean DEFAULT false NOT NULL,
    badge_lead_time_days integer,
    work_hours text,
    after_hours_requires_approval boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cached_bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notice_id text NOT NULL,
    title text NOT NULL,
    description text,
    solicitation_number text,
    department text,
    posted_date timestamp with time zone,
    response_deadline timestamp with time zone,
    naics_code text,
    set_aside text,
    estimated_value numeric,
    city text,
    state text,
    latitude double precision,
    longitude double precision,
    source_url text,
    fetched_at timestamp with time zone DEFAULT now(),
    bid_type text,
    category text DEFAULT 'construction'::text,
    bond_required numeric DEFAULT 0,
    contact_email text,
    contact_phone text,
    apply_url text,
    source_name text,
    posted_by text,
    pre_bid_date timestamp with time zone,
    pre_bid_location text,
    scope_of_work text,
    documents_url text,
    required_certifications text[] DEFAULT '{}'::text[]
);

CREATE TABLE public.cached_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    place_id text NOT NULL,
    name text NOT NULL,
    trade_specialty text,
    address text,
    city text,
    state text,
    phone text,
    website text,
    rating real,
    total_reviews integer,
    latitude double precision,
    longitude double precision,
    photo_url text,
    fetched_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.cached_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_id text NOT NULL,
    title text NOT NULL,
    company_name text,
    description text,
    trade_category text,
    salary_min numeric,
    salary_max numeric,
    contract_type text,
    city text,
    state text,
    latitude double precision,
    longitude double precision,
    apply_url text,
    posted_date timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.certifications (
    id text NOT NULL,
    user_id uuid NOT NULL,
    worker_id text,
    holder_name text,
    sub_id text,
    type text DEFAULT ''::text NOT NULL,
    issued_date text,
    expires_date text,
    document_url text,
    status text DEFAULT 'valid'::text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.change_order_approvals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portal_id text NOT NULL,
    project_id text,
    invite_id text,
    change_order_id text NOT NULL,
    decision text NOT NULL,
    signer_name text,
    signer_email text,
    signature_data text,
    note text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    synced_to_co_at timestamp with time zone,
    signature_hash text,
    consent_record text,
    document_hash text,
    consent_version text,
    consent_accepted boolean,
    sealed_at timestamp with time zone
);

CREATE TABLE public.change_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    date text NOT NULL,
    description text DEFAULT ''::text,
    reason text DEFAULT ''::text,
    line_items jsonb DEFAULT '[]'::jsonb,
    original_contract_value numeric DEFAULT 0,
    change_amount numeric DEFAULT 0,
    new_contract_total numeric DEFAULT 0,
    status text DEFAULT 'draft'::text,
    approvers jsonb,
    approval_mode text DEFAULT 'sequential'::text,
    approval_deadline_days integer,
    audit_trail jsonb DEFAULT '[]'::jsonb,
    revision integer DEFAULT 1,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    portal_state jsonb,
    schedule_impact_days integer,
    schedule_impact_applied boolean DEFAULT false NOT NULL,
    schedule_impact_task_ids jsonb,
    schedule_anchor_task_id text
);

CREATE TABLE public.city_coords (
    city text NOT NULL,
    state text NOT NULL,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    geocoded_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'google_geocoding'::text
);

CREATE TABLE public.closeout_binders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    pdf_url text,
    html text,
    maintenance_schedule jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    finalized_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.cois (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    subcontractor_id text NOT NULL,
    project_id uuid,
    file_uri text NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now() NOT NULL,
    validation jsonb,
    coverages jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.comm_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    type text NOT NULL,
    summary text DEFAULT ''::text,
    actor text DEFAULT ''::text,
    recipient text,
    detail text,
    is_private boolean DEFAULT false,
    "timestamp" timestamp with time zone DEFAULT now()
);

CREATE TABLE public.commitments (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number text NOT NULL,
    type text NOT NULL,
    subcontractor_id text,
    vendor_name text,
    description text DEFAULT ''::text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    change_amount numeric,
    signed_date date,
    phase text,
    csi_division text,
    linked_estimate_items jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_to_date numeric DEFAULT 0 NOT NULL
);

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    company_name text NOT NULL,
    city text DEFAULT ''::text,
    state text DEFAULT ''::text,
    primary_category text DEFAULT 'construction'::text,
    bond_capacity numeric DEFAULT 0,
    completed_projects integer DEFAULT 0,
    rating numeric DEFAULT 0,
    contact_email text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    description text DEFAULT ''::text,
    certifications jsonb DEFAULT '[]'::jsonb,
    website text,
    year_established integer,
    employee_count integer,
    created_at timestamp with time zone DEFAULT now(),
    service_states jsonb DEFAULT '[]'::jsonb,
    service_radius_miles integer DEFAULT 25,
    service_origin_lat numeric,
    service_origin_lng numeric
);

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    first_name text NOT NULL,
    last_name text DEFAULT ''::text,
    company_name text DEFAULT ''::text,
    role text DEFAULT 'Other'::text,
    email text DEFAULT ''::text,
    secondary_email text,
    phone text DEFAULT ''::text,
    address text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    linked_project_ids jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.contractor_licenses (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    license_number text,
    license_type text NOT NULL,
    jurisdiction text NOT NULL,
    issued_date date,
    expires_date date NOT NULL,
    document_uri text,
    subcontractor_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.conversation_participants (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    joined_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    participant_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    participant_names jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_message text DEFAULT ''::text,
    last_message_time timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.cost_benchmark_samples (
    user_id uuid NOT NULL,
    category text NOT NULL,
    unit text NOT NULL,
    region text DEFAULT 'US'::text NOT NULL,
    unit_price numeric NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    public_index_opt_in boolean DEFAULT false NOT NULL
);

CREATE TABLE public.cost_seeds (
    id text NOT NULL,
    user_id uuid NOT NULL,
    trade text NOT NULL,
    unit text NOT NULL,
    rate numeric NOT NULL,
    reported_jobs integer,
    as_of text,
    note text,
    method text DEFAULT 'paste'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.crew_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    full_name text NOT NULL,
    trades jsonb DEFAULT '[]'::jsonb,
    phone text,
    email text,
    photo_url text,
    status text DEFAULT 'active'::text,
    id_verified boolean DEFAULT false,
    id_type text,
    id_masked_last4 text,
    id_expiry text,
    id_issuer text,
    id_scanned_at timestamp with time zone,
    id_image_path text,
    claim_token text,
    claimed_by_user_id uuid,
    claimed_at timestamp with time zone,
    is_public boolean DEFAULT false,
    marketplace_profile_id uuid,
    project_ids jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.daily_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    date text NOT NULL,
    weather jsonb DEFAULT '{}'::jsonb,
    manpower jsonb DEFAULT '[]'::jsonb,
    work_performed text DEFAULT ''::text,
    materials_delivered jsonb DEFAULT '[]'::jsonb,
    issues_and_delays text DEFAULT ''::text,
    photos jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'draft'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    homeowner_summary text,
    homeowner_summary_generated_at timestamp with time zone,
    homeowner_summary_published boolean DEFAULT false NOT NULL,
    portal_state jsonb,
    incident jsonb,
    work_progress jsonb
);

CREATE TABLE public.delay_events (
    id text NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    number integer DEFAULT 1 NOT NULL,
    cause text DEFAULT 'other'::text NOT NULL,
    first_observed_date text NOT NULL,
    ended_date text,
    description text DEFAULT ''::text NOT NULL,
    evidence jsonb DEFAULT '[]'::jsonb NOT NULL,
    impacted_task_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    claimed_days integer DEFAULT 0 NOT NULL,
    concurrent_days integer,
    notices jsonb DEFAULT '[]'::jsonb NOT NULL,
    classification text DEFAULT 'unclassified'::text NOT NULL,
    change_order_id text,
    audit_trail jsonb,
    sealed_at timestamp with time zone,
    content_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.deliveries (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    description text NOT NULL,
    supplier text NOT NULL,
    commitment_id uuid,
    po_number text,
    expected_date date NOT NULL,
    delivery_window text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    confirmed_at timestamp with time zone,
    delivered_at timestamp with time zone,
    receipt_id uuid,
    location text,
    received_by text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.delivery_receipts (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    date date NOT NULL,
    supplier text NOT NULL,
    po_number text,
    commitment_id uuid,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    bol_photo_uri text,
    signature_photo_uri text,
    has_damage boolean DEFAULT false NOT NULL,
    damage_notes text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    received_by text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    delivery_id uuid
);

CREATE TABLE public.draw_periods (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    label text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    aia_pay_app_id uuid,
    invoice_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    lien_waiver_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    amount_requested numeric(12,2),
    amount_approved numeric(12,2),
    amount_funded numeric(12,2),
    submitted_at timestamp with time zone,
    approved_at timestamp with time zone,
    funded_at timestamp with time zone,
    closed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.drawing_pins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_sheet_id uuid NOT NULL,
    x numeric NOT NULL,
    y numeric NOT NULL,
    kind text NOT NULL,
    label text,
    color text,
    linked_photo_id uuid,
    linked_punch_item_id uuid,
    linked_rfi_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.email_unsubscribes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    event_key text,
    unsubscribed_at timestamp with time zone DEFAULT now() NOT NULL,
    source text
);

CREATE TABLE public.equipment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    type text DEFAULT 'owned'::text,
    category text DEFAULT 'other'::text,
    make text DEFAULT ''::text,
    model text DEFAULT ''::text,
    year integer,
    serial_number text,
    daily_rate numeric DEFAULT 0,
    current_project_id text,
    maintenance_schedule jsonb DEFAULT '[]'::jsonb,
    utilization_log jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'available'::text,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.estimate_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id text NOT NULL,
    user_id uuid NOT NULL,
    version_number integer DEFAULT 1,
    name text,
    notes text,
    estimate_data jsonb NOT NULL,
    materials_total numeric DEFAULT 0,
    labor_total numeric DEFAULT 0,
    grand_total numeric DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.feature_interest (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.field_tickets (
    id text NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    number integer DEFAULT 1 NOT NULL,
    date text NOT NULL,
    work_description text DEFAULT ''::text NOT NULL,
    reason_extra text DEFAULT ''::text NOT NULL,
    source_daily_report_id text,
    labor jsonb DEFAULT '[]'::jsonb NOT NULL,
    materials jsonb DEFAULT '[]'::jsonb NOT NULL,
    equipment jsonb DEFAULT '[]'::jsonb NOT NULL,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    markup_percent numeric(6,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    "authorization" jsonb,
    converted_change_order_id text,
    converted_at timestamp with time zone,
    audit_trail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.financing_referrals (
    id text NOT NULL,
    project_id uuid,
    gc_user_id uuid NOT NULL,
    partner_name text DEFAULT ''::text NOT NULL,
    amount_cents integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'created'::text NOT NULL,
    source text DEFAULT 'invoice'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.geocode_run_lock (
    id integer DEFAULT 1 NOT NULL,
    last_started_at timestamp with time zone
);

CREATE TABLE public.hazards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    description text NOT NULL,
    location text DEFAULT ''::text,
    photo_url text,
    severity integer DEFAULT 1,
    likelihood integer DEFAULT 1,
    risk_score integer DEFAULT 1,
    plan_sheet_id text,
    pin_x double precision,
    pin_y double precision,
    assigned_to text,
    due_date text,
    corrective_action text,
    status text DEFAULT 'open'::text,
    source_inspection_id text,
    created_by text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    source_item_id text
);

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    type text DEFAULT 'full'::text,
    progress_percent numeric,
    issue_date text NOT NULL,
    due_date text NOT NULL,
    payment_terms text DEFAULT 'net_30'::text,
    notes text DEFAULT ''::text,
    line_items jsonb DEFAULT '[]'::jsonb,
    subtotal numeric DEFAULT 0,
    tax_rate numeric DEFAULT 0,
    tax_amount numeric DEFAULT 0,
    total_due numeric DEFAULT 0,
    amount_paid numeric DEFAULT 0,
    status text DEFAULT 'draft'::text,
    payments jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    dunning_stage integer,
    dunning_last_sent_at timestamp with time zone,
    qbo_id text,
    qbo_hash text,
    qbo_synced_at timestamp with time zone,
    qbo_sync_status text,
    qbo_error text,
    qbo_retry_count integer DEFAULT 0,
    portal_state jsonb,
    retention_percent numeric,
    retention_amount numeric,
    retention_released numeric,
    retention_releases jsonb,
    pay_link_url text,
    pay_link_id text,
    source_milestone_id text,
    source_contract_id text
);

CREATE TABLE public.jhas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    title text NOT NULL,
    trade text DEFAULT ''::text,
    task_description text DEFAULT ''::text,
    date text DEFAULT ''::text,
    steps jsonb DEFAULT '[]'::jsonb,
    required_ppe jsonb DEFAULT '[]'::jsonb,
    sign_offs jsonb DEFAULT '[]'::jsonb,
    plan_sheet_id text,
    pin_x double precision,
    pin_y double precision,
    ai_generated boolean DEFAULT false,
    status text DEFAULT 'draft'::text,
    created_by text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.job_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    company_id text DEFAULT ''::text,
    company_name text DEFAULT ''::text,
    title text NOT NULL,
    trade_category text NOT NULL,
    city text DEFAULT ''::text,
    state text DEFAULT ''::text,
    pay_min numeric DEFAULT 0,
    pay_max numeric DEFAULT 0,
    pay_type text DEFAULT 'hourly'::text,
    job_type text DEFAULT 'full_time'::text,
    required_licenses jsonb DEFAULT '[]'::jsonb,
    experience_level text DEFAULT 'mid'::text,
    description text DEFAULT ''::text,
    start_date text DEFAULT ''::text,
    posted_date text NOT NULL,
    status text DEFAULT 'open'::text,
    applicant_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.labor_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trade text NOT NULL,
    trade_code text,
    region text NOT NULL,
    state text,
    metro_area text,
    hourly_rate_low numeric,
    hourly_rate_median numeric,
    hourly_rate_high numeric,
    annual_salary_median numeric,
    employment_count integer,
    source text DEFAULT 'bls_oews_2024'::text,
    data_year integer DEFAULT 2024,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.leads (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    phone text,
    email text,
    address text,
    project_type text,
    project_type_mapped text,
    scope text,
    budget_min numeric,
    budget_max numeric,
    timeline text,
    source text DEFAULT 'other'::text NOT NULL,
    source_other text,
    stage text DEFAULT 'new'::text NOT NULL,
    score integer,
    score_reason text,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    first_responded_at timestamp with time zone,
    touches jsonb,
    converted_project_id uuid,
    lost_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.lien_waivers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    commitment_id uuid,
    invoice_id uuid,
    waiver_type text NOT NULL,
    sub_company_id uuid,
    sub_name text NOT NULL,
    sub_email text,
    through_date text NOT NULL,
    paid_amount numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    sub_signature jsonb,
    signed_at timestamp with time zone,
    signed_pdf_url text,
    notes text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.material_prices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    material_key text NOT NULL,
    name text NOT NULL,
    category text NOT NULL,
    unit text,
    price numeric NOT NULL,
    bulk_price numeric,
    store_name text,
    store_zip text,
    sku text,
    product_url text,
    image_url text,
    source text DEFAULT 'home_depot'::text,
    region text,
    in_stock boolean DEFAULT true,
    rating numeric,
    review_count integer,
    fetched_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '7 days'::interval)
);

CREATE TABLE public.materials_pricing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    region text NOT NULL,
    material_name text NOT NULL,
    category text NOT NULL,
    unit text NOT NULL,
    retail_price numeric NOT NULL,
    bulk_price numeric NOT NULL,
    bulk_min_qty integer DEFAULT 1,
    supplier text DEFAULT ''::text,
    last_updated timestamp with time zone DEFAULT now()
);

CREATE TABLE public.mcp_tokens (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    token_prefix text NOT NULL,
    name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    expires_at timestamp with time zone DEFAULT (now() + '1 year'::interval)
);

CREATE TABLE public.memory_embeddings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    doc_id text NOT NULL,
    source text NOT NULL,
    ref text NOT NULL,
    content text NOT NULL,
    embedding vector(768) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_name text DEFAULT ''::text,
    text text NOT NULL,
    "timestamp" timestamp with time zone DEFAULT now()
);

CREATE TABLE public.notification_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_type text NOT NULL,
    source_table text,
    source_id text,
    recipient_kind text NOT NULL,
    recipient_user_id uuid,
    recipient_email text,
    push_token text,
    push_status text,
    push_response jsonb,
    email_status text,
    email_response jsonb,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone
);

CREATE TABLE public.oac_meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    duration_minutes integer,
    location text,
    attendees jsonb DEFAULT '[]'::jsonb,
    agenda jsonb DEFAULT '[]'::jsonb,
    action_items jsonb DEFAULT '[]'::jsonb,
    transcript text,
    minutes text,
    status text DEFAULT 'draft'::text,
    distributed_at timestamp with time zone,
    distribution_log jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.owner_supplied_items (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    mode text NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    description text NOT NULL,
    brand text,
    model text,
    sku text,
    vendor text,
    cost_basis numeric(12,2),
    need_by date,
    delivery_at timestamp with time zone,
    installed_at timestamp with time zone,
    linked_task_id uuid,
    linked_selection_id uuid,
    photos jsonb DEFAULT '[]'::jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.permit_templates (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    jurisdiction text NOT NULL,
    scope_template text,
    typical_fee numeric(10,2),
    phase text,
    special_inspection_category text,
    notes text,
    use_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.permits (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    project_name text,
    type text NOT NULL,
    permit_number text,
    jurisdiction text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'applied'::text NOT NULL,
    applied_date date,
    approved_date date,
    expires_date date,
    inspection_date date,
    inspection_notes text,
    fee numeric DEFAULT 0 NOT NULL,
    notes text,
    phase text,
    attachment_uri text,
    special_inspection_category text,
    inspector_name text,
    last_report_summary text,
    last_report_date date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    uri text NOT NULL,
    "timestamp" text NOT NULL,
    location text,
    tag text,
    linked_task_id text,
    linked_task_name text,
    markup jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    portal_state jsonb
);

CREATE TABLE public.plan_calibrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_sheet_id uuid NOT NULL,
    p1 jsonb NOT NULL,
    p2 jsonb NOT NULL,
    real_distance_ft numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.plan_markups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plan_sheet_id uuid NOT NULL,
    type text NOT NULL,
    color text DEFAULT '#FF0000'::text NOT NULL,
    stroke_width numeric,
    points jsonb DEFAULT '[]'::jsonb NOT NULL,
    text text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.plan_sheets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    sheet_number text,
    image_uri text NOT NULL,
    page_number integer,
    width numeric,
    height numeric,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    revision integer DEFAULT 1,
    previous_sheet_id text,
    superseded boolean DEFAULT false
);

CREATE TABLE public.portal_budget_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portal_id text NOT NULL,
    project_id text,
    invite_id text,
    amount numeric NOT NULL,
    note text,
    proposer_name text,
    proposer_email text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone
);

CREATE TABLE public.portal_decision_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portal_id text NOT NULL,
    project_id uuid,
    action text NOT NULL,
    detail jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.portal_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    portal_id text NOT NULL,
    project_id text,
    invite_id text,
    author_type text NOT NULL,
    author_name text,
    author_email text,
    body text NOT NULL,
    read_by_gc boolean DEFAULT false,
    read_by_client boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.portal_snapshots (
    portal_id text NOT NULL,
    project_id uuid,
    snapshot jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    link_duration_days integer
);

CREATE TABLE public.prequal_packets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    subcontractor_id text NOT NULL,
    project_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    criteria jsonb DEFAULT '{}'::jsonb NOT NULL,
    financials jsonb DEFAULT '{}'::jsonb NOT NULL,
    safety jsonb DEFAULT '{}'::jsonb NOT NULL,
    insurance jsonb DEFAULT '{}'::jsonb NOT NULL,
    licenses jsonb DEFAULT '[]'::jsonb NOT NULL,
    w9_on_file boolean DEFAULT false NOT NULL,
    w9_doc_path text,
    invite_token text,
    invite_sent_at timestamp with time zone,
    invite_email text,
    submitted_at timestamp with time zone,
    reviewed_at timestamp with time zone,
    reviewed_by text,
    auto_review_findings jsonb,
    reviewer_notes text,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.price_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    material_id text NOT NULL,
    material_name text NOT NULL,
    target_price numeric NOT NULL,
    direction text DEFAULT 'below'::text,
    current_price numeric DEFAULT 0,
    is_triggered boolean DEFAULT false,
    is_paused boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.pro_responses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rfi_id uuid,
    submittal_id uuid,
    share_token uuid NOT NULL,
    responder_name text,
    responder_email text,
    responder_role text,
    response_body text NOT NULL,
    action_code text,
    attachment_urls jsonb DEFAULT '[]'::jsonb,
    ip_address text,
    user_agent text,
    submitted_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    avatar_url text,
    company_name text DEFAULT ''::text,
    contact_name text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    address text DEFAULT ''::text,
    license_number text DEFAULT ''::text,
    tagline text DEFAULT ''::text,
    logo_uri text,
    signature_data jsonb,
    location text DEFAULT 'United States'::text,
    units text DEFAULT 'imperial'::text,
    tax_rate numeric DEFAULT 7.5,
    contingency_rate numeric DEFAULT 10,
    theme_colors jsonb,
    biometrics_enabled boolean DEFAULT false,
    dfr_recipients jsonb DEFAULT '[]'::jsonb,
    onboarding_complete boolean DEFAULT false,
    push_token text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    stripe_account_id text,
    stripe_charges_enabled boolean DEFAULT false,
    stripe_details_submitted boolean DEFAULT false,
    stripe_payouts_enabled boolean DEFAULT false,
    stripe_account_country text DEFAULT 'US'::text,
    stripe_connect_started_at timestamp with time zone,
    stripe_connect_updated_at timestamp with time zone,
    notification_preferences jsonb,
    digest_enabled boolean DEFAULT false NOT NULL,
    digest_hour smallint,
    digest_channels jsonb DEFAULT '{"email": true, "in_app": true}'::jsonb NOT NULL,
    digest_timezone text DEFAULT 'America/New_York'::text NOT NULL,
    push_token_platform text,
    push_token_updated_at timestamp with time zone,
    financing jsonb,
    user_role text,
    autonomy_preferences jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE public.project_collaborators (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    invited_email text NOT NULL,
    user_id uuid,
    role text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    invite_token text,
    invited_by uuid NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone
);

CREATE TABLE public.project_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    source_bid_id uuid,
    source_response_id uuid,
    version integer DEFAULT 1 NOT NULL,
    superseded_by uuid,
    title text DEFAULT 'Construction Agreement'::text NOT NULL,
    contract_value numeric DEFAULT 0 NOT NULL,
    start_date text,
    duration_days integer,
    scope_text text DEFAULT ''::text NOT NULL,
    terms_text text DEFAULT ''::text NOT NULL,
    warranty_text text DEFAULT ''::text NOT NULL,
    payment_schedule jsonb DEFAULT '[]'::jsonb NOT NULL,
    allowances jsonb DEFAULT '[]'::jsonb NOT NULL,
    gc_signature jsonb,
    homeowner_signature jsonb,
    status text DEFAULT 'draft'::text NOT NULL,
    sent_at timestamp with time zone,
    signed_at timestamp with time zone,
    voided_at timestamp with time zone,
    signed_pdf_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    proposal_revision_id uuid,
    kind text,
    document_hash text
);

CREATE TABLE public.project_financials (
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    estimate jsonb,
    linked_estimate jsonb,
    estimate_versions jsonb,
    target_budget jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    location text DEFAULT ''::text,
    square_footage numeric DEFAULT 0,
    quality text DEFAULT 'standard'::text,
    description text DEFAULT ''::text,
    estimate jsonb,
    schedule jsonb,
    linked_estimate jsonb,
    status text DEFAULT 'draft'::text,
    collaborators jsonb DEFAULT '[]'::jsonb,
    client_portal jsonb,
    closed_at timestamp with time zone,
    photo_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    target_budget jsonb,
    handover_checklist jsonb DEFAULT '{}'::jsonb NOT NULL,
    substantial_completion_date timestamp with time zone,
    warranty_walk_completed_at timestamp with time zone,
    location_latitude double precision,
    location_longitude double precision,
    location_geocoded_at timestamp with time zone,
    primary_contact jsonb,
    lead_source text,
    target_timeline_notes text,
    calendar_token uuid DEFAULT gen_random_uuid(),
    scope jsonb,
    estimate_versions jsonb,
    qbo_customer_id text,
    qbo_synced_at timestamp with time zone
);

CREATE TABLE public.public_bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text NOT NULL,
    issuing_agency text DEFAULT ''::text,
    city text DEFAULT ''::text,
    state text DEFAULT ''::text,
    category text DEFAULT 'construction'::text,
    bid_type text DEFAULT 'state'::text,
    estimated_value numeric DEFAULT 0,
    bond_required numeric DEFAULT 0,
    deadline text NOT NULL,
    description text DEFAULT ''::text,
    posted_by text DEFAULT ''::text,
    posted_date text NOT NULL,
    status text DEFAULT 'open'::text,
    required_certifications jsonb DEFAULT '[]'::jsonb,
    contact_email text DEFAULT ''::text,
    apply_url text,
    source_url text,
    source_name text,
    created_at timestamp with time zone DEFAULT now(),
    is_homeowner_rfp boolean DEFAULT false,
    address_line text,
    latitude numeric,
    longitude numeric,
    photo_urls jsonb DEFAULT '[]'::jsonb,
    drawing_urls jsonb DEFAULT '[]'::jsonb,
    scope_description text,
    budget_min numeric,
    budget_max numeric,
    desired_start text,
    address_verified boolean DEFAULT false,
    awarded_response_id uuid,
    awarded_at timestamp with time zone,
    verified_only boolean DEFAULT false NOT NULL
);

CREATE TABLE public.punch_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    description text NOT NULL,
    location text DEFAULT ''::text,
    assigned_sub text DEFAULT ''::text,
    assigned_sub_id text,
    due_date text NOT NULL,
    priority text DEFAULT 'medium'::text,
    status text DEFAULT 'open'::text,
    photo_uri text,
    rejection_note text,
    closed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    plan_sheet_id text,
    pin_x double precision,
    pin_y double precision,
    photo_latitude double precision,
    photo_longitude double precision,
    photo_accuracy_meters double precision,
    photo_location_label text
);

CREATE TABLE public.qbo_connections (
    user_id uuid NOT NULL,
    realm_id text NOT NULL,
    environment text DEFAULT 'production'::text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    access_expires_at timestamp with time zone NOT NULL,
    company_name text,
    status text DEFAULT 'connected'::text NOT NULL,
    last_sync_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    purchase_pull_last_at timestamp with time zone,
    bill_pull_last_at timestamp with time zone
);

CREATE TABLE public.qbo_cost_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    qbo_type text NOT NULL,
    qbo_id text NOT NULL,
    qbo_line_id text DEFAULT ''::text NOT NULL,
    doc_number text,
    vendor text,
    txn_date date,
    amount numeric NOT NULL,
    description text,
    account_name text,
    qbo_customer_ref text,
    project_id text,
    status text DEFAULT 'staged'::text NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.rate_limit_counters (
    scope text NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    count integer DEFAULT 0 NOT NULL
);

CREATE TABLE public.rate_overrides (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    override_key text NOT NULL,
    value numeric NOT NULL,
    label text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.rfis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    subject text NOT NULL,
    question text DEFAULT ''::text,
    submitted_by text DEFAULT ''::text,
    assigned_to text DEFAULT ''::text,
    date_submitted text NOT NULL,
    date_required text NOT NULL,
    date_responded text,
    response text,
    status text DEFAULT 'open'::text,
    priority text DEFAULT 'normal'::text,
    linked_drawing text,
    linked_task_id text,
    attachments jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    share_token uuid DEFAULT gen_random_uuid(),
    portal_state jsonb,
    assigned_sub_id text,
    ball_in_court text,
    handoffs jsonb
);

CREATE TABLE public.rfp_post_credits (
    user_id uuid NOT NULL,
    credits integer DEFAULT 0 NOT NULL,
    lifetime_purchased integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.rfp_post_payments (
    session_id text NOT NULL,
    user_id uuid NOT NULL,
    amount_cents integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.safety_incidents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    type text NOT NULL,
    severity text DEFAULT 'low'::text,
    occurred_at text DEFAULT ''::text,
    description text DEFAULT ''::text,
    location text DEFAULT ''::text,
    plan_sheet_id text,
    pin_x double precision,
    pin_y double precision,
    people_involved jsonb DEFAULT '[]'::jsonb,
    photo_urls jsonb DEFAULT '[]'::jsonb,
    corrective_actions jsonb DEFAULT '[]'::jsonb,
    treatment text DEFAULT 'none'::text,
    days_away integer DEFAULT 0,
    restricted_duty boolean DEFAULT false,
    lost_consciousness boolean DEFAULT false,
    fatality boolean DEFAULT false,
    osha_recordable boolean DEFAULT false,
    status text DEFAULT 'open'::text,
    reported_by text DEFAULT ''::text,
    created_by text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    days_restricted integer DEFAULT 0,
    osha_illness_type text
);

CREATE TABLE public.safety_inspections (
    id text NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    template_id text,
    title text DEFAULT ''::text NOT NULL,
    date text DEFAULT ''::text NOT NULL,
    inspector text DEFAULT ''::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    score numeric(4,3) DEFAULT 1 NOT NULL,
    status text DEFAULT 'complete'::text NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.safety_templates (
    id text NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    fields jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.scan_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    doc_type text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    file_path text DEFAULT ''::text NOT NULL,
    record_kind text DEFAULT 'file_only'::text NOT NULL,
    linked_record_id text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.selection_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    category text NOT NULL,
    style_brief text DEFAULT ''::text NOT NULL,
    budget numeric DEFAULT 0 NOT NULL,
    due_date text,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    portal_state jsonb
);

CREATE TABLE public.selection_options (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    source text DEFAULT 'ai_generated'::text NOT NULL,
    product_name text NOT NULL,
    brand text DEFAULT ''::text NOT NULL,
    sku text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image_url text,
    product_url text,
    unit_price numeric DEFAULT 0 NOT NULL,
    unit text DEFAULT 'ea'::text NOT NULL,
    quantity numeric DEFAULT 1 NOT NULL,
    total numeric DEFAULT 0 NOT NULL,
    lead_time_days integer,
    supplier text,
    highlights jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_chosen boolean DEFAULT false NOT NULL,
    chosen_at timestamp with time zone,
    chosen_by_role text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.shared_schedule_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    payload jsonb NOT NULL,
    task_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval) NOT NULL,
    last_accessed_at timestamp with time zone
);

CREATE TABLE public.sub_change_requests (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    sub_portal_id text NOT NULL,
    sub_name text NOT NULL,
    description text NOT NULL,
    amount numeric(12,2) NOT NULL,
    schedule_impact_days integer,
    photos jsonb DEFAULT '[]'::jsonb,
    notes text,
    status text DEFAULT 'submitted'::text NOT NULL,
    resulting_change_order_id uuid,
    review_notes text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sub_portal_links (
    id text NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    subcontractor_id text NOT NULL,
    passcode text,
    require_passcode boolean DEFAULT false,
    enabled boolean DEFAULT true,
    welcome_message text,
    commitment_ids jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_shared_at timestamp with time zone,
    access_token text DEFAULT encode(gen_random_bytes(24), 'hex'::text) NOT NULL
);

CREATE TABLE public.sub_portal_snapshots (
    sub_portal_id text NOT NULL,
    project_id uuid,
    snapshot jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.sub_submitted_invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sub_portal_id text NOT NULL,
    project_id text,
    subcontractor_id text,
    commitment_id text,
    invoice_number text NOT NULL,
    amount numeric NOT NULL,
    retention_amount numeric DEFAULT 0,
    description text,
    line_items jsonb,
    status text DEFAULT 'submitted'::text NOT NULL,
    submitted_by_name text,
    submitted_by_email text,
    notes_from_sub text,
    notes_from_gc text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    paid_at timestamp with time zone,
    payment_method text,
    payment_reference text,
    paid_on date
);

CREATE TABLE public.subcontractors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_name text NOT NULL,
    contact_name text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    email text DEFAULT ''::text,
    address text DEFAULT ''::text,
    trade text DEFAULT 'General'::text,
    license_number text DEFAULT ''::text,
    license_expiry text DEFAULT ''::text,
    coi_expiry text DEFAULT ''::text,
    w9_on_file boolean DEFAULT false,
    bid_history jsonb DEFAULT '[]'::jsonb,
    assigned_projects jsonb DEFAULT '[]'::jsonb,
    notes text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    coi_last_warned_at timestamp with time zone,
    coi_last_warned_threshold integer
);

CREATE TABLE public.submittals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    number integer NOT NULL,
    title text NOT NULL,
    spec_section text DEFAULT ''::text,
    submitted_by text DEFAULT ''::text,
    submitted_date text NOT NULL,
    required_date text NOT NULL,
    review_cycles jsonb DEFAULT '[]'::jsonb,
    current_status text DEFAULT 'pending'::text,
    attachments jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    share_token uuid DEFAULT gen_random_uuid(),
    portal_state jsonb
);

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tier text DEFAULT 'free'::text,
    revenuecat_customer_id text,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.time_entries (
    id text NOT NULL,
    user_id uuid NOT NULL,
    project_id text NOT NULL,
    project_name text NOT NULL,
    worker_id text NOT NULL,
    worker_name text NOT NULL,
    trade text DEFAULT ''::text NOT NULL,
    clock_in timestamp with time zone NOT NULL,
    clock_out timestamp with time zone,
    break_minutes integer DEFAULT 0 NOT NULL,
    total_hours numeric(6,2) DEFAULT 0 NOT NULL,
    overtime_hours numeric(6,2) DEFAULT 0 NOT NULL,
    status text DEFAULT 'clocked_in'::text NOT NULL,
    notes text,
    gps_lat double precision,
    gps_lng double precision,
    date text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    break_started_at timestamp with time zone
);

CREATE TABLE public.toolbox_talks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    topic text NOT NULL,
    date text DEFAULT ''::text,
    presenter text DEFAULT ''::text,
    notes text DEFAULT ''::text,
    attachment_url text,
    attendees jsonb DEFAULT '[]'::jsonb,
    ai_topic_source text,
    created_by text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.user_tracked_bids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    bid_id text NOT NULL,
    status text DEFAULT 'saved'::text,
    notes text,
    proposal_amount numeric,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.warranties (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    project_id uuid NOT NULL,
    project_name text,
    title text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    description text,
    provider text DEFAULT ''::text NOT NULL,
    provider_contact_id text,
    start_date date,
    duration_months integer DEFAULT 12 NOT NULL,
    end_date date,
    coverage_details text,
    exclusions text,
    document_uri text,
    status text DEFAULT 'active'::text NOT NULL,
    claims jsonb DEFAULT '[]'::jsonb NOT NULL,
    reminder_days integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    portal_state jsonb
);

CREATE TABLE public.wip_periods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    company_id text,
    period_end_date text NOT NULL,
    rows jsonb DEFAULT '[]'::jsonb NOT NULL,
    portfolio_totals jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    locked_at timestamp with time zone,
    created_by text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.worker_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    trade_category text NOT NULL,
    years_experience integer DEFAULT 0,
    licenses jsonb DEFAULT '[]'::jsonb,
    city text DEFAULT ''::text,
    state text DEFAULT ''::text,
    availability text DEFAULT 'available'::text,
    hourly_rate numeric DEFAULT 0,
    bio text DEFAULT ''::text,
    past_projects jsonb DEFAULT '[]'::jsonb,
    contact_email text DEFAULT ''::text,
    phone text DEFAULT ''::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE public.workers (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    trade text,
    hourly_rate numeric(10,2),
    phone text,
    email text,
    active boolean DEFAULT true NOT NULL,
    subcontractor_id uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public.zip_cost_factors (
    zip_prefix text NOT NULL,
    region text,
    city text,
    state text,
    cost_factor numeric DEFAULT 1.00,
    labor_factor numeric DEFAULT 1.00,
    material_factor numeric DEFAULT 1.00,
    source text DEFAULT 'enr_derived'::text,
    updated_at timestamp with time zone DEFAULT now()
);

-- =============================================================================
-- SECTION 2 — CONSTRAINTS (356)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 2a. PRIMARY KEY and UNIQUE constraints (108 PK + 16 UNIQUE)
-- -----------------------------------------------------------------------------

ALTER TABLE ONLY public.access_reservations ADD CONSTRAINT access_reservations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.ai_daily_usage ADD CONSTRAINT ai_daily_usage_pkey PRIMARY KEY (user_id, usage_date);
ALTER TABLE ONLY public.ai_usage_counters ADD CONSTRAINT ai_usage_counters_pkey PRIMARY KEY (user_id, month_bucket, feature);
ALTER TABLE ONLY public.aia_pay_apps ADD CONSTRAINT aia_pay_apps_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.app_config ADD CONSTRAINT app_config_pkey PRIMARY KEY (key);
ALTER TABLE ONLY public.assemblies ADD CONSTRAINT assemblies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bid_package_bids ADD CONSTRAINT bid_package_bids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bid_packages ADD CONSTRAINT bid_packages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bid_questions ADD CONSTRAINT bid_questions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.bid_responses ADD CONSTRAINT bid_responses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.brain_predictions ADD CONSTRAINT brain_predictions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.building_access_rules ADD CONSTRAINT building_access_rules_pkey PRIMARY KEY (project_id);
ALTER TABLE ONLY public.cached_bids ADD CONSTRAINT cached_bids_notice_id_key UNIQUE (notice_id);
ALTER TABLE ONLY public.cached_bids ADD CONSTRAINT cached_bids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cached_companies ADD CONSTRAINT cached_companies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cached_companies ADD CONSTRAINT cached_companies_place_id_key UNIQUE (place_id);
ALTER TABLE ONLY public.cached_jobs ADD CONSTRAINT cached_jobs_external_id_key UNIQUE (external_id);
ALTER TABLE ONLY public.cached_jobs ADD CONSTRAINT cached_jobs_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.certifications ADD CONSTRAINT certifications_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.change_order_approvals ADD CONSTRAINT change_order_approvals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.change_orders ADD CONSTRAINT change_orders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.city_coords ADD CONSTRAINT city_coords_pkey PRIMARY KEY (city, state);
ALTER TABLE ONLY public.closeout_binders ADD CONSTRAINT closeout_binders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cois ADD CONSTRAINT cois_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.comm_events ADD CONSTRAINT comm_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.commitments ADD CONSTRAINT commitments_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.companies ADD CONSTRAINT companies_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.contractor_licenses ADD CONSTRAINT contractor_licenses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.conversation_participants ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (conversation_id, user_id);
ALTER TABLE ONLY public.conversations ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.cost_benchmark_samples ADD CONSTRAINT cost_benchmark_samples_pkey PRIMARY KEY (user_id, category, unit, region);
ALTER TABLE ONLY public.cost_seeds ADD CONSTRAINT cost_seeds_pkey PRIMARY KEY (user_id, id);
ALTER TABLE ONLY public.crew_members ADD CONSTRAINT crew_members_claim_token_key UNIQUE (claim_token);
ALTER TABLE ONLY public.crew_members ADD CONSTRAINT crew_members_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.daily_reports ADD CONSTRAINT daily_reports_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.delay_events ADD CONSTRAINT delay_events_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.deliveries ADD CONSTRAINT deliveries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.delivery_receipts ADD CONSTRAINT delivery_receipts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.draw_periods ADD CONSTRAINT draw_periods_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.drawing_pins ADD CONSTRAINT drawing_pins_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.email_unsubscribes ADD CONSTRAINT email_unsubscribes_email_event_key_key UNIQUE (email, event_key);
ALTER TABLE ONLY public.email_unsubscribes ADD CONSTRAINT email_unsubscribes_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.equipment ADD CONSTRAINT equipment_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.estimate_versions ADD CONSTRAINT estimate_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.feature_interest ADD CONSTRAINT feature_interest_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.feature_interest ADD CONSTRAINT feature_interest_user_id_event_key_key UNIQUE (user_id, event_key);
ALTER TABLE ONLY public.field_tickets ADD CONSTRAINT field_tickets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.financing_referrals ADD CONSTRAINT financing_referrals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.geocode_run_lock ADD CONSTRAINT geocode_run_lock_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.hazards ADD CONSTRAINT hazards_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.jhas ADD CONSTRAINT jhas_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.job_listings ADD CONSTRAINT job_listings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.labor_rates ADD CONSTRAINT labor_rates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.lien_waivers ADD CONSTRAINT lien_waivers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.material_prices ADD CONSTRAINT material_prices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.material_prices ADD CONSTRAINT material_prices_unique_lookup UNIQUE (material_key, store_zip, source);
ALTER TABLE ONLY public.materials_pricing ADD CONSTRAINT materials_pricing_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.materials_pricing ADD CONSTRAINT materials_pricing_region_material_name_key UNIQUE (region, material_name);
ALTER TABLE ONLY public.mcp_tokens ADD CONSTRAINT mcp_tokens_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.mcp_tokens ADD CONSTRAINT mcp_tokens_token_hash_key UNIQUE (token_hash);
ALTER TABLE ONLY public.memory_embeddings ADD CONSTRAINT memory_embeddings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.memory_embeddings ADD CONSTRAINT memory_embeddings_user_id_doc_id_key UNIQUE (user_id, doc_id);
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.notification_outbox ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.oac_meetings ADD CONSTRAINT oac_meetings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.owner_supplied_items ADD CONSTRAINT owner_supplied_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.permit_templates ADD CONSTRAINT permit_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.permits ADD CONSTRAINT permits_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.photos ADD CONSTRAINT photos_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plan_calibrations ADD CONSTRAINT plan_calibrations_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plan_calibrations ADD CONSTRAINT plan_calibrations_plan_sheet_id_key UNIQUE (plan_sheet_id);
ALTER TABLE ONLY public.plan_markups ADD CONSTRAINT plan_markups_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.plan_sheets ADD CONSTRAINT plan_sheets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_budget_proposals ADD CONSTRAINT portal_budget_proposals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_decision_audit ADD CONSTRAINT portal_decision_audit_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_messages ADD CONSTRAINT portal_messages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.portal_snapshots ADD CONSTRAINT portal_snapshots_pkey PRIMARY KEY (portal_id);
ALTER TABLE ONLY public.prequal_packets ADD CONSTRAINT prequal_packets_invite_token_key UNIQUE (invite_token);
ALTER TABLE ONLY public.prequal_packets ADD CONSTRAINT prequal_packets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.price_alerts ADD CONSTRAINT price_alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pro_responses ADD CONSTRAINT pro_responses_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_invite_token_key UNIQUE (invite_token);
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_project_id_invited_email_key UNIQUE (project_id, invited_email);
ALTER TABLE ONLY public.project_contracts ADD CONSTRAINT project_contracts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_financials ADD CONSTRAINT project_financials_pkey PRIMARY KEY (project_id);
ALTER TABLE ONLY public.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.public_bids ADD CONSTRAINT public_bids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.punch_items ADD CONSTRAINT punch_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.qbo_connections ADD CONSTRAINT qbo_connections_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.qbo_cost_lines ADD CONSTRAINT qbo_cost_lines_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.qbo_cost_lines ADD CONSTRAINT qbo_cost_lines_user_id_qbo_type_qbo_id_qbo_line_id_key UNIQUE (user_id, qbo_type, qbo_id, qbo_line_id);
ALTER TABLE ONLY public.rate_limit_counters ADD CONSTRAINT rate_limit_counters_pkey PRIMARY KEY (scope, bucket_start);
ALTER TABLE ONLY public.rate_overrides ADD CONSTRAINT rate_overrides_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rfis ADD CONSTRAINT rfis_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.rfp_post_credits ADD CONSTRAINT rfp_post_credits_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY public.rfp_post_payments ADD CONSTRAINT rfp_post_payments_pkey PRIMARY KEY (session_id);
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.safety_inspections ADD CONSTRAINT safety_inspections_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.safety_templates ADD CONSTRAINT safety_templates_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.scan_records ADD CONSTRAINT scan_records_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.selection_categories ADD CONSTRAINT selection_categories_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.selection_options ADD CONSTRAINT selection_options_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.shared_schedule_snapshots ADD CONSTRAINT shared_schedule_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sub_change_requests ADD CONSTRAINT sub_change_requests_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sub_portal_links ADD CONSTRAINT sub_portal_links_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.sub_portal_snapshots ADD CONSTRAINT sub_portal_snapshots_pkey PRIMARY KEY (sub_portal_id);
ALTER TABLE ONLY public.sub_submitted_invoices ADD CONSTRAINT sub_submitted_invoices_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subcontractors ADD CONSTRAINT subcontractors_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.submittals ADD CONSTRAINT submittals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);
ALTER TABLE ONLY public.time_entries ADD CONSTRAINT time_entries_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.toolbox_talks ADD CONSTRAINT toolbox_talks_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.user_tracked_bids ADD CONSTRAINT user_tracked_bids_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.warranties ADD CONSTRAINT warranties_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.wip_periods ADD CONSTRAINT wip_periods_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.worker_profiles ADD CONSTRAINT worker_profiles_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.workers ADD CONSTRAINT workers_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.zip_cost_factors ADD CONSTRAINT zip_cost_factors_pkey PRIMARY KEY (zip_prefix);

-- -----------------------------------------------------------------------------
-- 2b. CHECK constraints (98)
-- -----------------------------------------------------------------------------

ALTER TABLE ONLY public.access_reservations ADD CONSTRAINT access_reservations_kind_check CHECK ((kind = ANY (ARRAY['freight_elevator'::text, 'dock'::text, 'after_hours'::text, 'badging'::text])));
ALTER TABLE ONLY public.access_reservations ADD CONSTRAINT access_reservations_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'confirmed'::text, 'denied'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.aia_pay_apps ADD CONSTRAINT aia_pay_apps_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.brain_predictions ADD CONSTRAINT brain_predictions_kind_check CHECK ((kind = ANY (ARRAY['pace_suggestion_applied'::text, 'delay_ripple_applied'::text, 'leak_flag'::text, 'estimate_confidence_snapshot'::text, 'judges_verdict'::text, 'instant_bid_sent'::text, 'bid_score'::text, 'leveling_adjustment'::text])));
ALTER TABLE ONLY public.building_access_rules ADD CONSTRAINT building_access_rules_badge_lead_time_days_check CHECK (((badge_lead_time_days IS NULL) OR (badge_lead_time_days >= 0)));
ALTER TABLE ONLY public.certifications ADD CONSTRAINT certifications_status_check CHECK ((status = ANY (ARRAY['valid'::text, 'expiring'::text, 'expired'::text])));
ALTER TABLE ONLY public.change_order_approvals ADD CONSTRAINT change_order_approvals_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'declined'::text])));
ALTER TABLE ONLY public.change_orders ADD CONSTRAINT change_orders_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.closeout_binders ADD CONSTRAINT closeout_binders_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'finalized'::text, 'sent'::text])));
ALTER TABLE ONLY public.cost_benchmark_samples ADD CONSTRAINT cost_benchmark_samples_unit_price_check CHECK ((unit_price >= (0)::numeric));
ALTER TABLE ONLY public.cost_seeds ADD CONSTRAINT cost_seeds_method_check CHECK ((method = ANY (ARRAY['paste'::text, 'manual'::text])));
ALTER TABLE ONLY public.cost_seeds ADD CONSTRAINT cost_seeds_rate_check CHECK (((rate > (0)::numeric) AND (rate <= (10000000)::numeric)));
ALTER TABLE ONLY public.cost_seeds ADD CONSTRAINT cost_seeds_reported_jobs_check CHECK (((reported_jobs IS NULL) OR ((reported_jobs > 0) AND (reported_jobs <= 500))));
ALTER TABLE ONLY public.crew_members ADD CONSTRAINT crew_members_id_type_check CHECK ((id_type = ANY (ARRAY['drivers_license'::text, 'state_id'::text, 'passport'::text, 'other'::text])));
ALTER TABLE ONLY public.crew_members ADD CONSTRAINT crew_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text])));
ALTER TABLE ONLY public.daily_reports ADD CONSTRAINT daily_reports_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.daily_reports ADD CONSTRAINT daily_reports_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text])));
ALTER TABLE ONLY public.delay_events ADD CONSTRAINT delay_events_cause_check CHECK ((cause = ANY (ARRAY['weather'::text, 'owner_directed_change'::text, 'late_rfi_response'::text, 'differing_site_condition'::text, 'owner_supplied_item'::text, 'permit_or_inspection'::text, 'design_revision'::text, 'contractor_caused'::text, 'other'::text])));
ALTER TABLE ONLY public.delay_events ADD CONSTRAINT delay_events_claimed_days_check CHECK ((claimed_days >= 0));
ALTER TABLE ONLY public.delay_events ADD CONSTRAINT delay_events_classification_check CHECK ((classification = ANY (ARRAY['excusable_compensable'::text, 'excusable_noncompensable'::text, 'nonexcusable'::text, 'unclassified'::text])));
ALTER TABLE ONLY public.delay_events ADD CONSTRAINT delay_events_concurrent_days_check CHECK (((concurrent_days IS NULL) OR (concurrent_days >= 0)));
ALTER TABLE ONLY public.deliveries ADD CONSTRAINT deliveries_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'delivered'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.draw_periods ADD CONSTRAINT draw_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'submitted'::text, 'approved'::text, 'funded'::text, 'closed'::text])));
ALTER TABLE ONLY public.drawing_pins ADD CONSTRAINT drawing_pins_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'photo'::text, 'punch'::text, 'rfi'::text])));
ALTER TABLE ONLY public.equipment ADD CONSTRAINT equipment_status_check CHECK ((status = ANY (ARRAY['available'::text, 'in_use'::text, 'maintenance'::text, 'retired'::text])));
ALTER TABLE ONLY public.equipment ADD CONSTRAINT equipment_type_check CHECK ((type = ANY (ARRAY['owned'::text, 'rented'::text])));
ALTER TABLE ONLY public.field_tickets ADD CONSTRAINT field_tickets_markup_percent_check CHECK ((markup_percent >= (0)::numeric));
ALTER TABLE ONLY public.field_tickets ADD CONSTRAINT field_tickets_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'signed'::text, 'converted'::text, 'void'::text])));
ALTER TABLE ONLY public.financing_referrals ADD CONSTRAINT financing_referrals_source_check CHECK ((source = ANY (ARRAY['estimate'::text, 'invoice'::text, 'portal'::text])));
ALTER TABLE ONLY public.financing_referrals ADD CONSTRAINT financing_referrals_status_check CHECK ((status = ANY (ARRAY['created'::text, 'clicked'::text, 'prequalified'::text, 'funded'::text, 'declined'::text])));
ALTER TABLE ONLY public.geocode_run_lock ADD CONSTRAINT geocode_run_lock_singleton CHECK ((id = 1));
ALTER TABLE ONLY public.hazards ADD CONSTRAINT hazards_likelihood_check CHECK (((likelihood >= 1) AND (likelihood <= 5)));
ALTER TABLE ONLY public.hazards ADD CONSTRAINT hazards_severity_check CHECK (((severity >= 1) AND (severity <= 5)));
ALTER TABLE ONLY public.hazards ADD CONSTRAINT hazards_status_check CHECK ((status = ANY (ARRAY['open'::text, 'mitigated'::text, 'closed'::text])));
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_qbo_sync_status_check CHECK (((qbo_sync_status IS NULL) OR (qbo_sync_status = ANY (ARRAY['pending'::text, 'synced'::text, 'error'::text]))));
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_type_check CHECK ((type = ANY (ARRAY['full'::text, 'progress'::text])));
ALTER TABLE ONLY public.jhas ADD CONSTRAINT jhas_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'archived'::text])));
ALTER TABLE ONLY public.job_listings ADD CONSTRAINT job_listings_pay_type_check CHECK ((pay_type = ANY (ARRAY['hourly'::text, 'salary'::text])));
ALTER TABLE ONLY public.job_listings ADD CONSTRAINT job_listings_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'filled'::text])));
ALTER TABLE ONLY public.lien_waivers ADD CONSTRAINT lien_waivers_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'signed'::text, 'received'::text, 'voided'::text])));
ALTER TABLE ONLY public.lien_waivers ADD CONSTRAINT lien_waivers_waiver_type_check CHECK ((waiver_type = ANY (ARRAY['conditional_partial'::text, 'unconditional_partial'::text, 'conditional_final'::text, 'unconditional_final'::text])));
ALTER TABLE ONLY public.notification_outbox ADD CONSTRAINT notification_outbox_recipient_kind_check CHECK ((recipient_kind = ANY (ARRAY['gc'::text, 'client'::text, 'sub'::text])));
ALTER TABLE ONLY public.owner_supplied_items ADD CONSTRAINT owner_supplied_items_mode_check CHECK ((mode = ANY (ARRAY['OFCI'::text, 'OFOI'::text])));
ALTER TABLE ONLY public.owner_supplied_items ADD CONSTRAINT owner_supplied_items_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'ordered'::text, 'in_transit'::text, 'on_site'::text, 'installed'::text, 'cancelled'::text])));
ALTER TABLE ONLY public.permit_templates ADD CONSTRAINT permit_templates_type_check CHECK ((type = ANY (ARRAY['building'::text, 'electrical'::text, 'plumbing'::text, 'mechanical'::text, 'demolition'::text, 'grading'::text, 'fire'::text, 'occupancy'::text, 'special_inspection'::text, 'other'::text])));
ALTER TABLE ONLY public.photos ADD CONSTRAINT photos_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.plan_markups ADD CONSTRAINT plan_markups_type_check CHECK ((type = ANY (ARRAY['arrow'::text, 'rectangle'::text, 'circle'::text, 'freehand'::text, 'text'::text])));
ALTER TABLE ONLY public.portal_budget_proposals ADD CONSTRAINT portal_budget_proposals_amount_check CHECK (((amount > (0)::numeric) AND (amount < (1000000000)::numeric)));
ALTER TABLE ONLY public.portal_budget_proposals ADD CONSTRAINT portal_budget_proposals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])));
ALTER TABLE ONLY public.portal_messages ADD CONSTRAINT portal_messages_author_type_check CHECK ((author_type = ANY (ARRAY['client'::text, 'gc'::text])));
ALTER TABLE ONLY public.portal_snapshots ADD CONSTRAINT portal_snapshots_link_duration_days_positive CHECK (((link_duration_days IS NULL) OR (link_duration_days > 0)));
ALTER TABLE ONLY public.price_alerts ADD CONSTRAINT price_alerts_direction_check CHECK ((direction = ANY (ARRAY['below'::text, 'above'::text])));
ALTER TABLE ONLY public.pro_responses ADD CONSTRAINT pro_responses_exactly_one_parent CHECK ((((rfi_id IS NOT NULL) AND (submittal_id IS NULL)) OR ((rfi_id IS NULL) AND (submittal_id IS NOT NULL))));
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_push_token_platform_check CHECK (((push_token_platform = ANY (ARRAY['ios'::text, 'android'::text, 'web'::text])) OR (push_token_platform IS NULL)));
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_units_check CHECK ((units = ANY (ARRAY['imperial'::text, 'metric'::text])));
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_user_role_check CHECK ((user_role = ANY (ARRAY['contractor'::text, 'client'::text, 'both'::text, 'property_manager'::text])));
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'editor'::text, 'viewer'::text])));
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text])));
ALTER TABLE ONLY public.project_contracts ADD CONSTRAINT project_contracts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'signed'::text, 'void'::text])));
ALTER TABLE ONLY public.projects ADD CONSTRAINT projects_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'estimated'::text, 'in_progress'::text, 'completed'::text, 'closed'::text])));
ALTER TABLE ONLY public.public_bids ADD CONSTRAINT public_bids_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));
ALTER TABLE ONLY public.punch_items ADD CONSTRAINT punch_items_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text])));
ALTER TABLE ONLY public.punch_items ADD CONSTRAINT punch_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'ready_for_review'::text, 'closed'::text])));
ALTER TABLE ONLY public.qbo_connections ADD CONSTRAINT qbo_connections_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])));
ALTER TABLE ONLY public.qbo_connections ADD CONSTRAINT qbo_connections_status_check CHECK ((status = ANY (ARRAY['connecting'::text, 'connected'::text, 'reauth_required'::text, 'error'::text, 'disconnected'::text])));
ALTER TABLE ONLY public.qbo_cost_lines ADD CONSTRAINT qbo_cost_lines_qbo_type_check CHECK ((qbo_type = ANY (ARRAY['purchase'::text, 'bill'::text])));
ALTER TABLE ONLY public.qbo_cost_lines ADD CONSTRAINT qbo_cost_lines_status_check CHECK ((status = ANY (ARRAY['staged'::text, 'confirmed'::text, 'rejected'::text])));
ALTER TABLE ONLY public.rfis ADD CONSTRAINT rfis_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.rfis ADD CONSTRAINT rfis_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'urgent'::text])));
ALTER TABLE ONLY public.rfis ADD CONSTRAINT rfis_status_check CHECK ((status = ANY (ARRAY['open'::text, 'answered'::text, 'closed'::text, 'void'::text])));
ALTER TABLE ONLY public.rfp_post_credits ADD CONSTRAINT rfp_post_credits_credits_check CHECK ((credits >= 0));
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_osha_illness_type_check CHECK ((osha_illness_type = ANY (ARRAY['injury'::text, 'skin'::text, 'respiratory'::text, 'poisoning'::text, 'hearing'::text, 'other_illness'::text])));
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_status_check CHECK ((status = ANY (ARRAY['open'::text, 'investigating'::text, 'closed'::text])));
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_treatment_check CHECK ((treatment = ANY (ARRAY['none'::text, 'first_aid'::text, 'medical_beyond_first_aid'::text])));
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_type_check CHECK ((type = ANY (ARRAY['injury'::text, 'near_miss'::text, 'property'::text, 'environmental'::text])));
ALTER TABLE ONLY public.safety_inspections ADD CONSTRAINT safety_inspections_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'complete'::text])));
ALTER TABLE ONLY public.safety_templates ADD CONSTRAINT safety_templates_category_check CHECK ((category = ANY (ARRAY['jha'::text, 'inspection'::text, 'general'::text])));
ALTER TABLE ONLY public.selection_categories ADD CONSTRAINT selection_categories_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.selection_categories ADD CONSTRAINT selection_categories_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'browsing'::text, 'chosen'::text, 'exceeded'::text])));
ALTER TABLE ONLY public.selection_options ADD CONSTRAINT selection_options_chosen_by_role_check CHECK (((chosen_by_role = ANY (ARRAY['homeowner'::text, 'gc'::text])) OR (chosen_by_role IS NULL)));
ALTER TABLE ONLY public.selection_options ADD CONSTRAINT selection_options_source_check CHECK ((source = ANY (ARRAY['ai_generated'::text, 'gc_added'::text, 'homeowner_added'::text])));
ALTER TABLE ONLY public.sub_change_requests ADD CONSTRAINT sub_change_requests_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'needs_revision'::text])));
ALTER TABLE ONLY public.sub_submitted_invoices ADD CONSTRAINT sub_submitted_invoices_amount_check CHECK (((amount > (0)::numeric) AND (amount < '1000000000'::numeric)));
ALTER TABLE ONLY public.sub_submitted_invoices ADD CONSTRAINT sub_submitted_invoices_payment_method_check CHECK (((payment_method IS NULL) OR (payment_method = ANY (ARRAY['check'::text, 'ach'::text, 'card'::text, 'cash'::text, 'other'::text])))) NOT VALID;
ALTER TABLE ONLY public.sub_submitted_invoices ADD CONSTRAINT sub_submitted_invoices_retention_amount_check CHECK ((retention_amount >= (0)::numeric));
ALTER TABLE ONLY public.sub_submitted_invoices ADD CONSTRAINT sub_submitted_invoices_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'paid'::text])));
ALTER TABLE ONLY public.submittals ADD CONSTRAINT submittals_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_tier_check CHECK ((tier = ANY (ARRAY['free'::text, 'pro'::text, 'business'::text, 'enterprise'::text])));
ALTER TABLE ONLY public.time_entries ADD CONSTRAINT time_entries_break_minutes_check CHECK ((break_minutes >= 0));
ALTER TABLE ONLY public.time_entries ADD CONSTRAINT time_entries_overtime_hours_check CHECK ((overtime_hours >= (0)::numeric));
ALTER TABLE ONLY public.time_entries ADD CONSTRAINT time_entries_status_check CHECK ((status = ANY (ARRAY['clocked_in'::text, 'clocked_out'::text, 'break'::text])));
ALTER TABLE ONLY public.time_entries ADD CONSTRAINT time_entries_total_hours_check CHECK ((total_hours >= (0)::numeric));
ALTER TABLE ONLY public.toolbox_talks ADD CONSTRAINT toolbox_talks_ai_topic_source_check CHECK ((ai_topic_source = ANY (ARRAY['incident'::text, 'hazard'::text, 'weather'::text, 'manual'::text])));
ALTER TABLE ONLY public.user_tracked_bids ADD CONSTRAINT user_tracked_bids_status_check CHECK ((status = ANY (ARRAY['saved'::text, 'interested'::text, 'preparing'::text, 'submitted'::text, 'won'::text, 'lost'::text])));
ALTER TABLE ONLY public.warranties ADD CONSTRAINT warranties_portal_state_status_check CHECK (((portal_state IS NULL) OR (NOT (portal_state ? 'status'::text)) OR ((portal_state ->> 'status'::text) = ANY (ARRAY['draft'::text, 'sent'::text, 'recalled'::text]))));
ALTER TABLE ONLY public.worker_profiles ADD CONSTRAINT worker_profiles_availability_check CHECK ((availability = ANY (ARRAY['available'::text, 'employed'::text, 'open_to_offers'::text])));

-- -----------------------------------------------------------------------------
-- 2c. FOREIGN KEY constraints (134)
--
-- NOTE: many of these reference auth.users(id). The auth schema itself is NOT
-- described in this file (see header), only these references to it.
-- -----------------------------------------------------------------------------

ALTER TABLE ONLY public.access_reservations ADD CONSTRAINT access_reservations_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.access_reservations ADD CONSTRAINT access_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.aia_pay_apps ADD CONSTRAINT aia_pay_apps_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.aia_pay_apps ADD CONSTRAINT aia_pay_apps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.assemblies ADD CONSTRAINT assemblies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_package_bids ADD CONSTRAINT bid_package_bids_package_id_fkey FOREIGN KEY (package_id) REFERENCES bid_packages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_package_bids ADD CONSTRAINT bid_package_bids_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_packages ADD CONSTRAINT bid_packages_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_packages ADD CONSTRAINT bid_packages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_questions ADD CONSTRAINT bid_questions_asker_user_id_fkey FOREIGN KEY (asker_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_questions ADD CONSTRAINT bid_questions_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public_bids(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_responses ADD CONSTRAINT bid_responses_bid_id_fkey FOREIGN KEY (bid_id) REFERENCES public_bids(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.bid_responses ADD CONSTRAINT bid_responses_proposer_company_id_fkey FOREIGN KEY (proposer_company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.bid_responses ADD CONSTRAINT bid_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.brain_predictions ADD CONSTRAINT brain_predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.building_access_rules ADD CONSTRAINT building_access_rules_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.building_access_rules ADD CONSTRAINT building_access_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.certifications ADD CONSTRAINT certifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.change_orders ADD CONSTRAINT change_orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.change_orders ADD CONSTRAINT change_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.closeout_binders ADD CONSTRAINT closeout_binders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.closeout_binders ADD CONSTRAINT closeout_binders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cois ADD CONSTRAINT cois_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.comm_events ADD CONSTRAINT comm_events_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.comm_events ADD CONSTRAINT comm_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.commitments ADD CONSTRAINT commitments_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.commitments ADD CONSTRAINT commitments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.companies ADD CONSTRAINT companies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.contacts ADD CONSTRAINT contacts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.contractor_licenses ADD CONSTRAINT contractor_licenses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversation_participants ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.conversation_participants ADD CONSTRAINT conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cost_benchmark_samples ADD CONSTRAINT cost_benchmark_samples_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.cost_seeds ADD CONSTRAINT cost_seeds_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.crew_members ADD CONSTRAINT crew_members_claimed_by_user_id_fkey FOREIGN KEY (claimed_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.crew_members ADD CONSTRAINT crew_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.daily_reports ADD CONSTRAINT daily_reports_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.daily_reports ADD CONSTRAINT daily_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.delay_events ADD CONSTRAINT delay_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.deliveries ADD CONSTRAINT deliveries_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.deliveries ADD CONSTRAINT deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.delivery_receipts ADD CONSTRAINT delivery_receipts_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.delivery_receipts ADD CONSTRAINT delivery_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.draw_periods ADD CONSTRAINT draw_periods_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.draw_periods ADD CONSTRAINT draw_periods_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.drawing_pins ADD CONSTRAINT drawing_pins_plan_sheet_id_fkey FOREIGN KEY (plan_sheet_id) REFERENCES plan_sheets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.drawing_pins ADD CONSTRAINT drawing_pins_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.drawing_pins ADD CONSTRAINT drawing_pins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.equipment ADD CONSTRAINT equipment_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.estimate_versions ADD CONSTRAINT estimate_versions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.feature_interest ADD CONSTRAINT feature_interest_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.field_tickets ADD CONSTRAINT field_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.financing_referrals ADD CONSTRAINT financing_referrals_gc_user_id_fkey FOREIGN KEY (gc_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.financing_referrals ADD CONSTRAINT financing_referrals_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.hazards ADD CONSTRAINT hazards_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.hazards ADD CONSTRAINT hazards_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.jhas ADD CONSTRAINT jhas_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.jhas ADD CONSTRAINT jhas_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.job_listings ADD CONSTRAINT job_listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_converted_project_id_fkey FOREIGN KEY (converted_project_id) REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.leads ADD CONSTRAINT leads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lien_waivers ADD CONSTRAINT lien_waivers_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.lien_waivers ADD CONSTRAINT lien_waivers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.mcp_tokens ADD CONSTRAINT mcp_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.messages ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.oac_meetings ADD CONSTRAINT oac_meetings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.owner_supplied_items ADD CONSTRAINT owner_supplied_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.owner_supplied_items ADD CONSTRAINT owner_supplied_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.permit_templates ADD CONSTRAINT permit_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.permits ADD CONSTRAINT permits_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.permits ADD CONSTRAINT permits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.photos ADD CONSTRAINT photos_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.photos ADD CONSTRAINT photos_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_calibrations ADD CONSTRAINT plan_calibrations_plan_sheet_id_fkey FOREIGN KEY (plan_sheet_id) REFERENCES plan_sheets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_calibrations ADD CONSTRAINT plan_calibrations_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_calibrations ADD CONSTRAINT plan_calibrations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_markups ADD CONSTRAINT plan_markups_plan_sheet_id_fkey FOREIGN KEY (plan_sheet_id) REFERENCES plan_sheets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_markups ADD CONSTRAINT plan_markups_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_markups ADD CONSTRAINT plan_markups_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_sheets ADD CONSTRAINT plan_sheets_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.plan_sheets ADD CONSTRAINT plan_sheets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.portal_snapshots ADD CONSTRAINT portal_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.prequal_packets ADD CONSTRAINT prequal_packets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.price_alerts ADD CONSTRAINT price_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pro_responses ADD CONSTRAINT pro_responses_rfi_id_fkey FOREIGN KEY (rfi_id) REFERENCES rfis(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.pro_responses ADD CONSTRAINT pro_responses_submittal_id_fkey FOREIGN KEY (submittal_id) REFERENCES submittals(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_collaborators ADD CONSTRAINT project_collaborators_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_contracts ADD CONSTRAINT project_contracts_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_contracts ADD CONSTRAINT project_contracts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_financials ADD CONSTRAINT project_financials_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_financials ADD CONSTRAINT project_financials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.projects ADD CONSTRAINT projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.public_bids ADD CONSTRAINT public_bids_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.punch_items ADD CONSTRAINT punch_items_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.punch_items ADD CONSTRAINT punch_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.qbo_connections ADD CONSTRAINT qbo_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.qbo_cost_lines ADD CONSTRAINT qbo_cost_lines_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rfis ADD CONSTRAINT rfis_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rfis ADD CONSTRAINT rfis_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rfp_post_credits ADD CONSTRAINT rfp_post_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.rfp_post_payments ADD CONSTRAINT rfp_post_payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.safety_incidents ADD CONSTRAINT safety_incidents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.safety_inspections ADD CONSTRAINT safety_inspections_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.safety_templates ADD CONSTRAINT safety_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.scan_records ADD CONSTRAINT scan_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.selection_categories ADD CONSTRAINT selection_categories_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.selection_categories ADD CONSTRAINT selection_categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.selection_options ADD CONSTRAINT selection_options_category_id_fkey FOREIGN KEY (category_id) REFERENCES selection_categories(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.shared_schedule_snapshots ADD CONSTRAINT shared_schedule_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.shared_schedule_snapshots ADD CONSTRAINT shared_schedule_snapshots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sub_change_requests ADD CONSTRAINT sub_change_requests_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sub_change_requests ADD CONSTRAINT sub_change_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sub_portal_links ADD CONSTRAINT sub_portal_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.sub_portal_snapshots ADD CONSTRAINT sub_portal_snapshots_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.subcontractors ADD CONSTRAINT subcontractors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.submittals ADD CONSTRAINT submittals_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.submittals ADD CONSTRAINT submittals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.time_entries ADD CONSTRAINT time_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.toolbox_talks ADD CONSTRAINT toolbox_talks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.toolbox_talks ADD CONSTRAINT toolbox_talks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.user_tracked_bids ADD CONSTRAINT user_tracked_bids_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.warranties ADD CONSTRAINT warranties_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.warranties ADD CONSTRAINT warranties_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.wip_periods ADD CONSTRAINT wip_periods_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.worker_profiles ADD CONSTRAINT worker_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.workers ADD CONSTRAINT workers_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- =============================================================================
-- SECTION 3 — INDEXES (228 of 352)
--
-- pg_indexes reports 352 indexes on the public schema. 124 of those are the
-- implicit indexes Postgres creates to back the PRIMARY KEY / UNIQUE
-- constraints already emitted in section 2a, and are intentionally omitted
-- here to avoid duplicating the same object twice. The 228 standalone indexes
-- below are the ones actually declared as indexes.
-- =============================================================================

CREATE INDEX access_reservations_delivery_idx ON public.access_reservations USING btree (delivery_id) WHERE (delivery_id IS NOT NULL);
CREATE INDEX access_reservations_open_idx ON public.access_reservations USING btree (project_id, date) WHERE (status = ANY (ARRAY['requested'::text, 'confirmed'::text]));
CREATE INDEX bid_package_bids_package_id_idx ON public.bid_package_bids USING btree (user_id, package_id);
CREATE INDEX bid_package_bids_subcontractor_id_idx ON public.bid_package_bids USING btree (user_id, subcontractor_id);
CREATE INDEX bid_package_bids_user_id_idx ON public.bid_package_bids USING btree (user_id);
CREATE INDEX bid_packages_project_id_idx ON public.bid_packages USING btree (user_id, project_id);
CREATE INDEX bid_packages_status_idx ON public.bid_packages USING btree (user_id, status);
CREATE INDEX bid_packages_user_id_idx ON public.bid_packages USING btree (user_id);
CREATE INDEX brain_predictions_user_kind_open ON public.brain_predictions USING btree (user_id, kind) WHERE (resolved_at IS NULL);
CREATE INDEX brain_predictions_user_subject ON public.brain_predictions USING btree (user_id, kind, subject_id);
CREATE INDEX certifications_sub_idx ON public.certifications USING btree (sub_id);
CREATE INDEX certifications_user_idx ON public.certifications USING btree (user_id);
CREATE INDEX certifications_worker_idx ON public.certifications USING btree (worker_id);
CREATE INDEX change_orders_pending_reflow_idx ON public.change_orders USING btree (project_id) WHERE ((schedule_impact_applied = false) AND (schedule_impact_days IS NOT NULL));
CREATE INDEX cost_benchmark_public_idx ON public.cost_benchmark_samples USING btree (category, unit, region) WHERE public_index_opt_in;
CREATE INDEX daily_reports_published_summary_idx ON public.daily_reports USING btree (project_id, date DESC) WHERE (homeowner_summary_published = true);
CREATE INDEX delay_events_open_notice_idx ON public.delay_events USING btree (user_id, first_observed_date) WHERE (notices = '[]'::jsonb);
CREATE INDEX delay_events_project_idx ON public.delay_events USING btree (project_id, first_observed_date DESC);
CREATE UNIQUE INDEX delay_events_project_number_idx ON public.delay_events USING btree (project_id, number);
CREATE INDEX delay_events_user_idx ON public.delay_events USING btree (user_id);
CREATE INDEX deliveries_open_expected_idx ON public.deliveries USING btree (user_id, expected_date) WHERE (status = ANY (ARRAY['scheduled'::text, 'confirmed'::text]));
CREATE INDEX deliveries_project_idx ON public.deliveries USING btree (project_id, expected_date);
CREATE INDEX delivery_receipts_delivery_idx ON public.delivery_receipts USING btree (delivery_id) WHERE (delivery_id IS NOT NULL);
CREATE INDEX feature_interest_event_idx ON public.feature_interest USING btree (event_key);
CREATE INDEX field_tickets_project_idx ON public.field_tickets USING btree (project_id, date DESC);
CREATE INDEX field_tickets_unbilled_idx ON public.field_tickets USING btree (user_id, status) WHERE (status = 'signed'::text);
CREATE INDEX field_tickets_user_idx ON public.field_tickets USING btree (user_id);
CREATE INDEX financing_referrals_gc_idx ON public.financing_referrals USING btree (gc_user_id);
CREATE INDEX financing_referrals_project_idx ON public.financing_referrals USING btree (project_id);
CREATE INDEX idx_ai_usage_counters_user_month ON public.ai_usage_counters USING btree (user_id, month_bucket);
CREATE INDEX idx_aia_pay_apps_project ON public.aia_pay_apps USING btree (project_id);
CREATE INDEX idx_aia_pay_apps_user ON public.aia_pay_apps USING btree (user_id);
CREATE INDEX idx_assemblies_category ON public.assemblies USING btree (category);
CREATE INDEX idx_assemblies_user ON public.assemblies USING btree (user_id);
CREATE INDEX idx_bid_questions_bid ON public.bid_questions USING btree (bid_id);
CREATE INDEX idx_bid_responses_bid_id ON public.bid_responses USING btree (bid_id);
CREATE INDEX idx_bid_responses_user_id ON public.bid_responses USING btree (user_id);
CREATE INDEX idx_bids_deadline ON public.cached_bids USING btree (response_deadline);
CREATE INDEX idx_bids_location ON public.cached_bids USING btree (latitude, longitude);
CREATE INDEX idx_cached_bids_deadline ON public.cached_bids USING btree (response_deadline);
CREATE INDEX idx_cached_bids_naics ON public.cached_bids USING btree (naics_code);
CREATE INDEX idx_cached_bids_state ON public.cached_bids USING btree (state);
CREATE INDEX idx_change_orders_project ON public.change_orders USING btree (project_id);
CREATE INDEX idx_change_orders_project_id ON public.change_orders USING btree (project_id);
CREATE INDEX idx_change_orders_user ON public.change_orders USING btree (user_id);
CREATE INDEX idx_change_orders_user_id ON public.change_orders USING btree (user_id);
CREATE INDEX idx_city_coords_state ON public.city_coords USING btree (state);
CREATE INDEX idx_closeout_binders_project ON public.closeout_binders USING btree (project_id);
CREATE INDEX idx_coa_co ON public.change_order_approvals USING btree (change_order_id, created_at DESC);
CREATE INDEX idx_coa_project ON public.change_order_approvals USING btree (project_id, created_at DESC) WHERE (project_id IS NOT NULL);
CREATE INDEX idx_coa_unsynced ON public.change_order_approvals USING btree (project_id, created_at) WHERE ((synced_to_co_at IS NULL) AND (project_id IS NOT NULL));
CREATE INDEX idx_cois_project ON public.cois USING btree (project_id);
CREATE INDEX idx_cois_subcontractor ON public.cois USING btree (subcontractor_id);
CREATE INDEX idx_cois_user ON public.cois USING btree (user_id);
CREATE INDEX idx_comm_events_project ON public.comm_events USING btree (project_id);
CREATE INDEX idx_comm_events_user ON public.comm_events USING btree (user_id);
CREATE INDEX idx_comm_events_user_id ON public.comm_events USING btree (user_id);
CREATE INDEX idx_commitments_project ON public.commitments USING btree (project_id);
CREATE INDEX idx_commitments_sub ON public.commitments USING btree (subcontractor_id);
CREATE INDEX idx_commitments_user ON public.commitments USING btree (user_id);
CREATE INDEX idx_companies_location ON public.cached_companies USING btree (latitude, longitude);
CREATE INDEX idx_companies_state ON public.companies USING btree (state);
CREATE INDEX idx_companies_trade ON public.cached_companies USING btree (trade_specialty);
CREATE INDEX idx_contacts_user ON public.contacts USING btree (user_id);
CREATE INDEX idx_contacts_user_id ON public.contacts USING btree (user_id);
CREATE INDEX idx_contractor_licenses_user_expires ON public.contractor_licenses USING btree (user_id, expires_date);
CREATE INDEX idx_contractor_licenses_user_type ON public.contractor_licenses USING btree (user_id, license_type);
CREATE INDEX idx_conversation_participants_conversation_id ON public.conversation_participants USING btree (conversation_id);
CREATE INDEX idx_conversation_participants_user ON public.conversation_participants USING btree (user_id);
CREATE INDEX idx_conversation_participants_user_id ON public.conversation_participants USING btree (user_id);
CREATE INDEX idx_crew_members_claim_token ON public.crew_members USING btree (claim_token);
CREATE INDEX idx_crew_members_claimed ON public.crew_members USING btree (claimed_by_user_id);
CREATE INDEX idx_crew_members_user ON public.crew_members USING btree (user_id);
CREATE INDEX idx_daily_reports_project ON public.daily_reports USING btree (project_id);
CREATE INDEX idx_daily_reports_project_id ON public.daily_reports USING btree (project_id);
CREATE INDEX idx_daily_reports_user ON public.daily_reports USING btree (user_id);
CREATE INDEX idx_daily_reports_user_id ON public.daily_reports USING btree (user_id);
CREATE INDEX idx_delivery_receipts_project_date ON public.delivery_receipts USING btree (project_id, date DESC);
CREATE INDEX idx_delivery_receipts_supplier ON public.delivery_receipts USING btree (user_id, supplier);
CREATE INDEX idx_delivery_receipts_user ON public.delivery_receipts USING btree (user_id);
CREATE UNIQUE INDEX idx_draw_periods_project_number ON public.draw_periods USING btree (project_id, number);
CREATE INDEX idx_draw_periods_user_status ON public.draw_periods USING btree (user_id, status);
CREATE INDEX idx_drawing_pins_project ON public.drawing_pins USING btree (project_id);
CREATE INDEX idx_drawing_pins_sheet ON public.drawing_pins USING btree (plan_sheet_id);
CREATE INDEX idx_drawing_pins_user ON public.drawing_pins USING btree (user_id);
CREATE INDEX idx_email_unsubscribes_email ON public.email_unsubscribes USING btree (email);
CREATE INDEX idx_email_unsubscribes_lookup ON public.email_unsubscribes USING btree (email, event_key);
CREATE INDEX idx_equipment_user ON public.equipment USING btree (user_id);
CREATE INDEX idx_equipment_user_id ON public.equipment USING btree (user_id);
CREATE INDEX idx_estimate_versions_project ON public.estimate_versions USING btree (project_id);
CREATE INDEX idx_estimate_versions_user ON public.estimate_versions USING btree (user_id);
CREATE INDEX idx_hazards_project ON public.hazards USING btree (project_id);
CREATE INDEX idx_invoices_project ON public.invoices USING btree (project_id);
CREATE INDEX idx_invoices_project_id ON public.invoices USING btree (project_id);
CREATE INDEX idx_invoices_user ON public.invoices USING btree (user_id);
CREATE INDEX idx_invoices_user_id ON public.invoices USING btree (user_id);
CREATE INDEX idx_jhas_project ON public.jhas USING btree (project_id);
CREATE INDEX idx_job_listings_status ON public.job_listings USING btree (status);
CREATE INDEX idx_jobs_location ON public.cached_jobs USING btree (latitude, longitude);
CREATE INDEX idx_jobs_trade ON public.cached_jobs USING btree (trade_category);
CREATE INDEX idx_labor_rates_region ON public.labor_rates USING btree (region);
CREATE INDEX idx_labor_rates_state ON public.labor_rates USING btree (state);
CREATE INDEX idx_labor_rates_trade ON public.labor_rates USING btree (trade);
CREATE INDEX idx_lien_waivers_project ON public.lien_waivers USING btree (project_id);
CREATE INDEX idx_lien_waivers_user ON public.lien_waivers USING btree (user_id);
CREATE INDEX idx_material_prices_category ON public.material_prices USING btree (category);
CREATE INDEX idx_material_prices_expiry ON public.material_prices USING btree (expires_at);
CREATE INDEX idx_material_prices_lookup ON public.material_prices USING btree (material_key, store_zip, source);
CREATE INDEX idx_materials_region ON public.materials_pricing USING btree (region);
CREATE INDEX idx_messages_conversation ON public.messages USING btree (conversation_id);
CREATE INDEX idx_messages_conversation_id ON public.messages USING btree (conversation_id);
CREATE INDEX idx_messages_sender_id ON public.messages USING btree (sender_id);
CREATE INDEX idx_messages_timestamp ON public.messages USING btree ("timestamp");
CREATE INDEX idx_oac_meetings_project ON public.oac_meetings USING btree (project_id);
CREATE INDEX idx_oac_meetings_scheduled ON public.oac_meetings USING btree (scheduled_at DESC);
CREATE INDEX idx_oac_meetings_user ON public.oac_meetings USING btree (user_id);
CREATE INDEX idx_outbox_recipient ON public.notification_outbox USING btree (recipient_user_id, created_at DESC) WHERE (recipient_user_id IS NOT NULL);
CREATE INDEX idx_outbox_source ON public.notification_outbox USING btree (source_table, source_id);
CREATE INDEX idx_outbox_unread ON public.notification_outbox USING btree (recipient_user_id, created_at DESC) WHERE ((read_at IS NULL) AND (recipient_user_id IS NOT NULL));
CREATE INDEX idx_owner_supplied_project_status ON public.owner_supplied_items USING btree (project_id, status);
CREATE INDEX idx_owner_supplied_user ON public.owner_supplied_items USING btree (user_id);
CREATE INDEX idx_pbp_portal ON public.portal_budget_proposals USING btree (portal_id, created_at DESC);
CREATE INDEX idx_pbp_project_status ON public.portal_budget_proposals USING btree (project_id, status, created_at DESC) WHERE (project_id IS NOT NULL);
CREATE INDEX idx_permit_templates_type_juris ON public.permit_templates USING btree (user_id, type, jurisdiction);
CREATE INDEX idx_permit_templates_user ON public.permit_templates USING btree (user_id, last_used_at DESC NULLS LAST);
CREATE INDEX idx_permits_project ON public.permits USING btree (project_id);
CREATE INDEX idx_permits_user ON public.permits USING btree (user_id);
CREATE INDEX idx_photos_project ON public.photos USING btree (project_id);
CREATE INDEX idx_photos_project_id ON public.photos USING btree (project_id);
CREATE INDEX idx_photos_user ON public.photos USING btree (user_id);
CREATE INDEX idx_photos_user_id ON public.photos USING btree (user_id);
CREATE INDEX idx_plan_calibrations_sheet ON public.plan_calibrations USING btree (plan_sheet_id);
CREATE INDEX idx_plan_calibrations_user ON public.plan_calibrations USING btree (user_id);
CREATE INDEX idx_plan_markups_project ON public.plan_markups USING btree (project_id);
CREATE INDEX idx_plan_markups_sheet ON public.plan_markups USING btree (plan_sheet_id);
CREATE INDEX idx_plan_markups_user ON public.plan_markups USING btree (user_id);
CREATE INDEX idx_plan_sheets_project ON public.plan_sheets USING btree (project_id);
CREATE INDEX idx_plan_sheets_user ON public.plan_sheets USING btree (user_id);
CREATE INDEX idx_pm_portal ON public.portal_messages USING btree (portal_id, created_at DESC);
CREATE INDEX idx_pm_project ON public.portal_messages USING btree (project_id, created_at DESC) WHERE (project_id IS NOT NULL);
CREATE INDEX idx_portal_audit_portal_time ON public.portal_decision_audit USING btree (portal_id, created_at DESC);
CREATE INDEX idx_prequal_packets_sub ON public.prequal_packets USING btree (subcontractor_id);
CREATE INDEX idx_prequal_packets_token ON public.prequal_packets USING btree (invite_token);
CREATE INDEX idx_prequal_packets_user ON public.prequal_packets USING btree (user_id);
CREATE INDEX idx_price_alerts_user ON public.price_alerts USING btree (user_id);
CREATE INDEX idx_price_alerts_user_id ON public.price_alerts USING btree (user_id);
CREATE INDEX idx_pro_responses_rfi_id ON public.pro_responses USING btree (rfi_id);
CREATE INDEX idx_pro_responses_submittal_id ON public.pro_responses USING btree (submittal_id);
CREATE INDEX idx_pro_responses_token ON public.pro_responses USING btree (share_token);
CREATE INDEX idx_profiles_digest_enabled ON public.profiles USING btree (digest_enabled) WHERE (digest_enabled = true);
CREATE INDEX idx_profiles_push_token_platform ON public.profiles USING btree (push_token_platform) WHERE (push_token IS NOT NULL);
CREATE INDEX idx_profiles_stripe_account_id ON public.profiles USING btree (stripe_account_id) WHERE (stripe_account_id IS NOT NULL);
CREATE INDEX idx_project_collaborators_project ON public.project_collaborators USING btree (project_id);
CREATE INDEX idx_project_collaborators_user ON public.project_collaborators USING btree (user_id);
CREATE INDEX idx_project_contracts_project ON public.project_contracts USING btree (project_id);
CREATE INDEX idx_project_contracts_status ON public.project_contracts USING btree (status);
CREATE INDEX idx_project_contracts_user ON public.project_contracts USING btree (user_id);
CREATE INDEX idx_projects_calendar_token ON public.projects USING btree (calendar_token);
CREATE INDEX idx_projects_user_id ON public.projects USING btree (user_id);
CREATE INDEX idx_projects_warranty_walk_pending ON public.projects USING btree (substantial_completion_date) WHERE ((substantial_completion_date IS NOT NULL) AND (warranty_walk_completed_at IS NULL));
CREATE INDEX idx_public_bids_homeowner ON public.public_bids USING btree (is_homeowner_rfp) WHERE (is_homeowner_rfp = true);
CREATE INDEX idx_public_bids_lat_lng ON public.public_bids USING btree (latitude, longitude) WHERE (latitude IS NOT NULL);
CREATE INDEX idx_public_bids_state ON public.public_bids USING btree (state);
CREATE INDEX idx_public_bids_status ON public.public_bids USING btree (status);
CREATE INDEX idx_punch_items_project ON public.punch_items USING btree (project_id);
CREATE INDEX idx_punch_items_project_id ON public.punch_items USING btree (project_id);
CREATE INDEX idx_punch_items_user_id ON public.punch_items USING btree (user_id);
CREATE INDEX idx_rate_limit_counters_age ON public.rate_limit_counters USING btree (bucket_start);
CREATE INDEX idx_rfis_project ON public.rfis USING btree (project_id);
CREATE INDEX idx_rfis_project_id ON public.rfis USING btree (project_id);
CREATE INDEX idx_rfis_share_token ON public.rfis USING btree (share_token);
CREATE INDEX idx_rfis_user_id ON public.rfis USING btree (user_id);
CREATE INDEX idx_safety_incidents_project ON public.safety_incidents USING btree (project_id);
CREATE INDEX idx_scan_records_project ON public.scan_records USING btree (project_id);
CREATE INDEX idx_scan_records_user ON public.scan_records USING btree (user_id);
CREATE INDEX idx_selection_categories_project ON public.selection_categories USING btree (project_id);
CREATE INDEX idx_selection_categories_user ON public.selection_categories USING btree (user_id);
CREATE INDEX idx_selection_options_category ON public.selection_options USING btree (category_id);
CREATE INDEX idx_selection_options_chosen ON public.selection_options USING btree (category_id, is_chosen) WHERE (is_chosen = true);
CREATE INDEX idx_ssi_portal ON public.sub_submitted_invoices USING btree (sub_portal_id, created_at DESC);
CREATE INDEX idx_ssi_project_status ON public.sub_submitted_invoices USING btree (project_id, status, created_at DESC) WHERE (project_id IS NOT NULL);
CREATE INDEX idx_sub_change_requests_project ON public.sub_change_requests USING btree (project_id);
CREATE INDEX idx_sub_change_requests_sub_portal ON public.sub_change_requests USING btree (sub_portal_id);
CREATE INDEX idx_sub_change_requests_user_status ON public.sub_change_requests USING btree (user_id, status);
CREATE INDEX idx_sub_portal_links_project ON public.sub_portal_links USING btree (project_id);
CREATE INDEX idx_sub_portal_links_user ON public.sub_portal_links USING btree (user_id);
CREATE INDEX idx_subcontractors_user ON public.subcontractors USING btree (user_id);
CREATE INDEX idx_subcontractors_user_id ON public.subcontractors USING btree (user_id);
CREATE INDEX idx_submittals_project ON public.submittals USING btree (project_id);
CREATE INDEX idx_submittals_project_id ON public.submittals USING btree (project_id);
CREATE INDEX idx_submittals_share_token ON public.submittals USING btree (share_token);
CREATE INDEX idx_submittals_user_id ON public.submittals USING btree (user_id);
CREATE INDEX idx_subscriptions_user ON public.subscriptions USING btree (user_id);
CREATE INDEX idx_time_entries_project ON public.time_entries USING btree (project_id);
CREATE INDEX idx_toolbox_talks_project ON public.toolbox_talks USING btree (project_id);
CREATE INDEX idx_tracked_bids_bid ON public.user_tracked_bids USING btree (bid_id);
CREATE INDEX idx_tracked_bids_user ON public.user_tracked_bids USING btree (user_id, status);
CREATE INDEX idx_warranties_end_date ON public.warranties USING btree (end_date);
CREATE INDEX idx_warranties_project ON public.warranties USING btree (project_id);
CREATE INDEX idx_warranties_user ON public.warranties USING btree (user_id);
CREATE INDEX idx_wip_periods_user ON public.wip_periods USING btree (user_id);
CREATE INDEX idx_worker_profiles_trade ON public.worker_profiles USING btree (trade_category);
CREATE INDEX idx_workers_user_id_active ON public.workers USING btree (user_id, active);
CREATE INDEX idx_workers_user_id_name ON public.workers USING btree (user_id, name);
CREATE INDEX invoices_source_milestone_id_idx ON public.invoices USING btree (source_milestone_id) WHERE (source_milestone_id IS NOT NULL);
CREATE INDEX leads_received_at_idx ON public.leads USING btree (user_id, received_at DESC);
CREATE INDEX leads_stage_idx ON public.leads USING btree (user_id, stage);
CREATE INDEX leads_user_id_idx ON public.leads USING btree (user_id);
CREATE INDEX mcp_tokens_hash_idx ON public.mcp_tokens USING btree (token_hash);
CREATE INDEX mcp_tokens_user_idx ON public.mcp_tokens USING btree (user_id);
CREATE INDEX memory_embeddings_user_project_idx ON public.memory_embeddings USING btree (user_id, project_id);
CREATE INDEX memory_embeddings_vec_idx ON public.memory_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX plan_sheets_project_number_idx ON public.plan_sheets USING btree (project_id, sheet_number) WHERE (superseded IS NOT TRUE);
CREATE INDEX portal_snapshots_expires_at_idx ON public.portal_snapshots USING btree (expires_at) WHERE (expires_at IS NOT NULL);
CREATE INDEX portal_snapshots_project_id_idx ON public.portal_snapshots USING btree (project_id);
CREATE INDEX project_financials_user_id_idx ON public.project_financials USING btree (user_id);
CREATE INDEX qbo_cost_lines_user_status ON public.qbo_cost_lines USING btree (user_id, status);
CREATE INDEX rfis_assigned_sub_id_idx ON public.rfis USING btree (assigned_sub_id) WHERE (assigned_sub_id IS NOT NULL);
CREATE INDEX safety_inspections_project_idx ON public.safety_inspections USING btree (project_id);
CREATE INDEX safety_inspections_user_idx ON public.safety_inspections USING btree (user_id);
CREATE INDEX safety_templates_user_idx ON public.safety_templates USING btree (user_id);
CREATE INDEX shared_schedule_snapshots_expires_idx ON public.shared_schedule_snapshots USING btree (expires_at);
CREATE INDEX shared_schedule_snapshots_user_idx ON public.shared_schedule_snapshots USING btree (user_id, created_at DESC);
CREATE INDEX sub_portal_snapshots_project_id_idx ON public.sub_portal_snapshots USING btree (project_id);
CREATE INDEX sub_submitted_invoices_paid_on_idx ON public.sub_submitted_invoices USING btree (paid_on) WHERE (paid_on IS NOT NULL);
CREATE INDEX time_entries_project_date_idx ON public.time_entries USING btree (project_id, date);
CREATE INDEX time_entries_status_idx ON public.time_entries USING btree (user_id, status);
CREATE INDEX time_entries_user_idx ON public.time_entries USING btree (user_id);

-- =============================================================================
-- SECTION 4 — ROW LEVEL SECURITY
--
-- pg_class.relrowsecurity is true for all 108 tables in the public schema.
-- =============================================================================

ALTER TABLE public.access_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_daily_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aia_pay_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_package_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bid_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brain_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.building_access_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cached_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cached_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cached_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_order_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.city_coords ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closeout_binders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cois ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commitments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contractor_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_benchmark_samples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delay_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draw_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drawing_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_interest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financing_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geocode_run_lock ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hazards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.labor_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lien_waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.material_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.materials_pricing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memory_embeddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.oac_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_supplied_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permit_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_calibrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_markups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_budget_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_decision_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prequal_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_collaborators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_financials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.punch_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qbo_cost_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfp_post_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rfp_post_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_inspections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.safety_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selection_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selection_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_schedule_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_portal_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_portal_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sub_submitted_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.toolbox_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_tracked_bids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warranties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wip_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worker_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.zip_cost_factors ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- SECTION 5 — ROW LEVEL SECURITY POLICIES (337)
--
-- Reconstructed from pg_policies (schemaname, tablename, policyname,
-- permissive, roles, cmd, qual, with_check). The USING / WITH CHECK
-- expressions are Postgres' own normalized rendering of the stored parse
-- tree, so they are semantically exact but not textually identical to the
-- SQL originally typed in the migrations.
--
-- "TO public" means the policy names no explicit role, i.e. it applies to
-- every role, not that the data is public.
--
-- Ordered by (tablename, policyname).
-- =============================================================================

CREATE POLICY access_reservations_collab_insert ON public.access_reservations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'field'::text)));
CREATE POLICY access_reservations_collab_select ON public.access_reservations AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY access_reservations_collab_update ON public.access_reservations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'field'::text))
  WITH CHECK (can_access_project(project_id, 'field'::text));
CREATE POLICY access_reservations_owner_delete ON public.access_reservations AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY ai_daily_usage_owner_read ON public.ai_daily_usage AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY users_read_own_usage ON public.ai_usage_counters AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY aia_pay_apps_owner_all ON public.aia_pay_apps AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY assemblies_delete_own ON public.assemblies AS PERMISSIVE FOR DELETE TO public
  USING (((auth.uid() = user_id) AND (is_system = false)));
CREATE POLICY assemblies_insert_own ON public.assemblies AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY assemblies_select_all ON public.assemblies AS PERMISSIVE FOR SELECT TO public
  USING (((is_system = true) OR (auth.uid() = user_id)));
CREATE POLICY assemblies_update_own ON public.assemblies AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY bid_package_bids_owner_all ON public.bid_package_bids AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY bid_packages_owner_all ON public.bid_packages AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY bq_ask ON public.bid_questions AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((asker_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_questions.bid_id) AND (pb.is_homeowner_rfp = true) AND (pb.status = 'open'::text) AND (pb.user_id <> auth.uid()))))));
CREATE POLICY bq_homeowner_answer ON public.bid_questions AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_questions.bid_id) AND (pb.user_id = auth.uid())))));
CREATE POLICY bq_homeowner_read_all ON public.bid_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_questions.bid_id) AND (pb.user_id = auth.uid())))));
CREATE POLICY bq_read_own ON public.bid_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = asker_user_id));
CREATE POLICY bq_read_public ON public.bid_questions AS PERMISSIVE FOR SELECT TO authenticated
  USING ((is_public = true));
CREATE POLICY bid_responses_own ON public.bid_responses AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id));
CREATE POLICY bid_responses_view ON public.bid_responses AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_responses.bid_id) AND (pb.user_id = auth.uid())))));
CREATE POLICY br_homeowner_update_status ON public.bid_responses AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_responses.bid_id) AND (pb.user_id = auth.uid())))));
CREATE POLICY brain_predictions_owner ON public.brain_predictions AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY building_access_rules_collab_insert ON public.building_access_rules AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'field'::text)));
CREATE POLICY building_access_rules_collab_select ON public.building_access_rules AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY building_access_rules_collab_update ON public.building_access_rules AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'field'::text))
  WITH CHECK (can_access_project(project_id, 'field'::text));
CREATE POLICY building_access_rules_owner_delete ON public.building_access_rules AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY anon_read_bids ON public.cached_bids AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY anon_read_companies ON public.cached_companies AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY anon_read_jobs ON public.cached_jobs AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY certifications_all_own ON public.certifications AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "gc reads own CO approvals" ON public.change_order_approvals AS PERMISSIVE FOR SELECT TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = change_order_approvals.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY "gc records client CO approval in own portal" ON public.change_order_approvals AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.client_portal ->> 'portalId'::text) = change_order_approvals.portal_id) AND (p.user_id = auth.uid())))));
CREATE POLICY "gc stamps own CO approvals" ON public.change_order_approvals AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = change_order_approvals.project_id) AND (p.user_id = auth.uid()))))))
  WITH CHECK (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = change_order_approvals.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY change_orders_delete ON public.change_orders AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY change_orders_insert ON public.change_orders AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY change_orders_select ON public.change_orders AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY change_orders_update ON public.change_orders AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY co_delete_own ON public.change_orders AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY co_insert_own ON public.change_orders AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY co_select_own ON public.change_orders AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY co_update_own ON public.change_orders AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY city_coords_read ON public.city_coords AS PERMISSIVE FOR SELECT TO public
  USING (true);
CREATE POLICY cb_gc_all ON public.closeout_binders AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id));
CREATE POLICY cois_owner_all ON public.cois AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY comm_events_delete ON public.comm_events AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY comm_events_insert ON public.comm_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY comm_events_select ON public.comm_events AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY comm_events_update ON public.comm_events AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY comm_insert_own ON public.comm_events AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY comm_select_own ON public.comm_events AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY commitments_owner_all ON public.commitments AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY companies_delete ON public.companies AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY companies_insert ON public.companies AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY companies_insert_auth ON public.companies AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY companies_select ON public.companies AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY companies_select_all ON public.companies AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY companies_update ON public.companies AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY companies_update_own ON public.companies AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contacts_delete ON public.contacts AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contacts_delete_own ON public.contacts AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contacts_insert ON public.contacts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY contacts_insert_own ON public.contacts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY contacts_select ON public.contacts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contacts_select_own ON public.contacts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contacts_update ON public.contacts AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contacts_update_own ON public.contacts AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contractor_licenses_delete_own ON public.contractor_licenses AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contractor_licenses_insert_own ON public.contractor_licenses AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY contractor_licenses_select_own ON public.contractor_licenses AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contractor_licenses_update_own ON public.contractor_licenses AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY conversation_participants_select ON public.conversation_participants AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY cp_delete_own ON public.conversation_participants AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY cp_insert_self ON public.conversation_participants AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY cp_select_own ON public.conversation_participants AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY conversations_select ON public.conversations AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid())::text IN ( SELECT jsonb_array_elements_text(conversations.participant_ids) AS jsonb_array_elements_text)));
CREATE POLICY conversations_update ON public.conversations AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid())::text IN ( SELECT jsonb_array_elements_text(conversations.participant_ids) AS jsonb_array_elements_text)));
CREATE POLICY convo_insert_self_in_participants ON public.conversations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid())::text IN ( SELECT jsonb_array_elements_text(conversations.participant_ids) AS jsonb_array_elements_text)));
CREATE POLICY convo_select_participant ON public.conversations AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = conversations.id) AND (cp.user_id = auth.uid())))));
CREATE POLICY convo_update_participant ON public.conversations AS PERMISSIVE FOR UPDATE TO public
  USING ((EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = conversations.id) AND (cp.user_id = auth.uid())))));
CREATE POLICY cbs_own ON public.cost_benchmark_samples AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY cost_seeds_delete ON public.cost_seeds AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY cost_seeds_insert ON public.cost_seeds AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY cost_seeds_select ON public.cost_seeds AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY cost_seeds_update ON public.cost_seeds AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY crew_delete_own ON public.crew_members AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY crew_insert_own ON public.crew_members AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY crew_select_own_or_claimed ON public.crew_members AS PERMISSIVE FOR SELECT TO public
  USING (((auth.uid() = user_id) OR (auth.uid() = claimed_by_user_id)));
CREATE POLICY crew_update_own_or_claimed ON public.crew_members AS PERMISSIVE FOR UPDATE TO public
  USING (((auth.uid() = user_id) OR (auth.uid() = claimed_by_user_id)))
  WITH CHECK (((auth.uid() = user_id) OR (auth.uid() = claimed_by_user_id)));
CREATE POLICY daily_reports_collab_delete ON public.daily_reports AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (daily_reports.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY daily_reports_collab_insert ON public.daily_reports AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY daily_reports_collab_select ON public.daily_reports AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY daily_reports_collab_update ON public.daily_reports AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY delay_events_delete_own ON public.delay_events AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY delay_events_insert_own ON public.delay_events AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY delay_events_select_own ON public.delay_events AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY delay_events_update_own ON public.delay_events AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY deliveries_collab_insert ON public.deliveries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'field'::text)));
CREATE POLICY deliveries_collab_select ON public.deliveries AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY deliveries_collab_update ON public.deliveries AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'field'::text))
  WITH CHECK (can_access_project(project_id, 'field'::text));
CREATE POLICY deliveries_owner_delete ON public.deliveries AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth.uid() = user_id));
CREATE POLICY delivery_receipts_delete_own ON public.delivery_receipts AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY delivery_receipts_insert_own ON public.delivery_receipts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY delivery_receipts_select_own ON public.delivery_receipts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY delivery_receipts_update_own ON public.delivery_receipts AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY draw_periods_delete_own ON public.draw_periods AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY draw_periods_insert_own ON public.draw_periods AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY draw_periods_select_own ON public.draw_periods AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY draw_periods_update_own ON public.draw_periods AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY drawing_pins_collab_delete ON public.drawing_pins AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (drawing_pins.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY drawing_pins_collab_insert ON public.drawing_pins AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY drawing_pins_collab_select ON public.drawing_pins AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY drawing_pins_collab_update ON public.drawing_pins AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY equip_delete_own ON public.equipment AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY equip_insert_own ON public.equipment AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY equip_select_own ON public.equipment AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY equip_update_own ON public.equipment AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY equipment_delete ON public.equipment AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY equipment_insert ON public.equipment AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY equipment_select ON public.equipment AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY equipment_update ON public.equipment AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY est_versions_delete_own ON public.estimate_versions AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY est_versions_insert_own ON public.estimate_versions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY est_versions_select_own ON public.estimate_versions AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY estimate_versions_all ON public.estimate_versions AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "users delete own interest" ON public.feature_interest AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY "users insert own interest" ON public.feature_interest AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "users select own interest" ON public.feature_interest AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY field_tickets_collab_delete ON public.field_tickets AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = field_tickets.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY field_tickets_collab_insert ON public.field_tickets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY field_tickets_collab_select ON public.field_tickets AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY field_tickets_collab_update ON public.field_tickets AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY financing_referrals_owner_all ON public.financing_referrals AS PERMISSIVE FOR ALL TO authenticated
  USING ((gc_user_id = auth.uid()))
  WITH CHECK ((gc_user_id = auth.uid()));
CREATE POLICY geocode_run_lock_select ON public.geocode_run_lock AS PERMISSIVE FOR SELECT TO anon, authenticated
  USING (true);
CREATE POLICY hazards_delete_own ON public.hazards AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY hazards_insert_own ON public.hazards AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY hazards_select_own ON public.hazards AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY hazards_update_own ON public.hazards AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY inv_delete_own ON public.invoices AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY inv_insert_own ON public.invoices AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY inv_select_own ON public.invoices AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY inv_update_own ON public.invoices AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY invoices_delete ON public.invoices AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY invoices_insert ON public.invoices AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY invoices_select ON public.invoices AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY invoices_update ON public.invoices AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY jhas_delete_own ON public.jhas AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY jhas_insert_own ON public.jhas AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY jhas_select_own ON public.jhas AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY jhas_update_own ON public.jhas AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY job_listings_delete ON public.job_listings AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY job_listings_insert ON public.job_listings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY job_listings_select ON public.job_listings AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY job_listings_update ON public.job_listings AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY jobs_delete_own ON public.job_listings AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY jobs_insert_auth ON public.job_listings AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY jobs_select_all ON public.job_listings AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY jobs_update_own ON public.job_listings AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY labor_rates_select_all ON public.labor_rates AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY leads_owner_all ON public.leads AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY lw_gc_delete ON public.lien_waivers AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY lw_gc_insert ON public.lien_waivers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY lw_gc_select ON public.lien_waivers AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY lw_gc_update ON public.lien_waivers AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY material_prices_select_all ON public.material_prices AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY materials_select_all ON public.materials_pricing AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY mcp_tokens_delete_own ON public.mcp_tokens AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY mcp_tokens_insert_own ON public.mcp_tokens AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY mcp_tokens_select_own ON public.mcp_tokens AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY mcp_tokens_update_own ON public.mcp_tokens AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY memory_embeddings_owner ON public.memory_embeddings AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY messages_insert ON public.messages AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = sender_id));
CREATE POLICY messages_select ON public.messages AS PERMISSIVE FOR SELECT TO public
  USING ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid())::text IN ( SELECT jsonb_array_elements_text(c.participant_ids) AS jsonb_array_elements_text))))));
CREATE POLICY "users delete own outbox" ON public.notification_outbox AS PERMISSIVE FOR DELETE TO authenticated
  USING ((recipient_user_id = auth.uid()));
CREATE POLICY "users read own outbox" ON public.notification_outbox AS PERMISSIVE FOR SELECT TO authenticated
  USING ((recipient_user_id = auth.uid()));
CREATE POLICY "users update own outbox" ON public.notification_outbox AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((recipient_user_id = auth.uid()))
  WITH CHECK ((recipient_user_id = auth.uid()));
CREATE POLICY oac_meetings_owner_all ON public.oac_meetings AS PERMISSIVE FOR ALL TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY owner_supplied_delete_own ON public.owner_supplied_items AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY owner_supplied_insert_own ON public.owner_supplied_items AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY owner_supplied_select_own ON public.owner_supplied_items AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY owner_supplied_update_own ON public.owner_supplied_items AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY permit_templates_delete_own ON public.permit_templates AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY permit_templates_insert_own ON public.permit_templates AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY permit_templates_select_own ON public.permit_templates AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY permit_templates_update_own ON public.permit_templates AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY permits_collab_delete ON public.permits AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (permits.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY permits_collab_insert ON public.permits AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY permits_collab_select ON public.permits AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY permits_collab_update ON public.permits AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY photos_collab_delete ON public.photos AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (photos.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY photos_collab_insert ON public.photos AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY photos_collab_select ON public.photos AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY photos_collab_update ON public.photos AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY plan_calibrations_collab_delete ON public.plan_calibrations AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (plan_calibrations.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY plan_calibrations_collab_insert ON public.plan_calibrations AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY plan_calibrations_collab_select ON public.plan_calibrations AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY plan_calibrations_collab_update ON public.plan_calibrations AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY plan_markups_collab_delete ON public.plan_markups AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (plan_markups.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY plan_markups_collab_insert ON public.plan_markups AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY plan_markups_collab_select ON public.plan_markups AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY plan_markups_collab_update ON public.plan_markups AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY plan_sheets_collab_delete ON public.plan_sheets AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (plan_sheets.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY plan_sheets_collab_insert ON public.plan_sheets AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY plan_sheets_collab_select ON public.plan_sheets AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY plan_sheets_collab_update ON public.plan_sheets AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY "gc can read own proposals" ON public.portal_budget_proposals AS PERMISSIVE FOR SELECT TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_budget_proposals.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY "gc can update own proposals" ON public.portal_budget_proposals AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_budget_proposals.project_id) AND (p.user_id = auth.uid()))))))
  WITH CHECK (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_budget_proposals.project_id) AND (p.user_id = auth.uid())))) AND (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text]))));
CREATE POLICY "gc reads own portal audit" ON public.portal_decision_audit AS PERMISSIVE FOR SELECT TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = portal_decision_audit.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY "gc inserts own portal messages" ON public.portal_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((author_type = 'gc'::text) AND (project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_messages.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY "gc reads own portal messages" ON public.portal_messages AS PERMISSIVE FOR SELECT TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_messages.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY "gc records client message in own portal" ON public.portal_messages AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((author_type = 'client'::text) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.client_portal ->> 'portalId'::text) = portal_messages.portal_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY "gc updates read receipts" ON public.portal_messages AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_messages.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY portal_snapshots_owner_write ON public.portal_snapshots AS PERMISSIVE FOR ALL TO authenticated
  USING ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid()))))
  WITH CHECK ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid()))));
CREATE POLICY prequal_packets_owner_all ON public.prequal_packets AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY alerts_delete_own ON public.price_alerts AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY alerts_insert_own ON public.price_alerts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY alerts_select_own ON public.price_alerts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY alerts_update_own ON public.price_alerts AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY price_alerts_delete ON public.price_alerts AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY price_alerts_insert ON public.price_alerts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY price_alerts_select ON public.price_alerts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY price_alerts_update ON public.price_alerts AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY gc_reads_own_pro_responses ON public.pro_responses AS PERMISSIVE FOR SELECT TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM rfis r
  WHERE ((r.id = pro_responses.rfi_id) AND (r.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM submittals s
  WHERE ((s.id = pro_responses.submittal_id) AND (s.user_id = auth.uid()))))));
CREATE POLICY profiles_insert ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_insert_own ON public.profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = id));
CREATE POLICY profiles_select ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
CREATE POLICY profiles_select_own ON public.profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = id));
CREATE POLICY profiles_update ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id));
CREATE POLICY profiles_update_own ON public.profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = id));
CREATE POLICY pc_invitee_read ON public.project_collaborators AS PERMISSIVE FOR SELECT TO authenticated
  USING (((user_id = auth.uid()) OR (lower(invited_email) = lower((auth.jwt() ->> 'email'::text)))));
CREATE POLICY pc_owner_all ON public.project_collaborators AS PERMISSIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_collaborators.project_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_collaborators.project_id) AND (p.user_id = auth.uid())))));
CREATE POLICY contracts_gc_delete ON public.project_contracts AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contracts_gc_insert ON public.project_contracts AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY contracts_gc_select ON public.project_contracts AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY contracts_gc_update ON public.project_contracts AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY project_financials_delete ON public.project_financials AS PERMISSIVE FOR DELETE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_financials.project_id) AND (p.user_id = auth.uid())))));
CREATE POLICY project_financials_insert ON public.project_financials AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY project_financials_select ON public.project_financials AS PERMISSIVE FOR SELECT TO authenticated
  USING (can_view_project_financials(project_id));
CREATE POLICY project_financials_update ON public.project_financials AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY projects_delete ON public.projects AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY projects_delete_own ON public.projects AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY projects_insert ON public.projects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY projects_insert_own ON public.projects AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY projects_select ON public.projects AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR is_project_collaborator(id)));
CREATE POLICY projects_update ON public.projects AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth.uid() = user_id) OR is_project_collaborator(id, 'editor'::text)))
  WITH CHECK (((auth.uid() = user_id) OR is_project_collaborator(id, 'editor'::text)));
CREATE POLICY bids_delete_own ON public.public_bids AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY bids_insert_auth ON public.public_bids AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY bids_select_all ON public.public_bids AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY bids_update_own ON public.public_bids AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY public_bids_delete ON public.public_bids AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY public_bids_insert ON public.public_bids AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY public_bids_select ON public.public_bids AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY public_bids_update ON public.public_bids AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY punch_items_collab_delete ON public.punch_items AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (punch_items.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY punch_items_collab_insert ON public.punch_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY punch_items_collab_select ON public.punch_items AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY punch_items_collab_update ON public.punch_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY qbo_connections_owner ON public.qbo_connections AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY qbo_cost_lines_owner ON public.qbo_cost_lines AS PERMISSIVE FOR ALL TO public
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY rate_overrides_owner_all ON public.rate_overrides AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY rfis_collab_delete ON public.rfis AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (rfis.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY rfis_collab_insert ON public.rfis AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY rfis_collab_select ON public.rfis AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY rfis_collab_update ON public.rfis AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY rfp_credits_select_own ON public.rfp_post_credits AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY rfp_payments_select_own ON public.rfp_post_payments AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY incidents_delete_own ON public.safety_incidents AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY incidents_insert_own ON public.safety_incidents AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY incidents_select_own ON public.safety_incidents AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY incidents_update_own ON public.safety_incidents AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY safety_inspections_all_own ON public.safety_inspections AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY safety_templates_all_own ON public.safety_templates AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY scan_records_delete_own ON public.scan_records AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY scan_records_insert_own ON public.scan_records AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY scan_records_select_own ON public.scan_records AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY scan_records_update_own ON public.scan_records AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY selcat_gc_delete ON public.selection_categories AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY selcat_gc_insert ON public.selection_categories AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY selcat_gc_select ON public.selection_categories AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY selcat_gc_update ON public.selection_categories AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY selopt_gc_all ON public.selection_options AS PERMISSIVE FOR ALL TO public
  USING ((EXISTS ( SELECT 1
   FROM selection_categories c
  WHERE ((c.id = selection_options.category_id) AND (c.user_id = auth.uid())))));
CREATE POLICY shared_schedule_snapshots_owner_write ON public.shared_schedule_snapshots AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY sub_change_requests_delete_own ON public.sub_change_requests AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY sub_change_requests_no_anon_write ON public.sub_change_requests AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY sub_change_requests_select_own ON public.sub_change_requests AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY sub_change_requests_update_own ON public.sub_change_requests AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "gc deletes own sub portal links" ON public.sub_portal_links AS PERMISSIVE FOR DELETE TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "gc reads own sub portal links" ON public.sub_portal_links AS PERMISSIVE FOR SELECT TO authenticated
  USING ((user_id = auth.uid()));
CREATE POLICY "gc updates own sub portal links" ON public.sub_portal_links AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "gc writes own sub portal links" ON public.sub_portal_links AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((user_id = auth.uid()));
CREATE POLICY sub_portal_snapshots_owner_write ON public.sub_portal_snapshots AS PERMISSIVE FOR ALL TO authenticated
  USING ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid()))))
  WITH CHECK ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid()))));
CREATE POLICY "gc reads sub invoices for own portals" ON public.sub_submitted_invoices AS PERMISSIVE FOR SELECT TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sub_portal_links spl
  WHERE ((spl.id = sub_submitted_invoices.sub_portal_id) AND (spl.user_id = auth.uid())))));
CREATE POLICY "gc updates sub invoices for own portals" ON public.sub_submitted_invoices AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sub_portal_links spl
  WHERE ((spl.id = sub_submitted_invoices.sub_portal_id) AND (spl.user_id = auth.uid())))))
  WITH CHECK (((EXISTS ( SELECT 1
   FROM sub_portal_links spl
  WHERE ((spl.id = sub_submitted_invoices.sub_portal_id) AND (spl.user_id = auth.uid())))) AND (status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'paid'::text]))));
CREATE POLICY subcontractors_delete ON public.subcontractors AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY subcontractors_insert ON public.subcontractors AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY subcontractors_select ON public.subcontractors AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY subcontractors_update ON public.subcontractors AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY subs_delete_own ON public.subcontractors AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY subs_insert_own ON public.subcontractors AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY subs_select_own ON public.subcontractors AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY subs_update_own ON public.subcontractors AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY submittals_collab_delete ON public.submittals AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = (submittals.project_id)::text) AND (p.user_id = auth.uid()))))));
CREATE POLICY submittals_collab_insert ON public.submittals AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY submittals_collab_select ON public.submittals AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY submittals_collab_update ON public.submittals AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY subs_tier_insert_own ON public.subscriptions AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY subs_tier_select_own ON public.subscriptions AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY subs_tier_update_own ON public.subscriptions AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY time_entries_collab_delete ON public.time_entries AS PERMISSIVE FOR DELETE TO authenticated
  USING (((auth.uid() = user_id) OR (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = time_entries.project_id) AND (p.user_id = auth.uid()))))));
CREATE POLICY time_entries_collab_insert ON public.time_entries AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (((auth.uid() = user_id) AND can_access_project(project_id, 'editor'::text)));
CREATE POLICY time_entries_collab_select ON public.time_entries AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth.uid() = user_id) OR can_access_project(project_id)));
CREATE POLICY time_entries_collab_update ON public.time_entries AS PERMISSIVE FOR UPDATE TO authenticated
  USING (can_access_project(project_id, 'editor'::text))
  WITH CHECK (can_access_project(project_id, 'editor'::text));
CREATE POLICY toolbox_delete_own ON public.toolbox_talks AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY toolbox_insert_own ON public.toolbox_talks AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY toolbox_select_own ON public.toolbox_talks AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY toolbox_update_own ON public.toolbox_talks AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY tracked_bids_delete_own ON public.user_tracked_bids AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY tracked_bids_insert_own ON public.user_tracked_bids AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY tracked_bids_select_own ON public.user_tracked_bids AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY tracked_bids_update_own ON public.user_tracked_bids AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY user_tracked_bids_all ON public.user_tracked_bids AS PERMISSIVE FOR ALL TO public
  USING ((auth.uid() = user_id));
CREATE POLICY warranties_owner_all ON public.warranties AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY wip_periods_delete_own ON public.wip_periods AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY wip_periods_insert_own ON public.wip_periods AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY wip_periods_select_own ON public.wip_periods AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY wip_periods_update_own ON public.wip_periods AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY worker_profiles_delete ON public.worker_profiles AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY worker_profiles_insert ON public.worker_profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY worker_profiles_select ON public.worker_profiles AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);
CREATE POLICY worker_profiles_update ON public.worker_profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY workers_insert_auth ON public.worker_profiles AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY workers_select_all ON public.worker_profiles AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));
CREATE POLICY workers_update_own ON public.worker_profiles AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY workers_delete_own ON public.workers AS PERMISSIVE FOR DELETE TO public
  USING ((auth.uid() = user_id));
CREATE POLICY workers_insert_own ON public.workers AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY workers_select_own ON public.workers AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() = user_id));
CREATE POLICY workers_update_own ON public.workers AS PERMISSIVE FOR UPDATE TO public
  USING ((auth.uid() = user_id))
  WITH CHECK ((auth.uid() = user_id));
CREATE POLICY zip_factors_select_all ON public.zip_cost_factors AS PERMISSIVE FOR SELECT TO public
  USING ((auth.role() = 'authenticated'::text));

-- =============================================================================
-- SECTION 6 — TRIGGERS (56)
--
-- All non-internal triggers (pg_trigger where NOT tgisinternal), rendered by
-- pg_get_triggerdef. Ordered by (table, trigger name). Constraint-enforcement
-- triggers created implicitly by foreign keys are internal and excluded.
-- =============================================================================

CREATE TRIGGER trg_freeze_certified_aia_pay_app BEFORE UPDATE ON public.aia_pay_apps FOR EACH ROW EXECUTE FUNCTION freeze_certified_aia_pay_app();
CREATE TRIGGER certifications_updated_at BEFORE UPDATE ON public.certifications FOR EACH ROW EXECUTE FUNCTION safety_wave_b_set_updated_at();
CREATE TRIGGER change_order_approvals_freeze BEFORE UPDATE ON public.change_order_approvals FOR EACH ROW EXECUTE FUNCTION co_approval_freeze_evidence();
CREATE TRIGGER notify_co_approval AFTER INSERT ON public.change_order_approvals FOR EACH ROW EXECUTE FUNCTION trg_notify_co_approval();
CREATE TRIGGER trg_resolve_co_approval_project BEFORE INSERT ON public.change_order_approvals FOR EACH ROW EXECUTE FUNCTION resolve_co_approval_project();
CREATE TRIGGER change_orders_updated_at BEFORE UPDATE ON public.change_orders FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER closeout_binders_updated_at BEFORE UPDATE ON public.closeout_binders FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER cois_updated_at BEFORE UPDATE ON public.cois FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER contacts_updated_at BEFORE UPDATE ON public.contacts FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER cost_seeds_updated_at BEFORE UPDATE ON public.cost_seeds FOR EACH ROW EXECUTE FUNCTION cost_seeds_set_updated_at();
CREATE TRIGGER crew_members_freeze_ownership BEFORE UPDATE ON public.crew_members FOR EACH ROW EXECUTE FUNCTION crew_freeze_ownership_columns();
CREATE TRIGGER crew_members_updated_at BEFORE UPDATE ON public.crew_members FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER daily_reports_updated_at BEFORE UPDATE ON public.daily_reports FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER delay_events_updated_at BEFORE UPDATE ON public.delay_events FOR EACH ROW EXECUTE FUNCTION delay_events_set_updated_at();
CREATE TRIGGER drawing_pins_updated_at BEFORE UPDATE ON public.drawing_pins FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER equipment_updated_at BEFORE UPDATE ON public.equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER field_tickets_updated_at BEFORE UPDATE ON public.field_tickets FOR EACH ROW EXECUTE FUNCTION field_tickets_set_updated_at();
CREATE TRIGGER hazards_updated_at BEFORE UPDATE ON public.hazards FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER jhas_updated_at BEFORE UPDATE ON public.jhas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER lien_waivers_updated_at BEFORE UPDATE ON public.lien_waivers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER oac_meetings_updated_at BEFORE UPDATE ON public.oac_meetings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER plan_sheets_updated_at BEFORE UPDATE ON public.plan_sheets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER notify_budget_proposal AFTER INSERT ON public.portal_budget_proposals FOR EACH ROW EXECUTE FUNCTION trg_notify_budget_proposal();
CREATE TRIGGER portal_budget_proposals_freeze BEFORE UPDATE ON public.portal_budget_proposals FOR EACH ROW EXECUTE FUNCTION portal_proposal_freeze_project();
CREATE TRIGGER trg_resolve_portal_project_id BEFORE INSERT ON public.portal_budget_proposals FOR EACH ROW EXECUTE FUNCTION resolve_portal_project_id();
CREATE TRIGGER notify_portal_message AFTER INSERT ON public.portal_messages FOR EACH ROW EXECUTE FUNCTION notify_portal_message_fn();
CREATE TRIGGER trg_resolve_portal_msg_project BEFORE INSERT ON public.portal_messages FOR EACH ROW EXECUTE FUNCTION resolve_portal_msg_project();
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER project_contracts_updated_at BEFORE UPDATE ON public.project_contracts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER enforce_free_tier_project_cap_trigger BEFORE INSERT ON public.projects FOR EACH ROW EXECUTE FUNCTION enforce_free_tier_project_cap();
CREATE TRIGGER projects_freeze_ownership BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION projects_freeze_ownership_columns();
CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_portal_access_token BEFORE INSERT OR UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION portal_set_access_token();
CREATE TRIGGER public_bids_notify_nearby AFTER INSERT ON public.public_bids FOR EACH ROW EXECUTE FUNCTION public_bids_notify_nearby_fn();
CREATE TRIGGER punch_items_updated_at BEFORE UPDATE ON public.punch_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_qbo_connections_touch BEFORE UPDATE ON public.qbo_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER rfis_updated_at BEFORE UPDATE ON public.rfis FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER safety_incidents_updated_at BEFORE UPDATE ON public.safety_incidents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER safety_inspections_updated_at BEFORE UPDATE ON public.safety_inspections FOR EACH ROW EXECUTE FUNCTION safety_wave_b_set_updated_at();
CREATE TRIGGER safety_templates_updated_at BEFORE UPDATE ON public.safety_templates FOR EACH ROW EXECUTE FUNCTION safety_wave_b_set_updated_at();
CREATE TRIGGER scan_records_updated_at BEFORE UPDATE ON public.scan_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER selection_categories_updated_at BEFORE UPDATE ON public.selection_categories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER notify_sub_invoice AFTER INSERT ON public.sub_submitted_invoices FOR EACH ROW EXECUTE FUNCTION trg_notify_sub_invoice();
CREATE TRIGGER notify_sub_invoice_reviewed AFTER UPDATE ON public.sub_submitted_invoices FOR EACH ROW EXECUTE FUNCTION trg_notify_sub_invoice_reviewed();
CREATE TRIGGER sub_invoice_recompute_commitment AFTER INSERT OR DELETE OR UPDATE ON public.sub_submitted_invoices FOR EACH ROW EXECUTE FUNCTION recompute_commitment_paid_to_date();
CREATE TRIGGER sub_submitted_invoices_freeze BEFORE UPDATE ON public.sub_submitted_invoices FOR EACH ROW EXECUTE FUNCTION sub_invoice_freeze_columns();
CREATE TRIGGER trg_resolve_sub_invoice_project BEFORE INSERT ON public.sub_submitted_invoices FOR EACH ROW EXECUTE FUNCTION resolve_sub_invoice_project();
CREATE TRIGGER subcontractors_updated_at BEFORE UPDATE ON public.subcontractors FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER submittals_updated_at BEFORE UPDATE ON public.submittals FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_enforce_subscription_tier BEFORE INSERT OR UPDATE ON public.subscriptions FOR EACH ROW EXECUTE FUNCTION enforce_subscription_tier_authority();
CREATE TRIGGER time_entries_updated_at BEFORE UPDATE ON public.time_entries FOR EACH ROW EXECUTE FUNCTION time_entries_set_updated_at();
CREATE TRIGGER toolbox_talks_updated_at BEFORE UPDATE ON public.toolbox_talks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER wip_periods_block_locked_update BEFORE UPDATE ON public.wip_periods FOR EACH ROW EXECUTE FUNCTION wip_periods_block_locked_update();
CREATE TRIGGER wip_periods_updated_at BEFORE UPDATE ON public.wip_periods FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================================================
-- SECTION 7 — FUNCTIONS (82 application functions)
--
-- SCOPE NOTE, PLEASE READ:
--   pg_proc reports 200 routines in the `public` schema. 118 of those belong
--   to the `vector` (pgvector) extension, which is installed into `public`:
--   114 C-language functions and 4 aggregates (avg(vector), avg(halfvec),
--   sum(vector), sum(halfvec)). Those are extension-owned, are recreated by
--   CREATE EXTENSION, and are deliberately NOT reproduced here — dumping their
--   C stubs would add noise without adding information.
--
--   What follows are the 82 functions that are actually this application's
--   own code (pg_proc rows with no `pg_depend` extension dependency),
--   rendered in full by pg_get_functiondef. 59 of the 82 are SECURITY
--   DEFINER, so this section is the relevant surface for security review.
--   (The four functions added on 2026-09-02 are plain trigger functions, not
--   SECURITY DEFINER. The two added on 2026-09-03 — `can_view_project_financials`
--   and `portal_get_snapshot_v2` — are both SECURITY DEFINER, so 57 -> 59.)
--
--   200 = 82 application + 114 vector functions + 4 vector aggregates.
--
-- Ordered by (function name, identity arguments); overloads appear together.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ai_daily_usage_get(p_user_id uuid)
 RETURNS TABLE(count integer, smart_count integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid  uuid;
  v_date date;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_date := current_date;
  RETURN QUERY
    SELECT COALESCE(u.count, 0), COALESCE(u.smart_count, 0)
      FROM (SELECT 1) _
      LEFT JOIN ai_daily_usage u
        ON u.user_id = v_uid
       AND u.usage_date = v_date;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_daily_usage_increment(p_user_id uuid, p_tier text DEFAULT 'fast'::text)
 RETURNS TABLE(count integer, smart_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_date  date;
  v_smart_delta int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_date := current_date;
  v_smart_delta := CASE WHEN p_tier = 'smart' THEN 1 ELSE 0 END;

  INSERT INTO ai_daily_usage (user_id, usage_date, count, smart_count, updated_at)
  VALUES (v_uid, v_date, 1, v_smart_delta, now())
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET count = ai_daily_usage.count + 1,
        smart_count = ai_daily_usage.smart_count + v_smart_delta,
        updated_at = now();

  RETURN QUERY
    SELECT u.count, u.smart_count
      FROM ai_daily_usage u
     WHERE u.user_id = v_uid
       AND u.usage_date = v_date
     LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_usage_daily_get(p_user_id uuid, p_feature text)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT count FROM ai_usage_counters
      WHERE user_id = COALESCE(auth.uid(), p_user_id)
        AND feature = p_feature
        AND month_bucket = CURRENT_DATE),
    0
  );
$function$
;

CREATE OR REPLACE FUNCTION public.ai_usage_daily_increment(p_user_id uuid, p_feature text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_today date;
  v_count int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_today := CURRENT_DATE;
  INSERT INTO ai_usage_counters (user_id, month_bucket, feature, count)
  VALUES (v_uid, v_today, p_feature, 1)
  ON CONFLICT (user_id, month_bucket, feature) DO UPDATE
    SET count = ai_usage_counters.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_usage_get(p_user_id uuid, p_feature text)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_month date;
  v_count int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_month := date_trunc('month', NOW())::date;
  SELECT count INTO v_count
    FROM ai_usage_counters
   WHERE user_id = v_uid
     AND month_bucket = v_month
     AND feature = p_feature
   LIMIT 1;
  RETURN COALESCE(v_count, 0);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_usage_increment(p_user_id uuid, p_feature text, p_amount integer DEFAULT 1)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_month date;
  v_count int;
  v_amount int;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_month := date_trunc('month', NOW())::date;
  v_amount := GREATEST(COALESCE(p_amount, 1), 1);

  INSERT INTO ai_usage_counters (user_id, month_bucket, feature, count)
  VALUES (v_uid, v_month, p_feature, v_amount)
  ON CONFLICT (user_id, month_bucket, feature) DO UPDATE
    SET count = ai_usage_counters.count + v_amount
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_user_id uuid)
 RETURNS TABLE(feature text, used integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   uuid;
  v_month date;
BEGIN
  v_uid := COALESCE(auth.uid(), p_user_id);
  v_month := date_trunc('month', NOW())::date;
  RETURN QUERY
    SELECT u.feature, u.count
      FROM ai_usage_counters u
     WHERE u.user_id = v_uid
       AND u.month_bucket = v_month;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.award_rfp(p_homeowner_id uuid, p_bid_id uuid, p_response_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bid     RECORD;
  v_winner  RECORD;
  v_project_id UUID := gen_random_uuid();
  v_portal_id  UUID := gen_random_uuid();
  v_now        TIMESTAMPTZ := NOW();
BEGIN
  SELECT id, user_id, status, title, scope_description, city, state,
         photo_urls, drawing_urls, awarded_response_id
    INTO v_bid
    FROM public.public_bids WHERE id = p_bid_id;
  IF v_bid IS NULL THEN
    RAISE EXCEPTION 'RFP not found';
  END IF;
  IF v_bid.user_id IS DISTINCT FROM p_homeowner_id THEN
    RAISE EXCEPTION 'Not your RFP';
  END IF;
  -- Defense-in-depth: a JWT-bearing (direct) caller must be the RFP owner.
  -- service_role (edge function) has null auth.uid() and falls through to the
  -- verified p_homeowner_id check above.
  IF auth.uid() IS NOT NULL AND v_bid.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not your RFP';
  END IF;
  IF v_bid.awarded_response_id IS NOT NULL THEN
    RAISE EXCEPTION 'RFP already awarded';
  END IF;

  SELECT id, bid_id, user_id, company_name, bid_amount, estimate_summary,
         proposer_email, proposer_phone
    INTO v_winner
    FROM public.bid_responses WHERE id = p_response_id;
  IF v_winner IS NULL THEN
    RAISE EXCEPTION 'Response not found';
  END IF;
  IF v_winner.bid_id IS DISTINCT FROM p_bid_id THEN
    RAISE EXCEPTION 'Response does not belong to this RFP';
  END IF;

  INSERT INTO public.projects (
    id, user_id, name, type, location, square_footage, quality, description,
    status, client_portal
  ) VALUES (
    v_project_id, v_winner.user_id,
    v_bid.title, 'awarded_rfp',
    COALESCE(NULLIF(CONCAT_WS(', ', v_bid.city, v_bid.state), ''), ''),
    0, 'standard',
    COALESCE(v_bid.scope_description, ''),
    'in_progress',
    jsonb_build_object(
      'enabled', TRUE,
      'portalId', v_portal_id::text,
      'requirePasscode', FALSE,
      'welcomeMessage', 'Welcome! This portal is for the project we just awarded.',
      'coApprovalEnabled', TRUE,
      'sections', jsonb_build_object(
        'schedule', TRUE, 'budget', TRUE, 'invoices', TRUE,
        'changeOrders', TRUE, 'photos', TRUE, 'dailyReports', TRUE,
        'rfis', TRUE, 'documents', TRUE
      ),
      'invites', jsonb_build_array(jsonb_build_object(
        'id', gen_random_uuid()::text,
        'name', '',
        'email', '',
        'status', 'pending',
        'createdAt', v_now
      ))
    )
  );

  UPDATE public.bid_responses
    SET status='awarded', awarded_project_id=v_project_id, responded_at=v_now
    WHERE id = p_response_id;

  UPDATE public.bid_responses
    SET status='declined', responded_at=v_now
    WHERE bid_id=p_bid_id
      AND id <> p_response_id
      AND status IN ('submitted','shortlisted');

  UPDATE public.public_bids
    SET status='closed', awarded_response_id=p_response_id, awarded_at=v_now
    WHERE id=p_bid_id;

  RETURN jsonb_build_object(
    'success',         TRUE,
    'projectId',       v_project_id,
    'portalId',        v_portal_id,
    'winnerUserId',    v_winner.user_id,
    'winnerEmail',     v_winner.proposer_email,
    'projectName',     v_bid.title
  );
END
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_project(pid text, min_role text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare u uuid;
begin
  begin u := pid::uuid; exception when others then return false; end;
  return public.can_access_project(u, min_role);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.can_access_project(pid uuid, min_role text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (select 1 from public.projects p where p.id = pid and p.user_id = auth.uid())
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid and pc.user_id = auth.uid() and pc.status = 'accepted'
        and case min_role when 'editor' then pc.role in ('owner','editor') else true end
    );
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_project_financials(pid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    exists (
      select 1 from public.projects p
      where p.id = pid and p.user_id = auth.uid()
    )
    or exists (
      select 1 from public.project_collaborators pc
      where pc.project_id = pid
        and pc.user_id = auth.uid()
        and pc.status = 'accepted'
        and pc.role in ('owner','editor','viewer')   -- 'field' excluded
    );
$function$
;

CREATE OR REPLACE FUNCTION public.co_approval_freeze_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if auth.uid() is not null then
    new.id               := old.id;
    new.portal_id        := old.portal_id;
    new.project_id       := old.project_id;
    new.invite_id        := old.invite_id;
    new.change_order_id  := old.change_order_id;
    new.decision         := old.decision;
    new.signer_name      := old.signer_name;
    new.signer_email     := old.signer_email;
    new.signature_data   := old.signature_data;
    new.note             := old.note;
    new.user_agent       := old.user_agent;
    new.created_at       := old.created_at;
    new.signature_hash   := old.signature_hash;
    new.consent_record   := old.consent_record;
    new.document_hash    := old.document_hash;
    new.consent_version  := old.consent_version;
    new.consent_accepted := old.consent_accepted;
    new.sealed_at        := old.sealed_at;
    -- synced_to_co_at is deliberately NOT pinned. It is the one column an
    -- authenticated GC is allowed to write, and the whole point of this file.
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.consume_rfp_post_credit()
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  spent boolean;
begin
  update public.rfp_post_credits
     set credits = credits - 1, updated_at = now()
   where user_id = auth.uid() and credits > 0
  returning true into spent;
  return coalesce(spent, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cost_benchmark_stats(p_category text, p_unit text, p_region text DEFAULT 'US'::text)
 RETURNS TABLE(median numeric, p25 numeric, p75 numeric, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pool as (
    select unit_price
    from public.cost_benchmark_samples
    where category = lower(p_category)
      and unit = lower(p_unit)
      and (p_region = 'US' or region = p_region)
  ), agg as (
    select
      count(*)::int as n,
      percentile_cont(0.5)  within group (order by unit_price) as median,
      percentile_cont(0.25) within group (order by unit_price) as p25,
      percentile_cont(0.75) within group (order by unit_price) as p75
    from pool
  )
  select
    case when n >= 5 then median end,
    case when n >= 5 then p25 end,
    case when n >= 5 then p75 end,
    n
  from agg;
$function$
;

CREATE OR REPLACE FUNCTION public.cost_seeds_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.crew_freeze_ownership_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM OLD.user_id THEN
    NEW.user_id := OLD.user_id;
    NEW.claimed_by_user_id := OLD.claimed_by_user_id;
    NEW.claimed_at := OLD.claimed_at;
    NEW.claim_token := OLD.claim_token;
    NEW.id_verified := OLD.id_verified;
    NEW.id_type := OLD.id_type;
    NEW.id_masked_last4 := OLD.id_masked_last4;
    NEW.id_expiry := OLD.id_expiry;
    NEW.id_issuer := OLD.id_issuer;
    NEW.id_scanned_at := OLD.id_scanned_at;
    NEW.id_image_path := OLD.id_image_path;
    NEW.marketplace_profile_id := OLD.marketplace_profile_id;
    NEW.full_name := OLD.full_name;
    NEW.status := OLD.status;
    NEW.project_ids := OLD.project_ids;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.delay_events_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_free_tier_project_cap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier text;
  v_count int;
BEGIN
  IF EXISTS (SELECT 1 FROM projects WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  IF NEW.type = 'awarded_rfp' THEN
    RETURN NEW;
  END IF;

  SELECT tier INTO v_tier
  FROM subscriptions
  WHERE user_id = NEW.user_id
    AND (end_date IS NULL OR end_date > NOW())
  ORDER BY updated_at DESC
  LIMIT 1;

  IF v_tier IS NULL THEN
    v_tier := 'free';
  END IF;

  IF v_tier IN ('pro', 'business', 'enterprise') THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM projects
  WHERE user_id = NEW.user_id
    AND name NOT LIKE 'Sample — %';

  IF v_count >= 1 THEN
    RAISE EXCEPTION 'Free tier is limited to 1 project. Upgrade to Pro for unlimited projects.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_subscription_tier_authority()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_role text := auth.role();
begin
  if v_role is distinct from 'authenticated' and v_role is distinct from 'anon' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.tier := 'free';
  elsif tg_op = 'UPDATE' then
    new.tier := old.tier;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.fetch_shared_schedule(snapshot_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec record;
begin
  select id, payload, expires_at
    into rec
    from shared_schedule_snapshots
   where id = snapshot_id
     and expires_at > now()
   limit 1;
  if not found then
    return null;
  end if;
  begin
    update shared_schedule_snapshots
       set last_accessed_at = now()
     where id = snapshot_id;
  exception when others then
    null;
  end;
  return rec.payload;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.field_tickets_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fire_notify(p_event text, p_source_table text, p_source_id text, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value INTO v_url FROM public.app_config WHERE key = 'notify_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'notify_key';
  IF v_url IS NULL OR v_url = '' THEN
    RAISE NOTICE 'fire_notify: notify_url not configured';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_key, ''),
      'apikey', COALESCE(v_key, '')
    ),
    body := jsonb_build_object(
      'event', p_event,
      'source_table', p_source_table,
      'source_id', p_source_id,
      'payload', p_payload
    )
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'fire_notify failed: %', SQLERRM;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.freeze_certified_aia_pay_app()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if old.certified_at is not null then
    if ( new.application_number         is distinct from old.application_number
      or new.application_date           is distinct from old.application_date
      or new.period_to                  is distinct from old.period_to
      or new.contract_date              is distinct from old.contract_date
      or new.original_contract_sum      is distinct from old.original_contract_sum
      or new.net_change_by_co           is distinct from old.net_change_by_co
      or new.contract_sum_to_date       is distinct from old.contract_sum_to_date
      or new.retainage_percent          is distinct from old.retainage_percent
      or new.less_previous_certificates is distinct from old.less_previous_certificates
      or new.lines                      is distinct from old.lines
      or new.snapshot_totals            is distinct from old.snapshot_totals
      or new.owner_name                 is distinct from old.owner_name
      or new.contractor_name            is distinct from old.contractor_name
      or new.architect_name             is distinct from old.architect_name
      or new.project_name               is distinct from old.project_name
      or new.project_location           is distinct from old.project_location
      or new.contract_for_description   is distinct from old.contract_for_description
      or new.invoice_id                 is distinct from old.invoice_id
      or new.certified_at               is distinct from old.certified_at
    ) then
      raise exception
        'AIA pay application %/% is certified (sent for payment); its financial fields are immutable. Create the next application period instead.',
        old.project_id, old.application_number
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.gc_for_portal(p_portal_id text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT user_id FROM public.projects
  WHERE client_portal->>'portalId' = p_portal_id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.gc_for_sub_portal(p_portal_id text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT user_id FROM public.sub_portal_links
  WHERE id = p_portal_id
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.gc_user_for_company_slug(p_slug text)
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id
  from public.profiles p
  where coalesce(p.company_name, '') <> ''
    and left(
          trim(both '-' from regexp_replace(lower(p.company_name), '[^a-z0-9]+', '-', 'g')),
          60
        ) = lower(trim(coalesce(p_slug, '')))
  order by p.id
  limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_portal_snapshot(portal_id_in text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT snapshot
    FROM public.portal_snapshots
   WHERE portal_id = portal_id_in
   LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_rfi_by_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing token');
  END IF;

  SELECT jsonb_build_object(
    'id', r.id,
    'number', r.number,
    'subject', r.subject,
    'question', r.question,
    'submitted_by', r.submitted_by,
    'assigned_to', r.assigned_to,
    'date_submitted', r.date_submitted,
    'date_required', r.date_required,
    'priority', r.priority,
    'status', r.status,
    'linked_drawing', r.linked_drawing,
    'attachments', r.attachments,
    'project_name', p.name,
    'project_location', p.location,
    'company_name', COALESCE(prof.full_name, 'MAGE ID'),
    'company_email', prof.email,
    'has_existing_response', (r.response IS NOT NULL AND length(trim(r.response)) > 0)
  )
  INTO v_result
  FROM public.rfis r
  LEFT JOIN public.projects p ON p.id = r.project_id
  LEFT JOIN public.profiles prof ON prof.id = r.user_id
  WHERE r.share_token = p_token
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid or expired link');
  END IF;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_sub_portal_snapshot(sub_portal_id_in text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT snapshot
    FROM public.sub_portal_snapshots
   WHERE sub_portal_id = sub_portal_id_in
   LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_submittal_by_token(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('error', 'Missing token');
  END IF;

  SELECT jsonb_build_object(
    'id', s.id,
    'number', s.number,
    'title', s.title,
    'spec_section', s.spec_section,
    'submitted_by', s.submitted_by,
    'submitted_date', s.submitted_date,
    'required_date', s.required_date,
    'review_cycles', s.review_cycles,
    'current_status', s.current_status,
    'attachments', s.attachments,
    'project_name', p.name,
    'project_location', p.location,
    'company_name', COALESCE(prof.full_name, 'MAGE ID'),
    'company_email', prof.email
  )
  INTO v_result
  FROM public.submittals s
  LEFT JOIN public.projects p ON p.id = s.project_id
  LEFT JOIN public.profiles prof ON prof.id = s.user_id
  WHERE s.share_token = p_token
  LIMIT 1;

  IF v_result IS NULL THEN
    RETURN jsonb_build_object('error', 'Invalid or expired link');
  END IF;
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.grant_rfp_post_credit(p_user uuid, p_session text, p_n integer DEFAULT 1)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'grant_rfp_post_credit: forbidden'
      using errcode = '42501';
  end if;

  insert into public.rfp_post_payments (session_id, user_id)
  values (p_session, p_user)
  on conflict (session_id) do nothing;
  if not found then
    return false;
  end if;
  insert into public.rfp_post_credits (user_id, credits, lifetime_purchased, updated_at)
  values (p_user, p_n, p_n, now())
  on conflict (user_id) do update
    set credits = public.rfp_post_credits.credits + excluded.credits,
        lifetime_purchased = public.rfp_post_credits.lifetime_purchased + excluded.credits,
        updated_at = now();
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.is_email_unsubscribed(p_email text, p_event_key text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM email_unsubscribes
    WHERE email = lower(p_email)
      AND (event_key IS NULL OR event_key = p_event_key)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_project_collaborator(pid uuid, min_role text DEFAULT 'viewer'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.project_collaborators pc
    where pc.project_id = pid
      and pc.user_id = auth.uid()
      and pc.status = 'accepted'
      and case min_role when 'editor' then pc.role in ('owner','editor') else true end
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_published_portal(p_portal_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.projects
    WHERE client_portal->>'portalId' = p_portal_id
      AND COALESCE((client_portal->>'enabled')::boolean, false) = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_published_sub_portal(p_portal_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.sub_portal_links
    WHERE id = p_portal_id AND enabled = true
  );
$function$
;

CREATE OR REPLACE FUNCTION public.lookup_prequal_packet_by_token(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  rec jsonb;
begin
  select to_jsonb(p) into rec
    from prequal_packets p
   where p.invite_token = p_token
     and (p.expires_at is null or p.expires_at > now())
   limit 1;
  return rec;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.match_project_memory(p_user_id uuid, p_project_id text, p_query text, p_match_count integer)
 RETURNS TABLE(doc_id text, source text, ref text, content text, similarity double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select e.doc_id, e.source, e.ref, e.content,
         1 - (e.embedding <=> (p_query)::vector) as similarity
  from public.memory_embeddings e
  where e.user_id = p_user_id
    and e.project_id = p_project_id
  order by e.embedding <=> (p_query)::vector
  limit greatest(1, least(coalesce(p_match_count, 8), 24));
$function$
;

CREATE OR REPLACE FUNCTION public.notify_budget_proposal_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'budget_proposal',
      'source_table', 'budget_proposals',
      'source_id', NEW.id::text,
      'payload', to_jsonb(NEW)
    ),
    timeout_milliseconds := 20000
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_portal_message_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'portal_message',
      'source_table', 'portal_messages',
      'source_id', NEW.id::text,
      'payload', to_jsonb(NEW)
    ),
    timeout_milliseconds := 20000
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_sub_invoice_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  PERFORM net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'event', 'sub_invoice_submitted',
      'source_table', 'sub_invoices',
      'source_id', NEW.id::text,
      'payload', to_jsonb(NEW)
    ),
    timeout_milliseconds := 20000
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_choose_selection(p_portal_id text, p_category_id uuid, p_option_id uuid, p_access_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_project_id uuid; v_portal jsonb;
begin
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true
   limit 1;

  if v_project_id is null
     or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = ''
     or p_access_token <> (v_portal->>'accessToken') then
    raise exception 'selection_denied';
  end if;

  if not exists (select 1 from public.selection_categories c
                  where c.id = p_category_id and c.project_id = v_project_id) then
    raise exception 'selection_denied';
  end if;
  if not exists (select 1 from public.selection_options
                  where id = p_option_id and category_id = p_category_id) then
    raise exception 'selection_denied';
  end if;

  update public.selection_options
     set is_chosen = false, chosen_at = null, chosen_by_role = null
   where category_id = p_category_id;
  update public.selection_options
     set is_chosen = true, chosen_at = now(), chosen_by_role = 'homeowner'
   where id = p_option_id and category_id = p_category_id;

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'selection',
            jsonb_build_object('category', p_category_id, 'option', p_option_id));
  return jsonb_build_object('ok', true);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_get_messages(p_portal_id text, p_access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pid uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'portal_id', m.portal_id, 'author_type', m.author_type,
      'author_name', m.author_name, 'body', m.body, 'created_at', m.created_at)
      order by m.created_at asc)
    from public.portal_messages m where m.portal_id = p_portal_id), '[]'::jsonb);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_get_snapshot(p_portal_id text, p_access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pid uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  return (select snapshot from public.portal_snapshots where portal_id = p_portal_id limit 1);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_get_snapshot_v2(p_portal_id text, p_access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pid uuid;
  v_snapshot jsonb;
  v_expires_at timestamptz;
  v_found boolean := false;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  select ps.snapshot, ps.expires_at, true
    into v_snapshot, v_expires_at, v_found
    from public.portal_snapshots ps
   where ps.portal_id = p_portal_id
   limit 1;
  if not v_found then
    return jsonb_build_object('status', 'not_published');
  end if;
  if v_expires_at is not null and v_expires_at <= now() then
    return jsonb_build_object('status', 'expired', 'expiresAt', v_expires_at);
  end if;
  return jsonb_build_object(
    'status', 'ok',
    'snapshot', v_snapshot,
    'expiresAt', v_expires_at
  );
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_mark_item_viewed(p_table_name text, p_item_id text, p_project_id text, p_now timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  q text;
begin
  -- Table-name allowlist — prevents SQL injection via format()'s %I path
  -- placeholder. Only these 9 tables can be updated through this RPC.
  if p_table_name not in (
    'change_orders','invoices','aia_pay_apps','rfis','submittals',
    'daily_reports','photos','selection_categories','warranties'
  ) then
    raise exception 'invalid table %', p_table_name;
  end if;

  q := format($q$
    update public.%I
    set portal_state = jsonb_set(
      coalesce(portal_state, '{}'::jsonb),
      '{viewedAt}',
      to_jsonb(%L::timestamptz),
      true
    )
    where id::text = %L
      and project_id::text = %L
      and (portal_state is null or not (portal_state ? 'viewedAt') or portal_state->>'viewedAt' is null)
  $q$, p_table_name, p_now, p_item_id, p_project_id);
  execute q;
end $function$
;

CREATE OR REPLACE FUNCTION public.portal_post_message(p_portal_id text, p_access_token text, p_body text, p_author_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pid uuid; v_id uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_body is null or length(btrim(p_body)) = 0 then raise exception 'portal_denied'; end if;
  insert into public.portal_messages(portal_id, project_id, author_type, author_name, body)
    values (p_portal_id, v_pid::text, 'client',
            left(coalesce(nullif(btrim(p_author_name), ''), 'Client'), 120),
            left(btrim(p_body), 4000))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_project_for_token(p_portal_id text, p_access_token text)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select id from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean, false) = true
     and coalesce(client_portal->>'accessToken','') <> ''
     and client_portal->>'accessToken' = p_access_token
   limit 1;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_proposal_freeze_project()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if auth.uid() is not null then
    new.project_id := old.project_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.portal_set_access_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if new.client_portal is not null
     and new.client_portal ? 'portalId'
     and coalesce(new.client_portal->>'accessToken','') = '' then
    new.client_portal := new.client_portal || jsonb_build_object(
      'accessToken',
      coalesce(
        case when tg_op = 'UPDATE' then nullif(old.client_portal->>'accessToken','') else null end,
        encode(gen_random_bytes(24),'hex')));
  end if;
  return new;
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_sign_contract(p_portal_id text, p_contract_id uuid, p_signer_name text, p_passcode text DEFAULT NULL::text, p_access_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_project_id uuid; v_portal jsonb; v_status text;
begin
  select id, client_portal into v_project_id, v_portal from public.projects
   where client_portal->>'portalId' = p_portal_id
     and coalesce((client_portal->>'enabled')::boolean,false) = true
   limit 1;

  if v_project_id is null
     or p_access_token is null
     or coalesce(v_portal->>'accessToken','') = ''
     or p_access_token <> (v_portal->>'accessToken') then
    raise exception 'sign_denied';
  end if;

  if p_signer_name is null or length(btrim(p_signer_name)) < 3 then
    raise exception 'sign_denied';
  end if;

  if p_passcode is not null
     and coalesce(v_portal->>'passcode','') <> ''
     and p_passcode <> (v_portal->>'passcode') then
    raise exception 'sign_denied';
  end if;

  select status into v_status from public.project_contracts
   where id = p_contract_id and project_id = v_project_id limit 1;
  if v_status is null or v_status <> 'sent' then
    raise exception 'sign_denied';
  end if;

  update public.project_contracts
     set homeowner_signature = jsonb_build_object('name', btrim(p_signer_name), 'role','homeowner','signedAt', now()),
         status = 'signed', signed_at = now()
   where id = p_contract_id and project_id = v_project_id and status = 'sent';

  insert into public.portal_decision_audit(portal_id, project_id, action, detail)
    values (p_portal_id, v_project_id, 'sign',
            jsonb_build_object('contract', p_contract_id, 'signer', btrim(p_signer_name)));
  return jsonb_build_object('ok', true);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_submit_budget_proposal(p_portal_id text, p_access_token text, p_amount numeric, p_note text, p_proposer_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pid uuid; v_id uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e9 then raise exception 'portal_denied'; end if;
  insert into public.portal_budget_proposals(portal_id, project_id, amount, note, proposer_name, status)
    values (p_portal_id, v_pid::text, p_amount,
            left(coalesce(p_note, ''), 2000),
            left(coalesce(p_proposer_name, ''), 200), 'pending')
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_submit_co_approval(p_portal_id text, p_access_token text, p_change_order_id text, p_decision text, p_signer_name text, p_note text, p_user_agent text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_pid uuid; v_id uuid;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved', 'declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;
  insert into public.change_order_approvals(
      portal_id, project_id, change_order_id, decision, signer_name, note, user_agent)
    values (p_portal_id, v_pid::text, btrim(p_change_order_id), p_decision,
            left(coalesce(nullif(btrim(p_signer_name), ''), 'Client'), 200),
            left(coalesce(p_note, ''), 2000),
            left(coalesce(p_user_agent, ''), 200))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.portal_submit_co_approval_signed(p_portal_id text, p_access_token text, p_change_order_id text, p_decision text, p_signer_name text, p_note text, p_user_agent text, p_signature_data text, p_signature_hash text, p_consent_record text, p_client_hash text, p_consent_version text, p_consent_accepted boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_pid uuid; v_id uuid; v_server_hash text;
  v_now timestamptz := now(); v_audit jsonb;
begin
  v_pid := public.portal_project_for_token(p_portal_id, p_access_token);
  if v_pid is null then raise exception 'portal_denied'; end if;
  if p_decision is null or p_decision not in ('approved','declined') then raise exception 'portal_denied'; end if;
  if p_change_order_id is null or length(btrim(p_change_order_id)) = 0 then raise exception 'portal_denied'; end if;

  if p_decision = 'approved' then
    if coalesce(p_consent_accepted,false) is not true then raise exception 'esign_consent_required'; end if;
    if p_signature_data is null or length(btrim(p_signature_data)) = 0 then raise exception 'esign_signature_required'; end if;
    if p_signer_name is null or length(btrim(p_signer_name)) < 3 then raise exception 'esign_signer_name_required'; end if;
    if p_consent_record is null or length(btrim(p_consent_record)) = 0 then raise exception 'esign_record_required'; end if;
  else
    if p_note is null or length(btrim(p_note)) = 0 then raise exception 'decline_reason_required'; end if;
  end if;

  if p_consent_record is not null and length(p_consent_record) > 0 then
    v_server_hash := encode(digest(p_consent_record, 'sha256'), 'hex');
    if p_client_hash is not null and length(p_client_hash) = 64
       and lower(p_client_hash) <> lower(v_server_hash) then
      raise exception 'hash_mismatch';
    end if;
  end if;

  insert into public.change_order_approvals(
      portal_id, project_id, change_order_id, decision, signer_name, note, user_agent,
      signature_data, signature_hash, consent_record, document_hash,
      consent_version, consent_accepted, sealed_at)
    values (
      p_portal_id, v_pid::text, btrim(p_change_order_id), p_decision,
      left(coalesce(nullif(btrim(p_signer_name),''),'Client'),200),
      left(coalesce(p_note,''),2000), left(coalesce(p_user_agent,''),200),
      left(coalesce(p_signature_data,''),200000),
      nullif(left(coalesce(p_signature_hash,''),64),''),
      p_consent_record, v_server_hash,
      left(coalesce(p_consent_version,''),40),
      coalesce(p_consent_accepted,false), v_now)
    returning id into v_id;

  v_audit := jsonb_build_object(
    'id', v_id::text,
    'action', case when p_decision='approved' then 'client_signed_via_portal' else 'client_declined_via_portal' end,
    'actor', left(coalesce(nullif(btrim(p_signer_name),''),'Client'),200),
    'timestamp', to_char(v_now at time zone 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'detail', case when p_decision='approved' then
        'Electronically signed via the client portal (E-SIGN/UETA consent '
        || coalesce(nullif(btrim(p_consent_version),''),'unversioned')
        || ', record SHA-256 ' || coalesce(left(v_server_hash,16),'n/a') || E'…).'
      else 'Declined via the client portal. Reason: ' || left(coalesce(btrim(p_note),'(none given)'),500) end
  );

  update public.change_orders
     set audit_trail = coalesce(audit_trail,'[]'::jsonb) || jsonb_build_array(v_audit),
         updated_at = v_now
   where id::text = btrim(p_change_order_id) and project_id = v_pid;

  return jsonb_build_object('ok',true,'id',v_id,'document_hash',v_server_hash,'sealed_at',v_now);
end $function$
;

CREATE OR REPLACE FUNCTION public.projects_freeze_ownership_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if auth.uid() is not null and auth.uid() is distinct from old.user_id then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.public_bids_notify_nearby_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- Only fire for homeowner RFPs. Public/govt bids come in via the
  -- fetch-external-data cron and don't need a near-me fan-out.
  if NEW.is_homeowner_rfp is not true then
    return NEW;
  end if;

  perform net.http_post(
    url := 'https://nteoqhcswappxxjlpvap.supabase.co/functions/v1/notify-nearby-contractors',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select secret from private.cron_auth limit 1)
    ),
    -- Only the id — the function re-reads the authoritative row itself.
    body := jsonb_build_object('record', jsonb_build_object('id', NEW.id)),
    timeout_milliseconds := 30000
  );
  return NEW;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.public_cost_index(p_category text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_region text DEFAULT 'US'::text)
 RETURNS TABLE(category text, unit text, region text, median numeric, p25 numeric, p75 numeric, n integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pool as (
    select s.category, s.unit, s.region, s.unit_price
    from public.cost_benchmark_samples s
    where s.public_index_opt_in
      and (p_category is null or s.category = lower(p_category))
      and (p_unit is null or s.unit = lower(p_unit))
      and (p_region = 'US' or s.region = p_region)
  ), agg as (
    select
      pool.category, pool.unit, pool.region,
      count(*)::int as n,
      percentile_cont(0.5)  within group (order by pool.unit_price) as median,
      percentile_cont(0.25) within group (order by pool.unit_price) as p25,
      percentile_cont(0.75) within group (order by pool.unit_price) as p75
    from pool
    group by pool.category, pool.unit, pool.region
  )
  select agg.category, agg.unit, agg.region, agg.median, agg.p25, agg.p75, agg.n
  from agg
  where agg.n >= 5
  order by agg.n desc, agg.category;
$function$
;

CREATE OR REPLACE FUNCTION public.rate_limit_increment(p_scope text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bucket timestamptz;
  v_count int;
BEGIN
  v_bucket := date_trunc('hour', NOW());

  INSERT INTO rate_limit_counters (scope, bucket_start, count)
  VALUES (p_scope, v_bucket, 1)
  ON CONFLICT (scope, bucket_start) DO UPDATE
    SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;

  RETURN v_count;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_commitment_paid_to_date()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_commitment_id TEXT;
  v_paid_total NUMERIC;
BEGIN
  -- The commitment we need to refresh — pulled from NEW (insert/update)
  -- or OLD (delete). Treat null commitment_id as a no-op: invoice was
  -- not linked to any commitment.
  v_commitment_id := COALESCE(NEW.commitment_id, OLD.commitment_id);
  IF v_commitment_id IS NULL OR v_commitment_id = '' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Sum approved + paid invoices against this commitment. We count
  -- approved (not just paid) because once GC approves, that money is
  -- earmarked even if the check hasn't cleared. Adjust the filter here
  -- if the GC's accounting wants stricter "paid only".
  SELECT COALESCE(SUM(amount), 0)
  INTO v_paid_total
  FROM public.sub_submitted_invoices
  WHERE commitment_id = v_commitment_id
    AND status IN ('approved', 'paid');

  UPDATE public.commitments
     SET paid_to_date = v_paid_total,
         updated_at   = NOW()
   WHERE id::text = v_commitment_id
      OR id::text = v_commitment_id::text;

  RETURN COALESCE(NEW, OLD);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_co_approval_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.project_id IS NULL OR NEW.project_id = '' THEN
    SELECT id::text INTO NEW.project_id
    FROM public.projects
    WHERE client_portal->>'portalId' = NEW.portal_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_portal_msg_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.project_id IS NULL OR NEW.project_id = '' THEN
    SELECT id::text INTO NEW.project_id
    FROM public.projects
    WHERE client_portal->>'portalId' = NEW.portal_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_portal_project_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.project_id IS NULL OR NEW.project_id = '' THEN
    SELECT id::text INTO NEW.project_id
    FROM public.projects
    WHERE client_portal->>'portalId' = NEW.portal_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_sub_invoice_project()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  link_row public.sub_portal_links%ROWTYPE;
BEGIN
  IF NEW.project_id IS NULL OR NEW.subcontractor_id IS NULL THEN
    SELECT * INTO link_row FROM public.sub_portal_links WHERE id = NEW.sub_portal_id LIMIT 1;
    IF FOUND THEN
      IF NEW.project_id IS NULL THEN NEW.project_id := link_row.project_id; END IF;
      IF NEW.subcontractor_id IS NULL THEN NEW.subcontractor_id := link_row.subcontractor_id; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.safety_wave_b_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sub_invoice_freeze_columns()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if auth.uid() is not null then
    new.sub_portal_id := old.sub_portal_id;
    new.project_id    := old.project_id;
    new.commitment_id := old.commitment_id;
    new.amount        := old.amount;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sub_portal_get_snapshot(p_sub_portal_id text, p_access_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.sub_portal_links
                 where id = p_sub_portal_id and enabled = true
                   and coalesce(access_token, '') <> '' and access_token = p_access_token) then
    raise exception 'sub_portal_denied';
  end if;
  return (select snapshot from public.sub_portal_snapshots where sub_portal_id = p_sub_portal_id limit 1);
end; $function$
;

CREATE OR REPLACE FUNCTION public.sub_portal_submit_invoice(p_sub_portal_id text, p_access_token text, p_invoice_number text, p_amount numeric, p_retention_amount numeric, p_description text, p_line_items jsonb, p_commitment_id text, p_submitted_by_name text, p_submitted_by_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_link record; v_id uuid;
begin
  select id, project_id, subcontractor_id into v_link from public.sub_portal_links
    where id = p_sub_portal_id and enabled = true
      and coalesce(access_token, '') <> '' and access_token = p_access_token
    limit 1;
  if v_link is null then raise exception 'sub_portal_denied'; end if;
  if p_amount is null or p_amount <= 0 or p_amount >= 1e9 then raise exception 'sub_portal_denied'; end if;
  insert into public.sub_submitted_invoices(
      sub_portal_id, project_id, subcontractor_id, commitment_id, invoice_number, amount, retention_amount,
      description, line_items, status, submitted_by_name, submitted_by_email)
    values (p_sub_portal_id, v_link.project_id, v_link.subcontractor_id,
            nullif(left(coalesce(p_commitment_id, ''), 200), ''),
            left(coalesce(p_invoice_number, ''), 80), p_amount,
            greatest(0, coalesce(p_retention_amount, 0)),
            left(coalesce(p_description, ''), 500),
            coalesce(p_line_items, '[]'::jsonb), 'submitted',
            left(coalesce(p_submitted_by_name, ''), 120),
            left(coalesce(p_submitted_by_email, ''), 200))
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.submit_prequal_packet(p_token text, p_criteria jsonb, p_financials jsonb, p_safety jsonb, p_insurance jsonb, p_licenses jsonb, p_w9_on_file boolean, p_w9_doc_path text, p_status text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count int;
begin
  update prequal_packets
     set criteria      = p_criteria,
         financials    = p_financials,
         safety        = p_safety,
         insurance     = p_insurance,
         licenses      = p_licenses,
         w9_on_file    = p_w9_on_file,
         w9_doc_path   = p_w9_doc_path,
         status        = case
           when p_status = 'submitted' and status in ('draft', 'invited', 'needs_changes')
             then 'submitted'
           else status
         end,
         submitted_at  = case
           when p_status = 'submitted' and submitted_at is null
             then now()
           else submitted_at
         end,
         updated_at    = now()
   where invite_token = p_token
     and (expires_at is null or expires_at > now())
     and status != 'approved';

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_pro_response(p_token uuid, p_doc_type text, p_responder_name text, p_responder_email text, p_responder_role text, p_response_body text, p_action_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rfi_id uuid;
  v_submittal_id uuid;
  v_response_id uuid;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Missing token');
  END IF;
  IF p_response_body IS NULL OR length(trim(p_response_body)) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Response is too short');
  END IF;

  IF p_doc_type = 'rfi' THEN
    SELECT id INTO v_rfi_id FROM public.rfis WHERE share_token = p_token LIMIT 1;
    IF v_rfi_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired link');
    END IF;
  ELSIF p_doc_type = 'submittal' THEN
    SELECT id INTO v_submittal_id FROM public.submittals WHERE share_token = p_token LIMIT 1;
    IF v_submittal_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid or expired link');
    END IF;
    -- Validate action code for submittals
    IF p_action_code IS NOT NULL AND p_action_code NOT IN
      ('approved','approved_as_noted','revise_resubmit','rejected','in_review') THEN
      RETURN jsonb_build_object('success', false, 'error', 'Invalid action code');
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Invalid doc type');
  END IF;

  -- Insert the response
  INSERT INTO public.pro_responses (
    rfi_id, submittal_id, share_token,
    responder_name, responder_email, responder_role,
    response_body, action_code
  ) VALUES (
    v_rfi_id, v_submittal_id, p_token,
    NULLIF(trim(p_responder_name), ''),
    NULLIF(trim(p_responder_email), ''),
    NULLIF(trim(p_responder_role), ''),
    trim(p_response_body),
    p_action_code
  )
  RETURNING id INTO v_response_id;

  -- Sync RFI: stamp the response into the parent so the GC's app shows it
  -- without an extra fetch. Status moves to 'answered' if not already closed.
  IF v_rfi_id IS NOT NULL THEN
    UPDATE public.rfis
    SET response = trim(p_response_body),
        date_responded = COALESCE(date_responded, now()::text),
        status = CASE WHEN status IN ('closed','void') THEN status ELSE 'answered' END,
        updated_at = now()
    WHERE id = v_rfi_id;
  END IF;

  -- Sync Submittal: append a review cycle. Cycle # is current count + 1.
  IF v_submittal_id IS NOT NULL THEN
    UPDATE public.submittals
    SET review_cycles = COALESCE(review_cycles, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'cycleNumber', COALESCE(jsonb_array_length(review_cycles), 0) + 1,
        'sentDate', now()::text,
        'returnDate', now()::text,
        'reviewer', COALESCE(NULLIF(trim(p_responder_name), ''), NULLIF(trim(p_responder_email), ''), 'External reviewer'),
        'status', COALESCE(p_action_code, 'in_review'),
        'comments', trim(p_response_body)
      )
    ),
    current_status = COALESCE(p_action_code, current_status),
    updated_at = now()
    WHERE id = v_submittal_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'response_id', v_response_id);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_sub_change_request(sub_portal_id_in text, description_in text, amount_in numeric, schedule_impact_days_in integer DEFAULT NULL::integer, photos_in jsonb DEFAULT '[]'::jsonb, notes_in text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_project_id UUID;
  v_user_id    UUID;
  v_sub_name   TEXT;
  v_request_id UUID;
BEGIN
  SELECT spl.project_id, p.user_id, COALESCE(spl.sub_name, 'Sub')
    INTO v_project_id, v_user_id, v_sub_name
    FROM public.sub_portal_links spl
    JOIN public.projects p ON p.id = spl.project_id
   WHERE spl.sub_portal_id = sub_portal_id_in
   LIMIT 1;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid sub portal token';
  END IF;

  v_request_id := gen_random_uuid();

  INSERT INTO public.sub_change_requests (
    id, user_id, project_id, sub_portal_id, sub_name,
    description, amount, schedule_impact_days, photos, notes,
    status, submitted_at
  ) VALUES (
    v_request_id, v_user_id, v_project_id, sub_portal_id_in, v_sub_name,
    description_in, amount_in, schedule_impact_days_in, photos_in, notes_in,
    'submitted', NOW()
  );

  RETURN v_request_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.time_entries_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_budget_proposal()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.fire_notify(
    'budget_proposal',
    'portal_budget_proposals',
    NEW.id::text,
    jsonb_build_object(
      'portal_id', NEW.portal_id,
      'project_id', NEW.project_id,
      'invite_id', NEW.invite_id,
      'amount', NEW.amount,
      'note', NEW.note,
      'proposer_name', NEW.proposer_name,
      'proposer_email', NEW.proposer_email
    )
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_co_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.fire_notify(
    'co_approval',
    'change_order_approvals',
    NEW.id::text,
    jsonb_build_object(
      'portal_id', NEW.portal_id,
      'project_id', NEW.project_id,
      'invite_id', NEW.invite_id,
      'change_order_id', NEW.change_order_id,
      'decision', NEW.decision,
      'signer_name', NEW.signer_name,
      'signer_email', NEW.signer_email,
      'note', NEW.note
    )
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_nearby_contractors()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_url TEXT;
  v_key TEXT;
BEGIN
  IF NEW.is_homeowner_rfp IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM public.app_config WHERE key = 'notify_nearby_contractors_url';
  IF v_url IS NULL OR v_url = '' THEN
    SELECT REPLACE(value, '/notify', '/notify-nearby-contractors')
      INTO v_url
      FROM public.app_config WHERE key = 'notify_url';
  END IF;
  SELECT value INTO v_key FROM public.app_config WHERE key = 'notify_key';

  IF v_url IS NULL OR v_url = '' THEN
    RAISE NOTICE 'trg_notify_nearby_contractors: notify_url not configured';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := v_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_key, ''),
      'apikey',        COALESCE(v_key, '')
    ),
    body    := jsonb_build_object('record', to_jsonb(NEW))
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'trg_notify_nearby_contractors failed: %', SQLERRM;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_portal_message()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.author_type = 'client' THEN
    PERFORM public.fire_notify(
      'portal_message',
      'portal_messages',
      NEW.id::text,
      jsonb_build_object(
        'portal_id', NEW.portal_id,
        'project_id', NEW.project_id,
        'invite_id', NEW.invite_id,
        'author_type', NEW.author_type,
        'author_name', NEW.author_name,
        'body', NEW.body
      )
    );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_sub_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  PERFORM public.fire_notify(
    'sub_invoice_submitted',
    'sub_submitted_invoices',
    NEW.id::text,
    jsonb_build_object(
      'sub_portal_id', NEW.sub_portal_id,
      'project_id', NEW.project_id,
      'subcontractor_id', NEW.subcontractor_id,
      'commitment_id', NEW.commitment_id,
      'invoice_number', NEW.invoice_number,
      'amount', NEW.amount,
      'submitted_by_name', NEW.submitted_by_name,
      'submitted_by_email', NEW.submitted_by_email
    )
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.trg_notify_sub_invoice_reviewed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN ('approved', 'rejected', 'paid') THEN
    RETURN NEW;
  END IF;
  PERFORM public.fire_notify(
    'sub_invoice_reviewed',
    'sub_submitted_invoices',
    NEW.id::text,
    jsonb_build_object(
      'sub_portal_id', NEW.sub_portal_id,
      'project_id', NEW.project_id,
      'subcontractor_id', NEW.subcontractor_id,
      'commitment_id', NEW.commitment_id,
      'invoice_number', NEW.invoice_number,
      'amount', NEW.amount,
      'status', NEW.status,
      'submitted_by_name', NEW.submitted_by_name,
      'submitted_by_email', NEW.submitted_by_email,
      'notes_from_gc', NEW.notes_from_gc
    )
  );
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
NEW.updated_at = NOW();
RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_secret text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (select 1 from private.cron_auth where secret = p_secret);
$function$
;

CREATE OR REPLACE FUNCTION public.wip_periods_block_locked_update()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.locked_at IS NOT NULL THEN
    IF (NEW.rows IS DISTINCT FROM OLD.rows)
       OR (NEW.portfolio_totals IS DISTINCT FROM OLD.portfolio_totals)
       OR (NEW.period_end_date IS DISTINCT FROM OLD.period_end_date)
       OR (NEW.notes IS DISTINCT FROM OLD.notes)
       OR (NEW.locked_at IS DISTINCT FROM OLD.locked_at) THEN
      RAISE EXCEPTION 'wip_periods: period % is locked and immutable', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

-- =============================================================================
-- END OF GENERATED SCHEMA
-- =============================================================================
