# EntityRef — Universal linking primitive

A single, app-wide shape for "a pointer to any domain object." Any feature
that needs to deep-link, cite, or navigate to a thing (activity feeds, action
sheets, mentions, notifications, ICS events) should accept / emit an
`EntityRef` rather than a hand-rolled `{type, id}` pair.

## The type

```ts
// types/index.ts
export type EntityKind =
  | 'project' | 'task' | 'photo' | 'rfi' | 'submittal'
  | 'changeOrder' | 'invoice' | 'payment' | 'dailyReport'
  | 'punchItem' | 'warranty' | 'contact' | 'document'
  | 'permit' | 'equipment';

export interface EntityRef {
  kind: EntityKind;
  id: string;
  /** Parent project — required for most nested kinds. */
  projectId?: string;
  /** Optional display label. Resolver falls back to the entity's natural title. */
  label?: string;
}
```

## The three helpers

All three live in `utils/entityResolver.ts` and are pure functions — they take
a ref and (when needed) the project store shape returned by `useProjects()`.

| Helper                  | Returns                            | Use when                                      |
| ----------------------- | ---------------------------------- | --------------------------------------------- |
| `getEntityRoute(ref)`   | `{ pathname, params } \| null`     | you only need the router target               |
| `formatEntityLabel(ref, store?)` | `string` (always non-empty) | you need a chip / row label                   |
| `resolveEntity(ref, store)` | `{ entity, label, route }`     | you need all three at once                    |

## The hook

```ts
// hooks/useEntityNavigation.ts
const { navigateTo } = useEntityNavigation();
```

`navigateTo(ref, options?)` handles route lookup + push/replace + the iOS
pageSheet-modal-blocks-navigation delay in one call. Options:

- `mode: 'push' | 'replace'` — defaults to `push`.
- `fromSheet: boolean` — set `true` when calling from inside a
  `presentationStyle="pageSheet"` Modal; adds a 350 ms iOS delay so the sheet
  can dismiss before the destination mounts.
- `onBeforeNavigate: () => void` — side-effect run synchronously before the
  delay (typically `setActiveTile(null)` or `setShowDetailModal(false)`).

## Examples

### 1. Open a project from the home tab

```tsx
// app/(tabs)/(home)/index.tsx
const { navigateTo } = useEntityNavigation();

const handleProjectPress = useCallback((project: Project) => {
  navigateTo({ kind: 'project', id: project.id });
}, [navigateTo]);
```

### 2. Open a linked project from the contacts detail overlay modal

```tsx
// app/contacts.tsx
<TouchableOpacity
  onPress={() =>
    navigateTo(
      { kind: 'project', id: p.id, label: p.name },
      { onBeforeNavigate: () => setShowDetailModal(false) },
    )
  }
>
  <Text>{p.name}</Text>
</TouchableOpacity>
```

No `fromSheet` needed — this modal is `transparent`, not pageSheet.

### 3. Open an RFI from inside the project-detail pageSheet modal

```tsx
// app/project-detail.tsx
<TouchableOpacity
  onPress={() =>
    navigateTo(
      { kind: 'rfi', id: rfi.id, projectId: id },
      { fromSheet: true, onBeforeNavigate: () => setActiveTile(null) },
    )
  }
>
  <Text>RFI #{rfi.number}: {rfi.subject}</Text>
</TouchableOpacity>
```

`fromSheet: true` is the key — without it the RFI screen would mount behind
the tile sheet on iOS and only become visible after back-swiping.

## When NOT to use this

- **One-off routes with no entity underneath.** Paywall, settings sub-screens,
  wizard flows — `router.push('/paywall')` is still fine.
- **Tab-to-tab jumps.** Use `router.replace('/(tabs)/schedule')` directly.
  EntityRef is for domain-object navigation, not navigation chrome.
- **Deeply nested routes that don't yet exist.** If `getEntityRoute` returns
  `null` for a kind you care about, add the route mapping there first rather
  than bypassing the helper.

## Extending

Adding a new EntityKind:

1. Add the literal to the `EntityKind` union in `types/index.ts`.
2. Add the route mapping in `getEntityRoute()` in `utils/entityResolver.ts`.
3. Add the lookup branch in `resolveEntityObject()` (extending `EntityStore`
   if a new collection is needed).
4. Add the label extractor in `extractNaturalLabel()` and the display string
   in `KIND_LABEL`.

The `never` exhaustiveness guard in each switch will surface a TS error if
any step is skipped.
