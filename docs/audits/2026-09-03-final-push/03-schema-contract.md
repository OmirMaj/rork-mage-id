# Schema contract (app ↔ database) — final-push audit — 2026-09-03

Domain: the contract between what the app/edge functions/portals write and read and what production Postgres
actually accepts. Production truth = `supabase/schema.sql` (regenerated 2026-09-03, MD5-verified) plus
SELECT-only probes against project `nteoqhcswappxxjlpvap`.

## Scope covered (files/paths actually read; commands run)

**Production surface parsed** (`tools/parse_schema.py` → `schema.json`): 108 tables (every column, type,
NOT NULL, DEFAULT), 108 PK + 16 UNIQUE + 98 CHECK + 134 FK constraints, 227 indexes (2 unique partial),
56 triggers, all 82 application functions with full bodies and argument names/types.

**App surface extracted mechanically and cross-checked** (all scripts under
`scratchpad/audit/tools/`, repo untouched):
- `extract_chains.py` — every `.from('<table>')` chain in `app/ components/ contexts/ hooks/ utils/ lib/
  backend/ supabase/functions/` (253 chains; 79 of them `select('*')` reads): select column lists (incl.
  embedded resources, aliases, `->>` paths), `.eq/.neq/.in/.is/.gt/…/.or()/.match()` filter columns,
  `.order()` columns, inline `insert/upsert/update` object keys, `onConflict` targets vs PK/UNIQUE/unique
  indexes, and all 17 `.rpc()` calls vs function names + argument names.
- `extract_writes.py` + `extract_mappers.py` + `check_local_payloads.py` — all 181 `supabaseWrite(...)` /
  `addToOfflineQueue(...)` sites (the offline-first write path), following 25 row mappers
  (`*ToRow`, `toRow`, `toDB`, `deliveryRow`, …) and 13 variable payloads (`row`, `patch`, `rows`,
  `upserts`, …) to their object literals; every key checked against columns; NOT NULL-without-DEFAULT
  coverage checked on every insert/upsert; `id` presence checked on every update/delete
  (`offlineQueue` filters `.eq('id', …)`).
- `check_read_mappers.py` — read direction: every snake_case key a row→domain mapper reads after a
  `select('*')` (the "value never round-trips" class).
- `check_fn_bodies.py` — every SQL function body: `insert into t(cols)`, `update t set col`, `alias.col`
  references vs live columns.
- `check_enums2.py` + direct reads of `types/index.ts`, `utils/buildingAccess.ts`,
  `utils/deliverySchedule.ts`, `utils/brain/types.ts`, `utils/apReconciliation.ts`,
  `utils/onboardingProfile.ts`, `utils/closeoutBinderEngine.ts` — every CHECK-enumerated column vs the
  literal values / TS unions the app can write (table at the end).
- REST surface: all 85 `/rest/v1/…?select=…&order=…&col=eq.…` URLs in edge functions (columns, order,
  filters, `on_conflict`); 13 edge-function `rest/v1/rpc/*` bodies; the portal
  (`marketing/portal/index.html`, 11 RPC calls), sub-portal (2) and architect page (2) JSON bodies vs
  function signatures; 11 realtime `postgres_changes` subscriptions (table + filter column); all 11
  storage bucket literals vs `storage.buckets`.
- Type/identity passes: integer/numeric/date/boolean/uuid/jsonb columns vs the RHS the app sends; every
  `: <DomainType> = {` literal's `id:` source for uuid-typed id columns; `number`-named columns vs TS.
- Reverse contract: `utils/offlineQueue.ts` read end to end (error classification, retry, cap); bodies of
  all guard/freeze triggers (`projects_freeze_ownership_columns`, `crew_freeze_ownership_columns`,
  `sub_invoice_freeze_columns`, `portal_proposal_freeze_project`, `co_approval_freeze_evidence`,
  `freeze_certified_aia_pay_app`, `wip_periods_block_locked_update`,
  `enforce_subscription_tier_authority`, `enforce_free_tier_project_cap`, `portal_set_access_token`) vs
  the app's update/upsert payloads for those tables.
- Prior audits re-read for closures: `docs/audits/2026-08-31-medium-sweep.md` (#7, #10, #14, #15, #16,
  #20, #24), `docs/audits/2026-09-02-launch-readiness.md`; `docs/START-HERE.md` banner.

**Production SELECT-only probes:** `storage.buckets`; `information_schema.columns` for
`profiles.full_name`, `sub_portal_links.sub_name/sub_portal_id`, `*.fetched_at`, `rfis/submittals.share_token`
defaults; row counts (companies 0, job_listings 0, worker_profiles 0, cost_seeds 0, public_bids 3,
projects 7, profiles 30, subscriptions 23, rfis with token 3, submittals with token 2);
`select public.get_rfi_by_token('00000000-0000-0000-0000-000000000000')` (a pure-SELECT function).

## Findings (ranked; most severe first)

### F1 — P1 CONFIRMED — Both architect/pro reply RPCs select `profiles.full_name`, a column that does not exist, so every "reply via portal" link ever emailed to an architect or sub fails to load.
- Where: `supabase/schema.sql:4424` (`get_rfi_by_token`, the `'company_name', COALESCE(prof.full_name, 'MAGE ID')`
  select) and `:4484` (`get_submittal_by_token`, same expression); callers `marketing/architect/index.html:313`
  (`rpc()` → `/rest/v1/rpc/<fn>` with the anon key), `:538` (`fetchFn = DOC_TYPE === 'rfi' ? 'get_rfi_by_token'
  : 'get_submittal_by_token'`), `:539-550` (error path → `renderError('Could not load this document.')`);
  link minting `app/rfi.tsx:338-339` (`https://mageid.app/architect/?token=${existingRFI.shareToken}&type=rfi`),
  `app/submittal.tsx:169-170`; email body `utils/emailService.ts:837`; tokens read back at
  `contexts/ProjectContext.tsx:1497`, `:1529`.
- Evidence: live probe → `ERROR: 42703: column prof.full_name does not exist … CONTEXT: PL/pgSQL function
  get_rfi_by_token(uuid) line 9`. `information_schema`: `profiles.full_name` = 0 columns (profiles has
  `name`, `contact_name`, `company_name`). `rfis.share_token` and `submittals.share_token` default to
  `gen_random_uuid()`, so every RFI/submittal already carries a valid token (3 + 2 rows in prod). Neither
  function exists in any file under `supabase/migrations/` — they live only in production.
  `submit_pro_response` (`schema.sql:5433`) is correct and would write `rfis.response`, `status='answered'`
  and `submittals.review_cycles/current_status`, but the page never reaches it.
- Failure scenario: GC opens an RFI → "Send" → architect receives the email → taps the reply link → page
  shows "Could not load this document." → no answer can be given; the GC keeps chasing an RFI that the
  architect cannot open. Same for submittal reviews. 100% failure rate, third-party facing.
- Fix: one migration that `CREATE OR REPLACE`s both functions with
  `COALESCE(prof.company_name, prof.contact_name, prof.name, 'MAGE ID')`; regenerate `schema.sql`; open one
  real token in the architect page. Effort: S.

### F2 — P1 CONFIRMED — Every cost-seed write carries `deleted_at`, the column that was deliberately not applied, so the whole cost book (not only deletes) is rejected with PGRST204, classified "transient", and re-queued forever; production `cost_seeds` holds 0 rows.
- Where: `utils/costSeedCore.ts:619-636` (`seedToRow` emits `deleted_at: s.deletedAt ?? null` on every row,
  `:635`); `hooks/useCostSeeds.ts:166`, `:211`, `:235` (`supabaseWrite(TABLE, 'upsert', seedToRow(...))`,
  `TABLE='cost_seeds'` at `:92`); `utils/offlineQueue.ts:85-92` (`isSchemaCacheError`: "could not find … column"
  = transient), `:451-457` (live path: silently `addToOfflineQueue`, no toast, no Sentry), `:292-305`
  (flush: re-queued UNCHANGED, retry budget never burned), `:114-118` (queue cap 1000 evicts the OLDEST
  entries FIFO — i.e. other tables' pending writes).
- Evidence: `schema.sql §1 CREATE TABLE public.cost_seeds` columns = id, user_id, trade, unit, rate,
  reported_jobs, as_of, note, method, created_at, updated_at — no `deleted_at`. `JSON.stringify` keeps
  `null` (only `undefined` is dropped), so the key is always on the wire. Production count: 0 rows with 30
  profiles. The recorded consequence (`docs/START-HERE.md` "THREE THINGS DELIBERATELY HELD BACK" #3, and
  `hooks/useCostSeeds.ts:28-33`: "an upsert carrying it … deletes take effect on-device … nothing is lost")
  covers only tombstones; it misses that live rows carry the key too.
- Failure scenario: contractor pastes 40 rates → 40 upserts → each 400 `PGRST204 Could not find the
  'deleted_at' column of 'cost_seeds' in the schema cache` → queued; every flush retries all 40 and re-queues
  them; no toast ever. Reinstall or second device → cost book empty (the exact loss the file's own header
  says it fixed). Heavy users approach the 1,000-entry cap, at which point unrelated queued writes are
  evicted with a "queue cap exceeded" toast. The learned-cost moat is device-local for everyone.
- Fix (smallest, no schema change): in `seedToRow` emit the key only when set —
  `...(s.deletedAt ? { deleted_at: s.deletedAt } : {})` — live rows sync immediately, tombstones keep
  waiting for the column. Long-term: founder call on applying the `deleted_at` half of
  `20260826150000`. Effort: S.

### F3 — P2 CONFIRMED — `companies` is read with `.order('fetched_at')`, a column that does not exist; the 400 is swallowed and the app silently serves only the device-local cache (the closed medium-sweep #14 fixed `public_bids` but not its three siblings).
- Where: `contexts/CompaniesContext.tsx:24-27` (`.from('companies').select('*').order('fetched_at', …)`),
  `:28` (`if (!error && data && data.length > 0)`), `:44-52` (`console.log` + AsyncStorage fallback);
  write side works: `:68` (`supabaseWrite('companies', 'insert', …)`). Same shape, latent because
  `HIRE_ENABLED = false` (`contexts/HireContext.tsx:32`): `:68-71` (`job_listings`) and `:108-111`
  (`worker_profiles`). Consumers of the dead read: `app/company-detail.tsx:44`, `app/bid-detail.tsx:255`,
  `app/get-verified.tsx:55`, `app/submit-bid-response.tsx:103`, `app/safety-osha.tsx:82`,
  `components/InstantBidProposalModal.tsx:45`. Prior closure: `docs/audits/2026-08-31-medium-sweep.md:158-166`.
- Evidence: `schema.sql §1 CREATE TABLE public.companies` (columns end `…created_at, service_states,
  service_radius_miles, service_origin_lat, service_origin_lng`); live `has_fetched_at=false` for
  companies, job_listings, worker_profiles; PostgREST answers 42703 → supabase-js `{error}` → the
  condition falls through.
- Failure scenario: user creates a company profile (insert succeeds) → any other device, or this device
  after a cache wipe/reinstall → Companies list empty, `company-detail` cannot find the id, "Get verified"
  cannot see the company; nothing is shown to the user. Row count is 0 today, so nobody has hit it yet.
- Fix: `.order('created_at', { ascending: false })` at the three sites and drop the `data.length > 0`
  gate so a legitimately empty account is distinguishable from a rejected read. Effort: S.

### F4 — P3 CONFIRMED — `submit_sub_change_request` references `sub_portal_links.sub_name` and `.sub_portal_id`, neither of which exists; the SECURITY DEFINER RPC can never execute, and nothing calls it.
- Where: `supabase/schema.sql:5519` (body: `COALESCE(spl.sub_name, 'Sub')`, `WHERE spl.sub_portal_id =
  sub_portal_id_in`); `sub_portal_links` columns are `id, user_id, project_id, subcontractor_id, passcode,
  require_passcode, enabled, welcome_message, commitment_ids, created_at, updated_at, last_shared_at,
  access_token`. No caller in the app, edge functions, `marketing/sub-portal/index.html` (calls only
  `sub_portal_get_snapshot` `:1310` and `sub_portal_submit_invoice` `:1064`) or scripts.
- Evidence: live `information_schema` count for those two columns = 0; `check_fn_bodies.py`.
- Failure scenario: none today (dead); the moment a "request a change" button is wired to it, it 400s.
- Fix: drop the function and the orphan `sub_change_requests` table, or rewrite as `WHERE spl.id =
  sub_portal_id_in` with the name from `subcontractors`. Effort: S.

### F5 — P3 CONFIRMED — Ten tables exist in production (with RLS and policies) that no code reads or writes.
- Where: `supabase/schema.sql §1`: `draw_periods`, `labor_rates`, `material_prices`, `materials_pricing`,
  `owner_supplied_items`, `permit_templates`, `user_tracked_bids`, `zip_cost_factors`, `workers`,
  `estimate_versions` (the table; the same-named `projects` column is live). Plus `sub_change_requests`
  (F4) and, only behind `HIRE_ENABLED=false`, `conversations`, `conversation_participants`, `messages`,
  `job_listings`, `worker_profiles`.
- Evidence: zero quoted references across `app/ components/ contexts/ hooks/ utils/ lib/ supabase/functions/
  marketing/{portal,sub-portal,architect} scripts/`, and no application SQL function body references them.
  (`pro_responses`, `rfp_post_payments`, `portal_decision_audit`, `app_config` are server-only by design and
  are referenced from function bodies — not dead.)
- Failure scenario: none functional; they widen the 337-policy RLS surface and mislead audits into
  believing features exist (owner-supplied items, draw periods, zip cost factors).
- Fix: drop or mark each in a `docs/schema-inventory.md`; keep the migration history. Effort: S.

## ADD / CONNECT / DO BETTER (ranked by leverage)

### O1 — Wire a schema-contract guard into `ship-check` — leverage: this one guard would have caught the three historical bugs in the brief ((a) `subscriptions_tier_check`, (b) `qbo_connections.realm_id`, (c) `public_bids.fetched_at`) and F1–F4 here before they shipped; no existing guard does it — evidence of the gap: only `scripts/validate-rls-write-leaks.ts` and `scripts/validate-account-deletion.ts` consume `schema.sql`, and none of the 205 guards parses a query chain — sketch: port `tools/parse_schema.py` + `extract_chains.py` + `extract_writes.py` + `check_fn_bodies.py` to `scripts/validate-schema-contract.ts`; fail on any `.from/.select/.order/filter` column, `supabaseWrite`/mapper key, `.rpc` name/argument, `onConflict` target, REST `select=` column, or SQL-function column reference that does not exist in `schema.sql`; add it to `validate-guard-coverage`.
### O2 — Generate `Database` types and type the client — leverage: turns column drift into a `tsc` error at edit time instead of a runtime 400 — evidence: `lib/supabase.ts` creates an untyped client; every mapper returns `Record<string, unknown>` — sketch: `supabase gen types typescript --project-id nteoqhcswappxxjlpvap > types/database.ts`, `createClient<Database>()`, type `supabaseWrite<T extends keyof Database['public']['Tables']>(table: T, op, data: Tables[T]['Insert'] | Partial<Tables[T]['Update']>)`.
### O3 — Make "schema-cache" retries visible — leverage: F2 was invisible for a month because PGRST204 never toasts or reports — evidence: `utils/offlineQueue.ts:85-92`, `:292-305`, `:451-457` — sketch: count schema-cache re-queues per table; after N flushes (or 24 h) `Sentry.captureMessage` once and show a one-time toast "Waiting for a server update to save <table>"; expose the count in Settings → Diagnostics.
### O4 — Close the architect loop end to end once F1 lands — leverage: it is the only place a third party writes back into the GC's RFI/submittal without an account — evidence: `submit_pro_response` already mirrors into `rfis.response/status` and `submittals.review_cycles`, mapped at `contexts/ProjectContext.tsx:1497/1529` — sketch: a "Answered via portal · <responder>" chip on the RFI/submittal row, a push via `notification_outbox` from an AFTER INSERT trigger on `pro_responses`, and a smoke test that opens one real token.
### O5 — Retire the dead tables (F5) — leverage: smaller RLS/policy surface, fewer false leads for future audits — sketch: one migration dropping the ten tables (or `COMMENT ON TABLE … IS 'unused as of 2026-09'`), regenerate `schema.sql`.
### O6 — Treat "empty" as data, not failure, in every server-first read — leverage: the `data.length > 0` gate (CompaniesContext `:28`, HireContext `:72/:112`) hides rejected reads behind the local cache; the same pattern was called out in #14 — sketch: branch on `error` only; log `error.code` to Sentry.

## Appendix — lower-severity notes (one line each with file:line)
- P2 LIKELY — `marketing/dist/portal/index.html:5778` (built copy) calls only `portal_get_snapshot`; the source `marketing/portal/index.html:6785-6786` calls `portal_get_snapshot_v2` first and also has `portal_submit_co_approval_signed` (`:5429`, absent from dist). If Netlify serves `dist/`, portal link expiry (`portal_snapshots.expires_at`) and e-sign CO approval are not live for viewers — verify which directory `netlify deploy --dir` publishes.
- P3 — `utils/offlineQueue.ts:137-147` `isTerminalError` does not recognise custom `RAISE EXCEPTION` text (e.g. `enforce_free_tier_project_cap` "Free tier is limited…", `freeze_certified_aia_pay_app`, `wip_periods_block_locked_update`); such rejections burn 5 retries before the drop toast. Client-side gates (`app/(tabs)/(home)/index.tsx:153`, `contexts/WipContext.tsx:158`) make these backstops today.
- P3 — `app/safety-incidents.tsx:255-271` sends `Number(daysAway) || 0` into `safety_incidents.days_away integer`; a typed "1.5" → `22P02` → the incident write is retried and dropped with a toast.
- P3 — `contexts/ProjectContext.tsx:793` read mapper coerces `field_tickets.number` (integer) with `(r.number as string) ?? ''` — type drift only; the write side (`:2802`) is integer-correct.
- P3 — `contexts/SubscriptionContext.tsx:134-139` client upsert of `subscriptions` carries `tier`; `enforce_subscription_tier_authority` pins it for `authenticated` writers (documented at `:126-131`) — consistent, no action.
- Info — `notification_outbox_recipient_kind_check` vs the app's `'user'` is the known founder item; not re-reported.
- Verified consistent (no finding): all 11 storage buckets the code uses exist (`branding, documents, pdf-uploads, plan-sheets, profiles, project-documents, project-photos, rfp-attachments, secure-contracts, sub-documents, worker-ids`); all 20 upsert `onConflict` targets match a PK/UNIQUE (`portal_snapshots.portal_id`, `sub_portal_snapshots.sub_portal_id`, `feature_interest(user_id,event_key)`, `subscriptions.user_id`, `cost_benchmark_samples` PK, `project_contracts/closeout_binders/lien_waivers/selection_*.id`, `qbo_cost_lines(user_id,qbo_type,qbo_id,qbo_line_id)`, `city_coords(city,state)`, `project_financials.project_id`, `cached_bids.notice_id`, `cached_jobs.external_id`, `cached_companies.place_id`, `memory_embeddings(user_id,doc_id)`, `email_unsubscribes(email,event_key)`); all 17 in-app `.rpc()`, 13 edge REST rpc, 11 portal, 2 sub-portal and 2 architect RPC calls match function names and argument names; all 85 edge REST `select=/order=/filter` URLs reference existing columns; all 79 `select('*')` read mappers read only existing columns; every inline payload key, 25 mapper outputs, 13 variable payloads and 5 edge batch upserts use existing columns with complete NOT NULL coverage (F2's extra key is the sole exception); every uuid-typed id column receives `generateUUID()`/`createId()`→`generateUUID()` (prefixed ids `cam-/roll-/rev-/scn-/custom-/t-/vh-/pay-/exp-` are local-only objects; text-id tables `delay_events, field_tickets, time_entries, certifications, safety_inspections, safety_templates, sub_portal_links, financing_referrals` accept the app's ids); 11 realtime subscriptions reference existing tables/filter columns; `portal_mark_item_viewed` casts `id::text`/`project_id::text` so mixed uuid/text `project_id` tables work; freeze triggers silently restore ownership columns instead of erroring, `portal_set_access_token` re-injects the OLD token on UPDATE, and `set_updated_at` triggers override client `updated_at` — the reverse contract is sound.

### CHECK enumerations verified against what the app can write
| Column (constraint) | DB values | App source | Result |
|---|---|---|---|
| access_reservations.kind / .status | freight_elevator,dock,after_hours,badging / requested,confirmed,denied,cancelled | `AccessKind`/`AccessStatus` `utils/buildingAccess.ts:59-60` | exact |
| *_portal_state_status_check ×9 (aia_pay_apps, change_orders, daily_reports, invoices, photos, rfis, selection_categories, submittals, warranties) | draft,sent,recalled | `PortalState.status` (types/index.ts) | exact |
| brain_predictions.kind | 8 kinds | `PredictionKind` `utils/brain/types.ts:1-9` | exact 8/8 |
| certifications.status | valid,expiring,expired | `CertificationStatus` | exact |
| change_order_approvals.decision | approved,declined | literal `app/client-view.tsx:747`; RPCs validate | exact |
| closeout_binders.status | draft,finalized,sent | `utils/closeoutBinderEngine.ts:36` | exact |
| cost_seeds.method | paste,manual | `utils/costSeedCore.ts:633` | exact |
| crew_members.id_type / .status | 4 / active,inactive | `IdDocumentType` / `CrewMemberStatus` | exact |
| daily_reports.status | draft,sent | `DFRStatus` `types/index.ts:1648` | exact |
| delay_events.cause / .classification | 9 / 4 | `DelayCause` / `DelayClassification` | exact |
| deliveries.status | scheduled,confirmed,delivered,cancelled | `DeliveryStatus` `utils/deliverySchedule.ts:25-34` | exact |
| drawing_pins.kind | note,photo,punch,rfi | TS union | exact |
| equipment.status / .type | 4 / owned,rented | inline unions | exact |
| field_tickets.status | draft,signed,converted,void | `FieldTicketStatus` | exact |
| financing_referrals.source / .status | estimate,invoice,portal / created,clicked,prequalified,funded,declined | `FinancingReferralSource` `types/index.ts:1091`; literals `hooks/useFinancingReferrals.ts:77`, `financing-redirect/index.ts:111,125`, `financing-callback/index.ts:56` allow-list | exact |
| hazards.status; .severity/.likelihood 1–5 | open,mitigated,closed; 1..5 | `HazardStatus`; `HazardScale = 1|2|3|4|5` `types/index.ts:2605-2606` | exact |
| invoices.type / .qbo_sync_status | full,progress / pending,synced,error | TS union; edge literals `qbo-reconciler:162`, `qbo-mapping/invoice.ts:90` | exact |
| jhas.status | draft,active,archived | `JHAStatus` `types/index.ts:2496` | exact |
| job_listings.pay_type/.status; worker_profiles.availability | — | TS unions (feature gated off) | exact |
| lien_waivers.status / .waiver_type | 4 / 4 | `LienWaiverStatus` / `LienWaiverType` | exact |
| plan_markups.type | arrow,rectangle,circle,freehand,text | TS union | exact |
| portal_budget_proposals.status | pending,accepted,declined | `hooks/usePortalBudgetProposals.ts:64,81,85`; RPC writes `pending` | exact |
| portal_messages.author_type | client,gc | `contexts/ProjectContext.tsx:3724` (`'gc'`); RPC `'client'` | exact |
| price_alerts.direction | below,above | `AlertDirection` | exact |
| profiles.units / .user_role / .push_token_platform | imperial,metric / 4 roles / ios,android,web | settings cast `ProjectContext.tsx:648`; `UserRole` `utils/onboardingProfile.ts:19`; platform never written by the app | exact / exact / n.a. |
| project_collaborators.role / .status | owner,editor,viewer / pending,accepted,revoked | `project-invite/index.ts:218-219` (`ROLES`, owner rejected); status literals | exact |
| project_contracts.status | draft,sent,signed,void | `ContractStatus` | exact |
| projects.status | draft,estimated,in_progress,completed,closed | `types/index.ts:224` | exact |
| public_bids.status | open,closed | `BidStatus` | exact |
| punch_items.status / .priority | 4 / 3 | `PunchItemStatus` / `PunchItemPriority` | exact |
| qbo_connections.status / .environment | 5 / sandbox,production | `_shared/qbo.ts:22-27` types; literals `qbo-connect-callback:156`, `_shared/qbo.ts:112,130` | exact |
| qbo_cost_lines.qbo_type / .status | purchase,bill / staged,confirmed,rejected | `qbo-reconciler/index.ts:55`; literals | exact |
| rfis.status / .priority | 4 / 3 | `RFIStatus` / `RFIPriority` | exact |
| safety_incidents.type/.severity/.status/.treatment/.osha_illness_type | — | 5 TS unions | exact |
| safety_inspections.status; safety_templates.category; toolbox_talks.ai_topic_source | — | TS unions | exact |
| selection_categories.status; selection_options.source / .chosen_by_role | — | `SelectionCategoryStatus`, `SelectionOptionSource`, inline union | exact |
| sub_submitted_invoices.status / .payment_method (NOT VALID) | submitted,approved,rejected,paid / check,ach,card,cash,other | `hooks/useSubSubmittedInvoices.ts:145-157`; `PAYMENT_METHODS` `utils/apReconciliation.ts:14-16` | exact |
| subscriptions.tier | free,pro,business,enterprise | webhook entitlement map; trigger pins client writes | exact |
| time_entries.status | clocked_in,clocked_out,break | `TimeEntryStatus` | exact |
| notification_outbox.recipient_kind | gc,client,sub | app writes `'user'` | known founder item |
| draw_periods, owner_supplied_items, permit_templates, user_tracked_bids | — | no writer (F5) | n.a. |

## What I could not verify (and how it could be)
- `get_submittal_by_token` was not executed live (only `get_rfi_by_token` was); its failing expression is
  byte-identical and `profiles.full_name` is confirmed absent, so F1 covers both. Confirm with the same
  SELECT probe after the fix.
- Device-side offline queues (F2) are AsyncStorage and not inspectable from here; the 0-row production count
  is the corroboration. Confirm on a device: add a rate, watch `[OfflineQueue] Transient error, queuing
  mutation: cost_seeds upsert` in Metro, then `select count(*) from cost_seeds` — stays 0 until the fix.
- Which directory Netlify serves for the portal (`marketing/` vs `marketing/dist/`) — determines whether the
  appendix's stale-dist note is live.
- The Hire surfaces (`job_listings`, `worker_profiles`, `messages`, `conversations`) are behind
  `HIRE_ENABLED=false` and were only statically checked.
- No app was run; every claim above is from code + the verified schema + SELECT probes.
