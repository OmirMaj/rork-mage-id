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
> **STILL NOT APPLIED, and steps 1-2 below still stand for them:** the
> 2026-08-26/28 batch that creates `project_financials`, `deliveries`,
> `building_access_rules`, `portal_get_snapshot_v2` and five indexes. Those are
> feature-enabling, not security. Step 6 (phase 2) remains gated as written.
>
> **`supabase/schema.sql` IS NOW STALE** in a new way: production moved and the
> file did not. `validate-rls-write-leaks` parses it, so it will keep printing
> its deploy-pending note about two leaks that are now closed. Regenerate it
> (step 7) before trusting that guard again.


Every claim here was checked against production (`nteoqhcswappxxjlpvap`) by
read-only introspection on 2026-09-02, not inferred from migration filenames.
The migration tracker is NOT reliable for this repo: its last entry is
`20260804225749`, yet objects from later migrations exist and objects from
earlier ones do not. Trust the object checks below, not the tracker.

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
| `can_access_project()` (2 overloads) | `20260826130000_field_role` IS applied |
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
supabase db push --project-ref nteoqhcswappxxjlpvap
mv /tmp/20260827120000_project_financials_drop_legacy.sql supabase/migrations/
```

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
supabase functions deploy invoice-dunning homeowner-weekly-digest delete-account \
  --project-ref nteoqhcswappxxjlpvap
```

Urgency order: `invoice-dunning` emails clients a FINAL NOTICE demanding
retention their contract entitles them to hold, on every run.
`homeowner-weekly-digest` reports zero photos and zero change orders weekly.
`delete-account` is the Apple 5.1.1(v) path.

Then the rest, none of which are urgent:

```
supabase functions deploy construction-answer mcp qbo-sync qbo-reconciler \
  project-invite portal-link-expiry-notice notify seal-document \
  stripe-webhook import-schedule --project-ref nteoqhcswappxxjlpvap
```

### 5. OTA

```
eas update --branch production --message "audit sweep: money correctness, tenant isolation, schedule perf, App Store blockers"
```

No new native dependencies in any of this session's work, so the reanimated
runtime trap that silently rolled back build #12 is not in play. `expo export
--platform ios` was verified exit 0 at 21.4 MB.

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
