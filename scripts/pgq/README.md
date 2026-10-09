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
```

Add `NO_MUTATIONS=1` to run the checks only (a few seconds instead of about a
minute). Each mutation opens its own database, one after another, so memory
stays at one PGlite instance.

## The proofs

| Script | Migration | What it shows |
| --- | --- | --- |
| `proof-packs.proof.mjs` | `supabase/migrations/20261009120000_proof_packs.sql` | anon reads and writes nothing; a signed-in account cannot insert, update or delete directly; the create function sets the time and the check code on the server; the same fingerprint twice returns the same row; another account reads nothing; the cap refuses the 401st row of a project and the 5,001st of an account, and never a repeat; the file fingerprint attaches once; the self-check refuses a loosened file. |
| `signature-provenance.proof.mjs` | `supabase/migrations/20261010090000_signature_provenance.sql` | the portal functions mark `portal_function`; the app's own insert is marked `contractor_account` even when it sends `recorded_via = 'portal_function'` and a back-dated `created_at`; `recorded_via` cannot be changed by UPDATE; the signing page marks `signing_page`; a contractor writing the signature columns is marked `contractor_account` and cannot write `signing_page`; rows from before the file stay NULL; every existing flow still saves; anon cannot write either table directly. |

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
