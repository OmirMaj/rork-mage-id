-- H4b — RLS baseline. Verbatim, idempotent snapshot of ALL live public
-- RLS as of 2026-05-18 (prod project nteoqhcswappxxjlpvap). Makes prod
-- reproducible from migrations. Generated from pg_policies (see
-- docs/superpowers/plans/2026-05-18-h4-rls-portal-write-hardening.md Task 1).
-- This is a faithful pre-fix snapshot: it INCLUDES contracts_client_sign and
-- selopt_client_choose; migration 20260518120100 removes them.

-- ── Enable RLS (idempotent) ──
alter table public.ai_daily_usage enable row level security;
alter table public.ai_usage_counters enable row level security;
alter table public.aia_pay_apps enable row level security;
alter table public.app_config enable row level security;
alter table public.assemblies enable row level security;
alter table public.bid_package_bids enable row level security;
alter table public.bid_packages enable row level security;
alter table public.bid_questions enable row level security;
alter table public.bid_responses enable row level security;
alter table public.cached_bids enable row level security;
alter table public.cached_companies enable row level security;
alter table public.cached_jobs enable row level security;
alter table public.change_order_approvals enable row level security;
alter table public.change_orders enable row level security;
alter table public.city_coords enable row level security;
alter table public.closeout_binders enable row level security;
alter table public.cois enable row level security;
alter table public.comm_events enable row level security;
alter table public.commitments enable row level security;
alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contractor_licenses enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.conversations enable row level security;
alter table public.daily_reports enable row level security;
alter table public.delivery_receipts enable row level security;
alter table public.draw_periods enable row level security;
alter table public.drawing_pins enable row level security;
alter table public.email_unsubscribes enable row level security;
alter table public.equipment enable row level security;
alter table public.estimate_versions enable row level security;
alter table public.feature_interest enable row level security;
alter table public.financing_referrals enable row level security;
alter table public.geocode_run_lock enable row level security;
alter table public.invoices enable row level security;
alter table public.job_listings enable row level security;
alter table public.labor_rates enable row level security;
alter table public.leads enable row level security;
alter table public.lien_waivers enable row level security;
alter table public.material_prices enable row level security;
alter table public.materials_pricing enable row level security;
alter table public.messages enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.oac_meetings enable row level security;
alter table public.owner_supplied_items enable row level security;
alter table public.permit_templates enable row level security;
alter table public.permits enable row level security;
alter table public.photos enable row level security;
alter table public.plan_calibrations enable row level security;
alter table public.plan_markups enable row level security;
alter table public.plan_sheets enable row level security;
alter table public.portal_budget_proposals enable row level security;
alter table public.portal_messages enable row level security;
alter table public.portal_snapshots enable row level security;
alter table public.prequal_packets enable row level security;
alter table public.price_alerts enable row level security;
alter table public.pro_responses enable row level security;
alter table public.profiles enable row level security;
alter table public.project_contracts enable row level security;
alter table public.projects enable row level security;
alter table public.public_bids enable row level security;
alter table public.punch_items enable row level security;
alter table public.rate_limit_counters enable row level security;
alter table public.rfis enable row level security;
alter table public.selection_categories enable row level security;
alter table public.selection_options enable row level security;
alter table public.sub_change_requests enable row level security;
alter table public.sub_portal_links enable row level security;
alter table public.sub_portal_snapshots enable row level security;
alter table public.sub_submitted_invoices enable row level security;
alter table public.subcontractors enable row level security;
alter table public.submittals enable row level security;
alter table public.subscriptions enable row level security;
alter table public.time_entries enable row level security;
alter table public.user_tracked_bids enable row level security;
alter table public.warranties enable row level security;
alter table public.worker_profiles enable row level security;
alter table public.workers enable row level security;
alter table public.zip_cost_factors enable row level security;

-- ── Policies (idempotent: drop if exists + create) ──
drop policy if exists ai_daily_usage_owner_read on public.ai_daily_usage;
create policy ai_daily_usage_owner_read on public.ai_daily_usage as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists users_read_own_usage on public.ai_usage_counters;
create policy users_read_own_usage on public.ai_usage_counters as permissive for select to authenticated using ((auth.uid() = user_id));

drop policy if exists aia_pay_apps_owner_all on public.aia_pay_apps;
create policy aia_pay_apps_owner_all on public.aia_pay_apps as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists app_config_read_authenticated on public.app_config;
create policy app_config_read_authenticated on public.app_config as permissive for select to anon, authenticated using (true);

drop policy if exists assemblies_delete_own on public.assemblies;
create policy assemblies_delete_own on public.assemblies as permissive for delete to public using (((auth.uid() = user_id) AND (is_system = false)));

drop policy if exists assemblies_insert_own on public.assemblies;
create policy assemblies_insert_own on public.assemblies as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists assemblies_select_all on public.assemblies;
create policy assemblies_select_all on public.assemblies as permissive for select to public using (((is_system = true) OR (auth.uid() = user_id)));

drop policy if exists assemblies_update_own on public.assemblies;
create policy assemblies_update_own on public.assemblies as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists bid_package_bids_owner_all on public.bid_package_bids;
create policy bid_package_bids_owner_all on public.bid_package_bids as permissive for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

drop policy if exists bid_packages_owner_all on public.bid_packages;
create policy bid_packages_owner_all on public.bid_packages as permissive for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

drop policy if exists bq_ask on public.bid_questions;
create policy bq_ask on public.bid_questions as permissive for insert to authenticated with check (((asker_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_questions.bid_id) AND (pb.is_homeowner_rfp = true) AND (pb.status = 'open'::text) AND (pb.user_id <> auth.uid()))))));

drop policy if exists bq_homeowner_answer on public.bid_questions;
create policy bq_homeowner_answer on public.bid_questions as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_questions.bid_id) AND (pb.user_id = auth.uid())))));

drop policy if exists bq_homeowner_read_all on public.bid_questions;
create policy bq_homeowner_read_all on public.bid_questions as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_questions.bid_id) AND (pb.user_id = auth.uid())))));

drop policy if exists bq_read_own on public.bid_questions;
create policy bq_read_own on public.bid_questions as permissive for select to authenticated using ((auth.uid() = asker_user_id));

drop policy if exists bq_read_public on public.bid_questions;
create policy bq_read_public on public.bid_questions as permissive for select to authenticated using ((is_public = true));

drop policy if exists bid_responses_own on public.bid_responses;
create policy bid_responses_own on public.bid_responses as permissive for all to public using ((auth.uid() = user_id));

drop policy if exists bid_responses_view on public.bid_responses;
create policy bid_responses_view on public.bid_responses as permissive for select to public using ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_responses.bid_id) AND (pb.user_id = auth.uid())))));

drop policy if exists br_homeowner_update_status on public.bid_responses;
create policy br_homeowner_update_status on public.bid_responses as permissive for update to public using ((EXISTS ( SELECT 1
   FROM public_bids pb
  WHERE ((pb.id = bid_responses.bid_id) AND (pb.user_id = auth.uid())))));

drop policy if exists anon_read_bids on public.cached_bids;
create policy anon_read_bids on public.cached_bids as permissive for select to anon, authenticated using (true);

drop policy if exists anon_read_companies on public.cached_companies;
create policy anon_read_companies on public.cached_companies as permissive for select to anon, authenticated using (true);

drop policy if exists anon_read_jobs on public.cached_jobs;
create policy anon_read_jobs on public.cached_jobs as permissive for select to anon, authenticated using (true);

drop policy if exists "client submits CO approvals" on public.change_order_approvals;
create policy "client submits CO approvals" on public.change_order_approvals as permissive for insert to anon, authenticated with check (is_published_portal(portal_id));

drop policy if exists "gc reads own CO approvals" on public.change_order_approvals;
create policy "gc reads own CO approvals" on public.change_order_approvals as permissive for select to authenticated using (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = change_order_approvals.project_id) AND (p.user_id = auth.uid()))))));

drop policy if exists change_orders_delete on public.change_orders;
create policy change_orders_delete on public.change_orders as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists change_orders_insert on public.change_orders;
create policy change_orders_insert on public.change_orders as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists change_orders_select on public.change_orders;
create policy change_orders_select on public.change_orders as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists change_orders_update on public.change_orders;
create policy change_orders_update on public.change_orders as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists co_delete_own on public.change_orders;
create policy co_delete_own on public.change_orders as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists co_insert_own on public.change_orders;
create policy co_insert_own on public.change_orders as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists co_select_own on public.change_orders;
create policy co_select_own on public.change_orders as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists co_update_own on public.change_orders;
create policy co_update_own on public.change_orders as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists city_coords_read on public.city_coords;
create policy city_coords_read on public.city_coords as permissive for select to public using (true);

drop policy if exists cb_client_read on public.closeout_binders;
create policy cb_client_read on public.closeout_binders as permissive for select to public using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = closeout_binders.project_id) AND (p.client_portal IS NOT NULL) AND (((p.client_portal ->> 'enabled'::text))::boolean = true)))));

drop policy if exists cb_gc_all on public.closeout_binders;
create policy cb_gc_all on public.closeout_binders as permissive for all to public using ((auth.uid() = user_id));

drop policy if exists cois_owner_all on public.cois;
create policy cois_owner_all on public.cois as permissive for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

drop policy if exists comm_events_delete on public.comm_events;
create policy comm_events_delete on public.comm_events as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists comm_events_insert on public.comm_events;
create policy comm_events_insert on public.comm_events as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists comm_events_select on public.comm_events;
create policy comm_events_select on public.comm_events as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists comm_events_update on public.comm_events;
create policy comm_events_update on public.comm_events as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists comm_insert_own on public.comm_events;
create policy comm_insert_own on public.comm_events as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists comm_select_own on public.comm_events;
create policy comm_select_own on public.comm_events as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists commitments_owner_all on public.commitments;
create policy commitments_owner_all on public.commitments as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists companies_insert_auth on public.companies;
create policy companies_insert_auth on public.companies as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies as permissive for select to authenticated using (true);

drop policy if exists companies_select_all on public.companies;
create policy companies_select_all on public.companies as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists companies_update_own on public.companies;
create policy companies_update_own on public.companies as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists contacts_delete on public.contacts;
create policy contacts_delete on public.contacts as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists contacts_delete_own on public.contacts;
create policy contacts_delete_own on public.contacts as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists contacts_insert on public.contacts;
create policy contacts_insert on public.contacts as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists contacts_insert_own on public.contacts;
create policy contacts_insert_own on public.contacts as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists contacts_select_own on public.contacts;
create policy contacts_select_own on public.contacts as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists contacts_update on public.contacts;
create policy contacts_update on public.contacts as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists contacts_update_own on public.contacts;
create policy contacts_update_own on public.contacts as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists contractor_licenses_delete_own on public.contractor_licenses;
create policy contractor_licenses_delete_own on public.contractor_licenses as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists contractor_licenses_insert_own on public.contractor_licenses;
create policy contractor_licenses_insert_own on public.contractor_licenses as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists contractor_licenses_select_own on public.contractor_licenses;
create policy contractor_licenses_select_own on public.contractor_licenses as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists contractor_licenses_update_own on public.contractor_licenses;
create policy contractor_licenses_update_own on public.contractor_licenses as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists conversation_participants_select on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists cp_delete_own on public.conversation_participants;
create policy cp_delete_own on public.conversation_participants as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists cp_insert_self on public.conversation_participants;
create policy cp_insert_self on public.conversation_participants as permissive for insert to authenticated with check ((user_id = auth.uid()));

drop policy if exists cp_select_own on public.conversation_participants;
create policy cp_select_own on public.conversation_participants as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists conversations_select on public.conversations;
create policy conversations_select on public.conversations as permissive for select to public using (((auth.uid())::text IN ( SELECT jsonb_array_elements_text(conversations.participant_ids) AS jsonb_array_elements_text)));

drop policy if exists conversations_update on public.conversations;
create policy conversations_update on public.conversations as permissive for update to public using (((auth.uid())::text IN ( SELECT jsonb_array_elements_text(conversations.participant_ids) AS jsonb_array_elements_text)));

drop policy if exists convo_insert_self_in_participants on public.conversations;
create policy convo_insert_self_in_participants on public.conversations as permissive for insert to authenticated with check (((auth.uid())::text IN ( SELECT jsonb_array_elements_text(conversations.participant_ids) AS jsonb_array_elements_text)));

drop policy if exists convo_select_participant on public.conversations;
create policy convo_select_participant on public.conversations as permissive for select to public using ((EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = conversations.id) AND (cp.user_id = auth.uid())))));

drop policy if exists convo_update_participant on public.conversations;
create policy convo_update_participant on public.conversations as permissive for update to public using ((EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = conversations.id) AND (cp.user_id = auth.uid())))));

drop policy if exists daily_reports_delete on public.daily_reports;
create policy daily_reports_delete on public.daily_reports as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists daily_reports_insert on public.daily_reports;
create policy daily_reports_insert on public.daily_reports as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists daily_reports_select on public.daily_reports;
create policy daily_reports_select on public.daily_reports as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists daily_reports_update on public.daily_reports;
create policy daily_reports_update on public.daily_reports as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists dfr_delete_own on public.daily_reports;
create policy dfr_delete_own on public.daily_reports as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists dfr_insert_own on public.daily_reports;
create policy dfr_insert_own on public.daily_reports as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists dfr_select_own on public.daily_reports;
create policy dfr_select_own on public.daily_reports as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists dfr_update_own on public.daily_reports;
create policy dfr_update_own on public.daily_reports as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists delivery_receipts_delete_own on public.delivery_receipts;
create policy delivery_receipts_delete_own on public.delivery_receipts as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists delivery_receipts_insert_own on public.delivery_receipts;
create policy delivery_receipts_insert_own on public.delivery_receipts as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists delivery_receipts_select_own on public.delivery_receipts;
create policy delivery_receipts_select_own on public.delivery_receipts as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists delivery_receipts_update_own on public.delivery_receipts;
create policy delivery_receipts_update_own on public.delivery_receipts as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists draw_periods_delete_own on public.draw_periods;
create policy draw_periods_delete_own on public.draw_periods as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists draw_periods_insert_own on public.draw_periods;
create policy draw_periods_insert_own on public.draw_periods as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists draw_periods_select_own on public.draw_periods;
create policy draw_periods_select_own on public.draw_periods as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists draw_periods_update_own on public.draw_periods;
create policy draw_periods_update_own on public.draw_periods as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists drawing_pins_all_own on public.drawing_pins;
create policy drawing_pins_all_own on public.drawing_pins as permissive for all to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists email_unsubscribes_insert_anyone on public.email_unsubscribes;
create policy email_unsubscribes_insert_anyone on public.email_unsubscribes as permissive for insert to anon, authenticated with check (true);

drop policy if exists email_unsubscribes_select_anyone on public.email_unsubscribes;
create policy email_unsubscribes_select_anyone on public.email_unsubscribes as permissive for select to anon, authenticated using (true);

drop policy if exists equip_delete_own on public.equipment;
create policy equip_delete_own on public.equipment as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists equip_insert_own on public.equipment;
create policy equip_insert_own on public.equipment as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists equip_select_own on public.equipment;
create policy equip_select_own on public.equipment as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists equip_update_own on public.equipment;
create policy equip_update_own on public.equipment as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists equipment_delete on public.equipment;
create policy equipment_delete on public.equipment as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists equipment_insert on public.equipment;
create policy equipment_insert on public.equipment as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists equipment_select on public.equipment;
create policy equipment_select on public.equipment as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists equipment_update on public.equipment;
create policy equipment_update on public.equipment as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists est_versions_delete_own on public.estimate_versions;
create policy est_versions_delete_own on public.estimate_versions as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists est_versions_insert_own on public.estimate_versions;
create policy est_versions_insert_own on public.estimate_versions as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists est_versions_select_own on public.estimate_versions;
create policy est_versions_select_own on public.estimate_versions as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists estimate_versions_all on public.estimate_versions;
create policy estimate_versions_all on public.estimate_versions as permissive for all to public using ((auth.uid() = user_id));

drop policy if exists "users delete own interest" on public.feature_interest;
create policy "users delete own interest" on public.feature_interest as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists "users insert own interest" on public.feature_interest;
create policy "users insert own interest" on public.feature_interest as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists "users select own interest" on public.feature_interest;
create policy "users select own interest" on public.feature_interest as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists financing_referrals_owner_all on public.financing_referrals;
create policy financing_referrals_owner_all on public.financing_referrals as permissive for all to authenticated using ((gc_user_id = auth.uid())) with check ((gc_user_id = auth.uid()));

drop policy if exists geocode_run_lock_select on public.geocode_run_lock;
create policy geocode_run_lock_select on public.geocode_run_lock as permissive for select to anon, authenticated using (true);

drop policy if exists inv_delete_own on public.invoices;
create policy inv_delete_own on public.invoices as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists inv_insert_own on public.invoices;
create policy inv_insert_own on public.invoices as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists inv_select_own on public.invoices;
create policy inv_select_own on public.invoices as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists inv_update_own on public.invoices;
create policy inv_update_own on public.invoices as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists invoices_delete on public.invoices;
create policy invoices_delete on public.invoices as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists job_listings_delete on public.job_listings;
create policy job_listings_delete on public.job_listings as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists job_listings_insert on public.job_listings;
create policy job_listings_insert on public.job_listings as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists job_listings_select on public.job_listings;
create policy job_listings_select on public.job_listings as permissive for select to authenticated using (true);

drop policy if exists job_listings_update on public.job_listings;
create policy job_listings_update on public.job_listings as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists jobs_delete_own on public.job_listings;
create policy jobs_delete_own on public.job_listings as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists jobs_insert_auth on public.job_listings;
create policy jobs_insert_auth on public.job_listings as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists jobs_select_all on public.job_listings;
create policy jobs_select_all on public.job_listings as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists jobs_update_own on public.job_listings;
create policy jobs_update_own on public.job_listings as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists labor_rates_select_all on public.labor_rates;
create policy labor_rates_select_all on public.labor_rates as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists leads_owner_all on public.leads;
create policy leads_owner_all on public.leads as permissive for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

drop policy if exists lw_gc_delete on public.lien_waivers;
create policy lw_gc_delete on public.lien_waivers as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists lw_gc_insert on public.lien_waivers;
create policy lw_gc_insert on public.lien_waivers as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists lw_gc_select on public.lien_waivers;
create policy lw_gc_select on public.lien_waivers as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists lw_gc_update on public.lien_waivers;
create policy lw_gc_update on public.lien_waivers as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists material_prices_select_all on public.material_prices;
create policy material_prices_select_all on public.material_prices as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists materials_select_all on public.materials_pricing;
create policy materials_select_all on public.materials_pricing as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages as permissive for insert to public with check ((auth.uid() = sender_id));

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages as permissive for select to public using ((EXISTS ( SELECT 1
   FROM conversations c
  WHERE ((c.id = messages.conversation_id) AND ((auth.uid())::text IN ( SELECT jsonb_array_elements_text(c.participant_ids) AS jsonb_array_elements_text))))));

drop policy if exists msg_insert_auth on public.messages;
create policy msg_insert_auth on public.messages as permissive for insert to public with check ((auth.role() = 'authenticated'::text));

drop policy if exists msg_select_convo on public.messages;
create policy msg_select_convo on public.messages as permissive for select to public using ((EXISTS ( SELECT 1
   FROM conversation_participants cp
  WHERE ((cp.conversation_id = cp.conversation_id) AND (cp.user_id = auth.uid())))));

drop policy if exists "users delete own outbox" on public.notification_outbox;
create policy "users delete own outbox" on public.notification_outbox as permissive for delete to authenticated using ((recipient_user_id = auth.uid()));

drop policy if exists "users read own outbox" on public.notification_outbox;
create policy "users read own outbox" on public.notification_outbox as permissive for select to authenticated using ((recipient_user_id = auth.uid()));

drop policy if exists "users update own outbox" on public.notification_outbox;
create policy "users update own outbox" on public.notification_outbox as permissive for update to authenticated using ((recipient_user_id = auth.uid())) with check ((recipient_user_id = auth.uid()));

drop policy if exists oac_meetings_owner_all on public.oac_meetings;
create policy oac_meetings_owner_all on public.oac_meetings as permissive for all to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

drop policy if exists owner_supplied_delete_own on public.owner_supplied_items;
create policy owner_supplied_delete_own on public.owner_supplied_items as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists owner_supplied_insert_own on public.owner_supplied_items;
create policy owner_supplied_insert_own on public.owner_supplied_items as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists owner_supplied_select_own on public.owner_supplied_items;
create policy owner_supplied_select_own on public.owner_supplied_items as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists owner_supplied_update_own on public.owner_supplied_items;
create policy owner_supplied_update_own on public.owner_supplied_items as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists permit_templates_delete_own on public.permit_templates;
create policy permit_templates_delete_own on public.permit_templates as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists permit_templates_insert_own on public.permit_templates;
create policy permit_templates_insert_own on public.permit_templates as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists permit_templates_select_own on public.permit_templates;
create policy permit_templates_select_own on public.permit_templates as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists permit_templates_update_own on public.permit_templates;
create policy permit_templates_update_own on public.permit_templates as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists permits_owner_all on public.permits;
create policy permits_owner_all on public.permits as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists photos_delete on public.photos;
create policy photos_delete on public.photos as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists photos_delete_own on public.photos;
create policy photos_delete_own on public.photos as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists photos_insert_own on public.photos;
create policy photos_insert_own on public.photos as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists photos_select on public.photos;
create policy photos_select on public.photos as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists photos_select_own on public.photos;
create policy photos_select_own on public.photos as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists plan_calibrations_all_own on public.plan_calibrations;
create policy plan_calibrations_all_own on public.plan_calibrations as permissive for all to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists plan_markups_all_own on public.plan_markups;
create policy plan_markups_all_own on public.plan_markups as permissive for all to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists plan_sheets_all_own on public.plan_sheets;
create policy plan_sheets_all_own on public.plan_sheets as permissive for all to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists "gc can read own proposals" on public.portal_budget_proposals;
create policy "gc can read own proposals" on public.portal_budget_proposals as permissive for select to authenticated using (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_budget_proposals.project_id) AND (p.user_id = auth.uid()))))));

drop policy if exists "gc can update own proposals" on public.portal_budget_proposals;
create policy "gc can update own proposals" on public.portal_budget_proposals as permissive for update to authenticated using (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_budget_proposals.project_id) AND (p.user_id = auth.uid())))))) with check ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text])));

drop policy if exists "portal can submit proposals" on public.portal_budget_proposals;
create policy "portal can submit proposals" on public.portal_budget_proposals as permissive for insert to anon, authenticated with check (((status = 'pending'::text) AND is_published_portal(portal_id)));

drop policy if exists "client posts messages to known portals" on public.portal_messages;
create policy "client posts messages to known portals" on public.portal_messages as permissive for insert to anon, authenticated with check (((author_type = 'client'::text) AND is_published_portal(portal_id)));

drop policy if exists "gc inserts own portal messages" on public.portal_messages;
create policy "gc inserts own portal messages" on public.portal_messages as permissive for insert to authenticated with check (((author_type = 'gc'::text) AND (project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_messages.project_id) AND (p.user_id = auth.uid()))))));

drop policy if exists "gc reads own portal messages" on public.portal_messages;
create policy "gc reads own portal messages" on public.portal_messages as permissive for select to authenticated using (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_messages.project_id) AND (p.user_id = auth.uid()))))));

drop policy if exists "gc updates read receipts" on public.portal_messages;
create policy "gc updates read receipts" on public.portal_messages as permissive for update to authenticated using (((project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE (((p.id)::text = portal_messages.project_id) AND (p.user_id = auth.uid()))))));

drop policy if exists portal_snapshots_anon_read on public.portal_snapshots;
create policy portal_snapshots_anon_read on public.portal_snapshots as permissive for select to anon using (true);

drop policy if exists portal_snapshots_authed_read on public.portal_snapshots;
create policy portal_snapshots_authed_read on public.portal_snapshots as permissive for select to authenticated using (true);

drop policy if exists portal_snapshots_owner_write on public.portal_snapshots;
create policy portal_snapshots_owner_write on public.portal_snapshots as permissive for all to authenticated using ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid())))) with check ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid()))));

drop policy if exists prequal_packets_owner_all on public.prequal_packets;
create policy prequal_packets_owner_all on public.prequal_packets as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists alerts_delete_own on public.price_alerts;
create policy alerts_delete_own on public.price_alerts as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists alerts_insert_own on public.price_alerts;
create policy alerts_insert_own on public.price_alerts as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists alerts_select_own on public.price_alerts;
create policy alerts_select_own on public.price_alerts as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists alerts_update_own on public.price_alerts;
create policy alerts_update_own on public.price_alerts as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists price_alerts_delete on public.price_alerts;
create policy price_alerts_delete on public.price_alerts as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists price_alerts_insert on public.price_alerts;
create policy price_alerts_insert on public.price_alerts as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists price_alerts_select on public.price_alerts;
create policy price_alerts_select on public.price_alerts as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists price_alerts_update on public.price_alerts;
create policy price_alerts_update on public.price_alerts as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists gc_reads_own_pro_responses on public.pro_responses;
create policy gc_reads_own_pro_responses on public.pro_responses as permissive for select to authenticated using (((EXISTS ( SELECT 1
   FROM rfis r
  WHERE ((r.id = pro_responses.rfi_id) AND (r.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM submittals s
  WHERE ((s.id = pro_responses.submittal_id) AND (s.user_id = auth.uid()))))));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles as permissive for insert to public with check ((auth.uid() = id));

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles as permissive for insert to public with check ((auth.uid() = id));

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles as permissive for select to public using ((auth.uid() = id));

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles as permissive for select to public using ((auth.uid() = id));

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles as permissive for update to public using ((auth.uid() = id));

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles as permissive for update to public using ((auth.uid() = id));

drop policy if exists contracts_client_select on public.project_contracts;
create policy contracts_client_select on public.project_contracts as permissive for select to public using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_contracts.project_id) AND (p.client_portal IS NOT NULL) AND (((p.client_portal ->> 'enabled'::text))::boolean = true)))));

drop policy if exists contracts_client_sign on public.project_contracts;
create policy contracts_client_sign on public.project_contracts as permissive for update to public using (((status = 'sent'::text) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = project_contracts.project_id) AND (p.client_portal IS NOT NULL) AND (((p.client_portal ->> 'enabled'::text))::boolean = true))))));

drop policy if exists contracts_gc_delete on public.project_contracts;
create policy contracts_gc_delete on public.project_contracts as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists contracts_gc_insert on public.project_contracts;
create policy contracts_gc_insert on public.project_contracts as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists contracts_gc_select on public.project_contracts;
create policy contracts_gc_select on public.project_contracts as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists contracts_gc_update on public.project_contracts;
create policy contracts_gc_update on public.project_contracts as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists projects_delete on public.projects;
create policy projects_delete on public.projects as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own on public.projects as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists projects_insert on public.projects;
create policy projects_insert on public.projects as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own on public.projects as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists projects_select_own on public.projects;
create policy projects_select_own on public.projects as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists projects_update on public.projects;
create policy projects_update on public.projects as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own on public.projects as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists bids_delete_own on public.public_bids;
create policy bids_delete_own on public.public_bids as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists bids_insert_auth on public.public_bids;
create policy bids_insert_auth on public.public_bids as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists bids_select_all on public.public_bids;
create policy bids_select_all on public.public_bids as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists bids_update_own on public.public_bids;
create policy bids_update_own on public.public_bids as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists public_bids_delete on public.public_bids;
create policy public_bids_delete on public.public_bids as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists public_bids_insert on public.public_bids;
create policy public_bids_insert on public.public_bids as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists public_bids_select on public.public_bids;
create policy public_bids_select on public.public_bids as permissive for select to authenticated using (true);

drop policy if exists public_bids_update on public.public_bids;
create policy public_bids_update on public.public_bids as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists punch_delete_own on public.punch_items;
create policy punch_delete_own on public.punch_items as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists punch_insert_own on public.punch_items;
create policy punch_insert_own on public.punch_items as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists punch_items_delete on public.punch_items;
create policy punch_items_delete on public.punch_items as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists punch_items_insert on public.punch_items;
create policy punch_items_insert on public.punch_items as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists punch_items_select on public.punch_items;
create policy punch_items_select on public.punch_items as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists punch_items_update on public.punch_items;
create policy punch_items_update on public.punch_items as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists punch_select_own on public.punch_items;
create policy punch_select_own on public.punch_items as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists punch_update_own on public.punch_items;
create policy punch_update_own on public.punch_items as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists rate_limit_counters_select on public.rate_limit_counters;
create policy rate_limit_counters_select on public.rate_limit_counters as permissive for select to anon, authenticated using (true);

drop policy if exists rfis_delete on public.rfis;
create policy rfis_delete on public.rfis as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists rfis_delete_own on public.rfis;
create policy rfis_delete_own on public.rfis as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists rfis_insert on public.rfis;
create policy rfis_insert on public.rfis as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists rfis_insert_own on public.rfis;
create policy rfis_insert_own on public.rfis as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists rfis_select on public.rfis;
create policy rfis_select on public.rfis as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists rfis_select_own on public.rfis;
create policy rfis_select_own on public.rfis as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists rfis_update on public.rfis;
create policy rfis_update on public.rfis as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists rfis_update_own on public.rfis;
create policy rfis_update_own on public.rfis as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists selcat_client_select on public.selection_categories;
create policy selcat_client_select on public.selection_categories as permissive for select to public using ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = selection_categories.project_id) AND (p.client_portal IS NOT NULL) AND (((p.client_portal ->> 'enabled'::text))::boolean = true)))));

drop policy if exists selcat_gc_delete on public.selection_categories;
create policy selcat_gc_delete on public.selection_categories as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists selcat_gc_insert on public.selection_categories;
create policy selcat_gc_insert on public.selection_categories as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists selcat_gc_select on public.selection_categories;
create policy selcat_gc_select on public.selection_categories as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists selcat_gc_update on public.selection_categories;
create policy selcat_gc_update on public.selection_categories as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists selopt_client_choose on public.selection_options;
create policy selopt_client_choose on public.selection_options as permissive for update to public using ((EXISTS ( SELECT 1
   FROM (selection_categories c
     JOIN projects p ON ((p.id = c.project_id)))
  WHERE ((c.id = selection_options.category_id) AND (p.client_portal IS NOT NULL) AND (((p.client_portal ->> 'enabled'::text))::boolean = true)))));

drop policy if exists selopt_client_select on public.selection_options;
create policy selopt_client_select on public.selection_options as permissive for select to public using ((EXISTS ( SELECT 1
   FROM (selection_categories c
     JOIN projects p ON ((p.id = c.project_id)))
  WHERE ((c.id = selection_options.category_id) AND (p.client_portal IS NOT NULL) AND (((p.client_portal ->> 'enabled'::text))::boolean = true)))));

drop policy if exists selopt_gc_all on public.selection_options;
create policy selopt_gc_all on public.selection_options as permissive for all to public using ((EXISTS ( SELECT 1
   FROM selection_categories c
  WHERE ((c.id = selection_options.category_id) AND (c.user_id = auth.uid())))));

drop policy if exists sub_change_requests_delete_own on public.sub_change_requests;
create policy sub_change_requests_delete_own on public.sub_change_requests as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists sub_change_requests_no_anon_write on public.sub_change_requests;
create policy sub_change_requests_no_anon_write on public.sub_change_requests as permissive for insert to authenticated with check ((auth.uid() = user_id));

drop policy if exists sub_change_requests_select_own on public.sub_change_requests;
create policy sub_change_requests_select_own on public.sub_change_requests as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists sub_change_requests_update_own on public.sub_change_requests;
create policy sub_change_requests_update_own on public.sub_change_requests as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists "gc deletes own sub portal links" on public.sub_portal_links;
create policy "gc deletes own sub portal links" on public.sub_portal_links as permissive for delete to authenticated using ((user_id = auth.uid()));

drop policy if exists "gc reads own sub portal links" on public.sub_portal_links;
create policy "gc reads own sub portal links" on public.sub_portal_links as permissive for select to authenticated using ((user_id = auth.uid()));

drop policy if exists "gc updates own sub portal links" on public.sub_portal_links;
create policy "gc updates own sub portal links" on public.sub_portal_links as permissive for update to authenticated using ((user_id = auth.uid())) with check ((user_id = auth.uid()));

drop policy if exists "gc writes own sub portal links" on public.sub_portal_links;
create policy "gc writes own sub portal links" on public.sub_portal_links as permissive for insert to authenticated with check ((user_id = auth.uid()));

drop policy if exists sub_portal_snapshots_anon_read on public.sub_portal_snapshots;
create policy sub_portal_snapshots_anon_read on public.sub_portal_snapshots as permissive for select to anon using (true);

drop policy if exists sub_portal_snapshots_authed_read on public.sub_portal_snapshots;
create policy sub_portal_snapshots_authed_read on public.sub_portal_snapshots as permissive for select to authenticated using (true);

drop policy if exists sub_portal_snapshots_owner_write on public.sub_portal_snapshots;
create policy sub_portal_snapshots_owner_write on public.sub_portal_snapshots as permissive for all to authenticated using ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid())))) with check ((project_id IN ( SELECT projects.id
   FROM projects
  WHERE (projects.user_id = auth.uid()))));

drop policy if exists "gc reads sub invoices for own portals" on public.sub_submitted_invoices;
create policy "gc reads sub invoices for own portals" on public.sub_submitted_invoices as permissive for select to authenticated using ((EXISTS ( SELECT 1
   FROM sub_portal_links spl
  WHERE ((spl.id = sub_submitted_invoices.sub_portal_id) AND (spl.user_id = auth.uid())))));

drop policy if exists "gc updates sub invoices for own portals" on public.sub_submitted_invoices;
create policy "gc updates sub invoices for own portals" on public.sub_submitted_invoices as permissive for update to authenticated using ((EXISTS ( SELECT 1
   FROM sub_portal_links spl
  WHERE ((spl.id = sub_submitted_invoices.sub_portal_id) AND (spl.user_id = auth.uid()))))) with check ((status = ANY (ARRAY['submitted'::text, 'approved'::text, 'rejected'::text, 'paid'::text])));

drop policy if exists "subs submit invoices to known portals" on public.sub_submitted_invoices;
create policy "subs submit invoices to known portals" on public.sub_submitted_invoices as permissive for insert to anon, authenticated with check (((status = 'submitted'::text) AND is_published_sub_portal(sub_portal_id)));

drop policy if exists subcontractors_delete on public.subcontractors;
create policy subcontractors_delete on public.subcontractors as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists subcontractors_insert on public.subcontractors;
create policy subcontractors_insert on public.subcontractors as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists subcontractors_select on public.subcontractors;
create policy subcontractors_select on public.subcontractors as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists subcontractors_update on public.subcontractors;
create policy subcontractors_update on public.subcontractors as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists subs_delete_own on public.subcontractors;
create policy subs_delete_own on public.subcontractors as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists subs_insert_own on public.subcontractors;
create policy subs_insert_own on public.subcontractors as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists subs_select_own on public.subcontractors;
create policy subs_select_own on public.subcontractors as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists subs_update_own on public.subcontractors;
create policy subs_update_own on public.subcontractors as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists submittals_delete on public.submittals;
create policy submittals_delete on public.submittals as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists submittals_delete_own on public.submittals;
create policy submittals_delete_own on public.submittals as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists submittals_insert on public.submittals;
create policy submittals_insert on public.submittals as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists submittals_insert_own on public.submittals;
create policy submittals_insert_own on public.submittals as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists submittals_select on public.submittals;
create policy submittals_select on public.submittals as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists submittals_select_own on public.submittals;
create policy submittals_select_own on public.submittals as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists submittals_update on public.submittals;
create policy submittals_update on public.submittals as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists submittals_update_own on public.submittals;
create policy submittals_update_own on public.submittals as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists subs_tier_insert_own on public.subscriptions;
create policy subs_tier_insert_own on public.subscriptions as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists subs_tier_select_own on public.subscriptions;
create policy subs_tier_select_own on public.subscriptions as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists subs_tier_update_own on public.subscriptions;
create policy subs_tier_update_own on public.subscriptions as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists "Users can delete their own time entries" on public.time_entries;
create policy "Users can delete their own time entries" on public.time_entries as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists "Users can insert their own time entries" on public.time_entries;
create policy "Users can insert their own time entries" on public.time_entries as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists "Users can update their own time entries" on public.time_entries;
create policy "Users can update their own time entries" on public.time_entries as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists "Users can view their own time entries" on public.time_entries;
create policy "Users can view their own time entries" on public.time_entries as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists tracked_bids_delete_own on public.user_tracked_bids;
create policy tracked_bids_delete_own on public.user_tracked_bids as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists tracked_bids_insert_own on public.user_tracked_bids;
create policy tracked_bids_insert_own on public.user_tracked_bids as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists tracked_bids_select_own on public.user_tracked_bids;
create policy tracked_bids_select_own on public.user_tracked_bids as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists tracked_bids_update_own on public.user_tracked_bids;
create policy tracked_bids_update_own on public.user_tracked_bids as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists user_tracked_bids_all on public.user_tracked_bids;
create policy user_tracked_bids_all on public.user_tracked_bids as permissive for all to public using ((auth.uid() = user_id));

drop policy if exists warranties_owner_all on public.warranties;
create policy warranties_owner_all on public.warranties as permissive for all to authenticated using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists worker_profiles_delete on public.worker_profiles;
create policy worker_profiles_delete on public.worker_profiles as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists worker_profiles_insert on public.worker_profiles;
create policy worker_profiles_insert on public.worker_profiles as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists worker_profiles_select on public.worker_profiles;
create policy worker_profiles_select on public.worker_profiles as permissive for select to authenticated using (true);

drop policy if exists worker_profiles_update on public.worker_profiles;
create policy worker_profiles_update on public.worker_profiles as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists workers_insert_auth on public.worker_profiles;
create policy workers_insert_auth on public.worker_profiles as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists workers_select_all on public.worker_profiles;
create policy workers_select_all on public.worker_profiles as permissive for select to public using ((auth.role() = 'authenticated'::text));

drop policy if exists workers_update_own on public.worker_profiles;
create policy workers_update_own on public.worker_profiles as permissive for update to public using ((auth.uid() = user_id));

drop policy if exists workers_delete_own on public.workers;
create policy workers_delete_own on public.workers as permissive for delete to public using ((auth.uid() = user_id));

drop policy if exists workers_insert_own on public.workers;
create policy workers_insert_own on public.workers as permissive for insert to public with check ((auth.uid() = user_id));

drop policy if exists workers_select_own on public.workers;
create policy workers_select_own on public.workers as permissive for select to public using ((auth.uid() = user_id));

drop policy if exists workers_update_own on public.workers;
create policy workers_update_own on public.workers as permissive for update to public using ((auth.uid() = user_id)) with check ((auth.uid() = user_id));

drop policy if exists zip_factors_select_all on public.zip_cost_factors;
create policy zip_factors_select_all on public.zip_cost_factors as permissive for select to public using ((auth.role() = 'authenticated'::text));
