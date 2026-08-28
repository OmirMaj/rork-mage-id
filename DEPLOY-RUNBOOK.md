# Deploy runbook — 2026-08-27

Everything built on 2026-08-26/27 is inert until this runs. ~25 minutes.

Each step has a **verify** gate. Don't move on until it passes — the point of the
gates is that four of this session's bugs were invisible to every static check
and only execution would have caught them.

---

## Pre-flight (already verified, no action)

- `tsc` 0 errors · 31/31 guards pass · lint 0 errors
- **No dependency changes.** Build #12 crashed because a native module
  (reanimated, via gesture-handler) reached a binary without it. Nothing this
  session touches native code, so that failure cannot repeat.
- `DEPLOY-NOW.sql` = 10 migrations, regenerated after the `window` fix.
- `runtimeVersion.policy` is `appVersion` (1.0.0) — this OTA reaches **every**
  1.0.0 build you have installed anywhere, not just the newest.

**Order note:** migrations and the OTA can go in either order. `supabaseWrite`
classifies a missing table (PGRST205) as *transient* and re-queues rather than
discarding, so an app that gets the OTA first parks its writes and self-heals.
The one hard constraint is at the very end: the phase-2 drop must come **after**
the OTA.

---

## 1 · Repair migration history

```bash
bash REPAIR-HISTORY.sh
```

Marks 60 already-applied migrations as applied so `db push` doesn't try to
replay the whole schema. It deliberately excludes `cost_seeds` and
`rls_baseline` — do not add them.

**Verify:** the script prints no errors and exits 0.

---

## 2 · Apply the 10 migrations

Paste `DEPLOY-NOW.sql` into the Supabase SQL editor and run it.

**Verify** — paste this and expect every row `true`:

```sql
select
  to_regclass('public.deliveries')            is not null as deliveries,
  to_regclass('public.building_access_rules') is not null as building_rules,
  to_regclass('public.access_reservations')   is not null as reservations,
  to_regclass('public.project_financials')    is not null as financials,
  exists(select 1 from information_schema.columns
         where table_name='cost_seeds' and column_name='deleted_at')      as cost_seed_fix,
  exists(select 1 from information_schema.columns
         where table_name='rfis' and column_name='ball_in_court')         as rfi_custody,
  exists(select 1 from information_schema.columns
         where table_name='deliveries' and column_name='delivery_window') as window_renamed;
```

`window_renamed` is the one that would have failed the *old* bundle — `window`
is a reserved Postgres keyword and the migration would have died mid-file,
after the first eight had already committed.

---

## 3 · Deploy the edge functions

```bash
supabase functions deploy construction-answer mcp qbo-sync qbo-reconciler project-invite portal-link-expiry-notice
```

`qbo-sync` and `qbo-reconciler` are in the list because `_shared/qbo-mapping/*`
changed under them.

**Verify** the portal-expiry function specifically — it is the one whose bug
was pure silence. It wrote `recipient_kind: "user"`; the table's CHECK only
accepts `('gc','client','sub')`, so every insert was rejected and the error
swallowed. It would have run twice daily forever, returned `success: true`,
and notified nobody.

```sql
-- After the cron has fired once (or trigger it manually), expect 0 rows.
-- Any row here means the fix did not take.
select id, event_type, recipient_kind, created_at
from public.notification_outbox
where recipient_kind not in ('gc','client','sub');
```

---

## 4 · Push the OTA

```bash
eas update --branch production --message "deliveries, building access, brief wiring, as-built capture"
```

**Verify on device:** force-quit and relaunch **twice**. A crash-on-launch OTA
silently rolls back, which is exactly how build #12's failure hid — the app
looked fine because it had quietly reverted.

---

## 5 · On-device checks

Order matters: the first one proves persistence, which nothing static could.

1. **Deliveries survive a restart.** Add a delivery → force-quit → reopen. It
   must still be there. It was previously write-only: saved to disk, never read
   back, gone on every restart.
2. **Late delivery reaches Waiting On** and routes to `/deliveries`.
3. **Building access** — set "freight elevator required", add a confirmed
   delivery a few days out with no reservation. Expect a blocking conflict on
   the delivery row *and* a line in tomorrow's brief.
4. **"Fix overloads"** on an AI-generated schedule. It was a guaranteed no-op
   (every task carried a unique fake crew, so no leveling group ever had two
   members). It should now either level real conflicts or honestly report none.
5. **Punch photo GPS** — add a punch item with a located photo, force-quit,
   reopen. The location must persist. It was being written, never read back,
   then overwritten with `undefined` on the next save.
6. **Daily report → schedule.** File a DFR marking a task 100%. The task should
   go `done` with an actual end date **stamped to the report's date**, not
   today's.

---

## 6 · The one thing I cannot verify for you

**Invite a second account as `field`.** Confirm they can open the project, log
a punch item, and mark a delivery received — and that they see **no** financial
figures.

This unlocks collaboration, the field role, and per-seat pricing at once, and
it is the only item in this session that genuinely cannot be proven without a
real second account.

---

## 7 · Only after all of the above

```bash
# Phase 2 — drops the legacy financial columns from `projects`.
# MUST come after the OTA: older builds still read those columns.
```
Apply `supabase/migrations/20260827120000_project_financials_drop_legacy.sql`.

---

## Do NOT do yet

- **Don't publish the marketing "The Watch" section.** It describes deliveries,
  building access and portal expiry as live. Until step 4 lands they don't
  exist for anyone who signs up, and `validate-marketing-claims` exists because
  the site once shipped a number that wasn't true ("2,957 vetted subs"). One
  provably false claim poisons every true one.

## If something fails

- **A migration errors mid-file:** everything before it already committed.
  Fix the failing statement and re-run — every migration in the bundle is
  idempotent (`if not exists` / `drop policy if exists`).
- **The OTA crashes on launch:** it auto-rolls-back. Check the EAS update log,
  then `eas update --branch production --republish` the prior update.
- **A write seems to vanish:** check the offline queue. Missing table/column is
  classified transient and re-queued, so it self-heals once the migration lands.
