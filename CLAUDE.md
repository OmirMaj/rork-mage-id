# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **New session? Read `docs/PRODUCT-BIBLE.md` first** — the full picture of what MAGE ID is, who it's for, why it beats competitors, the cost-learning moat, the feature map, the three surfaces, and architecture/security. This CLAUDE.md is the build/command reference; the bible is the product/strategy reference.

## Project

MAGE ID — React Native / Expo construction management app (iOS primary, Android + web supported). Bundle IDs: `com.mageid.app` (iOS), `app.mageid.android` (Android). EAS project `9f6536e0-0774-47e0-a0ae-2f10a4e46b2b`, owner `omirmajeed`.

## Commands

Package manager is **bun**. The dev/build scripts run Expo directly (see `package.json` — `expo start`, `eas build`).

```bash
# Dev server (scripts default to --tunnel)
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
- Deep-link scheme is `mageid://` (single source: `utils/deepLinkScheme.ts`). Expo Router origin is `https://app.mageid.app/` in both `app.json` plugins and `extra.router`.
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

> **The tree above is ABRIDGED — it lists 8 providers; the real stack in `app/_layout.tsx` is 16.** Read the file before reasoning about provider ordering. See `docs/ARCHITECTURE-SUMMARY.md` for the verified full stack.

### State

- **Local / UI**: plain `useState` / `useReducer` in the owning component. (`zustand` is in `package.json` but has **zero imports anywhere in the source tree** — this line previously claimed zustand stores, which was aspirational, not real. Don't reach for it without deciding to actually adopt it; the same doc drift once claimed tRPC.)
- **Server / remote**: `@tanstack/react-query` + Supabase client (`lib/supabase.ts`) + Supabase edge functions (`supabase/functions/*`). The app does NOT use tRPC — earlier docs claimed it did, but `lib/trpc.ts` and `backend/trpc/` do not exist.
- **Cross-screen domain state**: the context providers listed above.
- **Persistence**: `AsyncStorage`. All keys are namespaced under the single `mageid_*` prefix — core (`mageid_projects`, `mageid_settings`, `mageid_user_role`), project sub-collections (`mageid_change_orders`, `mageid_invoices`, `mageid_daily_reports`, `mageid_punch_items`, `mageid_photos`, `mageid_rfis`, `mageid_submittals`, `mageid_warranties`, `mageid_portal_messages`), and app state (`mageid_offline_queue`, `mageid_theme`, `mageid_auth_*`). (Historically core keys used `buildwise_*` and sub-collections used `tertiary_*`; both were unified to `mageid_*` in the pre-launch de-branding. Any NEW `mageid_*` per-user key must be added to `LOCAL_USER_CACHE_KEYS` in `contexts/AuthContext.tsx` or it leaks across tenants on shared devices.)

### Offline-first sync

All Supabase writes go through `utils/offlineQueue.ts` (`supabaseWrite` helper). It optimistically mutates local state, enqueues the write, and `OfflineSyncManager` (mounted in `_layout.tsx`) flushes when connectivity returns. Don't call `supabase.from(...).insert/update/delete` directly from UI — always go through the queue so dropped/airplane-mode sessions stay consistent.

### Subscription / paywall gating

- `contexts/SubscriptionContext.tsx` wraps RevenueCat (`react-native-purchases`). Tiers: free, Pro ($29/mo), Business ($79/mo), Enterprise ($150/mo). Tier rank `free=0, pro=1, business=2, enterprise=3` — higher always satisfies a lower requirement.
- `hooks/useTierAccess.ts` is the single client-side gate. Call it from features — do not branch on raw RevenueCat entitlements.
- Server-side gate: `supabase/functions/_shared/auth.ts` `requireTier(req, ['pro','business'], 'feature')`. Uses min-rank comparison so listing pro+business in `allowed` automatically also accepts enterprise.
- Master-account override: `utils/owner.ts` `OWNER_EMAILS` (client) and `_shared/auth.ts` `MASTER_EMAILS` (server) — keep these IN SYNC. Asymmetry creates "I'm admin server-side but UI shows me free" debugging hell.
- AI usage caps: per-tier daily caps (text) live in `utils/aiRateLimiter.ts`; per-tier monthly caps (vision) live in `_shared/auth.ts` `MONTHLY_CAPS`. Numbers must stay aligned with `app/paywall.tsx` `AI_LIMITS` table.
- Purchase flow lives in `app/paywall.tsx`. RevenueCat product identifiers: `com.mageid.<tier>.<period>`. RC offering package identifiers: `<tier>_monthly` / `<tier>_annual`. Entitlement names match tier names: `pro`, `business`, `enterprise`.

### Types

`types/index.ts` is the single source of truth for domain types (`Project`, `Estimate`, `ChangeOrder`, `Invoice`, `DailyReport`, `PunchItem`, `Photo`, `RFI`, `Submittal`, `Warranty`, `PortalMessage`, etc). Contexts, backend, and UI all import from there. Extending a domain object = edit this file first.

### Path alias

`@/*` → repo root (see `tsconfig.json`). Prefer `@/components/Foo` over deep relative paths.

### Backend

- **Supabase edge functions** (`supabase/functions/*`) are the primary backend — Deno runtime, deployed via `supabase functions deploy <name>`. AI relays, vision processing, Stripe Connect, Stripe webhook, magic-link, RFP-award, and notification fan-out all live here.
- **`backend/hono.ts`** is a tiny Hono app with one route (`/email/send`, a Resend proxy). It is NOT mounted as the app's primary backend; it appears unused at runtime. (Earlier docs claimed it mounted tRPC — that was incorrect; tRPC has never been wired in this repo.)
- **Supabase client** in `lib/supabase.ts` (anon key, RLS-protected). Direct table access from the app uses RLS; expensive / paid AI calls go through edge functions that use `requireTier`.

### Client env vars (`EXPO_PUBLIC_*`)

Live in the gitignored repo-root `.env` and are **inlined into the bundle by Metro at build time** — so any change needs a cache-cleared restart (`bun run start --clear`), and for EAS builds the same var must be in that profile's `env` block in `eas.json` (or set as an EAS project secret). Server-side secrets (Gemini, Stripe, Resend, …) are edge-function secrets, not these — see `docs/phase26-functional-audit.md`.

| Var | Used by | If missing |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase.ts` | No backend at all; every edge-function call 401s |
| `EXPO_PUBLIC_REVENUECAT_IOS_API_KEY` (+ `_ANDROID_`, `_WEB_`, `_TEST_`) | `contexts/SubscriptionContext.tsx` | Paywall can't load offerings; all tiers read as free |
| `EXPO_PUBLIC_OPENWEATHER_API_KEY` | `utils/weatherService.ts` | **No live weather anywhere.** Every forecast falls back to `getSimulatedForecast()`, which invents conditions from the calendar date and ignores the jobsite entirely. Simulated days are tagged `source: 'simulated'`, marked in the UI ("SIMULATED WEATHER — NOT A FORECAST"), and **refused by `ProjectSchedule.weatherDelayLog`** — a delay-day record with no live evidence is not written at all, so the delay log stays empty until a key is set. Free key: <https://openweathermap.org/api> (the "5 day / 3 hour forecast" endpoint is on the free tier; days past its 5-day horizon are padded with simulated data and marked individually). |

## Conventions

- **iOS is the primary target.** `ios.supportsTablet: false` — don't design for iPad. Web is supported but secondary.
- **New Architecture is on** (`newArchEnabled: true`). Any new native module must be Fabric/TurboModule compatible.
- **Modal-in-screen pattern**: long screens (e.g. `app/project-detail.tsx`) use a tile grid that opens section modals with a `ChevronLeft` back button, rather than a single long scroll. Follow this pattern for new multi-section screens.
- **Icons**: `lucide-react-native` throughout. Don't mix in `@expo/vector-icons` unless there's no Lucide equivalent.
- **Haptics / local auth / secure store** are available (`expo-haptics`, `expo-local-authentication`, `expo-secure-store`) — prefer them over re-rolling.
