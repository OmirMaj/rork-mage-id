# Section

Titled stack primitive: optional eyebrow + title + optional subtitle + optional right action, with stacked children below.

## When to use

| Use Section | Don't use Section |
|---|---|
| The "AI Hub" / "Money" / "Decisions" headers on the Tools tab. | Pages with no grouping — just lay out the content directly. |
| Settings groups inside a settings screen. | Modal headers — use `<Sheet>`. |
| Dashboard widget headers ("Cash flow", "This week"). | A single titled card — use `<Card>` with inline title. |

## Anatomy

```
EYEBROW          ← optional, Type.eyebrow (11pt 700 uppercase, letterSpacing 1.4)
Title text             See all  ← title (Type.title3) + optional right action
Optional subtitle      ← Type.footnote, secondary color

[children stacked vertically with `spacing` between each]
```

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Required. `Type.title3`. |
| `eyebrow` | `string` | — | Small uppercase tag above title. Use for category labels. |
| `subtitle` | `string` | — | One-line subtitle below title. |
| `rightAction` | `SectionRightAction` | — | "See all" / "Edit" / "Add" button on the right. |
| `spacing` | `keyof Tokens.spacing \| number \| 'none'` | `'sm'` (12pt) | Gap between children. `'none'` for flush stacks. |
| `headerGap` | `keyof Tokens.spacing \| number` | `'md'` (16pt) | Gap between header and first child. |
| `style` | `ViewStyle` | — | Outer container override. |
| `testID` | `string` | — | For E2E tests. |

### SectionRightAction

| Property | Type | Description |
|---|---|---|
| `label` | `string` | Short verb ("See all", "Edit", "Add"). |
| `onPress` | `() => void` | Tap handler. |
| `testID` | `string` | E2E target. |

## Accessibility

- **Title** is rendered with `accessibilityRole="header"` — screen readers announce it as a section heading.
- **Eyebrow** is rendered as plain text (it's typographic decoration, not semantic).
- **Right action** is a button with `accessibilityLabel` from the label.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Use eyebrow for category names ("AI HUB", "MONEY", "FIELD"). | Use eyebrow for every section — it loses the categorical signal. |
| Use `spacing="none"` when wrapping a flat list of NavRows in a Card. | Use the default spacing inside a `<Card variant="flat" padding="none">` — rows won't be flush. |
| Pair with `<Card>` children for grouped lists, raw children for free-form layouts. | Wrap a Section in another Section — pick one level. |
| Use `rightAction` for "See all" links to deeper screens. | Use `rightAction` for primary actions — those go in a `<Sheet>` header or a footer button. |

## Code example

```tsx
import { Section, Card, NavRow, Pill } from '@/components/ui';
import { Sparkles, Gavel, DollarSign } from 'lucide-react-native';

// Grouped NavRow list in a flat card.
<Section eyebrow="AI HUB" title="Construction AI">
  <Card variant="flat" padding="none">
    <NavRow Icon={Sparkles} title="Construction AI" onPress={...} />
    <NavRow Icon={Gavel} title="Permit Q&A" onPress={...} />
  </Card>
</Section>

// Dashboard widget with "See all" right action.
<Section
  title="Recent payments"
  rightAction={{ label: 'See all', onPress: () => router.push('/payments') }}
>
  <Card>
    <Text>$12,400 paid this week</Text>
    <Pill tone="success" label="3 invoices" />
  </Card>
</Section>

// Settings group — eyebrow names the category.
<Section eyebrow="NOTIFICATIONS" title="What we send" spacing="none">
  <Card variant="flat" padding="none">
    <NavRow Icon={Bell} title="Push notifications" meta="On" onPress={...} />
    <NavRow Icon={Mail} title="Email digest" meta="Weekly" onPress={...} />
  </Card>
</Section>
```

## Migration target

~30 local `function Section()` definitions exist across:
- `app/(tabs)/tools/index.tsx` (current canonical version)
- `app/(tabs)/summary/index.tsx`
- `app/project-detail.tsx`
- `app/settings.tsx`
- Most `components/AI*` files

Each migration: replace the local Section + Divider with `<Section>` + child stacking. Typically -30 LOC per file, +1 typography token-driven heading.
