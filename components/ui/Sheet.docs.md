# Sheet

The canonical chrome for modal-route screens. Provides the back-chevron header + scrollable body that CLAUDE.md describes as the "modal-in-screen pattern."

## When to use

| Use Sheet | Don't use Sheet |
|---|---|
| Any route declared with `presentation: 'modal'` in `_layout.tsx`. | A bottom-sheet detent (partial height) — different primitive. |
| In-screen section modals opened from a tile grid (e.g. project-detail.tsx). | The root screens inside `(tabs)/` — those use the tab bar, not a modal header. |
| Forms that scroll and need a clear "back" target. | A toast or banner — use a `<Card variant="tinted">` inline. |

## Anatomy

```
┌─────────────────────────────────────────┐
│  ‹      Title                  Action   │  ← header (56pt + safe-area inset)
├─────────────────────────────────────────┤
│                                         │
│  body padding (lg / 20pt by default)    │
│                                         │
│  children                               │
│                                         │
└─────────────────────────────────────────┘
```

- **Back chevron**: 44pt hit target on the left, calls `onClose` (typically `router.back()`).
- **Title**: `Type.title3` (20pt / 600), centered, single line + truncate.
- **Right action**: optional. Variant-driven color (`primary` = accent, `destructive` = error, `neutral` = secondary).
- **Body**: scrollable by default with `keyboardShouldPersistTaps="handled"` for forms. Pass `scrollable={false}` when the child manages its own scrolling (e.g. a FlatList).

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Required. Header title. |
| `onClose` | `() => void` | — | Required. Back-chevron handler. |
| `rightAction` | `SheetRightAction` | — | Optional right-side action button. |
| `scrollable` | `boolean` | `true` | Wrap children in a `ScrollView`. |
| `bodyPadding` | `keyof Tokens.spacing \| number \| 'none'` | `'lg'` (20pt) | Inner body padding. |
| `style` | `ViewStyle` | — | Outer container override. |
| `contentStyle` | `ViewStyle` | — | Scrollable body content override. |
| `testID` | `string` | — | For E2E tests. |

### SheetRightAction

| Property | Type | Default | Description |
|---|---|---|---|
| `label` | `string` | — | Short verb ("Save", "Send", "Done"). |
| `onPress` | `() => void` | — | Tap handler. |
| `variant` | `'primary' \| 'destructive' \| 'neutral'` | `'primary'` | Color emphasis. |
| `disabled` | `boolean` | `false` | Disables the action. |
| `testID` | `string` | `'sheet-right-action'` | For E2E tests. |

## Accessibility

- **Back button**: `accessibilityLabel="Back"`, `accessibilityRole="button"`.
- **Title**: `accessibilityRole="header"` so screen readers announce the screen.
- **Right action**: uses its `label` as the `accessibilityLabel`, marks disabled state.
- **Hit targets**: back chevron is 72pt wide × 44pt tall (Apple HIG min). Right action is `Tokens.touchTarget.min` (44pt) tall.
- **Safe area**: top inset is automatically applied via `useSafeAreaInsets()`. Bottom inset is added to body padding so content clears the home indicator.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Use Sheet inside any route with `presentation: 'modal'`. | Render a Sheet inside a Sheet — pick one or the other. |
| Pass `scrollable={false}` when wrapping a `FlatList` / `SectionList`. | Wrap a FlatList in the default scrollable Sheet — you'll get nested-scroll warnings. |
| Use `rightAction` for the primary commit action ("Save", "Send"). | Cram two right actions in — if you need both, use a footer button bar instead. |
| Title goes in `title` prop, not as a child. | Render your own `<Text>` header — defeats the purpose. |

## Code example

```tsx
import { Sheet } from '@/components/ui';
import { useRouter } from 'expo-router';

export default function CreateChangeOrderModal() {
  const router = useRouter();
  const [draft, setDraft] = useState({ description: '', amount: '' });
  const canSave = draft.description && draft.amount;

  return (
    <Sheet
      title="New change order"
      onClose={() => router.back()}
      rightAction={{
        label: 'Save',
        onPress: handleSave,
        disabled: !canSave,
      }}
    >
      <Field label="Description" value={draft.description} onChange={...} />
      <Field label="Amount" value={draft.amount} onChange={...} keyboardType="decimal-pad" />
    </Sheet>
  );
}

// FlatList — opt out of internal scrolling.
<Sheet title="Pick a contact" onClose={onClose} scrollable={false} bodyPadding="none">
  <FlatList data={contacts} renderItem={...} />
</Sheet>
```

## Migration target

15+ existing modal components in `components/` reimplement this chrome ad-hoc. Migration order, by impact:

1. `EntityActionSheet.tsx`
2. `FeatureExplainerSheet.tsx`
3. `SubDailyUpdateModal.tsx`
4. `ConfirmEmailModal.tsx`
5. `ContactPickerModal.tsx`

Each migration: rip out the bespoke header + scroll wrapper, replace with `<Sheet>`.
