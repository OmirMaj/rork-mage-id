# Verified deploy plan — 2026-09-02

> ## STATUS: the security half is APPLIED (2026-09-02)
>
> Applied via the Supabase MCP `apply_migration` and verified by introspection
> immediately after each:
>
> | Applied | Verified by |
> |---|---|
> | `grant_rfp_post_credit` locked | `has_function_privilege(anon)` = **false**, `service_role` = true, guard present, still `returns boolean` |
> | Two RLS write leaks closed | policies whose `qual` has `auth.uid()` but `with_check` does not = **0** |
> | Three ownership-freeze triggers | present = **3** |
> | `project_collaborators` FKs -> CASCADE | blocking (`NO ACTION`) FKs to `auth.users` = **0** |
> | Four public-directory FKs -> CASCADE | `SET NULL` FKs remaining = **1** (`crew_members`, deliberate) |
> | `change_order_approvals` UPDATE policy + evidence freeze | 1 policy, 1 trigger |
> | `subscriptions_tier_check` widened | now includes `'enterprise'` |
>
> **The feature batch is now APPLIED TOO (2026-09-03).** Verified present:
> `project_financials` (5 rows backfilled), `deliveries`,
> `building_access_rules`, `access_reservations`, `portal_get_snapshot_v2`,
> `can_view_project_financials`, and all six indexes plus
> `delivery_receipts.delivery_id`. The delivery and building-access features
> were dead in production until now because their tables did not exist.
>
> **THREE THINGS DELIBERATELY HELD BACK:**
>
> 1. `20260826180000_portal_link_expiry_cron` — schedules a pg_cron job that
>    calls the `portal-link-expiry-notice` EDGE FUNCTION, which is not
>    deployed. Applying it now just creates recurring failing runs against a
>    missing endpoint. Apply AFTER that function ships.
> 2. `20260827120000_project_financials_drop_legacy` — phase 2. Still gated on
>    the OTA. Phase 1 is applied, so the money now lives in BOTH places and the
>    current app keeps working unchanged. The field-role leak stays open until
>    phase 2 runs.
> 3. The `alter table public.cost_seeds add column deleted_at` line from
>    `20260826150000`. cost_seeds is under a standing do-not-touch instruction,
>    so the migration was SPLIT and only its `delay_events` index applied.
>    Without the column, soft-delete of a cost seed does not persist
>    (hooks/useCostSeeds.ts expects it). Needs an explicit decision.
>
> **`supabase/schema.sql` was regenerated again on the evening of 2026-09-03**
> and all nine of its sections hash-match production, feature batch included
> (+4 tables, +9 columns, +6 CHECK, +8 FK, +10 indexes, +16 policies, +2
> functions). The first pass at that regeneration put `portal_get_snapshot_v2`
> in the wrong slot of section 7 — every function block matched production and
> the section still did not — so trust the per-section MD5 check described in
> the file's header, never a line count. Regenerate once more after phase 2.


Every claim here was checked against production (`nteoqhcswappxxjlpvap`) by
read-only introspection on 2026-09-02, not inferred from migration filenames.
The migration tracker is NOT reliable for this repo: its filename-matching
entries stop at `20260804225749`; the 09-02 and 09-03 direct applies sit under
MCP-generated versions (`20260902184034` … `20260903205215`) that match no file
in `supabase/migrations`, and objects from later migrations exist while objects
from earlier ones do not. Trust the object checks below, not the tracker.

---

## Post-apply check: the freeze triggers do not silently eat writes

The 09-02 apply added four BEFORE UPDATE triggers that PIN columns — they
discard a write rather than reject it. That is the same silent-success failure
mode this whole audit has been chasing, so every app write path was checked
against every pinned column BEFORE calling the deploy done:

| Trigger pins | What the app actually writes | Collision |
|---|---|---|
| `projects.user_id` | nothing — no update path targets it, and there is no ownership-transfer feature | none |
| `sub_submitted_invoices.sub_portal_id / project_id / commitment_id / amount` | `status`, `notes_from_gc`, `payment_method`, `payment_reference`, `paid_on` (hooks/useSubSubmittedInvoices.ts:130) | none |
| `portal_budget_proposals.project_id` | `status`, `responded_at` (hooks/usePortalBudgetProposals.ts:66) | none |
| `change_order_approvals` — 18 evidentiary columns | `synced_to_co_at` ONLY (hooks/usePortalApprovalReconciler.ts:61) | none |

The `projects` trigger only fires its pin when `auth.uid() IS DISTINCT FROM
old.user_id` — i.e. for a collaborator, never the owner — and service-role
writes have no JWT so they bypass it entirely. Ownership transfer and support
fixes therefore still work.

If you ever DO add an ownership-transfer feature, it must run as service_role
or that trigger will silently discard it.

---

## The one thing that will hurt you

**`20260827120000_project_financials_drop_legacy.sql` MUST NOT run in the bulk
push.** It drops `estimate`, `linked_estimate`, `estimate_versions` and
`target_budget` off `projects`. Its own header states the precondition: the OTA
carrying the `project_financials` read/write path has to be LIVE and verified
first.

`supabase db push` applies pending migrations in filename order, so it will run
this one in sequence with the rest — pulling the money columns out from under
every installed build, including TestFlight testers on the current binary.

Verified: `projects` still has all four columns in production, so phase 2 has
not run. Hold it back explicitly.

---

## Verified production state

Present:

| Object | Meaning |
|---|---|
| `can_access_project()` (2 overloads) | **CORRECTION 2026-09-03: NOT applied.** The overloads exist (the migration itself says the text one was created out of band), but live `project_collaborators_role_check` is still `owner\|editor\|viewer`, `can_access_project` has no `field` branch, and deployed `project-invite` v1 rejects `field`. Six 09-03 policies that pass `'field'` fall through to "any collaborator". Audit DB-F2. |
| `delivery_receipts` table | exists, but see below |
| `change_order_approvals`, `sub_portal_links`, `portal_budget_proposals`, `public_bids`, `companies`, `worker_profiles`, `job_listings`, `rfp_post_payments`, `rfp_post_credits`, `project_collaborators` | all preconditions for the four new migrations |

Absent — these migrations have NOT applied:

| Missing object | Migration |
|---|---|
| `project_financials` table | `20260826140000_project_financials_split` |
| `deliveries` table | `20260826200000_deliveries` |
| `building_access_rules` table | `20260827130000_building_access` |
| `portal_get_snapshot_v2()` | `20260826190000_portal_get_snapshot_expiry_aware` |
| `sub_submitted_invoices_paid_on_idx` | `20260826120000_ap_payment_reconciliation` |
| `delay_events_open_notice_idx` | `20260826150000_history_audit_reconciliation` |
| `rfis_assigned_sub_id_idx` | `20260826160000_rfi_sub_attribution` |
| `portal_snapshots_expires_at_idx` | `20260826170000_portal_link_expiry` |
| `delivery_receipts_delivery_idx` + `delivery_receipts.delivery_id` | `20260828120000_delivery_receipt_link` |

Live defects still in production — UPDATED 2026-09-02 after the security apply:

- ~~`subscriptions_tier_check` rejects 'enterprise'~~ **CLOSED** — now accepts it.
- `notification_outbox_recipient_kind_check` is `['gc','client','sub']` while
  the app writes `'user'`. **STILL OPEN** — no migration exists for this one; it
  needs either the constraint widened or the app corrected, and which is right
  is a modelling question nobody has answered.
- ~~`grant_rfp_post_credit` executable by `anon`~~ **CLOSED** — anon and
  authenticated revoked, service_role only, plus an in-body caller check.
- ~~Two RLS UPDATE policies with no ownership in `WITH CHECK`~~ **CLOSED** —
  both rewritten; a scan for that shape now returns zero.
- ~~`project_collaborators` FKs are `NO ACTION`~~ **CLOSED** — both CASCADE;
  blocking FKs to `auth.users` now zero.

The table above under "Absent" is still accurate: the feature-enabling batch
(project_financials, deliveries, building_access_rules, portal_get_snapshot_v2,
five indexes) has NOT been applied.

An oddity worth knowing: `delivery_receipts` exists while `deliveries` does not.
The receipts table was created by some path other than these migrations.
`20260828120000` only does `add column if not exists` + `create index if not
exists`, so it is safe — but it must run AFTER `20260826200000_deliveries`,
which filename order already guarantees.

---

## Order

Everything below is idempotent (`if not exists` / `drop … if exists` +
recreate), so a partial re-run is safe. The one exception is step 6, which is
gated on human verification.

### 1. Reconcile the tracker

```
bash REPAIR-HISTORY.sh
```

Without this, `db push` wants to replay the entire schema — including
`cost_seeds` (off-limits) and `rls_baseline`, which drops and recreates every
policy.

### 2. Apply the pending set, EXCLUDING phase 2

```
mv supabase/migrations/20260827120000_project_financials_drop_legacy.sql /tmp/
mv supabase/migrations/20260826180000_portal_link_expiry_cron.sql /tmp/
supabase db push --project-ref nteoqhcswappxxjlpvap
mv /tmp/20260827120000_project_financials_drop_legacy.sql supabase/migrations/
mv /tmp/20260826180000_portal_link_expiry_cron.sql supabase/migrations/
```

**Correction 2026-09-03 (audit OPS-F9 / HEALTH-F1):** move BOTH held-back files
out, not only phase 2 — the tracker has none of the 17 local migrations ≥
`20260826120000` (the 09-02/09-03 applies were registered under MCP-generated
versions), so `db push` replays every one of them, including the expiry cron
against an undeployed function and the `cost_seeds.deleted_at` line inside
`20260826150000`. Either `supabase migration repair --status applied` the 15
already-applied versions first, or apply the remaining SQL through the MCP as
the 09-02/09-03 batches were. Do not paste `DEPLOY-NOW.sql` — it schedules the
cron and adds the column too.

Moving it out is cruder than a flag and is deliberately hard to do by accident.

### 3. Verify the security fixes actually landed

```sql
-- expect FALSE
select has_function_privilege('anon',
  'public.grant_rfp_post_credit(uuid,text,integer)', 'EXECUTE');

-- expect both to contain auth.uid()
select tablename, policyname, with_check from pg_policies
where schemaname='public'
  and policyname in ('gc updates sub invoices for own portals',
                     'gc can update own proposals');

-- expect 0 rows
select conname from pg_constraint
where confrelid='auth.users'::regclass and contype='f' and confdeltype='a';

-- expect 'enterprise' present
select pg_get_constraintdef(oid) from pg_constraint
where conname='subscriptions_tier_check';
```

Then `bun run test:rls-write-leaks` should stop printing its deploy-pending
note, and `bun run test:account-deletion` should still be green.

### 4. Edge functions

```
# cron / webhook / portal targets: NO user JWT on the wire → --no-verify-jwt
supabase functions deploy invoice-dunning homeowner-weekly-digest morning-digest \
  qbo-reconciler --no-verify-jwt --project-ref nteoqhcswappxxjlpvap

# called by the app with a user JWT → default (verify_jwt true)
supabase functions deploy delete-account --project-ref nteoqhcswappxxjlpvap
```

**Correction 2026-09-03 (audit EDGE-F1/F2, OPS-F1/F3):** `morning-digest`,
`invoice-dunning` and `qbo-reconciler` are deployed `verify_jwt: true` today and
have been rejected at the gateway (401 `UNAUTHORIZED_NO_AUTH_HEADER`) on every
cron fire since 07-26 / 08-03 — dunning has never sent a notice. The flag is
per deploy command and resets to `true` when omitted; there is no
`supabase/config.toml` to pin it. Commit one (Wave 0 in the audit) so this
cannot recur.

Urgency order: `invoice-dunning` emails clients a FINAL NOTICE demanding
retention their contract entitles them to hold, on every run.
`homeowner-weekly-digest` reports zero photos and zero change orders weekly.
`delete-account` is the Apple 5.1.1(v) path.

Then the rest, none of which are urgent:

```
# no user JWT on the wire → --no-verify-jwt
supabase functions deploy notify seal-document stripe-webhook mcp \
  portal-link-expiry-notice --no-verify-jwt --project-ref nteoqhcswappxxjlpvap

# called with a user JWT → default
supabase functions deploy construction-answer qbo-sync project-invite \
  import-schedule award-rfp --project-ref nteoqhcswappxxjlpvap
```

(As previously written — one command, no flag — this step would have switched
JWT verification ON for the Stripe webhook, `notify`, `mcp` and `seal-document`
and silently stopped payment reconciliation. Corrected 2026-09-03.)

`award-rfp` was added to that list on 2026-09-03 after downloading every
deployed function whose repo commit postdates its deployment and diffing it
against the repo: eleven were byte-identical (deployed before the commit was
cut), `award-rfp` was not — the deployed copy still identifies the caller by
decoding the JWT payload, while the repo has verified it through GoTrue since
PR #63 (2026-07-09). The platform gateway does verify the JWT for it
(`verify_jwt: true`), so this is defence in depth, not an open hole.

`qbo-connect-start`, `qbo-connect-callback` and `qbo-connect-status` also
bundle the `_shared/qbo.ts` that changed on 2026-08-29. The fix itself only
runs on the token-refresh paths, which live in `qbo-sync` and
`qbo-reconciler`, so they are optional — include them if you want every bundle
carrying the same helper.

### 5. OTA

```
eas update --branch production --message "audit sweep: money correctness, tenant isolation, schedule perf, App Store blockers"
```

No new native dependencies in any of this session's work, so the reanimated
runtime trap that silently rolled back build #12 is not in play. `expo export
--platform ios` was verified exit 0 at 21.4 MB.

**Correction 2026-09-03 (audit APPSTORE-F2):** the trap IS re-armed. The fix
removed `react-native-reanimated` from `package.json` only; `bun.lock` and
`node_modules` still carry 4.1.7 and a fresh `expo export` bundles "Native part
of Reanimated" (21.4 MB is the contaminated size; the clean bundle was 20.1 MB).
Only gesture-handler's guarded require prevents a boot crash today. Purge the
lockfile entry and `node_modules`, re-export and assert the string is absent,
before any OTA.

**Also (audit APPSTORE-F1):** an OTA is not enough for App Review. Builds #11–#14
all predate `bd6721e4` (the 09-02 blocker fixes), and a fresh install runs the
embedded bundle on first launch. Build **#15 from HEAD** and submit that.

### 6. ONLY THEN: phase 2

Preconditions, all three:

1. step 2 applied `20260826140000_project_financials_split`
2. the step 5 OTA is live on your device
3. you have opened a project and CONFIRMED estimates and budgets still render

```
supabase db push --project-ref nteoqhcswappxxjlpvap   # picks up phase 2 alone
```

Until this runs, the field-role financial leak is still open: a field
collaborator can read `estimate` / `linked_estimate` / `estimate_versions` /
`target_budget` straight off the `projects` row, because `projects_select` has
to let them see the row at all for `projects.schedule`.

### 7. Regenerate the schema snapshot

Done for the 2026-09-03 database state (see the status block at the top);
redo it after phase 2 runs.

`supabase/schema.sql` is a reference artifact that the audit tooling reads —
`validate-rls-write-leaks` and `validate-account-deletion` both parse it. After
the deploy it is stale by exactly the amount you just changed. Regenerate it so
the guards stop reporting deploy-pending and start reporting truth.

---

## What no amount of this can cover

None of this session's work has run on a physical iPhone. Everything was
verified by static analysis, jsdom mounts and production introspection. The
repo's own note applies: green guards are not executed code.

Worth exercising by hand on device, because each is somewhere a bug was just
fixed and the fix is unproven in a real runtime:

- Delete an account that was INVITED to someone else's project (the 5.1.1(v)
  path, and the one that used to destroy data then fail).
- Import a 1,000-row MS Project file and scroll the schedule list and Gantt.
- Go offline, create a change order, approve it, come back online, and confirm
  the approval survived on a second device.
- Open the schedule in a negative UTC offset and check that the first task's
  date matches between the list, the Gantt and the task detail sheet.
- Post an RFP as a homeowner and confirm no paywall appears.
