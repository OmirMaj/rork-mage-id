# Founder decisions on the four deferred audit items

_2026-08-19. These were routed away from the fix agents because they are product
calls, not defects. Decided by the founder; recorded here so they are executed
as specified rather than re-litigated._

## 1. Brand orange fails contrast (2.87:1 both directions)

**Measured:** white-on-`#FF6A1A` and orange-on-white both land at **2.87:1**.
AA requires 4.5:1 for body text, 3:1 for large text and UI components. Affects
"Next", "Mark paid", "Net 30", "Create your first project", and the budget KPI.

**Decision: keep the brand, fix the contrast — "something similar".**

Do NOT change the brand hue. Derive an accessible companion:

- Keep `#FF6A1A` as the *fill* for large surfaces and non-text chrome, where 3:1
  applies and it may already pass at size.
- Add a **darker on-light variant** (roughly `#C2410C`-ish territory — compute it,
  don't guess) for orange TEXT on light backgrounds and for anything at caption
  size. It must read as the same brand colour, just deeper.
- For white text ON orange, darken the fill until white clears 4.5:1 rather than
  greying the text.
- Ship as tokens (`accent`, `accentText`, `accentFill` or similar following the
  existing `*Label` / `*Soft` convention) so the choice is made once.

**Measure and state the resulting ratios.** "Looks fine" is not the bar; the
current colour also looks fine.

## 2. Catalog prices — green-on-white at 2.22:1, 11px

**Decision: make them readable. Money is the least readable text on the
estimator today, which is indefensible for an estimating product.**

Free to change colour, weight and size. Prices should be among the MOST legible
elements on the row, not the least. If green is carrying meaning (savings vs
list), keep the meaning and fix the value — a darker green, or drop the colour
and carry the meaning some other way.

## 3. "Clear All Data" clears 10 keys; the app writes ~125

**Decision: make it easier for everyone — widen it, and make the copy true.**

`app/(tabs)/settings/index.tsx:348` hardcodes 10 keys. The tenant-wipe path was
already fixed to sweep by prefix (`utils/localCacheKeys.ts`,
`selectTenantKeysToWipe`) — reuse that rather than writing a second list, which
is how this drifted in the first place.

Two requirements:
- **The confirmation copy must state what actually gets deleted.** It currently
  defines a narrower scope than the button will now perform; leaving it would be
  worse than the bug.
- **Respect the same survivors** the tenant wipe respects (`mageid_theme`, the
  rotating analytics id) unless there is a stated reason not to — a user asking
  to clear data is not asking to reset their theme.

## 4. COI vault triple-counts uninsured subs

**Observed:** 16 rows, **6 unique subs** (Meridian ×3, Bayview ×3, Ironline ×3,
Summit ×3, Lone Star Steel ×2, Lone Star Mechanical ×2), rendered identically
with no project differentiator. Header claims "16 subs tracked / 6 no COI" when
only **2 companies** actually lack one. Overstates uninsured risk 3×.

**Decision: make it easier for everyone — group by subcontractor.**

One row per company. If a sub appears on several projects, that is detail inside
the row, not three identical rows. The header must count **companies**, not
rows, so "no COI on file" means what a reader assumes it means.

**Determine first whether a COI is per-sub or per-sub-per-project** — the answer
changes the fix. If a sub genuinely carries different certificates per project,
the row groups by company and expands to per-project certificates. If a COI is
company-level, the duplication is a query/join defect and should be fixed at the
source rather than de-duplicated at render.

## Sequencing

All four touch files owned by the in-flight `claude/fix-*` workflow buckets
(`constants/colors.ts`, estimate screens, `coi-vault.tsx`, settings). **Execute
these only after those branches are merged**, or two agents will edit the same
files and one will be silently overwritten — which already happened once this
week.
