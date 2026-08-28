-- ============================================================================
-- delivery_receipts.delivery_id — join the promise to the witness statement.
--
-- WHY. public.delivery_receipts has existed since the rls_baseline migration and
-- NO CODE HAS EVER TOUCHED IT. Every reference to it in this repo was a comment
-- describing a capability that was never built — including comments written
-- while building public.deliveries, which asserted the receipt side was live
-- because the table was there. A schema is not a feature.
--
-- Receiving is now built (app/deliveries.tsx ReceiveSheet), and it needs the one
-- column that lets a receipt point back at the delivery it closes out.
--
-- ── WHY NULLABLE, AND WHY NO FOREIGN KEY ────────────────────────────────────
-- Material turns up that nobody scheduled. A receipt with no delivery_id is a
-- perfectly good witness statement — it records that a load landed, who signed,
-- and whether anything was broken — and refusing to store it would push the
-- super back to a photo in their camera roll.
--
-- No FK, matching deliveries.commitment_id and deliveries.receipt_id: deleting a
-- delivery must not cascade away the evidence that something arrived, least of
-- all when that evidence is the basis of a damage claim. A dangling id simply
-- fails to join, which is the correct degradation.
--
-- Idempotent.
-- ============================================================================

alter table public.delivery_receipts
  add column if not exists delivery_id uuid;

-- "Which receipt closed this delivery" — the per-delivery lookup. Partial:
-- unscheduled material is common and those rows never participate in the join.
create index if not exists delivery_receipts_delivery_idx
  on public.delivery_receipts (delivery_id)
  where delivery_id is not null;

comment on column public.delivery_receipts.delivery_id is
  'The public.deliveries row this receipt closes out. NULL for material that arrived unscheduled. No FK on purpose — deleting a delivery must not destroy the record that something was received, or the damage evidence attached to it.';
