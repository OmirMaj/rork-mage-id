-- ============================================================================
-- profiles.deposit_pct / progress_pct / final_pct / warranty_months — the
-- GC's OWN payment terms and workmanship warranty, asked once.
--
-- WHY. Every client-facing document MAGE printed carried a payment schedule
-- nobody chose: the quick-estimate PDF and the wizard preview said 25 / 65 / 10,
-- the Review share link and the portal proposal said a 10% deposit, and a new
-- contract seeded 25 / 25 / 25 / 25 with a one-year warranty paragraph. A
-- homeowner could be shown three different deposits for the same job. The
-- product now asks the first time a document is about to print a term
-- ("Ask when it matters"), saves the answer here, and every generator reads it
-- through utils/paymentTerms.ts. No setup form, no default.
--
-- ── NULL MEANS "NEVER ASKED", SO NO DEFAULTS ────────────────────────────────
-- All four columns are nullable with no DEFAULT. A default would be the
-- product answering the question on the GC's behalf, which is the bug this
-- replaces.
--
-- ── WHY THE CHECK SPELLS OUT `is not null` ON ALL THREE ────────────────────
-- A CHECK constraint PASSES when it evaluates to NULL, and `null between 0 and
-- 100` is NULL. Written without the explicit conjuncts, a row holding only
-- deposit_pct = 25 would be accepted — a half-answered split the resolver
-- would then have to guess the rest of. All three are set together or none.
--
-- ── ORDER: APPLY BEFORE THE WEB MERGE AND THE OTA ───────────────────────────
-- The terms travel in their OWN profiles update (ProjectContext.savePaymentTerms
-- sends `id` plus these columns only — the whole-row settings save never
-- carries them). That keeps them out of an ONLINE settings save, which goes
-- straight to the network. It does NOT isolate them once anything is QUEUED:
-- the offline queue groups writes by `${table}:${id}` (utils/offlineQueue.ts),
-- so every profiles write for a user shares one group, `profiles:<userId>`.
-- On a server without these columns the terms write fails PGRST204
-- (transient) and re-queues, and EVERY profiles write queued after it —
-- branding, tax rate, licence, digest settings changed offline — waits behind
-- it, unsent, until the columns exist. The loader also cannot vouch for the
-- answer, so a second device would ask again. The wrong order is not
-- harmless: apply, verify, then ship the client.
--
-- ── A CHECK VIOLATION IS TERMINAL IN THE OFFLINE QUEUE ──────────────────────
-- utils/paymentTerms.ts (PAYMENT_SPLIT_BOUNDS, WARRANTY_MONTHS_BOUNDS,
-- validatePaymentSplit, termsColumnsForWrite) mirrors these CHECKs exactly and
-- scripts/validate-payment-terms.ts pins the parity. A violation on an online
-- write drops only the terms. On a QUEUED terms write it is worse: a terminal
-- failure drops the rest of its group as orphaned, so the profiles writes
-- queued behind it (branding, tax, licence, digest) are dropped with it.
--
-- ── THE projects TRIGGER ────────────────────────────────────────────────────
-- A client portal's proposal prints a per-portal stamp
-- (client_portal.proposalPaymentTerms) — the terms that homeowner was shown.
-- The projects row is written whole-blob by every device, so an old build or a
-- device that loaded before the stamp would erase it on its next save. The
-- trigger keeps the stored stamp when an incoming client_portal object omits
-- the key. It does not stop a device from sending a DIFFERENT stamp (last write
-- wins, like every other project field); accepted proposals are pinned server
-- side by the held acceptance migration.
-- Trigger order is alphabetical: projects_keep_proposal_payment_terms fires
-- before trg_portal_access_token, and the two touch different keys.
--
-- RLS. None added or changed: profiles already restricts SELECT / INSERT /
-- UPDATE to auth.uid() = id, and new columns inherit the row policies.
--
-- Idempotent throughout.
-- ============================================================================

alter table public.profiles
  add column if not exists deposit_pct     smallint,
  add column if not exists progress_pct    smallint,
  add column if not exists final_pct       smallint,
  add column if not exists warranty_months smallint;

alter table public.profiles drop constraint if exists profiles_payment_split_check;
alter table public.profiles add constraint profiles_payment_split_check check (
  (deposit_pct is null and progress_pct is null and final_pct is null)
  or (deposit_pct is not null and progress_pct is not null and final_pct is not null
      and deposit_pct between 0 and 100
      and progress_pct between 0 and 100
      and final_pct between 0 and 100
      and deposit_pct + progress_pct + final_pct = 100)
);

alter table public.profiles drop constraint if exists profiles_warranty_months_check;
alter table public.profiles add constraint profiles_warranty_months_check
  check (warranty_months is null or warranty_months between 1 and 120);

-- A stale client_portal blob (an old build, or a device that loaded before the
-- stamp) must not erase a portal's frozen terms.
create or replace function public.projects_keep_proposal_payment_terms() returns trigger
  language plpgsql
  set search_path to 'pg_catalog', 'public'
as $fn$
begin
  if new.client_portal is not null and jsonb_typeof(new.client_portal) = 'object'
     and not (new.client_portal ? 'proposalPaymentTerms')
     and jsonb_typeof(old.client_portal -> 'proposalPaymentTerms') = 'object' then
    new.client_portal := new.client_portal
      || jsonb_build_object('proposalPaymentTerms', old.client_portal -> 'proposalPaymentTerms');
  end if;
  return new;
end $fn$;

-- A trigger function is invoked by the trigger machinery, never called; nobody
-- needs EXECUTE on it directly.
revoke execute on function public.projects_keep_proposal_payment_terms() from public, anon, authenticated;

drop trigger if exists projects_keep_proposal_payment_terms on public.projects;
create trigger projects_keep_proposal_payment_terms before update on public.projects
  for each row execute function public.projects_keep_proposal_payment_terms();

comment on column public.profiles.deposit_pct is
  'Whole percent due on signing. NULL = never asked; asked the first time a client document prints it. Set with progress_pct and final_pct (sum 100). utils/paymentTerms.ts.';
comment on column public.profiles.progress_pct is
  'Whole percent billed as work is completed. NULL = never asked; asked the first time a client document prints it. utils/paymentTerms.ts.';
comment on column public.profiles.final_pct is
  'Whole percent due at substantial completion. NULL = never asked; asked the first time a client document prints it. utils/paymentTerms.ts.';
comment on column public.profiles.warranty_months is
  'Workmanship warranty in months (1..120). NULL = never asked; asked the first time a contract prints it. utils/paymentTerms.ts.';

-- Reload PostgREST's schema cache so the columns are writable immediately.
notify pgrst, 'reload schema';
