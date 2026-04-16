# Tertiary - Complete App Architecture Document

## Overview
**Tertiary** is a construction management mobile app built for general contractors. It handles project estimation, scheduling, invoicing, change orders, daily field reports, subcontractor management, punch lists, photo documentation, material pricing, and a supplier marketplace.

**App Name:** Tertiary
**Bundle ID (iOS):** app.rork.construction-cost-estimator-3g637fu
**Package (Android):** app.rork.construction_cost_estimator_3g637fu

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React Native 0.81.5 + Expo SDK 54 |
| Language | TypeScript (strict) |
| Router | Expo Router v6 (file-based routing) |
| State (server) | TanStack React Query v5 |
| State (local) | React useState + @nkzw/create-context-hook |
| Persistence | AsyncStorage (all data stored locally, cloud sync optional) |
| Backend | Hono + tRPC (deployed as serverless) |
| Icons | lucide-react-native |
| Styling | React Native StyleSheet (no styled-components, no NativeWind) |
| Package Manager | bun (NOT npm/yarn) |
| PDF | expo-print + expo-sharing |
| Images | expo-image, expo-image-picker |
| AI Features | @rork-ai/toolkit-sdk (generateObject, generateText) |
| Animations | React Native Animated API (NOT reanimated unless critical) |
| Validation | Zod v4 |
| Serialization | superjson |

---

## Project Structure

```
app/                          # Expo Router file-based routes
  _layout.tsx                 # Root layout - providers, auth guard, Stack navigator
  login.tsx                   # Login screen
  signup.tsx                  # Signup screen
  onboarding.tsx              # First-launch onboarding
  project-detail.tsx          # Full project detail (tabs: Overview, COs, Invoices, DFRs, Photos, Punch List)
  change-order.tsx            # Create/edit a change order (param: projectId, ?changeOrderId)
  invoice.tsx                 # Create/edit an invoice (param: projectId, ?invoiceId)
  daily-report.tsx            # Create/edit a daily field report (param: projectId, ?reportId)
  punch-list.tsx              # Punch list management (param: projectId)
  +not-found.tsx              # 404 fallback

  (tabs)/                     # Bottom tab navigator
    _layout.tsx               # Tab bar config (7 tabs)
    (home)/                   # Projects dashboard tab
      _layout.tsx             # Stack layout
      index.tsx               # Project list, stats cards, create project
    estimate/                 # Estimate wizard tab
      _layout.tsx
      index.tsx               # AI-powered cost estimator with line items
    marketplace/              # Supplier marketplace tab
      _layout.tsx
      index.tsx               # Browse suppliers and listings
    materials/                # Material pricing tab
      _layout.tsx
      index.tsx               # Material categories grid + price alerts
      [category].tsx          # Paginated material list per category (20 items/page)
    schedule/                 # Schedule maker tab
      _layout.tsx
      index.tsx               # Gantt chart, task list, AI schedule generation
    subs/                     # Subcontractor management tab
      _layout.tsx
      index.tsx               # Sub database with compliance tracking
    settings/                 # App settings tab
      _layout.tsx
      index.tsx               # Company branding, tax rate, theme colors, subscription, biometrics

backend/                      # Server-side code (Hono + tRPC)
  hono.ts                     # Hono app with CORS + tRPC middleware
  trpc/
    create-context.ts         # tRPC context (extracts auth token from headers)
    app-router.ts             # Root router combining auth + sync
    routes/
      auth.ts                 # signup, login, me, logout (in-memory Map storage)
      sync.ts                 # saveProjects, loadProjects, saveSettings, loadSettings

components/
  ErrorBoundary.tsx           # App-wide error boundary with recovery
  EmptyState.tsx              # Reusable empty state illustration
  ProjectCard.tsx             # Project card for dashboard list
  SignaturePad.tsx            # Draw-to-sign component (PanResponder + SVG)
  schedule/
    GanttChart.tsx            # Gantt chart visualization

constants/
  colors.ts                   # Color system with dynamic theming (setCustomColors)
  materials.ts                # Full material database (~1500 lines, all categories)
  scheduleTemplates.ts        # Pre-built schedule templates by project type

contexts/
  AuthContext.tsx              # Auth state: login, signup, guest mode, session persistence
  ProjectContext.tsx           # All app data: projects, COs, invoices, DFRs, subs, punch items, photos, price alerts

lib/
  trpc.ts                     # tRPC client config with auth headers

mocks/
  suppliers.ts                # Mock supplier data for marketplace

types/
  index.ts                    # ALL TypeScript interfaces and types (~520 lines)

utils/
  estimator.ts                # AI-powered estimate generation using @rork-ai/toolkit-sdk
  pdfGenerator.ts             # HTML-to-PDF generation for estimates, COs, invoices, DFRs, punch lists
  scheduleEngine.ts           # Schedule calculation: critical path, WBS, dependencies, health scoring
```

---

## Navigation Architecture

### Root Stack (app/_layout.tsx)
The root is a `<Stack>` navigator wrapped in providers:
```
trpc.Provider > QueryClientProvider > GestureHandlerRootView > ThemeLoader > AuthProvider > ProjectProvider > RootLayoutNav
```

**Auth Guard Logic:**
- Not authenticated -> redirect to `/login`
- Authenticated but no onboarding -> redirect to `/onboarding`
- Authenticated + in auth screens -> redirect to `/(tabs)/(home)`

### Tab Navigator (app/(tabs)/_layout.tsx)
7 bottom tabs, each with its own inner Stack layout:
1. **Projects** (home) - `/(tabs)/(home)`
2. **Estimate** - `/(tabs)/estimate`
3. **Marketplace** - `/(tabs)/marketplace`
4. **Materials** - `/(tabs)/materials`
5. **Schedule** - `/(tabs)/schedule`
6. **Subs** - `/(tabs)/subs`
7. **Settings** - `/(tabs)/settings`

### Modal/Stack Screens (outside tabs)
These overlay the tab bar:
- `project-detail` - Full project view
- `change-order` - CO editor
- `invoice` - Invoice editor
- `daily-report` - DFR editor
- `punch-list` - Punch list manager

Navigation params are passed via `router.push({ pathname: '/screen', params: { id } })` and read with `useLocalSearchParams()`.

---

## State Management

### AuthContext (contexts/AuthContext.tsx)
Built with `@nkzw/create-context-hook`. Provides:
- `user: AuthUser | null` (id, email, name, isGuest)
- `token: string | null`
- `isAuthenticated: boolean`
- `isLoading: boolean`
- `login(email, password)` - tries tRPC, falls back to local
- `signup(email, password, name)` - tries tRPC, falls back to local
- `loginAsGuest()` - creates guest session
- `logout()`

Session persisted in AsyncStorage under keys `buildwise_auth_token` and `buildwise_auth_user`.

### ProjectContext (contexts/ProjectContext.tsx)
The main data store. Built with `@nkzw/create-context-hook`. Manages ALL app data:

| Data | AsyncStorage Key | State |
|------|-----------------|-------|
| Projects | `buildwise_projects` | `Project[]` |
| Settings | `buildwise_settings` | `AppSettings` |
| Onboarding | `buildwise_onboarding_complete` | `boolean` |
| Change Orders | `tertiary_change_orders` | `ChangeOrder[]` |
| Invoices | `tertiary_invoices` | `Invoice[]` |
| Daily Reports | `tertiary_daily_reports` | `DailyFieldReport[]` |
| Subcontractors | `tertiary_subcontractors` | `Subcontractor[]` |
| Punch Items | `tertiary_punch_items` | `PunchItem[]` |
| Photos | `tertiary_photos` | `ProjectPhoto[]` |
| Price Alerts | `tertiary_price_alerts` | `PriceAlert[]` |

**Pattern:** Each data type uses:
1. `useQuery` to load from AsyncStorage on mount
2. `useState` to hold in-memory state
3. `useMutation` to persist changes back to AsyncStorage
4. `useCallback` CRUD functions exposed to consumers

**Cloud Sync:** Projects and settings are synced to the tRPC backend with a 1.5s debounce after local saves. Only works when authenticated (non-guest).

### How to Access Data
```typescript
import { useProjects } from '@/contexts/ProjectContext';
import { useAuth } from '@/contexts/AuthContext';

// In any component:
const { projects, addProject, updateProject, getProject, settings, ... } = useProjects();
const { user, isAuthenticated, login, logout } = useAuth();
```

---

## Color System (constants/colors.ts)

Uses getter-based dynamic theming. Default is forest green + amber:
- `Colors.primary` -> `#1A6B3C` (overridable)
- `Colors.accent` -> `#FF9500` (overridable)
- `Colors.background` -> `#F2F2F7`
- `Colors.surface` -> `#FFFFFF`
- `Colors.text` -> `#000000`
- `Colors.textSecondary` -> `rgba(60,60,67,0.6)`
- `Colors.success` -> `#34C759`
- `Colors.warning` -> `#FF9500`
- `Colors.error` -> `#FF3B30`

Theme customization via `setCustomColors(primary, accent)` loaded from settings on app start.

8 theme presets available: Forest Green, Ocean Blue, Slate, Charcoal, Terracotta, Navy, Burgundy, Teal.

---

## Type System (types/index.ts)

All interfaces are in one file. Key types:

### Project Types
- `ProjectType`: 'new_build' | 'renovation' | 'addition' | 'remodel' | 'commercial' | etc.
- `QualityTier`: 'economy' | 'standard' | 'premium' | 'luxury'
- `Project`: id, name, type, location, squareFootage, quality, description, estimate, schedule, linkedEstimate, status, collaborators, clientPortal, closedAt, photoCount

### Estimate Types
- `EstimateBreakdown`: materials[], labor[], permits, overhead, contingency, totals
- `LinkedEstimate`: items with markup, used for COs and invoices
- `MaterialLineItem`, `LaborLineItem`, `LinkedEstimateItem`

### Schedule Types
- `ProjectSchedule`: tasks[], totalDurationDays, criticalPathDays, healthScore, riskItems, baseline, weatherAlerts
- `ScheduleTask`: id, title, phase, durationDays, startDay, progress, crew, dependencies, status, isMilestone, wbsCode, isCriticalPath

### Document Types
- `ChangeOrder`: number, lineItems[], originalContractValue, changeAmount, newContractTotal, status (draft/sent/approved/rejected)
- `Invoice`: number, type (full/progress), lineItems[], subtotal, taxRate, totalDue, amountPaid, status (draft/sent/partially_paid/paid/overdue), payments[]
- `DailyFieldReport`: weather, manpower[], workPerformed, materialsDelivered, issuesAndDelays, photos[]
- `PunchItem`: description, location, assignedSub, dueDate, priority, status (open/in_progress/ready_for_review/closed)

### Other Types
- `Subcontractor`: compliance fields (licenseExpiry, coiExpiry, w9OnFile), bidHistory, assignedProjects
- `ProjectPhoto`: uri, timestamp, location, tag, linkedTaskId, markup[]
- `PriceAlert`: materialId, targetPrice, direction (below/above), isTriggered, isPaused
- `AppSettings`: location, units, taxRate, contingencyRate, branding, themeColors, biometricsEnabled, subscription, dfrRecipients
- `CompanyBranding`: companyName, contactName, email, phone, address, licenseNumber, tagline, logoUri, signatureData
- `SubscriptionTier`: 'free' | 'pro' | 'business'
- `ClientPortalSettings`: enabled, portalId, showSchedule, showChangeOrders, showInvoices, showPhotos

---

## Backend (backend/)

### Hono Server (backend/hono.ts)
Minimal Hono app with CORS and tRPC middleware mounted at `/trpc/*`.

### tRPC Routes

**Auth Router (backend/trpc/routes/auth.ts):**
- `auth.signup` - Creates user with SHA-256 hashed password, returns token
- `auth.login` - Validates credentials, returns token
- `auth.me` - Returns current user from token
- `auth.logout` - Deletes session
- Storage: In-memory Maps (not persistent across deploys)

**Sync Router (backend/trpc/routes/sync.ts):**
- `sync.saveProjects` - Stores JSON string of projects per user
- `sync.loadProjects` - Returns stored projects JSON
- `sync.saveSettings` - Stores JSON string of settings per user
- `sync.loadSettings` - Returns stored settings JSON
- Storage: In-memory Maps

### tRPC Client (lib/trpc.ts)
- Base URL from `process.env.EXPO_PUBLIC_RORK_API_BASE_URL`
- Auth token injected via `setAuthToken()` and sent as `Authorization: Bearer <token>`
- Uses superjson transformer

---

## Key Utilities

### PDF Generator (utils/pdfGenerator.ts)
Generates branded HTML documents and converts to PDF via `expo-print`. Supports:
- Estimates (with material/labor breakdown, schedule, signature)
- Change Orders
- Invoices
- Daily Field Reports
- Punch List / Closeout packages

Uses `expo-sharing` to share generated PDFs. Falls back gracefully on web.

### Estimator (utils/estimator.ts)
Uses `@rork-ai/toolkit-sdk`'s `generateObject()` with Zod schemas to generate AI-powered cost estimates based on project type, square footage, quality tier, and location.

### Schedule Engine (utils/scheduleEngine.ts)
Calculates:
- Critical path analysis
- WBS codes
- Task dependencies (FS, SS, FF, SF with lag)
- Health scoring
- Baseline comparisons

---

## Material System (constants/materials.ts)

~1500 lines of material data organized by category:
- Lumber & Framing
- Concrete & Masonry
- Roofing
- Electrical
- Plumbing
- HVAC
- Drywall & Insulation
- Flooring
- Paint & Finishes
- Hardware & Fasteners
- Windows & Doors
- Landscaping
- Tools & Equipment
- Safety Equipment

Each item has: name, unit, retailPrice, bulkPrice, bulkMinQty, supplier, lastUpdated.

Materials tab uses **pagination** (20 items per page) in `[category].tsx` to prevent crashes with large lists.

---

## Subscription Tiers

| Feature | Free | Pro ($29/mo) | Business ($79/mo) |
|---------|------|-------------|-------------------|
| Active Projects | 1 | Unlimited | Unlimited |
| Estimate Wizard | Basic | Full + markup | Full + markup |
| Materials Browser | View only | Full | Full |
| PDF Export | No | Yes | Yes |
| Schedule Maker | No | Yes | Yes |
| Change Orders | No | Yes | Yes |
| Invoicing | No | Yes | Yes |
| Daily Field Reports | No | Yes | Yes |
| Photo Documentation | No | Yes | Yes |
| Price Alerts | No | Yes | Yes |
| Sub Management | No | No | Yes |
| Punch List + Closeout | No | No | Yes |
| Client Portal | No | No | Yes |
| Cloud Sync | No | 1 collaborator | Unlimited |

---

## Environment Variables

```
EXPO_PUBLIC_RORK_AUTH_URL         # Auth service URL
EXPO_PUBLIC_RORK_API_BASE_URL    # tRPC API base URL
EXPO_PUBLIC_TOOLKIT_URL          # AI toolkit URL
EXPO_PUBLIC_PROJECT_ID           # Rork project ID
EXPO_PUBLIC_TEAM_ID              # Rork team ID
EXPO_PUBLIC_RORK_DB_ENDPOINT     # Database endpoint (system)
EXPO_PUBLIC_RORK_DB_NAMESPACE    # Database namespace (system)
EXPO_PUBLIC_RORK_DB_TOKEN        # Database token (system)
EXPO_PUBLIC_RORK_APP_KEY         # App key (system)
```

---

## Design Conventions

- **iOS-style cards** with subtle shadows and rounded corners (borderRadius: 16)
- **Colors:** Forest green primary + amber accent by default (customizable)
- **Status badges:** Green = good/compliant, Amber = warning/expiring, Red = error/expired/overdue
- **Icons:** Always from `lucide-react-native`
- **Spacing:** 16px standard padding, 12px between cards
- **Typography:** System fonts, weight 700 for headers, 600 for subheads, 400-500 for body
- **No comments in code** unless explicitly requested
- **Console logs** prefixed with `[Module]` for debugging (e.g., `[Auth]`, `[ProjectContext]`)

---

## Important Patterns to Follow

1. **State updates:** Always use the context functions (`addProject`, `updateProject`, etc.) - never write to AsyncStorage directly from screens.

2. **Navigation:** Use `router.push()` or `router.replace()` from `expo-router`. Pass params as query strings.

3. **PDF generation:** Use the existing `utils/pdfGenerator.ts` functions. They accept branding from settings.

4. **AI features:** Use `@rork-ai/toolkit-sdk` with Zod schemas for structured output.

5. **New screens:** Add to `app/` directory. Register in `app/_layout.tsx` Stack if it's a modal/overlay. Add to `app/(tabs)/_layout.tsx` if it's a new tab.

6. **New data types:** Add interface to `types/index.ts`, add AsyncStorage key + query + mutation + CRUD functions to `contexts/ProjectContext.tsx`.

7. **Web compatibility:** Always check `Platform.OS` for native-only APIs. The app runs on iOS, Android, and Web via React Native Web.

8. **No custom native packages:** Only use packages available in Expo Go / Expo SDK 54.

---

## Dependencies (package.json)

**Runtime:**
- expo ~54.0.27, react 19.1.0, react-native 0.81.5
- expo-router ~6.0.17 (file-based routing)
- @tanstack/react-query ^5.83.0
- @trpc/client ^11.12.0, @trpc/react-query ^11.12.0, @trpc/server ^11.12.0
- @nkzw/create-context-hook ^1.1.0
- @react-native-async-storage/async-storage 2.2.0
- @rork-ai/toolkit-sdk ^0.2.51
- expo-print ^55.0.8, expo-sharing ~14.0.8
- expo-image ~3.0.11, expo-image-picker ~17.0.9
- expo-location ~19.0.8
- expo-local-authentication ^55.0.8
- expo-haptics ~15.0.8
- expo-blur ~15.0.8
- expo-linear-gradient ~15.0.8
- lucide-react-native ^0.475.0
- react-native-svg 15.12.1
- hono ^4.12.7
- zod ^4.3.6
- superjson ^2.2.6
- zustand ^5.0.2 (installed but primary state uses context hooks)

**Dev:**
- typescript ~5.9.2
- eslint ^9.31.0
