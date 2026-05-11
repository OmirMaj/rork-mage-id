# NavRow

The shared "tap-to-navigate" row used across the app. Icon-square + title + optional subtitle + optional badge/meta + chevron.

## When to use

| Use NavRow | Don't use NavRow |
|---|---|
| Settings rows. | Buttons — use a `Pressable` with a CTA style. |
| Project Detail section tiles. | Dashboard hero cards — use `<Card>`. |
| Discover / NavigationCards. | Multi-line forms — use a field component. |
| Notifications inbox rows. | Tab bar items — tabs are framework chrome. |
| Report inbox rows. | Tappable status badges — use `<Pill>` inside a `<Card onPress>`. |

## Variants

| Variant | Use When |
|---|---|
| `list` (default) | Full-width row inside a grouped list. iOS Settings vibe. No border, surface bg. |
| `card` | Same content rendered as a card with rounded corners and subtle border. Used in dashboards where rows aren't part of a grouped list. |

## Tones

`tone` controls the icon-square tint. Defaults to `neutral` (gray). Color earns its way onto the screen by communicating status — never decoration.

| Tone | Semantic | Example |
|---|---|---|
| `neutral` | No status meaning. | Generic settings. |
| `primary` | Brand actions, generic project tasks. | Field Ops with active work. |
| `success` | Approvals, sign-offs. | Pay app sent. |
| `warning` | Time-sensitive, deadlines. | Invoice due. |
| `error` | Violations, expiries. | Expired COI. |
| `info` | Documents, reports. | Drawings, RFIs. |
| `accent` | Sales, pipeline. | Active bids. |
| `violet` | AI features. | AI Copilot. |
| `teal` | Estimates, change orders. | New estimate. |
| `rose` | People / directories. | Contacts. |
| `amber` | Permits / code citations. | Permit Q&A. |
| `indigo` | Insurance / claims. | COI. |
| `emerald` | Tax / money export. | 1099-NEC. |
| `sky` | Discovery / explore. | Discover screen. |

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `Icon` | `LucideIcon` | — | Required. Rendered in the leading icon square. |
| `title` | `string` | — | Required. Primary text. |
| `subtitle` | `string` | — | Secondary text under the title (2-line truncate). |
| `meta` | `string` | — | Right-side meta — count, status, "Pro", etc. |
| `badge` | `string` | — | Pill badge to the right of the title ("3 new"). |
| `tone` | `NavRowTone` | `'neutral'` | Icon-square tint. |
| `variant` | `'list' \| 'card'` | `'list'` | Visual style. |
| `chevron` | `boolean` | `true` | Show trailing chevron. |
| `onPress` | `() => void` | — | Required. Tap handler. |
| `disabled` | `boolean` | `false` | Disable visually + behaviorally. |
| `style` | `ViewStyle` | — | Escape hatch. |
| `testID` | `string` | — | For E2E tests. |

## Accessibility

- **Role**: `button` (inherited from `TouchableOpacity`).
- **Title** is the announced label by default. Add an explicit `accessibilityLabel` via `style` override if you need to differ.
- **Hit target**: row height meets Apple HIG min (44pt) when icon-square (36pt) + paddingVertical (12pt × 2 = 24pt) combine.
- **Disabled state**: opacity 0.45, taps are no-op.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Wrap groups of NavRows in a `<Card variant="flat" padding="none">` to get the grouped-list look. | Use raw `<View>` wrappers — drift target. |
| Pick `tone` based on the row's state semantic. | Color every row to look "designed" — undisciplined color is noise. |
| Use `variant="card"` when the row sits on a dashboard, not inside a list. | Stack `variant="card"` rows directly — they need spacing between them. |
| Use `badge` for in-row notifications ("3 new"). | Hide actionable info inside the badge — keep the title accurate. |

## Code example

```tsx
import { NavRow, Card } from '@/components/ui';
import { FileText, DollarSign, AlertTriangle } from 'lucide-react-native';

// Grouped list — wrap in a flat Card with no padding so rows are flush.
<Card variant="flat" padding="none">
  <NavRow
    Icon={FileText}
    title="Drawings"
    subtitle="12 sheets · last updated 2 days ago"
    tone="info"
    onPress={() => router.push('/drawings')}
  />
  <NavRow
    Icon={DollarSign}
    title="Estimates"
    meta="$248K"
    tone="teal"
    onPress={() => router.push('/estimates')}
  />
  <NavRow
    Icon={AlertTriangle}
    title="Expired COI"
    subtitle="3 subs need updated insurance"
    badge="3"
    tone="error"
    onPress={() => router.push('/compliance')}
  />
</Card>

// Standalone card row on a dashboard.
<NavRow
  variant="card"
  Icon={Sparkles}
  title="AI Copilot"
  subtitle="Ask anything about this project"
  tone="violet"
  onPress={() => router.push('/copilot')}
/>
```

## Migration target

5 known reimplementations of this pattern in:
- Project Detail tiles
- Settings rows
- Discover NavigationCards
- Notifications inbox rows
- Report inbox rows

Each migration: replace bespoke JSX with `<NavRow>`. Pass `tone` matching the existing color, `badge` matching existing notification count.
