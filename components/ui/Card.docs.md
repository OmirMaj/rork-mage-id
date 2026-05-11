# Card

The foundational surface primitive. Reach for this before `<View style={{ backgroundColor, borderRadius, padding, ...shadow }}>`.

## When to use

| Use Card | Don't use Card |
|---|---|
| Any rectangular surface that groups content (dashboard tile, settings group, paywall plan card). | A list row — use `<NavRow>` instead. |
| Status callouts (success banner, warning notice). | A bottom-sheet modal — use `<Sheet>` instead. |
| Tappable tiles that lead somewhere. | A button — keep using native pressable + primary CTA pattern. |
| Cards inside a list or grid. | Page backgrounds — those are screen-level chrome, not cards. |

## Variants

| Variant | Use When |
|---|---|
| `default` | The 90% case. Surface bg + subtle resting shadow. |
| `elevated` | Surface needs to read as floating — active drag, modal-like callout inside a screen. |
| `flat` | Inside a grouped list where the section already provides elevation. Border only, no shadow. |
| `tinted` | Status callouts — pair with `tone="success"` / `"warning"` / `"error"` / `"info"`. |

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `variant` | `'default' \| 'elevated' \| 'flat' \| 'tinted'` | `'default'` | Visual variant. |
| `tone` | `'neutral' \| 'primary' \| 'success' \| 'warning' \| 'error' \| 'info' \| 'accent'` | `'neutral'` | Only used when `variant="tinted"`. |
| `padding` | `keyof Tokens.spacing \| number \| 'none'` | `'md'` (16pt) | Inner padding. Pass `'none'` when children handle their own. |
| `radius` | `keyof Tokens.radius \| number` | `'card'` (12pt) | Corner radius. |
| `onPress` | `(e) => void` | — | Makes the card tappable. Switches to `Pressable`. |
| `onLongPress` | `() => void` | — | Long-press handler. |
| `disabled` | `boolean` | `false` | Visual + interaction disable. |
| `accessibilityLabel` | `string` | — | Required when `onPress` is set. |
| `style` | `ViewStyle` | — | Escape hatch. Use sparingly. |
| `testID` | `string` | — | For E2E tests. |

## States

| State | Visual | Behavior |
|---|---|---|
| Default | Variant-driven bg, subtle shadow (or border for flat/tinted). | — |
| Pressed | Opacity drops to 0.85. | Only when `onPress` is set. |
| Disabled | Opacity drops to 0.45. | Non-interactive. |

## Accessibility

- **Role**: `button` when `onPress` is set, otherwise none (it's a plain container).
- **Required**: pass `accessibilityLabel` when the card is interactive — the screen-reader announcement should describe what tapping does, not what the card contains.
- **Keyboard**: focusable + activatable via space/enter on web. (RN Pressable handles this.)
- **iOS continuous corners**: applied automatically via `continuousCorners`. The squircle shape is a polish marker that distinguishes premium iOS apps.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Compose `<Card>` around your tile content. | Wrap a `<Card>` in another `<View style={{ borderRadius, shadow }}>`. |
| Use `tone` on `variant="tinted"` to color status. | Override `backgroundColor` via `style` — pick the right variant. |
| Set `padding="none"` when the child (e.g. `<NavRow>`) owns its padding. | Hardcode `padding: 16` — the default is already 16. |
| Pair `onPress` with `accessibilityLabel`. | Use `<Card onPress>` without a label. |
| Pick `variant="flat"` for cards inside grouped lists. | Stack `default` cards directly on top of each other — the shadows pile up. |

## Code example

```tsx
import { Card } from '@/components/ui';
import { Type } from '@/constants/typography';
import { Colors } from '@/constants/colors';

// A tappable dashboard tile.
<Card
  onPress={() => router.push('/projects')}
  accessibilityLabel="Open projects"
>
  <Text style={[Type.eyebrow, { color: Colors.textSecondary }]}>PROJECTS</Text>
  <Text style={[Type.title1, { color: Colors.text, marginTop: 4 }]}>12 active</Text>
</Card>

// A success status callout.
<Card variant="tinted" tone="success">
  <Text style={[Type.bodyEmphasized, { color: Colors.successDark }]}>
    Pay app sent — awaiting client approval
  </Text>
</Card>

// A card inside a list, where the surrounding section provides elevation.
<Card variant="flat" padding="none">
  <NavRow Icon={FileText} title="Drawings" onPress={...} />
  <NavRow Icon={DollarSign} title="Estimates" onPress={...} />
</Card>
```
