# Five orphaned production tables — investigation

_2026-08-15. Read-only investigation. No table was dropped; that needs the founder._

## THE HEADLINE FINDING (not the per-table verdicts)

**The schema of five production tables is undocumented in version control.**

`supabase/migrations/20260518120000_rls_baseline.sql` was generated from
`pg_policies` — a point-in-time snapshot. It proves the tables existed on
2026-05-18 and it writes their RLS. **It does not define their columns.**

| Table | CREATE TABLE on main | On the abandoned branch |
|---|---|---|
| `draw_periods` | ❌ | ✅ `create_draw_periods_and_sub_change_requests.sql` |
| `owner_supplied_items` | ❌ | ✅ `create_owner_supplied_items.sql` |
| `delivery_receipts` | ❌ | ✅ `create_delivery_receipts.sql` |
| `contractor_licenses` | ❌ | ❌ **nowhere** |
| `permit_templates` | ❌ | ❌ **nowhere** |

**If the production database were lost, or a new environment provisioned from
migrations, none of these five could be reconstructed.** Two of them cannot be
reconstructed from any source in git at all — they would have to be introspected
from the live database before it disappeared.

This is a disaster-recovery hole, and it is independent of every product
decision below. **Fix it regardless of what you decide to build or drop.**

## Per-table verdicts

| Table | Verdict | Why |
|---|---|---|
| `owner_supplied_items` | **BUILD** | Strongest. OFCI/OFOI — the homeowner buys the Sub-Zero, the GC schedules around it. Universal in residential. **Main already has `owner_supplied_item` as a valid `DelayCause`** — so the delay system can blame an OFCI item while having nowhere to record one. That inconsistency will be noticed. Branch: 886-line screen + 238-line hook, complete. |
| `delivery_receipts` | **BUILD** | Damage documentation + PO reconciliation. Replaces the `materialsDelivered: string[]` blob on the daily report — adequate for "20 sheets arrived", useless for "14 of 20 damaged, see BOL photo", which is what gets a supplier credit. `commitment_id` ties it into procurement. Largest branch implementation (1,071 lines), complete. |
| `draw_periods` | **BUILD** (narrower) | Lender-draw grouping: ties the AIA G702, sub invoices and lien waivers under "Draw #3". MAGE already ships all three pieces with no grouping layer. Only matters for loan-financed builds — but those are common in spec-build and larger renovations. Branch: 900-line screen + 247-line hook, complete. |
| `contractor_licenses` | **KEEP** | Two concepts share one table: (A) MAGE's own verified-pro record, which `app/get-verified.tsx` on main references by name — a real business dependency; (B) a GC-facing license-expiry calendar, branch-only. **Do not drop.** See the bid-qualification note below — this table just became more important, not less. |
| `permit_templates` | **DROP** | The branch's own comment concedes the prefill step is deferred: *"left as a v1.1 wire — for now we just display the templates and let the user copy fields manually."* A template library with no apply button is a notes file. Schema undocumented anywhere. Weakest of the five. |

## Cross-reference: this changes with bid qualification

`contractor_licenses` was assessed as an operational table, not a product
feature. **The bid-qualification idea makes it load-bearing** — license class and
status is the first hard blocker in "can I bid this?"
(see `2026-08-15-bid-qualification-brief.md`). Re-read this verdict when that
work is scoped; the recommendation may move from KEEP-DORMANT to BUILD.

## Recommended order

1. **Port the three CREATE TABLE migrations from the branch to main**, and
   **introspect + write migrations for `contractor_licenses` and
   `permit_templates` BEFORE dropping anything.** Even a table being dropped
   should have its schema recorded first — you cannot review a drop you cannot
   read. Safe, touches no production data.
2. Decide on `permit_templates` (drop SQL below).
3. Port `owner_supplied_items` and `delivery_receipts` — best value, and the
   branch code is complete rather than scaffolded. Expect a UI porting pass:
   the branch is ~3 months stale (last touched 2026-05-12) and diverged
   mid-dark-mode-migration, so design tokens will have drifted. Functional
   logic should survive.
4. `draw_periods` when the loan-financed segment is a priority.

## Drop SQL — for a human to run, after the schema is recorded

```sql
-- permit_templates: no rows, no app code, no CREATE TABLE anywhere.
drop policy if exists permit_templates_delete_own on public.permit_templates;
drop policy if exists permit_templates_insert_own on public.permit_templates;
drop policy if exists permit_templates_select_own on public.permit_templates;
drop policy if exists permit_templates_update_own on public.permit_templates;
drop table if exists public.permit_templates;
```

**Do NOT drop `contractor_licenses`** — `app/get-verified.tsx` on main depends
on it.

Pre-launch with zero users is the cheapest this decision will ever be.
