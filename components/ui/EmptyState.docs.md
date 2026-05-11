# EmptyState

Centered icon + title + message + optional CTA for any screen with no data yet. Comes with a soft accent halo, blueprint-grid backdrop, and a gentle pulse animation so the empty screen feels alive instead of broken.

## When to use

| Use EmptyState | Don't use EmptyState |
|---|---|
| A list/table that's genuinely empty (no projects yet, no RFIs filed). | A loading state — use a skeleton or `ActivityIndicator`. |
| A filter result that returned zero items. | An error state — that needs a different treatment (red tone, retry CTA). |
| First-time onboarding into a tab. | A permissions denial — needs a `Sheet` or explicit grant flow. |

## Props

| Property | Type | Default | Description |
|---|---|---|---|
| `icon` | `ReactNode` | — | Required. A Lucide icon, sized 28-32, color set inline by caller. |
| `title` | `string` | — | Required. Single-line, Fraunces display-sm. |
| `message` | `string` | — | Required. 1-2 sentences explaining what should happen here. |
| `actionLabel` | `string` | — | Primary CTA label. Triggers `onAction`. |
| `onAction` | `() => void` | — | Primary CTA handler. Required when `actionLabel` is set. |
| `secondaryLabel` | `string` | — | Subtle secondary CTA ("Learn more"). |
| `onSecondaryAction` | `() => void` | — | Secondary CTA handler. |
| `accent` | `string` | `Colors.primary` | Override the halo/icon-tile/CTA color. |
| `steps` | `string[]` | — | Optional 1-3 numbered steps shown between message and CTA. Teaches instead of scolds. |

## Anatomy

```
        ┌──────┐
        │ icon │   ← accent-tinted square, halo pulse behind it
        └──────┘

      Title in Fraunces

      Two-line message in the message style.
      Caps at 320px wide.

     ① First step
     ② Second step
     ③ Third step      ← optional, only when `steps` is passed

      ┌─ Primary CTA ─┐
      │  Get started  │
      └───────────────┘

      Secondary action  ← optional, no chrome
```

## Accessibility

- Animations respect `prefers-reduced-motion` via React Native's `Animated` defaults (pulse is subtle anyway — won't trigger vestibular issues).
- Primary CTA uses TouchableOpacity + haptic feedback (Light impact on iOS).
- Secondary CTA uses selection haptic.
- Icon is decorative; the title and message carry the meaning.

## Do's and don'ts

| ✅ Do | ❌ Don't |
|---|---|
| Use the title to name what's missing. ("No projects yet") | Use the title for the action. ("Create a project") |
| Use the message to explain why and what to do next. | Cram instructions into the title. |
| Pair with a primary CTA when the user can act inline. | Add a CTA for actions that need a separate setup flow. |
| Use `steps` to teach a multi-step path. | Use `steps` for trivial one-step actions. |
| Override `accent` for non-primary categories (orange for sales, violet for AI). | Override `accent` with raw hex — derive from `Colors.*`. |

## Code example

```tsx
import EmptyState from '@/components/ui/EmptyState';
// or via barrel:
import { EmptyState } from '@/components/ui';
import { FolderOpen, Sparkles } from 'lucide-react-native';
import { Colors } from '@/constants/colors';

// Minimal — list with no items.
<EmptyState
  icon={<FolderOpen size={32} color={Colors.primary} />}
  title="No projects yet"
  message="When you create your first project, it'll show up here."
  actionLabel="Create a project"
  onAction={() => router.push('/new-project')}
/>

// AI feature with steps teaching the path.
<EmptyState
  icon={<Sparkles size={32} color="#7C3AED" />}
  accent="#7C3AED"
  title="Ask Construction AI"
  message="Get instant code citations, permit advice, and project insights."
  steps={[
    "Describe your scope in plain English",
    "AI checks DOB code + flags violations",
    "Save the answer to a project for later",
  ]}
  actionLabel="Start a question"
  onAction={() => router.push('/construction-ai')}
/>
```

## Note

The `icon` prop accepts `ReactNode` (not a Lucide component reference) so callers can size and color the icon inline. This is the only primitive in `ui/` that takes a rendered icon rather than a component — kept for API stability with the 36 existing import sites.
