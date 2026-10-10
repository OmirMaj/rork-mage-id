# scripts/pgq: migration proofs on PGlite

Each script here runs one migration file, exactly as it is on disk, inside
PGlite (Postgres compiled to WebAssembly, in memory). Nothing touches a real
database and nothing is deployed.

Every proof does the same four things:

1. builds the minimum schema the migration needs (Supabase's roles, `auth.uid()`,
   the default privileges, and the real earlier objects cut out of the repo);
2. applies the migration twice, so it is shown to be re-runnable and its own
   self-check passes both times;
3. runs the checks, each one a real write or read as the role that would make it;
4. plants mutations: it removes one guard at a time from the migration text and
   checks that the checks it names go red. A proof that stays green when a guard
   is removed proves nothing, so a missed mutation fails the run.

The last line is the summary, for example
`signature-provenance: 34 checks passed, 24 of 24 planted mutations caught`.
The exit code is 0 only when every check passed and every mutation was caught.

## Install PGlite outside the repo (once)

PGlite is not a dependency of this repo and must not become one. Install it in
any folder outside the repo and point `PGLITE_DIR` at that folder:

```bash
mkdir -p ~/pgq-run && cd ~/pgq-run
echo '{"name":"pgq-run","private":true}' > package.json
bun add @electric-sql/pglite        # or: npm install @electric-sql/pglite
```

Run and seen green with `@electric-sql/pglite` 0.5.8 on Node 24.

## Run

From the repo root:

```bash
PGLITE_DIR=~/pgq-run node scripts/pgq/proof-packs.proof.mjs
PGLITE_DIR=~/pgq-run node scripts/pgq/signature-provenance.proof.mjs
PGLITE_DIR=~/pgq-run node scripts/pgq/legal-acceptances.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/signed-record-tombstones.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/rfp-attachments-private.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/bid-responses-closed-posting.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/living-models.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/legal-acceptance-scan-room-upload.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/deliveries-follow-schedule.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/aia-pay-app-send-lock.mjs . --all
PGLITE_DIR=~/pgq-run node scripts/pgq/aia-pay-app-delete-guard.mjs . --all
```

The last seven (lane PROTECT-SERVER, `living-models.mjs` and
`legal-acceptance-scan-room-upload.mjs` from lane LIVINGSYNC, and
`deliveries-follow-schedule.mjs` from lane DELIVERIES-1)
take the worktree as their first argument and share `_harness.mjs`, not `lib.mjs`. Without `--all` they run once, as
written, and print every case; `--all` also runs each planted mutation and ends
with `ALL PASS (as written green; N planted mutations red)`. `MUTATE=<n>` runs
one mutation. Seen green with `@electric-sql/pglite` 0.3.16 on Node.

Add `NO_MUTATIONS=1` to run the checks only (a few seconds instead of about a
minute). Each mutation opens its own database, one after another, so memory
stays at one PGlite instance.

## The proofs

| Script | Migration | What it shows |
| --- | --- | --- |
| `proof-packs.proof.mjs` | `supabase/migrations/20261009120000_proof_packs.sql` | anon reads and writes nothing; a signed-in account cannot insert, update or delete directly; the create function sets the time and the check code on the server; the same fingerprint twice returns the same row; another account reads nothing; the cap refuses the 401st row of a project and the 5,001st of an account, and never a repeat; the file fingerprint attaches once; the self-check refuses a loosened file. |
| `signature-provenance.proof.mjs` | `supabase/migrations/20261010090000_signature_provenance.sql` | the portal functions mark `portal_function`; the app's own insert is marked `contractor_account` even when it sends `recorded_via = 'portal_function'` and a back-dated `created_at`; `recorded_via` cannot be changed by UPDATE; the signing page marks `signing_page`; a contractor writing the signature columns is marked `contractor_account` and cannot write `signing_page`; rows from before the file stay NULL; every existing flow still saves; anon cannot write either table directly. |
| `legal-acceptances.mjs` | `supabase/migrations/20261010100000_legal_acceptances.sql` | a signed-in person records an acceptance for themselves only; the user id is `auth.uid()` and the time is the server's (a reported delay sits beside it and never moves it); a retry writes nothing twice; anon holds nothing; nobody (not the service role, not the table owner) can change or delete a row; deleting the account keeps every row with `user_id` NULL, the marker unchanged and `account_deleted_at` stamped. |
| `signed-record-tombstones.mjs` | `supabase/migrations/20261010110000_signed_record_tombstones.sql` | the service role writes one tombstone per signed record of the account and no client can read, write or call anything; no name, email, signature, amount or token is copied; a project or portal id that is not the account's is dropped; a retry adds nothing; a missing table costs that kind only; after the account is deleted the records are gone and the tombstones remain. |
| `rfp-attachments-private.mjs` | `supabase/migrations/20261010120000_rfp_attachments_private.sql` (the read rule and its policy, no gate) then `20261010140000_rfp_attachments_flip.sql` (the flip, behind the opt-in line) | part 1 applies with no opt-in and leaves the bucket public, and the rule already answers; part 2 refuses without its opt-in line, before part 1, and while a read policy names no bucket; after part 2 the bucket is private; anon reads nothing; the homeowner reads her own folder; any signed-in account reads an open posting's files; once a posting is closed only the awarded bidder does: a stranger who bid after the close, a declined bidder and a withdrawn bidder do not; a spoofed folder and an odd name open for nobody else; closing or deleting a posting ends access. |
| `bid-responses-closed-posting.mjs` | `supabase/migrations/20261010130000_bid_responses_closed_posting.sql` | a bid on an open posting lands as submitted; a bid on a closed or awarded posting is stored as withdrawn and nobody can make it live; the bid's date is the server's; a replay of a landed bid after the close still ends as a duplicate key; the homeowner's and the contractor's existing updates still work; the award path is not policed. |
| `living-models.mjs` | `supabase/migrations/20261011090000_living_models.sql` | the project owner saves a job model and an accepted editor saves it too (the row stays the owner's and names the editor as the author); a viewer and a field seat read it and cannot save; a stranger, an invited editor who has not accepted and a revoked one read nothing and cannot save; anon holds nothing; no signed-in account writes the table directly; a save based on an older revision, on "no row" when there is one, or on a revision from the future is refused with code `stale_revision` and writes nothing; the same save sent twice answers saved and writes nothing; a model over 3 MiB is refused by the function and by the table; the time and the author are the server's; an older build cannot write over a newer model; deleting the editor's account keeps the row; deleting the project deletes it. |
| `deliveries-follow-schedule.mjs` | `supabase/migrations/20261012090000_deliveries_follow_schedule.sql` | the seven columns are nullable and no needed-by or order-by column exists; a row from before the file is untouched; an older build's insert still lands; "No date yet" (a NULL supplier date) is saved; the buffer, the lead time, the task id and the date history are each held to their limits; a field seat still writes, a viewer still only reads, a stranger and anon still read nothing; the policies and the grants are text for text what they were; the file adds ONE trigger and ONE function (`deliveries_fs_keep_record`, SECURITY INVOKER, callable by nobody) that act only on a write naming `promised_date` or `date_history`; the promise is written once (moved only by an update whose history ends with a matching `promise_corrected` entry) and the history is never nulled or shrunk, while the rest of a stale write still lands; only the row's owner deletes. 22 planted mutations. |
| `aia-pay-app-send-lock.mjs` | `supabase/migrations/20261014090000_aia_pay_app_send_lock.sql` | a pay application written with the app's sent stamp is stamped by the server on the server's clock and frozen with no pay link; a client-sent stamp is thrown away and the stamp is set once; a certify sent twice is taken and a changed figure is refused; the app's own re-save ('' against NULL) and the architect's response still pass; a pay link can be added once later; a row with a pay link behaves as before; rows that already carried the stamp are stamped by the file; a frozen row cannot change job or id. Stated limit: DELETE is not guarded. |
| `aia-pay-app-delete-guard.mjs` | `supabase/migrations/20261014100000_aia_pay_app_delete_guard.sql` | the file refuses to apply before the send lock; a draft is deleted as before; an application frozen by the send, by a pay link or by both cannot be deleted by its owner, alone, in a delete-and-reinsert, or in a delete of every application on the job; deleting the job or the account still removes it; the service role still can; the refusal reads as final to the offline queue. |

## What is real and what is a stub

Real: the migration under test, and every earlier table, policy, trigger and
function the proof names in its header. They are read from `supabase/schema.sql`
and `supabase/migrations/` at run time, so a change to one of those files is
picked up, and a missing anchor stops the proof instead of passing it.

Stubs (each proof lists its own): the roles, `auth.uid()` reading
`request.jwt.claim.sub`, small versions of tables the real functions only read
(`projects`, `change_orders`, `profiles`, the portal credential tables), and
`fire_notify` writing to a log table instead of calling the edge function.

One substitution to know about: on Supabase, PostgREST switches the role and
sets the JWT claims for each request. Here the proof does `set role` and sets
the claim itself. Inside a SECURITY DEFINER function `current_user` becomes the
function's owner in PGlite exactly as in Postgres, which is what the triggers
of the signature provenance migration rely on.

## Adding a proof

Copy one of the two scripts. `lib.mjs` has the loader (`loadPGlite`,
`loadContrib`), the Supabase base (`SUPABASE_BASE`), the two ways to talk to the
database (`as(role, userId, sql)` and `root(sql)`), `swap` for planting a
mutation at exactly one anchor, and `judge`, which runs the battery on the file
as written and once per mutation and prints the summary line. Do not add
anything to `package.json`.
