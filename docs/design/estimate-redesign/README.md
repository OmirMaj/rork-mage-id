# Estimate Redesign — Approved Direction

Approved 2026-07-28. These HTML mockups are the **source of truth** for the estimator redesign build. Open them in a browser.

| File | Surface |
|---|---|
| `01-mobile-contractor.html` | Mobile Full Estimator (contractor view) — metric grid, markup donut, CSI divisions, sticky totals |
| `02-mobile-client.html` | Mobile **client view** — the contractor/client toggle target |
| `03-web-desktop.html` | Web / desktop estimator — nav sidebar, 4-metric row, line-item table, summary/donut/cost-breakdown/activity rail |

## Design language (do not reinvent)

- **Dark ink surfaces** (`#0B0D10` ground, `#14181D` cards) with **orange `#FF6A1A` as the single primary accent** — grand totals, active tab, total-price column, primary buttons, the Brain.
- **Trade-color category tiles** from the existing palette (Concrete slate, Masonry sky, Metals amber, Wood tan, Thermal red, Sitework green, General orange). **No purple / pink / violet** — the reference apps used purple for markups; here markups render **amber**. (Enforced by `validate-app-slop`.)
- **Tabular numerals** for every dollar; hairline dividers; restraint (the earlier decorated pass was rejected as "vibe coded").
- Built on existing primitives: `Card`, `IconWrapper`, `Badge`, `BrandBackdrop`, tokens in `constants/designTokens.ts` / `colors.ts` / `typography.ts`. Display face is Fraunces in-app.

## Client view (standing requirement)

Every estimate surface keeps a **Contractor / Client toggle**. Client mode hides markups, margin, the cost-vs-markup donut, per-unit costs, suppliers, and Brain flags; it shows the project total, scope rolled up by system, allowances, inclusions/exclusions, and payment schedule. Plus a **Share proposal** action (client-safe link).

Shared, tested foundation (already built):
- `utils/clientEstimateView.ts` — `toClientEstimateView()` projection (17 tests, `validate-client-estimate-view`)
- `utils/clientEstimateShareToken.ts` — URL-safe proposal link (17 tests, `validate-client-estimate-share`)

Both enforce a no-internal-keys safety scan. See memory `estimate-client-view`.

## Build slices (mobile first, each committed & verified)

1. ✅ Client-safe data layer — transform + share token (done)
2. Contractor/Client toggle + client view wiring on the mobile estimator
3. Header/tabs + metric grid
4. Summary card + markup donut
5. CSI division rows (contractor) / scope-by-system (client)
6. Sticky totals + Brain line
7. Quick Estimate, same language
8. Web/desktop estimator (same components, desktop layout: sidebar + table + rail)

UI slices require on-device / in-app verification (screens are behind login).
