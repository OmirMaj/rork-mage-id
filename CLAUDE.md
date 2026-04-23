# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MAGE ID — React Native / Expo construction management app (iOS primary, Android + web supported). Bundle IDs: `com.mageid.app` (iOS), `app.mageid.android` (Android). EAS project `9f6536e0-0774-47e0-a0ae-2f10a4e46b2b`, owner `omirmajeed`.

## Commands

Package manager is **bun** (scripts shell out to `bunx rork`, the custom Rork CLI wrapping Expo).

```bash
# Dev server (tunnel required — Rork CLI does not support LAN-only)
bun run start                 # native, tunneled
bun run start-web             # web, tunneled
bun run start-web-dev         # web with expo debug logs

# Quality
bun run lint                  # expo lint (eslint flat config, eslint-config-expo)
npx tsc --noEmit              # type-check; run before every ship. Strict mode is on.

# Native builds (rarely needed — prefer OTA)
eas build --profile production --platform ios
eas build --profile preview --platform ios --auto-submit   # preview channel baked in

# OTA updates (default path for JS-only changes)
eas update --branch production --message "short description"
eas update --branch preview    --message "short description"

# Submit
eas submit --platform ios --latest    # uses ascAppId 6762229238, team HKT2J284D2
```

**Runtime version policy is `appVersion`** (see `app.json`). Bumping `expo.version` forces a new native build — OTA will not cross that boundary. Keep `version` stable when shipping JS-only fixes.

**OTA channel must be baked into the build.** `eas.json` sets `channel: "production"` / `"preview"` on their respective build profiles. An update published to `production` only reaches devices whose install was built on the `production` profile.

## Architecture

### Routing (Expo Router 6, typed routes)

- `app/_layout.tsx` is the single root. It mounts the provider stack and declares every `Stack.Screen` (30+ routes including `estimate-wizard` as `presentation: "modal"`).
- `app/(tabs)/_layout.tsx` renders the bottom tab bar on mobile. On wide screens, `components/DesktopSidebar.tsx` is the primary nav — keep both in sync when adding/removing destinations. Hidden routes use `href: null`.
- Deep-link scheme is `rork-app://`. Expo Router origin is pinned to `https://rork.com/` in both `app.json` plugins and `extra.router`.
- `experiments.typedRoutes` is on — router autocomplete and type-checks route strings. Don't cast your way around a red squiggle; fix the path.

### Provider stack (order matters)

Defined in `app/_layout.tsx`, top-down:

```
QueryClientProvider
└── GestureHandlerRootView
    └── ThemeLoader
        └── AuthProvider
            └── SubscriptionProvider     (RevenueCat — depends on auth user)
                └── ProjectProvider
                    └── BidsProvider
                        └── CompaniesProvider
                            └── HireProvider
                                └── NotificationProvider
                                    ├── OfflineSyncManager
                                    └── RootLayoutNav (the Stack)
```

Contexts are built with `@nkzw/create-context-hook` (`createContextHook`), which generates a `Provider` + typed hook pair. A context added below `Auth` gets the current user; one added above it does not.

### State

- **Local / UI**: `zustand` stores.
- **Server / remote**: `@tanstack/react-query` + tRPC client (`lib/trpc.ts` → `backend/hono.ts`, tRPC routers in `backend/`).
- **Cross-screen domain state**: the context providers listed above.
- **Persistence**: `AsyncStorage`. Keys are namespaced — `buildwise_*` for core (legacy prefix, do not rename) and `tertiary_*` for the newer project sub-collections (`tertiary_change_orders`, `tertiary_invoices`, `tertiary_daily_reports`, `tertiary_punch_items`, `tertiary_photos`, `tertiary_rfis`, `tertiary_submittals`, `tertiary_warranties`, `tertiary_portal_messages`).

### Offline-first sync

All Supabase writes go through `utils/offlineQueue.ts` (`supabaseWrite` helper). It optimistically mutates local state, enqueues the write, and `OfflineSyncManager` (mounted in `_layout.tsx`) flushes when connectivity returns. Don't call `supabase.from(...).insert/update/delete` directly from UI — always go through the queue so dropped/airplane-mode sessions stay consistent.

### Subscription / paywall gating

- `contexts/SubscriptionContext.tsx` wraps RevenueCat (`react-native-purchases`). Tiers: free, Pro, Business.
- `hooks/useTierAccess.ts` is the single gate. Call it from features — do not branch on raw RevenueCat entitlements.
- Purchase flow lives in `app/paywall.tsx`.

### Types

`types/index.ts` is the single source of truth for domain types (`Project`, `Estimate`, `ChangeOrder`, `Invoice`, `DailyReport`, `PunchItem`, `Photo`, `RFI`, `Submittal`, `Warranty`, `PortalMessage`, etc). Contexts, backend, and UI all import from there. Extending a domain object = edit this file first.

### Path alias

`@/*` → repo root (see `tsconfig.json`). Prefer `@/components/Foo` over deep relative paths.

### Backend

- `backend/hono.ts` — Hono app, mounts tRPC at `/trpc` via `@hono/trpc-server`.
- `backend/trpc/` — routers. Client is `lib/trpc.ts` (uses `superjson` transformer).
- Supabase client in `lib/supabase.ts` (anon key, RLS-protected).

## Conventions

- **iOS is the primary target.** `ios.supportsTablet: false` — don't design for iPad. Web is supported but secondary.
- **New Architecture is on** (`newArchEnabled: true`). Any new native module must be Fabric/TurboModule compatible.
- **Modal-in-screen pattern**: long screens (e.g. `app/project-detail.tsx`) use a tile grid that opens section modals with a `ChevronLeft` back button, rather than a single long scroll. Follow this pattern for new multi-section screens.
- **Icons**: `lucide-react-native` throughout. Don't mix in `@expo/vector-icons` unless there's no Lucide equivalent.
- **Haptics / local auth / secure store** are available (`expo-haptics`, `expo-local-authentication`, `expo-secure-store`) — prefer them over re-rolling.
