# Pill

Small status chip. Optional leading icon + label, pill-shaped, tone-driven color.

## When to use

| Use Pill | Don't use Pill |
|---|---|
| Status labels on cards ("Pending", "Approved", "Overdue"). | Tappable buttons — use a `Pressable` with a primary CTA style. |
| Tag chips on filter rows. | Body-text emphasis — use `Type.bodyEmphasized`. |
| Count badges next to titles ("3 new"). | Multi-line content — pills are one short label. |
| Category labels ("AI", "Permit", "Change order"). | Numbers in stats cards — use `Type.title1`. |

## Variants

| Variant | Use When |
|---|---|
| `tinted` (default) | Subtle pale-tint bg + dark fg. The 80% case. |
| `solid` | Loud — solid bg + white fg. Reserve for callouts that must compete with surrounding noise. |
| `outline` | Transparent bg + tinted border. Use on top of busy backgrounds where a tinted bg would clash. |

## Tones

Same palette as `NavRow`. Each tone has a semantic anchor — don't pick by aesthetic.

| Tone | Semantic |
|---|---|
| `neutral` | Default. No status meaning. |
| `primary` | Brand actions, project status. |
| `success` | Approvals, sign-offs, paid. |
| `warning` | Time-sensitive, due soon. |
| `error` | Violations, expiries, overdue. |
| `info` | Documents, reports, neutral metadata. |
| `accent` | Sales, pipeline, calls-to-action. |
| `violet` | AI features. |
| `teal` | Estimates, change orders. |
| `rose` | People, contacts. |
| `amber` | Permits, code citations. |
| `indigo` | Insurance, coverage. |
| `emerald` | Tax, money export. |
| `sky` | Discovery, explore. |

## Sizes

| Size | Padding | Text | Use When |
|---|---|---|---|
| `sm` | `xxs` / `hairline` | `caption2` (11pt) | Dense rows with 3+ pills. |
| `md` (default) | `sm` / `xxs` | `footnote` (13pt) | Standalone status badges. |

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `label` | `string` | — | Required. Short — 1–3 words. |
| `tone` | `PillTone` | `'neutral'` | Color tone. |
| `size` | `'sm' \| 'md'` | `'md'` | Density. |
| `icon` | `LucideIcon` | — | Optional leading icon. |
| `variant` | `'tinted' \| 'solid' \| 'outline'` | `'tinted'` | Visual emphasis. |
| `style` | `ViewStyle` | — | Escape hatch. |
| `testID` | `string` | — | For E2E tests. |

## Accessibility

- **Role**: `text`. Pills are read aloud as their label.
- **Hit target**: not a hit target. Pills are decorative status — if you need to tap, use a `Pressable` ancestor or a different primitive.
- **Color contrast**: tone foreground colors are tuned for WCAG-AA against their tinted background.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Pick a tone by semantic, not aesthetic. | Use `tone="error"` on a happy-path "Submitted" label because red looks bold. |
| Use `size="sm"` when stacking 3+ pills in a row. | Mix sizes in the same row. |
| Pair icon + label when the icon adds meaning (e.g. lock + "Locked"). | Add an icon just for decoration. |
| Use `variant="solid"` for the one most-important status on screen. | Make every pill solid — it loses the emphasis. |

## Code example

```tsx
import { Pill } from '@/components/ui';
import { Check, AlertTriangle, Sparkles } from 'lucide-react-native';

// Status badge on a project card.
<Pill tone="success" icon={Check} label="Paid" />

// Time-sensitive warning.
<Pill tone="warning" icon={AlertTriangle} label="Due in 3 days" />

// AI-feature tag.
<Pill tone="violet" icon={Sparkles} label="AI" size="sm" />

// Loud emphasis on a hero card.
<Pill tone="accent" variant="solid" label="New" />

// On a busy background (e.g. inside a hero photo overlay).
<Pill tone="info" variant="outline" label="Drawings" />
```
