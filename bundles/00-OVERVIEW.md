# MAGE ID — Project Overview & Build Config


> **Bundle from MAGE ID codebase.** This file is one of ~15 topical bundles designed to be uploaded to Claude Projects so Claude can understand the entire React Native / Expo construction-management app.


## Overview

MAGE ID is a React Native / Expo construction-management app. iOS is the
primary target; Android and web are supported. This bundle contains the
project-level config and guidance files — read it **first** before any
subsystem bundle.

Stack at a glance:
- **Expo SDK 54** (new architecture on), Expo Router 6 (typed routes).
- **Bun** as the package manager; scripts shell out to `expo start`.
- **EAS** for native builds, submissions, and OTA updates (runtime `appVersion`).
- **State**: Zustand for UI, TanStack Query + tRPC for server, context providers
  for cross-screen domain state.
- **Persistence**: AsyncStorage with `buildwise_*` (legacy) and `tertiary_*`
  (newer) key prefixes. Writes go through an offline queue that replays when
  connectivity returns.
- **Subscription gating** via RevenueCat (`react-native-purchases`); a single
  `useTierAccess` hook is the authoritative gate.
- **Bundle IDs**: `com.mageid.app` (iOS), `app.mageid.android` (Android).
- **Deep-link scheme**: `rork-app://` (legacy, still baked into TestFlight
  builds; do not rename without a native rebuild).


## Files in this bundle

- `CLAUDE.md`
- `package.json`
- `app.json`
- `eas.json`
- `tsconfig.json`
- `metro.config.js`
- `babel.config.js`
- `eslint.config.js`
- `expo-env.d.ts`


---

### `CLAUDE.md`

```markdown
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

```


---

### `package.json`

```json
{
  "name": "expo-app",
  "main": "expo-router/entry",
  "version": "1.0.0",
  "scripts": {
    "start": "expo start --tunnel",
    "start-web": "expo start --web --tunnel",
    "start-web-dev": "DEBUG=expo* expo start --web --tunnel",
    "lint": "expo lint",
    "android": "expo run:android",
    "ios": "expo run:ios"
  },
  "dependencies": {
    "@expo/vector-icons": "^15.0.3",
    "@hono/trpc-server": "^0.4.2",
    "@nkzw/create-context-hook": "^1.1.0",
    "@react-native-async-storage/async-storage": "2.2.0",
    "@stardazed/streams-text-encoding": "^1.0.2",
    "@supabase/supabase-js": "^2.100.0",
    "@tanstack/react-query": "^5.83.0",
    "@trpc/client": "^11.12.0",
    "@trpc/react-query": "^11.12.0",
    "@trpc/server": "^11.12.0",
    "@ungap/structured-clone": "^1.3.0",
    "expo": "~54.0.27",
    "expo-auth-session": "~7.0.10",
    "expo-blur": "~15.0.8",
    "expo-constants": "~18.0.11",
    "expo-crypto": "~15.0.8",
    "expo-file-system": "~19.0.8",
    "expo-font": "~14.0.10",
    "expo-haptics": "~15.0.8",
    "expo-image": "~3.0.11",
    "expo-image-picker": "~17.0.9",
    "expo-linear-gradient": "~15.0.8",
    "expo-linking": "~8.0.10",
    "expo-local-authentication": "^55.0.8",
    "expo-location": "~19.0.8",
    "expo-mail-composer": "~15.0.8",
    "expo-notifications": "^55.0.13",
    "expo-print": "^55.0.8",
    "expo-router": "~6.0.17",
    "expo-secure-store": "^55.0.8",
    "expo-sharing": "~14.0.8",
    "expo-splash-screen": "~31.0.12",
    "expo-status-bar": "~3.0.9",
    "expo-symbols": "~1.0.8",
    "expo-system-ui": "~6.0.9",
    "expo-updates": "~29.0.16",
    "expo-web-browser": "~15.0.10",
    "hono": "^4.12.7",
    "lucide-react-native": "^0.475.0",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.81.5",
    "react-native-gesture-handler": "~2.28.0",
    "react-native-purchases": "^9.14.0",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "react-native-svg": "15.12.1",
    "react-native-web": "^0.21.0",
    "react-native-worklets": "0.5.1",
    "superjson": "^2.2.6",
    "zod": "^4.3.6",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "@babel/core": "^7.25.2",
    "@expo/ngrok": "^4.1.0",
    "@types/react": "~19.1.10",
    "eslint": "^9.31.0",
    "eslint-config-expo": "~10.0.0",
    "typescript": "~5.9.2"
  },
  "private": true
}

```


---

### `app.json`

```json
{
  "expo": {
    "name": "MAGE ID",
    "slug": "construction-cost-estimator-3g637fu",
    "version": "1.0.0",
    "orientation": "portrait",
    "icon": "./assets/images/icon.png",
    "scheme": "rork-app",
    "userInterfaceStyle": "automatic",
    "newArchEnabled": true,
    "splash": {
      "image": "./assets/images/splash-icon.png",
      "resizeMode": "contain",
      "backgroundColor": "#ffffff"
    },
    "ios": {
      "supportsTablet": false,
      "bundleIdentifier": "com.mageid.app",
      "infoPlist": {
        "ITSAppUsesNonExemptEncryption": false
      }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/images/adaptive-icon.png",
        "backgroundColor": "#ffffff"
      },
      "package": "app.mageid.android"
    },
    "web": {
      "favicon": "./assets/images/favicon.png"
    },
    "plugins": [
      [
        "expo-router",
        {
          "origin": "https://rork.com/"
        }
      ],
      "expo-font",
      "expo-web-browser",
      "expo-mail-composer"
    ],
    "experiments": {
      "typedRoutes": true
    },
    "extra": {
      "router": {
        "origin": "https://rork.com/"
      },
      "eas": {
        "projectId": "9f6536e0-0774-47e0-a0ae-2f10a4e46b2b"
      }
    },
    "owner": "omirmajeed",
    "runtimeVersion": {
      "policy": "appVersion"
    },
    "updates": {
      "url": "https://u.expo.dev/9f6536e0-0774-47e0-a0ae-2f10a4e46b2b"
    }
  }
}

```


---

### `eas.json`

```json
{
  "cli": {
    "version": ">= 3.0.0",
    "appVersionSource": "remote"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "channel": "preview",
      "env": {
        "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY": "appl_RYYINGxrGAHJtWlcGmSZyWSkVWu",
        "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY": "appl_RYYINGxrGAHJtWlcGmSZyWSkVWu"
      }
    },
    "production": {
      "autoIncrement": true,
      "credentialsSource": "remote",
      "channel": "production",
      "env": {
        "EXPO_NO_CAPABILITY_SYNC": "1",
        "EAS_NO_FROZEN_LOCKFILE": "true",
        "EAS_BUILD_NO_EXPO_GO_WARNING": "true",
        "EXPO_PUBLIC_REVENUECAT_IOS_API_KEY": "appl_RYYINGxrGAHJtWlcGmSZyWSkVWu",
        "EXPO_PUBLIC_REVENUECAT_TEST_API_KEY": "appl_RYYINGxrGAHJtWlcGmSZyWSkVWu"
      },
      "ios": {
        "credentialsSource": "remote",
        "autoIncrement": true
      }
    }
  },
  "submit": {
    "production": {
      "ios": {
        "ascAppId": "6762229238",
        "appleTeamId": "HKT2J284D2"
      }
    }
  }
}

```


---

### `tsconfig.json`

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "paths": {
      "@/*": [
        "./*"
      ]
    }
  },
  "include": [
    "**/*.ts",
    "**/*.tsx",
    ".expo/types/**/*.ts",
    "expo-env.d.ts"
  ],
  "exclude": [
    "node_modules",
    "supabase/functions/**/*",
    "expo/**/*"
  ]
}

```


---

### `metro.config.js`

```js
const { getDefaultConfig } = require("expo/metro-config");

module.exports = getDefaultConfig(__dirname);

```


---

### `babel.config.js`

```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
  };
};

```


---

### `eslint.config.js`

```js
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  }
]);

```


---

### `expo-env.d.ts`

```ts
/// <reference types="expo/types" />

// NOTE: This file should not be edited and should be in your git ignore
```
