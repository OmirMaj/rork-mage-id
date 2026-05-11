# Field

Form-field primitive: label + input + helper/error. Reach for this before stacking `<Text>` + `<TextInput>` inline.

## When to use

| Use Field | Don't use Field |
|---|---|
| Single-value text input (name, email, password, amount). | Pickers (date, select, multi-select). |
| Currency input with auto `$` prefix. | Numeric stepper / slider. |
| Multiline textarea (notes, descriptions). | Rich-text editor. |
| Search box. | A button that opens a modal — that's a `<NavRow>`. |

## Types

| `type` value | Keyboard | Auto-cap | Secure | Extras |
|---|---|---|---|---|
| `text` (default) | default | sentences | no | — |
| `numeric` | number-pad | off | no | — |
| `decimal` | decimal-pad | off | no | — |
| `currency` | decimal-pad | off | no | Prepends `$` |
| `email` | email-address | off | no | — |
| `password` | default | off | **yes** | — |
| `phone` | phone-pad | off | no | — |
| `url` | url | off | no | — |
| `search` | default | off | no | — |

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `value` | `string` | — | Required. Controlled value. |
| `onChange` | `(v: string) => void` | — | Required. Value handler. |
| `label` | `string` | — | Label above the input. Omit only for unlabeled inputs (rare — e.g. inline search). |
| `required` | `boolean` | `false` | Adds a red dot next to the label. |
| `placeholder` | `string` | — | Placeholder text. |
| `helper` | `string` | — | Subtle hint below the input. |
| `error` | `string` | — | Error message — replaces helper, switches frame to error color. |
| `icon` | `LucideIcon` | — | Leading icon inside the input frame. |
| `type` | `FieldType` | `'text'` | See Types table above. |
| `multiline` | `boolean` | `false` | Textarea mode (min 96pt tall, max 4 lines). |
| `disabled` | `boolean` | `false` | Disable input. |
| `style` | `ViewStyle` | — | Outer wrapper override. |
| `testID` | `string` | auto from label | E2E test target. |

Additional `TextInputProps` (e.g. `maxLength`, `autoFocus`, `returnKeyType`) pass through to the underlying `TextInput`.

## States

| State | Visual | Behavior |
|---|---|---|
| Default | Border: `Colors.border`, bg: surface. | — |
| Focused | Border: `Colors.accent`. | While focused. |
| Error | Border: `Colors.error`, error text shown. | Static — clear by clearing `error` prop. |
| Disabled | Bg: `fillSecondary`, input non-editable. | Greys the whole frame. |

## Accessibility

- **Label** is rendered as a sibling `<Text>` — screen readers announce it before the input thanks to RN's reading order.
- **Required dot** has `accessibilityLabel="required"` so screen readers announce the requirement.
- **Error text** is announced when shown (RN's text changes are picked up by VoiceOver).
- **Keyboard**: `keyboardType` is auto-set from `type` — numeric inputs get the number pad on iOS.
- **Auto-cap**: most non-text types disable auto-capitalize (`'none'`).
- **Touch target**: input frame has `minHeight: Tokens.touchTarget.min` (44pt).

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Use `type="currency"` for money fields — gets the `$` and decimal pad. | Type `"text"` and prefix `$` manually. |
| Pass a controlled `value` + `onChange`. | Use `defaultValue` — RN treats it as uncontrolled. |
| Use `error` for validation failure, `helper` for guidance. | Use both at once. |
| Set `multiline` for any field over 100 chars typical. | Use `multiline` for short fields — wastes space. |
| Pass `required` so labels signal the constraint. | Add "(required)" to the label string. |

## Code example

```tsx
import { Field } from '@/components/ui';
import { Mail, DollarSign } from 'lucide-react-native';
import { useState } from 'react';

function ChangeOrderForm() {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState<string>();

  return (
    <View style={{ gap: 16 }}>
      <Field
        label="Description"
        value={desc}
        onChange={setDesc}
        placeholder="What changed?"
        multiline
        required
      />

      <Field
        label="Amount"
        value={amount}
        onChange={setAmount}
        type="currency"
        placeholder="0.00"
        required
      />

      <Field
        label="Client email"
        value={email}
        onChange={setEmail}
        type="email"
        icon={Mail}
        helper="We'll send the approval request here."
        error={emailError}
      />
    </View>
  );
}
```

## Migration target

40+ ad-hoc form rows live in:
- `app/new-project.tsx`
- `app/change-order.tsx`
- `app/estimate-wizard.tsx` (modal route)
- `app/profile.tsx`
- `components/Paywall.tsx` (none currently — but the address-form inside Stripe is similar)
- Many feature-specific edit modals

Each migration: rip the bespoke `<Text label> + <TextInput> + <Text helper>` stack, replace with one `<Field>`. Typically -15 LOC per field, -1 inconsistent border-radius.
