# TrustRow

Small reassurance footnote with a leading icon. The "Secure payment via App Store" pattern.

## When to use

| Use TrustRow | Don't use TrustRow |
|---|---|
| Footer text under a paywall, form, or compliance section. | A multi-signal trust display (license + COI + response time) — use `components/TrustBadgeRow.tsx` instead. |
| A "your data is encrypted" footnote on a privacy-sensitive screen. | Body copy or paragraph text. |
| A "verified" indicator next to a sub-header. | A tappable button — TrustRow is decorative reassurance, not interactive. |

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `label` | `string` | — | Required. 6-12 words, one line. |
| `icon` | `LucideIcon` | `Shield` | Leading icon. Pick a meaningful one: `Lock` for security, `Check` for verified, `ShieldCheck` for compliance, etc. |
| `tone` | `'neutral' \| 'success' \| 'info' \| 'accent'` | `'neutral'` | Icon color. Text stays secondary regardless. |
| `variant` | `'subtle' \| 'inline'` | `'subtle'` | Layout — see below. |
| `style` | `ViewStyle` | — | Optional override. |
| `testID` | `string` | — | E2E target. |

## Variants

| Variant | Use When |
|---|---|
| `subtle` (default) | Centered footer-style line under a paywall, modal, or form. |
| `inline` | Left-aligned, sits inline with section content (e.g. directly under a section header). |

## Accessibility

- **Role**: `text`. Screen readers read the label.
- **Icon**: decorative — the meaning lives in the label text.
- **Color**: text uses `Colors.textSecondary` (WCAG-AA against surface). Icon color comes from the tone but is not meaning-bearing.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Use `Shield` for "secure", `Lock` for "encrypted", `Check` for "verified", `ShieldCheck` for "compliant". | Use a random icon for visual variety. |
| Pick `tone="success"` only when you're affirming positive compliance. | Use `tone="success"` for every TrustRow — loses the signal. |
| Use `variant="subtle"` at the bottom of forms / paywalls. | Use `variant="inline"` in a footer position. |

## Code example

```tsx
import { TrustRow } from '@/components/ui';
import { Lock, ShieldCheck, Sparkles } from 'lucide-react-native';

// Paywall footer.
<TrustRow label="Secure payment via App Store" />

// Privacy footnote on a lead-capture form.
<TrustRow icon={Lock} label="Your data is encrypted in transit" />

// Compliance affirmation.
<TrustRow icon={ShieldCheck} tone="success" label="SOC 2 Type II compliant" />

// AI privacy promise — inline under a section.
<TrustRow
  icon={Sparkles}
  variant="inline"
  label="We don't train AI models on your project data"
/>
```

## Migration target

10+ inline reimplementations across:
- `components/Paywall.tsx` (the "Secure payment" line)
- `components/PDFPreSendSheet.tsx`
- `app/profile.tsx`
- `app/permit-leads.tsx`
- `marketing/lead.html` (separate codebase, but pattern repeats)

Each migration: replace `<View><Shield /><Text>...</Text></View>` with one `<TrustRow>`.
