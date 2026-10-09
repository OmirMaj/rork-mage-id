# scripts/pgq: PGlite proofs for migrations

Each `*.mjs` here applies one migration file to an in-memory Postgres (PGlite),
twice, and runs numbered cases against it as `anon`, `authenticated` and
`service_role`. `--all` then re-runs the file once per planted mutation (the
migration text with one protection removed) and fails unless that mutation
turns its named cases red. A proof that cannot go red proves nothing.

PGlite is NOT a dependency of the app. Install it outside the repo and point
`PGLITE_DIR` at that folder:

```
mkdir -p ~/pgq && cd ~/pgq && npm i @electric-sql/pglite
cd <worktree>
PGLITE_DIR=~/pgq node scripts/pgq/legal-acceptances.mjs . --all
PGLITE_DIR=~/pgq node scripts/pgq/signed-record-tombstones.mjs . --all
PGLITE_DIR=~/pgq node scripts/pgq/rfp-attachments-private.mjs . --all
```

Without `--all` a proof runs once, as written, and prints every case.
`MUTATE=<n>` runs one planted mutation.

What PGlite cannot show: anything about production's real grants, owners or
Storage service. Each migration's header lists the VERIFY AFTER queries to run
against production once it is applied.

These are not part of `bun run ship-check` (they need PGlite). The text of each
migration is pinned by a validator that is (`scripts/validate-legal-acceptance.ts`).
